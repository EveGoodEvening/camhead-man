// owner: R1-finale
// 终章用到的全部程序化贴图（CanvasTexture）：遗像（炭精画，补脸前后两版）与红外铅笔底稿、照妖镜最深处（空椅子 / 抬头的老周）
// 与预制 8 层嵌套、粉笔叉、馄饨碗、袖子、片尾照片卡、尾声与南柯布景（晨雾天穹、土地、树墩年轮、matcap）。
// 只画不存：返回的贴图由调用方经 ctx.track / ctx.add 追踪释放（ARCH §11.5 第 8 条）。

import * as THREE from 'three';
import { PALETTE } from '../../../data/palette';
import { FONT_STACK } from '../../../kit/text';
import { paintTexture } from '../../../kit/canvas';
import { rng, range } from '../../../kit/rng';

type G = CanvasRenderingContext2D;

// ==================================================================== 小工具

function ellipse(g: G, x: number, y: number, rx: number, ry: number, rot = 0): void {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
}

/** 炭笔/铅笔的一笔：沿折线画若干条略抖的细线叠出笔触。 */
function stroke(g: G, pts: readonly (readonly [number, number])[], o: { color: string; width: number; jitter?: number; passes?: number; seed?: number }): void {
  const r = rng(o.seed ?? 7);
  const passes = o.passes ?? 3;
  const j = o.jitter ?? 1.2;
  g.save();
  g.strokeStyle = o.color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let p = 0; p < passes; p++) {
    g.lineWidth = o.width * range(r, 0.55, 1.05);
    g.globalAlpha = range(r, 0.35, 0.8);
    g.beginPath();
    pts.forEach(([x, y], i) => {
      const dx = range(r, -j, j), dy = range(r, -j, j);
      if (i === 0) g.moveTo(x + dx, y + dy);
      else g.lineTo(x + dx, y + dy);
    });
    g.stroke();
  }
  g.restore();
}

/** 纸面颗粒 + 轻微做旧。 */
function paperGrain(g: G, w: number, h: number, seed: number, amount: number): void {
  const r = rng(seed);
  for (let i = 0; i < (w * h) / 60; i++) {
    const v = Math.floor(range(r, 0, 255));
    g.fillStyle = `rgba(${v},${v},${v},${amount * range(r, 0.2, 1)})`;
    g.fillRect(range(r, 0, w), range(r, 0, h), range(r, 0.6, 1.8), range(r, 0.6, 1.8));
  }
}

/**
 * 扫描线 + 磷绿单色化（给“屏幕里的画面”用）。
 * getImageData/putImageData 不受 translate 与 clip 影响：片尾卡片 paintCard 先 translate(PIC.x, PIC.y) 再画画面，
 * 所以按当前变换的平移取读写的原点（M4：不然读写的是画布原点那一块，卡片上沿、左沿的白纸边被染成一条 L 形绿带）。
 */
function crtize(g: G, w: number, h: number, tint: [number, number, number], lines = 3): void {
  const m = g.getTransform();
  const ox = Math.round(m.e), oy = Math.round(m.f);
  const img = g.getImageData(ox, oy, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const sl = y % lines === 0 ? 0.72 : 1;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = (0.3 * d[i]! + 0.59 * d[i + 1]! + 0.11 * d[i + 2]!) / 255;
      d[i] = Math.min(255, l * tint[0] * sl);
      d[i + 1] = Math.min(255, l * tint[1] * sl);
      d[i + 2] = Math.min(255, l * tint[2] * sl);
    }
  }
  g.putImageData(img, ox, oy);
}

// ==================================================================== 老周的脸（遗像补脸、录像带、片尾、照妖镜共用一个画法）

export interface FaceStyle {
  ink: string;          // 线条色
  skin: string | null;  // 填色（null = 只画线）
  shade: string;        // 暗部
  light?: string;       // 高光（CRT/魂影）
  weight: number;       // 线宽倍率
  seed: number;
  /** 仰头（03:14 抬头看镜头） */
  lookUp?: boolean;
  /** 戴帽 */
  cap?: boolean;
}

/**
 * 以 (cx, cy) 为脸心、s 为脸高（下巴到发际线）画一张 63 岁老头的脸：短灰发、招风耳、抬头纹、眼袋、法令纹、胡茬。
 * lookUp：抬头看镜头（下巴收窄、眼珠朝上、眉毛挑起）。
 */
export function paintZhouFace(g: G, cx: number, cy: number, s: number, st: FaceStyle): void {
  const r = rng(st.seed);
  const w = s * 0.74;
  const lw = Math.max(1, s * 0.012 * st.weight);
  const up = st.lookUp ? 1 : 0;
  g.save();
  // 头形与耳朵
  if (st.skin) {
    g.fillStyle = st.skin;
    ellipse(g, cx, cy, w / 2, s * 0.56);
    g.fill();
    ellipse(g, cx - w * 0.52, cy + s * 0.02 - up * s * 0.04, s * 0.07, s * 0.13);
    g.fill();
    ellipse(g, cx + w * 0.52, cy + s * 0.02 - up * s * 0.04, s * 0.07, s * 0.13);
    g.fill();
    // 暗部：两腮与下巴
    const sh = g.createRadialGradient(cx, cy - s * 0.18, s * 0.1, cx, cy + s * 0.1, s * 0.62);
    sh.addColorStop(0, 'rgba(0,0,0,0)');
    sh.addColorStop(1, st.shade);
    g.fillStyle = sh;
    ellipse(g, cx, cy, w / 2, s * 0.56);
    g.fill();
    if (st.light) {
      const hl = g.createRadialGradient(cx - w * 0.1, cy - s * 0.2, 1, cx - w * 0.1, cy - s * 0.2, s * 0.35);
      hl.addColorStop(0, st.light);
      hl.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = hl;
      ellipse(g, cx, cy, w / 2, s * 0.56);
      g.fill();
    }
  }
  const ink = st.ink;
  // 轮廓：宽颧骨、方下巴
  stroke(g, [
    [cx - w * 0.5, cy - s * 0.25], [cx - w * 0.52, cy + s * 0.05], [cx - w * 0.42, cy + s * 0.32], [cx - w * 0.22, cy + s * 0.5 - up * s * 0.03],
    [cx, cy + s * 0.55 - up * s * 0.04], [cx + w * 0.22, cy + s * 0.5 - up * s * 0.03], [cx + w * 0.42, cy + s * 0.32], [cx + w * 0.52, cy + s * 0.05], [cx + w * 0.5, cy - s * 0.25],
  ], { color: ink, width: lw * 1.6, seed: st.seed + 1 });
  // 耳朵
  for (const side of [-1, 1]) {
    const ex = cx + side * w * 0.52;
    const ey = cy + s * 0.02 - up * s * 0.04;
    stroke(g, [[ex, ey - s * 0.12], [ex + side * s * 0.07, ey - s * 0.08], [ex + side * s * 0.07, ey + s * 0.06], [ex, ey + s * 0.12]], { color: ink, width: lw, seed: st.seed + 2 + side });
  }
  // 头发（短、灰）或帽子
  if (st.cap) {
    g.fillStyle = st.skin ? '#2E3A55' : ink;
    g.globalAlpha = st.skin ? 1 : 0.5;
    g.beginPath();
    g.moveTo(cx - w * 0.56, cy - s * 0.26);
    g.quadraticCurveTo(cx, cy - s * 0.78, cx + w * 0.56, cy - s * 0.26);
    g.lineTo(cx + w * 0.7, cy - s * 0.2);
    g.lineTo(cx - w * 0.7, cy - s * 0.2);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
  } else {
    for (let i = 0; i < 70; i++) {
      const a = range(r, Math.PI * 1.05, Math.PI * 1.95);
      const rr = range(r, 0.44, 0.56);
      const x0 = cx + Math.cos(a) * w * rr;
      const y0 = cy - s * 0.12 + Math.sin(a) * s * 0.5 * rr;
      stroke(g, [[x0, y0], [x0 + range(r, -3, 3), y0 - range(r, 3, 9) * s / 200]], { color: ink, width: lw * 0.8, passes: 1, jitter: 0.5, seed: st.seed + 10 + i });
    }
  }
  // 抬头纹（仰头时挤成更深的三道）
  for (let i = 0; i < 3; i++) {
    const yy = cy - s * (0.3 - i * 0.055) + up * s * 0.03;
    stroke(g, [[cx - w * 0.28, yy + s * 0.01], [cx, yy - s * 0.012 * (1 + up)], [cx + w * 0.28, yy + s * 0.01]], { color: ink, width: lw * 0.7, passes: 2, seed: st.seed + 20 + i });
  }
  // 眉毛：粗、有点乱，抬头时挑起
  for (const side of [-1, 1]) {
    const bx = cx + side * w * 0.2;
    const by = cy - s * 0.12 - up * s * 0.04;
    stroke(g, [[bx - side * w * 0.14, by + s * 0.02], [bx, by - s * 0.015], [bx + side * w * 0.12, by + s * 0.01]], { color: ink, width: lw * 2.2, passes: 4, seed: st.seed + 30 + side });
  }
  // 眼睛：睁着（“这回我睁着眼”）、眼袋；抬头时眼珠往上看，贴着上眼睑（M4 第 2 轮：原来是眯着的细长眼，像在笑）
  for (const side of [-1, 1]) {
    const ex = cx + side * w * 0.2;
    const ey = cy - s * 0.04;
    stroke(g, [[ex - w * 0.11, ey + s * 0.004], [ex - w * 0.04, ey - s * 0.034], [ex + w * 0.04, ey - s * 0.036], [ex + w * 0.11, ey + s * 0.002]], { color: ink, width: lw * 1.3, seed: st.seed + 40 + side });
    stroke(g, [[ex - w * 0.09, ey + s * 0.016], [ex, ey + s * 0.024], [ex + w * 0.09, ey + s * 0.014]], { color: ink, width: lw * 0.7, passes: 2, seed: st.seed + 42 + side });
    g.fillStyle = ink;
    g.globalAlpha = 0.85;
    ellipse(g, ex + side * w * 0.008, ey - s * (0.006 + up * 0.012), s * 0.02, s * 0.019);
    g.fill();
    g.globalAlpha = 1;
    if (st.light) {
      g.fillStyle = st.light;
      ellipse(g, ex + side * w * 0.01 - s * 0.006, ey - s * (0.01 + up * 0.012), s * 0.005, s * 0.005);
      g.fill();
    }
    // 眼袋
    stroke(g, [[ex - w * 0.08, ey + s * 0.05], [ex, ey + s * 0.065], [ex + w * 0.08, ey + s * 0.05]], { color: ink, width: lw * 0.6, passes: 2, seed: st.seed + 44 + side });
  }
  // 鼻子：宽鼻头
  stroke(g, [[cx - w * 0.04, cy - s * 0.06], [cx - w * 0.06, cy + s * 0.1], [cx - w * 0.12, cy + s * 0.15], [cx - w * 0.05, cy + s * 0.18], [cx + w * 0.05, cy + s * 0.18], [cx + w * 0.12, cy + s * 0.15]],
    { color: ink, width: lw * 1.2, seed: st.seed + 50 });
  // 法令纹（六十三岁的脸本来就有；只是一道浅线，不是笑出来的深纹）
  for (const side of [-1, 1]) {
    stroke(g, [[cx + side * w * 0.14, cy + s * 0.15], [cx + side * w * 0.19, cy + s * 0.26], [cx + side * w * 0.185, cy + s * 0.33]], { color: ink, width: lw * 0.6, passes: 1, seed: st.seed + 60 + side });
  }
  // 嘴：抿成一条线，嘴角略往下（照 03:14 那一刻：他抬头看镜头，脸是平的。M4 第 2 轮：原来嘴角上扬、带笑纹，
  // 遗像与片尾卡提前用掉了结局“这是头一回，他冲着你笑”；笑容只留给结局那一拍的 smileFaceTexture）
  stroke(g, [[cx - w * 0.15, cy + s * 0.29], [cx - w * 0.05, cy + s * 0.28], [cx + w * 0.05, cy + s * 0.28], [cx + w * 0.15, cy + s * 0.29]], { color: ink, width: lw * 1.4, seed: st.seed + 70 });
  stroke(g, [[cx - w * 0.07, cy + s * 0.335], [cx + w * 0.07, cy + s * 0.335]], { color: ink, width: lw * 0.6, passes: 1, seed: st.seed + 71 });
  // 胡茬
  g.fillStyle = ink;
  for (let i = 0; i < 90; i++) {
    const a = range(r, 0.15, Math.PI - 0.15);
    const rr = range(r, 0.2, 0.48);
    g.globalAlpha = range(r, 0.15, 0.4);
    g.fillRect(cx + Math.cos(a) * w * rr, cy + s * 0.22 + Math.sin(a) * s * 0.28 * rr, lw * 0.7, lw * 0.7);
  }
  g.globalAlpha = 1;
  g.restore();
}

/**
 * 录像带里老周的脸（叠在人偶头上的一层五官）：256×192 的监控画面、双分屏再横向压一半，脸只有二三十个像素高，
 * 细线画的五官糊成一片。这层只画大块的明暗——深眼窝、浓眉、睁着的眼（带一点高光：“这回我睁着眼”）、鼻底的影子、抿着的嘴、
 * 两道法令纹、三道抬头纹——缩到十几个像素也还是一张脸。
 * M4：墨色一律不透明、线宽 ×1.6，眉与眼窝加深色块，鼻翼与嘴线加粗（原来经过 CRT 着色和扫描线以后只剩一个米色椭圆）。
 * 透明底；u 向左右、v 向上下铺满（贴在头上正脸那一块球面上）：眉 0.36h、眼 0.46h、鼻底 0.63h、嘴 0.71h、下巴 0.86h。
 */
export function tapeFaceTexture(): THREE.CanvasTexture {
  return paintTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const cx = w / 2;
    const ink = (a: number) => `rgba(18,12,9,${a})`;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // 三道抬头纹（仰着头，挤得更深）
    g.strokeStyle = ink(0.8);
    g.lineWidth = h * 0.02;
    for (let i = 0; i < 3; i++) {
      const y = h * (0.17 + i * 0.048);
      g.beginPath();
      g.moveTo(cx - w * 0.2, y + h * 0.012);
      g.quadraticCurveTo(cx, y - h * 0.018, cx + w * 0.2, y + h * 0.012);
      g.stroke();
    }
    for (const sx of [-1, 1]) {
      const ex = cx + sx * w * 0.17;
      // 深眼窝（整块深色，仰着头，眼窝的影子往上缩）
      const gr = g.createRadialGradient(ex, h * 0.45, 2, ex, h * 0.45, w * 0.14);
      gr.addColorStop(0, ink(1));
      gr.addColorStop(0.6, ink(0.8));
      gr.addColorStop(1, ink(0));
      g.fillStyle = gr;
      ellipse(g, ex, h * 0.45, w * 0.14, h * 0.095);
      g.fill();
      // 睁着的眼：眼白一小片 + 往上看的黑眼珠 + 一点高光
      g.fillStyle = 'rgba(236,230,214,1)';
      ellipse(g, ex, h * 0.465, w * 0.07, h * 0.03);
      g.fill();
      g.fillStyle = ink(1);
      ellipse(g, ex + sx * w * 0.006, h * 0.455, w * 0.034, h * 0.032);
      g.fill();
      g.fillStyle = 'rgba(255,255,250,1)';
      ellipse(g, ex - w * 0.012, h * 0.445, w * 0.011, h * 0.011);
      g.fill();
      // 上眼睑的一道重线
      g.strokeStyle = ink(1);
      g.lineWidth = h * 0.022;
      g.beginPath();
      g.moveTo(ex - w * 0.08, h * 0.47);
      g.quadraticCurveTo(ex, h * 0.415, ex + w * 0.08, h * 0.465);
      g.stroke();
      // 浓眉（挑起来）
      g.strokeStyle = ink(1);
      g.lineWidth = h * 0.072;
      g.beginPath();
      g.moveTo(cx + sx * w * 0.055, h * 0.375);
      g.quadraticCurveTo(cx + sx * w * 0.17, h * 0.315, cx + sx * w * 0.3, h * 0.355);
      g.stroke();
    }
    // 鼻梁侧影（一侧暗）与鼻底
    g.fillStyle = ink(0.7);
    g.beginPath();
    g.moveTo(cx - w * 0.015, h * 0.48);
    g.lineTo(cx - w * 0.085, h * 0.615);
    g.lineTo(cx + w * 0.02, h * 0.625);
    g.lineTo(cx + w * 0.01, h * 0.48);
    g.closePath();
    g.fill();
    g.fillStyle = ink(1);
    ellipse(g, cx, h * 0.64, w * 0.1, h * 0.032);
    g.fill();
    // 鼻翼
    g.strokeStyle = ink(1);
    g.lineWidth = h * 0.028;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + sx * w * 0.075, h * 0.6);
      g.quadraticCurveTo(cx + sx * w * 0.11, h * 0.63, cx + sx * w * 0.06, h * 0.655);
      g.stroke();
    }
    // 法令纹
    g.strokeStyle = ink(0.95);
    g.lineWidth = h * 0.036;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + sx * w * 0.11, h * 0.6);
      g.quadraticCurveTo(cx + sx * w * 0.19, h * 0.7, cx + sx * w * 0.16, h * 0.8);
      g.stroke();
    }
    // 抿成一条线的嘴（嘴角略往下：03:14 那张脸是平的，笑容只留给结局；M4 第 2 轮）；下唇的影子
    g.strokeStyle = ink(1);
    g.lineWidth = h * 0.056;
    g.beginPath();
    g.moveTo(cx - w * 0.13, h * 0.725);
    g.quadraticCurveTo(cx, h * 0.705, cx + w * 0.13, h * 0.725);
    g.stroke();
    g.fillStyle = ink(0.55);
    ellipse(g, cx, h * 0.77, w * 0.08, h * 0.018);
    g.fill();
    // 下巴底下的影子与胡茬
    const jaw = g.createLinearGradient(0, h * 0.8, 0, h * 0.95);
    jaw.addColorStop(0, ink(0));
    jaw.addColorStop(1, ink(0.8));
    g.fillStyle = jaw;
    ellipse(g, cx, h * 0.86, w * 0.26, h * 0.1);
    g.fill();
  });
}

/**
 * 结局“这是头一回，他冲着你笑”那一拍：老周魂影头上的一张笑脸（M4）。与 tapeFaceTexture 同一套版式（贴在头上正脸那一块球面上），
 * 线条用深青（魂影是冷青，深青的五官叠上去读得出来）。M4 第 2 轮：原来是 ^^ 眯眼加大 U 形嘴、颧骨高光，读起来像表情包；
 * 收成一个老人家的笑——眼睛半眯（上眼睑压下来、底下露一点眼珠）、眼角的鱼尾纹，嘴抿着、嘴角只微微往上，法令纹浅浅的。
 */
export function smileFaceTexture(): THREE.CanvasTexture {
  return paintTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const cx = w / 2;
    const ink = (a: number) => `rgba(8,34,38,${a})`;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // 两道抬头纹（松开了，比带子里浅）
    g.strokeStyle = ink(0.5);
    g.lineWidth = h * 0.014;
    for (let i = 0; i < 2; i++) {
      const y = h * (0.2 + i * 0.05);
      g.beginPath();
      g.moveTo(cx - w * 0.17, y + h * 0.008);
      g.quadraticCurveTo(cx, y - h * 0.01, cx + w * 0.17, y + h * 0.008);
      g.stroke();
    }
    for (const sx of [-1, 1]) {
      const ex = cx + sx * w * 0.17;
      // 眉：舒展，眉梢略往下
      g.strokeStyle = ink(0.9);
      g.lineWidth = h * 0.045;
      g.beginPath();
      g.moveTo(cx + sx * w * 0.06, h * 0.365);
      g.quadraticCurveTo(cx + sx * w * 0.17, h * 0.335, cx + sx * w * 0.28, h * 0.37);
      g.stroke();
      // 半眯的眼：上眼睑一道压下来的弧，底下露一小块眼珠
      g.fillStyle = ink(0.95);
      ellipse(g, ex + sx * w * 0.004, h * 0.472, w * 0.03, h * 0.016);
      g.fill();
      g.strokeStyle = ink(1);
      g.lineWidth = h * 0.03;
      g.beginPath();
      g.moveTo(ex - w * 0.075, h * 0.472);
      g.quadraticCurveTo(ex, h * 0.44, ex + w * 0.075, h * 0.47);
      g.stroke();
      // 下眼睑：一道浅线（笑的时候往上推一点）
      g.lineWidth = h * 0.012;
      g.strokeStyle = ink(0.55);
      g.beginPath();
      g.moveTo(ex - w * 0.06, h * 0.487);
      g.quadraticCurveTo(ex, h * 0.5, ex + w * 0.06, h * 0.486);
      g.stroke();
      // 鱼尾纹
      g.strokeStyle = ink(0.7);
      g.lineWidth = h * 0.012;
      for (let k = -1; k <= 1; k++) {
        g.beginPath();
        g.moveTo(ex + sx * w * 0.085, h * (0.47 + k * 0.016));
        g.lineTo(ex + sx * w * 0.13, h * (0.466 + k * 0.03));
        g.stroke();
      }
    }
    // 鼻子
    g.strokeStyle = ink(0.75);
    g.lineWidth = h * 0.02;
    g.beginPath();
    g.moveTo(cx - w * 0.01, h * 0.49);
    g.lineTo(cx - w * 0.05, h * 0.61);
    g.quadraticCurveTo(cx, h * 0.64, cx + w * 0.055, h * 0.612);
    g.stroke();
    // 法令纹：浅浅两道
    g.strokeStyle = ink(0.6);
    g.lineWidth = h * 0.018;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + sx * w * 0.1, h * 0.615);
      g.quadraticCurveTo(cx + sx * w * 0.17, h * 0.68, cx + sx * w * 0.16, h * 0.75);
      g.stroke();
    }
    // 嘴：抿着，嘴角只微微往上
    g.strokeStyle = ink(1);
    g.lineWidth = h * 0.03;
    g.beginPath();
    g.moveTo(cx - w * 0.12, h * 0.69);
    g.quadraticCurveTo(cx, h * 0.704, cx + w * 0.12, h * 0.69);
    g.stroke();
    g.lineWidth = h * 0.016;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + sx * w * 0.12, h * 0.69);
      g.lineTo(cx + sx * w * 0.135, h * 0.68);
      g.stroke();
    }
  });
}

/**
 * 逆光的 matcap（尾声里爬上梯子的拆迁工人，M4）：中间近黑，边上一圈晨雾的亮边——
 * 背着上午的扬尘天光，剪影有体积、帽檐和肩膀的轮廓亮起来。M4 第 2 轮：中心从深暖灰压到近黑（原来读起来是白色塑料人偶）。
 */
export function rimMatcapTexture(): THREE.CanvasTexture {
  return paintTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#141210';
    g.fillRect(0, 0, w, h);
    const gr = g.createRadialGradient(w * 0.5, h * 0.52, 2, w * 0.5, h * 0.5, w * 0.5);
    gr.addColorStop(0, '#1a1715');
    gr.addColorStop(0.78, '#1c1916');
    gr.addColorStop(0.92, '#3e362f');
    gr.addColorStop(0.98, '#857766');
    gr.addColorStop(1, '#948574');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    g.fill();
  });
}

// ==================================================================== 遗像（炭精画）

const PORTRAIT_W = 512;
const PORTRAIT_H = 704;

/** 遗像的纸面与肩膀、头发、耳朵（炭精）；face = 'blank' | 'done'。画框（黑木框 + 黑纱花）也一起画进去。 */
function paintPortrait(g: G, w: number, h: number, face: 'blank' | 'done'): void {
  // 黑木框
  g.fillStyle = '#141110';
  g.fillRect(0, 0, w, h);
  const fr = w * 0.07;
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#2b2622');
  grad.addColorStop(0.5, '#171311');
  grad.addColorStop(1, '#241e1b');
  g.fillStyle = grad;
  g.fillRect(fr * 0.25, fr * 0.25, w - fr * 0.5, h - fr * 0.5);
  // 衬纸
  const px = fr, py = fr, pw = w - 2 * fr, ph = h - 2 * fr;
  g.fillStyle = '#E4DCCB';
  g.fillRect(px, py, pw, ph);
  // 炭精的灰色晕底
  const halo = g.createRadialGradient(w / 2, h * 0.42, pw * 0.2, w / 2, h * 0.45, pw * 0.75);
  halo.addColorStop(0, 'rgba(60,55,50,0.0)');
  halo.addColorStop(0.55, 'rgba(60,55,50,0.28)');
  halo.addColorStop(1, 'rgba(60,55,50,0.05)');
  g.fillStyle = halo;
  g.fillRect(px, py, pw, ph);
  paperGrain(g, w, h, 17, 0.05);
  const cx = w / 2, cy = h * 0.42, s = pw * 0.52;
  // 肩膀与值勤衬衫的领子（炭精铺暗）
  g.save();
  g.beginPath();
  g.rect(px, py, pw, ph);
  g.clip();
  const body = g.createLinearGradient(0, cy + s * 0.5, 0, py + ph);
  body.addColorStop(0, '#3a3632');
  body.addColorStop(1, '#1e1b19');
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(px - 10, py + ph + 10);
  g.lineTo(px - 10, cy + s * 1.05);
  g.quadraticCurveTo(cx - s * 0.62, cy + s * 0.66, cx - s * 0.2, cy + s * 0.62);
  g.lineTo(cx + s * 0.2, cy + s * 0.62);
  g.quadraticCurveTo(cx + s * 0.62, cy + s * 0.66, px + pw + 10, cy + s * 1.05);
  g.lineTo(px + pw + 10, py + ph + 10);
  g.closePath();
  g.fill();
  // 领口：浅色衬衫领的两片
  g.fillStyle = '#8c8578';
  g.beginPath();
  g.moveTo(cx - s * 0.2, cy + s * 0.6);
  g.lineTo(cx - s * 0.02, cy + s * 0.86);
  g.lineTo(cx - s * 0.34, cy + s * 0.78);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(cx + s * 0.2, cy + s * 0.6);
  g.lineTo(cx + s * 0.02, cy + s * 0.86);
  g.lineTo(cx + s * 0.34, cy + s * 0.78);
  g.closePath();
  g.fill();
  // 脖子
  g.fillStyle = face === 'done' ? '#b3a896' : '#d8cfbd';
  g.fillRect(cx - s * 0.17, cy + s * 0.42, s * 0.34, s * 0.22);
  // 头发：炭精铺出短灰发的块面
  const hair = g.createLinearGradient(0, cy - s * 0.62, 0, cy - s * 0.1);
  hair.addColorStop(0, '#3b3733');
  hair.addColorStop(1, '#6e675f');
  g.fillStyle = hair;
  g.beginPath();
  g.ellipse(cx, cy - s * 0.12, s * 0.4, s * 0.5, 0, Math.PI, Math.PI * 2);
  g.fill();
  // 耳朵（起好了）
  g.fillStyle = '#a79c8a';
  ellipse(g, cx - s * 0.38, cy + s * 0.02, s * 0.06, s * 0.12);
  g.fill();
  ellipse(g, cx + s * 0.38, cy + s * 0.02, s * 0.06, s * 0.12);
  g.fill();
  if (face === 'blank') {
    // 脸那一块是空白：只有衬纸，边上几笔试探的轮廓
    g.fillStyle = '#E8E0CF';
    ellipse(g, cx, cy + s * 0.02, s * 0.35, s * 0.46);
    g.fill();
    g.strokeStyle = 'rgba(80,72,64,0.25)';
    g.lineWidth = 1.2;
    ellipse(g, cx, cy + s * 0.02, s * 0.35, s * 0.46);
    g.stroke();
  } else {
    paintZhouFace(g, cx, cy + s * 0.02, s * 0.84, { ink: '#221e1b', skin: '#c9bfad', shade: 'rgba(40,34,30,0.45)', weight: 1.1, seed: 1960, lookUp: true });
  }
  g.restore();
  // 画框上沿的黑纱花
  g.fillStyle = '#050505';
  g.beginPath();
  g.ellipse(w / 2 - w * 0.09, fr * 0.8, w * 0.1, fr * 0.7, -0.3, 0, Math.PI * 2);
  g.ellipse(w / 2 + w * 0.09, fr * 0.8, w * 0.1, fr * 0.7, 0.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a1a1a';
  ellipse(g, w / 2, fr * 0.85, w * 0.05, fr * 0.6);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 2;
  g.strokeRect(fr * 0.25, fr * 0.25, w - fr * 0.5, h - fr * 0.5);
}

export function portraitTexture(face: 'blank' | 'done'): THREE.CanvasTexture {
  const t = paintTexture(PORTRAIT_W, PORTRAIT_H, (g, w, h) => paintPortrait(g, w, h, face), { anisotropy: 4 });
  t.name = `fin.portrait.${face}`;
  return t;
}

/** 红外里透出来的铅笔底稿（layer.ir_only 的透明贴花）：头发、耳朵、衣领都起好了稿，唯独脸那一块是空白。 */
export function sketchTexture(): THREE.CanvasTexture {
  return paintTexture(PORTRAIT_W, PORTRAIT_H, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const fr = w * 0.07;
    const pw = w - 2 * fr;
    const cx = w / 2, cy = h * 0.42, s = pw * 0.52;
    const pen = { color: 'rgba(30,30,30,1)', width: 2.2, passes: 2 };
    // 头发与发际线
    for (let i = 0; i < 14; i++) {
      const a = Math.PI + (i / 13) * Math.PI;
      stroke(g, [[cx + Math.cos(a) * s * 0.4, cy - s * 0.12 + Math.sin(a) * s * 0.5], [cx + Math.cos(a) * s * 0.33, cy - s * 0.12 + Math.sin(a) * s * 0.42]], { ...pen, seed: 100 + i });
    }
    stroke(g, [[cx - s * 0.4, cy - s * 0.12], [cx - s * 0.3, cy - s * 0.5], [cx, cy - s * 0.62], [cx + s * 0.3, cy - s * 0.5], [cx + s * 0.4, cy - s * 0.12]], { ...pen, seed: 130 });
    // 耳朵
    for (const side of [-1, 1]) stroke(g, [[cx + side * s * 0.35, cy - s * 0.08], [cx + side * s * 0.44, cy], [cx + side * s * 0.42, cy + s * 0.12], [cx + side * s * 0.35, cy + s * 0.14]], { ...pen, seed: 140 + side });
    // 脖子与衣领
    stroke(g, [[cx - s * 0.17, cy + s * 0.44], [cx - s * 0.17, cy + s * 0.62], [cx - s * 0.34, cy + s * 0.78], [cx - s * 0.02, cy + s * 0.86], [cx + s * 0.34, cy + s * 0.78], [cx + s * 0.17, cy + s * 0.62], [cx + s * 0.17, cy + s * 0.44]], { ...pen, seed: 150 });
    stroke(g, [[fr, cy + s * 1.05], [cx - s * 0.62, cy + s * 0.68], [cx - s * 0.2, cy + s * 0.62]], { ...pen, seed: 160 });
    stroke(g, [[w - fr, cy + s * 1.05], [cx + s * 0.62, cy + s * 0.68], [cx + s * 0.2, cy + s * 0.62]], { ...pen, seed: 161 });
    // 脸：一个空白的椭圆框，里面什么也没有
    g.setLineDash([6, 8]);
    g.strokeStyle = 'rgba(30,30,30,0.9)';
    g.lineWidth = 1.5;
    ellipse(g, cx, cy + s * 0.02, s * 0.35, s * 0.46);
    g.stroke();
    g.setLineDash([]);
  });
}

// ==================================================================== 照妖镜

/** 屏幕里“伙计的眼睛”看到的门卫室：墙、桌角、那把椅子（老周坐在上面抬头看你 / 空着）。磷绿单色。 */
function paintBoothView(g: G, w: number, h: number, zhou: boolean): void {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#2c3036');
  bg.addColorStop(0.62, '#1d2126');
  bg.addColorStop(1, '#101316');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  // 墙角线与门框
  g.strokeStyle = 'rgba(210,220,210,0.25)';
  g.lineWidth = Math.max(1, w / 160);
  g.beginPath();
  g.moveTo(w * 0.18, 0);
  g.lineTo(w * 0.24, h * 0.66);
  g.lineTo(w * 0.02, h);
  g.moveTo(w * 0.24, h * 0.66);
  g.lineTo(w * 0.98, h * 0.7);
  g.stroke();
  // 墙上的注意事项、录像带架
  g.fillStyle = 'rgba(220,225,215,0.35)';
  g.fillRect(w * 0.05, h * 0.2, w * 0.1, h * 0.16);
  g.fillStyle = 'rgba(150,160,150,0.3)';
  for (let i = 0; i < 6; i++) g.fillRect(w * 0.06, h * (0.42 + i * 0.035), w * 0.09, h * 0.022);
  // 灯泡的光
  const bulb = g.createRadialGradient(w * 0.6, h * 0.08, 1, w * 0.6, h * 0.08, w * 0.5);
  bulb.addColorStop(0, 'rgba(255,255,240,0.55)');
  bulb.addColorStop(1, 'rgba(255,255,240,0)');
  g.fillStyle = bulb;
  g.fillRect(0, 0, w, h);
  // 椅子（木头，靠背两根立柱 + 横撑）
  const cx = w * 0.56, floor = h * 0.93;
  const k = h / 192;
  g.fillStyle = '#5b5046';
  g.strokeStyle = '#2a241f';
  g.lineWidth = 2 * k;
  g.fillRect(cx - 34 * k, floor - 62 * k, 68 * k, 9 * k);          // 座面
  g.fillRect(cx - 32 * k, floor - 54 * k, 6 * k, 54 * k);          // 前腿
  g.fillRect(cx + 26 * k, floor - 54 * k, 6 * k, 54 * k);
  g.fillRect(cx - 28 * k, floor - 128 * k, 6 * k, 70 * k);         // 靠背立柱
  g.fillRect(cx + 22 * k, floor - 128 * k, 6 * k, 70 * k);
  g.fillRect(cx - 28 * k, floor - 124 * k, 56 * k, 8 * k);         // 靠背横撑
  g.fillRect(cx - 28 * k, floor - 100 * k, 56 * k, 6 * k);
  if (zhou) {
    // 老周坐在椅子上，抬头看你：藏蓝衬衫、红袖箍、魂影的一圈亮边
    g.save();
    g.shadowColor = 'rgba(180,255,240,0.9)';
    g.shadowBlur = 10 * k;
    g.fillStyle = '#3a4868';
    g.beginPath();
    g.moveTo(cx - 36 * k, floor - 62 * k);
    g.lineTo(cx - 30 * k, floor - 118 * k);
    g.quadraticCurveTo(cx, floor - 132 * k, cx + 30 * k, floor - 118 * k);
    g.lineTo(cx + 36 * k, floor - 62 * k);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = '#c23b2e';
    g.fillRect(cx - 38 * k, floor - 108 * k, 8 * k, 10 * k);
    // 腿
    g.fillStyle = '#34363b';
    g.fillRect(cx - 30 * k, floor - 64 * k, 26 * k, 12 * k);
    g.fillRect(cx + 4 * k, floor - 64 * k, 26 * k, 12 * k);
    g.fillRect(cx - 28 * k, floor - 54 * k, 10 * k, 50 * k);
    g.fillRect(cx + 18 * k, floor - 54 * k, 10 * k, 50 * k);
    // 手里的搪瓷缸
    g.fillStyle = '#e8e2d2';
    g.fillRect(cx + 16 * k, floor - 92 * k, 12 * k, 14 * k);
    paintZhouFace(g, cx, floor - 150 * k, 36 * k, { ink: '#1a1c1a', skin: '#b9b4a6', shade: 'rgba(20,24,22,0.5)', light: 'rgba(255,255,255,0.8)', weight: 1.6, seed: 1960, lookUp: true });
  }
  crtize(g, w, h, [150, 255, 190]);
}

/** ConsoleConfig.tunnelInner：隧道最深处（补脸前空椅子，补脸后椅子上坐着抬头的老周）。 */
export function paintTunnelInner(g: G, w: number, h: number, zhou: boolean): void {
  paintBoothView(g, w, h, zhou);
}

/** ConsoleConfig.tunnelBaked：预制的 8 层嵌套（settings.tunnelMode = 'baked'），最深处同 tunnelInner。 */
export function paintTunnelBaked(g: G, w: number, h: number, zhou: boolean): void {
  // 最深处先画满，再从外往里一层层画 CRT 外框（每层缩小 0.72，略微错位，越往里越暗）
  const inner = document.createElement('canvas');
  inner.width = 256;
  inner.height = 192;
  const ig = inner.getContext('2d');
  if (ig) paintBoothView(ig, 256, 192, zhou);
  g.fillStyle = '#050706';
  g.fillRect(0, 0, w, h);
  let x = 0, y = 0, cw = w, ch = h;
  for (let i = 0; i < 8; i++) {
    const shrink = 0.72;
    const nw = cw * shrink, nh = ch * shrink;
    const nx = x + (cw - nw) / 2 + (i % 2 ? 1 : -1) * cw * 0.012;
    const ny = y + (ch - nh) / 2 + ch * 0.02;
    // 外框（机壳）与屏幕玻璃
    const dim = 1 - i * 0.09;
    g.fillStyle = `rgba(${Math.round(70 * dim)},${Math.round(72 * dim)},${Math.round(70 * dim)},1)`;
    g.fillRect(x + cw * 0.04, y + ch * 0.04, cw * 0.92, ch * 0.92);
    const glass = g.createRadialGradient(nx + nw / 2, ny + nh / 2, 2, nx + nw / 2, ny + nh / 2, Math.max(nw, nh) * 0.7);
    glass.addColorStop(0, `rgba(${Math.round(60 * dim)},${Math.round(110 * dim)},${Math.round(80 * dim)},1)`);
    glass.addColorStop(1, `rgba(${Math.round(15 * dim)},${Math.round(30 * dim)},${Math.round(22 * dim)},1)`);
    g.fillStyle = glass;
    g.fillRect(nx - nw * 0.03, ny - nh * 0.03, nw * 1.06, nh * 1.06);
    x = nx;
    y = ny;
    cw = nw;
    ch = nh;
  }
  if (ig) {
    g.globalAlpha = 0.95;
    g.drawImage(inner, x, y, cw, ch);
    g.globalAlpha = 1;
  }
  // 整体的磷光与扫描线
  g.fillStyle = 'rgba(124,255,178,0.06)';
  g.fillRect(0, 0, w, h);
  for (let yy = 0; yy < h; yy += 3) {
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, yy, w, 1);
  }
}

// ==================================================================== 桌上、地上的小东西

/** 粉笔叉：两道粗粝的白粉笔划（透明底）。 */
export function chalkTexture(): THREE.CanvasTexture {
  return paintTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = rng(830);
    const line = (x0: number, y0: number, x1: number, y1: number, seed: number) => {
      const rr = rng(seed);
      for (let p = 0; p < 26; p++) {
        // M4：线宽加倍、粉更实（CH1 俯拍下原来只是几条细淡的粉线）
        g.strokeStyle = `rgba(245,242,232,${range(rr, 0.35, 0.85)})`;
        g.lineWidth = range(rr, 6, 17);
        g.lineCap = 'round';
        g.beginPath();
        const o = range(rr, -5, 5);
        g.moveTo(x0 + range(rr, -4, 4), y0 + o + range(rr, -4, 4));
        g.lineTo(x1 + range(rr, -4, 4), y1 + o + range(rr, -4, 4));
        g.stroke();
      }
    };
    line(w * 0.14, h * 0.18, w * 0.86, h * 0.84, 1);
    line(w * 0.84, h * 0.14, w * 0.18, h * 0.86, 2);
    // 粉笔灰
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(240,238,228,${range(r, 0.05, 0.3)})`;
      g.fillRect(range(r, w * 0.1, w * 0.9), range(r, h * 0.1, h * 0.9), 1.5, 1.5);
    }
  });
}

/** 馄饨汤面：清汤、紫菜、虾皮、葱花，几只馄饨。 */
export function wontonTexture(): THREE.CanvasTexture {
  return paintTexture(256, 256, (g, w, h) => {
    const r = rng(1986);
    const soup = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
    soup.addColorStop(0, '#d8b97a');
    soup.addColorStop(1, '#9c7a44');
    g.fillStyle = soup;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(30,40,25,${range(r, 0.4, 0.9)})`;
      ellipse(g, range(r, 30, w - 30), range(r, 30, h - 30), range(r, 3, 10), range(r, 2, 6), range(r, 0, 3));
      g.fill();
    }
    for (let i = 0; i < 7; i++) {
      const x = range(r, 60, w - 60), y = range(r, 60, h - 60);
      g.fillStyle = '#f2ead6';
      ellipse(g, x, y, range(r, 20, 28), range(r, 14, 20), range(r, 0, 3));
      g.fill();
      g.fillStyle = 'rgba(200,180,140,0.5)';
      ellipse(g, x + 4, y + 3, 8, 5);
      g.fill();
    }
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(90,160,60,${range(r, 0.6, 1)})`;
      g.fillRect(range(r, 20, w - 20), range(r, 20, h - 20), 5, 5);
    }
    for (let i = 0; i < 18; i++) {
      g.fillStyle = '#f0c8a8';
      g.fillRect(range(r, 20, w - 20), range(r, 20, h - 20), 4, 2);
    }
  });
}

/** 光点贴图（加法混合的圆形柔光；Points 用）。 */
export function glowTexture(): THREE.CanvasTexture {
  return paintTexture(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.75)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
}

/** 袖子（贴着镜头擦过去的一截袖口）。color = 布色；stripe = 反光条（拆迁工人的工装）。 */
export function sleeveTexture(color: string, stripe: boolean, seed: number): THREE.CanvasTexture {
  return paintTexture(512, 256, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    // 布纹与褶皱
    for (let i = 0; i < 26; i++) {
      const y = range(r, 0, h);
      const gr = g.createLinearGradient(0, y - 20, 0, y + 20);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(0.5, `rgba(0,0,0,${range(r, 0.15, 0.45)})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, y - 20);
      g.bezierCurveTo(w * 0.3, y + range(r, -30, 30), w * 0.7, y + range(r, -30, 30), w, y + range(r, -20, 20));
      g.lineTo(w, y + 30);
      g.lineTo(0, y + 20);
      g.closePath();
      g.fill();
    }
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = `rgba(255,255,255,${range(r, 0, 0.05)})`;
      g.fillRect(range(r, 0, w), range(r, 0, h), 2, 1);
    }
    if (stripe) {
      g.fillStyle = 'rgba(210,215,205,0.85)';
      g.fillRect(0, h * 0.62, w, h * 0.08);
    }
    // 袖口的一道缝线与一颗扣子
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 3;
    g.setLineDash([10, 7]);
    g.beginPath();
    g.moveTo(w * 0.82, 0);
    g.lineTo(w * 0.86, h);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#1b1b1b';
    ellipse(g, w * 0.9, h * 0.4, 9, 9);
    g.fill();
  });
}

// ==================================================================== 尾声与南柯布景

/** 晨雾天穹（竖直渐变；BackSide 球内贴）。 */
export function morningSkyTexture(top: string, mid: string, bottom: string): THREE.CanvasTexture {
  return paintTexture(16, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, top);
    gr.addColorStop(0.45, mid);
    gr.addColorStop(0.53, bottom);
    gr.addColorStop(1, bottom);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
}

/** matcap：左上方来的暖光、右下冷影（远处布景不吃场景灯，靠它出体积）。 */
export function matcapTexture(warm: string, cool: string): THREE.CanvasTexture {
  return paintTexture(128, 128, (g, w, h) => {
    g.fillStyle = cool;
    g.fillRect(0, 0, w, h);
    const gr = g.createRadialGradient(w * 0.36, h * 0.3, 2, w * 0.5, h * 0.5, w * 0.62);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.25, warm);
    gr.addColorStop(0.8, cool);
    gr.addColorStop(1, '#1b1d24');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    g.fill();
  });
}

/** 推平的院子：黄土、车辙、碎砖、积水（平铺用，RepeatWrapping）。 */
export function rubbleGroundTexture(): THREE.CanvasTexture {
  const t = paintTexture(512, 512, (g, w, h) => {
    const r = rng(2026);
    g.fillStyle = '#8a7a66';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = range(r, -30, 30);
      g.fillStyle = `rgba(${120 + v},${104 + v},${86 + v},${range(r, 0.2, 0.6)})`;
      ellipse(g, range(r, 0, w), range(r, 0, h), range(r, 4, 26), range(r, 3, 14), range(r, 0, 3));
      g.fill();
    }
    // 车辙
    g.strokeStyle = 'rgba(60,50,40,0.35)';
    for (let k = 0; k < 2; k++) {
      g.lineWidth = 22;
      g.beginPath();
      g.moveTo(0, h * (0.3 + k * 0.08));
      g.bezierCurveTo(w * 0.3, h * (0.2 + k * 0.08), w * 0.6, h * (0.55 + k * 0.08), w, h * (0.45 + k * 0.08));
      g.stroke();
      g.setLineDash([6, 10]);
      g.lineWidth = 16;
      g.strokeStyle = 'rgba(40,32,26,0.35)';
      g.stroke();
      g.setLineDash([]);
      g.strokeStyle = 'rgba(60,50,40,0.35)';
    }
    // 碎砖渣
    for (let i = 0; i < 500; i++) {
      g.fillStyle = r() < 0.6 ? `rgba(${140 + range(r, -20, 20)},70,52,0.85)` : `rgba(170,165,155,0.8)`;
      g.fillRect(range(r, 0, w), range(r, 0, h), range(r, 2, 7), range(r, 2, 5));
    }
    // 积水：映着晨天的浅色块
    for (let i = 0; i < 2; i++) {
      g.fillStyle = 'rgba(214,206,200,0.22)';
      ellipse(g, range(r, 40, w - 40), range(r, 40, h - 40), range(r, 20, 50), range(r, 8, 20), range(r, 0, 3));
      g.fill();
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 树墩的横截面：年轮、裂纹、锯痕。 */
export function stumpTopTexture(): THREE.CanvasTexture {
  return paintTexture(256, 256, (g, w, h) => {
    const r = rng(1777);
    g.fillStyle = '#6a5038';
    g.fillRect(0, 0, w, h);
    for (let i = 60; i > 0; i--) {
      const rr = (i / 60) * w * 0.48;
      g.strokeStyle = i % 2 ? 'rgba(70,45,28,0.5)' : 'rgba(190,150,105,0.35)';
      g.lineWidth = 1.6;
      g.beginPath();
      for (let a = 0; a <= 64; a++) {
        const t = (a / 64) * Math.PI * 2;
        const wob = 1 + Math.sin(t * 3 + i) * 0.02 + range(r, -0.01, 0.01);
        const x = w / 2 + Math.cos(t) * rr * wob;
        const y = h / 2 + Math.sin(t) * rr * wob;
        if (a === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.strokeStyle = 'rgba(30,20,12,0.8)';
    g.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      const a = range(r, 0, Math.PI * 2);
      g.beginPath();
      g.moveTo(w / 2 + Math.cos(a) * 12, h / 2 + Math.sin(a) * 12);
      g.lineTo(w / 2 + Math.cos(a) * w * 0.45, h / 2 + Math.sin(a) * h * 0.45);
      g.stroke();
    }
  });
}

/** 树皮（树墩侧面、平铺）。 */
export function barkTexture(): THREE.CanvasTexture {
  const t = paintTexture(256, 256, (g, w, h) => {
    const r = rng(1984);
    g.fillStyle = '#3d3128';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const x = range(r, 0, w);
      const v = range(r, 0.35, 1.3);
      g.strokeStyle = `rgba(${Math.round(64 * v)},${Math.round(50 * v)},${Math.round(38 * v)},0.9)`;
      g.lineWidth = range(r, 2, 8);
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + range(r, -20, 20), h * 0.3, x + range(r, -20, 20), h * 0.7, x + range(r, -10, 10), h);
      g.stroke();
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 围挡喷字（GDD §7.4 拆迁公告的项目名）。 */
export function hoardingTexture(text: string): THREE.CanvasTexture {
  return paintTexture(1024, 256, (g, w, h) => {
    const r = rng(19);
    g.fillStyle = '#2f6b58';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 3, h);
    g.fillStyle = '#e9e4d6';
    g.font = `bold ${Math.round(h * 0.32)}px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(90,70,50,${range(r, 0.05, 0.25)})`;
      ellipse(g, range(r, 0, w), h - range(r, 0, 40), range(r, 10, 60), range(r, 4, 16));
      g.fill();
    }
  });
}

// ==================================================================== 片尾照片卡（GDD §8.9：ph.film3、ph.menshen_2018、ph.huang_ir、ph.tape_face、ph.final）

export type CreditPhoto = 'ph.film3' | 'ph.menshen_2018' | 'ph.huang_ir' | 'ph.tape_face' | 'ph.final';

const CARD_W = 768;
const CARD_H = 640;
/** 照片区域（卡片里的 4:3 画面）。 */
const PIC = { x: 44, y: 40, w: 680, h: 510 } as const;

/** 一张冲洗出来的照片：白边、下方手写的标题；pic 画 4:3 画面。 */
export function paintCard(g: G, title: string, pic: (g: G, w: number, h: number) => void, seed: number): void {
  g.fillStyle = '#f1ece0';
  g.fillRect(0, 0, CARD_W, CARD_H);
  paperGrain(g, CARD_W, CARD_H, seed, 0.04);
  g.save();
  g.translate(PIC.x, PIC.y);
  g.beginPath();
  g.rect(0, 0, PIC.w, PIC.h);
  g.clip();
  pic(g, PIC.w, PIC.h);
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 2;
  g.strokeRect(PIC.x, PIC.y, PIC.w, PIC.h);
  g.fillStyle = '#2b2a33';
  g.font = `${Math.round(CARD_H * 0.055)}px "Kaiti SC","STKaiti","KaiTi","AR PL UKai CN",${FONT_STACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(title, CARD_W / 2, PIC.y + PIC.h + (CARD_H - PIC.y - PIC.h) / 2);
}

export const CARD_SIZE = { w: CARD_W, h: CARD_H, pic: PIC } as const;

/** 各张照片的“画面”（找不到玩家自己拍的缩略图时用；有缩略图时它垫底，缩略图盖在上面）。 */
export function paintCreditPic(id: CreditPhoto): (g: G, w: number, h: number) => void {
  switch (id) {
    case 'ph.film3': return picFilm3;
    case 'ph.menshen_2018': return picMenshen;
    case 'ph.huang_ir': return picHuangIr;
    case 'ph.tape_face': return picTapeFace;
    case 'ph.final': return picFinal;
  }
}

/** 老周与伙计：黑白、偷拍的背影——老周站在梯子上给门口的摄像头扣铁皮帽子。 */
function picFilm3(g: G, w: number, h: number): void {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#bdbab2');
  bg.addColorStop(1, '#6e6b66');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  // 门岗墙与门楣
  g.fillStyle = '#d6d2c8';
  g.fillRect(w * 0.45, 0, w * 0.55, h);
  g.fillStyle = '#9b978f';
  g.fillRect(w * 0.45, h * 0.28, w * 0.55, h * 0.04);
  // 摄像头与支架
  g.fillStyle = '#efece6';
  g.save();
  g.translate(w * 0.62, h * 0.18);
  g.rotate(0.35);
  g.fillRect(-60, -24, 120, 48);
  g.fillStyle = '#222';
  g.beginPath();
  g.arc(-66, 0, 16, 0, Math.PI * 2);
  g.fill();
  // 铁皮帽子（正在扣上去）
  g.fillStyle = '#8a8a8a';
  g.beginPath();
  g.moveTo(-80, -36);
  g.lineTo(70, -46);
  g.lineTo(76, -30);
  g.lineTo(-86, -24);
  g.closePath();
  g.fill();
  g.restore();
  g.fillStyle = '#555';
  g.fillRect(w * 0.7, h * 0.2, 12, 40);
  // 梯子
  g.strokeStyle = '#3a3835';
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(w * 0.3, h);
  g.lineTo(w * 0.46, h * 0.3);
  g.moveTo(w * 0.42, h);
  g.lineTo(w * 0.56, h * 0.3);
  g.stroke();
  g.lineWidth = 6;
  for (let i = 1; i < 8; i++) {
    const t = i / 8;
    g.beginPath();
    g.moveTo(w * (0.3 + 0.16 * (1 - t)) + w * 0.16 * 0, h * (0.3 + 0.7 * t));
    g.lineTo(w * (0.42 + 0.14 * (1 - t)), h * (0.3 + 0.7 * t));
    g.stroke();
  }
  // 老周的背影：蓝布单帽、藏蓝衬衫（黑白里是深灰）、胳膊举着
  g.fillStyle = '#35363a';
  g.beginPath();
  g.moveTo(w * 0.34, h * 0.9);
  g.lineTo(w * 0.36, h * 0.52);
  g.quadraticCurveTo(w * 0.43, h * 0.44, w * 0.5, h * 0.52);
  g.lineTo(w * 0.52, h * 0.9);
  g.closePath();
  g.fill();
  g.lineWidth = 22;
  g.strokeStyle = '#35363a';
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(w * 0.48, h * 0.55);
  g.lineTo(w * 0.57, h * 0.3);
  g.moveTo(w * 0.38, h * 0.55);
  g.lineTo(w * 0.5, h * 0.33);
  g.stroke();
  g.fillStyle = '#2a2a2c';
  ellipse(g, w * 0.43, h * 0.43, 30, 34);
  g.fill();
  g.fillStyle = '#1d1d1f';
  g.fillRect(w * 0.39, h * 0.37, 62, 16);
  paperGrain(g, w, h, 3, 0.12);
}

/** 贴门神·2018：回放的棕绿色调，建国踩着凳子贴门神，王奶奶在旁边指着说歪了。 */
function picMenshen(g: G, w: number, h: number): void {
  g.fillStyle = '#4a4a34';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#5f5e44';
  g.fillRect(w * 0.3, h * 0.05, w * 0.42, h * 0.95);
  // 门神两张（左边那张歪了）
  const god = (x: number, rot: number) => {
    g.save();
    g.translate(x, h * 0.36);
    g.rotate(rot);
    g.fillStyle = '#a58a55';
    g.fillRect(-58, -95, 116, 190);
    g.fillStyle = '#7c4a36';
    g.fillRect(-40, -70, 80, 70);
    g.fillStyle = '#d7c79a';
    ellipse(g, 0, -60, 22, 24);
    g.fill();
    g.restore();
  };
  god(w * 0.42, -0.14);
  god(w * 0.6, 0);
  // 建国（踩凳子举着手）与王奶奶（驼背、指着）
  g.fillStyle = '#2f2f22';
  g.fillRect(w * 0.36, h * 0.5, 70, 180);
  ellipse(g, w * 0.36 + 35, h * 0.46, 26, 30);
  g.fill();
  g.lineWidth = 18;
  g.strokeStyle = '#2f2f22';
  g.beginPath();
  g.moveTo(w * 0.36 + 60, h * 0.55);
  g.lineTo(w * 0.44, h * 0.34);
  g.stroke();
  g.fillStyle = '#3a3a2a';
  g.beginPath();
  g.moveTo(w * 0.1, h);
  g.lineTo(w * 0.12, h * 0.66);
  g.quadraticCurveTo(w * 0.17, h * 0.58, w * 0.22, h * 0.66);
  g.lineTo(w * 0.24, h);
  g.closePath();
  g.fill();
  ellipse(g, w * 0.19, h * 0.6, 24, 26);
  g.fill();
  g.beginPath();
  g.moveTo(w * 0.22, h * 0.7);
  g.lineTo(w * 0.33, h * 0.52);
  g.stroke();
  // VHS 条纹
  for (let y = 0; y < h; y += 4) {
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, y, w, 2);
  }
  g.fillStyle = 'rgba(230,230,200,0.25)';
  g.fillRect(0, h * 0.82, w, 10);
}

/** 热乎的三爷：红外铁虹色带，一个戴破毡帽的矮个子，暖色轮廓。 */
function picHuangIr(g: G, w: number, h: number): void {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#1a0330');
  bg.addColorStop(1, '#3b0a5e');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  // 身边一排纸人：冷紫
  for (const x of [0.12, 0.84]) {
    g.fillStyle = '#4d0f78';
    g.fillRect(w * x - 40, h * 0.35, 80, h * 0.65);
    ellipse(g, w * x, h * 0.3, 36, 40);
    g.fill();
  }
  // 三爷：由里到外 白 → 黄 → 橙 → 紫
  const body = (scale: number, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(w * 0.5 - 90 * scale, h);
    g.lineTo(w * 0.5 - 80 * scale, h * 0.55);
    g.quadraticCurveTo(w * 0.5, h * 0.45, w * 0.5 + 80 * scale, h * 0.55);
    g.lineTo(w * 0.5 + 90 * scale, h);
    g.closePath();
    g.fill();
    ellipse(g, w * 0.5, h * 0.42, 52 * scale, 58 * scale);
    g.fill();
  };
  body(1.25, '#D9480F');
  body(1.05, '#FFD43B');
  body(0.75, '#FFF4C8');
  // 破毡帽（凉的，偏紫）
  g.fillStyle = '#6d1a8a';
  g.fillRect(w * 0.5 - 80, h * 0.3, 160, 24);
  g.fillRect(w * 0.5 - 50, h * 0.2, 100, 40);
  // 色标与读数
  const bar = g.createLinearGradient(0, h, 0, 0);
  ['#120024', '#5B0F8A', '#D9480F', '#FFD43B', '#FFFFFF'].forEach((c, i) => bar.addColorStop(i / 4, c));
  g.fillStyle = bar;
  g.fillRect(14, h * 0.2, 12, h * 0.6);
  g.fillStyle = '#ffffff';
  g.font = `bold 26px ${FONT_STACK}`;
  g.fillText('36.5℃', w * 0.56, h * 0.47);
  paperGrain(g, w, h, 11, 0.08);
}

/** 老周的脸：CRT 上暂停的那一帧，磷绿单色、扫描线、OSD。 */
function picTapeFace(g: G, w: number, h: number): void {
  g.fillStyle = '#20241f';
  g.fillRect(0, 0, w, h);
  // 门框、门灯的光
  const lamp = g.createRadialGradient(w * 0.8, h * 0.05, 4, w * 0.8, h * 0.05, w * 0.6);
  lamp.addColorStop(0, 'rgba(255,255,230,0.8)');
  lamp.addColorStop(1, 'rgba(255,255,230,0)');
  g.fillStyle = lamp;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#3c423c';
  g.fillRect(0, 0, w * 0.1, h);
  // 肩膀
  g.fillStyle = '#4a5268';
  g.beginPath();
  g.moveTo(w * 0.18, h);
  g.quadraticCurveTo(w * 0.5, h * 0.66, w * 0.82, h);
  g.fill();
  paintZhouFace(g, w * 0.5, h * 0.46, h * 0.52, { ink: '#141814', skin: '#b8b8a8', shade: 'rgba(10,14,12,0.55)', light: 'rgba(255,255,255,0.75)', weight: 1.3, seed: 1960, lookUp: true });
  crtize(g, w, h, [150, 255, 190], 4);
  g.fillStyle = PALETTE.OSD;
  g.font = `bold 24px ${FONT_STACK}`;
  g.fillText('CH1 2023-08-30 周三 03:14:05', 20, 34);
  g.fillStyle = PALETTE.REC;
  g.textAlign = 'right';
  g.fillText('ALARM', w - 20, 34);
  g.textAlign = 'left';
}

/**
 * 合影（没拍到大照片时的手绘版，M4 第 2 轮重画）：CH1 门楣上往下俯拍的院子——湿地面、院门灯的暖光池，
 * 左边是戴单帽、睁着眼抬头看镜头的老周（冷青的魂影，衬衫领、短袖、红袖箍），右边粉笔叉上站着没有头的身子
 * （藏蓝值勤衬衫、领口、袖箍，脖子上是托头的支架），左上角压进来一截镜头自己的铁皮帽檐。黎明粉的调子、暗角、OSD。
 * 原来是梯形、矩形拼的两个色块人形，像占位图。
 */
function picFinal(g: G, w: number, h: number): void {
  const r = rng(1957);
  // 湿地面：上远下近，远处发蓝、近处暖一点
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#2c313c');
  bg.addColorStop(0.45, '#3a3b42');
  bg.addColorStop(1, '#4a4440');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  // 远处：院墙（砖）与院门（铁栏），画面上缘
  g.fillStyle = '#4a3a33';
  g.fillRect(0, h * 0.05, w, h * 0.13);
  g.strokeStyle = 'rgba(30,22,18,0.55)';
  g.lineWidth = 1;
  for (let y = h * 0.05; y < h * 0.18; y += 7) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.fillStyle = '#23262c';
  g.fillRect(w * 0.52, h * 0.02, w * 0.4, h * 0.17);
  g.strokeStyle = '#15171b';
  g.lineWidth = 3;
  for (let x = w * 0.54; x < w * 0.91; x += 10) {
    g.beginPath();
    g.moveTo(x, h * 0.03);
    g.lineTo(x, h * 0.19);
    g.stroke();
  }
  // 院门灯：右边立柱上一点烧白的灯芯，地上一片暖光池（湿地面上拉长的倒影）
  const lampX = w * 0.93, lampY = h * 0.07;
  const halo = g.createRadialGradient(lampX, lampY, 2, lampX, lampY, w * 0.22);
  halo.addColorStop(0, 'rgba(255,236,200,1)');
  halo.addColorStop(0.12, 'rgba(255,190,120,0.55)');
  halo.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, w, h);
  const pool = g.createRadialGradient(w * 0.68, h * 0.62, 10, w * 0.68, h * 0.62, w * 0.5);
  pool.addColorStop(0, 'rgba(255,196,130,0.42)');
  pool.addColorStop(0.6, 'rgba(255,170,100,0.12)');
  pool.addColorStop(1, 'rgba(255,170,100,0)');
  g.fillStyle = pool;
  g.fillRect(0, 0, w, h);
  const streak = g.createLinearGradient(lampX, h * 0.2, lampX - w * 0.1, h);
  streak.addColorStop(0, 'rgba(255,200,140,0.35)');
  streak.addColorStop(1, 'rgba(255,200,140,0)');
  g.fillStyle = streak;
  g.beginPath();
  g.moveTo(lampX - 10, h * 0.2);
  g.lineTo(lampX + 14, h * 0.2);
  g.lineTo(lampX - w * 0.04, h);
  g.lineTo(lampX - w * 0.2, h);
  g.closePath();
  g.fill();
  // 地面的水渍、碎光
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '255,210,160' : '150,170,200'},${range(r, 0.03, 0.12)})`;
    ellipse(g, range(r, 0, w), range(r, h * 0.2, h), range(r, 4, 26), range(r, 1, 4));
    g.fill();
  }
  // 粉笔叉（身子脚下）
  const bx = w * 0.64, by = h * 0.8;
  stroke(g, [[bx - 44, by - 18], [bx + 44, by + 20]], { color: 'rgba(240,236,226,0.9)', width: 7, jitter: 1.6, passes: 4, seed: 91 });
  stroke(g, [[bx + 42, by - 20], [bx - 42, by + 18]], { color: 'rgba(240,236,226,0.9)', width: 7, jitter: 1.6, passes: 4, seed: 92 });

  // 一个俯拍的人：头（可无）、肩、短袖、胳膊、腿（上大下小，脚在画面下方）
  const figure = (cx: number, top: number, o: { shirt: string; pants: string; skin: string; alpha: number; headless: boolean }) => {
    g.save();
    g.globalAlpha = o.alpha;
    // 腿（俯拍：短，往下收）
    g.fillStyle = o.pants;
    g.beginPath();
    g.moveTo(cx - 34, top + 150);
    g.lineTo(cx - 26, top + 232);
    g.lineTo(cx - 6, top + 232);
    g.lineTo(cx - 2, top + 160);
    g.lineTo(cx + 2, top + 160);
    g.lineTo(cx + 6, top + 232);
    g.lineTo(cx + 26, top + 232);
    g.lineTo(cx + 34, top + 150);
    g.closePath();
    g.fill();
    g.fillStyle = '#16161a';
    ellipse(g, cx - 16, top + 236, 13, 6);
    g.fill();
    ellipse(g, cx + 16, top + 236, 13, 6);
    g.fill();
    // 胳膊（皮肤，垂在身侧）
    g.fillStyle = o.skin;
    g.beginPath();
    g.moveTo(cx - 64, top + 72);
    g.quadraticCurveTo(cx - 72, top + 120, cx - 60, top + 158);
    g.lineTo(cx - 48, top + 156);
    g.quadraticCurveTo(cx - 54, top + 118, cx - 46, top + 80);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(cx + 64, top + 72);
    g.quadraticCurveTo(cx + 72, top + 120, cx + 60, top + 158);
    g.lineTo(cx + 48, top + 156);
    g.quadraticCurveTo(cx + 54, top + 118, cx + 46, top + 80);
    g.closePath();
    g.fill();
    // 衬衫（肩宽、往下收）+ 短袖
    g.fillStyle = o.shirt;
    g.beginPath();
    g.moveTo(cx - 58, top + 40);
    g.quadraticCurveTo(cx, top + 24, cx + 58, top + 40);
    g.lineTo(cx + 72, top + 92);
    g.lineTo(cx + 50, top + 100);
    g.lineTo(cx + 40, top + 158);
    g.lineTo(cx - 40, top + 158);
    g.lineTo(cx - 50, top + 100);
    g.lineTo(cx - 72, top + 92);
    g.closePath();
    g.fill();
    // 门襟与扣子
    g.strokeStyle = 'rgba(0,0,0,0.28)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, top + 44);
    g.lineTo(cx, top + 156);
    g.stroke();
    g.fillStyle = 'rgba(230,230,220,0.6)';
    for (let i = 0; i < 4; i++) {
      ellipse(g, cx + 4, top + 62 + i * 24, 2.2, 2.2);
      g.fill();
    }
    // 领口：浅色的两片翻领
    g.fillStyle = 'rgba(220,222,226,0.85)';
    g.beginPath();
    g.moveTo(cx - 20, top + 30);
    g.lineTo(cx - 2, top + 52);
    g.lineTo(cx - 30, top + 46);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(cx + 20, top + 30);
    g.lineTo(cx + 2, top + 52);
    g.lineTo(cx + 30, top + 46);
    g.closePath();
    g.fill();
    // 红袖箍（左臂）
    g.fillStyle = '#b8322a';
    g.beginPath();
    g.moveTo(cx - 70, top + 70);
    g.lineTo(cx - 50, top + 66);
    g.lineTo(cx - 52, top + 84);
    g.lineTo(cx - 72, top + 88);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,230,120,0.8)';
    g.fillRect(cx - 66, top + 74, 10, 3);
    g.restore();
  };

  // —— 老周：冷青的魂影（衣服的本色透出一点），戴带帽檐的单帽，睁着眼抬头看镜头
  const zx = w * 0.36, ztop = h * 0.3;
  g.save();
  g.shadowColor = 'rgba(143,211,214,0.9)';
  g.shadowBlur = 22;
  figure(zx, ztop, { shirt: '#6f9fa8', pants: '#3f6670', skin: '#a9d3d4', alpha: 0.82, headless: false });
  g.restore();
  // 脖子与脸（俯拍、抬着头：脸朝上，帽檐压在额头上）
  g.fillStyle = 'rgba(169,211,212,0.85)';
  g.fillRect(zx - 12, ztop + 14, 24, 22);
  paintZhouFace(g, zx, ztop - 16, 62, { ink: '#123638', skin: 'rgba(176,216,216,0.92)', shade: 'rgba(20,70,74,0.35)', light: 'rgba(235,255,255,0.7)', weight: 1.15, seed: 1960, lookUp: true });
  // 单帽：藏蓝的帽墙 + 帽檐（冲着镜头）
  g.fillStyle = 'rgba(46,58,85,0.95)';
  g.beginPath();
  g.moveTo(zx - 30, ztop - 36);
  g.quadraticCurveTo(zx, ztop - 70, zx + 30, ztop - 36);
  g.lineTo(zx + 32, ztop - 30);
  g.lineTo(zx - 32, ztop - 30);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(30,38,58,0.95)';
  ellipse(g, zx, ztop - 30, 36, 8);
  g.fill();
  // 魂影的一圈冷光
  const aura = g.createRadialGradient(zx, ztop + 90, 20, zx, ztop + 90, 170);
  aura.addColorStop(0, 'rgba(143,211,214,0.12)');
  aura.addColorStop(1, 'rgba(143,211,214,0)');
  g.fillStyle = aura;
  g.fillRect(0, 0, w, h);

  // —— 没有头的身子：藏蓝值勤衬衫、领口、袖箍；脖子上是托头的支架（一块金属托板、两颗螺丝）
  const bxc = w * 0.64, btop = h * 0.33;
  figure(bxc, btop, { shirt: '#2E3A55', pants: '#2a2c33', skin: '#b08a6e', alpha: 1, headless: true });
  g.fillStyle = '#9a9ea6';
  g.fillRect(bxc - 9, btop + 6, 18, 26);
  g.fillStyle = '#c9ccd2';
  ellipse(g, bxc, btop + 6, 24, 7);
  g.fill();
  g.fillStyle = '#5a5e66';
  ellipse(g, bxc - 12, btop + 6, 2.5, 2);
  g.fill();
  ellipse(g, bxc + 12, btop + 6, 2.5, 2);
  g.fill();

  // 左上角：镜头自己的铁皮帽檐压进画里
  g.fillStyle = '#2b2d31';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(w * 0.2, 0);
  g.quadraticCurveTo(w * 0.1, h * 0.03, 0, h * 0.11);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(200,190,170,0.35)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(w * 0.2, 0);
  g.quadraticCurveTo(w * 0.1, h * 0.03, 0, h * 0.11);
  g.stroke();

  // 黎明粉的调子、暗角与 OSD
  g.fillStyle = 'rgba(242,184,160,0.16)';
  g.fillRect(0, 0, w, h);
  const v = g.createRadialGradient(w / 2, h / 2, h * 0.32, w / 2, h / 2, w * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  paperGrain(g, w, h, 58, 0.06);
  g.fillStyle = PALETTE.OSD;
  g.font = `bold 24px ${FONT_STACK}`;
  g.textAlign = 'left';
  g.fillText('CH1 2026-08-28 周五 04:57:45', 20, 34);
}

/**
 * 合影那一刻留下的大“照片”（M4 第 2 轮）：从刚渲染完的画布（PhotoSystem 的缩略图刚 renderNow() 过，同一任务里内容还在）
 * 4:3 居中裁下来，按片尾卡的画面区尺寸缩放，提亮（sRGB ×1.9，约 +1.2EV 以上：卡片材质还压着 0.6 的中间调）、铺一层黎明粉、压一圈暗角。
 */
export function paintFinalPrint(src: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || src.width <= 0 || src.height <= 0) return null;
  const cv = document.createElement('canvas');
  cv.width = PIC.w;
  cv.height = PIC.h;
  const g = cv.getContext('2d');
  if (!g) return null;
  let cw = src.width, ch = (src.width * 3) / 4;
  if (ch > src.height) {
    ch = src.height;
    cw = (src.height * 4) / 3;
  }
  g.filter = 'brightness(1.9) contrast(1.04) saturate(0.9)';
  g.drawImage(src, (src.width - cw) / 2, (src.height - ch) / 2, cw, ch, 0, 0, PIC.w, PIC.h);
  g.filter = 'none';
  g.globalCompositeOperation = 'soft-light';
  g.fillStyle = 'rgba(242,184,160,0.35)';
  g.fillRect(0, 0, PIC.w, PIC.h);
  g.globalCompositeOperation = 'screen';
  g.fillStyle = 'rgba(242,184,160,0.12)';
  g.fillRect(0, 0, PIC.w, PIC.h);
  g.globalCompositeOperation = 'source-over';
  const v = g.createRadialGradient(PIC.w / 2, PIC.h / 2, PIC.h * 0.34, PIC.w / 2, PIC.h / 2, PIC.w * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = v;
  g.fillRect(0, 0, PIC.w, PIC.h);
  return cv;
}

/** 片尾照片卡的贴图（画面先画“记忆里的样子”；玩家自己拍的缩略图加载好后再盖上去，见 stage.ts）。 */
export function creditCardCanvas(id: CreditPhoto, title: string, seed: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = CARD_W;
  cv.height = CARD_H;
  const g = cv.getContext('2d');
  if (g) paintCard(g, title, paintCreditPic(id), seed);
  return cv;
}

/** 蚁穴的洞（南柯）：中间深褐、往外渐浅渐透明，边上几道细土纹（贴在地面上的透明圆片）。 */
export function paintHole(): THREE.CanvasTexture {
  return paintTexture(256, 256, (g, w, h) => {
    const r = rng(1987);
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(46,36,28,1)');
    gr.addColorStop(0.62, 'rgba(58,46,36,1)');
    gr.addColorStop(0.82, 'rgba(92,74,56,0.85)');
    gr.addColorStop(1, 'rgba(120,100,78,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const a = range(r, 0, Math.PI * 2), d = range(r, 0, w * 0.44);
      g.fillStyle = `rgba(${range(r, 70, 120)},${range(r, 56, 96)},${range(r, 40, 70)},${range(r, 0.2, 0.5)})`;
      ellipse(g, w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, range(r, 1, 4), range(r, 1, 2.5), a);
      g.fill();
    }
  });
}

/** 远处住宅楼的立面（南柯的地平线）：灰蓝的墙、一格格窗，清晨零星几户亮着灯。可平铺（RepeatWrapping）。 */
export function hazeFacadeTexture(seed: number): THREE.CanvasTexture {
  const t = paintTexture(256, 256, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = '#8c949b';
    g.fillRect(0, 0, w, h);
    const cols = 8, rows = 8;
    for (let y = 0; y < rows; y++) {
      g.fillStyle = 'rgba(60,66,74,0.18)';
      g.fillRect(0, (y + 1) * (h / rows) - 3, w, 3);
      for (let x = 0; x < cols; x++) {
        const v = r();
        g.fillStyle = v < 0.06 ? '#e8d2a8' : v < 0.5 ? '#5f6872' : '#6c757e';
        g.fillRect(x * (w / cols) + 7, y * (h / rows) + 8, w / cols - 14, h / rows - 16);
      }
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}
