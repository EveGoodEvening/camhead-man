// owner: R4
// R4 的玩法与运行时（GDD §4.5、§4.6、P9–P11、X5）：交互物、NPC（纸扎门童、黄三爷）、读字目标、开市过场、灯管闪烁、开市的变化、纸人晃动。
//
// 进度只由 flags 推导（ARCH §11.5）：
//   子时          空通道，灯管闪，没有门童、没有规矩牌；
//   丑时（未开市） 门童在入口（提着写字的白灯笼），规矩牌挂出来，灯管照闪；
//   开市（r4.ghost_market_open，丑时/寅时/卯时）  灯管全灭，十盏白灯笼 + 头顶两串小灯笼，摊位、纸人摊主、黄三爷、飘着的影子、满地纸钱；
//   开市那一下（在本区写 flag 时）：纸钱撒上半空，灯管一根根熄灭，灯笼一盏盏亮起（MARKET_ANIM_SEC，过场 cs.r4.market_open 看着它）。
// 灯数恒定 8 盏：半球光 1、灯管 3、楼梯口路灯漏光 1、灯笼 3（N3、S3、门童的灯笼，GDD §4.5）；开关只改强度。

import * as THREE from 'three';
import type { AreaContext, AreaDef } from '../../core/area';
import type { V3 } from '../../core/types';
import { DEG2RAD } from '../../core/math';
import { DOC, F, IT, NPC, OBJ, PH, RD, SEG, STALL, type NpcId, type StallId, type ThingId } from '../../data/ids';
import { PALETTE } from '../../data/palette';
import { TEMP_C } from '../../data/render';
import { MATERIALS } from '../../fx/materials';
import type { CutsceneDef } from '../../game/cutscene';
import { E, type GameApi, type Handler } from '../../game/effects';
import type { OfferTable } from '../../game/interaction';
import type { StateView } from '../../game/state';
import { designLight } from '../../kit/lamps';
import { createColdTrace } from '../../kit/residue';
import { createCharacter, type CharacterRig } from '../../rigs/characters';
import { createPaperFigure, type PaperRig } from '../../rigs/paper';
import { HUM_INDEX } from './audio';
import { buildCorridor, type CorridorRig } from './build/corridor';
import { buildMarket, paperSway, type MarketRig } from './build/market';
import { DLG4 } from './dialogue';
import { MARKET_REF, R4L, STALLS, lanternAt, lanternSide } from './layout';
import { TEXT } from './text';

export const CS_MARKET_OPEN = 'cs.r4.market_open';
/** 开市变化的时长（游戏秒）：纸钱撒起 → 灯管一根根灭 → 灯笼一盏盏亮。 */
export const MARKET_ANIM_SEC = 4.6;
/** 摊位纸灯笼的自发光（×贴图；纸面透出字来、灯芯不至于烧成一团白）。 */
const LANTERN_GLOW = 1.05;
const LANTERN_COLOR = new THREE.Color(PALETTE.LANTERN);

/** 开市前后的半球光与雾（GDD §4.5：开市前雾 #0D1512 0.05，开市后 #0A0A12 0.06；半球光按 AGENTS.md look-dev 的建议）。 */
const LOOK_BEFORE = { sky: new THREE.Color('#CFF5E1'), ground: new THREE.Color('#0D1512'), hemi: 0.15, fog: new THREE.Color('#0D1512'), density: 0.05 };
const LOOK_MARKET = { sky: new THREE.Color('#A6D8BC'), ground: new THREE.Color('#0A0A12'), hemi: 0.12, fog: new THREE.Color('#0A0A12'), density: 0.06 };
const HEMI_SCALE = Math.PI;

/** 开市过场（首次不可跳过；固定机位看着灯管熄灭、灯笼亮起，最后门童说话）。 */
export const CUTSCENES: readonly CutsceneDef[] = [
  {
    id: CS_MARKET_OPEN,
    skippable: 'rewatch',
    steps: [
      { cam: { pos: [-19.1, 1.4, 1.75], target: [-8, 1.35, -1.2], fov: 58 }, blend: 0 },
      { sfx: 'paper_money' },
      { wait: MARKET_ANIM_SEC + 0.6 },
      { dialogue: DLG4.boyPaid },
    ],
  },
];

// ———————————————————————————————————————————— 运行时（每次进区域重建）

interface Particle { p: THREE.Vector3; v: THREE.Vector3; spin: THREE.Vector3; rot: THREE.Euler }
interface Runtime {
  ctx: AreaContext;
  corridor: CorridorRig;
  market: MarketRig;
  huang: CharacterRig;
  boy: PaperRig;
  lanternLights: THREE.PointLight[];
  lanternBase: number;
  /** 开市变化的进度 0..1（1 = 完全开市） */
  t: number;
  time: number;
  burst: Particle[];
  burstT: number;
  droppedMask: THREE.Mesh | null;
  unmasked: boolean;
  tubeLevel: number[];
  /** 灯管嗡鸣此刻是否跟着频闪压低了 */
  humDark: boolean;
  /** 上一帧是否在 1997 年的回放里（回到现在时按开市状态复原一次） */
  past: boolean;
}

let rt: Runtime | null = null;

const OPEN = F.R4_GHOST_MARKET_OPEN;
const isOpen = (s: StateView): boolean => s.flag(OPEN);

// ———————————————————————————————————————————— 黄三爷的出示

/** 黄三爷的一句回话：带说话人的字幕（M4：原先走无名反馈条，“那是你，不是我。”读起来像旁白）。 */
const huangSays = (g: GameApi, text: string): void => g.say(text, NPC.HUANG);

function trueFormOrFilm(thing: 'true' | 'film'): Handler {
  return async (g: GameApi) => {
    if (g.state.flag(F.R4_HUANG_ADMITS)) {
      huangSays(g, thing === 'true' ? TEXT.fb.huangNotMe : TEXT.fb.huangWhatShort);
      return;
    }
    // P10 第 1 步：认出“门口那铁脑壳”，否认有录像带（先写 flag 再开对话，ARCH §11.5）
    g.setFlag(F.R4_ASKED_TAPE);
    await g.dialogue(DLG4.huangTrueForm);
  };
}

const showHides: Handler = async g => {
  if (g.state.flag(F.R4_HUANG_ADMITS)) {
    huangSays(g, TEXT.fb.huangHidesOld);
    return;
  }
  // P10 完成：守卫——asked 还没设就先补设，保证 flag 顺序（GDD P10）
  g.setFlag(F.R4_ASKED_TAPE);
  g.setFlag(F.R4_HUANG_ADMITS);
  await g.dialogue(DLG4.huangHides);
};

const showIr: Handler = async g => {
  if (g.state.flag(F.R4_GOT_TAPE)) {
    await g.dialogue(DLG4.huangIdle);
    return;
  }
  if (!g.state.flag(F.R4_HUANG_ADMITS)) {
    // 前置未满足（还没认账；pt.huang_ir 揭面具后就拍得到，M4 第 2 轮）：他认得这是自己，但账没算清，不给带子、不写 flag
    huangSays(g, TEXT.fb.huangIrEarly);
    return;
  }
  // P11 完成：给带子、设 r4.got_tape（进入寅时）、写寅时槽，再开对话
  g.give(IT.TAPE_830);
  g.setFlag(F.R4_GOT_TAPE);
  await g.run([E.save('save.yin')]);
  await g.dialogue(DLG4.huangIr);
};

const showNormal: Handler = async g => {
  if (!g.state.flag(F.R4_HUANG_ADMITS)) {
    huangSays(g, TEXT.fb.huangWhat);
    return;
  }
  await g.dialogue(DLG4.huangNormal);
};

const OLD_PHOTOS = [PH.OLD_1, PH.OLD_2, PH.OLD_3, PH.OLD_4, PH.OLD_5, PH.OLD_6] as const;

function huangOffers(s: StateView): OfferTable | undefined {
  // 看破前没有出示：按 E 直接走 onInteract，与 r4.stall_*（只有主动作）完全相同（ARCH §6.6、§6.7）
  if (!s.flag(F.R4_FOUND_HUANG)) return undefined;
  const accept: Partial<Record<ThingId, Handler>> = {
    [PH.TRUE_FORM]: trueFormOrFilm('true'),
    [PH.FILM3]: trueFormOrFilm('film'),
    [PH.HUANG_HIDES]: showHides,
    [PH.HUANG_IR]: showIr,
    [PH.HUANG_NORMAL]: showNormal,
  };
  for (const id of OLD_PHOTOS) accept[id] = [E.dialogue(DLG4.huangOldPhotos)];
  return {
    accept,
    // 其他东西原样退回，由他开口说（带说话人的字幕；fallback 只能出无名反馈条，所以用 any 并视为已处理）
    any: (_thing, g) => {
      huangSays(g, g.state.flag(F.R4_HUANG_ADMITS) ? TEXT.fb.huangWhatShort : TEXT.fb.huangWhat);
      return true;
    },
  };
}

const huangInteract: Handler = async g => {
  if (!g.state.flag(F.R4_FOUND_HUANG)) {
    // 红外看破是不提示的备选解法（GDD P9），此时不补设 r4.spotted_huang
    const seeThrough = g.state.flag(F.R4_SPOTTED_HUANG) || (g.vf.on && g.vf.lens === 'ir');
    if (!seeThrough) {
      g.feedback(TEXT.fb.paperNoAnswer);
      return;
    }
    g.setFlag(F.R4_FOUND_HUANG);
    // 揭面具的旁白是 dlg.r4.huang_unmasked 的第一行（M4）
    await g.dialogue(DLG4.huangUnmasked);
    return;
  }
  await g.dialogue(DLG4.huangIdle);
};

// ———————————————————————————————————————————— 纸扎门童的买路钱

const payToll: Handler = async g => {
  if (g.state.flag(OPEN)) {
    await g.dialogue(DLG4.boyAgain);
    return;
  }
  // 守卫：丑时才开（门童只在丑时起在场，这里再挡一次）
  if (g.state.shichen === 'zi') {
    g.say(TEXT.fb.notMoney, NPC.BOY);
    return;
  }
  g.markUsed(IT.MONEY);
  g.setFlag(OPEN);
  await g.cutscene(CS_MARKET_OPEN);
};

// ———————————————————————————————————————————— build

function buildNpcs(ctx: AreaContext): { huang: CharacterRig; boy: PaperRig } {
  // 纸扎门童（rig.paper，提写字的白灯笼；灯笼的光由 NpcDef.lights 跟着灯笼走）
  const boy = createPaperFigure({ kind: 'boy', lanternText: TEXT.decor.boyLantern.join('\n') });
  boy.setJitter(0.45);
  // 门童的纸灯笼换成自己亮的材质（与摊位灯笼一样：跟着它的那盏点光不照纸面，否则字被照成一团白），灯光挂在灯笼前下方
  const lanternMesh = boy.root.getObjectByName('boyLantern') as THREE.Mesh | undefined;
  let lightAnchor: THREE.Object3D | string = 'boyLantern';
  if (lanternMesh) {
    const src = lanternMesh.material as THREE.MeshStandardMaterial;
    const glow = new THREE.MeshBasicMaterial({ map: src.map, color: new THREE.Color(PALETTE.LANTERN).multiplyScalar(1.05), side: THREE.DoubleSide });
    glow.userData.tempC = TEMP_C.ghostLantern;
    lanternMesh.material = ctx.track(glow);
    const a = new THREE.Object3D();
    a.name = 'boyLightAnchor';
    a.position.set(0, -0.12, -0.22);
    lanternMesh.add(a);
    lightAnchor = a;
  }
  const boyLight = designLight('point', PALETTE.LANTERN, 0.9, 5);
  boyLight.name = 'r4:boyLantern';
  ctx.light(boyLight, ctx.lightsRoot);
  ctx.npc({
    id: NPC.BOY, rig: boy, yin: false, tempC: TEMP_C.paper,
    placement: s => (s.shichen !== 'zi' ? { pos: R4L.boy.pos, yaw: R4L.boy.yaw } : null),
    lights: [{ light: boyLight, anchor: lightAnchor }],
    interact: {
      label: TEXT.label.boy, anchorY: 0.95, menuVerb: 'use',
      talk: [{ when: `!${OPEN}`, dialogue: DLG4.boyToll }, { dialogue: DLG4.boyAgain }],
      // 别的东西原样退回，门童开口说“这不是钱。”（带说话人的字幕，M4）
      offers: { accept: { [IT.MONEY]: payToll }, any: (_thing, g) => { g.say(TEXT.fb.notMoney, NPC.BOY); return true; } },
    },
  });

  // 黄三爷：戴面具时就是 S3 的纸扎摊主（同 seed，createCharacter 内部直接用 createPaperFigure，ARCH §5.3）
  const s3 = STALLS.find(s => s.id === NPC.HUANG);
  const huang = createCharacter('huang', { seed: s3?.seed ?? 3 });
  ctx.npc({
    id: NPC.HUANG, rig: huang, yin: false, tempC: TEMP_C.huang,
    placement: s => (isOpen(s) && s3 ? { pos: s3.pos, yaw: s3.yaw } : null),
    interact: {
      label: s => (s.flag(F.R4_FOUND_HUANG) ? TEXT.label.huang : TEXT.label.paper),
      menuVerb: 'show',
      onInteract: huangInteract,
      offers: huangOffers,
    },
  });
  // 面具的破绽只在取景器 ≥4×、≤5m 时换上的高清脸贴图里（ARCH §5.3）
  if (huang.hdFace) ctx.hdText(huang.hdFace.mesh, huang.hdFace.lo, huang.hdFace.hi, { minZoom: 4, maxDist: 5 });
  return { huang, boy };
}

function buildInteractables(ctx: AreaContext, market: MarketRig, corridor: CorridorRig): void {
  // 九个纸人摊主：角标、交互流程与看破前的黄三爷完全一致（GDD §10.2）
  for (const slot of STALLS) {
    if (slot.id === NPC.HUANG) continue;
    const id = slot.id as StallId;
    const hit = market.hits.get(id);
    ctx.interactable({
      id, label: TEXT.label.paper, at: [slot.pos[0], 1.2, slot.pos[2]], menuVerb: 'show',
      ...(hit ? { hit } : {}),
      present: OPEN,
      onInteract: [E.feedback(TEXT.fb.paperNoAnswer)],
    });
  }
  // 规矩牌（丑时起挂出来）：在文档阅读器里读 doc.market_rules（GameApi.openDoc / E.doc，M3；docs/requests/r4.md #1）
  ctx.interactable({
    id: OBJ.R4_RULES_BOARD, label: TEXT.label.rulesBoard, at: R4L.rulesBoard, hit: corridor.rulesBoard,
    present: 'shichen != zi',
    onInteract: [E.doc(DOC.MARKET_RULES)],
  });
  ctx.interactable({
    id: OBJ.R4_KIOSK, label: TEXT.label.kiosk, at: [R4L.kiosk[0], 1.35, R4L.kiosk[2] + 0.8],
    onInteract: [E.feedback(TEXT.fb.kiosk)],
  });
  ctx.interactable({
    id: OBJ.R4_CAMPHOR_CHEST, label: TEXT.label.chest, at: [R4L.chest.pos[0], 0.65, R4L.chest.pos[2]], hit: market.chest,
    present: OPEN,
    onInteract: [E.feedback(TEXT.fb.chest)],
  });
  // 旧书平摊在桌上，第三人称的俯仰到 -35° 为止，准星够不着那么低：拾取代理往上垫高一截（不渲染；
  // 它的优先级 -1 低于黄三爷，射线同时穿过二者时仍聚焦黄三爷）。锚点在书面上方 5cm（M3：interact 的转向现在正好瞄准锚点，
  // 锚点抬到代理中部时射线越过书面、在碰到桌面之前先扫到桌后黄三爷的拾取体；瞄书面时射线穿过代理后落在书上，终止聚焦搜索）
  const bookAt = market.oldBook.position;
  const bookHit = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.44, 0.32), MATERIALS.hitProxy());
  bookHit.position.set(bookAt.x, bookAt.y + 0.2, bookAt.z);
  bookHit.name = 'hit:r4.old_book';
  ctx.add(bookHit, { parent: market.group });
  ctx.interactable({
    id: OBJ.R4_OLD_BOOK, label: TEXT.label.oldBook, at: [bookAt.x, bookAt.y + 0.05, bookAt.z], hit: bookHit,
    present: OPEN, priority: -1,
    onInteract: [E.doc(DOC.OLD_BOOK)],
  });
  // X5 红外冷迹：只在红外取景器里看得见、聚焦得到（GDD §8.9）
  const cold = createColdTrace('standing');
  cold.position.set(...R4L.coldStairs);
  cold.rotation.y = -150 * DEG2RAD;
  ctx.add(cold);
  ctx.interactable({
    id: OBJ.R4_COLD_STAIRS, label: TEXT.label.coldStairs, at: [R4L.coldStairs[0], 1.0, R4L.coldStairs[2]], hit: cold,
    view: 'viewfinder', lens: 'ir',
    onInteract: [E.clue(TEXT.fb.coldStairs), E.feedback(TEXT.fb.coldStairs)],
  });
}

/** rd.huang_breath：跟着黄三爷的嘴走（GDD §7.3）；倍率不够不给任何提示（tooSmall:null，否则只有 S3 冒提示，等于泄题）。 */
function buildReadTarget(ctx: AreaContext, huang: CharacterRig): void {
  const mouth = huang.anchors.mouth ?? huang.anchors.head;
  ctx.readTarget({
    id: RD.HUANG_BREATH,
    at: () => mouth.getWorldPosition(new THREE.Vector3()),
    maxDist: 5, minZoom: 4, lens: 'normal',
    when: 'r4.ghost_market_open && !r4.found_huang',
    text: TEXT.read.huangBreath,
    tooSmall: null,
    onRead: [E.flag(F.R4_SPOTTED_HUANG), E.clue(TEXT.clue.spotted)],
  });
}

/** 开市后挡人的摊位（两排矮桌，高 0.9m：挡脚不挡视线）。 */
function buildColliders(ctx: AreaContext): void {
  const T = R4L.table;
  const inner = Math.abs(R4L.rowZ.n) - T.gap - T.d / 2;
  const depth = R4L.hall.z1 - inner;
  const zc = inner + depth / 2;
  const span = (xs: number[]): [number, number] => [Math.min(...xs) - T.w / 2 - 0.1, Math.max(...xs) + T.w / 2 + 0.1];
  const [n0, n1] = span(STALLS.filter(s => s.row === 'n').map(s => s.pos[0]));
  const [s0, s1] = span(STALLS.filter(s => s.row === 's').map(s => s.pos[0]));
  // seeThrough：矮桌挡脚不挡视线（对摊主、旧书、樟木箱的交互视线检查不被桌子挡住，ARCH §4.8）
  ctx.collider.dynamic('r4_stalls_n', { box: { center: [(n0 + n1) / 2, 0.45, -zc], size: [n1 - n0, 0.9, depth] } }, OPEN, { seeThrough: true });
  ctx.collider.dynamic('r4_stalls_s', { box: { center: [(s0 + s1) / 2, 0.45, zc], size: [s1 - s0, 0.9, depth] } }, OPEN, { seeThrough: true });
}

export function buildR4(ctx: AreaContext): void {
  ctx.background('#050706');
  ctx.fog(LOOK_BEFORE.fog, LOOK_BEFORE.density);
  const corridor = buildCorridor(ctx);
  const market = buildMarket(ctx);
  ctx.ref(MARKET_REF, market.group);
  const lanternLights: THREE.PointLight[] = [];
  for (const id of [STALL.R4_STALL_N3, NPC.HUANG] as (StallId | NpcId)[]) {
    const slot = STALLS.find(s => s.id === id);
    if (!slot) continue;
    const p = lanternAt(slot);
    const l = designLight('point', PALETTE.LANTERN, 0.9, 5) as THREE.PointLight;
    l.name = 'r4:lanternLight';
    // 点光放在灯笼靠过道、靠外的一侧：照亮摊主的纸脸与摊桌，又不把脸照爆（离脸约 0.75m）
    const aisle = slot.row === 'n' ? 1 : -1;
    const side = lanternSide(slot);
    l.position.set(p[0] + side * 0.06, p[1] + 0.06, p[2] + aisle * 0.15);
    ctx.light(l);
    lanternLights.push(l);
  }
  const { huang, boy } = buildNpcs(ctx);
  buildInteractables(ctx, market, corridor);
  buildReadTarget(ctx, huang);
  buildColliders(ctx);
  rt = {
    ctx, corridor, market, huang, boy, lanternLights, lanternBase: lanternLights[0]?.intensity ?? 0,
    t: isOpen(ctx.state) ? 1 : 0, time: 0, burst: [], burstT: 0, droppedMask: null, unmasked: false,
    tubeLevel: corridor.tubes.xs.map(() => 1), humDark: false, past: false,
  };
  applyStatic(rt);
  applyMarket(rt, rt.t);
  if (ctx.state.flag(F.R4_FOUND_HUANG)) unmask(rt, false);
}

// ———————————————————————————————————————————— 状态 → 画面

/** 与时辰有关、与开市动画无关的部分（规矩牌）。 */
function applyStatic(r: Runtime): void {
  r.corridor.rulesBoard.visible = r.ctx.state.shichen !== 'zi';
}

const smooth = (a: number, b: number, t: number): number => {
  const k = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** 开市进度 t（0..1）→ 灯管、灯笼、雾、半球光。 */
function applyMarket(r: Runtime, t: number): void {
  const open = isOpen(r.ctx.state);
  r.market.group.visible = open;
  const tubes = r.corridor.tubes;
  // 灯管从西往东一根根熄灭（t 0.06 → 0.45）
  const n = tubes.xs.length;
  for (let i = 0; i < n; i++) r.tubeLevel[i] = 1 - smooth(0.06 + (i / n) * 0.36, 0.08 + (i / n) * 0.36, open ? t : 0);
  // 灯笼从西往东一盏盏亮起（t 0.5 → 0.92）
  const L = r.market.lanterns;
  L.forEach((l, i) => {
    const k = open ? smooth(0.5 + (i / L.length) * 0.4, 0.54 + (i / L.length) * 0.4, t) : 0;
    l.mat.color.copy(LANTERN_COLOR).multiplyScalar(LANTERN_GLOW * k);
  });
  const lampK = (x: number) => {
    const i = L.findIndex(l => Math.abs(l.x - x) < 0.8);
    return i < 0 ? 0 : open ? smooth(0.5 + (i / L.length) * 0.4, 0.54 + (i / L.length) * 0.4, t) : 0;
  };
  r.lanternLights.forEach(l => {
    l.intensity = r.lanternBase * lampK(l.position.x);
  });
  const arr = r.market.array;
  arr.count = open ? Math.round(smooth(0.5, 0.95, t) * r.market.arrayBase.length) : 0;
  for (const m of r.market.glowMats) m.opacity = open ? smooth(0.5, 0.95, t) : 0;
  // 半球光与雾
  const k = open ? smooth(0.2, 0.9, t) : 0;
  const hemi = r.corridor.hemi;
  hemi.color.copy(LOOK_BEFORE.sky).lerp(LOOK_MARKET.sky, k);
  hemi.groundColor.copy(LOOK_BEFORE.ground).lerp(LOOK_MARKET.ground, k);
  hemi.intensity = (LOOK_BEFORE.hemi + (LOOK_MARKET.hemi - LOOK_BEFORE.hemi) * k) * HEMI_SCALE;
  const fog = r.ctx.scene.fog as THREE.FogExp2 | null;
  if (fog) {
    fog.color.copy(LOOK_BEFORE.fog).lerp(LOOK_MARKET.fog, k);
    fog.density = LOOK_BEFORE.density + (LOOK_MARKET.density - LOOK_BEFORE.density) * k;
  }
  r.corridor.tubes.mat.userData.tempC = open && t > 0.5 ? TEMP_C.ambient : TEMP_C.lamp;
  // 开市后（或开市动画里）灯管不再闪：按熄灭进度直接写颜色与灯管的三盏真实光
  if (open) setTubes(r, i => ((tubes.kind[i] ?? 0) === 2 ? 0.04 : 1) * (r.tubeLevel[i] ?? 1));
}

/** 1997 年的通道（回放 seg.mid_1997 期间每帧）：灯管全亮不闪（坏的那几根那会儿还是好的），灯笼的光没有，半球光与雾回到开市前。 */
function applyPast(r: Runtime): void {
  setTubes(r, () => 1);
  r.corridor.tubes.mat.userData.tempC = TEMP_C.lamp;
  for (const l of r.lanternLights) l.intensity = 0;
  const hemi = r.corridor.hemi;
  hemi.color.copy(LOOK_BEFORE.sky);
  hemi.groundColor.copy(LOOK_BEFORE.ground);
  hemi.intensity = LOOK_BEFORE.hemi * HEMI_SCALE;
  const fog = r.ctx.scene.fog as THREE.FogExp2 | null;
  if (fog) {
    fog.color.copy(LOOK_BEFORE.fog);
    fog.density = LOOK_BEFORE.density;
  }
}

/** 按每根灯管的亮度（0..1）写实例颜色与顶板柔光，三盏真实光（聚光）跟着离它最近的好灯管。 */
function setTubes(r: Runtime, level: (i: number) => number): void {
  const tubes = r.corridor.tubes;
  const levels: number[] = [];
  for (let i = 0; i < tubes.xs.length; i++) {
    const v = level(i);
    levels.push(v);
    const c = Math.max(0.03, v);
    for (const k of [0, 1]) tubes.mesh.setColorAt(i * 2 + k, _c.setRGB(c, c, c));
    tubes.glow.setColorAt(i, _c.setRGB(v, v, v));
  }
  if (tubes.mesh.instanceColor) tubes.mesh.instanceColor.needsUpdate = true;
  if (tubes.glow.instanceColor) tubes.glow.instanceColor.needsUpdate = true;
  tubes.lights.forEach((l, j) => {
    const lx = l.position.x;
    let best = 0, bd = Infinity;
    tubes.xs.forEach((x, i) => {
      const d = Math.abs(x - lx) + ((tubes.kind[i] ?? 0) === 2 ? 99 : 0);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    l.intensity = (tubes.base[j] ?? 0) * (levels[best] ?? 1);
  });
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();

/** 灯管：常亮的偶尔暗一下，闪的那几根时不时灭一下、跳两下；坏的不亮。减少闪光时一律常亮（GDD §9.2、§10.4）。 */
function updateTubes(r: Runtime): void {
  const tubes = r.corridor.tubes;
  const calm = r.ctx.game.settings.reduceFlash;
  let dark = false;
  setTubes(r, i => {
    const kind = tubes.kind[i] ?? 0;
    let v = kind === 2 ? 0.04 : 1;
    // 纯视觉的每帧抖动（ARCH §1.5 允许 Math.random）
    if (kind === 1 && !calm) {
      const x = Math.random();
      v = x < 0.12 ? 0.08 : x < 0.2 ? 0.45 : 1;
      if (v < 0.2) dark = true;
    } else if (kind === 0 && !calm && Math.random() < 0.004) v = 0.6;
    return v * (r.tubeLevel[i] ?? 1);
  });
  // 灯管 120Hz 嗡鸣跟着频闪断一下（GDD §9.5）；只在状态变化时写参数
  if (dark !== r.humDark) {
    r.humDark = dark;
    r.ctx.ambienceHandles()[HUM_INDEX]?.set('on', dark ? 0.3 : 1, 0.02);
  }
}

function updateMarketLife(r: Runtime, dt: number): void {
  const t = r.time;
  const M = r.market;
  // 纸人摊主（实例化）与伪装的黄三爷：同一套晃法
  M.vendorSlots.forEach((slot, i) => {
    const sw = paperSway(t, M.vendorPhase[i] ?? 0);
    _q.setFromEuler(_e.set(sw.pitch, -slot.yaw * DEG2RAD + sw.yaw, sw.roll, 'YXZ'));
    M.vendors.setMatrixAt(i, _m.compose(_p.set(slot.pos[0], slot.pos[1], slot.pos[2]), _q, _s));
  });
  M.vendors.instanceMatrix.needsUpdate = true;
  if (!r.unmasked) {
    const sw = paperSway(t, M.huangPhase);
    const masked = r.huang.props['masked'];
    if (masked) masked.rotation.set(sw.pitch, sw.yaw, sw.roll, 'YXZ');
  }
  // 灯笼轻轻打转、摆
  for (const l of M.lanterns) {
    l.pivot.rotation.z = 0.035 * Math.sin(t * 0.9 + l.phase);
    l.pivot.rotation.x = 0.025 * Math.sin(t * 0.7 + l.phase * 1.3);
  }
  M.arrayBase.forEach((b, i) => {
    _p.setFromMatrixPosition(b);
    const ph = i * 0.7;
    _q.setFromEuler(_e.set(0.05 * Math.sin(t * 0.8 + ph), t * 0.15 + ph, 0.05 * Math.sin(t * 0.6 + ph)));
    M.array.setMatrixAt(i, _m.compose(_p, _q, _s));
  });
  M.array.instanceMatrix.needsUpdate = true;
  // 白纸幡：绕挂点轻轻打转、前后摆（地下通道里有一口一口的穿堂风）
  M.streamerBase.forEach((b, i) => {
    const ph = M.streamerPhase[i] ?? 0;
    _m2.compose(_p.set(0, 0, 0), _q.setFromEuler(_e.set(0.09 * Math.sin(t * 0.8 + ph), 0.35 * Math.sin(t * 0.3 + ph * 1.3), 0.06 * Math.sin(t * 1.1 + ph))), _s);
    M.streamers.setMatrixAt(i, _m.multiplyMatrices(b, _m2));
  });
  M.streamers.instanceMatrix.needsUpdate = true;
  // 从顶上慢慢飘下来的纸钱（位置只由时间算，截图可复现）
  M.driftSeeds.forEach((d, i) => {
    const H = R4L.hall.h - 0.3;
    const y = H - ((t * d.speed + d.off) % H);
    _p.set(d.x + 0.25 * Math.sin(t * 0.7 + d.off), y, d.z + 0.18 * Math.sin(t * 0.5 + d.off * 1.3));
    _q.setFromEuler(_e.set(t * d.spin + d.off, t * d.spin * 0.7, 0.4 * Math.sin(t + d.off)));
    M.drift.setMatrixAt(i, _m.compose(_p, _q, _s));
  });
  M.drift.instanceMatrix.needsUpdate = true;
  // 鬼市口的布幡：穿堂风里前后轻轻摆
  M.banner.rotation.z = 0.05 * Math.sin(t * 0.6) + 0.02 * Math.sin(t * 1.7);
  // 贴地薄雾慢慢往东漂
  M.mist.forEach((m, i) => {
    m.offset.x = (t * (i ? -0.006 : 0.009)) % 1;
    m.offset.y = 0.05 * Math.sin(t * 0.13 + i);
  });
  // 飘着的影子：沿过道来回慢慢荡，上下浮
  for (const s of M.shadows) {
    s.mesh.position.set(s.x0 + s.amp * Math.sin(t * s.speed + s.phase), 0.12 + 0.05 * Math.sin(t * 0.9 + s.phase), s.z + 0.15 * Math.sin(t * s.speed * 1.7 + s.phase));
    s.floor.position.set(s.mesh.position.x, 0.016, s.mesh.position.z);
  }
  // 撒上半空的纸钱
  if (r.burst.length > 0) {
    r.burstT += dt;
    const g = 0.9;
    r.burst.forEach((pt, i) => {
      pt.v.y -= g * dt;
      pt.v.multiplyScalar(Math.pow(0.55, dt));
      pt.v.y = Math.max(pt.v.y, -0.55);
      pt.p.addScaledVector(pt.v, dt);
      pt.p.x += Math.sin(r.burstT * 3 + i) * 0.12 * dt;
      if (pt.p.y < 0.01) {
        pt.p.y = 0.01;
        pt.v.set(0, 0, 0);
      } else {
        pt.rot.x += pt.spin.x * dt;
        pt.rot.y += pt.spin.y * dt;
        pt.rot.z += pt.spin.z * dt;
      }
      M.burst.setMatrixAt(i, _m.compose(pt.p, _q.setFromEuler(pt.rot), _s));
    });
    M.burst.count = r.burst.length;
    M.burst.instanceMatrix.needsUpdate = true;
    if (r.burstT > 9) {
      r.burst = [];
      M.burst.count = 0;
    }
  }
}

function startBurst(r: Runtime): void {
  const from = new THREE.Vector3(R4L.boy.pos[0] + 0.35, 0.9, R4L.boy.pos[2] - 0.2);
  r.burst = [];
  r.burstT = 0;
  for (let i = 0; i < r.market.burst.instanceMatrix.count; i++) {
    const a = Math.random() * Math.PI * 2;
    r.burst.push({
      p: from.clone(),
      v: new THREE.Vector3(1.2 + Math.random() * 3.4, 2.4 + Math.random() * 1.6, Math.sin(a) * 1.1),
      spin: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9),
      rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
    });
  }
}

/** 揭面具：换成 man/weasel 两个变体（肉眼 man、取景器常光 weasel、红外 man），摊上留下那张潮乎乎的面具。 */
function unmask(r: Runtime, animate: boolean): void {
  if (r.unmasked) return;
  r.unmasked = true;
  const h = r.huang;
  h.setVariant?.('man');
  const man = h.props['man'], weasel = h.props['weasel'];
  if (man && weasel) r.ctx.viewVariant({ naked: man, vf: weasel, ir: man });
  const mask = h.props['mask'] as THREE.Mesh | undefined;
  if (mask && !r.droppedMask) {
    const geo = mask.geometry.clone();
    geo.computeBoundingBox();
    const c = geo.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
    geo.translate(-c.x, -c.y, -c.z);
    const m = new THREE.Mesh(geo, mask.material);
    m.name = 'r4:droppedMask';
    const s3 = STALLS.find(s => s.id === NPC.HUANG);
    // 揭下来的面具扔在桌子东头靠里（旧书在东头靠过道）
    const p: V3 = s3 ? [s3.pos[0] + 0.48, R4L.table.h + 0.02, s3.pos[2] - R4L.table.gap + 0.12] : [3.48, 0.68, 1.7];
    m.position.set(p[0], p[1], p[2]);
    m.rotation.set(-Math.PI / 2, 0, 0.5);
    r.ctx.add(m, { parent: r.market.group, tempC: TEMP_C.paper });
    r.droppedMask = m;
  }
  void animate;
}

// ———————————————————————————————————————————— 生命周期钩子（index.ts 接到 AreaDef 上）

export const r4Update: NonNullable<AreaDef['update']> = (_ctx, dt) => {
  const r = rt;
  if (!r) return;
  r.time += dt;
  const open = isOpen(r.ctx.state);
  // 倒带到 1997 年开通剪彩：灯管是新的、全亮；鬼市还没有（摊位整组由片段的 hideWorld 隐去）
  const past = r.ctx.game.replay.active?.seg === SEG.MID_1997;
  if (past) {
    applyPast(r);
  } else {
    if (open && r.t < 1) r.t = Math.min(1, r.t + dt / MARKET_ANIM_SEC);
    if (r.past || (open && r.t < 1)) applyMarket(r, r.t);
    if (!open) updateTubes(r);
  }
  r.past = past;
  if (open) updateMarketLife(r, dt);
  // 围挡顶上的黄闪灯：一秒一闪
  const on = r.ctx.game.settings.reduceFlash || Math.floor(r.time * 1.25) % 2 === 0;
  r.corridor.warn.color.setRGB(1, 0.69, 0.13).multiplyScalar(on ? 3 : 0.25);
};

export const r4OnFlag: NonNullable<AreaDef['onFlag']> = (_ctx, e) => {
  const r = rt;
  if (!r) return;
  if (e.id === OPEN) {
    // 在本区付了买路钱：从 0 开始放开市的变化（过场看着它）；纸钱撒起来
    r.t = 0;
    applyMarket(r, 0);
    startBurst(r);
  }
  if (e.id === F.R4_FOUND_HUANG) unmask(r, true);
  applyStatic(r);
};

export const r4OnExit: NonNullable<AreaDef['onExit']> = () => {
  rt = null;
  // 黄鼠狼头的胡须（LineSegments）由引擎的人偶 dispose() 释放（M3，docs/requests/r4.md #5），这里不再自己释放
};
