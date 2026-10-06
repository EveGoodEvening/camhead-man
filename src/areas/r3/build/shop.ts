// owner: R3
// 长明照相馆：门脸（红霓虹“长明照相馆”，“馆”字不亮；玻璃门；两侧样片橱窗；门铃；“取件请按铃”）与前厅
// （柜台、西墙 10×10 取件格、东墙老照片墙、价目表、日历、钨丝吊灯、候客长凳）。影棚与暗房在 studio.ts / darkroom.ts。

import * as THREE from 'three';
import type { AreaContext } from '../../../core/area';
import type { V3 } from '../../../core/types';
import { DEG2RAD } from '../../../core/math';
import { PALETTE } from '../../../data/palette';
import { MATERIALS } from '../../../fx/materials';
import { paintTexture } from '../../../kit/canvas';
import { door, type DoorRig } from '../../../kit/doors';
import { kitMat } from '../../../kit/geom';
import { lamp, designLight, type LampRig } from '../../../kit/lamps';
import { shrub } from '../../../kit/nature';
import { PROPS } from '../../../kit/props';
import { rng, range } from '../../../kit/rng';
import { BELL, COUNTER, DISPLAY, DOOR, FACADE, GRID, NEON_AT, PARTITION, SHOP, holeCenter } from '../layout';
import { TEXT } from '../text';
import { Batch, contactShadows, paintedMat, trackTree } from './util';
import { buildNeon, type NeonRig } from './neon';
import { atlasUv, calendar, cubbyBack, displayBack, gridNumbers, hallLightbox, pickupHeader, priceBoard, ringBellSign } from './textures';

/** 霓虹那盏点光（GDD §4.4：#FF3B3B，闪烁；照亮门脸与门口的人行道）。 */
export const NEON_LIGHT = { design: 0.6, distance: 6.5 } as const;

export interface ShopRig {
  door: DoorRig;
  neon: NeonRig;
  neonLight: THREE.PointLight;
  hallLamp: LampRig;
  bell: THREE.Object3D;
  holes: THREE.Mesh[];
  grid: THREE.Object3D;
  /** 橱窗的发光材质（霓虹熄了以后也调暗一点） */
  displayGlow: THREE.MeshStandardMaterial[];
}

/** 一组贴图集矩形（每个一张四边形），合成一个网格。rotY 为 three rotation.y（度）。 */
export function atlasQuads(items: readonly { at: V3; w: number; h: number; rotY: number; cell: number }[], mat: THREE.Material): THREE.Mesh {
  const pos: number[] = [], nor: number[] = [], uvs: number[] = [], idx: number[] = [];
  const q = new THREE.Quaternion(), v = new THREE.Vector3(), n = new THREE.Vector3();
  items.forEach((it, k) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rotY * DEG2RAD);
    n.set(0, 0, 1).applyQuaternion(q);
    const [u0, v0, u1, v1] = atlasUv(it.cell);
    const corners: [number, number, number, number][] = [[-0.5, -0.5, u0, v0], [0.5, -0.5, u1, v0], [0.5, 0.5, u1, v1], [-0.5, 0.5, u0, v1]];
    for (const [cx, cy, cu, cv] of corners) {
      v.set(cx * it.w, cy * it.h, 0).applyQuaternion(q).add(new THREE.Vector3(...it.at));
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
      uvs.push(cu, cv);
    }
    const b = k * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return new THREE.Mesh(g, mat);
}

export function buildShop(ctx: AreaContext, B: Batch, atlasTex: THREE.Texture): ShopRig {
  const tile = MATERIALS.tileWhite();
  const plaster = MATERIALS.plaster();
  const lime = MATERIALS.lime();
  const wood = MATERIALS.wood();
  const concrete = MATERIALS.concrete();
  const alu = kitMat('r3:alu', { color: '#9AA0A6', roughness: 0.55, metalness: 0.6 });
  const darkWood = kitMat('r3.darkWood', { color: '#3a2618', roughness: 0.7 });
  const X0 = SHOP.x0, X1 = SHOP.x1;
  const topY = FACADE.groundH + 2.8 + 0.6;

  // ================================================================ 门脸
  // 楼上：抹灰墙 + 两扇黑窗 + 檐口
  B.aabb(plaster, X0, FACADE.groundH, -0.3, X1, topY, 0);
  B.aabb(concrete, X0, FACADE.groundH - 0.12, -0.05, X1, FACADE.groundH + 0.02, 0.1);
  B.aabb(concrete, X0, topY - 0.12, -0.05, X1, topY + 0.08, 0.14);
  const upWin = kitMat('r3.upperWin', { color: '#12151c', roughness: 0.15, metalness: 0.3 });
  for (const x of [-1.6, 1.6]) {
    B.aabb(upWin, x - 0.55, FACADE.upperWinY - 0.65, -0.05, x + 0.55, FACADE.upperWinY + 0.65, 0.01);
    B.aabb(darkWood, x - 0.6, FACADE.upperWinY - 0.7, -0.04, x + 0.6, FACADE.upperWinY - 0.62, 0.05);
    B.aabb(darkWood, x - 0.6, FACADE.upperWinY + 0.62, -0.04, x + 0.6, FACADE.upperWinY + 0.7, 0.05);
    B.aabb(darkWood, x - 0.03, FACADE.upperWinY - 0.65, -0.04, x + 0.03, FACADE.upperWinY + 0.65, 0.03);
    B.aabb(concrete, x - 0.68, FACADE.upperWinY - 0.8, 0, x + 0.68, FACADE.upperWinY - 0.72, 0.14);
  }
  // 楼上的生活痕迹：右窗下一台锈了的空调外机（支架、冷凝水管顺墙下来），左窗台上一盆旱死的花
  {
    const ax = 1.6, ay0 = FACADE.groundH + 0.12, ay1 = ay0 + 0.5;
    B.saabb('#b9b6ac', ax - 0.4, ay0, 0.03, ax + 0.4, ay1, 0.33);
    B.saabb('#2a2a2a', ax - 0.36, ay0 + 0.04, 0.331, ax + 0.36, ay1 - 0.04, 0.335);
    const grill = new THREE.Mesh(new THREE.CircleGeometry(0.19, 20), kitMat('r3.acGrill', { color: '#46443f', roughness: 0.7 }));
    grill.position.set(ax + 0.12, (ay0 + ay1) / 2, 0.338);
    B.add(grill);
    for (let i = 0; i < 5; i++) B.saabb('#8e8a80', ax - 0.34, ay0 + 0.08 + i * 0.08, 0.336, ax - 0.12, ay0 + 0.1 + i * 0.08, 0.34);
    for (const dx of [-0.3, 0.3]) B.srod('#5a4a3a', [ax + dx, ay0 - 0.02, 0.33], [ax + dx, ay0 - 0.02, 0.0], 0.012);
    for (const dx of [-0.3, 0.3]) B.srod('#5a4a3a', [ax + dx, ay0 - 0.02, 0.32], [ax + dx, ay0 + 0.3, 0.0], 0.01);
    B.srod('#d8d4c8', [ax + 0.42, ay0 + 0.05, 0.1], [ax + 0.55, ay0 - 0.1, 0.06], 0.01, 5);
    B.srod('#d8d4c8', [ax + 0.55, ay0 - 0.1, 0.06], [ax + 0.55, FACADE.groundH - 0.1, 0.06], 0.01, 5);
    // 锈水印
    B.saabb('#6a4a32', ax - 0.25, ay0 - 0.35, 0.001, ax - 0.2, ay0, 0.004);
    B.saabb('#6a4a32', ax + 0.18, ay0 - 0.25, 0.001, ax + 0.21, ay0, 0.004);
    // 左窗台的花盆（旱死的枝子）
    B.scyl('#8a4a30', 0.1, 0.075, 0.16, [-1.9, FACADE.upperWinY - 0.64, 0.08], 10);
    for (let i = 0; i < 5; i++) B.srod('#5a4a2a', [-1.9, FACADE.upperWinY - 0.57, 0.08], [-1.9 + Math.cos(i * 1.3) * 0.12, FACADE.upperWinY - 0.3 - (i % 2) * 0.08, 0.08 + Math.sin(i * 1.3) * 0.08], 0.005, 4);
  }
  // 底层：白瓷砖垛子、窗台、门楣
  B.aabb(tile, X0, 0, -0.3, SHOP.inWest + 0.05, FACADE.groundH - 0.12, 0.06);
  B.aabb(tile, SHOP.inEast - 0.05, 0, -0.3, X1, FACADE.groundH - 0.12, 0.06);
  B.aabb(tile, DISPLAY.west.x0, 0, -0.1, DISPLAY.west.x1, DISPLAY.y0, 0.06);
  B.aabb(tile, DISPLAY.east.x0, 0, -0.1, DISPLAY.east.x1, DISPLAY.y0, 0.06);
  B.aabb(tile, SHOP.inWest, DISPLAY.y1, -0.1, SHOP.inEast, 2.9, 0.04);
  // 铝合金框：门两侧的竖框（门铃装在东边这根上）、橱窗框
  B.aabb(alu, DISPLAY.west.x1, 0, -0.08, -DOOR.w / 2, DISPLAY.y1, 0.05);
  B.aabb(alu, DOOR.w / 2, 0, -0.08, DISPLAY.east.x0, DISPLAY.y1, 0.05);
  B.aabb(alu, -DOOR.w / 2, DOOR.h, -0.06, DOOR.w / 2, DISPLAY.y1, 0.04);
  for (const d of [DISPLAY.west, DISPLAY.east]) {
    B.aabb(alu, d.x0, DISPLAY.y0 - 0.03, -0.04, d.x1, DISPLAY.y0 + 0.02, 0.05);
    B.aabb(alu, d.x0, DISPLAY.y1 - 0.02, -0.04, d.x1, DISPLAY.y1 + 0.03, 0.05);
    B.aabb(alu, (d.x0 + d.x1) / 2 - 0.02, DISPLAY.y0, -0.03, (d.x0 + d.x1) / 2 + 0.02, DISPLAY.y1, 0.03);
  }
  // 招牌底板（霓虹装在它前面）
  const board = kitMat('r3.neonBoard', { color: '#1a1416', roughness: 0.6, metalness: 0.25 });
  B.aabb(board, -2.95, 2.9, 0.04, 2.95, FACADE.groundH - 0.14, 0.12);
  // 霓虹“长明照相馆”，“馆”字不亮（GDD §4.4）：自绘空心字灯管（build/neon.ts）
  const neon = buildNeon(ctx, TEXT.sign.neon, 4.3, 0.64, [4]);
  neon.group.position.set(NEON_AT[0], NEON_AT[1], NEON_AT[2]);
  ctx.add(neon.group, { ref: 'r3:neon' });
  const neonLight = designLight('point', PALETTE.NEON, NEON_LIGHT.design, NEON_LIGHT.distance) as THREE.PointLight;
  neonLight.name = 'r3.neonLight';
  neonLight.position.set(0, 2.95, 0.9);
  ctx.light(neonLight);
  // 玻璃门（开门前挡人、不挡视线；GDD §4.4、ARCH §4.8）
  // 合页在东边、门把手在西边（x≈-0.38）：离门铃（x=0.8）远一点，站在门前按 E 不会跟门铃抢聚焦
  const shopDoor = door({ w: DOOR.w, h: DOOR.h, style: 'glass_shop', at: DOOR.at, yaw: 180, hinge: 'right' });
  ctx.add(shopDoor.group);
  // “取件请按铃”牌子：挂在门玻璃里侧，跟着门扇转
  const panel = shopDoor.leaf.getObjectByName('leafPanel');
  if (panel) {
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.16), paintedMat(ctx, 320, 128, ringBellSign, { roughness: 0.7 }));
    // 门扇局部：合页在 x=0，门扇往 +x 展开（hinge right，dir +1），正面（街）朝局部 -z
    // 挂得比眼睛低一点：隔着玻璃门往里瞅柜台后的陆师傅时，牌子不挡他的上半身
    tag.position.set(DOOR.w / 2, 1.28, -0.03);
    tag.rotation.y = Math.PI;
    panel.add(tag);
    trackTree(ctx, tag);
  }
  // 门铃（GDD：(0.8, 1.4, 0)）
  const bell = new THREE.Group();
  bell.name = 'r3.bellGroup';
  const bellPlate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.025), kitMat('r3.bellPlate', { color: '#d8d2c2', roughness: 0.4 }));
  const bellBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.015, 12).rotateX(Math.PI / 2), MATERIALS.emissive('#ff4a3a', 0.25));
  bellBtn.position.set(0, 0.015, 0.018);
  bell.add(bellPlate, bellBtn);
  bell.position.set(BELL[0], BELL[1], 0.07);
  ctx.add(bell);

  // 样片橱窗：玻璃 + 里面一块暖光的展板，挂着结婚照、百日照、全家福、毕业照
  const displayGlow: THREE.MeshStandardMaterial[] = [];
  const litPhotos = new THREE.MeshStandardMaterial({ map: atlasTex, emissive: '#ffffff', emissiveMap: atlasTex, emissiveIntensity: 0.55, roughness: 0.6 });
  litPhotos.name = 'r3.displayPhotos';
  displayGlow.push(litPhotos);
  // 展板：暗红丝绒，顶上藏着一排暖光（光照画进贴图里，MeshBasic，不吃场景灯）
  const backCloth = paintedMat(ctx, 256, 256, displayBack, { basic: true, name: 'r3.displayCloth' });
  const photos: { at: V3; w: number; h: number; rotY: number; cell: number }[] = [];
  const gilt = kitMat('r3:gilt', { color: '#a88a3a', roughness: 0.5, metalness: 0.6 });
  for (const [d, big, smalls] of [[DISPLAY.west, 1, [3, 9, 12]], [DISPLAY.east, 2, [4, 5, 13]]] as const) {
    const cx = (d.x0 + d.x1) / 2, zb = -DISPLAY.depth + 0.04;
    B.aabb(backCloth, d.x0, DISPLAY.y0, -DISPLAY.depth - 0.02, d.x1, DISPLAY.y1, -DISPLAY.depth + 0.02);
    B.aabb(kitMat('r3:velvet', { color: '#5a1418', roughness: 1 }), d.x0, DISPLAY.y0 - 0.02, -DISPLAY.depth, d.x1, DISPLAY.y0 + 0.02, 0);
    // 两侧与顶（从外看是深色的内壁）
    B.aabb(board, d.x0 - 0.02, DISPLAY.y0, -DISPLAY.depth, d.x0, DISPLAY.y1, 0);
    B.aabb(board, d.x1, DISPLAY.y0, -DISPLAY.depth, d.x1 + 0.02, DISPLAY.y1, 0);
    B.aabb(board, d.x0, DISPLAY.y1 - 0.02, -DISPLAY.depth, d.x1, DISPLAY.y1 + 0.02, 0);
    // 大照片
    const bw = 0.72, bh = 0.9, by = 1.72;
    photos.push({ at: [cx, by, zb + 0.012], w: bw, h: bh, rotY: 0, cell: big });
    B.aabb(gilt, cx - bw / 2 - 0.05, by - bh / 2 - 0.05, zb - 0.01, cx + bw / 2 + 0.05, by + bh / 2 + 0.05, zb + 0.008);
    // 三张小的，立在丝绒台上
    smalls.forEach((cell, i) => {
      const sx = d.x0 + 0.3 + i * ((d.x1 - d.x0 - 0.6) / 2), sw = 0.26, sh = 0.34;
      photos.push({ at: [sx, DISPLAY.y0 + 0.04 + sh / 2 + 0.03, -0.2 - i * 0.05], w: sw, h: sh, rotY: (i - 1) * -8, cell });
      B.box(gilt, sw + 0.05, sh + 0.05, 0.015, [sx, DISPLAY.y0 + 0.04 + sh / 2 + 0.03, -0.2 - i * 0.05 - 0.012], (i - 1) * -8);
    });
    // 顶上藏着的一根暖白灯管（只有灯管本身发光，不另加灯；展板的光画在贴图里）+ 挡光的铁皮
    B.aabb(MATERIALS.emissive('#ffe6c4', 1.3), d.x0 + 0.08, DISPLAY.y1 - 0.074, -0.135, d.x1 - 0.08, DISPLAY.y1 - 0.046, -0.105);
    B.aabb(alu, d.x0 + 0.04, DISPLAY.y1 - 0.045, -0.16, d.x1 - 0.04, DISPLAY.y1 - 0.02, -0.06);
    // 橱窗玻璃
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(d.x1 - d.x0, DISPLAY.y1 - DISPLAY.y0), MATERIALS.glass());
    glass.position.set(cx, (DISPLAY.y0 + DISPLAY.y1) / 2, 0.0);
    glass.userData.noOcclude = true;
    ctx.add(glass, { occlude: false });
    // 碰撞：橱窗整块
    ctx.collider.box([cx, 1.3, -DISPLAY.depth / 2], [d.x1 - d.x0 + 0.1, 2.6, DISPLAY.depth + 0.12]);
  }
  ctx.add(atlasQuads(photos, litPhotos));

  // 门脸碰撞（门洞 x -0.5~0.5 留给动态碰撞体）
  ctx.collider.box([(X0 - DOOR.w / 2) / 2, FACADE.groundH / 2, -0.12], [-DOOR.w / 2 - X0, FACADE.groundH, 0.4]);
  ctx.collider.box([(X1 + DOOR.w / 2) / 2, FACADE.groundH / 2, -0.12], [X1 - DOOR.w / 2, FACADE.groundH, 0.4]);
  ctx.collider.box([0, (DOOR.h + FACADE.groundH) / 2 + 0.02, -0.12], [DOOR.w + 0.1, FACADE.groundH - DOOR.h, 0.4]);
  // 屋里的地面（前厅、影棚、暗房一整块）
  ctx.collider.floor(X0, SHOP.back, X1, 0, 0);
  // 整栋楼（楼上）
  ctx.collider.box([0, (FACADE.groundH + topY) / 2, (0 + SHOP.back) / 2], [X1 - X0, topY - FACADE.groundH, -SHOP.back]);

  // ================================================================ 前厅（z 0 ~ -5）
  // 水磨石地面
  const terrazzo = paintTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#8f877a';
    g.fillRect(0, 0, w, h);
    const r = rng(81);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = r() < 0.5 ? `rgba(40,36,30,${range(r, 0.3, 0.8)})` : `rgba(230,225,210,${range(r, 0.3, 0.8)})`;
      const s = range(r, 1, 4);
      g.fillRect(r() * w, r() * h, s, s * range(r, 0.6, 1.2));
    }
    g.strokeStyle = 'rgba(30,26,20,0.5)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);
  }, { repeat: [1, 1] });
  ctx.track(terrazzo);
  const floorHall = new THREE.Mesh(new THREE.PlaneGeometry(SHOP.inEast - SHOP.inWest, 5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: terrazzo, roughness: 0.35, metalness: 0.05 }));
  const fuv = floorHall.geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * 5.8 / 0.9, fuv.getY(i) * 5 / 0.9);
  floorHall.position.set(0, 0.002, -2.5);
  floorHall.receiveShadow = true;
  floorHall.name = 'r3.hallFloor';
  ctx.add(floorHall);
  // 墙：石灰白 + 木墙裙
  B.aabb(lime, SHOP.inEast, 0, -5, SHOP.inEast + 0.45, SHOP.hallCeil, 0);
  B.aabb(lime, X0, 0, -5, GRID.x - 0.35, SHOP.hallCeil, 0);
  B.aabb(lime, GRID.x - 0.35, 0, GRID.z0, GRID.x, SHOP.hallCeil, 0);
  B.aabb(lime, GRID.x - 0.35, 0, -5, GRID.x, SHOP.hallCeil, GRID.z0 - GRID.n * GRID.cell);
  B.aabb(lime, GRID.x - 0.35, GRID.top, GRID.z0 - GRID.n * GRID.cell, GRID.x, SHOP.hallCeil, GRID.z0);
  B.aabb(lime, GRID.x - 0.35, 0, GRID.z0 - GRID.n * GRID.cell, GRID.x, GRID.top - GRID.n * GRID.cell, GRID.z0);
  B.aabb(wood, SHOP.inEast - 0.02, 0, -5, SHOP.inEast, 1.0, -0.05);
  B.aabb(darkWood, SHOP.inEast - 0.035, 0.98, -5, SHOP.inEast, 1.03, -0.05);
  // 顶棚
  B.aabb(plaster, X0, SHOP.hallCeil, -5, X1, SHOP.hallCeil + 0.1, 0);
  // 隔墙（前厅 | 影棚），西侧门洞挂布帘
  const pz = PARTITION.z;
  B.aabb(lime, SHOP.inWest, 0, pz - 0.075, PARTITION.doorX0, SHOP.studioCeil, pz + 0.075);
  B.aabb(lime, PARTITION.doorX1, 0, pz - 0.075, SHOP.inEast, SHOP.studioCeil, pz + 0.075);
  B.aabb(lime, PARTITION.doorX0, PARTITION.doorH, pz - 0.075, PARTITION.doorX1, SHOP.studioCeil, pz + 0.075);
  B.aabb(darkWood, PARTITION.doorX1, 0, pz + 0.075, SHOP.inEast, 1.0, pz + 0.095);
  ctx.collider.box([(SHOP.inWest + PARTITION.doorX0) / 2, 1.7, pz], [PARTITION.doorX0 - SHOP.inWest, 3.4, 0.15]);
  ctx.collider.box([(PARTITION.doorX1 + SHOP.inEast) / 2, 1.7, pz], [SHOP.inEast - PARTITION.doorX1, 3.4, 0.15]);
  // 布帘门楣与前厅顶棚的碰撞板（M4 第 2 轮：第三人称相机只躲碰撞体，低头时吊臂会钻进顶棚板里）；顶棚板补到楼上那块碰撞体的底
  ctx.collider.box([(PARTITION.doorX0 + PARTITION.doorX1) / 2, (PARTITION.doorH + SHOP.studioCeil) / 2, pz], [PARTITION.doorX1 - PARTITION.doorX0, SHOP.studioCeil - PARTITION.doorH, 0.15]);
  ctx.collider.box([0, (SHOP.hallCeil + FACADE.groundH) / 2, pz / 2], [X1 - X0, FACADE.groundH - SHOP.hallCeil, -pz]);
  // 布帘：蓝底碎花布条（中间分开，挡不住人）
  const curtain = paintedMat(ctx, 128, 256, (g, w, h) => {
    g.fillStyle = '#2c4a78';
    g.fillRect(0, 0, w, h);
    const r = rng(5);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = r() < 0.5 ? '#e8e0c8' : '#c8404a';
      g.beginPath();
      g.arc(r() * w, r() * h, range(r, 2, 5), 0, Math.PI * 2);
      g.fill();
    }
  }, { side: THREE.DoubleSide, roughness: 0.95, name: 'r3:curtain' });
  const cw = (PARTITION.doorX1 - PARTITION.doorX0) / 4;
  for (let i = 0; i < 4; i++) {
    const open = i === 1 || i === 2 ? (i === 1 ? -0.1 : 0.1) : 0;
    const m = B.plane(curtain, cw * 0.96, 1.25, [PARTITION.doorX0 + cw * (i + 0.5) + open, PARTITION.doorH - 0.63, pz + 0.09], 0);
    m.userData.noOcclude = true;
  }
  B.rod(alu, [PARTITION.doorX0, PARTITION.doorH - 0.02, pz + 0.09], [PARTITION.doorX1, PARTITION.doorH - 0.02, pz + 0.09], 0.012);

  // 柜台：木身 + 玻璃台面（台面下压着几张样片）
  const cz = COUNTER.z, cd = COUNTER.depth;
  B.aabb(wood, COUNTER.x0, 0, cz - cd / 2, COUNTER.x1, 0.88, cz + cd / 2);
  B.aabb(darkWood, COUNTER.x0 - 0.02, 0, cz + cd / 2, COUNTER.x1, 0.1, cz + cd / 2 + 0.02);
  B.aabb(darkWood, COUNTER.x0 - 0.03, 0.86, cz - cd / 2 - 0.03, COUNTER.x1, 0.9, cz + cd / 2 + 0.03);
  for (let x = COUNTER.x0 + 0.5; x < COUNTER.x1 - 0.2; x += 1.1) B.aabb(darkWood, x, 0.12, cz + cd / 2, x + 0.04, 0.86, cz + cd / 2 + 0.015);
  const counterGlass = new THREE.Mesh(new THREE.BoxGeometry(COUNTER.x1 - COUNTER.x0 - 0.06, 0.012, cd - 0.04), MATERIALS.glass());
  counterGlass.position.set((COUNTER.x0 + COUNTER.x1) / 2, 0.915, cz);
  counterGlass.userData.noOcclude = true;
  ctx.add(counterGlass, { occlude: false });
  const plainPhotos = new THREE.MeshStandardMaterial({ map: atlasTex, roughness: 0.55 });
  plainPhotos.name = 'r3:photos';
  const wallPhotos: { at: V3; w: number; h: number; rotY: number; cell: number }[] = [];
  for (let i = 0; i < 6; i++) wallPhotos.push({ at: [COUNTER.x0 + 0.4 + i * 0.62, 0.9, cz + range(rng(i), -0.1, 0.1)], w: 0.2, h: 0.26, rotY: 0, cell: (i * 5 + 2) % 16 });
  // 平放的照片：自己拼
  for (const p of wallPhotos) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), plainPhotos);
    const [u0, v0, u1, v1] = atlasUv(p.cell);
    const uv = m.geometry.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
    m.rotation.set(-Math.PI / 2, 0, range(rng(p.cell), -0.3, 0.3));
    m.position.set(p.at[0], 0.902, p.at[2]);
    B.add(m);
  }
  ctx.collider.box([(COUNTER.x0 + COUNTER.x1) / 2, 0.5, cz], [COUNTER.x1 - COUNTER.x0, 1.0, cd]);
  // 台面上：账本、笔筒、铁皮钱盒、台灯（关着）
  B.box(kitMat('r3:ledger', { color: '#2a3a5a', roughness: 0.8 }), 0.32, 0.03, 0.24, [0.3, 0.94, cz + 0.05], 8);
  B.box(kitMat('r3.ledgerPage', { color: '#e8e0c8', roughness: 0.9 }), 0.3, 0.005, 0.22, [0.3, 0.958, cz + 0.05], 8);
  B.cyl(kitMat('r3.penCup', { color: '#5a6a4a', roughness: 0.6 }), 0.04, 0.04, 0.12, [0.8, 0.98, cz - 0.12], 10);
  B.rod(kitMat('r3:pen', { color: '#1a1a1a', roughness: 0.5 }), [0.8, 1.0, cz - 0.12], [0.82, 1.1, cz - 0.1], 0.004);
  B.box(MATERIALS.tin(), 0.26, 0.09, 0.18, [1.5, 0.965, cz], -6);
  // 柜台后的货架：胶卷盒、相册、一只暖壶
  const shelfZ = pz + 0.28;
  for (const y of [1.25, 1.75]) B.aabb(darkWood, -0.9, y, shelfZ - 0.18, 2.8, y + 0.03, shelfZ + 0.18);
  const boxColors = ['#d8a818', '#2a7a3a', '#b3202a', '#1a4a8a', '#e8e0c8'];
  const r = rng(12);
  for (let i = 0; i < 22; i++) {
    const c = boxColors[i % boxColors.length] ?? '#888';
    const y = i < 11 ? 1.28 : 1.78;
    const x = -0.8 + (i % 11) * 0.3 + range(r, -0.05, 0.05);
    B.box(kitMat(`r3.filmBox${c}`, { color: c, roughness: 0.6 }), range(r, 0.1, 0.18), range(r, 0.08, 0.22), 0.14, [x, y + 0.08, shelfZ], range(r, -10, 10));
  }
  const thermos = PROPS.thermos();
  thermos.position.set(2.3, 0.9, cz - 0.1);
  ctx.add(thermos, { tempC: 18 });
  // 价目表（东墙，柜台边）
  const price = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.96), paintedMat(ctx, 384, 512, priceBoard, { roughness: 0.7 }));
  price.position.set(SHOP.inEast - 0.02, 1.95, -1.1);
  price.rotation.y = -Math.PI / 2;
  ctx.add(price);
  // 日历（柜台后隔墙上）
  const cal = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.5), paintedMat(ctx, 256, 376, calendar, { roughness: 0.9 }));
  cal.position.set(1.9, 2.25, pz + 0.085);
  ctx.add(cal);
  // 挂钟
  const clockFace = paintedMat(ctx, 256, 256, (g, w, h) => {
    g.fillStyle = '#efe8d8';
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#222';
    g.lineWidth = 6;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(w / 2 + Math.sin(a) * w * 0.4, h / 2 - Math.cos(a) * h * 0.4);
      g.lineTo(w / 2 + Math.sin(a) * w * 0.46, h / 2 - Math.cos(a) * h * 0.46);
      g.stroke();
    }
    // 停在十点零八分（陆师傅走那天没人上弦）
    const hand = (a: number, len: number, lw: number) => {
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(w / 2, h / 2);
      g.lineTo(w / 2 + Math.sin(a) * len, h / 2 - Math.cos(a) * len);
      g.stroke();
    };
    hand((10 + 8 / 60) / 12 * Math.PI * 2, w * 0.25, 10);
    hand((8 / 60) * Math.PI * 2, w * 0.38, 6);
  }, { roughness: 0.4 });
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), clockFace);
  clock.position.set(1.05, 2.62, pz + 0.098);
  ctx.add(clock);
  B.cyl(darkWood, 0.19, 0.19, 0.04, [1.05, 2.62, pz + 0.07], 24).rotation.x = Math.PI / 2;
  // 隔墙上的横灯箱“彩色扩印”（长明：陆师傅走了也没人关；隔着玻璃门从街上就看得见，只有灯箱片发光，不另加灯）
  {
    const bx0 = -0.85, bx1 = 0.45, by0 = 2.12, by1 = 2.46, bz = pz + 0.075;
    B.aabb(alu, bx0 - 0.03, by0 - 0.03, bz, bx1 + 0.03, by1 + 0.03, bz + 0.13);
    const tex = ctx.track(paintTexture(1024, 268, hallLightbox));
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.72, roughness: 0.45 });
    mat.name = 'r3.hallLightbox';
    mat.userData.tempC = 40;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(bx1 - bx0, by1 - by0), mat);
    face.position.set((bx0 + bx1) / 2, (by0 + by1) / 2, bz + 0.132);
    face.name = 'r3.hallLightbox';
    ctx.add(face, { tempC: 40 });
    B.rod(kitMat('r3:cord', { color: '#1a1a1a', roughness: 0.8 }), [bx1 + 0.03, by1 - 0.05, bz + 0.03], [bx1 + 0.3, SHOP.hallCeil, bz + 0.03], 0.005, 4);
  }

  // 东墙老照片墙（大大小小的镜框）
  const wallFrames: { at: V3; w: number; h: number; rotY: number; cell: number }[] = [];
  const fr = rng(33);
  let zc = -1.65;
  let k = 0;
  while (zc > -4.7) {
    const w = range(fr, 0.26, 0.52), h = w * range(fr, 1.1, 1.35);
    const col: number[] = [2.55 - h / 2 - range(fr, 0, 0.1)];
    if (h < 0.5) col.push(1.75 - h / 2);
    for (const y of col) {
      wallFrames.push({ at: [SHOP.inEast - 0.042, y, zc - w / 2], w, h, rotY: -90, cell: (k * 7 + 3) % 16 });
      B.box(darkWood, 0.03, h + 0.06, w + 0.06, [SHOP.inEast - 0.02, y, zc - w / 2]);
      k++;
    }
    zc -= w + range(fr, 0.1, 0.22);
  }
  ctx.add(atlasQuads(wallFrames, plainPhotos));

  // 候客长凳、花盆（发财树）、吊扇
  B.aabb(darkWood, 0.9, 0.42, -0.95, 2.6, 0.46, -0.6);
  for (const x of [1.0, 2.5]) B.aabb(darkWood, x - 0.03, 0, -0.93, x + 0.03, 0.42, -0.62);
  ctx.collider.box([1.75, 0.25, -0.78], [1.7, 0.5, 0.4]);
  B.cyl(kitMat('r3.bigPot', { color: '#6a3a2a', roughness: 0.8 }), 0.2, 0.16, 0.36, [-2.45, 0.18, -0.95], 12);
  const plant = shrub({ seed: 77 });
  plant.scale.set(0.7, 1.2, 0.7);
  plant.position.set(-2.45, 0.3, -0.95);
  ctx.add(plant);
  ctx.collider.box([-2.45, 0.4, -0.95], [0.5, 0.8, 0.5]);
  const fanMetal = kitMat('r3:fan', { color: '#d8d4c8', roughness: 0.5, metalness: 0.3 });
  B.rod(fanMetal, [0, SHOP.hallCeil, -1.6], [0, SHOP.hallCeil - 0.4, -1.6], 0.015);
  B.cyl(fanMetal, 0.1, 0.12, 0.1, [0, SHOP.hallCeil - 0.45, -1.6], 12);
  for (let i = 0; i < 3; i++) B.box(fanMetal, 0.62, 0.012, 0.12, [Math.cos((i * 2 * Math.PI) / 3) * 0.38, SHOP.hallCeil - 0.48, -1.6 + Math.sin((i * 2 * Math.PI) / 3) * 0.38], -i * 120);

  // 前厅钨丝吊灯（柜台西头上方：照着柜台，也照得到西墙的取件格）
  const hallLamp = lamp({ kind: 'tungsten_pendant', at: [-0.45, 2.3, -2.85], color: '#FFC98A', light: { design: 1.4, distance: 6.5 } });
  ctx.add(hallLamp.group);
  if (hallLamp.light) ctx.light(hallLamp.light);

  // ================================================================ 取件格（西墙 x = -2.9，10×10，每格 0.25）
  const grid = new THREE.Group();
  grid.name = 'r3.pickupGrid';
  const cubbyMat = paintedMat(ctx, 128, 128, cubbyBack, { roughness: 0.9 });
  const gz0 = GRID.z0, gz1 = GRID.z0 - GRID.n * GRID.cell, gy1 = GRID.top, gy0 = GRID.top - GRID.n * GRID.cell;
  const gx = GRID.x, depth = 0.32;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(gz0 - gz1, gy1 - gy0), cubbyMat);
  back.rotation.y = Math.PI / 2;
  back.position.set(gx - depth, (gy0 + gy1) / 2, (gz0 + gz1) / 2);
  grid.add(back);
  const slat = darkWood;
  const slats = new Batch('r3.gridSlats');
  for (let i = 0; i <= GRID.n; i++) {
    const y = gy1 - i * GRID.cell;
    slats.aabb(slat, gx - depth, y - 0.009, gz1, gx, y + 0.009, gz0);
    const z = gz0 - i * GRID.cell;
    slats.aabb(slat, gx - depth, gy0, z - 0.009, gx, gy1, z + 0.009);
  }
  // 外框
  slats.aabb(slat, gx - depth, gy1, gz1 - 0.05, gx + 0.03, gy1 + 0.08, gz0 + 0.05);
  slats.aabb(slat, gx - depth, gy0 - 0.08, gz1 - 0.05, gx + 0.03, gy0, gz0 + 0.05);
  slats.aabb(slat, gx - depth, gy0 - 0.08, gz0, gx + 0.03, gy1 + 0.08, gz0 + 0.05);
  slats.aabb(slat, gx - depth, gy0 - 0.08, gz1 - 0.05, gx + 0.03, gy1 + 0.08, gz1);
  for (const m of slats.flush(ctx, { parent: grid })) void m;
  ctx.add(grid, { ref: 'r3.pickup_grid' });
  // 编号层（透明底；取景器 ≥2× 换高清，ARCH §6.8.1）
  let numLo: THREE.Texture | null = null, numHi: THREE.Texture | null = null;
  const lo = () => (numLo ??= ctx.track(paintTexture(512, 512, gridNumbers(false))));
  const hi = () => (numHi ??= ctx.track(paintTexture(1536, 1536, gridNumbers(true), { anisotropy: 4 })));
  const numMat = new THREE.MeshStandardMaterial({ map: lo(), transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  numMat.name = 'r3.gridNumbers';
  const numbers = new THREE.Mesh(new THREE.PlaneGeometry(gz0 - gz1, gy1 - gy0), numMat);
  numbers.rotation.y = Math.PI / 2;
  numbers.position.set(gx + 0.004, (gy0 + gy1) / 2, (gz0 + gz1) / 2);
  numbers.userData.noOcclude = true;
  numbers.name = 'r3.gridNumbers';
  ctx.add(numbers, { occlude: false });
  ctx.hdText(numbers, lo, hi, { minZoom: 2, maxDist: 5 });
  // 取件格顶上的灯箱“取件处”（只有灯箱本身发光，不另加灯）
  const boxLen = gz0 - gz1 + 0.1, boxH = 0.2;
  B.aabb(alu, gx - 0.02, gy1 + 0.08, gz1 - 0.05, gx + 0.1, gy1 + 0.08 + boxH, gz0 + 0.05);
  const pickTex = ctx.track(paintTexture(1536, 96, pickupHeader));
  pickTex.anisotropy = 4;
  const pickMat = new THREE.MeshStandardMaterial({ map: pickTex, emissive: '#ffffff', emissiveMap: pickTex, emissiveIntensity: 0.75, roughness: 0.5 });
  pickMat.name = 'r3.pickupHeader';
  pickMat.userData.tempC = 45;
  const pickSign = new THREE.Mesh(new THREE.PlaneGeometry(boxLen - 0.04, boxH - 0.04), pickMat);
  pickSign.position.set(gx + 0.102, gy1 + 0.08 + boxH / 2, (gz0 + gz1) / 2);
  pickSign.rotation.y = Math.PI / 2;
  pickSign.name = 'r3.pickupHeader';
  ctx.add(pickSign, { tempC: 45 });
  // 每格一个拾取代理（ARCH §6.6：0.24×0.24 的薄盒，hitProxy 不渲染但能被射线命中）
  const holes: THREE.Mesh[] = [];
  const proxyGeo = new THREE.BoxGeometry(0.02, 0.24, 0.24);
  for (let n = 0; n < 100; n++) {
    const c = holeCenter(n);
    const m = new THREE.Mesh(proxyGeo, MATERIALS.hitProxy());
    m.position.set(c[0] + 0.005, c[1], c[2]);
    m.name = `r3.holeProxy${n}`;
    ctx.add(m, { occlude: false });
    holes.push(m);
  }
  ctx.track(proxyGeo);
  // 取件格不挡人（在墙里），墙的碰撞见上

  // 前厅碰撞：西墙（取件格在墙里）、东墙
  ctx.collider.box([(X0 + SHOP.inWest) / 2, 1.7, -2.5], [SHOP.inWest - X0, 3.4, 5]);
  ctx.collider.box([(X1 + SHOP.inEast) / 2, 1.7, -2.5], [X1 - SHOP.inEast, 3.4, 5]);

  contactShadows(ctx, [
    { x: (COUNTER.x0 + COUNTER.x1) / 2, z: COUNTER.z, rx: (COUNTER.x1 - COUNTER.x0) / 2 + 0.25, rz: 0.5, a: 0.7 },
    { x: 1.75, z: -0.78, rx: 0.95, rz: 0.3, a: 0.7 }, { x: -2.45, z: -0.95, rx: 0.3, rz: 0.3 },
    { x: -3.0, z: 0.45, rx: 0.3, rz: 0.3, a: 0.8 }, { x: 3.0, z: 0.45, rx: 0.3, rz: 0.3, a: 0.8 },
  ]);
  return { door: shopDoor, neon, neonLight, hallLamp, bell, holes, grid, displayGlow };
}
