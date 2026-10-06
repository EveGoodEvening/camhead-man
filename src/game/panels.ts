// owner: WP4
// 面板（ARCH §6.15）：密码转轮锁、称呼面板的逻辑。
//
// 实现要点（WP4）：
// - 自动接线：owner 交互物既没有 talk 也没有 onInteract 时，InteractionSystem 的主动作打开登记在它名下的面板
//   （前置用交互物自己的 when/blocked 表达，如 r3.stool 的“单子还没开呢”；解开后要换反馈就给 owner 加 when/blocked）。
// - 转轮锁模型：digits 个转轮 + 光标。数字键 = 把当前轮设成该数字并右移；滚轮 = 拨当前轮（不移动）；
//   Enter = 确认当前轮并右移，已在最后一轮（或已输满）时提交；Backspace = 光标左移。
//   所以“逐字符数字 + Enter”（调试 input）与“只用滚轮 + Enter”（真人输入测试）都能输完 4 位。
//   code.entered = 已确认的前几位。
// - 提交：正确 → 关面板（弹出 mode.panel_code）→ onSuccess 作为顶层 run；错误 → failText 反馈、清零、保持打开；
//   连错 failClue.after 次（默认 3）写线索并 toast“巡夜本上多了一行字”。失败计数只在内存中，按 owner 记，成功后清零。
// - 称呼面板：只列 state.names()；1–6 或称呼 id 选择；正确 → 关面板 → onCorrect（顶层 run）；错误 → wrong[id] 反馈，留在列表。
// - 面板打开期间 EffectRunner.waitingInput 为真（栈上有 panel_*）。

import type { ApiResult } from '../core/types';
import { fail, ok } from '../core/types';
import type { InteractId, NameId, SpeakerId } from '../data/ids';
import { NAMES } from '../data/names';
import { STRINGS } from '../data/strings';
import type { Game } from '../core/game';
import type { Handler } from './effects';
import { devAssert } from '../core/log';

export interface CodeLockDef {
  /** r1.drawer */
  owner: InteractId;
  digits: number; answer: string;
  title?: string;
  /** 成功后面板自动关闭 */
  onSuccess: Handler;
  /** “锁纹丝不动。” */
  failText: string;
  /** 连错 3 次写线索 */
  failClue?: { after: number; text: string };
}

export interface NamingDef {
  /** r3.stool */
  owner: InteractId;
  /** “长明照相馆　取件单　No.0474　姓名：＿＿” */
  header: string;
  answer: NameId;
  /** 选错的专属反馈，回到列表 */
  wrong: Partial<Record<NameId, string>>;
  onCorrect: Handler;
  /**
   * M4 补写：选错的反馈是谁说的（例如陆师傅的原话“底片是白的……”）。给了就作为这个人的字幕出现（面板开着时 #subs 在面板之上），
   * 不给仍是无名反馈条。
   */
  wrongWho?: SpeakerId;
}

/**
 * 转轮锁的状态（`PanelSystem.code`；M1c 冻结，engine-wp4.md #2/#8、engine-wp6.md #4）：
 * entered = 已确认的前几位；wheels = 每个转轮此刻的数字（含正在拨、尚未确认的那一位）；cursor = 当前轮（0 起）。
 */
export interface CodeState { owner: InteractId; entered: string; fails: number; wheels: number[]; cursor: number; digits: number; title?: string }
/** 称呼面板的状态（`PanelSystem.naming`；M1c 冻结）：header = 取件单表头；labels = options 的显示文本（同序）。 */
export interface NamingState { owner: InteractId; options: NameId[]; header: string; labels: string[] }

export class PanelSystem {
  protected readonly game: Game;
  private readonly codes = new Map<InteractId, CodeLockDef>();
  private readonly namings = new Map<InteractId, NamingDef>();
  private readonly fails = new Map<InteractId, number>();
  private codeOpen: { def: CodeLockDef; wheels: number[]; cursor: number } | null = null;
  private namingOpen: { def: NamingDef; options: NameId[] } | null = null;

  constructor(game: Game) {
    this.game = game;
  }

  registerCode(d: CodeLockDef): void {
    devAssert(!this.codes.has(d.owner), `PanelSystem.registerCode: ${d.owner} 重复登记`);
    devAssert(d.digits > 0 && d.answer.length === d.digits && /^\d+$/.test(d.answer), `PanelSystem.registerCode(${d.owner}): answer 必须是 ${d.digits} 位数字`);
    this.codes.set(d.owner, d);
  }
  registerNaming(d: NamingDef): void {
    devAssert(!this.namings.has(d.owner), `PanelSystem.registerNaming: ${d.owner} 重复登记`);
    this.namings.set(d.owner, d);
  }
  /** 由交互物的 onInteract 通过 E.call 或 ctx.codeLock 自动接线 */
  openCode(owner: InteractId): ApiResult {
    const def = this.codes.get(owner);
    if (!def) return fail('no_such_target');
    if (this.codeOpen || this.namingOpen) return fail('busy');
    // 先建状态再压模式：PanelCodeMode.enter 与 UI 在 push 里就能读到 code
    this.codeOpen = { def, wheels: new Array<number>(def.digits).fill(0), cursor: 0 };
    const r = this.game.modes.push('mode.panel_code', { owner });
    if (!r.ok) {
      this.codeOpen = null;
      return r;
    }
    this.game.effects.checkSettle();
    return ok({ owner });
  }
  openNaming(owner: InteractId): ApiResult {
    const def = this.namings.get(owner);
    if (!def) return fail('no_such_target');
    if (this.codeOpen || this.namingOpen) return fail('busy');
    this.namingOpen = { def, options: [...this.game.state.names()] };
    const r = this.game.modes.push('mode.panel_naming', { owner });
    if (!r.ok) {
      this.namingOpen = null;
      return r;
    }
    this.game.effects.checkSettle();
    return ok({ owner });
  }
  get code(): CodeState | null {
    const c = this.codeOpen;
    if (!c) return null;
    const s: CodeState = {
      owner: c.def.owner, entered: c.wheels.slice(0, c.cursor).join(''), fails: this.fails.get(c.def.owner) ?? 0,
      wheels: [...c.wheels], cursor: c.cursor, digits: c.def.digits,
    };
    if (c.def.title !== undefined) s.title = c.def.title;
    return s;
  }
  get naming(): NamingState | null {
    const n = this.namingOpen;
    if (!n) return null;
    const s: NamingState = { owner: n.def.owner, options: [...n.options], header: n.def.header, labels: n.options.map(id => NAMES[id].text) };
    return s;
  }
  /** 离开区域时清空本区面板定义（M1a 补写；ARCH §4.5 第 3 步由 AreaContextImpl.dispose() 调用）。 */
  clearArea(): void {
    this.codes.clear();
    this.namings.clear();
    this.fails.clear();
    this.codeOpen = null;
    this.namingOpen = null;
  }

  // ——————————————————————————————— WP4 内部（模式处理器与交互系统用；非冻结签名）

  hasPanel(owner: InteractId): boolean {
    return this.codes.has(owner) || this.namings.has(owner);
  }
  /** 主动作的自动接线：有密码锁开密码锁，有称呼面板开称呼面板。 */
  openFor(owner: InteractId): ApiResult {
    if (this.codes.has(owner)) return this.openCode(owner);
    if (this.namings.has(owner)) return this.openNaming(owner);
    return fail('no_panel');
  }
  codeDigit(n: number): ApiResult {
    const c = this.codeOpen;
    if (!c) return fail('no_panel');
    if (!Number.isInteger(n) || n < 0 || n > 9) return fail('bad_args');
    if (c.cursor >= c.def.digits) return fail('bad_option');   // 已输满，等确认
    c.wheels[c.cursor] = n;
    c.cursor++;
    this.game.audio.sfx('dial_click');
    return ok({ entered: c.wheels.slice(0, c.cursor).join('') });
  }
  codeWheel(dir: 1 | -1): ApiResult {
    const c = this.codeOpen;
    if (!c) return fail('no_panel');
    const i = Math.min(c.cursor, c.def.digits - 1);
    c.wheels[i] = ((c.wheels[i] ?? 0) + dir + 10) % 10;
    this.game.audio.sfx('dial_click');
    return ok({ wheel: i, value: c.wheels[i] });
  }
  codeErase(): ApiResult {
    const c = this.codeOpen;
    if (!c) return fail('no_panel');
    if (c.cursor > 0) c.cursor--;
    return ok({ entered: c.wheels.slice(0, c.cursor).join('') });
  }
  /** Enter：确认当前轮；在最后一轮（或已输满）时提交。返回 { correct }（提交时）或 { entered }。 */
  codeConfirm(): ApiResult {
    const c = this.codeOpen;
    if (!c) return fail('no_panel');
    if (c.cursor < c.def.digits - 1) {
      c.cursor++;
      return ok({ entered: c.wheels.slice(0, c.cursor).join('') });
    }
    c.cursor = c.def.digits;
    return this.submit();
  }
  closeCode(): void {
    if (!this.codeOpen) return;
    this.codeOpen = null;
    const m = this.game.modes;
    if (m.top === 'mode.panel_code') m.pop('mode.panel_code');
  }
  /** 模式被弹出（Esc、resetTo）时清掉打开状态。 */
  onCodeModeExit(): void {
    this.codeOpen = null;
  }
  nameChoose(k: number | NameId): ApiResult<{ chosen: string; feedback?: string; correct: boolean }> {
    const n = this.namingOpen;
    if (!n) return fail('no_panel');
    let id: NameId | undefined;
    if (typeof k === 'number') id = Number.isInteger(k) ? n.options[k - 1] : undefined;
    else id = n.options.includes(k) ? k : undefined;
    if (id === undefined) return fail('bad_option');
    const chosen = NAMES[id].text;
    const def = n.def;
    if (id === def.answer) {
      this.closeNaming();
      void this.game.effects.runHandler(def.onCorrect, `naming:${def.owner}`);
      return ok({ chosen, correct: true });
    }
    const feedback = def.wrong[id];
    if (feedback) {
      if (def.wrongWho) this.game.ui.subtitle(feedback, def.wrongWho);
      else this.game.ui.toast(feedback, 'feedback');
    }
    return feedback === undefined ? ok({ chosen, correct: false }) : ok({ chosen, feedback, correct: false });
  }
  closeNaming(): void {
    if (!this.namingOpen) return;
    this.namingOpen = null;
    const m = this.game.modes;
    if (m.top === 'mode.panel_naming') m.pop('mode.panel_naming');
  }
  onNamingModeExit(): void {
    this.namingOpen = null;
  }

  private submit(): ApiResult {
    const c = this.codeOpen!;
    const def = c.def;
    const code = c.wheels.join('');
    if (code === def.answer) {
      this.fails.set(def.owner, 0);
      this.closeCode();
      this.game.audio.sfx('drawer');
      void this.game.effects.runHandler(def.onSuccess, `code:${def.owner}`);
      return ok({ correct: true });
    }
    const fails = (this.fails.get(def.owner) ?? 0) + 1;
    this.fails.set(def.owner, fails);
    c.wheels.fill(0);
    c.cursor = 0;
    this.game.audio.sfx('error');
    this.game.ui.toast(def.failText, 'feedback');
    if (def.failClue && fails >= def.failClue.after && this.game.state.addClue(def.failClue.text)) {
      this.game.ui.toast(STRINGS.hud.newPage, 'page');
    }
    return ok({ correct: false, feedback: def.failText });
  }
}
