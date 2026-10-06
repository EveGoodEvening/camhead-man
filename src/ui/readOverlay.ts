// owner: WP6
// 读字覆盖层（ARCH §7；GDD §3.14）：屏幕下方显示原文，镜中字用 CSS transform: scaleX(-1)；tooSmall/notInMirror 提示。
// 数据来源：读 game.sys.read.reading / hint。UI 只读系统状态、只通过 game.dispatch() 或系统公开方法发起动作，不直接改状态。
// “双保险”：CJK 字形不可用、贴图退化成图案时，关键线索全靠这里的原文（GDD §3.14）。

import type { Game } from '../core/game';
import type { View } from './ui';
import { h, setClass, setShown, setText } from './dom';

export class ReadOverlay implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private readonly box: HTMLElement;
  private readonly text: HTMLElement;
  private readonly hint: HTMLElement;
  private shown = false;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-read');
    this.box = h('div', 'cm-read-box');
    this.text = h('span', 'cm-read-text');
    this.box.append(h('span', 'cm-read-tag', 'READ'), this.text);
    this.hint = h('div', 'cm-read-hint');
    this.el.append(this.box, this.hint);
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
    const r = this.game.sys.read;
    const reading = r.reading;
    setShown(this.box, reading !== null);
    if (reading) {
      setText(this.text, reading.text);
      setClass(this.text, 'cm-mirror', r.get(reading.id)?.mirror === true);
    }
    const hint = reading ? null : r.hint;
    setShown(this.hint, !!hint);
    setText(this.hint, hint ?? '');
  }
}
