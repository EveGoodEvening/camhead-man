// owner: R2
// R2 三号楼一单元（GDD §4.2）：五个楼层节点，第 n 层走廊地面 y = 2.8(n-1)。P3 声控灯、P4 门神认人、旧照四。
// 组装：text.ts / dialogue.ts（文本）、puzzles.ts、photo.ts、replay.ts（数据）、build/（场景）、logic.ts（玩法）、shots.ts（机位）。

import * as THREE from 'three';
import { defineArea } from '../../core/area';
import type { ExitDef } from '../../core/area';
import { EXIT, F, SPAWN } from '../../data/ids';
import { PALETTE } from '../../data/palette';
import { MATERIALS, isSharedMaterial } from '../../fx/materials';
import { TEXT } from './text';
import { DIALOGUES } from './dialogue';
import { PUZZLES } from './puzzles';
import { PHOTO_TARGETS } from './photo';
import { REPLAY_POINTS, REPLAY_PROPS, SEGMENTS } from './replay';
import { SHOTS } from './shots';
import { levelY } from './layout';
import { r2Mats } from './build/mats';
import { buildFloors } from './build/floors';
import { menshenPair, replayBox, replayStretcher, replayTv } from './build/props';
import { tvScreenTexture } from './build/paint';
import { buildLogic, type R2Runtime } from './logic';
import { resetPaperTalk } from './anim';

const trigger = (x: number, y: number, z: number): NonNullable<ExitDef['box']> => ({ center: [x, y + 1.25, z], size: [1.5, 2.5, 1.5] });

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

let rt: R2Runtime | null = null;

export default defineArea({
  id: 'r2',
  name: TEXT.areaName,
  spawns: {
    [SPAWN.R2_LOBBY]: { pos: [0, 0, 3.8], yaw: 0, floor: 1 },
    [SPAWN.R2_F2]: { pos: [0, levelY(2), 1.8], yaw: 0, floor: 2 },
    [SPAWN.R2_F3]: { pos: [0, levelY(3), 1.8], yaw: 0, floor: 3 },
    [SPAWN.R2_F4]: { pos: [0, levelY(4), 1.8], yaw: 0, floor: 4 },
    [SPAWN.R2_F5]: { pos: [0, levelY(5), 1.8], yaw: 270, floor: 5 },
  },
  exits: [
    // 单元门 (0,0,5)，门洞类：触发体在门外 z∈[5,6.5]
    { id: EXIT.R2_TO_R1, to: SPAWN.R1_FROM_R2, box: trigger(0, 0, 5.75), floor: 1 },
    // 五楼 502 门 (-5,11.2,1.2)，门洞类：触发体在门外 x∈[-6.5,-5]（门神放行前门关着，动态碰撞体挡人）
    { id: EXIT.R2_TO_502, to: SPAWN.R2_502_DOOR, box: trigger(-5.75, levelY(5), 1.2), floor: 5, when: F.R2_MENSHEN_OPEN, blocked: TEXT.fb.door502Blocked },
  ],
  post: 'r2',
  environment: { tint: PALETTE.HALL_LAMP, intensity: 0.7 },
  // GDD §9.5：褐噪声房间底噪、远处电视（四楼 401 还住着人）、声控灯的 120Hz 嗡鸣（灯亮时开）、门外的雨
  ambience: [
    { preset: 'room_tone', gain: -20 },
    { preset: 'tv_murmur', gain: -26, at: [5.2, levelY(4) + 1.2, 1.2] },
    { preset: 'mains_hum', gain: -30, params: { on: 0 } },
    { preset: 'rain', gain: -30, at: [0, 1.5, 6.5] },
  ],
  photoTargets: PHOTO_TARGETS,
  replayPoints: REPLAY_POINTS,
  segments: SEGMENTS,
  dialogues: DIALOGUES,
  docs: TEXT.docs,
  puzzles: PUZZLES,
  shots: SHOTS,
  build(ctx) {
    resetPaperTalk();
    ctx.fog('#0E0C0A', 0.09);
    ctx.background('#050505');
    const mats = r2Mats();
    const world = buildFloors(ctx, mats);
    // 回放片段道具（prebuild 在 build 之后取用；材质随区域释放）
    const replayMat = MATERIALS.replay();
    const menshenGhost = ctx.track(new THREE.MeshBasicMaterial({ map: mats.menshen.map, color: '#b8b890', transparent: true, opacity: 0.82, depthWrite: false }));
    const tvScreen = ctx.track(new THREE.MeshBasicMaterial({ map: ctx.track(tvScreenTexture()), color: new THREE.Color('#fff4de').multiplyScalar(4.5) }));
    REPLAY_PROPS.clear();
    REPLAY_PROPS.set('menshen', () => tracked(ctx, menshenPair(menshenGhost, 8)));
    REPLAY_PROPS.set('box', () => tracked(ctx, replayBox(replayMat)));
    REPLAY_PROPS.set('stretcher', () => tracked(ctx, replayStretcher(replayMat)));
    REPLAY_PROPS.set('tv', () => tracked(ctx, replayTv(replayMat, tvScreen)));
    rt = buildLogic(ctx, world, mats);
  },
  update(_ctx, dt) {
    rt?.update(dt);
  },
  onFlag(_ctx, e) {
    rt?.onFlag(e);
  },
  onExit() {
    rt?.dispose();
    rt = null;
  },
});
