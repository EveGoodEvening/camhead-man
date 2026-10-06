// owner: R2
// R2 的程序化贴图（CanvasTexture，ARCH §10.1、GDD §9.4）：水磨石地面、标牌图集（门牌、春联、福、楼层号、停用、电表箱、消防栓……）、
// 污渍图集、门神年画、捐款榜、窗外夜景。尺寸按 §13.3 的 CanvasTexture 预算控制（本区合计约 12MB）。

import * as THREE from 'three';
import { PALETTE } from '../../../data/palette';
import { agePaper, blotch, grain, paintTexture, shade, waterStain, HAND_FONT_STACK, SERIF_FONT_STACK } from '../../../kit/canvas';
import { FONT_STACK } from '../../../kit/text';
import { rng, range } from '../../../kit/rng';
import { TEXT } from '../text';

type G = CanvasRenderingContext2D;
export type Rect = readonly [number, number, number, number];

// ==================================================================== 地面

/** 水磨石（灰绿底、白黑石子、铜分隔条每 1m 一格；1 张 = 2m）。 */
export function terrazzo(seed = 3): THREE.CanvasTexture {
  const r = rng(seed);
  return paintTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#6f746c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i++) {
      const x = r() * w, y = r() * h, s = range(r, 0.8, 3.4);
      const k = r();
      g.fillStyle = k < 0.45 ? '#d8d4c8' : k < 0.7 ? '#2a2a28' : k < 0.85 ? '#8d6f58' : '#a9b2a4';
      g.beginPath();
      g.ellipse(x, y, s, s * range(r, 0.6, 1), r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    // 分隔条
    g.fillStyle = 'rgba(150,120,70,0.8)';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, h / 2, w, 2);
    g.fillRect(0, 0, 2, h);
    g.fillRect(w / 2, 0, 2, h);
    // 踩旧的发暗走道、泥点
    for (let i = 0; i < 26; i++) blotch(g, r, r() * w, r() * h, range(r, 20, 60), '#3a3c36', 0.1, 5);
    grain(g, w, h, 0.15, seed + 1);
  }, { repeat: [1, 1], anisotropy: 4 });
}

// ==================================================================== 标牌图集（1024²，透明底；rect 为 UV [u0,v0,u1,v1]，v 从下往上）

export interface Atlas { tex: THREE.CanvasTexture; rect(name: string): Rect }

const ATLAS = 1024;

function atlasRect(x: number, y: number, w: number, h: number): Rect {
  return [x / ATLAS, 1 - (y + h) / ATLAS, (x + w) / ATLAS, 1 - y / ATLAS];
}

function redPaper(g: G, x: number, y: number, w: number, h: number, seed: number, fade = 0.2): void {
  const r = rng(seed);
  g.fillStyle = '#b3171d';
  g.fillRect(x, y, w, h);
  // 褪色、雨水印、撕破的边
  for (let i = 0; i < 8; i++) blotch(g, r, x + r() * w, y + r() * h, range(r, 6, 22) * (w / 80), 'rgba(235,190,170,1)', fade * 0.5, 4);
  g.fillStyle = 'rgba(40,5,5,0.25)';
  g.fillRect(x, y, w, 3);
}

function vertText(g: G, text: string, x: number, y: number, w: number, h: number, color: string, font: string): void {
  const chars = [...text];
  const step = h / chars.length;
  g.fillStyle = color;
  g.font = `bold ${Math.round(Math.min(w * 0.82, step * 0.86))}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  chars.forEach((c, i) => g.fillText(c, x + w / 2, y + step * (i + 0.5)));
}

export function signAtlas(): Atlas {
  const rects = new Map<string, Rect>();
  const put = (name: string, x: number, y: number, w: number, h: number) => rects.set(name, atlasRect(x, y, w, h));
  const tex = paintTexture(ATLAS, ATLAS, (g, W) => {
    g.clearRect(0, 0, W, W);
    // —— 春联（两条竖幅 64×448）与横批、福 ——
    const couplets: [string, string][] = [[TEXT.set.springL, TEXT.set.springR]];
    couplets.forEach(([l, rr], i) => {
      redPaper(g, 0 + i * 140, 0, 64, 448, 11 + i, 0.35);
      vertText(g, l, 0 + i * 140, 8, 64, 432, '#1a0c08', SERIF_FONT_STACK);
      redPaper(g, 68 + i * 140, 0, 64, 448, 21 + i, 0.3);
      vertText(g, rr, 68 + i * 140, 8, 64, 432, '#1a0c08', SERIF_FONT_STACK);
      put('coupletL', 0, 0, 64, 448);
      put('coupletR', 68, 0, 64, 448);
    });
    // 横批
    redPaper(g, 140, 0, 256, 64, 31, 0.3);
    g.fillStyle = '#1a0c08';
    g.font = `bold 44px ${SERIF_FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(TEXT.set.banner, 268, 34);
    put('banner', 140, 0, 256, 64);
    // 倒福（菱形）
    g.save();
    g.translate(220, 150);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#c0161b';
    g.fillRect(-58, -58, 116, 116);
    g.strokeStyle = '#e6b94a';
    g.lineWidth = 4;
    g.strokeRect(-52, -52, 104, 104);
    g.rotate(-Math.PI / 4 + Math.PI);
    g.fillStyle = '#1a0c08';
    g.font = `bold 76px ${SERIF_FONT_STACK}`;
    g.fillText(TEXT.set.fu, 0, 4);
    g.restore();
    put('fu', 138, 68, 164, 164);

    // —— 门牌（蓝搪瓷，白字）96×56，10 块 ——
    const plates = ['101', '102', '201', '202', '301', '302', '401', '402', '501', '502'];
    plates.forEach((p, i) => {
      const x = 400 + (i % 6) * 100, y = (Math.floor(i / 6)) * 60;
      g.fillStyle = '#1d4f91';
      g.beginPath();
      g.roundRect(x + 2, y + 2, 92, 52, 8);
      g.fill();
      g.strokeStyle = '#e8ecf0';
      g.lineWidth = 3;
      g.beginPath();
      g.roundRect(x + 6, y + 6, 84, 44, 6);
      g.stroke();
      g.fillStyle = '#f2f4f6';
      g.font = `bold 34px ${FONT_STACK}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(p, x + 48, y + 30);
      // 掉瓷的黑点
      const r = rng(i + 70);
      for (let k = 0; k < 3; k++) blotch(g, r, x + r() * 96, y + r() * 56, range(r, 2, 5), '#111', 0.7, 3);
      put(`plate${p}`, x, y, 96, 56);
    });

    // —— 楼层号（红漆刷在墙上，带箭头）192×96，5 块 ——
    TEXT.set.floorName.forEach((name, i) => {
      const x = 400 + (i % 3) * 200, y = 130 + Math.floor(i / 3) * 100;
      g.fillStyle = 'rgba(178,24,28,0.92)';
      g.font = `bold 64px ${FONT_STACK}`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(name, x + 8, y + 50);
      // 刷漆的滴痕
      const r = rng(90 + i);
      for (let k = 0; k < 4; k++) g.fillRect(x + range(r, 14, 130), y + 70, 3, range(r, 8, 22));
      put(`floor${i + 1}`, x, y, 192, 96);
    });

    // —— 停用（白纸红字，胶带）200×120 ——
    g.fillStyle = '#efeadc';
    g.fillRect(0, 460, 200, 120);
    g.fillStyle = '#c0161b';
    g.font = `bold 72px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(TEXT.set.stopUse, 100, 522);
    g.fillStyle = 'rgba(230,220,170,0.7)';
    g.fillRect(-4, 456, 44, 16);
    g.fillRect(164, 456, 40, 16);
    agePaperRect(g, 0, 460, 200, 120, 5);
    put('stop', 0, 460, 200, 120);
    // 电梯检修通知（A4 竖）200×280
    g.fillStyle = '#f1ecdd';
    g.fillRect(200, 300, 196, 280);
    g.fillStyle = '#1b1b1b';
    g.font = `bold 30px ${FONT_STACK}`;
    g.fillText(TEXT.set.noticeTitle, 298, 340);
    g.font = `22px ${FONT_STACK}`;
    g.textAlign = 'left';
    TEXT.set.noticeLines.forEach((l, i) => g.fillText(l, 212, 390 + i * 30));
    agePaperRect(g, 200, 300, 196, 280, 6);
    put('notice', 200, 300, 196, 280);
    // 天台已锁（铁牌）200×70
    g.fillStyle = '#d9d5c7';
    g.fillRect(420, 340, 200, 70);
    g.strokeStyle = '#8a2020';
    g.lineWidth = 4;
    g.strokeRect(424, 344, 192, 62);
    g.fillStyle = '#8a2020';
    g.font = `bold 40px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.fillText(TEXT.set.roofLocked, 520, 377);
    put('roof', 420, 340, 200, 70);
    // 楼道禁止堆放杂物（搪瓷牌）320×64
    g.fillStyle = '#f4f2ea';
    g.fillRect(630, 340, 320, 64);
    g.fillStyle = '#b3171d';
    g.fillRect(630, 340, 320, 8);
    g.fillRect(630, 396, 320, 8);
    g.font = `bold 34px ${FONT_STACK}`;
    g.fillText(TEXT.set.noPile, 790, 373);
    put('nopile', 630, 340, 320, 64);

    // —— 电表箱门 240×300（灰铁皮，四个观察窗，“电表”红字） ——
    g.fillStyle = '#8f9491';
    g.fillRect(0, 600, 240, 300);
    g.strokeStyle = '#5d625f';
    g.lineWidth = 4;
    g.strokeRect(4, 604, 232, 292);
    for (let i = 0; i < 4; i++) {
      const x = 22 + (i % 2) * 110, y = 650 + Math.floor(i / 2) * 110;
      g.fillStyle = '#1c2224';
      g.fillRect(x, y, 86, 70);
      g.fillStyle = '#d9d6c8';
      g.fillRect(x + 10, y + 12, 66, 26);
      g.fillStyle = '#222';
      g.font = `bold 20px ${FONT_STACK}`;
      g.textAlign = 'center';
      g.fillText(String(Math.floor(range(rng(i + 3), 1000, 9999))).padStart(5, '0'), x + 43, y + 26);
      g.fillStyle = '#b3171d';
      g.fillRect(x + 36, y + 48, 14, 6);
    }
    g.fillStyle = '#b3171d';
    g.font = `bold 34px ${FONT_STACK}`;
    g.fillText(TEXT.set.meter, 120, 630);
    const rm = rng(8);
    for (let i = 0; i < 18; i++) blotch(g, rm, r2(rm, 0, 240), r2(rm, 600, 900), range(rm, 4, 16), '#6b3a1a', 0.35, 3);
    put('meter', 0, 600, 240, 300);

    // —— 消防栓箱门 220×300（红，白字，玻璃窗） ——
    g.fillStyle = '#a3161a';
    g.fillRect(250, 600, 220, 300);
    g.strokeStyle = '#6d0e10';
    g.lineWidth = 5;
    g.strokeRect(254, 604, 212, 292);
    g.fillStyle = 'rgba(20,30,34,0.85)';
    g.fillRect(280, 700, 160, 150);
    g.strokeStyle = '#d0d0d0';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(360, 775, 55, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#f2f2f2';
    g.font = `bold 44px ${FONT_STACK}`;
    g.fillText(TEXT.set.fire, 360, 655);
    put('fire', 250, 600, 220, 300);

    // —— 奶箱（绿铁皮小箱正面）120×140 ——
    g.fillStyle = '#2f6b45';
    g.fillRect(480, 600, 120, 140);
    g.strokeStyle = '#1d4a2e';
    g.lineWidth = 4;
    g.strokeRect(484, 604, 112, 132);
    g.fillStyle = '#e8e4d0';
    g.font = `bold 30px ${FONT_STACK}`;
    g.fillText(TEXT.set.milk, 540, 640);
    g.fillStyle = '#1a1a1a';
    g.fillRect(500, 690, 80, 8);
    put('milk', 480, 600, 120, 140);

    // —— 开关面板（米黄塑料，一个拨杆）64×96 ——
    g.fillStyle = '#e4dcc4';
    g.fillRect(610, 600, 64, 96);
    g.fillStyle = '#b8ae94';
    g.fillRect(630, 630, 24, 36);
    g.fillStyle = 'rgba(60,50,40,0.35)';
    g.beginPath();
    g.ellipse(642, 670, 30, 20, 0, 0, Math.PI * 2);
    g.fill();
    put('switch', 610, 600, 64, 96);

    // —— 信报箱正面（4 列 × 3 行，每格一个号） 400×260 ——
    const mx = 620, my = 720;
    g.fillStyle = '#2d5a3f';
    g.fillRect(mx, my, 400, 260);
    const nums = ['101', '102', '201', '202', '301', '302', '401', '402', '501', '502', '', ''];
    nums.forEach((nm, i) => {
      const c = i % 4, rr = Math.floor(i / 4);
      const x = mx + 8 + c * 98, y = my + 8 + rr * 84;
      g.fillStyle = '#3a7352';
      g.fillRect(x, y, 90, 76);
      g.strokeStyle = '#1b3a27';
      g.lineWidth = 3;
      g.strokeRect(x, y, 90, 76);
      g.fillStyle = '#10150f';
      g.fillRect(x + 12, y + 14, 66, 7);
      if (nm) {
        g.fillStyle = '#efe9d6';
        g.fillRect(x + 22, y + 34, 46, 24);
        g.fillStyle = '#1b1b1b';
        g.font = `bold 20px ${FONT_STACK}`;
        g.fillText(nm, x + 45, y + 47);
      }
      g.fillStyle = '#b8b09a';
      g.fillRect(x + 76, y + 44, 6, 12);
      // 塞在缝里的传单
      if ((i * 7) % 3 === 0) {
        g.fillStyle = i % 2 ? '#f4e27a' : '#f0c3c8';
        g.fillRect(x + 20, y + 4, 40, 16);
      }
    });
    const rr2 = rng(41);
    for (let i = 0; i < 30; i++) blotch(g, rr2, mx + rr2() * 400, my + rr2() * 260, range(rr2, 3, 12), '#7a4a22', 0.35, 3);
    put('mailbox', mx, my, 400, 260);

    // —— 杂物间门牌（木门上的粉笔字“杂物”）120×60 ——
    g.fillStyle = 'rgba(240,240,230,0.85)';
    g.font = `36px ${HAND_FONT_STACK}`;
    g.fillText(TEXT.set.chalkStore, 60 + 0, 940);
    put('chalk', 0, 910, 120, 60);
  });
  return { tex, rect: n => rects.get(n) ?? [0, 0, 0.001, 0.001] };
}

function r2(r: () => number, lo: number, hi: number): number {
  return lo + r() * (hi - lo);
}

function agePaperRect(g: G, x: number, y: number, w: number, h: number, seed: number): void {
  const r = rng(seed);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  for (let i = 0; i < 2; i++) waterStain(g, r, x + range(r, 0.2, 0.8) * w, y + range(r, 0.2, 0.8) * h, range(r, 0.15, 0.3) * w);
  g.restore();
}

// ==================================================================== 墙面做旧（整面墙叠一层，横向平铺）

/**
 * 楼道墙面的“旧”（512²，一张横 2.6m、竖 = 地面到顶棚 2.65m；透明底，横向可平铺）：顶棚下一圈熏黑、墙裙分界线上方被肩膀和手蹭脏的一道、
 * 墙裙绿漆磕掉露出石灰底的碎点、踢脚处的鞋印泥点、从顶上淌下来的几道淡痕。叠在 MATERIALS.dado 的墙面上（dado 本身是干净的平涂）。
 */
export function wallWashTexture(): THREE.CanvasTexture {
  return paintTexture(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = rng(2651);
    /** 横向平铺：贴边的斑块在另一边再画一次 */
    const wrapBlotch = (x: number, y: number, size: number, color: string, alpha: number, lumps = 5) => {
      for (const dx of [-w, 0, w]) if (x + dx > -size && x + dx < w + size) blotch(g, rng(Math.floor(x * 131 + y * 7)), x + dx, y, size, color, alpha, lumps);
    };
    // 顶棚下的熏黑（油烟、灯熏、几十年的灰）
    const soot = g.createLinearGradient(0, 0, 0, h * 0.2);
    soot.addColorStop(0, 'rgba(34,27,19,0.42)');
    soot.addColorStop(0.45, 'rgba(34,27,19,0.14)');
    soot.addColorStop(1, 'rgba(34,27,19,0)');
    g.fillStyle = soot;
    g.fillRect(0, 0, w, h * 0.2);
    for (let i = 0; i < 10; i++) wrapBlotch(r() * w, range(r, 0, 0.1) * h, range(r, 20, 50), 'rgba(30,24,16,1)', 0.12, 5);
    // 从顶上淌下来的淡痕
    for (let i = 0; i < 9; i++) {
      const x = r() * w, len = range(r, 0.15, 0.5) * h, sw = range(r, 2, 7);
      const grd = g.createLinearGradient(0, 0, 0, len);
      grd.addColorStop(0, `rgba(80,62,36,${range(r, 0.1, 0.22)})`);
      grd.addColorStop(1, 'rgba(80,62,36,0)');
      g.fillStyle = grd;
      g.fillRect(x, 0, sw, len);
    }
    // 墙裙分界线（离地 1.26m：画布 y ≈ 0.525h）上方被肩膀、手蹭脏的一道
    for (let i = 0; i < 46; i++) wrapBlotch(r() * w, range(r, 0.42, 0.52) * h, range(r, 10, 28), 'rgba(48,40,28,1)', range(r, 0.06, 0.14), 4);
    // 墙裙绿漆磕掉的地方露出石灰底（碎点，集中在分界线下方与膝盖高度）
    for (let i = 0; i < 70; i++) {
      const y = r() < 0.6 ? range(r, 0.53, 0.6) * h : range(r, 0.62, 0.86) * h;
      g.fillStyle = `rgba(190,184,168,${range(r, 0.25, 0.6)})`;
      g.beginPath();
      g.ellipse(r() * w, y, range(r, 1.5, 6), range(r, 1, 4), r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    // 踢脚处的鞋印、泥点、拖把水印
    for (let i = 0; i < 26; i++) wrapBlotch(r() * w, range(r, 0.88, 0.99) * h, range(r, 8, 22), 'rgba(18,15,11,1)', range(r, 0.12, 0.26), 3);
    const mop = g.createLinearGradient(0, h * 0.9, 0, h);
    mop.addColorStop(0, 'rgba(40,34,24,0)');
    mop.addColorStop(1, 'rgba(40,34,24,0.3)');
    g.fillStyle = mop;
    g.fillRect(0, h * 0.9, w, h * 0.1);
  }, { repeat: [1, 1] });
}

// ==================================================================== 污渍图集（512²，透明底）：水渍、裂缝、黑手印、粉笔画、鞋印、蛛网

export function grimeAtlas(): { tex: THREE.CanvasTexture; rect(i: number): Rect } {
  const N = 4;
  const tex = paintTexture(512, 512, (g, w) => {
    g.clearRect(0, 0, w, w);
    const s = w / N;
    const r = rng(505);
    for (let i = 0; i < N * N; i++) {
      const x = (i % N) * s, y = Math.floor(i / N) * s;
      g.save();
      g.beginPath();
      g.rect(x, y, s, s);
      g.clip();
      const kind = i < 8 ? i : i === 13 ? 8 : i === 14 ? 9 : i === 15 ? 12 : i;
      if (kind === 8) {
        // 墙皮剥落：石灰起壳掉了一块，露出灰色的底灰，边上翘起的碎皮
        const cx = x + s / 2, cy = y + s / 2;
        // 几片大小不一的掉皮，边缘毛糙，颜色只比石灰深一点
        for (let piece = 0; piece < 4; piece++) {
          const px0 = cx + range(r, -s * 0.25, s * 0.25), py0 = cy + range(r, -s * 0.2, s * 0.2);
          const base = s * range(r, 0.06, 0.18);
          g.fillStyle = `rgba(130,124,110,${range(r, 0.35, 0.55)})`;
          g.beginPath();
          for (let k = 0; k <= 18; k++) {
            const a = (k / 18) * Math.PI * 2, rad = base * range(r, 0.55, 1.25);
            const px = px0 + Math.cos(a) * rad * 1.35, py = py0 + Math.sin(a) * rad * 0.85;
            if (k === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.closePath();
          g.fill();
        }
        for (let k = 0; k < 14; k++) blotch(g, r, cx + range(r, -s * 0.4, s * 0.4), cy + range(r, -s * 0.3, s * 0.3), range(r, 2, 6), 'rgba(96,90,78,1)', 0.25, 2);
      } else if (kind === 9) {
        // 顶上渗水顺墙淌下来的黄褐竖痕
        for (let k = 0; k < 7; k++) {
          const sx = x + range(r, 0.1, 0.9) * s, sw = range(r, 3, 10), len = range(r, 0.4, 1) * s;
          const grd = g.createLinearGradient(0, y, 0, y + len);
          grd.addColorStop(0, `rgba(105,80,40,${range(r, 0.25, 0.45)})`);
          grd.addColorStop(1, 'rgba(105,80,40,0)');
          g.fillStyle = grd;
          g.fillRect(sx, y, sw, len);
        }
        waterStain(g, r, x + s / 2, y + 6, s * 0.45);
      } else if (kind === 10) {
        // 灯头上方熏黑的一圈（顶棚）
        const grd = g.createRadialGradient(x + s / 2, y + s / 2, 2, x + s / 2, y + s / 2, s / 2);
        grd.addColorStop(0, 'rgba(25,20,14,0.55)');
        grd.addColorStop(0.5, 'rgba(25,20,14,0.25)');
        grd.addColorStop(1, 'rgba(25,20,14,0)');
        g.fillStyle = grd;
        g.fillRect(x, y, s, s);
      } else if (kind === 11) {
        // 上下楼的人肩膀、手蹭黑的一长道
        for (let k = 0; k < 18; k++) blotch(g, r, x + range(r, 0.05, 0.95) * s, y + s * range(r, 0.35, 0.65), range(r, 8, 20), '#2a241c', 0.16, 3);
      } else if (kind === 12) {
        // 墙根返潮：霉点从下往上爬
        for (let k = 0; k < 60; k++) {
          const py = y + s - Math.pow(r(), 1.8) * s * 0.9;
          g.fillStyle = `rgba(${r() < 0.5 ? '30,38,26' : '52,46,30'},${range(r, 0.15, 0.4)})`;
          g.beginPath();
          g.arc(x + r() * s, py, range(r, 1.5, 6), 0, Math.PI * 2);
          g.fill();
        }
      } else if (kind === 0 || kind === 4) {
        // 顶棚/墙角的黄褐水渍（一圈深边）
        for (let k = 0; k < 3; k++) waterStain(g, r, x + s / 2 + range(r, -20, 20), y + s / 2 + range(r, -20, 20), range(r, 30, 56));
        blotch(g, r, x + s / 2, y + s / 2, s * 0.4, 'rgba(110,85,40,1)', 0.12, 6);
      } else if (kind === 1) {
        // 裂缝
        g.strokeStyle = 'rgba(40,36,30,0.7)';
        g.lineWidth = 1.6;
        g.beginPath();
        let px = x + s * 0.2, py = y + s * 0.1;
        g.moveTo(px, py);
        for (let k = 0; k < 9; k++) {
          px += range(r, 2, 12);
          py += range(r, 8, 15);
          g.lineTo(px, py);
          if (r() < 0.3) {
            g.moveTo(px, py);
            g.lineTo(px + range(r, -18, 18), py + range(r, 4, 14));
            g.moveTo(px, py);
          }
        }
        g.stroke();
      } else if (kind === 2) {
        // 开关旁的黑手印
        for (let k = 0; k < 5; k++) blotch(g, r, x + s / 2 + range(r, -22, 22), y + s / 2 + range(r, -30, 30), range(r, 10, 22), '#1a1612', 0.22, 4);
      } else if (kind === 3) {
        // 孩子的粉笔画：太阳、小人、歪歪扭扭的字
        g.strokeStyle = 'rgba(235,235,225,0.8)';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(x + s * 0.25, y + s * 0.28, 14, 0, Math.PI * 2);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          g.moveTo(x + s * 0.25 + Math.cos(a) * 18, y + s * 0.28 + Math.sin(a) * 18);
          g.lineTo(x + s * 0.25 + Math.cos(a) * 26, y + s * 0.28 + Math.sin(a) * 26);
        }
        g.moveTo(x + s * 0.65, y + s * 0.45);
        g.arc(x + s * 0.65, y + s * 0.4, 8, Math.PI / 2, Math.PI * 2.5);
        g.moveTo(x + s * 0.65, y + s * 0.48);
        g.lineTo(x + s * 0.65, y + s * 0.7);
        g.lineTo(x + s * 0.58, y + s * 0.85);
        g.moveTo(x + s * 0.65, y + s * 0.7);
        g.lineTo(x + s * 0.72, y + s * 0.85);
        g.moveTo(x + s * 0.55, y + s * 0.56);
        g.lineTo(x + s * 0.76, y + s * 0.56);
        g.stroke();
        g.fillStyle = 'rgba(235,235,225,0.75)';
        g.font = `22px ${HAND_FONT_STACK}`;
        g.textAlign = 'left';
        g.fillText(TEXT.set.chalkKid, x + 8, y + s * 0.92);
      } else if (kind === 5) {
        // 踢脚处的鞋印与泥点
        for (let k = 0; k < 6; k++) blotch(g, r, x + range(r, 10, s - 10), y + s * range(r, 0.6, 0.95), range(r, 6, 14), '#15120e', 0.25, 3);
      } else if (kind === 6) {
        // 蛛网（墙角）
        g.strokeStyle = 'rgba(220,220,215,0.35)';
        g.lineWidth = 1;
        const cx = x + 4, cy = y + 4;
        for (let k = 0; k < 7; k++) {
          const a = (k / 6) * (Math.PI / 2);
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(cx + Math.cos(a) * s * 0.9, cy + Math.sin(a) * s * 0.9);
          g.stroke();
        }
        for (let ring = 1; ring < 6; ring++) {
          g.beginPath();
          for (let k = 0; k <= 6; k++) {
            const a = (k / 6) * (Math.PI / 2);
            const rad = ring * s * 0.15 + range(r, -3, 3);
            const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
            if (k === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.stroke();
        }
      } else {
        // 喷涂的“办证”电话（黑）
        g.fillStyle = 'rgba(20,20,20,0.8)';
        g.font = `bold 26px ${FONT_STACK}`;
        g.textAlign = 'left';
        g.fillText(TEXT.set.sprayWord, x + 10, y + s * 0.4);
        g.font = `bold 20px ${FONT_STACK}`;
        g.fillText(`13${Math.floor(range(r, 10000000, 99999999))}`, x + 10, y + s * 0.62);
      }
      g.restore();
    }
  });
  return { tex, rect: i => { const x = (i % N) / N, y = Math.floor(i / N) / N; return [x, 1 - y - 1 / N, x + 1 / N, 1 - y]; } };
}

// ==================================================================== 墙上的“牛皮癣”图集（1024×512，透明底）：喷涂电话、白灰盖掉又透出来的一条、
// 一撮小纸条、楼梯间的红章、502 门边的铅笔身高线。rect 为 UV [u0,v0,u1,v1]。

export interface AdsAtlas { tex: THREE.CanvasTexture; rect(name: 'spray0' | 'spray1' | 'spray2' | 'covered' | 'slips' | 'stamps' | 'heights'): Rect }

/** 喷漆字：先一层糊边（飞漆），再实心字，个别笔画往下淌。 */
function sprayText(g: G, r: () => number, text: string, x: number, y: number, size: number, color: string, bold = true): void {
  g.save();
  g.font = `${bold ? 'bold ' : ''}${size}px ${FONT_STACK}`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = size * 0.18;
  g.globalAlpha = 0.55;
  g.fillText(text, x, y);
  g.shadowBlur = 0;
  g.globalAlpha = 0.9;
  g.fillText(text, x, y);
  // 淌下来的漆
  const wText = g.measureText(text).width;
  g.globalAlpha = 0.7;
  for (let i = 0; i < Math.max(2, text.length); i++) {
    if (r() < 0.45) continue;
    g.fillRect(x + r() * wText, y - size * 0.1, Math.max(1.5, size * 0.04), range(r, size * 0.15, size * 0.6));
  }
  g.restore();
}

export function adsAtlas(): AdsAtlas {
  const W = 1024, Hh = 512;
  const rects = new Map<string, Rect>();
  const put = (name: string, x: number, y: number, w: number, h: number) => rects.set(name, [x / W, 1 - (y + h) / Hh, (x + w) / W, 1 - y / Hh]);
  const tex = paintTexture(W, Hh, g => {
    g.clearRect(0, 0, W, Hh);
    const r = rng(612);
    // —— 喷涂电话（三条，各 512×128）
    const sprays = TEXT.set.spray;
    const colors = ['#b3171d', '#1a1a1a', '#1c2f6a'];
    sprays.forEach(([big, phone], i) => {
      const x0 = i === 2 ? 512 : 0, y0 = i === 1 ? 128 : 0;
      sprayText(g, r, big, x0 + 18, y0 + 66, big.length > 3 ? 50 : 58, colors[i] ?? '#1a1a1a');
      sprayText(g, r, phone, x0 + 24, y0 + 114, 38, colors[i] ?? '#1a1a1a');
      put(`spray${i}`, x0, y0, 512, 128);
    });
    // —— 白灰盖掉的一条（512×128）：底下的红字透出来一点
    {
      const x0 = 512, y0 = 128;
      sprayText(g, r, TEXT.set.sprayCovered, x0 + 30, y0 + 80, 52, '#b3171d');
      g.save();
      g.fillStyle = 'rgba(176,170,156,0.72)';
      g.beginPath();
      g.moveTo(x0 + 10, y0 + 18);
      for (let k = 0; k <= 10; k++) g.lineTo(x0 + 10 + k * 49, y0 + 14 + range(r, -6, 6));
      for (let k = 10; k >= 0; k--) g.lineTo(x0 + 10 + k * 49, y0 + 112 + range(r, -8, 8));
      g.closePath();
      g.fill();
      // 刷子的横纹
      g.strokeStyle = 'rgba(240,236,226,0.35)';
      g.lineWidth = 2;
      for (let k = 0; k < 16; k++) {
        const yy = y0 + range(r, 20, 108);
        g.beginPath();
        g.moveTo(x0 + range(r, 14, 60), yy);
        g.lineTo(x0 + range(r, 380, 500), yy + range(r, -3, 3));
        g.stroke();
      }
      g.restore();
      put('covered', x0, y0, 512, 128);
    }
    // —— 一撮小纸条（512×256）
    {
      const x0 = 0, y0 = 256;
      const papers = ['#F2EEDC', '#F4E27A', '#F0C3C8', '#FFFFFF', '#DDE8C8', '#CFE3F2'];
      const inks = ['#C0161B', '#161616', '#1C3E9A'];
      const words = TEXT.set.slips;
      for (let i = 0; i < 34; i++) {
        const pw = range(r, 58, 120), ph = range(r, 30, 62);
        const cx = x0 + range(r, pw / 2 + 4, 512 - pw / 2 - 4), cy = y0 + range(r, ph / 2 + 4, 256 - ph / 2 - 4);
        g.save();
        g.translate(cx, cy);
        g.rotate(range(r, -0.18, 0.18));
        const torn = r() < 0.22;
        // 胶水印
        g.fillStyle = 'rgba(120,110,90,0.25)';
        g.fillRect(-pw / 2 - 2, -ph / 2 - 2, pw + 4, ph + 4);
        g.fillStyle = papers[Math.floor(r() * papers.length)] ?? '#fff';
        if (torn) {
          // 撕掉了，只剩上面一条毛边
          g.beginPath();
          g.moveTo(-pw / 2, -ph / 2);
          g.lineTo(pw / 2, -ph / 2);
          for (let k = 6; k >= 0; k--) g.lineTo(-pw / 2 + (k / 6) * pw, -ph / 2 + range(r, 6, 16));
          g.closePath();
          g.fill();
        } else {
          g.fillRect(-pw / 2, -ph / 2, pw, ph);
          const ink = inks[Math.floor(r() * inks.length)] ?? '#161616';
          g.fillStyle = ink;
          const word = words[Math.floor(r() * words.length)] ?? '';
          g.font = `bold ${Math.round(Math.min(ph * 0.5, pw / (word.length + 0.4)))}px ${FONT_STACK}`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(word, 0, -ph * 0.12);
          g.font = `${Math.round(ph * 0.22)}px ${FONT_STACK}`;
          g.fillText(`1${Math.floor(range(r, 30, 89))}${Math.floor(range(r, 1000, 9999))}${Math.floor(range(r, 1000, 9999))}`, 0, ph * 0.3);
          // 泛黄
          g.fillStyle = 'rgba(150,120,60,0.12)';
          g.fillRect(-pw / 2, -ph / 2, pw, ph);
        }
        g.restore();
      }
      put('slips', x0, y0, 512, 256);
    }
    // —— 红章（256×256）：椭圆框 + 字，歪着盖了好几个
    {
      const x0 = 512, y0 = 256;
      for (let i = 0; i < 5; i++) {
        const cx = x0 + range(r, 60, 196), cy = y0 + 30 + i * 46 + range(r, -6, 6);
        g.save();
        g.translate(cx, cy);
        g.rotate(range(r, -0.3, 0.3));
        g.globalAlpha = range(r, 0.45, 0.8);
        g.strokeStyle = '#b01820';
        g.lineWidth = 3;
        g.beginPath();
        g.ellipse(0, 0, 58, 22, 0, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = '#b01820';
        g.font = `bold 20px ${FONT_STACK}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(TEXT.set.stamp[i % TEXT.set.stamp.length] ?? '', 0, -5);
        g.font = `11px ${FONT_STACK}`;
        g.fillText(TEXT.set.stampPhone, 0, 11);
        g.restore();
      }
      put('stamps', x0, y0, 256, 256);
    }
    // —— 铅笔身高线（256×256，对应墙上 0.35×0.5m：v 0→1 = 离地 0.95→1.45m）
    {
      const x0 = 768, y0 = 256;
      g.save();
      g.strokeStyle = 'rgba(70,70,76,0.8)';
      g.fillStyle = 'rgba(70,70,76,0.85)';
      g.lineWidth = 2;
      const heights = [1.03, 1.14, 1.27, 1.38];
      TEXT.set.heightMarks.forEach((label, i) => {
        const y = y0 + 256 - ((heights[i] ?? 1.1) - 0.95) / 0.5 * 256;
        g.beginPath();
        g.moveTo(x0 + 16, y);
        g.lineTo(x0 + 96 + range(r, -6, 6), y + range(r, -2, 2));
        g.stroke();
        g.font = `20px ${HAND_FONT_STACK}`;
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.fillText(`${TEXT.set.heightName} ${label}`, x0 + 104, y - 2);
      });
      g.restore();
      put('heights', x0, y0, 256, 256);
    }
  });
  return { tex, rect: n => rects.get(n) ?? [0, 0, 0.001, 0.001] };
}

// ==================================================================== 门神年画（尉迟恭、秦琼，512×512：左半尉迟恭、右半秦琼）

function general(g: G, x: number, y: number, w: number, _h: number, o: { face: string; beard: string; armor: string; cape: string; weapon: 'whip' | 'mace'; mirror: boolean }): void {
  g.save();
  g.translate(x + w / 2, y);
  if (o.mirror) g.scale(-1, 1);
  const s = w / 256;
  g.scale(s, s);
  g.lineJoin = 'round';
  const ink = '#1b0f0a';
  const line = (wd = 4) => { g.strokeStyle = ink; g.lineWidth = wd; };
  // 祥云底
  g.fillStyle = 'rgba(240,200,90,0.55)';
  for (const [cx, cy, r0] of [[-80, 420, 30], [70, 440, 34], [-10, 470, 28], [90, 120, 22], [-95, 150, 20]] as const) {
    g.beginPath();
    g.arc(cx, cy, r0, 0, Math.PI * 2);
    g.arc(cx + r0 * 0.9, cy - 4, r0 * 0.7, 0, Math.PI * 2);
    g.fill();
  }
  // 披风
  g.fillStyle = o.cape;
  g.beginPath();
  g.moveTo(-60, 150);
  g.quadraticCurveTo(-120, 330, -95, 480);
  g.lineTo(95, 480);
  g.quadraticCurveTo(120, 330, 60, 150);
  g.closePath();
  g.fill();
  line(4);
  g.stroke();
  // 腿与靴
  g.fillStyle = '#233f5a';
  g.fillRect(-48, 360, 40, 100);
  g.fillRect(8, 360, 40, 100);
  g.fillStyle = '#1b1b1b';
  g.fillRect(-54, 452, 50, 26);
  g.fillRect(4, 452, 50, 26);
  line(3);
  g.strokeRect(-48, 360, 40, 100);
  g.strokeRect(8, 360, 40, 100);
  // 甲身（鱼鳞甲）
  g.fillStyle = o.armor;
  g.beginPath();
  g.moveTo(-62, 160);
  g.lineTo(62, 160);
  g.lineTo(70, 370);
  g.lineTo(-70, 370);
  g.closePath();
  g.fill();
  line(4);
  g.stroke();
  g.strokeStyle = 'rgba(40,20,5,0.55)';
  g.lineWidth = 2;
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 7; col++) {
      const cx = -54 + col * 18 + (row % 2) * 9, cy = 180 + row * 21;
      g.beginPath();
      g.arc(cx, cy, 9, 0, Math.PI);
      g.stroke();
    }
  }
  // 护心镜
  g.fillStyle = '#e8c35a';
  g.beginPath();
  g.arc(0, 215, 22, 0, Math.PI * 2);
  g.fill();
  line(3);
  g.stroke();
  g.fillStyle = '#b3171d';
  g.beginPath();
  g.arc(0, 215, 10, 0, Math.PI * 2);
  g.fill();
  // 腰带
  g.fillStyle = '#b3171d';
  g.fillRect(-68, 300, 136, 22);
  line(3);
  g.strokeRect(-68, 300, 136, 22);
  // 肩吞（兽头）
  g.fillStyle = '#e8c35a';
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.ellipse(sx * 66, 172, 30, 22, 0, 0, Math.PI * 2);
    g.fill();
    line(3);
    g.stroke();
  }
  // 手臂与兵器（右手举起兵器斜过身前）
  g.fillStyle = o.armor;
  g.beginPath();
  g.moveTo(58, 170);
  g.lineTo(96, 250);
  g.lineTo(78, 262);
  g.lineTo(44, 200);
  g.closePath();
  g.fill();
  line(3);
  g.stroke();
  g.save();
  g.translate(88, 250);
  g.rotate(-0.55);
  if (o.weapon === 'whip') {
    // 钢鞭：一节一节的黑铁
    g.fillStyle = '#2b2b2e';
    for (let k = 0; k < 9; k++) {
      g.beginPath();
      g.ellipse(0, -30 - k * 18, 8, 10, 0, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // 锏：四棱金锏
    g.fillStyle = '#e8c35a';
    g.fillRect(-6, -190, 12, 170);
    line(2);
    g.strokeRect(-6, -190, 12, 170);
  }
  g.fillStyle = '#6b3a1a';
  g.fillRect(-7, -22, 14, 34);
  g.restore();
  g.fillStyle = o.face;
  g.beginPath();
  g.arc(92, 256, 11, 0, Math.PI * 2);
  g.fill();
  // 头：脸、胡子、头盔
  g.fillStyle = o.face;
  g.beginPath();
  g.ellipse(0, 112, 38, 46, 0, 0, Math.PI * 2);
  g.fill();
  line(4);
  g.stroke();
  // 怒目
  g.fillStyle = '#fff';
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.ellipse(sx * 15, 104, 10, 6, sx * 0.25, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = ink;
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.arc(sx * 15, 104, 3.6, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(sx * 4, 92);
    g.lineTo(sx * 28, 86);
    g.stroke();
  }
  // 胡子
  g.fillStyle = o.beard;
  g.beginPath();
  g.moveTo(-30, 122);
  g.quadraticCurveTo(-34, 180, 0, 196);
  g.quadraticCurveTo(34, 180, 30, 122);
  g.quadraticCurveTo(0, 138, -30, 122);
  g.fill();
  // 头盔 + 红缨
  g.fillStyle = '#e8c35a';
  g.beginPath();
  g.moveTo(-44, 96);
  g.quadraticCurveTo(0, 36, 44, 96);
  g.lineTo(40, 76);
  g.quadraticCurveTo(0, 40, -40, 76);
  g.closePath();
  g.fill();
  g.beginPath();
  g.ellipse(0, 62, 34, 26, 0, Math.PI, 0);
  g.fill();
  line(3);
  g.stroke();
  g.fillStyle = '#c0161b';
  g.beginPath();
  g.moveTo(0, 38);
  g.quadraticCurveTo(-26, 0, 6, -6);
  g.quadraticCurveTo(24, 10, 0, 38);
  g.fill();
  g.restore();
}

/** 门神一对（左 = 尉迟恭，右 = 秦琼）。 */
export function menshenTexture(): THREE.CanvasTexture {
  // 逻辑 512²（两张各 256×512），按 ×2 画成 1024²：取景器 4× 凑近门神也不糊（GDD P4 要盯着它们看）
  const K = 2;
  return paintTexture(512 * K, 512 * K, g => {
    const w = 512, h = 512;
    for (let i = 0; i < 2; i++) {
      g.setTransform(K, 0, 0, K, 0, 0);
      const x = i * (w / 2);
      // 纸底：大红、描金边框
      g.fillStyle = '#c21a1f';
      g.fillRect(x, 0, w / 2, h);
      g.fillStyle = '#f0e2c0';
      g.fillRect(x + 12, 12, w / 2 - 24, h - 24);
      g.strokeStyle = '#d9a93a';
      g.lineWidth = 6;
      g.strokeRect(x + 16, 16, w / 2 - 32, h - 32);
      general(g, x + 18, 14, w / 2 - 36, h - 28, i === 0
        ? { face: '#3a2a26', beard: '#15100c', armor: '#3f7d52', cape: '#2a4e8a', weapon: 'whip', mirror: false }
        : { face: '#f0b89a', beard: '#1e1612', armor: '#d6a340', cape: '#b3171d', weapon: 'mace', mirror: true });
      // 名号（小字，下边框里）
      g.fillStyle = '#7a1014';
      g.font = `bold 20px ${SERIF_FONT_STACK}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(TEXT.set.menshenNames[i] ?? '', x + w / 4, h - 30);
      // 贴了八年：褪色、雨水印、翘起的角（各自那一半）
      g.save();
      g.translate(x, 0);
      agePaper(g, w / 2, h, 0.55, 17 + i, 2);
      g.restore();
      const r = rng(60 + i);
      for (let k = 0; k < 10; k++) blotch(g, r, x + r() * (w / 2), r() * h, range(r, 8, 26), 'rgba(250,230,200,1)', 0.12, 4);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    grain(g, w * K, h * K, 0.12, 9);
  });
}

// ==================================================================== 捐款榜（红纸金边，GDD §7.4 的两行必须在上面）

export function donationTexture(): THREE.CanvasTexture {
  return paintTexture(512, 768, (g, w, h) => {
    g.fillStyle = '#a3141a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e0b447';
    g.lineWidth = 8;
    g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#f2d27a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold 34px ${SERIF_FONT_STACK}`;
    const [head0, head1, head2] = TEXT.set.donationHead;
    g.fillText(head0 ?? '', w / 2, 66);
    g.font = `bold 46px ${SERIF_FONT_STACK}`;
    g.fillText(head1 ?? '', w / 2, 122);
    g.font = `24px ${SERIF_FONT_STACK}`;
    g.fillText(head2 ?? '', w / 2, 166);
    const rows = TEXT.set.donationRows;
    g.textAlign = 'left';
    rows.forEach(([no, name, amt], i) => {
      const y = 214 + i * 46;
      const hi = i >= rows.length - 2;   // GDD §7.4 节选的两行：502 王桂芝、门岗 周守仁
      g.fillStyle = hi ? '#ffe9a8' : '#f0cf78';
      g.font = `${hi ? 'bold ' : ''}${name.length > 6 ? 21 : 26}px ${SERIF_FONT_STACK}`;
      g.fillText(no, 40, y);
      g.fillText(name, 110, y);
      g.textAlign = 'right';
      g.fillText(amt, w - 40, y);
      g.textAlign = 'left';
      g.strokeStyle = 'rgba(240,200,110,0.25)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(36, y + 22);
      g.lineTo(w - 36, y + 22);
      g.stroke();
    });
    g.textAlign = 'center';
    g.font = `22px ${SERIF_FONT_STACK}`;
    g.fillStyle = '#f0cf78';
    g.fillText(TEXT.set.donationFoot, w / 2, h - 44);
    agePaper(g, w, h, 0.5, 23, 3);
    grain(g, w, h, 0.12, 24);
  });
}

// ==================================================================== 窗外 / 门外夜景

/** 单元门外的雨夜院子（门洞里看出去）：远处钠灯的一团光、湿地反光、雨丝。 */
export function outsideTexture(): THREE.CanvasTexture {
  return paintTexture(512, 512, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0b1020');
    sky.addColorStop(0.55, '#1c2233');
    sky.addColorStop(0.62, '#161a24');
    sky.addColorStop(1, '#0f1116');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    // 对面楼的剪影与两扇亮窗
    g.fillStyle = '#0a0c12';
    g.fillRect(0, h * 0.22, w, h * 0.4);
    g.fillStyle = 'rgba(255,200,120,0.95)';
    g.fillRect(w * 0.18, h * 0.3, 22, 26);
    g.fillRect(w * 0.7, h * 0.42, 22, 26);
    // 钠灯的光团
    const lamp = g.createRadialGradient(w * 0.6, h * 0.24, 2, w * 0.6, h * 0.24, w * 0.55);
    lamp.addColorStop(0, 'rgba(255,248,225,1)');
    lamp.addColorStop(0.12, 'rgba(255,225,170,1)');
    lamp.addColorStop(0.3, 'rgba(255,170,80,0.8)');
    lamp.addColorStop(0.65, 'rgba(255,150,60,0.25)');
    lamp.addColorStop(1, 'rgba(255,154,60,0)');
    g.fillStyle = lamp;
    g.fillRect(0, 0, w, h);
    // 湿地面上的长倒影
    const refl = g.createLinearGradient(0, h * 0.62, 0, h);
    refl.addColorStop(0, 'rgba(255,200,120,0.85)');
    refl.addColorStop(1, 'rgba(255,154,60,0.1)');
    g.fillStyle = refl;
    g.fillRect(w * 0.55, h * 0.62, w * 0.1, h * 0.38);
    // 雨丝
    const r = rng(77);
    g.strokeStyle = 'rgba(200,210,230,0.25)';
    g.lineWidth = 1;
    for (let i = 0; i < 260; i++) {
      const x = r() * w, y = r() * h, l = range(r, 8, 22);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - 2, y + l);
      g.stroke();
    }
  });
}

/**
 * 走廊南窗外的院子（二–五楼各一张，按楼层把钠灯放在不同高度）：夜空、槐树冠的剪影、钠灯的一团光（HDR：材质颜色 ×2.4 后灯芯烧白）、
 * 湿地上的长倒影、对面门卫室的一扇亮窗、玻璃上的雨痕与灰。n 越高越是往下看。
 */
export function courtyardTexture(n: number, glowY?: number): THREE.CanvasTexture {
  return paintTexture(256, 256, (g, w, h) => {
    const r = rng(300 + n);
    const horizon = h * (0.34 + n * 0.07);
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#070a14');
    sky.addColorStop(1, '#1d2232');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, horizon);
    const ground = g.createLinearGradient(0, horizon, 0, h);
    ground.addColorStop(0, '#15161a');
    ground.addColorStop(1, '#0b0b0d');
    g.fillStyle = ground;
    g.fillRect(0, horizon, w, h - horizon);
    // 对面的门卫室屋顶与一扇亮窗（CRT 的磷绿 + 门灯）
    g.fillStyle = '#0a0b0f';
    g.fillRect(w * 0.05, horizon - h * 0.08, w * 0.38, h * 0.1);
    g.fillStyle = 'rgba(160,255,200,0.9)';
    g.fillRect(w * 0.2, horizon - h * 0.05, 9, 7);
    // 钠灯：杆 + 一团橙光（只有灯芯烧白：画面里有一小块真的亮，窗外的树冠与门岗亮窗仍读得出来）
    const lx = w * 0.64, ly = glowY !== undefined ? h * glowY : Math.min(h * 0.55, Math.max(h * 0.3, horizon - h * (0.36 - n * 0.05)));
    g.strokeStyle = '#1a1a1e';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(lx + 14, h);
    g.lineTo(lx + 14, ly + 6);
    g.lineTo(lx, ly);
    g.stroke();
    // M4 第 2 轮：只让灯芯烧白（原来 0–0.32 是白到浅橙、再 ×3.9，半扇窗烧成一个光盘，窗外的树冠、门岗亮窗都被盖住）
    const glow = g.createRadialGradient(lx, ly, 1, lx, ly, w * 0.6);
    glow.addColorStop(0, 'rgba(255,255,245,1)');
    glow.addColorStop(0.07, 'rgba(255,240,210,1)');
    glow.addColorStop(0.11, 'rgba(255,200,130,0.95)');
    glow.addColorStop(0.2, 'rgba(255,160,70,0.6)');
    glow.addColorStop(0.42, 'rgba(255,140,50,0.12)');
    glow.addColorStop(1, 'rgba(255,140,50,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    // 槐树冠：压在左上的一大片黑（几根枝杈 + 一簇一簇的碎叶，边上透光，不是几个大圆饼）
    g.strokeStyle = 'rgba(4,6,6,0.95)';
    g.lineCap = 'round';
    const clumps: [number, number][] = [];
    for (let i = 0; i < 5; i++) {
      const bx = range(r, -0.05, 0.1) * w, by = range(r, 0.05, 0.35) * h + horizon * 0.1;
      const ex = range(r, 0.2, 0.62) * w, ey = range(r, -0.05, 0.3) * h;
      g.lineWidth = range(r, 2, 5);
      g.beginPath();
      g.moveTo(bx, by);
      g.quadraticCurveTo((bx + ex) / 2 + range(r, -20, 20), (by + ey) / 2 + range(r, -30, 10), ex, ey);
      g.stroke();
      clumps.push([ex, ey], [(bx + ex) / 2, (by + ey) / 2]);
    }
    g.fillStyle = 'rgba(4,6,6,0.9)';
    for (const [cx, cy] of clumps) {
      for (let k = 0; k < 40; k++) {
        const a = r() * Math.PI * 2, d = Math.pow(r(), 0.6) * range(r, 18, 34);
        g.beginPath();
        g.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, range(r, 2, 6), range(r, 1.5, 4), r() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    // 湿地面上的倒影
    const refl = g.createLinearGradient(0, horizon, 0, h);
    refl.addColorStop(0, 'rgba(255,170,80,0.55)');
    refl.addColorStop(1, 'rgba(255,170,80,0)');
    g.fillStyle = refl;
    g.fillRect(lx - 6, horizon, 16, h - horizon);
    // 雨痕与玻璃上的灰
    g.strokeStyle = 'rgba(190,200,220,0.28)';
    g.lineWidth = 1;
    for (let i = 0; i < 90; i++) {
      const x = r() * w, y = r() * h;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + range(r, -1, 1), y + range(r, 6, 26));
      g.stroke();
    }
    for (let i = 0; i < 16; i++) blotch(g, r, r() * w, r() * h, range(r, 10, 40), 'rgba(140,140,130,1)', 0.07, 4);
  });
}

/**
 * 回放里上午的院子（2018 春节、2025 秋，M4 第 2 轮）：从黑楼道里看出去整扇窗是过曝的天光，只剩槐树冠与对面屋顶淡淡的灰影。
 * 回放时几扇南窗的贴图换成这一张（同一种 CanvasTexture，换 map 不换着色器程序），夜里换回各自的夜景。
 */
export function courtyardDayTexture(): THREE.CanvasTexture {
  return paintTexture(256, 256, (g, w, h) => {
    const r = rng(318);
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#f4f7fb');
    sky.addColorStop(0.6, '#e6ebf1');
    sky.addColorStop(1, '#cfd3d6');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    // 对面门卫室的屋顶（淡灰）
    g.fillStyle = 'rgba(120,124,130,0.55)';
    g.fillRect(w * 0.05, h * 0.58, w * 0.38, h * 0.08);
    // 槐树冠：左上一片发灰的碎叶（逆光里只剩轮廓）
    g.fillStyle = 'rgba(96,104,98,0.5)';
    for (let k = 0; k < 160; k++) {
      const a = r() * Math.PI * 2, d = Math.pow(r(), 0.6) * range(r, 30, 70);
      const cx = w * 0.22 + Math.cos(a) * d * 1.3, cy = h * 0.2 + Math.sin(a) * d * 0.7;
      g.beginPath();
      g.ellipse(cx, cy, range(r, 2, 6), range(r, 1.5, 4), r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    // 玻璃上的灰
    for (let i = 0; i < 12; i++) blotch(g, r, r() * w, r() * h, range(r, 10, 40), 'rgba(150,150,140,1)', 0.08, 4);
  });
}

/**
 * 声控灯吸顶座四周顶棚上的一圈光晕（加法混合贴在顶棚下面；M4 第 2 轮）：灯光本身是朝下的聚光、照不到顶棚，
 * 这一圈只负责“灯头上方的顶棚被烘亮了一片”的观感。黑底上的径向渐变（加法混合下黑 = 不加光），中心不到白。
 */
export function ceilingHaloTexture(): THREE.CanvasTexture {
  return paintTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, w, h);
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgb(255,236,205)');
    r.addColorStop(0.18, 'rgb(190,160,118)');
    r.addColorStop(0.45, 'rgb(70,56,38)');
    r.addColorStop(0.75, 'rgb(14,11,7)');
    r.addColorStop(1, 'rgb(0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });
}

/** 黑白老电视画面（2008 回放道具：开幕式的一团焰火光）。 */
export function tvScreenTexture(): THREE.CanvasTexture {
  return paintTexture(128, 96, (g, w, h) => {
    g.fillStyle = '#20242c';
    g.fillRect(0, 0, w, h);
    const r = rng(808);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(255,${Math.floor(range(r, 160, 240))},120,${range(r, 0.3, 0.9)})`;
      g.beginPath();
      g.arc(r() * w, r() * h * 0.6, range(r, 1, 4), 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillRect(0, h * 0.72, w, 3);
  });
}

export { shade };
export const HALL = PALETTE.HALL_LAMP;
