// owner: WP7
// 开发沙盒底座（ARCH §15.2 WP7）：30m×30m 场地、外墙、出生点、一个通往 r1 的出入口、两个楼层节点、地标牌；look-dev 样板角落由 M1c 在 LOOKDEV 出生点附近搭。
// 只在 ?debug=1&area=dev 下可达。dev/index.ts 以 DEV_BASE 为 mergeAreaParts 的 base，合并 wp1–wp7 的 AreaPart。
// 出生点/出入口用 data/ids.ts 的 DEV_SPAWN / DEV_EXIT（不是 GDD id）。
//
// 布局（俯视，+x 东，-z 北）：场地 x,z ∈ [-15, 15]，四面 3m 高外墙。
//   北墙中间是通往 r1 的门框，触发体在门框内侧 (0, -14)（1.5m 见方）；
//   出生点 START (0,0,8) 朝北，LOOKDEV (8,0,8) 朝南（M1c 的 look-dev 角落在它南边的门岗，dev/lookdev.ts）；
//   地标牌在出生点前方偏东 (1.3, 0, 6.5)，牌面朝出生点，离出生点约 2m：站在出生点就在它的交互射程内（WP6 的角标自测要一个射程内的交互物）；
//   两个楼层节点：一层 = 地面（只放一块“1F”地标），二层 = 场地中央上空 6m 的 6×6m 平台（x ∈ [-3,3]，z ∈ [-1.2,4.8]，
//   含楼梯口落点 (0, 6, 1.8)，ARCH §11.2 LevelsHandle.set 的落点），四周 1.1m 栏杆；当前层以外的节点隐藏（碰撞体一直在，互不干扰）。
// 各 WP 的夹具各占一块：WP5 西半边、WP4 北侧中央、WP1/WP3 东北角；WP7 自己的夹具在东侧 x≈11–14、z≈1–7（dev/wp7.ts）。
// 灯：一盏半球光（R1 标准夜景，M1c look-dev；本区总数 ≤ 8，给 look-dev 与别的 WP 留余量）。

import * as THREE from 'three';
import type { AreaBase, AreaContext } from '../../core/area';
import type { V3 } from '../../core/types';
import { DEV_EXIT, DEV_SPAWN, SPAWN } from '../../data/ids';
import { PALETTE } from '../../data/palette';
import { LOOK } from '../../data/render';
import { yawTowards } from '../../core/math';
import { FONT_STACK } from '../../kit/text';

/** 场地半边长（米）。 */
export const DEV_HALF = 15;
/** 二层平台的高度与范围（楼梯口落点 (0, DEV_FLOOR2_Y, 1.8) 在平台上）。 */
export const DEV_FLOOR2_Y = 6;
export const DEV_FLOOR2_RECT = { x0: -3, z0: -1.2, x1: 3, z1: 4.8 } as const;
/** 通往 r1 的出入口触发体中心。 */
export const DEV_EXIT_AT: V3 = [0, 1.25, -14];
/** 地标牌（ref 'dev.landmark'；dev/wp7.ts 把它登记为交互物）。 */
export const DEV_LANDMARK_AT: V3 = [1.3, 0, 6.5];
export const DEV_LANDMARK_REF = 'dev.landmark';

const WALL_H = 3;

export const DEV_BASE: AreaBase = {
  id: 'dev',
  name: '引擎沙盒',
  spawns: {
    [DEV_SPAWN.START]: { pos: [0, 0, 8], yaw: 0 },
    [DEV_SPAWN.LOOKDEV]: { pos: [8, 0, 8], yaw: 180 },
  },
  exits: [
    { id: DEV_EXIT.TO_R1, to: SPAWN.R1_START, box: { center: DEV_EXIT_AT, size: [1.5, 2.5, 1.5] } },
  ],
  post: 'dev',
  // R1 的环境贴图：钠橙色的远灯与地平线光（fx/environment.ts 的夜景环境），强度见 data/render.ts 的 LOOK.envIntensity
  environment: { tint: PALETTE.SODIUM, intensity: LOOK.envDefault },
  build(ctx) {
    buildBase(ctx);
  },
};

// ==================================================================== 贴图（CanvasTexture；ctx.track 追踪，离开区域时释放）

function canvasTexture(ctx: AreaContext, w: number, h: number, paint: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) paint(g);
  const t = ctx.track(new THREE.CanvasTexture(c));
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(4, ctx.caps.maxAnisotropy);
  return t;
}

/** 地面：每米一条细线、每 5 米一条粗线的网格（量距离、看站位用）。一张 2m 贴图重复 15×15。 */
function groundTexture(ctx: AreaContext): THREE.CanvasTexture {
  const t = canvasTexture(ctx, 256, 256, g => {
    g.fillStyle = '#2b3140';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(160,180,210,0.28)';
    g.lineWidth = 2;
    for (const p of [0, 128]) {
      g.beginPath();
      g.moveTo(p + 1, 0);
      g.lineTo(p + 1, 256);
      g.moveTo(0, p + 1);
      g.lineTo(256, p + 1);
      g.stroke();
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(DEV_HALF, DEV_HALF);
  return t;
}

/**
 * 牌子贴图：灯箱式——浅底深字、磷绿边框（沙盒的东西一眼能和区域内容区分开）。
 * 浅底配 emissiveMap 让牌面在夜色里自己发亮：截图验收（shots.mjs）要求画面里有高光、关键对象处看得清，沙盒机位就拿它当“灯”。
 */
function signTexture(ctx: AreaContext, lines: readonly string[], w = 512, h = 256): THREE.CanvasTexture {
  return canvasTexture(ctx, w, h, g => {
    g.fillStyle = '#E9EEE4';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = PALETTE.OSD;
    g.lineWidth = 10;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#10161f';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const step = (h - 40) / lines.length;
    lines.forEach((line, i) => {
      g.font = `${i === 0 ? 'bold ' : ''}${Math.round(step * (i === 0 ? 0.62 : 0.46))}px ${FONT_STACK}`;
      g.fillText(line, w / 2, 20 + step * (i + 0.5), w - 40);
    });
  });
}

// ==================================================================== 建造

function box(size: V3, pos: V3, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
  m.position.set(pos[0], pos[1], pos[2]);
  return m;
}

/** 牌子：一根立柱 + 一块双面牌（牌面朝 yaw 方向；yaw 约定见 ARCH §1.3）。 */
function signpost(ctx: AreaContext, at: V3, yaw: number, lines: readonly string[], mats: { post: THREE.Material }, parent?: THREE.Object3D): THREE.Group {
  const grp = new THREE.Group();
  grp.position.set(at[0], at[1], at[2]);
  grp.rotation.y = -yaw * THREE.MathUtils.DEG2RAD;
  // 立柱与背板在牌面后方（局部 +z；牌面朝局部 -z = yaw 方向）
  grp.add(box([0.1, 1.9, 0.1], [0, 0.95, 0.06], mats.post));
  const tex = signTexture(ctx, lines);
  // 灯箱：自发光 1.0（M1c look-dev：沙盒改成 R1 的暗夜景后 0.5 不够亮，牌面进不了 shots.mjs 的高光）
  const face = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 1.0, roughness: 0.8 });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), face);
  board.position.set(0, 1.65, 0);
  // 平面默认朝 +z；牌面要朝“前方”（-z 是北 = yaw 0 的前方）
  board.rotation.y = Math.PI;
  grp.add(board);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), mats.post);
  back.position.set(0, 1.65, 0.01);
  grp.add(back);
  ctx.add(grp, parent ? { parent } : undefined);
  return grp;
}

function buildBase(ctx: AreaContext): void {
  const wallMat = new THREE.MeshStandardMaterial({ color: '#3a4152', roughness: 0.92 });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#5a6478', roughness: 0.7 });
  const postMat = new THREE.MeshStandardMaterial({ color: '#23272f', roughness: 0.85 });
  const gateMat = new THREE.MeshStandardMaterial({ color: PALETTE.SODIUM, roughness: 0.6, emissive: PALETTE.SODIUM, emissiveIntensity: 0.25 });

  // 场地
  const groundMat = new THREE.MeshStandardMaterial({ map: groundTexture(ctx), roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(DEV_HALF * 2, DEV_HALF * 2), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ctx.add(ground, { ref: 'dev.ground' });
  ctx.collider.floor(-DEV_HALF, -DEV_HALF, DEV_HALF, DEV_HALF, 0);

  // 外墙（北墙中间留出门框的位置；门框本身不挡人，触发体在墙内侧）
  const H = DEV_HALF;
  const walls: [[number, number], [number, number]][] = [
    [[-H, -H], [-1.2, -H]], [[1.2, -H], [H, -H]],   // 北（门框两侧）
    [[-H, H], [H, H]],                              // 南
    [[-H, -H], [-H, H]],                            // 西
    [[H, -H], [H, H]],                              // 东
  ];
  for (const [a, b] of walls) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = box([len, WALL_H, 0.3], [(a[0] + b[0]) / 2, WALL_H / 2, (a[1] + b[1]) / 2], wallMat);
    m.rotation.y = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    ctx.add(m);
    ctx.collider.wall(a, b, 0, WALL_H, 0.3);
  }
  // 门框后面封一块墙（看起来是门，其实走进触发体就换区域）
  ctx.add(box([2.4, WALL_H, 0.3], [0, WALL_H / 2, -H - 0.6], wallMat));
  ctx.collider.wall([-1.2, -H - 0.6], [1.2, -H - 0.6], 0, WALL_H, 0.3);
  ctx.collider.wall([-1.2, -H - 0.6], [-1.2, -H], 0, WALL_H, 0.3);
  ctx.collider.wall([1.2, -H - 0.6], [1.2, -H], 0, WALL_H, 0.3);
  // 门框（钠橙，远远就看得见出口在哪）
  ctx.add(box([0.2, 2.6, 0.2], [-1.1, 1.3, -H + 0.1], gateMat));
  ctx.add(box([0.2, 2.6, 0.2], [1.1, 1.3, -H + 0.1], gateMat));
  ctx.add(box([2.4, 0.2, 0.2], [0, 2.7, -H + 0.1], gateMat));
  signpost(ctx, [2.2, 0, -13.4], 180, ['出口 → 槐安里', 'exit.dev_to_r1 · spawn.r1_start'], { post: postMat });

  // 地标牌（出生点前方偏东，牌面朝出生点）
  const landmark = signpost(ctx, DEV_LANDMARK_AT, yawTowards(DEV_LANDMARK_AT, [0, 0, 8]), ['引擎沙盒', '30m × 30m · ?debug=1&area=dev'], { post: postMat });
  landmark.name = DEV_LANDMARK_REF;
  ctx.ref(DEV_LANDMARK_REF, landmark);

  // 两个楼层节点
  const floor1 = new THREE.Group();
  floor1.name = 'dev.floor1';
  const floor2 = new THREE.Group();
  floor2.name = 'dev.floor2';
  ctx.add(floor1, { ref: 'dev.floor1' });
  ctx.add(floor2, { ref: 'dev.floor2' });
  // 一层：楼梯口落点上的“1F”地标
  const mark1 = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshStandardMaterial({ map: signTexture(ctx, ['1F'], 256, 128), roughness: 0.9 }));
  mark1.rotation.x = -Math.PI / 2;
  mark1.position.set(0, 0.01, 1.8);
  ctx.add(mark1, { parent: floor1 });
  // 二层：平台 + 栏杆 + “2F”牌
  const R = DEV_FLOOR2_RECT;
  const Y = DEV_FLOOR2_Y;
  const cx = (R.x0 + R.x1) / 2;
  const cz = (R.z0 + R.z1) / 2;
  ctx.add(box([R.x1 - R.x0, 0.2, R.z1 - R.z0], [cx, Y - 0.1, cz], trimMat), { parent: floor2 });
  ctx.collider.box([cx, Y - 0.1, cz], [R.x1 - R.x0, 0.2, R.z1 - R.z0]);
  const rails: [[number, number], [number, number]][] = [
    [[R.x0, R.z0], [R.x1, R.z0]], [[R.x0, R.z1], [R.x1, R.z1]], [[R.x0, R.z0], [R.x0, R.z1]], [[R.x1, R.z0], [R.x1, R.z1]],
  ];
  for (const [a, b] of rails) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = box([len, 0.08, 0.08], [(a[0] + b[0]) / 2, Y + 1.05, (a[1] + b[1]) / 2], postMat);
    m.rotation.y = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    ctx.add(m, { parent: floor2 });
    ctx.collider.wall(a, b, Y, 1.1, 0.1);
  }
  const sign2At: V3 = [R.x1 - 0.6, Y, R.z0 + 0.6];
  signpost(ctx, sign2At, yawTowards(sign2At, [0, Y, 1.8]), ['2F', '沙盒二层'], { post: postMat }, floor2);
  floor2.visible = false;
  ctx.levels({
    count: 2,
    y: n => (n === 2 ? Y : 0),
    initial: 1,
    onChange: n => {
      floor1.visible = n === 1;
      floor2.visible = n === 2;
    },
  });

  // 灯与气氛（M1c look-dev）：整个沙盒就是 R1 的标准夜景——半球光照抄 GDD §4.1（#1B2233/#0B1020，设计强度 0.25），
  // 雾 FOG_R1 0.045，背景 NIGHT；look-dev 角落（dev/lookdev.ts）再加钠灯、门灯、CRT 三盏。R1 的 8 盏灯里没有月光，
  // 所以这里也不放（原来的平行“月光”去掉了：基准画面不能靠区域用不起的灯）。灯挂在 root 下，不随楼层节点隐藏（ARCH §4.7）。
  ctx.hemi(LOOKDEV_HEMI.sky, LOOKDEV_HEMI.ground, LOOKDEV_HEMI.design);
  ctx.background(PALETTE.NIGHT);
  ctx.fog(PALETTE.FOG_R1, LOOKDEV_FOG);
}

/** R1 标准夜景的半球光与雾（GDD §4.1；look-dev 基准）。 */
export const LOOKDEV_HEMI = { sky: '#1B2233', ground: '#0B1020', design: 0.25 } as const;
export const LOOKDEV_FOG = 0.045;
