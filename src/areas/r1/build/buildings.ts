// owner: R1-world
// 三栋楼与院外（GDD §4.1）：三号楼（南立面，一单元门在 (-8,-14)）、二号楼东立面（x=-20）、一号楼西立面（x=20），窗户几乎全黑；
// 院外人行道（东口→老街、西口→人民路地下通道）、马路、对面一排关了门的铺子（小卖部灯箱还亮着）、远处的楼。
// 楼体用 kit/building（窗户实例化）；碰撞体只给楼体整盒。

import * as THREE from 'three';
import type { AreaContext } from '../../../core/area';
import type { V3 } from '../../../core/types';
import { PALETTE } from '../../../data/palette';
import { MATERIALS } from '../../../fx/materials';
import { building } from '../../../kit/building';
import { PROPS } from '../../../kit/props';
import { lamp } from '../../../kit/lamps';
import type { LampRig } from '../../../kit/lamps';
import { paintTexture, blotch, grain } from '../../../kit/canvas';
import { FONT_STACK } from '../../../kit/text';
import { rng, range } from '../../../kit/rng';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { R1 } from '../layout';
import type { DecalAtlas } from './common';
import { DECAL, Statics, boardSign, canvasTex, mat, place, staticize } from './common';

type Built = ReturnType<typeof building>;

/** 楼体：窗户（InstancedMesh）交给 Statics 按贴图合并，晾衣绳交给 Statics 合成一条线；其余并进静态网格。 */
function addBuilding(ctx: AreaContext, st: Statics, b: Built, collide = true): void {
  b.group.updateMatrixWorld(true);
  for (const c of [...b.group.children]) {
    if ((c as THREE.InstancedMesh).isInstancedMesh) {
      b.group.remove(c);
      st.windows.push(c as THREE.InstancedMesh);
    }
  }
  const ropes: THREE.LineSegments[] = [];
  b.group.traverse(o => {
    if ((o as THREE.LineSegments).isLineSegments) ropes.push(o as THREE.LineSegments);
  });
  for (const r of ropes) {
    r.updateWorldMatrix(true, false);
    const wm = r.matrixWorld.clone();
    r.parent?.remove(r);
    wm.decompose(r.position, r.quaternion, r.scale);
    r.updateMatrixWorld(true);
    st.ropes.push(r);
  }
  st.add(b.group);
  if (collide) for (const c of b.colliders) ctx.collider.box(c.center, c.size);
}

/** 三号楼：南立面对着院子；一单元门、台阶、雨棚、门牌，墙上的红圈“拆”。 */
function building3(ctx: AreaContext, st: Statics, decals: DecalAtlas): void {
  const [ux, , uz] = R1.unitDoor;
  const b = building({
    ...R1.building3, floors: 5, facade: 'brick', faces: ['s', 'e', 'w'],
    windows: { w: 1.05, h: 1.3, spacing: 2.9, litRatio: 0.1, frame: 'wood', bars: true, litColor: '#FFE4C0' },
    balconies: true, clothesLines: 5, roof: 'parapet', seed: 3,
    doors: [{ w: 1.3, h: 2.2, style: 'unit', at: [ux, 0.12, uz], yaw: 180 }],
  });
  addBuilding(ctx, st, b);
  const concrete = MATERIALS.concrete();
  // 门口的平台（0.12，走得上去）、雨棚、门牌
  st.box(3.4, 0.12, 1.05, concrete, [ux, 0.06, uz + 0.525]);
  st.box(2.6, 0.1, 1.3, concrete, [ux, 2.62, uz + 0.65]);
  st.box(0.08, 0.3, 1.2, concrete, [ux - 1.26, 2.52, uz + 0.6]);
  st.box(0.08, 0.3, 1.2, concrete, [ux + 1.26, 2.52, uz + 0.6]);
  boardSign(ctx, st, { text: '3号楼 1单元', style: 'painted', w: 0.7, h: 0.22, at: [ux + 1.0, 2.25, uz + 0.05], yaw: 180, color: '#F2EEE2', bg: '#2E4F7A', depth: 0.02 });
  // 门边的电表箱、小广告、福字、旧对联；楼上的大“3”与红圈“拆”
  const meter = mat('meterBox', { color: '#8E948C', roughness: 0.5, metalness: 0.35 });
  st.box(0.5, 0.6, 0.16, meter, [ux - 1.75, 1.7, uz + 0.08]);
  decals.quad(DECAL.meterPlate, [ux - 1.75, 1.55, uz + 0.162], 0.26, 0.26, 180);
  decals.quad(DECAL.postersA, [ux + 1.9, 1.15, uz + 0.012], 1.1, 1.1, 180, 3);
  decals.quad(DECAL.postersC, [ux - 2.6, 1.0, uz + 0.012], 0.9, 0.9, 180, -2);
  decals.quad(DECAL.oldCouplet, [ux, 1.2, uz + 0.08], 1.9, 2.2, 180);
  decals.quad(DECAL.number3, [4.2, 12.4, uz + 0.012], 1.6, 1.6, 180);
  decals.quad(DECAL.chai, [-15.5, 2.2, uz + 0.012], 2.4, 2.4, 180, 5);
  decals.quad(DECAL.chai, [0.5, 2.0, uz + 0.012], 2.2, 2.2, 180, -6);
  decals.quad(DECAL.stainStreak, [-3, 13.4, uz + 0.012], 4.0, 1.6, 180);
  decals.quad(DECAL.stainStreak, [-18, 13.4, uz + 0.012], 3.0, 1.4, 180);
  decals.quad(DECAL.chalkChai, [ux - 3.4, 0.8, uz + 0.013], 0.9, 0.9, 180);
  // 靠墙的一辆自行车
  st.add(place(PROPS.bicycle(9), [ux + 3.2, 0, uz + 0.45], 95));
}

/** 东北角的锅炉房与大烟囱（院子北边的地标：雾里一根黑柱子，顶上一盏红色障碍灯）。 */
function boilerHouse(ctx: AreaContext, st: Statics, decals: DecalAtlas): void {
  const b = building({ x0: 7, x1: 19.5, z0: -27, z1: -16.3, floors: 2, floorH: 3.4, facade: 'brick', faces: ['s', 'w'], roof: 'flat', seed: 61,
    windows: { w: 1.6, h: 1.1, spacing: 3.6, litRatio: 0.0, frame: 'steel', bars: true } });
  addBuilding(ctx, st, b, false);
  const brick = MATERIALS.brick();
  const cx = 16.5, cz = -22;
  st.cyl(0.75, 1.15, 24, brick, [cx, 12, cz], 16);
  st.cyl(0.8, 0.8, 0.5, MATERIALS.concrete(), [cx, 24.2, cz], 16);
  for (let i = 1; i < 6; i++) st.cyl(1.16 - i * 0.068, 1.16 - i * 0.068, 0.12, MATERIALS.concrete(), [cx, i * 4, cz], 16);
  const warn = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), MATERIALS.emissive('#FF2A1A', 2));
  warn.position.set(cx, 24.6, cz);
  ctx.add(warn, { occlude: false });
  decals.quad(DECAL.chai, [13, 2.4, -16.3 + 0.012], 2.2, 2.2, 180, -4);
  decals.quad(DECAL.stainStreak, [10, 6.4, -16.3 + 0.012], 3, 1.2, 180);
}

/** 二号楼（东立面 x=-20）与一号楼（西立面 x=20）。 */
function sideBuildings(ctx: AreaContext, st: Statics, decals: DecalAtlas): void {
  const x2 = R1.building2FacadeX, x1 = R1.building1FacadeX;
  const b2 = building({
    x0: x2 - 12, x1: x2, z0: -14, z1: 24.3, floors: 5, facade: 'plaster', faces: ['e', 's'],
    // 二号楼那几扇亮窗是日光灯/电视的冷白（与三号楼的暖黄错开色温）
    windows: { w: 1.1, h: 1.3, spacing: 3.1, litRatio: 0.09, frame: 'steel', litColor: '#E4ECFF' },
    balconies: true, clothesLines: 3, roof: 'flat', seed: 21,
    doors: [{ w: 1.2, h: 2.2, style: 'security', at: [x2, 0, 1.5], yaw: 90 }],
  });
  addBuilding(ctx, st, b2);
  const b1 = building({
    x0: x1, x1: x1 + 12, z0: -12, z1: 21, floors: 5, facade: 'brick', faces: ['w', 's'],
    windows: { w: 1.1, h: 1.3, spacing: 3.0, litRatio: 0.11, frame: 'wood', bars: true, litColor: '#FFE9CC' },
    balconies: true, clothesLines: 4, roof: 'parapet', seed: 17,
    doors: [{ w: 1.2, h: 2.2, style: 'security', at: [x1, 0, 0.5], yaw: 270 }],
  });
  addBuilding(ctx, st, b1);
  decals.quad(DECAL.chai, [x2 + 0.012, 2.3, -4], 2.4, 2.4, 90, 4);
  decals.quad(DECAL.chaiFaded, [x2 + 0.012, 5.4, 9], 2.0, 2.0, 90);
  decals.quad(DECAL.postersB, [x2 + 0.013, 1.1, 3.4], 1.0, 1.0, 90);
  decals.quad(DECAL.fu, [x2 + 0.014, 1.5, 1.5], 0.35, 0.35, 90);
  decals.quad(DECAL.chai, [x1 - 0.012, 2.4, 6], 2.4, 2.4, 270, -5);
  decals.quad(DECAL.postersA, [x1 - 0.013, 1.1, -2.5], 1.0, 1.0, 270, 2);
  decals.quad(DECAL.fu, [x1 - 0.014, 1.5, 0.5], 0.35, 0.35, 270);
  decals.quad(DECAL.stainStreak, [x1 - 0.012, 13.4, 2], 4.0, 1.8, 270);
  // 空调外机（挂在窗下）
  const ac = mat('acUnit', { color: '#C9C6BC', roughness: 0.6 });
  const r = rng(12);
  for (let i = 0; i < 7; i++) {
    const z = range(r, -10, 12), fl = 1 + Math.floor(r() * 4);
    st.box(0.28, 0.5, 0.75, ac, [x1 - 0.14, fl * 2.8 + 0.6, z]);
    st.box(0.28, 0.5, 0.75, ac, [x2 + 0.14, fl * 2.8 + 0.6, range(r, -12, 14)]);
  }
}

/** 院外的路灯：灯罩共用的自发光材质（本区私有的一份）与两盏带湿地光带的（天亮了 logic.ts 把它们关掉）。 */
export interface StreetLamps { glow: THREE.MeshStandardMaterial; glowBase: number; rigs: LampRig[] }

/** 院外：人行道、护栏、马路、对面的铺子、路灯（只有灯罩）、东口/西口的指路牌与地下通道口。 */
function street(ctx: AreaContext, st: Statics, decals: DecalAtlas): StreetLamps {
  const sw = R1.sidewalk;
  const concrete = MATERIALS.concrete();
  // 人行道（方砖）
  const paving = canvasTex(ctx, 512, 512, (g, w, h) => {
    g.fillStyle = '#6a6862';
    g.fillRect(0, 0, w, h);
    const r = rng(3);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const v = Math.round(range(r, 88, 118));
      g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
      g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
      if (r() < 0.25) blotch(g, r, x * 128 + 64, y * 128 + 64, 40, '#2a2a28', 0.35, 6);
    }
    grain(g, w, h, 0.25, 4);
  });
  paving.wrapS = paving.wrapT = THREE.RepeatWrapping;
  paving.repeat.set((sw.x1 - sw.x0 + 4) / 2, (sw.z1 - sw.z0 + 0.3) / 2);
  const pave = new THREE.Mesh(new THREE.PlaneGeometry(sw.x1 - sw.x0 + 4, sw.z1 - sw.z0 + 0.3).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: paving, roughness: 0.42, metalness: 0.05 }));
  pave.position.set(0, 0.006, (sw.z0 + sw.z1) / 2 + 0.25);
  ctx.add(pave);
  // 路沿、护栏（挡人）、马路（低 0.14）、对面人行道
  const zc = sw.z1 + 0.5;
  st.box(sw.x1 - sw.x0 + 30, 0.2, 0.3, concrete, [0, 0.0, zc]);
  const rail = mat('railing', { color: '#D8D6CC', roughness: 0.5, metalness: 0.4 });
  const railG = mat('railingGreen', { color: '#2F6B4A', roughness: 0.5, metalness: 0.4 });
  for (let x = sw.x0 - 1; x <= sw.x1 + 1; x += 2) st.box(0.06, 1.0, 0.06, rail, [x, 0.5, zc - 0.08]);
  st.box(sw.x1 - sw.x0 + 2, 0.06, 0.05, railG, [0, 0.98, zc - 0.08]);
  st.box(sw.x1 - sw.x0 + 2, 0.04, 0.04, railG, [0, 0.45, zc - 0.08]);
  ctx.collider.wall([sw.x0 - 2, zc - 0.08], [sw.x1 + 2, zc - 0.08], 0, 1.2, 0.2);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(90, 9).rotateX(-Math.PI / 2), MATERIALS.asphaltWet());
  road.position.set(0, -0.14, zc + 4.6);
  st.add(road);
  // 马路中线（白色虚线）
  const dash = mat('roadPaint', { color: '#BDBAB0', roughness: 0.6 });
  for (let x = -40; x < 40; x += 4) st.box(2, 0.01, 0.12, dash, [x, -0.132, zc + 4.6]);
  st.box(90, 0.2, 0.3, concrete, [0, -0.04, zc + 9.2]);
  st.floor(-45, zc + 9.3, 45, zc + 12, 0.0, concrete);
  // 一号楼南边到老街口之间的一段院墙（西边是二号楼的南山墙）
  st.box(sw.x1 + 1.4 - 20, 2.5, 0.24, MATERIALS.brick(), [(20 + sw.x1 + 1.4) / 2, 1.25, 24.12]);
  st.box(sw.x1 + 1.4 - 20 + 0.06, 0.08, 0.34, concrete, [(20 + sw.x1 + 1.4) / 2, 2.54, 24.12]);
  decals.quad(DECAL.postersB, [22.8, 1.15, 24.25], 1.0, 1.0, 180, 3);
  // 两头：西口地下通道（台阶往下走）、东口老街；挡人的墙在触发体外侧
  const wx = sw.x0 - 1.3;
  ctx.collider.wall([wx, sw.z0 - 1], [wx, zc], 0, 3, 0.3);
  ctx.collider.wall([sw.x1 + 1.3, sw.z0 - 1], [sw.x1 + 1.3, zc], 0, 3, 0.3);
  const stepM = mat('stairStone', { color: '#6f6d68', roughness: 0.85 });
  for (let i = 0; i < 12; i++) st.box(0.32, 0.3, 2.6, stepM, [wx - 0.16 - i * 0.3, -0.15 - i * 0.16, 27]);
  const green = mat('underpassFrame', { color: '#2E5E48', roughness: 0.5, metalness: 0.45 });
  for (const z of [25.55, 28.45]) {
    st.box(4.2, 1.0, 0.12, concrete, [wx - 2.0, 0.5, z]);
    st.box(4.2, 0.06, 0.08, green, [wx - 2.0, 1.1, z]);
  }
  for (const [x, z] of [[wx + 0.1, 25.55], [wx + 0.1, 28.45], [wx - 3.9, 25.55], [wx - 3.9, 28.45]] as const) st.box(0.1, 2.9, 0.1, green, [x, 1.45, z]);
  st.box(4.4, 0.1, 3.2, green, [wx - 1.9, 2.95, 27]);
  boardSign(ctx, st, { text: '人民路地下通道', style: 'lightbox', w: 2.4, h: 0.42, at: [wx + 0.2, 2.62, 27], yaw: 90, color: '#F4F1E6', bg: '#1E5A8C', glow: 2.0 });
  // 东口：老街的路牌
  const blue = mat('roadSignPole', { color: '#5E6670', roughness: 0.45, metalness: 0.6 });
  st.box(0.07, 2.8, 0.07, blue, [sw.x1 + 0.6, 1.4, 29.6]);
  // 两块路牌是反光膜：暖白字、字面微微自发光，钠灯雨夜里也读得出（M4 第 2 轮：原来纯漫反射，蓝底白字在钠灯下读成一块暗板，P6 找不着老街）
  boardSign(ctx, st, { text: '老街 →', style: 'painted', w: 1.1, h: 0.32, at: [sw.x1 + 0.56, 2.55, 29.6], yaw: 270, color: '#FFF3DC', bg: '#1C4E8C', depth: 0.02, selfLit: 0.6 });
  st.box(0.07, 2.8, 0.07, blue, [sw.x0 - 0.6, 1.4, 29.6]);
  boardSign(ctx, st, { text: '← 人民路', style: 'painted', w: 1.1, h: 0.32, at: [sw.x0 - 0.56, 2.55, 29.6], yaw: 90, color: '#FFF3DC', bg: '#1C4E8C', depth: 0.02, selfLit: 0.6 });
  // 东口外老街的一角：矮房子（只建朝西的面）
  const oldSt = building({ x0: sw.x1 + 1.5, x1: sw.x1 + 9, z0: 22, z1: 40, floors: 2, floorH: 3, facade: 'plaster', faces: ['w'], windows: { w: 1.2, h: 1.2, spacing: 3.4, litRatio: 0.2, frame: 'wood' }, roof: 'flat', seed: 41 });
  addBuilding(ctx, st, oldSt, false);

  // 人行道上：报刊亭、邮筒、公交站（对面）
  st.add(place(PROPS.kiosk(), [18.5, 0, 29.4], 0));
  ctx.collider.box([18.5, 1.2, 29.4], [2.1, 2.4, 1.6]);
  st.add(place(PROPS.mailbox(), [-10.5, 0, 29.7], 0));
  ctx.collider.box([-10.5, 0.6, 29.7], [0.6, 1.2, 0.6]);
  st.add(place(PROPS.busStop(), [-4, 0, zc + 10.2], 0));
  decals.ground(DECAL.noParking, 2.0, 25.6, 1.4, 1.4, 0);

  // 对面一排关了门的铺子（卷帘门）与楼上的住家
  // （街对面不是槐安里：铺子楼上住着人，半夜还有两成亮窗）
  const shops = building({ x0: -45, x1: 45, z0: zc + 12, z1: zc + 22, floors: 4, facade: 'tile', faces: ['n'], windows: { w: 1.2, h: 1.3, spacing: 3.2, litRatio: 0.22, frame: 'steel', litColor: '#FFF1DE' }, roof: 'flat', seed: 31 });
  addBuilding(ctx, st, shops, false);
  const shutter = paintTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#8E9196';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 10) {
      g.fillStyle = '#62666b';
      g.fillRect(0, y, w, 3);
    }
    const r = rng(8);
    for (let i = 0; i < 9; i++) blotch(g, r, r() * w, range(r, 0.5, 1) * h, range(r, 6, 18), '#6b4a2a', 0.35, 4);
    g.fillStyle = 'rgba(200,30,30,0.7)';
    g.font = `bold ${Math.round(h * 0.12)}px ${FONT_STACK}`;
    g.fillText('旺铺转让', w * 0.2, h * 0.55);
  }, { repeat: [1, 1] });
  const shutterMat = new THREE.MeshStandardMaterial({ map: ctx.track(shutter), roughness: 0.5, metalness: 0.4 });
  const fz = zc + 12 - 0.04;
  const signs: { t: string; style: 'lightbox' | 'painted'; color?: string; bg?: string; lit: boolean }[] = [
    { t: '小卖部', style: 'lightbox', color: '#C8141B', bg: '#F4F0E0', lit: true },
    { t: '早点铺', style: 'painted', color: '#8A1C1C', bg: '#E8D8B0', lit: false },
    { t: '修表 配钥匙', style: 'painted', color: '#1B3A6A', bg: '#D8D2C0', lit: false },
    { t: '烟酒 副食', style: 'lightbox', color: '#1E4E9A', bg: '#F2EEE0', lit: true },
    { t: '理发', style: 'painted', color: '#F2EEE2', bg: '#5A2A22', lit: false },
    { t: '大药房', style: 'lightbox', color: '#157A3A', bg: '#F2F2EA', lit: true },
  ];
  signs.forEach((s, i) => {
    const x = -16 + i * 6.4;
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.5).rotateY(Math.PI), shutterMat);
    sh.position.set(x, 1.3, fz);
    ctx.add(sh);
    boardSign(ctx, st, { text: s.t, style: s.style === 'lightbox' ? 'lightbox' : 'painted', w: 3.2, h: 0.7, at: [x, 3.05, fz - 0.1], yaw: 0, color: s.color ?? '#222', bg: s.bg ?? '#ddd', on: s.lit, glow: 2.1 });
  });
  // 药房门口的绿十字（霓虹，常亮）
  const cross = new THREE.Group();
  const cm = MATERIALS.emissive('#2FE07A', 1.2);
  cross.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.06), cm), new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.06), cm));
  cross.position.set(-16 + 5 * 6.4 + 2.2, 2.4, fz - 0.4);
  ctx.add(cross);

  // 路灯：只有灯罩（远灯靠 Bloom 出光，GDD §9.3）；人行道上的两盏在湿地面上拖一条光带
  const poles: { at: V3; rot: number; streak: boolean }[] = [
    // 人行道上两盏夹着院门（从院里望出去、从街上望进来都在画里）
    { at: [-5.3, 0, sw.z1 + 0.2], rot: 0, streak: true },
    { at: [5.9, 0, sw.z1 + 0.2], rot: 0, streak: true },
    { at: [-30, 0, zc + 9.8], rot: 0, streak: false },
    { at: [4, 0, zc + 9.8], rot: 0, streak: false },
    { at: [36, 0, zc + 9.8], rot: 0, streak: false },
  ];
  // 只有灯罩的路灯：灯罩共用一份自发光材质（与 kit 钠灯灯罩同亮度 8），整盏并进静态网格；湿地光带单独留着（它每帧转向相机）。
  // 材质是本区克隆的一份（M4：尾声的上午要关灯；MATERIALS.emissive 是全局共享实例，改了会漏到别的区与下一局）
  const farGlow = ctx.track(MATERIALS.emissive(PALETTE.SODIUM, 8 / 3.5).clone());
  farGlow.name = 'r1w.streetGlow';
  const rigs: LampRig[] = [];
  for (const p of poles) {
    const l = lamp({ kind: 'sodium_pole', at: p.at, light: false, wetStreak: p.streak });
    l.group.rotation.y = p.rot;
    l.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material).name === 'lampGlow') m.material = farGlow;
    });
    staticize(l.group, st, m => m.name === 'wetStreak');
    if (p.streak) {
      ctx.add(l.group, { occlude: false });
      rigs.push(l);
    }
    if (p.streak) ctx.collider.box([p.at[0], 1.5, p.at[2]], [0.36, 3, 0.36]);
  }
  // 电线杆与横过马路、搭进院子的电线（一条 LineSegments）
  const poleM = mat('utilityPole', { color: '#77756f', roughness: 0.9 });
  /** 人行道西段那根电线杆的 x（院门两侧留给两盏路灯） */
  const UP = -12.6;
  const utilPoles: V3[] = [[UP, 0, sw.z1 + 0.15], [22, 0, sw.z1 + 0.15], [UP, 0, zc + 9.6], [22, 0, zc + 9.6]];
  for (const p of utilPoles) {
    st.cyl(0.11, 0.15, 8, poleM, [p[0], 4, p[2]], 8);
    st.box(1.4, 0.1, 0.1, poleM, [p[0], 7.4, p[2]]);
  }
  ctx.collider.box([UP, 1.5, sw.z1 + 0.15], [0.3, 3, 0.3]);
  ctx.collider.box([22, 1.5, sw.z1 + 0.15], [0.3, 3, 0.3]);
  const spans: { a: V3; b: V3; sag: number }[] = [];
  for (const dx of [-0.6, 0, 0.6]) {
    spans.push({ a: [UP + dx, 7.45, sw.z1 + 0.15], b: [22 + dx, 7.45, sw.z1 + 0.15], sag: 0.9 });
    spans.push({ a: [UP + dx, 7.45, sw.z1 + 0.15], b: [UP + dx, 7.45, zc + 9.6], sag: 0.6 });
    spans.push({ a: [22 + dx, 7.45, sw.z1 + 0.15], b: [22 + dx, 7.45, zc + 9.6], sag: 0.6 });
  }
  spans.push({ a: [UP, 7.2, sw.z1 + 0.15], b: [-6.4, 3.1, 21.3], sag: 0.6 });
  spans.push({ a: [UP, 7.0, sw.z1 + 0.15], b: [-20, 9.5, 14], sag: 1.2 });
  spans.push({ a: [22, 7.0, sw.z1 + 0.15], b: [20, 9.8, 10], sag: 1.1 });
  spans.push({ a: [-20, 11.5, -6], b: [-22, 12.5, -14.2], sag: 0.7 });
  spans.push({ a: [20, 11.5, -4], b: [6, 13.5, -14.2], sag: 1.6 });
  spans.push({ a: [-20, 10, 4], b: [20, 10.5, 2], sag: 2.4 });
  st.spans.push(...spans);
  return { glow: farGlow, glowBase: farGlow.emissiveIntensity, rigs };
}

/** 远景的材质句柄（logic.ts 的天色过渡改它们：卯时剪影变成晨雾里的灰蓝、亮窗淡下去）。 */
export interface FarSkyline { silhouette: THREE.MeshBasicMaterial; windows: THREE.MeshBasicMaterial }
/** 夜里远景剪影的颜色：比天顶还暗一点（雾里的楼是比天暗的剪影，look-dev §8.3） */
export const FAR_NIGHT = '#080B14';
/** 远处亮窗的 HDR 倍数 */
export const FAR_WIN_GLOW = 1.5;

/**
 * 远景：院子外面一圈几乎全黑的高楼。雾 0.045 下 40m 外什么都不剩，用 kit 的楼会变成比天还亮的雾色方块，
 * 所以这里画成不受雾影响的纯色剪影（比天暗）+ 稀稀拉拉几扇亮窗（也不受雾，远远地一点暖光）：一个网格加一个窗户网格，两个 draw call。
 */
function skyline(ctx: AreaContext): FarSkyline {
  // 高度压在院子里看过去的地平线光带里（仰角 ≲ 20°），剪影才读得出“比天暗”；再远一圈两栋高的
  const far = [
    { x0: -40, x1: -18, z0: -64, z1: -52, h: 24, face: 's', seed: 51, lit: 0.05 },
    { x0: 10, x1: 34, z0: -60, z1: -48, h: 27, face: 's', seed: 52, lit: 0.04 },
    { x0: 48, x1: 58, z0: -30, z1: 10, h: 21, face: 'w', seed: 53, lit: 0.05 },
    { x0: -60, x1: -50, z0: -22, z1: 18, h: 19, face: 'e', seed: 54, lit: 0.05 },
    { x0: -22, x1: 12, z0: 82, z1: 92, h: 27, face: 'n', seed: 55, lit: 0.04 },
    { x0: 36, x1: 52, z0: -66, z1: -56, h: 17, face: 's', seed: 56, lit: 0.06 },
    { x0: -66, x1: -52, z0: 40, z1: 52, h: 18, face: 'e', seed: 57, lit: 0.05 },
    { x0: -14, x1: 2, z0: -122, z1: -110, h: 48, face: 's', seed: 58, lit: 0.03 },
    { x0: 58, x1: 70, z0: 30, z1: 60, h: 40, face: 'w', seed: 59, lit: 0.03 },
  ] as const;
  const boxes: THREE.BufferGeometry[] = [];
  const quads: number[] = [], cols: number[] = [];
  const warm = [new THREE.Color('#FFD9A8'), new THREE.Color('#FFE8C8'), new THREE.Color('#DDE8FF'), new THREE.Color('#FFC890')];
  for (const f of far) {
    const w = f.x1 - f.x0, d = f.z1 - f.z0;
    boxes.push(new THREE.BoxGeometry(w, f.h, d).translate((f.x0 + f.x1) / 2, f.h / 2, (f.z0 + f.z1) / 2));
    // 屋顶上的水箱、天线架（剪影的轮廓不那么死板）
    const r = rng(f.seed);
    for (let i = 0; i < 3; i++) {
      const tw = range(r, 1.5, 4), th = range(r, 1.5, 3.5);
      boxes.push(new THREE.BoxGeometry(tw, th, tw).translate(range(r, f.x0 + 2, f.x1 - 2), f.h + th / 2, range(r, f.z0 + 2, f.z1 - 2)));
    }
    boxes.push(new THREE.BoxGeometry(0.25, 6, 0.25).translate(range(r, f.x0 + 1, f.x1 - 1), f.h + 3, range(r, f.z0 + 1, f.z1 - 1)));
    // 亮窗：沿看得见的那一面，每层一排
    const along = f.face === 's' || f.face === 'n' ? w : d;
    const nCol = Math.floor((along - 2) / 3.3), nRow = Math.floor((f.h - 4) / 2.9);
    for (let row = 0; row < nRow; row++) for (let c = 0; c < nCol; c++) {
      if (r() > f.lit) continue;
      const t = 1 + c * 3.3 + 1.1, y = 2 + row * 2.9 + 0.7;
      const col = warm[Math.floor(r() * warm.length)]!;
      let x = 0, z = 0, ux = 0, uz = 0;
      if (f.face === 's') { x = f.x0 + t; z = f.z1 + 0.05; ux = 1; }
      else if (f.face === 'n') { x = f.x1 - t; z = f.z0 - 0.05; ux = -1; }
      else if (f.face === 'e') { x = f.x1 + 0.05; z = f.z1 - t; uz = -1; }
      else { x = f.x0 - 0.05; z = f.z0 + t; uz = 1; }
      const hw = 0.42, hh = 0.55;
      const p = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, -hh], [hw, hh], [-hw, hh]] as const;
      for (const [a, b] of p) {
        quads.push(x + ux * a, y + b, z + uz * a);
        cols.push(col.r, col.g, col.b);
      }
    }
  }
  const sil = new THREE.MeshBasicMaterial({ color: FAR_NIGHT, fog: false });
  sil.userData.tempC = 16;
  const merged = mergeGeometries(boxes.map(g => g.toNonIndexed()));
  for (const g of boxes) g.dispose();
  const silMesh = new THREE.Mesh(ctx.track(merged), ctx.track(sil));
  silMesh.name = 'farSkyline';
  silMesh.userData.irHide = true;
  silMesh.userData.noOcclude = true;
  silMesh.raycast = () => {};
  ctx.add(silMesh, { occlude: false });
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(quads, 3));
  wg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const winMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
  winMat.color.setScalar(FAR_WIN_GLOW);
  winMat.userData.tempC = 20;
  const winMesh = new THREE.Mesh(ctx.track(wg), ctx.track(winMat));
  winMesh.name = 'farWindows';
  winMesh.userData.irHide = true;
  winMesh.userData.noOcclude = true;
  winMesh.raycast = () => {};
  ctx.add(winMesh, { occlude: false });
  return { silhouette: sil, windows: winMat };
}

export function buildBuildings(ctx: AreaContext, st: Statics, decals: DecalAtlas): { far: FarSkyline; street: StreetLamps } {
  building3(ctx, st, decals);
  sideBuildings(ctx, st, decals);
  boilerHouse(ctx, st, decals);
  const lamps = street(ctx, st, decals);
  return { far: skyline(ctx), street: lamps };
}
