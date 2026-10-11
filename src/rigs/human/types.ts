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

/** 头部预设（WP-H 的头型；缺省由 age/female 推出：old → oldMan/oldWoman，child → boy/girl，其余 man/woman）。 */
export type HeadPreset = 'man' | 'woman' | 'oldMan' | 'oldWoman' | 'boy' | 'girl' | 'deity';

/** 发型（char2 扩展；旧名仍有效：'short' = 'crop'，'long' = 低发髻 chignon）。 */
export type HairStyle = 'short' | 'bald' | 'long' | 'none' | 'crop' | 'side_part' | 'thin_old' | 'flat_top' | 'bun' | 'child_bowl';

/** 塑形滑杆（-1..1，0 = 头型预设的缺省）。 */
export type SculptKey = 'jawW' | 'chin' | 'cheekFull' | 'cheekbone' | 'noseLen' | 'noseW' | 'noseBridge' | 'browRidge'
  | 'foreheadH' | 'faceLen' | 'earSize' | 'earlobe' | 'lipFull' | 'eyeSize';

/** 脸部画法（faceTexture）。 */
export interface FacePaint {
  eyeShape?: 'single' | 'inner_fold' | 'double' | 'droop';
  brow?: 'straight' | 'arched' | 'bushy' | 'thin' | 'white';
  /** 0..1 */
  wrinkles?: number;
  /** 0..1，只画在成年男人脸上 */
  stubble?: number;
  /** 0..1 */
  blush?: number;
  /** 唇色（CSS 颜色） */
  lips?: string;
  /** 老人斑 0..1 */
  spots?: number;
  /** 痣：贴图 [u, v]（0..1） */
  mole?: [number, number];
  /** 嘴角上扬 -1..1（0 = 平；> 0 嘴角上翘）。char2 集成补：土地爷缺省笑，黄三爷滑笑 */
  smile?: number;
}

/** 头部外观（人头贴图与头型）：WP2 内部。char2 起 hairStyle 扩充、加 head/sculpt/paint（都可省）。 */
export interface FaceOpts {
  skin: string; hair: string;
  hairStyle: HairStyle;
  age: 'young' | 'old' | 'child';
  female?: boolean;
  /** 眉眼更浓（年轻男子）/ 更淡 */
  brows?: number;
  seed?: number;
  head?: HeadPreset;
  sculpt?: Partial<Record<SculptKey, number>>;
  paint?: FacePaint;
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
  /** char2：服装款式（WP-U/WP-L 实现，WP-C 按角色选；缺省见 garmentOf） */
  garment?: Partial<GarmentSpec>;
  /** char2：体型覆盖（缺省由 profileOf 从 spec/face 推出） */
  profile?: Partial<BodyProfile>;
  /** fix1：手指弯曲倍数（1 = 放松；老周端缸子 ≈ 2.4，握住缸把） */
  handCurl?: number;
}

/**
 * 体型（PLAN §2.6）：profileOf(spec, face, style) 推出、style.profile 覆盖。
 * bw/bd/belly = 宽/厚/肚子（BUILD 表）；bust 0..1；waistTaper = 腰围系数（女 0.88）；hipW = 臀宽系数（女 1.08）；
 * kyphosis = 胸椎后凸（弧度，驼背）；legScale = 髋高 / 成年人髋高（儿童 0.926、土地 0.884）；headScale 头的缩放（儿童 1.3、土地 1.25）。
 */
export interface BodyProfile {
  sex: 'm' | 'f';
  age: 'child' | 'young' | 'adult' | 'old';
  build: 'normal' | 'slim' | 'stout' | 'hunch';
  deity?: boolean;
  headScale: number;
  bw: number; bd: number; belly: number;
  bust: number; waistTaper: number; hipW: number;
  kyphosis: number; legScale: number;
}

/** 服装款式（PLAN §2.6、§3.2、§3.3）：WP-U 做上衣、领、门襟、口袋、袖口；WP-L 做裤/袍/裙与鞋。 */
export interface GarmentSpec {
  top: 'tshirt' | 'work_shirt' | 'zhongshan' | 'jacket' | 'blouse' | 'cotton_padded' | 'robe_top';
  collar: 'none' | 'crew' | 'shirt' | 'shirt_open' | 'stand' | 'mandarin';
  /** side_frog = 大襟盘扣（王奶奶） */
  placket?: 'none' | 'buttons' | 'zhongshan5' | 'side_frog';
  pockets?: 'none' | 'chest1' | 'chest2' | 'zhongshan4';
  tucked?: boolean;
  /** 没塞进去的下摆比 WAIST 低多少（m×s） */
  hemDrop?: number;
  bottom: 'trousers' | 'work_trousers' | 'robe' | 'qipao_skirt';
  cuffs?: 'none' | 'band' | 'turnup';
  shoes: 'cloth' | 'leather' | 'sneaker' | 'boot' | 'embroidered';
}

export interface HumanoidInternal extends HumanoidRig {
  readonly spec: Readonly<HumanoidSpec>;
  /** 比例 s = height / 1.75 */
  readonly s: number;
  /** 各部件（身体网格）：刚体部件按名字；蒙皮部件是按材质槽合并后的 SkinnedMesh（torso、sleeves、pants、shoes、skin、belt、hem、robe）与 own 部件（collar……） */
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
  /** char2：腕、踝（不属于公开 JointName；肘/膝的子关节，手和鞋挂在这里） */
  readonly extraJoints: Readonly<Record<ExtraJointName, THREE.Group>>;
  /** char2：体型 */
  readonly profile: Readonly<BodyProfile>;
  /** char2：地标（配件按它摆） */
  readonly land: Readonly<Landmarks>;
  /** fix1：已补全的服装款式（配件、torsoSurface 按真的衣服外表面摆） */
  readonly garment?: Readonly<GarmentSpec>;
}

// ---------------------------------------------------------------- 关节、骨骼、地标（PLAN §2.1、§2.5）

/** char2 新增的内部关节：wristL/R 在肘下、ankleL/R 在膝下。 */
export type ExtraJointName = 'wristL' | 'wristR' | 'ankleL' | 'ankleR';
/** 构建器能用的关节：公开的 12 个 JointName + 腕、踝。 */
export type BuildJoint = JointName | ExtraJointName;
/** 骨骼名（BONES 的元素）：全部关节 + pivot（不加权的根）。 */
export type BoneName = BuildJoint | 'pivot';

/** 关节布局：每个关节相对父关节的局部位置（×s 已乘），以及绑定姿势（全部旋转为 0、不加驼背）下在人偶根空间里的位置。 */
export interface JointLayout {
  /** true = 旧版布局（成年人数值套到所有体型，WP0 时全部区域都是旧版构建器） */
  legacy: boolean;
  local: Readonly<Record<BuildJoint, V3>>;
  /** 绑定姿势下的人偶根空间位置（pivot 在原点） */
  bind: Readonly<Record<BoneName, V3>>;
  /** 静止时 hips 的高度（= local.hips[1]） */
  hipsY: number;
  /** 领口高度（neck 关节的 bind y）：成年人 1.50s、儿童 1.435s */
  collarY: number;
}

/**
 * 头部地标（PLAN §2.5）：headSlot 局部坐标，已乘 s × headScale。L = 人物自己的左边（-x；人偶面朝 -z、右手在 +x）。
 * WP-H 必须做到 ±3mm；WP-C 按它摆帽子、眼镜、发簪。
 */
export interface HeadLandmarks {
  /** s × headScale */
  scale: number;
  headOrigin: V3; crownSkinY: number; chin: V3;
  /** 下颌角（右 = +x；左边取 x 的相反数） */
  jawAngleR: V3;
  eyeL: V3; eyeR: V3; browY: number; noseTip: V3; noseBaseY: number; mouth: V3;
  earL: V3; earR: V3; earHeight: number;
  /** 当前发型（face.hairStyle 归一后）的头顶高度 */
  hairTop: number;
  /** 各发型的头顶高度（归一后的发型名） */
  hairTopBy: Readonly<Record<'crop' | 'side_part' | 'thin_old' | 'bald' | 'flat_top' | 'bun' | 'long' | 'child_bowl' | 'none', number>>;
  bunCentre: V3; bunR: number;
  /** 帽箍下沿（压在头发上） */
  capSeatY: number;
  glassesBridge: V3; anchorMouth: V3; anchorHead: V3;
}

/** 躯干地标（spine/shoulder/hips 局部，×s）：WP-U 必须做到，WP-C 用。 */
export interface TorsoLandmarks {
  /** spine 局部：胸口锚点（在胸前衣服表面 ±1cm） */
  anchorChest: V3;
  /** shoulder 局部 y：量袖子半径的高度（-0.10s） */
  sleeveProbeY: number;
  /** 长袖/短袖在 sleeveProbeY 处的半径（±3mm），袖箍半径 */
  sleeveRLong: number; sleeveRShort: number; armbandR: number;
  /** 摄像头线缆的碰撞平面（cameraHead.bindBody）：spine 局部 y 在 backPlaneY 区间内背面 z ≤ backPlaneZ；hips 局部臀后 z ≤ hipBackZ */
  backPlaneY: readonly [number, number]; backPlaneZ: number; hipBackZ: number;
}

/** 手臂与手（elbow/wrist 局部，×s）。 */
export interface ArmLandmarks {
  /** elbow 局部的腕关节 y（成年 -0.245s） */
  wristY: number;
  /** elbow 局部的掌心 y（-0.30s ±0.01；r3 negative.ts、缸子、拐杖、竹篮靠它） */
  palmCentreY: number;
  /** 手长（腕到中指尖）、掌宽、指节处厚度 */
  handLen: number; palmW: number; knuckleT: number;
}

/** 腿与脚（knee/ankle 局部，×s）。 */
export interface LegLandmarks {
  /** knee 局部的踝关节 y（成年 -0.415s） */
  ankleY: number;
  /** 踝关节离地高度（站立） */
  ankleHeight: number;
  /** 鞋长、前掌宽 */
  shoeLen: number; shoeW: number;
  /** 坐姿的身体下移（sit bodyDrop × s）；座面接触高度 = 坐姿大腿最低点（旧版量出来 0.369s：1.75m 0.369m、1.5m 0.317m；坐姿髋关节高 0.47s） */
  sitDrop: number; seatY: number;
}

export interface Landmarks { head: HeadLandmarks; torso: TorsoLandmarks; arm: ArmLandmarks; leg: LegLandmarks }

// ---------------------------------------------------------------- 接缝（PLAN §2.4）

/** 接缝圈：绑定姿势、人偶根空间。顶点 0 在 +x、按 -z（前）方向走（u = i / count：0 右侧、0.25 正前、0.5 左侧、0.75 后背）。 */
export interface SeamRing {
  name: 'NECK_TOP' | 'WAIST';
  count: number;
  /** count×3：位置（人偶根空间，绑定姿势） */
  pos: Float32Array;
  /** count×3：单位法线 */
  nor: Float32Array;
  centre: V3;
  /** 圈所属关节（NECK_TOP → headSlot，WAIST → hips）与它在绑定姿势下的根空间位置（换到关节局部：减去它） */
  joint: 'headSlot' | 'hips';
  jointBind: V3;
  /** 这一圈每个顶点的蒙皮（BONES 下标与权重，和为 1） */
  skin: { bones: readonly number[]; weights: readonly number[] };
}

export interface Seams { NECK_TOP: SeamRing; WAIST: SeamRing }

// ---------------------------------------------------------------- 区域构建器接口（PLAN §2.3）

/** 材质槽：每个人偶一套 MeshStandardMaterial（surface/createRigMaterials 建；同一个材质可能占几个槽，例如没有袍子贴图时 robe = sleeve）。 */
export type MatSlot = 'torso' | 'sleeve' | 'pants' | 'shoes' | 'skin' | 'belt' | 'hem' | 'robe' | 'face';

/** 体型系数（BUILD 表）：宽、厚、肚子。 */
export interface BuildDims { w: number; d: number; belly: number }

export interface BuildCtx {
  spec: Readonly<HumanoidSpec>;
  /** 已补全的人脸参数（spec.head === 'human' 时总有值） */
  face?: Readonly<FaceOpts>;
  style?: Readonly<HumanoidStyle>;
  /** 已补全的服装款式（garmentOf(spec, face, style)） */
  garment: Readonly<GarmentSpec>;
  s: number;
  /** BUILD 表（旧版构建器用；新构建器用 profile.bw/bd/belly） */
  build: Readonly<BuildDims>;
  profile: Readonly<BodyProfile>;
  land: Readonly<Landmarks>;
  /** 接缝（按 profile 的关节布局算；layout.legacy 时只有旧版构建器，不用它） */
  seams: Readonly<Seams>;
  layout: Readonly<JointLayout>;
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

/**
 * 蒙皮部件：绑定姿势几何，人偶根空间（脚底在原点、面朝 -z、全部关节旋转为 0、不加驼背）。
 * 必须有 position、normal、uv、skinIndex（Uint16 ×4，BONES 下标）、skinWeight（×4，和为 1）；最好是索引几何。
 * 同一 slot 且没有 own 的部件合并成一个 SkinnedMesh（名字见 SLOT_MESH_NAME）；合并后跨全部槽按位置焊接法线（weldNormals）。
 */
export interface SkinnedPiece {
  kind: 'skinned'; name: string; slot: MatSlot;
  geo: THREE.BufferGeometry;
  /**
   * true = 自己一个 SkinnedMesh，名字 = name（props.collar、长袍 'robe'……）；缺省 false = 并进该槽的网格。
   * own 部件的几何原样使用（不复制；没有索引时补上顺序索引；焊接法线会改它的 normal）：构建器可以留着它、在 RegionResult.update 里改顶点
   * （长袍坐姿下摆）——这种几何必须每个人偶一份（ctx.track）；cached() 的共享几何只适合不改顶点、weld:false 的部件。
   * 不 own 的部件会被复制合并，构建器之后再改原几何不会反映到画面上。
   */
  own?: boolean;
  /** 在合并后的槽网格里的绘制顺序：小的先画。贴在表面上的薄片（领子、口袋盖、袖口边）用 -1 */
  order?: number;
  /** false = 不参加法线焊接（要保留硬边的部件）；缺省 true */
  weld?: boolean;
  /** 射线/包围盒用的胶囊额外半径（衣服离骨头远：长袍下摆、宽袖）：按部件里离骨轴最远的距离自动算，这里可以再加 */
  capsulePad?: number;
}

/** 不是身体网格的附加物（黄鼬胡须 LineSegments）：直接挂到关节，不进 parts。 */
export interface ExtraObject { joint: BuildJoint; object: THREE.Object3D }

export interface RegionResult {
  parts: (RigidPart | SkinnedPiece)[];
  extras?: ExtraObject[];
  /** 每帧在动作 apply 之后调用（长袍随坐姿形变、袖子垂坠）；必须便宜。bend = clamp((hipL.x + hipR.x)/π, 0, 1) */
  update?(st: { dt: number; walkPhase: number; walkWeight: number; bend: number }): void;
  dispose?(): void;
}

export type RegionBuilder = (ctx: BuildCtx) => RegionResult;

/** 动作模块（motion/）的输入。 */
export interface MotionCtx {
  spec: Readonly<HumanoidSpec>;
  s: number;
  profile: Readonly<BodyProfile>;
  layout: Readonly<JointLayout>;
  /** BUILD 的厚度系数（躺下时把背抬离地面） */
  bd: number;
  joints: Readonly<Record<BuildJoint, THREE.Group>>;
  pivot: THREE.Group;
  /** 静止时的关节位置（动作改 hips.position.y） */
  rest: { hipsY: number };
}

/** createHumanoidInternal 的开发选项（dev 自测：换掉某个区域构建器、追加一个）。正式代码不传。 */
export interface HumanoidDevOpts {
  builders?: Partial<Record<'upper' | 'lower' | 'head', RegionBuilder>>;
  extra?: RegionBuilder[];
}
