// owner: WP2
// char2 WP-U：上身用的网格拼装器——一份索引网格里加点（位置、UV、蒙皮）、连圈（等点数的四边形带、不等点数的拉链带）、开洞，
// 最后按“部件”（材质槽 + 绘制顺序 + own）拆成蒙皮部件。法线在拆之前对整张网格算（拆开的边界两边法线一致，看不出接缝）。

import * as THREE from 'three';
import type { MatSlot, SkinnedPiece } from '../types';
import { weldNormals } from '../shared';

/** 一个顶点的蒙皮：至多 4 个 [BONES 下标, 权重]（会归一化）。 */
export type Skin = readonly (readonly [number, number])[];

/** 拆分后的部件：同一个 key 的三角形进同一个 SkinnedPiece。 */
export interface PieceKey { name: string; slot: MatSlot; order?: number; own?: boolean; weld?: boolean; capsulePad?: number }

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();

export class MeshBuilder {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly si: number[] = [];
  readonly sw: number[] = [];
  readonly tri: number[] = [];
  readonly triPiece: number[] = [];
  readonly pieces: PieceKey[] = [];

  get count(): number {
    return this.pos.length / 3;
  }

  piece(k: PieceKey): number {
    const i = this.pieces.findIndex(p => p.name === k.name);
    if (i >= 0) return i;
    this.pieces.push(k);
    return this.pieces.length - 1;
  }

  v(x: number, y: number, z: number, u: number, v: number, skin: Skin): number {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    const list = [...skin].filter(([, w]) => w > 1e-6).sort((p, q) => q[1] - p[1]).slice(0, 4);
    const sum = list.reduce((s, [, w]) => s + w, 0) || 1;
    for (let k = 0; k < 4; k++) {
      this.si.push(list[k]?.[0] ?? 0);
      this.sw.push(list[k] ? list[k]![1] / sum : 0);
    }
    return this.count - 1;
  }

  P(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!);
  }

  setP(i: number, p: THREE.Vector3): void {
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
  }

  /**
   * 一圈点（pts：n 个 Vector3，同一约定：0 在“外侧/右侧”，然后往前）→ n+1 个顶点下标（末尾复制首点，u = 1）。
   * u(i)：缺省 i/n；skin(p, i)。
   */
  ring(pts: readonly THREE.Vector3[], v: number, skin: (p: THREE.Vector3, i: number) => Skin, u?: (i: number, n: number) => number): number[] {
    const n = pts.length;
    const out: number[] = [];
    for (let i = 0; i <= n; i++) {
      const p = pts[i % n]!;
      out.push(this.v(p.x, p.y, p.z, u ? u(i, n) : i / n, v, skin(p, i % n)));
    }
    return out;
  }

  /** 同一圈的另一份顶点（位置、蒙皮相同、可换 UV）：做硬边或换 UV 区。 */
  dupRing(r: readonly number[], uv?: (i: number) => [number, number]): number[] {
    return r.map((i, k) => {
      const skin: [number, number][] = [];
      for (let c = 0; c < 4; c++) skin.push([this.si[i * 4 + c]!, this.sw[i * 4 + c]!]);
      const [u, v] = uv ? uv(k) : [this.uv[i * 2]!, this.uv[i * 2 + 1]!];
      return this.v(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!, u, v, skin);
    });
  }

  t(a: number, b: number, c: number, piece: number): void {
    this.tri.push(a, b, c);
    this.triPiece.push(piece);
  }

  /** 两圈（各 n+1 个下标）之间的四边形带。skip(i)：跳过第 i 个四边形（开洞）。 */
  strip(A: readonly number[], B: readonly number[], piece: number | ((i: number) => number), skip?: (i: number) => boolean): void {
    const n = A.length - 1;
    if (B.length !== A.length) throw new Error(`strip: ring sizes ${A.length} vs ${B.length}`);
    for (let i = 0; i < n; i++) {
      if (skip?.(i)) continue;
      const pc = typeof piece === 'number' ? piece : piece(i);
      const a = A[i]!, b = A[i + 1]!, c = B[i]!, d = B[i + 1]!;
      this.t(a, b, d, pc);
      this.t(a, d, c, pc);
    }
  }

  /** 点数不同的两圈（各自末尾复制首点）按 u 参数拉链连起来；uA/uB：每个下标的参数（0..1，单调）。 */
  zip(A: readonly number[], B: readonly number[], piece: number, uA?: readonly number[], uB?: readonly number[]): void {
    const nA = A.length - 1, nB = B.length - 1;
    const ua = uA ?? A.map((_, i) => i / nA), ub = uB ?? B.map((_, i) => i / nB);
    let i = 0, j = 0;
    while (i < nA || j < nB) {
      if (i < nA && (j >= nB || ua[i + 1]! <= ub[j + 1]!)) {
        this.t(A[i]!, A[i + 1]!, B[j]!, piece);
        i++;
      } else {
        this.t(A[i]!, B[j + 1]!, B[j]!, piece);
        j++;
      }
    }
  }

  /**
   * 三角形 [from, to) 的绕向：按“法线·(顶点 - ref(顶点))”的多数票决定是否整体翻转（管子：ref = 所在圈的中心）。
   * 返回翻转前朝外的比例。
   */
  orient(from: number, to: number, ref: (p: THREE.Vector3) => THREE.Vector3): number {
    let good = 0, n = 0;
    for (let t = from; t < to; t++) {
      const [a, b, c] = [this.tri[t * 3]!, this.tri[t * 3 + 1]!, this.tri[t * 3 + 2]!];
      this.P(a, _a); this.P(b, _b); this.P(c, _c);
      const cen = new THREE.Vector3().add(_a).add(_b).add(_c).multiplyScalar(1 / 3);
      _n.subVectors(_b, _a).cross(_c.sub(_a));
      const d = _n.dot(cen.clone().sub(ref(cen)));
      if (Math.abs(d) < 1e-14) continue;
      n++;
      if (d > 0) good++;
    }
    if (n && good < n / 2) {
      for (let t = from; t < to; t++) {
        const k = this.tri[t * 3 + 1]!;
        this.tri[t * 3 + 1] = this.tri[t * 3 + 2]!;
        this.tri[t * 3 + 2] = k;
      }
    }
    return n ? good / n : 1;
  }

  /** 单个三角形按参考方向定绕向（填补的小块：指间蹼、端头）。 */
  tOriented(a: number, b: number, c: number, piece: number, outward: THREE.Vector3): void {
    this.P(a, _a); this.P(b, _b); this.P(c, _c);
    _n.subVectors(_b, _a).cross(_c.sub(_a));
    if (_n.dot(outward) >= 0) this.t(a, b, c, piece);
    else this.t(a, c, b, piece);
  }

  /**
   * fix2：补洞用的三角形，绕向跟已有的邻居一致：(a, b) 是某个已有三角形的边，新三角形里这条边反向出现。
   * 找不到邻居时按 a, b, c 原样加。
   */
  tMatch(a: number, b: number, c: number, piece: number): void {
    const T = this.tri;
    for (let t = 0; t < T.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const p = T[t + e]!, q = T[t + ((e + 1) % 3)]!;
        if (p === a && q === b) { this.t(b, a, c, piece); return; }
        if (p === b && q === a) { this.t(a, b, c, piece); return; }
      }
    }
    this.t(a, b, c, piece);
  }

  get triCount(): number {
    return this.tri.length / 3;
  }

  /**
   * 镜像复制（x → -x）：顶点 [vFrom, vTo)、三角形 [tFrom, tTo)；绕向翻转；蒙皮骨头按 boneMap 换（右 → 左）。
   * 返回旧下标 → 新下标的映射函数。
   */
  mirror(vFrom: number, vTo: number, tFrom: number, tTo: number, boneMap: (b: number) => number): (i: number) => number {
    const base = this.count;
    for (let i = vFrom; i < vTo; i++) {
      const skin: [number, number][] = [];
      for (let c = 0; c < 4; c++) skin.push([boneMap(this.si[i * 4 + c]!), this.sw[i * 4 + c]!]);
      this.v(-this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!, this.uv[i * 2]!, this.uv[i * 2 + 1]!, skin);
    }
    const map = (i: number) => (i >= vFrom && i < vTo ? base + (i - vFrom) : i);
    for (let t = tFrom; t < tTo; t++) {
      const a = this.tri[t * 3]!, b = this.tri[t * 3 + 1]!, c = this.tri[t * 3 + 2]!;
      this.t(map(a), map(c), map(b), this.triPiece[t]!);
    }
    return map;
  }

  /** 整张网格的法线（索引几何的面积加权平均，再按位置焊接复制点/UV 接缝；硬边 > 60° 保留）。 */
  normals(): Float32Array {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.tri);
    g.computeVertexNormals();
    weldNormals([g], { tol: 1e-5, minDot: 0.5 });
    const n = Float32Array.from((g.attributes.normal as THREE.BufferAttribute).array as Float32Array);
    g.dispose();
    return n;
  }

  /**
   * 拆成蒙皮部件：每个 piece 只留用到的顶点。nor：normals() 的结果（之后可以改）。
   * fix(piece, geo)：拆好之后的钩子（贴接缝 snapRing 之类）。
   */
  build(nor: Float32Array, track: <T extends THREE.BufferGeometry>(g: T) => T): { key: PieceKey; geo: THREE.BufferGeometry; remap: Int32Array }[] {
    const out: { key: PieceKey; geo: THREE.BufferGeometry; remap: Int32Array }[] = [];
    this.pieces.forEach((key, pi) => {
      const remap = new Int32Array(this.count).fill(-1);
      const pos: number[] = [], uv: number[] = [], no: number[] = [], si: number[] = [], sw: number[] = [], idx: number[] = [];
      for (let t = 0; t < this.triCount; t++) {
        if (this.triPiece[t] !== pi) continue;
        for (let k = 0; k < 3; k++) {
          const v = this.tri[t * 3 + k]!;
          let m = remap[v]!;
          if (m < 0) {
            m = pos.length / 3;
            remap[v] = m;
            pos.push(this.pos[v * 3]!, this.pos[v * 3 + 1]!, this.pos[v * 3 + 2]!);
            uv.push(this.uv[v * 2]!, this.uv[v * 2 + 1]!);
            no.push(nor[v * 3]!, nor[v * 3 + 1]!, nor[v * 3 + 2]!);
            for (let c = 0; c < 4; c++) { si.push(this.si[v * 4 + c]!); sw.push(this.sw[v * 4 + c]!); }
          }
          idx.push(m);
        }
      }
      if (!idx.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(no, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      g.setIndex(idx);
      out.push({ key, geo: track(g), remap });
    });
    return out;
  }
}

/** 拆好的部件 → SkinnedPiece。 */
export function toPiece(p: { key: PieceKey; geo: THREE.BufferGeometry }): SkinnedPiece {
  const k = p.key;
  return {
    kind: 'skinned', name: k.name, slot: k.slot, geo: p.geo,
    ...(k.own ? { own: true } : {}), ...(k.order !== undefined ? { order: k.order } : {}),
    ...(k.weld === false ? { weld: false } : {}), ...(k.capsulePad ? { capsulePad: k.capsulePad } : {}),
  };
}

/** 三次 Hermite：p0、m0（起点切线）、p1、m1。 */
export function hermite(p0: THREE.Vector3, m0: THREE.Vector3, p1: THREE.Vector3, m1: THREE.Vector3, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  return out.set(
    h00 * p0.x + h10 * m0.x + h01 * p1.x + h11 * m1.x,
    h00 * p0.y + h10 * m0.y + h01 * p1.y + h11 * m1.y,
    h00 * p0.z + h10 * m0.z + h01 * p1.z + h11 * m1.z,
  );
}

/** 有序表上的分段三次（Catmull-Rom，端点夹住）插值：xs 递增。 */
export function spline(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length;
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  let i = 0;
  while (i < n - 2 && x > xs[i + 1]!) i++;
  const x0 = xs[i]!, x1 = xs[i + 1]!;
  const t = (x - x0) / (x1 - x0);
  const y0 = ys[i]!, y1 = ys[i + 1]!;
  // 切线：相邻差商（单调保持的简化：Fritsch–Carlson 的平均）
  const d = (j: number) => {
    if (j <= 0) return (ys[1]! - ys[0]!) / (xs[1]! - xs[0]!);
    if (j >= n - 1) return (ys[n - 1]! - ys[n - 2]!) / (xs[n - 1]! - xs[n - 2]!);
    const a = (ys[j]! - ys[j - 1]!) / (xs[j]! - xs[j - 1]!), b = (ys[j + 1]! - ys[j]!) / (xs[j + 1]! - xs[j]!);
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  };
  const m0 = d(i) * (x1 - x0), m1 = d(i + 1) * (x1 - x0);
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1;
}

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
export const gauss = (x: number, w: number): number => Math.exp(-(x * x) / (w * w));
