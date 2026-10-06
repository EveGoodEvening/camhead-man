// owner: R4
// R4 建造用的小工具：贴图集格子 UV、几何烘焙与合并（同材质的静态件合成一个网格省 draw call，ARCH §13.3）。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AreaContext } from '../../../core/area';
import type { V3 } from '../../../core/types';
import { DEG2RAD } from '../../../core/math';

/** 把几何的 uv（0..1）压进贴图集的一格（cols × rows，格子按画布从左上角数：cell = row * cols + col）。 */
export function toCell<T extends THREE.BufferGeometry>(geo: T, cell: number, cols: number, rows: number): T {
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv) return geo;
  const cx = cell % cols, cy = Math.floor(cell / cols);
  const u0 = cx / cols, v0 = 1 - (cy + 1) / rows;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) / cols, v0 + uv.getY(i) / rows);
  uv.needsUpdate = true;
  return geo;
}

/** 平移、绕 y 旋转（three 的 rotation.y，度）、缩放后烘焙进几何。 */
export function bake<T extends THREE.BufferGeometry>(geo: T, pos: V3, rotYDeg = 0, scale: number | V3 = 1, rot?: V3): T {
  const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(scale[0], scale[1], scale[2]);
  const e = rot ? new THREE.Euler(rot[0] * DEG2RAD, rot[1] * DEG2RAD + rotYDeg * DEG2RAD, rot[2] * DEG2RAD) : new THREE.Euler(0, rotYDeg * DEG2RAD, 0);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(pos[0], pos[1], pos[2]), new THREE.Quaternion().setFromEuler(e), s);
  geo.applyMatrix4(m);
  return geo;
}

/** 合并（统一成 position/normal/uv 三个属性、全部带索引）；输入几何被释放。 */
export function mergeAll(geos: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = geos.map(g0 => {
    let g = g0;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((g.attributes.position?.count ?? 0) * 2), 2));
    if (!g.index) {
      const n = g.attributes.position?.count ?? 0;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g = g.clone();
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    return g;
  });
  const out = mergeGeometries(prepared, false) ?? new THREE.BufferGeometry();
  for (const g of prepared) g.dispose();
  for (const g of geos) g.dispose();
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** 一组几何合成一个网格并挂进场景（材质与几何都交给 ctx 追踪）。 */
export function addMerged(ctx: AreaContext, geos: readonly THREE.BufferGeometry[], mat: THREE.Material, name: string, parent?: THREE.Object3D, trackMat = true): THREE.Mesh {
  const m = new THREE.Mesh(mergeAll(geos), mat);
  m.name = name;
  if (trackMat) ctx.track(mat);
  ctx.add(m, parent ? { parent } : undefined);
  return m;
}

/** 立方体（原点在中心）。 */
export const boxG = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
/** 圆柱（原点在中心）。 */
export const cylG = (rt: number, rb: number, h: number, seg = 10): THREE.BufferGeometry => new THREE.CylinderGeometry(rt, rb, h, seg);

/** ctx.track 的批量版。 */
export function trackAll<T extends { dispose(): void }>(ctx: AreaContext, list: readonly T[]): void {
  for (const r of list) ctx.track(r);
}
