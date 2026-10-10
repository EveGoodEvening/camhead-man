// owner: WP2
// 角色配件（ARCH §2.7；char2 WP-C 重做，test-artifacts/work/char2/PLAN.md §3.6）：帽子、发簪、竹篮、拐杖灯笼、搪瓷缸、双反相机、尾巴、
// 脸部雪花遮罩、眼镜、胡子、袖箍、红领巾、安全帽……以及衣服贴图的转出（OUTFIT，贴图本身在 outfit/textures.ts）。
// WP2 内部模块（characters.ts / player.ts 使用）；其他 WP 通过 CharacterRig.props 访问配件。
//
// char2：配件不再是拼起来的基本体，而是放样/旋转出来的整件（每件 1–2 个网格）；戴在头上的（帽子、眼镜、胡子）按人偶真正的头网格
// 量出外表面（cast/geo.ts HeadFit）再贴上去，旧版蛋头和新雕的头都合身；位置的高度取 h.land 地标（PLAN §2.5）。
// 尺寸参数 s = 人偶身高 / 1.75；k = 头部地标的缩放（s × headScale）。头上的配件建在 headSlot 局部坐标里（组本身在原点）。

import * as THREE from 'three';
import { TEMP_C } from '../data/render';
import { canvasToTexture, createCanvas, paintTexture, shade } from '../kit/canvas';
import { kitMat, mergeByMaterial, newMat } from '../kit/geom';
import { rng, range } from '../kit/rng';
import { FONT_STACK } from '../kit/text';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LEGACY_LAYOUT } from './human/assemble';
import { landmarksOf } from './human/profile';
import { loftRings, planeRing } from './human/shared';
import { fabricTexture } from './human/surface';
import type { HeadLandmarks } from './human/types';
import { torsoSurface, type HumanoidInternal } from './humanoid';
import { HeadFit, lathe, mergeParts, remapUv, thickSheet, tube } from './cast/geo';
import { armbandTexture } from './outfit/textures';

// 衣服贴图搬到 outfit/textures.ts（char2 WP0），这里原名转出
export { armbandTexture, clothShoeTexture, floralTexture, paperGrain, robeTexture, uniformShirtTexture, zhongshanTexture } from './outfit/textures';

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

const EX = new THREE.Vector3(1, 0, 0), EZ = new THREE.Vector3(0, 0, 1);
/** 两个方位角的差（−π..π 取绝对值）。 */
const angDist = (a: number, b: number) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  return m;
}

// ---------------------------------------------------------------- 头部地标与头形

/**
 * 头部地标：正常就是 h.land.head。三个区域构建器都还是旧版（LEGACY_LAYOUT）时头没有按 headScale 放大（土地、小孩的头是成年人大小），
 * 这时按 headScale = 1 重算，配件仍然对得上旧头（集成后 LEGACY_LAYOUT 为 false，这一支不再走）。
 */
export function headLand(h: HumanoidInternal): HeadLandmarks {
  if (!LEGACY_LAYOUT || h.profile.headScale === 1) return h.land.head;
  const L = landmarksOf({ ...h.profile, headScale: 1 }, h.s).head;
  return { ...L, hairTop: (h.land.head.hairTop / h.land.head.scale) * L.scale };
}

/** 人偶头网格的外形采样（headSlot 局部）。 */
export function headFit(h: HumanoidInternal): HeadFit {
  const L = headLand(h);
  const k = L.scale;
  const head = (h.parts.head as THREE.Object3D | undefined) ?? h.headMesh;
  return new HeadFit(head, { centre: L.headOrigin, ax: [0.083 * k, 0.122 * k, 0.105 * k] });
}

// ---------------------------------------------------------------- 帽子

export interface CapOpts {
  /** 帽檐压低遮脸（黄三爷） */
  low?: boolean;
  /** 戴得靠后、往上掀（黄鼬头） */
  back?: boolean;
  color?: string;
}

/** 按头形量出一圈帽箍：返回每个方位的半径（离头中轴）与高度，帽身各圈按它缩放。 */
function capBand(fit: HeadFit, y0: number, tilt: number, count: number, pad: number): { r: number[]; y: number[] } {
  const ring = fit.ring(y0, count, pad, { tiltZ: tilt, smooth: 2 });
  const r: number[] = [], y: number[] = [];
  for (let i = 0; i < count; i++) {
    r.push(Math.hypot(ring[i * 3]! - fit.cx, ring[i * 3 + 2]! - fit.cz));
    y.push(ring[i * 3 + 1]!);
  }
  return { r, y };
}
function ringAt(fit: HeadFit, band: { r: number[]; y: number[] }, scale: (i: number, ang: number) => number, dy: (i: number, ang: number) => number, dz = 0): Float32Array {
  const n = band.r.length;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const r = band.r[i]! * scale(i, ang);
    out[i * 3] = fit.cx + Math.cos(ang) * r;
    out[i * 3 + 1] = band.y[i]! + dy(i, ang);
    out[i * 3 + 2] = fit.cz + dz - Math.sin(ang) * r;
  }
  return out;
}

/**
 * 蓝布单帽（老周、收破烂的）：软帽身（帽箍贴着头发、上口略撑开、顶面微鼓、帽箍上沿一道缉线棱）+ 前面一片往下弯的硬帽檐 + 帽顶小布扣。
 * 破毡帽（黄三爷）：高帽身、顶上一道凹折、捏过的前脸、深色帽带、四周耷拉的宽帽檐（前后往下、两侧略翘、边不齐）。
 */
function cap(style: 'cloth' | 'felt', h: HumanoidInternal, o?: CapOpts): THREE.Group {
  return style === 'cloth' ? clothCap(h, o) : feltHat(h, o);
}

function clothCap(h: HumanoidInternal, o?: CapOpts): THREE.Group {
  const g = new THREE.Group();
  g.name = 'clothCap';
  const L = headLand(h);
  const k = L.scale;
  const fit = headFit(h);
  const N = 32;
  // 帽箍下沿：前面在眉上约 3cm，后面略高（帽子微微往前扣）
  const y0 = L.browY + 0.033 * k;
  const tilt = -0.003 * k;
  const band = capBand(fit, y0 + 0.002 * k, tilt, N, 0.003 * k);
  // 帽箍那一段贴着头往上收（每一圈按自己的高度量头形）
  // 每一圈：按自己的高度量头形 + pad，但不小于帽箍座圈的 minSc 倍（帽箍是硬挺的一圈，不跟着头顶往里缩成腰）
  const ringFit = (dy: number, pad: number, minSc: number, dz = 0, frontLift = 0): Float32Array => {
    const b = capBand(fit, y0 + 0.002 * k + dy, tilt, N, pad);
    const r = b.r.map((rr, i) => Math.max(rr, band.r[i]! * minSc));
    return ringAt(fit, { r, y: band.y }, (_i, a) => 1 + 0.02 * front(a) * Math.min(1, dy / H), (_i, a) => dy + frontLift * front(a), dz);
  };
  const bandRow = (dy: number, pad: number): Float32Array => ringFit(dy, pad, 0.92);
  const crownTop = Math.max(L.hairTop + 0.01 * k, y0 + 0.058 * k);
  const H = crownTop - y0;
  const front = (ang: number) => Math.max(0, Math.sin(ang)); // 1 = 正前
  const rings: Float32Array[] = [];
  // 软布帽身：帽箍以上往外鼓、往前探（帽顶压在帽檐上方一点），顶面圆角收口、微微鼓起
  const add = (sc: number, dy: number, dz = 0, frontLift = 0) => rings.push(ringAt(fit, band, (_i, a) => sc * (1 + 0.025 * front(a) * Math.min(1, dy / H) ), (_i, a) => dy + frontLift * front(a), dz));
  rings.push(bandRow(0.004 * k, 0.0005 * k)); // 往里折的下口（看得出布有厚度）
  rings.push(bandRow(0, 0.003 * k));
  rings.push(bandRow(0.01 * k, 0.0035 * k));
  rings.push(bandRow(0.02 * k, 0.004 * k));
  rings.push(bandRow(0.0235 * k, 0.0058 * k)); // 缉线棱
  rings.push(bandRow(0.028 * k, 0.0045 * k));
  // 帽身：比帽箍略鼓一点（软布），往前探一点；顶面圆角收口
  rings.push(ringFit(H * 0.56, 0.008 * k, 1.0, -0.004 * k, 0.002 * k));
  rings.push(ringFit(H * 0.76, 0.01 * k, 0.99, -0.007 * k, 0.003 * k));
  add(0.97, H * 0.86, -0.008 * k, 0.003 * k);
  add(0.91, H * 0.93, -0.008 * k, 0.002 * k);
  add(0.8, H * 0.975, -0.008 * k, 0.001 * k);
  add(0.62, H * 1.0, -0.007 * k);
  add(0.38, H * 1.014, -0.006 * k);
  add(0.12, H * 1.02, -0.005 * k);
  const last = rings[rings.length - 1]!;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < N; i++) { cx += last[i * 3]!; cy += last[i * 3 + 1]!; cz += last[i * 3 + 2]!; }
  const crown = loftRings(rings, { capEnd: [cx / N, cy / N + 0.0015 * k, cz / N] });
  // 帽檐：前面 ±62° 一片，长 5.6cm，往下 22°，两头收成圆角
  const cols = 21, rowsN = 7, span = 1.08;
  const grid: THREE.Vector3[][] = [];
  for (let j = 0; j < rowsN; j++) {
    const t = j / (rowsN - 1);
    const row: THREE.Vector3[] = [];
    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1);
      const ang = Math.PI / 2 - span + u * span * 2;
      const e = 1 - Math.pow(Math.abs(u * 2 - 1), 2.2);
      const len = 0.058 * k * Math.pow(Math.max(e, 0), 0.5);
      const bi = Math.round((ang / (Math.PI * 2)) * N) % N;
      const r0 = band.r[(bi + N) % N]! * 1.005;
      const by = band.y[(bi + N) % N]! + 0.0015 * k;
      const d = t * len;
      // 帽檐往下压（越往外越斜），两侧再往下弯一点
      const drop = d * 0.42 + d * d * 3.2 / k + (1 - e) * 0.006 * k * t;
      const rr = r0 + d;
      row.push(V(fit.cx + Math.cos(ang) * rr, by - drop, fit.cz - Math.sin(ang) * rr));
    }
    grid.push(row);
  }
  // 行：从帽箍往外（dv 朝外）；列：方位增大（du 朝 −x）：dv × du 朝上
  const brim = thickSheet(grid, 0.0042 * k);
  // 帽顶的小布扣
  const btn = lathe([[0.0001, 0], [0.0065 * k, 0.0005 * k], [0.0055 * k, 0.0035 * k], [0.0001, 0.0045 * k]], 12);
  btn.translate(cx / N, cy / N + 0.001 * k, cz / N);
  const geo = mergeParts([crown, brim, btn]);
  const color = o?.color ?? '#34465F';
  const mat = kitMat(`cap.cloth.${color}`, { color, map: fabricTexture('pants'), roughness: 0.95 });
  g.add(mesh(geo, mat, 'capCloth'));
  return g;
}

function feltHat(h: HumanoidInternal, o?: CapOpts): THREE.Group {
  const g = new THREE.Group();
  g.name = 'feltHat';
  const L = headLand(h);
  const k = L.scale;
  const fit = headFit(h);
  const N = 36;
  const r = rng(33);
  const jit = Array.from({ length: N }, () => range(r, -1, 1));
  const jitAt = (i: number) => (jit[i % N]! * 0.6 + jit[(i + 1) % N]! * 0.2 + jit[(i + N - 1) % N]! * 0.2);
  // low：帽箍前沿压到眉眼之间（脸埋在帽檐下，下巴和嘴还看得见）；back：掀到后脑勺
  const y0 = o?.low ? L.browY + 0.024 * k : o?.back ? L.browY + 0.052 * k : L.browY + 0.035 * k;
  const tilt = o?.low ? 0.02 * k : o?.back ? -0.022 * k : 0.004 * k; // 正 = 前低后高
  const band = capBand(fit, y0, tilt, N, 0.004 * k);
  const H = 0.092 * k;
  const crownRings: Float32Array[] = [];
  // 前脸两侧捏出的两道凹（方位 90° ± 32°）
  const pinch = (a: number) => Math.exp(-(angDist(a, Math.PI / 2 + 0.55) ** 2) / 0.05) + Math.exp(-(angDist(a, Math.PI / 2 - 0.55) ** 2) / 0.05);
  const add = (list: Float32Array[], sc: number, dy: number, dent = 0) => list.push(ringAt(fit, band, (i, a) => sc * (1 + 0.012 * jitAt(i) - 0.05 * pinch(a) * (dy / H)), (i, a) => {
    // 帽顶的凹折：沿前后中线往下压（中间深、两侧浅）
    const x = Math.cos(a);
    return dy - dent * Math.exp(-(x * x) / 0.08) + 0.002 * k * jitAt(i + 7);
  }));
  // 帽箍那一段按各自高度的头形贴着
  const bandAt = (dy: number, pad: number) => {
    const b = capBand(fit, y0 + dy, tilt, N, pad);
    crownRings.push(ringAt(fit, b, i => 1 + 0.008 * jitAt(i), () => 0));
  };
  bandAt(-0.003 * k, 0.001 * k);
  bandAt(0, 0.004 * k);
  bandAt(0.016 * k, 0.0045 * k);
  add(crownRings, 1.004, 0.03 * k);
  add(crownRings, 0.985, H * 0.62);
  // 集成：凹折浅一点、只在顶面（真头上原来的深凹折压进了头顶的头发里 2cm）
  add(crownRings, 0.94, H * 0.86, 0.002 * k);
  add(crownRings, 0.82, H * 0.98, 0.006 * k);
  add(crownRings, 0.55, H * 1.0, 0.012 * k);
  add(crownRings, 0.22, H * 0.99, 0.015 * k);
  const last = crownRings[crownRings.length - 1]!;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < N; i++) { cx += last[i * 3]!; cy += last[i * 3 + 1]!; cz += last[i * 3 + 2]!; }
  const crown = loftRings(crownRings, { capEnd: [cx / N, cy / N - 0.004 * k, cz / N] });
  // 帽檐：一圈，宽 6cm（黄鼬那顶 5cm），前后耷拉、两侧略翘，边沿不齐
  const rowsN = 6;
  const W = (o?.back ? 0.05 : 0.062) * k;
  const grid: THREE.Vector3[][] = [];
  for (let j = 0; j < rowsN; j++) {
    const t = j / (rowsN - 1);
    const row: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const fb = Math.abs(Math.sin(ang)); // 前后 = 1，两侧 = 0
      const fr = Math.max(0, Math.sin(ang));
      const w = W * (1 + 0.06 * jitAt(i + 3));
      const d = t * w;
      const rr = band.r[i]! * 1.012 + d;
      const droop = d * (0.18 + 0.55 * fb * fb + (o?.low ? 0.25 * fr : 0)) - d * 0.22 * (1 - fb) + t * t * 0.004 * k * jitAt(i + 11);
      row.push(V(fit.cx + Math.cos(ang) * rr, band.y[i]! + 0.001 * k - droop, fit.cz - Math.sin(ang) * rr));
    }
    grid.push(row);
  }
  const brim = thickSheet(grid, 0.0035 * k, { wrapU: true });
  const color = o?.color ?? '#3A2F25';
  const felt = kitMat(`cap.felt.${color}`, { color, map: fabricTexture('pants'), roughness: 1 });
  g.add(mesh(mergeParts([crown, brim]), felt, 'feltCrown'));
  // 帽带：深色宽带子，比帽身凸 1.5mm
  const bandRings = [0.004, 0.008, 0.02, 0.024].map((dy, j) => ringAt(fit, capBand(fit, y0 + dy * k, tilt, N, (j === 0 || j === 3 ? 0.0045 : 0.0058) * k), i => 1 + 0.008 * jitAt(i), () => 0));
  g.add(mesh(loftRings(bandRings), kitMat('cap.feltBand', { color: '#1d1712', roughness: 0.8 }), 'feltBand'));
  return g;
}

// ---------------------------------------------------------------- 发簪（发髻本身是头发几何，WP-H）

/** 发簪：一根细长的深色簪子斜插过发髻（bunCentre），一头一颗珠子（王奶奶：玉色）或一朵小红绒花（新娘）。 */
function hairpin(h: HumanoidInternal, o?: { flower?: boolean }): THREE.Group {
  const g = new THREE.Group();
  g.name = 'bun';
  const L = headLand(h);
  const k = L.scale;
  const [bx, by, bz] = L.bunCentre;
  const R = L.bunR;
  const a = V(bx - R * 1.45, by + R * 0.32, bz + R * 0.05), b = V(bx + R * 1.5, by - R * 0.18, bz + R * 0.12);
  const rod = tube([a, a.clone().lerp(b, 0.5).add(V(0, 0.002 * k, 0.003 * k)), b], t => 0.0022 * k * (1 - 0.55 * t), { seg: 10, radial: 6, caps: true });
  g.add(mesh(rod, kitMat('hairpin.rod', { color: '#3a2a1e', roughness: 0.4, metalness: 0.2 }), 'hairpin'));
  if (o?.flower) {
    // 小红绒花：五瓣，贴在发髻左上
    const parts: THREE.BufferGeometry[] = [];
    for (let p = 0; p < 5; p++) {
      const petal = lathe([[0.0001, 0], [0.006 * k, 0.001 * k], [0.007 * k, 0.003 * k], [0.0001, 0.0045 * k]], 8, { sx: 1, sz: 0.55 });
      petal.translate(0, 0, 0.0065 * k);
      petal.rotateY((p / 5) * Math.PI * 2);
      parts.push(petal);
    }
    const flower = mergeParts(parts);
    flower.rotateZ(Math.PI / 2 + 0.4);
    flower.translate(a.x + 0.006 * k, a.y + 0.004 * k, a.z - 0.004 * k);
    g.add(mesh(flower, kitMat('hairpin.flower', { color: '#B8222A', roughness: 0.85 }), 'pinFlower'));
  } else {
    const bead = lathe([[0.0001, -0.0048 * k], [0.0034 * k, -0.0034 * k], [0.0048 * k, 0], [0.0034 * k, 0.0034 * k], [0.0001, 0.0048 * k]], 10);
    bead.translate(a.x - 0.002 * k, a.y + 0.0005 * k, a.z);
    g.add(mesh(bead, kitMat('hairpin.jade', { color: '#5E9C7E', roughness: 0.25, metalness: 0.05 }), 'pinBead'));
  }
  return g;
}

// ---------------------------------------------------------------- 竹篮

/** 竹篮（王奶奶）：编织纹的篮身（上口外撇、卷边）、竹提梁（带竹节）、盖着的一块蓝布（垂过篮沿、有褶）。一个网格、一张贴图。 */
function basket(s: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'basket';
  // 贴图分区：u 0–0.68 编织、0.70–0.84 蓝布、0.86–1 竹提梁
  const tex = cachedTex('acc.wicker', () => paintTexture(256, 64, (c, w, h) => {
    const ww = Math.round(w * 0.68);
    c.fillStyle = '#7E5E32';
    c.fillRect(0, 0, ww, h);
    // 斜纹编织：一格 6px，经纬交错
    for (let y = 0; y < h; y += 6) {
      for (let x = 0; x < ww; x += 6) {
        const over = ((x / 6) + (y / 6)) % 2 === 0;
        c.fillStyle = over ? '#B8925A' : '#9C7842';
        c.fillRect(x + (over ? 0 : 1), y + (over ? 1 : 0), over ? 6 : 4, over ? 4 : 6);
        c.fillStyle = 'rgba(40,24,8,0.35)';
        c.fillRect(x, y, over ? 1 : 6, over ? 6 : 1);
      }
    }
    c.fillStyle = 'rgba(255,240,200,0.12)';
    for (let y = 0; y < h; y += 12) c.fillRect(0, y + 2, ww, 1);
    // 蓝布
    const x1 = Math.round(w * 0.7), x2 = Math.round(w * 0.84);
    c.fillStyle = '#3E5A7C';
    c.fillRect(x1, 0, x2 - x1, h);
    c.fillStyle = 'rgba(255,255,255,0.08)';
    for (let x = x1; x < x2; x += 2) c.fillRect(x, 0, 1, h);
    c.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = 0; y < h; y += 2) c.fillRect(x1, y, x2 - x1, 1);
    // 竹子
    const x3 = Math.round(w * 0.86);
    const grd = c.createLinearGradient(x3, 0, w, 0);
    grd.addColorStop(0, '#7A5A30');
    grd.addColorStop(0.5, '#A8844C');
    grd.addColorStop(1, '#6E4E28');
    c.fillStyle = grd;
    c.fillRect(x3, 0, w - x3, h);
    c.fillStyle = 'rgba(40,24,8,0.5)';
    for (let y = 6; y < h; y += 16) c.fillRect(x3, y, w - x3, 2);
  }));
  const S = s;
  const body = lathe([
    [0.0001, -0.07], [0.1, -0.07], [0.108, -0.066], [0.113, -0.055], [0.15, 0.06], [0.156, 0.066], [0.159, 0.073], [0.154, 0.079], [0.147, 0.075], [0.143, 0.064],
  ].map(([r0, y0]) => [r0! * S, y0! * S] as const), 28);
  remapUv(body, 0, 0, 0.68, 1);
  // 盖布：中间鼓、边沿垂过篮沿，一圈松褶
  const N = 32;
  const clothRows: Float32Array[] = [];
  const prof = [[0.01, 0.094], [0.06, 0.092], [0.11, 0.086], [0.148, 0.08], [0.163, 0.07], [0.167, 0.056], [0.165, 0.046]] as const;
  for (const [rr, yy] of prof) {
    const ring = new Float32Array(N * 3);
    const t = rr / 0.167;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const fold = 1 + 0.035 * t * t * Math.sin(ang * 7 + 0.6) + 0.02 * t * Math.sin(ang * 3 + 1.1);
      const sag = -0.008 * t * t * (0.5 + 0.5 * Math.sin(ang * 5 + 0.3));
      ring[i * 3] = Math.cos(ang) * rr * fold * S;
      ring[i * 3 + 1] = (yy + sag) * S;
      ring[i * 3 + 2] = -Math.sin(ang) * rr * fold * S;
    }
    clothRows.push(ring);
  }
  const cloth = loftRings(clothRows, { capStart: [0, 0.095 * S, 0] });
  remapUv(cloth, 0.7, 0, 0.84, 1);
  // 竹提梁：从两侧篮沿弯过顶，两三个竹节
  const hp: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    hp.push(V(Math.cos(a) * 0.148 * S, (0.07 + Math.sin(a) * 0.15) * S, 0));
  }
  const handle = tube(hp, t => 0.0075 * S * (1 + 0.18 * Math.exp(-(((t - 0.3) / 0.02) ** 2)) + 0.18 * Math.exp(-(((t - 0.7) / 0.02) ** 2))), { seg: 36, radial: 8, caps: true });
  remapUv(handle, 0.86, 0, 1, 1);
  const geo = mergeParts([body, cloth, handle]);
  g.add(mesh(geo, kitMat('basket', { color: 0xffffff, map: tex, roughness: 0.95 }), 'basketBody'));
  return g;
}

// ---------------------------------------------------------------- 拐杖与灯笼

/** 枣木拐杖（疙疙瘩瘩的节、略弯、顶上回钩）+ 小红灯笼（八道竹骨的灯身、金色上下盖、提绳、红穗子）。灯笼身保持自己的自发光材质。 */
function caneLantern(s: number): { group: THREE.Group; lantern: THREE.Object3D; light: THREE.Object3D } {
  const g = new THREE.Group();
  g.name = 'caneLantern';
  const wood = kitMat('cane.jujube', { color: '#6B3A22', roughness: 0.62 });
  const K = s * 1.2;
  const pts = [V(0, 0, 0), V(0.006, 0.2, 0.002), V(0.01, 0.4, 0), V(-0.004, 0.6, -0.003), V(-0.012, 0.8, 0), V(-0.004, 1.0, 0.002), V(0, 1.15, 0), V(0.05, 1.24, 0), V(0.1, 1.2, 0)]
    .map(v => v.multiplyScalar(K));
  const knots = [0.14, 0.31, 0.47, 0.6, 0.74, 0.86];
  const R = 0.014 * K;
  const caneGeo = tube(pts, t => {
    let k = 1 + 0.06 * Math.sin(t * 61) + 0.04 * Math.sin(t * 23 + 1);
    for (const kn of knots) k += 0.32 * Math.exp(-(((t - kn) / 0.012) ** 2));
    // 杖头略粗，回钩的尖收细
    k *= t < 0.85 ? 1 + 0.12 * t : 1.1 - (t - 0.85) * 2.2;
    return R * k;
  }, { seg: 52, radial: 7, caps: true });
  g.add(mesh(caneGeo, wood, 'cane'));
  // 小红灯笼挂在回钩下
  const lantern = new THREE.Group();
  lantern.name = 'lantern';
  const hookEnd = pts[pts.length - 1]!;
  lantern.position.set(hookEnd.x, hookEnd.y - 0.02 * s, 0);
  const lampTex = cachedTex('acc.redLantern', () => paintTexture(128, 64, (c, w, h) => {
    const grd = c.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#FFB070');
    grd.addColorStop(0.5, '#FF5A3A');
    grd.addColorStop(1, '#C8321E');
    c.fillStyle = grd;
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(90,10,5,0.5)';
    for (let x = 0; x < w; x += 16) c.fillRect(x, 0, 2, h);
    // 最底下一条深红（穗子用）
    c.fillStyle = '#8E1610';
    c.fillRect(0, h - 4, w, 4);
  }));
  // 灯身：八道竹骨压出的瓣（贴图上的竖线正好在骨上）
  const N = 32, rowsN = 13, LH = 0.07 * K, LR = 0.066 * K;
  const rows: Float32Array[] = [];
  for (let j = 0; j < rowsN; j++) {
    const yy = -LH + (2 * LH * j) / (rowsN - 1);
    const rr = LR * Math.pow(Math.max(0.02, 1 - (yy / (LH * 1.06)) ** 2), 0.5);
    const ring = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2 - Math.PI / 2;
      const rib = 0.955 + 0.045 * Math.pow(Math.abs(Math.sin(4 * (ang + Math.PI / 2))), 0.55);
      ring[i * 3] = Math.cos(ang) * rr * rib;
      ring[i * 3 + 1] = yy;
      ring[i * 3 + 2] = -Math.sin(ang) * rr * rib;
    }
    rows.push(ring);
  }
  const bodyGeo = loftRings(rows);
  // 贴图 v：上亮下暗（0.06–1），留出最底下一条给穗子
  remapUv(bodyGeo, 0, 0.08, 1, 1);
  // 穗子：一束往下散开的红丝线（旋转体，带细竖棱）
  const tassel = lathe([[0.0001, -0.08], [0.003, -0.079], [0.0075, -0.068], [0.006, -0.035], [0.003, -0.014], [0.005, -0.006], [0.0001, 0]].map(([r0, y0]) => [r0! * K, y0! * K] as const), 10);
  tassel.translate(0, -LH - 0.012 * K, 0);
  remapUv(tassel, 0, 0, 1, 0.05);
  const body = mesh(mergeParts([bodyGeo, tassel]), newMat({ color: '#FF6A4A', map: lampTex, emissive: '#FF5A3A', emissiveIntensity: 1.6, emissiveMap: lampTex, roughness: 0.8, tempC: TEMP_C.lamp }), 'lanternBody');
  body.position.y = -0.14 * s;
  body.userData.keepMaterial = true;
  // 金色上下盖 + 提绳（同一个网格）
  const capProf = (top: boolean) => {
    const p: [number, number][] = top
      ? [[0.032, -0.004], [0.036, -0.002], [0.036, 0.004], [0.03, 0.008], [0.018, 0.011], [0.0001, 0.012]]
      : [[0.0001, -0.012], [0.02, -0.011], [0.032, -0.006], [0.036, -0.002], [0.035, 0.004], [0.03, 0.005]];
    return lathe(p.map(([r0, y0]) => [r0 * K, y0 * K] as const), 16);
  };
  const capT = capProf(true);
  capT.translate(0, -0.14 * s + LH - 0.002 * K, 0);
  const capB = capProf(false);
  capB.translate(0, -0.14 * s - LH + 0.002 * K, 0);
  const string = tube([V(0, 0, 0), V(0.002 * s, -0.03 * s, 0), V(0, -0.14 * s + LH + 0.01 * K, 0)], 0.0018 * s, { seg: 6, radial: 5 });
  const capMat = kitMat('lantern.cap', { color: '#C9A13A', metalness: 0.5, roughness: 0.4 });
  const caps = mesh(mergeParts([capT, capB, string]), capMat, 'lanternCaps');
  lantern.add(caps, body);
  const light = new THREE.Object3D();
  light.name = 'lanternLightAnchor';
  light.position.y = -0.14 * s;
  lantern.add(light);
  g.add(lantern);
  return { group: g, lantern, light };
}

// ---------------------------------------------------------------- 搪瓷缸

/** 搪瓷缸（老周）：白搪瓷、卷边的蓝口沿、内壁、半缸茶、C 形把手；磕掉瓷的黑斑。一个网格、一张贴图（256×128，与原来同尺寸）。 */
function mug(s: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'mug';
  // 贴图（v 自下而上）：0–0.06 茶色、0.06–0.12 白底（缸底、内壁）、0.12–0.88 缸身（正前方 u 0.5 印红字）、0.9–1 蓝口沿
  const tex = cachedTex('acc.enamelMug', () => paintTexture(256, 128, (c, w, h) => {
    c.fillStyle = '#EDEBE3';
    c.fillRect(0, 0, w, h);
    const sh = c.createLinearGradient(0, 0, w, 0);
    sh.addColorStop(0, 'rgba(0,0,0,0.04)');
    sh.addColorStop(0.5, 'rgba(255,255,255,0.05)');
    sh.addColorStop(1, 'rgba(0,0,0,0.04)');
    c.fillStyle = sh;
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#2B4C8C';
    c.fillRect(0, 0, w, h * 0.1);
    c.fillStyle = '#3a2a12';
    c.fillRect(0, h * 0.94, w, h * 0.06);
    c.fillStyle = '#C0231E';
    c.font = `bold ${Math.round(h * 0.2)}px ${FONT_STACK}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('先进工作者', w * 0.5, h * 0.48);
    c.fillRect(w * 0.36, h * 0.64, w * 0.28, h * 0.02);
    // 磕掉瓷的地方：口沿与缸底多
    const r = rng(1984);
    for (let i = 0; i < 12; i++) {
      c.fillStyle = '#1c1c1c';
      c.beginPath();
      const y = r() < 0.6 ? range(r, 0.1, 0.22) * h : range(r, 0.78, 0.9) * h;
      c.ellipse(r() * w, y, range(r, 1.5, 5), range(r, 1.5, 4), r(), 0, Math.PI * 2);
      c.fill();
    }
  }));
  const prof: [number, number, number][] = [
    // r, y, v
    [0.0001, -0.045, 0.09], [0.039, -0.045, 0.09], [0.0418, -0.043, 0.12], [0.0428, 0.04, 0.88],
    [0.0445, 0.0418, 0.93], [0.0458, 0.0446, 0.95], [0.0447, 0.0472, 0.97], [0.0423, 0.0468, 0.99],
    [0.0409, 0.044, 0.1], [0.0405, 0.018, 0.1], [0.033, 0.017, 0.03], [0.0001, 0.017, 0.03],
  ];
  const body = lathe(prof.map(([r0, y0]) => [r0 * s, y0 * s] as const), 28);
  const uv = body.attributes.uv as THREE.BufferAttribute;
  const P = prof.length;
  for (let i = 0; i < uv.count; i++) uv.setY(i, prof[i % P]![2]);
  // 把手：贴着缸身右侧（+x）的 C 形扁条
  const hp = [V(0.042, 0.03, 0), V(0.058, 0.033, 0), V(0.069, 0.018, 0), V(0.07, -0.006, 0), V(0.06, -0.024, 0), V(0.042, -0.026, 0)].map(v => v.multiplyScalar(s));
  const handle = tube(hp, [0.0058 * s, 0.0032 * s], { seg: 16, radial: 8, up: () => V(0, 0, 1) });
  remapUv(handle, 0.02, 0.3, 0.1, 0.32);
  const geo = mergeParts([body, handle]);
  g.add(mesh(geo, kitMat('mug.enamel', { color: 0xffffff, map: tex, roughness: 0.28, metalness: 0.05 }), 'mugBody'));
  return g;
}

// ---------------------------------------------------------------- 双反相机

/**
 * 双反相机（陆师傅）：圆角皮面机身、折叠取景罩、取景镜与拍摄镜（镀铬镜筒、黑玻璃）、铭牌、侧面对焦钮、背带耳；
 * 背带是一条扁皮带：从相机两耳顺着胸口往上，搭过两肩靠近脖子的地方，从后颈绕过去（不从下巴里穿出来）。
 * 两个网格（皮/玻璃、镀铬）。组挂在 spine 上、位置 = 相机中心。
 */
function tlr(h: HumanoidInternal): THREE.Group {
  const s = h.s;
  const g = new THREE.Group();
  g.name = 'tlr';
  const leather = kitMat('tlr.leather', { color: '#161616', roughness: 0.72 });
  const chrome = kitMat('tlr.chrome', { color: '#B8BCC2', roughness: 0.3, metalness: 0.85 });
  const W = 0.072 * s, Hh = 0.104 * s, D = 0.068 * s;
  // 相机中心：胸前，背面离衣服 6mm
  const cy = 0.2 * s;
  const chest = torsoSurface(h, 0.25, cy);
  const cz = Math.min(chest.p.z, torsoSurface(h, 0.25, cy + Hh / 2).p.z, torsoSurface(h, 0.25, cy - Hh / 2).p.z) - D / 2 - 0.006 * s;
  g.position.set(0, cy, cz);
  const lp: THREE.BufferGeometry[] = [], cp: THREE.BufferGeometry[] = [];
  const box = (w: number, hh: number, d: number, r: number, x: number, y: number, z: number) => {
    const b = new RoundedBoxGeometry(w, hh, d, 1, r);
    b.translate(x, y, z);
    return b;
  };
  lp.push(box(W, Hh, D, 0.006 * s, 0, 0, 0));
  // 取景罩（合着的方罩，略小一圈）
  lp.push(box(W * 0.94, 0.024 * s, D * 0.94, 0.003 * s, 0, Hh / 2 + 0.011 * s, 0.001 * s));
  cp.push(box(W * 0.96, 0.002 * s, D * 0.96, 0.0008 * s, 0, Hh / 2 + 0.0005 * s, 0));
  // 镜头板（前面凸出的一块）
  lp.push(box(W * 0.84, Hh * 0.86, 0.008 * s, 0.003 * s, 0, -0.002 * s, -D / 2 - 0.003 * s));
  const lens = (y: number, r: number, len: number) => {
    const z0 = -D / 2 - 0.007 * s;
    const barrel = lathe([[r * 0.98, 0], [r, 0.002 * s], [r, len - 0.004 * s], [r * 1.06, len - 0.003 * s], [r * 1.06, len], [r * 0.82, len + 0.0005 * s], [r * 0.78, len - 0.002 * s]], 18);
    barrel.rotateX(-Math.PI / 2);
    barrel.translate(0, y, z0);
    cp.push(barrel);
    const glass = lathe([[r * 0.8, -0.001 * s], [r * 0.55, 0.0015 * s], [0.0001, 0.0025 * s]], 16);
    glass.rotateX(-Math.PI / 2);
    glass.translate(0, y, z0 - len + 0.0025 * s);
    lp.push(glass);
  };
  lens(0.023 * s, 0.0165 * s, 0.02 * s);
  lens(-0.025 * s, 0.0185 * s, 0.027 * s);
  // 铭牌、对焦钮、卷片摇把、背带耳
  cp.push(box(0.034 * s, 0.0075 * s, 0.002 * s, 0.0008 * s, 0, -0.0005 * s, -D / 2 - 0.0075 * s));
  const knob = lathe([[0.0001, 0], [0.012 * s, 0], [0.0125 * s, 0.002 * s], [0.0125 * s, 0.009 * s], [0.011 * s, 0.011 * s], [0.0001, 0.011 * s]], 14);
  knob.rotateZ(Math.PI / 2);
  knob.translate(-W / 2, -0.004 * s, 0.004 * s);
  cp.push(knob);
  const crank = lathe([[0.0001, 0], [0.008 * s, 0], [0.008 * s, 0.006 * s], [0.0001, 0.007 * s]], 12);
  crank.rotateZ(-Math.PI / 2);
  crank.translate(W / 2, 0.004 * s, 0.006 * s);
  cp.push(crank);
  const lugY = Hh / 2 - 0.012 * s;
  for (const sx of [-1, 1]) {
    const lug = new THREE.TorusGeometry(0.0045 * s, 0.0011 * s, 5, 10);
    lug.rotateZ(Math.PI / 2);
    lug.translate(sx * (W / 2 + 0.0035 * s), lugY, 0);
    cp.push(lug);
  }
  // 背带（spine 局部 → 相机局部）：耳 → 胸口两侧 → 肩上靠脖子 → 后颈
  const neckY = h.joints.neck.position.y;
  const chestPt = (x: number, y: number, off: number): THREE.Vector3 => {
    let lo = 0.25, hi = x < 0 ? 0.5 : 0;
    let f = torsoSurface(h, 0.25, y);
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      f = torsoSurface(h, mid, y);
      if (Math.abs(f.p.x) < Math.abs(x)) lo = mid;
      else hi = mid;
    }
    return f.p.addScaledVector(f.n, off);
  };
  const half: THREE.Vector3[] = [];
  const toCam = (p: THREE.Vector3) => p.sub(g.position);
  for (const sx of [-1, 1]) {
    const lugP = V(sx * (W / 2 + 0.0035 * s), lugY, 0).add(g.position);
    const side: THREE.Vector3[] = [
      lugP,
      lugP.clone().add(V(sx * 0.006 * s, 0.03 * s, 0.004 * s)),
      chestPt(sx * 0.05 * s, cy + 0.11 * s, 0.006 * s),
      chestPt(sx * 0.063 * s, cy + 0.17 * s, 0.006 * s),
      V(sx * 0.074 * s, neckY - 0.016 * s, -0.012 * s),
      V(sx * 0.07 * s, neckY - 0.008 * s, 0.03 * s),
      V(sx * 0.042 * s, neckY - 0.004 * s, 0.07 * s),
    ];
    if (sx < 0) half.push(...side);
    else half.push(...side.reverse());
  }
  // 中间：后颈正中
  const path = [...half.slice(0, 7), V(0, neckY - 0.002 * s, 0.079 * s), ...half.slice(7)].map(p => toCam(p.clone()));
  const strap = tube(path, [0.0062 * s, 0.0011 * s], {
    seg: 44, radial: 4,
    up: (_t, p) => {
      const q = p.clone().add(g.position);
      return V(q.x, 0, q.z - 0.012 * s).normalize();
    },
  });
  lp.push(strap);
  g.add(mesh(mergeNonIndexed(lp), leather, 'tlrBody'), mesh(mergeNonIndexed(cp), chrome, 'tlrChrome'));
  return g;
}

/** 有索引/无索引混在一起的几何合并（RoundedBoxGeometry 没有索引）。 */
function mergeNonIndexed(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeParts(geos);
}

// ---------------------------------------------------------------- 黄鼬尾巴

/** 黄鼬尾巴：根细、中段蓬松、尾尖收成一撮；表面一绺一绺的毛（截面带起伏），尾尖深色（贴图）。 */
function tail(s: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tail';
  const pts = [V(0, 0, 0), V(0, -0.1, 0.08), V(0, -0.24, 0.15), V(0.025, -0.38, 0.15), V(0.05, -0.48, 0.09), V(0.058, -0.53, 0.04)].map(v => v.multiplyScalar(s));
  const geo = tube(pts, t => {
    const k = t < 0.12 ? 0.6 + (t / 0.12) * 0.4 : t < 0.55 ? 1 + 0.18 * Math.sin(((t - 0.12) / 0.43) * Math.PI / 2) : 1.18 * Math.pow(Math.max(0, 1 - (t - 0.55) / 0.45), 0.7);
    return Math.max(0.002 * s, 0.036 * s * k);
  }, { seg: 32, radial: 12, caps: true, shape: (a, t) => 1 + 0.09 * Math.min(1, t * 3) * Math.sin(a * 9 + t * 26) });
  const tex = cachedTex('acc.tailFur', () => paintTexture(64, 256, (c, w, h) => {
    const grd = c.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#2a1a0e');
    grd.addColorStop(0.22, '#8A5A2A');
    grd.addColorStop(0.5, '#B07A3A');
    grd.addColorStop(1, '#A06A32');
    c.fillStyle = grd;
    c.fillRect(0, 0, w, h);
    const r = rng(8);
    for (let i = 0; i < 260; i++) {
      const x = r() * w, y = r() * h;
      c.strokeStyle = r() < 0.6 ? 'rgba(40,20,5,0.3)' : 'rgba(240,200,140,0.22)';
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + range(r, -2, 2), y - 5, x + range(r, -3, 3), y - 10);
      c.stroke();
    }
  }));
  g.add(mesh(geo, kitMat('weasel.tail', { color: 0xffffff, map: tex, roughness: 1, tempC: TEMP_C.huang }), 'tailTube'));
  return g;
}

// ---------------------------------------------------------------- 雪花脸（不变）

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

// ---------------------------------------------------------------- 眼镜

/** 圆框老花镜（陆师傅）：两只细金属圆框（略往下倾）、拱起搭在鼻梁上的鼻桥、两根镜腿贴着头侧伸到耳根再往下弯。一个网格。 */
function glasses(h: HumanoidInternal): THREE.Group {
  const g = new THREE.Group();
  g.name = 'glasses';
  const L = headLand(h);
  const k = L.scale;
  const fit = headFit(h);
  const ey = L.eyeR[1];
  const ex = Math.abs(L.eyeR[0]);
  const lensR = 0.0182 * k;
  const wire = 0.00125 * k;
  // 镜片平面：眉弓、颧骨最靠前的地方再往前 3mm；鼻梁要搭得住
  let zf = Infinity;
  for (const sx of [-1, 1]) {
    for (const [dx, dy] of [[0, 0.02], [0.012, 0.018], [-0.008, 0.016], [0, -0.022], [0.012, -0.02]] as const) zf = Math.min(zf, fit.front(sx * (ex + dx * k), ey + dy * k));
  }
  const zb = fit.front(0, ey + 0.002 * k, 0.004 * k);
  const zL = Math.min(zf - 0.003 * k, zb + 0.0005 * k);
  const parts: THREE.BufferGeometry[] = [];
  const cxs = ex * 1.02;
  for (const sx of [-1, 1]) {
    const rim = new THREE.TorusGeometry(lensR, wire, 4, 30);
    rim.scale(1.04, 0.96, 1);
    rim.rotateX(0.1);
    rim.translate(sx * cxs, ey, zL);
    parts.push(rim);
  }
  // 鼻桥：从两框内沿往上拱，贴着鼻梁
  const inner = cxs - lensR * 1.04;
  parts.push(tube([V(-inner, ey + 0.004 * k, zL), V(-inner * 0.45, ey + 0.009 * k, Math.min(zL, zb) - 0.0015 * k), V(0, ey + 0.0105 * k, Math.min(zL, zb) - 0.002 * k), V(inner * 0.45, ey + 0.009 * k, Math.min(zL, zb) - 0.0015 * k), V(inner, ey + 0.004 * k, zL)], wire, { seg: 10, radial: 4 }));
  // 镜腿：外沿桩头 → 顺着头侧 → 耳根往下弯
  const earZ = L.earR[2];
  for (const sx of [-1, 1]) {
    const hx = sx * (cxs + lensR * 1.04);
    const ty = ey + 0.004 * k;
    const pts: THREE.Vector3[] = [V(hx, ty, zL), V(hx + sx * 0.003 * k, ty, zL + 0.006 * k)];
    const zs = [zL + 0.022 * k, zL + 0.045 * k, earZ - 0.03 * k, earZ - 0.012 * k];
    let lastX = Math.abs(hx) + 0.003 * k;
    for (const z of zs) {
      if (z <= pts[pts.length - 1]!.z + 0.004 * k) continue;
      lastX = Math.max(lastX, Math.abs(fit.side(sx, ty, z, 0.006 * k)) + 0.0018 * k);
      pts.push(V(sx * lastX, ty, z));
    }
    pts.push(V(sx * lastX, ty - 0.002 * k, earZ + 0.004 * k));
    pts.push(V(sx * (lastX - 0.002 * k), ty - 0.014 * k, earZ + 0.016 * k));
    pts.push(V(sx * (lastX - 0.004 * k), ty - 0.03 * k, earZ + 0.02 * k));
    parts.push(tube(pts, t => wire * (t > 0.85 ? 1.1 : 1), { seg: 18, radial: 4, caps: true }));
  }
  g.add(mesh(mergeParts(parts), kitMat('glasses.frame', { color: '#5a4a38', roughness: 0.45, metalness: 0.6 }), 'glassesFrame'));
  return g;
}

// ---------------------------------------------------------------- 胡子（土地）

/**
 * 土地的长白胡子：从两颊的下颌、嘴下面长出来，盖住下巴，往下一绺一绺地垂到胸前（下巴往下 ≥ 0.16m），尾巴尖略往前翘；
 * 两撇八字须从鼻子底下往两边耷拉过嘴角。一个网格，一张发丝贴图（原 128×256）。头面上的部分按真实头网格量。
 */
function beard(h: HumanoidInternal): THREE.Object3D {
  const map = cachedTex('acc.beard', () => paintTexture(128, 256, (g, w, hh) => {
    const base = g.createLinearGradient(0, 0, 0, hh);
    base.addColorStop(0, '#E6E2D8');
    base.addColorStop(0.7, '#D9D4C8');
    base.addColorStop(1, '#BDB6A6');
    g.fillStyle = base;
    g.fillRect(0, 0, w, hh);
    const r = rng(1200);
    for (let i = 0; i < 420; i++) {
      const x = r() * w, y = r() * hh;
      g.lineWidth = range(r, 0.6, 1.4);
      g.strokeStyle = r() < 0.45 ? `rgba(110,100,84,${range(r, 0.12, 0.3)})` : `rgba(255,253,246,${range(r, 0.35, 0.7)})`;
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + range(r, -3, 3), y + 15, x + range(r, -4, 4), y + 30, x + range(r, -3, 3), y + range(r, 40, 70));
      g.stroke();
    }
  }));
  const L = headLand(h);
  const k = L.scale;
  const fit = headFit(h);
  const mouthY = L.mouth[1], chinY = Math.min(L.chin[1], fit.bottom + 0.004 * k), chinZ = Math.min(L.chin[2], fit.front(0, chinY + 0.006 * k));
  const cz = fit.cz;
  // 关键圈：y、半宽 a、前沿 zf、后沿 zb
  const jawW = (y: number) => Math.max(fit.radius(y, 0), fit.radius(y, Math.PI)) || 0.06 * k;
  // 垂下来的长度至少 0.16m（GDD）：下巴以下各圈的高度按 Lb 拉伸
  const Lb = Math.max(1, 0.18 / (0.186 * k));
  const hy = (d: number) => chinY - d * k * Lb;
  const keys: [number, number, number, number][] = [
    [mouthY + 0.002 * k, jawW(mouthY) * 0.98, fit.front(0, mouthY - 0.004 * k) - 0.005 * k, cz + 0.016 * k],
    [mouthY - 0.016 * k, jawW(mouthY - 0.016 * k) * 1.0, fit.front(0, mouthY - 0.016 * k) - 0.013 * k, cz + 0.01 * k],
    [chinY + 0.004 * k, jawW(chinY + 0.01 * k) * 0.96, chinZ - 0.02 * k, cz - 0.004 * k],
    [hy(0.024), 0.07 * k, chinZ - 0.028 * k, chinZ + 0.058 * k],
    [hy(0.06), 0.064 * k, chinZ - 0.034 * k, chinZ + 0.04 * k],
    [hy(0.1), 0.052 * k, chinZ - 0.04 * k, chinZ + 0.018 * k],
    [hy(0.14), 0.036 * k, chinZ - 0.044 * k, chinZ - 0.002 * k],
    [hy(0.17), 0.017 * k, chinZ - 0.047 * k, chinZ - 0.02 * k],
    [hy(0.186), 0.004 * k, chinZ - 0.049 * k, chinZ - 0.034 * k],
  ];
  // 下巴以下垂在胸前：整绺胡子的后沿不进胸口（按绑定姿势的胸口表面 torsoSurface，换到 headSlot 局部），前沿跟着往前让
  const neckY = h.joints.neck.position.y;
  const clear = (row: [number, number, number, number]): [number, number, number, number] => {
    const ys = row[0] + neckY;
    if (row[0] > -0.005 * k || ys < 0.05 * h.s) return row;
    const chest = torsoSurface(h, 0.25, ys).p.z - 0.008 * h.s;
    if (row[3] <= chest) return row;
    const push = row[3] - chest;
    return [row[0], row[1], row[2] - push, row[3] - push];
  };
  // 推开的量往下单调不减，并且从下巴开始渐进（不出一个水平的台阶）
  {
    const push = keys.map(r => r[3] - clear(r)[3]);
    for (let j = 1; j < push.length; j++) push[j] = Math.max(push[j]!, push[j - 1]!);
    const sm = push.map((p, j) => (j === 0 ? p : 0.25 * push[j - 1]! + 0.5 * p + 0.25 * (push[j + 1] ?? p)));
    for (let j = 0; j < keys.length; j++) {
      const r = keys[j]!;
      keys[j] = [r[0], r[1], r[2] - sm[j]!, r[3] - sm[j]!];
    }
  }
  // 关键圈之间插值（Catmull-Rom 过每个关键圈）
  const N = 28, sub = 3;
  const rows: Float32Array[] = [];
  const vs: number[] = [];
  const cr = (a: number, b: number, c: number, d: number, t: number) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  const K = keys.length;
  for (let j = 0; j < K - 1; j++) {
    for (let q = 0; q < sub; q++) {
      const t = q / sub;
      const A = keys[Math.max(0, j - 1)]!, B = keys[j]!, C = keys[j + 1]!, Dk = keys[Math.min(K - 1, j + 2)]!;
      const row = [0, 1, 2, 3].map(c => cr(A[c]!, B[c]!, C[c]!, Dk[c]!, t)) as [number, number, number, number];
      rows.push(beardRing(row, N, (j + t) / (K - 1), k));
      vs.push((j + t) / (K - 1));
    }
  }
  rows.push(beardRing(keys[K - 1]!, N, 1, k));
  vs.push(1);
  const last = keys[K - 1]!;
  const mainGeo = loftRings(rows, { v: vs.map(v => 1 - v), capEnd: [0, last[0] - 0.003 * k, (last[2] + last[3]) / 2] });
  // 八字须：鼻底两边往外、往下耷拉过嘴角，扁的、往尖收
  const parts: THREE.BufferGeometry[] = [mainGeo];
  const nb = L.noseBaseY;
  for (const sx of [-1, 1]) {
    const pts = [
      V(sx * 0.003 * k, nb - 0.004 * k, fit.front(0.003 * k, nb - 0.004 * k) - 0.003 * k),
      V(sx * 0.016 * k, mouthY + 0.01 * k, fit.front(0.016 * k, mouthY + 0.01 * k) - 0.0045 * k),
      V(sx * 0.031 * k, mouthY + 0.001 * k, fit.front(0.031 * k, mouthY) - 0.004 * k),
      V(sx * 0.042 * k, mouthY - 0.016 * k, fit.front(0.04 * k, mouthY - 0.014 * k) - 0.006 * k),
      V(sx * 0.047 * k, mouthY - 0.042 * k, fit.front(0.044 * k, mouthY - 0.03 * k) - 0.012 * k),
    ];
    const m = tube(pts, t => [0.009 * k * (1 - 0.7 * t) + 0.0015 * k, 0.005 * k * (1 - 0.6 * t) + 0.001 * k], { seg: 16, radial: 8, caps: true, up: () => V(0, 0, -1), vRange: [1, 0.55] });
    parts.push(m);
  }
  const geo = mergeParts(parts);
  return mesh(geo, kitMat('beard', { color: 0xffffff, map, roughness: 1, tempC: TEMP_C.alive }), 'beard');
}

/** 胡子的一圈：前面宽、后面窄的蛋形截面，前沿一绺一绺地起伏（越往下越明显）。 */
function beardRing(row: readonly [number, number, number, number], N: number, t: number, k: number): Float32Array {
  const [y, a, zf, zb] = row;
  const zc = (zf + zb) / 2, b = Math.max(0.002 * k, (zb - zf) / 2);
  const out = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2;
    const c = Math.cos(ang), sn = Math.sin(ang);
    const front = Math.max(0, sn); // 前半边
    const lock = 1 + 0.07 * Math.min(1, t * 2.2) * front * Math.sin(ang * 9 + t * 7);
    const x = c * a * lock * (1 - 0.18 * Math.max(0, -sn));
    const z = zc - sn * b * (sn > 0 ? lock : 1);
    out[i * 3] = x;
    out[i * 3 + 1] = y - 0.004 * k * front * Math.sin(ang * 5 + 1) * Math.min(1, t * 3);
    out[i * 3 + 2] = z;
  }
  return out;
}

// ---------------------------------------------------------------- 袖箍

/** 红袖箍“值勤”：套在上臂袖子外的一圈布（上下沿往里卷），半径 = 地标 armbandR，挂在 shoulderL 上。 */
function armband(h: HumanoidInternal): THREE.Mesh {
  const s = h.s;
  const R = h.land.torso.armbandR;
  const top = -0.058 * s, bot = -0.122 * s;
  const rowsDef: [number, number][] = [
    [bot - 0.0015 * s, R - 0.0022 * s], [bot, R - 0.0004 * s], [bot + 0.004 * s, R + 0.0006 * s], [(bot + top) / 2, R + 0.0008 * s],
    [top - 0.004 * s, R + 0.0006 * s], [top, R - 0.0004 * s], [top + 0.0015 * s, R - 0.0022 * s],
  ];
  const N = 32;
  // 圈的起点放在后方（+z），u 与 CylinderGeometry 一致：袖箍贴图的字（u 0.75）正好在手臂外侧（−x）
  const rings = rowsDef.map(([y, r]) => planeRing([0, y, 0], EX, EZ, r, r, N, { phase: -Math.PI / 2 }));
  const vs = rowsDef.map(([y]) => 0.06 + 0.88 * ((y - bot) / (top - bot)));
  const geo = loftRings(rings, { v: vs });
  const mat = kitMat('armband', { color: 0xffffff, map: armbandTexture(), roughness: 0.85, tempC: TEMP_C.alive });
  return mesh(geo, mat, 'armband');
}

// ---------------------------------------------------------------- 衬衫领（旧版上身的备用）

/**
 * 衬衫领子与肩章（主角、老周）：挂在 spine 上。char2：上身构建器（WP-U）自己做领子（一个名为 'collar' 的网格）时不用它；
 * 只有上身还是旧版（没有 parts.collar）时 characters/player 才用这件备用领子。
 */
function shirtCollar(s: number, color: THREE.ColorRepresentation, o?: { open?: boolean }): THREE.Group {
  const g = new THREE.Group();
  g.name = 'shirtCollar';
  const c = new THREE.Color(color);
  const mat = kitMat(`collar.${c.getHexString()}`, { color: c.clone().multiplyScalar(1.12), roughness: 0.85, side: THREE.DoubleSide, tempC: TEMP_C.alive });
  const dark = kitMat('collar.inner', { color: '#07080c', roughness: 1, tempC: TEMP_C.alive });
  const top = 0.452 * s;
  if (o?.open !== false) {
    const hole = mesh(new THREE.CircleGeometry(0.058 * s, 18).rotateX(-Math.PI / 2).scale(1, 1, 0.9).translate(0, top + 0.002 * s, 0), dark, 'collarHole');
    g.add(hole);
  }
  const band = mesh(new THREE.CylinderGeometry(0.074 * s, 0.078 * s, 0.034 * s, 20, 1, true, Math.PI + 0.45, Math.PI * 2 - 0.9), mat, 'collarBand');
  band.scale.set(1, 1, 0.9);
  band.position.y = top + 0.012 * s;
  g.add(band);
  const pts: number[] = [];
  for (const sx of [-1, 1]) {
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
  const merged = mergeByMaterial(g);
  merged.name = 'shirtCollar';
  return merged;
}

// ---------------------------------------------------------------- 安全帽

/** 安全帽（拆迁工人）：深橙色硬壳——圆顶、正中一道加强棱（两侧各一道浅棱）、前面伸出的帽舌、一圈窄帽沿；壳与头之间留出帽衬的空隙。一个网格。 */
function hardHat(h: HumanoidInternal): THREE.Group {
  const g = new THREE.Group();
  g.name = 'hardHat';
  const L = headLand(h);
  const k = L.scale;
  const fit = headFit(h);
  const N = 36;
  const y0 = L.browY + 0.024 * k;
  const band = capBand(fit, y0, 0.004 * k, N, 0.011 * k);
  const H = Math.max(L.hairTop + 0.04 * k - y0, 0.1 * k);
  const rows: Float32Array[] = [];
  const NR = 10;
  for (let j = 0; j <= NR; j++) {
    const phi = (j / NR) * (Math.PI / 2) * 0.985;
    const sc = Math.pow(Math.cos(phi), 0.7) * (1 + 0.035 * Math.sin(phi * 2));
    const dy = H * Math.sin(phi);
    const ring = ringAt(fit, band, () => Math.max(0.04, sc), () => dy, -0.004 * k * Math.sin(phi));
    // 加强棱：沿前后中线一道（凸 5mm），两侧各一道浅棱；按方位角定宽（越往顶越窄），帽顶收平，不鼓成一个尖
    const on = THREE.MathUtils.smoothstep(phi, 0.12, 0.45) * (1 - THREE.MathUtils.smoothstep(phi, 1.15, 1.5));
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const c = Math.cos(ang);
      const ridge = (0.005 * Math.exp(-((c / 0.09) ** 2)) + 0.002 * Math.exp(-(((Math.abs(c) - 0.4) / 0.07) ** 2))) * k * on;
      // 沿壳面外法线（径向·cosφ + 向上·sinφ）鼓出
      ring[i * 3] = ring[i * 3]! + Math.cos(ang) * ridge * Math.cos(phi);
      ring[i * 3 + 1] = ring[i * 3 + 1]! + ridge * Math.sin(phi);
      ring[i * 3 + 2] = ring[i * 3 + 2]! - Math.sin(ang) * ridge * Math.cos(phi);
    }
    rows.push(ring);
  }
  const top = rows[rows.length - 1]!;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < N; i++) { cx += top[i * 3]!; cy += top[i * 3 + 1]!; cz += top[i * 3 + 2]!; }
  // 下口往里卷一道（壳有厚度）
  const lip = ringAt(fit, band, () => 0.965, () => 0.006 * k);
  const shell = loftRings([lip, ...rows], { capEnd: [cx / N, cy / N + 0.004 * k, cz / N] });
  // 帽沿：前面帽舌长 4.6cm、两侧 1.2cm、后面 2cm；前面略往下
  const rowsN = 5;
  const grid: THREE.Vector3[][] = [];
  for (let j = 0; j < rowsN; j++) {
    const t = j / (rowsN - 1);
    const row: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const fr = Math.max(0, Math.sin(ang)), bk = Math.max(0, -Math.sin(ang));
      const w = (0.006 + 0.04 * Math.pow(fr, 2.2) + 0.01 * Math.pow(bk, 2.5)) * k;
      const d = t * w;
      const rr = band.r[i]! * 1.004 + d;
      const droop = d * (0.2 + 0.2 * fr) + t * 0.002 * k * (1 - fr);
      row.push(V(fit.cx + Math.cos(ang) * rr, band.y[i]! - droop, fit.cz - Math.sin(ang) * rr));
    }
    grid.push(row);
  }
  const brim = thickSheet(grid, 0.0038 * k, { wrapU: true });
  g.add(mesh(mergeParts([shell, brim]), kitMat('hardhat.shell', { color: '#C8601C', roughness: 0.42 }), 'hardHatShell'));
  return g;
}

// ---------------------------------------------------------------- 红领巾

/** 红领巾（九十年代的小学生）：一条绕着领口的红布带（前面略低）、胸前一个结、两只三角的巾角垂下来贴着胸口（一长一短）。挂在 spine 上。 */
function scarf(h: HumanoidInternal): THREE.Mesh {
  const s = h.s;
  const child = h.profile.age === 'child';
  const hk = child && !LEGACY_LAYOUT ? 1.1 : 1;
  const neckY = h.joints.neck.position.y;
  const a = 0.072 * s * hk, b = 0.066 * s * hk;
  const cz = 0.004 * s;
  const N = 32;
  // 布带：三行（上 → 下），每圈前低后高
  const bandRows: THREE.Vector3[][] = [];
  for (const [dy, sc] of [[0.012, 0.97], [0.0, 1.0], [-0.012, 1.02]] as const) {
    const row: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const zz = -Math.sin(ang);
      const y = neckY - 0.006 * s + dy * s + 0.012 * s * zz;
      row.push(V(Math.cos(ang) * a * sc, y, cz + zz * b * sc));
    }
    bandRows.push(row);
  }
  const bandGeo = thickSheet(bandRows, 0.003 * s, { wrapU: true });
  // 结
  const front = cz - b;
  const ky = neckY - 0.03 * s;
  const knot = lathe([[0.0001, -0.009], [0.009, -0.007], [0.011, 0], [0.009, 0.007], [0.0001, 0.009]].map(([r0, y0]) => [r0! * s * hk, y0! * s * hk] as const), 10, { sx: 1, sz: 0.7 });
  knot.rotateX(Math.PI / 2);
  knot.translate(0, ky, front - 0.008 * s);
  // 两只巾角：沿胸口往下、往外，宽 → 尖
  const chestAt = (x: number, y: number) => {
    let lo = 0.25, hi = x < 0 ? 0.5 : 0;
    let f = torsoSurface(h, 0.25, y);
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      f = torsoSurface(h, mid, y);
      if (Math.abs(f.p.x) < Math.abs(x)) lo = mid;
      else hi = mid;
    }
    return f;
  };
  const ends: THREE.BufferGeometry[] = [];
  for (const [sx, len] of [[-1, 0.115], [1, 0.095]] as const) {
    const grid: THREE.Vector3[][] = [];
    const rowsN = 7, cols = 4;
    for (let j = 0; j < rowsN; j++) {
      const t = j / (rowsN - 1);
      const y = ky - 0.006 * s - t * len * s * hk;
      const xc = sx * (0.008 + 0.045 * t) * s * hk;
      const w = 0.036 * s * hk * Math.pow(1 - t, 0.8) + 0.002 * s;
      const row: THREE.Vector3[] = [];
      for (let i = 0; i < cols; i++) {
        const u = i / (cols - 1);
        const x = xc + (0.5 - u) * w * (sx < 0 ? 1 : 1);
        const f = chestAt(Math.abs(x) < 0.002 ? 0.002 : x, y);
        const zSurf = Math.min(f.p.z, front + 0.004 * s);
        row.push(V(x, y, Math.min(zSurf - 0.006 * s, front - 0.004 * s + t * 0.02 * s) ));
      }
      grid.push(row);
    }
    ends.push(thickSheet(grid, 0.0025 * s));
  }
  const geo = mergeParts([bandGeo, knot, ...ends]);
  return mesh(geo, kitMat('scarf.red', { color: '#C8171E', roughness: 0.9 }), 'scarf');
}

/**
 * M4 第 2 轮：中山装的立体细节（陆师傅、黄三爷）——立领、5 粒扣、四个口袋盖。char2：上身构建器（WP-U）按 garment 做立领与口袋时
 * （有 parts.collar）不用它；旧版上身才用这套备用细节。
 */
export function zhongshanDetails(h: HumanoidInternal, color: string): THREE.Group {
  const s = h.s;
  const g = new THREE.Group();
  g.name = 'zhongshan';
  const cloth = kitMat(`zhongshan.${color}`, { color: shade(color, 0.92), roughness: 0.88, side: THREE.DoubleSide, tempC: TEMP_C.alive });
  const btnMat = kitMat(`zhongshan.btn.${color}`, { color: shade(color, 0.5), roughness: 0.45, tempC: TEMP_C.alive });
  const parts: THREE.BufferGeometry[] = [];
  const top = 0.452 * s;
  const gap = 0.32;
  const stand = new THREE.CylinderGeometry(0.065 * s, 0.073 * s, 0.026 * s, 32, 1, true, Math.PI + gap / 2, Math.PI * 2 - gap);
  stand.scale(1, 1, 0.9);
  stand.translate(0, top + 0.009 * s, 0);
  const fold = new THREE.CylinderGeometry(0.068 * s, 0.08 * s, 0.022 * s, 32, 1, true, Math.PI + gap, Math.PI * 2 - gap * 2);
  fold.scale(1, 1, 0.92);
  fold.translate(0, top + 0.003 * s, 0);
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
  for (const [u, y, w] of [[0.12, 0.36, 0.08], [0.38, 0.36, 0.08], [0.11, 0.158, 0.1], [0.39, 0.158, 0.1]] as const) {
    const flap = new THREE.BoxGeometry(w * s, 0.025 * s, 0.002 * s);
    parts.push(place(flap, u, y * s, 0.0018 * s).toNonIndexed());
    flap.dispose();
  }
  const clothGeo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  const btnParts: THREE.BufferGeometry[] = [];
  for (const y of [0.396, 0.342, 0.256, 0.154, 0.058]) {
    const b = new THREE.CylinderGeometry(0.006 * s, 0.006 * s, 0.0025 * s, 16);
    b.rotateX(Math.PI / 2);
    btnParts.push(place(b, 0.25, y * s, 0.003 * s).toNonIndexed());
    b.dispose();
  }
  const btnGeo = mergeGeometries(btnParts, false);
  for (const p of btnParts) p.dispose();
  for (const [geo, mat, name] of [[clothGeo, cloth, 'zhongshanCloth'], [btnGeo, btnMat, 'zhongshanButtons']] as const) {
    if (!geo) continue;
    const mm = new THREE.Mesh(geo, mat);
    mm.name = name;
    mm.userData.ghostSolid = 0.3;
    g.add(mm);
  }
  return g;
}

export interface AccessoryKit {
  /** 蓝布单帽（老周、收破烂的）/ 破毡帽（黄三爷）；low = 帽檐压低遮脸，back = 掀到脑后（黄鼬） */
  cap(style: 'cloth' | 'felt', h: HumanoidInternal, o?: CapOpts): THREE.Group;
  /** 发簪（王奶奶的玉珠、新娘的小红花）；发髻本身是头发几何 */
  hairpin(h: HumanoidInternal, o?: { flower?: boolean }): THREE.Group;
  /** 竹篮（盖蓝布） */
  basket(s: number): THREE.Group;
  /** 枣木拐杖 + 小红灯笼（土地） */
  caneLantern(s: number): { group: THREE.Group; lantern: THREE.Object3D; light: THREE.Object3D };
  /** 搪瓷缸（老周） */
  mug(s: number): THREE.Group;
  /** 双反相机（陆师傅），挂在胸前，背带绕脖子；组挂在 spine 上 */
  tlr(h: HumanoidInternal): THREE.Group;
  /** 黄鼠狼尾巴 */
  tail(s: number): THREE.Group;
  /** 脸部动态雪花遮罩（老周回放 faceMask）：永远挡在头与相机之间 */
  faceSnow(s: number, headCenter: THREE.Object3D): THREE.Mesh;
  /** 圆框老花镜 */
  glasses(h: HumanoidInternal): THREE.Group;
  /** 长白胡子（土地） */
  beard(h: HumanoidInternal): THREE.Object3D;
  /** 红袖箍“值勤”（套在左臂袖子上，挂 shoulderL） */
  armband(h: HumanoidInternal): THREE.Mesh;
  /** 旧版上身的备用衬衫领与肩章（主角、老周）：挂在 spine 上 */
  shirtCollar(s: number, color: THREE.ColorRepresentation, o?: { open?: boolean }): THREE.Group;
  /** 安全帽（拆迁工人） */
  hardHat(h: HumanoidInternal): THREE.Group;
  /** 小孩的红领巾（挂 spine） */
  scarf(h: HumanoidInternal): THREE.Mesh;
}

export const ACCESSORIES: AccessoryKit = {
  cap, hairpin, basket, caneLantern, mug, tlr, tail, faceSnow, glasses, beard, armband, shirtCollar, hardHat, scarf,
};
