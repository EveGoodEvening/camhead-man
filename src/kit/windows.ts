// owner: WP2
// 实例化窗格（ARCH §10.2）：instanceColor 区分亮/暗。
//
// face：origin = 左下角那扇窗的中心；right = 沿立面的单位方向（站在楼外面向立面时的右手）；up = 行距向量
// （例如 [0, 2.8, 0] 表示每行一层楼；长度≈1 时按 2.8m 一层）；窗面法线 = right × up（朝楼外）。列距 = s.spacing。
// 一次 draw call：窗框、玻璃、窗帘都画在一张小贴图里，MeshBasicMaterial × instanceColor——亮窗是暖黄 ×3–4 的 HDR 色（不受灯光影响，
// 夜里自己发光，Bloom 能吃到），暗窗是蓝黑的玻璃。红外替换时 instanceColor 由 IrRenderer 暂时置空（ARCH §6.8.2）。

import * as THREE from 'three';
import type { V3 } from '../core/types';
import { PALETTE } from '../data/palette';
import { paintTexture, shade } from './canvas';
import { rng, range } from './rng';

export interface WindowSpec { w: number; h: number; spacing: number; litRatio?: number; litColor?: string; frame?: 'wood' | 'steel'; bars?: boolean }

const texCache = new Map<string, THREE.CanvasTexture>();

/** 窗贴图：外框、十字窗棂、玻璃（下半截挂着旧窗帘）、可选的防盗栏杆。颜色偏白，由 instanceColor 着色。 */
function windowTexture(frame: 'wood' | 'steel', bars: boolean): THREE.CanvasTexture {
  const key = `${frame}.${bars}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const t = paintTexture(128, 160, (g, w, h) => {
    const fc = frame === 'wood' ? '#3a2e24' : '#2a2c30';
    g.fillStyle = fc;
    g.fillRect(0, 0, w, h);
    // 玻璃：上亮下暗的渐变（有灯的屋里是灯下亮）
    const b = 8;
    const grd = g.createLinearGradient(0, b, 0, h - b);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(1, '#d9d4c6');
    g.fillStyle = grd;
    g.fillRect(b, b, w - 2 * b, h - 2 * b);
    // 窗帘：两侧拉开的一截布
    g.fillStyle = 'rgba(150,120,90,0.55)';
    g.fillRect(b, b, w * 0.22, h - 2 * b);
    g.fillRect(w - b - w * 0.18, b, w * 0.18, h - 2 * b);
    // 窗棂
    g.fillStyle = fc;
    g.fillRect(w / 2 - 3, b, 6, h - 2 * b);
    g.fillRect(b, h * 0.38, w - 2 * b, 6);
    if (bars) {
      g.fillStyle = '#1b1c1f';
      for (let x = b + 10; x < w - b; x += 16) g.fillRect(x, 0, 3, h);
      g.fillRect(0, h * 0.2, w, 3);
      g.fillRect(0, h * 0.8, w, 3);
    }
  }, { srgb: true });
  t.name = `window.${key}`;
  texCache.set(key, t);
  return t;
}

let windowGeo: THREE.BufferGeometry | null = null;
function unitQuad(): THREE.BufferGeometry {
  windowGeo ??= new THREE.PlaneGeometry(1, 1);
  return windowGeo;
}

/** WP2 内部：算出一面墙上每扇窗的变换（building.ts 把多面墙合成一个 InstancedMesh）。 */
export function windowTransforms(face: { origin: V3; right: V3; up: V3; cols: number; rows: number }, s: WindowSpec, skip?: (col: number, row: number) => boolean): THREE.Matrix4[] {
  const right = new THREE.Vector3(...face.right).normalize();
  const upRaw = new THREE.Vector3(...face.up);
  const upLen = upRaw.length();
  const upDir = upRaw.clone().normalize();
  const rowStep = Math.abs(upLen - 1) < 1e-3 ? 2.8 : upLen;
  const normal = right.clone().cross(upDir).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, upDir, normal);
  const out: THREE.Matrix4[] = [];
  const o = new THREE.Vector3(...face.origin);
  for (let row = 0; row < face.rows; row++) {
    for (let col = 0; col < face.cols; col++) {
      if (skip?.(col, row)) continue;
      const p = o.clone().addScaledVector(right, col * s.spacing).addScaledVector(upDir, row * rowStep).addScaledVector(normal, 0.012);
      const m = basis.clone().scale(new THREE.Vector3(s.w, s.h, 1)).setPosition(p);
      out.push(m);
    }
  }
  return out;
}

/** WP2 内部：用一组变换建窗户实例网格（亮/暗按 seed 决定）。 */
export function windowMesh(xf: readonly THREE.Matrix4[], s: WindowSpec, seed = 1): THREE.InstancedMesh {
  const mat = new THREE.MeshBasicMaterial({ map: windowTexture(s.frame ?? 'wood', s.bars ?? false), color: 0xffffff });
  mat.userData.tempC = 18;
  mat.name = 'windows';
  const mesh = new THREE.InstancedMesh(unitQuad(), mat, Math.max(1, xf.length));
  mesh.name = 'windows';
  mesh.count = xf.length;
  mesh.userData.sharedGeometry = true;
  const r = rng(seed);
  const lit = new THREE.Color(s.litColor ?? PALETTE.HALL_LAMP);
  const litRatio = s.litRatio ?? 0.08;
  const c = new THREE.Color();
  xf.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
    // 亮窗 ×3–4（HDR，M1c look-dev；原来 ≤ 1.05）：屋里的灯比夜里的室外亮得多——近处的亮窗烧成暖白、带一点 Bloom，
    // 20–30m 外 R1 的雾（0.045）里仍是几颗透出来的暖白点（原来在雾里只剩一块灰黄）
    if (r() < litRatio) c.copy(lit).multiplyScalar(range(r, 3.0, 4.0));
    else c.set(shade('#1A2030', range(r, 0.7, 1.3)));
    mesh.setColorAt(i, c);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  return mesh;
}

export function windowGrid(face: { origin: V3; right: V3; up: V3; cols: number; rows: number }, s: WindowSpec, seed?: number): THREE.InstancedMesh {
  return windowMesh(windowTransforms(face, s), s, seed ?? 1);
}
