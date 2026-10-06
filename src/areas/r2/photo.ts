// owner: R2
// R2 的拍照目标（GDD §7.3、H 表；ARCH §6.8.3）。失败标题照抄 GDD P4 的错误反馈。

import type { PhotoTargetDef } from '../../game/photo';
import { F, GHOST, OBJ, PT, SEG } from '../../data/ids';
import { TEXT } from './text';

export const PHOTO_TARGETS: readonly PhotoTargetDef[] = [
  {
    // 王奶奶的影子与门神同时进画（片段 [0,8) 秒里 r2.menshen 隐去，由片段道具代演贴门神）
    id: PT.MENSHEN_2018,
    // M4 第 2 轮：王奶奶的判定锚点在胸口（1.15m），不用包围盒中心（腰，0.75m）——“她和门神同框”看的是上半身；
    // 在门口残影点旁进段、镜头自己转向门神（俯仰 -15°）时，腰上的锚点正好压在画框下沿 60% 外，拍成“得一块儿进画”
    subjects: [{ ref: GHOST.WANG_2018, anchor: [0, 1.15, 0] }, { ref: OBJ.R2_MENSHEN }],
    maxDist: 5, minZoom: 1, lens: 'normal',
    context: { kind: 'replay', segment: SEG.DOOR_2018, t: [8, 20] },
    priority: 2,
    captions: {
      // 第 6 秒前：门上还是光的；第 6–8 秒：还没贴好呢（GDD P4）
      too_early: c => (c.kind === 'replay' && c.t >= 6 ? TEXT.cap.notYet : TEXT.cap.doorBare),
      partial: TEXT.cap.together,
    },
  },
  {
    id: PT.DOOR_2019,
    subjects: [{ ref: GHOST.STRETCHER_2019 }],
    maxDist: 6, minZoom: 1, lens: 'normal',
    context: { kind: 'replay', segment: SEG.DOOR_2019, t: [3, 12] },
    priority: 1,
  },
  {
    id: PT.DOOR_2025,
    subjects: [{ ref: GHOST.JIANGUO_2025 }],
    maxDist: 6, minZoom: 1, lens: 'normal',
    context: { kind: 'replay', segment: SEG.DOOR_2025, t: [2, 14] },
    priority: 1,
  },
  {
    // 旧照四：2008 年 8 月 8 日，一楼门厅看开幕式的街坊（H 表：时间窗 5–15 秒，前置 r1.ability_replay）
    id: PT.OLD_4,
    subjects: [{ ref: GHOST.NEIGHBORS_2008 }],
    maxDist: 8, minZoom: 1, lens: 'normal',
    context: { kind: 'replay', segment: SEG.LOBBY_2008, t: [5, 15] },
    when: F.R1_ABILITY_REPLAY,
  },
];
