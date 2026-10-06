// owner: WP6
// 监控台面板（ARCH §7）：频道 1–5 指示、视频线状态。
// 数据来源：读 game.sys.cctv。UI 只读系统状态、只通过 game.dispatch() 或系统公开方法发起动作，不直接改状态。
// 点频道键发 {t:'digit', n}（与数字键 1–5 同一条路径，ARCH 附录 A）；CRT 画面在场景里，这里只画屏幕下方的控制台面板。

import type { Game } from '../core/game';
import type { View } from './ui';
import { h, keyHints, setClass, setShown, setText, stackHas, uiButton } from './dom';

/** 五路频道的机位名（GDD §3.9 表）。 */
const CHANNELS: readonly (readonly [1 | 2 | 3 | 4 | 5, string])[] = [
  [1, '门楣'], [2, '门卫室'], [3, '三号楼单元门'], [4, '老街东口'], [5, '人民路通道口'],
];

export class ConsolePanel implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private readonly deck: HTMLElement;
  private readonly chBtns: HTMLButtonElement[] = [];
  private readonly jack: HTMLElement;
  private readonly jackText: HTMLElement;
  private shown = false;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-consolepanel');
    this.deck = h('div', 'cm-deck');
    const row = h('div', 'cm-deck-row');
    const chs = h('div', 'cm-ch');
    for (const [n, name] of CHANNELS) {
      const b = uiButton('', '', () => { this.game.dispatch({ t: 'digit', n }); });
      b.append(h('b', undefined, `CH${n}`), h('small', undefined, name));
      this.chBtns.push(b);
      chs.append(b);
    }
    this.jack = h('div', 'cm-jack');
    this.jackText = h('span');
    this.jack.append(h('span', 'cm-jack-led'), this.jackText);
    row.append(chs, this.jack);
    this.deck.append(row, keyHints([['1–5', '切频道'], ['右键', '取景器'], ['E/Esc', '离开']]));
    this.el.append(this.deck);
    this.deck.addEventListener('mousedown', ev => ev.preventDefault());
    setShown(this.el, false);
  }

  show(_arg?: unknown): void {
    this.shown = true;
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
    const c = g.sys.cctv;
    CHANNELS.forEach(([n], i) => setClass(this.chBtns[i], 'cm-on', c.channel === n));
    setClass(this.jack, 'cm-on', c.jack);
    setText(this.jackText, c.jack ? '视频入1　已接' : '视频入1　未接');
    // 叠加取景器时让位（频道与视频线状态改由取景器 HUD 右下角显示）
    setShown(this.deck, !stackHas(g, 'mode.viewfinder'));
  }
}
