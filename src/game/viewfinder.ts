// owner: WP5
// 取景器（ARCH §6.8.1）：镜头（常光/红外）、变焦档、温度读数。高清贴图与 viewVariant 的切换不在这里（WP1 的 AreaContextImpl.updateViews()）。
//
// WP5 内部约定（不属于冻结签名，只供 WP5 自己的 photo/read/cctv 使用）：
// - syncPhotoCamera()：把 cameras.photo 摆成“取景器此刻看到的画面”。拍照判定、读字、温度读数、CH1 自身画面都从这里取相机，
//   这样判定只依赖本包算出的位姿（fp 的世界矩阵，或面板叠加时的面板视点），不依赖 WP1 何时同步 photo 相机。
// - poseCamera()/layerMaskBits() 是纯函数工具。

import * as THREE from 'three';
import type { ApiResult, CameraPose, LensMode, ModeId, ZoomLevel } from '../core/types';
import { ZOOM_STEPS, fail, ok } from '../core/types';
import type { Game } from '../core/game';
import { LAYER, layerMaskFor } from '../core/layers';
import type { LayerName } from '../core/layers';
import { DEG2RAD } from '../core/math';
import { F } from '../data/ids';
import { TEMP_C } from '../data/render';
import { POST_PRESETS } from '../fx/presets';
import { IrRenderer } from '../fx/ir';

/** 取景器 1× 时的垂直视场（ARCH §4.7：photo 相机恒为 4:3、vfov 50，再乘 zoom）。 */
export const VF_FOV = 50;
export const VF_ASPECT = 4 / 3;

/** 图层名列表 → Layers.mask 位掩码。 */
export function layerMaskBits(names: readonly LayerName[]): number {
  let m = 0;
  for (const n of names) m |= 1 << LAYER[n];
  return m;
}

/** 按 CameraPose 摆相机（位置、注视点、roll；fov 给了才改）。不更新投影矩阵。 */
export function poseCamera(cam: THREE.PerspectiveCamera, p: CameraPose): void {
  cam.position.set(p.pos[0], p.pos[1], p.pos[2]);
  cam.up.set(0, 1, 0);
  cam.lookAt(p.target[0], p.target[1], p.target[2]);
  if (p.roll) cam.rotateZ(p.roll * DEG2RAD);
  if (p.fov !== undefined) cam.fov = p.fov;
}

/** 取景器是否叠在录像机/监控台面板上（ARCH §4.6 叠加规则）。 */
export function vfOnPanel(stack: readonly ModeId[]): boolean {
  return stack.includes('mode.panel_vcr') || stack.includes('mode.panel_console');
}

/** 可渲染节点（与 core/layers.ts 的 isRenderableBy 口径一致）。 */
export function isRenderableNode(o: THREE.Object3D): boolean {
  const r = o as THREE.Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
  return r.isMesh === true || r.isLine === true || r.isPoints === true || r.isSprite === true;
}

/** 自身与全部祖先都 visible。Raycaster 不看 visible（ARCH §16 #9），射线结果要自己过滤。 */
export function visibleChain(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}

/** 自身或任一祖先带 userData[key] === true。 */
export function flaggedChain(o: THREE.Object3D, key: string): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) if (n.userData[key] === true) return true;
  return false;
}

/**
 * 这个网格挡不挡视线（M1d：准星聚焦、拍照遮挡、读字遮挡共用同一条规则，ARCH §6.6 聚焦规则 1、§6.8.4 d）：
 * 自身 userData.occlude === false、自身或祖先 userData.noOcclude → 不挡；否则只要有一个材质可见、材质上没有 noOcclude/occlude:false、
 * 且不透明（mat.transparent 为假，或网格 userData.occlude === true 强制）就挡。透明网格（文字贴花、玻璃、雨丝）默认不挡。
 */
export function occludesView(o: THREE.Object3D): boolean {
  if (o.userData.occlude === false || flaggedChain(o, 'noOcclude')) return false;
  const forced = o.userData.occlude === true;
  const m = (o as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }).material;
  const mats = Array.isArray(m) ? m : m ? [m] : [];
  return mats.some(x => x.visible !== false && x.userData.noOcclude !== true && x.userData.occlude !== false && (forced || !x.transparent));
}

/** 网格的第一个材质（数组材质取第一个）。 */
export function firstMaterial(o: THREE.Object3D): THREE.Material | null {
  const m = (o as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }).material;
  if (!m) return null;
  return Array.isArray(m) ? (m[0] ?? null) : m;
}

const _scale = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class ViewfinderSystem {
  /** 恒为 4/3（ARCH 写作字面量类型 `4 / 3`，TS 不支持该类型写法，改为 number） */
  readonly frameAspect: number = 4 / 3;
  protected readonly game: Game;
  private _on = false;
  private _lens: LensMode = 'normal';
  private _zoom: ZoomLevel = 1;
  /** 已压入后期栈的叠加层（pop 只弹自己压过的） */
  private vfPushed = false;
  private irPushed = false;
  private readonly raycaster = new THREE.Raycaster();

  constructor(game: Game) {
    this.game = game;
    // 过场压在取景器上时撤掉取景器/红外后期层（固定机位不是取景器画面），过场结束再压回（M1d）
    game.events.on('mode', () => this.syncPost());
  }

  get on(): boolean {
    return this._on;
  }
  get lens(): LensMode {
    return this._lens;
  }
  get zoom(): ZoomLevel {
    return this._zoom;
  }

  /** 'ir' 需要 r2.ability_ir，否则 { ok:false, reason:'no_ability' } */
  setLens(l: LensMode): ApiResult {
    if (l === 'ir' && !this.game.state.flag(F.R2_ABILITY_IR)) return fail('no_ability', { lens: this._lens });
    if (l !== this._lens) {
      this._lens = l;
      this.game.audio.sfx('ir_toggle');
      this.syncPost();
      this.applyMasks();
      this.game.events.emit('lens', { lens: l });
    }
    return ok({ lens: this._lens });
  }

  /** 1→2→3→4→6，带变焦马达声与镜头环 */
  stepZoom(dir: 1 | -1): ZoomLevel {
    const i = ZOOM_STEPS.indexOf(this._zoom);
    const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir))] ?? this._zoom;
    if (next !== this._zoom) {
      this._zoom = next;
      this.applyZoom();
      this.game.audio.sfx('zoom_motor');
      this.game.events.emit('zoom', { zoom: next });
    }
    return this._zoom;
  }

  /**
   * 新游戏/读档/调试开局时由 Game 调用（M1c 补写，ARCH §6.8.1）：镜头回常光、倍率回 1×（镜头环一起转回）。
   * 离开取景器仍不复位（GDD 设计），只有换一局才复位——否则上一局的红外镜头会带进没有 r2.ability_ir 的新局。
   */
  resetOptics(): void {
    const lensChanged = this._lens !== 'normal';
    const zoomChanged = this._zoom !== 1;
    this._lens = 'normal';
    this._zoom = 1;
    this.syncPost();
    this.applyZoom();
    this.applyMasks();
    if (lensChanged) this.game.events.emit('lens', { lens: 'normal' });
    if (zoomChanged) this.game.events.emit('zoom', { zoom: 1 });
  }

  /** 取景器中心射线（与判定用的 photo 相机同一条：面板叠加时从面板视点出发）。 */
  centerRay(target: THREE.Ray = new THREE.Ray()): THREE.Ray {
    const cam = this.syncPhotoCamera();
    cam.getWorldPosition(target.origin);
    cam.getWorldDirection(target.direction);
    return target;
  }

  /**
   * 红外：准星射线首个命中物体的 tempC（0.1℃）。取景器未开或常光时 null。
   * 只算红外画面里真的画得出来的网格：可见、在取景器掩码里、不是 irHide、不是 Line/Points（红外下隐藏，ARCH §6.8.2）、不是 hitProxy。
   * 什么都没打中（天空、远处雾里）按环境温度 18℃ 显示——GDD §3.7 要求读数永远显示。
   */
  tempReading(): number | null {
    if (!this._on || this._lens !== 'ir') return null;
    const root = this.game.areas.current?.root;
    const cam = this.syncPhotoCamera();
    if (!root) return TEMP_C.ambient;
    const rc = this.raycaster;
    cam.getWorldPosition(rc.ray.origin);
    cam.getWorldDirection(rc.ray.direction);
    rc.near = cam.near;
    rc.far = cam.far;
    rc.layers.mask = cam.layers.mask;
    for (const h of rc.intersectObject(root, true)) {
      const o = h.object;
      if (!(o as THREE.Mesh).isMesh || !visibleChain(o) || flaggedChain(o, 'irHide')) continue;
      const mat = firstMaterial(o);
      if (mat && mat.visible === false) continue;
      return Math.round(IrRenderer.tempOf(o) * 10) / 10;
    }
    return TEMP_C.ambient;
  }

  /**
   * 屏幕 NDC → 4:3 画框 NDC 的缩放（判定与读字用；窄视口时画框与视口同宽，见 ARCH §4.7）。
   * frameRect 是视口中央最大的 4:3 矩形，所以视口 = 2·x + w、2·y + h。
   */
  frameNdcScale(): { sx: number; sy: number } {
    const r = this.game.cameras.frameRect();
    if (r.w <= 0 || r.h <= 0) return { sx: 1, sy: 1 };
    return { sx: (2 * r.x + r.w) / r.w, sy: (2 * r.y + r.h) / r.h };
  }

  /** 由 mode.viewfinder 的 enter/exit 调用（冻结签名）：开关取景器（发 'viewfinder' 事件、推/弹 vf 后期叠加；M1a 补写）。 */
  setOn(on: boolean): void {
    if (on === this._on) return;
    this._on = on;
    // 离开取景器不复位镜头与倍率（ARCH §6.8.1）；再次进入沿用。
    this.syncPost();
    this.applyZoom();
    this.applyMasks();
    this.game.events.emit('viewfinder', { on });
  }

  /**
   * 每帧（ARCH §3.2 第 6 步由 Game.step 调用）。取景器叠在面板上时 fp 取面板视点由 CameraRig 做（ARCH §4.7）；
   * 判定用的 photo 相机每次由 syncPhotoCamera() 现摆，所以这里没有每帧工作。
   */
  update(_dt: number): void {
    // 故意留空：镜头、倍率只在动作里变；温度读数按需现算（tempReading）
  }

  // ------------------------------------------------------------------ WP5 内部

  /** 取景器叠在面板上时的面板视点；否则 null。 */
  panelViewPose(): CameraPose | null {
    const stack = this.game.modes.stack;
    if (!stack.includes('mode.viewfinder')) return null;
    if (stack.includes('mode.panel_vcr')) return this.game.sys.vcr.viewPose;
    if (stack.includes('mode.panel_console')) return this.game.sys.cctv.viewPose;
    return null;
  }

  /** 取景器（常光/红外、回放中）此刻应有的图层掩码位（ARCH §4.7 的 fp 行）。 */
  fpMaskBits(): number {
    return layerMaskBits(layerMaskFor('fp', { vf: true, lens: this._lens, replay: this.game.sys.replay.active !== null }));
  }

  /**
   * 把 cameras.photo 摆成取景器此刻的画面并返回它：位姿取 fp 的世界矩阵（面板叠加时取面板视点），
   * aspect 恒 4/3、vfov 50、zoom = 当前倍率，图层 = 取景器掩码。拍照判定、读字、温度读数、CH1 都用它（ARCH §6.8.4 第 2 步）。
   */
  syncPhotoCamera(): THREE.PerspectiveCamera {
    const cams = this.game.cameras;
    const cam = cams.photo;
    const pose = this.panelViewPose();
    if (pose) {
      poseCamera(cam, { pos: pose.pos, target: pose.target, roll: pose.roll });
    } else {
      const fp = cams.fp;
      fp.updateWorldMatrix(true, false);
      fp.matrixWorld.decompose(cam.position, cam.quaternion, _scale);
      cam.near = fp.near;
      cam.far = fp.far;
    }
    cam.fov = VF_FOV;
    cam.aspect = VF_ASPECT;
    cam.zoom = this._zoom;
    cam.layers.mask = this.fpMaskBits();
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    return cam;
  }

  /** 世界点 p 在取景器画框里的 NDC（z > 1 或在相机后方时 behind = true）。 */
  frameNdc(p: THREE.Vector3, target: THREE.Vector3 = new THREE.Vector3()): { ndc: THREE.Vector3; behind: boolean } {
    const cam = this.syncPhotoCamera();
    cam.getWorldDirection(_dir);
    const behind = _dir.dot(target.copy(p).sub(cam.position)) <= 0;
    target.copy(p).project(cam);
    return { ndc: target, behind };
  }

  private applyZoom(): void {
    this.game.cameras.setZoom(this._zoom);
    this.game.playerModel.head.setZoom(this._zoom);
  }

  private applyMasks(): void {
    this.game.cameras.applyLayerMasks({ vf: this._on, lens: this._lens, replay: this.game.sys.replay.active !== null });
  }

  /**
   * vf 叠加只在取景器开启时；ir 叠加只在取景器开启且镜头为红外时（离开取景器后第三人称画面回到常光）。
   * 栈上有 mode.cutscene 时两层都撤掉（M1d）：过场一律是固定机位，不该带着 4:3 黑边、×2.5 色差或红外伪彩。
   */
  private syncPost(): void {
    const post = this.game.pipeline.post;
    const live = this._on && !this.game.modes.has('mode.cutscene');
    const wantVf = live;
    const wantIr = live && this._lens === 'ir';
    if (wantVf && !this.vfPushed) post.push('vf', POST_PRESETS.vf);
    if (!wantVf && this.vfPushed) post.pop('vf');
    this.vfPushed = wantVf;
    if (wantIr && !this.irPushed) post.push('ir', POST_PRESETS.ir);
    if (!wantIr && this.irPushed) post.pop('ir');
    this.irPushed = wantIr;
  }
}
