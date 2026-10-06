// owner: integrator
// M1d 引擎评审修复的回归自测（ARCH §15.3）：scripts/selftest/m1d.mjs 经 __game.selftest('m1d.*') 调用。
// 每个自测对应一条评审问题（ARCH 里标“M1d”的条文）；页面内直接调用系统，不经调试 API。
// 'm1d.ending_title' 会卸载当前区域并开新游戏，必须最后跑（m1d.mjs 的 PAGE_TESTS 顺序）。

import * as THREE from 'three';
import type { AreaPart } from '../../core/area';
import type { Game } from '../../core/game';
import type { QualityLevel } from '../../core/types';
import type { SelftestResult } from '../../debug/selftest';
import { registerSelftest } from '../../debug/selftest';
import { DEV_SPAWN } from '../../data/ids';
import { E } from '../../game/effects';
import { applySetting } from '../../game/settings';
import { STEP_MAX } from '../../core/collision';

const part: AreaPart = {};
export default part;

class Notes {
  readonly notes: string[] = [];
  private bad = 0;
  check(cond: unknown, msg: string, detail?: unknown): void {
    if (cond) this.notes.push(`ok: ${msg}`);
    else {
      this.bad++;
      this.notes.push(`FAIL: ${msg}${detail === undefined ? '' : `（${typeof detail === 'string' ? detail : JSON.stringify(detail)}）`}`);
    }
  }
  result(): SelftestResult {
    return { ok: this.bad === 0, notes: this.notes };
  }
}

async function isolated(game: Game, fn: () => Promise<void> | void): Promise<void> {
  const snap = game.state.snapshot();
  try {
    await fn();
  } finally {
    if (game.modes.stack.length > 1 || game.effects.busy) game.modes.resetTo('mode.explore');
    game.state.restore(snap);
    game.sys.npc.reevaluate();
  }
}

/** 推进游戏时间（锁步下 advance；自测在调试 API 的串行队列里，不在 step 内）。 */
async function advance(game: Game, sec: number): Promise<void> {
  await game.advance(sec, 1 / 30);
}

// ==================================================================== blocker：过渡期间的暂停

/** 带淡入淡出的传送进行中请求暂停：不立刻压（否则冻结世界、黑幕盖住暂停页），过渡结束后补压；暂停页上 Esc 在输入挂起时也能关掉暂停。 */
registerSelftest('m1d.pause_in_fade', async game => {
  const n = new Notes();
  await isolated(game, async () => {
    const p = game.player.position;
    const here: [number, number, number] = [p.x, p.y, p.z];
    const tp = game.areas.teleport(here, { fade: 0.8 });
    n.check(game.areas.isLoading() && game.input.suspended, '传送淡出中：isLoading 且输入挂起');
    game.requestPause();
    n.check(game.modes.top !== 'mode.pause', '过渡中请求暂停：先不压', game.modes.stack);
    await tp;
    n.check(!game.areas.isLoading() && !game.input.suspended, '传送结束：不再加载、输入解锁');
    n.check(game.modes.top === 'mode.pause', '过渡结束后补压暂停', game.modes.stack);
    n.check(game.ui.fade.blackLevel() < 0.01, '黑幕已撤掉', game.ui.fade.blackLevel());
    // 暂停页上输入挂起（例如别的过渡）时 Esc 仍然送达暂停模式
    game.input.suspended = true;
    try {
      game.input.inject('Escape', true);
      game.input.inject('Escape', false);
      game.step(0, false);
    } finally {
      game.input.suspended = false;
    }
    n.check(game.modes.top === 'mode.explore', '输入挂起时暂停页的 Esc 照样关掉暂停', game.modes.stack);
  });
  return n.result();
});

/** 传送的等待抛错（超时）时：输入解锁、黑幕撤掉、isLoading 复位，错误照常抛给调用方。 */
registerSelftest('m1d.teleport_failsafe', async game => {
  const n = new Notes();
  const orig = game.waitGame.bind(game);
  let threw = false;
  game.waitGame = () => Promise.reject(Object.assign(new Error('m1d: simulated timeout'), { name: 'TimeoutError' }));
  try {
    const p = game.player.position;
    await game.areas.teleport([p.x, p.y, p.z], { fade: 0.8 });
  } catch {
    threw = true;
  } finally {
    game.waitGame = orig;
  }
  n.check(threw, '等待抛错照常传给调用方');
  n.check(!game.areas.isLoading(), 'isLoading 复位');
  n.check(!game.input.suspended, '输入解锁');
  n.check(game.ui.fade.blackLevel() < 0.01, '黑幕撤掉', game.ui.fade.blackLevel());
  return n.result();
});

// ==================================================================== major：推迟的画质重进

/** 画质改动在暂停/临时模式中推迟；回到 explore 后若 runner 忙或存档 hold 中仍不重进；二者都结束后下一帧才重进。 */
registerSelftest('m1d.quality_deferred', async game => {
  const n = new Notes();
  const orig: QualityLevel = game.settings.quality;
  const other: QualityLevel = orig === 'low' ? 'mid' : 'low';
  const area0 = game.areas.current;
  try {
    n.check(game.modes.push('mode.pause').ok, '压暂停');
    applySetting(game, 'quality', other);
    await advance(game, 0.2);
    n.check(game.areas.current === area0, '暂停中改画质：推迟');
    game.modes.pop('mode.pause');
    let outcome = '';
    const run = game.effects.run([E.wait(0.6)], 'm1d.busy').then(o => { outcome = o; });
    await advance(game, 0.2);
    n.check(game.areas.current === area0 && game.effects.busy, 'runner 忙（例如三脚架成功后的结局过场）：推迟');
    game.save.hold('ending');
    await game.drive(() => outcome !== '', 10);
    await run;
    n.check(outcome === 'done', '进行中的 run 没有被重进取消', outcome);
    await advance(game, 0.2);
    n.check(game.areas.current === area0, '存档 hold（结局期间）：推迟');
    game.save.release('ending');
    await game.drive(() => game.areas.current !== area0 && !game.areas.isLoading(), 30);
    n.check(game.areas.current !== area0 && game.areas.current?.def.id === 'dev', 'hold 释放、runner 空闲后重进当前区域');
  } finally {
    game.save.release('ending');
    if (game.settings.quality !== orig) {
      const a1 = game.areas.current;
      applySetting(game, 'quality', orig);
      await game.drive(() => game.areas.current !== a1 && !game.areas.isLoading(), 30).catch(() => undefined);
    }
  }
  return n.result();
});

// ==================================================================== major：面板与两层取景器

registerSelftest('m1d.vf_panel', async game => {
  const n = new Notes();
  const vf = game.sys.viewfinder;
  await isolated(game, () => {
    n.check(game.modes.push('mode.viewfinder').ok && vf.on, '开取景器');
    const r = game.sys.cctv.open();
    n.check(r.ok, '取景器里打开监控台（WP5 夹具）', r);
    n.check(JSON.stringify(game.modes.stack) === JSON.stringify(['mode.explore', 'mode.panel_console']), '面板压在 explore 上（裸取景器先弹掉）', game.modes.stack);
    n.check(!vf.on && !game.pipeline.post.layers().includes('vf'), '面板上没有取景器后期', game.pipeline.post.layers());
    n.check(game.modes.push('mode.viewfinder').ok && vf.on, '面板上右键叠取景器');
    game.modes.pop('mode.viewfinder');
    n.check(!vf.on, '弹掉叠加的取景器 → 关');
    game.modes.pop('mode.panel_console');
    // 直接构造两层取景器（旧路径 / 回放中按 E）：弹掉上层后下层仍然开着
    game.modes.push('mode.viewfinder');
    game.modes.push('mode.panel_console');
    game.modes.push('mode.viewfinder');
    game.modes.pop('mode.viewfinder');
    n.check(vf.on && game.pipeline.post.layers().includes('vf'), '两层取景器弹掉上层：下层仍开（setOn 看栈）', { on: vf.on, layers: game.pipeline.post.layers() });
    game.modes.pop('mode.panel_console');
    n.check(game.modes.top === 'mode.viewfinder' && vf.on, '回到下层取景器，仍是开着的');
    game.modes.pop('mode.viewfinder');
    n.check(!vf.on, '最后一层弹掉 → 关');
  });
  return n.result();
});

// ==================================================================== major：门槛高度（控制器与栅格同一常量）

registerSelftest('m1d.curb', async game => {
  const n = new Notes();
  const col = game.collision;
  const start: [number, number, number] = [0, 0, 8];
  const goal: [number, number, number] = [0, 0, 2];
  for (const [h, pass] of [[0.10, true], [0.12, true], [STEP_MAX, true], [0.22, false]] as const) {
    const key = `m1d.curb_${h}`;
    // 横贯整个沙盒（30m）：绕不过去
    const d = col.addDynamic(key, { box: { center: [0, h / 2, 5.5], size: [30, h, 0.3] } }, () => true);
    try {
      game.player.teleport(start, 0);
      const reach = col.reachable(start, goal);
      const w = await game.player.walkTo(goal[0], goal[2], { timeoutSec: 8 });
      n.check(reach === pass, `${h.toFixed(2)}m 路沿：reachable = ${pass}`, reach);
      n.check(w.ok === pass, `${h.toFixed(2)}m 路沿：walkTo ${pass ? '走得过去' : '被挡住'}`, w);
    } finally {
      d.remove();
    }
  }
  // 0.58m 窄缝：测试胶囊半径 = 玩家半径 0.3，不能放行
  const a = col.addDynamic('m1d.slit_a', { box: { center: [-7.79, 1, 5.5], size: [15, 2, 0.3] } }, () => true);
  const b = col.addDynamic('m1d.slit_b', { box: { center: [7.79, 1, 5.5], size: [15, 2, 0.3] } }, () => true);
  try {
    n.check(!col.reachable(start, goal), '0.58m 窄缝：reachable = false');
  } finally {
    a.remove();
    b.remove();
    game.player.teleport(start, 0);
  }
  return n.result();
});

// ==================================================================== minor：过场里撤掉取景器后期；区域推的后期层与临时状态

registerSelftest('m1d.cutscene_vf_post', async game => {
  const n = new Notes();
  await isolated(game, () => {
    game.modes.push('mode.viewfinder');
    n.check(game.pipeline.post.layers().includes('vf'), '取景器：vf 层在');
    game.modes.push('mode.cutscene');
    n.check(!game.pipeline.post.layers().includes('vf') && !game.pipeline.post.layers().includes('ir'), '过场压上：vf/ir 层撤掉', game.pipeline.post.layers());
    game.modes.pop('mode.cutscene');
    n.check(game.pipeline.post.layers().includes('vf'), '过场结束：vf 层回来');
    game.modes.pop('mode.viewfinder');
  });
  return n.result();
});

registerSelftest('m1d.area_post', async game => {
  const n = new Notes();
  const cur = game.areas.current;
  if (!cur) return { ok: false, notes: ['没有区域'] };
  const post = game.pipeline.post;
  // 函数形式的 post 随 'temp' 重算
  cur.ctx.post(s => (s.temp('m1d_red') ? 'darkroom_red' : 'dev'));
  cur.ctx.setTemp('m1d_red', true);
  game.renderNow();
  n.check(post.current.monoRed > 0.5, "ctx.post 的函数形式随 setTemp 重算（'temp' 事件）", post.current.monoRed);
  cur.ctx.setTemp('m1d_red', false);
  cur.ctx.post(cur.def.post);
  // 经 GameApi 推的层随区域卸载弹掉
  game.api.post.push('m1d_red', { monoRed: 1 });
  n.check(post.layers().includes('m1d_red'), 'GameApi.post.push 推入');
  await game.areas.enter('dev', DEV_SPAWN.START, { reason: 'debug' });
  n.check(!post.layers().includes('m1d_red'), '重进区域后该层已弹掉', post.layers());
  return n.result();
});

// ==================================================================== major：结局播完回标题；新游戏复位主角

registerSelftest('m1d.ending_title', async game => {
  const n = new Notes();
  const pm = game.playerModel;
  const bodyVisible = (): number => {
    let k = 0;
    pm.body.root.traverse(o => {
      if ((o as THREE.Mesh).isMesh && o.visible) k++;
    });
    return k;
  };
  const visible0 = bodyVisible();
  game.save.hold('ending');
  game.api.player.model.setVisible(false);
  game.api.player.model.setBodyOpacity(0, 0);
  game.api.post.push('dawn_tint', { tintAmt: 0.3 });
  const plugTo = new THREE.Object3D();
  game.areas.current?.root.add(plugTo);
  game.api.player.model.cable.plugTo(plugTo);
  n.check(game.api.player.model.cable.plugged, 'GameApi.player.model.cable.plugTo 插上');
  game.api.shichen.override('04:58:00');
  await advance(game, 1);
  n.check(game.sys.shichen.clockText() === '04:59', 'GameApi.shichen.override 驱动加速钟（04:58 起，1 秒 ≈ 70 钟秒）', game.sys.shichen.clockText());
  game.api.shichen.override(null);
  const out = await game.effects.run([E.ending('main')], 'm1d.ending');
  n.check(out === 'done' && game.ending === 'main' && game.save.completed, '结局：ending=main，写了通关标记');
  await game.drive(() => game.ui.menus.currentPage() === 'title' && !game.areas.isLoading(), 30);
  n.check(game.areas.current === null, '引擎回标题：区域已卸载');
  n.check(game.ui.menus.currentPage() === 'title' && game.modes.stack.length === 1, '标题菜单、栈只剩 explore', game.modes.stack);
  const items = [...game.ui.menus.el.querySelectorAll<HTMLElement>('button.cm-menu-item')].filter(b => b.offsetParent !== null || b.closest('.cm-hidden') === null).map(b => b.dataset.item);
  n.check(!items.includes('continue') && items.includes('new'), '通关后标题没有“继续”', items);
  n.check(!pm.head.cable.plugged && pm.headMounted, '视频线已拔出、头在身上');
  n.check(!game.pipeline.post.layers().includes('dawn_tint'), '区域推的 dawn_tint 已随区域卸载弹掉', game.pipeline.post.layers());
  n.check(game.dispatch({ t: 'back' }).ok === false && game.modes.top === 'mode.explore', '标题上 Esc 不压暂停');
  await game.newGame();
  n.check(bodyVisible() === visible0 && visible0 > 0, `新游戏：主角身子网格全部可见（${bodyVisible()}/${visible0}）`);
  n.check(game.ending === 'none' && !game.save.completed && !game.save.held, '新游戏：ending/通关标记/hold 复位');
  return n.result();
});

// ==================================================================== minor：着色器程序稳定性（m1d.mjs 的 programsStable 用的小工具）

/** 画质切到 mid 并等重进完成（Bloom 路径；m1d.mjs 的着色器稳定性用例）。 */
registerSelftest('m1d.quality_mid', async game => setQualityAndWait(game, 'mid'));
/** 画质切回 low（core.mjs 的默认）。 */
registerSelftest('m1d.quality_low', async game => setQualityAndWait(game, 'low'));

async function setQualityAndWait(game: Game, q: QualityLevel): Promise<SelftestResult> {
  if (game.settings.quality === q) return { ok: true, notes: [`已是 ${q}`] };
  const a0 = game.areas.current;
  applySetting(game, 'quality', q);
  await game.drive(() => game.areas.current !== a0 && !game.areas.isLoading(), 60);
  return { ok: game.settings.quality === q && game.areas.current !== a0, notes: [`quality → ${q}`] };
}

/** 监控台：CH1 插线 + 面板上叠取景器（照妖镜套叠）+ CH2 实时，每种状态渲一个辅助 RT 周期。 */
registerSelftest('m1d.console_pass', async game => {
  const n = new Notes();
  const frames = (k: number): void => {
    for (let i = 0; i < k; i++) game.pipeline.render(1 / 30);
  };
  await isolated(game, () => {
    const k = game.sys.cctv;
    n.check(k.open().ok, '打开监控台（WP5 夹具）');
    k.select(1);
    k.plugJack();
    frames(4);
    game.modes.push('mode.viewfinder');
    k.update(1 / 30);
    frames(12);
    game.modes.pop('mode.viewfinder');
    k.select(2);
    frames(12);
    k.unplugJack();
    game.modes.pop('mode.panel_console');
  });
  return n.result();
});

/** 主角身子半透明（P14 身子空下去）与 NPC 淡出（fadeTo）：各渲两帧再还原。 */
registerSelftest('m1d.fade_pass', async game => {
  const n = new Notes();
  const pm = game.playerModel;
  pm.setBodyOpacity(0.5, 0);
  game.renderNow();
  game.renderNow();
  pm.setBodyOpacity(1, 0);
  const npc = game.sys.npc.get('npc.wang') as (ReturnType<typeof game.sys.npc.get> & { setOpacity?(a: number): void }) | undefined;
  n.check(npc?.setOpacity !== undefined, 'WP4 夹具 npc.wang 在场');
  if (npc?.setOpacity) {
    npc.setOpacity(0.5);
    game.renderNow();
    npc.setOpacity(1);
  }
  game.renderNow();
  return n.result();
});

/** 截图探针（不在 m1d.mjs 的 PAGE_TESTS 里，手动看图用）：取景器里出一条字幕；再在取景器里翻开取件单（阅读器顶上的 REC/OSD 行）。 */
registerSelftest('m1d.ui_probe_sub', game => {
  game.ui.subtitle('（沙盒）字幕要让开取景器底部的变焦刻度。', 'npc.tudi', 30);
  return { ok: true };
});
registerSelftest('m1d.ui_probe_doc', game => {
  const r = game.sys.journal.openDoc('doc.slip_0473', { vf: true });
  return { ok: r.ok, notes: [JSON.stringify(r)] };
});

/**
 * 非锁步探针（手动验证 blocker 用，不在 PAGE_TESTS 里）：走出口切区域的淡出里请求暂停（direct = 直接压 mode.pause，模拟旧路径）。
 * 不等过渡结束就返回；调用方隔几秒用 state() 看结果。
 */
registerSelftest('m1d.rt_travel_pause', async game => {
  const r = game.areas.current?.def.exits[0];
  if (r) void game.areas.travel(r.id);
  for (let i = 0; i < 20 && !game.areas.isLoading(); i++) await game.nextFrame();
  const loading = game.areas.isLoading();
  game.requestPause();
  return { ok: true, notes: [`loading=${loading} top=${game.modes.top}`] };
});
registerSelftest('m1d.rt_travel_pause_direct', async game => {
  const r = game.areas.current?.def.exits[0];
  if (r) void game.areas.travel(r.id);
  for (let i = 0; i < 20 && !game.areas.isLoading(); i++) await game.nextFrame();
  const loading = game.areas.isLoading();
  game.modes.push('mode.pause');
  return { ok: true, notes: [`loading=${loading} top=${game.modes.top}`] };
});
registerSelftest('m1d.rt_probe', game => ({ ok: true, notes: [JSON.stringify({ area: game.areas.current?.def.id ?? null, loading: game.areas.isLoading(), top: game.modes.top, black: game.ui.fade.blackLevel(), suspended: game.input.suspended, page: game.ui.menus.currentPage() })] }));
