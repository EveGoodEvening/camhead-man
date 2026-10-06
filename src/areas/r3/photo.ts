// owner: R3
// R3 的拍照目标、诱饵、读字目标（GDD §7.3、H 表、P7 错误反馈；ARCH §6.8.3、§6.8.6）。

import { F, GHOST, OBJ, PT, RD, SEG } from '../../data/ids';
import type { InteractId } from '../../data/ids';
import { E } from '../../game/effects';
import type { PhotoDecoyDef, PhotoTargetDef } from '../../game/photo';
import type { ReadTargetDef } from '../../game/read';
import type { V3 } from '../../core/types';
import { EASEL, GRID_CENTER } from './layout';
import { TEXT } from './text';

/** 画架上画布的中心（画架朝西：局部 (0, 1.18, -0.07) 转 90°，见 build/studio.ts）。 */
export const EASEL_CANVAS_AT: V3 = [EASEL[0] - 0.07, 1.18, EASEL[2]];

export const PHOTO_TARGETS: readonly PhotoTargetDef[] = [
  {
    // 底片第三格：老周给摄像头扣铁皮帽子（GDD P7 解法 6）
    id: PT.FILM3,
    subjects: [{ ref: OBJ.R3_FILM_FRAME3 }],
    maxDist: 1.5, minZoom: 2, lens: 'normal',
    context: { kind: 'live' },
    when: F.R3_FILM_HUNG,
    onHit: [E.flag(F.R3_FILM_DEVELOPED)],
  },
  {
    // 旧照五：1990 年陆师傅在自己影棚里成婚（GDD H 表；前置 r3.lu_door_open）
    id: PT.OLD_5,
    subjects: [{ ref: GHOST.LU_1990 }, { ref: GHOST.BRIDE_1990 }],
    maxDist: 8, minZoom: 1, lens: 'normal',
    context: { kind: 'replay', segment: SEG.STUDIO_1990, t: [6, 16] },
    when: F.R3_LU_DOOR_OPEN,
  },
];

/** 底片第一、二、四格：空镜 + 专属标题（GDD P7 错误反馈）。 */
function filmDecoy(key: PhotoDecoyDef['key'], ref: InteractId, caption: string): PhotoDecoyDef {
  return { key, subjects: [{ ref }], caption, maxDist: 1.5, minZoom: 2, lens: 'normal', context: { kind: 'live' }, when: F.R3_FILM_HUNG };
}

export const PHOTO_DECOYS: readonly PhotoDecoyDef[] = [
  filmDecoy('decoy.r3.film1', OBJ.R3_FILM_FRAME1, TEXT.cap.film1),
  filmDecoy('decoy.r3.film2', OBJ.R3_FILM_FRAME2, TEXT.cap.film2),
  filmDecoy('decoy.r3.film4', OBJ.R3_FILM_FRAME4, TEXT.cap.film4),
];

export const READ_TARGETS: readonly ReadTargetDef[] = [
  {
    // 取件格编号：取景器 ≥2×（GDD §7.3）
    id: RD.PICKUP_NUMBERS,
    at: GRID_CENTER,
    maxDist: 4.5, minZoom: 2, lens: 'normal', frameBox: 0.6,
    text: TEXT.read.pickup,
  },
  {
    // 遗像铅笔底稿：红外取景器（GDD §7.3；遗像交出去之后画架空了）
    id: RD.PORTRAIT_SKETCH,
    at: EASEL_CANVAS_AT,
    maxDist: 4, minZoom: 1, lens: 'ir',
    when: `!${F.R3_SAW_TRUE_FORM}`,
    text: TEXT.read.sketch,
  },
];
