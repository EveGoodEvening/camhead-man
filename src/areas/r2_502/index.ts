// owner: R2
// R2_502 王奶奶家（GDD §4.3）：原点在入户门内；客厅 x∈[0,5]、厨房 x∈[5,7.5]，z∈[-4,0]；入户门在客厅西墙，门洞中心 (0,0,-0.8)。
// P5 灶王爷眼皮底下、旧照三。组装：text.ts / dialogue.ts（文本与过场）、data.ts（谜题、拍照目标、回放）、build/、logic.ts、shots.ts。

import * as THREE from 'three';
import { defineArea } from '../../core/area';
import { EXIT, F, SPAWN } from '../../data/ids';
import { PALETTE } from '../../data/palette';
import { MATERIALS, isSharedMaterial } from '../../fx/materials';
import { TEXT } from './text';
import { CUTSCENES, DIALOGUES } from './dialogue';
import { PHOTO_TARGETS, PUZZLES, REPLAY_POINTS, REPLAY_PROPS, SEGMENTS } from './data';
import { SHOTS } from './shots';
import { aptColliders, buildApartment } from './build/rooms';
import { buildLogic502, fireLit, type R502Runtime } from './logic';
import { resetAnim } from './anim';

/** 回放片段道具由 ReplaySystem 在 prebuild 时建、clearArea 时摘掉：几何与本区材质交给 ctx.track，随区域释放（共享材质跳过）。 */
function tracked<T extends THREE.Object3D>(ctx: Parameters<NonNullable<AreaDefBuild>>[0], obj: T): T {
  obj.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    ctx.track(m.geometry);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) if (!isSharedMaterial(mat)) ctx.track(mat);
  });
  return obj;
}
type AreaDefBuild = Parameters<typeof defineArea>[0]['build'];

let rt: R502Runtime | null = null;

export default defineArea({
  id: 'r2_502',
  name: TEXT.areaName,
  spawns: {
    [SPAWN.R2_502_DOOR]: { pos: [1.2, 0, -1.2], yaw: 90 },
  },
  exits: [
    // 入户门 (0,0,-0.8)，门洞类：触发体在门外 x∈[-1.5,0]
    { id: EXIT.R2_502_TO_R2, to: SPAWN.R2_F5, box: { center: [-0.75, 1.25, -0.8], size: [1.5, 2.5, 1.5] } },
  ],
  post: 'r2',
  // 灶火前是月光（#9DB8C8），灶火亮起后是灶火青（ARCH §8.3）
  environment: s => (fireLit(s) ? { tint: PALETTE.STOVE, intensity: 0.95 } : { tint: '#9DB8C8', intensity: 0.95 }),
  // GDD §9.5：挂钟滴答、房间底噪、窗外的雨；灶火亮了之后是褐噪声闪烁的灶火声
  ambience: s => [
    { preset: 'clock_tick', gain: -24, at: [3.3, 1.95, -3.9] },
    { preset: 'room_tone', gain: -22 },
    { preset: 'rain', gain: -32, at: [2.6, 1.5, 0.5] },
    ...(s.flag(F.R2_WANG_DONE) ? [{ preset: 'stove_fire' as const, gain: -18, at: [7.0, 1.0, -1.5] as const }] : []),
  ],
  photoTargets: PHOTO_TARGETS,
  replayPoints: REPLAY_POINTS,
  segments: SEGMENTS,
  dialogues: DIALOGUES,
  cutscenes: CUTSCENES,
  docs: TEXT.docs,
  puzzles: PUZZLES,
  shots: SHOTS,
  build(ctx) {
    resetAnim();
    ctx.fog('#0B0D12', 0.06);
    ctx.background('#050608');
    const apt = buildApartment(ctx);
    aptColliders(ctx);
    const replay = MATERIALS.replay();
    REPLAY_PROPS.clear();
    REPLAY_PROPS.set('board', () => tracked(ctx, (() => {
      const g = new THREE.Group();
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.35), replay);
      g.add(board);
      for (let i = 0; i < 9; i++) {
        const w = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), replay);
        w.position.set(-0.18 + (i % 3) * 0.08, 0.03, -0.08 + Math.floor(i / 3) * 0.08);
        g.add(w);
      }
      return g;
    })()));
    REPLAY_PROPS.set('stool', () => tracked(ctx, (() => {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.26), replay);
      seat.position.y = 0.28;
      g.add(seat);
      for (const [x, z] of [[-0.14, -0.1], [0.14, -0.1], [-0.14, 0.1], [0.14, 0.1]] as const) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.28, 0.03), replay);
        leg.position.set(x, 0.14, z);
        g.add(leg);
      }
      return g;
    })()));
    rt = buildLogic502(ctx, apt);
  },
  update(_ctx, dt) {
    rt?.update(dt);
  },
  onFlag(_ctx, e) {
    rt?.onFlag(e);
  },
  onExit() {
    rt = null;
  },
});
