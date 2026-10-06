// owner: WP5
// WP5 在开发沙盒里的测试夹具（ARCH §15.2 “沙盒要包含的夹具”）与页面内自测（registerSelftest('wp5.<snake>', fn)）；
// scripts/selftest/wp5.mjs 在 node 里用同一份夹具数据跑纯逻辑自测，并经 __game.selftest(name)（?debug=1&area=dev）调用页面内自测。
//
// 布局：全部夹具以 WP5_ORIGIN（沙盒西半边 x≈-14…-4）为基准，避开 WP7 的出生点 (0,0,8)、look-dev 角落 (8,0,8) 与北出口 (0,-14)。
// 夹具只用普通 three 材质，不加灯（沙盒底座的灯由 WP7 提供），不依赖别的 WP 的实现就能在 node 里建出来。
//
// 夹具里用到的 id 都是 GDD 的真 id（类型要求）：拍照主体只能是 InteractId/GhostId，所以借用 r3/r4 的物体 id 作 ref。
// 这些 id 只在 dev 区域里这样用；别的 WP 的夹具若也要登记同名 ref，M1c 统一调（docs/requests/engine-wp5.md）。

import * as THREE from 'three';
import type { AreaPart, AreaContext } from '../../core/area';
import type { CameraPose, LensMode, V3, XZ, ZoomLevel } from '../../core/types';
import type { FlagId, PhotoTargetId, SegmentId } from '../../data/ids';
import { F, GHOST, OBJ, PT, RD, RP, SEG } from '../../data/ids';
import type { Game } from '../../core/game';
import type { Caption, PhotoDecoyDef, PhotoFail, PhotoTargetDef } from '../../game/photo';
import type { ReadTargetDef } from '../../game/read';
import type { ReplayPointDef, ReplaySegmentDef } from '../../game/replay';
import type { TapeKit, TapeTrack, VcrConfig } from '../../game/vcr';
import type { ChannelSource, ConsoleConfig } from '../../game/cctv';
import type { TripodConfig } from '../../game/tripod';
import type { MirrorDef } from '../../game/mirror';
import type { InteractableDef } from '../../game/interaction';
import { registerSelftest } from '../../debug/selftest';
import type { SelftestResult } from '../../debug/selftest';
import { setLayerRecursive } from '../../core/layers';
import { TAPE } from '../../data/time';
import { ZOOM_STEPS } from '../../core/types';
import { STRINGS } from '../../data/strings';

// ==================================================================== 坐标

/** 夹具基准点（M1c 若与别的 WP 的夹具重叠，只改这里）。 */
export const WP5_ORIGIN: V3 = [-9, 0, 0];
const at = (dx: number, y: number, dz: number): V3 => [WP5_ORIGIN[0] + dx, y, WP5_ORIGIN[2] + dz];
const xz = (dx: number, dz: number): XZ => [WP5_ORIGIN[0] + dx, WP5_ORIGIN[2] + dz];

/** 夹具各处的位置（世界坐标）。自测按这些站位与瞄准点摆玩家与相机。 */
export const WP5_POS = {
  /** 拍照主体 A（人高的盒子，ref r3.big_camera） */
  A: at(0, 0.8, 0),
  /** 主体 C（多主体目标的第二个，A 东 4m，ref r4.camphor_chest） */
  C: at(4, 0.3, 0),
  /** 小主体 B（底片格大小，ref r3.film_frame3） */
  B: at(-2, 1.4, 4),
  /** 只在红外层的主体 D（ref r4.old_book）；从 S1 看过去不经过遮挡墙 */
  D: at(1, 1.0, -1),
  /** 遮挡墙（S1b → A 的视线上） */
  wall: at(1.25, 1.25, 3),
  /** 玻璃（S1c → A 的视线上，noOcclude） */
  glass: at(-1.25, 1.25, 3),
  S1: xz(0, 6), S1b: xz(2.5, 6), S1c: xz(-2.5, 6), Sfar: xz(0, 11), S2: xz(-2, 6),
  /** 残影点与片段 */
  replayPoint: at(0, 0, -6),
  replayUpper: at(0, 3.2, -6),
  replayStand: xz(0, -4.5),
  ghost: at(0, 0.85, -9),
  kiosk: at(1.5, 0.6, -9),
  /** 圆镜（面朝 +z） */
  mirror: at(-4, 1.8, -3),
  mirrorFront: xz(-4, -2.1),
  mirrorSide: xz(-3.4, -2.1),
  /** 普通读字目标（≥2×）与站位 */
  label: at(-4, 1.5, 3),
  labelStand: xz(-4, 5.5),
  /** 跟随读字目标（tooSmall:null）的运动中心与站位 */
  follower: at(3.5, 1.3, -3),
  followerStand: xz(3.5, 0),
  /** CRT 屏幕中心（面朝 +z）、面板视点 */
  screen: at(-4, 1.0, 8.5),
  /** 三脚架：支架、粉笔叉 */
  mount: at(4, 2.5, 6),
  zone: at(4, 0, 9.5),
} as const;

export const WP5_VIEW: CameraPose = { pos: [WP5_POS.screen[0], WP5_POS.screen[1], WP5_POS.screen[2] + 0.5], target: WP5_POS.screen };
const CH2_POSE: CameraPose = { pos: at(-2.5, 2.4, 10.5), target: at(-4, 0.8, 8.5), fov: 70 };
const TRIPOD_POSE: CameraPose = { pos: WP5_POS.mount, target: [WP5_POS.zone[0], 0.9, WP5_POS.zone[2]] };

/** 夹具回调的计数器（handler 写、自测读；纯 JS 状态，不碰 flags）。 */
export const WP5_PROBE = { completes: 0, tapeEvents: 0, tripodSuccess: 0, tripodOutside: 0, tripodMoved: 0, reads: 0, reset(): void {
  this.completes = 0; this.tapeEvents = 0; this.tripodSuccess = 0; this.tripodOutside = 0; this.tripodMoved = 0; this.reads = 0;
} };

// ==================================================================== 拍照目标与诱饵

/** 每种失败都给一个可辨认的标题，自测按标题断言（顺带验证 Caption 的函数形式）。 */
const CAPTIONS: Partial<Record<PhotoFail, Caption>> = {
  not_in_frame: '[not_in_frame]', partial: '[partial]', too_far: '[too_far]', zoom_low: '[zoom_low]', zoom_high: '[zoom_high]',
  wrong_lens: '[wrong_lens]', too_small: '[too_small]', occluded: '[occluded]', hidden: '[hidden]', cond: '[cond]',
  too_early: c => `[too_early@${c.kind === 'replay' ? Math.floor(c.t) : c.kind === 'vcr' ? Math.floor(c.tc) : '?'}]`,
  too_late: '[too_late]', wrong_segment: '[wrong_segment]', not_paused: '[not_paused]',
  wrong_channel: c => `[wrong_channel CH${c.kind === 'console' ? c.channel : '?'}]`, no_jack: '[no_jack]',
};

export const WP5_PHOTO_TARGETS: readonly PhotoTargetDef[] = [
  // live：A；maxZoom 3（4× → zoom_high）
  { id: PT.TUDI, subjects: [{ ref: OBJ.R3_BIG_CAMERA }], maxDist: 7, minZoom: 1, maxZoom: 3, lens: 'normal', context: { kind: 'live' }, captions: CAPTIONS,
    onHit: () => undefined },
  // live：小主体 B，≥2×、≤2.5m（1× → zoom_low，2× → too_small，3× → 命中）
  { id: PT.FILM3, subjects: [{ ref: OBJ.R3_FILM_FRAME3 }], maxDist: 2.5, minZoom: 2, lens: 'normal', context: { kind: 'live' }, captions: CAPTIONS },
  // live + 条件：区域临时状态 wp5_cond
  { id: PT.HUANG_NORMAL, subjects: [{ ref: OBJ.R3_BIG_CAMERA }], maxDist: 7, minZoom: 1, lens: 'normal', context: { kind: 'live' },
    when: s => s.temp('wp5_cond') === true, captions: CAPTIONS },
  // live + 红外镜头（常光拍 → wrong_lens）
  { id: PT.HUANG_IR, subjects: [{ ref: OBJ.R3_BIG_CAMERA }], maxDist: 7, minZoom: 1, lens: 'ir', context: { kind: 'live' }, captions: CAPTIONS },
  // 多主体：A + C（C 在画外 → partial）
  { id: PT.HUANG_HIDES, subjects: [{ ref: OBJ.R3_BIG_CAMERA }, { ref: OBJ.R4_CAMPHOR_CHEST }], maxDist: 9, minZoom: 1, lens: 'normal', context: { kind: 'live' }, captions: CAPTIONS },
  // 只在红外层的主体 D，镜头 any（常光下不可渲染 → hidden）
  { id: PT.DOOR_2025, subjects: [{ ref: OBJ.R4_OLD_BOOK }], maxDist: 8, minZoom: 1, lens: 'any', context: { kind: 'live' }, captions: CAPTIONS },
  // 回放：人影时间窗 [10,18]
  { id: PT.OLD_1, subjects: [{ ref: GHOST.HUANG_2023 }], maxDist: 8, minZoom: 1, lens: 'normal', context: { kind: 'replay', segment: SEG.STALL_2023, t: [10, 18] }, captions: CAPTIONS },
  // 回放：被 hideWorld [0,8) 隐去的现世对象
  { id: PT.OLD_2, subjects: [{ ref: OBJ.R4_KIOSK }], maxDist: 8, minZoom: 1, lens: 'normal', context: { kind: 'replay', segment: SEG.STALL_2023, t: [0, 20] }, captions: CAPTIONS },
  // 录像机：暂停在 [03:14:00, 03:14:15]，主体是 CRT 屏幕
  { id: PT.TAPE_FACE, subjects: [{ ref: OBJ.R1_CRT }], maxDist: 1.5, minZoom: 1, lens: 'normal', context: { kind: 'vcr', paused: true, tc: TAPE.faceWindow },
    captions: CAPTIONS },
  // 监控台：CH1 + 视频线，屏幕占画面 ≥ 40%，恰好 1×
  { id: PT.ZHOU_TUNNEL, subjects: [{ ref: OBJ.R1_CRT }], maxDist: 1.5, minZoom: 1, maxZoom: 1, minScreenFrac: 0.4, lens: 'normal',
    context: { kind: 'console', channel: 1, jack: true }, captions: CAPTIONS },
  // 三脚架：只登记元数据，取景器快门的判定跳过它
  { id: PT.FINAL, subjects: [{ ref: 'pc.body' }], maxDist: 20, minZoom: 1, lens: 'normal', context: { kind: 'tripod', zone: OBJ.R1_MARK_PHOTO, radius: 1.5, stillSec: 3 } },
];

export const WP5_DECOY_MIRROR = 'decoy.dev.wp5_mirror' as const;
export const WP5_PHOTO_DECOYS: readonly PhotoDecoyDef[] = [
  { key: WP5_DECOY_MIRROR, subjects: [{ ref: OBJ.R1_MIRROR }], caption: '镜子里只有一台旧摄像头。', maxDist: 3 },
];

// ==================================================================== 读字目标

/** 跟随读字目标的当前位置（夹具 update 里转圈；node 自测直接改它）。 */
export const WP5_FOLLOWER = new THREE.Vector3(...WP5_POS.follower);

export const WP5_READ_TARGETS: readonly ReadTargetDef[] = [
  { id: RD.SWITCH_LABELS, at: WP5_POS.label, maxDist: 3, minZoom: 2, text: '①车棚 ②公告栏 ③门灯 ④槐树', onRead: () => { WP5_PROBE.reads++; } },
  { id: RD.STICKER_MIRROR, at: g => g.player.model.stickerWorld(), via: { mirror: OBJ.R1_MIRROR }, maxDist: 1.2, minZoom: 3, mirror: true,
    text: '81.6.40', notInMirror: '（镜子里照不到你的脑门。往镜子正前方站。）' },
  { id: RD.HUANG_BREATH, at: () => WP5_FOLLOWER.clone(), maxDist: 5, minZoom: 4, tooSmall: null, text: '这张纸面具的嘴那块洇湿了，一鼓，一瘪。' },
];

// ==================================================================== 残影点与片段

export const WP5_SEG_DUR = { stall: 20, mid: 12 } as const;

export const WP5_REPLAY_POINTS: readonly ReplayPointDef[] = [
  { id: RP.R4_STALL, at: WP5_POS.replayPoint, segments: [SEG.STALL_2023, SEG.MID_1997] },
  // 楼上的残影点：3D 距离 > 2.5，站在地面上不能启动它
  { id: RP.R4_MID, at: WP5_POS.replayUpper, segments: [SEG.LOBBY_2008] },
];

export const WP5_SEGMENTS: readonly ReplaySegmentDef[] = [
  {
    id: SEG.STALL_2023, point: RP.R4_STALL, order: 1, osd: '2023-08-29 23:10', dur: WP5_SEG_DUR.stall, loop: true,
    actors: [{ id: GHOST.HUANG_2023, rig: 'mannequin', keys: [
      { t: 0, pos: [WP5_POS.ghost[0], 0, WP5_POS.ghost[2]], yaw: 180, pose: 'stand' },
      { t: 10, pos: [WP5_POS.ghost[0], 0, WP5_POS.ghost[2]], yaw: 180, pose: 'crouch' },
    ] }],
    hideWorld: [{ ref: OBJ.R4_KIOSK, from: 0, to: 8 }],
    subs: [{ t: 1, dur: 2, speaker: '', text: '（夹具字幕）' }],
    onComplete: () => { WP5_PROBE.completes++; },
  },
  {
    id: SEG.MID_1997, point: RP.R4_STALL, order: 2, osd: '1997-06-01 10:00', dur: WP5_SEG_DUR.mid, loop: true,
    actors: [{ id: GHOST.WEASEL_EYES_1997, rig: 'mannequin', keys: [
      { t: 0, pos: [WP5_POS.ghost[0] - 1, 0, WP5_POS.ghost[2] - 1], yaw: 90, pose: 'walk' },
      { t: 12, pos: [WP5_POS.ghost[0] + 1, 0, WP5_POS.ghost[2] - 1], yaw: 90, pose: 'walk' },
    ] }],
    subs: [],
  },
  {
    id: SEG.LOBBY_2008, point: RP.R4_MID, order: 1, osd: '2008-08-08 20:00', dur: 10, loop: true,
    actors: [{ id: GHOST.NEIGHBORS_2008, rig: 'mannequin', keys: [{ t: 0, pos: WP5_POS.replayUpper, yaw: 0, pose: 'stand' }] }],
    subs: [],
  },
];

// ==================================================================== 场景

export interface Wp5SceneHandles {
  screen: THREE.Mesh;
  mirror: THREE.Mesh;
  mount: THREE.Group;
  follower: THREE.Mesh;
  kiosk: THREE.Mesh;
}

function box(size: V3, pos: V3, color: THREE.ColorRepresentation): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  m.position.set(pos[0], pos[1], pos[2]);
  return m;
}

/**
 * 建夹具几何。add(obj, ref?, o?) 由调用方决定挂到哪里：区域 build 里是 ctx.add，node 自测里是直接挂到假 root 并登记 ref。
 * 只用普通 three 材质，不建灯。
 */
export function buildWp5Scene(add: (obj: THREE.Object3D, ref?: string, o?: { occlude?: boolean; tempC?: number }) => void): Wp5SceneHandles {
  add(box([0.6, 1.6, 0.4], WP5_POS.A, '#9a8f7a'), OBJ.R3_BIG_CAMERA);
  add(box([0.6, 0.6, 0.6], WP5_POS.C, '#7a5a3a'), OBJ.R4_CAMPHOR_CHEST);
  add(box([0.12, 0.09, 0.02], WP5_POS.B, '#c8c0a8'), OBJ.R3_FILM_FRAME3);
  const d = box([0.6, 1.0, 0.3], WP5_POS.D, '#ffb040');
  setLayerRecursive(d, 'ir_only');
  add(d, OBJ.R4_OLD_BOOK, { tempC: 36 });
  add(box([1.0, 2.5, 0.1], WP5_POS.wall, '#606870'));
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.5, 0.05), new THREE.MeshStandardMaterial({ color: '#a0c8d8', transparent: true, opacity: 0.25 }));
  glass.position.set(...WP5_POS.glass);
  glass.userData.noOcclude = true;
  glass.material.userData.noOcclude = true;
  add(glass, undefined, { occlude: false });
  const kiosk = box([0.8, 1.2, 0.8], WP5_POS.kiosk, '#4a6a4a');
  add(kiosk, OBJ.R4_KIOSK);
  // 圆镜：CircleGeometry 半径 0.25，面朝 +z
  const mirror = new THREE.Mesh(new THREE.CircleGeometry(0.25, 32), new THREE.MeshBasicMaterial({ color: '#8090a0' }));
  mirror.position.set(...WP5_POS.mirror);
  add(mirror, OBJ.R1_MIRROR);
  add(box([0.7, 0.7, 0.05], [WP5_POS.mirror[0], WP5_POS.mirror[1], WP5_POS.mirror[2] - 0.05], '#3a2e24'));
  // 读字目标所在的小牌子（字迹中心在牌面前 1cm）
  add(box([0.3, 0.4, 0.04], [WP5_POS.label[0], WP5_POS.label[1], WP5_POS.label[2] - 0.03], '#d8d0b8'));
  const follower = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), new THREE.MeshStandardMaterial({ color: '#d0c090' }));
  follower.position.copy(WP5_FOLLOWER);
  follower.name = 'wp5.follower';
  add(follower);
  // CRT：屏幕平面 0.36×0.27 面朝 +z（ref r1.crt），后面是机壳，下面是桌子
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.27), new THREE.MeshBasicMaterial({ color: '#0a140e' }));
  screen.position.set(...WP5_POS.screen);
  add(screen, OBJ.R1_CRT);
  add(box([0.46, 0.38, 0.4], [WP5_POS.screen[0], WP5_POS.screen[1], WP5_POS.screen[2] - 0.21], '#2a2a26'));
  add(box([1.2, 0.8, 0.7], [WP5_POS.screen[0], 0.4, WP5_POS.screen[2] - 0.1], '#5a4632'), OBJ.R1_DESK);
  add(box([0.4, 0.1, 0.3], [WP5_POS.screen[0] + 0.45, 0.85, WP5_POS.screen[2]], '#1a1a1a'), OBJ.R1_VCR);
  // 三脚架支架（门楣空支架）与粉笔叉
  const mount = new THREE.Group();
  mount.position.set(...WP5_POS.mount);
  mount.rotation.y = Math.PI;   // 让装上去的头朝 +z（粉笔叉方向）
  add(mount, OBJ.R1_BRACKET);
  add(box([0.08, 2.5, 0.08], [WP5_POS.mount[0], 1.25, WP5_POS.mount[2] - 0.15], '#444'));
  const mark = box([1.0, 0.01, 0.1], [WP5_POS.zone[0], 0.005, WP5_POS.zone[2]], '#f0f0f0');
  mark.rotation.y = Math.PI / 4;
  add(mark, OBJ.R1_MARK_PHOTO);
  return { screen, mirror, mount, follower, kiosk };
}

// ==================================================================== 录像机、监控台、三脚架、镜面的配置

function canvasTex(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) paint(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const paintLabel = (text: string, bg: string) => (g: CanvasRenderingContext2D, w: number, h: number): void => {
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#7CFFB2';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // 字号按画布宽度收（M1c：256 宽的 CRT 画布上 28px 的长标签被桶形畸变的黑边切掉两头）
  let px = Math.round(h * 0.15);
  for (; px > 10; px -= 2) {
    g.font = `bold ${px}px sans-serif`;
    if (g.measureText(text).width <= w * 0.72) break;
  }
  g.fillText(text, w / 2, h / 2);
};

export const WP5_CHANNELS: Record<1 | 2 | 3 | 4 | 5, ChannelSource> = {
  1: { kind: 'self', noSignal: paintLabel('无信号 · 视频入1 未接', '#0a1a3a') },
  2: { kind: 'live', camPose: CH2_POSE },
  3: { kind: 'static', paint: (g, w, h, _s, t) => paintLabel(`CH3 ${Math.floor(t)}`, '#202418')(g, w, h), animate: true },
  4: { kind: 'static', paint: (g, w, h) => paintLabel('CH4', '#241820')(g, w, h) },
  5: { kind: 'static', paint: (g, w, h, s) => paintLabel(s.temp('wp5_cond') === true ? 'CH5 *' : 'CH5', '#182024')(g, w, h) },
};

export function wp5ConsoleConfig(h: Wp5SceneHandles): ConsoleConfig {
  return {
    screen: h.screen, viewPose: WP5_VIEW, channels: WP5_CHANNELS,
    tunnelBaked: () => canvasTex(256, 192, g => {
      for (let i = 0; i < 8; i++) {
        const k = 1 - i / 9;
        g.strokeStyle = `rgba(124,255,178,${0.9 - i * 0.1})`;
        g.lineWidth = 3;
        g.strokeRect(128 - 120 * k, 96 - 90 * k, 240 * k, 180 * k);
      }
    }),
    tunnelInner: (g, w, hh, s) => paintLabel(s.temp('wp5_cond') === true ? '老周' : '空椅子', '#000')(g, w, hh),
  };
}

export const WP5_TAPE: TapeTrack = {
  startLabel: TAPE.startLabel, lengthSec: TAPE.lengthSec, splitFrom: TAPE.splitFrom,
  cams: { ch1: { pos: [0, 2.8, 0], target: [0, 0.9, 3] }, ch2: { pos: [2, 2.4, -2], target: [0, 0.8, -1] } },
  actors: [{ id: GHOST.ZHOU_2023, character: 'zhou', keys: [
    { t: 0, pos: [0, 0, -1], yaw: 0, pose: 'sit' },
    { t: 18720, pos: [0, 0, 2.5], yaw: 180, pose: 'stand' },   // 03:12 走到门前
    { t: 18840, pos: [0, 0, 2.5], yaw: 180, pose: 'look_up' },  // 03:14 抬头
    { t: 18855, pos: [0, 0, 2.5], yaw: 180, pose: 'stand' },
    { t: 18960, pos: [0, 0, -1], yaw: 0, pose: 'sit' },          // 03:16 回屋
  ] }],
  build(scene: THREE.Scene, kit: TapeKit): void {
    const floor = kit.track(new THREE.PlaneGeometry(10, 10));
    const mat = kit.track(new THREE.MeshStandardMaterial({ color: '#333a44' }));
    const m = new THREE.Mesh(floor, mat);
    m.rotation.x = -Math.PI / 2;
    scene.add(m);
    const door = new THREE.Mesh(kit.track(new THREE.BoxGeometry(1, 2.1, 0.1)), kit.track(new THREE.MeshStandardMaterial({ color: '#6a5040' })));
    door.position.set(0, 1.05, 0.5);
    scene.add(door);
    kit.light(new THREE.HemisphereLight('#8090b0', '#202020', 0.8));
    const lamp = kit.light(new THREE.PointLight('#ffc070', 4, 8));
    lamp.position.set(0, 2.4, 1.2);
    scene.background = new THREE.Color('#0b1020');
  },
};

export function wp5VcrConfig(h: Wp5SceneHandles): VcrConfig {
  return {
    screen: h.screen, viewPose: WP5_VIEW, track: WP5_TAPE,
    timelapseUntil: TAPE.timelapseUntil, alarmFrom: TAPE.alarmFrom, slowZone: TAPE.slowZone, index: TAPE.index,
    events: [{ tc: TAPE.watchedAt, effects: () => { WP5_PROBE.tapeEvents++; } }],
    subtitles: [{ from: '00:30:00', to: '01:10:00', text: '（录像机不录声音）' }],
  };
}

export function wp5TripodConfig(h: Wp5SceneHandles): TripodConfig {
  return {
    mount: h.mount, camPose: TRIPOD_POSE, zone: WP5_POS.zone, radius: 1.5, countdown: 10, stillSec: 3,
    osd: r => `CH1 定时 ${Math.ceil(r)}`,
    onSuccess: () => { WP5_PROBE.tripodSuccess++; },
    onFailOutside: () => { WP5_PROBE.tripodOutside++; },
    onFailMoved: () => { WP5_PROBE.tripodMoved++; },
  };
}

export function wp5MirrorDef(h: Wp5SceneHandles): MirrorDef {
  const c = new THREE.Vector3(...WP5_POS.mirror);
  return {
    id: OBJ.R1_MIRROR, mesh: h.mirror,
    activeWhen: g => g.player.position.distanceTo(c) < 5,
    baked: () => canvasTex(256, 256, g => {
      g.fillStyle = '#556070';
      g.fillRect(0, 0, 256, 256);
      g.save();
      g.scale(-1, 1);
      g.fillStyle = '#111';
      g.font = 'bold 30px sans-serif';
      g.fillText('04.6.18', -180, 80);
      g.restore();
    }),
  };
}

/** 夹具的交互物：对 CRT 按 E 开监控台、对录像机按 E 装带/开面板、插视频线、对支架按 E 进三脚架。 */
const INTERACTABLES: readonly InteractableDef[] = [
  { id: OBJ.R1_CRT, label: '监控台', at: WP5_POS.screen, onInteract: g => g.cctv.open() },
  { id: OBJ.R1_VCR, label: '录像机', at: [WP5_POS.screen[0] + 0.45, 0.9, WP5_POS.screen[2]], onInteract: g => (g.vcr.loaded ? g.vcr.open() : g.vcr.insert()) },
  { id: OBJ.R1_CRT_JACK, label: '视频入1', at: [WP5_POS.screen[0] - 0.3, 0.9, WP5_POS.screen[2]], onInteract: g => g.cctv.plugJack() },
  { id: OBJ.R1_BRACKET, label: '支架', at: WP5_POS.mount, range: 4, onInteract: g => g.tripod.enter() },
];

// ==================================================================== AreaPart

/** build 时建出来的跟随读字小球（update 每帧挪它；换区域时 build 重新赋值）。 */
let followerMesh: THREE.Object3D | null = null;

const wp5: AreaPart = {
  photoTargets: WP5_PHOTO_TARGETS,
  photoDecoys: WP5_PHOTO_DECOYS,
  readTargets: WP5_READ_TARGETS,
  replayPoints: WP5_REPLAY_POINTS,
  segments: WP5_SEGMENTS,
  interactables: INTERACTABLES,
  build(ctx: AreaContext): void {
    // 自带一块地面碰撞体（与沙盒底座的地面重叠无妨）：夹具区不依赖别人的地面，站位不会掉下去触发“走出回放半径”
    ctx.collider.floor(WP5_ORIGIN[0] - 5.5, WP5_ORIGIN[2] - 12, WP5_ORIGIN[0] + 5.5, WP5_ORIGIN[2] + 12, 0);
    const h = buildWp5Scene((obj, ref, o) => {
      ctx.add(obj, { ...(ref ? { ref } : {}), ...(o?.occlude !== undefined ? { occlude: o.occlude } : {}), ...(o?.tempC !== undefined ? { tempC: o.tempC } : {}) });
    });
    followerMesh = h.follower;
    ctx.mirror(wp5MirrorDef(h));
    ctx.console(wp5ConsoleConfig(h));
    ctx.vcr(wp5VcrConfig(h));
    ctx.tripod(wp5TripodConfig(h));
  },
  update(ctx: AreaContext, _dt: number): void {
    // 跟随读字目标：绕中心慢慢转圈（游戏时间）
    const t = ctx.game.time;
    WP5_FOLLOWER.set(WP5_POS.follower[0] + Math.cos(t * 0.5) * 0.4, WP5_POS.follower[1], WP5_POS.follower[2] + Math.sin(t * 0.5) * 0.2);
    followerMesh?.position.copy(WP5_FOLLOWER);
  },
};

export default wp5;

// ==================================================================== 自测用例（node 与页面内共用）

export interface ShotCase {
  name: string;
  /** 本例只登记这些目标（隔离：别的目标的主体不会抢命中） */
  targets: readonly PhotoTargetId[];
  decoys?: readonly PhotoDecoyDef['key'][];
  stand: XZ;
  aim: V3;
  zoom?: ZoomLevel;
  lens?: LensMode;
  temp?: Readonly<Record<string, boolean>>;
  flags?: readonly FlagId[];
  /** 情境：live（默认）/ 回放（先在残影点按 R，再 seek）/ 录像机叠加 / 监控台叠加 */
  replay?: { seg: SegmentId; t: number };
  vcr?: { tc: string; playing?: boolean };
  console?: { channel: 1 | 2 | 3 | 4 | 5; jack: boolean };
  expect: { hit: string } | { fail: PhotoFail; caption?: string };
}

const AIM_A = WP5_POS.A;
const offA = (dx: number): V3 => [AIM_A[0] + dx, AIM_A[1], AIM_A[2]];
const behind: V3 = [WP5_POS.S1[0], 1.85, WP5_POS.S1[1] + 10];

/** ARCH §15.3：PhotoFail 每种至少一例，外加命中、隔玻璃命中、诱饵、红外命中与空镜。 */
export const WP5_SHOT_CASES: readonly ShotCase[] = [
  { name: 'hit live', targets: [PT.TUDI], stand: WP5_POS.S1, aim: AIM_A, expect: { hit: PT.TUDI } },
  { name: 'nothing', targets: [PT.TUDI], stand: WP5_POS.S1, aim: behind, expect: { fail: 'nothing', caption: '空镜' } },
  { name: 'not_in_frame', targets: [PT.TUDI], stand: WP5_POS.S1, aim: offA(3), expect: { fail: 'not_in_frame', caption: '[not_in_frame]' } },
  { name: 'partial', targets: [PT.HUANG_HIDES], stand: WP5_POS.S1, aim: AIM_A, expect: { fail: 'partial', caption: '[partial]' } },
  { name: 'too_far', targets: [PT.TUDI], stand: WP5_POS.Sfar, aim: AIM_A, expect: { fail: 'too_far' } },
  { name: 'zoom_low', targets: [PT.FILM3], stand: WP5_POS.S2, aim: WP5_POS.B, zoom: 1, expect: { fail: 'zoom_low' } },
  { name: 'too_small', targets: [PT.FILM3], stand: WP5_POS.S2, aim: WP5_POS.B, zoom: 2, expect: { fail: 'too_small' } },
  { name: 'hit small 3x', targets: [PT.FILM3], stand: WP5_POS.S2, aim: WP5_POS.B, zoom: 3, expect: { hit: PT.FILM3 } },
  { name: 'zoom_high', targets: [PT.TUDI], stand: WP5_POS.S1, aim: AIM_A, zoom: 4, expect: { fail: 'zoom_high' } },
  { name: 'wrong_lens', targets: [PT.HUANG_IR], stand: WP5_POS.S1, aim: AIM_A, expect: { fail: 'wrong_lens' } },
  { name: 'occluded', targets: [PT.TUDI], stand: WP5_POS.S1b, aim: AIM_A, expect: { fail: 'occluded' } },
  { name: 'hit through glass', targets: [PT.TUDI], stand: WP5_POS.S1c, aim: AIM_A, expect: { hit: PT.TUDI } },
  { name: 'hidden (ir_only subject, normal lens)', targets: [PT.DOOR_2025], stand: WP5_POS.S1, aim: WP5_POS.D, expect: { fail: 'hidden' } },
  { name: 'hit ir_only subject in IR', targets: [PT.DOOR_2025], stand: WP5_POS.S1, aim: WP5_POS.D, zoom: 2, lens: 'ir', flags: [F.R2_ABILITY_IR], expect: { hit: PT.DOOR_2025 } },
  { name: 'cond', targets: [PT.HUANG_NORMAL], stand: WP5_POS.S1, aim: AIM_A, expect: { fail: 'cond' } },
  { name: 'hit cond', targets: [PT.HUANG_NORMAL], stand: WP5_POS.S1, aim: AIM_A, temp: { wp5_cond: true }, expect: { hit: PT.HUANG_NORMAL } },
  { name: 'decoy', targets: [PT.TUDI], decoys: [WP5_DECOY_MIRROR], stand: WP5_POS.mirrorFront, aim: WP5_POS.mirror, expect: { hit: WP5_DECOY_MIRROR } },
  // 回放
  { name: 'too_early (function caption)', targets: [PT.OLD_1], stand: WP5_POS.replayStand, aim: WP5_POS.ghost, replay: { seg: SEG.STALL_2023, t: 4 },
    expect: { fail: 'too_early', caption: '[too_early@4]' } },
  { name: 'too_late', targets: [PT.OLD_1], stand: WP5_POS.replayStand, aim: WP5_POS.ghost, replay: { seg: SEG.STALL_2023, t: 19 }, expect: { fail: 'too_late' } },
  { name: 'hit replay window', targets: [PT.OLD_1], stand: WP5_POS.replayStand, aim: WP5_POS.ghost, replay: { seg: SEG.STALL_2023, t: 12 }, expect: { hit: PT.OLD_1 } },
  // 片段不对：主体是现世对象（在哪一段里都在），玩家对着它拍
  { name: 'wrong_segment', targets: [PT.OLD_2], stand: WP5_POS.replayStand, aim: WP5_POS.kiosk, replay: { seg: SEG.MID_1997, t: 5 }, expect: { fail: 'wrong_segment' } },
  { name: 'hidden (hideWorld)', targets: [PT.OLD_2], stand: WP5_POS.replayStand, aim: WP5_POS.kiosk, replay: { seg: SEG.STALL_2023, t: 4 }, expect: { fail: 'hidden' } },
  { name: 'hit after hideWorld window', targets: [PT.OLD_2], stand: WP5_POS.replayStand, aim: WP5_POS.kiosk, replay: { seg: SEG.STALL_2023, t: 10 }, expect: { hit: PT.OLD_2 } },
  // 录像机叠加取景器
  { name: 'not_paused', targets: [PT.TAPE_FACE], stand: WP5_POS.S1, aim: WP5_POS.screen, vcr: { tc: '03:14:05', playing: true }, expect: { fail: 'not_paused' } },
  { name: 'vcr too_early', targets: [PT.TAPE_FACE], stand: WP5_POS.S1, aim: WP5_POS.screen, vcr: { tc: '03:13:00' }, expect: { fail: 'too_early' } },
  { name: 'vcr too_late', targets: [PT.TAPE_FACE], stand: WP5_POS.S1, aim: WP5_POS.screen, vcr: { tc: '03:14:20' }, expect: { fail: 'too_late' } },
  { name: 'hit tape face', targets: [PT.TAPE_FACE], stand: WP5_POS.S1, aim: WP5_POS.screen, vcr: { tc: '03:14:05' }, expect: { hit: PT.TAPE_FACE } },
  // 监控台叠加取景器
  { name: 'wrong_channel (function caption)', targets: [PT.ZHOU_TUNNEL], stand: WP5_POS.S1, aim: WP5_POS.screen, console: { channel: 2, jack: true },
    expect: { fail: 'wrong_channel', caption: '[wrong_channel CH2]' } },
  { name: 'no_jack', targets: [PT.ZHOU_TUNNEL], stand: WP5_POS.S1, aim: WP5_POS.screen, console: { channel: 1, jack: false }, expect: { fail: 'no_jack' } },
  { name: 'tunnel zoom_high', targets: [PT.ZHOU_TUNNEL], stand: WP5_POS.S1, aim: WP5_POS.screen, zoom: 2, console: { channel: 1, jack: true }, expect: { fail: 'zoom_high' } },
  { name: 'hit tunnel', targets: [PT.ZHOU_TUNNEL], stand: WP5_POS.S1, aim: WP5_POS.screen, console: { channel: 1, jack: true }, expect: { hit: PT.ZHOU_TUNNEL } },
];

export interface ReadCase {
  name: string;
  stand: XZ;
  /** 瞄准：目标 id（取 read.aimPoint）或世界点 */
  aim: V3 | 'target';
  target: ReadTargetDef['id'];
  zoom: ZoomLevel;
  lens?: LensMode;
  expect: { reading: ReadTargetDef['id'] } | { hint: string | null };
}

export const WP5_READ_CASES: readonly ReadCase[] = [
  { name: 'label 1× → tooSmall', target: RD.SWITCH_LABELS, stand: WP5_POS.labelStand, aim: 'target', zoom: 1, expect: { hint: STRINGS.feedback.readTooSmall } },
  { name: 'label 2× → read', target: RD.SWITCH_LABELS, stand: WP5_POS.labelStand, aim: 'target', zoom: 2, expect: { reading: RD.SWITCH_LABELS } },
  { name: 'label in IR → nothing', target: RD.SWITCH_LABELS, stand: WP5_POS.labelStand, aim: 'target', zoom: 2, lens: 'ir', expect: { hint: null } },
  { name: 'mirror front 3× → read', target: RD.STICKER_MIRROR, stand: WP5_POS.mirrorFront, aim: 'target', zoom: 3, expect: { reading: RD.STICKER_MIRROR } },
  { name: 'mirror front 2× → tooSmall', target: RD.STICKER_MIRROR, stand: WP5_POS.mirrorFront, aim: 'target', zoom: 2, expect: { hint: STRINGS.feedback.readTooSmall } },
  { name: 'mirror side 0.6m → notInMirror', target: RD.STICKER_MIRROR, stand: WP5_POS.mirrorSide, aim: 'target', zoom: 3,
    expect: { hint: '（镜子里照不到你的脑门。往镜子正前方站。）' } },
  // M4 第 2 轮：真人站偏时照常对着镜子中心看（虚像在镜外、不在画面里）——也给 notInMirror
  { name: 'mirror side 0.6m, aim at the mirror → notInMirror', target: RD.STICKER_MIRROR, stand: WP5_POS.mirrorSide, aim: WP5_POS.mirror, zoom: 3,
    expect: { hint: '（镜子里照不到你的脑门。往镜子正前方站。）' } },
  { name: 'follower 1× → nothing (tooSmall:null)', target: RD.HUANG_BREATH, stand: WP5_POS.followerStand, aim: 'target', zoom: 1, expect: { hint: null } },
  { name: 'follower 4× → read', target: RD.HUANG_BREATH, stand: WP5_POS.followerStand, aim: 'target', zoom: 4, expect: { reading: RD.HUANG_BREATH } },
];

// ==================================================================== 页面内自测（?debug=1&area=dev；依赖 WP1–WP4 的实现，M1c 起必须通过）

type Notes = string[];
function check(notes: Notes, cond: boolean, msg: string): boolean {
  notes.push(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  return cond;
}
function result(notes: Notes): SelftestResult {
  return { ok: notes.every(n => n.startsWith('ok')), notes };
}

async function settleFrames(game: Game, sec = 0.1): Promise<void> {
  await game.advance(sec);
}

/** 退回 explore，按需进取景器，摆好站位、朝向、倍率与镜头。 */
async function stage(game: Game, stand: XZ, aim: V3, zoom: ZoomLevel, lens: LensMode): Promise<void> {
  game.modes.resetTo('mode.explore');
  game.player.teleport([stand[0], 0, stand[1]]);
  await settleFrames(game);
  if (game.modes.top !== 'mode.viewfinder') game.modes.push('mode.viewfinder');
  const vf = game.sys.viewfinder;
  if (vf.lens !== lens) vf.setLens(lens);
  for (let i = 0; i < ZOOM_STEPS.length && vf.zoom !== zoom; i++) vf.stepZoom(vf.zoom < zoom ? 1 : -1);
  game.player.lookAtPoint(new THREE.Vector3(...aim), 'fp');
  game.cameras.sync();
}

function registerOnly(game: Game, targets: readonly PhotoTargetId[], decoys: readonly string[]): void {
  const photo = game.sys.photo;
  photo.clearArea();
  photo.register(WP5_PHOTO_TARGETS.filter(t => targets.includes(t.id)), WP5_PHOTO_DECOYS.filter(d => decoys.includes(d.key)));
}

function restoreAll(game: Game): void {
  const photo = game.sys.photo;
  photo.clearArea();
  photo.register(WP5_PHOTO_TARGETS, WP5_PHOTO_DECOYS);
}

registerSelftest('wp5.photo_fails', async game => {
  const notes: Notes = [];
  const ctx = game.areas.current?.ctx;
  try {
    for (const c of WP5_SHOT_CASES) {
      registerOnly(game, c.targets, c.decoys ?? []);
      if (c.flags?.length) game.state.debugSet({ flags: Object.fromEntries(c.flags.map(f => [f, true])) });
      ctx?.setTemp('wp5_cond', c.temp?.wp5_cond === true);
      if (c.vcr || c.console) {
        game.modes.resetTo('mode.explore');
        if (c.vcr) {
          const v = game.sys.vcr;
          if (!v.loaded) v.insert();
          else v.open();
          v.seek(c.vcr.tc);
          if (c.vcr.playing) v.play();
          else v.pause();
        } else if (c.console) {
          const k = game.sys.cctv;
          k.open();
          k.select(c.console.channel);
          if (c.console.jack) k.plugJack();
          else k.unplugJack();
        }
        game.modes.push('mode.viewfinder');
        const vf = game.sys.viewfinder;
        const z = c.zoom ?? 1;
        for (let i = 0; i < ZOOM_STEPS.length && vf.zoom !== z; i++) vf.stepZoom(vf.zoom < z ? 1 : -1);
        if (vf.lens !== (c.lens ?? 'normal')) vf.setLens(c.lens ?? 'normal');
      } else if (c.replay) {
        await stage(game, c.stand, [WP5_POS.replayPoint[0], 0.8, WP5_POS.replayPoint[2]], c.zoom ?? 1, c.lens ?? 'normal');
        game.state.debugSet({ flags: { [F.R1_ABILITY_REPLAY]: true } });
        const rp = game.sys.replay;
        const r = rp.pressR();
        if (!check(notes, r.ok, `${c.name}: pressR → ${r.reason ?? 'ok'}`)) continue;
        for (let i = 0; i < 3 && rp.active?.seg !== c.replay.seg; i++) rp.pressR();
        rp.seek(c.replay.t);
        if (rp.active?.playing) rp.togglePlay();
        game.player.lookAtPoint(new THREE.Vector3(...c.aim), 'fp');
        game.cameras.sync();
      } else {
        await stage(game, c.stand, c.aim, c.zoom ?? 1, c.lens ?? 'normal');
      }
      const r = game.sys.photo.shoot();
      const j = game.sys.photo.lastJudgement;
      if ('hit' in c.expect) check(notes, r.ok && j?.hit === c.expect.hit, `${c.name}: hit ${j?.hit ?? '-'} (fail ${j?.fail ?? '-'})`);
      else {
        const e = c.expect;
        check(notes, r.ok && j?.hit === null && j.fail === e.fail && (e.caption === undefined || r.result?.caption === e.caption),
          `${c.name}: fail ${j?.fail ?? '-'} caption ${r.result?.caption ?? '-'}`);
      }
    }
  } finally {
    game.modes.resetTo('mode.explore');
    ctx?.setTemp('wp5_cond', false);
    restoreAll(game);
  }
  return result(notes);
});

registerSelftest('wp5.read', async game => {
  const notes: Notes = [];
  const rd = game.sys.read;
  for (const c of WP5_READ_CASES) {
    if (c.lens === 'ir') game.state.debugSet({ flags: { [F.R2_ABILITY_IR]: true } });
    const first = rd.aimPoint(c.target);
    await stage(game, c.stand, first ? [first.x, first.y, first.z] : WP5_POS.label, c.zoom, c.lens ?? 'normal');
    // 镜中字的瞄准点（虚像）依赖此刻头的位置：按新的虚像点再转一次
    const p = c.aim === 'target' ? rd.aimPoint(c.target) : new THREE.Vector3(...c.aim);
    if (p) game.player.lookAtPoint(p, 'fp');
    game.cameras.sync();
    rd.evaluate();
    const msg = `${c.name}: reading ${rd.reading?.id ?? '-'} hint ${rd.hint ?? '-'}`;
    if ('reading' in c.expect) check(notes, rd.reading?.id === c.expect.reading, msg);
    else check(notes, rd.reading === null && rd.hint === c.expect.hint, msg);
  }
  game.sys.viewfinder.setLens('normal');
  game.modes.resetTo('mode.explore');
  return result(notes);
});

registerSelftest('wp5.replay', async game => {
  const notes: Notes = [];
  const rp = game.sys.replay;
  const kiosk = game.areas.current?.ctx.getRef(OBJ.R4_KIOSK);
  game.state.debugSet({ flags: { [F.R1_ABILITY_REPLAY]: true } });
  await stage(game, WP5_POS.replayStand, [WP5_POS.replayPoint[0], 0.8, WP5_POS.replayPoint[2]], 1, 'normal');
  check(notes, rp.segmentRoot(SEG.STALL_2023)?.visible === false, 'segment prebuilt hidden before replay');
  const r = rp.pressR();
  check(notes, r.ok && rp.active?.seg === SEG.STALL_2023 && game.modes.top === 'mode.replay', `pressR starts nearest segment (${r.reason ?? 'ok'})`);
  rp.seek(4);
  check(notes, kiosk?.visible === false, 'hideWorld object invisible inside [0,8)');
  rp.seek(9);
  check(notes, kiosk?.visible === true, 'hideWorld object visible after window');
  WP5_PROBE.reset();
  rp.seek(WP5_SEG_DUR.stall);
  rp.seek(WP5_SEG_DUR.stall + 3);
  check(notes, WP5_PROBE.completes === 1 && rp.active?.t === 0, `seek(dur) fires onComplete once and loops (completes=${WP5_PROBE.completes})`);
  const ends: string[] = [];
  const off = game.events.on('replay:end', e => ends.push(e.reason));
  await game.advance(WP5_SEG_DUR.stall + 1);
  off();
  check(notes, ends.length === 0, `replay keeps playing through advance (${ends.join(',') || 'no exit'})`);
  check(notes, WP5_PROBE.completes === 1 && rp.active !== null,
    `playing past dur again in same replay does not refire onComplete (active=${rp.active?.seg ?? '-'} t=${rp.active?.t.toFixed(2) ?? '-'} pos=${game.player.position.toArray().map(v => v.toFixed(2)).join(',')})`);
  rp.pressR();
  check(notes, rp.active?.seg === SEG.MID_1997 && rp.active.index === 2, 'R again → older segment (2/2)');
  rp.pressR();
  check(notes, rp.active?.seg === SEG.STALL_2023 && rp.active.index === 1, 'R after oldest → back to most recent');
  const pr = rp.present();
  check(notes, pr.ok && rp.active === null && game.modes.top === 'mode.viewfinder' && kiosk?.visible === true, 'F → back to viewfinder, world restored');
  // 走出 8m：画面断了
  rp.pressR();
  game.player.teleport([WP5_POS.replayPoint[0], 0, WP5_POS.replayPoint[2] + 9]);
  await game.advance(0.1);
  check(notes, rp.active === null, 'walking out of walkRadius exits replay');
  game.modes.resetTo('mode.explore');
  return result(notes);
});

registerSelftest('wp5.vcr', async game => {
  const notes: Notes = [];
  const v = game.sys.vcr;
  game.modes.resetTo('mode.explore');
  WP5_PROBE.reset();
  const ins = v.insert();
  check(notes, ins.ok && game.modes.top === 'mode.panel_vcr' && v.tc === 0, 'insert opens panel at 22:00:00');
  const scene = v.tapeScene;
  let leaks = false;
  scene?.traverse(o => {
    if (o === game.playerModel.root || o === game.areas.current?.root) leaks = true;
  });
  check(notes, scene !== null && !leaks && scene !== game.scene, 'tapeScene is separate (no player, no area root)');
  v.seek('03:16:00');
  check(notes, WP5_PROBE.tapeEvents === 1, 'seek exactly onto 03:16:00 fires the event');
  v.seek('03:10:00');
  v.jumpIndex(1);
  check(notes, v.tcString() === '03:12:00', `] from 03:10 → ${v.tcString()}`);
  v.seek('03:13:00');
  v.setShuttle(1);
  await game.advance(5);
  check(notes, v.shuttle === 0 && v.playing && v.tc < 18840, `fast-forward drops to 1× inside slow zone (${v.tcString()})`);
  v.pause();
  game.modes.resetTo('mode.explore');
  return result(notes);
});

registerSelftest('wp5.console', async game => {
  const notes: Notes = [];
  const k = game.sys.cctv;
  check(notes, k.validate().length === 0, `console fields complete (${k.validate().join(',')})`);
  game.modes.resetTo('mode.explore');
  check(notes, k.open().ok && game.modes.top === 'mode.panel_console', 'open pushes panel_console');
  check(notes, k.select(3).ok && k.channel === 3, 'select CH3');
  k.select(1);
  k.plugJack();
  game.modes.push('mode.viewfinder');
  await game.advance(0.1);
  check(notes, k.tunnelDepth() > 0, `tunnel depth > 0 when overlay aims at CH1 with jack (${k.tunnelDepth()})`);
  k.unplugJack();
  game.modes.resetTo('mode.explore');
  return result(notes);
});

registerSelftest('wp5.tripod', async game => {
  const notes: Notes = [];
  const t = game.sys.tripod;
  game.modes.resetTo('mode.explore');
  WP5_PROBE.reset();
  const run = async (inside: boolean, move: boolean): Promise<void> => {
    t.bodyGoto(inside ? WP5_POS.zone[0] : WP5_POS.zone[0] + 3, WP5_POS.zone[2]);
    t.start();
    await game.advance(10.2);
    if (move) game.input.setMove({ x: 0, z: 1, sprint: false });
    await game.advance(3.2);
    if (move) game.input.setMove(null);
  };
  check(notes, t.enter().ok && game.modes.top === 'mode.tripod' && t.state === 'armed' && game.save.held, 'enter → armed, save held');
  await run(false, false);
  check(notes, WP5_PROBE.tripodOutside === 1 && t.state === 'armed', 'outside the chalk mark → onFailOutside, back to armed');
  await run(true, true);
  check(notes, WP5_PROBE.tripodMoved === 1 && t.state === 'armed', 'moving during exposure → onFailMoved');
  check(notes, t.cancel().ok && game.modes.top === 'mode.explore' && !game.save.held, 'cancel while armed → explore, save released');
  t.enter();
  await run(true, false);
  check(notes, WP5_PROBE.tripodSuccess === 1 && t.state === 'off' && !game.playerModel.headMounted, 'still inside → onSuccess, head stays on the mount');
  // 收尾：把头装回去、释放结局的存档 hold，后面的测试拿到的是完整的主角
  t.restoreHead();
  game.save.release('ending');
  check(notes, game.playerModel.headMounted && !game.save.held, 'cleanup: head back, save hold released');
  game.modes.resetTo('mode.explore');
  return result(notes);
});

registerSelftest('wp5.mirror', async game => {
  const notes: Notes = [];
  const d = game.sys.mirror.disc(OBJ.R1_MIRROR);
  check(notes, Math.abs(d.radius - 0.25) < 1e-6 && Math.abs(d.normal.z - 1) < 1e-6, `mirror disc r=${d.radius.toFixed(3)} n=(${d.normal.toArray().map(n => n.toFixed(2)).join(',')})`);
  game.modes.resetTo('mode.explore');
  game.player.teleport([WP5_POS.mirrorFront[0], 0, WP5_POS.mirrorFront[1]]);
  await game.advance(0.2);
  check(notes, game.sys.mirror.active, 'mirror active near it');
  return result(notes);
});
