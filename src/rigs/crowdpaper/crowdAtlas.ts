// owner: WP2
// char2 WP-X：人群图集（256²，每套衣服一张）。逐像素画（不靠 faceTexture）：每个像素按 person.ts 的 UV 布局反算回
// 身体表面的 (θ, y)，再判断是头发、眼、眉、鼻孔、嘴、领口、扣子、口袋、腰带、裤子……几何与贴图用同一套函数，五官正好落在鼻梁楔两侧。
// 像素数组按套缓存（同一套衣服只算一次）；每个人群各自包一张 CanvasTexture（随人群释放）。

import * as THREE from 'three';
import { canvasToTexture, createCanvas, hexRgb } from '../../kit/canvas';
import { clamp01, lerp, smoothstep, spow } from './meshkit';
import { ARM_ROW, ARM_T, ATLAS_PX, ADULT, REG, angleOfU, bodyYofT, hairline, headRadius, type Rect } from './person';

export interface CrowdOutfit {
  hair: string; skin: string; shirt: string; pants: string; shoes: string; sole: string;
  sleeves: 'short' | 'long'; collar: 'open' | 'band' | 'round'; pockets: 0 | 1 | 2; belt: boolean; old: boolean; placket: boolean;
  /** fix1：脸型变体（眼宽、眉粗、眉弓、嘴宽、嘴角）：三套衣服三张不同的脸 */
  fv?: 0 | 1 | 2;
}
const FACE_V = [
  { eyeW: 0.0118, eyeY: 1.6375, brow: 1, arch: 0.003, mouthW: 0.0185, curve: 0.0011 },
  { eyeW: 0.0106, eyeY: 1.6392, brow: 1.4, arch: 0.0012, mouthW: 0.021, curve: 0.0003 },
  { eyeW: 0.0126, eyeY: 1.6362, brow: 0.8, arch: 0.0042, mouthW: 0.0165, curve: 0.0019 },
] as const;

/** 三套八九十年代街坊的衣服（与旧版同样的头发 / 上衣 / 裤子颜色）。 */
export const CROWD_OUTFITS: readonly CrowdOutfit[] = [
  { hair: '#15120f', skin: '#C9A080', shirt: '#E4E0D4', pants: '#34405E', shoes: '#1d1a18', sole: '#cdc6b6', sleeves: 'short', collar: 'open', pockets: 1, belt: true, old: false, placket: true, fv: 0 },
  { hair: '#1c1714', skin: '#C39878', shirt: '#4E6386', pants: '#2B2C31', shoes: '#2c2119', sole: '#3a3430', sleeves: 'long', collar: 'band', pockets: 2, belt: false, old: false, placket: true, fv: 1 },
  { hair: '#8a8680', skin: '#C09A7E', shirt: '#8A3B32', pants: '#4A4238', shoes: '#1d1a18', sole: '#cdc6b6', sleeves: 'long', collar: 'round', pockets: 0, belt: false, old: true, placket: true, fv: 2 },
];

type RGB = [number, number, number];
const rgb = (hex: string): RGB => hexRgb(hex);
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
/** 便宜的确定性噪声（-1..1）。 */
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}
/** 平滑的值噪声（-1..1）。 */
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

// ---------------------------------------------------------------- 各区域的画法

function paintBody(o: CrowdOutfit, s: number, t: number): RGB {
  const th = angleOfU(s);
  const y = bodyYofT(t);
  const sn = Math.sin(th), cs = Math.cos(th);
  const skin = rgb(o.skin), hair = rgb(o.hair), shirt = rgb(o.shirt), pants = rgb(o.pants);
  // 表面横向坐标（头：用头的半径；躯干：近似）
  const hx = headRadius(th, Math.max(y, 1.5), ADULT, false).r * cs;
  const weave = 1 + 0.035 * vnoise(s * 180, t * 160) + 0.02 * hash2(s * 999, t * 777);

  // ---- 领口以上：皮肤 / 头
  const fvv = FACE_V[o.fv ?? 0];
  const front = Math.max(0, sn);
  let collarY: number;
  if (o.collar === 'open') collarY = 1.474 - 0.058 * Math.pow(front, 10);
  else if (o.collar === 'band') collarY = 1.482 - 0.012 * Math.pow(front, 6);
  else collarY = 1.47 - 0.024 * Math.pow(front, 4);

  if (y > collarY) {
    let c: RGB = skin;
    // 皮肤的冷暖：耳朵、脸颊、鼻尖暖一点，脖子背面暗一点
    if (y < 1.55) c = mul(c, 0.94 + 0.04 * front);
    if (y > 1.5) {
      const ear = Math.max(Math.abs(Math.cos(th + 0.12)), 0) > 0.93 && y > 1.6 && y < 1.65;
      if (ear) c = mix(c, [190, 110, 96], 0.18);
      // 脸颊红晕
      const ch = Math.exp(-(((Math.abs(hx) - 0.045) / 0.017) ** 2) - ((y - 1.612) / 0.016) ** 2) * front;
      c = mix(c, [214, 128, 112], (o.old ? 0.08 : 0.16) * ch);
      // 鼻尖略暖，鼻底一道阴影，两个鼻孔
      if (front > 0.85) {
        c = mix(c, [204, 120, 104], 0.12 * Math.exp(-((hx / 0.01) ** 2) - ((y - 1.606) / 0.006) ** 2));
        for (const sx of [-1, 1]) {
          const dn = Math.hypot((hx - sx * 0.0075) / 0.0034, (y - 1.5995) / 0.0022);
          if (dn < 1.4) c = mix(c, [70, 40, 32], 0.75 * smoothstep(1.4, 0.6, dn));
        }
        // 嘴：上唇、下唇、唇缝
        const mw = fvv.mouthW;
        const mx = hx / mw;
        if (Math.abs(mx) < 1.15) {
          const curve = fvv.curve * mx * mx;
          const lineY = 1.5755 + curve;
          const e = smoothstep(1.15, 0.85, Math.abs(mx));
          const up = y - lineY;
          if (up > 0 && up < 0.0034 * (1 - 0.6 * mx * mx)) c = mix(c, [150, 82, 72], 0.55 * e);
          if (up < 0 && up > -0.0036 * (1 - 0.5 * mx * mx)) c = mix(c, [176, 104, 92], 0.45 * e);
          if (Math.abs(up) < 0.0011) c = mix(c, [74, 34, 30], 0.85 * e);
        }
        // 老人：法令纹、抬头纹（浅）
        if (o.old) {
          for (const sx of [-1, 1]) {
            const k = (y - 1.57) / (1.6 - 1.57);
            if (k > 0 && k < 1) {
              const lx = sx * lerp(0.031, 0.019, k);
              if (Math.abs(hx - lx) < 0.0016) c = mul(c, 0.86);
            }
          }
          if (Math.abs(hx) < 0.04 && (Math.abs(y - 1.668) < 0.0012 || Math.abs(y - 1.675) < 0.0011)) c = mul(c, 0.9);
        }
      }
      // 眼：杏核眼、深色虹膜、上眼线（只画正脸）
      if (front > 0.6) {
        for (const sx of [-1, 1]) {
          const ex = sx * 0.0315, ey = fvv.eyeY;
          const dx = (hx - ex) / fvv.eyeW;
          if (Math.abs(dx) < 1.1) {
            const lid = Math.max(0, 1 - dx * dx);
            const dy = (y - ey) / 0.0048;
            const inside = Math.abs(dy) < 0.95 * lid;
            if (inside) {
              c = mix(c, [214, 204, 190], 0.75);
              const di = Math.hypot((hx - ex + sx * 0.001) / 0.0052, (y - ey + 0.0004) / 0.0052);
              if (di < 1) c = mix(c, [42, 26, 18], smoothstep(1, 0.6, di));
              if (di < 0.35) c = [20, 12, 10];
            }
            // 上眼线：外眼角更粗
            const upper = dy - 0.95 * lid;
            const thick = 0.45 + 0.35 * clamp01(dx * sx);
            if (upper > -0.25 && upper < thick && Math.abs(dx) < 1.05) c = mix(c, [26, 18, 16], 0.85);
            // 下眼睑淡淡一道
            const lower = -dy - 0.95 * lid;
            if (lower > -0.15 && lower < 0.25 && Math.abs(dx) < 0.9) c = mix(c, [120, 80, 66], 0.3);
          }
          // 眉：眉头 → 眉峰 → 眉尾，一束渐细的笔画
          const bx = Math.abs(hx), side = Math.sign(hx) === sx;
          if (side && bx > 0.012 && bx < 0.051) {
            const k = (bx - 0.012) / 0.039;
            const by = 1.6505 + fvv.arch * Math.sin(Math.PI * Math.min(1, k * 1.25)) - 0.0012 * k;
            const th2 = lerp(0.0021, 0.0011, k) * (o.old ? 1.2 : 1) * fvv.brow;
            const dd = Math.abs(y - by);
            if (dd < th2) c = mix(c, o.old ? [120, 116, 110] : mul(hair, 0.9), 0.85 * smoothstep(th2, th2 * 0.4, dd));
          }
        }
      }
    }
    // ---- 头发（发际线以上；边缘几根飞丝，不是一刀切）
    const hl = hairline(th) + 0.0018 * Math.sin(th * 37) + 0.0012 * Math.sin(th * 91 + 1.3);
    // fix2：发际线软一点、碎一点
    const hairK = smoothstep(hl - 0.003 + 0.002 * vnoise(th * 70, 3.1), hl + 0.004, y);
    if (hairK > 0) {
      // 顺着头发走的细纹：后脑往下梳，前面往后梳
      const strand = 0.86 + 0.14 * vnoise(th * 60, y * 25) + 0.06 * hash2(Math.floor(th * 220), 3);
      let hc: RGB = mul(hair, strand);
      if (o.old) hc = mix(hc, [200, 198, 192], 0.25 + 0.25 * clamp01(vnoise(th * 90, y * 60) * 0.5 + 0.5));
      // 头顶一道柔和的高光带、发根暗
      hc = mul(hc, 1 + 0.18 * Math.exp(-(((y - 1.715) / 0.012) ** 2)) * (0.6 + 0.4 * front));
      hc = mix(hc, mul(hair, 0.7), 0.35 * smoothstep(hl + 0.006, hl, y));
      c = mix(c, hc, hairK);
    }
    return c;
  }

  // ---- 领口以下：上衣 / 腰带 / 裤子
  const waist = o.belt ? 1.0 : 0.965;
  let c: RGB;
  if (y > waist + 0.012 || (!o.belt && y > waist)) {
    c = mul(shirt, weave);
    const x = 0.16 * spow(Math.cos(th), 0.74); // 躯干横向坐标（近似）
    // 领子：领口下一条布边 + 阴影线
    const below = collarY - y;
    if (below < 0.0025) c = mul(c, 0.62);
    else if (below < (o.collar === 'open' ? 0.016 : 0.012)) c = mul(c, o.collar === 'band' ? 0.9 : 1.08);
    else if (below < (o.collar === 'open' ? 0.019 : 0.015)) c = mul(c, 0.82);
    // 门襟、扣子（正面中线）
    if (o.placket && front > 0.9 && y < collarY - 0.01) {
      const px = Math.abs(x) / 0.16 * 0.16;
      if (Math.abs(x - 0.011) < 0.0012 || (o.collar !== 'open' && Math.abs(x + 0.011) < 0.0012)) c = mul(c, 0.82);
      const step = 0.072;
      const k = ((collarY - 0.035 - y) / step);
      const kk = k - Math.round(k);
      if (k > -0.3 && y > waist + 0.03 && px < 0.004 && Math.abs(kk) < 0.06) c = o.shirt === '#E4E0D4' ? [230, 226, 214] : mul(c, 1.35);
    }
    // 口袋（左胸，或两个带盖的）
    const pockets = o.pockets === 2 ? [-1, 1] : o.pockets === 1 ? [-1] : [];
    for (const sx of pockets) {
      const pxc = sx * 0.07;
      const inx = Math.abs(x - pxc) < 0.033 && front > 0.5;
      if (inx && y < 1.335 && y > 1.265) {
        const edge = Math.min(Math.abs(Math.abs(x - pxc) - 0.033), Math.abs(y - 1.265), Math.abs(y - 1.335));
        if (edge < 0.0018) c = mul(c, 0.8);
        if (o.pockets === 2 && y > 1.318 && y < 1.322) c = mul(c, 0.78); // 袋盖
      }
    }
    // 腰部衣褶：两三道柔和的斜纹（不是一排肋骨）
    const fold = Math.exp(-(((y - 1.05 - 0.4 * x) / 0.012) ** 2)) * 0.05 + Math.exp(-(((y - 1.03 + 0.5 * x) / 0.01) ** 2)) * 0.04;
    c = mul(c, 1 - fold * (front > 0.3 ? 1 : 0.5));
    // 不扎腰：下摆一道边
    if (!o.belt && y < waist + 0.012) c = mul(c, 0.8);
  } else if (o.belt && y > waist - 0.008) {
    c = [44, 36, 32];
    if (front > 0.985 && Math.abs(y - waist - 0.002) < 0.006) c = [150, 140, 120]; // 皮带扣
  } else {
    c = mul(pants, weave);
    // 门襟与侧缝
    const x = 0.16 * spow(Math.cos(th), 0.74);
    if (front > 0.9 && y > 0.86 && Math.abs(x - 0.012) < 0.0014) c = mul(c, 0.8);
    if (Math.abs(Math.cos(th)) > 0.985 && y < waist - 0.02) c = mul(c, 0.86);
    // 裤腰下一道暗
    c = mul(c, 1 - 0.12 * smoothstep(waist - 0.03, waist - 0.008, y));
  }
  return c;
}

function paintLegs(o: CrowdOutfit, s: number, t: number): RGB {
  const pants = rgb(o.pants);
  let c = mul(pants, 1 + 0.035 * vnoise(s * 70, t * 140) + 0.02 * hash2(s * 333, t * 555));
  // 膝弯的几道横褶、裤脚的堆褶（浅）
  c = mul(c, 1 - 0.06 * Math.exp(-(((t - 0.45) / 0.03) ** 2)) * (0.5 + 0.5 * Math.sin(s * Math.PI * 2 * 3)));
  if (t > 0.86) c = mul(c, 1 - 0.07 * (0.5 + 0.5 * Math.sin(t * 160)));
  if (t > 0.975) c = mul(c, 0.8);
  // 侧缝（两条腿的 u=0 都在外侧后方附近，画一道淡线）
  if (Math.abs(s - 0.13) < 0.006 || Math.abs(s - 0.63) < 0.006) c = mul(c, 0.9);
  return c;
}

function paintArms(o: CrowdOutfit, s: number, t: number): RGB {
  const skin = rgb(o.skin), shirt = rgb(o.shirt);
  const tWrist = ARM_T[ARM_ROW.wrist]!, tHem = ARM_T[ARM_ROW.lipIn]!, tPalm = ARM_T[ARM_ROW.palm]!;
  const sleeveEnd = o.sleeves === 'short' ? tHem + 0.006 : tWrist - 0.004;
  if (t < sleeveEnd) {
    let c = mul(shirt, 1 + 0.035 * vnoise(s * 60, t * 120));
    if (o.sleeves === 'short' && Math.abs(t - ARM_T[ARM_ROW.sleeveHem]! + 0.012) < 0.004) c = mul(c, 0.85); // 袖口折边
    if (o.sleeves === 'long') {
      if (t > sleeveEnd - 0.05 && t < sleeveEnd - 0.045) c = mul(c, 0.8); // 袖口
      // 肘弯斜褶
      const tE = ARM_T[8]!;
      c = mul(c, 1 - 0.07 * Math.exp(-(((t - tE - 0.03 * Math.sin(s * Math.PI * 2)) / 0.012) ** 2)));
    }
    return c;
  }
  let c: RGB = skin;
  if (t > tPalm) {
    // 连指手：指缝几道细线（手背、手心各两道）、指节略暗
    const ft = ARM_T[13]! + 0.012;
    // fix2：指缝更清楚（近看不是一把勺子）
    if (t > ft) for (const ss of [0.045, 0.955, 0.455, 0.545, 0.0, 0.5]) if (Math.abs(s - ss) < 0.009) c = mul(c, 0.66);
    if (Math.abs(t - ARM_T[13]!) < 0.006) c = mul(c, 0.93);
    c = mix(c, [210, 130, 112], 0.08);
  } else if (o.sleeves === 'short') {
    c = mul(c, 0.97 + 0.03 * Math.sin(s * Math.PI * 2));
  }
  return c;
}

// ---------------------------------------------------------------- 整张

const cache = new Map<number, Uint8ClampedArray>();

function paintPixels(o: CrowdOutfit): Uint8ClampedArray {
  const W = ATLAS_PX;
  const buf = new Uint8ClampedArray(W * W * 4);
  const done = new Uint8Array(W * W);
  const shoes = rgb(o.shoes), sole = rgb(o.sole), skin = rgb(o.skin);
  const regions: [Rect, (s: number, t: number) => RGB][] = [
    [REG.body, (s, t) => paintBody(o, s, t)],
    [REG.legs, (s, t) => paintLegs(o, s, t)],
    [REG.arms, (s, t) => paintArms(o, s, t)],
    [REG.shoe, (s, t) => mul(shoes, (1 + 0.05 * vnoise(s * 30, t * 30)) * (Math.abs(s - 0.5) < 0.03 ? 0.85 : 1))],
    [REG.sole, () => sole],
    [REG.skin, () => skin],
  ];
  const put = (x: number, y: number, c: RGB) => {
    const i = (y * W + x) * 4;
    buf[i] = c[0];
    buf[i + 1] = c[1];
    buf[i + 2] = c[2];
    buf[i + 3] = 255;
    done[y * W + x] = 1;
  };
  const INSET = 1.5;
  const st = (r: Rect, x: number, y: number): [number, number] => [
    clamp01((x + 0.5 - r[0] - INSET) / (r[2] - 2 * INSET)), clamp01((y + 0.5 - r[1] - INSET) / (r[3] - 2 * INSET)),
  ];
  // 先画各区域里面，再给没画到的像素铺 4 像素的出血（同区域边上的颜色），mipmap 不串色
  for (const [r, fn] of regions) {
    for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) put(x, y, fn(...st(r, x, y)));
  }
  for (const [r, fn] of regions) {
    for (let y = Math.max(0, r[1] - 4); y < Math.min(W, r[1] + r[3] + 4); y++) {
      for (let x = Math.max(0, r[0] - 4); x < Math.min(W, r[0] + r[2] + 4); x++) if (!done[y * W + x]) put(x, y, fn(...st(r, x, y)));
    }
  }
  for (let i = 0; i < W * W; i++) if (!done[i]) { buf[i * 4] = 40; buf[i * 4 + 1] = 36; buf[i * 4 + 2] = 34; buf[i * 4 + 3] = 255; }
  return buf;
}

/** 第 v 套衣服的图集（新贴图；像素缓存共享）。 */
export function crowdAtlas(v: number): THREE.CanvasTexture {
  const o = CROWD_OUTFITS[((v % CROWD_OUTFITS.length) + CROWD_OUTFITS.length) % CROWD_OUTFITS.length]!;
  let px = cache.get(v);
  if (!px) cache.set(v, (px = paintPixels(o)));
  const { canvas, g } = createCanvas(ATLAS_PX, ATLAS_PX);
  const img = g.createImageData(ATLAS_PX, ATLAS_PX) as ImageData | undefined;
  if (img && img.data instanceof Uint8ClampedArray) {
    img.data.set(px);
    g.putImageData(img, 0, 0);
  }
  const tex = canvasToTexture(canvas, { anisotropy: 2 });
  tex.name = 'crowd.atlas';
  return tex;
}

/** 图集像素（RGBA，256²；测试与离线预览用）。 */
export function crowdAtlasPixels(v: number): Uint8ClampedArray {
  const o = CROWD_OUTFITS[((v % CROWD_OUTFITS.length) + CROWD_OUTFITS.length) % CROWD_OUTFITS.length]!;
  let px = cache.get(v);
  if (!px) cache.set(v, (px = paintPixels(o)));
  return px;
}
