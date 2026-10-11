// owner: WP2
// char2 WP-U：衬衫款式的立体细节——领子（自己一个网格 'collar'：衬衫领、敞领、立领、中式立领、圆领罗纹边），
// 以及贴在衣服表面上的薄片（门襟、扣子、口袋与袋盖、拉链、大襟盘扣）：按 PLAN §2.3 放在躯干网格的索引前面（order -1/-2），
// 魂影里只画最外一层。薄片的位置由“从外面往躯干打射线”求表面点，下摆、褶、胸都跟着走。

import * as THREE from 'three';
import { boneIndex } from '../profile';
import { smooth01 } from '../shared';
import type { GarmentSpec } from '../types';
import { neckBasePoint, vHalfAt, type UpperDims } from './dims';
import { MeshBuilder, type Skin } from './mesh';

const B = (n: Parameters<typeof boneIndex>[0]) => boneIndex(n);
const PLAIN_UV: [number, number] = [0.93, 0.5];
const DEBUG_POCKETS = (globalThis as { __wpuDebug?: boolean }).__wpuDebug === true;

// ================================================================ 表面查询（对已建好的躯干三角形打射线）

export class TorsoSurface {
  private readonly tris: number[] = [];
  constructor(private readonly mb: MeshBuilder, pieces: readonly number[]) {
    for (let t = 0; t < mb.triCount; t++) if (pieces.includes(mb.triPiece[t]!)) this.tris.push(t);
  }
  private readonly _a = new THREE.Vector3();
  private readonly _b = new THREE.Vector3();
  private readonly _c = new THREE.Vector3();
  private readonly _ray = new THREE.Ray();
  private readonly _hit = new THREE.Vector3();
  /** 从 origin 沿 dir 打到躯干上最近的点：返回点与面法线（朝外：与 dir 相反的一侧），打不中 null。 */
  cast(origin: THREE.Vector3, dir: THREE.Vector3): { p: THREE.Vector3; n: THREE.Vector3 } | null {
    this._ray.set(origin, dir.clone().normalize());
    let best = Infinity;
    let bp: THREE.Vector3 | null = null, bn: THREE.Vector3 | null = null;
    for (const t of this.tris) {
      const m = this.mb;
      m.P(m.tri[t * 3]!, this._a); m.P(m.tri[t * 3 + 1]!, this._b); m.P(m.tri[t * 3 + 2]!, this._c);
      const h = this._ray.intersectTriangle(this._a, this._b, this._c, false, this._hit);
      if (!h) continue;
      const dd = h.distanceTo(origin);
      if (dd < best) {
        best = dd;
        bp = h.clone();
        bn = new THREE.Vector3().subVectors(this._b, this._a).cross(new THREE.Vector3().subVectors(this._c, this._a)).normalize();
        if (bn.dot(this._ray.direction) > 0) bn.negate();
      }
    }
    return bp && bn ? { p: bp, n: bn } : null;
  }
  /** 正面 (x, y) 处的表面点（从前面往 +z 打）。 */
  front(x: number, y: number): { p: THREE.Vector3; n: THREE.Vector3 } | null {
    return this.cast(new THREE.Vector3(x, y, -1), new THREE.Vector3(0, 0, 1));
  }
  /** 角度 t（0 = +x、π/2 = 前）处、高 y 的表面点（从外面往中轴打）。 */
  around(t: number, y: number, zc = 0): { p: THREE.Vector3; n: THREE.Vector3 } | null {
    const d = new THREE.Vector3(-Math.cos(t), 0, Math.sin(t));
    return this.cast(new THREE.Vector3(Math.cos(t), y, zc - Math.sin(t)), d);
  }
}

// ================================================================ 贴面薄片

/** 表面上的一块薄片：grid[i][j] 是表面点与法线（i 沿第一个方向、j 沿第二个方向），抬高 h，四周围一圈侧壁插到表面下 1mm。 */
function slab(mb: MeshBuilder, grid: { p: THREE.Vector3; n: THREE.Vector3 }[][], h: number, piece: number, skin: (p: THREE.Vector3) => Skin, below = 0.001): void {
  const ni = grid.length, nj = grid[0]!.length;
  const top: number[][] = [], bot: number[][] = [];
  for (let i = 0; i < ni; i++) {
    top.push([]); bot.push([]);
    for (let j = 0; j < nj; j++) {
      const { p, n } = grid[i]![j]!;
      const q = p.clone().addScaledVector(n, h);
      top[i]!.push(mb.v(q.x, q.y, q.z, PLAIN_UV[0], PLAIN_UV[1], skin(p)));
      const r = p.clone().addScaledVector(n, -below);
      bot[i]!.push(mb.v(r.x, r.y, r.z, PLAIN_UV[0], PLAIN_UV[1], skin(p)));
    }
  }
  const t0 = mb.triCount;
  // 顶面（每格按当地法线定绕向）
  for (let i = 0; i + 1 < ni; i++) for (let j = 0; j + 1 < nj; j++) {
    const n = grid[i]![j]!.n;
    mb.tOriented(top[i]![j]!, top[i + 1]![j]!, top[i + 1]![j + 1]!, piece, n);
    mb.tOriented(top[i]![j]!, top[i + 1]![j + 1]!, top[i]![j + 1]!, piece, n);
  }
  void t0;
  // 侧壁：沿边界一圈（顶面边 → 底面边），绕向朝外（离薄片中心）
  const border: [number, number][] = [];
  for (let j = 0; j < nj; j++) border.push([0, j]);
  for (let i = 1; i < ni; i++) border.push([i, nj - 1]);
  for (let j = nj - 2; j >= 0; j--) border.push([ni - 1, j]);
  for (let i = ni - 2; i > 0; i--) border.push([i, 0]);
  for (let k = 0; k < border.length; k++) {
    const [i0, j0] = border[k]!, [i1, j1] = border[(k + 1) % border.length]!;
    const a = top[i0]![j0]!, b = top[i1]![j1]!, c = bot[i0]![j0]!, e = bot[i1]![j1]!;
    // 外侧：从格子里面一格指向边上
    const ii = Math.min(ni - 1, Math.max(0, i0 === 0 ? 1 : i0 === ni - 1 ? ni - 2 : i0)), jj = Math.min(nj - 1, Math.max(0, j0 === 0 ? 1 : j0 === nj - 1 ? nj - 2 : j0));
    const nAvg = grid[i0]![j0]!.n;
    const out = grid[i0]![j0]!.p.clone().sub(grid[ii]![jj]!.p);
    if (out.lengthSq() < 1e-12) out.copy(grid[i1]![j1]!.p).sub(grid[ii]![jj]!.p);
    out.addScaledVector(nAvg, -out.dot(nAvg));
    mb.tOriented(a, b, e, piece, out);
    mb.tOriented(a, e, c, piece, out);
  }
}


/** 小圆扣（六边形的小圆顶，12 个三角形）：中心 c、外法线 n、半径 r、高 h。 */
function button(mb: MeshBuilder, c: THREE.Vector3, n: THREE.Vector3, r: number, h: number, piece: number, skin: Skin): void {
  const ex = new THREE.Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize();
  const ey = new THREE.Vector3().crossVectors(n, ex).normalize();
  const top = c.clone().addScaledVector(n, h);
  const ct = mb.v(top.x, top.y, top.z, PLAIN_UV[0], PLAIN_UV[1], skin);
  const rim: number[] = [], base: number[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const q = c.clone().addScaledVector(ex, Math.cos(a) * r).addScaledVector(ey, Math.sin(a) * r);
    const qr = q.clone().addScaledVector(n, h * 0.55);
    rim.push(mb.v(qr.x, qr.y, qr.z, PLAIN_UV[0], PLAIN_UV[1], skin));
    const qb = q.clone().addScaledVector(n, -0.0008).addScaledVector(ex, Math.cos(a) * r * 0.1).addScaledVector(ey, Math.sin(a) * r * 0.1);
    base.push(mb.v(qb.x, qb.y, qb.z, PLAIN_UV[0], PLAIN_UV[1], skin));
  }
  for (let k = 0; k < 6; k++) {
    const k1 = (k + 1) % 6;
    mb.tOriented(ct, rim[k]!, rim[k1]!, piece, n);
    const out = mb.P(rim[k]!).add(mb.P(rim[k1]!)).multiplyScalar(0.5).sub(c);
    mb.tOriented(rim[k]!, base[k]!, base[k1]!, piece, out);
    mb.tOriented(rim[k]!, base[k1]!, rim[k1]!, piece, out);
  }
}

export interface OverlayPieces { body: number; top: number }

/**
 * 门襟、扣子、口袋、拉链、大襟。surf：躯干表面查询；skinAt：薄片的蒙皮（跟躯干同一点一样）；yBottom：衣服下沿；yNeckFront：领口前点。
 */
export function buildOverlays(mb: MeshBuilder, d: UpperDims, g: Readonly<GarmentSpec>, surf: TorsoSurface, pc: OverlayPieces,
  skinAt: (p: THREE.Vector3) => Skin, yBottom: number, yNeckFront: number): void {
  const s = d.s;
  const W = d.W;
  const front = (x: number, y: number) => surf.front(x, y);
  const gridFront = (x0: number, x1: number, y0: number, y1: number, ni: number, nj: number) => {
    const rows: { p: THREE.Vector3; n: THREE.Vector3 }[][] = [];
    for (let i = 0; i < ni; i++) {
      const y = y0 + ((y1 - y0) * i) / (ni - 1);
      const row: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
      for (let j = 0; j < nj; j++) {
        const x = x0 + ((x1 - x0) * j) / (nj - 1);
        const h = front(x, y);
        if (!h) return null;
        row.push(h);
      }
      rows.push(row);
    }
    return rows;
  };
  const top = g.top;
  const placket = g.placket ?? 'none';
  const vOpen = g.collar === 'shirt_open';
  const yPlTop = vOpen ? vHalfAt(d, 0).yBot - 0.004 * s : yNeckFront - 0.012 * s;
  // ---- 敞领的两片驳头：顺着 V 口两边平铺在胸前（盖住衣服/皮肤的分界）
  if (vOpen) {
    const { yTop, yBot } = vHalfAt(d, 0);
    for (const sx of [-1, 1]) {
      const rows: { p: THREE.Vector3; n: THREE.Vector3 }[][] = [];
      const ni = 7;
      for (let i = 0; i < ni; i++) {
        const y = yBot + 0.006 * s + ((yTop - 0.012 * s - (yBot + 0.006 * s)) * i) / (ni - 1);
        const w = vHalfAt(d, y).w;
        const row: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
        // 驳头宽：下面窄、上面宽（领尖在上面）
        const wide = (0.012 + 0.016 * (i / (ni - 1))) * s;
        for (const o of [-Math.min(0.0095 * s, w + 0.004 * s), wide * 0.4, wide]) {
          const h = front(sx * (w + o), y);
          if (h) row.push(h);
        }
        if (row.length === 3) rows.push(sx > 0 ? row : row.reverse());
      }
      if (rows.length > 2) slab(mb, rows, (sx > 0 ? 0.0032 : 0.0026) * s, pc.top, skinAt);
    }
  }
  const yPlBot = yBottom + 0.006 * s;
  // ---- 门襟（扣子那一条）
  const buttons: number[] = [];
  if (placket === 'buttons' || placket === 'zhongshan5') {
    const hw = (placket === 'zhongshan5' ? 0.017 : 0.015) * s;
    const ni = Math.max(6, Math.round((yPlTop - yPlBot) / (0.02 * s)));
    const gr = gridFront(-hw, hw, yPlBot, yPlTop, ni, 3);
    if (gr) slab(mb, gr, 0.0018 * s, pc.body, skinAt);
    const n = placket === 'zhongshan5' ? 5 : 6;
    const yb0 = yPlTop - 0.012 * s, yb1 = Math.max(yPlBot + 0.04 * s, yPlTop - (placket === 'zhongshan5' ? 0.42 : 0.5) * s);
    for (let k = 0; k < n; k++) buttons.push(yb0 + ((yb1 - yb0) * k) / (n - 1));
  }
  if (top === 'jacket' && placket === 'none') {
    // 拉链：窄窄一条，领口下一个拉头
    const gr = gridFront(-0.0045 * s, 0.0045 * s, yPlBot, yPlTop, Math.max(6, Math.round((yPlTop - yPlBot) / (0.03 * s))), 2);
    if (gr) slab(mb, gr, 0.0011 * s, pc.body, skinAt);
    const tab = gridFront(-0.004 * s, 0.004 * s, yPlTop - 0.035 * s, yPlTop - 0.01 * s, 3, 2);
    if (tab) slab(mb, tab, 0.0028 * s, pc.top, skinAt);
  }
  for (const y of buttons) {
    const h = front(0, y);
    if (h) button(mb, h.p.clone().addScaledVector(h.n, 0.0016 * s), h.n, 0.0058 * s, 0.0026 * s, pc.top, skinAt(h.p));
  }
  // ---- 口袋
  const pocket = (cx: number, yTop: number, w: number, hgt: number, flap: number, buttonOn: boolean, dense = false) => {
    if (DEBUG_POCKETS) console.warn('pocket', cx.toFixed(3), yTop.toFixed(3), w.toFixed(3), hgt.toFixed(3));
    // fix1：格子密一点（贴着弯的衣服表面走，衣身不从薄片中间顶出来成锯齿）、抬高一点
    const body = gridFront(cx - w / 2, cx + w / 2, yTop - hgt, yTop, Math.max(6, Math.round(hgt / ((dense ? 0.011 : 0.017) * s))), Math.max(8, Math.round(w / ((dense ? 0.014 : 0.014) * s))));
    if (body) slab(mb, body, 0.0026 * s, pc.body, skinAt, 0.0025 * s);
    else if (DEBUG_POCKETS) console.warn('pocket body miss', cx, yTop, w, hgt);
    // 袋盖：底边中间略尖
    // 跨腰线的大口袋（中山装下兜）：衣服表面在这里先凹后鼓，袋盖多几行才贴得住
    const ni = dense ? 5 : 3, nj = dense ? 10 : 8;
    const rows: { p: THREE.Vector3; n: THREE.Vector3 }[][] = [];
    for (let i = 0; i < ni; i++) {
      const row: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
      for (let j = 0; j < nj; j++) {
        const fx = j / (nj - 1);
        const point = i === 0 ? 0.3 * flap * (1 - Math.abs(fx - 0.5) * 2) : 0;
        const y = yTop + 0.004 * s - flap * (1 - i / (ni - 1)) - point;
        const hh = front(cx - w / 2 - 0.003 * s + (w + 0.006 * s) * fx, y);
        if (!hh) return;
        row.push(hh);
      }
      rows.push(row);
    }
    slab(mb, rows, 0.0042 * s, pc.top, skinAt, 0.0025 * s);
    if (buttonOn) {
      const hb = front(cx, yTop + 0.004 * s - flap * 0.62);
      if (hb) button(mb, hb.p.clone().addScaledVector(hb.n, 0.0034 * s), hb.n, 0.0045 * s, 0.002 * s, pc.top, skinAt(hb.p));
    }
  };
  const pockets = g.pockets ?? 'none';
  const yChest = d.yS - 0.06 * s;
  const fK = d.female ? 0.85 : d.child ? 0.8 : 1;
  if (pockets === 'chest2' || pockets === 'chest1') {
    const w = 0.1 * s * fK, hgt = 0.12 * s * fK;
    for (const sx of pockets === 'chest1' ? [-1] : [-1, 1]) pocket(sx * 0.076 * W * fK, yChest, w, hgt, 0.034 * s * fK, pockets === 'chest2');
  } else if (pockets === 'zhongshan4') {
    for (const sx of [-1, 1]) pocket(sx * 0.072 * W, yChest + 0.005 * s, 0.092 * s, 0.11 * s, 0.032 * s, true);
    const yLow = d.yW + 0.025 * s;
    for (const sx of [-1, 1]) pocket(sx * 0.078 * W, yLow, 0.118 * s, Math.min(0.14 * s, yLow - yBottom - 0.03 * s), 0.038 * s, true, true);
  }
  // ---- 大襟（王奶奶）：从领口正前方斜到右腋下，再顺右侧缝往下；滚边 + 几副盘扣
  if (placket === 'side_frog') {
    const yA = d.yS - 0.085 * s;
    const path: { t: number; y: number }[] = [];
    const nS = 9;
    for (let k = 0; k <= nS; k++) {
      const e = k / nS;
      // 斜线：t 从 π/2（正前）到 0.42（右前侧），y 从领口到腋下，略呈弧形
      path.push({ t: Math.PI / 2 - (Math.PI / 2 - 0.42) * Math.pow(e, 0.8), y: yNeckFront - 0.006 * s - (yNeckFront - 0.006 * s - yA) * (e * e * 0.35 + e * 0.65) });
    }
    const nD = Math.max(3, Math.round((yA - yPlBot) / (0.05 * s)));
    for (let k = 1; k <= nD; k++) path.push({ t: 0.42 - 0.12 * (k / nD), y: yA - ((yA - yPlBot) * k) / nD });
    const hw = 0.006 * s;
    const rows: { p: THREE.Vector3; n: THREE.Vector3 }[][] = [];
    for (let k = 0; k < path.length; k++) {
      const a = path[Math.max(0, k - 1)]!, b = path[Math.min(path.length - 1, k + 1)]!;
      const c = surf.around(path[k]!.t, path[k]!.y);
      const pa = surf.around(a.t, a.y), pb = surf.around(b.t, b.y);
      if (!c || !pa || !pb) continue;
      const along = pb.p.clone().sub(pa.p).normalize();
      const side = new THREE.Vector3().crossVectors(c.n, along).normalize();
      const row: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
      for (const o of [-hw, hw]) {
        const q = c.p.clone().addScaledVector(side, o);
        const h = surf.cast(q.clone().addScaledVector(c.n, 0.05), c.n.clone().negate());
        row.push(h ?? { p: q, n: c.n.clone() });
      }
      rows.push(row);
    }
    if (rows.length > 2) slab(mb, rows, 0.0016 * s, pc.body, skinAt);
    // 盘扣：领口一副、斜襟上两副、腋下一副、侧缝两副
    const frogs = [0, 4, 7, nS, nS + Math.round(nD * 0.35), nS + Math.round(nD * 0.7)];
    for (const k of frogs) {
      const pt = path[Math.min(path.length - 1, k)]!;
      const c = surf.around(pt.t, pt.y);
      if (!c) continue;
      const side = new THREE.Vector3(0, 1, 0).cross(c.n).normalize();
      button(mb, c.p.clone().addScaledVector(c.n, 0.0016 * s), c.n, 0.0042 * s, 0.003 * s, pc.top, skinAt(c.p));
      for (const o of [-0.009, 0.009]) {
        const q = c.p.clone().addScaledVector(side, o * s);
        const h = surf.cast(q.clone().addScaledVector(c.n, 0.05), c.n.clone().negate());
        if (h) button(mb, h.p.clone().addScaledVector(h.n, 0.001 * s), h.n, 0.0028 * s, 0.0018 * s, pc.top, skinAt(h.p));
      }
    }
  }
  void smooth01;
}

// ================================================================ 领子（'collar'，自己一个网格）

/**
 * 领子：沿领根圈扫一个闭合的截面。type：shirt（衬衫翻领，领座 + 领面，前面有领尖）、shirt_open（敞开、领尖分开压在胸前）、
 * stand / mandarin（立领、中式立领，前面一道小口、圆角）、crew（圆领罗纹边，一整圈）。
 * yokeAt(t, dist)：领根往外 dist 处衣服表面的高度（翻领下沿压在肩上）。
 */
export function buildCollar(mb: MeshBuilder, d: UpperDims, g: Readonly<GarmentSpec>, piece: number, surf: TorsoSurface): void {
  const s = d.s;
  const type = g.collar;
  if (type === 'none') return;
  const spine = B('spine'), neck = B('neck');
  const k = d.female ? 0.9 : d.child ? 0.82 : 1;
  const grow = 0.0025 * s + d.pad * 0.5;
  const closed = type === 'crew';
  const gap = type === 'shirt' ? 0.16 : type === 'shirt_open' ? 1.45 : type === 'crew' ? 0 : 0.2;
  const nPath = closed ? 40 : 34;
  const t0 = Math.PI / 2 + gap / 2, t1 = Math.PI / 2 + 2 * Math.PI - gap / 2;
  const up = new THREE.Vector3(0, 1, 0.08).normalize();
  const rings: number[][] = [];
  const cen = new THREE.Vector3(d.nbC.x, 0, d.nbC.z);
  const tFrom = mb.triCount;
  for (let i = 0; i < (closed ? nPath : nPath + 1); i++) {
    const e = i / nPath;
    const t = t0 + (t1 - t0) * e;
    const base = neckBasePoint(d, t, grow, new THREE.Vector3());
    const rad = base.clone().sub(cen);
    rad.y = 0;
    rad.normalize();
    // 离前面开口多近（0 = 后背正中，1 = 开口边）
    const endK = closed ? 0 : Math.pow(Math.abs(e - 0.5) * 2, 3);
    let prof: [number, number][];
    if (type === 'shirt' || type === 'shirt_open') {
      const open = type === 'shirt_open';
      const hs = (open ? 0.024 : 0.027) * s * k * (1 - 0.35 * endK * (open ? 1.4 : 1));
      // 翻领下沿：顺着肩膀表面往外 fo 的那一点之上 2.5mm
      const fo = (0.026 + (open ? 0.03 : 0.016) * endK) * s * k;
      const fallExtra = (open ? 0.05 : 0.026) * endK * s * k;
      const p = base.clone().addScaledVector(rad, fo).add(new THREE.Vector3(0, 0.06, 0));
      const hit = surf.cast(p, new THREE.Vector3(0, -1, 0));
      let fallY = base.y - 0.012 * s;
      if (hit) fallY = hit.p.y + 0.0028 * s;
      const fall = Math.max(0.018 * s, base.y + hs - fallY) + fallExtra * 0.4;
      prof = [
        [0.0026 * s, -0.001 * s], [0.0022 * s, hs * 0.5], [0.0028 * s, hs], [0.0055 * s, hs + 0.0026 * s], [0.0085 * s, hs - 0.0004 * s],
        [0.0085 * s + fo * 0.35, hs - fall * 0.32], [fo * 0.78, hs - fall * 0.74], [fo, hs - fall], [fo - 0.0028 * s, hs - fall - 0.0014 * s],
        [fo * 0.45, -0.003 * s], [0.0072 * s, -0.004 * s],
      ];
    } else if (type === 'stand' || type === 'mandarin') {
      const h = (type === 'stand' ? 0.034 : 0.031) * s * k * (1 - 0.45 * Math.pow(endK, 2));
      prof = [[0.0026 * s, -0.001 * s], [0.002 * s, h * 0.5], [0.0022 * s, h], [0.0042 * s, h + 0.0022 * s], [0.0068 * s, h - 0.0006 * s],
        [0.0074 * s, h * 0.45], [0.0074 * s, 0.002 * s], [0.0062 * s, -0.0038 * s]];
    } else {
      prof = [[0.0008 * s, -0.003 * s], [0.0012 * s, 0.006 * s], [0.0035 * s, 0.0098 * s], [0.0062 * s, 0.0068 * s], [0.0068 * s, 0.001 * s], [0.0045 * s, -0.0042 * s]];
    }
    const pts = prof.map(([rho, eta]) => base.clone().addScaledVector(rad, rho).addScaledVector(up, eta));
    const idx = mb.ring(pts, 0, (p) => {
      const kk = smooth01(base.y - 0.01 * s, base.y + 0.03 * s, p.y);
      return [[spine, 0.85 - 0.25 * kk], [neck, 0.15 + 0.25 * kk]];
    }, () => PLAIN_UV[0]);
    rings.push(idx);
  }
  const nR = rings.length;
  for (let i = 0; i + 1 < (closed ? nR + 1 : nR); i++) mb.strip(rings[i]!, rings[(i + 1) % nR]!, piece);
  // 截面的绕向：按最近一圈截面的中心定（闭合截面，中心在布料里面）
  const cents = rings.map(r => {
    const c = new THREE.Vector3();
    for (let q = 0; q < r.length - 1; q++) c.add(mb.P(r[q]!));
    return c.multiplyScalar(1 / (r.length - 1));
  });
  mb.orient(tFrom, mb.triCount, q => {
    let best = cents[0]!, bd = Infinity;
    for (const c of cents) { const dd = c.distanceToSquared(q); if (dd < bd) { bd = dd; best = c; } }
    return best;
  });
  // 两头封口（截面扇形）
  if (!closed) {
    for (const r of [rings[0]!, rings[nR - 1]!]) {
      const c = new THREE.Vector3();
      const m = r.length - 1;
      for (let q = 0; q < m; q++) c.add(mb.P(r[q]!));
      c.multiplyScalar(1 / m);
      const ci = mb.v(c.x, c.y, c.z, PLAIN_UV[0], PLAIN_UV[1], [[spine, 0.75], [neck, 0.25]]);
      const dir = r === rings[0] ? mb.P(rings[0]![0]!).sub(mb.P(rings[1]![0]!)) : mb.P(rings[nR - 1]![0]!).sub(mb.P(rings[nR - 2]![0]!));
      for (let q = 0; q < m; q++) mb.tOriented(r[q]!, r[q + 1]!, ci, piece, dir);
    }
  }
}

/**
 * 长袍上衣的交领（右衽）：一条 3.5cm 宽的领缘，从右前颈绕到后颈、左前颈，再斜过胸口到右腋下（左襟压右襟）。
 * 贴在衣身表面上（自己的 'collar' 网格，袍料）。
 */
export function buildRobeCollar(mb: MeshBuilder, d: UpperDims, piece: number, surf: TorsoSurface, skinAt: (p: THREE.Vector3) => Skin): void {
  const s = d.s;
  const path: THREE.Vector3[] = [];
  // 颈部一圈（领根外 1.2cm），t 从右前（π/2 - 0.55）往后绕到左前（-π - 0.6）
  const t0 = Math.PI / 2 - 0.55, t1 = -Math.PI - 0.6;
  const nNeck = 22;
  for (let i = 0; i <= nNeck; i++) {
    const t = t0 + ((t1 - t0) * i) / nNeck;
    const b = neckBasePoint(d, t, 0.012 * s, new THREE.Vector3());
    const hit = surf.cast(b.clone().add(new THREE.Vector3(0, 0.08, 0)), new THREE.Vector3(0, -1, 0));
    path.push(hit ? hit.p : b);
  }
  // 斜襟：左前颈 → 右腋下
  const start = path[path.length - 1]!;
  const yEnd = d.yS - 0.11 * s;
  const tS = Math.atan2(-(start.z - d.nbC.z), start.x), tE = 0.38;
  const tStart = tS < 0 ? tS + Math.PI * 2 : tS;
  const nDiag = 12;
  for (let i = 1; i <= nDiag; i++) {
    const e = i / nDiag;
    const t = tStart + (tE - tStart) * e;
    const y = start.y + (yEnd - start.y) * (e * 0.75 + 0.25 * e * e);
    const h = surf.around(t, y, d.nbC.z * (1 - e));
    if (h) path.push(h.p);
  }
  // 拐角处圆滑（Chaikin 两遍），再贴回衣面
  let pts = path;
  for (let it = 0; it < 2; it++) {
    const out = [pts[0]!];
    for (let i = 0; i + 1 < pts.length; i++) {
      out.push(pts[i]!.clone().lerp(pts[i + 1]!, 0.25), pts[i]!.clone().lerp(pts[i + 1]!, 0.75));
    }
    out.push(pts[pts.length - 1]!);
    pts = out;
  }
  path.length = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const p = pts[i]!;
    const rad = new THREE.Vector3(p.x, 0.6 * Math.max(0, p.y - d.yS) / (0.1 * s), p.z - d.nbC.z).normalize();
    const h = surf.cast(p.clone().addScaledVector(rad, 0.05), rad.clone().negate());
    path.push(h ? h.p : p);
  }
  const rows: { p: THREE.Vector3; n: THREE.Vector3 }[][] = [];
  let prevSide: THREE.Vector3 | null = null;
  const W = 0.034 * s;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const a = path[Math.max(0, i - 1)]!, b = path[Math.min(path.length - 1, i + 1)]!;
    const along = b.clone().sub(a).normalize();
    const base = surf.cast(p.clone().add(new THREE.Vector3(p.x, 0.05, p.z - d.nbC.z).normalize().multiplyScalar(0.06)), new THREE.Vector3(-p.x, -0.4, -(p.z - d.nbC.z)).normalize());
    const n = base ? base.n : new THREE.Vector3(p.x, 0.5, p.z).normalize();
    let side = new THREE.Vector3().crossVectors(n, along).normalize();
    const ref = prevSide ?? new THREE.Vector3(p.x, 0, p.z - d.nbC.z).normalize();
    if (side.dot(ref) < 0) side.negate();
    prevSide = side;
    const row: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (const o of [-0.003 * s, W * 0.5, W]) {
      const q = p.clone().addScaledVector(side, o);
      const h = surf.cast(q.clone().addScaledVector(n, 0.05), n.clone().negate());
      row.push(h ?? { p: q, n: n.clone() });
    }
    rows.push(row);
  }
  if (rows.length > 3) slab(mb, rows, 0.004 * s, piece, skinAt);
}
