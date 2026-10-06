// owner: WP7
// 调试与测试 API（ARCH §12）：window.__game，别名 window.__cam（同一个对象）。任何构建都挂基础 API；?debug=1 时额外挂 ★ 方法与性能面板。
// 通用约定（ARCH §12.2）：全部 async、返回可 JSON 序列化的 ApiResult、内部串行排队、settle 而不是完成、锁步、真实时间超时（默认 60 秒）。
//
// 实现要点（WP7）：
// - 能改变进度状态的方法一律走玩家的同一条代码路径（ARCH §3.5）：构造 Action → game.dispatch，或调用 interaction.activate 等系统入口；
//   只有 ★ 方法（setFlags/giveItem/givePhoto/setState/shot）直接写状态，且只在 ?debug=1 下存在。
// - ?test=1 下 interact/show/use 先按真人路径检查（debug/fidelity.ts）：自动转向 → 视线无遮挡 → 聚焦系统选中的正是该 id。
// - “需要时间”的方法自己推进游戏时间（锁步下两次调用之间时间不走）：settle 用 game.settle()，walk/dlg/wait 用 game.advance()。
// - 内部异常不会抛到页面：记录 console.error（harness 会据此判失败）并返回 { ok:false, reason:'exception' }——这是引擎缺陷，不是调用方的错。

import * as THREE from 'three';
import type {
  ApiResult, AreaKey, FailReason, LensMode, ModeId, Settle, Shichen, ZoomLevel,
} from '../core/types';
import { AREA_IDS, ZOOM_STEPS, fail, ok } from '../core/types';
import type {
  CutsceneId, DialogueId, DocId, ExitId, FlagId, InteractId, ItemId, KeyPhotoId, NameId, PhotoId, PhotoTargetId, PuzzleId, ReadId,
  ReplayPointId, SegmentId, SpawnId, ThingId,
} from '../data/ids';
import { F, IT, NAME, NUMERIC_FLAGS, PH } from '../data/ids';
import { docOwnerItem, itemDocs } from '../data/items';
import { QUALITY } from '../data/render';
import type { Game } from '../core/game';
import type { Action, ActionResult } from '../core/actions';
import type { AlbumArg, InteractableStatus } from '../game/interaction';
import type { JournalArg } from '../game/journal';
import type { SelftestResult } from './selftest';
import { listSelftests, runSelftest } from './selftest';
import { checkInteractFidelity, lintGame, macrotask, pointInFrame, resolveAimPoint, turnTowards, walkTo } from './fidelity';
import { mountOverlay } from './overlay';
import type { DebugOverlay } from './overlay';
import { runShot } from './shots';

/** 每个方法的返回：ApiResult，另带 settle（ARCH §12.2）。 */
export type DebugResult<T = unknown> = ApiResult<T> & { settle?: Settle };

export interface DebugState {
  area: AreaKey; floor: number | null; pos: [number, number, number]; yaw: number; pitch: number;
  mode: ModeId; stack: ModeId[]; shichen: Shichen; clock: string;
  flags: Record<string, boolean | number>;
  items: { id: ItemId; used: boolean }[]; photos: PhotoId[]; names: NameId[]; clues: string[]; ants: number;
  vf: boolean; lens: LensMode; zoom: ZoomLevel;
  focused: InteractId | null; reading: { id: ReadId; text: string } | null; readHint: string | null;
  replay: { point: ReplayPointId; seg: SegmentId; t: number; playing: boolean; index: number; count: number } | null;
  vcr: { loaded: boolean; tc: string; playing: boolean; shuttle: number } | null;
  console: { channel: number; jack: boolean; layout: 'single' | 'split5' } | null;
  dialogue: { id: DialogueId; who: string; text: string; options: string[] } | null;
  cutscene: { id: CutsceneId; awaiting: string | null } | null;
  panel: { kind: 'code'; owner: InteractId; entered: string } | { kind: 'naming'; options: NameId[] } | null;
  album: { kind: 'browse' | 'menu' | 'pick'; target?: InteractId; verb?: 'show' | 'use' } | null;
  tripod: { state: string; remaining: number } | null;
  /** M3 补写：栈上打开着的文档（mode.journal 带 { doc, vf }）：正文 = journal.renderDoc(id, vf)；巡夜本或没打开时 null */
  doc: { id: DocId; vf: boolean; text: string } | null;
  subtitle: string | null; lastFeedback: string | null;
  /** 当前区域临时状态 */
  temp: Record<string, boolean | number>;
  saves: { auto: boolean; yin: boolean; completed: boolean; hold: boolean };
  ending: 'none' | 'main' | 'nanke';
  settle: 'idle' | 'waiting' | 'busy';
  loading: boolean;
}

/** interact/show/use 的 result（与 InteractionSystem.activate 同形） */
export interface InteractOutcome { accepted: boolean; feedback?: string; opened?: ModeId; settle: Settle }
export interface AimOutcome {
  point: [number, number, number];
  reading: { id: ReadId; text: string } | null; readHint: string | null;
  focused: InteractId | null; inFrame: boolean; clamped: boolean;
}
export interface PerfStats {
  fps: number; calls: number; callsMain: number; tris: number; geometries: number; textures: number; programs: number;
  lights: number; lightsOn: number; renderScale: number;
  /** M1d：calls/callsMain/tris 是连采 frames 帧（辅助 RT 的一个完整节流周期，≤ 12）里的最大值；callsMean 是整帧 draw call 的平均 */
  callsMean: number; frames: number;
  /** M1d：场景里正在用的 CanvasTexture 总量（MB，按 w×h×4 估算；§13.3 预算 BUDGET.canvasBytes） */
  canvasMB: number;
  /** M4：当前区域碰撞 Octree 的节点数（§16 #37：细分参数错了会到二十万级） */
  octreeNodes?: number;
}
export type HintOutcome = { puzzle: PuzzleId | null; level: 1 | 2 | 3; text: string; appended?: { puzzle: PuzzleId; text: string } };
export type GotoOutcome = { area: AreaKey; pos: [number, number, number]; mode: ModeId; hops?: ExitId[] };
export type DebugStatePatch = {
  flags?: Record<string, boolean | number>; items?: (ItemId | { id: ItemId; used: boolean })[]; photos?: PhotoId[];
  area?: AreaKey; spawn?: SpawnId;
};

/** ARCH §12.3 方法表（GDD §3.15 的名字为正名，另挂别名）。★ = 仅 ?debug=1（非 debug 构建里这些键不存在）。 */
export interface DebugApi {
  state(): Promise<DebugResult<DebugState>>;
  getState(): Promise<DebugResult<DebugState>>;
  newGame(): Promise<DebugResult<{ area: AreaKey; mode: ModeId }>>;
  continueGame(slot?: 'save.auto' | 'save.yin'): Promise<DebugResult<{ area: AreaKey; mode: ModeId }>>;
  reload(): Promise<DebugResult<{ area: AreaKey; spawn: SpawnId }>>;
  goto(area: AreaKey, x: number, z: number, floor?: number): Promise<DebugResult<GotoOutcome>>;
  teleport(area: AreaKey, x: number, z: number, floor?: number): Promise<DebugResult<GotoOutcome>>;
  walk(x: number, z: number): Promise<DebugResult<{ pos: [number, number, number] }>>;
  listInteractables(): Promise<DebugResult<InteractableStatus[]>>;
  focused(): Promise<DebugResult<InteractId | null>>;
  interact(id: InteractId): Promise<DebugResult<InteractOutcome>>;
  show(target: InteractId, thing: ThingId): Promise<DebugResult<InteractOutcome>>;
  showItem(target: InteractId, thing: ThingId): Promise<DebugResult<InteractOutcome>>;
  use(target: InteractId, thing: ThingId): Promise<DebugResult<InteractOutcome>>;
  useItem(target: InteractId, thing: ThingId): Promise<DebugResult<InteractOutcome>>;
  readDoc(doc: DocId): Promise<DebugResult<{ text: string; vf: boolean }>>;
  vf(on: boolean | 'on' | 'off'): Promise<DebugResult<{ on: boolean }>>;
  setViewfinder(on: boolean | 'on' | 'off'): Promise<DebugResult<{ on: boolean }>>;
  lens(l: LensMode): Promise<DebugResult<{ lens: LensMode }>>;
  setLensMode(l: LensMode): Promise<DebugResult<{ lens: LensMode }>>;
  zoom(n: ZoomLevel): Promise<DebugResult<{ zoom: ZoomLevel }>>;
  /** id：pt.* / rd.* / rp.* / 交互物 / NPC / decoy.*（瞄准点解析顺序见 ARCH §12.3） */
  aimAt(id: string): Promise<DebugResult<AimOutcome>>;
  shoot(): Promise<DebugResult<{ photo?: PhotoId; hit?: PhotoTargetId | null; caption?: string }>>;
  takePhoto(): Promise<DebugResult<{ photo?: PhotoId; hit?: PhotoTargetId | null; caption?: string }>>;
  replay(rp: ReplayPointId, seg?: SegmentId): Promise<DebugResult<{ seg: SegmentId; index: number; count: number }>>;
  replaySeek(t: number): Promise<DebugResult<{ t: number }>>;
  replayPause(): Promise<DebugResult>;
  replayPlay(): Promise<DebugResult>;
  replayExit(): Promise<DebugResult>;
  dlg(o?: { maxReal?: number }): Promise<DebugResult<{ at: 'choice' | 'await' | 'end'; options?: string[]; mode: ModeId }>>;
  advanceDialogue(o?: { maxReal?: number }): Promise<DebugResult<{ at: 'choice' | 'await' | 'end'; options?: string[]; mode: ModeId }>>;
  choose(k: number | NameId): Promise<DebugResult<{ chosen: string; feedback?: string }>>;
  chooseDialogOption(k: number | NameId): Promise<DebugResult<{ chosen: string; feedback?: string }>>;
  input(code: string): Promise<DebugResult<{ correct: boolean }>>;
  enterCode(code: string): Promise<DebugResult<{ correct: boolean }>>;
  /** 'play'/'pause'；'seek','HH:MM:SS'；'index','next'|'prev'；'shuttle',-1|0|1；'exit' */
  vcr(cmd: 'play' | 'pause' | 'seek' | 'index' | 'shuttle' | 'exit', arg?: string | number): Promise<DebugResult<{ tc: string; playing: boolean; shuttle: number }>>;
  console(ch: 1 | 2 | 3 | 4 | 5 | 'exit'): Promise<DebugResult<{ channel: number }>>;
  tripod(cmd: 'start' | 'cancel'): Promise<DebugResult<{ state: string }>>;
  bodyGoto(x: number, z: number): Promise<DebugResult>;
  back(): Promise<DebugResult<{ mode: ModeId }>>;
  hint(): Promise<DebugResult<HintOutcome>>;
  wait(sec: number): Promise<DebugResult<{ time: number }>>;
  setTimeScale(k: number): Promise<DebugResult>;
  frame(n?: number): Promise<DebugResult>;
  lint(): Promise<DebugResult<{ issues: string[] }>>;
  perf(): Promise<DebugResult<PerfStats>>;
  // ★ 仅 ?debug=1
  shot?(area: AreaKey, shotId: string): Promise<DebugResult<{ keys: { id: string; x: number; y: number }[] }>>;
  setFlags?(flags: Record<string, boolean | number>): Promise<DebugResult>;
  giveItem?(id: ItemId): Promise<DebugResult>;
  givePhoto?(id: PhotoId): Promise<DebugResult>;
  setState?(p: DebugStatePatch): Promise<DebugResult>;
  /** 运行 debug/selftest.ts 登记的页面内自测（ARCH §2.10） */
  selftest?(name: string): Promise<DebugResult<SelftestResult>>;
  /** 已登记的自测名 */
  selftests?(): Promise<DebugResult<string[]>>;
}

declare global {
  interface Window { __game: DebugApi; __cam: DebugApi }
}

// ==================================================================== 常量与小工具（WP7 内部）

/** 默认真实时间超时（ARCH §12.2）。harness 在 Node 侧另设 90 秒。 */
export const API_TIMEOUT_MS = 60_000;
/** 页面内自测与截图机位可能要建区域、渲很多帧，给更长的上限（harness 同步放宽）。 */
export const LONG_TIMEOUT_MS = 240_000;
/** 对话、过场、三脚架期间不能被 goto/reload/setState 打断（ARCH §12.2）。 */
const BUSY_MODES: readonly ModeId[] = ['mode.dialogue', 'mode.cutscene', 'mode.tripod'];
/** 玩家能对世界里的东西按 E 的模式（ARCH 附录 A）；其余模式交给 activate 报 mode_disallows。 */
const ACT_MODES: readonly ModeId[] = ['mode.explore', 'mode.viewfinder', 'mode.replay'];
const AREA_KEYS: readonly AreaKey[] = [...AREA_IDS, 'dev'];
const FLAG_SET: ReadonlySet<string> = new Set<string>(Object.values(F));
const ITEM_SET: ReadonlySet<string> = new Set<string>(Object.values(IT));
const KEY_PHOTO_SET: ReadonlySet<string> = new Set<string>(Object.values(PH));
const NAME_SET: ReadonlySet<string> = new Set<string>(Object.values(NAME));

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const round = (n: number, k = 1000): number => Math.round(n * k) / k;
const tuple = (v: THREE.Vector3): [number, number, number] => [round(v.x), round(v.y), round(v.z)];
const isAreaKey = (a: unknown): a is AreaKey => typeof a === 'string' && (AREA_KEYS as readonly string[]).includes(a);

/** 深拷贝成可 JSON 序列化的值：Vector3 → [x,y,z]，非有限数 → null，函数丢弃（ARCH §12.2：不返回 three 对象）。 */
export function jsonSafe<T>(v: T): T {
  if (v === undefined) return v;
  const text = JSON.stringify(v, (_k, x: unknown) => {
    if (typeof x === 'number' && !Number.isFinite(x)) return null;
    if (x instanceof THREE.Vector3) return [x.x, x.y, x.z];
    if (typeof x === 'function') return undefined;
    return x;
  });
  return (text === undefined ? undefined : JSON.parse(text)) as T;
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/** 失败结果附带说明字段（result 的形状与成功时不同，只给人看/给脚本打印）。 */
function failWith<T = unknown>(reason: FailReason, detail?: Record<string, unknown>): DebugResult<T> {
  const r: DebugResult<T> = { ok: false, reason };
  if (detail) (r as { result?: unknown }).result = detail;
  return r;
}

/** Action 的结果转成调试 API 的结果（去掉 pass 标记）。 */
function fromAction<T = unknown>(r: ActionResult): DebugResult<T> {
  const out: DebugResult<T> = { ok: r.ok };
  if (r.reason !== undefined) out.reason = r.reason;
  if (r.result !== undefined) out.result = r.result as T;
  return out;
}

// ==================================================================== 运行时

class DebugRuntime {
  readonly game: Game;
  overlay: DebugOverlay | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly frameTimes: number[] = [];

  constructor(game: Game) {
    this.game = game;
    // 近 2 秒平均 FPS（perf()）与性能面板：自己挂一个 rAF 计时器（锁步下 Game.step 不在 rAF 里跑，'frame' 事件不可靠）
    let last = 0;
    const tick = (t: number): void => {
      this.frameTimes.push(t);
      while (this.frameTimes.length > 2 && t - this.frameTimes[0]! > 2000) this.frameTimes.shift();
      this.overlay?.update(last > 0 ? (t - last) / 1000 : 0);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  fps(): number {
    const n = this.frameTimes.length;
    if (n < 2) return 0;
    const span = this.frameTimes[n - 1]! - this.frameTimes[0]!;
    return span > 0 ? round(((n - 1) * 1000) / span, 10) : 0;
  }

  /**
   * 串行排队 + 真实时间超时 + 异常兜底 + JSON 化（ARCH §12.2）。超时后队列放行下一个调用（卡住的那个在后台继续，结果丢弃）。
   */
  /** M4：测试 URL 的 ?slow=k（负载很高的机器）：真实时间上限乘 k（ARCH §12.2 的 60 秒是 k = 1）。 */
  get slow(): number {
    return this.game.url?.slow ?? 1;
  }

  queue<T>(name: string, fn: () => Promise<DebugResult<T>>, timeoutMs = API_TIMEOUT_MS): Promise<DebugResult<T>> {
    timeoutMs *= this.slow;
    const run = async (): Promise<DebugResult<T>> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<DebugResult<T>>(resolve => {
        timer = setTimeout(() => resolve({ ok: false, reason: 'timeout', settle: 'waiting' }), timeoutMs);
      });
      const guarded = (async (): Promise<DebugResult<T>> => {
        try {
          return await fn();
        } catch (err) {
          // Game.settle()/advance 的真实时间或游戏时间超限 reject 一个 name === 'TimeoutError' 的 Error（docs/requests/engine-wp1.md #1）：
          // 这是“卡住了”，按 ARCH §12.2 报 timeout（附 state 快照），不是引擎异常
          if (err instanceof Error && err.name === 'TimeoutError') return { ok: false, reason: 'timeout', result: { method: name, error: err.message, state: this.safeSnapshot() } as unknown as T };
          console.error(`[debug api] ${name}() 出错`, err);
          return { ok: false, reason: 'exception', result: { error: errorText(err) } as unknown as T };
        }
      })();
      try {
        const r = await Promise.race([guarded, timeout]);
        if (r.reason === 'timeout') r.result = { method: name, state: this.safeSnapshot() } as unknown as T;
        try {
          return jsonSafe(r);
        } catch {
          return { ok: r.ok, ...(r.reason !== undefined ? { reason: r.reason } : {}), ...(r.settle ? { settle: r.settle } : {}) };
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  // ---------------------------------------------------------------- settle 与推进

  /** 推进到 runner 空闲或正在等玩家输入（ARCH §6.3）；锁步下由 game.settle 自己 advance。 */
  async settle(): Promise<Settle> {
    return this.game.settle();
  }

  settleNow(): 'idle' | 'waiting' | 'busy' {
    const e = this.game.effects;
    return !e.busy ? 'idle' : e.waitingInput ? 'waiting' : 'busy';
  }

  /**
   * 等一个系统调用（activate 等）的 Promise：它可能在等 runner settle，而锁步下没人推进时间——
   * 反复调用 game.settle()（已 settle 时立即返回）直到它 resolve；真实时间由 queue() 的超时兜底。
   */
  async pump<T>(p: Promise<T>): Promise<T> {
    let done = false;
    const q = p.finally(() => {
      done = true;
    });
    while (!done) {
      await this.game.settle();
      if (!done) await macrotask();
    }
    return q;
  }

  /** 运行 fn，期间收集 'feedback' 事件（反馈条、旁白、字幕都会发，ARCH §4.3）；返回最后一条。 */
  async withFeedback<T>(fn: () => Promise<T>): Promise<{ value: T; feedback: string | null }> {
    let last: string | null = null;
    const off = this.game.events.on('feedback', e => {
      last = e.text;
    });
    try {
      const value = await fn();
      return { value, feedback: last };
    } finally {
      off();
    }
  }

  /**
   * 让玩家模型立刻跟上控制器（位置、朝向、云台随视角）：同区域 goto/aimAt 在锁步下不走 step，
   * 模型要等下一帧的 playerModel.update 才挪过去，而镜中读字（stickerWorld）、CH2 画面、截图都看模型。dt = 0，不推进任何动画。
   */
  syncModel(): void {
    const g = this.game;
    g.playerModel.update(0, g.player, g.modes.top);
  }

  busyMode(): boolean {
    return this.game.modes.stack.some(m => BUSY_MODES.includes(m));
  }

  dispatch(a: Action): ActionResult {
    return this.game.dispatch(a);
  }

  // ---------------------------------------------------------------- state()

  safeSnapshot(): DebugState | null {
    try {
      return this.snapshot();
    } catch {
      return null;
    }
  }

  snapshot(): DebugState {
    const g = this.game;
    const s = g.state;
    const sys = g.sys;
    const cur = g.areas.current;
    const rp = sys.replay.active;
    const d = sys.dialogue.active;
    const c = sys.cutscene.active;
    const code = sys.panels.code;
    const naming = sys.panels.naming;
    let album: DebugState['album'] = null;
    if (g.modes.has('mode.album')) {
      const arg = g.modes.arg<AlbumArg>('mode.album');
      if (arg && 'menu' in arg) album = { kind: 'menu', target: arg.menu.target };
      else if (arg && 'pick' in arg) album = { kind: 'pick', target: arg.pick.target, verb: arg.pick.verb };
      else album = { kind: 'browse' };
    }
    const reading = sys.read.reading;
    const openDoc = g.modes.has('mode.journal') ? g.modes.arg<JournalArg>('mode.journal') : undefined;
    const vcrShown = sys.vcr.loaded || g.modes.has('mode.panel_vcr');
    const consoleShown = g.modes.has('mode.panel_console') || sys.cctv.jack || sys.cctv.layout === 'split5';
    return {
      area: cur?.def.id ?? s.area,
      floor: cur?.ctx.levelsHandle?.current ?? null,
      pos: tuple(g.player.position),
      yaw: round(g.player.yaw, 100),
      pitch: round(g.player.pitch, 100),
      mode: g.modes.top,
      stack: [...g.modes.stack],
      shichen: sys.shichen.current,
      clock: sys.shichen.clockText(),
      flags: { ...s.listFlags() },
      items: s.listItems().map(e => ({ id: e.id, used: e.used })),
      photos: s.listPhotos().map(p => p.id),
      names: [...s.names()],
      clues: [...s.listClues()],
      ants: s.antCount(),
      vf: sys.viewfinder.on,
      lens: sys.viewfinder.lens,
      zoom: sys.viewfinder.zoom,
      focused: sys.interaction.focused,
      reading: reading ? { id: reading.id, text: reading.text } : null,
      readHint: reading ? null : sys.read.hint,
      replay: rp ? { point: rp.point, seg: rp.seg, t: round(rp.t), playing: rp.playing, index: rp.index, count: rp.count } : null,
      vcr: vcrShown ? { loaded: sys.vcr.loaded, tc: sys.vcr.tcString(), playing: sys.vcr.playing, shuttle: sys.vcr.shuttle } : null,
      console: consoleShown ? { channel: sys.cctv.channel, jack: sys.cctv.jack, layout: sys.cctv.layout } : null,
      dialogue: d ? { id: d.id, who: d.who, text: d.text, options: [...d.options] } : null,
      cutscene: c ? { id: c.id, awaiting: c.awaiting } : null,
      panel: code ? { kind: 'code', owner: code.owner, entered: code.entered } : naming ? { kind: 'naming', options: [...naming.options] } : null,
      album,
      tripod: sys.tripod.state !== 'off' ? { state: sys.tripod.state, remaining: round(sys.tripod.remaining, 100) } : null,
      doc: openDoc ? { id: openDoc.doc, vf: openDoc.vf, text: sys.journal.renderDoc(openDoc.doc, openDoc.vf) } : null,
      subtitle: g.ui.currentSubtitle(),
      lastFeedback: g.ui.lastFeedback(),
      temp: cur ? { ...cur.ctx.tempSnapshot() } : {},
      saves: { auto: g.save.has('save.auto'), yin: g.save.has('save.yin'), completed: g.save.completed, hold: g.save.held },
      ending: g.ending,
      settle: this.settleNow(),
      loading: g.areas.isLoading(),
    };
  }

  // ---------------------------------------------------------------- 交互（interact/show/use）

  /**
   * interact/show/use 的共同前置：目标存在 → 自动转向 →（?test=1）真人路径检查。返回失败结果，或 null 表示可以 activate。
   * 模式不允许交互、目标不在场、距离不够时不在这里拦：交给 activate 报 mode_disallows/not_present/out_of_range（附反馈），
   * 与玩家按 E 得到同样的结论。
   */
  prepare(id: InteractId): DebugResult | null {
    const g = this.game;
    if (typeof id !== 'string') return fail('bad_args');
    if (!g.sys.interaction.get(id)) return fail('no_such_target');
    if (!ACT_MODES.includes(g.modes.top)) return null;
    const p = resolveAimPoint(g, id);
    if (p) turnTowards(g, p);
    this.syncModel();
    g.sys.interaction.update(0);
    if (!g.url.test) return null;
    const st = g.sys.interaction.list().find(s => s.id === id);
    if (!st || !st.present || !st.inRange) return null;
    const f = checkInteractFidelity(g, id, p ?? undefined);
    return f.ok ? null : f;
  }

  async activate(id: InteractId, req: { verb: 'primary' } | { verb: 'show' | 'use'; thing: ThingId }): Promise<DebugResult<InteractOutcome>> {
    const g = this.game;
    const { value: r, feedback } = await this.withFeedback(() => this.pump(g.sys.interaction.activate(id, req, 'api')));
    const settle = r.ok ? await this.settle() : this.settleNow() === 'waiting' ? 'waiting' : 'idle';
    const res: InteractOutcome = { accepted: r.result?.accepted ?? false, settle: r.result?.settle ?? settle };
    const fb = r.result?.feedback ?? feedback ?? undefined;
    if (fb !== undefined) res.feedback = fb;
    if (r.result?.opened !== undefined) res.opened = r.result.opened;
    else if (r.ok && g.modes.top !== 'mode.explore' && g.modes.top !== 'mode.viewfinder') res.opened = g.modes.top;
    return r.ok ? { ok: true, result: res, settle } : { ok: false, reason: r.reason ?? 'mode_disallows', result: res, settle };
  }

  async offer(target: InteractId, thing: ThingId, verb: 'show' | 'use'): Promise<DebugResult<InteractOutcome>> {
    const g = this.game;
    if (typeof thing !== 'string') return fail('bad_args');
    const pre = this.prepare(target);
    if (pre) return pre as DebugResult<InteractOutcome>;
    // 与玩家在挑选器里选中是同一条路径：打开 album{pick}，选中后弹出 album 再 activate({verb, thing})（ARCH §6.6、§12.3）。
    // 挑选器的格子顺序是 UI 的内部细节，所以这里不模拟方向键，只验证 album{pick} 在当前模式下能打开。
    if (ACT_MODES.includes(g.modes.top)) {
      const pushed = g.modes.push('mode.album', { pick: { target, verb } } satisfies AlbumArg);
      if (!pushed.ok) return pushed as DebugResult<InteractOutcome>;
      g.modes.pop('mode.album');
    }
    return this.activate(target, { verb, thing });
  }

  // ---------------------------------------------------------------- dlg()

  /** ARCH §12.3 dlg()：对话行 → dispatch advance；runner 忙且不在等输入 → advance(≤1s)；停在选项、await，或回到非对话/过场且空闲。 */
  async dlgLoop(): Promise<DebugResult<{ at: 'choice' | 'await' | 'end'; options?: string[]; mode: ModeId }>> {
    const g = this.game;
    let stuck = 0;
    let lastKey = '';
    for (;;) {
      if (g.modes.freezesWorld() && !g.sys.dialogue.active) return fail('mode_disallows', { at: 'end', mode: g.modes.top });
      const d = g.sys.dialogue.active;
      if (d) {
        if (!d.typing && d.options.length > 0) return ok({ at: 'choice', options: [...d.options], mode: g.modes.top });
        if (g.modes.top !== 'mode.dialogue') return fail('mode_disallows', { at: 'end', mode: g.modes.top });
        const key = `${d.id}|${d.node}|${d.text}|${d.typing}`;
        stuck = key === lastKey ? stuck + 1 : 0;
        lastKey = key;
        if (stuck > 200) return fail('timeout', { at: 'end', mode: g.modes.top });
        // 同一行按了好几次还没动：可能在等游戏时间（逐字、淡入），推一点时间再按
        if (stuck > 2) await g.advance(0.1);
        const r = this.dispatch({ t: 'advance' });
        if (!r.ok && stuck > 50) return fromAction(r);
        await macrotask();
        continue;
      }
      const c = g.sys.cutscene.active;
      if (c && c.awaiting) return ok({ at: 'await', mode: g.modes.top });
      const e = g.effects;
      if (e.busy && !e.waitingInput) {
        const t0 = g.time;
        await g.advance(1, 1 / 30, () => !g.effects.busy || g.effects.waitingInput || g.sys.dialogue.active !== null);
        if (g.time === t0) {
          stuck++;
          if (stuck > 200) return fail('timeout', { at: 'end', mode: g.modes.top });
          await macrotask();
        } else {
          stuck = 0;
        }
        continue;
      }
      if (!e.busy && (g.modes.top === 'mode.dialogue' || g.modes.top === 'mode.cutscene')) {
        // runner 已空闲、模式还没退：给系统几帧收尾
        stuck++;
        if (stuck > 60) return ok({ at: 'end', mode: g.modes.top });
        await g.advance(1 / 30);
        continue;
      }
      return ok({ at: 'end', mode: g.modes.top });
    }
  }

}

// ==================================================================== DebugApi

function buildApi(rt: DebugRuntime): DebugApi {
  const g = rt.game;
  const q = <T>(name: string, fn: () => Promise<DebugResult<T>>, timeoutMs?: number): Promise<DebugResult<T>> => rt.queue(name, fn, timeoutMs);

  const state = (): Promise<DebugResult<DebugState>> => q('state', async () => ok(rt.snapshot()));

  const gotoFn = (area: AreaKey, x: number, z: number, floor?: number): Promise<DebugResult<GotoOutcome>> => q('goto', async () => {
    if (!isAreaKey(area) || !isNum(x) || !isNum(z) || (floor !== undefined && floor !== null && !isNum(floor))) return fail('bad_args');
    if (rt.busyMode()) return fail('busy');
    const from = g.areas.current?.def.id ?? null;
    let hops: ExitId[] | undefined;
    if (from !== null && from !== area) {
      const r = g.areas.route(from, area);
      if (r.ok) hops = [...r.hops];
    }
    const { value: r, feedback } = await rt.withFeedback(() => g.areas.goto(area, x, z, floor ?? undefined));
    if (!r.ok) {
      const res: DebugResult<GotoOutcome> = fromAction(r);
      if (r.reason === 'blocked' && feedback && typeof r.result === 'object' && r.result !== null && !('feedback' in r.result)) {
        res.result = { ...(r.result as object), feedback } as unknown as GotoOutcome;
      }
      return res;
    }
    rt.syncModel();
    const settle = await rt.settle();
    const out: GotoOutcome = { area: g.areas.current?.def.id ?? area, pos: tuple(g.player.position), mode: g.modes.top };
    if (hops) out.hops = hops;
    return { ok: true, result: out, settle };
  });

  const interact = (id: InteractId): Promise<DebugResult<InteractOutcome>> => q('interact', async () => {
    const pre = rt.prepare(id);
    if (pre) return pre as DebugResult<InteractOutcome>;
    return rt.activate(id, { verb: 'primary' });
  });

  const show = (target: InteractId, thing: ThingId): Promise<DebugResult<InteractOutcome>> => q('show', () => rt.offer(target, thing, 'show'));
  const use = (target: InteractId, thing: ThingId): Promise<DebugResult<InteractOutcome>> => q('use', () => rt.offer(target, thing, 'use'));

  const vf = (on: boolean | 'on' | 'off'): Promise<DebugResult<{ on: boolean }>> => q('vf', async () => {
    const want = on === true || on === 'on' ? true : on === false || on === 'off' ? false : null;
    if (want === null) return fail('bad_args');
    if (g.sys.viewfinder.on !== want) {
      const a: Action = g.settings.vfMode === 'hold' ? { t: 'vf', down: want } : { t: 'vf' };
      const r = rt.dispatch(a);
      if (!r.ok) return fromAction(r);
    }
    const settle = await rt.settle();
    const now = g.sys.viewfinder.on;
    return now === want ? { ok: true, result: { on: now }, settle } : { ok: false, reason: 'mode_disallows', result: { on: now }, settle };
  });

  const lens = (l: LensMode): Promise<DebugResult<{ lens: LensMode }>> => q('lens', async () => {
    if (l !== 'normal' && l !== 'ir') return fail('bad_args');
    if (g.sys.viewfinder.lens !== l) {
      const { value: r, feedback } = await rt.withFeedback(async () => rt.dispatch({ t: 'lens' }));
      if (!r.ok) {
        const res = fromAction<{ lens: LensMode }>(r);
        if (feedback && res.result === undefined) res.result = { lens: g.sys.viewfinder.lens, feedback } as { lens: LensMode };
        return res;
      }
    }
    const now = g.sys.viewfinder.lens;
    return now === l ? ok({ lens: now }) : fail('mode_disallows', { lens: now });
  });

  const zoom = (n: ZoomLevel): Promise<DebugResult<{ zoom: ZoomLevel }>> => q('zoom', async () => {
    if (!ZOOM_STEPS.includes(n)) return fail('bad_args');
    const cut = g.sys.cutscene.active;
    if (cut && cut.awaiting === 'zoom') {
      // 过场 await:'zoom'：固定相机的倍率由过场自己管，按到它推进为止
      const dir: 1 | -1 = n === 1 ? -1 : 1;
      for (let i = 0; i < ZOOM_STEPS.length && g.sys.cutscene.active?.awaiting === 'zoom'; i++) {
        const r = rt.dispatch({ t: 'zoom', dir });
        if (!r.ok) return fromAction(r);
      }
      const settle = await rt.settle();
      return { ok: true, result: { zoom: n }, settle };
    }
    for (let guard = 0; g.sys.viewfinder.zoom !== n && guard < ZOOM_STEPS.length + 1; guard++) {
      const before = g.sys.viewfinder.zoom;
      const dir: 1 | -1 = ZOOM_STEPS.indexOf(n) > ZOOM_STEPS.indexOf(before) ? 1 : -1;
      const r = rt.dispatch({ t: 'zoom', dir });
      if (!r.ok) return fromAction(r);
      if (g.sys.viewfinder.zoom === before) break;
    }
    const now = g.sys.viewfinder.zoom;
    g.areas.current?.ctx.updateViews?.();   // M4：同 aimAt（锁步截图不落后一帧）
    return now === n ? ok({ zoom: now }) : fail('mode_disallows', { zoom: now });
  });

  const aimAt = (id: string): Promise<DebugResult<AimOutcome>> => q('aimAt', async () => {
    if (typeof id !== 'string' || !id) return fail('bad_args');
    const p = resolveAimPoint(g, id);
    if (!p) return fail('no_such_target');
    const t = turnTowards(g, p, { face: false });
    rt.syncModel();
    // M4：高清贴图切换、视图变体本来在 step 里按相机现算；锁步下 aimAt 之后直接截图会落后一帧（2× 下取件格编号还是低清）
    g.areas.current?.ctx.updateViews?.();
    g.sys.read.evaluate();
    g.sys.interaction.update(0);
    const reading = g.sys.read.reading;
    return ok({
      point: tuple(p),
      reading: reading ? { id: reading.id, text: reading.text } : null,
      readHint: reading ? null : g.sys.read.hint,
      focused: g.sys.interaction.focused,
      inFrame: pointInFrame(g, p),
      clamped: t.clamped,
    });
  });

  const shoot = (): Promise<DebugResult<{ photo?: PhotoId; hit?: PhotoTargetId | null; caption?: string }>> => q('shoot', async () => {
    const { value: r, feedback } = await rt.withFeedback(async () => rt.dispatch({ t: 'shutter' }));
    const res = fromAction<{ photo?: PhotoId; hit?: PhotoTargetId | null; caption?: string; feedback?: string }>(r);
    if (!r.ok) {
      if (feedback) res.result = { ...(res.result ?? {}), feedback };
      return res;
    }
    res.settle = await rt.settle();
    return res;
  });

  const replay = (rp: ReplayPointId, seg?: SegmentId): Promise<DebugResult<{ seg: SegmentId; index: number; count: number }>> => q('replay', async () => {
    if (typeof rp !== 'string' || (seg !== undefined && seg !== null && typeof seg !== 'string')) return fail('bad_args');
    const point = g.sys.replay.point(rp);
    if (!point) return fail('no_such_target');
    if (seg && !point.segments.includes(seg)) return fail('bad_args');
    const sys = g.sys.replay;
    let feedback: string | null = null;
    if (!sys.active || sys.active.point !== rp) {
      if (sys.active) rt.dispatch({ t: 'present' });
      const p = resolveAimPoint(g, rp);
      if (p) turnTowards(g, p, { face: false });
      rt.syncModel();
      const w = await rt.withFeedback(async () => rt.dispatch({ t: 'rewind' }));
      feedback = w.feedback;
      if (!w.value.ok) {
        const res = fromAction<{ seg: SegmentId; index: number; count: number }>(w.value);
        if (feedback && res.result === undefined) res.result = { feedback } as unknown as { seg: SegmentId; index: number; count: number };
        return res;
      }
    }
    for (let guard = 0; seg && sys.active && sys.active.seg !== seg && guard < point.segments.length; guard++) {
      const r = rt.dispatch({ t: 'rewind' });
      if (!r.ok) return fromAction(r);
    }
    const a = sys.active;
    if (!a || a.point !== rp) {
      // 看着的是别的残影点（离得更近的那个被启动了）：退回现在，不留下一个不相干的回放
      if (a) rt.dispatch({ t: 'present' });
      return fail('not_near_replay_point');
    }
    if (seg && a.seg !== seg) return failWith('locked', { seg: a.seg });
    await g.advance(0);
    const settle = await rt.settle();
    return { ok: true, result: { seg: a.seg, index: a.index, count: a.count }, settle };
  });

  const replaySeek = (t: number): Promise<DebugResult<{ t: number }>> => q('replaySeek', async () => {
    if (!isNum(t)) return fail('bad_args');
    if (!g.sys.replay.active) return fail('mode_disallows');
    g.sys.replay.seek(t);
    // 锁步下人影停在 t：渲一帧给截图/缩略图，不推进时间
    await g.advance(0);
    const settle = await rt.settle();
    return { ok: true, result: { t: round(g.sys.replay.active?.t ?? t) }, settle };
  });

  const replayPlayState = (want: boolean, name: string): Promise<DebugResult> => q(name, async () => {
    const a = g.sys.replay.active;
    if (!a) return fail('mode_disallows');
    if (a.playing !== want) {
      const r = rt.dispatch({ t: 'play' });
      if (!r.ok) return fromAction(r);
    }
    return ok({ playing: g.sys.replay.active?.playing ?? false });
  });

  const replayExit = (): Promise<DebugResult> => q('replayExit', async () => {
    const r = rt.dispatch({ t: 'present' });
    if (!r.ok) return fromAction(r);
    const settle = await rt.settle();
    return { ok: true, result: { mode: g.modes.top }, settle };
  });

  const dlg = (o?: { maxReal?: number }): Promise<DebugResult<{ at: 'choice' | 'await' | 'end'; options?: string[]; mode: ModeId }>> => {
    // queue 会再乘 ?slow=k（显式给的 maxReal 也一样放宽）
    const maxReal = o && isNum(o.maxReal) && o.maxReal > 0 ? o.maxReal : API_TIMEOUT_MS;
    return q('dlg', async () => {
      const r = await rt.dlgLoop();
      return { ...r, settle: rt.settleNow() === 'waiting' ? 'waiting' : 'idle' };
    }, maxReal);
  };

  const choose = (k: number | NameId): Promise<DebugResult<{ chosen: string; feedback?: string }>> => q('choose', async () => {
    if (!(isNum(k) && Number.isInteger(k)) && !(typeof k === 'string' && NAME_SET.has(k))) return fail('bad_args');
    // 称呼面板（k 可为 name.*）
    if (g.modes.top === 'mode.panel_naming') {
      const opts = g.sys.panels.naming?.options ?? [];
      const chosen = typeof k === 'number' ? opts[k - 1] : k;
      if (!chosen || !opts.includes(chosen)) return fail('bad_option');
      const { value: r, feedback } = await rt.withFeedback(async () => {
        const r = rt.dispatch({ t: 'choose', k });
        if (r.ok) await rt.settle();
        return r;
      });
      if (!r.ok) return fromAction(r);
      const res: { chosen: string; feedback?: string } = { chosen };
      if (feedback) res.feedback = feedback;
      return { ok: true, result: res, settle: rt.settleNow() === 'waiting' ? 'waiting' : 'idle' };
    }
    // 对话：停在台词行时先像 dlg() 一样推进到选项
    if (!g.sys.dialogue.active) return fail('no_dialogue');
    const d0 = g.sys.dialogue.active;
    if (d0.typing || d0.options.length === 0) {
      const r = await rt.dlgLoop();
      if (!r.ok) return fail(r.reason === 'timeout' ? 'timeout' : 'no_choice');
      if (r.result?.at !== 'choice') return fail(r.result?.at === 'end' ? 'no_dialogue' : 'no_choice');
    }
    const d = g.sys.dialogue.active;
    if (!d) return fail('no_dialogue');
    if (typeof k !== 'number') return fail('bad_args');
    const label = d.options[k - 1];
    if (label === undefined) return fail('bad_option');
    const { value: r, feedback } = await rt.withFeedback(async () => {
      const r = rt.dispatch({ t: 'choose', k });
      if (r.ok) await rt.settle();
      return r;
    });
    if (!r.ok) return fromAction(r);
    const res: { chosen: string; feedback?: string } = { chosen: label };
    if (feedback) res.feedback = feedback;
    return { ok: true, result: res, settle: rt.settleNow() === 'waiting' ? 'waiting' : 'idle' };
  });

  const input = (code: string): Promise<DebugResult<{ correct: boolean }>> => q('input', async () => {
    if (typeof code !== 'string' || !/^\d+$/.test(code)) return fail('bad_args');
    if (g.modes.top !== 'mode.panel_code' || !g.sys.panels.code) return fail('no_panel');
    // 先清空已输入的位（错误后面板保持打开、已清空；这里防的是手动输到一半）
    for (let i = g.sys.panels.code.entered.length; i > 0; i--) rt.dispatch({ t: 'erase' });
    for (const ch of code) {
      const r = rt.dispatch({ t: 'digit', n: Number(ch) });
      if (!r.ok) return fromAction(r);
    }
    const failsBefore = g.sys.panels.code?.fails ?? 0;
    const { value: r, feedback } = await rt.withFeedback(async () => {
      const r = rt.dispatch({ t: 'confirm' });
      if (r.ok) await rt.settle();
      return r;
    });
    if (!r.ok) return fromAction(r);
    const after = g.sys.panels.code;
    const correct = !(after !== null && g.modes.has('mode.panel_code') && after.fails > failsBefore);
    const res: { correct: boolean; feedback?: string } = { correct };
    if (feedback) res.feedback = feedback;
    return { ok: true, result: res, settle: rt.settleNow() === 'waiting' ? 'waiting' : 'idle' };
  });

  const vcrState = (): { tc: string; playing: boolean; shuttle: number } => ({ tc: g.sys.vcr.tcString(), playing: g.sys.vcr.playing, shuttle: g.sys.vcr.shuttle });

  const vcr = (cmd: 'play' | 'pause' | 'seek' | 'index' | 'shuttle' | 'exit', arg?: string | number): Promise<DebugResult<{ tc: string; playing: boolean; shuttle: number }>> => q('vcr', async () => {
    if (!g.modes.has('mode.panel_vcr')) return fail('mode_disallows');
    const sys = g.sys.vcr;
    switch (cmd) {
      case 'play':
      case 'pause': {
        const want = cmd === 'play';
        if (sys.playing !== want) {
          const r = rt.dispatch({ t: 'play' });
          if (!r.ok) return fromAction(r);
        }
        break;
      }
      case 'seek': {
        const valid = (typeof arg === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(arg)) || isNum(arg);
        if (!valid || arg === undefined) return fail('bad_args');
        sys.seek(arg);
        await g.advance(0);
        break;
      }
      case 'index': {
        const dir = arg === 'next' || arg === 1 ? 1 : arg === 'prev' || arg === -1 ? -1 : 0;
        if (dir === 0) return fail('bad_args');
        const r = rt.dispatch({ t: 'index', dir });
        if (!r.ok) return fromAction(r);
        break;
      }
      case 'shuttle': {
        if (arg !== -1 && arg !== 0 && arg !== 1) return fail('bad_args');
        const held: -1 | 0 | 1 = sys.shuttle > 0 ? 1 : sys.shuttle < 0 ? -1 : 0;
        // 先松开另一个方向（或 0 = 松开）
        if (held !== 0 && held !== arg) {
          const r = rt.dispatch({ t: 'shuttle', dir: held, down: false });
          if (!r.ok) return fromAction(r);
        }
        if (arg !== 0 && held !== arg) {
          const r = rt.dispatch({ t: 'shuttle', dir: arg, down: true });
          if (!r.ok) return fromAction(r);
        }
        break;
      }
      case 'exit': {
        const r = rt.dispatch({ t: 'back' });
        if (!r.ok) return fromAction(r);
        break;
      }
      default:
        return fail('bad_args');
    }
    const settle = await rt.settle();
    return { ok: true, result: vcrState(), settle };
  });

  const consoleFn = (ch: 1 | 2 | 3 | 4 | 5 | 'exit'): Promise<DebugResult<{ channel: number }>> => q('console', async () => {
    if (ch !== 'exit' && !(isNum(ch) && Number.isInteger(ch) && ch >= 1 && ch <= 5)) return fail('bad_args');
    if (!g.modes.has('mode.panel_console')) return fail('mode_disallows');
    const r = rt.dispatch(ch === 'exit' ? { t: 'back' } : { t: 'digit', n: ch });
    if (!r.ok) return fromAction(r);
    const settle = await rt.settle();
    return { ok: true, result: { channel: g.sys.cctv.channel }, settle };
  });

  const tripod = (cmd: 'start' | 'cancel'): Promise<DebugResult<{ state: string }>> => q('tripod', async () => {
    if (cmd !== 'start' && cmd !== 'cancel') return fail('bad_args');
    if (g.modes.top !== 'mode.tripod') return fail('mode_disallows');
    const { value: r, feedback } = await rt.withFeedback(async () => rt.dispatch(cmd === 'start' ? { t: 'shutter' } : { t: 'interact' }));
    if (!r.ok) {
      const res = fromAction<{ state: string }>(r);
      if (feedback && res.result === undefined) res.result = { state: g.sys.tripod.state, feedback } as { state: string };
      return res;
    }
    const settle = await rt.settle();
    return { ok: true, result: { state: g.sys.tripod.state }, settle };
  });

  const api: DebugApi = {
    state,
    getState: state,

    newGame: () => q('newGame', async () => {
      await g.ui.menus.select('new');
      const settle = await rt.settle();
      return { ok: true, result: { area: g.areas.current?.def.id ?? g.state.area, mode: g.modes.top }, settle };
    }),

    continueGame: (slot = 'save.auto') => q('continueGame', async () => {
      if (slot !== 'save.auto' && slot !== 'save.yin') return fail('bad_args');
      if (!g.save.has(slot)) return fail('no_such_target');
      await g.ui.menus.select(slot === 'save.yin' ? 'yin' : 'continue');
      const settle = await rt.settle();
      const cur = g.areas.current;
      if (!cur) return fail('not_present');
      return { ok: true, result: { area: cur.def.id, mode: g.modes.top }, settle };
    }),

    reload: () => q('reload', async () => {
      if (rt.busyMode() || g.modes.isTransient() || g.save.held) return fail('busy');
      const cur0 = g.areas.current;
      // dev 沙盒不存档：这里读档会读回别的区域的旧存档，直接拒绝
      if (cur0?.def.id === 'dev') return fail('mode_disallows');
      g.save.flushIfSafe();
      if (!g.save.has('save.auto')) return fail('no_such_target');
      await g.ui.menus.select('continue');
      const settle = await rt.settle();
      const cur = g.areas.current;
      if (!cur) return fail('not_present');
      return { ok: true, result: { area: cur.def.id, spawn: cur.spawnUsed }, settle };
    }),

    goto: gotoFn,
    teleport: gotoFn,

    walk: (x, z) => q('walk', async () => {
      if (!isNum(x) || !isNum(z)) return fail('bad_args');
      if (g.modes.moveMode() === 'none') return fail('mode_disallows');
      const r = await walkTo(g, x, z);
      const pos: [number, number, number] = [round(r.pos[0]), round(r.pos[1]), round(r.pos[2])];
      return r.ok ? ok({ pos }) : fail('blocked', { pos });
    }),

    listInteractables: () => q('listInteractables', async () => ok(g.sys.interaction.list().map(s => ({ ...s })))),

    focused: () => q('focused', async () => ok(g.sys.interaction.focused)),

    interact,
    show,
    showItem: show,
    use,
    useItem: use,

    readDoc: doc => q('readDoc', async () => {
      if (typeof doc !== 'string') return fail('bad_args');
      // 先判“属于身上的物品”（ARCH §6.16：否则 not_owned），再判文档是否已由区域登记
      if (docOwnerItem(doc) === undefined && !g.sys.journal.doc(doc)) return fail('no_such_target');
      const owned = g.state.listItems().some(e => itemDocs(e.id).includes(doc));
      if (!owned) return fail('not_owned');
      if (!g.sys.journal.doc(doc)) return fail('no_such_target');
      const vfOn = g.modes.has('mode.viewfinder');
      const depth = g.modes.stack.length;
      const a = rt.dispatch({ t: 'album' });
      if (!a.ok) return fromAction(a);
      const o = g.sys.journal.openDoc(doc, { vf: vfOn });
      let text: string | null = null;
      if (o.ok) text = g.sys.journal.renderDoc(doc, vfOn);
      // 合上：一路 back 回到调用前的栈深
      for (let i = 0; i < 4 && g.modes.stack.length > depth; i++) rt.dispatch({ t: 'back' });
      if (!o.ok || text === null) return fromAction(o);
      return ok({ text, vf: vfOn });
    }),

    vf,
    setViewfinder: vf,
    lens,
    setLensMode: lens,
    zoom,
    aimAt,
    shoot,
    takePhoto: shoot,
    replay,
    replaySeek,
    replayPause: () => replayPlayState(false, 'replayPause'),
    replayPlay: () => replayPlayState(true, 'replayPlay'),
    replayExit,
    dlg,
    advanceDialogue: dlg,
    choose,
    chooseDialogOption: choose,
    input,
    enterCode: input,
    vcr,
    console: consoleFn,
    tripod,

    bodyGoto: (x, z) => q('bodyGoto', async () => {
      if (!isNum(x) || !isNum(z)) return fail('bad_args');
      if (g.modes.top !== 'mode.tripod') return fail('mode_disallows');
      const r = g.sys.tripod.bodyGoto(x, z);
      return r.ok ? { ...r, result: { state: g.sys.tripod.state } } : r;
    }),

    back: () => q('back', async () => {
      const r = rt.dispatch({ t: 'back' });
      if (!r.ok) return fromAction(r);
      const settle = await rt.settle();
      return { ok: true, result: { mode: g.modes.top }, settle };
    }),

    hint: () => q('hint', async () => {
      const { value: r, feedback } = await rt.withFeedback(async () => rt.dispatch({ t: 'hint' }));
      const res = fromAction<HintOutcome>(r);
      if (r.ok && res.result === undefined && feedback) res.result = { puzzle: null, level: 1, text: feedback };
      return res;
    }),

    wait: sec => q('wait', async () => {
      if (!isNum(sec) || sec < 0) return fail('bad_args');
      if (g.modes.freezesWorld()) return fail('mode_disallows');
      await g.advance(Math.min(sec, 30));
      return { ok: true, result: { time: round(g.time) }, settle: rt.settleNow() === 'waiting' ? 'waiting' : 'idle' };
    }),

    setTimeScale: k => q('setTimeScale', async () => {
      if (!isNum(k) || k <= 0 || k > 100) return fail('bad_args');
      g.timeScale = k;
      return ok({ timeScale: k });
    }),

    frame: (n = 1) => q('frame', async () => {
      if (!isNum(n) || !Number.isInteger(n) || n < 1 || n > 600) return fail('bad_args');
      for (let i = 0; i < n; i++) await g.nextFrame();
      return ok({ frameNo: g.frameNo });
    }),

    lint: () => q('lint', async () => ok({ issues: lintGame(g) })),

    perf: () => q('perf', async () => {
      // M1d：辅助 RT（镜面、CH2、录像带）按帧号节流、彼此错开，单帧采样会随奇偶漏掉它们——连采一个完整周期
      // （lcm(mirrorEvery, feedEvery)，不超过 12 帧），draw call 与三角面报最大值
      const qs = QUALITY[g.settings.quality];
      const n = Math.min(12, lcm(Math.max(1, qs.mirrorEvery), Math.max(1, qs.feedEvery)));
      const info = g.renderer.info;
      let calls = 0, callsMain = 0, tris = 0, sum = 0;
      for (let i = 0; i < n; i++) {
        await g.nextFrame();
        // 主场景的 draw call 与三角面取自这一帧的 RenderPass（RenderPipeline.stats()，M1c；engine-wp1.md #2、engine-wp3.md #3）
        const st = g.pipeline.stats();
        calls = Math.max(calls, info.render.calls);
        sum += info.render.calls;
        callsMain = Math.max(callsMain, st.callsMain);
        tris = Math.max(tris, info.render.triangles, st.trisMain);
      }
      const st = g.pipeline.stats();
      return ok({
        fps: rt.fps(), calls, callsMain, tris,
        geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0,
        lights: st.lights, lightsOn: st.lightsOn, renderScale: round(st.renderScale),
        callsMean: Math.round(sum / n), frames: n, canvasMB: round(canvasBytesInScene(g.scene) / (1024 * 1024)),
        octreeNodes: g.collision.octreeNodes(),
      });
    }),
  };

  if (g.url.debug) addDebugOnly(api, rt, q);
  return api;
}

type Queue = <T>(name: string, fn: () => Promise<DebugResult<T>>, timeoutMs?: number) => Promise<DebugResult<T>>;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/** 场景里（含区域与主角）材质引用到的、以画布为图像的贴图总字节（w×h×4，每张只算一次；M1d，§13.3）。 */
function canvasBytesInScene(scene: THREE.Object3D): number {
  const seen = new Set<THREE.Texture>();
  let bytes = 0;
  const addTex = (t: unknown): void => {
    const tex = t as THREE.Texture | null | undefined;
    if (!tex || tex.isTexture !== true || seen.has(tex)) return;
    seen.add(tex);
    const img = tex.image as { width?: number; height?: number } | null | undefined;
    const isCanvas = (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement)
      || (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas);
    if (isCanvas && img) bytes += (img.width ?? 0) * (img.height ?? 0) * 4;
  };
  scene.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const mm of Array.isArray(m) ? m : m ? [m] : []) {
      for (const v of Object.values(mm)) addTex(v);
      const u = (mm as THREE.ShaderMaterial).uniforms;
      if (u) for (const x of Object.values(u)) addTex(x?.value);
    }
  });
  return bytes;
}

/** 校验 debugSet 的补丁：只收已登记的 id，数值只给数值 flag（ARCH §6.1；非法输入返回 bad_args 而不是让 debugSet 在 dev 下抛错）。 */
function validatePatch(p: DebugStatePatch): string | null {
  if (p.flags !== undefined) {
    if (typeof p.flags !== 'object' || p.flags === null) return 'flags';
    for (const [k, v] of Object.entries(p.flags)) {
      if (!FLAG_SET.has(k)) return `flag ${k}`;
      if (typeof v === 'number' ? !NUMERIC_FLAGS.has(k as FlagId) || !Number.isFinite(v) || v < 0 : typeof v !== 'boolean') return `flag ${k}=${String(v)}`;
    }
  }
  if (p.items !== undefined) {
    if (!Array.isArray(p.items)) return 'items';
    for (const it of p.items) {
      const id = typeof it === 'string' ? it : it?.id;
      if (typeof id !== 'string' || !ITEM_SET.has(id)) return `item ${String(id)}`;
      if (typeof it !== 'string' && typeof it.used !== 'boolean') return `item ${id}.used`;
    }
  }
  if (p.photos !== undefined) {
    if (!Array.isArray(p.photos)) return 'photos';
    for (const id of p.photos) if (typeof id !== 'string' || !KEY_PHOTO_SET.has(id)) return `photo ${String(id)}`;
  }
  if (p.area !== undefined && !isAreaKey(p.area)) return `area ${String(p.area)}`;
  if (p.spawn !== undefined && typeof p.spawn !== 'string') return 'spawn';
  return null;
}

/**
 * 写入补丁之后的收尾：NPC 站位重算；时辰推导值变了就让钟点从新时辰起点走（debugSet 不发 'flag'，ARCH §6.1）；
 * 标记存档脏（debugSet 不经 setFlag，不会自己 request），这样预置之后的 reload() 读回的是预置后的状态。
 */
function afterDebugSet(g: Game, before: Shichen): void {
  g.sys.npc.reevaluate();
  if (g.state.shichen !== before) g.sys.shichen.resetClock();
  g.save.request('manual');
}

function addDebugOnly(api: DebugApi, rt: DebugRuntime, q: Queue): void {
  const g = rt.game;

  api.setFlags = flags => q('setFlags', async (): Promise<DebugResult> => {
    const bad = validatePatch({ flags });
    if (bad) return fail('bad_args', { bad });
    const before = g.state.shichen;
    g.state.debugSet({ flags });
    afterDebugSet(g, before);
    return ok({ flags: { ...g.state.listFlags() } });
  });

  api.giveItem = id => q('giveItem', async (): Promise<DebugResult> => {
    if (typeof id !== 'string' || !ITEM_SET.has(id)) return fail('bad_args');
    g.state.debugSet({ items: [id] });
    g.save.request('manual');
    return ok({ id });
  });

  api.givePhoto = id => q('givePhoto', async (): Promise<DebugResult> => {
    if (typeof id !== 'string' || !KEY_PHOTO_SET.has(id)) return fail('bad_args');
    g.state.debugSet({ photos: [id as KeyPhotoId] });
    g.save.request('manual');
    return ok({ id });
  });

  api.setState = p => q('setState', async (): Promise<DebugResult> => {
    if (typeof p !== 'object' || p === null) return fail('bad_args');
    const bad = validatePatch(p);
    if (bad) return fail('bad_args', { bad });
    if (rt.busyMode()) return fail('busy');
    let area: AreaKey | undefined = p.area;
    let spawn: SpawnId | undefined = p.spawn;
    if (spawn !== undefined) {
      let owner: AreaKey;
      try {
        owner = g.areas.spawnArea(spawn);
      } catch {
        return fail('bad_args', { bad: `spawn ${spawn}` });
      }
      if (area !== undefined && owner !== area) return fail('bad_args', { bad: `spawn ${spawn} 不属于 ${area}` });
      area = owner;
    } else if (area !== undefined) {
      const def = g.areas.defs.get(area);
      spawn = def ? (Object.keys(def.spawns)[0] as SpawnId | undefined) : undefined;
      if (!spawn) return fail('bad_args', { bad: `area ${area} 没有出生点` });
    }
    const before = g.state.shichen;
    const patch: { flags?: Record<string, boolean | number>; items?: (ItemId | { id: ItemId; used: boolean })[]; photos?: PhotoId[] } = {};
    if (p.flags) patch.flags = p.flags;
    if (p.items) patch.items = p.items;
    if (p.photos) patch.photos = p.photos;
    g.state.debugSet(patch);
    if (area !== undefined && spawn !== undefined) {
      if (g.state.shichen !== before) g.sys.shichen.resetClock();
      g.save.request('manual');
      await g.areas.enter(area, spawn, { reason: 'debug' });
    } else {
      afterDebugSet(g, before);
    }
    const settle = await rt.settle();
    const cur = g.areas.current;
    return { ok: true, result: { area: cur?.def.id ?? null, spawn: cur?.spawnUsed ?? null, mode: g.modes.top }, settle };
  });

  api.shot = (area, shotId) => q('shot', async () => {
    if (!isAreaKey(area) || typeof shotId !== 'string') return fail('bad_args');
    return runShot(g, area, shotId, rt.overlay);
  }, LONG_TIMEOUT_MS);

  api.selftest = name => q('selftest', async () => {
    if (typeof name !== 'string') return fail('bad_args');
    return runSelftest(g, name);
  }, LONG_TIMEOUT_MS);

  api.selftests = () => q('selftests', async () => ok(listSelftests()));
}

// ==================================================================== 挂载

/** Game.boot() 之后由 main.ts 调用：构造 API、挂到 window.__game 与 window.__cam（M1a 补写）。 */
export function mountDebugApi(game: Game): DebugApi {
  const rt = new DebugRuntime(game);
  if (game.url.debug) rt.overlay = mountOverlay(game);
  const api = buildApi(rt);
  window.__game = api;
  window.__cam = api;
  // M4：?debug=1 时另挂原始 Game（只给截图探针直接驱动 UI 用，例如在对话框开着时补一条字幕看分层避让；测试断言仍走 __game）
  if (game.url.debug) (window as unknown as { __cmGame?: Game }).__cmGame = game;
  return api;
}
