// owner: WP4
// Effect、E 构造器（M1a 已实现）、EffectRunner（可重入、settle 与取消语义）、GameApi（ARCH §6.3）。
//
// 实现要点（WP4）：
// - 执行器是“续延式”（CPS）的：同步的 Effect 一口气做完；wait 在 pump(dt) 里到点后**同步**接着往下做，
//   对话/过场结束时也同步回调。原因：锁步下 Game.advance() 每 30 步才让出一次宏任务（ARCH §3.4），
//   若用 async/await 串接，wait 之后的 Effect 要等到下一次让出才执行，计时会被量化成 1 秒。
//   只有 Handler 函数（区域写的 async g => …）与公开的 run()/runHandler() 返回值走 Promise。
// - 顶层 run（无 scope）排队、一次只跑一个；带 scope 的嵌套 run 立即内联（ARCH §6.3 可重入）。
//   DialogueSystem.start / CutsceneSystem.play 在没有 scope 时同样作为顶层 run 排队（Game.newGame 直接调 play 也算 busy）。
// - 取消：cancelAll 把所有执行中的 scope 标记为取消；阻塞中的 wait/对话/过场立即以 'cancelled' 结束，
//   同一列表里后面的 Effect 丢弃；绑定到已取消 scope 的 GameApi 写方法变空操作（dev 下 devWarn）。
//   cancelAll 不弹模式：调用方（ModeStack.resetTo、AreaManager.enter）随后逐层 exit。
// - waitingInput 现算：最内层对话停在台词/选项、过场停在 await、或栈上有面板（panel_*）、或某个 run 打开的文档阅读器/巡夜本还开着（M3）。

import type * as THREE from 'three';
import type { ApiResult, Awaitable, LensMode, ModeId, Pose, Settle, V3, ZoomLevel } from '../core/types';
import type {
  CutsceneId, DialogueId, DocId, ExitId, FlagId, InteractId, ItemId, KeyPhotoId, PhotoId, ReplayPointId, SegmentId, SpeakerId,
} from '../data/ids';
import { F } from '../data/ids';
import { TIMING } from '../data/time';
import { isNarration } from '../data/speakers';
import type { Game } from '../core/game';
import type { PhotoRecord, StateView } from './state';
import type { Settings } from './settings';
import type { VcrSystem } from './vcr';
import type { ConsoleSystem } from './cctv';
import type { TripodSystem } from './tripod';
import type { PhotoSystem } from './photo';
import type { HintSystem } from './hints';
import type { FxParams } from '../fx/post';
import type { MusicCue, SfxCue } from '../audio/engine';
import { devWarn } from '../core/log';

export type Effect =
  | { do: 'flag'; id: FlagId; value?: true | number }
  /** 获得物品 */
  | { do: 'item'; id: ItemId }
  /** 标记已用 */
  | { do: 'used'; id: ItemId }
  /** 获得实物照片（或非判定照片） */
  | { do: 'photo'; id: KeyPhotoId; caption?: string }
  /** 字幕/旁白/画外音（非阻塞，不进入 dialogue 模式、不打断回放；dur 默认按字数 0.12s/字，最少 2s） */
  | { do: 'say'; text: string; who?: SpeakerId; dur?: number }
  /** 交互反馈条（非阻塞） */
  | { do: 'feedback'; text: string }
  /** 阻塞到对话结束（或被取消） */
  | { do: 'dialogue'; id: DialogueId }
  /** 阻塞到过场结束（或被取消） */
  | { do: 'cutscene'; id: CutsceneId }
  /** 巡夜本“已知线索” */
  | { do: 'clue'; text: string }
  | { do: 'seen'; key: string }
  | { do: 'sfx'; cue: SfxCue; at?: V3 }
  | { do: 'music'; cue: MusicCue }
  /** 教学提示（如“右键：用你的眼睛看”），每条只出现一次 */
  | { do: 'tutorial'; text: string }
  /** 立即（或在回到安全模式时）写寅时槽 */
  | { do: 'save'; slot: 'save.yin' }
  /** 游戏时间 */
  | { do: 'wait'; sec: number }
  /** 结局播完（= GameApi.endingDone） */
  | { do: 'ending'; kind: 'main' | 'nanke' }
  /** M3 补写：打开文档阅读器（= JournalSystem.openDoc；vf 缺省 = 栈上有取景器），阻塞到阅读器合上（墙上文档、规矩牌这类不属于物品的文档） */
  | { do: 'doc'; id: DocId; vf?: boolean }
  /** M3 补写：翻开巡夜本（= JournalSystem.openJournal），阻塞到合上（R1 开场拾取巡夜本时自动翻开） */
  | { do: 'journal' }
  /** 逃生口 */
  | { do: 'call'; fn: (g: GameApi) => Awaitable<unknown> };

/** 交互物/选项等处可用效果列表或函数。函数的返回值被 await 后丢弃（可以直接写 g => g.cctv.open()）。 */
export type Handler = readonly Effect[] | ((g: GameApi) => Awaitable<unknown>);

export const E = {
  flag: (id: FlagId, value?: true | number): Effect => (value === undefined ? { do: 'flag', id } : { do: 'flag', id, value }),
  item: (id: ItemId): Effect => ({ do: 'item', id }),
  used: (id: ItemId): Effect => ({ do: 'used', id }),
  photo: (id: KeyPhotoId, caption?: string): Effect => (caption === undefined ? { do: 'photo', id } : { do: 'photo', id, caption }),
  say: (text: string, who?: SpeakerId, dur?: number): Effect => {
    const e: { do: 'say'; text: string; who?: SpeakerId; dur?: number } = { do: 'say', text };
    if (who !== undefined) e.who = who;
    if (dur !== undefined) e.dur = dur;
    return e;
  },
  feedback: (text: string): Effect => ({ do: 'feedback', text }),
  dialogue: (id: DialogueId): Effect => ({ do: 'dialogue', id }),
  cutscene: (id: CutsceneId): Effect => ({ do: 'cutscene', id }),
  clue: (text: string): Effect => ({ do: 'clue', text }),
  seen: (key: string): Effect => ({ do: 'seen', key }),
  sfx: (cue: SfxCue, at?: V3): Effect => (at === undefined ? { do: 'sfx', cue } : { do: 'sfx', cue, at }),
  music: (cue: MusicCue): Effect => ({ do: 'music', cue }),
  tutorial: (text: string): Effect => ({ do: 'tutorial', text }),
  save: (slot: 'save.yin'): Effect => ({ do: 'save', slot }),
  wait: (sec: number): Effect => ({ do: 'wait', sec }),
  ending: (kind: 'main' | 'nanke'): Effect => ({ do: 'ending', kind }),
  doc: (id: DocId, vf?: boolean): Effect => (vf === undefined ? { do: 'doc', id } : { do: 'doc', id, vf }),
  journal: (): Effect => ({ do: 'journal' }),
  call: (fn: (g: GameApi) => Awaitable<unknown>): Effect => ({ do: 'call', fn }),
} as const;

export type RunOutcome = 'done' | 'cancelled';

export interface RunScope {
  /** 'interact:r3.bell'、'dialogue:dlg.r3.lu_slip'、'cutscene:cs.r1.dawn'… */
  readonly origin: string;
  readonly parent: RunScope | null;
  readonly cancelled: boolean;
}

/** WP4 内部：Runner 创建的 scope。取消沿父链传递（子 scope 的 cancelled 读父链）。 */
export class ScopeImpl implements RunScope {
  private own = false;
  constructor(readonly origin: string, readonly parent: RunScope | null) {}
  get cancelled(): boolean {
    return this.own || (this.parent !== null && this.parent.cancelled);
  }
  cancel(): void {
    this.own = true;
  }
}

/** WP4 内部：续延（每个异步点恰好调用一次）。 */
export type Cont = (o: RunOutcome) => void;
/** WP4 内部：在给定 scope 里执行、结束时调用 done 的一段工作。 */
type Job = (scope: ScopeImpl, done: Cont) => void;

interface Queued { origin: string; job: Job; cb: Cont }
interface Waiter { left: number; scope: ScopeImpl; cont: Cont }

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';

/** M4：阅读用的字数（“……”“——”各算 1 个字）。 */
export function readLen(text: string): number {
  return [...text.replace(/…+/g, '…').replace(/—+/g, '—')].length;
}
/** M4：字幕在屏幕上的停留（每字 0.17 秒、最少 2.5 秒；只管显示）。 */
export function readSec(text: string): number {
  return Math.max(TIMING.subReadMinSec, readLen(text) * TIMING.subReadSecPerChar);
}

/** 字幕时长默认值（GDD §3.3 / data/time.ts：0.12 秒/字，最少 2 秒）。 */
export function sayDuration(text: string, dur?: number): number {
  return dur ?? Math.max(TIMING.sayMinSec, [...text].length * TIMING.saySecPerChar);
}

/**
 * 出一条字幕（E.say、过场 say、提示共用）：UI 字幕 + 含糊人声。WP4 内部。
 * 'feedback' 事件由 `UI.subtitle` 发（带 speaker；与 `UI.toast` 同一约定，ARCH §7），这里不再重复发（M1c，engine-wp4.md #3 / engine-wp6.md #8）。
 */
export function speak(game: Game, text: string, who: SpeakerId | '' = '', dur?: number, kind?: 'hint'): void {
  const d = sayDuration(text, dur);
  // M4：字幕按阅读速度多停一会儿（过场节拍仍按 sayDuration）。M4 第 2 轮：显式给了时长的也不短于阅读时间（只影响显示）
  const show = Math.max(dur ?? d, readSec(text));
  if (kind) game.ui.subtitle(text, who, show, { kind });
  else game.ui.subtitle(text, who, show);
  if (who !== '' && !isNarration(who)) game.audio.murmur(who, d);
}

export class EffectRunner {
  protected readonly game: Game;
  private readonly queue: Queued[] = [];
  private current: ScopeImpl | null = null;
  private inflight = 0;
  private readonly active = new Set<ScopeImpl>();
  private waits: Waiter[] = [];
  private settleWaiters: ((s: Settle) => void)[] = [];
  /** 由 run 打开、还没合上的文档阅读器/巡夜本（E.doc / E.journal / GameApi.openDoc；M3） */
  private readersOpen = 0;

  constructor(game: Game) {
    this.game = game;
    // 面板打开/关闭、对话模式进出都会改变 waitingInput
    game.events.on('mode', () => this.checkSettle());
  }

  /** 顶层调用（无 scope）：若已有顶层 run 在执行就排队。嵌套调用（传入 scope，或经由 scope 化的 GameApi 发起）：立即内联执行，不排队。 */
  run(list: readonly Effect[] | undefined, origin: string, scope?: RunScope): Promise<RunOutcome> {
    return new Promise(resolve => this.runCps(list, origin, scope, resolve));
  }
  /** Handler 为函数时传给它一个绑定到新子 scope 的 GameApi */
  runHandler(h: Handler | undefined, origin: string, scope?: RunScope): Promise<RunOutcome> {
    return new Promise(resolve => this.runHandlerCps(h, origin, scope, resolve));
  }
  /** 有未完成的顶层 run（含它内联的嵌套） */
  get busy(): boolean {
    return this.current !== null || this.queue.length > 0 || this.inflight > 0;
  }
  /** 当前阻塞点在等玩家：对话行或选项、过场 await、面板已打开 */
  get waitingInput(): boolean {
    const sys = this.game.sys;
    if (sys.dialogue.isWaitingInput()) return true;
    if (sys.cutscene.isWaitingInput()) return true;
    const m = this.game.modes;
    if (this.readersOpen > 0 && m.has('mode.journal')) return true;
    return m.has('mode.panel_code') || m.has('mode.panel_naming') || m.has('mode.panel_vcr') || m.has('mode.panel_console');
  }
  /** busy 为假 → 'idle'；waitingInput 为真 → 'waiting'；否则等到二者之一 */
  settled(): Promise<Settle> {
    const s = this.settleNow();
    if (s) return Promise.resolve(s);
    return new Promise(resolve => this.settleWaiters.push(resolve));
  }
  /** 见 ARCH §6.3“取消语义” */
  cancelAll(_reason: 'reset' | 'area'): void {
    if (this.active.size === 0) return;
    for (const s of this.active) s.cancel();
    const conts: Cont[] = [];
    this.waits = this.waits.filter(w => {
      if (!w.scope.cancelled) return true;
      conts.push(w.cont);
      return false;
    });
    // 先把阻塞中的对话/过场以 cancelled 结束（它们各自回调所在列表），再放行 wait
    this.game.sys.dialogue.cancelRuns(s => s.cancelled);
    this.game.sys.cutscene.cancelRuns(s => s.cancelled);
    for (const c of conts) c('cancelled');
    this.checkSettle();
  }
  /** 推进异步 Effect 队列（wait 等游戏时间计时；ARCH §3.2 第 8 步） */
  pump(dt: number): void {
    if (this.waits.length) {
      const due: Waiter[] = [];
      this.waits = this.waits.filter(w => {
        w.left -= dt;
        if (w.left > 1e-6) return true;
        due.push(w);
        return false;
      });
      for (const w of due) w.cont(w.scope.cancelled ? 'cancelled' : 'done');
    }
    this.checkSettle();
  }

  // ——————————————————————————————— WP4 内部（dialogue/cutscene/interaction/panels 用；非冻结签名）

  /** 当前是否已 settle（不等待）。 */
  settleNow(): Settle | null {
    if (!this.busy) return 'idle';
    if (this.waitingInput) return 'waiting';
    return null;
  }
  /** 状态变化后检查 settle 等待者（对话出字、过场 await、run 结束时调用）。 */
  checkSettle(): void {
    if (!this.settleWaiters.length) return;
    const s = this.settleNow();
    if (!s) return;
    const ws = this.settleWaiters;
    this.settleWaiters = [];
    for (const w of ws) w(s);
  }
  /**
   * 打开阅读器（文档或巡夜本）并等它合上（M3，E.doc / E.journal / GameApi.openDoc 共用）：push 失败立即以失败结果回调；
   * 成功时压进去的那一层 mode.journal 离开栈（Esc 合上、模式重置、切区域）才回调。等待期间 waitingInput 为真（settle 'waiting'，同面板）。
   */
  readerCps(open: () => ApiResult, cont: (r: ApiResult) => void): void {
    const modes = this.game.modes;
    const depth = modes.stack.length;
    this.readersOpen++;
    let r: ApiResult;
    try {
      r = open();
    } catch (err) {
      this.readersOpen--;
      throw err;
    }
    const st = modes.stack;
    if (!r.ok || st.length <= depth || st[depth] !== 'mode.journal') {
      this.readersOpen--;
      this.checkSettle();
      cont(r);
      return;
    }
    const off = this.game.events.on('mode', () => {
      const now = modes.stack;
      if (now.length > depth && now[depth] === 'mode.journal') return;
      off();
      this.readersOpen--;
      cont(r);
      this.checkSettle();
    });
    this.checkSettle();
  }
  /** run() 的续延版：同步能做完就同步回调。 */
  runCps(list: readonly Effect[] | undefined, origin: string, scope: RunScope | undefined, cb: Cont): void {
    this.schedule(origin, scope, (s, done) => this.execList(list ?? [], s, done), cb);
  }
  /** runHandler() 的续延版。 */
  runHandlerCps(h: Handler | undefined, origin: string, scope: RunScope | undefined, cb: Cont): void {
    if (h === undefined) {
      cb(scope?.cancelled ? 'cancelled' : 'done');
      return;
    }
    if (typeof h !== 'function') {
      this.runCps(h, origin, scope, cb);
      return;
    }
    this.schedule(origin, scope, (s, done) => this.callFn(h, s, done), cb);
  }
  /** 任意工作（对话、过场本身）按顶层/嵌套规则调度：无 scope 排队，有 scope 内联。 */
  schedule(origin: string, scope: RunScope | undefined, job: Job, cb: Cont): void {
    if (scope === undefined) {
      this.queue.push({ origin, job, cb });
      this.drain();
      return;
    }
    if (scope.cancelled) {
      cb('cancelled');
      return;
    }
    const child = new ScopeImpl(origin, scope);
    this.active.add(child);
    this.inflight++;
    this.safeJob(job, child, o => {
      this.active.delete(child);
      this.inflight--;
      cb(o);
      this.checkSettle();
    });
  }

  private drain(): void {
    if (this.current !== null) return;
    const q = this.queue.shift();
    if (!q) return;
    const root = new ScopeImpl(q.origin, null);
    this.current = root;
    this.active.add(root);
    this.safeJob(q.job, root, o => {
      this.active.delete(root);
      if (this.current === root) this.current = null;
      q.cb(o);
      this.drain();
      this.checkSettle();
    });
  }

  /** 保证 done 恰好调用一次；同步抛错记 console.error 并按 done 结束（不让一条坏 Effect 卡死整个队列）。 */
  private safeJob(job: Job, scope: ScopeImpl, done: Cont): void {
    let called = false;
    const once: Cont = o => {
      if (called) return;
      called = true;
      done(o);
    };
    try {
      job(scope, once);
    } catch (err) {
      console.error(`[effects] ${scope.origin} 执行出错`, err);
      once(scope.cancelled ? 'cancelled' : 'done');
    }
  }

  private callFn(fn: (g: GameApi) => Awaitable<unknown>, scope: ScopeImpl, done: Cont): void {
    const api = createGameApi(this.game, scope);
    let r: unknown;
    try {
      r = fn(api);
    } catch (err) {
      console.error(`[effects] ${scope.origin} 的 Handler 抛错`, err);
      done(scope.cancelled ? 'cancelled' : 'done');
      return;
    }
    if (isThenable(r)) {
      r.then(
        () => done(scope.cancelled ? 'cancelled' : 'done'),
        err => {
          console.error(`[effects] ${scope.origin} 的 Handler 抛错`, err);
          done(scope.cancelled ? 'cancelled' : 'done');
        },
      );
    } else {
      done(scope.cancelled ? 'cancelled' : 'done');
    }
  }

  /** 顺序执行效果列表：同步效果一口气做完；异步效果的续延到来时（可能在 pump 或输入回调里）同步继续。 */
  private execList(list: readonly Effect[], scope: ScopeImpl, done: Cont): void {
    let i = 0;
    const step = (): void => {
      while (i < list.length && !scope.cancelled) {
        const e = list[i++]!;
        let returned = false;
        let finishedSync = false;
        this.execEffect(e, scope, () => {
          if (!returned) {
            finishedSync = true;
            return;
          }
          step();
        });
        returned = true;
        if (!finishedSync) return;   // 等续延
      }
      done(scope.cancelled ? 'cancelled' : 'done');
    };
    step();
  }

  /** 执行一个 Effect；完成时恰好调用一次 cont（可以同步调用）。 */
  private execEffect(e: Effect, scope: ScopeImpl, cont: () => void): void {
    const g = this.game;
    switch (e.do) {
      case 'flag':
        g.state.setFlag(e.id, e.value);
        break;
      case 'item':
        g.state.giveItem(e.id);
        break;
      case 'used':
        g.state.markUsed(e.id);
        break;
      case 'photo':
        g.sys.photo.award(e.id, e.caption === undefined ? undefined : { caption: e.caption });
        break;
      case 'say':
        speak(g, e.text, e.who ?? '', e.dur);
        break;
      case 'feedback':
        g.ui.toast(e.text, 'feedback');
        break;
      case 'dialogue':
        g.sys.dialogue.startCps(e.id, scope, () => cont());
        return;
      case 'cutscene':
        g.sys.cutscene.playCps(e.id, scope, () => cont());
        return;
      case 'clue':
        g.state.addClue(e.text);
        break;
      case 'seen':
        g.state.markSeen(e.key);
        break;
      case 'sfx':
        g.audio.sfx(e.cue, e.at === undefined ? undefined : { at: e.at });
        break;
      case 'music':
        g.audio.music(e.cue);
        break;
      case 'tutorial': {
        const key = `tutorial:${e.text}`;
        if (!g.state.seen(key)) {
          g.state.markSeen(key);
          // M4 第 2 轮：教学条等“风平浪静”（过场、对话、面板都结束 0.5 秒）再显示（UI.tutorial）；只有 toast 的简化 UI（node 自测）照旧
          const ui = g.ui as { tutorial?: (t: string) => void };
          if (typeof ui.tutorial === 'function') ui.tutorial(e.text);
          else g.ui.toast(e.text, 'tutorial');
        }
        break;
      }
      case 'save':
        g.save.requestSlot(e.slot);
        break;
      case 'wait':
        if (e.sec > 0) {
          this.waits.push({ left: e.sec, scope, cont: () => cont() });
          return;
        }
        break;
      case 'ending':
        endingDone(g, e.kind);
        break;
      case 'doc': {
        const vf = e.vf;
        this.readerCps(() => g.sys.journal.openDoc(e.id, vf === undefined ? undefined : { vf }), () => cont());
        return;
      }
      case 'journal':
        this.readerCps(() => g.sys.journal.openJournal(), () => cont());
        return;
      case 'call':
        this.callFn(e.fn, scope, () => cont());
        return;
    }
    cont();
  }
}

/**
 * 结局播完（GameApi.endingDone 与 E.ending 共用，ARCH §6.3、§6.4）。
 * 写通关标记的那一次（main 且没有南柯，或 nanke）还安排回标题（M1d）：等当前 run 与过场结束、runner 空闲后，
 * 引擎淡出、卸载区域、显示标题菜单（只剩“从寅时重来”与“新游戏”，Game.toTitle）。
 */
function endingDone(game: Game, kind: 'main' | 'nanke'): void {
  game.ending = kind;
  game.events.emit('ending', { kind });
  // 主结局片尾播完时若还有南柯段落（r1.nanke），等 'nanke' 再写通关标记
  if (kind === 'nanke' || !game.state.flag(F.R1_NANKE)) {
    game.save.markCompleted();
    game.returnToTitleWhenIdle();
  }
}

/** 区域代码、Effect.call、对话/过场脚本能拿到的唯一门面。它的每个写方法都等价于某个 Effect。 */
export interface GameApi {
  readonly state: StateView;
  readonly time: number;
  /** 本门面绑定的 scope 已被取消 */
  readonly cancelled: boolean;
  /** 在本 scope 内联执行 */
  run(list: readonly Effect[]): Promise<RunOutcome>;
  setFlag(id: FlagId, value?: true | number): void;
  give(id: ItemId | KeyPhotoId): void;
  markUsed(id: ItemId): void;
  say(text: string, who?: SpeakerId, dur?: number): void;
  feedback(text: string): void;
  clue(text: string): void;
  dialogue(id: DialogueId): Promise<RunOutcome>;
  cutscene(id: CutsceneId): Promise<RunOutcome>;
  sfx(cue: SfxCue, at?: V3): void;
  music(cue: MusicCue): void;
  /** flash 与频闪自动遵守 reduceFlash */
  post: { push(key: string, p: Partial<FxParams>, fadeSec?: number): void; pop(key: string, fadeSec?: number): void; flash(ms?: number): void };
  player: {
    readonly position: THREE.Vector3; readonly eye: THREE.Vector3; readonly yaw: number;
    teleport(p: V3, yaw?: number, fadeSec?: number): Promise<void>;
    /**
     * M4 第 2 轮整合补写：只改视角 yaw/pitch（俯仰按第三人称范围 −35°～+50° 钳制），不转身体、不动位置。
     * 过场收尾 {cam:'player'} 之前摆好第三人称的构图用（开场：坐着的伙计低头，桌上发光的巡夜本露在头边上）；
     * 要在 {cam:'player'} 之前至少一帧调用（第三人称相机每帧跟着 yaw/pitch 更新，{cam:'player'} 取的是那一刻的位姿）。
     */
    look?(yaw: number, pitch: number): void;
    readonly model: {
      /** 开场坐在椅子上 */
      setPose(p: Pose, blendSec?: number): void;
      /** P14 身子一点点空下去 */
      setBodyOpacity(a: number, sec?: number): void;
      /** 尾声：身体不见 */
      setVisible(v: boolean): void;
      /** 头是否在身上 */
      readonly headMounted: boolean;
      /** 镜中读字用 */
      stickerWorld(target?: THREE.Vector3): THREE.Vector3;
      /**
       * M1d 补写（ARCH §5.2、§6.11）：后脑视频线的 BNC 插头。R1 在插上 r1.crt_jack 时 plugTo(插孔节点)（插头沿节点本地 −y 插入），
       * 拔出时 plugTo(null)；离开区域时引擎自动拔出。ConsoleSystem.plugJack/unplugJack 只管状态，不动线。
       */
      readonly cable: { readonly plugged: boolean; plugTo(to: THREE.Object3D | null): void };
    };
  };
  /**
   * M1d 补写（ARCH §6.5）：结局加速钟由 R1 的天亮过场驱动——override('04:58:00') 起走（默认 70 钟秒/游戏秒，停在 05:12:00），override(null) 交还。
   * M3 补写：clock() = 当前钟点 'HH:MM:SS'（与 HUD、监控 OSD 同源）；osdLine(ch) = 'CH2 2026-08-28 周五 04:31:12'（= ShichenSystem.osdLine）。只读、装饰用。
   */
  shichen: { override(clock: string | null, rate?: number): void; clock(): string; osdLine(channel?: number): string };
  /** 只读；变化时发 'settings' 事件 */
  settings: Readonly<Settings>;
  /** 当前聚焦对象（色彩辅助的悬停字幕用） */
  interaction: { readonly focused: InteractId | null };
  modes: { readonly top: ModeId; readonly stack: readonly ModeId[] };
  vf: { readonly on: boolean; readonly lens: LensMode; readonly zoom: ZoomLevel };
  replay: { readonly active: { point: ReplayPointId; seg: SegmentId; t: number; playing: boolean } | null };
  vcr: VcrSystem;
  cctv: ConsoleSystem;
  tripod: TripodSystem;
  /** M3 补写：record(id) 只读取已有照片记录（含缩略图 thumb），没有返回 null；不发事件、不存档、不消耗三脚架快门（片尾放玩家自己拍的照片） */
  photo: Pick<PhotoSystem, 'award'> & { record(id: PhotoId): Readonly<PhotoRecord> | null };
  hints: Pick<HintSystem, 'current'>;
  /**
   * M3 补写：打开文档阅读器（= JournalSystem.openDoc：推 mode.journal，arg = { doc, vf }，vf 缺省 = 栈上有取景器），
   * Promise 在阅读器合上时 resolve（失败立即 resolve：no_such_target / mode_disallows / cancelled）。等待期间 settle 为 'waiting'（同面板）。
   * 墙上/场景里不属于任何物品的文档（公告栏、规矩牌、暗房守则…）在 onInteract 里用它或 E.doc(id)；连续 await 就是“一张接一张读”。
   */
  openDoc(id: DocId, o?: { vf?: boolean }): Promise<ApiResult>;
  /** M3 补写：翻开巡夜本（= JournalSystem.openJournal），合上时 resolve；E.journal() 同义 */
  openJournal(): Promise<ApiResult>;
  /** 走出入口同等流程（= areas.travel，检查 when） */
  travel(exit: ExitId): Promise<ApiResult>;
  /** R2：换楼层（= 当前区域 levels.set，楼梯井对话的选项 effects 用它） */
  setLevel(n: number): void;
  /**
   * 结局播完（= E.ending）：记录运行期 ending（Game.ending / DebugState.ending）、发 'ending' 事件；
   * kind === 'main' 且 !r1.nanke，或 kind === 'nanke' 时调用 save.markCompleted()（ARCH §6.4）
   */
  endingDone(kind: 'main' | 'nanke'): void;
}

/**
 * GameApi 的实现。构造时只保存引用：Game 构造函数里 createGameApi(this) 发生在 areas 创建之前，
 * 所以一切跨系统访问都放在 getter/方法里现取。
 */
class GameApiImpl implements GameApi {
  readonly post: GameApi['post'];
  readonly player: GameApi['player'];
  readonly interaction: GameApi['interaction'];
  readonly modes: GameApi['modes'];
  readonly vf: GameApi['vf'];
  readonly replay: GameApi['replay'];
  readonly photo: GameApi['photo'];
  readonly hints: GameApi['hints'];
  readonly shichen: GameApi['shichen'];

  constructor(private readonly game: Game, private readonly scope: RunScope | null) {
    // 箭头函数捕获 this；getter 只读 game（构造时 game.areas 等可能还没建，一律现取）
    const guard = this.guard;
    this.post = {
      push: (key, p, fadeSec) => {
        if (!guard('post.push')) return;
        game.pipeline.post.push(key, p, fadeSec);
        // 区域经门面推的叠加层记在当前区域上，卸载时弹掉（M1d，ARCH §6.3）
        game.areas.current?.ctx.notePostKey(key);
      },
      pop: (key, fadeSec) => { if (guard('post.pop')) game.pipeline.post.pop(key, fadeSec); },
      flash: ms => { if (guard('post.flash')) game.pipeline.post.flash(ms); },
    };
    const model: GameApi['player']['model'] = {
      setPose: (p, blendSec) => { if (guard('model.setPose')) game.playerModel.setPose(p, blendSec); },
      setBodyOpacity: (a, sec) => { if (guard('model.setBodyOpacity')) game.playerModel.setBodyOpacity(a, sec); },
      setVisible: v => { if (guard('model.setVisible')) game.playerModel.setVisible(v); },
      get headMounted() { return game.playerModel.headMounted; },
      stickerWorld: target => game.playerModel.stickerWorld(target),
      cable: {
        get plugged() { return game.playerModel.head.cable.plugged; },
        plugTo: to => { if (guard('model.cable.plugTo')) game.playerModel.head.cable.plugTo(to); },
      },
    };
    this.player = {
      get position() { return game.player.position; },
      get eye() { return game.player.eye; },
      get yaw() { return game.player.yaw; },
      teleport: (p, yaw, fadeSec) => {
        if (!guard('player.teleport')) return Promise.resolve();
        const o: { yaw?: number; fade?: number } = {};
        if (yaw !== undefined) o.yaw = yaw;
        if (fadeSec !== undefined) o.fade = fadeSec;
        return game.areas.teleport(p, o);
      },
      look: (yaw, pitch) => {
        if (!guard('player.look')) return;
        game.player.yaw = ((yaw % 360) + 360) % 360;
        game.player.pitch = pitch;
        game.player.clampPitch('tp');
      },
      model,
    };
    this.interaction = { get focused() { return game.sys.interaction.focused; } };
    this.modes = {
      get top() { return game.modes.top; },
      get stack() { return game.modes.stack; },
    };
    this.vf = {
      get on() { return game.sys.viewfinder.on; },
      get lens() { return game.sys.viewfinder.lens; },
      get zoom() { return game.sys.viewfinder.zoom; },
    };
    this.replay = {
      get active() {
        const a = game.sys.replay.active;
        return a ? { point: a.point, seg: a.seg, t: a.t, playing: a.playing } : null;
      },
    };
    this.photo = { award: (id, opts) => game.sys.photo.award(id, opts), record: id => game.state.photoRecord(id) };
    this.hints = { current: () => game.sys.hints.current() };
    this.shichen = {
      override: (clock, rate) => { if (guard('shichen.override')) game.sys.shichen.override(clock, rate); },
      clock: () => game.sys.shichen.clockSeconds(),
      osdLine: channel => game.sys.shichen.osdLine(channel),
    };
  }

  /** 写方法的守卫：scope 已取消 → 空操作（dev 下提醒）。 */
  private readonly guard = (what: string): boolean => this.ok(what);
  private ok(what: string): boolean {
    if (this.scope?.cancelled) {
      // 最常见的原因：handler 先 travel 再写东西——切区域会取消包括调用者在内的全部进行中 run（ARCH §4.5 第 1 步、§6.3）
      devWarn(`GameApi.${what}：所在 run（${this.scope.origin}）已被取消，忽略（切区域/模式重置会取消全部进行中的 run；travel 必须是 handler 的最后一步，写进度要放在它前面）`);
      return false;
    }
    return true;
  }
  private get sc(): RunScope | undefined {
    return this.scope ?? undefined;
  }

  get state(): StateView { return this.game.state; }
  get time(): number { return this.game.time; }
  get cancelled(): boolean { return this.scope?.cancelled ?? false; }
  get settings(): Readonly<Settings> { return this.game.settings; }
  get vcr(): VcrSystem { return this.game.sys.vcr; }
  get cctv(): ConsoleSystem { return this.game.sys.cctv; }
  get tripod(): TripodSystem { return this.game.sys.tripod; }

  run(list: readonly Effect[]): Promise<RunOutcome> {
    return this.game.effects.run(list, this.scope ? `${this.scope.origin}>run` : 'api.run', this.sc);
  }
  setFlag(id: FlagId, value?: true | number): void {
    if (this.ok('setFlag')) this.game.state.setFlag(id, value);
  }
  give(id: ItemId | KeyPhotoId): void {
    if (!this.ok('give')) return;
    if (id.startsWith('ph.')) this.game.sys.photo.award(id as KeyPhotoId);
    else this.game.state.giveItem(id as ItemId);
  }
  markUsed(id: ItemId): void {
    if (this.ok('markUsed')) this.game.state.markUsed(id);
  }
  say(text: string, who?: SpeakerId, dur?: number): void {
    if (this.ok('say')) speak(this.game, text, who ?? '', dur);
  }
  feedback(text: string): void {
    if (this.ok('feedback')) this.game.ui.toast(text, 'feedback');
  }
  clue(text: string): void {
    if (this.ok('clue')) this.game.state.addClue(text);
  }
  dialogue(id: DialogueId): Promise<RunOutcome> {
    return this.game.effects.run([E.dialogue(id)], `dialogue:${id}`, this.sc);
  }
  cutscene(id: CutsceneId): Promise<RunOutcome> {
    return this.game.effects.run([E.cutscene(id)], `cutscene:${id}`, this.sc);
  }
  sfx(cue: SfxCue, at?: V3): void {
    if (this.ok('sfx')) this.game.audio.sfx(cue, at === undefined ? undefined : { at });
  }
  music(cue: MusicCue): void {
    if (this.ok('music')) this.game.audio.music(cue);
  }
  openDoc(id: DocId, o?: { vf?: boolean }): Promise<ApiResult> {
    if (!this.ok('openDoc')) return Promise.resolve({ ok: false, reason: 'cancelled' });
    return new Promise(resolve => this.game.effects.readerCps(() => this.game.sys.journal.openDoc(id, o), resolve));
  }
  openJournal(): Promise<ApiResult> {
    if (!this.ok('openJournal')) return Promise.resolve({ ok: false, reason: 'cancelled' });
    return new Promise(resolve => this.game.effects.readerCps(() => this.game.sys.journal.openJournal(), resolve));
  }
  travel(exit: ExitId): Promise<ApiResult> {
    if (!this.ok('travel')) return Promise.resolve({ ok: false, reason: 'cancelled' });
    return this.game.areas.travel(exit);
  }
  setLevel(n: number): void {
    if (!this.ok('setLevel')) return;
    const h = this.game.areas.current?.ctx.levelsHandle;
    if (!h) {
      devWarn(`GameApi.setLevel(${n})：当前区域没有楼层`);
      return;
    }
    h.set(n);
  }
  endingDone(kind: 'main' | 'nanke'): void {
    if (this.ok('endingDone')) endingDone(this.game, kind);
  }
}

/** 构造 GameApi（M1a 补写）：scope 缺省 = 顶层门面（Game.api）；传 scope 则得到绑定该 scope 的门面（其 run/dialogue/cutscene 内联执行）。 */
export function createGameApi(game: Game, scope?: RunScope): GameApi {
  return new GameApiImpl(game, scope ?? null);
}
