// owner: WP2
// char2 WP0（冻结）：人身各区域共用的几何工具——几何缓存、Lathe 翻 V、圆角方截面放样（squircleLoft/loftPoint），
// 以及旧版（legacy）构建器共用的肢体段。见 test-artifacts/work/char2/PLAN.md §2.2。

import * as THREE from 'three';

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
