// owner: WP2
// char2 区域：下身（WP-L）——裤子（骨盆 → 裆 → 两条裤腿 → 裤脚，一整片蒙皮）、皮带、鞋、长袍/旗袍裙与坐姿下摆。
// 冻结接口：buildLower(ctx)、REGION_LEGACY。设计见 test-artifacts/work/char2/PLAN.md §3.3；各部件见同目录：
//   trousers.ts 裤子、shoes.ts 鞋、belt.ts 皮带与布腰带、robe.ts 长袍/裙与坐姿形、geom.ts 公用小工具与下身款式（lowerStyleOf）。
// 网格（draw call）：裤装 = pants + shoes + belt（≤ 3）；长袍 = robe（own，坐姿时 CPU 改顶点）+ shoes + belt（土地的布腰带）。
// 上身还是 WP0 旧版构建器时（upper/ 的 REGION_LEGACY），旧躯干的下沿在 spine 关节（hips + 0.10s）、比 WAIST 高 7.5cm：
// 这里补一圈“过渡腰”盖住缝（legacyBridge，自己一个网格），上身换成新构建器后自动不建。

import * as THREE from 'three';
import { REGION_LEGACY as UPPER_LEGACY } from '../upper';
import { loftRings, setSkin, snapRing } from '../shared';
import type { BuildCtx, RegionResult, SkinnedPiece } from '../types';
import { buildBelt, buildSash } from './belt';
import { asymRing, inflateRing, lowerStyleOf, W } from './geom';
import { buildRobe } from './robe';
import { buildShoes } from './shoes';
import { buildTrousers, legFrame } from './trousers';

/** false：下身已是 char2 构建器（按 ctx.layout/land/seams 建），全部人偶用 profile 的关节布局。 */
export const REGION_LEGACY = false;

export function buildLower(ctx: BuildCtx): RegionResult {
  const st = lowerStyleOf(ctx);
  const s = ctx.s;
  const parts: SkinnedPiece[] = [];
  let update: RegionResult['update'];
  const W0 = ctx.seams.WAIST;
  const c = W0.centre;
  const robeLike = st.bottom === 'robe' || st.bottom === 'qipao_skirt';
  if (robeLike) {
    let top24: Float32Array = Float32Array.from(W0.pos);
    if (st.bottom === 'robe') {
      // 布腰带：WAIST 往下 5cm；长袍从带子下沿开始
      const aW = W0.pos[0]! - c[0], bW = W0.pos[18 * 3 + 2]! - c[2], bellyW = (c[2] - W0.pos[6 * 3 + 2]!) / bW - 1;
      top24 = asymRing(c[0], c[1] - 0.05 * s, c[2], aW * 1.03, bW * 1.03, bW * 1.04, 24, 2.9, bellyW * 1.05);
      parts.push(...buildSash(ctx, top24));
    }
    const robe = buildRobe(ctx, st, top24);
    parts.push(robe.piece);
    update = robe.update;
  } else if (st.belt) {
    const fr = legFrame(ctx);
    const beltH = 0.036 * s;
    const tr = buildTrousers(ctx, st, beltH / (c[1] - fr.ySplit));
    // 裤子顶圈 = 皮带下沿
    parts.push(tr, ...buildBelt(ctx, ringAtY(tr.geo, c[1] - beltH)));
  } else {
    parts.push(buildTrousers(ctx, st, 0));
  }
  parts.push(...buildShoes(ctx, st.shoes));
  if (UPPER_LEGACY) parts.push(legacyBridge(ctx, robeLike ? 'robe' : 'torso'));
  return { parts, ...(update ? { update } : {}) };
}

/** 几何里 y ≈ yRow 的那一圈 24 点（loftRings 布局，每行 25 点）。 */
function ringAtY(geo: THREE.BufferGeometry, yRow: number): Float32Array {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const N = 24, Wd = N + 1;
  for (let j = 0; j * Wd < pos.count; j++) {
    if (Math.abs(pos.getY(j * Wd) - yRow) < 1e-5) {
      const out = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) out.set([pos.getX(j * Wd + i), pos.getY(j * Wd + i), pos.getZ(j * Wd + i)], i * 3);
      return out;
    }
  }
  throw new Error(`lower: no trouser ring at y ${yRow.toFixed(4)}`);
}

/** 旧版上身的过渡腰：WAIST → 旧躯干下沿（spine 关节高，半宽 0.162s·bw、半深 0.104s·bd）再往上 1.2cm，外沿略大，盖住缝。 */
function legacyBridge(ctx: BuildCtx, slot: 'torso' | 'robe'): SkinnedPiece {
  const s = ctx.s, c = ctx.seams.WAIST.centre;
  const bw = ctx.build.w, bd = ctx.build.d, belly = ctx.build.belly;
  const ySp = ctx.layout.bind.spine[1];
  const W0 = Float32Array.from(ctx.seams.WAIST.pos);
  const ring = (y: number) => asymRing(c[0], y, c[2], 0.167 * s * bw, 0.109 * s * bd + belly * s * 0.6, 0.109 * s * bd, 24, 3);
  const geo = ctx.track(loftRings([W0, inflateRing(ring((ySp + c[1]) / 2), 0.001 * s), ring(ySp + 0.012 * s)], { capEnd: [c[0], ySp + 0.012 * s, c[2]] }));
  setSkin(geo, p => W([['hips', 0.65 - 0.15 * Math.min(1, Math.max(0, (p.y - c[1]) / (ySp - c[1])))], ['spine', 0.35 + 0.15 * Math.min(1, Math.max(0, (p.y - c[1]) / (ySp - c[1])))]]));
  snapRing(geo, 0, ctx.seams.WAIST, { dupSeam: true });
  return { kind: 'skinned', name: 'legacyBridge', slot, geo, own: true, weld: false };
}
