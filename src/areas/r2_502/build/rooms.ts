// owner: R2
// R2_502 王奶奶家（GDD §4.3）：空客厅（家具搬走留下的灰印、停在 2019 年 12 月的挂历、墙上的相框印）、厨房（砌筑灶台正面贴白瓷砖、
// 三块新瓷砖、灶君纸像与对联、灶上的煤气灶）、北边卧室只剩床架；南窗外是月夜。静态件按材质合并（Batch）。

import * as THREE from 'three';
import type { AreaContext } from '../../../core/area';
import { OBJ } from '../../../data/ids';
import { PALETTE } from '../../../data/palette';
import { TEMP_C } from '../../../data/render';
import { MATERIALS } from '../../../fx/materials';
import { setLayerRecursive } from '../../../core/layers';
import { door, type DoorRig } from '../../../kit/doors';
import { newMat } from '../../../kit/geom';
import { PROPS } from '../../../kit/props';
import { createResidueVortex } from '../../../kit/residue';
import { paintTexture } from '../../../kit/canvas';
import { Batch } from './batch';
import { H, L502 } from '../layout';
import {
  ZAO_EYES, calendarTexture, clockTexture, coupletTexture, dustTexture, floorTexture, letterTexture, moonWindowTexture, tileTexture, tinTexture,
  sootTexture, wallMarksTexture, zaojunTexture,
} from './paint';

export interface Apt {
  zaojun: THREE.Group;
  /** 取景器里的眼珠（yin 层）：[灶王爷左、右, 灶王奶奶左、右]，各自的静止位置（世界） */
  pupils: { mesh: THREE.Mesh; home: THREE.Vector3 }[];
  tiles: { left: THREE.Mesh; right: THREE.Mesh; top: THREE.Mesh };
  hole: THREE.Object3D;
  tin: THREE.Object3D;
  counter: THREE.Object3D;
  fire: THREE.Object3D;
  flames: THREE.Mesh[];
  cooked: THREE.Object3D;
  calendar: THREE.Object3D;
  entry: DoorRig;
  orb: THREE.Object3D;
  letter: THREE.Object3D;
  clockHands: THREE.Object3D[];
  /** 窗外夜景的材质（回放里的白天要换色） */
  windowViews: THREE.MeshBasicMaterial[];
}

/**
 * 取景器里灶君的眼睛叠层（阴物层，米；GDD P5 线索“眼珠朝左下方转”）：眼白半宽/半高、眼珠半径、每只眼离脸中线的距离，
 * 以及眼珠往左下瞟的位移（= 眼珠贴到椭圆眼白左下沿的最大值）。纸像头部放大后（paint.ts HEAD_S）脸半宽约 51mm，
 * 两只眼白装得下 25mm 的半宽：瞟眼时眼珠挪 12.5mm/6.3mm（原来 6mm/3mm），4× 下十五六个像素，一眼看得出往哪儿瞟。
 */
export const ZAO_OVERLAY = { whiteHalfW: 0.025, whiteHalfH: 0.019, pupil: 0.0085, eyeDX: 0.0258, glanceX: 0.0125, glanceY: 0.0063 } as const;

function decalMat(map: THREE.Texture, o?: { additive?: boolean; color?: THREE.ColorRepresentation; opacity?: number }): THREE.Material {
  if (o?.additive) {
    const m = new THREE.MeshBasicMaterial({ map, color: o.color ?? '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: o.opacity ?? 1 });
    m.userData.tempC = TEMP_C.ambient;
    return m;
  }
  const m = newMat({ map, transparent: true, depthWrite: false, roughness: 0.95, tempC: TEMP_C.ambient });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  return m;
}

/** 窗：窗框、窗台、玻璃、窗外（HDR 月夜）；wallNormal 为墙面朝屋里的方向。 */
function windowAt(b: Batch, m: { frame: THREE.Material; view: THREE.Material; glass: THREE.Material; sill: THREE.Material },
  x0: number, x1: number, y0: number, y1: number, z: number, nrm: 'z+' | 'z-'): void {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, h = y1 - y0;
  const s = nrm === 'z+' ? 1 : -1;
  b.decal(m.view, w, h, cx, cy, z + s * 0.01, nrm);
  b.decal(m.glass, w, h, cx, cy, z + s * 0.03, nrm);
  b.box(m.sill, w + 0.14, 0.05, 0.24, cx, y0 - 0.025, z + s * 0.08);
  b.box(m.frame, w + 0.06, 0.05, 0.08, cx, y1, z + s * 0.03);
  b.box(m.frame, w + 0.06, 0.05, 0.08, cx, y0 + 0.02, z + s * 0.03);
  for (const x of [x0, cx, x1]) b.box(m.frame, 0.05, h, 0.08, x, cy, z + s * 0.03);
  b.box(m.frame, w, 0.04, 0.06, cx, y0 + h * 0.66, z + s * 0.03);
}

export function buildApartment(ctx: AreaContext): Apt {
  const grp = new THREE.Group();
  grp.name = 'apartment502';
  const b = new Batch();
  const K = L502;
  // —— 材质
  const lime = MATERIALS.lime();
  const plaster = MATERIALS.plaster();
  const concrete = MATERIALS.concrete();
  const floor = newMat({ map: floorTexture(), roughness: 0.7, tempC: TEMP_C.ambient });
  const ceiling = newMat({ color: '#b6b2a6', roughness: 0.95 });
  const tiles = newMat({ map: tileTexture(), color: '#dcd5c3', roughness: 0.45, tempC: TEMP_C.ambient });
  const newTile = newMat({ color: '#fbfbf8', roughness: 0.12, emissive: '#ffffff', emissiveIntensity: 0.03, tempC: TEMP_C.ambient });
  newTile.name = 'newTile';
  const wood = MATERIALS.wood();
  const darkWood = newMat({ color: '#4a3424', roughness: 0.75 });
  const black = newMat({ color: '#0b0b0c', roughness: 0.9 });
  const iron = newMat({ color: '#2a2d30', roughness: 0.6, metalness: 0.5, tempC: 15 });
  const paper = MATERIALS.paper();
  const moonView = new THREE.MeshBasicMaterial({ map: moonWindowTexture(5, 0.26), color: new THREE.Color('#dfe8f5').multiplyScalar(5.4) });
  moonView.userData.tempC = 16;
  const moonView2 = new THREE.MeshBasicMaterial({ map: moonWindowTexture(9), color: new THREE.Color('#dfe8f5').multiplyScalar(5.4) });
  moonView2.userData.tempC = 16;
  const glass = MATERIALS.glass();
  const win = { frame: darkWood, view: moonView, glass, sill: concrete };
  // 灰印：满地一层灰（淡灰、带一点自发光——像月光底下浮着的一层白），家具站过的地方是干净的红漆地
  const dustTex = dustTexture();
  const dust = newMat({ map: dustTex, emissiveMap: dustTex, emissive: '#9ba3b2', emissiveIntensity: 0.4, transparent: true, roughness: 1, tempC: TEMP_C.ambient });
  dust.depthWrite = false;
  dust.polygonOffset = true;
  dust.polygonOffsetFactor = -2;
  dust.polygonOffsetUnits = -2;
  const marks = decalMat(wallMarksTexture());
  // 月光在地上投下的窗格亮斑（加法、淡蓝）：斜着拉长的一块窗（平行四边形），四格玻璃之间是窗棂的影子，边缘柔和地散开
  const moonPatchTex = paintTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const shear = 0.22, x0 = w * 0.16, x1 = w * 0.74, y0 = h * 0.1, y1 = h * 0.9;
    g.filter = 'blur(7px)';
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.moveTo(x0 + shear * w, y0);
    g.lineTo(x1 + shear * w, y0);
    g.lineTo(x1, y1);
    g.lineTo(x0, y1);
    g.closePath();
    g.fill();
    g.filter = 'blur(2.5px)';
    g.globalCompositeOperation = 'destination-out';
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo((x0 + x1) / 2 + shear * w, y0);
    g.lineTo((x0 + x1) / 2, y1);
    const ym = y0 + (y1 - y0) * 0.34, xs = shear * w * (1 - 0.34);
    g.moveTo(x0 + xs, ym);
    g.lineTo(x1 + xs, ym);
    g.stroke();
    g.filter = 'none';
    g.globalCompositeOperation = 'source-over';
  }, { mask: true });
  // 月光落在地上的一块窗格亮斑：空客厅里最亮的一块地，照出家具搬走后留下的灰印（GDD §4.3）
  const moonPatch = new THREE.MeshBasicMaterial({ color: '#7f97c2', alphaMap: moonPatchTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.42 });
  moonPatch.userData.tempC = TEMP_C.ambient;

  // —— 地面、顶棚
  b.flat(floor, K.living.x0, K.living.z0, K.kitchen.x1, K.living.z1, 0, true, 2);
  b.flat(floor, K.bedroom.x0, K.bedroom.z0, K.bedroom.x1, K.bedroom.z1, 0, true, 2);
  b.flat(ceiling, K.living.x0, K.living.z0, K.kitchen.x1, K.living.z1, H, false, 2);
  b.flat(ceiling, K.bedroom.x0, K.bedroom.z0, K.bedroom.x1, K.bedroom.z1, H, false, 2);
  // 客厅地上的灰印
  b.decalFlat(dust, 5, 4, 2.5, 0.004, -2, true);
  // —— 墙（石灰）
  const W = (a: readonly [number, number], c: readonly [number, number], y0 = 0, y1 = H) => b.wall(lime, a, c, y0, y1, { uMeters: 3 });
  // 西墙（入户门洞 z:-1.25~-0.35）
  W([0, K.living.z0], [0, K.entry.z0]);
  W([0, K.entry.z1], [0, K.living.z1]);
  W([0, K.entry.z0], [0, K.entry.z1], K.entry.h, H);
  // 南墙（客厅窗、厨房窗）
  W([K.kitchen.x1, 0], [K.living.x0, 0]);
  // 东墙（厨房）
  W([K.kitchen.x1, K.kitchen.z0], [K.kitchen.x1, 0]);
  // 北墙（客厅：卧室门洞；厨房）
  W([K.living.x0, K.living.z0], [K.bedroomGap.x0, K.living.z0]);
  W([K.bedroomGap.x1, K.living.z0], [K.kitchen.x1, K.living.z0]);
  W([K.bedroomGap.x0, K.living.z0], [K.bedroomGap.x1, K.living.z0], K.bedroomGap.h, H);
  // 客厅—厨房隔墙（x=5，两面）
  const P = K.kitchenGap;
  for (const [a, c] of [[[5, K.living.z0], [5, P.z0]], [[5, P.z1], [5, 0]]] as const) {
    W([a[0] - 0.06, c[1]], [a[0] - 0.06, a[1]]);
    W([a[0] + 0.06, a[1]], [a[0] + 0.06, c[1]]);
  }
  W([4.94, P.z1], [4.94, P.z0], P.h, H);
  W([5.06, P.z0], [5.06, P.z1], P.h, H);
  b.box(plaster, 0.12, 0.05, P.z1 - P.z0, 5, P.h, (P.z0 + P.z1) / 2);
  // 卧室三面墙 + 客厅北墙的另一面
  W([K.bedroom.x0, K.bedroom.z1], [K.bedroom.x0, K.bedroom.z0]);
  W([K.bedroom.x0, K.bedroom.z0], [K.bedroom.x1, K.bedroom.z0]);
  W([K.bedroom.x1, K.bedroom.z0], [K.bedroom.x1, K.bedroom.z1]);
  W([K.bedroom.x1, K.bedroom.z1 + 0.001], [K.bedroomGap.x1, K.bedroom.z1 + 0.001]);
  W([K.bedroomGap.x0, K.bedroom.z1 + 0.001], [K.bedroom.x0, K.bedroom.z1 + 0.001]);
  // 踢脚线
  b.box(darkWood, 7.5, 0.1, 0.015, 3.75, 0.05, -0.008);
  b.box(darkWood, 5, 0.1, 0.015, 2.5, 0.05, K.living.z0 + 0.008);
  // —— 窗
  windowAt(b, win, K.winLiving.x0, K.winLiving.x1, K.winLiving.y0, K.winLiving.y1, 0, 'z-');
  windowAt(b, { ...win, view: moonView2 }, K.winKitchen.x0, K.winKitchen.x1, K.winKitchen.y0, K.winKitchen.y1, 0, 'z-');
  windowAt(b, { ...win, view: moonView2 }, K.winBed.x0, K.winBed.x1, K.winBed.y0, K.winBed.y1, K.bedroom.z0, 'z+');
  // 月光的光柱（加法、很淡）：从南窗斜着照进屋里
  const beamTex = paintTexture(64, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    const side = g.createLinearGradient(0, 0, w, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)');
    side.addColorStop(0.3, 'rgba(0,0,0,0)');
    side.addColorStop(0.7, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = side;
    g.fillRect(0, 0, w, h);
  }, { mask: true });
  const beamMat = new THREE.MeshBasicMaterial({ color: '#7d92b8', alphaMap: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.16, side: THREE.DoubleSide });
  beamMat.userData.tempC = TEMP_C.ambient;
  const beam = (x: number, w: number, top: number, len: number) => {
    const g = new THREE.PlaneGeometry(w, len);
    g.translate(0, -len / 2, 0);
    const m = new THREE.Mesh(g, beamMat);
    m.position.set(x, top, -0.05);
    m.rotation.x = 0.72;
    m.userData.irHide = true;
    m.userData.noOcclude = true;
    m.renderOrder = 2;
    m.raycast = () => undefined;
    grp.add(m);
  };
  beam(2.6, 1.5, K.winLiving.y1 - 0.05, 2.6);
  beam(5.95, 0.85, K.winKitchen.y1 - 0.05, 2.1);
  // 月光落在地上（客厅：窗格影子斜斜地铺到屋里）
  // 客厅：窗格影子斜斜地铺到窗下缝纫机站过的地方（进门一眼看见那块干净的印子）；厨房：灶台前；卧室：北窗的月光落在床板上
  b.decalFlat(moonPatch, 1.9, 1.7, 3.2, 0.006, -1.3, true);
  b.decalFlat(moonPatch, 1.0, 0.9, 5.95, 0.006, -1.15, true);
  b.decalFlat(moonPatch, 1.1, 1.0, 1.55, 0.492, -5.75, true);

  // —— 客厅：挂历、相框印、挂钟、电线、灯头、剩下的几样东西
  const cal = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.54), newMat({ map: calendarTexture(), roughness: 0.85, tempC: TEMP_C.paper }));
  cal.position.set(K.calendar[0], K.calendar[1], K.calendar[2]);
  cal.rotation.y = Math.PI;
  cal.rotation.z = 0.03;
  grp.add(cal);
  b.cyl(iron, 0.004, 0.004, 0.03, K.calendar[0], K.calendar[1] + 0.29, K.calendar[2] + 0.01, 4, 90, 0);
  b.decal(marks, 0.9, 0.45, 1.2, 1.55, K.living.z0 + 0.012, 'z+', [0, 0, 0.45, 1]);
  b.decal(marks, 0.36, 0.45, 4.93, 0.95, -0.17, 'x-', [0.55, 0, 0.9, 1]);
  // 挂钟（北墙，钟摆盒）
  const clockX = 3.3, clockY = 1.95, clockZ = K.living.z0 + 0.06;
  b.box(darkWood, 0.34, 0.62, 0.1, clockX, clockY - 0.12, clockZ);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.13, 24), newMat({ map: clockTexture(), roughness: 0.6 }));
  face.position.set(clockX, clockY, clockZ + 0.052);
  grp.add(face);
  const hands: THREE.Object3D[] = [];
  for (const [len, wd] of [[0.08, 0.012], [0.11, 0.007]] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(clockX, clockY, clockZ + 0.056);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(wd, len, 0.003), black);
    hand.position.y = len / 2;
    pivot.add(hand);
    grp.add(pivot);
    hands.push(pivot);
  }
  const pend = new THREE.Group();
  pend.position.set(clockX, clockY - 0.16, clockZ + 0.056);
  const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.006, 16).rotateX(Math.PI / 2), newMat({ color: '#9c7a2a', roughness: 0.55, metalness: 0.5 }));
  bob.position.y = -0.22;
  pend.add(bob);
  const rodM = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.22, 0.003), black);
  rodM.position.y = -0.11;
  pend.add(rodM);
  grp.add(pend);
  hands.push(pend);
  // 灯头（光秃秃，不亮）与明线、开关
  b.cyl(plaster, 0.06, 0.06, 0.02, 2.5, H - 0.01, -2, 12);
  b.cyl(black, 0.004, 0.004, 0.45, 2.5, H - 0.24, -2, 4);
  b.cyl(MATERIALS.porcelain(), 0.025, 0.03, 0.06, 2.5, H - 0.49, -2, 10);
  b.box(plaster, 0.02, 0.012, 2.0, 2.5, H - 0.006, -1.0);
  b.box(newMat({ color: '#e4dcc4', roughness: 0.55 }), 0.08, 0.12, 0.02, 0.3, 1.35, -1.36 - 0.1);
  // 剩下的：墙角一个纸箱、一摞旧报纸、一把旧扫帚
  b.box(newMat({ color: '#9c7a4e', roughness: 0.95 }), 0.5, 0.36, 0.4, 4.55, 0.18, -3.6, 18);
  b.box(paper, 0.42, 0.06, 0.3, 0.7, 0.03, -3.5, -12);
  b.box(paper, 0.4, 0.04, 0.3, 0.72, 0.08, -3.48, -4);
  b.rod(wood, new THREE.Vector3(4.85, 0.1, -0.12), new THREE.Vector3(4.9, 1.2, -0.08), 0.013);

  // —— 厨房：灶台（砌筑块，正面瓷砖）、三块新瓷砖、煤气灶、灶君与对联
  const C = K.counter;
  const cx = (C.x0 + C.x1) / 2, cz = (C.z0 + C.z1) / 2;
  const counter = new THREE.Group();
  counter.name = 'counter';
  const body = new THREE.Mesh(new THREE.BoxGeometry(C.x1 - C.x0, C.h, C.z1 - C.z0), concrete);
  body.position.set(cx, C.h / 2, cz);
  counter.add(body);
  const top = new THREE.Mesh(new THREE.BoxGeometry(C.x1 - C.x0 + 0.05, 0.035, C.z1 - C.z0 + 0.04), newMat({ color: '#5d605c', roughness: 0.55 }));
  top.position.set(cx - 0.025, C.h + 0.0175, cz);
  counter.add(top);
  grp.add(counter);
  // 正面瓷砖（格子对齐：列从 z=-2.3 起每 0.2m、行从 y=0.15 起每 0.2m——新瓷砖正好各占一格）
  b.box(concrete, 0.02, 0.15, C.z1 - C.z0, C.x0 - 0.01, 0.075, cz);
  b.wall(tiles, [C.x0 - 0.004, C.z0], [C.x0 - 0.004, C.z1], 0.15, C.h, { floorY: 0.15, uMeters: 0.8, vMeters: 0.8 });
  // 灶台上方的东墙贴一截瓷砖（列从 z=-2.4 起、行从 y=0.75 起，灶君正下方那块正好在格子里）
  b.wall(tiles, [C.x1 - 0.004, C.z0], [C.x1 - 0.004, C.z1], C.h, 1.35, { floorY: 0.75, uMeters: 0.8, vMeters: 0.8, uOffset: 0.125 });
  // 灶台正面低处的两块（离地 0.25m）各挂一个不绘制的拾取代理盒（M4 第 2 轮）：贴着灶台正面，往西伸 0.14m、从 0.15m 一直到 1.32m 高、
  // 宽 0.26m。厨房只有 2.5m 宽：第三人称俯仰到底（-35°）时中心射线在灶台正面前头还有 0.9–1.3m 高、取景器凑太近俯仰卡在 -60° 时
  // 落在砖前的地上，都够不到砖本身；代理盒让这两种射线先打到它（锚点仍在砖面上，交互物的 hit 是砖，代理是它的子节点）。
  // 两块砖在 z=-2.0 与 -1.0，代理盒各占 ±0.13m：中间 z=-1.5 一带（煤气灶、灶君、上面那块砖）的射线不受影响。
  const PROXY_D = 0.14, PROXY_Y0 = 0.15, PROXY_Y1 = 1.32;
  const lowProxy = new THREE.BoxGeometry(PROXY_D, PROXY_Y1 - PROXY_Y0, 0.26);
  const tile = (p: readonly [number, number, number], name: string, proxy: boolean) => {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.19, 0.19), newTile);
    t.position.set(p[0] - 0.01, p[1], p[2]);
    t.name = name;
    if (proxy) {
      const hp = new THREE.Mesh(lowProxy, MATERIALS.hitProxy());
      hp.name = `${name}Hit`;
      // 砖面（西面）在局部 x = -0.006；盒子底 PROXY_Y0、顶 PROXY_Y1（世界高度）
      hp.position.set(-0.006 - PROXY_D / 2, (PROXY_Y0 + PROXY_Y1) / 2 - p[1], 0);
      t.add(hp);
    }
    grp.add(t);
    return t;
  };
  const tl = tile(K.tileLeftLow, 'tileLeftLow', true);
  const tr = tile(K.tileRightLow, 'tileRightLow', true);
  const tt = tile([K.tileTop[0] + 0.045, K.tileTop[1], K.tileTop[2]], 'tileTop', false);
  // 抠开之后的砖洞与拿出来的铁盒
  const hole = new THREE.Group();
  hole.name = 'tileHole';
  const hm = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.19, 0.19), black);
  hm.position.set(K.tileLeftLow[0] - 0.002, K.tileLeftLow[1], K.tileLeftLow[2]);
  hole.add(hm);
  const loose = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.012, 0.19), newTile);
  loose.position.set(K.tileLeftLow[0] - 0.35, 0.006, K.tileLeftLow[2] + 0.1);
  loose.rotation.y = 0.4;
  hole.add(loose);
  hole.visible = false;
  grp.add(hole);
  const tin = new THREE.Group();
  tin.name = 'tinBox';
  const tinMat = newMat({ map: tinTexture(), roughness: 0.45, metalness: 0.4, tempC: 15 });
  const tinBody = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.26), newMat({ color: '#1e3f7a', roughness: 0.45, metalness: 0.4 }));
  tinBody.position.set(6.85, C.h + 0.075, -2.05);
  tin.add(tinBody);
  const lid = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.2), tinMat);
  lid.rotation.set(-Math.PI / 2 + 0.25, 0, Math.PI / 2);
  lid.position.set(6.72, C.h + 0.12, -2.05);
  tin.add(lid);
  tin.visible = false;
  grp.add(tin);
  // 煤气灶（正面朝西）与灶火（青色，GDD §4.3 STOVE）
  const stove = PROPS.stove();
  stove.position.set(7.02, C.h + 0.035, cz);
  stove.rotation.y = Math.PI / 2;
  // 煤气灶、灶火、那锅馄饨都挂在灶台组下（M4 第 2 轮）：它们是 r2.stove 拾取网格的一部分——原来是挡射线的布景，
  // 准星对着煤气灶反而选不中“灶台”
  counter.add(stove);
  const fire = new THREE.Group();
  fire.name = 'stoveFire';
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.STOVE).multiplyScalar(4), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
  flameMat.userData.tempC = TEMP_C.lamp;
  const flames: THREE.Mesh[] = [];
  for (const dz of [-0.17, 0.17]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.08, 5), flameMat);
      f.position.set(7.02 + Math.cos(a) * 0.055, C.h + 0.2, cz + dz + Math.sin(a) * 0.055);
      fire.add(f);
      flames.push(f);
    }
  }
  fire.visible = false;
  counter.add(fire);
  // 煮好的馄饨：一口铝锅冒着热气、一只蓝边碗
  const cooked = new THREE.Group();
  cooked.name = 'wonton';
  const potMat = newMat({ color: '#b8bcbf', roughness: 0.5, metalness: 0.6, tempC: 70 });
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.14, 18, 1, true), potMat);
  pot.material.side = THREE.DoubleSide;
  pot.position.set(7.02, C.h + 0.3, cz - 0.17);
  cooked.add(pot);
  const soup = new THREE.Mesh(new THREE.CircleGeometry(0.14, 18).rotateX(-Math.PI / 2), newMat({ color: '#d9cfa8', roughness: 0.3, tempC: 70 }));
  soup.position.set(7.02, C.h + 0.34, cz - 0.17);
  cooked.add(soup);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.05, 0.06, 16), newMat({ color: '#f1efe6', roughness: 0.3, tempC: 55 }));
  bowl.position.set(6.8, C.h + 0.065, cz + 0.45);
  cooked.add(bowl);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.006, 6, 18).rotateX(Math.PI / 2), newMat({ color: '#2b58a8', roughness: 0.3 }));
  rim.position.set(6.8, C.h + 0.095, cz + 0.45);
  cooked.add(rim);
  const steamMat = new THREE.MeshBasicMaterial({ color: '#c8d0d8', transparent: true, opacity: 0.12, depthWrite: false });
  for (let i = 0; i < 3; i++) {
    const st = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.5), steamMat);
    st.position.set(7.02 - 0.05 * i, C.h + 0.62 + i * 0.05, cz - 0.17 + 0.04 * i);
    st.rotation.y = Math.PI / 2 + i * 0.6;
    st.userData.irHide = true;
    st.userData.noOcclude = true;
    cooked.add(st);
  }
  cooked.visible = false;
  counter.add(cooked);

  // 灶君纸像（东墙，朝西）+ 对联 + 取景器里的描金与眼珠（yin 层）
  const zaojun = new THREE.Group();
  zaojun.name = 'zaojun';
  const ZW = 0.5, ZH = 0.667;
  // 纸像带一点点自发光（同 R2 的招牌）：月光底下也认得出年画的红绿金，取景器里描金更显
  const zTex = zaojunTexture();
  const zp = new THREE.Mesh(new THREE.PlaneGeometry(ZW, ZH), newMat({ map: zTex, emissiveMap: zTex, emissive: '#ffffff', emissiveIntensity: 0.16, roughness: 0.9, tempC: TEMP_C.paper }));
  zaojun.add(zp);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(ZW, ZH), MATERIALS.paperGlow());
  glow.position.z = 0.003;
  glow.renderOrder = 15;
  glow.userData.noOcclude = true;
  setLayerRecursive(glow, 'yin');
  zaojun.add(glow);
  // 取景器里神像的眼白发亮（阴物层）：比熏黄的纸亮得多，但压在 Bloom 阈值以下——M4 放大眼白之后，×1.05 已经整片晕开、
  // 把眼珠糊成灰的，眼珠往哪儿瞟反而看不清
  const eyeWhite = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4d8').multiplyScalar(0.7) });
  eyeWhite.userData.tempC = TEMP_C.paper;
  const pupilMat = new THREE.MeshBasicMaterial({ color: '#0c0808' });
  pupilMat.userData.tempC = TEMP_C.paper;
  // 叠层的眼睛比纸上画的大一圈（整个盖住纸上的眼睛）：两只眼各自从脸的中线往外摆，眼白之间留一条缝，外沿不出脸
  // （eyeDX + whiteHalfW ≤ 脸半宽 ZAO_EYES.faceHalfW × ZW ≈ 0.0508；eyeDX > whiteHalfW）
  const O = ZAO_OVERLAY;
  const pupils: { mesh: THREE.Mesh; home: THREE.Vector3 }[] = [];
  for (const pair of [ZAO_EYES.wang, ZAO_EYES.nainai]) {
    const faceX = ((pair[0][0] + pair[1][0]) / 2 - 0.5) * ZW;
    for (const [i, [, v]] of pair.entries()) {
      const lx = faceX + (i === 0 ? -1 : 1) * O.eyeDX, ly = (v - 0.5) * ZH;
      const wm = new THREE.Mesh(new THREE.CircleGeometry(1, 24), eyeWhite);
      wm.scale.set(O.whiteHalfW, O.whiteHalfH, 1);
      wm.position.set(lx, ly, 0.002);
      setLayerRecursive(wm, 'yin');
      zaojun.add(wm);
      // 眼珠比纸上画的大：眼白微微泛光时，Bloom 晕不进眼珠中间
      const pm = new THREE.Mesh(new THREE.CircleGeometry(O.pupil, 18), pupilMat);
      pm.position.set(lx, ly, 0.004);
      setLayerRecursive(pm, 'yin');
      zaojun.add(pm);
      pupils.push({ mesh: pm, home: pm.position.clone() });
    }
  }
  zaojun.position.set(K.zaojun[0] + 0.04, K.zaojun[1], K.zaojun[2]);
  zaojun.rotation.y = -Math.PI / 2;
  ctx.add(zaojun, { parent: grp, ref: OBJ.R2_ZAOJUN, tempC: TEMP_C.paper });
  const cTex = coupletTexture();
  const cmat = newMat({ map: cTex, emissiveMap: cTex, emissive: '#ffffff', emissiveIntensity: 0.14, roughness: 0.9, tempC: TEMP_C.paper });
  for (const [dz, u0] of [[-0.36, 0], [0.36, 0.5]] as const) {
    const g = new THREE.PlaneGeometry(0.12, 0.62);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * 0.5);
    const cm = new THREE.Mesh(g, cmat);
    cm.position.set(K.zaojun[0] + 0.043, K.zaojun[1] - 0.02, K.zaojun[2] + dz);
    cm.rotation.y = -Math.PI / 2;
    grp.add(cm);
  }
  // 厨房里别的：灶台后墙上熏黑的一片（灶君纸像就贴在烟熏里，瓷砖以上）、顶棚上一圈、一根煤气管、一个挂钩
  const soot = decalMat(sootTexture());
  b.decal(soot, 1.4, 1.3, 7.494, 2.0, -1.5, 'x-');
  b.decalFlat(soot, 1.1, 1.3, 6.95, H - 0.004, -1.5, false);
  b.box(iron, 0.03, 1.9, 0.03, 7.45, 1.7, -2.6);
  b.box(iron, 0.03, 0.03, 0.9, 7.45, 0.9, -2.2);

  // —— 卧室：只剩一个床架
  const bedX = 1.35, bedZ = -6.0;
  b.box(darkWood, 1.5, 0.08, 2.0, bedX, 0.42, bedZ);
  for (const [x, z] of [[-0.7, -0.95], [0.7, -0.95], [-0.7, 0.95], [0.7, 0.95]] as const) b.box(darkWood, 0.07, 0.46, 0.07, bedX + x, 0.23, bedZ + z);
  b.box(darkWood, 1.5, 0.7, 0.06, bedX, 0.8, bedZ - 0.98);
  for (let i = 0; i < 9; i++) b.box(wood, 1.4, 0.02, 0.1, bedX, 0.47, bedZ - 0.9 + i * 0.22);
  b.decalFlat(dust, 2.2, 2.4, 1.5, 0.004, -5.4, true, [0.7, 0.8, 1.0, 1.0]);
  ctx.collider.box([bedX, 0.4, bedZ], [1.55, 0.8, 2.05]);

  // —— 入户门（开着，门神贴在外面）与门外的楼梯平台
  const entry = door({ w: 0.9, h: 2.05, style: 'security', at: [0, 0, -0.8], yaw: 270, hinge: 'right' });
  entry.setOpen(1);
  grp.add(entry.group);
  b.flat(MATERIALS.concrete(), -1.7, -1.8, 0, 0.2, 0, true, 2);
  b.flat(ceiling, -1.7, -1.8, 0, 0.2, H, false, 2);
  b.wall(MATERIALS.dado(), [-1.7, 0.2], [-1.7, -1.8], 0, H, { floorY: 0 });
  b.wall(MATERIALS.dado(), [-1.7, -1.8], [0, -1.8], 0, H, { floorY: 0 });
  b.wall(MATERIALS.dado(), [0, 0.2], [-1.7, 0.2], 0, H, { floorY: 0 });

  // —— 残影点旋涡（取景器里）
  const v = createResidueVortex();
  v.position.set(K.rpKitchen[0], 0.02, K.rpKitchen[2]);
  grp.add(v);

  // —— 读信过场的道具：王奶奶手上那页信（写着信的最后三段，近景里看得清字；月光底下微微自发光）、化成的一点光。
  // 位置与朝向每帧由 logic.ts 按王奶奶的站位摆（正面朝她的眼睛）
  const lTex = letterTexture();
  const letter = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.27),
    newMat({ map: lTex, emissiveMap: lTex, emissive: '#ffffff', emissiveIntensity: 0.3, roughness: 0.9, side: THREE.DoubleSide, tempC: TEMP_C.paper }));
  letter.name = 'letterPage';
  letter.position.set(K.wang[0] + 0.25, 1.05, K.wang[2] - 0.12);
  letter.visible = false;
  grp.add(letter);
  const orbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2d8').multiplyScalar(6), transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
  orbMat.userData.tempC = TEMP_C.yin;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), orbMat);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0').multiplyScalar(1.4), transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
  orb.add(halo);
  orb.visible = false;
  orb.userData.noOcclude = true;
  orb.userData.irHide = true;
  grp.add(orb);

  const meshes = b.flush(grp, 'apt');
  for (const mm of meshes) if (mm.material === moonView || mm.material === moonView2 || mm.material === moonPatch || mm.material === glass) mm.userData.noOcclude = true;
  for (const mm of meshes) if (mm.material === moonPatch) mm.userData.irHide = true;
  ctx.add(grp);
  return {
    zaojun, pupils, tiles: { left: tl, right: tr, top: tt }, hole, tin, counter, fire, flames, cooked, calendar: cal, entry, orb, letter, clockHands: hands,
    windowViews: [moonView, moonView2],
  };
}

/** 碰撞：地面、四周墙（门洞除外）、隔墙、灶台、门外平台。 */
export function aptColliders(ctx: AreaContext): void {
  const c = ctx.collider;
  const K = L502;
  const T = 0.2;
  c.floor(-1.8, -7.1, 7.6, 0.3, 0);
  // 顶棚（M4 第 2 轮）：第三人称相机只躲碰撞体——没有这块板，低头时相机升到顶棚上面（离地 3.3m），整套房子像从天花板上
  // 往下看的模型，准星也够不着灶台正面低处的瓷砖。板底贴着顶棚 H
  c.floor(-1.8, -7.1, 7.6, 0.3, H + 0.2);
  // 西墙（门洞 z:-1.25~-0.35）
  c.wall([-T / 2, K.living.z0 - 0.1], [-T / 2, K.entry.z0], 0, H, T);
  c.wall([-T / 2, K.entry.z1], [-T / 2, 0.1], 0, H, T);
  // 南墙、东墙
  c.wall([-0.1, T / 2], [7.6, T / 2], 0, H, T);
  c.wall([7.5 + T / 2, -4.1], [7.5 + T / 2, 0.1], 0, H, T);
  // 北墙（卧室门洞）、卧室
  c.wall([-0.1, -4 - T / 2], [K.bedroomGap.x0, -4 - T / 2], 0, H, T);
  c.wall([K.bedroomGap.x1, -4 - T / 2], [7.6, -4 - T / 2], 0, H, T);
  c.wall([-T / 2, -7.1], [-T / 2, -4], 0, H, T);
  c.wall([-0.1, -7 - T / 2], [3.5, -7 - T / 2], 0, H, T);
  c.wall([3.4 + T / 2, -7.1], [3.4 + T / 2, -4], 0, H, T);
  // 隔墙（门洞 z:-2.6~-0.35）
  c.wall([5, -4], [5, K.kitchenGap.z0], 0, H, 0.12);
  c.wall([5, K.kitchenGap.z1], [5, 0], 0, H, 0.12);
  // 三个门洞上方的过梁（M4 第 2 轮）：原来门洞上方的墙只有画面、没有碰撞体，第三人称相机在厨房里低头时退进厨房门洞的过梁里
  // （离地 2.5m、墙里头），中心射线先打在墙上，准星什么都选不中
  const lintel = (x: number, z: number, sx: number, sz: number, h: number) => c.box([x, (h + H) / 2, z], [sx, H - h, sz]);
  lintel(5, (K.kitchenGap.z0 + K.kitchenGap.z1) / 2, 0.12, K.kitchenGap.z1 - K.kitchenGap.z0, K.kitchenGap.h);
  lintel((K.bedroomGap.x0 + K.bedroomGap.x1) / 2, -4, K.bedroomGap.x1 - K.bedroomGap.x0, T, K.bedroomGap.h);
  lintel(-T / 2, (K.entry.z0 + K.entry.z1) / 2, T, K.entry.z1 - K.entry.z0, K.entry.h);
  // 灶台
  c.box([(K.counter.x0 + K.counter.x1) / 2, 0.45, (K.counter.z0 + K.counter.z1) / 2], [K.counter.x1 - K.counter.x0, 0.9, K.counter.z1 - K.counter.z0]);
  // 门外平台（出口触发体 x∈[-1.5,0]）
  c.wall([-1.7 - T / 2, -1.9], [-1.7 - T / 2, 0.3], 0, H, T);
  c.wall([-1.8, -1.8 - T / 2], [0, -1.8 - T / 2], 0, H, T);
  c.wall([-1.8, 0.2 + T / 2], [0, 0.2 + T / 2], 0, H, T);
}
