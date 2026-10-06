// owner: WP2
// 实例化人群（ARCH §5.4）：1984 合影、2008 门厅、1997 剪彩。
// 一个合并的低模人形（腿、躯干、胳膊、头）× 实例；排成 cols 列、前排在 z=0、往后每排 +spacing，后排略高（合影站台阶）；
// 人群面朝 -z，原点在第一排中间的地面。kidsFrontRow：第一排是这么多个小孩（缩小到 0.62）。
//
// M4 第 2 轮：回放人群改成圆一点的人形（圆筒躯干、腿、胳膊、头发帽、鞋），UV 指向一张 5 格的调色板（肤色、头发、上衣、裤子、鞋），
// 回放材质按调色板的亮度与色相调制（与人偶的回放部件同一个着色器程序，只是 uniform 不同）；三套衣服配色分三个 InstancedMesh
// （第一套是返回的 mesh，另两套挂在它下面）——原来是一个颜色的方块人，2–3m 外读成一摞摞圆盘，看不出是人。

import * as THREE from 'three';
import { DEG2RAD } from '../core/math';
import { MATERIALS } from '../fx/materials';
import { createReplayMaterial } from '../fx/ghostMaterials';
import { TEMP_C } from '../data/render';
import { canvasToTexture, createCanvas } from '../kit/canvas';
import { rng, range } from '../kit/rng';

export interface CrowdOpts { count: number; cols: number; spacing: number; look: 'replay' | 'ghost' | 'silhouette'; seed?: number; kidsFrontRow?: number }

let personGeo: THREE.BufferGeometry | null = null;

/** 调色板的格：肤色、头发、上衣、裤子、鞋（u 取格中心）。 */
const PAL = { skin: 0, hair: 1, shirt: 2, pants: 3, shoes: 4 } as const;
const PAL_N = 5;

/** 三套衣服配色（八九十年代的街坊）：[头发, 上衣, 裤子]。 */
const OUTFITS: readonly (readonly [string, string, string])[] = [
  ['#15120f', '#E4E0D4', '#34405E'],
  ['#1c1714', '#4E6386', '#2B2C31'],
  ['#8a8680', '#8A3B32', '#4A4238'],
];

function paletteTexture(hair: string, shirt: string, pants: string): THREE.CanvasTexture {
  const { canvas, g } = createCanvas(PAL_N, 1);
  const cols = ['#C9A080', hair, shirt, pants, '#1d1a18'];
  cols.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(i, 0, 1, 1);
  });
  const tex = canvasToTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.name = 'crowd.palette';
  return tex;
}

/** 1.72m 的低模人形（原点在脚底中间，面朝 -z）；UV 指向调色板的格。 */
function person(): THREE.BufferGeometry {
  if (personGeo) return personGeo;
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, pal: number, x: number, y: number, z: number, rz = 0) => {
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    const c = g.index ? g.toNonIndexed() : g;
    if (c !== g) g.dispose();
    const uv = new Float32Array((c.attributes.position?.count ?? 0) * 2);
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] = (pal + 0.5) / PAL_N;
      uv[i + 1] = 0.5;
    }
    c.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    parts.push(c);
  };
  // 腿（裤子，上端藏进裤腰，不封口）与鞋
  for (const sx of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.068, 0.056, 0.8, 8, 1, true), PAL.pants, sx * 0.085, 0.46, 0);
    const shoe = new THREE.BoxGeometry(0.1, 0.07, 0.24);
    add(shoe, PAL.shoes, sx * 0.085, 0.035, -0.04);
  }
  // 躯干（上衣）：Lathe 圆肩（轮廓自下而上，§16 #39），不再是顶上一块平盖——平盖在回放材质下是一圈亮椭圆，一排人像一摞硬币
  const prof = [[0.158, 0], [0.172, 0.18], [0.186, 0.4], [0.19, 0.5], [0.176, 0.57], [0.13, 0.625], [0.06, 0.655], [0.001, 0.662]] as const;
  const torso = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 12);
  torso.scale(1, 1, 0.62);
  add(torso, PAL.shirt, 0, 0.84, 0);
  // 裤腰（不封口）
  const hip = new THREE.CylinderGeometry(0.16, 0.15, 0.14, 12, 1, true);
  hip.scale(1, 1, 0.66);
  add(hip, PAL.pants, 0, 0.83, 0);
  // 胳膊（袖子，圆头）与手
  for (const sx of [-1, 1]) {
    add(new THREE.CapsuleGeometry(0.048, 0.48, 3, 7), PAL.shirt, sx * 0.225, 1.16, 0, sx * 0.08);
    add(new THREE.SphereGeometry(0.042, 6, 4), PAL.skin, sx * 0.248, 0.86, 0);
  }
  // 脖子、头、头发帽（盖住头顶与后脑，前额留出脸）
  add(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 8), PAL.skin, 0, 1.51, 0);
  const head = new THREE.SphereGeometry(0.105, 12, 8);
  head.scale(0.92, 1.1, 1);
  add(head, PAL.skin, 0, 1.63, 0);
  const hair = new THREE.SphereGeometry(0.112, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  hair.scale(0.93, 1.08, 1.02);
  hair.rotateX(0.35);
  add(hair, PAL.hair, 0, 1.645, 0.012);
  // 合并成一份：position/normal/uv
  let n = 0;
  for (const p of parts) n += p.attributes.position?.count ?? 0;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
  let o = 0;
  for (const p of parts) {
    const P = p.attributes.position as THREE.BufferAttribute, N = p.attributes.normal as THREE.BufferAttribute, U = p.attributes.uv as THREE.BufferAttribute;
    pos.set(P.array as Float32Array, o * 3);
    nor.set(N.array as Float32Array, o * 3);
    uvs.set(U.array as Float32Array, o * 2);
    o += P.count;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.computeBoundingBox();
  personGeo = g;
  return g;
}

/** 合并的低模人形，实例化（replay：三套配色三个 InstancedMesh，第一个是返回的 mesh、另两个是它的子节点）。 */
export function createCrowd(o: CrowdOpts): { mesh: THREE.InstancedMesh; bounds: THREE.Box3; dispose(): void } {
  const geo = person();
  const owned: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const variants = o.look === 'replay' ? OUTFITS.length : 1;
  const mats: THREE.Material[] = [];
  for (let v = 0; v < variants; v++) {
    if (o.look === 'replay') {
      const [hair, shirt, pants] = OUTFITS[v]!;
      const map = paletteTexture(hair, shirt, pants);
      textures.push(map);
      // 与人偶的回放部件同一套细节参数（rigs/humanoid.ts modeMatFor）：贴图亮度 0.85、原色 0.45、不透明度 0.75
      const m = createReplayMaterial({ map, mapAmt: 0.85, base: 0xffffff, baseAmt: 0.45, opacity: 0.75 });
      m.userData.tempC = TEMP_C.ambient;
      owned.push(m);
      mats.push(m);
    } else if (o.look === 'ghost') {
      mats.push(MATERIALS.ghost());
    } else {
      const m = new THREE.MeshBasicMaterial({ color: '#0b0d12' });
      owned.push(m);
      mats.push(m);
    }
  }
  const count = Math.max(0, Math.floor(o.count));
  const cols = Math.max(1, Math.floor(o.cols));
  const r = rng(o.seed ?? 1984);
  const kids = Math.max(0, Math.min(cols, o.kidsFrontRow ?? 0));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const bounds = new THREE.Box3();
  const bb = new THREE.Box3();
  const base = geo.boundingBox as THREE.Box3;
  const byVariant: THREE.Matrix4[][] = mats.map(() => []);
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols), col = i % cols;
    const inRow = Math.min(cols, count - row * cols);
    const isKid = row === 0 && col < kids;
    const k = isKid ? range(r, 0.58, 0.68) : range(r, 0.93, 1.06);
    // 每排居中、交错半个位，看得见后排的脸
    const x = (col - (inRow - 1) / 2) * o.spacing + (row % 2 ? o.spacing * 0.5 : 0) + range(r, -0.06, 0.06);
    const z = row * o.spacing * 0.85 + range(r, -0.05, 0.05);
    p.set(x, row * 0.15, z);
    q.setFromAxisAngle(up, range(r, -8, 8) * DEG2RAD);
    sc.set(k * range(r, 0.95, 1.08), k, k);
    m.compose(p, q, sc);
    byVariant[(i * 7 + row) % mats.length]!.push(m.clone());
    bb.copy(base).applyMatrix4(m);
    bounds.union(bb);
  }
  const meshes = mats.map((mat, v) => {
    const list = byVariant[v]!;
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    im.name = v === 0 ? 'crowd' : `crowd.${v}`;
    im.count = list.length;
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.computeBoundingBox();
    return im;
  });
  const mesh = meshes[0]!;
  for (let v = 1; v < meshes.length; v++) mesh.add(meshes[v]!);
  return {
    mesh,
    bounds,
    dispose() {
      // 共享的人形几何不释放（下一个人群还要用）；只释放自己的实例缓冲、私有材质与调色板
      for (const im of meshes) im.dispose();
      for (const mt of owned) mt.dispose();
      for (const t of textures) t.dispose();
      mesh.removeFromParent();
    },
  };
}
