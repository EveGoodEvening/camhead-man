// owner: WP4
// WP4 在开发沙盒里的测试夹具（ARCH §15.2 “沙盒要包含的夹具”）与页面内自测（registerSelftest('wp4.<snake>', fn)）。
// scripts/selftest/wp4.mjs 在 node 里用假 Game 跑同一批自测函数（WP4_TESTS），并经 __game.selftest(name)（?debug=1&area=dev）跑页面内版本。
//
// 夹具（以 WP4_ORIGIN 为基准，沙盒北侧中间 x≈-3…4、z≈-11…-4；避开 WP7 的出生点 (0,0,8)、look-dev (8,0,8)、北出口 (0,-14)、
// WP5 的西半边（x ≤ -4.5）与 WP1/WP3 的东北角（x ≥ 7）。夹具都不加碰撞体，不挡别的 WP 的走路测试）。用到的 id 都是 GDD 真 id（类型要求），只在 dev 区域里这样用：
//   r4.rules_board  带 when/blocked 的交互物（when r4.ghost_market_open）
//   npc.wang        带对话树（含选项、自动“（先这样）”）的 NPC；offers：it.wonton 被接受，其余 fallback
//   npc.boy         阴物 NPC（view:'viewfinder'、revealOnVfInteract、wrongView）
//   r2.stairs       强制对话 dlg.dev.wp4_forced（二选一，没有“（先这样）”）
//   r1.drawer       密码锁 0618（连错 3 次写线索）
//   r3.stool        称呼面板（正解 name.huoji）
//   r3.darkroom_door + npc.lu   一扇玻璃（noOcclude）前的门把手（priority 0）与玻璃后的高优先级 NPC（priority 2、range 6）
// 对话 dlg.dev.wp4_*、过场 cs.dev.wp4_* 供自测与 core.mjs 用。自测尽量自带临时对象并在结束时清理；改状态的自测用 snapshot/restore 包住。

import * as THREE from 'three';
import type { AreaContext, AreaPart } from '../../core/area';
import type { AreaId, V3 } from '../../core/types';
import type { Game } from '../../core/game';
import type { GameEvents } from '../../core/events';
import { EventBus } from '../../core/events';
import { DOC, F, IT, NAME, NPC, OBJ, PH, PZ, RD, SPAWN } from '../../data/ids';
import type { FlagId, InteractId } from '../../data/ids';
import { STRINGS } from '../../data/strings';
import { registerSelftest } from '../../debug/selftest';
import type { SelftestResult } from '../../debug/selftest';
import { E, EffectRunner, createGameApi } from '../../game/effects';
import { defineDialogues, seq } from '../../game/dialogue';
import type { CutsceneDef } from '../../game/cutscene';
import { parseCond } from '../../game/expr';
import type { StateView } from '../../game/state';
import { GameState } from '../../game/state';
import { SAVE_KEYS, SaveSystem } from '../../game/save';
import { DEFAULT_SETTINGS, coerceSetting, loadSettings } from '../../game/settings';
import type { Settings } from '../../game/settings';
import { ShichenSystem } from '../../game/shichen';
import { JournalSystem, COVER_MASK } from '../../game/journal';
import { HintSystem } from '../../game/hints';
import type { PuzzleDef } from '../../game/hints';
import type { AlbumArg, InteractableHandle } from '../../game/interaction';
import type { AlbumMode } from '../../game/modes/album';

// ==================================================================== 坐标与夹具 id

/** 夹具基准点（M1c 若与别的 WP 的夹具重叠，只改这里）。 */
export const WP4_ORIGIN: V3 = [0.5, 0, -6.5];
const at = (dx: number, y: number, dz: number): V3 => [WP4_ORIGIN[0] + dx, y, WP4_ORIGIN[2] + dz];

/** 夹具 id（WP7 的 core.mjs 与 M1c 用）。 */
export const WP4_FIX = {
  blocked: OBJ.R4_RULES_BOARD,
  treeNpc: NPC.WANG,
  yinNpc: NPC.BOY,
  forced: OBJ.R2_STAIRS,
  codeLock: OBJ.R1_DRAWER,
  naming: OBJ.R3_STOOL,
  glassHandle: OBJ.R3_DARKROOM_DOOR,
  glassNpc: NPC.LU,
  code: '0618',
} as const;

/** 夹具位置（世界坐标）。 */
export const WP4_POS = {
  blocked: at(-3, 1.2, -4),
  treeNpc: at(-1, 0, -4),
  yinNpc: at(1, 0, -4),
  forced: at(3, 1, -4),
  codeLock: at(-3, 0.8, 2),
  naming: at(-1, 0.45, 2),
  glass: at(3, 1.2, 1),
  glassHandle: at(2.6, 1.05, 1.05),
  glassNpc: at(3, 0, -0.5),
} as const;

/** 自测临时登记、结束即 remove 的交互物 id（别的 WP 的 dev 夹具都没用到这两个）。 */
const TMP_A: InteractId = OBJ.R2_MAILBOXES;
const TMP_B: InteractId = OBJ.R2_DONATION_BOARD;

/** 自测用的 seen 标记键（自由字符串，不是游戏 id）。 */
const K = (s: string): string => `wp4.test.${s}`;

// ==================================================================== 对话与过场

const DLG_LINE = 'dlg.dev.wp4_line';
const DLG_TREE = 'dlg.dev.wp4_tree';
const DLG_FORCED = 'dlg.dev.wp4_forced';
const DLG_OUTER = 'dlg.dev.wp4_outer';
const DLG_INNER = 'dlg.dev.wp4_inner';
const CS_MID = 'cs.dev.wp4_mid';
const CS_FX = 'cs.dev.wp4_fx';
const CS_AWAIT = 'cs.dev.wp4_await';

export const WP4_DIALOGUES = defineDialogues('dev', {
  [DLG_LINE]: seq([[NPC.WANG, '第一句'], ['', '第二句']]),
  [DLG_TREE]: {
    start: 'hi',
    nodes: {
      hi: { who: NPC.WANG, text: s => `（沙盒）树底下 ${s.antCount()}/6。`, next: 'ask' },
      ask: {
        type: 'choice', who: NPC.WANG, text: '问点啥？',
        options: [
          { label: '甲', next: 'a' },
          { label: '乙（门灯亮了才有）', next: 'b', when: F.R1_GATE_LAMP_ON },
          { label: '丙', next: 'end', effects: [E.seen(K('tree.c'))] },
        ],
      },
      a: { who: NPC.WANG, text: '说了甲。', next: 'ask' },
      b: { who: NPC.WANG, text: '说了乙。', next: 'ask' },
      end: { type: 'end' },
    },
  },
  [DLG_FORCED]: {
    forced: true,
    start: 'q',
    nodes: {
      q: {
        type: 'choice', who: '', text: s => `（沙盒）确认吗？树底下 ${s.antCount()}/6。`,
        options: [
          { label: '装回去', next: 'end', effects: [E.seen(K('forced.yes'))] },
          { label: '再等等', next: 'end' },
        ],
      },
      end: { type: 'end' },
    },
  },
  [DLG_OUTER]: {
    start: 'l0',
    nodes: {
      l0: { who: NPC.WANG, text: '外层开始', next: 'cs' },
      cs: { type: 'do', effects: [E.cutscene(CS_MID)], next: 'l1' },
      l1: { who: NPC.WANG, text: '外层继续', next: 'end' },
      end: { type: 'end', effects: [E.seen(K('outer.end'))] },
    },
  },
  [DLG_INNER]: seq([['', '内层']], [E.seen(K('inner.end'))]),
});

export const WP4_CUTSCENES: CutsceneDef[] = [
  { id: CS_MID, steps: [{ wait: 0.5 }, { dialogue: DLG_INNER }, { effects: [E.seen(K('mid.after'))] }] },
  {
    id: CS_FX,
    steps: [
      { osd: t => `CH1 沙盒 ${t.toFixed(1)}` },
      { wait: 1 },
      { effects: [E.item(IT.BULB), E.flag(F.R1_GATE_LAMP_ON), E.seen(K('fx.a'))] },
      { say: '（沙盒）过场字幕', dur: 0.5 },
      { effects: g => { g.clue('（沙盒）过场线索'); } },
      { wait: 1 },
      { effects: [E.seen(K('fx.b'))] },
    ],
  },
  { id: CS_AWAIT, skippable: 'never', steps: [{ wait: 0.2 }, { await: 'shutter', prompt: STRINGS.tutorial.wake, early: '天还黑着。' }, { effects: [E.seen(K('await.done'))] }] },
];

// ==================================================================== 夹具建造

function box(size: V3, pos: V3, color: THREE.ColorRepresentation): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  m.position.set(pos[0], pos[1], pos[2]);
  return m;
}

/** 简易人形（NPC 夹具不依赖 WP2 的角色工厂）。 */
function dummy(color: THREE.ColorRepresentation, h = 1.6): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.45, h * 0.75, 0.3), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  body.position.y = h * 0.375;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshStandardMaterial({ color: '#d8c8a8', roughness: 0.9 }));
  head.position.y = h * 0.75 + 0.14;
  g.add(body, head);
  return g;
}

function buildFixtures(ctx: AreaContext): void {
  // 带 when/blocked 的交互物
  ctx.add(box([0.8, 1.2, 0.1], WP4_POS.blocked, '#556070'));
  ctx.interactable({
    id: WP4_FIX.blocked, label: '告示牌', at: WP4_POS.blocked,
    when: F.R4_GHOST_MARKET_OPEN, blocked: '（沙盒）还没到时候。',
    onInteract: [E.feedback('（沙盒）告示牌上写着规矩。')],
  });
  // 带对话树的 NPC（含选项）；offers：馄饨被接受
  ctx.npc({
    id: WP4_FIX.treeNpc, rig: dummy('#6a5a8a', 1.5), yin: false,
    placement: () => ({ pos: WP4_POS.treeNpc, yaw: 180 }),
    interact: {
      label: '王奶奶', talk: [{ dialogue: DLG_TREE }],
      offers: { accept: { [IT.WONTON]: [E.used(IT.WONTON), E.feedback('（沙盒）她接过了馄饨。')] }, fallback: '（沙盒）她摇摇头。' },
    },
  });
  // 阴物 NPC：只在取景器里可交互，交互后常显
  ctx.npc({
    id: WP4_FIX.yinNpc, rig: dummy('#8FD3D6', 1.2), yin: true, tempC: 6,
    placement: () => ({ pos: WP4_POS.yinNpc, yaw: 180 }),
    interact: {
      label: '纸人', view: 'viewfinder', revealOnVfInteract: true, wrongView: '（沙盒）纸人没有回答。它的嘴是画上去的。',
      talk: [{ dialogue: DLG_LINE }],
    },
  });
  // 强制对话（二选一）
  ctx.add(box([0.6, 1, 0.6], WP4_POS.forced, '#7a6a50'));
  ctx.interactable({ id: WP4_FIX.forced, label: '楼梯', at: WP4_POS.forced, onInteract: [E.dialogue(DLG_FORCED)] });
  // 密码锁（owner 没有 onInteract：主动作自动打开面板）
  ctx.add(box([0.6, 0.3, 0.5], WP4_POS.codeLock, '#5a4632'));
  ctx.interactable({ id: WP4_FIX.codeLock, label: '抽屉', at: WP4_POS.codeLock });
  ctx.codeLock({
    owner: WP4_FIX.codeLock, digits: 4, answer: WP4_FIX.code, title: '（沙盒）转轮锁',
    failText: '锁纹丝不动。', failClue: { after: 3, text: '（沙盒）抽屉的号在伙计脑门上。' },
    onSuccess: [E.seen(K('drawer.open')), E.feedback('（沙盒）抽屉开了。')],
  });
  // 称呼面板
  ctx.add(box([0.4, 0.45, 0.4], [WP4_POS.naming[0], 0.225, WP4_POS.naming[2]], '#7a5a3a'));
  ctx.interactable({ id: WP4_FIX.naming, label: '凳子', at: WP4_POS.naming });
  ctx.naming({
    owner: WP4_FIX.naming, header: '（沙盒）长明照相馆　取件单　No.0474　姓名：＿＿', answer: NAME.HUOJI,
    wrong: { [NAME.KANMENDE]: '看门的多了，门神也看门。', [NAME.ZHOU_SHOUREN]: '底片是白的。名字跟人对不上，我这相机不认。' },
    onCorrect: [E.seen(K('naming.ok')), E.feedback('（沙盒）姓名栏写上了。')],
  });
  // 玻璃（noOcclude）+ 门把手（低优先级）+ 玻璃后的高优先级 NPC
  const glassMat = new THREE.MeshStandardMaterial({ color: '#a8c8d8', transparent: true, opacity: 0.25 });
  glassMat.userData.noOcclude = true;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.2), glassMat);
  glass.position.set(WP4_POS.glass[0], WP4_POS.glass[1], WP4_POS.glass[2]);
  glass.userData.noOcclude = true;
  ctx.add(glass, { occlude: false });
  const handle = box([0.06, 0.18, 0.06], WP4_POS.glassHandle, '#c0a060');
  ctx.add(handle);
  ctx.interactable({ id: WP4_FIX.glassHandle, label: '玻璃门', at: WP4_POS.glassHandle, hit: handle, onInteract: [E.feedback('（沙盒）门锁着。')] });
  ctx.npc({
    id: WP4_FIX.glassNpc, rig: dummy('#E8E0D0', 1.7), yin: false,
    placement: () => ({ pos: WP4_POS.glassNpc, yaw: 0 }),
    interact: { label: '陆师傅', priority: 2, range: 6, talk: [{ dialogue: DLG_LINE }] },
  });
}

const wp4: AreaPart = {
  dialogues: WP4_DIALOGUES,
  cutscenes: WP4_CUTSCENES,
  build(ctx) {
    buildFixtures(ctx);
  },
};

export default wp4;

// ==================================================================== 自测工具

class Check {
  readonly notes: string[] = [];
  ok = true;
  that(cond: unknown, msg: string): void {
    if (cond) this.notes.push(`✓ ${msg}`);
    else {
      this.ok = false;
      this.notes.push(`✗ ${msg}`);
    }
  }
  eq(a: unknown, b: unknown, msg: string): void {
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    this.that(sa === sb, sa === sb ? msg : `${msg}（得到 ${sa}，期望 ${sb}）`);
  }
  result(): SelftestResult {
    return { ok: this.ok, notes: this.notes };
  }
}

/** 改状态的自测：结束后还原进度（flags/物品/照片/线索/seen），并让 NPC 重新站位。 */
async function withSnapshot<T>(game: Game, fn: () => Promise<T>): Promise<T> {
  const snap = game.state.snapshot();
  const ending = game.ending;
  try {
    return await fn();
  } finally {
    // 失败的自测可能把对话/过场/面板留在栈上：清掉，免得影响下一条
    if (game.modes.stack.length > 1 || game.effects.busy) game.modes.resetTo('mode.explore');
    game.state.restore(snap);
    game.ending = ending;
    game.sys.npc.reevaluate();
  }
}

/** 备份/还原 localStorage 里本游戏的键（页面内跑存档自测时不破坏沙盒会话的存档）。 */
function backupStorage(): () => void {
  const keys = [SAVE_KEYS['save.auto'], SAVE_KEYS['save.yin'], SAVE_KEYS.completed, SAVE_KEYS.settings, `${SAVE_KEYS['save.auto']}.bad`, `${SAVE_KEYS['save.yin']}.bad`];
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  if (!ls) return () => {};
  const old = keys.map(k => [k, ls.getItem(k)] as const);
  return () => {
    for (const [k, v] of old) {
      if (v === null) ls.removeItem(k);
      else ls.setItem(k, v);
    }
  };
}

/** 推进对话直到停在选项或结束（打字中先补完）。 */
async function dlgRun(game: Game, max = 20): Promise<void> {
  for (let i = 0; i < max; i++) {
    await game.settle();
    const a = game.sys.dialogue.active;
    if (!a || a.options.length > 0) return;
    game.dispatch({ t: 'advance' });
  }
}

/** 合成一个只含状态类系统的小 Game（存档、时辰、巡夜本、提示的自测用；不碰真游戏）。 */
interface Mini {
  game: Game;
  events: EventBus<GameEvents>;
  state: GameState;
  save: SaveSystem;
  flags: Set<string>;
  view: StateView & { ants: number; seenKeys: Set<string> };
  toasts: string[];
  subs: string[];
  modes: { top: string; stack: string[]; transient: boolean };
  setTime(t: number): void;
}
function mini(area: AreaId | 'dev' = 'r1'): Mini {
  const events = new EventBus<GameEvents>();
  const toasts: string[] = [];
  const subs: string[] = [];
  const modes = { top: 'mode.explore', stack: ['mode.explore'], transient: false };
  const flags = new Set<string>();
  let time = 0;
  const seenKeys = new Set<string>();
  const box = { ants: 0 };
  const view = {
    get ants(): number { return box.ants; },
    set ants(n: number) { box.ants = n; },
    seenKeys,
    flag: (id: FlagId) => flags.has(id), num: (id: FlagId) => (flags.has(id) ? 1 : 0),
    has: () => false, used: () => false, hasPhoto: () => false, seen: (k: string) => seenKeys.has(k),
    names: () => [], antCount: () => box.ants, temp: () => false,
    shichen: 'zi', area, mode: 'mode.explore', vf: false, lens: 'normal', zoom: 1,
  } as unknown as Mini['view'];
  const titleBox = { n: 0 };
  const g = {
    events, ending: 'none',
    // M1d：结局写通关标记后引擎安排回标题；迷你 Game 只记次数
    get titleRequests() { return titleBox.n; },
    returnToTitleWhenIdle() { titleBox.n++; },
    get time() { return time; },
    settings: { ...DEFAULT_SETTINGS },
    url: { test: true },
    modes: {
      get top() { return modes.top; }, get stack() { return modes.stack; },
      isTransient: () => modes.transient, has: (id: string) => modes.stack.includes(id),
    },
    areas: {
      current: area === 'dev' ? { def: { id: 'dev', spawns: {} }, spawnUsed: 'spawn.dev_start', ctx: { getTemp: () => false } }
        : { def: { id: area, spawns: { [SPAWN.R1_START]: {}, [SPAWN.R1_FROM_R2]: {} } }, spawnUsed: SPAWN.R1_FROM_R2, ctx: { getTemp: () => false } },
      defs: new Map(),
    },
    ui: { toast: (t: string) => { toasts.push(t); events.emit('feedback', { text: t }); }, subtitle: (t: string) => { subs.push(t); }, fade: { title: () => {}, black: () => {} } },
    audio: { sfx: () => {}, music: () => {}, murmur: () => {} },
    sys: { interaction: { blink: () => {} }, viewfinder: { on: false, lens: 'normal', zoom: 1 } },
  } as unknown as Game;
  const state = new GameState(g);
  const save = new SaveSystem(g);
  Object.assign(g as object, { state, save, effects: new EffectRunner(g) });
  return { game: g, events, state, save, flags, view, toasts, subs, modes, setTime: t => { time = t; } };
}

/** 用 view（可控的 StateView）代替真状态的小 Game（时辰、巡夜本、提示用）。 */
function miniWithView(): Mini {
  const m = mini();
  Object.assign(m.game as object, { state: Object.assign(m.view, { markSeen: (k: string) => m.view.seenKeys.add(k), listClues: () => [] }) });
  return m;
}

// ==================================================================== 自测

type TestFn = (game: Game) => Promise<SelftestResult>;

/** 1. FlagExpr：语法、注册表校验、temp()、数值比较、时辰/镜头/取景器/ants。 */
async function tExpr(_game: Game): Promise<SelftestResult> {
  const t = new Check();
  const temps = new Map<string, boolean | number>([['lamp_lit_1', true], ['floor', 3]]);
  const flags = new Map<string, boolean | number>([[F.R1_GATE_LAMP_ON, true], [F.R2_WANG_FLOOR, 4]]);
  const s = {
    flag: (id: string) => { const v = flags.get(id); return typeof v === 'number' ? v > 0 : v === true; },
    num: (id: string) => { const v = flags.get(id); return typeof v === 'number' ? v : v ? 1 : 0; },
    has: (id: string) => id === IT.BULB, used: () => false, hasPhoto: (id: string) => id === PH.TUDI, seen: (k: string) => k === 'npc.wang',
    names: () => [], antCount: () => 2, temp: (k: string) => temps.get(k) ?? false,
    shichen: 'chou', area: 'r2', mode: 'mode.explore', vf: true, lens: 'ir', zoom: 2,
  } as unknown as StateView;
  const ev = (src: string): boolean => parseCond(src)(s);
  t.that(ev('r1.gate_lamp_on'), 'flag 为真');
  t.that(!ev('!r1.gate_lamp_on'), '! 取反');
  t.that(ev('r2.wang_floor >= 4 && r2.wang_floor < 5'), '数值比较 >= <');
  t.that(ev('r2.wang_floor == 4') && !ev('r2.wang_floor != 4'), '== !=');
  t.that(ev('temp(lamp_lit_1)'), 'temp(key) 为真');
  t.that(!ev('temp(nope)'), '未设置的 temp 为假');
  t.that(ev('temp(floor) == 3') && ev('temp(floor) > 2'), 'temp(key) 数值比较（WP4 补充）');
  t.that(ev('r1.p1_done || temp(lamp_lit_1)'), '|| 与 temp 混用（王奶奶初见条件的写法）');
  t.that(ev('has(it.bulb) && !used(it.bulb) && photo(ph.tudi) && seen(npc.wang)'), 'has/used/photo/seen');
  t.that(ev('shichen == chou') && ev('shichen != zi'), 'shichen');
  t.that(ev('lens == ir') && ev('vf'), 'lens/vf');
  t.that(ev('ants >= 1 && ants < 6'), 'ants 比较（南柯追加条件）');
  t.that(ev('(r1.p1_done || r1.gate_lamp_on) && !(ants == 6)'), '括号与优先级');
  t.that(ev('true') && !ev('false'), 'true/false');
  const throws = (src: string): boolean => { try { parseCond(src); return false; } catch { return true; } };
  // check-allow: unknown-id —— 负例：条件表达式里的未登记 flag 必须报错
  t.that(throws('r1.no_such_flag'), '未登记的 flag 报错');
  t.that(throws('has(it.nope)'), '未登记的物品报错');
  t.that(throws('photo(ph.nope)') && !throws('photo(ph.empty_3)'), '照片 id 校验（空镜 id 接受）');
  t.that(throws('temp(a.b)'), 'temp 键不许带点');
  t.that(throws('r1.gate_lamp_on &&') && throws('(r1.gate_lamp_on') && throws('shichen == noon') && throws('ants'), '语法错误报错');
  return t.result();
}

/** 2a. 可重入：顶层 run（如 onHit）开对话，在第一句出现时 settle 为 waiting；推进完 run 以 done 结束。 */
async function tReentrantOnHit(game: Game): Promise<SelftestResult> {
  const t = new Check();
  await withSnapshot(game, async () => {
    const p = game.effects.runHandler([E.seen(K('hit.before')), E.dialogue(DLG_LINE), E.seen(K('hit.after'))], 'shoot:wp4');
    const s = await game.settle();
    t.eq(s, 'waiting', 'onHit 开对话后 settle = waiting');
    t.eq(game.modes.top, 'mode.dialogue', '栈顶是 mode.dialogue');
    t.eq(game.sys.dialogue.active?.text, '第一句', '停在第一句');
    t.that(game.state.seen(K('hit.before')) && !game.state.seen(K('hit.after')), '对话前的 effect 已执行、之后的还没');
    await dlgRun(game);
    t.eq(await p, 'done', 'run 以 done 结束');
    t.that(game.state.seen(K('hit.after')), '对话结束后继续执行后面的 effect');
    t.eq(game.modes.top, 'mode.explore', '回到 explore');
    t.eq(await game.settle(), 'idle', '最后 settle = idle');
  });
  return t.result();
}

/** 2b. 可重入：过场的 {effects} 步发物品与 flag（内联，不排队），计时步按游戏时间走完。 */
async function tReentrantCutsceneEffects(game: Game): Promise<SelftestResult> {
  const t = new Check();
  await withSnapshot(game, async () => {
    const t0 = game.time;
    const p = game.effects.runHandler([E.cutscene(CS_FX)], 'test:wp4.fx');
    t.eq(game.modes.top, 'mode.cutscene', '过场压入 mode.cutscene');
    t.that(game.sys.cutscene.osdText()?.startsWith('CH1 沙盒') === true, 'osd 步骤生效');
    const s = await game.settle();
    t.eq(s, 'idle', '过场自己播完，settle = idle');
    t.eq(await p, 'done', 'run 以 done 结束');
    t.that(game.state.has(IT.BULB) && game.state.flag(F.R1_GATE_LAMP_ON), '{effects} 步发了物品与 flag');
    t.that(game.state.listClues().includes('（沙盒）过场线索'), '{effects} 函数形式（GameApi.clue）');
    t.that(game.state.seen(K('fx.a')) && game.state.seen(K('fx.b')), '两个 {effects} 步都执行了');
    t.that(game.time - t0 >= 2.5 - 1e-6, `游戏时间至少走了 2.5 秒（实际 ${(game.time - t0).toFixed(2)}）`);
    t.that(game.state.seen(CS_FX), '播完记 seen(cs id)');
    t.eq(game.modes.top, 'mode.explore', '回到 explore');
  });
  return t.result();
}

/** 2c. 可重入：对话 → 过场 → 对话三层嵌套，全部内联。 */
async function tReentrantNested(game: Game): Promise<SelftestResult> {
  const t = new Check();
  await withSnapshot(game, async () => {
    const p = game.effects.runHandler([E.dialogue(DLG_OUTER)], 'test:wp4.nested');
    await game.settle();
    t.eq(game.sys.dialogue.active?.text, '外层开始', '外层第一句');
    game.dispatch({ t: 'advance' });
    const s = await game.settle();
    t.eq(s, 'waiting', '内层对话出现时 settle = waiting');
    t.eq(game.sys.dialogue.active?.text, '内层', '停在内层对话');
    t.eq(game.modes.stack.slice(-3), ['mode.dialogue', 'mode.cutscene', 'mode.dialogue'], '栈为 … dialogue, cutscene, dialogue');
    game.dispatch({ t: 'advance' });
    await game.settle();
    t.that(game.state.seen(K('inner.end')) && game.state.seen(K('mid.after')), '内层结束 → 过场继续执行后续 {effects}');
    t.eq(game.sys.dialogue.active?.text, '外层继续', '回到外层对话');
    t.that(!game.modes.has('mode.cutscene'), '过场已弹出');
    await dlgRun(game);
    t.eq(await p, 'done', '外层 run 以 done 结束');
    t.that(game.state.seen(K('outer.end')), '外层 end 节点 effects 执行');
    t.eq(game.modes.top, 'mode.explore', '回到 explore');
  });
  return t.result();
}

/** 3. 取消：resetTo 打断对话 → 同一 handler 后续 effect 丢弃；排队的顶层 run 照常执行；已取消 scope 的 GameApi 写方法是空操作。 */
async function tCancel(game: Game): Promise<SelftestResult> {
  const t = new Check();
  await withSnapshot(game, async () => {
    const p = game.effects.runHandler([E.dialogue(DLG_LINE), E.flag(F.R4_ASKED_TAPE), E.seen(K('cancel.after'))], 'test:wp4.cancel');
    let apiCancelled = false;
    const p2 = game.effects.runHandler(async g => {
      // 这是排队的第二个顶层 run：第一个被取消后它照常执行
      await g.run([E.seen(K('cancel.queued'))]);
    }, 'test:wp4.queued');
    t.eq(await game.settle(), 'waiting', '对话等输入');
    t.that(game.effects.busy, 'runner busy');
    game.modes.resetTo('mode.explore');
    t.eq(await p, 'cancelled', '被打断的 run 以 cancelled 结束');
    t.that(!game.state.flag(F.R4_ASKED_TAPE) && !game.state.seen(K('cancel.after')), '后续 effect 被丢弃（flag 没写）');
    t.eq(game.sys.dialogue.active, null, '对话已清');
    t.eq(game.modes.top, 'mode.explore', '栈回到 explore');
    await game.settle();
    t.eq(await p2, 'done', '排队的顶层 run 照常执行');
    t.that(game.state.seen(K('cancel.queued')), '排队 run 的 effect 执行了');
    // 函数 handler：await 对话被取消后，GameApi 写方法变空操作
    const p3 = game.effects.runHandler(async g => {
      await g.dialogue(DLG_LINE);
      apiCancelled = g.cancelled;
      g.setFlag(F.R4_HUANG_ADMITS);
      await g.run([E.seen(K('cancel.api'))]);
    }, 'test:wp4.cancel_fn');
    await game.settle();
    game.modes.resetTo('mode.explore');
    t.eq(await p3, 'cancelled', '函数 handler 的 run 以 cancelled 结束');
    t.that(apiCancelled, 'g.cancelled 为真');
    t.that(!game.state.flag(F.R4_HUANG_ADMITS) && !game.state.seen(K('cancel.api')), '取消后 g.setFlag / g.run 不生效');
    t.eq(await game.settle(), 'idle', '最后 idle');
  });
  return t.result();
}

/** 3b. 强制对话没有“（先这样）”；普通选项节点自动追加；DText 函数文本；选项 when 现算。 */
async function tForcedDialogue(game: Game): Promise<SelftestResult> {
  const t = new Check();
  await withSnapshot(game, async () => {
    const p = game.effects.runHandler([E.dialogue(DLG_FORCED)], 'test:wp4.forced');
    await game.settle();
    const a = game.sys.dialogue.active;
    t.eq(a?.options, ['装回去', '再等等'], '强制对话只有两个选项');
    t.that(a?.text.includes(`${game.state.antCount()}/6`) === true, 'DText 函数正文（n/6）');
    game.dispatch({ t: 'choose', k: 1 });
    t.eq(await p, 'done', '选 1 后结束');
    t.that(game.state.seen(K('forced.yes')), '选项 1 的 effects 执行');
    t.eq(game.modes.top, 'mode.explore', '回到 explore');
    const q = game.effects.runHandler([E.dialogue(DLG_TREE)], 'test:wp4.tree');
    await dlgRun(game);
    const b = game.sys.dialogue.active;
    const lamp = game.state.flag(F.R1_GATE_LAMP_ON);
    t.eq(b?.options, lamp ? ['甲', '乙（门灯亮了才有）', '丙', STRINGS.dialogue.leave] : ['甲', '丙', STRINGS.dialogue.leave], '普通对话末尾自动加“（先这样）”，when 为假的选项隐藏');
    t.that(game.dispatch({ t: 'choose', k: 9 }).reason === 'bad_option', '越界选项 → bad_option');
    game.dispatch({ t: 'choose', k: 1 });
    await game.settle();
    t.eq(game.sys.dialogue.active?.text, '说了甲。', '选项跳到对应节点');
    await dlgRun(game);
    game.dispatch({ t: 'choose', k: game.sys.dialogue.active?.options.length ?? 1 });
    t.eq(await q, 'done', '“（先这样）”结束对话');
  });
  return t.result();
}

/** 4. 存档：损坏 → .bad 备份且 has() 为假；版本/结构错误；未知 id 丢弃、wang_floor 钳位、出生点纠正；读档往返。 */
async function tSaveCorrupt(_game: Game): Promise<SelftestResult> {
  const t = new Check();
  const restore = backupStorage();
  try {
    const m = mini('r1');
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    t.that(ls !== undefined, '有 localStorage');
    if (!ls) return t.result();
    const key = SAVE_KEYS['save.auto'];
    ls.removeItem(`${key}.bad`);
    ls.setItem(key, '{ not json');
    t.that(!m.save.has('save.auto'), '损坏的 JSON：has() 为假');
    t.eq(m.save.read('save.auto'), { ok: false, reason: 'parse' }, 'read → parse');
    t.eq(ls.getItem(`${key}.bad`), '{ not json', '原数据另存为 .bad');
    ls.setItem(key, JSON.stringify({ v: 2, savedAt: 1, core: {}, area: 'r1', spawn: SPAWN.R1_START }));
    t.eq(m.save.read('save.auto'), { ok: false, reason: 'version' }, '版本不符 → version');
    ls.setItem(key, JSON.stringify({ v: 1, savedAt: 1, core: { flags: {} }, area: 'r1', spawn: SPAWN.R1_START }));
    t.eq(m.save.read('save.auto'), { ok: false, reason: 'schema' }, '缺字段 → schema');
    ls.removeItem(key);
    t.eq(m.save.read('save.auto'), { ok: false, reason: 'missing' }, '没有 → missing');
    // 结构对、内容可疑：就地修复
    ls.setItem(key, JSON.stringify({
      v: 1, savedAt: 1,
      core: {
        flags: { 'r1.log_taken': true, 'r9.bogus': true, 'r2.wang_floor': 9 },
        // check-allow: unknown-id —— 负例：存档里的未登记物品 id 读档时必须被丢弃
        items: [{ id: 'it.log', used: false, order: 1 }, { id: 'it.bogus', used: false, order: 2 }],
        photos: [{ id: 'ph.tudi', title: '土地', key: true, print: false, seq: 1, area: 'r1', lens: 'normal', zoom: 2, context: 'live' },
          { id: 'ph.empty_7', title: '空镜', key: false, print: false, seq: 2, area: 'r1', lens: 'normal', zoom: 1, context: 'live' },
          // check-allow: unknown-id —— 负例：存档里的未登记照片 id 读档时必须被丢弃
          { id: 'ph.bogus', title: '?', key: true, print: false, seq: 3, area: 'r1', lens: 'normal', zoom: 1, context: 'live' }],
        clues: ['线索甲', '线索甲'], seen: ['npc.wang'], emptySeq: 2,
      },
      area: 'r1', spawn: 'spawn.r3_west',
    }));
    const r = m.save.read('save.auto');
    t.that(r.ok, '可修复的存档 ok');
    if (r.ok) {
      t.eq(r.data.core.flags, { 'r1.log_taken': true, 'r2.wang_floor': 5 }, '未知 flag 丢弃、wang_floor 钳到 5');
      t.eq(r.data.core.items.map(i => i.id), ['it.log'], '未知物品丢弃');
      t.eq(r.data.core.photos.map(p => p.id), ['ph.tudi', 'ph.empty_7'], '未知照片丢弃、空镜保留');
      t.eq(r.data.core.emptySeq, 7, 'emptySeq 对齐到现存空镜编号');
      t.eq(r.data.spawn, SPAWN.R1_START, '出生点不属于该区域 → 改用第一个出生点');
      t.eq(r.data.core.clues, ['线索甲'], '线索去重');
      t.that(r.repaired.length >= 5, `repaired 列出修复项（${r.repaired.length} 条）`);
      const ld = m.save.load('save.auto');
      t.that(ld.ok && m.state.flag(F.R1_LOG_TAKEN) && m.state.num(F.R2_WANG_FLOOR) === 5 && m.state.has(IT.LOG), 'load → state.restore');
      t.that(m.state.nextEmptyId() === 'ph.empty_8', '读档后空镜编号接着走');
    }
    // 往返：写 → 读 → 一致
    const m2 = mini('r1');
    m2.state.setFlag(F.R1_LOG_TAKEN);
    m2.state.setFlag(F.R2_WANG_FLOOR, 3);
    m2.state.giveItem(IT.KEYS);
    m2.state.markUsed(IT.KEYS);
    m2.state.addClue('线索乙');
    m2.state.markSeen('npc.boy');
    m2.save.flushIfSafe();
    const m3 = mini('r1');
    const back = m3.save.load('save.auto');
    t.that(back.ok, '自动存档写入并可读');
    t.eq(m3.state.snapshot(), m2.state.snapshot(), '存档往返：flags/物品/照片/线索/seen 一致');
    t.that(back.ok && back.data.spawn === SPAWN.R1_FROM_R2, '存档记最近进入的出生点');
  } finally {
    restore();
  }
  return t.result();
}

/** 5. 存档：hold 期间不落盘（含 E.save）；临时模式推迟；E.save 在对话中推迟；dev 不存档；markCompleted/endingDone。 */
async function tSaveHold(_game: Game): Promise<SelftestResult> {
  const t = new Check();
  const restore = backupStorage();
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) {
      t.that(false, '有 localStorage');
      return t.result();
    }
    for (const k of [SAVE_KEYS['save.auto'], SAVE_KEYS['save.yin'], SAVE_KEYS.completed]) ls.removeItem(k);
    const m = mini('r1');
    m.state.setFlag(F.R1_LOG_TAKEN);
    m.modes.transient = true;
    m.save.flushIfSafe();
    t.that(ls.getItem(SAVE_KEYS['save.auto']) === null, '临时模式中不落盘');
    m.modes.transient = false;
    m.save.hold('ending');
    t.that(m.save.held, 'held 为真');
    m.state.setFlag(F.R1_SOUL_RETURNED);
    m.save.flushIfSafe();
    t.that(ls.getItem(SAVE_KEYS['save.auto']) === null, 'hold 期间 flushIfSafe 不落盘');
    t.that(!m.save.writeSlot('save.yin'), 'hold 期间 writeSlot 失败');
    m.save.requestSlot('save.yin');
    m.save.release('ending');
    m.save.flushIfSafe();
    t.that(ls.getItem(SAVE_KEYS['save.yin']) === null, 'hold 期间的 E.save 被丢弃（不在 release 后补写）');
    t.that(ls.getItem(SAVE_KEYS['save.auto']) !== null, 'release 后照常存档');
    // E.save 在对话（临时模式）中推迟
    m.modes.transient = true;
    m.state.setFlag(F.R4_GOT_TAPE);
    m.save.requestSlot('save.yin');
    t.that(ls.getItem(SAVE_KEYS['save.yin']) === null, '对话中 E.save 推迟');
    m.modes.transient = false;
    m.save.flushIfSafe();
    const yin = ls.getItem(SAVE_KEYS['save.yin']);
    t.that(yin !== null && (JSON.parse(yin) as { core: { flags: Record<string, unknown> } }).core.flags[F.R4_GOT_TAPE] === true, '回到安全模式后写寅时槽，且已含 r4.got_tape');
    // dev 沙盒不存档
    const d = mini('dev');
    ls.removeItem(SAVE_KEYS['save.auto']);
    d.state.setFlag(F.R1_LOG_TAKEN);
    d.save.flushIfSafe();
    t.that(ls.getItem(SAVE_KEYS['save.auto']) === null, 'dev 沙盒不存档');
    // 结局：main 且没有南柯 → markCompleted；有南柯 → 等 nanke
    m.save.request('manual');
    m.save.flushIfSafe();
    const api = createGameApi(m.game);
    m.save.hold('ending');
    m.state.setFlag(F.R1_NANKE);
    api.endingDone('main');
    t.that(!m.save.completed && ls.getItem(SAVE_KEYS['save.auto']) !== null, 'r1.nanke 时 main 播完还不算通关');
    t.eq(m.game.ending, 'main', 'Game.ending = main');
    let got: string | null = null;
    m.events.on('ending', e => { got = e.kind; });
    await api.run([E.ending('nanke')]);
    t.that(m.save.completed && ls.getItem(SAVE_KEYS['save.auto']) === null, "E.ending('nanke') → markCompleted：删 save.auto、写通关标记");
    t.eq(got, 'nanke', "发 'ending' 事件");
    t.that(!m.save.has('save.auto'), '通关后没有“继续”');
    m.state.setFlag(F.R1_CALLED_AT_DAWN);
    m.save.release('ending');
    m.save.flushIfSafe();
    t.that(ls.getItem(SAVE_KEYS['save.auto']) === null, '已通关后不再写 save.auto');
    m.save.clearCompleted();
    t.that(!m.save.completed && !m.save.held, 'clearCompleted 清通关标记与 hold');
    const m4 = mini('r1');
    createGameApi(m4.game).endingDone('main');
    t.that(m4.save.completed, '没有南柯时 main 播完即通关');
    t.that((m4.game as unknown as { titleRequests: number }).titleRequests === 1, '写通关标记的那一次安排回标题（M1d）');
  } finally {
    restore();
  }
  return t.result();
}

/** 6. 时辰钟点：00:59/02:59/04:59 停住；卯时 HUD 在 05:00 才换；OSD 日期跨午夜。 */
async function tClock(_game: Game): Promise<SelftestResult> {
  const t = new Check();
  const m = miniWithView();
  const sh = new ShichenSystem(m.game);
  sh.update(0);
  t.eq(sh.clockText(), '23:40', '子时从 23:40 起');
  t.eq(sh.hudLabel(), '子时', 'HUD 子时');
  sh.update(20);
  t.eq(sh.clockText(), '23:41', '每 20 秒 1 分钟');
  t.eq(sh.osdDate(), '2026-08-27 周四', '午夜前 OSD 日期');
  sh.update(20 * 19);
  t.eq(sh.clockText(), '00:00', '走到 00:00');
  t.eq(sh.osdDate(), '2026-08-28 周五', '午夜后 OSD 日期');
  t.that(/^CH2 2026-08-28 周五 00:00:\d\d$/.test(sh.osdLine(2)), `osdLine 格式（${sh.osdLine(2)}）`);
  sh.update(20 * 200);
  t.eq(sh.clockText(), '00:59', '子时停在 00:59');
  let evt: string | null = null;
  m.events.on('shichen', e => { evt = `${e.prev}→${e.now}`; });
  m.flags.add(F.R2_WANG_DONE);
  m.flags.add(F.R3_SAW_TRUE_FORM);
  m.events.emit('flag', { id: F.R3_SAW_TRUE_FORM, value: true, prev: false });
  t.eq(evt, 'zi→chou', "推导值变化发 'shichen'");
  // M4：远钟与字卡挂起，等“风平浪静”（这里栈顶就是 explore）持续 0.5 秒再播
  let card: string | null = null;
  m.events.on('shichen:card', e => { card = e.now; });
  t.that(!sh.transitioning && card === null, '字卡挂起，不在 flag 变化的同一帧播');
  sh.update(0.3);
  sh.update(0.3);
  t.that(sh.transitioning, '时辰过场开始');
  t.eq(card, 'chou', "字卡播出时发 'shichen:card'");
  t.eq(sh.clockText(), '01:05', '丑时从 01:05 起');
  t.eq(sh.hudLabel(), '丑时', 'HUD 丑时');
  sh.update(10);
  t.eq(sh.clockText(), '01:06', '每 10 秒 1 分钟');
  sh.update(10 * 500);
  t.eq(sh.clockText(), '02:59', '丑时停在 02:59');
  t.that(!sh.transitioning, '2 秒过场已结束');
  m.flags.add(F.R4_GOT_TAPE);
  m.events.emit('flag', { id: F.R4_GOT_TAPE, value: true, prev: false });
  t.eq(sh.clockText(), '03:05', '寅时从 03:05 起');
  sh.update(10 * 500);
  t.eq(sh.clockText(), '04:59', '寅时停在 04:59');
  t.eq(sh.hudLabel(), '寅时', 'HUD 寅时');
  m.flags.add(F.R1_SOUL_RETURNED);
  m.events.emit('flag', { id: F.R1_SOUL_RETURNED, value: true, prev: false });
  t.eq(sh.current, 'mao', '推导值已是卯时');
  t.eq(sh.hudLabel(), '寅时', '钟点 05:00 前 HUD 仍是寅时');
  sh.override('04:58:00');
  sh.update(1);
  t.eq(sh.clockText(), '04:59', '加速钟 70 钟秒/秒');
  t.eq(sh.hudLabel(), '寅时', '04:59 仍是寅时');
  sh.update(1);
  t.eq(sh.clockText(), '05:00', '05:00');
  t.eq(sh.hudLabel(), '卯时', '05:00 才显示卯时');
  sh.update(30);
  t.eq(sh.clockText(), '05:12', '加速钟停在 05:12');
  sh.override(null);
  sh.update(100);
  t.eq(sh.clockText(), '05:12', '交还后卯时钟不走');
  // 读档/调试预置（没有 'flag' 事件）：静默对账
  m.flags.clear();
  m.flags.add(F.R4_GOT_TAPE);
  sh.update(0);
  t.eq(sh.clockText(), '03:05', '推导值被外部改变时静默对账（从寅时起点重走）');
  return t.result();
}

/** 7. 隔玻璃聚焦到高优先级 NPC；不透明墙挡住；同优先级取最近。 */
async function tFocusGlass(game: Game): Promise<SelftestResult> {
  const t = new Check();
  const cur = game.areas.current;
  if (!cur) {
    t.that(false, '需要已进入的区域');
    return t.result();
  }
  const p0 = game.player.position.clone();
  const yaw0 = game.player.yaw;
  const root = cur.root;
  const added: THREE.Object3D[] = [];
  const handles: InteractableHandle[] = [];
  try {
    game.player.teleport([80, 0, 80], 0);
    game.player.lookAtPoint(new THREE.Vector3(80, 1.4, 75), 'tp');
    game.cameras.sync();
    const cam = game.cameras.camera;
    cam.updateMatrixWorld();
    const O = cam.getWorldPosition(new THREE.Vector3());
    const D = cam.getWorldDirection(new THREE.Vector3());
    const eye = game.player.eye.clone();
    // 射线上离镜头 1.6m 的点放玻璃
    const tc = eye.clone().sub(O).dot(D);
    const perp = Math.sqrt(Math.max(0, eye.distanceToSquared(O) - tc * tc));
    const tg = tc + Math.sqrt(Math.max(0.01, 1.6 * 1.6 - perp * perp));
    const P = (tt: number): THREE.Vector3 => O.clone().addScaledVector(D, tt);
    const mat = (c: string, o?: { glass?: boolean }): THREE.Material => {
      const m = new THREE.MeshBasicMaterial({ color: c, transparent: o?.glass === true, opacity: o?.glass ? 0.3 : 1 });
      if (o?.glass) m.userData.noOcclude = true;
      return m;
    };
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), mat('#9cc', { glass: true }));
    glass.position.copy(P(tg));
    glass.lookAt(O);
    glass.userData.noOcclude = true;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), mat('#ca6'));
    handle.position.copy(P(tg - 0.06));
    const npc = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.4), mat('#eee'));
    npc.position.copy(P(tg + 1.5));
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.1), mat('#555'));
    wall.position.copy(P(tg + 0.7));
    wall.lookAt(O);
    for (const o of [glass, handle, npc]) {
      root.add(o);
      added.push(o);
    }
    root.updateMatrixWorld(true);
    const ia = game.sys.interaction;
    const A: InteractId = TMP_A;
    const B: InteractId = TMP_B;
    const exists = ia.get(A) !== undefined || ia.get(B) !== undefined;
    t.that(!exists, '临时 id 未被占用');
    if (exists) return t.result();
    handles.push(ia.register({ id: A, label: '玻璃门', at: () => handle.position.clone(), hit: handle }, cur.def.id));
    const hB = ia.register({ id: B, label: '陆师傅', at: () => npc.position.clone(), hit: npc, priority: 2, range: 6 }, cur.def.id);
    handles.push(hB);
    t.eq(ia.focusCandidate(), B, '射线先过门把手、穿过玻璃，取高优先级的 NPC');
    t.eq(ia.focused, B, 'focused 同步');
    root.add(wall);
    added.push(wall);
    root.updateMatrixWorld(true);
    t.eq(ia.focusCandidate(), A, '不透明墙挡住 NPC：落回门把手');
    root.remove(wall);
    hB.remove();
    handles.pop();
    const hB0 = ia.register({ id: B, label: '陆师傅', at: () => npc.position.clone(), hit: npc, range: 6 }, cur.def.id);
    handles.push(hB0);
    t.eq(ia.focusCandidate(), A, '同优先级取最近（门把手）');
    const st = ia.list().find(s => s.id === B);
    t.that(st !== undefined && st.inRange && st.present && st.available && st.label === '陆师傅', 'list() 给出现算的状态');
  } finally {
    for (const h of handles) h.remove();
    for (const o of added) o.parent?.remove(o);
    game.player.teleport([p0.x, p0.y, p0.z], yaw0);
    game.cameras.sync();
    game.sys.interaction.focusCandidate();
  }
  return t.result();
}

/** 8. album：动作菜单 → 挑选器 → 确认 = activate({verb, thing})；Esc 回菜单；1 = 主动作；fallback 与 any。 */
async function tAlbumPick(game: Game): Promise<SelftestResult> {
  const t = new Check();
  await withSnapshot(game, async () => {
    const ia = game.sys.interaction;
    const X: InteractId = TMP_A;
    if (ia.get(X)) {
      t.that(false, '临时 id 未被占用');
      return;
    }
    game.state.debugSet({ items: [IT.BULB, IT.WONTON], photos: [PH.TUDI, PH.OLD_1] });
    const h = ia.register({
      id: X, label: '（沙盒）台阶', at: () => game.player.eye.clone(),
      onInteract: [E.seen(K('pick.primary'))],
      offers: s => (s.seen(K('pick.nooffers')) ? undefined : {
        accept: { [IT.BULB]: [E.used(IT.BULB), E.seen(K('pick.bulb'))] },
        any: thing => thing === PH.OLD_1,
        fallback: '（沙盒）这儿用不上这个。',
      }),
    }, game.areas.current?.def.id ?? 'dev');
    try {
      const m = game.modes;
      const album = m.handler('mode.album') as AlbumMode | undefined;
      m.push('mode.album', { menu: { target: X } } satisfies AlbumArg);
      t.eq(m.top, 'mode.album', '动作菜单是 mode.album');
      t.that(m.freezesWorld() && m.isTransient(), 'album 冻结世界且是临时模式');
      game.dispatch({ t: 'digit', n: 2 });
      const a1 = m.arg<AlbumArg>('mode.album');
      t.that(a1 !== undefined && 'pick' in a1 && a1.pick.verb === 'use', '按 2 → 挑选器（物体默认“使用”）');
      game.dispatch({ t: 'back' });
      const a2 = m.arg<AlbumArg>('mode.album');
      t.that(a2 !== undefined && 'menu' in a2, 'Esc → 回到动作菜单');
      game.dispatch({ t: 'digit', n: 2 });
      const things = album?.things() ?? [];
      // M4 第 2 轮：挑选器里关键照片、新拍的在前；物品未用的、新得的在前（albumLists）
      t.eq(things, [PH.OLD_1, PH.TUDI, IT.WONTON, IT.BULB], '挑选器格子：照片在前（新拍的在前）、物品在后（新得的在前）');
      t.eq(album?.cursor, 2, '“使用”的挑选器光标先指到第一件未用的物品');
      game.dispatch({ t: 'nav', dx: 0, dy: 1 });
      t.eq(album?.cursor, 3, '物品区里下 = +1');
      game.dispatch({ t: 'nav', dx: -1, dy: 0 });
      t.eq(album?.cursor, 2, '左 = 总列表 −1');
      game.dispatch({ t: 'nav', dx: 1, dy: 0 });
      game.dispatch({ t: 'confirm' });
      t.eq(m.top, 'mode.explore', '确认后弹出 album');
      await game.settle();
      t.that(game.state.seen(K('pick.bulb')) && game.state.used(IT.BULB), 'confirm → activate(use, it.bulb) → accept 执行');
      // 点击 = 选中并确认；不接受的东西给 fallback
      m.push('mode.album', { pick: { target: X, verb: 'show' } } satisfies AlbumArg);
      t.eq(album?.cursor, 0, '“出示”的挑选器光标先指到第一张照片');
      let fb: string | null = null;
      const off = game.events.on('feedback', e => { fb = e.text; });
      game.dispatch({ t: 'pick', index: things.indexOf(IT.WONTON) });
      await game.settle();
      off();
      t.eq(fb, '（沙盒）这儿用不上这个。', 'accept 与 any 都不收 → fallback 反馈');
      t.that(game.state.has(IT.WONTON) && !game.state.used(IT.WONTON), '用错原样退回');
      // any 接受
      const r = await ia.activate(X, { verb: 'show', thing: PH.OLD_1 }, 'api');
      t.that(r.ok && r.result?.accepted === true, 'OfferTable.any 返回 true 视为接受');
      const r2 = await ia.activate(X, { verb: 'show', thing: PH.MENSHEN_2018 }, 'api');
      t.eq(r2.reason, 'not_owned', '身上没有 → not_owned');
      // 菜单 1 = 主动作
      m.push('mode.album', { menu: { target: X } } satisfies AlbumArg);
      game.dispatch({ t: 'digit', n: 1 });
      await game.settle();
      t.that(game.state.seen(K('pick.primary')) && m.top === 'mode.explore', '菜单 1 → activate(primary)');
      // offers 现算为 undefined：show/use 走通用反馈
      game.state.markSeen(K('pick.nooffers'));
      const r3 = await ia.activate(X, { verb: 'use', thing: IT.WONTON }, 'api');
      t.that(r3.ok && r3.result?.accepted === false && r3.result.feedback === STRINGS.feedback.nothingHere, 'offers 为 undefined → “这儿用不上。”');
    } finally {
      h.remove();
      while (game.modes.top === 'mode.album') game.modes.pop('mode.album');
    }
  });
  return t.result();
}

/** 9. renderDoc：取景器中显褪字、肉眼是水渍；covered 读到之前打码。 */
async function tRenderDoc(_game: Game): Promise<SelftestResult> {
  const t = new Check();
  const m = miniWithView();
  const j = new JournalSystem(m.game);
  j.registerDocs([
    { id: DOC.SLIP_0473, title: '取件单', style: 'slip', body: '长明照相馆　取件单　No.04〔7〕3\n姓名：周守仁' },
    { id: DOC.OBITUARY, title: '讣告', style: 'notice', body: s => `讣　告（${s.shichen}）`, covered: { text: '后事由街道办理。', readBy: RD.OBITUARY_HIDDEN } },
  ]);
  t.eq(j.renderDoc(DOC.SLIP_0473, true), '长明照相馆　取件单　No.0473\n姓名：周守仁', '取景器中：〔…〕显出里面的字');
  t.eq(j.renderDoc(DOC.SLIP_0473, false), `长明照相馆　取件单　No.04${STRINGS.doc.waterStain}3\n姓名：周守仁`, '肉眼：〔…〕换成水渍符号');
  const covered = j.renderDoc(DOC.OBITUARY, true);
  t.that(covered.startsWith('讣　告（zi）') && covered.endsWith(COVER_MASK.repeat(8)), '函数正文 + 被盖住的字打码');
  m.events.emit('read', { id: RD.OBITUARY_HIDDEN });
  t.that(j.renderDoc(DOC.OBITUARY, false).endsWith('后事由街道办理。'), "读到 readBy（'read' 事件）后显出");
  t.eq(j.renderDoc(DOC.IDCARD, true), '', '未登记的文档返回空串');
  return t.result();
}

/** 9b. 巡夜本新页：玩家推进出现时 toast，读档/预置时静默。 */
async function tJournalPages(_game: Game): Promise<SelftestResult> {
  const t = new Check();
  const m = miniWithView();
  const j = new JournalSystem(m.game);
  j.registerPages([{ index: 2, when: F.R1_MET_TUDI, text: '②' }, { index: 1, when: F.R1_LOG_TAKEN, text: '①' }]);
  m.flags.add(F.R1_LOG_TAKEN);
  j.update();
  t.eq(m.toasts.length, 0, '没有 flag 事件（读档）：新页静默记 seen');
  t.that(m.view.seen('page:1'), 'seen(page:1)');
  const pages: number[] = [];
  m.events.on('journal:page', e => pages.push(e.index));
  m.flags.add(F.R1_MET_TUDI);
  m.events.emit('flag', { id: F.R1_MET_TUDI, value: true, prev: false });
  j.update();
  t.eq(m.toasts, [STRINGS.hud.newPage], '推进出新页：toast“巡夜本上多了一行字”');
  t.eq(pages, [2], "发 'journal:page'");
  j.update();
  t.eq(m.toasts.length, 1, '同一页只提示一次');
  t.eq(j.visiblePages().map(p => p.index), [1, 2], 'visiblePages 按 index 排序');
  return t.result();
}

/** 10. 提示：三级冷却；南柯追加只在 1 ≤ n < 6；候选为空 → 土地闲话；优先本区域。 */
async function tNankeHint(_game: Game): Promise<SelftestResult> {
  const t = new Check();
  const m = miniWithView();
  const h = new HintSystem(m.game);
  const P = (id: PuzzleDef['id'], order: number, area: AreaId, available: string, done: string, extra?: Partial<PuzzleDef>): PuzzleDef =>
    ({ id, order, area, available, done, hints: [`${id}-1`, `${id}-2`, `${id}-3`], ...extra });
  h.register([
    P(PZ.H_NANKE, 15, 'r1', 'r1.ability_replay', 'r1.nanke', { appendTo: { puzzle: PZ.P14_WAKE_ME, when: 'ants >= 1 && ants < 6' } }),
    P(PZ.P14_WAKE_ME, 14, 'r1', 'r1.zhou_visible', 'r1.soul_returned'),
    P(PZ.P03_VOICE_LAMPS, 3, 'r2', 'r1.mission_given', 'r2.bulb_installed'),
    P(PZ.P06_PICKUP_SLIP, 6, 'r3', 'r1.mission_given', 'r3.got_envelope'),
  ]);
  const r0 = h.request();
  t.that(r0.ok && r0.result?.puzzle === null && (STRINGS.tudiIdle as readonly string[]).includes(r0.result.text), '候选为空 → 土地闲话');
  m.flags.add(F.R1_MISSION_GIVEN);
  t.eq(h.current(), PZ.P03_VOICE_LAMPS, '候选里没有本区域（r1）的 → 取第一个');
  Object.assign(m.view, { area: 'r3' });
  t.eq(h.current(), PZ.P06_PICKUP_SLIP, '优先本区域');
  m.flags.add(F.R2_BULB_INSTALLED);
  m.flags.add(F.R3_GOT_ENVELOPE);
  m.flags.add(F.R1_ZHOU_VISIBLE);
  m.flags.add(F.R1_ABILITY_REPLAY);
  t.eq(h.current(), PZ.P14_WAKE_ME, '带 appendTo 的南柯不参与当前谜题');
  // 冷却
  m.setTime(100);
  t.eq(h.request().result?.level, 1, '第 1 级随时可看');
  m.setTime(130);
  t.eq(h.request().result?.level, 1, '不到 60 秒仍是第 1 级');
  m.setTime(160);
  t.eq(h.request().result?.level, 2, '60 秒后第 2 级');
  m.game.settings.hintNoCooldown = true;
  t.eq(h.request().result?.level, 3, 'hintNoCooldown 取消冷却');
  t.eq(h.request().result?.level, 3, '最多第 3 级');
  // 南柯追加
  for (const n of [0, 1, 3, 5, 6]) {
    m.view.ants = n;
    const r = h.request();
    const app = r.result?.appended;
    const want = n >= 1 && n < 6;
    t.that(want ? app?.puzzle === PZ.H_NANKE && app.text === `${PZ.H_NANKE}-3` : app === undefined, `ants = ${n}：${want ? '追加南柯同级提示' : '不追加'}`);
  }
  m.view.ants = 3;
  m.flags.add(F.R1_NANKE);
  t.eq(h.request().result?.appended, undefined, '南柯已完成不追加');
  t.that(m.subs.length > 0, '提示以土地的字幕出现');
  // M4：谜题内的阶段——阶段一变从该阶段第 1 级重新给；冷却中重复同一级时字幕后面接“过一会儿再问”
  const m2 = miniWithView();
  const h2 = new HintSystem(m2.game);
  h2.register([P(PZ.P01_GUIDE_LAMP, 1, 'r1', 'true', 'r1.p1_done', {
    stage: s => (s.flag(F.R1_GATE_LAMP_ON) ? 1 : 0),
    stageHints: [undefined, ['lamp-1', 'lamp-2', 'lamp-3']],
  })]);
  m2.setTime(10);
  t.eq(h2.request().result?.text, `${PZ.P01_GUIDE_LAMP}-1`, '阶段 0 用原提示');
  m2.setTime(20);
  h2.request();
  t.that(m2.subs[m2.subs.length - 1]?.endsWith(STRINGS.feedback.hintLater) === true, '冷却中重复同一级：追加“过一会儿再问”');
  m2.setTime(80);
  t.eq(h2.request().result?.level, 2, '阶段 0 冷却后第 2 级');
  m2.flags.add(F.R1_GATE_LAMP_ON);
  const r2 = h2.request();
  t.that(r2.result?.level === 1 && r2.result.text === 'lamp-1', `阶段一变从第 1 级重新给（${JSON.stringify(r2.result)}）`);
  return t.result();
}

/** 11. 密码锁：连错 3 次写线索；只用滚轮 + Enter 输入；成功关面板并执行 onSuccess。 */
async function tCodeLock(game: Game): Promise<SelftestResult> {
  const t = new Check();
  await withSnapshot(game, async () => {
    const p = game.sys.panels;
    const r = p.openCode(WP4_FIX.codeLock);
    t.that(r.ok && game.modes.top === 'mode.panel_code', '打开密码面板');
    t.eq(await game.settle(), 'idle', '面板打开时已 settle（waitingInput）');
    t.that(game.effects.waitingInput, '面板打开期间 waitingInput 为真');
    const fails0 = p.code?.fails ?? 0;
    for (let i = 0; i < 3; i++) {
      for (const ch of '0000') game.dispatch({ t: 'digit', n: Number(ch) });
      const res = game.dispatch({ t: 'confirm' });
      t.that(res.ok && (res.result as { correct?: boolean } | undefined)?.correct === false, `第 ${i + 1} 次错误`);
    }
    t.eq(p.code?.fails, fails0 + 3, '失败计数');
    t.that(game.state.listClues().includes('（沙盒）抽屉的号在伙计脑门上。'), '连错 3 次写线索');
    t.eq(game.modes.top, 'mode.panel_code', '错误后面板保持打开');
    t.eq(p.code?.entered, '', '错误后清空');
    // 只用滚轮 + Enter：0 6 1 8
    for (const d of WP4_FIX.code) {
      for (let k = 0; k < Number(d); k++) game.dispatch({ t: 'wheel', dir: 1 });
      game.dispatch({ t: 'confirm' });
    }
    await game.settle();
    t.eq(game.modes.top, 'mode.explore', '正确后面板自动关闭');
    t.that(game.state.seen(K('drawer.open')), 'onSuccess 执行');
    // Esc 离开
    p.openCode(WP4_FIX.codeLock);
    game.dispatch({ t: 'digit', n: 1 });
    t.eq(p.code?.entered, '1', '数字键输入');
    game.dispatch({ t: 'erase' });
    t.eq(p.code?.entered, '', 'Backspace 删除');
    game.dispatch({ t: 'back' });
    t.that(game.modes.top === 'mode.explore' && p.code === null, 'Esc 离开');
  });
  return t.result();
}

/** 12. 称呼面板：只列已收录的称呼；错选给专属反馈并留在列表；正解执行 onCorrect。 */
async function tNaming(game: Game): Promise<SelftestResult> {
  const t = new Check();
  await withSnapshot(game, async () => {
    game.state.debugSet({ flags: { [F.R1_LOG_TAKEN]: true, [F.R1_MET_TUDI]: true } });
    const p = game.sys.panels;
    t.that(p.openNaming(WP4_FIX.naming).ok, '打开称呼面板');
    t.eq(p.naming?.options, [NAME.HUOJI, NAME.KANMENDE], '只列已收录的称呼（按 order）');
    const w = game.dispatch({ t: 'choose', k: 2 });
    t.eq((w.result as { feedback?: string } | undefined)?.feedback, '看门的多了，门神也看门。', '错选 → 专属反馈');
    t.eq(game.modes.top, 'mode.panel_naming', '错选后留在列表');
    t.eq(game.dispatch({ t: 'choose', k: NAME.LAOZHOU }).reason, 'bad_option', '未收录的称呼 → bad_option');
    const ok1 = game.dispatch({ t: 'choose', k: NAME.HUOJI });
    t.that(ok1.ok && (ok1.result as { correct?: boolean } | undefined)?.correct === true, '按称呼 id 选正解');
    await game.settle();
    t.that(game.state.seen(K('naming.ok')) && game.modes.top === 'mode.explore', 'onCorrect 执行、面板关闭');
  });
  return t.result();
}

/** 13. addTalk 排队合并、pendingTalks；Dyn 标签；when/blocked 反馈；NPC 让位与 setLabel。 */
async function tInteractMisc(game: Game): Promise<SelftestResult> {
  const t = new Check();
  const ia = game.sys.interaction;
  const X: InteractId = TMP_A;
  if (ia.get(X)) {
    t.that(false, '临时 id 未被占用');
    return t.result();
  }
  ia.addTalk(X, [{ dialogue: DLG_TREE }]);
  ia.addTalk(X, [{ dialogue: DLG_LINE, when: F.R1_GATE_LAMP_ON }], { first: true });
  t.that(ia.pendingTalks().includes(X), '目标未登记时 addTalk 排队（pendingTalks）');
  const h = ia.register({
    id: X, label: s => (s.flag(F.R4_FOUND_HUANG) ? '黄三爷' : '纸人'), at: () => game.player.eye.clone(),
    when: F.R4_GHOST_MARKET_OPEN, blocked: '（沙盒）锁着。', talk: [{ dialogue: DLG_FORCED }],
  }, game.areas.current?.def.id ?? 'dev');
  try {
    t.that(!ia.pendingTalks().includes(X), '登记时合并，排队清空');
    t.eq(ia.get(X)?.talk?.map(e => e.dialogue), [DLG_LINE, DLG_FORCED, DLG_TREE], 'first 放最前、其余按调用顺序追加');
    const st = ia.list().find(s => s.id === X);
    t.that(st?.label === (game.state.flag(F.R4_FOUND_HUANG) ? '黄三爷' : '纸人'), 'Dyn 标签现算');
    if (!game.state.flag(F.R4_GHOST_MARKET_OPEN)) {
      t.that(st?.available === false && st.blockedText === '（沙盒）锁着。', 'when 为假：灰色角标 + blockedText');
      const r = await ia.activate(X, { verb: 'primary' }, 'api');
      t.that(r.reason === 'blocked' && r.result?.feedback === '（沙盒）锁着。', 'activate → blocked，反馈放进 result.feedback');
    }
    h.setLabel('（沙盒）新名字');
    t.eq(ia.list().find(s => s.id === X)?.label, '（沙盒）新名字', 'handle.setLabel');
  } finally {
    h.remove();
  }
  t.eq(ia.get(X), undefined, 'handle.remove');
  // NPC 让位（夹具 npc.wang）
  const npc = game.sys.npc.get(WP4_FIX.treeNpc);
  t.that(npc !== undefined && npc.present, '夹具 NPC 在场');
  if (npc) {
    const p = npc.root.getWorldPosition(new THREE.Vector3());
    game.sys.npc.yieldWithin([p.x, p.y + 0.5, p.z], 1);
    t.that(npc.yielded && !npc.root.visible, 'yieldWithin：3D 半径内的 NPC 隐去');
    t.eq(ia.check(WP4_FIX.treeNpc).reason, 'not_present', '让位的 NPC 交互 → not_present');
    game.sys.npc.restoreYield();
    t.that(!npc.yielded && npc.root.visible, 'restoreYield 复原');
    game.sys.npc.yieldWithin([p.x, p.y + 30, p.z], 1);
    t.that(!npc.yielded, '3D 距离超出半径不让位（楼上楼下）');
    npc.setLabel('（沙盒）王婶');
    t.eq(ia.list().find(s => s.id === WP4_FIX.treeNpc)?.label, '（沙盒）王婶', 'NpcHandle.setLabel');
    npc.setLabel('王奶奶');
  }
  // 阴物：取景器外不可聚焦、交互 wrong_view
  const yin = ia.check(WP4_FIX.yinNpc);
  if (!game.sys.viewfinder.on && !game.state.seen(WP4_FIX.yinNpc)) {
    t.that(yin.reason === 'wrong_view' || yin.reason === 'out_of_range', '阴物在取景器外 → wrong_view（或不在射程）');
  }
  return t.result();
}

/** 14. 设置：逐项校验、默认值补齐、settings.* 键也认。 */
async function tSettings(_game: Game): Promise<SelftestResult> {
  const t = new Check();
  const restore = backupStorage();
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) {
      t.that(false, '有 localStorage');
      return t.result();
    }
    ls.removeItem(SAVE_KEYS.settings);
    t.eq(loadSettings(), { ...DEFAULT_SETTINGS }, '没有设置 → 默认值');
    ls.setItem(SAVE_KEYS.settings, JSON.stringify({ volume: 2, quality: 'ultra', vfMode: 'hold', 'settings.reduce_flash': true, subSize: 2 }));
    const s: Settings = loadSettings();
    t.that(s.volume === 1 && s.quality === DEFAULT_SETTINGS.quality && s.vfMode === 'hold' && s.reduceFlash && s.subSize === 2, '非法值用默认/钳位，settings.* 键也认');
    ls.setItem(SAVE_KEYS.settings, '{bad');
    t.eq(loadSettings(), { ...DEFAULT_SETTINGS }, '坏 JSON → 默认值');
    t.eq(coerceSetting('subSize', 3), undefined, 'subSize 只能 0/1/2');
  } finally {
    restore();
  }
  return t.result();
}

/** 15. 过场 await：之前按快门给 early；到 await 后快门推进；结局不可跳过。 */
async function tCutsceneAwait(game: Game): Promise<SelftestResult> {
  const t = new Check();
  await withSnapshot(game, async () => {
    const p = game.effects.runHandler([E.cutscene(CS_AWAIT)], 'test:wp4.await');
    let fb: string | null = null;
    const off = game.events.on('feedback', e => { fb = e.text; });
    game.dispatch({ t: 'shutter' });
    off();
    t.eq(fb, '天还黑着。', 'await 之前按快门 → early');
    t.eq(game.dispatch({ t: 'play' }).reason, 'mode_disallows', "skippable:'never' 不能跳过");
    const s = await game.settle();
    t.eq(s, 'waiting', 'await 步骤 settle = waiting');
    t.eq(game.sys.cutscene.active?.awaiting, 'shutter', 'active.awaiting');
    game.dispatch({ t: 'shutter' });
    t.eq(await p, 'done', '快门推进到结束');
    t.that(game.state.seen(K('await.done')), 'await 之后的步骤执行');
  });
  return t.result();
}

/** 全部自测（node 的 wp4.mjs 与页面内 __game.selftest 共用）。 */
export const WP4_TESTS: Readonly<Record<string, TestFn>> = {
  'wp4.expr': tExpr,
  'wp4.reentrant_onhit': tReentrantOnHit,
  'wp4.reentrant_cutscene_effects': tReentrantCutsceneEffects,
  'wp4.reentrant_nested': tReentrantNested,
  'wp4.cancel': tCancel,
  'wp4.forced_dialogue': tForcedDialogue,
  'wp4.save_corrupt': tSaveCorrupt,
  'wp4.save_hold': tSaveHold,
  'wp4.clock': tClock,
  'wp4.focus_glass': tFocusGlass,
  'wp4.album_pick': tAlbumPick,
  'wp4.render_doc': tRenderDoc,
  'wp4.journal_pages': tJournalPages,
  'wp4.nanke_hint': tNankeHint,
  'wp4.code_lock': tCodeLock,
  'wp4.naming': tNaming,
  'wp4.interact_misc': tInteractMisc,
  'wp4.settings': tSettings,
  'wp4.cutscene_await': tCutsceneAwait,
};

for (const [name, fn] of Object.entries(WP4_TESTS)) registerSelftest(name, fn);
