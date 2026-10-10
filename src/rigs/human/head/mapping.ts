// owner: WP2
// char2 WP-H：人头的角度坐标与贴图展开（几何、脸部贴图、贴片 headShell 共用同一套映射，五官画在哪、长在哪就永远对得上）。
//
// 单位坐标 U：headSlot 局部 ÷ k（k = s × headScale），成年男人的数值（PLAN §2.5 地标就在这个空间里）。x 右（人物自己的右手）、y 上、-z 正前。
// 以 HEAD_C 为中心的角度：ψ = 方位角（0 正前、+π/2 人物左边 -x、-π/2 右边 +x、±π 后脑），α = 离“正下方”的极角（0 朝下、π 头顶）。
// 贴图：u = 0.5 + G(ψ)（正脸 ±60° 占 u 的 60%），v = V(α)（眼到嘴这一段占 v 的 42%）；画布 512×384，flipY：画布 y = (1 - v)·H。

/** 射线中心（单位坐标）：头里面、略高于鼻底，脸和后脑对它都是星形的。 */
export const HEAD_C = [0, 0.14, 0.005] as const;
/** 头网格在 headSlot 下的位置（单位坐标；地标 headOrigin）。 */
export const HEAD_ORIGIN = [0, 0.14, -0.005] as const;

export const DEG = Math.PI / 180;

/** 方位角 ψ（相对 HEAD_C 的竖轴）。 */
export function psiOf(x: number, z: number): number {
  return Math.atan2(-x, -(z - HEAD_C[2]));
}

/** 极角 α（0 朝下）。 */
export function alphaOf(x: number, y: number, z: number): number {
  return Math.atan2(Math.hypot(x, z - HEAD_C[2]), -(y - HEAD_C[1]));
}

/** 方向（单位向量）：ψ、α → (x, y, z)。 */
export function dirOf(psi: number, alpha: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const sa = Math.sin(alpha);
  out[0] = -Math.sin(psi) * sa;
  out[1] = -Math.cos(alpha);
  out[2] = -Math.cos(psi) * sa;
  return out;
}

// ---------------------------------------------------------------- u(ψ)

const FRONT = Math.PI / 3;
/** u = 0.5 + G(ψ)：|ψ| ≤ 60° 线性占 ±0.30，其余 240° 占两边各 0.20。 */
export function uOfPsi(psi: number): number {
  const a = Math.abs(psi);
  const g = a <= FRONT ? (0.3 * a) / FRONT : 0.3 + (0.2 * (a - FRONT)) / (Math.PI - FRONT);
  return 0.5 + Math.sign(psi) * g;
}

export function psiOfU(u: number): number {
  const g = u - 0.5;
  const a = Math.abs(g);
  const p = a <= 0.3 ? (a / 0.3) * FRONT : FRONT + ((a - 0.3) / 0.2) * (Math.PI - FRONT);
  return Math.sign(g) * p;
}

// ---------------------------------------------------------------- v(α)

/** v(α) 折线：下巴底 → 嘴（0.20）→ 眼（0.62）→ 眉 → 发际线 → 头顶（1）。 */
const V_KNOTS: readonly (readonly [number, number])[] = [
  [15 * DEG, 0], [45 * DEG, 0.1], [61 * DEG, 0.2], [99 * DEG, 0.62], [110 * DEG, 0.7], [130 * DEG, 0.8], [180 * DEG, 1],
];

export function vOfAlpha(alpha: number): number {
  const K = V_KNOTS;
  if (alpha <= K[0]![0]) return K[0]![1] + (alpha - K[0]![0]) * ((K[1]![1] - K[0]![1]) / (K[1]![0] - K[0]![0]));
  for (let i = 1; i < K.length; i++) {
    const [a1, v1] = K[i]!;
    if (alpha <= a1) {
      const [a0, v0] = K[i - 1]!;
      return v0 + ((alpha - a0) / (a1 - a0)) * (v1 - v0);
    }
  }
  return 1;
}

export function alphaOfV(v: number): number {
  const K = V_KNOTS;
  if (v <= K[0]![1]) return K[0]![0];
  for (let i = 1; i < K.length; i++) {
    const [a1, v1] = K[i]!;
    if (v <= v1) {
      const [a0, v0] = K[i - 1]!;
      return a0 + ((v - v0) / (v1 - v0)) * (a1 - a0);
    }
  }
  return Math.PI;
}

/** 单位坐标里的一点 → 贴图 (u, v)。 */
export function uvOfPoint(x: number, y: number, z: number): [number, number] {
  return [uOfPsi(psiOf(x, z)), vOfAlpha(alphaOf(x, y, z))];
}

/** 耳朵的贴图小岛（画布左下、右下角那两块头上用不到的地方）：右耳（+x）在 u 0..0.14，左耳在 0.86..1；v 0..0.075。 */
export const EAR_ISLAND = { u0R: 0.005, u0L: 0.865, w: 0.13, v0: 0.004, h: 0.068 } as const;

// ---------------------------------------------------------------- 小工具

/** smoothstep（夹住）。 */
export function sstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 二维高斯包。 */
export function g2(dx: number, dy: number, sx: number, sy: number): number {
  return Math.exp(-((dx / sx) ** 2 + (dy / sy) ** 2));
}

/** 平滑最大值（k = 过渡宽度）。 */
export function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
}

/**
 * 单调三次插值（Fritsch–Carlson）：knots = [[x, y], …]（x 递增）。不过冲，适合轮廓表。
 * 返回 f(x)；x 在两端以外取端值。
 */
export function monotone(knots: readonly (readonly [number, number])[]): (x: number) => number {
  const n = knots.length;
  const xs = knots.map(k => k[0]), ys = knots.map(k => k[1]);
  const d: number[] = [], m: number[] = new Array<number>(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!));
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i]! / d[i]!, b = m[i + 1]! / d[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i]!;
      m[i + 1] = t * b * d[i]!;
    }
  }
  return (x: number) => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!, t = (x - xs[i]!) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h * m[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h * m[i + 1]!;
  };
}

/** 折线（线性插值），x 递增。 */
export function polyline(knots: readonly (readonly [number, number])[]): (x: number) => number {
  return (x: number) => {
    if (x <= knots[0]![0]) return knots[0]![1];
    for (let i = 1; i < knots.length; i++) {
      const [x1, y1] = knots[i]!;
      if (x <= x1) {
        const [x0, y0] = knots[i - 1]!;
        return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
      }
    }
    return knots[knots.length - 1]![1];
  };
}
