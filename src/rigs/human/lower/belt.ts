// owner: WP2
// char2 WP-L：腰带（衬衫塞进裤腰的裤子）与土地爷的布腰带（系在长袍外、前面打结垂两条带子）。
// 腰带不是贴在裤子外面的一圈：它就是那一段的外壳——上沿 = WAIST（与上衣对缝），下沿 = 裤子顶圈，中间凸出 3.5mm；
// 里面没有裤子（魂影只剩最外一层）。带扣是带子上的一块小凸板（同槽、order −1 先画）。

import * as THREE from 'three';
import { loftRings, setSkin, smooth01, snapRing } from '../shared';
import type { BuildCtx, SkinnedPiece } from '../types';
import { inflateRing, shiftRing, W } from './geom';

const N = 24;
/** fix1：土地的布腰带前面鼓出的量（×s）：腰带勒在酒桶肚上。 */
export const DEITY_SASH_BULGE = 0.072;

/** 腰带的一段外壳：WAIST → 下沿 bottom（同为 24 点圈）。thick = 外凸厚度。 */
export function bandGeo(ctx: BuildCtx, bottom: Float32Array, thick: number, frontBulge = 0): THREE.BufferGeometry {
  const s = ctx.s;
  const Wr = Float32Array.from(ctx.seams.WAIST.pos);
  const top1 = inflateRing(shiftRing(Wr, -0.0015 * s), thick);
  // fix1：土地的布腰带系在酒桶肚上：上沿前面往外鼓（腰带下沿 bottom 由调用方给，同样鼓出来）
  if (frontBulge > 0) {
    const c = ctx.seams.WAIST.centre;
    for (let i = 0; i < N; i++) {
      const dx = top1[i * 3]! - c[0], dz = top1[i * 3 + 2]! - c[2];
      const l = Math.hypot(dx, dz) || 1;
      const f = Math.max(0, -dz / l);
      top1[i * 3 + 2] = top1[i * 3 + 2]! - frontBulge * Math.pow(f, 1.6);
    }
  }
  const bot1 = inflateRing(shiftRing(bottom, 0.0015 * s), thick);
  // 上下沿各一道硬边（重复圈：零面积的带不贡献法线，所以两侧各用各的法线）
  const rings = [bottom, bot1, Float32Array.from(bot1), top1, Float32Array.from(top1), Wr];
  const geo = loftRings(rings, { v: [0, 0.05, 0.05, 0.95, 0.95, 1] });
  const yW = ctx.seams.WAIST.centre[1];
  setSkin(geo, p => {
    const sp = 0.35 * smooth01(yW - 0.05 * s, yW, p.y);
    return W([['hips', 1 - sp], ['spine', sp]]);
  });
  snapRing(geo, 5 * (N + 1), ctx.seams.WAIST, { dupSeam: true });
  return geo;
}

/** 带扣：前中一块圆角小板，厚 3mm，贴在带子外面。 */
function buckleGeo(ctx: BuildCtx, yC: number, zFront: number, w: number, h: number, depth: number): THREE.BufferGeometry {
  const s = ctx.s;
  const ex = new THREE.Vector3(1, 0, 0), ey = new THREE.Vector3(0, 1, 0);
  const mk = (z: number, inset: number) => {
    const out = new Float32Array(12 * 3);
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * Math.PI * 2;
      const c = Math.cos(t), sn = Math.sin(t);
      const x = Math.sign(c) * Math.pow(Math.abs(c), 0.35) * (w / 2 - inset);
      const y = Math.sign(sn) * Math.pow(Math.abs(sn), 0.35) * (h / 2 - inset);
      const p = new THREE.Vector3().addScaledVector(ex, x).addScaledVector(ey, y);
      out.set([p.x, yC + p.y, z], i * 3);
    }
    return out;
  };
  const z0 = zFront + 0.003 * s, z1 = zFront - depth * 0.7, z2 = zFront - depth;
  const geo = loftRings([mk(z0, 0), mk(z1, 0), mk(z2, 0.002 * s)], { capEnd: [0, yC, z2] });
  setSkin(geo, () => W([['hips', 1]]));
  return geo;
}

/** 皮带（裤子用）：返回带子与带扣两个部件，以及裤子顶圈应在的骨盆比例 topFrac。 */
export function buildBelt(ctx: BuildCtx, bottom: Float32Array): SkinnedPiece[] {
  const s = ctx.s;
  const thick = 0.0035 * s;
  const band = ctx.track(bandGeo(ctx, bottom, thick));
  const yW = ctx.seams.WAIST.centre[1];
  const yB = bottom[1]!;
  const zFront = ctx.seams.WAIST.pos[6 * 3 + 2]! - thick;
  const buckle = ctx.track(buckleGeo(ctx, (yW + yB) / 2, zFront, 0.05 * s, (yW - yB) * 1.02, 0.0035 * s));
  return [
    { kind: 'skinned', name: 'beltBand', slot: 'belt', geo: band, weld: false },
    { kind: 'skinned', name: 'beltBuckle', slot: 'belt', geo: buckle, order: -1, weld: false },
  ];
}

/** 布腰带（土地）：WAIST 往下 5cm 的一圈厚布带 + 左前的结与两条垂带。bottom = 带子下沿那圈（也是长袍顶圈）。 */
export function buildSash(ctx: BuildCtx, bottom: Float32Array): SkinnedPiece[] {
  const s = ctx.s;
  const band = ctx.track(bandGeo(ctx, bottom, 0.006 * s, ctx.profile.deity ? DEITY_SASH_BULGE * 0.92 * s : 0));
  // 结：左前（人物自己的左 = −x）一个扁圆疙瘩
  const yW = ctx.seams.WAIST.centre[1], yB = bottom[1]!;
  const yc = (yW + yB) / 2;
  const at = 6 + 2; // 偏左前（下标往 −x 走）
  const kx = bottom[at * 3]!, kz = bottom[at * 3 + 2]!;
  const dir = new THREE.Vector3(kx - ctx.seams.WAIST.centre[0], 0, kz - ctx.seams.WAIST.centre[2]).normalize();
  const knotC: [number, number, number] = [kx + dir.x * 0.012 * s, yc, kz + dir.z * 0.012 * s];
  const kr = 0.024 * s;
  const knot = ctx.track(knotGeo(knotC, dir, kr, s));
  // 两条垂带：从结下面垂下来，前后错开、长短不一
  const tails = [[0.15, 0.2, 0.004], [0.115, -0.25, -0.006]].map(([len, tilt, off]) => ctx.track(tailGeo(knotC, dir, len! * s, tilt!, off! * s, s)));
  const weightAll = (g: THREE.BufferGeometry) => setSkin(g, () => W([['hips', 1]]));
  weightAll(knot);
  for (const t of tails) {
    setSkin(t, p => {
      const k = 0.25 * smooth01(yc, yc - 0.15 * s, p.y);
      return W([['hips', 1 - k], ['hipL', k]]);
    });
  }
  return [
    { kind: 'skinned', name: 'sashBand', slot: 'belt', geo: band, weld: false },
    { kind: 'skinned', name: 'sashKnot', slot: 'belt', geo: knot, order: -1, weld: false },
    ...tails.map((g, i) => ({ kind: 'skinned' as const, name: `sashTail${i}`, slot: 'belt' as const, geo: g, weld: false })),
  ];
}

/** 结：沿 dir（朝外）的扁椭球，竖直方向略长。 */
function knotGeo(c: [number, number, number], dir: THREE.Vector3, r: number, s: number): THREE.BufferGeometry {
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const up = new THREE.Vector3(0, 1, 0);
  const rings: Float32Array[] = [];
  const M = 6, K = 10;
  for (let j = 1; j < M; j++) {
    const ph = (j / M) * Math.PI;
    const along = -Math.cos(ph) * r * 0.55;
    const rr = Math.sin(ph);
    const ring = new Float32Array(K * 3);
    for (let i = 0; i < K; i++) {
      const t = (i / K) * Math.PI * 2;
      const p = new THREE.Vector3(...c).addScaledVector(dir, along).addScaledVector(side, Math.cos(t) * rr * r).addScaledVector(up, Math.sin(t) * rr * r * 1.15);
      ring.set([p.x, p.y, p.z], i * 3);
    }
    rings.push(ring);
  }
  const p0 = new THREE.Vector3(...c).addScaledVector(dir, -r * 0.55), p1 = new THREE.Vector3(...c).addScaledVector(dir, r * 0.55);
  void s;
  return loftRings(rings, { capStart: [p0.x, p0.y, p0.z], capEnd: [p1.x, p1.y, p1.z] });
}

/** 垂带：扁的布条（宽 3.5cm、厚 6mm），从结往下垂、末端略外摆。 */
function tailGeo(c: [number, number, number], dir: THREE.Vector3, len: number, tilt: number, off: number, s: number): THREE.BufferGeometry {
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const rings: Float32Array[] = [];
  const K = 8, M = 7;
  for (let j = 0; j < M; j++) {
    const t = j / (M - 1);
    const w = (0.034 - 0.006 * t) * s / 2, th = 0.003 * s;
    const ctr = new THREE.Vector3(...c)
      .addScaledVector(dir, 0.006 * s + 0.01 * s * t * t)
      .addScaledVector(side, off + Math.sin(tilt) * len * t)
      .add(new THREE.Vector3(0, -0.012 * s - len * t, 0));
    const ring = new Float32Array(K * 3);
    for (let i = 0; i < K; i++) {
      const a = (i / K) * Math.PI * 2;
      const p = ctr.clone().addScaledVector(side, Math.cos(a) * w).addScaledVector(dir, Math.sin(a) * th);
      ring.set([p.x, p.y, p.z], i * 3);
    }
    rings.push(ring);
  }
  const end = rings[M - 1]!;
  let ex = 0, ey = 0, ez = 0;
  for (let i = 0; i < K; i++) { ex += end[i * 3]!; ey += end[i * 3 + 1]!; ez += end[i * 3 + 2]!; }
  const capEnd: [number, number, number] = [ex / K, ey / K - 0.002 * s, ez / K];
  const st = rings[0]!;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < K; i++) { sx += st[i * 3]!; sy += st[i * 3 + 1]!; sz += st[i * 3 + 2]!; }
  return loftRings(rings, { capStart: [sx / K, sy / K, sz / K], capEnd });
}
