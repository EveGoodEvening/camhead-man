// owner: WP5
// mode.tripod 的 ModeHandler（ARCH §4.6、附录 A）。三脚架：WASD 操纵没有头的身体（方向相对固定机位）、左键定时、E 定时前取消。

import type { ModeId } from '../../core/types';
import { fail } from '../../core/types';
import type { Action, ActionResult } from '../../core/actions';
import type { ModeCamera, ModeHandler, ModeMove } from '../../core/modes';
import type { PointerPolicy } from '../../core/input';
import type { Game } from '../../core/game';

export class TripodMode implements ModeHandler {
  readonly id: 'mode.tripod' = 'mode.tripod';
  readonly transient = true;
  readonly freezesWorld = false;
  readonly pointer: PointerPolicy | ((stack: readonly ModeId[]) => PointerPolicy) = 'lock';
  readonly camera: ModeCamera = 'fixed';
  readonly move: ModeMove | ((stack: readonly ModeId[]) => ModeMove) = 'body';
  readonly look: boolean | ((stack: readonly ModeId[]) => boolean) = false;
  protected readonly game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  enter(_prev: ModeId | null, _arg?: unknown): void {
    this.game.sys.tripod.modeEntered();
  }

  exit(_next: ModeId | null): void {
    this.game.sys.tripod.modeExited();
  }

  /** 不合法返回 { ok:false, reason:'mode_disallows' }；需要下传时返回 { ok:false, pass:true } */
  handle(a: Action): ActionResult {
    const t = this.game.sys.tripod;
    switch (a.t) {
      case 'shutter':
        return t.start();
      case 'interact':
        return t.cancel();
      default:
        return fail('mode_disallows');
    }
  }
}
