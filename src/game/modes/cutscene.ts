// owner: WP4
// mode.cutscene 的 ModeHandler（ARCH §4.6、附录 A）。过场：左键 → await shutter、滚轮 → await zoom、重看时按空格跳过。
// Action 不带按键时长，“长按空格跳过”简化为按一下（engine-wp4.md）。自愈同 DialogueMode。

import type { ModeId } from '../../core/types';
import { fail, ok } from '../../core/types';
import type { Action, ActionResult } from '../../core/actions';
import type { ModeCamera, ModeHandler, ModeMove } from '../../core/modes';
import type { PointerPolicy } from '../../core/input';
import type { Game } from '../../core/game';

export class CutsceneMode implements ModeHandler {
  readonly id: 'mode.cutscene' = 'mode.cutscene';
  readonly transient = true;
  readonly freezesWorld = false;
  readonly pointer: PointerPolicy | ((stack: readonly ModeId[]) => PointerPolicy) = 'free';
  readonly camera: ModeCamera = 'fixed';
  readonly move: ModeMove | ((stack: readonly ModeId[]) => ModeMove) = 'none';
  readonly look: boolean | ((stack: readonly ModeId[]) => boolean) = false;
  protected readonly game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  enter(_prev: ModeId | null, _arg?: unknown): void {
    // 过场由 CutsceneSystem 压入（它已把固定相机摆到当前画面）
  }
  exit(_next: ModeId | null): void {
    this.game.sys.cutscene.onModeExit();
  }
  /** 不合法返回 { ok:false, reason:'mode_disallows' }；需要下传时返回 { ok:false, pass:true } */
  handle(a: Action): ActionResult {
    const c = this.game.sys.cutscene;
    switch (a.t) {
      case 'shutter':
        return c.onShutter();
      case 'zoom':
        return c.onZoom(a.dir);
      case 'play':
        return c.trySkip();
      case 'back':
        // M4 第 2 轮：Esc = 暂停菜单（暂停冻结世界、挂起音频，过场停在原处）
        this.game.requestPause();
        return ok();
      default:
        return fail('mode_disallows');
    }
  }
  update(_dt: number): void {
    const m = this.game.modes;
    if (m.top === 'mode.cutscene' && !this.game.sys.cutscene.ownsTopMode()) m.pop('mode.cutscene');
  }
}
