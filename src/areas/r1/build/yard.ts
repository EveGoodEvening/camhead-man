// owner: R1-world
// 院子（GDD §4.1）：古槐（树冠压顶、挂彩灯）与树池、土地庙、土地的马扎、蚁穴、石桌、车棚与自行车、公告栏（讣告被拆迁公告盖住下半截）、
// 小区简介牌、火盆、院门（铁链锁）与门灯的安装位、院墙、晾衣竿、花盆杂物；取景器里的湿脚印与残影点旋涡、红外冷迹。

import * as THREE from 'three';
import type { AreaContext } from '../../../core/area';
import type { V3, XZ } from '../../../core/types';
import { F, OBJ } from '../../../data/ids';
import { PALETTE } from '../../../data/palette';
import { TEMP_C } from '../../../data/render';
import { MATERIALS } from '../../../fx/materials';
import { PROPS } from '../../../kit/props';
import { door } from '../../../kit/doors';
import type { DoorRig } from '../../../kit/doors';
import { huaiTree } from '../../../kit/nature';
import { createResidueVortex, createFootprints, createColdTrace } from '../../../kit/residue';
import { paintTexture, wrapText, agePaper, grain, SERIF_FONT_STACK } from '../../../kit/canvas';
import { FONT_STACK } from '../../../kit/text';
import { rng, range } from '../../../kit/rng';
import { R1 } from '../layout';
import { REF_SHRINE } from '../replay';
import { mergeByMaterial } from '../../../kit/geom';
import { DEMOLITION, ESTATE_SIGN, OBITUARY, READ, WATER_NOTICE } from '../text';
import type { DecalAtlas } from './common';
import { DECAL, Statics, boardSign, canvasTex, mat, place } from './common';
import { FADED_GLOW, FADED_INK, paperSheet } from './booth';

// ==================================================================== 常量

/** 院墙（砖墙 2.2m + 水泥压顶）：南墙在 z=24，院门 x:-3~3。 */
export const YARD_WALL = { h: 2.2, t: 0.24, south: 24, west: -20, east: 20 } as const;
/** 院门立柱中心（kit 的 iron_gate：w/2 + 0.23）。 */
const GATE_W = R1.gate.x1 - R1.gate.x0;
export const GATE_PILLAR_X = GATE_W / 2 + 0.23;
/** 门灯灯具挂点：东立柱朝北的面上（灯泡在 GDD 的 (3.5,·,23.4) 附近）。 */
export const GATE_LAMP_MOUNT: V3 = [3.3, 2.62, R1.gate.z - 0.225];
/** 公告栏（正面朝北）与板面上的几处位置。 */
const NB = { x: R1.noticeBoard[0], z: R1.noticeBoard[2], w: 2.4, h: 1.2, cy: 1.5 } as const;
/** 讣告被盖住的下半截（rd.obituary_hidden 的读字点）。 */
export const OBITUARY_HIDDEN_AT: V3 = [NB.x - 0.42, NB.cy - 0.22, NB.z - 0.05];
/** 车棚 */
const SHED = R1.shed;
/** 车棚灯（开关①）与公告栏灯（开关②）的灯泡位置。 */
export const SHED_LAMP_AT: V3 = [12.6, 2.18, -6.2];
export const BOARD_LAMP_AT: V3 = [NB.x, 2.12, NB.z - 0.32];
/** 积水夜里的颜色 */
export const PUDDLE_NIGHT = '#20242a';
/** 土地的马扎（土地坐在上面；常光下只见空马扎与灯笼）。 */
export const TUDI_STOOL_YAW = 200;

export interface YardHandles {
  gate: DoorRig;
  chain: THREE.Object3D | null;
  gateHit: THREE.Object3D;
  anthill: THREE.Mesh;
  shrineHit: THREE.Mesh;
  boardHit: THREE.Mesh;
  estateHit: THREE.Mesh;
  brazierHit: THREE.Mesh;
  burnFx: THREE.Group;
  stringLightAnchors: { at: V3; rotY: number }[];
  /** 红外冷迹（layer.ir_only 的人形）：r1.cold_chair / r1.cold_steps 的 hit */
  coldChair: THREE.Object3D;
  coldSteps: THREE.Object3D;
  /** 积水的材质（卯时提亮） */
  puddle: THREE.MeshStandardMaterial;
  /** 天亮以后湿地面映着的天光（加法、贴地的一层；夜里不可见，logic.ts applySky 按天亮进度调不透明度，M4） */
  sheen: THREE.Mesh;
}

// ==================================================================== 古槐

function tree(ctx: AreaContext, st: Statics): { at: V3; rotY: number }[] {
  const t = huaiTree({ trunkR: R1.tree.trunkR, canopyR: R1.tree.canopyR, seed: 1984 });
  t.group.position.set(...(R1.tree.center as V3));
  ctx.add(t.group);
  const c = t.collider;
  ctx.collider.box([c.center[0] + R1.tree.center[0], c.center[1], c.center[2] + R1.tree.center[2]], c.size);
  // 树池：一圈侧砌的砖（高 0.12，走得上去）+ 湿土
  const brick = mat('bedBrick', { color: '#6E3A2C', roughness: 0.85 });
  const R = 1.95, n = 30;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.13), brick);
    b.position.set(Math.cos(a) * R, 0.06, Math.sin(a) * R);
    b.rotation.y = -a + Math.PI / 2 + (i % 3 - 1) * 0.04;
    st.add(b);
  }
  const soil = new THREE.Mesh(new THREE.CircleGeometry(R - 0.06, 36).rotateX(-Math.PI / 2), mat('soil', { color: '#241c16', roughness: 0.95 }));
  soil.position.y = 0.02;
  st.add(soil);
  // 落叶与槐米（地面上一片片小黄绿）
  const r = rng(77);
  const leaf = mat('fallenLeaf', { color: '#8A8A3A', roughness: 0.9, side: THREE.DoubleSide });
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, d = range(r, 1.6, 7.5);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.035).rotateX(-Math.PI / 2), leaf);
    p.position.set(Math.cos(a) * d, 0.009 + (d < R ? 0.02 : 0), Math.sin(a) * d);
    p.rotation.y = r() * Math.PI;
    st.add(p);
  }
  // 彩灯串的挂点：沿树冠下沿绕一圈（world 坐标、朝向）
  const anchors: { at: V3; rotY: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const rad = 4.4 + (i % 2) * 0.8;
    anchors.push({ at: [Math.cos(a) * rad, 4.6 + (i % 3) * 0.35, Math.sin(a) * rad], rotY: -a + Math.PI / 2 });
  }
  return anchors;
}

/** 土地庙（小砖龛，对联“土能生万物　地可发千祥”）、土地的马扎、香炉与供果。 */
function shrine(ctx: AreaContext, st: Statics): THREE.Mesh {
  const [sx, , sz] = R1.shrine;
  const g = new THREE.Group();
  const brickM = MATERIALS.brick();
  const tile = mat('roofTile', { color: '#3B3F42', roughness: 0.7 });
  const red = mat('shrineRed', { color: '#8C1E1A', roughness: 0.7 });
  const stoneM = mat('shrineStone', { color: '#7A7872', roughness: 0.9 });
  const add = (m: THREE.Mesh) => { g.add(m); return m; };
  add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 0.56), stoneM)).position.set(0, 0.08, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.62, 0.46), brickM)).position.set(0, 0.47, 0.02);
  // 龛口（深色）与小神像剪影
  add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.04), mat('niche', { color: '#0d0a08', roughness: 1 }))).position.set(0, 0.48, -0.21);
  const statue = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 0.2, 8), mat('statue', { color: '#6A5A3A', roughness: 0.6, metalness: 0.2 })));
  statue.position.set(0, 0.42, -0.2);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mat('statue', { color: '#6A5A3A', roughness: 0.6, metalness: 0.2 }))).position.set(0, 0.55, -0.2);
  // 两坡小瓦顶
  for (const s of [-1, 1]) {
    const roof = add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.66), tile));
    roof.position.set(s * 0.18, 0.86, 0.02);
    roof.rotation.z = s * -0.5;
  }
  add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.7), tile)).position.set(0, 0.96, 0.02);
  // 红纸对联（竖排）与横批底色
  const coupletTex = (text: string) => canvasTex(ctx, 96, 512, (c, w, h) => {
    c.fillStyle = '#A8231E';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1a0e08';
    c.font = `bold ${Math.round(w * 0.78)}px ${SERIF_FONT_STACK}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    [...text].forEach((ch, i) => c.fillText(ch, w / 2, h * (0.1 + i * 0.2)));
    agePaper(c, w, h, 0.6, text.length, 1);
  });
  const strip = (text: string, x: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.36), new THREE.MeshStandardMaterial({ map: coupletTex(text), roughness: 0.85 }));
    m.rotation.y = Math.PI;
    m.position.set(x, 0.47, -0.232);
    g.add(m);
  };
  strip('土能生万物', 0.21);
  strip('地可发千祥', -0.21);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.01), red)).position.set(0, 0.7, -0.235);
  // 香炉、三炷香（香头微红）、供果
  const burner = add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.07, 12), mat('burner', { color: '#5C4A2E', roughness: 0.55, metalness: 0.5 })));
  burner.position.set(0, 0.195, -0.3);
  for (let i = 0; i < 3; i++) {
    const stick = add(new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.17, 4), mat('incense', { color: '#8A5A3A', roughness: 0.9 })));
    stick.position.set(-0.025 + i * 0.025, 0.31, -0.3);
    const tip = add(new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 4), MATERIALS.emissive('#FF5A2A', 1.6)));
    tip.position.set(-0.025 + i * 0.025, 0.395, -0.3);
  }
  for (const [x, c] of [[0.17, '#9E2A22'], [0.24, '#B8402A'], [-0.2, '#C8A04A']] as const) {
    add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mat(`fruit${c}`, { color: c, roughness: 0.45 }))).position.set(x, 0.195, -0.28);
  }
  g.position.set(sx, 0, sz);
  // 正面朝东南偏南（yaw 150，冲着院门与门岗）
  g.rotation.y = -150 * Math.PI / 180;
  g.updateMatrixWorld(true);
  // 单独挂（按材质合并）：1984 年的回放里要把它隐去（那会儿这庙还没盖，GDD §8.9）
  const merged = mergeByMaterial(g);
  merged.name = 'shrine';
  ctx.add(merged, { ref: REF_SHRINE });
  ctx.collider.box([sx, 0.45, sz], [0.66, 0.9, 0.6], -150);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.6), MATERIALS.hitProxy());
  hit.position.set(sx, 0.5, sz);
  hit.rotation.y = -150 * Math.PI / 180;
  hit.name = 'shrineHit';
  ctx.add(hit);
  // 土地的马扎（空的；取景器里土地坐在上面）
  st.add(place(PROPS.stool(), R1.npcSpots.tudiTree, TUDI_STOOL_YAW));
  return hit;
}

/** 蚁穴（树根旁一小堆湿土，洞口一串蚂蚁）：网格登记为 ref r1.anthill，R1-finale 的交互物 hit 用它。 */
function anthill(ctx: AreaContext): THREE.Mesh {
  const [ax, , az] = R1.anthill;
  const mound = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.07, 14, 1), mat('anthill', { color: '#3a2c20', roughness: 0.95 }));
  mound.position.set(ax, 0.055, az);
  mound.name = 'anthill';
  ctx.add(mound, { ref: OBJ.R1_ANTHILL });
  const trail = canvasTex(ctx, 256, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = rng(6);
    g.fillStyle = '#0b0806';
    for (let i = 0; i < 70; i++) {
      const x = r() * w, y = h / 2 + Math.sin(x * 0.05) * h * 0.2 + range(r, -5, 5);
      g.beginPath();
      g.ellipse(x, y, 2.4, 1.2, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#060403';
    g.beginPath();
    g.ellipse(w * 0.06, h / 2, 9, 6, 0, 0, Math.PI * 2);
    g.fill();
  });
  const trailMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
    map: trail, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }));
  // 从洞口往树根爬
  trailMesh.position.set(ax + 0.35, 0.09, az - 0.12);
  trailMesh.rotation.y = 0.35;
  trailMesh.userData.noOcclude = true;
  trailMesh.raycast = () => {};
  ctx.add(trailMesh, { occlude: false });
  return mound;
}

/** 石桌与四个石凳（桌面刻着象棋盘）。 */
function stoneTable(ctx: AreaContext, st: Statics, decals: DecalAtlas): void {
  const [x, , z] = R1.stoneTable;
  st.add(place(PROPS.stoneTable(), [x, 0, z]));
  const board = canvasTex(ctx, 256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(30,26,22,0.8)';
    g.lineWidth = 2;
    const x0 = w * 0.14, x1 = w * 0.86, y0 = h * 0.08, y1 = h * 0.92;
    for (let i = 0; i < 9; i++) {
      const xx = x0 + ((x1 - x0) * i) / 8;
      g.beginPath();
      g.moveTo(xx, y0);
      g.lineTo(xx, i === 0 || i === 8 ? y1 : y0 + (y1 - y0) * 0.444);
      g.moveTo(xx, y0 + (y1 - y0) * 0.556);
      g.lineTo(xx, y1);
      g.stroke();
    }
    for (let j = 0; j < 10; j++) {
      const yy = y0 + ((y1 - y0) * j) / 9;
      g.beginPath();
      g.moveTo(x0, yy);
      g.lineTo(x1, yy);
      g.stroke();
    }
    g.fillStyle = 'rgba(30,26,22,0.7)';
    g.font = `bold ${Math.round(h * 0.06)}px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.fillText('楚 河　　汉 界', w / 2, h * 0.52);
  });
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.46, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: board, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
  top.position.set(x, 0.802, z);
  top.userData.noOcclude = true;
  ctx.add(top, { occlude: false });
  ctx.collider.box([x, 0.4, z], [0.9, 0.8, 0.9]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ctx.collider.box([x + Math.cos(a) * 0.85, 0.21, z + Math.sin(a) * 0.85], [0.36, 0.42, 0.36]);
  }
  // 地上的粉笔跳房子
  decals.ground(DECAL.hopscotch, x + 2.6, z + 0.6, 1.6, 1.6, 20);
  // 一把遗落的竹椅
  st.add(place(PROPS.chair(), [x - 1.4, 0, z + 1.2], 110));
}

/** 车棚（x:10~18, z:-8~-4）：铁皮坡顶、后墙、立柱、几辆没人要的自行车。 */
function shed(ctx: AreaContext, st: Statics, decals: DecalAtlas): void {
  const s = SHED;
  const steel = mat('shedSteel', { color: '#3F4448', roughness: 0.6, metalness: 0.5 });
  const brickM = MATERIALS.brick();
  // 后墙（北）与东墙
  st.box(s.x1 - s.x0, 2.3, 0.2, brickM, [(s.x0 + s.x1) / 2, 1.15, s.z0 + 0.1]);
  st.box(0.2, 2.3, s.z1 - s.z0, brickM, [s.x1 - 0.1, 1.15, (s.z0 + s.z1) / 2]);
  ctx.collider.wall([s.x0, s.z0 + 0.1], [s.x1, s.z0 + 0.1], 0, 2.3, 0.2);
  ctx.collider.wall([s.x1 - 0.1, s.z0], [s.x1 - 0.1, s.z1], 0, 2.3, 0.2);
  // 前沿立柱（避开回放里骑车的路线）
  for (const x of [s.x0 + 0.1, s.x0 + 2.9, s.x1 - 0.1]) {
    st.box(0.08, 2.35, 0.08, steel, [x, 1.175, s.z1 - 0.1]);
    ctx.collider.box([x, 1.175, s.z1 - 0.1], [0.1, 2.35, 0.1]);
  }
  st.box(0.08, 2.4, 0.08, steel, [s.x0 + 0.1, 1.2, s.z0 + 0.25]);
  st.box(s.x1 - s.x0, 0.08, 0.08, steel, [(s.x0 + s.x1) / 2, 2.35, s.z1 - 0.1]);
  // 铁皮坡顶（北高南低）
  const roof = new THREE.Mesh(new THREE.BoxGeometry(s.x1 - s.x0 + 0.5, 0.035, s.z1 - s.z0 + 0.7), MATERIALS.tin());
  roof.position.set((s.x0 + s.x1) / 2, 2.52, (s.z0 + s.z1) / 2 + 0.1);
  roof.rotation.x = 0.07;
  st.add(roof);
  // 自行车（西半边，靠后墙，车头朝北；东半边空着，回放里老周在那儿教孩子骑车）
  const bikes = new THREE.Group();
  const spots: [number, number, number][] = [[10.7, -7.25, 0.08], [11.5, -7.3, -0.05], [12.35, -7.2, 0.12], [13.1, -7.25, -0.1]];
  spots.forEach(([bx, bz, yaw], i) => {
    const b = PROPS.bicycle(i + 3);
    b.position.set(bx, 0, bz);
    b.rotation.y = Math.PI / 2 + yaw;
    bikes.add(b);
  });
  st.add(bikes);
  ctx.collider.box([11.9, 0.55, -7.25], [2.9, 1.1, 1.2]);
  // 挂在立柱上的旧轮胎、墙上的拆字与小广告、地上的纸箱
  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 20), mat('rubber', { color: '#111', roughness: 0.9 }));
  tire.position.set(s.x1 - 0.25, 1.4, -5.2);
  tire.rotation.y = Math.PI / 2;
  st.add(tire);
  decals.quad(DECAL.chai, [15.6, 1.5, s.z0 + 0.212], 1.3, 1.3, 180, -5);
  decals.quad(DECAL.postersC, [s.x1 - 0.212, 1.2, -6.6], 0.9, 0.9, 270);
  const box = mat('cardboard', { color: '#8A6A44', roughness: 0.95 });
  st.box(0.5, 0.4, 0.4, box, [17.3, 0.2, -7.4]);
  st.box(0.45, 0.35, 0.4, box, [17.35, 0.575, -7.35], 10);
  ctx.collider.box([17.3, 0.4, -7.4], [0.6, 0.8, 0.5]);
}

/** 公告栏：拆迁公告盖住讣告的下半截；取景器里透出被盖住的字（褪字层）。 */
function noticeBoard(ctx: AreaContext, st: Statics): THREE.Mesh {
  const nb = PROPS.noticeBoard(NB.w, NB.h);
  nb.group.position.set(NB.x, 0, NB.z);
  st.add(nb.group);
  ctx.collider.box([NB.x, 1.0, NB.z + 0.02], [NB.w + 0.2, 2.0, 0.14]);
  const face = NB.z - 0.036;
  const sheet = (tex: THREE.Texture, w: number, h: number, x: number, y: number, dz: number, rotDeg: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }));
    m.rotation.y = Math.PI;
    m.rotation.z = (rotDeg * Math.PI) / 180;
    m.position.set(x, y, face - dz);
    ctx.add(m);
    return m;
  };
  // 讣告（印全文；下半截被拆迁公告盖着）
  const obit = paperSheet(ctx, { title: '讣　告', lines: [OBITUARY.body.replace('讣　告\n\n', ''), ...OBITUARY.covered.split('\n\n')], w: 512, h: 724, seed: 830, aged: 0.6, titleSize: 44, bodySize: 23 });
  sheet(obit, 0.46, 0.65, NB.x - 0.42, NB.cy + 0.08, 0.001, 1.5);
  // 拆迁公告（红头，盖在讣告下半截上）
  const demo = paperSheet(ctx, { title: DEMOLITION.title, lines: [DEMOLITION.body], sign: DEMOLITION.sign, w: 512, h: 724, seed: 819, aged: 0.2, titleSize: 34, bodySize: 23, red: true });
  sheet(demo, 0.5, 0.7, NB.x - 0.35, NB.cy - 0.33, 0.004, -2.5);
  // 停水通知（旧纸）
  const water = paperSheet(ctx, { title: WATER_NOTICE.title, lines: [WATER_NOTICE.body], sign: WATER_NOTICE.sign, w: 384, h: 512, seed: 823, aged: 0.85, titleSize: 34, bodySize: 20 });
  sheet(water, 0.36, 0.48, NB.x + 0.62, NB.cy + 0.12, 0.001, -4);
  // 褪字层：被盖住的那两行从拆迁公告背后透出来（只在取景器里）
  const bleed = canvasTex(ctx, 512, 192, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = FADED_INK;
    g.font = `${Math.round(h * 0.17)}px ${FONT_STACK}`;
    let y = h * 0.3;
    for (const line of wrapText(g, READ.obituaryHidden, w * 0.92)) {
      g.fillText(line, w * 0.04, y);
      y += h * 0.24;
    }
    g.font = `${Math.round(h * 0.13)}px ${FONT_STACK}`;
    g.textAlign = 'right';
    g.fillText('槐安街道办事处　二〇二三年八月三十一日', w * 0.97, h * 0.88);
  });
  const bleedMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.16), new THREE.MeshBasicMaterial({ map: bleed, color: FADED_GLOW, transparent: true, depthWrite: false, opacity: 0.85 }));
  bleedMesh.rotation.y = Math.PI;
  bleedMesh.position.set(OBITUARY_HIDDEN_AT[0], OBITUARY_HIDDEN_AT[1], face - 0.008);
  bleedMesh.userData.noOcclude = true;
  bleedMesh.raycast = () => {};
  ctx.add(bleedMesh, { layer: 'faded_text', occlude: false });
  // 几张小纸条（寻猫、出租）
  const scraps = canvasTex(ctx, 256, 128, (g, w, h) => {
    g.fillStyle = '#F4F0E2';
    g.fillRect(0, 0, w * 0.46, h * 0.9);
    g.fillStyle = '#F2E27A';
    g.fillRect(w * 0.52, h * 0.05, w * 0.46, h * 0.8);
    g.fillStyle = '#1b1b1b';
    g.font = `bold ${Math.round(h * 0.18)}px ${FONT_STACK}`;
    g.fillText('寻猫', w * 0.08, h * 0.3);
    g.fillText('收旧物', w * 0.56, h * 0.3);
    g.font = `${Math.round(h * 0.1)}px ${FONT_STACK}`;
    g.fillText('三花，右耳缺', w * 0.05, h * 0.55);
    g.fillText('电话 139…', w * 0.56, h * 0.55);
    agePaper(g, w, h, 0.5, 5, 1);
  });
  sheet(scraps, 0.44, 0.22, NB.x + 0.72, NB.cy - 0.38, 0.001, 3);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(NB.w, NB.h, 0.1), MATERIALS.hitProxy());
  hit.position.set(NB.x, NB.cy, NB.z - 0.02);
  hit.name = 'noticeHit';
  ctx.add(hit);
  // 公告栏灯的小灯罩支架（灯本身在 lights.ts）
  st.box(0.04, 0.04, 0.34, mat('lampArm', { color: '#2F4B3A', roughness: 0.55, metalness: 0.3 }), [NB.x, BOARD_LAMP_AT[1] + 0.1, NB.z - 0.17]);
  return hit;
}

/** 小区简介牌（正面朝北，冲着院子）。 */
function estateSign(ctx: AreaContext, st: Statics): THREE.Mesh {
  const [x, , z] = R1.estateSign;
  const frame = mat('estateFrame', { color: '#9AA0A6', roughness: 0.4, metalness: 0.6 });
  st.box(0.05, 1.9, 0.05, frame, [x - 0.75, 0.95, z]);
  st.box(0.05, 1.9, 0.05, frame, [x + 0.75, 0.95, z]);
  st.box(1.56, 1.0, 0.04, frame, [x, 1.45, z + 0.01]);
  const tex = canvasTex(ctx, 1024, 640, (g, w, h) => {
    g.fillStyle = '#1F3F5E';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#E9E2CC';
    g.fillRect(w * 0.03, h * 0.03, w * 0.94, h * 0.94);
    g.fillStyle = '#1F3F5E';
    g.font = `bold ${Math.round(h * 0.12)}px ${SERIF_FONT_STACK}`;
    g.textAlign = 'center';
    g.fillText('槐 安 里', w / 2, h * 0.18);
    g.font = `${Math.round(h * 0.05)}px ${FONT_STACK}`;
    g.fillText('小区简介', w / 2, h * 0.27);
    g.textAlign = 'left';
    g.fillStyle = '#22211d';
    g.font = `${Math.round(h * 0.052)}px ${FONT_STACK}`;
    let y = h * 0.39;
    for (const line of wrapText(g, ESTATE_SIGN, w * 0.84)) {
      g.fillText(line, w * 0.08, y);
      y += h * 0.078;
    }
    agePaper(g, w, h, 0.45, 1984, 2);
    grain(g, w, h, 0.12, 3);
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.94), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.1 }));
  face.position.set(x, 1.45, z - 0.012);
  face.rotation.y = Math.PI;
  ctx.add(face);
  ctx.collider.box([x, 1.0, z], [1.6, 2.0, 0.12]);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.95, 0.1), MATERIALS.hitProxy());
  hit.position.set(x, 1.45, z);
  ctx.add(hit);
  return hit;
}

/** 火盆（X1）与焚化特效（火苗 + 纸灰；平时隐藏，logic.ts 播放）。 */
function brazier(ctx: AreaContext, st: Statics): { hit: THREE.Mesh; fx: THREE.Group } {
  const [x, , z] = R1.brazier;
  // 火盆里是烧过纸的灰，余烬零星发红（kit 的灰面整片均匀发光，远看像一块橘色圆盘：换成只让灰里的红点发光）
  const br = place(PROPS.brazier(), [x, 0, z]);
  br.traverse(o => {
    const m = o as THREE.Mesh;
    const mt = m.isMesh ? (m.material as THREE.MeshStandardMaterial) : null;
    if (!mt || mt.name !== 'kit.brazier.ash' || !mt.map) return;
    const em = mat('brazierEmbers', { color: '#ffffff', roughness: 1, map: mt.map });
    em.emissive.set('#FF5A1A');
    em.emissiveMap = mt.map;
    em.emissiveIntensity = 0.9;
    em.userData.tempC = 45;
    m.material = em;
  });
  st.add(br);
  ctx.collider.box([x, 0.25, z], [0.6, 0.5, 0.6]);
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.3, 0.55, 10), MATERIALS.hitProxy());
  hit.position.set(x, 0.28, z);
  ctx.add(hit);
  // 焚化特效：两片交叉的火苗 + 一张卷起来的相纸 + 往上飘的纸灰（Points）
  const fx = new THREE.Group();
  fx.name = 'burnFx';
  const flameTex = paintTexture(64, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h * 0.8, 2, w / 2, h * 0.65, h * 0.6);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.8)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(w * 0.5, 0);
    g.quadraticCurveTo(w * 1.05, h * 0.75, w * 0.5, h);
    g.quadraticCurveTo(-w * 0.05, h * 0.75, w * 0.5, 0);
    g.fill();
  }, { mask: true });
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#FF8A3A').multiplyScalar(3), alphaMap: flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  flameMat.userData.tempC = TEMP_C.lamp;
  for (let i = 0; i < 2; i++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.6), flameMat);
    f.position.set(0, 0.3, 0);
    f.rotation.y = i * Math.PI / 2;
    f.name = 'flame';
    fx.add(f);
  }
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.1).rotateX(-Math.PI / 2 + 0.3), new THREE.MeshStandardMaterial({ color: '#EDE6D6', roughness: 0.8, side: THREE.DoubleSide }));
  photo.position.set(0, 0.03, 0);
  photo.name = 'burnPhoto';
  fx.add(photo);
  const n = 40;
  const pos = new Float32Array(n * 3);
  const r = rng(9);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = range(r, -0.15, 0.15);
    pos[i * 3 + 1] = r() * 1.6;
    pos[i * 3 + 2] = range(r, -0.15, 0.15);
  }
  const ashGeo = new THREE.BufferGeometry();
  ashGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const ash = new THREE.Points(ashGeo, new THREE.PointsMaterial({ color: '#FF9A5A', size: 0.035, transparent: true, depthWrite: false, opacity: 0.9 }));
  ash.name = 'ash';
  fx.add(ash);
  fx.position.set(x, 0.45, z);
  fx.visible = false;
  fx.traverse(o => {
    o.userData.noOcclude = true;
    (o as THREE.Mesh).raycast = () => {};
  });
  ctx.add(fx, { occlude: false });
  return { hit, fx };
}

/** 院门（铁门两扇 + 铁链挂锁，动态碰撞体由 logic.ts 登记）、门楣上的“槐安里”、院墙。 */
function gateAndWalls(ctx: AreaContext, st: Statics, decals: DecalAtlas): { gate: DoorRig; chain: THREE.Object3D | null; hit: THREE.Mesh } {
  const gz = R1.gate.z;
  // 正面（铁链、挂锁）朝院里：门岗从里头锁门；解开铁链后两扇往外（人行道那边）推开，停在院门两侧，
  // 不挡门楣上 CH1 机位俯拍的门口与粉笔叉（docs/requests/r1-finale.md #6）
  const gate = door({ w: GATE_W, h: 2.05, style: 'iron_gate', at: [0, 0, gz], yaw: 0 });
  ctx.add(gate.group);
  const chain = gate.group.getObjectByName('chain') ?? null;
  // 铁链换成生了锈、不那么亮的铁（kit 的镀铬链节在环境贴图里是一排白块；小金属件 roughness ≥ 0.5）
  const rusty = mat('gateChain', { color: '#4A4540', roughness: 0.62, metalness: 0.55 });
  chain?.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.name !== 'padlock') m.material = rusty;
  });
  // 敞开的两扇挡人（只在解开铁链后）：门扇转 95°，从合页往人行道伸出去 ~3m
  const leafLen = GATE_W / 2 - 0.02, open = 95 * Math.PI / 180;
  for (const s of [-1, 1] as const) {
    const a: XZ = [s * GATE_W / 2, gz];
    const b: XZ = [s * (GATE_W / 2 - leafLen * Math.cos(open)), gz + leafLen * Math.sin(open)];
    ctx.collider.dynamic(`r1w_gate_leaf_${s < 0 ? 'w' : 'e'}`, { wall: { a, b, y0: 0, height: 2.05, thickness: 0.1 } }, F.R1_GATE_UNCHAINED);
  }
  // 立柱碰撞（门扇的碰撞是动态的）
  for (const s of [-1, 1]) ctx.collider.box([s * GATE_PILLAR_X, 1.3, gz], [0.46, 2.6, 0.46]);
  // 门楣：一根铁横梁 + “槐安里”（冲着街）
  const iron = mat('gateBeam', { color: '#1E2226', roughness: 0.55, metalness: 0.55 });
  st.box(GATE_W + 0.9, 0.08, 0.08, iron, [0, 2.95, gz]);
  st.box(0.06, 0.4, 0.06, iron, [-0.9, 2.75, gz]);
  st.box(0.06, 0.4, 0.06, iron, [0.9, 2.75, gz]);
  boardSign(ctx, st, { text: '槐安里', style: 'plaque', w: 1.5, h: 0.46, at: [0, 3.25, gz + 0.06], yaw: 180, color: '#E0C060', bg: '#6A1512' });
  boardSign(ctx, st, { text: '出入平安', style: 'plaque', w: 1.2, h: 0.36, at: [0, 3.25, gz - 0.06], yaw: 0, color: '#D8B24A', bg: '#1B1512' });
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.2), MATERIALS.hitProxy());
  hit.position.set(0.02, 1.05, gz - 0.05);
  hit.name = 'gateHit';
  ctx.add(hit);

  // 院墙：南墙（院门两侧）、西墙、东墙、东北角
  const brickM = MATERIALS.brick();
  const coping = MATERIALS.concrete();
  const W = YARD_WALL;
  const wall = (a: XZ, b: XZ) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
    const rot = -Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    st.box(len, W.h, W.t, brickM, [cx, W.h / 2, cz], rot);
    st.box(len + 0.06, 0.08, W.t + 0.1, coping, [cx, W.h + 0.04, cz], rot);
    ctx.collider.wall(a, b, 0, W.h + 0.3, W.t);
  };
  const sz = W.south + W.t / 2;
  wall([W.west, sz], [-GATE_PILLAR_X - 0.23, sz]);
  wall([GATE_PILLAR_X + 0.23, sz], [W.east, sz]);
  wall([W.east, 21], [W.east, W.south + W.t]);
  wall([6, -14], [6, -16]);
  wall([6, -16], [W.east, -16]);
  wall([W.east, -16], [W.east, -12]);
  // 墙上的红圈“拆”、小广告、雨水印（冲着院子、冲着街）
  decals.quad(DECAL.chai, [-11, 1.3, W.south - 0.005], 1.6, 1.6, 0, 6);
  decals.quad(DECAL.chai, [12.5, 1.25, W.south - 0.005], 1.5, 1.5, 0, -8);
  decals.quad(DECAL.postersA, [-14.5, 1.1, W.south - 0.006], 1.1, 1.1, 0);
  decals.quad(DECAL.postersB, [7.2, 1.0, W.south - 0.006], 1.0, 1.0, 0, 4);
  decals.quad(DECAL.stainStreak, [-17, 1.6, W.south - 0.007], 3.0, 1.2, 0);
  decals.quad(DECAL.chai, [-9.5, 1.3, sz + W.t / 2 + 0.006], 1.7, 1.7, 180, -4);
  decals.quad(DECAL.postersC, [-5.5, 1.1, sz + W.t / 2 + 0.006], 1.1, 1.1, 180, 3);
  decals.quad(DECAL.postersA, [8.5, 1.15, sz + W.t / 2 + 0.006], 1.0, 1.0, 180, -2);
  decals.quad(DECAL.chaiFaded, [15.5, 1.3, sz + W.t / 2 + 0.006], 1.5, 1.5, 180);
  decals.quad(DECAL.chalkChai, [-1.2, 0.9, sz + W.t / 2 + 0.006], 0.9, 0.9, 180);
  decals.quad(DECAL.postersB, [W.east - W.t / 2 - 0.006, 1.1, 22.5], 1.0, 1.0, 270);
  decals.quad(DECAL.chai, [13, 1.3, -16 + W.t / 2 + 0.006], 1.6, 1.6, 180);
  decals.quad(DECAL.mold, [W.west + 0.012, 0.7, 20], 2.0, 1.4, 90);
  return { gate, chain, hit };
}

/** 晾衣竿（两根竹竿 + 绳上没收的衣服）、花盆、蜂窝煤、旧沙发、纸箱、垃圾桶。 */
function lifeProps(ctx: AreaContext, st: Statics, decals: DecalAtlas): void {
  const bamboo = mat('bamboo', { color: '#8C7A4A', roughness: 0.7 });
  const lines: [V3, V3][] = [
    [[-17.4, 0, -3], [-17.4, 0, 5.5]],
    [[16.8, 0, 1], [16.8, 0, 9.5]],
    [[-15.5, 0, 12.5], [-10.5, 0, 12.5]],
  ];
  lines.forEach(([a, b], i) => {
    for (const p of [a, b]) {
      st.cyl(0.03, 0.035, 2.3, bamboo, [p[0], 1.15, p[2]], 6);
      ctx.collider.box([p[0], 1.1, p[2]], [0.12, 2.2, 0.12]);
    }
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const cl = PROPS.clothesLine(len, 40 + i);
    cl.position.set(a[0], 2.2, a[2]);
    cl.rotation.y = -Math.atan2(b[2] - a[2], b[0] - a[0]);
    // 衣服合并进静态网格；绳子（LineSegments）单独挂
    const rope = cl.getObjectByName('clothesRope') as THREE.LineSegments | undefined;
    if (rope) {
      cl.remove(rope);
      rope.position.copy(cl.position);
      rope.rotation.copy(cl.rotation);
      rope.updateMatrixWorld(true);
      st.ropes.push(rope);
    }
    st.add(cl);
  });
  // 花盆（门卫室南墙根、三号楼门口）
  const pot = mat('pot', { color: '#8A4A30', roughness: 0.85 });
  const potSpots: V3[] = [[-7.6, 0, 22.2], [-6.9, 0, 22.25], [-5.4, 0, 22.2], [-9.7, 0.12, -13.3], [-10.3, 0.12, -13.35], [-6.1, 0.12, -13.3]];
  const leafM = [mat('potLeafA', { color: '#35502E', roughness: 0.8, flatShading: true }), mat('potLeafB', { color: '#4A6634', roughness: 0.8, flatShading: true })];
  potSpots.forEach((p, i) => {
    st.cyl(0.16, 0.12, 0.26, pot, [p[0], p[1] + 0.13, p[2]], 10);
    st.cyl(0.15, 0.15, 0.02, mat('soil', { color: '#241c16', roughness: 0.95 }), [p[0], p[1] + 0.25, p[2]], 10);
    // 一丛叶子：几个压扁的二十面体（葱、月季、仙人掌一类的盆栽剪影）
    for (let k = 0; k < 4; k++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1 + (k % 2) * 0.04, 0), leafM[(i + k) % 2]!);
      const a = k * 1.7 + i;
      leaf.position.set(p[0] + Math.cos(a) * 0.07, p[1] + 0.34 + k * 0.07, p[2] + Math.sin(a) * 0.07);
      leaf.scale.set(1, 1.3 + (k % 3) * 0.2, 1);
      st.add(leaf);
    }
  });
  // 蜂窝煤（二号楼墙根）
  const coal = mat('coal', { color: '#1c1b1a', roughness: 0.95 });
  for (let i = 0; i < 18; i++) {
    const col = i % 6, row = Math.floor(i / 6);
    st.cyl(0.07, 0.07, 0.08, coal, [-19.55 + (col % 2) * 0.16, 0.04 + row * 0.085, 8 + col * 0.16], 10);
  }
  // 等着拆迁的旧沙发、纸箱、搬家剩下的杂物
  const sofa = mat('sofa', { color: '#5A3A36', roughness: 0.95 });
  st.box(1.7, 0.42, 0.75, sofa, [17.6, 0.21, 10.8], 80);
  st.box(1.7, 0.45, 0.2, sofa, [17.95, 0.62, 10.85], 80);
  st.box(0.2, 0.3, 0.75, sofa, [17.45, 0.55, 10.0], 80);
  ctx.collider.box([17.6, 0.45, 10.8], [1.1, 0.9, 1.8]);
  const box = mat('cardboard', { color: '#8A6A44', roughness: 0.95 });
  const boxes: [number, number, number, number][] = [[-4.6, -12.9, 0.5, 20], [-4.1, -13.1, 0.4, -10], [-4.4, -13.05, 0.45, 5]];
  boxes.forEach(([x, z, s, r], i) => {
    st.box(s, s * 0.8, s * 0.9, box, [x, (i === 2 ? 0.4 : 0) + s * 0.4, z], r);
  });
  ctx.collider.box([-4.4, 0.4, -13.0], [1.1, 0.8, 0.8]);
  decals.ground(DECAL.chalkKids, -3.2, 10, 1.2, 1.2, 30);
  // 垃圾桶（院门里）
  for (const [x, z] of [[5.2, 23.2], [5.9, 23.25]] as const) {
    st.add(place(PROPS.trashBin(), [x, 0, z], 180));
    ctx.collider.box([x, 0.45, z], [0.55, 0.9, 0.55]);
  }
}

/** 阴物层：两串湿脚印（王奶奶去三号楼、陆师傅绕到门卫室窗外再出院门往东口）与残影点旋涡；红外冷迹。 */
function yinAndCold(ctx: AreaContext): { chair: THREE.Object3D; steps: THREE.Object3D } {
  const wang: XZ[] = [[0, 22.6], [-0.9, 18.5], [-2.5, 12], [-4.8, 3.5], [-6.6, -5.5], [-7.6, -11.2], [-8, -13.2]];
  const lu: XZ[] = [[0.2, 22.6], [-2.4, 21.9], [-4.1, 21.3], [-3.8, 21.6], [-1.6, 23.0], [0.9, 24.6], [2.0, 27.3], [12, 27.5], [24.4, 27.3]];
  ctx.add(createFootprints(wang, { seed: 26, stride: 0.62 }), { occlude: false });
  ctx.add(createFootprints(lu, { seed: 25, stride: 0.7 }), { occlude: false });
  for (const at of [R1.replay.gate, R1.replay.tree, R1.replay.shed]) {
    const v = createResidueVortex();
    v.position.set(at[0], 0.02, at[2]);
    ctx.add(v, { occlude: false });
  }
  // 冷迹：椅子上一块人形的凉（老周一宿坐这儿）、三号楼单元门外台阶上一块（看你陪王婶上楼）
  const chair = createColdTrace('sitting');
  chair.position.set(R1.chair[0], 0, R1.chair[2]);
  chair.rotation.y = Math.PI;
  chair.name = 'coldChair';
  ctx.add(chair, { tempC: TEMP_C.cold, occlude: false });
  const steps = createColdTrace('sitting');
  steps.position.set(R1.coldSteps[0], -0.3, R1.coldSteps[2]);
  steps.rotation.y = Math.PI;
  steps.name = 'coldSteps';
  ctx.add(steps, { tempC: TEMP_C.cold, occlude: false });
  return { chair, steps };
}

/**
 * 地上的积水（很光的深色一滩，映着夜空与远灯、钠灯在水面上一点高光）：十几滩合成一个网格、一份材质，
 * 卯时由 logic.ts 把颜色提亮（天亮了水面映着灰白的天，不再是一个个黑洞）。
 * M4：每滩是自己建的扇形网格（中心一点 + 一圈 24 个点），uv.x 从中心 0 走到边沿 1；alphaMap 是一条横向渐变（后 20% 渐隐），
 * 水边软软地洇进沥青里，不再是一圈带亮边的黑坑。
 */
function puddles(ctx: AreaContext): THREE.MeshStandardMaterial {
  // alphaMap 读绿通道：mask:true 把画出来的 alpha 转成灰度（AGENTS：不能直接用 rgba 白）
  const edge = ctx.track(paintTexture(64, 4, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.72, 'rgba(255,255,255,1)');
    gr.addColorStop(0.9, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }, { mask: true }));
  edge.wrapS = edge.wrapT = THREE.ClampToEdgeWrapping;
  const water = new THREE.MeshStandardMaterial({ color: PUDDLE_NIGHT, roughness: 0.1, metalness: 0.5, alphaMap: edge, transparent: true, depthWrite: false });
  water.userData.tempC = 16;
  const r = rng(2026);
  const spots: [number, number, number][] = [
    [-2.2, 17.5, 1.3], [1.8, 20.2, 0.9], [-9.5, 12, 1.6], [6.5, 14.5, 1.1], [-12.5, 3.5, 1.4], [10.8, 5.5, 1.2],
    [-4.8, -6.5, 1.5], [3.5, -9, 1.0], [14.5, 1.5, 0.9], [-15.5, 18, 1.2], [8.5, 23, 0.8], [-6.2, 26.5, 1.0], [6, 27.8, 1.3],
  ];
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [];
  const n = 24;
  for (const [x, z, sc] of spots) {
    // 边沿半径：先随机再平滑一遍（相邻点平均），轮廓是圆润的一滩而不是锯齿
    const raw: number[] = [];
    for (let i = 0; i < n; i++) raw.push(sc * (0.65 + 0.35 * r()));
    const rad = raw.map((v, i) => (raw[(i + n - 1) % n]! + 2 * v + raw[(i + 1) % n]!) / 4);
    const rot = r() * Math.PI;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const ring = (i: number): [number, number] => {
      const a = (i / n) * Math.PI * 2;
      const lx = Math.cos(a) * rad[i % n]! * 1.3, lz = Math.sin(a) * rad[i % n]! * 0.8;
      return [x + lx * cs - lz * sn, z + lx * sn + lz * cs];
    };
    for (let i = 0; i < n; i++) {
      const [ax, az] = ring(i), [bx, bz] = ring(i + 1);
      // 朝上的三角形：中心 → i+1 → i（逆时针从上往下看）
      pos.push(x, 0.007, z, bx, 0.007, bz, ax, 0.007, az);
      uv.push(0, 0.5, 1, 0.5, 1, 0.5);
      nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  merged.computeBoundingSphere();
  const m = new THREE.Mesh(ctx.track(merged), ctx.track(water));
  m.name = 'puddles';
  m.renderOrder = 1;
  ctx.add(m, { occlude: false });
  return water;
}

/**
 * 天亮以后湿沥青映着的天光（M4：卯时半球光与曝光提上去以后，近处的湿地面反照率太低，仍是一片黑，读起来还像夜里；
 * 环境贴图是夜里的钠灯色，映不出黎明）。院子与院外马路铺一层贴地的加法薄片（晨雾色、吃雾：远处交给雾），
 * 门卫室地面挖掉不铺（屋里没有天光）。夜里 visible=false（进区域时的预热照样编译它，灯数不变）。
 */
function dawnSheen(ctx: AreaContext): THREE.Mesh {
  const b = R1.booth;
  const x0 = -27, x1 = 27, z0 = -24.5, z1 = R1.sidewalk.z0 + 0.3;
  const shape = new THREE.Shape();
  shape.moveTo(x0, -z0);
  shape.lineTo(x1, -z0);
  shape.lineTo(x1, -z1);
  shape.lineTo(x0, -z1);
  shape.closePath();
  // ShapeGeometry 在 xy 平面，rotateX(-π/2) 以后 y → -z：洞按 (x, -z) 画
  const hole = new THREE.Path();
  hole.moveTo(b.x0 - 0.05, -(b.z0 - 0.05));
  hole.lineTo(b.x0 - 0.05, -(b.z1 + 0.05));
  hole.lineTo(b.x1 + 0.05, -(b.z1 + 0.05));
  hole.lineTo(b.x1 + 0.05, -(b.z0 - 0.05));
  hole.closePath();
  shape.holes.push(hole);
  const geo = ctx.track(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2));
  const mat = ctx.track(new THREE.MeshBasicMaterial({
    color: '#CDB6A6', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  mat.userData.tempC = 16;
  const m = new THREE.Mesh(geo, mat);
  m.name = 'dawnSheen';
  m.position.y = 0.004;
  m.renderOrder = 1;
  m.userData.irHide = true;
  m.userData.noOcclude = true;
  m.raycast = () => {};
  m.visible = false;
  ctx.add(m, { occlude: false });
  return m;
}

export function buildYard(ctx: AreaContext, st: Statics, decals: DecalAtlas): YardHandles {
  const puddle = puddles(ctx);
  const sheen = dawnSheen(ctx);
  const anchors = tree(ctx, st);
  const shrineHit = shrine(ctx, st);
  const mound = anthill(ctx);
  stoneTable(ctx, st, decals);
  shed(ctx, st, decals);
  const boardHit = noticeBoard(ctx, st);
  const estateHit = estateSign(ctx, st);
  const br = brazier(ctx, st);
  const g = gateAndWalls(ctx, st, decals);
  lifeProps(ctx, st, decals);
  const cold = yinAndCold(ctx);
  void PALETTE;
  return {
    gate: g.gate, chain: g.chain, gateHit: g.hit, anthill: mound, shrineHit, boardHit, estateHit,
    brazierHit: br.hit, burnFx: br.fx, stringLightAnchors: anchors, coldChair: cold.chair, coldSteps: cold.steps, puddle, sheen,
  };
}
