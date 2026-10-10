// owner: WP2
// char2 区域：下身（WP-L）——骨盆/裤子、腿、踝、鞋、腰带、长袍与坐姿下摆。冻结接口：buildLower(ctx)。
// WP0 时是原样搬来的旧版实现（骨盆块、Lathe 腿、圆角盒鞋、Lathe 长袍 + 坐姿形变）。

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { cached, contouredLimb, flipLatheV, q, squircleLoft } from '../shared';
import type { BuildCtx, RegionResult, RigidPart } from '../types';

/** 鞋楦：圆趾、收腰、脚背与低鞋跟；鞋底 UV 在下沿，鞋面与鞋底仍共用一个网格。 */
function shoeGeo(w: number, h: number, len: number, y: number, zFront: number): THREE.BufferGeometry {
  return cached(`shoe:${q(w)}:${q(h)}:${q(len)}:${q(y)}:${q(zFront)}`, () => {
    const g = new RoundedBoxGeometry(w, h, len, 2, h * 0.23);
    const p = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i), yy = p.getY(i);
      const toe = Math.max(0, -z / (len / 2));
      const waist = Math.exp(-Math.pow((z - len * 0.13) / (len * 0.22), 2));
      p.setX(i, p.getX(i) * (1 - 0.14 * toe - 0.1 * waist));
      if (yy > 0) p.setY(i, yy * (1 - 0.45 * toe));
      uv.setY(i, yy < -h * 0.27 ? 0.1 : 0.9);
    }
    g.computeVertexNormals();
    g.translate(0, y, zFront + len / 2);
    return g;
  });
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

/** 连续长袍：纵向褶随下摆展开；坐姿形变保持整片布盖在膝上，而不是露出两根袍料大腿。 */
function robeGeo(s: number, bw: number): THREE.BufferGeometry {
  return cached(`robe:${q(s)}:${q(bw)}`, () => {
    const pts: THREE.Vector2[] = [];
    for (let i = 20; i >= 0; i--) {
      const t = i / 20;
      pts.push(new THREE.Vector2((0.17 + 0.07 * t + 0.025 * t * t) * s * bw, (0.1 - 0.96 * t) * s));
    }
    const g = new THREE.LatheGeometry(pts, 32);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const t = (0.1 - p.getY(i) / s) / 0.96;
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const fold = 1 + (0.012 + 0.04 * t) * Math.cos(a * 12 + t * 0.7);
      p.setX(i, p.getX(i) * fold);
      p.setZ(i, p.getZ(i) * fold * 0.8);
    }
    flipLatheV(g);
    g.computeVertexNormals();
    return g;
  });
}

/** 每件袍只分配一次姿态端点；只在坐/站过渡时更新顶点，标准、魂影、回放材质共用同一真实轮廓。 */
function robeDrape(geo: THREE.BufferGeometry, s: number): (bend: number) => void {
  const p = geo.attributes.position as THREE.BufferAttribute;
  p.setUsage(THREE.DynamicDrawUsage);
  const rest = new Float32Array(p.array), seated = new Float32Array(rest.length);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = (0.1 - y / s) / 0.96;
    const front = THREE.MathUtils.smoothstep(-z / Math.max(s * 0.001, Math.hypot(x, z)), -0.85, -0.15);
    const lap = Math.sin(Math.min(1, t / 0.45) * Math.PI / 2);
    const frontY = t < 0.45 ? 0.1 - t * 0.075 : 0.06625 - (t - 0.45) * 0.9;
    seated[i * 3] = x * (1 - 0.06 * t + 0.32 * Math.exp(-Math.pow((t - 0.18) / 0.2, 2)));
    seated[i * 3 + 1] = ((0.1 - 0.6 * t) * (1 - front) + frontY * front) * s;
    seated[i * 3 + 2] = z * (1 - 0.18 * t) - front * 0.36 * s * lap;
  }
  let previous = -1;
  return bend => {
    if (Math.abs(bend - previous) < 1e-5) return;
    previous = bend;
    for (let i = 0; i < rest.length; i++) p.array[i] = rest[i]! + (seated[i]! - rest[i]!) * bend;
    p.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  };
}

/** 下身构建器（旧版）：长袍角色是一整件 Lathe 袍（坐下时形变盖住大腿）；其余是骨盆 + 腰带；两条腿与鞋。 */
export function buildLower(ctx: BuildCtx): RegionResult {
  const { spec, s } = ctx;
  const bw = ctx.build.w, bd = ctx.build.d;
  const parts: RigidPart[] = [];
  let robe: THREE.BufferGeometry | null = null;
  if (spec.robe) {
    robe = ctx.track(robeGeo(s, bw).clone());
    parts.push({ kind: 'rigid', name: 'robe', joint: 'hips', geo: robe, slot: 'robe' });
  } else {
    parts.push({ kind: 'rigid', name: 'pelvis', joint: 'hips', geo: pelvisGeo(s, bw, bd), slot: 'pants' });
    parts.push({ kind: 'rigid', name: 'belt', joint: 'hips', geo: beltGeo(s, bw, bd), slot: 'belt' });
  }
  // 长袍下保留正常的腿；坐姿由整片袍摆覆盖，不再用两个外露筒子表示布料。
  for (const side of ['L', 'R'] as const) {
    const hp = side === 'L' ? 'hipL' : 'hipR';
    const kn = side === 'L' ? 'kneeL' : 'kneeR';
    parts.push({ kind: 'rigid', name: `thigh${side}`, joint: hp, geo: contouredLimb(s, 'thigh', bw * (spec.robe ? 0.74 : 1)), slot: 'pants' });
    parts.push({ kind: 'rigid', name: `shin${side}`, joint: kn, geo: contouredLimb(s, 'shin', bw * (spec.robe ? 0.8 : 1)), slot: 'pants' });
    parts.push({ kind: 'rigid', name: `shoe${side}`, joint: kn, geo: shoeGeo(0.1 * s, 0.075 * s, 0.26 * s, -0.455 * s, -0.19 * s), slot: 'shoes' });
  }
  const drape = robe ? robeDrape(robe, s) : null;
  return { parts, ...(drape ? { update: st => drape(st.bend) } : {}) };
}
