// owner: WP5
// mode.replay 的 ModeHandler（ARCH §4.6、附录 A）。回放：总压在 viewfinder 之上；空格/Z/C/逗号句号/F/R（Tab、J 不可用）。
// 进入回放的布置（让位、后期、图层、人影）由 ReplaySystem.pressR 做；本模式被弹出/重置时交还给 ReplaySystem.exit('mode')。

import type { ModeId } from '../../core/types';
import { fail, ok } from '../../core/types';
import type { Action, ActionResult } from '../../core/actions';
import type { ModeCamera, ModeHandler, ModeMove } from '../../core/modes';
import type { PointerPolicy } from '../../core/input';
import type { Game } from '../../core/game';

export class ReplayMode implements ModeHandler {
  readonly id: 'mode.replay' = 'mode.replay';
  readonly transient = true;
  readonly freezesWorld = false;
  readonly pointer: PointerPolicy | ((stack: readonly ModeId[]) => PointerPolicy) = 'lock';
  readonly camera: ModeCamera = 'fp';
  readonly move: ModeMove | ((stack: readonly ModeId[]) => ModeMove) = 'slow';
  readonly look: boolean | ((stack: readonly ModeId[]) => boolean) = true;
  protected readonly game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  enter(_prev: ModeId | null, _arg?: unknown): void {
    // ReplaySystem.pressR 在 push 之前已布置好片段
  }

  exit(_next: ModeId | null): void {
    // popToBase / resetTo / 传送 弹掉回放时，复原让位、hideWorld、后期与图层（reason 'mode'：不再 pop）
    this.game.sys.replay.exit('mode');
  }

  /** 不合法返回 { ok:false, reason:'mode_disallows' }；需要下传时返回 { ok:false, pass:true } */
  handle(a: Action): ActionResult {
    const g = this.game;
    const rp = g.sys.replay;
    const vf = g.sys.viewfinder;
    switch (a.t) {
      case 'play':
        rp.togglePlay();
        return ok({ playing: rp.active?.playing ?? false });
      case 'seekRel':
        rp.seekRel(a.sec);
        return ok({ t: rp.active?.t ?? 0 });
      case 'stepSec':
        rp.stepSec(a.dir);
        return ok({ t: rp.active?.t ?? 0 });
      case 'present':
      case 'back':
        return rp.present();
      case 'rewind':
        return rp.pressR();
      case 'vf': {
        // 右键：退出回放与取景器（hold 模式按下时不处理）
        if (a.down === true) return ok();
        rp.exit('exit');
        const r = g.modes.top === 'mode.viewfinder' ? g.modes.pop('mode.viewfinder') : ok();
        return r.ok ? ok({ on: false }) : r;
      }
      case 'shutter':
        return g.sys.photo.shoot();
      case 'lens':
        return vf.setLens(vf.lens === 'ir' ? 'normal' : 'ir');
      case 'zoom':
        return ok({ zoom: vf.stepZoom(a.dir) });
      case 'interact':
        return g.sys.interaction.interactFocused('player');
      case 'hint':
        return g.sys.hints.request();
      default:
        return fail('mode_disallows');
    }
  }
}
