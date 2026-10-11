// owner: WP2
// char2 WP-L：裤子——从 WAIST（或皮带下沿）一整片放样到裆，在裆部分成两条裤腿，一直到裤脚（PLAN §3.3）。
//
// 拓扑：骨盆段每圈 24 点（同 WAIST 的约定）；在“分裆圈”（臀线 hipJ − 0.14·Lth）上，右半圈（下标 18..23、0..6）就是右裤腿第 0 圈的外半边，
// 左半圈镜像给左裤腿；裤腿第 0 圈的内半边（下标 7..17）是 x = 0 平面里的一条裆弧（前 0.80 → 后 0.78）。两条裤腿的裆弧位置相同、
// 权重对称（hips + hipL/hipR 各半），走路时裆不会裂开。往下几圈从“分裆圈 + 裆弧”过渡到大腿椭圆，再到膝、小腿、裤脚。
// 裤脚：一圈硬边 + 往里折 1.2cm 的里子（从下往上看不见空心），可选 4cm 翻边。没有骨盆块、没有大腿球头、没有里面的腿。
// 蒙皮：腰 hips/spine；裆以下 hips → 大腿骨在 ~10cm 内过渡；膝在 8cm 内过渡，膝前过渡中心下移（坐下时膝前保持圆，不塌成 0.7）。

import * as THREE from 'three';
import { loftRings, setSkin, smooth01, snapRing } from '../shared';
import type { BoneName, BuildCtx, SkinnedPiece } from '../types';
import { asymRing, inflateRing, lerpRing, mirrorX, shiftRing, table, W, type LowerStyle } from './geom';

const N = 24;

/** 腿的各项尺寸（右腿、根空间；左腿镜像）。 */
export interface LegFrame {
  hx: number; hipJ: number; kneeY: number; ankY: number; Lth: number;
  ySplit: number; yCrotchF: number; yCrotchB: number; yT: number; yHem: number;
}

export function legFrame(ctx: BuildCtx): LegFrame {
  const b = ctx.layout.bind, s = ctx.s;
  const hipJ = b.hipR[1], kneeY = b.kneeR[1], ankY = b.ankleR[1];
  const Lth = hipJ - kneeY;
  return {
    hx: b.hipR[0], hipJ, kneeY, ankY, Lth,
    ySplit: hipJ - 0.14 * Lth, yCrotchF: hipJ - 0.28 * Lth, yCrotchB: hipJ - 0.32 * Lth,
    yT: hipJ - 0.47 * Lth, yHem: ankY + 0.011 * s,
  };
}

/** 裤腿各圈（右腿）的截面：y → 圈心 x 偏移（相对 hx）、z、半宽 a、前深 bf、后深 bb（米，已乘 s 与体型）。 */
function legSection(ctx: BuildCtx, f: LegFrame, st: LowerStyle) {
  const s = ctx.s, p = ctx.profile;
  const child = p.age === 'child';
  const female = p.sex === 'f' && !child;
  // fix2：孩子的腿粗一点（短而圆的腿，不是缩小的大人腿）
  const kw = s * p.bw * (female ? 0.93 : 1) * (child ? 0.95 : 1);
  const kd = s * Math.sqrt(p.bd) * (female ? 0.94 : 1) * (child ? 1.06 : 1);
  const bag = st.baggyKnee ? 1 : 0;
  // 纵向坐标：u = 0 大腿根（yT）、1 膝、2 裤脚（两段各自归一）。九十年代的直筒裤：膝下几乎不收，裤脚前面堆两道横褶（1.92、1.96）
  const us = [0, 0.3, 0.6, 0.82, 0.92, 0.975, 1.0, 1.025, 1.08, 1.27, 1.5, 1.72, 1.86, 1.92, 1.96, 2.0];
  const A = [0.083, 0.079, 0.072, 0.066, 0.0625, 0.061, 0.0605, 0.0605, 0.061, 0.0615, 0.0615, 0.062, 0.0625, 0.0642, 0.0626, 0.0636];
  const BF = [0.078, 0.075, 0.07, 0.066, 0.065, 0.0655, 0.0655, 0.065, 0.0635, 0.062, 0.062, 0.0625, 0.063, 0.0655, 0.0632, 0.064];
  const BB = [0.084, 0.078, 0.071, 0.065, 0.0615, 0.0605, 0.06, 0.0603, 0.0615, 0.0638, 0.0628, 0.0615, 0.061, 0.0622, 0.061, 0.0618];
  const CX = [-0.004, -0.005, -0.006, -0.0065, -0.0068, -0.007, -0.007, -0.007, -0.007, -0.0065, -0.0055, -0.005, -0.0048, -0.0046, -0.0045, -0.0045];
  const CZ = [0.002, 0.001, 0.0, -0.002, -0.003, -0.004, -0.004, -0.004, -0.003, -0.002, -0.001, -0.0008, -0.0006, -0.0012, -0.0005, -0.0004];
  const a = table(us, A), bf = table(us, BF), bb = table(us, BB), cx = table(us, CX), cz = table(us, CZ);
  const yOf = (u: number) => (u <= 1 ? f.yT - (f.yT - f.kneeY) * u : f.kneeY - (f.kneeY - f.yHem) * (u - 1));
  const knee = (u: number) => Math.exp(-Math.pow((u - 1) / 0.17, 2));
  return {
    us, yOf,
    ring: (u: number) => {
      const kb = bag * knee(u);
      return asymRing(f.hx + cx(u) * s, yOf(u), cz(u) * s - 0.004 * kb * s, a(u) * kw + 0.005 * kb * s, bf(u) * kd + 0.009 * kb * s + 0.003 * bag * s, bb(u) * kd + 0.004 * bag * s, N, 2.35);
    },
  };
}

/** 骨盆段的一圈：f = 0 在 WAIST、1 在分裆圈。 */
function pelvisRing(ctx: BuildCtx, fr: LegFrame, f: number): Float32Array {
  const W0 = ctx.seams.WAIST, s = ctx.s, p = ctx.profile;
  const c = W0.centre;
  const aW = W0.pos[0]! - c[0];
  const bW = W0.pos[18 * 3 + 2]! - c[2];
  const bellyW = (c[2] - W0.pos[6 * 3 + 2]!) / bW - 1;
  const child = p.age === 'child';
  const female = p.sex === 'f' && !child;
  const aH = child ? aW * 1.04 : Math.max(aW * 1.02, 0.171 * s * p.bw * p.hipW);
  const bfH = (child ? 0.095 : 0.097) * s * p.bd;
  const bbH = (female ? 0.126 : child ? 0.105 : 0.116) * s * Math.sqrt(p.bd);
  const yW = c[1];
  const y = yW - (yW - fr.ySplit) * f;
  const ease = Math.pow(Math.sin((f * Math.PI) / 2), 0.85);
  const a = aW + (aH - aW) * ease;
  const bf = bW + (bfH - bW) * f;
  const bb = bW + (bbH - bW) * Math.sin((Math.min(1, f * 1.15) * Math.PI) / 2);
  const belly = bellyW * Math.pow(1 - f, 1.6);
  return asymRing(c[0], y, c[2], a, bf, bb, N, 3 - 0.55 * f, belly);
}

/**
 * 裤子：一个 SkinnedPiece（骨盆 + 两条裤腿，pants 槽）。topY = 顶圈高度（没有皮带 = WAIST，此时顶圈精确贴 WAIST；
 * 有皮带 = 皮带下沿，顶圈就是皮带下沿那一圈）。
 */
export function buildTrousers(ctx: BuildCtx, st: LowerStyle, topFrac: number): SkinnedPiece {
  const s = ctx.s;
  const fr = legFrame(ctx);
  const sec = legSection(ctx, fr, st);
  // ---------------- 骨盆段（从 topFrac 到分裆圈）
  const pelF = [topFrac, ...[0.22, 0.45, 0.68, 0.86, 1].filter(x => x > topFrac + 0.05)];
  const pel = pelF.map(f => pelvisRing(ctx, fr, f));
  const split = pel[pel.length - 1]!;
  // ---------------- 右腿第 0 圈：外半边 = 分裆圈右半，内半边 = 裆弧（x = 0）
  const r0 = new Float32Array(N * 3);
  const zF = split[6 * 3 + 2]!, zB = split[18 * 3 + 2]!;
  for (let i = 0; i < N; i++) {
    if (i <= 6 || i >= 18) {
      r0.set([split[i * 3]!, split[i * 3 + 1]!, split[i * 3 + 2]!], i * 3);
      continue;
    }
    const k = (i - 6) / 12; // 0 前 → 1 后
    const psi = Math.PI * k;
    const z = (zF + zB) / 2 - ((zB - zF) / 2) * Math.cos(psi);
    const yLow = fr.yCrotchF + (fr.yCrotchB - fr.yCrotchF) * k;
    const y = fr.ySplit - (fr.ySplit - yLow) * Math.pow(Math.sin(psi), 0.55);
    r0.set([0, y, z], i * 3);
  }
  // ---------------- 过渡到大腿根（yT 那圈）
  const T = sec.ring(0);
  const legRows: Float32Array[] = [r0];
  for (const [tau, glute] of [[0.2, 0.004], [0.42, 0.001], [0.68, -0.005]] as const) {
    const r = lerpRing(r0, T, tau < 0.5 ? tau * 0.9 : tau);
    // 臀下沿（臀褶，后片往里收一点）与髋侧（外侧略圆）。后片的臀底往大腿根收得快一些：
    // 坐下时臀底的点跟着大腿转到身下，离髋轴越远落得越低——座面（大腿下最低点）要在 land.leg.seatY ±1.5cm
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const back = Math.pow(Math.max(0, -Math.sin(t)), 1.5), out = Math.max(0, Math.cos(t));
      const pull = 0.35 * back * (1 - tau);
      r[i * 3 + 2] = r[i * 3 + 2]! + (T[i * 3 + 2]! - r[i * 3 + 2]!) * pull;
      const bump = Math.sin(Math.PI * tau);
      r[i * 3 + 2] = r[i * 3 + 2]! + back * glute * s;
      r[i * 3] = r[i * 3]! + out * 0.003 * s * bump;
    }
    legRows.push(r);
  }
  legRows.push(T);
  for (const u of sec.us.slice(1)) legRows.push(sec.ring(u));
  // 裤线：前片中线（下标 6）鼓 1.2mm，从大腿中段到裤脚
  if (st.crease) {
    for (let j = 5; j < legRows.length; j++) {
      const r = legRows[j]!;
      const k = Math.min(1, (j - 4) / 3) * 0.0013 * s;
      const cx = (r[0]! + r[12 * 3]!) / 2, cz = (r[6 * 3 + 2]! + r[18 * 3 + 2]!) / 2;
      for (const [i, w] of [[6, 1], [5, 0.25], [7, 0.25]] as const) {
        const dx = r[i * 3]! - cx, dz = r[i * 3 + 2]! - cz, l = Math.hypot(dx, dz) || 1;
        r[i * 3] = r[i * 3]! + (dx / l) * k * w;
        r[i * 3 + 2] = r[i * 3 + 2]! + (dz / l) * k * w;
      }
    }
  }
  // 膝盖补丁：膝前一块凸起 2mm、边缘陡（工人）
  if (st.kneePatch) {
    const ku = sec.us.indexOf(1);
    for (let j = 0; j < legRows.length; j++) {
      const u = j >= 4 ? sec.us[j - 4]! : -1;
      if (u < 0) continue;
      const kv = Math.abs(u - 1) < 0.11 ? 1 : Math.abs(u - 1) < 0.14 ? 0.5 : 0;
      if (!kv || ku < 0) continue;
      legRows[j] = inflateRing(legRows[j]!, i => (i >= 3 && i <= 9 ? (i === 3 || i === 9 ? 0.5 : 1) * kv * 0.0022 * s : 0));
    }
  }
  // ---------------- 裤脚：硬边 + 里子（或翻边）
  const hem = legRows[legRows.length - 1]!;
  const tail: Float32Array[] = [];
  if (st.turnup) {
    const h = 0.04 * s;
    // 翻边上沿往外 4mm：先在上沿处重复一圈（硬边），再沿翻边往下
    const topY = fr.yHem + h;
    const idx = legRows.findIndex((r, j) => j > 4 && r[1]! < topY);
    const cut = idx > 0 ? idx : legRows.length - 1;
    legRows.splice(cut);
    const at = shiftRing(hem, h);
    legRows.push(at, Float32Array.from(at));
    tail.push(inflateRing(shiftRing(at, -0.002 * s), 0.0048 * s), inflateRing(hem, 0.0042 * s));
  }
  legRows.push(...tail);
  const last = legRows[legRows.length - 1]!;
  legRows.push(Float32Array.from(last), inflateRing(shiftRing(hem, 0.012 * s), -0.0045 * s));
  // ---------------- 拼几何：骨盆（24）+ 右腿 + 左腿（镜像）
  const vPel = pel.map((_, j) => 0.8 + 0.2 * (1 - pelF[j]!));
  const yTop = fr.ySplit, yBot = fr.yHem;
  const vLeg = legRows.map(r => 0.03 + 0.77 * Math.min(1, Math.max(0, (r[1]! - yBot) / (yTop - yBot))));
  const gPel = loftRings([...pel].reverse(), { v: [...vPel].reverse() });
  const gR = loftRings(legRows, { v: vLeg });
  const gL = loftRings(legRows.map(mirrorX), { v: vLeg });
  const geo = ctx.track(mergeIndexed([gPel, gR, gL]));
  for (const g of [gPel, gR, gL]) g.dispose();
  setSkin(geo, p => trouserWeights(ctx, fr, p));
  // 顶圈：没有皮带时精确贴 WAIST（位置、法线、蒙皮）
  if (topFrac === 0) snapRing(geo, (pel.length - 1) * (N + 1), ctx.seams.WAIST, { dupSeam: true });
  return { kind: 'skinned', name: 'trousers', slot: 'pants', geo };
}

/** 裤子的蒙皮（按位置，所以重合的点——裆弧、分裆圈——两边权重一样）。 */
export function trouserWeights(ctx: BuildCtx, fr: LegFrame, p: THREE.Vector3): [number, number][] {
  const s = ctx.s;
  const yW = ctx.seams.WAIST.centre[1];
  if (p.y > fr.ySplit + 1e-5) {
    const sp = 0.35 * smooth01(yW - 0.05 * s, yW, p.y);
    return W([['hips', 1 - sp], ['spine', sp]]);
  }
  const side: 'L' | 'R' = p.x >= 0 ? 'R' : 'L';
  const other: 'L' | 'R' = side === 'R' ? 'L' : 'R';
  const sym = 1 - smooth01(0, 0.03 * s, Math.abs(p.x));
  // 大腿权重：前片在分裆圈下 ~11cm 内、后片（臀）稍快
  const back = smooth01(-0.02 * s, 0.05 * s, p.z);
  const span = (0.11 - 0.03 * back) * s;
  const th = smooth01(0, span, fr.ySplit - p.y);
  // 膝：8cm 过渡；膝前的过渡中心往下移，坐下（膝 −π/2）时膝前是圆角而不是塌成 0.7 倍
  const front = smooth01(0.01 * s, -0.04 * s, p.z);
  const c = fr.kneeY - front * 0.045 * s + (1 - front) * 0.01 * s;
  const kn = smooth01(c + 0.04 * s, c - 0.04 * s, p.y);
  const hipOwn = `hip${side}` as BoneName, hipOther = `hip${other}` as BoneName;
  const kneeOwn = `knee${side}` as BoneName;
  return W([
    ['hips', 1 - th],
    [hipOwn, th * (1 - sym / 2) * (1 - kn)],
    [hipOther, th * (sym / 2)],
    [kneeOwn, th * (1 - sym / 2) * kn],
  ]);
}

/** 合并几个索引几何（position/normal/uv），保持索引。 */
export function mergeIndexed(gs: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const g of gs) { nv += g.attributes.position!.count; ni += g.index!.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of gs) {
    const c = g.attributes.position!.count;
    pos.set(g.attributes.position!.array as Float32Array, ov * 3);
    nor.set(g.attributes.normal!.array as Float32Array, ov * 3);
    uv.set(g.attributes.uv!.array as Float32Array, ov * 2);
    const ix = g.index!.array;
    for (let k = 0; k < ix.length; k++) idx[oi + k] = ix[k]! + ov;
    ov += c;
    oi += ix.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
