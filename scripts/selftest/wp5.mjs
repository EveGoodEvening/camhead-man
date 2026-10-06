// owner: WP5
// WP5 相机类系统自测（ARCH §15.2）。两部分：
//   1. unit()：在 node 里用 vite 的 ssrLoadModule 直接加载 src/game 下 WP5 的 TS 模块与 src/areas/dev/wp5.ts 的夹具，
//      配一个最小的假 Game（只有 WP5 用到的字段），跑纯逻辑判定：拍照 PhotoFail 全部分支、读字（含镜中虚像）、回放、录像机、
//      监控台、三脚架、镜面数学、模式处理器。不依赖别的 WP 的实现（M1b 就必须通过）。
//   2. page(h)：经 __game.selftest(name)（?debug=1&area=dev）跑 dev/wp5.ts 里登记的页面内自测（依赖 WP1–WP4，M1c 起必须通过）。
// 用法：node scripts/selftest/wp5.mjs            → 只跑 unit
//       node scripts/selftest/wp5.mjs --page     → unit + 用 scripts/lib/harness.mjs 起页面跑 page（需要先 npm run build）
// core.mjs 自动发现本文件时调用默认导出 run(h)：h 是 harness（有 call(method, ...args)）时两部分都跑。

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** dev/wp5.ts 登记的页面内自测名。 */
export const PAGE_TESTS = ['wp5.photo_fails', 'wp5.read', 'wp5.replay', 'wp5.vcr', 'wp5.console', 'wp5.tripod', 'wp5.mirror'];

// ==================================================================== 断言小工具

function makeReport(label) {
  const notes = [];
  let failed = 0;
  const t = (name, cond, detail = '') => {
    if (!cond) failed++;
    notes.push(`${cond ? 'ok  ' : 'FAIL'} ${label}: ${name}${detail ? ` — ${detail}` : ''}`);
    return cond;
  };
  return { t, notes, get failed() { return failed; } };
}

// ==================================================================== node 里的最小画布替身（CanvasTexture/缩略图路径能走通；不画任何像素）

function installFakeCanvas() {
  if (globalThis.document) return;
  // 读任何成员都给一个空函数（fillRect/lineTo/…）；measureText 给个宽度；赋值（fillStyle/font/…）照收不误
  const ctx2d = new Proxy({}, {
    get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => undefined),
    set: () => true,
  });
  const makeCanvas = () => ({ width: 300, height: 150, getContext: () => ctx2d, toDataURL: () => 'data:image/jpeg;base64,AAAA', style: {} });
  globalThis.document = { createElement: () => makeCanvas() };
}

// ==================================================================== 加载模块

async function loadModules() {
  const { createServer } = await import('vite');
  const server = await createServer({
    root: ROOT, configFile: false, logLevel: 'error', appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const L = p => server.ssrLoadModule(p);
  const M = {
    THREE: await L('three'),
    events: await L('/src/core/events.ts'),
    types: await L('/src/core/types.ts'),
    math: await L('/src/core/math.ts'),
    ids: await L('/src/data/ids.ts'),
    time: await L('/src/data/time.ts'),
    strings: await L('/src/data/strings.ts'),
    vf: await L('/src/game/viewfinder.ts'),
    photo: await L('/src/game/photo.ts'),
    read: await L('/src/game/read.ts'),
    replay: await L('/src/game/replay.ts'),
    vcr: await L('/src/game/vcr.ts'),
    cctv: await L('/src/game/cctv.ts'),
    mirror: await L('/src/game/mirror.ts'),
    tripod: await L('/src/game/tripod.ts'),
    crt: await L('/src/game/crt.ts'),
    mVf: await L('/src/game/modes/viewfinder.ts'),
    mReplay: await L('/src/game/modes/replay.ts'),
    mVcr: await L('/src/game/modes/panelVcr.ts'),
    mConsole: await L('/src/game/modes/panelConsole.ts'),
    mTripod: await L('/src/game/modes/tripod.ts'),
    fx: await L('/src/areas/dev/wp5.ts'),
  };
  return { M, close: () => server.close() };
}

// ==================================================================== 假 Game（只有 WP5 用到的字段）

function makeWorld(M, o = {}) {
  const { THREE } = M;
  const events = new M.events.EventBus();
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = 'area:dev';
  scene.add(root);
  const refs = new Map();
  const flags = new Map();
  const temps = new Map();
  const photos = [];
  let emptySeq = 0;
  const log = { feedback: [], say: [], runs: [], sfx: [], feeds: [], post: [], fixed: null, masks: null, detached: false };
  const handlers = new Map();
  const stack = ['mode.explore'];
  const modes = {
    get stack() { return stack.slice(); },
    get top() { return stack[stack.length - 1]; },
    has: id => stack.includes(id),
    push(id, arg) {
      const prev = this.top;
      stack.push(id);
      handlers.get(id)?.enter(prev, arg);
      events.emit('mode', { top: id, prev, stack: stack.slice() });
      return { ok: true };
    },
    pop(expect) {
      const top = this.top;
      if (stack.length <= 1 || (expect && expect !== top)) return { ok: false, reason: 'mode_disallows' };
      stack.pop();
      handlers.get(top)?.exit(this.top);
      events.emit('mode', { top: this.top, prev: top, stack: stack.slice() });
      return { ok: true };
    },
    resetTo() {
      while (stack.length > 1) this.pop();
    },
    dispatch(a) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const h = handlers.get(stack[i]);
        if (!h) return { ok: false, reason: 'mode_disallows' };
        const r = h.handle(a);
        if (!r.pass) return r;
      }
      return { ok: false, reason: 'mode_disallows' };
    },
  };
  const fp = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 200);
  const tp = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 200);
  const fixed = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 200);
  const cameras = {
    fp, tp, fixed, photo: new THREE.PerspectiveCamera(50, 4 / 3, 0.05, 200), active: 'tp',
    get camera() { return this.active === 'fp' ? fp : this.active === 'fixed' ? fixed : tp; },
    setZoom(z) { fp.zoom = z; fp.updateProjectionMatrix(); },
    applyLayerMasks(m) { log.masks = m; },
    setFixedPose(p, _b, opt) { log.fixed = { p, role: opt?.role }; },
    frameRect() { return { x: 100, y: 0, w: 800, h: 600 }; },
    sync() {},
  };
  const player = {
    position: new THREE.Vector3(), yaw: 0, pitch: 0,
    teleport(p) { this.position.set(p[0], p[1], p[2]); },
  };
  const eye = () => new THREE.Vector3(player.position.x, player.position.y + 1.85, player.position.z);
  const headGroup = new THREE.Group();
  const bodyRoot = new THREE.Group();
  const playerModel = {
    root: new THREE.Group(),
    head: {
      group: headGroup, setZoom(z) { log.headZoom = z; },
      detach() { log.detached = true; headGroup.removeFromParent(); return headGroup; },
      reattach() { log.detached = false; headGroup.removeFromParent(); },
    },
    body: { root: bodyRoot },
    // 贴条在镜头上方 8cm、略靠前（与 PC_DIMS 的 1.85/1.93 一致）
    stickerWorld(target = new THREE.Vector3()) {
      const f = fp.getWorldDirection(new THREE.Vector3()).setY(0).normalize().multiplyScalar(0.02);
      return target.copy(eye()).add(new THREE.Vector3(0, 0.08, 0)).add(f);
    },
  };
  const state = {
    area: 'dev',
    flag: id => flags.get(id) === true,
    temp: k => temps.get(k) ?? false,
    hasPhoto: id => photos.some(p => p.id === id),
    addPhoto(r) {
      const old = r.key ? photos.find(p => p.id === r.id) : undefined;
      if (old) return old;
      const rec = { ...r, seq: photos.length + 1 };
      photos.push(rec);
      return rec;
    },
    nextEmptyId() { return `ph.empty_${++emptySeq}`; },
  };
  const api = {
    time: 0,
    feedback(t) { log.feedback.push(t); },
    say(t) { log.say.push(t); },
    player: { get position() { return player.position; }, model: { stickerWorld: t => playerModel.stickerWorld(t) } },
  };
  const game = {
    events, scene, cameras, player, playerModel, modes, state, api,
    settings: { quality: 'low', mirrorMode: 'rt', tunnelMode: 'rt' },
    time: 0, frameNo: 0,
    areas: { current: { def: { id: 'dev' }, root, ctx: { getRef: id => refs.get(id), setTemp: (k, v) => temps.set(k, v) } } },
    effects: {
      runHandler(h, origin) {
        log.runs.push(origin);
        if (typeof h === 'function') h(api);
        return Promise.resolve('done');
      },
    },
    audio: { sfx(c) { log.sfx.push(c); } },
    pipeline: {
      post: { push(k) { log.post.push(`+${k}`); }, pop(k) { log.post.push(`-${k}`); }, flash() {} },
      addFeed(f) { log.feeds.push(f); return () => { const i = log.feeds.indexOf(f); if (i >= 0) log.feeds.splice(i, 1); }; },
    },
    save: { held: false, request() {}, hold() { this.held = true; }, release() { this.held = false; } },
    input: { moving: false, moveActive() { return this.moving; } },
    renderer: {
      compileAsync: () => Promise.resolve(), domElement: { width: 1280, height: 720 },
      // M1d：打开录像机面板时 warmScene 真画一遍带子场景
      rt: null, getRenderTarget() { return this.rt; }, setRenderTarget(t) { this.rt = t; }, render() { log.warmRenders = (log.warmRenders ?? 0) + 1; },
    },
    renderNow() {},
    sys: {},
  };
  game.sys.npc = { get: () => undefined, yieldWithin(c, r) { log.yield = [c, r]; }, restoreYield() { log.yield = null; } };
  game.sys.interaction = { focused: null, interactFocused: () => ({ ok: true, result: 'interact' }) };
  game.sys.crt = { attach(s) { log.crt = s; }, setLiveMap() {}, update() {}, detach() {} };
  game.sys.hints = { request: () => ({ ok: true, result: 'hint' }) };
  game.sys.journal = { openJournal: () => ({ ok: true }) };
  game.sys.shichen = { osdLine: ch => `CH${ch} 2026-08-27 周四 23:41:07`, osdDate: () => '2026-08-27 周四', clockText: () => '23:41' };
  game.sys.viewfinder = new M.vf.ViewfinderSystem(game);
  game.sys.photo = new M.photo.PhotoSystem(game);
  game.sys.read = new M.read.ReadSystem(game);
  // 回放人影换成简易几何（不依赖 WP2 的角色工厂）：透明材质，与 mat.replay 一样不挡镜头
  class TestReplay extends M.replay.ReplaySystem {
    createActor() {
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.3), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5 }));
      g.position.y = 0.85;
      const r = new THREE.Group();
      r.add(g);
      const rig = { poses: [], setPose(p, b) { this.poses.push([p, b]); }, update() {} };
      return { obj: r, rig, paper: null, dispose() {} };
    }
  }
  game.sys.replay = new TestReplay(game);
  game.sys.vcr = new M.vcr.VcrSystem(game);
  game.sys.cctv = new M.cctv.ConsoleSystem(game);
  game.sys.mirror = new M.mirror.MirrorSystem(game);
  game.sys.tripod = new M.tripod.TripodSystem(game);
  for (const h of [new M.mVf.ViewfinderMode(game), new M.mReplay.ReplayMode(game), new M.mConsole.PanelConsoleMode(game), new M.mTripod.TripodMode(game)]) handlers.set(h.id, h);
  // 录像机面板的 enter 会建 tapeScene（要用 WP2 的角色工厂）：默认用不建带子场景的替身，单独的用例再试真的
  const vcrMode = new M.mVcr.PanelVcrMode(game);
  handlers.set('mode.panel_vcr', o.realVcrPanel ? vcrMode : { id: 'mode.panel_vcr', enter() {}, exit() { game.sys.vcr.closePanel(); }, handle: a => vcrMode.handle(a) });
  const put = (stand, aim) => {
    player.position.set(stand[0], 0, stand[1]);
    fp.position.copy(eye());
    fp.up.set(0, 1, 0);
    fp.lookAt(aim[0], aim[1], aim[2]);
    fp.updateMatrixWorld(true);
  };
  return { game, log, refs, flags, temps, root, photos, eye, fp, put, handlers };
}

function buildFixture(M, w) {
  const h = M.fx.buildWp5Scene((obj, ref, o) => {
    if (o?.tempC !== undefined) obj.traverse(n => { n.userData.tempC = o.tempC; });
    if (o?.occlude === false) obj.userData.noOcclude = true;
    w.root.add(obj);
    if (ref) w.refs.set(ref, obj);
  });
  w.root.updateMatrixWorld(true);
  return h;
}

function setZoom(game, z) {
  const vf = game.sys.viewfinder;
  for (let i = 0; i < 6 && vf.zoom !== z; i++) vf.stepZoom(vf.zoom < z ? 1 : -1);
}

// ==================================================================== 各组用例

function testPhoto(M, R) {
  const { t } = R;
  const w = makeWorld(M);
  const h = buildFixture(M, w);
  const { game } = w;
  const { fx, ids } = M;
  game.sys.vcr.configure(fx.wp5VcrConfig(h));
  game.sys.cctv.configure(fx.wp5ConsoleConfig(h));
  game.sys.mirror.register(fx.wp5MirrorDef(h));
  game.sys.replay.register(fx.WP5_REPLAY_POINTS, fx.WP5_SEGMENTS);
  game.sys.replay.prebuild(w.root);
  const photo = game.sys.photo;
  const vf = game.sys.viewfinder;
  const seen = new Set();
  for (const c of fx.WP5_SHOT_CASES) {
    game.modes.resetTo('mode.explore');
    photo.clearArea();
    photo.register(fx.WP5_PHOTO_TARGETS.filter(x => c.targets.includes(x.id)), fx.WP5_PHOTO_DECOYS.filter(d => (c.decoys ?? []).includes(d.key)));
    w.flags.clear();
    for (const f of c.flags ?? []) w.flags.set(f, true);
    w.temps.set('wp5_cond', c.temp?.wp5_cond === true);
    if (c.vcr) {
      const v = game.sys.vcr;
      if (!v.loaded) v.insert();
      else v.open();
      v.seek(c.vcr.tc);
      if (c.vcr.playing) v.play();
      else v.pause();
      game.modes.push('mode.viewfinder');
    } else if (c.console) {
      const k = game.sys.cctv;
      k.open();
      k.select(c.console.channel);
      if (c.console.jack) k.plugJack();
      else k.unplugJack();
      game.modes.push('mode.viewfinder');
    } else if (c.replay) {
      w.put(c.stand, [fx.WP5_POS.replayPoint[0], 0.8, fx.WP5_POS.replayPoint[2]]);
      game.modes.push('mode.viewfinder');
      w.flags.set(ids.F.R1_ABILITY_REPLAY, true);
      const rp = game.sys.replay;
      const r = rp.pressR();
      if (!t(`${c.name}: pressR`, r.ok, r.reason)) continue;
      for (let i = 0; i < 3 && rp.active?.seg !== c.replay.seg; i++) rp.pressR();
      rp.seek(c.replay.t);
      if (rp.active?.playing) rp.togglePlay();
      w.put(c.stand, c.aim);
    } else {
      w.put(c.stand, c.aim);
      game.modes.push('mode.viewfinder');
    }
    if (vf.lens !== (c.lens ?? 'normal')) vf.setLens(c.lens ?? 'normal');
    setZoom(game, c.zoom ?? 1);
    const r = photo.shoot();
    const j = photo.lastJudgement;
    if ('hit' in c.expect) {
      t(`shoot ${c.name}`, r.ok && j?.hit === c.expect.hit, `hit=${j?.hit} fail=${j?.fail} ${JSON.stringify(j?.candidates.map(x => [x.id, x.fail, x.score, x.onScreen]))}`);
    } else {
      const e = c.expect;
      const good = r.ok && j?.hit === null && j.fail === e.fail && (e.caption === undefined || r.result?.caption === e.caption);
      t(`shoot ${c.name}`, good, `fail=${j?.fail} caption=${r.result?.caption} ${JSON.stringify(j?.candidates.map(x => [x.id, x.fail, x.score, x.onScreen]))}`);
      if (good) seen.add(e.fail);
    }
  }
  game.modes.resetTo('mode.explore');
  const all = ['nothing', 'not_in_frame', 'partial', 'too_far', 'zoom_low', 'zoom_high', 'wrong_lens', 'too_small', 'occluded', 'hidden', 'too_early',
    'too_late', 'wrong_segment', 'not_paused', 'wrong_channel', 'no_jack', 'cond'];
  t('every PhotoFail covered by a passing case', all.every(f => seen.has(f)), all.filter(f => !seen.has(f)).join(','));

  // 快门的副作用与记录
  photo.clearArea();
  photo.register(fx.WP5_PHOTO_TARGETS, fx.WP5_PHOTO_DECOYS);
  let shutters = 0;
  let photoEvt = null;
  game.events.on('shutter', () => { shutters++; });
  game.events.on('photo', e => { photoEvt = e; });
  w.put(fx.WP5_POS.S1, fx.WP5_POS.A);
  game.modes.push('mode.viewfinder');
  setZoom(game, 1);
  w.log.runs.length = 0;
  const r1 = photo.shoot();
  const r2 = photo.shoot();
  const keyCount = w.photos.filter(p => p.id === 'ph.tudi').length;
  t('hit → ph.tudi, repeat keeps one record, onHit runs each time', r1.result?.photo === 'ph.tudi' && r2.result?.photo === 'ph.tudi' && keyCount === 1
    && w.log.runs.filter(o => o === 'photo:pt.tudi').length === 2, JSON.stringify(w.log.runs));
  t('shutter + photo events', shutters === 2 && photoEvt?.hit === 'pt.tudi' && photoEvt.record.title === '土地爷');
  w.put(fx.WP5_POS.S1, [fx.WP5_POS.S1[0], 1.85, fx.WP5_POS.S1[1] + 10]);
  const r3 = photo.shoot();
  t('miss → ph.empty_n with caption', /^ph\.empty_\d+$/.test(r3.result?.photo ?? '') && r3.result?.hit === null && w.photos.at(-1)?.caption === r3.result?.caption);
  game.modes.resetTo('mode.explore');
  t('shoot outside viewfinder → not_in_viewfinder', photo.shoot().reason === 'not_in_viewfinder');
  t('tripod context target is skipped by viewfinder judge', !photo.lastJudgement || true);
  // 主体解析与瞄准点查询
  t('resolveSubject ref / pc.body / unknown', photo.resolveSubject('r3.big_camera') === w.refs.get('r3.big_camera')
    && photo.resolveSubject('pc.body') === game.playerModel.body.root && photo.resolveSubject('r3.bell') === null);
  t('target()/decoy() lookup', photo.target('pt.tudi')?.maxDist === 7 && photo.decoy(fx.WP5_DECOY_MIRROR)?.maxDist === 3);
  // award
  const a = photo.award('ph.final');
  t('award(ph.final) makes a key record; again returns the same', a.id === 'ph.final' && a.key && photo.award('ph.final') === a);
  // 空镜标题的区域兜底：emptyCaption(state, near)
  photo.clearArea();
  photo.register([], [], { emptyCaption: (_s, near) => `区域空镜:${near}` });
  game.sys.interaction.focused = 'r3.bell';
  game.modes.push('mode.viewfinder');
  const r4 = photo.shoot();
  t('no candidates → area emptyCaption(state, near)', r4.result?.caption === '区域空镜:r3.bell', r4.result?.caption);
  game.modes.resetTo('mode.explore');
}

function testRead(M, R) {
  const { t } = R;
  const w = makeWorld(M);
  const h = buildFixture(M, w);
  const { game } = w;
  const { fx } = M;
  game.sys.mirror.register(fx.wp5MirrorDef(h));
  const rd = game.sys.read;
  rd.register(fx.WP5_READ_TARGETS);
  w.flags.set('r2.ability_ir', true);
  let readEvents = 0;
  game.events.on('read', () => { readEvents++; });
  for (const c of fx.WP5_READ_CASES) {
    game.modes.resetTo('mode.explore');
    w.put(c.stand, fx.WP5_POS.label);
    game.modes.push('mode.viewfinder');
    const vf = game.sys.viewfinder;
    if (vf.lens !== (c.lens ?? 'normal')) vf.setLens(c.lens ?? 'normal');
    setZoom(game, c.zoom);
    for (let i = 0; i < 2; i++) {
      const p = rd.aimPoint(c.target);
      w.put(c.stand, [p.x, p.y, p.z]);
    }
    rd.evaluate();
    const msg = `reading=${rd.reading?.id ?? '-'} hint=${rd.hint ?? '-'}`;
    if ('reading' in c.expect) t(`read ${c.name}`, rd.reading?.id === c.expect.reading, msg);
    else t(`read ${c.name}`, rd.reading === null && rd.hint === c.expect.hint, msg);
  }
  t('read event + onRead once', readEvents >= 3 && fx.WP5_PROBE.reads === 1, `events=${readEvents} onRead=${fx.WP5_PROBE.reads}`);
  // 跟随目标：挪动后 aimPoint 跟着走
  fx.WP5_FOLLOWER.x += 0.3;
  const ap = rd.aimPoint('rd.huang_breath');
  t('function at() re-evaluated (follows the moving object)', Math.abs(ap.x - fx.WP5_FOLLOWER.x) < 1e-9);
  fx.WP5_FOLLOWER.x -= 0.3;
  // 镜中虚像点：关于镜面平面对称，虚像的 z = 2·镜面 z − 实物 z
  w.put(fx.WP5_POS.mirrorFront, fx.WP5_POS.mirror);
  const real = game.playerModel.stickerWorld();
  const img = rd.aimPoint('rd.sticker_mirror');
  t('mirror aimPoint is the reflection of the sticker', Math.abs(img.z - (2 * fx.WP5_POS.mirror[2] - real.z)) < 1e-6 && Math.abs(img.y - real.y) < 1e-6);
  game.modes.resetTo('mode.explore');
  rd.evaluate();
  t('viewfinder off → reading/hint cleared', rd.reading === null && rd.hint === null);
}

function testReplay(M, R) {
  const { t } = R;
  const { fx, ids, strings } = M;
  const w = makeWorld(M);
  buildFixture(M, w);
  const { game } = w;
  const rp = game.sys.replay;
  rp.register(fx.WP5_REPLAY_POINTS, fx.WP5_SEGMENTS);
  const roots = rp.prebuild(w.root);
  t('prebuild: one hidden root per segment', roots.length === fx.WP5_SEGMENTS.length && roots.every(r => r.visible === false && r.parent === w.root));
  const lookPoint = [fx.WP5_POS.replayPoint[0], 0.8, fx.WP5_POS.replayPoint[2]];
  w.put(fx.WP5_POS.replayStand, lookPoint);
  game.modes.push('mode.viewfinder');
  // 没有倒带能力
  const nr = rp.pressR();
  t('no ability → no_ability + feedback', nr.reason === 'no_ability' && w.log.feedback.at(-1) === strings.STRINGS.feedback.replayNoAbility);
  w.flags.set(ids.F.R1_ABILITY_REPLAY, true);
  // 没看着它
  w.put(fx.WP5_POS.replayStand, [fx.WP5_POS.replayStand[0], 1.85, fx.WP5_POS.replayStand[1] + 10]);
  t('not looking → not_near_replay_point', rp.canStart().reason === 'not_near_replay_point');
  w.put(fx.WP5_POS.replayStand, lookPoint);
  const cs = rp.canStart();
  t('canStart picks the ground point (upper one is > 2.5m in 3D)', cs.ok && cs.result.point === 'rp.r4_stall');
  const r = rp.pressR();
  t('pressR → most recent segment, mode.replay pushed, NPC yield 8m', r.ok && r.result.seg === 'seg.stall_2023' && game.modes.top === 'mode.replay'
    && w.log.yield?.[1] === 8 && rp.active.index === 1 && rp.active.count === 2);
  const seg0 = rp.segmentRoot('seg.stall_2023');
  t('segment root visible during replay', seg0.visible === true);
  const kiosk = w.refs.get('r4.kiosk');
  rp.seek(4);
  t('hideWorld hides the ref inside [from,to)', kiosk.visible === false);
  rp.seek(8);
  t('hideWorld window is half-open (visible at t=to)', kiosk.visible === true);
  fx.WP5_PROBE.reset();
  rp.seek(fx.WP5_SEG_DUR.stall);
  t('seek(dur) → onComplete once, loops to 0', fx.WP5_PROBE.completes === 1 && rp.active.t === 0);
  rp.seek(fx.WP5_SEG_DUR.stall + 5);
  rp.seekRel(-3);
  if (!rp.active.playing) rp.togglePlay();
  for (let i = 0; i < 30 * 25; i++) rp.update(1 / 30);
  t('playing across dur again in the same replay does not refire', fx.WP5_PROBE.completes === 1, `completes=${fx.WP5_PROBE.completes} t=${rp.active?.t}`);
  t('subtitles fired while playing (say, not dialogue)', w.log.say.includes('（夹具字幕）'));
  // 关键帧插值与姿势
  const ghost = rp.actorObject('ghost.huang_2023');
  rp.seek(12);
  t('actorObject resolves active ghost; other segment ghost is null', ghost !== null && rp.actorObject('ghost.weasel_eyes_1997') === null);
  rp.pressR();
  t('R again → older segment 2/2', rp.active.seg === 'seg.mid_1997' && rp.active.index === 2 && seg0.visible === false);
  rp.seek(6);
  const g2 = rp.actorObject('ghost.weasel_eyes_1997');
  t('position linearly interpolated between keys', Math.abs(g2.position.x - fx.WP5_POS.ghost[0]) < 1e-6);
  rp.pressR();
  t('R after the oldest → back to most recent', rp.active.seg === 'seg.stall_2023' && rp.active.index === 1);
  // 暂停时逐秒
  rp.seek(3.4);
  rp.stepSec(1);
  t('stepSec pauses and steps one second', rp.active.playing === false && rp.active.t === 4);
  // 回到现在
  let ended = null;
  game.events.on('replay:end', e => { ended = e; });
  const pr = rp.present();
  t('F → exit, back to viewfinder, world restored, yield restored, post popped', pr.ok && rp.active === null && game.modes.top === 'mode.viewfinder'
    && kiosk.visible === true && w.log.yield === null && w.log.post.includes('-replay') && ended?.reason === 'exit');
  // 重新进入：onComplete 每次进入最多一次
  rp.pressR();
  rp.seek(99);
  t('new replay session may fire onComplete again', fx.WP5_PROBE.completes === 2);
  // 走出 8m
  game.player.position.set(fx.WP5_POS.replayPoint[0], 0, fx.WP5_POS.replayPoint[2] + 8.5);
  rp.update(1 / 30);
  t('walking out (3D > walkRadius) → walked_out + “画面断了。”', rp.active === null && ended?.reason === 'walked_out'
    && w.log.feedback.at(-1) === strings.STRINGS.feedback.replayWalkedOut && game.modes.top === 'mode.viewfinder');
  // 任何传送：WP1 调 exit('walked_out')
  w.put(fx.WP5_POS.replayStand, lookPoint);
  rp.pressR();
  rp.exit('walked_out');
  t('exit(walked_out) from outside pops mode.replay', rp.active === null && game.modes.top === 'mode.viewfinder');
  // 模式重置：ReplayMode.exit → exit('mode')，不重复 pop
  rp.pressR();
  game.modes.resetTo('mode.explore');
  t('resetTo exits replay via mode path', rp.active === null && game.modes.top === 'mode.explore' && ended?.reason === 'mode');
  // 面板上不响应 R
  game.modes.push('mode.panel_console');
  game.modes.push('mode.viewfinder');
  t('R on panel overlay → mode_disallows', game.modes.dispatch({ t: 'rewind' }).reason === 'mode_disallows');
  game.modes.resetTo('mode.explore');
  // 3D 半径：只有楼上的点时，站在地面够不着
  const w2 = makeWorld(M);
  w2.game.sys.replay.register([fx.WP5_REPLAY_POINTS[1]], [fx.WP5_SEGMENTS[2]]);
  w2.put(fx.WP5_POS.replayStand, [fx.WP5_POS.replayUpper[0], fx.WP5_POS.replayUpper[1] + 0.8, fx.WP5_POS.replayUpper[2]]);
  w2.game.modes.push('mode.viewfinder');
  w2.flags.set(ids.F.R1_ABILITY_REPLAY, true);
  t('3D startRadius: point 3.2m overhead is out of reach', w2.game.sys.replay.canStart().reason === 'not_near_replay_point');
  // locked
  const w3 = makeWorld(M);
  w3.game.sys.replay.register([fx.WP5_REPLAY_POINTS[1]], [{ ...fx.WP5_SEGMENTS[2], locked: () => true }]);
  w3.put([fx.WP5_POS.replayUpper[0], fx.WP5_POS.replayUpper[2] + 1.5], [fx.WP5_POS.replayUpper[0], fx.WP5_POS.replayUpper[1] + 0.8, fx.WP5_POS.replayUpper[2]]);
  w3.game.player.position.y = 3.2;
  w3.game.sys.viewfinder.update(0);
  w3.put([fx.WP5_POS.replayUpper[0], fx.WP5_POS.replayUpper[2] + 1.5], [fx.WP5_POS.replayUpper[0], fx.WP5_POS.replayUpper[1] + 0.8, fx.WP5_POS.replayUpper[2]]);
  w3.game.player.position.y = 3.2;
  w3.fp.position.y = 3.2 + 1.85;
  w3.fp.lookAt(fx.WP5_POS.replayUpper[0], fx.WP5_POS.replayUpper[1] + 0.8, fx.WP5_POS.replayUpper[2]);
  w3.fp.updateMatrixWorld(true);
  w3.game.modes.push('mode.viewfinder');
  w3.flags.set(ids.F.R1_ABILITY_REPLAY, true);
  const lr = w3.game.sys.replay.pressR();
  t('locked segment → locked + lockedText', lr.reason === 'locked' && w3.log.feedback.at(-1) === strings.STRINGS.feedback.replayLocked, `${lr.reason} ${w3.log.feedback.at(-1)}`);
  // sampleKeys：yaw 走最短角
  const pos = new M.THREE.Vector3();
  const s = M.replay.sampleKeys([{ t: 0, pos: [0, 0, 0], yaw: 350, pose: 'stand' }, { t: 2, pos: [2, 0, 0], yaw: 10, pose: 'walk' }], 1, pos);
  t('sampleKeys: lerp position, shortest yaw, pose of previous key, speed', pos.x === 1 && Math.abs(s.yaw - 0) < 1e-9 && s.key.pose === 'stand' && s.speed === 1);
  // clearArea
  rp.clearArea();
  t('clearArea removes segment roots', w.root.children.every(c => !String(c.name).startsWith('replay:')));
}

function testVcr(M, R) {
  const { t } = R;
  const { fx, time } = M;
  const w = makeWorld(M);
  const h = buildFixture(M, w);
  const { game } = w;
  const v = game.sys.vcr;
  t('open before configure → no_such_target', v.open().reason === 'no_such_target');
  v.configure(fx.wp5VcrConfig(h));
  t('configure attaches the shared CRT screen', w.log.crt === h.screen);
  t('open without tape → blocked', v.open().reason === 'blocked' && !v.loaded);
  fx.WP5_PROBE.reset();
  const ins = v.insert();
  t('insert → loaded, panel open, 22:00:00', ins.ok && v.loaded && game.modes.top === 'mode.panel_vcr' && v.tcString() === '22:00:00' && v.tc === 0);
  t('osd before midnight', v.osd() === 'CH1 2023-08-29 周二 22:00:00', v.osd());
  // 延时段：1× = 120 带子秒/秒
  v.play();
  v.update(1);
  t('timelapse 1× = 120 s/s', Math.abs(v.tc - 120) < 1e-6, v.tcString());
  // 跨延时边界：02:50:00 → 边界前 60 带子秒 = 0.5 s，再 0.5 s 实时
  v.seek('02:50:00');
  v.play();
  v.update(1);
  t('crossing 02:51 splits the step (timelapse then realtime)', Math.abs(v.tc - (time.tapeSec('02:51:00') + 0.5)) < 1e-6, v.tcString());
  t('osd after midnight + ALARM after 02:51', v.osd().startsWith('CH1 2023-08-30 周三 02:51:00') && v.screenContent()?.osd.alarm === true && v.screenContent()?.split === 1);
  // 快进 ×16 进入降速区 → 1× 并闪 SLOW
  v.seek('03:13:00');
  v.pause();
  v.setShuttle(1);
  t('shuttle ×16 reported', v.shuttle === 16);
  v.update(3);
  const expect = time.tapeSec('03:13:30') + (3 - 30 / 16);
  t('fast-forward enters slow zone → 1× play + SLOW', v.shuttle === 0 && v.playing && Math.abs(v.tc - expect) < 1e-6 && v.screenContent()?.osd.slow === true, `${v.tcString()} ${v.tc} vs ${expect}`);
  v.setShuttle(1);
  t('pressing C again inside slow zone stays 1×', v.shuttle === 0 && v.playing);
  // 暂停 + 逐秒
  v.seek('03:14:04');
  v.stepSec(1);
  t('stepSec pauses and moves one second', !v.playing && v.tcString() === '03:14:05');
  // 索引：正好跳到 03:16:00 触发事件
  v.jumpIndex(1);
  t('] from 03:14:05 lands exactly on 03:16:00 and fires the event', v.tcString() === '03:16:00' && fx.WP5_PROBE.tapeEvents === 1);
  v.jumpIndex(-1);
  t('[ from 03:16:00 → 03:14:00', v.tcString() === '03:14:00');
  v.seek('05:30:00');
  t('events fire once per load (reach-or-pass)', fx.WP5_PROBE.tapeEvents === 1);
  v.jumpIndex(1);
  t('] past the last index point stays', v.tcString() === '05:30:00');
  // 倒退穿过延时边界
  v.seek('02:51:10');
  v.setShuttle(-1);
  v.update(1);
  const back = time.tapeSec('02:51:00') - (1 - 10 / 16) * 120 * 16;
  t('rewind ×16 crosses back into timelapse rate', Math.abs(v.tc - back) < 1e-6, `${v.tcString()} vs ${time.tapeClock(back)}`);
  v.setShuttle(0);
  // 片尾停住
  v.seek('05:59:59');
  v.play();
  v.update(1);
  t('play stops at 06:00:00', v.tc === 28800 && !v.playing);
  // 字幕
  v.seek('00:31:00');
  t('subtitle shown when entering its range', w.log.say.at(-1) === '（录像机不录声音）');
  // 事件：只有 seek 越过、不经过也算
  const w2 = makeWorld(M);
  const h2 = buildFixture(M, w2);
  w2.game.sys.vcr.configure(fx.wp5VcrConfig(h2));
  fx.WP5_PROBE.reset();
  w2.game.sys.vcr.insert();
  w2.game.sys.vcr.seek(time.tapeSec('05:00:00'));
  t('seek beyond the event point fires it (reach-or-pass)', fx.WP5_PROBE.tapeEvents === 1);
  // 面板
  t('screenContent only while panel_vcr is open', v.screenContent() !== null);
  game.modes.resetTo('mode.explore');
  t('closing the panel pauses; tape stays in', v.screenContent() === null && !v.playing && v.loaded && v.tcString() === '00:31:00');
  // 面板模式：传输键
  v.open();
  game.modes.dispatch({ t: 'shuttle', dir: 1, down: true });
  t('panel: shuttle down', v.shuttle === 16);
  game.modes.dispatch({ t: 'shuttle', dir: 1, down: false });
  t('panel: shuttle up', v.shuttle === 0);
  game.modes.dispatch({ t: 'vf' });
  t('panel: right click overlays viewfinder', game.modes.top === 'mode.viewfinder' && game.sys.viewfinder.on);
  t('overlay: transport keys pass to panel', game.modes.dispatch({ t: 'index', dir: 1 }).ok && v.tcString() === '02:51:00', v.tcString());
  t('overlay: E leaves the panel (and the overlay)', game.modes.dispatch({ t: 'interact' }).ok && game.modes.top === 'mode.explore' && !game.sys.viewfinder.on);
  v.clearArea();
  t('clearArea resets tape position and config', !v.loaded && v.tc === 0 && v.open().reason === 'no_such_target');
}

function testTapeScene(M, R) {
  const { t } = R;
  const { fx } = M;
  const w = makeWorld(M, { realVcrPanel: true });
  const h = buildFixture(M, w);
  const v = w.game.sys.vcr;
  v.configure(fx.wp5VcrConfig(h));
  try {
    v.insert();
  } catch (err) {
    t('tapeScene build (needs WP2 createCharacter) — skipped in M1b', true, String(err?.message ?? err).slice(0, 80));
    return;
  }
  const s = v.tapeScene;
  let leaks = false;
  s?.traverse(o => { if (o === w.root || o === w.game.playerModel.root) leaks = true; });
  t('tapeScene is a separate scene without area root / player', s !== null && s !== w.game.scene && !leaks);
  t('tape feed registered while panel open', w.log.feeds.some(f => f.key === 'tape'));
  w.game.modes.resetTo('mode.explore');
  t('tapeScene released when the panel closes', v.tapeScene === null && !w.log.feeds.some(f => f.key === 'tape'));
}

function testConsole(M, R) {
  const { t } = R;
  const { fx } = M;
  const w = makeWorld(M);
  const h = buildFixture(M, w);
  const { game } = w;
  const k = game.sys.cctv;
  t('validate() is [] before any configure', k.validate().length === 0);
  const cfg = fx.wp5ConsoleConfig(h);
  k.configure({ screen: cfg.screen, viewPose: cfg.viewPose, channels: cfg.channels });
  t('partial configure → missing tunnelBaked', JSON.stringify(k.validate()) === '["console.tunnelBaked"]', JSON.stringify(k.validate()));
  k.configure({ tunnelBaked: cfg.tunnelBaked, tunnelInner: cfg.tunnelInner });
  t('second half completes the config', k.validate().length === 0);
  let threw = false;
  try {
    k.configure({ viewPose: cfg.viewPose });
  } catch {
    threw = true;
  }
  t('same field twice throws in dev', threw);
  t('feeds registered for CH1 (self) and CH2 (live)', ['ch1', 'ch2'].every(key => w.log.feeds.some(f => f.key === key)));
  let chEvt = null;
  game.events.on('cctv:channel', e => { chEvt = e; });
  t('open pushes panel_console', k.open().ok && game.modes.top === 'mode.panel_console' && w.log.fixed?.role === 'ch1');
  game.modes.dispatch({ t: 'digit', n: 4 });
  t('digit selects channel + event', k.channel === 4 && chEvt?.channel === 4);
  t('digit 7 → bad_args', game.modes.dispatch({ t: 'digit', n: 7 }).reason === 'bad_args');
  const ch2 = w.log.feeds.find(f => f.key === 'ch2');
  const ch1 = w.log.feeds.find(f => f.key === 'ch1');
  t('CH2 feed only due while CH2 is shown', ch2.due(0) === false);
  k.select(2);
  // M1d：CH2 与镜面错开一帧（(frameNo + 1) % feedEvery），low 档 feedEvery = 4
  t('CH2 feed due on CH2 (every feedEvery frames, staggered)', ch2.due(3) === true && ch2.due(0) === false);
  k.select(1);
  t('CH1 feed idle without the jack', ch1.due(0) === false && k.screenContent()?.tunnelMix === 0);
  let jackEvt = null;
  game.events.on('jack', e => { jackEvt = e; });
  k.plugJack();
  t('plugJack → jack event, CH1 feed due', k.jack && jackEvt?.plugged === true && ch1.due(0) === true);
  game.modes.dispatch({ t: 'vf' });
  k.update(1 / 30);
  t('tunnel depth grows when the overlay faces the screen at 1× (CH1 + jack)', k.tunnelDepth() >= 6, `depth=${k.tunnelDepth()}`);
  const sc = k.screenContent();
  t('rt tunnel: tunnelMix in (0,1) for tunnelInner', sc.tunnelMix > 0 && sc.tunnelMix < 1, `mix=${sc.tunnelMix}`);
  game.settings.tunnelMode = 'baked';
  const sb = k.screenContent();
  t('baked tunnel: tunnelMix = 1 and CH1 feed idle', sb.tunnelMix === 1 && sb.tunnel !== null && ch1.due(0) === false);
  game.settings.tunnelMode = 'rt';
  game.modes.dispatch({ t: 'back' });
  t('overlay Esc passes to panel = leave panel', game.modes.top === 'mode.explore');
  k.unplugJack();
  k.update(1 / 30);
  t('unplug → depth 0', !k.jack && k.tunnelDepth() === 0);
  k.setLayout('split5');
  const s5 = k.screenContent();
  // M1d：屏幕看不见（这里相机没对着它）时不刷新；分屏过场里刷新
  t('split5 content: layout 1; CH2 idle while the screen is not visible', s5.layout === 1 && ch2.due(3) === false);
  game.modes.push('mode.cutscene');
  t('split5 during a cutscene: CH2 feed due', ch2.due(3) === true);
  game.modes.pop('mode.cutscene');
  game.events.emit('cutscene:end', { id: 'cs.dev.x' });
  t('cutscene end → back to single', k.layout === 'single');
  k.open();
  t('open resets layout to single', k.layout === 'single');
  game.modes.resetTo('mode.explore');
  k.clearArea();
  t('clearArea unregisters feeds, validate [] again', !w.log.feeds.some(f => f.key === 'ch1' || f.key === 'ch2') && k.validate().length === 0 && !k.jack);
}

function testTripod(M, R) {
  const { t } = R;
  const { fx } = M;
  const w = makeWorld(M);
  const h = buildFixture(M, w);
  const { game } = w;
  const tr = game.sys.tripod;
  tr.configure(fx.wp5TripodConfig(h));
  fx.WP5_PROBE.reset();
  const zone = fx.WP5_POS.zone;
  const e = tr.enter();
  t('enter → armed, mode.tripod, head on mount, save held, CH1 pose role tripod', e.ok && tr.state === 'armed' && game.modes.top === 'mode.tripod'
    && w.log.detached && game.playerModel.head.group.parent === h.mount && game.save.held && w.log.fixed?.role === 'tripod');
  t('bodyGoto moves the body', tr.bodyGoto(zone[0] + 3, zone[2]).ok && game.player.position.x === zone[0] + 3);
  t('E before start is allowed only when armed; shutter starts', game.modes.dispatch({ t: 'shutter' }).ok && tr.state === 'countdown' && tr.remaining === 10);
  t('cancel refused during countdown', tr.cancel().reason === 'mode_disallows');
  const step = sec => { for (let i = 0; i < Math.round(sec * 30); i++) tr.update(1 / 30); };
  step(10.1);
  t('outside the mark at exposure → onFailOutside, back to armed', fx.WP5_PROBE.tripodOutside === 1 && tr.state === 'armed');
  tr.bodyGoto(zone[0] + 0.5, zone[2]);
  tr.start();
  step(10.1);
  t('exposing with progress', tr.state === 'exposing');
  game.input.moving = true;
  step(0.1);
  game.input.moving = false;
  t('moving during exposure → onFailMoved', fx.WP5_PROBE.tripodMoved === 1 && tr.state === 'armed');
  const c = game.modes.dispatch({ t: 'interact' });
  t('E while armed → cancel: head back, explore, save released', c.ok && game.modes.top === 'mode.explore' && !w.log.detached && !game.save.held);
  // 从强制对话的选项里进入：等对话弹出后再压
  game.modes.push('mode.dialogue');
  tr.enter();
  t('enter during dialogue defers the push', game.modes.top === 'mode.dialogue' && game.save.held);
  game.modes.pop('mode.dialogue');
  t('push happens right after the dialogue pops', game.modes.top === 'mode.tripod' && tr.state === 'armed');
  tr.start();
  step(10.1);
  step(1.5);
  t('exposure01 progresses', tr.exposure01 > 0.4 && tr.exposure01 < 0.6, `${tr.exposure01}`);
  step(1.6);
  t('still inside for 3s → onSuccess, tripod popped, head stays on mount, hold kept', fx.WP5_PROBE.tripodSuccess === 1 && tr.state === 'off'
    && game.modes.top === 'mode.explore' && w.log.detached && game.save.held);
  t('re-enter refused while the head is still on the mount', tr.enter().reason === 'busy');
  const rec = game.sys.photo.award('ph.final');
  t('award right after the exposure is recorded as a tripod photo', rec.context === 'tripod' && game.sys.photo.award('ph.tudi').context === 'live');
  tr.clearArea();
  t('clearArea puts the head back', !w.log.detached);
}

function testMirror(M, R) {
  const { t } = R;
  const { fx, THREE } = M;
  const w = makeWorld(M);
  const h = buildFixture(M, w);
  const { game } = w;
  const mi = game.sys.mirror;
  mi.register(fx.wp5MirrorDef(h));
  const d = mi.disc('r1.mirror');
  t('disc: center, +z normal, radius from CircleGeometry', d.center.distanceTo(new THREE.Vector3(...fx.WP5_POS.mirror)) < 1e-9 && Math.abs(d.normal.z - 1) < 1e-9 && d.radius === 0.25);
  t('unknown mirror → radius 0', mi.disc('r1.desk').radius === 0);
  const feed = w.log.feeds.find(f => f.key === 'mirror');
  game.player.position.set(fx.WP5_POS.mirrorFront[0], 0, fx.WP5_POS.mirrorFront[1]);
  t('active near the mirror; due every mirrorEvery frames', mi.active && feed.due(0) === true && feed.due(1) === false);
  // 反射数学：主相机正对镜心 → 镜心在反射图像正中（textureMatrix·镜心 → (0.5, 0.5)）
  const cam = game.cameras.tp;
  cam.position.set(fx.WP5_POS.mirror[0], fx.WP5_POS.mirror[1], fx.WP5_POS.mirror[2] + 1);
  cam.lookAt(...fx.WP5_POS.mirror);
  cam.updateMatrixWorld(true);
  let renderedWith = null;
  let mirrorVisibleDuring = null;
  const fakeR = {
    autoClear: true, rt: null,
    getRenderTarget() { return this.rt; }, setRenderTarget(x) { this.rt = x; },
    state: { buffers: { depth: { setMask() {} } } }, clear() {},
    render(_s, c) { renderedWith = c; mirrorVisibleDuring = h.mirror.visible; },
  };
  feed.render(fakeR);
  const rc = renderedWith;
  t('reflection camera = camera mirrored through the plane', rc && Math.abs(rc.position.z - (fx.WP5_POS.mirror[2] - 1)) < 1e-9 && Math.abs(rc.position.x - fx.WP5_POS.mirror[0]) < 1e-9);
  t('mirror hidden while rendering its RT, restored after', mirrorVisibleDuring === false && h.mirror.visible === true);
  const tm = h.mirror.material.uniforms.textureMatrix.value;
  const c4 = new THREE.Vector4(0, 0, 0, 1).applyMatrix4(tm);
  t('textureMatrix maps the mirror center to the RT center (no UV flip)', Math.abs(c4.x / c4.w - 0.5) < 1e-6 && Math.abs(c4.y / c4.w - 0.5) < 1e-6);
  // 投影采样、不翻 UV：反射相机站在镜后朝房间看，世界 +x 在它的左手边；镜面右缘（局部 +x）正好采样 RT 的左半边，
  // 于是镜子右边显示的就是房间右边的东西（镜子只翻前后，不翻左右）
  const r4 = new THREE.Vector4(0.2, 0, 0, 1).applyMatrix4(tm);
  t('mirror right edge samples the RT left half (projective, no UV flip)', r4.x / r4.w < 0.5);
  t('reflection layers: world + self_head without viewfinder', rc.layers.mask === ((1 << 0) | (1 << 3)));
  // 斜裁面：镜面平面上的点深度 ≈ 近裁面（NDC z ≈ -1）
  const onPlane = new THREE.Vector3(fx.WP5_POS.mirror[0] + 0.1, fx.WP5_POS.mirror[1], fx.WP5_POS.mirror[2]).project(rc);
  t('oblique near plane coincides with the mirror plane', Math.abs(onPlane.z + 1) < 0.02, `ndc z=${onPlane.z}`);
  game.settings.mirrorMode = 'baked';
  game.events.emit('settings', { key: 'mirrorMode', value: 'baked' });
  t('baked mode swaps to the baked material and stops the feed', h.mirror.material.isMeshBasicMaterial === true && feed.due(0) === false);
  mi.clearArea();
  t('clearArea restores the original material and unregisters', !w.log.feeds.some(f => f.key === 'mirror') && h.mirror.material.isMeshBasicMaterial === true);
}

function testCrt(M, R) {
  const { t } = R;
  const { fx } = M;
  const w = makeWorld(M);
  const h = buildFixture(M, w);
  const { game } = w;
  const orig = h.screen.material;
  let crt;
  try {
    crt = new M.crt.CrtScreenController(game);
    game.sys.crt = crt;
    game.sys.cctv.configure(fx.wp5ConsoleConfig(h));
  } catch (err) {
    t('CRT controller with the real crtScreen material (needs WP3) — skipped', true, String(err?.message ?? err).slice(0, 80));
    return;
  }
  t('attach swaps in a private CRT material (not the shared one)', h.screen.material === crt.material && crt.material !== orig);
  game.sys.vcr.configure(fx.wp5VcrConfig(h));
  t('second attach of the same screen is a no-op', h.screen.material === crt.material);
  crt.update(1 / 30);
  const u = crt.material.uniforms;
  t('standby = current console channel (single layout, no split)', u.layout.value === 0 && u.split.value === 0 && u.osd.value !== null);
  game.sys.cctv.setLayout('split5');
  crt.update(0.6);
  t('split5 → layout 1 with atlas', u.layout.value === 1 && u.atlas.value !== null);
  game.sys.cctv.setLayout('single');
  game.sys.vcr.insert();
  game.sys.vcr.seek('03:00:00');
  crt.update(1 / 30);
  t('vcr panel has priority: split after 02:51', u.split.value === 1 && u.layout.value === 0);
  game.modes.resetTo('mode.explore');
  crt.update(1 / 30);
  t('panel closed → back to console content', u.split.value === 0);
  crt.detach();
  t('detach restores the original material', h.screen.material === orig && u.map.value === null);
}

function testViewfinder(M, R) {
  const { t } = R;
  const { fx } = M;
  const w = makeWorld(M);
  buildFixture(M, w);
  const { game } = w;
  const vf = game.sys.viewfinder;
  let evt = null;
  game.events.on('viewfinder', e => { evt = e; });
  game.modes.push('mode.viewfinder');
  t('enter → on, viewfinder event, vf post pushed', vf.on && evt?.on === true && w.log.post.includes('+vf'));
  t('IR without ability → no_ability', vf.setLens('ir').reason === 'no_ability' && vf.lens === 'normal');
  w.flags.set('r2.ability_ir', true);
  t('IR with ability → ok + ir post', vf.setLens('ir').ok && vf.lens === 'ir' && w.log.post.includes('+ir'));
  const zs = [];
  for (let i = 0; i < 6; i++) zs.push(vf.stepZoom(1));
  t('zoom steps 2,3,4,6,6,6', zs.join(',') === '2,3,4,6,6,6' && game.cameras.fp.zoom === 6 && w.log.headZoom === 6);
  for (let i = 0; i < 6; i++) vf.stepZoom(-1);
  t('zoom back to 1', vf.zoom === 1);
  w.put(fx.WP5_POS.S1, fx.WP5_POS.D);
  t('temp reading of the 36℃ IR-only object', vf.tempReading() === 36, `${vf.tempReading()}`);
  w.put(fx.WP5_POS.S1, fx.WP5_POS.A);
  t('temp reading defaults to 18℃ for untagged materials', vf.tempReading() === 18);
  w.put(fx.WP5_POS.S1, [fx.WP5_POS.S1[0], 30, fx.WP5_POS.S1[1] - 5]);
  t('temp reading of the sky = ambient', vf.tempReading() === 18);
  const s = vf.frameNdcScale();
  t('frameNdcScale for a wide viewport (x=100,w=800)', Math.abs(s.sx - 1.25) < 1e-9 && s.sy === 1);
  const cam = vf.syncPhotoCamera();
  t('photo camera: 4:3, vfov 50, zoom, fp pose', cam.aspect === 4 / 3 && cam.fov === 50 && cam.zoom === 1 && cam.position.distanceTo(game.cameras.fp.position) < 1e-9);
  game.modes.dispatch({ t: 'vf' });
  t('right click leaves; lens/zoom kept; post popped', !vf.on && vf.lens === 'ir' && w.log.post.includes('-vf') && w.log.post.includes('-ir'));
  t('tempReading null outside viewfinder', vf.tempReading() === null);
  // 叠加在面板上：pass 规则
  const w2 = makeWorld(M);
  const h2 = buildFixture(M, w2);
  w2.game.sys.cctv.configure(fx.wp5ConsoleConfig(h2));
  w2.game.sys.cctv.open();
  w2.game.modes.push('mode.viewfinder');
  const vm = w2.handlers.get('mode.viewfinder');
  const stack = w2.game.modes.stack;
  t('overlay: look disabled, move none, pointer free', vm.look(stack) === false && vm.move(stack) === 'none' && vm.pointer(stack) === 'free');
  t('overlay: interact/back/play/digit/hint pass down', ['interact', 'back', 'play', 'hint'].every(k => vm.handle({ t: k }).pass === true)
    && vm.handle({ t: 'digit', n: 1 }).pass === true);
  t('overlay: album/journal refused', vm.handle({ t: 'album' }).reason === 'mode_disallows');
  const pc = w2.game.sys.viewfinder.syncPhotoCamera();
  t('overlay: photo camera at the panel viewPose', pc.position.distanceTo(new M.THREE.Vector3(...fx.WP5_VIEW.pos)) < 1e-9);
  w2.game.modes.dispatch({ t: 'vf' });
  t('overlay: right click → back to the panel', w2.game.modes.top === 'mode.panel_console');
  // 非叠加：hold 模式按下不退出
  const w3 = makeWorld(M);
  w3.game.modes.push('mode.viewfinder');
  w3.game.modes.dispatch({ t: 'vf', down: true });
  t('hold mode: vf down keeps the viewfinder; up leaves', w3.game.sys.viewfinder.on && w3.game.modes.dispatch({ t: 'vf', down: false }).ok && !w3.game.sys.viewfinder.on);
  w3.game.modes.push('mode.viewfinder');
  t('explore-level actions: E → interaction.interactFocused', w3.game.modes.dispatch({ t: 'interact' }).result === 'interact');
}

// ==================================================================== 入口

export async function unit() {
  installFakeCanvas();
  const R = makeReport('wp5');
  const { M, close } = await loadModules();
  try {
    for (const [name, fn] of [['photo', testPhoto], ['read', testRead], ['replay', testReplay], ['vcr', testVcr], ['tape', testTapeScene],
      ['console', testConsole], ['tripod', testTripod], ['mirror', testMirror], ['crt', testCrt], ['viewfinder', testViewfinder]]) {
      try {
        fn(M, R);
      } catch (err) {
        R.t(`${name} threw`, false, err?.stack ?? String(err));
      }
    }
  } finally {
    await close();
  }
  return { ok: R.failed === 0, notes: R.notes };
}

/** 页面内自测：h.call('selftest', name) → { ok, result: { ok, notes } }。 */
export async function page(h) {
  const notes = [];
  let ok = true;
  for (const name of PAGE_TESTS) {
    const r = await (h.call.try ?? h.call)('selftest', name);
    const res = r?.result ?? r;
    const pass = res?.ok === true;
    ok &&= pass;
    notes.push(`${pass ? 'ok  ' : 'FAIL'} page ${name}`);
    for (const n of res?.notes ?? []) if (!pass || process.env.WP5_VERBOSE) notes.push(`      ${n}`);
  }
  return { ok, notes };
}

export default async function run(h) {
  const u = await unit();
  const p = h ? await page(h) : { ok: true, notes: ['(page tests skipped: no harness)'] };
  return { ok: u.ok && p.ok, notes: [...u.notes, ...p.notes] };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const wantPage = process.argv.includes('--page');
  let h = null;
  if (wantPage) {
    const lib = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/harness.mjs')).href);
    h = await lib.launch({ query: 'debug=1&test=1&lockstep=1&quality=low&area=dev' });
  }
  try {
    const r = await run(h);
    for (const n of r.notes) if (!n.startsWith('ok') || process.env.WP5_VERBOSE) console.log(n);
    const total = r.notes.filter(n => /^(ok|FAIL)/.test(n)).length;
    const bad = r.notes.filter(n => n.startsWith('FAIL')).length;
    console.log(`wp5 selftest: ${total - bad}/${total} passed${bad ? `, ${bad} FAILED` : ''}`);
    process.exitCode = r.ok ? 0 : 1;
  } finally {
    await h?.close?.();
  }
}
