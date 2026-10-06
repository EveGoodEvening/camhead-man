// owner: WP7
// WP7 在开发沙盒里的测试夹具（ARCH §15.2 “沙盒要包含的夹具”）与页面内自测（registerSelftest('wp7.<snake>', fn)）；
// scripts/selftest/wp7.mjs 经 __game.selftest(name)（?debug=1&area=dev）调用。
//
// 夹具在沙盒东侧（x≈11–14、z≈1–7），避开别的 WP 与底座（dev/base.ts 的布局说明）：
//   - 地标牌 → 交互物 r1.estate_sign（“沙盒说明”，按 E 出一句反馈）；
//   - 一堵矮墙挡着的告示牌 r1.notice_board：从墙南侧（WP7_POS.southStand）在射程内、身体朝着它，邻近聚焦也会选中它，
//     但视线被墙挡住——真人路径检查必须判 not_focusable；从北侧（northStand）能交互；
//   - 只在取景器里可交互的 r1.gate_lamp（view:'viewfinder'，带 wrongView）：肉眼下检查得 wrong_view 与反馈文本；
//   - r1.cctv_notice 的 AreaDef.automation.aim 覆盖：瞄准点解析必须先用 automation（ARCH §12.3 的顺序）；
//   - 自带动态碰撞体的“门” r1.gate（碰撞体 key 同交互物 id，锚点埋在碰撞体里 0.3m）：视线检查必须 ignoreKeys 跳过它自己，
//     interact 不被自己的碰撞体挡住，walk() 照样被挡（ARCH §4.8、§12.4 回归例）。
// 这些 id 借用 GDD 的真 id（类型要求，沙盒不许自造 id）；只在 dev 区域里这样用，别的 WP 的夹具都没用到它们。
// 页面内自测直接调用 debug/* 的内部函数，不经调试 API（selftest 本身就在 API 的串行队列里，再调 API 会自锁）；
// API 表面（全部方法与别名是否挂上）由 scripts/selftest/wp7.mjs 在页面外检查。

import * as THREE from 'three';
import type { AreaContext, AreaPart } from '../../core/area';
import type { V3, XZ } from '../../core/types';
import type { Game } from '../../core/game';
import { DEV_EXIT, DEV_SPAWN, OBJ, RP, SPAWN } from '../../data/ids';
import { E } from '../../game/effects';
import type { SelftestResult } from '../../debug/selftest';
import { registerSelftest } from '../../debug/selftest';
import { checkInteractFidelity, lintAreaDefs, lintGame, resolveAimPoint, turnTowards } from '../../debug/fidelity';
import { jsonSafe } from '../../debug/api';
import { DEV_FLOOR2_Y, DEV_HALF, DEV_LANDMARK_AT, DEV_LANDMARK_REF } from './base';

// ==================================================================== 坐标与夹具 id

/** 夹具基准点（M1c 若与别的 WP 的夹具重叠，只改这里）。 */
export const WP7_ORIGIN: V3 = [12.5, 0, 4];
const at = (dx: number, y: number, dz: number): V3 => [WP7_ORIGIN[0] + dx, y, WP7_ORIGIN[2] + dz];
const xz = (dx: number, dz: number): XZ => [WP7_ORIGIN[0] + dx, WP7_ORIGIN[2] + dz];

/** 夹具 id（scripts/core.mjs 与 M1c 用）。 */
export const WP7_FIX = {
  landmark: OBJ.R1_ESTATE_SIGN,
  walled: OBJ.R1_NOTICE_BOARD,
  yin: OBJ.R1_GATE_LAMP,
  automated: OBJ.R1_CCTV_NOTICE,
  gate: OBJ.R1_GATE,
} as const;

/** 夹具位置（世界坐标）。 */
export const WP7_POS = {
  /** 挡视线的矮墙（沿 x，z = WP7_ORIGIN.z + 0.6，长 2.4m、高 2.4m） */
  wallZ: WP7_ORIGIN[2] + 0.6,
  /** 告示牌锚点（墙北侧 1m） */
  walled: at(0, 1.2, -0.4),
  /** 墙南侧站位：到锚点 2.6m（射程内）但视线穿墙 */
  southStand: xz(0, 2.2),
  /** 墙北侧站位：视线通畅 */
  northStand: xz(0, -2.0),
  /** 只在取景器里可交互的灯（墙北侧东边） */
  yin: at(1.2, 1.6, -2.6),
  /** 自动化瞄准点覆盖：定义锚点与 automation.aim 故意不同 */
  automatedAt: at(-1.2, 1.4, -2.6),
  automatedAim: at(-1.2, 1.9, -2.6),
  /** 自带动态碰撞体的门：碰撞盒中心（东墙内侧）与站位 */
  gate: [14.1, 1.1, 8.2] as V3,
  gateSize: [0.6, 2.2, 1.6] as V3,
  gateStand: [12.5, 8.2] as XZ,
} as const;

const WALL_LEN = 2.4;
const WALL_H = 2.4;

/** 自测用的反馈文本（断言用）。 */
export const WP7_TEXT = {
  landmark: '（沙盒）引擎沙盒：30m×30m，出生点在南边，北墙门框通往槐安里。',
  walled: '（沙盒）告示牌背面什么也没写。',
  yinWrong: '（沙盒）这盏灯只有你的眼睛看得见。',
  yinOk: '（沙盒）灯芯里有一点冷光。',
  automated: '（沙盒）自动化瞄准点覆盖。',
  gate: '（沙盒）门闩插得死死的。',
} as const;

function box(size: V3, pos: V3, color: THREE.ColorRepresentation): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  m.position.set(pos[0], pos[1], pos[2]);
  return m;
}

function buildFixtures(ctx: AreaContext): void {
  // 地标牌（底座已建网格，这里只登记交互物）
  ctx.interactable({
    id: WP7_FIX.landmark, label: '沙盒说明', at: [DEV_LANDMARK_AT[0], 1.65, DEV_LANDMARK_AT[2]], range: 3,
    onInteract: [E.feedback(WP7_TEXT.landmark)],
  });
  // 挡视线的矮墙 + 墙后的告示牌
  const [wx, , wz] = [WP7_ORIGIN[0], 0, WP7_POS.wallZ];
  ctx.add(box([WALL_LEN, WALL_H, 0.2], [wx, WALL_H / 2, wz], '#4a5262'));
  ctx.collider.box([wx, WALL_H / 2, wz], [WALL_LEN, WALL_H, 0.2]);
  ctx.add(box([0.9, 0.6, 0.05], WP7_POS.walled, '#b8b0a0'));
  ctx.add(box([0.06, 1.2, 0.06], [WP7_POS.walled[0], 0.6, WP7_POS.walled[2] + 0.04], '#23272f'));
  ctx.interactable({ id: WP7_FIX.walled, label: '告示牌', at: WP7_POS.walled, onInteract: [E.feedback(WP7_TEXT.walled)] });
  // 只在取景器里可交互的灯（阴物式：yin 层网格，肉眼不可见也不可聚焦）
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshStandardMaterial({ color: '#8FD3D6', emissive: '#8FD3D6', emissiveIntensity: 0.6 }));
  lamp.position.set(...WP7_POS.yin);
  ctx.add(lamp, { layer: 'yin', tempC: 6 });
  ctx.interactable({
    id: WP7_FIX.yin, label: '冷灯', at: WP7_POS.yin, view: 'viewfinder', wrongView: WP7_TEXT.yinWrong,
    onInteract: [E.feedback(WP7_TEXT.yinOk)],
  });
  // automation 覆盖瞄准点的对象
  ctx.add(box([0.5, 0.4, 0.05], WP7_POS.automatedAt, '#6a7282'));
  ctx.interactable({ id: WP7_FIX.automated, label: '注意事项', at: WP7_POS.automatedAt, onInteract: [E.feedback(WP7_TEXT.automated)] });
  // 自带动态碰撞体的门：key 用它所挡的交互物 id（ARCH §4.8），恒为关着
  ctx.add(box(WP7_POS.gateSize, WP7_POS.gate, '#6a4a32'));
  ctx.collider.dynamic(WP7_FIX.gate, { box: { center: WP7_POS.gate, size: WP7_POS.gateSize } }, 'true');
  ctx.interactable({ id: WP7_FIX.gate, label: '木门', at: WP7_POS.gate, onInteract: [E.feedback(WP7_TEXT.gate)] });
}

/**
 * 沙盒截图机位：验证 __game.shot() 与 scripts/shots.mjs 的整条链路（自由机位 / 第三人称 / 取景器 HUD）。
 * 沙盒没有灯光设计，亮度区间放宽；look-dev 的 shot.dev.lookdev_* 由 M1c 另加（ARCH §15.3）。
 */
export const WP7_SHOTS: NonNullable<AreaPart['shots']> = [
  {
    id: 'shot.dev.wp7_free', label: '沙盒底座：自由机位看出生点、地标牌与北墙出口',
    view: { cam: { pos: [-3, 3.2, 12.5], target: [1.3, 1.2, 4] } }, keys: [WP7_FIX.landmark], brightness: [0.02, 0.6],
  },
  {
    id: 'shot.dev.wp7_tp', label: '沙盒底座：第三人称站在出生点、面朝地标牌',
    view: { player: [0, 8], yaw: 20, mode: 'tp' }, keys: [WP7_FIX.landmark], brightness: [0.02, 0.6],
  },
  {
    id: 'shot.dev.wp7_vf', label: '沙盒底座：取景器 1× 从出生点身后对着地标牌（带 HUD）',
    view: { player: [-1.5, 10.5], yaw: 35, pitch: -2, mode: 'vf', zoom: 1 }, ui: true, keys: [WP7_FIX.landmark], brightness: [0.02, 0.6],
  },
];

const wp7: AreaPart = {
  automation: { [WP7_FIX.automated]: { aim: WP7_POS.automatedAim } },
  shots: WP7_SHOTS,
  build(ctx) {
    buildFixtures(ctx);
  },
};

export default wp7;

// ==================================================================== 页面内自测（M1c 起必须通过；依赖 WP1/WP4/WP5 的真实实现）

class Check {
  readonly notes: string[] = [];
  private failures = 0;
  that(cond: unknown, msg: string, detail?: unknown): void {
    if (!cond) this.failures++;
    const d = cond || detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
    this.notes.push(`${cond ? 'ok  ' : 'FAIL'} ${msg}${d}`);
  }
  near(a: number, b: number, eps: number, msg: string): void {
    this.that(Math.abs(a - b) <= eps, msg, `${a} vs ${b}`);
  }
  done(): SelftestResult {
    return { ok: this.failures === 0, notes: this.notes };
  }
}

function inDev(game: Game): NonNullable<Game['areas']['current']> {
  const cur = game.areas.current;
  if (!cur || cur.def.id !== 'dev') throw new Error('wp7 自测需要在 ?debug=1&area=dev 沙盒里运行');
  return cur;
}

async function standAt(game: Game, p: XZ, yaw = 0): Promise<void> {
  game.modes.resetTo('mode.explore');
  const lh = game.areas.current?.ctx.levelsHandle;
  if (lh && lh.current !== 1) await game.areas.goto('dev', p[0], p[1], 1);
  await game.areas.teleport([p[0], 0, p[1]], { yaw });
  game.cameras.sync();
}

registerSelftest('wp7.json_safe', () => {
  const t = new Check();
  const out = jsonSafe({ v: new THREE.Vector3(1, 2, 3), nan: Number.NaN, inf: Infinity, fn: () => 1, nested: [{ a: 1 }] });
  t.that(JSON.stringify(out) === '{"v":[1,2,3],"nan":null,"inf":null,"nested":[{"a":1}]}', 'Vector3 → 数组、非有限数 → null、函数丢弃', out);
  t.that(jsonSafe(undefined) === undefined, 'undefined 原样返回');
  return t.done();
});

registerSelftest('wp7.base_layout', async game => {
  const t = new Check();
  const cur = inDev(game);
  const def = cur.def;
  t.that(def.exits.some(e => e.id === DEV_EXIT.TO_R1), '有通往 r1 的出入口');
  t.that(DEV_SPAWN.START in def.spawns && DEV_SPAWN.LOOKDEV in def.spawns, '两个出生点');
  const issues = game.triggers.assertSpawnClearance(def.spawns);
  t.that(issues.length === 0, '出生点离触发体 ≥ 0.8m', issues);
  const lh = cur.ctx.levelsHandle;
  t.that(lh !== null, '有楼层句柄（两个楼层节点）');
  t.that(cur.ctx.getRef(DEV_LANDMARK_REF) !== undefined, '地标牌已登记 ref');
  t.that(cur.ctx.lightCount <= 8, `灯数 ≤ 8（${cur.ctx.lightCount}）`);
  // 地面与外墙的碰撞
  const down = game.collision.raycast(new THREE.Vector3(0, 3, 8), new THREE.Vector3(0, -1, 0), 10);
  t.that(down !== null && Math.abs(down.point.y) < 0.12, '出生点下方有地面', down?.point.y);
  const north = game.collision.raycast(new THREE.Vector3(5, 1.5, 0), new THREE.Vector3(0, 0, -1), 40);
  t.that(north !== null && north.distance > 14.3 && north.distance < 15.2, '北面有外墙（约 15m）', north?.distance);
  // z = -2：东南角（z ≥ 3.5）是 M1c 的 look-dev 布景（dev/lookdev.ts 的院墙、门岗），z = 12 的射线会先打到它们
  const east = game.collision.raycast(new THREE.Vector3(0, 1.5, -2), new THREE.Vector3(1, 0, 0), 40);
  t.that(east !== null && east.distance > DEV_HALF - 0.4 && east.distance < DEV_HALF + 0.2, '东面有外墙（约 15m）', east?.distance);
  // 二层：goto 到楼梯口落点
  if (lh) {
    const r = await game.areas.goto('dev', 0, 1.8, 2);
    t.that(r.ok, 'goto(dev, 0, 1.8, 2) 成功', r);
    t.that(lh.current === 2, '当前楼层 = 2', lh.current);
    t.near(game.player.position.y, DEV_FLOOR2_Y, 0.2, '站在二层平台上（y≈6）');
    const r1 = await game.areas.goto('dev', 0, 8, 1);
    t.that(r1.ok && lh.current === 1, '回到一层', { r1, floor: lh.current });
  }
  await standAt(game, [0, 8]);
  return t.done();
});

registerSelftest('wp7.aim_resolution', async game => {
  const t = new Check();
  inDev(game);
  await standAt(game, [WP7_ORIGIN[0], WP7_ORIGIN[2] - 2]);
  const a = resolveAimPoint(game, WP7_FIX.automated);
  t.that(a !== null && a.distanceTo(new THREE.Vector3(...WP7_POS.automatedAim)) < 1e-6, 'automation.aim 优先于交互物锚点', a?.toArray());
  const b = resolveAimPoint(game, WP7_FIX.walled);
  t.that(b !== null && b.distanceTo(new THREE.Vector3(...WP7_POS.walled)) < 1e-6, '交互物锚点', b?.toArray());
  const c = resolveAimPoint(game, DEV_LANDMARK_REF);
  t.that(c !== null && c.y > 0.5 && c.y < 2.5, '退回 ref 的包围盒中心', c?.toArray());
  t.that(resolveAimPoint(game, 'nothing') === null && resolveAimPoint(game, 'decoy.dev.none') === null, '未知 id → null');
  const rp = game.sys.replay.point(RP.R4_STALL);
  if (rp) {
    const p = resolveAimPoint(game, RP.R4_STALL);
    t.that(p !== null && Math.abs(p.y - (rp.at[1] + 0.8)) < 1e-6, '残影点瞄准 at + 0.8m（WP5 夹具）', p?.toArray());
  } else {
    t.notes.push('skip 残影点（WP5 夹具不在）');
  }
  return t.done();
});

registerSelftest('wp7.fidelity', async game => {
  const t = new Check();
  inDev(game);
  const target = new THREE.Vector3(...WP7_POS.walled);
  // 墙南侧：射程内、朝着它（邻近聚焦会选中它），但视线穿墙 → not_focusable
  await standAt(game, WP7_POS.southStand, 0);
  turnTowards(game, target);
  const south = checkInteractFidelity(game, WP7_FIX.walled, target);
  t.that(!south.ok && south.reason === 'not_focusable', '隔墙：not_focusable', south);
  // 墙北侧：通畅
  await standAt(game, WP7_POS.northStand, 180);
  turnTowards(game, target);
  const north = checkInteractFidelity(game, WP7_FIX.walled, target);
  t.that(north.ok, '墙这边：通过', north);
  // 只在取景器里可交互：肉眼 → wrong_view + 反馈
  const lamp = new THREE.Vector3(...WP7_POS.yin);
  await standAt(game, [WP7_POS.yin[0], WP7_POS.yin[2] + 1.6], 0);
  turnTowards(game, lamp);
  const naked = checkInteractFidelity(game, WP7_FIX.yin, lamp);
  t.that(!naked.ok && naked.reason === 'wrong_view' && naked.result?.feedback === WP7_TEXT.yinWrong, '肉眼：wrong_view 带 wrongView 文本', naked);
  // 自带动态碰撞体的门：锚点埋在自己的碰撞体里，视线检查跳过自身（ignoreKeys）→ 通过
  const gate = new THREE.Vector3(...WP7_POS.gate);
  await standAt(game, WP7_POS.gateStand, 90);
  turnTowards(game, gate);
  const own = checkInteractFidelity(game, WP7_FIX.gate, gate);
  t.that(own.ok, '自己的动态碰撞体不挡自己的视线检查', own);
  const eye = game.player.eye.clone();
  const raw = game.collision.raycast(eye, gate.clone().sub(eye).normalize(), eye.distanceTo(gate) - 0.15);
  t.that(raw !== null && raw.key === WP7_FIX.gate, '（对照）不跳过时射线打在门自己的碰撞体上', raw);
  // 只在取景器里可交互：回到灯前
  await standAt(game, [WP7_POS.yin[0], WP7_POS.yin[2] + 1.6], 0);
  turnTowards(game, lamp);
  const v = game.dispatch({ t: 'vf' });
  t.that(v.ok && game.sys.viewfinder.on, '进入取景器', v);
  turnTowards(game, lamp);
  const vf = checkInteractFidelity(game, WP7_FIX.yin, lamp);
  t.that(vf.ok, '取景器中：通过', vf);
  await standAt(game, [0, 8]);
  return t.done();
});

registerSelftest('wp7.lint', async game => {
  const t = new Check();
  const cur = inDev(game);
  const base = lintGame(game);
  const mine = base.filter(s => Object.values(WP7_FIX).some(id => s.includes(id)));
  t.that(mine.length === 0, 'WP7 夹具没有 lint 问题', mine);
  for (const s of base) t.notes.push(`note lint: ${s}`);
  // 静态部分：“有 when 却没有 blocked”在 dev 下登记时就会抛错（ctx.interactable 的断言），运行期造不出来——拿合成的 AreaDef 验证
  const synthetic = {
    ...cur.def,
    exits: [{ id: DEV_EXIT.TO_R1, to: SPAWN.R1_START, box: { center: [0, 1, -14] as V3, size: [1.5, 2.5, 1.5] as V3 }, when: 'false' }],
    interactables: [{ id: OBJ.R1_SWITCH_4, label: '开关④', at: [0, 1, 0] as V3, when: 'false', onInteract: [E.feedback('4')] }],
  };
  const st = lintAreaDefs([synthetic]);
  t.that(st.some(s => s.includes(OBJ.R1_SWITCH_4) && s.includes('blocked')), '静态：交互物有 when 却没有 blocked → 报出', st);
  t.that(st.some(s => s.includes(DEV_EXIT.TO_R1) && s.includes('blocked')), '静态：出入口有 when 却没有 blocked → 报出', st);
  // 临时登记三个同组对象（开关①②③）：② 角标文字不同、③ 灰（when 不满足）——lint 必须报出来
  const h1 = cur.ctx.interactable({ id: OBJ.R1_SWITCH_1, label: '开关①', at: [13.5, 1, 6.5], onInteract: [E.feedback('1')] });
  const h2 = cur.ctx.interactable({ id: OBJ.R1_SWITCH_2, label: '门灯', at: [13.5, 1, 6.8], onInteract: [E.feedback('2')] });
  const h3 = cur.ctx.interactable({ id: OBJ.R1_SWITCH_3, label: '开关③', at: [13.5, 1, 7.1], when: 'false', blocked: '（沙盒）还不能扳。', onInteract: [E.feedback('3')] });
  try {
    const issues = lintGame(game);
    t.that(issues.some(s => s.includes(OBJ.R1_SWITCH_2) && s.includes('不一致')), '同组角标文字不同 → 报出', issues.filter(s => s.includes('switch')));
    t.that(issues.some(s => s.includes(OBJ.R1_SWITCH_3) && s.includes('不一致')), '同组灰/白不同 → 报出', issues.filter(s => s.includes('switch')));
    t.that(!issues.some(s => s.includes(OBJ.R1_SWITCH_1) && s.includes('blocked')), '有 blocked 的不误报');
  } finally {
    h1.remove();
    h2.remove();
    h3.remove();
  }
  t.that(!lintGame(game).some(s => s.includes('switch')), '移除之后不再报');
  return t.done();
});
