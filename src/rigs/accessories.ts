// owner: WP2
// 角色配件（ARCH §2.7）：帽子、发髻、竹篮、拐杖灯笼、搪瓷缸、双反相机、尾巴、脸部雪花遮罩……以及衣服贴图（OUTFIT）。
// WP2 内部模块（characters.ts / player.ts 使用）；其他 WP 通过 CharacterRig.props 访问配件。签名由 WP2 自行决定。
// 尺寸参数 s = 人偶身高 / 1.75（与 humanoid.ts 一致）；帽子、发髻挂在 joints.headSlot（头心在 0.14s）。

import * as THREE from 'three';
import { PALETTE } from '../data/palette';
import { TEMP_C } from '../data/render';
import { blotch, canvasToTexture, createCanvas, grain, paintTexture, shade, waterStain } from '../kit/canvas';
import { kitMat, mergeByMaterial, newMat } from '../kit/geom';
import { rng, range } from '../kit/rng';
import { FONT_STACK } from '../kit/text';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { torsoSurface, type HumanoidInternal } from './humanoid';

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

// ---------------------------------------------------------------- 配件

export interface AccessoryKit {
  /** 蓝布单帽（老周）/ 破毡帽（黄三爷）；low=帽檐压低遮脸 */
  cap(style: 'cloth' | 'felt', s: number, o?: { low?: boolean }): THREE.Group;
  /** Lathe 发髻（王奶奶） */
  bun(s: number): THREE.Group;
  /** Cylinder + Torus 提手的竹篮 */
  basket(s: number): THREE.Group;
  /** 枣木拐杖 + 小红灯笼（土地） */
  caneLantern(s: number): { group: THREE.Group; lantern: THREE.Object3D; light: THREE.Object3D };
  /** 搪瓷缸（老周） */
  mug(s: number): THREE.Group;
  /** 双反相机（陆师傅，Box 加两个 Cylinder），挂在胸前 */
  tlr(s: number): THREE.Group;
  /** 黄鼠狼尾巴 */
  tail(s: number): THREE.Group;
  /** 脸部动态雪花遮罩（老周回放 faceMask）：永远挡在头与相机之间 */
  faceSnow(s: number, headCenter: THREE.Object3D): THREE.Mesh;
  /** 老花镜 */
  glasses(s: number): THREE.Group;
  /** Line 白胡子（土地） */
  beard(s: number): THREE.Object3D;
  /** 红袖箍“值勤”（套在左臂袖子上） */
  armband(s: number): THREE.Mesh;
  /** 衬衫领子与肩章（主角、老周）：挂在 spine 上 */
  shirtCollar(s: number, color: THREE.ColorRepresentation, o?: { open?: boolean }): THREE.Group;
  /** 安全帽（拆迁工人） */
  hardHat(s: number): THREE.Group;
  /** 小孩的红领巾 */
  scarf(s: number): THREE.Mesh;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  return m;
}

function cap(style: 'cloth' | 'felt', s: number, o?: { low?: boolean }): THREE.Group {
  const g = new THREE.Group();
  g.name = style === 'cloth' ? 'clothCap' : 'feltHat';
  if (style === 'cloth') {
    const mat = kitMat('cap.cloth', { color: '#34465F', roughness: 0.95 });
    const crown = new THREE.CylinderGeometry(0.094 * s, 0.103 * s, 0.075 * s, 16);
    const top = new THREE.SphereGeometry(0.094 * s, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    top.scale(1, 0.35, 1);
    top.translate(0, 0.037 * s, 0);
    const c = mesh(crown, mat, 'crown');
    const t = mesh(top, mat, 'top');
    const brim = mesh(new THREE.CircleGeometry(0.075 * s, 14, 0, Math.PI), mat, 'brim');
    brim.geometry.rotateX(-Math.PI / 2);
    brim.geometry.rotateY(Math.PI / 2);
    brim.position.set(0, -0.03 * s, -0.09 * s);
    brim.rotation.x = 0.28;
    brim.scale.set(1, 1, 0.7);
    g.add(c, t, brim);
    g.position.y = 0.235 * s;
    g.rotation.x = -0.12;
  } else {
    const mat = kitMat('cap.felt', { color: '#3A2F25', roughness: 1, side: THREE.DoubleSide });
    const crownG = new THREE.CylinderGeometry(0.085 * s, 0.1 * s, 0.1 * s, 12, 2);
    const p = crownG.attributes.position as THREE.BufferAttribute;
    const r = rng(33);
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setY(i, p.getY(i) - range(r, 0, 0.02) * s);
    crownG.computeVertexNormals();
    const brimG = new THREE.RingGeometry(0.095 * s, 0.17 * s, 16, 1);
    brimG.rotateX(-Math.PI / 2);
    const bp = brimG.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), z = bp.getZ(i);
      const rr = Math.hypot(x, z);
      // 破毡帽：帽檐前后耷拉、边缘不齐
      bp.setY(i, -Math.max(0, rr - 0.1 * s) * (0.35 + 0.4 * Math.abs(z) / (rr || 1)) + range(r, -0.004, 0.004) * s);
    }
    brimG.computeVertexNormals();
    g.add(mesh(crownG, mat, 'crown'), mesh(brimG, mat, 'brim'));
    g.children[0]!.position.y = 0.05 * s;
    g.position.y = (o?.low ? 0.2 : 0.23) * s;
    g.rotation.x = o?.low ? -0.32 : -0.08;
    if (o?.low) g.position.z = -0.03 * s;
  }
  return g;
}

function bun(s: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'bun';
  const mat = kitMat('hair.gray', { color: '#8D8A86', roughness: 0.9 });
  const pts = [[0.001, 0.05], [0.035, 0.045], [0.05, 0.025], [0.052, 0], [0.04, -0.025], [0.001, -0.03]].map(([x, y]) => new THREE.Vector2((x ?? 0) * s, (y ?? 0) * s));
  const geo = new THREE.LatheGeometry(pts, 12);
  geo.rotateX(Math.PI / 2);
  const b = mesh(geo, mat, 'bunLathe');
  b.position.set(0, 0.13 * s, 0.1 * s);
  const pin = mesh(new THREE.CylinderGeometry(0.003 * s, 0.003 * s, 0.14 * s, 5), kitMat('hairpin', { color: '#C9A445', metalness: 0.7, roughness: 0.35 }), 'hairpin');
  pin.rotation.z = Math.PI / 2 - 0.3;
  pin.position.set(0, 0.14 * s, 0.13 * s);
  g.add(b, pin);
  return g;
}

function basket(s: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'basket';
  const tex = cachedTex('acc.wicker', () => paintTexture(256, 64, (c, w, h) => {
    c.fillStyle = '#8C6A3A';
    c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) {
      for (let x = (y / 8) % 2 ? 0 : 8; x < w; x += 16) {
        c.fillStyle = '#B08A4E';
        c.fillRect(x, y + 1, 12, 6);
      }
    }
    c.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = 0; x < w; x += 16) c.fillRect(x, 0, 2, h);
  }, { repeat: [1, 1] }));
  const mat = kitMat('basket', { color: 0xffffff, map: tex, roughness: 0.95, side: THREE.DoubleSide });
  const body = mesh(new THREE.CylinderGeometry(0.15 * s, 0.11 * s, 0.14 * s, 16, 1, true), mat, 'basketBody');
  const bottom = mesh(new THREE.CircleGeometry(0.11 * s, 16).rotateX(-Math.PI / 2).translate(0, -0.07 * s, 0), mat, 'basketBottom');
  const handle = mesh(new THREE.TorusGeometry(0.13 * s, 0.009 * s, 5, 16, Math.PI), kitMat('basket.handle', { color: '#7A5A30', roughness: 0.9 }), 'handle');
  handle.position.y = 0.07 * s;
  // 盖着的一块蓝布（馄饨碗在底下）
  const cloth = mesh(new THREE.CircleGeometry(0.14 * s, 12).rotateX(-Math.PI / 2).translate(0, 0.05 * s, 0), kitMat('basket.cloth', { color: '#3E5A7C', roughness: 1, side: THREE.DoubleSide }), 'cloth');
  g.add(body, bottom, handle, cloth);
  return g;
}

function caneLantern(s: number): { group: THREE.Group; lantern: THREE.Object3D; light: THREE.Object3D } {
  const g = new THREE.Group();
  g.name = 'caneLantern';
  const wood = kitMat('cane.jujube', { color: '#6B3A22', roughness: 0.7 });
  // 枣木拐杖：三段略弯，顶上一个回钩
  const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.01, 0.4, 0), new THREE.Vector3(-0.012, 0.8, 0), new THREE.Vector3(0, 1.15, 0), new THREE.Vector3(0.05, 1.24, 0), new THREE.Vector3(0.1, 1.2, 0)]
    .map(v => v.multiplyScalar(s * 1.2));
  const curve = new THREE.CatmullRomCurve3(pts);
  const cane = mesh(new THREE.TubeGeometry(curve, 24, 0.014 * s * 1.2, 6), wood, 'cane');
  g.add(cane);
  // 小红灯笼挂在回钩下
  const lantern = new THREE.Group();
  lantern.name = 'lantern';
  const hookEnd = pts[5]!;
  lantern.position.set(hookEnd.x, hookEnd.y - 0.02 * s, 0);
  const string = mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.06 * s, 4).translate(0, -0.03 * s, 0), kitMat('lantern.string', { color: '#2a1a10' }), 'string');
  const prof = [[0.001, 0.07], [0.035, 0.065], [0.06, 0.035], [0.066, 0], [0.06, -0.035], [0.035, -0.065], [0.001, -0.07]]
    .map(([x, y]) => new THREE.Vector2((x ?? 0) * s * 1.2, (y ?? 0) * s * 1.2));
  const lampTex = cachedTex('acc.redLantern', () => paintTexture(128, 64, (c, w, h) => {
    const grd = c.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#FFB070');
    grd.addColorStop(0.5, '#FF5A3A');
    grd.addColorStop(1, '#C8321E');
    c.fillStyle = grd;
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(90,10,5,0.5)';
    for (let x = 0; x < w; x += 16) c.fillRect(x, 0, 2, h);
  }));
  const body = mesh(new THREE.LatheGeometry(prof, 14), newMat({ color: '#FF6A4A', map: lampTex, emissive: '#FF5A3A', emissiveIntensity: 1.6, emissiveMap: lampTex, roughness: 0.8, tempC: TEMP_C.lamp }), 'lanternBody');
  body.position.y = -0.14 * s;
  body.userData.keepMaterial = true;
  const capMat = kitMat('lantern.cap', { color: '#C9A13A', metalness: 0.5, roughness: 0.4 });
  const capTop = mesh(new THREE.CylinderGeometry(0.03 * s, 0.035 * s, 0.015 * s, 10), capMat, 'capTop');
  capTop.position.y = (-0.14 + 0.085) * s;
  const capBot = capTop.clone();
  capBot.position.y = (-0.14 - 0.085) * s;
  const tassel = mesh(new THREE.ConeGeometry(0.012 * s, 0.07 * s, 6).rotateX(Math.PI), kitMat('lantern.tassel', { color: '#B01818', roughness: 1 }), 'tassel');
  tassel.position.y = (-0.14 - 0.13) * s;
  lantern.add(string, body, capTop, capBot, tassel);
  const light = new THREE.Object3D();
  light.name = 'lanternLightAnchor';
  light.position.y = -0.14 * s;
  lantern.add(light);
  g.add(lantern);
  return { group: g, lantern, light };
}

function mug(s: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'mug';
  const tex = cachedTex('acc.enamelMug', () => paintTexture(256, 128, (c, w, h) => {
    c.fillStyle = '#EDEBE3';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#2B4C8C';
    c.fillRect(0, 0, w, h * 0.1);
    c.fillStyle = '#C0231E';
    c.font = `bold ${Math.round(h * 0.28)}px ${FONT_STACK}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('先进工作者', w * 0.75, h * 0.55);
    const r = rng(1984);
    for (let i = 0; i < 9; i++) {
      c.fillStyle = '#1c1c1c';
      c.beginPath();
      c.ellipse(r() * w, range(r, 0.1, 0.95) * h, range(r, 2, 6), range(r, 2, 5), r(), 0, Math.PI * 2);
      c.fill();
    }
  }));
  const mat = kitMat('mug.enamel', { color: 0xffffff, map: tex, roughness: 0.3, metalness: 0.1 });
  const body = mesh(new THREE.CylinderGeometry(0.045 * s, 0.042 * s, 0.09 * s, 16, 1, true), mat, 'mugBody');
  const bottom = mesh(new THREE.CircleGeometry(0.042 * s, 16).rotateX(-Math.PI / 2).translate(0, -0.045 * s, 0), mat, 'mugBottom');
  const inside = mesh(new THREE.CircleGeometry(0.044 * s, 16).rotateX(-Math.PI / 2).translate(0, 0.02 * s, 0), kitMat('mug.tea', { color: '#3a2a12', roughness: 0.1 }), 'tea');
  const handle = mesh(new THREE.TorusGeometry(0.028 * s, 0.006 * s, 5, 10, Math.PI), kitMat('mug.handle', { color: '#EDEBE3', roughness: 0.3 }), 'mugHandle');
  handle.rotation.z = -Math.PI / 2;
  handle.position.x = 0.045 * s;
  g.add(body, bottom, inside, handle);
  return g;
}

function tlr(s: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tlr';
  const leather = kitMat('tlr.leather', { color: '#1a1a1a', roughness: 0.75 });
  const chrome = kitMat('tlr.chrome', { color: '#B8BCC2', roughness: 0.25, metalness: 0.9 });
  const glass = kitMat('tlr.glass', { color: '#0a0c14', roughness: 0.05, metalness: 0.8 });
  const body = mesh(new THREE.BoxGeometry(0.08 * s, 0.13 * s, 0.075 * s), leather, 'tlrBody');
  const hood = mesh(new THREE.BoxGeometry(0.075 * s, 0.03 * s, 0.07 * s).translate(0, 0.08 * s, 0), chrome, 'hood');
  const lensGeo = new THREE.CylinderGeometry(0.02 * s, 0.022 * s, 0.03 * s, 14).rotateX(Math.PI / 2);
  const l1 = mesh(lensGeo, chrome, 'viewLens');
  l1.position.set(0, 0.03 * s, -0.052 * s);
  const l2 = mesh(lensGeo, chrome, 'takeLens');
  l2.position.set(0, -0.025 * s, -0.052 * s);
  const gl = new THREE.CircleGeometry(0.016 * s, 12);
  gl.rotateY(Math.PI);
  const g1 = mesh(gl, glass, 'g1');
  g1.position.set(0, 0.03 * s, -0.068 * s);
  const g2 = g1.clone();
  g2.position.y = -0.025 * s;
  // 背带：从相机两侧绕到脖子后面
  const strapCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.04 * s, 0.05 * s, 0), new THREE.Vector3(-0.09 * s, 0.2 * s, 0.05 * s), new THREE.Vector3(-0.06 * s, 0.34 * s, 0.1 * s),
    new THREE.Vector3(0, 0.37 * s, 0.13 * s), new THREE.Vector3(0.06 * s, 0.34 * s, 0.1 * s), new THREE.Vector3(0.09 * s, 0.2 * s, 0.05 * s), new THREE.Vector3(0.04 * s, 0.05 * s, 0),
  ]);
  const strap = mesh(new THREE.TubeGeometry(strapCurve, 20, 0.005 * s, 4), leather, 'strap');
  g.add(body, hood, l1, l2, g1, g2, strap);
  return g;
}

function tail(s: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tail';
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.12, 0.1), new THREE.Vector3(0, -0.28, 0.16), new THREE.Vector3(0.03, -0.42, 0.14), new THREE.Vector3(0.05, -0.5, 0.06),
  ].map(v => v.multiplyScalar(s)));
  const geo = new THREE.TubeGeometry(curve, 20, 0.04 * s, 8);
  // 往尾尖收细
  const p = geo.attributes.position as THREE.BufferAttribute;
  const n = 21, ring = 9;
  for (let i = 0; i < n; i++) {
    const c = curve.getPointAt(i / (n - 1));
    const k = 0.55 + 0.45 * Math.sin(Math.min(1, (i / (n - 1)) * 1.3) * Math.PI) - (i / (n - 1)) * 0.4;
    for (let j = 0; j < ring; j++) {
      const idx = i * ring + j;
      if (idx >= p.count) continue;
      p.setXYZ(idx, c.x + (p.getX(idx) - c.x) * k, c.y + (p.getY(idx) - c.y) * k, c.z + (p.getZ(idx) - c.z) * k);
    }
  }
  geo.computeVertexNormals();
  const tex = cachedTex('acc.tailFur', () => paintTexture(64, 256, (c, w, h) => {
    const grd = c.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#B07A3A');
    grd.addColorStop(0.75, '#9A6630');
    grd.addColorStop(1, '#2a1a0e');
    c.fillStyle = grd;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(40,20,5,0.3)';
    const r = rng(8);
    for (let i = 0; i < 120; i++) {
      const x = r() * w, y = r() * h;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + range(r, -2, 2), y + 6);
      c.stroke();
    }
  }));
  g.add(mesh(geo, kitMat('weasel.tail', { color: 0xffffff, map: tex, roughness: 1, tempC: TEMP_C.huang }), 'tailTube'));
  return g;
}

/** 老周的雪花脸：动态噪点贴图 + 面向相机，每次绘制前放到头心与相机之间（任何角度、任何倍率都挡住脸）。 */
function faceSnow(s: number, headCenter: THREE.Object3D): THREE.Mesh {
  const tex = cachedTex('acc.snow', () => {
    const { canvas, g } = createCanvas(128, 128);
    const img = g.createImageData(128, 128);
    const r = rng(316);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.round(r() * 255);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = canvasToTexture(canvas, { wrap: true });
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  });
  const alpha = cachedTex('acc.snowAlpha', () => paintTexture(64, 64, (c, w, h) => {
    const grd = c.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w / 2);
    grd.addColorStop(0, '#fff');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grd;
    c.fillRect(0, 0, w, h);
  }, { mask: true }));
  // 雪花是自发光的电视噪点，不受光照；比回放人影（renderOrder 20）晚画
  const mat = new THREE.MeshBasicMaterial({ map: tex, alphaMap: alpha, transparent: true, depthWrite: false, color: '#C8C8B0', fog: false });
  mat.userData.rigOwned = true;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.29 * s, 0.34 * s), mat);
  m.name = 'faceSnow';
  m.renderOrder = 21;
  m.userData.keepMaterial = true;
  m.userData.noBounds = true;
  m.userData.irHide = true;
  m.frustumCulled = false;
  const hc = new THREE.Vector3(), cp = new THREE.Vector3(), dir = new THREE.Vector3(), pq = new THREE.Quaternion();
  m.onBeforeRender = (_r, _scene, camera) => {
    headCenter.getWorldPosition(hc);
    camera.getWorldPosition(cp);
    dir.copy(cp).sub(hc);
    const d = dir.length();
    if (d < 1e-4) return;
    dir.multiplyScalar(Math.min(0.14 * s, d * 0.5) / d);
    const parent = m.parent;
    const world = hc.add(dir);
    if (parent) {
      parent.updateWorldMatrix(true, false);
      m.position.copy(parent.worldToLocal(world));
      parent.getWorldQuaternion(pq);
      m.quaternion.copy(pq.invert().multiply(camera.quaternion));
    } else {
      m.position.copy(world);
      m.quaternion.copy(camera.quaternion);
    }
    m.updateMatrixWorld();
    // 纯视觉的每帧抖动（ARCH §1.5 允许 Math.random）
    tex.offset.set(Math.random(), Math.random());
  };
  return m;
}

function glasses(s: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'glasses';
  const frame = kitMat('glasses.frame', { color: '#2a1d14', roughness: 0.4, metalness: 0.3 });
  const lensMat = kitMat('glasses.lens', { color: '#9fb4c0', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35 });
  for (const sx of [-1, 1]) {
    const rim = mesh(new THREE.TorusGeometry(0.02 * s, 0.003 * s, 4, 14), frame, 'rim');
    rim.position.set(sx * 0.03 * s, 0, 0);
    const lens = mesh(new THREE.CircleGeometry(0.02 * s, 12), lensMat, 'lens');
    lens.rotation.y = Math.PI;
    lens.position.set(sx * 0.03 * s, 0, 0.001);
    const arm = mesh(new THREE.BoxGeometry(0.003 * s, 0.003 * s, 0.1 * s).translate(0, 0, 0.05 * s), frame, 'arm');
    arm.position.set(sx * 0.05 * s, 0, 0);
    g.add(rim, lens, arm);
  }
  const bridge = mesh(new THREE.BoxGeometry(0.02 * s, 0.003 * s, 0.003 * s), frame, 'bridge');
  g.add(bridge);
  // M4 第 2 轮：往前挪到脸面上（原来一半埋在头球里）
  g.position.set(0, 0.145 * s, -0.106 * s);
  g.rotation.x = 0.08;
  return g;
}

function beard(s: number): THREE.Object3D {
  const r = rng(1200);
  const pos: number[] = [];
  for (let i = 0; i < 60; i++) {
    const a = range(r, -1, 1);
    const x0 = a * 0.045 * s, z0 = -0.085 * s - (1 - Math.abs(a)) * 0.012 * s, y0 = range(r, 0.07, 0.1) * s;
    const len = range(r, 0.12, 0.2) * s * (1 - Math.abs(a) * 0.4);
    const x1 = x0 * 0.6 + range(r, -0.01, 0.01) * s, z1 = z0 - range(r, 0.0, 0.02) * s, y1 = y0 - len;
    pos.push(x0, y0, z0, x1, y1, z1);
  }
  // 两撇八字胡
  for (let i = 0; i < 16; i++) {
    const sx = i % 2 ? 1 : -1;
    const y = range(r, 0.105, 0.112) * s;
    pos.push(sx * 0.005 * s, y, -0.1 * s, sx * range(r, 0.04, 0.06) * s, y - range(r, 0.02, 0.04) * s, -0.09 * s);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#F4F1EA', transparent: true, opacity: 0.9 }));
  l.name = 'beard';
  return l;
}

function armband(s: number): THREE.Mesh {
  const mat = kitMat('armband', { color: 0xffffff, map: armbandTexture(), roughness: 0.85, tempC: TEMP_C.alive });
  const m = mesh(new THREE.CylinderGeometry(0.066 * s, 0.066 * s, 0.075 * s, 20, 1, true), mat, 'armband');
  m.position.y = -0.1 * s;
  return m;
}

function shirtCollar(s: number, color: THREE.ColorRepresentation, o?: { open?: boolean }): THREE.Group {
  const g = new THREE.Group();
  g.name = 'shirtCollar';
  const c = new THREE.Color(color);
  const mat = kitMat(`collar.${c.getHexString()}`, { color: c.clone().multiplyScalar(1.12), roughness: 0.85, side: THREE.DoubleSide, tempC: TEMP_C.alive });
  const dark = kitMat('collar.inner', { color: '#07080c', roughness: 1, tempC: TEMP_C.alive });
  // 躯干顶封口在 0.452s（领口圈半宽 0.072s、半深 0.064s，见 humanoid.ts torsoGeo）
  const top = 0.452 * s;
  if (o?.open !== false) {
    // 领口里的黑洞：主角的支架就从这里伸出来
    const hole = mesh(new THREE.CircleGeometry(0.058 * s, 18).rotateX(-Math.PI / 2).scale(1, 1, 0.9).translate(0, top + 0.002 * s, 0), dark, 'collarHole');
    g.add(hole);
  }
  // 领座：围着领口的一圈，前面敞开
  const band = mesh(new THREE.CylinderGeometry(0.074 * s, 0.078 * s, 0.034 * s, 20, 1, true, Math.PI + 0.45, Math.PI * 2 - 0.9), mat, 'collarBand');
  band.scale.set(1, 1, 0.9);
  band.position.y = top + 0.012 * s;
  g.add(band);
  // 两片翻领：从领座前沿往下、往外，平贴在胸口的斜面上
  const pts: number[] = [];
  for (const sx of [-1, 1]) {
    // 顶点贴着胸口的斜面（躯干前面在 y 0.36/0.405/0.435/0.452 处的 z ≈ -0.127/-0.112/-0.094/-0.064）
    const it = [sx * 0.02, 0.455, -0.07], ot = [sx * 0.075, 0.44, -0.09], tip = [sx * 0.055, 0.385, -0.122], ib = [sx * 0.012, 0.405, -0.117];
    const tri = (a: number[], b: number[], cc: number[]) => {
      for (const v of sx > 0 ? [a, b, cc] : [a, cc, b]) pts.push((v[0] ?? 0) * s, (v[1] ?? 0) * s, (v[2] ?? 0) * s - 0.004 * s);
    };
    tri(it, ot, tip);
    tri(it, tip, ib);
  }
  const flapGeo = new THREE.BufferGeometry();
  flapGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  flapGeo.computeVertexNormals();
  g.add(mesh(flapGeo, mat, 'collarFlaps'));
  // 肩章：顺着肩线往下斜
  for (const sx of [-1, 1]) {
    const ep = mesh(new THREE.BoxGeometry(0.1 * s, 0.007 * s, 0.045 * s), mat, 'epaulette');
    ep.position.set(sx * 0.125 * s, 0.428 * s, 0.004 * s);
    ep.rotation.z = -sx * 0.32;
    g.add(ep);
    const btn = mesh(new THREE.CylinderGeometry(0.008 * s, 0.008 * s, 0.006 * s, 8), kitMat('collar.button', { color: '#C9C2B0', roughness: 0.4, tempC: TEMP_C.alive }), 'epButton');
    btn.position.set(sx * 0.085 * s, 0.442 * s, 0.004 * s);
    btn.rotation.z = -sx * 0.32;
    g.add(btn);
  }
  // 领子各片按材质合并（主角全程在画面里，省几次 draw call）
  const merged = mergeByMaterial(g);
  merged.name = 'shirtCollar';
  return merged;
}

function hardHat(s: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'hardHat';
  const mat = kitMat('hardhat', { color: '#E8B21E', roughness: 0.45 });
  const dome = mesh(new THREE.SphereGeometry(0.115 * s, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat, 'dome');
  dome.scale.set(1, 0.85, 1.1);
  const brim = mesh(new THREE.CylinderGeometry(0.14 * s, 0.14 * s, 0.01 * s, 16), mat, 'brim');
  brim.scale.set(1, 1, 1.2);
  brim.position.z = -0.01 * s;
  g.add(dome, brim);
  g.position.y = 0.2 * s;
  return g;
}

function scarf(s: number): THREE.Mesh {
  const m = mesh(new THREE.ConeGeometry(0.06 * s, 0.1 * s, 3).rotateX(Math.PI).translate(0, -0.05 * s, -0.09 * s), kitMat('scarf.red', { color: '#C8171E', roughness: 0.9 }), 'scarf');
  m.position.y = 0.43 * s;
  return m;
}

/**
 * M4 第 2 轮：中山装的立体细节（陆师傅、黄三爷）——立领（领座 + 外翻的领面，前面留一道小口）、前襟一列 5 粒扣、四个口袋盖。
 * 位置取自 zhongshanTexture 上画的扣子与口袋（躯干贴图 u/v → torsoSurface），口袋盖贴着衣服表面、朝外法线。
 * 返回两块网格（衣料、扣子），挂在 spine 上；调用方 adopt 进材质模式。魂影/回放里实度 0.3（ghostSolid）：是衣服，不是辨识道具。
 * 原来中山装只剩贴图上几条淡线，没有立领和口袋的轮廓。
 */
export function zhongshanDetails(h: HumanoidInternal, color: string): THREE.Group {
  const s = h.s;
  const g = new THREE.Group();
  g.name = 'zhongshan';
  const cloth = kitMat(`zhongshan.${color}`, { color: shade(color, 0.92), roughness: 0.88, side: THREE.DoubleSide, tempC: TEMP_C.alive });
  const btnMat = kitMat(`zhongshan.btn.${color}`, { color: shade(color, 0.5), roughness: 0.45, tempC: TEMP_C.alive });
  const parts: THREE.BufferGeometry[] = [];
  const top = 0.452 * s;
  // 立领：领座（直筒）+ 领面（往外翻、略外撇），前面正中留一道口（圆柱 θ = π 是正前方 -z）
  const gap = 0.32;
  const stand = new THREE.CylinderGeometry(0.078 * s, 0.08 * s, 0.042 * s, 22, 1, true, Math.PI + gap / 2, Math.PI * 2 - gap);
  stand.scale(1, 1, 0.9);
  stand.translate(0, top + 0.016 * s, 0);
  const fold = new THREE.CylinderGeometry(0.084 * s, 0.102 * s, 0.034 * s, 22, 1, true, Math.PI + gap, Math.PI * 2 - gap * 2);
  fold.scale(1, 1, 0.92);
  fold.translate(0, top + 0.002 * s, 0);
  parts.push(stand.toNonIndexed(), fold.toNonIndexed());
  stand.dispose();
  fold.dispose();
  const m = new THREE.Matrix4();
  const place = (geo: THREE.BufferGeometry, u: number, y: number, out: number): THREE.BufferGeometry => {
    const f = torsoSurface(h, u, y);
    m.makeBasis(f.t, f.up, f.n);
    m.setPosition(f.p.addScaledVector(f.n, out));
    geo.applyMatrix4(m);
    return geo;
  };
  // 口袋盖：上兜（胸前，贴图 u 0.12 / 0.38，上沿 y ≈ 0.374s）与下兜（衣襟下摆，u 0.11 / 0.39，上沿 y ≈ 0.172s）；盖子下沿略翘
  for (const [u, y, w] of [[0.12, 0.36, 0.08], [0.38, 0.36, 0.08], [0.11, 0.158, 0.1], [0.39, 0.158, 0.1]] as const) {
    const flap = new THREE.BoxGeometry(w * s, 0.03 * s, 0.006 * s);
    parts.push(place(flap, u, y * s, 0.004 * s).toNonIndexed());
    flap.dispose();
  }
  const clothGeo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  const btnParts: THREE.BufferGeometry[] = [];
  for (const y of [0.396, 0.342, 0.256, 0.154, 0.058]) {
    const b = new THREE.CylinderGeometry(0.0085 * s, 0.0085 * s, 0.006 * s, 8);
    b.rotateX(Math.PI / 2);
    btnParts.push(place(b, 0.25, y * s, 0.003 * s).toNonIndexed());
    b.dispose();
  }
  const btnGeo = mergeGeometries(btnParts, false);
  for (const p of btnParts) p.dispose();
  for (const [geo, mat, name] of [[clothGeo, cloth, 'zhongshanCloth'], [btnGeo, btnMat, 'zhongshanButtons']] as const) {
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.userData.ghostSolid = 0.3;
    g.add(mesh);
  }
  return g;
}

export const ACCESSORIES: AccessoryKit = {
  cap, bun, basket, caneLantern, mug, tlr, tail, faceSnow, glasses, beard, armband, shirtCollar, hardHat, scarf,
};

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
