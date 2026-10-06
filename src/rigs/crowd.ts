// owner: WP2
// 实例化人群（ARCH §5.4）：1984 合影、2008 门厅、1997 剪彩。
// 一个合并的低模人形（腿、躯干、胳膊、头）× 实例；排成 cols 列、前排在 z=0、往后每排 +spacing，后排略高（合影站台阶）；
// 人群面朝 -z，原点在第一排中间的地面。kidsFrontRow：第一排是这么多个小孩（缩小到 0.62）。
//
// 人群沿用三套配色、三个 InstancedMesh；脸、衣襟和布料绘进同一图集，近景不再是无脸圆球。
// 轮廓有圆肩、手掌、裤腿和鞋楦，几何仍是一份缓存，人数增加不增加 draw call。

import * as THREE from 'three';
import { DEG2RAD } from '../core/math';
import { MATERIALS } from '../fx/materials';
import { createReplayMaterial } from '../fx/ghostMaterials';
import { TEMP_C } from '../data/render';
import { canvasToTexture, createCanvas } from '../kit/canvas';
import { rng, range } from '../kit/rng';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { faceTexture, squircleLoft } from './humanoid';

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
  const { canvas, g } = createCanvas(256, 256);
  g.scale(0.5, 0.5);
  const face = faceTexture({ skin: '#C9A080', hair, hairStyle: 'short', age: hair === '#8a8680' ? 'old' : 'young' });
  g.drawImage(face.image, 0, 0, 512, 256);
  g.fillStyle = shirt;
  g.fillRect(0, 256, 512, 160);
  g.fillStyle = 'rgba(0,0,0,0.14)';
  g.fillRect(126, 263, 4, 153);
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 1;
  g.strokeRect(56, 290, 34, 30);
  g.strokeRect(166, 290, 34, 30);
  g.fillStyle = 'rgba(235,229,210,0.6)';
  for (let y = 279; y < 409; y += 28) {
    g.beginPath();
    g.arc(128, y, 1.5, 0, Math.PI * 2);
    g.fill();
  }
  const cols = ['#C9A080', hair, shirt, pants, '#1d1a18'];
  cols.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(i * 512 / PAL_N, 416, Math.ceil(512 / PAL_N), 96);
  });
  const tex = canvasToTexture(canvas);
  tex.name = 'crowd.atlas';
  return tex;
}

/** 1.72m 的低模人形（原点在脚底中间，面朝 -z）；UV 指向调色板的格。 */
function person(): THREE.BufferGeometry {
  if (personGeo) return personGeo;
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, pal: number, x: number, y: number, z: number, rz = 0, detail?: 'face' | 'shirt') => {
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    const c = g.index ? g.toNonIndexed() : g;
    if (c !== g) g.dispose();
    const uv = c.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      if (detail === 'face') uv.setY(i, 0.5 + uv.getY(i) * 0.5);
      else if (detail === 'shirt') uv.setY(i, 0.1875 + uv.getY(i) * 0.3125);
      else uv.setXY(i, (pal + 0.5) / PAL_N, 0.09);
    }
    parts.push(c);
  };
  for (const sx of [-1, 1]) {
    const leg = new THREE.LatheGeometry([
      new THREE.Vector2(0.048, 0.07), new THREE.Vector2(0.052, 0.22), new THREE.Vector2(0.067, 0.36),
      new THREE.Vector2(0.062, 0.5), new THREE.Vector2(0.08, 0.73), new THREE.Vector2(0.087, 0.9),
    ], 12);
    leg.scale(1, 1, 0.92);
    add(leg, PAL.pants, sx * 0.09, 0, 0);
    add(new RoundedBoxGeometry(0.105, 0.075, 0.25, 1, 0.016), PAL.shoes, sx * 0.09, 0.038, -0.052);
  }
  const torso = squircleLoft([
    { y: 0, a: 0.16, b: 0.105 }, { y: 0.1, a: 0.167, b: 0.11 },
    { y: 0.28, a: 0.185, b: 0.12, front: 0.08 }, { y: 0.38, a: 0.193, b: 0.117, drop: 0.016 },
    { y: 0.43, a: 0.15, b: 0.09, drop: 0.028 },
  ], 20, { capTop: { y: 0.452, a: 0.061, b: 0.055 } });
  add(torso, PAL.shirt, 0, 1.035, 0, 0, 'shirt');
  const hip = new THREE.CylinderGeometry(0.16, 0.15, 0.2, 16, 1, true);
  hip.scale(1, 1, 0.67);
  add(hip, PAL.pants, 0, 0.95, 0);
  for (const sx of [-1, 1]) {
    const sleeve = new THREE.LatheGeometry([
      new THREE.Vector2(0.032, -0.55), new THREE.Vector2(0.042, -0.4), new THREE.Vector2(0.049, -0.29),
      new THREE.Vector2(0.059, -0.15), new THREE.Vector2(0.067, -0.025), new THREE.Vector2(0.047, 0.028), new THREE.Vector2(0, 0.055),
    ], 12);
    sleeve.scale(1, 1, 0.9);
    add(sleeve, PAL.shirt, sx * 0.19, 1.42, 0, sx * 0.06);
    const hand = new THREE.CapsuleGeometry(0.025, 0.065, 3, 10);
    hand.scale(0.6, 1, 1);
    add(hand, PAL.skin, sx * 0.226, 0.835, -0.004);
  }
  add(new THREE.CylinderGeometry(0.044, 0.058, 0.085, 12), PAL.skin, 0, 1.51, 0);
  const head = new THREE.SphereGeometry(0.105, 24, 16);
  head.scale(0.9, 1.1, 1);
  const hp = head.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < hp.count; i++) {
    if (hp.getY(i) < 0) hp.setX(i, hp.getX(i) * (1 + hp.getY(i) * 0.8));
  }
  head.computeVertexNormals();
  add(head, PAL.skin, 0, 1.63, 0, 0, 'face');
  const nose = new THREE.SphereGeometry(1, 8, 6);
  nose.scale(0.012, 0.024, 0.015);
  add(nose, PAL.skin, 0, 1.611, -0.101);
  for (const sx of [-1, 1]) {
    const ear = new THREE.SphereGeometry(1, 8, 6);
    ear.scale(0.009, 0.021, 0.013);
    add(ear, PAL.skin, sx * 0.094, 1.623, 0.008);
  }
  const hair = new THREE.SphereGeometry(0.108, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  hair.scale(0.93, 1.08, 1.02);
  hair.rotateX(0.35);
  add(hair, PAL.hair, 0, 1.632, 0.004);
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
      const m = createReplayMaterial({ map, mapAmt: 0.85, base: 0xffffff, baseAmt: 0.45, opacity: 0.75, solid: 0.22, rim: 0.22, albedo: 1 });
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
