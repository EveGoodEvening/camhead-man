// owner: WP2
// 衣服贴图（char2 WP0 从 accessories.ts 原样搬来；accessories.ts 仍原名转出）：值勤衬衫、中山装、碎花布、长袍、袖箍、布鞋、纸纹。
// 躯干 UV：左半 = 前胸，右半 = 后背（见 human/shared.ts squircleLoft）。尺寸固定（画布预算，PLAN §0.4）。

import * as THREE from 'three';
import { PALETTE } from '../../data/palette';
import { blotch, grain, paintTexture, shade, waterStain } from '../../kit/canvas';
import { rng, range } from '../../kit/rng';
import { FONT_STACK } from '../../kit/text';

// ---------------------------------------------------------------- 衣服贴图（躯干 UV：左半 = 前胸，右半 = 后背，见 humanoid.ts torsoGeo）

const texCache = new Map<string, THREE.CanvasTexture>();
function cachedTex(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    t.name = key;
    texCache.set(key, t);
  }
  return t;
}

/** 布纹：细密的经纬线 + 颗粒。 */
function weave(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number): void {
  const r = rng(seed);
  g.save();
  g.globalAlpha = 0.07;
  g.fillStyle = '#000';
  for (let yy = y; yy < y + h; yy += 3) g.fillRect(x, yy, w, 1);
  g.fillStyle = '#fff';
  for (let xx = x; xx < x + w; xx += 3) g.fillRect(xx, y, 1, h);
  g.globalAlpha = 1;
  for (let i = 0; i < w * h / 400; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
    g.fillRect(x + r() * w, y + r() * h, 2, 2);
  }
  g.restore();
}

function button(g: CanvasRenderingContext2D, x: number, y: number, rad: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, rad, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.arc(x - rad * 0.25, y, rad * 0.18, 0, Math.PI * 2);
  g.arc(x + rad * 0.25, y, rad * 0.18, 0, Math.PI * 2);
  g.fill();
}

function pocket(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string, flap = true, btn = true): void {
  g.strokeStyle = shade(base, 0.62);
  g.lineWidth = 3;
  g.strokeRect(x, y, w, h);
  g.strokeStyle = shade(base, 1.35);
  g.lineWidth = 1;
  g.strokeRect(x + 3, y + 3, w - 6, h - 6);
  if (flap) {
    g.fillStyle = shade(base, 0.9);
    g.fillRect(x - 2, y - 2, w + 4, h * 0.28);
    g.strokeStyle = shade(base, 0.55);
    g.lineWidth = 2;
    g.strokeRect(x - 2, y - 2, w + 4, h * 0.28);
    if (btn) button(g, x + w / 2, y + h * 0.16, 5, shade(base, 0.7));
  }
}

/**
 * 藏蓝短袖值勤衬衫（主角、老周）：门襟一排纽扣、两个带盖胸袋、领口 V 形开口、肩部过肩线。
 * worn：洗得发白、胳肢窝的汗渍（老周那件穿了很多年）。
 */
export function uniformShirtTexture(): THREE.CanvasTexture {
  return cachedTex('outfit.uniform', () => paintTexture(512, 256, (g, w, h) => {
    const base = PALETTE.UNIFORM;
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    weave(g, 0, 0, w, h, 55);
    const fw = w / 2;
    // 前胸：领口开口（深色三角）
    g.fillStyle = '#10141f';
    g.beginPath();
    g.moveTo(fw * 0.38, 0);
    g.lineTo(fw * 0.62, 0);
    g.lineTo(fw * 0.5, h * 0.2);
    g.closePath();
    g.fill();
    // 领子翻边
    g.fillStyle = shade(base, 1.18);
    g.beginPath();
    g.moveTo(fw * 0.3, 0);
    g.lineTo(fw * 0.38, 0);
    g.lineTo(fw * 0.5, h * 0.2);
    g.lineTo(fw * 0.42, h * 0.16);
    g.closePath();
    g.moveTo(fw * 0.7, 0);
    g.lineTo(fw * 0.62, 0);
    g.lineTo(fw * 0.5, h * 0.2);
    g.lineTo(fw * 0.58, h * 0.16);
    g.closePath();
    g.fill();
    // 门襟与纽扣
    g.fillStyle = shade(base, 0.8);
    g.fillRect(fw * 0.49, h * 0.2, fw * 0.035, h * 0.8);
    for (let i = 0; i < 4; i++) button(g, fw * 0.507, h * (0.3 + i * 0.19), 4.5, '#d8d4c8');
    // 胸袋（从正面看：画面左 = 人的右胸）
    pocket(g, fw * 0.12, h * 0.3, fw * 0.24, h * 0.24, base);
    pocket(g, fw * 0.64, h * 0.3, fw * 0.24, h * 0.24, base);
    // 左胸（画面右）袋口别的一支笔
    g.fillStyle = '#1b1b1b';
    g.fillRect(fw * 0.8, h * 0.24, 4, h * 0.1);
    g.fillStyle = '#c8b25a';
    g.fillRect(fw * 0.8, h * 0.24, 4, 5);
    // 下摆塞进裤腰的褶
    g.strokeStyle = shade(base, 0.7);
    g.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      const x = fw * (0.1 + i * 0.16);
      g.moveTo(x, h);
      g.lineTo(x + 6, h * 0.86);
      g.stroke();
    }
    // 后背：过肩线
    g.strokeStyle = shade(base, 0.72);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(fw, h * 0.22);
    g.quadraticCurveTo(fw * 1.5, h * 0.28, w, h * 0.22);
    g.stroke();
    // 洗旧：发白的斑
    const r = rng(56);
    for (let i = 0; i < 14; i++) blotch(g, r, r() * w, r() * h, range(r, 10, 30), shade(base, 1.25), 0.08, 4);
  }));
}

/** 中山装前胸（陆师傅灰色、黄三爷旧的蓝灰）：翻领、五粒扣、四个口袋。 */
export function zhongshanTexture(color: string): THREE.CanvasTexture {
  return cachedTex(`outfit.zhongshan.${color}`, () => paintTexture(512, 256, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    weave(g, 0, 0, w, h, 71);
    const fw = w / 2;
    // 立翻领
    g.fillStyle = shade(color, 0.75);
    g.fillRect(fw * 0.36, 0, fw * 0.28, h * 0.06);
    g.fillStyle = shade(color, 1.15);
    g.beginPath();
    g.moveTo(fw * 0.3, 0);
    g.lineTo(fw * 0.5, h * 0.16);
    g.lineTo(fw * 0.7, 0);
    g.lineTo(fw * 0.64, 0);
    g.lineTo(fw * 0.5, h * 0.1);
    g.lineTo(fw * 0.36, 0);
    g.closePath();
    g.fill();
    g.fillStyle = shade(color, 0.7);
    g.fillRect(fw * 0.495, h * 0.12, fw * 0.02, h * 0.88);
    for (let i = 0; i < 5; i++) button(g, fw * 0.505, h * (0.2 + i * 0.17), 4.5, shade(color, 0.55));
    pocket(g, fw * 0.13, h * 0.28, fw * 0.22, h * 0.2, color);
    pocket(g, fw * 0.65, h * 0.28, fw * 0.22, h * 0.2, color);
    pocket(g, fw * 0.08, h * 0.68, fw * 0.28, h * 0.26, color);
    pocket(g, fw * 0.64, h * 0.68, fw * 0.28, h * 0.26, color);
    g.strokeStyle = shade(color, 0.7);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(fw, h * 0.22);
    g.quadraticCurveTo(fw * 1.5, h * 0.3, w, h * 0.22);
    g.stroke();
  }));
}

/** 碎花布衫（王奶奶）：深底小白花，整件都是花（袖子也用）。 */
export function floralTexture(base = '#5B6E8C', seed = 3): THREE.CanvasTexture {
  return cachedTex(`outfit.floral.${base}.${seed}`, () => paintTexture(256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const r = rng(seed);
    for (let i = 0; i < 160; i++) {
      const x = r() * w, y = r() * h;
      const c = r() < 0.6 ? '#E8E4D8' : r() < 0.5 ? '#E6A5A5' : '#F0D68A';
      g.fillStyle = c;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        g.beginPath();
        g.arc(x + Math.cos(a) * 3, y + Math.sin(a) * 3, 2.2, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#C9A13A';
      g.beginPath();
      g.arc(x, y, 1.5, 0, Math.PI * 2);
      g.fill();
    }
    weave(g, 0, 0, w, h, seed + 1);
  }, { repeat: [1, 1] }));
}

/** 土地的长袍：灰布，下摆一道深色宽边，腰上一条系带。Lathe 的 v 从下（0）到上（1）。 */
export function robeTexture(): THREE.CanvasTexture {
  return cachedTex('outfit.robe', () => paintTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#7C7A74';
    g.fillRect(0, 0, w, h);
    weave(g, 0, 0, w, h, 91);
    g.fillStyle = '#4C4A46';
    g.fillRect(0, h * 0.88, w, h * 0.12);
    g.fillStyle = '#A2865A';
    g.fillRect(0, h * 0.86, w, h * 0.02);
    // 衣褶
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      g.beginPath();
      g.moveTo((i / 12) * w, h * 0.1);
      g.lineTo((i / 12) * w + 4, h * 0.86);
      g.stroke();
    }
  }));
}

/** 值勤袖箍：红底黄字“值勤”，字在朝外的一侧（圆柱 u=0.75 → 左臂的外侧 -x）。 */
export function armbandTexture(): THREE.CanvasTexture {
  return cachedTex('outfit.armband', () => paintTexture(512, 128, (g, w, h) => {
    g.fillStyle = '#B81D1D';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#E8C04A';
    g.fillRect(0, h * 0.08, w, h * 0.04);
    g.fillRect(0, h * 0.88, w, h * 0.04);
    g.fillStyle = '#F4D35A';
    g.font = `bold ${Math.round(h * 0.6)}px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.save();
    // 圆柱 UV 的 u 在外侧是反着走的：水平翻转，从外面看才是正字
    g.translate(w * 0.75, h * 0.53);
    g.scale(-1, 1);
    g.fillText('值勤', 0, 0);
    g.restore();
    weave(g, 0, 0, w, h, 17);
    const r = rng(18);
    waterStain(g, r, w * 0.3, h * 0.5, h * 0.6);
  }));
}

/** 黑布鞋：黑色布面、白色千层底（鞋盒 UV：顶面映到 v≈0.9，底面 v≈0.05，侧面下四分之一是鞋底）。 */
export function clothShoeTexture(): THREE.CanvasTexture {
  return cachedTex('outfit.clothShoe', () => paintTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#141416';
    g.fillRect(0, 0, w, h);
    weave(g, 0, 0, w, h * 0.72, 23);
    g.fillStyle = '#DAD5C6';
    g.fillRect(0, h * 0.74, w, h * 0.26);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = 0; x < w; x += 6) g.fillRect(x, h * 0.78, 2, h * 0.18);
    g.fillStyle = '#0b0b0c';
    g.fillRect(0, h * 0.72, w, 3);
  }));
}

/** 纸张：白纸 + 折痕，给纸人衣服与灯笼用（paper.ts 也用）。 */
export function paperGrain(g: CanvasRenderingContext2D, w: number, h: number, seed: number, strength = 1): void {
  const r = rng(seed);
  g.save();
  g.strokeStyle = `rgba(0,0,0,${0.08 * strength})`;
  g.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    g.beginPath();
    const x = r() * w, y = r() * h;
    g.moveTo(x, y);
    g.lineTo(x + range(r, -w * 0.4, w * 0.4), y + range(r, -h * 0.2, h * 0.2));
    g.stroke();
  }
  g.restore();
  grain(g, w, h, 0.1 * strength, seed + 1);
}
