// owner: WP1
// WP1（core 运行时）的最小自测（ARCH §15.2）。两部分：
//   1. node 侧单元测试（现在就能跑）：用 vite 的 ssrLoadModule 直接加载 src/core 的 TS 模块，
//      别的 WP 的模块（game/expr、fx/materials、fx/environment、fx/warmup）换成本文件里的小替身，
//      只测 WP1 自己的逻辑：KEYMAP 与附录 A 逐格一致、ModeStack、GameTimers、CollisionWorld（动态碰撞体、raycast、reachable）、
//      PlayerController（walkTo 被挡/通过、lookAtPoint）、CameraRig（窄视口 frameRect 与 photo 相机一致、避障拉近）、
//      TriggerSystem、出生点距离、AreaManager.route、setLayerRecursive 跳过灯、InputManager 的右键切换/按住。
//   2. 页面内自测（M1c 起必须通过）：src/areas/dev/wp1.ts 用 registerSelftest 登记的 'wp1.*'，
//      在 ?debug=1&test=1&lockstep=1&area=dev 沙盒里经 window.__game.selftest(name) 调用（依赖全部 WP 的真实实现）。
//
// 用法：
//   node scripts/selftest/wp1.mjs            只跑 node 侧（M1b 期间的默认）
//   node scripts/selftest/wp1.mjs --page     再对已构建的 dist/ 跑页面内自测（需要先 vite build；--dist=<目录> 指定构建目录）
// 被 scripts/core.mjs 自动发现时：import 后调用 default export run(h)，h.call(method, ...args) 是 harness 的 API 调用函数（可选）。

import path from 'node:path';
import { launchChromium } from '../lib/browserSlots.mjs';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const name = 'wp1';
/** src/areas/dev/wp1.ts 登记的页面内自测（顺序即执行顺序）。 */
export const PAGE_TESTS = [
  'wp1.keymap',
  'wp1.layers_skip_lights',
  'wp1.modestack',
  'wp1.freeze',
  'wp1.lockstep',
  'wp1.timers',
  'wp1.temp',
  'wp1.frame_rect',
  'wp1.lights_frozen',
  'wp1.spawn_clearance',
  'wp1.route',
  'wp1.dyn_collider',
  'wp1.reachable',
  'wp1.camera_pull_in',
];

// ---------------------------------------------------------------- 替身（只在 node 侧单元测试里代替别的 WP 的模块）
const STUBS = {
  // game/expr：够本测试用的 FlagExpr 子集（标识符、!、&&、||、括号、true/false、temp(key)）
  '/game/expr': `
    export function compileCond(c, where) {
      if (c === undefined) return () => true;
      if (typeof c === 'function') return c;
      const toks = c.match(/temp\\([a-z0-9_]+\\)|[A-Za-z0-9_.]+|&&|\\|\\||!|\\(|\\)/g) ?? [];
      let i = 0;
      const peek = () => toks[i];
      const or = () => { let l = and(); while (peek() === '||') { i++; const r = and(); const a = l; l = s => a(s) || r(s); } return l; };
      const and = () => { let l = un(); while (peek() === '&&') { i++; const r = un(); const a = l; l = s => a(s) && r(s); } return l; };
      const un = () => { if (peek() === '!') { i++; const f = un(); return s => !f(s); } return prim(); };
      const prim = () => {
        const t = toks[i++];
        if (t === '(') { const f = or(); i++; return f; }
        if (t === 'true') return () => true;
        if (t === 'false') return () => false;
        if (t && t.startsWith('temp(')) { const k = t.slice(5, -1); return s => !!s.temp(k); }
        if (!t) throw new Error('bad cond ' + where);
        return s => s.flag(t);
      };
      return or();
    }`,
  '/fx/materials': `export function isSharedMaterial() { return false; } export const MATERIALS = {};`,
  '/fx/environment': `export function areaEnvironment() { return null; } export function resetEnvironmentCache() {}`,
  '/fx/warmup': `export async function warmupArea() {}`,
};

function stubPlugin() {
  return {
    name: 'wp1-selftest-stubs',
    enforce: 'pre',
    resolveId(src) {
      for (const k of Object.keys(STUBS)) if (src.endsWith(k) || src.endsWith(k + '.ts')) return '\0wp1stub:' + k;
      return null;
    },
    load(id) {
      if (id.startsWith('\0wp1stub:')) return STUBS[id.slice('\0wp1stub:'.length)];
      return null;
    },
  };
}

// ---------------------------------------------------------------- 断言
function makeChecker() {
  const results = [];
  const check = (label, cond, detail) => {
    results.push({ label, ok: !!cond, detail: cond ? undefined : detail });
  };
  const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
  return { results, check, near };
}

// ---------------------------------------------------------------- 附录 A 的期望（KEYMAP 逐格）
// 每格写按下时的 Action；只有“按住”类（右键 vf、录像机 Z/C）写松开时的 Action，其余松开为 null。
const P = a => ({ down: a, up: null });
const HOLD = (d, u) => ({ down: d, up: u });
const VF = HOLD({ t: 'vf', down: true }, { t: 'vf', down: false });
const digitsTo = (a, b, f) => Object.fromEntries(Array.from({ length: b - a + 1 }, (_, i) => [`Digit${a + i}`, P(f(a + i))]));
const ZOOM = { WheelUp: P({ t: 'zoom', dir: 1 }), WheelDown: P({ t: 'zoom', dir: -1 }) };
const TRANSPORT = {
  Space: P({ t: 'play' }),
  KeyZ: HOLD({ t: 'shuttle', dir: -1, down: true }, { t: 'shuttle', dir: -1, down: false }),
  KeyC: HOLD({ t: 'shuttle', dir: 1, down: true }, { t: 'shuttle', dir: 1, down: false }),
  Comma: P({ t: 'stepSec', dir: -1 }), Period: P({ t: 'stepSec', dir: 1 }),
  BracketLeft: P({ t: 'index', dir: -1 }), BracketRight: P({ t: 'index', dir: 1 }),
};
export const KEYMAP_EXPECT = {
  'mode.explore': { KeyE: P({ t: 'interact' }), MouseRight: VF, Tab: P({ t: 'album' }), KeyJ: P({ t: 'journal' }), KeyH: P({ t: 'hint' }), Escape: P({ t: 'back' }) },
  'mode.viewfinder': {
    KeyE: P({ t: 'interact' }), MouseLeft: P({ t: 'shutter' }), MouseRight: VF, KeyQ: P({ t: 'lens' }), ...ZOOM, KeyR: P({ t: 'rewind' }),
    Tab: P({ t: 'album' }), KeyJ: P({ t: 'journal' }), KeyH: P({ t: 'hint' }), Escape: P({ t: 'back' }),
    // 叠在面板上时以 pass 下传的传输键与频道键（附录 A 表下第一条）
    ...TRANSPORT, ...digitsTo(0, 9, n => ({ t: 'digit', n })),
  },
  'mode.replay': {
    KeyE: P({ t: 'interact' }), MouseLeft: P({ t: 'shutter' }), MouseRight: VF, KeyQ: P({ t: 'lens' }), ...ZOOM, KeyR: P({ t: 'rewind' }),
    KeyF: P({ t: 'present' }), Space: P({ t: 'play' }), KeyZ: P({ t: 'seekRel', sec: -5 }), KeyC: P({ t: 'seekRel', sec: 5 }),
    Comma: P({ t: 'stepSec', dir: -1 }), Period: P({ t: 'stepSec', dir: 1 }), KeyH: P({ t: 'hint' }), Escape: P({ t: 'back' }),
  },
  'mode.panel_vcr': { KeyE: P({ t: 'interact' }), MouseRight: VF, ...TRANSPORT, KeyH: P({ t: 'hint' }), Escape: P({ t: 'back' }) },
  'mode.panel_console': { KeyE: P({ t: 'interact' }), MouseRight: VF, ...digitsTo(1, 5, n => ({ t: 'digit', n })), KeyH: P({ t: 'hint' }), Escape: P({ t: 'back' }) },
  'mode.panel_code': {
    ...digitsTo(0, 9, n => ({ t: 'digit', n })), WheelUp: P({ t: 'wheel', dir: 1 }), WheelDown: P({ t: 'wheel', dir: -1 }),
    Enter: P({ t: 'confirm' }), Backspace: P({ t: 'erase' }), Escape: P({ t: 'back' }),
  },
  'mode.panel_naming': { ...digitsTo(1, 6, n => ({ t: 'choose', k: n })), Escape: P({ t: 'back' }) },
  // M4 第 2 轮：对话与过场里 Esc = 暂停菜单（附录 A）
  'mode.dialogue': { KeyE: P({ t: 'advance' }), Space: P({ t: 'advance' }), Enter: P({ t: 'advance' }), ...digitsTo(1, 4, n => ({ t: 'choose', k: n })), Escape: P({ t: 'back' }) },
  'mode.album': {
    ...digitsTo(1, 2, n => ({ t: 'digit', n })),
    ArrowUp: P({ t: 'nav', dx: 0, dy: -1 }), ArrowDown: P({ t: 'nav', dx: 0, dy: 1 }), ArrowLeft: P({ t: 'nav', dx: -1, dy: 0 }), ArrowRight: P({ t: 'nav', dx: 1, dy: 0 }),
    Enter: P({ t: 'confirm' }), Tab: P({ t: 'album' }), KeyJ: P({ t: 'journal' }), Escape: P({ t: 'back' }),
  },
  'mode.journal': { Tab: P({ t: 'album' }), KeyJ: P({ t: 'journal' }), Escape: P({ t: 'back' }) },
  'mode.tripod': { KeyE: P({ t: 'interact' }), MouseLeft: P({ t: 'shutter' }) },
  'mode.cutscene': { MouseLeft: P({ t: 'shutter' }), ...ZOOM, Space: P({ t: 'play' }), Escape: P({ t: 'back' }) },
  'mode.pause': { Escape: P({ t: 'back' }) },
};

/** KEYMAP 与期望逐格比较，返回差异列表（node 与页面内自测共用同一套期望）。 */
export function diffKeymap(KEYMAP) {
  const out = [];
  const modes = new Set([...Object.keys(KEYMAP), ...Object.keys(KEYMAP_EXPECT)]);
  for (const m of modes) {
    const row = KEYMAP[m] ?? {};
    const exp = KEYMAP_EXPECT[m] ?? {};
    const keys = new Set([...Object.keys(row), ...Object.keys(exp)]);
    for (const k of keys) {
      const b = row[k];
      const e = exp[k];
      if (!b) { out.push(`${m} ${k}: 缺绑定`); continue; }
      if (!e) { out.push(`${m} ${k}: 多余绑定`); continue; }
      const d = JSON.stringify(b(true));
      const u = JSON.stringify(b(false));
      if (d !== JSON.stringify(e.down)) out.push(`${m} ${k} 按下: ${d} ≠ ${JSON.stringify(e.down)}`);
      if (u !== JSON.stringify(e.up)) out.push(`${m} ${k} 松开: ${u} ≠ ${JSON.stringify(e.up)}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- node 侧单元测试
export async function nodeTests() {
  const { createServer } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')).href);
  const server = await createServer({
    root: ROOT, configFile: false, logLevel: 'error', appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [stubPlugin()],
  });
  const { results, check, near } = makeChecker();
  try {
    const load = p => server.ssrLoadModule(p);
    const THREE = await load('three');
    const { EventBus } = await load('/src/core/events.ts');
    const { KEYMAP } = await load('/src/core/actions.ts');
    const { ModeStack } = await load('/src/core/modes.ts');
    const { GameTimers } = await load('/src/core/timers.ts');
    const { CollisionWorld, capsuleVsObb, shapeToObb } = await load('/src/core/collision.ts');
    const { PlayerController } = await load('/src/core/player.ts');
    const { CameraRig } = await load('/src/core/cameras.ts');
    const { TriggerSystem, spawnClearanceIssues } = await load('/src/core/triggers.ts');
    const { AreaManager } = await load('/src/core/area.ts');
    const { setLayerRecursive, LAYER } = await load('/src/core/layers.ts');
    const { InputManager } = await load('/src/core/input.ts');
    const { Capsule } = await load('three/addons/math/Capsule.js');

    // —— KEYMAP ——
    const km = diffKeymap(KEYMAP);
    check('KEYMAP 与附录 A 逐格一致', km.length === 0, km.join('\n'));

    // —— InputManager.translate：右键切换/按住 ——
    {
      const g = { url: { test: true, nolock: false }, settings: { vfMode: 'toggle', mouseSens: 1, invertY: false }, modes: { top: 'mode.explore' } };
      const im = new InputManager(g);
      check('toggle：右键按下 → {vf}', JSON.stringify(im.translate('MouseRight', true)) === '{"t":"vf"}');
      check('toggle：右键松开 → 无', im.translate('MouseRight', false) === null);
      g.settings.vfMode = 'hold';
      check('hold：右键按下 → {vf,down:true}', JSON.stringify(im.translate('MouseRight', true)) === '{"t":"vf","down":true}');
      check('hold：右键松开 → {vf,down:false}', JSON.stringify(im.translate('MouseRight', false)) === '{"t":"vf","down":false}');
      g.modes.top = 'mode.dialogue';
      check('对话里 E → advance', JSON.stringify(im.translate('KeyE', true)) === '{"t":"advance"}');
      check('对话里 Tab 无绑定', im.translate('Tab', true) === null);
      // 移动轴：W+D 归一化、Shift、setMove 覆盖
      im.inject('KeyW', true);
      im.inject('KeyD', true);
      const m = im.move;
      check('W+D → 归一化的前右', near(m.x, Math.SQRT1_2) && near(m.z, -Math.SQRT1_2) && !m.sprint, JSON.stringify(m));
      im.setMove({ x: 0, z: 1, sprint: false });
      check('setMove 覆盖键盘', im.move.z === 1 && im.move.x === 0);
      im.setMove(null);
      im.inject('KeyW', false);
      im.inject('KeyD', false);
      check('松开后 moveActive 为假', !im.moveActive());
      // 队列：beginFrame 定格、takeFrameButtons 取走（先清掉上面移动键留下的事件）
      im.beginFrame();
      im.takeFrameButtons();
      im.inject('KeyE', true);
      im.inject('KeyE', false);
      im.beginFrame();
      const evs = im.takeFrameButtons();
      check('按钮事件入队并在 beginFrame 定格', evs.length === 2 && evs[0].b === 'KeyE' && evs[0].down && !evs[1].down, JSON.stringify(evs));
      im.suspended = true;
      im.inject('KeyE', true);
      im.beginFrame();
      check('锁输入时丢弃按钮', im.takeFrameButtons().length === 0);
    }

    // —— ModeStack ——
    {
      const log = [];
      const g = {
        events: new EventBus(),
        effects: { cancelAll: r => log.push(`cancel:${r}`) },
        sys: { replay: { active: null, exit: r => log.push(`replayExit:${r}`) } },
        cameras: { active: 'tp' },
        input: { applyPolicy: p => log.push(`policy:${p}`) },
      };
      const onPanel = s => s.includes('mode.panel_vcr') || s.includes('mode.panel_console');
      const PROPS = {
        'mode.explore': { pointer: 'lock', camera: 'tp', move: 'normal', look: true },
        'mode.viewfinder': { pointer: s => (onPanel(s) ? 'free' : 'lock'), camera: 'fp', move: s => (onPanel(s) ? 'none' : 'slow'), look: s => !onPanel(s) },
        'mode.replay': { transient: true, pointer: 'lock', camera: 'fp', move: 'slow', look: true },
        'mode.panel_vcr': { transient: true, camera: 'fixed' },
        'mode.panel_console': { transient: true, camera: 'fixed' },
        'mode.panel_code': { transient: true },
        'mode.panel_naming': { transient: true },
        'mode.dialogue': { transient: true },
        'mode.album': { transient: true, freezesWorld: true },
        'mode.journal': { transient: true, freezesWorld: true },
        'mode.tripod': { transient: true, pointer: 'lock', camera: 'fixed', move: 'body' },
        'mode.cutscene': { transient: true, camera: 'fixed' },
        'mode.pause': { freezesWorld: true },
      };
      const handled = [];
      const ms = new ModeStack(g);
      for (const [id, p] of Object.entries(PROPS)) {
        ms.register({
          id, transient: p.transient ?? false, freezesWorld: p.freezesWorld ?? false, pointer: p.pointer ?? 'free',
          camera: p.camera ?? 'inherit', move: p.move ?? 'none', look: p.look ?? false,
          enter: (prev, arg) => log.push(`enter:${id}<${prev}${arg ? ':' + JSON.stringify(arg) : ''}`),
          exit: next => log.push(`exit:${id}>${next}`),
          handle: a => {
            handled.push(`${id}:${a.t}`);
            if (a.t === 'hint' && id !== 'mode.explore') return { ok: false, pass: true };
            if (id === 'mode.viewfinder' && a.t === 'play') return { ok: false, pass: true };
            return a.t === 'hint' || (id === 'mode.panel_vcr' && a.t === 'play') ? { ok: true } : { ok: false, reason: 'mode_disallows' };
          },
          update: () => log.push(`update:${id}`),
        });
      }
      let dupThrew = false;
      try { ms.register({ id: 'mode.pause' }); } catch { dupThrew = true; }
      check('重复登记在 dev 下抛错', dupThrew);
      const modeEvents = [];
      g.events.on('mode', e => modeEvents.push(e.top));
      check('初始栈 [explore]', ms.top === 'mode.explore' && ms.stack.length === 1);
      check('pop 栈底 → mode_disallows', ms.pop().reason === 'mode_disallows');
      check('push explore → bad_args', ms.push('mode.explore').reason === 'bad_args');
      ms.push('mode.viewfinder');
      check('push viewfinder：相机 fp、策略 lock', g.cameras.active === 'fp' && log.includes('policy:lock') && log.includes('enter:mode.viewfinder<mode.explore'));
      ms.push('mode.album', { pick: { target: 'r1.gate', verb: 'use' } });
      check('album 冻结世界、transient', ms.freezesWorld() && ms.isTransient());
      check('arg() 取回 push 的参数', ms.arg('mode.album')?.pick?.verb === 'use');
      check('album 相机 inherit → fp', g.cameras.active === 'fp');
      check('pop(expect 不符) → mode_disallows', ms.pop('mode.journal').reason === 'mode_disallows' && ms.top === 'mode.album');
      check('pop(album) → 回到 viewfinder', ms.pop('mode.album').ok && ms.top === 'mode.viewfinder');
      check('mode 事件按变化发出', modeEvents.join(',') === 'mode.viewfinder,mode.album,mode.viewfinder', modeEvents.join(','));
      // 面板叠加：viewfinder 在 panel 上 → move none、look false、pointer free；传输键 pass 给面板
      ms.pop();
      ms.push('mode.panel_vcr');
      ms.push('mode.viewfinder');
      check('面板上的取景器：move none、look 关', ms.moveMode() === 'none' && ms.lookEnabled() === false);
      check('面板上的取景器：指针 free', log[log.length - 1] === 'policy:free', log.slice(-3).join(','));
      handled.length = 0;
      const r = ms.dispatch({ t: 'play' });
      check('play 以 pass 下传给面板', r.ok && handled.join(',') === 'mode.viewfinder:play,mode.panel_vcr:play', handled.join(','));
      handled.length = 0;
      const h = ms.dispatch({ t: 'hint' });
      check('H 一路 pass 到 explore', h.ok && handled[handled.length - 1] === 'mode.explore:hint', handled.join(','));
      log.length = 0;
      ms.update(0.1);
      check('overlay：面板与取景器都 update', log.join(',') === 'update:mode.panel_vcr,update:mode.viewfinder', log.join(','));
      // popToBase：弹掉面板，停在 explore；回放 → 取景器；对话不弹
      ms.popToBase();
      check('popToBase：面板上的取景器一起弹到 explore', ms.top === 'mode.explore', ms.stack.join(','));
      ms.push('mode.viewfinder');
      ms.push('mode.replay');
      ms.push('mode.pause');
      ms.popToBase();
      check('popToBase：回放 → 取景器', ms.top === 'mode.viewfinder', ms.stack.join(','));
      ms.push('mode.dialogue');
      ms.popToBase();
      check('popToBase：不弹对话', ms.top === 'mode.dialogue');
      // resetTo：先 cancelAll('reset')，再自顶向下逐层 exit
      log.length = 0;
      g.sys.replay.active = { point: 'rp.x' };
      ms.resetTo('mode.explore');
      g.sys.replay.active = null;
      check('resetTo：cancelAll 在前、replay.exit(mode)、自顶向下 exit', log[0] === 'cancel:reset' && log[1] === 'replayExit:mode'
        && log.indexOf('exit:mode.dialogue>mode.viewfinder') < log.indexOf('exit:mode.viewfinder>mode.explore'), log.join(','));
      check('resetTo 后只剩 explore、相机 tp', ms.stack.length === 1 && g.cameras.active === 'tp');
      check('暂停不叠两层', ms.push('mode.pause').ok && !ms.push('mode.pause').ok && ms.stack.length === 2);
      ms.pop();
      check('tripod：move body、相机 fixed', ms.push('mode.tripod').ok && ms.moveMode() === 'body' && g.cameras.active === 'fixed');
      ms.pop();
    }

    // —— GameTimers ——
    {
      const t = new GameTimers();
      const log = [];
      t.after(1, () => log.push('a1'));
      const cancel = t.after(0.5, () => log.push('x'));
      t.every(0.4, () => log.push('e'));
      cancel();
      t.update(0.3);
      check('计时未到不触发', log.length === 0);
      t.update(0.5);
      check('every 0.4 在 0.8 触发两次', log.filter(x => x === 'e').length === 2, log.join(','));
      t.update(0.3);
      check('after 1 触发一次、取消的不触发', log.filter(x => x === 'a1').length === 1 && !log.includes('x'), log.join(','));
      t.clear();
      check('clear 后为空', t.size === 0);
    }

    // —— 碰撞世界：地面 + x=0 的墙（z∈[-0.5,0.5] 留 1m 门洞）+ 门洞里的动态门 ——
    const flags = {};
    const temps = {};
    const state = { flag: id => !!flags[id], temp: k => temps[k] ?? false };
    const events = new EventBus();
    const colGame = { events, state };
    const col = new CollisionWorld(colGame);
    const colliderRoot = new THREE.Group();
    const box = (c, s) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      m.position.set(...c);
      m.scale.set(...s);
      colliderRoot.add(m);
    };
    box([0, -0.1, 0], [30, 0.2, 30]);                 // 地面，顶面 y=0
    box([0, 1.25, -5.25], [0.2, 2.5, 9.5]);           // 墙 z∈[-10,-0.5]
    box([0, 1.25, 5.25], [0.2, 2.5, 9.5]);            // 墙 z∈[0.5,10]
    box([-3.5, 1.25, -10], [7, 2.5, 0.2]);            // 西侧小院的北墙
    box([-3.5, 1.25, 10], [7, 2.5, 0.2]);             // 南墙
    box([-7, 1.25, 0], [0.2, 2.5, 20]);               // 西墙：西侧是封闭的 7×20 小院，只能经门洞出去
    col.build(colliderRoot);
    const door = col.addDynamic('dev.door', { box: { center: [0, 1.25, 0], size: [0.2, 2.5, 1.0] } }, s => !s.flag('door_open'));
    const cap = (x, y, z) => new Capsule(new THREE.Vector3(x, y + 0.3, z), new THREE.Vector3(x, y + 1.45, z), 0.3);
    {
      const r = col.capsule(cap(-3, -0.02, 3));
      check('胶囊略陷进地面 → 向上推', r && r.normal.y > 0.9 && r.depth > 0.01, JSON.stringify(r));
      const w = col.capsule(cap(-0.25, 0.05, 3));
      check('贴墙 → 水平推出（-x）', w && w.normal.x < -0.5, JSON.stringify(w));
      const d = col.capsule(cap(-0.3, 0.05, 0));
      check('动态门关着 → 挡人', d && d.normal.x < -0.5, JSON.stringify(d));
      const ray = col.raycast(new THREE.Vector3(-3, 1, 0), new THREE.Vector3(1, 0, 0), 10);
      check('raycast 命中动态门并返回 key', ray && ray.key === 'dev.door' && near(ray.distance, 2.9, 1e-2), JSON.stringify(ray));
      check('raycast ignoreKeys 跳过目标自身', col.raycast(new THREE.Vector3(-3, 1, 0), new THREE.Vector3(1, 0, 0), 10, { ignoreKeys: ['dev.door'] }) === null);
      check('raycast 不超过 far', col.raycast(new THREE.Vector3(-3, 1, 0), new THREE.Vector3(1, 0, 0), 2) === null);
      check('reachable：门关着时两侧不连通', col.reachable([-3, 0, 0], [3, 0, 0]) === false);
      check('reachable：同侧连通', col.reachable([-3, 0, 0], [-3, 0, 8]) === true);
      check('reachable：目标在墙里 → false', col.reachable([-3, 0, 0], [0, 0, 5]) === false);
      flags.door_open = true;
      events.emit('flag', { id: 'door_open', value: true, prev: false });
      check('flag 事件后动态门停用', door.enabled === false);
      check('门开后可以穿过门洞', !col.capsule(cap(0, 0.05, 0)));
      check('reachable：门开后两侧连通', col.reachable([-3, 0, 0], [3, 0, 0]) === true);
      flags.door_open = false;
      events.emit('flag', { id: 'door_open', value: false, prev: true });
      check('再关上又挡人', door.enabled === true && !!col.capsule(cap(0, 0.05, 0)));
      // seeThrough：挡人但 skipSeeThrough 的射线穿过
      const glass = col.addDynamic('dev.glass', { box: { center: [-5, 1.25, 5], size: [1, 2.5, 0.1] } }, () => true, { seeThrough: true });
      const r1 = col.raycast(new THREE.Vector3(-5, 1, 3), new THREE.Vector3(0, 0, 1), 5);
      const r2 = col.raycast(new THREE.Vector3(-5, 1, 3), new THREE.Vector3(0, 0, 1), 5, { skipSeeThrough: true });
      check('seeThrough：默认射线命中、skipSeeThrough 穿过', r1?.key === 'dev.glass' && (r2 === null || r2.key !== 'dev.glass'), JSON.stringify([r1, r2]));
      check('seeThrough：照样挡人', !!col.capsule(cap(-5, 0.05, 5.1)));
      glass.remove();
      // 旋转盒与墙换算
      const obb = shapeToObb({ wall: { a: [0, 0], b: [0, 4], y0: 0, height: 2 } });
      const hit = capsuleVsObb(cap(0.35, 0.05, 2), obb);
      check('wall(a,b) 换算：沿 z 的墙挡住 x=0.35 的胶囊', hit && hit.normal.x > 0.5, JSON.stringify(hit));
    }

    // —— PlayerController：walkTo 被墙/门挡住、门开后通过；lookAtPoint ——
    {
      const input = { ov: null, setMove(m) { this.ov = m; }, get move() { return this.ov ?? { x: 0, z: 0, sprint: false }; } };
      const g = {
        collision: col, input, time: 0, lockstep: true,
        cameras: { fixedYaw: () => 0, tpCameraPosition: (y, p, out) => out.set(0, 1.9, 2.6) },
        areas: { current: {}, isLoading: () => false },
        modes: { moveMode: () => 'normal' },
      };
      const pc = new PlayerController(g);
      const stepOnce = () => {
        pc.driveWalk();
        pc.update(1 / 30, g.input.move, 'normal');
        g.time += 1 / 30;
      };
      g.drive = async done => {
        for (let n = 0; !done() && n < 5000; n++) {
          stepOnce();
          if (n % 60 === 59) await null;
        }
      };
      pc.teleport([-3, 1.5, 3], 90);
      check('teleport 贴地', near(pc.position.y, 0, 0.02) && pc.yaw === 90, JSON.stringify(pc.position));
      for (let i = 0; i < 10; i++) stepOnce();
      check('重力 + 着地', pc.onGround && near(pc.position.y, 0, 0.05), JSON.stringify(pc.position));
      // 回归：直线跨过大地面四边形的对角线（Octree 棱边接触的法线略斜）时不应被横推
      pc.teleport([-3, 0, 6], 0);
      let drift = 0;
      for (let i = 0; i < 150; i++) {
        pc.update(1 / 30, { x: 0, z: -1, sprint: false }, 'normal');
        drift = Math.max(drift, Math.abs(pc.position.x + 3));
      }
      check('直走跨过地面对角线不横漂', drift < 0.01 && pc.position.z < -3, `drift=${drift} z=${pc.position.z}`);
      pc.teleport([-3, 0, 3], 90);
      let r = await pc.walkTo(-3, -4);
      check('空地上 walkTo 到达', r.ok && Math.hypot(r.pos[0] + 3, r.pos[2] + 4) < 0.2, JSON.stringify(r));
      pc.teleport([-3, 0, 3]);
      r = await pc.walkTo(3, 3);
      check('walkTo 被墙挡住（1 秒无进展）', !r.ok && r.pos[0] < 0, JSON.stringify(r));
      pc.teleport([-2, 0, 0]);
      r = await pc.walkTo(2, 0);
      check('动态门关着：walkTo 被挡', !r.ok && r.pos[0] < 0, JSON.stringify(r));
      flags.door_open = true;
      events.emit('flag', { id: 'door_open', value: true, prev: false });
      r = await pc.walkTo(2, 0);
      check('门开后 walkTo 通过门洞', r.ok && r.pos[0] > 1.5, JSON.stringify(r));
      flags.door_open = false;
      events.emit('flag', { id: 'door_open', value: false, prev: true });
      check('走路时身体朝向移动方向（东 = 90°）', Math.abs(((pc.bodyYaw - 90 + 540) % 360) - 180) < 5, String(pc.bodyYaw));
      pc.teleport([0, 0, 5], 0);
      // 镜头在身体中轴前方 0.18m：转身后镜头位置变了，要迭代修正，最后镜头中心射线必须正好穿过目标
      const target = new THREE.Vector3(10, 1.85, 5);
      let la = pc.lookAtPoint(target, 'fp');
      const e2 = pc.eye;
      const miss = new THREE.Ray(e2, pc.forward).distanceToPoint(target);
      check('lookAtPoint(fp)：正东 → yaw≈90、中心射线穿过目标', near(pc.yaw, 90, 2) && miss < 1e-3 && !la.clamped, `${pc.yaw} ${pc.pitch} miss=${miss}`);
      const eye = pc.eye;
      la = pc.lookAtPoint(new THREE.Vector3(eye.x, eye.y + 50, eye.z - 1), 'fp');
      check('lookAtPoint(fp)：正上方被钳到 60° 且 clamped', pc.pitch === 60 && la.clamped, String(pc.pitch));
      la = pc.lookAtPoint(new THREE.Vector3(0, 0, 5 - 0.5), 'tp');
      check('lookAtPoint(tp)：脚下被钳到 −35°', pc.pitch === -35 && la.clamped, String(pc.pitch));
      const f = pc.forward;
      check('forward 是单位向量', near(f.length(), 1));
    }

    // —— CameraRig：窄视口 frameRect 与 photo 相机一致；避障拉近 ——
    {
      const pl = { position: new THREE.Vector3(), yaw: 0, pitch: 0, teleportSeq: 0, eyeFor: (y, out) => out.set(0, 1.85, 0) };
      const g = {
        player: pl, collision: new CollisionWorld({ events: new EventBus(), state }),
        sys: { viewfinder: { on: true, lens: 'normal' }, replay: { active: null } },
        modes: { has: () => false },
      };
      const rig = new CameraRig(g);
      const consistent = (W, H, zoom) => {
        rig.setViewport(W, H);
        rig.setZoom(zoom);
        rig.active = 'fp';
        rig.sync();
        const fr = rig.frameRect();
        let worst = 0;
        for (const p of [[0.7, -0.4, -3], [-1.2, 0.8, -4], [0.1, 0.1, -10]]) {
          const v = new THREE.Vector3(...p).add(new THREE.Vector3(0, 1.85, 0));
          const a = v.clone().project(rig.photo);
          const b = v.clone().project(rig.fp);
          const sx = ((b.x + 1) / 2) * W;
          const sy = ((1 - b.y) / 2) * H;
          const fx = ((sx - fr.x) / fr.w) * 2 - 1;
          const fy = 1 - ((sy - fr.y) / fr.h) * 2;
          worst = Math.max(worst, Math.abs(fx - a.x), Math.abs(fy - a.y));
        }
        return { fr, worst };
      };
      const n = consistent(600, 800, 1);
      check('3:4 视口：画框与视口同宽、居中', n.fr.w === 600 && near(n.fr.h, 450) && near(n.fr.y, 175), JSON.stringify(n.fr));
      check('3:4 视口：画框内画面与 photo 相机一致', n.worst < 1e-6, String(n.worst));
      const z = consistent(600, 800, 3);
      check('3:4 视口 3×：仍一致', z.worst < 1e-6, String(z.worst));
      const w = consistent(1600, 900, 2);
      check('16:9 视口：画框与视口同高、fp 垂直 fov 50', w.fr.h === 900 && near(w.fr.w, 1200) && near(rig.fp.fov, 50) && w.worst < 1e-6, JSON.stringify(w));
      // 避障：身后 1m 处一面墙 → 吊臂拉近到最近 0.9；移开后恢复满长（平滑）
      const cr = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      m.position.set(0, 2, 1.1);
      m.scale.set(6, 4, 0.2);
      cr.add(m);
      g.collision.build(cr);
      rig.active = 'tp';
      pl.pitch = -6;
      rig.update(1 / 30);
      check('身后贴墙：吊臂立即拉近到 ≥0.9 且在墙前', rig.boomLength >= 0.9 - 1e-6 && rig.boomLength < 1.0 && rig.tp.position.z < 1.0, `${rig.boomLength} ${rig.tp.position.z}`);
      g.collision.clear();
      rig.update(1 / 30);
      const partial = rig.boomLength;
      for (let i = 0; i < 30; i++) rig.update(1 / 30);
      check('墙移开后平滑放远（不是一帧跳回）', partial < 2.4 && rig.boomLength > 2.6, `${partial} → ${rig.boomLength}`);
      // 掩码
      rig.update(1 / 30);
      check('fp 常光掩码含 yin/faded_text、不含 self_head', rig.fp.layers.isEnabled(LAYER.yin) && rig.fp.layers.isEnabled(LAYER.faded_text) && !rig.fp.layers.isEnabled(LAYER.self_head));
      g.sys.viewfinder.lens = 'ir';
      rig.update(1 / 30);
      check('fp 红外掩码含 ir_only、不含 faded_text', rig.fp.layers.isEnabled(LAYER.ir_only) && !rig.fp.layers.isEnabled(LAYER.faded_text));
      check('tp 掩码 world + self_head', rig.tp.layers.isEnabled(LAYER.world) && rig.tp.layers.isEnabled(LAYER.self_head) && !rig.tp.layers.isEnabled(LAYER.yin));
      rig.setFixedPose({ pos: [0, 2, 0], target: [0, 2, -1] }, 0, { role: 'ch1', layers: ['yin'] });
      check('fixed ch1 角色：不含 self_head，含额外 yin', !rig.fixed.layers.isEnabled(LAYER.self_head) && rig.fixed.layers.isEnabled(LAYER.yin));
      check('fixedYaw：看向 −z 为 0°', near(rig.fixedYaw(), 0, 1e-6));
    }

    // —— setLayerRecursive 跳过灯 ——
    {
      const grp = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry());
      const light = new THREE.PointLight();
      light.layers.enableAll();
      grp.add(mesh, light);
      setLayerRecursive(grp, 'yin');
      check('setLayerRecursive：网格只在 yin、灯仍 enableAll', mesh.layers.mask === 1 << LAYER.yin && light.layers.mask === 0xffffffff >>> 0 || light.layers.mask === -1 || light.layers.mask === 0xffffffff, `${mesh.layers.mask} ${light.layers.mask}`);
    }

    // —— TriggerSystem ——
    {
      const pl = { capsule: cap(0, 0, 0) };
      const ran = [];
      const g = {
        player: pl, state, api: {}, frameDt: () => 1 / 30,
        effects: { runHandler: (h, origin) => { ran.push(origin); return Promise.resolve('done'); } },
      };
      const ts = new TriggerSystem(g);
      const stay = [];
      ts.add({ key: 't1', box: { center: [5, 1, 0], size: [2, 2, 2] }, onEnter: [], onExit: [], onStay: (_g, dt) => stay.push(dt) });
      ts.add({ key: 't2', box: { center: [5, 1, 0], size: [2, 2, 2] }, when: 'door_open', once: true, onEnter: [] });
      const direct = [];
      ts.addDirect('exit.x', { center: [-5, 1.25, 0], size: [1.5, 2.5, 1.5] }, () => direct.push('x'));
      const moveTo = x => { pl.capsule = cap(x, 0, 0); ts.update(); };
      moveTo(0);
      check('触发体外不触发', ran.length === 0);
      moveTo(3.8);
      check('胶囊边缘碰到触发体 → onEnter（when 为假的不触发）', ran.join(',') === 'trigger:t1:enter', ran.join(','));
      moveTo(4.5);
      check('在里面 → onStay 带 dt', stay.length === 1 && near(stay[0], 1 / 30));
      flags.door_open = true;
      moveTo(4.6);
      check('when 变真 → 第二个触发体 onEnter', ran.includes('trigger:t2:enter'));
      moveTo(0);
      check('离开 → onExit；once 的已移除', ran.includes('trigger:t1:exit') && !ts.keys().includes('t2'), ran.join(',') + ' / ' + ts.keys().join(','));
      flags.door_open = false;
      moveTo(-4.5);
      check('出入口触发体直接回调', direct.length === 1);
      const bad = ts.assertSpawnClearance({ 'spawn.dev_start': { pos: [-3.5, 0, 0], yaw: 0 }, 'spawn.dev_lookdev': { pos: [-2, 0, 0], yaw: 0 } });
      check('出生点离触发体 < 0.8m 被列出、≥0.8m 不列', bad.length === 1 && bad[0].startsWith('spawn.dev_start'), bad.join('\n'));
      check('spawnClearanceIssues 按 3D 距离（楼上楼下不算）', spawnClearanceIssues({ 'spawn.a': { pos: [0, 5.6, 0], yaw: 0 } }, [{ key: 'e', box: { center: [0, 1.25, 0], size: [1.5, 2.5, 1.5] } }]).length === 0);
      ts.clearArea();
      check('clearArea 清空', ts.keys().length === 0);
    }

    // —— AreaManager.route ——
    {
      const defs = [
        { id: 'r1', name: 'A', spawns: { 'spawn.a': { pos: [0, 0, 0], yaw: 0 } }, exits: [{ id: 'exit.a_b', to: 'spawn.b' }, { id: 'exit.a_c', to: 'spawn.c', when: 'gate' }], post: 'dev', build() {} },
        { id: 'r2', name: 'B', spawns: { 'spawn.b': { pos: [0, 0, 0], yaw: 0 } }, exits: [{ id: 'exit.b_a', to: 'spawn.a' }], post: 'dev', build() {} },
        { id: 'r3', name: 'C', spawns: { 'spawn.c': { pos: [0, 0, 0], yaw: 0 } }, exits: [{ id: 'exit.c_a', to: 'spawn.a' }, { id: 'exit.c_d', to: 'spawn.d' }], post: 'dev', build() {} },
        { id: 'r4', name: 'D', spawns: { 'spawn.d': { pos: [0, 0, 0], yaw: 0 } }, exits: [{ id: 'exit.d_c', to: 'spawn.c' }], post: 'dev', build() {} },
      ];
      const am = new AreaManager({ state }, defs);
      let r = am.route('r2', 'r4');
      check('route：条件不满足时返回第一个被挡出口', !r.ok && r.exit === 'exit.a_c', JSON.stringify(r));
      flags.gate = true;
      r = am.route('r2', 'r4');
      check('route：满足后逐跳 hops', r.ok && r.hops.join(',') === 'exit.b_a,exit.a_c,exit.c_d', JSON.stringify(r));
      check('route：同区域 hops 为空', am.route('r1', 'r1').ok && am.route('r1', 'r1').hops.length === 0);
      check('spawnArea', am.spawnArea('spawn.d') === 'r4');
      flags.gate = false;
      check('route：不连通且无被挡出口 → exit null', (() => { const x = new AreaManager({ state }, [defs[1], { ...defs[3], exits: [] }]).route('r2', 'r4'); return !x.ok && x.exit === null; })());
    }
    // —— Game 帧循环：冻结、锁步、advance(until)、settle、drive 不重入（对 Game.prototype 用假的 this，不建渲染器）——
    await gameLoopTests(load, check, near);

    // —— M4：动态分辨率在 60Hz 垂直同步下能升回来（虚拟时钟） ——
    {
      const { DynResGovernor } = await load('/src/core/render.ts');
      const g = new DynResGovernor(2, 3);
      let now = 1000;
      g.reset(2, now);
      const run = (ms, sec) => {
        const seen = new Set([g.current]);
        for (let t = 0; t < sec * 1000; t += ms) {
          now += ms;
          const r = g.sample(now, ms);
          if (r !== null) seen.add(r);
        }
        return [...seen];
      };
      run(16.7, 6);
      check('dynres：60Hz 稳定 → 保持 1.0 档', g.current === 2, String(g.current));
      run(25, 8);
      check('dynres：25ms 帧 8 秒 → 降档', g.current < 2, String(g.current));
      run(16.7, 40);
      check('dynres：回到 60Hz 垂直同步 → 升回 1.0 档', g.current === 2, String(g.current));
      g.hold(now, 1000);
      check('dynres：hold 期间不采样', g.sample(now + 10, 40) === null);
      const g2 = new DynResGovernor(2, 3);
      now = 1000;
      g2.reset(2, now);
      for (let i = 0; i < 400; i++) { now += 8.3; g2.sample(now, 8.3); }
      check('dynres：120Hz 保持 1.0 档', g2.current === 2, String(g2.current));

      // M4 第 2 轮：60Hz 垂直同步、每帧工作量 5–9ms 均匀抖动、t = 10s 一次 220ms 卡顿。
      // 时间戳取 vsync 时刻（rAF 的 timestamp，RenderPipeline.frameStamp）：卡顿降一档后 10 秒内升回 1.0 档。
      // 反例（只写在这里说明为什么不能那样取）：时间戳取“工作结束时刻”（渲染后的 performance.now()）时，间隔 = 16.7ms ± 相邻两帧
      // 工作量之差，第 10 百分位被拉低到 ≈ 13ms，“平均 ≤ 1.1 × p10”永远不成立，降档后 90 秒都升不回来。
      const sim = stampAtVsync => {
        let seed = 7;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        const g3 = new DynResGovernor(2, 3);
        g3.reset(2, 0);
        const V = 1000 / 60;
        let vs = 1000, last = 0, dropAt = null, backAt = null;
        while (vs < 1000 + 40_000) {
          const hitch = vs >= 11_000 && vs < 11_000 + V ? 220 : 0;
          const work = 5 + 4 * rnd() + hitch;
          const end = vs + work;
          const ts = stampAtVsync ? vs : end;
          const r = g3.sample(ts, last ? ts - last : 0);
          last = ts;
          if (r !== null && r < 2 && dropAt === null) dropAt = ts;
          if (r === 2 && dropAt !== null && backAt === null) backAt = ts;
          vs += Math.ceil((end - vs) / V) * V;
        }
        return { dropAt, backAt, level: g3.current };
      };
      const raf = sim(true);
      check('dynres：60Hz + 工作量抖动，按 vsync 时间戳采样：卡顿降档后 10 秒内升回 1.0 档',
        raf.dropAt !== null && raf.backAt !== null && raf.backAt - raf.dropAt <= 10_000, JSON.stringify(raf));
    }
  } catch (err) {
    check('node 侧测试未抛异常', false, err instanceof Error ? `${err.message}\n${err.stack}` : String(err));
  } finally {
    await server.close();
  }
  return results;
}

/**
 * Game 的帧循环逻辑：Game 需要 WebGL2 与全部系统才能构造，node 里改用 Object.create(Game.prototype) 配一个假的 this，
 * 只测 WP1 自己的 step/advance/settle/drive/waitGame/onFrame。core/game.ts 在运行时 import 全部系统模块，
 * 别的 WP 正在改的文件若一时加载不了，这组用例记为跳过（M1c 的页面内自测 wp1.freeze/wp1.lockstep 覆盖同样的内容）。
 */
async function gameLoopTests(load, check, near) {
  let Game;
  try {
    ({ Game } = await load('/src/core/game.ts'));
  } catch (err) {
    check('（跳过：core/game.ts 此刻加载不了）Game 帧循环', true);
    console.warn('  [wp1] core/game.ts 加载失败，帧循环用例跳过：', err instanceof Error ? err.message.split('\n')[0] : err);
    return;
  }
  const SYS = ['npc', 'interaction', 'viewfinder', 'replay', 'vcr', 'cctv', 'crt', 'tripod', 'cutscene', 'dialogue', 'hints', 'shichen'];
  const mk = () => {
    const calls = [];
    const g = Object.create(Game.prototype);
    const sys = Object.fromEntries(SYS.map(k => [k, { zoom: 1, update: () => calls.push(k) }]));
    sys.read = { evaluate: () => calls.push('read') };
    sys.journal = { update: () => calls.push('journal') };
    Object.assign(g, {
      lockstep: true, time: 0, timeScale: 1, frameNo: 0,
      inStep: false, advancing: false, advanceChain: Promise.resolve(), frameWaiters: [], pendingRenderDt: 0, stepDt: 0,
      expectedLights: -1, lightAssertFired: false, reportedErrors: new Set(), loadingShown: false,
      timer: { update() {}, getDelta: () => 1 / 60 },
      input: { beginFrame: () => calls.push('beginFrame'), takeFrameButtons: () => [], translate: () => null, lookDelta: { dx: 0, dy: 0 }, move: { x: 0, z: 0, sprint: false } },
      modes: { frozen: false, freezesWorld() { return this.frozen; }, update: () => calls.push('modes'), lookEnabled: () => true, moveMode: () => 'normal', top: 'mode.explore', dispatch: () => ({ ok: true }) },
      areas: { current: { def: { update: () => calls.push('area') }, ctx: { updateViews() {}, timers: { update() {} } } }, building: false, isLoading: () => false, buildingForMs: () => 0 },
      cameras: { active: 'tp', update: () => calls.push('cameras'), camera: { position: {} } },
      player: { yaw: 0, applyLook() {}, clampPitch() {}, driveWalk() {}, update: () => calls.push('player') },
      triggers: { update: () => calls.push('triggers') },
      sys,
      effects: { busy: false, waitingInput: false, pump: () => calls.push('pump') },
      playerModel: { update() {} },
      audio: { setListener() {} },
      ui: { update: dt => calls.push(`ui:${dt}`), setLoading() {} },
      pipeline: { renders: [], render(dt) { this.renders.push(dt); }, renderMain() {}, stats: () => ({ lights: 0 }) },
      save: { flushIfSafe() {} },
      events: { emit() {} },
    });
    return { g, calls };
  };
  {
    const { g, calls } = mk();
    g.step(0.1, true);
    check('step：推进 time 并按序调用系统', near(g.time, 0.1) && calls.indexOf('player') < calls.indexOf('npc') && calls.indexOf('shichen') < calls.indexOf('area') && calls.includes('pump'), calls.join(','));
    check('step(render)：渲染一次、dt = 本帧', g.pipeline.renders.length === 1 && near(g.pipeline.renders[0], 0.1));
    calls.length = 0;
    g.modes.frozen = true;
    g.step(0.1, true);
    check('冻结：time 不走、系统/玩家/计时不更新，UI 与渲染照常', near(g.time, 0.1) && !calls.includes('player') && !calls.includes('npc') && !calls.includes('pump') && calls.includes('ui:0.1') && g.pipeline.renders.length === 2, calls.join(','));
    await g.advance(2);
    check('冻结时 advance 不推进游戏时间', near(g.time, 0.1));
  }
  {
    const { g } = mk();
    let steps = 0;
    const orig = g.step;
    g.step = function (dt, r) { steps++; return orig.call(this, dt, r); };
    await g.advance(1);
    check('advance(1)：30 步、time = 1、结束后渲染一帧（dt = 累计游戏时间）', steps === 30 && near(g.time, 1, 1e-9) && g.pipeline.renders.length === 1 && near(g.pipeline.renders[0], 1, 1e-9), `${steps} ${g.time} ${g.pipeline.renders}`);
    await g.advance(0.05);
    check('advance(0.05)：最后一步用余量，精确推进', near(g.time, 1.05, 1e-9), String(g.time));
    await g.advance(5, 1 / 30, () => g.time >= 0.2 + 1.05);
    check('advance(until)：条件为真即停', g.time >= 1.25 - 1e-9 && g.time < 1.25 + 1 / 30 + 1e-9, String(g.time));
    const before = steps;
    await g.advance(0);
    check('advance(0)：跑一次 dt=0 的 step 并渲染', steps === before + 1 && near(g.time, g.time));
    const t0 = g.time;
    await Promise.all([g.advance(0.5), g.advance(0.5)]);
    check('并发的 advance 串行执行、不重入 step', near(g.time, t0 + 1, 1e-9), String(g.time - t0));
    let rejected = false;
    g.sys.npc.update = () => { g.advance(1).catch(() => { rejected = true; }); };
    g.step(1 / 30, false);
    await null;
    check('step 内调用 advance 被拒绝（不重入）', rejected);
  }
  {
    const { g } = mk();
    await g.waitGame(0.3);
    check('锁步下 waitGame 自己推进游戏时间', g.time >= 0.3 - 1e-9 && g.time < 0.3 + 1 / 30 + 1e-9, String(g.time));
    // step 里（例如出口触发体）发起的等待：不重入，外层 advance 结束后自己接着推进
    let inner = null;
    let started = -1;
    g.sys.npc.update = () => {
      if (!inner) {
        started = g.time;
        inner = g.waitGame(1);
      }
    };
    await g.advance(0.2);
    await inner;
    check('step 内发起的 waitGame 不重入、最终推进到位', g.time >= started + 1 - 1e-9, `${started} → ${g.time}`);
  }
  {
    const { g } = mk();
    Object.defineProperty(g.effects, 'busy', { get: () => g.time < 0.4 });
    const st = await g.settle();
    check('settle（锁步）：推进到 runner 空闲', st === 'idle' && g.time >= 0.4 - 1e-9 && g.time < 0.4 + 1 / 30 + 1e-9, `${st} ${g.time}`);
    const { g: g2 } = mk();
    g2.effects.busy = true;
    g2.effects.waitingInput = true;
    check('settle：等待输入时立即返回 waiting、不推进时间', (await g2.settle()) === 'waiting' && g2.time === 0);
    const { g: g3 } = mk();
    g3.effects.busy = true;
    g3.modes.frozen = true;
    check('settle：冻结且忙 → waiting（不空转到超时）', (await g3.settle()) === 'waiting');
    const { g: g4 } = mk();
    let loading = true;
    g4.areas.isLoading = () => loading;
    setTimeout(() => { loading = false; }, 30);
    check('settle：等区域加载完', (await g4.settle({ maxRealMs: 5000 })) === 'idle' && !loading);
  }
  {
    const { g, calls } = mk();
    g.onFrame(16);
    g.onFrame(32);
    check('锁步：rAF 只渲染（dt=0 的 UI 更新），不推进游戏时间', g.time === 0 && !calls.includes('player') && calls.includes('ui:0') && g.pipeline.renders.length === 2, calls.join(','));
    const { g: h } = mk();
    h.lockstep = false;
    h.onFrame(16);
    check('非锁步：rAF 调 step 推进时间', near(h.time, 1 / 60) && h.pipeline.renders.length === 1);
    let resolved = false;
    h.nextFrame().then(() => { resolved = true; });
    h.onFrame(32);
    await null;
    check('nextFrame 在下一次 rAF 后 resolve', resolved);
  }
  {
    const { g } = mk();
    g.areas.building = true;
    setTimeout(() => { g.areas.building = false; }, 30);
    await g.advance(0.5);
    check('建区期间 advance 等待且不消耗预算', near(g.time, 0.5, 1e-9), String(g.time));
  }
}

// ---------------------------------------------------------------- 页面内自测（M1c 起）
export async function pageTests(call) {
  const results = [];
  const names = await call('selftests').catch(() => null);
  const available = new Set(Array.isArray(names?.result) ? names.result : Array.isArray(names) ? names : PAGE_TESTS);
  for (const n of PAGE_TESTS) {
    if (!available.has(n)) {
      results.push({ label: n, ok: false, detail: '未登记（src/areas/dev/wp1.ts 没有被加载？）' });
      continue;
    }
    const r = await call('selftest', n).catch(err => ({ ok: false, reason: String(err) }));
    const res = r?.result ?? r;
    results.push({ label: n, ok: r?.ok === true && res?.ok === true, detail: (res?.notes ?? [r?.reason]).join('\n') });
  }
  return results;
}

/** core.mjs 的统一入口：h.call 可选；没有就只跑 node 侧。 */
export default async function run(h = {}) {
  const out = await nodeTests();
  if (typeof h.call === 'function') out.push(...(await pageTests(h.call)));
  return { ok: out.every(r => r.ok), results: out };
}

async function standalonePage(distDir) {
  const { chromium } = await import('playwright');
  const { preview } = await import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')).href);
  const port = 4191;
  const server = await preview({ root: ROOT, configFile: false, build: { outDir: distDir }, preview: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'error' });
  const browser = await launchChromium(chromium, { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }, 'wp1');
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
    page.on('pageerror', e => errors.push(`pageerror: ${e}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
    await page.goto(`http://127.0.0.1:${port}/?debug=1&test=1&lockstep=1&area=dev&quality=low`);
    await page.waitForFunction(() => typeof window.__game === 'object', null, { timeout: 60_000 });
    const call = (m, ...a) => page.evaluate(([mm, aa]) => window.__game[mm](...aa), [m, a]);
    const res = await pageTests(call);
    if (errors.length) res.push({ label: '页面无 pageerror/console.error', ok: false, detail: errors.join('\n') });
    return res;
  } finally {
    await browser.close();
    server.httpServer.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const all = [];
  const t0 = Date.now();
  all.push(...(await nodeTests()));
  if (args.includes('--page')) {
    const dist = (args.find(a => a.startsWith('--dist=')) ?? '').slice(7) || path.join(ROOT, 'dist');
    if (!fs.existsSync(path.join(dist, 'index.html'))) all.push({ label: '页面自测', ok: false, detail: `找不到构建产物 ${dist}/index.html` });
    else all.push(...(await standalonePage(dist)));
  }
  let fail = 0;
  for (const r of all) {
    if (!r.ok) fail++;
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.label}${r.ok || !r.detail ? '' : `\n     ${String(r.detail).replace(/\n/g, '\n     ')}`}`);
  }
  console.log(`\nwp1 selftest: ${all.length - fail}/${all.length} passed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  process.exit(fail ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
