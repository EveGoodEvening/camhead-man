// owner: R1-finale
// 结局与尾声的布景（ARCH §11.6：尾声道具用过场 run(g, ctx) 按需加，随区域卸载释放）：
// - 尾声（8 月 28 日上午，CH1 机位）：扬尘晨雾里的挖掘机剪影、靠在门岗墙上的梯子、爬上来的拆迁工人（剪影）、擦镜头的袖子、晨雾天穹；
// - 片尾照片：远处一间全黑的“放映室”，一张张冲洗出来的照片卡（GDD §8.9 的五张）；有玩家自己拍的缩略图就贴上去；
// - 南柯（片尾后，拆迁工人阳台的视角）：推平的院子、槐树墩子、蚁穴里亮着的小小槐安里（门灯、门岗、摆手的老周、1984 年合影的人）。
// 远景布景放在院子正下方很远处（雾与点光都够不着），材质一律不吃灯：MeshBasicMaterial 或 MeshMatcapMaterial。

import * as THREE from 'three';
import type { AreaContext } from '../../../core/area';
import type { CameraPose, V3 } from '../../../core/types';
import type { GameApi } from '../../../game/effects';
import type { CharacterRig } from '../../../rigs/characters';
import { createCharacter } from '../../../rigs/characters';
import { createCrowd } from '../../../rigs/crowd';
import { PHOTO_META } from '../../../data/photos';
import { PALETTE } from '../../../data/palette';
import { PAINT } from '../../../kit/canvas';
import { merge } from '../../../kit/geom';
import { rng, range } from '../../../kit/rng';
import type { CreditPhoto } from './art';
import {
  CARD_SIZE, barkTexture, creditCardCanvas, glowTexture, hazeFacadeTexture, hoardingTexture, paintHole, matcapTexture, morningSkyTexture, rimMatcapTexture, rubbleGroundTexture,
  sleeveTexture, stumpTopTexture,
} from './art';

// ==================================================================== 小工具

function basic(ctx: AreaContext, color: THREE.ColorRepresentation, o?: { fog?: boolean; hdr?: number; side?: THREE.Side }): THREE.MeshBasicMaterial {
  const m = ctx.track(new THREE.MeshBasicMaterial({ color, fog: o?.fog ?? true, side: o?.side ?? THREE.FrontSide }));
  if (o?.hdr) m.color.multiplyScalar(o.hdr);
  return m;
}

/** 远景布景（南柯）不吃雾。 */
function basicNF(ctx: AreaContext, color: THREE.ColorRepresentation, o?: { hdr?: number; side?: THREE.Side; fog?: boolean }): THREE.MeshBasicMaterial {
  return basic(ctx, color, { ...o, fog: false });
}

/** 每个区域上下文一张 matcap（随区域卸载释放）。 */
const matcaps = new WeakMap<AreaContext, THREE.Texture>();
function matcap(ctx: AreaContext, color: THREE.ColorRepresentation, map?: THREE.Texture): THREE.MeshMatcapMaterial {
  let mc = matcaps.get(ctx);
  if (!mc) {
    mc = ctx.track(matcapTexture('#f3dcc0', '#6c7280'));
    matcaps.set(ctx, mc);
  }
  return ctx.track(new THREE.MeshMatcapMaterial({ color, matcap: mc, map: map ?? null, fog: false }));
}

/** 局部盒子（带绕 z 的倾角），给 merge 用。 */
function part(w: number, h: number, d: number, at: V3, rz = 0, ry = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  m.position.set(...at);
  m.rotation.set(0, ry, rz);
  return m;
}

/** 跟着相机走的晨雾天穹（先于场景绘制，不写深度；R1-world 的夜空天穹之后画，把它盖住）。 */
function morningSky(ctx: AreaContext): THREE.Mesh {
  const mat = ctx.track(new THREE.MeshBasicMaterial({
    map: ctx.track(morningSkyTexture('#9fb3c8', '#e8d6c4', '#cbbfb2')), side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  }));
  const m = new THREE.Mesh(new THREE.SphereGeometry(90, 24, 12), mat);
  m.name = 'fin.morningSky';
  m.renderOrder = -999;
  m.frustumCulled = false;
  m.userData.irHide = true;
  m.userData.noOcclude = true;
  m.userData.noBounds = true;
  m.raycast = () => {};
  const cp = new THREE.Vector3();
  m.onBeforeRender = (_r, _s, cam) => {
    cam.getWorldPosition(cp);
    m.position.copy(cp);
    m.updateMatrixWorld();
  };
  return m;
}

/** 挖掘机（合并成一个网格；用剪影/matcap 材质）。原点在两条履带中间的地面，朝 +x 开。 */
function excavatorGeometry(): THREE.BufferGeometry {
  const parts = [
    part(4.2, 0.9, 0.7, [0, 0.45, -1.15]), part(4.2, 0.9, 0.7, [0, 0.45, 1.15]),
    part(2.6, 0.35, 1.8, [0, 1.0, 0]),
    part(3.0, 1.1, 2.5, [-0.2, 1.7, 0]),
    part(1.1, 1.5, 1.05, [0.7, 2.95, -0.7]),
    part(0.8, 1.0, 2.4, [-1.75, 1.75, 0]),
    part(5.2, 0.5, 0.45, [2.7, 3.7, 0.35], 0.72),
    part(3.4, 0.4, 0.34, [5.6, 3.2, 0.35], -1.05),
    part(0.9, 0.9, 1.1, [6.3, 1.6, 0.35], 0.4),
    part(0.12, 0.9, 0.12, [-0.9, 2.7, 0.8]),
  ];
  const m = merge(parts);
  const g = m.geometry;
  for (const p of parts) p.geometry.dispose();
  return g;
}

// ==================================================================== 尾声（CH1，8 月 28 日上午）

/** 尾声的 CH1：同一个位置，镜头抬起来一点（天亮了，看得见院墙外的天和挖掘机的剪影）。 */
export const EPILOGUE_CAM: CameraPose = { pos: [-4.85, 2.75, 20.2], target: [-1.16, 1.72, 23.41], fov: 60 };
/**
 * 梯子脚、梯子顶、工人爬到的地方。M4 第 2 轮：梯子往南挪到门洞南边的东墙上，工人只爬到第二档——
 * 远景（开车、爬梯子、擦镜头、伸手）里他在画面右下角，只露出安全帽和一侧肩膀、最后一只手套伸向镜头；
 * “抬头冲镜头”那一拍镜头自己低头看他（见 cutscenes.ts 的 WORKER_LOOK_CAM）。
 * 原来 (-4.26,0.62,20.54) 离机位水平只有 0.6m、头顶离镜头 0.3m，头、肩、举起的胳膊占画面下方中间近一半。
 */
export const WORKER_FOOT: V3 = [-4.2, 0, 21.2];
export const LADDER_TOP: V3 = [-4.93, 2.45, 20.98];
export const WORKER_ON_LADDER: V3 = [-4.29, 0.3, 21.17];
/** 工人头部（look_up 时大约的位置；镜头低头看他用） */
export const WORKER_HEAD: V3 = [WORKER_ON_LADDER[0] - 0.05, WORKER_ON_LADDER[1] + 1.66, WORKER_ON_LADDER[2] - 0.03];

/** 挖掘机开车起点（院门东边）与整段尾声往西挪的距离（沿人行道） */
export const EXCAVATOR_X0 = 9;
export const EXCAVATOR_RUN = 8;

export interface EpilogueSet {
  group: THREE.Group;
  sky: THREE.Mesh;
  excavator: THREE.Mesh;
  ladder: THREE.Group;
  worker: CharacterRig;
  sleeve: THREE.Mesh;
}

export function buildEpilogue(ctx: AreaContext): EpilogueSet {
  const group = new THREE.Group();
  group.name = 'fin.epilogue';
  const sky = morningSky(ctx);
  group.add(sky);
  // 挖掘机：院墙外马路上从东往西开过去（晨雾天光里的深色剪影；M4 第 2 轮：不吃雾——吃雾时大部分帧只是门后一个灰方块，动臂看不到）
  const excavator = new THREE.Mesh(excavatorGeometry(), basic(ctx, '#38332d', { fog: false }));
  excavator.name = 'fin.excavator';
  // 在院外马路的近侧车道上（路面低 0.14m）：离院门 10m，动臂从院门上方露出来，是晨雾天光里的一个剪影，不是贴在门后的一堆黑方块
  excavator.position.set(EXCAVATOR_X0, -0.14, 33.5);
  excavator.rotation.y = Math.PI;
  group.add(excavator);
  // 靠在门岗东墙上的梯子（支架正下方）
  const ladder = new THREE.Group();
  ladder.name = 'fin.ladder';
  const railMat = basic(ctx, '#3a3632');
  const foot = new THREE.Vector3(...WORKER_FOOT);
  const top = new THREE.Vector3(...LADDER_TOP);
  const along = top.clone().sub(foot);
  const len = along.length();
  for (const s of [-0.22, 0.22]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, len, 0.04), railMat);
    rail.position.copy(foot).addScaledVector(along, 0.5).add(new THREE.Vector3(0, 0, s));
    rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.clone().normalize());
    ladder.add(rail);
  }
  for (let i = 1; i < 9; i++) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.44), railMat);
    rung.position.copy(foot).addScaledVector(along, i / 9);
    ladder.add(rung);
  }
  group.add(ladder);
  // 拆迁工人：身子是逆光的深色剪影（matcap 中间近黑、轮廓一圈晨雾的亮边，吃雾），安全帽留一点暗橙（画面里唯一的色块）；
  // 脸保留人偶自己的五官材质（M4 第 2 轮：“抬头冲镜头”那一拍镜头低头看他，看得见一张抬起来的脸——呼应 03:14 老周抬头）
  const worker = createCharacter('worker', { look: 'live', seed: 28 });
  const workerMat = ctx.track(new THREE.MeshMatcapMaterial({ color: '#ffffff', matcap: ctx.track(rimMatcapTexture()), fog: true }));
  const hatMat = ctx.track(new THREE.MeshMatcapMaterial({ color: new THREE.Color('#D86A1E').multiplyScalar(0.55), matcap: ctx.track(matcapTexture('#f3dcc0', '#6c7280')), fog: true }));
  const hat = worker.props.hardHat;
  worker.root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.name === 'head') return;
    let inHat = false;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) if (p === hat) inHat = true;
    m.material = inHat ? hatMat : workerMat;
  });
  worker.root.position.copy(foot);
  worker.root.visible = false;
  group.add(worker.root);
  // 擦镜头的袖子（工装袖子，带反光条）
  const sleeveMat = ctx.track(new THREE.MeshBasicMaterial({ map: ctx.track(sleeveTexture('#8a4a20', true, 28)), side: THREE.DoubleSide, fog: false }));
  const sleeve = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.24), sleeveMat);
  sleeve.name = 'fin.sleeve';
  sleeve.frustumCulled = false;
  sleeve.visible = false;
  group.add(sleeve);
  ctx.add(group, { occlude: false });
  return { group, sky, excavator, ladder, worker, sleeve };
}

// ==================================================================== 片尾照片

/** 片尾照片的顺序（GDD §8.9）。 */
export const CREDIT_PHOTOS: readonly CreditPhoto[] = ['ph.film3', 'ph.menshen_2018', 'ph.huang_ir', 'ph.tape_face', 'ph.final'];
const CREDITS_AT: V3 = [0, -600, 0];
export const CREDITS_CAM: CameraPose = { pos: CREDITS_AT, target: [CREDITS_AT[0], CREDITS_AT[1], CREDITS_AT[2] - 3], fov: 40 };

export interface CreditsStage {
  group: THREE.Group;
  card: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  textures: THREE.CanvasTexture[];
  /** 显示第 i 张（null = 黑场） */
  show(i: number | null, a01: number, t01: number): void;
  /**
   * 把玩家自己拍的缩略图贴上去（建好以后才拍到的也补上：合影 ph.final 是在 cs.r1.fin_soul 里拍的）。
   * print：合影那一刻按 CH1 位姿留下的大照片（M4 第 2 轮）——有就铺满合影卡的画面区，不再是右下角一张很暗的小贴片。
   */
  refreshThumbs(g: GameApi, print?: HTMLCanvasElement | null): void;
}

/** 片尾照片用玩家自己拍的缩略图（GameApi.photo.record，只读；M3 补的接口，docs/requests/r1-finale.md #1）；没有就只用画好的卡片。 */
function ownThumb(g: GameApi, id: CreditPhoto): string | undefined {
  return g.photo.record(id)?.thumb;
}

/**
 * 这两张手绘卡保留画面、玩家的缩略图只做右下角的一张小贴片（M4）：
 * ph.tape_face 的缩略图是斜着拍 CRT 的画面，老周只有几十像素高；ph.final 的缩略图只有 192×144、是 04:57 的夜景——
 * 盖满画面区反而看不清脸。ph.final 有合影那一刻留下的大照片（refreshThumbs 的 print）时改为铺满（M4 第 2 轮）。
 */
const INSET_ONLY: ReadonlySet<CreditPhoto> = new Set<CreditPhoto>(['ph.tape_face', 'ph.final']);

/** 把一张缩略图贴进卡片：整幅（先清掉画面区、提亮夜景；lift = false 时原样贴）或右下角的小贴片（白边、微微歪着）。 */
function pasteThumb(cg: CanvasRenderingContext2D, img: CanvasImageSource, inset: boolean, lift = true): void {
  const P = CARD_SIZE.pic;
  cg.save();
  if (inset) {
    const w = Math.round(P.w * 0.34), h = Math.round(w * (P.h / P.w));
    const x = P.x + P.w - w - 22, y = P.y + P.h - h - 20;
    cg.translate(x + w / 2, y + h / 2);
    cg.rotate(0.05);
    cg.fillStyle = 'rgba(0,0,0,0.35)';
    cg.fillRect(-w / 2 - 6, -h / 2 - 3, w + 16, h + 16);
    cg.fillStyle = '#f1ece0';
    cg.fillRect(-w / 2 - 9, -h / 2 - 9, w + 18, h + 18);
    cg.filter = 'brightness(1.5) contrast(1.1)';
    cg.drawImage(img, -w / 2, -h / 2, w, h);
  } else {
    // 手绘底图有一部分画到了画面区外（磷绿的 CRT 光），先把画面区连同一圈边一起清成黑，再贴
    cg.fillStyle = '#111';
    cg.fillRect(P.x - 4, P.y - 4, P.w + 8, P.h + 8);
    cg.filter = lift ? 'brightness(1.5) contrast(1.1)' : 'none';
    cg.drawImage(img, P.x, P.y, P.w, P.h);
    cg.filter = 'none';
    cg.strokeStyle = 'rgba(0,0,0,0.25)';
    cg.lineWidth = 2;
    cg.strokeRect(P.x, P.y, P.w, P.h);
  }
  cg.restore();
}

export function buildCredits(ctx: AreaContext, g: GameApi): CreditsStage {
  const group = new THREE.Group();
  group.name = 'fin.credits';
  const back = new THREE.Mesh(new THREE.BoxGeometry(30, 20, 30), basic(ctx, '#000000', { fog: false, side: THREE.BackSide }));
  back.position.set(...CREDITS_AT);
  group.add(back);
  const textures: THREE.CanvasTexture[] = [];
  const canvases: HTMLCanvasElement[] = [];
  const pasted = new Map<CreditPhoto, string>();
  CREDIT_PHOTOS.forEach((id, i) => {
    const cv = creditCardCanvas(id, PHOTO_META[id].title, 50 + i);
    canvases.push(cv);
    const tex = ctx.track(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    textures.push(tex);
  });
  let printed = false;
  const refreshThumbs = (api: GameApi, print?: HTMLCanvasElement | null): void => {
    if (typeof Image === 'undefined') return;
    const fi = CREDIT_PHOTOS.indexOf('ph.final');
    if (print && !printed && fi >= 0) {
      const cg = canvases[fi]!.getContext('2d');
      if (cg) {
        printed = true;
        pasteThumb(cg, print, false, false);
        textures[fi]!.needsUpdate = true;
      }
    }
    CREDIT_PHOTOS.forEach((id, i) => {
      if (id === 'ph.final' && printed) return;
      const thumb = ownThumb(api, id);
      if (!thumb || pasted.get(id) === thumb) return;
      pasted.set(id, thumb);
      // 纯装饰：缩略图解码好了就贴进卡片（异步，不影响玩法）
      const img = new Image();
      img.onload = () => {
        const cg = canvases[i]!.getContext('2d');
        if (!cg) return;
        pasteThumb(cg, img, INSET_ONLY.has(id));
        textures[i]!.needsUpdate = true;
      };
      img.src = thumb;
    });
  };
  refreshThumbs(g);
  // 卡片压到中间调（白边不溢出 Bloom，标题的字看得清）
  const mat = ctx.track(new THREE.MeshBasicMaterial({ map: textures[0] ?? null, color: new THREE.Color(0.6, 0.6, 0.6), transparent: true, opacity: 0, fog: false }));
  const w = 1.6, h = w * (CARD_SIZE.h / CARD_SIZE.w);
  const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  card.position.set(CREDITS_AT[0], CREDITS_AT[1], CREDITS_AT[2] - 3);
  group.add(card);
  ctx.add(group, { occlude: false });
  return {
    group, card, mat, textures, refreshThumbs,
    show(i, a01, t01) {
      if (i === null) {
        mat.opacity = 0;
        return;
      }
      const t = textures[i];
      if (t && mat.map !== t) {
        mat.map = t;
        mat.needsUpdate = true;
      }
      mat.opacity = a01;
      // 慢慢推近、微微歪一点（像摊在桌上的照片）
      card.scale.setScalar(0.94 + 0.08 * t01);
      card.rotation.z = (i % 2 ? 1 : -1) * 0.03 * (1 - t01);
    },
  };
}

// ==================================================================== 南柯（拆迁工人阳台的视角，院子已经平了）
//
// 1×：清晨六点四十，二楼阳台往西北俯看——推平的院子、碎砖堆、一截刷着红圈“拆”的残墙、停着的挖掘机、围挡，
//     正中是槐树墩子；地平线上是晨雾里远处的楼。树墩脚下有一点暖光（引着人去拉近）。
// 6×：树墩下的蚁穴里亮着一座小小的槐安里（约 1:10）：一盏门灯、一个门岗（窗与门里亮着）、门口冲镜头摆手的小老周、
//     槐树（挂着彩灯）底下 1984 年大合影的那些人、晾衣绳；蚂蚁排着队往洞里搬影子。

const N0: V3 = [0, -300, 0];
const NV = (x: number, y: number, z: number): V3 => [N0[0] + x, N0[1] + y, N0[2] + z];
/** 从树墩看阳台的水平方向（南偏西） */
const TO_BALCONY = new THREE.Vector3(-11, 0, 25).normalize();
/** 蚁穴里的小槐安里：在树墩前（朝阳台那一侧）2.2m，树墩正好是它的背景 */
const MINI: V3 = NV(TO_BALCONY.x * 2.2, 0, TO_BALCONY.z * 2.2);
/** 阳台上的镜头（二楼，离小槐安里约 16m，俯 16°：1× 时画面上缘露出一线地平线） */
export const NANKE_CAM: CameraPose = { pos: NV(TO_BALCONY.x * 18.5, 5.0, TO_BALCONY.z * 18.5), target: [MINI[0], MINI[1] + 0.28, MINI[2]], fov: 42 };

export interface NankeSet {
  group: THREE.Group;
  miniZhou: CharacterRig;
  crowd: THREE.InstancedMesh;
  lamp: THREE.Mesh;
  /** 彩灯（逐帧轻轻呼吸） */
  festoon: THREE.InstancedMesh;
  /** 往洞里搬影子的蚂蚁（逐帧往前爬） */
  ants: { mesh: THREE.InstancedMesh; update(dt: number): void };
}

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/** 一团叶冠（低模多面体，flat） */
function clump(ctx: AreaContext, r: number, color: THREE.ColorRepresentation, seed: number): THREE.Mesh {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  const rr = rng(seed);
  for (let i = 0; i < p.count; i++) {
    const k = 1 + range(rr, -0.12, 0.12);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  const mat = matcap(ctx, color);
  mat.flatShading = true;
  return new THREE.Mesh(g, mat);
}

/** 加法混合的光晕片（朝着正在渲染的相机）。 */
function glowSprite(ctx: AreaContext, color: THREE.ColorRepresentation, size: number, hdr: number, opacity = 1): THREE.Mesh {
  const mat = ctx.track(new THREE.MeshBasicMaterial({
    map: ctx.track(glowTexture()), color: new THREE.Color(color).multiplyScalar(hdr), transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  }));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  m.renderOrder = 8;
  m.userData.irHide = true;
  m.raycast = () => {};
  m.onBeforeRender = (_r, _s, cam) => {
    const parent = m.parent;
    if (parent) {
      parent.getWorldQuaternion(_q).invert();
      m.quaternion.copy(_q).multiply(cam.quaternion);
    } else m.quaternion.copy(cam.quaternion);
    m.updateMatrixWorld();
  };
  return m;
}

/** 贴地的一片加法光斑（灯下的光池） */
function lightPool(ctx: AreaContext, color: THREE.ColorRepresentation, size: number, hdr: number): THREE.Mesh {
  const mat = ctx.track(new THREE.MeshBasicMaterial({
    map: ctx.track(glowTexture()), color: new THREE.Color(color).multiplyScalar(hdr), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  }));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), mat);
  m.renderOrder = 7;
  m.raycast = () => {};
  return m;
}

/** 蚁穴的洞：中间深、边上渐浅的一片土（透明贴图压在地面上） */
function holeDisk(ctx: AreaContext, radius: number): THREE.Mesh {
  const tex = ctx.track(paintHole());
  const mat = ctx.track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 40).rotateX(-Math.PI / 2), mat);
  m.renderOrder = 3;
  return m;
}

export function buildNanke(ctx: AreaContext): NankeSet {
  const group = new THREE.Group();
  group.name = 'fin.nanke';
  group.add(morningSky(ctx));
  const r = rng(629);
  // —— 推平的院子 ——
  const groundTex = ctx.track(rubbleGroundTexture());
  groundTex.repeat.set(10, 10);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), matcap(ctx, '#f2e4cf', groundTex));
  ground.position.set(...N0);
  group.add(ground);
  // 碎砖堆（实例化）
  const rubbleGeo = new THREE.BoxGeometry(0.4, 0.22, 0.25);
  const rubble = new THREE.InstancedMesh(rubbleGeo, matcap(ctx, '#ffffff'), 300);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  const piles: [number, number, number][] = [[-12, -6, 3.4], [9, -11, 3], [13, 7, 3.2], [-15, 9, 2.6], [4, -18, 3.2], [-8, 14, 2.0]];
  for (let i = 0; i < 300; i++) {
    const [cx, cz, rad] = piles[i % piles.length]!;
    const a = range(r, 0, Math.PI * 2), d = range(r, 0, rad) * range(r, 0.3, 1);
    const pos = new THREE.Vector3(N0[0] + cx + Math.cos(a) * d, N0[1] + range(r, 0.05, 1.2) * (1 - d / (rad + 0.2)), N0[2] + cz + Math.sin(a) * d);
    q.setFromEuler(new THREE.Euler(range(r, 0, 3), range(r, 0, 3), range(r, 0, 3)));
    const s = range(r, 0.7, 1.6);
    m4.compose(pos, q, new THREE.Vector3(s, s, s));
    rubble.setMatrixAt(i, m4);
    rubble.setColorAt(i, col.set(r() < 0.6 ? PALETTE.BRICK : r() < 0.5 ? '#a8a298' : '#c9c3b5'));
  }
  rubble.computeBoundingSphere();
  group.add(rubble);
  // 一截没推倒的残墙：刷着红圈“拆”（这院子最后的一面墙）
  const wallTex = ctx.track(PAINT.bricks({ rows: 18, cols: 8, seed: 84 }));
  const wallChunk = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.4, 0.3), matcap(ctx, '#e2d2c2', wallTex));
  wallChunk.position.set(N0[0] + 7.5, N0[1] + 1.2, N0[2] - 5.5);
  wallChunk.rotation.y = -0.35;
  group.add(wallChunk);
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), ctx.track(new THREE.MeshBasicMaterial({ map: ctx.track(PAINT.demolitionMark()), transparent: true, depthWrite: false, fog: false })));
  mark.position.set(0, 0.05, 0.152);
  wallChunk.add(mark);
  // —— 槐树墩子（二百年的树，只剩这一截）——
  const bark = ctx.track(barkTexture());
  bark.repeat.set(4, 1);
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.25, 0.6, 28, 1, true), matcap(ctx, '#ffffff', bark));
  stump.position.set(N0[0], N0[1] + 0.3, N0[2]);
  group.add(stump);
  const cut = new THREE.Mesh(new THREE.CircleGeometry(1.05, 28).rotateX(-Math.PI / 2), matcap(ctx, '#ffffff', ctx.track(stumpTopTexture())));
  cut.position.set(N0[0], N0[1] + 0.6, N0[2]);
  group.add(cut);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 1.1;
    const root = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 1.5, 8), matcap(ctx, '#6a5646'));
    root.position.set(N0[0] + Math.cos(a) * 1.45, N0[1] + 0.05, N0[2] + Math.sin(a) * 1.45);
    root.rotation.order = 'YXZ';
    root.rotation.set(Math.PI / 2 - 0.08, -a + Math.PI / 2, 0);
    group.add(root);
  }
  // —— 围挡、停着的挖掘机、远处的楼 ——
  const hoard = ctx.track(hoardingTexture('槐安里片区房屋征收项目'));
  for (const [x, z, ry] of [[0, -26, 0], [-28, 0, Math.PI / 2], [28, 2, -Math.PI / 2]] as const) {
    const h = new THREE.Mesh(new THREE.PlaneGeometry(26, 2.4), basicNF(ctx, '#d8d4cc'));
    (h.material as THREE.MeshBasicMaterial).map = hoard;
    h.position.set(N0[0] + x, N0[1] + 1.2, N0[2] + z);
    h.rotation.y = ry;
    group.add(h);
  }
  const exc = new THREE.Mesh(excavatorGeometry(), matcap(ctx, '#d6a33a'));
  exc.position.set(N0[0] + 11, N0[1], N0[2] - 12);
  exc.rotation.y = 2.3;
  group.add(exc);
  // 地平线上的楼：晨雾里一层比一层淡（带窗格的立面贴图，颜色往天色里调；远的更高更淡）
  const skyline = new THREE.Group();
  const sr = rng(2008);
  const hazeNear = new THREE.Color('#aeb4b8'), hazeFar = new THREE.Color('#dcd4ca');
  const facadeTex = [ctx.track(hazeFacadeTexture(11)), ctx.track(hazeFacadeTexture(12))];
  for (let i = 0; i < 34; i++) {
    const a = -Math.PI * 0.98 + (i / 34) * Math.PI * 1.3 + range(sr, -0.04, 0.04);   // 阳台看过去的北、西、东三面
    const d = range(sr, 90, 160);
    const far = (d - 90) / 70;
    const w = range(sr, 12, 26), hgt = range(sr, 4, 9) + far * range(sr, 2, 9), dp = range(sr, 8, 14);
    // 贴图按楼的尺寸平铺：直接缩放这栋楼几何体的 UV（不克隆贴图，CanvasTexture 预算按张算）
    const geo = new THREE.BoxGeometry(w, hgt, dp);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (w / 12), uv.getY(k) * (hgt / 12));
    const b = new THREE.Mesh(geo, basicNF(ctx, hazeNear.clone().lerp(hazeFar, far)));
    (b.material as THREE.MeshBasicMaterial).map = facadeTex[i % 2]!;
    b.position.set(N0[0] + Math.cos(a) * d, N0[1] + hgt / 2, N0[2] + Math.sin(a) * d);
    b.rotation.y = -a + Math.PI / 2;
    skyline.add(b);
  }
  group.add(skyline);
  // —— 蚁穴里的小槐安里 ——
  const mini = new THREE.Group();
  mini.name = 'fin.nanke.mini';
  mini.position.set(...MINI);
  const S = 1 / 10;
  const toCam = new THREE.Vector3(NANKE_CAM.pos[0] - MINI[0], 0, NANKE_CAM.pos[2] - MINI[2]).normalize();
  const perp = new THREE.Vector3(-toCam.z, 0, toCam.x);   // 镜头看过去的右手方向
  /** 物体本地 −z（正面）朝向 dir 时的 rotation.y */
  const faceRot = (dir: THREE.Vector3): number => Math.atan2(-dir.x, -dir.z);
  const at = (a: number, b: number, y = 0): THREE.Vector3 => toCam.clone().multiplyScalar(a).addScaledVector(perp, b).setY(y);
  // 洞：中间深、边上渐浅的一片土；洞沿一圈翻出来的土粒
  const hole = holeDisk(ctx, 1.25);
  hole.position.y = 0.006;
  mini.add(hole);
  const crumbs = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.035, 0), matcap(ctx, '#ffffff'), 90);
  for (let i = 0; i < 90; i++) {
    const a = range(r, 0, Math.PI * 2), d = range(r, 1.02, 1.3);
    const s = range(r, 0.5, 1.6);
    m4.compose(new THREE.Vector3(Math.cos(a) * d, 0.01, Math.sin(a) * d), q.setFromEuler(new THREE.Euler(range(r, 0, 3), range(r, 0, 3), 0)), new THREE.Vector3(s, s * 0.6, s));
    crumbs.setMatrixAt(i, m4);
    crumbs.setColorAt(i, col.set(r() < 0.5 ? '#9a8266' : '#7a6650'));
  }
  crumbs.computeBoundingSphere();
  mini.add(crumbs);
  const pool = lightPool(ctx, '#FFB45E', 1.2, 0.45);
  pool.position.copy(at(0.12, 0.62, 0.012));
  mini.add(pool);
  // 门岗：门和南窗朝着镜头，里头亮着
  const boothG = new THREE.Group();
  boothG.position.copy(at(-0.12, 0.42));
  boothG.rotation.y = faceRot(toCam);
  const bw = 3.5 * S, bh = 2.6 * S, bd = 3 * S;
  const booth = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), matcap(ctx, '#77726a'));
  booth.position.y = bh / 2;
  boothG.add(booth);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.04, 0.025, bd + 0.04), matcap(ctx, '#5d5a56'));
  roof.position.y = bh + 0.012;
  boothG.add(roof);
  const doorGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.9 * S, 2.0 * S), basicNF(ctx, '#ffd9a0', { hdr: 1.7 }));
  doorGlow.position.set(bw * 0.27, 1.0 * S, -bd / 2 - 0.002);
  doorGlow.rotation.y = Math.PI;
  boothG.add(doorGlow);
  const winGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.4 * S, 0.9 * S), basicNF(ctx, '#ffe2b0', { hdr: 1.4 }));
  winGlow.position.set(-bw * 0.18, 1.45 * S, -bd / 2 - 0.002);
  winGlow.rotation.y = Math.PI;
  boothG.add(winGlow);
  // 窗里的 CRT 一点磷绿
  const crtDot = new THREE.Mesh(new THREE.PlaneGeometry(0.3 * S, 0.22 * S), basicNF(ctx, PALETTE.OSD, { hdr: 1.6 }));
  crtDot.position.set(-bw * 0.26, 1.28 * S, -bd / 2 - 0.004);
  crtDot.rotation.y = Math.PI;
  boothG.add(crtDot);
  // 门楣上的小摄像头（白壳，扣着铁皮帽子）
  const tinyCam = new THREE.Mesh(new THREE.BoxGeometry(0.34 * S, 0.22 * S, 0.2 * S), matcap(ctx, '#f0ece2'));
  tinyCam.position.set(bw * 0.5 - 0.015, 2.25 * S, -bd / 2 - 0.015);
  boothG.add(tinyCam);
  const tinyHat = new THREE.Mesh(new THREE.BoxGeometry(0.4 * S, 0.02 * S + 0.002, 0.3 * S), matcap(ctx, '#8a8a84'));
  tinyHat.position.set(bw * 0.5 - 0.015, 2.38 * S, -bd / 2 - 0.02);
  boothG.add(tinyHat);
  mini.add(boothG);
  // 一盏门灯：小灯杆，烧白的钠灯芯 + 光晕
  const lampG = new THREE.Group();
  lampG.position.copy(at(0.3, 0.82));
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, 0.3, 6), matcap(ctx, '#3c3f45'));
  post.position.y = 0.15;
  lampG.add(post);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), basicNF(ctx, PALETTE.SODIUM, { hdr: 8 }));
  lamp.position.y = 0.305;
  lampG.add(lamp);
  const halo = glowSprite(ctx, '#FFB45E', 0.32, 1.3);
  halo.position.y = 0.305;
  lampG.add(halo);
  mini.add(lampG);
  // 槐树（小）：门岗左后方；叶冠几团深槐绿，挂着彩灯
  const treeG = new THREE.Group();
  treeG.position.copy(at(-0.4, -0.38));
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.065, 0.46, 8), matcap(ctx, '#5a4838'));
  trunk.position.y = 0.23;
  treeG.add(trunk);
  const clumps: [number, number, number, number][] = [[0, 0.6, 0, 0.26], [0.2, 0.53, 0.07, 0.2], [-0.21, 0.55, -0.04, 0.21], [0.04, 0.72, -0.1, 0.19], [-0.08, 0.5, 0.18, 0.18], [0.14, 0.5, -0.19, 0.17]];
  clumps.forEach(([x, y, z, rad], i) => {
    const c = clump(ctx, rad, i % 2 ? '#4a6a3c' : '#3e5c34', 70 + i);
    c.position.set(x, y, z);
    treeG.add(c);
  });
  // 彩灯：两条悬链上的小灯泡（实例化，颜色逐个）
  const bulbs = 22;
  const festoon = new THREE.InstancedMesh(new THREE.SphereGeometry(0.009, 6, 4), ctx.track(new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false })), bulbs);
  const bulbCols = ['#ff5a4a', '#ffd84a', '#5aff8a', '#5ab4ff', '#ff8ad8'];
  for (let i = 0; i < bulbs; i++) {
    const u = (i % 11) / 10, strand = i < 11 ? 0 : 1;
    const a0 = strand ? -0.26 : -0.24, a1 = strand ? 0.28 : 0.26;
    const x = a0 + (a1 - a0) * u;
    const y = 0.45 - Math.sin(u * Math.PI) * 0.07 + strand * 0.09;
    const z = (strand ? -0.16 : 0.17) + Math.sin(u * 5) * 0.02;
    m4.makeTranslation(x, y, z);
    festoon.setMatrixAt(i, m4);
    festoon.setColorAt(i, col.set(bulbCols[i % bulbCols.length]!).multiplyScalar(2.6));
  }
  festoon.computeBoundingSphere();
  treeG.add(festoon);
  mini.add(treeG);
  // 晾衣绳（门岗后面到树）：几件小衣裳
  const lineA = at(-0.5, -0.2, 0.3), lineB = at(-0.42, 0.28, 0.32);
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, lineA.distanceTo(lineB), 4), matcap(ctx, '#2a2a2a'));
  line.position.copy(lineA).lerp(lineB, 0.5);
  line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), lineB.clone().sub(lineA).normalize());
  mini.add(line);
  ['#e8e2d4', '#c83a3a', '#5a86c0', '#e8c860'].forEach((c, i) => {
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.055), basicNF(ctx, new THREE.Color(c).multiplyScalar(0.75), { side: THREE.DoubleSide }));
    cl.position.copy(lineA).lerp(lineB, 0.15 + i * 0.22).add(new THREE.Vector3(0, -0.03, 0));
    cl.rotation.y = faceRot(toCam);
    mini.add(cl);
  });
  // 1984 年大合影的那些人：槐树底下，冲着镜头，前排是一群孩子。梦里的人是活生生的：不用魂影材质（小尺寸下半透明的魂影在亮地上看不见），
  // 借实例化人群的站位与人形，换一身八十年代的衣裳颜色（白衬衫、蓝工装、军绿、灰中山装；孩子红的黄的）
  const crowdSrc = createCrowd({ count: 24, cols: 8, spacing: 0.75, look: 'silhouette', seed: 1984, kidsFrontRow: 6 });
  ctx.track({ dispose: () => crowdSrc.dispose() });
  const crowd = new THREE.InstancedMesh(crowdSrc.mesh.geometry, matcap(ctx, '#ffffff'), crowdSrc.mesh.count);
  crowd.instanceMatrix.copy(crowdSrc.mesh.instanceMatrix);
  const adult = ['#ecebe4', '#3f5f8f', '#56663e', '#7a7e84', '#ecebe4', '#2f4870', '#8b5a3c'];
  const kid = ['#d8403a', '#e8b83a', '#e8ecf0', '#4a86c8'];
  const cr = rng(84);
  for (let i = 0; i < crowd.count; i++) crowd.setColorAt(i, col.set(i < 6 ? kid[Math.floor(cr() * kid.length)]! : adult[Math.floor(cr() * adult.length)]!));
  crowd.scale.setScalar(S);
  crowd.position.copy(at(0.08, -0.36, 0.008));
  crowd.rotation.y = faceRot(toCam);
  crowd.computeBoundingSphere();
  crowd.frustumCulled = false;
  mini.add(crowd);
  // 小小的老周：门岗门口，戴着帽子、藏蓝衬衫，冲镜头摆手（身后一圈淡淡的魂影青）
  const miniZhou = createCharacter('zhou', { look: 'live', variant: 'cap', seed: 1960 });
  miniZhou.root.scale.setScalar(S);
  miniZhou.root.position.copy(at(0.26, 0.08, 0.008));
  miniZhou.setPose('raise_arm', 0);
  miniZhou.root.rotation.y = faceRot(toCam);
  mini.add(miniZhou.root);
  const zhouGlow = glowSprite(ctx, PALETTE.GHOST, 0.3, 0.35, 0.8);
  zhouGlow.position.copy(at(0.18, 0.08, 0.1));
  mini.add(zhouGlow);
  // 蚂蚁：从洞外排着队爬进洞里（逐帧往前挪）
  const antCount = 40;
  const antMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.022, 0.008, 0.01), matcap(ctx, '#1c1814'), antCount);
  const antPath = (u: number): THREE.Vector3 => {
    const a = 1.9 - u * 1.25 + Math.sin(u * 7) * 0.05, b = 1.5 - u * 0.95;
    return at(a, b, 0.012 + Math.max(0, 0.03 - Math.abs(u - 0.45) * 0.1));
  };
  let antT = 0;
  const antTmp = new THREE.Vector3(), antNext = new THREE.Vector3();
  const antUpdate = (dt: number): void => {
    antT += dt * 0.03;
    for (let i = 0; i < antCount; i++) {
      const u = (i / antCount + antT) % 1;
      antTmp.copy(antPath(u));
      antNext.copy(antPath(Math.min(1, u + 0.01)));
      m4.lookAt(antNext, antTmp, _up);
      m4.setPosition(antTmp);
      antMesh.setMatrixAt(i, m4);
    }
    antMesh.instanceMatrix.needsUpdate = true;
  };
  antUpdate(0);
  antMesh.frustumCulled = false;
  mini.add(antMesh);
  group.add(mini);
  // —— 阳台的前景：栏杆、一盆凤仙花、晾衣夹子 ——
  const camV = new THREE.Vector3(...NANKE_CAM.pos);
  const fwd = new THREE.Vector3(...NANKE_CAM.target).sub(camV).normalize();
  const flat = fwd.clone().setY(0).normalize();
  const sideV = new THREE.Vector3().crossVectors(flat, new THREE.Vector3(0, 1, 0)).normalize();
  const railMat = basicNF(ctx, '#4a4d52');
  const railBase = camV.clone().addScaledVector(flat, 0.9).add(new THREE.Vector3(0, -0.66, 0));
  const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 3.2), railMat);
  topRail.position.copy(railBase);
  topRail.rotation.y = Math.atan2(sideV.x, sideV.z);
  group.add(topRail);
  for (let i = -8; i <= 8; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.9, 0.022), railMat);
    bar.position.copy(railBase).addScaledVector(sideV, i * 0.19).add(new THREE.Vector3(0, -0.45, 0));
    group.add(bar);
  }
  // 花盆：搁在栏杆外的花架上，只露在画面左下角
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.075, 0.16, 12), matcap(ctx, '#a4583a'));
  pot.position.copy(railBase).addScaledVector(flat, 0.35).addScaledVector(sideV, -0.95).add(new THREE.Vector3(0, -0.05, 0));
  group.add(pot);
  const leafMat = matcap(ctx, '#5f8a44');
  const flowerMat = basicNF(ctx, '#e0485a');
  const lr = rng(828);
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(range(lr, 0.045, 0.07), 8, 6), leafMat);
    leaf.position.copy(pot.position).add(new THREE.Vector3(range(lr, -0.07, 0.07), 0.11 + range(lr, 0, 0.08), range(lr, -0.07, 0.07)));
    leaf.scale.y = 0.7;
    group.add(leaf);
  }
  for (let i = 0; i < 5; i++) {
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 4), flowerMat);
    fl.position.copy(pot.position).add(new THREE.Vector3(range(lr, -0.06, 0.06), 0.21 + range(lr, 0, 0.035), range(lr, -0.06, 0.06)));
    group.add(fl);
  }
  for (let i = 0; i < 4; i++) {
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.05, 0.012), basicNF(ctx, ['#d24a3a', '#3a78c8', '#e8c840', '#58a060'][i]!));
    clip.position.copy(railBase).addScaledVector(sideV, 0.35 + i * 0.13).add(new THREE.Vector3(0, 0.03, 0));
    group.add(clip);
  }
  ctx.add(group, { occlude: false });
  return { group, miniZhou, crowd, lamp, festoon, ants: { mesh: antMesh, update: antUpdate } };
}
