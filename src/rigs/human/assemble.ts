// owner: WP2
// char2 WP0（冻结）：人偶装配。建关节 → 材质（surface/）→ 调三个区域构建器（upper/、lower/、head/）→ 挂部件 →
// 动作（motion/）→ 材质模式、淡出、包围盒、释放。见 test-artifacts/work/char2/PLAN.md §2。
//
// 骨架（人偶面朝 -z，右手在 +x；s = height / 1.75）：
//   root（脚底中点）→ pivot（躺下/坐下/起伏）→ hips（髋，0.95s）
//     ├ spine（腰，1.05s）→ neck（领口，1.50s）→ headSlot
//     │    ├ shoulderL/R（1.45s，±0.19s）→ elbowL/R（-0.29s）
//     └ hipL/R（0.92s，±0.095s）→ kneeL/R（-0.43s）
// 关节角度约定见 poses.ts。部件几何按尺寸缓存复用（ARCH §5.1）；材质每个人偶各自一套（淡出、换色互不影响）。

import * as THREE from 'three';
import { RENDER_ORDER, TEMP_C } from '../../data/render';
import { isSharedMaterial } from '../../fx/materials';
import { createGhostMaterial, createReplayMaterial } from '../../fx/ghostMaterials';
import { buildHead } from './head';
import { buildLower } from './lower';
import { createMotion } from './motion';
import { BUILD, JOINT_NAMES, faceOf } from './profile';
import { isCachedGeometry } from './shared';
import { addRim, createRigMaterials, ghostTint, modeDetail, modeMaterial, setMaterialOpacity } from './surface';
import { buildUpper } from './upper';
import type {
  BuildCtx, FaceOpts, HumanoidInternal, HumanoidMaterialMode, HumanoidRig, HumanoidSpec, HumanoidStyle, JointName, RegionResult,
} from './types';

export function createHumanoid(spec: HumanoidSpec): HumanoidRig {
  return createHumanoidInternal(spec);
}

export function createHumanoidInternal(spec: HumanoidSpec, face?: FaceOpts, style?: HumanoidStyle): HumanoidInternal {
  const s = spec.height / 1.75;
  const build = BUILD[spec.build ?? 'normal'];
  const bw = build.w, bd = build.d;
  const f: FaceOpts | undefined = spec.head === 'human' ? faceOf(spec, face) : face;

  // 每个人偶自己的一套材质
  const owned = new Set<THREE.Material>();
  const own = <T extends THREE.Material>(m: T): T => {
    owned.add(m);
    m.userData.rigOwned = true;
    return m;
  };
  const mats = createRigMaterials(spec, f, style, own);

  const root = new THREE.Group();
  root.name = 'humanoid';
  // 会淡入淡出的人身（setOpacity 切 transparent 会换着色器变体）：warmupArea 据此把透明变体也预热一遍（M1d）
  root.userData.fadeCapable = true;
  const pivot = new THREE.Group();
  pivot.name = 'pivot';
  root.add(pivot);

  const J = {} as Record<JointName, THREE.Group>;
  for (const n of JOINT_NAMES) {
    J[n] = new THREE.Group();
    J[n].name = n;
  }
  const hipY = 0.95 * s;
  pivot.add(J.hips);
  J.hips.position.set(0, hipY, 0);
  J.hips.add(J.spine);
  J.spine.position.set(0, 0.1 * s, 0);
  J.spine.add(J.neck);
  J.neck.position.set(0, 0.45 * s, 0);
  J.neck.add(J.headSlot);
  const shoulderDrop = spec.build === 'hunch' ? 0.02 * s : 0;
  const shX = 0.195 * s * bw;
  J.spine.add(J.shoulderL, J.shoulderR);
  J.shoulderL.position.set(-shX, 0.378 * s - shoulderDrop, 0);
  J.shoulderR.position.set(shX, 0.378 * s - shoulderDrop, 0);
  J.shoulderL.add(J.elbowL);
  J.shoulderR.add(J.elbowR);
  J.elbowL.position.set(0, -0.29 * s, 0);
  J.elbowR.position.set(0, -0.29 * s, 0);
  const hipX = 0.095 * s * bw;
  J.hips.add(J.hipL, J.hipR);
  J.hipL.position.set(-hipX, -0.03 * s, 0);
  J.hipR.position.set(hipX, -0.03 * s, 0);
  J.hipL.add(J.kneeL);
  J.hipR.add(J.kneeR);
  J.kneeL.position.set(0, -0.43 * s, 0);
  J.kneeR.position.set(0, -0.43 * s, 0);

  const parts: Record<string, THREE.Mesh> = {};
  const bodyMeshes: THREE.Mesh[] = [];
  const addPart = (name: string, parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.userData.rigPart = true;
    parent.add(m);
    parts[name] = m;
    bodyMeshes.push(m);
    return m;
  };

  // ------------------------------------------------ 区域构建器
  const tracked = new Set<THREE.BufferGeometry>();
  const ctx: BuildCtx = {
    spec, ...(f ? { face: f } : {}), ...(style ? { style } : {}), s, build, joints: J, mats,
    track: g => {
      tracked.add(g);
      return g;
    },
  };
  const regions: RegionResult[] = [buildUpper(ctx), buildLower(ctx), buildHead(ctx)];
  for (const r of regions) {
    for (const p of r.parts) {
      const mat = typeof p.slot === 'string' ? mats[p.slot] : own(p.slot);
      const m = addPart(p.name, J[p.joint], p.geo, mat);
      if (p.position) m.position.set(p.position[0], p.position[1], p.position[2]);
      if (p.rotation) m.rotation.set(p.rotation[0], p.rotation[1], p.rotation[2]);
      if (p.userData) Object.assign(m.userData, p.userData);
    }
    for (const e of r.extras ?? []) J[e.joint].add(e.object);
  }
  const headMesh: THREE.Object3D | null = spec.head === 'none' ? null : parts.head ?? null;

  if (style?.rim !== undefined) {
    for (const m of owned) if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) addRim(m as THREE.MeshStandardMaterial, style.rim);
  }

  // ------------------------------------------------ 状态
  const extraMeshes: THREE.Mesh[] = [];
  const keepMat = new WeakSet<THREE.Mesh>();
  let mode: HumanoidMaterialMode = 'standard';
  let modeColor: THREE.ColorRepresentation | undefined;
  let opacity = 1;
  const stdMat = new WeakMap<THREE.Mesh, THREE.Material>();

  const allMeshes = (): THREE.Mesh[] => [...bodyMeshes, ...extraMeshes];

  /**
   * 魂影/回放材质（M4）：按原部件各建一份（本人偶私有，随人偶释放），带原件的贴图（碎花、中山装、脸）与底色，
   * 辨识道具（配件）更实一些；共用同一个着色器程序（只有 uniform 不同，参数见 surface/modeDetail）。silhouette 仍用一份共享的纯黑材质。
   */
  const modeMats = new Map<string, THREE.Material>();
  const isFace = (mesh: THREE.Mesh): boolean => mesh === headMesh && spec.head === 'human';
  const modeMatFor = (m: Exclude<HumanoidMaterialMode, 'standard'>, color: THREE.ColorRepresentation | undefined, mesh: THREE.Mesh): THREE.Material => {
    if (m === 'silhouette') {
      const key = `sil|${color === undefined ? '' : new THREE.Color(color).getHexString()}`;
      let mat = modeMats.get(key);
      if (!mat) {
        mat = modeMaterial('silhouette', color);
        modeMats.set(key, mat);
      }
      return mat;
    }
    const src = stdMat.get(mesh) as THREE.MeshStandardMaterial | undefined;
    const accessory = extraMeshes.includes(mesh);
    const face = isFace(mesh);
    // 配件可以自己定实度（中山装的领子、口袋盖是衣服的一部分，不该比身子实）
    const solidOverride = typeof mesh.userData.ghostSolid === 'number' ? (mesh.userData.ghostSolid as number) : null;
    const colorKey = color === undefined ? '' : new THREE.Color(color).getHexString();
    const key = `${m}|${colorKey}|${src?.uuid ?? ''}|${accessory ? 'a' : ''}${face ? 'f' : ''}|${solidOverride ?? ''}`;
    let mat = modeMats.get(key);
    if (mat) return mat;
    const d = modeDetail(m, { ...(src ? { src } : {}), accessory, face, solidOverride, ...(style ? { style } : {}) });
    mat = own(m === 'ghost' ? createGhostMaterial(ghostTint(style, color), d) : createReplayMaterial(d));
    // 逐部件的魂影材质写深度，透明队列里由近到远画（core/render.ts ghostAwareTransparentSort）：只剩最外一层壳，不再 X 光透视
    mat.depthWrite = true;
    mat.userData.ghostDepth = true;
    // 与 MATERIALS.ghost/replay 同温（红外：魂影 6℃；回放人影与环境同温）
    mat.userData.tempC = m === 'ghost' ? TEMP_C.yin : TEMP_C.ambient;
    modeMats.set(key, mat);
    return mat;
  };

  /**
   * 魂影/回放的绘制顺序（M4）：部件统一放到 RENDER_ORDER.ghost/replay 这一档；逐部件材质写深度（ghostDepth），
   * 同一档里由近到远画（core/render.ts ghostAwareTransparentSort），于是只画最外一层壳——四肢、提篮、相机不再从躯干里透出来。
   * （第一版是给每个部件挂一个只写深度的预通道子网格，每个部件多一次 draw call，回放机位超出 250 的预算，改成排序。）
   */
  const baseOrder = new WeakMap<THREE.Mesh, number>();
  const syncPrepass = () => {
    const on = mode === 'ghost' || mode === 'replay';
    const order = mode === 'replay' ? RENDER_ORDER.replay : RENDER_ORDER.ghost;
    for (const mesh of allMeshes()) {
      if (keepMat.has(mesh)) continue;
      if (!on) {
        if (baseOrder.has(mesh)) mesh.renderOrder = baseOrder.get(mesh)!;
        continue;
      }
      if (!baseOrder.has(mesh)) baseOrder.set(mesh, mesh.renderOrder);
      mesh.renderOrder = Math.max(mesh.renderOrder, order);
    }
  };

  const applyMode = (m: HumanoidMaterialMode, color?: THREE.ColorRepresentation) => {
    mode = m;
    modeColor = color;
    for (const mesh of allMeshes()) {
      if (keepMat.has(mesh)) continue;
      if (!stdMat.has(mesh)) stdMat.set(mesh, mesh.material as THREE.Material);
      mesh.material = m === 'standard' ? (stdMat.get(mesh) as THREE.Material) : modeMatFor(m, color, mesh);
    }
    syncPrepass();
    if (opacity < 1) applyOpacity(opacity);
  };

  /** 淡出需要逐人偶的材质：共享材质（MATERIALS.ghost/replay、kitMat 配件）先克隆一份。 */
  const applyOpacity = (a: number) => {
    opacity = a;
    const clones = new Map<THREE.Material, THREE.Material>();
    for (const mesh of allMeshes()) {
      if (keepMat.has(mesh) && mesh.userData.fadeWithRig !== true) continue;
      let mat = mesh.material as THREE.Material;
      if (!owned.has(mat) && a < 1) {
        let c = clones.get(mat);
        if (!c) {
          c = own(mat.clone());
          clones.set(mat, c);
        }
        if (mode === 'standard' && stdMat.get(mesh) === mat) stdMat.set(mesh, c);
        mesh.material = c;
        mat = c;
      }
      setMaterialOpacity(mat, a);
    }
  };

  // ------------------------------------------------ 动作
  const motion = createMotion({ spec, s, bd, joints: J, pivot, rest: { hipsY: hipY } });
  /** 动作写完关节之后：区域的逐帧钩子（长袍坐姿形变）。 */
  const afterApply = (dt: number) => {
    const bend = THREE.MathUtils.clamp((J.hipL.rotation.x + J.hipR.rotation.x) / Math.PI, 0, 1);
    const st = { dt, walkPhase: motion.walkPhase, walkWeight: motion.walkWeight, bend };
    for (const r of regions) r.update?.(st);
  };
  motion.apply();
  afterApply(0);

  const rig: HumanoidInternal = {
    root,
    joints: J,
    height: spec.height,
    spec,
    s,
    parts,
    headMesh,
    get mode() { return mode; },
    get pose() { return motion.pose; },
    get walkPhase() { return motion.walkPhase; },
    get walkWeight() { return motion.walkWeight; },
    setPose(p, blendSec = 0.3) {
      if (!motion.setPose(p, blendSec)) return;
      motion.apply();
      afterApply(0);
    },
    update(dt, speed) {
      motion.step(dt, speed);
      motion.apply();
      afterApply(dt);
    },
    setMaterialMode(m, color) {
      applyMode(m, color);
    },
    setOpacity(a) {
      applyOpacity(Math.max(0, Math.min(1, a)));
    },
    bounds(target) {
      target.makeEmpty();
      root.updateWorldMatrix(true, true);
      const box = new THREE.Box3();
      root.traverseVisible(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.userData.noBounds) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        box.copy(m.geometry.boundingBox as THREE.Box3).applyMatrix4(m.matrixWorld);
        target.union(box);
      });
      return target;
    },
    dispose() {
      root.traverse(o => {
        const m = o as THREE.Mesh;
        const line = (o as THREE.Line).isLine === true || (o as THREE.Points).isPoints === true;
        if (!m.isMesh && !line) return;
        if (!isCachedGeometry(m.geometry) && !m.userData.sharedGeometry) m.geometry.dispose();
        // 线/点（黄鼬头的胡须 LineSegments）的材质不在 owned 里：自己建的在这里释放（M3，docs/requests/r4.md #5）
        if (line) for (const mat of ([] as THREE.Material[]).concat(m.material)) if (!owned.has(mat) && !isSharedMaterial(mat)) mat.dispose();
      });
      for (const g of tracked) g.dispose();
      tracked.clear();
      for (const r of regions) r.dispose?.();
      for (const m of owned) m.dispose();
      owned.clear();
      root.removeFromParent();
    },
    adopt(obj, o) {
      obj.traverse(c => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        extraMeshes.push(m);
        if (o?.keepMaterial) keepMat.add(m);
      });
      if (mode !== 'standard') applyMode(mode, modeColor);
      if (opacity < 1) applyOpacity(opacity);
    },
    setBodyVisible(v) {
      for (const m of bodyMeshes) m.visible = v;
    },
  };
  if (spec.material && spec.material !== 'standard') rig.setMaterialMode(spec.material);
  return rig;
}
