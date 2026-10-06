// owner: R2
// R2 的残影点与回放片段（GDD §13.6、P4、H 旧照四；ARCH §6.9）。关键帧是纯数据；片段道具的网格在 build 时建好（build/props.ts
// 的 replayProps），这里的 mesh 函数在 ReplaySystem.prebuild（build 之后）时取用。

import type * as THREE from 'three';
import type { ReplayActorKey, ReplayPointDef, ReplaySegmentDef } from '../../game/replay';
import type { Pose, V3 } from '../../core/types';
import { GHOST, NPC, OBJ, RP, SEG } from '../../data/ids';
import { forwardFromYaw } from '../../core/math';
import { R2, levelY } from './layout';
import { TEXT } from './text';

/** build 时填好的片段道具（menshen / box / stretcher / tv）；prebuild 取不到时给一个空组（不会发生：build 在 prebuild 之前）。 */
export const REPLAY_PROPS = new Map<string, () => THREE.Object3D>();
const prop = (key: string) => (): THREE.Object3D => {
  const f = REPLAY_PROPS.get(key);
  if (!f) throw new Error(`R2 replay prop '${key}' 没有在 build 里准备`);
  return f();
};

const Y5 = levelY(5);
const k = (t: number, x: number, z: number, yaw: number, pose: Pose, y = Y5): ReplayActorKey => ({ t, pos: [x, y, z], yaw, pose });

/** 担架：两个抬担架的人（人群 1 列 2 排，前后相距 2m）与担架道具（在两人中间、手的高度）。 */
const STRETCHER_PATH: readonly { t: number; x: number; z: number; yaw: number }[] = [
  { t: 0, x: 0.75, z: -0.7, yaw: 180 },
  { t: 2.2, x: 0.7, z: 0.9, yaw: 200 },
  { t: 3.2, x: 0.3, z: 1.2, yaw: 270 },
  { t: 6.0, x: -3.7, z: 1.2, yaw: 270 },
  { t: 8.6, x: -3.7, z: 1.2, yaw: 270 },
  { t: 12.4, x: 0.5, z: 1.2, yaw: 270 },
  { t: 14, x: 0.9, z: 1.2, yaw: 270 },
];
function stretcherProp(): { t: number; pos: V3; yaw: number }[] {
  return STRETCHER_PATH.map(p => {
    const back = forwardFromYaw(p.yaw).multiplyScalar(-1.0);   // 担架中心在前面那人身后 1m
    return { t: p.t, pos: [p.x + back.x, Y5 + 0.78, p.z + back.z] as V3, yaw: p.yaw };
  });
}

/** 建国抱纸箱（2025）：纸箱在他胸前 0.35m、1.05m 高。 */
const JG25: readonly ReplayActorKey[] = [
  k(0, -4.55, 1.2, 90, 'carry'),
  k(2.0, -3.7, 1.35, 100, 'carry'),
  k(3.2, -3.6, 1.45, 285, 'carry'),
  k(11.0, -3.6, 1.45, 285, 'carry'),
  k(12.2, -3.2, 1.2, 90, 'carry'),
  k(16, 0.4, 0.7, 70, 'carry'),
];
function carried(keys: readonly ReplayActorKey[]): { t: number; pos: V3; yaw: number }[] {
  return keys.map(a => {
    const f = forwardFromYaw(a.yaw).multiplyScalar(0.36);
    return { t: a.t, pos: [a.pos[0] + f.x, a.pos[1] + 1.02, a.pos[2] + f.z] as V3, yaw: a.yaw };
  });
}

/** 2018 春节：门神片段道具在第 6–8 秒“正在被贴上”（第 8 秒起撤掉，现世的 r2.menshen 在同一位置出现，GDD P4）。 */
const M = R2.menshenCenter;
/**
 * 门口三段进段时镜头转向的点（ReplaySegmentDef.focus，M4 第 2 轮）：502 门框中部、门神那一截。
 * 不给时引擎取人影关键帧的平均点——2019/2018 两段会转向楼梯口（东），门神与“王奶奶和门神同框”的那一下全在身后。
 */
const DOOR_FOCUS: V3 = [-4.8, Y5 + 1.3, 1.2];
/**
 * 2018 那段的焦点偏向门北侧站着的王奶奶（门神与她中间的方向）：取景器画幅 4:3，照片要求主体锚点在画面中间 ±60% 以内，
 * 离门 2m 上下时以门为中心她正好出界（GDD §11 步骤 20 在 (-2.8,1.2) 就地倒带）；偏过去以后在残影点两侧 0.8m 内门神与她
 * 都在 ±45% 左右，建国（门南侧，离镜头近）出画也无妨。
 */
const DOOR_2018_FOCUS: V3 = [-4.7, Y5 + 1.15, 0.72];
const MENSHEN_KEYS = [
  { t: 0, pos: [M[0] + 0.4, M[1], M[2]] as V3, yaw: 0, visible: false },
  { t: 6, pos: [M[0] + 0.32, M[1] - 0.05, M[2] + 0.02] as V3, yaw: 0, visible: true },
  { t: 7.4, pos: [M[0], M[1], M[2]] as V3, yaw: 0, visible: true },
  { t: 8, pos: [M[0], M[1], M[2]] as V3, yaw: 0, visible: false },
];

export const REPLAY_POINTS: readonly ReplayPointDef[] = [
  { id: RP.R2_LOBBY, at: R2.rpLobby, segments: [SEG.LOBBY_2008] },
  { id: RP.R2_DOOR, at: R2.rpDoor, segments: [SEG.DOOR_2025, SEG.DOOR_2019, SEG.DOOR_2018] },
];

export const SEGMENTS: readonly ReplaySegmentDef[] = [
  {
    // 2008 年 8 月 8 日，一楼门厅，街坊们挤着看小电视里的开幕式（旧照四）：102 把电视搬到了楼道里，大家挤在声控灯底下看
    id: SEG.LOBBY_2008, point: RP.R2_LOBBY, order: 1, osd: '2008-08-08 20:05', dur: 20, loop: true,
    actors: [
      {
        id: GHOST.NEIGHBORS_2008, rig: 'crowd', crowd: { count: 9, cols: 4, spacing: 0.62, look: 'replay', seed: 2008, kidsFrontRow: 3 },
        keys: [
          { t: 0, pos: [-2.4, 0, 1.3], yaw: 270, pose: 'stand' },
          { t: 20, pos: [-2.4, 0, 1.3], yaw: 270, pose: 'stand' },
        ],
      },
    ],
    props: [{ id: 'tv', mesh: prop('tv'), keys: [{ t: 0, pos: [-3.95, 0, 1.3], yaw: 0 }] }],
    subs: [],
  },
  {
    // 2025 年秋，建国搬家，抱着纸箱在门口站了一会儿，没揭门神
    id: SEG.DOOR_2025, point: RP.R2_DOOR, order: 1, focus: DOOR_FOCUS, osd: '2025-10-02 09:40', dur: 16, loop: true,
    actors: [{ id: GHOST.JIANGUO_2025, rig: 'mannequin', character: 'jianguo', keys: JG25 }],
    props: [{ id: 'box', mesh: prop('box'), keys: carried(JG25) }],
    subs: [],
  },
  {
    // 2019 年冬，担架从楼道口抬上来，在门口停了停，又抬下去
    id: SEG.DOOR_2019, point: RP.R2_DOOR, order: 2, focus: DOOR_FOCUS, osd: '2019-12-21 06:15', dur: 14, loop: true,
    actors: [
      {
        id: GHOST.STRETCHER_2019, rig: 'crowd', crowd: { count: 2, cols: 1, spacing: 2.0, look: 'replay', seed: 2019 },
        keys: STRETCHER_PATH.map(p => ({ t: p.t, pos: [p.x, Y5, p.z] as V3, yaw: p.yaw, pose: 'stand' as const })),
      },
    ],
    props: [{ id: 'stretcher', mesh: prop('stretcher'), keys: stretcherProp() }],
    subs: [],
  },
  {
    // 2018 年 2 月 16 日春节，建国贴门神，王奶奶站在边上喊“歪了歪了”（GDD P4）：
    // 0–6 秒门上是光的（现世门神 [0,8) 隐去），6–8 秒片段道具贴上去（左边那张歪约 8°），8 秒起现世门神在同一位置出现
    id: SEG.DOOR_2018, point: RP.R2_DOOR, order: 3, focus: DOOR_2018_FOCUS, osd: '2018-02-16 10:21', dur: 24, loop: true,
    actors: [
      {
        id: GHOST.JIANGUO_2018, rig: 'mannequin', character: 'jianguo',
        // 从楼梯口贴着走廊北墙过来（M4 第 2 轮：残影点挪到 x=-2.6 后，原来沿走廊中线走会从站在旋涡上的玩家身上穿过去）
        keys: [
          k(0, -0.8, 0.3, 270, 'walk'),
          k(2.2, -3.3, 0.35, 270, 'walk'),
          k(3.4, -4.25, 1.2, 270, 'carry'),
          k(5.6, -4.3, 1.2, 270, 'carry'),
          k(6.0, -4.35, 1.2, 270, 'raise_arm'),
          k(8.0, -4.35, 1.2, 270, 'raise_arm'),
          k(8.4, -4.2, 1.35, 270, 'stand'),
          k(10.5, -3.55, 1.7, 285, 'stand'),
          k(20, -3.55, 1.7, 290, 'stand'),
          k(24, -3.5, 1.75, 290, 'stand'),
        ],
      },
      {
        id: GHOST.WANG_2018, rig: 'mannequin', character: 'wang', characterOpts: { age: 'old' },
        keys: [
          k(0, -4.35, 0.32, 200, 'stand'),
          k(7.6, -4.35, 0.32, 230, 'stand'),
          k(8.2, -4.3, 0.36, 250, 'raise_arm'),
          k(10.5, -4.3, 0.36, 250, 'stand'),
          k(24, -4.3, 0.36, 250, 'stand'),
        ],
      },
    ],
    props: [{ id: 'menshen', mesh: prop('menshen'), keys: MENSHEN_KEYS }],
    hideWorld: [{ ref: OBJ.R2_MENSHEN, from: 0, to: 8 }],
    subs: [{ t: 8.3, dur: 2.6, speaker: NPC.WANG, text: TEXT.subs.crooked }],
  },
];
