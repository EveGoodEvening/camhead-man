// owner: R4
// 鬼市（GDD §4.5，丑时开市后）：北排南排十个摊位（矮桌、黑布、摊上的阴间货物与价签），十盏白纸灯笼（阴火 6℃，只用 emissive + Bloom，
// 另由 logic 给 N3、S3 两盏配真实点光），头顶两串小灯笼（灯笼阵的节奏），九个实例化纸人摊主（S3 是黄三爷，NPC 单独建），
// 飘着的影子（带地影与一圈淡青光），满地纸钱与从顶上慢慢飘落的几张，鬼市口的白布幡“鬼　市”，摊间靠墙的纸花圈，摊后起褶的布幔，
// 樟木箱，旧书残页。整组挂在 market 节点下，开市前隐藏。

import * as THREE from 'three';
import type { AreaContext } from '../../../core/area';
import type { V3 } from '../../../core/types';
import { DEG2RAD } from '../../../core/math';
import { NPC, OBJ, type StallId } from '../../../data/ids';
import { PALETTE } from '../../../data/palette';
import { TEMP_C } from '../../../data/render';
import { MATERIALS } from '../../../fx/materials';
import { PROPS } from '../../../kit/props';
import { rng, range } from '../../../kit/rng';
import { createPaperStalls } from '../../../rigs/paper';
import { R4L, STALLS, lanternAt, tableCenter, type StallSlot } from '../layout';
import { backdropTexture, goodsAtlasTexture, jossCoinTexture, lanternAtlasTexture, marketBannerTexture, mistMask, oldBookPageTexture, paperCutTexture, radialGlowMask, shadowMaskTexture, smallLanternTexture, streamerTexture, tagsTexture, wreathTexture } from './textures';
import { addMerged, bake, boxG, cylG, mergeAll, toCell } from './util';

export interface LanternRig { pivot: THREE.Group; mat: THREE.MeshBasicMaterial; x: number; slot: StallSlot; phase: number }
export interface ShadowRig {
  mesh: THREE.Mesh;
  /** 投在地上的那一道影子（从最近那排灯笼往过道里拉长；过道被灯笼照亮的地方才看得出“这儿站着个什么”） */
  floor: THREE.Mesh;
  /** 地影往哪边拉（+1 往南、-1 往北） */
  dir: 1 | -1;
  x0: number; z: number; amp: number; speed: number; phase: number;
}

export interface MarketRig {
  group: THREE.Group;
  vendors: THREE.InstancedMesh;
  /** 与 vendors 实例同序的摊位（不含黄三爷） */
  vendorSlots: readonly StallSlot[];
  /** 纸人晃动的相位（黄三爷用 huangPhase，与普通摊主同一套公式） */
  vendorPhase: readonly number[];
  huangPhase: number;
  /** 按 x 从西到东排好的十盏灯笼 */
  lanterns: readonly LanternRig[];
  /** 头顶的小灯笼串（实例化；按 x 排序，count 逐个亮起） */
  array: THREE.InstancedMesh;
  arrayBase: readonly THREE.Matrix4[];
  shadows: readonly ShadowRig[];
  /** 开市那一下撒上半空的纸钱（实例化，logic 驱动） */
  burst: THREE.InstancedMesh;
  /** 开市后一直有几张纸钱从顶上慢慢飘下来（实例化；按时间直接算位置，截图可复现） */
  drift: THREE.InstancedMesh;
  driftSeeds: readonly { x: number; z: number; speed: number; off: number; spin: number }[];
  chest: THREE.Object3D;
  oldBook: THREE.Object3D;
  /** 摊主的拾取代理（交互物 hit） */
  hits: ReadonlyMap<StallId, THREE.Object3D>;
  /** 蜡烛、香头的火（阴火，开市前后都是 emissive） */
  flames: THREE.MeshBasicMaterial;
  /** 灯笼在地上、布幔上投的柔光（跟着开市进度亮起来） */
  glowMats: readonly THREE.MeshBasicMaterial[];
  /** 贴地薄雾（两层，UV 慢慢漂） */
  mist: readonly THREE.Texture[];
  /** 顶梁垂下的白纸幡（实例化；base = 静止时的矩阵） */
  streamers: THREE.InstancedMesh;
  streamerBase: readonly THREE.Matrix4[];
  streamerPhase: readonly number[];
  /** 鬼市口横挂的白布幡（绕挂绳轻轻前后摆） */
  banner: THREE.Object3D;
}

/** 纸人晃动：绕脚底的轻微偏转与侧倾（弧度），普通摊主与伪装的黄三爷共用（ARCH §5.3：外形、动作都不能露馅）。 */
export function paperSway(t: number, phase: number): { yaw: number; roll: number; pitch: number } {
  return {
    yaw: 2.2 * DEG2RAD * Math.sin(t * 0.47 + phase),
    roll: 1.3 * DEG2RAD * Math.sin(t * 0.71 + phase * 1.7),
    pitch: 0.8 * DEG2RAD * Math.sin(t * 0.37 + phase * 0.6),
  };
}

// ———————————————————————————————————————————— 摊子

const GOODS_COLS = 4;
const cellBox = (w: number, h: number, d: number, cell: number): THREE.BufferGeometry => toCell(boxG(w, h, d), cell, GOODS_COLS, GOODS_COLS);
const cellCyl = (rt: number, rb: number, h: number, cell: number, seg = 12): THREE.BufferGeometry => toCell(cylG(rt, rb, h, seg), cell, GOODS_COLS, GOODS_COLS);

interface Buckets {
  wood: THREE.BufferGeometry[]; cloth: THREE.BufferGeometry[]; topCloth: THREE.BufferGeometry[]; goods: THREE.BufferGeometry[]; tags: THREE.BufferGeometry[];
  paper: THREE.BufferGeometry[]; red: THREE.BufferGeometry[]; bamboo: THREE.BufferGeometry[]; flame: THREE.BufferGeometry[]; black: THREE.BufferGeometry[];
  backdrop: THREE.BufferGeometry[]; cuts: THREE.BufferGeometry[];
}

type Bucket = 'goods' | 'paper' | 'red' | 'flame';
type Place = (g: THREE.BufferGeometry, p: V3, ry?: number, rot?: V3, bucket?: Bucket) => void;

/** 摊上的货：local 坐标（桌面中心为原点、+z = 朝过道），place 把它摆到世界里（默认进贴图集那一份）。 */
function stallGoods(slot: StallSlot, place: Place, r: () => number): void {
  const y = 0.012;
  switch (slot.theme) {
    case 0: // 元宝、纸钱、纸扎小楼
      for (let i = 0; i < 4; i++) place(cellBox(0.2, 0.05 + i * 0.015, 0.12, 0), [-0.45 + i * 0.13, y + 0.03, -0.12 + (i % 2) * 0.04], range(r, -8, 8));
      for (let i = 0; i < 6; i++) {
        const ingot = toCell(new THREE.SphereGeometry(0.06, 10, 6), 1, GOODS_COLS, GOODS_COLS);
        ingot.scale(1.4, 0.6, 0.85);
        place(ingot, [0.05 + (i % 3) * 0.12, y + 0.035 + Math.floor(i / 3) * 0.045, 0.1 - Math.floor(i / 3) * 0.05], range(r, -20, 20));
      }
      // 纸扎小楼：白纸墙 + 红纸顶
      place(boxG(0.22, 0.2, 0.18), [0.42, y + 0.1, -0.1], 0, undefined, 'paper');
      place(new THREE.ConeGeometry(0.19, 0.12, 4), [0.42, y + 0.26, -0.1], 45, undefined, 'red');
      break;
    case 1: // 纸扎手机、纸扎电视
      for (let i = 0; i < 5; i++) place(cellBox(0.07, 0.13, 0.015, 2), [-0.5 + i * 0.1, y + 0.065, 0.12], 0, [-12, range(r, -10, 10), 0]);
      place(cellBox(0.34, 0.26, 0.22, 15), [0.3, y + 0.13, -0.05], 180);
      break;
    case 2: // 老照片、相框
      for (let i = 0; i < 4; i++) place(cellBox(0.17, 0.23, 0.02, 14), [-0.45 + i * 0.26, y + 0.11, -0.12], 180, [10, range(r, -10, 10), 0]);
      for (let i = 0; i < 6; i++) place(cellBox(0.1, 0.004, 0.07, 6 + (i % 2)), [-0.4 + i * 0.15, y + 0.003, 0.12], range(r, -25, 25));
      break;
    case 3: // 寿衣、纸鞋
      for (let i = 0; i < 3; i++) place(cellBox(0.32, 0.05 + i * 0.01, 0.22, 8), [-0.4 + i * 0.36, y + 0.03, -0.02], range(r, -5, 5));
      for (let i = 0; i < 2; i++) place(boxG(0.07, 0.05, 0.16), [0.2 + i * 0.09, y + 0.025, 0.18], 0, undefined, 'paper');
      break;
    case 4: // 纸马
      for (let i = 0; i < 2; i++) {
        const x0 = -0.3 + i * 0.5;
        place(cellBox(0.3, 0.12, 0.1, 13), [x0, y + 0.2, 0], 0);
        place(cellBox(0.07, 0.16, 0.07, 13), [x0 + 0.16, y + 0.3, 0], 0, [0, 0, -25]);
        place(cellBox(0.12, 0.06, 0.06, 13), [x0 + 0.22, y + 0.38, 0], 0);
        for (const [dx, dz] of [[-0.11, -0.03], [-0.11, 0.03], [0.11, -0.03], [0.11, 0.03]] as const) place(cellBox(0.025, 0.15, 0.025, 13), [x0 + dx, y + 0.075, dz], 0);
      }
      break;
    case 5: // 旧收音机、磁带
      place(cellBox(0.36, 0.22, 0.15, 3), [-0.28, y + 0.11, -0.05], 180);
      place(cellBox(0.26, 0.16, 0.12, 3), [0.22, y + 0.08, -0.08], 185);
      for (let i = 0; i < 5; i++) place(cellBox(0.1, 0.015, 0.065, 4), [0.05 + (i % 3) * 0.12, y + 0.008 + Math.floor(i / 3) * 0.016, 0.16], range(r, -15, 15));
      break;
    case 6: // 搪瓷缸、搪瓷盆
      for (let i = 0; i < 5; i++) place(cellCyl(0.045, 0.043, 0.095, 5), [-0.5 + i * 0.13, y + 0.048, 0.1 - (i % 2) * 0.12], 180 + range(r, -30, 30));
      place(cylG(0.17, 0.12, 0.07, 18), [0.35, y + 0.035, -0.05], 0, undefined, 'red');
      break;
    case 7: // 黄三爷的旧货：磁带、收音机、闹钟、铜锁（旧书残页单独建，是交互物）
      place(cellBox(0.3, 0.18, 0.13, 3), [0.35, y + 0.09, -0.12], 175);
      for (let i = 0; i < 6; i++) place(cellBox(0.1, 0.015, 0.065, 4), [0.05 + (i % 3) * 0.11, y + 0.008 + Math.floor(i / 3) * 0.016, 0.13], range(r, -20, 20));
      place(cellCyl(0.06, 0.06, 0.035, 9, 16), [0.52, y + 0.07, 0.12], 0, [80, 0, 0]);
      break;
    case 8: // 铜钱、钥匙
      for (let i = 0; i < 14; i++) place(cellCyl(0.03, 0.03, 0.005, 9), [-0.45 + (i % 7) * 0.13, y + 0.003 + Math.floor(i / 7) * 0.006, 0.05 - Math.floor(i / 7) * 0.12], range(r, 0, 90));
      for (let i = 0; i < 3; i++) place(cellBox(0.04, 0.04, 0.3, 9), [0.35 + i * 0.07, y + 0.02, -0.05], range(r, -10, 10));
      break;
    case 9: // 香烛：一捆捆香、红白蜡烛（火头是阴火）
      place(cellBox(0.24, 0.1, 0.16, 10), [-0.4, y + 0.05, -0.08], 180);
      for (let i = 0; i < 5; i++) {
        const x = -0.1 + i * 0.12;
        const h = 0.12 + (i % 3) * 0.03;
        place(cylG(0.022, 0.022, h, 10), [x, y + h / 2, 0.05], 0, undefined, i % 2 ? 'red' : 'paper');
        place(new THREE.SphereGeometry(0.014, 6, 5).scale(1, 1.8, 1), [x, y + h + 0.02, 0.05], 0, undefined, 'flame');
      }
      break;
  }
}

/** 摊后挂的布幔：竖褶是真的起伏（灯笼光打上去一明一暗），下摆微微往外飘；朝 +z，贴墙那面在 z=0。 */
function curtainGeometry(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 18, 4);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const down = (h / 2 - y) / h;                 // 0 顶 → 1 底
    p.setZ(i, 0.045 + 0.035 * Math.sin((x / w) * Math.PI * 9) + 0.03 * down * down);
  }
  g.computeVertexNormals();
  return g;
}

function buildStalls(ctx: AreaContext, market: THREE.Group): { hits: Map<StallId, THREE.Object3D>; flames: THREE.MeshBasicMaterial } {
  const T = R4L.table;
  const b: Buckets = { wood: [], cloth: [], topCloth: [], goods: [], tags: [], paper: [], red: [], bamboo: [], flame: [], black: [], backdrop: [], cuts: [] };
  const r = rng(4004);
  const hits = new Map<StallId, THREE.Object3D>();
  const hitGeo = new THREE.BoxGeometry(0.52, 1.62, 0.36);
  for (const slot of STALLS) {
    const [tx, tz] = tableCenter(slot);
    const flip = slot.row === 's' ? 180 : 0;      // local +z = 朝过道
    const rot = (x: number, z: number): [number, number] => (flip ? [-x, -z] : [x, z]);
    const at = (x: number, y: number, z: number): V3 => {
      const [lx, lz] = rot(x, z);
      return [tx + lx, y, tz + lz];
    };
    // 桌：面板 + 四条腿；黑布从桌沿垂到地；桌面铺一块暗红布
    b.wood.push(bake(boxG(T.w, 0.04, T.d), at(0, T.h - 0.02, 0)));
    for (const [lx, lz] of [[-0.6, -0.26], [0.6, -0.26], [-0.6, 0.26], [0.6, 0.26]] as const) b.wood.push(bake(boxG(0.04, T.h - 0.04, 0.04), at(lx, (T.h - 0.04) / 2, lz)));
    b.cloth.push(bake(boxG(T.w + 0.04, T.h - 0.05, 0.012), at(0, (T.h - 0.05) / 2 + 0.02, T.d / 2 + 0.012)));
    b.cloth.push(bake(boxG(0.012, T.h - 0.05, T.d), at(-(T.w / 2 + 0.012), (T.h - 0.05) / 2 + 0.02, 0)));
    b.cloth.push(bake(boxG(0.012, T.h - 0.05, T.d), at(T.w / 2 + 0.012, (T.h - 0.05) / 2 + 0.02, 0)));
    b.topCloth.push(bake(boxG(T.w + 0.06, 0.008, T.d + 0.04), at(0, T.h + 0.004, 0)));
    // 桌沿挂一排红纸挂钱（朝过道）
    b.cuts.push(bake(new THREE.PlaneGeometry(T.w, 0.2), at(0, T.h - 0.1, T.d / 2 + 0.022), flip));
    // 摊后墙上挂的布幔（给纸人衬个暗底）
    const wallZ = slot.row === 'n' ? R4L.hall.z0 + 0.03 : R4L.hall.z1 - 0.03;
    b.backdrop.push(bake(curtainGeometry(1.75, 2.2), [slot.pos[0], 1.18, wallZ], flip));
    // 货
    const place: Place = (g, p, ry = 0, er, bucket = 'goods') => {
      b[bucket].push(bake(g, at(p[0], T.h + p[1], p[2]), ry + flip, 1, er));
    };
    stallGoods(slot, place, r);
    // 价签（卡片立在桌沿，朝过道）
    const tag = toCell(new THREE.PlaneGeometry(0.2, 0.1), slot.theme, 5, 2);
    b.tags.push(bake(tag, at(-0.38, T.h + 0.08, T.d / 2 - 0.02), flip, 1, [-15, 0, 0]));
    b.wood.push(bake(boxG(0.012, 0.08, 0.012), at(-0.38, T.h + 0.04, T.d / 2 - 0.03)));
    // 挑灯笼的竹竿：摊主右手边竖一根（到 2m 高），顶上朝过道横出一截，灯笼挂在脸的高度
    const lp = lanternAt(slot);
    const back = slot.row === 'n' ? -0.26 : 0.26;
    const px = lp[0], pz = lp[2] + back;
    b.bamboo.push(bake(cylG(0.017, 0.021, 2.02, 6), [px, 1.01, pz]));
    const arm = cylG(0.013, 0.013, Math.abs(back) + 0.06, 6);
    arm.rotateX(Math.PI / 2);
    b.bamboo.push(bake(arm, [px, 1.98, (pz + lp[2]) / 2]));
    b.black.push(bake(cylG(0.003, 0.003, 1.98 - (lp[1] + 0.25), 4), [lp[0], (1.98 + lp[1] + 0.25) / 2, lp[2]]));
    // 摊主的拾取代理（S3 用黄三爷 NPC 自己的根节点）
    if (slot.id !== NPC.HUANG) {
      const h = new THREE.Mesh(hitGeo, MATERIALS.hitProxy());
      h.position.set(slot.pos[0], 0.81, slot.pos[2]);
      h.name = `hit:${slot.id}`;
      ctx.add(h, { parent: market });
      hits.set(slot.id as StallId, h);
    }
  }
  const goodsTex = ctx.track(goodsAtlasTexture());
  goodsTex.anisotropy = 4;
  const tagTex = ctx.track(tagsTexture());
  const add = (list: THREE.BufferGeometry[], mat: THREE.Material, name: string, own = true, tempC?: number) => {
    if (list.length === 0) return;
    const m = addMerged(ctx, list, mat, name, market, own);
    if (tempC !== undefined) m.userData.tempC = tempC;
  };
  add(b.wood, MATERIALS.wood(), 'r4:stallWood', false);
  add(b.cloth, MATERIALS.cloth('#141319'), 'r4:stallCloth', false);
  add(b.topCloth, MATERIALS.cloth('#3b1518'), 'r4:stallTopCloth', false);
  add(b.goods, new THREE.MeshStandardMaterial({ map: goodsTex, roughness: 0.78 }), 'r4:goods', true, TEMP_C.paper);
  add(b.tags, new THREE.MeshStandardMaterial({ map: tagTex, roughness: 0.9, side: THREE.DoubleSide }), 'r4:tags', true, TEMP_C.paper);
  add(b.paper, MATERIALS.paper(), 'r4:paperGoods', false, TEMP_C.paper);
  add(b.red, MATERIALS.enamelRed(), 'r4:redGoods', false);
  add(b.bamboo, new THREE.MeshStandardMaterial({ color: '#7f6a3e', roughness: 0.75 }), 'r4:bamboo');
  add(b.black, new THREE.MeshStandardMaterial({ color: '#141210', roughness: 0.9 }), 'r4:strings');
  const bdTex = ctx.track(backdropTexture());
  add(b.backdrop, new THREE.MeshStandardMaterial({ map: bdTex, roughness: 0.95 }), 'r4:backdrops');
  const cutTex = ctx.track(paperCutTexture());
  add(b.cuts, new THREE.MeshStandardMaterial({ map: cutTex, alphaTest: 0.5, roughness: 0.9, side: THREE.DoubleSide }), 'r4:paperCuts', true, TEMP_C.paper);
  const flames = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9FF2D0').multiplyScalar(2.6) });
  flames.userData.tempC = TEMP_C.ghostLantern;
  add(b.flame, flames, 'r4:flames', true, TEMP_C.ghostLantern);
  return { hits, flames };
}

// ———————————————————————————————————————————— 灯笼

function lanternGeometry(cell: number): THREE.BufferGeometry {
  const prof = [[0.001, 0.23], [0.12, 0.22], [0.2, 0.13], [0.215, 0], [0.2, -0.13], [0.12, -0.22], [0.001, -0.23]].map(([x, y]) => new THREE.Vector2(x ?? 0, y ?? 0));
  const geo = new THREE.LatheGeometry(prof, 20);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), 1 - uv.getY(i));
  return toCell(geo, cell, 5, 2);
}

function buildLanterns(ctx: AreaContext, market: THREE.Group): LanternRig[] {
  const atlas = ctx.track(lanternAtlasTexture());
  atlas.anisotropy = 4;
  const capMat = new THREE.MeshStandardMaterial({ color: '#1a1714', roughness: 0.8 });
  ctx.track(capMat);
  const r = rng(515);
  const out: LanternRig[] = [];
  STALLS.forEach((slot, i) => {
    const p = lanternAt(slot);
    const pivot = new THREE.Group();
    pivot.name = `lantern:${slot.id}`;
    pivot.position.set(p[0], p[1] + 0.3, p[2]);
    // 纸灯笼是自己亮的（不受旁边真实点光的照射，否则灯芯那盏点光把纸面照成一团白）：MeshBasic，亮度 = 灯笼白 × 开市进度
    const mat = new THREE.MeshBasicMaterial({ map: atlas, color: '#000000', side: THREE.DoubleSide });
    mat.userData.tempC = TEMP_C.ghostLantern;
    ctx.track(mat);
    const body = new THREE.Mesh(lanternGeometry(i), mat);
    body.position.y = -0.3;
    // 字（贴图格子里 u=0.25/0.75）朝东西两边：沿着通道走时看得见
    body.rotation.y = Math.PI / 4 + range(r, -0.15, 0.15);
    body.name = 'lanternBody';
    pivot.add(body);
    const top = cylG(0.08, 0.1, 0.04, 10);
    const bot = cylG(0.1, 0.08, 0.04, 10);
    const capG = mergeAll([bake(top, [0, -0.3 + 0.245, 0]), bake(bot, [0, -0.3 - 0.245, 0]), bake(cylG(0.004, 0.004, 0.08, 4), [0, -0.03, 0])]);
    const cap = new THREE.Mesh(capG, capMat);
    cap.name = 'lanternCap';
    pivot.add(cap);
    // 灯笼底下的一撮穗子
    const tassel = new THREE.Mesh(cylG(0.02, 0.004, 0.16, 6), MATERIALS.enamelRed());
    tassel.position.y = -0.3 - 0.33;
    pivot.add(tassel);
    ctx.add(pivot, { parent: market, tempC: TEMP_C.ghostLantern });
    out.push({ pivot, mat, x: p[0], slot, phase: range(r, 0, Math.PI * 2) });
  });
  return out.sort((a, bb) => a.x - bb.x);
}

/** 头顶小灯笼的自发光（× 灯笼白）。 */
const ARRAY_GLOW = 1.0;

/** 头顶的两串小白灯笼（纯 emissive，GDD §9.3“远灯/灯笼阵只用 emissive”）。 */
function buildLanternArray(ctx: AreaContext, market: THREE.Group): { mesh: THREE.InstancedMesh; base: THREE.Matrix4[] } {
  const prof = [[0.001, 0.11], [0.06, 0.105], [0.1, 0.06], [0.11, 0], [0.1, -0.06], [0.06, -0.105], [0.001, -0.11]].map(([x, y]) => new THREE.Vector2(x ?? 0, y ?? 0));
  const geo = new THREE.LatheGeometry(prof, 12);
  const map = ctx.track(smallLanternTexture());
  // 比摊位灯笼暗一截：头顶的是“灯笼阵”的节奏，不是照明；太亮的话走到底下时一盏盏烧成白团
  const mat = new THREE.MeshBasicMaterial({ map, color: new THREE.Color(PALETTE.LANTERN).multiplyScalar(ARRAY_GLOW) });
  mat.userData.tempC = TEMP_C.ghostLantern;
  ctx.track(mat);
  const xs: { x: number; z: number; y: number }[] = [];
  for (const [z, off] of [[-0.62, 0], [0.62, 0.8]] as const) {
    for (let x = -15 + off; x <= 17.5; x += 1.6) {
      // 绳子两根梁之间下垂：灯笼高度随 x 起伏
      const k = ((x + 17.5) % 5) / 5;
      xs.push({ x, z, y: 2.62 - 0.12 * Math.sin(k * Math.PI) });
    }
  }
  xs.sort((a, b) => a.x - b.x);
  const mesh = new THREE.InstancedMesh(geo, mat, xs.length);
  mesh.name = 'r4:lanternArray';
  const base: THREE.Matrix4[] = [];
  xs.forEach((p, i) => {
    const m = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z);
    base.push(m);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  ctx.add(mesh, { parent: market, tempC: TEMP_C.ghostLantern });
  // 两根拉在梁之间的绳（折线）
  const pts: number[] = [];
  for (const z of [-0.62, 0.62]) {
    for (let x = -17.5; x < 17.5; x += 0.5) {
      const y0 = 2.74 - 0.12 * Math.sin((((x + 17.5) % 5) / 5) * Math.PI);
      const x1 = x + 0.5;
      const y1 = 2.74 - 0.12 * Math.sin((((x1 + 17.5) % 5) / 5 || 1) * Math.PI);
      pts.push(x, y0, z, x1, x1 % 5 === 2.5 ? 2.74 : y1, z);
    }
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const line = new THREE.LineSegments(lineGeo, ctx.track(new THREE.LineBasicMaterial({ color: '#2a241c' })));
  line.name = 'r4:lanternRope';
  ctx.add(line, { parent: market });
  // 每盏小灯笼挂一根短线（并进同一串线里太麻烦：直接画在 instanced 灯笼的顶上，省掉）
  return { mesh, base };
}

/** 顶梁上垂下来的白纸幡（镂空剪纸条，实例化一次绘制）：挂在摊桌上方、过道两边，不挡人头；logic 每帧让它们轻轻打转、摆。 */
function buildStreamers(ctx: AreaContext, market: THREE.Group): { mesh: THREE.InstancedMesh; base: THREE.Matrix4[]; phase: number[] } {
  const tex = ctx.track(streamerTexture());
  const mat = new THREE.MeshStandardMaterial({
    map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95,
    // 纸被灯笼阵映着的一点亮（不加灯，GDD §9.3）
    emissive: new THREE.Color(PALETTE.PAPER), emissiveMap: tex, emissiveIntensity: 0.16,
  });
  mat.userData.tempC = TEMP_C.paper;
  ctx.track(mat);
  const L = 0.62;
  const geo = new THREE.PlaneGeometry(0.16, L);
  geo.translate(0, -L / 2, 0);
  const r = rng(3131);
  const base: THREE.Matrix4[] = [];
  const phase: number[] = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (let x = -12.5; x <= 17.5; x += 5) {
    for (const z of [-1.5, -1.32, 1.34, 1.52]) {
      const len = range(r, 0.8, 1.15);
      p.set(x + range(r, -0.2, 0.2), R4L.hall.h - 0.26, z);
      q.setFromEuler(e.set(0, range(r, -0.5, 0.5), 0));
      s.set(1, len, 1);
      base.push(new THREE.Matrix4().compose(p, q, s));
      phase.push(range(r, 0, Math.PI * 2));
    }
  }
  const mesh = new THREE.InstancedMesh(geo, mat, base.length);
  mesh.name = 'r4:streamers';
  base.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  mesh.frustumCulled = false;
  ctx.add(mesh, { parent: market, tempC: TEMP_C.paper, occlude: false });
  mesh.userData.noOcclude = true;
  mesh.raycast = noRay;
  return { mesh, base, phase };
}

// ———————————————————————————————————————————— 纸人摊主、影子、纸钱

function buildVendors(ctx: AreaContext, market: THREE.Group): { mesh: THREE.InstancedMesh; slots: StallSlot[]; phase: number[]; huangPhase: number } {
  const slots = STALLS.filter(s => s.id !== NPC.HUANG);
  const mesh = createPaperStalls(slots.map(s => ({ pos: s.pos, yaw: s.yaw, seed: s.seed })));
  mesh.name = 'r4:vendors';
  ctx.add(mesh, { parent: market, tempC: TEMP_C.paper });
  const r = rng(99);
  const phase = slots.map(() => range(r, 0, Math.PI * 2));
  return { mesh, slots, phase, huangPhase: range(r, 0, Math.PI * 2) };
}

function buildShadows(ctx: AreaContext, market: THREE.Group): ShadowRig[] {
  const mask = ctx.track(shadowMaskTexture());
  // 受雾：远处的影子跟着雾淡下去（不受雾时远处是一个个黑窟窿）
  const mat = new THREE.MeshBasicMaterial({ color: '#030605', alphaMap: mask, transparent: true, opacity: 0.88, depthWrite: false, side: THREE.DoubleSide });
  mat.userData.tempC = TEMP_C.yin;
  ctx.track(mat);
  const geo = new THREE.PlaneGeometry(0.9, 1.9);
  geo.translate(0, 0.95, 0);
  const floorGeo = new THREE.PlaneGeometry(0.7, 1.9);
  floorGeo.translate(0, 0.95, 0);
  const floorMat = new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: mask, transparent: true, opacity: 0.55, depthWrite: false });
  const rimMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#9FE8C8').multiplyScalar(0.09), alphaMap: mask, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  rimMat.userData.tempC = TEMP_C.yin;
  ctx.track(rimMat);
  floorMat.userData.tempC = TEMP_C.yin;
  ctx.track(floorMat);
  const out: ShadowRig[] = [];
  // 贴着摊前那一溜灯笼光走（过道正中是暗的，影子在暗处看不出来）；南排 x∈[1,6] 不去（S3 黄三爷摊前，4× 看面具、拍照时不飘过来挡着）
  const defs = [[-7.5, -0.95, 3.5, 0.05, 0.4], [10, 0.95, 2.6, 0.035, 2.1], [12.5, -0.9, 3.0, 0.06, 4.0], [-4.5, 0.95, 2.4, 0.045, 5.2], [3, -0.95, 2.2, 0.04, 1.3]] as const;
  for (const [x0, z, amp, speed, phase] of defs) {
    const m = new THREE.Mesh(geo, mat);
    m.name = 'r4:shadow';
    m.renderOrder = 12;
    m.userData.irHide = true;
    m.userData.noOcclude = true;
    m.raycast = () => {};
    m.position.set(x0, 0.12, z);
    // 永远侧身对着看它的人（像一片烟）
    const wp = new THREE.Vector3(), cp = new THREE.Vector3();
    m.onBeforeRender = (_r, _s, cam) => {
      m.getWorldPosition(wp);
      cam.getWorldPosition(cp);
      m.rotation.y = Math.atan2(cp.x - wp.x, cp.z - wp.z);
      m.updateMatrixWorld();
    };
    // 一圈极淡的青光（加法，比黑身子大一圈）：暗处也看得出“那儿有个影子在飘”，不吓人
    const rim = new THREE.Mesh(geo, rimMat);
    rim.name = 'r4:shadowRim';
    rim.scale.set(1.12, 1.06, 1);
    rim.position.z = -0.01;
    rim.renderOrder = 11;
    rim.userData.irHide = true;
    rim.userData.noOcclude = true;
    rim.raycast = () => {};
    m.add(rim);
    ctx.add(m, { parent: market, occlude: false });
    // 地影：同一张剪影平躺在地上，脚底对着影子，头朝远离灯笼的一侧
    const dir: 1 | -1 = z < 0 ? 1 : -1;
    const f = new THREE.Mesh(floorGeo, floorMat);
    f.name = 'r4:shadowFloor';
    f.rotation.set(-Math.PI / 2, 0, dir > 0 ? Math.PI : 0);
    f.renderOrder = 4;
    f.userData.irHide = true;
    f.userData.noOcclude = true;
    f.raycast = () => {};
    ctx.add(f, { parent: market, occlude: false });
    out.push({ mesh: m, floor: f, dir, x0, z, amp, speed, phase });
  }
  return out;
}

function buildJoss(ctx: AreaContext, market: THREE.Group): THREE.InstancedMesh {
  const tex = ctx.track(jossCoinTexture());
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.95, side: THREE.DoubleSide });
  mat.userData.tempC = TEMP_C.paper;
  ctx.track(mat);
  const geo = new THREE.PlaneGeometry(0.1, 0.1).rotateX(-Math.PI / 2);
  // 满地纸钱（开市时撒的，落在过道里，桌脚边多一些）
  const r = rng(1234);
  const n = 110;
  const floor = new THREE.InstancedMesh(geo, mat, n);
  floor.name = 'r4:jossFloor';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const edge = r() < 0.5;
    p.set(range(r, -16, 16.5), 0.004 + i * 0.00002, edge ? (r() < 0.5 ? -1 : 1) * range(r, 1.0, 1.3) : range(r, -1.0, 1.0));
    q.setFromEuler(e.set(range(r, -0.08, 0.08), range(r, 0, Math.PI * 2), range(r, -0.08, 0.08)));
    floor.setMatrixAt(i, m.compose(p, q, s));
  }
  floor.instanceMatrix.needsUpdate = true;
  floor.computeBoundingSphere();
  floor.computeBoundingBox();
  ctx.add(floor, { parent: market, tempC: TEMP_C.paper });
  // 撒上半空的一把（logic 驱动；平时 count = 0）
  const burst = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.1, 0.1), mat, 48);
  burst.name = 'r4:jossBurst';
  burst.count = 0;
  burst.frustumCulled = false;
  ctx.add(burst, { tempC: TEMP_C.paper });
  return burst;
}

/** 飘着的纸钱：18 张，顶上落到地面循环；只挂在 market 下（开市前不显示）。 */
function buildDrift(ctx: AreaContext, market: THREE.Group, mat: THREE.Material): { mesh: THREE.InstancedMesh; seeds: MarketRig['driftSeeds'] } {
  const r = rng(2718);
  // 落在两排摊桌的上空（|z| 1.3–1.9），过道留空：人走在过道里，纸钱不会贴着镜头飘过去糊一脸；
  // S3 黄三爷的摊子（x 1.2–4.8）上空不落：4× 看他的面具时别有纸钱从脸前飘过
  const seeds = Array.from({ length: 18 }, () => {
    const z = (r() < 0.5 ? -1 : 1) * range(r, 1.3, 1.9);
    let x = range(r, -15.5, 16.5);
    if (z > 0 && x > 1.2 && x < 4.8) x += 4;
    return { x, z, speed: range(r, 0.1, 0.18), off: range(r, 0, 10), spin: range(r, 0.6, 1.6) };
  });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.08, 0.08), mat, seeds.length);
  mesh.name = 'r4:jossDrift';
  mesh.frustumCulled = false;
  mesh.raycast = noRay;
  mesh.userData.noOcclude = true;
  ctx.add(mesh, { parent: market, tempC: TEMP_C.paper, occlude: false });
  return { mesh, seeds };
}

// ———————————————————————————————————————————— 樟木箱与旧书

function buildChest(ctx: AreaContext, market: THREE.Group): THREE.Object3D {
  const chest = PROPS.camphorChest();
  chest.name = 'r4:chest';
  chest.position.set(...R4L.chest.pos);
  chest.rotation.y = -R4L.chest.yaw * DEG2RAD;
  // 樟木上一层老漆：比 kit 的默认木色亮一点、带点反光，暗处也认得出是口箱子
  const lacquer = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  chest.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.MeshStandardMaterial;
    if (!src.map) return;
    let l = lacquer.get(src);
    if (!l) {
      l = new THREE.MeshStandardMaterial({ map: src.map, color: '#d8b8a0', roughness: 0.42, metalness: 0.05 });
      lacquer.set(src, ctx.track(l));
    }
    m.material = l;
  });
  // 箱子矮（0.5m），又在摊桌挡着的墙根，第三人称俯到 -35° 也瞄不到：箱盖上方垫一块不渲染的拾取代理（箱子自己的子节点，
  // 所以交互 hit、拍照主体 ref 仍是这口箱子）。代理不渲染，不算进拍照的可见包围盒（中心仍在 0.25m），
  // 所以 pt.huang_hides 在 photo.ts 里另给了箱盖中心的锚点
  const proxy = new THREE.Mesh(boxG(0.9, 0.5, 0.5), MATERIALS.hitProxy());
  proxy.position.set(0, 0.75, 0);
  proxy.name = 'hit:r4.camphor_chest';
  chest.add(proxy);
  ctx.add(chest, { parent: market, ref: OBJ.R4_CAMPHOR_CHEST });
  // 箱子正面的铜锁；箱盖上一盏马灯（火是阴火：青白、6℃），照着这口箱子
  const lock = new THREE.Mesh(boxG(0.06, 0.07, 0.02), MATERIALS.metal());
  lock.position.set(R4L.chest.pos[0], 0.42, R4L.chest.pos[2] - 0.26);
  ctx.add(lock, { parent: market });
  const lamp = new THREE.Group();
  lamp.name = 'r4:chestLamp';
  const iron = MATERIALS.metal();
  lamp.add(new THREE.Mesh(cylG(0.07, 0.08, 0.05, 10), iron));
  const glass = new THREE.Mesh(cylG(0.055, 0.06, 0.13, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color('#BFF5DA').multiplyScalar(2.2) }));
  glass.position.y = 0.1;
  lamp.add(glass);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.06, 10), iron);
  cap.position.y = 0.2;
  lamp.add(cap);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 4, 12, Math.PI), iron);
  handle.position.y = 0.23;
  lamp.add(handle);
  lamp.position.set(R4L.chest.pos[0] + 0.28, 0.5, R4L.chest.pos[2] + 0.1);
  ctx.track(glass.material);
  ctx.add(lamp, { parent: market, tempC: TEMP_C.ghostLantern });
  return chest;
}

function buildOldBook(ctx: AreaContext, market: THREE.Group): THREE.Object3D {
  const s3 = STALLS.find(s => s.id === NPC.HUANG);
  const [tx, tz] = s3 ? tableCenter(s3) : [3, 1.58];
  const g = new THREE.Group();
  g.name = 'r4:oldBook';
  const pageTex = ctx.track(oldBookPageTexture());
  const pages = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.25).rotateX(-Math.PI / 2), ctx.track(new THREE.MeshStandardMaterial({ map: pageTex, roughness: 0.95 })));
  pages.position.y = 0.022;
  // 摊开的书朝过道（南排：过道在 -z，字的上方朝 +z）
  pages.rotation.y = Math.PI;
  g.add(pages);
  const cover = new THREE.Mesh(boxG(0.36, 0.02, 0.26), MATERIALS.cloth('#2c3a52'));
  cover.position.y = 0.01;
  g.add(cover);
  // 摊在桌子东半边、靠过道的前沿（西半边摆着磁带、收音机、闹钟）：
  // 从过道对它按 E 时，穿过它的准星射线先落在桌面上，不会越过桌子碰到后面的黄三爷（他的聚焦优先级更高）
  g.position.set(tx + 0.27, R4L.table.h + 0.01, tz - 0.15);
  g.rotation.y = 0.12;
  ctx.add(g, { parent: market, tempC: TEMP_C.paper });
  return g;
}

// ———————————————————————————————————————————— 假光与薄雾（只用 emissive/加法贴花，不加灯：GDD §9.3）

const noRay: THREE.Mesh['raycast'] = () => {};

function decalMesh(ctx: AreaContext, geo: THREE.BufferGeometry, mat: THREE.Material, name: string, parent: THREE.Object3D, order: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.renderOrder = order;
  m.userData.irHide = true;
  m.userData.noOcclude = true;
  m.raycast = noRay;
  ctx.add(m, { parent, occlude: false });
  return m;
}

function buildGlows(ctx: AreaContext, market: THREE.Group): { glowMat: THREE.MeshBasicMaterial; wallGlowMat: THREE.MeshBasicMaterial; mist: THREE.Texture[] } {
  const mask = ctx.track(radialGlowMask());
  const glowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.LANTERN).multiplyScalar(0.32), alphaMap: mask, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
  });
  ctx.track(glowMat);
  const pools: THREE.BufferGeometry[] = [];
  const wallPools: THREE.BufferGeometry[] = [];
  for (const slot of STALLS) {
    const p = lanternAt(slot);
    // 地上一团（桌前过道里）+ 摊后布幔上一大片更淡、偏暖的（布是深色的，同样亮的一团会成一块发灰的圆斑）
    const floor = new THREE.PlaneGeometry(2.2, 2.2).rotateX(-Math.PI / 2);
    pools.push(bake(floor, [p[0], 0.012, p[2] + (slot.row === 'n' ? 0.55 : -0.55)]));
    const wallZ = slot.row === 'n' ? R4L.hall.z0 + 0.13 : R4L.hall.z1 - 0.13;
    wallPools.push(bake(new THREE.PlaneGeometry(2.8, 2.8), [p[0], p[1] - 0.1, wallZ], slot.row === 'n' ? 0 : 180));
  }
  decalMesh(ctx, mergeAll(pools), glowMat, 'r4:glowPools', market, 3);
  const wallGlowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#F2D7A6').multiplyScalar(0.13), alphaMap: mask, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  ctx.track(wallGlowMat);
  decalMesh(ctx, mergeAll(wallPools), wallGlowMat, 'r4:wallGlow', market, 3);
  // 头顶灯笼串在过道中间投下的一长条淡光
  const band = new THREE.PlaneGeometry(34, 2.4).rotateX(-Math.PI / 2);
  const bandMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.LANTERN).multiplyScalar(0.07), alphaMap: mask, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  ctx.track(bandMat);
  const b = decalMesh(ctx, band, bandMat, 'r4:aisleGlow', market, 3);
  b.position.set(1, 0.01, 0);
  // 贴地的一层薄雾（偏绿、一团一团，慢慢漂）。只贴着地面：水平的加法层抬得太高，
  // 从 1.8m 往下看时会把地面、桌脚整片刷成一汪青水（look-dev 第一轮截图的教训）
  const mist: THREE.Texture[] = [];
  for (const [y, k, rep] of [[0.05, 0.05, 5]] as const) {
    const tex = ctx.track(mistMask());
    tex.repeat.set(rep, 1);
    mist.push(tex);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#7FBFA0').multiplyScalar(k * 4), alphaMap: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    ctx.track(mat);
    const plane = new THREE.PlaneGeometry(38, 6).rotateX(-Math.PI / 2);
    const m = decalMesh(ctx, plane, mat, 'r4:mist', market, 4);
    m.position.set(0, y, 0);
  }
  return { glowMat, wallGlowMat, mist };
}

/** 摊与摊之间靠墙立着的纸花圈（六只，一次绘制）：红黄粉紫的纸花在一片青灰里是“丽”的那一点；竹三脚架撑着，往墙上靠一点。 */
function buildWreaths(ctx: AreaContext, market: THREE.Group): void {
  const tex = ctx.track(wreathTexture());
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({
    map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9,
    // 纸花被灯笼阵映着的一点亮（不加灯，GDD §9.3）
    emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.2,
  });
  mat.userData.tempC = TEMP_C.paper;
  ctx.track(mat);
  const faces: THREE.BufferGeometry[] = [];
  const legs: THREE.BufferGeometry[] = [];
  const spots: readonly [number, 'n' | 's'][] = [[-2.6, 'n'], [2.6, 'n'], [8.4, 'n'], [0.1, 's'], [6.1, 's'], [12.2, 's']];
  const R = 0.46, cy = 1.08;
  for (const [x, row] of spots) {
    const wallZ = row === 'n' ? R4L.hall.z0 : R4L.hall.z1;
    const out = row === 'n' ? 1 : -1;            // 朝过道
    const z = wallZ + out * 0.2;
    const lean = -out * 8;                        // 上沿往墙上靠
    faces.push(bake(new THREE.CircleGeometry(R, 28), [x, cy, z], row === 'n' ? 0 : 180, 1, [lean, 0, 0]));
    // 竹三脚架：前两根斜撑到地，后一根顶墙
    for (const dx of [-0.26, 0.26]) {
      const a = new THREE.Vector3(x + dx, cy - 0.25, z + out * 0.02), b = new THREE.Vector3(x + dx * 1.5, 0, z + out * 0.16);
      legs.push(stick(a, b));
    }
    legs.push(stick(new THREE.Vector3(x, cy + 0.1, z - out * 0.04), new THREE.Vector3(x, 0, wallZ + out * 0.03)));
  }
  addMerged(ctx, faces, mat, 'r4:wreaths', market, false).userData.tempC = TEMP_C.paper;
  addMerged(ctx, legs, new THREE.MeshStandardMaterial({ color: '#7f6a3e', roughness: 0.75 }), 'r4:wreathLegs', market);
}

/** 两点之间的一根细竹竿。 */
function stick(a: THREE.Vector3, b: THREE.Vector3): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = cylG(0.011, 0.011, len, 5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** 鬼市口：西头第二道梁（x=-12.5）下横挂一幅白布幡“鬼　市”，两面同字——从楼梯口进来迎面看见，往回走也看得见。
 *  下沿穗尖离地 2.0m，在主角铁皮帽之上；不挡人、不挡拍照射线。 */
function buildBanner(ctx: AreaContext, market: THREE.Group): THREE.Object3D {
  const tex = ctx.track(marketBannerTexture());
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({
    map: tex, alphaTest: 0.5, roughness: 0.95,
    // 布被两串灯笼映着（不加灯，GDD §9.3）
    emissive: new THREE.Color(PALETTE.LANTERN), emissiveMap: tex, emissiveIntensity: 0.3,
  });
  mat.userData.tempC = TEMP_C.paper;
  ctx.track(mat);
  const W = 1.7, H = W * (384 / 1024);
  const pivot = new THREE.Group();
  pivot.name = 'r4:banner';
  const top = R4L.hall.h - 0.27;
  pivot.position.set(-12.5, top, 0);
  for (const s of [1, -1]) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    face.rotation.y = (s * Math.PI) / 2;
    face.position.set(s * 0.004, -H / 2, 0);
    face.userData.noOcclude = true;
    face.raycast = noRay;
    pivot.add(face);
  }
  // 横杆 + 两根挂绳（拴在梁上）
  const rod = new THREE.Mesh(cylG(0.012, 0.012, W + 0.12, 6).rotateX(Math.PI / 2), MATERIALS.wood());
  rod.raycast = noRay;
  pivot.add(rod);
  const ropeMat = ctx.track(new THREE.MeshStandardMaterial({ color: '#2a241c', roughness: 0.9 }));
  for (const z of [-W / 2 + 0.05, W / 2 - 0.05]) {
    const rope = new THREE.Mesh(cylG(0.004, 0.004, 0.05, 4), ropeMat);
    rope.position.set(0, 0.025, z);
    rope.raycast = noRay;
    pivot.add(rope);
  }
  ctx.add(pivot, { parent: market, tempC: TEMP_C.paper, occlude: false });
  return pivot;
}

export function buildMarket(ctx: AreaContext): MarketRig {
  const group = new THREE.Group();
  group.name = 'r4:market';
  ctx.add(group);
  const { hits, flames } = buildStalls(ctx, group);
  const lanterns = buildLanterns(ctx, group);
  const array = buildLanternArray(ctx, group);
  const v = buildVendors(ctx, group);
  const shadows = buildShadows(ctx, group);
  const burst = buildJoss(ctx, group);
  const drift = buildDrift(ctx, group, burst.material as THREE.Material);
  const chest = buildChest(ctx, group);
  const oldBook = buildOldBook(ctx, group);
  const { glowMat, wallGlowMat, mist } = buildGlows(ctx, group);
  const streamers = buildStreamers(ctx, group);
  const banner = buildBanner(ctx, group);
  buildWreaths(ctx, group);
  return {
    group, vendors: v.mesh, vendorSlots: v.slots, vendorPhase: v.phase, huangPhase: v.huangPhase,
    lanterns, array: array.mesh, arrayBase: array.base, shadows, burst, drift: drift.mesh, driftSeeds: drift.seeds, chest, oldBook, hits, flames, glowMats: [glowMat, wallGlowMat], mist,
    streamers: streamers.mesh, streamerBase: streamers.base, streamerPhase: streamers.phase, banner,
  };
}
