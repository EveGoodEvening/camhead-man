// owner: WP1
// WP1 在开发沙盒里的测试夹具（ARCH §15.2 “沙盒要包含的夹具”：一扇由条件控制的动态碰撞门、墙两侧的连通性），
// 并用 debug/selftest.ts 的 registerSelftest('wp1.<snake>', fn) 登记页面内自测；scripts/selftest/wp1.mjs 经 __game.selftest(name)（?debug=1&area=dev）调用。
//
// 夹具：沙盒东北角一间 4×4m 的小屋（“围栏”），南墙中间 1m 门洞里是动态碰撞门 wp1.pen_door，
// 条件 '!temp(wp1_pen_open)'：用区域临时状态开关，不需要任何游戏 flag（沙盒不许自造 id）。

import * as THREE from 'three';
import type { AreaContext, AreaPart } from '../../core/area';
import type { Game } from '../../core/game';
import type { SelftestResult } from '../../debug/selftest';
import type { V3 } from '../../core/types';
import { registerSelftest } from '../../debug/selftest';
import { KEYMAP, keymapButtons } from '../../core/actions';
import type { Button } from '../../core/input';
import { LAYER, setLayerRecursive } from '../../core/layers';
import { spawnClearanceIssues } from '../../core/triggers';

/** 夹具基准点（M1c 若与别的 WP 的夹具重叠，只改这里）。 */
export const WP1_ORIGIN: V3 = [10, 0, -9];
const at = (dx: number, y: number, dz: number): V3 => [WP1_ORIGIN[0] + dx, WP1_ORIGIN[1] + y, WP1_ORIGIN[2] + dz];

/** 夹具各处的位置（世界坐标）。 */
export const WP1_POS = {
  /** 围栏内部中心 */
  inside: at(0, 0, 0),
  /** 门洞外 4m（南） */
  outside: at(0, 0, 4),
  /** 围栏西墙外侧 / 内侧（墙两侧） */
  westOut: at(-3, 0, 0),
  westIn: at(-1, 0, 0),
  /** 离北墙内侧约 1.1m、面朝南：第三人称相机身后就是墙（满长 2.67m 放不下，拉近后仍在墙前） */
  nearNorthWall: at(0, 0, 1.2 - 2),
  /** 空地（围栏外东南，远离别的夹具） */
  open: at(0, 0, 7),
  /** 门洞中心 */
  door: at(0, 1.25, 2),
} as const;

const PEN_DOOR = 'wp1.pen_door';
const PEN_TEMP = 'wp1_pen_open';

function wallMesh(ctx: AreaContext, a: [number, number], b: [number, number], color: THREE.ColorRepresentation): void {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, 2.5, 0.2), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  m.position.set((a[0] + b[0]) / 2, 1.25, (a[1] + b[1]) / 2);
  m.rotation.y = Math.atan2(-dz, dx);
  ctx.add(m);
  ctx.collider.wall(a, b, 0, 2.5);
}

const wp1: AreaPart = {
  build(ctx) {
    const [ox, , oz] = WP1_ORIGIN;
    const c = '#5a6070';
    // 夹具自带一块 8×14m 的地面（与 WP7 底座的地面重叠无妨）：本包的自测不依赖底座是否已建好
    const pad = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 14), new THREE.MeshStandardMaterial({ color: '#2a2e36', roughness: 1 }));
    pad.position.set(ox, -0.1 + 0.002, oz + 4);
    ctx.add(pad);
    ctx.collider.floor(ox - 4, oz - 3, ox + 4, oz + 11, 0);
    // 西、东、北墙与南墙两段（中间留 1m 门洞）
    wallMesh(ctx, [ox - 2, oz - 2], [ox - 2, oz + 2], c);
    wallMesh(ctx, [ox + 2, oz - 2], [ox + 2, oz + 2], c);
    wallMesh(ctx, [ox - 2, oz - 2], [ox + 2, oz - 2], c);
    wallMesh(ctx, [ox - 2, oz + 2], [ox - 0.5, oz + 2], c);
    wallMesh(ctx, [ox + 0.5, oz + 2], [ox + 2, oz + 2], c);
    // 门扇：条件为真（门关着）时可见并挡人
    const door = new THREE.Mesh(new THREE.BoxGeometry(1, 2.5, 0.12), new THREE.MeshStandardMaterial({ color: '#8a5a3a', roughness: 0.7 }));
    door.position.set(...WP1_POS.door);
    ctx.add(door, { ref: 'wp1.pen_door_mesh' });
    ctx.collider.dynamic(PEN_DOOR, { box: { center: WP1_POS.door, size: [1, 2.5, 0.2] } }, `!temp(${PEN_TEMP})`);
    ctx.on('temp', e => {
      if (e.key === PEN_TEMP) door.visible = e.value !== true;
    });
  },
};

export default wp1;

// ==================================================================== 页面内自测（M1c 起必须通过）

type Notes = string[];
function result(notes: Notes, failures: number): SelftestResult {
  return { ok: failures === 0, notes };
}
function checker(): { notes: Notes; fail: () => number; check: (label: string, cond: boolean, detail?: unknown) => void } {
  const notes: Notes = [];
  let failures = 0;
  return {
    notes,
    fail: () => failures,
    check(label, cond, detail) {
      if (!cond) failures++;
      notes.push(`${cond ? 'ok' : 'FAIL'} ${label}${cond || detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
    },
  };
}

function ctxOf(game: Game): NonNullable<Game['areas']['current']>['ctx'] {
  const cur = game.areas.current;
  if (!cur || cur.def.id !== 'dev') throw new Error('wp1 自测需要在 ?debug=1&area=dev 沙盒里运行');
  return cur.ctx;
}

async function toSpawn(game: Game): Promise<void> {
  game.modes.resetTo('mode.explore');
  await game.areas.teleport(WP1_POS.open, { yaw: 0 });
}

registerSelftest('wp1.keymap', game => {
  const t = checker();
  const all = keymapButtons();
  for (const b of ['Tab', 'Space', 'Enter', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape'] as Button[]) {
    t.check(`${b} 在捕获阶段被拦截（出现在 KEYMAP 里）`, all.has(b));
  }
  let bad = 0;
  for (const [mode, row] of Object.entries(KEYMAP)) {
    for (const [b, bind] of Object.entries(row)) {
      const a = bind?.(true);
      if (!a || typeof a.t !== 'string') {
        bad++;
        t.notes.push(`  ${mode} ${b} 按下没有产生动作`);
      }
    }
  }
  t.check('每个绑定按下都产生动作', bad === 0);
  const prev = game.settings.vfMode;
  game.settings.vfMode = 'toggle';
  t.check('explore 右键（切换）→ {vf}', JSON.stringify(game.input.translate('MouseRight', true)) === '{"t":"vf"}' && game.input.translate('MouseRight', false) === null);
  game.settings.vfMode = 'hold';
  t.check('explore 右键（按住）→ 按下/松开', JSON.stringify(game.input.translate('MouseRight', false)) === '{"t":"vf","down":false}');
  game.settings.vfMode = prev;
  return result(t.notes, t.fail());
});

registerSelftest('wp1.layers_skip_lights', game => {
  const t = checker();
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
  const light = new THREE.PointLight();
  light.layers.enableAll();
  g.add(mesh, light);
  setLayerRecursive(g, ['yin', 'replay']);
  t.check('网格按指定图层', mesh.layers.isEnabled(LAYER.yin) && mesh.layers.isEnabled(LAYER.replay) && !mesh.layers.isEnabled(LAYER.world));
  t.check('灯不被改写（仍 enableAll）', LAYER_ALL.every(l => light.layers.isEnabled(l)));
  mesh.geometry.dispose();
  let badLights = 0;
  game.scene.traverse(o => {
    if ((o as THREE.Light).isLight && !LAYER_ALL.every(l => o.layers.isEnabled(l))) badLights++;
  });
  t.check('场景里所有灯都 enableAll', badLights === 0, badLights);
  return result(t.notes, t.fail());
});
const LAYER_ALL = Object.values(LAYER);

registerSelftest('wp1.modestack', async game => {
  const t = checker();
  const m = game.modes;
  try {
    await toSpawn(game);
    t.check('起点 [explore]', m.stack.length === 1 && m.top === 'mode.explore');
    t.check('push pause', m.push('mode.pause').ok && m.top === 'mode.pause' && m.freezesWorld());
    t.check('暂停不叠两层', !m.push('mode.pause').ok);
    t.check('pop(expect 不符) → mode_disallows', m.pop('mode.album').reason === 'mode_disallows');
    t.check('dispatch back → 继续', game.dispatch({ t: 'back' }).ok && m.top === 'mode.explore');
    t.check('push album{pick}', m.push('mode.album', { tab: 'items' }).ok && m.arg<{ tab: string }>('mode.album')?.tab === 'items' && m.isTransient());
    m.popToBase();
    t.check('popToBase 弹掉相册', m.top === 'mode.explore');
    t.check('explore 的 back → 暂停', game.dispatch({ t: 'back' }).ok && m.top === 'mode.pause');
    m.resetTo('mode.explore');
    t.check('resetTo → [explore]', m.stack.length === 1);
    t.check('explore 下 shutter 不合法', game.dispatch({ t: 'shutter' }).reason === 'mode_disallows');
  } finally {
    m.resetTo('mode.explore');
  }
  return result(t.notes, t.fail());
});

registerSelftest('wp1.freeze', async game => {
  const t = checker();
  const ctx = ctxOf(game);
  await toSpawn(game);
  let fired = 0;
  ctx.after(0.2, () => fired++);
  game.modes.push('mode.pause');
  const t0 = game.time;
  await game.advance(1);
  t.check('暂停时 advance 不推进 game.time', game.time === t0, game.time - t0);
  t.check('暂停时区域计时不走', fired === 0);
  game.modes.pop('mode.pause');
  await game.advance(0.3);
  t.check('继续后计时照走', fired === 1 && game.time > t0);
  game.modes.push('mode.album', {});
  const t1 = game.time;
  await game.advance(0.5);
  t.check('相册打开时同样冻结', game.time === t1);
  game.modes.resetTo('mode.explore');
  return result(t.notes, t.fail());
});

registerSelftest('wp1.lockstep', async game => {
  const t = checker();
  if (!game.lockstep) {
    t.notes.push('（不是 ?test=1&lockstep=1，跳过）');
    return result(t.notes, 0);
  }
  const t0 = game.time;
  for (let i = 0; i < 3; i++) await game.nextFrame();
  t.check('两次 API 之间（3 个真实帧）游戏时间不变', game.time === t0, game.time - t0);
  await game.advance(0.5);
  t.check('advance(0.5) 精确推进', Math.abs(game.time - t0 - 0.5) < 1e-9, game.time - t0);
  return result(t.notes, t.fail());
});

registerSelftest('wp1.timers', async game => {
  const t = checker();
  const ctx = ctxOf(game);
  const log: string[] = [];
  ctx.after(0.5, () => log.push('after'));
  const n0 = log.length;
  await game.advance(0.4);
  t.check('after(0.5) 在 0.4s 时未触发', log.length === n0);
  await game.advance(0.2);
  t.check('after(0.5) 在 0.6s 时触发一次', log.filter(x => x === 'after').length === 1);
  return result(t.notes, t.fail());
});

registerSelftest('wp1.temp', game => {
  const t = checker();
  const ctx = ctxOf(game);
  const seen: string[] = [];
  const off = game.events.on('temp', e => seen.push(`${e.area}:${e.key}=${String(e.value)}`));
  ctx.setTemp('wp1_probe', 3);
  ctx.setTemp('wp1_probe', 3);
  off();
  t.check('setTemp 发一次 temp 事件（值不变不重复发）', seen.length === 1 && seen[0] === 'dev:wp1_probe=3', seen);
  t.check('getTemp / tempSnapshot', ctx.getTemp('wp1_probe') === 3 && ctx.tempSnapshot().wp1_probe === 3);
  t.check('StateView.temp 读得到', game.state.temp('wp1_probe') === 3);
  t.check('未设置的键为 false', ctx.getTemp('wp1_never') === false);
  let threw = false;
  try {
    ctx.setTemp('bad.key', true);
  } catch {
    threw = true;
  }
  t.check('带点的键在 dev 下抛错', threw);
  ctx.setTemp('wp1_probe', false);
  return result(t.notes, t.fail());
});

registerSelftest('wp1.frame_rect', game => {
  const t = checker();
  const cams = game.cameras;
  try {
    for (const [W, H, zoom] of [[600, 800, 1], [600, 800, 4], [1280, 720, 2]] as const) {
      cams.setViewport(W, H);
      cams.setZoom(zoom);
      cams.sync();
      const fr = cams.frameRect();
      const expW = W / H >= 4 / 3 ? H * 4 / 3 : W;
      t.check(`${W}×${H}：画框是居中的最大 4:3`, Math.abs(fr.w - expW) < 1e-6 && Math.abs(fr.w / fr.h - 4 / 3) < 1e-9 && Math.abs(fr.x - (W - fr.w) / 2) < 1e-6);
      let worst = 0;
      const eye = cams.fp.getWorldPosition(new THREE.Vector3());
      const q = cams.fp.getWorldQuaternion(new THREE.Quaternion());
      cams.photo.position.copy(eye);
      cams.photo.quaternion.copy(q);
      cams.photo.updateMatrixWorld();
      for (const p of [[0.6, -0.3, -3], [-1, 0.7, -5], [0.05, 0.05, -12]] as const) {
        const v = new THREE.Vector3(...p).applyQuaternion(q).add(eye);
        const a = v.clone().project(cams.photo);
        const b = v.clone().project(cams.fp);
        const sx = ((b.x + 1) / 2) * W;
        const sy = ((1 - b.y) / 2) * H;
        worst = Math.max(worst, Math.abs(((sx - fr.x) / fr.w) * 2 - 1 - a.x), Math.abs(1 - ((sy - fr.y) / fr.h) * 2 - a.y));
      }
      t.check(`${W}×${H} ${zoom}×：画框内所见与 photo 相机一致`, worst < 1e-5, worst);
    }
  } finally {
    cams.setZoom(game.sys.viewfinder.zoom);
    game.pipeline.resize();
  }
  return result(t.notes, t.fail());
});

registerSelftest('wp1.lights_frozen', async game => {
  const t = checker();
  const ctx = ctxOf(game);
  let threw = false;
  const l = new THREE.PointLight();
  try {
    ctx.light(l);
  } catch {
    threw = true;
  }
  t.check('进区域后再加灯在 dev 下抛错', threw);
  if (!threw) ctx.root.remove(l);
  t.check('本区实时灯 ≤ 8', ctx.lightCount <= 8, ctx.lightCount);
  await toSpawn(game);
  const before = game.pipeline.stats().lights;
  game.dispatch({ t: 'vf' });
  await game.advance(0.1);
  const during = game.pipeline.stats().lights;
  game.modes.resetTo('mode.explore');
  await game.advance(0.1);
  t.check('开关取景器前后压入渲染的灯数不变', before === during && during === game.pipeline.stats().lights, [before, during]);
  return result(t.notes, t.fail());
});

registerSelftest('wp1.spawn_clearance', game => {
  const t = checker();
  const cur = game.areas.current!;
  const live = game.triggers.assertSpawnClearance(cur.def.spawns);
  t.check('dev 沙盒出生点离全部触发体 ≥ 0.8m', live.length === 0, live);
  for (const d of game.areas.defs.values()) {
    const issues = spawnClearanceIssues(d.spawns, d.exits.filter(e => e.box).map(e => ({ key: e.id, box: e.box! })));
    t.check(`${d.id}：出生点离出入口触发体 ≥ 0.8m`, issues.length === 0, issues);
  }
  const bad = game.triggers.assertSpawnClearance({ 'spawn.dev_start': { pos: [0, 0, -13.2], yaw: 0 } });
  t.check('人为放近的出生点被列出', bad.length > 0);
  return result(t.notes, t.fail());
});

registerSelftest('wp1.route', game => {
  const t = checker();
  const ok = game.areas.route('dev', 'r1');
  t.check('dev → r1 直达', ok.ok && ok.hops.join(',') === 'exit.dev_to_r1', ok);
  const r3 = game.areas.route('dev', 'r3');
  const gateOpen = game.state.flag('r1.gate_unchained');
  if (!gateOpen) t.check('院门未开：dev → r3 返回第一个被挡出口 exit.r1_to_r3', !r3.ok && r3.exit === 'exit.r1_to_r3', r3);
  else t.notes.push('（r1.gate_unchained 已为真，跳过被挡断言）');
  t.check('同区域 hops 为空', game.areas.route('dev', 'dev').ok);
  return result(t.notes, t.fail());
});

registerSelftest('wp1.dyn_collider', async game => {
  const t = checker();
  const ctx = ctxOf(game);
  try {
    ctx.setTemp(PEN_TEMP, false);
    await toSpawn(game);
    await game.areas.teleport(WP1_POS.outside, { yaw: 0 });
    const g1 = await game.areas.goto('dev', WP1_POS.inside[0], WP1_POS.inside[2]);
    t.check('门关着：goto 进围栏 → unreachable', !g1.ok && g1.reason === 'unreachable', g1);
    let r = await game.player.walkTo(WP1_POS.inside[0], WP1_POS.inside[2]);
    t.check('门关着：walkTo 被挡（1 秒无进展）', !r.ok && r.pos[2] > WP1_POS.door[2], r);
    ctx.setTemp(PEN_TEMP, true);
    r = await game.player.walkTo(WP1_POS.inside[0], WP1_POS.inside[2]);
    t.check('门开后 walkTo 走进去', r.ok, r);
    ctx.setTemp(PEN_TEMP, false);
    await game.areas.teleport(WP1_POS.outside);
    const hit = game.collision.raycast(new THREE.Vector3(WP1_POS.outside[0], 1.2, WP1_POS.outside[2]), new THREE.Vector3(0, 0, -1), 10);
    t.check('门关着时 raycast 命中门并返回 key', hit?.key === PEN_DOOR, hit);
    const through = game.collision.raycast(new THREE.Vector3(WP1_POS.outside[0], 1.2, WP1_POS.outside[2]), new THREE.Vector3(0, 0, -1), 10, { ignoreKeys: [PEN_DOOR] });
    t.check('ignoreKeys 跳过门本身', through?.key !== PEN_DOOR);
  } finally {
    ctx.setTemp(PEN_TEMP, false);
    await toSpawn(game);
  }
  return result(t.notes, t.fail());
});

registerSelftest('wp1.reachable', async game => {
  const t = checker();
  const ctx = ctxOf(game);
  try {
    ctx.setTemp(PEN_TEMP, false);
    const c = game.collision;
    t.check('墙两侧不连通（门关着）', !c.reachable(WP1_POS.westOut, WP1_POS.westIn));
    t.check('门外同侧连通', c.reachable(WP1_POS.outside, WP1_POS.open));
    ctx.setTemp(PEN_TEMP, true);
    t.check('门开后墙两侧经门洞连通', c.reachable(WP1_POS.westOut, WP1_POS.westIn));
  } finally {
    ctx.setTemp(PEN_TEMP, false);
  }
  return result(t.notes, t.fail());
});

registerSelftest('wp1.camera_pull_in', async game => {
  const t = checker();
  const ctx = ctxOf(game);
  try {
    ctx.setTemp(PEN_TEMP, true);
    game.modes.resetTo('mode.explore');
    await game.areas.teleport(WP1_POS.nearNorthWall, { yaw: 180 });
    game.player.pitch = -6;
    game.cameras.sync();
    await game.advance(0.1);
    t.check('身后贴墙：第三人称吊臂拉近到 0.9–1.2m', game.cameras.boomLength >= 0.9 - 1e-6 && game.cameras.boomLength < 1.2, game.cameras.boomLength);
    await game.areas.teleport(WP1_POS.open, { yaw: 0 });
    await game.advance(1);
    t.check('空地上恢复满长（≈2.67m）', game.cameras.boomLength > 2.6, game.cameras.boomLength);
  } finally {
    ctx.setTemp(PEN_TEMP, false);
    await toSpawn(game);
  }
  return result(t.notes, t.fail());
});
