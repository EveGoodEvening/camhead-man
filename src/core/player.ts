// owner: WP1
// 玩家控制器（ARCH §4.9）：胶囊移动、重力贴地、朝向、传送、lookAtPoint、walkTo。
//
// 手感（WP1 取值）：水平速度用指数趋近（起步 λ=14、刹停 λ=18），不会一按就满速、一松就急停；
// 第三人称下身体朝向以 λ=10 平滑转向移动方向（大角度转身约 0.3s），取景器里身体始终对准视角。

import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import type { V3 } from './types';
import type { MoveInput } from './input';
import type { ModeMove } from './modes';
import type { Game } from './game';
import { angleDiff, clamp, damp, normYaw, pitchTowards, RAD2DEG, yawTowards } from './math';
import { PC_DIMS } from '../rigs/cameraHead';
import { PLAYER_RADIUS, STEP_MAX } from './collision';

const GRAVITY = 20;
const SUBSTEPS = 5;
const RADIUS = PLAYER_RADIUS;
const CAP_START = 0.3;
const CAP_END = 1.45;
/** 镜头中心在身体中轴前方多远（头壳长 0.34，镜头在前脸，ARCH §5.2） */
export const LENS_FORWARD = 0.18;
/** 俯仰限制（度）：第三人称 −35～+50，取景器 −60～+60（ARCH §4.7、§4.9） */
export const PITCH_LIMITS = { tp: [-35, 50], fp: [-60, 60] } as const;
const ACCEL_LAMBDA = 14;
const BRAKE_LAMBDA = 18;
const TURN_LAMBDA = 10;
/** 掉出世界的兜底高度 */
const KILL_Y = -40;
/**
 * 法线 y 分量高于它的接触当作地面，只往上推（M1d：迈台阶）。胶囊底球（半径 R，球心离脚底 R）碰到高 h 的棱时法线 y = (R − h)/R；
 * 阈值取 h = STEP_MAX + 2cm 对应的值（≈ 0.43）：≤ STEP_MAX 的门槛/路沿当地面迈上去，更高的当墙挡住。
 * 原来是 0.7（只迈得过 ≈ 9cm），而连通性栅格放过 15cm，goto 能过的门槛真人过不去（M1d 评审）。
 */
const FLOOR_NORMAL_Y = (RADIUS - STEP_MAX - 0.02) / RADIUS;
/** 单次接触往上推的上限（米）：depth/n.y 在很斜的法线下会很大 */
const STEP_PUSH_MAX = 0.2;

interface WalkJob {
  x: number;
  z: number;
  best: number;
  bestAt: number;
  startAt: number;
  timeout: number;
  done: boolean;
  resolve: (r: { ok: boolean; pos: V3 }) => void;
}

export class PlayerController {
  /** 半径 0.3；start=(x, y+0.3, z)，end=(x, y+1.45, z) */
  readonly capsule: Capsule = new Capsule(new THREE.Vector3(0, CAP_START, 0), new THREE.Vector3(0, CAP_END, 0), RADIUS);
  /** 脚底 */
  readonly position: THREE.Vector3 = new THREE.Vector3();
  readonly velocity: THREE.Vector3 = new THREE.Vector3();
  /** 视角 yaw（度） */
  yaw = 0;
  /** 视角 pitch（度） */
  pitch = 0;
  /** 身体朝向（第三人称下平滑转向移动方向；取景器下 = yaw） */
  bodyYaw = 0;
  onGround = false;
  enabled = true;
  /** m/s */
  readonly speedWalk: 2.2 = 2.2;
  readonly speedRun: 3.6 = 3.6;
  readonly speedSlow: 1.2 = 1.2;
  protected readonly game: Game;
  /** 每次传送递增：CameraRig 据此跳过平滑、直接就位（WP1 内部） */
  teleportSeq = 0;
  private walk: WalkJob | null = null;
  private readonly lastSafe = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(game: Game) {
    this.game = game;
  }

  update(dt: number, move: MoveInput, mode: ModeMove): void {
    if (!this.enabled) mode = 'none';
    // —— 期望水平速度 ——
    let tx = 0;
    let tz = 0;
    let speed = 0;
    if (mode !== 'none') {
      const mag = Math.min(1, Math.hypot(move.x, move.z));
      if (mag > 1e-4) {
        const ref = (mode === 'body' ? this.game.cameras.fixedYaw() : this.yaw) * (Math.PI / 180);
        const fx = Math.sin(ref);
        const fz = -Math.cos(ref);
        // 右 = 前向绕 Y 顺时针 90°：yaw 0（北，−z）时右为 +x
        const rx = -fz;
        const rz = fx;
        let wx = rx * move.x - fx * move.z;
        let wz = rz * move.x - fz * move.z;
        const wl = Math.hypot(wx, wz) || 1;
        wx /= wl;
        wz /= wl;
        speed = (mode === 'slow' ? this.speedSlow : mode === 'normal' && move.sprint ? this.speedRun : this.speedWalk) * mag;
        tx = wx * speed;
        tz = wz * speed;
      }
    }
    const lambda = speed > 0 ? ACCEL_LAMBDA : BRAKE_LAMBDA;
    this.velocity.x = damp(this.velocity.x, tx, lambda, dt);
    this.velocity.z = damp(this.velocity.z, tz, lambda, dt);

    // —— 身体朝向 ——
    if (mode === 'slow') {
      this.bodyYaw = this.yaw;
    } else if ((mode === 'normal' || mode === 'body') && speed > 0.05) {
      const target = Math.atan2(tx, -tz) * RAD2DEG;
      this.bodyYaw = normYaw(this.bodyYaw + angleDiff(this.bodyYaw, target) * (1 - Math.exp(-TURN_LAMBDA * dt)));
    }

    // —— 胶囊积分与碰撞（ARCH §4.9：5 个子步）——
    const col = this.game.collision;
    const sub = dt / SUBSTEPS;
    let grounded = false;
    for (let i = 0; i < SUBSTEPS && sub > 0; i++) {
      this.velocity.y = Math.max(-30, this.velocity.y - GRAVITY * sub);
      this.capsule.translate(this.tmp.copy(this.velocity).multiplyScalar(sub));
      // 同时贴着地面和墙时 Octree 与动态盒子各给一个接触：多解几次
      for (let k = 0; k < 3; k++) {
        const res = col.capsule(this.capsule);
        if (!res) break;
        const n = res.normal;
        // 本项目所有可行走面都是水平面（ARCH §4.8）：接近竖直的法线一律当地面，只往上推、不动水平速度。
        // 否则胶囊跨过大地面四边形的对角线时，Octree 的棱边接触给出略斜的法线，人会被一点点横着推走。
        const floorLike = n.y > FLOOR_NORMAL_Y;
        if (res.depth > 1e-10) {
          // 地面类接触只竖直推出：沿法线的穿透 depth 需要竖直移动 depth/n.y 才解开（台阶棱 n.y≈0.5 时是 2 倍）
          if (floorLike) this.capsule.translate(this.tmp.set(0, Math.min(STEP_PUSH_MAX, res.depth / n.y), 0));
          else this.capsule.translate(this.tmp.copy(n).multiplyScalar(res.depth));
        }
        if (n.y > 0.1) {
          grounded = true;
          if (this.velocity.y < 0) this.velocity.y = 0;
        } else if (n.y < -0.1 && this.velocity.y > 0) {
          this.velocity.y = 0;
        }
        if (floorLike) continue;
        // 沿墙滑动：去掉速度里朝向墙的水平分量
        const hl = Math.hypot(n.x, n.z);
        if (hl > 1e-4) {
          const nx = n.x / hl;
          const nz = n.z / hl;
          const into = this.velocity.x * nx + this.velocity.z * nz;
          if (into < 0) {
            this.velocity.x -= nx * into;
            this.velocity.z -= nz * into;
          }
        }
      }
    }
    this.onGround = grounded;
    this.position.set(this.capsule.start.x, this.capsule.start.y - CAP_START, this.capsule.start.z);
    if (grounded) this.lastSafe.copy(this.position);
    if (this.position.y < KILL_Y) this.teleport([this.lastSafe.x, this.lastSafe.y, this.lastSafe.z]);
  }

  /** 重置速度与胶囊 */
  teleport(pos: V3, yaw?: number): void {
    this.position.set(pos[0], pos[1], pos[2]);
    this.velocity.set(0, 0, 0);
    if (yaw !== undefined) {
      this.yaw = normYaw(yaw);
      this.bodyYaw = this.yaw;
    }
    // 传送后胶囊贴地（ARCH §4.5）：从 1m 高处往下找 3m 内的地面
    const g = this.game.collision.groundBelow(pos[0], pos[1] + 1, pos[2], 3);
    if (g !== null) this.position.y = g;
    this.syncCapsule();
    this.onGround = g !== null;
    this.lastSafe.copy(this.position);
    this.teleportSeq++;
  }

  /**
   * 设 yaw/pitch，使该相机中心射线穿过 p（迭代两次修正镜头偏移）；
   * pitch 按该视角的俯仰限制钳制（tp -35°～+50°，fp -60°～+60°），被钳制时 clamped=true
   */
  lookAtPoint(p: THREE.Vector3, via: 'fp' | 'tp'): { clamped: boolean } {
    const [lo, hi] = PITCH_LIMITS[via];
    let clamped = false;
    const from = new THREE.Vector3();
    // 迭代到收敛（M3，docs/requests/r3.md #7）：第三人称相机偏在右肩、吊臂按碰撞收缩，相机位置随 yaw/pitch 变；
    // 原来固定 3 次，从差 150° 的朝向转过来时在小屋里（吊臂贴墙时长时短）收不拢，中心射线落到旁边的交互物上
    for (let i = 0; i < 12; i++) {
      if (via === 'fp') this.eyeFor(this.yaw, from);
      else this.game.cameras.tpCameraPosition(this.yaw, this.pitch, from);
      const yaw = normYaw(yawTowards(from, p));
      const raw = pitchTowards(from, p);
      const pitch = clamp(raw, lo, hi);
      const moved = Math.abs(angleDiff(this.yaw, yaw)) + Math.abs(pitch - this.pitch);
      this.yaw = yaw;
      this.pitch = pitch;
      clamped = this.pitch !== raw;
      if (i >= 2 && moved < 0.01) break;
    }
    if (via === 'fp') this.bodyYaw = this.yaw;
    return { clamped };
  }

  /** 只改 yaw 与 bodyYaw */
  faceTowards(p: THREE.Vector3): void {
    const y = yawTowards(this.position, p);
    this.yaw = normYaw(y);
    this.bodyYaw = this.yaw;
  }

  /** 沿直线把 MoveInput 喂给 input.setMove()，经正常 update 与碰撞；到达 0.2m 内成功，1 秒无进展判为被挡 */
  walkTo(x: number, z: number, o?: { timeoutSec?: number }): Promise<{ ok: boolean; pos: V3 }> {
    this.finishWalk(false);
    const d = Math.hypot(x - this.position.x, z - this.position.z);
    return new Promise(resolve => {
      const job: WalkJob = {
        x, z, best: d, bestAt: this.game.time, startAt: this.game.time,
        timeout: o?.timeoutSec ?? Math.max(10, (d / this.speedSlow) * 2 + 3),
        done: false, resolve,
      };
      this.walk = job;
      // 锁步下没人推进时间：由 walkTo 自己驱动（已在 advance 里时只等待，不重入）
      this.game.drive(() => job.done, job.timeout + 5).catch(err => {
        console.error('[PlayerController.walkTo]', err);
        if (this.walk === job) this.finishWalk(false);
      });
    });
  }

  /** 镜头世界坐标 */
  get eye(): THREE.Vector3 {
    return this.eyeFor(this.yaw, new THREE.Vector3());
  }
  /** 视线方向（含 pitch 的单位向量；身体朝向见 bodyYaw） */
  get forward(): THREE.Vector3 {
    const y = this.yaw * (Math.PI / 180);
    const p = this.pitch * (Math.PI / 180);
    return new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  }

  // ---------------------------------------------------------------- WP1 内部
  /** 镜头位置：脚底 + lensY，再沿水平朝向前移 LENS_FORWARD（取景器视点“不跟随行走起伏”，ARCH §4.7）。 */
  eyeFor(yaw: number, out: THREE.Vector3): THREE.Vector3 {
    const y = yaw * (Math.PI / 180);
    return out.set(
      this.position.x + Math.sin(y) * LENS_FORWARD,
      this.position.y + PC_DIMS.lensY,
      this.position.z - Math.cos(y) * LENS_FORWARD,
    );
  }

  /** 应用本帧鼠标视角（度）；pitch 按视角钳制。 */
  applyLook(dx: number, dy: number, via: 'fp' | 'tp'): void {
    if (dx === 0 && dy === 0) return;
    const [lo, hi] = PITCH_LIMITS[via];
    this.yaw = normYaw(this.yaw + dx);
    this.pitch = clamp(this.pitch - dy, lo, hi);
  }

  /** 切换视角后把 pitch 钳进新视角的范围（取景器 60° 回到第三人称要压到 50°）。 */
  clampPitch(via: 'fp' | 'tp'): void {
    const [lo, hi] = PITCH_LIMITS[via];
    this.pitch = clamp(this.pitch, lo, hi);
  }

  /** 平移后解碰撞（出口被挡时推回 0.6m 用）。 */
  nudge(dx: number, dz: number): void {
    this.capsule.translate(this.tmp.set(dx, 0, dz));
    for (let k = 0; k < 4; k++) {
      const res = this.game.collision.capsule(this.capsule);
      if (!res) break;
      this.capsule.translate(this.tmp.copy(res.normal).multiplyScalar(res.depth));
    }
    this.position.set(this.capsule.start.x, this.capsule.start.y - CAP_START, this.capsule.start.z);
    this.velocity.set(0, 0, 0);
  }

  /** Game.step 第 4 步之前调用：walkTo 进行中时，按当前位置重新瞄准目标并把移动轴喂给 InputManager。 */
  driveWalk(): void {
    const w = this.walk;
    if (!w) return;
    if (this.game.areas.current === null || this.game.areas.isLoading()) {
      this.finishWalk(false);
      return;
    }
    const dx = w.x - this.position.x;
    const dz = w.z - this.position.z;
    const d = Math.hypot(dx, dz);
    const now = this.game.time;
    if (d < 0.2) {
      this.finishWalk(true);
      return;
    }
    if (d < w.best - 0.05) {
      w.best = d;
      w.bestAt = now;
    }
    if (now - w.bestAt > 1 || now - w.startAt > w.timeout) {
      this.finishWalk(false);
      return;
    }
    const ref = (this.game.modes.moveMode() === 'body' ? this.game.cameras.fixedYaw() : this.yaw) * (Math.PI / 180);
    const fx = Math.sin(ref);
    const fz = -Math.cos(ref);
    const ux = dx / d;
    const uz = dz / d;
    // 靠近目标时减速，避免因加速度平滑冲过 0.2m 的到达圈来回摆
    const mag = clamp(d / 0.6, 0.35, 1);
    this.game.input.setMove({ x: (ux * -fz + uz * fx) * mag, z: -(ux * fx + uz * fz) * mag, sprint: false });
  }

  /** 进行中的 walkTo（调试）。 */
  get walking(): boolean {
    return this.walk !== null;
  }

  private finishWalk(ok: boolean): void {
    const w = this.walk;
    if (!w) return;
    this.walk = null;
    w.done = true;
    this.game.input.setMove(null);
    w.resolve({ ok, pos: [this.position.x, this.position.y, this.position.z] });
  }

  private syncCapsule(): void {
    this.capsule.start.set(this.position.x, this.position.y + CAP_START, this.position.z);
    this.capsule.end.set(this.position.x, this.position.y + CAP_END, this.position.z);
    this.capsule.radius = RADIUS;
  }
}
