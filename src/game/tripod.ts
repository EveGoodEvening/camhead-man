// owner: WP5
// 三脚架与长曝光（ARCH §6.12；GDD X2/X4）。
//
// 状态机：off →(enter)→ armed →(start，左键)→ countdown（10 s）→ exposing（3 s）→ 成功 / 出圈 / 移动。
// - 出圈：曝光开始那一刻身体到粉笔叉（XZ）超过 radius → onFailOutside，回到 armed。
// - 移动：曝光期间有任何移动输入 → onFailMoved，回到 armed（“糊了”，可无限重来）。
// - 成功：曝光满 stillSec 且身体仍在圈内 → 弹出 mode.tripod、状态回到 off，再以顶层 run 执行 onSuccess（R1 在里面发 ph.final、写 r1.soul_returned、开过场）。
//   头留在门楣支架上（结局），save 的 'ending' hold 不释放（ARCH §6.4：结局全程不落盘）。
// - cancel（E，只在 armed）：头回到身上、回到 explore、release('ending')。
// 倒计时与曝光只在 update(dt)（游戏时间）里走，冻结时不走。

import type * as THREE from 'three';
import type { ApiResult, CameraPose, V3 } from '../core/types';
import { fail, ok } from '../core/types';
import type { Game } from '../core/game';
import type { Handler } from './effects';
import { devWarn } from '../core/log';
import { POST_PRESETS } from '../fx/presets';
import { LOOK } from '../data/render';

/** M4：三脚架（合影）期间的曝光增量 */
const TRIPOD_EXPOSURE_BOOST = 0.3;

export interface TripodConfig {
  /** 门楣空支架（头装上去的位置） */
  mount: THREE.Object3D;
  /** CH1 机位 */
  camPose: CameraPose;
  /** 粉笔叉 r1.mark_photo，1.5 */
  zone: V3; radius: number;
  /** 10、3 */
  countdown: number; stillSec: number;
  osd: (remaining: number) => string;
  /** 由 R1 写：award ph.final、r1.soul_returned、过场 */
  onSuccess: Handler;
  /** 反馈文本 + 老周台词；回到 armed */
  onFailOutside: Handler;
  onFailMoved: Handler;
}

type TripodState = 'off' | 'armed' | 'countdown' | 'exposing';

export class TripodSystem {
  protected readonly game: Game;
  private cfg: TripodConfig | null = null;
  private _state: TripodState = 'off';
  private _remaining = 0;
  private exposed = 0;
  private headOnMount = false;
  private pendingPush = false;
  /** 刚刚成功曝光：onSuccess 里 award 的照片记为三脚架情境（PhotoRecord.context 'tripod'），award 读后清掉 */
  private shotPending = false;
  private unsubMode: (() => void) | null = null;
  private tick = 0;

  constructor(game: Game) {
    this.game = game;
  }

  get state(): 'off' | 'armed' | 'countdown' | 'exposing' {
    return this._state;
  }
  get remaining(): number {
    return this._remaining;
  }
  get exposure01(): number {
    const still = this.cfg?.stillSec ?? 0;
    return this._state === 'exposing' && still > 0 ? Math.min(1, this.exposed / still) : 0;
  }

  configure(c: TripodConfig): void {
    this.cfg = c;
  }

  /**
   * 头 detach → mount；推 mode.tripod；相机 fixed=camPose（role 'tripod'，不含 self_head）；身体可控；内部先 save.hold('ending')。
   * 入口是强制对话 dlg.r1.bracket_confirm 的选项 effects（E.call）：此刻对话还在栈顶，mode.tripod 要等对话弹出之后再压，
   * 否则对话结束时弹的是三脚架。所以对话在栈上时登记一个 'mode' 监听，栈上没有对话的那一刻（同一次 choose 调用内）再压。
   */
  enter(): ApiResult {
    const cfg = this.cfg;
    if (!cfg) return fail('no_such_target');
    if (this._state !== 'off' || this.pendingPush || this.headOnMount) return fail('busy');
    const game = this.game;
    game.save.hold('ending');
    const modes = game.modes;
    const blocking = (stack: readonly string[]): boolean => stack.includes('mode.dialogue') || stack.includes('mode.album');
    if (!blocking(modes.stack)) return this.pushNow();
    this.pendingPush = true;
    this.unsubMode = game.events.on('mode', e => {
      if (blocking(e.stack) || !this.pendingPush) return;
      this.pendingPush = false;
      this.unsubMode?.();
      this.unsubMode = null;
      this.pushNow();
    });
    return ok({ state: 'armed' });
  }

  /** 左键：开始 10 秒倒计时（armed → countdown） */
  start(): ApiResult {
    const cfg = this.cfg;
    if (!cfg || this._state !== 'armed') return fail('mode_disallows');
    this._state = 'countdown';
    this._remaining = cfg.countdown;
    this.tick = Math.ceil(cfg.countdown);
    this.game.audio.sfx('exposure_tick');
    return ok({ state: this._state });
  }

  /** E：仅 armed 时可用；头回到身上，回到 explore，save.release('ending') */
  cancel(): ApiResult {
    if (this._state !== 'armed') return fail('mode_disallows');
    this.teardown();
    if (this.game.modes.top === 'mode.tripod') this.game.modes.pop('mode.tripod');
    this.game.save.release('ending');
    return ok({ state: this._state });
  }

  /** 调试定位 */
  bodyGoto(x: number, z: number): ApiResult {
    if (this._state === 'off') return fail('mode_disallows');
    const p = this.game.player.position;
    this.game.player.teleport([x, p.y, z]);
    return ok({ pos: [x, p.y, z] });
  }

  /**
   * 离开区域时清除配置（M1a 补写；ARCH §4.5 第 3 步由 AreaContextImpl.dispose() 调用）。
   * 成功之后头一直留在门楣支架上（结局与尾声）；换区域（片尾后新游戏/读档）时才把头装回身子，否则支架随区域一起被释放。
   */
  clearArea(): void {
    if (this._state !== 'off') this.teardown();
    this.restoreHead();
    this.cancelPending();
    this.shotPending = false;
    this.cfg = null;
  }

  /** 倒计时 → 曝光：每帧检查 input.moveActive() 与身体到 zone 的距离（冻结时不走） */
  update(dt: number): void {
    const cfg = this.cfg;
    if (!cfg || dt <= 0) return;
    if (this._state === 'countdown') {
      this._remaining = Math.max(0, this._remaining - dt);
      const whole = Math.ceil(this._remaining);
      if (whole < this.tick && whole > 0) {
        this.tick = whole;
        this.game.audio.sfx('exposure_tick');
      }
      if (this._remaining <= 0) {
        if (!this.inZone()) {
          this.fail(cfg.onFailOutside, 'outside');
          return;
        }
        this._state = 'exposing';
        this.exposed = 0;
      }
      return;
    }
    if (this._state === 'exposing') {
      if (this.game.input.moveActive()) {
        this.fail(cfg.onFailMoved, 'moved');
        return;
      }
      this.exposed += dt;
      if (this.exposed >= cfg.stillSec) {
        if (!this.inZone()) {
          this.fail(cfg.onFailOutside, 'outside');
          return;
        }
        this.succeed(cfg);
      }
    }
  }

  // ------------------------------------------------------------------ WP5 内部

  /** 成功之后仍留在支架上的头装回身子（clearArea 用；自测收尾也用它，免得后面的测试拿到没头的主角）。 */
  restoreHead(): void {
    if (this._state !== 'off' || !this.headOnMount) return;
    this.game.playerModel.head.reattach();
    this.headOnMount = false;
  }

  /** PhotoSystem.award 调用：这张照片是不是三脚架刚拍的（读后清零）。 */
  consumeShot(): boolean {
    const v = this.shotPending || this._state !== 'off';
    this.shotPending = false;
    return v;
  }

  /** 当前 OSD（倒计时文字；TripodHud 可读）。 */
  osdText(): string {
    return this.cfg ? this.cfg.osd(this._remaining) : '';
  }

  /** TripodMode.enter：CH1 机位（role 'tripod'，不含 self_head）+ ch1 后期（桶形畸变）。 */
  modeEntered(): void {
    const cfg = this.cfg;
    if (!cfg) return;
    this.game.cameras.setFixedPose(cfg.camPose, 0, { role: 'tripod' });
    // M4：合影时曝光提一点（+0.3），藏蓝的身子在夜里读得出来（主角的轮廓光同时加强，rigs/player.ts PLAYER_RIM_TRIPOD）
    this.game.pipeline.post.push('tripod', { ...POST_PRESETS.ch1, exposure: LOOK.exposure + TRIPOD_EXPOSURE_BOOST });
  }

  /** TripodMode.exit：模式被弹出（成功、取消或 resetTo）。resetTo 打断时把头装回并释放存档 hold。 */
  modeExited(): void {
    this.game.pipeline.post.pop('tripod');
    if (this._state !== 'off') {
      // 被 modes.resetTo 打断（正常流程不会发生：三脚架期间 goto/reload 都返回 busy）
      this.teardown();
      this.game.save.release('ending');
    }
  }

  // ------------------------------------------------------------------ 内部

  private pushNow(): ApiResult {
    const cfg = this.cfg;
    if (!cfg) return fail('no_such_target');
    const head = this.game.playerModel.head.detach();
    cfg.mount.add(head);
    head.position.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
    this.headOnMount = true;
    this._state = 'armed';
    this._remaining = cfg.countdown;
    this.exposed = 0;
    const r = this.game.modes.push('mode.tripod');
    if (!r.ok) {
      devWarn('TripodSystem: cannot push mode.tripod', r.reason);
      this.teardown();
      this.game.save.release('ending');
      return r;
    }
    return ok({ state: this._state });
  }

  private inZone(): boolean {
    const cfg = this.cfg;
    if (!cfg) return false;
    const p = this.game.player.position;
    return Math.hypot(p.x - cfg.zone[0], p.z - cfg.zone[2]) <= cfg.radius;
  }

  private fail(h: Handler, why: 'outside' | 'moved'): void {
    this._state = 'armed';
    this._remaining = this.cfg?.countdown ?? 0;
    this.exposed = 0;
    this.run(h, `tripod:fail_${why}`);
  }

  private succeed(cfg: TripodConfig): void {
    this._state = 'off';
    this._remaining = 0;
    this.exposed = 0;
    // 头留在支架上（结局：尾声身体不见，头留在门楣），ending hold 保持；headOnMount 仍为真，clearArea 时再装回
    this.shotPending = true;
    if (this.game.modes.top === 'mode.tripod') this.game.modes.pop('mode.tripod');
    this.run(cfg.onSuccess, 'tripod:success');
  }

  private teardown(): void {
    if (this.headOnMount) this.game.playerModel.head.reattach();
    this.headOnMount = false;
    this._state = 'off';
    this._remaining = 0;
    this.exposed = 0;
  }

  private cancelPending(): void {
    this.pendingPush = false;
    this.unsubMode?.();
    this.unsubMode = null;
  }

  private run(h: Handler, origin: string): void {
    this.game.effects.runHandler(h, origin).catch((err: unknown) => devWarn(`TripodSystem: ${origin} failed`, err));
  }
}
