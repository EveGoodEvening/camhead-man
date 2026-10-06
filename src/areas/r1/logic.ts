// owner: R1-world
// R1-world 的玩法登记（ARCH §11.2–§11.5）：交互物、土地（npc.tudi）、电闸与四个开关、抽屉密码锁、院门动态碰撞体、镜面、监控台（R1-world 那一半）、
// 火盆（X1）、冷迹（X5）；以及每帧的外观同步（灯的亮灭、闸刀、抽屉、院门、土地的灯笼、焚化、寅时停雨、卯时黎明色调）。
// 进度只由 flags（与区域临时状态）推导：进区域时按当前 flags 重建一切（ARCH §11.5 第 1 条）。

import * as THREE from 'three';
import type { AreaContext } from '../../core/area';
import type { V3 } from '../../core/types';
import type { StateView } from '../../game/state';
import type { GameApi } from '../../game/effects';
import { E } from '../../game/effects';
import { angleDiff } from '../../core/math';
import type { NpcHandle } from '../../game/npc';
import { DOC, F, IT, NPC, OBJ, PH, SEG, isEmptyPhotoId } from '../../data/ids';
import type { ThingId } from '../../data/ids';
import { PALETTE } from '../../data/palette';
import { TEMP_C } from '../../data/render';
import { STRINGS } from '../../data/strings';
import { createCharacter } from '../../rigs/characters';
import { MATERIALS } from '../../fx/materials';
import type { CharacterRig } from '../../rigs/characters';
import type { RainRig } from '../../kit/rain';
import { R1 } from './layout';
import { BURN, COLD, FB, LABEL, TUTORIAL } from './text';
import { DLG_ID } from './dialogue';
import { consoleChannels } from './console';
import type { BoothHandles } from './build/booth';
import { BOOTH, LOG_AT, SWITCH_AT, SWITCH_BOX_AT, bakedMirrorTexture } from './build/booth';
import type { YardHandles } from './build/yard';
import { GATE_LAMP_MOUNT, PUDDLE_NIGHT, TUDI_STOOL_YAW } from './build/yard';
import type { R1Lights } from './build/lights';
import type { FarSkyline, StreetLamps } from './build/buildings';
import { FAR_NIGHT, FAR_WIN_GLOW } from './build/buildings';
import { LANTERN_RED } from './build/lights';
import { paintTexture } from '../../kit/canvas';

/** 开关①②④ 的区域临时状态键（不存档，GDD §3.13“灯的亮灭”）。 */
export const TEMP = { shed: 'lamp_shed', board: 'lamp_board', tree: 'lamp_tree', introLog: 'intro_log' } as const;

/**
 * R1-finale 写、这里读的区域临时状态（两边不互相 import，字面量两边各写一份：finale/stage.ts 的 FIN_SKY 同名同值）。
 * - fin_dawn：终章接管的天亮进度 0..1（设了就按它摆远景剪影、远处亮窗、近处亮窗与积水，不按进区域时的卯时）；
 * - fin_morning：尾声/片尾的上午（剪影变晨雾色、亮窗与路灯、门灯全灭、积水映着天）；
 * - fin_tudi_gone：结局里土地领着光出了院门（此后不在场，跟随的灯笼红光随之熄掉）。
 */
export const FIN_SKY = { dawn: 'fin_dawn', morning: 'fin_morning', tudiGone: 'fin_tudi_gone' } as const;
const SWITCH_TEMP: readonly (string | null)[] = [TEMP.shed, TEMP.board, null, TEMP.tree];
const SWITCH_IDS = [OBJ.R1_SWITCH_1, OBJ.R1_SWITCH_2, OBJ.R1_SWITCH_3, OBJ.R1_SWITCH_4] as const;

/** 本区加载期间的运行时句柄（build 时重建；onExit 清空）。 */
export interface World {
  ctx: AreaContext;
  rain: RainRig;
  sky: THREE.Mesh;
  lights: R1Lights;
  booth: BoothHandles;
  yard: YardHandles;
  far: FarSkyline;
  street: StreetLamps;
  /** 三栋楼与对面铺子的窗户材质（Statics 合并后的；亮窗 = instanceColor × color） */
  windowMats: readonly THREE.MeshBasicMaterial[];
  /** 半球光的基础强度（ctx.hemi 的设计值换算后的；卯时 applySky 按它往上提） */
  hemiBase: number;
  lanternOnly: CharacterRig;
  gateOpen: number;
  burnT: number;
  dawn: number;
  /** 上次 applySky 用的天色（k 与上午）；变了才重摆 */
  lastSky: string;
  treeOn: boolean;
}

// ==================================================================== 土地

/**
 * 土地站位：只由 flags 推导（GDD §4.6）。补脸之后移到门岗门口，其余时候坐在槐树下的马扎上。
 * 结局里他领着光出了院门（R1-finale 写 temp(fin_tudi_gone)）就不在场：NpcSystem 把跟随的灯笼红光强度置 0（M4：院门外不再留一个红点）。
 */
export function tudiPlacement(s: StateView): { pos: V3; yaw: number; pose: 'sit' | 'stand' } | null {
  if (s.temp(FIN_SKY.tudiGone) === true) return null;
  if (s.flag(F.R1_PORTRAIT_COMPLETE)) return { pos: R1.npcSpots.tudiBoothDoor, yaw: 235, pose: 'stand' };
  return { pos: R1.npcSpots.tudiTree, yaw: TUDI_STOOL_YAW, pose: 'sit' };
}

/**
 * 引路光（GDD §3.12）：土地拐杖上的灯笼始终朝当前谜题所在区域的出口方向偏。
 * 当前谜题由提示系统算（GameApi.hints.current()）；R1 自己的谜题（P1、P2、P12–P14、南柯）偏向门岗。
 */
const LEAN_TARGET: Readonly<Record<string, V3>> = {
  r2: R1.exits.toR2, r3: R1.exits.toR3, r4: R1.exits.toR4, r1: R1.booth.door,
};
function puzzleArea(id: string | null): keyof typeof LEAN_TARGET {
  const m = id ? /^pz\.p(\d\d)/.exec(id) : null;
  const n = m ? Number(m[1]) : 0;
  if (n >= 3 && n <= 5) return 'r2';
  if (n >= 6 && n <= 8) return 'r3';
  if (n >= 9 && n <= 11) return 'r4';
  return 'r1';
}
const LEAN = 0.32;
function leanLantern(lantern: THREE.Object3D | undefined, root: THREE.Object3D, g: GameApi): void {
  if (!lantern) return;
  const t = LEAN_TARGET[puzzleArea(g.hints.current())]!;
  const dx = t[0] - root.position.x, dz = t[2] - root.position.z;
  const len = Math.hypot(dx, dz) || 1;
  // 转到 root 的本地坐标（root.rotation.y 只绕 y）
  const c = Math.cos(-root.rotation.y), sn = Math.sin(-root.rotation.y);
  const lx = (dx * c - dz * sn) / len, lz = (dx * sn + dz * c) / len;
  lantern.rotation.x = lz * LEAN;
  lantern.rotation.z += -lx * LEAN;
}

/**
 * 跟随红光的锚点（M4 第 2 轮）：灯笼前方约 0.8m、低 0.55m（离地约 0.75m，学 R4 门童的 boyLightAnchor）——红光铺在他脚前的地上。
 * 灯笼本身在 brightenLantern 里放大了 1.5 倍，锚点挂在灯笼下，本地坐标按这个倍数折回米。
 */
const LANTERN_LIGHT_OFFSET: V3 = [0, -0.55, -0.8];
const LANTERN_SCALE = 1.5;

/**
 * 土地金描边（addRim 的 uRim）压到原来的一半：只留轮廓（M4 第 2 轮）。
 * 另给他一层很淡的本色自发光（神仙自己带着一点光）：院里只有灯笼的红光照着他，灰袍、白胡子、枣木拐杖的本色原来全被染成红金色。
 * 只动带描边的材质（人偶自己的那一套，不是共享材质）。
 */
const TUDI_RIM_SCALE = 0.5;
const TUDI_SELF_GLOW = 0.22;
function softenRim(rig: CharacterRig): void {
  const done = new Set<THREE.Material>();
  rig.root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const u = m.userData.rimUniform as { value: THREE.Color } | undefined;
      if (!u || done.has(m)) continue;
      done.add(m);
      u.value.multiplyScalar(TUDI_RIM_SCALE);
      const std = m as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial) continue;
      std.emissive.copy(std.color).multiplyScalar(TUDI_SELF_GLOW);
      if (std.map) {
        std.emissiveMap = std.map;
        std.needsUpdate = true;
      }
    }
  });
}

/**
 * 胡子的网格版（M4 第 2 轮）：kit 的胡子是 1px 的 LineSegments，1× 下看不见。换成几条 1cm 宽的白色扁带，从下巴垂到约 0.16m，
 * 挂在原胡子的父节点（头部插槽）上，原来的线段藏起来。材质自己一份，随区域释放。
 */
function meshBeard(ctx: AreaContext, rig: CharacterRig): void {
  const lines = rig.props.beard;
  const slot = lines?.parent;
  if (!lines || !slot) return;
  lines.visible = false;
  const mat = ctx.track(new THREE.MeshStandardMaterial({ color: '#EDEAE2', roughness: 0.95, side: THREE.DoubleSide, emissive: '#EDEAE2', emissiveIntensity: 0.08 }));
  mat.userData.tempC = TEMP_C.yin;
  const g = new THREE.Group();
  g.name = 'beardMesh';
  // 下巴底下那一绺（中间长、两边短，略往前飘），两撇八字胡
  const strands: [number, number, number, number][] = [
    // x, 长度, 往外撇（rad）, 前后（m）
    [0, 0.16, 0, 0], [-0.012, 0.15, 0.05, 0.002], [0.012, 0.15, -0.05, 0.002], [-0.024, 0.13, 0.1, -0.002], [0.024, 0.13, -0.1, -0.002],
    [-0.035, 0.1, 0.16, -0.006], [0.035, 0.1, -0.16, -0.006], [-0.006, 0.14, 0.02, 0.006], [0.006, 0.14, -0.02, 0.006],
  ];
  for (const [x, len, splay, dz] of strands) {
    const geo = ctx.track(new THREE.PlaneGeometry(0.011, len).translate(0, -len / 2, 0));
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0.052, -0.06 + dz);
    m.rotation.set(-0.12, 0, splay);
    g.add(m);
  }
  for (const sx of [-1, 1]) {
    const geo = ctx.track(new THREE.PlaneGeometry(0.045, 0.01).translate(sx * 0.0225, 0, 0));
    const m = new THREE.Mesh(geo, mat);
    m.position.set(sx * 0.004, 0.074, -0.068);
    m.rotation.set(-0.2, 0, sx * -0.45);
    g.add(m);
  }
  for (const c of g.children) {
    c.raycast = () => {};
    c.userData.noBounds = true;
  }
  slot.add(g);
}

/** 取景器里第一次瞅见土地时，他冲你招手（GDD §2.2“土地爷坐在马扎上冲你招手”，M4 第 2 轮）：左手（右手拄着拐杖）摆 2 秒。 */
const WAVE_SEC = 2;
function tudiWave(rig: CharacterRig, t: number): void {
  const j = rig.joints;
  // 0.3 秒抬起、最后 0.3 秒放下；中间左右摆
  const k = Math.min(1, t / 0.3, Math.max(0, (WAVE_SEC - t) / 0.3));
  const e = k * k * (3 - 2 * k);
  j.shoulderL.rotation.x = j.shoulderL.rotation.x * (1 - e) + 2.4 * e;
  j.shoulderL.rotation.z = j.shoulderL.rotation.z * (1 - e) + (-0.2 - Math.sin(t * 8) * 0.35) * e;
  j.elbowL.rotation.x = j.elbowL.rotation.x * (1 - e) + 0.35 * e;
}
/** 他在不在取景器的画面里（离得不远、在视线 ±25° 以内） */
function inVfView(g: GameApi, p: THREE.Vector3): boolean {
  if (!g.vf.on) return false;
  const pl = g.player.position;
  const dx = p.x - pl.x, dz = p.z - pl.z;
  const d = Math.hypot(dx, dz);
  if (d > 14 || d < 0.5) return false;
  const yaw = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return Math.abs(angleDiff(g.player.yaw, yaw)) < 25;
}

function registerTudi(ctx: AreaContext, w: World): void {
  const rig = createCharacter('tudi', { look: 'ghost', seed: 3 });
  brightenLantern(ctx, rig, 0.55, 'vf');
  softenRim(rig);
  meshBeard(ctx, rig);
  // 跟随红光的锚点：灯笼前下方、贴近地面（见 LANTERN_LIGHT_OFFSET）
  let lightAnchor: THREE.Object3D | string = 'lantern';
  const lanternNode = rig.props.lantern;
  if (lanternNode) {
    const a = new THREE.Object3D();
    a.name = 'tudiLightAnchor';
    a.position.set(LANTERN_LIGHT_OFFSET[0] / LANTERN_SCALE, LANTERN_LIGHT_OFFSET[1] / LANTERN_SCALE, LANTERN_LIGHT_OFFSET[2] / LANTERN_SCALE);
    lanternNode.add(a);
    lightAnchor = a;
  }
  // 招手：-1 = 还没招过；≥ 0 = 招手进行了多少秒（每次进区域最多一回，只在还没见过他的时候）
  let waveT = -1;
  let waved = false;
  const tudi = ctx.npc({
    id: NPC.TUDI, rig, yin: true, tempC: TEMP_C.yin,
    placement: s => tudiPlacement(s),
    lights: [{ light: w.lights.lantern, anchor: lightAnchor }],
    interact: {
      label: LABEL.tudi, view: 'viewfinder', revealOnVfInteract: true, anchorY: 0.8,
      talk: [
        { when: `!${F.R1_GATE_LAMP_ON}`, dialogue: DLG_ID.tudiNoLamp },
        { when: `!${F.R1_MET_TUDI}`, dialogue: DLG_ID.tudiFirst },
        { when: `!${F.R1_P1_DONE}`, dialogue: DLG_ID.tudiGoReplay },
        { when: `!${F.R1_MISSION_GIVEN}`, dialogue: DLG_ID.tudiMission },
        { when: F.R1_PORTRAIT_COMPLETE, dialogue: DLG_ID.tudiBooth },
        // M4 第 2 轮：寅时按带子看到哪儿换话（原来看完带子、听完那句话还是“先瞅瞅吧”）
        { when: `${F.R1_HEARD_VOICE} && ${F.R1_PORTRAIT_PLACED}`, dialogue: DLG_ID.tudiYinPlaced },
        { when: F.R1_HEARD_VOICE, dialogue: DLG_ID.tudiYinVoice },
        { when: F.R1_TAPE_WATCHED, dialogue: DLG_ID.tudiYinTape },
        { when: F.R4_GOT_TAPE, dialogue: DLG_ID.tudiYin },
        { when: `${F.R2_WANG_DONE} && ${F.R3_SAW_TRUE_FORM}`, dialogue: DLG_ID.tudiChou },
        { dialogue: DLG_ID.tudiIdle },
      ],
    },
    update: (npc, dt) => {
      leanLantern(rig.props.lantern, npc.root, ctx.game);
      const g = ctx.game;
      if (!waved && !ctx.state.flag(F.R1_MET_TUDI) && g.modes.top === 'mode.viewfinder' && inVfView(g, npc.root.position)) {
        waved = true;
        waveT = 0;
      }
      if (waveT >= 0) {
        waveT += dt;
        if (waveT >= WAVE_SEC) waveT = -1;
        else tudiWave(rig, waveT);
      }
    },
    // 补脸之后从槐树下挪到门岗门口：淡出→瞬移→淡入，再站起来
    onPlaced: (npc: NpcHandle, prev) => {
      const p = tudiPlacement(ctx.state);
      if (!prev || !p) return;
      void npc.fadeTo(p.pos, p.yaw).then(() => npc.setPose(p.pose));
    },
  });
  // 土地的根节点按 NPC id 登记成 ref（交互系统只在第一次解析 hit 时才顺手登记，结局里没瞄过他就取不到：
  // R1-finale 的结局过场靠这个 ref 挪他领路、淡出后写 temp(fin_tudi_gone)，M4 尾声院门外那个红点就是没取到 ref 留下的）
  ctx.ref(NPC.TUDI, tudi.root);
}

// ==================================================================== 交互物

/** 焚化（X1）：接受任意照片（“烧的是洗出来的一张”，原片永远保留，不设 flag）；部分照片换来一句画外音（GDD §8.9）。 */
function burnPhoto(w: World, thing: ThingId, g: GameApi): boolean {
  const isPhoto = thing.startsWith('ph.') || isEmptyPhotoId(thing);
  if (!isPhoto) return false;
  w.burnT = 0;
  g.sfx('burn', R1.brazier);
  const s = g.state;
  if (thing === PH.COVERED_FACE) {
    g.feedback(BURN.coveredFace);
    return true;
  }
  // 画外音（字幕）先出、默认旁白（反馈条）后出：两句同时在屏上，反馈条是最后一条
  if (thing === PH.OLD_1) g.say(BURN.old1, NPC.TUDI);
  else if (thing === PH.TUDI) g.say(BURN.tudi, NPC.TUDI);
  else if (thing === PH.OLD_3 && s.flag(F.R2_WANG_DONE)) g.say(BURN.old3, NPC.WANG);
  else if (thing === PH.MENSHEN_2018 && s.flag(F.R2_WANG_DONE)) g.say(BURN.menshen, NPC.WANG);
  else if (thing === PH.OLD_5 && s.flag(F.R3_SAW_TRUE_FORM)) g.say(BURN.old5, NPC.LU);
  g.feedback(BURN.default);
  return true;
}

function registerInteractables(ctx: AreaContext, w: World): void {
  const b = w.booth, y = w.yard;
  const pos = (o: THREE.Object3D): V3 => {
    const v = o.getWorldPosition(new THREE.Vector3());
    return [v.x, v.y, v.z];
  };

  // —— 巡夜本（P1 解法 1）
  ctx.interactable({
    // 坐在椅子上低头就是它：优先级高于桌上别的东西（CRT、录像机、视频入1），第三人称相机俯仰到头时靠近身也能聚焦到它
    id: OBJ.R1_LOG, label: LABEL.log, at: [LOG_AT[0], LOG_AT[1] + 0.02, LOG_AT[2]], hit: b.logHit, priority: 4,
    present: `!${F.R1_LOG_TAKEN}`,
    // 拾取后自动翻开巡夜本（GDD §3.2：读到夹页和新页①），合上后给“J：巡夜本”的教学提示（E.journal 阻塞到合上，M3）
    onInteract: [E.flag(F.R1_LOG_TAKEN), E.item(IT.LOG), E.sfx('page_turn'), E.journal(), E.tutorial(TUTORIAL.journal)],
  });

  // —— 电闸箱与四个开关（P1）：开关叫“开关①”…“开关④”，同组角标一致（GDD §10.2）
  ctx.interactable({
    id: OBJ.R1_SWITCH_BOX, label: LABEL.switchBox, at: SWITCH_BOX_AT, hit: b.switchBoxHit,
    // 教学提示先出、反馈后出（反馈条显示的是最后一条）
    onInteract: async g => {
      if (!g.vf.on) await g.run([E.tutorial(STRINGS.tutorial.viewfinder)]);
      g.feedback(FB.switchBoxBlank);
    },
  });
  SWITCH_IDS.forEach((id, k) => {
    ctx.interactable({
      id, label: LABEL.switches[k]!, at: SWITCH_AT[k]!, hit: b.switchHits[k], proximityFocus: false, priority: 2,
      onInteract: g => {
        g.sfx('switch', SWITCH_AT[k]);
        if (k === 2) {
          // 开关③：门灯（写 r1.gate_lamp_on）；开着再扳 → “这个别关。门口得有灯。”
          if (g.state.flag(F.R1_GATE_LAMP_ON)) {
            g.feedback(FB.keepGateLamp);
            return;
          }
          g.setFlag(F.R1_GATE_LAMP_ON);
          g.sfx('lamp_click', GATE_LAMP_MOUNT);
          return;
        }
        const key = SWITCH_TEMP[k]!;
        const on = ctx.getTemp(key) === true;
        ctx.setTemp(key, !on);
        if (!on) g.feedback(FB.switchOn[k]!);
      },
    });
  });

  // —— 圆镜（P2）：第一次“这是……我？”，之后每次“镜子里是一颗摄像头……”（GDD §8.9、P2 错误反馈）
  ctx.interactable({
    id: OBJ.R1_MIRROR, label: LABEL.mirror, at: R1.mirror.center, hit: b.mirror,
    onInteract: async g => {
      if (!g.state.seen(OBJ.R1_MIRROR)) {
        await g.run([E.seen(OBJ.R1_MIRROR)]);
        g.feedback(FB.mirrorFirst);
        return;
      }
      if (g.state.flag(F.R1_LOG_TAKEN)) await g.run([E.tutorial(STRINGS.tutorial.zoom)]);
      g.feedback(FB.mirrorAgain);
    },
  });

  // —— 抽屉（P2）：四位转轮锁，面板自动接线（owner 不写 onInteract；打开后抽屉不再可交互）
  // 拾取代理比抽屉脸大一圈、往外凸出一点、往桌里伸到锚点后面，并盖到桌沿上方 4cm：
  // 第三人称相机从高处瞄锚点时，射线先落在它的顶面上，不会越过桌沿落到桌上别的东西（R1-finale 的 r1.desk 代理在桌面后半）
  // 另有一块竖着的“上沿”：门卫室太矮，第三人称相机在桌前被天花板压到 2.4m 高、俯仰又到了 −35° 的下限，准星射线从桌沿上方
  // 1.6m 左右掠过、落到桌子中段（R1-finale 的 r1.desk 代理加高到 1.3m）。抽屉就在桌子正中，于是在桌子中段前面、桌面上方竖一块
  // 同宽的代理（只在抽屉没开时在场；巡夜本 priority 4 仍然优先，CRT 在它西边不受影响），站在桌前对着桌子正中按 E 就是抽屉。
  const drawerHit = new THREE.Group();
  drawerHit.name = 'drawerHit';
  const lowBox = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.26, 0.31), MATERIALS.hitProxy());
  lowBox.position.set(R1.drawer[0], R1.derived.deskTopY + 0.04 - 0.13, b.drawerClosedZ - 0.14 + 0.155);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.86, 0.26), MATERIALS.hitProxy());
  upper.position.set(R1.drawer[0] + 0.05, R1.derived.deskTopY + 0.04 + 0.43, 21.34);
  drawerHit.add(lowBox, upper);
  ctx.add(drawerHit);
  // 前置 r1.log_taken（GDD P2）：拿巡夜本之前抽屉不在场（开场桌上只有巡夜本一个角标），也就不会越过前置写 r1.drawer_open
  ctx.interactable({ id: OBJ.R1_DRAWER, label: LABEL.drawer, at: R1.drawer, hit: drawerHit, priority: 3, present: `${F.R1_LOG_TAKEN} && !${F.R1_DRAWER_OPEN}` });
  ctx.codeLock({
    owner: OBJ.R1_DRAWER, digits: 4, answer: '0618', title: LABEL.drawer,
    onSuccess: [E.flag(F.R1_DRAWER_OPEN), E.item(IT.KEYS), E.item(IT.BULB), E.item(IT.SLIP_0473), E.item(IT.IDCARD), E.sfx('drawer')],
    failText: FB.lockFail,
    failClue: { after: 3, text: FB.lockClue },
  });

  // —— 监控台（R1-world 提供 screen/viewPose/channels，R1-finale 提供 tunnelBaked/tunnelInner，ARCH §6.11）
  ctx.console({ screen: b.screen, viewPose: R1.derived.panelView, channels: consoleChannels() });
  ctx.interactable({ id: OBJ.R1_CRT, label: LABEL.crt, at: R1.derived.crtScreen.center, hit: b.screen, onInteract: g => g.cctv.open() });

  // —— 录像带架、《监控调试注意事项》
  ctx.interactable({ id: OBJ.R1_TAPE_RACK, label: LABEL.tapeRack, at: R1.tapeRack, hit: b.tapeRackHit, onInteract: [E.feedback(FB.tapeRack)] });
  ctx.interactable({ id: OBJ.R1_CCTV_NOTICE, label: LABEL.cctvNotice, at: R1.cctvNotice, hit: b.noticeHit, onInteract: [E.doc(DOC.CCTV_NOTICE)] });

  // —— 院门（P2）：钥匙串自动使用（不消耗）；解开铁链后门扇打开、动态碰撞体关掉（ARCH §4.8）
  ctx.collider.dynamic(OBJ.R1_GATE, y.gate.collider, `!${F.R1_GATE_UNCHAINED}`);
  ctx.interactable({
    id: OBJ.R1_GATE, label: LABEL.gate, at: pos(y.gateHit), hit: y.gateHit,
    present: `!${F.R1_GATE_UNCHAINED}`,
    when: `has(${IT.KEYS})`, blocked: FB.gateLocked,
    onInteract: [E.flag(F.R1_GATE_UNCHAINED), E.used(IT.KEYS), E.sfx('chain', pos(y.gateHit)), E.sfx('door', pos(y.gateHit))],
  });
  ctx.interactable({
    id: OBJ.R1_GATE_LAMP, label: LABEL.gateLamp, at: [GATE_LAMP_MOUNT[0], GATE_LAMP_MOUNT[1] - 0.08, GATE_LAMP_MOUNT[2] - 0.34], range: 4,
    onInteract: g => g.feedback(g.state.flag(F.R1_GATE_LAMP_ON) ? FB.keepGateLamp : FB.gateLampDark),
  });

  // —— 公告栏、小区简介、土地庙
  // 公告栏上三张纸：一张接一张在阅读器里读（拆迁公告盖在讣告下半截上；讣告被盖住的字在读到 rd.obituary_hidden 之前打码，引擎按 DocDef.covered 处理）
  ctx.interactable({
    id: OBJ.R1_NOTICE_BOARD, label: LABEL.noticeBoard, at: pos(y.boardHit), hit: y.boardHit,
    onInteract: [E.doc(DOC.DEMOLITION), E.doc(DOC.OBITUARY), E.doc(DOC.WATER_NOTICE)],
  });
  ctx.interactable({ id: OBJ.R1_ESTATE_SIGN, label: LABEL.estateSign, at: pos(y.estateHit), hit: y.estateHit, onInteract: [E.doc(DOC.ESTATE_SIGN)] });
  ctx.interactable({
    // 锚点在龛顶上方（在碰撞盒外，视线检查不被自己的碰撞体挡住，ARCH §4.8）
    id: OBJ.R1_SHRINE, label: LABEL.shrine, at: [R1.shrine[0], 1.0, R1.shrine[2]], hit: y.shrineHit,
    onInteract: async g => {
      // r1.met_tudi 之前、常光下：只见空马扎和灯笼，灯笼里有个声音（旁白字幕）；之后（或在取景器里）改为看对联（GDD P1、§8.1）
      if (!g.state.flag(F.R1_MET_TUDI) && !g.vf.on) {
        await g.run([E.tutorial(STRINGS.tutorial.viewfinder)]);
        g.say(FB.shrineLantern);
        return;
      }
      await g.openDoc(DOC.SHRINE_COUPLET);
    },
  });

  // —— 火盆（X1）：只有“使用照片”，按 E 直接弹挑选器
  ctx.interactable({
    id: OBJ.R1_BRAZIER, label: LABEL.brazier, at: [R1.brazier[0], 0.55, R1.brazier[2]], hit: y.brazierHit, menuVerb: 'use',
    offers: { accept: {}, any: (thing, g) => burnPhoto(w, thing, g) },
  });

  // —— 红外冷迹（X5）：红外取景器里对它按 E，旁白 + 巡夜本“已知线索”；不设 flag
  // （hit 用冷迹本身——红外图层里的人形；锚点在坐着的人形胸口，比椅背高，视线不被椅背挡住）
  ctx.interactable({
    id: OBJ.R1_COLD_CHAIR, label: LABEL.coldTrace, at: [R1.chair[0], 1.05, R1.chair[2]], hit: y.coldChair, view: 'viewfinder', lens: 'ir',
    present: `!${F.R1_ZHOU_VISIBLE}`,
    onInteract: [E.feedback(COLD.chair), E.clue(COLD.chair)],
  });
  ctx.interactable({
    id: OBJ.R1_COLD_STEPS, label: LABEL.coldTrace, at: [R1.coldSteps[0], 0.75, R1.coldSteps[2]], hit: y.coldSteps, view: 'viewfinder', lens: 'ir',
    onInteract: [E.feedback(COLD.steps), E.clue(COLD.steps)],
  });
}

// ==================================================================== 镜面

function registerMirror(ctx: AreaContext, w: World): void {
  const b = BOOTH;
  ctx.mirror({
    id: OBJ.R1_MIRROR, mesh: w.booth.mirror,
    // 玩家在门卫室里（含门口一步）才渲染镜面（GDD §3.14）
    // 另加一条：视线大致朝北（镜子在北墙）才渲染——坐在椅子上看桌子、开场过场对着 CRT 时镜子在身后，不必每两帧多画一遍门卫室
    // （yaw 是第三人称/取景器的视角朝向；±100° 内都算看得见镜子那面墙）
    activeWhen: g => {
      const p = g.player.position;
      if (!(p.x > b.x0 - 0.1 && p.x < b.x1 + 0.6 && p.z > b.z0 - 0.1 && p.z < b.z1 + 0.1)) return false;
      return Math.abs(angleDiff(g.player.yaw, 0)) < 100;
    },
    baked: () => bakedMirrorTexture(ctx),
  });
}

export function registerLogic(ctx: AreaContext, w: World): void {
  registerTudi(ctx, w);
  registerInteractables(ctx, w);
  registerMirror(ctx, w);
}

// ==================================================================== 每帧的外观同步

/** 子时–寅时的夜空（world.ts 建 skyDome 时用同一组颜色；卯时 12 秒过渡到黎明）。 */
export const SKY_NIGHT = { zenith: '#0B1020', horizon: '#1F2638', glow: '#4A3222' } as const;
const C = {
  fogNight: new THREE.Color(PALETTE.FOG_R1), fogDawn: new THREE.Color('#CDB6A6'),
  hemiSky: new THREE.Color('#1B2233'), hemiGround: new THREE.Color(PALETTE.NIGHT),
  // 卯时地面色与终章 LOOKS.mao 同值（M4：#3A4150 在湿地面上压不住夜色）
  hemiSkyDawn: new THREE.Color(PALETTE.DAWN), hemiGroundDawn: new THREE.Color('#5A5660'),
  zenith: new THREE.Color(SKY_NIGHT.zenith), horizon: new THREE.Color(SKY_NIGHT.horizon), glow: new THREE.Color(SKY_NIGHT.glow),
  farNight: new THREE.Color(FAR_NIGHT), farDawn: new THREE.Color('#7A7684'),
  puddleNight: new THREE.Color(PUDDLE_NIGHT), puddleDawn: new THREE.Color('#66626A'),
  zenithDawn: new THREE.Color('#5E7488'), horizonDawn: new THREE.Color('#E8B8A0'), glowDawn: new THREE.Color('#F2C8A0'),
};
const tmp = new THREE.Color();

/** 上午（尾声、片尾）的远景与积水：晨雾里的灰楼（比雾色 #D6CABB 略暗）、积水映着天。 */
const C_MORNING = { far: new THREE.Color('#B9B0A6'), puddle: new THREE.Color('#8E8A86') };
/** 卯时半球光比夜里提到多少倍（终章 LOOKS.mao 是 0.7π，夜里 0.25π；读档直接进卯时的画面与过场里天亮后一致） */
const HEMI_DAWN_GAIN = 0.7 / 0.25;
/** 近处楼的亮窗：天亮以后压暗（×0.45），上午屋里的灯早关了（×0.1：亮窗剩一点暖灰，不再发光） */
const NEAR_WIN_DAWN = 0.45, NEAR_WIN_MORNING = 0.1;
/** 湿地面映着的天光（加法薄片的不透明度）：卯时、上午 */
const SHEEN_DAWN = 0.03, SHEEN_MORNING = 0.025;

/**
 * 雾与天色：子时/丑时 #141A26 0.045；寅时雾降到 0.03；卯时 #CDB6A6 0.018，半球光换成黎明（GDD §4.1）。
 * k = 天亮进度（进区域时按 flags 定；终章过场里由 temp(fin_dawn) 接管，见 FIN_SKY）；morning = 尾声/片尾的上午。
 * 雾、半球光、天穹在终章接管期间由 R1-finale 每帧盖过去；远景剪影、远处与近处的亮窗、院外路灯、门灯、积水只在这里摆。
 */
function applySky(w: World, k: number, morning: boolean): void {
  const s = w.ctx.state;
  const yin = s.flag(F.R4_GOT_TAPE);
  const fog = w.ctx.scene.fog as THREE.FogExp2 | null;
  if (fog && 'density' in fog) {
    const night = yin ? 0.03 : 0.045;
    fog.density = night + (0.018 - night) * k;
    fog.color.copy(tmp.copy(C.fogNight).lerp(C.fogDawn, k));
  }
  w.lights.hemi.color.copy(tmp.copy(C.hemiSky).lerp(C.hemiSkyDawn, k));
  w.lights.hemi.groundColor.copy(tmp.copy(C.hemiGround).lerp(C.hemiGroundDawn, k));
  w.lights.hemi.intensity = w.hemiBase * (1 + (HEMI_DAWN_GAIN - 1) * k);
  const u = (w.sky.material as THREE.ShaderMaterial).uniforms;
  if (u.uZenith && u.uHorizon && u.uGlow) {
    (u.uZenith.value as THREE.Color).copy(tmp.copy(C.zenith).lerp(C.zenithDawn, k));
    (u.uHorizon.value as THREE.Color).copy(tmp.copy(C.horizon).lerp(C.horizonDawn, k));
    (u.uGlow.value as THREE.Color).copy(tmp.copy(C.glow).lerp(C.glowDawn, k));
  }
  // 远景剪影：夜里比天顶还暗，天亮了变成晨雾里的灰蓝，上午是晨雾里的灰楼；远处亮窗在天光里淡下去，上午全灭
  if (morning) {
    w.far.silhouette.color.copy(C_MORNING.far);
    w.far.windows.color.setScalar(0);
    w.yard.puddle.color.copy(C_MORNING.puddle);
  } else {
    w.far.silhouette.color.copy(tmp.copy(C.farNight).lerp(C.farDawn, k));
    w.far.windows.color.setScalar(FAR_WIN_GLOW * (1 - 0.9 * k));
    w.yard.puddle.color.copy(tmp.copy(C.puddleNight).lerp(C.puddleDawn, k));
  }
  w.far.windows.visible = !morning;
  // 湿地面映着的天光：天亮后半段才起来（东边发白），上午一直在
  const sheen = morning ? SHEEN_MORNING : SHEEN_DAWN * Math.max(0, (k - 0.3) / 0.7);
  (w.yard.sheen.material as THREE.MeshBasicMaterial).opacity = sheen;
  w.yard.sheen.visible = sheen > 0.001;
  // 近处楼的亮窗
  const near = morning ? NEAR_WIN_MORNING : 1 + (NEAR_WIN_DAWN - 1) * k;
  for (const m of w.windowMats) m.color.setScalar(near);
  // 院外路灯（只有灯罩的那几盏与两条湿地光带）、院里两盏钠灯：上午关掉
  w.street.glow.emissiveIntensity = morning ? 0 : w.street.glowBase;
  for (const l of w.street.rigs) l.setOn(!morning);
  for (const l of w.lights.sodium) l.setOn(!morning);
  const bg = w.ctx.scene.background;
  if (bg && (bg as THREE.Color).isColor) (bg as THREE.Color).copy(tmp.copy(C.zenith).lerp(C.zenithDawn, k));
}

/** 此刻的天色：终章接管时按 temp(fin_dawn)/temp(fin_morning)，否则按进区域时的卯时。 */
function skyNow(w: World): { k: number; morning: boolean } {
  const s = w.ctx.state;
  const morning = s.temp(FIN_SKY.morning) === true;
  const fin = s.temp(FIN_SKY.dawn);
  const k = morning ? 1 : typeof fin === 'number' ? Math.min(1, Math.max(0, fin)) : w.dawn;
  return { k, morning };
}

/** 进区域时按 flags 摆好一切（不做动画）。 */
export function syncInitial(w: World): void {
  const s = w.ctx.state;
  w.gateOpen = s.flag(F.R1_GATE_UNCHAINED) ? 1 : 0;
  w.dawn = s.flag(F.R1_SOUL_RETURNED) ? 1 : 0;
  w.lastSky = '';
  w.rain.setIntensity(s.flag(F.R4_GOT_TAPE) || s.flag(F.R1_SOUL_RETURNED) ? 0 : 1, 0);
  syncFrame(w, 0);
}

export function onFlagChange(w: World, id: string): void {
  if (id === F.R4_GOT_TAPE) w.rain.setIntensity(0, 6);
  if (id === F.R1_SOUL_RETURNED) w.rain.setIntensity(0, 3);
  // 门灯一亮，槐树底下有人咳嗽了一声（M4：开场的光引导——告诉玩家下一步往槐树那边去）
  if (id === F.R1_GATE_LAMP_ON && !w.ctx.state.flag(F.R1_MET_TUDI)) w.ctx.after(0.8, () => w.ctx.game.say(FB.tudiCough));
}

export function syncFrame(w: World, dt: number): void {
  const ctx = w.ctx;
  const s = ctx.state;
  const L = w.lights;
  w.rain.update(dt);
  const sky = skyNow(w);
  // 灯：门灯按 flag（尾声的上午关了），车棚/公告栏/彩灯按开关的临时状态
  L.gate.setOn(s.flag(F.R1_GATE_LAMP_ON) && !sky.morning);
  // 车棚灯：开关①；倒带到 2012 年 6 月的傍晚（旧照二）时，那会儿车棚灯是亮着的
  L.shed.setOn(ctx.getTemp(TEMP.shed) === true || ctx.game.replay.active?.seg === SEG.SHED_2012);
  L.board.setOn(ctx.getTemp(TEMP.board) === true);
  const treeOn = ctx.getTemp(TEMP.tree) === true;
  if (treeOn !== w.treeOn) {
    w.treeOn = treeOn;
    L.strings.setOn(treeOn);
  }
  // 闸刀：开 = 往上扳
  const on = [ctx.getTemp(TEMP.shed) === true, ctx.getTemp(TEMP.board) === true, s.flag(F.R1_GATE_LAMP_ON), treeOn];
  w.booth.switchLevers.forEach((lv, k) => {
    const target = on[k] ? -0.55 : 0.5;
    lv.rotation.x += (target - lv.rotation.x) * Math.min(1, dt * 14 || 1);
  });
  // 巡夜本拿走了；抽屉开了往外拉
  const logHere = !s.flag(F.R1_LOG_TAKEN);
  w.booth.log.visible = logHere;
  w.booth.logGlow.visible = logHere;
  // 开场巡夜本特写时把光环压暗（M4：让墨迹那一行是画面里最亮的东西；cs.r1.intro 写 temp(intro_log)）
  const introClose = ctx.getTemp(TEMP.introLog) === true && ctx.game.modes.top === 'mode.cutscene';
  (w.booth.logGlow.material as THREE.MeshBasicMaterial).opacity = introClose ? 0.22 : 0.8;
  w.booth.logHit.visible = logHere;
  const dz = s.flag(F.R1_DRAWER_OPEN) ? -0.22 : 0;
  const d = w.booth.drawer;
  d.position.z += (w.booth.drawerClosedZ + dz - d.position.z) * Math.min(1, dt * 6 || 1);
  // 椅子上的冷迹：老周显形之后他本人就坐在那儿（红外里是 6℃ 的魂影），冷迹收起
  w.yard.coldChair.visible = !s.flag(F.R1_ZHOU_VISIBLE);
  // 院门：解开铁链后铁链消失、门扇往里开
  const unchained = s.flag(F.R1_GATE_UNCHAINED);
  if (w.yard.chain) w.yard.chain.visible = !unchained;
  const target = unchained ? 1 : 0;
  if (w.gateOpen !== target) w.gateOpen = dt === 0 ? target : Math.min(1, w.gateOpen + dt / 1.6);
  w.yard.gate.setOpen(w.gateOpen * w.gateOpen * (3 - 2 * w.gateOpen));
  // 常光下只见土地的空马扎与自己飘着的灯笼；取景器里（或被看见过以后）是土地本人
  const p = tudiPlacement(s);
  const lo = w.lanternOnly;
  lo.root.visible = p !== null && !ctx.game.vf.on && !s.seen(NPC.TUDI) && !ctx.game.replay.active;
  // 引路的那一团红光只在“还没见着土地”时亮（M4）；见过以后（拍照而没在取景器里跟他说话时 seen 可能没记上）只剩灯笼本身
  const loHalo = lo.root.userData.halo as THREE.Object3D | undefined;
  if (loHalo) loHalo.visible = !s.flag(F.R1_MET_TUDI);
  if (p) {
    lo.root.position.set(p.pos[0], p.pos[1], p.pos[2]);
    lo.root.rotation.y = (-p.yaw * Math.PI) / 180;
  }
  lo.update(dt, 0);
  leanLantern(lo.props.lantern, lo.root, ctx.game);
  // 焚化特效
  const fx = w.yard.burnFx;
  if (w.burnT >= 0) {
    w.burnT += dt;
    const t = w.burnT;
    fx.visible = t < 2.6;
    const k = Math.min(1, t / 0.4) * Math.max(0, 1 - Math.max(0, t - 1.6) / 1.0);
    fx.traverse(o => {
      if (o.name === 'flame') o.scale.set(0.6 + 0.4 * k + Math.random() * 0.08, k * (0.9 + Math.random() * 0.2), 1);
      if (o.name === 'burnPhoto') {
        o.scale.set(1, Math.max(0.05, 1 - t / 1.2), Math.max(0.05, 1 - t / 1.4));
        o.visible = t < 1.4;
      }
      if (o.name === 'ash') {
        o.position.y = t * 0.35;
        o.rotation.y = t * 2.2;
      }
    });
    if (t >= 2.6) w.burnT = -1;
  } else fx.visible = false;
  // 卯时：进区域时已是卯时就直接是黎明（syncInitial）。在本区里合影写下 r1.soul_returned 时不自己跑天亮——
  // GDD P14 第 5–6 步老周回屋还是夜里，东边发白在 cs.r1.dawn 里，由 R1-finale 的过场接管天色（docs/requests/r1-finale.md #3）
  const key = `${sky.k}|${sky.morning}`;
  if (key !== w.lastSky) {
    w.lastSky = key;
    applySky(w, sky.k, sky.morning);
  }
}

/**
 * 雨是以相机为中心的一盒雨丝（kit/rain），不认屋顶：相机进了门卫室就别再让雨丝落在屋里。
 * 在 kit 的 onBeforeRender（按正在渲染的相机摆雨盒）之后，相机在门卫室里时把雨的不透明度置 0（镜面/CH2 本来就隐藏雨，auxHide）。
 */
export function keepRainOutOfBooth(r: RainRig): void {
  const mat = r.mesh.material as THREE.ShaderMaterial;
  const u = mat.uniforms.uOpacity;
  if (!u) return;
  const base = u.value as number;
  const orig = r.mesh.onBeforeRender;
  const cp = new THREE.Vector3();
  const b = BOOTH;
  r.mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
    orig.call(this, renderer, scene, camera, geometry, material, group);
    camera.getWorldPosition(cp);
    const inside = cp.x > b.x0 && cp.x < b.x1 && cp.z > b.z0 && cp.z < b.z1 && cp.y < b.top;
    u.value = inside ? 0 : base;
  };
}

export function makeLanternOnly(ctx: AreaContext): CharacterRig {
  // 土地的“只有灯笼”变体（world 层，常光可见）：身子不见，灯笼自己飘着
  const rig = createCharacter('tudi', { look: 'live', variant: 'lantern_only', seed: 3 });
  const halo = brightenLantern(ctx, rig, 1, 'far');
  if (halo) {
    halo.name = 'lanternOnlyHalo';
    rig.root.userData.halo = halo;
  }
  return rig;
}

/**
 * 开场的光引导（GDD §2.2、§3.2“槐树下有一盏灯笼飘着”）：kit 的灯笼灯芯只有 1.6，出了门岗望过去只剩三个像素的粉点，被钠灯与亮窗压住。
 * M4：灯笼放大 1.5 倍、灯芯自发光提上去（烧白、出 Bloom），再挂一片朝着镜头的加法光晕（不吃雾，20m 外也是一团红光）。
 * M4 第 2 轮：分两种——
 * - 常光下自己飘着的那盏（引路，far）：灯芯 4、光晕 0.42m × 1.6 倍，按相机距离缩放（2m 内只剩 0.25 倍的一圈，8m 外满尺寸）：
 *   从门岗门口望过去照样是一团红，走到跟前（对土地庙按 E）不再是整团红光；
 * - 取景器里土地手上那盏：灯芯 6 → 2.5（核心仍烧白，不再是一大团）、光晕 0.26m × 0.9 倍 × glow，
 *   1.5m 内 0.35 倍、5.5m 外满尺寸：近看不再是一个比土地的头还大的白红光盘。
 * glow = 光晕的强度倍数。材质是克隆的（kit 的配件材质按人偶共享），随区域释放。
 */
const LANTERN_LOOK = {
  far: { core: 4, size: 0.42, gain: 1.6, near: 2, full: 8, min: 0.25 },
  vf: { core: 2.5, size: 0.26, gain: 0.9, near: 1.5, full: 5.5, min: 0.35 },
} as const;
const _haloW = new THREE.Vector3(), _camW = new THREE.Vector3();
function brightenLantern(ctx: AreaContext, rig: CharacterRig, glow: number, kind: keyof typeof LANTERN_LOOK): THREE.Mesh | null {
  const lantern = rig.props.lantern;
  if (!lantern) return null;
  const look = LANTERN_LOOK[kind];
  lantern.scale.setScalar(LANTERN_SCALE);
  let body: THREE.Mesh | null = null;
  lantern.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.name !== 'lanternBody') return;
    const mat = ctx.track((m.material as THREE.MeshStandardMaterial).clone());
    mat.emissiveIntensity = look.core;
    m.material = mat;
    body = m;
  });
  const tex = ctx.track(paintTexture(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.2, 'rgba(255,255,255,0.6)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.14)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }));
  const haloMat = ctx.track(new THREE.MeshBasicMaterial({
    map: tex, color: new THREE.Color(LANTERN_RED).multiplyScalar(look.gain * glow), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  haloMat.userData.tempC = 40;
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(look.size, look.size), haloMat);
  halo.name = 'lanternHalo';
  ctx.track(halo.geometry);
  const at = (body as THREE.Mesh | null)?.position;
  if (at) halo.position.copy(at);
  halo.renderOrder = 9;
  halo.userData.irHide = true;
  halo.userData.noOcclude = true;
  halo.userData.noBounds = true;
  halo.raycast = () => {};
  const q = new THREE.Quaternion();
  halo.onBeforeRender = (_r, _s, cam) => {
    // 朝着正在渲染的相机（父节点会晃、会被 finale 缩放）：本地朝向 = 父的世界朝向的逆 × 相机朝向
    const parent = halo.parent;
    if (parent) {
      parent.getWorldQuaternion(q).invert();
      halo.quaternion.copy(q).multiply(cam.quaternion);
    } else halo.quaternion.copy(cam.quaternion);
    // 按相机距离缩放：近看只剩一圈，远处照样是一团红（M4 第 2 轮）
    const d = halo.getWorldPosition(_haloW).distanceTo(cam.getWorldPosition(_camW));
    halo.scale.setScalar(Math.min(1, Math.max(look.min, (d - look.near) / (look.full - look.near))));
    halo.updateMatrixWorld();
  };
  lantern.add(halo);
  return halo;
}
