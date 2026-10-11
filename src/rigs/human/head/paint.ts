// owner: WP2
// char2 WP-H：人头贴图（PLAN §3.1“Face texture”）。512×384（0.75 MiB，与旧版同字节），按 FaceOpts 缓存。
// 五官按脸上的真实位置（单位坐标的 x、y，落到基础头形表面上）经 mapping.ts 的同一套角度映射画到画布上：
// 杏仁形眼（单眼皮/内双/双眼皮/下垂）、虹膜瞳孔高光、睫毛线；一根根画的眉；上下唇；鼻孔；老人的抬头纹、鱼尾纹、法令纹；
// 脸颊的血色、女人孩子的腮红、老人斑；胡茬只画成年男人且 paint.stubble > 0（不再有全脸的下巴阴影）。
// 头发区用与几何同一个覆盖函数：发色、发根深、头顶一道柔和的高光、老人的白发、顺着梳向的发丝、发际线上的碎发。

import * as THREE from 'three';
import { canvasToTexture, createCanvas, hexRgb } from '../../../kit/canvas';
import { rng } from '../../../kit/rng';
import type { FaceOpts, FacePaint } from '../types';
import { DEG, EAR_ISLAND, alphaOfV, dirOf, g2, psiOfU, sstep, uvOfPoint, vOfAlpha } from './mapping';
import { type HeadParams, hairCover, hairEdge, hairFade, headParams } from './params';
import { headSurface } from './shape';

const W = 512, H = 384;
type RGB = [number, number, number];

const faceCache = new Map<string, THREE.CanvasTexture>();

/** 画法的缺省（按头型预设与年龄），face.paint 覆盖。 */
export function paintOf(o: Readonly<FaceOpts>, hp: HeadParams): Required<Omit<FacePaint, 'mole' | 'lips' | 'smile'>> & Pick<FacePaint, 'mole' | 'lips' | 'smile'> {
  const p = o.paint ?? {};
  const pr = hp.preset;
  const eyeShape = p.eyeShape ?? (pr === 'woman' || pr === 'girl' || pr === 'boy' ? 'double' : pr === 'oldWoman' || pr === 'deity' ? 'droop' : pr === 'oldMan' ? 'single' : 'single');
  const brow = p.brow ?? (pr === 'deity' ? 'white' : pr === 'woman' ? 'arched' : pr === 'oldWoman' ? 'thin' : pr === 'oldMan' ? 'thin' : 'straight');
  return {
    eyeShape, brow,
    wrinkles: p.wrinkles ?? (hp.old ? 0.6 : 0),
    stubble: p.stubble ?? 0,
    blush: p.blush ?? (pr === 'girl' ? 0.35 : pr === 'boy' ? 0.22 : pr === 'woman' ? 0.2 : pr === 'oldWoman' ? 0.12 : pr === 'deity' ? 0.35 : 0),
    spots: p.spots ?? 0,
    ...(p.lips !== undefined ? { lips: p.lips } : {}),
    ...(p.mole !== undefined ? { mole: p.mole } : {}),
    ...(p.smile !== undefined ? { smile: p.smile } : {}),
  };
}

/**
 * 人头贴图（u = 0.5 正脸，v = 1 头顶；布局见 mapping.ts）。同参数缓存复用；colorSpace = SRGB。
 * 画面平均亮度 ≈ 肤色本身（不压暗脸），五官、头发、耳朵都在这一张上。
 */
export function faceTexture(o: FaceOpts): THREE.CanvasTexture {
  const key = JSON.stringify(o);
  const hit = faceCache.get(key);
  if (hit) return hit;
  const { canvas, g } = createCanvas(W, H);
  paintFace(g, o);
  const tex = canvasToTexture(canvas);
  // u = 0 与 u = 1 都是后脑正中：横向 Repeat（跨接缝的发髻 UV 是连续展开的）
  tex.wrapS = THREE.RepeatWrapping;
  tex.name = 'face';
  faceCache.set(key, tex);
  return tex;
}

// ================================================================ 投影：脸上的 (x, y) → 画布

export interface Proj {
  /** 正脸上的点（单位坐标 x、y；z 取基础头形前表面）→ 画布 (X, Y) */
  at(x: number, y: number): [number, number];
  /** 该处每米多少像素（X、Y 方向） */
  scale(x: number, y: number): [number, number];
  /** 画布像素 → 基础表面上的点（粗网格插值）与朝前程度 */
  surf(X: number, Y: number): { x: number; y: number; z: number; front: number };
}

export function makeProj(s: Pick<ReturnType<typeof headSurface>, 'f' | 'base'>, W = 512, H = 384): Proj {
  const zFront = (x: number, y: number): number => {
    // 沿 z 从前往里找基础表面
    let lo = -0.2, hi = 0.0;
    if (s.f(x, y, hi) > 0) return -0.09;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (s.f(x, y, m) > 0) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  const at = (x: number, y: number): [number, number] => {
    const [u, v] = uvOfPoint(x, y, zFront(x, y));
    return [u * W, (1 - v) * H];
  };
  // 粗网格：画布 → 表面点
  const GX = 96, GY = 72;
  const grid = new Float32Array((GX + 1) * (GY + 1) * 4);
  const d: [number, number, number] = [0, 0, 0];
  const tmp = { P: [0, 0, 0] as [number, number, number], n: [0, 0, 0] as [number, number, number] };
  for (let j = 0; j <= GY; j++) {
    for (let i = 0; i <= GX; i++) {
      const u = i / GX, v = 1 - j / GY;
      dirOf(psiOfU(u), alphaOfV(v), d);
      s.base(d, tmp);
      const k = (j * (GX + 1) + i) * 4;
      grid[k] = tmp.P[0]; grid[k + 1] = tmp.P[1]; grid[k + 2] = tmp.P[2]; grid[k + 3] = -tmp.n[2];
    }
  }
  const out = { x: 0, y: 0, z: 0, front: 0 };
  const surf = (X: number, Y: number) => {
    const fx = Math.min(GX - 1e-6, Math.max(0, (X / W) * GX)), fy = Math.min(GY - 1e-6, Math.max(0, (Y / H) * GY));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const k00 = (j * (GX + 1) + i) * 4, k10 = k00 + 4, k01 = k00 + (GX + 1) * 4, k11 = k01 + 4;
    const L = (o: number) => (grid[k00 + o]! * (1 - tx) + grid[k10 + o]! * tx) * (1 - ty) + (grid[k01 + o]! * (1 - tx) + grid[k11 + o]! * tx) * ty;
    out.x = L(0); out.y = L(1); out.z = L(2); out.front = L(3);
    return out;
  };
  return {
    at,
    scale(x, y) {
      const a = at(x, y), b = at(x + 0.002, y), c = at(x, y + 0.002);
      return [Math.abs(b[0] - a[0]) / 0.002, Math.abs(c[1] - a[1]) / 0.002];
    },
    surf,
  };
}

// ================================================================ 画

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const css = (c: RGB, a = 1) => `rgba(${Math.round(Math.min(255, Math.max(0, c[0])))},${Math.round(Math.min(255, Math.max(0, c[1])))},${Math.round(Math.min(255, Math.max(0, c[2])))},${a})`;

function paintFace(g: CanvasRenderingContext2D, o: Readonly<FaceOpts>): void {
  const hp = headParams(o);
  const pt = paintOf(o, hp);
  const pj = makeProj(headSurface(hp));
  const r = rng(o.seed ?? 1);
  const skin: RGB = hexRgb(o.skin);
  const hairC: RGB = hexRgb(o.hair);
  const male = !hp.female && !hp.child;
  const def = headSurface(hp).hair;

  // ------------------------------------------------ 皮肤层（逐像素：底色、血色、腮红、胡茬、老人斑、耳朵）
  const img = g.createImageData(W, H);
  const D = img.data;
  const warm: RGB = [skin[0] * 1.06, skin[1] * 0.9, skin[2] * 0.86];
  const blushC: RGB = [Math.min(255, skin[0] * 1.12), skin[1] * 0.82, skin[2] * 0.82];
  const stubC: RGB = mix(skin, [70, 72, 78], 0.55);
  const spots: [number, number, number][] = [];
  if (pt.spots > 0) for (let i = 0; i < Math.round(pt.spots * 22); i++) spots.push([(r() - 0.5) * 0.11, 0.1 + r() * 0.1, 0.0015 + r() * 0.002]);
  const noise = valueNoise(o.seed ?? 1);
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      const u = (X + 0.5) / W, v = 1 - (Y + 0.5) / H;
      let c: RGB = skin;
      const ear = earIsland(u, v);
      if (ear) {
        // 耳朵：耳甲（中间偏前下）暗一点、耳轮边缘亮一点、整体偏暖
        const cx = ear.f - 0.62, cy = ear.u - 0.45;
        const concha = Math.exp(-((cx / 0.2) ** 2 + (cy / 0.2) ** 2));
        const rim = sstep(0.55, 0.85, Math.hypot((ear.f - 0.5) / 0.55, (ear.u - 0.5) / 0.55));
        c = mix(mix(skin, warm, 0.45), mul(skin, 0.72), concha * 0.55);
        c = mix(c, mul(skin, 1.06), rim * 0.4);
      } else {
        const p = pj.surf(X, Y);
        const ax = Math.abs(p.x), fr = sstep(0.2, 0.7, p.front);
        // 皮肤的细微斑驳
        const n = noise(X * 0.09, Y * 0.06) - 0.5, n2 = noise(X * 0.33 + 50, Y * 0.25) - 0.5;
        c = mul(c, 1 + n * 0.035 + n2 * 0.02);
        // 脸颊、鼻头、下巴的血色
        let w = 0.16 * g2(ax - 0.045, p.y - 0.105, 0.022, 0.02) + 0.14 * g2(p.x, p.y - 0.113, 0.011, 0.01) + 0.06 * g2(p.x, p.y - 0.05, 0.015, 0.012);
        w *= fr;
        if (hp.deity) w *= 1.8;
        c = mix(c, warm, Math.min(0.6, w));
        if (pt.blush > 0) c = mix(c, blushC, Math.min(0.5, pt.blush * 0.85 * g2(ax - 0.047, p.y - 0.11, 0.017, 0.014) * fr));
        // 额头略亮、眼下略暗（老人更明显）
        c = mul(c, 1 + 0.03 * g2(p.x, p.y - 0.19, 0.04, 0.02) * fr);
        c = mul(c, 1 - (hp.old ? 0.11 : 0.05) * g2(ax - 0.034, p.y - 0.139, 0.014, 0.005) * fr);
        // 上眼睑与眼窝内侧的一点影子
        c = mul(c, 1 - 0.06 * g2(ax - 0.022, p.y - 0.152, 0.006, 0.008) * fr);
        if (male && pt.stubble > 0) {
          // 胡茬：上唇、下巴、下颌（不碰嘴唇），细颗粒
          // 上唇、下巴、下颌边（不上脸颊）
          const jawline = Math.max(1 - sstep(0.03, 0.045, ax), 1 - sstep(0.058, 0.075, p.y));
          const area = sstep(0.1, 0.093, p.y) * sstep(0.03, 0.045, p.y) * (1 - g2(p.x, p.y - 0.0805, 0.024, 0.0075)) * jawline
            * (1 - sstep(0.05, 0.064, ax)) * sstep(0.1, 0.35, p.front + 0.25);
          const grain = noise(X * 1.3, Y * 1.1) > 0.45 ? 1 : 0.35;
          c = mix(c, stubC, Math.max(0, Math.min(0.32, pt.stubble * area * grain * 0.55)));
        }
        for (const [sx, sy, sr] of spots) {
          const k = g2(p.x - sx, p.y - sy, sr, sr * 0.8) * fr;
          if (k > 0.02) c = mix(c, mul(skin, 0.8), k * 0.4);
        }
      }
      const k = (Y * W + X) * 4;
      D[k] = c[0]; D[k + 1] = c[1]; D[k + 2] = c[2]; D[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  // ------------------------------------------------ 五官（矢量，按脸上的真实位置）
  const fp = (x: number, y: number) => pj.at(x, y);
  const path = (pts: readonly (readonly [number, number])[], close = false) => {
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const [X, Y] = fp(x, y);
      if (i === 0) g.moveTo(X, Y);
      else g.lineTo(X, Y);
    });
    if (close) g.closePath();
  };
  const sc0 = pj.scale(0.03, 0.15);
  const pxmm = (sc0[0] + sc0[1]) / 2000; // 平均每毫米像素
  g.lineCap = 'round';
  g.lineJoin = 'round';

  paintEyes(g, hp, pt, fp, path, pxmm, o, skin);
  paintBrows(g, hp, pt, fp, pxmm, o, hairC, r);
  paintNose(g, hp, path, fp, skin);
  paintMouth(g, hp, pt, path, fp, skin, pxmm);
  if (pt.wrinkles > 0) paintWrinkles(g, hp, pt.wrinkles, path, skin, pxmm);
  if (pt.mole) {
    g.fillStyle = css(mul(skin, 0.45), 0.9);
    g.beginPath();
    g.ellipse(pt.mole[0] * W, (1 - pt.mole[1]) * H, 1.6, 2.2, 0, 0, Math.PI * 2);
    g.fill();
  }

  // ------------------------------------------------ 头发层：另一张画布，最后按覆盖系数合成
  if (!def.line) return;
  const hc = createCanvas(W, H);
  const h = hc.g;
  h.fillStyle = css(hairC);
  h.fillRect(0, 0, W, H);
  const himg = h.getImageData(0, 0, W, H);
  const HD = himg.data;
  const grey = hp.old ? (lum(hairC) > 0.45 ? 0.25 : 0.4) : 0;
  const light = mix(hairC, [235, 230, 222], 0.55);
  for (let Y = 0; Y < H; Y++) {
    const v = 1 - (Y + 0.5) / H;
    const alpha = alphaOfV(v);
    for (let X = 0; X < W; X++) {
      const u = (X + 0.5) / W;
      const psi = psiOfU(u);
      let c = hairC;
      // 发根深（发际线一带）、头顶一道柔和的高光（顺着头顶的弧）
      const lo = hairEdge(def, psi);
      c = mul(c, 0.9 + 0.1 * sstep(lo, lo + 10 * DEG, alpha));
      const hl = g2(alpha - 150 * DEG, Math.abs(psi) - 0.0, 9 * DEG, 70 * DEG) * 0.6 + g2(alpha - 138 * DEG, Math.abs(psi), 6 * DEG, 50 * DEG) * 0.3;
      c = mix(c, light, Math.min(0.32, hl * 0.32 * (1 + (noise(X * 0.4, Y * 0.08) - 0.5))));
      const n = noise(X * 0.5 + 9, Y * 0.12) - 0.5;
      c = mul(c, 1 + n * 0.14);
      // 花白：细碎的白发掺在里面（逐像素，不画成一道道“雨丝”）
      if (grey > 0) c = mix(c, [205, 202, 196], grey * 0.55 * Math.max(0, noise(X * 1.7 + 3, Y * 0.45) - 0.35) * 2.2);
      const k = (Y * W + X) * 4;
      HD[k] = c[0]; HD[k + 1] = c[1]; HD[k + 2] = c[2];
    }
  }
  h.putImageData(himg, 0, 0);
  hairStrands(h, hp, def, hairC, grey, r, o);

  // 合成：覆盖系数（与几何同一个函数，边更软一点，带噪声）
  const sk = g.getImageData(0, 0, W, H);
  const SD = sk.data;
  const HD2 = h.getImageData(0, 0, W, H).data;
  for (let Y = 0; Y < H; Y++) {
    const v = 1 - (Y + 0.5) / H;
    const alpha = alphaOfV(v);
    for (let X = 0; X < W; X++) {
      const u = (X + 0.5) / W;
      if (earIsland(u, v)) continue;
      const psi = psiOfU(u);
      const jit = (noise(X * 0.7 + 31, Y * 0.35) - 0.5) * 2.6 * DEG + (noise(X * 2.1 + 7, Y * 0.9) - 0.5) * 1.4 * DEG;
      let m = hairCover(def, psi, alpha + jit, 1.9);
      // fix1：往后梳的发型，发际线那一圈头发稀、透出头皮（不是一道齐刘海的深色边）
      if (def.bun) {
        const lo = hairEdge(def, psi);
        m *= 0.55 + 0.45 * sstep(lo, lo + 7 * DEG, alpha);
      }
      // fix1：推短的两鬓透出头皮（发色与肤色各半，带一点颗粒），不是一圈实心的头盔边
      const fd = hairFade(def, psi, alpha);
      if (fd > 0) m *= 1 - fd * (0.62 + 0.25 * (noise(X * 1.9 + 3, Y * 1.7) - 0.5));
      // 分缝：露出一道头皮
      if (def.part) {
        const lo = hairEdge(def, psi);
        const along = sstep(lo + 1 * DEG, lo + 8 * DEG, alpha) * (1 - sstep(150 * DEG, 168 * DEG, alpha));
        m *= 1 - 0.75 * along * Math.exp(-(((psi - def.part.psi) / (def.part.width * 0.32)) ** 2));
      }
      // 稀发：头顶透出头皮
      if (hp.hair === 'thin_old') m *= 1 - 0.35 * sstep(150 * DEG, 175 * DEG, alpha) * (0.6 + 0.8 * noise(X * 0.3, Y * 0.3));
      if (m <= 0) continue;
      const k = (Y * W + X) * 4;
      for (let j = 0; j < 3; j++) SD[k + j] = SD[k + j]! + (HD2[k + j]! - SD[k + j]!) * m;
    }
  }
  g.putImageData(sk, 0, 0);
  flyaways(g, def, hairC, r);
}

function lum(c: RGB): number {
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
}

/** 画布 (u, v) 是否在耳朵小岛里；在的话给出岛内坐标（f = 0 后/1 前，u = 0 下/1 上）。 */
function earIsland(u: number, v: number): { f: number; u: number } | null {
  const I = EAR_ISLAND;
  if (v < I.v0 || v > I.v0 + I.h) return null;
  const uu = (v - I.v0) / I.h;
  if (u >= I.u0R && u <= I.u0R + I.w) return { f: 1 - (u - I.u0R) / I.w, u: uu };
  if (u >= I.u0L && u <= I.u0L + I.w) return { f: (u - I.u0L) / I.w, u: uu };
  return null;
}

/** 平滑值噪声（0..1）。 */
function valueNoise(seed: number): (x: number, y: number) => number {
  const r = rng(seed * 7919 + 13);
  const N = 64;
  const t = new Float32Array(N * N);
  for (let i = 0; i < t.length; i++) t[i] = r();
  const at = (i: number, j: number) => t[((j % N) + N) % N * N + (((i % N) + N) % N)]!;
  return (x: number, y: number) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy;
  };
}

type Fp = (x: number, y: number) => [number, number];
type PathFn = (pts: readonly (readonly [number, number])[], close?: boolean) => void;

/** 二次贝塞尔采样（脸上坐标）。 */
function qcurve(a: readonly [number, number], c: readonly [number, number], b: readonly [number, number], n = 10): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = 1 - t;
    out.push([s * s * a[0] + 2 * s * t * c[0] + t * t * b[0], s * s * a[1] + 2 * s * t * c[1] + t * t * b[1]]);
  }
  return out;
}

// ---------------------------------------------------------------- 眼

function paintEyes(g: CanvasRenderingContext2D, hp: HeadParams, pt: ReturnType<typeof paintOf>, fp: Fp, path: PathFn, pxmm: number, o: Readonly<FaceOpts>, skin: RGB): void {
  const es = (1 + 0.2 * hp.sc.eyeSize) * (hp.child ? 1.05 : 1);
  const shape = pt.eyeShape;
  const smiling = hp.deity;
  const w = 0.0152 * es; // 半宽
  const hTop = (shape === 'double' ? 0.0052 : shape === 'droop' ? 0.0038 : 0.0044) * es * (smiling ? 0.55 : 1) * (hp.old ? 0.9 : 1);
  const hBot = (shape === 'double' ? 0.0034 : 0.003) * es * (smiling ? 0.5 : 1);
  const lash = 'rgba(28,18,14,0.95)';
  for (const sgn of [-1, 1]) {
    const cx = 0.0325 * sgn, cy = 0.1505;
    // 内眼角（靠鼻子）、外眼角；下垂眼的外角低
    const inner: [number, number] = [cx - sgn * w * 0.95, cy - 0.0004];
    const outer: [number, number] = [cx + sgn * w, cy + (shape === 'droop' ? -0.0016 : shape === 'single' ? 0.0009 : 0.0004)];
    const topC: [number, number] = [cx - sgn * w * 0.12, cy + hTop * 2];
    const botC: [number, number] = [cx + sgn * w * 0.05, cy - hBot * 2 * (smiling ? -0.6 : 1)];
    const top = qcurve(inner, topC, outer, 14);
    const bot = qcurve(outer, botC, inner, 14);
    const almond = [...top, ...bot.slice(1)];
    // 上眼睑的影子（眼睛上方一抹暖暗）
    g.fillStyle = css(mul(skin, 0.8), 0.28);
    path([...qcurve([inner[0] - sgn * 0.002, inner[1] + 0.001], [cx, cy + hTop * 3.4], [outer[0] + sgn * 0.003, outer[1] + 0.001], 12), ...top.slice().reverse()], true);
    g.fill();
    // 眼白（约 75% 亮度，不刺眼）
    g.save();
    path(almond, true);
    g.fillStyle = 'rgb(206,198,186)';
    g.fill();
    g.clip();
    // 虹膜、瞳孔、高光
    const [ix, iy] = fp(cx - sgn * w * 0.04, cy + hTop * 0.15);
    const sc = [Math.abs(fp(cx + 0.001, cy)[0] - fp(cx, cy)[0]) * 1000, Math.abs(fp(cx, cy + 0.001)[1] - fp(cx, cy)[1]) * 1000] as const;
    const ir = 0.0058 * es * (hp.child ? 1.08 : 1);
    const grad = g.createRadialGradient(ix, iy, 0, ix, iy, ir * sc[0]);
    grad.addColorStop(0, '#3e2a1b');
    grad.addColorStop(0.7, '#2f1f14');
    grad.addColorStop(1, '#1e140e');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(ix, iy, ir * sc[0], ir * sc[1], 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0c0907';
    g.beginPath();
    g.ellipse(ix, iy, ir * 0.42 * sc[0], ir * 0.42 * sc[1], 0, 0, Math.PI * 2);
    g.fill();
    // 上眼睑在眼白上投的一道影
    g.fillStyle = 'rgba(40,24,18,0.35)';
    path([...top, ...qcurve(outer, [cx, cy + hTop * 0.9], inner, 10)], true);
    g.fill();
    g.fillStyle = 'rgba(255,252,244,0.95)';
    g.beginPath();
    g.ellipse(ix + sgn * ir * 0.35 * sc[0], iy - ir * 0.38 * sc[1], Math.max(1.1, 0.0011 * sc[0]), Math.max(1.1, 0.0011 * sc[1]), 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // 上睫毛线（外侧更粗），下眼线淡
    g.strokeStyle = lash;
    for (let i = 0; i + 1 < top.length; i++) {
      const t = i / (top.length - 1);
      g.lineWidth = Math.max(1.4, pxmm * (0.55 + 0.75 * t) * (hp.female ? 1.15 : 1));
      path([top[i]!, top[i + 1]!]);
      g.stroke();
    }
    // 外眼角睫毛往外一挑（女人）
    if (hp.female && !hp.old) {
      g.lineWidth = Math.max(1, pxmm * 0.6);
      path([outer, [outer[0] + sgn * 0.0025, outer[1] + 0.0012]]);
      g.stroke();
    }
    g.strokeStyle = 'rgba(60,36,28,0.4)';
    g.lineWidth = Math.max(0.8, pxmm * 0.35);
    path(bot.slice(1, -2));
    g.stroke();
    // 双眼皮褶、内双（内眼角盖一点）、下垂眼的眼皮
    if (shape === 'double') {
      g.strokeStyle = 'rgba(70,40,30,0.5)';
      g.lineWidth = Math.max(0.9, pxmm * 0.4);
      path(qcurve([inner[0] + sgn * 0.003, inner[1] + 0.0028], [cx, cy + hTop * 2.5], [outer[0] - sgn * 0.001, outer[1] + 0.0026], 10));
      g.stroke();
    } else if (shape === 'inner_fold') {
      g.strokeStyle = 'rgba(70,40,30,0.45)';
      g.lineWidth = Math.max(0.9, pxmm * 0.4);
      path(qcurve([inner[0] + sgn * 0.005, inner[1] + 0.0012], [cx + sgn * 0.003, cy + hTop * 2.3], [outer[0] - sgn * 0.0005, outer[1] + 0.0024], 10));
      g.stroke();
    } else if (shape === 'droop' || hp.old) {
      g.strokeStyle = 'rgba(80,46,34,0.45)';
      g.lineWidth = Math.max(1, pxmm * 0.5);
      path(qcurve([cx - sgn * w * 0.3, cy + hTop * 2.4], [cx + sgn * w * 0.5, cy + hTop * 2.6], [outer[0] + sgn * 0.002, outer[1] - 0.0008], 10));
      g.stroke();
    }
    if (smiling) {
      // 笑眼：下眼睑往上推的一道弧
      g.strokeStyle = 'rgba(90,50,36,0.5)';
      g.lineWidth = Math.max(1, pxmm * 0.5);
      path(qcurve([inner[0], inner[1] - 0.003], [cx, cy - 0.0062], [outer[0], outer[1] - 0.0028], 10));
      g.stroke();
    }
  }
  void o;
}

// ---------------------------------------------------------------- 眉

function paintBrows(g: CanvasRenderingContext2D, hp: HeadParams, pt: ReturnType<typeof paintOf>, fp: Fp, pxmm: number, o: Readonly<FaceOpts>, hair: RGB, r: () => number): void {
  const kind = pt.brow;
  const k = o.brows ?? (hp.child ? 0.8 : 1);
  const col: RGB = kind === 'white' ? [236, 232, 224] : mix(mul(hair, 0.75), [20, 16, 14], hp.old ? 0.1 : 0.35);
  const thick = (kind === 'bushy' ? 2.6 : kind === 'thin' ? 1.2 : kind === 'white' ? 2.8 : 1.8) * k;
  const arch = kind === 'arched' ? 0.0042 : kind === 'straight' ? 0.0014 : 0.0026;
  const n = Math.round((kind === 'bushy' || kind === 'white' ? 130 : kind === 'thin' ? 60 : 95) * Math.min(1.4, k));
  for (const sgn of [-1, 1]) {
    // 眉头（靠鼻子）→ 眉峰 → 眉尾（白眉：眉尾下垂）
    const head: [number, number] = [0.0115 * sgn, 0.1678];
    const peak: [number, number] = [0.035 * sgn, 0.1705 + arch];
    const tail: [number, number] = [0.0545 * sgn, kind === 'white' ? 0.159 : 0.1665];
    const curve = (t: number): [number, number] => {
      const s = 1 - t;
      return [s * s * head[0] + 2 * s * t * peak[0] + t * t * tail[0], s * s * head[1] + 2 * s * t * peak[1] + t * t * tail[1]];
    };
    for (let i = 0; i < n; i++) {
      const t = r();
      const [x, y] = curve(t);
      // 宽度：眉头厚、眉尾细
      const wy = 0.0016 * thick * (1.1 - 0.75 * t);
      const yy = y + (r() - 0.5) * wy * 2;
      // 毛的方向：眉头往上，往后顺着眉形倒向眉尾
      const ang = t < 0.15 ? 1.2 : 0.35 - 0.2 * t;
      const len = 0.0032 * (0.7 + 0.6 * r()) * (kind === 'white' ? 1.4 : 1);
      const dx = Math.cos(ang) * len * sgn, dy = Math.sin(ang) * len * (t < 0.15 ? 1 : 0.5);
      const a = fp(x, yy), b = fp(x + dx, yy + dy);
      g.strokeStyle = css(mul(col, 0.85 + 0.3 * r()), (kind === 'thin' ? 0.65 : 0.8) * (0.65 + 0.35 * r()));
      g.lineWidth = Math.max(0.8, pxmm * (0.28 + 0.12 * r()) * (kind === 'white' ? 1.4 : 1));
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }
  }
}

// ---------------------------------------------------------------- 鼻

function paintNose(g: CanvasRenderingContext2D, hp: HeadParams, path: PathFn, fp: Fp, skin: RGB): void {
  const yb = (hp.child ? 0.1115 : hp.female ? 0.1068 : 0.1035) - 0.003 * hp.sc.noseLen;
  const ax = 0.0135 * (1 + 0.2 * hp.sc.noseW) * (hp.child ? 0.8 : hp.female ? 0.92 : 1);
  // fix1：鼻孔只是两个小而淡的点（面积约原来的 40%、透明度一半）；鼻小柱与人中一带提亮一点，
  // 跟鼻底几何的影子合不成一道“一字胡”
  {
    const [Xc, Yc] = fp(0, yb - 0.0012);
    const [Xe, Ye] = fp(0.012, yb - 0.0085);
    const grad = g.createRadialGradient(Xc, Yc, 0, Xc, Yc, Math.max(4, Math.hypot(Xe - Xc, Ye - Yc)));
    grad.addColorStop(0, css(mul(skin, 1.1), 0.5));
    grad.addColorStop(1, css(mul(skin, 1.1), 0));
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(Xc, Yc + Math.abs(Ye - Yc) * 0.35, Math.abs(Xe - Xc) * 1.2, Math.abs(Ye - Yc) * 1.1, 0, 0, Math.PI * 2);
    g.fill();
  }
  for (const sgn of [-1, 1]) {
    const [X, Y] = fp(sgn * ax * 0.52, yb + 0.0024);
    const [X2, Y2] = fp(sgn * ax * 0.52 + 0.0035, yb + 0.0024 + 0.0015);
    const rx = Math.max(1.1, Math.abs(X2 - X) * 0.55), ry = Math.max(0.8, Math.abs(Y2 - Y) * 0.55);
    const gr = g.createRadialGradient(X, Y, 0, X, Y, rx * 1.3);
    gr.addColorStop(0, css(mul(skin, 0.55), 0.42));
    gr.addColorStop(1, css(mul(skin, 0.7), 0));
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(X, Y, rx * 1.3, ry * 1.3, 0, 0, Math.PI * 2);
    g.fill();
    // 鼻翼的褶
    g.strokeStyle = css(mul(skin, 0.74), 0.26);
    g.lineWidth = 1.1;
    path(qcurve([sgn * (ax + 0.004), yb + 0.0095], [sgn * (ax + 0.0055), yb + 0.004], [sgn * ax * 0.85, yb + 0.0005], 8));
    g.stroke();
  }
}

// ---------------------------------------------------------------- 嘴

function paintMouth(g: CanvasRenderingContext2D, hp: HeadParams, pt: ReturnType<typeof paintOf>, path: PathFn, _fp: Fp, skin: RGB, pxmm: number): void {
  const lf = Math.max(0.3, 1 + 0.5 * hp.sc.lipFull);
  const mw = (hp.child ? 0.019 : hp.female ? 0.0215 : 0.0235);
  const my = 0.0805;
  const up = 0.0058 * lf, lo = 0.0072 * lf;
  const lipC: RGB = pt.lips ? hexRgb(pt.lips) : hp.female ? mix(skin, [176, 82, 76], 0.62) : hp.child ? mix(skin, [190, 100, 90], 0.45) : mix(skin, [150, 86, 72], 0.4);
  // 嘴角上扬（米）：土地爷缺省笑；paint.smile（-1..1，见 requests/wp-h.md #1）
  const smileK = pt.smile ?? (hp.deity ? 1 : 0);
  const smile = 0.0016 * smileK;
  // 上唇（唇峰、唇珠）
  const cornerL: [number, number] = [-mw, my + smile], cornerR: [number, number] = [mw, my + smile];
  const upper: [number, number][] = [
    cornerL, [-mw * 0.62, my + up * 0.6], [-mw * 0.26, my + up], [0, my + up * 0.78], [mw * 0.26, my + up], [mw * 0.62, my + up * 0.6], cornerR,
    ...qcurve(cornerR, [0, my - 0.0006], cornerL, 10).slice(1, -1),
  ];
  g.fillStyle = css(mul(lipC, 0.92), 0.95);
  path(upper, true);
  g.fill();
  const lower: [number, number][] = [...qcurve(cornerR, [0, my - 0.0006], cornerL, 10), ...qcurve(cornerL, [0, my - lo * 1.75], cornerR, 12).slice(1, -1)];
  g.fillStyle = css(lipC, 0.92);
  path(lower, true);
  g.fill();
  // 下唇的高光
  g.fillStyle = css(mix(lipC, [255, 236, 226], 0.3), 0.45);
  path(qcurve([-mw * 0.4, my - lo * 0.45], [0, my - lo * 0.95], [mw * 0.4, my - lo * 0.45], 8).concat(qcurve([mw * 0.3, my - lo * 0.5], [0, my - lo * 0.6], [-mw * 0.3, my - lo * 0.5], 6)), true);
  g.fill();
  // 唇线（两唇之间那道暗缝），嘴角往外收
  g.strokeStyle = css(mul(lipC, 0.4), 0.95);
  g.lineWidth = Math.max(1.6, pxmm * 0.7);
  path(qcurve([-mw * 1.04, my + smile * 1.4], [0, my - 0.0007 - smile * 0.6], [mw * 1.04, my + smile * 1.4], 14));
  g.stroke();
  for (const sgn of [-1, 1]) {
    g.strokeStyle = css(mul(skin, 0.62), 0.5);
    g.lineWidth = Math.max(1, pxmm * 0.4);
    path([[sgn * mw * 1.02, my + smile * 1.4], [sgn * (mw + 0.0026), my + 0.0004 + smile * 2.4]]);
    g.stroke();
  }
  // 下唇下面的影子（颏唇沟）
  g.fillStyle = css(mul(skin, 0.8), 0.25);
  path([...qcurve([-mw * 0.6, my - lo * 1.8], [0, my - lo * 2.4], [mw * 0.6, my - lo * 1.8], 8), ...qcurve([mw * 0.5, my - lo * 2.3], [0, my - lo * 3.1], [-mw * 0.5, my - lo * 2.3], 8)], true);
  g.fill();
}

// ---------------------------------------------------------------- 皱纹

function paintWrinkles(g: CanvasRenderingContext2D, hp: HeadParams, k: number, path: PathFn, skin: RGB, pxmm: number): void {
  const dark = (a: number) => css(mul(skin, 0.62), a * k);
  const lite = (a: number) => css(mul(skin, 1.12), a * k);
  // 一道“折”：暗线 + 下面一道亮线
  const crease = (pts: [number, number][], a: number, w = 0.55, dy = -0.0011) => {
    g.lineWidth = Math.max(0.9, pxmm * w);
    g.strokeStyle = dark(a);
    path(pts);
    g.stroke();
    g.lineWidth = Math.max(0.8, pxmm * w * 0.8);
    g.strokeStyle = lite(a * 0.6);
    path(pts.map(([x, y]) => [x, y + dy] as [number, number]));
    g.stroke();
  };
  // 抬头纹
  for (let i = 0; i < 3; i++) {
    const y = 0.188 + i * 0.0085;
    crease(qcurve([-0.034 + i * 0.002, y - 0.001], [0, y + 0.0022], [0.034 - i * 0.002, y - 0.001], 12), 0.45 - i * 0.08);
  }
  // 眉间竖纹（老头）
  if (!hp.female) for (const s of [-1, 1]) crease([[s * 0.005, 0.163], [s * 0.0058, 0.172]], 0.35, 0.45, 0);
  // 鱼尾纹
  for (const s of [-1, 1]) {
    for (let i = -1; i <= 1; i++) crease([[s * 0.0495, 0.151 + i * 0.002], [s * 0.0565, 0.1525 + i * 0.0045]], 0.4, 0.45, 0);
    // 眼袋下沿
    crease(qcurve([s * 0.022, 0.141], [s * 0.034, 0.1355], [s * 0.046, 0.1405], 8), 0.38);
    // 法令纹：鼻翼外 → 嘴角外
    // fix1：女人的法令纹、嘴角纹淡一些（原来在钠灯下读成一圈脏印/胡子影）
    crease(qcurve([s * 0.0195, 0.1085], [s * 0.031, 0.096], [s * 0.0315, 0.0735], 12), hp.female ? 0.2 : 0.42, hp.female ? 0.5 : 0.65, 0);
    // 嘴角下的纹
    crease([[s * 0.027, 0.077], [s * 0.029, 0.066]], hp.female ? 0.1 : 0.24, 0.45, 0);
  }
}

// ---------------------------------------------------------------- 发丝

function hairStrands(h: CanvasRenderingContext2D, hp: HeadParams, def: ReturnType<typeof headSurface>['hair'], hair: RGB, grey: number, r: () => number, o: Readonly<FaceOpts>): void {
  const dark = mul(hair, 0.62), light = mix(hair, [240, 236, 228], 0.35), white: RGB = [214, 210, 204];
  const bunUv = def.bun ? uvOfPoint(0, def.bun === 'chignon' ? 0.118 : 0.175, def.bun === 'chignon' ? 0.1 : 0.105) : null;
  const n = 2600;
  h.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const u = r(), v = 0.08 + r() * 0.92;
    const psi = psiOfU(u), alpha = alphaOfV(v);
    if (hairCover(def, psi, alpha, 2.5) <= 0.01) continue;
    // 梳向（画布坐标）：缺省从发际线往头顶（v 增 = 画布上 Y 减）
    let dx = 0, dy = -1;
    if (def.part) {
      // 从分缝往两边梳下来
      const side = Math.sign(psi - def.part.psi) || 1;
      dx = side * 0.8;
      dy = 0.35;
    }
    if (hp.hair === 'child_bowl' || hp.hair === 'crop' || hp.hair === 'flat_top') {
      // 从头顶旋往四周、往下
      dy = 1;
      dx = (u - 0.5) * 0.6;
    }
    if (bunUv) {
      const X = u * W, Y = (1 - v) * H, bx = bunUv[0] * W, by = (1 - bunUv[1]) * H;
      let ddx = bx - X;
      if (ddx > W / 2) ddx -= W;
      if (ddx < -W / 2) ddx += W;
      const ddy = by - Y, l = Math.hypot(ddx, ddy) || 1;
      if (l < 26) {
        // 发髻底下那块：绕着盘
        dx = -ddy / l; dy = ddx / l;
      } else {
        dx = ddx / l; dy = ddy / l;
      }
    }
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const kind = r();
    const len = (grey > 0 && kind < grey ? 4 : 6) + r() * (grey > 0 && kind < grey ? 7 : 14);
    const X = u * W, Y = (1 - v) * H;
    const c = grey > 0 && kind < grey ? white : kind < 0.55 ? dark : light;
    h.strokeStyle = css(c, grey > 0 && kind < grey ? 0.16 + r() * 0.1 : 0.22 + r() * 0.18);
    h.lineWidth = 0.6 + r() * 0.7;
    for (const off of X < 40 ? [0, W] : X > W - 40 ? [0, -W] : [0]) {
      h.beginPath();
      h.moveTo(X + off, Y);
      h.quadraticCurveTo(X + off + dx * len * 0.5 + dy * 1.5, Y + dy * len * 0.5 - dx * 1.5, X + off + dx * len, Y + dy * len);
      h.stroke();
    }
  }
  void o;
}

/** 发际线上的碎发：从头发区里往外伸出的短细线。 */
function flyaways(g: CanvasRenderingContext2D, def: ReturnType<typeof headSurface>['hair'], hair: RGB, r: () => number): void {
  if (!def.line) return;
  g.lineCap = 'round';
  // fix1：更多、更长、方向各异的碎发，把发际线打散（越过边线伸到额头上、鬓角上）
  for (let i = 0; i < 520; i++) {
    const u = 0.1 + r() * 0.8;
    const psi = psiOfU(u);
    const a = hairEdge(def, psi);
    if (def.minPsi !== undefined && Math.abs(psi) < def.minPsi) continue;
    // 往后梳的（发髻、低髻）：碎发从发际线下面一点往上、往后翘（胎毛），不是往脸上垂的刘海
    const back = !!def.bun;
    const v0 = vOfAlpha(a + (back ? r() * 1.6 - 1.4 : r() * 3.2 - 0.6) * DEG);
    const X = u * W, Y = (1 - v0) * H;
    const len = (back ? 2 : 2.5) + r() * (back ? 4 : 7);
    const ang = (back ? -Math.PI / 2 : Math.PI / 2) + (r() - 0.5) * 1.3 + (u - 0.5) * 1.1;
    g.strokeStyle = css(mul(hair, 0.85 + r() * 0.3), 0.22 + r() * 0.3);
    g.lineWidth = 0.5 + r() * 0.6;
    g.beginPath();
    g.moveTo(X, Y);
    g.quadraticCurveTo(X + Math.cos(ang) * len * 0.5 + (r() - 0.5) * 2, Y + Math.sin(ang) * len * 0.5, X + Math.cos(ang) * len, Y + Math.sin(ang) * len);
    g.stroke();
  }
}
