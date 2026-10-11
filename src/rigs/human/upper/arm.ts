// owner: WP2
// char2 WP-U：胳膊（右；左边镜像）。从躯干的袖窿边圈长出来：边圈 → 几圈 Hermite 过渡（三角肌）→ 上臂、肘、前臂 → 腕 → 手。
// 衣袖就是这张皮本身（袖子下面没有胳膊）：长袖布面离胳膊 6–10mm、肘弯里几道斜褶、袖口（可有袖头）、袖口往里收到手腕；
// 短袖到上臂中段，下沿一道 1.5cm 的折边，往里收到皮肤；挽袖（turnup）在前臂上一道卷边；宽袍袖（robe_top）越往下越宽，
// 袖口里有一圈衬里往上收到手腕（手从袖子里伸出来）。

import * as THREE from 'three';
import { boneIndex } from '../profile';
import { smooth01 } from '../shared';
import type { GarmentSpec } from '../types';
import { torsoV, type UpperDims } from './dims';
import { buildHand } from './hand';
import { MeshBuilder, gauss, hermite, type Skin } from './mesh';
import { ARM_N, type ArmLoop } from './torso';

export interface ArmPieces { sleeve: number; skin: number; torso: number }

export interface ArmOut {
  /** 右臂（含手）的顶点、三角形范围（镜像成左臂用） */
  v0: number; v1: number; t0: number; t1: number;
  tipMiddle: THREE.Vector3; palmCentre: THREE.Vector3;
  /** 量袖子半径用：肩下 0.10s 处袖子外侧的点 */
  sleeveKind: 'short' | 'long' | 'turnup' | 'bell';
}

/** 一圈胳膊的规格：dy = 相对肩关节的高度（负），rx 外侧半径、rz 前后半径；slot：这一圈与上一圈之间的带子归谁。 */
interface ArmRing { dy: number; rx: number; rz: number; piece: 'sleeve' | 'skin'; crease?: boolean; fold?: number; folds?: number; z?: number; lining?: boolean }

const B = (n: Parameters<typeof boneIndex>[0]) => boneIndex(n);

/**
 * 皮肤（肌肉）半径：u = 上臂 0..1（肩 → 肘）、f = 前臂 0..1（肘 → 腕）。返回 [rx, rz]（未乘 s·armK）。
 */
function skinR(u: number | null, f: number | null): [number, number] {
  const lerpTab = (xs: number[], a: number[], b: number[], x: number): [number, number] => {
    let i = 0;
    while (i < xs.length - 2 && x > xs[i + 1]!) i++;
    const t = Math.min(1, Math.max(0, (x - xs[i]!) / (xs[i + 1]! - xs[i]!)));
    const e = t * t * (3 - 2 * t);
    return [a[i]! + (a[i + 1]! - a[i]!) * e, b[i]! + (b[i + 1]! - b[i]!) * e];
  };
  if (u !== null) return lerpTab([0.41, 0.55, 0.72, 0.88, 1], [0.0465, 0.042, 0.0385, 0.0345, 0.033], [0.0495, 0.0465, 0.0445, 0.038, 0.0355], u);
  return lerpTab([0, 0.14, 0.33, 0.57, 0.8, 1, 1.1], [0.033, 0.0385, 0.0356, 0.029, 0.0236, 0.021, 0.021], [0.0355, 0.0362, 0.0332, 0.029, 0.0268, 0.028, 0.028], f!);
}

export function buildArm(mb: MeshBuilder, d: UpperDims, g: Readonly<GarmentSpec>, specSleeves: 'short' | 'long', loop: ArmLoop, pc: ArmPieces): ArmOut {
  const torsoVOf = (y: number) => torsoV(d, y);
  const s = d.s;
  const b = d.bind;
  const xS = d.xS, yS = d.yS;
  const dyE = b.elbowR[1] - yS, dyW = b.wristR[1] - yS;
  const K = s * d.armK;
  const kind: ArmOut['sleeveKind'] = g.top === 'robe_top' ? 'bell' : specSleeves === 'short' ? 'short' : g.cuffs === 'turnup' ? 'turnup' : 'long';
  const pad = d.pad;
  const U = (u: number) => u * dyE;
  const Fq = (f: number) => dyE + f * (dyW - dyE);
  // 袖子（布）对胳膊粗细不那么敏感：布面按 armK^0.3 缩放（儿童照旧）
  const Ksl = s * (d.child ? d.armK : Math.pow(d.armK, 0.3));
  const sk = (dy: number, k = K): [number, number] => {
    const [rx, rz] = dy >= dyE ? skinR(dy / dyE, null) : skinR(null, (dy - dyE) / (dyW - dyE));
    return [rx * k, rz * k];
  };
  const ring = (dy: number, off: number, piece: ArmRing['piece'], o: Partial<ArmRing> = {}): ArmRing => {
    const [rx, rz] = sk(dy, piece === 'sleeve' && off > 0.004 * s ? Ksl : K);
    return { dy, rx: rx + off, rz: rz + off, piece, ...o };
  };
  // ---------------------------------------------------------------- 各种袖子
  const A0 = U(0.41);
  const R: ArmRing[] = [];
  const cuffBand = g.cuffs === 'band';
  if (kind === 'short') {
    const off = 0.0158 * s + pad * 0.5;
    const hem = U(0.57);
    R.push(ring(A0, off, 'sleeve'));
    R.push(ring(U(0.49), off + 0.0006 * s, 'sleeve'));
    // 折边：上沿往外一步 1.5mm，下沿硬边，往里收到皮肤
    R.push(ring(U(0.505), off + 0.0006 * s, 'sleeve', { crease: true }));
    // fix3：折边不往外撇（原来下沿比袖筒大 2.8mm，趴桌时从斜上方看袖口是一圈翘起来的尖边）
    R.push(ring(U(0.515), off + 0.0012 * s, 'sleeve'));
    R.push(ring(hem, off + 0.0011 * s, 'sleeve', { crease: true }));
    // 折边底面往里、略往下收（底面朝下朝外，没有翻回去的面）
    R.push(ring(hem - 0.004 * s, 0.0016 * s, 'sleeve'));
    // fix3：肘上下多几圈（弯肘 1.9 rad 趴桌时肘尖不再折成一个尖角）
    for (const u of [0.7, 0.8, 0.88, 0.95]) R.push(ring(U(u), 0, 'skin'));
    R.push(ring(dyE, 0, 'skin'));
    for (const f of [0.07, 0.15, 0.33, 0.57, 0.8]) R.push(ring(Fq(f), 0, 'skin'));
    R.push(ring(Fq(1), 0, 'skin'));
  } else if (kind === 'long' || kind === 'turnup') {
    const off = (u: number) => (0.0112 - 0.003 * u) * s + pad * 0.5;
    R.push(ring(A0, off(0), 'sleeve'));
    R.push(ring(U(0.58), off(0.1), 'sleeve'));
    R.push(ring(U(0.76), off(0.2), 'sleeve', { fold: 1 }));
    R.push(ring(U(0.9), off(0.3), 'sleeve', { fold: 1.4 }));
    R.push(ring(dyE, off(0.4), 'sleeve', { fold: 1.4 }));
    if (kind === 'turnup') {
      // 挽到前臂：肘下一道卷边（两圈鼓、一圈收），往里收到皮肤
      R.push(ring(Fq(0.08), off(0.5), 'sleeve', { fold: 0.8 }));
      R.push(ring(Fq(0.12), off(0.5) + 0.0035 * s, 'sleeve', { crease: true }));
      R.push(ring(Fq(0.19), off(0.5) + 0.0085 * s, 'sleeve'));
      R.push(ring(Fq(0.28), off(0.5) + 0.0078 * s, 'sleeve', { crease: true }));
      R.push(ring(Fq(0.295), 0.0015 * s, 'sleeve'));
      for (const f of [0.4, 0.6, 0.8, 1]) R.push(ring(Fq(f), 0, 'skin'));
    } else {
      R.push(ring(Fq(0.13), off(0.55), 'sleeve', { fold: 1 }));
      R.push(ring(Fq(0.36), off(0.7), 'sleeve'));
      R.push(ring(Fq(0.62), off(0.85), 'sleeve'));
      const endDy = dyW - 0.007 * s;
      const [wrx, wrz] = sk(dyW);
      if (cuffBand) {
        const top = dyW + 0.022 * s;
        R.push(ring(top, off(0.95), 'sleeve', { crease: true }));
        R.push({ dy: top, rx: wrx + 0.0098 * s + pad, rz: wrz + 0.0094 * s + pad, piece: 'sleeve' });
        R.push({ dy: endDy, rx: wrx + 0.0102 * s + pad, rz: wrz + 0.0098 * s + pad, piece: 'sleeve', crease: true });
      } else {
        R.push(ring(dyW + 0.03 * s, off(0.92), 'sleeve'));
        R.push({ dy: endDy, rx: wrx + 0.0088 * s + pad, rz: wrz + 0.0088 * s + pad, piece: 'sleeve', crease: true });
      }
      // 袖口往里收：一圈窄窄的内沿，再到手腕的皮肤
      R.push({ dy: endDy - 0.0025 * s, rx: wrx + 0.0016 * s, rz: wrz + 0.0016 * s, piece: 'sleeve' });
      R.push({ dy: endDy - 0.0045 * s, rx: wrx * 1.0, rz: wrz * 1.04, piece: 'skin' });
    }
  } else {
    // 宽袍袖：越往下越宽、几道垂褶；袖口一道边，衬里往上收到前臂（看得见袖子里的手腕）
    const off = (u: number) => (0.012 + 0.07 * u * u) * s;
    R.push(ring(A0, off(0), 'sleeve'));
    R.push(ring(U(0.62), off(0.16), 'sleeve', { folds: 0.3 }));
    R.push(ring(U(0.85), off(0.3), 'sleeve', { folds: 0.5 }));
    R.push(ring(dyE, off(0.45), 'sleeve', { folds: 0.7 }));
    R.push(ring(Fq(0.3), off(0.65), 'sleeve', { folds: 0.85 }));
    R.push(ring(Fq(0.62), off(0.85), 'sleeve', { folds: 1 }));
    const endDy = Fq(1.02);
    R.push(ring(Fq(0.88), off(0.97), 'sleeve', { folds: 1, crease: true }));
    R.push(ring(Fq(0.88), off(0.97) + 0.0035 * s, 'sleeve', { folds: 1 }));
    R.push(ring(endDy, off(1.0) + 0.0035 * s, 'sleeve', { folds: 1, crease: true }));
    R.push(ring(endDy + 0.004 * s, off(1.0) - 0.004 * s, 'sleeve', { folds: 1, lining: true }));
    R.push(ring(Fq(0.78), off(0.5), 'sleeve', { lining: true }));
    R.push(ring(Fq(0.6), 0.0012 * s, 'sleeve', { lining: true }));
    R.push(ring(Fq(0.62), 0, 'skin'));
    R.push(ring(Fq(0.82), 0, 'skin'));
    R.push(ring(Fq(1), 0, 'skin'));
  }

  // ---------------------------------------------------------------- 角度：边圈按弧长分布，往下几圈渐渐变成均匀
  const n = ARM_N;
  const lp = loop.pos;
  const cum = [0];
  for (let j = 1; j <= n; j++) cum.push(cum[j - 1]! + lp[j % n]!.distanceTo(lp[j - 1]!));
  const thArc = cum.slice(0, n).map(c => (c / cum[n]!) * Math.PI * 2);
  const thUni = Array.from({ length: n }, (_, j) => (j / n) * Math.PI * 2);
  const theta = (j: number, k: number) => thArc[j]! + (thUni[j]! - thArc[j]!) * k;

  const shR = B('shoulderR'), elR = B('elbowR'), wrR = B('wristR'), sp = B('spine');
  /** 胳膊圈的蒙皮：肘上下 3cm 混合（肘背一侧偏下，弯肘时不塌）；前臂末端带一点腕骨。 */
  const armSkin = (dy: number, z: number, sleeveEnd: boolean): Skin => {
    const back = smooth01(-0.3, 0.6, z / (0.035 * K));
    // fix3：混合带加宽到肘上下 ~4.5cm（大角度弯肘时肘尖圆过去，不是一个尖）
    const hi = dyE + 0.045 * s + 0.012 * s * back, lo = dyE - 0.042 * s + 0.02 * s * back;
    const we = smooth01(hi, lo, dy);
    let ww = 0.5 * smooth01(dyW + 0.07 * s, dyW, dy);
    if (sleeveEnd) ww = Math.min(ww, 0.3);
    return [[shR, 1 - we], [elR, we * (1 - ww)], [wrR, we * ww]];
  };

  const v0 = mb.count, t0 = mb.triCount;
  // 边圈的复制（胳膊自己的 UV）
  // 袖窿边上的头两圈过渡属于衣身（衣身料、衣身贴图 UV；袖子的接缝在三角肌上，像真衬衫的袖窿缝）
  const torsoUv = (j: number, y: number): number => { void y; return loop.u[j]!; };
  const ring0 = mb.ring(lp, torsoVOf(lp[0]!.y), (_p, j) => loop.skin[j]!, j => torsoUv(j % n, 0));
  for (let j = 0; j <= n; j++) mb.uv[(ring0[j]!) * 2 + 1] = torsoVOf(lp[j % n]!.y);
  const rings: { idx: number[]; dy: number; piece: number }[] = [];
  // 三角肌：边圈 → A0 的 Hermite 过渡（4 圈）
  const a0 = R[0]!;
  const ringPts = (r: ArmRing, k: number): THREE.Vector3[] => {
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j < n; j++) {
      const t = theta(j, k);
      const c = Math.cos(t), sn = Math.sin(t);
      let rx = r.rx, rz = r.rz;
      let dr = 0;
      // 肘弯里（前、内侧）几道斜褶
      if (r.fold) dr += 0.0036 * s * r.fold * Math.sin(3 * t + r.dy * 70) * smooth01(-0.2, 0.5, sn) * smooth01(0.3, -0.5, c);
      // 宽袖的垂褶
      if (r.folds) dr += 0.006 * s * r.folds * Math.sin(6 * t + 0.6) * (r.lining ? 0.6 : 1);
      // 二头肌：前面略鼓（男人）
      if (r.piece === 'skin' && !d.female && r.dy > dyE && r.dy < U(0.85)) dr += 0.0018 * s * Math.max(0, sn) * gauss(r.dy - U(0.68), 0.05 * s);
      if (c < 0) rx *= 0.97;
      pts.push(new THREE.Vector3(xS + c * (rx + dr), yS + r.dy, (r.z ?? 0) - sn * (rz + dr)));
    }
    return pts;
  };
  const A0pts = ringPts(a0, 0.25);
  const yTop = Math.max(...lp.map(p => p.y)), yBot = Math.min(...lp.map(p => p.y));
  // 边圈切线沿圈平滑几遍（角上不出折痕）
  let tan = loop.tan.map(v => v.clone());
  for (let it = 0; it < 3; it++) tan = tan.map((v, j) => v.clone().multiplyScalar(2).add(tan[(j + 1) % n]!).add(tan[(j + n - 1) % n]!).normalize());
  const cap: number[][] = [ring0];
  const CAP = [0.2, 0.42, 0.64, 0.84];
  let vAcc = 0;
  for (const tau of CAP) {
    const pts = lp.map((L, j) => {
      const P1 = A0pts[j]!;
      const dist = L.distanceTo(P1);
      const up = smooth01(yBot, yTop, L.y);
      const k0 = 0.25 + (d.female ? 0.5 : d.old ? 0.68 : 0.8) * up;
      const m0 = tan[j]!.clone().multiplyScalar(dist * k0);
      const m1 = new THREE.Vector3(0, -dist * (0.9 + 0.25 * up), 0);
      return hermite(L, m0, P1, m1, tau);
    });
    vAcc += 0.04;
    cap.push(mb.ring(pts, vAcc, (_p, j) => {
      const w = 0.35 + 0.65 * smooth01(0, 1, tau);
      const base = loop.skin[j]!;
      const rest = base.filter(([bn]) => bn !== shR);
      const restSum = rest.reduce((a, [, w2]) => a + w2, 0) || 1;
      return [[shR, w], ...rest.map(([bn, w2]) => [bn, ((1 - w) * w2) / restSum] as const)];
    }));
  }
  // 头两带（边圈 → τ0.2 → τ0.42）归衣身：这两圈用衣身 UV；τ0.42 复制一份袖子 UV 的接着往下
  const TORSO_BANDS = 2;
  for (let k = 0; k <= TORSO_BANDS; k++) {
    const r = cap[k]!;
    for (let j = 0; j <= n; j++) {
      mb.uv[r[j]! * 2] = torsoUv(j % n, 0);
      mb.uv[r[j]! * 2 + 1] = torsoVOf(mb.pos[r[j]! * 3 + 1]!);
    }
  }
  const seamDup = mb.dupRing(cap[TORSO_BANDS]!, j => [j / n, 0.08]);
  rings.push({ idx: cap[0]!, dy: 0, piece: pc.torso });
  for (let k = 1; k <= TORSO_BANDS; k++) rings.push({ idx: cap[k]!, dy: 0, piece: pc.torso });
  rings.push({ idx: seamDup, dy: 0, piece: -1 });
  for (let k = TORSO_BANDS + 1; k < cap.length; k++) rings.push({ idx: cap[k]!, dy: 0, piece: pc.sleeve });
  // 胳膊各圈
  let prevDy = a0.dy;
  R.forEach((r, k) => {
    const relax = Math.min(1, 0.25 + 0.3 * k);
    const pts = ringPts(r, relax);
    vAcc += Math.abs(prevDy - r.dy) / (0.6 * s) + 0.01;
    prevDy = r.dy;
    const sleeveEnd = r.piece === 'sleeve' && r.dy < dyW + 0.03 * s;
    const idx = mb.ring(pts, Math.min(1, vAcc), p => armSkin(r.dy, p.z, sleeveEnd));
    rings.push({ idx, dy: r.dy, piece: r.piece === 'sleeve' ? pc.sleeve : pc.skin });
    if (r.crease) rings.push({ idx: mb.dupRing(idx), dy: r.dy, piece: -1 });
  });
  for (let k = 0; k + 1 < rings.length; k++) {
    const next = rings[k + 1]!;
    if (next.piece === -1) continue; // 硬边：复制圈之间不连
    mb.strip(rings[k]!.idx, next.idx, next.piece);
  }
  mb.orient(t0, mb.triCount, q => new THREE.Vector3(xS, q.y, 0));

  // ---------------------------------------------------------------- 手
  const last = rings[rings.length - 1]!.idx;
  const wrist = new THREE.Vector3(b.wristR[0], b.wristR[1], b.wristR[2]);
  const hand = buildHand(mb, d, last, wrist, pc.skin);
  void sp;
  return { v0, v1: mb.count, t0, t1: mb.triCount, tipMiddle: hand.tipMiddle, palmCentre: hand.palmCentre, sleeveKind: kind };
}
