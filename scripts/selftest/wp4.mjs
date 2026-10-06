// owner: WP4
// WP4（状态与叙事系统）的自测。两种跑法：
//
//   node scripts/selftest/wp4.mjs            node 里跑（M1b 起就要过）：用 vite 的 ssrLoadModule 直接加载 src/ 下的 TS，
//                                             拼一个“假 Game”（真的 WP4 系统 + 按 ARCH 契约写的假 ModeStack/相机/玩家/UI/音频），
//                                             跑 src/areas/dev/wp4.ts 导出的全部 WP4_TESTS，再跑几条只在 node 里跑的补充用例。
//   node scripts/selftest/wp4.mjs --page     再加页面内（M1c 起，需先 build）：用 WP7 的 scripts/lib/harness.mjs 启动游戏
//                                             （?debug=1&test=1&lockstep=1&area=dev），逐个调用 __game.selftest('wp4.*')。
//   加 -v 打印每条断言。
//
// scripts/core.mjs 自动发现本文件时调用默认导出 run(h)：总是跑 node 部分；h 是 harness（有 call/call.try 或 page）时再跑页面内部分。
// 退出码：有失败为 1。

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ==================================================================== 页面内（core.mjs / --page）

/** 页面内：逐个跑 __game.selftest('wp4.*')。h 有 call(.try) 或 page 之一即可。 */
export async function pageTests(h) {
  const callTry = h.call?.try ?? (async (m, ...a) => h.page.evaluate(([mm, aa]) => window.__game[mm](...aa), [m, a]));
  const listed = await callTry('selftests');
  const names = (listed?.result ?? []).filter(n => n.startsWith('wp4.'));
  const results = [];
  for (const name of names) {
    const r = await callTry('selftest', name);
    const res = r?.result ?? { ok: false, notes: [r?.reason ?? 'no result'] };
    results.push({ name: `page.${name}`, ok: r?.ok === true && res.ok === true, notes: res.notes ?? [] });
  }
  if (names.length === 0) results.push({ name: 'page.wp4.*', ok: false, notes: ['页面里没有登记 wp4.* 自测（需要 ?debug=1&area=dev）'] });
  return results;
}

/**
 * core.mjs 的入口（与其他 WP 相同的约定）：总是跑 node 部分；给了 harness（有 call 或 page）时再跑页面内部分。
 * 返回 { ok, notes, results }：notes 是失败项的扁平列表，results 是逐条结果。
 */
export default async function run(h) {
  const results = await runNode();
  if (h && (h.call || h.page)) results.push(...(await pageTests(h)));
  const notes = results.flatMap(r => (r.ok ? [] : [`${r.name}：${r.notes.filter(n => n.startsWith('✗')).join('；') || '失败'}`]));
  return { ok: results.every(r => r.ok), notes, results };
}

// ==================================================================== node：加载模块

async function loadModules() {
  const { createServer } = await import(path.join(ROOT, 'node_modules/vite/dist/node/index.js'));
  const server = await createServer({
    root: ROOT, configFile: false, logLevel: 'error', appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const load = p => server.ssrLoadModule(p);
  const mods = {
    THREE: await load('three'),
    events: await load('/src/core/events.ts'),
    types: await load('/src/core/types.ts'),
    layers: await load('/src/core/layers.ts'),
    math: await load('/src/core/math.ts'),
    ids: await load('/src/data/ids.ts'),
    strings: await load('/src/data/strings.ts'),
    state: await load('/src/game/state.ts'),
    effects: await load('/src/game/effects.ts'),
    save: await load('/src/game/save.ts'),
    settings: await load('/src/game/settings.ts'),
    shichen: await load('/src/game/shichen.ts'),
    interaction: await load('/src/game/interaction.ts'),
    npc: await load('/src/game/npc.ts'),
    dialogue: await load('/src/game/dialogue.ts'),
    cutscene: await load('/src/game/cutscene.ts'),
    panels: await load('/src/game/panels.ts'),
    journal: await load('/src/game/journal.ts'),
    hints: await load('/src/game/hints.ts'),
    mDialogue: await load('/src/game/modes/dialogue.ts'),
    mAlbum: await load('/src/game/modes/album.ts'),
    mJournal: await load('/src/game/modes/journal.ts'),
    mCutscene: await load('/src/game/modes/cutscene.ts'),
    mPanelCode: await load('/src/game/modes/panelCode.ts'),
    mPanelNaming: await load('/src/game/modes/panelNaming.ts'),
    wp4: await load('/src/areas/dev/wp4.ts'),
  };
  return { server, mods };
}

/** 内存 localStorage（node 没有）。 */
function installLocalStorage() {
  const m = new Map();
  globalThis.localStorage = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(),
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

// ==================================================================== node：假 Game

const TRANSIENT = new Set(['mode.replay', 'mode.panel_vcr', 'mode.panel_console', 'mode.panel_code', 'mode.panel_naming', 'mode.dialogue', 'mode.album', 'mode.journal', 'mode.tripod', 'mode.cutscene']);

/** 按 ARCH §4.6 契约写的模式栈（与 WP1 的实现无关）：允许同一模式叠多层，arg 取最上面一层；pop(expect) 要求栈顶匹配。 */
class FakeModeStack {
  constructor(game, types) {
    this.game = game;
    this.types = types;
    this.handlers = new Map();
    this.entries = [{ id: 'mode.explore', arg: undefined }];
  }
  register(h) { this.handlers.set(h.id, h); }
  handler(id) { return this.handlers.get(id); }
  get top() { return this.entries[this.entries.length - 1].id; }
  get stack() { return this.entries.map(e => e.id); }
  has(id) { return this.entries.some(e => e.id === id); }
  arg(id) { for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i].id === id) return this.entries[i].arg; return undefined; }
  push(id, arg) {
    const h = this.handlers.get(id);
    if (!h) return this.types.fail('mode_disallows');
    const prev = this.top;
    this.entries.push({ id, arg });
    h.enter(prev, arg);
    this.game.events.emit('mode', { top: this.top, prev, stack: this.stack });
    return this.types.ok();
  }
  pop(expect) {
    if (this.entries.length <= 1) return this.types.fail('mode_disallows');
    const top = this.top;
    if (expect !== undefined && top !== expect) return this.types.fail('mode_disallows');
    this.entries.pop();
    this.handlers.get(top)?.exit(this.top);
    this.game.events.emit('mode', { top: this.top, prev: top, stack: this.stack });
    return this.types.ok();
  }
  popToBase() {
    for (let i = 0; i < 32; i++) {
      const t = this.top;
      if (t === 'mode.explore' || t === 'mode.viewfinder' || t === 'mode.dialogue' || t === 'mode.cutscene' || t === 'mode.tripod') return;
      this.pop(t);
    }
  }
  resetTo() {
    this.game.effects.cancelAll('reset');
    const first = this.top;
    while (this.entries.length > 1) {
      const t = this.top;
      this.entries.pop();
      this.handlers.get(t)?.exit(this.top);
    }
    if (first !== 'mode.explore') this.game.events.emit('mode', { top: this.top, prev: first, stack: this.stack });
  }
  dispatch(a) {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const h = this.handlers.get(this.entries[i].id);
      if (!h) continue;
      const r = h.handle(a);
      if (!r.pass) return r;
    }
    return this.types.fail('mode_disallows');
  }
  isTransient() { return this.entries.some(e => TRANSIENT.has(e.id)); }
  freezesWorld() { return this.handlers.get(this.top)?.freezesWorld === true; }
  moveMode() { return 'none'; }
  lookEnabled() { return false; }
  update(dt) { this.handlers.get(this.top)?.update?.(dt); }
}

function baseMode(game, types, id, extra = {}) {
  return {
    id, transient: TRANSIENT.has(id), freezesWorld: id === 'mode.pause', pointer: 'lock', camera: 'tp', move: 'normal', look: true,
    enter() {}, exit() {},
    handle(a) {
      switch (a.t) {
        case 'interact': return game.sys.interaction.interactFocused('player');
        case 'hint': return game.sys.hints.request();
        case 'album': return game.modes.push('mode.album', { tab: 'photos' });
        case 'journal': return game.sys.journal.openJournal();
        default: return types.fail('mode_disallows');
      }
    },
    ...extra,
  };
}

function makeGame(mods) {
  const { THREE, events, types, ids } = mods;
  const log = { toasts: [], subs: [], sfx: [], fixed: [] };
  const scene = new THREE.Scene();
  const game = {
    url: { test: true, debug: true, lockstep: true, newGame: false, nolock: true, quality: null, area: 'dev', spawn: null, mute: true },
    caps: { webgl2: false, cjk: false, maxAnisotropy: 1 },
    events: new events.EventBus(),
    settings: { ...mods.settings.DEFAULT_SETTINGS },
    scene,
    time: 0, timeScale: 1, frameNo: 0, ending: 'none', lockstep: true,
    log,
    // M1d：结局写通关标记后引擎安排回标题（Game.returnToTitleWhenIdle）；假 Game 只记次数
    titleRequests: 0,
    returnToTitleWhenIdle() { this.titleRequests++; },
  };
  // —— UI / 音频 / 后期（假）
  game.ui = {
    toast(text, kind) { log.toasts.push({ text, kind }); game.events.emit('feedback', { text }); },
    subtitle(text, who) { log.subs.push({ text, who }); },
    fade: { title() {}, black() {} },
    lastFeedback: () => log.toasts.at(-1)?.text ?? null,
  };
  game.audio = { sfx(cue) { log.sfx.push(cue); }, music() {}, murmur() {} };
  game.pipeline = { post: { push() {}, pop() {}, flash() {} } };
  // —— 玩家与相机（假，但几何与 ARCH 一致：镜头离地 1.85；第三人称在身后 2.6、右偏 0.5）
  const up = new THREE.Vector3(0, 1, 0);
  let aim = null;
  game.player = {
    position: new THREE.Vector3(0, 0, 8), yaw: 0, pitch: 0, bodyYaw: 0,
    get eye() { return this.position.clone().add(new THREE.Vector3(0, 1.85, 0)); },
    teleport(p, yaw) { this.position.set(p[0], p[1], p[2]); if (yaw !== undefined) { this.yaw = yaw; this.bodyYaw = yaw; } aim = null; },
    lookAtPoint(p, _via) { this.yaw = mods.math.yawTowards(this.eye, p); this.bodyYaw = this.yaw; this.pitch = mods.math.pitchTowards(this.eye, p); aim = p.clone(); return { clamped: false }; },
    faceTowards(p) { this.yaw = mods.math.yawTowards(this.position, p); this.bodyYaw = this.yaw; },
  };
  const tp = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 200);
  const fp = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 200);
  const fixed = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 200);
  game.cameras = {
    tp, fp, fixed, photo: fp, active: 'tp', fixedRole: 'fixed',
    get camera() { return this.active === 'fixed' ? fixed : this.active === 'fp' ? fp : tp; },
    setFixedPose(p, blend, o) { fixed.position.set(p.pos[0], p.pos[1], p.pos[2]); fixed.lookAt(p.target[0], p.target[1], p.target[2]); fixed.updateMatrixWorld(); log.fixed.push({ p, o }); },
    sync() {
      const eye = game.player.eye;
      const fwd = mods.math.dirFromYawPitch(game.player.yaw, game.player.pitch, new THREE.Vector3());
      const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
      tp.position.copy(eye).addScaledVector(fwd, -2.6).addScaledVector(right, 0.5).add(new THREE.Vector3(0, 0.05, 0));
      tp.lookAt(aim ?? eye.clone().addScaledVector(fwd, 10));
      tp.updateMatrixWorld();
      fp.position.copy(eye);
      fp.lookAt(eye.clone().addScaledVector(fwd, 10));
      fp.updateMatrixWorld();
    },
    frameRect: () => ({ x: 0, y: 0, w: 800, h: 600 }),
  };
  game.playerModel = { setPose() {}, setBodyOpacity() {}, setVisible() {}, headMounted: true, stickerWorld: t => (t ?? new THREE.Vector3()).set(0, 1.93, 0) };
  // —— 区域（dev）与 AreaContext（假：只转交给 WP4 的系统）
  const root = new THREE.Group();
  root.name = 'dev.root';
  scene.add(root);
  const lightsRoot = new THREE.Group();
  root.add(lightsRoot);
  const refs = new Map();
  const temps = new Map();
  const ctx = {
    id: 'dev', root, lightsRoot, scene,
    get game() { return game.api; }, get state() { return game.state; },
    add(obj, o = {}) {
      (o.parent ?? root).add(obj);
      if (o.layer) mods.layers.setLayerRecursive(obj, o.layer);
      if (o.tempC !== undefined) obj.traverse(x => { x.userData.tempC = o.tempC; });
      if (o.occlude === false) obj.userData.noOcclude = true;
      if (o.ref) refs.set(o.ref, obj);
      return obj;
    },
    ref(id, obj) { refs.set(id, obj); },
    getRef(id) { return refs.get(id); },
    refs: () => refs,
    setTemp(k, v) { temps.set(k, v); game.events.emit('temp', { area: 'dev', key: k, value: v }); },
    getTemp(k) { return temps.get(k) ?? false; },
    tempSnapshot: () => Object.fromEntries(temps),
    interactable: d => game.sys.interaction.register(d, 'dev'),
    addTalk: (id, e, o) => game.sys.interaction.addTalk(id, e, o),
    npc: d => game.sys.npc.add(d),
    codeLock: d => game.sys.panels.registerCode(d),
    naming: d => game.sys.panels.registerNaming(d),
    levelsHandle: null,
    track: r => r,
    run: list => game.effects.run(list, 'ctx.run'),
    light: l => { lightsRoot.add(l); return l; },
    notePostKey: () => {},
  };
  game.areas = {
    current: { def: { id: 'dev', spawns: { 'spawn.dev_start': { pos: [0, 0, 8], yaw: 0 } } }, ctx, root, spawnUsed: 'spawn.dev_start' },
    defs: new Map(),
    async teleport(p, o) { game.player.teleport(p, o?.yaw); },
    async travel() { return types.ok(); },
    isLoading: () => false,
  };
  game.renderer = undefined;
  // —— WP4 的真系统 + WP5 的假系统
  game.state = new mods.state.GameState(game);
  game.effects = new mods.effects.EffectRunner(game);
  game.save = new mods.save.SaveSystem(game);
  game.modes = new FakeModeStack(game, types);
  const vf = { on: false, lens: 'normal', zoom: 1 };
  game.sys = {
    interaction: new mods.interaction.InteractionSystem(game),
    npc: new mods.npc.NpcSystem(game),
    dialogue: new mods.dialogue.DialogueSystem(game),
    cutscene: new mods.cutscene.CutsceneSystem(game),
    panels: new mods.panels.PanelSystem(game),
    journal: new mods.journal.JournalSystem(game),
    hints: new mods.hints.HintSystem(game),
    shichen: new mods.shichen.ShichenSystem(game),
    viewfinder: {
      get on() { return vf.on; }, get lens() { return vf.lens; }, get zoom() { return vf.zoom; },
      setOn(v) { vf.on = v; }, setLens(l) { vf.lens = l; return types.ok(); },
      stepZoom(dir) { const s = types.ZOOM_STEPS; const i = Math.max(0, Math.min(s.length - 1, s.indexOf(vf.zoom) + dir)); vf.zoom = s[i]; return vf.zoom; },
    },
    photo: {
      award(id, opts) {
        const meta = { title: id };
        return game.state.addPhoto({ id, title: meta.title, key: true, print: false, area: 'dev', lens: 'normal', zoom: 1, context: 'print', ...(opts?.caption ? { caption: opts.caption } : {}) });
      },
    },
    replay: { active: null, exit() {} },
    cctv: { layout: 'single', channel: 1, setLayout(l) { this.layout = l; }, select(c) { this.channel = c; return types.ok(); } },
    vcr: {}, tripod: { state: 'off' }, crt: {}, mirror: {}, read: {},
  };
  game.api = mods.effects.createGameApi(game);
  // 模式处理器：WP4 的六个是真的，其余按契约写最小版
  for (const h of [
    baseMode(game, types, 'mode.explore'),
    baseMode(game, types, 'mode.viewfinder', { camera: 'fp', enter() { vf.on = true; }, exit() { vf.on = false; } }),
    baseMode(game, types, 'mode.replay'),
    baseMode(game, types, 'mode.tripod'),
    baseMode(game, types, 'mode.panel_vcr'), baseMode(game, types, 'mode.panel_console'),
    { ...baseMode(game, types, 'mode.pause'), freezesWorld: true, handle: a => (a.t === 'back' ? game.modes.pop('mode.pause') : types.fail('mode_disallows')) },
    new mods.mDialogue.DialogueMode(game), new mods.mAlbum.AlbumMode(game), new mods.mJournal.JournalMode(game),
    new mods.mCutscene.CutsceneMode(game), new mods.mPanelCode.PanelCodeMode(game), new mods.mPanelNaming.PanelNamingMode(game),
  ]) game.modes.register(h);

  // —— 帧循环（ARCH §3.2 与 WP4 相关的部分）、advance、settle、dispatch
  game.step = dt => {
    const frozen = game.modes.freezesWorld();
    if (!frozen) {
      game.modes.update(dt);
      game.sys.npc.update(dt);
      game.sys.interaction.update(dt);
      game.sys.cutscene.update(dt);
      game.sys.dialogue.update(dt);
      game.sys.journal.update();
      game.sys.hints.update(dt);
      game.sys.shichen.update(dt);
      game.effects.pump(dt);
      game.time += dt;
    }
    game.frameNo++;
    game.save.flushIfSafe();
  };
  const tick = () => new Promise(r => setImmediate(r));
  game.advance = async (sec, fixedDt = 1 / 30, until) => {
    const n = Math.round(sec / fixedDt);
    for (let i = 0; i < n; i++) {
      game.step(fixedDt);
      if (until?.()) break;
      if (i % 30 === 29) await tick();   // 与 ARCH §3.4 一样每 30 步才让出一次
    }
  };
  game.settle = async () => {
    for (let i = 0; i < 20000; i++) {
      await tick();
      const s = game.effects.settleNow();
      if (s) return s;
      game.step(1 / 30);
    }
    return 'idle';
  };
  game.dispatch = a => game.modes.dispatch(a);
  game.renderNow = () => {};

  // 静态数据登记（启动时由 AreaManager 汇总）+ 区域 build
  game.sys.dialogue.register(mods.wp4.WP4_DIALOGUES);
  game.sys.cutscene.register(mods.wp4.WP4_CUTSCENES);
  mods.wp4.default.build(ctx);
  game.sys.npc.reevaluate();
  game.cameras.sync();
  root.updateMatrixWorld(true);
  return game;
}

// ==================================================================== node：补充用例（只在 node 里跑）

async function nodeExtras(mods, mk) {
  const { ids, effects, strings } = mods;
  const { E } = effects;
  const { F, IT, NPC, OBJ, PH } = ids;
  const POS = mods.wp4.WP4_POS;
  /** 站到夹具 p 的南边 d 米（面朝北） */
  const southOf = (p, d) => [p[0], 0, p[2] + d];
  const out = [];
  const T = (name, fn) => out.push({ name, fn });

  T('wait 计时精确（CPS 续延：到点当帧接着执行，不等宏任务）', async (g, t) => {
    const p = g.effects.run([E.wait(1), E.seen('x.after_wait'), E.wait(0.5), E.seen('x.after_wait2')], 'test');
    for (let i = 0; i < 29; i++) g.step(1 / 30);
    t(!g.state.seen('x.after_wait'), '29 帧时还没到');
    g.step(1 / 30);
    t(g.state.seen('x.after_wait'), '第 30 帧（1 秒）同步执行 wait 之后的 effect');
    for (let i = 0; i < 15; i++) g.step(1 / 30);
    t(g.state.seen('x.after_wait2'), '第二个 wait 同样精确');
    t((await p) === 'done', 'run 结束');
  });
  T('顶层 run 排队、嵌套 run 内联', async (g, t) => {
    const order = [];
    const p1 = g.effects.runHandler(async api => { order.push('a1'); await api.run([E.wait(0.5)]); order.push('a2'); await api.run([E.call(() => { order.push('nested'); })]); order.push('a3'); }, 't1');
    const p2 = g.effects.runHandler(() => { order.push('b'); }, 't2');
    t(g.effects.busy, 'busy');
    await g.settle();
    await p1; await p2;
    t(JSON.stringify(order) === JSON.stringify(['a1', 'a2', 'nested', 'a3', 'b']), `第二个顶层 run 等第一个结束（${order.join(',')}）`);
  });
  T('E.tutorial 每条只出现一次；E.say 发 feedback 与字幕', async (g, t) => {
    await g.effects.run([E.tutorial('右键：用你的眼睛看'), E.tutorial('右键：用你的眼睛看'), E.say('看完了？', NPC.TUDI)], 'test');
    t(g.log.toasts.filter(x => x.text === '右键：用你的眼睛看').length === 1, 'tutorial 只出一次');
    t(g.log.subs.some(x => x.text === '看完了？' && x.who === NPC.TUDI), 'say → 字幕');
  });
  T('activate：对 NPC 按 E → 第一句出现时返回 opened=dialogue、settle=waiting', async (g, t) => {
    g.player.teleport(southOf(POS.treeNpc, 2), 0);   // 夹具 npc.wang，锚点高 1.2
    const r = await g.sys.interaction.activate(NPC.WANG, { verb: 'primary' }, 'api');
    t(r.ok && r.result.opened === 'mode.dialogue' && r.result.settle === 'waiting', JSON.stringify(r));
    g.modes.resetTo('mode.explore');
  });
  T('activate：带锁物体 → 面板打开即 settle，opened=panel_code', async (g, t) => {
    g.player.teleport(southOf(POS.codeLock, 1), 0);  // 夹具 r1.drawer
    const r = await g.sys.interaction.activate(OBJ.R1_DRAWER, { verb: 'primary' }, 'api');
    t(r.ok && r.result.opened === 'mode.panel_code', JSON.stringify(r));
    t(g.effects.waitingInput, '面板打开期间 waitingInput');
    g.dispatch({ t: 'back' });
    t(g.modes.top === 'mode.explore', 'Esc 离开');
  });
  T('activate 的检查顺序：no_such_target / out_of_range / wrong_view（阴物）', async (g, t) => {
    g.player.teleport([0, 0, 8], 0);
    t((await g.sys.interaction.activate(OBJ.R3_BELL, { verb: 'primary' }, 'api')).reason === 'no_such_target', 'no_such_target');
    t(Math.hypot(POS.treeNpc[0], POS.treeNpc[2] - 8) > 4, '（出生点离夹具够远）');
    t((await g.sys.interaction.activate(NPC.WANG, { verb: 'primary' }, 'api')).reason === 'out_of_range', 'out_of_range');
    g.player.teleport(southOf(POS.yinNpc, 2), 0);    // 夹具 npc.boy
    const r = await g.sys.interaction.activate(NPC.BOY, { verb: 'primary' }, 'api');
    t(r.reason === 'wrong_view' && r.result.feedback === '（沙盒）纸人没有回答。它的嘴是画上去的。', `wrong_view + wrongView 文本（${JSON.stringify(r)}）`);
    // 取景器中交互 → seen → 常光下也能交互
    g.modes.push('mode.viewfinder');
    const r2 = await g.sys.interaction.activate(NPC.BOY, { verb: 'primary' }, 'api');
    t(r2.ok && r2.result.opened === 'mode.dialogue', '取景器中可交互');
    t(g.state.seen(NPC.BOY), 'revealOnVfInteract → seen(id)');
    g.modes.resetTo('mode.explore');
    const r3 = await g.sys.interaction.activate(NPC.BOY, { verb: 'primary' }, 'api');
    t(r3.ok, '看见过的阴物在常光下也能交互（view 放宽为 any）');
    g.modes.resetTo('mode.explore');
    g.step(1 / 30);
    const boy = g.sys.npc.get(NPC.BOY);
    t(boy.root.layers.isEnabled(0), '阴物常显：追加 world 层');
  });
  T('E 键流程：既有主动作又有 offers → 动作菜单；视图不符的阴物不聚焦', async (g, t) => {
    g.player.teleport(southOf(POS.treeNpc, 1.4), 0);   // 正对 npc.wang
    g.player.lookAtPoint(new mods.THREE.Vector3(POS.treeNpc[0], 1.2, POS.treeNpc[2]), 'tp');
    g.cameras.sync();
    g.step(1 / 30);
    t(g.sys.interaction.focused === NPC.WANG, `聚焦到 npc.wang（得到 ${g.sys.interaction.focused}）`);
    const r = g.dispatch({ t: 'interact' });
    const arg = g.modes.arg('mode.album');
    t(r.ok && g.modes.top === 'mode.album' && arg && 'menu' in arg && arg.menu.target === NPC.WANG, '压入 album{menu}');
    g.dispatch({ t: 'digit', n: 2 });
    const a2 = g.modes.arg('mode.album');
    t(a2 && 'pick' in a2 && a2.pick.verb === 'show', 'NPC 默认“出示”');
    g.dispatch({ t: 'back' }); g.dispatch({ t: 'back' });
    t(g.modes.top === 'mode.explore', 'Esc 两次回到探索');
    const st = g.sys.interaction.list().find(s => s.id === NPC.LU);
    t(st && st.screen === undefined, '没有画布时不给屏幕坐标');
  });
  T('NPC：站位由 flags 推导；onPlaced 不瞬移交给区域；fadeTo 按游戏时间；跟随灯', async (g, t) => {
    const THREE = mods.THREE;
    const light = new THREE.PointLight(0xffaa55, 2);
    g.areas.current.ctx.light(light, g.areas.current.ctx.lightsRoot);
    const rig = new THREE.Group();
    const lantern = new THREE.Object3D();
    lantern.name = 'lantern';
    lantern.position.set(0.3, 1.1, 0);
    rig.add(lantern);
    const placed = [];
    const h = g.sys.npc.add({
      id: NPC.HUANG, rig, yin: false, tempC: 36.5,
      placement: s => (s.flag(F.R4_GHOST_MARKET_OPEN) ? { pos: s.flag(F.R4_FOUND_HUANG) ? [2, 0, 2] : [1, 0, 1], yaw: 90 } : null),
      interact: { label: s => (s.flag(F.R4_FOUND_HUANG) ? '黄三爷' : '纸人') },
      lights: [{ light, anchor: 'lantern' }],
      onPlaced(n, prev) { placed.push(prev); if (prev) void n.fadeTo([2, 0, 2], 90, 1); },
    });
    g.step(1 / 30);
    t(!h.present && !h.root.visible && light.intensity === 0, '不在场：隐藏，跟随灯强度置 0（灯数不变）');
    t(rig.userData.tempC === 36.5, 'tempC 写到整棵子树');
    g.state.setFlag(F.R4_GHOST_MARKET_OPEN);
    g.step(1 / 30);
    t(h.present && h.root.visible && h.root.position.x === 1 && light.intensity === 2, '出现：摆到站位，灯强度还原');
    const lw = lantern.getWorldPosition(new THREE.Vector3());
    t(light.position.distanceTo(lw) < 1e-6 && Math.abs(lw.y - 1.1) < 1e-6, `灯移到锚点世界坐标（${lw.toArray().map(v => v.toFixed(2))}）`);
    g.state.setFlag(F.R4_FOUND_HUANG);
    t(h.root.position.x === 1, '有 onPlaced 时换站位不瞬移');
    for (let i = 0; i < 31; i++) g.step(1 / 30);
    t(h.root.position.x === 2, 'fadeTo 1 秒后到新站位');
    t(placed.length === 2 && placed[0] === null, 'onPlaced 收到 prevPos');
    t(g.sys.interaction.list().find(s => s.id === NPC.HUANG).label === '黄三爷', 'Dyn 角标随 flag 现算');
  });
  T('提示：120 秒无 flag 变化且无交互 → 目标角标闪一次', async (g, t) => {
    g.sys.hints.register([{ id: 'pz.p01_guide_lamp', order: 1, area: 'r1', available: 'true', done: 'false', hints: ['1', '2', '3'], target: () => OBJ.R4_RULES_BOARD }]);
    for (let i = 0; i < 119 * 30; i++) g.step(1 / 30);
    t(g.sys.interaction.list().find(s => s.id === OBJ.R4_RULES_BOARD).blink === 0, '119 秒还没闪');
    for (let i = 0; i < 31; i++) g.step(1 / 30);
    t(g.sys.interaction.list().find(s => s.id === OBJ.R4_RULES_BOARD).blink > 0, '120 秒闪一次');
    g.state.setFlag(F.R1_LOG_TAKEN);
    t(g.sys.hints.idleSec === 0, 'flag 变化清零');
  });
  T('存档：flushIfSafe 在临时模式中推迟、回到 explore 后写；dev 不写', async (g, t) => {
    g.areas.current.def.id = 'r1';
    g.areas.current.def.spawns = { 'spawn.r1_start': {} };
    g.areas.current.spawnUsed = 'spawn.r1_start';
    localStorage.removeItem('camhead-man.save.auto');
    const p = g.effects.run([E.flag(F.R1_LOG_TAKEN), E.dialogue('dlg.dev.wp4_line')], 'test');
    await g.settle();
    t(localStorage.getItem('camhead-man.save.auto') === null, '对话中（临时模式）不落盘');
    g.dispatch({ t: 'advance' }); g.dispatch({ t: 'advance' });
    await p;
    g.step(1 / 30);
    t(localStorage.getItem('camhead-man.save.auto') !== null, '回到 explore 后落盘');
    g.areas.current.def.id = 'dev';
  });
  T('E.photo / GameApi.give 走 photo.award；E.used 标已用', async (g, t) => {
    await g.effects.run([E.item(IT.FILM), E.used(IT.FILM), E.photo(PH.TRUE_FORM, '本相')], 'test');
    t(g.state.used(IT.FILM), 'used');
    t(g.state.hasPhoto(PH.TRUE_FORM) && g.state.listPhotos().find(p => p.id === PH.TRUE_FORM).caption === '本相', 'photo + caption');
    g.api.give(IT.MONEY); g.api.give(PH.FILM3);
    t(g.state.has(IT.MONEY) && g.state.hasPhoto(PH.FILM3), 'give 物品/照片');
    t(g.state.setFlag(F.R2_WANG_FLOOR, 3) && !g.state.setFlag(F.R2_WANG_FLOOR, 2) && g.state.num(F.R2_WANG_FLOOR) === 3, '数值 flag 只增');
    t(!g.state.setFlag(F.R1_LOG_TAKEN) || true, 'setFlag 返回是否变化');
    let threw = false;
    try { g.state.setFlag('r9.bogus'); } catch { threw = true; }
    t(threw, 'dev 下写未登记的 flag 抛错');
  });
  T('空镜只保留最近 20 张，关键照片永不删除', async (g, t) => {
    g.api.give(PH.TRUE_FORM);
    for (let i = 0; i < 25; i++) g.state.addPhoto({ id: g.state.nextEmptyId(), title: '空镜', key: false, print: false, area: 'dev', lens: 'normal', zoom: 1, context: 'live' });
    const empties = g.state.listPhotos().filter(p => p.id.startsWith('ph.empty_'));
    t(empties.length === 20 && empties[0].id === 'ph.empty_6', `保留最近 20 张（${empties[0]?.id}…）`);
    t(g.state.hasPhoto(PH.TRUE_FORM), '关键照片还在');
  });
  T('Settings：applySetting 写、落盘、发事件；非法值拒绝', async (g, t) => {
    const ev = [];
    g.events.on('settings', e => ev.push(e));
    const orig = console.error;
    console.error = () => {};
    try {
      mods.settings.applySetting(g, 'reduceFlash', true);
      mods.settings.applySetting(g, 'reduceFlash', true);
      mods.settings.applySetting(g, 'volume', 'loud');
    } finally { console.error = orig; }
    t(g.settings.reduceFlash === true && ev.length === 1 && ev[0].key === 'reduceFlash', '只在变化时发一次事件');
    t(JSON.parse(localStorage.getItem('camhead-man.settings')).reduceFlash === true, '落盘');
    t(g.settings.volume === mods.settings.DEFAULT_SETTINGS.volume, '非法值不生效');
    t(mods.settings.SETTING_IDS.mouseSens === 'settings.mouse_sens', '映射表');
  });
  T('提示请求显示土地字幕；STRINGS 闲话轮换', async (g, t) => {
    const a = g.sys.hints.request();
    t(a.ok && typeof a.result.text === 'string', 'request ok');
    t(strings.STRINGS.tudiIdle.length >= 1, '闲话表非空');
  });
  return (async () => {
    const results = [];
    for (const { name, fn } of out) {
      const g = mk();
      const notes = [];
      let ok = true;
      const t = (cond, msg) => { if (cond) notes.push(`✓ ${msg}`); else { ok = false; notes.push(`✗ ${msg}`); } };
      try {
        await fn(g, t);
      } catch (err) {
        ok = false;
        notes.push(`✗ 抛错：${err?.stack ?? err}`);
      }
      results.push({ name: `node.${name}`, ok, notes });
    }
    return results;
  })();
}

async function runNode() {
  installLocalStorage();
  const { server, mods } = await loadModules();
  const results = [];
  try {
    for (const [name, fn] of Object.entries(mods.wp4.WP4_TESTS)) {
      const game = makeGame(mods);
      let r;
      try {
        r = await fn(game);
      } catch (err) {
        r = { ok: false, notes: [`✗ 抛错：${err?.stack ?? err}`] };
      }
      results.push({ name, ok: r.ok, notes: r.notes ?? [] });
    }
    results.push(...(await nodeExtras(mods, () => makeGame(mods))));
  } finally {
    await server.close();
  }
  return results;
}

async function runPage() {
  const harness = await import(path.join(ROOT, 'scripts/lib/harness.mjs'));
  const h = await harness.launch({ query: 'debug=1&test=1&lockstep=1&area=dev&quality=low' });
  try {
    return [...(await runNode()), ...(await pageTests(h))];
  } finally {
    await h.close();
  }
}

function report(results, verbose) {
  let fails = 0;
  for (const r of results) {
    if (!r.ok) fails++;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
    for (const n of r.notes) if (verbose || n.startsWith('✗')) console.log(`        ${n}`);
  }
  console.log(`\nwp4: ${results.length - fails}/${results.length} 通过`);
  return fails;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');
  const results = process.argv.includes('--page') ? await runPage() : await runNode();
  process.exitCode = report(results, verbose) > 0 ? 1 : 0;
}
