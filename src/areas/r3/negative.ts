// owner: R3
// 本相过场（cs.r3.true_form）里陆师傅举到灯下的那张底片（M4）：大座机的黑白页片，画面是 ph.true_form 那张照片的反相。
// 建区域时挂在陆师傅的右手上、先藏着（在 ctx.npc 之前挂上，随 NPC 根节点进 yin 层、参加进区域的预编译，过场里不会卡一下）；
// 过场里 holdNegative(true) 举到眼前（raise_arm，再把右臂收到脸前上方、抬头看片子），holdNegative(false) 放下，hideNegative() 收起。
// 片子朝向 aim 点（近景机位）：每帧在 NPC 的 update 钩子里（骨骼刚摆完）转过去，放下时保持相对手的朝向。

import * as THREE from 'three';
import type { AreaContext } from '../../core/area';
import type { V3 } from '../../core/types';
import type { CharacterRig } from '../../rigs/characters';
import { paintTexture } from '../../kit/canvas';
import { trueFormNegative } from './build/textures';

/** 片子尺寸（米）。 */
export const NEGATIVE_SIZE = { w: 0.12, h: 0.09 } as const;

/**
 * 举片子的右臂（覆盖 raise_arm 的右肩、右肘与颈，角度约定见 rigs/poses.ts）：上臂前举 100°、肘再屈 50°，
 * 手在眼睛前上方约 0.45m；抬头看着片子。
 */
const HOLD = { shoulderR: [1.75, 0, -0.12] as V3, elbowR: 0.85, neck: 0.3 } as const;
/** 举起/放下用时（秒）。 */
const RAISE_SEC = 0.8;

interface NegativeState {
  rig: CharacterRig;
  plate: THREE.Mesh;
  /** 目标：1 举着、0 放下 */
  want: number;
  w: number;
  /** 片子正面朝向的世界坐标点；null = 保持相对手的朝向 */
  aim: THREE.Vector3 | null;
}
let st: NegativeState | null = null;

/** 挂到陆师傅右手（在 ctx.npc 之前调用）。 */
export function attachNegative(ctx: AreaContext, rig: CharacterRig): void {
  const tex = ctx.track(paintTexture(256, 192, trueFormNegative));
  tex.anisotropy = 4;
  // 透光的片子：底色黑、不吃灯，只靠自发光（同暗房里的正片）；亮处接近 Bloom 阈值，片子像是叫灯照透了
  const mat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.9, roughness: 0.5, side: THREE.DoubleSide });
  mat.name = 'r3.trueFormNegative';
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(NEGATIVE_SIZE.w, NEGATIVE_SIZE.h), mat);
  plate.name = 'r3.trueFormNegative';
  // 手在肘关节下 0.3×身高比处（rigs/humanoid.ts）；片子的下沿捏在指尖
  const s = rig.height / 1.75;
  plate.position.set(0, -0.3 * s - 0.1, -0.02 * s);
  plate.visible = false;
  plate.userData.noOcclude = true;
  // 藏着的时候也别挡交互射线（Raycaster 不看 visible）
  plate.raycast = () => {};
  rig.joints.elbowR.add(plate);
  st = { rig, plate, want: 0, w: 0, aim: null };
}

/** 举起（片子正面朝 aim）/ 放下。 */
export function holdNegative(on: boolean, aim?: V3): void {
  if (!st) return;
  st.want = on ? 1 : 0;
  if (on) {
    st.plate.visible = true;
    st.aim = aim ? new THREE.Vector3(...aim) : null;
    st.rig.setPose('raise_arm', RAISE_SEC);
  } else {
    st.aim = null;
    st.rig.setPose('stand', RAISE_SEC);
  }
}

/** 立即收起（过场结束、被打断）。 */
export function hideNegative(): void {
  if (!st) return;
  st.want = 0;
  st.w = 0;
  st.aim = null;
  st.plate.visible = false;
  st.rig.setPose('stand', 0);
}

/** 当前片子的世界坐标（自测、截图机位用）。 */
export function negativeWorldPos(target: THREE.Vector3): THREE.Vector3 | null {
  return st ? st.plate.getWorldPosition(target) : null;
}

/** 每帧（陆师傅的 NpcDef.update：骨骼刚按姿势摆完）：把右臂收到脸前、片子转向 aim。 */
export function updateNegative(dt: number): void {
  if (!st) return;
  const step = dt / RAISE_SEC;
  st.w = st.want > st.w ? Math.min(st.want, st.w + step) : Math.max(st.want, st.w - step);
  if (st.w <= 0) return;
  const k = st.w * st.w * (3 - 2 * st.w);
  const J = st.rig.joints;
  const sr = J.shoulderR.rotation;
  sr.set(
    THREE.MathUtils.lerp(sr.x, HOLD.shoulderR[0], k),
    THREE.MathUtils.lerp(sr.y, HOLD.shoulderR[1], k),
    THREE.MathUtils.lerp(sr.z, HOLD.shoulderR[2], k),
  );
  J.elbowR.rotation.x = THREE.MathUtils.lerp(J.elbowR.rotation.x, HOLD.elbowR, k);
  J.neck.rotation.x = THREE.MathUtils.lerp(J.neck.rotation.x, HOLD.neck, k);
  if (st.aim && st.plate.parent) {
    st.plate.parent.updateWorldMatrix(true, false);
    st.plate.lookAt(st.aim);
  }
}

/** 离开区域。 */
export function disposeNegative(): void {
  st = null;
}
