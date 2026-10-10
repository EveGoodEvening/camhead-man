// owner: WP2
// NPC 造型（ARCH §5.3）：跨区域出现的角色必须用同一个工厂。外形逐条对应 GDD §2.7。
//
// look：live = 本色；ghost = 魂影材质（MATERIALS.ghost，颜色按角色；土地例外：他是神不是鬼，取景器里保持本色、
// 加一圈土地金菲涅尔描边）；replay = mat.replay；silhouette = 纯黑剪影（拆迁工人）。
// 黄三爷：三个变体（masked 纸人 / man / weasel）的根都在同一个 root 下，任何变体下都不挂灯；揭面具后由 R4 用
// ctx.viewVariant({ naked: props.man, vf: props.weasel, ir: props.man }) 按视图切换（setVariant 只决定“当前是哪一个”）。

import * as THREE from 'three';
import type { Pose } from '../core/types';
import { GHOST_LU, PALETTE } from '../data/palette';
import { TEMP_C } from '../data/render';
import { rng, pick, range } from '../kit/rng';
import {
  ACCESSORIES, clothShoeTexture, floralTexture, robeTexture, uniformShirtTexture, zhongshanDetails, zhongshanTexture,
} from './accessories';
import {
  createHumanoidInternal, type FaceOpts, type HumanoidInternal, type HumanoidMaterialMode, type HumanoidRig, type HumanoidSpec, type HumanoidStyle,
} from './humanoid';
import { createPaperFigure, vendorAtlas, type PaperRig } from './paper';

export type CharacterKind = 'tudi' | 'wang' | 'lu' | 'huang' | 'zhou' | 'jianguo' | 'kid' | 'bride' | 'apprentice'
  | 'junkman' | 'worker' | 'neighbor';

export interface CharacterOpts {
  /** ghost：魂影材质（颜色按角色：多数 GHOST #8FD3D6，陆师傅 #E8E0D0） */
  look?: 'live' | 'ghost' | 'replay' | 'silhouette';
  /** huang: 'masked' | 'man' | 'weasel'；zhou: 'cap' | 'nocap' | 'slump'；tudi: 'lantern_only' */
  variant?: string;
  /** 回放里的年轻王奶奶、小建国 */
  age?: 'young' | 'old';
  /** 头部锚点叠一团动态雪花遮住脸；zhou 在 look:'replay' 时默认 true（GDD M4、§3.6） */
  faceMask?: boolean;
  seed?: number;
}

export interface CharacterRig extends HumanoidRig {
  readonly kind: CharacterKind;
  /** 例：tudi.props.lantern、lu.props.tlr、wang.props.basket */
  readonly props: Readonly<Record<string, THREE.Object3D>>;
  readonly anchors: { head: THREE.Object3D; chest: THREE.Object3D; mouth?: THREE.Object3D };
  /** huang：揭面具后 'masked' → 'man'/'weasel' */
  setVariant?(v: string): void;
  /** huang 'masked'：脸网格与低/高清脸贴图，交给 ctx.hdText */
  readonly hdFace?: { mesh: THREE.Mesh; lo: () => THREE.Texture; hi: () => THREE.Texture };
}

type Look = NonNullable<CharacterOpts['look']>;

function lookToMode(look: Look): HumanoidMaterialMode {
  return look === 'live' ? 'standard' : look === 'ghost' ? 'ghost' : look;
}

/** M4 第 2 轮：陆师傅魂影实际用的魂色——GHOST_LU #E8E0D0 往暖处偏约 10%（红 +、蓝 −）。 */
const GHOST_LU_WARM = '#F4DEBE';

function ghostColor(kind: CharacterKind): string {
  return kind === 'lu' ? GHOST_LU : PALETTE.GHOST;
}

/** 头心、胸口、嘴的锚点（拍照锚点、读字跟随、雪花脸都用它们）。 */
function makeAnchors(h: HumanoidInternal): { head: THREE.Object3D; chest: THREE.Object3D; mouth: THREE.Object3D } {
  const s = h.s;
  const head = new THREE.Object3D();
  head.name = 'anchorHead';
  head.position.set(0, 0.14 * s, 0);
  h.joints.headSlot.add(head);
  const chest = new THREE.Object3D();
  chest.name = 'anchorChest';
  chest.position.set(0, 0.3 * s, -0.12 * s);
  h.joints.spine.add(chest);
  const mouth = new THREE.Object3D();
  mouth.name = 'anchorMouth';
  mouth.position.set(0, 0.075 * s, -0.1 * s);
  h.joints.headSlot.add(mouth);
  return { head, chest, mouth };
}

/** 把 HumanoidInternal 包成 CharacterRig；post 在每次 update 之后调（改关节：拄拐、端缸子、趴桌）。 */
function wrap(
  h: HumanoidInternal, kind: CharacterKind, props: Record<string, THREE.Object3D>,
  anchors: CharacterRig['anchors'], post?: (dt: number) => void, extra?: Partial<CharacterRig>,
): CharacterRig {
  const rig: CharacterRig = {
    kind, props, anchors,
    root: h.root, joints: h.joints, height: h.height,
    setPose: (p: Pose, b?: number) => {
      h.setPose(p, b);
      post?.(0);
    },
    update: (dt, speed) => {
      h.update(dt, speed);
      post?.(dt);
    },
    // M4：NpcSystem.reveal() 不带颜色地调 setMaterialMode('ghost')——土地是神不是鬼，保持本色 + 土地金描边；
    // 其余角色缺省用自己的魂影色（陆师傅 GHOST_LU 暖白，不被换成通用青色）
    setMaterialMode: (m, c) => {
      if (kind === 'tudi' && m === 'ghost') return;
      h.setMaterialMode(m, m === 'ghost' ? (c ?? ghostColor(kind)) : c);
    },
    setOpacity: a => h.setOpacity(a),
    bounds: t => h.bounds(t),
    dispose: () => h.dispose(),
    ...extra,
  };
  post?.(0);
  return rig;
}

/** 手臂固定姿势（拄拐、端缸子）：每帧 update 之后覆盖行走摆臂。 */
function holdArm(h: HumanoidInternal, side: 'L' | 'R', sh: readonly [number, number, number], el: number): void {
  const S = side === 'L' ? h.joints.shoulderL : h.joints.shoulderR;
  const E = side === 'L' ? h.joints.elbowL : h.joints.elbowR;
  S.rotation.set(sh[0], sh[1], sh[2]);
  E.rotation.set(el, 0, 0);
}

function setTempTree(obj: THREE.Object3D, t: number): void {
  obj.traverse(o => {
    o.userData.tempC = t;
  });
}

// ---------------------------------------------------------------- 各角色

interface Built { h: HumanoidInternal; props: Record<string, THREE.Object3D>; post?: (dt: number) => void; extra?: Partial<CharacterRig> }

/** 随机身高按 2cm 取整（几何缓存的键只有有限几种，PLAN §0.5）。 */
const qH = (v: number) => Math.round(v / 0.02) * 0.02;

/** 上身构建器做了领子（名为 'collar' 的网格，WP-U）就用它；旧版上身没有领子时才挂备用的领子配件。 */
function collarOr(h: HumanoidInternal, make: () => THREE.Object3D, joint: THREE.Object3D): THREE.Object3D {
  const own = h.parts.collar;
  if (own) return own;
  const c = make();
  joint.add(c);
  h.adopt(c);
  return c;
}

function buildTudi(o: CharacterOpts): Built {
  const deity = o.look === 'ghost';
  const spec: HumanoidSpec = { height: 1.2, build: 'stout', shirt: '#7C7A74', pants: '#4C4A46', shoes: '#1a1a1a', skin: '#C49A7A', sleeves: 'long', robe: true, head: 'human' };
  const face: FaceOpts = {
    skin: '#C49A7A', hair: '#E8E6E0', hairStyle: 'bald', age: 'old', brows: 1.2, seed: 5, head: 'deity',
    sculpt: { earlobe: 1, cheekFull: 0.8, foreheadH: 0.4, noseW: 0.2 },
    paint: { eyeShape: 'droop', brow: 'white', wrinkles: 0.5, blush: 0.35, lips: '#A8605A' },
  };
  const style: HumanoidStyle = {
    robeMap: robeTexture(), ...(deity ? { rim: PALETTE.TUDI_GOLD } : {}),
    profile: { deity: true },
    garment: { top: 'robe_top', collar: 'none', bottom: 'robe', tucked: false, shoes: 'cloth' },
  };
  const h = createHumanoidInternal(spec, face, style);
  const s = h.s;
  const beard = ACCESSORIES.beard(h);
  h.joints.headSlot.add(beard);
  h.adopt(beard);
  // 枣木拐杖立在右前方（挂在 root 上，拄着不动），右手握在杖身上
  // char2：拐杖矮一点、立得往外一点，灯笼挂在他肩膀外侧，不再正好挡在脸前
  const cane = ACCESSORIES.caneLantern(s * 1.2);
  cane.group.position.set(0.21, 0, -0.27);
  h.root.add(cane.group);
  h.adopt(cane.group);
  // 灯笼保持自己的红光（魂影/回放材质都不换它）
  cane.lantern.traverse(c => {
    const m = c as THREE.Mesh;
    if (m.isMesh && m.userData.keepMaterial) h.adopt(m, { keepMaterial: true });
  });
  const lanternOnly = o.variant === 'lantern_only';
  if (lanternOnly) {
    h.setBodyVisible(false);
    beard.visible = false;
    cane.group.children.forEach(c => {
      if (c !== cane.lantern) c.visible = false;
    });
  }
  const lanternRest = cane.lantern.position.clone();
  let t = range(rng(o.seed ?? 3), 0, 6);
  return {
    h,
    props: { lantern: cane.lantern, lanternLight: cane.light, cane: cane.group, beard },
    post(dt) {
      holdArm(h, 'R', [0.55, 0, 0.1], 0.7);
      t += dt;
      // 灯笼轻轻晃；只有灯笼时“自己飘着”，起伏大一点
      const k = lanternOnly ? 1 : 0.35;
      cane.lantern.position.set(lanternRest.x, lanternRest.y + Math.sin(t * 1.3) * 0.03 * k, lanternRest.z);
      cane.lantern.rotation.z = Math.sin(t * 0.9) * 0.08 * k;
    },
  };
}

/** 王奶奶的碎花大襟布衫（年轻时同一件）。 */
const WANG_GARMENT: HumanoidStyle['garment'] = {
  top: 'blouse', collar: 'mandarin', placket: 'side_frog', pockets: 'none', tucked: false, hemDrop: 0.1, cuffs: 'band', bottom: 'trousers', shoes: 'cloth',
};

function buildWang(o: CharacterOpts): Built {
  const young = o.age === 'young';
  const spec: HumanoidSpec = { height: young ? 1.58 : 1.5, build: young ? 'normal' : 'hunch', shirt: '#5B6E8C', pants: '#2B2A2E', shoes: '#141416', skin: '#C9A080', sleeves: 'long', head: 'human' };
  // 发髻是头发几何（WP-H），颜色跟头发走：老了花白、年轻时乌黑（char2 修掉了“发髻永远是灰的”）
  const face: FaceOpts = young
    ? { skin: '#C9A080', hair: '#1c1816', hairStyle: 'bun', age: 'young', female: true, seed: 7, head: 'woman', sculpt: { cheekFull: 0.2 }, paint: { blush: 0.25, eyeShape: 'inner_fold', brow: 'arched', lips: '#A44A44' } }
    : {
      skin: '#C9A080', hair: '#8D8A86', hairStyle: 'bun', age: 'old', female: true, seed: 7, head: 'oldWoman',
      sculpt: { cheekFull: 0.4, chin: -0.3, lipFull: -0.5 },
      paint: { eyeShape: 'droop', brow: 'thin', wrinkles: 0.8, spots: 0.3, blush: 0.15 },
    };
  const floral = floralTexture('#5B6E8C', 3);
  const h = createHumanoidInternal(spec, face, {
    torsoMap: floral, sleeveMap: floral, shoeMap: clothShoeTexture(), garment: WANG_GARMENT,
    profile: young ? {} : { kyphosis: 0.35 },
  });
  const s = h.s;
  const pin = ACCESSORIES.hairpin(h);
  h.joints.headSlot.add(pin);
  h.adopt(pin);
  const props: Record<string, THREE.Object3D> = { bun: pin };
  let post: ((dt: number) => void) | undefined;
  if (!young) {
    // 竹篮挎在左臂弯：篮子挂在腰侧，左臂弯着托住提手
    const basket = ACCESSORIES.basket(s);
    basket.position.set(-0.24 * s, 0.02 * s, -0.08 * s);
    h.joints.spine.add(basket);
    h.adopt(basket);
    props.basket = basket;
    post = () => holdArm(h, 'L', [0.3, 0, -0.3], 1.25);
  }
  return { h, props, post };
}

function buildLu(o: CharacterOpts): Built {
  const young = o.age === 'young';
  const spec: HumanoidSpec = { height: 1.82, build: 'slim', shirt: '#7E8288', pants: '#6A6D72', shoes: '#1d1a18', skin: '#C49A7E', sleeves: 'long', head: 'human' };
  // M4 第 2 轮：花白头发压暗一点（#9A9894 在钠灯、CRT 的光里和肤色一个亮度，头顶读成秃的）
  // char2：瘦长脸、高颧骨、窄下巴、细高鼻梁、薄嘴唇、单眼皮、淡眉；头发三七分梳得整整齐齐
  const face: FaceOpts = {
    skin: '#C49A7E', hair: young ? '#1e1a17' : '#6E6C68', hairStyle: 'side_part', age: young ? 'young' : 'old', seed: 11,
    head: young ? 'man' : 'oldMan',
    sculpt: { faceLen: 0.6, jawW: -0.4, cheekbone: 0.5, noseBridge: 0.5, noseW: -0.2, lipFull: -0.4 },
    paint: { eyeShape: 'single', brow: 'thin', wrinkles: young ? 0.15 : 0.6 },
  };
  // M4 第 2 轮：魂色偏暖（GHOST_LU #E8E0D0 往暖处偏 10%）、少保留衣服原色（灰中山装的色相偏冷，原色留得越多整个人越是冷灰白），
  // 门岗的绿光里读成 GDD 写的暖白；中山装的口袋、扣子靠贴图亮度与立体的口袋盖读出来
  const h = createHumanoidInternal(spec, face, {
    torsoMap: zhongshanTexture('#7E8288'), ghost: { baseAmt: 0.2, tint: GHOST_LU_WARM },
    profile: { kyphosis: young ? 0 : 0.08 },
    garment: { top: 'zhongshan', collar: 'stand', placket: 'zhongshan5', pockets: 'zhongshan4', tucked: false, hemDrop: 0.16, cuffs: 'none', bottom: 'trousers', shoes: 'leather' },
  });
  const suit = collarOr(h, () => zhongshanDetails(h, '#7E8288'), h.joints.spine);
  const glasses = ACCESSORIES.glasses(h);
  h.joints.headSlot.add(glasses);
  h.adopt(glasses);
  const tlr = ACCESSORIES.tlr(h);
  h.joints.spine.add(tlr);
  h.adopt(tlr);
  return { h, props: { glasses, tlr, suit } };
}

function buildZhou(o: CharacterOpts): Built {
  const spec: HumanoidSpec = { height: 1.75, build: 'hunch', shirt: PALETTE.UNIFORM, pants: '#3B3D42', shoes: '#141416', skin: '#A07E66', sleeves: 'short', head: 'human' };
  // char2：宽下巴、大鼻头、两颊略凹、眉弓高；眼角耷拉、眉毛又粗又乱（花白）、皱纹、一点胡茬
  const face: FaceOpts = {
    skin: '#A07E66', hair: '#4A4642', hairStyle: 'crop', age: 'old', seed: 1960, head: 'oldMan',
    sculpt: { jawW: 0.5, noseW: 0.4, noseLen: 0.2, cheekFull: -0.3, browRidge: 0.4, earSize: 0.2 },
    paint: { eyeShape: 'droop', brow: 'bushy', wrinkles: 0.7, stubble: 0.25 },
  };
  const h = createHumanoidInternal(spec, face, {
    torsoMap: uniformShirtTexture(), shoeMap: clothShoeTexture(),
    profile: { kyphosis: 0.25 },
    garment: { top: 'work_shirt', collar: 'shirt', placket: 'buttons', pockets: 'chest2', tucked: true, cuffs: 'none', bottom: 'work_trousers', shoes: 'cloth' },
  });
  const s = h.s;
  const collar = collarOr(h, () => ACCESSORIES.shirtCollar(s, PALETTE.UNIFORM, { open: false }), h.joints.spine);
  const band = ACCESSORIES.armband(h);
  h.joints.shoulderL.add(band);
  h.adopt(band);
  const props: Record<string, THREE.Object3D> = { collar, armband: band };
  const cap = ACCESSORIES.cap('cloth', h);
  h.joints.headSlot.add(cap);
  h.adopt(cap);
  props.cap = cap;
  // 搪瓷缸：把手（缸身 +x 侧）落在掌心，缸身在手的内侧
  const mug = ACCESSORIES.mug(s);
  mug.position.set(-0.052 * s, h.land.arm.palmCentreY - 0.004 * s, -0.022 * s);
  h.joints.elbowR.add(mug);
  h.adopt(mug);
  props.mug = mug;
  let variant = o.variant ?? 'cap';
  const applyVariant = () => {
    cap.visible = variant !== 'nocap';
    mug.visible = variant !== 'slump';
  };
  applyVariant();
  const post = () => {
    if (variant === 'slump' && h.pose === 'sit') {
      // 趴桌：上身前扑、头枕在叠起的胳膊上（ARCH §5.1：sit + zhou:'slump'）
      h.joints.spine.rotation.x = -0.95;
      h.joints.neck.rotation.x = -0.35;
      holdArm(h, 'L', [1.3, 0, -0.35], 1.9);
      holdArm(h, 'R', [1.3, 0, 0.35], 1.9);
    } else if (variant !== 'slump') {
      // 右手端着搪瓷缸：前臂抬平，缸子口朝上
      holdArm(h, 'R', [0.3, 0, 0.08], 1.15);
      mug.rotation.x = -(h.joints.shoulderR.rotation.x + h.joints.elbowR.rotation.x);
    }
  };
  return {
    h, props, post,
    extra: {
      setVariant(v: string) {
        variant = v;
        applyVariant();
        post();
      },
    },
  };
}

function buildJianguo(o: CharacterOpts): Built {
  const child = o.age === 'young';
  const spec: HumanoidSpec = child
    ? { height: 1.15, build: 'normal', shirt: '#B8433A', pants: '#3C4A6A', shoes: '#2a2420', skin: '#D1A788', sleeves: 'long', head: 'human' }
    : { height: 1.73, build: 'normal', shirt: '#4A5566', pants: '#2E3440', shoes: '#2a2420', skin: '#C39C80', sleeves: 'long', head: 'human' };
  const face: FaceOpts = child
    ? { skin: spec.skin as string, hair: '#15120f', hairStyle: 'child_bowl', age: 'child', seed: 1986, head: 'boy', paint: { blush: 0.3 } }
    : { skin: spec.skin as string, hair: '#15120f', hairStyle: 'crop', age: 'young', seed: 1986, head: 'man', sculpt: { jawW: 0.2 }, paint: { stubble: 0.12 } };
  // 小建国：红毛衣（圆领、松紧袖口）、蓝裤子、球鞋；大建国：拉链夹克（里面衬衫领）、皮鞋
  const style: HumanoidStyle = child
    ? { garment: { top: 'tshirt', collar: 'crew', tucked: false, hemDrop: 0.05, cuffs: 'band', bottom: 'trousers', shoes: 'sneaker' } }
    : { garment: { top: 'jacket', collar: 'shirt', placket: 'none', tucked: false, hemDrop: 0.08, cuffs: 'band', bottom: 'trousers', shoes: 'leather' } };
  return { h: createHumanoidInternal(spec, face, style), props: {} };
}

function buildKid(o: CharacterOpts): Built {
  const r = rng(o.seed ?? 2012);
  const spec: HumanoidSpec = { height: qH(range(r, 1.2, 1.35)), build: 'slim', shirt: '#E6E4DC', pants: pick(r, ['#2F4A7E', '#2E3036', '#34523A']), shoes: '#EDEBE3', skin: '#D1A788', sleeves: 'short', head: 'human' };
  const fseed = Math.floor(r() * 99);
  const girl = r() < 0.5;
  const face: FaceOpts = {
    skin: '#D1A788', hair: '#141210', hairStyle: girl ? 'bun' : 'child_bowl', age: 'child', female: girl, seed: fseed,
    head: girl ? 'girl' : 'boy', paint: { blush: girl ? 0.35 : 0.25 },
  };
  // 白校服衬衫（短袖、衬衫领、塞进裤腰）、白球鞋、红领巾
  const h = createHumanoidInternal(spec, face, {
    garment: { top: 'work_shirt', collar: girl ? 'crew' : 'shirt', placket: 'buttons', tucked: true, bottom: 'trousers', shoes: 'sneaker' },
  });
  const scarf = ACCESSORIES.scarf(h);
  h.joints.spine.add(scarf);
  h.adopt(scarf);
  return { h, props: { scarf } };
}

function buildBride(): Built {
  const spec: HumanoidSpec = { height: 1.6, build: 'slim', shirt: '#B3202A', pants: '#B3202A', shoes: '#7A1018', skin: '#D8B090', sleeves: 'long', robe: true, head: 'human' };
  const face: FaceOpts = {
    skin: '#D8B090', hair: '#120e0c', hairStyle: 'long', age: 'young', female: true, seed: 1990, head: 'woman',
    sculpt: { lipFull: 0.3, cheekbone: 0.2 },
    paint: { lips: '#B0302E', blush: 0.3, eyeShape: 'inner_fold', brow: 'arched' },
  };
  // 红缎子对襟小袄（立领、盘扣）+ 红长裙、绣花鞋；收腰
  const h = createHumanoidInternal(spec, face, {
    profile: { waistTaper: 0.85 },
    garment: { top: 'blouse', collar: 'mandarin', placket: 'side_frog', pockets: 'none', tucked: false, hemDrop: 0.04, cuffs: 'band', bottom: 'qipao_skirt', shoes: 'embroidered' },
  });
  const pin = ACCESSORIES.hairpin(h, { flower: true });
  h.joints.headSlot.add(pin);
  h.adopt(pin);
  return { h, props: { bun: pin } };
}

function buildApprentice(): Built {
  const spec: HumanoidSpec = { height: 1.7, build: 'slim', shirt: '#E6E2D6', pants: '#2E3036', shoes: '#1a1816', skin: '#C9A080', sleeves: 'long', head: 'human' };
  const face: FaceOpts = {
    skin: '#C9A080', hair: '#15120f', hairStyle: 'side_part', age: 'young', seed: 17, head: 'man',
    sculpt: { eyeSize: 0.2, cheekFull: -0.3, jawW: -0.2 }, paint: { eyeShape: 'double' },
  };
  // 白衬衫（衬衫领、一排扣、袖子挽到小臂）塞进裤腰、系皮带；球鞋
  return {
    h: createHumanoidInternal(spec, face, {
      garment: { top: 'work_shirt', collar: 'shirt', placket: 'buttons', pockets: 'chest1', tucked: true, cuffs: 'turnup', bottom: 'trousers', shoes: 'sneaker' },
    }),
    props: {},
  };
}

function buildJunkman(): Built {
  const spec: HumanoidSpec = { height: 1.66, build: 'hunch', shirt: '#5A5850', pants: '#3E3C38', shoes: '#231f1a', skin: '#A88468', sleeves: 'long', head: 'human' };
  const face: FaceOpts = {
    skin: '#A88468', hair: '#6b665e', hairStyle: 'thin_old', age: 'old', seed: 23, head: 'oldMan',
    sculpt: { chin: -0.2, cheekFull: -0.4 }, paint: { stubble: 0.5, wrinkles: 0.8, spots: 0.2 },
  };
  // 旧棉袄（圆领、敞着下摆）、膝盖鼓包的裤子、布鞋、一顶旧布帽
  const h = createHumanoidInternal(spec, face, {
    garment: { top: 'cotton_padded', collar: 'crew', tucked: false, hemDrop: 0.12, cuffs: 'none', bottom: 'trousers', shoes: 'cloth' },
  });
  const cap = ACCESSORIES.cap('cloth', h, { color: '#4C4A43' });
  h.joints.headSlot.add(cap);
  h.adopt(cap);
  return { h, props: { cap } };
}

function buildWorker(): Built {
  const spec: HumanoidSpec = { height: 1.76, build: 'stout', shirt: '#D86A1E', pants: '#2C3440', shoes: '#1a1816', skin: '#B08A6A', sleeves: 'long', head: 'human' };
  const face: FaceOpts = {
    skin: '#B08A6A', hair: '#15120f', hairStyle: 'crop', age: 'young', seed: 28, head: 'man',
    sculpt: { jawW: 0.5, cheekFull: 0.3, noseW: 0.2 }, paint: { stubble: 0.4, brow: 'straight' },
  };
  // 橙色工装（衬衫领、两个胸兜、袖子挽起）、工装裤（膝盖补丁）、靴子、深橙安全帽
  const h = createHumanoidInternal(spec, face, {
    garment: { top: 'work_shirt', collar: 'shirt', placket: 'buttons', pockets: 'chest2', tucked: true, cuffs: 'turnup', bottom: 'work_trousers', shoes: 'boot' },
  });
  const hat = ACCESSORIES.hardHat(h);
  h.joints.headSlot.add(hat);
  h.adopt(hat);
  return { h, props: { hardHat: hat } };
}

function buildNeighbor(o: CharacterOpts): Built {
  const r = rng(o.seed ?? 2008);
  const female = r() < 0.5;
  const skin = pick(r, ['#C9A080', '#B8906E', '#D1A788']);
  const spec: HumanoidSpec = {
    height: qH(female ? range(r, 1.52, 1.64) : range(r, 1.64, 1.8)), build: pick(r, ['normal', 'slim', 'stout'] as const),
    shirt: pick(r, ['#C8C2B0', '#7A2E2E', '#2E5A7A', '#556B2F', '#8C7A5A', '#E0DCCF']), pants: pick(r, ['#2E3036', '#3C4A6A', '#4A4038']),
    shoes: '#1d1a18', skin, sleeves: 'short', head: 'human',
  };
  const old = r() < 0.4;
  const seed = Math.floor(r() * 999);
  const sl = () => range(r, -0.4, 0.4);
  const sculpt = { jawW: sl(), cheekFull: sl(), noseLen: sl(), noseW: sl(), faceLen: sl(), chin: sl(), cheekbone: sl() };
  const hairStyle = female ? 'bun' : old ? pick(r, ['thin_old', 'crop'] as const) : pick(r, ['crop', 'side_part'] as const);
  const face: FaceOpts = {
    skin, hair: old ? '#8a8680' : '#15120f', hairStyle, age: old ? 'old' : 'young', female, seed, sculpt,
    paint: female ? { blush: range(r, 0.1, 0.25), wrinkles: old ? 0.6 : 0 } : { stubble: range(r, 0, 0.3), wrinkles: old ? 0.6 : 0 },
  };
  const top = female ? pick(r, ['blouse', 'tshirt'] as const) : pick(r, ['tshirt', 'work_shirt'] as const);
  const h = createHumanoidInternal(spec, face, {
    garment: {
      top, collar: top === 'tshirt' ? 'crew' : top === 'blouse' ? 'mandarin' : 'shirt', placket: top === 'work_shirt' ? 'buttons' : 'none',
      tucked: top === 'work_shirt', hemDrop: top === 'work_shirt' ? 0 : 0.06, bottom: 'trousers', shoes: pick(r, ['cloth', 'leather'] as const),
    },
  });
  return { h, props: {} };
}

// ---------------------------------------------------------------- 黄三爷

function createHuang(o: CharacterOpts): CharacterRig {
  const look: Look = o.look ?? 'live';
  const seed = o.seed ?? 3;
  const root = new THREE.Group();
  root.name = 'huang';

  // masked：与同 seed 的纸扎摊主完全相同（ARCH §5.3）
  const paper: PaperRig = createPaperFigure({ kind: 'vendor', seed, breathing: true });
  paper.root.name = 'huangMasked';
  root.add(paper.root);

  const clothes = zhongshanTexture('#4E5A63');
  // 黄三爷本人：矮瘦、尖下巴、窄眼（单眼皮）、高颧骨、招风耳，一脸滑笑；旧中山装、破毡帽压得很低（脸埋在帽檐下，下巴和那点笑露在外面）
  const suitGarment: HumanoidStyle['garment'] = {
    top: 'zhongshan', collar: 'stand', placket: 'zhongshan5', pockets: 'zhongshan4', tucked: false, hemDrop: 0.14, cuffs: 'none', bottom: 'trousers', shoes: 'leather',
  };
  const manSpec: HumanoidSpec = { height: 1.4, build: 'slim', shirt: '#4E5A63', pants: '#3A3A36', shoes: '#1a1814', skin: '#B08A68', sleeves: 'long', head: 'human' };
  const man = createHumanoidInternal(manSpec, {
    skin: '#B08A68', hair: '#3a3026', hairStyle: 'thin_old', age: 'old', seed: 1970, head: 'oldMan',
    sculpt: { chin: 0.6, cheekbone: 0.4, earSize: 0.3, jawW: -0.3, cheekFull: -0.3, lipFull: -0.2 },
    paint: { eyeShape: 'single', brow: 'thin', wrinkles: 0.6, spots: 0.15 },
  }, { torsoMap: clothes, garment: suitGarment });
  man.root.name = 'huangMan';
  collarOr(man, () => zhongshanDetails(man, '#4E5A63'), man.joints.spine);
  const manHat = ACCESSORIES.cap('felt', man, { low: true });
  man.joints.headSlot.add(manHat);
  man.adopt(manHat);
  root.add(man.root);

  // 黄鼬：同一身衣服；脖子与“缩在袖子里的手”用毛色（WP-U 按 spec.skin 做脖子与手）
  const weasel = createHumanoidInternal({ ...manSpec, skin: '#A87436', head: 'weasel' }, undefined, { torsoMap: clothes, garment: suitGarment });
  weasel.root.name = 'huangWeasel';
  collarOr(weasel, () => zhongshanDetails(weasel, '#4E5A63'), weasel.joints.spine);
  // 黄鼠狼的毡帽掀到脑后，露出尖脸和两只耳朵
  const wHat = ACCESSORIES.cap('felt', weasel, { back: true });
  weasel.joints.headSlot.add(wHat);
  weasel.adopt(wHat);
  const tail = ACCESSORIES.tail(weasel.s);
  // 从衣襟下摆底下伸出来（中山装下摆盖到臀下）
  tail.position.set(0, -0.06 * weasel.s, 0.1 * weasel.s);
  weasel.joints.hips.add(tail);
  weasel.adopt(tail);
  root.add(weasel.root);

  const mode = lookToMode(look);
  if (mode !== 'standard') {
    man.setMaterialMode(mode, look === 'ghost' ? PALETTE.GHOST : undefined);
    weasel.setMaterialMode(mode, look === 'ghost' ? PALETTE.GHOST : undefined);
  }
  // 整棵子树 36.5℃（红外下是热乎乎的人形，戴面具时也是）
  setTempTree(root, TEMP_C.huang);

  const headAnchor = new THREE.Object3D();
  headAnchor.name = 'anchorHead';
  const chest = new THREE.Object3D();
  chest.name = 'anchorChest';
  root.add(headAnchor, chest);
  const mouthMasked = paper.mouth;

  let variant = o.variant ?? (look === 'replay' ? 'man' : 'masked');
  const applyVariant = () => {
    paper.root.visible = variant === 'masked';
    man.root.visible = variant === 'man';
    weasel.root.visible = variant === 'weasel';
    if (variant === 'masked') {
      headAnchor.position.set(0, 1.385, -0.02);
      chest.position.set(0, 1.05, -0.12);
    } else {
      headAnchor.position.set(0, 1.28, 0);
      chest.position.set(0, 1.05, -0.1);
    }
  };
  applyVariant();

  const rig: CharacterRig = {
    kind: 'huang',
    props: { masked: paper.root, man: man.root, weasel: weasel.root, mask: paper.face, hat: manHat, tail },
    anchors: { head: headAnchor, chest, mouth: mouthMasked },
    root,
    joints: man.joints,
    height: 1.4,
    setPose(p, b) {
      man.setPose(p, b);
      weasel.setPose(p, b);
    },
    update(dt, speed) {
      paper.update(dt);
      man.update(dt, speed);
      weasel.update(dt, speed);
    },
    setMaterialMode(m, c) {
      man.setMaterialMode(m, c);
      weasel.setMaterialMode(m, c);
    },
    setOpacity(a) {
      man.setOpacity(a);
      weasel.setOpacity(a);
    },
    bounds(t) {
      t.makeEmpty();
      root.updateWorldMatrix(true, true);
      const b = new THREE.Box3();
      root.traverseVisible(c => {
        const m = c as THREE.Mesh;
        if (!m.isMesh || m.userData.noBounds) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        b.copy(m.geometry.boundingBox as THREE.Box3).applyMatrix4(m.matrixWorld);
        t.union(b);
      });
      return t;
    },
    dispose() {
      paper.dispose();
      man.dispose();
      weasel.dispose();
      root.removeFromParent();
    },
    setVariant(v) {
      variant = v;
      applyVariant();
    },
    hdFace: { mesh: paper.face, lo: () => vendorAtlas(), hi: () => (paper.faceHi ? paper.faceHi() : vendorAtlas()) },
  };
  return rig;
}

// ---------------------------------------------------------------- 工厂

export function createCharacter(kind: CharacterKind, opts?: CharacterOpts): CharacterRig {
  const o = opts ?? {};
  if (kind === 'huang') return createHuang(o);
  const look: Look = o.look ?? 'live';
  let b: Built;
  switch (kind) {
    case 'tudi': b = buildTudi(o); break;
    case 'wang': b = buildWang(o); break;
    case 'lu': b = buildLu(o); break;
    case 'zhou': b = buildZhou(o); break;
    case 'jianguo': b = buildJianguo(o); break;
    case 'kid': b = buildKid(o); break;
    case 'bride': b = buildBride(); break;
    case 'apprentice': b = buildApprentice(); break;
    case 'junkman': b = buildJunkman(); break;
    case 'worker': b = buildWorker(); break;
    case 'neighbor': b = buildNeighbor(o); break;
  }
  const { h } = b;
  h.root.name = `character.${kind}`;
  const anchors = makeAnchors(h);
  const faceMask = o.faceMask ?? (kind === 'zhou' && look === 'replay');
  if (faceMask) {
    const snow = ACCESSORIES.faceSnow(h.s, anchors.head);
    h.joints.headSlot.add(snow);
    h.adopt(snow, { keepMaterial: true });
    b.props.faceSnow = snow;
  }
  // 土地的“魂影”是本色 + 土地金描边（buildTudi 已加），其余角色换魂影材质
  const mode = lookToMode(look);
  if (mode !== 'standard' && !(kind === 'tudi' && look === 'ghost')) h.setMaterialMode(mode, look === 'ghost' ? ghostColor(kind) : undefined);
  if (look === 'live') setTempTree(h.root, TEMP_C.alive);
  return wrap(h, kind, b.props, anchors, b.post, b.extra);
}
