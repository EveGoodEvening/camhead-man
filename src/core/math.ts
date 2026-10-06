// owner: integrator
// （M1a 写全量并冻结；此后只有整合代理/引擎维护者能改，ARCH §2.12）
// 数学小工具（ARCH §1.3、§2.2）：yaw 换算、插值、时间码、角度差、平面镜像。

import * as THREE from 'three';
import type { V3, XZ } from './types';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

// ---------------------------------------------------------------- yaw / pitch（ARCH §1.3）
/** yaw（度，0 = 北/-z，90 = 东/+x）→ Object3D.rotation.y（弧度）。 */
export function yawToRotY(yawDeg: number): number {
  return -yawDeg * DEG2RAD;
}
/** Object3D.rotation.y（弧度）→ yaw（度，[0,360)）。 */
export function rotYToYaw(rotY: number): number {
  return normYaw(-rotY * RAD2DEG);
}
/** yaw 的水平前向量 (sin, 0, -cos)。 */
export function forwardFromYaw(yawDeg: number, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  const r = yawDeg * DEG2RAD;
  return target.set(Math.sin(r), 0, -Math.cos(r));
}
/** yaw + pitch（度，正值抬头）的单位视线向量。 */
export function dirFromYawPitch(yawDeg: number, pitchDeg: number, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  const y = yawDeg * DEG2RAD;
  const p = pitchDeg * DEG2RAD;
  const c = Math.cos(p);
  return target.set(Math.sin(y) * c, Math.sin(p), -Math.cos(y) * c);
}
/** 从 from 看向 to 的 yaw（度，[0,360)）；只看 xz 平面。 */
export function yawTowards(from: V3 | THREE.Vector3, to: V3 | THREE.Vector3): number {
  const [fx, , fz] = asTuple(from);
  const [tx, , tz] = asTuple(to);
  return normYaw(Math.atan2(tx - fx, -(tz - fz)) * RAD2DEG);
}
/** 从 from 看向 to 的 pitch（度，正值抬头）。 */
export function pitchTowards(from: V3 | THREE.Vector3, to: V3 | THREE.Vector3): number {
  const [fx, fy, fz] = asTuple(from);
  const [tx, ty, tz] = asTuple(to);
  return Math.atan2(ty - fy, Math.hypot(tx - fx, tz - fz)) * RAD2DEG;
}
/** 归一化到 [0,360)。 */
export function normYaw(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}
/** 有符号最短角差 b - a（度，(-180,180]）。 */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}
/** 沿最短方向在两角之间插值（度）。 */
export function lerpAngle(a: number, b: number, t: number): number {
  return normYaw(a + angleDiff(a, b) * t);
}

// ---------------------------------------------------------------- 标量
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01(invLerp(e0, e1, x));
  return t * t * (3 - 2 * t);
}
/** 帧率无关的指数趋近：lambda 越大越快。 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}
/** 以恒定速度趋近。 */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

// ---------------------------------------------------------------- 向量
export function asTuple(v: V3 | THREE.Vector3): V3 {
  return v instanceof THREE.Vector3 ? [v.x, v.y, v.z] : v;
}
export function toVec3(v: V3, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  return target.set(v[0], v[1], v[2]);
}
export function fromVec3(v: THREE.Vector3): V3 {
  return [v.x, v.y, v.z];
}
export function dist3(a: V3 | THREE.Vector3, b: V3 | THREE.Vector3): number {
  const [ax, ay, az] = asTuple(a);
  const [bx, by, bz] = asTuple(b);
  return Math.hypot(bx - ax, by - ay, bz - az);
}
export function distXZ(a: XZ | V3 | THREE.Vector3, b: XZ | V3 | THREE.Vector3): number {
  const [ax, az] = xzOf(a);
  const [bx, bz] = xzOf(b);
  return Math.hypot(bx - ax, bz - az);
}
function xzOf(v: XZ | V3 | THREE.Vector3): XZ {
  if (v instanceof THREE.Vector3) return [v.x, v.z];
  return v.length === 2 ? v : [v[0], v[2]];
}

// ---------------------------------------------------------------- 时间码（ARCH §2.2）
/**
 * 'HH:MM' 或 'HH:MM:SS' → 当日秒数 [0, 86400)。
 * 录像带秒（0 = 22:00:00）请用 data/time.ts 的 tapeSec()。
 */
export function parseTc(tc: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(tc.trim());
  if (!m) throw new Error(`parseTc: bad timecode '${tc}'`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = m[3] === undefined ? 0 : Number(m[3]);
  if (h > 23 || min > 59 || s > 59) throw new Error(`parseTc: bad timecode '${tc}'`);
  return h * 3600 + min * 60 + s;
}
/** 当日秒数 → 'HH:MM:SS'（按 24 小时取模；seconds:false 时 'HH:MM'）。 */
export function formatTc(sec: number, o?: { seconds?: boolean }): string {
  const t = ((Math.floor(sec) % 86400) + 86400) % 86400;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  if (o?.seconds === false) return `${hh}:${mm}`;
  return `${hh}:${mm}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- 平面镜像（ARCH §6.8.6）
/** 点 p 关于平面（过 planePoint、单位法线 planeNormal）的镜像点。target 可以就是 p（或任一输入），先求距离、最后一次写入。 */
export function reflectPoint(
  p: THREE.Vector3, planePoint: THREE.Vector3, planeNormal: THREE.Vector3, target: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  const k = -2 * signedDistanceToPlane(p, planePoint, planeNormal);
  return target.set(p.x + k * planeNormal.x, p.y + k * planeNormal.y, p.z + k * planeNormal.z);
}
/** 点到平面的有符号距离（沿法线方向为正）。 */
export function signedDistanceToPlane(p: THREE.Vector3, planePoint: THREE.Vector3, planeNormal: THREE.Vector3): number {
  return (p.x - planePoint.x) * planeNormal.x + (p.y - planePoint.y) * planeNormal.y + (p.z - planePoint.z) * planeNormal.z;
}
/** 线段 a→b 与平面的交点；不相交（平行或交点不在线段上）返回 null。target 可以就是 a 或 b。 */
export function segmentPlaneIntersect(
  a: THREE.Vector3, b: THREE.Vector3, planePoint: THREE.Vector3, planeNormal: THREE.Vector3,
  target: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 | null {
  const da = signedDistanceToPlane(a, planePoint, planeNormal);
  const db = signedDistanceToPlane(b, planePoint, planeNormal);
  if (da === db) return null;
  const t = da / (da - db);
  if (t < 0 || t > 1) return null;
  return target.lerpVectors(a, b, t);
}
