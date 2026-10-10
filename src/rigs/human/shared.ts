// owner: WP2
// char2 WP0（冻结）：人身各区域共用的几何工具——几何缓存、Lathe 翻 V、圆角方截面放样（squircleLoft/loftPoint），
// 以及旧版（legacy）构建器共用的肢体段。见 test-artifacts/work/char2/PLAN.md §2.2。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- 几何缓存

const geoCache = new Map<string, THREE.BufferGeometry>();
const cachedGeos = new WeakSet<THREE.BufferGeometry>();

/**
 * 按 key 缓存的几何（全局共享、永不释放）：只用于有界的 key 集合（命名角色的固定尺寸）。
 * 身高随机的人（邻居、小孩）要么把身高量化到 0.02m 再进 key，要么用 ctx.track() 每人一份、随人偶释放。
 */
export function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
    cachedGeos.add(g);
  }
  return g;
}

/** 这份几何是 cached() 的共享几何（dispose 时跳过）。 */
export function isCachedGeometry(g: THREE.BufferGeometry): boolean {
  return cachedGeos.has(g);
}

/** 缓存 key 用的毫米整数。 */
export const q = (v: number): number => Math.round(v * 1000);

/** Lathe 轮廓自下而上生成后 v 也是自下而上；翻回“v = 0 在顶上”，贴图方向与原来（自上而下的轮廓）一致。 */
export function flipLatheV(g: THREE.BufferGeometry): void {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  uv.needsUpdate = true;
}

// ---------------------------------------------------------------- 圆角方截面放样

/** 放样的一圈：高 y、半宽 a、半深 b；front = 前胸额外鼓出（×b）；drop = 这一圈两侧往下塌（肩线）。 */
export interface LoftRow { y: number; a: number; b: number; front?: number; drop?: number }

/**
 * 圆角方截面（超椭圆，n=3）放样：躯干、骨盆、腰带用。UV：u=0 在 +x（右侧），经前胸（u=0.25）到 -x（u=0.5），
 * 再经后背（u=0.75）回到 +x；v 从下往上。所以衣服贴图左半是前胸、右半是后背（从正面看从左到右读）。
 * capTop：顶上封口（肩膀收到领口圈再封到中心），capBottom：底下封口；封口 UV 落在贴图右下角的纯色区。
 */
export function squircleLoft(rows: readonly LoftRow[], seg = 24, o?: { capTop?: { y: number; a: number; b: number }; capBottom?: boolean }): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const sq = (c: number) => Math.sign(c) * Math.pow(Math.abs(c), 2 / 3);
  const ring = (r: LoftRow, v: number | null) => {
    const base = pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      const cx = sq(Math.cos(t)), cz = -sq(Math.sin(t));
      let z = cz * r.b;
      if (cz < 0 && r.front) z *= 1 + r.front * Math.pow(-cz, 2) * Math.pow(Math.max(0, 1 - Math.abs(cx)), 0.5);
      pos.push(cx * r.a, r.y - (r.drop ?? 0) * cx * cx, z);
      if (v === null) uv.push(0.9 + 0.06 * (0.5 + cx * 0.5), 0.45 + 0.1 * (0.5 + cz * 0.5));
      else uv.push(i / seg, v);
    }
    return base;
  };
  const strip = (b0: number, b1: number) => {
    for (let i = 0; i < seg; i++) {
      const a = b0 + i, b = a + 1, c = b1 + i, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  };
  /** up=true：朝上的封口（顶）；false：朝下（底）。 */
  const fan = (b0: number, center: [number, number, number], up: boolean) => {
    const c = pos.length / 3;
    pos.push(center[0], center[1], center[2]);
    uv.push(0.93, 0.5);
    for (let i = 0; i < seg; i++) {
      if (up) idx.push(b0 + i, b0 + i + 1, c);
      else idx.push(b0 + i + 1, b0 + i, c);
    }
  };
  let prev = -1;
  rows.forEach((r, k) => {
    const b = ring(r, k / Math.max(1, rows.length - 1));
    if (prev >= 0) strip(prev, b);
    prev = b;
  });
  const last = rows[rows.length - 1];
  if (o?.capTop && last) {
    const b0 = ring(last, null);
    const neck: LoftRow = { y: o.capTop.y, a: o.capTop.a, b: o.capTop.b };
    const b1 = ring(neck, null);
    strip(b0, b1);
    fan(b1, [0, o.capTop.y, 0], true);
  }
  const first = rows[0];
  if (o?.capBottom && first) fan(ring(first, null), [0, first.y, 0], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 肩部 UV 单独取纯色区，但法线必须跨 UV 接缝连续，否则领口下方会出现一道硬亮台阶。
  if (o?.capTop) {
    const n = g.attributes.normal as THREE.BufferAttribute;
    const lower = (rows.length - 1) * (seg + 1), upper = rows.length * (seg + 1);
    for (let i = 0; i <= seg; i++) {
      const a = lower + i, b = upper + i;
      const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
      const k = 1 / Math.max(1e-8, Math.hypot(x, y, z));
      n.setXYZ(a, x * k, y * k, z * k);
      n.setXYZ(b, x * k, y * k, z * k);
    }
  }
  return g;
}

/** 放样圈上 u（0..1，同 squircleLoft 的 UV：0 = +x、0.25 = 前胸正中）处的点（圈按 y 线性插值）。 */
export function loftPoint(rows: readonly LoftRow[], u: number, y: number, out: THREE.Vector3): THREE.Vector3 {
  let i = 0;
  while (i < rows.length - 2 && y > rows[i + 1]!.y) i++;
  const r0 = rows[i]!, r1 = rows[i + 1]!;
  const k = Math.min(1, Math.max(0, (y - r0.y) / Math.max(1e-6, r1.y - r0.y)));
  const a = r0.a + (r1.a - r0.a) * k, b = r0.b + (r1.b - r0.b) * k;
  const front = (r0.front ?? 0) + ((r1.front ?? 0) - (r0.front ?? 0)) * k;
  const drop = (r0.drop ?? 0) + ((r1.drop ?? 0) - (r0.drop ?? 0)) * k;
  const sq = (c: number) => Math.sign(c) * Math.pow(Math.abs(c), 2 / 3);
  const t = u * Math.PI * 2;
  const cx = sq(Math.cos(t)), cz = -sq(Math.sin(t));
  let z = cz * b;
  if (cz < 0 && front) z *= 1 + front * Math.pow(-cz, 2) * Math.pow(Math.max(0, 1 - Math.abs(cx)), 0.5);
  return out.set(cx * a, y - drop * cx * cx, z);
}

// ---------------------------------------------------------------- 旧版构建器共用的肢体段（legacy）

/** 从关节往下长的肢体段（顶端在原点，沿 -y 长 len）。 */
export function limbGeo(rTop: number, rBot: number, len: number, seg = 10): THREE.BufferGeometry {
  return cached(`limb:${q(rTop)}:${q(rBot)}:${q(len)}:${seg}`, () => {
    const g = new THREE.CylinderGeometry(rTop, rBot, len, seg, 1, false);
    g.translate(0, -len / 2, 0);
    return g;
  });
}

/** 按衣着/肌肉轮廓放样，圆肩伸入上级关节，肘膝在弯曲时也不会变成外露的球铰。 */
export function contouredLimb(s: number, kind: 'upper' | 'forearm' | 'thigh' | 'shin', width = 1, cloth = true): THREE.BufferGeometry {
  return cached(`contour:${kind}:${q(s)}:${q(width)}:${cloth}`, () => {
    // [高度, 半径] 自下而上；零半径只用于藏在相邻部件内的端点。
    const profiles = {
      upper: [[-0.315, 0.025], [-0.285, 0.043], [-0.22, 0.05], [-0.13, 0.062], [-0.025, 0.07], [0.025, 0.055], [0.057, 0]],
      forearm: [[-0.27, 0.032], [-0.24, 0.034], [-0.18, 0.039], [-0.1, 0.05], [-0.03, 0.049], [0.018, 0.041], [0.047, 0]],
      thigh: [[-0.475, 0.039], [-0.44, 0.061], [-0.38, 0.066], [-0.22, 0.083], [-0.04, 0.095], [0.035, 0.065], [0.07, 0]],
      shin: [[-0.445, 0.046], [-0.40, 0.049], [-0.30, 0.053], [-0.19, 0.064], [-0.08, 0.066], [0, 0.06], [0.04, 0.046], [0.07, 0]],
    } as const;
    const curve = new THREE.SplineCurve(profiles[kind].map(([y, r]) => new THREE.Vector2(r * s * width, y * s)));
    const g = new THREE.LatheGeometry(curve.getPoints(20), 16);
    const p = g.attributes.position as THREE.BufferAttribute;
    const len = kind === 'upper' ? 0.315 : kind === 'forearm' ? 0.27 : 0.445;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / s, t = Math.max(0, Math.min(1, -y / len));
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const fold = cloth ? 1 + 0.035 * Math.sin(a * 5 + t * 3) * Math.pow(Math.sin(t * Math.PI), 2) : 1;
      p.setX(i, p.getX(i) * fold);
      p.setZ(i, p.getZ(i) * fold * (kind === 'thigh' ? 1.05 : 0.9));
    }
    flipLatheV(g);
    g.computeVertexNormals();
    return g;
  });
}

// ================================================================ char2 WP0：蒙皮、放样、焊接（冻结；区域构建器共用）

/** smoothstep（0..1，边界外夹住）。 */
export function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 带符号的幂（超椭圆）：sign(c)·|c|^e。 */
export const sgnPow = (c: number, e: number): number => Math.sign(c) * Math.pow(Math.abs(c), e);

/**
 * 一圈点（count 个，不重复首点）：centre + ex·a·C(t) + ez·(−b·S(t))，t = 2πi/count + phase，
 * C/S = 超椭圆（exp = 2 是椭圆，3 是 squircleLoft 的圆角方）。顶点 0 在 +ex 方向，然后往 −ez 走——
 * ex = +x、ez = +z 时与接缝、squircleLoft 同一约定（0 右侧、count/4 正前、count/2 左侧、3count/4 后背）。
 * front：前半边（−ez 那侧）按 LoftRow.front 的方式鼓出。
 */
export function planeRing(
  centre: readonly [number, number, number], ex: THREE.Vector3, ez: THREE.Vector3, a: number, b: number, count: number,
  o?: { exp?: number; front?: number; phase?: number },
): Float32Array {
  const e = 2 / (o?.exp ?? 2);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2 + (o?.phase ?? 0);
    const cx = sgnPow(Math.cos(t), e), cz = -sgnPow(Math.sin(t), e);
    let z = cz * b;
    if (cz < 0 && o?.front) z *= 1 + o.front * Math.pow(-cz, 2) * Math.pow(Math.max(0, 1 - Math.abs(cx)), 0.5);
    const x = cx * a;
    out[i * 3] = centre[0] + ex.x * x + ez.x * z;
    out[i * 3 + 1] = centre[1] + ex.y * x + ez.y * z;
    out[i * 3 + 2] = centre[2] + ex.z * x + ez.z * z;
  }
  return out;
}

const EX = new THREE.Vector3(1, 0, 0), EZ = new THREE.Vector3(0, 0, 1);
/** 水平圈（xz 平面，高 y）：superRing(…, exp 3) 就是 squircleLoft 的一圈；ellipseRing = exp 2。 */
export function superRing(centre: readonly [number, number, number], a: number, b: number, count: number, exp = 3, front = 0): Float32Array {
  return planeRing(centre, EX, EZ, a, b, count, { exp, front });
}
export function ellipseRing(centre: readonly [number, number, number], a: number, b: number, count: number, front = 0): Float32Array {
  return planeRing(centre, EX, EZ, a, b, count, { exp: 2, front });
}

/**
 * 把若干圈（每圈 count 个点、同一顶点约定）连成管面：索引几何，position + normal + uv。
 * 每圈复制首点到末尾（UV 接缝，u = 1），法线跨接缝取平均（不出硬边）。法线朝外：按圈的绕向自动定（orient 'auto'），
 * 也可以强制 'keep'/'flip'。v：每圈一个（缺省 j/(圈数−1)）；u(i) 缺省 i/count。capStart/capEnd：在首/末圈加扇形封口（给中心点）。
 * 返回的几何里第 j 圈的第 i 个点下标 = j·(count+1) + i（i = count 是复制的首点），封口中心点在所有圈之后。
 */
export function loftRings(
  rings: readonly ArrayLike<number>[],
  o?: {
    v?: readonly number[]; u?: (i: number, count: number) => number; orient?: 'auto' | 'keep' | 'flip';
    capStart?: readonly [number, number, number]; capEnd?: readonly [number, number, number];
  },
): THREE.BufferGeometry {
  const rows = rings.length;
  const count = (rings[0]?.length ?? 0) / 3;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j < rows; j++) {
    const r = rings[j]!;
    if (r.length !== count * 3) throw new Error(`loftRings: ring ${j} has ${r.length / 3} points, expected ${count}`);
    const v = o?.v?.[j] ?? j / Math.max(1, rows - 1);
    for (let i = 0; i <= count; i++) {
      const k = i % count;
      pos.push(r[k * 3]!, r[k * 3 + 1]!, r[k * 3 + 2]!);
      uv.push(o?.u ? o.u(i, count) : i / count, v);
    }
  }
  const W = count + 1;
  for (let j = 0; j + 1 < rows; j++) {
    for (let i = 0; i < count; i++) {
      const a = j * W + i, b = a + 1, c = (j + 1) * W + i, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const fan = (row: number, centre: readonly [number, number, number], start: boolean) => {
    const c = pos.length / 3;
    pos.push(centre[0], centre[1], centre[2]);
    uv.push(0.5, start ? 0 : 1);
    for (let i = 0; i < count; i++) {
      const a = row * W + i, b = a + 1;
      if (start) idx.push(b, a, c);
      else idx.push(a, b, c);
    }
  };
  if (o?.capStart) fan(0, o.capStart, true);
  if (o?.capEnd) fan(rows - 1, o.capEnd, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  let orient = o?.orient ?? 'auto';
  if (orient === 'auto') {
    // 每圈中心到点的方向 · 法线：多数朝里就翻
    g.computeVertexNormals();
    const n = g.attributes.normal as THREE.BufferAttribute;
    let score = 0;
    for (let j = 0; j < rows; j++) {
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < count; i++) { cx += pos[(j * W + i) * 3]!; cy += pos[(j * W + i) * 3 + 1]!; cz += pos[(j * W + i) * 3 + 2]!; }
      cx /= count; cy /= count; cz /= count;
      for (let i = 0; i < count; i++) {
        const k = j * W + i;
        score += (pos[k * 3]! - cx) * n.getX(k) + (pos[k * 3 + 1]! - cy) * n.getY(k) + (pos[k * 3 + 2]! - cz) * n.getZ(k);
      }
    }
    orient = score < 0 ? 'flip' : 'keep';
  }
  if (orient === 'flip') {
    for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]!; idx[t + 1] = idx[t + 2]!; idx[t + 2] = x; }
    g.setIndex(idx);
  }
  g.computeVertexNormals();
  smoothSeamColumns(g, rows, count);
  return g;
}

/** loftRings 布局（每行 count+1 个点、末列复制首列）的几何：把首末两列的法线取平均（UV 接缝不出硬边）。 */
export function smoothSeamColumns(g: THREE.BufferGeometry, rows: number, count: number): void {
  const n = g.attributes.normal as THREE.BufferAttribute;
  const W = count + 1;
  for (let j = 0; j < rows; j++) {
    const a = j * W, b = j * W + count;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const k = 1 / Math.max(1e-8, Math.hypot(x, y, z));
    n.setXYZ(a, x * k, y * k, z * k);
    n.setXYZ(b, x * k, y * k, z * k);
  }
  n.needsUpdate = true;
}

/** 一个顶点的蒙皮：至多 4 个 [BONES 下标, 权重]（权重会被归一化）。 */
export type SkinW = readonly (readonly [number, number])[];

/**
 * 写 skinIndex（Uint16 ×4）与 skinWeight（Float32 ×4）：fn(位置（绑定姿势、根空间）, 顶点下标) → 至多 4 个 [骨下标, 权重]。
 * 多于 4 个取最大的 4 个；权重归一化（全 0 时报错）。骨下标用 boneIndex('elbowR') 之类取。
 */
export function setSkin(geo: THREE.BufferGeometry, fn: (p: THREE.Vector3, i: number) => SkinW): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    const list = [...fn(p, i)].filter(([, w]) => w > 1e-6).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = list.reduce((acc, [, w]) => acc + w, 0);
    if (!(sum > 0)) throw new Error(`setSkin: vertex ${i} has no weight`);
    list.forEach(([b, w], k) => { si[i * 4 + k] = b; sw[i * 4 + k] = w / sum; });
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return geo;
}

/** 整个几何 100% 跟一根骨头（bone = BONES 下标）。 */
export function rigidSkin(geo: THREE.BufferGeometry, bone: number): THREE.BufferGeometry {
  return setSkin(geo, () => [[bone, 1]]);
}

/** 两根骨头之间的线性混合：t = 0 全 a，1 全 b（常和 smooth01 一起用）。 */
export function blend2(a: number, b: number, t: number): SkinW {
  return [[a, 1 - t], [b, t]];
}

/**
 * 把几何里一圈顶点（first … first+count−1，dupSeam 时再加复制的首点 first+count）精确贴到接缝圈上：
 * 位置 = ring.pos − origin，法线 = ring.nor，skin = true 时蒙皮 = ring.skin（缺 skin 属性就跳过）。
 * 构建器先照常放样、computeVertexNormals，最后对接缝那一行调用它，两边就一点不差。
 */
export function snapRing(
  geo: THREE.BufferGeometry, first: number,
  ring: { count: number; pos: ArrayLike<number>; nor: ArrayLike<number>; skin?: { bones: readonly number[]; weights: readonly number[] } },
  o?: { origin?: readonly [number, number, number]; dupSeam?: boolean; skin?: boolean },
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute, nor = geo.attributes.normal as THREE.BufferAttribute | undefined;
  const si = geo.attributes.skinIndex as THREE.BufferAttribute | undefined, sw = geo.attributes.skinWeight as THREE.BufferAttribute | undefined;
  const org = o?.origin ?? [0, 0, 0];
  const n = ring.count + (o?.dupSeam ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const i = k % ring.count, v = first + k;
    pos.setXYZ(v, ring.pos[i * 3]! - org[0], ring.pos[i * 3 + 1]! - org[1], ring.pos[i * 3 + 2]! - org[2]);
    nor?.setXYZ(v, ring.nor[i * 3]!, ring.nor[i * 3 + 1]!, ring.nor[i * 3 + 2]!);
    if (o?.skin !== false && ring.skin && si && sw) {
      for (let c = 0; c < 4; c++) {
        si.setComponent(v, c, ring.skin.bones[c] ?? 0);
        sw.setComponent(v, c, ring.skin.weights[c] ?? 0);
      }
    }
  }
  pos.needsUpdate = true;
  if (nor) nor.needsUpdate = true;
  if (si) si.needsUpdate = true;
  if (sw) sw.needsUpdate = true;
}

/**
 * 接缝圈的法线（PLAN §2.4 的 ringNormals）：接缝自带精确法线（SEAMS 算好），这里复制一份给构建器写进自己的几何
 * （头的下沿、脖子的上沿两边用同一组数，缝就不会有明暗台阶）。origin 不影响法线。
 */
export function ringNormals(ring: { nor: ArrayLike<number> }): Float32Array {
  return Float32Array.from(ring.nor);
}

/** 结果：每个接缝点到几何最近顶点的距离与法线点积。 */
export interface RingMatch { ok: boolean; maxErr: number; minDot: number; worst: number; notes: string }

/**
 * 区域 WP 自测用：几何里是否有一圈顶点与接缝重合（位置误差 ≤ tolPos，缺省 0.1mm；法线点积 > minDot，缺省 0.999）。
 * origin：几何所在空间的原点在人偶根空间（绑定姿势）里的位置——蒙皮部件是 [0,0,0]；头是 headSlot 的 bind 位置加上头网格自己的 position。
 */
export function checkRingMatch(
  geo: THREE.BufferGeometry, ring: { count: number; pos: ArrayLike<number>; nor: ArrayLike<number> },
  o?: { origin?: readonly [number, number, number]; tolPos?: number; minDot?: number; normals?: boolean },
): RingMatch {
  const pos = geo.attributes.position as THREE.BufferAttribute, nor = geo.attributes.normal as THREE.BufferAttribute | undefined;
  const org = o?.origin ?? [0, 0, 0];
  const tol = o?.tolPos ?? 1e-4, minDotReq = o?.minDot ?? 0.999;
  let maxErr = 0, minDot = 1, worst = -1;
  for (let i = 0; i < ring.count; i++) {
    const x = ring.pos[i * 3]! - org[0], y = ring.pos[i * 3 + 1]! - org[1], z = ring.pos[i * 3 + 2]! - org[2];
    let best = Infinity, bi = -1;
    for (let v = 0; v < pos.count; v++) {
      const d = (pos.getX(v) - x) ** 2 + (pos.getY(v) - y) ** 2 + (pos.getZ(v) - z) ** 2;
      if (d < best) { best = d; bi = v; }
    }
    const err = Math.sqrt(best);
    if (err > maxErr) { maxErr = err; worst = i; }
    if (nor && o?.normals !== false && bi >= 0) {
      // 同一位置可能有几个顶点（UV 接缝）：取与接缝法线最接近的那个
      let dot = -1;
      for (let v = 0; v < pos.count; v++) {
        if ((pos.getX(v) - x) ** 2 + (pos.getY(v) - y) ** 2 + (pos.getZ(v) - z) ** 2 > (tol * 2) ** 2) continue;
        dot = Math.max(dot, nor.getX(v) * ring.nor[i * 3]! + nor.getY(v) * ring.nor[i * 3 + 1]! + nor.getZ(v) * ring.nor[i * 3 + 2]!);
      }
      if (dot < minDot) minDot = dot;
    }
  }
  const ok = maxErr <= tol && minDot > minDotReq;
  return { ok, maxErr, minDot, worst, notes: `maxErr ${(maxErr * 1000).toFixed(3)}mm (vertex ${worst}), minDot ${minDot.toFixed(5)}` };
}

/**
 * 按位置焊接法线（PLAN §2.3）：所有给定几何里位置相距 ≤ tol（缺省 0.2mm）的顶点，法线取平均——但只和自己原法线夹角 < 60°（dot > minDot）
 * 的那些平均，所以有意做的硬边（鞋底边、褶）不会被抹平。几何是蒙皮部件的绑定姿势（同一空间）。改的是传入几何本身的 normal。
 */
export function weldNormals(geos: readonly THREE.BufferGeometry[], o?: { tol?: number; minDot?: number }): number {
  const tol = o?.tol ?? 2e-4, minDot = o?.minDot ?? 0.5;
  const items: { g: number; i: number; x: number; y: number; z: number; nx: number; ny: number; nz: number }[] = [];
  geos.forEach((g, gi) => {
    const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) items.push({ g: gi, i, x: p.getX(i), y: p.getY(i), z: p.getZ(i), nx: n.getX(i), ny: n.getY(i), nz: n.getZ(i) });
  });
  const cell = new Map<string, number[]>();
  const key = (a: number, b: number, c: number) => `${a},${b},${c}`;
  items.forEach((it, k) => {
    const kk = key(Math.floor(it.x / tol), Math.floor(it.y / tol), Math.floor(it.z / tol));
    let l = cell.get(kk);
    if (!l) cell.set(kk, (l = []));
    l.push(k);
  });
  let changed = 0;
  const tol2 = tol * tol;
  const out = new Float32Array(items.length * 3);
  items.forEach((it, k) => {
    const cx = Math.floor(it.x / tol), cy = Math.floor(it.y / tol), cz = Math.floor(it.z / tol);
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const l = cell.get(key(cx + dx, cy + dy, cz + dz));
      if (!l) continue;
      for (const m of l) {
        const o2 = items[m]!;
        if ((o2.x - it.x) ** 2 + (o2.y - it.y) ** 2 + (o2.z - it.z) ** 2 > tol2) continue;
        if (o2.nx * it.nx + o2.ny * it.ny + o2.nz * it.nz <= minDot) continue;
        sx += o2.nx; sy += o2.ny; sz += o2.nz; cnt++;
      }
    }
    const l = Math.hypot(sx, sy, sz) || 1;
    out[k * 3] = sx / l; out[k * 3 + 1] = sy / l; out[k * 3 + 2] = sz / l;
    if (cnt > 1) changed++;
  });
  items.forEach((it, k) => {
    const n = geos[it.g]!.attributes.normal as THREE.BufferAttribute;
    n.setXYZ(it.i, out[k * 3]!, out[k * 3 + 1]!, out[k * 3 + 2]!);
  });
  for (const g of geos) (g.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
  return changed;
}

/** 合并用：只留 position/normal/uv（+ skinIndex/skinWeight），统一数组类型，没有索引的补上顺序索引。返回新几何（不改原件）。 */
export function normalizeForMerge(g: THREE.BufferGeometry, skinned: boolean): THREE.BufferGeometry {
  const c = new THREE.BufferGeometry();
  const pos = g.attributes.position as THREE.BufferAttribute;
  c.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(pos.array as ArrayLike<number>), 3));
  if (!g.attributes.normal) {
    const tmp = g.clone();
    tmp.computeVertexNormals();
    c.setAttribute('normal', new THREE.Float32BufferAttribute(Float32Array.from(tmp.attributes.normal!.array as ArrayLike<number>), 3));
    tmp.dispose();
  } else c.setAttribute('normal', new THREE.Float32BufferAttribute(Float32Array.from(g.attributes.normal.array as ArrayLike<number>), 3));
  const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
  c.setAttribute('uv', new THREE.Float32BufferAttribute(uv ? Float32Array.from(uv.array as ArrayLike<number>) : new Float32Array(pos.count * 2), 2));
  if (skinned) {
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    if (!si || !sw) throw new Error('normalizeForMerge: skinned piece without skinIndex/skinWeight');
    c.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(si.array as ArrayLike<number>), 4));
    c.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Float32Array.from(sw.array as ArrayLike<number>), 4));
  }
  const idx = g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({ length: pos.count }, (_, i) => i);
  c.setIndex(idx);
  return c;
}

/** 合并几何（保留 uv 与蒙皮属性，PLAN §2.2 mergeKeepUv）：按顺序拼接，索引几何。 */
export function mergeKeepUv(geos: readonly THREE.BufferGeometry[], skinned = false): THREE.BufferGeometry {
  const list = geos.map(g => normalizeForMerge(g, skinned));
  const m = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  if (!m) throw new Error('mergeKeepUv: mergeGeometries failed');
  return m;
}

/**
 * 把一个 SkinnedMesh 当前姿势的形状烘成普通几何（网格局部空间；冷迹 residue.ts 合并用）。法线重算。
 * 调用前更新世界矩阵（root.updateWorldMatrix(true, true)）。
 */
export function bakeSkinned(mesh: THREE.SkinnedMesh): THREE.BufferGeometry {
  const src = mesh.geometry;
  const pos = src.attributes.position as THREE.BufferAttribute;
  const out = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, v);
    out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  if (src.attributes.uv) g.setAttribute('uv', (src.attributes.uv as THREE.BufferAttribute).clone());
  if (src.index) g.setIndex(src.index.clone());
  g.computeVertexNormals();
  return g;
}
