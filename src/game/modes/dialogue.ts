// owner: WP4
// mode.dialogue 的 ModeHandler（ARCH §4.6、附录 A）。对话：E/空格推进、1–4 选项；视角锁定（DialogueDef.lockView，默认 true）、移动禁用。
// 视图由 UI.update 按模式栈显隐（DialogueBox 读 game.sys.dialogue.active），这里不直接 show/hide。
// 自愈：栈顶这层 mode.dialogue 没有对话认领（对话结束时它不在栈顶、没能弹出）时，update 里把它弹掉。

import type { ModeId } from '../../core/types';
import { fail, ok } from '../../core/types';
import type { Action, ActionResult } from '../../core/actions';
import type { ModeCamera, ModeHandler, ModeMove } from '../../core/modes';
import type { PointerPolicy } from '../../core/input';
import type { Game } from '../../core/game';

export class DialogueMode implements ModeHandler {
  readonly id: 'mode.dialogue' = 'mode.dialogue';
  readonly transient = true;
  readonly freezesWorld = false;
  readonly pointer: PointerPolicy | ((stack: readonly ModeId[]) => PointerPolicy) = 'free';
  readonly camera: ModeCamera = 'inherit';
  readonly move: ModeMove | ((stack: readonly ModeId[]) => ModeMove) = 'none';
  readonly look: boolean | ((stack: readonly ModeId[]) => boolean) = () => !this.game.sys.dialogue.lockView();
  protected readonly game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  enter(_prev: ModeId | null, _arg?: unknown): void {
    // 对话由 DialogueSystem 压入；进入时无额外工作
  }
  exit(_next: ModeId | null): void {
    this.game.sys.dialogue.onModeExit();
  }
  /** 不合法返回 { ok:false, reason:'mode_disallows' }；需要下传时返回 { ok:false, pass:true } */
  handle(a: Action): ActionResult {
    const d = this.game.sys.dialogue;
    switch (a.t) {
      case 'advance':
      case 'play':
      case 'interact':
        return d.advance();
      case 'choose':
        return typeof a.k === 'number' ? d.choose(a.k) : fail('bad_args');
      case 'digit':
        return d.choose(a.n);
      case 'pick':
        return d.choose(a.index + 1);
      case 'back':
        // M4 第 2 轮：Esc = 暂停菜单（requestPause 自己处理“没有区域”与“过渡期间推迟”）；对话不取消
        this.game.requestPause();
        return ok();
      default:
        return fail('mode_disallows');
    }
  }
  update(_dt: number): void {
    const m = this.game.modes;
    if (m.top === 'mode.dialogue' && !this.game.sys.dialogue.ownsTopMode()) m.pop('mode.dialogue');
  }
}
