// owner: WP5
// mode.viewfinder 的 ModeHandler（ARCH §4.6、附录 A）。取景器；叠在 panel_vcr/panel_console 上时视角禁用、指针释放，传输键与 E/Esc 以 pass 下传给面板（ARCH §4.6 叠加规则）。

import type { ModeId } from '../../core/types';
import { fail, ok } from '../../core/types';
import type { Action, ActionResult } from '../../core/actions';
import type { ModeCamera, ModeHandler, ModeMove } from '../../core/modes';
import type { PointerPolicy } from '../../core/input';
import type { Game } from '../../core/game';
import { vfOnPanel } from '../viewfinder';

/** 取景器是否叠在录像机/监控台面板上（ARCH §4.6 叠加规则）。 */
const onPanel = (stack: readonly ModeId[]): boolean => vfOnPanel(stack);
/** 下传给下一层（面板）。 */
const PASS: ActionResult = { ok: false, pass: true };

export class ViewfinderMode implements ModeHandler {
  readonly id: 'mode.viewfinder' = 'mode.viewfinder';
  readonly transient = false;
  readonly freezesWorld = false;
  readonly pointer: PointerPolicy | ((stack: readonly ModeId[]) => PointerPolicy) = stack => (onPanel(stack) ? 'free' : 'lock');
  readonly camera: ModeCamera = 'fp';
  readonly move: ModeMove | ((stack: readonly ModeId[]) => ModeMove) = stack => (onPanel(stack) ? 'none' : 'slow');
  readonly look: boolean | ((stack: readonly ModeId[]) => boolean) = stack => !onPanel(stack);
  protected readonly game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  /** M4：这次进取景器是不是“按住”模式下真按着右键进来的（调试 API 的 vf(true) 是合成的一次按下，不算） */
  private heldEntry = false;

  enter(_prev: ModeId | null, _arg?: unknown): void {
    const g = this.game;
    this.heldEntry = g.settings.vfMode === 'hold' && g.input.isHeld('MouseRight');
    g.sys.viewfinder.setOn(true);
  }

  exit(_next: ModeId | null): void {
    // 栈上可能还有另一层取景器（取景器 → 面板 → 面板上叠的取景器）：pop 先出栈再调 exit，这里看到的是弹掉之后的栈（M1d）
    this.game.sys.viewfinder.setOn(this.game.modes.has('mode.viewfinder'));
  }

  /** 不合法返回 { ok:false, reason:'mode_disallows' }；需要下传时返回 { ok:false, pass:true } */
  handle(a: Action): ActionResult {
    const g = this.game;
    const panel = onPanel(g.modes.stack);
    const vf = g.sys.viewfinder;
    switch (a.t) {
      case 'shutter':
        return g.sys.photo.shoot();
      case 'vf':
        // hold 模式：按下时已在取景器里，什么也不做；松开（或 toggle 模式的一次点击）= 退出（叠在面板上时 = 回到面板）
        return a.down === true ? ok({ on: true }) : this.leave();
      case 'back':
        return panel ? PASS : this.leave();
      case 'interact':
        return panel ? PASS : g.sys.interaction.interactFocused('player');
      case 'lens':
        // 面板上叠加取景器时不强制常光（ARCH §6.8.1）
        return vf.setLens(vf.lens === 'ir' ? 'normal' : 'ir');
      case 'zoom':
        return ok({ zoom: vf.stepZoom(a.dir) });
      case 'rewind':
        // 残影点在任何面板模式下都不响应 R（GDD §3.4）
        return panel ? fail('mode_disallows') : g.sys.replay.pressR();
      case 'play':
      case 'shuttle':
      case 'stepSec':
      case 'index':
      case 'digit':
        return panel ? PASS : fail('mode_disallows');
      case 'hint':
        return panel ? PASS : g.sys.hints.request();
      case 'album':
        return panel ? fail('mode_disallows') : g.modes.push('mode.album', {});
      case 'journal':
        return panel ? fail('mode_disallows') : g.sys.journal.openJournal();
      default:
        return fail('mode_disallows');
    }
  }

  /**
   * M4：“按住”模式下，按住右键时打开相册/巡夜本/暂停再在那里松开——松开事件被上层模式的 KEYMAP 丢掉，回来后取景器卡在打开状态。
   * 回到栈顶时右键已经没按着就退出。只管真按着右键进来的那次（调试 API 的 vf(true) 是合成的按下，右键本来就没按着，不退）。
   */
  update(_dt: number): void {
    const g = this.game;
    if (!this.heldEntry || g.settings.vfMode !== 'hold') return;
    if (g.modes.top !== 'mode.viewfinder' || onPanel(g.modes.stack)) return;
    if (!g.input.isHeld('MouseRight')) {
      this.heldEntry = false;
      this.leave();
    }
  }

  private leave(): ActionResult {
    const r = this.game.modes.pop('mode.viewfinder');
    return r.ok ? ok({ on: false }) : r;
  }
}
