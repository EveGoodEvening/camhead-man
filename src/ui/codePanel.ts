// owner: WP6
// 密码转轮锁面板（ARCH §6.15）：转轮、已输入位数、失败反馈。
// 数据来源：读 game.sys.panels.code。UI 只读系统状态、只通过 game.dispatch() 或系统公开方法发起动作，不直接改状态。
// 鼠标操作与键盘同一套 Action：数字 → {t:'digit'}、▲▼ → {t:'wheel'}、⌫ → {t:'erase'}、确认 → {t:'confirm'}、离开 → {t:'back'}。
// 位数、标题、每个转轮的数字与当前轮都来自 CodeState（M1c 冻结，engine-wp6.md #4）：没有 title 时用 owner 交互物的现算角标名。
// 转轮显示 wheels[i]（正在拨、未确认的那一位也显示，否则滚轮拨号时看不到数字）；已确认的位（i < entered.length）与当前轮高亮。

import type { Game } from '../core/game';
import type { View } from './ui';
import { evalDyn, h, keyHints, setClass, setShown, setText, uiButton } from './dom';

const SHAKE_SEC = 0.4;

export class CodePanel implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private readonly lock: HTMLElement;
  private readonly title: HTMLElement;
  private readonly wheels: HTMLElement;
  private readonly fails: HTMLElement;
  private wheelEls: { root: HTMLElement; prev: HTMLElement; cur: HTMLElement; next: HTMLElement }[] = [];
  private lastFails = 0;
  private shake = 0;
  private shown = false;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-codepanel cm-backdrop');
    this.lock = h('div', 'cm-lock');
    this.title = h('div', 'cm-lock-title');
    this.wheels = h('div', 'cm-wheels');
    const pad = h('div', 'cm-keypad');
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
      pad.append(uiButton(String(n), '', () => { this.game.dispatch({ t: 'digit', n }); }));
    }
    const actions = h('div', 'cm-lock-actions');
    actions.append(
      uiButton('▲', '', () => { this.game.dispatch({ t: 'wheel', dir: 1 }); }),
      uiButton('▼', '', () => { this.game.dispatch({ t: 'wheel', dir: -1 }); }),
      uiButton('⌫', '', () => { this.game.dispatch({ t: 'erase' }); }),
      uiButton('确认', '', () => { this.game.dispatch({ t: 'confirm' }); }),
      uiButton('离开', '', () => { this.game.dispatch({ t: 'back' }); }),
    );
    this.fails = h('div', 'cm-lock-fails');
    this.lock.append(this.title, this.wheels, pad, actions, this.fails,
      keyHints([['0–9', '输入'], ['滚轮', '拨转轮'], ['Enter', '确认'], ['Backspace', '删除'], ['Esc', '离开']]));
    this.el.append(this.lock);
    this.el.addEventListener('mousedown', ev => ev.preventDefault());
    setShown(this.el, false);
  }

  show(_arg?: unknown): void {
    if (!this.shown) {
      this.lastFails = this.game.sys.panels.code?.fails ?? 0;
      this.shake = 0;
    }
    this.shown = true;
    setShown(this.el, true);
    this.update(0);
  }
  hide(): void {
    this.shown = false;
    setShown(this.el, false);
  }

  update(dt: number): void {
    if (!this.shown) return;
    const g = this.game;
    const code = g.sys.panels.code;
    if (!code) return;
    const digits = Math.max(1, code.digits, code.entered.length);
    if (digits !== this.wheelEls.length) this.buildWheels(digits);
    const def = g.sys.interaction.get(code.owner);
    setText(this.title, code.title ?? (def ? evalDyn(def.label, g.state) : undefined) ?? '');
    const active = Math.min(code.cursor, digits - 1);
    this.wheelEls.forEach((w, i) => {
      const raw = code.wheels[i];
      const d = raw !== undefined && Number.isFinite(raw) ? ((Math.round(raw) % 10) + 10) % 10 : null;
      setText(w.cur, d === null ? '·' : String(d));
      setText(w.prev, d === null ? '' : String((d + 9) % 10));
      setText(w.next, d === null ? '' : String((d + 1) % 10));
      setClass(w.root, 'cm-active', i === active);
      setClass(w.root, 'cm-set', i < code.entered.length);
    });
    // 失败：锁身抖一下（失败文本本身由 PanelSystem 作为反馈发出）
    if (code.fails > this.lastFails) this.shake = SHAKE_SEC;
    this.lastFails = code.fails;
    this.shake = Math.max(0, this.shake - dt);
    setClass(this.lock, 'cm-shake', this.shake > 0);
    setText(this.fails, code.fails > 0 ? `已试 ${code.fails} 次` : '');
  }

  private buildWheels(n: number): void {
    this.wheelEls = [];
    this.wheels.replaceChildren();
    for (let i = 0; i < n; i++) {
      const root = h('div', 'cm-wheel');
      const prev = h('span', 'cm-ghost');
      const cur = h('span', 'cm-cur');
      const next = h('span', 'cm-ghost');
      root.append(prev, cur, next);
      this.wheels.append(root);
      this.wheelEls.push({ root, prev, cur, next });
    }
  }
}
