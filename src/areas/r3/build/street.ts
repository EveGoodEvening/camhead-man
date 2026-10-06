// owner: R3
// 老街（GDD §4.4）：湿柏油路、两侧人行道与路沿、北侧一排关着门的铺面（修表铺、纸扎店、照相馆、早点铺、小卖部）、
// 南侧梧桐与院墙、公交站（末班车 22:40）、邮筒、钠灯两盏（真实光）、远灯（只有灯罩）、电线、小广告、自行车、花盆、电表箱、痰盂……
// 照相馆的门脸与屋里在 shop.ts。

import * as THREE from 'three';
import type { AreaContext } from '../../../core/area';
import type { V3 } from '../../../core/types';
import { DEG2RAD } from '../../../core/math';
import { MATERIALS } from '../../../fx/materials';
import { PAINT, paintTexture } from '../../../kit/canvas';
import { kitMat } from '../../../kit/geom';
import { lamp, type LampRig } from '../../../kit/lamps';
import { plane_tree, shrub, skyDome } from '../../../kit/nature';
import { PROPS } from '../../../kit/props';
import { building } from '../../../kit/building';
import { windowGrid } from '../../../kit/windows';
import { rng, range } from '../../../kit/rng';
import { BUS_STOP, FACADE, GROUND, MAILBOX, PLANE_TREES, SHOPS, STREET } from '../layout';
import { TEXT } from '../text';
import { Batch, contactShadows, decal, flattenStatics, paintedMat, wireBundle } from './util';
import { ashCircle, bladeSign, busTimetable, chalkZhuanrang, civicLightbox, litWindow, meterBox, paintedSign, paperWindow, shutter, streetPlaque } from './textures';

/** 北侧一段楼（铺面 + 楼上）。 */
interface Block { x0: number; x1: number; floors: number; facade: 'brick' | 'plaster' | 'tile'; seed: number }

/** 照相馆以外的北侧楼段（照相馆本身在 shop.ts）。空当处也是楼（夹道封着）。 */
const BLOCKS: readonly Block[] = [
  { x0: STREET.wallX0, x1: -18, floors: 3, facade: 'brick', seed: 3 },
  { x0: -18, x1: -12, floors: 2, facade: 'plaster', seed: 5 },
  { x0: -12, x1: -11, floors: 2, facade: 'brick', seed: 7 },
  { x0: -11, x1: -5, floors: 2, facade: 'brick', seed: 9 },
  { x0: -5, x1: -3.35, floors: 3, facade: 'brick', seed: 11 },
  { x0: 3.35, x1: 5, floors: 3, facade: 'brick', seed: 13 },
  { x0: 5, x1: 11, floors: 2, facade: 'plaster', seed: 15 },
  { x0: 11, x1: 13, floors: 3, facade: 'brick', seed: 17 },
  { x0: 13, x1: 19, floors: 2, facade: 'tile', seed: 19 },
  { x0: 19, x1: STREET.wallX1, floors: 3, facade: 'plaster', seed: 21 },
];
const DEPTH = 7;

export interface StreetRig {
  sodium: LampRig[];
  /** 最近一次画本区时的镜头位置（夜空罩子的 onBeforeRender 里记下；它不做视锥剔除，任何机位都会画到它）；valid = 画过至少一次 */
  view: { pos: THREE.Vector3; valid: boolean };
  /**
   * 本文件挂到区域 root 下的全部街景节点（不含灯、不含夜空罩子）：人进了影棚深处/暗房时整批 visible=false（logic.ts updateLogic），
   * 隔墙后面的一整条街不再提交绘制（M4：暗房朝店门看 draw call 249/250）。灯都直接挂在 root 下，不在这里（灯数恒定）。
   */
  outdoor: THREE.Object3D[];
}

function containsLight(o: THREE.Object3D): boolean {
  let found = false;
  o.traverse(n => {
    if ((n as THREE.Light).isLight) found = true;
  });
  return found;
}

export function buildStreet(ctx: AreaContext): StreetRig {
  const before = new Set(ctx.root.children);
  const B = new Batch('r3:street');
  const concrete = MATERIALS.concrete();
  const brick = MATERIALS.brick();
  const plaster = MATERIALS.plaster();
  const tile = MATERIALS.tileWhite();
  const wood = MATERIALS.wood();
  const metal = MATERIALS.metal();
  const facadeMat = { brick, plaster, tile } as const;

  // ———————————————— 地面：柏油路（低 0.1）、两侧人行道、路沿
  const X0 = STREET.wallX0 - 6, X1 = STREET.wallX1 + 6;
  const asphalt = new THREE.Mesh(new THREE.BoxGeometry(X1 - X0, 0.3, GROUND.southWalkZ - GROUND.northWalkZ), MATERIALS.asphaltWet());
  asphalt.position.set((X0 + X1) / 2, GROUND.street - 0.15, (GROUND.northWalkZ + GROUND.southWalkZ) / 2);
  asphalt.name = 'r3:asphalt';
  asphalt.receiveShadow = false;
  ctx.add(asphalt);
  B.aabb(concrete, X0, -0.3, -0.2, X1, 0, GROUND.northWalkZ);
  B.aabb(concrete, X0, -0.3, GROUND.southWalkZ, X1, 0, STREET.wallZ1 + 0.4);
  // 路沿石（浅一点的水泥条，略高出人行道 1cm）
  const curbMat = kitMat('r3:curb', { color: '#8d8a84', roughness: 0.8 });
  B.aabb(curbMat, X0, -0.12, GROUND.northWalkZ - 0.16, X1, 0.01, GROUND.northWalkZ);
  B.aabb(curbMat, X0, -0.12, GROUND.southWalkZ, X1, 0.01, GROUND.southWalkZ + 0.16);
  // 人行道方砖缝
  const seam = kitMat('r3:seam', { color: '#2a2826', roughness: 1 });
  for (let x = Math.ceil(X0); x < X1; x += 1.2) {
    B.aabb(seam, x, 0, 0.05, x + 0.02, 0.004, GROUND.northWalkZ - 0.2);
    B.aabb(seam, x, 0, GROUND.southWalkZ + 0.2, x + 0.02, 0.004, STREET.wallZ1);
  }
  // 马路中线（旧漆，断断续续）
  const paint = kitMat('r3.roadPaint', { color: '#b8ae88', roughness: 0.6 });
  for (let x = X0 + 1; x < X1 - 2; x += 4) B.aabb(paint, x, GROUND.street, 5.0, x + 2, GROUND.street + 0.004, 5.12);

  // 碰撞：路面、两侧人行道（顶 y=0，路沿 0.1 走得上去）、外墙
  ctx.collider.floor(STREET.wallX0, GROUND.northWalkZ, STREET.wallX1, GROUND.southWalkZ, GROUND.street);
  ctx.collider.box([(STREET.wallX0 + STREET.wallX1) / 2, -0.1, GROUND.northWalkZ / 2], [STREET.wallX1 - STREET.wallX0, 0.2, GROUND.northWalkZ]);
  ctx.collider.box([(STREET.wallX0 + STREET.wallX1) / 2, -0.1, (GROUND.southWalkZ + STREET.wallZ1) / 2], [STREET.wallX1 - STREET.wallX0, 0.2, STREET.wallZ1 - GROUND.southWalkZ]);
  ctx.collider.wall([STREET.wallX0, -0.2], [STREET.wallX0, STREET.wallZ1], -0.2, 4);
  ctx.collider.wall([STREET.wallX1, -0.2], [STREET.wallX1, STREET.wallZ1], -0.2, 4);
  ctx.collider.wall([STREET.wallX0, STREET.wallZ1], [STREET.wallX1, STREET.wallZ1], -0.2, 4);

  // ———————————————— 北侧楼段
  const r = rng(4404);
  for (const b of BLOCKS) {
    const H = FACADE.groundH + (b.floors - 1) * 2.8 + range(r, 0.2, 0.8);
    const fm = facadeMat[b.facade];
    // 立面（墙板 z = 0 往北 0.3）。铺面那几段底层留开口（开口里是卷帘门/橱窗/木门，后面一道暗墙），墙垛与门楣在 shopFront 里
    const isShop = Object.values(SHOPS).some(sh => sh.x0 === b.x0 && sh.x1 === b.x1);
    if (isShop) {
      B.aabb(fm, b.x0, FACADE.groundH - 0.12, -0.3, b.x1, H, 0);
      B.saabb('#141210', b.x0, 0, -0.45, b.x1, FACADE.groundH, -0.3);
    } else {
      B.aabb(fm, b.x0, 0, -0.3, b.x1, H, 0);
    }
    // 楼层线、檐口、勒脚
    B.aabb(concrete, b.x0, FACADE.groundH - 0.12, -0.05, b.x1, FACADE.groundH + 0.02, 0.1);
    B.aabb(concrete, b.x0, H - 0.12, -0.05, b.x1, H + 0.08, 0.14);
    B.aabb(concrete, b.x0, 0, -0.05, b.x1, 0.35, 0.05);
    // 楼上窗户（几乎全黑，零星几扇亮）
    const w = b.x1 - b.x0;
    const cols = Math.max(1, Math.floor((w - 0.8) / 2.4) + 1);
    if (w > 1.4) {
      const span = (cols - 1) * 2.4;
      const win = windowGrid(
        { origin: [b.x0 + (w - span) / 2, FACADE.upperWinY, 0.005], right: [1, 0, 0], up: [0, 2.8, 0], cols, rows: b.floors - 1 },
        { w: 1.1, h: 1.35, spacing: 2.4, litRatio: 0.12, frame: b.facade === 'brick' ? 'wood' : 'steel', bars: b.seed % 3 === 0 },
        b.seed,
      );
      ctx.add(win, { occlude: false });
      // 窗台
      for (let c = 0; c < cols; c++) {
        for (let fl = 0; fl < b.floors - 1; fl++) {
          const cx = b.x0 + (w - span) / 2 + c * 2.4;
          B.aabb(concrete, cx - 0.65, FACADE.upperWinY - 0.78 + fl * 2.8, 0, cx + 0.65, FACADE.upperWinY - 0.7 + fl * 2.8, 0.14);
        }
      }
    }
    // 碰撞：整栋楼一个盒子
    ctx.collider.box([(b.x0 + b.x1) / 2, H / 2, -DEPTH / 2], [b.x1 - b.x0, H, DEPTH]);
    // 楼顶一圈暗色的屋面（从街上看不到太多，给远景机位一个顶）
    B.aabb(concrete, b.x0, H - 0.02, -DEPTH, b.x1, H, -0.3);
  }

  // ———————————————— 各铺面（关着门）
  const shutterMat = paintedMat(ctx, 256, 256, shutter, { roughness: 0.55, metalness: 0.35, name: 'r3:shutter' });
  const shutterTex = (shutterMat as THREE.MeshStandardMaterial).map;
  if (shutterTex) {
    shutterTex.wrapS = shutterTex.wrapT = THREE.RepeatWrapping;
  }
  const shopFront = (x0: number, x1: number, o: { shutter?: [number, number]; door?: [number, number]; window?: [number, number] }) => {
    // 铺面开口：左右砖垛 + 门楣，开口里是卷帘门/木门/橱窗
    const lintelY = 2.85;
    B.aabb(tile, x0, 0, 0.0, x0 + 0.35, FACADE.groundH - 0.12, 0.06);
    B.aabb(tile, x1 - 0.35, 0, 0.0, x1, FACADE.groundH - 0.12, 0.06);
    B.aabb(tile, x0 + 0.35, lintelY, 0.0, x1 - 0.35, FACADE.groundH - 0.12, 0.04);
    if (o.shutter) {
      const [a, b] = o.shutter;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(b - a, lintelY - 0.02), shutterMat);
      const uv = m.geometry.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (b - a) / 1.6, uv.getY(i) * (lintelY / 1.6));
      m.position.set((a + b) / 2, lintelY / 2, 0.02);
      B.add(m);
      // 卷帘盒
      B.aabb(metal, a - 0.05, lintelY - 0.3, 0.02, b + 0.05, lintelY, 0.3);
    }
    if (o.door) {
      const [a, b] = o.door;
      B.aabb(wood, a, 0, -0.02, b, 2.3, 0.04);
      B.aabb(metal, b - 0.2, 1.0, 0.04, b - 0.08, 1.04, 0.07);
    }
  };
  // 修表铺：卷帘门 + 侧门
  shopFront(SHOPS.watch.x0, SHOPS.watch.x1, { shutter: [SHOPS.watch.x0 + 0.4, SHOPS.watch.x1 - 1.6], door: [SHOPS.watch.x1 - 1.4, SHOPS.watch.x1 - 0.45] });
  // 纸扎店：橱窗 + 木门
  shopFront(SHOPS.paper.x0, SHOPS.paper.x1, { door: [SHOPS.paper.x1 - 1.45, SHOPS.paper.x1 - 0.45] });
  // 早点铺：卷帘门（粉笔“转让”）
  shopFront(SHOPS.breakfast.x0, SHOPS.breakfast.x1, { shutter: [SHOPS.breakfast.x0 + 0.4, SHOPS.breakfast.x1 - 0.4] });
  // 小卖部：卷帘门 + 冰柜
  shopFront(SHOPS.store.x0, SHOPS.store.x1, { shutter: [SHOPS.store.x0 + 0.4, SHOPS.store.x1 - 0.4] });

  // 招牌（手绘木板/灯箱，1024 宽贴图；门楣上方）
  const signBoard = (x0: number, x1: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void, emissive = 0) => {
    const w = x1 - x0 - 0.3, h = 0.62;
    const mat = paintedMat(ctx, 768, 192, paint, { roughness: 0.75, ...(emissive ? { emissive } : {}) });
    B.aabb(wood, (x0 + x1) / 2 - w / 2 - 0.04, 3.18 - h / 2 - 0.04, 0.06, (x0 + x1) / 2 + w / 2 + 0.04, 3.18 + h / 2 + 0.04, 0.15);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    face.position.set((x0 + x1) / 2, 3.18, 0.156);
    face.name = 'r3.signFace';
    ctx.add(face);
  };
  signBoard(SHOPS.watch.x0, SHOPS.watch.x1, paintedSign(TEXT.sign.watch, TEXT.sign.watchSub, { bg: '#1c3d6b', ink: '#f2ecd8', seed: 31 }));
  signBoard(SHOPS.paper.x0, SHOPS.paper.x1, paintedSign(TEXT.sign.paper, null, { bg: '#161616', ink: '#e8e2d2', serif: true, seed: 33 }));
  signBoard(SHOPS.breakfast.x0, SHOPS.breakfast.x1, paintedSign(TEXT.sign.breakfast, TEXT.sign.breakfastSub, { bg: '#b8322a', ink: '#f8eed8', seed: 35 }));
  signBoard(SHOPS.store.x0, SHOPS.store.x1, paintedSign(TEXT.sign.store, TEXT.sign.storeSub, { bg: '#e8e2c8', ink: '#b3202a', subInk: '#1a4a8a', seed: 37 }), 0.35);

  // 早点铺卷帘门上的粉笔“转让”
  decal(ctx, ctx.track(paintTexture(512, 256, chalkZhuanrang)), 1.9, 0.95, [SHOPS.breakfast.x0 + 2.6, 1.55, 0.035], 0);

  // 纸扎店橱窗：红灯泡照着纸人纸马（烘焙光照的 MeshBasic 背板 + 玻璃 + 真正烧白的小灯泡）
  {
    const wx0 = SHOPS.paper.x0 + 0.45, wx1 = SHOPS.paper.x1 - 1.6;
    const wy0 = 0.55, wy1 = 2.6;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(wx1 - wx0, wy1 - wy0), paintedMat(ctx, 512, 384, paperWindow, { basic: true, name: 'r3.paperWindow' }));
    back.position.set((wx0 + wx1) / 2, (wy0 + wy1) / 2, -0.28);
    ctx.add(back);
    // 窗框、窗台、内侧两壁（也是红的）
    const redWall = new THREE.MeshBasicMaterial({ color: '#3a0808' });
    redWall.name = 'r3.paperWindowSide';
    B.aabb(redWall, wx0 - 0.02, wy0, -0.3, wx0, wy1, 0);
    B.aabb(redWall, wx1, wy0, -0.3, wx1 + 0.02, wy1, 0);
    B.aabb(redWall, wx0, wy0 - 0.02, -0.3, wx1, wy0, 0);
    B.aabb(wood, wx0 - 0.08, wy0 - 0.1, -0.02, wx1 + 0.08, wy0, 0.12);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(wx1 - wx0, wy1 - wy0), MATERIALS.glass());
    glass.position.set((wx0 + wx1) / 2, (wy0 + wy1) / 2, 0.01);
    glass.userData.noOcclude = true;
    ctx.add(glass, { occlude: false });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), MATERIALS.emissive('#ff3a26', 1.4));
    bulb.position.set((wx0 + wx1) / 2, wy1 - 0.16, -0.18);
    ctx.add(bulb);
    B.rod(metal, [(wx0 + wx1) / 2, wy1, -0.18], [(wx0 + wx1) / 2, wy1 - 0.12, -0.18], 0.006);
    // 门口挂一串纸钱
    const paperMat = MATERIALS.paper();
    for (let i = 0; i < 6; i++) B.box(paperMat, 0.1, 0.1, 0.004, [SHOPS.paper.x1 - 1.55, 2.5 - i * 0.13, 0.08], i * 12);
  }

  // 楼上伸出来的晾衣竿（早点铺、修表铺楼上）
  for (const [x, y, rot] of [[7.2, FACADE.upperWinY - 0.7, 0], [-16.6, FACADE.upperWinY - 0.75, 0]] as const) {
    const line = PROPS.clothesLine(1.8, Math.round(x * 3));
    line.position.set(x, y + 0.9, 0.9);
    line.rotation.y = rot;
    ctx.add(line);
    B.srod('#8a7a5a', [x - 0.1, y + 0.9, 0.9], [x + 1.9, y + 0.9, 0.9], 0.02);
    B.srod('#8a7a5a', [x - 0.1, y + 0.9, 0.9], [x - 0.1, y + 0.2, 0.02], 0.015);
    B.srod('#8a7a5a', [x + 1.9, y + 0.9, 0.9], [x + 1.9, y + 0.2, 0.02], 0.015);
  }

  // ———————————————— 小广告、路牌、电表箱
  const posters = TEXT.sign.posters;
  const posterAt: readonly [V3, number][] = [
    [[-12.5, 1.3, 0.045], 0], [[-4.2, 1.2, 0.01], 0], [[4.2, 1.4, 0.01], 0], [[12.0, 1.2, 0.01], 0], [[19.8, 1.3, 0.01], 0], [[-20.5, 1.1, 0.01], 0],
  ];
  posterAt.slice(0, 4).forEach(([p, rot], i) => decal(ctx, ctx.track(PAINT.posters({ lines: posters[i % posters.length] ?? ['开锁'], seed: 70 + i })), 0.8, 0.8, p, rot));
  decal(ctx, ctx.track(PAINT.demolitionMark()), 1.3, 1.3, [-19.6, 2.1, 0.012], 0);
  // 路牌“老街”
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.36), paintedMat(ctx, 512, 200, streetPlaque, { roughness: 0.4, metalness: 0.3 }));
  plaque.position.set(-21.2, 2.6, 0.03);
  ctx.add(plaque);
  // 电表箱
  const meterMat = paintedMat(ctx, 256, 256, meterBox, { roughness: 0.5, metalness: 0.4 });
  for (const [x, y] of [[-11.5, 2.1], [4.0, 2.2], [12.1, 2.0]] as const) {
    B.box(metal, 0.5, 0.6, 0.18, [x, y, 0.09]);
    B.plane(meterMat, 0.48, 0.58, [x, y, 0.182]);
    B.rod(metal, [x - 0.1, y + 0.3, 0.12], [x - 0.1, FACADE.groundH + 1.8, 0.12], 0.012);
  }

  // ———————————————— 街面的生活痕迹
  const bikes: readonly [number, number, number][] = [[-16.2, 0.45, 8], [-15.4, 0.42, 172], [15.6, 0.45, -6]];
  const bikeGroup = new THREE.Group();
  bikeGroup.name = 'r3:bikes';
  bikes.forEach(([x, z, rot], i) => {
    const b = PROPS.bicycle(i + 3);
    b.position.set(x, 0, z);
    b.rotation.y = rot * DEG2RAD;
    bikeGroup.add(b);
  });
  ctx.add(bikeGroup);
  flattenStatics(ctx, bikeGroup);
  // 花盆（照相馆门口两盆、修表铺门口一盆）：瓦盆 + 灌木
  for (const [x, z, s] of [[-3.0, 0.45, 1], [3.0, 0.45, 1], [-12.4, 0.4, 0.8], [18.4, 0.4, 0.9]] as const) {
    B.scyl('#8a4a30', 0.22 * s, 0.16 * s, 0.34 * s, [x, 0.17 * s, z], 12);
    const sh = shrub({ seed: Math.round(x * 10) });
    sh.scale.setScalar(0.45 * s);
    sh.position.set(x, 0.3 * s, z);
    ctx.add(sh);
  }
  // 痰盂（早点铺门口）、垃圾桶、蜂窝煤炉、一摞蒸笼、折叠桌凳
  B.scyl('#d8d2c0', 0.12, 0.1, 0.22, [SHOPS.breakfast.x1 - 0.6, 0.11, 0.35], 14, true);
  B.scyl('#b3202a', 0.14, 0.14, 0.02, [SHOPS.breakfast.x1 - 0.6, 0.23, 0.35], 14, true);
  const bin = PROPS.trashBin();
  bin.position.set(-1.6, 0, 9.4);
  ctx.add(bin);
  B.scyl('#3a3836', 0.2, 0.22, 0.6, [SHOPS.breakfast.x0 + 0.7, 0.3, 0.5], 12);
  B.scyl('#1a1614', 0.21, 0.21, 0.03, [SHOPS.breakfast.x0 + 0.7, 0.61, 0.5], 12);
  for (let i = 0; i < 5; i++) B.scyl(i % 2 ? '#a88a4a' : '#b8995a', 0.26, 0.26, 0.11, [SHOPS.breakfast.x0 + 1.4, 0.06 + i * 0.12, 0.45], 16);
  B.sbox('#8a2a22', 0.9, 0.04, 0.05, [SHOPS.breakfast.x1 - 1.4, 0.7, 0.3], 0);
  B.sbox('#8a2a22', 0.9, 0.7, 0.03, [SHOPS.breakfast.x1 - 1.4, 0.35, 0.28], 0);
  for (let i = 0; i < 4; i++) B.sbox('#2a5a8a', 0.34, 0.03, 0.34, [SHOPS.breakfast.x1 - 2.4, 0.03 + i * 0.05, 0.4], i * 7);
  // 小卖部门口的冰柜（关着）
  B.saabb('#dedad0', SHOPS.store.x0 + 0.6, 0, 0.1, SHOPS.store.x0 + 1.8, 0.85, 0.75);
  B.saabb('#9ab0c0', SHOPS.store.x0 + 0.62, 0.85, 0.12, SHOPS.store.x0 + 1.78, 0.88, 0.73, true);
  ctx.collider.box([SHOPS.store.x0 + 1.2, 0.45, 0.42], [1.2, 0.9, 0.65]);

  // ———————————————— 南侧：人行道外的院墙、远处的楼、梧桐、公交站、邮筒
  B.aabb(brick, X0, 0, STREET.wallZ1, X1, 2.3, STREET.wallZ1 + 0.3);
  B.aabb(concrete, X0, 2.3, STREET.wallZ1 - 0.04, X1, 2.4, STREET.wallZ1 + 0.34);
  decal(ctx, ctx.track(PAINT.posters({ lines: ['旺铺出租', '通下水道', '开锁'], seed: 91 })), 1.0, 1.0, [-10.5, 1.2, STREET.wallZ1 - 0.01], 180);
  decal(ctx, ctx.track(PAINT.posters({ lines: ['回收旧家电', '办证'], seed: 93 })), 0.9, 0.9, [8.2, 1.1, STREET.wallZ1 - 0.01], 180);
  decal(ctx, ctx.track(PAINT.demolitionMark()), 1.6, 1.6, [0.8, 1.35, STREET.wallZ1 - 0.012], 180);
  const farN = building({ x0: -34, x1: 34, z0: 16, z1: 26, floors: 6, facade: 'brick', faces: ['n'], roof: 'parapet', seed: 41, balconies: true, clothesLines: 2,
    windows: { w: 1.1, h: 1.3, spacing: 2.9, litRatio: 0.11, frame: 'wood' } });
  ctx.add(farN.group, { occlude: false });
  for (const [x, z] of PLANE_TREES) {
    const t = plane_tree({ seed: Math.round(x * 7 + 100) });
    t.position.set(x, 0, z);
    t.scale.setScalar(1.1);
    ctx.add(t);
    ctx.collider.box([x, 1.5, z], [0.5, 3, 0.5]);
    // 树池
    B.saabb('#2a2622', x - 0.55, 0, z - 0.55, x + 0.55, 0.02, z + 0.55);
  }
  const stop = PROPS.busStop();
  stop.position.set(...BUS_STOP);
  ctx.add(stop);
  flattenStatics(ctx, stop);
  ctx.collider.box([BUS_STOP[0], 1.3, BUS_STOP[2] + 0.34], [3.0, 2.6, 0.12]);
  // 站牌上的时刻表：末班车 22:40
  const tt = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.62), paintedMat(ctx, 256, 344, busTimetable, { roughness: 0.5 }));
  tt.position.set(BUS_STOP[0] + 1.75, 1.45, BUS_STOP[2] - 0.38);
  tt.rotation.y = Math.PI;
  ctx.add(tt);
  const mb = PROPS.mailbox();
  mb.position.set(...MAILBOX);
  ctx.add(mb);
  ctx.collider.box([MAILBOX[0], 0.6, MAILBOX[2]], [0.55, 1.2, 0.55]);

  // ———————————————— 东头工地围挡、西头的夜路
  const hoard = PROPS.hoarding(STREET.wallZ1 + 0.2, 2.4);
  hoard.position.set(STREET.wallX1 + 0.1, 0, STREET.wallZ1 / 2);
  hoard.rotation.y = -Math.PI / 2;
  ctx.add(hoard);

  // ———————————————— 灯：钠灯两盏（真实光，北侧人行道上，灯臂朝南伸向马路）；远处只有灯罩
  const sodium: LampRig[] = [];
  const spans: { a: V3; b: V3; sag: number }[] = [];
  for (const x of [-11.5, 12.0]) {
    const s = lamp({ kind: 'sodium_pole', at: [x, 0, 1.05], light: { design: 2.2, distance: 14 }, wetStreak: true });
    s.group.rotation.y = Math.PI;
    s.group.updateMatrixWorld(true);
    // 湿地光带贴的是世界 y=0；马路低 0.1
    const streak = s.group.getObjectByName('wetStreak');
    if (streak) streak.position.y -= 0.1 - 0.005;
    if (s.light) {
      s.light.position.copy(new THREE.Vector3(0, 5.55, -1.25).applyMatrix4(s.group.matrixWorld));
      ctx.light(s.light);
    }
    ctx.add(s.group);
    flattenStatics(ctx, s.group);
    ctx.collider.box([x, 1.5, 1.05], [0.3, 3, 0.3]);
    sodium.push(s);
    // 电线：灯杆 → 两边的楼
    spans.push({ a: [x, 5.3, 1.05], b: [x - 6, 6.4, -0.25], sag: 0.3 }, { a: [x, 5.3, 1.05], b: [x + 7, 6.2, -0.25], sag: 0.35 });
  }
  // 横过马路的电线（到南边院墙外的电线杆）
  for (const x of [-20.5, 1.5, 16.2]) {
    B.scyl('#3a2e24', 0.08, 0.11, 7.5, [x, 3.75, STREET.wallZ1 - 0.25], 8);
    B.sbox('#3a2e24', 1.0, 0.08, 0.08, [x, 7.0, STREET.wallZ1 - 0.25]);
    ctx.collider.box([x, 1.5, STREET.wallZ1 - 0.25], [0.3, 3, 0.3]);
    spans.push({ a: [x - 0.4, 7.0, STREET.wallZ1 - 0.25], b: [x + 3, 6.6, -0.3], sag: 0.5 }, { a: [x + 0.4, 7.0, STREET.wallZ1 - 0.25], b: [x + 4.5, 6.3, -0.3], sag: 0.6 });
    spans.push({ a: [x - 0.4, 7.0, STREET.wallZ1 - 0.25], b: [x - 8, 7.0, STREET.wallZ1 - 0.25], sag: 0.4 });
  }
  ctx.add(wireBundle(spans));
  for (const [x, z, rot] of [[-27, 9.4, 0], [27, 1.0, Math.PI]] as const) {
    const far = lamp({ kind: 'sodium_pole', at: [x, 0, z], light: false });
    far.group.rotation.y = rot;
    ctx.add(far.group);
    flattenStatics(ctx, far.group);
  }

  // ———————————————— 楼上几扇亮着的窗（有人没睡）：自绘窗帘，HDR ×2.6（与 kit 的亮窗同一档）；盖在 kit 窗户实例的玻璃上
  const litWins: readonly { x: number; warm: string; curtain: string; plant?: boolean; seed: number }[] = [
    { x: -15.0, warm: '#ffd48a', curtain: '#c8a040', seed: 5 },
    { x: -12.6, warm: '#ffc070', curtain: '#b8503a', plant: true, seed: 1 },
    { x: -10.4, warm: '#ffe0a8', curtain: '#4a6a8a', seed: 6 },
    { x: -8.0, warm: '#ffb060', curtain: '#6a7a3a', seed: 2 },
    { x: 8.0, warm: '#ffd08a', curtain: '#3a5a8a', plant: true, seed: 3 },
    { x: 16.0, warm: '#ffc878', curtain: '#8a3a5a', seed: 4 },
  ];
  for (const w of litWins) {
    const mat = paintedMat(ctx, 192, 240, litWindow(w), { basic: true, name: 'r3.litWindow' }) as THREE.MeshBasicMaterial;
    mat.color.setScalar(3.6);
    mat.userData.tempC = 22;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.14), mat);
    m.position.set(w.x, FACADE.upperWinY, 0.024);
    m.name = 'r3.litWindow';
    ctx.add(m, { tempC: 22 });
  }

  // ———————————————— 七月半：纸扎店门口路边烧纸的灰圈，两截红蜡烛、一把香还没灭（只有火苗发光，不另加灯）
  {
    const cx = SHOPS.paper.x0 + 1.6, cz = 1.05;
    const ash = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
      map: ctx.track(paintTexture(256, 256, ashCircle)), transparent: true, depthWrite: false, roughness: 0.95,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    ash.position.set(cx, 0.004, cz);
    ash.name = 'r3.ashCircle';
    ash.userData.noOcclude = true;
    ctx.add(ash, { occlude: false });
    const wax = '#b3202a';
    const flame = MATERIALS.emissive('#ffc46a', 2.2);
    for (const [dx, dz, hh] of [[-0.5, -0.12, 0.1], [-0.46, 0.08, 0.065]] as const) {
      B.scyl(wax, 0.016, 0.018, hh, [cx + dx, hh / 2, cz + dz], 10);
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.04, 8), flame);
      f.position.set(cx + dx, hh + 0.024, cz + dz);
      B.add(f);
    }
    // 一把香插在一块砖缝里，香头三点红
    for (let i = 0; i < 3; i++) {
      const x = cx + 0.46 + i * 0.012, z = cz - 0.05 + i * 0.01;
      B.srod('#6a4a2a', [x, 0, z], [x + 0.01 * (i - 1), 0.22, z], 0.0025, 4);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 4), MATERIALS.emissive('#ff5a2a', 1.6));
      tip.position.set(x + 0.01 * (i - 1), 0.222, z);
      B.add(tip);
    }
  }

  // ———————————————— 公交站东头的街道办灯箱（中元节文明祭扫）：两面发光
  {
    const lbTex = ctx.track(paintTexture(320, 544, civicLightbox));
    lbTex.anisotropy = 4;
    const lbMat = new THREE.MeshStandardMaterial({ map: lbTex, emissive: '#ffffff', emissiveMap: lbTex, emissiveIntensity: 1.5, roughness: 0.4 });
    lbMat.name = 'r3.civicLightbox';
    lbMat.userData.tempC = 40;
    const x = BUS_STOP[0] + 2.45, z = BUS_STOP[2] + 0.05;
    B.saabb('#6a6e72', x - 0.07, 0, z - 0.52, x + 0.07, 2.05, z + 0.52, true);
    for (const side of [-1, 1] as const) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 1.56), lbMat);
      face.position.set(x + side * 0.072, 1.2, z);
      face.rotation.y = side * Math.PI / 2;
      ctx.add(face, { tempC: 40 });
    }
    ctx.collider.box([x, 1.0, z], [0.16, 2.0, 1.05]);
  }

  // ———————————————— 挑出街面的竖灯箱（修表铺、小卖部）：两面发光，顺着街老远就看得见（只有灯箱片发光，不另加灯）
  const blade = (x: number, y0: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void, glow: number) => {
    const w = 0.5, h = 1.3, z0 = 0.18, t = 0.12;
    const tex = ctx.track(paintTexture(256, 666, paint));
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: glow, roughness: 0.45 });
    mat.name = 'r3.bladeSign';
    mat.userData.tempC = 40;
    B.saabb('#6a6e72', x - t / 2 - 0.01, y0 - 0.03, z0 - 0.02, x + t / 2 + 0.01, y0 + h + 0.03, z0 + w + 0.02, true);
    for (const side of [-1, 1] as const) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      face.position.set(x + side * (t / 2 + 0.012), y0 + h / 2, z0 + w / 2);
      face.rotation.y = side * Math.PI / 2;
      face.name = 'r3.bladeSign';
      ctx.add(face, { tempC: 40 });
    }
    // 两根铁支架钉进墙里、一根电线从灯箱顶上爬回墙
    B.srod('#3a3836', [x, y0 + h - 0.1, 0.02], [x, y0 + h - 0.1, z0], 0.015);
    B.srod('#3a3836', [x, y0 + 0.1, 0.02], [x, y0 + 0.1, z0], 0.015);
    B.srod('#1a1a1a', [x, y0 + h + 0.03, z0 + 0.1], [x, y0 + h + 0.35, 0.03], 0.006, 4);
  };
  blade(SHOPS.watch.x1 - 0.18, 2.2, bladeSign(TEXT.sign.bladeWatch.main, TEXT.sign.bladeWatch.sub, { band: '#1c3d6b', ink: '#1c3d6b', subInk: '#b3202a', seed: 41 }), 0.9);
  blade(SHOPS.store.x0 + 0.18, 2.2, bladeSign(TEXT.sign.bladeStore.main, TEXT.sign.bladeStore.sub, { band: '#b3202a', ink: '#b3202a', subInk: '#1a4a8a', seed: 43 }), 0.85);

  contactShadows(ctx, [
    { x: MAILBOX[0], z: MAILBOX[2], rx: 0.4, rz: 0.4 }, { x: -1.6, z: 9.4, rx: 0.35, rz: 0.35 }, { x: SHOPS.store.x0 + 1.2, z: 0.42, rx: 0.8, rz: 0.45, a: 0.8 },
    { x: -16.2, z: 0.45, rx: 0.9, rz: 0.3, a: 0.6 }, { x: -15.4, z: 0.42, rx: 0.9, rz: 0.3, a: 0.6 }, { x: 15.6, z: 0.45, rx: 0.9, rz: 0.3, a: 0.6 },
    { x: SHOPS.breakfast.x0 + 1.0, z: 0.5, rx: 0.6, rz: 0.35, a: 0.7 }, { x: SHOPS.breakfast.x1 - 1.4, z: 0.35, rx: 0.6, rz: 0.3, a: 0.7 },
  ]);

  // 夜空；顺手记下镜头位置（logic.ts 按它决定半球光是街上那一档还是屋里那一档）
  const view = { pos: new THREE.Vector3(), valid: false };
  const sky = skyDome({ horizon: '#23161c', glow: '#4a2a26', clouds: 0.55 });
  sky.onBeforeRender = (_r, _s, cam) => {
    cam.getWorldPosition(view.pos);
    view.valid = true;
  };
  ctx.add(sky);

  B.flush(ctx);
  const outdoor = ctx.root.children.filter(o => !before.has(o) && o !== sky && !containsLight(o));
  return { sodium, view, outdoor };
}
