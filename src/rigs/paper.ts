// owner: WP2
// 纸人与实例化纸人（ARCH §5.4）：rig.paper（Plane+Box，CanvasTexture 画脸与衣服）；实例化摊主与同 seed 纸人外形逐像素一致。
//
// 同源的做法（黄三爷的伪装靠它，ARCH §5.3）：
// - 纸扎摊主只有一张贴图集（衣服各区域 + 8 张脸格子），一份身体几何、一份脸平面几何、一个共享材质；
// - 脸格子的选择只靠 UV 偏移：顶点属性 aFace（脸平面 = 1，其余 = 0）× aCell（格子偏移），在材质的顶点着色器里
//   vMapUv = uv + aCell * aFace。实例化摊主的 aCell 是 InstancedBufferAttribute，单个纸人的 aCell 是普通属性——
//   GPU 上做的是同一个浮点运算，所以同位姿、同光照下逐像素一致；不用 instanceColor（红外替换会被它染色，ARCH §6.8.2）。
// - 单个纸人 = 身体网格 + 脸网格（PaperRig.face，hdText 换它的贴图）；实例化摊主 = 身体与脸合并成一份几何。

import * as THREE from 'three';
import type { V3 } from '../core/types';
import { DEG2RAD } from '../core/math';
import { PALETTE } from '../data/palette';
import { TEMP_C } from '../data/render';
import { blotch, canvasToTexture, createCanvas, shade, waterStain } from '../kit/canvas';
import { rng, range } from '../kit/rng';
import { FONT_STACK } from '../kit/text';
import { paperGrain } from './accessories';

/** breathing：黄三爷面具。基础脸贴图不变（与同 seed 摊主逐像素一致）；另外生成高清脸贴图（嘴部水渍与卷边）与只在高清贴图生效时可见的鼓瘪小平面 */
export interface PaperOpts { kind: 'boy' | 'vendor'; height?: number; seed?: number; lanternText?: string; breathing?: boolean }

export interface PaperRig {
  readonly root: THREE.Group;
  readonly mouth: THREE.Object3D;
  /** 脸平面 */
  readonly face: THREE.Mesh;
  /** 仅 breathing：高清脸贴图（首次调用才生成） */
  readonly faceHi?: () => THREE.Texture;
  setJitter(amount: number): void;
  update(dt: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------- 贴图集布局（像素，1024²；hi 版是同布局的 2048²）

type Rect = readonly [number, number, number, number];
const ATLAS = 1024;
const R = {
  robeFront: [0, 0, 256, 384], robeBack: [256, 0, 256, 384], robeSide: [512, 0, 128, 384],
  jacketFront: [640, 0, 192, 160], jacketBack: [832, 0, 192, 160], jacketSide: [640, 160, 96, 96],
  sleeve: [736, 160, 128, 192], hand: [864, 160, 64, 64], hair: [928, 160, 96, 96], skin: [864, 224, 64, 64],
  hat: [640, 256, 96, 96], plain: [736, 352, 64, 32],
} as const satisfies Record<string, Rect>;
/** 脸格子：画布下半，4 列 × 2 行，每格 256²。 */
const FACE_CELLS = 8;
const cellRect = (i: number): Rect => [(i % 4) * 256, 512 + Math.floor(i / 4) * 256, 256, 256];
/** 格子 i 相对格子 0 的 UV 偏移。 */
const cellOffset = (i: number): [number, number] => [(i % 4) * 0.25, -Math.floor(i / 4) * 0.25];
export const faceCellOf = (seed: number): number => ((seed % FACE_CELLS) + FACE_CELLS) % FACE_CELLS;

// ---------------------------------------------------------------- 画纸扎

const VENDOR = { robe: '#2F4E7A', trim: '#D8B24A', jacket: '#7A1F24', sleeve: '#7A1F24', hat: '#141414' } as const;

/**
 * 格子外铺一圈同色的“出血”（M4）：mipmap/双线性采样时格子边缘不再渗进图集底色（白纸色）——
 * 戴面具的纸人帽檐与头盒交界处原来有一圈断续的白线。先把所有格子的扩边画上，再画格子本身，相邻格子互不覆盖。
 */
function gutters(g: CanvasRenderingContext2D, list: readonly (readonly [Rect, string])[], px = 6): void {
  for (const [r, color] of list) {
    g.fillStyle = color;
    g.fillRect(r[0] - px, r[1] - px, r[2] + 2 * px, r[3] + 2 * px);
  }
}

function fillPaper(g: CanvasRenderingContext2D, r: Rect, color: string, seed: number): void {
  g.fillStyle = color;
  g.fillRect(r[0], r[1], r[2], r[3]);
  g.save();
  g.beginPath();
  g.rect(r[0], r[1], r[2], r[3]);
  g.clip();
  g.translate(r[0], r[1]);
  paperGrain(g, r[2], r[3], seed, 1.2);
  g.restore();
}

/** 纸扎衣服上的描金纹：寿字团花、铜钱、回纹边。 */
function trimPattern(g: CanvasRenderingContext2D, r: Rect, trim: string, dense: number, seed: number): void {
  const rr = rng(seed);
  g.save();
  g.beginPath();
  g.rect(r[0], r[1], r[2], r[3]);
  g.clip();
  g.strokeStyle = trim;
  g.fillStyle = trim;
  g.lineWidth = 3;
  // 下摆回纹宽边
  g.fillRect(r[0], r[1] + r[3] - 26, r[2], 5);
  for (let x = r[0]; x < r[0] + r[2]; x += 18) g.strokeRect(x + 3, r[1] + r[3] - 18, 10, 10);
  // 团花：圈 + 寿字
  for (let i = 0; i < dense; i++) {
    const cx = r[0] + range(rr, 0.15, 0.85) * r[2], cy = r[1] + range(rr, 0.12, 0.7) * r[3];
    g.beginPath();
    g.arc(cx, cy, 14, 0, Math.PI * 2);
    g.stroke();
    g.font = `bold 16px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('寿', cx, cy + 1);
  }
  g.restore();
}

/**
 * 纸扎脸（一格）：粉白底、两团腮红、墨画的眉眼（点了睛）、画上去的小红嘴。
 * variant 决定眉形、胡子、腮红位置；hi = 高清版的额外破绽（嘴部洇湿、下巴处面具边受潮卷起）。
 */
function paintFace(g: CanvasRenderingContext2D, x: number, y: number, size: number, variant: number, hi: boolean): void {
  const r = rng(700 + variant * 13);
  const k = size / 256;
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  // 底色（纸面具的边缘露出一点黑发）
  g.fillStyle = '#141414';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#F2E9DA';
  g.beginPath();
  g.ellipse(128, 138, 106, 118, 0, 0, Math.PI * 2);
  g.fill();
  paperGrain(g, 256, 256, 900 + variant, 0.8);
  // 腮红
  const cheekY = 150 + range(r, -6, 6), cheekDx = 58 + range(r, -6, 6);
  for (const sx of [-1, 1]) {
    const grd = g.createRadialGradient(128 + sx * cheekDx, cheekY, 2, 128 + sx * cheekDx, cheekY, 30);
    grd.addColorStop(0, 'rgba(230,70,90,0.85)');
    grd.addColorStop(1, 'rgba(230,70,90,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(128 + sx * cheekDx, cheekY, 30, 0, Math.PI * 2);
    g.fill();
  }
  // 眉：几种写法
  g.strokeStyle = '#111';
  g.lineCap = 'round';
  const browStyle = variant % 4;
  for (const sx of [-1, 1]) {
    g.lineWidth = browStyle === 2 ? 9 : 6;
    g.beginPath();
    const bx = 128 + sx * 42, by = 92 + (browStyle === 1 ? 4 : 0);
    if (browStyle === 3) {
      g.moveTo(bx - sx * 22, by + 8);
      g.lineTo(bx + sx * 22, by - 8);
    } else {
      g.moveTo(bx - 24, by + 4);
      g.quadraticCurveTo(bx, by - 10 - (browStyle === 1 ? 6 : 0), bx + 24, by + 4);
    }
    g.stroke();
    // 眼：细长的一笔 + 点睛
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(bx - 18, 116);
    g.quadraticCurveTo(bx, 108, bx + 18, 116);
    g.stroke();
    g.fillStyle = '#050505';
    g.beginPath();
    g.arc(bx + range(r, -2, 2), 114, 6.5, 0, Math.PI * 2);
    g.fill();
  }
  // 鼻：一笔
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(128, 124);
  g.lineTo(122, 160);
  g.lineTo(132, 162);
  g.stroke();
  // 嘴：画上去的小红嘴（纸人不喘气）
  g.fillStyle = '#C8102E';
  g.beginPath();
  g.ellipse(128, 192, 16 + (variant % 3) * 2, 7, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#7a0a1a';
  g.fillRect(114, 191, 28, 2);
  // 胡子（部分格子）
  if (variant % 3 === 1) {
    g.strokeStyle = '#111';
    g.lineWidth = 3;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(128 + sx * 6, 176);
      g.quadraticCurveTo(128 + sx * 30, 178, 128 + sx * 40, 196);
      g.stroke();
    }
  }
  if (hi) {
    // 破绽：嘴那块被哈潮了，纸色发深、墨与红晕开
    const wet = g.createRadialGradient(128, 196, 6, 128, 196, 58);
    wet.addColorStop(0, 'rgba(120,95,70,0.55)');
    wet.addColorStop(0.6, 'rgba(140,110,80,0.3)');
    wet.addColorStop(1, 'rgba(140,110,80,0)');
    g.fillStyle = wet;
    g.beginPath();
    g.ellipse(128, 198, 60, 46, 0, 0, Math.PI * 2);
    g.fill();
    blotch(g, r, 124, 194, 20, 'rgba(170,20,40,1)', 0.35, 5);
    waterStain(g, r, 128, 200, 40);
    // 下巴处面具的边受潮卷起：一道亮边 + 下面的阴影
    g.fillStyle = 'rgba(40,25,15,0.55)';
    g.beginPath();
    g.moveTo(84, 236);
    g.quadraticCurveTo(128, 214, 172, 236);
    g.lineTo(172, 244);
    g.quadraticCurveTo(128, 226, 84, 244);
    g.fill();
    g.fillStyle = '#FBF6EA';
    g.beginPath();
    g.moveTo(88, 232);
    g.quadraticCurveTo(128, 210, 168, 232);
    g.quadraticCurveTo(128, 219, 88, 232);
    g.fill();
    // 纸纤维（高清才看得见）
    g.strokeStyle = 'rgba(90,70,50,0.18)';
    g.lineWidth = 1;
    for (let i = 0; i < 120; i++) {
      const fx = r() * 256, fy = r() * 256;
      g.beginPath();
      g.moveTo(fx, fy);
      g.lineTo(fx + range(r, -6, 6), fy + range(r, -6, 6));
      g.stroke();
    }
  }
  g.restore();
}

let vendorLo: THREE.CanvasTexture | null = null;

/** 纸扎摊主贴图集（低清，所有摊主与戴面具的黄三爷共用同一个实例）。 */
export function vendorAtlas(): THREE.CanvasTexture {
  if (vendorLo) return vendorLo;
  vendorLo = paintVendorAtlas(1, -1);
  vendorLo.name = 'paperVendorAtlas';
  return vendorLo;
}

/** scale：1 = 1024²，2 = 2048²（同布局）；hiCell ≥ 0 时只把这一格画成高清破绽版（其余区域照画，保证布局一致）。 */
function paintVendorAtlas(scale: number, hiCell: number): THREE.CanvasTexture {
  const { canvas, g } = createCanvas(ATLAS * scale, ATLAS * scale);
  g.scale(scale, scale);
  g.fillStyle = PALETTE.PAPER;
  g.fillRect(0, 0, ATLAS, ATLAS);
  gutters(g, [
    [R.robeFront, VENDOR.robe], [R.robeBack, VENDOR.robe], [R.robeSide, shade(VENDOR.robe, 0.85)],
    [R.jacketFront, VENDOR.jacket], [R.jacketBack, VENDOR.jacket], [R.jacketSide, shade(VENDOR.jacket, 0.85)],
    [R.sleeve, VENDOR.sleeve], [R.hand, '#F2E9DA'], [R.hair, '#141414'], [R.skin, '#EFE2CF'], [R.hat, VENDOR.hat], [R.plain, '#DCD2BE'],
  ]);
  fillPaper(g, R.robeFront, VENDOR.robe, 1);
  trimPattern(g, R.robeFront, VENDOR.trim, 5, 2);
  fillPaper(g, R.robeBack, VENDOR.robe, 3);
  trimPattern(g, R.robeBack, VENDOR.trim, 4, 4);
  fillPaper(g, R.robeSide, shade(VENDOR.robe, 0.85), 5);
  fillPaper(g, R.jacketFront, VENDOR.jacket, 6);
  // 马褂的对襟与盘扣
  g.fillStyle = VENDOR.trim;
  g.fillRect(R.jacketFront[0] + 92, R.jacketFront[1], 8, R.jacketFront[3]);
  for (let i = 0; i < 4; i++) g.fillRect(R.jacketFront[0] + 82, R.jacketFront[1] + 24 + i * 32, 28, 6);
  fillPaper(g, R.jacketBack, VENDOR.jacket, 7);
  fillPaper(g, R.jacketSide, shade(VENDOR.jacket, 0.85), 8);
  fillPaper(g, R.sleeve, VENDOR.sleeve, 9);
  g.fillStyle = VENDOR.trim;
  g.fillRect(R.sleeve[0], R.sleeve[1] + R.sleeve[3] - 22, R.sleeve[2], 10);
  fillPaper(g, R.hand, '#F2E9DA', 10);
  fillPaper(g, R.hair, '#141414', 11);
  fillPaper(g, R.skin, '#EFE2CF', 12);
  fillPaper(g, R.hat, VENDOR.hat, 13);
  g.fillStyle = '#B01818';
  g.beginPath();
  g.arc(R.hat[0] + 48, R.hat[1] + 48, 12, 0, Math.PI * 2);
  g.fill();
  fillPaper(g, R.plain, '#DCD2BE', 14);
  for (let i = 0; i < FACE_CELLS; i++) {
    const c = cellRect(i);
    paintFace(g, c[0], c[1], c[2], i, i === hiCell);
  }
  const tex = canvasToTexture(canvas, { anisotropy: 4 });
  return tex;
}

// ---------------------------------------------------------------- 纸人材质

const paperShaderPatch = (shader: THREE.WebGLProgramParametersWithUniforms) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 aCell;\nattribute float aFace;')
    .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv = ( mapTransform * vec3( MAP_UV + aCell * aFace, 1 ) ).xy;\n#endif');
};

/** 纸人材质：每次调用新建（同代码同参数，共用一个着色器程序）。 */
export function newPaperMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.93, metalness: 0, side: THREE.FrontSide });
  m.userData.tempC = TEMP_C.paper;
  m.onBeforeCompile = paperShaderPatch;
  m.customProgramCacheKey = () => 'wp2.paperCell';
  m.name = 'paper';
  return m;
}

let vendorMat: THREE.MeshStandardMaterial | null = null;
/** 所有纸扎摊主身体（与实例化摊主）共用的材质。 */
function vendorMaterial(): THREE.MeshStandardMaterial {
  vendorMat ??= newPaperMaterial(vendorAtlas());
  return vendorMat;
}

// ---------------------------------------------------------------- 几何

/** 格子 → UV（M4：四边各往里收 1.5 像素，采样不到格子外面）。 */
const UV_INSET = 1.5;
const uvRect = (r: Rect): [number, number, number, number] => [
  (r[0] + UV_INSET) / ATLAS, 1 - (r[1] + r[3] - UV_INSET) / ATLAS, (r[2] - 2 * UV_INSET) / ATLAS, (r[3] - 2 * UV_INSET) / ATLAS,
];

/** 截头方盒（纸扎的袍、褂、袖子）：前/后/侧/顶底各映到贴图集的格子。原点在底面中心。 */
function paperBox(wB: number, dB: number, wT: number, dT: number, h: number, front: Rect, back: Rect, side: Rect, cap: Rect = R.plain): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, h, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setXYZ(i, p.getX(i) * (top ? wT : wB), p.getY(i) + h / 2, p.getZ(i) * (top ? dT : dB));
    const face = Math.floor(i / 4); // px nx py ny pz nz
    const rr = face === 5 ? front : face === 4 ? back : face <= 1 ? side : cap;
    const [u0, v0, uw, vh] = uvRect(rr);
    uv.setXY(i, u0 + uv.getX(i) * uw, v0 + uv.getY(i) * vh);
  }
  g.computeVertexNormals();
  return g;
}

function place(g: THREE.BufferGeometry, pos: V3, rot?: V3): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(pos[0], pos[1], pos[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler((rot?.[0] ?? 0) * DEG2RAD, (rot?.[1] ?? 0) * DEG2RAD, (rot?.[2] ?? 0) * DEG2RAD)),
    new THREE.Vector3(1, 1, 1),
  );
  return g.applyMatrix4(m);
}

/** 把若干几何合成一份（position/normal/uv + aFace/aCell 常量属性）。 */
function mergeParts(parts: { geo: THREE.BufferGeometry; face: number }[]): THREE.BufferGeometry {
  let n = 0, ni = 0;
  for (const p of parts) {
    const g = p.geo.index ? p.geo : p.geo;
    n += g.attributes.position?.count ?? 0;
    ni += g.index ? g.index.count : g.attributes.position?.count ?? 0;
  }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), face = new Float32Array(n);
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const p of parts) {
    const g = p.geo;
    const P = g.attributes.position as THREE.BufferAttribute, N = g.attributes.normal as THREE.BufferAttribute, U = g.attributes.uv as THREE.BufferAttribute;
    pos.set(P.array as Float32Array, vo * 3);
    nor.set(N.array as Float32Array, vo * 3);
    uv.set(U.array as Float32Array, vo * 2);
    face.fill(p.face, vo, vo + P.count);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < P.count; i++) idx[io++] = i + vo;
    vo += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('aFace', new THREE.BufferAttribute(face, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** 纸扎摊主各部件（单位高度 1.55m 的比例，按 k 缩放）：身体（不含脸）与脸平面。 */
function vendorParts(k: number): { body: THREE.BufferGeometry[]; face: THREE.BufferGeometry; mouth: V3 } {
  const s = k;
  const body: THREE.BufferGeometry[] = [];
  // 长袍（下摆外撇）
  body.push(place(paperBox(0.46 * s, 0.3 * s, 0.36 * s, 0.21 * s, 0.9 * s, R.robeFront, R.robeBack, R.robeSide), [0, 0, 0]));
  // 马褂（上身）
  body.push(place(paperBox(0.38 * s, 0.22 * s, 0.34 * s, 0.19 * s, 0.3 * s, R.jacketFront, R.jacketBack, R.jacketSide), [0, 0.9 * s, 0]));
  // 宽袖：从肩膀斜着垂下，袖口外撇；袖口里一只纸手
  for (const sx of [-1, 1]) {
    body.push(place(paperBox(0.15 * s, 0.14 * s, 0.1 * s, 0.1 * s, 0.46 * s, R.sleeve, R.sleeve, R.sleeve), [sx * 0.24 * s, 0.72 * s, -0.03 * s], [8, 0, sx * 10]));
    body.push(place(paperBox(0.06 * s, 0.04 * s, 0.06 * s, 0.04 * s, 0.09 * s, R.hand, R.hand, R.hand), [sx * 0.27 * s, 0.64 * s, -0.05 * s], [8, 0, sx * 8]));
  }
  // 脖子、头盒（后脑与两侧是黑发）
  body.push(place(paperBox(0.09 * s, 0.08 * s, 0.08 * s, 0.07 * s, 0.07 * s, R.skin, R.skin, R.skin), [0, 1.2 * s, 0]));
  body.push(place(paperBox(0.2 * s, 0.18 * s, 0.21 * s, 0.18 * s, 0.25 * s, R.hair, R.hair, R.hair, R.hair), [0, 1.26 * s, 0.005 * s]));
  // 瓜皮帽：八棱帽 + 帽顶红疙瘩
  const hat = new THREE.CylinderGeometry(0.09 * s, 0.113 * s, 0.07 * s, 8);
  const hu = hat.attributes.uv as THREE.BufferAttribute;
  const [hu0, hv0, huw, hvh] = uvRect(R.hat);
  for (let i = 0; i < hu.count; i++) hu.setXY(i, hu0 + hu.getX(i) * huw, hv0 + hu.getY(i) * hvh);
  body.push(place(hat, [0, 1.545 * s, 0.005 * s]));
  // 脸：头盒前面的一张平面（格子 0 的 UV；别的格子靠 aCell 偏移）
  const face = new THREE.PlaneGeometry(0.205 * s, 0.245 * s);
  face.rotateY(Math.PI); // 法线朝 -z
  const fu = face.attributes.uv as THREE.BufferAttribute;
  const [fu0, fv0, fuw, fvh] = uvRect(cellRect(0));
  // rotateY(π) 后 u=0 在 +x，正好是从正面看的左边：贴图不用翻
  for (let i = 0; i < fu.count; i++) fu.setXY(i, fu0 + fu.getX(i) * fuw, fv0 + fu.getY(i) * fvh);
  place(face, [0, 1.385 * s, -0.0955 * s]);
  return { body, face, mouth: [0, 1.29 * s, -0.098 * s] };
}

const vendorGeoCache = new Map<number, { body: THREE.BufferGeometry; face: THREE.BufferGeometry; merged: THREE.BufferGeometry; mouth: V3; height: number }>();

/** 纸扎摊主几何（按高度缓存）：body（不含脸）、face（单独）、merged（身体 + 脸，实例化摊主用）。 */
function vendorGeometry(height: number) {
  const key = Math.round(height * 1000);
  const hit = vendorGeoCache.get(key);
  if (hit) return hit;
  const k = height / 1.58;
  const parts = vendorParts(k);
  const body = mergeParts(parts.body.map(geo => ({ geo, face: 0 })));
  const face = mergeParts([{ geo: parts.face, face: 1 }]);
  const merged = mergeParts([...parts.body.map(geo => ({ geo, face: 0 })), { geo: parts.face, face: 1 }]);
  for (const g of parts.body) g.dispose();
  parts.face.dispose();
  const out = { body, face, merged, mouth: parts.mouth, height };
  vendorGeoCache.set(key, out);
  return out;
}

/** 给几何加常量 aCell 属性（单个纸人用）。 */
function withCell(geo: THREE.BufferGeometry, cell: [number, number]): THREE.BufferGeometry {
  const g = geo.clone();
  const n = g.attributes.position?.count ?? 0;
  const a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    a[i * 2] = cell[0];
    a[i * 2 + 1] = cell[1];
  }
  g.setAttribute('aCell', new THREE.BufferAttribute(a, 2));
  return g;
}

// ---------------------------------------------------------------- 门童

function boyAtlas(lanternText: string): THREE.CanvasTexture {
  const { canvas, g } = createCanvas(512, 512);
  g.fillStyle = PALETTE.PAPER;
  g.fillRect(0, 0, 512, 512);
  // 红袄（前）：金边对襟、团花
  const jacket: Rect = [0, 0, 192, 160], jBack: Rect = [192, 0, 192, 160], jSide: Rect = [384, 0, 64, 160];
  const pants: Rect = [0, 160, 128, 128], shoe: Rect = [128, 160, 64, 64], hair: Rect = [192, 160, 64, 64], hand: Rect = [256, 160, 64, 64];
  const sleeve: Rect = [320, 160, 128, 128];
  gutters(g, [
    [jacket, '#C0282C'], [jBack, '#C0282C'], [jSide, '#A52226'], [pants, '#2E8B4E'], [shoe, '#141414'], [hair, '#141414'],
    [hand, '#F2E9DA'], [sleeve, '#C0282C'],
  ], 4);
  fillPaper(g, jacket, '#C0282C', 31);
  fillPaper(g, jBack, '#C0282C', 32);
  fillPaper(g, jSide, '#A52226', 33);
  g.fillStyle = '#E8C04A';
  g.fillRect(90, 0, 12, 160);
  for (const [cx, cy] of [[48, 60], [144, 60], [96, 120], [288, 70]] as const) {
    g.strokeStyle = '#E8C04A';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, 16, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, 6, 0, Math.PI * 2);
    g.stroke();
  }
  fillPaper(g, pants, '#2E8B4E', 34);
  fillPaper(g, shoe, '#141414', 35);
  fillPaper(g, hair, '#141414', 36);
  fillPaper(g, hand, '#F2E9DA', 37);
  fillPaper(g, sleeve, '#C0282C', 38);
  g.fillStyle = '#E8C04A';
  g.fillRect(320, 270, 128, 10);
  // 脸（与摊主同一套画法，格子号固定）
  paintFace(g, 0, 288, 224, 5, false);
  // 童脸的两团更圆的腮红
  for (const sx of [-1, 1]) {
    const grd = g.createRadialGradient(112 + sx * 52, 288 + 134, 2, 112 + sx * 52, 288 + 134, 26);
    grd.addColorStop(0, 'rgba(240,60,80,0.9)');
    grd.addColorStop(1, 'rgba(240,60,80,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(112 + sx * 52, 288 + 134, 26, 0, Math.PI * 2);
    g.fill();
  }
  // 灯笼纸（u 绕一圈，正面 u=0.5）：竖排写字
  const lamp: Rect = [224, 288, 288, 224];
  g.fillStyle = PALETTE.LANTERN;
  g.fillRect(lamp[0], lamp[1], lamp[2], lamp[3]);
  g.strokeStyle = 'rgba(120,100,70,0.35)';
  for (let x = lamp[0]; x < lamp[0] + lamp[2]; x += 18) {
    g.beginPath();
    g.moveTo(x, lamp[1]);
    g.lineTo(x, lamp[1] + lamp[3]);
    g.stroke();
  }
  g.fillStyle = '#1a1a1a';
  const cols = lanternText.split('\n').filter(Boolean);
  const colW = 26;
  const x0 = lamp[0] + lamp[2] / 2 + ((cols.length - 1) * colW) / 2;
  g.font = `bold 22px ${FONT_STACK}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  cols.forEach((col, c) => {
    [...col].forEach((ch, i) => g.fillText(ch, x0 - c * colW, lamp[1] + 24 + i * 24));
  });
  const tex = canvasToTexture(canvas, { anisotropy: 4 });
  tex.name = 'paperBoyAtlas';
  tex.userData.lanternText = lanternText;
  return tex;
}

// ---------------------------------------------------------------- 工厂

const noopRig = (root: THREE.Group, face: THREE.Mesh, mouth: THREE.Object3D, extra: {
  faceHi?: () => THREE.Texture; update?: (dt: number) => void; dispose?: () => void; jitterTarget?: THREE.Object3D;
}): PaperRig => {
  let jitter = 0;
  const jt = extra.jitterTarget ?? root;
  const base = { pos: jt.position.clone(), rot: jt.rotation.clone() };
  const rig: PaperRig = {
    root, face, mouth,
    setJitter(a) {
      jitter = Math.max(0, a);
      if (jitter === 0) {
        jt.position.copy(base.pos);
        jt.rotation.copy(base.rot);
      }
    },
    update(dt) {
      if (jitter > 0) {
        // 纸片的轻微抖动：纯视觉，每帧随机（ARCH §1.5 允许 Math.random）
        jt.position.set(base.pos.x + (Math.random() - 0.5) * 0.01 * jitter, base.pos.y + (Math.random() - 0.5) * 0.006 * jitter, base.pos.z);
        jt.rotation.set(base.rot.x, base.rot.y + (Math.random() - 0.5) * 0.03 * jitter, base.rot.z + (Math.random() - 0.5) * 0.02 * jitter);
      }
      extra.update?.(dt);
    },
    dispose() {
      extra.dispose?.();
      root.removeFromParent();
    },
  };
  if (extra.faceHi) (rig as { faceHi?: () => THREE.Texture }).faceHi = extra.faceHi;
  return rig;
};

export function createPaperFigure(o: PaperOpts): PaperRig {
  return o.kind === 'boy' ? createBoy(o) : createVendor(o);
}

function createVendor(o: PaperOpts): PaperRig {
  const height = o.height ?? 1.58;
  const seed = o.seed ?? 0;
  const cellIdx = faceCellOf(seed);
  const vg = vendorGeometry(height);
  const root = new THREE.Group();
  root.name = 'paperVendor';
  const inner = new THREE.Group();
  inner.name = 'paperInner';
  root.add(inner);
  const bodyMesh = new THREE.Mesh(withCell(vg.body, [0, 0]), vendorMaterial());
  bodyMesh.name = 'paperBody';
  // 黄三爷的脸要单独换高清贴图（hdText 改 map），所以材质私有；普通摊主共用
  const faceMat = o.breathing ? newPaperMaterial(vendorAtlas()) : vendorMaterial();
  const face = new THREE.Mesh(withCell(vg.face, cellOffset(cellIdx)), faceMat);
  face.name = 'paperFace';
  inner.add(bodyMesh, face);
  const mouth = new THREE.Object3D();
  mouth.name = 'mouth';
  mouth.position.set(vg.mouth[0], vg.mouth[1], vg.mouth[2]);
  inner.add(mouth);
  const owned: THREE.BufferGeometry[] = [bodyMesh.geometry, face.geometry];
  const ownedMats: THREE.Material[] = o.breathing ? [faceMat] : [];

  if (!o.breathing) {
    return noopRig(root, face, mouth, {
      jitterTarget: inner,
      dispose: () => {
        for (const g of owned) g.dispose();
        for (const m of ownedMats) m.dispose();
      },
    });
  }

  // ---- 黄三爷的面具：高清脸贴图（首次需要时才画）+ 嘴部鼓瘪的小平面（只在高清贴图生效时可见）
  let hiTex: THREE.CanvasTexture | null = null;
  const faceHi = () => {
    if (!hiTex) {
      hiTex = paintVendorAtlas(2, cellIdx);
      hiTex.name = 'paperVendorAtlasHi';
    }
    return hiTex;
  };
  const patchMat = newPaperMaterial(vendorAtlas());
  ownedMats.push(patchMat);
  // 嘴部小平面：取脸格子里嘴那一块（格子内 u 0.3–0.7、v 0.12–0.42，脸平面上对应的位置）
  const fw = 0.205 * height / 1.58, fh = 0.245 * height / 1.58;
  const pw = fw * 0.4, ph = fh * 0.3;
  const patchGeo = new THREE.PlaneGeometry(pw, ph);
  patchGeo.rotateY(Math.PI);
  const [cu0, cv0, cuw, cvh] = uvRect(cellRect(cellIdx));
  const pu = patchGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pu.count; i++) pu.setXY(i, cu0 + (0.3 + pu.getX(i) * 0.4) * cuw, cv0 + (0.12 + pu.getY(i) * 0.3) * cvh);
  const patchGeoC = withCell(mergeParts([{ geo: patchGeo, face: 0 }]), [0, 0]);
  patchGeo.dispose();
  const patch = new THREE.Mesh(patchGeoC, patchMat);
  patch.name = 'breathPatch';
  // 脸平面中心在 1.385k；嘴区中心在格子 v≈0.27 → 离脸中心 (0.27-0.5)·fh
  const k = height / 1.58;
  patch.position.set(0, 1.385 * k + (0.27 - 0.5) * fh, -0.0955 * k - 0.0012);
  patch.visible = false;
  patch.userData.noBounds = true;
  inner.add(patch);
  owned.push(patchGeoC);
  let t = 0;
  return noopRig(root, face, mouth, {
    jitterTarget: inner,
    faceHi,
    update(dt) {
      t += dt;
      const hiOn = hiTex !== null && (face.material as THREE.MeshStandardMaterial).map === hiTex;
      patch.visible = hiOn;
      if (hiOn) {
        if (patchMat.map !== hiTex) {
          patchMat.map = hiTex;
          patchMat.needsUpdate = true;
        }
        // 约 0.25Hz、±3% 的一鼓一瘪（ARCH §5.3）
        const k2 = 1 + 0.03 * Math.sin(t * Math.PI * 2 * 0.25);
        patch.scale.set(k2, k2, 1);
        patch.position.z = -0.0955 * k - 0.0012 - (k2 - 1) * 0.04;
      }
    },
    dispose() {
      for (const g of owned) g.dispose();
      for (const m of ownedMats) m.dispose();
      hiTex?.dispose();
    },
  });
}

function createBoy(o: PaperOpts): PaperRig {
  const height = o.height ?? 1.1;
  const k = height / 1.1;
  const text = o.lanternText ?? '';
  const atlas = boyAtlas(text);
  const mat = newPaperMaterial(atlas);
  const U = (r: Rect): Rect => [r[0] * 2, r[1] * 2, r[2] * 2, r[3] * 2]; // 门童贴图 512²，按 1024 布局换算
  const jacket = U([0, 0, 192, 160]), jBack = U([192, 0, 192, 160]), jSide = U([384, 0, 64, 160]);
  const pants = U([0, 160, 128, 128]), shoe = U([128, 160, 64, 64]), hair = U([192, 160, 64, 64]), hand = U([256, 160, 64, 64]);
  const sleeve = U([320, 160, 128, 128]);
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    parts.push(place(paperBox(0.1 * k, 0.1 * k, 0.1 * k, 0.1 * k, 0.4 * k, pants, pants, pants), [sx * 0.07 * k, 0.05 * k, 0]));
    parts.push(place(paperBox(0.1 * k, 0.16 * k, 0.1 * k, 0.16 * k, 0.05 * k, shoe, shoe, shoe, shoe), [sx * 0.07 * k, 0, -0.02 * k]));
  }
  parts.push(place(paperBox(0.38 * k, 0.22 * k, 0.3 * k, 0.18 * k, 0.4 * k, jacket, jBack, jSide), [0, 0.43 * k, 0]));
  // 左袖垂着，右袖往前伸（提灯笼）
  parts.push(place(paperBox(0.11 * k, 0.1 * k, 0.09 * k, 0.09 * k, 0.3 * k, sleeve, sleeve, sleeve), [-0.2 * k, 0.5 * k, 0], [0, 0, -10]));
  parts.push(place(paperBox(0.11 * k, 0.1 * k, 0.09 * k, 0.09 * k, 0.3 * k, sleeve, sleeve, sleeve), [0.2 * k, 0.78 * k, -0.03 * k], [-70, 0, 0]));
  parts.push(place(paperBox(0.05 * k, 0.04 * k, 0.05 * k, 0.04 * k, 0.07 * k, hand, hand, hand), [-0.22 * k, 0.44 * k, 0]));
  parts.push(place(paperBox(0.05 * k, 0.04 * k, 0.05 * k, 0.04 * k, 0.07 * k, hand, hand, hand), [0.2 * k, 0.77 * k, -0.33 * k], [-70, 0, 0]));
  // 头盒 + 两个丫髻
  parts.push(place(paperBox(0.2 * k, 0.18 * k, 0.2 * k, 0.18 * k, 0.22 * k, hair, hair, hair, hair), [0, 0.84 * k, 0.005 * k]));
  for (const sx of [-1, 1]) parts.push(place(paperBox(0.07 * k, 0.07 * k, 0.05 * k, 0.05 * k, 0.07 * k, hair, hair, hair, hair), [sx * 0.08 * k, 1.05 * k, 0.01 * k]));
  const face = new THREE.PlaneGeometry(0.2 * k, 0.215 * k);
  face.rotateY(Math.PI);
  const [fu0, fv0, fuw, fvh] = uvRect(U([0, 288, 224, 224]));
  const fu = face.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < fu.count; i++) fu.setXY(i, fu0 + fu.getX(i) * fuw, fv0 + fu.getY(i) * fvh);
  place(face, [0, 0.95 * k, -0.0905 * k]);
  const bodyGeo = withCell(mergeParts(parts.map(geo => ({ geo, face: 0 }))), [0, 0]);
  const faceGeo = withCell(mergeParts([{ geo: face, face: 1 }]), [0, 0]);
  for (const g of parts) g.dispose();
  face.dispose();

  const root = new THREE.Group();
  root.name = 'paperBoy';
  const inner = new THREE.Group();
  root.add(inner);
  const bodyMesh = new THREE.Mesh(bodyGeo, mat);
  bodyMesh.name = 'paperBody';
  const faceMesh = new THREE.Mesh(faceGeo, mat);
  faceMesh.name = 'paperFace';
  inner.add(bodyMesh, faceMesh);
  // 提着的白纸灯笼（竹竿 + Lathe 灯笼，字朝前）。M4 第 2 轮：竿子加粗、颜色压深（原来 8mm 的浅竿子第三人称下看不见，灯笼像悬空），
  // 灯笼挂到竿尖正下方，中间一段细绳
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014 * k, 0.014 * k, 0.5 * k, 6), new THREE.MeshStandardMaterial({ color: '#6B4E2A', roughness: 0.8 }));
  pole.material.userData.tempC = TEMP_C.paper;
  pole.rotation.x = -1.05;
  pole.position.set(0.2 * k, 0.86 * k, -0.52 * k);
  // 竿尖（竿子中心沿轴 +0.25k：(0, cos, sin)(−1.05) × 0.25k）
  const tip = new THREE.Vector3(0.2 * k, 0.86 * k + Math.cos(-1.05) * 0.25 * k, -0.52 * k + Math.sin(-1.05) * 0.25 * k);
  const cordLen = 0.04 * k;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003 * k, 0.003 * k, cordLen, 4), pole.material);
  cord.position.set(tip.x, tip.y - cordLen / 2, tip.z);
  const prof = [[0.001, 0.19], [0.1, 0.18], [0.14, 0.1], [0.15, 0], [0.14, -0.1], [0.1, -0.18], [0.001, -0.19]].map(([x, y]) => new THREE.Vector2((x ?? 0) * k, (y ?? 0) * k));
  const lampGeo = new THREE.LatheGeometry(prof, 18);
  const [lu0, lv0, luw, lvh] = uvRect(U([224, 288, 288, 224]));
  const lu = lampGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < lu.count; i++) lu.setXY(i, lu0 + lu.getX(i) * luw, lv0 + (1 - lu.getY(i)) * lvh);
  const lampMat = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: PALETTE.LANTERN, emissiveIntensity: 1.3, roughness: 0.9, side: THREE.DoubleSide });
  lampMat.userData.tempC = TEMP_C.ghostLantern;
  const lantern = new THREE.Mesh(lampGeo, lampMat);
  lantern.name = 'boyLantern';
  // 灯笼顶（半高 0.19k）挂在细绳下端
  lantern.position.set(tip.x, tip.y - cordLen - 0.19 * k, tip.z);
  inner.add(pole, cord, lantern);
  const mouth = new THREE.Object3D();
  mouth.position.set(0, 0.9 * k, -0.092 * k);
  inner.add(mouth);
  return noopRig(root, faceMesh, mouth, {
    jitterTarget: inner,
    dispose() {
      bodyGeo.dispose();
      faceGeo.dispose();
      lampGeo.dispose();
      pole.geometry.dispose();
      cord.geometry.dispose();
      mat.dispose();
      lampMat.dispose();
      pole.material.dispose();
      atlas.dispose();
    },
  });
}

/**
 * 9 个静态摊主，一次绘制：与同 seed 的 createPaperFigure({ kind:'vendor' }) 共用同一份几何（身体 + 脸合并）、
 * 同一张贴图集、同一个材质；每个实例的脸格子来自 InstancedBufferAttribute aCell。
 */
export function createPaperStalls(transforms: { pos: V3; yaw: number; seed: number }[]): THREE.InstancedMesh {
  const vg = vendorGeometry(1.58);
  const geo = vg.merged.clone();
  const cells = new Float32Array(transforms.length * 2);
  transforms.forEach((t, i) => {
    const c = cellOffset(faceCellOf(t.seed));
    cells[i * 2] = c[0];
    cells[i * 2 + 1] = c[1];
  });
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
  const mesh = new THREE.InstancedMesh(geo, vendorMaterial(), Math.max(1, transforms.length));
  mesh.name = 'paperStalls';
  mesh.count = transforms.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  transforms.forEach((t, i) => {
    q.setFromAxisAngle(up, -t.yaw * DEG2RAD);
    m.compose(new THREE.Vector3(t.pos[0], t.pos[1], t.pos[2]), q, one);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  mesh.userData.tempC = TEMP_C.paper;
  return mesh;
}
