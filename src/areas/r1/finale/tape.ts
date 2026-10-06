// owner: R1-finale
// 录像带 it.tape_830 的内容（GDD §3.8、§2.4；ARCH §6.10）：独立 tapeScene 里的 2023 年门岗——门口（CH1，门楣俯拍）与屋里（CH2，屋角半球机位），
// 雨、3 盏自带的灯（门口灯、屋里灯泡、天光），以及老周这一宿的全部事件。坐标沿用 R1（layout.ts），所以关键帧与 GDD 的站位一致。
//
// 带子里的老周用 look:'live'、不开雪花脸（当年伙计的眼睛录下的，不是倒带）。一个角色的“摘帽”“趴桌”是造型变体，
// 录像机按关键帧只给位置、朝向、姿势，所以老周拆成三个同 id 的演员（戴帽 / 摘帽 / 趴桌），不在场的那两个停到远处（相机远裁面 60m 之外）。
// 帧内的小道具（擦镜头的袖子、垫脚的凳子、00:30 那段仰头说话、天亮）在 scene.onBeforeRender 里按带子时刻 tc 摆好（three 在投影场景前调用它）。

import * as THREE from 'three';
import type { V3, Pose } from '../../../core/types';
import type { AreaContext } from '../../../core/area';
import type { ReplayActorKey } from '../../../game/replay';
import type { TapeKit, TapeTrack } from '../../../game/vcr';
import { GHOST } from '../../../data/ids';
import { PALETTE } from '../../../data/palette';
import { TAPE, tapeSec } from '../../../data/time';
import { MATERIALS, isSharedMaterial } from '../../../fx/materials';
import { box, plane } from '../../../kit/geom';
import { door } from '../../../kit/doors';
import { designLight } from '../../../kit/lamps';
import { PROPS } from '../../../kit/props';
import { rain } from '../../../kit/rain';
import { PAINT } from '../../../kit/canvas';
import { makeTextPlane } from '../../../kit/text';
import { R1 } from '../layout';
import { sleeveTexture, tapeFaceTexture } from './art';

const T = (tc: string, d = 0): number => tapeSec(tc) + d;

/**
 * 带子里的 CH1：门楣上俯拍门口（03:14 抬起来的那张脸正好在画面中央；比现在的 CH1 收一点视场，那张脸在 256×192 里才看得出是张脸）。
 * M4：视场 36° → 30°、往下压一点（抬起来的脸比原来大 1.36 倍，约占半幅高度的 29%；门前站着的帽顶、台阶上坐着的背影仍在画里）。
 * 画面上缘是门前那块空地与院门方向，下缘是门口台阶；机位贴着东墙外 0.15m，屋顶不往东出檐（否则镜头就埋在屋面里）。
 */
export const TAPE_CH1 = { pos: [-4.85, 2.75, 20.2] as V3, target: [-3.5, 1.1, 21.4] as V3, fov: 30 };
/** 带子里的 CH2：屋角半球机位（只拍得到桌前人的后脑勺和肩膀）。 */
export const TAPE_CH2 = { pos: [-7.8, 2.4, 18.8] as V3, target: [-6.4, 0.9, 21.0] as V3, fov: 70 };

// ------------------------------------------------------------------ 站位
const CHAIR: V3 = [-6.5, 0, 20.8];
const IN_DOOR: V3 = [-5.45, 0, 20.22];
const OUT_DOOR: V3 = [-4.55, 0.12, 20.35];
/** 23:04 擦镜头：踩着凳子站在支架底下 */
const STOOL_AT: V3 = [-4.42, 0, 20.5];
const ON_STOOL: V3 = [STOOL_AT[0], 0.45, STOOL_AT[2]];
/** 00:30 背对镜头坐在门口台阶上（台阶面 0.12m，人偶坐高 0.45 → 往下挪；坐在台阶外沿，在画面中下部） */
const ON_STEP: V3 = [-3.78, -0.33, 21.85];
/**
 * 03:12 走到门前 (-3.4,21.4) 站住（GDD P12；带子 CH1 的取景按这里定的）。
 * M4：不再取 layout 的 npcSpots.zhouDoor——那是结局里他站着拍合影的地方，M4 为了合影构图挪到了 (-1.9,21.51)，带子里的站位不跟着动。
 */
const FRONT: V3 = [-3.4, 0, 21.4];
/**
 * 03:13:30–03:14:40 他站住、摘帽抬头的那一步：比 FRONT 往 CH1 镜头挪近 0.75m（M4：抬起来的脸在左半帧里占到四分之一以上的高度，
 * 眉眼嘴读得出来；戴帽/摘帽两个演员用同一个位置，换人时不跳）。
 */
const FACE_AT: V3 = [FRONT[0] - 0.6, 0, FRONT[2] - 0.45];
/** 02:51 屋里按报警铃 */
const ALARM_AT: V3 = [-7.35, 0, 21.05];
/** 不在场的演员停到这里（远于相机远裁面） */
const PARK: V3 = [200, -200, 200];
/** 面朝 CH1 镜头的 yaw */
const FACE_CAM = 310;

const k = (t: number, pos: V3, yaw: number, pose: Pose): ReplayActorKey => ({ t, pos, yaw, pose });

/** 戴帽的老周：一宿的大部分时间。 */
const KEYS_CAP: readonly ReplayActorKey[] = [
  k(0, CHAIR, 180, 'sit'),
  // 23:04–23:06 用袖子擦镜头
  k(T('23:03:20'), CHAIR, 180, 'sit'),
  k(T('23:03:32'), [-6.2, 0, 20.5], 90, 'walk'),
  k(T('23:03:44'), IN_DOOR, 90, 'walk'),
  k(T('23:03:52'), OUT_DOOR, 60, 'walk'),
  k(T('23:03:58'), ON_STOOL, 302, 'raise_arm'),
  k(T('23:06:00'), ON_STOOL, 302, 'raise_arm'),
  k(T('23:06:06'), OUT_DOOR, 260, 'walk'),
  k(T('23:06:16'), IN_DOOR, 270, 'walk'),
  k(T('23:06:30'), CHAIR, 180, 'sit'),
  // 00:30–01:10 背对镜头坐在门口台阶上
  k(T('00:29:30'), CHAIR, 180, 'sit'),
  k(T('00:29:46'), IN_DOOR, 90, 'walk'),
  k(T('00:29:56'), OUT_DOOR, 90, 'walk'),
  k(T('00:30:00'), ON_STEP, 118, 'sit'),
  k(T('01:10:00'), ON_STEP, 118, 'sit'),
  k(T('01:10:08'), OUT_DOOR, 270, 'walk'),
  k(T('01:10:20'), IN_DOOR, 270, 'walk'),
  k(T('01:10:36'), CHAIR, 180, 'sit'),
  // 02:51 心口疼，按下报警
  k(T('02:50:30'), CHAIR, 180, 'sit'),
  k(T('02:50:44'), ALARM_AT, 270, 'walk'),
  k(T('02:50:52'), ALARM_AT, 270, 'raise_arm'),
  k(T('02:51:04'), ALARM_AT, 270, 'raise_arm'),
  k(T('02:51:16'), [-7.0, 0, 20.9], 120, 'walk'),
  k(T('02:51:30'), CHAIR, 180, 'sit'),
  // 03:12 扶着门框走出来，走到门前站住，低着头（帽顶）
  k(T('03:11:40'), CHAIR, 180, 'sit'),
  k(T('03:11:52'), [-6.1, 0, 20.5], 80, 'walk'),
  k(T('03:12:06'), [-5.1, 0, 20.24], 90, 'stand'),
  k(T('03:12:40'), [-5.02, 0, 20.3], 100, 'stand'),
  k(T('03:13:10'), [-4.2, 0, 20.85], 125, 'walk'),
  k(T('03:13:30'), FACE_AT, 138, 'stand'),
  k(T('03:14:00', -0.1), FACE_AT, 150, 'stand'),
  // 03:14:00–03:14:15 摘帽抬头（交给“摘帽”演员）
  k(T('03:14:00'), PARK, 150, 'stand'),
  k(T('03:14:15'), PARK, 150, 'stand'),
  k(T('03:14:15', 0.1), FACE_AT, 210, 'stand'),
  // 03:14:15 起又低下头，03:16 前回屋
  k(T('03:14:40'), FACE_AT, 250, 'stand'),
  k(T('03:15:00'), [-4.3, 0, 20.8], 290, 'walk'),
  k(T('03:15:18'), [-5.1, 0, 20.25], 270, 'walk'),
  k(T('03:15:34'), [-6.2, 0, 20.55], 250, 'walk'),
  k(T('03:15:44'), CHAIR, 180, 'sit'),
  k(T('03:15:44', 0.1), PARK, 180, 'sit'),
];

/** 摘了帽、抬头看镜头的老周：只在 03:14:00–03:14:15 在场（正脸，在左半 CH1）。 */
const KEYS_NOCAP: readonly ReplayActorKey[] = [
  k(0, PARK, FACE_CAM, 'look_up'),
  k(T('03:14:00', -0.1), PARK, FACE_CAM, 'look_up'),
  k(T('03:14:00'), FACE_AT, FACE_CAM, 'look_up'),
  k(T('03:14:15'), FACE_AT, FACE_CAM, 'look_up'),
  k(T('03:14:15', 0.1), PARK, FACE_CAM, 'look_up'),
];

/** 趴在桌上的老周：03:16 起，右半 CH2 里一动不动，直到天亮。 */
const KEYS_SLUMP: readonly ReplayActorKey[] = [
  k(0, PARK, 180, 'sit'),
  k(T('03:15:44'), PARK, 180, 'sit'),
  k(T('03:15:44', 0.1), CHAIR, 180, 'sit'),
  k(TAPE.lengthSec, CHAIR, 180, 'sit'),
];

// ------------------------------------------------------------------ 布景

const SLEEVE = [T(TAPE.events.sleeve[0]), T(TAPE.events.sleeve[1])] as const;
const STEPS = [T(TAPE.events.steps[0]), T(TAPE.events.steps[1])] as const;
const STOOL = [T('23:03:50'), T('23:06:20')] as const;
const DAWN = [T('04:40:00'), T(TAPE.events.dawn)] as const;

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 构建 2023 年的门岗（tapeScene）。灯 3 盏（kit.light，单独计预算）。 */
function buildTapeScene(ctx: AreaContext, scene: THREE.Scene, kit: TapeKit): void {
  const bgNight = new THREE.Color('#05070a');
  const bgDawn = new THREE.Color('#6d7582');
  scene.background = bgNight.clone();
  const fog = new THREE.FogExp2('#0b0f14', 0.035);
  scene.fog = fog;
  const fogNight = new THREE.Color('#0b0f14');
  const fogDawn = new THREE.Color('#8c95a0');

  const add = <O extends THREE.Object3D>(o: O): O => {
    scene.add(o);
    return o;
  };
  const B = R1.booth;
  const plaster = MATERIALS.plaster();
  const concrete = MATERIALS.concrete();
  const wallT = 0.2;
  const H = R1.derived.boothH;

  // 地面：门口水泥、院子沥青
  add(box(60, 0.2, 40, MATERIALS.asphaltWet(), [0, -0.1, 18]));
  add(box(3.2, 0.04, 4.2, concrete, [-3.9, 0.02, 20.4]));
  // 门口台阶：沿东墙的一溜水泥台（x -5.0…-3.9，z 19.6…22），老周 00:30 坐在它南头的外沿
  add(box(1.1, 0.12, 2.4, concrete, [-4.45, 0.06, 20.8]));

  // 门卫室：四面墙（东墙留门洞、南墙留窗洞），屋顶，屋里地面
  const doorZ0 = B.door[2] - 0.45, doorZ1 = B.door[2] + 0.45, doorTop = 2.05;
  const wx = (x: number, z0: number, z1: number, y0: number, y1: number) => add(box(wallT, y1 - y0, z1 - z0, plaster, [x, (y0 + y1) / 2, (z0 + z1) / 2]));
  wx(B.x1 - wallT / 2, B.z0, doorZ0, 0, H);
  wx(B.x1 - wallT / 2, doorZ1, B.z1, 0, H);
  wx(B.x1 - wallT / 2, doorZ0, doorZ1, doorTop, H);
  wx(B.x0 + wallT / 2, B.z0, B.z1, 0, H);
  add(box(B.x1 - B.x0, H, wallT, plaster, [(B.x0 + B.x1) / 2, H / 2, B.z0 + wallT / 2]));
  const winX0 = -7.4, winX1 = -5.6, winY0 = 0.95, winY1 = 2.0;
  const zs = B.z1 - wallT / 2;
  add(box(winX0 - B.x0, H, wallT, plaster, [(B.x0 + winX0) / 2, H / 2, zs]));
  add(box(B.x1 - winX1, H, wallT, plaster, [(winX1 + B.x1) / 2, H / 2, zs]));
  add(box(winX1 - winX0, winY0, wallT, plaster, [(winX0 + winX1) / 2, winY0 / 2, zs]));
  add(box(winX1 - winX0, H - winY1, wallT, plaster, [(winX0 + winX1) / 2, (winY1 + H) / 2, zs]));
  // 窗：钢窗框 + 窗外的夜（天亮时变白）
  const steel = MATERIALS.metal();
  for (const x of [winX0 + 0.03, (winX0 + winX1) / 2, winX1 - 0.03]) add(box(0.04, winY1 - winY0, 0.05, steel, [x, (winY0 + winY1) / 2, zs]));
  const winMat = kit.track(new THREE.MeshBasicMaterial({ color: '#0c1118', fog: false }));
  const winPane = add(plane(winX1 - winX0, winY1 - winY0, winMat, [(winX0 + winX1) / 2, (winY0 + winY1) / 2, B.z1 - 0.02], [0, 180, 0]));
  winPane.name = 'tape.window';
  // 屋内墙裙（下绿上白）与地面
  const dado = kit.track(new THREE.MeshStandardMaterial({ color: PALETTE.DADO, roughness: 0.6 }));
  add(box(0.02, 0.95, B.z1 - B.z0 - 0.4, dado, [B.x0 + wallT + 0.011, 0.475, (B.z0 + B.z1) / 2]));
  add(box(B.x1 - B.x0 - 0.4, 0.95, 0.02, dado, [(B.x0 + B.x1) / 2, 0.475, B.z0 + wallT + 0.011]));
  add(box(B.x1 - B.x0, 0.02, B.z1 - B.z0, concrete, [(B.x0 + B.x1) / 2, 0.01, (B.z0 + B.z1) / 2]));
  // 屋面（东边不出檐）与东墙的女儿墙：门楣支架就装在女儿墙上，镜头离墙面 0.15m
  add(box(B.x1 - B.x0 + 0.25, 0.14, B.z1 - B.z0 + 0.4, concrete, [(B.x0 + B.x1) / 2 - 0.125, H + 0.07, (B.z0 + B.z1) / 2]));
  add(box(wallT, 0.5, B.z1 - B.z0, plaster, [B.x1 - wallT / 2, H + 0.25, (B.z0 + B.z1) / 2]));
  // 门：木门朝里开着
  const d = door({ w: 0.9, h: doorTop, style: 'wood', at: [B.x1, 0, B.door[2]], yaw: 90 });
  d.setOpen(0.8);
  add(d.group);
  // “传达室”牌匾（门洞北侧）
  const plaque = makeTextPlane({ text: '传达室', w: 0.72, h: 0.22, font: { size: 150, weight: 'bold' }, color: '#2a1e18', bg: '#e8dcc0', material: 'standard' });
  plaque.position.set(B.x1 + 0.012, 2.3, B.door[2] - 0.9);
  plaque.rotation.y = Math.PI / 2;
  add(plaque);
  // 门口靠墙的一辆旧自行车、一个痰盂
  const bike = PROPS.bicycle(2023);
  bike.position.set(-4.72, 0, 21.55);
  bike.rotation.y = Math.PI / 2;
  add(bike);
  const spittoon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.2, 14), MATERIALS.enamelRed());
  spittoon.position.set(-4.78, 0.1, 19.5);
  add(spittoon);

  // 院墙与铁院门（z=24），墙上小广告与红圈“拆”还没刷
  const brick = MATERIALS.brick();
  add(box(22, 2.2, 0.24, brick, [-14, 1.1, R1.gate.z]));
  add(box(22, 2.2, 0.24, brick, [14, 1.1, R1.gate.z]));
  const gate = door({ w: R1.gate.x1 - R1.gate.x0, h: 2.0, style: 'iron_gate', at: [0, 0, R1.gate.z], yaw: 0 });
  add(gate.group);
  const posters = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), kit.track(new THREE.MeshStandardMaterial({
    map: kit.track(PAINT.posters({ lines: ['开锁', '通下水道', '回收旧家电'], seed: 2023 })), transparent: true, depthWrite: false, roughness: 0.9,
  })));
  posters.position.set(-5.6, 1.2, R1.gate.z - 0.13);
  posters.rotation.y = Math.PI;
  add(posters);
  // 小区简介牌（-4,23.5）
  const sign = box(1.2, 0.8, 0.06, kit.track(new THREE.MeshStandardMaterial({ color: '#3a5a78', roughness: 0.7 })), [-4, 1.3, 23.45]);
  add(sign);
  add(box(0.06, 1.0, 0.06, steel, [-4.5, 0.5, 23.45]));
  add(box(0.06, 1.0, 0.06, steel, [-3.5, 0.5, 23.45]));

  // 屋里：桌、椅、CRT（未通电的静态外观，共享材质）、录像机、暖壶、录像带架、注意事项、报警铃、挂历
  const desk = PROPS.desk({ drawer: true });
  desk.position.set(R1.desk[0], 0, R1.desk[2]);
  add(desk);
  const chair = PROPS.chair();
  chair.position.set(CHAIR[0], 0, CHAIR[2] + 0.05);
  chair.rotation.y = Math.PI;
  add(chair);
  const crt = PROPS.crt();
  crt.group.position.set(R1.derived.crtBody.center[0], R1.derived.deskTopY, R1.derived.crtBody.center[2]);
  crt.screen.material = MATERIALS.crtScreen();
  add(crt.group);
  const vcr = PROPS.vcr();
  vcr.group.position.set(R1.derived.vcrBody.center[0], R1.derived.deskTopY, R1.derived.vcrBody.center[2]);
  add(vcr.group);
  const thermos = PROPS.thermos();
  thermos.position.set(-5.95, R1.derived.deskTopY, 21.35);
  add(thermos);
  const rack = PROPS.tapeRack(Array.from({ length: 29 }, (_, i) => `8.${i + 1}`));
  rack.position.set(R1.tapeRack[0] + 0.06, R1.tapeRack[1], R1.tapeRack[2]);
  rack.rotation.y = -Math.PI / 2;
  add(rack);
  const notice = makeTextPlane({
    text: ['监控调试注意事项', '一、本岗主机位为 CH1（门楣）', '二、雨天注意擦拭镜头', '三、严禁将摄像头对准监视器'],
    w: 0.42, font: { size: 44 }, color: '#222', bg: '#e6e1d4', align: 'left', material: 'standard',
  });
  notice.position.set(B.x0 + wallT + 0.012, 1.6, 21.2);
  notice.rotation.y = Math.PI / 2;
  add(notice);
  const bell = box(0.1, 0.1, 0.04, kit.track(new THREE.MeshStandardMaterial({ color: '#b31c1c', emissive: '#400000', roughness: 0.5 })), [B.x0 + wallT + 0.02, 1.3, ALARM_AT[2]]);
  add(bell);
  const cal = makeTextPlane({ text: ['2023', '八月'], w: 0.26, h: 0.34, font: { size: 120, weight: 'bold' }, color: '#a01818', bg: '#f1ece0', material: 'standard' });
  cal.position.set(-5.9, 1.75, B.z0 + wallT + 0.012);
  add(cal);

  // 23:04 垫脚的凳子（按带子时刻出现）
  const stool = PROPS.stool();
  stool.position.set(STOOL_AT[0], 0, STOOL_AT[2]);
  add(stool);

  // 擦镜头的袖子：贴在 CH1 镜头前 0.12m 的一截藏蓝袖口（按带子时刻来回擦）
  const camPos = new THREE.Vector3(...TAPE_CH1.pos);
  const camFwd = new THREE.Vector3(...TAPE_CH1.target).sub(camPos).normalize();
  const sleeveMat = kit.track(new THREE.MeshBasicMaterial({ map: kit.track(sleeveTexture(PALETTE.UNIFORM, false, 830)), side: THREE.DoubleSide, fog: false }));
  const sleeve = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.22), sleeveMat);
  sleeve.name = 'tape.sleeve';
  sleeve.frustumCulled = false;
  add(sleeve);
  const sleeveBase = camPos.clone().addScaledVector(camFwd, 0.12);
  const side = new THREE.Vector3().crossVectors(camFwd, new THREE.Vector3(0, 1, 0)).normalize();
  const upv = new THREE.Vector3().crossVectors(side, camFwd).normalize();

  // 灯（3 盏）：门口墙灯、屋里灯泡、天光（天亮时变亮变冷）
  const doorLamp = kit.light(designLight('point', '#FFC98A', 0.6, 6));
  doorLamp.position.set(-4.82, 2.42, 21.05);
  const doorBase = doorLamp.intensity;
  const lampShadeMat = kit.track(new THREE.MeshStandardMaterial({ color: '#221a12', emissive: '#FFC98A', emissiveIntensity: 6 }));
  const lampShade = box(0.14, 0.1, 0.1, lampShadeMat, [-4.9, 2.45, 21.05]);
  add(lampShade);
  const bulbLight = kit.light(designLight('point', '#FFC98A', 1.3, 6));
  bulbLight.position.set(-6.4, 2.35, 20.3);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), kit.track(new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#FFD9A0', emissiveIntensity: 6 })));
  bulb.position.set(-6.4, 2.28, 20.3);
  add(bulb);
  add(box(0.01, 0.3, 0.01, steel, [-6.4, 2.45, 20.3]));
  // 红外补光：当年的监控摄像头镜头旁一圈红外灯，夜里画面里正对镜头的东西都被照得发白、发平，越远越暗（监控录像的样子）；
  // 03:14 他抬头时，脸正好迎着这圈光。天亮后补光灯自动关掉，同一盏灯换成冷白的天光（灯数不变）
  const ir = kit.light(designLight('spot', '#dde4ee', 2.0, 9)) as THREE.SpotLight;
  ir.position.set(TAPE_CH1.pos[0] + 0.04, TAPE_CH1.pos[1] - 0.06, TAPE_CH1.pos[2] + 0.03);
  ir.angle = 0.66;
  ir.penumbra = 0.55;
  ir.target.position.set(...TAPE_CH1.target);
  scene.add(ir.target);
  const irBase = ir.intensity;
  const irNight = new THREE.Color('#dde4ee');
  const irDawn = new THREE.Color('#c9d3e0');

  // 院门口的门灯（GDD §4.1 (3.5,23.4)；2023 年它还亮着，只有灯罩，靠 Bloom）与院墙上的“槐安里”门头
  add(box(0.26, 0.16, 0.16, kit.track(new THREE.MeshStandardMaterial({ color: '#000', emissive: '#FFC98A', emissiveIntensity: 7 })), [3.5, 2.6, 23.4]));
  add(box(0.05, 0.4, 0.05, steel, [3.5, 2.35, 23.52]));
  // 远处街上的一盏钠灯（只有灯罩，靠 Bloom）
  const far = box(0.5, 0.18, 0.3, kit.track(new THREE.MeshStandardMaterial({ color: '#000', emissive: PALETTE.SODIUM, emissiveIntensity: 7 })), [6.5, 5.4, 29]);
  add(far);

  // 雨（细）：带子画面只有 256×192，雨丝稀一点
  const r = rain({ count: 700, box: { w: 16, h: 9, d: 16 }, color: '#9aa8b8' });
  add(r.mesh);
  kit.track(r.mesh.geometry);
  kit.track(r.mesh.material as THREE.Material);

  // 追踪本场景自建的几何、材质、贴图（共享材质不释放；演员由录像机自己释放）
  scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    kit.track(m.geometry);
    for (const mt of Array.isArray(m.material) ? m.material : [m.material]) {
      if (isSharedMaterial(mt)) continue;
      kit.track(mt);
      const map = (mt as THREE.MeshStandardMaterial).map;
      if (map) kit.track(map);
    }
  });

  // 老周的五官线（见 art.ts 的 tapeFaceTexture）：演员由录像机在 build 之后建，第一次绘制前挂到每个老周演员的头上
  // M4：自发光 = 同一张贴图（眼白与高光在 CRT 的暗部里也亮着、墨线不被暗部吞掉），贴片放大到 1.05
  const faceTex = kit.track(tapeFaceTexture());
  const faceMat = kit.track(new THREE.MeshStandardMaterial({
    map: faceTex, emissive: 0x222222, emissiveMap: faceTex, transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  const faceGeo = kit.track(new THREE.SphereGeometry(0.1015, 16, 10, Math.PI * 1.5 - 0.95, 1.9, 0.5, 1.5).scale(0.92 * 1.05, 1.12 * 1.05, 1.05));
  let facesOn = false;
  const attachFaces = (): void => {
    facesOn = true;
    scene.traverse(o => {
      if (o.name !== GHOST.ZHOU_2023) return;
      const head = o.getObjectByName('head');
      if (!head || head.getObjectByName('tape.face')) return;
      const f = new THREE.Mesh(faceGeo, faceMat);
      f.name = 'tape.face';
      f.renderOrder = 1;
      head.add(f);
    });
  };

  const vcrSys = ctx.game.vcr;
  let lastGameT = ctx.game.time;
  const neckTmp: THREE.Object3D[] = [];
  const stepPos = new THREE.Vector3(...ON_STEP);
  scene.onBeforeRender = () => {
    if (!facesOn) attachFaces();
    const tc = vcrSys.tc;
    // 雨：按游戏时间下落（纯视觉）
    const now = ctx.game.time;
    r.update(Math.max(0, Math.min(0.1, now - lastGameT)));
    lastGameT = now;
    // 凳子与袖子
    stool.visible = tc >= STOOL[0] && tc < STOOL[1];
    const sleeveOn = tc >= SLEEVE[0] && tc < SLEEVE[1];
    sleeve.visible = sleeveOn;
    if (sleeveOn) {
      const u = (tc - SLEEVE[0]) * 0.9;
      const sx = Math.sin(u) * 0.07 + Math.sin(u * 2.3) * 0.02;
      const sy = Math.cos(u * 0.7) * 0.03 - 0.01;
      sleeve.position.copy(sleeveBase).addScaledVector(side, sx).addScaledVector(upv, sy);
      sleeve.lookAt(camPos);
      sleeve.rotateZ(0.35 + Math.sin(u * 0.5) * 0.25);
      sleeve.updateMatrixWorld();
    }
    // 00:30–01:10：背对镜头坐在台阶上，时不时仰头冲上面说话（帽檐压着，只露出下巴）
    if (tc >= STEPS[0] && tc < STEPS[1]) {
      neckTmp.length = 0;
      scene.traverse(o => {
        if (o.name === GHOST.ZHOU_2023 && o.position.distanceTo(stepPos) < 1) neckTmp.push(o);
      });
      const phase = ((tc - STEPS[0]) / 180) % 1;
      const tilt = phase < 0.35 ? Math.sin((phase / 0.35) * Math.PI) * 0.75 : 0;
      for (const a of neckTmp) {
        const neck = a.getObjectByName('neck');
        if (neck) neck.rotation.x = tilt;
        a.updateMatrixWorld(true);
      }
    }
    // 天亮：04:40 起天光变亮变冷，05:12 窗外发白
    const dawn = smooth(DAWN[0], DAWN[1], tc);
    ir.intensity = irBase * (1 + dawn * 0.8);
    ir.color.copy(irNight).lerp(irDawn, dawn);
    (scene.background as THREE.Color).copy(bgNight).lerp(bgDawn, dawn);
    fog.color.copy(fogNight).lerp(fogDawn, dawn);
    fog.density = 0.035 - dawn * 0.015;
    winMat.color.set('#0c1118').lerp(new THREE.Color('#c8d0dc'), dawn);
    doorLamp.intensity = dawn > 0.85 ? 0 : doorBase;
    lampShadeMat.emissiveIntensity = dawn > 0.85 ? 0.4 : 6;
  };
}

/** R1-finale 给录像机的带子（ARCH §6.10 TapeTrack）。 */
export function createTapeTrack(ctx: AreaContext): TapeTrack {
  return {
    startLabel: TAPE.startLabel,
    lengthSec: TAPE.lengthSec,
    cams: { ch1: TAPE_CH1, ch2: TAPE_CH2 },
    splitFrom: TAPE.splitFrom,
    actors: [
      { id: GHOST.ZHOU_2023, character: 'zhou', opts: { variant: 'cap', seed: 1960 }, keys: KEYS_CAP },
      { id: GHOST.ZHOU_2023, character: 'zhou', opts: { variant: 'nocap', seed: 1960 }, keys: KEYS_NOCAP },
      { id: GHOST.ZHOU_2023, character: 'zhou', opts: { variant: 'slump', seed: 1960 }, keys: KEYS_SLUMP },
    ],
    build: (scene, kit) => buildTapeScene(ctx, scene, kit),
  };
}


