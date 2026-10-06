// owner: WP2
// 主角摄像头头部（ARCH §5.2；GDD §2.7）。
//
// 头部局部坐标：原点 = 外壳底面中心（装在身上时就是支架顶端，离地 PC_DIMS.headBottomY = 1.77），-z 是镜头朝向。
//   group → pan（云台水平转，rotation.y）→ tilt（俯仰轴，高 TILT_Y，rotation.x）→ 外壳、镜头、贴条、铁皮帽、REC 灯、视频线
// 俯仰 0 时镜头中心离地正好 1.85、贴条中心 1.93、帽顶 2.00（PC_DIMS）。
// 支架圆柱 neck 不在 group 里：它属于身子（从领口伸出），detach() 摘下的只有 group。

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ZoomLevel } from '../core/types';
import { setLayerRecursive } from '../core/layers';
import { DEG2RAD, damp } from '../core/math';
import { PALETTE } from '../data/palette';
import { TIMING } from '../data/time';
import {
  blotch, canvasToTexture, createCanvas, drawHandLine, grain, paintTexture, shade, waterStain,
} from '../kit/canvas';
import { newMat } from '../kit/geom';
import { rng, range } from '../kit/rng';
import { FONT_STACK } from '../kit/text';

/** GDD §2.7 的关键高度（离地，米）。镜面、取景器、读字、第一人称相机都按这组数，别处不得另写常量。 */
export const PC_DIMS = {
  /** 人体模板标称身高（= HumanoidSpec.height，含人头时的身高）；实际身子顶端 = collarY 1.50（领口） */
  bodyH: 1.75, collarY: 1.50,
  /** 外壳底边、顶边 */
  headBottomY: 1.77, headTopY: 1.99,
  /** 镜头中心 = 取景器视点 */
  lensY: 1.85,
  /** 脑门贴条中心 */
  stickerY: 1.93,
  /** 铁皮帽顶 */
  hatTopY: 2.00,
} as const;

/** 后脑视频线：6 节短圆柱链 + BNC 插头，摆锤模拟（不要每帧重建 TubeGeometry）。M1a 补写（ARCH 只写了类型名）。 */
export interface CableRig {
  readonly group: THREE.Group;
  /** BNC 插头（插进 r1.crt_jack 时用 plugTo 挂到插孔节点下） */
  readonly plug: THREE.Object3D;
  /** 插头此刻挂在别的节点上（插在插孔里） */
  readonly plugged: boolean;
  /**
   * M1d 补写（ARCH §5.2、§6.11）：把插头挂到 to 下（插孔节点；插头沿本地 −y 插入，所以插孔节点的 −y 指向孔里），
   * 线被扯直连到插孔；插着时插头改在 world 层（取景器里也看得见）。null = 拔出：插头回到线尾、线重新自然下垂。
   * 离开区域时引擎自动拔出（插孔节点随区域释放）。
   */
  plugTo(to: THREE.Object3D | null): void;
  update(dt: number): void;
}

export interface CameraHead {
  /** 整颗头（layer.self_head，递归） */
  readonly group: THREE.Group;
  /** 从领口托头的支架圆柱（1.50→1.77），同样在 self_head 层 */
  readonly neck: THREE.Mesh;
  /** 镜头中心（第一人称相机位置） */
  readonly lensAnchor: THREE.Object3D;
  /** 贴条中心（镜中读字的实物点） */
  readonly stickerAnchor: THREE.Object3D;
  /** 变焦时转动 */
  readonly lensRing: THREE.Mesh;
  /** 每秒闪一次（emissive 开关，不用灯；R2 的 REC 点光由区域放在 lightsRoot 下每帧跟随，ARCH §4.7） */
  readonly recLed: THREE.Mesh;
  /** 脑门贴条：底纸在 self_head 层；字迹平面在 self_sticker_vf 层 */
  readonly sticker: THREE.Group;
  /** 弯折 Plane + 罐头铁皮 CanvasTexture（锈斑、半行“红烧扣肉”） */
  readonly tinHat: THREE.Mesh;
  /** 后脑视频线 */
  readonly cable: CableRig;
  /** 镜头环转到对应角度 */
  setZoom(z: ZoomLevel): void;
  /** 取景器中头随视角转；探索时空闲云台扫描 */
  setLook(yawOffsetDeg: number, pitchDeg: number): void;
  update(dt: number, o: { moving: boolean; scanning: boolean; recBlink: boolean }): void;
  /** 三脚架模式：从颈部摘下（返回 group 供挂到门楣支架） */
  detach(): THREE.Group;
  reattach(): void;
}

// ---------------------------------------------------------------- 尺寸（米，头部局部坐标）

const HOUSING = { w: 0.2, h: 0.22, len: 0.34, bevel: 0.02 } as const;
/** 俯仰轴高度（外壳下半部，转起来像云台而不是绕底边翻） */
const TILT_Y = 0.09;
const FRONT_Z = -HOUSING.len / 2;
const LENS = { y: PC_DIMS.lensY - PC_DIMS.headBottomY, r: 0.06, barrelLen: 0.045 } as const;
const STICKER = { y: PC_DIMS.stickerY - PC_DIMS.headBottomY, w: 0.12, h: 0.05 } as const;
const HAT_TOP = PC_DIMS.hatTopY - PC_DIMS.headBottomY;
const NECK_LEN = PC_DIMS.headBottomY - PC_DIMS.collarY;
/** 支架圆柱顶端留给云台底座的一小段 */
const PAN_BASE_H = 0.016;
const LED_ON = new THREE.Color('#ff5050');
const LED_OFF = new THREE.Color('#3a0505');
/** 头部各材质的环境反光倍率（× 区域 environmentIntensity；M1c look-dev 冻结）。 */
export const HEAD_ENV_BOOST = { housing: 0.9, metal: 3.0, glass: 4.0, hat: 2.5 } as const;
/** 镜头镀膜贴图的自发光强度（M1c look-dev） */
const LENS_COAT_GLOW = 0.25;
/** 各档倍率对应的镜头环角度（弧度） */
const RING_ANGLE: Readonly<Record<ZoomLevel, number>> = { 1: 0, 2: 0.55, 3: 1.1, 4: 1.65, 6: 2.6 };

// ---------------------------------------------------------------- 贴图

/**
 * 米白外壳贴图集（512²）：左上 = 前脸（-z），右上 = 后盖（+z），左下 = 两侧，右下 = 顶/底（见 remapHousingUv）。
 * 雨痕从上往下淌、棱边积灰；后盖是颜色略深的一块面板：四颗螺丝、散热槽、铭牌标签。
 */
function housingTexture(): THREE.CanvasTexture {
  return paintTexture(512, 512, (g, w, h) => {
    const r = rng(2004);
    const W = w / 2, H = h / 2;
    const base = '#ECE6D6';
    const grime = (x0: number, y0: number, streaks: number) => {
      for (let i = 0; i < streaks; i++) {
        const x = x0 + r() * W;
        const len = range(r, 0.2, 0.9) * H;
        const grd = g.createLinearGradient(0, y0, 0, y0 + len);
        grd.addColorStop(0, 'rgba(85,75,55,0.3)');
        grd.addColorStop(1, 'rgba(85,75,55,0)');
        g.fillStyle = grd;
        g.fillRect(x, y0, range(r, 1, 4), len);
      }
      const edge = g.createRadialGradient(x0 + W / 2, y0 + H / 2, W * 0.3, x0 + W / 2, y0 + H / 2, W * 0.75);
      edge.addColorStop(0, 'rgba(70,60,45,0)');
      edge.addColorStop(1, 'rgba(70,60,45,0.32)');
      g.fillStyle = edge;
      g.fillRect(x0, y0, W, H);
      for (let i = 0; i < 6; i++) blotch(g, r, x0 + r() * W, y0 + r() * H, range(r, 4, 12), 'rgb(120,110,90)', 0.12, 4);
    };
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    // 前脸：一圈模压的前框线
    g.strokeStyle = 'rgba(120,112,95,0.55)';
    g.lineWidth = 3;
    g.strokeRect(10, 10, W - 20, H - 20);
    grime(0, 0, 16);
    g.fillStyle = 'rgba(60,55,45,0.55)';
    g.font = `bold 13px ${FONT_STACK}`;
    g.textAlign = 'right';
    g.fillText('DC 12V', W - 18, H - 18);
    // 后盖面板
    g.fillStyle = '#CFC7B4';
    g.fillRect(W + 14, 14, W - 28, H - 28);
    g.strokeStyle = 'rgba(90,82,68,0.7)';
    g.lineWidth = 3;
    g.strokeRect(W + 14, 14, W - 28, H - 28);
    for (const [sx, sy] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]] as const) {
      const cx = W + sx * W, cy = sy * H;
      g.fillStyle = '#8b8577';
      g.beginPath();
      g.arc(cx, cy, 7, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#5a554b';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx - 5, cy);
      g.lineTo(cx + 5, cy);
      g.stroke();
    }
    // 散热槽
    g.fillStyle = '#4a463e';
    for (let i = 0; i < 6; i++) g.fillRect(W + W * 0.22, H * (0.2 + i * 0.065), W * 0.56, H * 0.03);
    // 铭牌
    g.fillStyle = '#F2EFE6';
    g.fillRect(W + W * 0.2, H * 0.6, W * 0.6, H * 0.2);
    g.fillStyle = '#222';
    g.font = `11px ${FONT_STACK}`;
    g.textAlign = 'left';
    g.fillText('型号 CM-480B  DC12V', W + W * 0.23, H * 0.66);
    g.fillText('出厂 2004.05  No.012', W + W * 0.23, H * 0.735);
    for (let i = 0; i < 26; i++) g.fillRect(W + W * 0.23 + i * 4, H * 0.76, i % 3 ? 2 : 1, 8);
    grime(W, 0, 10);
    // 两侧：一道模压腰线 + 雨痕
    g.fillStyle = 'rgba(110,100,85,0.45)';
    g.fillRect(0, H + H * 0.42, W, 3);
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillRect(0, H + H * 0.42 + 3, W, 2);
    grime(0, H, 22);
    // 顶/底
    grime(W, H, 8);
    grain(g, w, h, 0.1, 2005);
  });
}

/** RoundedBoxGeometry 的六个面依次是 +x −x +y −y +z −z，把每个面的 0..1 UV 压进 housingTexture 的对应格子。 */
function remapHousingUv(geo: THREE.BufferGeometry): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const per = uv.count / 6;
  // [u0, v0]（格子左下角，UV 空间），每格 0.5×0.5
  const cells: readonly (readonly [number, number])[] = [[0, 0], [0, 0], [0.5, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]];
  for (let i = 0; i < uv.count; i++) {
    const c = cells[Math.min(5, Math.floor(i / per))] ?? [0, 0];
    uv.setXY(i, c[0] + uv.getX(i) * 0.5, c[1] + uv.getY(i) * 0.5);
  }
}

/** 镜头镀膜：黑底上紫蓝、青绿的环，加两道假高光（没有环境贴图时也看得出是块玻璃）。 */
function lensCoatTexture(): THREE.CanvasTexture {
  return paintTexture(256, 256, (g, w, h) => {
    const c = w / 2;
    g.fillStyle = '#020306';
    g.fillRect(0, 0, w, h);
    const rings: [number, string][] = [
      [1.0, '#07080c'], [0.92, '#16122e'], [0.8, '#2b1f5c'], [0.66, '#0e2a2c'], [0.52, '#140f2a'], [0.36, '#06070b'], [0.22, '#020204'],
    ];
    for (const [rr, col] of rings) {
      const grd = g.createRadialGradient(c, c, rr * c * 0.7, c, c, rr * c);
      grd.addColorStop(0, col);
      grd.addColorStop(1, shade(col, 0.6));
      g.fillStyle = grd;
      g.beginPath();
      g.arc(c, c, rr * c, 0, Math.PI * 2);
      g.fill();
    }
    // 光圈叶片的暗六边形
    g.fillStyle = 'rgba(0,0,0,0.85)';
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.3;
      const x = c + Math.cos(a) * c * 0.2, y = c + Math.sin(a) * c * 0.2;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.fill();
    // 假高光：左上一道弧、右下一个小点
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = w * 0.03;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(c, c, c * 0.62, Math.PI * 1.08, Math.PI * 1.38);
    g.stroke();
    g.fillStyle = 'rgba(255,240,220,0.7)';
    g.beginPath();
    g.arc(c + c * 0.34, c + c * 0.3, c * 0.05, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(160,120,255,0.25)';
    g.beginPath();
    g.arc(c - c * 0.15, c + c * 0.4, c * 0.08, 0, Math.PI * 2);
    g.fill();
  });
}

/** 镜头环：一圈细滚花 + 白色倍率刻字 + 一个指示点（转起来看得出在转）。 */
function ringTexture(): THREE.CanvasTexture {
  return paintTexture(512, 64, (g, w, h) => {
    g.fillStyle = '#26272b';
    g.fillRect(0, 0, w, h);
    // 滚花
    for (let x = 0; x < w; x += 4) {
      g.fillStyle = x % 8 === 0 ? '#3a3b40' : '#17181b';
      g.fillRect(x, 0, 2, h * 0.55);
    }
    // 刻字带
    g.fillStyle = '#1b1c20';
    g.fillRect(0, h * 0.55, w, h * 0.45);
    g.fillStyle = '#E8E4DA';
    g.font = `bold ${Math.round(h * 0.34)}px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const marks = ['1', '2', '3', '4', '6'];
    marks.forEach((m, i) => g.fillText(m, w * (0.1 + i * 0.09), h * 0.78));
    g.fillStyle = '#E8B04A';
    g.fillRect(w * 0.62, h * 0.62, w * 0.2, h * 0.08);
    g.fillStyle = PALETTE.REC;
    g.beginPath();
    g.arc(w * 0.9, h * 0.78, h * 0.08, 0, Math.PI * 2);
    g.fill();
  });
}

/**
 * 罐头铁皮：银灰拉丝底、罐身的一道道箍纹、锈斑，一截褪色的红标签上只剩半行“红烧扣肉”；
 * 边缘是铁皮剪子剪出来的毛边（alpha 裁切，alphaTest 0.5）。v=1 是帽檐（朝前）。
 */
function tinHatTexture(): THREE.CanvasTexture {
  const { canvas, g } = createCanvas(512, 512);
  const w = 512, h = 512;
  const r = rng(830);
  const base = g.createLinearGradient(0, 0, w, 0);
  base.addColorStop(0, '#9EA3A6');
  base.addColorStop(0.35, '#C8CCCB');
  base.addColorStop(0.6, '#A9AEAF');
  base.addColorStop(1, '#8E9396');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  // 拉丝
  for (let i = 0; i < 500; i++) {
    g.strokeStyle = `rgba(255,255,255,${range(r, 0.03, 0.1)})`;
    g.beginPath();
    const y = r() * h;
    g.moveTo(0, y);
    g.lineTo(w, y + range(r, -2, 2));
    g.stroke();
  }
  // 罐身箍纹（横跨帽子的几道凸棱）
  for (let i = 0; i < 7; i++) {
    const y = h * (0.12 + i * 0.12);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, y, w, 3);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, y + 3, w, 3);
  }
  // 残标签：红底黄字，被剪得只剩一截，字只露出下半行
  g.save();
  g.translate(w * 0.5, h * 0.44);
  g.rotate(-0.04);
  g.fillStyle = '#A8231B';
  g.fillRect(-w * 0.62, -h * 0.02, w * 1.3, h * 0.2);
  g.fillStyle = '#E2B53E';
  g.fillRect(-w * 0.62, h * 0.16, w * 1.3, h * 0.025);
  g.beginPath();
  g.rect(-w * 0.62, -h * 0.02, w * 1.3, h * 0.2);
  g.clip();
  g.fillStyle = '#F2D46A';
  g.font = `bold ${Math.round(h * 0.2)}px ${FONT_STACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // 字的中线落在标签上边缘附近 → 只剩下半行
  g.fillText('红烧扣肉', w * 0.04, -h * 0.005);
  g.restore();
  // 褪色：标签一块块被洗掉，露出铁皮
  g.save();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 18; i++) blotch(g, r, r() * w, h * range(r, 0.4, 0.66), range(r, 10, 40), '#000', 0.55, 5);
  g.restore();
  g.save();
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = '#B4B8B8';
  g.fillRect(0, 0, w, h);
  g.restore();
  // 锈：边缘多、中间少
  for (let i = 0; i < 40; i++) {
    const edge = r() < 0.7;
    const x = edge ? (r() < 0.5 ? range(r, 0, 0.14) : range(r, 0.86, 1)) * w : r() * w;
    const y = edge && r() < 0.5 ? (r() < 0.5 ? range(r, 0, 0.12) : range(r, 0.88, 1)) * h : r() * h;
    const s = range(r, 6, edge ? 40 : 18);
    blotch(g, r, x, y, s * 1.2, '#4E2E18', 0.35, 5);
    blotch(g, r, x, y, s, '#94481A', 0.5, 5);
    blotch(g, r, x, y, s * 0.4, '#C66A2C', 0.4, 3);
  }
  // 两处敲瘪的暗痕
  for (let i = 0; i < 3; i++) waterStain(g, r, r() * w, r() * h, range(r, 20, 50));
  grain(g, w, h, 0.18, 831);
  // 毛边：沿四边往里咬的锯齿
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const inset = (t: number, k: number) => 6 + Math.abs(Math.sin(t * 0.21 + k) * 7 + Math.sin(t * 0.057 + k * 3) * 6);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cut = x < inset(y, 1) || x > w - 1 - inset(y, 2) || y < inset(x, 3) || y > h - 1 - inset(x, 4);
      if (cut) d[(y * w + x) * 4 + 3] = 0;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = canvasToTexture(canvas, { anisotropy: 4 });
  tex.name = 'tinHat';
  return tex;
}

/** 贴条底纸：泛黄、泡过水，常光下是空白的。 */
function stickerPaperTexture(): THREE.CanvasTexture {
  return paintTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#D6BF86';
    g.fillRect(0, 0, w, h);
    const r = rng(618);
    // 纸边发黄发暗
    const edge = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.6);
    edge.addColorStop(0, 'rgba(120,90,40,0)');
    edge.addColorStop(1, 'rgba(120,90,40,0.45)');
    g.fillStyle = edge;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) waterStain(g, r, range(r, 0.2, 0.9) * w, range(r, 0.2, 0.8) * h, range(r, 20, 50));
    // 右半截泡得最厉害（原来那两个字的位置）
    blotch(g, r, w * 0.8, h * 0.5, h * 0.55, 'rgb(150,125,80)', 0.35, 6);
    // 两头的透明胶带：发亮、边上沾了灰
    g.fillStyle = 'rgba(250,245,225,0.55)';
    g.fillRect(0, 0, w * 0.09, h);
    g.fillRect(w * 0.91, 0, w * 0.09, h);
    g.strokeStyle = 'rgba(60,50,30,0.5)';
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, w - 3, h - 3);
    grain(g, w, h, 0.15, 619);
  });
}

/** 贴条字迹（self_sticker_vf 层，透明底）：蓝圆珠笔“04.6.18”，后面两个字泡成一团墨晕。 */
function stickerInkTexture(): THREE.CanvasTexture {
  const tex = paintTexture(512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = rng(20040618);
    g.textBaseline = 'middle';
    drawHandLine(g, r, '04.6.18', w * 0.06, h * 0.55, h * 0.56, '#1f3a8a', { pressure: 1 });
    // 泡没的两个字：洇开的墨团
    g.save();
    for (let i = 0; i < 2; i++) blotch(g, r, w * (0.78 + i * 0.12), h * 0.55, h * 0.2, 'rgba(40,60,140,1)', 0.22, 6);
    g.restore();
  });
  tex.name = 'stickerInk';
  return tex;
}

/** 右侧编号贴纸“012”：白底黑字的设备标签。 */
function numberTexture(): THREE.CanvasTexture {
  return paintTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#F1EEE6';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 6;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#141414';
    g.font = `bold ${Math.round(h * 0.62)}px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('012', w / 2, h * 0.54);
    const r = rng(12);
    waterStain(g, r, w * 0.8, h * 0.3, h * 0.4);
    grain(g, w, h, 0.12, 13);
  });
}

// ---------------------------------------------------------------- 几何

/** 铁皮帽：弯折的平面。中间平贴在外壳顶上，两侧往下包，前面探出去当帽檐并往下折，后沿略翘。 */
function tinHatGeometry(): THREE.BufferGeometry {
  const W = 0.27, L = 0.43;
  const g = new THREE.PlaneGeometry(W, L, 12, 16);
  g.rotateX(-Math.PI / 2); // 法线朝上；原平面的 +y（贴图 v=1）→ -z（帽檐朝前）
  const p = g.attributes.position as THREE.BufferAttribute;
  const r = rng(77);
  const zOff = -0.035;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i) + zOff;
    let y = HAT_TOP;
    const ax = Math.abs(x);
    if (ax > 0.085) y -= (ax - 0.085) * (ax - 0.085) * 13;
    if (z < FRONT_Z + 0.02) y -= (FRONT_Z + 0.02 - z) * Math.tan(20 * DEG2RAD);
    if (z > 0.14) y -= (z - 0.14) * 0.25;
    // 手工剪的：不平整，轻微的凹凸
    y -= Math.max(0, Math.sin(x * 60 + 1) * Math.sin(z * 45) * 0.0016) + r() * 0.0008;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- 视频线

/** 视频线（ARCH §5.2）：7 个质点的 Verlet 链（= 6 节摆），在世界坐标里模拟，身子只挡住背面。 */
interface CableInternal extends CableRig {
  /** 身子的脊柱/髋关节（player.ts 绑定）；null = 头不在身上 */
  bindBody(b: { spine: THREE.Object3D; hips: THREE.Object3D } | null): void;
  /** 立即回到自然下垂（传送后） */
  reset(): void;
}

const SEGS = 6;
const DOWN = new THREE.Vector3(0, -1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const SEG_LEN = 0.125;
const CABLE_R = 0.0085;
/** 出线口朝向（tilt 局部）：往后略朝下，线先往后探再垂下来，形成一道弧，不会看成第二根支架 */
const GLAND_DIR = new THREE.Vector3(0, -0.62, 0.78).normalize();

function createCable(anchor: THREE.Object3D, own: <T extends THREE.Material>(m: T) => T): CableInternal {
  const group = new THREE.Group();
  group.name = 'cable';
  const rubber = own(newMat({ color: '#0c0c0e', roughness: 0.38, metalness: 0.05, tempC: 20 }));
  const chrome = own(newMat({ color: '#C9CCD0', roughness: 0.28, metalness: 0.85, tempC: 18 }));
  const segGeo = new THREE.CapsuleGeometry(CABLE_R, SEG_LEN, 2, 6);
  const segs = new THREE.InstancedMesh(segGeo, rubber, SEGS);
  segs.name = 'cableSegs';
  segs.frustumCulled = false; // 包围球随摆动变化，干脆不剔除（只有 6 节）
  group.add(segs);

  // BNC 插头：金属筒 + 卡口环 + 胶皮护套，一个网格一种材质各合一份
  const plug = new THREE.Group();
  plug.name = 'bncPlug';
  const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.0075, 0.03, 10).translate(0, -0.015, 0), rubber);
  const metalParts = [
    new THREE.CylinderGeometry(0.0095, 0.0095, 0.026, 12).translate(0, -0.043, 0),
    new THREE.CylinderGeometry(0.0115, 0.0115, 0.009, 12).translate(0, -0.05, 0),
    new THREE.CylinderGeometry(0.0022, 0.0022, 0.012, 6).translate(0, -0.061, 0),
  ];
  const metalGeo = mergeSimple(metalParts);
  const metal = new THREE.Mesh(metalGeo, chrome);
  plug.add(boot, metal);
  group.add(plug);

  const pts = Array.from({ length: SEGS + 1 }, () => new THREE.Vector3());
  const prev = Array.from({ length: SEGS + 1 }, () => new THREE.Vector3());
  let body: { spine: THREE.Object3D; hips: THREE.Object3D } | null = null;
  let inited = false;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), a0 = new THREE.Vector3();
  const aq = new THREE.Quaternion(), glandW = new THREE.Vector3();
  const lastAnchor = new THREE.Vector3();
  const inv = new THREE.Matrix4(), m = new THREE.Matrix4(), qd = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);

  const hang = () => {
    anchor.getWorldPosition(a0);
    for (let i = 0; i <= SEGS; i++) {
      pts[i]!.set(a0.x, a0.y - i * SEG_LEN, a0.z);
      prev[i]!.copy(pts[i]!);
    }
    lastAnchor.copy(a0);
    inited = true;
  };

  /**
   * 身子背面（在脊柱/髋关节的局部坐标里比较：人偶面朝 -z，背面在 +z）：穿进去的推出来；
   * attract>0 时把肩膀以下的点往背上轻轻拉（线贴着后背垂到腰间，而不是悬在背后像第二根杆子）。
   */
  const collideBody = (p: THREE.Vector3, attract: number) => {
    if (!body) return;
    for (const [joint, y0, y1, backZ] of [[body.spine, -0.02, 0.42, 0.122], [body.hips, -0.45, 0.12, 0.112]] as const) {
      tmp.copy(p);
      joint.worldToLocal(tmp);
      if (tmp.y < y0 || tmp.y > y1 || Math.abs(tmp.x) > 0.22 || tmp.z < -0.12) continue;
      const lim = backZ + CABLE_R;
      if (tmp.z < lim) tmp.z = lim;
      else if (attract > 0 && tmp.z < lim + 0.25) tmp.z -= (tmp.z - lim) * attract;
      else continue;
      joint.localToWorld(tmp);
      p.copy(tmp);
      return;
    }
  };

  const step = (h: number) => {
    anchor.getWorldPosition(a0);
    // 传送或第一次：直接挂好
    if (!inited || a0.distanceToSquared(lastAnchor) > 1) {
      hang();
      return;
    }
    lastAnchor.copy(a0);
    const pinned = plug.parent !== group;
    const damping = 0.975;
    for (let i = 1; i <= SEGS; i++) {
      const p = pts[i]!, q0 = prev[i]!;
      tmp.copy(p).sub(q0).multiplyScalar(damping);
      q0.copy(p);
      p.add(tmp);
      p.y -= 9.8 * h * h;
    }
    pts[0]!.copy(a0);
    if (pinned) plug.getWorldPosition(pts[SEGS]!);
    for (let it = 0; it < 6; it++) {
      for (let i = 0; i < SEGS; i++) {
        const pa = pts[i]!, pb = pts[i + 1]!;
        tmp.copy(pb).sub(pa);
        const d = tmp.length() || 1e-6;
        // 插在插孔上时允许拉长（线是软的，看起来是被扯直了）
        const target = pinned ? Math.max(SEG_LEN, d * 0.999) : SEG_LEN;
        const diff = (d - target) / d;
        const wa = i === 0 ? 0 : 0.5, wb = i + 1 === SEGS && pinned ? 0 : (i === 0 ? 1 : 0.5);
        pa.addScaledVector(tmp, diff * wa);
        pb.addScaledVector(tmp, -diff * wb);
      }
      // 出线口的硬护套：第一节顺着出线方向，第二节也被带一点（抗弯）
      anchor.getWorldQuaternion(aq);
      glandW.copy(GLAND_DIR).applyQuaternion(aq);
      tmp.copy(a0).addScaledVector(glandW, SEG_LEN);
      pts[1]!.lerp(tmp, 0.6);
      for (let i = 1; i < SEGS; i++) {
        // 轻微的抗弯：往两邻点中点拉一点，弧线更顺
        tmp.copy(pts[i - 1]!).add(pts[i + 1]!).multiplyScalar(0.5);
        pts[i]!.lerp(tmp, 0.04);
      }
      for (let i = 1; i <= SEGS; i++) collideBody(pts[i]!, it === 0 && i >= 2 ? 0.05 : 0);
      pts[0]!.copy(a0);
    }
  };

  const render = () => {
    group.updateWorldMatrix(true, false);
    inv.copy(group.matrixWorld).invert();
    for (let i = 0; i < SEGS; i++) {
      const pa = pts[i]!, pb = pts[i + 1]!;
      tmp.copy(pb).sub(pa);
      const len = tmp.length() || SEG_LEN;
      qd.setFromUnitVectors(up, tmp.multiplyScalar(-1 / len)); // 胶囊沿 +y，线从 a 往下到 b
      tmp2.copy(pa).add(pb).multiplyScalar(0.5);
      sc.set(1, (len + CABLE_R * 2) / (SEG_LEN + CABLE_R * 2), 1);
      m.compose(tmp2, qd, sc).premultiply(inv);
      segs.setMatrixAt(i, m);
    }
    segs.instanceMatrix.needsUpdate = true;
    if (plug.parent === group) {
      const pe = pts[SEGS]!, pp = pts[SEGS - 1]!;
      tmp.copy(pe).sub(pp).normalize();
      qd.setFromUnitVectors(DOWN, tmp);
      m.compose(pe, qd, ONE).premultiply(inv);
      m.decompose(plug.position, plug.quaternion, plug.scale);
    }
  };

  let acc = 0;
  const H = 1 / 90;
  const plugLayers = new Map<THREE.Object3D, number>();
  return {
    group,
    plug,
    get plugged() {
      return plug.parent !== group;
    },
    plugTo(to) {
      if (to) {
        if (plugLayers.size === 0) plug.traverse(o => plugLayers.set(o, o.layers.mask));
        to.add(plug);
        plug.position.set(0, 0, 0);
        plug.quaternion.identity();
        plug.scale.set(1, 1, 1);
        setLayerRecursive(plug, 'world');
        return;
      }
      if (plug.parent === group) return;
      group.add(plug);
      for (const [o, mask] of plugLayers) o.layers.mask = mask;
      plugLayers.clear();
      inited = false;
    },
    update(dt) {
      // 固定步长（游戏 dt 可能很大：advance() 快进、掉帧），最多补 8 步
      acc = Math.min(acc + Math.max(0, dt), H * 8);
      while (acc >= H) {
        step(H);
        acc -= H;
      }
      if (!inited) hang();
      render();
    },
    bindBody(b) {
      body = b;
    },
    reset() {
      inited = false;
    },
  };
}

/** 只有 position/normal/uv 的几何合并（插头、胶带这类小件）。 */
function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0, idxTotal = 0;
  for (const g of geos) {
    total += g.attributes.position?.count ?? 0;
    idxTotal += g.index ? g.index.count : g.attributes.position?.count ?? 0;
  }
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  const idx = new Uint32Array(idxTotal);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    const u = g.attributes.uv as THREE.BufferAttribute | undefined;
    pos.set(p.array as Float32Array, vo * 3);
    nor.set(n.array as Float32Array, vo * 3);
    if (u) uv.set(u.array as Float32Array, vo * 2);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) idx[io++] = i + vo;
    vo += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// ---------------------------------------------------------------- 工厂

/** WP2 内部：player.ts 需要的额外控制。 */
export interface CameraHeadInternal extends CameraHead {
  bindBody(b: { spine: THREE.Object3D; hips: THREE.Object3D } | null): void;
  /** 当前云台角（度），调试与测试用 */
  readonly look: { yaw: number; pitch: number };
  /** 头当前是否挂在最初的安装点上 */
  readonly mounted: boolean;
  /** 立即把视频线挂直（传送、读档后） */
  resetCable(): void;
  dispose(): void;
}

/** 创建摄像头头部（WP2 内部：createPlayerModel 使用）。 */
export function createCameraHead(): CameraHeadInternal {
  const owned: THREE.Material[] = [];
  const own = <T extends THREE.Material>(mt: T): T => {
    owned.push(mt);
    return mt;
  };
  const group = new THREE.Group();
  group.name = 'cameraHead';
  const pan = new THREE.Group();
  pan.name = 'pan';
  const tilt = new THREE.Group();
  tilt.name = 'tilt';
  tilt.position.y = TILT_Y;
  group.add(pan);
  pan.add(tilt);
  /** tilt 里的坐标 = 头部局部坐标减去俯仰轴高度 */
  const Y = (y: number) => y - TILT_Y;

  // 材质
  const housingMat = own(newMat({ color: 0xffffff, map: housingTexture(), roughness: 0.42, metalness: 0, tempC: 28, envMapIntensity: 1.2 }));
  const darkMetal = own(newMat({ color: '#2a2c31', roughness: 0.4, metalness: 0.6, tempC: 22 }));
  const barrelMat = own(newMat({ color: '#18191c', roughness: 0.35, metalness: 0.5, tempC: 24 }));
  const ringMat = own(newMat({ color: 0xffffff, map: ringTexture(), roughness: 0.45, metalness: 0.5, tempC: 24 }));
  const coatTex = lensCoatTexture();
  // 镀膜的紫绿环与两道假高光带一点自发光（M1c look-dev）：夜里环境几乎全黑，纯靠反射的镜头只是一个黑洞
  const glassMat = own(new THREE.MeshPhysicalMaterial({
    color: '#ffffff', map: coatTex, emissiveMap: coatTex, emissive: '#ffffff', emissiveIntensity: LENS_COAT_GLOW,
    roughness: 0.18, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.2,
  }));
  glassMat.userData.tempC = 20;
  const hatTex = tinHatTexture();
  // 铁皮帽：金属感靠环境贴图（ARCH §8.3）；roughness 取 ARCH 允许范围的上沿，免得钠灯下帽顶一个针尖高光被 Bloom 吹成一团光
  // M1c look-dev：metalness 0.45 → 0.6、roughness 0.58 → 0.5，贴图乘 0.85：原来在门灯下像一顶浅色纸帽，现在暗面映夜空、受光面有铁皮的高光
  const hatMat = own(newMat({ color: '#d9d9d9', map: hatTex, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide, alphaTest: 0.5, tempC: 18, envMapIntensity: 1.4 }));
  const paperMat = own(newMat({ color: 0xffffff, map: stickerPaperTexture(), roughness: 0.95, tempC: 20 }));
  const inkMat = own(new THREE.MeshBasicMaterial({ map: stickerInkTexture(), transparent: true, depthWrite: false }));
  const numMat = own(newMat({ color: 0xffffff, map: numberTexture(), roughness: 0.8, tempC: 22 }));
  const ledMat = own(newMat({ color: '#3a0505', emissive: PALETTE.REC, emissiveIntensity: 0, roughness: 0.3, tempC: 40 }));
  // 环境反光（M1c look-dev）：r186 在 scene.environment 下把 envMapIntensity 统一成 scene.environmentIntensity，
  // 材质自己的倍率不起作用；头部的金属、镜头玻璃、铁皮帽要比墙面“更反光”，所以每次绘制前把区域的环境贴图显式挂到这几个材质上
  // （material.envMap 非空时 three 用材质自己的 envMapIntensity），强度 = 区域强度 × HEAD_ENV_BOOST。
  const envBoost: [THREE.MeshStandardMaterial, number][] = [
    [housingMat, HEAD_ENV_BOOST.housing], [darkMetal, HEAD_ENV_BOOST.metal], [barrelMat, HEAD_ENV_BOOST.metal],
    [ringMat, HEAD_ENV_BOOST.metal], [glassMat, HEAD_ENV_BOOST.glass], [hatMat, HEAD_ENV_BOOST.hat],
  ];
  const syncEnv: THREE.Object3D['onBeforeRender'] = (_r, scene) => {
    const env = scene.environment;
    for (const [m, k] of envBoost) {
      if (m.envMap !== env) m.envMap = env;
      m.envMapIntensity = scene.environmentIntensity * k;
    }
  };

  // 云台底座（随头走：挂到门楣支架上时也有）
  const panBase = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, PAN_BASE_H, 14).translate(0, -PAN_BASE_H / 2, 0), darkMetal);
  panBase.name = 'panBase';
  group.add(panBase);
  // 外壳
  const housingGeo = new RoundedBoxGeometry(HOUSING.w, HOUSING.h, HOUSING.len, 2, HOUSING.bevel);
  housingGeo.translate(0, Y(HOUSING.h / 2), 0);
  remapHousingUv(housingGeo);
  const housing = new THREE.Mesh(housingGeo, housingMat);
  housing.name = 'housing';
  housing.onBeforeRender = syncEnv;
  tilt.add(housing);

  // 镜头：镜筒 → 镜头环（可转）→ 镀膜玻璃
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(LENS.r * 0.96, LENS.r, LENS.barrelLen, 24).rotateX(Math.PI / 2).translate(0, Y(LENS.y), FRONT_Z - LENS.barrelLen / 2 + 0.004),
    barrelMat,
  );
  barrel.name = 'lensBarrel';
  tilt.add(barrel);
  const ringGeo = new THREE.CylinderGeometry(LENS.r * 1.07, LENS.r * 1.07, 0.022, 32, 1, true).rotateX(Math.PI / 2);
  const lensRing = new THREE.Mesh(ringGeo, ringMat);
  lensRing.name = 'lensRing';
  lensRing.position.set(0, Y(LENS.y), FRONT_Z - 0.02);
  tilt.add(lensRing);
  const glassZ = FRONT_Z - LENS.barrelLen + 0.0035;
  const glass = new THREE.Mesh(new THREE.CircleGeometry(LENS.r * 0.82, 32), glassMat);
  glass.name = 'lensGlass';
  glass.rotation.y = Math.PI; // 圆片法线朝 -z（镜头朝向）
  glass.position.set(0, Y(LENS.y), glassZ);
  tilt.add(glass);
  const lensAnchor = new THREE.Object3D();
  lensAnchor.name = 'lensAnchor';
  lensAnchor.position.set(0, Y(LENS.y), glassZ);
  tilt.add(lensAnchor);

  // 贴条：底纸（self_head）+ 字迹（self_sticker_vf）
  const sticker = new THREE.Group();
  sticker.name = 'sticker';
  sticker.position.set(-0.004, Y(STICKER.y), FRONT_Z - 0.0012);
  sticker.rotation.set(0, Math.PI, -0.035); // 贴歪了一点；平面法线朝 -z
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(STICKER.w, STICKER.h), paperMat);
  paper.name = 'stickerPaper';
  const ink = new THREE.Mesh(new THREE.PlaneGeometry(STICKER.w * 0.96, STICKER.h * 0.96), inkMat);
  ink.name = 'stickerInk';
  ink.position.z = 0.0006;
  ink.renderOrder = 2;
  sticker.add(paper, ink);
  tilt.add(sticker);
  const stickerAnchor = new THREE.Object3D();
  stickerAnchor.name = 'stickerAnchor';
  stickerAnchor.position.set(0, Y(STICKER.y), FRONT_Z - 0.0012);
  tilt.add(stickerAnchor);

  // 右侧“012”编号（右 = +x）
  const num = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.037), numMat);
  num.name = 'number012';
  num.position.set(HOUSING.w / 2 + 0.0008, Y(0.115), 0.03);
  num.rotation.y = Math.PI / 2;
  tilt.add(num);

  // REC 灯：前脸右上角的小圆柱（从镜头方向看是左上）
  const recLed = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.008, 12).rotateX(Math.PI / 2), ledMat);
  recLed.name = 'recLed';
  recLed.position.set(0.072, Y(0.195), FRONT_Z - 0.003);
  tilt.add(recLed);

  // 铁皮帽
  const tinHat = new THREE.Mesh(tinHatGeometry(), hatMat);
  tinHat.name = 'tinHat';
  tinHat.onBeforeRender = syncEnv;
  tinHat.position.y = -TILT_Y;
  tinHat.rotation.set(0.01, 0.03, 0.02);
  tilt.add(tinHat);
  // 视频线：后脑出线口（护套）→ 摆链 → BNC
  const gland = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.03, 10).rotateX(Math.PI / 2).translate(0, Y(0.07), HOUSING.len / 2 + 0.012), barrelMat);
  gland.name = 'cableGland';
  tilt.add(gland);
  const cableAnchor = new THREE.Object3D();
  cableAnchor.name = 'cableAnchor';
  cableAnchor.position.set(0, Y(0.066), HOUSING.len / 2 + 0.028);
  tilt.add(cableAnchor);
  const cable = createCable(cableAnchor, own);
  group.add(cable.group);

  // 支架圆柱（属于身子：领口 1.50 → 云台底座 1.754）
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.023, NECK_LEN - PAN_BASE_H, 12).translate(0, (NECK_LEN - PAN_BASE_H) / 2, 0), darkMetal);
  neck.name = 'neckPole';

  setLayerRecursive(group, 'self_head');
  setLayerRecursive(neck, 'self_head');
  setLayerRecursive(ink, 'self_sticker_vf');

  // ------------------------------------------------ 状态
  let yaw = 0, pitch = 0;
  let lookYaw = 0, lookPitch = 0;
  let scanT = 0, idleT = 0;
  let ringTarget = 0;
  let recT = 0;
  let home: { parent: THREE.Object3D; pos: THREE.Vector3; quat: THREE.Quaternion } | null = null;
  let boundBody: { spine: THREE.Object3D; hips: THREE.Object3D } | null = null;

  /** 云台巡航：左 → 停 → 右 → 停（周期 16 秒，幅度 ±38°，略微低头）。 */
  const patrol = (t: number): number => {
    const T = 16, u = (t % T) / T;
    const seg = (a: number, b: number, k: number) => a + (b - a) * (k * k * (3 - 2 * k));
    if (u < 0.35) return seg(0, 38, u / 0.35);
    if (u < 0.45) return 38;
    if (u < 0.85) return seg(38, -38, (u - 0.45) / 0.4);
    return seg(-38, 0, (u - 0.85) / 0.15);
  };

  const head: CameraHeadInternal = {
    group, neck, lensAnchor, stickerAnchor, lensRing, recLed, sticker, tinHat,
    cable,
    get look() { return { yaw, pitch }; },
    get mounted() { return home !== null && group.parent === home.parent; },
    setZoom(z) {
      ringTarget = RING_ANGLE[z] ?? 0;
    },
    setLook(yawOffsetDeg, pitchDeg) {
      lookYaw = yawOffsetDeg;
      lookPitch = pitchDeg;
    },
    update(dt, o) {
      // REC：每 recBlinkSec 秒亮一次（亮 40%）
      recT = (recT + dt) % TIMING.recBlinkSec;
      const on = o.recBlink && recT < TIMING.recBlinkSec * 0.4;
      ledMat.emissiveIntensity = on ? 3.2 : 0;
      ledMat.color.copy(on ? LED_ON : LED_OFF);

      let ty = lookYaw, tp = lookPitch, lambda = 18;
      if (o.scanning && !o.moving) {
        idleT += dt;
        if (idleT > 1.5) {
          scanT += dt;
          ty = patrol(scanT);
          tp = -7;
          lambda = 3;
        }
      } else {
        idleT = 0;
        scanT = 0;
        if (o.moving) lambda = 10;
      }
      yaw = damp(yaw, ty, lambda, dt);
      pitch = damp(pitch, tp, lambda, dt);
      pan.rotation.y = -yaw * DEG2RAD;
      tilt.rotation.x = pitch * DEG2RAD;
      lensRing.rotation.z = damp(lensRing.rotation.z, ringTarget, 9, dt);
      cable.update(dt);
    },
    detach() {
      if (group.parent && !home) home = { parent: group.parent, pos: group.position.clone(), quat: group.quaternion.clone() };
      group.removeFromParent();
      cable.bindBody(null);
      yaw = pitch = lookYaw = lookPitch = 0;
      pan.rotation.y = 0;
      tilt.rotation.x = 0;
      return group;
    },
    reattach() {
      if (!home) return;
      group.removeFromParent();
      home.parent.add(group);
      group.position.copy(home.pos);
      group.quaternion.copy(home.quat);
      cable.bindBody(boundBody);
      cable.reset();
    },
    bindBody(b) {
      boundBody = b;
      cable.bindBody(b);
      if (b && group.parent) home = { parent: group.parent, pos: group.position.clone(), quat: group.quaternion.clone() };
    },
    resetCable() {
      cable.reset();
    },
    dispose() {
      group.traverse(c => {
        const mm = c as THREE.Mesh;
        if (mm.isMesh) mm.geometry.dispose();
      });
      neck.geometry.dispose();
      for (const mt of owned) {
        const map = (mt as THREE.MeshStandardMaterial).map;
        map?.dispose();
        mt.dispose();
      }
    },
  };
  return head;
}
