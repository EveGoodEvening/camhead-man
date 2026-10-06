// owner: R3
// R3 的残影点与回放片段（GDD §13.6、H 表“旧照五”）。
// seg.studio_1990：1990-05-01 10:00，陆师傅在自己影棚里成婚，徒弟掌机，新娘脚边放着红双喜脸盆（22 秒）。
// 拍照窗口 6–16 秒：新娘已在坐凳上坐好，陆长明站在她右手边；11 秒徒弟捏响镁光。

import { GHOST, OBJ, RP, SEG } from '../../data/ids';
import type { ReplayPointDef, ReplaySegmentDef } from '../../game/replay';
import { PARTITION, RP_STUDIO, STOOL } from './layout';
import { TEXT } from './text';

export const REPLAY_POINTS: readonly ReplayPointDef[] = [
  { id: RP.R3_STUDIO, at: RP_STUDIO, segments: [SEG.STUDIO_1990] },
];

const doorX = (PARTITION.doorX0 + PARTITION.doorX1) / 2;

export const SEGMENTS: readonly ReplaySegmentDef[] = [
  {
    id: SEG.STUDIO_1990, point: RP.R3_STUDIO, order: 1, osd: '1990-05-01 10:00', dur: 22, loop: true,
    actors: [
      {
        // 新娘：从布帘门洞进来，走到坐凳坐下，一直坐到片段结束
        id: GHOST.BRIDE_1990, rig: 'mannequin', character: 'bride',
        keys: [
          { t: 0, pos: [doorX, 0, PARTITION.z - 0.4], yaw: 150, pose: 'walk' },
          { t: 2.2, pos: [-0.9, 0, -7.9], yaw: 150, pose: 'walk' },
          { t: 4.2, pos: [STOOL[0], 0, STOOL[2] + 0.25], yaw: 180, pose: 'walk' },
          { t: 5, pos: [STOOL[0], 0, STOOL[2]], yaw: 180, pose: 'sit' },
          { t: 22, pos: [STOOL[0], 0, STOOL[2]], yaw: 180, pose: 'sit' },
        ],
      },
      {
        // 陆长明（年轻时）：先踮脚理背景布，再站到新娘右手边；拍完扭头看她
        id: GHOST.LU_1990, rig: 'mannequin', character: 'lu', characterOpts: { age: 'young' },
        keys: [
          { t: 0, pos: [1.5, 0, -10.35], yaw: 0, pose: 'raise_arm' },
          { t: 3, pos: [1.5, 0, -10.35], yaw: 0, pose: 'raise_arm' },
          { t: 3.6, pos: [1.3, 0, -10.2], yaw: 200, pose: 'walk' },
          { t: 5.6, pos: [0.72, 0, -9.7], yaw: 185, pose: 'stand' },
          { t: 16.5, pos: [0.72, 0, -9.7], yaw: 185, pose: 'stand' },
          { t: 18, pos: [0.72, 0, -9.7], yaw: 255, pose: 'stand' },
          { t: 22, pos: [0.72, 0, -9.7], yaw: 255, pose: 'stand' },
        ],
      },
      {
        // 徒弟：站在大座机后面，11 秒举手捏镁光
        id: GHOST.APPRENTICE_1990, rig: 'mannequin', character: 'apprentice',
        keys: [
          { t: 0, pos: [-0.35, 0, -5.75], yaw: 10, pose: 'stand' },
          { t: 10.2, pos: [-0.35, 0, -5.75], yaw: 0, pose: 'stand' },
          { t: 10.8, pos: [-0.35, 0, -5.75], yaw: 0, pose: 'raise_arm' },
          { t: 12, pos: [-0.35, 0, -5.75], yaw: 0, pose: 'raise_arm' },
          { t: 12.8, pos: [-0.35, 0, -5.75], yaw: 0, pose: 'stand' },
          { t: 22, pos: [-0.35, 0, -5.75], yaw: 20, pose: 'stand' },
        ],
      },
    ],
    // 新娘脚边的红双喜脸盆（暗房里那只，GDD H 表“旧照五”）
    props: [{ id: 'basin_1990', mesh: OBJ.R3_BASIN_XI, keys: [{ t: 0, pos: [STOOL[0] - 0.42, 0, STOOL[2] + 0.28], yaw: 20, visible: true }] }],
    subs: [
      { t: 2.6, dur: 3, speaker: '', text: TEXT.replay.s1 },
      { t: 9.2, dur: 2.2, speaker: '', text: TEXT.replay.s2 },
      { t: 12.6, dur: 2.4, speaker: '', text: TEXT.replay.s3 },
    ],
    sfx: [{ t: 11, cue: 'magnesium' }],
  },
];
