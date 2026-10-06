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

function buildTudi(o: CharacterOpts): Built {
  const deity = o.look === 'ghost';
  const spec: HumanoidSpec = { height: 1.2, build: 'stout', shirt: '#7C7A74', pants: '#4C4A46', shoes: '#1a1a1a', skin: '#C49A7A', sleeves: 'long', robe: true, head: 'human' };
  const face: FaceOpts = { skin: '#C49A7A', hair: '#E8E6E0', hairStyle: 'bald', age: 'old', brows: 1.2, seed: 5 };
  const style: HumanoidStyle = { robeMap: robeTexture(), ...(deity ? { rim: PALETTE.TUDI_GOLD } : {}) };
  const h = createHumanoidInternal(spec, face, style);
  const s = h.s;
  const beard = ACCESSORIES.beard(s);
  h.joints.headSlot.add(beard);
  // 枣木拐杖立在右前方（挂在 root 上，拄着不动），右手握在杖身上
  const cane = ACCESSORIES.caneLantern(s * 1.32);
  cane.group.position.set(0.19, 0, -0.29);
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

function buildWang(o: CharacterOpts): Built {
  const young = o.age === 'young';
  const spec: HumanoidSpec = { height: young ? 1.58 : 1.5, build: young ? 'normal' : 'hunch', shirt: '#5B6E8C', pants: '#2B2A2E', shoes: '#141416', skin: '#C9A080', sleeves: 'long', head: 'human' };
  const face: FaceOpts = { skin: '#C9A080', hair: young ? '#1c1816' : '#8D8A86', hairStyle: 'long', age: young ? 'young' : 'old', female: true, seed: 7 };
  const floral = floralTexture('#5B6E8C', 3);
  const h = createHumanoidInternal(spec, face, { torsoMap: floral, sleeveMap: floral, shoeMap: clothShoeTexture() });
  const s = h.s;
  const bun = ACCESSORIES.bun(s);
  h.joints.headSlot.add(bun);
  h.adopt(bun);
  const props: Record<string, THREE.Object3D> = { bun };
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
  const face: FaceOpts = { skin: '#C49A7E', hair: young ? '#1e1a17' : '#6E6C68', hairStyle: 'short', age: young ? 'young' : 'old', seed: 11 };
  // M4 第 2 轮：魂色偏暖（GHOST_LU #E8E0D0 往暖处偏 10%）、少保留衣服原色（灰中山装的色相偏冷，原色留得越多整个人越是冷灰白），
  // 门岗的绿光里读成 GDD 写的暖白；中山装的口袋、扣子靠贴图亮度与立体的口袋盖读出来
  const h = createHumanoidInternal(spec, face, { torsoMap: zhongshanTexture('#7E8288'), ghost: { baseAmt: 0.2, tint: GHOST_LU_WARM } });
  const s = h.s;
  const suit = zhongshanDetails(h, '#7E8288');
  h.joints.spine.add(suit);
  h.adopt(suit);
  const glasses = ACCESSORIES.glasses(s);
  h.joints.headSlot.add(glasses);
  h.adopt(glasses);
  const tlr = ACCESSORIES.tlr(s);
  tlr.position.set(0, 0.2 * s, -0.155 * s);
  h.joints.spine.add(tlr);
  h.adopt(tlr);
  return { h, props: { glasses, tlr, suit } };
}

function buildZhou(o: CharacterOpts): Built {
  const spec: HumanoidSpec = { height: 1.75, build: 'hunch', shirt: PALETTE.UNIFORM, pants: '#3B3D42', shoes: '#141416', skin: '#A07E66', sleeves: 'short', head: 'human' };
  const face: FaceOpts = { skin: '#A07E66', hair: '#4A4642', hairStyle: 'short', age: 'old', seed: 1960 };
  const h = createHumanoidInternal(spec, face, { torsoMap: uniformShirtTexture(), shoeMap: clothShoeTexture() });
  const s = h.s;
  const collar = ACCESSORIES.shirtCollar(s, PALETTE.UNIFORM, { open: false });
  h.joints.spine.add(collar);
  h.adopt(collar);
  const band = ACCESSORIES.armband(s);
  h.joints.shoulderL.add(band);
  h.adopt(band);
  const props: Record<string, THREE.Object3D> = { collar, armband: band };
  const cap = ACCESSORIES.cap('cloth', s);
  h.joints.headSlot.add(cap);
  h.adopt(cap);
  props.cap = cap;
  const mug = ACCESSORIES.mug(s);
  mug.position.set(0, -0.3 * s, -0.03 * s);
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
  const face: FaceOpts = { skin: spec.skin as string, hair: '#15120f', hairStyle: 'short', age: child ? 'child' : 'young', seed: 1986 };
  return { h: createHumanoidInternal(spec, face), props: {} };
}

function buildKid(o: CharacterOpts): Built {
  const r = rng(o.seed ?? 2012);
  const spec: HumanoidSpec = { height: range(r, 1.2, 1.35), build: 'slim', shirt: '#E6E4DC', pants: pick(r, ['#2F4A7E', '#2E3036', '#34523A']), shoes: '#EDEBE3', skin: '#D1A788', sleeves: 'short', head: 'human' };
  const h = createHumanoidInternal(spec, { skin: '#D1A788', hair: '#141210', hairStyle: 'short', age: 'child', seed: Math.floor(r() * 99) });
  const scarf = ACCESSORIES.scarf(h.s);
  h.joints.spine.add(scarf);
  h.adopt(scarf);
  return { h, props: { scarf } };
}

function buildBride(): Built {
  const spec: HumanoidSpec = { height: 1.6, build: 'slim', shirt: '#B3202A', pants: '#B3202A', shoes: '#7A1018', skin: '#D8B090', sleeves: 'long', robe: true, head: 'human' };
  const h = createHumanoidInternal(spec, { skin: '#D8B090', hair: '#120e0c', hairStyle: 'long', age: 'young', female: true, seed: 1990 });
  const bun = ACCESSORIES.bun(h.s);
  h.joints.headSlot.add(bun);
  h.adopt(bun);
  return { h, props: { bun } };
}

function buildApprentice(): Built {
  const spec: HumanoidSpec = { height: 1.7, build: 'slim', shirt: '#E6E2D6', pants: '#2E3036', shoes: '#1a1816', skin: '#C9A080', sleeves: 'long', head: 'human' };
  return { h: createHumanoidInternal(spec, { skin: '#C9A080', hair: '#15120f', hairStyle: 'short', age: 'young', seed: 17 }), props: {} };
}

function buildJunkman(): Built {
  const spec: HumanoidSpec = { height: 1.66, build: 'hunch', shirt: '#5A5850', pants: '#3E3C38', shoes: '#231f1a', skin: '#A88468', sleeves: 'long', head: 'human' };
  const h = createHumanoidInternal(spec, { skin: '#A88468', hair: '#6b665e', hairStyle: 'short', age: 'old', seed: 23 });
  const cap = ACCESSORIES.cap('cloth', h.s);
  h.joints.headSlot.add(cap);
  h.adopt(cap);
  return { h, props: { cap } };
}

function buildWorker(): Built {
  const spec: HumanoidSpec = { height: 1.76, build: 'stout', shirt: '#D86A1E', pants: '#2C3440', shoes: '#1a1816', skin: '#B08A6A', sleeves: 'long', head: 'human' };
  const h = createHumanoidInternal(spec, { skin: '#B08A6A', hair: '#15120f', hairStyle: 'short', age: 'young', seed: 28 });
  const hat = ACCESSORIES.hardHat(h.s);
  h.joints.headSlot.add(hat);
  h.adopt(hat);
  return { h, props: { hardHat: hat } };
}

function buildNeighbor(o: CharacterOpts): Built {
  const r = rng(o.seed ?? 2008);
  const female = r() < 0.5;
  const skin = pick(r, ['#C9A080', '#B8906E', '#D1A788']);
  const spec: HumanoidSpec = {
    height: female ? range(r, 1.52, 1.64) : range(r, 1.64, 1.8), build: pick(r, ['normal', 'slim', 'stout'] as const),
    shirt: pick(r, ['#C8C2B0', '#7A2E2E', '#2E5A7A', '#556B2F', '#8C7A5A', '#E0DCCF']), pants: pick(r, ['#2E3036', '#3C4A6A', '#4A4038']),
    shoes: '#1d1a18', skin, sleeves: 'short', head: 'human',
  };
  const old = r() < 0.4;
  const h = createHumanoidInternal(spec, { skin, hair: old ? '#8a8680' : '#15120f', hairStyle: female ? 'long' : 'short', age: old ? 'old' : 'young', female, seed: Math.floor(r() * 999) });
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
  const manSpec: HumanoidSpec = { height: 1.4, build: 'slim', shirt: '#4E5A63', pants: '#3A3A36', shoes: '#1a1814', skin: '#B08A68', sleeves: 'long', head: 'human' };
  const man = createHumanoidInternal(manSpec, { skin: '#B08A68', hair: '#3a3026', hairStyle: 'short', age: 'old', seed: 1970 }, { torsoMap: clothes });
  man.root.name = 'huangMan';
  const manSuit = zhongshanDetails(man, '#4E5A63');
  man.joints.spine.add(manSuit);
  man.adopt(manSuit);
  const manHat = ACCESSORIES.cap('felt', man.s, { low: true });
  man.joints.headSlot.add(manHat);
  man.adopt(manHat);
  root.add(man.root);

  const weasel = createHumanoidInternal({ ...manSpec, head: 'weasel' }, undefined, { torsoMap: clothes });
  weasel.root.name = 'huangWeasel';
  const wSuit = zhongshanDetails(weasel, '#4E5A63');
  weasel.joints.spine.add(wSuit);
  weasel.adopt(wSuit);
  const wHat = ACCESSORIES.cap('felt', weasel.s);
  // 黄鼠狼的毡帽戴得靠后，露出尖脸和两只耳朵
  wHat.position.set(0, 0.215 * weasel.s, 0.03 * weasel.s);
  wHat.rotation.x = 0.28;
  weasel.joints.headSlot.add(wHat);
  weasel.adopt(wHat);
  const tail = ACCESSORIES.tail(weasel.s);
  tail.position.set(0, -0.02 * weasel.s, 0.1 * weasel.s);
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
