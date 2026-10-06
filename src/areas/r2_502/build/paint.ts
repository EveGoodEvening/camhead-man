// owner: R2
// R2_502 的程序化贴图：灶君纸像（灶王爷与灶王奶奶并坐，眼珠位置另有取景器叠层）、灶君对联、挂历（2019 年 12 月，冬月）、
// 白瓷砖、红漆地面、家具搬走留下的灰印、墙上的相框印与身高刻度、窗外的月夜、牡丹饼干铁盒、挂钟面。

import * as THREE from 'three';
import { agePaper, blotch, grain, paintTexture, shade, waterStain, HAND_FONT_STACK, SERIF_FONT_STACK } from '../../../kit/canvas';
import { FONT_STACK } from '../../../kit/text';
import { rng, range } from '../../../kit/rng';
import { TEXT } from '../text';

type G = CanvasRenderingContext2D;

// 纸像的逻辑布局（384×512，按 ×2 画成 768×1024：3× 取景器里凑近看也不糊）：两位的中心 x、头顶 y、缩放；
// 眼睛在局部 (±EYE_X, EYE_Y)，眼白半宽/半高、眼珠半径。年画娃娃脸：头（脸、五官、帽子、头光）绕脖子 HEAD_PIV 再放大 HEAD_S，
// 眼睛跟着大——取景器里的眼白叠层比纸上的眼睛还大一圈，要装得下眼珠往左下瞟的那一大截（P5 线索）。
const ZW = 384, ZH = 512, ZK = 2, FIG_S = 1.0, FIG_TOP = 150, EYE_X = 12.5, EYE_Y = 50, EYE_W = 11, EYE_H = 8, PUPIL = 5.2;
const HEAD_S = 1.3, HEAD_PIV = 92;
/** 脸（椭圆）在人物局部坐标里的中心 y 与半宽（放大前） */
const FACE_Y = 56, FACE_RX = 30;
const FIG_CX = { wang: ZW * 0.34, nainai: ZW * 0.66 } as const;
/** 头部局部 y → 放大后的人物局部 y */
const headY = (y: number): number => HEAD_PIV + (y - HEAD_PIV) * HEAD_S;
const eyeUv = (cx: number, sx: number): readonly [number, number] =>
  [(cx + sx * EYE_X * HEAD_S * FIG_S) / ZW, 1 - (FIG_TOP + headY(EYE_Y) * FIG_S) / ZH];
/** 灶君纸像上两双眼睛的位置（UV，v 从下往上）与大小（UV 单位）、脸的半宽（UV）——取景器里的眼珠叠层按它摆。 */
export const ZAO_EYES = {
  wang: [eyeUv(FIG_CX.wang, -1), eyeUv(FIG_CX.wang, 1)] as const,
  nainai: [eyeUv(FIG_CX.nainai, -1), eyeUv(FIG_CX.nainai, 1)] as const,
  whiteW: (EYE_W * HEAD_S * FIG_S) / ZW, whiteH: (EYE_H * HEAD_S * FIG_S) / ZH, pupil: (PUPIL * HEAD_S * FIG_S) / ZW,
  faceHalfW: (FACE_RX * HEAD_S * FIG_S) / ZW,
};

/** 在 figure() 的局部坐标里套上“头部放大”：之后画的东西绕脖子放大 HEAD_S。 */
function headSpace(g: G): void {
  g.translate(0, HEAD_PIV);
  g.scale(HEAD_S, HEAD_S);
  g.translate(0, -HEAD_PIV);
}

const INK = '#1b0f0a';
const GOLD = '#e8b84a';

/** 一位坐像（木版年画的画法：粗墨线、平涂、描金）。 */
function figure(g: G, cx: number, top: number, s: number, o: { robe: string; trim: string; face: string; hat: 'official' | 'phoenix'; beard: boolean }): void {
  g.save();
  g.translate(cx, top);
  g.scale(s, s);
  g.lineJoin = 'round';
  g.lineWidth = 3.2;
  g.strokeStyle = INK;
  // 头光（金圈，跟着头放大）
  g.save();
  headSpace(g);
  g.fillStyle = 'rgba(232,184,74,0.55)';
  g.beginPath();
  g.arc(0, 52, 46, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 2 / HEAD_S;
  g.stroke();
  g.restore();
  g.lineWidth = 3.2;
  // 椅背（朱漆、描金边）
  g.fillStyle = '#8a2a14';
  g.fillRect(-60, 82, 120, 150);
  g.strokeRect(-60, 82, 120, 150);
  g.strokeStyle = GOLD;
  g.lineWidth = 2;
  g.strokeRect(-54, 88, 108, 138);
  g.strokeStyle = INK;
  g.lineWidth = 3.2;
  // 袍子（坐姿：肩宽、下摆铺开）
  g.fillStyle = o.robe;
  g.beginPath();
  g.moveTo(-40, 90);
  g.quadraticCurveTo(-82, 150, -76, 262);
  g.lineTo(76, 262);
  g.quadraticCurveTo(82, 150, 40, 90);
  g.closePath();
  g.fill();
  g.stroke();
  // 衣褶与袖口
  g.strokeStyle = shade(o.robe, 0.55);
  g.lineWidth = 2;
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.moveTo(sx * 30, 120);
    g.quadraticCurveTo(sx * 50, 190, sx * 44, 256);
    g.stroke();
  }
  g.strokeStyle = INK;
  g.lineWidth = 3.2;
  g.fillStyle = o.trim;
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.ellipse(sx * 30, 204, 22, 12, sx * 0.3, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  // 补子（金）与玉带（红）
  g.fillStyle = GOLD;
  g.fillRect(-22, 122, 44, 40);
  g.strokeRect(-22, 122, 44, 40);
  g.strokeStyle = '#8a4a10';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(0, 142, 11, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = INK;
  g.lineWidth = 3.2;
  g.fillStyle = '#b3171d';
  g.fillRect(-62, 172, 124, 13);
  g.strokeRect(-62, 172, 124, 13);
  // 手捧笏板
  g.fillStyle = o.face;
  g.beginPath();
  g.arc(-11, 206, 9, 0, Math.PI * 2);
  g.arc(11, 206, 9, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f2ead4';
  g.fillRect(-7, 148, 14, 62);
  g.strokeRect(-7, 148, 14, 62);
  // 头部（脸、五官、帽子）整体放大：线宽按原样除回去，墨线粗细不变
  g.save();
  headSpace(g);
  g.lineWidth = 3.2 / HEAD_S;
  // 脸（圆脸、红腮）
  g.fillStyle = o.face;
  g.beginPath();
  g.ellipse(0, FACE_Y, FACE_RX, 35, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = 'rgba(214,70,60,0.35)';
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.arc(sx * 17, 68, 7, 0, Math.PI * 2);
    g.fill();
  }
  // 眼白（眼珠另画：纸上是正视的黑点，取景器里另有会动的叠层）
  g.fillStyle = '#fbf6ea';
  g.lineWidth = 1.8 / HEAD_S;
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.ellipse(sx * EYE_X, EYE_Y, EYE_W, EYE_H, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.fillStyle = INK;
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.arc(sx * EYE_X, EYE_Y, PUPIL, 0, Math.PI * 2);
    g.fill();
  }
  // 浓眉（上挑，比眼白高出一截：取景器里放大的眼白叠层不盖住眉毛）、鼻、嘴
  g.lineWidth = 4 / HEAD_S;
  g.lineCap = 'round';
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.moveTo(sx * 5, 37);
    g.quadraticCurveTo(sx * 14, 31, sx * 24, 34);
    g.stroke();
  }
  g.lineWidth = 2 / HEAD_S;
  g.beginPath();
  g.moveTo(-3, 62);
  g.quadraticCurveTo(0, 66, 3, 62);
  g.stroke();
  g.strokeStyle = '#a01818';
  g.lineWidth = 3 / HEAD_S;
  g.beginPath();
  g.arc(0, 72, 7, 0.25, Math.PI - 0.25);
  g.stroke();
  g.strokeStyle = INK;
  if (o.beard) {
    // 三绺长须
    g.fillStyle = '#15100c';
    for (const [dx, len] of [[-9, 34], [0, 46], [9, 34]] as const) {
      g.beginPath();
      g.moveTo(dx - 4, 76);
      g.quadraticCurveTo(dx, 76 + len, dx + 4, 76);
      g.fill();
    }
  }
  // 帽子
  g.lineWidth = 3 / HEAD_S;
  if (o.hat === 'official') {
    g.fillStyle = '#141414';
    g.fillRect(-27, 8, 54, 24);
    g.fillRect(-52, 20, 104, 7);
    g.fillStyle = GOLD;
    g.fillRect(-6, 12, 12, 10);
  } else {
    g.fillStyle = GOLD;
    g.beginPath();
    g.moveTo(-32, 28);
    g.quadraticCurveTo(0, -12, 32, 28);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#c0161b';
    for (const sx of [-1, 0, 1]) {
      g.beginPath();
      g.arc(sx * 17, 12 - (sx === 0 ? 5 : 0), 5.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }
  g.restore();
  g.restore();
}

/** 灶君纸像（逻辑 384×512，画成 768×1024）：上头红底金字“东厨司命”，帐幔下灶王爷（左）与灶王奶奶（右）并坐，供桌、香炉、红烛，
 *  底下“一家之主”；熏了七年的油烟与水渍。 */
export function zaojunTexture(): THREE.CanvasTexture {
  return paintTexture(ZW * ZK, ZH * ZK, g0 => {
    const g = g0;
    g.setTransform(ZK, 0, 0, ZK, 0, 0);
    const w = ZW, h = ZH;
    g.fillStyle = '#efe0bc';
    g.fillRect(0, 0, w, h);
    // 边框：红、金、回纹
    g.strokeStyle = '#b3171d';
    g.lineWidth = 10;
    g.strokeRect(5, 5, w - 10, h - 10);
    g.strokeStyle = GOLD;
    g.lineWidth = 2;
    g.strokeRect(13, 13, w - 26, h - 26);
    g.strokeStyle = '#b3171d';
    g.lineWidth = 2;
    for (let x = 22; x < w - 22; x += 16) {
      g.strokeRect(x, 16, 8, 6);
      g.strokeRect(x, h - 22, 8, 6);
    }
    // 题头
    g.fillStyle = '#b3171d';
    g.fillRect(18, 26, w - 36, 52);
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    g.strokeRect(18, 26, w - 36, 52);
    g.fillStyle = '#f5d67a';
    g.font = `bold 40px ${SERIF_FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(TEXT.set.zaoTitle, w / 2, 53);
    // 帐幔（绿缎、金流苏）
    g.fillStyle = '#2f6b4a';
    g.beginPath();
    g.moveTo(18, 82);
    for (let i = 0; i <= 6; i++) g.quadraticCurveTo(18 + (i - 0.5) * ((w - 36) / 6), 122, 18 + i * ((w - 36) / 6), 82);
    g.lineTo(w - 18, 82);
    g.closePath();
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = GOLD;
    for (let i = 0; i <= 6; i++) g.fillRect(18 + i * ((w - 36) / 6) - 2, 84, 4, 22);
    // 祥云
    g.fillStyle = 'rgba(70,130,160,0.55)';
    g.strokeStyle = 'rgba(27,15,10,0.7)';
    g.lineWidth = 1.5;
    for (const [x, y] of [[42, 150], [342, 156], [48, 400], [336, 404]] as const) {
      g.beginPath();
      g.arc(x, y, 18, 0, Math.PI * 2);
      g.arc(x + 18, y - 6, 13, 0, Math.PI * 2);
      g.arc(x - 16, y - 4, 11, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    // 两位（眼睛位置与 ZAO_EYES 对齐）
    figure(g, FIG_CX.wang, FIG_TOP, FIG_S, { robe: '#2f5a8a', trim: '#e8b84a', face: '#f0c8a0', hat: 'official', beard: true });
    figure(g, FIG_CX.nainai, FIG_TOP, FIG_S, { robe: '#b3303a', trim: '#2f6b4a', face: '#f3cfb0', hat: 'phoenix', beard: false });
    // 供桌、香炉、红烛、供果
    const ty = h * 0.8;
    g.fillStyle = '#8a3a1a';
    g.fillRect(34, ty, w - 68, 28);
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.strokeRect(34, ty, w - 68, 28);
    g.fillStyle = GOLD;
    g.fillRect(34, ty + 10, w - 68, 5);
    g.fillStyle = '#6a6a5a';
    g.beginPath();
    g.moveTo(w / 2 - 24, ty);
    g.lineTo(w / 2 - 18, ty - 24);
    g.lineTo(w / 2 + 18, ty - 24);
    g.lineTo(w / 2 + 24, ty);
    g.closePath();
    g.fill();
    g.stroke();
    for (const x of [w / 2 - 70, w / 2 + 70]) {
      g.fillStyle = '#c0161b';
      g.fillRect(x - 5, ty - 40, 10, 40);
      g.strokeRect(x - 5, ty - 40, 10, 40);
      g.fillStyle = '#f5b83a';
      g.beginPath();
      g.ellipse(x, ty - 47, 4, 8, 0, 0, Math.PI * 2);
      g.fill();
    }
    for (const x of [w / 2 - 120, w / 2 + 120]) {
      g.fillStyle = '#e06a2a';
      for (const [dx, dy] of [[-8, 0], [8, 0], [0, -10]] as const) {
        g.beginPath();
        g.arc(x + dx, ty - 9 + dy, 8, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
    // 底款“一家之主”
    g.fillStyle = '#b3171d';
    g.fillRect(w / 2 - 70, h - 60, 140, 30);
    g.strokeRect(w / 2 - 70, h - 60, 140, 30);
    g.fillStyle = '#f5d67a';
    g.font = `bold 22px ${SERIF_FONT_STACK}`;
    g.fillText(TEXT.set.zaoFoot, w / 2, h - 44);
    // 七年没点火也熏黄了：油烟、水渍（整张按像素做，先把变换复位）
    g.setTransform(1, 0, 0, 1, 0, 0);
    agePaper(g, w * ZK, h * ZK, 0.7, 1986, 3);
    const r = rng(7);
    for (let i = 0; i < 12; i++) blotch(g, r, r() * w * ZK, range(r, 0.62, 1) * h * ZK, range(r, 20, 60), 'rgba(90,60,20,1)', 0.1, 4);
    grain(g, w * ZK, h * ZK, 0.1, 8);
  });
}

/** 灶君对联两条（竖幅 64×384 各一，拼在 128×384 里）：左“回宫降吉祥”、右“上天言好事”（面对灶台看，上联在右）。 */
export function coupletTexture(): THREE.CanvasTexture {
  return paintTexture(128, 512, (g, w, h) => {
    const strip = (x: number, text: string, seed: number) => {
      g.fillStyle = '#b3171d';
      g.fillRect(x + 2, 0, w / 2 - 4, h);
      const r = rng(seed);
      for (let i = 0; i < 6; i++) blotch(g, r, x + r() * (w / 2), r() * h, range(r, 8, 20), 'rgba(235,190,170,1)', 0.15, 4);
      g.fillStyle = '#1a0c08';
      g.font = `bold 46px ${SERIF_FONT_STACK}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      [...text].forEach((c, i) => g.fillText(c, x + w / 4, 60 + i * 96));
    };
    strip(0, TEXT.set.coupletDown, 3);
    strip(w / 2, TEXT.set.coupletUp, 4);
  });
}

/** 挂历 256×384：上半张桂林山水，下半 2019 年 12 月，每天底下印农历（1 日 = 冬月初六，26 日起是腊月）；21 日上画了个圈。 */
export function calendarTexture(): THREE.CanvasTexture {
  return paintTexture(256, 384, (g, w, h) => {
    g.fillStyle = '#f2ede0';
    g.fillRect(0, 0, w, h);
    // 山水
    const sky = g.createLinearGradient(0, 0, 0, h * 0.42);
    sky.addColorStop(0, '#9ec3d8');
    sky.addColorStop(1, '#e6e0c8');
    g.fillStyle = sky;
    g.fillRect(10, 10, w - 20, h * 0.4);
    g.fillStyle = '#4f7a5c';
    for (const [x, hh] of [[40, 80], [90, 110], [150, 90], [205, 70]] as const) {
      g.beginPath();
      g.moveTo(x - 40, h * 0.41);
      g.quadraticCurveTo(x, h * 0.41 - hh * 1.6, x + 40, h * 0.41);
      g.fill();
    }
    g.fillStyle = '#6d9ab0';
    g.fillRect(10, h * 0.37, w - 20, h * 0.04);
    // 年月
    g.fillStyle = '#b3171d';
    g.font = `bold 44px ${FONT_STACK}`;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillText(TEXT.set.calMonth, 14, h * 0.55);
    g.font = `bold 16px ${FONT_STACK}`;
    g.fillStyle = '#333';
    g.fillText(TEXT.set.calYear, 68, h * 0.5);
    g.fillText(`${TEXT.set.calLunar}`, 68, h * 0.545);
    // 星期
    const wk = TEXT.set.calWeek;
    const cw = (w - 20) / 7;
    g.font = `12px ${FONT_STACK}`;
    g.textAlign = 'center';
    wk.forEach((d, i) => { g.fillStyle = i === 0 || i === 6 ? '#b3171d' : '#333'; g.fillText(d, 10 + cw * (i + 0.5), h * 0.6); });
    // 2019-12-01 是星期日、冬月初六
    const lunar = TEXT.set.calLunarDays;
    for (let d = 1; d <= 31; d++) {
      const i = d - 1, col = i % 7, row = Math.floor(i / 7);
      const x = 10 + cw * (col + 0.5), y = h * 0.66 + row * 26;
      g.fillStyle = col === 0 || col === 6 ? '#b3171d' : '#222';
      g.font = `bold 15px ${FONT_STACK}`;
      g.fillText(String(d), x, y);
      g.font = `8px ${FONT_STACK}`;
      g.fillStyle = '#666';
      g.fillText(lunar[i] ?? '', x, y + 10);
      if (d === 21) {
        g.strokeStyle = 'rgba(200,30,30,0.85)';
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(x, y - 3, 12, 11, 0.2, 0, Math.PI * 2);
        g.stroke();
      }
    }
    agePaper(g, w, h, 0.5, 2019, 2);
    grain(g, w, h, 0.1, 12);
  });
}

/** 白瓷砖 256×256（4×4 块，一张 0.8m）：发黄的缝、零星裂纹与油点。 */
export function tileTexture(): THREE.CanvasTexture {
  return paintTexture(256, 256, (g, w, h) => {
    const r = rng(66);
    g.fillStyle = '#8e8a7c';
    g.fillRect(0, 0, w, h);
    const s = w / 4;
    for (let row = 0; row < 4; row++) {
      for (let c = 0; c < 4; c++) {
        const x = c * s + 2, y = row * s + 2, ts = s - 4;
        g.fillStyle = shade('#e2ded0', range(r, 0.86, 0.97));
        g.fillRect(x, y, ts, ts);
        const grd = g.createLinearGradient(x, y, x + ts, y + ts);
        grd.addColorStop(0, 'rgba(255,255,255,0.14)');
        grd.addColorStop(0.5, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.fillRect(x, y, ts, ts);
        g.strokeStyle = 'rgba(120,95,50,0.3)';
        g.lineWidth = 2;
        g.strokeRect(x + 1, y + 1, ts - 2, ts - 2);
        if (r() < 0.15) {
          g.strokeStyle = 'rgba(60,55,50,0.45)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x + r() * ts, y);
          g.lineTo(x + r() * ts, y + ts);
          g.stroke();
        }
      }
    }
    for (let i = 0; i < 14; i++) blotch(g, r, r() * w, r() * h, range(r, 4, 14), 'rgba(140,100,40,1)', 0.18, 3);
  }, { repeat: [1, 1] });
}

/** 红漆水泥地 512²（一张 2m）：漆掉了一块一块，踩出来的走道。 */
export function floorTexture(): THREE.CanvasTexture {
  return paintTexture(512, 512, (g, w, h) => {
    const r = rng(33);
    g.fillStyle = '#56372e';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) blotch(g, r, r() * w, r() * h, range(r, 20, 70), '#62402f', 0.3, 5);
    // 漆磨掉露出的水泥
    for (let i = 0; i < 26; i++) blotch(g, r, r() * w, r() * h, range(r, 10, 44), '#6d665c', 0.4, 5);
    // 地板缝（水泥地分格）
    g.fillStyle = 'rgba(20,12,10,0.5)';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, 0, 2, h);
    grain(g, w, h, 0.18, 34);
  }, { repeat: [1, 1], anisotropy: 4 });
}

/**
 * 客厅地上的灰印 512×410（5m×4m，透明底；画布上方 = 北墙）：满地一层匀匀的灰，门口到厨房、卧室踩出两条淡道；
 * 家具站过的地方是干净的红漆地——北墙的沙发、东北角的大衣柜、窗下的缝纫机（正好在地上那块月光里）、隔墙边的电视柜、
 * 八仙桌的四条腿；大衣柜往门口拖出去的划痕。
 */
export function dustTexture(): THREE.CanvasTexture {
  return paintTexture(512, 410, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = rng(19);
    const px = (m: number) => (m / 5) * w, pz = (m: number) => ((m + 4) / 4) * h;   // 世界 x、z → 画布
    // 匀匀的一层灰 + 深浅不一的几片 + 细灰粒
    g.fillStyle = 'rgba(205,200,188,0.13)';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) blotch(g, r, r() * w, r() * h, range(r, 30, 80), r() < 0.5 ? 'rgba(215,210,198,1)' : 'rgba(120,112,100,1)', 0.05, 5);
    for (let i = 0; i < 3500; i++) {
      g.fillStyle = `rgba(215,210,200,${range(r, 0.08, 0.22)})`;
      g.fillRect(r() * w, r() * h, 1.2, 1.2);
    }
    g.globalCompositeOperation = 'destination-out';
    // 踩出来的道：入户门 → 厨房门、入户门 → 卧室门
    g.filter = 'blur(10px)';
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 42;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(px(0.1), pz(-0.8));
    g.quadraticCurveTo(px(2.5), pz(-1.2), px(4.95), pz(-1.5));
    g.moveTo(px(0.4), pz(-0.9));
    g.quadraticCurveTo(px(1.1), pz(-2.4), px(1.4), pz(-3.95));
    g.stroke();
    // 家具站过的地方（边缘略软）
    g.filter = 'blur(1.5px)';
    g.fillStyle = 'rgba(0,0,0,0.95)';
    const clean = (x0: number, z0: number, x1: number, z1: number) => g.fillRect(px(x0), pz(z0), px(x1) - px(x0), pz(z1) - pz(z0));
    clean(1.9, -3.93, 3.9, -3.12);   // 沙发
    clean(3.72, -3.93, 4.92, -3.36);   // 大衣柜
    clean(2.6, -0.95, 3.45, -0.45);   // 缝纫机
    clean(4.36, -2.35, 4.92, -1.05);   // 电视柜
    for (const [x, z] of [[1.35, -2.1], [2.25, -2.1], [1.35, -1.2], [2.25, -1.2]] as const) {
      g.beginPath();
      g.arc(px(x), pz(z), 5, 0, Math.PI * 2);
      g.fill();
    }
    g.filter = 'none';
    // 大衣柜拖出去的划痕（划开了灰）
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(px(3.85) + i * 7, pz(-3.3));
      g.lineTo(px(3.2) + i * 7, pz(-1.7));
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  });
}

/** 灶台后墙上熏黑的一片 256²（透明底）：底下窄、往上散开的烟熏，几道往上的黑痕；也当顶棚上那一圈用。 */
export function sootTexture(): THREE.CanvasTexture {
  return paintTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = rng(77);
    for (let i = 0; i < 26; i++) {
      const t = r();
      const y = h * (1 - t * 0.95), spread = w * (0.12 + t * 0.34);
      blotch(g, r, w / 2 + range(r, -spread, spread) * 0.6, y, range(r, 24, 50) * (0.6 + t), 'rgba(24,18,12,1)', 0.08 + (1 - t) * 0.06, 5);
    }
    for (let i = 0; i < 7; i++) {
      const x = w / 2 + range(r, -0.3, 0.3) * w, y0 = h * range(r, 0.45, 0.9);
      const grd = g.createLinearGradient(0, y0, 0, y0 - h * 0.45);
      grd.addColorStop(0, 'rgba(20,14,8,0.22)');
      grd.addColorStop(1, 'rgba(20,14,8,0)');
      g.fillStyle = grd;
      g.fillRect(x, y0 - h * 0.45, range(r, 3, 8), h * 0.45);
    }
    // 边缘淡出（不留方边）
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createRadialGradient(w / 2, h * 0.62, w * 0.12, w / 2, h * 0.55, w * 0.56);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
  });
}

/** 墙上的印子 512×256：相框挪走后干净的一块、钉子、门框上的身高刻度。 */
export function wallMarksTexture(): THREE.CanvasTexture {
  return paintTexture(512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    // 左：相框印（比四周白一块，边上一圈灰）
    g.fillStyle = 'rgba(255,250,235,0.35)';
    g.fillRect(20, 30, 180, 130);
    g.strokeStyle = 'rgba(80,70,50,0.35)';
    g.lineWidth = 5;
    g.strokeRect(20, 30, 180, 130);
    g.fillStyle = '#333';
    g.beginPath();
    g.arc(110, 20, 4, 0, Math.PI * 2);
    g.fill();
    // 右：身高刻度（铅笔）
    g.strokeStyle = 'rgba(40,40,45,0.8)';
    g.fillStyle = 'rgba(40,40,45,0.8)';
    g.lineWidth = 2;
    g.font = `16px ${HAND_FONT_STACK}`;
    g.textAlign = 'left';
    const marks = [230, 180, 128, 70, 22].map((y, i) => [y, TEXT.set.heightMarks[i] ?? ''] as const);
    for (const [y, t] of marks) {
      g.beginPath();
      g.moveTo(300, y);
      g.lineTo(340, y);
      g.stroke();
      g.fillText(t, 346, y + 5);
    }
    const r = rng(3);
    waterStain(g, r, 120, 200, 40);
  });
}

/** 窗外的月夜 256²：一轮月亮（HDR：材质颜色放大后月芯烧白）、云、远处屋顶的剪影与一两扇亮窗。 */
export function moonWindowTexture(seed: number, moonU?: number): THREE.CanvasTexture {
  return paintTexture(256, 256, (g, w, h) => {
    const r = rng(seed);
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0a1024');
    sky.addColorStop(0.7, '#1c2640');
    sky.addColorStop(1, '#141824');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const mx = w * (moonU ?? range(r, 0.3, 0.7)), my = h * range(r, 0.18, 0.3);
    // 七月十五，月亮是圆的：一轮大月亮（材质颜色放大后月面烧白）+ 一圈淡蓝的晕
    const halo = g.createRadialGradient(mx, my, 2, mx, my, w * 0.6);
    halo.addColorStop(0, 'rgba(250,252,255,1)');
    halo.addColorStop(0.21, 'rgba(238,245,255,1)');
    halo.addColorStop(0.27, 'rgba(200,222,245,0.7)');
    halo.addColorStop(0.45, 'rgba(140,170,210,0.25)');
    halo.addColorStop(1, 'rgba(120,150,190,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(60,70,90,0.5)';
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.ellipse(r() * w, range(r, 0.1, 0.5) * h, range(r, 30, 70), range(r, 6, 12), 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#07080c';
    let x = 0;
    while (x < w) {
      const bw = range(r, 30, 70), bh = range(r, 0.25, 0.45) * h;
      g.fillRect(x, h - bh, bw, bh);
      // 对面楼零星几扇还亮着的窗（拆迁前夜，大多黑了）
      for (let k = 0; k < 2; k++) {
        if (r() < 0.45) {
          g.fillStyle = r() < 0.7 ? 'rgba(255,205,130,1)' : 'rgba(200,230,255,1)';
          g.fillRect(x + range(r, 5, bw - 12), h - bh + range(r, 8, bh * 0.6), 7, 9);
          g.fillStyle = '#07080c';
        }
      }
      x += bw + range(r, 2, 10);
    }
  });
}

/** 牡丹饼干铁盒的盖面 256×160。 */
export function tinTexture(): THREE.CanvasTexture {
  return paintTexture(256, 160, (g, w, h) => {
    g.fillStyle = '#1e3f7a';
    g.fillRect(0, 0, w, h);
    const r = rng(15);
    for (const [x, y, s] of [[60, 70, 34], [190, 60, 28], [130, 110, 22]] as const) {
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        g.fillStyle = k % 2 ? '#e6457a' : '#f07aa0';
        g.beginPath();
        g.ellipse(x + Math.cos(a) * s * 0.5, y + Math.sin(a) * s * 0.5, s * 0.5, s * 0.32, a, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#f2d27a';
      g.beginPath();
      g.arc(x, y, s * 0.22, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#f2d27a';
    g.font = `bold 30px ${SERIF_FONT_STACK}`;
    g.textAlign = 'center';
    g.fillText(TEXT.set.tin, w / 2, 32);
    for (let i = 0; i < 18; i++) blotch(g, r, r() * w, r() * h, range(r, 3, 9), '#7a4a22', 0.45, 3);
  });
}

/** 挂钟面 128²。 */
export function clockTexture(): THREE.CanvasTexture {
  return paintTexture(128, 128, (g, w) => {
    g.fillStyle = '#efe9d8';
    g.beginPath();
    g.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#222';
    g.font = `bold 13px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      g.fillText(String(i), w / 2 + Math.cos(a) * 48, w / 2 + Math.sin(a) * 48);
    }
    g.fillStyle = '#b3171d';
    g.font = `9px ${FONT_STACK}`;
    g.fillText(TEXT.set.clockBrand, w / 2, w * 0.68);
  });
}

/**
 * 建国的信的最后一页（逻辑 256×346 = 信纸道具 0.2×0.27m，画成 ×2）：单位信纸的红格线、蓝黑墨水的钢笔字（每个字微微歪一点）、
 * 叠过三折的折痕。读信过场的近景里看得清“就是皮擀不圆”那一行（TEXT.set.letterPage）。
 */
export function letterTexture(): THREE.CanvasTexture {
  const LW = 256, LH = 346, LK = 2;
  return paintTexture(LW * LK, LH * LK, g0 => {
    const g = g0;
    g.setTransform(LK, 0, 0, LK, 0, 0);
    g.fillStyle = '#efe8d4';
    g.fillRect(0, 0, LW, LH);
    // 红格线（天头一道粗线）
    const x0 = 20, x1 = LW - 16, top = 34, lh = 25;
    g.strokeStyle = 'rgba(190,40,40,0.55)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x0 - 4, top - 10);
    g.lineTo(x1 + 4, top - 10);
    g.stroke();
    g.lineWidth = 0.7;
    for (let y = top + lh; y < LH - 12; y += lh) {
      g.beginPath();
      g.moveTo(x0 - 4, y + 5);
      g.lineTo(x1 + 4, y + 5);
      g.stroke();
    }
    // 钢笔字：段首空两格、逐字排、到行尾换行；落款靠右
    const r = rng(2025);
    const fs = 17.5, step = 18.6;
    g.font = `${fs}px ${HAND_FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#1f2946';
    const perLine = Math.floor((x1 - x0) / step);
    let row = 1;
    const put = (ch: string, col: number, rw: number): void => {
      g.save();
      g.translate(x0 + (col + 0.5) * step + range(r, -0.8, 0.8), top + rw * lh + range(r, -0.8, 0.8));
      g.rotate(range(r, -0.05, 0.05));
      g.fillText(ch, 0, 0);
      g.restore();
    };
    const paras = TEXT.set.letterPage;
    paras.forEach((para, pi) => {
      const chars = [...para];
      if (pi === paras.length - 1) {
        // 落款：“儿　建国”一行、日期一行，都靠右
        const [who, date] = para.split(/　(?=二〇)/);
        for (const [line, rw] of [[who ?? para, row], [date ?? '', row + 1]] as const) {
          const cs = [...line];
          cs.forEach((ch, i) => put(ch, perLine - cs.length + i, rw));
        }
        row += 2;
        return;
      }
      let col = 2;
      for (const ch of chars) {
        if (col >= perLine) {
          col = 0;
          row++;
        }
        put(ch, col, row);
        col++;
      }
      row++;
    });
    // 叠过三折的折痕、边上一点铁盒里捂出来的黄
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (const f of [1 / 3, 2 / 3]) {
      const y = f * LH * LK;
      const grd = g.createLinearGradient(0, y - 6, 0, y + 6);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(0.5, 'rgba(90,70,40,0.22)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, y - 6, LW * LK, 12);
    }
    agePaper(g, LW * LK, LH * LK, 0.35, 2025, 1);
    grain(g, LW * LK, LH * LK, 0.06, 5);
  });
}
