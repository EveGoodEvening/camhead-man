// owner: WP5
// mode.panel_vcr 的 ModeHandler（ARCH §4.6、附录 A）。录像机面板（M6）：传输键、右键叠加取景器、E/Esc 离开。
// 叠加的取景器把未处理的传输键与 E/Esc 以 pass 下传到这里；“离开面板”时连同上面的取景器一起弹掉。

import type { ModeId } from '../../core/types';
import { fail, ok } from '../../core/types';
import type { Action, ActionResult } from '../../core/actions';
import type { ModeCamera, ModeHandler, ModeMove } from '../../core/modes';
import type { PointerPolicy } from '../../core/input';
import type { Game } from '../../core/game';

/** 面板视点的淡入时长（ARCH §6.10：这段时间里预热带子场景的着色器） */
const VIEW_BLEND = 0.3;

export class PanelVcrMode implements ModeHandler {
  readonly id: 'mode.panel_vcr' = 'mode.panel_vcr';
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
    const vcr = this.game.sys.vcr;
    const pose = vcr.viewPose;
    // 肉眼看屏幕：只有现世层，也不画自己的头（面板视点贴着头的位置），所以借 ch1 角色的掩码
    if (pose) this.game.cameras.setFixedPose(pose, VIEW_BLEND, { role: 'ch1' });
    vcr.openPanel();
    this.game.audio.sfx('ui_open');
  }

  exit(_next: ModeId | null): void {
    this.game.sys.vcr.closePanel();
    this.game.audio.sfx('ui_close');
  }

  /** 不合法返回 { ok:false, reason:'mode_disallows' }；需要下传时返回 { ok:false, pass:true } */
  handle(a: Action): ActionResult {
    const g = this.game;
    const vcr = g.sys.vcr;
    switch (a.t) {
      case 'play':
        vcr.togglePlay();
        return ok(this.status());
      case 'shuttle':
        vcr.setShuttle(a.down ? a.dir : 0);
        return ok(this.status());
      case 'stepSec':
        vcr.stepSec(a.dir);
        return ok(this.status());
      case 'index':
        vcr.jumpIndex(a.dir);
        return ok(this.status());
      case 'vf':
        if (a.down === false) return ok();
        return g.modes.top === 'mode.panel_vcr' ? g.modes.push('mode.viewfinder') : ok();
      case 'interact':
      case 'back':
        return leavePanel(g, 'mode.panel_vcr');
      case 'hint':
        return g.sys.hints.request();
      default:
        return fail('mode_disallows');
    }
  }

  private status(): { tc: string; playing: boolean; shuttle: number } {
    const v = this.game.sys.vcr;
    return { tc: v.tcString(), playing: v.playing, shuttle: v.shuttle };
  }
}

/** 离开面板：先弹掉叠在上面的取景器（及其上的一切），再弹面板本身。 */
export function leavePanel(g: Game, panel: 'mode.panel_vcr' | 'mode.panel_console'): ActionResult {
  const modes = g.modes;
  for (let guard = 0; guard < 8 && modes.top !== panel && modes.has(panel); guard++) {
    if (!modes.pop().ok) break;
  }
  const r = modes.pop(panel);
  return r.ok ? ok({ mode: modes.top }) : r;
}
