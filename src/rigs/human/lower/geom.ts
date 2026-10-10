// owner: WP2
// char2 WP-L：下身各部件共用的小工具——左右对称的圈、超椭圆截面、硬边（重复圈）、按位置的蒙皮、几何体检。只在 lower/ 内用。

import * as THREE from 'three';
import { boneIndex } from '../profile';
import { sgnPow } from '../shared';
import type { BoneName, BuildCtx, GarmentSpec } from '../types';

export type V3 = [number, number, number];

/**
 * 水平截面的一圈（count 点，同接缝约定：t = 2πi/count，顶点 0 在 +x、往 −z（前）走）。
 * 前后深度不同（bf 前 / bb 后），exp = 超椭圆指数（2 椭圆、3 圆角方）；belly = 前面再鼓出的比例（与 SEAMS/LoftRow.front 同式）。
 */
export function asymRing(cx: number, y: number, cz: number, a: number, bf: number, bb: number, count: number, exp = 2.4, belly = 0): Float32Array {
  const e = 2 / exp;
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const c = sgnPow(Math.cos(t), e), sn = sgnPow(Math.sin(t), e);
    let z = sn > 0 ? -sn * bf : -sn * bb;
    if (sn > 0 && belly) z *= 1 + belly * sn * sn * Math.pow(Math.max(0, 1 - Math.abs(c)), 0.5);
    out[i * 3] = cx + c * a;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = cz + z;
  }
  return out;
}

/** 圈里第 i 个点。 */
export function ringPt(r: ArrayLike<number>, i: number): V3 {
  return [r[i * 3]!, r[i * 3 + 1]!, r[i * 3 + 2]!];
}

/** 两圈按 k 线性插值（同点数）。 */
export function lerpRing(a: ArrayLike<number>, b: ArrayLike<number>, k: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! + (b[i]! - a[i]!) * k;
  return out;
}

/** 圈沿各点“离圈心的水平方向”外推 d（水平法线近似）。 */
export function inflateRing(r: Float32Array, d: number | ((i: number) => number)): Float32Array {
  const n = r.length / 3;
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += r[i * 3]!; cz += r[i * 3 + 2]!; }
  cx /= n; cz /= n;
  const out = Float32Array.from(r);
  for (let i = 0; i < n; i++) {
    const dx = r[i * 3]! - cx, dz = r[i * 3 + 2]! - cz;
    const l = Math.hypot(dx, dz) || 1;
    const k = typeof d === 'number' ? d : d(i);
    out[i * 3] = r[i * 3]! + (dx / l) * k;
    out[i * 3 + 2] = r[i * 3 + 2]! + (dz / l) * k;
  }
  return out;
}

/** 圈整体平移 dy。 */
export function shiftRing(r: Float32Array, dy: number): Float32Array {
  const out = Float32Array.from(r);
  for (let i = 1; i < out.length; i += 3) out[i] = out[i]! + dy;
  return out;
}

/** 关于 x = 0 的镜像（左腿/左脚由右边镜像；镜像后绕向反了，loftRings 的 auto 定向会翻回来）。 */
export function mirrorX(r: Float32Array): Float32Array {
  const out = Float32Array.from(r);
  for (let i = 0; i < out.length; i += 3) out[i] = -out[i]!;
  return out;
}

/** 蒙皮：[骨名, 权重] → setSkin 用的 [下标, 权重]。 */
export function W(list: readonly (readonly [BoneName, number])[]): [number, number][] {
  return list.filter(([, w]) => w > 1e-6).map(([b, w]) => [boneIndex(b), w]);
}

/** 平滑插值表：xs 递增，ys 同长；单调三次（Catmull-Rom 截断）近似，越界夹住。 */
export function table(xs: readonly number[], ys: readonly number[]): (x: number) => number {
  return (x: number) => {
    if (x <= xs[0]!) return ys[0]!;
    const n = xs.length;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]!) i++;
    const t = (x - xs[i]!) / (xs[i + 1]! - xs[i]!);
    const y0 = ys[Math.max(0, i - 1)]!, y1 = ys[i]!, y2 = ys[i + 1]!, y3 = ys[Math.min(n - 1, i + 2)]!;
    // Catmull-Rom，再夹在 y1..y2 之间（不过冲）
    const t2 = t * t, t3 = t2 * t;
    const v = 0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3);
    return Math.min(Math.max(y1, y2), Math.max(Math.min(y1, y2), v));
  };
}

/** 下身款式：ctx.garment 是 garmentOf 补全的；WP-C 还没给 style.garment 时按角色外观推一个合理的缺省（只在 lower/ 内用）。 */
export interface LowerStyle {
  bottom: GarmentSpec['bottom'];
  shoes: GarmentSpec['shoes'];
  /** 系皮带（衬衫塞进裤腰的裤子） */
  belt: boolean;
  /** 裤脚翻边 4cm */
  turnup: boolean;
  /** 裤线（前片中线的折痕） */
  crease: boolean;
  /** 膝盖鼓包（拾荒老汉的旧棉裤） */
  baggyKnee: boolean;
  /** 膝盖补丁（工人） */
  kneePatch: boolean;
}

export function lowerStyleOf(ctx: BuildCtx): LowerStyle {
  const g = ctx.garment, given = ctx.style?.garment ?? {};
  const female = ctx.profile.sex === 'f' && ctx.profile.age !== 'child';
  const bottom: GarmentSpec['bottom'] = given.bottom ?? (ctx.spec.robe ? (female ? 'qipao_skirt' : 'robe') : g.bottom);
  let shoes: GarmentSpec['shoes'] = given.shoes ?? g.shoes;
  if (given.shoes === undefined) {
    const lum = new THREE.Color(ctx.spec.shoes ?? '#16161a').getHSL({ h: 0, s: 0, l: 0 }).l;
    if (ctx.style?.shoeMap) shoes = 'cloth';
    else if (bottom === 'qipao_skirt') shoes = 'embroidered';
    else if (ctx.spec.robe) shoes = 'cloth';
    else if (lum > 0.6 || ctx.profile.age === 'child') shoes = 'sneaker';
    else if (ctx.profile.build === 'stout' && ctx.profile.age !== 'old') shoes = 'boot';
    else if (ctx.profile.build === 'hunch' || female) shoes = 'cloth';
    else shoes = 'leather';
  }
  const trousers = bottom === 'trousers' || bottom === 'work_trousers';
  const topPadded = g.top === 'cotton_padded' || (given.top === undefined && ctx.profile.build === 'hunch' && ctx.profile.age === 'old' && !ctx.style?.torsoMap);
  return {
    bottom, shoes,
    belt: trousers && g.tucked !== false && (g.hemDrop ?? 0) <= 0 && ctx.profile.age !== 'child',
    turnup: trousers && g.cuffs === 'turnup' && given.cuffs !== undefined,
    crease: trousers && !topPadded && ctx.profile.age !== 'child' && (bottom === 'work_trousers' || shoes === 'leather' || shoes === 'cloth' || shoes === 'boot'),
    baggyKnee: trousers && topPadded,
    kneePatch: trousers && shoes === 'boot',
  };
}

/** 几何体检（开发自测用）：法线朝外比例（绕给定竖轴）。 */
export function outwardFraction(geo: THREE.BufferGeometry, axisX = 0, axisZ = 0, pick?: (p: THREE.Vector3) => boolean): number {
  const pos = geo.attributes.position as THREE.BufferAttribute, nor = geo.attributes.normal as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  let n = 0, good = 0;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    if (pick && !pick(p)) continue;
    const rx = p.x - axisX, rz = p.z - axisZ;
    if (Math.hypot(rx, rz) < 1e-3) continue;
    n++;
    if (rx * nor.getX(i) + rz * nor.getZ(i) > 0) good++;
  }
  return n ? good / n : 1;
}
