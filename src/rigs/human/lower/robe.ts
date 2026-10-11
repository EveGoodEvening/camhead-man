// owner: WP2
// char2 WP-L：长袍（土地爷）与旗袍裙（新娘），从 WAIST（土地是布腰带下沿）到下摆（PLAN §3.3）。
//
// 站姿：48 列的放样（顶圈每隔一列正好是 24 点的接缝点，中间一列取弦中点，和上衣对缝没有 T 形裂缝）。
//   土地：腰下接着上身的“酒桶肚”，然后 A 字大摆到离地 4cm；前后片 7 道长短不一的垂褶（4–10mm，后片更深），前片中间平。
//   新娘：收腰 → 臀 → 直筒到脚踝上，下摆略外撇；前中一片“门襟片”（两道浅缝），后面两道小褶。
//   下摆：一圈硬边 + 往里折的里子（从下往上看不是空心）。袍里没有腿。
// 坐姿（bend → 1）：CPU 在“站姿 ↔ 预先算好的坐姿形”之间插值（只在 bend 变化时重算法线）：
//   前片沿弧长铺成“从肚子/腰往前上到大腿面 → 平铺过膝 → 圆角 → 垂到脚背上 3cm”的曲线；两膝之间的布往里兜（垂褶）；
//   后片垂到座面高再往前收进身下（不穿过椅面）；侧面在前后两条路径之间插值，并被推到大腿外侧之外（大腿不会从侧面戳出来）。
//   坐姿时下摆的“跟腿摆动”权重收回到 hips（站姿/走路时下半截有 ≤45% 跟着两条大腿摆）。

import * as THREE from 'three';
import { boneIndex } from '../profile';
import { loftRings, smooth01 } from '../shared';
import type { BuildCtx, RegionResult, SkinnedPiece } from '../types';
import { asymRing, inflateRing, table, type LowerStyle } from './geom';
import { mergeIndexed } from './trousers';

const C = 48;

/** 24 点的圈 → 48 点（偶数列原样，奇数列取弦中点）。 */
function up48(r24: ArrayLike<number>): Float32Array {
  const out = new Float32Array(C * 3);
  for (let i = 0; i < 24; i++) {
    const j = (i + 1) % 24;
    out.set([r24[i * 3]!, r24[i * 3 + 1]!, r24[i * 3 + 2]!], 2 * i * 3);
    out.set([(r24[i * 3]! + r24[j * 3]!) / 2, (r24[i * 3 + 1]! + r24[j * 3 + 1]!) / 2, (r24[i * 3 + 2]! + r24[j * 3 + 2]!) / 2], (2 * i + 1) * 3);
  }
  return out;
}

export interface RobeOut { piece: SkinnedPiece; update: NonNullable<RegionResult['update']> }

/**
 * 长袍/裙。top24 = 顶圈（24 点、人偶根空间；新娘是 WAIST，土地是腰带下沿）。
 */
export function buildRobe(ctx: BuildCtx, st: LowerStyle, top24: Float32Array): RobeOut {
  const s = ctx.s, p = ctx.profile;
  const qipao = st.bottom === 'qipao_skirt';
  const Wc = ctx.seams.WAIST.centre;
  const cx = Wc[0], cz = Wc[2];
  const yTop = top24[1]!;
  const aT = top24[0]! - cx, bfT = cz - top24[6 * 3 + 2]!, bbT = top24[18 * 3 + 2]! - cz;
  const yHem = (qipao ? 0.072 : 0.058) * s;
  // ---------------- 截面随 t（0 顶 → 1 下摆）
  const ts = [0, 0.05, 0.12, 0.22, 0.34, 0.47, 0.6, 0.72, 0.82, 0.9, 0.955, 1];
  let A: (t: number) => number, BF: (t: number) => number, BB: (t: number) => number;
  if (qipao) {
    const hip = 0.171 * s * p.bw * p.hipW;
    A = table([0, 0.1, 0.2, 0.45, 0.8, 1], [aT, aT + (hip - aT) * 0.75, hip, hip * 0.96, hip * 0.97, hip * 1.04]);
    BF = table([0, 0.1, 0.25, 0.5, 0.85, 1], [bfT, bfT * 1.03, bfT * 1.08, bfT * 1.1, bfT * 1.12, bfT * 1.2]);
    BB = table([0, 0.1, 0.2, 0.4, 0.7, 1], [bbT, bbT * 1.18, bbT * 1.27, bbT * 1.18, bbT * 1.1, bbT * 1.16]);
  } else {
    A = table([0, 0.1, 0.3, 0.6, 1], [aT, aT + 0.012 * s, 0.198 * s, 0.218 * s, 0.245 * s].map((v, i) => (i ? v * Math.max(1, p.bw / 1.14) : v)));
    // fix1：腰带下面接着酒桶肚往前鼓（再往下 A 字摆开），不是一条从胸口到下摆的直线
    BF = table([0, 0.07, 0.16, 0.28, 0.42, 0.62, 1], [bfT, bfT + 0.024 * s, bfT + 0.034 * s, bfT + 0.03 * s, bfT + 0.026 * s, bfT + 0.036 * s, Math.max(0.235 * s, bfT + 0.05 * s)]);
    BB = table([0, 0.1, 0.3, 0.6, 1], [bbT, bbT + 0.008 * s, bbT + 0.02 * s, 0.17 * s, 0.212 * s]);
  }
  const yOf = (t: number) => yTop - (yTop - yHem) * t;
  // 垂褶：径向偏移（米），随 t 增长；起点、间距不规则；后片更深；前片中间（土地）平
  const fold = (th: number, t: number): number => {
    const back = Math.max(0, -Math.sin(th));
    const frontC = Math.exp(-Math.pow((th - Math.PI / 2) / 0.35, 2));
    if (qipao) {
      const panel = -0.0018 * s * (Math.exp(-Math.pow((th - Math.PI / 2 - 0.26) / 0.06, 2)) + Math.exp(-Math.pow((th - Math.PI / 2 + 0.26) / 0.06, 2))) * smooth01(0.08, 0.2, t);
      // 直筒裙下半截几道软褶（前片中间平），后片多一点
      const warp = th + 0.25 * Math.sin(2 * th + 0.4);
      const soft = (0.0016 + 0.0016 * back) * s * (1 - 0.85 * frontC) * smooth01(0.35, 1, t) * Math.sin(9 * warp + 0.7);
      return panel + soft;
    }
    const warp = th + 0.32 * Math.sin(3 * th + 0.8) + 0.12 * Math.sin(5 * th + 2.1);
    const onset = 0.2 + 0.22 * (0.5 + 0.5 * Math.sin(5 * th + 1.3));
    const ramp = Math.pow(smooth01(onset, 1, t), 0.8);
    // fix1：垂褶更深（游戏灯光下看得出来），前片中间也有浅褶
    const amp = (0.0075 + 0.0085 * back) * s * (1 - 0.55 * frontC);
    return ramp * amp * (Math.sin(7 * warp) + 0.35 * Math.sin(13 * warp + 1.1));
  };
  const top48 = up48(top24);
  const mkRow = (t: number): Float32Array => {
    if (t === 0) return top48;
    const base = asymRing(cx, yOf(t), cz, A(t), BF(t), BB(t), C, qipao ? 2.5 : 2.3);
    const r = inflateRing(base, i => fold((i / C) * Math.PI * 2, t));
    // 顶上几圈从顶圈的形状过渡过来
    const k = smooth01(0, 0.12, t);
    if (k < 1) for (let i = 0; i < C * 3; i++) if (i % 3 !== 1) r[i] = top48[i]! + (r[i]! - top48[i]!) * k;
    return r;
  };
  // 下摆：最后 2.5cm 是一道缝过的边（外凸 1.8mm、上沿一道小台阶）；不往里折（长袍的法线全部朝外，wp2 的检查要 > 95%）
  const tBand = (yTop - (yHem + 0.025 * s)) / (yTop - yHem);
  const tRows = [...ts.filter(t => t < tBand - 0.02), tBand];
  const rows: Float32Array[] = tRows.map(mkRow);
  const band = rows[rows.length - 1]!;
  rows.push(inflateRing(band, 0.0018 * s), inflateRing(mkRow(1), 0.0018 * s));
  const vArr = [...tRows.map(t => 1 - t), 1 - tBand, 0];
  // 坐姿时袍下的两条小腿（站着时缩成袍子里的一个点、零面积，不画）：侧面下摆斜着收短后，从侧面看进去能看到腿，不是空的
  const robeGeo = loftRings(rows, { v: vArr });
  const nRobe = robeGeo.attributes.position!.count;
  const shins = seatedShins(ctx);
  const geo = ctx.track(mergeIndexed([robeGeo, shins]));
  robeGeo.dispose();
  shins.dispose();
  const nRows = rows.length, Wd = C + 1;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const nv = pos.count;
  // 顶圈法线：偶数列 = 接缝法线（新娘）或水平径向（土地，腰带下沿）；奇数列取相邻平均
  const W0 = ctx.seams.WAIST;
  const topIsSeam = qipao;
  for (let i = 0; i <= C; i++) {
    const k = i % C;
    let nx: number, nz: number;
    if (topIsSeam) {
      const a = Math.floor(k / 2), bb = (a + (k % 2)) % 24;
      nx = (W0.nor[a * 3]! + W0.nor[bb * 3]!) / 2;
      nz = (W0.nor[a * 3 + 2]! + W0.nor[bb * 3 + 2]!) / 2;
    } else {
      nx = pos.getX(i) - cx;
      nz = pos.getZ(i) - cz;
    }
    const l = Math.hypot(nx, nz) || 1;
    nor.setXYZ(i, nx / l, 0, nz / l);
  }
  // ---------------- 蒙皮：每个顶点固定四根骨 [hips, spine, hipL, hipR]
  const H = boneIndex('hips'), S = boneIndex('spine'), HL = boneIndex('hipL'), HR = boneIndex('hipR');
  const si = new Uint16Array(nv * 4);
  const swAttr = new THREE.BufferAttribute(new Float32Array(nv * 4), 4);
  const sw = swAttr.array as Float32Array;
  const swing = new Float32Array(nv * 2);
  for (let v = 0; v < nv; v++) {
    si.set([H, S, HL, HR], v * 4);
    const y = pos.getY(v), x = pos.getX(v);
    const t = Math.min(1, Math.max(0, (yTop - y) / (yTop - yHem)));
    const spine = topIsSeam ? 0.35 * smooth01(yTop - 0.05 * s, yTop, y) : 0;
    const swg = (qipao ? 0.4 : 0.45) * smooth01(0.3, 0.95, t);
    const r = Math.hypot(x - cx, pos.getZ(v) - cz) || 1;
    const cr = (x - cx) / r;
    swing[v * 2] = swg * (0.5 - 0.5 * cr); // hipL（−x）
    swing[v * 2 + 1] = swg * (0.5 + 0.5 * cr);
    sw.set([1 - spine - swg, spine, swing[v * 2]!, swing[v * 2 + 1]!], v * 4);
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', swAttr);
  // 新娘：顶圈的蒙皮 = 接缝蒙皮（hips 0.65 / spine 0.35）
  if (topIsSeam) for (let i = 0; i <= C; i++) sw.set([0.65, 0.35, 0, 0], i * 4);
  // ---------------- 坐姿形
  const seated = seatedShape(ctx, st, geo, nRows, yTop, yHem);
  // 小腿：坐姿形 = 建好的位置；站姿 = 缩到髋部中心（袍子里面）
  const collapse = [cx, ctx.layout.bind.hips[1], cz];
  for (let v = nRobe; v < nv; v++) {
    seated.pos.set([pos.getX(v), pos.getY(v), pos.getZ(v)], v * 3);
    pos.setXYZ(v, collapse[0]!, collapse[1]!, collapse[2]!);
  }
  const rest = Float32Array.from(pos.array as Float32Array);
  const restN = Float32Array.from(nor.array as Float32Array);
  const restW = Float32Array.from(sw);
  pos.setUsage(THREE.DynamicDrawUsage);
  nor.setUsage(THREE.DynamicDrawUsage);
  swAttr.setUsage(THREE.DynamicDrawUsage);
  const topN = Float32Array.from((nor.array as Float32Array).subarray(0, Wd * 3));
  let prevBend = 0, prevDrop = NaN;
  const dNom = ctx.land.leg.sitDrop;
  const hipsJ = ctx.joints.hips;
  const update: RobeOut['update'] = st2 => {
    const bend = st2.bend;
    const drop = ctx.layout.hipsY - hipsJ.position.y;
    if (Math.abs(bend - prevBend) < 1e-4 && (bend < 1e-4 || Math.abs(drop - prevDrop) < 1e-4)) return;
    prevBend = bend;
    prevDrop = drop;
    const arr = pos.array as Float32Array;
    if (bend < 1e-4) {
      arr.set(rest);
      (nor.array as Float32Array).set(restN);
      sw.set(restW);
    } else {
      const dAdj = drop - dNom;
      for (let v = 0; v < nv; v++) {
        const k3 = v * 3;
        const fall = seated.fall[v]!;
        const kb = v < nRobe ? bend : smooth01(0.45, 0.95, bend);
        arr[k3] = rest[k3]! + (seated.pos[k3]! - rest[k3]!) * kb;
        arr[k3 + 1] = rest[k3 + 1]! + (seated.pos[k3 + 1]! + dAdj * fall - rest[k3 + 1]!) * kb;
        arr[k3 + 2] = rest[k3 + 2]! + (seated.pos[k3 + 2]! - rest[k3 + 2]!) * kb;
        // 跟腿摆动的权重收回到 hips
        const k = Math.max(0, 1 - bend * 2);
        const wl = restW[v * 4 + 2]! * k, wr = restW[v * 4 + 3]! * k;
        sw[v * 4] = 1 - restW[v * 4 + 1]! - wl - wr;
        sw[v * 4 + 2] = wl;
        sw[v * 4 + 3] = wr;
      }
      geo.computeVertexNormals();
      smoothSeam(geo, nRows);
      (nor.array as Float32Array).set(topN, 0);
      // 小腿还缩成一个点（弯得很小：老人站姿膝微屈）时三角形零面积、重算出来的法线是 0：用静止时的法线
      if (smooth01(0.45, 0.95, bend) < 1e-3) (nor.array as Float32Array).set(restN.subarray(nRobe * 3), nRobe * 3);
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    swAttr.needsUpdate = true;
  };
  return {
    piece: { kind: 'skinned', name: 'robe', slot: 'robe', geo, own: true, weld: true, capsulePad: 0.1 * s },
    update,
  };
}

/** 坐姿的两条小腿（绑定空间、跟 hips：膝在 (±hx, 髋高, −Lth)，竖直往下到踝上 2cm）。 */
function seatedShins(ctx: BuildCtx): THREE.BufferGeometry {
  const s = ctx.s, b = ctx.layout.bind;
  const hx = b.hipR[0], yh = b.hipR[1];
  const Lth = b.hipR[1] - b.kneeR[1], Lsh = b.kneeR[1] - b.ankleR[1];
  const gs: THREE.BufferGeometry[] = [];
  for (const sg of [1, -1]) {
    const rings: Float32Array[] = [];
    const ys = [0.02, 0.15, 0.35, 0.55, 0.72, 0.86, 1.0, 1.08];
    const R = table([0, 0.3, 0.7, 1, 1.08], [0.036, 0.042, 0.05, 0.052, 0.05]);
    const BB = table([0, 0.3, 0.6, 0.85, 1.08], [0.036, 0.046, 0.06, 0.052, 0.05]);
    for (const f of ys) {
      const r = R(f) * s;
      rings.push(asymRing(sg * (hx + 0.004 * s), yh - Lsh + Lsh * f, -Lth + 0.004 * s, r, r, BB(f) * s, 12, 2.2));
    }
    gs.push(loftRings(rings, { v: ys.map(f => f / 1.08) }));
  }
  const g = mergeIndexed(gs);
  for (const x of gs) x.dispose();
  return g;
}

/** loftRings 布局：首末两列法线平均（重算法线后 UV 接缝不出硬边）。 */
function smoothSeam(geo: THREE.BufferGeometry, rows: number): void {
  const n = geo.attributes.normal as THREE.BufferAttribute;
  const Wd = C + 1;
  for (let j = 0; j < rows; j++) {
    const a = j * Wd, b = j * Wd + C;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const k = 1 / Math.max(1e-8, Math.hypot(x, y, z));
    n.setXYZ(a, x * k, y * k, z * k);
    n.setXYZ(b, x * k, y * k, z * k);
  }
}

/**
 * 坐姿形（绑定空间，坐下时全部跟 hips）。座上的袍子有一圈“外沿”：前沿在两膝前、两侧沿大腿外侧、后沿在臀后座面高。
 * 每一列（站姿时绕身体的角度 θ）对应外沿上同一角度的一点 O(θ)：这列布从顶圈出发，横着铺过大腿面（前片往前上到腿面）走到 O，
 * 在外沿处圆角翻下，再垂直落到脚背上 3cm（前、侧）；后片到座面高后往身下收（不穿过椅面）。按弧长把站姿的点铺到这条路径上
 * （袍子比路径长就整体按比例压缩：下摆处的布略堆；旗袍短，下摆停在路径中途）。两膝之间的前帘往里兜一道垂褶。
 * 地板在绑定空间的高度 = 坐姿下移 dNom（land.leg.sitDrop）；运行时按实际下移修正 fall 部分。
 */
function seatedShape(ctx: BuildCtx, st: LowerStyle, geo: THREE.BufferGeometry, nRows: number, yTop: number, yHem: number): { pos: Float32Array; fall: Float32Array } {
  const s = ctx.s, p = ctx.profile;
  const qipao = st.bottom === 'qipao_skirt';
  const b = ctx.layout.bind;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const out = new Float32Array(pos.count * 3);
  const fall = new Float32Array(pos.count);
  const Wd = C + 1;
  const hx = b.hipR[0], yh = b.hipR[1];
  const Lth = b.hipR[1] - b.kneeR[1];
  // 大腿（坐下时水平）半径与布离腿的空隙
  const rt = qipao ? 0.074 * s : 0.085 * s * p.bw;
  const gap = (qipao ? 0.008 : 0.02) * s;
  const Wlap = hx + rt + gap;
  const zKnee = -Lth - 0.062 * s - gap;
  const floor = ctx.land.leg.sitDrop;
  const yHemSeat = floor + 0.105 * s;
  const ySeat = floor + ctx.land.leg.seatY + 0.008 * s;
  const rc = 0.045 * s;
  /** 腿面高度（坐着时两条水平大腿的上表面 + 空隙；两腿之间略凹） */
  const lapY = (x: number) => {
    const ax = Math.abs(x);
    // fix1：两腿之间的布往下兜得更深（腿面不是一块平板）
    if (ax <= hx) return yh + rt + gap - 0.032 * s * Math.pow(1 - (ax / hx) ** 2, 1.5);
    // 大腿外侧：布从腿的最宽处略上方翻下（外沿 |x| = Wlap 处仍比髋关节高 0.39·(rt+gap)，侧面整段都盖住）
    const d = Math.min(1, ((ax - hx) / (rt + gap)) * 0.92);
    return yh + (rt + gap) * Math.sqrt(1 - d * d);
  };
  // 外沿：前 zKnee、后 zBack、半宽 Wlap 的圆角矩形（超椭圆 n = 6），按角度取点
  const zBack = 0.115 * s * Math.sqrt(p.bd) + gap;
  const zMid = (zKnee + zBack) / 2, hz = (zBack - zKnee) / 2;
  const Wc0z = ctx.seams.WAIST.centre[2];
  const sp = (c: number, e: number) => Math.sign(c) * Math.pow(Math.abs(c), e);
  const P = new THREE.Vector3();
  for (let c = 0; c <= C; c++) {
    const col: THREE.Vector3[] = [];
    for (let j = 0; j < nRows; j++) col.push(new THREE.Vector3().fromBufferAttribute(pos, j * Wd + c));
    const ell: number[] = [0];
    for (let j = 1; j < nRows; j++) ell.push(ell[j - 1]! + col[j]!.distanceTo(col[j - 1]!));
    const th = ((c % C) / C) * Math.PI * 2;
    const cs = Math.cos(th), sn = Math.sin(th);
    const O = new THREE.Vector3(Wlap * sp(cs, 1 / 3), 0, zMid - hz * sp(sn, 1 / 3));
    // 这一点的沿高：前、侧 = 腿面（侧面 = 髋关节高）；后面逐渐降到座面
    const backness = smooth01(-0.02 * s, zBack * 0.7, O.z);
    const E = lapY(O.x) * (1 - backness) + ySeat * backness;
    O.y = E;
    const top = col[0]!;
    const path: THREE.Vector3[] = [top.clone()];
    // fix1：土地的酒桶肚把腰带、袍子上口顶到了大腿根的前上方：坐下时前片先在肚子底下往回、往上兜到腿面，再往前铺
    // （不然大腿根到肚皮之间一截没有布盖着）
    let from = top;
    if (p.deity && !qipao && top.z < Wc0z - 0.06 * s && backness < 0.5) {
      from = new THREE.Vector3(top.x, Math.max(top.y, lapY(top.x) - 0.004 * s), top.z + 0.04 * s);
      path.push(from.clone());
    }
    // 横铺：顶圈 → O（前片往前上到腿面，不低于腿面）
    const K = 7;
    for (let k = 1; k <= K; k++) {
      const u = k / K;
      const q = new THREE.Vector3().lerpVectors(from, O, u);
      const ylin = from.y + (E - from.y) * Math.pow(u, backness > 0.5 ? 0.6 : 1.6);
      const onLap = q.z < -0.04 * s ? lapY(q.x) : -Infinity;
      q.y = Math.max(ylin, onLap);
      path.push(q);
    }
    // 外沿的圆角与下垂（后片：往身下收）
    const outDir = new THREE.Vector3(O.x, 0, O.z - zMid).normalize();
    const between = Math.max(0, 1 - (O.x / Math.max(hx, 1e-6)) ** 2) * smooth01(0.2, 0.7, sn);
    const kneeBump = Math.exp(-Math.pow((Math.abs(O.x) - hx) / (0.6 * rt), 2));
    if (backness < 0.5) {
      for (let k = 1; k <= 3; k++) {
        const a = (k / 3) * (Math.PI / 2);
        path.push(O.clone().addScaledVector(outDir, Math.sin(a) * rc).add(new THREE.Vector3(0, -(1 - Math.cos(a)) * rc, 0)));
      }
      const start = path[path.length - 1]!.clone();
      // 下垂到多低：膝前落到脚背上，越往后（侧面靠座位那头）越短——侧面的下摆是一条从膝下斜向座面的线，不是一整块方板
      const rear = smooth01(zKnee + 0.12 * s, -0.04 * s, O.z);
      const yEnd = yHemSeat + (ySeat - 0.03 * s - yHemSeat) * rear;
      // 侧帘下半截往里收（贴着小腿后面的空当），前帘两膝之间往里兜一道垂褶
      const nDrop = 7;
      for (let k = 1; k <= nDrop; k++) {
        const f = k / nDrop;
        const q = start.clone();
        q.y = start.y - (start.y - yEnd) * f;
        q.addScaledVector(outDir, -(qipao ? 0.095 : 0.06) * s * between * Math.sin(Math.min(1, f * 1.5) * Math.PI / 2));
        // 膝头把布顶出来：前帘在两膝处鼓、往下渐平（站在正前方看不再是一块平板）
        q.addScaledVector(outDir, 0.016 * s * kneeBump * (1 - f) * (1 - rear));
        q.addScaledVector(outDir, -0.025 * s * rear * f * f);
        path.push(q);
      }
    } else {
      const inward = new THREE.Vector3(-O.x * 0.5, 0, zMid - O.z).multiplyScalar(0.6);
      // fix1：后片落到座面就往身下收（不在座面下面垂出一团）
      path.push(O.clone().add(new THREE.Vector3(0, -0.004 * s, -0.006 * s)), O.clone().add(inward).add(new THREE.Vector3(0, -0.005 * s, 0)));
    }
    const len = pathLen(path), total = ell[nRows - 1]!;
    const scale = Math.min(1, len / Math.max(1e-6, total));
    for (let j = 0; j < nRows; j++) {
      const v = j * Wd + c;
      const q = j === 0 ? top.clone() : atLen(path, Math.min(len, ell[j]! * scale), P.clone());
      out.set([q.x, q.y, q.z], v * 3);
      fall[v] = backness < 0.5 ? smooth01(E - rc, E - rc - 0.12 * s, q.y) : 0;
    }
  }
  void yTop; void yHem;
  return { pos: out, fall };
}

function pathLen(pts: readonly THREE.Vector3[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += pts[i]!.distanceTo(pts[i - 1]!);
  return l;
}

/** 折线上弧长 l 处的点（超出末端时沿最后一段延长）。 */
function atLen(pts: readonly THREE.Vector3[], l: number, out: THREE.Vector3): THREE.Vector3 {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i]!.distanceTo(pts[i - 1]!);
    if (acc + d >= l || i === pts.length - 1) {
      const k = d > 1e-9 ? (l - acc) / d : 0;
      return out.lerpVectors(pts[i - 1]!, pts[i]!, k);
    }
    acc += d;
  }
  return out.copy(pts[0]!);
}
