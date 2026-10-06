// owner: R4
// R4 私有的 CanvasTexture 画法（GDD §9.4：招牌、小广告、纸人脸、门童灯笼字都用 CanvasTexture）。
// 每个函数新建一张贴图，调用方负责 ctx.track（区域卸载时释放）。尺寸都按“够读”取最小：总量远低于 64MB（ARCH §13.3）。

import * as THREE from 'three';
import { PALETTE } from '../../../data/palette';
import { agePaper, blotch, paintTexture, waterStain, wrapText, SERIF_FONT_STACK, HAND_FONT_STACK } from '../../../kit/canvas';
import { rng, range, pick } from '../../../kit/rng';
import { FONT_STACK } from '../../../kit/text';
import { TEXT } from '../text';

type G = CanvasRenderingContext2D;

function speckle(g: G, r: () => number, w: number, h: number, n: number, colors: readonly string[], smin: number, smax: number): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = pick(r, colors);
    const s = range(r, smin, smax);
    g.beginPath();
    g.ellipse(r() * w, r() * h, s, s * range(r, 0.5, 1), r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
}

/** 水磨石地面（一张 = 2m×2m）：灰白石粉底 + 黑白绿的石子 + 分格铜条 + 鞋底磨出来的深色走道印。 */
export function terrazzoTexture(): THREE.CanvasTexture {
  const r = rng(4097);
  return paintTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#8f928a';
    g.fillRect(0, 0, w, h);
    speckle(g, r, w, h, 2600, ['#6d706a', '#a6a89f', '#b9b9ae', '#5b605a', '#7d8a7e', '#c8c4b4'], 0.8, 2.6);
    speckle(g, r, w, h, 260, ['#2f3430', '#d9d6c8', '#4f6a58', '#8a7a64'], 2, 5.5);
    // 分格铜条（一张两格）
    g.fillStyle = 'rgba(120,96,58,0.75)';
    g.fillRect(0, 0, w, 3);
    g.fillRect(0, 0, 3, h);
    g.fillRect(0, h / 2 - 1, w, 2);
    g.fillRect(w / 2 - 1, 0, 2, h);
    // 年深日久：脏印与返潮
    for (let i = 0; i < 10; i++) blotch(g, r, r() * w, r() * h, range(r, 30, 90), '#3d3a33', 0.12, 6);
  }, { repeat: [1, 1] });
}

/** 墙裙下的踢脚（深绿水泥 + 鞋印与泥点），按网格 UV 平铺。 */
export function skirtingTexture(): THREE.CanvasTexture {
  const r = rng(77);
  return paintTexture(512, 64, (g, w, h) => {
    g.fillStyle = '#23372d';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) blotch(g, r, r() * w, range(r, 0.3, 1) * h, range(r, 4, 14), '#4a4032', 0.25, 4);
    g.fillStyle = 'rgba(210,220,205,0.12)';
    g.fillRect(0, 0, w, 3);
  }, { repeat: [1, 1] });
}

/** 褪色公益壁画（约 11m × 1.7m）：城市天际线、和平鸽、红领巾的孩子、标语；掉皮、水渍、被小广告糊了几块。 */
export function muralTexture(): THREE.CanvasTexture {
  const r = rng(1997);
  const W = 2048, H = 320;
  return paintTexture(W, H, (g, w, h) => {
    // 天空：粉蓝 → 奶黄（褪色后的颜色）
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#9fb9c4');
    sky.addColorStop(0.65, '#d9d3b8');
    sky.addColorStop(1, '#c9bf9f');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    // 太阳 + 光芒
    g.fillStyle = 'rgba(232,160,110,0.75)';
    g.beginPath();
    g.arc(w * 0.12, h * 0.3, 42, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(232,170,120,0.5)';
    g.lineWidth = 4;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(w * 0.12 + Math.cos(a) * 52, h * 0.3 + Math.sin(a) * 52);
      g.lineTo(w * 0.12 + Math.cos(a) * 74, h * 0.3 + Math.sin(a) * 74);
      g.stroke();
    }
    // 天际线（高楼、电视塔）
    let x = w * 0.22;
    while (x < w * 0.98) {
      const bw = range(r, 40, 110), bh = range(r, 70, 190);
      g.fillStyle = pick(r, ['#8aa3a8', '#9aa7a0', '#a9a28c', '#7f95a3']);
      g.fillRect(x, h * 0.78 - bh, bw, bh);
      g.fillStyle = 'rgba(240,235,210,0.55)';
      for (let yy = h * 0.78 - bh + 10; yy < h * 0.74; yy += 16) for (let xx = x + 6; xx < x + bw - 8; xx += 14) if (r() < 0.7) g.fillRect(xx, yy, 7, 8);
      x += bw + range(r, 4, 26);
    }
    g.fillStyle = '#8f9fa3';
    g.fillRect(w * 0.63, h * 0.12, 8, h * 0.66);
    g.beginPath();
    g.arc(w * 0.63 + 4, h * 0.28, 16, 0, Math.PI * 2);
    g.fill();
    // 地面：绿地、马路
    g.fillStyle = '#9db08a';
    g.fillRect(0, h * 0.78, w, h * 0.22);
    g.fillStyle = '#b8b3a0';
    g.fillRect(0, h * 0.86, w, h * 0.05);
    // 红领巾的孩子（剪影 + 红三角）
    for (let i = 0; i < 7; i++) {
      const cx = w * 0.26 + i * 70 + range(r, -8, 8), cy = h * 0.9;
      g.fillStyle = '#6f6a5e';
      g.beginPath();
      g.arc(cx, cy - 64, 11, 0, Math.PI * 2);
      g.fill();
      g.fillRect(cx - 10, cy - 52, 20, 36);
      g.fillRect(cx - 9, cy - 16, 7, 18);
      g.fillRect(cx + 2, cy - 16, 7, 18);
      g.fillStyle = '#c0504a';
      g.beginPath();
      g.moveTo(cx - 8, cy - 52);
      g.lineTo(cx + 8, cy - 52);
      g.lineTo(cx, cy - 40);
      g.fill();
    }
    // 和平鸽
    g.fillStyle = 'rgba(245,242,230,0.9)';
    for (let i = 0; i < 6; i++) {
      const bx = w * range(r, 0.2, 0.55), by = h * range(r, 0.1, 0.35);
      g.beginPath();
      g.ellipse(bx, by, 14, 6, -0.3, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(bx - 4, by);
      g.lineTo(bx - 16, by - 18);
      g.lineTo(bx + 6, by - 3);
      g.fill();
    }
    // 标语（红漆，宋体）
    g.fillStyle = '#b8322a';
    g.font = `bold 64px ${SERIF_FONT_STACK}`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(TEXT.decor.muralSlogan, w * 0.66, h * 0.25);
    g.font = `bold 34px ${SERIF_FONT_STACK}`;
    g.fillStyle = '#7a5a3a';
    g.fillText(TEXT.decor.muralYear, w * 0.9, h * 0.44);
    // 褪色：整体罩一层灰白、返潮的水渍、墙皮掉了的块（露出下面的水泥）
    g.fillStyle = 'rgba(214,210,196,0.34)';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) waterStain(g, r, r() * w, range(r, 0.3, 1) * h, range(r, 30, 90));
    for (let i = 0; i < 22; i++) blotch(g, r, r() * w, r() * h, range(r, 10, 40), '#8c887c', 0.55, 6);
    // 墙根往上的霉黑
    const mold = g.createLinearGradient(0, h, 0, h * 0.6);
    mold.addColorStop(0, 'rgba(40,44,36,0.55)');
    mold.addColorStop(1, 'rgba(40,44,36,0)');
    g.fillStyle = mold;
    g.fillRect(0, h * 0.6, w, h * 0.4);
    // 糊在壁画上的小广告（白纸黑字）
    for (let i = 0; i < 5; i++) {
      const px = w * range(r, 0.05, 0.95), py = h * range(r, 0.45, 0.8), pw = range(r, 50, 80), ph = range(r, 64, 100);
      g.save();
      g.translate(px, py);
      g.rotate(range(r, -0.08, 0.08));
      g.fillStyle = '#e8e4d6';
      g.fillRect(-pw / 2, -ph / 2, pw, ph);
      g.fillStyle = '#1a1a1a';
      g.font = `bold 15px ${FONT_STACK}`;
      g.textAlign = 'center';
      const lines = pick(r, TEXT.decor.posters);
      lines.forEach((l, k) => g.fillText(l, 0, -ph / 2 + 20 + k * 20));
      g.restore();
    }
  });
}

/** 规矩牌（竖长木牌，黑字竖排）：牌头“鬼市”，下面两列规矩（doc.market_rules 原文）。 */
export function rulesBoardTexture(): THREE.CanvasTexture {
  const r = rng(515);
  return paintTexture(512, 1024, (g, w, h) => {
    // 旧木板：纵纹
    g.fillStyle = '#6a4a2c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = `rgba(35,20,8,${range(r, 0.1, 0.3)})`;
      g.lineWidth = range(r, 1, 3);
      const x = r() * w;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + range(r, -10, 10), h * 0.3, x + range(r, -10, 10), h * 0.7, x + range(r, -6, 6), h);
      g.stroke();
    }
    // 上半截刷白纸（贴上去的一张大白纸）
    g.fillStyle = PALETTE.PAPER;
    g.fillRect(30, 40, w - 60, h - 80);
    agePaper(g, w, h, 0.45, 516, 3);
    g.fillStyle = '#141414';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // 牌头（红底黑字的一条）
    g.fillStyle = '#9a1c1c';
    g.fillRect(60, 64, w - 120, 150);
    g.fillStyle = '#F3EEDC';
    g.font = `bold 108px ${SERIF_FONT_STACK}`;
    g.fillText(TEXT.decor.rulesHead, w / 2, 142);
    // 两行规矩按“　”拆成竖列：第一行一列、第二行三列（从右往左读）
    const cols = [...TEXT.rules.l1.split('　'), ...TEXT.rules.l2.split('　')].filter(s => s.length > 0);
    const colW = (w - 100) / cols.length;
    g.fillStyle = '#141414';
    const size = 50;
    g.font = `bold ${size}px ${HAND_FONT_STACK}`;
    cols.forEach((col, c) => {
      const cx = w - 50 - colW * (c + 0.5);
      [...col].forEach((ch, i) => {
        g.save();
        g.translate(cx + range(r, -2, 2), 280 + i * (size + 8));
        g.rotate(range(r, -0.05, 0.05));
        g.fillText(ch, 0, 0);
        g.restore();
      });
    });
    // 钉子
    g.fillStyle = '#2a2a2a';
    for (const [x, y] of [[44, 54], [w - 44, 54], [44, h - 54], [w - 44, h - 54]] as const) {
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** 蓝底白字的路牌（楼梯口“人民路地下通道”）。 */
export function streetSignTexture(main: string, sub: string): THREE.CanvasTexture {
  return paintTexture(1024, 256, (g, w, h) => {
    g.fillStyle = '#1f4f94';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e9eef5';
    g.lineWidth = 8;
    g.strokeRect(12, 12, w - 24, h - 24);
    g.fillStyle = '#f2f5fa';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold 104px ${FONT_STACK}`;
    g.fillText(main, w / 2, h * 0.42);
    g.font = `bold 44px ${FONT_STACK}`;
    g.fillText(sub, w / 2, h * 0.8);
    const r = rng(3);
    for (let i = 0; i < 8; i++) blotch(g, r, r() * w, r() * h, range(r, 10, 30), '#0d2446', 0.25, 5);
  });
}

/** 绿色“安全出口”灯箱（带跑动的小人）。 */
export function exitSignTexture(): THREE.CanvasTexture {
  return paintTexture(512, 192, (g, w, h) => {
    g.fillStyle = '#0f7a3c';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8fff0';
    g.fillRect(14, 14, h - 28, h - 28);
    // 小人（绿色，在白方块里往门口跑）
    g.fillStyle = '#0f7a3c';
    const ox = 14, oy = 14, s = (h - 28) / 100;
    g.beginPath();
    g.arc(ox + 58 * s, oy + 20 * s, 9 * s, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 11 * s;
    g.strokeStyle = '#0f7a3c';
    g.lineCap = 'round';
    const line = (pts: number[]) => {
      g.beginPath();
      g.moveTo(ox + (pts[0] ?? 0) * s, oy + (pts[1] ?? 0) * s);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(ox + (pts[i] ?? 0) * s, oy + (pts[i + 1] ?? 0) * s);
      g.stroke();
    };
    line([52, 34, 42, 60, 24, 84]);
    line([42, 60, 60, 72, 56, 92]);
    line([50, 40, 30, 46, 22, 58]);
    line([50, 40, 66, 50, 78, 44]);
    g.fillStyle = '#f2fff5';
    g.font = `bold 84px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(TEXT.decor.exitSign, h + (w - h) / 2 - 6, h / 2 + 4);
  });
}

/** 通用的小铁牌（消火栓、电表箱、施工牌……）：底色、字色、字。 */
export function plateTexture(text: string, bg: string, fg: string, o?: { w?: number; h?: number; size?: number; stripes?: boolean }): THREE.CanvasTexture {
  const W = o?.w ?? 512, H = o?.h ?? 128;
  const r = rng(text.length * 31 + 7);
  return paintTexture(W, H, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    if (o?.stripes) {
      g.fillStyle = '#141414';
      for (let x = -h; x < w; x += 48) {
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x + 24, h);
        g.lineTo(x + 24 + h * 0.4, h * 0.6);
        g.lineTo(x + h * 0.4, h * 0.6);
        g.fill();
      }
    }
    g.fillStyle = fg;
    g.font = `bold ${o?.size ?? Math.round(h * 0.5)}px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, o?.stripes ? h * 0.33 : h * 0.54);
    for (let i = 0; i < 6; i++) blotch(g, r, r() * w, r() * h, range(r, 6, 20), '#5a3a20', 0.22, 4);
  });
}

/**
 * 十盏摊位灯笼的贴图集（1024×512，5 列 × 2 行，每格一盏）：白纸、竹篾的竖纹、竖排的黑字；格子 i = STALLS[i]。
 * 灯笼 Lathe 的 u 绕一圈：字画在 u = 1/8、3/8、5/8、7/8 四面（沿通道走、站在摊前都看得见）。
 */
export function lanternAtlasTexture(): THREE.CanvasTexture {
  const r = rng(6060);
  const texts = TEXT.decor.lanterns;
  return paintTexture(1024, 512, (g, w, h) => {
    const cw = w / 5, ch = h / 2;
    texts.forEach((t, i) => {
      const x0 = (i % 5) * cw, y0 = Math.floor(i / 5) * ch;
      g.fillStyle = PALETTE.LANTERN;
      g.fillRect(x0, y0, cw, ch);
      // 纸的纤维 + 竹篾骨
      g.strokeStyle = 'rgba(140,120,80,0.35)';
      g.lineWidth = 2;
      for (let y = y0 + 10; y < y0 + ch; y += 22) {
        g.beginPath();
        g.moveTo(x0, y);
        g.lineTo(x0 + cw, y);
        g.stroke();
      }
      for (let k = 0; k < 30; k++) blotch(g, r, x0 + r() * cw, y0 + r() * ch, range(r, 2, 6), '#b8a57a', 0.15, 3);
      // 竖排字（格子中间 = 灯笼正面）
      const chars = [...t];
      const size = Math.min(46, (ch * 0.72) / chars.length);
      g.fillStyle = '#1b1712';
      g.font = `bold ${Math.round(size)}px ${SERIF_FONT_STACK}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const top = y0 + ch / 2 - (chars.length * size) / 2 + size / 2;
      for (const u of [0.125, 0.375, 0.625, 0.875]) chars.forEach((c, k) => g.fillText(c, x0 + cw * u, top + k * size));
      // 灯笼口的红纸边
      g.fillStyle = '#9e2a22';
      g.fillRect(x0, y0, cw, 10);
      g.fillRect(x0, y0 + ch - 10, cw, 10);
    });
  });
}

/**
 * 摊上货物的贴图集（1024×1024，4×4 格，每格 256²）：
 * 0 纸钱  1 元宝面  2 纸扎手机  3 收音机面板  4 磁带标签（邓丽君）  5 搪瓷缸（红字）  6 老照片 A  7 老照片 B
 * 8 寿衣纹样  9 铜钱  10 香烛盒  11 旧书封面  12 价签底  13 纸马  14 相框  15 纸扎电视
 */
export function goodsAtlasTexture(): THREE.CanvasTexture {
  const r = rng(8080);
  const GD = TEXT.decor.goods;
  return paintTexture(1024, 1024, (g, w) => {
    const c = w / 4;
    const cell = (i: number, fn: (x: number, y: number, s: number) => void) => {
      g.save();
      const x = (i % 4) * c, y = Math.floor(i / 4) * c;
      g.beginPath();
      g.rect(x, y, c, c);
      g.clip();
      fn(x, y, c);
      g.restore();
    };
    const txt = (s: string, x: number, y: number, size: number, color: string, font = FONT_STACK) => {
      g.fillStyle = color;
      g.font = `bold ${size}px ${font}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(s, x, y);
    };
    // 0 纸钱：黄纸 + 红印方章 + 打孔
    cell(0, (x, y, s) => {
      g.fillStyle = '#d9b64a';
      g.fillRect(x, y, s, s);
      for (let i = 0; i < 40; i++) blotch(g, r, x + r() * s, y + r() * s, 8, '#b8922e', 0.2, 3);
      g.strokeStyle = '#a3261d';
      g.lineWidth = 6;
      g.strokeRect(x + s * 0.3, y + s * 0.3, s * 0.4, s * 0.4);
      txt(GD.joss, x + s / 2, y + s / 2, 64, '#a3261d', SERIF_FONT_STACK);
      g.fillStyle = 'rgba(80,50,20,0.5)';
      for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) g.fillRect(x + 20 + i * 38, y + 20 + j * 200, 6, 6);
    });
    // 1 元宝面：金箔 + 红字
    cell(1, (x, y, s) => {
      const gr = g.createLinearGradient(x, y, x + s, y + s);
      gr.addColorStop(0, '#f2d27a');
      gr.addColorStop(0.5, '#c9962e');
      gr.addColorStop(1, '#f6e0a0');
      g.fillStyle = gr;
      g.fillRect(x, y, s, s);
      txt(GD.ingot, x + s / 2, y + s / 2, 72, '#a01e18', SERIF_FONT_STACK);
    });
    // 2 纸扎手机：黑边、屏幕、键盘
    cell(2, (x, y, s) => {
      g.fillStyle = '#e8e2d2';
      g.fillRect(x, y, s, s);
      g.fillStyle = '#1b1b1f';
      g.fillRect(x + 50, y + 10, s - 100, s - 20);
      g.fillStyle = '#6fa8c8';
      g.fillRect(x + 64, y + 30, s - 128, 90);
      txt(GD.phone, x + s / 2, y + 75, 30, '#f7f2e0');
      g.fillStyle = '#d8d0bc';
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) g.fillRect(x + 72 + j * 40, y + 138 + i * 26, 30, 18);
    });
    // 3 收音机面板：木纹、喇叭网、刻度盘
    cell(3, (x, y, s) => {
      g.fillStyle = '#6a4424';
      g.fillRect(x, y, s, s);
      g.fillStyle = '#c9b88c';
      g.fillRect(x + 16, y + 30, s * 0.55, s - 60);
      g.strokeStyle = '#5a4a2a';
      g.lineWidth = 2;
      for (let i = 0; i < 18; i++) {
        g.beginPath();
        g.moveTo(x + 16, y + 34 + i * 11);
        g.lineTo(x + 16 + s * 0.55, y + 34 + i * 11);
        g.stroke();
      }
      g.fillStyle = '#e8dcae';
      g.fillRect(x + s * 0.64, y + 40, s * 0.3, 60);
      g.strokeStyle = '#8a1a14';
      g.beginPath();
      g.moveTo(x + s * 0.7, y + 44);
      g.lineTo(x + s * 0.7, y + 96);
      g.stroke();
      txt(GD.radio, x + s * 0.79, y + 140, 30, '#e8dcae');
      g.fillStyle = '#2a2018';
      g.beginPath();
      g.arc(x + s * 0.79, y + 196, 22, 0, Math.PI * 2);
      g.fill();
    });
    // 4 磁带标签
    cell(4, (x, y, s) => {
      g.fillStyle = '#e9e4d2';
      g.fillRect(x, y, s, s);
      g.fillStyle = '#c8412e';
      g.fillRect(x, y + s * 0.12, s, s * 0.22);
      txt(GD.tapeSinger, x + s / 2, y + s * 0.23, 44, '#fff7e8');
      txt(GD.tapeTitle, x + s / 2, y + s * 0.5, 36, '#2a2a2a');
      g.fillStyle = '#2a2a2a';
      g.fillRect(x + 40, y + s * 0.66, s - 80, 40);
      g.fillStyle = '#e9e4d2';
      g.beginPath();
      g.arc(x + 80, y + s * 0.66 + 20, 14, 0, Math.PI * 2);
      g.arc(x + s - 80, y + s * 0.66 + 20, 14, 0, Math.PI * 2);
      g.fill();
    });
    // 5 搪瓷缸：白底、红字、掉瓷的黑点
    cell(5, (x, y, s) => {
      g.fillStyle = '#ece8dc';
      g.fillRect(x, y, s, s);
      g.fillStyle = '#2b4f8a';
      g.fillRect(x, y, s, 14);
      txt(GD.mug, x + s / 2, y + s * 0.45, 96, '#b8261c', SERIF_FONT_STACK);
      txt(GD.mugSub, x + s / 2, y + s * 0.78, 28, '#b8261c');
      for (let i = 0; i < 8; i++) blotch(g, r, x + r() * s, y + r() * s, range(r, 4, 10), '#1a1a1a', 0.7, 3);
    });
    // 6、7 老照片（泛黄的合影/半身像，纯剪影）
    for (const [i, kind] of [[6, 0], [7, 1]] as const) {
      cell(i, (x, y, s) => {
        g.fillStyle = '#efe6cf';
        g.fillRect(x, y, s, s);
        g.fillStyle = '#8b7652';
        g.fillRect(x + 18, y + 18, s - 36, s - 36);
        g.fillStyle = '#3f3324';
        if (kind === 0) {
          for (let k = 0; k < 5; k++) {
            const px = x + 50 + k * 38, py = y + 150;
            g.beginPath();
            g.arc(px, py - 40, 13, 0, Math.PI * 2);
            g.fill();
            g.fillRect(px - 14, py - 28, 28, 60);
          }
        } else {
          g.beginPath();
          g.arc(x + s / 2, y + 100, 38, 0, Math.PI * 2);
          g.fill();
          g.fillRect(x + s / 2 - 60, y + 140, 120, 100);
        }
        agePaper(g, s, s, 0.3, 90 + i, 1);
      });
    }
    // 8 寿衣纹样：藏青底金色团寿
    cell(8, (x, y, s) => {
      g.fillStyle = '#23305a';
      g.fillRect(x, y, s, s);
      g.strokeStyle = '#d6b24c';
      g.lineWidth = 3;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        g.beginPath();
        g.arc(x + 42 + i * 86, y + 42 + j * 86, 26, 0, Math.PI * 2);
        g.stroke();
        txt(GD.shroud, x + 42 + i * 86, y + 43 + j * 86, 26, '#d6b24c', SERIF_FONT_STACK);
      }
    });
    // 9 铜钱：黄铜色圆 + 方孔 + 字
    cell(9, (x, y, s) => {
      g.fillStyle = '#3a2a1a';
      g.fillRect(x, y, s, s);
      g.fillStyle = '#9c7a36';
      g.beginPath();
      g.arc(x + s / 2, y + s / 2, s * 0.46, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#3a2a1a';
      g.fillRect(x + s / 2 - 22, y + s / 2 - 22, 44, 44);
      const offs = [[0, -70], [0, 70], [70, 0], [-70, 0]] as const;
      GD.coin.forEach((ch, k) => txt(ch, x + s / 2 + (offs[k]?.[0] ?? 0), y + s / 2 + (offs[k]?.[1] ?? 0), 44, '#5a3e18', SERIF_FONT_STACK));
    });
    // 10 香烛盒：红纸金字
    cell(10, (x, y, s) => {
      g.fillStyle = '#9e1f1a';
      g.fillRect(x, y, s, s);
      txt(GD.incense, x + s / 2, y + s * 0.35, 90, '#e8c35a', SERIF_FONT_STACK);
      txt(GD.incenseSub, x + s / 2, y + s * 0.75, 34, '#e8c35a');
    });
    // 11 旧书封面：蓝布面、白签条竖写
    cell(11, (x, y, s) => {
      g.fillStyle = '#2c3a52';
      g.fillRect(x, y, s, s);
      g.fillStyle = '#e8e0c8';
      g.fillRect(x + s * 0.6, y + 20, 50, s - 40);
      g.fillStyle = '#1b1b1b';
      g.font = `bold 32px ${SERIF_FONT_STACK}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      [...GD.book].forEach((ch, k) => g.fillText(ch, x + s * 0.6 + 25, y + 60 + k * 44));
      for (let i = 0; i < 12; i++) blotch(g, r, x + r() * s, y + r() * s, range(r, 6, 18), '#1a2030', 0.35, 4);
    });
    // 12 价签底（白卡纸 + 红框），字在单独的贴花上
    cell(12, (x, y, s) => {
      g.fillStyle = '#efe9d8';
      g.fillRect(x, y, s, s);
      g.strokeStyle = '#a3261d';
      g.lineWidth = 8;
      g.strokeRect(x + 10, y + 10, s - 20, s - 20);
    });
    // 13 纸马：白纸 + 黑鬃 + 红缨
    cell(13, (x, y, s) => {
      g.fillStyle = '#efe8d6';
      g.fillRect(x, y, s, s);
      g.fillStyle = '#1b1b1b';
      for (let i = 0; i < 16; i++) g.fillRect(x + 20 + i * 14, y + 20, 6, 50);
      g.fillStyle = '#b8261c';
      g.fillRect(x, y + 100, s, 20);
      g.fillStyle = '#d6b24c';
      g.fillRect(x, y + 124, s, 8);
    });
    // 14 相框（黑框、白卡纸）
    cell(14, (x, y, s) => {
      g.fillStyle = '#141414';
      g.fillRect(x, y, s, s);
      g.fillStyle = '#e8e2d0';
      g.fillRect(x + 22, y + 22, s - 44, s - 44);
      g.fillStyle = '#6a5a44';
      g.beginPath();
      g.arc(x + s / 2, y + 100, 34, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x + s / 2 - 52, y + 138, 104, 96);
    });
    // 15 纸扎电视（彩电屏幕）
    cell(15, (x, y, s) => {
      g.fillStyle = '#5a4030';
      g.fillRect(x, y, s, s);
      const gr = g.createLinearGradient(x, y, x + s, y + s);
      gr.addColorStop(0, '#6ab0c8');
      gr.addColorStop(1, '#c86a8a');
      g.fillStyle = gr;
      g.fillRect(x + 24, y + 24, s * 0.7, s * 0.62);
      txt(GD.tv, x + s * 0.88, y + s * 0.3, 24, '#e8dcae');
    });
  });
}

/** 价签字（透明底，贴在价签卡上）：一张贴图十格，格子 i 对应 TEXT.decor.tags[i]。 */
export function tagsTexture(): THREE.CanvasTexture {
  return paintTexture(1024, 256, (g, w, h) => {
    const cw = w / 5, ch = h / 2;
    const r = rng(12);
    TEXT.decor.tags.forEach((t, i) => {
      const x0 = (i % 5) * cw, y0 = Math.floor(i / 5) * ch;
      g.fillStyle = '#efe9d8';
      g.fillRect(x0 + 4, y0 + 4, cw - 8, ch - 8);
      g.strokeStyle = '#a3261d';
      g.lineWidth = 5;
      g.strokeRect(x0 + 8, y0 + 8, cw - 16, ch - 16);
      g.fillStyle = '#1b1712';
      const size = Math.min(44, (cw - 30) / Math.max(1, [...t].length));
      g.font = `bold ${Math.round(size)}px ${HAND_FONT_STACK}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(t, x0 + cw / 2, y0 + ch / 2 + 2);
      agePaper(g, w, h, 0.05, 20 + i, 0);
      blotch(g, r, x0 + r() * cw, y0 + r() * ch, 10, '#a08a5a', 0.15, 3);
    });
  });
}

/** 纸钱（圆形方孔，alpha 在通道里）：撒纸钱的粒子与满地的纸钱用。 */
export function jossCoinTexture(): THREE.CanvasTexture {
  return paintTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#e6dcc0';
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.46, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.fillRect(w / 2 - 14, h / 2 - 14, 28, 28);
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(150,120,70,0.6)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2);
    g.stroke();
  });
}

/** 飘着的影子：人形剪影的遮罩（alpha → 灰度，给 alphaMap 用，AGENTS.md：alphaMap 读绿通道）。 */
export function shadowMaskTexture(): THREE.CanvasTexture {
  return paintTexture(128, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h * 0.5, 10, w / 2, h * 0.5, h * 0.55);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    // 头、肩、往下散开成烟
    g.beginPath();
    g.ellipse(w / 2, h * 0.14, w * 0.16, h * 0.075, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(w * 0.18, h * 0.3);
    g.quadraticCurveTo(w * 0.5, h * 0.2, w * 0.82, h * 0.3);
    g.quadraticCurveTo(w * 0.9, h * 0.62, w * 0.62, h * 0.98);
    g.quadraticCurveTo(w * 0.5, h * 0.86, w * 0.38, h * 0.98);
    g.quadraticCurveTo(w * 0.1, h * 0.62, w * 0.18, h * 0.3);
    g.fill();
  }, { mask: true });
}

/** 墙上的水渍/霉斑贴花（透明底）。 */
export function stainDecalTexture(seed: number): THREE.CanvasTexture {
  const r = rng(seed);
  return paintTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 5; i++) blotch(g, r, w * range(r, 0.3, 0.7), h * range(r, 0.2, 0.9), range(r, 30, 80), '#2e3a2c', 0.22, 7);
    g.strokeStyle = 'rgba(40,50,38,0.35)';
    g.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const x = w * range(r, 0.2, 0.8);
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + range(r, -8, 8), h * range(r, 0.4, 1));
      g.stroke();
    }
  });
}

/** 旧书残页（摊上摊开的一页，竖排小字：doc.old_book 原文的前一截）。 */
export function oldBookPageTexture(): THREE.CanvasTexture {
  return paintTexture(512, 384, (g, w, h) => {
    g.fillStyle = '#d8ccaa';
    g.fillRect(0, 0, w, h);
    agePaper(g, w, h, 0.8, 4242, 3);
    g.fillStyle = '#231c14';
    g.font = `22px ${SERIF_FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const text = TEXT.oldBook.replace(/[……“”]/g, '');
    const perCol = 14;
    const cols = Math.ceil(text.length / perCol);
    for (let c = 0; c < cols && c < 18; c++) {
      const col = [...text].slice(c * perCol, (c + 1) * perCol);
      col.forEach((ch, i) => g.fillText(ch, w - 24 - c * 26, 26 + i * 24));
    }
    g.strokeStyle = 'rgba(80,50,20,0.5)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(w / 2, 0);
    g.lineTo(w / 2, h);
    g.stroke();
  });
}

/** 小广告（白纸黑字，偶尔红字）：wrapText 排版。 */
export function adSheetTexture(lines: readonly string[], seed: number): THREE.CanvasTexture {
  const r = rng(seed);
  return paintTexture(256, 384, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = pick(r, ['#ece8da', '#f2eee0', '#e6e0cc']);
    g.fillRect(8, 8, w - 16, h - 16);
    g.font = `bold 40px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let y = 60;
    for (const l of lines) {
      g.fillStyle = r() < 0.3 ? '#b8261c' : '#161616';
      for (const part of wrapText(g, l, w - 40)) {
        g.fillText(part, w / 2, y);
        y += 52;
      }
    }
    g.font = `24px ${FONT_STACK}`;
    g.fillStyle = '#161616';
    g.fillText(`1${Math.floor(range(r, 3000000000, 9999999999))}`.slice(0, 11), w / 2, h - 40);
    agePaper(g, w, h, 0.5, seed, 2);
  });
}

/** 摊子后墙上挂的布幔（深靛布 + 竖褶 + 顶上一道红布沿），给纸人衬个暗底。 */
export function backdropTexture(): THREE.CanvasTexture {
  const r = rng(2323);
  return paintTexture(256, 512, (g, w, h) => {
    g.fillStyle = '#1b1c2a';
    g.fillRect(0, 0, w, h);
    // 竖褶：明暗条
    for (let x = 0; x < w; x += 16) {
      const grd = g.createLinearGradient(x, 0, x + 16, 0);
      grd.addColorStop(0, 'rgba(0,0,0,0.35)');
      grd.addColorStop(0.5, 'rgba(90,95,130,0.18)');
      grd.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = grd;
      g.fillRect(x, 0, 16, h);
    }
    // 顶上的红布沿（波浪边）+ 金线
    g.fillStyle = '#7a1a1c';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w, 0);
    g.lineTo(w, 58);
    for (let x = w; x >= 0; x -= 32) g.quadraticCurveTo(x - 16, 86, x - 32, 58);
    g.closePath();
    g.fill();
    g.fillStyle = '#c9a24a';
    g.fillRect(0, 40, w, 4);
    // 旧布的霉点与褪色
    for (let i = 0; i < 18; i++) blotch(g, r, r() * w, range(r, 0.2, 1) * h, range(r, 8, 30), '#3a3a4a', 0.25, 5);
    const fade = g.createLinearGradient(0, h, 0, h * 0.6);
    fade.addColorStop(0, 'rgba(60,55,40,0.4)');
    fade.addColorStop(1, 'rgba(60,55,40,0)');
    g.fillStyle = fade;
    g.fillRect(0, h * 0.6, w, h * 0.4);
  });
}

/** 桌沿挂的一排红纸“挂钱”（镂空的回纹与铜钱纹，透明底，给 alphaTest 用）。 */
export function paperCutTexture(): THREE.CanvasTexture {
  return paintTexture(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const n = 5;
    const pw = w / n;
    for (let i = 0; i < n; i++) {
      const x0 = i * pw + 6;
      g.fillStyle = '#b8201c';
      // 每张挂钱：上面一道横条，下面是流苏状的锯齿
      g.fillRect(x0, 0, pw - 12, h * 0.72);
      g.beginPath();
      for (let k = 0; k <= 8; k++) {
        const x = x0 + ((pw - 12) * k) / 8;
        g.lineTo(x, h * 0.72 + (k % 2 ? 16 : 0));
      }
      g.lineTo(x0 + pw - 12, h * 0.72);
      g.fill();
      // 镂空：外框回纹 + 中间一枚铜钱
      g.globalCompositeOperation = 'destination-out';
      g.fillRect(x0 + 8, 8, pw - 28, 5);
      g.fillRect(x0 + 8, h * 0.62, pw - 28, 5);
      const cx = x0 + (pw - 12) / 2, cy = h * 0.38;
      g.beginPath();
      g.arc(cx, cy, 22, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#b8201c';
      g.beginPath();
      g.arc(cx, cy, 16, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.fillRect(cx - 6, cy - 6, 12, 12);
      for (let k = 0; k < 4; k++) g.fillRect(x0 + 10 + k * ((pw - 32) / 4), h * 0.5, 8, 8);
      g.globalCompositeOperation = 'source-over';
    }
  });
}

/** 墙上的 IC 卡公用电话：机身正面（256×384：绿屏、12 个键、插卡口、贴着的“话费”小条）与电话罩顶上的字条（512×96）。 */
export function payphoneFaceTexture(): THREE.CanvasTexture {
  const r = rng(1995);
  return paintTexture(256, 384, (g, w, h) => {
    g.fillStyle = '#5d6468';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#3a3f42';
    g.fillRect(12, 12, w - 24, h - 24);
    // 绿屏
    g.fillStyle = '#1d3a2a';
    g.fillRect(40, 36, w - 80, 56);
    g.fillStyle = '#7cffb2';
    g.globalAlpha = 0.55;
    g.font = `bold 30px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(TEXT.decor.phone.screen, w / 2, 64);
    g.globalAlpha = 1;
    // 键
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 3; col++) {
        const x = 56 + col * 52, y = 124 + row * 46;
        g.fillStyle = '#c9c7bd';
        g.fillRect(x, y, 40, 32);
        g.fillStyle = '#1a1a1a';
        g.font = `bold 22px ${FONT_STACK}`;
        g.fillText(['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'][row * 3 + col] ?? '', x + 20, y + 17);
      }
    }
    // 插卡口
    g.fillStyle = '#111';
    g.fillRect(70, 322, 116, 10);
    g.fillStyle = '#d8d2bf';
    g.font = `16px ${FONT_STACK}`;
    g.fillText(TEXT.decor.phone.slot, w / 2, 350);
    for (let i = 0; i < 8; i++) blotch(g, r, r() * w, r() * h, range(r, 6, 18), '#2a2622', 0.25, 4);
  });
}

export function payphoneSignTexture(text: string): THREE.CanvasTexture {
  return paintTexture(512, 96, (g, w, h) => {
    g.fillStyle = '#e0762a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1f4f9e';
    g.fillRect(0, h - 16, w, 16);
    g.fillStyle = '#ffffff';
    g.font = `bold ${Math.round(h * 0.56)}px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h * 0.44);
    const r = rng(64);
    for (let i = 0; i < 6; i++) blotch(g, r, r() * w, r() * h, range(r, 8, 22), '#5a3a20', 0.2, 4);
  });
}

/** 白纸幡（64×256，透明底，alphaTest 用）：一条白纸，镂空铜钱纹与菱形，底下剪成穗子。 */
export function streamerTexture(): THREE.CanvasTexture {
  const r = rng(8181);
  return paintTexture(64, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = PALETTE.PAPER;
    g.fillRect(4, 0, w - 8, h * 0.78);
    // 穗子：竖着剪开的细条
    for (let x = 6; x < w - 6; x += 7) g.fillRect(x, h * 0.78, 4, h * range(r, 0.14, 0.21));
    // 纸的纤维与水渍
    for (let i = 0; i < 12; i++) blotch(g, r, r() * w, r() * h * 0.78, range(r, 3, 9), '#b9ad90', 0.25, 3);
    g.globalCompositeOperation = 'destination-out';
    // 镂空：两枚铜钱（外圆 + 方孔留纸）、中间一串菱形
    for (const cy of [h * 0.16, h * 0.62]) {
      g.beginPath();
      g.arc(w / 2, cy, 14, 0, Math.PI * 2);
      g.fill();
    }
    for (let k = 0; k < 4; k++) {
      const cy = h * 0.3 + k * 18;
      g.beginPath();
      g.moveTo(w / 2, cy - 7);
      g.lineTo(w / 2 + 7, cy);
      g.lineTo(w / 2, cy + 7);
      g.lineTo(w / 2 - 7, cy);
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = PALETTE.PAPER;
    for (const cy of [h * 0.16, h * 0.62]) {
      g.beginPath();
      g.arc(w / 2, cy, 9, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'destination-out';
    for (const cy of [h * 0.16, h * 0.62]) g.fillRect(w / 2 - 3.5, cy - 3.5, 7, 7);
    g.globalCompositeOperation = 'source-over';
  });
}

/** 鬼市口横挂的白布幡（两面同字）：大字“鬼　市”，底下一行“丑时开　卯时散”（摘自鬼市规矩），红边、下沿剪成穗。 */
export function marketBannerTexture(): THREE.CanvasTexture {
  const r = rng(4242);
  return paintTexture(1024, 384, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const body = h * 0.8;
    g.fillStyle = PALETTE.PAPER;
    g.fillRect(0, 0, w, body);
    // 下沿剪成一排穗子
    for (let x = 4; x < w - 4; x += 16) g.fillRect(x, body - 2, 10, h * range(r, 0.1, 0.18));
    agePaper(g, w, body, 0.5, 4243, 0);
    for (let i = 0; i < 40; i++) blotch(g, r, r() * w, r() * body, range(r, 4, 14), '#b3a482', 0.18, 4);
    // 红边
    g.strokeStyle = '#8f231c';
    g.lineWidth = 14;
    g.strokeRect(16, 16, w - 32, body - 32);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#16120e';
    g.font = `bold ${Math.round(body * 0.5)}px ${SERIF_FONT_STACK}`;
    g.fillText(TEXT.decor.rulesHead, w / 2, body * 0.42);
    g.fillStyle = '#7a1d17';
    g.font = `bold ${Math.round(body * 0.13)}px ${SERIF_FONT_STACK}`;
    g.fillText(TEXT.decor.bannerSub, w / 2, body * 0.8);
  });
}

/** 围挡上沿漏出来的一线工地灯光：上亮下暗的竖向渐变，横向几段忽明忽暗（围挡板缝）。 */
export function leakGlowTexture(): THREE.CanvasTexture {
  const r = rng(6161);
  return paintTexture(256, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) {
      const a = range(r, 0.55, 1);
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, `rgba(255,255,255,${a})`);
      grd.addColorStop(0.45, `rgba(255,255,255,${a * 0.35})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(x, 0, 8, h);
    }
  });
}

/** 纸花圈（透明底）：外圈绿纸叶，一圈红黄粉白紫的纸花，正中白纸圆心写一个“奠”。 */
export function wreathTexture(): THREE.CanvasTexture {
  const r = rng(5151);
  return paintTexture(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = w * 0.48;
    // 叶子
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + range(r, -0.05, 0.05);
      const rr = R * range(r, 0.86, 0.95);
      g.save();
      g.translate(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      g.rotate(a + Math.PI / 2);
      g.fillStyle = pick(r, ['#2f6b3c', '#3d7d49', '#285a33']);
      g.beginPath();
      g.ellipse(0, 0, R * 0.07, R * 0.15, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    // 纸花：一圈两层
    const colors = ['#e8e3d4', '#e8e3d4', '#d9b93c', '#c83a4a', '#e07fa0', '#8a5cc0', '#e8e3d4'];
    for (const [ring, n, size] of [[0.78, 22, 0.11], [0.6, 18, 0.1]] as const) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring;
        const x = cx + Math.cos(a) * R * ring, y = cy + Math.sin(a) * R * ring;
        const c = pick(r, colors);
        const s = R * size * range(r, 0.85, 1.15);
        for (let k = 0; k < 6; k++) {
          const b = (k / 6) * Math.PI * 2 + range(r, 0, 1);
          g.fillStyle = c;
          g.beginPath();
          g.arc(x + Math.cos(b) * s * 0.45, y + Math.sin(b) * s * 0.45, s * 0.55, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.beginPath();
        g.arc(x, y, s * 0.3, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(255,250,235,0.8)';
        g.beginPath();
        g.arc(x - s * 0.1, y - s * 0.1, s * 0.16, 0, Math.PI * 2);
        g.fill();
      }
    }
    // 圆心
    g.fillStyle = '#efeadb';
    g.beginPath();
    g.arc(cx, cy, R * 0.44, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#1a1714';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx, cy, R * 0.38, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#141210';
    g.font = `bold ${Math.round(R * 0.5)}px ${SERIF_FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(TEXT.decor.wreath, cx, cy + R * 0.03);
  });
}

/** 小灯笼串的纸面（竹篾横纹 + 上下红口），给实例化小灯笼当 map。 */
export function smallLanternTexture(): THREE.CanvasTexture {
  return paintTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#f5f1e4';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(150,130,90,0.45)';
    for (let y = 6; y < h; y += 8) g.fillRect(0, y, w, 1);
    // 灯笼口是黑漆竹圈（从底下仰看时是一圈黑边，不是一只红眼珠），贴着一道细红纸边
    g.fillStyle = '#1d1a17';
    g.fillRect(0, 0, w, 6);
    g.fillRect(0, h - 6, w, 6);
    g.fillStyle = '#8f2a21';
    g.fillRect(0, 6, w, 2);
    g.fillRect(0, h - 8, w, 2);
  });
}

/** 圆形柔光（alpha → 灰度的遮罩，给 alphaMap 用）：灯笼在地上、墙上投的一团光。 */
export function radialGlowMask(): THREE.CanvasTexture {
  return paintTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }, { mask: true });
}

/** 贴地的薄雾（alpha → 灰度的遮罩，可平铺）：几团软的噪声。 */
export function mistMask(): THREE.CanvasTexture {
  const r = rng(777);
  const t = paintTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    // 稀疏的几团（团与团之间留空，才看得出是一团团贴地的雾，不是一整片）
    for (let i = 0; i < 26; i++) {
      const x = r() * w, y = r() * h, s = range(r, 22, 58);
      const a = range(r, 0.18, 0.5);
      for (const [dx, dy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]] as const) {
        const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, s);
        grd.addColorStop(0, `rgba(255,255,255,${a})`);
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.fillRect(x + dx - s, y + dy - s, s * 2, s * 2);
      }
    }
  }, { mask: true });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
