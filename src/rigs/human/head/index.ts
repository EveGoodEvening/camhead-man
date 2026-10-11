// owner: WP2
// char2 区域：头、脸、头发、黄鼬头（WP-H）。冻结接口：buildHead(ctx)、faceTexture(o)；头网格必须是 headSlot 下名为 'head' 的一个网格。
// char2 WP-H：雕出来的头（shape.ts）、人头贴图（paint.ts）、黄鼬头（weasel.ts）、贴片 headShell（shell.ts）；角度映射见 mapping.ts。

import * as THREE from 'three';
import { limbGeo, cached, q } from '../shared';
import { seamLocal } from '../profile';
import { newMat } from '../../../kit/geom';
import type { BuildCtx, ExtraObject, FaceOpts, RegionResult, RigidPart } from '../types';
import { HEAD_ORIGIN } from './mapping';
import { headParams } from './params';
import { buildHeadMesh, headSurface, toGeometry } from './shape';
import { weaselMaterial, weaselMesh, whiskerPositions } from './weasel';

export { faceTexture, paintOf } from './paint';
export { headShell, type HeadShellOpts } from './shell';
export { headParams, PRESET_SCULPT } from './params';

/**
 * true = 旧版构建器（按成年人关节写死）。char2 WP-H 起头部按 ctx.land/ctx.seams 建（儿童、土地的头随 profile 的关节布局走），所以是 false。
 */
export const REGION_LEGACY = false;

// ---------------------------------------------------------------- 人头

const headCache = new Map<string, THREE.BufferGeometry>();
/** 缓存上限：命名角色的身高都在 1cm 的格子上、组合有限；随机身高（邻居、小孩）的每人一份、随人偶释放。 */
const HEAD_CACHE_MAX = 96;

/** 人头几何（头网格局部：headSlot 局部 − 头网格位置）。底圈 = ctx.seams.NECK_TOP。 */
function humanHeadGeo(ctx: BuildCtx, f: FaceOpts): THREE.BufferGeometry {
  const k = ctx.land.head.scale;
  const ring = ctx.seams.NECK_TOP;
  const local = seamLocal(ring);
  const hp = headParams(f);
  const key = `head2:${ctx.spec.height}:${k.toFixed(5)}:${ctx.profile.sex}:${ctx.profile.age}:${hp.preset}:${hp.hair}:${JSON.stringify(hp.sc)}`;
  const onGrid = Math.abs(ctx.spec.height * 100 - Math.round(ctx.spec.height * 100)) < 1e-6;
  const hit = headCache.get(key);
  if (hit) return hit;
  const seamU = { count: ring.count, pos: local.map(v => v / k), nor: ring.nor };
  const geo = toGeometry(buildHeadMesh(headSurface(hp), seamU), k, local, ring.nor);
  if (onGrid && headCache.size < HEAD_CACHE_MAX) {
    headCache.set(key, geo);
    return cached(key, () => geo);
  }
  return ctx.track(geo);
}

// ---------------------------------------------------------------- 黄鼬头、摄像头人偶

/** 黄鼬头（GDD §2.7）：一整块毛皮网格 'head'（从 NECK_TOP 起），胡须是 LineSegments（红外下隐藏）。 */
export function weaselHead(ctx: BuildCtx): { parts: RigidPart[]; extras: ExtraObject[] } {
  const k = ctx.land.head.scale;
  const ring = ctx.seams.NECK_TOP;
  const local = seamLocal(ring);
  const geo = cached(`wz2:${q(k)}:${ctx.profile.sex}:${ctx.profile.age}`, () => {
    const m = weaselMesh({ count: ring.count, pos: local.map(v => v / k), nor: ring.nor });
    return toGeometry(m, k, local, ring.nor);
  });
  const pos = [0, HEAD_ORIGIN[1] * k, HEAD_ORIGIN[2] * k] as [number, number, number];
  const parts: RigidPart[] = [{ kind: 'rigid', name: 'head', joint: 'headSlot', geo, slot: weaselMaterial(), position: pos }];
  const wp = whiskerPositions().map((v, i) => (v - (i % 3 === 1 ? HEAD_ORIGIN[1] : i % 3 === 2 ? HEAD_ORIGIN[2] : 0)) * k);
  const whiskers = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)), new THREE.LineBasicMaterial({ color: '#8E897F', transparent: true, opacity: 0.42 }));
  whiskers.name = 'whiskers';
  whiskers.position.set(pos[0], pos[1], pos[2]);
  whiskers.raycast = () => {};
  return { parts, extras: [{ joint: 'headSlot', object: whiskers }] };
}

function boxGeo(w: number, h: number, d: number, cy: number, cz = 0): THREE.BufferGeometry {
  return cached(`box:${q(w)}:${q(h)}:${q(d)}:${q(cy)}:${q(cz)}`, () => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, cy, cz);
    return g;
  });
}

/** 摄像头人偶的方盒头（createHumanoid({head:'camera'})，主角模型另有 cameraHead.ts）。 */
function cameraHeadParts(s: number): RigidPart[] {
  const housing = newMat({ color: '#D9D4C7', roughness: 0.45, tempC: 28 });
  const dark = newMat({ color: '#1a1b1f', roughness: 0.3, metalness: 0.5 });
  return [
    { kind: 'rigid', name: 'head', joint: 'headSlot', geo: boxGeo(0.2 * s, 0.22 * s, 0.34 * s, 0.38 * s), slot: housing },
    {
      kind: 'rigid', name: 'lens', joint: 'headSlot', slot: dark, geo: cached(`camlens:${q(s)}`, () => {
        const g = new THREE.CylinderGeometry(0.06 * s, 0.06 * s, 0.07 * s, 16);
        g.rotateX(Math.PI / 2);
        g.translate(0, 0.35 * s, -0.2 * s);
        return g;
      }),
    },
    { kind: 'rigid', name: 'neckPole', joint: 'neck', geo: limbGeo(0.025 * s, 0.025 * s, 0.27 * s), slot: dark, position: [0, 0.27 * s, 0] },
  ];
}

/**
 * 头部构建器：spec.head 'human'（雕出来的人头，face 槽材质 = 人头贴图）、'weasel'（黄鼬头）、'camera'（方盒头）、'none'（空）。
 * 头网格名为 'head'、挂在 headSlot 下（npc.markerAnchor、R1 的贴片、maskZhouFace 都靠它），底圈正好是 NECK_TOP。
 */
export function buildHead(ctx: BuildCtx): RegionResult {
  const { spec, s } = ctx;
  if (spec.head === 'human') {
    const f = ctx.face as FaceOpts;
    const k = ctx.land.head.scale;
    return { parts: [{ kind: 'rigid', name: 'head', joint: 'headSlot', geo: humanHeadGeo(ctx, f), slot: 'face', position: [0, HEAD_ORIGIN[1] * k, HEAD_ORIGIN[2] * k] }] };
  }
  if (spec.head === 'weasel') return weaselHead(ctx);
  if (spec.head === 'camera') return { parts: cameraHeadParts(s) };
  return { parts: [] };
}
