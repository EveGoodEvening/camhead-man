// owner: WP2
// char2 WP-H：雕出来的人头（PLAN §3.1）。一张连续的网格：颈口（NECK_TOP 接缝）→ 下颌底面 → 脸、鼻、唇、眼窝 → 发际线 → 头顶。
//
// 做法：以 HEAD_C 为中心的经纬网格（列 = 方位 ψ，前脸密；行 = 极角 α，眼–嘴一带密）。每个网格方向上沿射线求“基础头形”
// （按高度 y 的水平超椭圆截面：半宽 W(y)、前深 F(y)、后深 B(y)）的表面点，再沿法线加上五官的解析起伏（眉弓、眼窝、上下眼睑、颧骨、
// 鼻子、上下唇、人中、下巴、法令纹……）和头发厚度场（头发就是外壳，下面没有头皮）。最底下一圈正好是 NECK_TOP，往上两圈是平的下颌底面，
// 再往上一圈是下颌线。耳朵（耳轮、耳舟、对耳轮、耳甲、耳屏、耳垂）和发髻是贴着表面放样的小块，按索引排在头壳前面（魂影先画它们）。
// 全部是纯几何（不碰 DOM），Node 里也能建（自测、预览）。

import * as THREE from 'three';
import type { SculptKey } from '../types';
import { DEG, EAR_ISLAND, HEAD_C, HEAD_ORIGIN, alphaOf, dirOf, g2, monotone, polyline, psiOf, smax, sstep, uOfPsi, uvOfPoint, vOfAlpha } from './mapping';
import { type HairDef, type HeadParams, hairCover, hairDef, hairThickness } from './params';

type V3 = [number, number, number];

// ================================================================ 基础头形（截面表）

/** 成年男人的截面表（单位坐标）：y → 半宽 W、前深 F、后深 B；n 是前半边超椭圆指数。 */
const W_KNOTS: readonly (readonly [number, number])[] = [
  [0.035, 0.022], [0.045, 0.037], [0.06, 0.0525], [0.075, 0.0592], [0.09, 0.0615], [0.105, 0.065], [0.12, 0.0685], [0.135, 0.0705],
  [0.15, 0.0718], [0.165, 0.0733], [0.18, 0.0741], [0.195, 0.0731], [0.21, 0.0694], [0.225, 0.061], [0.238, 0.047], [0.247, 0.029], [0.252, 0],
];
const F_KNOTS: readonly (readonly [number, number])[] = [
  [0.035, 0.079], [0.045, 0.0888], [0.06, 0.0952], [0.075, 0.0985], [0.09, 0.1003], [0.105, 0.1012], [0.12, 0.1018], [0.135, 0.1021],
  [0.15, 0.1022], [0.165, 0.1012], [0.18, 0.0965], [0.195, 0.0895], [0.21, 0.0805], [0.225, 0.0685], [0.238, 0.0514], [0.247, 0.031], [0.252, 0],
];
const B_KNOTS: readonly (readonly [number, number])[] = [
  [0.035, 0.03], [0.06, 0.04], [0.075, 0.046], [0.085, 0.055], [0.095, 0.068], [0.105, 0.081], [0.12, 0.0935], [0.14, 0.0995],
  [0.165, 0.0982], [0.19, 0.0905], [0.21, 0.0805], [0.225, 0.067], [0.238, 0.049], [0.247, 0.029], [0.252, 0],
];
const NF_KNOTS: readonly (readonly [number, number])[] = [[0.035, 1.9], [0.06, 2.05], [0.09, 2.2], [0.12, 2.35], [0.15, 2.45], [0.18, 2.4], [0.21, 2.2], [0.252, 2.0]];
const sq = (k: readonly (readonly [number, number])[]) => k.map(([y, v]) => [y, v * v] as const);
const W2 = monotone(sq(W_KNOTS)), F2 = monotone(sq(F_KNOTS)), B2 = monotone(sq(B_KNOTS));
const NF = polyline(NF_KNOTS);
const Y_TOP = 0.252;

const bump = (y: number, c: number, w: number) => Math.exp(-(((y - c) / w) ** 2));

/** 头形：隐函数 f（< 0 在里面）、射线求表面、法线、五官起伏、头发厚度。全部在单位坐标里。 */
export interface HeadSurface {
  readonly p: HeadParams;
  readonly hair: HairDef;
  /** 基础头形的隐函数（超椭圆截面的“半径比 - 1”） */
  f(x: number, y: number, z: number): number;
  /** 沿 HEAD_C 出发的方向 d 求基础表面：位置与（梯度）法线 */
  base(d: Readonly<V3>, out: { P: V3; n: V3 }): void;
  /** 五官起伏（米，沿基础法线），不含头发 */
  features(P: Readonly<V3>, n: Readonly<V3>): number;
  /** 头发：覆盖 × 厚度（米） */
  hairAt(psi: number, alpha: number, P: Readonly<V3>, n: Readonly<V3>): number;
  /** 方向 (ψ, α) 上的最终表面（含五官、头发） */
  final(psi: number, alpha: number, out?: V3): V3;
}

export function headSurface(p: HeadParams): HeadSurface {
  const sc = p.sc;
  const S = (k: SculptKey) => sc[k];
  const fl = S('faceLen');
  const dLow = 0.005 * fl;
  const yBot = 0.035 - dLow;
  const child = p.child, deity = p.deity, female = p.female;
  const sec = (y: number): { W: number; F: number; B: number; nF: number } => {
    // 脸长：下半张脸往下拉（下巴低 dLow），上半不动
    const ye = y + dLow * (1 - sstep(0.04, 0.13, y));
    let W = Math.sqrt(Math.max(0, W2(ye))), F = Math.sqrt(Math.max(0, F2(ye))), B = Math.sqrt(Math.max(0, B2(ye)));
    const wm = 1 + 0.07 * S('jawW') * bump(ye, 0.07, 0.028) + 0.04 * S('cheekFull') * bump(ye, 0.1, 0.025) + 0.025 * S('cheekbone') * bump(ye, 0.13, 0.014)
      - 0.15 * Math.max(0, S('chin')) * bump(ye, 0.045, 0.016) - 0.035 * fl * (1 - sstep(0.08, 0.13, ye))
      + (child ? 0.035 * sstep(0.15, 0.2, ye) + 0.03 * bump(ye, 0.085, 0.03) : 0) + (deity ? 0.05 : 0)
      + (female ? -0.035 * (1 - sstep(0.08, 0.14, ye)) : 0);
    W *= wm;
    F += 0.0042 * S('chin') * bump(ye, 0.05, 0.013) + (deity ? 0.007 * bump(ye, 0.205, 0.022) : 0) + (child ? 0.004 * bump(ye, 0.2, 0.025) : 0)
      + 0.003 * S('foreheadH') * bump(ye, 0.2, 0.02);
    B *= 1 + (child ? 0.04 * sstep(0.13, 0.2, ye) : 0) + (deity ? 0.03 : 0);
    return { W: Math.max(1e-5, W), F: Math.max(1e-5, F), B: Math.max(1e-5, B), nF: NF(ye) };
  };
  const f = (x: number, y: number, z: number): number => {
    if (y >= Y_TOP) return 1 + (y - Y_TOP) * 50;
    const s = sec(y);
    const front = z < 0;
    const n = front ? s.nF : 2.25;
    const D = front ? s.F : s.B;
    const rho = Math.pow(Math.pow(Math.abs(x / s.W), n) + Math.pow(Math.abs(z / D), n), 1 / n);
    return Math.max(rho - 1, (yBot - y) * 60);
  };
  const C = HEAD_C;
  const solve = (d: Readonly<V3>): number => {
    let lo = 0.004, hi = lo;
    while (hi < 0.35) {
      hi += 0.004;
      if (f(C[0] + d[0] * hi, C[1] + d[1] * hi, C[2] + d[2] * hi) > 0) break;
      lo = hi;
    }
    for (let i = 0; i < 26; i++) {
      const m = (lo + hi) / 2;
      if (f(C[0] + d[0] * m, C[1] + d[1] * m, C[2] + d[2] * m) > 0) hi = m;
      else lo = m;
    }
    return (lo + hi) / 2;
  };
  const grad = (P: Readonly<V3>, out: V3) => {
    const e = 2e-4;
    const gx = f(P[0] + e, P[1], P[2]) - f(P[0] - e, P[1], P[2]);
    const gy = f(P[0], P[1] + e, P[2]) - f(P[0], P[1] - e, P[2]);
    const gz = f(P[0], P[1], P[2] + e) - f(P[0], P[1], P[2] - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    out[0] = gx / l; out[1] = gy / l; out[2] = gz / l;
  };
  const base = (d: Readonly<V3>, out: { P: V3; n: V3 }) => {
    const r = solve(d);
    out.P[0] = C[0] + d[0] * r; out.P[1] = C[1] + d[1] * r; out.P[2] = C[2] + d[2] * r;
    grad(out.P, out.n);
  };

  // ------------------------------------------------ 五官
  const nl = S('noseLen'), nw = S('noseW'), nbr = S('noseBridge');
  const noseK = child ? 0.55 : female ? 0.84 : 1;
  const yr = 0.1615 - (child ? 0.004 : 0);
  const yt = (child ? 0.1195 : female ? 0.1162 : 0.114) - 0.005 * nl;
  const yb = (child ? 0.1115 : female ? 0.1068 : 0.1035) - 0.003 * nl;
  const Ht = 0.0228 * noseK * (1 + 0.1 * nl);
  const wt = 0.0118 * (1 + 0.18 * nw) * (child ? 0.86 : female ? 0.97 : 1);
  const Hroot = Math.max(0.0004, (child ? 0.0006 : 0.0022) + 0.0016 * nbr);
  const hump = p.preset === 'oldMan' ? 0.0018 * Math.max(0, nbr) : 0.0008 * Math.max(0, nbr);
  const alarX = 0.0135 * (1 + 0.2 * nw) * (child ? 0.8 : female ? 0.92 : 1);
  const alarH = 0.0085 * noseK;
  const nose = (x: number, y: number): number => {
    let h: number, w: number;
    if (y >= yt) {
      const t = Math.min(1, Math.max(0, (yr - y) / (yr - yt)));
      h = Hroot + (Ht - Hroot) * Math.pow(t, 1.25) + hump * Math.sin(Math.PI * t);
      if (y > yr) h *= Math.exp(-(((y - yr) / 0.005) ** 2));
      w = 0.0068 + (wt - 0.0068) * Math.pow(t, 1.6);
    } else {
      const q = (yt - y) / (yt - yb);
      h = Ht * Math.exp(-Math.pow(q, 1.8) * 2.0);
      w = wt;
    }
    const main = h * Math.exp(-Math.pow(Math.abs(x) / w, 3.2));
    const al = alarH * g2(Math.abs(x) - alarX, y - (yb + 0.0052), 0.0048, 0.0056);
    return smax(main, al, 0.003);
  };
  const browA = Math.max(0, (female || child ? 0.0018 : 0.0038) * (1 + 0.55 * S('browRidge')));
  const lipK = Math.max(0.25, 1 + 0.6 * S('lipFull'));
  const eyeK = 1 + 0.25 * S('eyeSize');
  const old = p.old && !deity;
  const nlDepth = p.old ? 0.0011 : child ? 0 : 0.0004;
  const features = (P: Readonly<V3>, n: Readonly<V3>): number => {
    const x = P[0], y = P[1], ax = Math.abs(x);
    const fr = sstep(0.15, 0.65, -n[2]);
    const frN = sstep(0.3, 0.8, -n[2]);
    const sf = sstep(-0.35, 0.3, -n[2]);
    let d = 0;
    d += browA * (g2(ax - 0.031, y - 0.1715, 0.024, 0.0075) + 0.55 * g2(x, y - 0.166, 0.011, 0.008)) * fr;
    d -= 0.0056 * eyeK * g2(ax - 0.033, y - 0.151, 0.0158, 0.0102) * fr;
    d += 0.0017 * g2(ax - 0.033, y - 0.1548, 0.012, 0.0036) * fr;
    d += 0.0009 * g2(ax - 0.034, y - 0.1438, 0.011, 0.0028) * fr;
    if (p.old) d += 0.0011 * g2(ax - 0.035, y - 0.1385, 0.012, 0.0035) * fr;
    d -= (0.0018 + (old ? 0.0012 : 0)) * g2(ax - 0.064, y - 0.168, 0.012, 0.016) * sf;
    d += Math.max(0, 0.002 * (1 + 0.6 * S('cheekbone'))) * g2(ax - 0.053, y - 0.128, 0.019, 0.018) * sf;
    d += 0.0032 * S('cheekFull') * g2(ax - 0.046, y - 0.098, 0.019, 0.017) * sf;
    if (old) d -= 0.0007 * g2(ax - 0.054, y - 0.104, 0.016, 0.016) * sf;
    d += 0.0022 * g2(x, y - 0.09, 0.034, 0.018) * fr;
    d += 0.0031 * lipK * g2(x, y - 0.0868, 0.0205, 0.0041) * fr - 0.0005 * g2(x, y - 0.0892, 0.004, 0.002) * fr;
    d += 0.0029 * lipK * g2(x, y - 0.0748, 0.0178, 0.0048) * fr;
    d -= 0.0018 * g2(x, y - 0.0808, 0.0245, 0.0017) * fr;
    d -= 0.0013 * g2(ax - 0.0265, y - 0.0805, 0.0045, 0.0045) * fr;
    d -= 0.0006 * g2(x, y - 0.0955, 0.0028, 0.0055) * fr;
    d += 0.0021 * Math.max(0.2, 1 + 0.5 * S('chin')) * g2(x, y - 0.053 + dLow, 0.0145, 0.0105) * fr;
    d -= 0.0012 * g2(x, y - 0.0655 + dLow * 0.5, 0.013, 0.0038) * fr;
    d += Math.max(0, 0.0016 * (1 + S('jawW'))) * g2(ax - 0.057, y - 0.072 + dLow, 0.012, 0.011) * sf;
    if (nlDepth > 0) {
      // 法令纹：鼻翼外侧 → 嘴角外侧的一道沟，外侧的脸颊鼓一点
      const ds = segDist(ax, y, 0.0195, 0.1085, 0.0315, 0.0735);
      const lateral = ax > 0.0195 + (0.1085 - y) * (0.012 / 0.035) ? 1 : 0.3;
      d -= nlDepth * Math.exp(-((ds / 0.0034) ** 2)) * fr;
      d += nlDepth * 0.7 * lateral * Math.exp(-(((ds - 0.006) / 0.0045) ** 2)) * fr;
    }
    d += nose(x, y) * frN;
    return d;
  };

  const hair = hairDef(p.hair, p.female);
  const hairAt = (psi: number, alpha: number, P: Readonly<V3>, n: Readonly<V3>): number => {
    const e = hairCover(hair, psi, alpha);
    if (e <= 0) return 0;
    const t = hairThickness(hair, psi, alpha, P[1], n[1]);
    // 碗盖头：边上就是满厚度（一圈齐边）；其他发型从发际线起慢慢长厚（边上一层薄薄的，往里 1.5cm 才到满厚度，不是一道台阶）
    if (hair.hardEdge) return t * e;
    const ap = Math.abs(psi);
    const lo = hair.line ? hair.line(ap) : 0;
    // 往后梳的发型（发髻、低髻）额前是贴着的：长厚得更慢
    let grow = 0.18 + 0.82 * sstep(lo - hair.ramp, lo + (hair.bun ? 18 : 9) * DEG, alpha);
    if (hair.top) grow *= 0.18 + 0.82 * (1 - sstep(hair.top(ap) - 9 * DEG, hair.top(ap) + hair.ramp, alpha));
    return t * e * grow;
  };
  const tmp = { P: [0, 0, 0] as V3, n: [0, 0, 0] as V3 };
  const dTmp: V3 = [0, 0, 0];
  const final = (psi: number, alpha: number, out: V3 = [0, 0, 0]): V3 => {
    dirOf(psi, alpha, dTmp);
    base(dTmp, tmp);
    const dd = features(tmp.P, tmp.n) + hairAt(psi, alpha, tmp.P, tmp.n);
    out[0] = tmp.P[0] + tmp.n[0] * dd; out[1] = tmp.P[1] + tmp.n[1] * dd; out[2] = tmp.P[2] + tmp.n[2] * dd;
    return out;
  };
  return { p, hair, f, base, features, hairAt, final };
}

/** 点到线段距离（二维）。 */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
}

// ================================================================ 网格

/** 下颌线（下颌底面与脸的交界）的极角，按 |ψ|：下巴、下颌角一路平，到耳下往上，后颈贴着颈口。 */
const ALPHA_J = polyline([[0, 43], [40, 43], [67, 43.5], [80, 49], [95, 57], [120, 52], [150, 47], [180, 46]].map(([a, b]) => [a! * DEG, b! * DEG] as const));
/** 正脸那一列的行（极角，度）：下颌线 → 嘴 → 鼻（2° 一行）→ 眼 → 额 → 头顶。别的列按自己的下颌线等比挪。 */
const KNOTS = [43, 48, 53, 57, 60, 63, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 87, 90, 93, 96, 99, 102, 105, 108, 112, 117, 123, 130, 139, 149, 160, 171].map(a => a * DEG);
/** 列数（不含 u = 1 的复制列）。 */
export const HEAD_COLS = 52;
const COL_A = 0.42;

/** 第 c 列的方位（c = 0 在后脑 -π，经右侧、正脸到左侧，c = HEAD_COLS 回到 +π）。 */
export function colPsi(c: number): number {
  const s = -1 + (2 * c) / HEAD_COLS;
  return Math.PI * (COL_A * s + (1 - COL_A) * s * s * s);
}

/** 接缝（headSlot 局部 ÷ k = 单位坐标）。 */
export interface SeamU { count: number; pos: Float32Array; nor: Float32Array }

/** 网格建出来的原始数组（单位坐标）+ 几个给自测/贴片用的下标。 */
export interface HeadMeshData {
  pos: number[]; nor: number[]; uv: number[]; idx: number[];
  /** 头壳网格第一个顶点的下标（耳朵、发髻在它前面） */
  gridStart: number;
  /** 颈口一圈（行 0）的顶点下标：seamVert[i] = 接缝第 i 点 */
  seamVert: number[];
  rows: number; cols: number;
}

/**
 * 建人头网格（单位坐标）。seam：NECK_TOP 接缝（单位坐标、headSlot 局部）。
 * 顺序：耳朵、发髻（先画）→ 头壳（行 0 = 颈口 … 最后一圈 → 头顶扇形）。
 */
export function buildHeadMesh(surf: HeadSurface, seam: SeamU): HeadMeshData {
  const out: HeadMeshData = { pos: [], nor: [], uv: [], idx: [], gridStart: 0, seamVert: [], rows: 0, cols: HEAD_COLS };
  if (surf.hair.line && surf.hair.bun) addBun(out, surf, surf.hair.bun);
  addEar(out, surf, 1);
  addEar(out, surf, -1);
  out.gridStart = out.pos.length / 3;
  addShell(out, surf, seam);
  return out;
}

export function addShell(out: HeadMeshData, surf: HeadSurface, seam: SeamU): void {
  const N = HEAD_COLS;
  const NC = N + 1;
  const C = HEAD_C;
  // ---- 颈口：每个接缝点分到离它方位最近的列，中间的列落在接缝折线（弦）上
  const sψ: number[] = [];
  for (let i = 0; i < seam.count; i++) sψ.push(psiOf(seam.pos[i * 3]!, seam.pos[i * 3 + 2]!));
  const colOf = (psi: number) => {
    let best = 0, bd = Infinity;
    for (let c = 0; c <= N; c++) {
      const d = Math.abs(colPsi(c) - psi);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };
  // 从后脑（方位最接近 ±π 的接缝点）开始，按 ψ 递增排
  let start = 0;
  for (let i = 0; i < seam.count; i++) if (Math.abs(sψ[i]!) > Math.abs(sψ[start]!)) start = i;
  const order: number[] = [];
  for (let k = 0; k < seam.count; k++) order.push((start + k) % seam.count);
  const anchors: { c: number; i: number }[] = order.map((i, k) => ({ c: k === 0 ? 0 : colOf(sψ[i]!), i }));
  anchors.push({ c: N, i: order[0]! });
  for (let k = 1; k < anchors.length; k++) {
    if (anchors[k]!.c <= anchors[k - 1]!.c) throw new Error(`head: neck seam vertex ${anchors[k]!.i} has no free column`);
  }
  const bottom: { P: V3; n: V3; seamIdx: number }[] = new Array(NC);
  for (let k = 0; k + 1 < anchors.length; k++) {
    const a = anchors[k]!, b = anchors[k + 1]!;
    for (let c = a.c; c <= b.c; c++) {
      const t = (c - a.c) / (b.c - a.c);
      const P: V3 = [0, 0, 0], n: V3 = [0, 0, 0];
      for (let j = 0; j < 3; j++) {
        P[j] = seam.pos[a.i * 3 + j]! * (1 - t) + seam.pos[b.i * 3 + j]! * t;
        n[j] = seam.nor[a.i * 3 + j]! * (1 - t) + seam.nor[b.i * 3 + j]! * t;
      }
      norm(n);
      bottom[c] = { P, n, seamIdx: t === 0 ? a.i : t === 1 ? b.i : -1 };
    }
  }
  // ---- 每一列的行
  const knotsOf = (psi: number): number[] => {
    const aJ = ALPHA_J(Math.abs(psi));
    const ks = KNOTS.map(a => aJ + ((a - KNOTS[0]!) * (KNOTS[KNOTS.length - 1]! - aJ)) / (KNOTS[KNOTS.length - 1]! - KNOTS[0]!));
    // 发际线处放两行把坡夹住（几何上一道干净、有厚度的发边）
    const h = surf.hair;
    if (h.line) {
      const ap = Math.abs(psi);
      const edges: number[] = [];
      if (h.minPsi === undefined || ap > h.minPsi - 6 * DEG) {
        edges.push(h.line(ap));
        if (h.top) edges.push(h.top(ap));
      }
      for (const e of edges) bracket(ks, e, h.ramp);
    }
    return ks;
  };
  const P0 = out.pos.length / 3;
  const rows = 3 + KNOTS.length;
  out.rows = rows;
  const d: V3 = [0, 0, 0];
  const tmp = { P: [0, 0, 0] as V3, n: [0, 0, 0] as V3 };
  const colPts: V3[][] = [];
  const colUv: [number, number][][] = [];
  for (let c = 0; c <= N; c++) {
    const psi = colPsi(c);
    const ks = knotsOf(psi);
    const pts: V3[] = [], uvs: [number, number][] = [];
    const u = c === 0 ? 0 : c === N ? 1 : uOfPsi(psi);
    for (const a of ks) {
      dirOf(psi, a, d);
      surf.base(d, tmp);
      const dd = surf.features(tmp.P, tmp.n) + surf.hairAt(psi, a, tmp.P, tmp.n);
      pts.push([tmp.P[0] + tmp.n[0] * dd, tmp.P[1] + tmp.n[1] * dd, tmp.P[2] + tmp.n[2] * dd]);
      uvs.push([u, vOfAlpha(a)]);
    }
    // 下颌底面：颈口 → 下颌线，两行，略鼓
    const S = bottom[c]!, J = pts[0]!;
    const lerpRows: V3[] = [];
    for (const t of [0.36, 0.7]) {
      const q: V3 = [S.P[0] + (J[0] - S.P[0]) * t, S.P[1] + (J[1] - S.P[1]) * t, S.P[2] + (J[2] - S.P[2]) * t];
      const o: V3 = [q[0] - C[0], 0, q[2] - C[2]];
      norm(o);
      o[1] = -0.6;
      norm(o);
      const b = 0.0016 * Math.sin(Math.PI * t);
      lerpRows.push([q[0] + o[0] * b, q[1] + o[1] * b, q[2] + o[2] * b]);
    }
    const all = [S.P, ...lerpRows, ...pts];
    const uvAll: [number, number][] = [S.P, ...lerpRows].map(q => {
      const [uu, vv] = uvOfPoint(q[0], q[1], q[2]);
      return [c === 0 ? 0 : c === N ? 1 : uu, vv] as [number, number];
    });
    colPts.push(all);
    colUv.push([...uvAll, ...uvs]);
  }
  // 顶点：按行排（第 r 行第 c 列 = P0 + r·NC + c）
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= N; c++) {
      const q = colPts[c]![r]!;
      out.pos.push(q[0], q[1], q[2]);
      out.nor.push(0, 0, 0);
      const t = colUv[c]![r]!;
      out.uv.push(t[0], t[1]);
    }
  }
  // 头顶：每列一个（UV 各自），位置相同
  const top = surf.final(0, Math.PI);
  const poleStart = out.pos.length / 3;
  for (let c = 0; c < N; c++) {
    out.pos.push(top[0], top[1], top[2]);
    out.nor.push(0, 1, 0);
    out.uv.push((colUv[c]![rows - 1]![0] + colUv[c + 1]![rows - 1]![0]) / 2, 1);
  }
  const at = (r: number, c: number) => P0 + r * NC + c;
  const idx: number[] = [];
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c < N; c++) {
      const a = at(r, c), b = at(r, c + 1), e = at(r + 1, c), g = at(r + 1, c + 1);
      // 列按 ψ 递增（右 → 前 → 左），行向上：(a, b, e)、(b, g, e) 朝外
      idx.push(a, b, e, b, g, e);
    }
  }
  for (let c = 0; c < N; c++) idx.push(at(rows - 1, c), at(rows - 1, c + 1), poleStart + c);
  // 法线
  const tri = idx;
  const nor = new Float64Array(out.pos.length);
  const pp = out.pos;
  for (let t = 0; t < tri.length; t += 3) {
    const i0 = tri[t]!, i1 = tri[t + 1]!, i2 = tri[t + 2]!;
    const ax = pp[i1 * 3]! - pp[i0 * 3]!, ay = pp[i1 * 3 + 1]! - pp[i0 * 3 + 1]!, az = pp[i1 * 3 + 2]! - pp[i0 * 3 + 2]!;
    const bx = pp[i2 * 3]! - pp[i0 * 3]!, by = pp[i2 * 3 + 1]! - pp[i0 * 3 + 1]!, bz = pp[i2 * 3 + 2]! - pp[i0 * 3 + 2]!;
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    for (const i of [i0, i1, i2]) { nor[i * 3] += nx; nor[i * 3 + 1] += ny; nor[i * 3 + 2] += nz; }
  }
  // 复制列（u = 0 / 1）与头顶扇的法线合起来
  for (let r = 0; r < rows; r++) {
    const a = at(r, 0), b = at(r, N);
    for (let j = 0; j < 3; j++) { const s = nor[a * 3 + j]! + nor[b * 3 + j]!; nor[a * 3 + j] = s; nor[b * 3 + j] = s; }
  }
  let px = 0, py = 0, pz = 0;
  for (let c = 0; c < N; c++) { px += nor[(poleStart + c) * 3]!; py += nor[(poleStart + c) * 3 + 1]!; pz += nor[(poleStart + c) * 3 + 2]!; }
  for (let c = 0; c < N; c++) { nor[(poleStart + c) * 3] = px; nor[(poleStart + c) * 3 + 1] = py; nor[(poleStart + c) * 3 + 2] = pz; }
  for (let i = P0; i < pp.length / 3; i++) {
    const l = Math.hypot(nor[i * 3]!, nor[i * 3 + 1]!, nor[i * 3 + 2]!) || 1;
    out.nor[i * 3] = nor[i * 3]! / l; out.nor[i * 3 + 1] = nor[i * 3 + 1]! / l; out.nor[i * 3 + 2] = nor[i * 3 + 2]! / l;
  }
  // 下半张脸的着色法线往上偏一点（只改明暗、不改轮廓）：顶上来的灯（路灯、门灯）下，鼻子以下不再整片发黑像胡子
  for (let r = 3; r < rows; r++) {
    for (let c = 0; c <= N; c++) {
      const i = at(r, c);
      const y = out.pos[i * 3 + 1]!, z = out.pos[i * 3 + 2]!;
      const w = (1 - sstep(0.105, 0.145, y)) * sstep(0.03, 0.06, y) * sstep(-0.03, -0.07, z) * sstep(0.2, 0.6, -out.nor[i * 3 + 2]!);
      if (w <= 0) continue;
      const ny = out.nor[i * 3 + 1]! + 0.22 * w;
      const l = Math.hypot(out.nor[i * 3]!, ny, out.nor[i * 3 + 2]!) || 1;
      out.nor[i * 3] = out.nor[i * 3]! / l; out.nor[i * 3 + 1] = ny / l; out.nor[i * 3 + 2] = out.nor[i * 3 + 2]! / l;
    }
  }
  // 颈口一圈：法线 = 接缝法线（与脖子那边一模一样，缝上不出明暗台阶）
  for (let c = 0; c <= N; c++) {
    const b = bottom[c]!;
    const i = at(0, c);
    out.nor[i * 3] = b.n[0]; out.nor[i * 3 + 1] = b.n[1]; out.nor[i * 3 + 2] = b.n[2];
  }
  for (let i = 0; i < seam.count; i++) {
    let c = -1;
    for (let cc = 0; cc < N; cc++) if (bottom[cc]!.seamIdx === i) { c = cc; break; }
    out.seamVert.push(c < 0 ? -1 : at(0, c));
  }
  out.idx.push(...idx);
}

/** 在升序的行角度表里把离 e 最近的一对行挪到 e ∓ r（局部线性重排，两头各留两行不动）。 */
function bracket(ks: number[], e: number, r: number): void {
  const last = ks.length - 1;
  let m = -1;
  for (let i = 0; i < last; i++) if (ks[i]! <= e && e < ks[i + 1]!) { m = i; break; }
  if (m < 1 || m + 1 >= last) return;
  const lo = Math.max(0, m - 2), hi = Math.min(last, m + 3);
  const a0 = ks[lo]!, am = ks[m]!, a1 = ks[m + 1]!, ah = ks[hi]!;
  if (!(a0 < e - r && e + r < ah)) return;
  for (let i = lo + 1; i <= m; i++) ks[i] = a0 + ((ks[i]! - a0) * (e - r - a0)) / Math.max(1e-9, am - a0);
  for (let i = m + 1; i < hi; i++) ks[i] = e + r + ((ks[i]! - a1) * (ah - e - r)) / Math.max(1e-9, ah - a1);
}

export function norm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l; v[1] /= l; v[2] /= l;
  return v;
}

// ================================================================ 耳朵

/** 耳廓外轮廓（耳平面里的 (前, 上)，米，单位坐标）：从前上（贴脸处）往后绕到耳垂再回到前面（耳屏）。 */
const EAR_OUT: readonly (readonly [number, number])[] = [
  [0.0105, 0.021], [0.0045, 0.0285], [-0.005, 0.0302], [-0.0128, 0.0248], [-0.0162, 0.0128], [-0.0158, 0.0],
  [-0.0132, -0.0118], [-0.0085, -0.0215], [-0.0012, -0.0285], [0.0058, -0.024], [0.0092, -0.0125], [0.011, 0.004],
];
/** 每个轮廓点离头皮的高度（耳轮外缘；贴脸的前缘低）。 */
const EAR_H = [0.0022, 0.0046, 0.0062, 0.0068, 0.0066, 0.0062, 0.0058, 0.0052, 0.0046, 0.0032, 0.002, 0.0016];
const LOBE = new Set([7, 8, 9]);
const TRAGUS = new Set([10, 11]);

function addEar(out: HeadMeshData, surf: HeadSurface, side: 1 | -1): void {
  const p = surf.p;
  const sz = (1 + 0.15 * p.sc.earSize) * (p.child ? 0.92 : 1) * (p.female ? 0.93 : 1);
  const lobeExtra = (p.deity ? 0.0075 : 0.004) * Math.max(0, p.sc.earlobe);
  const hK = 1 + 0.08 * p.sc.earSize;
  // 耳中心落在头皮上（基础头形沿 ±x 求）
  const cy = 0.135, cz = 0.006;
  const sx = solveLine(surf, [0, cy, cz], [side, 0, 0]);
  const c: V3 = [side * sx, cy, cz];
  const tb = 15 * DEG, fw = 12 * DEG;
  const eu: V3 = [0, Math.cos(tb), Math.sin(tb)];
  const en: V3 = [side * Math.cos(fw), 0, -Math.sin(fw)];
  const ef: V3 = norm(cross(eu, en));
  if (ef[2] > 0) { ef[0] = -ef[0]; ef[1] = -ef[1]; ef[2] = -ef[2]; }
  const ctr: [number, number] = [0.0015, -0.002];
  const n = EAR_OUT.length;
  const outline = EAR_OUT.map(([f, u], i) => [f * sz * 1.18, (u - (LOBE.has(i) ? lobeExtra * (i === 8 ? 1 : 0.7) : 0)) * sz] as [number, number]);
  // 环：缩放比例、相对高度（M2、M1 是背面，A 是耳轮外缘，B 耳轮顶，C 耳舟，D 对耳轮，E 耳甲）
  type Ring = { s: number; h: (i: number) => number; shift?: [number, number] };
  const H = (i: number) => EAR_H[i]! * hK;
  const rings: Ring[] = [
    { s: 0.8, h: () => -0.0006 },
    { s: 0.95, h: i => H(i) * 0.55 },
    { s: 1, h: i => H(i) },
    { s: 0.87, h: i => H(i) + 0.0012 },
    { s: 0.74, h: i => (LOBE.has(i) ? H(i) * 0.95 : H(i) - 0.0022) },
    { s: 0.57, h: i => (LOBE.has(i) ? H(i) * 0.85 : TRAGUS.has(i) ? H(i) + 0.0018 : H(i) - 0.0007) },
    { s: 0.32, h: i => (LOBE.has(i) ? H(i) * 0.6 : TRAGUS.has(i) ? 0.0034 : 0.0012), shift: [0.0035, -0.004] },
  ];
  const base = out.pos.length / 3;
  const pt: V3 = [0, 0, 0];
  const isl = EAR_ISLAND;
  const u0 = side > 0 ? isl.u0R : isl.u0L;
  const put = (f: number, u: number, h: number) => {
    // 先落到头皮上（沿耳朵外法线求），再往外抬 h
    pt[0] = c[0] + ef[0] * f + eu[0] * u; pt[1] = c[1] + ef[1] * f + eu[1] * u; pt[2] = c[2] + ef[2] * f + eu[2] * u;
    const t = solveLine(surf, pt, en, -0.02);
    out.pos.push(pt[0] + en[0] * (t + h), pt[1] + en[1] * (t + h), pt[2] + en[2] * (t + h));
    out.nor.push(0, 0, 0);
    // 贴图小岛：前在岛的里侧（朝脸），上在上
    const fu = (f / sz + 0.019) / 0.033, uu = (u / sz + 0.034) / 0.068;
    out.uv.push(u0 + isl.w * (side > 0 ? 1 - fu : fu), isl.v0 + isl.h * uu);
  };
  for (const r of rings) {
    for (let i = 0; i < n; i++) {
      const [f, u] = outline[i]!;
      const sh = r.shift ?? [0, 0];
      put(ctr[0] + sh[0] + (f - ctr[0]) * r.s, ctr[1] + sh[1] + (u - ctr[1]) * r.s, r.h(i));
    }
  }
  const last = rings[rings.length - 1]!;
  put(ctr[0] + (last.shift?.[0] ?? 0) * 1.1, ctr[1] + (last.shift?.[1] ?? 0) * 1.1, 0.0009);
  const centre = base + rings.length * n;
  const idx: number[] = [];
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let i = 0; i < n; i++) {
      const a = base + r * n + i, b = base + r * n + ((i + 1) % n), e = base + (r + 1) * n + i, g = base + (r + 1) * n + ((i + 1) % n);
      idx.push(a, b, e, b, g, e);
    }
  }
  for (let i = 0; i < n; i++) idx.push(base + (rings.length - 1) * n + i, base + (rings.length - 1) * n + ((i + 1) % n), centre);
  orientAndNormals(out, idx, base, centre + 1, (i, nn) => {
    // 外侧（A 以后的环）的法线应朝耳朵外法线
    if (i < base + 3 * n || i === centre) return 0;
    return nn[0] * en[0] + nn[1] * en[1] + nn[2] * en[2];
  });
  out.idx.push(...idx);
}

/** 沿直线 q + e·t 求基础头形表面的 t（从 t0 往外走）。 */
export function solveLine(surf: HeadSurface, q: Readonly<V3>, e: Readonly<V3>, t0 = 0): number {
  let lo = t0, hi = t0;
  const f = (t: number) => surf.f(q[0] + e[0] * t, q[1] + e[1] * t, q[2] + e[2] * t);
  if (f(lo) > 0) {
    // 起点已在外面：往里退
    while (lo > -0.2 && f(lo) > 0) lo -= 0.004;
    hi = lo + 0.004;
  } else {
    while (hi < 0.3) {
      hi += 0.004;
      if (f(hi) > 0) break;
      lo = hi;
    }
  }
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (f(m) > 0) hi = m;
    else lo = m;
  }
  return (lo + hi) / 2;
}

export function cross(a: Readonly<V3>, b: Readonly<V3>): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * 一块子网格（顶点 [v0, v1)、三角 idx）：算法线；score(i, n) 给出“应该朝外”的打分（> 0 朝外），合计为负就把三角翻面再算。
 */
export function orientAndNormals(out: HeadMeshData, idx: number[], v0: number, v1: number, score: (i: number, n: V3) => number): void {
  const calc = () => {
    const acc = new Float64Array((v1 - v0) * 3);
    for (let t = 0; t < idx.length; t += 3) {
      const i0 = idx[t]!, i1 = idx[t + 1]!, i2 = idx[t + 2]!;
      const P = out.pos;
      const ax = P[i1 * 3]! - P[i0 * 3]!, ay = P[i1 * 3 + 1]! - P[i0 * 3 + 1]!, az = P[i1 * 3 + 2]! - P[i0 * 3 + 2]!;
      const bx = P[i2 * 3]! - P[i0 * 3]!, by = P[i2 * 3 + 1]! - P[i0 * 3 + 1]!, bz = P[i2 * 3 + 2]! - P[i0 * 3 + 2]!;
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      for (const i of [i0, i1, i2]) { acc[(i - v0) * 3] += nx; acc[(i - v0) * 3 + 1] += ny; acc[(i - v0) * 3 + 2] += nz; }
    }
    let s = 0;
    for (let i = v0; i < v1; i++) {
      const nn: V3 = [acc[(i - v0) * 3]!, acc[(i - v0) * 3 + 1]!, acc[(i - v0) * 3 + 2]!];
      norm(nn);
      out.nor[i * 3] = nn[0]; out.nor[i * 3 + 1] = nn[1]; out.nor[i * 3 + 2] = nn[2];
      s += score(i, nn);
    }
    return s;
  };
  if (calc() < 0) {
    for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]!; idx[t + 1] = idx[t + 2]!; idx[t + 2] = x; }
    calc();
  }
}

// ================================================================ 发髻

/** 盘起来的发髻（bun：后脑偏上，三圈盘绕）/ 低髻（chignon：后颈上方，横向椭圆）：贴着头发表面放样的一个圆顶，带三道盘绕的沟。 */
function addBun(out: HeadMeshData, surf: HeadSurface, kind: 'bun' | 'chignon'): void {
  const chig = kind === 'chignon';
  const at: V3 = chig ? [0, 0.118, 0.1] : [0, 0.175, 0.105];
  const psi0 = psiOf(at[0], at[2]), alpha0 = alphaOf(at[0], at[1], at[2]);
  const Ps = surf.final(psi0, alpha0);
  const ax = norm([Ps[0] - HEAD_C[0], Ps[1] - HEAD_C[1], Ps[2] - HEAD_C[2]]);
  if (chig) { ax[1] -= 0.25; norm(ax); }
  // 横轴 e1（水平）、竖轴 e2
  const e1 = norm(cross([0, 1, 0], ax));
  const e2 = norm(cross(ax, e1));
  const R = 0.042, Hd = chig ? 0.03 : 0.036;
  const sx = chig ? 1.18 : 1, sy = chig ? 0.78 : 1;
  // 轮廓（离轴半径比、高度比）：底边埋进头发 1.5mm，三道盘绕
  const prof: readonly (readonly [number, number])[] = [
    [0.94, -0.06], [1.0, 0.14], [0.99, 0.3], [0.9, 0.42], [0.86, 0.52], [0.73, 0.68], [0.62, 0.77], [0.45, 0.88], [0.24, 0.97], [0, 1],
  ];
  const seg = 18;
  const uc = uvOfPoint(at[0], at[1], at[2])[0];
  const base = out.pos.length / 3;
  const pt: V3 = [0, 0, 0];
  const surfUnder = (q: Readonly<V3>): V3 => {
    const psi = psiOf(q[0], q[2]), al = alphaOf(q[0], q[1], q[2]);
    return surf.final(psi, al);
  };
  for (let k = 0; k < prof.length; k++) {
    const [rr, hh] = prof[k]!;
    const ringN = k === prof.length - 1 ? 1 : seg;
    for (let i = 0; i < ringN; i++) {
      const th = (i / seg) * Math.PI * 2 + k * 0.5;
      // 盘绕：每圈半径随角度轻微起伏（像一股头发绕上去）
      const wob = 1 + 0.035 * Math.sin(th + k * 1.7);
      const r = R * rr * wob;
      const lx = Math.cos(th) * r * sx, ly = Math.sin(th) * r * sy;
      pt[0] = Ps[0] + e1[0] * lx + e2[0] * ly; pt[1] = Ps[1] + e1[1] * lx + e2[1] * ly; pt[2] = Ps[2] + e1[2] * lx + e2[2] * ly;
      // 高度从下面那片头发表面量起（大圆底边贴着弯的后脑）
      const S = surfUnder(pt);
      const off = (S[0] - Ps[0]) * ax[0] + (S[1] - Ps[1]) * ax[1] + (S[2] - Ps[2]) * ax[2];
      const lift = off * (1 - hh) + Hd * hh;
      out.pos.push(pt[0] + ax[0] * lift, pt[1] + ax[1] * lift, pt[2] + ax[2] * lift);
      out.nor.push(0, 0, 0);
      // UV：取它底下那片头皮的 UV（发髻下面那块画成盘绕的发丝）
      const [u, v] = uvOfPoint(pt[0], pt[1], pt[2]);
      // 发髻在后脑正中，跨 u = 0/1 的接缝：按中心展开成连续的 u（人头贴图横向是 Repeat）
      out.uv.push(u - Math.round(u - uc), v);
    }
  }
  const idx: number[] = [];
  const ringStart = (k: number) => base + k * seg;
  for (let k = 0; k + 2 < prof.length; k++) {
    for (let i = 0; i < seg; i++) {
      const a = ringStart(k) + i, b = ringStart(k) + ((i + 1) % seg), e = ringStart(k + 1) + i, g = ringStart(k + 1) + ((i + 1) % seg);
      idx.push(a, b, e, b, g, e);
    }
  }
  const top = ringStart(prof.length - 1);
  for (let i = 0; i < seg; i++) idx.push(ringStart(prof.length - 2) + i, ringStart(prof.length - 2) + ((i + 1) % seg), top);
  const end = top + 1;
  orientAndNormals(out, idx, base, end, (i, nn) => {
    const P = out.pos;
    return (P[i * 3]! - Ps[0]) * nn[0] + (P[i * 3 + 1]! - Ps[1]) * nn[1] + (P[i * 3 + 2]! - Ps[2]) * nn[2] + 0.2 * (nn[0] * ax[0] + nn[1] * ax[1] + nn[2] * ax[2]);
  });
  out.idx.push(...idx);
}

// ================================================================ 组装成 BufferGeometry

/** 单位坐标 → 头网格局部（headSlot 局部 − 头网格位置），×k。颈口一圈用接缝的精确数值（headSlot 局部）覆盖。 */
export function toGeometry(m: HeadMeshData, k: number, seamLocal: Float32Array, seamNor: Float32Array): THREE.BufferGeometry {
  const pos = new Float32Array(m.pos.length);
  for (let i = 0; i < m.pos.length; i += 3) {
    pos[i] = (m.pos[i]! - HEAD_ORIGIN[0]) * k;
    pos[i + 1] = (m.pos[i + 1]! - HEAD_ORIGIN[1]) * k;
    pos[i + 2] = (m.pos[i + 2]! - HEAD_ORIGIN[2]) * k;
  }
  const nor = Float32Array.from(m.nor);
  m.seamVert.forEach((v, i) => {
    if (v < 0) return;
    pos[v * 3] = seamLocal[i * 3]! - HEAD_ORIGIN[0] * k;
    pos[v * 3 + 1] = seamLocal[i * 3 + 1]! - HEAD_ORIGIN[1] * k;
    pos[v * 3 + 2] = seamLocal[i * 3 + 2]! - HEAD_ORIGIN[2] * k;
    nor[v * 3] = seamNor[i * 3]!; nor[v * 3 + 1] = seamNor[i * 3 + 1]!; nor[v * 3 + 2] = seamNor[i * 3 + 2]!;
  });
  // 复制列（c = HEAD_COLS）的颈口点也贴上
  const NC = m.cols + 1;
  for (const v of m.seamVert) {
    if (v < 0) continue;
    const c = (v - m.gridStart) % NC;
    if (c === 0) {
      const w = v + m.cols;
      for (let j = 0; j < 3; j++) { pos[w * 3 + j] = pos[v * 3 + j]!; nor[w * 3 + j] = nor[v * 3 + j]!; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
  g.setIndex(m.idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  g.userData.headGridStart = m.gridStart;
  g.userData.headRows = m.rows;
  g.userData.headCols = m.cols;
  return g;
}

/** 单位坐标里的方向 → 头网格局部坐标里的点（给 R1 贴片等：最终表面）。 */
export function finalPointLocal(surf: HeadSurface, psi: number, alpha: number, k: number): V3 {
  const P = surf.final(psi, alpha);
  return [(P[0] - HEAD_ORIGIN[0]) * k, (P[1] - HEAD_ORIGIN[1]) * k, (P[2] - HEAD_ORIGIN[2]) * k];
}
