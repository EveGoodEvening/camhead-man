// owner: R3
// R3 的程序化贴图画法（GDD §9.4：全部 CanvasTexture）：老照片图集、取件格编号、背景布、底片、暗房守则、价目表、卷帘门、
// 纸扎店橱窗（红灯泡照着纸人纸马，烘焙光照）、粉笔“转让”、站牌、日历……只导出画法函数，由各 build 文件 paintTexture。

import { FONT_STACK } from '../../../kit/text';
import { HAND_FONT_STACK, SERIF_FONT_STACK, agePaper, blotch, drawHandLine, grain, shade, waterStain } from '../../../kit/canvas';
import { rng, range, pick } from '../../../kit/rng';
import { roundRect } from './util';
import { TEXT } from '../text';

type Paint = (g: CanvasRenderingContext2D, w: number, h: number) => void;
type R = () => number;

// ==================================================================== 人像小画法（老照片、样片、底片共用）

type Tone = 'bw' | 'sepia' | 'tint';

/** 一个半身人像：头、脸（简单五官）、肩膀与衣领。cx,cy 为头心，s 为头半径。 */
function bust(g: CanvasRenderingContext2D, r: R, cx: number, cy: number, s: number, o: { cloth: string; hair: string; skin: string; female?: boolean; cap?: 'grad' | 'army' | 'none'; veil?: boolean; old?: boolean }): void {
  g.save();
  // 肩膀与衣服
  g.fillStyle = o.cloth;
  g.beginPath();
  g.moveTo(cx - s * 2.3, cy + s * 4.2);
  g.quadraticCurveTo(cx - s * 2.2, cy + s * 1.5, cx - s * 0.7, cy + s * 1.25);
  g.lineTo(cx + s * 0.7, cy + s * 1.25);
  g.quadraticCurveTo(cx + s * 2.2, cy + s * 1.5, cx + s * 2.3, cy + s * 4.2);
  g.closePath();
  g.fill();
  // 衣领（白）
  g.fillStyle = 'rgba(240,236,226,0.9)';
  g.beginPath();
  g.moveTo(cx - s * 0.55, cy + s * 1.2);
  g.lineTo(cx, cy + s * 1.9);
  g.lineTo(cx + s * 0.55, cy + s * 1.2);
  g.closePath();
  g.fill();
  // 脖子
  g.fillStyle = shade(o.skin, 0.85);
  g.fillRect(cx - s * 0.35, cy + s * 0.7, s * 0.7, s * 0.6);
  // 头发（后）
  if (o.female || o.veil) {
    g.fillStyle = o.veil ? 'rgba(250,250,250,0.85)' : o.hair;
    g.beginPath();
    g.ellipse(cx, cy + s * 0.3, s * 1.25, s * 1.55, 0, 0, Math.PI * 2);
    g.fill();
  }
  // 脸
  g.fillStyle = o.skin;
  g.beginPath();
  g.ellipse(cx, cy, s * 0.82, s, 0, 0, Math.PI * 2);
  g.fill();
  // 头发（前）
  g.fillStyle = o.old ? '#d8d6d0' : o.hair;
  g.beginPath();
  g.ellipse(cx, cy - s * 0.45, s * 0.86, s * 0.6, 0, Math.PI, Math.PI * 2);
  g.fill();
  if (o.female && !o.veil) {
    g.fillRect(cx - s * 0.86, cy - s * 0.5, s * 0.25, s * 1.3);
    g.fillRect(cx + s * 0.61, cy - s * 0.5, s * 0.25, s * 1.3);
  }
  // 五官
  g.fillStyle = 'rgba(30,24,20,0.8)';
  g.fillRect(cx - s * 0.38, cy - s * 0.08, s * 0.2, s * 0.08);
  g.fillRect(cx + s * 0.18, cy - s * 0.08, s * 0.2, s * 0.08);
  g.fillStyle = 'rgba(120,60,50,0.55)';
  g.fillRect(cx - s * 0.2, cy + s * 0.45, s * 0.4, s * 0.07);
  if (o.cap === 'grad') {
    g.fillStyle = '#151515';
    g.fillRect(cx - s * 1.1, cy - s * 1.15, s * 2.2, s * 0.25);
    g.fillRect(cx - s * 0.7, cy - s * 1.0, s * 1.4, s * 0.5);
  } else if (o.cap === 'army') {
    g.fillStyle = '#4c5a36';
    g.beginPath();
    g.ellipse(cx, cy - s * 0.75, s * 0.95, s * 0.45, 0, Math.PI, Math.PI * 2);
    g.fill();
    g.fillRect(cx - s * 0.95, cy - s * 0.8, s * 1.9, s * 0.18);
    g.fillStyle = '#c42';
    g.beginPath();
    g.arc(cx, cy - s * 0.95, s * 0.14, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  void r;
}

/** 调色：黑白、褐色、手工上色（淡彩）。 */
function tonePalette(t: Tone, r: R): { bg0: string; bg1: string; skin: string; hair: string; cloth: () => string } {
  if (t === 'bw') return { bg0: '#8a8a88', bg1: '#3a3a3a', skin: '#c9c6c0', hair: '#1e1e1e', cloth: () => pick(r, ['#2a2a2a', '#4a4a4a', '#606060', '#1a1a1a']) };
  if (t === 'sepia') return { bg0: '#a58a62', bg1: '#4e3a24', skin: '#d8bf98', hair: '#2a1d12', cloth: () => pick(r, ['#3a2a1a', '#5a4430', '#2a1e14']) };
  return { bg0: '#8aa0b0', bg1: '#3e4c5a', skin: '#e6c0a0', hair: '#1c1612', cloth: () => pick(r, ['#8a2a2a', '#2a4a7a', '#3e5a3a', '#6a4a8a', '#222']) };
}

/** 一张老照片（画在 (x,y,w,h) 里，带白边）。kind 决定构图。 */
export function drawPortrait(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, kind: number, seed: number, border = true): void {
  const r = rng(seed * 131 + kind);
  const tone: Tone = pick(r, ['bw', 'sepia', 'tint', 'bw', 'sepia'] as const);
  const P = tonePalette(tone, r);
  g.save();
  if (border) {
    g.fillStyle = tone === 'bw' ? '#ecebe6' : '#efe6d2';
    g.fillRect(x, y, w, h);
    x += w * 0.06;
    y += h * 0.06;
    w *= 0.88;
    h *= 0.88;
  }
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  const bg = g.createRadialGradient(x + w * 0.5, y + h * 0.4, w * 0.1, x + w * 0.5, y + h * 0.5, w * 0.8);
  bg.addColorStop(0, P.bg0);
  bg.addColorStop(1, P.bg1);
  g.fillStyle = bg;
  g.fillRect(x, y, w, h);
  const k = kind % 8;
  const s = Math.min(w, h);
  if (k === 0 || k === 5) {
    bust(g, r, x + w / 2, y + h * 0.42, s * 0.16, { cloth: P.cloth(), hair: P.hair, skin: P.skin, female: k === 5, old: r() < 0.3 });
  } else if (k === 1) {
    // 结婚照：新娘白纱，新郎西装
    bust(g, r, x + w * 0.36, y + h * 0.45, s * 0.13, { cloth: '#f2f0ea', hair: P.hair, skin: P.skin, female: true, veil: true });
    bust(g, r, x + w * 0.64, y + h * 0.42, s * 0.13, { cloth: '#1c1c22', hair: P.hair, skin: P.skin });
    g.fillStyle = 'rgba(200,40,50,0.8)';
    g.beginPath();
    g.arc(x + w * 0.58, y + h * 0.66, s * 0.035, 0, Math.PI * 2);
    g.fill();
  } else if (k === 2) {
    // 全家福：后排两个大人，前排两个孩子
    bust(g, r, x + w * 0.33, y + h * 0.36, s * 0.1, { cloth: P.cloth(), hair: P.hair, skin: P.skin });
    bust(g, r, x + w * 0.67, y + h * 0.36, s * 0.1, { cloth: P.cloth(), hair: P.hair, skin: P.skin, female: true });
    bust(g, r, x + w * 0.4, y + h * 0.62, s * 0.08, { cloth: P.cloth(), hair: P.hair, skin: P.skin });
    bust(g, r, x + w * 0.6, y + h * 0.64, s * 0.075, { cloth: P.cloth(), hair: P.hair, skin: P.skin, female: true });
  } else if (k === 3) {
    // 百日照：胖娃娃
    g.fillStyle = P.cloth();
    g.beginPath();
    g.ellipse(x + w / 2, y + h * 0.75, s * 0.3, s * 0.22, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = P.skin;
    g.beginPath();
    g.arc(x + w / 2, y + h * 0.45, s * 0.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = tone === 'tint' ? '#c83a3a' : '#555';
    g.beginPath();
    g.ellipse(x + w / 2, y + h * 0.3, s * 0.2, s * 0.1, 0, Math.PI, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(30,24,20,0.8)';
    g.fillRect(x + w * 0.44, y + h * 0.44, s * 0.03, s * 0.02);
    g.fillRect(x + w * 0.53, y + h * 0.44, s * 0.03, s * 0.02);
  } else if (k === 4) {
    bust(g, r, x + w / 2, y + h * 0.44, s * 0.15, { cloth: '#1a1a1a', hair: P.hair, skin: P.skin, cap: 'grad' });
  } else if (k === 6) {
    bust(g, r, x + w / 2, y + h * 0.44, s * 0.15, { cloth: '#4c5a36', hair: P.hair, skin: P.skin, cap: 'army' });
  } else {
    // 风景：远山、湖、柳枝
    g.fillStyle = shade(P.bg1, 1.3);
    g.beginPath();
    g.moveTo(x, y + h * 0.6);
    for (let i = 0; i <= 8; i++) g.lineTo(x + (w * i) / 8, y + h * (0.45 + 0.1 * Math.sin(i * 1.7 + seed)));
    g.lineTo(x + w, y + h);
    g.lineTo(x, y + h);
    g.fill();
    g.fillStyle = shade(P.bg0, 1.15);
    g.fillRect(x, y + h * 0.7, w, h * 0.3);
  }
  // 银盐颗粒与划痕
  g.globalAlpha = 0.12;
  for (let i = 0; i < 40; i++) {
    g.fillStyle = r() < 0.5 ? '#fff' : '#000';
    g.fillRect(x + r() * w, y + r() * h, 1, range(r, 1, 6));
  }
  g.globalAlpha = 1;
  if (r() < 0.4) waterStain(g, r, x + r() * w, y + r() * h, s * 0.25);
  g.restore();
}

/** 老照片图集：4×4 格，每格一张（照片墙、样片橱窗、柜台玻璃下）。 */
export const photoAtlas: Paint = (g, w, h) => {
  g.fillStyle = '#2a2622';
  g.fillRect(0, 0, w, h);
  const c = w / 4;
  for (let i = 0; i < 16; i++) {
    const cx = (i % 4) * c, cy = Math.floor(i / 4) * c;
    drawPortrait(g, cx + 2, cy + 2, c - 4, c - 4, i, 7 + i);
  }
};
/** 图集第 i 格（0–15）的 UV 矩形 [u0, v0, u1, v1]（v 向上）。 */
export function atlasUv(i: number): [number, number, number, number] {
  const col = i % 4, row = Math.floor(i / 4);
  return [col / 4, 1 - (row + 1) / 4, (col + 1) / 4, 1 - row / 4];
}

/** 样片橱窗的展板：暗红丝绒，顶上一排藏着的暖光照下来（烘焙进贴图）。 */
export const displayBack: Paint = (g, w, h) => {
  g.fillStyle = '#2a0a0c';
  g.fillRect(0, 0, w, h);
  const r = rng(55);
  for (let x = 0; x < w; x += 3) {
    g.fillStyle = `rgba(0,0,0,${range(r, 0.05, 0.25)})`;
    g.fillRect(x, 0, 2, h);
  }
  const glow = g.createRadialGradient(w / 2, -h * 0.1, 4, w / 2, -h * 0.1, h * 1.05);
  glow.addColorStop(0, 'rgba(255,214,150,0.95)');
  glow.addColorStop(0.35, 'rgba(210,120,70,0.55)');
  glow.addColorStop(1, 'rgba(60,10,10,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  grain(g, w, h, 0.12, 55);
};

// ==================================================================== 取件格

/**
 * 取件格正面的编号层（透明底）：每格左下角一块乳白小铭牌，印两位编号。
 * hi = 2048 高清版（取景器 ≥2× 时换上，ARCH §6.8.1）；lo = 1024，字画得又小又糊，1× 下认不出（GDD P6）。
 */
export function gridNumbers(hi: boolean): Paint {
  return (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const n = 10, cw = w / n, ch = h / n;
    const r = rng(73);
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const x = col * cw, y = row * ch;
        const pw = cw * 0.36, ph = ch * 0.17;
        const px = x + cw * 0.08, py = y + ch * 0.76;
        g.fillStyle = shade('#e8dfc4', range(r, 0.82, 1.02));
        g.fillRect(px, py, pw, ph);
        g.strokeStyle = 'rgba(80,60,30,0.6)';
        g.lineWidth = Math.max(1, cw * 0.01);
        g.strokeRect(px, py, pw, ph);
        const label = `${row}${col}`;
        g.fillStyle = '#1a1510';
        if (hi) {
          g.font = `bold ${Math.round(ph * 0.82)}px ${FONT_STACK}`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(label, px + pw / 2, py + ph * 0.54);
        } else {
          // 低清：两团糊掉的小墨点，认不出是几
          g.globalAlpha = 0.55;
          g.filter = 'blur(1.4px)';
          g.fillRect(px + pw * 0.22, py + ph * 0.3, pw * 0.18, ph * 0.45);
          g.fillRect(px + pw * 0.58, py + ph * 0.3, pw * 0.18, ph * 0.45);
          g.filter = 'none';
          g.globalAlpha = 1;
        }
        // 格口的磨痕、指印
        if (r() < 0.25) blotch(g, r, x + r() * cw, y + ch * 0.1 + r() * ch * 0.4, cw * 0.1, 'rgba(0,0,0,0.25)', 0.3, 3);
      }
    }
  };
}

/** 取件格内壁（深色木头，格子深处发黑）。 */
export const cubbyBack: Paint = (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, '#1d1611');
  grd.addColorStop(1, '#120d09');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  grain(g, w, h, 0.2, 5);
};

// ==================================================================== 背景布（影棚北墙 4 卷）

export const backdrops: Paint = (g, w, h) => {
  const sw = w / 4;
  const r = rng(19);
  // 1 灰色斑驳（证件照）
  const g1 = g.createRadialGradient(sw * 0.5, h * 0.45, 10, sw * 0.5, h * 0.5, sw);
  g1.addColorStop(0, '#9a9a96');
  g1.addColorStop(1, '#4a4a48');
  g.fillStyle = g1;
  g.fillRect(0, 0, sw, h);
  for (let i = 0; i < 60; i++) blotch(g, r, r() * sw, r() * h, range(r, 10, 40), 'rgba(40,40,40,0.2)', 0.2, 4);
  // 2 天蓝渐变 + 白云（学生照）
  const g2 = g.createLinearGradient(0, 0, 0, h);
  g2.addColorStop(0, '#3e6fa8');
  g2.addColorStop(1, '#a9c6e0');
  g.fillStyle = g2;
  g.fillRect(sw, 0, sw, h);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 7; i++) {
    const cx = sw + range(r, 0.1, 0.9) * sw, cy = range(r, 0.1, 0.5) * h;
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      g.ellipse(cx + range(r, -30, 30), cy + range(r, -8, 8), range(r, 20, 45), range(r, 10, 20), 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // 3 画出来的山水（亭子、湖、远山）——结婚照的老布景
  const x3 = sw * 2;
  const g3 = g.createLinearGradient(0, 0, 0, h);
  g3.addColorStop(0, '#d7c9a8');
  g3.addColorStop(0.55, '#b9c7b4');
  g3.addColorStop(1, '#6f8a74');
  g.fillStyle = g3;
  g.fillRect(x3, 0, sw, h);
  g.fillStyle = 'rgba(70,95,85,0.8)';
  g.beginPath();
  g.moveTo(x3, h * 0.55);
  for (let i = 0; i <= 10; i++) g.lineTo(x3 + (sw * i) / 10, h * (0.38 + 0.12 * Math.sin(i * 1.3) + (i % 3) * 0.03));
  g.lineTo(x3 + sw, h * 0.6);
  g.lineTo(x3, h * 0.6);
  g.fill();
  g.fillStyle = 'rgba(150,175,185,0.9)';
  g.fillRect(x3, h * 0.6, sw, h * 0.18);
  g.fillStyle = '#7a3a2a';
  g.fillRect(x3 + sw * 0.62, h * 0.5, sw * 0.02, h * 0.12);
  g.fillRect(x3 + sw * 0.74, h * 0.5, sw * 0.02, h * 0.12);
  g.beginPath();
  g.moveTo(x3 + sw * 0.58, h * 0.51);
  g.lineTo(x3 + sw * 0.69, h * 0.44);
  g.lineTo(x3 + sw * 0.8, h * 0.51);
  g.fill();
  g.strokeStyle = 'rgba(50,80,40,0.7)';
  g.lineWidth = 2;
  for (let i = 0; i < 16; i++) {
    g.beginPath();
    const sx = x3 + sw * 0.08 + i * 3;
    g.moveTo(sx, 0);
    g.quadraticCurveTo(sx + 12, h * 0.3, sx + range(r, -6, 10), h * range(r, 0.35, 0.5));
    g.stroke();
  }
  // 4 暗红丝绒（喜庆、寿星照）
  const g4 = g.createLinearGradient(sw * 3, 0, sw * 4, 0);
  g4.addColorStop(0, '#5a1414');
  g4.addColorStop(0.5, '#8a2222');
  g4.addColorStop(1, '#4a1010');
  g.fillStyle = g4;
  g.fillRect(sw * 3, 0, sw, h);
  for (let x = sw * 3; x < w; x += 9) {
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(x, 0, 3, h);
  }
  // 布卷上的折痕与底边的灰
  for (let i = 0; i < 4; i++) {
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(i * sw, 0, 4, h);
    const dust = g.createLinearGradient(0, h * 0.85, 0, h);
    dust.addColorStop(0, 'rgba(0,0,0,0)');
    dust.addColorStop(1, 'rgba(40,30,20,0.35)');
    g.fillStyle = dust;
    g.fillRect(i * sw, h * 0.85, sw, h * 0.15);
  }
};

// ==================================================================== 底片（120 胶卷，12 格，前 4 格有画面）

/** 第 k 格（1–4）的画面（正片），画在 (x,y,s,s)。 */
function filmScene(g: CanvasRenderingContext2D, k: number, x: number, y: number, s: number): void {
  const r = rng(300 + k);
  g.save();
  g.beginPath();
  g.rect(x, y, s, s);
  g.clip();
  // 门岗的门楣与墙
  const dark = '#2a2a2a';
  const wall = '#7c7c78';
  const cam = (cx: number, cy: number, hat: boolean) => {
    // 摄像头：白壳 + 镜头；hat = 铁皮帽子
    g.fillStyle = '#e6e4de';
    g.fillRect(cx - s * 0.1, cy - s * 0.05, s * 0.2, s * 0.1);
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(cx - s * 0.1, cy + s * 0.01, s * 0.035, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#9a9a9a';
    g.fillRect(cx + s * 0.04, cy + s * 0.05, s * 0.03, s * 0.08);
    if (hat) {
      g.fillStyle = '#bdbdb4';
      g.beginPath();
      g.moveTo(cx - s * 0.18, cy - s * 0.06);
      g.lineTo(cx + s * 0.13, cy - s * 0.1);
      g.lineTo(cx + s * 0.12, cy - s * 0.06);
      g.lineTo(cx - s * 0.16, cy - s * 0.03);
      g.closePath();
      g.fill();
      g.strokeStyle = '#555';
      g.lineWidth = 1;
      g.stroke();
    }
  };
  const man = (mx: number, my: number, scale: number, pose: 'back_raise' | 'sweep' | 'ladder') => {
    // 藏蓝衬衫的老周，背影（没有脸）
    g.fillStyle = '#3a3f4a';
    g.fillRect(mx - s * 0.06 * scale, my, s * 0.12 * scale, s * 0.2 * scale);
    g.fillStyle = '#2a2a2e';
    g.fillRect(mx - s * 0.05 * scale, my + s * 0.2 * scale, s * 0.04 * scale, s * 0.18 * scale);
    g.fillRect(mx + s * 0.01 * scale, my + s * 0.2 * scale, s * 0.04 * scale, s * 0.18 * scale);
    g.fillStyle = '#26262a';
    g.beginPath();
    g.arc(mx, my - s * 0.04 * scale, s * 0.045 * scale, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3a4a6a';
    g.fillRect(mx - s * 0.05 * scale, my - s * 0.09 * scale, s * 0.1 * scale, s * 0.03 * scale);
    g.strokeStyle = '#3a3f4a';
    g.lineWidth = s * 0.025 * scale;
    g.beginPath();
    g.moveTo(mx + s * 0.05 * scale, my + s * 0.02 * scale);
    if (pose === 'back_raise') g.lineTo(mx + s * 0.1 * scale, my - s * 0.12 * scale);
    else if (pose === 'sweep') g.lineTo(mx + s * 0.14 * scale, my - s * 0.08 * scale);
    else g.lineTo(mx + s * 0.11 * scale, my - s * 0.14 * scale);
    g.stroke();
  };
  if (k === 1) {
    // 雪夜：老周背对镜头，举起暖壶盖朝门楣上的摄像头敬了一下
    g.fillStyle = '#1c1f26';
    g.fillRect(x, y, s, s);
    g.fillStyle = wall;
    g.fillRect(x, y + s * 0.62, s, s * 0.38);
    g.fillStyle = '#eee';
    for (let i = 0; i < 70; i++) g.fillRect(x + r() * s, y + r() * s, 2, 2);
    g.fillStyle = '#e8e8e8';
    g.fillRect(x, y + s * 0.9, s, s * 0.1);
    man(x + s * 0.5, y + s * 0.55, 1.4, 'back_raise');
    g.fillStyle = '#b8b0a0';
    g.fillRect(x + s * 0.63, y + s * 0.34, s * 0.05, s * 0.04);
  } else if (k === 2) {
    // 老周踩着凳子，用笤帚扫摄像头上的雪
    g.fillStyle = '#5a5e64';
    g.fillRect(x, y, s, s);
    g.fillStyle = dark;
    g.fillRect(x, y, s, s * 0.14);
    cam(x + s * 0.7, y + s * 0.22, false);
    g.fillStyle = '#f2f2f2';
    g.fillRect(x + s * 0.6, y + s * 0.15, s * 0.22, s * 0.03);
    man(x + s * 0.42, y + s * 0.42, 1.2, 'sweep');
    g.strokeStyle = '#c8b27a';
    g.lineWidth = s * 0.015;
    g.beginPath();
    g.moveTo(x + s * 0.5, y + s * 0.4);
    g.lineTo(x + s * 0.62, y + s * 0.2);
    g.stroke();
    g.fillStyle = '#6a4a2a';
    g.fillRect(x + s * 0.32, y + s * 0.87, s * 0.2, s * 0.04);
  } else if (k === 3) {
    // 2023-08-13：老周站在梯子上，给摄像头扣上一片罐头铁皮剪的帽子（正解）
    g.fillStyle = '#8e8e88';
    g.fillRect(x, y, s, s);
    g.fillStyle = '#b8b8b0';
    g.fillRect(x, y + s * 0.68, s, s * 0.32);
    g.fillStyle = dark;
    g.fillRect(x, y, s, s * 0.12);
    cam(x + s * 0.66, y + s * 0.2, true);
    // 梯子
    g.strokeStyle = '#6a5030';
    g.lineWidth = s * 0.02;
    g.beginPath();
    g.moveTo(x + s * 0.3, y + s);
    g.lineTo(x + s * 0.44, y + s * 0.4);
    g.moveTo(x + s * 0.45, y + s);
    g.lineTo(x + s * 0.56, y + s * 0.4);
    g.stroke();
    for (let i = 0; i < 5; i++) {
      const t = i / 5;
      g.beginPath();
      g.moveTo(x + s * (0.31 + t * 0.13), y + s * (0.97 - t * 0.55));
      g.lineTo(x + s * (0.46 + t * 0.1), y + s * (0.97 - t * 0.55));
      g.stroke();
    }
    man(x + s * 0.47, y + s * 0.36, 1.1, 'ladder');
    // 手里那片帽子的反光
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillRect(x + s * 0.56, y + s * 0.13, s * 0.08, s * 0.012);
    g.fillStyle = '#2a2a2a';
    g.font = `${Math.round(s * 0.07)}px ${FONT_STACK}`;
    g.textAlign = 'right';
    g.fillText('23.8.13', x + s * 0.96, y + s * 0.95);
  } else if (k === 4) {
    // 2024：门卫室里一把空椅子，椅子上一团说不清的白
    g.fillStyle = '#3a3a38';
    g.fillRect(x, y, s, s);
    g.fillStyle = '#58564f';
    g.fillRect(x, y + s * 0.65, s, s * 0.35);
    g.fillStyle = '#6a4a2e';
    g.fillRect(x + s * 0.36, y + s * 0.55, s * 0.28, s * 0.05);
    g.fillRect(x + s * 0.38, y + s * 0.3, s * 0.04, s * 0.5);
    g.fillRect(x + s * 0.58, y + s * 0.6, s * 0.04, s * 0.22);
    g.fillRect(x + s * 0.38, y + s * 0.6, s * 0.04, s * 0.22);
    const wh = g.createRadialGradient(x + s * 0.5, y + s * 0.45, 2, x + s * 0.5, y + s * 0.45, s * 0.2);
    wh.addColorStop(0, 'rgba(255,255,255,0.85)');
    wh.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = wh;
    g.fillRect(x, y, s, s);
    g.fillStyle = '#1a1a1a';
    g.font = `${Math.round(s * 0.07)}px ${FONT_STACK}`;
    g.textAlign = 'right';
    g.fillText('2024', x + s * 0.96, y + s * 0.95);
  }
  g.restore();
}

/**
 * 底片条（竖着挂）：顶部片头 leader、12 格（前 4 格有画面）。positive = 伙计的眼睛看到的正片（取景器里）；
 * 否则是负片（颜色反转、橙色片基）。布局：宽 w；片头高 = leaderFrac × h；每格高 cellFrac × h（含格间隔）。
 */
export const FILM_LAYOUT = { leaderFrac: 0.035 / 1.115, cellFrac: 0.09 / 1.115, frameFrac: 0.078 / 1.115 } as const;
export function filmStrip(positive: boolean): Paint {
  return (g, w, h) => {
    const leader = FILM_LAYOUT.leaderFrac * h, cell = FILM_LAYOUT.cellFrac * h, frame = FILM_LAYOUT.frameFrac * h;
    // 先画正片，再按需要反转
    g.fillStyle = '#0a0a0a';
    g.fillRect(0, 0, w, h);
    const side = (w - frame) / 2;
    for (let i = 0; i < 12; i++) {
      const y = leader + i * cell;
      if (i < 4) filmScene(g, i + 1, side, y, frame);
      else {
        // 空格：没曝光（正片是黑的）
        g.fillStyle = '#060606';
        g.fillRect(side, y, frame, frame);
      }
      // 格号（片边小字）
      g.fillStyle = '#c8c0a8';
      g.font = `${Math.round(side * 0.55)}px ${FONT_STACK}`;
      g.save();
      g.translate(side * 0.55, y + frame * 0.5);
      g.rotate(-Math.PI / 2);
      g.textAlign = 'center';
      g.fillText(String(i + 1), 0, 0);
      g.restore();
    }
    if (!positive) {
      const img = g.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        // 反转 + 橙色片基（C-41 负片的样子，黑白片也用它：老照相馆用彩卷）
        const R0 = 255 - (d[i] ?? 0), G0 = 255 - (d[i + 1] ?? 0), B0 = 255 - (d[i + 2] ?? 0);
        d[i] = Math.min(255, R0 * 0.75 + 60);
        d[i + 1] = Math.min(255, G0 * 0.45 + 28);
        d[i + 2] = Math.min(255, B0 * 0.25 + 8);
      }
      g.putImageData(img, 0, 0);
    }
  };
}

// ==================================================================== 暗房守则（陆长明手书，贴在门背后）

/** 不能出现在行首的标点（句读、后括号、后引号、省略号、破折号）。 */
const NO_LINE_START = new Set([...'，。、；：？！）」』”’》…—']);
/** 不能留在行末的标点（前括号、前引号）。 */
const NO_LINE_END = new Set([...'（「『“‘《']);

/**
 * 按固定字数折行，带避头尾（M4 第 2 轮：按 15 字硬切时“……就瞎了。”的句号独占一行）：
 * 下一行要以句读/后括号开头时，把这些字并到本行末尾（本行可以比 n 多出一两个字）；本行以前括号/前引号结尾时，把它挪到下一行。
 */
export function wrapKinsoku(text: string, n: number): string[] {
  const chars = [...text];
  const out: string[] = [];
  let i = 0;
  while (i < chars.length) {
    let end = Math.min(i + n, chars.length);
    while (end < chars.length && NO_LINE_START.has(chars[end]!)) end++;
    while (end - i > 1 && end < chars.length && NO_LINE_END.has(chars[end - 1]!)) end--;
    out.push(chars.slice(i, end).join(''));
    i = end;
  }
  return out;
}

export function rulesSheet(hi: boolean): Paint {
  return (g, w, h) => {
    const r = rng(1990);
    g.fillStyle = '#e9e1cc';
    g.fillRect(0, 0, w, h * 0.78);
    agePaper(g, w, h * 0.78, 0.5, 11, 2);
    // 四角图钉
    g.fillStyle = '#b02a22';
    for (const [x, y] of [[0.05, 0.03], [0.95, 0.03], [0.05, 0.75], [0.95, 0.75]] as const) {
      g.beginPath();
      g.arc(w * x, h * y, w * 0.018, 0, Math.PI * 2);
      g.fill();
    }
    const ink = '#1d2340';
    const size = w * 0.058;
    g.textBaseline = 'middle';
    drawHandLine(g, r, TEXT.rulesTitle, w * 0.33, h * 0.07, size * 1.25, ink, { pressure: 1 });
    g.font = `${Math.round(size)}px ${HAND_FONT_STACK}`;
    // 手写折行：每行约 15 字（避头尾，见 wrapKinsoku）；条与条之间空小半行
    let y = h * 0.15;
    for (const t of TEXT.rulesLines) {
      for (const ln of wrapKinsoku(t, 15)) {
        drawHandLine(g, r, ln, w * 0.05, y, size, ink, { smear: 0.2 });
        y += h * 0.052;
      }
      y += h * 0.022;
    }
    // 另一张纸条（字更抖）
    g.save();
    g.translate(w * 0.08, h * 0.8);
    g.rotate(-0.03);
    g.fillStyle = '#f2eedb';
    g.fillRect(0, 0, w * 0.84, h * 0.19);
    g.fillStyle = 'rgba(210,200,160,0.7)';
    g.fillRect(w * 0.34, -h * 0.012, w * 0.16, h * 0.03);
    const noteLines = wrapKinsoku(TEXT.rulesNote, 17);
    noteLines.forEach((ln, i) => drawHandLine(g, r, ln, w * 0.03, h * (0.035 + i * 0.04), size * 0.78, '#2a2030', { pressure: 0.85, smear: 0.35 }));
    g.restore();
    if (!hi) {
      g.filter = 'blur(0.6px)';
      g.drawImage(g.canvas, 0, 0);
      g.filter = 'none';
    }
  };
}

// ==================================================================== 价目表、取件牌、日历

export const priceBoard: Paint = (g, w, h) => {
  g.fillStyle = '#1e2a22';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#8a7a50';
  g.lineWidth = w * 0.02;
  g.strokeRect(w * 0.02, h * 0.02, w * 0.96, h * 0.96);
  g.fillStyle = '#f0e6c8';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lines = TEXT.sign.price;
  g.font = `bold ${Math.round(h * 0.1)}px ${SERIF_FONT_STACK}`;
  g.fillText(lines[0] ?? '', w / 2, h * 0.1);
  g.font = `${Math.round(h * 0.066)}px ${FONT_STACK}`;
  lines.slice(1).forEach((t, i) => g.fillText(t, w / 2, h * (0.24 + i * 0.12)));
  g.fillStyle = 'rgba(240,230,200,0.5)';
  g.font = `${Math.round(h * 0.05)}px ${FONT_STACK}`;
  g.fillText(TEXT.sign.studioSince, w / 2, h * 0.93);
  grain(g, w, h, 0.15, 3);
};

/** 取件格顶上的灯箱：米白灯箱片，红字“取件处”，右边一行小字（按单号尾数自取）。emissiveMap 用同一张图。 */
export const pickupHeader: Paint = (g, w, h) => {
  const bg = g.createLinearGradient(0, 0, w, 0);
  bg.addColorStop(0, '#e9e1cc');
  bg.addColorStop(0.5, '#f6f1e4');
  bg.addColorStop(1, '#e6dcc4');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  // 灯箱片边上积的灰、灯管位置的亮带
  g.fillStyle = 'rgba(120,100,70,0.18)';
  g.fillRect(0, 0, w, h * 0.08);
  g.fillRect(0, h * 0.92, w, h * 0.08);
  g.fillStyle = '#b3202a';
  g.font = `bold ${Math.round(h * 0.7)}px ${FONT_STACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const title = [...TEXT.sign.pickupTitle];
  title.forEach((c, i) => g.fillText(c, w * (0.12 + i * 0.1), h * 0.54));
  g.fillStyle = '#1e3a6a';
  g.font = `${Math.round(h * 0.4)}px ${FONT_STACK}`;
  g.fillText(TEXT.sign.pickupNote, w * 0.7, h * 0.55);
  // 一只飞进去出不来的小虫的影子
  g.fillStyle = 'rgba(40,30,20,0.55)';
  g.fillRect(w * 0.905, h * 0.3, 7, 3);
};

export const ringBellSign: Paint = (g, w, h) => {
  g.fillStyle = '#efe7d0';
  roundRect(g, 2, 2, w - 4, h - 4, 10);
  g.fill();
  g.strokeStyle = '#7a2a22';
  g.lineWidth = 6;
  g.stroke();
  g.fillStyle = '#7a2a22';
  g.font = `bold ${Math.round(h * 0.42)}px ${FONT_STACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(TEXT.sign.ringBell, w / 2, h * 0.53);
};

/** 日历：停在 2025 年 3 月（陆师傅走的那个春天）。 */
export const calendar: Paint = (g, w, h) => {
  g.fillStyle = '#f3efe4';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#b3202a';
  g.fillRect(0, 0, w, h * 0.22);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(h * 0.12)}px ${FONT_STACK}`;
  g.fillText('2025', w / 2, h * 0.11);
  g.fillStyle = '#b3202a';
  g.font = `bold ${Math.round(h * 0.22)}px ${SERIF_FONT_STACK}`;
  g.fillText('三月', w / 2, h * 0.38);
  g.fillStyle = '#222';
  g.font = `${Math.round(h * 0.06)}px ${FONT_STACK}`;
  for (let d = 0; d < 31; d++) {
    const cx = w * (0.1 + (d % 7) * 0.133), cy = h * (0.58 + Math.floor(d / 7) * 0.08);
    g.fillText(String(d + 1), cx, cy);
  }
  agePaper(g, w, h, 0.4, 25, 1);
};

// ==================================================================== 街面：卷帘门、粉笔字、站牌、路牌

export const shutter: Paint = (g, w, h) => {
  g.fillStyle = '#6e7174';
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 8) {
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(0, y, w, 2);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(0, y + 5, w, 3);
  }
  const r = rng(88);
  for (let i = 0; i < 24; i++) blotch(g, r, r() * w, range(r, 0.3, 1) * h, range(r, 6, 24), '#6b3a1a', 0.35, 4);
  // 底部锁扣
  g.fillStyle = '#2a2a2a';
  g.fillRect(w * 0.44, h * 0.9, w * 0.12, h * 0.05);
  const dirt = g.createLinearGradient(0, h * 0.75, 0, h);
  dirt.addColorStop(0, 'rgba(0,0,0,0)');
  dirt.addColorStop(1, 'rgba(20,15,10,0.45)');
  g.fillStyle = dirt;
  g.fillRect(0, h * 0.75, w, h * 0.25);
};

/** 早点铺门上粉笔“转让”（透明底贴花）。 */
export const chalkZhuanrang: Paint = (g, w, h) => {
  g.clearRect(0, 0, w, h);
  const r = rng(505);
  g.fillStyle = 'rgba(240,240,236,0.92)';
  g.textBaseline = 'middle';
  drawHandLine(g, r, TEXT.sign.zhuanrang, w * 0.12, h * 0.36, h * 0.42, 'rgba(240,240,236,0.92)', { pressure: 0.9 });
  drawHandLine(g, r, TEXT.sign.zhuanrangPhone, w * 0.14, h * 0.78, h * 0.15, 'rgba(235,235,230,0.85)', { pressure: 0.8 });
  // 粉笔的颗粒：随机擦掉一些
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(0,0,0,${range(r, 0.2, 0.8)})`;
    g.fillRect(r() * w, r() * h, 2, 2);
  }
  g.globalCompositeOperation = 'source-over';
};

export const busTimetable: Paint = (g, w, h) => {
  g.fillStyle = '#f2efe6';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#2E5A8A';
  g.fillRect(0, 0, w, h * 0.24);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(h * 0.15)}px ${FONT_STACK}`;
  g.fillText(TEXT.sign.busStop, w / 2, h * 0.12);
  g.fillStyle = '#1a1a1a';
  const [route, stops, times] = TEXT.sign.busRoute;
  g.font = `bold ${Math.round(h * 0.12)}px ${FONT_STACK}`;
  g.fillText(route ?? '', w / 2, h * 0.36);
  g.font = `${Math.round(h * 0.068)}px ${FONT_STACK}`;
  g.fillText(stops ?? '', w / 2, h * 0.52);
  g.fillText(times ?? '', w / 2, h * 0.64);
  g.fillStyle = '#b3202a';
  g.font = `bold ${Math.round(h * 0.13)}px ${FONT_STACK}`;
  g.fillText(TEXT.sign.busLast, w / 2, h * 0.84);
  agePaper(g, w, h, 0.3, 9, 1);
};

export const streetPlaque: Paint = (g, w, h) => {
  g.fillStyle = '#1f4d8c';
  roundRect(g, 0, 0, w, h, 12);
  g.fill();
  g.strokeStyle = '#e8ecf2';
  g.lineWidth = 5;
  roundRect(g, 8, 8, w - 16, h - 16, 8);
  g.stroke();
  g.fillStyle = '#f2f4f8';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(h * 0.5)}px ${FONT_STACK}`;
  g.fillText(TEXT.sign.street, w / 2, h * 0.52);
};

/** 手绘的招牌字（木板底），bg/ink 可换。 */
export function paintedSign(text: string, sub: string | null, o: { bg: string; ink: string; subInk?: string; serif?: boolean; seed: number }): Paint {
  return (g, w, h) => {
    g.fillStyle = o.bg;
    g.fillRect(0, 0, w, h);
    const r = rng(o.seed);
    for (let i = 0; i < 30; i++) blotch(g, r, r() * w, r() * h, range(r, 8, 30), 'rgba(0,0,0,0.18)', 0.2, 4);
    g.fillStyle = o.ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const family = o.serif ? SERIF_FONT_STACK : FONT_STACK;
    const main = sub ? h * 0.52 : h * 0.66;
    g.font = `bold ${Math.round(main)}px ${family}`;
    const mw = g.measureText(text).width;
    const scale = Math.min(1, (w * 0.9) / mw);
    g.save();
    g.translate(w / 2, sub ? h * 0.38 : h * 0.52);
    g.scale(scale, 1);
    g.fillText(text, 0, 0);
    g.restore();
    if (sub) {
      g.fillStyle = o.subInk ?? o.ink;
      g.font = `${Math.round(h * 0.2)}px ${FONT_STACK}`;
      g.fillText(sub, w / 2, h * 0.82);
    }
    // 雨水冲出的竖道子
    for (let i = 0; i < 18; i++) {
      g.fillStyle = 'rgba(0,0,0,0.1)';
      g.fillRect(r() * w, r() * h * 0.3, range(r, 1, 3), h * range(r, 0.3, 0.9));
    }
    grain(g, w, h, 0.18, o.seed);
  };
}

/** 电表箱面板。 */
export const meterBox: Paint = (g, w, h) => {
  g.fillStyle = '#8a9096';
  g.fillRect(0, 0, w, h);
  const r = rng(61);
  for (let i = 0; i < 3; i++) {
    g.fillStyle = '#1c2024';
    g.fillRect(w * (0.1 + i * 0.3), h * 0.25, w * 0.22, h * 0.25);
    g.fillStyle = '#d8d8c8';
    g.fillRect(w * (0.12 + i * 0.3), h * 0.3, w * 0.18, h * 0.08);
  }
  g.fillStyle = '#b3202a';
  g.font = `bold ${Math.round(h * 0.12)}px ${FONT_STACK}`;
  g.textAlign = 'center';
  g.fillText(TEXT.sign.meter, w / 2, h * 0.75);
  for (let i = 0; i < 16; i++) blotch(g, r, r() * w, r() * h, range(r, 4, 14), '#6b3a1a', 0.4, 3);
};

// ==================================================================== 纸扎店橱窗（烘焙光照：一只红灯泡从上方照下来）

/** 橱窗后墙 + 纸人纸马的剪影（透明底上画纸扎，红灯泡的光已经“画”进去）。 */
export const paperWindow: Paint = (g, w, h) => {
  // 后墙：红灯泡在上方正中，往外一圈圈暗下去
  const bulb = { x: w * 0.5, y: h * 0.08 };
  const glow = g.createRadialGradient(bulb.x, bulb.y, 4, bulb.x, bulb.y, w * 0.8);
  glow.addColorStop(0, '#ff6a5a');
  glow.addColorStop(0.15, '#c02a24');
  glow.addColorStop(0.5, '#4a0c0c');
  glow.addColorStop(1, '#140404');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  const r = rng(404);
  const lit = (x: number, y: number) => Math.max(0.25, 1 - Math.hypot(x - bulb.x, y - bulb.y) / (w * 0.9));
  // 纸马（左）：扎出来的马，白纸糊、红绿装饰
  const horse = (hx: number, hy: number, s: number) => {
    const k = lit(hx, hy);
    g.fillStyle = `rgb(${Math.round(250 * k)},${Math.round(150 * k)},${Math.round(140 * k)})`;
    g.fillRect(hx - s * 0.5, hy - s * 0.2, s, s * 0.35);
    g.fillRect(hx + s * 0.35, hy - s * 0.55, s * 0.18, s * 0.45);
    g.fillRect(hx + s * 0.35, hy - s * 0.6, s * 0.35, s * 0.15);
    for (const lx of [-0.42, -0.2, 0.2, 0.38]) g.fillRect(hx + s * lx, hy + s * 0.15, s * 0.07, s * 0.45);
    g.fillStyle = `rgb(${Math.round(200 * k)},${Math.round(40 * k)},${Math.round(40 * k)})`;
    g.fillRect(hx - s * 0.3, hy - s * 0.22, s * 0.6, s * 0.08);
    g.fillStyle = `rgb(${Math.round(60 * k)},${Math.round(120 * k)},${Math.round(70 * k)})`;
    g.fillRect(hx - s * 0.05, hy - s * 0.1, s * 0.3, s * 0.1);
    g.fillStyle = '#100';
    g.fillRect(hx + s * 0.58, hy - s * 0.56, s * 0.04, s * 0.04);
  };
  // 纸人（童男童女）：纸衣、两团腮红、点了睛
  const figure = (fx: number, fy: number, s: number, girl: boolean) => {
    const k = lit(fx, fy);
    const c = (rr: number, gg: number, bb: number) => `rgb(${Math.round(rr * k)},${Math.round(gg * k)},${Math.round(bb * k)})`;
    g.fillStyle = girl ? c(230, 90, 110) : c(90, 170, 110);
    g.beginPath();
    g.moveTo(fx - s * 0.3, fy + s);
    g.lineTo(fx - s * 0.18, fy + s * 0.2);
    g.lineTo(fx + s * 0.18, fy + s * 0.2);
    g.lineTo(fx + s * 0.3, fy + s);
    g.closePath();
    g.fill();
    g.fillStyle = c(250, 225, 210);
    g.beginPath();
    g.arc(fx, fy, s * 0.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c(30, 20, 20);
    g.fillRect(fx - s * 0.2, fy - s * 0.22, s * 0.4, s * 0.1);
    g.fillStyle = c(240, 60, 70);
    g.beginPath();
    g.arc(fx - s * 0.09, fy + s * 0.06, s * 0.05, 0, Math.PI * 2);
    g.arc(fx + s * 0.09, fy + s * 0.06, s * 0.05, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0a0000';
    g.fillRect(fx - s * 0.08, fy - s * 0.03, s * 0.03, s * 0.03);
    g.fillRect(fx + s * 0.05, fy - s * 0.03, s * 0.03, s * 0.03);
  };
  horse(w * 0.3, h * 0.66, w * 0.3);
  figure(w * 0.62, h * 0.45, h * 0.3, false);
  figure(w * 0.8, h * 0.47, h * 0.29, true);
  // 花圈一角、金元宝
  g.strokeStyle = `rgba(${Math.round(200 * lit(w * 0.1, h * 0.3))},40,40,0.9)`;
  g.lineWidth = w * 0.03;
  g.beginPath();
  g.arc(w * 0.08, h * 0.35, w * 0.12, -1, 1.4);
  g.stroke();
  for (let i = 0; i < 6; i++) {
    const x = w * range(r, 0.45, 0.95), y = h * range(r, 0.85, 0.95);
    g.fillStyle = `rgb(${Math.round(230 * lit(x, y))},${Math.round(150 * lit(x, y))},40)`;
    g.beginPath();
    g.ellipse(x, y, w * 0.025, h * 0.015, 0, 0, Math.PI * 2);
    g.fill();
  }
  // 红灯泡本身（烧白的芯由另一个 emissive 小球负责）
  grain(g, w, h, 0.1, 404);
};

// ==================================================================== 本相与捂脸照（相册缩略图画法，photoArt）

/** ph.covered_face：两张一寸黑白照，照片里的人两只手捂着脸。 */
export function artCoveredFace(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = '#c9b89a';
  g.fillRect(0, 0, w, h);
  const r = rng(2004);
  for (let k = 0; k < 2; k++) {
    const pw = w * 0.36, ph = h * 0.66;
    const x = w * (0.1 + k * 0.44), y = h * 0.16 + (k ? 6 : 0);
    g.save();
    g.translate(x + pw / 2, y + ph / 2);
    g.rotate(k ? 0.05 : -0.04);
    g.fillStyle = '#efece4';
    g.fillRect(-pw / 2, -ph / 2, pw, ph);
    const ix = -pw / 2 + pw * 0.08, iy = -ph / 2 + ph * 0.07, iw = pw * 0.84, ih = ph * 0.86;
    const bg = g.createLinearGradient(0, iy, 0, iy + ih);
    bg.addColorStop(0, '#9a9a98');
    bg.addColorStop(1, '#5a5a58');
    g.fillStyle = bg;
    g.fillRect(ix, iy, iw, ih);
    // 肩膀（衬衫）
    g.fillStyle = '#2e2e30';
    g.fillRect(ix + iw * 0.12, iy + ih * 0.66, iw * 0.76, ih * 0.34);
    g.fillStyle = '#d8d6d0';
    g.beginPath();
    g.moveTo(ix + iw * 0.4, iy + ih * 0.66);
    g.lineTo(ix + iw * 0.5, iy + ih * 0.78);
    g.lineTo(ix + iw * 0.6, iy + ih * 0.66);
    g.fill();
    // 头 + 两只手捂着脸
    g.fillStyle = '#1e1e1e';
    g.beginPath();
    g.ellipse(ix + iw / 2, iy + ih * 0.32, iw * 0.22, ih * 0.14, 0, Math.PI, Math.PI * 2);
    g.fill();
    g.fillStyle = '#b8b4ac';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(ix + iw * (0.5 + s * 0.09), iy + ih * 0.42, iw * 0.12, ih * 0.14, s * 0.2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(60,60,60,0.6)';
      g.lineWidth = 1;
      for (let f = 0; f < 3; f++) {
        g.beginPath();
        g.moveTo(ix + iw * (0.5 + s * (0.03 + f * 0.04)), iy + ih * 0.3);
        g.lineTo(ix + iw * (0.5 + s * (0.04 + f * 0.04)), iy + ih * 0.5);
        g.stroke();
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.1)';
    for (let i = 0; i < 20; i++) g.fillRect(ix + r() * iw, iy + r() * ih, 1, 4);
    g.restore();
  }
}

/** ph.true_form：本相——底片上是一台戴铁皮帽子的摄像头。 */
export function artTrueForm(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = '#efece4';
  g.fillRect(0, 0, w, h);
  const ix = w * 0.08, iy = h * 0.08, iw = w * 0.84, ih = h * 0.84;
  const bg = g.createRadialGradient(ix + iw / 2, iy + ih * 0.4, 5, ix + iw / 2, iy + ih / 2, iw * 0.7);
  bg.addColorStop(0, '#8a8a86');
  bg.addColorStop(1, '#2e2e2c');
  g.fillStyle = bg;
  g.fillRect(ix, iy, iw, ih);
  const cx = ix + iw * 0.5, cy = iy + ih * 0.5, s = ih;
  // 支架
  g.fillStyle = '#6a6a66';
  g.fillRect(cx - s * 0.03, cy + s * 0.12, s * 0.06, s * 0.36);
  // 摄像头外壳
  g.fillStyle = '#e8e6e0';
  g.fillRect(cx - s * 0.28, cy - s * 0.12, s * 0.5, s * 0.26);
  g.fillStyle = '#c8c6c0';
  g.fillRect(cx - s * 0.28, cy + s * 0.08, s * 0.5, s * 0.06);
  // 镜头
  g.fillStyle = '#141414';
  g.beginPath();
  g.arc(cx - s * 0.18, cy + s * 0.04, s * 0.085, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#5a6a7a';
  g.beginPath();
  g.arc(cx - s * 0.2, cy + s * 0.02, s * 0.03, 0, Math.PI * 2);
  g.fill();
  // 贴条
  g.fillStyle = '#e8e0c0';
  g.fillRect(cx - s * 0.08, cy - s * 0.09, s * 0.14, s * 0.05);
  // 铁皮帽子
  g.fillStyle = '#a8a8a0';
  g.beginPath();
  g.moveTo(cx - s * 0.36, cy - s * 0.12);
  g.lineTo(cx + s * 0.26, cy - s * 0.2);
  g.lineTo(cx + s * 0.28, cy - s * 0.13);
  g.lineTo(cx - s * 0.34, cy - s * 0.07);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(120,60,30,0.5)';
  for (let i = 0; i < 5; i++) g.fillRect(cx - s * 0.2 + i * s * 0.08, cy - s * 0.15, s * 0.03, s * 0.02);
  // REC 红点
  g.fillStyle = '#d02020';
  g.beginPath();
  g.arc(cx + s * 0.15, cy - s * 0.05, s * 0.015, 0, Math.PI * 2);
  g.fill();
}

/**
 * 本相过场里陆师傅举到灯下的那张片子（大座机的黑白页片，M4）：artTrueForm 的画面反相成负片——摄像头和铁皮帽子是暗的，
 * 背景透亮；四周一圈没曝光的透明片边。给 emissiveMap 用（底色黑、只靠自发光“透光”）。
 */
export function trueFormNegative(g: CanvasRenderingContext2D, w: number, h: number): void {
  const m = Math.round(Math.min(w, h) * 0.06);
  const iw = w - 2 * m, ih = h - 2 * m;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.save();
  g.beginPath();
  g.rect(m, m, iw, ih);
  g.clip();
  // artTrueForm 的画面在它画布的 8%–92%：放大到正好铺满片芯
  const W = iw / 0.84, H = ih / 0.84;
  g.translate(m - 0.08 * W, m - 0.08 * H);
  artTrueForm(g, W, H);
  g.restore();
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const core = x >= m && x < w - m && y >= m && y < h - m;
      // 片芯：按亮度反相，留一点片基灰雾（最暗处也透一点光）；片边：没曝光，最透亮
      const L = 0.299 * (d[i] ?? 0) + 0.587 * (d[i + 1] ?? 0) + 0.114 * (d[i + 2] ?? 0);
      const v = core ? 18 + (255 - L) * 0.86 : 236;
      d[i] = v * 0.97;
      d[i + 1] = v;
      d[i + 2] = Math.min(255, v * 1.03);
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // 片边上的一道指甲划痕
  g.fillStyle = 'rgba(40,40,40,0.5)';
  g.fillRect(m * 0.3, h * 0.3, 1, h * 0.25);
}

// ==================================================================== 街上的亮窗、路口烧纸的灰圈、街道办的灯箱

/** 楼上一扇亮着的窗：暖光、两片半拉的碎花窗帘、窗框十字的影子；plant = 窗台上一盆花的剪影。 */
export function litWindow(o: { warm: string; curtain: string; plant?: boolean; seed: number }): Paint {
  return (g, w, h) => {
    const r = rng(o.seed);
    const bg = g.createRadialGradient(w * 0.5, h * 0.35, 4, w * 0.5, h * 0.4, w * 0.9);
    bg.addColorStop(0, '#fff2d8');
    bg.addColorStop(0.45, o.warm);
    bg.addColorStop(1, shade(o.warm, 0.45));
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    // 屋里的一截灯绳与吊灯的影子
    g.fillStyle = 'rgba(60,30,10,0.35)';
    g.fillRect(w * 0.49, 0, 2, h * 0.18);
    // 窗帘：两边各一片，竖褶
    for (const side of [0, 1] as const) {
      const cw = w * range(r, 0.26, 0.36);
      const x0 = side === 0 ? 0 : w - cw;
      for (let i = 0; i < 9; i++) {
        g.fillStyle = i % 2 ? o.curtain : shade(o.curtain, 0.8);
        g.globalAlpha = 0.72;
        g.fillRect(x0 + (i * cw) / 9, 0, cw / 9 + 1, h);
      }
      g.globalAlpha = 0.5;
      for (let k = 0; k < 18; k++) {
        g.fillStyle = shade(o.curtain, 1.25);
        g.beginPath();
        g.arc(x0 + r() * cw, r() * h, range(r, 2, 4), 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    // 窗框十字的影子
    g.fillStyle = 'rgba(30,18,8,0.75)';
    g.fillRect(w * 0.49, 0, w * 0.025, h);
    g.fillRect(0, h * 0.44, w, h * 0.025);
    if (o.plant) {
      g.fillStyle = 'rgba(25,20,12,0.92)';
      g.fillRect(w * 0.58, h * 0.84, w * 0.12, h * 0.16);
      for (let k = 0; k < 7; k++) {
        g.beginPath();
        g.ellipse(w * (0.64 + range(r, -0.08, 0.08)), h * (0.78 - k * 0.025), w * 0.05, h * 0.02, range(r, -1, 1), 0, Math.PI * 2);
        g.fill();
      }
    }
  };
}

/** 路口烧纸留下的灰圈（透明底）：一圈粉笔圈、黑灰、几片没烧透的黄纸边。 */
export const ashCircle: Paint = (g, w, h) => {
  g.clearRect(0, 0, w, h);
  const r = rng(715);
  const cx = w / 2, cy = h / 2;
  // 粉笔圈（留个口朝西，给“那边的人”进来拿）
  g.strokeStyle = 'rgba(225,220,205,0.75)';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(cx, cy, w * 0.44, Math.PI * 1.12, Math.PI * 0.88 + Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * w * 0.34;
    g.fillStyle = `rgba(${Math.round(range(r, 10, 40))},${Math.round(range(r, 8, 30))},${Math.round(range(r, 6, 22))},${range(r, 0.5, 0.95)})`;
    g.beginPath();
    g.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, range(r, 3, 11), range(r, 2, 7), r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2, d = range(r, 0.1, 0.36) * w;
    g.fillStyle = `rgba(${Math.round(range(r, 170, 215))},${Math.round(range(r, 140, 175))},60,0.9)`;
    g.save();
    g.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
    g.rotate(r() * 3);
    g.fillRect(-6, -4, 12, 8);
    g.fillStyle = 'rgba(20,12,6,0.85)';
    g.fillRect(-6, 2, 12, 3);
    g.restore();
  }
};

/** 公交站边的街道办灯箱：中元节文明祭扫（亮面，emissiveMap 用同一张）。 */
export const civicLightbox: Paint = (g, w, h) => {
  const lines = TEXT.sign.civic;
  g.fillStyle = '#f4f0e6';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#b3202a';
  g.fillRect(0, 0, w, h * 0.2);
  g.fillStyle = '#fff4e0';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(h * 0.09)}px ${FONT_STACK}`;
  g.fillText(lines[0] ?? '', w / 2, h * 0.1);
  g.fillStyle = '#2a2a2a';
  g.font = `bold ${Math.round(w * 0.11)}px ${FONT_STACK}`;
  g.fillText(lines[1] ?? '', w / 2, h * 0.36);
  g.font = `${Math.round(w * 0.065)}px ${FONT_STACK}`;
  g.fillText(lines[2] ?? '', w / 2, h * 0.5);
  g.fillText(lines[3] ?? '', w / 2, h * 0.58);
  // 一枝白菊
  g.strokeStyle = '#4a6a3a';
  g.lineWidth = w * 0.01;
  g.beginPath();
  g.moveTo(w * 0.5, h * 0.92);
  g.quadraticCurveTo(w * 0.46, h * 0.8, w * 0.52, h * 0.7);
  g.stroke();
  g.fillStyle = '#e8e4d8';
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    g.beginPath();
    g.ellipse(w * 0.52 + Math.cos(a) * w * 0.031, h * 0.7 + Math.sin(a) * w * 0.023, w * 0.023, w * 0.008, a, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#6a6a6a';
  g.font = `${Math.round(w * 0.05)}px ${FONT_STACK}`;
  g.fillText(lines[4] ?? '', w / 2, h * 0.97 - w * 0.03);
};

// ==================================================================== 灯箱（emissiveMap 用同一张图）

/**
 * 挑出街面的竖灯箱：白底灯箱片，竖排大字 + 底下一行小字（竖排），上下两条色带。
 * 贴在 0.5 宽 × 1.3 高的面上：画布 256 × 666 左右。
 */
export function bladeSign(main: string, sub: string, o: { band: string; ink: string; subInk: string; seed: number }): Paint {
  return (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, w, 0);
    bg.addColorStop(0, '#e4ddca');
    bg.addColorStop(0.5, '#f7f3e8');
    bg.addColorStop(1, '#e2dac4');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = o.band;
    g.fillRect(0, 0, w, h * 0.06);
    g.fillRect(0, h * 0.94, w, h * 0.06);
    const chars = [...main];
    const top = h * 0.1, bottom = h * 0.74;
    const step = (bottom - top) / chars.length;
    g.fillStyle = o.ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold ${Math.round(Math.min(w * 0.72, step * 0.9))}px ${FONT_STACK}`;
    chars.forEach((c, i) => g.fillText(c, w / 2, top + step * (i + 0.5)));
    const subs = [...sub];
    const sStep = (h * 0.9 - h * 0.77) / Math.max(1, subs.length);
    g.fillStyle = o.subInk;
    g.font = `bold ${Math.round(Math.min(w * 0.3, sStep * 0.95))}px ${FONT_STACK}`;
    subs.forEach((c, i) => g.fillText(c, w / 2, h * 0.77 + sStep * (i + 0.5)));
    // 灯箱片里积的灰、雨水流下的道子、一只小虫的影子
    const r = rng(o.seed);
    g.fillStyle = 'rgba(90,70,40,0.16)';
    g.fillRect(0, h * 0.06, w, h * 0.03);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(60,50,30,0.12)';
      g.fillRect(r() * w, h * range(r, 0.06, 0.4), range(r, 2, 4), h * range(r, 0.2, 0.5));
    }
    g.fillStyle = 'rgba(30,20,10,0.5)';
    g.fillRect(w * range(r, 0.2, 0.8), h * range(r, 0.8, 0.9), 6, 3);
  };
}

/** 前厅隔墙上的横灯箱“彩色扩印”：黄底红字，下面一行蓝字，右端一道彩虹条（老冲印店的样子）。 */
export const hallLightbox: Paint = (g, w, h) => {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#f6e7b0');
  bg.addColorStop(1, '#efd98e');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const bands = ['#c8202a', '#e8801a', '#e8c81a', '#2a8a3a', '#1a5aa8'];
  bands.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(w * (0.86 + i * 0.024), 0, w * 0.024, h);
  });
  g.fillStyle = '#b3202a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(h * 0.52)}px ${FONT_STACK}`;
  const main = [...TEXT.sign.hallBox.main];
  main.forEach((c, i) => g.fillText(c, w * (0.12 + i * 0.2), h * 0.4));
  g.fillStyle = '#1a3a7a';
  g.font = `bold ${Math.round(h * 0.2)}px ${FONT_STACK}`;
  g.fillText(TEXT.sign.hallBox.sub, w * 0.43, h * 0.83);
  g.fillStyle = 'rgba(90,60,20,0.2)';
  g.fillRect(0, 0, w, h * 0.05);
  g.fillRect(0, h * 0.95, w, h * 0.05);
};
