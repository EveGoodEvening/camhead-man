// owner: WP2
// char2 区域：动作（WP-S）——姿势过渡、行走循环、呼吸、驼背、腕与踝。冻结接口：createMotion(ctx) → Motion（assemble.ts 调用）。
// apply() 每次都从头写全部关节（外部——characters 的 post()、区域脚本——之后再覆盖）。
//
// char2 WP-S（PLAN §3.4）：
// - 行走：摆动相屈膝 ~0.9、着地后承重屈膝 ~0.25；踝让脚掌在支撑相贴地、蹬地时绷脚、摆动时勾脚尖；骨盆与肩反向扭转（±0.08 / ±0.10），
//   颈抵消一半肩扭（头稳）；手臂与对侧腿同摆 ±0.40，前摆时肘屈到 ~0.55；骨盆左右微倾、重心左右移；
//   髋高由“哪只脚最低就让它刚好着地”求出（不再是固定的 −|sin| 颠簸）：脚不浮空、不陷地，起伏自然 ~2cm。
// - 老人（profile.kyphosis > 0）：上背前弓、头前探（颈反抬，脸仍朝前略低）、站着膝微屈、步幅小、摆臂小、呼吸慢。
// - 儿童：步频快、颠得多一点。坐/蹲的 bodyDrop 对儿童和土地按腿长缩放（成年人不变：0.45s 是家具的约定）。
// - 腕、踝（BUILD 内部关节）：姿势里给值；踝缺省按“脚掌贴地”自动补偿髋 + 膝。
// - 呼吸 0.25Hz（老人 0.2Hz），胸口起伏 ~3mm。

import * as THREE from 'three';
import type { Pose } from '../../../core/types';
import { rng, range } from '../../../kit/rng';
import { POSES, type PoseDef } from '../../poses';
import { BUILD_JOINTS } from '../profile';
import type { BuildJoint, MotionCtx } from '../types';

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

/** 行走与体态的参数（可在测试里读；不是公开接口）。 */
export const GAIT = {
  /** 髋前后摆幅（弧度）与前偏（大腿往前多摆一点，往后少一点） */
  hipAmp: 0.34, hipBias: 0.05,
  /** 摆动相屈膝峰值、支撑相承重屈膝、常驻微屈 */
  kneeSwing: 0.95, kneeLoad: 0.22, kneeBase: 0.04,
  /** 蹬地绷脚、着地勾脚、摆动勾脚（脚相对地面的俯仰，正 = 脚尖朝上） */
  toeOff: -0.42, heelStrike: 0.22, swingToe: 0.12,
  /** 骨盆、肩（世界）扭转，颈抵消肩扭的比例 */
  pelvisYaw: 0.08, shoulderYaw: 0.1, headStab: 0.5,
  /** 摆臂（肩前后）、前摆时肘屈的范围 */
  armAmp: 0.4, elbowBack: 0.25, elbowFront: 0.55,
  /** 骨盆侧倾、上身侧移（重心换脚） */
  pelvisRoll: 0.035, spineRoll: 0.025,
  /** 走路时上身微前倾 */
  lean: 0.035,
} as const;

const TWO_PI = Math.PI * 2;
/** 环形相位上的平滑鼓包：在 c 处为 1，|x − c| ≥ w 处为 0（余弦平方）。 */
function bump(x: number, c: number, w: number): number {
  let d = (x - c) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  if (Math.abs(d) >= w) return 0;
  const k = Math.cos((d / w) * (Math.PI / 2));
  return k * k;
}

/** 不对称的鼓包：c 左边宽 wl、右边宽 wr。 */
function bump2(x: number, c: number, wl: number, wr: number): number {
  let d = (x - c) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  const w = d < 0 ? wl : wr;
  if (Math.abs(d) >= w) return 0;
  const k = Math.cos((d / w) * (Math.PI / 2));
  return k * k;
}

/**
 * 一条腿在相位 ph 的姿态（左腿用 phase，右腿用 phase + π）。约定：sin(ph) > 0 时这条腿在前；
 * 摆动相 ph ∈ (−0.97, π/2)（大腿往前送），着地在 ph ≈ π/2，蹬离在 ph ≈ −0.97（真人：支撑 60%、摆动 40%）。
 * 返回髋、膝（负 = 屈）与脚相对地面的俯仰（正 = 脚尖朝上）。
 */
export function legGait(ph: number, stride = 1): { hip: number; knee: number; foot: number } {
  const g = GAIT;
  const hip = g.hipBias + g.hipAmp * stride * Math.sin(ph);
  // 一个周期：着地 ph = π/2；支撑 60%（双支撑各 ~10%）；蹬离 ph ≈ −0.97；摆动 40%。
  // 屈膝从脚跟离地（ph ≈ −1.75）开始，蹬离时 ~0.5，摆动前段（ph ≈ −0.25）峰值；承重屈膝在着地后（ph ≈ π/2 + 0.45）
  const knee = -(g.kneeBase + g.kneeSwing * Math.min(1, stride * 1.05) * bump2(ph, -0.15, 1.6, 1.75) + g.kneeLoad * bump(ph, Math.PI / 2 + 0.45, 0.8));
  // 脚：支撑相贴地（0）；着地瞬间勾脚尖（脚跟先着地），蹬地前后绷脚（脚跟抬起），摆动中勾一点脚尖
  const foot = g.heelStrike * bump(ph, Math.PI / 2 - 0.05, 0.55) + g.toeOff * bump2(ph, -1.0, 1.3, 0.8) + g.swingToe * bump(ph, 0.4, 0.6);
  return { hip, knee, foot };
}

export function createMotion(ctx: MotionCtx): Motion {
  const { spec, s, joints: J, pivot, profile, layout } = ctx;
  const hipY = ctx.rest.hipsY;
  const bd = ctx.bd;
  const cur = new Map<BuildJoint, THREE.Vector3>();
  const from = new Map<BuildJoint, THREE.Vector3>();
  const to = new Map<BuildJoint, THREE.Vector3>();
  for (const n of BUILD_JOINTS) {
    cur.set(n, new THREE.Vector3());
    from.set(n, new THREE.Vector3());
    to.set(n, new THREE.Vector3());
  }
  let poseName: Pose = 'stand';
  let poseDef: PoseDef = POSES.stand;
  let blendT = 1, blendDur = 0.3;
  let dropFrom = 0, dropTo = 0, dropCur = 0;
  let rotFrom = 0, rotTo = 0, rotCur = 0;
  let flatFrom = 1, flatTo = 1, flatCur = 1;
  let gwFrom = 1, gwTo = 1, gwCur = 1;
  let phase = 0, walkW = 0, breathT = range(rng(Math.round(spec.height * 1000)), 0, 10);

  // ---- 体态（PLAN §1、§3.4）
  const child = profile.age === 'child';
  const old = profile.age === 'old';
  // 驼背：kyphosis 0.25 → 脊柱 −0.30、颈 +0.24；肩跟着往前收一点；膝微屈（老人站不直）
  const ky = Math.max(0, profile.kyphosis);
  const kyN = Math.min(1.6, ky / 0.25);
  // fix1：弯在上背（几何里的驼峰）多、髋上那一折少：脊柱转得少一点，头靠颈往前探
  const hunchSpine = -1.05 * ky;
  const hunchNeck = 0.64 * ky;
  const hunchShoulder = 0.12 * ky;
  const oldKnee = old || ky >= 0.15 ? 0.08 * Math.min(1, kyN) : 0;
  const strideK = (ky > 0.1 || old ? 0.85 : 1) * (child ? 0.9 : 1);
  const armK = ky > 0.1 ? 0.55 : old ? 0.75 : 1;
  const bobK = child ? 1.4 : 1;
  const breathHz = old ? 0.2 : 0.25;
  // 腿长（髋关节 → 踝关节）、脚的几何（求髋高：最低那只脚刚好着地）
  const thigh = -layout.local.kneeL[1], shin = -layout.local.ankleL[1], hipDrop = -layout.local.hipL[1];
  const ankleH = hipY - hipDrop - thigh - shin; // 站直时踝关节离地高（≈0.075s）
  const heelBack = 0.05 * s, toeFwd = 0.15 * s;
  // 坐/蹲的整体下移：成年人原样（家具约定 0.45s）；儿童、土地按腿长缩放
  const legRatio = layout.legacy ? 1 : (thigh + shin) / (0.845 * s);

  const setTargets = (p: Pose) => {
    poseName = p;
    poseDef = POSES[p];
    for (const n of BUILD_JOINTS) {
      from.get(n)!.copy(cur.get(n)!);
      const t = poseDef.joints[n];
      to.get(n)!.set(t?.[0] ?? 0, t?.[1] ?? 0, t?.[2] ?? 0);
    }
    dropFrom = dropCur;
    gwFrom = gwCur;
    gwTo = (poseDef.ground ?? (poseDef.bodyDrop || poseDef.rootRotX ? 'drop' : 'legs')) === 'legs' ? 1 : 0;
    dropTo = gwTo ? 0 : (poseDef.bodyDrop ?? 0) * s * legRatio;
    rotFrom = rotCur;
    rotTo = poseDef.rootRotX ?? 0;
    flatFrom = flatCur;
    flatTo = poseDef.feet === 'free' ? 0 : 1;
  };
  setTargets('stand');
  for (const n of BUILD_JOINTS) cur.get(n)!.copy(to.get(n)!);

  const legsWalk = () => poseName !== 'sit' && poseName !== 'lie' && poseName !== 'crouch';
  const armsSwing = () => poseName === 'stand' || poseName === 'walk' || poseName === 'look_up';
  /** 髋高按腿求（脚着地）的权重：站、走、蹲……为 1；坐（家具约定的 bodyDrop）、躺为 0；过渡中插值。 */
  const standingK = () => gwCur;

  /** 一条腿在当前关节角下，最低的脚底点（相对髋关节，向下为正的“腿长”） */
  const legReach = (hip: number, knee: number, ankle: number): number => {
    const a1 = hip, a2 = hip + knee, a3 = a2 + ankle; // 大腿、小腿、脚相对竖直/水平的转角
    const down = thigh * Math.cos(a1) + shin * Math.cos(a2);
    // 脚：踝下 ankleH 是脚底，脚跟在后、脚尖在前；整只脚按 a3 绕踝转（正 = 脚尖朝上）
    const c = Math.cos(a3), sn = Math.sin(a3);
    const heel = ankleH * c + heelBack * sn; // 脚跟点在踝下多少（a3 > 0 勾脚尖时脚跟更低）
    const toe = ankleH * c - toeFwd * sn;    // 脚尖点（a3 < 0 绷脚时脚尖更低）
    return down + Math.max(heel, toe, ankleH * c);
  };

  const apply = () => {
    const w = walkW;
    for (const n of BUILD_JOINTS) {
      const c = cur.get(n)!;
      J[n].rotation.set(c.x, c.y, c.z);
    }
    const stK = standingK();
    // 体态（驼背、老人膝微屈）——任何姿势都在（坐着也驼背）
    J.spine.rotation.x += hunchSpine;
    J.neck.rotation.x += hunchNeck;
    J.shoulderL.rotation.y -= hunchShoulder;
    J.shoulderR.rotation.y += hunchShoulder;
    if (oldKnee > 0 && stK > 0 && legsWalk()) {
      for (const [h, k] of [[J.hipL, J.kneeL], [J.hipR, J.kneeR]] as const) {
        h.rotation.x += oldKnee * 0.5 * stK;
        k.rotation.x -= oldKnee * stK;
      }
    }
    let walkSpineYaw = 0;
    if (w > 0 && legsWalk()) {
      const L = legGait(phase, strideK), R = legGait(phase + Math.PI, strideK);
      J.hipL.rotation.x += L.hip * w;
      J.hipR.rotation.x += R.hip * w;
      J.kneeL.rotation.x += L.knee * w;
      J.kneeR.rotation.x += R.knee * w;
      // 脚的目标俯仰写进踝（下面“贴地”补偿之后再加）
      J.ankleL.rotation.x += L.foot * w;
      J.ankleR.rotation.x += R.foot * w;
      const sw = Math.sin(phase);
      // 骨盆：左腿在前（sw > 0）时左髋往前 → 绕 y 为负；肩反向（spine 是 hips 的子节点，局部 = 世界肩扭 − 骨盆扭）
      const pel = -GAIT.pelvisYaw * strideK * sw * w;
      const sho = GAIT.shoulderYaw * strideK * sw * w * armK;
      J.hips.rotation.y += pel;
      J.spine.rotation.y += sho - pel;
      walkSpineYaw = sho;
      // 骨盆侧倾（摆动腿那侧略低）、上身反向微倾；支撑腿换边每步一次
      const roll = Math.sin(phase + 0.3);
      J.hips.rotation.z += GAIT.pelvisRoll * roll * w;
      J.spine.rotation.z -= (GAIT.pelvisRoll + GAIT.spineRoll) * roll * w;
      J.spine.rotation.x -= GAIT.lean * w;
      J.neck.rotation.x += GAIT.lean * 0.7 * w;
      if (armsSwing()) {
        // 手臂与对侧腿同摆，略滞后于腿（~0.25 rad）；前摆时肘屈更多
        const as = Math.sin(phase - 0.25);
        const amp = GAIT.armAmp * armK * strideK;
        J.shoulderL.rotation.x -= amp * as * w;
        J.shoulderR.rotation.x += amp * as * w;
        const fL = 0.5 - 0.5 * as, fR = 0.5 + 0.5 * as; // 1 = 这只手在最前
        const elbow = (f: number) => GAIT.elbowBack + (GAIT.elbowFront - GAIT.elbowBack) * f * armK;
        J.elbowL.rotation.x += (elbow(fL) - cur.get('elbowL')!.x) * w;
        J.elbowR.rotation.x += (elbow(fR) - cur.get('elbowR')!.x) * w;
        // 摆动时手腕放松：前摆略内旋
        J.wristL.rotation.y -= 0.12 * fL * w;
        J.wristR.rotation.y += 0.12 * fR * w;
      }
    }
    // 头稳：颈抵消一半肩扭
    J.neck.rotation.y -= GAIT.headStab * walkSpineYaw;
    // 脚掌贴地：踝补偿髋 + 膝（姿势 feet:'free' 时淡出）
    if (flatCur > 0) {
      J.ankleL.rotation.x -= (J.hipL.rotation.x + J.kneeL.rotation.x) * flatCur;
      J.ankleR.rotation.x -= (J.hipR.rotation.x + J.kneeR.rotation.x) * flatCur;
    }
    // 呼吸（停着时明显一点）：胸口起伏 ~3mm，肩微动
    const br = Math.sin(breathT * TWO_PI * breathHz) * (1 - w * 0.7);
    J.spine.rotation.x += br * 0.012;
    J.neck.rotation.x -= br * 0.008;
    J.shoulderL.rotation.z -= br * 0.01;
    J.shoulderR.rotation.z += br * 0.01;
    // 髋高：站着的姿势让最低的那只脚刚好着地（髋绕 x 的转角也算进去：腿挂在 hips 下面）
    let y = hipY - dropCur;
    if (stK > 0) {
      const tilt = J.hips.rotation.x;
      const reach = Math.max(
        legReach(J.hipL.rotation.x + tilt, J.kneeL.rotation.x, J.ankleL.rotation.x),
        legReach(J.hipR.rotation.x + tilt, J.kneeR.rotation.x, J.ankleR.rotation.x),
      );
      const stand = hipDrop + thigh + shin + ankleH;
      // ≤ 0：腿“变短”了多少；蹬地那只脚踮着脚尖时可能比站直还长，不让髋因此高过站立高度（脚尖最多压进地面几毫米）
      let dy = reach + hipDrop - stand;
      if (legsWalk()) dy = Math.min(0.003 * s, dy);
      // 儿童颠得多一点：多出来的起伏只在走路时加
      if (w > 0) dy -= (bobK - 1) * 0.012 * s * w * Math.pow(Math.sin(phase), 2);
      y += dy * stK;
    }
    J.hips.position.y = y;
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
        for (const n of BUILD_JOINTS) cur.get(n)!.copy(to.get(n)!);
        dropCur = dropTo;
        rotCur = rotTo;
        flatCur = flatTo;
        gwCur = gwTo;
      }
      return true;
    },
    step(dt, speed) {
      breathT += dt;
      if (blendT < 1) {
        blendT = Math.min(1, blendT + dt / blendDur);
        const k = blendT * blendT * (3 - 2 * blendT);
        for (const n of BUILD_JOINTS) cur.get(n)!.lerpVectors(from.get(n)!, to.get(n)!, k);
        dropCur = dropFrom + (dropTo - dropFrom) * k;
        rotCur = rotFrom + (rotTo - rotFrom) * k;
        flatCur = flatFrom + (flatTo - flatFrom) * k;
        gwCur = gwFrom + (gwTo - gwFrom) * k;
      }
      const moving = speed > 0.1;
      // 起步快、停步 0.2s 内收回（ARCH §5.1）
      walkW = moving ? Math.min(1, walkW + dt / 0.15) : Math.max(0, walkW - dt / 0.2);
      if (moving) {
        // 一个周期（2π）= 两步；步长随身高、老人/儿童更短 → 同样速度下步频更快
        const stride = 0.75 * (spec.height / 1.75) * strideK;
        phase = (phase + (speed / stride) * dt * Math.PI) % TWO_PI;
      } else if (walkW === 0) {
        // 停稳后把相位收回到双脚并拢的位置，下次起步从头开始
        phase = 0;
      }
    },
    apply,
  };
}
