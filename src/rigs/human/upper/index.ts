// owner: WP2
// char2 区域：上身（WP-U）——躯干、脖子、肩、胳膊、手、衬衫款式。冻结接口：buildUpper(ctx)、torsoSurface(h, u, y)。
// WP0 时是原样搬来的旧版实现（圆角方截面躯干、Lathe 袖筒、拼起来的手）。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILD } from '../profile';
import { cached, contouredLimb, flipLatheV, limbGeo, loftPoint, q, squircleLoft, type LoftRow } from '../shared';
import type { BuildCtx, HumanoidInternal, RegionResult, RigidPart } from '../types';

/**
 * true = 这里还是 WP0 搬来的旧版构建器（按成年人关节写死）。三个区域（head/upper/lower）都是 true 时，assemble 用旧版关节布局
 * （儿童、土地也按成年人数值摆），外观与拆分前逐像素一致。换上新构建器（按 ctx.layout/ctx.land/ctx.seams 建）后改成 false：
 * 只要有一个区域是 false，全部人偶就用 profile 的关节布局（profile.ts jointLayout）。
 */
export const REGION_LEGACY = true;

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

/** 放松的手：掌骨、四根略弯的手指和拇指合为同一网格；手心朝身体，不额外增加 draw call。 */
function handGeo(s: number, cy: number): THREE.BufferGeometry {
  return cached(`hand:${q(s)}:${q(cy)}`, () => {
    const list: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry) => {
      list.push(g.toNonIndexed());
      g.dispose();
    };
    const palm = new THREE.SphereGeometry(1, 12, 8);
    palm.scale(0.017 * s, 0.045 * s, 0.035 * s);
    palm.translate(0, cy + 0.014 * s, 0);
    add(palm);
    const lengths = [0.055, 0.065, 0.061, 0.046];
    for (let i = 0; i < lengths.length; i++) {
      const len = lengths[i]! * s;
      const finger = new THREE.CapsuleGeometry(0.0075 * s, len - 0.015 * s, 2, 8);
      finger.rotateZ(-0.1);
      finger.translate(-0.003 * s, cy - 0.017 * s - len / 2, (-0.024 + i * 0.016) * s);
      add(finger);
    }
    const thumb = new THREE.CapsuleGeometry(0.01 * s, 0.034 * s, 2, 8);
    thumb.rotateX(0.55);
    thumb.translate(0.006 * s, cy + 0.005 * s, -0.035 * s);
    add(thumb);
    const merged = mergeGeometries(list, false)!;
    for (const g of list) g.dispose();
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
 * 同一关节、同一材质的部件（裸露前臂与手）合成一个网格，增加手部细节不增加 draw call。
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

/** 上身构建器（旧版）：躯干（长袍角色用袍料，胖子是 Lathe 圆肚）、两条胳膊（长袖：袖、袖口、手；短袖：袖筒、袖口边、裸臂与手）、脖子。 */
export function buildUpper(ctx: BuildCtx): RegionResult {
  const { spec, s } = ctx;
  const bw = ctx.build.w, bd = ctx.build.d;
  const parts: RigidPart[] = [];
  // 躯干：长袍——胖子（土地）是 Lathe 圆肚，其余（新娘的旗袍式长裙）是普通上身
  if (spec.robe) parts.push({ kind: 'rigid', name: 'torso', joint: 'spine', geo: spec.build === 'stout' ? bellyTorsoGeo(s, bw, 0.07) : torsoGeo(s, bw, bd, 0), slot: 'robe' });
  else parts.push({ kind: 'rigid', name: 'torso', joint: 'spine', geo: torsoGeo(s, bw, bd, ctx.build.belly), slot: 'torso' });

  // 袖子的轮廓包含圆肩与收口，肘部由相邻衣片重叠，不额外挂关节球。
  const armR = 0.043 * s;
  const long = spec.sleeves === 'long';
  for (const side of ['L', 'R'] as const) {
    const sh = side === 'L' ? 'shoulderL' : 'shoulderR';
    const el = side === 'L' ? 'elbowL' : 'elbowR';
    const sl = spec.robe ? 'robe' : 'sleeve';
    // 手心朝内；关节位置保留，已有杯子、篮子和拐杖仍用原锚点。
    const handRy = side === 'L' ? 0.25 : -0.25;
    if (long) {
      parts.push({ kind: 'rigid', name: `upperArm${side}`, joint: sh, geo: contouredLimb(s, 'upper', bw), slot: sl });
      parts.push({ kind: 'rigid', name: `forearm${side}`, joint: el, geo: contouredLimb(s, 'forearm', bw), slot: sl });
      parts.push({ kind: 'rigid', name: `cuff${side}`, joint: el, geo: bandGeo(0.035 * s * bw, 0.035 * s * bw, 0.023 * s), slot: spec.robe ? sl : 'hem', position: [0, -0.245 * s, 0] });
      // char2：手挂在腕关节上（腕在肘下 layout 的距离），补偿位移后与原来挂在肘上一模一样
      const wr = side === 'L' ? 'wristL' : 'wristR';
      parts.push({ kind: 'rigid', name: `hand${side}`, joint: wr, geo: handGeo(s, -0.29 * s), slot: 'skin', position: [0, -ctx.layout.local[wr][1], 0], rotation: [0, handRy, 0] });
    } else {
      // 袖筒：圆肩 + 外撇的敞口筒，长到上臂中段；袖口压一道深色边
      parts.push({ kind: 'rigid', name: `sleeve${side}`, joint: sh, geo: sleeveGeo(armR * 1.5, armR * 1.62, 0.21 * s), slot: sl, position: [0, 0.012 * s, 0] });
      parts.push({ kind: 'rigid', name: `sleeveHem${side}`, joint: sh, geo: bandGeo(armR * 1.6, armR * 1.635, 0.02 * s), slot: 'hem', position: [0, (0.012 - 0.195) * s, 0] });
      parts.push({ kind: 'rigid', name: `upperArm${side}`, joint: sh, geo: contouredLimb(s, 'upper', 0.73, false), slot: 'skin' });
      parts.push({
        kind: 'rigid', name: `forearm${side}`, joint: el, slot: 'skin', geo: mergedLimb(`bare:${q(s)}:${side}`, [
          [contouredLimb(s, 'forearm', 0.78, false), 0, 0], [handGeo(s, -0.29 * s), 0, handRy],
        ]),
      });
    }
  }
  // 脖子（人头）
  if (spec.head === 'human') parts.push({ kind: 'rigid', name: 'neckSkin', joint: 'neck', geo: limbGeo(0.044 * s, 0.063 * s, 0.09 * s, 16), slot: 'skin', position: [0, 0.065 * s, 0] });
  return { parts };
}
