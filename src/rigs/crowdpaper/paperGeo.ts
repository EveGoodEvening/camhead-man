// owner: WP2
// char2 WP-X：纸扎人的几何（PLAN §3.5）。真纸扎的做法：竹篾扎架、糊纸、手风琴褶。
// - 头：糊纸的圆壳（放样的椭圆，顶上收口，没有开口的盒子），画黑发帽、中分；
// - 脸：一张微凸的椭圆面纸贴在头壳正面（跟着头壳的曲面、离开 2mm），形状就是画好的脸的椭圆；
// - 袍子：A 字形放样，12 道硬棱的手风琴褶（±6mm）；马褂是光滑的放样，下摆有一圈往里的折边；
// - 袖子：带褶的喇叭筒，袖口里伸出扁平的纸手（五个手指的剪纸轮廓，有一点弯）；
// - 瓜皮帽：六瓣帽顶（瓣缝是硬边）+ 红疙瘩；领子是一圈立领。
// 竹篾的“骨架”只画在袍脚、袖口（深色细条），几何不加。
// UV 由调用方给的 rect 映射（paper.ts 的图集格子），这里不关心像素。

import * as THREE from 'three';
import { MeshBuilder, extrudeOutline, interp, lerp, smoothstep, spow, type P3 } from './meshkit';

/** 图集里的一格 → UV 映射 (s, t) ∈ [0,1]²（t = 0 在格子顶上）。 */
export type UvRect = (s: number, t: number) => [number, number];

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- 通用：按角度分区的放样

export interface LoftRow { y: number; a: number; bf: number; bb: number; n?: number; nf?: number; cx?: number; cz?: number }
export interface Sector { from: number; to: number; steps: number; rect: UvRect }

/** 超椭圆圈上 φ 处的点（φ = π/2 正前 −z）。 */
export function rowPoint(r: LoftRow, phi: number, pleat = 0): [number, number, number] {
  const c = Math.cos(phi), s = Math.sin(phi);
  const n = s > 0 ? (r.nf ?? r.n ?? 2) : (r.n ?? 2);
  const e = 2 / n;
  const k = 1 + pleat;
  return [(r.cx ?? 0) + r.a * k * spow(c, e), r.y, (r.cz ?? 0) - (s > 0 ? r.bf : r.bb) * k * spow(s, e)];
}

/**
 * 分区放样：每个扇区自己一套点（UV 不跨区插值），同一光滑组的同位置点法线焊在一起。
 * pleats > 0：手风琴褶——圈上的点交替往外/往里 amp，每个面片单独一列点（褶棱是硬边）。
 * 返回各行的圈（扇区拼起来，供封口/折边用）。
 */
export function sectorLoft(
  mb: MeshBuilder, rows: readonly LoftRow[], sectors: readonly Sector[], o: { group: number; pleats?: number; amp?: number; vOf?: (j: number) => number; inside?: (y: number) => THREE.Vector3 },
): void {
  const vOf = o.vOf ?? ((j: number) => 1 - j / (rows.length - 1));
  const inside = o.inside ?? ((y: number) => new THREE.Vector3(rows[0]!.cx ?? 0, y, rows[0]!.cz ?? 0));
  const pleats = o.pleats ?? 0, amp = o.amp ?? 0;
  for (const sec of sectors) {
    if (pleats > 0) {
      // 褶：把扇区按褶的点切成面片；面片两端点交替 ±amp
      const step = TAU / (pleats * 2);
      const i0 = Math.round(sec.from / step), i1 = Math.round(sec.to / step);
      for (let i = i0; i < i1; i++) {
        const pa = i * step, pb = (i + 1) * step;
        const ka = (i % 2 === 0 ? 1 : -1), kb = -ka;
        const col = (phi: number, k: number) => rows.map((r, j) => {
          const R = Math.max(r.a, r.bf);
          const p = rowPoint(r, phi, (k * amp) / R);
          const [u, v] = sec.rect((phi - sec.from) / (sec.to - sec.from), 1 - vOf(j));
          return mb.v(p, u, v, -1);
        });
        const A = col(pa, ka), B = col(pb, kb);
        for (let j = 0; j + 1 < rows.length; j++) {
          const ref = inside((rows[j]!.y + rows[j + 1]!.y) / 2);
          mb.bridge([A[j]!, B[j]!], [A[j + 1]!, B[j + 1]!], false, ref);
        }
      }
    } else {
      const cols: number[][] = [];
      for (let i = 0; i <= sec.steps; i++) {
        const phi = lerp(sec.from, sec.to, i / sec.steps);
        cols.push(rows.map((r, j) => {
          const [u, v] = sec.rect(i / sec.steps, 1 - vOf(j));
          return mb.v(rowPoint(r, phi), u, v, o.group);
        }));
      }
      for (let j = 0; j + 1 < rows.length; j++) {
        const a = cols.map(c => c[j]!), b = cols.map(c => c[j + 1]!);
        mb.bridge(a, b, false, inside((rows[j]!.y + rows[j + 1]!.y) / 2));
      }
    }
  }
}

/** 前 / 后 / 左右两侧四个扇区（前后各 ±half 弧度）。 */
export function fourSectors(front: UvRect, back: UvRect, side: UvRect, half = 0.9, steps = [7, 7, 5]): Sector[] {
  const F = Math.PI / 2, B = 1.5 * Math.PI;
  return [
    { from: -(Math.PI / 2 - half), to: F - half, steps: steps[2]!, rect: side },
    { from: F - half, to: F + half, steps: steps[0]!, rect: front },
    { from: F + half, to: B - half, steps: steps[2]!, rect: side },
    { from: B - half, to: B + half, steps: steps[1]!, rect: back },
  ];
}

/** 一整圈一个区（u 绕一圈，接缝在后背）。 */
export function wholeRing(rect: UvRect, steps: number): Sector[] {
  return [{ from: -Math.PI / 2, to: 1.5 * Math.PI, steps, rect }];
}

// ---------------------------------------------------------------- 沿轴放样（袖子、腿）

/** 沿一根轴（a → b）的褶筒：每一段半径 rad[k]，pleats 道褶。topCap：上端收成一点（藏在肩里）。返回袖口那一圈的中心与半径。 */
export function pleatTube(
  mb: MeshBuilder, a: THREE.Vector3, b: THREE.Vector3, rad: readonly number[], pleats: number, amp: number, rect: UvRect,
  o?: { topCap?: boolean; lip?: UvRect; squash?: number },
): { end: THREE.Vector3; r: number; T: THREE.Vector3; e1: THREE.Vector3; e2: THREE.Vector3 } {
  const T = new THREE.Vector3().subVectors(b, a).normalize();
  const e1 = new THREE.Vector3(1, 0, 0).addScaledVector(T, -T.x);
  if (e1.lengthSq() < 1e-6) e1.set(0, 0, 1).addScaledVector(T, -T.z);
  e1.normalize();
  const e2 = new THREE.Vector3().crossVectors(T, e1).normalize();
  const sq = o?.squash ?? 1;
  const K = rad.length;
  const centre = (k: number) => a.clone().lerp(b, k / (K - 1));
  const n = pleats * 2;
  // fix2：褶从肩头往下才出来（肩头一圈是圆的，不是一圈尖角）
  const ampAt = (k: number) => (o?.topCap ? amp * Math.min(1, 0.15 + (k / Math.max(1, K - 1)) * 1.7) : amp);
  const pt = (k: number, i: number) => {
    const phi = (i / n) * TAU;
    const r = rad[k]! * (1 + ((i % 2 === 0 ? 1 : -1) * ampAt(k)) / rad[k]!);
    return centre(k).addScaledVector(e1, r * Math.cos(phi)).addScaledVector(e2, r * sq * Math.sin(phi));
  };
  for (let i = 0; i < n; i++) {
    const A: number[] = [], B: number[] = [];
    for (let k = 0; k < K; k++) {
      const pa = pt(k, i), pb = pt(k, i + 1);
      const v = k / (K - 1);
      A.push(mb.v([pa.x, pa.y, pa.z], ...rect(i / n, v), -1));
      B.push(mb.v([pb.x, pb.y, pb.z], ...rect((i + 1) / n, v), -1));
    }
    for (let k = 0; k + 1 < K; k++) mb.bridge([A[k]!, B[k]!], [A[k + 1]!, B[k + 1]!], false, centre(k).add(centre(k + 1)).multiplyScalar(0.5));
    if (o?.topCap) {
      // fix2：圆顶（中间一圈 + 顶点），不是一个尖锥
      const mid = (j: number) => {
        const phi = (j / n) * TAU, r = rad[0]! * 0.74;
        return a.clone().addScaledVector(T, -rad[0]! * 0.36).addScaledVector(e1, r * Math.cos(phi)).addScaledVector(e2, r * sq * Math.sin(phi));
      };
      const ma = mid(i), mb2 = mid(i + 1);
      const mA = mb.v([ma.x, ma.y, ma.z], ...rect(i / n, 0.02), -1), mB = mb.v([mb2.x, mb2.y, mb2.z], ...rect((i + 1) / n, 0.02), -1);
      const top = a.clone().addScaledVector(T, -rad[0]! * 0.55);
      const t = mb.v([top.x, top.y, top.z], ...rect((i + 0.5) / n, 0), -1);
      const ref = centre(0).addScaledVector(T, rad[0]! * 0.5);
      mb.bridge([mA, mB], [A[0]!, B[0]!], false, ref);
      mb.tri(mA, mB, t, ref);
    }
    if (o?.lip) {
      // 袖口往里折一圈（看不见里面的空）
      const pa = pt(K - 1, i), pb = pt(K - 1, i + 1), c = centre(K - 1);
      const ia = c.clone().lerp(pa, 0.62).addScaledVector(T, -0.012), ib = c.clone().lerp(pb, 0.62).addScaledVector(T, -0.012);
      const la = mb.v([pa.x, pa.y, pa.z], ...o.lip(i / n, 0), -1), lb = mb.v([pb.x, pb.y, pb.z], ...o.lip((i + 1) / n, 0), -1);
      const ja = mb.v([ia.x, ia.y, ia.z], ...o.lip(i / n, 1), -1), jb = mb.v([ib.x, ib.y, ib.z], ...o.lip((i + 1) / n, 1), -1);
      const ref = c.clone().addScaledVector(T, 0.05);
      mb.tri(la, lb, jb, ref);
      mb.tri(la, jb, ja, ref);
    }
  }
  return { end: centre(K - 1), r: rad[K - 1]!, T, e1, e2 };
}

// ---------------------------------------------------------------- 纸手（剪纸轮廓）

/** 手的轮廓（局部：x 横、y 往下为负，手腕在 y=0；长约 0.14、宽 0.07）。 */
const HAND: readonly [number, number][] = [
  [0.026, 0], [0.032, -0.035], [0.034, -0.068], [0.033, -0.098], [0.029, -0.112], [0.024, -0.114], [0.019, -0.104], [0.018, -0.078],
  [0.017, -0.11], [0.014, -0.128], [0.009, -0.132], [0.004, -0.126], [0.002, -0.082], [0.0, -0.12], [-0.004, -0.137], [-0.009, -0.139],
  [-0.014, -0.132], [-0.016, -0.083], [-0.018, -0.115], [-0.022, -0.127], [-0.027, -0.127], [-0.031, -0.118], [-0.033, -0.075],
  [-0.034, -0.055], [-0.046, -0.075], [-0.052, -0.07], [-0.05, -0.06], [-0.036, -0.03], [-0.027, 0],
];

/**
 * 扁平纸手：wrist 处，down = 手指方向，across = 手掌宽的方向（拇指在 −across 一侧），厚 4mm；
 * 手指往 curlDir 方向弯一点（纸手“微屈”）。
 */
export function paperHand(
  mb: MeshBuilder, wrist: THREE.Vector3, down: THREE.Vector3, across: THREE.Vector3, curlDir: THREE.Vector3, scale: number, rect: UvRect, group: number,
): void {
  const D = down.clone().normalize(), A = across.clone().normalize();
  const N = curlDir.clone().addScaledVector(D, -curlDir.dot(D)).addScaledVector(A, -curlDir.dot(A)).normalize();
  const xf = (x: number, y: number, z: number): P3 => {
    const len = -y * scale; // 沿手指的距离
    // 0.06 以下开始弯：越往指尖越往 curlDir 偏
    const bend = smoothstep(0.05, 0.14, -y) * 0.35;
    const p = wrist.clone().addScaledVector(D, len * Math.cos(bend)).addScaledVector(N, len * Math.sin(bend) * 0.55 + z).addScaledVector(A, x * scale);
    return [p.x, p.y, p.z];
  };
  extrudeOutline(mb, HAND, 0.004 / scale * scale, xf, (x, y) => rect((x + 0.056) / 0.096, -y / 0.142), group);
}

// ---------------------------------------------------------------- 头壳与脸纸

export interface HeadShape { cy: number; cz: number; rows: LoftRow[] }

/** 纸扎头壳（rows 由下到上，最后一行是头顶点）。 */
export function headShellRows(k: number, centreY: number, scaleW = 1, kid = false): LoftRow[] {
  const ys = [-0.13, -0.115, -0.085, -0.045, 0, 0.045, 0.085, 0.115, 0.13, 0.14];
  const as = [0.055, 0.085, 0.104, 0.112, 0.115, 0.114, 0.105, 0.085, 0.06, 0.0];
  const bf = [0.05, 0.08, 0.093, 0.098, 0.1, 0.099, 0.093, 0.075, 0.052, 0.0];
  const bb = [0.06, 0.085, 0.098, 0.104, 0.106, 0.104, 0.096, 0.08, 0.055, 0.0];
  return ys.map((y, i) => ({
    y: centreY + y * k, a: as[i]! * k * scaleW * (kid ? 1.04 : 1), bf: bf[i]! * k, bb: bb[i]! * k, n: 2.3, nf: 2.9, cz: 0.005 * k,
  }));
}

/** 头壳表面正面的 z（给脸纸投影用）。 */
export function shellFrontZ(rows: readonly LoftRow[], x: number, y: number): number {
  const ys = rows.map(r => r.y);
  const a = interp(ys, rows.map(r => r.a), y), bf = interp(ys, rows.map(r => r.bf), y);
  const nf = rows[0]!.nf ?? 2;
  const t = Math.min(0.999, Math.abs(x) / Math.max(1e-4, a));
  return (rows[0]!.cz ?? 0) - bf * Math.pow(1 - Math.pow(t, nf), 1 / nf);
}

/** 头壳：横圈放样 + 顶点。 */
export function headShell(mb: MeshBuilder, rows: readonly LoftRow[], rect: UvRect, group: number, seg = 24): void {
  const body = rows.slice(0, -1);
  const apexRow = rows[rows.length - 1]!;
  const ringIdx: number[][] = [];
  const yMin = body[0]!.y, yMax = apexRow.y;
  body.forEach(r => {
    const ring: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const phi = -Math.PI / 2 + (i / seg) * TAU; // 接缝在后背
      const [u, v] = rect(i / seg, 1 - (r.y - yMin) / (yMax - yMin));
      ring.push(mb.v(rowPoint(r, phi), u, v, group));
    }
    ringIdx.push(ring);
  });
  const c = (y: number) => new THREE.Vector3(0, y, body[0]!.cz ?? 0);
  for (let j = 0; j + 1 < ringIdx.length; j++) mb.bridge(ringIdx[j]!, ringIdx[j + 1]!, false, c((body[j]!.y + body[j + 1]!.y) / 2));
  const [au, av] = rect(0.5, 0);
  const apex = mb.v([0, apexRow.y, apexRow.cz ?? 0], au, av, group);
  mb.fan(ringIdx[ringIdx.length - 1]!, apex, new THREE.Vector3(0, 1, 0), false);
  // 底：收到脖子里（一个小平底，看不见）
  const [bu, bv] = rect(0.5, 1);
  const bot = mb.v([0, yMin + 0.004, body[0]!.cz ?? 0], bu, bv, group);
  mb.fan(ringIdx[0]!, bot, new THREE.Vector3(0, -1, 0), false);
}

/**
 * 微凸的椭圆脸纸：贴着头壳正面（离开 lift），轮廓 = 格子里画的脸椭圆（中心 (cu, cv)、半径 (ru, rv)，格子坐标 0..1，v 向上）。
 * card：脸纸在世界里的矩形（中心 y、宽、高；格子 (0,0)–(1,1) 对应矩形左下–右上，从正面看）。
 * sub：只要格子里的一块 [u0,u1]×[v0,v1]（黄三爷的鼓瘪小片）。
 */
export function faceCard(
  mb: MeshBuilder, shell: readonly LoftRow[], card: { cy: number; w: number; h: number }, ell: { cu: number; cv: number; ru: number; rv: number },
  uvOf: (u: number, v: number) => [number, number], lift: number, o?: { rings?: number; seg?: number; sub?: [number, number, number, number] },
): void {
  const toWorld = (u: number, v: number, extra = 0): P3 => {
    // 从正面看 u=0 在左边 = +x（rotateY(π) 的平面同一约定）
    const x = (0.5 - u) * card.w, y = card.cy + (v - 0.5) * card.h;
    return [x, y, shellFrontZ(shell, x, y) - lift - extra];
  };
  if (o?.sub) {
    const [u0, u1, v0, v1] = o.sub;
    const nx = 6, ny = 5;
    const idx: number[][] = [];
    for (let j = 0; j <= ny; j++) {
      const row: number[] = [];
      for (let i = 0; i <= nx; i++) {
        const u = lerp(u0, u1, i / nx), v = lerp(v0, v1, j / ny);
        row.push(mb.v(toWorld(u, v), ...uvOf(u, v), 0));
      }
      idx.push(row);
    }
    for (let j = 0; j < ny; j++) mb.bridge(idx[j]!, idx[j + 1]!, false, new THREE.Vector3(0, card.cy, 0.5));
    return;
  }
  const rings = o?.rings ?? 5, seg = o?.seg ?? 16;
  const centre = mb.v(toWorld(ell.cu, ell.cv), ...uvOf(ell.cu, ell.cv), 0);
  let prev: number[] | null = null;
  for (let k = 1; k <= rings; k++) {
    const f = k / rings;
    const ring: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      const u = ell.cu + Math.cos(a) * ell.ru * f, v = ell.cv + Math.sin(a) * ell.rv * f;
      ring.push(mb.v(toWorld(u, v), ...uvOf(u, v), 0));
    }
    if (!prev) {
      for (let i = 0; i < seg; i++) mb.tri(centre, ring[i]!, ring[i + 1]!, new THREE.Vector3(0, card.cy, 0.5));
    } else mb.bridge(prev, ring, false, new THREE.Vector3(0, card.cy, 0.5));
    prev = ring;
  }
}

// ---------------------------------------------------------------- 瓜皮帽

/** 六瓣瓜皮帽 + 帽檐一圈 + 红疙瘩。帽 UV：俯视径向映射到 hat 格子（中心是红点）。 */
export function melonCap(mb: MeshBuilder, k: number, y0: number, a: number, b: number, cz: number, uv: (x: number, z: number) => [number, number]): void {
  const prof = [[0, 1, 1], [0.022, 0.985, 0.985], [0.03, 0.94, 0.94], [0.05, 0.8, 0.8], [0.07, 0.56, 0.56], [0.085, 0.3, 0.3], [0.092, 0.0, 0.0]] as const;
  const gores = 6, per = 3;
  const n = gores * per;
  for (let gI = 0; gI < gores; gI++) {
    const cols: number[][] = [];
    for (let i = 0; i <= per; i++) {
      const phi = ((gI * per + i) / n) * TAU;
      cols.push(prof.map(([dy, ka, kb], j) => {
        // 瓣中间略鼓（纸糊的瓣）
        const bulge = 1 + 0.035 * Math.sin((i / per) * Math.PI) * (j > 1 ? 1 : 0);
        const x = a * ka * bulge * Math.cos(phi) * k, z = cz - b * kb * bulge * Math.sin(phi) * k;
        const y = y0 + dy * k;
        // 帽檐那一行单独一组（与瓣有硬边）
        return mb.v([x, y, z], ...uv(x, z - cz), j <= 1 ? 50 : 51 + gI);
      }));
    }
    for (let j = 0; j + 1 < prof.length; j++) {
      const ra = cols.map(c => c[j]!), rb = cols.map(c => c[j + 1]!);
      mb.bridge(ra, rb, false, new THREE.Vector3(0, y0 + 0.03 * k, cz));
    }
  }
  // 帽口：往里收一圈（压在头壳上）
  const lip: number[] = [], rim: number[] = [];
  for (let i = 0; i <= n; i++) {
    const phi = (i / n) * TAU;
    const x = a * Math.cos(phi) * k, z = cz - b * Math.sin(phi) * k;
    rim.push(mb.v([x, y0, z], ...uv(x, z - cz), 49));
    lip.push(mb.v([x * 0.86, y0 + 0.004 * k, cz + (z - cz) * 0.86], ...uv(x, z - cz), 49));
  }
  mb.bridge(rim, lip, false, new THREE.Vector3(0, y0 + 0.05 * k, cz));
  // 红疙瘩（帽顶的结子）：一颗小的放样珠子
  const top = y0 + 0.092 * k;
  const R = 0.012 * k;
  const beads = [[0, 0.35], [0.3, 0.85], [0.65, 1], [1, 0.75], [1.35, 0.3], [1.5, 0]] as const;
  const rings: number[][] = [];
  const [ku, kv] = uv(0, 0);
  for (const [dy, kr] of beads) {
    const ring: number[] = [];
    for (let i = 0; i <= 8; i++) {
      const phi = (i / 8) * TAU;
      ring.push(mb.v([R * kr * Math.cos(phi), top + dy * R, cz - R * kr * Math.sin(phi)], ku, kv, 60));
    }
    rings.push(ring);
  }
  for (let j = 0; j + 1 < rings.length; j++) mb.bridge(rings[j]!, rings[j + 1]!, false, new THREE.Vector3(0, top + R * 0.7, cz));
}

/** 一圈立领（领口往里翻边到脖子）。 */
export function collarBand(mb: MeshBuilder, y0: number, y1: number, a0: number, b0: number, a1: number, b1: number, cz: number, rect: UvRect, group: number, inner = 0.66): void {
  const seg = 16;
  // fix1：领口往里翻的那一圈一直收到脖子上（原来只收到 78%，领子上面一圈空口、看得见里面的亮边）
  const rows = [
    { y: y0, a: a0, b: b0 }, { y: y1, a: a1, b: b1 }, { y: y1 - 0.001, a: a1 * inner, b: b1 * inner },
  ];
  const rings = rows.map((r, j) => {
    const ring: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const phi = -Math.PI / 2 + (i / seg) * TAU;
      // fix2：往里翻的那一圈取领子中间的布色（原来取到上沿的金边，下巴底下一圈亮环）
      ring.push(mb.v([r.a * Math.cos(phi), r.y, cz - r.b * Math.sin(phi)], ...rect(i / seg, j === 0 ? 1 : j === 2 ? 0.6 : 0.1), j === 2 ? group + 1 : group));
    }
    return ring;
  });
  mb.bridge(rings[0]!, rings[1]!, false, new THREE.Vector3(0, (y0 + y1) / 2, cz));
  mb.bridge(rings[1]!, rings[2]!, false, new THREE.Vector3(0, y1 - 0.03, cz));
}

/** 纸剪的发髻（门童的丫髻）：一片有厚度的剪纸，正面朝前。 */
export function paperTuft(mb: MeshBuilder, base: THREE.Vector3, size: number, tilt: number, rect: UvRect, group: number): void {
  // 一簇往上翘的发髻（火苗形剪纸）：圆底、尖头朝上，系一道红绳的位置在根部
  const outline: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (1 + i / 10); // 下半圆
    outline.push([Math.cos(a) * 0.32, 0.38 + Math.sin(a) * 0.3]);
  }
  outline.push([0.3, 0.55], [0.22, 0.78], [0.08, 0.98], [0.0, 1.06], [-0.04, 0.9], [-0.18, 0.72], [-0.3, 0.52]);
  outline.reverse();
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  extrudeOutline(mb, outline, 0.008, (x, y, z) => {
    const X = x * size, Y = y * size;
    return [base.x + X * ct - Y * st, base.y + X * st + Y * ct, base.z + z];
  }, (x, y) => rect((x + 0.5), 1 - y / 1.1), group);
}
