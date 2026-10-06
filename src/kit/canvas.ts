// owner: WP2
// 通用 Canvas 绘制与做旧（ARCH §10.1）：paintTexture()、PAINT 常用程序化贴图。
// 颜色贴图 colorSpace = SRGB（ARCH §13.1、§16 #7）；可平铺的（砖、瓷砖、墙裙、锈、湿地面）一律 RepeatWrapping，
// 由调用方（WP3 的 MATERIALS、区域）自行设 repeat。PAINT 每次调用都新建贴图（不缓存）：调用方可能改 repeat/offset，
// 共享实例会互相串改；需要复用的由调用方自己留着。

import * as THREE from 'three';
import { PALETTE } from '../data/palette';
import { rng, range } from './rng';

/** ARCH §1.2 的系统 CJK 字体栈（text.ts 的 FONT_STACK 就是它；放在这里是为了让 canvas.ts 不依赖 text.ts，避免循环 import）。 */
export const CJK_FONT_STACK = '"Noto Sans SC","Noto Sans CJK SC","Source Han Sans SC","PingFang SC","Microsoft YaHei","WenQuanYi Zen Hei",sans-serif';
const FONT_STACK = CJK_FONT_STACK;

type Paint = (g: CanvasRenderingContext2D, w: number, h: number) => void;

/** 新建一块 2D 画布（构建期用；只在浏览器里可用）。 */
export function createCanvas(w: number, h: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  // 构建期贴图大量用 getImageData（颗粒、裁切）：CPU 画布更快，也免掉 Chrome 的 willReadFrequently 警告
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('paintTexture: 2D canvas unavailable');
  return { canvas, g };
}

/** 把一块画布包成 CanvasTexture（共用的贴图设置）。 */
export function canvasToTexture(
  canvas: HTMLCanvasElement, o?: { srgb?: boolean; repeat?: [number, number]; anisotropy?: number; wrap?: boolean },
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  if (o?.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
  if (o?.repeat || o?.wrap) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  if (o?.repeat) tex.repeat.set(o.repeat[0], o.repeat[1]);
  // 平铺的大面（地面、墙）在掠射角下最需要各向异性；单张标签给 1 足够。画质档由调用方覆盖。
  tex.anisotropy = o?.anisotropy ?? (o?.repeat || o?.wrap ? 4 : 1);
  tex.userData.canvasBytes = canvas.width * canvas.height * 4;
  tex.needsUpdate = true;
  return tex;
}

export function paintTexture(
  w: number, h: number, paint: Paint,
  o?: { srgb?: boolean; repeat?: [number, number]; anisotropy?: number; mask?: boolean },
): THREE.CanvasTexture {
  const { canvas, g } = createCanvas(w, h);
  paint(g, canvas.width, canvas.height);
  if (o?.mask) alphaToGray(g, canvas.width, canvas.height);
  return canvasToTexture(canvas, o?.mask ? { ...o, srgb: false } : o);
}

/**
 * mask:true（M1c 补写，ARCH §10.1）：把画好的 alpha 转成 RGB 灰度、alpha 置满——给 `alphaMap` 用。
 * three 的 alphaMap 读**绿通道**（alphamap_fragment 的 .g）；用 rgba(255,255,255,a) 画出来的渐变，上传后 RGB 恒为 255，
 * alphaMap 读到的是“只要 a>0 就是 1”的硬边实心形状（M1c look-dev 发现：湿地光带成了实心矩形、假阴影成了硬边圆盘）。
 */
function alphaToGray(g: CanvasRenderingContext2D, w: number, h: number): void {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] ?? 0;
    d[i] = d[i + 1] = d[i + 2] = a;
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- 颜色小工具

/** '#rrggbb' → [r,g,b]（0–255）。 */
export function hexRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  // Color 内部是线性值；这里要画布用的 sRGB 分量
  const s = c.clone().convertLinearToSRGB();
  return [Math.round(s.r * 255), Math.round(s.g * 255), Math.round(s.b * 255)];
}

/** 颜色明暗抖动：k>1 变亮，k<1 变暗。 */
export function shade(hex: string, k: number, alpha = 1): string {
  const [r, g, b] = hexRgb(hex);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return alpha >= 1 ? `rgb(${f(r)},${f(g)},${f(b)})` : `rgba(${f(r)},${f(g)},${f(b)},${alpha})`;
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------- 做旧工具（text.ts 与各 PAINT 共用）

/** 细颗粒噪点（整张画布）：让大色块不那么“塑料”。amount 0..1。 */
export function grain(g: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number): void {
  const r = rng(seed);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const a = amount * 60;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * a;
    d[i] = Math.max(0, Math.min(255, (d[i] ?? 0) + n));
    d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] ?? 0) + n));
    d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] ?? 0) + n));
  }
  g.putImageData(img, 0, 0);
}

/** 不规则斑块（水渍、锈、霉点）：若干半透明椭圆叠成的一团。 */
export function blotch(
  g: CanvasRenderingContext2D, r: () => number, x: number, y: number, size: number, color: string, alpha: number, lumps = 7,
): void {
  g.save();
  g.fillStyle = color;
  for (let i = 0; i < lumps; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * size * 0.55;
    const rx = size * range(r, 0.25, 0.6);
    const ry = rx * range(r, 0.5, 1.1);
    g.globalAlpha = alpha * range(r, 0.35, 1);
    g.beginPath();
    g.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, rx, ry, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** 水渍：浅色晕 + 深色边环（纸上泡过水的样子）。 */
export function waterStain(g: CanvasRenderingContext2D, r: () => number, x: number, y: number, size: number): void {
  g.save();
  const grd = g.createRadialGradient(x, y, size * 0.1, x, y, size);
  grd.addColorStop(0, 'rgba(120,95,50,0.05)');
  grd.addColorStop(0.75, 'rgba(120,95,50,0.12)');
  grd.addColorStop(0.92, 'rgba(95,70,35,0.32)');
  grd.addColorStop(1, 'rgba(95,70,35,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.ellipse(x, y, size, size * range(r, 0.7, 1), r() * Math.PI, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** 纸张做旧：泛黄渐变、边缘发暗、几处水渍。strength 0..1。 */
export function agePaper(g: CanvasRenderingContext2D, w: number, h: number, strength: number, seed: number, stains = 2): void {
  const r = rng(seed);
  g.save();
  const edge = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  edge.addColorStop(0, 'rgba(140,110,60,0)');
  edge.addColorStop(1, `rgba(120,90,45,${0.35 * strength})`);
  g.fillStyle = edge;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < stains; i++) waterStain(g, r, range(r, 0.15, 0.85) * w, range(r, 0.15, 0.85) * h, range(r, 0.08, 0.2) * Math.min(w, h) * (0.6 + strength));
  g.restore();
}

/** 按字切行（中文逐字、拉丁按词）。 */
/** 避头尾（M4 第 2 轮整合，同 R3 守则的 wrapKinsoku）：不能打头的句读、后括号、后引号。 */
const NO_LINE_START = new Set([...'，。、；：？！）」』”’》…—']);
/** 不能留在行末的前括号、前引号。 */
const NO_LINE_END = new Set([...'（「『“‘《']);

export function wrapText(g: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    const tokens = para.match(/[A-Za-z0-9.,:;'"!?()\-/]+\s*|\s+|./gu) ?? [];
    for (const tk of tokens) {
      const next = line + tk;
      // 句读不打头：超宽也挂在本行末尾（多出一个字）
      if (line && g.measureText(next).width > maxWidth && !NO_LINE_START.has(tk[0]!)) {
        // 前括号不留在行末：挪到下一行开头
        let carry = '';
        while (line.length > 1 && NO_LINE_END.has(line[line.length - 1]!)) {
          carry = line[line.length - 1]! + carry;
          line = line.slice(0, -1);
        }
        out.push(line.trimEnd());
        line = carry + tk.trimStart();
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** 手写体：楷体优先（测试机只有文泉驿正黑，靠逐字抖动模拟手写）。 */
export const HAND_FONT_STACK = `"Kaiti SC","STKaiti","KaiTi","AR PL UKai CN",${FONT_STACK}`;
const HAND_FONT = HAND_FONT_STACK;
/** 衬线（宋体）：牌匾、对联。 */
export const SERIF_FONT_STACK = `"Noto Serif SC","Noto Serif CJK SC","Source Han Serif SC","Songti SC","SimSun",${FONT_STACK}`;

/** 手写：逐字抖动大小、角度、基线，墨色深浅不匀。 */
export function drawHandLine(
  g: CanvasRenderingContext2D, r: () => number, text: string, x: number, y: number, size: number, ink: string, o?: { pressure?: number; smear?: number },
): number {
  let cx = x;
  const pressure = o?.pressure ?? 1;
  for (const ch of text) {
    const s = size * range(r, 0.9, 1.08);
    g.save();
    g.translate(cx, y + range(r, -0.06, 0.06) * size);
    g.rotate(range(r, -0.07, 0.07));
    g.font = `${Math.round(s)}px ${HAND_FONT}`;
    g.globalAlpha = Math.min(1, pressure * range(r, 0.72, 1));
    g.fillStyle = ink;
    g.fillText(ch, 0, 0);
    if (o?.smear && r() < o.smear) {
      // 洇开：同一个字再淡淡印一遍、稍微偏一点
      g.globalAlpha = 0.18;
      g.fillText(ch, range(r, -1.5, 1.5), range(r, -1, 1.5));
    }
    const wch = g.measureText(ch).width;
    g.restore();
    cx += wch * range(r, 0.96, 1.08) + (ch === ' ' ? size * 0.1 : size * 0.02);
  }
  return cx - x;
}

// ---------------------------------------------------------------- PAINT

export interface PaintKit {
  bricks(o?: { rows?: number; cols?: number; color?: string; mortar?: string; seed?: number }): THREE.CanvasTexture;
  tiles(o?: { size?: number; color?: string; grout?: string; newer?: [number, number][] }): THREE.CanvasTexture;
  /** 下绿上白墙裙 */
  dado(o?: { split?: number }): THREE.CanvasTexture;
  rust(o?: { seed?: number }): THREE.CanvasTexture;
  wetGround(o?: { seed?: number }): THREE.CanvasTexture;
  /** 小广告：“开锁”“通下水道”“回收旧家电” */
  posters(o: { lines: readonly string[]; seed?: number }): THREE.CanvasTexture;
  /** 红圈“拆” */
  demolitionMark(): THREE.CanvasTexture;
  noticeSheet(o: { title: string; body: string; aged?: number }): THREE.CanvasTexture;
  handwriting(o: { lines: readonly string[]; ink: 'ballpoint' | 'wet_ink' | 'pencil'; seed?: number }): THREE.CanvasTexture;
}

const INK = { ballpoint: '#23408f', wet_ink: '#0e1424', pencil: '#5a5a5e' } as const;

/**
 * 砖墙：一张贴图 = rows 行 × cols 列（默认 16×8，丁顺错缝），横竖都可无缝平铺。
 * 每块砖颜色按 seed 抖动，底部几行偏暗（返潮），偶尔一块碎角。
 */
function bricks(o?: { rows?: number; cols?: number; color?: string; mortar?: string; seed?: number }): THREE.CanvasTexture {
  const rows = o?.rows ?? 16, cols = o?.cols ?? 8;
  const color = o?.color ?? PALETTE.BRICK;
  const mortar = o?.mortar ?? '#4a3f38';
  const r = rng(o?.seed ?? 11);
  return paintTexture(512, 512, (g, w, h) => {
    g.fillStyle = mortar;
    g.fillRect(0, 0, w, h);
    const bh = h / rows, bw = w / cols, m = Math.max(2, bh * 0.14);
    for (let row = 0; row < rows; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let c = -1; c <= cols; c++) {
        const x = c * bw + off;
        const k = range(r, 0.78, 1.18) * (r() < 0.08 ? 0.75 : 1);
        g.fillStyle = shade(color, k);
        g.fillRect(x + m / 2, row * bh + m / 2, bw - m, bh - m);
        // 砖面上的烧结斑
        if (r() < 0.5) blotch(g, r, x + range(r, 0.2, 0.8) * bw, row * bh + bh / 2, bh * 0.5, shade(color, 0.6), 0.25, 3);
        if (r() < 0.06) {
          g.fillStyle = mortar;
          g.beginPath();
          g.moveTo(x + bw - m, row * bh + m);
          g.lineTo(x + bw - m - bh * 0.6, row * bh + m);
          g.lineTo(x + bw - m, row * bh + bh * 0.7);
          g.fill();
        }
      }
    }
    // 雨水顺墙往下的深色竖纹（平铺后看起来像长年的雨痕）
    for (let i = 0; i < 10; i++) {
      const x = r() * w;
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, `rgba(10,5,5,${range(r, 0.08, 0.2)})`);
      g.fillStyle = grd;
      g.fillRect(x, 0, range(r, 4, 16), h);
    }
    grain(g, w, h, 0.25, (o?.seed ?? 11) + 1);
  }, { repeat: [1, 1] });
}

/** 瓷砖：size×size 块（默认 8）；newer 列出 [列, 行] 的新瓷砖（更白更亮、缝更干净）。 */
function tiles(o?: { size?: number; color?: string; grout?: string; newer?: [number, number][] }): THREE.CanvasTexture {
  const n = o?.size ?? 8;
  const color = o?.color ?? '#E4E2D8';
  const grout = o?.grout ?? '#8E8C80';
  const newer = new Set((o?.newer ?? []).map(([c, rr]) => `${c},${rr}`));
  const r = rng(n * 131 + newer.size);
  return paintTexture(512, 512, (g, w, h) => {
    g.fillStyle = grout;
    g.fillRect(0, 0, w, h);
    const s = w / n, m = Math.max(2, s * 0.05);
    for (let row = 0; row < n; row++) {
      for (let c = 0; c < n; c++) {
        const isNew = newer.has(`${c},${row}`);
        const k = isNew ? 1.1 : range(r, 0.86, 0.98);
        const x = c * s + m / 2, y = row * s + m / 2, ts = s - m;
        g.fillStyle = shade(color, k);
        g.fillRect(x, y, ts, ts);
        // 釉面反光：左上角一道浅色
        const grd = g.createLinearGradient(x, y, x + ts, y + ts);
        grd.addColorStop(0, `rgba(255,255,255,${isNew ? 0.28 : 0.12})`);
        grd.addColorStop(0.5, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.fillRect(x, y, ts, ts);
        if (!isNew) {
          // 老瓷砖：发黄的缝边与零星裂纹
          g.strokeStyle = 'rgba(110,90,50,0.25)';
          g.lineWidth = 2;
          g.strokeRect(x + 1, y + 1, ts - 2, ts - 2);
          if (r() < 0.12) {
            g.strokeStyle = 'rgba(60,55,50,0.45)';
            g.lineWidth = 1;
            g.beginPath();
            let px = x + r() * ts, py = y;
            g.moveTo(px, py);
            for (let k2 = 0; k2 < 4; k2++) {
              px += range(r, -0.2, 0.2) * ts;
              py += ts / 4;
              g.lineTo(px, py);
            }
            g.stroke();
          }
        } else {
          g.strokeStyle = 'rgba(255,255,255,0.5)';
          g.lineWidth = 2;
          g.strokeRect(x + 1, y + 1, ts - 2, ts - 2);
        }
      }
    }
  }, { repeat: [1, 1] });
}

/** 墙裙：下绿（DADO）上白（LIME），split 为分界高度占比（默认 0.45，从底往上）；横向可平铺。 */
function dado(o?: { split?: number }): THREE.CanvasTexture {
  const split = o?.split ?? 0.45;
  return paintTexture(512, 512, (g, w, h) => {
    const yS = h * (1 - split);
    g.fillStyle = PALETTE.LIME;
    g.fillRect(0, 0, w, yS);
    g.fillStyle = PALETTE.DADO;
    g.fillRect(0, yS, w, h - yS);
    // 油漆分界线（刷得不直）与分界处一道深色边
    g.fillStyle = shade(PALETTE.DADO, 0.55);
    g.fillRect(0, yS - 3, w, 6);
    const r = rng(77);
    // 绿漆面：刷痕、剥落露出石灰
    for (let i = 0; i < 40; i++) blotch(g, r, r() * w, yS + r() * (h - yS), range(r, 6, 26), shade(PALETTE.DADO, range(r, 0.8, 1.2)), 0.35, 4);
    for (let i = 0; i < 8; i++) blotch(g, r, r() * w, yS + range(r, 0.05, 0.9) * (h - yS), range(r, 4, 12), PALETTE.LIME, 0.6, 3);
    // 白墙面：返潮黄渍、铅笔划痕
    for (let i = 0; i < 12; i++) blotch(g, r, r() * w, r() * yS, range(r, 10, 40), 'rgb(170,150,110)', 0.12, 5);
    g.strokeStyle = 'rgba(60,60,60,0.25)';
    g.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const x = r() * w, y = range(r, 0.3, 0.9) * yS;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + range(r, -40, 40), y + range(r, -8, 8));
      g.stroke();
    }
    // 踢脚处的黑鞋印
    for (let i = 0; i < 6; i++) blotch(g, r, r() * w, h - range(r, 4, 30), range(r, 5, 12), '#1a1a1a', 0.25, 3);
    grain(g, w, h, 0.2, 78);
  }, { repeat: [1, 1] });
}

/** 锈斑铁皮：银灰底 + 橙褐锈团 + 细划痕；可平铺。 */
function rust(o?: { seed?: number }): THREE.CanvasTexture {
  const seed = o?.seed ?? 5;
  const r = rng(seed);
  return paintTexture(512, 512, (g, w, h) => {
    const base = g.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, '#a9aaa6');
    base.addColorStop(0.5, '#8d8f8c');
    base.addColorStop(1, '#a3a39d');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    // 冲压的细纹
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let y = 0; y < h; y += 6) {
      g.beginPath();
      g.moveTo(0, y + r() * 2);
      g.lineTo(w, y + r() * 2);
      g.stroke();
    }
    for (let i = 0; i < 26; i++) {
      const x = r() * w, y = r() * h, s = range(r, 10, 60);
      blotch(g, r, x, y, s * 1.3, '#5b3a22', 0.35, 6);
      blotch(g, r, x, y, s, '#9a4e1c', 0.5, 6);
      blotch(g, r, x, y, s * 0.5, '#c46a2a', 0.45, 4);
    }
    g.strokeStyle = 'rgba(40,30,25,0.35)';
    for (let i = 0; i < 30; i++) {
      const x = r() * w, y = r() * h;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + range(r, -60, 60), y + range(r, -10, 10));
      g.stroke();
    }
    grain(g, w, h, 0.3, seed + 3);
  }, { repeat: [1, 1] });
}

/** 湿地面：深沥青底、碎石颗粒、较亮的积水片（配合低粗糙度材质做出反光的错觉）；可平铺。 */
function wetGround(o?: { seed?: number }): THREE.CanvasTexture {
  const seed = o?.seed ?? 9;
  const r = rng(seed);
  return paintTexture(1024, 1024, (g, w, h) => {
    g.fillStyle = '#23242a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = Math.round(range(r, 20, 70));
      g.fillStyle = `rgb(${v},${v},${v + 4})`;
      g.fillRect(r() * w, r() * h, range(r, 1, 3), range(r, 1, 3));
    }
    // 积水：更深更“黑亮”的不规则片
    for (let i = 0; i < 14; i++) blotch(g, r, r() * w, r() * h, range(r, 40, 140), '#101218', 0.5, 9);
    // 修补过的沥青块与裂缝
    for (let i = 0; i < 4; i++) {
      g.fillStyle = 'rgba(15,15,18,0.45)';
      g.fillRect(r() * w, r() * h, range(r, 60, 200), range(r, 40, 120));
    }
    g.strokeStyle = 'rgba(8,8,10,0.7)';
    g.lineWidth = 2;
    for (let i = 0; i < 10; i++) {
      let x = r() * w, y = r() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += range(r, -40, 40);
        y += range(r, -40, 40);
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }, { repeat: [1, 1] });
}

/** 小广告：若干张歪贴的纸条（白/黄/粉），红黑字，互相压着、有的撕掉半截；透明底，当贴花用。 */
function posters(o: { lines: readonly string[]; seed?: number }): THREE.CanvasTexture {
  const r = rng(o.seed ?? 3);
  const lines = o.lines.length ? o.lines : ['开锁'];
  return paintTexture(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const papers = ['#F2EEDC', '#F4E27A', '#F0C3C8', '#FFFFFF', '#DDE8C8'];
    const inks = ['#C0161B', '#161616', '#1C3E9A'];
    const count = Math.max(lines.length, 5);
    for (let i = 0; i < count; i++) {
      const text = lines[i % lines.length] ?? '';
      const pw = range(r, 0.3, 0.5) * w, ph = range(r, 0.14, 0.24) * h;
      const x = range(r, 0.05, 0.95) * (w - pw), y = range(r, 0.02, 0.98) * (h - ph);
      g.save();
      g.translate(x + pw / 2, y + ph / 2);
      g.rotate(range(r, -0.12, 0.12));
      g.fillStyle = papers[Math.floor(r() * papers.length)] ?? '#fff';
      g.globalAlpha = range(r, 0.8, 1);
      // 撕掉一角
      g.beginPath();
      g.moveTo(-pw / 2, -ph / 2);
      g.lineTo(pw / 2, -ph / 2);
      if (r() < 0.35) {
        g.lineTo(pw / 2, ph * 0.05);
        g.lineTo(pw * 0.2, ph / 2);
      } else g.lineTo(pw / 2, ph / 2);
      g.lineTo(-pw / 2, ph / 2);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = inks[Math.floor(r() * inks.length)] ?? '#000';
      const size = Math.min(ph * 0.5, pw / Math.max(2, [...text].length) * 1.05);
      g.font = `bold ${Math.round(size)}px ${FONT_STACK}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 0, -ph * 0.08);
      g.font = `${Math.round(size * 0.38)}px ${FONT_STACK}`;
      g.fillText(`1${Math.floor(range(r, 30, 89))}${String(Math.floor(r() * 1e8)).padStart(8, '0')}`, 0, ph * 0.3);
      // 糨糊与雨水印
      waterStain(g, r, range(r, -0.3, 0.3) * pw, range(r, -0.3, 0.3) * ph, ph * 0.5);
      g.restore();
    }
  });
}

/** 红圈“拆”：喷漆的红圈与字，带流淌；透明底。 */
function demolitionMark(): THREE.CanvasTexture {
  const r = rng(404);
  return paintTexture(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const red = '#C8141B';
    g.strokeStyle = red;
    g.fillStyle = red;
    g.lineCap = 'round';
    // 喷漆圈：粗细不匀、首尾不闭合
    g.lineWidth = w * 0.045;
    g.beginPath();
    const cx = w / 2, cy = h * 0.47, rad = w * 0.36;
    for (let a = -0.3; a <= Math.PI * 2 + 0.1; a += 0.05) {
      const rr = rad * (1 + Math.sin(a * 3) * 0.02 + range(r, -0.01, 0.01));
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (a === -0.3) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.font = `bold ${Math.round(w * 0.46)}px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('拆', cx, cy + w * 0.02);
    // 喷雾边缘的飞点
    for (let i = 0; i < 400; i++) {
      const a = r() * Math.PI * 2, d = rad + range(r, -0.1, 0.12) * w;
      g.globalAlpha = range(r, 0.2, 0.7);
      g.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2, 2);
    }
    // 往下淌的漆
    g.globalAlpha = 0.85;
    g.lineWidth = w * 0.01;
    for (let i = 0; i < 6; i++) {
      const x = cx + range(r, -0.3, 0.3) * w, y0 = cy + range(r, 0.1, 0.35) * h;
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x + range(r, -3, 3), y0 + range(r, 0.05, 0.16) * h);
      g.stroke();
    }
    g.globalAlpha = 1;
  });
}

/** 公告纸：标题粗体、正文自动换行，aged 0..1 控制泛黄与水渍。 */
function noticeSheet(o: { title: string; body: string; aged?: number }): THREE.CanvasTexture {
  const aged = o.aged ?? 0.3;
  return paintTexture(1024, 1448, (g, w, h) => {
    g.fillStyle = '#F1ECDD';
    g.fillRect(0, 0, w, h);
    const pad = w * 0.08;
    g.fillStyle = '#1b1b1b';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.font = `bold ${Math.round(w * 0.065)}px ${FONT_STACK}`;
    const titleLines = wrapText(g, o.title, w - pad * 2);
    let y = pad;
    for (const l of titleLines) {
      g.fillText(l, w / 2, y);
      y += w * 0.085;
    }
    y += w * 0.03;
    g.textAlign = 'left';
    const size = Math.round(w * 0.04);
    g.font = `${size}px ${FONT_STACK}`;
    for (const l of wrapText(g, o.body, w - pad * 2)) {
      if (y > h - pad) break;
      g.fillText(l, pad, y);
      y += size * 1.6;
    }
    // 红章
    g.save();
    g.translate(w * 0.72, Math.min(h - pad * 2.2, y + size * 2));
    g.rotate(-0.15);
    g.strokeStyle = 'rgba(190,25,30,0.75)';
    g.lineWidth = w * 0.008;
    g.beginPath();
    g.arc(0, 0, w * 0.1, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(190,25,30,0.75)';
    g.font = `bold ${Math.round(w * 0.05)}px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('★', 0, 0);
    g.restore();
    agePaper(g, w, h, aged, 17, Math.round(1 + aged * 4));
    grain(g, w, h, 0.12 + aged * 0.2, 19);
  });
}

/** 手写字：逐字抖动，墨色按笔种；透明底（叠在纸面、墙面上用）。 */
function handwriting(o: { lines: readonly string[]; ink: 'ballpoint' | 'wet_ink' | 'pencil'; seed?: number }): THREE.CanvasTexture {
  const r = rng(o.seed ?? 21);
  const ink = INK[o.ink];
  const n = Math.max(1, o.lines.length);
  const h = n <= 4 ? 512 : n <= 9 ? 1024 : 2048;
  return paintTexture(1024, h, (g, w, hh) => {
    g.clearRect(0, 0, w, hh);
    const lineH = Math.min(hh / (n + 0.8), w * 0.12);
    const size = lineH * 0.62;
    g.textBaseline = 'alphabetic';
    let y = lineH * 0.95;
    for (const line of o.lines) {
      // 自动缩小过长的一行，保证整行都在画布内
      g.font = `${Math.round(size)}px ${HAND_FONT}`;
      const wLine = g.measureText(line).width * 1.08;
      const s = wLine > w * 0.9 ? size * (w * 0.9) / wLine : size;
      drawHandLine(g, r, line, w * 0.05 + range(r, 0, 8), y, s, ink, {
        pressure: o.ink === 'pencil' ? 0.7 : 1,
        smear: o.ink === 'wet_ink' ? 0.5 : 0,
      });
      y += lineH;
    }
  });
}

export const PAINT: PaintKit = {
  bricks,
  tiles,
  dado,
  rust,
  wetGround,
  posters,
  demolitionMark,
  noticeSheet,
  handwriting,
};
