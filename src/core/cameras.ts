// owner: WP1
// 相机（ARCH §4.7）：第三人称/取景器/固定机位/拍照相机，第三人称避障，变焦，窄视口时的视场换算。
//
// 第三人称（ARCH §4.7、GDD §3.1）：以头部枢轴（脚底上方 1.6m）为球心做轨道，基准偏移“身后 2.6、高 1.9、右 0.5”，
// 俯仰时绕枢轴转；从枢轴向期望位置打 5 条平行射线（中心 + 上下左右 0.15m，近似球形射线），命中则拉近到“命中距离 − 0.2”、最近 0.9m。
// 拉近立即、放远平滑（≈0.3s）。枢轴位置本身做轻微平滑（水平 λ=25、垂直 λ=12），吸收物理子步的抖动；视角旋转不平滑（鼠标要跟手）。

import * as THREE from 'three';
import type { CameraPose, LensMode, ZoomLevel } from './types';
import type { CamRole, LayerName } from './layers';
import { LAYER, layerMaskFor } from './layers';
import type { Game } from './game';
import { clamp, DEG2RAD, damp, RAD2DEG } from './math';

const TP_BACK = 2.6;
const TP_UP = 1.9;
const TP_RIGHT = 0.5;
const TP_PIVOT_Y = 1.6;
const TP_MIN = 0.9;
const TP_PAD = 0.2;
const TP_PROBE_R = 0.15;
const TP_RELAX_LAMBDA = 10;
const PIVOT_LAMBDA_XZ = 25;
const PIVOT_LAMBDA_Y = 12;
/** 取景器 1× 的垂直视场（视口 ≥ 4:3 时），也是 photo 相机的恒定视场 */
export const VF_FOV = 50;

interface Blend {
  fromPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  fromFov: number;
  toPos: THREE.Vector3;
  toQuat: THREE.Quaternion;
  toFov: number;
  t: number;
  dur: number;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

function setMask(cam: THREE.Camera, names: readonly LayerName[]): void {
  cam.layers.disableAll();
  for (const n of names) cam.layers.enable(LAYER[n]);
}

/** yaw/pitch（度）→ 视线方向。 */
function viewDir(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const y = yaw * DEG2RAD;
  const p = pitch * DEG2RAD;
  return out.set(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
}

/** 从 pos 看向 pos+dir 的四元数（up = +Y）。 */
function quatLook(pos: THREE.Vector3, target: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _m.lookAt(pos, target, UP);
  return out.setFromRotationMatrix(_m);
}

export class CameraRig {
  /** fov 60，near 0.05，far 200 */
  readonly tp: THREE.PerspectiveCamera;
  /** 1× 时垂直 fov 50（视口比例 ≥ 4:3 时）；变焦用 camera.zoom */
  readonly fp: THREE.PerspectiveCamera;
  /** 过场、三脚架、面板视点、截图 */
  readonly fixed: THREE.PerspectiveCamera;
  /** 与 fp 同位姿、同 zoom，aspect 固定 4/3，视场由屏幕上的 4:3 画框矩形推导（判定与缩略图） */
  readonly photo: THREE.PerspectiveCamera;
  active: 'tp' | 'fp' | 'fixed' = 'tp';
  /** fixed 相机当前扮演的角色（决定图层掩码） */
  fixedRole: 'fixed' | 'ch1' | 'tripod' = 'fixed';
  protected readonly game: Game;
  private vw = 1280;
  private vh = 720;
  private readonly pivot = new THREE.Vector3();
  private boom = Math.hypot(TP_BACK, TP_UP - TP_PIVOT_Y, TP_RIGHT);
  private seenTeleport = -1;
  private blend: Blend | null = null;
  private fixedExtra: readonly LayerName[] = [];
  private masks: { vf: boolean; lens: LensMode; replay: boolean } = { vf: false, lens: 'normal', replay: false };
  private readonly probeFrom = new THREE.Vector3();

  constructor(game: Game) {
    this.game = game;
    this.tp = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 200);
    this.fp = new THREE.PerspectiveCamera(VF_FOV, 16 / 9, 0.05, 200);
    this.fixed = new THREE.PerspectiveCamera(VF_FOV, 16 / 9, 0.05, 200);
    this.photo = new THREE.PerspectiveCamera(VF_FOV, 4 / 3, 0.05, 200);
    this.tp.name = 'cam.tp';
    this.fp.name = 'cam.fp';
    this.fixed.name = 'cam.fixed';
    this.photo.name = 'cam.photo';
    this.applyLayerMasks(this.masks);
  }

  /** 当前主相机 */
  get camera(): THREE.PerspectiveCamera {
    return this.active === 'tp' ? this.tp : this.active === 'fp' ? this.fp : this.fixed;
  }

  setFixedPose(p: CameraPose, blendSec?: number, o?: { role?: 'fixed' | 'ch1' | 'tripod'; layers?: readonly LayerName[] }): void {
    this.fixedRole = o?.role ?? 'fixed';
    this.fixedExtra = o?.layers ?? [];
    const toPos = new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]);
    const toQuat = quatLook(toPos, _v.set(p.target[0], p.target[1], p.target[2]), new THREE.Quaternion());
    if (p.roll) toQuat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.roll * DEG2RAD));
    const toFov = p.fov ?? VF_FOV;
    if (blendSec && blendSec > 0) {
      // 从玩家此刻看到的画面平滑过渡到机位（过场开头不跳切）
      const src = this.active === 'fixed' ? this.fixed : this.camera;
      src.updateMatrixWorld();
      this.blend = {
        fromPos: src.getWorldPosition(new THREE.Vector3()), fromQuat: src.getWorldQuaternion(new THREE.Quaternion()), fromFov: src.fov,
        toPos, toQuat, toFov, t: 0, dur: blendSec,
      };
    } else {
      this.blend = null;
      this.fixed.position.copy(toPos);
      this.fixed.quaternion.copy(toQuat);
      this.fixed.fov = toFov;
      this.fixed.updateProjectionMatrix();
      this.fixed.updateMatrixWorld();
    }
    this.applyLayerMasks(this.masks);
  }

  /** fp.zoom = z，同步 photo */
  setZoom(z: ZoomLevel): void {
    this.fp.zoom = z;
    this.photo.zoom = z;
    this.fp.updateProjectionMatrix();
    this.photo.updateProjectionMatrix();
  }

  applyLayerMasks(o: { vf: boolean; lens: LensMode; replay: boolean }): void {
    this.masks = { vf: o.vf, lens: o.lens, replay: o.replay };
    setMask(this.tp, layerMaskFor('tp', o));
    const fpMask = layerMaskFor('fp', o);
    setMask(this.fp, fpMask);
    setMask(this.photo, fpMask);
    const role: CamRole = this.fixedRole;
    setMask(this.fixed, layerMaskFor(role, { ...o, extra: this.fixedExtra }));
  }

  /** 窗口/DPR 变化时由 RenderPipeline 调用 */
  setViewport(w: number, h: number): void {
    if (!(w > 0 && h > 0)) return;
    this.vw = w;
    this.vh = h;
    const aspect = w / h;
    this.tp.aspect = aspect;
    this.fixed.aspect = aspect;
    this.fp.aspect = aspect;
    // 窄视口（< 4:3）时画框与视口同宽：让画框宽度对应的水平视场等于 4:3 下 fov 50 的水平视场（ARCH §4.7）
    this.fp.fov = aspect >= 4 / 3 ? VF_FOV : 2 * Math.atan((Math.tan((VF_FOV / 2) * DEG2RAD) * (4 / 3)) / aspect) * RAD2DEG;
    this.photo.aspect = 4 / 3;
    this.photo.fov = VF_FOV;
    for (const c of [this.tp, this.fp, this.fixed, this.photo]) c.updateProjectionMatrix();
  }

  /** 4:3 画框在屏幕上的像素矩形（UI 与判定共用） */
  frameRect(): { x: number; y: number; w: number; h: number } {
    const W = this.vw;
    const H = this.vh;
    const w = W / H >= 4 / 3 ? H * (4 / 3) : W;
    const h = W / H >= 4 / 3 ? H : W * (3 / 4);
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  /** 立即按 player 的 yaw/pitch 更新 fp/tp 矩阵（aimAt 后调用） */
  sync(): void {
    this.updateTp(0, true);
    this.updateFp();
    this.updatePhoto();
  }

  update(dt: number): void {
    const vf = this.game.sys.viewfinder;
    const replay = this.game.sys.replay.active !== null;
    if (vf.on !== this.masks.vf || vf.lens !== this.masks.lens || replay !== this.masks.replay) {
      this.applyLayerMasks({ vf: vf.on, lens: vf.lens, replay });
    }
    const snap = this.game.player.teleportSeq !== this.seenTeleport;
    this.seenTeleport = this.game.player.teleportSeq;
    this.updateTp(dt, snap);
    this.updateFixed(dt);
    this.updateFp();
    this.updatePhoto();
  }

  // ---------------------------------------------------------------- WP1 内部
  /** 固定机位此刻的水平朝向（度）：三脚架模式下身体的移动方向相对它（ARCH §4.9）。 */
  fixedYaw(): number {
    this.fixed.getWorldDirection(_w);
    return Math.atan2(_w.x, -_w.z) * RAD2DEG;
  }

  /** 第三人称相机在给定 yaw/pitch 下（含避障拉近，不含平滑）的位置：lookAtPoint('tp') 迭代用。 */
  tpCameraPosition(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
    const pivot = this.probeFrom.copy(this.game.player.position);
    pivot.y += TP_PIVOT_Y;
    const dir = this.tpOffsetDir(yaw, pitch, _w);
    const len = this.tpAllowed(pivot, dir);
    return out.copy(pivot).addScaledVector(dir, len);
  }

  /** 当前第三人称吊臂长度（调试与自测）。 */
  get boomLength(): number {
    return this.boom;
  }

  /** 视口尺寸（CSS 像素）。 */
  get viewport(): { w: number; h: number } {
    return { w: this.vw, h: this.vh };
  }

  /** 偏移方向（单位向量，从枢轴指向相机）。俯仰绕局部 x 转，偏航按 ARCH §1.3 的 yaw 约定。 */
  private tpOffsetDir(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
    const ly = TP_UP - TP_PIVOT_Y;
    const lz = TP_BACK;
    const p = pitch * DEG2RAD;
    // 抬头（pitch>0）时相机降低、低头时升高
    const y = ly * Math.cos(p) - lz * Math.sin(p);
    const z = ly * Math.sin(p) + lz * Math.cos(p);
    out.set(TP_RIGHT, y, z).applyAxisAngle(UP, -yaw * DEG2RAD);
    return out.normalize();
  }

  /** 吊臂允许长度：5 条平行射线里最近的命中 − 0.2，夹在 [0.9, 满长]。 */
  private tpAllowed(pivot: THREE.Vector3, dir: THREE.Vector3): number {
    const full = Math.hypot(TP_BACK, TP_UP - TP_PIVOT_Y, TP_RIGHT);
    const col = this.game.collision;
    // 与 dir 垂直的两个轴
    const side = _v.crossVectors(dir, UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(side, dir).normalize();
    let hit = full + TP_PAD;
    const origin = new THREE.Vector3();
    const offs: readonly [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [a, b] of offs) {
      origin.copy(pivot).addScaledVector(side, a * TP_PROBE_R).addScaledVector(up, b * TP_PROBE_R);
      const r = col.raycast(origin, dir, full + TP_PAD);
      if (r && r.distance < hit) hit = r.distance;
    }
    return clamp(hit - TP_PAD, TP_MIN, full);
  }

  private updateTp(dt: number, snap: boolean): void {
    const pl = this.game.player;
    const tx = pl.position.x;
    const ty = pl.position.y + TP_PIVOT_Y;
    const tz = pl.position.z;
    if (snap || dt <= 0) {
      this.pivot.set(tx, ty, tz);
    } else {
      this.pivot.x = damp(this.pivot.x, tx, PIVOT_LAMBDA_XZ, dt);
      this.pivot.z = damp(this.pivot.z, tz, PIVOT_LAMBDA_XZ, dt);
      this.pivot.y = damp(this.pivot.y, ty, PIVOT_LAMBDA_Y, dt);
    }
    const dir = this.tpOffsetDir(pl.yaw, pl.pitch, new THREE.Vector3());
    const allowed = this.tpAllowed(this.pivot, dir);
    // 拉近立即（不能穿墙），放远平滑
    if (snap || allowed < this.boom) this.boom = allowed;
    else this.boom = damp(this.boom, allowed, TP_RELAX_LAMBDA, dt);
    this.tp.position.copy(this.pivot).addScaledVector(dir, this.boom);
    const look = viewDir(pl.yaw, pl.pitch, _w).add(this.tp.position);
    quatLook(this.tp.position, look, this.tp.quaternion);
    this.tp.updateMatrixWorld();
  }

  private updateFp(): void {
    const onPanel = this.game.modes.has('mode.panel_vcr') || this.game.modes.has('mode.panel_console');
    if (onPanel && this.active === 'fp') {
      // 面板上叠加取景器：fp 直接取面板视点（“自动对准 CRT”，ARCH §4.7）
      this.fp.position.copy(this.fixed.position);
      this.fp.quaternion.copy(this.fixed.quaternion);
    } else {
      const pl = this.game.player;
      pl.eyeFor(pl.yaw, this.fp.position);
      quatLook(this.fp.position, viewDir(pl.yaw, pl.pitch, _w).add(this.fp.position), this.fp.quaternion);
    }
    this.fp.updateMatrixWorld();
  }

  private updatePhoto(): void {
    this.photo.position.copy(this.fp.position);
    this.photo.quaternion.copy(this.fp.quaternion);
    if (this.photo.zoom !== this.fp.zoom) {
      this.photo.zoom = this.fp.zoom;
      this.photo.updateProjectionMatrix();
    }
    this.photo.updateMatrixWorld();
  }

  private updateFixed(dt: number): void {
    const b = this.blend;
    if (!b) return;
    b.t = Math.min(b.dur, b.t + dt);
    const k = b.dur > 0 ? b.t / b.dur : 1;
    // smoothstep：机位推拉两头慢
    const s = k * k * (3 - 2 * k);
    this.fixed.position.lerpVectors(b.fromPos, b.toPos, s);
    this.fixed.quaternion.slerpQuaternions(b.fromQuat, b.toQuat, s);
    this.fixed.fov = b.fromFov + (b.toFov - b.fromFov) * s;
    this.fixed.updateProjectionMatrix();
    this.fixed.updateMatrixWorld();
    if (k >= 1) this.blend = null;
  }
}
