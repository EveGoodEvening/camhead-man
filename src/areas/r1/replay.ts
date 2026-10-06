// owner: R1-world
// R1-world 的残影点与回放片段（GDD §13.6、P1、H 旧照一二）：rp.r1_gate / seg.gate_2026、rp.r1_tree / seg.tree_1984、rp.r1_shed / seg.shed_2012。
// （rp.r1_booth / seg.booth_2023 归 R1-finale。）关键帧只做平移、朝向与关键姿势（ARCH §6.9）。

import * as THREE from 'three';
import type { Pose, V3 } from '../../core/types';
import type { ReplayActorKey, ReplayPointDef, ReplaySegmentDef } from '../../game/replay';
import { F, GHOST, NPC, RP, SEG } from '../../data/ids';
import { MATERIALS } from '../../fx/materials';
import { PROPS } from '../../kit/props';
import { R1 } from './layout';
import { TUDI } from './text';

/** 回放里被隐去的现世对象（ctx.ref 登记）：1984 年土地庙还没盖（GDD §8.9 焚化旧照一的台词）。 */
export const REF_SHRINE = 'r1w.shrine';

type P = readonly [t: number, x: number, z: number, pose?: Pose, yaw?: number];

/** 由路点生成关键帧：朝向取“朝下一个路点”（最后一个沿用前一段），可用第 5 个元素覆盖。 */
function keys(pts: readonly P[], y = 0): ReplayActorKey[] {
  const out: ReplayActorKey[] = [];
  let lastYaw = 0;
  pts.forEach((p, i) => {
    const next = pts[i + 1];
    let yaw = lastYaw;
    if (next && (Math.abs(next[1] - p[1]) > 1e-3 || Math.abs(next[2] - p[2]) > 1e-3)) {
      yaw = (Math.atan2(next[1] - p[1], -(next[2] - p[2])) * 180) / Math.PI;
      if (yaw < 0) yaw += 360;
    }
    if (p[4] !== undefined) yaw = p[4];
    lastYaw = yaw;
    out.push({ t: p[0], pos: [p[1], y, p[2]], yaw, pose: p[3] ?? 'walk' });
  });
  return out;
}

/** 把一个道具的全部网格换成回放材质（函数形式的片段道具材质由区域负责，ARCH §6.9）。 */
function asReplay(o: THREE.Object3D): THREE.Object3D {
  o.traverse(c => {
    const m = c as THREE.Mesh;
    if (m.isMesh) m.material = MATERIALS.replay();
  });
  return o;
}

// ——————————————————————————————— seg.gate_2026：今晚 23:00，王奶奶拎着篮子进了三号楼；陆师傅在门卫室窗外站了 5 秒，抬头看看门楣上的空支架，摇摇头，往东口走了

const WANG_2026: P[] = [
  [0, 0.5, 25.4], [3.5, 0.1, 22.4], [8, -1.8, 17.4], [13, -3.9, 11.6], [20, -5.7, 4.2],
];
const LU_2026: P[] = [
  [0, 1.4, 25.9], [2.5, -1.2, 22.6], [4.8, -3.9, 21.35],
  // 窗外站住，抬头看门楣上的空支架（在他西北边）
  [5.2, -3.9, 21.35, 'look_up', 320], [9.8, -3.9, 21.35, 'look_up', 322], [10.3, -3.9, 21.35, 'stand', 95],
  // 出了院门先往人行道外侧走，再往东口去（院门两扇今晚是锁着的，回放里他穿门而过；门开了以后也不从门扇里穿过去）
  [13, -1.3, 22.9], [15, 0.9, 24.8], [17, 2.0, 27.4], [20, 9.5, 27.6],
];

// ——————————————————————————————— seg.shed_2012：老周扶着后座教一个孩子骑车（在车棚东半边与门前兜圈）

const BIKE: P[] = [
  [0, 17.0, -6.6], [5, 16.6, -3.0], [9, 15.0, -1.4], [13, 13.6, -2.2], [18, 15.2, -5.6],
];
const BIKE_KEYS = keys(BIKE);
/** 老周走在后座左边一点，双手往前伸（carry）扶着车。 */
const ZHOU_2012: ReplayActorKey[] = BIKE_KEYS.map(k => {
  const r = (k.yaw * Math.PI) / 180;
  const fwd = [Math.sin(r), -Math.cos(r)] as const;
  const left = [-fwd[1], fwd[0]] as const;
  return { t: k.t, pos: [k.pos[0] - fwd[0] * 0.55 - left[0] * 0.38, 0, k.pos[2] - fwd[1] * 0.55 - left[1] * 0.38] as V3, yaw: k.yaw, pose: 'carry' as Pose };
});
const KID_2012: ReplayActorKey[] = BIKE_KEYS.map(k => ({ ...k, pos: [k.pos[0], 0.42, k.pos[2]] as V3, pose: 'sit' as Pose }));

export const REPLAY_POINTS: readonly ReplayPointDef[] = [
  { id: RP.R1_GATE, at: R1.replay.gate, segments: [SEG.GATE_2026] },
  { id: RP.R1_TREE, at: R1.replay.tree, segments: [SEG.TREE_1984] },
  { id: RP.R1_SHED, at: R1.replay.shed, segments: [SEG.SHED_2012] },
];

export const SEGMENTS: readonly ReplaySegmentDef[] = [
  {
    id: SEG.GATE_2026, point: RP.R1_GATE, order: 1, osd: '2026-08-27 23:00', dur: 20, loop: true,
    actors: [
      { id: GHOST.WANG_2026, rig: 'mannequin', character: 'wang', keys: keys(WANG_2026) },
      { id: GHOST.LU_2026, rig: 'mannequin', character: 'lu', keys: keys(LU_2026) },
    ],
    subs: [],
    // 播放头第一次越过终点：设 r1.p1_done，槐树那边传来土地的声音（画外音字幕，不打断回放；GDD P1 步骤 7）
    onComplete: g => {
      if (g.state.flag(F.R1_P1_DONE)) return;
      g.setFlag(F.R1_P1_DONE);
      g.say(TUDI.callBack, NPC.TUDI);
    },
  },
  {
    id: SEG.TREE_1984, point: RP.R1_TREE, order: 1, osd: '1984-10-01 09:30', dur: 20, loop: true,
    actors: [
      // 三十来口人，前排蹲着一群孩子；站在树北、面朝南（冲着树下的照相机）
      {
        id: GHOST.CROWD_1984, rig: 'crowd', crowd: { count: 30, cols: 10, spacing: 0.62, look: 'replay', seed: 1984, kidsFrontRow: 8 },
        keys: [{ t: 0, pos: [0, 0, -6.4], yaw: 180, pose: 'stand' }, { t: 20, pos: [0, 0, -6.4], yaw: 180, pose: 'stand' }],
      },
    ],
    props: [
      // 树下那台照相机（三脚架），合影的人冲着它
      { id: 'camera1984', mesh: () => asReplay(PROPS.bigCamera()), keys: [{ t: 0, pos: [1.1, 0, -2.3], yaw: 355 }] },
    ],
    hideWorld: [{ ref: REF_SHRINE, from: 0, to: 20 }],
    subs: [],
    sfx: [{ t: 10, cue: 'shutter' }],
  },
  {
    id: SEG.SHED_2012, point: RP.R1_SHED, order: 1, osd: '2012-06-02 19:10', dur: 18, loop: true,
    actors: [
      { id: GHOST.ZHOU_2012, rig: 'mannequin', character: 'zhou', characterOpts: { variant: 'cap' }, keys: ZHOU_2012 },
      { id: GHOST.KID_2012, rig: 'mannequin', character: 'kid', keys: KID_2012 },
    ],
    props: [
      {
        id: 'bike2012',
        mesh: () => {
          const g = new THREE.Group();
          const b = PROPS.bicycle(12);
          b.rotation.y = Math.PI / 2;
          b.scale.setScalar(0.82);
          g.add(b);
          return asReplay(g);
        },
        keys: BIKE_KEYS.map(k => ({ t: k.t, pos: k.pos, yaw: k.yaw })),
      },
    ],
    subs: [],
  },
];
