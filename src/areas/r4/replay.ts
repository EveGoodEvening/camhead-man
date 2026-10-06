// owner: R4
// R4 的残影点与回放片段（GDD §13.6、P10、H 表旧照六）。纯数据 + 片段道具的造型函数。
//
// seg.stall_2023（rp.r4_stall，22s，2023-09-16 14:20）：收废品的倒下一箱写着“槐安里门岗”的录像带；黄三爷举起一盘对着灯看，
//   嘀咕“这盘上头有个人，一直抬头”，走到摊子东侧后方，塞进樟木箱（第 10–18 秒带子正被塞进箱子，pt.huang_hides 的时间窗）。
//   回放期间现世的黄三爷在 8m 内，引擎自动让位（ARCH §6.7），不挡镜头。
// seg.mid_1997（rp.r4_mid，18s，1997-07-01 09:00）：地下通道开通剪彩，街坊挤在红绸前；南边一张摊子底下，一双黄鼠狼的眼睛在反光。
//
// 道具的几何/材质在模块里缓存一次（片段道具由 ReplaySystem 在进区域时预建、离开时移走，不经 ctx.track），
// 所以反复进出本区资源计数不涨（ARCH §13.3）。

import * as THREE from 'three';
import type { ReplayPointDef, ReplaySegmentDef } from '../../game/replay';
import type { V3 } from '../../core/types';
import { GHOST, NPC, RP, SEG } from '../../data/ids';
import { PALETTE } from '../../data/palette';
import { MATERIALS } from '../../fx/materials';
import { paintTexture } from '../../kit/canvas';
import { FONT_STACK } from '../../kit/text';
import { MARKET_REF, R4L } from './layout';
import { TEXT } from './text';

export const REPLAY_POINTS: readonly ReplayPointDef[] = [
  { id: RP.R4_STALL, at: R4L.rpStall, segments: [SEG.STALL_2023] },
  { id: RP.R4_MID, at: R4L.rpMid, segments: [SEG.MID_1997] },
];

// ———————————————————————————————————————————— 道具造型（缓存）

let cache: {
  box: THREE.BufferGeometry; tape: THREE.BufferGeometry; ribbon: THREE.BufferGeometry; flower: THREE.BufferGeometry;
  pole: THREE.BufferGeometry; banner: THREE.BufferGeometry; table: THREE.BufferGeometry; eye: THREE.BufferGeometry;
  bannerMat: THREE.MeshBasicMaterial; ribbonMat: THREE.MeshBasicMaterial; eyeMat: THREE.MeshBasicMaterial; labelMat: THREE.MeshBasicMaterial;
  label: THREE.BufferGeometry;
} | null = null;

function res(): NonNullable<typeof cache> {
  if (cache) return cache;
  const bannerTex = paintTexture(1024, 128, (g, w, h) => {
    g.fillStyle = '#B3261E';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#F4E3B0';
    g.font = `bold ${Math.round(h * 0.62)}px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(TEXT.decor.ribbonBanner, w / 2, h * 0.54);
  });
  bannerTex.name = 'r4:replay.banner';
  const labelTex = paintTexture(256, 64, (g, w, h) => {
    g.fillStyle = '#C9B98C';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#231a10';
    g.font = `bold ${Math.round(h * 0.55)}px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(TEXT.decor.tapeBox, w / 2, h * 0.55);
  });
  labelTex.name = 'r4:replay.boxLabel';
  // 回放里的“过去”一律偏棕绿、半透明；横幅与标签保留一点字迹（mat.replay 不采样贴图）
  const replayTint = new THREE.Color(PALETTE.REPLAY);
  const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex, color: replayTint.clone().lerp(new THREE.Color('#ffffff'), 0.35), transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
  const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, color: replayTint.clone().lerp(new THREE.Color('#ffffff'), 0.4), transparent: true, opacity: 0.7, depthWrite: false });
  const ribbonMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#B3261E').lerp(replayTint, 0.25), transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide });
  // 黄鼠狼眼睛的反光：全片段里唯一不带回放色的东西
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFF1A8').multiplyScalar(3) });
  for (const m of [bannerMat, labelMat, ribbonMat, eyeMat]) m.userData.tempC = 18;
  const flower = new THREE.SphereGeometry(0.16, 10, 8);
  flower.scale(1, 1, 0.7);
  cache = {
    box: new THREE.BoxGeometry(0.5, 0.3, 0.36),
    tape: new THREE.BoxGeometry(0.19, 0.105, 0.025),
    ribbon: new THREE.BoxGeometry(0.015, 0.13, 3.3),
    flower,
    pole: new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6),
    banner: new THREE.PlaneGeometry(4.2, 0.52),
    table: new THREE.BoxGeometry(1.1, 0.04, 0.55),
    eye: new THREE.SphereGeometry(0.012, 6, 5),
    label: new THREE.PlaneGeometry(0.3, 0.075),
    bannerMat, labelMat, ribbonMat, eyeMat,
  };
  return cache;
}

/** 一箱录像带（纸箱 + 侧面“槐安里门岗”的标签 + 箱口露出的几盘带子）。 */
function tapeBoxProp(): THREE.Object3D {
  const r = res();
  const g = new THREE.Group();
  const rep = MATERIALS.replay();
  g.add(new THREE.Mesh(r.box, rep));
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(r.tape, rep);
    t.rotation.x = Math.PI / 2 - 0.25;
    t.position.set(-0.15 + i * 0.1, 0.17, 0.02);
    g.add(t);
  }
  const label = new THREE.Mesh(r.label, r.labelMat);
  label.position.set(0, 0.02, -0.181);
  label.rotation.y = Math.PI;
  g.add(label);
  return g;
}

/** 一盘录像带（黄三爷举起来对着灯看、塞进樟木箱的那盘）。 */
function tapeProp(): THREE.Object3D {
  return new THREE.Mesh(res().tape, MATERIALS.replay());
}

/** 剪彩的红绸：两根竹竿 + 一条横过通道的绸子 + 中间一朵大红花。 */
function ribbonProp(): THREE.Object3D {
  const r = res();
  const g = new THREE.Group();
  const rep = MATERIALS.replay();
  for (const z of [-1.65, 1.65]) {
    const p = new THREE.Mesh(r.pole, rep);
    p.position.set(0, 0.6, z);
    g.add(p);
  }
  const rib = new THREE.Mesh(r.ribbon, r.ribbonMat);
  rib.position.set(0, 1.12, 0);
  g.add(rib);
  const fl = new THREE.Mesh(r.flower, r.ribbonMat);
  fl.position.set(0, 1.1, 0);
  g.add(fl);
  return g;
}

/** 北墙上的横幅“人民路地下通道开通剪彩”。 */
function bannerProp(): THREE.Object3D {
  const r = res();
  const m = new THREE.Mesh(r.banner, r.bannerMat);
  return m;
}

/** 1997 年南边的一张小摊桌（桌面 + 四条腿），黄鼠狼蹲在底下。 */
function oldTableProp(): THREE.Object3D {
  const r = res();
  const g = new THREE.Group();
  const rep = MATERIALS.replay();
  const top = new THREE.Mesh(r.table, rep);
  top.position.y = 1.02;
  g.add(top);
  for (const [x, z] of [[-0.5, -0.24], [0.5, -0.24], [-0.5, 0.24], [0.5, 0.24]] as const) {
    const leg = new THREE.Mesh(r.pole, rep);
    leg.scale.set(1, 0.85, 1);
    leg.position.set(x, 0.51, z);
    g.add(leg);
  }
  return g;
}

/** 两点反光（黄鼠狼的眼睛）。 */
function eyesProp(): THREE.Object3D {
  const r = res();
  const g = new THREE.Group();
  for (const x of [-0.035, 0.035]) {
    const e = new THREE.Mesh(r.eye, r.eyeMat);
    e.position.set(x, 0, 0);
    g.add(e);
  }
  return g;
}

// ———————————————————————————————————————————— 片段

const S3 = { x: 3, z: 2.2 };
const CHEST = R4L.chest.pos;
/** 1997 年南墙根一张摊子底下的黄鼠狼：就在街坊人堆的西南角外，面朝残影点那边（西北）；从残影点望人堆时，它和人堆能同在一个画面里。
 *  眼睛在蹲姿头部前方 0.22m（按朝向算）。 */
const WEASEL = { x: -4.5, z: 2.4, yaw: 314 };
const EYES: V3 = [WEASEL.x + 0.22 * Math.sin(WEASEL.yaw * (Math.PI / 180)), 0.74, WEASEL.z - 0.22 * Math.cos(WEASEL.yaw * (Math.PI / 180))];

/**
 * 进段时镜头转向的点（ReplaySegmentDef.focus，M4 第 2 轮）。不给时引擎取人影关键帧的平均点：
 * 2023 那段是收废品的（西头进、西头出）与黄三爷的平均，从摊前 (3.8,0.2) 看镜头转到通道西侧（yaw≈244°），
 * 樟木箱在身后左边，第 10–18 秒按快门只能得空镜。改成樟木箱与黄三爷蹲着塞带子的地方之间、略高一点：
 * 水平方向：从摊前一带（残影点 2.5m 内）看，影子与箱子都落在画框横向中央 60% 以内（pt.huang_hides 的判定）。
 * 俯仰：箱子在地上，从摊前要俯到 −22…−30° 才居中；引擎对写了 focus 的片段把转向的俯仰下限放到 −40°（M4 第 2 轮整合，
 * ReplaySystem TURN_MIN_PITCH_FOCUS；原来一律 −15°，更近的 (3.8,0.2)、(4.8,0.6) 箱盖落在画框下沿），
 * 于是摊前一带按 R 不动鼠标、第 12 秒按快门就拍得到（scripts/regions/r4.mjs 的三条 P10 用例）。
 */
const STALL_FOCUS: V3 = [4.0, 0.85, 2.3];
/** 1997 那段：对着红绸后头的街坊（旧照六的主体），略偏南——从西边过来按 R 时，南墙根摊子底下那双眼睛也在画面里。 */
const MID_FOCUS: V3 = [-3.6, 1.2, 0.5];

export const SEGMENTS: readonly ReplaySegmentDef[] = [
  {
    id: SEG.STALL_2023, point: RP.R4_STALL, order: 1, focus: STALL_FOCUS, osd: '2023-09-16 14:20', dur: 22, loop: true,
    actors: [
      {
        // 收废品的：从西头扛着一箱带子进来，往 S3 的摊子上一倒，拍拍手走了
        id: GHOST.JUNKMAN_2023, rig: 'mannequin', character: 'junkman',
        keys: [
          { t: 0, pos: [-3.2, 0, 0.35], yaw: 95, pose: 'carry' },
          { t: 4.2, pos: [2.2, 0, 0.75], yaw: 100, pose: 'carry' },
          { t: 5, pos: [2.55, 0, 0.95], yaw: 150, pose: 'crouch' },
          { t: 6.2, pos: [2.55, 0, 0.95], yaw: 150, pose: 'stand' },
          { t: 7.5, pos: [1.6, 0, 0.6], yaw: 265, pose: 'walk' },
          { t: 13, pos: [-4.5, 0, 0.2], yaw: 270, pose: 'walk' },
          { t: 22, pos: [-4.5, 0, 0.2], yaw: 270, pose: 'stand' },
        ],
      },
      {
        // 黄三爷（旧中山装、破毡帽的样子）：在摊后接货，举起一盘对着灯看，走到东侧后方，蹲下塞进樟木箱
        id: GHOST.HUANG_2023, rig: 'mannequin', character: 'huang',
        keys: [
          { t: 0, pos: [S3.x, 0, S3.z], yaw: 0, pose: 'stand' },
          { t: 5.4, pos: [S3.x, 0, S3.z - 0.1], yaw: 355, pose: 'stand' },
          { t: 6.3, pos: [S3.x - 0.1, 0, S3.z - 0.15], yaw: 350, pose: 'crouch' },
          { t: 7, pos: [S3.x, 0, S3.z - 0.1], yaw: 10, pose: 'raise_arm' },
          { t: 9.4, pos: [S3.x, 0, S3.z - 0.1], yaw: 10, pose: 'raise_arm' },
          { t: 10, pos: [3.45, 0, 2.35], yaw: 90, pose: 'walk' },
          { t: 11, pos: [CHEST[0] - 0.7, 0, CHEST[2] - 0.05], yaw: 90, pose: 'crouch' },
          { t: 17.2, pos: [CHEST[0] - 0.7, 0, CHEST[2] - 0.05], yaw: 90, pose: 'crouch' },
          { t: 18.6, pos: [3.45, 0, 2.35], yaw: 270, pose: 'walk' },
          { t: 20, pos: [S3.x, 0, S3.z], yaw: 0, pose: 'stand' },
          { t: 22, pos: [S3.x, 0, S3.z], yaw: 0, pose: 'stand' },
        ],
      },
    ],
    props: [
      {
        // 一箱带子：扛在收废品的胸前 → 倒在摊桌上
        id: 'tapeBox', mesh: tapeBoxProp,
        keys: [
          { t: 0, pos: [-2.85, 1.02, 0.38], yaw: 95 },
          { t: 4.2, pos: [2.55, 1.02, 0.72], yaw: 100 },
          { t: 5, pos: [2.8, 0.83, 1.5], yaw: 170 },
          { t: 22, pos: [2.8, 0.83, 1.5], yaw: 170 },
        ],
      },
      {
        // 那一盘：箱里 → 手上举高 → 箱子东侧 → 塞进樟木箱（第 16 秒后看不见了）
        id: 'tape', mesh: tapeProp,
        keys: [
          { t: 0, pos: [2.8, 0.9, 1.5], visible: false },
          { t: 6.3, pos: [2.85, 1.0, 1.75], visible: true },
          { t: 7, pos: [3.2, 2.0, 1.95], yaw: 10, visible: true },
          { t: 9.4, pos: [3.2, 2.0, 1.95], yaw: 10, visible: true },
          { t: 10, pos: [3.7, 1.05, 2.3], yaw: 90, visible: true },
          { t: 11, pos: [CHEST[0] - 0.36, 0.6, CHEST[2] - 0.1], yaw: 90, visible: true },
          { t: 15.5, pos: [CHEST[0] - 0.12, 0.44, CHEST[2] - 0.02], yaw: 90, visible: true },
          { t: 16, pos: [CHEST[0], 0.3, CHEST[2]], yaw: 90, visible: false },
          { t: 22, pos: [CHEST[0], 0.3, CHEST[2]], visible: false },
        ],
      },
    ],
    subs: [{ t: 7.2, dur: 2.6, speaker: NPC.HUANG, text: TEXT.replay.tapeMutter }],
    sfx: [{ t: 5, cue: 'drawer' }, { t: 15.2, cue: 'drawer' }],
  },
  {
    id: SEG.MID_1997, point: RP.R4_MID, order: 1, focus: MID_FOCUS, osd: '1997-07-01 09:00', dur: 18, loop: true,
    actors: [
      {
        // 街坊挤在红绸后头（面朝西、朝着剪彩的人与镜头；第一排在 x=-3.6，往东一排比一排高一点，后排看得见）
        id: GHOST.CROWD_1997, rig: 'crowd', crowd: { count: 18, cols: 9, spacing: 0.46, look: 'replay', seed: 1997, kidsFrontRow: 3 },
        keys: [
          { t: 0, pos: [-3.6, 0, 0.05], yaw: 270, pose: 'stand' },
          { t: 18, pos: [-3.6, 0, 0.05], yaw: 270, pose: 'stand' },
        ],
      },
      {
        // 南边一张摊子底下蹲着的黄鼠狼（面朝西北，眼睛反光）
        id: GHOST.WEASEL_EYES_1997, rig: 'mannequin', character: 'huang', characterOpts: { variant: 'weasel' },
        keys: [
          { t: 0, pos: [WEASEL.x, 0, WEASEL.z], yaw: WEASEL.yaw, pose: 'crouch' },
          { t: 18, pos: [WEASEL.x, 0, WEASEL.z], yaw: WEASEL.yaw, pose: 'crouch' },
        ],
      },
    ],
    props: [
      { id: 'ribbon', mesh: ribbonProp, keys: [{ t: 0, pos: [-4.4, 0, 0] }, { t: 18, pos: [-4.4, 0, 0] }] },
      { id: 'banner', mesh: bannerProp, keys: [{ t: 0, pos: [-3.4, 2.45, -2.93] }, { t: 18, pos: [-3.4, 2.45, -2.93] }] },
      { id: 'oldTable', mesh: oldTableProp, keys: [{ t: 0, pos: [WEASEL.x + 0.05, 0, WEASEL.z - 0.2] }, { t: 18, pos: [WEASEL.x + 0.05, 0, WEASEL.z - 0.2] }] },
      {
        id: 'eyes', mesh: eyesProp,
        keys: [
          { t: 0, pos: EYES, yaw: WEASEL.yaw, visible: true },
          { t: 5.5, pos: EYES, yaw: WEASEL.yaw, visible: false },
          { t: 5.8, pos: EYES, yaw: WEASEL.yaw, visible: true },
          { t: 12, pos: EYES, yaw: WEASEL.yaw, visible: false },
          { t: 12.3, pos: EYES, yaw: WEASEL.yaw, visible: true },
          { t: 18, pos: EYES, yaw: WEASEL.yaw, visible: true },
        ],
      },
    ],
    // 1997 年通道刚开通，还没有鬼市：整段隐去现世的摊位与灯笼（樟木箱也在里面，但不是旧照六的主体）
    hideWorld: [{ ref: MARKET_REF, from: 0, to: 18 }],
    subs: [],
    sfx: [{ t: 3, cue: 'paper_money' }],
  },
];
