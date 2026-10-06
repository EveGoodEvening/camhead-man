// owner: WP4
// mode.journal 的 ModeHandler（ARCH §4.6、附录 A）。巡夜本与文档阅读器（arg: JournalArg）；冻结世界。
// Esc/J 关闭；Tab 切到相册（从相册点开的文档：回到下面那层相册；否则换成相册）。视图由 UI.update 按栈显隐。

import type { ModeId } from '../../core/types';
import { fail, ok } from '../../core/types';
import type { Action, ActionResult } from '../../core/actions';
import type { ModeCamera, ModeHandler, ModeMove } from '../../core/modes';
import type { PointerPolicy } from '../../core/input';
import type { Game } from '../../core/game';

export class JournalMode implements ModeHandler {
  readonly id: 'mode.journal' = 'mode.journal';
  readonly transient = true;
  readonly freezesWorld = true;
  readonly pointer: PointerPolicy | ((stack: readonly ModeId[]) => PointerPolicy) = 'free';
  readonly camera: ModeCamera = 'inherit';
  readonly move: ModeMove | ((stack: readonly ModeId[]) => ModeMove) = 'none';
  readonly look: boolean | ((stack: readonly ModeId[]) => boolean) = false;
  protected readonly game: Game;
  private prev: ModeId | null = null;

  constructor(game: Game) {
    this.game = game;
  }

  enter(prev: ModeId | null, arg?: unknown): void {
    this.prev = prev;
    this.game.audio.sfx('page_turn');
    // M4：翻开巡夜本本身时，眼前的新页都算看过（合上后不再弹“多了一行字”）
    if (arg === undefined) this.game.sys.journal.markVisibleSeen();
  }
  exit(_next: ModeId | null): void {
    this.game.audio.sfx('ui_close');
  }
  /** 不合法返回 { ok:false, reason:'mode_disallows' }；需要下传时返回 { ok:false, pass:true } */
  handle(a: Action): ActionResult {
    const m = this.game.modes;
    switch (a.t) {
      case 'back':
      case 'journal':
        m.pop('mode.journal');
        return ok({ mode: m.top });
      case 'album': {
        m.pop('mode.journal');
        // 从相册点开的（文档或巡夜本）：下面那层就是相册；否则切到相册
        if (!(this.prev === 'mode.album' && m.top === 'mode.album')) m.push('mode.album', { tab: 'photos' });
        return ok({ mode: m.top });
      }
      case 'nav':
        return ok();   // 翻页由阅读器 UI 自己处理
      default:
        return fail('mode_disallows');
    }
  }
  update(_dt: number): void {
    // 冻结世界：栈顶时 Game.step 不调用 modes.update
  }
}
