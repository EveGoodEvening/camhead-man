// owner: WP4
// mode.panel_naming 的 ModeHandler（ARCH §4.6、附录 A）。称呼面板：1–6 或点选 → choose（也接受称呼 id）、Esc 离开。
// 逻辑在 PanelSystem；视图由 UI.update 按栈显隐（NamingPanel 读 game.sys.panels.naming）。

import type { ModeId } from '../../core/types';
import { fail, ok } from '../../core/types';
import type { Action, ActionResult } from '../../core/actions';
import type { ModeCamera, ModeHandler, ModeMove } from '../../core/modes';
import type { PointerPolicy } from '../../core/input';
import type { Game } from '../../core/game';

export class PanelNamingMode implements ModeHandler {
  readonly id: 'mode.panel_naming' = 'mode.panel_naming';
  readonly transient = true;
  readonly freezesWorld = false;
  readonly pointer: PointerPolicy | ((stack: readonly ModeId[]) => PointerPolicy) = 'free';
  readonly camera: ModeCamera = 'inherit';
  readonly move: ModeMove | ((stack: readonly ModeId[]) => ModeMove) = 'none';
  readonly look: boolean | ((stack: readonly ModeId[]) => boolean) = false;
  protected readonly game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  enter(_prev: ModeId | null, _arg?: unknown): void {
    this.game.audio.sfx('ui_open');
  }
  exit(_next: ModeId | null): void {
    this.game.sys.panels.onNamingModeExit();
    this.game.audio.sfx('ui_close');
  }
  /** 不合法返回 { ok:false, reason:'mode_disallows' }；需要下传时返回 { ok:false, pass:true } */
  handle(a: Action): ActionResult {
    const p = this.game.sys.panels;
    switch (a.t) {
      case 'digit':
        return p.nameChoose(a.n);
      case 'choose':
        return p.nameChoose(a.k);
      case 'pick':
        return p.nameChoose(a.index + 1);
      case 'back':
        p.closeNaming();
        return ok({ mode: this.game.modes.top });
      default:
        return fail('mode_disallows');
    }
  }
  update(_dt: number): void {
    const m = this.game.modes;
    if (m.top === 'mode.panel_naming' && this.game.sys.panels.naming === null) m.pop('mode.panel_naming');
  }
}
