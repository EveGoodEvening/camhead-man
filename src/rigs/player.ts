// owner: WP2
// 主角整体模型（ARCH §5.2）：藏蓝短袖衬衫、红袖箍“值勤”、深灰裤、黑布鞋；head:'none'，由颈部支架托住摄像头头部。
//
// 结构：root（脚底，随 PlayerController 的 position/bodyYaw）→ 人身 body.root → … → joints.neck → mount（抵消躯干的
// 前倾与呼吸，始终水平）→ 支架圆柱 head.neck + 摄像头 head.group（支架顶端 1.77）。
// 身子与假阴影在 world 层；支架与整颗头在 self_head 层（贴条字迹在 self_sticker_vf，cameraHead.ts 设好）。

import * as THREE from 'three';
import type { ModeId, Pose } from '../core/types';
import type { PlayerController } from '../core/player';
import { LENS_FORWARD } from '../core/player';
import { DEG2RAD, angleDiff } from '../core/math';
import { PALETTE } from '../data/palette';
import { ACCESSORIES, clothShoeTexture, uniformShirtTexture } from './accessories';
import { createBlobShadow } from './blobShadow';
import { createCameraHead, PC_DIMS, type CameraHead, type CameraHeadInternal } from './cameraHead';
import { addRim, createHumanoidInternal, setMaterialOpacity, type HumanoidInternal, type HumanoidRig } from './humanoid';

export interface PlayerModel {
  /** 加入场景后跨区域常驻 */
  readonly root: THREE.Group;
  /** 藏蓝短袖衬衫 #2E3A55、左臂红袖箍“值勤”、深灰裤、黑布鞋；head:'none' */
  readonly body: HumanoidRig;
  /** 由颈部支架圆柱托住 */
  readonly head: CameraHead;
  /** 圆形假阴影 */
  readonly blob: THREE.Mesh;
  /** 头是否在身子上（三脚架与结局中为 false） */
  readonly headMounted: boolean;
  /** 开场坐在椅子上（sit）等；移动时自动回到 walk/stand */
  setPose(p: Pose, blendSec?: number): void;
  /** P14“身子一点点空下去”（淡出时切透明材质，结束后恢复） */
  setBodyOpacity(a: number, sec?: number): void;
  /** 尾声：身体不见，头留在支架上 */
  setVisible(v: boolean): void;
  /** 贴条中心的世界坐标 */
  stickerWorld(target?: THREE.Vector3): THREE.Vector3;
  /**
   * M1d 补写（ARCH §5.2）：换一局（新游戏、读档、回标题）时复位——身子可见、不透明、站姿，头装回颈部支架，视频线拔出并重新下垂。
   * 由 Game 调用（上一局的结局可能让身子不见、头留在门楣上）；区域不调用。
   */
  reset(): void;
  /** ARCH §3.2 第 9 步由 Game.step 调用：playerModel.update(dt, player, modes.top)（冻结时不调用） */
  update(dt: number, p: PlayerController, mode: ModeId): void;
  /**
   * M4 补写：第三人称相机（Game 构造时传 cameras.tp）。探索模式下相机离头/身子不到 1.2m（小房间里吊臂被推近）时，
   * 头和身子在 0.2 秒内淡到 0.35，免得铁皮帽和摄像头正好横在相机与要看的东西之间；离开后恢复。
   */
  watchCamera?(cam: THREE.Camera | null): void;
}

/** 主角身子的冷色轮廓光（M1c look-dev 冻结）：颜色与强度（addRim 的 color × strength，掠射边缘 pow 3）。 */
export const PLAYER_RIM = { color: '#6A7FA8', strength: 0.35 } as const;
/** M4：三脚架合影（mode.tripod）时的轮廓光强度：藏蓝的身子在夜里要读得出来（“伙计第一次进了画”） */
export const PLAYER_RIM_TRIPOD = 0.7;
/** M4：第三人称相机离头/身子太近时（小房间里挡住要看的东西）淡到这个不透明度 */
const OCCLUDE_NEAR = 1.2;
const OCCLUDE_ALPHA = 0.35;

/** 这些模式下头跟着视角转（取景器、回放、面板上叠取景器时镜头对着 CRT）。 */
const LOOK_MODES: ReadonlySet<ModeId> = new Set<ModeId>(['mode.viewfinder', 'mode.replay', 'mode.panel_vcr', 'mode.panel_console', 'mode.dialogue']);

export function createPlayerModel(): PlayerModel {
  const root = new THREE.Group();
  root.name = 'player';
  const body: HumanoidInternal = createHumanoidInternal(
    // M4：肤色提亮一点、皮肤更哑（原 #9E7B62 + 冷色轮廓光像上了清漆的木棍）
    { height: PC_DIMS.bodyH, build: 'normal', shirt: PALETTE.UNIFORM, pants: '#3B3D42', shoes: '#141416', skin: '#A98A74', sleeves: 'short', head: 'none' },
    undefined,
    { torsoMap: uniformShirtTexture(), shoeMap: clothShoeTexture() },
  );
  body.root.name = 'playerBody';
  root.add(body.root);
  const J = body.joints;

  // 领子、肩章、左臂红袖箍
  const collar = ACCESSORIES.shirtCollar(body.s, PALETTE.UNIFORM, { open: true });
  J.spine.add(collar);
  const band = ACCESSORIES.armband(body.s);
  J.shoulderL.add(band);
  body.adopt(collar);
  body.adopt(band);
  // 冷色轮廓光（M1c look-dev）：藏蓝衬衫在夜里会和暗地面糊成一片，给身子的材质加一圈很淡的菲涅尔描边（与土地的金描边同一段着色器）
  // M4：皮肤与布鞋不加（皮肤上一圈蓝光像清漆木棍，鞋在侧光下成了发蓝的扁板）
  const rimmed = new Set<THREE.Material>();
  body.root.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const mm of Array.isArray(m) ? m : m ? [m] : []) {
      const std = mm as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial || rimmed.has(std)) continue;
      if (std.userData.skin === true || std.userData.shoes === true) continue;
      rimmed.add(std);
      addRim(std, PLAYER_RIM.color, PLAYER_RIM.strength);
    }
  });
  const rimColor = new THREE.Color(PLAYER_RIM.color);
  let rimStrength: number = PLAYER_RIM.strength;
  const setRim = (k: number) => {
    if (Math.abs(k - rimStrength) < 1e-4) return;
    rimStrength = k;
    for (const m of rimmed) {
      const u = m.userData.rimUniform as { value: THREE.Color } | undefined;
      u?.value.copy(rimColor).multiplyScalar(k);
    }
  };

  // 头与支架：挂在领口，mount 每帧抵消躯干旋转，让云台保持水平
  const head: CameraHeadInternal = createCameraHead();
  const mount = new THREE.Group();
  mount.name = 'headMount';
  // 头与支架整体往后让一点，让俯仰 0 时的镜头点（玻璃在云台轴前约 0.21m）正好落在 PlayerController 的 eye 上——身体中轴前 LENS_FORWARD（0.18m）
  // （ARCH §5.2“lensAnchor 俯仰 0 时与 eye 重合”；原来差 3.2cm，m1c.lens_anchor 自测随呼吸在 3cm 阈值两边跳，M3）
  mount.position.z = -head.lensAnchor.position.z - LENS_FORWARD;
  J.neck.add(mount);
  mount.add(head.neck);
  head.group.position.y = PC_DIMS.headBottomY - PC_DIMS.collarY;
  mount.add(head.group);
  head.bindBody({ spine: J.spine, hips: J.hips });

  const blob = createBlobShadow(0.36, 0.5);
  root.add(blob);

  /** 身子上除摄像头以外的全部网格（淡出、隐藏用）。 */
  const bodyMeshes = (): THREE.Mesh[] => {
    const out: THREE.Mesh[] = [];
    body.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (let a: THREE.Object3D | null = m; a; a = a.parent) if (a === head.group) return;
      out.push(m);
    });
    return out;
  };

  let opacity = 1, fadeFrom = 1, fadeTo = 1, fadeT = 1, fadeDur = 0;
  let visible = true;
  /** 相机挡视线时的淡出系数（M4；与 P14 的 opacity 相乘） */
  let occ = 1;
  let watchCam: THREE.Camera | null = null;
  const headMats: THREE.Material[] = [];
  for (const r of [head.group, head.neck] as THREE.Object3D[]) {
    r.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const mm of Array.isArray(m) ? m : m ? [m] : []) if (!headMats.includes(mm)) headMats.push(mm);
    });
  }
  // 头部材质也会淡（透明变体由进区域的预热一并编好：warmup 按 fadeCapable 把透明变体画一遍）
  root.userData.fadeCapable = true;
  let headAlpha = 1;
  const applyHeadAlpha = (a: number) => {
    if (Math.abs(a - headAlpha) < 1e-4) return;
    headAlpha = a;
    for (const m of headMats) setMaterialOpacity(m, a);
  };
  const applyOpacity = (a: number) => {
    opacity = a;
    body.setOpacity(a * occ);
    const show = visible && a > 0.001;
    for (const m of bodyMeshes()) m.visible = show;
    blob.visible = show;
    (blob.material as THREE.MeshBasicMaterial).opacity = 0.5 * a;
  };

  const tmpQ = new THREE.Quaternion(), rootQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();

  const model: PlayerModel = {
    root,
    body,
    head,
    blob,
    get headMounted() {
      return head.mounted;
    },
    setPose(p, blendSec) {
      body.setPose(p, blendSec);
    },
    setBodyOpacity(a, sec = 0) {
      const target = Math.max(0, Math.min(1, a));
      if (sec <= 0) {
        fadeT = 1;
        applyOpacity(target);
        return;
      }
      fadeFrom = opacity;
      fadeTo = target;
      fadeDur = sec;
      fadeT = 0;
    },
    setVisible(v) {
      visible = v;
      applyOpacity(opacity);
    },
    stickerWorld(target = new THREE.Vector3()) {
      head.stickerAnchor.updateWorldMatrix(true, false);
      return head.stickerAnchor.getWorldPosition(target);
    },
    reset() {
      visible = true;
      fadeT = 1;
      fadeFrom = fadeTo = 1;
      occ = 1;
      applyHeadAlpha(1);
      setRim(PLAYER_RIM.strength);
      applyOpacity(1);
      body.setPose('stand', 0);
      head.cable.plugTo(null);
      if (!head.mounted) head.reattach();
      head.resetCable();
    },
    update(dt, p, mode) {
      root.position.copy(p.position);
      root.rotation.y = -p.bodyYaw * DEG2RAD;
      const speed = Math.hypot(p.velocity.x, p.velocity.z);
      const moving = speed > 0.1;
      // 移动时自动从坐、蹲、仰头等姿势回到站立/行走（ARCH §5.2）
      if (moving && body.pose !== 'stand' && body.pose !== 'walk' && body.pose !== 'carry') body.setPose('stand', 0.25);
      body.update(dt, moving ? speed : 0);

      if (fadeT < 1) {
        fadeT = Math.min(1, fadeT + dt / fadeDur);
        applyOpacity(fadeFrom + (fadeTo - fadeFrom) * fadeT);
      }
      // 三脚架合影时轮廓光加强（M4）
      setRim(mode === 'mode.tripod' ? PLAYER_RIM_TRIPOD : PLAYER_RIM.strength);
      // 第三人称相机太近：头和身子淡到 0.35（M4）
      let occTarget = 1;
      if (watchCam && mode === 'mode.explore' && head.mounted) {
        head.group.getWorldPosition(tmpV);
        const dHead = watchCam.position.distanceTo(tmpV);
        tmpV.copy(root.position);
        tmpV.y += 1.2;
        const dBody = watchCam.position.distanceTo(tmpV);
        if (Math.min(dHead, dBody) < OCCLUDE_NEAR) occTarget = OCCLUDE_ALPHA;
      }
      if (occ !== occTarget) {
        const step = dt / 0.2;
        occ = occTarget < occ ? Math.max(occTarget, occ - step) : Math.min(occTarget, occ + step);
        applyOpacity(opacity);
        applyHeadAlpha(occ);
      }

      // 云台保持水平：mount 的世界朝向 = root 的朝向
      root.updateWorldMatrix(true, true);
      J.neck.getWorldQuaternion(tmpQ);
      root.getWorldQuaternion(rootQ);
      mount.quaternion.copy(tmpQ.invert().multiply(rootQ));

      let scanning = false;
      if (LOOK_MODES.has(mode)) {
        head.setLook(angleDiff(p.bodyYaw, p.yaw), p.pitch);
      } else if (mode === 'mode.explore') {
        head.setLook(0, moving ? -4 : 0);
        scanning = true;
      } else {
        head.setLook(0, 0);
      }
      head.update(dt, { moving, scanning, recBlink: true });
    },
    watchCamera(cam) {
      watchCam = cam;
    },
  };
  applyOpacity(1);
  return model;
}
