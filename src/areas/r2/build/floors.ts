// owner: R2
// R2 的五个楼层节点（GDD §4.2）：每层一段走廊 x:-5~5、z:0~2.5（一楼连门厅 z:2.5~5），北侧楼梯井（上跑在西、下跑在东、
// 半层平台上是“停用”的加装电梯门），东西两端各一户防盗门（n01 东、n02 西），走廊中央顶棚一盏声控灯。
// 每层的静态件按材质合并（Batch），只有门、灯、道具组、NPC 另占 draw call；只渲染当前楼层（LevelsDef.onChange 切显隐）。
// 碰撞：每层地面、四周墙（门洞与楼梯口除外）、楼梯井挡块（0.7m 高，挡人不挡视线），502 门是动态碰撞体（门神放行前挡人）。

import * as THREE from 'three';
import type { AreaContext } from '../../../core/area';
import type { XZ } from '../../../core/types';
import { F, OBJ } from '../../../data/ids';
import { MATERIALS } from '../../../fx/materials';
import { setLayerRecursive } from '../../../core/layers';
import { door, type DoorRig } from '../../../kit/doors';
import { lamp, type LampRig } from '../../../kit/lamps';
import { PROPS } from '../../../kit/props';
import { createFootprints, createResidueVortex } from '../../../kit/residue';
import { rng, range } from '../../../kit/rng';
import { Batch, flight } from './batch';
import type { R2Mats } from './mats';
import { CEIL, FLOORS, R2, levelY } from '../layout';
import { boxes, briquettes, broom, doormat, flowerPot, lampFixture, menshenPair, pickleJar, shoeRack, spittoon, stroller, tricycle, umbrella } from './props';

export interface FloorRig {
  n: number;
  y: number;
  group: THREE.Group;
  /** 声控灯（kit hall_bulb，只有 emissive；真实光是区域里复用的那一盏） */
  lamp: LampRig;
  /** r2.lamp_nf 的拾取网格 */
  lampHit: THREE.Object3D;
  /** 三楼的空灯座（装灯泡之前） */
  socket: THREE.Object3D | null;
  /** 这一盏灯的脾气：亮度与接触不良的频闪（四楼） */
  level: number;
  flicker: number;
  doorW: DoorRig;
  doorE: DoorRig;
}

export interface R2World {
  floors: FloorRig[];
  menshen: THREE.Group;
  door502: DoorRig;
  mailboxes: THREE.Object3D;
  donation: THREE.Object3D;
  /** 各层王奶奶的湿脚印（yin 层；到过这一层才显出来） */
  prints: THREE.Object3D[];
}

const T = 0.2;   // 碰撞墙厚

function colliders(ctx: AreaContext, n: number): void {
  const y = levelY(n);
  const c = ctx.collider;
  const zS = n === 1 ? R2.lobby.z1 : R2.corridor.z1;
  // 地面（伸到楼梯口挡块下面一点）
  c.floor(-5.2, -0.3, 5.2, zS, y);
  // 顶棚（第三人称相机的球形避障靠它，不然相机会钻到顶棚上面去）。
  // 楼梯井顶只给五楼：五个楼层的碰撞体同时都在，n 层的井顶（y+4.1~4.3）正好横在 n+1 层楼梯口离地 1.3–1.5m 处，
  // 会挡住 n+1 层对楼梯的视线与交互；一到四楼的井里有上一层的挡块（y+2.8 起）当顶。
  c.floor(-5.2, 0, 5.2, zS, y + CEIL + 0.1);
  if (n === FLOORS) c.floor(R2.well.x0, R2.well.z0, R2.well.x1, 0, y + 4.2 + 0.1);
  // 北墙（楼梯口两侧）
  c.wall([-5.2, -T / 2], [-1.5, -T / 2], y, 2.8, T);
  c.wall([1.5, -T / 2], [5.2, -T / 2], y, 2.8, T);
  // 楼梯井挡块：0.7m 高（挡人；视线从上面过得去），面朝走廊的一面在 z=-0.25
  c.box([0, y + 0.35, -2.425], [3.0, 0.7, 4.35]);
  // 南墙
  if (n === 1) {
    c.wall([-5.2, zS + T / 2], [-0.65, zS + T / 2], y, 2.8, T);
    c.wall([0.65, zS + T / 2], [5.2, zS + T / 2], y, 2.8, T);
    // 单元门外的门廊（出口触发体 z∈[5,6.5]）
    c.floor(-1.1, zS, 1.1, 7.0, y);
    c.wall([-1.0 - T / 2, zS], [-1.0 - T / 2, 7.0], y, 2.8, T);
    c.wall([1.0 + T / 2, zS], [1.0 + T / 2, 7.0], y, 2.8, T);
    c.wall([-1.1, 6.9 + T / 2], [1.1, 6.9 + T / 2], y, 2.8, T);
  } else {
    c.wall([-5.2, zS + T / 2], [5.2, zS + T / 2], y, 2.8, T);
  }
  // 西墙（五楼 502 门洞）
  if (n === 5) {
    c.wall([-5 - T / 2, -0.2], [-5 - T / 2, 0.72], y, 2.8, T);
    c.wall([-5 - T / 2, 1.68], [-5 - T / 2, zS + 0.2], y, 2.8, T);
    // 502 门里的小门斗（出口触发体 x∈[-6.5,-5]）
    c.floor(-6.8, 0.5, -5, 1.9, y);
    c.wall([-6.8, 0.62 - T / 2], [-5, 0.62 - T / 2], y, 2.8, T);
    c.wall([-6.8, 1.78 + T / 2], [-5, 1.78 + T / 2], y, 2.8, T);
    c.wall([-6.75 - T / 2, 0.5], [-6.75 - T / 2, 1.9], y, 2.8, T);
  } else {
    c.wall([-5 - T / 2, -0.2], [-5 - T / 2, zS + 0.2], y, 2.8, T);
  }
  c.wall([5 + T / 2, -0.2], [5 + T / 2, zS + 0.2], y, 2.8, T);
}

/** 楼梯内侧栏杆：每级一根铁栏杆 + 斜木扶手。 */
function railing(b: Batch, m: R2Mats, x: number, y0: number, z0: number, dir: -1 | 1, steps: number, rise: number, run: number): void {
  const top = (i: number) => y0 + (i + 1) * rise;
  for (let i = 0; i < steps; i++) {
    const z = z0 + dir * (i + 0.5) * run;
    b.box(m.iron, 0.018, 0.9, 0.018, x, top(i) + 0.45, z);
  }
  const a = new THREE.Vector3(x, y0 + rise + 0.92, z0 + dir * 0.15);
  const e = new THREE.Vector3(x, top(steps - 1) + 0.92, z0 + dir * (steps - 0.5) * run);
  b.rod(m.handrail, a, e, 0.03, 6, true);
  b.rod(m.iron, a.clone().setY(a.y - 0.75), e.clone().setY(e.y - 0.75), 0.012);
}

/** 加装电梯的门（停用）：平台北墙右半（x≈0.72）、平台地面 yf；两扇不锈钢门、门框、呼叫按钮、警示带、停用纸条；检修通知贴在东井壁上。 */
function elevatorDoor(b: Batch, m: R2Mats, yf: number): void {
  const z = R2.well.z0 + 0.03, x = R2.elevatorX;
  b.box(m.steel, 1.08, 2.3, 0.06, x, yf + 1.15, z);
  b.box(m.metal, 0.44, 2.05, 0.03, x - 0.225, yf + 1.025, z + 0.045);
  b.box(m.metal, 0.44, 2.05, 0.03, x + 0.225, yf + 1.025, z + 0.045);
  b.box(m.black, 0.012, 2.05, 0.035, x, yf + 1.025, z + 0.05);
  // 呼叫面板（门框右边）
  b.box(m.steel, 0.08, 0.2, 0.02, x + 0.62, yf + 1.1, z + 0.02);
  b.cyl(m.black, 0.018, 0.018, 0.012, x + 0.62, yf + 1.12, z + 0.035, 10, 90);
  // 警示带（X）与“停用”纸条
  b.box(m.redPlastic, 1.2, 0.06, 0.01, x, yf + 1.1, z + 0.075, 0, 0, 58);
  b.box(m.redPlastic, 1.2, 0.06, 0.01, x, yf + 1.1, z + 0.075, 0, 0, -58);
  // “停用”纸条贴在门扇左半、齐胸高：从走廊顺着上跑看过去，右上方那跑楼梯的底板挡不住它
  b.decal(m.signs, 0.46, 0.28, x - 0.12, yf + 1.28, z + 0.085, 'z+', m.atlas.rect('stop'), -4);
  b.decal(m.signs, 0.3, 0.43, R2.well.x1 - 0.012, yf + 1.5, -3.6, 'x-', m.atlas.rect('notice'), 2);
}

/** 半层平台北墙左半的窗（窗外是院子里的钠灯，HDR：从每一层的走廊往楼梯上看都亮着一块，引人往上走）。 */
function wellWindow(b: Batch, m: R2Mats, yf: number): void {
  const z = R2.well.z0 + 0.02, xc = R2.windowX, yc = yf + 1.75, w = 1.15, h = 1.0;
  b.decal(m.landingWin, w, h, xc, yc, z + 0.005, 'z+');
  b.decal(m.glass, w, h, xc, yc, z + 0.03, 'z+');
  // 窗框、窗台、中梃
  b.box(m.darkWood, w + 0.12, 0.06, 0.22, xc, yc - h / 2 - 0.03, z + 0.09);
  b.box(m.darkWood, w + 0.08, 0.05, 0.07, xc, yc + h / 2, z + 0.035);
  for (const x of [xc - w / 2, xc, xc + w / 2]) b.box(m.darkWood, 0.05, h, 0.07, x, yc, z + 0.035);
  b.box(m.darkWood, w, 0.04, 0.06, xc, yc + 0.22, z + 0.035);
  // 窗台上的一盆早就枯了的吊兰、一只玻璃瓶
  b.at(xc + 0.28, yc - h / 2, z + 0.1, 0, () => flowerPot(b, m, false, 77), 0.7);
  b.cyl(m.glass, 0.03, 0.035, 0.18, xc - 0.3, yc - h / 2 + 0.09, z + 0.1, 8);
}

function buildWell(b: Batch, m: R2Mats, n: number): void {
  const y = levelY(n);
  const W = R2.well, S = R2.stair;
  const yBot = n === 1 ? y - 0.05 : y - 1.6, yTop = y + 4.2;
  // 井壁（石灰）与平台墙上的墙裙
  b.wall(m.lime, [W.x0, W.z1], [W.x0, W.z0], yBot, yTop, { uMeters: 3 });
  b.wall(m.lime, [W.x1, W.z0], [W.x1, W.z1], yBot, yTop, { uMeters: 3 });
  b.wall(m.lime, [W.x0, W.z0], [W.x1, W.z0], yBot, yTop, { uMeters: 3 });
  b.wall(m.dado, [W.x0 + 0.001, W.z0 + 0.002], [W.x1, W.z0 + 0.002], y + 1.4, y + 2.7, { floorY: y + 1.4 });
  if (n > 1) b.wall(m.dado, [W.x0 + 0.001, W.z0 + 0.002], [W.x1, W.z0 + 0.002], y - 1.4, y - 0.1, { floorY: y - 1.4 });
  b.flat(m.ceiling, W.x0, W.z0, W.x1, W.z1, yTop, false, 2);
  // 走廊顶棚上方封住井口（朝北）+ 过梁
  b.wall(m.lime, [W.x1, W.z1], [W.x0, W.z1], y + CEIL, yTop);
  b.box(m.plaster, 3.1, 0.18, 0.24, 0, y + CEIL - 0.04, -0.02);
  // 上跑（西半，从本层往北爬到上半层平台）
  const rise = S.rise;
  flight(b, m.stairs, m.plaster, m.nosing, W.x0 + 0.05, -0.05, y, S.z0, -1, S.steps, rise, S.run);
  railing(b, m, -0.07, y, S.z0, -1, S.steps, rise, S.run);
  // 上半层平台
  b.box(m.stairs, 3.0, 0.22, S.landingZ - W.z0, 0, y + 1.4 - 0.11, (W.z0 + S.landingZ) / 2);
  b.box(m.plaster, 3.0, 0.12, 1.65, 0, y + 1.4 - 0.28, (W.z0 + S.landingZ) / 2);
  // 平台上一跑到上一层（东半，往南爬）——五楼是顶层：平台北墙是通天台的铁门
  if (n < FLOORS) {
    flight(b, m.stairs, m.plaster, m.nosing, 0.05, W.x1 - 0.05, y + 1.4, S.landingZ, 1, S.steps, rise, S.run);
    railing(b, m, 0.07, y + 1.4, S.landingZ, 1, S.steps, rise, S.run);
    elevatorDoor(b, m, y + 1.4);
  } else {
    // 天台铁门（锁着）
    const z = W.z0 + 0.04;
    b.box(m.iron, 0.95, 2.0, 0.06, 0, y + 1.4 + 1.0, z);
    for (let i = 0; i < 6; i++) b.box(m.rubber, 0.8, 0.02, 0.02, 0, y + 1.4 + 0.3 + i * 0.3, z + 0.04);
    b.box(m.metal, 0.08, 0.1, 0.04, 0.38, y + 1.4 + 1.0, z + 0.06);
    b.decal(m.signs, 0.5, 0.18, 0, y + 1.4 + 1.75, z + 0.07, 'z+', m.atlas.rect('roof'));
    // 楼梯口的铁栅门（挂锁）：五楼没有“上楼”
    const gz = S.z0 - 0.08;
    for (let i = 0; i <= 11; i++) b.box(m.iron, 0.022, 1.9, 0.022, W.x0 + 0.08 + i * 0.12, y + 0.95, gz);
    b.box(m.iron, 1.45, 0.04, 0.04, (W.x0 + 0.02) / 2 - 0.02, y + 1.88, gz);
    b.box(m.iron, 1.45, 0.04, 0.04, (W.x0 + 0.02) / 2 - 0.02, y + 0.12, gz);
    b.box(m.metal, 0.07, 0.09, 0.04, -0.2, y + 1.0, gz + 0.04);
    b.decal(m.signs, 0.42, 0.15, -0.75, y + 1.5, gz + 0.03, 'z+', m.atlas.rect('roof'), -3);
  }
  wellWindow(b, m, y + 1.4);
  // 下跑（东半）与下半层平台
  if (n > 1) {
    flight(b, m.stairs, m.plaster, m.nosing, 0.05, W.x1 - 0.05, y - 1.4, S.landingZ, 1, S.steps, rise, S.run);
    railing(b, m, 0.07, y - 1.4, S.landingZ, 1, S.steps, rise, S.run);
    b.box(m.stairs, 3.0, 0.22, S.landingZ - W.z0, 0, y - 1.4 - 0.11, (W.z0 + S.landingZ) / 2);
    elevatorDoor(b, m, y - 1.4);
    wellWindow(b, m, y - 1.4);
    // 再往下一跑（西半，往南下到下一层）只露出头几级
    flight(b, m.stairs, m.plaster, m.nosing, W.x0 + 0.05, -0.05, y - 2.8, S.z0, -1, S.steps, rise, S.run);
  } else {
    // 一楼东半：楼梯底下的水泥台阶（王奶奶坐在第一级台阶上，GDD §4.2；台阶 0.36m 高，正好一个坐的高度），再往里是杂物间
    b.box(m.stairs, 1.4, 0.36, 0.5, 0.75, 0.18, S.z0 - 0.25);
    b.box(m.stairs, 1.4, 0.52, 0.3, 0.75, 0.26, S.z0 - 0.65);
    b.box(m.stairs, 1.4, 0.68, 3.55, 0.75, 0.34, S.z0 - 0.8 - 1.775);
    b.box(m.nosing, 1.4, 0.018, 0.035, 0.75, 0.356, S.z0 - 0.0175);
    // 杂物间木门（东井壁上）
    b.box(m.darkWood, 0.05, 1.3, 0.8, W.x1 - 0.03, 0.68 + 0.65, -3.4);
    b.box(m.metal, 0.03, 0.08, 0.03, W.x1 - 0.07, 0.68 + 0.7, -3.1);
    b.decal(m.signs, 0.3, 0.15, W.x1 - 0.06, 0.68 + 1.05, -3.4, 'x-', m.atlas.rect('chalk'));
  }
}

/** 贴墙的海报/污渍/标牌（normal 朝房间里）。 */
function dressWalls(b: Batch, m: R2Mats, n: number, seed: number): void {
  const y = levelY(n);
  const r = rng(seed);
  const zS = n === 1 ? R2.lobby.z1 : R2.corridor.z1;
  // 小广告：北墙两段、南墙
  const posterSpots: [number, number, number, 'z+' | 'z-', number][] = [
    [-3.2, 1.25, 0.012, 'z+', 1.1], [2.9, 1.1, 0.012, 'z+', 0.9], [-1.9, 0.75, zS - 0.012, 'z-', 0.8],
  ];
  posterSpots.forEach(([x, h, z, nrm, s], i) => {
    const mat = (i + n) % 2 ? m.posters : m.posters2;
    b.decal(mat, s, s, x + range(r, -0.3, 0.3), y + h, z, nrm, [0, 0, 1, 1], range(r, -4, 4));
  });
  // 楼层号（北墙靠楼梯口西侧，红漆）
  b.decal(m.signs, 0.62, 0.31, -2.05, y + 1.85, 0.013, 'z+', m.atlas.rect(`floor${n}`));
  // 污渍：顶棚水渍、墙角蛛网、裂缝、鞋印、粉笔画
  const G = m.grimeRect;
  b.decalFlat(m.grime, 1.4, 1.4, range(r, -3, 3), y + CEIL - 0.004, range(r, 0.6, 1.9), false, G(n % 2 ? 0 : 4));
  b.decal(m.grime, 0.7, 0.7, -4.62, y + 2.3, 0.02, 'z+', G(6));
  b.decal(m.grime, 0.8, 0.8, 4.1, y + 1.7, 0.013, 'z+', G(1));
  b.decal(m.grime, 1.1, 0.45, range(r, -2, 2), y + 0.18, zS - 0.013, 'z-', G(5));
  if (n === 2 || n === 4) b.decal(m.grime, 0.7, 0.7, 3.4, y + 0.9, zS - 0.013, 'z-', G(3));
  if (n === 3 || n === 5) b.decal(m.grime, 0.6, 0.6, -0.6 - 1.4, y + 0.45, 0.014, 'z+', G(7));
  // 老楼的旧：灯头上方熏黑的一圈、顶上渗水顺墙淌下的竖痕、起壳掉皮、墙根返潮的霉点、楼梯口被肩膀蹭黑的一道
  const L = R2.lamp(n);
  b.decalFlat(m.grime, 0.9, 0.9, L[0], y + CEIL - 0.003, L[2], false, G(10));
  b.decal(m.grime, 0.9, 1.3, range(r, -4.6, -4.0), y + CEIL - 0.65, zS - 0.014, 'z-', G(n % 2 ? 9 : 14));
  b.decal(m.grime, 0.8, 1.2, range(r, 3.4, 4.4), y + CEIL - 0.6, 0.014, 'z+', G(n % 2 ? 14 : 9));
  b.decal(m.grime, 0.6, 0.45, n > 1 ? range(r, -1.8, -1.1) : range(r, -2.2, -1.3), y + range(r, 1.6, 2.2), zS - 0.014, 'z-', G(n % 2 ? 8 : 13), range(r, -20, 20));
  b.decal(m.grime, 1.0, 0.9, -4.5, y + 0.45, 0.014, 'z+', G(12));
  b.decal(m.grime, 1.0, 0.9, 4.5, y + 0.45, zS - 0.014, 'z-', G(15));
  b.decal(m.grime, 1.6, 0.35, -2.3, y + 1.3, 0.015, 'z+', G(11));
  b.decal(m.grime, 1.6, 0.35, 2.3, y + 1.3, 0.015, 'z+', G(11));

  // “贴满小广告”（GDD §4.2）：楼梯口两侧一撮一撮的小纸条、墙上喷的电话、物业刷白灰盖掉的一条、楼梯间一路盖上去的红章
  const A = m.adsAtlas;
  b.decal(m.ads, 1.0, 0.5, -3.75 + range(r, -0.2, 0.2), y + 1.45, 0.016, 'z+', A.rect('slips'), range(r, -3, 3));
  b.decal(m.ads, 0.9, 0.45, 2.25 + range(r, -0.15, 0.15), y + 1.2, 0.016, 'z+', A.rect('slips'), range(r, -3, 3));
  const sprayN = (['spray0', 'spray1', 'spray2'] as const)[n % 3] ?? 'spray0';
  const sprayS = (['spray0', 'spray1', 'spray2'] as const)[(n + 1) % 3] ?? 'spray1';
  b.decal(m.ads, 1.1, 0.275, 3.7 + range(r, -0.2, 0.2), y + 2.08, 0.015, 'z+', A.rect(sprayN), range(r, -2, 2));
  b.decal(m.ads, 1.2, 0.3, n === FLOORS ? -2.75 : range(r, -4.0, -2.9), y + 2.0, zS - 0.015, 'z-', A.rect(sprayS), range(r, -2, 2));
  b.decal(m.ads, 1.3, 0.33, range(r, 1.6, 2.6), y + 1.95, zS - 0.015, 'z-', A.rect('covered'), range(r, -1.5, 1.5));
  if (n !== 1) b.decal(m.ads, 0.8, 0.4, range(r, -4.3, -3.4), y + 0.75, zS - 0.016, 'z-', A.rect('slips'), range(r, -4, 4));
  // 楼梯间井壁：顺着上跑一路往上盖的章（西井壁朝东）、下跑那边一撮纸条（东井壁朝西）
  const W = R2.well;
  b.decal(m.ads, 0.5, 0.5, W.x0 + 0.012, y + 1.55, -0.85, 'x+', A.rect('stamps'), 8);
  b.decal(m.ads, 0.5, 0.5, W.x0 + 0.012, y + 2.25, -2.3, 'x+', A.rect('stamps'), 10);
  if (n > 1) b.decal(m.ads, 0.9, 0.45, W.x1 - 0.012, y + 0.35, -1.6, 'x-', A.rect('slips'), -6);
  // 五楼 502 门边：铅笔画的身高线（建国小时候，GDD §2.7：王奶奶的儿子）
  if (n === FLOORS) b.decal(m.ads, 0.35, 0.5, -4.985, y + 1.2, 2.06, 'x+', A.rect('heights'));
}

/** 户门与门前的东西。 */
function doorDressing(b: Batch, m: R2Mats, n: number): void {
  const y = levelY(n);
  // 门牌（门楣上方）
  b.decal(m.signs, 0.24, 0.14, -4.99 + 0.02, y + 2.28, 1.2, 'x+', m.atlas.rect(`plate${n}02`));
  b.decal(m.signs, 0.24, 0.14, 4.99 - 0.02, y + 2.28, 1.2, 'x-', m.atlas.rect(`plate${n}01`));
  // 奶箱（门旁墙上）
  b.box(m.leaf, 0.2, 0.24, 0.12, 4.93, y + 1.55, 2.05);
  b.decal(m.signs, 0.2, 0.23, 4.865, y + 1.55, 2.05, 'x-', m.atlas.rect('milk'));
  // 春联、横批（西户：二、五楼；东户：一、三、五楼）
  const couplets = (x: number, nrm: 'x+' | 'x-', sign: number) => {
    b.decal(m.signs, 0.13, 0.9, x, y + 1.35, 1.2 - sign * 0.58, nrm, m.atlas.rect('coupletL'), 1.5);
    b.decal(m.signs, 0.13, 0.9, x, y + 1.35, 1.2 + sign * 0.58, nrm, m.atlas.rect('coupletR'), -1);
    b.decal(m.signs, 0.62, 0.15, x, y + 2.14, 1.2, nrm, m.atlas.rect('banner'), 0.5);
  };
  if (n === 2) couplets(-4.985, 'x+', -1);
  if (n === 1 || n === 3 || n === 5) couplets(4.985, 'x-', 1);
  // 门垫
  b.at(-4.55, y, 1.2, 90, () => doormat(b, m));
  if (n !== 3) b.at(4.55, y, 1.2, 90, () => doormat(b, m));
}

/** 各层不一样的生活痕迹。 */
function floorProps(b: Batch, ctx: AreaContext, m: R2Mats, n: number, grp: THREE.Group): void {
  const y = levelY(n);
  const c = ctx.collider;
  switch (n) {
    case 1:
      b.at(-4.55, y, 2.15, 90, () => broom(b, m));
      b.at(4.45, y, 0.35, 180, () => flowerPot(b, m, false, 11));
      c.box([4.45, y + 0.2, 0.35], [0.35, 0.4, 0.35]);
      break;
    case 2:
      b.at(4.55, y, 2.1, 270, () => shoeRack(b, m, 21));
      c.box([4.55, y + 0.35, 2.1], [0.35, 0.7, 0.75]);
      b.at(-4.6, y, 2.15, 0, () => pickleJar(b, m, 1));
      b.at(-4.2, y, 2.25, 0, () => pickleJar(b, m, 0.8));
      c.box([-4.4, y + 0.25, 2.2], [0.8, 0.5, 0.45]);
      b.at(-4.45, y, 0.3, 0, () => flowerPot(b, m, false, 22));
      break;
    case 3:
      b.at(-4.3, y, 2.1, 10, () => boxes(b, m, 31));
      c.box([-4.1, y + 0.45, 2.1], [1.2, 0.9, 0.6]);
      b.at(4.4, y, 2.1, 180, () => stroller(b, m));
      c.box([4.4, y + 0.45, 2.1], [0.5, 0.9, 0.6]);
      b.decal(m.signs, 0.9, 0.18, -2.8, y + 1.75, R2.corridor.z1 - 0.013, 'z-', m.atlas.rect('nopile'));
      break;
    case 4:
      b.at(-4.45, y, 0.4, 0, () => spittoon(b, m));
      b.at(-4.5, y, 2.15, 0, () => briquettes(b, m));
      c.box([-4.45, y + 0.3, 2.15], [0.45, 0.6, 0.3]);
      b.at(4.2, y, 2.05, 200, () => tricycle(b, m));
      c.box([4.2, y + 0.3, 2.05], [0.6, 0.6, 0.7]);
      b.at(4.9, y, 0.45, 90, () => umbrella(b, m, 10));
      break;
    case 5:
      b.at(4.55, y, 2.1, 270, () => shoeRack(b, m, 51));
      c.box([4.55, y + 0.35, 2.1], [0.35, 0.7, 0.75]);
      b.at(4.4, y, 0.35, 0, () => flowerPot(b, m, true, 52));
      c.box([4.4, y + 0.2, 0.35], [0.35, 0.4, 0.35]);
      break;
  }
  // 晾衣绳：三楼东头、五楼西头，靠南墙横着一根，挂着没收的衣服
  if (n === 3 || n === 5) {
    const line = PROPS.clothesLine(2.1, 30 + n);
    line.position.set(n === 3 ? 1.5 : -3.2, y + 2.38, R2.corridor.z1 - 0.32);
    grp.add(line);
  }
  // 电表箱（南墙，每层一个；一楼在门厅北侧的走廊南墙位置改到东墙）
  const mx = n === 1 ? 3.6 : 3.3;
  const mz = n === 1 ? R2.lobby.z1 : R2.corridor.z1;
  b.box(m.steel, 0.62, 0.78, 0.16, mx, y + 1.75, mz - 0.08);
  b.decal(m.signs, 0.6, 0.75, mx, y + 1.75, mz - 0.162, 'z-', m.atlas.rect('meter'));
  // 电线从电表箱往上走进顶棚
  b.box(m.plastic, 0.025, CEIL - 2.14, 0.02, mx + 0.2, y + 2.14 + (CEIL - 2.14) / 2, mz - 0.012);
  // 东南角一根铸铁落水管、北墙上方一根黄色煤气管（带一只表）
  b.cyl(m.iron, 0.055, 0.055, 2.8, 4.9, y + 1.4, (n === 1 ? R2.lobby.z1 : R2.corridor.z1) - 0.09, 10);
  b.cyl(m.iron, 0.07, 0.07, 0.08, 4.9, y + 0.9, (n === 1 ? R2.lobby.z1 : R2.corridor.z1) - 0.09, 10);
  b.cyl(m.gasPipe, 0.018, 0.018, 3.2, 3.35, y + 2.42, 0.05, 6, 0, 90);
  b.box(m.steel, 0.2, 0.26, 0.12, 2.0, y + 2.25, 0.08);
  b.cyl(m.gasPipe, 0.018, 0.018, 0.25, 2.0, y + 2.5, 0.05, 6);
  // 消防栓箱（二、四楼南墙）
  if (n === 2 || n === 4) {
    b.box(m.redPlastic, 0.62, 0.84, 0.2, -3.2, y + 0.9, R2.corridor.z1 - 0.1);
    b.decal(m.signs, 0.6, 0.82, -3.2, y + 0.9, R2.corridor.z1 - 0.202, 'z-', m.atlas.rect('fire'));
  }
}

/** 一楼门厅：信报箱（西墙）、捐款榜（东墙）、自行车、单元门与门外的雨夜。 */
function buildLobby(ctx: AreaContext, b: Batch, m: R2Mats, grp: THREE.Group): { mailboxes: THREE.Object3D; donation: THREE.Object3D } {
  const L = R2.lobby;
  // 信报箱：墙上一排绿铁皮箱
  const mb = new THREE.Group();
  mb.name = 'mailboxes';
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.66, 1.02), m.leaf);
  mb.add(body);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.65), m.signs);
  const rr = m.atlas.rect('mailbox');
  const uv = front.geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, rr[0] + uv.getX(i) * (rr[2] - rr[0]), rr[1] + uv.getY(i) * (rr[3] - rr[1]));
  front.rotation.y = Math.PI / 2;
  front.position.x = 0.102;
  mb.add(front);
  mb.position.set(R2.mailboxes[0] + 0.1 - 0.03, R2.mailboxes[1], R2.mailboxes[2]);
  grp.add(mb);
  ctx.collider.box([-4.9, 1.0, 3.75], [0.25, 1.2, 1.05]);
  // 捐款榜：木框红纸
  const db = new THREE.Group();
  db.name = 'donationBoard';
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 0.9), m.darkWood);
  db.add(frame);
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.2), m.donation);
  paper.rotation.y = -Math.PI / 2;
  paper.position.x = -0.032;
  db.add(paper);
  db.position.set(4.97, R2.donation[1], R2.donation[2]);
  grp.add(db);
  // 电梯通知与小广告也贴在门厅东墙
  b.decal(m.signs, 0.28, 0.4, 4.985, 1.5, 2.95, 'x-', m.atlas.rect('notice'), 3);
  b.decal(m.posters, 0.9, 0.9, -4.985, 1.2, 2.75, 'x+', [0, 0, 1, 1], -2);
  // 自行车（门厅东南角，贴着南墙）
  const bike = PROPS.bicycle(7);
  bike.position.set(2.6, 0, L.z1 - 0.32);
  bike.rotation.y = 0.04;
  grp.add(bike);
  ctx.collider.box([2.6, 0.5, L.z1 - 0.3], [1.5, 1.0, 0.4]);
  // 单元门（门洞 1.3m，门扇开着）与门外的门廊、雨夜
  // 门扇往门外（门廊那边）推开，不杵在门厅里
  const unit = door({ w: 1.2, h: 2.25, style: 'unit', at: [0, 0, L.z1], yaw: 0, hinge: 'left' });
  unit.setOpen(0.82);
  grp.add(unit.group);
  b.box(m.concrete, 2.2, 0.06, 1.9, 0, -0.03, L.z1 + 0.95);
  b.wall(m.plaster, [-1.0, L.z1], [-1.0, 6.9], 0, 2.6);
  b.wall(m.plaster, [1.0, 6.9], [1.0, L.z1], 0, 2.6);
  b.box(m.concrete, 2.4, 0.12, 2.1, 0, 2.66, L.z1 + 1.0);
  const out = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.7), m.outside);
  out.rotation.y = Math.PI;
  out.position.set(0, 1.3, 6.9);
  out.userData.noOcclude = true;
  grp.add(out);
  return { mailboxes: mb, donation: db };
}

function buildFloor(ctx: AreaContext, m: R2Mats, n: number, out: R2World): FloorRig {
  const y = levelY(n);
  const grp = new THREE.Group();
  grp.name = `floor${n}`;
  const b = new Batch();
  const zS = n === 1 ? R2.lobby.z1 : R2.corridor.z1;
  // 地面、顶棚
  b.flat(m.floor, -5, 0, 5, zS, y, true, 2);
  b.flat(m.ceiling, -5, 0, 5, zS, y + CEIL, false, 2);
  // 墙（墙裙绿 + 石灰白，dado 按网格 UV）
  const H = y + CEIL;
  const wall = (a: XZ, c: XZ, uo = 0) => b.wall(m.dado, a, c, y, H, { floorY: y, uOffset: uo });
  wall([-5, 0], [-1.5, 0]);
  wall([1.5, 0], [5, 0], 0.7);
  if (n === 1) {
    wall([5, zS], [0.65, zS]);
    wall([-0.65, zS], [-5, zS], 0.3);
    b.wall(m.dado, [0.65, zS], [-0.65, zS], y + 2.3, H, { floorY: y });
  } else {
    wall([5, zS], [-5, zS]);
  }
  if (n === 5) {
    wall([-5, zS], [-5, 1.68]);
    wall([-5, 0.72], [-5, 0], 0.2);
    b.wall(m.dado, [-5, 1.68], [-5, 0.72], y + 2.12, H, { floorY: y });
  } else {
    wall([-5, zS], [-5, 0]);
  }
  wall([5, 0], [5, zS], 0.4);
  // 整面墙叠一层做旧（贴在墙面内侧 4mm；v 从本层地面到顶棚），每段墙的 u 起点错开，平铺看不出重复
  const wash = (a: XZ, c: XZ, uo: number) => {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const nx = -(c[1] - a[1]) / len * 0.004, nz = (c[0] - a[0]) / len * 0.004;
    b.wall(m.wash, [a[0] + nx, a[1] + nz], [c[0] + nx, c[1] + nz], y, H, { floorY: y, uMeters: 2.6, vMeters: CEIL, uOffset: uo });
  };
  wash([-5, 0], [-1.5, 0], 0.13 * n);
  wash([1.5, 0], [5, 0], 0.41 + 0.17 * n);
  if (n === 1) {
    wash([5, zS], [0.65, zS], 0.27);
    wash([-0.65, zS], [-5, zS], 0.71);
  } else {
    wash([5, zS], [-5, zS], 0.29 * n);
  }
  if (n === 5) {
    wash([-5, zS], [-5, 1.68], 0.5);
    wash([-5, 0.72], [-5, 0], 0.9);
  } else {
    wash([-5, zS], [-5, 0], 0.37 * n);
  }
  wash([5, 0], [5, zS], 0.61 + 0.11 * n);
  // 踢脚线（深绿一道）
  b.box(m.darkWood, 10, 0.08, 0.012, 0, y + 0.04, 0.006);
  b.box(m.darkWood, 10, 0.08, 0.012, 0, y + 0.04, zS - 0.006);

  buildWell(b, m, n);
  dressWalls(b, m, n, 100 + n);
  doorDressing(b, m, n);
  floorProps(b, ctx, m, n, grp);

  // 走廊南窗（二–五楼）：窗外是院子里的钠灯（HDR，灯芯烧白），光引导人往这边看；五楼西头 502 门边另有一扇小窗
  if (n > 1) {
    const win = (xc: number, ww: number, wh: number, yc: number, sill: boolean) => {
      const zw = R2.corridor.z1;
      b.decal(m.courtyard[n - 2] ?? m.landingWin, ww, wh, xc, yc, zw - 0.03, 'z-');
      b.decal(m.glass, ww, wh, xc, yc, zw - 0.05, 'z-');
      b.box(m.darkWood, ww + 0.12, 0.06, 0.2, xc, yc - wh / 2 - 0.03, zw - 0.08);
      b.box(m.darkWood, ww + 0.08, 0.05, 0.08, xc, yc + wh / 2, zw - 0.04);
      const bars = ww > 0.9 ? [-ww / 2, 0, ww / 2] : [-ww / 2, ww / 2];
      for (const x of bars) b.box(m.darkWood, 0.05, wh + 0.02, 0.07, xc + x, yc, zw - 0.04);
      b.box(m.darkWood, ww, 0.04, 0.06, xc, yc + wh * 0.18, zw - 0.04);
      if (sill) {
        // 窗台上：一只空罐头、一个旧牙缸
        b.cyl(m.steel, 0.04, 0.04, 0.1, xc - 0.34, yc - wh / 2 + 0.05, zw - 0.1, 10);
        b.cyl(m.redPlastic, 0.035, 0.03, 0.09, xc + 0.3, yc - wh / 2 + 0.045, zw - 0.12, 10);
      }
    };
    win(0, 1.2, 1.3, y + 1.55, true);
    if (n === FLOORS) win(R2.westWindowX, 0.7, 0.95, y + 1.6, false);
  }

  // 户门：西 n02（正面朝东）、东 n01（正面朝西）
  const doorW = door({ w: 0.9, h: 2.05, style: 'security', at: [-5, y, 1.2], yaw: 90 });
  const doorE = door({ w: 0.9, h: 2.05, style: 'security', at: [5, y, 1.2], yaw: 270 });
  grp.add(doorW.group, doorE.group);
  // 四楼 401 还住着人：门缝里漏出一线电视的光（GDD §9.5“远处电视嗡嗡声”）
  if (n === 4) b.decal(m.glowGap, 0.84, 0.018, 4.965, y + 0.012, 1.2, 'x-');

  // 502 门：门神（左边那张歪约 8°）与门里的小门斗
  if (n === 5) {
    const M = R2.menshenCenter;
    const pair = menshenPair(m.menshen, 8);
    pair.position.set(M[0], M[1], M[2]);
    // 取景器里纸像发光（GDD §2.7：#E8C35A 描金）：每张门神上叠一层 mat.paper_glow，只在 yin 层（取景器）
    for (const src of [...pair.children]) {
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.74), MATERIALS.paperGlow());
      glow.position.copy(src.position).x += 0.004;
      glow.quaternion.copy(src.quaternion);
      glow.renderOrder = 15;
      glow.userData.noOcclude = true;
      setLayerRecursive(glow, 'yin');
      pair.add(glow);
    }
    ctx.add(pair, { parent: grp, ref: OBJ.R2_MENSHEN, tempC: 6 });
    out.menshen = pair;
    // 小门斗：地面、墙、一只旧鞋柜的影子
    b.flat(m.floor, -6.8, 0.6, -5, 1.8, y, true, 2);
    b.flat(m.ceiling, -6.8, 0.6, -5, 1.8, y + 2.4, false, 2);
    b.wall(m.lime, [-6.8, 0.62], [-5, 0.62], y, y + 2.4);
    b.wall(m.lime, [-5, 1.78], [-6.8, 1.78], y, y + 2.4);
    b.wall(m.lime, [-6.75, 1.8], [-6.75, 0.6], y, y + 2.4);
    b.box(m.darkWood, 0.35, 0.9, 0.7, -6.55, y + 0.45, 1.35);
    b.box(m.plaster, 0.3, 0.2, 1.3, -5.12, y + 2.22, 1.2);
    out.door502 = doorW;
    ctx.collider.dynamic(OBJ.R2_DOOR_502, doorW.collider, `!${F.R2_MENSHEN_OPEN}`);
    // 残影点旋涡（取景器里可见）
    const v = createResidueVortex();
    v.position.set(R2.rpDoor[0], y + 0.02, R2.rpDoor[2]);
    grp.add(v);
  }
  if (n === 1) {
    const lob = buildLobby(ctx, b, m, grp);
    out.mailboxes = lob.mailboxes;
    out.donation = lob.donation;
    const v = createResidueVortex();
    v.position.set(R2.rpLobby[0], 0.02, R2.rpLobby[2]);
    grp.add(v);
  }

  // 声控灯（顶棚中央）：吸顶座与声控开关盒进合并批，灯泡是 kit 的 hall_bulb
  const L = R2.lamp(n);
  lampFixture(b, m, L[0], y + CEIL, L[2], 0);
  const lampRig = lamp({ kind: 'hall_bulb', at: [L[0], y + CEIL - 0.13, L[2]], light: false, on: false });
  lampRig.group.name = `hallBulb${n}`;
  grp.add(lampRig.group);
  let socket: THREE.Object3D | null = null;
  if (n === 3) {
    // 空灯座：只有灯头，没有灯泡
    socket = new THREE.Group();
    socket.name = 'emptySocket';
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.07, 10), m.plastic);
    s.position.set(L[0], y + CEIL - 0.1, L[2]);
    socket.add(s);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.005, 10), m.black);
    hole.position.set(L[0], y + CEIL - 0.137, L[2]);
    socket.add(hole);
    grp.add(socket);
  }

  // 王奶奶的湿脚印（阴物，只在取景器里看得见）：一楼从单元门走到台阶；楼上从下楼口走到她站的地方（到过这层才有）
  const prints = n === 1
    ? createFootprints([[0.1, 6.3], [0.25, 4.6], [0.55, 2.4], [0.8, 0.4], [0.8, -0.1]], { seed: 41, y: 0.012 })
    : createFootprints(n === FLOORS ? [[0.8, -0.2], [0.6, 0.9], [-1.5, 0.9], [-3.6, 0.8]] : [[0.8, -0.2], [1.2, 0.5], [1.75, 0.85]], { seed: 40 + n, y: y + 0.012 });
  prints.name = `wangPrints${n}`;
  grp.add(prints);
  out.prints[n - 1] = prints;

  const meshes = b.flush(grp, `floor${n}`);
  for (const mesh of meshes) if (mesh.material instanceof THREE.MeshBasicMaterial || mesh.material === m.glass) mesh.userData.noOcclude = true;
  ctx.add(grp);
  colliders(ctx, n);
  return {
    n, y, group: grp, lamp: lampRig, lampHit: lampRig.group, socket,
    level: n === 5 ? 0.82 : n === 3 ? 1.08 : 1, flicker: n === 4 ? 1 : 0,
    doorW, doorE,
  };
}

/** 建五个楼层节点（只有当前楼层可见，由 LevelsDef.onChange 切换）。 */
export function buildFloors(ctx: AreaContext, m: R2Mats): R2World {
  const out = { floors: [] as FloorRig[], prints: [] } as unknown as R2World;
  for (let n = 1; n <= FLOORS; n++) out.floors.push(buildFloor(ctx, m, n, out));
  return out;
}
