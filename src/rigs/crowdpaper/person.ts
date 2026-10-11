// owner: WP2
// char2 WP-X：实例化人群的“人”（PLAN §3.5）。一份连续的低模人形（≤ 3.6k 三角形），没有球、胶囊、方块：
// - 身体是一根放样管：裆 → 臀 → 腰 → 胸 → 斜方肌 → 脖子 → 头（下颌、下巴、鼻梁楔、眉弓、眼窝、嘴、耳朵的凸起都是同一圈圈的径向函数），
//   头发壳就是外表面（发际线以上把半径往外推 8–13mm），头顶收成一个点；
// - 裆部真分叉：最下面一圈分成左右两半，中缝补三点，往下各放样一条裤腿（膝、小腿肚、裤脚翻边），裤脚里收口；
// - 胳膊从肩头的圆顶放样到手腕，再到连指“手套”手（掌心朝大腿，指头微收），另加一根拇指；
// - 鞋是鞋楦放样（鞋跟、脚背、前掌、微翘的鞋头），鞋底一圈单独的颜色、硬边。
// 画的顺序 = 索引顺序：身体 → 腿 → 胳膊 → 手 → 鞋（回放材质写深度，套在里面的部分被先画的外壳挡住）。
// 孩子是另一份同拓扑的几何（头 ×1.3、腿 ×0.85、躯干 ×0.9、脸更圆、鼻子更小），不是缩小的大人。
// UV 指向 256² 图集（crowdAtlas.ts 逐像素画）：身体管 [0,0,256,176]（头在上），裤腿 [0,180,100,76]，胳膊+手 [100,180,100,76]，
// 颜色格 [204,180,52,76]（鞋面、鞋底、皮肤）。

import * as THREE from 'three';
import { MeshBuilder, interp, lerp, smax, smoothstep, spow, type P3 } from './meshkit';

export interface PersonDims {
  kid: boolean;
  legS: number; torsoS: number; headS: number; widthS: number; armS: number;
  noseK: number; jawK: number; limbR: number;
}
export const ADULT: PersonDims = { kid: false, legS: 1, torsoS: 1, headS: 1, widthS: 1, armS: 1, noseK: 1, jawK: 1, limbR: 1 };
export const KID: PersonDims = { kid: true, legS: 0.85, torsoS: 0.9, headS: 1.3, widthS: 0.9, armS: 0.86, noseK: 0.55, jawK: 0.35, limbR: 0.9 };

// ---------------------------------------------------------------- 圈的角度：正面加密（脸、扣子），背面稀

const NF = 9, NB = 5;
export const N = 2 * NF + 2 * NB; // 28
export const I_FRONT = NF, I_LEFT = 2 * NF, I_BACK = 2 * NF + NB;
const f = (t: number) => 0.45 * t + 0.55 * (1 - (1 - t) * (1 - t));
/** 下标 → 角度 θ（0 = +x，π/2 = 正前 −z，π = −x，3π/2 = 后背）；ANG[N] = 2π。 */
export const ANG: number[] = (() => {
  const a: number[] = [];
  for (let i = 0; i < NF; i++) a.push((Math.PI / 2) * f(i / NF));
  for (let i = 0; i < NF; i++) a.push(Math.PI / 2 + (Math.PI / 2) * (1 - f(1 - i / NF)));
  for (let i = 0; i < NB; i++) a.push(Math.PI + (Math.PI / 2) * (i / NB));
  for (let i = 0; i < NB; i++) a.push(1.5 * Math.PI + (Math.PI / 2) * (i / NB));
  a.push(Math.PI * 2);
  return a;
})();
/** u（0..1，按下标均匀）→ θ。 */
export function angleOfU(u: number): number {
  const x = Math.max(0, Math.min(N, u * N));
  const i = Math.min(N - 1, Math.floor(x));
  return lerp(ANG[i]!, ANG[i + 1]!, x - i);
}

// ---------------------------------------------------------------- 躯干表（设计尺寸：成年男子 1.75m 左右，脚底 y=0，面朝 −z）

/** [y, 半宽 a, 前深 bf, 后深 bb, 超椭圆指数 n, 中心 z] */
const TORSO: readonly (readonly [number, number, number, number, number, number])[] = [
  [0.80, 0.158, 0.088, 0.104, 2.3, 0.0],
  [0.87, 0.167, 0.092, 0.116, 2.4, 0.0],
  [0.94, 0.160, 0.090, 0.108, 2.5, 0.0],
  [1.00, 0.150, 0.089, 0.098, 2.6, 0.0],
  [1.07, 0.151, 0.094, 0.097, 2.6, 0.0],
  [1.16, 0.159, 0.104, 0.099, 2.7, 0.0],
  [1.25, 0.166, 0.112, 0.102, 2.8, 0.0],
  [1.33, 0.169, 0.108, 0.103, 2.8, 0.004],
  [1.39, 0.166, 0.097, 0.100, 2.7, 0.006],
  [1.43, 0.157, 0.084, 0.090, 2.6, 0.008],
  [1.462, 0.114, 0.070, 0.074, 2.3, 0.010],
  [1.484, 0.070, 0.056, 0.060, 2.1, 0.012],
];
const HEAD_ROWS = [1.50, 1.515, 1.53, 1.545, 1.56, 1.575, 1.59, 1.602, 1.614, 1.626, 1.638, 1.65, 1.663, 1.677, 1.692, 1.707, 1.72, 1.73];
/** 身体管每一行的设计高度（最后一行之后是头顶点）。 */
export const ROW_Y: readonly number[] = [...TORSO.map(r => r[0]), ...HEAD_ROWS];
export const NECK_Y = 1.48;

// 头的常数
const HZ = -0.006, YC = 1.622, CROWN = 1.733, NZ = 0.014;
export const HEAD = { HZ, YC, CROWN };

/** 发际线高度（设计坐标）：前额 1.688，鬓角 ~1.656，后颈 1.576。 */
export function hairline(theta: number, kid = false): number {
  const s = Math.sin(theta);
  if (s >= 0) return (kid ? 1.676 : 1.688) - (kid ? 0.02 : 0.032) * Math.pow(1 - s, 1.2);
  return 1.656 - 0.08 * Math.pow(-s, 0.9);
}

const g = (t: number) => Math.exp(-t * t);

/** 头 + 脖子这一圈在 θ 方向的半径（设计坐标，头中心 (0, y, HZ)）；features：五官起伏与头发。 */
export function headRadius(theta: number, y: number, d: PersonDims, features = true): { r: number; hair: number; x: number } {
  const c = Math.cos(theta), s = Math.sin(theta);
  const axTop = 0.0735, azF = 0.091, azB = 0.099;
  const polar = (ax: number) => {
    const az = s > 0 ? azF : azB;
    return 1 / Math.sqrt((c / ax) ** 2 + (s / az) ** 2);
  };
  let rh = 0;
  if (y >= YC) {
    const t = Math.min(1, (y - YC) / (CROWN - YC));
    rh = polar(axTop) * Math.pow(Math.max(0, 1 - Math.pow(t, 2.7)), 1 / 2.7);
  } else {
    const yb = s > 0 ? 1.545 - 0.040 * s : 1.545 + 0.036 * -s;
    const p = s > 0 ? lerp(2.0, d.kid ? 2.3 : 3.2, s) : lerp(2.0, 2.4, -s);
    // 下颌比颅骨窄（孩子的脸圆，收得少）
    const ax = axTop - 0.014 * d.jawK * smoothstep(1.61, 1.53, y) + (d.kid ? 0.004 * smoothstep(1.64, 1.57, y) : 0);
    if (y > yb) {
      const t = (YC - y) / (YC - yb);
      rh = polar(ax) * Math.pow(Math.max(0, 1 - Math.pow(t, p)), 1 / p);
    }
  }
  // 脖子：椭圆（中心比头中心靠后）沿 θ 方向的半径；到头里就淡出
  const a = 0.046, b = 0.044, dz0 = HZ - NZ;
  const A = (c / a) ** 2 + (s / b) ** 2, B = (dz0 * s) / (b * b), C = (dz0 / b) ** 2 - 1;
  const rn = (B + Math.sqrt(Math.max(0, B * B - A * C))) / A;
  const nw = 1 - smoothstep(1.585, 1.63, y);
  let r = nw > 0 ? smax(rh, rn * nw, 0.009) : rh;
  const x = r * c;
  let hair = 0;
  if (features) {
    const front = Math.max(0, s);
    const f4 = front ** 4;
    // 鼻梁楔：鼻根 → 鼻尖 → 鼻底（鼻翼更宽）
    const out = interp([1.594, 1.600, 1.606, 1.62, 1.645, 1.662], [0, 0.012, 0.0185, 0.014, 0.007, 0.002], y);
    const w = interp([1.596, 1.61, 1.662], [0.016, 0.015, 0.008], y);
    if (out > 0) r += d.noseK * out * Math.max(0, 1 - (x / w) ** 2) ** 2 * f4;
    const ax = Math.abs(x);
    r += 0.0035 * g((y - 1.652) / 0.008) * g((ax - 0.03) / 0.022) * front * front; // 眉弓
    r -= 0.0045 * g((y - 1.637) / 0.009) * g((ax - 0.031) / 0.013) * front * front; // 眼窝
    r += (d.kid ? 0.005 : 0.003) * g((y - 1.612) / 0.014) * g((ax - 0.048) / 0.016) * front; // 颧骨 / 孩子的脸蛋
    r += 0.0028 * g((y - 1.576) / 0.008) * g(x / 0.022) * f4; // 嘴唇
    r += (d.kid ? 0.0025 : 0.005) * g((y - 1.533) / 0.012) * g(x / 0.024) * f4; // 下巴
    // 耳朵：两侧略靠后
    const de = Math.min(Math.abs(wrap(theta + 0.12)), Math.abs(wrap(theta - Math.PI - 0.12)));
    r += 0.012 * g(de / 0.16) * g((y - 1.624) / 0.019);
    // 头发壳：发际线以上整体外推（没有头皮在里面）
    const hl = hairline(theta, d.kid);
    const T = 0.008 + 0.005 * smoothstep(1.66, 1.73, y) + (d.kid ? 0.003 : 0);
    hair = T * smoothstep(hl - 0.003, hl + 0.008, y);
    r += hair;
  }
  return { r, hair, x };
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** 躯干一行在 θ 方向的点（设计坐标）。 */
function torsoPoint(theta: number, row: readonly [number, number, number, number, number, number], d: PersonDims): [number, number, number] {
  const [y, a0, bf, bb, n, zc] = row;
  let a = a0;
  if (d.kid && y > 0.9 && y < 1.2) a = Math.max(a0, 0.158); // 孩子没有腰
  const c = Math.cos(theta), s = Math.sin(theta);
  const e = 2 / n;
  return [a * spow(c, e), y, zc - (s > 0 ? bf : bb) * spow(s, e)];
}

/** 设计坐标 → 这份几何的坐标（孩子：腿 ×legS、躯干 ×torsoS、头绕脖根 ×headS、宽 ×widthS）。 */
function mapY(y: number, d: PersonDims): number {
  if (y <= 0.8) return y * d.legS;
  if (y <= NECK_Y) return 0.8 * d.legS + (y - 0.8) * d.torsoS;
  return 0.8 * d.legS + (NECK_Y - 0.8) * d.torsoS + (y - NECK_Y) * d.headS;
}
function mapBody(p: readonly [number, number, number], d: PersonDims): P3 {
  const y = p[1];
  // 脖子往上从躯干的宽度系数过渡到头的系数（孩子：细脖子、大脑袋）
  const k = lerp(d.widthS, d.headS, smoothstep(NECK_Y, 1.56, y));
  return [p[0] * k, mapY(y, d), p[2] * k];
}

// ---------------------------------------------------------------- 图集布局（像素，256²）

export const ATLAS_PX = 256;
export type Rect = readonly [number, number, number, number];
export const REG = {
  body: [0, 0, 256, 176] as Rect,
  legs: [0, 180, 100, 76] as Rect,
  arms: [100, 180, 100, 76] as Rect,
  shoe: [204, 180, 52, 30] as Rect,
  sole: [204, 212, 52, 18] as Rect,
  skin: [204, 232, 52, 24] as Rect,
};
const INSET = 1.5;
/** 区域内 (s, t)（0..1，t = 0 在区域顶上）→ UV。 */
export function regUv(r: Rect, s: number, t: number): [number, number] {
  const px = r[0] + INSET + s * (r[2] - 2 * INSET);
  const py = r[1] + INSET + t * (r[3] - 2 * INSET);
  return [px / ATLAS_PX, 1 - py / ATLAS_PX];
}
/** 身体管第 j 行 → 区域内 t（头顶 0，裆 1）：躯干 0.47..1，头 0..0.47，按高度线性。 */
export function bodyT(y: number): number {
  if (y <= NECK_Y) return lerp(1, 0.47, (y - 0.8) / (NECK_Y - 0.8));
  return lerp(0.47, 0.012, (y - NECK_Y) / (CROWN + 0.013 - NECK_Y));
}
export function bodyYofT(t: number): number {
  if (t >= 0.47) return lerp(0.8, NECK_Y, (1 - t) / (1 - 0.47));
  return lerp(NECK_Y, CROWN + 0.013, (0.47 - t) / (0.47 - 0.012));
}

// ---------------------------------------------------------------- 胳膊（设计坐标，右臂 x > 0）

/** 轴上的点 [x, y, z, rx(向外), rz(前后)]；第一行是肩头圆顶的顶点。 */
const ARM: readonly (readonly [number, number, number, number, number])[] = [
  // fix1：肩头圆顶压低、往里收，接着肩线的斜坡往下（原来袖山高出肩线，读成一对方方的垫肩）
  [0.150, 1.424, 0.006, 0, 0],
  [0.160, 1.411, 0.005, 0.026, 0.030],
  [0.172, 1.386, 0.004, 0.038, 0.042],
  [0.183, 1.350, 0.003, 0.043, 0.045],
  [0.193, 1.31, 0.004, 0.043, 0.043],
  [0.197, 1.258, 0.006, 0.0435, 0.0435],
  [0.198, 1.248, 0.006, 0.0385, 0.038],
  [0.201, 1.175, 0.008, 0.0365, 0.036],
  [0.203, 1.118, 0.010, 0.0345, 0.034],
  [0.206, 1.042, 0.002, 0.034, 0.036],
  [0.210, 0.962, -0.006, 0.029, 0.031],
  [0.213, 0.897, -0.010, 0.020, 0.026],
  [0.215, 0.868, -0.012, 0.016, 0.037],
  [0.213, 0.828, -0.014, 0.015, 0.041],
  [0.207, 0.795, -0.016, 0.013, 0.039],
  [0.199, 0.768, -0.016, 0.011, 0.030],
  [0.194, 0.753, -0.015, 0, 0],
];
const ARM_SEG = 10;
/** 胳膊各行沿轴的累计长度（0..1），画短袖、袖口、手用。 */
export const ARM_T: readonly number[] = (() => {
  const out = [0];
  let acc = 0;
  for (let i = 1; i < ARM.length; i++) {
    const a = ARM[i - 1]!, b = ARM[i]!;
    acc += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    out.push(acc);
  }
  return out.map(v => v / acc);
})();
export const ARM_ROW = { sleeveHem: 5, lipIn: 6, wrist: 11, palm: 12 } as const;

// ---------------------------------------------------------------- 腿

/** [y, 中心 x, rx, rz, 中心 z] */
const LEG: readonly (readonly [number, number, number, number, number])[] = [
  [0.73, 0.088, 0.083, 0.081, 0.002],
  [0.63, 0.090, 0.073, 0.071, 0.0],
  [0.53, 0.092, 0.060, 0.060, -0.002],
  [0.465, 0.093, 0.055, 0.057, -0.006],
  [0.39, 0.094, 0.056, 0.061, 0.004],
  [0.29, 0.095, 0.054, 0.057, 0.003],
  [0.18, 0.096, 0.051, 0.054, 0.0],
  [0.095, 0.097, 0.054, 0.057, 0.0],
];
export const LEG_Y0 = 0.80, LEG_Y1 = 0.088;
const CROTCH: readonly [number, number][] = [[0.787, -0.045], [0.776, 0.008], [0.786, 0.06]]; // [y, z]

// ---------------------------------------------------------------- 鞋楦

/** [z（后跟 +）, 半宽, 高] */
const SHOE: readonly (readonly [number, number, number])[] = [
  [0.085, 0.029, 0.048], [0.071, 0.040, 0.066], [0.040, 0.043, 0.080], [0.0, 0.044, 0.078],
  [-0.05, 0.046, 0.066], [-0.10, 0.048, 0.047], [-0.14, 0.044, 0.037], [-0.165, 0.034, 0.030],
];

// ---------------------------------------------------------------- 构建

/** 一个人（adult / kid）的几何。 */
export function buildPerson(d: PersonDims): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const G_BODY = 0, G_SHOE = 2, G_SOLE = 3, G_THUMB = 4;

  // ---- 身体管：每行 N+1 个点（末点复制首点，u = 1）
  const rows: number[][] = [];
  const rowPts: P3[][] = [];
  for (let j = 0; j < ROW_Y.length; j++) {
    const yd = ROW_Y[j]!;
    const t = bodyT(yd);
    const ring: number[] = [];
    const pts: P3[] = [];
    for (let i = 0; i <= N; i++) {
      const th = ANG[i]!;
      let p: [number, number, number];
      if (j < TORSO.length) p = torsoPoint(th, TORSO[j]!, d);
      else {
        const { r } = headRadius(th, yd, d);
        p = [r * Math.cos(th), yd, HZ - r * Math.sin(th)];
        // 头与躯干顶行之间（脖根）中心从 z 0.012 过渡到头的中心
      }
      const q = mapBody(p, d);
      pts.push(q);
      const [u, v] = regUv(REG.body, i / N, t);
      ring.push(mb.v(q, u, v, G_BODY));
    }
    rows.push(ring);
    rowPts.push(pts);
  }
  for (let j = 0; j + 1 < rows.length; j++) {
    const ya = mapY(ROW_Y[j]!, d), yb = mapY(ROW_Y[j + 1]!, d);
    // 参考点：本段中轴（头里用头中心）
    const zc = ROW_Y[j]! >= NECK_Y ? HZ * d.headS : 0.004;
    mb.bridge(rows[j]!, rows[j + 1]!, false, new THREE.Vector3(0, (ya + yb) / 2, zc));
  }
  // 头顶点
  {
    const yTop = CROWN + headRadius(Math.PI / 2, CROWN, d).hair;
    const [u, v] = regUv(REG.body, 0.5, 0);
    const apex = mb.v(mapBody([0, yTop, HZ + 0.004], d), u, v, G_BODY);
    mb.fan(rows[rows.length - 1]!, apex, new THREE.Vector3(0, 1, 0), false);
  }

  // ---- 两条裤腿：裆部那一圈分成两半 + 中缝三点
  const split = rowPts[0]!;
  for (const side of [1, -1] as const) {
    // 右腿（+x）：后中 → +x → 前中，然后中缝 前→后；左腿镜像：前中 → −x → 后中，中缝 后→前
    const outer: number[] = side > 0 ? [...range(I_BACK, N), ...range(0, I_FRONT + 1)] : range(I_FRONT, I_BACK + 1);
    const inner = side > 0 ? CROTCH : [...CROTCH].reverse();
    const topPts: P3[] = [...outer.map(i => split[i]!), ...inner.map(([y, z]) => mapBody([0, y, z], d))];
    const M = topPts.length; // 18
    const cx0 = mapBody([side * LEG[0]![1], 0.8, 0], d)[0];
    const cz0 = 0.004;
    // 顶圈每点绕腿中心的角度（展开成单调）
    const phiTop: number[] = [];
    for (let i = 0; i < M; i++) {
      const p = topPts[i]!;
      let a = Math.atan2(-(p[2] - cz0), p[0] - cx0);
      if (i > 0) {
        const prev = phiTop[i - 1]!;
        while (a - prev > Math.PI) a -= Math.PI * 2;
        while (a - prev < -Math.PI) a += Math.PI * 2;
      }
      phiTop.push(a);
    }
    const dir = Math.sign(phiTop[M - 1]! - phiTop[0]!) || 1;
    let off = 0;
    for (let i = 0; i < M; i++) off += phiTop[i]! - (dir * Math.PI * 2 * i) / M;
    off /= M;
    const ringsIdx: number[][] = [];
    const legV = (yd: number) => (LEG_Y0 - yd) / (LEG_Y0 - LEG_Y1);
    // 顶圈（腿的 UV，位置与身体最后一圈相同 → 法线焊在一起）
    {
      const ring: number[] = [];
      for (let i = 0; i <= M; i++) {
        const [u, v] = regUv(REG.legs, i / M, 0);
        ring.push(mb.v(topPts[i % M]!, u, v, G_BODY));
      }
      ringsIdx.push(ring);
    }
    const blend = [0.45, 0.8, 1, 1, 1, 1, 1, 1];
    LEG.forEach((row, k) => {
      const [yd, cx, rx, rz, cz] = row;
      const ring: number[] = [];
      for (let i = 0; i <= M; i++) {
        const ii = i % M;
        const phi = lerp(phiTop[ii]! + (i === M ? dir * Math.PI * 2 : 0), off + (dir * Math.PI * 2 * i) / M, blend[k]!);
        const q: P3 = [side * cx * d.widthS + rx * d.limbR * Math.cos(phi), mapY(yd, d), cz - rz * d.limbR * Math.sin(phi)];
        const [u, v] = regUv(REG.legs, i / M, legV(yd));
        ring.push(mb.v(q, u, v, G_BODY));
      }
      ringsIdx.push(ring);
    });
    for (let k = 0; k + 1 < ringsIdx.length; k++) {
      const yd = k === 0 ? 0.77 : (LEG[k - 1]![0] + LEG[k]![0]) / 2;
      const cx = side * (k === 0 ? LEG[0]![1] : LEG[k]![1]) * d.widthS;
      mb.bridge(ringsIdx[k]!, ringsIdx[k + 1]!, false, new THREE.Vector3(cx, mapY(yd, d), 0));
    }
    // 裤脚：往里翻一点再封口（鞋从里面伸出来）
    const last = LEG[LEG.length - 1]!;
    const lip: number[] = [];
    const lastRing = ringsIdx[ringsIdx.length - 1]!;
    for (let i = 0; i <= M; i++) {
      const p = mb.p(lastRing[i]!);
      const cx = side * last[1] * d.widthS;
      const q: P3 = [cx + (p.x - cx) * 0.82, mapY(LEG_Y1, d), p.z * 0.82];
      const [u, v] = regUv(REG.legs, i / M, 1);
      lip.push(mb.v(q, u, v, 1));
    }
    const hemCentre = new THREE.Vector3(side * last[1] * d.widthS, mapY(LEG_Y1 + 0.03, d), 0);
    mb.bridge(lastRing, lip, false, hemCentre);
    const [cu, cv] = regUv(REG.legs, 0.5, 1);
    const capC = mb.v([side * last[1] * d.widthS, mapY(LEG_Y1, d) + 0.002, 0], cu, cv, 1);
    mb.fan(lip, capC, new THREE.Vector3(0, -1, 0), false);
  }

  // ---- 胳膊 + 连指手（圆顶 → 三角肌 → 短袖口 → 肘 → 手腕 → 手掌 → 指尖）
  const shoulderD: [number, number, number] = [0.172, 1.405, 0.004];
  const shoulder = mapBody(shoulderD, d);
  const armPt = (row: readonly [number, number, number, number, number], side: number): THREE.Vector3 => {
    // 以肩为原点按 armS 缩放（孩子胳膊短一点、细一点）
    const rel = new THREE.Vector3(row[0] - shoulderD[0], row[1] - shoulderD[1], row[2] - shoulderD[2]).multiplyScalar(d.armS);
    return new THREE.Vector3(side * (shoulder[0] + rel.x), shoulder[1] + rel.y, shoulder[2] + rel.z);
  };
  const thumbs: { side: number; base: THREE.Vector3; ex: THREE.Vector3; ez: THREE.Vector3; len: number }[] = [];
  for (const side of [1, -1] as const) {
    const C = ARM.map(r => armPt(r, side));
    const rings: number[][] = [];
    for (let k = 1; k < ARM.length - 1; k++) {
      const row = ARM[k]!;
      const T = new THREE.Vector3().subVectors(C[k + 1]!, C[k - 1]!).normalize();
      const e1 = new THREE.Vector3(side, 0, 0).addScaledVector(T, -side * T.x).normalize(); // 往外
      const e2 = new THREE.Vector3().crossVectors(T, e1).normalize();
      // e2 指向 −z（前）还是 +z：统一成“前 = −z”
      if (e2.z > 0) e2.multiplyScalar(-1);
      const rx = row[3] * d.armS * d.limbR, rz = row[4] * d.armS * d.limbR;
      const ring: number[] = [];
      for (let i = 0; i <= ARM_SEG; i++) {
        const phi = (i / ARM_SEG) * Math.PI * 2;
        const p = C[k]!.clone().addScaledVector(e1, rx * Math.cos(phi)).addScaledVector(e2, rz * Math.sin(phi));
        const [u, v] = regUv(REG.arms, i / ARM_SEG, ARM_T[k]!);
        ring.push(mb.v([p.x, p.y, p.z], u, v, k >= ARM_ROW.palm ? 5 : 6));
      }
      rings.push(ring);
      if (k === 13) thumbs.push({ side, base: C[k]!.clone().addScaledVector(e2, rz * 0.7).addScaledVector(T, -0.018 * d.armS), ex: e1, ez: e2, len: 0.05 * d.armS });
    }
    // 手腕处的环同时属于胳膊（6 组）与手（5 组）：手腕那一圈复制一份给手，同位置法线不焊（皮肤与袖口分开）也无妨——这里让它们同组
    const [tu, tv] = regUv(REG.arms, 0.5, 0);
    const top = mb.v([C[0]!.x, C[0]!.y, C[0]!.z], tu, tv, 6);
    mb.fan(rings[0]!, top, new THREE.Vector3(0, 1, 0), false);
    for (let k = 0; k + 1 < rings.length; k++) {
      const mid = C[k + 1]!.clone().add(C[k + 2]!).multiplyScalar(0.5);
      mb.bridge(rings[k]!, rings[k + 1]!, false, mid);
    }
    const [bu, bv] = regUv(REG.arms, 0.5, 1);
    const tip = C[C.length - 1]!;
    const tipI = mb.v([tip.x, tip.y, tip.z], bu, bv, 5);
    mb.fan(rings[rings.length - 1]!, tipI, new THREE.Vector3(0, -1, 0), false);
  }
  // ---- 拇指（从掌心前缘往前下方伸出，收一点）
  for (const t of thumbs) {
    const dir = new THREE.Vector3(-t.side * 0.28, -0.62, -0.73).normalize();
    const pts = [0, 0.5, 1].map(k => t.base.clone().addScaledVector(dir, t.len * k));
    const rads = [0.012, 0.010, 0.0075].map(r => r * d.limbR);
    const rings: number[][] = [];
    const e1 = new THREE.Vector3(1, 0, 0).addScaledVector(dir, -dir.x).normalize();
    const e2 = new THREE.Vector3().crossVectors(dir, e1).normalize();
    pts.forEach((c, k) => {
      const ring: number[] = [];
      for (let i = 0; i < 6; i++) {
        const phi = (i / 6) * Math.PI * 2;
        const p = c.clone().addScaledVector(e1, rads[k]! * Math.cos(phi)).addScaledVector(e2, rads[k]! * 0.85 * Math.sin(phi));
        const [u, v] = regUv(REG.skin, 0.5, 0.5);
        ring.push(mb.v([p.x, p.y, p.z], u, v, G_THUMB));
      }
      rings.push(ring);
    });
    for (let k = 0; k + 1 < rings.length; k++) mb.bridge(rings[k]!, rings[k + 1]!, true, pts[k]!.clone().add(pts[k + 1]!).multiplyScalar(0.5));
    const end = pts[2]!.clone().addScaledVector(dir, 0.008);
    const [u, v] = regUv(REG.skin, 0.5, 0.5);
    mb.fan(rings[2]!, mb.v([end.x, end.y, end.z], u, v, G_THUMB), dir, true);
  }

  // ---- 鞋（鞋楦放样：后跟 → 脚背 → 前掌 → 鞋头），脚尖外撇 6°
  for (const side of [1, -1] as const) {
    const cx = side * LEG[LEG.length - 1]![1] * d.widthS;
    const yaw = side * 6 * (Math.PI / 180);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const ks = d.kid ? 0.95 : 1;
    const xf = (x: number, y: number, z: number): P3 => {
      const zz = z * ks;
      return [cx + x * cy + zz * sy, y, -x * sy + zz * cy];
    };
    const rings: number[][] = [];
    SHOE.forEach(([z, w0, h], k) => {
      const w = w0 * ks;
      const lift = 0.006 * smoothstep(-0.11, -0.165, z);
      const pts: [number, number, number, number][] = [
        // [x, y, 组, 用鞋底色?]
        [w, 0.016, G_SOLE, 1], [w, 0.016, G_SHOE, 0], [w * 0.9, h * 0.6, G_SHOE, 0], [0, h, G_SHOE, 0],
        [-w * 0.9, h * 0.6, G_SHOE, 0], [-w, 0.016, G_SHOE, 0], [-w, 0.016, G_SOLE, 1], [-w * 0.8, 0, G_SOLE, 1],
        [0, 0, G_SOLE, 1], [w * 0.8, 0, G_SOLE, 1],
      ];
      const ring: number[] = [];
      for (const [x, y, gg, sole] of pts) {
        const yy = y > 0.001 ? y + lift : y + lift * 0.6;
        const [u, v] = sole ? regUv(REG.sole, 0.5, 0.5) : regUv(REG.shoe, (x / w) * 0.4 + 0.5, k / SHOE.length);
        ring.push(mb.v(xf(x, yy, z), u, v, gg));
      }
      rings.push(ring);
    });
    for (let k = 0; k + 1 < rings.length; k++) {
      const zc = (SHOE[k]![0] + SHOE[k + 1]![0]) / 2;
      const ref = xf(0, 0.03, zc);
      mb.bridge(rings[k]!, rings[k + 1]!, true, new THREE.Vector3(...ref));
    }
    // 后跟、鞋头封口
    const [su, sv] = regUv(REG.shoe, 0.5, 0.1);
    const heel = mb.v(xf(0, 0.03, SHOE[0]![0] + 0.007), su, sv, G_SHOE);
    mb.fan(rings[0]!, heel, new THREE.Vector3(...xf(0, 0, 1)).sub(new THREE.Vector3(...xf(0, 0, 0))), true);
    const [tu, tv] = regUv(REG.shoe, 0.5, 0.95);
    const toe = mb.v(xf(0, 0.02 + 0.006, SHOE[SHOE.length - 1]![0] - 0.013), tu, tv, G_SHOE);
    mb.fan(rings[rings.length - 1]!, toe, new THREE.Vector3(...xf(0, 0, -1)).sub(new THREE.Vector3(...xf(0, 0, 0))), true);
  }
  const geo = mb.build();
  geo.name = d.kid ? 'crowd.kid' : 'crowd.person';
  return geo;
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

/** 几何高度（脚底到头顶）。 */
export function personHeight(d: PersonDims): number {
  return mapY(CROWN + headRadius(Math.PI / 2, CROWN, d).hair, d);
}
