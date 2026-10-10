// owner: WP2
// char2 WP0（冻结）：程序化人身的全部类型。公开签名（HumanoidSpec/HumanoidRig/JointName/HumanoidMaterialMode）与 ARCH §5.1 一致，不改；
// 其余是 WP2 内部扩展（characters/player/accessories 与各区域构建器用）。见 test-artifacts/work/char2/PLAN.md §2。

import type * as THREE from 'three';
import type { Pose, V3 } from '../../core/types';

export type { V3 };

export type JointName = 'hips' | 'spine' | 'neck' | 'headSlot'
  | 'shoulderL' | 'elbowL' | 'shoulderR' | 'elbowR' | 'hipL' | 'kneeL' | 'hipR' | 'kneeR';

export type HumanoidMaterialMode = 'standard' | 'ghost' | 'replay' | 'silhouette';

export interface HumanoidSpec {
  /** 标称身高（含人头时的身高，决定各部件比例）：1.75 主角/老周；1.2 土地；1.4 黄三爷。head:'none' 时身子只到领口（主角领口 1.50，PC_DIMS.collarY） */
  height: number;
  /** hunch：脊柱前倾 12°、肩下沉 */
  build?: 'normal' | 'slim' | 'stout' | 'hunch';
  shirt: THREE.ColorRepresentation; pants: THREE.ColorRepresentation; shoes?: THREE.ColorRepresentation;
  skin?: THREE.ColorRepresentation;
  sleeves?: 'short' | 'long';
  /** 连续长袍（土地、新娘）：下摆随坐姿覆盖大腿与膝盖，内侧仍有腿。 */
  robe?: boolean;
  /** 'none' = 留空 headSlot 由外部挂载 */
  head: 'none' | 'human' | 'camera' | 'weasel';
  material?: HumanoidMaterialMode;
}

export interface HumanoidRig {
  /** 原点在两脚中间地面，面朝 -z */
  readonly root: THREE.Group;
  readonly joints: Readonly<Record<JointName, THREE.Group>>;
  readonly height: number;
  /** 默认 0.3s 过渡 */
  setPose(p: Pose, blendSec?: number): void;
  /** speed>0.1 时播放行走循环，否则保持姿势并轻微呼吸 */
  update(dt: number, speed: number): void;
  setMaterialMode(m: HumanoidMaterialMode, color?: THREE.ColorRepresentation): void;
  /** 淡入淡出（护送换层、化光） */
  setOpacity(a: number): void;
  /** 拍照判定用 */
  bounds(target: THREE.Box3): THREE.Box3;
  dispose(): void;
}

// ---------------------------------------------------------------- 内部扩展（characters/player 用，不属于冻结签名）

/** 头部外观（人头贴图）：WP2 内部。 */
export interface FaceOpts {
  skin: string; hair: string;
  hairStyle: 'short' | 'bald' | 'long' | 'none';
  age: 'young' | 'old' | 'child';
  female?: boolean;
  /** 眉眼更浓（年轻男子）/ 更淡 */
  brows?: number;
  seed?: number;
}

/** 衣服贴图与特殊效果（WP2 内部）。 */
export interface HumanoidStyle {
  /** 躯干贴图（前胸 = 左半，后背 = 右半） */
  torsoMap?: THREE.Texture;
  /** 袖子贴图（碎花之类整件同花色时） */
  sleeveMap?: THREE.Texture;
  shoeMap?: THREE.Texture;
  /** 长袍（土地）的下摆与上身贴图 */
  robeMap?: THREE.Texture;
  /** 菲涅尔描边色（土地在取景器里的土地金描边） */
  rim?: THREE.ColorRepresentation;
  /** M4 第 2 轮：魂影的调校（陆师傅：多保留原色、魂色偏暖，门岗的绿光里不再是冷灰白） */
  ghost?: { baseAmt?: number; tint?: THREE.ColorRepresentation };
}

export interface HumanoidInternal extends HumanoidRig {
  readonly spec: Readonly<HumanoidSpec>;
  /** 比例 s = height / 1.75 */
  readonly s: number;
  /** 各部件（身体网格） */
  readonly parts: Readonly<Record<string, THREE.Mesh>>;
  /** 人头网格（head:'human'/'weasel'/'camera' 时） */
  readonly headMesh: THREE.Object3D | null;
  /** 当前材质模式 */
  readonly mode: HumanoidMaterialMode;
  readonly pose: Pose;
  /** 把配件纳入材质模式切换、淡出与包围盒（accessories 用） */
  adopt(obj: THREE.Object3D, o?: { keepMaterial?: boolean }): void;
  /** 身体网格的可见性（lantern_only、尾声只剩头） */
  setBodyVisible(v: boolean): void;
  /** 当前走路相位（0..2π），配件摆动用 */
  readonly walkPhase: number;
  /** 当前行走权重（0 停 → 1 走） */
  readonly walkWeight: number;
}

// ---------------------------------------------------------------- 区域构建器接口（PLAN §2.3）

/** 构建器能用的关节：公开的 12 个 JointName（WP0 commit B 起另有腕、踝）。 */
export type BuildJoint = JointName;

/** 材质槽：每个人偶一套 MeshStandardMaterial（surface/createRigMaterials 建；同一个材质可能占几个槽，例如没有袍子贴图时 robe = sleeve）。 */
export type MatSlot = 'torso' | 'sleeve' | 'pants' | 'shoes' | 'skin' | 'belt' | 'hem' | 'robe' | 'face';

/** 体型系数（BUILD 表）：宽、厚、肚子。 */
export interface BuildDims { w: number; d: number; belly: number }

export interface BuildCtx {
  spec: Readonly<HumanoidSpec>;
  /** 已补全的人脸参数（spec.head === 'human' 时总有值） */
  face?: Readonly<FaceOpts>;
  style?: Readonly<HumanoidStyle>;
  s: number;
  build: Readonly<BuildDims>;
  joints: Readonly<Record<BuildJoint, THREE.Group>>;
  mats: Readonly<Record<MatSlot, THREE.MeshStandardMaterial>>;
  /** 每个人偶自己的（不进缓存的）几何：登记后 dispose() 释放 */
  track<T extends THREE.BufferGeometry>(g: T): T;
}

/** 挂在关节上的刚体部件（一个 Mesh，名字 = name，进 parts / bodyMeshes）。 */
export interface RigidPart {
  kind: 'rigid'; name: string; joint: BuildJoint;
  geo: THREE.BufferGeometry;
  /** 材质槽，或构建器自己建的材质（人偶接管：释放、描边） */
  slot: MatSlot | THREE.Material;
  position?: V3; rotation?: V3;
  userData?: Record<string, unknown>;
}

/** 不是身体网格的附加物（黄鼬胡须 LineSegments）：直接挂到关节，不进 parts。 */
export interface ExtraObject { joint: BuildJoint; object: THREE.Object3D }

export interface RegionResult {
  parts: RigidPart[];
  extras?: ExtraObject[];
  /** 每帧在动作 apply 之后调用（长袍随坐姿形变）；必须便宜 */
  update?(st: { dt: number; walkPhase: number; walkWeight: number; bend: number }): void;
  dispose?(): void;
}

export type RegionBuilder = (ctx: BuildCtx) => RegionResult;

/** 动作模块（motion/）的输入。 */
export interface MotionCtx {
  spec: Readonly<HumanoidSpec>;
  s: number;
  /** BUILD 的厚度系数（躺下时把背抬离地面） */
  bd: number;
  joints: Readonly<Record<BuildJoint, THREE.Group>>;
  pivot: THREE.Group;
  /** 静止时的关节位置（动作改 hips.position.y） */
  rest: { hipsY: number };
}
