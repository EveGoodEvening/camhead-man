// owner: WP2
// 衣服贴图（char2 WP-S 重画）：值勤衬衫、中山装、碎花布、长袍、袖箍、布鞋、纸纹。accessories.ts 仍原名转出。
// char2：口袋、门襟、领子、褶子都是几何（WP-U/WP-L），贴图只画布纹、缝线、洗旧与花色——不再画“假口袋”“假领口”。
// 躯干 UV（PLAN §2.3 / shared.ts squircleLoft 约定）：u = 0 在 +x（人的右侧缝），0.25 前胸正中，0.5 左侧缝，0.75 后背正中；
// v 自下而上。缝线位置按 TORSO_UV（下面）从躯干高度换成 v；整合时若 WP-U 的 v 映射不同，只改 TORSO_UV 一处。
// 尺寸固定（画布预算，PLAN §0.4）。

import * as THREE from 'three';
import { PALETTE } from '../../data/palette';
import { grain, hexRgb, paintTexture, shade } from '../../kit/canvas';
import { rng, range } from '../../kit/rng';
import { FONT_STACK } from '../../kit/text';

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

/**
 * 躯干贴图的 v 映射假设（spine 局部高度 ÷ s）：v = 0 在 WAIST（spine 局部 −0.075），v = 1 在领口根（spine 局部 0.44）。
 * 以及衬衫/中山装上缝线、扣位、口袋的位置（u 与 spine 局部高度 ÷ s）。WP-U 的扣子、口袋几何与 WP-C 的中山装细节可以直接读这些数。
 */
export const TORSO_UV = {
  v0: -0.075, v1: 0.44,
  /** 前胸正中（门襟） */
  placketU: 0.25,
  /** 门襟宽（u） */
  placketW: 0.034,
  /** pockets：[u 中心, 下沿 y, 上沿 y, 宽 u] */
  uniform: { buttonsY: [0.0, 0.09, 0.18, 0.27, 0.36], pockets: [[0.15, 0.25, 0.36, 0.11], [0.35, 0.25, 0.36, 0.11]], yokeY: 0.37 },
  zhongshan: {
    buttonsY: [0.396, 0.342, 0.256, 0.154, 0.058],
    pockets: [[0.12, 0.26, 0.36, 0.09], [0.38, 0.26, 0.36, 0.09], [0.11, 0.03, 0.158, 0.11], [0.39, 0.03, 0.158, 0.11]],
    yokeY: 0.38,
  },
} as const;
/** spine 局部高度（÷ s）→ 画布 y（像素，自上而下） */
const cy = (y: number, h: number) => (1 - (y - TORSO_UV.v0) / (TORSO_UV.v1 - TORSO_UV.v0)) * h;

// ---------------------------------------------------------------- 布纹（逐像素，周期平铺，不出横条）

/**
 * 织纹：平纹（plain）或斜纹（twill）的逐像素明暗 + 纱线粗细不匀（逐行/逐列的轻微起伏）+ 纤维噪点。
 * amp：最大亮度起伏（相对值，≤ 0.06）。x 方向周期平铺（u 绕身一圈接缝不断）。只乘明暗，不改色相。
 */
export function clothWeave(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, seed: number, o?: { amp?: number; twill?: boolean }): void {
  const amp = Math.min(0.06, o?.amp ?? 0.045);
  const r = rng(seed);
  const img = g.getImageData(x0, y0, w, h);
  const d = img.data;
  const n = d.length / 4;
  if (!(n > 0)) return;
  // 纱线不匀：每列（经纱）、每行（纬纱）一个小起伏，低频平滑过（相邻纱线相近，不是一条条硬线）
  const col = smoothNoise(w, r, 3), row = smoothNoise(h, r, 3);
  const twill = o?.twill === true;
  for (let i = 0; i < n; i++) {
    const x = i % w, y = (i / w) | 0;
    // 交织点：平纹 2×2 棋盘；斜纹 4 像素一个 45° 斜向周期
    const cell = twill ? (((x + y) & 3) < 2 ? 1 : -1) : (((x ^ y) & 1) ? 1 : -1);
    const fibre = r() - 0.5;
    const k = 1 + amp * (0.4 * cell + 0.25 * col[x]! + 0.06 * row[y]! + 0.45 * fibre);
    d[i * 4] = clamp255(d[i * 4]! * k);
    d[i * 4 + 1] = clamp255(d[i * 4 + 1]! * k);
    d[i * 4 + 2] = clamp255(d[i * 4 + 2]! * k);
  }
  g.putImageData(img, x0, y0);
}

/** 中频斑驳（棉布纱线粗细、染色不匀）：cell 像素一格的平滑值噪声（x、y 循环），乘到画布上，±amp。3m 外仍读得出是布。 */
export function clothMottle(g: CanvasRenderingContext2D, w: number, h: number, seed: number, cell: number, amp: number): void {
  const r = rng(seed);
  const nx = Math.max(1, Math.round(w / cell)), ny = Math.max(1, Math.round(h / cell));
  const grid = new Float32Array(nx * ny);
  for (let i = 0; i < grid.length; i++) grid[i] = r() * 2 - 1;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  if (!(d.length > 0)) return;
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    const gy = (y / h) * ny, y0 = Math.floor(gy), ty = sm(gy - y0), r0 = (y0 % ny) * nx, r1 = ((y0 + 1) % ny) * nx;
    for (let x = 0; x < w; x++) {
      const gx = (x / w) * nx, x0 = Math.floor(gx), tx = sm(gx - x0), c0 = x0 % nx, c1 = (x0 + 1) % nx;
      const v = (grid[r0 + c0]! * (1 - tx) + grid[r0 + c1]! * tx) * (1 - ty) + (grid[r1 + c0]! * (1 - tx) + grid[r1 + c1]! * tx) * ty;
      const k = 1 + amp * v, i = (y * w + x) * 4;
      d[i] = clamp255(d[i]! * k);
      d[i + 1] = clamp255(d[i + 1]! * k);
      d[i + 2] = clamp255(d[i + 2]! * k);
    }
  }
  g.putImageData(img, 0, 0);
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** 长 n 的循环平滑噪声（−1..1）：随机值做 passes 次三点循环平滑。 */
function smoothNoise(n: number, r: () => number, passes: number): Float32Array {
  let a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = r() * 2 - 1;
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) b[i] = (a[(i + n - 1) % n]! + 2 * a[i]! + a[(i + 1) % n]!) / 4;
    a = b;
  }
  let m = 0;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i]!));
  if (m > 0) for (let i = 0; i < n; i++) a[i] = a[i]! / m;
  return a;
}

/** 一道软褶：沿 (x0,y0)→(x1,y1) 的一条窄的“暗折痕 + 旁边一道受光”，两端渐隐。amp ≤ 0.08；x 方向绕接缝画三遍。 */
export function softFold(g: CanvasRenderingContext2D, w: number, x0: number, y0: number, x1: number, y1: number, width: number, amp: number): void {
  const a = Math.min(0.08, amp);
  for (const off of [-w, 0, w]) {
    const ax = x0 + off, bx = x1 + off;
    if (Math.max(ax, bx) + width * 3 < 0 || Math.min(ax, bx) - width * 3 > w) continue;
    const nx = -(y1 - y0), ny = bx - ax;
    const nl = Math.hypot(nx, ny) || 1;
    const ox = (nx / nl) * width * 0.9, oy = (ny / nl) * width * 0.9;
    stroke(g, ax, y0, bx, y1, width, `rgba(0,0,0,${a})`);
    stroke(g, ax + ox, y0 + oy, bx + ox, y1 + oy, width * 0.8, `rgba(255,255,255,${a * 0.6})`);
  }
}

function stroke(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, width: number, color: string): void {
  // 两端渐隐的线：沿线的线性渐变当描边颜色（中间实、两头透明），再模糊柔化
  const grad = g.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.35, color);
  grad.addColorStop(0.65, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.save();
  g.filter = `blur(${Math.max(1, width * 0.6).toFixed(1)}px)`;
  g.strokeStyle = grad;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x0, y0);
  g.quadraticCurveTo((x0 + x1) / 2 + (y1 - y0) * 0.08, (y0 + y1) / 2 - (x1 - x0) * 0.08, x1, y1);
  g.stroke();
  g.restore();
}

/** 缝线：一行细密的短针脚。dash 像素。 */
export function stitchLine(g: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[], color: string, o?: { dash?: number; width?: number; alpha?: number }): void {
  g.save();
  g.globalAlpha *= o?.alpha ?? 0.55;
  g.strokeStyle = color;
  g.lineWidth = o?.width ?? 1;
  g.setLineDash([o?.dash ?? 2.5, (o?.dash ?? 2.5) * 0.8]);
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.restore();
}

/** 布面的洗旧：大片极淡的亮斑/暗斑（低频），模拟穿旧、晒褪色。amt ≤ 0.06。x 方向循环。 */
function wear(g: CanvasRenderingContext2D, w: number, h: number, seed: number, amt: number, n = 10): void {
  const r = rng(seed);
  g.save();
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, rad = range(r, 0.06, 0.16) * Math.max(w, h);
    const light = r() < 0.6;
    for (const off of [-w, 0, w]) {
      const gr = g.createRadialGradient(x + off, y, 0, x + off, y, rad);
      gr.addColorStop(0, light ? `rgba(255,255,255,${amt})` : `rgba(0,0,0,${amt * 0.8})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x + off - rad, y - rad, rad * 2, rad * 2);
    }
  }
  g.restore();
}

function button(g: CanvasRenderingContext2D, x: number, y: number, rad: number, color: string): void {
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath();
  g.arc(x + 0.6, y + 0.8, rad + 0.4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, rad, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.beginPath();
  g.arc(x - rad * 0.3, y - rad * 0.35, rad * 0.35, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (const [dx, dy] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]] as const) {
    g.beginPath();
    g.arc(x + rad * dx, y + rad * dy, rad * 0.13, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** 口袋的缝线（只是针脚，口袋本身是几何）：三边双道压线 + 袋盖下沿一道。y0 上沿、y1 下沿（画布像素）。 */
function pocketStitch(g: CanvasRenderingContext2D, x: number, y0: number, y1: number, w: number, color: string, flap: boolean): void {
  const l = x - w / 2, r = x + w / 2;
  for (const inset of [1.5, 4]) {
    stitchLine(g, [[l + inset, y0], [l + inset, y1 - inset], [r - inset, y1 - inset], [r - inset, y0]], color, { alpha: 0.4 });
  }
  if (flap) {
    const fy = y0 + (y1 - y0) * 0.3;
    stitchLine(g, [[l + 1, fy], [x, fy + 2.5], [r - 1, fy]], color, { alpha: 0.5 });
  }
}

/** 侧缝（u = 0 与 0.5）与后背过肩线。 */
function torsoSeams(g: CanvasRenderingContext2D, w: number, h: number, dark: string, yokeY: number): void {
  for (const x of [0.5, w / 2, w - 0.5]) stitchLine(g, [[x, 0], [x, h]], dark, { alpha: 0.35, dash: 3 });
  const yy = cy(yokeY, h);
  stitchLine(g, [[w / 2 + 2, yy], [w * 0.62, yy + 3], [w * 0.75, yy + 4], [w * 0.88, yy + 3], [w - 2, yy]], dark, { alpha: 0.4 });
}

// ---------------------------------------------------------------- 衣服

/**
 * 藏蓝短袖值勤衬衫（主角、老周）：门襟两道压线与一列浅色扣子、两个胸袋的针脚、左胸袋口一支笔、后背过肩线、侧缝；
 * 洗得发白的大片斑、胳肢窝一点汗渍。口袋盖、领子、门襟本身是几何（WP-U），这里不再画假的。
 */
export function uniformShirtTexture(): THREE.CanvasTexture {
  return cachedTex('outfit.uniform', () => paintTexture(512, 256, (g, w, h) => {
    const base = PALETTE.UNIFORM;
    const L = TORSO_UV.uniform;
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    wear(g, w, h, 56, 0.05, 12);
    // 胳肢窝的汗渍（侧缝上端，前后各一点）
    for (const x of [0, w / 2, w]) {
      const gr = g.createRadialGradient(x, cy(0.33, h), 2, x, cy(0.33, h), 26);
      gr.addColorStop(0, 'rgba(0,0,0,0.07)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - 26, cy(0.33, h) - 26, 52, 52);
    }
    // 衣褶：腋下往胸口的拉褶、腰上塞进裤腰的几道短褶、后背肩胛的拉线（都很淡，形状交给几何）
    softFold(g, w, w * 0.005, cy(0.3, h), w * 0.06, cy(0.18, h), 8, 0.07);
    softFold(g, w, w * 0.495, cy(0.3, h), w * 0.44, cy(0.19, h), 8, 0.07);
    for (const [x, k] of [[0.11, 1], [0.19, -1], [0.33, 1], [0.41, -1], [0.62, 1], [0.86, -1]] as const) {
      softFold(g, w, w * x, h, w * (x + 0.012 * k), cy(-0.01, h), 4, 0.06);
    }
    softFold(g, w, w * 0.66, cy(0.36, h), w * 0.71, cy(0.22, h), 6, 0.04);
    softFold(g, w, w * 0.86, cy(0.35, h), w * 0.8, cy(0.2, h), 6, 0.04);
    clothMottle(g, w, h, 57, 8, 0.04);
    clothWeave(g, 0, 0, w, h, 55, { amp: 0.045 });
    const dark = shade(base, 0.45);
    torsoSeams(g, w, h, dark, L.yokeY);
    // 门襟：两道压线 + 一列浅色扣子
    const px = TORSO_UV.placketU * w, pw = TORSO_UV.placketW * w;
    for (const x of [px - pw / 2, px + pw / 2]) stitchLine(g, [[x, cy(0.42, h)], [x, h]], dark, { alpha: 0.5 });
    for (const y of L.buttonsY) button(g, px, cy(y, h), 3.6, '#cfcabd');
    // 胸袋针脚（口袋盖是几何）
    for (const [u, y0, y1, pw2] of L.pockets) pocketStitch(g, u * w, cy(y1, h), cy(y0, h), pw2 * w, dark, true);
    // 左胸（画面右）袋口别的一支笔：笔夹露在袋口上
    const pen = L.pockets[1];
    const penX = (pen[0] + pen[3] * 0.28) * w, penY = cy(pen[2], h);
    g.fillStyle = '#17171a';
    g.fillRect(penX - 1.5, penY - 9, 3, 12);
    g.fillStyle = '#c8b25a';
    g.fillRect(penX - 1.5, penY - 9, 3, 3);
    g.fillRect(penX + 1, penY - 8, 1, 9);
  }));
}

/** 中山装（陆师傅灰色、黄三爷旧的蓝灰）：只画针脚——门襟压线与五粒扣、四个口袋的针脚、过肩线、侧缝。领子、口袋盖是几何。 */
export function zhongshanTexture(color: string): THREE.CanvasTexture {
  return cachedTex(`outfit.zhongshan.${color}`, () => paintTexture(512, 256, (g, w, h) => {
    const L = TORSO_UV.zhongshan;
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    wear(g, w, h, 72, 0.035, 8);
    softFold(g, w, w * 0.005, cy(0.31, h), w * 0.07, cy(0.2, h), 5, 0.045);
    softFold(g, w, w * 0.495, cy(0.31, h), w * 0.43, cy(0.21, h), 5, 0.045);
    softFold(g, w, w * 0.2, cy(0.0, h), w * 0.23, cy(-0.07, h), 5, 0.04);
    softFold(g, w, w * 0.72, cy(0.37, h), w * 0.69, cy(0.24, h), 6, 0.035);
    clothMottle(g, w, h, 73, 8, 0.03);
    clothWeave(g, 0, 0, w, h, 71, { amp: 0.04, twill: true });
    const dark = shade(color, 0.5);
    torsoSeams(g, w, h, dark, L.yokeY);
    const px = TORSO_UV.placketU * w, pw = TORSO_UV.placketW * w;
    stitchLine(g, [[px + pw / 2, cy(0.43, h)], [px + pw / 2, h]], dark, { alpha: 0.5 });
    for (const y of L.buttonsY) button(g, px, cy(y, h), 3.8, shade(color, 0.55));
    for (const [u, y0, y1, pw2] of L.pockets) pocketStitch(g, u * w, cy(y1, h), cy(y0, h), pw2 * w, dark, true);
  }));
}

/**
 * 碎花布衫（王奶奶）：深底上细碎的小白花、粉花、黄花与两片小叶，花朵直径约 5–7 像素（躯干一圈 256 像素 ≈ 0.9m → 花约 2–2.5cm）；
 * 抖动的网格撒点（不成团、不成行），x、y 都循环平铺（袖子、衣身共用）。
 */
export function floralTexture(base = '#5B6E8C', seed = 3): THREE.CanvasTexture {
  return cachedTex(`outfit.floral.${base}.${seed}`, () => paintTexture(256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const r = rng(seed);
    const leaf = shade(base, 0.72);
    // fix1：碎花更小更密、颜色压低（原来 15×15 的花在钠灯下读成一颗颗黄星星）
    const N = 22, cw = w / N;
    const draw = (fn: (ox: number, oy: number) => void) => {
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) fn(ox, oy);
    };
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = (i + 0.5 + (j % 2) * 0.5 + range(r, -0.35, 0.35)) * cw, y = (j + 0.5 + range(r, -0.5, 0.5)) * cw;
        const pick = r();
        const petal = pick < 0.62 ? '#BDBAB2' : pick < 0.84 ? '#BC8E8E' : '#BDB07E';
        const rad = range(r, 1.5, 2.1), rot = r() * Math.PI;
        const la = r() * Math.PI * 2;
        draw((ox, oy) => {
          // 两片小叶
          g.fillStyle = leaf;
          for (const sg of [-1, 1]) {
            g.beginPath();
            g.ellipse(x + ox + Math.cos(la + sg * 0.6) * rad * 1.5, y + oy + Math.sin(la + sg * 0.6) * rad * 1.5, rad * 0.75, rad * 0.32, la + sg * 0.6, 0, Math.PI * 2);
            g.fill();
          }
          // 五瓣
          g.fillStyle = petal;
          for (let k = 0; k < 5; k++) {
            const a = rot + (k / 5) * Math.PI * 2;
            g.beginPath();
            g.ellipse(x + ox + Math.cos(a) * rad * 0.62, y + oy + Math.sin(a) * rad * 0.62, rad * 0.55, rad * 0.4, a, 0, Math.PI * 2);
            g.fill();
          }
          g.fillStyle = '#8C7440';
          g.beginPath();
          g.arc(x + ox, y + oy, rad * 0.26, 0, Math.PI * 2);
          g.fill();
        });
      }
    }
    // 碎点：花间零星的小白点
    g.fillStyle = 'rgba(200,196,186,0.5)';
    for (let i = 0; i < 160; i++) g.fillRect(r() * w, r() * h, 1, 1);
    clothWeave(g, 0, 0, w, h, seed + 1, { amp: 0.04 });
  }, { repeat: [1, 1] }));
}

/** 土地的长袍：粗灰布（不匀的粗纱、竹节纱），下摆一道深色宽边与一道细的旧金色滚边。v 自下（0）而上（1）。褶子是几何（WP-L）。 */
export function robeTexture(): THREE.CanvasTexture {
  return cachedTex('outfit.robe', () => paintTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#7C7A74';
    g.fillRect(0, 0, w, h);
    const r = rng(91);
    // 竹节纱：一段段稍亮/稍暗的横向短纱
    for (let i = 0; i < 520; i++) {
      const x = r() * w, y = r() * h, l = range(r, 4, 16);
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      g.fillRect(x, y, l, 1);
      if (x + l > w) g.fillRect(x - w, y, l, 1);
    }
    wear(g, w, h, 92, 0.04, 8);
    clothMottle(g, w, h, 95, 6, 0.045);
    clothWeave(g, 0, 0, w, h, 93, { amp: 0.055 });
    // 下摆边：深色宽边 + 一道细的旧金色滚边 + 边上的针脚
    const by = Math.round(h * 0.9);
    g.fillStyle = '#4E4C47';
    g.fillRect(0, by, w, h - by);
    clothWeave(g, 0, by, w, h - by, 94, { amp: 0.05 });
    g.fillStyle = '#9C8258';
    g.fillRect(0, by - 2, w, 2);
    stitchLine(g, [[0, by + 3], [w, by + 3]], '#2e2c29', { alpha: 0.5 });
    // 下摆贴着地，磨得发白
    const grd = g.createLinearGradient(0, h * 0.97, 0, h);
    grd.addColorStop(0, 'rgba(200,190,170,0)');
    grd.addColorStop(1, 'rgba(200,190,170,0.18)');
    g.fillStyle = grd;
    g.fillRect(0, h * 0.97, w, h * 0.03);
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
    wear(g, w, h, 18, 0.06, 5);
    clothWeave(g, 0, 0, w, h, 17, { amp: 0.05 });
  }));
}

/**
 * 黑布鞋：黑色布面（细斜纹）、鞋口一圈滚边、正中一道鞋脸缝；白色千层底（一排排纳底的针脚）与一道底边线。
 * 鞋盒 UV（旧版鞋）：顶面映到 v≈0.9，底面 v≈0.05，侧面下四分之一是鞋底——char2 的鞋楦（WP-L）沿用同一约定：v < 0.26 是鞋底，u = 0.25 是鞋头正前。
 */
export function clothShoeTexture(): THREE.CanvasTexture {
  return cachedTex('outfit.clothShoe', () => paintTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#18181b';
    g.fillRect(0, 0, w, h);
    clothWeave(g, 0, 0, w, Math.round(h * 0.72), 23, { amp: 0.06, twill: true });
    // 鞋脸正中的缝与鞋口滚边
    stitchLine(g, [[w * 0.25, 0], [w * 0.25, h * 0.7]], '#3a3a3e', { alpha: 0.6 });
    g.fillStyle = '#0d0d0f';
    g.fillRect(0, 0, w, h * 0.06);
    // 千层底：米白、一排排纳底针脚，上沿一道暗的贴边线
    const sy = h * 0.74;
    const [sr, sg, sb] = hexRgb('#DCD6C6');
    g.fillStyle = `rgb(${sr},${sg},${sb})`;
    g.fillRect(0, sy, w, h - sy);
    g.fillStyle = 'rgba(70,60,50,0.35)';
    for (let row = 0; row < 3; row++) {
      for (let x = (row % 2) * 2; x < w; x += 4) g.fillRect(x, sy + 5 + row * 7, 1.6, 1.6);
    }
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, h - 4, w, 4);
    g.fillStyle = '#0b0b0c';
    g.fillRect(0, sy - 2, w, 2.5);
    grain(g, w, h, 0.04, 24);
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
