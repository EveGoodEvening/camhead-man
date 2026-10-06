// owner: WP4
// 过场（ARCH §6.14）：步骤脚本。
//
// 实现要点（WP4）：
// - 步骤机是同步推进的：计时步骤（wait/say/title/fade/during）在 update(dt) 里到点后当帧接着做下一步，
//   {effects}/{run}/{dialogue} 在同一 scope 里内联执行（对话 → 过场 → 对话都内联，ARCH §6.3），完成时续延。
// - play(id) 无 scope 时作为顶层 run 排队（Game.newGame 直接调 play('cs.r1.intro') 同样算 busy）；
//   栈顶已是本系统的过场时复用 mode.cutscene，否则压一层。
// - 开播时把固定相机摆到当前主相机的位姿（避免跳帧）。{cam: pose} 用 fixed 角色；{cam:'ch1'} 保持当前固定机位、
//   只切到 ch1 角色（不含 self_head）；{cam:'player'} 把固定相机摆回第三人称相机的位姿。
// - {say} 按字幕时长阻塞；{fade} 在 ?test=1 下乘 TIMING.testFadeScale；{fade:'white'} 走 post.flash（reduceFlash 由后期处理）。
// - {await:'shutter'|'zoom'}：期间 waitingInput 为真；await 之前按快门显示下一个 await 步的 early；
//   变焦经 ViewfinderSystem.stepZoom（DebugState.zoom 随之变化，调试 zoom(n) 能停下），同时设固定相机倍率。
// - 结束（含取消）时弹出本过场压的后期层（restore === false 时保留）、清 OSD、复位固定相机倍率；播完（done）记 seen(id)。
// - 跳过：重看（seen）且 skippable !== 'never' 时按空格（'play'）跳过：之后的计时步骤立即完成，effects/对话照常执行。
//   Action 里没有按键时长，所以“长按”简化为按一下（写在 engine-wp4.md）。

import type * as THREE from 'three';
import type { ApiResult, Awaitable, CameraPose, V3, ZoomLevel } from '../core/types';
import { fail, ok } from '../core/types';
import type { CutsceneId, DialogueId, SpeakerId } from '../data/ids';
import type { Game } from '../core/game';
import type { AreaContext } from '../core/area';
import type { LayerName } from '../core/layers';
import type { DText } from './dialogue';
import type { Cont, GameApi, Handler, RunOutcome, RunScope } from './effects';
import { createGameApi, sayDuration, speak } from './effects';
import { STRINGS } from '../data/strings';
import type { CrtLayout } from './cctv';
import type { FxParams } from '../fx/post';
import type { MusicCue, SfxCue } from '../audio/engine';
import { TIMING } from '../data/time';
import { devAssert, devWarn } from '../core/log';

export type CutStep =
  /** CameraPose 用 fixed 角色（world + self_head + layers）；'ch1' 用 ch1 角色（不含 self_head） */
  | { cam: CameraPose | 'player' | 'ch1'; blend?: number; barrel?: number; layers?: readonly LayerName[] }
  | { osd: string | ((t: number) => string) | null }
  | { say: DText; who?: SpeakerId | ''; dur?: number }
  | { title: string; sub?: string; dur: number }
  | { wait: number }
  /** white 遵守 reduceFlash（改为柔和淡入白） */
  | { fade: 'out' | 'in' | 'white'; dur: number }
  | { effects: Handler }
  | { dialogue: DialogueId }
  /** 开场“五路分屏”等 */
  | { crt: { layout?: CrtLayout; channel?: 1 | 2 | 3 | 4 | 5 } }
  /** 一次性；ctx 是当前区域的 AreaContext，可 ctx.add 尾声道具，随区域卸载释放 */
  | { run: (g: GameApi, ctx: AreaContext) => Awaitable<unknown> }
  /** 持续若干秒，逐帧回调（游戏时间） */
  | { during: number; tick: (g: GameApi, t01: number, dt: number, ctx: AreaContext) => void }
  /** 等玩家按快门/变焦 */
  | { await: 'shutter' | 'zoom'; zoom?: ZoomLevel; prompt?: string; early?: string }
  | { music: MusicCue }
  | { sfx: SfxCue }
  | { post: { key: string; params: Partial<FxParams> } | { pop: string } }
  /**
   * M4 第 2 轮：从这一步起，玩家按住空格时本过场的计时步骤（wait/say/title/fade/during）按 ×hurry 推进（片尾字幕这类不可跳过、
   * 但首看以后允许快进的段落）；null 关掉。不改不可跳过的语义——松开就恢复原速。
   */
  | { hurry: number | null };

export interface CutsceneDef { id: CutsceneId; steps: readonly CutStep[]; skippable?: 'never' | 'rewatch'; restore?: boolean }

interface CRun {
  readonly def: CutsceneDef;
  readonly scope: RunScope;
  readonly cb: Cont;
  readonly api: GameApi;
  /** 当前步骤下标 */
  i: number;
  /** 计时步骤剩余秒（null = 没有计时） */
  timer: number | null;
  during: { total: number; t: number; tick: (g: GameApi, t01: number, dt: number, ctx: AreaContext) => void } | null;
  awaiting: 'shutter' | 'zoom' | null;
  /** M4 第 2 轮：{hurry} 步骤设的“按住空格加速”倍率（null = 不加速） */
  hurry?: number | null;
  awaitZoom: ZoomLevel | undefined;
  /** M4：等输入时的提示（每 5 秒重发一次，直到等到为止）与计时 */
  prompt: string | null;
  promptT: number;
  /** 正在等异步步骤（effects/dialogue/run）的续延 */
  blocked: boolean;
  osd: string | ((t: number) => string) | null;
  osdT: number;
  postKeys: string[];
  pushedMode: boolean;
  modePopped: boolean;
  skipping: boolean;
  finished: boolean;
}

const POST_BARREL = 'cutscene.barrel';
/** M4：过场等输入时提示的重发间隔（游戏秒） */
const AWAIT_PROMPT_EVERY = 5;

export class CutsceneSystem {
  protected readonly game: Game;
  private readonly defs = new Map<CutsceneId, CutsceneDef>();
  private readonly runs: CRun[] = [];

  constructor(game: Game) {
    this.game = game;
  }

  get active(): { id: CutsceneId; step: number; awaiting: 'shutter' | 'zoom' | null } | null {
    const r = this.top();
    return r ? { id: r.def.id, step: r.i, awaiting: r.awaiting } : null;
  }
  /** 启动时由 AreaManager 汇总全部区域的 AreaDef.cutscenes 登记（id 全局唯一） */
  register(defs: readonly CutsceneDef[]): void {
    for (const d of defs) {
      devAssert(!this.defs.has(d.id), `CutsceneSystem.register: 过场 '${d.id}' 重复`);
      this.defs.set(d.id, d);
    }
  }
  /** 推 mode.cutscene；{effects}/{run}/{dialogue} 步骤在该 scope 下内联执行；被打断时 'cancelled' */
  play(id: CutsceneId, scope?: RunScope): Promise<RunOutcome> {
    return new Promise(resolve => this.playCps(id, scope, resolve));
  }
  /** 在 await:'shutter' 步骤推进；此前按快门显示 early（如“天还黑着。”） */
  onShutter(): ApiResult {
    const r = this.top();
    if (!r) return fail('mode_disallows');
    if (r.awaiting === 'shutter') {
      r.awaiting = null;
      this.next(r);
      return ok();
    }
    // 还没到等快门的那一步：给出下一个 await:'shutter' 的 early 文本
    for (let j = r.i; j < r.def.steps.length; j++) {
      const st = r.def.steps[j]!;
      if ('await' in st && st.await === 'shutter') {
        if (st.early) {
          this.game.ui.toast(st.early, 'feedback');
          return ok({ early: st.early });
        }
        return ok();
      }
    }
    return fail('mode_disallows');
  }
  /** 在 await:'zoom' 步骤调整固定相机倍率，到达目标倍率即推进 */
  onZoom(dir: 1 | -1): ApiResult {
    const r = this.top();
    if (!r || r.awaiting !== 'zoom') return fail('mode_disallows');
    const z = this.game.sys.viewfinder.stepZoom(dir);
    this.setFixedZoom(z);
    if (r.awaitZoom === undefined || z === r.awaitZoom) {
      r.awaiting = null;
      this.next(r);
    }
    return ok({ zoom: z });
  }
  /** await 步骤期间 effects.waitingInput 为真 */
  update(dt: number): void {
    // 只推进最内层（嵌套的外层过场此刻阻塞在 effects/对话步骤上，没有计时）
    const r = this.top();
    if (!r || r.finished) return;
    // M4 第 2 轮：{hurry} 段落里按住空格快进（node 自测的假 Game 没有 input：不加速）
    const input = (this.game as { input?: { isHeld?(b: 'Space'): boolean } }).input;
    if (r.hurry && r.hurry > 1 && input?.isHeld?.('Space')) dt *= r.hurry;
    if (r.osd !== null) r.osdT += dt;
    if (r.awaiting !== null && r.prompt) {
      r.promptT += dt;
      if (r.promptT >= AWAIT_PROMPT_EVERY) {
        r.promptT = 0;
        // 重发只刷新屏幕上的提示条，不再发 'feedback'（第一次已经发过）
        const layer = (this.game.ui as { subs?: { toast(t: string, k: 'tutorial'): void } }).subs;
        if (layer) layer.toast(r.prompt, 'tutorial');
      }
    }
    if (r.during) {
      const d = r.during;
      d.t = r.skipping ? d.total : Math.min(d.total, d.t + dt);
      const ctx = this.ctx();
      if (ctx) d.tick(r.api, d.total > 0 ? d.t / d.total : 1, dt, ctx);
      if (d.t >= d.total - 1e-6) {
        r.during = null;
        this.next(r);
      }
      return;
    }
    if (r.timer !== null) {
      r.timer = r.skipping ? 0 : r.timer - dt;
      if (r.timer <= 1e-6) {
        r.timer = null;
        this.next(r);
      }
    }
  }

  // ——————————————————————————————— WP4 内部（非冻结签名）

  /** play() 的续延版（EffectRunner 执行 E.cutscene 时用）。 */
  playCps(id: CutsceneId, scope: RunScope | undefined, cb: Cont): void {
    const def = this.defs.get(id);
    if (!def) {
      devAssert(false, `过场 '${id}' 未登记`);
      console.error(`[cutscene] 过场 '${id}' 未登记`);
      cb('done');
      return;
    }
    this.game.effects.schedule(`cutscene:${id}`, scope, (s, done) => this.begin(def, s, done), cb);
  }
  isWaitingInput(): boolean {
    const r = this.top();
    return r !== undefined && r.awaiting !== null;
  }
  cancelRuns(pred: (s: RunScope) => boolean): void {
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const r = this.runs[i]!;
      if (pred(r.scope)) this.complete(r, 'cancelled');
    }
  }
  /** 栈顶那层 mode.cutscene 是否有过场认领（CutsceneMode 的自愈检查，同 DialogueSystem.ownsTopMode）。 */
  ownsTopMode(): boolean {
    const layers = this.game.modes.stack.filter(id => id === 'mode.cutscene').length;
    const owners = this.runs.filter(r => r.pushedMode && !r.modePopped).length;
    return owners >= layers;
  }
  /** 重看时跳过（CutsceneMode 的空格）。 */
  trySkip(): ApiResult {
    const r = this.top();
    if (!r) return fail('mode_disallows');
    if (r.def.skippable === 'never' || !this.game.state.seen(r.def.id)) return fail('mode_disallows');
    r.skipping = true;
    return ok();
  }
  /** 当前过场 OSD 文本（UI 用；函数形式以该 osd 步骤起算的游戏秒调用）。 */
  osdText(): string | null {
    const r = this.top();
    if (!r || r.osd === null) return null;
    return typeof r.osd === 'function' ? r.osd(r.osdT) : r.osd;
  }
  def(id: CutsceneId): CutsceneDef | undefined {
    return this.defs.get(id);
  }
  /** CutsceneMode.exit：弹出的那层若仍被进行中的过场认领（不是本系统弹的），按取消处理它及其上的嵌套。 */
  onModeExit(): void {
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const r = this.runs[i]!;
      if (!r.pushedMode) continue;
      if (r.modePopped) return;
      r.modePopped = true;
      devWarn(`过场 '${r.def.id}' 的模式被外部弹出，按取消处理`);
      for (let j = this.runs.length - 1; j >= i; j--) {
        const x = this.runs[j];
        if (x) this.complete(x, 'cancelled');
      }
      return;
    }
  }

  private top(): CRun | undefined {
    return this.runs[this.runs.length - 1];
  }
  private ctx(): (AreaContext & { notePostKey(key: string): void }) | null {
    return this.game.areas.current?.ctx ?? null;
  }

  private begin(def: CutsceneDef, scope: RunScope, done: Cont): void {
    const m = this.game.modes;
    const reuse = m.top === 'mode.cutscene' && this.runs.length > 0;
    let pushedMode = false;
    if (!reuse) {
      // 固定相机先摆到当前画面的位姿，压入 cutscene（camera:'fixed'）时不跳
      this.game.cameras.setFixedPose(poseOf(this.game.cameras.camera), 0, { role: 'fixed' });
      const r = m.push('mode.cutscene');
      pushedMode = r.ok;
      if (!r.ok) devWarn(`过场 '${def.id}' 无法压入 mode.cutscene：${r.reason ?? ''}`);
    }
    const run: CRun = {
      def, scope, cb: done, api: createGameApi(this.game, scope), i: 0, timer: null, during: null,
      awaiting: null, awaitZoom: undefined, prompt: null, promptT: 0, blocked: false, osd: null, osdT: 0, postKeys: [],
      pushedMode, modePopped: false, skipping: false, finished: false,
    };
    this.runs.push(run);
    this.game.events.emit('cutscene:start', { id: def.id });
    this.advanceSteps(run);
  }

  /** 当前步骤完成：下标 +1 并继续。 */
  private next(r: CRun): void {
    r.i++;
    this.advanceSteps(r);
  }

  /** 从 r.i 起同步执行步骤，直到遇到阻塞步骤或结束。 */
  private advanceSteps(r: CRun): void {
    while (!r.finished) {
      if (r.scope.cancelled) return;   // cancelRuns 会结束它
      if (r.i >= r.def.steps.length) {
        this.complete(r, 'done');
        return;
      }
      const st = r.def.steps[r.i]!;
      if (this.exec(r, st) === 'block') return;
      r.i++;
    }
  }

  /** 执行一步：'next' = 已同步完成；'block' = 等计时/输入/续延（完成时调用 next）。 */
  private exec(r: CRun, st: CutStep): 'next' | 'block' {
    const g = this.game;
    if ('cam' in st) {
      const role = st.cam === 'ch1' ? 'ch1' : 'fixed';
      const pose = st.cam === 'ch1' ? poseOf(g.cameras.fixed) : st.cam === 'player' ? poseOf(g.cameras.tp) : st.cam;
      const o: { role: 'fixed' | 'ch1'; layers?: readonly LayerName[] } = { role };
      if (st.layers) o.layers = st.layers;
      g.cameras.setFixedPose(pose, st.blend ?? 0, o);
      if (st.barrel !== undefined) this.pushPost(r, POST_BARREL, { barrel: st.barrel });
      return 'next';
    }
    if ('osd' in st) {
      r.osd = st.osd;
      r.osdT = 0;
      return 'next';
    }
    if ('say' in st) {
      const text = typeof st.say === 'function' ? st.say(g.state) : st.say;
      speak(g, text, st.who ?? '', st.dur);
      return this.timed(r, sayDuration(text, st.dur));
    }
    if ('title' in st) {
      g.ui.fade.title(st.title, st.sub, st.dur);
      return this.timed(r, st.dur);
    }
    if ('wait' in st) return this.timed(r, st.wait);
    if ('fade' in st) {
      const dur = st.dur * (g.url.test ? TIMING.testFadeScale : 1);
      if (st.fade === 'white') g.pipeline.post.flash(dur * 1000);
      else g.ui.fade.black(st.fade === 'out' ? 1 : 0, dur);
      return this.timed(r, dur);
    }
    if ('effects' in st) return this.later(r, cb => g.effects.runHandlerCps(st.effects, `cutscene:${r.def.id}#${r.i}`, r.scope, cb));
    if ('dialogue' in st) return this.later(r, cb => g.sys.dialogue.startCps(st.dialogue, r.scope, cb));
    if ('crt' in st) {
      if (st.crt.layout !== undefined) g.sys.cctv.setLayout(st.crt.layout);
      if (st.crt.channel !== undefined) g.sys.cctv.select(st.crt.channel);
      return 'next';
    }
    if ('run' in st) {
      const ctx = this.ctx();
      if (!ctx) {
        devWarn(`过场 '${r.def.id}' 的 run 步骤：当前没有区域`);
        return 'next';
      }
      const fn = st.run;
      return this.later(r, cb => g.effects.runHandlerCps(api => fn(api, ctx), `cutscene:${r.def.id}#${r.i}`, r.scope, cb));
    }
    if ('during' in st) {
      r.during = { total: Math.max(0, st.during), t: 0, tick: st.tick };
      if (st.during <= 0) {
        const ctx = this.ctx();
        if (ctx) st.tick(r.api, 1, 0, ctx);
        r.during = null;
        return 'next';
      }
      return 'block';
    }
    if ('await' in st) {
      if (st.await === 'zoom' && st.zoom !== undefined && g.sys.viewfinder.zoom === st.zoom) return 'next';
      r.awaiting = st.await;
      r.awaitZoom = st.zoom;
      // M4：等变焦没写 prompt 时给“滚轮：变焦”；提示在等到之前每 5 秒重发（原来只 toast 一次，4.5 秒后画面上没有任何提示）
      r.prompt = st.prompt ?? (st.await === 'zoom' ? STRINGS.tutorial.zoom : null);
      r.promptT = 0;
      if (r.prompt) g.ui.toast(r.prompt, 'tutorial');
      g.effects.checkSettle();
      return 'block';
    }
    if ('music' in st) {
      g.audio.music(st.music);
      return 'next';
    }
    if ('sfx' in st) {
      g.audio.sfx(st.sfx);
      return 'next';
    }
    if ('hurry' in st) {
      r.hurry = st.hurry;
      return 'next';
    }
    if ('post' in st) {
      const p = st.post;
      if ('pop' in p) {
        g.pipeline.post.pop(p.pop);
        r.postKeys = r.postKeys.filter(k => k !== p.pop);
      } else {
        this.pushPost(r, p.key, p.params);
        // restore:false 的过场留下的层随区域卸载弹掉（M1d）
        if (r.def.restore === false) this.ctx()?.notePostKey(p.key);
      }
      return 'next';
    }
    return 'next';
  }

  private timed(r: CRun, sec: number): 'next' | 'block' {
    if (sec <= 0 || r.skipping) return 'next';
    r.timer = sec;
    return 'block';
  }

  /** 异步步骤：start 可能同步完成（续延在返回前被调用），此时当作 'next'。 */
  private later(r: CRun, start: (cb: Cont) => void): 'next' | 'block' {
    let returned = false;
    let syncDone = false;
    r.blocked = true;
    start(() => {
      r.blocked = false;
      if (r.finished) return;
      if (!returned) {
        syncDone = true;
        return;
      }
      this.next(r);
    });
    returned = true;
    return syncDone ? 'next' : 'block';
  }

  private pushPost(r: CRun, key: string, p: Partial<FxParams>): void {
    this.game.pipeline.post.push(key, p);
    if (!r.postKeys.includes(key)) r.postKeys.push(key);
  }

  private setFixedZoom(z: ZoomLevel): void {
    const cam = this.game.cameras.fixed;
    cam.zoom = z;
    cam.updateProjectionMatrix();
  }

  private complete(r: CRun, o: RunOutcome): void {
    if (r.finished) return;
    r.finished = true;
    r.awaiting = null;
    r.timer = null;
    r.during = null;
    if (r.def.restore !== false) for (const k of r.postKeys) this.game.pipeline.post.pop(k);
    r.postKeys = [];
    if (this.game.cameras.fixed.zoom !== 1) this.setFixedZoom(1);
    if (r.pushedMode && !r.modePopped && o === 'done') {
      r.modePopped = true;
      const m = this.game.modes;
      if (m.top === 'mode.cutscene') m.pop('mode.cutscene');
    }
    const i = this.runs.indexOf(r);
    if (i >= 0) this.runs.splice(i, 1);
    if (o === 'done') this.game.state.markSeen(r.def.id);
    this.game.events.emit('cutscene:end', { id: r.def.id });
    r.cb(o);
    this.game.effects.checkSettle();
  }
}

/** 相机当前位姿（位置 + 前方 10m 的注视点）。 */
function poseOf(cam: THREE.PerspectiveCamera): CameraPose {
  cam.updateMatrixWorld();
  const e = cam.matrixWorld.elements;
  // 相机看向本地 -z：世界前向 = -第三列
  const px = e[12]!, py = e[13]!, pz = e[14]!;
  const fx = -e[8]!, fy = -e[9]!, fz = -e[10]!;
  const pos: V3 = [px, py, pz];
  const target: V3 = [px + fx * 10, py + fy * 10, pz + fz * 10];
  return { pos, target, fov: cam.fov };
}
