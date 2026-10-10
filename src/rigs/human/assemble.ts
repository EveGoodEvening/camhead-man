// owner: WP2
// char2 WP0（冻结）：人偶装配（test-artifacts/work/char2/PLAN.md §2）。
//   体型/布局/地标/接缝（profile.ts）→ 材质（surface/）→ 关节 Group + 骨骼（THREE.Bone，关节的单位子节点）→
//   三个区域构建器（upper/、lower/、head/）→ 刚体部件挂关节；蒙皮部件焊接法线、按材质槽合并成 SkinnedMesh（共用一套 Skeleton）→
//   动作（motion/）→ 材质模式、淡出、胶囊射线/包围盒、释放。
//
// 骨架（人偶面朝 -z，右手在 +x；s = height / 1.75；成年人数值，儿童/土地见 profile.ts jointLayout）：
//   root（脚底中点）→ pivot（躺下/坐下/起伏）→ hips（髋，0.95s）
//     ├ spine（腰，1.05s）→ neck（领口，1.50s）→ headSlot
//     │    ├ shoulderL/R（1.45s，±0.19s）→ elbowL/R（-0.29s）→ wristL/R（-0.245s）
//     └ hipL/R（0.92s，±0.095s）→ kneeL/R（-0.43s）→ ankleL/R（-0.415s）
// 关节角度约定见 poses.ts。
//
// 蒙皮约定：绑定姿势 = 全部关节旋转为 0、不加驼背、pivot 在原点；骨骼逆矩阵 = 关节绑定位置的平移取反（profile.ts layout.bind）。
// 槽网格挂在 root 下（bindMatrix = 单位阵）。射线、包围盒用每根骨头的胶囊（按部件顶点在骨轴上的投影范围与离轴距离算），
// 不在 CPU 上蒙皮；视锥剔除用以 hips 为心、按骨链长度放大的保守球（任何姿势都包得住）。

import * as THREE from 'three';
import { RENDER_ORDER, TEMP_C } from '../../data/render';
import { isSharedMaterial } from '../../fx/materials';
import { createGhostMaterial, createReplayMaterial } from '../../fx/ghostMaterials';
import { DEV_CHECKS } from '../../core/log';
import { REGION_LEGACY as HEAD_LEGACY, buildHead } from './head';
import { REGION_LEGACY as LOWER_LEGACY, buildLower } from './lower';
import { createMotion } from './motion';
import { BONES, BUILD, BUILD_JOINTS, EXTRA_JOINTS, JOINT_PARENT, SEAMS, faceOf, garmentOf, jointLayout, landmarksOf, profileOf } from './profile';
import { isCachedGeometry, mergeKeepUv, normalizeForMerge, weldNormals } from './shared';
import { addRim, createRigMaterials, ghostTint, modeDetail, modeMaterial, setMaterialOpacity } from './surface';
import { REGION_LEGACY as UPPER_LEGACY, buildUpper } from './upper';
import type {
  BoneName, BuildCtx, BuildJoint, ExtraJointName, FaceOpts, HumanoidDevOpts, HumanoidInternal, HumanoidMaterialMode, HumanoidRig, HumanoidSpec,
  HumanoidStyle, MatSlot, RegionBuilder, RegionResult, RigidPart, SkinnedPiece,
} from './types';

/** 合并后的槽网格名字（parts[name]）。 */
export const SLOT_MESH_NAME: Readonly<Record<MatSlot, string>> = {
  torso: 'torso', sleeve: 'sleeves', pants: 'pants', shoes: 'shoes', skin: 'skin', belt: 'belt', hem: 'hem', robe: 'robe', face: 'faceSkin',
};

/** 胶囊的骨轴方向（骨头局部 = 绑定姿势下的根空间方向）：顶点按主骨分组，沿这条轴的投影范围 + 离轴最大距离 = 胶囊。 */
const BONE_AXIS: Readonly<Record<BoneName, readonly [number, number, number]>> = {
  hips: [0, 1, 0], spine: [0, 1, 0], neck: [0, 1, 0], headSlot: [0, 1, 0],
  shoulderL: [0, -1, 0], elbowL: [0, -1, 0], wristL: [0, -1, 0], shoulderR: [0, -1, 0], elbowR: [0, -1, 0], wristR: [0, -1, 0],
  hipL: [0, -1, 0], kneeL: [0, -1, 0], ankleL: [0, -0.28, -0.96], hipR: [0, -1, 0], kneeR: [0, -1, 0], ankleR: [0, -0.28, -0.96],
  pivot: [0, 1, 0],
};

/** 一根骨头上的胶囊（骨头局部坐标的两端 a、b 与半径）。 */
interface Capsule { bone: number; a: THREE.Vector3; b: THREE.Vector3; r: number }

export function createHumanoid(spec: HumanoidSpec): HumanoidRig {
  return createHumanoidInternal(spec);
}

/** 旧版布局：三个区域构建器都还是 WP0 搬来的旧版时（各自 index.ts 的 REGION_LEGACY），关节按成年人数值摆（儿童、土地也一样），外观不变。 */
export const LEGACY_LAYOUT = HEAD_LEGACY && UPPER_LEGACY && LOWER_LEGACY;

export function createHumanoidInternal(spec: HumanoidSpec, face?: FaceOpts, style?: HumanoidStyle, dev?: HumanoidDevOpts): HumanoidInternal {
  const s = spec.height / 1.75;
  const build = BUILD[spec.build ?? 'normal'];
  const f: FaceOpts | undefined = spec.head === 'human' ? faceOf(spec, face) : face;
  const profile = profileOf(spec, f, style);
  const layout = jointLayout(profile, s, { legacy: LEGACY_LAYOUT });
  const land = landmarksOf(profile, s, f, layout);
  const seams = SEAMS(profile, s, layout);
  const garment = garmentOf(spec, style);

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

  const J = {} as Record<BuildJoint, THREE.Group>;
  for (const n of BUILD_JOINTS) {
    J[n] = new THREE.Group();
    J[n].name = n;
  }
  for (const n of BUILD_JOINTS) {
    const par = JOINT_PARENT[n];
    (par === 'pivot' ? pivot : J[par]).add(J[n]);
    const l = layout.local[n];
    J[n].position.set(l[0], l[1], l[2]);
  }
  const hipY = layout.hipsY;
  const jointOf = (b: BoneName): THREE.Object3D => (b === 'pivot' ? pivot : J[b]);

  // 骨骼：关节的单位子节点；逆绑定矩阵 = 绑定位置平移取反
  const bones: THREE.Bone[] = BONES.map(n => {
    const b = new THREE.Bone();
    b.name = `bone.${n}`;
    jointOf(n).add(b);
    return b;
  });
  const boneInverses = BONES.map(n => {
    const p = layout.bind[n];
    return new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2]);
  });
  const skeleton = new THREE.Skeleton(bones, boneInverses);
  /**
   * 骨骼贴图（Skeleton.boneTexture，首次渲染时建）不挂在任何材质上：区域卸载时 Disposer.trackObject 只释放几何/材质/贴图、
   * 从不调用 rig.dispose()，于是每个区域里的蒙皮人偶每进出一次漏一张贴图（char2 WP0 复核：roundtrip textures +5/趟）。
   * 所以槽网格的（本人偶私有）几何或材质被释放时顺手释放骨骼贴图；多释放一次无害（three 渲染时 boneTexture 为 null 会重建）。
   */
  const releaseSkeleton = () => skeleton.dispose();
  const skeletonHooks: THREE.EventDispatcher<{ dispose: object }>[] = [];

  const parts: Record<string, THREE.Mesh> = {};
  const bodyMeshes: THREE.Mesh[] = [];
  const addPart = (name: string, parent: THREE.Object3D, mesh: THREE.Mesh): THREE.Mesh => {
    if (DEV_CHECKS && parts[name]) throw new Error(`humanoid: duplicate part name '${name}'`);
    mesh.name = name;
    mesh.userData.rigPart = true;
    parent.add(mesh);
    parts[name] = mesh;
    bodyMeshes.push(mesh);
    return mesh;
  };

  // ------------------------------------------------ 区域构建器
  const tracked = new Set<THREE.BufferGeometry>();
  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    tracked.add(g);
    return g;
  };
  const ctx: BuildCtx = {
    spec, ...(f ? { face: f } : {}), ...(style ? { style } : {}), garment, s, build, profile, land, seams, layout, joints: J, mats, track,
  };
  const builders: RegionBuilder[] = [dev?.builders?.upper ?? buildUpper, dev?.builders?.lower ?? buildLower, dev?.builders?.head ?? buildHead, ...(dev?.extra ?? [])];
  const regions: RegionResult[] = builders.map(b => b(ctx));
  const skinned: SkinnedPiece[] = [];
  for (const r of regions) {
    for (const p of r.parts) {
      if (p.kind === 'skinned') {
        skinned.push(p);
        continue;
      }
      const rp = p as RigidPart;
      const mat = typeof rp.slot === 'string' ? mats[rp.slot] : own(rp.slot);
      const m = addPart(rp.name, J[rp.joint], new THREE.Mesh(rp.geo, mat));
      if (rp.position) m.position.set(rp.position[0], rp.position[1], rp.position[2]);
      if (rp.rotation) m.rotation.set(rp.rotation[0], rp.rotation[1], rp.rotation[2]);
      if (rp.userData) Object.assign(m.userData, rp.userData);
    }
    for (const e of r.extras ?? []) J[e.joint].add(e.object);
  }

  // ------------------------------------------------ 蒙皮部件：复制 → 焊接法线 → 按槽合并 → SkinnedMesh
  const skinnedMeshes: THREE.SkinnedMesh[] = [];
  const capsules = new Map<THREE.SkinnedMesh, Capsule[]>();
  let sphereR = 0;
  if (skinned.length) {
    // 合并进槽网格的部件先复制成统一格式（不改构建器的几何）；own 部件原样使用（构建器可以留着这份几何、在 update() 里改顶点，例如长袍坐姿下摆）
    const copies = skinned.map(p => {
      if (DEV_CHECKS) validatePiece(p);
      if (!p.own) return normalizeForMerge(p.geo, true);
      if (!p.geo.index) p.geo.setIndex(Array.from({ length: (p.geo.attributes.position as THREE.BufferAttribute).count }, (_, i) => i));
      return p.geo;
    });
    weldNormals(copies.filter((_, i) => skinned[i]!.weld !== false));
    // 分组：own 的单独一组（名字 = 部件名），其余按槽；组内按 order 稳定排序
    const groups = new Map<string, { slot: MatSlot; name: string; items: { geo: THREE.BufferGeometry; order: number; pad: number }[] }>();
    skinned.forEach((p, i) => {
      const key = p.own ? `own:${p.name}` : `slot:${p.slot}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { slot: p.slot, name: p.own ? p.name : SLOT_MESH_NAME[p.slot], items: [] }));
      g.items.push({ geo: copies[i]!, order: p.order ?? 0, pad: p.capsulePad ?? 0 });
    });
    const bindIdent = new THREE.Matrix4();
    for (const g of groups.values()) {
      const items = g.items.map((it, k) => ({ ...it, k })).sort((a, b) => a.order - b.order || a.k - b.k);
      const one = items.length === 1 ? items[0]!.geo : null;
      const geo = one && isCachedGeometry(one) ? one : track(one ?? mergeKeepUv(items.map(it => it.geo), true));
      for (const it of items) if (it.geo !== geo) it.geo.dispose();
      const pad = Math.max(0, ...items.map(it => it.pad));
      const mesh = new THREE.SkinnedMesh(geo, mats[g.slot]);
      const hook = (isCachedGeometry(geo) ? mats[g.slot] : geo) as unknown as THREE.EventDispatcher<{ dispose: object }>;
      if (!skeletonHooks.includes(hook)) {
        hook.addEventListener('dispose', releaseSkeleton);
        skeletonHooks.push(hook);
      }
      mesh.bind(skeleton, bindIdent);
      addPart(g.name, root, mesh);
      skinnedMeshes.push(mesh);
      capsules.set(mesh, buildCapsules(geo, pad));
      sphereR = Math.max(sphereR, conservativeRadius(geo));
    }
    sphereR += 0.05 * s;
  }

  const headMesh: THREE.Object3D | null = spec.head === 'none' ? null : parts.head ?? null;

  if (style?.rim !== undefined) {
    for (const m of owned) if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) addRim(m as THREE.MeshStandardMaterial, style.rim);
  }

  // ------------------------------------------------ 胶囊：射线、包围盒、视锥球
  const rel = new Map<THREE.Object3D, THREE.Matrix4>();
  for (const b of BONES) rel.set(jointOf(b), new THREE.Matrix4());
  /** 每个关节相对 root 的矩阵（只用关节自己的 position/rotation，不碰 matrixWorld）。 */
  const refreshRel = () => {
    pivot.updateMatrix();
    rel.get(pivot)!.copy(pivot.matrix);
    for (const n of BUILD_JOINTS) {
      const j = J[n];
      j.updateMatrix();
      const par = JOINT_PARENT[n];
      rel.get(j)!.multiplyMatrices(rel.get(jointOf(par))!, j.matrix);
    }
  };
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _c2 = new THREE.Vector3();
  const _box = new THREE.Box3();
  /** 根空间（= 槽网格局部）的胶囊包围盒，写进 mesh.boundingBox 与 geometry.boundingBox（拍照 visibleBounds、Box3.setFromObject 都用）。 */
  const refreshBounds = () => {
    if (!skinnedMeshes.length) return;
    refreshRel();
    const hipsM = rel.get(J.hips)!;
    _c.setFromMatrixPosition(hipsM);
    for (const mesh of skinnedMeshes) {
      _box.makeEmpty();
      for (const cap of capsules.get(mesh)!) {
        const m = rel.get(jointOf(BONES[cap.bone]!))!;
        _a.copy(cap.a).applyMatrix4(m);
        _b.copy(cap.b).applyMatrix4(m);
        _box.expandByPoint(_c2.set(Math.min(_a.x, _b.x) - cap.r, Math.min(_a.y, _b.y) - cap.r, Math.min(_a.z, _b.z) - cap.r));
        _box.expandByPoint(_c2.set(Math.max(_a.x, _b.x) + cap.r, Math.max(_a.y, _b.y) + cap.r, Math.max(_a.z, _b.z) + cap.r));
      }
      (mesh.boundingBox ??= new THREE.Box3()).copy(_box);
      if (!isCachedGeometry(mesh.geometry)) (mesh.geometry.boundingBox ??= new THREE.Box3()).copy(_box);
      (mesh.boundingSphere ??= new THREE.Sphere()).set(_c, sphereR);
      if (!isCachedGeometry(mesh.geometry)) (mesh.geometry.boundingSphere ??= new THREE.Sphere()).set(_c, sphereR);
    }
  };
  let boundsFrame = -1;
  for (const mesh of skinnedMeshes) {
    mesh.onBeforeRender = renderer => {
      const fr = renderer.info.render.frame;
      if (fr === boundsFrame) return;
      boundsFrame = fr;
      refreshBounds();
    };
    mesh.raycast = (raycaster, hits) => capsuleRaycast(mesh, raycaster, hits);
  }
  const _inv = new THREE.Matrix4(), _w = new THREE.Matrix4();
  const _ro = new THREE.Vector3(), _rd = new THREE.Vector3(), _hit = new THREE.Vector3();
  const capsuleRaycast = (mesh: THREE.SkinnedMesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) => {
    root.updateWorldMatrix(true, false);
    refreshRel();
    let best = Infinity;
    for (const cap of capsules.get(mesh)!) {
      _w.multiplyMatrices(root.matrixWorld, rel.get(jointOf(BONES[cap.bone]!))!);
      _inv.copy(_w).invert();
      _ro.copy(raycaster.ray.origin).applyMatrix4(_inv);
      _rd.copy(raycaster.ray.direction).transformDirection(_inv);
      const t = rayCapsule(_ro, _rd, cap.a, cap.b, cap.r);
      if (t < 0) continue;
      _hit.copy(_rd).multiplyScalar(t).add(_ro).applyMatrix4(_w);
      const d = _hit.distanceTo(raycaster.ray.origin);
      if (d < raycaster.near || d > raycaster.far || d >= best) continue;
      best = d;
    }
    if (best < Infinity) {
      raycaster.ray.at(best, _hit);
      hits.push({ distance: best, point: _hit.clone(), object: mesh, face: null });
    }
  };
  /** 世界空间的胶囊包围盒并进 target。 */
  const unionCapsulesWorld = (mesh: THREE.SkinnedMesh, target: THREE.Box3) => {
    const sc = root.matrixWorld.getMaxScaleOnAxis();
    for (const cap of capsules.get(mesh)!) {
      _w.multiplyMatrices(root.matrixWorld, rel.get(jointOf(BONES[cap.bone]!))!);
      _a.copy(cap.a).applyMatrix4(_w);
      _b.copy(cap.b).applyMatrix4(_w);
      const r = cap.r * sc;
      _box.min.set(Math.min(_a.x, _b.x) - r, Math.min(_a.y, _b.y) - r, Math.min(_a.z, _b.z) - r);
      _box.max.set(Math.max(_a.x, _b.x) + r, Math.max(_a.y, _b.y) + r, Math.max(_a.z, _b.z) + r);
      target.union(_box);
    }
  };

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
  const motion = createMotion({ spec, s, profile, layout, bd: build.d, joints: J, pivot, rest: { hipsY: hipY } });
  /** 动作写完关节之后：区域的逐帧钩子（长袍坐姿形变）、胶囊包围盒。 */
  const afterApply = (dt: number) => {
    const bend = THREE.MathUtils.clamp((J.hipL.rotation.x + J.hipR.rotation.x) / Math.PI, 0, 1);
    const st = { dt, walkPhase: motion.walkPhase, walkWeight: motion.walkWeight, bend };
    for (const r of regions) r.update?.(st);
    refreshBounds();
  };
  motion.apply();
  afterApply(0);

  const extraJoints = Object.fromEntries(EXTRA_JOINTS.map(n => [n, J[n]])) as Record<ExtraJointName, THREE.Group>;
  const rig: HumanoidInternal = {
    root,
    joints: J,
    extraJoints,
    height: spec.height,
    spec,
    s,
    profile,
    land,
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
      if (skinnedMeshes.length) refreshRel();
      const box = new THREE.Box3();
      root.traverseVisible(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.userData.noBounds) return;
        if ((m as THREE.SkinnedMesh).isSkinnedMesh && capsules.has(m as THREE.SkinnedMesh)) {
          unionCapsulesWorld(m as THREE.SkinnedMesh, target);
          return;
        }
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
      for (const hk of skeletonHooks) hk.removeEventListener('dispose', releaseSkeleton);
      skeletonHooks.length = 0;
      skeleton.dispose();
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

  // ------------------------------------------------ 胶囊几何（绑定姿势）
  /** 顶点按主骨分组；每组沿骨轴投影的范围 [t0, t1] 与离轴最大距离 r（+ pad）→ 骨头局部的胶囊。 */
  function buildCapsules(geo: THREE.BufferGeometry, pad: number): Capsule[] {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const si = geo.attributes.skinIndex as THREE.BufferAttribute, sw = geo.attributes.skinWeight as THREE.BufferAttribute;
    const acc = new Map<number, { t0: number; t1: number; r: number }>();
    const v = new THREE.Vector3(), d = new THREE.Vector3(), o = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      let bi = si.getX(i), bw = sw.getX(i);
      for (let c = 1; c < 4; c++) if (sw.getComponent(i, c) > bw) { bw = sw.getComponent(i, c); bi = si.getComponent(i, c); }
      const name = BONES[bi]!;
      const bp = layout.bind[name];
      v.fromBufferAttribute(pos, i).sub(o.set(bp[0], bp[1], bp[2]));
      const ax = BONE_AXIS[name];
      d.set(ax[0], ax[1], ax[2]).normalize();
      const t = v.dot(d);
      const r = v.addScaledVector(d, -t).length();
      const e = acc.get(bi);
      if (!e) acc.set(bi, { t0: t, t1: t, r });
      else { e.t0 = Math.min(e.t0, t); e.t1 = Math.max(e.t1, t); e.r = Math.max(e.r, r); }
    }
    const out: Capsule[] = [];
    for (const [bone, e] of acc) {
      const ax = BONE_AXIS[BONES[bone]!];
      d.set(ax[0], ax[1], ax[2]).normalize();
      // 胶囊两端各带半球：投影范围两头收进 r（不超过一半长度），不把包围盒白白放大
      const shrink = Math.min(e.r, (e.t1 - e.t0) / 2);
      out.push({ bone, a: d.clone().multiplyScalar(e.t0 + shrink), b: d.clone().multiplyScalar(e.t1 - shrink), r: e.r + pad });
    }
    return out;
  }

  /** 视锥剔除的保守半径（以 hips 为心）：每个顶点 = 从 hips 到主骨的骨链长度 + 顶点到主骨的距离；取最大。 */
  function conservativeRadius(geo: THREE.BufferGeometry): number {
    const chain = new Map<BoneName, number>();
    const chainLen = (b: BoneName): number => {
      if (b === 'hips' || b === 'pivot') return 0;
      const hit = chain.get(b);
      if (hit !== undefined) return hit;
      const l = layout.local[b as BuildJoint];
      const v = chainLen(JOINT_PARENT[b as BuildJoint]) + Math.hypot(l[0], l[1], l[2]);
      chain.set(b, v);
      return v;
    };
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const si = geo.attributes.skinIndex as THREE.BufferAttribute, sw = geo.attributes.skinWeight as THREE.BufferAttribute;
    let r = 0;
    for (let i = 0; i < pos.count; i++) {
      let bi = si.getX(i), bw = sw.getX(i);
      for (let c = 1; c < 4; c++) if (sw.getComponent(i, c) > bw) { bw = sw.getComponent(i, c); bi = si.getComponent(i, c); }
      const name = BONES[bi]!;
      const bp = layout.bind[name];
      const dist = Math.hypot(pos.getX(i) - bp[0], pos.getY(i) - bp[1], pos.getZ(i) - bp[2]);
      r = Math.max(r, chainLen(name) + dist);
    }
    return r;
  }
}

/** 开发检查：蒙皮部件的属性齐全、权重和为 1、骨下标合法。 */
function validatePiece(p: SkinnedPiece): void {
  const g = p.geo;
  for (const a of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
    if (!g.attributes[a]) throw new Error(`skinned piece '${p.name}': missing attribute '${a}'`);
  }
  const si = g.attributes.skinIndex as THREE.BufferAttribute, sw = g.attributes.skinWeight as THREE.BufferAttribute;
  if (si.itemSize !== 4 || sw.itemSize !== 4) throw new Error(`skinned piece '${p.name}': skinIndex/skinWeight itemSize must be 4`);
  for (let i = 0; i < si.count; i++) {
    let sum = 0;
    for (let c = 0; c < 4; c++) {
      const b = si.getComponent(i, c), w = sw.getComponent(i, c);
      if (w > 0 && (b < 0 || b >= BONES.length || b !== Math.floor(b))) throw new Error(`skinned piece '${p.name}': vertex ${i} bad bone index ${b}`);
      sum += w;
    }
    if (Math.abs(sum - 1) > 1e-3) throw new Error(`skinned piece '${p.name}': vertex ${i} weights sum ${sum.toFixed(4)}`);
  }
}

/**
 * 射线与胶囊（a–b 线段、半径 r）求交（Inigo Quilez 的公式）。rd 单位向量；返回参数 t（≥ 0），不相交 −1。
 * 起点在胶囊里面时返回 −1（相机不会在人身体里）。
 */
export function rayCapsule(ro: THREE.Vector3, rd: THREE.Vector3, pa: THREE.Vector3, pb: THREE.Vector3, r: number): number {
  const bax = pb.x - pa.x, bay = pb.y - pa.y, baz = pb.z - pa.z;
  const oax = ro.x - pa.x, oay = ro.y - pa.y, oaz = ro.z - pa.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const sphere = (cx: number, cy: number, cz: number): number => {
    const ocx = ro.x - cx, ocy = ro.y - cy, ocz = ro.z - cz;
    const b = rd.x * ocx + rd.y * ocy + rd.z * ocz;
    const c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    const h = b * b - c;
    if (h < 0 || c < 0) return -1;
    const t = -b - Math.sqrt(h);
    return t >= 0 ? t : -1;
  };
  if (baba < 1e-12) return sphere(pa.x, pa.y, pa.z);
  const bard = bax * rd.x + bay * rd.y + baz * rd.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = rd.x * oax + rd.y * oay + rd.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  const b = baba * rdoa - baoa * bard;
  const c = baba * oaoa - baoa * baoa - r * r * baba;
  if (a > 1e-12) {
    const h = b * b - a * c;
    if (h < 0) return -1;
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : -1;
  }
  // 两端的半球
  const t0 = sphere(pa.x, pa.y, pa.z), t1 = sphere(pb.x, pb.y, pb.z);
  if (t0 < 0) return t1;
  if (t1 < 0) return t0;
  return Math.min(t0, t1);
}
