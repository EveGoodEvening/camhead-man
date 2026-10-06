// owner: WP5
// 录像机（ARCH §6.10；GDD §3.8，M6）：通用走带逻辑 + 独立 tapeScene（2023 年门岗，CH1/CH2 双分屏）。R1 提供带子内容。
//
// - 带子秒 tc：0 = 22:00:00，28800 = 06:00:00（data/time.ts 的 tapeSec/tapeClock）。
// - 速率：timelapseUntil 之前 1× = 120 带子秒/秒，之后 1× = 1；快进/倒退 ×16。快进进入 slowZone 即降到 1× 播放并闪“SLOW”。
//   一帧内跨过延时段边界或降速区边界时按边界拆开积分，所以大 dt（advance 快进）也不会越过边界。
// - events：播放头任何一次移动（播放、快进、逐秒、索引、seek）之后，tc ≥ event.tc 且本次装带尚未触发 → 执行（“到达或越过”）。
// - tapeScene 是独立的 THREE.Scene，第一次进面板时建，只在 mode.panel_vcr 在栈上时渲染，离开面板时释放（ARCH §6.10）。
// - 离开面板时暂停（GDD §3.4：暂停的画面在退出面板后保留，重新进入从原处继续）；离开区域时带子位置复位（临时状态，读档后回到 22:00:00）。

import * as THREE from 'three';
import type { ApiResult, CameraPose } from '../core/types';
import { fail, ok } from '../core/types';
import type { GhostId } from '../data/ids';
import { F } from '../data/ids';
import type { Game } from '../core/game';
import type { Handler } from './effects';
import type { ReplayActorKey } from './replay';
import { sampleKeys } from './replay';
import type { CharacterKind, CharacterOpts, CharacterRig } from '../rigs/characters';
import { createCharacter } from '../rigs/characters';
import type { FeedTarget } from '../fx/feeds';
import { acquireFeed } from '../fx/feeds';
import { warmScene } from '../fx/warmup';
import { devAssert, devWarn } from '../core/log';
import { yawToRotY } from '../core/math';
import { BUDGET, QUALITY, RT_SIZE } from '../data/render';
import { TAPE, tapeClock, tapeDate, tapeSec } from '../data/time';
import { rng, seedFromString } from '../kit/rng';
import { poseCamera } from './viewfinder';
import type { CrtContent } from './crt';

export interface TapeTrack {
  /** 22:00:00 → 06:00:00 */
  startLabel: '2023-08-29 周二 22:00:00'; lengthSec: 28800;
  /** CH1 = 门楣俯拍门口；CH2 = 屋角半球机位（只拍得到桌前人的后脑勺和肩膀） */
  cams: { ch1: CameraPose; ch2: CameraPose };
  /** 从这里起画面是左 CH1 | 右 CH2 的双分屏（GDD §3.8） */
  splitFrom: '02:51:00';
  /** t 为带子秒；老周用 look:'live'、不开 faceMask */
  actors: { id: GhostId; character: CharacterKind; opts?: CharacterOpts; keys: readonly ReplayActorKey[] }[];
  /** 往**独立的 tapeScene** 里建 2023 年的门岗立面与屋内（低模）、雨、2–3 盏自带的灯 */
  build(scene: THREE.Scene, kit: TapeKit): void;
}

/** tapeScene 专用的小工具（灯 ≤ 3，单独计预算） */
export interface TapeKit {
  light<T extends THREE.Light>(l: T): T;
  track<T extends { dispose(): void }>(r: T): T;
  rng(salt?: number): () => number;
}

export interface VcrConfig {
  /** 与监控台共用的 CRT 屏幕 */
  screen: THREE.Mesh;
  /** 面板视点 */
  viewPose: CameraPose;
  track: TapeTrack;
  /** 此前 1× = 120 带子秒/真实秒；此后 1× = 1 */
  timelapseUntil: '02:51:00';
  alarmFrom: '02:51:00';
  /** ['03:13:30','03:14:30']：快进进入即降到 1×，屏角闪“SLOW” */
  slowZone: readonly [string, string];
  /** 7 个索引点 */
  index: readonly string[];
  /** “到达或越过”即触发：播放头以任何方式移动后 tc ≥ event.tc 且本次加载未触发过 */
  events: { tc: string; effects: Handler }[];
  /** 如 00:30 段“（录像机不录声音）” */
  subtitles?: { from: string; to: string; text: string }[];
}

interface Secs {
  timelapseUntil: number; alarm: number; split: number; slow0: number; slow1: number; length: number;
  index: number[];
  events: { sec: number; effects: Handler }[];
  subs: { from: number; to: number; text: string }[];
}
interface TapeRt {
  scene: THREE.Scene;
  ch1: THREE.PerspectiveCamera;
  ch2: THREE.PerspectiveCamera;
  actors: { keys: readonly ReplayActorKey[]; rig: CharacterRig; pose: string | null }[];
  disposables: { dispose(): void }[];
  lights: number;
}

const SHUTTLE = TAPE.shuttleRate;
/** 进入降速区后屏角“SLOW”闪烁的时长（游戏时间） */
const SLOW_FLASH_SEC = 2.5;
/** 索引键判断“已经在这个点上”的容差（带子秒） */
const INDEX_EPS = 0.5;
const TAPE_FOV = { ch1: 50, ch2: 70 } as const;

export class VcrSystem {
  protected readonly game: Game;
  private cfg: VcrConfig | null = null;
  private secs: Secs | null = null;
  private inserted = false;
  private _tc = 0;
  private _playing = false;
  private shuttleDir: -1 | 0 | 1 = 0;
  private readonly fired = new Set<number>();
  private slowFlash = 0;
  private subIdx = -1;
  private tape: TapeRt | null = null;
  private feed: FeedTarget | null = null;
  private unregister: (() => void) | null = null;

  constructor(game: Game) {
    this.game = game;
  }

  /** 带子在机器里（r1.tape_in_vcr 推导 + 临时状态） */
  get loaded(): boolean {
    return this.cfg !== null && (this.inserted || this.game.state.flag(F.R1_TAPE_IN_VCR));
  }
  /** 带子秒，0 = 22:00:00 */
  get tc(): number {
    return this._tc;
  }
  get playing(): boolean {
    return this._playing;
  }
  get shuttle(): -16 | 0 | 16 {
    return this.shuttleDir === 1 ? 16 : this.shuttleDir === -1 ? -16 : 0;
  }

  /** R1 build 时调用；离开 R1 时自动清除 */
  configure(c: VcrConfig): void {
    devAssert(this.cfg === null, 'VcrSystem.configure: called twice in one area');
    this.cfg = c;
    const idx = c.index.map(tapeSec).sort((a, b) => a - b);
    this.secs = {
      timelapseUntil: tapeSec(c.timelapseUntil), alarm: tapeSec(c.alarmFrom), split: tapeSec(c.track.splitFrom),
      slow0: tapeSec(c.slowZone[0]), slow1: tapeSec(c.slowZone[1]), length: c.track.lengthSec,
      index: idx,
      events: c.events.map(e => ({ sec: tapeSec(e.tc), effects: e.effects })),
      subs: (c.subtitles ?? []).map(s => ({ from: tapeSec(s.from), to: tapeSec(s.to), text: s.text })),
    };
    this.game.sys.crt.attach(c.screen);
  }

  /** 推 mode.panel_vcr（需要已装带） */
  open(): ApiResult {
    if (!this.cfg) return fail('no_such_target');
    if (!this.loaded) return fail('blocked');
    const modes = this.game.modes;
    if (modes.has('mode.panel_vcr')) return ok(this.status());
    // 从取景器（或回放）里按 E 打开面板：先弹掉裸取景器/回放再压面板（M1d），面板上要取景器由右键再叠一层——
    // 否则两层 viewfinder 共用一个开关，面板视点上还叠着取景器的后期与 HUD
    while (modes.top === 'mode.replay' || modes.top === 'mode.viewfinder') if (!modes.pop(modes.top).ok) break;
    const r = modes.push('mode.panel_vcr');
    return r.ok ? ok(this.status()) : r;
  }

  /** 装带并打开面板，停在 22:00:00 */
  insert(): ApiResult {
    if (!this.cfg) return fail('no_such_target');
    this.inserted = true;
    this._playing = false;
    this.shuttleDir = 0;
    this.fired.clear();
    this.subIdx = -1;
    this.game.audio.sfx('tape_insert');
    this.moveTo(0);
    return this.open();
  }

  togglePlay(): void {
    if (this._playing) this.pause();
    else this.play();
  }
  pause(): void {
    this._playing = false;
    this.shuttleDir = 0;
  }
  play(): void {
    if (!this.loaded) return;
    this._playing = true;
    this.shuttleDir = 0;
    this.game.audio.sfx('vcr_motor');
  }

  /** 按住 Z/C（dir 0 = 松开：回到按下前的播放/暂停状态） */
  setShuttle(dir: -1 | 0 | 1): void {
    if (!this.loaded || !this.secs) return;
    if (dir === 1 && this.inSlowZone(this._tc)) {
      // 降速区里快进不起来：直接 1× 播放
      this._playing = true;
      this.shuttleDir = 0;
      this.slowFlash = SLOW_FLASH_SEC;
      return;
    }
    if (dir !== 0 && dir !== this.shuttleDir) this.game.audio.sfx('vcr_motor');
    this.shuttleDir = dir;
  }

  /** 逐秒 */
  stepSec(dir: -1 | 1): void {
    if (!this.loaded) return;
    this._playing = false;
    this.shuttleDir = 0;
    this.moveTo(Math.round(this._tc) + dir);
  }

  /** [ ] */
  jumpIndex(dir: -1 | 1): void {
    const s = this.secs;
    if (!this.loaded || !s) return;
    const tc = this._tc;
    const next = dir > 0 ? s.index.find(p => p > tc + 1e-6) : [...s.index].reverse().find(p => p < tc - INDEX_EPS);
    if (next === undefined) return;
    this.shuttleDir = 0;
    this.moveTo(next);
  }

  /** 调试/索引共用；移动后按“到达或越过”检查 events */
  seek(tc: string | number): void {
    if (!this.cfg) return;
    this.shuttleDir = 0;
    this.moveTo(typeof tc === 'string' ? tapeSec(tc) : tc);
  }

  /** 'HH:MM:SS' */
  tcString(): string {
    return tapeClock(this._tc);
  }

  /** 'CH1 2023-08-30 周三 03:14:05'（00:00 跨日；分屏后右半 OSD 为 CH2） */
  osd(): string {
    return `CH1 ${tapeDate(this._tc)} ${tapeClock(this._tc)}`;
  }

  /** 离开区域：清除配置、释放 tapeScene、注销 feed（M1a 补写；ARCH §4.5 第 3 步由 AreaContextImpl.dispose() 调用） */
  clearArea(): void {
    this.releaseTape();
    this.cfg = null;
    this.secs = null;
    this.inserted = false;
    this._tc = 0;
    this._playing = false;
    this.shuttleDir = 0;
    this.fired.clear();
    this.slowFlash = 0;
    this.subIdx = -1;
  }

  update(dt: number): void {
    const s = this.secs;
    if (!this.cfg || !s) return;
    this.slowFlash = Math.max(0, this.slowFlash - dt);
    const onPanel = this.game.modes.has('mode.panel_vcr');
    if (!onPanel) {
      // 面板外带子不走（面板 exit 已暂停；这里兜底）
      return;
    }
    if (this.loaded && dt > 0 && (this._playing || this.shuttleDir !== 0)) this.moveTo(this.integrate(this._tc, dt));
    this.poseTapeActors(dt);
  }

  // ------------------------------------------------------------------ WP5 内部

  /** 面板视点（取景器叠在录像机面板上时 fp/photo 取它）。 */
  get viewPose(): CameraPose | null {
    return this.cfg?.viewPose ?? null;
  }

  /** 录像机面板打开且装了带时 CRT 显示的内容；否则 null（CRT 回到监控台/待机）。 */
  screenContent(): CrtContent | null {
    const s = this.secs;
    if (!s || !this.loaded || !this.game.modes.has('mode.panel_vcr')) return null;
    const split = this._tc >= s.split;
    return {
      layout: 0, map: this.feed?.read ?? null, ch2: null, atlas: null, noSignal: 0, tunnel: null, tunnelMix: 0,
      split: split ? 1 : 0, noise: this.shuttleDir !== 0 ? 0.25 : 0,
      osd: { line: this.osd(), right: '', alarm: this._tc >= s.alarm, slow: this.slowFlash > 0 },
    };
  }

  /** 面板 enter：建 tapeScene、注册 tape feed（面板淡入期间预编译着色器）。 */
  openPanel(): void {
    this.buildTape();
  }

  /** 面板 exit：暂停并释放 tapeScene（带子留在机器里，位置保留）。 */
  closePanel(): void {
    this._playing = false;
    this.shuttleDir = 0;
    this.releaseTape();
  }

  /** 自测用：tapeScene（面板打开期间存在）。 */
  get tapeScene(): THREE.Scene | null {
    return this.tape?.scene ?? null;
  }

  /** 带子秒积分：按延时段边界与降速区入口拆开，dt 很大也不会越过边界。 */
  integrate(tc: number, dt: number): number {
    const s = this.secs;
    if (!s) return tc;
    let t = tc;
    let rem = dt;
    for (let guard = 0; guard < 8 && rem > 1e-9; guard++) {
      const dir = this.shuttleDir !== 0 ? this.shuttleDir : this._playing ? 1 : 0;
      if (dir === 0) break;
      const mult = this.shuttleDir !== 0 ? SHUTTLE : 1;
      // 所在（或将要进入的）段的 1× 速率
      const inTimelapse = dir > 0 ? t < s.timelapseUntil : t <= s.timelapseUntil;
      const rate = (inTimelapse ? TAPE.timelapseRate : 1) * mult;
      let boundary = dir > 0 ? (t < s.timelapseUntil ? s.timelapseUntil : s.length) : (t > s.timelapseUntil ? s.timelapseUntil : 0);
      const ffIntoSlow = this.shuttleDir === 1 && t < s.slow0;
      if (ffIntoSlow) boundary = Math.min(boundary, s.slow0);
      const reach = Math.abs(boundary - t) / rate;
      if (reach > rem) {
        t += dir * rate * rem;
        rem = 0;
        break;
      }
      t = boundary;
      rem -= reach;
      if (ffIntoSlow && boundary === s.slow0) {
        // 快进进入降速区：降到 1× 播放，屏角闪 SLOW（GDD §3.8）
        this.shuttleDir = 0;
        this._playing = true;
        this.slowFlash = SLOW_FLASH_SEC;
      } else if (boundary === s.length || boundary === 0) {
        this._playing = false;
        this.shuttleDir = 0;
        break;
      }
    }
    return Math.max(0, Math.min(s.length, t));
  }

  // ------------------------------------------------------------------ 内部

  private status(): { tc: string; playing: boolean; shuttle: number } {
    return { tc: this.tcString(), playing: this._playing, shuttle: this.shuttle };
  }

  private inSlowZone(tc: number): boolean {
    const s = this.secs;
    return !!s && tc >= s.slow0 && tc <= s.slow1;
  }

  /** 播放头的唯一移动入口：钳制 → 发 vcr:tc → “到达或越过”事件 → 字幕。 */
  private moveTo(sec: number): void {
    const s = this.secs;
    if (!s) return;
    const from = this._tc;
    const tc = Math.max(0, Math.min(s.length, sec));
    this._tc = tc;
    if (tc !== from) this.game.events.emit('vcr:tc', { tc, from });
    s.events.forEach((e, i) => {
      if (tc >= e.sec && !this.fired.has(i)) {
        this.fired.add(i);
        this.game.effects.runHandler(e.effects, `vcr:${tapeClock(e.sec)}`).catch((err: unknown) => devWarn('VcrSystem: event failed', err));
      }
    });
    const si = s.subs.findIndex(x => tc >= x.from && tc < x.to);
    if (si !== this.subIdx) {
      this.subIdx = si;
      const sub = s.subs[si];
      if (sub) this.game.api.say(sub.text, undefined, 3);
    }
  }

  private buildTape(): void {
    const cfg = this.cfg;
    if (!cfg || this.tape) return;
    const scene = new THREE.Scene();
    scene.name = 'tapeScene';
    const disposables: { dispose(): void }[] = [];
    const tape: TapeRt = {
      scene, ch1: new THREE.PerspectiveCamera(TAPE_FOV.ch1, 4 / 3, 0.05, 60), ch2: new THREE.PerspectiveCamera(TAPE_FOV.ch2, 4 / 3, 0.05, 60),
      actors: [], disposables, lights: 0,
    };
    const seed = seedFromString('tape_830');
    const kit: TapeKit = {
      light: l => {
        tape.lights++;
        devAssert(tape.lights <= BUDGET.tapeLights, `tapeScene: more than ${BUDGET.tapeLights} lights`);
        l.layers.enableAll();
        if (!l.parent) scene.add(l);
        return l;
      },
      track: r => {
        disposables.push(r);
        return r;
      },
      rng: salt => rng(seed + (salt ?? 0)),
    };
    cfg.track.build(scene, kit);
    for (const a of cfg.track.actors) {
      // 录像带里老周的脸是清楚的（当年伙计的眼睛录下的，不是倒带，GDD §3.8）：look:'live'、不开 faceMask
      const rig = createCharacter(a.character, { ...a.opts, look: 'live', faceMask: false });
      rig.root.name = a.id;
      scene.add(rig.root);
      tape.actors.push({ keys: [...a.keys].sort((x, y) => x.t - y.t), rig, pose: null });
    }
    poseCamera(tape.ch1, cfg.track.cams.ch1);
    poseCamera(tape.ch2, cfg.track.cams.ch2);
    for (const c of [tape.ch1, tape.ch2]) {
      c.aspect = 4 / 3;
      c.updateProjectionMatrix();
      c.updateMatrixWorld(true);
    }
    this.tape = tape;
    this.poseTapeActors(0);
    this.feed ??= acquireFeed('tape', RT_SIZE.tape[0], RT_SIZE.tape[1]);
    this.unregister = this.game.pipeline.addFeed({
      key: 'tape',
      // 与镜面错开一帧（M1d；CRT 同一时刻只显示录像带或监控台之一，所以与 CH2 同相位不冲突）
      due: frameNo => this.tape !== null && this.game.modes.has('mode.panel_vcr') && (frameNo + 1) % Math.max(1, QUALITY[this.game.settings.quality].feedEvery) === 0,
      render: r => this.renderTape(r),
    });
    // 打开面板时把带子场景真画一遍（ARCH §6.10；M1d：原来 compileAsync(scene, ch1) 在渲染目标为 null 时编出的是用不上的 sRGB 变体，
    // 02:51 分屏才入画的 CH2 人物还要到播放中途才编译）：两台机位、全部对象不剔除、隐藏的也显出来，画进线性 RT
    warmScene(this.game.renderer, scene, [tape.ch1, tape.ch2]);
  }

  /** 按 tc 摆带子里的人（关键帧插值同回放；姿势不过渡，延时段里本来就是跳着走的）。 */
  private poseTapeActors(dt: number): void {
    const t = this.tape;
    if (!t) return;
    for (const a of t.actors) {
      const smp = sampleKeys(a.keys, this._tc, a.rig.root.position);
      a.rig.root.rotation.set(0, yawToRotY(smp.yaw), 0);
      if (a.pose !== smp.key.pose) {
        a.rig.setPose(smp.key.pose, 0);
        a.pose = smp.key.pose;
      }
      a.rig.update(this._playing && this.shuttleDir === 0 ? dt : 0, smp.speed);
    }
  }

  private releaseTape(): void {
    this.unregister?.();
    this.unregister = null;
    this.feed?.dispose();
    this.feed = null;
    const t = this.tape;
    if (!t) return;
    this.tape = null;
    for (const a of t.actors) a.rig.dispose();
    for (const d of t.disposables) d.dispose();
    t.scene.clear();
  }

  /** 按 tc 摆带子里的人，渲进 256×192 RT：02:51 前整幅 CH1，之后左右两个 128×192 视口分别渲 CH1/CH2（4:3 横向压扁）。 */
  private renderTape(r: THREE.WebGLRenderer): void {
    const t = this.tape;
    const s = this.secs;
    if (!t || !s) return;
    const tc = this._tc;
    this.feed ??= acquireFeed('tape', RT_SIZE.tape[0], RT_SIZE.tape[1]);
    const rt = this.feed.write;
    const [w, h] = RT_SIZE.tape;
    const prev = r.getRenderTarget();
    if (tc < s.split) {
      rt.viewport.set(0, 0, w, h);
      rt.scissorTest = false;
      r.setRenderTarget(rt);
      if (!r.autoClear) r.clear();
      r.render(t.scene, t.ch1);
    } else {
      const half = w / 2;
      rt.scissorTest = true;
      rt.viewport.set(0, 0, half, h);
      rt.scissor.set(0, 0, half, h);
      r.setRenderTarget(rt);
      if (!r.autoClear) r.clear();
      r.render(t.scene, t.ch1);
      rt.viewport.set(half, 0, half, h);
      rt.scissor.set(half, 0, half, h);
      r.setRenderTarget(rt);
      if (!r.autoClear) r.clear();
      r.render(t.scene, t.ch2);
      rt.scissorTest = false;
      rt.viewport.set(0, 0, w, h);
      rt.scissor.set(0, 0, w, h);
    }
    r.setRenderTarget(prev);
    this.feed.swap();
  }
}
