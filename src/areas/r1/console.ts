// owner: R1-world
// 监控台 CH1 无信号画面与 CH3–CH5 静态画面（GDD §3.9；ARCH §6.11、§11.6：R1 负责绘制，只读 flags）。
// 画布 256×192；OSD 行由 CrtScreenController 另画。画面是夜里的低照度监控：偏灰绿、颗粒、雨丝。

import type { StateView } from '../../game/state';
import type { ChannelSource } from '../../game/cctv';
import { F } from '../../data/ids';
import { FONT_STACK } from '../../kit/text';
import { STRINGS } from '../../data/strings';
import { rng } from '../../kit/rng';
import { R1 } from './layout';

type G = CanvasRenderingContext2D;

/** 监控画面的底：暗灰绿渐变 + 固定颗粒 + 斜雨丝（按 t 走）。 */
function base(g: G, w: number, h: number, t: number, seed: number, rainOn: boolean): void {
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#171d1c');
  sky.addColorStop(0.55, '#2a3230');
  sky.addColorStop(1, '#1b201f');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const r = rng(seed);
  g.fillStyle = 'rgba(200,220,210,0.05)';
  for (let i = 0; i < 260; i++) g.fillRect(r() * w, r() * h, 1, 1);
  if (rainOn) {
    g.strokeStyle = 'rgba(190,210,205,0.18)';
    g.lineWidth = 1;
    const off = (t * 180) % h;
    for (let i = 0; i < 40; i++) {
      const x = (r() * w + t * 20) % w, y = (r() * h + off) % h;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - 3, y + 12);
      g.stroke();
    }
  }
}

function label(g: G, _w: number, h: number, text: string): void {
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(4, h - 20, g.measureText(text).width + 30, 16);
  g.fillStyle = '#9fe8c0';
  g.font = `bold 12px ${FONT_STACK}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText(text, 8, h - 12);
}

function glow(g: G, x: number, y: number, r: number, color: string, a: number): void {
  const grd = g.createRadialGradient(x, y, 0, x, y, r);
  grd.addColorStop(0, color.replace('A', String(a)));
  grd.addColorStop(1, color.replace('A', '0'));
  g.fillStyle = grd;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

const raining = (s: StateView): boolean => !s.flag(F.R4_GOT_TAPE) && !s.flag(F.R1_SOUL_RETURNED);

/** CH1（门楣本机）：没插视频线时“无信号 · 视频入1 未接”。 */
export function paintNoSignal(g: G, w: number, h: number): void {
  g.fillStyle = '#05070a';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(120,140,150,0.25)';
  g.strokeRect(10.5, 10.5, w - 21, h - 21);
  g.fillStyle = '#b8c4c8';
  g.font = `bold 15px ${FONT_STACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(STRINGS.hud.noSignal, w / 2, h / 2);
  g.font = `bold 12px ${FONT_STACK}`;
  g.fillText('CH1', w / 2, h / 2 - 24);
}

/** CH3 三号楼单元门：mission_given 后门缝里透出一点光；wang_done 后门口一点光飞向槐树的残影。 */
function paintCh3(g: G, w: number, h: number, s: StateView, t: number): void {
  base(g, w, h, t, 3, raining(s));
  // 楼面：砖缝与两排黑窗
  g.fillStyle = '#262a28';
  g.fillRect(0, 18, w, h * 0.72);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  for (let y = 26; y < h * 0.8; y += 8) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.fillStyle = '#0d0f0f';
  for (let i = 0; i < 5; i++) g.fillRect(12 + i * 52, 30, 26, 22);
  // 单元门、雨棚、台阶
  const dx = w * 0.44, dw = w * 0.16, dy = h * 0.42, dh = h * 0.36;
  g.fillStyle = '#4a4f4c';
  g.fillRect(dx - 16, dy - 12, dw + 32, 8);
  g.fillStyle = '#121615';
  g.fillRect(dx, dy, dw, dh);
  g.fillStyle = '#3c413e';
  g.fillRect(dx - 24, dy + dh, dw + 48, 6);
  g.fillStyle = '#2f3431';
  g.fillRect(0, dy + dh + 6, w, h - dy - dh - 6);
  if (s.flag(F.R1_MISSION_GIVEN) && !s.flag(F.R2_WANG_DONE)) {
    // 门缝里透出一点光
    g.fillStyle = 'rgba(255,220,150,0.85)';
    g.fillRect(dx + dw * 0.48, dy + 4, 2, dh - 8);
    glow(g, dx + dw * 0.49, dy + dh * 0.5, 22, 'rgba(255,215,140,A)', 0.35);
  }
  if (s.flag(F.R2_WANG_DONE)) {
    // 一点光从门口飘向右上（槐树那边），拖着一串残影
    const p = (t * 0.25) % 1;
    for (let k = 5; k >= 0; k--) {
      const q = Math.max(0, p - k * 0.035);
      const x = dx + dw / 2 + q * (w * 0.5), y = dy + dh * 0.6 - q * h * 0.55 - Math.sin(q * 6) * 6;
      glow(g, x, y, 10 - k, 'rgba(210,255,240,A)', 0.8 - k * 0.12);
    }
  }
  label(g, w, h, '3号楼 1单元');
}

/** CH4 老街东口：照相馆霓虹；lu_door_open 后门开着；saw_true_form 后霓虹熄灭。 */
function paintCh4(g: G, w: number, h: number, s: StateView, t: number): void {
  base(g, w, h, t, 4, raining(s));
  // 街道透视：两侧矮房、路面的湿反光
  g.fillStyle = '#1f2423';
  g.beginPath();
  g.moveTo(0, h * 0.25);
  g.lineTo(w * 0.42, h * 0.5);
  g.lineTo(w * 0.42, h);
  g.lineTo(0, h);
  g.fill();
  g.beginPath();
  g.moveTo(w, h * 0.2);
  g.lineTo(w * 0.6, h * 0.5);
  g.lineTo(w * 0.6, h);
  g.lineTo(w, h);
  g.fill();
  g.fillStyle = '#343b39';
  g.beginPath();
  g.moveTo(w * 0.42, h * 0.55);
  g.lineTo(w * 0.6, h * 0.55);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.fill();
  const neonOn = !s.flag(F.R3_SAW_TRUE_FORM);
  // 照相馆门面（左侧）
  const doorOpen = s.flag(F.R3_LU_DOOR_OPEN);
  g.fillStyle = doorOpen ? 'rgba(255,225,180,0.75)' : '#0e1111';
  g.fillRect(w * 0.16, h * 0.52, w * 0.1, h * 0.26);
  if (doorOpen) glow(g, w * 0.21, h * 0.7, 30, 'rgba(255,220,170,A)', 0.3);
  g.font = `bold 15px ${FONT_STACK}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  if (neonOn) {
    const flick = Math.sin(t * 13) > 0.92 ? 0.55 : 1;
    glow(g, w * 0.2, h * 0.4, 46, 'rgba(255,70,70,A)', 0.35 * flick);
    g.fillStyle = `rgba(255,120,120,${flick})`;
    g.fillText('长明照相', w * 0.06, h * 0.4);
    g.fillStyle = 'rgba(90,30,30,0.9)';
    g.fillText('馆', w * 0.06 + g.measureText('长明照相').width, h * 0.4);
    // 路面上的红色倒影
    g.fillStyle = `rgba(255,80,80,${0.18 * flick})`;
    g.fillRect(w * 0.1, h * 0.8, w * 0.2, h * 0.2);
  } else {
    g.fillStyle = 'rgba(60,40,40,0.8)';
    g.fillText('长明照相馆', w * 0.06, h * 0.4);
  }
  label(g, w, h, '老街东口');
}

/** CH5 人民路通道口：丑时起楼梯口有白灯笼光，寅时照旧；卯时（r1.soul_returned）熄灭。 */
function paintCh5(g: G, w: number, h: number, s: StateView, t: number): void {
  base(g, w, h, t, 5, raining(s));
  // 通道口：雨棚、两侧矮墙、往下的台阶
  g.fillStyle = '#2b312f';
  g.fillRect(w * 0.18, h * 0.3, w * 0.64, 10);
  g.fillStyle = '#1b2120';
  g.fillRect(w * 0.2, h * 0.36, w * 0.6, h * 0.5);
  g.fillStyle = '#0a0c0c';
  g.beginPath();
  g.moveTo(w * 0.3, h * 0.45);
  g.lineTo(w * 0.7, h * 0.45);
  g.lineTo(w * 0.62, h * 0.86);
  g.lineTo(w * 0.38, h * 0.86);
  g.fill();
  g.strokeStyle = 'rgba(120,130,125,0.35)';
  for (let i = 0; i < 8; i++) {
    const y = h * 0.5 + i * h * 0.045;
    g.beginPath();
    g.moveTo(w * (0.31 + i * 0.009), y);
    g.lineTo(w * (0.69 - i * 0.009), y);
    g.stroke();
  }
  g.fillStyle = '#2e5e8c';
  g.fillRect(w * 0.34, h * 0.22, w * 0.32, h * 0.07);
  g.fillStyle = '#e8eef0';
  g.font = `bold 10px ${FONT_STACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('人民路地下通道', w / 2, h * 0.255);
  const chouPlus = s.flag(F.R2_WANG_DONE) && s.flag(F.R3_SAW_TRUE_FORM);
  if (chouPlus && !s.flag(F.R1_SOUL_RETURNED)) {
    // 楼梯口两盏白灯笼（阴火，微微晃）
    for (const [x, ph] of [[0.4, 0], [0.6, 1.7]] as const) {
      const sway = Math.sin(t * 1.3 + ph) * 2;
      const lx = w * x + sway, ly = h * 0.52;
      glow(g, lx, ly, 34, 'rgba(235,245,230,A)', 0.45);
      g.fillStyle = 'rgba(245,242,225,0.95)';
      g.beginPath();
      g.ellipse(lx, ly, 6, 8, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  label(g, w, h, '人民路通道口');
}

/** 监控台五路频道（R1-world 那一半，ARCH §6.11）：CH1 自身画面、CH2 屋角半球机位实时、CH3–5 静态。 */
export function consoleChannels(): Record<1 | 2 | 3 | 4 | 5, ChannelSource> {
  return {
    1: { kind: 'self', noSignal: paintNoSignal },
    // 屋角半球机位（位置取 layout），画面收紧到桌子与椅子：开场五路分屏的小格里认得出椅子上那个摄像头脑袋的人
    2: { kind: 'live', camPose: { pos: R1.derived.ch2Cam.pos, target: [-6.55, 1.05, 21.05], fov: 56 } },
    3: { kind: 'static', paint: paintCh3, animate: true },
    4: { kind: 'static', paint: paintCh4, animate: true },
    5: { kind: 'static', paint: paintCh5, animate: true },
  };
}

