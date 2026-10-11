// owner: WP2
// char2 区域：上身（WP-U）——躯干、脖子、肩、胳膊、手、衬衫款式。冻结接口：buildUpper(ctx)、torsoSurface(h, u, y)、REGION_LEGACY。
// 一整张蒙皮的壳：WAIST 接缝 →（下摆）→ 腰、胸 → 袖窿长出胳膊（衣袖就是这张皮）→ 手；肩上披肩 → 领根 → 脖子 → NECK_TOP 接缝。
// 部件：torso（衬衫；贴在上面的门襟、口袋、扣子在索引前面）、sleeves、skin（脖子、手、短袖下的胳膊、V 领里），
// 领子自己一个网格 'collar'；长袍上衣（robe_top）的躯干、袖子用袍料，各自 own（不和下身的 'robe' 网格重名）。
// 文件：dims.ts（尺寸、躯干外形）、torso.ts、arm.ts、hand.ts、garment.ts（领子、贴面）、mesh.ts（拼装器）。

import * as THREE from 'three';
import { SEAMS, boneIndex, garmentOf, jointLayout } from '../profile';
import type { BuildCtx, HumanoidInternal, RegionResult, SkinnedPiece } from '../types';
import { buildArm } from './arm';
import { hOf, neckBasePoint, torsoFrame, upperDims } from './dims';
import { buildCollar, buildOverlays, buildRobeCollar, TorsoSurface } from './garment';
import { MeshBuilder, toPiece, type Skin } from './mesh';
import { buildTorso } from './torso';

/**
 * true = 旧版构建器（按成年人关节写死）。char2 WP-U 起是新构建器（按 ctx.layout/ctx.land/ctx.seams 建）：false。
 * 只要有一个区域是 false，全部人偶就用 profile 的关节布局（profile.ts jointLayout）。
 */
export const REGION_LEGACY = false;

/** 右 → 左的骨头。 */
const MIRROR_BONE: Record<number, number> = {};
for (const [r, l] of [['shoulderR', 'shoulderL'], ['elbowR', 'elbowL'], ['wristR', 'wristL'], ['hipR', 'hipL'], ['kneeR', 'kneeL'], ['ankleR', 'ankleL']] as const) {
  MIRROR_BONE[boneIndex(r)] = boneIndex(l);
  MIRROR_BONE[boneIndex(l)] = boneIndex(r);
}

/** 测量、自测用：最近一次 buildUpper 的几个量（按人偶 spec 对象存）。 */
export interface UpperInfo {
  tris: number;
  pieces: Record<string, number>;
  tipMiddle: THREE.Vector3; palmCentre: THREE.Vector3;
  sleeveKind: string;
}
const infoBySpec = new WeakMap<object, UpperInfo>();
export function upperInfo(spec: object): UpperInfo | undefined {
  return infoBySpec.get(spec);
}

export function buildUpper(ctx: BuildCtx): RegionResult {
  const { spec, s } = ctx;
  const g = ctx.garment;
  const d = upperDims(spec, ctx.profile, s, ctx.layout, ctx.seams, g);
  if (ctx.style?.handCurl) d.curl = ctx.style.handCurl;
  const mb = new MeshBuilder();
  const robe = g.top === 'robe_top';
  const torsoSlot = robe ? 'robe' : 'torso';
  const pTorso = mb.piece(robe ? { name: 'torso', slot: 'robe', own: true } : { name: 'torso', slot: 'torso' });
  const pSkin = mb.piece({ name: 'skin', slot: 'skin' });
  const pSleeve = mb.piece(robe ? { name: 'sleeves', slot: 'robe', own: true, capsulePad: 0.02 * s } : { name: 'sleeves', slot: 'sleeve' });

  // fix1：摄像头/无头的人偶：V 口里、领口封口是深色内衬（并进 belt 槽，不多一个 draw call），不是一块肉色圆盘
  const humanHead = spec.head === 'human' || spec.head === 'weasel';
  const pInner = humanHead ? undefined : mb.piece({ name: 'innerShirt', slot: 'belt' });
  // 躯干、脖子
  const T = buildTorso(mb, ctx, d, g, { torso: pTorso, skin: pSkin, ...(pInner !== undefined ? { inner: pInner } : {}) });
  // 右臂 + 手，再镜像成左边
  const A = buildArm(mb, d, g, spec.sleeves === 'short' ? 'short' : 'long', T.loop, { sleeve: pSleeve, skin: pSkin, torso: pTorso });
  mb.mirror(A.v0, A.v1, A.t0, A.t1, b => MIRROR_BONE[b] ?? b);

  // 贴面（门襟、扣子、口袋）与领子：都按躯干表面摆
  const surf = new TorsoSurface(mb, pInner !== undefined ? [pTorso, pSkin, pInner] : [pTorso, pSkin]);
  const torsoVerts = new Set<number>();
  for (let t = 0; t < mb.triCount; t++) if (mb.triPiece[t] === pTorso) for (let k = 0; k < 3; k++) torsoVerts.add(mb.tri[t * 3 + k]!);
  const tv = [...torsoVerts];
  const q = new THREE.Vector3();
  const skinAt = (p: THREE.Vector3): Skin => {
    let best = tv[0]!, bd = Infinity;
    for (const i of tv) {
      const dd = mb.P(i, q).distanceToSquared(p);
      if (dd < bd) { bd = dd; best = i; }
    }
    const out: [number, number][] = [];
    for (let c = 0; c < 4; c++) out.push([mb.si[best * 4 + c]!, mb.sw[best * 4 + c]!]);
    return out;
  };
  const hemDrop = g.tucked !== false || robe ? 0 : (g.hemDrop ?? 0) * s;
  const yBottom = d.yW - hemDrop;
  const yNeckFront = neckBasePoint(d, Math.PI / 2, 0, new THREE.Vector3()).y;
  if (!robe) {
    // fix2：贴面排在衣身后面画（order +1/+2）。原来排在前面（-1/-2）：魂影/回放写深度、按索引顺序画，从背后看时
    // 胸前的领尖、扣子、口袋边先画上去、背后的衣身再盖一层半透明，就“透”到背上了。排在后面：背后先写深度，前面的贴面画不上；
    // 正面看贴面比底下的衣身多一层（略实一点），是可以接受的
    const pOver = mb.piece({ name: 'torsoOverlay', slot: torsoSlot, order: 1 });
    const pOver2 = mb.piece({ name: 'torsoOverlayTop', slot: torsoSlot, order: 2 });
    const pFace = mb.piece({ name: 'torsoOverlayFace', slot: torsoSlot, order: -2 });
    const pFace2 = mb.piece({ name: 'torsoOverlayFaceTop', slot: torsoSlot, order: -3 });
    buildOverlays(mb, d, g, surf, { body: pOver, top: pOver2, bodyFace: pFace, topFace: pFace2 }, skinAt, yBottom, yNeckFront);
  }
  if (g.collar !== 'none') {
    const pCollar = mb.piece({ name: 'collar', slot: torsoSlot, own: true });
    buildCollar(mb, d, g, pCollar, surf);
  } else if (robe) {
    // 长袍：交领（右衽）
    const pCollar = mb.piece({ name: 'collar', slot: torsoSlot, own: true });
    buildRobeCollar(mb, d, pCollar, surf, skinAt);
  }

  // 法线：整张网格一起算（拆开的边界两边一致），接缝上的点改成接缝法线
  const nor = mb.normals();
  for (const [vi, n] of T.seamNormals) nor.set([n.x, n.y, n.z], vi * 3);
  const built = mb.build(nor, ctx.track);
  const parts: SkinnedPiece[] = built.map(toPiece);
  const pieces: Record<string, number> = {};
  for (const b of built) pieces[b.key.name] = (b.geo.index?.count ?? 0) / 3;
  infoBySpec.set(spec, {
    tris: Object.values(pieces).reduce((a, b) => a + b, 0), pieces,
    tipMiddle: A.tipMiddle, palmCentre: A.palmCentre, sleeveKind: A.sleeveKind,
  });
  return { parts };
}

/**
 * 躯干表面（spine 局部坐标）上 u、高 y 处的点与外法线、沿圈的切线（朝人偶右手 +x）、上方向（配件——中山装的口袋盖、扣子——贴着衣服摆）。
 * u：0 = 右侧 +x，0.25 = 前胸正中，0.5 = 左侧，0.75 = 后背（同躯干贴图的 u）。char2：按新的躯干外形（dims.ts torsoPoint）算。
 */
export function torsoSurface(h: HumanoidInternal, u: number, y: number): { p: THREE.Vector3; n: THREE.Vector3; t: THREE.Vector3; up: THREE.Vector3 } {
  const layout = jointLayout(h.profile, h.s);
  const seams = SEAMS(h.profile, h.s, layout);
  // fix1：用人偶自己的服装款式（棉袄、中山装的布厚 pad）：配件贴的是真的衣服外表面
  const d = upperDims(h.spec, h.profile, h.s, layout, seams, h.garment ?? garmentOf(h.spec));
  const yRoot = y + layout.bind.spine[1];
  const f = torsoFrame(d, h.profile, u * Math.PI * 2, Math.min(1, Math.max(0, hOf(d, yRoot))));
  const p = f.p.clone();
  p.y -= layout.bind.spine[1];
  if (yRoot < d.yW) p.y = y;
  const t = f.t.clone();
  if (t.x < 0) t.negate();
  const up = new THREE.Vector3().crossVectors(f.n, t).normalize();
  return { p, n: f.n, t, up };
}
