// owner: WP2
// char2 WP-U：躯干一整张皮——（下摆）→ WAIST 接缝 → 腰、胸 → 两侧开袖窿 → 肩上“披肩” → 领根 → 脖子 → NECK_TOP 接缝。
// 衣服和露出的皮肤是同一张网格，按区域分到 torso / skin 部件（V 领里是皮肤）；袖窿的边圈交给 arm.ts 往外长胳膊。

import * as THREE from 'three';
import { boneIndex } from '../profile';
import { smooth01 } from '../shared';
import type { BodyProfile, BuildCtx, GarmentSpec } from '../types';
import { neckBasePoint, torsoPoint, torsoV, vHalfAt, yokePoint, type UpperDims } from './dims';
import { MeshBuilder, gauss, type Skin } from './mesh';

/** 躯干的列数（圈上的点数）。袖窿占每侧 2K 列、M 行：袖窿边圈 = 2·(2K) + 2·M = 24 个点（胳膊的圈也是 24 个点）。 */
export const TORSO_N = 40;
const K = 4, M = 4;
export const ARM_N = 4 * K + 2 * M;

export interface ArmLoop {
  /** 袖窿边圈（右侧，24 个点，顶点 0 = 肩顶正中，往前、往下、经腋下、往后、回到肩顶） */
  pos: THREE.Vector3[];
  /** 每个点“越过边、顺着躯干表面继续”的方向（单位） */
  tan: THREE.Vector3[];
  /** 每个点在哪条边上：0 上、1 前、2 下（腋下）、3 后 */
  edge: number[];
  /** 边圈各点的蒙皮（与躯干上同一点一样） */
  skin: Skin[];
  /** 边圈各点在躯干贴图上的 u（右侧，-0.1..0.1） */
  u: number[];
}

export interface TorsoOut {
  loop: ArmLoop;
  /** 需要在算完法线后改成接缝法线的顶点：[MB 顶点下标, 法线] */
  seamNormals: [number, THREE.Vector3][];
  /** 领根圈（每列一个点，TORSO_N + 1）：领子沿着它摆 */
  neckBase: number[];
  /** 躯干身体那几行（行下标 → 每列顶点）、每行的 h；外形网格查询用 */
  rows: number[][];
}

const B = (n: Parameters<typeof boneIndex>[0]) => boneIndex(n);

/**
 * fix2：裤子骨盆段（WAIST → 分裆圈）在高 y 处的半宽 a、前深 bf、后深 bb（根空间，按 WAIST 中心量；与 lower/trousers.ts pelvisRing 同式），
 * 分裆圈以下取两条裤腿合起来的外包（臀褶处后片再鼓 4mm）。下摆按它让开裤子。
 */
export function pantsEnvelope(ctx: BuildCtx, d: UpperDims): (y: number) => { a: number; bf: number; bb: number } {
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
  const hipJ = d.bind.hipR[1], Lth = hipJ - d.bind.kneeR[1];
  const ySplit = hipJ - 0.14 * Lth;
  const legA = d.bind.hipR[0] + 0.083 * s * p.bw * (female ? 0.93 : 1);
  return (y: number) => {
    const f = Math.min(1, Math.max(0, (c[1] - y) / (c[1] - ySplit)));
    let a = aW + (aH - aW) * Math.pow(Math.sin((f * Math.PI) / 2), 0.85);
    const bf = (bW + (bfH - bW) * f) * (1 + bellyW * Math.pow(1 - f, 1.6));
    let bb = bW + (bbH - bW) * Math.sin((Math.min(1, f * 1.15) * Math.PI) / 2);
    if (y < ySplit) { a = Math.max(a, legA); bb = bbH + 0.004 * s; }
    return { a, bf, bb };
  };
}

/** fix1：inner = 没有人头（摄像头）时 V 口里、领口封口用的深色内衬（不是皮肤） */
export interface TorsoPieces { torso: number; skin: number; inner?: number }

/**
 * 躯干。pieces：torso（衬衫/袍料）与 skin（脖子、V 领里）的部件下标。
 * vRegion(x, y, z)：true = 这里是皮肤（V 领）。
 */
export function buildTorso(mb: MeshBuilder, ctx: BuildCtx, d: UpperDims, g: Readonly<GarmentSpec>, pc: TorsoPieces): TorsoOut {
  const p: Readonly<BodyProfile> = ctx.profile;
  const s = d.s;
  const N = TORSO_N;
  const ts = Array.from({ length: N }, (_, i) => (i / N) * Math.PI * 2);
  const W = ctx.seams.WAIST;
  const human = ctx.spec.head === 'human' || ctx.spec.head === 'weasel';
  const tucked = g.tucked !== false && g.top !== 'robe_top';
  const hemDrop = tucked ? 0 : (g.hemDrop ?? 0) * s;

  // ---------------------------------------------------------------- 身体那几行（h）
  const hA = d.hA;
  const bodyH: number[] = [];
  const puff: number[] = [];
  if (tucked) { bodyH.push(0.024, 0.075); puff.push(0.0045 * s, 0.0012 * s); }
  else { bodyH.push(0.07); puff.push(0); }
  for (const h of [0.16, 0.26, 0.36, 0.46, 0.55, 0.635]) { bodyH.push(h); puff.push(0); }
  const ra = bodyH.length;
  for (let k = 0; k <= M; k++) { bodyH.push(hA + ((1 - hA) * k) / M); puff.push(0); }
  const rs = bodyH.length - 1;
  // 棉袄：一行鼓一行收，像绗过的棉
  if (g.top === 'cotton_padded') for (let r = 0; r < ra; r++) puff[r]! += (r % 2 ? 0.0035 : -0.0005) * s;

  // 衣服的细节起伏（沿法线方向的径向偏移）：塞进裤腰的褶、腋下往胸前的斜褶
  const warp = (t: number, h: number): number => {
    let r = 0;
    if (tucked) r += 0.0024 * s * Math.sin(5 * t + 0.9) * gauss(h - 0.03, 0.08) * (0.4 + 0.6 * Math.abs(Math.cos(t)));
    if (g.top !== 'robe_top' && !d.deity) {
      // 腋前斜褶：从腋下往胸口中间（两侧各两道，很浅）
      const c = Math.cos(t), sn = -Math.sin(t);
      if (sn > 0.2) r += 0.0016 * s * Math.sin(9 * Math.abs(c) - 14 * h + 3.5) * gauss(h - 0.55, 0.16) * smooth01(0.25, 0.75, Math.abs(c));
      // 后背肩胛之间的拉褶
      if (sn < -0.3) r += 0.0012 * s * Math.sin(10 * Math.abs(c) + 9 * h) * gauss(h - 0.72, 0.15) * smooth01(0.1, 0.6, Math.abs(c));
    }
    return r;
  };

  const P: THREE.Vector3[][] = [];
  const tmp = new THREE.Vector3();
  const bodyPoint = (t: number, h: number, extra: number, out: THREE.Vector3) => {
    torsoPoint(d, p, t, h, out);
    const r = extra + warp(t, h);
    if (r) {
      // 水平外法线近似：(x, z - zc) 方向
      const nx = out.x, nz = out.z - (out.z > 0 ? 0 : 0);
      const l = Math.hypot(nx, nz) || 1;
      out.x += (nx / l) * r;
      out.z += (nz / l) * r;
    }
    return out;
  };
  for (let r = 0; r < bodyH.length; r++) P.push(ts.map(t => bodyPoint(t, bodyH[r]!, puff[r]!, new THREE.Vector3())));
  // 披肩（肩顶 → 领根）
  const yokeL = [0.3, 0.58, 0.82, 1];
  const yokeRows = yokeL.map(l => ts.map(t => (l < 1 ? yokePoint(d, p, t, l, new THREE.Vector3()) : neckBasePoint(d, t, d.pad * 0.5, new THREE.Vector3()))));

  // 敞领：V 口两边落在每一行最近的那一列上（把那个点挪到 V 边上），皮肤/衣服的分界就是一条直线，不是锯齿
  const vOpen = g.collar === 'shirt_open';
  if (vOpen) {
    const snapRow = (row: THREE.Vector3[], fn: (t: number) => THREE.Vector3) => {
      for (const sx of [1, -1]) {
        const y0 = row[N / 4]!.y;
        const w = vHalfAt(d, y0).w;
        if (w <= 0) continue;
        // 前半边里离 x = sx·w 最近的列
        let best = -1, bd = Infinity;
        for (let i = sx > 0 ? 1 : N / 4 + 1; i < (sx > 0 ? N / 4 : N / 2); i++) {
          const dd = Math.abs(row[i]!.x - sx * w);
          if (dd < bd) { bd = dd; best = i; }
        }
        if (best < 0 || bd > (0.03 * s)) continue;
        let lo = sx > 0 ? 0 : Math.PI / 2, hi = sx > 0 ? Math.PI / 2 : Math.PI;
        for (let k = 0; k < 30; k++) {
          const mid = (lo + hi) / 2;
          if (fn(mid).x > sx * w) lo = mid; else hi = mid;
        }
        row[best] = fn((lo + hi) / 2);
      }
    };
    for (let r = 0; r < P.length; r++) snapRow(P[r]!, t => bodyPoint(t, bodyH[r]!, puff[r]!, new THREE.Vector3()));
    yokeL.forEach((l, k) => snapRow(yokeRows[k]!, t => (l < 1 ? yokePoint(d, p, t, l, new THREE.Vector3()) : neckBasePoint(d, t, d.pad * 0.5, new THREE.Vector3()))));
  }

  // ---------------------------------------------------------------- 袖窿边圈（右侧）
  const col = (c: number) => ((c % N) + N) % N;
  const G = (r: number, c: number): THREE.Vector3 => (r <= rs ? P[r]![col(c)]! : yokeRows[r - rs - 1]![col(c)]!);
  const loopIdx: [number, number, number][] = []; // [row, col, edge]
  for (let c = 0; c <= K; c++) loopIdx.push([rs, c, 0]);
  for (let r = rs - 1; r > ra; r--) loopIdx.push([r, K, 1]);
  for (let c = K; c >= -K; c--) loopIdx.push([ra, c, 2]);
  for (let r = ra + 1; r < rs; r++) loopIdx.push([r, -K, 3]);
  for (let c = -K; c < 0; c++) loopIdx.push([rs, c, 0]);
  const loopPos = loopIdx.map(([r, c]) => G(r, c).clone());
  const loopTan = loopIdx.map(([r, c]) => {
    const v = new THREE.Vector3();
    const top = r === rs, bot = r === ra, fr = c === K, bk = c === -K;
    if (top) v.add(tmp.subVectors(G(rs, c), G(rs + 1, c)).normalize());
    if (bot) v.add(tmp.subVectors(G(ra, c), G(ra - 1, c)).normalize());
    if (fr) v.add(tmp.subVectors(G(r, K), G(r, K + 1)).normalize());
    if (bk) v.add(tmp.subVectors(G(r, -K), G(r, -K - 1)).normalize());
    return v.normalize();
  });
  const loopEdge = loopIdx.map(([r, c, e]) => (r === rs && Math.abs(c) === K ? (c > 0 ? 1 : 3) : r === ra && Math.abs(c) === K ? 2 : e));
  const loopL = loopPos.map(v => new THREE.Vector3(-v.x, v.y, v.z));

  // ---------------------------------------------------------------- 蒙皮
  const hips = B('hips'), spine = B('spine'), neck = B('neck'), head = B('headSlot'), shR = B('shoulderR'), shL = B('shoulderL');
  const nearLoop = (q: THREE.Vector3): number => {
    const L = q.x >= 0 ? loopPos : loopL;
    let m = Infinity;
    for (const v of L) m = Math.min(m, v.distanceToSquared(q));
    return Math.sqrt(m);
  };
  /** 躯干点的蒙皮：hips → spine（腰上 10cm 内）→ 领根往上带一点 neck；袖窿附近 6cm 内带 shoulder（边圈上 0.35）。 */
  const torsoSkin = (q: THREE.Vector3, neckW: number): Skin => {
    const ws = smooth01(d.yW, d.yW + 0.1 * s, q.y);
    const wHips = 0.65 * (1 - ws);
    const wSpine = 1 - wHips;
    let wsh = 0.35 * (1 - smooth01(0, 0.07 * s, nearLoop(q)));
    if (q.y < d.yS - 0.2 * s) wsh = 0;
    const k = 1 - wsh;
    return [[hips, wHips * k * (1 - neckW)], [spine, wSpine * k * (1 - neckW)], [neck, neckW * k], [q.x >= 0 ? shR : shL, wsh]];
  };
  const loopSkin = loopPos.map(q => torsoSkin(q, 0));

  // ---------------------------------------------------------------- 顶点
  const u = (i: number) => i / N;
  const vrow = (y: number) => torsoV(d, y);
  const rowsIdx: number[][] = [];
  const seamNormals: [number, THREE.Vector3][] = [];
  const firstTri = mb.triCount;

  // 下摆（没塞进裤腰）：WAIST 往下外撇，最后一道 1cm 的折边，边口往里收一点（敞口，看得见里面的裤子）
  let lowRing: number[] | null = null;
  const W24 = Array.from({ length: W.count }, (_, i) => new THREE.Vector3(W.pos[i * 3]!, W.pos[i * 3 + 1]!, W.pos[i * 3 + 2]!));
  const wq = W.count / 4;
  if (hemDrop > 0) {
    // fix1：下摆贴着胯（裤子臀围 + 0.8–1.1cm），不再离身体 1.5–2cm 地撇出来像一圈裙撑
    const hipA = Math.max(d.aW * 1.04, 0.17 * d.W * p.hipW + 0.009 * s) + d.pad;
    const hipBf = Math.max(d.bWf, 0.108 * d.D) + 0.008 * s + d.pad;
    const hipBb = Math.max(d.bWb, (d.female ? 0.125 : 0.115) * d.D) + 0.011 * s + d.pad;
    // 下摆短（离腰不到 11cm）时只张到当地的胯宽（不到最宽的臀围）：新娘小袄的下摆不再是一圈平伸出去的边
    const hipK = Math.pow(Math.min(1, hemDrop / (0.11 * s)), 0.8);
    // fix2：下摆每一圈都要比同高度的裤子（骨盆段，臀部最鼓处在腰下 ~10cm，正好在长下摆的中段）大出一截，
    // 否则长下摆（中山装 16cm）的中段压进臀部，背后一片 z-fighting 的黑斑。与 lower/trousers.ts pelvisRing 同式。
    const env = pantsEnvelope(ctx, d);
    const clear = 0.01 * s + d.pad;
    const skirtRing = (yy: number, k: number, lip: number): THREE.Vector3[] => W24.map((w, i) => {
      const t = (i / W.count) * Math.PI * 2;
      const c = Math.cos(t), sn = -Math.sin(t);
      const ax = Math.abs(w.x - W.centre[0]) || 1e-6;
      const az = Math.abs(w.z - W.centre[2]) || 1e-6;
      const wa = Math.abs(c) > 1e-6 ? ax / Math.pow(Math.abs(c), 2 / 3) : d.aW;
      void wa;
      const kk = k * hipK;
      const e = env(yy);
      const fx = Math.max((d.aW + (hipA - d.aW) * kk) / d.aW, (e.a + clear) / d.aW);
      // sn = -sin t：sn < 0 是前片（t ≈ π/2，z < 0）。fix2：原来前后弄反了（后片只撇到前片的尺寸，压进臀部）
      const fz = sn > 0
        ? Math.max((d.bWb + (hipBb - d.bWb) * kk) / d.bWb, (e.bb + clear) / d.bWb)
        : Math.max((d.bWf + (hipBf - d.bWf) * kk) / d.bWf, (e.bf + clear) / d.bWf);
      const out = new THREE.Vector3(W.centre[0] + (w.x - W.centre[0]) * fx, yy, W.centre[2] + (w.z - W.centre[2]) * fz);
      // 衣襟下摆的几道垂褶（很浅）
      const fold = 0.0025 * s * k * Math.sin(7 * t + 1.3);
      const l = Math.hypot(out.x, out.z - W.centre[2]) || 1;
      out.x += (out.x / l) * (fold - lip);
      out.z += ((out.z - W.centre[2]) / l) * (fold - lip);
      void ax; void az; void wq;
      return out;
    });
    const legW = (q: THREE.Vector3): Skin => {
      const k = smooth01(0, hemDrop, d.yW - q.y);
      const fr = smooth01(0.02 * s, -0.08 * s, q.z);
      const wl = 0.42 * k * fr;
      const r = smooth01(-0.03 * s, 0.03 * s, q.x);
      return [[hips, 1 - wl], [B('hipR'), wl * r], [B('hipL'), wl * (1 - r)]];
    };
    const yHem = d.yW - hemDrop;
    // 下沿略往里收（布垂下来，不往外翘），折边是圆的
    const ks = [0.9, 0.93, 0.95, 0.66, 0.24];
    const ys = [yHem + 0.005 * s, yHem, yHem + 0.01 * s, yHem + hemDrop * 0.45, yHem + hemDrop * 0.82];
    const lips = [0.003 * s, -0.0008 * s, -0.0012 * s, 0, 0];
    const rings: number[][] = [];
    for (let k = 0; k < ys.length; k++) {
      const pts = skirtRing(ys[k]!, ks[k]!, lips[k]!);
      const r = mb.ring(pts, vrow(ys[k]!), legW);
      rings.push(r);
      if (k === 1) rings.push(mb.dupRing(r)); // 折边下沿：硬边
    }
    for (let k = 0; k + 1 < rings.length; k++) {
      if (k === 1) continue; // 复制圈之间不连
      mb.strip(rings[k]!, rings[k + 1]!, pc.torso);
    }
    lowRing = rings[rings.length - 1]!;
  }
  // WAIST 接缝圈（24 点）：位置、蒙皮正是接缝的
  const wRing = mb.ring(W24, vrow(d.yW), () => W.skin.bones.map((b, k) => [b, W.skin.weights[k]!] as const));
  wRing.forEach((vi, i) => {
    const k = i % W.count;
    seamNormals.push([vi, new THREE.Vector3(W.nor[k * 3]!, W.nor[k * 3 + 1]!, W.nor[k * 3 + 2]!)]);
  });
  if (lowRing) mb.strip(lowRing, wRing, pc.torso);

  // 身体各行（40 列）
  for (let r = 0; r < P.length; r++) rowsIdx.push(mb.ring(P[r]!, vrow(P[r]![0]!.y), q => torsoSkin(q, 0), u));
  mb.zip(wRing, rowsIdx[0]!, pc.torso);
  for (let r = 0; r + 1 < rowsIdx.length; r++) {
    const inHole = r >= ra && r < rs;
    mb.strip(rowsIdx[r]!, rowsIdx[r + 1]!, pc.torso, inHole ? (i => i >= N - K || i < K || (i >= N / 2 - K && i < N / 2 + K)) : undefined);
  }
  // 披肩、领根
  const yokeIdx = yokeRows.map((row, k) => mb.ring(row, 1, q => torsoSkin(q, 0.15 * smooth01(0.4, 1, yokeL[k]!)), u));
  // V 领（shirt_open）：领口往下开成 V，V 里面是皮肤（驳头盖住边）
  /** 三角形在 V 里：三个顶点都在 V 边以内（V 边上的点已经挪到边上），重心也在里面。 */
  const inV = (a: number, b: number, c: number): boolean => {
    if (!vOpen) return false;
    const q = mb.P(a).add(mb.P(b)).add(mb.P(c)).multiplyScalar(1 / 3);
    if (q.z > -0.02 * s) return false;
    for (const v of [a, b, c]) {
      const pv = mb.P(v);
      if (Math.abs(pv.x) > vHalfAt(d, pv.y).w + 0.0015 * s) return false;
    }
    return true;
  };
  const vSlot = human ? pc.skin : (pc.inner ?? pc.skin);
  const triSlot = (a: number, b: number, c: number) => (inV(a, b, c) ? vSlot : pc.torso);
  const stripV = (A: number[], Bv: number[]) => {
    for (let i = 0; i + 1 < A.length; i++) {
      const a = A[i]!, b = A[i + 1]!, c = Bv[i]!, e = Bv[i + 1]!;
      mb.t(a, b, e, triSlot(a, b, e));
      mb.t(a, e, c, triSlot(a, e, c));
    }
  };
  // 胸口上面几行也可能在 V 里：重分一遍（只改已建好的身体行里落在 V 里的三角形）
  if (vOpen) {
    for (let t = firstTri; t < mb.triCount; t++) {
      const a = mb.tri[t * 3]!, b = mb.tri[t * 3 + 1]!, c = mb.tri[t * 3 + 2]!;
      if (mb.triPiece[t] === pc.torso && inV(a, b, c)) mb.triPiece[t] = vSlot;
    }
  }
  stripV(rowsIdx[rs]!, yokeIdx[0]!);
  for (let k = 0; k + 1 < yokeIdx.length; k++) stripV(yokeIdx[k]!, yokeIdx[k + 1]!);
  const neckBase = yokeIdx[yokeIdx.length - 1]!;

  // ---------------------------------------------------------------- 脖子（人头）或领口封口（摄像头头、无头）
  if (human) {
    const NT = ctx.seams.NECK_TOP;
    const nN = NT.count;
    const ntPts = Array.from({ length: nN }, (_, i) => new THREE.Vector3(NT.pos[i * 3]!, NT.pos[i * 3 + 1]!, NT.pos[i * 3 + 2]!));
    const nbPts = Array.from({ length: nN }, (_, i) => neckBasePoint(d, (i / nN) * Math.PI * 2, 0, new THREE.Vector3()));
    const male = !d.female && !d.child;
    const ntCen = new THREE.Vector3(NT.centre[0], 0, NT.centre[2]);
    const nbCen = new THREE.Vector3(d.nbC.x, 0, d.nbC.z);
    const neckRing = (lam: number): THREE.Vector3[] => nbPts.map((b, i) => {
      const q = new THREE.Vector3().lerpVectors(b, ntPts[i]!, lam);
      // fix1：半径不按直线插值：根部宽、往上先慢后快地收（侧面看脖子从肩上流上去，领口上面不是一圈空隙）
      {
        const rb = Math.hypot(b.x - nbCen.x, b.z - nbCen.z), rt = Math.hypot(ntPts[i]!.x - ntCen.x, ntPts[i]!.z - ntCen.z);
        const cq = new THREE.Vector3().lerpVectors(nbCen, ntCen, lam);
        const dq = new THREE.Vector3(q.x - cq.x, 0, q.z - cq.z);
        const r0 = dq.length() || 1;
        const r1 = rb + (rt - rb) * Math.pow(lam, 1.7);
        q.x = cq.x + (dq.x / r0) * r1;
        q.z = cq.z + (dq.z / r0) * r1;
      }
      // 脖子中段略细；男人喉结（前面正中 +3mm）；胸锁乳突肌：前两侧略鼓
      const t = (i / nN) * Math.PI * 2;
      const c = Math.cos(t), sn = -Math.sin(t);
      const cen = new THREE.Vector3(0, q.y, d.nbC.z + (NT.centre[2] - d.nbC.z) * lam);
      const dir = q.clone().sub(cen);
      dir.y = 0;
      const l = dir.length() || 1;
      let dr = 0.0012 * s * Math.sin(Math.PI * lam);
      if (male && sn > 0) dr += 0.0032 * s * Math.pow(sn, 12) * gauss(lam - 0.45, 0.22);
      // fix2：胸锁乳突肌：从耳后（上、侧后）斜到胸骨（下、前中），两条斜的肌肉棱，中间喉咙略凹；后颈两侧也略收
      // （脖子不再是一根匀匀的圆筒）
      {
        const ang = Math.atan2(sn, Math.abs(c)); // 0 = 侧面，π/2 = 正前
        const ridge = 0.18 + 1.05 * (1 - lam); // 下面靠前中、上面靠侧面
        dr += 0.0032 * s * gauss(ang - ridge, 0.28) * Math.sin(Math.PI * Math.min(1, lam * 1.15 + 0.08));
        if (sn > 0.85) dr -= 0.0014 * s * gauss(lam - 0.25, 0.25);
        if (sn < -0.2) dr -= 0.0018 * s * Math.sin(Math.PI * lam) * Math.min(1, -sn * 1.5);
      }
      return q.addScaledVector(dir, dr / l);
    });
    const n1 = mb.ring(neckRing(0.36), 1, () => [[spine, 0.45], [neck, 0.55]]);
    const n2 = mb.ring(neckRing(0.7), 1, () => [[neck, 0.8], [head, 0.2]]);
    const nt = mb.ring(ntPts, 1, () => [[head, 1]]);
    nt.forEach((vi, i) => {
      const k = i % nN;
      seamNormals.push([vi, new THREE.Vector3(NT.nor[k * 3]!, NT.nor[k * 3 + 1]!, NT.nor[k * 3 + 2]!)]);
    });
    mb.zip(neckBase, n1, pc.skin);
    mb.strip(n1, n2, pc.skin);
    mb.strip(n2, nt, pc.skin);
  } else {
    // 领口封口：领根圈往里收成一个浅碗（摄像头支架从这里出来）
    const inner = neckBase.slice(0, N).map(i => mb.P(i).lerp(new THREE.Vector3(d.nbC.x, mb.P(i).y, d.nbC.z), 0.55).add(new THREE.Vector3(0, 0.004 * s, 0)));
    const ir = mb.ring(inner, 1, () => [[spine, 0.85], [neck, 0.15]]);
    mb.strip(neckBase, ir, vSlot);
    const c = mb.v(d.nbC.x, d.nbC.y + 0.006 * s, d.nbC.z, 0.5, 1, [[spine, 0.8], [neck, 0.2]]);
    for (let i = 0; i < N; i++) mb.t(ir[i]!, ir[i + 1]!, c, vSlot);
  }
  // 绕向：按到躯干中轴（x = 0，z = 当地中心）的方向定
  mb.orient(firstTri, mb.triCount, q => new THREE.Vector3(0, q.y, q.y > d.yC - 0.02 * s ? d.nbC.z : 0));

  return {
    loop: { pos: loopPos, tan: loopTan, edge: loopEdge, skin: loopSkin, u: loopIdx.map(([, c]) => c / N) },
    seamNormals, neckBase, rows: rowsIdx,
  };
}
