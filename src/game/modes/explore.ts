// owner: WP1
// mode.explore 的 ModeHandler（ARCH §4.6、附录 A）。探索：移动（Shift 快走）、环绕视角、E 交互、右键取景器、Tab/J/H、Esc 暂停。
// explore 永远在栈底：它不会被 push/pop，所以 enter/exit 不会被调用；其他模式以 pass 下传的动作（H 等）最终落到这里。

import type { ModeId } from '../../core/types';
import { fail, ok } from '../../core/types';
import type { Action, ActionResult } from '../../core/actions';
import type { ModeCamera, ModeHandler, ModeMove } from '../../core/modes';
import type { PointerPolicy } from '../../core/input';
import type { Game } from '../../core/game';

export class ExploreMode implements ModeHandler {
  readonly id: 'mode.explore' = 'mode.explore';
  readonly transient = false;
  readonly freezesWorld = false;
  readonly pointer: PointerPolicy | ((stack: readonly ModeId[]) => PointerPolicy) = 'lock';
  readonly camera: ModeCamera = 'tp';
  readonly move: ModeMove | ((stack: readonly ModeId[]) => ModeMove) = 'normal';
  readonly look: boolean | ((stack: readonly ModeId[]) => boolean) = true;
  protected readonly game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  enter(_prev: ModeId | null, _arg?: unknown): void {
    // 栈底模式，不会被“进入”
  }
  exit(_next: ModeId | null): void {
    // 栈底模式，不会被“退出”
  }
  /** 不合法返回 { ok:false, reason:'mode_disallows' }；需要下传时返回 { ok:false, pass:true } */
  handle(a: Action): ActionResult {
    const g = this.game;
    // M4 第 2 轮：标题画面（没有区域、标题页开着）只认 back（下面自己判）；其余动作一律不做（按键本来就不会到这里，见 InputManager.emit，这里是保险）
    if (a.t !== 'back' && (!g.areas?.current || g.ui?.menus?.currentPage() === 'title')) return fail('mode_disallows');
    switch (a.t) {
      case 'interact':
        return g.sys.interaction.interactFocused('player');
      case 'vf':
        // “按住”模式下的松开到这里时取景器已经关了（或从没开）：无事可做
        if (a.down === false) return ok();
        return g.modes.push('mode.viewfinder');
      case 'album':
        return g.modes.push('mode.album', {});
      case 'journal':
        return g.modes.push('mode.journal');
      case 'hint':
        return g.sys.hints.request();
      case 'back':
        // 标题画面（还没有区域）与建区期间不压暂停（M1c：否则标题菜单上按 Esc 会被换成暂停菜单）
        // M1d：标题页可见时同样不压（结局后回标题的过渡里区域还没卸载完）
        if (!g.areas.current || g.areas.isLoading() || g.ui.menus.currentPage() === 'title') return fail('mode_disallows');
        return g.modes.push('mode.pause');
      default:
        return fail('mode_disallows');
    }
  }
  update(_dt: number): void {
    // 探索模式没有自己的逐帧逻辑：移动与视角由 Game.step 按 move/look 交给 PlayerController 与 CameraRig
  }
}
