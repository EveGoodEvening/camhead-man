// owner: WP6
// “点击继续”遮罩（ARCH §4.6）：lock 策略的模式里未锁定时显示，点击（用户手势）时 requestPointerLock()。
// 数据来源：由 InputManager/ModeStack 经 View.show/hide 控制。UI 只读系统状态、只通过 game.dispatch() 或系统公开方法发起动作，不直接改状态。
// UI.update 也按同一条件自动显隐（栈顶策略为 lock、锁定可用、当前未锁定、没有菜单盖着），所以两边谁调用结果都一致。

import type { Game } from '../core/game';
import type { View } from './ui';
import { STRINGS } from '../data/strings';
import { h, setShown } from './dom';

export class PointerGate implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private shown = false;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-gate');
    const box = h('div', 'cm-gate-box');
    box.append(h('span', 'cm-rec-dot'), document.createTextNode(STRINGS.menu.clickToContinue));
    this.el.append(box);
    // 这次点击只用来拿回指针锁定：不让它冒泡到页面（否则在取景器里会被当成一次快门）
    const swallow = (ev: Event): void => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    this.el.addEventListener('mousedown', swallow);
    this.el.addEventListener('pointerdown', swallow);
    this.el.addEventListener('click', ev => {
      swallow(ev);
      this.game.input.requestPointerLock();
    });
    setShown(this.el, false);
  }

  /** 是否正在显示（UI 与自测用）。 */
  get visible(): boolean {
    return this.shown;
  }

  show(_arg?: unknown): void {
    this.shown = true;
    setShown(this.el, true);
  }
  hide(): void {
    this.shown = false;
    setShown(this.el, false);
  }
  update(_dt: number): void {
    // 锁定成功后立刻收起（pointerlockchange 之后 InputManager 会报告 pointerLocked）
    if (this.shown && this.game.input.pointerLocked) this.hide();
  }
}
