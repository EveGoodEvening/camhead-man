// owner: WP2
// char2 WP-X：人群与纸人共用的小网格工具（PLAN §3.5）。圈（ring）→ 搭桥（bridge）→ 封口（fan），索引几何；
// 法线按“同一位置 + 同一光滑组”焊接（UV 接缝、同一面料的分区边不出硬边），光滑组 < 0 的点不焊接（纸褶的硬棱、鞋底边）。
// 三角形朝外：每个四边形按“面中心 − 参考点”自动定绕向（参考点缺省 = 两圈的中心）。

import * as THREE from 'three';

export type P3 = readonly [number, number, number];

export class MeshBuilder {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly grp: number[] = [];
  readonly idx: number[] = [];

  get count(): number {
    return this.pos.length / 3;
  }

  /** 加一个点，返回下标。group：光滑组（同组同位置的点焊接法线；< 0 不焊接）。 */
  v(p: P3, u: number, v: number, group = 0): number {
    this.pos.push(p[0], p[1], p[2]);
    this.uv.push(u, v);
    this.grp.push(group);
    return this.count - 1;
  }

  p(i: number): THREE.Vector3 {
    return new THREE.Vector3(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!);
  }

  /** 一个三角形；out 给了时按“法线 · (面心 − out) > 0”定绕向。 */
  tri(a: number, b: number, c: number, out?: THREE.Vector3 | null): void {
    if (out) {
      const pa = this.p(a), pb = this.p(b), pc = this.p(c);
      const n = new THREE.Vector3().subVectors(pb, pa).cross(new THREE.Vector3().subVectors(pc, pa));
      const m = pa.add(pb).add(pc).multiplyScalar(1 / 3).sub(out);
      if (n.dot(m) < 0) {
        this.idx.push(a, c, b);
        return;
      }
    }
    this.idx.push(a, b, c);
  }

  /** 中心点（同一圈所有点的平均）。 */
  centre(ring: readonly number[]): THREE.Vector3 {
    const c = new THREE.Vector3();
    for (const i of ring) c.add(this.p(i));
    return c.multiplyScalar(1 / Math.max(1, ring.length));
  }

  /**
   * 两圈（等长）之间搭四边形。closed：首尾相接。inside：参考点（缺省两圈中心的中点；也可给函数按四边形求）。
   * 每个四边形各自定绕向（朝外）。
   */
  bridge(a: readonly number[], b: readonly number[], closed = true, inside?: THREE.Vector3 | ((qa: number, qb: number) => THREE.Vector3)): void {
    if (a.length !== b.length) throw new Error(`bridge: ring sizes ${a.length} vs ${b.length}`);
    const n = a.length;
    const mid = typeof inside === 'function' ? null : (inside ?? this.centre(a).add(this.centre(b)).multiplyScalar(0.5));
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n;
      const ref = mid ?? (inside as (qa: number, qb: number) => THREE.Vector3)(a[i]!, b[i]!);
      // 四边形 a_i a_j b_j b_i：取一致的对角线（a_i–b_j），两个三角形同向
      const pa = this.p(a[i]!), pb = this.p(a[j]!), pc = this.p(b[j]!), pd = this.p(b[i]!);
      const n1 = new THREE.Vector3().subVectors(pb, pa).cross(new THREE.Vector3().subVectors(pc, pa));
      const n2 = new THREE.Vector3().subVectors(pc, pa).cross(new THREE.Vector3().subVectors(pd, pa));
      const nq = n1.add(n2);
      const cq = pa.add(pb).add(pc).add(pd).multiplyScalar(0.25).sub(ref);
      if (nq.dot(cq) >= 0) this.idx.push(a[i]!, a[j]!, b[j]!, a[i]!, b[j]!, b[i]!);
      else this.idx.push(a[i]!, b[j]!, a[j]!, a[i]!, b[i]!, b[j]!);
    }
  }

  /** 扇形封口：ring 到中心点 c（绕向按 out 方向朝外）。 */
  fan(ring: readonly number[], c: number, outDir: THREE.Vector3, closed = true): void {
    const n = ring.length;
    const pc = this.p(c);
    const ref = pc.clone().sub(outDir);
    for (let i = 0; i < (closed ? n : n - 1); i++) this.tri(ring[i]!, ring[(i + 1) % n]!, c, ref);
  }

  /** 把另一个构建器的内容接到后面（索引顺序 = 画的顺序）。 */
  append(o: MeshBuilder): void {
    const base = this.count;
    this.pos.push(...o.pos);
    this.uv.push(...o.uv);
    this.grp.push(...o.grp);
    for (const i of o.idx) this.idx.push(i + base);
  }

  /** 生成几何：position / normal / uv / index。法线：面积加权，同组同位置焊接。 */
  build(): THREE.BufferGeometry {
    const n = this.count;
    const nor = new Float32Array(n * 3);
    const P = this.pos;
    // 去掉零面积的三角形（同位置复制点之间的“缝”，例如鞋底色线）
    const I: number[] = [];
    for (let t = 0; t < this.idx.length; t += 3) {
      const a = this.idx[t]!, b = this.idx[t + 1]!, c = this.idx[t + 2]!;
      const ux = P[b * 3]! - P[a * 3]!, uy = P[b * 3 + 1]! - P[a * 3 + 1]!, uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
      const vx = P[c * 3]! - P[a * 3]!, vy = P[c * 3 + 1]! - P[a * 3 + 1]!, vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * cx + cy * cy + cz * cz > 1e-18) I.push(a, b, c);
    }
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t]!, b = I[t + 1]!, c = I[t + 2]!;
      const ax = P[a * 3]!, ay = P[a * 3 + 1]!, az = P[a * 3 + 2]!;
      const ux = P[b * 3]! - ax, uy = P[b * 3 + 1]! - ay, uz = P[b * 3 + 2]! - az;
      const vx = P[c * 3]! - ax, vy = P[c * 3 + 1]! - ay, vz = P[c * 3 + 2]! - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) {
        nor[k * 3] += nx;
        nor[k * 3 + 1] += ny;
        nor[k * 3 + 2] += nz;
      }
    }
    // 焊接：同组、同位置（0.01mm 网格）
    const key = (i: number) => `${this.grp[i]}|${Math.round(P[i * 3]! * 1e5)},${Math.round(P[i * 3 + 1]! * 1e5)},${Math.round(P[i * 3 + 2]! * 1e5)}`;
    const groups = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      if ((this.grp[i] ?? 0) < 0) continue;
      const k = key(i);
      let l = groups.get(k);
      if (!l) groups.set(k, (l = []));
      l.push(i);
    }
    for (const l of groups.values()) {
      if (l.length < 2) continue;
      let x = 0, y = 0, z = 0;
      for (const i of l) { x += nor[i * 3]!; y += nor[i * 3 + 1]!; z += nor[i * 3 + 2]!; }
      for (const i of l) { nor[i * 3] = x; nor[i * 3 + 1] = y; nor[i * 3 + 2] = z; }
    }
    for (let i = 0; i < n; i++) {
      const x = nor[i * 3]!, y = nor[i * 3 + 1]!, z = nor[i * 3 + 2]!;
      const l = Math.hypot(x, y, z) || 1;
      nor[i * 3] = x / l;
      nor[i * 3 + 1] = y / l;
      nor[i * 3 + 2] = z / l;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setIndex(n < 65536 ? new THREE.BufferAttribute(new Uint16Array(I), 1) : new THREE.BufferAttribute(new Uint32Array(I), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
/** 光滑最大值（k = 过渡宽度）。 */
export function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
}
/** 超椭圆分量。 */
export const spow = (c: number, e: number): number => Math.sign(c) * Math.pow(Math.abs(c), e);

/** 分段线性表插值：xs 递增。 */
export function interp(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]!) return ys[0]!;
  const n = xs.length;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  let i = 1;
  while (i < n && xs[i]! < x) i++;
  const t = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
  return ys[i - 1]! + (ys[i]! - ys[i - 1]!) * t;
}

/** 平面上的轮廓 → 有厚度的薄片（纸手、纸剪的发髻）：正反两面 + 侧边。outline 逆时针（从 +z 看），在 xy 平面。 */
export function extrudeOutline(
  mb: MeshBuilder, outline: readonly [number, number][], thick: number, xf: (x: number, y: number, z: number) => P3,
  uvf: (x: number, y: number) => [number, number], group: number,
): void {
  const pts = outline.map(([x, y]) => new THREE.Vector2(x, y));
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const front: number[] = [], back: number[] = [];
  for (const [x, y] of outline) {
    const [u, v] = uvf(x, y);
    front.push(mb.v(xf(x, y, -thick / 2), u, v, group));
    back.push(mb.v(xf(x, y, thick / 2), u, v, group + 1));
  }
  // 两面：中心参考点放到另一面
  for (const t of tris) {
    const [a, b, c] = [t[0]!, t[1]!, t[2]!];
    const ref = mb.p(back[a]!).add(mb.p(back[b]!)).add(mb.p(back[c]!)).multiplyScalar(1 / 3);
    mb.tri(front[a]!, front[b]!, front[c]!, ref);
    const ref2 = mb.p(front[a]!).add(mb.p(front[b]!)).add(mb.p(front[c]!)).multiplyScalar(1 / 3);
    mb.tri(back[a]!, back[b]!, back[c]!, ref2);
  }
  // 侧边（硬边：单独的点）
  const n = outline.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = outline[i]!, [x1, y1] = outline[(i + 1) % n]!;
    area += x0 * y1 - x1 * y0;
  }
  const ccw = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [x0, y0] = outline[i]!, [x1, y1] = outline[j]!;
    const [u0, v0] = uvf(x0, y0), [u1, v1] = uvf(x1, y1);
    const a = mb.v(xf(x0, y0, -thick / 2), u0, v0, -1), b = mb.v(xf(x1, y1, -thick / 2), u1, v1, -1);
    const c = mb.v(xf(x1, y1, thick / 2), u1, v1, -1), d = mb.v(xf(x0, y0, thick / 2), u0, v0, -1);
    // 参考点：边中点往轮廓里面挪一点（逆时针轮廓的外法线是 (dy, −dx)）
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
    const e = Math.min(0.002, l * 0.5);
    const ref = new THREE.Vector3(...xf((x0 + x1) / 2 - (ccw * dy / l) * e, (y0 + y1) / 2 + (ccw * dx / l) * e, 0));
    mb.tri(a, b, c, ref);
    mb.tri(a, c, d, ref);
  }
}
