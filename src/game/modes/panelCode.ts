// owner: WP4
// mode.panel_code 的 ModeHandler（ARCH §4.6、附录 A）。密码转轮锁：数字键、滚轮 → wheel、Enter 确认、Backspace 删除、Esc 离开。
// 逻辑在 PanelSystem（转轮 + 光标模型，见 game/panels.ts 文件头）；视图由 UI.update 按栈显隐（CodePanel 读 game.sys.panels.code）。

import type { ModeId } from '../../core/types';
import { fail, ok } from '../../core/types';
import type { Action, ActionResult } from '../../core/actions';
import type { ModeCamera, ModeHandler, ModeMove } from '../../core/modes';
import type { PointerPolicy } from '../../core/input';
import type { Game } from '../../core/game';

export class PanelCodeMode implements ModeHandler {
  readonly id: 'mode.panel_code' = 'mode.panel_code';
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
    this.game.sys.panels.onCodeModeExit();
    this.game.audio.sfx('ui_close');
  }
  /** 不合法返回 { ok:false, reason:'mode_disallows' }；需要下传时返回 { ok:false, pass:true } */
  handle(a: Action): ActionResult {
    const p = this.game.sys.panels;
    switch (a.t) {
      case 'digit':
        return p.codeDigit(a.n);
      case 'wheel':
      case 'zoom':
        return p.codeWheel(a.dir);
      case 'confirm':
        return p.codeConfirm();
      case 'erase':
        return p.codeErase();
      case 'back':
        p.closeCode();
        return ok({ mode: this.game.modes.top });
      default:
        return fail('mode_disallows');
    }
  }
  update(_dt: number): void {
    // 自愈：状态已清（例如区域清理）而模式还在栈顶
    const m = this.game.modes;
    if (m.top === 'mode.panel_code' && this.game.sys.panels.code === null) m.pop('mode.panel_code');
  }
}
