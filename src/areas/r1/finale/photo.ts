// owner: R1-finale
// 终章的拍照目标、诱饵与读字目标（GDD §7.3、P12、P13、P14；ARCH §6.8.3、§6.11）。

import type { PhotoContext, PhotoDecoyDef, PhotoTargetDef } from '../../../game/photo';
import type { ReadTargetDef } from '../../../game/read';
import { F, NPC, OBJ, PT, RD } from '../../../data/ids';
import { R1 } from '../layout';
import { TAPE, tapeSec } from '../../../data/time';
import { E } from '../../../game/effects';
import type { GameApi } from '../../../game/effects';
import { P12, P13 } from './text';
import { PORTRAIT_AT, PORTRAIT_SIZE, rt } from './stage';
import { CS } from './cutscenes';

const S = (tc: string): number => tapeSec(tc);

/**
 * 照妖镜拍中以后：老周先藏着（面板视点就在他趴着的椅子上方 0.3m），等玩家关掉监控台（从屏幕上抬起头）再播显形过场
 * cs.r1.fin_zhou_appear（屋角 CH2 里他一点点显出来）。这段 run 一直挂着：面板开着时 settle 为 'waiting'（等玩家），
 * 关掉面板以后接着播完过场才 idle。区域卸载/模式重置取消 scope 时交还不透明度。
 */
async function appearAfterPanel(g: GameApi): Promise<void> {
  const r = rt();
  if (r) r.zhouReveal = 0;
  const onPanel = (): boolean => g.modes.stack.includes('mode.panel_console') || g.modes.stack.includes('mode.panel_vcr');
  while (onPanel() && !g.cancelled) await g.run([E.wait(0.1)]);
  if (g.cancelled) {
    if (r && rt() === r) r.zhouReveal = null;
    return;
  }
  await g.cutscene(CS.ZHOU_APPEAR);
  if (r && rt() === r) r.zhouReveal = null;
}

/** P12 错误反馈：按暂停时刻给的空镜标题（同一时刻永远同一句，GDD P12 的表）。 */
export function tapeCaption(c: PhotoContext): string {
  if (c.kind !== 'vcr') return P12.tapeCaption.empty;
  const tc = c.tc;
  const C = P12.tapeCaption;
  if (tc >= S('23:04:00') && tc < S('23:06:00')) return C.sleeve;
  if (tc >= S('00:30:00') && tc < S('01:10:00')) return C.chin;
  if (tc >= S('03:12:00') && tc < S('03:14:00')) return C.capTop;
  if (tc > S('03:14:15') && tc < S(TAPE.watchedAt)) return C.headDown;
  if (tc >= S(TAPE.watchedAt)) return C.gone;
  return C.empty;
}

export const PHOTO_TARGETS: readonly PhotoTargetDef[] = [
  // P12：录像机面板上暂停在 03:14:00–03:14:15，取景器对准 CRT（常光）
  {
    id: PT.TAPE_FACE,
    subjects: [{ ref: OBJ.R1_CRT }],
    maxDist: 1.5, minZoom: 1, lens: 'normal',
    context: { kind: 'vcr', paused: true, tc: TAPE.faceWindow },
    when: F.R1_TAPE_IN_VCR,
    // 看到正脸：主动机（GDD §9.5）
    onHit: [E.music('motif_dea')],
    captions: {
      too_early: c => tapeCaption(c),
      too_late: c => tapeCaption(c),
      not_paused: P12.notPaused,
      wrong_lens: P12.screenHeat,
    },
  },
  // P13：视频线插在“视频入1”，监控台 CH1，取景器 1× 对准 CRT（照妖镜）
  {
    id: PT.ZHOU_TUNNEL,
    subjects: [{ ref: OBJ.R1_CRT }],
    minScreenFrac: 0.4, maxDist: 1.5, minZoom: 1, maxZoom: 1, lens: 'normal',
    context: { kind: 'console', channel: 1, jack: true },
    when: F.R1_PORTRAIT_COMPLETE,
    // 老周显形，并记为“看见过”（此后常光下可见、可交互；GDD §7.3、P13“完成后”）。
    // M4：显形放进一段短过场（屋角 CH2 看他在椅子上一点点显出来、旁白），不在面板视点上贴脸显形（近裁面切开一大块青影）：
    // 过场等玩家从监控台上抬起头（面板关掉）才播——区域弹不了面板，叠在面板上播完又得回到贴着他的面板视点（appearAfterPanel）
    onHit: [E.flag(F.R1_ZHOU_VISIBLE), E.seen(NPC.ZHOU), E.music('motif_dea'), E.call(appearAfterPanel)],
    captions: {
      cond: P13.tunnelEmpty,
      zoom_high: P13.zoomHigh,
      wrong_lens: P12.screenHeat,
      wrong_channel: c => P13.wrongChannel(c.kind === 'console' ? c.channel : 1),
    },
  },
  // P14：三脚架合影（只登记元数据，判定在 TripodSystem；ARCH §6.8.3）
  {
    id: PT.FINAL,
    subjects: [{ ref: NPC.ZHOU }, { ref: 'pc.body' }],
    maxDist: 99, minZoom: 1, lens: 'normal',
    context: { kind: 'tripod', zone: OBJ.R1_MARK_PHOTO, radius: R1.markPhotoRadius, stillSec: 3 },
    when: F.R1_ZHOU_FED,
  },
];

/** 拍镜子：“镜子里只有一台旧摄像头。”（GDD P13 错误反馈） */
export const PHOTO_DECOYS: readonly PhotoDecoyDef[] = [
  { key: 'decoy.r1.fin_mirror', subjects: [{ ref: OBJ.R1_MIRROR }], caption: P13.mirror, maxDist: 3, lens: 'any', context: { kind: 'live' }, priority: -1 },
];

/** 红外看桌上的遗像：铅笔稿透出来（GDD §7.3 rd.portrait_sketch；R3 在画架上另登记一份，各区各管各的）。 */
export const READ_TARGETS: readonly ReadTargetDef[] = [
  {
    id: RD.PORTRAIT_SKETCH,
    at: [PORTRAIT_AT[0], PORTRAIT_AT[1] + PORTRAIT_SIZE.h / 2, PORTRAIT_AT[2]],
    maxDist: 2.2, minZoom: 1, lens: 'ir',
    when: `${F.R1_PORTRAIT_PLACED} && !${F.R1_PORTRAIT_COMPLETE}`,
    text: P13.sketch,
  },
];
