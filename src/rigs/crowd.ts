// owner: WP2
// 实例化人群（ARCH §5.4）：1984 合影、2008 门厅、1997 剪彩。
// char2（PLAN §3.5）：一份连续的低模人形（crowdpaper/person.ts，≤ 3.6k 三角形：真的裆、膝、小腿肚、连指手 + 拇指、
// 有下颌鼻梁耳朵的头、头发就是外壳、鞋楦）× 实例；孩子是另一份同拓扑的几何（头 ×1.3、腿 ×0.85、躯干 ×0.9），
// 一个额外的 InstancedMesh（子节点 'crowd.kids'），不是缩小的大人。
// 排成 cols 列、前排在 z=0、往后每排 +spacing，后排略高（合影站台阶）；人群面朝 -z，原点在第一排中间的地面。
// kidsFrontRow：第一排是这么多个小孩。
//
// 回放：三套衣服配色、三个 InstancedMesh（+ 孩子一个，穿第一套：白衬衫蓝裤子）；图集逐像素画脸、领口、扣子、口袋、腰带（crowdAtlas.ts）。
// 回放/魂影材质写深度、由近到远（userData.ghostDepth，core/render.ts）：只剩最外一层壳，不再是“水晶棺”。
// 剪影：mesh 的实例数仍是总人数（终章的缩微合影复制 mesh 的实例矩阵与 count）；孩子在 mesh 里的格子是零缩放的占位，真正画在 'crowd.kids' 里。

import * as THREE from 'three';
import { DEG2RAD } from '../core/math';
import { PALETTE } from '../data/palette';
import { createGhostMaterial, createReplayMaterial } from '../fx/ghostMaterials';
import { TEMP_C } from '../data/render';
import { rng, range } from '../kit/rng';
import { ADULT, KID, buildPerson } from './crowdpaper/person';
import { CROWD_OUTFITS, crowdAtlas } from './crowdpaper/crowdAtlas';

export interface CrowdOpts { count: number; cols: number; spacing: number; look: 'replay' | 'ghost' | 'silhouette'; seed?: number; kidsFrontRow?: number }

let adultGeo: THREE.BufferGeometry | null = null;
let kidGeo: THREE.BufferGeometry | null = null;
/** 共享的人形几何（缓存，不释放：下一个人群还要用）。 */
export function crowdPersonGeometry(kid = false): THREE.BufferGeometry {
  if (kid) return (kidGeo ??= buildPerson(KID));
  return (adultGeo ??= buildPerson(ADULT));
}

/** 合并的低模人形，实例化（replay：三套配色三个 InstancedMesh + 孩子一个，第一个是返回的 mesh、其余是它的子节点）。 */
export function createCrowd(o: CrowdOpts): { mesh: THREE.InstancedMesh; bounds: THREE.Box3; dispose(): void } {
  const geo = crowdPersonGeometry(false);
  const kidG = crowdPersonGeometry(true);
  const owned: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const variants = o.look === 'replay' ? CROWD_OUTFITS.length : 1;
  const mats: THREE.Material[] = [];
  for (let v = 0; v < variants; v++) {
    let m: THREE.Material;
    if (o.look === 'replay') {
      const map = crowdAtlas(v);
      textures.push(map);
      // 与人偶的回放部件同一套细节参数（rigs/human/surface modeDetail）：贴图 0.85、原色 0.45、不透明度 0.75
      m = createReplayMaterial({ map, mapAmt: 0.85, base: 0xffffff, baseAmt: 0.45, opacity: 0.75, solid: 0.22, rim: 0.22, albedo: 1 });
      m.userData.tempC = TEMP_C.ambient;
    } else if (o.look === 'ghost') {
      const map = crowdAtlas(0);
      textures.push(map);
      m = createGhostMaterial(PALETTE.GHOST, { map, mapAmt: 0.5, base: 0xffffff, baseAmt: 0.3, solid: 0.22, rim: 0.32, albedo: 1 });
      m.userData.tempC = TEMP_C.yin;
    } else {
      m = new THREE.MeshBasicMaterial({ color: '#0b0d12' });
    }
    if ((m as THREE.ShaderMaterial).isShaderMaterial) {
      // 近的先画并写深度，被挡住的远处部分画不上去（人身只剩外壳）；淡出时 setMaterialOpacity 会关掉深度写入
      m.depthWrite = true;
      m.userData.ghostDepth = true;
    }
    owned.push(m);
    mats.push(m);
  }
  const count = Math.max(0, Math.floor(o.count));
  const cols = Math.max(1, Math.floor(o.cols));
  const r = rng(o.seed ?? 1984);
  const kids = Math.max(0, Math.min(cols, o.kidsFrontRow ?? 0));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const bounds = new THREE.Box3();
  const bb = new THREE.Box3();
  geo.computeBoundingBox();
  kidG.computeBoundingBox();
  const base = geo.boundingBox as THREE.Box3, kidBase = kidG.boundingBox as THREE.Box3;
  const byVariant: THREE.Matrix4[][] = mats.map(() => []);
  const kidList: THREE.Matrix4[] = [];
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const oneMesh = mats.length === 1;
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols), col = i % cols;
    const inRow = Math.min(cols, count - row * cols);
    const isKid = row === 0 && col < kids;
    // 随机数的调用顺序与旧版相同（布局不变）；孩子的几何本身矮（1.64m 的比例 → 实例缩放后 1.05–1.25m）
    const raw = isKid ? range(r, 0.58, 0.68) : range(r, 0.93, 1.06);
    const k = isKid ? 0.64 + (raw - 0.58) * 1.2 : raw;
    // 每排居中、交错半个位，看得见后排的脸
    const x = (col - (inRow - 1) / 2) * o.spacing + (row % 2 ? o.spacing * 0.5 : 0) + range(r, -0.06, 0.06);
    const z = row * o.spacing * 0.85 + range(r, -0.05, 0.05);
    p.set(x, row * 0.15, z);
    q.setFromAxisAngle(up, range(r, -8, 8) * DEG2RAD);
    sc.set(k * range(r, 0.95, 1.08), k, k);
    m.compose(p, q, sc);
    if (isKid) {
      kidList.push(m.clone());
      if (oneMesh) byVariant[0]!.push(zero.clone());
      bb.copy(kidBase).applyMatrix4(m);
    } else {
      byVariant[(i * 7 + row) % mats.length]!.push(m.clone());
      bb.copy(base).applyMatrix4(m);
    }
    bounds.union(bb);
  }
  const make = (g: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], name: string) => {
    const im = new THREE.InstancedMesh(g, mat, Math.max(1, list.length));
    im.name = name;
    im.count = list.length;
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.computeBoundingBox();
    return im;
  };
  const meshes = mats.map((mat, v) => make(geo, mat, byVariant[v]!, v === 0 ? 'crowd' : `crowd.${v}`));
  if (kidList.length) meshes.push(make(kidG, mats[0]!, kidList, 'crowd.kids'));
  const mesh = meshes[0]!;
  for (let v = 1; v < meshes.length; v++) mesh.add(meshes[v]!);
  return {
    mesh,
    bounds,
    dispose() {
      // 共享的人形几何不释放（下一个人群还要用）；只释放自己的实例缓冲、私有材质与图集
      for (const im of meshes) im.dispose();
      for (const mt of owned) mt.dispose();
      for (const t of textures) t.dispose();
      mesh.removeFromParent();
    },
  };
}
