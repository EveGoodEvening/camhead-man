// owner: WP2
// char2 WP-C：配件用的几何小工具（只在 src/rigs/accessories.ts、characters.ts、player.ts 里用）。
// 管子（沿曲线放样、椭圆截面、可指定截面朝向）、旋转体、带厚度的薄片、合并；以及 HeadFit——按真正的头网格量出
// 某个高度、某个方向上头（连头发）的外表面在哪里，帽子、眼镜、胡子照着它贴，不管头是旧版的蛋头还是新雕的头。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loftRings } from '../human/shared';

export type P3 = readonly [number, number, number];
const v3 = (p: P3 | THREE.Vector3): THREE.Vector3 => (p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]));

/**
 * 沿一条平滑曲线（Catmull-Rom，经过所有控制点）放样的管子：截面是椭圆（a 沿 side、b 沿 normal），半径随 t∈[0,1] 变。
 * 截面朝向：给 up(t, p) 时，normal = up 去掉切向分量（扁带子的“朝外”面）；否则平行移动标架。两端可封口。
 * UV：u 绕截面一圈，v 沿长度（0 → 1，或 vRange）。
 */
export function tube(
  points: readonly (P3 | THREE.Vector3)[],
  radius: number | readonly [number, number] | ((t: number) => number | readonly [number, number]),
  o?: {
    seg?: number; radial?: number; caps?: boolean | 'start' | 'end';
    up?: (t: number, p: THREE.Vector3) => THREE.Vector3; tension?: number; vRange?: readonly [number, number];
    /** 截面形状：每个角度的半径倍数（缺省 1 = 椭圆） */
    shape?: (ang: number, t: number) => number;
  },
): THREE.BufferGeometry {
  const seg = o?.seg ?? 16, radial = o?.radial ?? 8;
  const curve = new THREE.CatmullRomCurve3(points.map(v3), false, 'catmullrom', o?.tension ?? 0.5);
  const P: THREE.Vector3[] = [], T: THREE.Vector3[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    P.push(curve.getPointAt(t));
    T.push(curve.getTangentAt(t).normalize());
  }
  // 标架
  const N: THREE.Vector3[] = [], B: THREE.Vector3[] = [];
  let n0 = new THREE.Vector3();
  if (!o?.up) {
    const t0 = T[0]!;
    const ref = Math.abs(t0.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    n0 = ref.sub(t0.clone().multiplyScalar(ref.dot(t0))).normalize();
  }
  for (let i = 0; i <= seg; i++) {
    const t = T[i]!;
    let n: THREE.Vector3;
    if (o?.up) {
      n = o.up(i / seg, P[i]!).clone();
      n.sub(t.clone().multiplyScalar(n.dot(t)));
      if (n.lengthSq() < 1e-10) n = N[i - 1]?.clone() ?? new THREE.Vector3(0, 0, 1);
      n.normalize();
    } else if (i === 0) n = n0;
    else {
      const prev = N[i - 1]!;
      n = prev.clone().sub(t.clone().multiplyScalar(prev.dot(t))).normalize();
    }
    N.push(n);
    B.push(new THREE.Vector3().crossVectors(t, n).normalize());
  }
  const rings: Float32Array[] = [];
  const vs: number[] = [];
  const [v0, v1] = o?.vRange ?? [0, 1];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const rr = typeof radius === 'function' ? radius(t) : radius;
    const a = typeof rr === 'number' ? rr : rr[0], b = typeof rr === 'number' ? rr : rr[1];
    const ring = new Float32Array(radial * 3);
    for (let k = 0; k < radial; k++) {
      const ang = (k / radial) * Math.PI * 2;
      const m = o?.shape ? o.shape(ang, t) : 1;
      const x = Math.cos(ang) * a * m, y = Math.sin(ang) * b * m;
      const p = P[i]!;
      ring[k * 3] = p.x + B[i]!.x * x + N[i]!.x * y;
      ring[k * 3 + 1] = p.y + B[i]!.y * x + N[i]!.y * y;
      ring[k * 3 + 2] = p.z + B[i]!.z * x + N[i]!.z * y;
    }
    rings.push(ring);
    vs.push(v0 + (v1 - v0) * t);
  }
  const caps = o?.caps ?? false;
  const start = caps === true || caps === 'start', end = caps === true || caps === 'end';
  return loftRings(rings, {
    v: vs,
    ...(start ? { capStart: [P[0]!.x, P[0]!.y, P[0]!.z] as const } : {}),
    ...(end ? { capEnd: [P[seg]!.x, P[seg]!.y, P[seg]!.z] as const } : {}),
  });
}

/**
 * 旋转体：轮廓 [r, y] 必须自下而上（three r186 LatheGeometry 的法线是 (dy, −dx)：往上走 = 朝外；往下走的一段朝里，
 * 正好是杯子内壁），sx/sz 压成椭圆。返回索引几何（v 自下而上 0→1）。
 */
export function lathe(profile: readonly (readonly [number, number])[], seg = 24, o?: { sx?: number; sz?: number; phi?: number; phiLen?: number }): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-5), y)), seg, o?.phi ?? 0, o?.phiLen ?? Math.PI * 2);
  // LatheGeometry 的 v 是 j/(n−1)（自上而下读贴图会倒），统一成按轮廓自下而上 0→1
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  if ((o?.sx ?? 1) !== 1 || (o?.sz ?? 1) !== 1) {
    g.scale(o?.sx ?? 1, 1, o?.sz ?? 1);
    g.computeVertexNormals();
  }
  return g;
}

/**
 * 有厚度的薄片：grid[j][i]（j 行、i 列）是表面一侧的点；另一侧沿法线（第一面的顶点法线）往 −n 方向偏 thick。
 * 四边（wrapU 时只有上下两条边）用窄条封起来。UV：u = i/(cols−1)，v = j/(rows−1)（两面一样，可以再用 uvMap 改）。
 */
export function thickSheet(grid: readonly (readonly THREE.Vector3[])[], thick: number, o?: { wrapU?: boolean; uv?: (i: number, j: number) => readonly [number, number] }): THREE.BufferGeometry {
  const rows = grid.length, cols = grid[0]!.length;
  const wrap = o?.wrapU === true;
  const uvOf = (i: number, j: number): readonly [number, number] => o?.uv ? o.uv(i, j) : [i / (wrap ? cols : cols - 1), j / (rows - 1)];
  // 第一面
  const top = new THREE.BufferGeometry();
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const C = wrap ? cols + 1 : cols;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < C; i++) {
      const p = grid[j]![i % cols]!;
      pos.push(p.x, p.y, p.z);
      const u = uvOf(i, j);
      uv.push(u[0], u[1]);
    }
  }
  for (let j = 0; j + 1 < rows; j++) {
    for (let i = 0; i + 1 < C; i++) {
      const a = j * C + i, b = a + 1, c = a + C, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  top.setIndex(idx);
  top.computeVertexNormals();
  if (wrap) seamAverage(top, rows, C);
  const n = top.attributes.normal as THREE.BufferAttribute;
  // 第二面：沿 −n 偏 thick，绕序反过来
  const bpos: number[] = [];
  for (let k = 0; k < n.count; k++) bpos.push(pos[k * 3]! - n.getX(k) * thick, pos[k * 3 + 1]! - n.getY(k) * thick, pos[k * 3 + 2]! - n.getZ(k) * thick);
  const bot = new THREE.BufferGeometry();
  bot.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
  bot.setAttribute('uv', new THREE.Float32BufferAttribute(uv.slice(), 2));
  const bidx: number[] = [];
  for (let t = 0; t < idx.length; t += 3) bidx.push(idx[t]!, idx[t + 2]!, idx[t + 1]!);
  bot.setIndex(bidx);
  bot.computeVertexNormals();
  if (wrap) seamAverage(bot, rows, C);
  // 边条
  const edges: THREE.BufferGeometry[] = [];
  const strip = (ks: readonly number[], flip: boolean) => {
    const sp: number[] = [], su: number[] = [], si: number[] = [];
    for (let m = 0; m < ks.length; m++) {
      const k = ks[m]!;
      sp.push(pos[k * 3]!, pos[k * 3 + 1]!, pos[k * 3 + 2]!, bpos[k * 3]!, bpos[k * 3 + 1]!, bpos[k * 3 + 2]!);
      su.push(uv[k * 2]!, uv[k * 2 + 1]!, uv[k * 2]!, uv[k * 2 + 1]!);
    }
    for (let m = 0; m + 1 < ks.length; m++) {
      const a = m * 2, b = a + 1, c = a + 2, d = a + 3;
      if (flip) si.push(a, c, b, b, c, d);
      else si.push(a, b, c, b, d, c);
    }
    const e = new THREE.BufferGeometry();
    e.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    e.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
    e.setIndex(si);
    e.computeVertexNormals();
    edges.push(e);
  };
  const row = (j: number) => Array.from({ length: C }, (_, i) => j * C + i);
  const col = (i: number) => Array.from({ length: rows }, (_, j) => j * C + i);
  // 第一面法线 = dv × du；边条 (−n) × 走向：第 0 行、最后一列要翻
  strip(row(0), true);
  strip(row(rows - 1), false);
  if (!wrap) {
    strip(col(0), false);
    strip(col(C - 1), true);
  }
  return mergeParts([top, bot, ...edges]);
}

function seamAverage(g: THREE.BufferGeometry, rows: number, C: number): void {
  const n = g.attributes.normal as THREE.BufferAttribute;
  const t = new THREE.Vector3();
  for (let j = 0; j < rows; j++) {
    const a = j * C, b = j * C + C - 1;
    t.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, t.x, t.y, t.z);
    n.setXYZ(b, t.x, t.y, t.z);
  }
}

/** 合并（只留 position/normal/uv；缺 uv 的补 0；全部转成有索引）。输入几何随后释放。 */
export function mergeParts(geos: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = geos.map(g0 => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', g0.attributes.position!);
    if (!g0.attributes.normal) g0.computeVertexNormals();
    g.setAttribute('normal', g0.attributes.normal!);
    const n = (g0.attributes.position as THREE.BufferAttribute).count;
    g.setAttribute('uv', g0.attributes.uv ?? new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    g.setIndex(g0.index ? g0.index : Array.from({ length: n }, (_, i) => i));
    return g;
  });
  const out = mergeGeometries(list, false);
  if (!out) throw new Error('mergeParts: merge failed');
  for (const g of geos) g.dispose();
  return out;
}

/** 把几何的全部 UV 压到贴图上的一个小矩形里（合并到同一张贴图的几块）。 */
export function remapUv(g: THREE.BufferGeometry, u0: number, v0: number, u1: number, v1: number): THREE.BufferGeometry {
  const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv) return g;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
  return g;
}

// ---------------------------------------------------------------- 头的外形（按真实头网格量）

/**
 * 头部外表面采样（headSlot 局部坐标）：从人偶的 'head' 网格（含头发壳、耳、鼻）取顶点，
 * radius(y, ang) = 高 y 附近、方位 ang（0 = +x，往 −z（前）转）上，离头的竖直中轴最远的水平距离；
 * front(x, y) = (x, y) 附近最靠前（z 最小）的表面 z。没有头网格时退回一个按地标的椭球。
 */
export class HeadFit {
  readonly cx: number;
  readonly cz: number;
  readonly top: number;
  readonly bottom: number;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  /** 直接用一组点（测试：拿帽子自己的顶点量帽身半径）。 */
  static fromPoints(points: readonly THREE.Vector3[], centre: P3): HeadFit {
    return new HeadFit(null, { centre, ax: [0, 0, 0] }, points);
  }

  constructor(head: THREE.Object3D | null | undefined, fallback: { centre: P3; ax: P3 }, points?: readonly THREE.Vector3[]) {
    const pts: number[] = [];
    if (points) {
      for (const p of points) pts.push(p.x, p.y, p.z);
    } else if (head && (head as THREE.Mesh).isMesh) {
      const m = head as THREE.Mesh;
      m.updateMatrix();
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrix);
        pts.push(v.x, v.y, v.z);
      }
    } else {
      const [cx, cy, cz] = fallback.centre, [ax, ay, az] = fallback.ax;
      for (let j = 0; j <= 24; j++) {
        const th = (j / 24) * Math.PI;
        for (let i = 0; i < 48; i++) {
          const ph = (i / 48) * Math.PI * 2;
          pts.push(cx + ax * Math.sin(th) * Math.cos(ph), cy + ay * Math.cos(th), cz - az * Math.sin(th) * Math.sin(ph));
        }
      }
    }
    const n = pts.length / 3;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    let top = -Infinity, bottom = Infinity;
    for (let i = 0; i < n; i++) {
      this.px[i] = pts[i * 3]!;
      this.py[i] = pts[i * 3 + 1]!;
      this.pz[i] = pts[i * 3 + 2]!;
      top = Math.max(top, pts[i * 3 + 1]!);
      bottom = Math.min(bottom, pts[i * 3 + 1]!);
    }
    this.cx = fallback.centre[0];
    this.cz = fallback.centre[2];
    this.top = top;
    this.bottom = bottom;
  }

  /** 方位 ang 上、高 y 附近（±dy）表面离中轴的最大水平距离（找不到就放宽）。 */
  radius(y: number, ang: number, dy = 0.006, dAng = 0.14): number {
    for (let k = 0; k < 4; k++) {
      let best = -1;
      const ca = Math.cos(ang), sa = -Math.sin(ang);
      const cosLim = Math.cos(dAng * (1 + k));
      for (let i = 0; i < this.px.length; i++) {
        if (Math.abs(this.py[i]! - y) > dy * (1 + k)) continue;
        const x = this.px[i]! - this.cx, z = this.pz[i]! - this.cz;
        const r = Math.hypot(x, z);
        if (r < 1e-6) continue;
        if ((x * ca + z * sa) / r < cosLim) continue;
        // 投影到这条方位线上的距离（偏开一点的点不算得太远）
        best = Math.max(best, x * ca + z * sa);
      }
      if (best > 0) return best;
    }
    return 0;
  }

  /** 一圈贴着头表面（再往外 pad）的点：count 个，顶点 0 在 +x、往 −z 走（与 loftRings 同约定）。 */
  ring(y: number, count: number, pad: number, o?: { tiltZ?: number; smooth?: number }): Float32Array {
    const out = new Float32Array(count * 3);
    const rs: number[] = [];
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const zz = -Math.sin(ang);
      // 前后倾斜：前面（z < 0）的圈低 tiltZ·|z|，后面高
      const yy = y + (o?.tiltZ ?? 0) * zz;
      rs.push(this.radius(yy, ang));
    }
    // 圈上平滑（去掉耳朵、鼻子之类的尖峰）
    const sm = o?.smooth ?? 2;
    const r2 = rs.map((_, i) => {
      let s = 0, w = 0;
      for (let k = -sm; k <= sm; k++) {
        const ww = 1 / (1 + Math.abs(k));
        s += rs[(i + k + count) % count]! * ww;
        w += ww;
      }
      return Math.max(rs[i]! * 0.97, s / w);
    });
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const zz = -Math.sin(ang);
      const r = r2[i]! + pad;
      out[i * 3] = this.cx + Math.cos(ang) * r;
      out[i * 3 + 1] = y + (o?.tiltZ ?? 0) * zz;
      out[i * 3 + 2] = this.cz + zz * r;
    }
    return out;
  }

  /** (x, y) 附近（半径 rr）最靠前的表面 z（越负越靠前）。 */
  front(x: number, y: number, rr = 0.006): number {
    for (let k = 0; k < 4; k++) {
      let best = Infinity;
      const lim = rr * (1 + k);
      for (let i = 0; i < this.px.length; i++) {
        if (Math.abs(this.px[i]! - x) > lim || Math.abs(this.py[i]! - y) > lim) continue;
        best = Math.min(best, this.pz[i]!);
      }
      if (best < Infinity) return best;
    }
    return this.cz - 0.1;
  }

  /** 侧面（|x| 最大）在 (y, z) 附近的 x（side = ±1）。 */
  side(sx: number, y: number, z: number, rr = 0.008): number {
    for (let k = 0; k < 4; k++) {
      let best = 0;
      const lim = rr * (1 + k);
      for (let i = 0; i < this.px.length; i++) {
        if (Math.abs(this.py[i]! - y) > lim || Math.abs(this.pz[i]! - z) > lim) continue;
        const x = this.px[i]! * sx;
        if (x > best) best = x;
      }
      if (best > 0) return best * sx;
    }
    return sx * 0.08;
  }
}
