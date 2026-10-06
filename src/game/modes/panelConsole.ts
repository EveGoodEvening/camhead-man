// owner: WP5
// mode.panel_console 的 ModeHandler（ARCH §4.6、附录 A）。监控台面板（M7）：1–5 切频道、右键叠加取景器、E/Esc 离开。

import type { ModeId } from '../../core/types';
import { fail, ok } from '../../core/types';
import type { Action, ActionResult } from '../../core/actions';
import type { ModeCamera, ModeHandler, ModeMove } from '../../core/modes';
import type { PointerPolicy } from '../../core/input';
import type { Game } from '../../core/game';
import { leavePanel } from './panelVcr';

const VIEW_BLEND = 0.3;

export class PanelConsoleMode implements ModeHandler {
  readonly id: 'mode.panel_console' = 'mode.panel_console';
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
    const cctv = this.game.sys.cctv;
    const pose = cctv.viewPose;
    // 肉眼看屏幕：只有现世层、不画自己的头（借 ch1 角色的掩码，同 panel_vcr）
    if (pose) this.game.cameras.setFixedPose(pose, VIEW_BLEND, { role: 'ch1' });
    cctv.setLayout('single');   // 打开面板时回到单画面（ARCH §6.11）
    this.game.audio.sfx('ui_open');
  }

  exit(_next: ModeId | null): void {
    this.game.audio.sfx('ui_close');
  }

  /** 不合法返回 { ok:false, reason:'mode_disallows' }；需要下传时返回 { ok:false, pass:true } */
  handle(a: Action): ActionResult {
    const g = this.game;
    switch (a.t) {
      case 'digit': {
        const n = a.n;
        if (n !== 1 && n !== 2 && n !== 3 && n !== 4 && n !== 5) return fail('bad_args');
        return g.sys.cctv.select(n);
      }
      case 'vf':
        if (a.down === false) return ok();
        return g.modes.top === 'mode.panel_console' ? g.modes.push('mode.viewfinder') : ok();
      case 'interact':
      case 'back':
        return leavePanel(g, 'mode.panel_console');
      case 'hint':
        return g.sys.hints.request();
      default:
        return fail('mode_disallows');
    }
  }
}
