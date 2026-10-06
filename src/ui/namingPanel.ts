// owner: WP6
// 称呼面板（ARCH §6.15）：表头“长明照相馆　取件单　No.0474　姓名：＿＿”、已收录称呼 1–6。
// 数据来源：读 game.sys.panels.naming；点选发 {t:'choose', k}。UI 只读系统状态、只通过 game.dispatch() 或系统公开方法发起动作，不直接改状态。
// 表头文字属于区域数据（NamingDef.header），panels.naming 的冻结签名里没有它（engine-wp6.md #4）：
// 取可选字段 header，缺省用 owner 交互物的现算角标名 + “姓名：＿＿”。

import type { Game } from '../core/game';
import type { NameId } from '../data/ids';
import type { View } from './ui';
import { NAMES } from '../data/names';
import { evalDyn, h, keyHints, setShown, setText, uiButton } from './dom';

export class NamingPanel implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private readonly head: HTMLElement;
  private readonly list: HTMLElement;
  private key = '';
  private shown = false;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-namingpanel cm-backdrop');
    const slip = h('div', 'cm-slip');
    this.head = h('div', 'cm-slip-head');
    this.list = h('div', 'cm-slip-list');
    slip.append(this.head, this.list, keyHints([['1–6', '选一个'], ['Esc', '离开']]));
    this.el.append(slip);
    this.el.addEventListener('mousedown', ev => ev.preventDefault());
    setShown(this.el, false);
  }

  show(_arg?: unknown): void {
    this.shown = true;
    this.key = '';
    setShown(this.el, true);
    this.update(0);
  }
  hide(): void {
    this.shown = false;
    setShown(this.el, false);
  }

  update(_dt: number): void {
    if (!this.shown) return;
    const g = this.game;
    const nm = g.sys.panels.naming;
    if (!nm) return;
    const def = g.sys.interaction.get(nm.owner);
    const header = nm.header || `${(def ? evalDyn(def.label, g.state) : undefined) ?? ''}　姓名：＿＿`;
    setText(this.head, header);
    const key = nm.options.join(',');
    if (key === this.key) return;
    this.key = key;
    this.list.replaceChildren(...nm.options.map((id: NameId, i) => {
      const b = uiButton('', 'cm-slip-opt', () => { this.game.dispatch({ t: 'choose', k: id }); });
      b.append(h('span', 'cm-k', String(i + 1)), h('span', 'cm-name', NAMES[id].text));
      return b;
    }));
  }
}
