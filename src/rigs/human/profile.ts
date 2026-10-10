// owner: WP2
// char2 WP0（冻结）：体型、关节布局、骨骼表、地标、接缝（test-artifacts/work/char2/PLAN.md §2.1、§2.4–§2.6）。
// 这里的数字是各区域之间的契约：改了就会对不上缝。区域 WP 需要改时写 test-artifacts/work/char2/requests/<wp>.md。

import * as THREE from 'three';
import type {
  BodyProfile, BoneName, BuildDims, BuildJoint, ExtraJointName, FaceOpts, GarmentSpec, HairStyle, HeadPreset, HumanoidSpec,
  HumanoidStyle, JointLayout, JointName, Landmarks, SeamRing, Seams, V3,
} from './types';

export const JOINT_NAMES: readonly JointName[] = ['hips', 'spine', 'neck', 'headSlot', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR'];
export const EXTRA_JOINTS: readonly ExtraJointName[] = ['wristL', 'wristR', 'ankleL', 'ankleR'];
/** 全部关节（建 Group 的顺序；父关节总在子关节前面）。 */
export const BUILD_JOINTS: readonly BuildJoint[] = [...JOINT_NAMES, ...EXTRA_JOINTS];
/** 父关节（hips 的父是 pivot）。 */
export const JOINT_PARENT: Readonly<Record<BuildJoint, BuildJoint | 'pivot'>> = {
  hips: 'pivot', spine: 'hips', neck: 'spine', headSlot: 'neck',
  shoulderL: 'spine', elbowL: 'shoulderL', wristL: 'elbowL', shoulderR: 'spine', elbowR: 'shoulderR', wristR: 'elbowR',
  hipL: 'hips', kneeL: 'hipL', ankleL: 'kneeL', hipR: 'hips', kneeR: 'hipR', ankleR: 'kneeR',
};

/**
 * 骨骼顺序（冻结，所有蒙皮部件共用）：skinIndex 存的是这里的下标。骨头是 THREE.Bone，名为 `bone.<关节>`，
 * 作为对应关节 Group 的单位子节点（外部代码照旧写关节的旋转，骨头跟着走）。'pivot' 是不加权的根。
 */
export const BONES = ['hips', 'spine', 'neck', 'headSlot', 'shoulderL', 'elbowL', 'wristL', 'shoulderR', 'elbowR', 'wristR',
  'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR', 'pivot'] as const satisfies readonly BoneName[];

/** 骨骼下标（BONES.indexOf，带检查）。 */
export function boneIndex(name: BoneName): number {
  const i = (BONES as readonly string[]).indexOf(name);
  if (i < 0) throw new Error(`boneIndex: no bone '${name}'`);
  return i;
}

export const BUILD: Readonly<Record<NonNullable<HumanoidSpec['build']>, BuildDims>> = {
  normal: { w: 1, d: 1, belly: 0 },
  slim: { w: 0.86, d: 0.9, belly: 0 },
  stout: { w: 1.14, d: 1.22, belly: 0.05 },
  hunch: { w: 0.94, d: 1, belly: 0 },
};

/** 人头缺省外观（没给 FaceOpts 时：回放的 createHumanoid、冷迹）。 */
export function faceOf(spec: Readonly<HumanoidSpec>, face?: Readonly<FaceOpts>): FaceOpts {
  return face ? { ...face } : { skin: `#${new THREE.Color(spec.skin ?? '#C99A78').getHexString()}`, hair: '#1e1a17', hairStyle: 'short', age: 'old' };
}

/** 发型归一：旧名 'short' → 'crop'，'long' 保持 'long'（= 低发髻 chignon，PLAN §3.1）。 */
export function normHair(h: HairStyle): Exclude<HairStyle, 'short'> {
  return h === 'short' ? 'crop' : h;
}

/** 头型预设：face.head 优先；否则 old → oldMan/oldWoman，child → boy/girl，其余 man/woman。 */
export function headPresetOf(face: Readonly<FaceOpts>): HeadPreset {
  if (face.head) return face.head;
  if (face.age === 'child') return face.female ? 'girl' : 'boy';
  if (face.age === 'old') return face.female ? 'oldWoman' : 'oldMan';
  return face.female ? 'woman' : 'man';
}

/**
 * 体型（PLAN §2.6）：sex 来自 face.female；age 来自 face.age（old → old，child → child，young → young，没有脸 → adult）；
 * build 来自 spec.build；其余按性别/年龄给缺省；style.profile 覆盖任何一项。createHumanoid(spec)（公开、回放）= 成年男人。
 */
export function profileOf(spec: Readonly<HumanoidSpec>, face?: Readonly<FaceOpts>, style?: Readonly<HumanoidStyle>): BodyProfile {
  const o = style?.profile ?? {};
  const sex = o.sex ?? (face?.female ? 'f' : 'm');
  const age = o.age ?? (face?.age === 'old' ? 'old' : face?.age === 'child' ? 'child' : face?.age === 'young' ? 'young' : 'adult');
  const build = o.build ?? spec.build ?? 'normal';
  const deity = o.deity ?? false;
  const b = BUILD[build];
  const child = age === 'child';
  const f = sex === 'f' && !child;
  return {
    sex, age, build, deity,
    headScale: o.headScale ?? (child ? 1.3 : deity ? 1.25 : 1),
    bw: o.bw ?? b.w, bd: o.bd ?? b.d, belly: o.belly ?? b.belly,
    bust: o.bust ?? (f ? 1 : 0),
    waistTaper: o.waistTaper ?? (f ? 0.88 : 1),
    hipW: o.hipW ?? (f ? 1.08 : 1),
    kyphosis: o.kyphosis ?? (build === 'hunch' ? 0.21 : age === 'old' ? 0.05 : 0),
    legScale: o.legScale ?? (child ? 0.88 / 0.95 : deity ? 0.84 / 0.95 : 1),
  };
}

/** 服装款式缺省（描述旧版外观：短袖 = T 恤圆领、长袖 = 衬衫领；长袍角色 = 袍；塞进裤腰；布鞋）。style.garment 覆盖。 */
export function garmentOf(spec: Readonly<HumanoidSpec>, style?: Readonly<HumanoidStyle>): GarmentSpec {
  const g = style?.garment ?? {};
  const robe = !!spec.robe;
  const top = g.top ?? (robe ? 'robe_top' : spec.sleeves === 'long' ? 'work_shirt' : 'tshirt');
  return {
    top,
    collar: g.collar ?? (top === 'tshirt' ? 'crew' : robe ? 'none' : 'shirt'),
    placket: g.placket ?? 'none',
    pockets: g.pockets ?? 'none',
    tucked: g.tucked ?? !robe,
    hemDrop: g.hemDrop ?? 0,
    bottom: g.bottom ?? (robe ? 'robe' : 'trousers'),
    cuffs: g.cuffs ?? 'none',
    shoes: g.shoes ?? 'cloth',
  };
}

// ---------------------------------------------------------------- 关节布局

const v3 = (x: number, y: number, z: number): V3 => [x, y, z];

/**
 * 关节的局部位置（×s）。成年人与老人（以及 legacy = true 的任何体型）：正是旧版的数值（WP0 自测 char2.layout 逐项核对）——
 * hips 0.95s、spine +0.10s、neck +0.45s（领口 1.50s）、肩 ±0.195s·bw 高 0.378s（hunch 再低 0.02s）、肘 -0.29s、腕 -0.245s、
 * 髋 ±0.095s·bw 低 0.03s、膝 -0.43s、踝 -0.415s（踝高 0.075s）。
 * 儿童（PLAN §2.6）：hips 0.88s、髋 ±0.085s、膝 -0.40s、踝 -0.38s、spine 0.10s、neck 0.455s（领口 1.435s）、肩 ±0.170s 高 0.36s、肘 -0.27s、腕 -0.225s。
 * 土地（deity）：hips 0.84s、neck 0.40s、肩高 0.336s（= 0.378 × 0.40/0.45）、膝 -0.37s、踝 -0.365s（踝高仍 0.075s），其余同成年人。
 */
export function jointLayout(p: Readonly<BodyProfile>, s: number, o?: { legacy?: boolean }): JointLayout {
  const legacy = o?.legacy === true;
  const child = !legacy && p.age === 'child';
  const deity = !legacy && !child && p.deity === true;
  const bw = p.bw;
  const drop = p.build === 'hunch' ? 0.02 * s : 0;
  let L: Record<BuildJoint, V3>;
  if (child) {
    L = {
      hips: v3(0, 0.88 * s, 0), spine: v3(0, 0.1 * s, 0), neck: v3(0, 0.455 * s, 0), headSlot: v3(0, 0, 0),
      shoulderL: v3(-0.17 * s, 0.36 * s, 0), shoulderR: v3(0.17 * s, 0.36 * s, 0),
      elbowL: v3(0, -0.27 * s, 0), elbowR: v3(0, -0.27 * s, 0), wristL: v3(0, -0.225 * s, 0), wristR: v3(0, -0.225 * s, 0),
      hipL: v3(-0.085 * s, -0.03 * s, 0), hipR: v3(0.085 * s, -0.03 * s, 0),
      kneeL: v3(0, -0.4 * s, 0), kneeR: v3(0, -0.4 * s, 0), ankleL: v3(0, -0.38 * s, 0), ankleR: v3(0, -0.38 * s, 0),
    };
  } else {
    const hipsY = deity ? 0.84 : 0.95, neckY = deity ? 0.4 : 0.45, shY = deity ? 0.378 * 0.4 / 0.45 : 0.378;
    const knee = deity ? -0.37 : -0.43, ankle = deity ? -0.365 : -0.415;
    const shX = 0.195 * s * bw, hipX = 0.095 * s * bw;
    L = {
      hips: v3(0, hipsY * s, 0), spine: v3(0, 0.1 * s, 0), neck: v3(0, neckY * s, 0), headSlot: v3(0, 0, 0),
      shoulderL: v3(-shX, shY * s - drop, 0), shoulderR: v3(shX, shY * s - drop, 0),
      elbowL: v3(0, -0.29 * s, 0), elbowR: v3(0, -0.29 * s, 0), wristL: v3(0, -0.245 * s, 0), wristR: v3(0, -0.245 * s, 0),
      hipL: v3(-hipX, -0.03 * s, 0), hipR: v3(hipX, -0.03 * s, 0),
      kneeL: v3(0, knee * s, 0), kneeR: v3(0, knee * s, 0), ankleL: v3(0, ankle * s, 0), ankleR: v3(0, ankle * s, 0),
    };
  }
  const bind = { pivot: v3(0, 0, 0) } as Record<BoneName, V3>;
  for (const j of BUILD_JOINTS) {
    const par = bind[JOINT_PARENT[j]]!;
    const l = L[j];
    bind[j] = v3(par[0] + l[0], par[1] + l[1], par[2] + l[2]);
  }
  return { legacy, local: L, bind, hipsY: L.hips[1], collarY: bind.neck[1] };
}

// ---------------------------------------------------------------- 地标

/** 地标（PLAN §2.5）：头部在 headSlot 局部 × s × headScale；躯干/手臂/腿 × s（儿童另有系数，见各项）。 */
export function landmarksOf(p: Readonly<BodyProfile>, s: number, face?: Readonly<FaceOpts>, layout?: Readonly<JointLayout>): Landmarks {
  const lay = layout ?? jointLayout(p, s);
  const k = s * p.headScale;
  const P = (x: number, y: number, z: number): V3 => [x * k, y * k, z * k];
  const hairTopBy = {
    crop: 0.262 * k, side_part: 0.266 * k, thin_old: 0.256 * k, bald: 0.252 * k, flat_top: 0.272 * k, bun: 0.262 * k, long: 0.262 * k,
    child_bowl: 0.27 * k, none: 0.252 * k,
  } as const;
  const child = p.age === 'child';
  const female = p.sex === 'f' && !child;
  const neckK = lay.local.neck[1] / (0.45 * s);
  const handK = child ? 0.75 : female ? 0.9 : 1;
  const sitDrop = 0.45 * s * (child || p.deity ? p.legScale : 1);
  return {
    head: {
      scale: k,
      headOrigin: P(0, 0.14, -0.005), crownSkinY: 0.252 * k, chin: P(0, 0.04, -0.088), jawAngleR: P(0.06, 0.07, -0.02),
      eyeL: P(-0.032, 0.15, -0.093), eyeR: P(0.032, 0.15, -0.093), browY: 0.17 * k, noseTip: P(0, 0.112, -0.122), noseBaseY: 0.105 * k,
      mouth: P(0, 0.08, -0.098), earL: P(-0.078, 0.135, 0.006), earR: P(0.078, 0.135, 0.006), earHeight: 0.06 * k,
      hairTop: hairTopBy[normHair(face?.hairStyle ?? 'short')], hairTopBy,
      bunCentre: P(0, 0.175, 0.105), bunR: 0.042 * k, capSeatY: 0.232 * k,
      glassesBridge: P(0, 0.145, -0.106), anchorMouth: P(0, 0.075, -0.1), anchorHead: P(0, 0.14, 0),
    },
    torso: {
      anchorChest: [0, 0.3 * s * neckK, -0.12 * s * (child ? 0.85 : 1)],
      sleeveProbeY: -0.1 * s, sleeveRLong: 0.058 * s * (child ? 0.8 : 1), sleeveRShort: 0.062 * s * (child ? 0.8 : 1), armbandR: 0.066 * s,
      backPlaneY: [0.1 * s * neckK, 0.4 * s * neckK], backPlaneZ: 0.122 * s, hipBackZ: 0.112 * s,
    },
    arm: {
      wristY: lay.local.wristR[1],
      palmCentreY: lay.local.wristR[1] - 0.055 * s * handK,
      handLen: 0.185 * s * handK, palmW: 0.084 * s * handK, knuckleT: 0.028 * s * handK,
    },
    leg: {
      ankleY: lay.local.ankleR[1],
      ankleHeight: lay.bind.ankleR[1],
      shoeLen: (female ? 0.235 : 0.265) * s, shoeW: (female ? 0.085 : 0.095) * s,
      sitDrop,
      // 坐姿座面（大腿最低点）：髋关节高 - 坐姿下移 - 大腿下表面到髋关节的距离（旧版腿量出来 0.101s → 成年人 0.369s，1.5m 的人 0.317m）
      seatY: lay.bind.hipR[1] - sitDrop - 0.101 * s * (child ? 0.8 : 1),
    },
  };
}

// ---------------------------------------------------------------- 接缝

const NECK_TILT = (18 * Math.PI) / 180;
const NECK_NORMAL_DOWN = (10 * Math.PI) / 180;
const sgnPow = (c: number, e: number) => Math.sign(c) * Math.pow(Math.abs(c), e);

/**
 * 接缝（PLAN §2.4，冻结）。成年男人、正常体型、s = 1 的定义：
 * NECK_TOP（WP-U 脖子 ↔ WP-H 头）：20 点。前低后高倾斜 18° 的椭圆，中心 headSlot +(0, 0.070, 0.010)（成年人根空间 (0, 1.570, 0.010)），
 *   水平半轴 x 0.052、z 0.043：点 = 中心 + (a·cos t, -b·sin t·tan18°, -b·sin t)（前点 (0, 1.556, -0.033)，后点 (0, 1.584, 0.053)）。
 *   法线：圈平面内的椭圆外法线，再往下（沿圈平面法线反方向）转 10°。蒙皮 100% headSlot。
 * WAIST（WP-U 衬衫 ↔ WP-L 裤子/长袍）：24 点。hips +0.025（成年人根空间 y 0.975）的水平超椭圆（n = 3），
 *   半轴 x 0.150·bw、z 0.104·bd；前半边按 LoftRow.front 的方式再鼓出 belly·0.5（正前方 z = -(0.104·bd + 0.5·belly)）。
 *   法线：水平外法线。蒙皮 hips 0.65 / spine 0.35。
 * 体型缩放：女 NECK_TOP x×0.88 z×0.90、WAIST x×0.92 z×0.95；儿童 NECK_TOP x、z ×headScale×0.85（位置按 headScale）、WAIST ×1.05；
 * 老人 WAIST 半深 +0.006；土地 NECK_TOP 按 headScale。全部再 ×s。顶点 i 的角度 t = 2πi/count（0 在 +x，往 -z 走）。
 */
export function SEAMS(p: Readonly<BodyProfile>, s: number, layout?: Readonly<JointLayout>): Seams {
  const lay = layout ?? jointLayout(p, s);
  const child = p.age === 'child';
  const female = p.sex === 'f' && !child;
  // ---- NECK_TOP
  const hs = p.headScale;
  const nk = s * hs;
  const hb = lay.bind.headSlot;
  const nc: V3 = [hb[0], hb[1] + 0.07 * nk, hb[2] + 0.01 * nk];
  let na = 0.052 * nk, nb = 0.043 * nk;
  if (female) { na *= 0.88; nb *= 0.9; }
  if (child) { na *= 0.85; nb *= 0.85; }
  const N = 20;
  const npos = new Float32Array(N * 3), nnor = new Float32Array(N * 3);
  const tan = Math.tan(NECK_TILT);
  const ex = new THREE.Vector3(1, 0, 0);
  const ez = new THREE.Vector3(0, tan, 1).normalize(); // 圈平面内“往后”的方向（z 增大时 y 升高）
  const up = new THREE.Vector3().crossVectors(ez, ex).normalize(); // 圈平面法线（朝上偏前）
  const d = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const zo = -nb * Math.sin(t);
    npos.set([nc[0] + na * Math.cos(t), nc[1] + zo * tan, nc[2] + zo], i * 3);
    // 平面内椭圆外法线（水平坐标里的梯度），搬到圈平面上，再往下转 10°
    const gx = Math.cos(t) / na, gz = -Math.sin(t) / nb;
    d.copy(ex).multiplyScalar(gx).addScaledVector(ez, gz).normalize();
    d.multiplyScalar(Math.cos(NECK_NORMAL_DOWN)).addScaledVector(up, -Math.sin(NECK_NORMAL_DOWN)).normalize();
    nnor.set([d.x, d.y, d.z], i * 3);
  }
  // ---- WAIST
  const W = 24;
  const hipsB = lay.bind.hips;
  const wy = hipsB[1] + 0.025 * s;
  let wa = 0.15 * p.bw * s, wb = 0.104 * p.bd * s;
  if (female) { wa *= 0.92; wb *= 0.95; }
  if (child) { wa *= 1.05; wb *= 1.05; }
  if (p.age === 'old') wb += 0.006 * s;
  const front = (0.5 * p.belly * s) / wb;
  const wpt = (t: number, out: THREE.Vector3) => {
    const cx = sgnPow(Math.cos(t), 2 / 3), cz = -sgnPow(Math.sin(t), 2 / 3);
    let z = cz * wb;
    if (cz < 0 && front) z *= 1 + front * Math.pow(-cz, 2) * Math.pow(Math.max(0, 1 - Math.abs(cx)), 0.5);
    return out.set(hipsB[0] + cx * wa, wy, hipsB[2] + z);
  };
  const wpos = new Float32Array(W * 3), wnor = new Float32Array(W * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < W; i++) {
    const t = (i / W) * Math.PI * 2;
    wpt(t, c);
    wpos.set([c.x, c.y, c.z], i * 3);
    // 切线（数值差分），水平外法线 = 切线 × 上；朝外（离中心）
    wpt(t + 1e-4, a);
    wpt(t - 1e-4, b);
    const tx = a.x - b.x, tz = a.z - b.z;
    let nx = -tz, nz = tx;
    if (nx * (c.x - hipsB[0]) + nz * (c.z - hipsB[2]) < 0) { nx = -nx; nz = -nz; }
    const l = Math.hypot(nx, nz) || 1;
    wnor.set([nx / l, 0, nz / l], i * 3);
  }
  const ring = (name: SeamRing['name'], count: number, pos: Float32Array, nor: Float32Array, centre: V3, joint: SeamRing['joint'], skin: SeamRing['skin']): SeamRing => ({
    name, count, pos, nor, centre, joint, jointBind: lay.bind[joint], skin,
  });
  return {
    NECK_TOP: ring('NECK_TOP', N, npos, nnor, nc, 'headSlot', { bones: [boneIndex('headSlot')], weights: [1] }),
    WAIST: ring('WAIST', W, wpos, wnor, [hipsB[0], wy, hipsB[2]], 'hips', { bones: [boneIndex('hips'), boneIndex('spine')], weights: [0.65, 0.35] }),
  };
}

/** 接缝圈换到某个关节的局部坐标（绑定姿势下关节没有旋转，只是平移）：头（headSlot 局部）、或任何刚体部件用。 */
export function seamLocal(ring: Readonly<SeamRing>, jointBind: V3 = ring.jointBind): Float32Array {
  const out = new Float32Array(ring.pos.length);
  for (let i = 0; i < ring.count; i++) {
    out[i * 3] = ring.pos[i * 3]! - jointBind[0];
    out[i * 3 + 1] = ring.pos[i * 3 + 1]! - jointBind[1];
    out[i * 3 + 2] = ring.pos[i * 3 + 2]! - jointBind[2];
  }
  return out;
}
