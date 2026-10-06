// owner: R2
// R2_502 的谜题（P5）、拍照目标（旧照三）、残影点与回放片段（seg.kitchen_1986）——GDD §5 P5、§7.3、H 表、§13.6。

import type { PuzzleDef } from '../../game/hints';
import type { PhotoTargetDef } from '../../game/photo';
import type { ReplayPointDef, ReplaySegmentDef, ReplayActorKey } from '../../game/replay';
import type { Pose } from '../../core/types';
import type * as THREE from 'three';
import { F, GHOST, NPC, OBJ, PT, PZ, RP, SEG } from '../../data/ids';
import { TEXT } from './text';
import { L502 } from './layout';

export const PUZZLES: readonly PuzzleDef[] = [
  {
    id: PZ.P05_KITCHEN_GOD, order: 5, area: 'r2_502',
    available: F.R2_MENSHEN_OPEN,
    done: F.R2_WANG_DONE,
    hints: TEXT.hints.p5,
    // 空闲闪烁：还没抠开铁盒 → 灶君（看他眼珠往哪儿瞟）；抠开了 → 王奶奶
    target: s => (s.flag(F.R2_TIN_OPENED) ? NPC.WANG : OBJ.R2_ZAOJUN),
  },
];

export const PHOTO_TARGETS: readonly PhotoTargetDef[] = [
  {
    // 旧照三：1986 年，灶台前，年轻的王奶奶教小建国包馄饨（H 表：时间窗 3–15 秒，前置 r2.menshen_open）
    id: PT.OLD_3,
    subjects: [{ ref: GHOST.WANG_1986 }, { ref: GHOST.JIANGUO_1986 }],
    maxDist: 8, minZoom: 1, lens: 'normal',
    context: { kind: 'replay', segment: SEG.KITCHEN_1986, t: [3, 15] },
    when: F.R2_MENSHEN_OPEN,
  },
];

/** build 时准备好的片段道具（案板与馄饨、小板凳）。 */
export const REPLAY_PROPS = new Map<string, () => THREE.Object3D>();
const prop = (key: string) => (): THREE.Object3D => {
  const f = REPLAY_PROPS.get(key);
  if (!f) throw new Error(`R2_502 replay prop '${key}' 没有在 build 里准备`);
  return f();
};

const k = (t: number, x: number, z: number, yaw: number, pose: Pose, y = 0): ReplayActorKey => ({ t, pos: [x, y, z], yaw, pose });

export const REPLAY_POINTS: readonly ReplayPointDef[] = [
  // 站在旋涡边上时要低头看它（GDD 步骤 23 的站位离旋涡只有 0.2m），视角要求放宽到 70°
  { id: RP.R2_KITCHEN, at: L502.rpKitchen, segments: [SEG.KITCHEN_1986], lookAngle: 70 },
];

export const SEGMENTS: readonly ReplaySegmentDef[] = [
  {
    id: SEG.KITCHEN_1986, point: RP.R2_KITCHEN, order: 1, osd: '1986-02-08 16:30', dur: 20, loop: true,
    actors: [
      {
        id: GHOST.WANG_1986, rig: 'mannequin', character: 'wang', characterOpts: { age: 'young' },
        keys: [k(0, 6.25, -1.85, 90, 'stand'), k(6, 6.25, -1.85, 100, 'carry'), k(12, 6.25, -1.85, 70, 'carry'), k(20, 6.25, -1.85, 90, 'stand')],
      },
      {
        // 小建国站在小板凳上够着灶台
        id: GHOST.JIANGUO_1986, rig: 'mannequin', character: 'jianguo', characterOpts: { age: 'young' },
        keys: [k(0, 6.2, -1.05, 60, 'stand', 0.3), k(8, 6.2, -1.05, 80, 'carry', 0.3), k(14, 6.2, -1.05, 30, 'raise_arm', 0.3), k(20, 6.2, -1.05, 60, 'stand', 0.3)],
      },
    ],
    props: [
      { id: 'board', mesh: prop('board'), keys: [{ t: 0, pos: [6.95, 0.82, -1.55], yaw: 0 }] },
      { id: 'stool', mesh: prop('stool'), keys: [{ t: 0, pos: [6.2, 0, -1.05], yaw: 0 }] },
    ],
    subs: [],
  },
];
