// owner: WP1
// mode.pause 的 ModeHandler（ARCH §4.6、附录 A）。暂停菜单：Esc 继续；冻结世界。
// 进入途径：explore 下按 Esc（指针未锁定时）、lock 策略模式里的意外解锁、页面隐藏、WebGL context lost。
// “继续”（Esc 或菜单按钮 menus.select('resume')）弹出本模式；下层模式若是 lock 策略，由 InputManager 显示“点击继续”或直接重新锁定。

import type { ModeId } from '../../core/types';
import { fail, ok } from '../../core/types';
import type { Action, ActionResult } from '../../core/actions';
import type { ModeCamera, ModeHandler, ModeMove } from '../../core/modes';
import type { PointerPolicy } from '../../core/input';
import type { Game } from '../../core/game';

export class PauseMode implements ModeHandler {
  readonly id: 'mode.pause' = 'mode.pause';
  readonly transient = false;
  readonly freezesWorld = true;
  readonly pointer: PointerPolicy | ((stack: readonly ModeId[]) => PointerPolicy) = 'free';
  readonly camera: ModeCamera = 'inherit';
  readonly move: ModeMove | ((stack: readonly ModeId[]) => ModeMove) = 'none';
  readonly look: boolean | ((stack: readonly ModeId[]) => boolean) = false;
  protected readonly game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  enter(_prev: ModeId | null, _arg?: unknown): void {
    this.game.ui.menus.showPause();
    // M4：暂停时音频也停（按 AudioContext 时钟排好的过场音乐不再在冻结的画面下继续走，恢复后音画不错位）
    this.game.audio.suspend();
  }
  exit(_next: ModeId | null): void {
    this.game.ui.menus.hide();
    if (typeof document === 'undefined' || !document.hidden) this.game.audio.resume();
  }
  /** 不合法返回 { ok:false, reason:'mode_disallows' }；需要下传时返回 { ok:false, pass:true } */
  handle(a: Action): ActionResult {
    if (a.t === 'back') {
      // 从暂停页打开的设置页：Esc 先回到暂停页（M1c）
      if (this.game.ui.menus.backFromSettings()) return ok();
      const r = this.game.modes.pop('mode.pause');
      return r.ok ? ok() : r;
    }
    // 暂停时其余一切动作都不下传（世界冻结，H 也不给提示）
    return fail('mode_disallows');
  }
  update(_dt: number): void {
    // 冻结期间的菜单动画由 UI 负责（ui.update 在冻结时照常调用）
  }
}
