// owner: WP2
// char2 WP-H：黄鼬头（黄三爷在取景器里的样子，PLAN §3.1“Weasel head”）。
// 一整块放样：扁宽的脑壳、短而收尖的吻部、黑鼻垫、嘴线、脸颊的毛蓬、嵌进去的亮黑眼珠（几何是小圆顶，画上黑和高光）、
// 头顶两侧低低的圆耳朵（内侧画粉）；底下一圈就是 NECK_TOP（脖子由上身那边做，西装领子照样贴合）。
// 毛皮贴图 256×256（白下巴与腮、深色背脊与眼周、毛流）；胡须仍是 LineSegments（红外下隐藏），每边 6 根、短、弯、细。

import * as THREE from 'three';
import { TEMP_C } from '../../../data/render';
import { canvasToTexture, createCanvas, hexRgb } from '../../../kit/canvas';
import { newMat } from '../../../kit/geom';
import { rng } from '../../../kit/rng';
import type { HeadPreset, SculptKey } from '../types';
import { DEG, EAR_ISLAND, HEAD_C, alphaOfV, g2, monotone, polyline, psiOfU, sstep } from './mapping';
import type { HeadParams } from './params';
import { makeProj } from './paint';
import { type HeadMeshData, type HeadSurface, type SeamU, addShell, cross, norm, orientAndNormals, solveLine } from './shape';

type V3 = [number, number, number];

const sq = (k: readonly (readonly [number, number])[]) => monotone(k.map(([y, v]) => [y, v * v] as const));
const WW = sq([[0.035, 0.02], [0.05, 0.03], [0.07, 0.039], [0.09, 0.046], [0.11, 0.055], [0.13, 0.064], [0.15, 0.07], [0.165, 0.0715], [0.18, 0.068], [0.192, 0.059], [0.2, 0.046], [0.206, 0.028], [0.209, 0]]);
const FF = sq([[0.035, 0.045], [0.055, 0.062], [0.075, 0.086], [0.09, 0.115], [0.104, 0.141], [0.116, 0.147], [0.127, 0.14], [0.138, 0.122], [0.15, 0.103], [0.163, 0.088], [0.178, 0.076], [0.19, 0.064], [0.2, 0.048], [0.206, 0.029], [0.209, 0]]);
const BB = sq([[0.035, 0.03], [0.07, 0.046], [0.085, 0.056], [0.1, 0.07], [0.12, 0.084], [0.15, 0.09], [0.168, 0.086], [0.182, 0.076], [0.193, 0.062], [0.201, 0.046], [0.206, 0.028], [0.209, 0]]);
const NFW = polyline([[0.035, 2.0], [0.07, 1.9], [0.09, 1.65], [0.115, 1.6], [0.14, 1.8], [0.17, 2.2], [0.228, 2.1]]);
const YT = 0.209, YB = 0.035;

/** 黄鼬的眼（单位坐标，右眼；落在基础头形表面上，见 surfZ）。 */
const EYE: V3 = [0.036, 0.152, 0];
/** 鼻垫（吻尖）。 */
const NOSE: V3 = [0, 0.117, 0];

function weaselSurface(): HeadSurface {
  const f = (x: number, y: number, z: number): number => {
    if (y >= YT) return 1 + (y - YT) * 50;
    const Wd = Math.max(1e-5, Math.sqrt(Math.max(0, WW(y)))), F = Math.max(1e-5, Math.sqrt(Math.max(0, FF(y)))), B = Math.max(1e-5, Math.sqrt(Math.max(0, BB(y))));
    const front = z < 0;
    const n = front ? NFW(y) : 2.2;
    const rho = Math.pow(Math.pow(Math.abs(x / Wd), n) + Math.pow(Math.abs(z / (front ? F : B)), n), 1 / n);
    return Math.max(rho - 1, (YB - y) * 60);
  };
  const surfZ = (x: number, y: number) => {
    let lo = -0.25, hi = 0;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (f(x, y, m) > 0) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  EYE[2] = surfZ(EYE[0], EYE[1]) + 0.002;
  NOSE[2] = surfZ(0, NOSE[1]);
  const C = HEAD_C;
  const base = (d: Readonly<V3>, out: { P: V3; n: V3 }) => {
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
    const r = (lo + hi) / 2;
    out.P[0] = C[0] + d[0] * r; out.P[1] = C[1] + d[1] * r; out.P[2] = C[2] + d[2] * r;
    const e = 2e-4, P = out.P;
    const gx = f(P[0] + e, P[1], P[2]) - f(P[0] - e, P[1], P[2]), gy = f(P[0], P[1] + e, P[2]) - f(P[0], P[1] - e, P[2]), gz = f(P[0], P[1], P[2] + e) - f(P[0], P[1], P[2] - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    out.n[0] = gx / l; out.n[1] = gy / l; out.n[2] = gz / l;
  };
  const features = (P: Readonly<V3>, n: Readonly<V3>): number => {
    const x = P[0], y = P[1], z = P[2], ax = Math.abs(x);
    let d = 0;
    // 眼：一圈浅窝，中间一个亮晶晶的小圆顶
    const er = Math.hypot(ax - EYE[0], y - EYE[1], z - EYE[2]);
    d -= 0.0016 * Math.exp(-((er / 0.013) ** 2));
    d += 0.0052 * Math.exp(-((er / 0.0085) ** 2.2));
    // 眉上的毛脊
    d += 0.0018 * g2(ax - 0.042, y - 0.172, 0.014, 0.006) * sstep(-0.2, 0.4, -n[2]);
    // 鼻垫
    const nr = Math.hypot(x, y - NOSE[1], z - NOSE[2]);
    d += 0.0032 * Math.exp(-((nr / 0.009) ** 2));
    // 嘴线（吻部下缘往后的一道沟）
    const mouthY = 0.103 + (z + 0.14) * 0.05;
    d -= 0.0018 * g2(0, y - mouthY, 1, 0.0022) * sstep(-0.02, -0.07, z) * sstep(0.2, 0.6, Math.abs(n[0]) + (-n[2]) * 0.6);
    // 腮帮的毛蓬、下巴
    d += 0.0022 * g2(ax - 0.05, y - 0.098, 0.016, 0.014) * sstep(-0.4, 0.2, -n[2]);
    d += 0.0025 * g2(x, y - 0.075, 0.02, 0.012) * sstep(0, 0.5, -n[2]);
    // 毛簇（脖子一圈更蓬）
    const a = Math.atan2(Math.hypot(x, z - HEAD_C[2]), -(y - HEAD_C[1])), p = Math.atan2(-x, -(z - HEAD_C[2]));
    d += (0.0004 + 0.0014 * (1 - sstep(48 * DEG, 70 * DEG, a))) * Math.sin(p * 13 + a * 9) * Math.sin(p * 7 - a * 5);
    d += 0.0028 * (1 - sstep(46 * DEG, 64 * DEG, a));
    return d;
  };
  const tmp = { P: [0, 0, 0] as V3, n: [0, 0, 0] as V3 };
  const p: HeadParams = { preset: 'man' as HeadPreset, female: false, child: false, old: false, deity: false, sc: {} as Record<SculptKey, number>, hair: 'none' };
  return {
    p,
    hair: { line: null, tTop: 0, tSide: 0, tBack: 0, tNape: 0, ramp: 0.02 },
    noseBase: -1,
    f, base, features,
    hairAt: () => 0,
    final(psi, alpha, out: V3 = [0, 0, 0]) {
      const sa = Math.sin(alpha);
      base([-Math.sin(psi) * sa, -Math.cos(alpha), -Math.cos(psi) * sa], tmp);
      const dd = features(tmp.P, tmp.n);
      out[0] = tmp.P[0] + tmp.n[0] * dd; out[1] = tmp.P[1] + tmp.n[1] * dd; out[2] = tmp.P[2] + tmp.n[2] * dd;
      return out;
    },
  };
}

/** 圆耳朵（头顶两侧，口朝前外）：底圈埋进头 1mm → 背面 → 耳缘 → 耳窝 → 底。 */
function addRoundEar(out: HeadMeshData, surf: HeadSurface, side: 1 | -1): void {
  const c0: V3 = [side * 0.05, 0.186, 0.02];
  const en = norm([side * 0.62, 0.72, 0.1]);
  const t = solveLine(surf, c0, en, -0.03);
  const c: V3 = [c0[0] + en[0] * t, c0[1] + en[1] * t, c0[2] + en[2] * t];
  const ea = norm(cross(en, [0, 0, 1]));
  const eb = norm(cross(en, ea));
  const rings: [number, number][] = [[0.0145, -0.001], [0.0175, 0.0045], [0.0215, 0.0085], [0.0205, 0.0098], [0.0145, 0.0052], [0.0065, 0.0028]];
  const seg = 12;
  const base = out.pos.length / 3;
  const I = EAR_ISLAND;
  const u0 = side > 0 ? I.u0R : I.u0L;
  for (const [rr, hh] of rings) {
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      // 前沿低、后沿高（耳口朝前）
      const tilt = 1 + 0.35 * Math.sin(th);
      const q: V3 = [c[0] + (ea[0] * Math.cos(th) + eb[0] * Math.sin(th)) * rr, c[1] + (ea[1] * Math.cos(th) + eb[1] * Math.sin(th)) * rr, c[2] + (ea[2] * Math.cos(th) + eb[2] * Math.sin(th)) * rr];
      const h = hh * (hh > 0 ? tilt : 1);
      out.pos.push(q[0] + en[0] * h, q[1] + en[1] * h, q[2] + en[2] * h);
      out.nor.push(0, 0, 0);
      out.uv.push(u0 + I.w * (0.5 + 0.45 * Math.cos(th) * (rr / 0.0205)), I.v0 + I.h * (0.5 + 0.45 * Math.sin(th) * (rr / 0.0205)));
    }
  }
  out.pos.push(c[0] + en[0] * 0.004, c[1] + en[1] * 0.004, c[2] + en[2] * 0.004);
  out.nor.push(0, 0, 0);
  out.uv.push(u0 + I.w * 0.5, I.v0 + I.h * 0.5);
  const centre = base + rings.length * seg;
  const idx: number[] = [];
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let i = 0; i < seg; i++) {
      const a = base + r * seg + i, b = base + r * seg + ((i + 1) % seg), e = base + (r + 1) * seg + i, g = base + (r + 1) * seg + ((i + 1) % seg);
      idx.push(a, b, e, b, g, e);
    }
  }
  for (let i = 0; i < seg; i++) idx.push(base + (rings.length - 1) * seg + i, base + (rings.length - 1) * seg + ((i + 1) % seg), centre);
  orientAndNormals(out, idx, base, centre + 1, (i, n) => {
    if (i < base + seg * 2) return 0;
    const P = out.pos;
    return (P[i * 3]! - c[0]) * n[0] + (P[i * 3 + 1]! - c[1]) * n[1] + (P[i * 3 + 2]! - c[2]) * n[2] + (i < base + seg * 3 ? 0.01 : 0);
  });
  out.idx.push(...idx);
}

/** 黄鼬头网格（单位坐标）。 */
export function weaselMesh(seam: SeamU): HeadMeshData {
  const surf = weaselSurface();
  const out: HeadMeshData = { pos: [], nor: [], uv: [], idx: [], gridStart: 0, seamVert: [], rows: 0, cols: 0 };
  addRoundEar(out, surf, 1);
  addRoundEar(out, surf, -1);
  out.gridStart = out.pos.length / 3;
  addShell(out, surf, seam);
  return out;
}

// ---------------------------------------------------------------- 毛皮贴图

let furTex: THREE.CanvasTexture | null = null;

/** 黄鼬毛皮（256×256，所有黄鼬共用）。 */
export function weaselFurTexture(): THREE.CanvasTexture {
  if (furTex) return furTex;
  const W = 256, H = 256;
  const { canvas, g } = createCanvas(W, H);
  const surf = weaselSurface();
  const pj = makeProj(surf, W, H);
  const fur = hexRgb('#B57C3C'), dark = hexRgb('#6E4420'), cream = hexRgb('#EEDCB4'), pink = hexRgb('#C98A80');
  const img = g.createImageData(W, H);
  const D = img.data;
  const r = rng(1970);
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      const u = (X + 0.5) / W, v = 1 - (Y + 0.5) / H;
      let c: [number, number, number];
      const iR = u >= EAR_ISLAND.u0R && u <= EAR_ISLAND.u0R + EAR_ISLAND.w, iL = u >= EAR_ISLAND.u0L && u <= EAR_ISLAND.u0L + EAR_ISLAND.w;
      if ((iR || iL) && v >= EAR_ISLAND.v0 && v <= EAR_ISLAND.v0 + EAR_ISLAND.h) {
        const fu = ((iR ? u - EAR_ISLAND.u0R : u - EAR_ISLAND.u0L) / EAR_ISLAND.w - 0.5) * 2, fv = ((v - EAR_ISLAND.v0) / EAR_ISLAND.h - 0.5) * 2;
        const rr = Math.hypot(fu, fv);
        c = rr < 0.55 ? mixc(pink, dark, sstep(0.3, 0.55, rr) * 0.5) : mixc(fur, dark, 0.35);
      } else {
        const p = pj.surf(X, Y);
        const ax = Math.abs(p.x);
        // 背上、头顶深，吻部、下巴、腮、上唇白
        const top = sstep(0.17, 0.215, p.y) * 0.5 + (p.z > 0 ? 0.25 * sstep(0.12, 0.2, p.y) : 0);
        c = mixc(fur, dark, top);
        const mouthY = 0.103 + (p.z + 0.14) * 0.05;
        const white = Math.max(sstep(mouthY + 0.004, mouthY - 0.004, p.y) * sstep(0.04, -0.03, p.z) * (1 - sstep(0.03, 0.07, ax)),
          g2(ax - 0.045, p.y - 0.098, 0.02, 0.015) * sstep(0.1, 0.5, p.front), g2(ax - 0.012, p.y - 0.108, 0.012, 0.006) * sstep(0.4, 0.8, p.front));
        c = mixc(c, cream, Math.min(1, white * 1.2));
        // 眼周一圈深色（黄鼬的“眼罩”）
        const er = Math.hypot(ax - EYE[0], p.y - EYE[1], p.z - EYE[2]);
        c = mixc(c, dark, 0.6 * Math.exp(-((er / 0.019) ** 2)));
        // 眼珠：黑、亮
        if (er < 0.0098) c = mixc([10, 8, 7], c, sstep(0.0084, 0.0098, er));
        // 鼻垫
        const nr = Math.hypot(p.x, p.y - NOSE[1], p.z - NOSE[2]);
        if (nr < 0.0105) c = mixc([22, 16, 14], c, sstep(0.008, 0.0105, nr));
        c = mulc(c, 1 + (r() - 0.5) * 0.08);
      }
      const k = (Y * W + X) * 4;
      D[k] = c[0]; D[k + 1] = c[1]; D[k + 2] = c[2]; D[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // 毛流：细线，顺着从吻尖往后、往下
  g.lineCap = 'round';
  for (let i = 0; i < 1400; i++) {
    const X = r() * W, Y = r() * H;
    const u = X / W, v = 1 - Y / H;
    if (v < 0.08) continue;
    const psi = psiOfU(u), a = alphaOfV(v);
    const dx = -Math.sign(psi) * 0.7, dy = a > 100 * DEG ? -0.6 : 0.9;
    const len = 3 + r() * 6;
    const lightS = r() < 0.5;
    g.strokeStyle = lightS ? 'rgba(240,214,170,0.22)' : 'rgba(60,34,14,0.22)';
    g.lineWidth = 0.6 + r() * 0.5;
    g.beginPath();
    g.moveTo(X, Y);
    g.lineTo(X + dx * len, Y + dy * len);
    g.stroke();
  }
  // 眼珠的高光（两点）
  for (const sgn of [-1, 1]) {
    const [X, Y] = pj.at(sgn * EYE[0], EYE[1]);
    g.fillStyle = 'rgba(255,255,250,0.95)';
    g.beginPath();
    g.ellipse(X + sgn * 1.8, Y - 2.4, 1.7, 1.9, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,250,0.5)';
    g.beginPath();
    g.ellipse(X - sgn * 1.2, Y + 1.5, 0.8, 0.8, 0, 0, Math.PI * 2);
    g.fill();
  }
  furTex = canvasToTexture(canvas);
  furTex.name = 'weaselFur';
  return furTex;
}

function mixc(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t];
}
function mulc(a: readonly number[], k: number): [number, number, number] {
  return [a[0]! * k, a[1]! * k, a[2]! * k];
}

/** 黄鼬的毛皮材质（每个人偶一份：红外 36.5℃）。 */
export function weaselMaterial(): THREE.MeshStandardMaterial {
  return newMat({ color: 0xffffff, map: weaselFurTexture(), roughness: 0.93, tempC: TEMP_C.huang });
}

/** 胡须：每边 6 根，从吻部两侧弯着往后（LineSegments；单位坐标 → 头网格局部由调用方缩放）。 */
export function whiskerPositions(): number[] {
  const pts: number[] = [];
  const r = rng(36);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const y0 = 0.106 + (i % 3) * 0.004 - (i > 2 ? 0.002 : 0), z0 = -0.138 + (i > 2 ? 0.008 : 0);
      // fix3：短一点（长短不一）、弯一点（四段：往外 → 往后、往下弯成一道弧），不是一把直直的扇子
      const len = (i % 3 === 1 ? 0.04 : 0.032) + r() * 0.012;
      const spread = (i % 3 - 1) * 0.3 + (r() - 0.5) * 0.15;
      let px = sx * 0.017, py = y0, pz = z0;
      for (let s = 1; s <= 4; s++) {
        const t = s / 4;
        const nx = sx * (0.017 + len * t * 0.9), ny = y0 + spread * len * t * 0.4 - 0.016 * t * t, nz = z0 + len * t * 0.3 + 0.018 * t * t;
        pts.push(px, py, pz, nx, ny, nz);
        px = nx; py = ny; pz = nz;
      }
    }
  }
  return pts;
}
