// owner: R3
// R3 的玩法接线（GDD P6–P8、§4.6 时辰差异、X5 冷迹）：交互物、陆师傅、称呼面板、暗房冲片的步骤机、
// 以及随 flags/临时状态变化的场景状态（门、霓虹、底片、画架、暗房灯、单红通道后期、屋里停雨）。
//
// 区域临时状态（ctx.setTemp，不存档、换区域清空，GDD §3.13“暗房步骤属于临时状态”）：
//   safelight  true = 红灯（进暗房时白灯亮着）
//   dev_step   0–4：已按守则过了几道（显影/停显/定影/清水）；错一步归零
//   bell_rung  按过一次门铃
//   lu_farewell 本相过场期间陆师傅还在（见 cutscenes.ts）

import * as THREE from 'three';
import type { AreaContext } from '../../core/area';
import type { V3 } from '../../core/types';
import { DOC, F, IT, NAME, NPC, OBJ, PH, holeId } from '../../data/ids';
import type { InteractId } from '../../data/ids';
import { LIGHT_SCALE, TEMP_C } from '../../data/render';
import { POST_PRESETS } from '../../fx/presets';
import { E } from '../../game/effects';
import type { GameApi } from '../../game/effects';
import type { StateView } from '../../game/state';
import { designCandela } from '../../kit/lamps';
import { createColdTrace } from '../../kit/residue';
import { createCharacter } from '../../rigs/characters';
import { devWarn } from '../../core/log';
import type { RainRig } from '../../kit/rain';
import { AMB } from './audio';
import { CS_R3, LU_FAREWELL } from './cutscenes';
import { DLG_R3 } from './dialogue';
import {
  BASIN_XI, BELL, COLD_DOOR, DARK, DRYING, FILM_X, GRID_CENTER, LAMP_CORD, LU_CAMERA, LU_COUNTER, PARTITION, PLATE_CHIPPED, SINK, STOOL, TLR, TRAY_SQUARE,
  holeCenter, insideDarkroom, insideShop,
} from './layout';
import { attachNegative, disposeNegative, hideNegative, updateNegative } from './negative';
import { EASEL_CANVAS_AT } from './photo';
import { TEXT } from './text';
import type { ShopRig } from './build/shop';
import { NEON_LIGHT } from './build/shop';
import type { StudioRig } from './build/studio';
import type { DarkroomRig } from './build/darkroom';
import { DARK_LIGHT } from './build/darkroom';
import type { StreetRig } from './build/street';

export interface R3Rig {
  street: StreetRig;
  shop: ShopRig;
  studio: StudioRig;
  dark: DarkroomRig;
  rain: RainRig;
  hemi: THREE.HemisphereLight;
}

/**
 * 半球光（本区唯一的一盏，数量不变，只改颜色与强度）：街上压得很低（暗部靠环境贴图与夜空）；
 * 镜头进了照相馆（前厅、影棚）换成钨丝暖色，墙角不至于黑成一片；暗房里仍用街上那一档（暗房本该黑）。
 */
export const HEMI = {
  street: { sky: '#5a4a5a', ground: '#1a1016', design: 0.1 },
  shop: { sky: '#FFC98A', ground: '#0E0C0A', design: 0.1 },
} as const;

/** 本区加载期间的运行状态（onExit 清掉）。 */
interface Runtime {
  rig: R3Rig;
  doorT: number;
  darkDoorT: number;
  monoRed: boolean;
  inside: boolean | null;
  neonOn: boolean;
  flickerT: number;
  /** 半球光当前在“屋里”那一档的比例（0 = 街上，1 = 照相馆里）；null = 还没摆过（第一帧直接到位） */
  hemiT: number | null;
  /** 街景整批藏着（人和镜头都在隔墙北边） */
  streetHidden: boolean;
}
let rt: Runtime | null = null;

const T = TEXT.fb;
const _camPos = new THREE.Vector3();
const _hemiC = new THREE.Color();
const TEMP = { safelight: 'safelight', devStep: 'dev_step', bellRung: 'bell_rung' } as const;
const POST_KEY = 'darkroom_red';
/** 人在隔墙（z = -5）北边多远以外时街景整批不画（见 updateLogic）。 */
const STREET_HIDE_MARGIN = 2;

/** 冲片次序（GDD §7.4 守则：显影黄盘 → 停显红盆 → 定影白盘 → 清水水池）。 */
const ORDER: readonly InteractId[] = [OBJ.R3_TRAY_SQUARE, OBJ.R3_BASIN_XI, OBJ.R3_PLATE_CHIPPED, OBJ.R3_SINK];
const STEP_TEXT = [T.stepDev, T.stepStop, T.stepFix, T.stepRinse] as const;

const safelightOn = (s: StateView): boolean => s.temp(TEMP.safelight) === true;
const stepOf = (ctx: AreaContext): number => {
  const v = ctx.getTemp(TEMP.devStep);
  return typeof v === 'number' ? v : 0;
};
/** 手上有没冲的胶卷。 */
const holdingFilm = (s: StateView): boolean => s.has(IT.FILM) && !s.flag(F.R3_FILM_HUNG);

/** 陆师傅的站位（GDD §4.6：r1.mission_given 后在柜台后；拿了新单子站到大座机后面；r3.saw_true_form 后不在馆里）。 */
export function luPlacement(s: StateView): { pos: V3; yaw: number } | null {
  if (!s.flag(F.R1_MISSION_GIVEN)) return null;
  const farewell = s.temp(LU_FAREWELL) === true;
  if (s.flag(F.R3_SAW_TRUE_FORM) && !farewell) return null;
  if (farewell || s.has(IT.SLIP_0474)) return { pos: LU_CAMERA, yaw: 0 };
  return { pos: LU_COUNTER, yaw: 180 };
}

// ==================================================================== 暗房：片子瞎了 / 次序错了 / 下一步

function ruin(ctx: AreaContext, g: GameApi, text: string): void {
  ctx.setTemp(TEMP.devStep, 0);
  g.sfx('error');
  // 陆师傅（门外）的字幕先出，反馈条后出：两句同时在屏幕上（字幕与反馈条是两层）
  g.say(T.luNotMind, NPC.LU);
  g.feedback(text);
}

function developAt(ctx: AreaContext, g: GameApi, id: InteractId): void {
  const s = g.state;
  const isSink = id === OBJ.R3_SINK;
  if (!holdingFilm(s)) {
    g.feedback(isSink ? T.sinkNoFilm : T.trayNoFilm);
    return;
  }
  const step = stepOf(ctx);
  if (step >= ORDER.length) {
    g.feedback(T.stepDone);
    return;
  }
  // 白灯下把没定影的片子放进药水：瞎了（GDD P7 错误反馈）；定过影的片子见光无妨
  if (!safelightOn(s) && step < 3) {
    ruin(ctx, g, T.filmBlind);
    return;
  }
  if (ORDER[step] !== id) {
    ruin(ctx, g, T.filmGrey);
    return;
  }
  ctx.setTemp(TEMP.devStep, step + 1);
  g.sfx('water_pour');
  g.feedback(STEP_TEXT[step] ?? T.stepRinse);
}

function pullCord(ctx: AreaContext, g: GameApi): void {
  const red = !safelightOn(g.state);
  ctx.setTemp(TEMP.safelight, red);
  g.sfx('lamp_click');
  g.feedback(red ? T.cordRed : T.cordWhite);
  applyDarkLight(ctx);
  // 显影、停显时开白灯：片子见了白光
  const step = stepOf(ctx);
  if (!red && holdingFilm(g.state) && step >= 1 && step <= 2) ruin(ctx, g, T.filmBlind);
}

function hangFilm(ctx: AreaContext, g: GameApi): void {
  const s = g.state;
  if (s.flag(F.R3_FILM_HUNG)) return g.feedback(T.lineHung);
  if (!s.has(IT.FILM)) return g.feedback(T.lineEmpty);
  if (stepOf(ctx) < ORDER.length) return g.feedback(T.lineNotYet);
  g.setFlag(F.R3_FILM_HUNG);
  g.markUsed(IT.FILM);
  ctx.setTemp(TEMP.devStep, 0);
  g.sfx('page_turn');
  g.feedback(T.lineHang);
}

// ==================================================================== 场景状态

/** 暗房的那一盏灯：白灯 #FFF2DC / 红灯 #B3001B（同一盏灯只改颜色、强度、距离；灯数不变）。 */
function applyDarkLight(ctx: AreaContext): void {
  if (!rt) return;
  const red = ctx.getTemp(TEMP.safelight) === true;
  const L = red ? DARK_LIGHT.red : DARK_LIGHT.white;
  const d = rt.rig.dark;
  d.light.color.set(L.color);
  d.light.distance = L.distance;
  d.light.intensity = designCandela('point', L.design, L.distance);
  d.bulb.emissive.set(L.color);
  d.bulb.emissiveIntensity = L.glow;
  rt.rig.studio.busyLamp.emissiveIntensity = red ? 3 : 0;
  rt.rig.studio.busyLamp.userData.tempC = red ? TEMP_C.lamp : TEMP_C.ambient;
}

/** 进区域（onEnter）：按 flags 摆场景（影棚投影在 build 里就开着，docs/requests/r3.md #1 已由引擎修好）。 */
export function enterLogic(ctx: AreaContext): void {
  if (!rt) return;
  syncScene(ctx);
}

/** 按 flags 摆好场景（进区域时与每次 flag 变化后）。 */
export function syncScene(ctx: AreaContext): void {
  if (!rt) return;
  const s = ctx.state;
  const { shop, studio, dark } = rt.rig;
  // 霓虹：r3.saw_true_form 后熄灭（GDD §4.6）
  const neonOn = !s.flag(F.R3_SAW_TRUE_FORM);
  if (neonOn !== rt.neonOn) {
    rt.neonOn = neonOn;
    shop.neon.setOn(neonOn);
    if (!neonOn) shop.neonLight.intensity = 0;
    ctx.ambienceHandles()[AMB.neon]?.set('on', neonOn ? 1 : 0, 0.4);
  }
  // 底片挂上晾片绳后才出现
  dark.film.visible = s.flag(F.R3_FILM_HUNG);
  // 遗像交出去以后画架空了
  const hasPortrait = !s.flag(F.R3_SAW_TRUE_FORM);
  if (studio.canvas) studio.canvas.visible = hasPortrait;
  studio.sketch.visible = hasPortrait;
  applyDarkLight(ctx);
}

// ==================================================================== 登记交互物与 NPC

export function setupLogic(ctx: AreaContext, rig: R3Rig): void {
  rt = { rig, doorT: ctx.state.flag(F.R3_LU_DOOR_OPEN) ? 1 : 0, darkDoorT: 0, monoRed: false, inside: null, neonOn: true, flickerT: 0, hemiT: null, streetHidden: false };
  const { shop, studio, dark } = rig;
  // 红灯状态被别处直接写进临时状态（截图机位的 ShotDef.temp，M3，docs/requests/r3.md #4）时同样换灯
  ctx.on('temp', e => {
    if (e.area === 'r3' && e.key === TEMP.safelight) applyDarkLight(ctx);
  });
  rig.shop.door.setOpen(rt.doorT);
  // 屋里不下雨：北侧铺面的门脸在 z = 0，z < 0 且低于屋檐（6.9m）的雨丝一律透明——
  // 从街上隔着玻璃看不到店里下雨，从店里往外看街上照样下（本区自己的雨材质实例，只改它的顶点着色器）
  const rainMat = rig.rain.mesh.material as THREE.ShaderMaterial;
  const before = rainMat.vertexShader;
  rainMat.vertexShader = before.replace(/(vAlpha = [^;]*;)/, '$1\n  vAlpha *= max(step(0.0, world.z), step(6.9, world.y));');
  if (rainMat.vertexShader === before) devWarn('[r3] 雨的顶点着色器没找到 vAlpha 行，屋里会下雨');
  rainMat.needsUpdate = true;

  // —— 门铃（GDD P6：第一次“没人应。”，再按“没人应。玻璃后头好像有个人影。”）
  ctx.interactable({
    id: OBJ.R3_BELL, label: TEXT.label.bell, at: [BELL[0], BELL[1], 0.08], hit: shop.bell,
    onInteract: g => {
      g.sfx('lamp_click', BELL);
      const s = g.state;
      if (s.flag(F.R3_LU_DOOR_OPEN)) return g.feedback(T.bellOpen);
      const again = s.temp(TEMP.bellRung) === true && luPlacement(s) !== null;
      ctx.setTemp(TEMP.bellRung, true);
      g.feedback(again ? T.bellAgain : T.bellFirst);
    },
  });

  // —— 玻璃门：交互只取门把手；开门前 when 为假（灰角标 + 专属反馈）
  const handlePos = new THREE.Vector3();
  ctx.interactable({
    id: OBJ.R3_SHOP_DOOR, label: TEXT.label.door, at: () => shop.door.handle.getWorldPosition(handlePos), hit: shop.door.handle,
    when: F.R3_LU_DOOR_OPEN, blocked: T.doorLocked,
    onInteract: [E.feedback(T.doorOpen)],
  });
  ctx.collider.dynamic(OBJ.R3_SHOP_DOOR, shop.door.collider, `!${F.R3_LU_DOOR_OPEN}`, { seeThrough: true });

  // —— 取件格 ×100：角标一律“取件格”，同一条件（GDD §10.2，灰/白一致）
  for (let n = 0; n < 100; n++) {
    const id = holeId(n);
    const photoText = T.holes[n];
    ctx.interactable({
      // 取件格的编号印在格子下沿：取景器里准星对着时名字画在准星上方，不压住编号（M4 第 2 轮，InteractableDef.vfLabel）
      id, label: TEXT.label.hole, at: holeCenter(n), hit: shop.holes[n], proximityFocus: false, vfLabel: 'above',
      when: F.R3_LU_DOOR_OPEN, blocked: T.doorLocked,
      onInteract: n === 73
        ? g => {
          if (g.state.flag(F.R3_GOT_ENVELOPE)) return g.feedback(T.holeEmpty);
          g.setFlag(F.R3_GOT_ENVELOPE);
          g.give(PH.COVERED_FACE);
          g.sfx('page_turn');
          g.feedback(T.envelope);
        }
        : [E.feedback(photoText ?? T.holeEmpty)],
    });
  }
  // 整面取件格（打在格子之间的木条上时）
  ctx.interactable({
    id: OBJ.R3_PICKUP_GRID, label: TEXT.label.grid, at: GRID_CENTER, hit: shop.grid, proximityFocus: false, priority: -1, vfLabel: 'above',
    onInteract: [E.feedback(T.grid)],
  });

  // —— 陆师傅（阴物：只在取景器里瞧得见；隔着玻璃 6m 也能说话，门的优先级低于他）
  // 本相过场里举到灯下的那张底片先挂在他右手上（藏着），随 NPC 根节点进 yin 层（negative.ts）
  const luRig = createCharacter('lu', { look: 'ghost' });
  attachNegative(ctx, luRig);
  const lu = ctx.npc({
    id: NPC.LU, rig: luRig, yin: true, tempC: TEMP_C.yin,
    placement: luPlacement,
    interact: {
      label: TEXT.label.lu, view: 'viewfinder', revealOnVfInteract: true, priority: 2,
      range: s => (s.flag(F.R3_LU_DOOR_OPEN) ? 3.2 : 6),
      talk: [
        { when: `!${F.R3_LU_DOOR_OPEN}`, dialogue: DLG_R3.LU_GLASS },
        { when: `!${F.R3_GOT_ENVELOPE}`, dialogue: DLG_R3.LU_PICKUP },
        { when: `!${F.R3_FILM_DEVELOPED}`, dialogue: DLG_R3.LU_ENVELOPE },
        { when: `!has(${IT.SLIP_0474})`, dialogue: DLG_R3.LU_FILM },
        { when: `!${F.R3_SAW_TRUE_FORM}`, dialogue: DLG_R3.LU_SIT },
        { dialogue: DLG_R3.LU_AFTER },
      ],
      menuVerb: 'show',
      offers: s => (s.flag(F.R3_LU_DOOR_OPEN)
        ? undefined
        : {
          accept: { [IT.SLIP_0473]: [E.used(IT.SLIP_0473), E.flag(F.R3_LU_DOOR_OPEN), E.sfx('door'), E.dialogue(DLG_R3.LU_SLIP)] },
          // 别的东西：陆师傅隔着玻璃回一句（字幕带说话人；不是匿名反馈条，M4）。东西原样退回，只是算“已处理”
          any: (_thing, g) => {
            g.say(T.luNotSlip, NPC.LU);
            return true;
          },
        }),
    },
    onPlaced: npc => {
      const p = luPlacement(ctx.state);
      if (!p || !npc.present) return;
      const r = npc.root.position;
      if (Math.abs(r.x - p.pos[0]) > 1e-3 || Math.abs(r.z - p.pos[2]) > 1e-3) void npc.fadeTo(p.pos, p.yaw, 1.0);
    },
    // 骨骼按姿势摆完之后：本相过场里举底片的右臂（negative.ts）
    update: (_npc, dt) => updateNegative(dt),
  });
  void lu;

  // —— 影棚
  ctx.interactable({
    id: OBJ.R3_TLR, label: TEXT.label.tlr, at: TLR, hit: studio.tlr,
    when: F.R3_GOT_ENVELOPE, blocked: T.tlrBlocked,
    onInteract: g => {
      if (g.state.has(IT.FILM)) return g.feedback(T.tlrEmpty);
      g.give(IT.FILM);
      g.sfx('page_turn');
      g.feedback(T.tlrTake);
    },
  });
  ctx.interactable({ id: OBJ.R3_BIG_CAMERA, label: TEXT.label.bigCamera, at: [0, 1.25, -6.5], hit: studio.bigCamera, onInteract: [E.feedback(T.bigCamera)] });
  ctx.interactable({
    id: OBJ.R3_EASEL, label: TEXT.label.easel, at: EASEL_CANVAS_AT, hit: studio.easel,
    onInteract: g => g.feedback(g.state.flag(F.R3_SAW_TRUE_FORM) ? T.easelEmpty : T.easel),
  });
  // 坐凳：称呼面板自动接线（owner 不写 onInteract，ARCH §6.15）；前置与“本相之后”都用 when/blocked
  ctx.interactable({
    id: OBJ.R3_STOOL, label: TEXT.label.stool, at: [STOOL[0], 0.5, STOOL[2]], hit: studio.stool,
    when: `has(${IT.SLIP_0474}) && !${F.R3_SAW_TRUE_FORM}`,
    blocked: s => (s.flag(F.R3_SAW_TRUE_FORM) ? T.stoolAfter : T.noSlip),
  });
  ctx.naming({
    owner: OBJ.R3_STOOL,
    header: TEXT.naming.header,
    answer: NAME.HUOJI,
    // 选错的反馈是陆师傅说的话（M4：字幕带名字，而不是匿名反馈条）
    wrongWho: NPC.LU,
    wrong: {
      [NAME.ZHOU_SHOUREN]: TEXT.naming.wrong.zhou_shouren,
      [NAME.LAOZHOU]: TEXT.naming.wrong.laozhou,
      [NAME.XIAOZHOU]: TEXT.naming.wrong.xiaozhou,
      [NAME.KANMENDE]: TEXT.naming.wrong.kanmende,
      [NAME.TONGHANG]: TEXT.naming.wrong.tonghang,
    },
    onCorrect: async g => {
      if (g.state.flag(F.R3_SAW_TRUE_FORM)) return;
      // 先写进度，再开过场（ARCH §11.5 第 9 条）；陆师傅留到过场结束
      ctx.setTemp(LU_FAREWELL, true);
      g.markUsed(IT.SLIP_0474);
      g.setFlag(F.R3_SAW_TRUE_FORM);
      g.give(PH.TRUE_FORM);
      g.give(IT.PORTRAIT);
      await g.cutscene(CS_R3.TRUE_FORM);
      // 过场被打断时底片也收起来（播完时过场自己收）
      hideNegative();
      if (!g.cancelled) ctx.setTemp(LU_FAREWELL, false);
    },
  });

  // —— 暗房（M3：引擎的就近聚焦会看墙了，docs/requests/r3.md #5，里面的东西不再靠“人在暗房里”才在场）
  // 门的拾取取整扇门扇（M4 第 2 轮：原来只取 12cm 的门把手，影棚里对着门打不中，就近规则选中了门背后的守则、按 E 打开了守则）；
  // 守则后登记，门扇上那张纸仍归守则
  const darkDoorPos = new THREE.Vector3();
  ctx.interactable({
    id: OBJ.R3_DARKROOM_DOOR, label: TEXT.label.darkroomDoor, at: () => studio.darkDoor.handle.getWorldPosition(darkDoorPos), hit: studio.darkDoor.leaf,
    onInteract: [E.feedback(T.darkroomDoor)],
  });
  const rulesPos = new THREE.Vector3();
  ctx.interactable({
    id: OBJ.R3_DARKROOM_RULES, label: TEXT.label.rules,
    // 锚点在纸面朝暗房里 5cm（门外的眼 → 锚点隔着门扇）；只能拿准星对准它，不参与就近聚焦（M4 第 2 轮：影棚里对着暗房门按 E 打开了守则）
    at: () => studio.rules.localToWorld(rulesPos.set(0, 0, 0.05)), hit: studio.rules, proximityFocus: false,
    // 门背后的守则在文档阅读器里读（GameApi.openDoc / E.doc，M3；docs/requests/r3.md #2）
    onInteract: [E.doc(DOC.DARKROOM_RULES)],
  });
  // 灯绳只能拿准星对准（M4 第 2 轮：原来它也参与就近聚焦、又是 priority 1，第三人称瞄台上的盘子没打中时按 E 拉了灯绳——红灯变白灯，片子瞎了）。
  // priority 1 留着只管射线：从暗房里头瞄灯绳，射线先穿过晾片绳的拾取代理，灯绳要赢它
  ctx.interactable({ id: OBJ.R3_LAMP_CORD, label: TEXT.label.lampCord, at: LAMP_CORD, hit: dark.cordKnob, priority: 1, proximityFocus: false, onInteract: g => pullCord(ctx, g) });
  // 三件容器与水池：hit 组里各有拾取代理（build/darkroom.ts benchProxy），x 按段相接、优先级一样，准星落在哪段台面/后墙上就是哪一件；
  // 挨得近、次序要紧，不参与就近聚焦（M4 第 2 轮：准星没打中时就近规则会选中旁边那件，按 E 就是“次序错了”）
  const container = (id: InteractId, label: string, at: V3, hit: THREE.Object3D, color: string) => ctx.interactable({
    id, label, at: [at[0], at[1] + 0.06, at[2]], hit, proximityFocus: false,
    // 色彩辅助只在白灯下给颜色（GDD §10.4；红灯下现算为 undefined，不绕过 P7）
    colorHint: s => (safelightOn(s) ? undefined : color),
    onInteract: g => developAt(ctx, g, id),
  });
  container(OBJ.R3_TRAY_SQUARE, TEXT.label.traySquare, TRAY_SQUARE, dark.tray, TEXT.colorHint.traySquare);
  container(OBJ.R3_BASIN_XI, TEXT.label.basinXi, BASIN_XI, dark.basin, TEXT.colorHint.basinXi);
  container(OBJ.R3_PLATE_CHIPPED, TEXT.label.plateChipped, PLATE_CHIPPED, dark.plate, TEXT.colorHint.plateChipped);
  // 锚点放在龙头上（第三人称的俯仰限到 -35°，瞄不到池底）；与三件容器同一优先级（M4 第 2 轮：priority 1 让瞄方盘时选中了水池）
  ctx.interactable({ id: OBJ.R3_SINK, label: TEXT.label.sink, at: [SINK[0], 1.12, SINK[2] - 0.12], hit: dark.sink, proximityFocus: false, onInteract: g => developAt(ctx, g, OBJ.R3_SINK) });
  // 锚点在拾取代理的正中（build/darkroom.ts：代理的下沿 1.83m，不罩住取景器的眼睛）
  ctx.interactable({ id: OBJ.R3_DRYING_LINE, label: TEXT.label.dryingLine, at: [FILM_X, DRYING.y - 0.02, DRYING.z], hit: dark.lineProxy, onInteract: g => hangFilm(ctx, g) });
  // 底片四格：拍照主体（不作交互物）
  dark.frames.forEach((f, i) => ctx.ref([OBJ.R3_FILM_FRAME1, OBJ.R3_FILM_FRAME2, OBJ.R3_FILM_FRAME3, OBJ.R3_FILM_FRAME4][i]!, f));

  // —— 红外冷迹（X5）：照相馆玻璃门外凉了一块
  const cold = createColdTrace('standing');
  cold.position.set(COLD_DOOR[0], 0, COLD_DOOR[2]);
  ctx.add(cold, { ref: 'r3.coldTrace' });
  ctx.interactable({
    id: OBJ.R3_COLD_DOOR, label: TEXT.label.cold, at: [COLD_DOOR[0], 1.0, COLD_DOOR[2]], view: 'viewfinder', lens: 'ir',
    onInteract: [E.feedback(T.coldDoor), E.clue(T.coldDoor)],
  });

  syncScene(ctx);
}

// ==================================================================== 每帧

export function updateLogic(ctx: AreaContext, dt: number): void {
  if (!rt) return;
  const g = ctx.game;
  const p = g.player.position;
  const s = ctx.state;
  // 进了照相馆：雨声、车流压低
  const inside = insideShop(p.x, p.z);
  if (inside !== rt.inside) {
    rt.inside = inside;
    const h = ctx.ambienceHandles();
    h[AMB.rain]?.set('gain', inside ? 0.3 : 1, 0.8);
    h[AMB.traffic]?.set('gain', inside ? 0.4 : 1, 0.8);
  }
  rt.rig.rain.update(dt);
  // 半球光跟着镜头走（自由机位、过场也对）：前厅、影棚是钨丝暖色，街上与暗房是冷暗的一档
  const view = rt.rig.street.view;
  if (view.valid) _camPos.copy(view.pos);
  else _camPos.copy(p);
  const warm = insideShop(_camPos.x, _camPos.z) && !insideDarkroom(_camPos.x, _camPos.z) ? 1 : 0;
  const ht = rt.hemiT === null ? warm : THREE.MathUtils.damp(rt.hemiT, warm, 6, dt);
  if (ht !== rt.hemiT) {
    rt.hemiT = ht;
    const h = rt.rig.hemi;
    h.color.set(HEMI.street.sky).lerp(_hemiC.set(HEMI.shop.sky), ht);
    h.groundColor.set(HEMI.street.ground).lerp(_hemiC.set(HEMI.shop.ground), ht);
    h.intensity = (HEMI.street.design + (HEMI.shop.design - HEMI.street.design) * ht) * LIGHT_SCALE.hemi;
  }
  // 人进了影棚深处/暗房（隔墙北边 2m 以外）：整条街隔着隔墙和布帘一眼也看不见，街景整批不画（M4：暗房朝店门看 draw call 249/250）。
  // 只看人的位置（这一帧的，确定）：镜头位置是上一次渲染记下的，锁步下可能是好几步以前的。能用的镜头都跟着人——第三人称在人身边
  // 2.5m 内、撞不出照相馆的墙，取景器就在人眼上，本相过场的机位都在影棚里；截图的自由机位（ShotDef cam）把人留在西口出生点。
  // 为什么是 2m：布帘中间有一道 0.21m 的缝，人贴着西墙站在隔墙北边 1m 以内、举着取景器斜着往东南看，能从缝里瞄见一条玻璃门；
  // 退到 2m 以外，这条视线就撞上西墙了
  const deep = insideShop(p.x, p.z) && p.z < PARTITION.z - STREET_HIDE_MARGIN;
  if (deep !== rt.streetHidden) {
    rt.streetHidden = deep;
    for (const o of rt.rig.street.outdoor) o.visible = !deep;
  }
  // 玻璃门：r3.lu_door_open 后打开（1 秒）
  const want = s.flag(F.R3_LU_DOOR_OPEN) ? 1 : 0;
  if (rt.doorT !== want) {
    rt.doorT = want > rt.doorT ? Math.min(want, rt.doorT + dt) : Math.max(want, rt.doorT - dt);
    rt.rig.shop.door.setOpen(rt.doorT);
  }
  // 暗房门：走近了就开，进去了就关（红灯不漏出去；门背后的守则回到 GDD 的位置）
  const dd = Math.hypot(p.x - DARK.doorX, p.z - DARK.z0);
  const dWant = dd < 1.45 ? 1 : 0;
  if (rt.darkDoorT !== dWant) {
    rt.darkDoorT = dWant > rt.darkDoorT ? Math.min(1, rt.darkDoorT + dt * 1.6) : Math.max(0, rt.darkDoorT - dt * 1.6);
    rt.rig.studio.darkDoor.setOpen(rt.darkDoorT * 0.85);
  }
  // 暗房红灯：人在暗房里时画面压成单红通道（GDD §4.4、§9.2）
  const red = safelightOn(s) && insideDarkroom(p.x, p.z);
  if (red !== rt.monoRed) {
    rt.monoRed = red;
    if (red) g.post.push(POST_KEY, POST_PRESETS.darkroom_red, 0.25);
    else g.post.pop(POST_KEY, 0.25);
  }
  // 霓虹频闪（减少闪光时不闪）
  if (rt.neonOn) {
    const flicker = g.settings.reduceFlash ? 0 : 0.22;
    rt.rig.shop.neon.flicker(flicker);
    rt.flickerT -= dt;
    if (rt.flickerT <= 0) {
      rt.flickerT = 0.05 + Math.random() * 0.25;
      const base = designCandela('point', NEON_LIGHT.design, NEON_LIGHT.distance);
      const k = flicker > 0 && Math.random() < 0.1 ? 0.35 + Math.random() * 0.4 : 1;
      rt.rig.shop.neonLight.intensity = base * k;
    }
  }
}

export function onFlagLogic(ctx: AreaContext): void {
  syncScene(ctx);
}

export function exitLogic(ctx: AreaContext): void {
  if (rt?.monoRed) ctx.game.post.pop(POST_KEY, 0);
  rt = null;
  disposeNegative();
}
