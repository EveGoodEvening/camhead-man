// owner: WP2
// char2 区域：动作（WP-S）——姿势过渡、行走循环、呼吸、驼背。冻结接口：createMotion(ctx) → Motion（assemble.ts 调用）。
// apply() 每次都从头写全部关节（外部——characters 的 post()、区域脚本——之后再覆盖）。WP0 时是原样搬来的旧版实现。

import * as THREE from 'three';
import type { Pose } from '../../../core/types';
import { rng, range } from '../../../kit/rng';
import { POSES, type PoseDef } from '../../poses';
import { JOINT_NAMES } from '../profile';
import type { MotionCtx } from '../types';

export interface Motion {
  readonly pose: Pose;
  /** 当前走路相位（0..2π） */
  readonly walkPhase: number;
  /** 行走权重（0 停 → 1 走） */
  readonly walkWeight: number;
  /** 切换姿势；false = 已经在这个姿势且过渡已完成（什么都没做，不必 apply） */
  setPose(p: Pose, blendSec: number): boolean;
  /** 推进时间（过渡、走路相位、呼吸），不写关节 */
  step(dt: number, speed: number): void;
  /** 按当前状态从头写全部关节旋转、髋高、pivot */
  apply(): void;
}

export function createMotion(ctx: MotionCtx): Motion {
  const { spec, s, joints: J, pivot } = ctx;
  const hipY = ctx.rest.hipsY;
  const bd = ctx.bd;
  const cur = new Map<(typeof JOINT_NAMES)[number], THREE.Vector3>();
  const from = new Map<(typeof JOINT_NAMES)[number], THREE.Vector3>();
  const to = new Map<(typeof JOINT_NAMES)[number], THREE.Vector3>();
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
  };

  return {
    get pose() { return poseName; },
    get walkPhase() { return phase; },
    get walkWeight() { return walkW; },
    setPose(p, blendSec) {
      if (p === poseName && blendT >= 1) return false;
      setTargets(p);
      blendDur = Math.max(0, blendSec);
      blendT = blendDur > 0 ? 0 : 1;
      if (blendT >= 1) {
        for (const n of JOINT_NAMES) cur.get(n)!.copy(to.get(n)!);
        dropCur = dropTo;
        rotCur = rotTo;
      }
      return true;
    },
    step(dt, speed) {
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
    },
    apply,
  };
}
