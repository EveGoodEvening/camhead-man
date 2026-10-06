// owner: WP2
// 程序化人身（ARCH §5.1）：基础几何体拼成，关节是嵌套 Group，不做骨骼蒙皮。
//
// 骨架（人偶面朝 -z，右手在 +x；s = height / 1.75）：
//   root（脚底中点）→ pivot（躺下/坐下/起伏）→ hips（髋，0.95s）
//     ├ spine（腰，1.05s）→ neck（领口，1.50s）→ headSlot
//     │    ├ shoulderL/R（1.45s，±0.19s）→ elbowL/R（-0.29s）
//     └ hipL/R（0.92s，±0.095s）→ kneeL/R（-0.43s）
// 关节角度约定见 poses.ts。部件几何按尺寸缓存复用（ARCH §5.1）；材质每个人偶各自一套（淡出、换色互不影响）。

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Pose } from '../core/types';
import { PALETTE } from '../data/palette';
import { RENDER_ORDER, TEMP_C } from '../data/render';
import { MATERIALS, isSharedMaterial } from '../fx/materials';
import { createGhostMaterial, createReplayMaterial, type GhostDetail } from '../fx/ghostMaterials';
import { canvasToTexture, createCanvas, shade } from '../kit/canvas';
import { newMat } from '../kit/geom';
import { rng, range } from '../kit/rng';
import { POSES, type PoseDef } from './poses';

export type JointName = 'hips' | 'spine' | 'neck' | 'headSlot'
  | 'shoulderL' | 'elbowL' | 'shoulderR' | 'elbowR' | 'hipL' | 'kneeL' | 'hipR' | 'kneeR';

export type HumanoidMaterialMode = 'standard' | 'ghost' | 'replay' | 'silhouette';

export interface HumanoidSpec {
  /** 标称身高（含人头时的身高，决定各部件比例）：1.75 主角/老周；1.2 土地；1.4 黄三爷。head:'none' 时身子只到领口（主角领口 1.50，PC_DIMS.collarY） */
  height: number;
  /** hunch：脊柱前倾 12°、肩下沉 */
  build?: 'normal' | 'slim' | 'stout' | 'hunch';
  shirt: THREE.ColorRepresentation; pants: THREE.ColorRepresentation; shoes?: THREE.ColorRepresentation;
  skin?: THREE.ColorRepresentation;
  sleeves?: 'short' | 'long';
  /** 长袍（土地）：腿部换成 Lathe 下摆 */
  robe?: boolean;
  /** 'none' = 留空 headSlot 由外部挂载 */
  head: 'none' | 'human' | 'camera' | 'weasel';
  material?: HumanoidMaterialMode;
}

export interface HumanoidRig {
  /** 原点在两脚中间地面，面朝 -z */
  readonly root: THREE.Group;
  readonly joints: Readonly<Record<JointName, THREE.Group>>;
  readonly height: number;
  /** 默认 0.3s 过渡 */
  setPose(p: Pose, blendSec?: number): void;
  /** speed>0.1 时播放行走循环，否则保持姿势并轻微呼吸 */
  update(dt: number, speed: number): void;
  setMaterialMode(m: HumanoidMaterialMode, color?: THREE.ColorRepresentation): void;
  /** 淡入淡出（护送换层、化光） */
  setOpacity(a: number): void;
  /** 拍照判定用 */
  bounds(target: THREE.Box3): THREE.Box3;
  dispose(): void;
}

// ---------------------------------------------------------------- 内部扩展（characters/player 用，不属于冻结签名）

/** 头部外观（人头贴图）：WP2 内部。 */
export interface FaceOpts {
  skin: string; hair: string;
  hairStyle: 'short' | 'bald' | 'long' | 'none';
  age: 'young' | 'old' | 'child';
  female?: boolean;
  /** 眉眼更浓（年轻男子）/ 更淡 */
  brows?: number;
  seed?: number;
}

export interface HumanoidInternal extends HumanoidRig {
  readonly spec: Readonly<HumanoidSpec>;
  /** 比例 s = height / 1.75 */
  readonly s: number;
  /** 各部件（身体网格） */
  readonly parts: Readonly<Record<string, THREE.Mesh>>;
  /** 人头网格（head:'human'/'weasel'/'camera' 时） */
  readonly headMesh: THREE.Object3D | null;
  /** 当前材质模式 */
  readonly mode: HumanoidMaterialMode;
  readonly pose: Pose;
  /** 把配件纳入材质模式切换、淡出与包围盒（accessories 用） */
  adopt(obj: THREE.Object3D, o?: { keepMaterial?: boolean }): void;
  /** 身体网格的可见性（lantern_only、尾声只剩头） */
  setBodyVisible(v: boolean): void;
  /** 当前走路相位（0..2π），配件摆动用 */
  readonly walkPhase: number;
  /** 当前行走权重（0 停 → 1 走） */
  readonly walkWeight: number;
}

const JOINT_NAMES: readonly JointName[] = ['hips', 'spine', 'neck', 'headSlot', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR'];

const BUILD = {
  normal: { w: 1, d: 1, belly: 0 },
  slim: { w: 0.86, d: 0.9, belly: 0 },
  stout: { w: 1.14, d: 1.22, belly: 0.05 },
  hunch: { w: 0.94, d: 1, belly: 0 },
} as const;

// ---------------------------------------------------------------- 几何缓存

const geoCache = new Map<string, THREE.BufferGeometry>();
const cachedGeos = new WeakSet<THREE.BufferGeometry>();

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
    cachedGeos.add(g);
  }
  return g;
}

const q = (v: number) => Math.round(v * 1000);

/** Lathe 轮廓自下而上生成后 v 也是自下而上；翻回“v = 0 在顶上”，贴图方向与原来（自上而下的轮廓）一致。 */
function flipLatheV(g: THREE.BufferGeometry): void {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  uv.needsUpdate = true;
}

/** 从关节往下长的肢体段（顶端在原点，沿 -y 长 len）。 */
function limbGeo(rTop: number, rBot: number, len: number, seg = 10): THREE.BufferGeometry {
  return cached(`limb:${q(rTop)}:${q(rBot)}:${q(len)}:${seg}`, () => {
    const g = new THREE.CylinderGeometry(rTop, rBot, len, seg, 1, false);
    g.translate(0, -len / 2, 0);
    return g;
  });
}

/**
 * 短袖袖筒（M4）：顶上是圆肩（半球封口），往下外撇、下口敞开（不是胶囊的圆底），长到上臂中段。
 * 顶端（肩关节）在原点，沿 -y 长 len。
 */
function sleeveGeo(rTop: number, rBot: number, len: number): THREE.BufferGeometry {
  return cached(`sleeve:${q(rTop)}:${q(rBot)}:${q(len)}`, () => {
    const pts: THREE.Vector2[] = [];
    // 轮廓必须自下而上（LatheGeometry 的法线/绕序：y 递增才朝外；自上而下会整件内外翻转，正面被剔除、从外面看穿到胳膊）
    // 筒身：从外撇的袖口往上到肩
    for (let i = 4; i >= 1; i--) {
      const t = i / 4;
      pts.push(new THREE.Vector2(rTop + (rBot - rTop) * t * t, -len * t));
    }
    // 圆肩：从赤道绕到顶点（极点）
    for (let i = 5; i >= 0; i--) {
      const a = (i / 5) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.max(1e-4, Math.sin(a) * rTop), Math.cos(a) * rTop * 0.9));
    }
    const g = new THREE.LatheGeometry(pts, 14);
    flipLatheV(g);
    return g;
  });
}

/**
 * 手（M4）：圆角方块的手掌（薄面朝身体、手心朝内）+ 一根往前下方伸的拇指，合成一个网格；中心在肘下 cy（贴住手腕）。
 * 原来是压扁的连指胶囊（像香肠）。
 */
function handGeo(s: number, cy: number): THREE.BufferGeometry {
  return cached(`hand2:${q(s)}:${q(cy)}`, () => {
    const palm = new RoundedBoxGeometry(0.03 * s, 0.095 * s, 0.07 * s, 2, 0.012 * s);
    palm.translate(0, cy, -0.002 * s);
    const thumbSrc = new THREE.CapsuleGeometry(0.012 * s, 0.028 * s, 3, 6);
    thumbSrc.rotateX(0.55);
    thumbSrc.translate(0, cy + 0.012 * s, -0.036 * s);
    const thumb = thumbSrc.toNonIndexed();
    thumbSrc.dispose();
    const merged = mergeGeometries([palm, thumb], false) ?? palm;
    if (merged !== palm) palm.dispose();
    thumb.dispose();
    return merged;
  });
}

/** 敞口的短筒（袖口边、袖口环）：不封口，从侧面看是一道布边，不是一片圆盘。顶端在原点，沿 -y 长 len。 */
function bandGeo(rTop: number, rBot: number, len: number): THREE.BufferGeometry {
  return cached(`band:${q(rTop)}:${q(rBot)}:${q(len)}`, () => {
    const g = new THREE.CylinderGeometry(rTop, rBot, len, 14, 1, true);
    g.translate(0, -len / 2, 0);
    return g;
  });
}

/**
 * 同一关节下、同一材质的几块合成一个网格（M4：肘球 + 前臂 + 手、膝球 + 小腿——每个人偶少 4–6 次 draw call）。
 * parts：[几何, 相对关节的平移 y, 绕 y 的旋转]；一律转成非索引几何再合并（手本身已是非索引的）。
 */
function mergedLimb(key: string, parts: readonly (readonly [THREE.BufferGeometry, number, number])[]): THREE.BufferGeometry {
  return cached(`merged:${key}`, () => {
    const list = parts.map(([g, dy, ry]) => {
      const c = g.index ? g.toNonIndexed() : g.clone();
      if (ry !== 0) c.rotateY(ry);
      if (dy !== 0) c.translate(0, dy, 0);
      return c;
    });
    const m = mergeGeometries(list, false);
    for (const c of list) if (c !== m) c.dispose();
    return m ?? new THREE.BufferGeometry();
  });
}

/** 关节填缝小球（肘、膝）：与相邻肢体同材质、同粗，弯曲时不露缝（不是外露的“关节球”）。 */
function jointBallGeo(r: number): THREE.BufferGeometry {
  return cached(`jball:${q(r)}`, () => new THREE.SphereGeometry(r, 10, 8));
}

/** 带圆头的肢体（上臂、前臂）：顶端与底端都是半球，看起来关节连贯。 */
function capsuleLimb(r: number, len: number): THREE.BufferGeometry {
  return cached(`cap:${q(r)}:${q(len)}`, () => {
    // r186：CapsuleGeometry(radius, height) 的 height 是中段长度（ARCH §16 #21）
    const mid = Math.max(0.001, len - 2 * r);
    const g = new THREE.CapsuleGeometry(r, mid, 4, 10);
    g.translate(0, -len / 2, 0);
    return g;
  });
}

function boxGeo(w: number, h: number, d: number, cy: number, cz = 0): THREE.BufferGeometry {
  return cached(`box:${q(w)}:${q(h)}:${q(d)}:${q(cy)}:${q(cz)}`, () => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, cy, cz);
    return g;
  });
}

/** 鞋：前端略翘的方头布鞋（顶端在踝关节下方）。 */
function shoeGeo(w: number, h: number, len: number, y: number, zFront: number): THREE.BufferGeometry {
  return cached(`shoe:${q(w)}:${q(h)}:${q(len)}:${q(y)}:${q(zFront)}`, () => {
    const g = new THREE.BoxGeometry(w, h, len, 1, 1, 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i), yy = p.getY(i);
      // 鞋头收窄、鞋面前低后高
      if (z < -len * 0.2) p.setX(i, p.getX(i) * 0.82);
      if (yy > 0 && z < 0) p.setY(i, yy - h * 0.35 * (-z / (len / 2)));
    }
    g.computeVertexNormals();
    // 鞋面贴图：顶面映到黑布区（v≈0.9），底面映到白鞋底（v≈0.1），侧面下四分之一是鞋底（见 accessories.clothShoeTexture）
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      if (i >= 12 && i < 18) uv.setY(i, 0.9);
      else if (i >= 18 && i < 24) uv.setY(i, 0.1);
    }
    // 鞋头在 zFront（-z 是前方），鞋跟在 zFront + len；踝关节（z = 0）落在离鞋头约 72% 处（zFront ≈ -0.72·len）。
    // M4 更正：原来又多减了一次 0.72·len，整只鞋挪到小腿前面 12–38cm，侧面看是两块离脚漂在地上的扁板
    g.translate(0, y, zFront + len / 2);
    return g;
  });
}

/** 放样的一圈：高 y、半宽 a、半深 b；front = 前胸额外鼓出（×b）；drop = 这一圈两侧往下塌（肩线）。 */
interface LoftRow { y: number; a: number; b: number; front?: number; drop?: number }

/**
 * 圆角方截面（超椭圆，n=3）放样：躯干、骨盆、腰带用。UV：u=0 在 +x（右侧），经前胸（u=0.25）到 -x（u=0.5），
 * 再经后背（u=0.75）回到 +x；v 从下往上。所以衣服贴图左半是前胸、右半是后背（从正面看从左到右读）。
 * capTop：顶上封口（肩膀收到领口圈再封到中心），capBottom：底下封口；封口 UV 落在贴图右下角的纯色区。
 */
export function squircleLoft(rows: readonly LoftRow[], seg = 24, o?: { capTop?: { y: number; a: number; b: number }; capBottom?: boolean }): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const sq = (c: number) => Math.sign(c) * Math.pow(Math.abs(c), 2 / 3);
  const ring = (r: LoftRow, v: number | null) => {
    const base = pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      const cx = sq(Math.cos(t)), cz = -sq(Math.sin(t));
      let z = cz * r.b;
      if (cz < 0 && r.front) z *= 1 + r.front * Math.pow(-cz, 2) * Math.pow(Math.max(0, 1 - Math.abs(cx)), 0.5);
      pos.push(cx * r.a, r.y - (r.drop ?? 0) * cx * cx, z);
      if (v === null) uv.push(0.9 + 0.06 * (0.5 + cx * 0.5), 0.45 + 0.1 * (0.5 + cz * 0.5));
      else uv.push(i / seg, v);
    }
    return base;
  };
  const strip = (b0: number, b1: number) => {
    for (let i = 0; i < seg; i++) {
      const a = b0 + i, b = a + 1, c = b1 + i, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  };
  /** up=true：朝上的封口（顶）；false：朝下（底）。 */
  const fan = (b0: number, center: [number, number, number], up: boolean) => {
    const c = pos.length / 3;
    pos.push(center[0], center[1], center[2]);
    uv.push(0.93, 0.5);
    for (let i = 0; i < seg; i++) {
      if (up) idx.push(b0 + i, b0 + i + 1, c);
      else idx.push(b0 + i + 1, b0 + i, c);
    }
  };
  let prev = -1;
  rows.forEach((r, k) => {
    const b = ring(r, k / Math.max(1, rows.length - 1));
    if (prev >= 0) strip(prev, b);
    prev = b;
  });
  const last = rows[rows.length - 1];
  if (o?.capTop && last) {
    const b0 = ring(last, null);
    const neck: LoftRow = { y: o.capTop.y, a: o.capTop.a, b: o.capTop.b };
    const b1 = ring(neck, null);
    strip(b0, b1);
    fan(b1, [0, o.capTop.y, 0], true);
  }
  const first = rows[0];
  if (o?.capBottom && first) fan(ring(first, null), [0, first.y, 0], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 躯干的放样圈（torsoGeo 与 torsoSurface 共用）。 */
function torsoRows(s: number, bw: number, bd: number, belly: number): LoftRow[] {
  const W = s * bw, D = s * bd;
  return [
    { y: 0, a: 0.162 * W, b: 0.104 * D + belly * s * 0.6 },
    { y: 0.08 * s, a: 0.166 * W, b: 0.106 * D + belly * s, front: belly * 2.5 },
    { y: 0.18 * s, a: 0.176 * W, b: 0.11 * D + belly * s * 0.7, front: 0.05 + belly * 2 },
    { y: 0.28 * s, a: 0.19 * W, b: 0.117 * D, front: 0.1 },
    { y: 0.36 * s, a: 0.198 * W, b: 0.118 * D, front: 0.08 },
    { y: 0.405 * s, a: 0.196 * W, b: 0.112 * D, drop: 0.012 * s },
    { y: 0.435 * s, a: 0.17 * W, b: 0.094 * D, drop: 0.028 * s },
  ];
}

/** 躯干：腰 1.05s → 领口 1.50s；胸口前挺、肩线往两侧塌、顶上收成圆肩再封到领口。 */
function torsoGeo(s: number, bw: number, bd: number, belly: number): THREE.BufferGeometry {
  return cached(`torso:${q(s)}:${q(bw)}:${q(bd)}:${q(belly)}`, () => squircleLoft(torsoRows(s, bw, bd, belly), 28, { capTop: { y: 0.452 * s, a: 0.072 * s, b: 0.064 * s } }));
}

/** 放样圈上 u（0..1，同 squircleLoft 的 UV：0 = +x、0.25 = 前胸正中）处的点（圈按 y 线性插值）。 */
function loftPoint(rows: readonly LoftRow[], u: number, y: number, out: THREE.Vector3): THREE.Vector3 {
  let i = 0;
  while (i < rows.length - 2 && y > rows[i + 1]!.y) i++;
  const r0 = rows[i]!, r1 = rows[i + 1]!;
  const k = Math.min(1, Math.max(0, (y - r0.y) / Math.max(1e-6, r1.y - r0.y)));
  const a = r0.a + (r1.a - r0.a) * k, b = r0.b + (r1.b - r0.b) * k;
  const front = (r0.front ?? 0) + ((r1.front ?? 0) - (r0.front ?? 0)) * k;
  const drop = (r0.drop ?? 0) + ((r1.drop ?? 0) - (r0.drop ?? 0)) * k;
  const sq = (c: number) => Math.sign(c) * Math.pow(Math.abs(c), 2 / 3);
  const t = u * Math.PI * 2;
  const cx = sq(Math.cos(t)), cz = -sq(Math.sin(t));
  let z = cz * b;
  if (cz < 0 && front) z *= 1 + front * Math.pow(-cz, 2) * Math.pow(Math.max(0, 1 - Math.abs(cx)), 0.5);
  return out.set(cx * a, y - drop * cx * cx, z);
}

/**
 * M4 第 2 轮（WP2 内部）：躯干表面（spine 局部坐标）上 u、高 y 处的点与外法线、沿圈的切线（配件——中山装的口袋盖、扣子——贴着衣服摆）。
 * u 与躯干贴图的 u 一致（0 = 右侧 +x，0.25 = 前胸正中，0.5 = 左侧）。
 */
export function torsoSurface(h: HumanoidInternal, u: number, y: number): { p: THREE.Vector3; n: THREE.Vector3; t: THREE.Vector3; up: THREE.Vector3 } {
  const b = BUILD[h.spec.build ?? 'normal'];
  const rows = torsoRows(h.s, b.w, b.d, b.belly);
  const p = loftPoint(rows, u, y, new THREE.Vector3());
  const e = 0.002;
  const t = loftPoint(rows, u + e, y, new THREE.Vector3()).sub(loftPoint(rows, u - e, y, new THREE.Vector3())).normalize();
  const up = loftPoint(rows, u, y + 0.01 * h.s, new THREE.Vector3()).sub(loftPoint(rows, u, y - 0.01 * h.s, new THREE.Vector3())).normalize();
  const n = new THREE.Vector3().crossVectors(t, up).normalize();
  if (n.dot(new THREE.Vector3(p.x, 0, p.z)) < 0) n.negate();
  // 切线朝人偶的右手（+x），上方向与法线正交
  if (t.x < 0) t.negate();
  up.crossVectors(n, t).normalize();
  return { p, n, t, up };
}

/** 骨盆（裤腰到裆）与腰带：同样的圆角方截面。 */
function pelvisGeo(s: number, bw: number, bd: number): THREE.BufferGeometry {
  return cached(`pelvis:${q(s)}:${q(bw)}:${q(bd)}`, () => squircleLoft([
    { y: -0.07 * s, a: 0.13 * s * bw, b: 0.09 * s * bd },
    { y: 0.0, a: 0.158 * s * bw, b: 0.104 * s * bd },
    { y: 0.11 * s, a: 0.161 * s * bw, b: 0.104 * s * bd },
  ], 20, { capBottom: true }));
}

function beltGeo(s: number, bw: number, bd: number): THREE.BufferGeometry {
  return cached(`belt:${q(s)}:${q(bw)}:${q(bd)}`, () => squircleLoft([
    { y: 0.085 * s, a: 0.166 * s * bw, b: 0.109 * s * bd },
    { y: 0.118 * s, a: 0.167 * s * bw, b: 0.11 * s * bd },
  ], 20));
}

/** 长袍（土地）：Lathe 下摆，从腰到脚踝，下摆外撇。 */
function robeGeo(s: number, bw: number): THREE.BufferGeometry {
  return cached(`robe:${q(s)}:${q(bw)}`, () => {
    const pts: THREE.Vector2[] = [];
    const top = 0.1 * s, bottom = -0.86 * s;
    const n = 9;
    // 自下而上（见 sleeveGeo：y 递增法线才朝外；原来自上而下，袍子内外翻转，M4 加的小腿从袍子正面透出来）
    for (let i = n; i >= 0; i--) {
      const t = i / n;
      const y = top + (bottom - top) * t;
      const r = (0.17 + 0.09 * t + 0.03 * t * t) * s * bw;
      pts.push(new THREE.Vector2(r, y));
    }
    const g = new THREE.LatheGeometry(pts, 14);
    flipLatheV(g);
    g.scale(1, 1, 0.8);
    return g;
  });
}

/** 圆肚（土地、胖子）：Lathe 做的上身，腰腹鼓起。 */
function bellyTorsoGeo(s: number, bw: number, bulge: number): THREE.BufferGeometry {
  return cached(`belly:${q(s)}:${q(bw)}:${q(bulge)}`, () => {
    // 圆肚只往前挺（肚子在前面），侧面轮廓保持袍子的直筒
    const prof = [
      [0.165, 0], [0.18, 0.06], [0.19, 0.13], [0.19, 0.21], [0.183, 0.29], [0.176, 0.35], [0.155, 0.405], [0.1, 0.442], [0.05, 0.456], [0.001, 0.46],
    ] as const;
    const pts = prof.map(([r, y]) => new THREE.Vector2(r * s * bw, y * s));
    const g = new THREE.LatheGeometry(pts, 16);
    g.scale(1, 1, 0.78);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / s;
      if (p.getZ(i) < 0) p.setZ(i, p.getZ(i) * (1 + bulge * 6 * Math.max(0, 1 - Math.abs(y - 0.15) / 0.17)));
    }
    g.computeVertexNormals();
    return g;
  });
}

/** 头的半轴（headSphereGeo 的缩放）：x 0.92、y 1.12、z 1（× r）。 */
const HEAD_AX = [0.92, 1.12, 1] as const;

/**
 * 人头贴图的发际线（canvas 的 y / H，与 faceTexture 画头发的公式一致）：d = 离正脸的角距离（0 正前、0.25 耳侧、0.5 后脑）。
 * 头发壳的下沿就沿着它，所以壳边正好压在贴图的发际线上。
 */
function hairlineFrac(style: FaceOpts['hairStyle'], d: number, child: boolean): number {
  if (style === 'bald') return d < 0.17 ? 0 : 0.44 + (d - 0.17) * 0.5;
  if (style === 'long') return 0.3 + Math.min(1, d / 0.12) * 0.08 + Math.max(0, d - 0.15) * 1.1;
  return 0.3 + Math.min(1, d / 0.14) * 0.1 + Math.max(0, d - 0.2) * 0.55 + (child ? 0.03 : 0);
}

/**
 * M4 第 2 轮：头发壳（经纬网格，头的 1.04–1.07 倍）：short/long 从头顶盖到发际线（前额 → 耳上 → 后脑），long 在赤道以下直直垂到颈后；
 * bald（土地）只剩后脑到两侧的一圈发环。UV 指向人头贴图里的头发区（带发丝），与头共用一张贴图、一个网格。
 */
function hairShellGeo(r: number, style: FaceOpts['hairStyle'], child: boolean): THREE.BufferGeometry | null {
  if (style === 'none') return null;
  const nx = 32, ny = 8;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  // bald：只取后脑那一段（离正脸 d ≥ 0.17），发环上沿在贴图的 0.36H
  const bald = style === 'bald';
  const phi0 = bald ? Math.PI * 1.5 + 0.17 * Math.PI * 2 : 0;
  const phiLen = bald ? Math.PI * 2 * (1 - 0.34) : Math.PI * 2;
  for (let iy = 0; iy <= ny; iy++) {
    const v = iy / ny;
    for (let ix = 0; ix <= nx; ix++) {
      const phi = phi0 + (ix / nx) * phiLen;
      const uu = (phi / (Math.PI * 2)) % 1;
      let d = Math.abs(uu - 0.75);
      if (d > 0.5) d = 1 - d;
      const top = bald ? 0.36 : 0;
      const bot = Math.max(top + 0.02, hairlineFrac(style, d, child) + 0.01);
      // bald 的发环两端收成尖（贴图里 d = 0.17 处发环宽度接近 0）
      const frac = top + (bot - top) * v;
      const theta = frac * Math.PI;
      // 头顶最厚（发量），往发际线收薄
      const k = r * (1.085 - 0.05 * v);
      const st = Math.sin(Math.min(theta, Math.PI / 2)), ct = Math.cos(theta);
      // 赤道以下（长发）不再往里收：保持赤道的水平半径直直垂下
      const hx = HEAD_AX[0] * k * (theta > Math.PI / 2 ? 1 : st);
      const hz = HEAD_AX[2] * k * (theta > Math.PI / 2 ? 1 : st);
      pos.push(-hx * Math.cos(phi), HEAD_AX[1] * k * ct, hz * Math.sin(phi));
      // 贴图：u 同头，v 落在头发区（short/long：0.03H–0.26H；bald：0.37H 起的发环）
      const cy = bald ? 0.37 + (Math.max(0.38, bot - 0.02) - 0.37) * v * 0.8 : 0.03 + 0.23 * v;
      uv.push(uu, 1 - cy);
    }
  }
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const a = iy * (nx + 1) + ix + 1, b = iy * (nx + 1) + ix, c = (iy + 1) * (nx + 1) + ix, dd = (iy + 1) * (nx + 1) + ix + 1;
      // 与 three 的 SphereGeometry 同绕序（外法线）；顶排退化三角形只留一个
      if (iy !== 0 || bald) idx.push(a, b, dd);
      idx.push(b, c, dd);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 把几何的 UV 全部指到贴图上的一点（耳朵、鼻子取脸上的一块纯肤色）。 */
function flatUv(g: THREE.BufferGeometry, u: number, v: number): THREE.BufferGeometry {
  const a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, u, v);
  return g;
}

/**
 * M4 第 2 轮：人头 = 头球 + 头发壳 + 两只耳朵 + 鼻子，合成一个网格（共用脸贴图，0 次额外 draw call）。
 * 原来是一个光滑的蛋：没有头发体积、耳朵、鼻子，1× 取景器 3m 外读成一个空白的蛋。几何在头的局部坐标（球心在原点，正脸 -z）。
 */
function humanHeadGeo(r: number, face: FaceOpts): THREE.BufferGeometry {
  const child = face.age === 'child';
  return cached(`head2:${q(r)}:${face.hairStyle}:${child ? 1 : 0}`, () => {
    const list: THREE.BufferGeometry[] = [];
    const sphere = new THREE.SphereGeometry(r, 20, 14);
    sphere.scale(HEAD_AX[0], HEAD_AX[1], HEAD_AX[2]);
    list.push(sphere.toNonIndexed());
    sphere.dispose();
    const hair = hairShellGeo(r, face.hairStyle, child);
    if (hair) {
      list.push(hair.toNonIndexed());
      hair.dispose();
    }
    // 耳朵：压扁的小球贴在两侧（与贴图上画的耳朵同高、同位置）；长发盖住耳朵就不做
    if (face.hairStyle !== 'long') {
      for (const sx of [-1, 1]) {
        const ear = new THREE.SphereGeometry(0.19 * r, 8, 6);
        ear.scale(0.4, 1, 0.7);
        ear.rotateY(sx * 0.35);
        ear.translate(sx * 0.96 * r, -0.07 * r, 0.05 * r);
        flatUv(ear, sx > 0 ? 0.5 : 0.004, 0.48);
        list.push(ear.toNonIndexed());
        ear.dispose();
      }
    }
    // 鼻子：尖朝上（鼻梁）、底朝前下方的圆锥，侧面能看出鼻梁与鼻头
    const nose = new THREE.ConeGeometry(0.14 * r, 0.45 * r, 8);
    nose.scale(0.8, 1, 1);
    nose.rotateX(0.4);
    nose.translate(0, -0.2 * r, -1.06 * r);
    flatUv(nose, 0.72, 0.44);
    list.push(nose.toNonIndexed());
    nose.dispose();
    const merged = mergeGeometries(list, false) ?? list[0]!;
    for (const g of list) if (g !== merged) g.dispose();
    merged.computeBoundingSphere();
    return merged;
  });
}

// ---------------------------------------------------------------- 人脸贴图

const faceCache = new Map<string, THREE.CanvasTexture>();

/**
 * 人头贴图（经纬展开，u=0.75 是正脸 -z，v=1 是头顶）：肤色、发型、五官、老人的皱纹。
 * 同参数缓存复用；colorSpace = SRGB。
 */
export function faceTexture(o: FaceOpts): THREE.CanvasTexture {
  const key = `v2${JSON.stringify(o)}`;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const W = 512, H = 256;
  const { canvas, g } = createCanvas(W, H);
  const r = rng(o.seed ?? 1);
  const fx = W * 0.75;
  // 皮肤底色 + 脸颊的一点红
  g.fillStyle = o.skin;
  g.fillRect(0, 0, W, H);
  const cheek = g.createRadialGradient(fx, H * 0.58, 4, fx, H * 0.58, W * 0.14);
  cheek.addColorStop(0, 'rgba(190,90,70,0.12)');
  cheek.addColorStop(1, 'rgba(190,90,70,0)');
  g.fillStyle = cheek;
  g.fillRect(0, 0, W, H);
  // 下巴底下的阴影
  const jaw = g.createLinearGradient(0, H * 0.66, 0, H * 0.8);
  jaw.addColorStop(0, 'rgba(0,0,0,0)');
  jaw.addColorStop(1, 'rgba(60,30,20,0.35)');
  g.fillStyle = jaw;
  g.fillRect(0, H * 0.66, W, H * 0.34);
  // 耳朵（左右两侧 u=0.5、u=0/1）
  for (const ex of [W * 0.5, 0, W]) {
    g.fillStyle = shade(o.skin, 0.85);
    g.beginPath();
    g.ellipse(ex, H * 0.52, W * 0.025, H * 0.06, 0, 0, Math.PI * 2);
    g.fill();
  }
  // 头发：发际线 hl(x) 按离正脸的角距离从前额往后脑降低
  const circ = (x: number) => {
    let d = Math.abs(x - fx) / W;
    if (d > 0.5) d = 1 - d;
    return d; // 0 = 正前，0.25 = 耳侧，0.5 = 后脑
  };
  if (o.hairStyle !== 'none') {
    g.fillStyle = o.hair;
    g.beginPath();
    g.moveTo(0, 0);
    for (let x = 0; x <= W; x += 4) {
      const d = circ(x);
      let hl: number;
      if (o.hairStyle === 'bald') hl = d < 0.17 ? 0 : H * (0.44 + (d - 0.17) * 0.5);
      else if (o.hairStyle === 'long') hl = H * (0.3 + Math.min(1, d / 0.12) * 0.08 + Math.max(0, d - 0.15) * 1.1);
      else hl = H * (0.3 + Math.min(1, d / 0.14) * 0.1 + Math.max(0, d - 0.2) * 0.55);
      if (o.age === 'child' && o.hairStyle === 'short') hl += H * 0.03;
      g.lineTo(x, hl + range(r, -1.5, 1.5));
    }
    g.lineTo(W, 0);
    g.closePath();
    g.fill();
    if (o.hairStyle === 'bald') {
      // 秃顶：头顶一圈皮肤、两侧与后脑剩一圈
      g.fillStyle = o.skin;
      g.fillRect(0, 0, W, H * 0.36);
      g.fillStyle = o.hair;
      g.globalAlpha = 0.5;
      g.fillRect(0, H * 0.36, W, 2);
      g.globalAlpha = 1;
    }
    // 发丝
    g.strokeStyle = shade(o.hair, 0.7);
    g.lineWidth = 1;
    for (let i = 0; i < 160; i++) {
      const x = r() * W;
      const y = r() * H * 0.45;
      g.globalAlpha = 0.35;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + range(r, -3, 3), y + range(r, 4, 10));
      g.stroke();
    }
    g.globalAlpha = 1;
    if (o.female && o.hairStyle !== 'bald') {
      // 中分发缝
      g.strokeStyle = shade(o.skin, 0.9);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(fx, H * 0.08);
      g.lineTo(fx, H * 0.3);
      g.stroke();
    }
  }
  // 五官
  const eyeY = H * 0.5, eyeDx = W * 0.05;
  const browK = o.brows ?? (o.age === 'young' ? 1 : 0.8);
  // M4 第 2 轮：五官放大加粗（眼睛 ×1.3、眉眼嘴的笔画 ×1.6）——1× 取景器 3m 外头只有三十来个像素，原来的细线读不出来
  const EYE = 1.3, STROKE = 1.6;
  for (const sgn of [-1, 1]) {
    const ex = fx + sgn * eyeDx;
    // 眼窝阴影
    g.fillStyle = 'rgba(80,40,30,0.24)';
    g.beginPath();
    g.ellipse(ex, eyeY, W * 0.028 * EYE, H * 0.03 * EYE, 0, 0, Math.PI * 2);
    g.fill();
    // 眼白 + 瞳孔
    g.fillStyle = '#e9e2d6';
    g.beginPath();
    g.ellipse(ex, eyeY, W * 0.017 * EYE, H * 0.012 * EYE, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1a120e';
    g.beginPath();
    g.arc(ex, eyeY, H * 0.011 * EYE, 0, Math.PI * 2);
    g.fill();
    // 上眼皮一道深线（眼睛在暗处也有轮廓）
    g.strokeStyle = 'rgba(40,20,14,0.75)';
    g.lineWidth = 1.2 * STROKE;
    g.beginPath();
    g.ellipse(ex, eyeY, W * 0.018 * EYE, H * 0.014 * EYE, 0, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    // 眉
    g.strokeStyle = o.hairStyle === 'bald' ? o.hair : shade(o.hair, 0.8);
    g.lineWidth = 3 * browK * STROKE;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(ex - sgn * W * 0.02, eyeY - H * 0.05);
    g.quadraticCurveTo(ex, eyeY - H * 0.07, ex + sgn * W * 0.022, eyeY - H * 0.045);
    g.stroke();
    if (o.age === 'old') {
      // 眼袋与鱼尾纹
      g.strokeStyle = 'rgba(70,40,30,0.35)';
      g.lineWidth = 1 * STROKE;
      g.beginPath();
      g.moveTo(ex - W * 0.014, eyeY + H * 0.025);
      g.quadraticCurveTo(ex, eyeY + H * 0.035, ex + W * 0.014, eyeY + H * 0.025);
      g.moveTo(ex + sgn * W * 0.025, eyeY - H * 0.005);
      g.lineTo(ex + sgn * W * 0.035, eyeY - H * 0.015);
      g.moveTo(ex + sgn * W * 0.025, eyeY + H * 0.005);
      g.lineTo(ex + sgn * W * 0.035, eyeY + H * 0.01);
      g.stroke();
    }
  }
  // 鼻子：侧影 + 鼻翼
  g.strokeStyle = 'rgba(90,50,35,0.4)';
  g.lineWidth = 2 * STROKE;
  g.beginPath();
  g.moveTo(fx - W * 0.006, eyeY + H * 0.01);
  g.lineTo(fx - W * 0.01, eyeY + H * 0.1);
  g.stroke();
  g.fillStyle = 'rgba(70,35,25,0.45)';
  g.beginPath();
  g.ellipse(fx - W * 0.008, eyeY + H * 0.11, W * 0.006, H * 0.006, 0, 0, Math.PI * 2);
  g.ellipse(fx + W * 0.008, eyeY + H * 0.11, W * 0.006, H * 0.006, 0, 0, Math.PI * 2);
  g.fill();
  // 嘴
  const mouthY = H * 0.665;
  g.strokeStyle = o.female ? 'rgba(150,60,60,0.85)' : 'rgba(110,50,40,0.85)';
  g.lineWidth = 2.5 * STROKE;
  g.beginPath();
  g.moveTo(fx - W * 0.025, mouthY);
  g.quadraticCurveTo(fx, mouthY + (o.age === 'old' ? H * 0.006 : -H * 0.004), fx + W * 0.025, mouthY);
  g.stroke();
  if (o.age === 'old') {
    // 法令纹、抬头纹
    g.strokeStyle = 'rgba(70,40,30,0.3)';
    g.lineWidth = 1.5 * STROKE;
    for (const sgn of [-1, 1]) {
      g.beginPath();
      g.moveTo(fx + sgn * W * 0.02, eyeY + H * 0.09);
      g.quadraticCurveTo(fx + sgn * W * 0.035, mouthY - H * 0.02, fx + sgn * W * 0.03, mouthY + H * 0.03);
      g.stroke();
    }
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(fx - W * 0.04, H * (0.36 + i * 0.025));
      g.quadraticCurveTo(fx, H * (0.35 + i * 0.025), fx + W * 0.04, H * (0.36 + i * 0.025));
      g.stroke();
    }
  }
  const tex = canvasToTexture(canvas);
  tex.name = 'face';
  faceCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------- 模式材质

function modeMaterial(m: Exclude<HumanoidMaterialMode, 'standard'>, color: THREE.ColorRepresentation | undefined): THREE.Material {
  if (m === 'ghost') return MATERIALS.ghost(color ?? PALETTE.GHOST);
  if (m === 'replay') return MATERIALS.replay();
  const sil = new THREE.MeshBasicMaterial({ color: color ?? '#0b0d12' });
  sil.userData.rigOwned = true;
  return sil;
}

/** ShaderMaterial 的透明度：优先写 uniforms（opacity/uOpacity），同时写 material.opacity（ARCH 没定 uniform 名，见 engine-wp2.md）。 */
export function setMaterialOpacity(mat: THREE.Material, a: number): void {
  const base = (mat.userData.baseOpacity as number | undefined) ?? (mat.userData.baseOpacity = readOpacity(mat));
  const v = base * a;
  mat.opacity = v;
  const sm = mat as THREE.ShaderMaterial;
  if (sm.isShaderMaterial && sm.uniforms) {
    for (const k of ['opacity', 'uOpacity', 'uAlpha']) {
      const u = sm.uniforms[k];
      if (u && typeof u.value === 'number') u.value = v;
    }
    // 写深度的魂影部件（M4）：淡得差不多了就不再写深度（一个快看不见的人形不该还挡着后面的雨、灯晕）
    if (mat.userData.ghostDepth === true) mat.depthWrite = a > 0.3;
  }
  if (!sm.isShaderMaterial) {
    const fading = v < 0.999;
    if (mat.transparent !== (fading || mat.userData.baseTransparent === true)) {
      mat.transparent = fading || mat.userData.baseTransparent === true;
      mat.needsUpdate = true;
    }
    mat.depthWrite = !fading && mat.userData.baseDepthWrite !== false;
  }
}

function readOpacity(mat: THREE.Material): number {
  const sm = mat as THREE.ShaderMaterial;
  if (sm.isShaderMaterial && sm.uniforms) {
    for (const k of ['opacity', 'uOpacity', 'uAlpha']) {
      const u = sm.uniforms[k];
      if (u && typeof u.value === 'number') return u.value;
    }
  }
  mat.userData.baseTransparent = mat.transparent;
  mat.userData.baseDepthWrite = mat.depthWrite;
  return mat.opacity;
}

// ---------------------------------------------------------------- 工厂

export function createHumanoid(spec: HumanoidSpec): HumanoidRig {
  return createHumanoidInternal(spec);
}

/** 衣服贴图与特殊效果（WP2 内部）。 */
export interface HumanoidStyle {
  /** 躯干贴图（前胸 = 左半，后背 = 右半） */
  torsoMap?: THREE.Texture;
  /** 袖子贴图（碎花之类整件同花色时） */
  sleeveMap?: THREE.Texture;
  shoeMap?: THREE.Texture;
  /** 长袍（土地）的下摆与上身贴图 */
  robeMap?: THREE.Texture;
  /** 菲涅尔描边色（土地在取景器里的土地金描边） */
  rim?: THREE.ColorRepresentation;
  /** M4 第 2 轮：魂影的调校（陆师傅：多保留原色、魂色偏暖，门岗的绿光里不再是冷灰白） */
  ghost?: { baseAmt?: number; tint?: THREE.ColorRepresentation };
}

/**
 * 给 MeshStandardMaterial 加一圈菲涅尔自发光（描边）：视线掠过的边缘发 color 色的光。
 * 所有描边材质共用同一段着色器代码（customProgramCacheKey 固定），只多一个程序变体。
 */
export function addRim(mat: THREE.MeshStandardMaterial, color: THREE.ColorRepresentation, strength = 0.9): void {
  const uRim = { value: new THREE.Color(color).multiplyScalar(strength) };
  mat.userData.rimUniform = uRim;
  mat.onBeforeCompile = shader => {
    shader.uniforms.uRim = uRim;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += uRim * pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );');
  };
  mat.customProgramCacheKey = () => 'wp2.rim';
  mat.needsUpdate = true;
}

export function createHumanoidInternal(spec: HumanoidSpec, face?: FaceOpts, style?: HumanoidStyle): HumanoidInternal {
  const s = spec.height / 1.75;
  const build = BUILD[spec.build ?? 'normal'];
  const bw = build.w, bd = build.d;
  const skinColor = spec.skin ?? '#C99A78';
  const liveTemp = TEMP_C.alive;

  // 每个人偶自己的一套材质
  const owned = new Set<THREE.Material>();
  const own = <T extends THREE.Material>(m: T): T => {
    owned.add(m);
    m.userData.rigOwned = true;
    return m;
  };
  const shirt = own(newMat({ color: spec.shirt, roughness: 0.88, tempC: liveTemp }));
  const pants = own(newMat({ color: spec.pants, roughness: 0.9, tempC: liveTemp }));
  const shoes = own(newMat({ color: spec.shoes ?? '#16161a', roughness: 0.75, tempC: liveTemp }));
  shoes.userData.shoes = true;
  // M4：皮肤更哑（0.7 的高光加上主角的冷色轮廓光，像上了清漆的木棍）
  const skin = own(newMat({ color: skinColor, roughness: 0.85, tempC: liveTemp }));
  skin.userData.skin = true;
  const belt = own(newMat({ color: '#1b1714', roughness: 0.55, metalness: 0.1, tempC: liveTemp }));
  if (style?.shoeMap) {
    shoes.map = style.shoeMap;
    shoes.color.set(0xffffff);
  }
  const torsoMat = style?.torsoMap ? own(newMat({ color: 0xffffff, map: style.torsoMap, roughness: 0.88, tempC: liveTemp })) : shirt;
  const sleeveMat = style?.sleeveMap ? own(newMat({ color: 0xffffff, map: style.sleeveMap, roughness: 0.88, tempC: liveTemp })) : shirt;
  const robeMat = style?.robeMap ? own(newMat({ color: 0xffffff, map: style.robeMap, roughness: 0.92, tempC: liveTemp })) : shirt;

  const root = new THREE.Group();
  root.name = 'humanoid';
  // 会淡入淡出的人身（setOpacity 切 transparent 会换着色器变体）：warmupArea 据此把透明变体也预热一遍（M1d）
  root.userData.fadeCapable = true;
  const pivot = new THREE.Group();
  pivot.name = 'pivot';
  root.add(pivot);

  const J = {} as Record<JointName, THREE.Group>;
  for (const n of JOINT_NAMES) {
    J[n] = new THREE.Group();
    J[n].name = n;
  }
  const hipY = 0.95 * s;
  pivot.add(J.hips);
  J.hips.position.set(0, hipY, 0);
  J.hips.add(J.spine);
  J.spine.position.set(0, 0.1 * s, 0);
  J.spine.add(J.neck);
  J.neck.position.set(0, 0.45 * s, 0);
  J.neck.add(J.headSlot);
  const shoulderDrop = spec.build === 'hunch' ? 0.02 * s : 0;
  const shX = 0.195 * s * bw;
  J.spine.add(J.shoulderL, J.shoulderR);
  J.shoulderL.position.set(-shX, 0.378 * s - shoulderDrop, 0);
  J.shoulderR.position.set(shX, 0.378 * s - shoulderDrop, 0);
  J.shoulderL.add(J.elbowL);
  J.shoulderR.add(J.elbowR);
  J.elbowL.position.set(0, -0.29 * s, 0);
  J.elbowR.position.set(0, -0.29 * s, 0);
  const hipX = 0.095 * s * bw;
  J.hips.add(J.hipL, J.hipR);
  J.hipL.position.set(-hipX, -0.03 * s, 0);
  J.hipR.position.set(hipX, -0.03 * s, 0);
  J.hipL.add(J.kneeL);
  J.hipR.add(J.kneeR);
  J.kneeL.position.set(0, -0.43 * s, 0);
  J.kneeR.position.set(0, -0.43 * s, 0);

  const parts: Record<string, THREE.Mesh> = {};
  const bodyMeshes: THREE.Mesh[] = [];
  const addPart = (name: string, parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.userData.rigPart = true;
    parent.add(m);
    parts[name] = m;
    bodyMeshes.push(m);
    return m;
  };

  // 躯干与骨盆
  if (spec.robe) {
    // 长袍：胖子（土地）是 Lathe 圆肚，其余（新娘的旗袍式长裙）是普通上身
    addPart('torso', J.spine, spec.build === 'stout' ? bellyTorsoGeo(s, bw, 0.07) : torsoGeo(s, bw, bd, 0), robeMat);
    addPart('robe', J.hips, robeGeo(s, bw), robeMat);
  } else {
    addPart('torso', J.spine, torsoGeo(s, bw, bd, build.belly), torsoMat);
    addPart('pelvis', J.hips, pelvisGeo(s, bw, bd), pants);
    addPart('belt', J.hips, beltGeo(s, bw, bd), belt);
  }

  // 手臂：短袖 = 袖筒 + 裸臂；长袖 = 整条袖子（M4：去掉胶囊端头的“关节球”，肘部用同粗小球填缝，袖口有边）
  const armR = 0.043 * s;
  const long = spec.sleeves === 'long';
  const hemColor = new THREE.Color(spec.robe ? 0xffffff : spec.shirt).multiplyScalar(0.72);
  let hemMat: THREE.Material | null = null;
  const hem = (): THREE.Material => (hemMat ??= own(newMat({ color: hemColor, roughness: 0.9, tempC: liveTemp })));
  for (const side of ['L', 'R'] as const) {
    const sh = side === 'L' ? J.shoulderL : J.shoulderR;
    const el = side === 'L' ? J.elbowL : J.elbowR;
    const sl = spec.robe ? robeMat : sleeveMat;
    // 手：手掌 + 拇指，手心朝内（绕 y 转 ±0.25）
    const handRy = side === 'L' ? 0.25 : -0.25;
    if (long) {
      // M4 第 2 轮：上臂、肘球、前臂顶端同粗（armR × 1.15），站着时肘部不再有一道台阶
      addPart(`upperArm${side}`, sh, capsuleLimb(armR * 1.15, 0.31 * s), sl);
      // 前臂 + 肘部同料小球填缝（坐着屈肘时上臂与前臂之间不露缝），合成一个网格
      addPart(`forearm${side}`, el, mergedLimb(`fl2:${q(s)}:${q(armR)}`, [
        [limbGeo(armR * 1.15, armR * 1.04, 0.265 * s), 0, 0], [jointBallGeo(armR * 1.15), 0, 0],
      ]), sl);
      // 袖口一圈（手从袖口里伸出来，不再和袖子分开悬着）
      addPart(`cuff${side}`, el, bandGeo(armR * 1.07, armR * 1.07, 0.024 * s), spec.robe ? sl : hem()).position.y = -0.244 * s;
      addPart(`hand${side}`, el, handGeo(s, -0.29 * s), skin).rotation.y = handRy;
    } else {
      // 袖筒：圆肩 + 外撇的敞口筒，长到上臂中段；袖口压一道深色边
      addPart(`sleeve${side}`, sh, sleeveGeo(armR * 1.5, armR * 1.62, 0.21 * s), sl).position.y = 0.012 * s;
      addPart(`sleeveHem${side}`, sh, bandGeo(armR * 1.6, armR * 1.635, 0.02 * s), hem()).position.y = (0.012 - 0.195) * s;
      // 上臂顶端藏进袖筒；前臂与上臂在肘部重叠，肘部同粗小球填缝；前臂 + 肘球 + 手同是皮肤，合成一个网格
      addPart(`upperArm${side}`, sh, limbGeo(armR, armR * 0.9, 0.29 * s), skin).position.y = -0.04 * s;
      addPart(`forearm${side}`, el, mergedLimb(`fs:${q(s)}:${q(armR)}:${side}`, [
        [limbGeo(armR * 0.9, armR * 0.72, 0.26 * s), 0.015 * s, 0], [jointBallGeo(armR * 0.9), 0, 0], [handGeo(s, -0.265 * s), 0, handRy],
      ]), skin);
    }
  }

  // 腿（长袍时腿藏在下摆里；M4：长袍也建一截小腿，坐下时从袍摆下露出来接到鞋上，不再是两只漂着的鞋）
  for (const side of ['L', 'R'] as const) {
    const hp = side === 'L' ? J.hipL : J.hipR;
    const kn = side === 'L' ? J.kneeL : J.kneeR;
    if (!spec.robe) {
      addPart(`thigh${side}`, hp, limbGeo(0.086 * s * bw, 0.066 * s * bw, 0.44 * s), pants);
      // 小腿顶端上移盖住膝部的缝，膝部同粗小球填缝（弯腿时不露缝）；两块同料，合成一个网格
      addPart(`shin${side}`, kn, mergedLimb(`sh:${q(s)}:${q(bw)}`, [
        [limbGeo(0.063 * s * bw, 0.05 * s, 0.44 * s), 0.02 * s, 0], [jointBallGeo(0.064 * s * bw), 0, 0],
      ]), pants);
    } else {
      // 长袍：大腿用袍料（坐下时袍子搭在腿上、膝盖在袍摆前，小腿从膝下接到鞋上；站着时整个藏在袍子里）
      addPart(`thigh${side}`, hp, limbGeo(0.075 * s * bw, 0.068 * s * bw, 0.44 * s), robeMat);
      addPart(`knee${side}`, kn, jointBallGeo(0.068 * s * bw), robeMat);
      addPart(`shin${side}`, kn, limbGeo(0.055 * s, 0.048 * s, 0.42 * s), pants).position.y = 0.02 * s;
    }
    addPart(`shoe${side}`, kn, shoeGeo(0.1 * s, 0.075 * s, 0.26 * s, -0.455 * s, -0.19 * s), shoes);
  }

  // 头
  let headMesh: THREE.Object3D | null = null;
  if (spec.head === 'human') {
    addPart('neckSkin', J.neck, limbGeo(0.047 * s, 0.05 * s, 0.1 * s), skin).position.y = 0.08 * s;
    const f: FaceOpts = face ?? { skin: `#${new THREE.Color(skinColor).getHexString()}`, hair: '#1e1a17', hairStyle: 'short', age: 'old' };
    const faceMat = own(newMat({ color: 0xffffff, map: faceTexture(f), roughness: 0.8, tempC: liveTemp }));
    // M4 第 2 轮：头球 + 头发壳 + 耳朵 + 鼻子一个网格（humanHeadGeo）
    const head = addPart('head', J.headSlot, humanHeadGeo(0.1 * s, f), faceMat);
    head.position.set(0, 0.14 * s, -0.005 * s);
    headMesh = head;
  } else if (spec.head === 'weasel') {
    headMesh = weaselHead(s, own, addPart, J.headSlot);
  } else if (spec.head === 'camera') {
    const housing = own(newMat({ color: '#D9D4C7', roughness: 0.45, tempC: 28 }));
    const dark = own(newMat({ color: '#1a1b1f', roughness: 0.3, metalness: 0.5 }));
    const hb = addPart('head', J.headSlot, boxGeo(0.2 * s, 0.22 * s, 0.34 * s, 0.38 * s), housing);
    addPart('lens', J.headSlot, cached(`camlens:${q(s)}`, () => {
      const g = new THREE.CylinderGeometry(0.06 * s, 0.06 * s, 0.07 * s, 16);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0.35 * s, -0.2 * s);
      return g;
    }), dark);
    addPart('neckPole', J.neck, limbGeo(0.025 * s, 0.025 * s, 0.27 * s), dark).position.y = 0.27 * s;
    headMesh = hb;
  }

  if (style?.rim !== undefined) {
    for (const m of owned) if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) addRim(m as THREE.MeshStandardMaterial, style.rim);
  }

  // ------------------------------------------------ 状态
  const extraMeshes: THREE.Mesh[] = [];
  const keepMat = new WeakSet<THREE.Mesh>();
  let mode: HumanoidMaterialMode = 'standard';
  let modeColor: THREE.ColorRepresentation | undefined;
  let opacity = 1;
  const stdMat = new WeakMap<THREE.Mesh, THREE.Material>();
  const cur = new Map<JointName, THREE.Vector3>();
  const from = new Map<JointName, THREE.Vector3>();
  const to = new Map<JointName, THREE.Vector3>();
  for (const n of JOINT_NAMES) {
    cur.set(n, new THREE.Vector3());
    from.set(n, new THREE.Vector3());
    to.set(n, new THREE.Vector3());
  }
  let poseName: Pose = 'stand';
  let poseDef: PoseDef = POSES.stand;
  let blendT = 1, blendDur = 0.3;
  let dropFrom = 0, dropTo = 0, dropCur = 0;
  let rotFrom = 0, rotTo = 0, rotCur = 0;
  let phase = 0, walkW = 0, breathT = range(rng(Math.round(spec.height * 1000)), 0, 10);
  const hunchSpine = spec.build === 'hunch' ? -0.21 : 0;
  const hunchNeck = spec.build === 'hunch' ? 0.17 : 0;

  const allMeshes = (): THREE.Mesh[] => [...bodyMeshes, ...extraMeshes];

  /**
   * 魂影/回放材质（M4）：按原部件各建一份（本人偶私有，随人偶释放），带原件的贴图（碎花、中山装、脸）与底色，
   * 辨识道具（配件）更实一些；共用同一个着色器程序（只有 uniform 不同）。silhouette 仍用一份共享的纯黑材质。
   */
  const modeMats = new Map<string, THREE.Material>();
  const isFace = (mesh: THREE.Mesh): boolean => mesh === headMesh && spec.head === 'human';
  const modeMatFor = (m: Exclude<HumanoidMaterialMode, 'standard'>, color: THREE.ColorRepresentation | undefined, mesh: THREE.Mesh): THREE.Material => {
    if (m === 'silhouette') {
      const key = `sil|${color === undefined ? '' : new THREE.Color(color).getHexString()}`;
      let mat = modeMats.get(key);
      if (!mat) {
        mat = modeMaterial('silhouette', color);
        modeMats.set(key, mat);
      }
      return mat;
    }
    const src = stdMat.get(mesh) as THREE.MeshStandardMaterial | undefined;
    const accessory = extraMeshes.includes(mesh);
    const face = isFace(mesh);
    // 配件可以自己定实度（中山装的领子、口袋盖是衣服的一部分，不该比身子实）
    const solidOverride = typeof mesh.userData.ghostSolid === 'number' ? (mesh.userData.ghostSolid as number) : null;
    const colorKey = color === undefined ? '' : new THREE.Color(color).getHexString();
    const key = `${m}|${colorKey}|${src?.uuid ?? ''}|${accessory ? 'a' : ''}${face ? 'f' : ''}|${solidOverride ?? ''}`;
    let mat = modeMats.get(key);
    if (mat) return mat;
    const map = src?.map ?? null;
    const tune = m === 'ghost' ? style?.ghost : undefined;
    // M4 第 2 轮：脸（连头发、耳朵、鼻子）贴图调制 1.0、头部 uSolid 0.35——1× 取景器 3m 外五官仍可读；
    // 回放：衣服花色 0.85、原色 0.45、不透明度 0.75（原来 0.5/0.22/0.6，被扫描条纹一压看不出谁是谁）
    const replay = m === 'replay';
    const d: GhostDetail = {
      map,
      mapAmt: map ? (face ? 1 : replay ? 0.85 : 0.5) : 0,
      base: src?.color ?? 0xffffff,
      baseAmt: replay ? 0.45 : tune?.baseAmt ?? (face ? 0.3 : 0.36),
      solid: solidOverride ?? (accessory ? 1 : face ? 0.35 : 0),
      ...(replay ? { opacity: 0.75 } : {}),
    };
    const ghostColor = tune?.tint ?? color ?? PALETTE.GHOST;
    mat = own(m === 'ghost' ? createGhostMaterial(ghostColor, d) : createReplayMaterial(d));
    // 逐部件的魂影材质写深度，透明队列里由近到远画（core/render.ts ghostAwareTransparentSort）：只剩最外一层壳，不再 X 光透视
    mat.depthWrite = true;
    mat.userData.ghostDepth = true;
    // 与 MATERIALS.ghost/replay 同温（红外：魂影 6℃；回放人影与环境同温）
    mat.userData.tempC = m === 'ghost' ? TEMP_C.yin : TEMP_C.ambient;
    modeMats.set(key, mat);
    return mat;
  };

  /**
   * 魂影/回放的绘制顺序（M4）：部件统一放到 RENDER_ORDER.ghost/replay 这一档；逐部件材质写深度（ghostDepth），
   * 同一档里由近到远画（core/render.ts ghostAwareTransparentSort），于是只画最外一层壳——四肢、提篮、相机不再从躯干里透出来。
   * （第一版是给每个部件挂一个只写深度的预通道子网格，每个部件多一次 draw call，回放机位超出 250 的预算，改成排序。）
   */
  const baseOrder = new WeakMap<THREE.Mesh, number>();
  const syncPrepass = () => {
    const on = mode === 'ghost' || mode === 'replay';
    const order = mode === 'replay' ? RENDER_ORDER.replay : RENDER_ORDER.ghost;
    for (const mesh of allMeshes()) {
      if (keepMat.has(mesh)) continue;
      if (!on) {
        if (baseOrder.has(mesh)) mesh.renderOrder = baseOrder.get(mesh)!;
        continue;
      }
      if (!baseOrder.has(mesh)) baseOrder.set(mesh, mesh.renderOrder);
      mesh.renderOrder = Math.max(mesh.renderOrder, order);
    }
  };

  const applyMode = (m: HumanoidMaterialMode, color?: THREE.ColorRepresentation) => {
    mode = m;
    modeColor = color;
    for (const mesh of allMeshes()) {
      if (keepMat.has(mesh)) continue;
      if (!stdMat.has(mesh)) stdMat.set(mesh, mesh.material as THREE.Material);
      mesh.material = m === 'standard' ? (stdMat.get(mesh) as THREE.Material) : modeMatFor(m, color, mesh);
    }
    syncPrepass();
    if (opacity < 1) applyOpacity(opacity);
  };

  /** 淡出需要逐人偶的材质：共享材质（MATERIALS.ghost/replay、kitMat 配件）先克隆一份。 */
  const applyOpacity = (a: number) => {
    opacity = a;
    const clones = new Map<THREE.Material, THREE.Material>();
    for (const mesh of allMeshes()) {
      if (keepMat.has(mesh) && mesh.userData.fadeWithRig !== true) continue;
      let mat = mesh.material as THREE.Material;
      if (!owned.has(mat) && a < 1) {
        let c = clones.get(mat);
        if (!c) {
          c = own(mat.clone());
          clones.set(mat, c);
        }
        if (mode === 'standard' && stdMat.get(mesh) === mat) stdMat.set(mesh, c);
        mesh.material = c;
        mat = c;
      }
      setMaterialOpacity(mat, a);
    }
  };

  const setTargets = (p: Pose) => {
    poseName = p;
    poseDef = POSES[p];
    for (const n of JOINT_NAMES) {
      from.get(n)!.copy(cur.get(n)!);
      const t = poseDef.joints[n];
      to.get(n)!.set(t?.[0] ?? 0, t?.[1] ?? 0, t?.[2] ?? 0);
    }
    dropFrom = dropCur;
    dropTo = (poseDef.bodyDrop ?? 0) * s;
    rotFrom = rotCur;
    rotTo = poseDef.rootRotX ?? 0;
  };
  setTargets('stand');
  for (const n of JOINT_NAMES) cur.get(n)!.copy(to.get(n)!);

  const robe = parts.robe;
  const legsWalk = () => poseName !== 'sit' && poseName !== 'lie' && poseName !== 'crouch';
  const armsSwing = () => poseName === 'stand' || poseName === 'walk' || poseName === 'look_up';

  const apply = () => {
    const sw = Math.sin(phase), w = walkW;
    for (const n of JOINT_NAMES) {
      const c = cur.get(n)!;
      J[n].rotation.set(c.x, c.y, c.z);
    }
    if (w > 0 && legsWalk()) {
      J.hipL.rotation.x += 0.45 * sw * w;
      J.hipR.rotation.x -= 0.45 * sw * w;
      // 摆动相（脚离地往前送）屈膝：左腿摆动相在 phase ≈ -π/2 → π/2 之间，峰值在略早于 0 处
      J.kneeL.rotation.x -= (Math.max(0, Math.cos(phase + 0.53)) * 0.9 + 0.08) * w;
      J.kneeR.rotation.x -= (Math.max(0, Math.cos(phase + Math.PI + 0.53)) * 0.9 + 0.08) * w;
      if (armsSwing()) {
        J.shoulderL.rotation.x -= 0.35 * sw * w;
        J.shoulderR.rotation.x += 0.35 * sw * w;
        J.elbowL.rotation.x += 0.25 * w;
        J.elbowR.rotation.x += 0.25 * w;
      }
      J.spine.rotation.y += 0.06 * sw * w;
      J.hips.rotation.y -= 0.05 * sw * w;
    }
    // 呼吸（停着时明显一点）
    const br = Math.sin(breathT * 1.6) * (1 - w * 0.7);
    J.spine.rotation.x += hunchSpine + br * 0.012;
    J.neck.rotation.x += hunchNeck - br * 0.008;
    J.shoulderL.rotation.z -= br * 0.01;
    J.shoulderR.rotation.z += br * 0.01;
    const bob = -Math.abs(sw) * 0.03 * s * w + (w > 0 ? 0.015 * s * w : 0);
    J.hips.position.y = hipY - dropCur + bob;
    pivot.rotation.x = rotCur;
    // 躺下时把背抬到地面以上（身体绕脚底转 90° 后背会在 y<0）
    pivot.position.y = Math.sin(rotCur) * 0.12 * s * bd;
    if (robe) {
      // 长袍坐下时下摆压扁，不插进地里
      const k = hipY > 0 ? Math.max(0.35, (hipY - dropCur) / hipY) : 1;
      robe.scale.set(1 + (1 - k) * 0.4, k, 1 + (1 - k) * 0.6);
    }
  };
  apply();

  const rig: HumanoidInternal = {
    root,
    joints: J,
    height: spec.height,
    spec,
    s,
    parts,
    headMesh,
    get mode() { return mode; },
    get pose() { return poseName; },
    get walkPhase() { return phase; },
    get walkWeight() { return walkW; },
    setPose(p, blendSec = 0.3) {
      if (p === poseName && blendT >= 1) return;
      setTargets(p);
      blendDur = Math.max(0, blendSec);
      blendT = blendDur > 0 ? 0 : 1;
      if (blendT >= 1) {
        for (const n of JOINT_NAMES) cur.get(n)!.copy(to.get(n)!);
        dropCur = dropTo;
        rotCur = rotTo;
      }
      apply();
    },
    update(dt, speed) {
      breathT += dt;
      if (blendT < 1) {
        blendT = Math.min(1, blendT + dt / blendDur);
        const k = blendT * blendT * (3 - 2 * blendT);
        for (const n of JOINT_NAMES) cur.get(n)!.lerpVectors(from.get(n)!, to.get(n)!, k);
        dropCur = dropFrom + (dropTo - dropFrom) * k;
        rotCur = rotFrom + (rotTo - rotFrom) * k;
      }
      const moving = speed > 0.1;
      // 起步快、停步 0.2s 内收回（ARCH §5.1）
      walkW = moving ? Math.min(1, walkW + dt / 0.15) : Math.max(0, walkW - dt / 0.2);
      if (moving) {
        const stride = 0.75 * spec.height / 1.75;
        phase = (phase + (speed / stride) * dt * Math.PI) % (Math.PI * 2);
      } else if (walkW === 0) {
        // 停稳后把相位收回到双脚并拢的位置，下次起步从头开始
        phase = 0;
      }
      apply();
    },
    setMaterialMode(m, color) {
      applyMode(m, color);
    },
    setOpacity(a) {
      applyOpacity(Math.max(0, Math.min(1, a)));
    },
    bounds(target) {
      target.makeEmpty();
      root.updateWorldMatrix(true, true);
      const box = new THREE.Box3();
      root.traverseVisible(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.userData.noBounds) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        box.copy(m.geometry.boundingBox as THREE.Box3).applyMatrix4(m.matrixWorld);
        target.union(box);
      });
      return target;
    },
    dispose() {
      root.traverse(o => {
        const m = o as THREE.Mesh;
        const line = (o as THREE.Line).isLine === true || (o as THREE.Points).isPoints === true;
        if (!m.isMesh && !line) return;
        if (!cachedGeos.has(m.geometry) && !m.userData.sharedGeometry) m.geometry.dispose();
        // 线/点（黄鼬头的胡须 LineSegments）的材质不在 owned 里：自己建的在这里释放（M3，docs/requests/r4.md #5）
        if (line) for (const mat of ([] as THREE.Material[]).concat(m.material)) if (!owned.has(mat) && !isSharedMaterial(mat)) mat.dispose();
      });
      for (const m of owned) m.dispose();
      owned.clear();
      root.removeFromParent();
    },
    adopt(obj, o) {
      obj.traverse(c => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        extraMeshes.push(m);
        if (o?.keepMaterial) keepMat.add(m);
      });
      if (mode !== 'standard') applyMode(mode, modeColor);
      if (opacity < 1) applyOpacity(opacity);
    },
    setBodyVisible(v) {
      for (const m of bodyMeshes) m.visible = v;
    },
  };
  if (spec.material && spec.material !== 'standard') rig.setMaterialMode(spec.material);
  return rig;
}

/** 黄鼠狼头：Sphere 脑袋 + Cone 尖嘴 + 两只小耳朵 + 黑豆眼 + 白下巴与胡须（GDD §2.7）。 */
function weaselHead(
  s: number, own: <T extends THREE.Material>(m: T) => T,
  addPart: (name: string, parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material) => THREE.Mesh,
  slot: THREE.Group,
): THREE.Object3D {
  const fur = own(newMat({ color: '#B07A3A', roughness: 0.95, tempC: TEMP_C.huang }));
  const furLight = own(newMat({ color: '#EAD2A2', roughness: 0.95, tempC: TEMP_C.huang }));
  const eye = own(newMat({ color: '#050505', roughness: 0.15, metalness: 0.4, tempC: TEMP_C.huang }));
  addPart('neckFur', slot, limbGeo(0.05 * s, 0.055 * s, 0.1 * s), fur).position.y = 0.08 * s;
  const head = addPart('head', slot, cached(`wz:head:${q(s)}`, () => {
    const g = new THREE.SphereGeometry(0.085 * s, 14, 10);
    g.scale(0.92, 0.88, 1.1);
    return g;
  }), fur);
  head.position.set(0, 0.14 * s, 0);
  // 尖嘴：略微朝下
  const snout = addPart('snout', slot, cached(`wz:snout:${q(s)}`, () => {
    const g = new THREE.ConeGeometry(0.046 * s, 0.11 * s, 10);
    g.rotateX(-Math.PI / 2 - 0.25);
    return g;
  }), fur);
  snout.position.set(0, 0.118 * s, -0.115 * s);
  const chin = addPart('chin', slot, cached(`wz:chin:${q(s)}`, () => {
    const g = new THREE.SphereGeometry(0.042 * s, 10, 8);
    g.scale(1.1, 0.8, 1.2);
    return g;
  }), furLight);
  chin.position.set(0, 0.095 * s, -0.085 * s);
  const nose = addPart('nose', slot, cached(`wz:nose:${q(s)}`, () => new THREE.SphereGeometry(0.012 * s, 6, 5)), eye);
  nose.position.set(0, 0.105 * s, -0.172 * s);
  for (const sx of [-1, 1]) {
    // 耳朵往两边支出来（戴着破毡帽也看得见）
    const ear = addPart(`ear${sx}`, slot, cached(`wz:ear:${q(s)}`, () => new THREE.ConeGeometry(0.026 * s, 0.05 * s, 6)), fur);
    ear.position.set(sx * 0.078 * s, 0.19 * s, 0.01 * s);
    ear.rotation.z = -sx * 0.95;
    const e = addPart(`eye${sx}`, slot, cached(`wz:eye:${q(s)}`, () => new THREE.SphereGeometry(0.014 * s, 8, 6)), eye);
    e.position.set(sx * 0.043 * s, 0.168 * s, -0.078 * s);
  }
  // 胡须：两边各三根（1 像素线，近景细节，ARCH §16 #25）
  const pts: number[] = [];
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) pts.push(sx * 0.02 * s, 0.11 * s, -0.14 * s, sx * 0.11 * s, (0.1 + (i - 1) * 0.02) * s, -0.12 * s);
  }
  const whiskers = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: '#E8E0D0' }));
  whiskers.name = 'whiskers';
  slot.add(whiskers);
  return head;
}
