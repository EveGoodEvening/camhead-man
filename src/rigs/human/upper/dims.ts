// owner: WP2
// char2 WP-U：上身尺寸（按体型 profile、关节布局、接缝、服装款式）与躯干外形函数（衬衫外表面）。
// 坐标：人偶根空间、绑定姿势（脚底在原点、面朝 -z、右手 +x）。t = 圈上的角度（0 = +x、π/2 = 正前 -z、π = -x、3π/2 = 后背），
// 同 squircleLoft 的 u = t / 2π；h = 躯干高度参数：0 = WAIST 接缝、1 = 肩顶那一圈（肩关节上 0.025s）。

import * as THREE from 'three';
import type { BodyProfile, GarmentSpec, HumanoidSpec, JointLayout, Seams } from '../types';
import { sgnPow } from '../shared';
import { gauss, spline } from './mesh';

export interface UpperDims {
  s: number;
  female: boolean; child: boolean; old: boolean; deity: boolean; stout: boolean; hunch: boolean;
  /** 驼背程度 0..1（profile.kyphosis / 0.25） */
  kyph: number;
  W: number; D: number;
  /** 接缝 WAIST 的 y、半宽、前/后半深、中心 z */
  yW: number; aW: number; bWf: number; bWb: number;
  /** 腰节（spine 关节）的 y */
  ySpine: number;
  /** 肩关节（右）x、y；肩顶圈 y；领口（neck 关节）y */
  xS: number; yS: number; ySt: number; yC: number;
  /** 腋下那一圈的 h（袖窿下沿） */
  hA: number;
  /** 衣服离身体的厚度（棉袄、夹克更厚） */
  pad: number;
  /** 胳膊粗细系数、手的大小系数 */
  armK: number; handK: number;
  /** 胳膊上段（A0 处）的半径：x（外侧）、z（前后） */
  armRx: number; armRz: number;
  /** 领根圈（脖子根）：中心、半轴、前低后高的倾角 */
  nbC: THREE.Vector3; nbA: number; nbB: number; nbTilt: number;
  /** NECK_TOP 半轴（a = x，b = z 前） */
  ntA: number; ntB: number;
  /** 关节绑定位置 */
  bind: JointLayout['bind'];
}

export function upperDims(_spec: Readonly<HumanoidSpec>, p: Readonly<BodyProfile>, s: number, layout: Readonly<JointLayout>, seams: Readonly<Seams>, g?: Readonly<GarmentSpec>): UpperDims {
  const child = p.age === 'child';
  const female = p.sex === 'f' && !child;
  const old = p.age === 'old';
  const deity = !!p.deity;
  const stout = p.build === 'stout';
  const hunch = p.build === 'hunch';
  const b = layout.bind;
  const Wr = seams.WAIST;
  const yW = Wr.centre[1];
  const q = Wr.count / 4;
  const aW = Wr.pos[0]! - Wr.centre[0];
  const bWf = -(Wr.pos[q * 3 + 2]! - Wr.centre[2]);
  const bWb = Wr.pos[3 * q * 3 + 2]! - Wr.centre[2];
  const xS = b.shoulderR[0], yS = b.shoulderR[1];
  const yC = layout.collarY;
  const ySt = yS + (female ? 0.013 : old ? 0.019 : child ? 0.02 : 0.025) * s;
  const NT = seams.NECK_TOP;
  const nq = NT.count / 4;
  const ntA = NT.pos[0]! - NT.centre[0];
  const ntB = Math.hypot(NT.pos[nq * 3 + 2]! - NT.centre[2], NT.pos[nq * 3 + 1]! - NT.centre[1]);
  const armK = (child ? 0.8 : female ? 0.88 : old ? 0.93 : 1) * (stout ? 1.1 : p.build === 'slim' ? 0.94 : 1) * (deity ? 1.05 : 1);
  const handK = child ? 0.75 : female ? 0.9 : 1;
  const pad = (g?.top === 'cotton_padded' ? 0.014 : g?.top === 'jacket' ? 0.006 : g?.top === 'zhongshan' ? 0.003 : 0) * s;
  // 腋下：胸侧收到胳膊内侧（绑定姿势胳膊竖直下垂，不能插进躯干）
  const hA = (yS - 0.108 * s - yW) / (ySt - yW);
  const nbA = ntA * 1.13, nbB = ntB * 1.22;
  const nbC = new THREE.Vector3(0, yC - 0.008 * s * (child ? 0.9 : 1), 0.003 * s);
  return {
    s, female, child, old, deity, stout, hunch, kyph: Math.min(1.4, p.kyphosis / 0.25),
    W: s * p.bw, D: s * p.bd,
    yW, aW, bWf, bWb, ySpine: b.spine[1], xS, yS, ySt, yC, hA, pad, armK, handK,
    armRx: 0.044 * s * armK, armRz: 0.049 * s * armK,
    nbC, nbA, nbB, nbTilt: (16 * Math.PI) / 180, ntA, ntB, bind: b,
  };
}

/** 敞领（shirt_open）V 口：深（领根前点往下）、领根处半宽（×s）。 */
export const V_OPEN = { depth: 0.075, half: 0.05 } as const;

/** V 口在高 y 处的半宽（V 外 = 0）；yTop/yBot：V 口的上下沿。 */
export function vHalfAt(d: UpperDims, y: number): { w: number; yTop: number; yBot: number } {
  const nbFrontY = d.nbC.y - Math.tan(d.nbTilt) * d.nbB;
  const yTop = nbFrontY + 0.02 * d.s, yBot = nbFrontY - V_OPEN.depth * d.s;
  const w = y < yBot ? 0 : V_OPEN.half * d.s * Math.min(1.2, (y - yBot) / (yTop - yBot)) * 1.05;
  return { w, yTop, yBot };
}

/** 一圈躯干的截面参数（超椭圆）。 */
export interface Section { a: number; bf: number; bb: number; n: number; zc: number }

/** 躯干截面（h 0..1）。 */
export function section(d: UpperDims, p: Readonly<BodyProfile>, h: number, out: Section = { a: 0, bf: 0, bb: 0, n: 3, zc: 0 }): Section {
  const { s, W, D } = d;
  const hA = d.hA;
  // 胸侧半宽：腋下收到胳膊内侧 - 一点（胳膊竖直下垂时贴着而不插进去）
  const armIn = d.xS - d.armRx * 0.9;
  let aChest = Math.min(d.aW * 1.05, armIn);
  if (d.female) aChest = Math.min(d.aW * 1.06, armIn - 0.004 * s);
  const aTop = d.xS + (d.female ? -0.006 : d.old ? -0.001 : 0.003) * s;
  const waistA = d.female ? 0.15 * W * p.waistTaper : d.child ? d.aW * 0.99 : d.aW * 1.005;
  const hs = [0, 0.2, 0.42, 0.6, hA, (hA + 1) / 2, 1];
  const as = [d.aW, waistA, d.child ? d.aW * 0.97 : Math.max(waistA, aChest * 0.985), aChest, aChest * (d.female ? 0.985 : 0.99), aChest * 0.96, aTop];
  // 前胸、后背的半深（体型的厚薄只算一半：胸口锚点、背后的线缆平面按标准体型定）
  const base = 0.104 * s * (1 + (p.bd - 1) * 0.5);
  void D;
  const chestF = d.female ? 0.95 : d.old ? 0.97 : d.child ? 0.98 : 1;
  const bfs = [d.bWf, base * 1.0, base * 1.06 * chestF, base * 1.12 * chestF, base * 1.13 * chestF, base * 1.07 * chestF, base * 0.93 * (d.female ? 0.93 : 1)];
  const bbs = [d.bWb, base * 0.95, base * 0.96, base * 0.99, base * 1.02, base * 1.03, base * 0.9];
  out.a = spline(hs, as, h) + d.pad;
  out.bf = spline(hs, bfs, h) + d.pad;
  out.bb = spline(hs, bbs, h) + d.pad;
  // 驼背：上背鼓起（胸椎后凸），前胸略平
  if (d.kyph > 0) out.bb += 0.022 * s * d.kyph * gauss(h - 0.8, 0.28);
  out.n = spline([0, 0.45, 0.75, 1], [3, 2.85, 2.6, 2.4], h);
  // 老人肩往前扣
  out.zc = d.old || d.hunch ? -0.011 * s * Math.min(1, d.kyph + 0.3) * THREE.MathUtils.smoothstep(h, 0.55, 1) : 0;
  return out;
}

const _sec: Section = { a: 0, bf: 0, bb: 0, n: 3, zc: 0 };

/** 躯干外形上的点（h 0..1，t 角度）：截面 + 叠加的起伏（肚子、胸、胸肌、肩胛、脊沟）。 */
export function torsoPoint(d: UpperDims, p: Readonly<BodyProfile>, t: number, h: number, out: THREE.Vector3): THREE.Vector3 {
  const sc = section(d, p, h, _sec);
  const cx = sgnPow(Math.cos(t), 2 / sc.n), cz = -sgnPow(Math.sin(t), 2 / sc.n);
  const x = cx * sc.a;
  let z = sc.zc + (cz < 0 ? cz * sc.bf : cz * sc.bb);
  const y = d.yW + h * (d.ySt - d.yW);
  const s = d.s;
  const front = cz < 0 ? Math.pow(-cz, 1.5) * Math.sqrt(Math.max(0, 1 - Math.abs(cx))) : 0;
  const back = cz > 0 ? Math.pow(cz, 1.5) * Math.sqrt(Math.max(0, 1 - Math.abs(cx))) : 0;
  // 肚子（胖子、土地：前面圆鼓）
  const belly = p.belly + (d.child ? 0.01 * s : 0);
  if (belly > 0) z -= belly * (d.deity ? 1.15 : 0.8) * gauss(h - (d.deity ? 0.3 : 0.3), d.deity ? 0.32 : 0.22) * front;
  // 女：胸
  if (d.female && p.bust > 0) {
    const yb = d.yS - 0.18 * s;
    for (const sx of [-1, 1]) {
      const k = gauss(x - sx * 0.055 * s, 0.062 * s) * gauss(y - yb, 0.06 * s);
      z -= 0.021 * s * p.bust * k * Math.min(1, front * 2.2);
    }
  }
  // 男成年：胸肌的平面转折（±3mm）
  if (!d.female && !d.child && !d.deity) {
    const yp = d.yS - 0.085 * s;
    for (const sx of [-1, 1]) z -= 0.003 * s * (d.old ? 0.5 : 1) * gauss(x - sx * 0.065 * s, 0.05 * s) * gauss(y - yp, 0.05 * s) * Math.min(1, front * 2);
  }
  // 肩胛、脊沟
  if (!d.deity) {
    const yb = d.yS - 0.07 * s;
    for (const sx of [-1, 1]) z += 0.003 * s * gauss(x - sx * 0.07 * s, 0.05 * s) * gauss(y - yb, 0.07 * s) * Math.min(1, back * 2);
    z -= 0.0025 * s * gauss(x, 0.016 * s) * THREE.MathUtils.smoothstep(h, 0.15, 0.45) * back;
  }
  // 背后不超过线缆平面（0.12s，软夹）：驼背的老人除外
  if (z > 0 && d.kyph < 0.5) {
    const lim = 0.118 * s, k = 0.006 * s;
    if (z > lim - k) z += (lim - k + k * Math.tanh((z - (lim - k)) / k) - z) * THREE.MathUtils.smoothstep(h, 0.1, 0.28);
  }
  return out.set(x, y, z);
}

/** 领根圈（脖子根，衬衫领口）上的点：倾斜的椭圆，前低后高。 */
export function neckBasePoint(d: UpperDims, t: number, grow: number, out: THREE.Vector3): THREE.Vector3 {
  const a = d.nbA + grow, b = d.nbB + grow;
  const zo = -Math.sin(t) * b;
  return out.set(d.nbC.x + Math.cos(t) * a, d.nbC.y + zo * Math.tan(d.nbTilt), d.nbC.z + zo);
}

/**
 * 肩背上沿（“披肩”：肩顶圈 → 领根圈）上的点：lam 0 = 肩顶圈、1 = 领根圈；斜方肌往上鼓。
 */
export function yokePoint(d: UpperDims, p: Readonly<BodyProfile>, t: number, lam: number, out: THREE.Vector3): THREE.Vector3 {
  const a = torsoPoint(d, p, t, 1, new THREE.Vector3());
  const b = neckBasePoint(d, t, d.pad * 0.5, new THREE.Vector3());
  const e = 1 - Math.pow(1 - lam, 1.25);
  out.lerpVectors(a, b, e);
  const c = Math.cos(t);
  const s = d.s;
  // 斜方肌：两侧往上鼓；前面（锁骨下）、后面平一些
  out.y += Math.sin(Math.PI * Math.pow(lam, 0.9)) * (0.004 + 0.011 * c * c) * s * (d.female ? 0.75 : 1);
  return out;
}

/** 躯干外形的法线（数值差分；h 方向向上、t 方向绕圈）。 */
export function torsoFrame(d: UpperDims, p: Readonly<BodyProfile>, t: number, h: number): { p: THREE.Vector3; n: THREE.Vector3; t: THREE.Vector3; up: THREE.Vector3 } {
  const P = torsoPoint(d, p, t, h, new THREE.Vector3());
  const e = 1e-3;
  const tt = torsoPoint(d, p, t + e, h, new THREE.Vector3()).sub(torsoPoint(d, p, t - e, h, new THREE.Vector3())).normalize();
  const hh = Math.min(1, h + e), hl = Math.max(0, h - e);
  const up = torsoPoint(d, p, t, hh, new THREE.Vector3()).sub(torsoPoint(d, p, t, hl, new THREE.Vector3())).normalize();
  const n = new THREE.Vector3().crossVectors(tt, up).normalize();
  if (n.x * P.x + n.z * (P.z - 0) < 0) n.negate();
  return { p: P, n, t: tt, up };
}

/** y（人偶根空间）→ h。 */
export function hOf(d: UpperDims, y: number): number {
  return (y - d.yW) / (d.ySt - d.yW);
}

/** t 的反查：前半边（t ∈ [0, π]）上 x 坐标为 x 的角度（x 单调减）。 */
export function tForX(d: UpperDims, p: Readonly<BodyProfile>, x: number, h: number, back = false): number {
  let lo = back ? Math.PI : 0, hi = back ? 2 * Math.PI : Math.PI;
  const v = new THREE.Vector3();
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    torsoPoint(d, p, mid, h, v);
    if (back ? v.x < x : v.x > x) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 躯干贴图 v：沿用旧版 squircleLoft 的行（spine 局部 y：0、0.08、0.18、0.28、0.36、0.405、0.435 ×s → v = 0..1），衣服贴图上画的口袋、扣子位置不变。 */
export function torsoV(d: UpperDims, y: number): number {
  const k = (d.yC - d.ySpine) / 0.45;
  const yl = (y - d.ySpine) / k;
  const ys = [0, 0.08, 0.18, 0.28, 0.36, 0.405, 0.435].map(v => v * d.s);
  if (yl <= 0) return yl / (0.08 * d.s) / 6;
  if (yl >= ys[6]!) return 1;
  let i = 0;
  while (i < 5 && yl > ys[i + 1]!) i++;
  return (i + (yl - ys[i]!) / (ys[i + 1]! - ys[i]!)) / 6;
}
