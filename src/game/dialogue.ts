// owner: WP4
// 对话（ARCH §6.13）：数据驱动对话树。defineDialogues / seq 由 M1a 实现（区域在模块加载时调用它们）。
//
// 实现要点（WP4）：
// - start(id, scope)：无 scope 时作为顶层 run 排队（与 E.dialogue 等价）；有 scope 时内联（ARCH §6.3 可重入）。
// - 模式：栈顶已是本系统的对话（对话节点 effects 里又开对话）时复用 mode.dialogue，不再压栈；否则压一层 mode.dialogue
//   （对话 → 过场 → 对话 会得到 [… dialogue, cutscene, dialogue]）。
// - 结束顺序：先弹出 mode.dialogue，再内联执行“终止选项”的 effects 与 end 节点的 effects，最后 resolve。
//   这样 `dlg.r1.bracket_confirm` 的“装回去”（E.call(g => g.tripod.enter())）压入的 mode.tripod 不会压在对话之上，
//   回到 explore 时也不会残留一层对话。非终止选项/节点的 effects 在对话仍在栈上时执行。
// - 节点 effects：line 节点的 effects 在显示该行之前执行；do 节点执行完去 next；choice 的选项 effects 在选中时执行。
// - 非强制对话的每个选项节点末尾自动加“（先这样）”（STRINGS.dialogue.leave），强制对话（forced）不加（noLeave 也不加）。
// - 打字机按游戏时间走（25 字/秒）；?test=1 即时。停在“已打完的台词行”或选项上时 waitingInput 为真。
// - 取消（cancelRuns，由 EffectRunner.cancelAll 调用）：阻塞中的对话以 'cancelled' 结束；不弹模式（调用方随后 resetTo）。

import type { AreaKey } from '../core/types';
import type { DialogueId, SpeakerId } from '../data/ids';
import type { Game } from '../core/game';
import type { ApiResult } from '../core/types';
import { fail, ok } from '../core/types';
import type { StateView } from './state';
import type { Cond } from './expr';
import { compileCond } from './expr';
import type { Cont, Handler, RunOutcome, RunScope } from './effects';
import { sayDuration } from './effects';
import { STRINGS } from '../data/strings';
import { isNarration } from '../data/speakers';
import { devAssert, devWarn } from '../core/log';

/** 正文与选项文字可以随 flags 生成（如“n/6”） */
export type DText = string | ((s: StateView) => string);

export type DNode =
  /** who='' = 旁白；pc.huoji 的行只闪 REC */
  | { type?: 'line'; who: SpeakerId | ''; text: DText; next?: string; effects?: Handler; rec?: 1 | 2 }
  | { type: 'choice'; who?: SpeakerId | ''; text?: DText; options: DOption[]; noLeave?: boolean }
  | { type: 'branch'; cases: { when: Cond; next: string }[]; else: string }
  | { type: 'do'; effects: Handler; next?: string }
  | { type: 'end'; effects?: Handler };

export interface DOption { label: DText; next: string; when?: Cond; effects?: Handler }

export interface DialogueDef {
  id: DialogueId;
  start: string;
  nodes: Record<string, DNode>;
  /** 强制对话：选项节点不自动加“（先这样）”；退出项由数据自己写（“再等等”“（算了）”） */
  forced?: boolean;
  /** 默认 true */
  lockView?: boolean;
}

/** 把一个区域的对话表展开成 DialogueDef[]（id 前缀必须是 dlg.<area>.，dev 下校验）。 */
export function defineDialogues(area: AreaKey, defs: Record<DialogueId, Omit<DialogueDef, 'id'>>): DialogueDef[] {
  const out: DialogueDef[] = [];
  for (const [id, d] of Object.entries(defs) as [DialogueId, Omit<DialogueDef, 'id'>][]) {
    devAssert(id.startsWith(`dlg.${area}.`), `defineDialogues(${area}): '${id}' 不是 dlg.${area}.*`);
    devAssert(d.start in d.nodes, `defineDialogues(${area}): '${id}' 的 start '${d.start}' 不存在`);
    out.push({ id, ...d });
  }
  return out;
}

/** 线性对话快捷写法：依次说完各行，最后一个 end 节点执行 end（节点名 l0、l1…、end）。 */
export function seq(lines: readonly (readonly [SpeakerId | '', DText])[], end?: Handler): Omit<DialogueDef, 'id'> {
  const nodes: Record<string, DNode> = {};
  lines.forEach(([who, text], i) => {
    nodes[`l${i}`] = { who, text, next: i + 1 < lines.length ? `l${i + 1}` : 'end' };
  });
  nodes.end = end === undefined ? { type: 'end' } : { type: 'end', effects: end };
  return { start: lines.length > 0 ? 'l0' : 'end', nodes };
}

/** 打字机速度（字/秒，游戏时间）。 */
export const TYPE_CPS = 25;
/** “（先这样）”离开项的内部 next 标记。 */
const LEAVE = '\u0000leave';

interface Opt { label: string; next: string; effects?: Handler; leave: boolean }
type RunState = 'effects' | 'typing' | 'line' | 'choice' | 'ending';
interface DRun {
  readonly def: DialogueDef;
  readonly scope: RunScope;
  readonly cb: Cont;
  node: string;
  state: RunState;
  who: SpeakerId | '';
  text: string;
  shown: number;
  rec: 1 | 2 | undefined;
  options: Opt[];
  /** 本 run 压了 mode.dialogue（嵌套在对话里直接开的对话复用外层的模式） */
  pushedMode: boolean;
  /** 已由本系统弹出模式（结束流程中） */
  modePopped: boolean;
  finished: boolean;
}

/**
 * DialogueSystem.active 的形状（M1c 冻结 shown/rec，engine-wp4.md #2、engine-wp6.md #6）：text 恒为该行**全文**（求值后），
 * 打字机进度看 shown；typing 为假时 shown = 全文字数。
 */
export interface DialogueActive {
  id: DialogueId; node: string; who: SpeakerId | ''; text: string; typing: boolean; options: string[];
  /** 已显示的字数（打字机） */
  shown: number;
  /** pc.huoji 行的 REC 闪烁次数 */
  rec?: 1 | 2;
}

export class DialogueSystem {
  protected readonly game: Game;
  private readonly defs = new Map<DialogueId, DialogueDef>();
  private readonly runs: DRun[] = [];

  constructor(game: Game) {
    this.game = game;
  }

  /** text/options 是求值后的字符串 */
  get active(): DialogueActive | null {
    const r = this.top();
    if (!r || (r.state !== 'typing' && r.state !== 'line' && r.state !== 'choice')) return null;
    const a: DialogueActive = {
      id: r.def.id, node: r.node, who: r.who, text: r.text, typing: r.state === 'typing',
      options: r.state === 'choice' ? r.options.map(o => o.label) : [],
      shown: r.state === 'typing' ? Math.floor(r.shown) : [...r.text].length,
    };
    if (r.rec !== undefined) a.rec = r.rec;
    return a;
  }
  /** 启动时由 AreaManager 汇总全部区域的 AreaDef.dialogues 登记（id 带区域前缀，全局唯一，重复在 dev 下抛错） */
  register(defs: readonly DialogueDef[]): void {
    for (const d of defs) {
      devAssert(!this.defs.has(d.id), `DialogueSystem.register: 对话 '${d.id}' 重复`);
      devAssert(d.start in d.nodes, `DialogueSystem.register: '${d.id}' 的 start '${d.start}' 不存在`);
      for (const [name, n] of Object.entries(d.nodes)) {
        const refs: string[] = [];
        if (n.type === 'branch') refs.push(...n.cases.map(c => c.next), n.else);
        else if (n.type === 'choice') refs.push(...n.options.map(o => o.next));
        else if (n.type !== 'end' && n.next !== undefined) refs.push(n.next);
        for (const r of refs) devAssert(r in d.nodes, `对话 '${d.id}' 的节点 '${name}' 指向不存在的节点 '${r}'`);
        // 编译条件（校验 id）；结果由 compileCond 缓存，运行时再取
        if (n.type === 'branch') for (const c of n.cases) compileCond(c.when, `${d.id}#${name}`);
        if (n.type === 'choice') for (const o of n.options) compileCond(o.when, `${d.id}#${name}`);
      }
      this.defs.set(d.id, d);
    }
  }
  /** 推 mode.dialogue；结束时 'done'，被 cancelAll 打断时 'cancelled'；节点 effects 在该 scope 下内联执行（ARCH §6.3） */
  start(id: DialogueId, scope?: RunScope): Promise<RunOutcome> {
    return new Promise(resolve => this.startCps(id, scope, resolve));
  }
  /** 打字中 → 补完；否则去 next */
  advance(): ApiResult {
    const r = this.top();
    if (!r) return fail('no_dialogue');
    if (r.state === 'typing') {
      this.finishTyping(r);
      return ok();
    }
    if (r.state === 'line') {
      const node = r.def.nodes[r.node];
      const next = node && (node.type === undefined || node.type === 'line') ? node.next : undefined;
      this.enter(r, next);
      return ok();
    }
    if (r.state === 'choice') return fail('mode_disallows');
    return fail('busy');
  }
  /** 1 起，按当前可见选项计数 */
  choose(k: number): ApiResult {
    const r = this.top();
    if (!r) return fail('no_dialogue');
    if (r.state !== 'choice') return fail('no_choice');
    if (!Number.isInteger(k) || k < 1 || k > r.options.length) return fail('bad_option');
    const opt = r.options[k - 1]!;
    const chosen = opt.label;
    if (opt.leave || this.isTerminal(r.def, opt.next)) {
      const endNode = opt.leave ? undefined : r.def.nodes[opt.next];
      this.finish(r, opt.effects, endNode && endNode.type === 'end' ? endNode.effects : undefined);
    } else {
      this.runEffects(r, opt.effects, `#${r.node}/${k}`, () => this.enter(r, opt.next));
    }
    return ok({ chosen });
  }
  /** 打字机（游戏时间；?test=1 即时）；停在台词行或选项时把 effects.waitingInput 置真 */
  update(dt: number): void {
    const r = this.top();
    if (!r || r.state !== 'typing') return;
    r.shown += dt * TYPE_CPS;
    if (r.shown >= [...r.text].length) this.finishTyping(r);
  }

  // ——————————————————————————————— WP4 内部（非冻结签名）

  /** start() 的续延版（EffectRunner 执行 E.dialogue 时用）。 */
  startCps(id: DialogueId, scope: RunScope | undefined, cb: Cont): void {
    const def = this.defs.get(id);
    if (!def) {
      devAssert(false, `对话 '${id}' 未登记`);
      console.error(`[dialogue] 对话 '${id}' 未登记`);
      cb('done');
      return;
    }
    this.game.effects.schedule(`dialogue:${id}`, scope, (s, done) => this.begin(def, s, done), cb);
  }
  /** 阻塞点是否在等玩家（最内层对话停在打完的台词或选项上）。 */
  isWaitingInput(): boolean {
    const r = this.top();
    return r !== undefined && (r.state === 'line' || r.state === 'choice');
  }
  /** 结束 scope 已取消的对话（EffectRunner.cancelAll 调用；不弹模式）。 */
  cancelRuns(pred: (s: RunScope) => boolean): void {
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const r = this.runs[i]!;
      if (pred(r.scope)) this.complete(r, 'cancelled');
    }
  }
  /**
   * 栈顶那层 mode.dialogue 是否有对话“认领”（DialogueMode 的自愈检查）：
   * 认领层数 < 栈上 dialogue 层数时，最上面那层是残留（结束时它不在栈顶、没能弹出）。
   */
  ownsTopMode(): boolean {
    const layers = this.game.modes.stack.filter(id => id === 'mode.dialogue').length;
    const owners = this.runs.filter(r => r.pushedMode && !r.modePopped).length;
    return owners >= layers;
  }
  /** 当前对话是否锁视角（DialogueDef.lockView，默认 true）。 */
  lockView(): boolean {
    const r = this.top();
    return r ? r.def.lockView !== false : true;
  }
  /** 已登记的对话定义（lint/自测用）。 */
  def(id: DialogueId): DialogueDef | undefined {
    return this.defs.get(id);
  }
  /** DialogueMode.exit：弹出的那层若仍被某个进行中的对话认领（不是本系统弹的），按取消处理该对话及其上的嵌套。 */
  onModeExit(): void {
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const r = this.runs[i]!;
      if (!r.pushedMode) continue;
      if (r.modePopped) return;   // 正常结束流程里本系统自己弹的
      r.modePopped = true;
      devWarn(`对话 '${r.def.id}' 的模式被外部弹出，按取消处理`);
      this.cancelRunTree(i);
      return;
    }
  }

  private top(): DRun | undefined {
    return this.runs[this.runs.length - 1];
  }

  private begin(def: DialogueDef, scope: RunScope, done: Cont): void {
    const m = this.game.modes;
    let pushedMode = false;
    const reuse = m.top === 'mode.dialogue' && this.runs.length > 0;
    if (!reuse) {
      const r = m.push('mode.dialogue');
      pushedMode = r.ok;
      if (!r.ok) devWarn(`对话 '${def.id}' 无法压入 mode.dialogue：${r.reason ?? ''}`);
    }
    const run: DRun = {
      def, scope, cb: done, node: def.start, state: 'effects', who: '', text: '', shown: 0, rec: undefined,
      options: [], pushedMode, modePopped: false, finished: false,
    };
    this.runs.push(run);
    this.game.events.emit('dialogue:start', { id: def.id });
    this.enter(run, def.start);
  }

  /** 从 nodeId 起顺着非交互节点走，直到停在台词/选项或结束。 */
  private enter(r: DRun, nodeId: string | undefined): void {
    let id = nodeId;
    for (let guard = 0; guard < 10000; guard++) {
      if (r.finished) return;
      if (id === undefined || id === LEAVE) {
        this.finish(r, undefined, undefined);
        return;
      }
      const node = r.def.nodes[id];
      if (!node) {
        devWarn(`对话 '${r.def.id}' 缺节点 '${id}'，按结束处理`);
        this.finish(r, undefined, undefined);
        return;
      }
      r.node = id;
      switch (node.type) {
        case 'branch': {
          const hit = node.cases.find(c => compileCond(c.when, `${r.def.id}#${id}`)(this.game.state));
          id = hit ? hit.next : node.else;
          continue;
        }
        case 'do': {
          const next = node.next;
          this.runEffects(r, node.effects, `#${id}`, () => this.enter(r, next));
          return;
        }
        case 'end':
          this.finish(r, undefined, node.effects);
          return;
        case 'choice':
          this.showChoice(r, node);
          return;
        default: {
          const line = node;
          this.runEffects(r, line.effects, `#${id}`, () => this.showLine(r, line));
          return;
        }
      }
    }
    devWarn(`对话 '${r.def.id}' 的 branch 形成死循环`);
    this.finish(r, undefined, undefined);
  }

  private text(t: DText): string {
    return typeof t === 'function' ? t(this.game.state) : t;
  }

  private showLine(r: DRun, node: { who: SpeakerId | ''; text: DText; rec?: 1 | 2 }): void {
    if (r.finished) return;
    r.who = node.who;
    r.text = this.text(node.text);
    r.rec = node.rec;
    r.options = [];
    r.shown = 0;
    r.state = this.game.url.test || r.text.length === 0 ? 'line' : 'typing';
    if (node.who !== '' && !isNarration(node.who) && node.who !== 'pc.huoji') this.game.audio.murmur(node.who, sayDuration(r.text));
    this.game.effects.checkSettle();
  }

  private showChoice(r: DRun, node: Extract<DNode, { type: 'choice' }>): void {
    const s = this.game.state;
    const opts: Opt[] = [];
    for (const o of node.options) {
      if (!compileCond(o.when, `${r.def.id}#${r.node}`)(s)) continue;
      const opt: Opt = { label: this.text(o.label), next: o.next, leave: false };
      if (o.effects !== undefined) opt.effects = o.effects;
      opts.push(opt);
    }
    if (!r.def.forced && !node.noLeave) opts.push({ label: STRINGS.dialogue.leave, next: LEAVE, leave: true });
    if (opts.length === 0) {
      devWarn(`对话 '${r.def.id}' 的选项节点 '${r.node}' 没有可见选项，按结束处理`);
      this.finish(r, undefined, undefined);
      return;
    }
    r.who = node.who ?? '';
    r.text = node.text === undefined ? '' : this.text(node.text);
    r.rec = undefined;
    r.options = opts;
    r.shown = [...r.text].length;
    r.state = 'choice';
    this.game.effects.checkSettle();
  }

  private finishTyping(r: DRun): void {
    r.shown = [...r.text].length;
    r.state = 'line';
    this.game.effects.checkSettle();
  }

  private isTerminal(def: DialogueDef, next: string): boolean {
    const n = def.nodes[next];
    return n === undefined || n.type === 'end';
  }

  /** 在对话的 scope 里内联执行 effects；完成后（未被取消）继续 k。 */
  private runEffects(r: DRun, h: Handler | undefined, where: string, k: () => void): void {
    if (h === undefined) {
      k();
      return;
    }
    r.state = r.state === 'ending' ? 'ending' : 'effects';
    this.game.effects.runHandlerCps(h, `dialogue:${r.def.id}${where}`, r.scope, () => {
      if (r.finished) return;
      k();
    });
  }

  /** 结束：先弹出本对话压的模式，再执行终止选项与 end 节点的 effects，最后 resolve。 */
  private finish(r: DRun, pre: Handler | undefined, end: Handler | undefined): void {
    if (r.finished || r.state === 'ending') return;
    r.state = 'ending';
    if (r.pushedMode && !r.modePopped) {
      r.modePopped = true;
      const m = this.game.modes;
      if (m.top === 'mode.dialogue') m.pop('mode.dialogue');
      // 不在栈顶（effects 里压了别的模式）：留给 DialogueMode.update 自愈
    }
    this.runEffects(r, pre, '#leave', () => this.runEffects(r, end, '#end', () => this.complete(r, 'done')));
  }

  private complete(r: DRun, o: RunOutcome): void {
    if (r.finished) return;
    r.finished = true;
    const i = this.runs.indexOf(r);
    if (i >= 0) this.runs.splice(i, 1);
    this.game.events.emit('dialogue:end', { id: r.def.id });
    r.cb(o);
    this.game.effects.checkSettle();
  }

  /** 取消第 i 个 run 及其上面嵌套的 run（模式被外力弹出时）。 */
  private cancelRunTree(i: number): void {
    for (let j = this.runs.length - 1; j >= i; j--) {
      const r = this.runs[j];
      if (r) this.complete(r, 'cancelled');
    }
  }
}
