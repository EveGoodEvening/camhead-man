// owner: WP7
// 引擎验收（ARCH §12.4、§15.3）：在 ?debug=1&area=dev 沙盒里逐个调用 §12.3 的全部方法（成功与失败分支各至少一次），
// 跑 §12.4 列出的回归例中能从 API 外部验证的部分，然后自动发现并运行 scripts/selftest/*.mjs（各 WP 的自测，默认导出 run(h)）。
//
// 用法：npm run build && node scripts/core.mjs [--only=wpN] [--skip-api] [--skip-selftests] [--case=<子串>] [--quality=low]
//   --only=wpN   只跑 scripts/selftest/wpN.mjs（ARCH §15.2 共同完成定义）
// 沙盒夹具的 id 与位置取自各 WP 的 src/areas/dev/wpN.ts（见下方 FIX 表的注释）；位置能从 aimAt 现取的都现取，
// 夹具缺失时对应用例报 “fixture missing”，M1c 整合时对齐。

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, parseArgs, DEV_QUERY, ROOT, dumpFailure } from './lib/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ==================================================================== 沙盒夹具（来源见注释；位置能现取就现取）

const FIX = {
  // src/areas/dev/base.ts（WP7）
  spawn: [0, 8], floor2Landing: [0, 1.8],
  // src/areas/dev/wp7.ts（WP7_FIX / WP7_POS / WP7_TEXT）
  landmark: 'r1.estate_sign', landmarkText: '（沙盒）引擎沙盒：30m×30m',
  walled: 'r1.notice_board', walledSouth: [12.5, 6.2], walledNorth: [12.5, 2.0],
  yin: 'r1.gate_lamp', yinStand: [13.7, 3.0], yinWrong: '（沙盒）这盏灯只有你的眼睛看得见。',
  automated: 'r1.cctv_notice', automatedAim: [11.3, 1.9, 1.4],
  gate: 'r1.gate', gateStand: [12.5, 8.2], gateText: '（沙盒）门闩插得死死的。',
  // src/areas/dev/wp4.ts（WP4_FIX）
  blocked: 'r4.rules_board', blockedText: '（沙盒）还没到时候。',
  treeNpc: 'npc.wang', yinNpc: 'npc.boy', forced: 'r2.stairs', codeLock: 'r1.drawer', code: '0618', codeFail: '锁纹丝不动。',
  naming: 'r3.stool', namingWrong: '看门的多了，门神也看门。', glassNpc: 'npc.lu', glassHandle: 'r3.darkroom_door',
  wonton: '（沙盒）她接过了馄饨。', wontonFallback: '（沙盒）她摇摇头。',
  // src/areas/dev/wp5.ts（WP5_POS，WP5_ORIGIN = [-9, 0, 0]）
  shotStand: [-9, 6], shotTarget: 'pt.tudi',
  replayStand: [-9, -4.5], rp: 'rp.r4_stall', seg1: 'seg.stall_2023', seg2: 'seg.mid_1997', rpUpper: 'rp.r4_mid',
  labelStand: [-13, 5.5], label: 'rd.switch_labels',
  mirrorFront: [-13, -2.1], mirrorSide: [-12.4, -2.1], sticker: 'rd.sticker_mirror',
  vcr: 'r1.vcr', crt: 'r1.crt', bracket: 'r1.bracket', tripodZone: [-5, 9.5],
  // src/areas/dev/wp1.ts（WP1_POS，WP1_ORIGIN = [10, 0, -9]）
  penInside: [10, -9], penOutside: [10, -5],
};

// ==================================================================== 用例框架

const results = [];

class Skip extends Error {}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function reason(r, want, what) {
  assert(r && r.ok === false && r.reason === want, `${what}：期望 { ok:false, reason:'${want}' }，实际 ${JSON.stringify(r).slice(0, 300)}`);
}
function okr(r, what) {
  assert(r && r.ok === true, `${what}：期望 ok，实际 ${JSON.stringify(r).slice(0, 300)}`);
  return r.result;
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

/** 回到沙盒出生点、干净的模式栈（每个用例开始时调用）。 */
async function home(h, flags) {
  const r = await h.call.try('setState', { area: 'dev', spawn: 'spawn.dev_start', ...(flags ? { flags } : {}) });
  if (!r.ok) {
    // 对话/过场里 setState 会 busy：先把它们推完
    await h.call.try('dlg');
    await h.call('setState', { area: 'dev', spawn: 'spawn.dev_start', ...(flags ? { flags } : {}) });
  }
}

/**
 * 干净的进度 + 回到沙盒：setState 只加不减（flags/物品/照片），所以先 newGame() 清空、dlg() 跑完开场，再进 dev。
 * 各 WP 的页面内自测按“新游戏状态”写断言（例如挑选器里的格子列表），每个 selftest 模块之前都调用它。
 */
async function fresh(h) {
  await h.call.try('dlg');
  await h.call('newGame');
  await h.call('dlg');
  await h.call('setState', { area: 'dev', spawn: 'spawn.dev_start' });
}

/**
 * 站到某个交互物/瞄准点旁边：先 aimAt 取锚点，再试几个方向上 dist 外的站位（同区域 goto 做连通性检查）。
 * 给了 method 时，在每个站位上调用 method(id, ...args)（interact/show/use，它们自己转身并做真人路径检查），
 * 得到的不是 not_focusable 就返回这次的结果——沙盒里夹具挤在一起，高优先级的 NPC 可能抢聚焦，换个方向站。
 */
async function approach(h, id, dist = 1.6, method = null, ...args) {
  const a = await h.call.try('aimAt', id);
  if (!a.ok) throw new Skip(`fixture missing: ${id}（aimAt → ${a.reason}）`);
  const [x, , z] = a.result.point;
  const d = dist;
  const tried = [];
  for (const [dx, dz] of [[0, d], [0, -d], [d, 0], [-d, 0], [d * 0.7, d * 0.7], [-d * 0.7, d * 0.7], [d * 0.7, -d * 0.7], [-d * 0.7, -d * 0.7]]) {
    const r = await h.call.try('goto', 'dev', x + dx, z + dz);
    if (!r.ok) continue;
    if (!method) return a.result.point;
    const res = await h.call.try(method, id, ...args);
    h.last = res;
    if (res.ok || res.reason !== 'not_focusable') return res;
    tried.push(`${(x + dx).toFixed(1)},${(z + dz).toFixed(1)}→${JSON.stringify(res.result ?? null)}`);
  }
  throw new Error(`没有能对 ${id} ${method ?? '站过去'} 的站位（${tried.join('; ') || '都不连通'}）`);
}

const CASES = [];
const test = (name, fn) => CASES.push({ name, fn });

// ==================================================================== §12.3 方法：成功与失败

test('state / getState：快照字段齐全、可 JSON 序列化', async h => {
  const s = okr(await h.call.try('state'), 'state');
  for (const k of ['area', 'floor', 'pos', 'yaw', 'pitch', 'mode', 'stack', 'shichen', 'clock', 'flags', 'items', 'photos', 'names', 'clues', 'ants',
    'vf', 'lens', 'zoom', 'focused', 'reading', 'readHint', 'replay', 'vcr', 'console', 'dialogue', 'cutscene', 'panel', 'album', 'tripod',
    'subtitle', 'lastFeedback', 'temp', 'saves', 'ending', 'settle', 'loading']) assert(k in s, `state() 缺字段 ${k}`);
  assert(s.area === 'dev' && s.mode === 'mode.explore' && s.floor === 1, `沙盒起点：${JSON.stringify({ area: s.area, mode: s.mode, floor: s.floor })}`);
  const alias = okr(await h.call.try('getState'), 'getState');
  assert(JSON.stringify(alias.pos) === JSON.stringify(s.pos), 'getState 与 state 同一个快照');
});

test('全部方法与别名都挂在 window.__game / window.__cam 上', async h => {
  const names = ['state', 'getState', 'newGame', 'continueGame', 'reload', 'goto', 'teleport', 'walk', 'listInteractables', 'focused', 'interact',
    'show', 'showItem', 'use', 'useItem', 'readDoc', 'vf', 'setViewfinder', 'lens', 'setLensMode', 'zoom', 'aimAt', 'shoot', 'takePhoto', 'replay',
    'replaySeek', 'replayPause', 'replayPlay', 'replayExit', 'dlg', 'advanceDialogue', 'choose', 'chooseDialogOption', 'input', 'enterCode', 'vcr',
    'console', 'tripod', 'bodyGoto', 'back', 'hint', 'wait', 'setTimeScale', 'frame', 'lint', 'perf', 'shot', 'setFlags', 'giveItem', 'givePhoto',
    'setState', 'selftest', 'selftests'];
  const res = await h.page.evaluate(n => ({
    same: window.__cam === window.__game,
    missing: n.filter(m => typeof window.__game[m] !== 'function'),
    aliases: [['getState', 'state'], ['teleport', 'goto'], ['showItem', 'show'], ['useItem', 'use'], ['setViewfinder', 'vf'], ['setLensMode', 'lens'],
      ['takePhoto', 'shoot'], ['advanceDialogue', 'dlg'], ['chooseDialogOption', 'choose'], ['enterCode', 'input']]
      .filter(([a, b]) => window.__game[a] !== window.__game[b]),
  }), names);
  assert(res.same, 'window.__cam !== window.__game');
  assert(res.missing.length === 0, `缺方法：${res.missing.join(', ')}`);
  assert(res.aliases.length === 0, `别名不是同一个函数：${JSON.stringify(res.aliases)}`);
});

test('goto：同区域成功 / bad_args / 不连通 unreachable / 跨区域 blocked / 楼层', async h => {
  const r = okr(await h.call.try('goto', 'dev', 2, 6), 'goto(dev, 2, 6)');
  assert(near(r.pos[0], 2, 0.2) && near(r.pos[2], 6, 0.2) && r.area === 'dev', `落点：${JSON.stringify(r)}`);
  okr(await h.call.try('teleport', 'dev', 0, 8), 'teleport 别名');
  reason(await h.call.try('goto', 'dev', 'x', 8), 'bad_args', 'goto 坐标不是数');
  reason(await h.call.try('goto', 'nowhere', 0, 0), 'bad_args', 'goto 未知区域');
  // WP1 的围栏：门关着时里面与外面不连通
  reason(await h.call.try('goto', 'dev', ...FIX.penInside), 'unreachable', 'goto 进关着门的围栏');
  // 跨区域：dev → r1 → r3，东口要 r1.gate_unchained
  const b = await h.call.try('goto', 'r3', 0, 1.5);
  reason(b, 'blocked', 'goto r3（院门没开）');
  assert(b.result && b.result.exit === 'exit.r1_to_r3' && typeof b.result.feedback === 'string', `blocked 应带第一个被挡的出口与反馈：${JSON.stringify(b.result)}`);
  await home(h);
  // 楼层节点：二层落点
  const f2 = okr(await h.call.try('goto', 'dev', ...FIX.floor2Landing, 2), 'goto 二层');
  assert(f2.pos[1] > 5.5, `二层 y≈6：${JSON.stringify(f2.pos)}`);
  assert((await h.state()).floor === 2, 'state().floor === 2');
  okr(await h.call.try('goto', 'dev', ...FIX.spawn, 1), 'goto 回一层');
});

test('walk：真走 / 被墙挡 blocked / 自带碰撞体的门挡人 / bad_args', async h => {
  await h.call('goto', 'dev', 0, 8);
  const w = okr(await h.call.try('walk', 0, 6), 'walk(0, 6)');
  assert(near(w.pos[2], 6, 0.3), `走到了：${JSON.stringify(w)}`);
  await h.call('goto', 'dev', ...FIX.walledSouth);
  reason(await h.call.try('walk', FIX.walledNorth[0], FIX.walledNorth[1]), 'blocked', '穿墙 walk');
  await h.call('goto', 'dev', ...FIX.gateStand);
  reason(await h.call.try('walk', 14.6, 8.2), 'blocked', 'walk 撞门（动态碰撞体）');
  await h.call('goto', 'dev', ...FIX.penOutside);
  reason(await h.call.try('walk', ...FIX.penInside), 'blocked', 'walk 进关着门的围栏');
  reason(await h.call.try('walk', 'a', 1), 'bad_args', 'walk 参数');
});

test('listInteractables / focused', async h => {
  const list = okr(await h.call.try('listInteractables'), 'listInteractables');
  for (const id of [FIX.landmark, FIX.walled, FIX.gate]) assert(list.some(s => s.id === id), `沙盒夹具 ${id} 在列表里`);
  assert(list.every(s => typeof s.label === 'string'), 'label 是现算的字符串');
  const f = await h.call.try('focused');
  assert(f.ok === true && (f.result === null || typeof f.result === 'string'), `focused：${JSON.stringify(f)}`);
});

test('interact：成功 / not_focusable（隔墙）/ wrong_view / blocked / out_of_range / no_such_target / 自带碰撞体的门', async h => {
  const ok1 = okr(await approach(h, FIX.landmark, 1.6, 'interact'), 'interact 地标牌');
  assert(ok1.accepted === true && (ok1.feedback ?? '').includes(FIX.landmarkText), `反馈：${JSON.stringify(ok1)}`);
  await h.call('goto', 'dev', ...FIX.walledSouth);
  reason(await h.call.try('interact', FIX.walled), 'not_focusable', '隔墙交互');
  await h.call('goto', 'dev', ...FIX.walledNorth);
  okr(await h.call.try('interact', FIX.walled), '墙这边交互');
  await h.call('goto', 'dev', ...FIX.yinStand);
  const wv = await h.call.try('interact', FIX.yin);
  reason(wv, 'wrong_view', '肉眼交互阴物');
  assert(wv.result && wv.result.feedback === FIX.yinWrong, `wrong_view 带 wrongView 文本：${JSON.stringify(wv.result)}`);
  const bl = await approach(h, FIX.blocked, 1.6, 'interact');
  reason(bl, 'blocked', '前置不满足');
  assert(bl.result && bl.result.feedback === FIX.blockedText, `blocked 文本：${JSON.stringify(bl.result)}`);
  await h.call('goto', 'dev', 0, 12);
  reason(await h.call.try('interact', FIX.landmark), 'out_of_range', '太远');
  reason(await h.call.try('interact', 'r1.log'), 'no_such_target', '本区没有的交互物');
  await h.call('goto', 'dev', ...FIX.gateStand);
  const g = okr(await h.call.try('interact', FIX.gate), '自带动态碰撞体的门');
  assert((g.feedback ?? '').includes(FIX.gateText), `门的反馈：${JSON.stringify(g)}`);
});

test('interact：玻璃后的高优先级 NPC（隔玻璃聚焦）', async h => {
  const r = await approach(h, FIX.glassNpc, 3.2, 'interact');
  assert(r.ok === true && r.result.opened === 'mode.dialogue' && r.result.settle === 'waiting', `应开出对话并在第一句 settle：${JSON.stringify(r)}`);
  okr(await h.call.try('dlg'), 'dlg 推完');
});

test('show / use：接受 / fallback / not_owned；别名', async h => {
  await home(h);
  await h.call('giveItem', 'it.wonton');
  await h.call('givePhoto', 'ph.tudi');
  const u = okr(await approach(h, FIX.treeNpc, 1.6, 'useItem', 'it.wonton'), 'use 馄饨');
  assert(u.accepted === true && (u.feedback ?? '').includes(FIX.wonton), `接受：${JSON.stringify(u)}`);
  const s = okr(await h.call.try('show', FIX.treeNpc, 'ph.tudi'), 'show 照片（fallback）');
  assert(s.accepted === false && (s.feedback ?? '').includes(FIX.wontonFallback), `fallback：${JSON.stringify(s)}`);
  reason(await h.call.try('showItem', FIX.treeNpc, 'it.glasses'), 'not_owned', '出示没有的东西');
  const st = await h.state();
  assert(st.items.some(i => i.id === 'it.wonton' && i.used), 'accept 的 handler 标了已用');
});

test('readDoc：not_owned / 取景器与肉眼', async h => {
  reason(await h.call.try('readDoc', 'doc.idcard'), 'not_owned', '没有工作证时翻文档');
  await h.call('giveItem', 'it.slip_0473');
  const r = await h.call.try('readDoc', 'doc.slip_0473');
  if (!r.ok && r.reason === 'no_such_target') throw new Skip('doc.slip_0473 还没有区域登记（R3 的 text.ts）');
  const naked = okr(r, 'readDoc 肉眼');
  assert(naked.vf === false && naked.text.length > 0, `肉眼：${JSON.stringify(naked)}`);
  await h.call('vf', true);
  const vf = okr(await h.call.try('readDoc', 'doc.slip_0473'), 'readDoc 取景器');
  assert(vf.vf === true, '取景器中 vf:true');
  const s = await h.state();
  assert(s.stack.join() === 'mode.explore,mode.viewfinder', `读完合上，栈回到调用前：${s.stack.join()}`);
  await h.call('vf', false);
});

test('vf / lens / zoom：成功、幂等、bad_args、no_ability、mode_disallows', async h => {
  await home(h);
  assert(okr(await h.call.try('vf', 'on'), 'vf on').on === true, 'vf on');
  assert(okr(await h.call.try('setViewfinder', true), 'vf 幂等').on === true, 'vf 幂等');
  reason(await h.call.try('vf', 'maybe'), 'bad_args', 'vf 参数');
  reason(await h.call.try('lens', 'ir'), 'no_ability', '没有火眼切红外');
  reason(await h.call.try('lens', 'uv'), 'bad_args', 'lens 参数');
  await h.call('setFlags', { 'r2.ability_ir': true });
  assert(okr(await h.call.try('setLensMode', 'ir'), 'lens ir').lens === 'ir', 'lens ir');
  assert(okr(await h.call.try('lens', 'normal'), 'lens normal').lens === 'normal', 'lens normal');
  assert(okr(await h.call.try('zoom', 3), 'zoom 3').zoom === 3, 'zoom 3');
  assert(okr(await h.call.try('zoom', 6), 'zoom 6').zoom === 6, 'zoom 6');
  assert(okr(await h.call.try('zoom', 1), 'zoom 1').zoom === 1, 'zoom 1');
  reason(await h.call.try('zoom', 5), 'bad_args', 'zoom 5 不是档位');
  okr(await h.call.try('vf', false), 'vf off');
  const z = await h.call.try('zoom', 2);
  assert(z.ok === false, `肉眼下 zoom 应失败：${JSON.stringify(z)}`);
  // 离开取景器不复位镜头与倍率（ARCH §6.8.1）
  await h.call('vf', true);
  await h.call('zoom', 3);
  await h.call('vf', false);
  assert((await h.state()).zoom === 3, '离开取景器不复位倍率');
  await h.call('vf', true);
  await h.call('zoom', 1);
  await h.call('vf', false);
});

test('aimAt：automation 覆盖 / 读字（2×）/ 镜中读字（正前方、偏 0.6m、2×）/ 俯仰钳制 / no_such_target', async h => {
  await h.call('goto', 'dev', ...FIX.walledNorth);
  const a = okr(await h.call.try('aimAt', FIX.automated), 'aimAt automation');
  assert(a.point.every((v, i) => near(v, FIX.automatedAim[i], 1e-3)), `automation.aim：${JSON.stringify(a.point)}`);
  reason(await h.call.try('aimAt', 'nothing.here'), 'no_such_target', '未知 id');
  await h.call('goto', 'dev', ...FIX.labelStand);
  await h.call('vf', true);
  await h.call('zoom', 2);
  const rd = okr(await h.call.try('aimAt', FIX.label), 'aimAt 读字');
  assert(rd.reading && rd.reading.id === FIX.label && rd.inFrame, `2× 读到：${JSON.stringify(rd)}`);
  await h.call('zoom', 1);
  const small = okr(await h.call.try('aimAt', FIX.label), 'aimAt 1×');
  assert(small.reading === null && typeof small.readHint === 'string', `1× 太小：${JSON.stringify(small)}`);
  // 镜中读字（ARCH §6.8.6 的 core.mjs 必测例）
  await h.call('goto', 'dev', ...FIX.mirrorFront);
  await h.call('zoom', 3);
  const m1 = okr(await h.call.try('aimAt', FIX.sticker), '镜前 3×');
  assert(m1.reading && m1.reading.id === FIX.sticker, `正前方 0.9m 能读：${JSON.stringify(m1)}`);
  await h.call('goto', 'dev', ...FIX.mirrorSide);
  const m2 = okr(await h.call.try('aimAt', FIX.sticker), '镜前偏 0.6m');
  assert(m2.reading === null && (m2.readHint ?? '').includes('镜子里照不到'), `偏 0.6m 得 notInMirror：${JSON.stringify(m2)}`);
  await h.call('goto', 'dev', ...FIX.mirrorFront);
  await h.call('zoom', 2);
  const m3 = okr(await h.call.try('aimAt', FIX.sticker), '镜前 2×');
  assert(m3.reading === null && typeof m3.readHint === 'string', `2× 得 tooSmall：${JSON.stringify(m3)}`);
  await h.call('zoom', 1);
  // 俯仰钳制：站在楼上残影点正下方仰头看
  await h.call('goto', 'dev', FIX.replayStand[0], -5.6);
  const up = okr(await h.call.try('aimAt', FIX.rpUpper), 'aimAt 头顶');
  assert(up.clamped === true, `取景器俯仰 ±60° 钳制：${JSON.stringify(up)}`);
  await h.call('vf', false);
});

test('shoot：命中 / 空镜 / 肉眼下不能拍', async h => {
  await h.call('goto', 'dev', ...FIX.shotStand);
  const bad = await h.call.try('shoot');
  assert(bad.ok === false, `肉眼下快门应失败：${JSON.stringify(bad)}`);
  await h.call('vf', true);
  await h.call('aimAt', FIX.shotTarget);
  const hit = okr(await h.call.try('takePhoto'), 'shoot 命中');
  // 夹具 A 同时是几个目标的主体（WP5 的自测里逐个隔离），这里只要求命中了某个目标、照片与目标后缀对应
  assert(typeof hit.hit === 'string' && hit.photo === hit.hit.replace(/^pt\./, 'ph.'), `命中：${JSON.stringify(hit)}`);
  await h.call('aimAt', FIX.landmark);
  const empty = okr(await h.call.try('shoot'), 'shoot 空镜');
  assert(typeof empty.photo === 'string' && empty.photo.startsWith('ph.empty_') && typeof empty.caption === 'string', `空镜：${JSON.stringify(empty)}`);
  await h.call('vf', false);
});

test('replay：no_ability / 3D 距离 / 切段 / seek / 暂停播放 / 退出', async h => {
  await home(h);
  await h.call('goto', 'dev', ...FIX.replayStand);
  await h.call('vf', true);
  reason(await h.call.try('replay', FIX.rp), 'no_ability', '还不会倒带');
  await h.call('setFlags', { 'r1.ability_replay': true });
  reason(await h.call.try('replay', 'rp.none'), 'no_such_target', '没有的残影点');
  reason(await h.call.try('replay', FIX.rpUpper), 'not_near_replay_point', '楼上的残影点（3D 距离）');
  const r1 = okr(await h.call.try('replay', FIX.rp), 'replay 最近一段');
  assert(r1.seg === FIX.seg1 && r1.count === 2, `第一段：${JSON.stringify(r1)}`);
  const r2 = okr(await h.call.try('replay', FIX.rp, FIX.seg2), 'replay 切到更早一段');
  assert(r2.seg === FIX.seg2, `第二段：${JSON.stringify(r2)}`);
  okr(await h.call.try('replay', FIX.rp, FIX.seg1), 'replay 回到最近一段');
  const t = okr(await h.call.try('replaySeek', 5), 'replaySeek');
  assert(near(t.t, 5, 1e-3), `seek 到 5：${JSON.stringify(t)}`);
  // 锁步：两次调用之间时间不走
  const s1 = (await h.state()).replay;
  const s2 = (await h.state()).replay;
  assert(s1.t === s2.t && near(s1.t, 5, 1e-3), `锁步下两次调用之间 t 不变：${s1.t} ${s2.t}`);
  okr(await h.call.try('replayPause'), 'replayPause');
  await h.call('wait', 1);
  assert(near((await h.state()).replay.t, 5, 1e-3), '暂停时 wait 不走 t');
  okr(await h.call.try('replayPlay'), 'replayPlay');
  await h.call('wait', 1);
  assert(near((await h.state()).replay.t, 6, 0.05), '播放时 wait(1) 走 1 秒');
  reason(await h.call.try('replaySeek', 'x'), 'bad_args', 'replaySeek 参数');
  okr(await h.call.try('replayExit'), 'replayExit');
  reason(await h.call.try('replaySeek', 3), 'mode_disallows', '不在回放里 seek');
  await h.call('vf', false);
});

test('dlg / choose：选项、自动“（先这样）”、bad_option、no_dialogue、强制对话没有“（先这样）”', async h => {
  await home(h);
  reason(await h.call.try('choose', 1), 'no_dialogue', '没有对话时 choose');
  const o = okr(await approach(h, FIX.treeNpc, 1.6, 'interact'), 'interact 对话树 NPC');
  assert(o.opened === 'mode.dialogue' && o.settle === 'waiting', `第一句出现时返回：${JSON.stringify(o)}`);
  const d = okr(await h.call.try('advanceDialogue'), 'dlg 到选项');
  assert(d.at === 'choice' && d.options.length >= 2, `停在选项：${JSON.stringify(d)}`);
  assert(d.options[d.options.length - 1] === '（先这样）', `非强制对话末尾自动加“（先这样）”：${JSON.stringify(d.options)}`);
  reason(await h.call.try('choose', 99), 'bad_option', '选项越界');
  const c = okr(await h.call.try('chooseDialogOption', 1), 'choose 1');
  assert(c.chosen === d.options[0], `chosen = 选项文字：${JSON.stringify(c)}`);
  const d2 = okr(await h.call.try('dlg'), 'dlg 回到选项');
  assert(d2.at === 'choice', `回到选项：${JSON.stringify(d2)}`);
  okr(await h.call.try('choose', d2.options.length), 'choose（先这样）');
  const end = okr(await h.call.try('dlg'), 'dlg 结束');
  assert(end.at === 'end' && end.mode === 'mode.explore', `结束：${JSON.stringify(end)}`);
  // 强制对话
  okr(await approach(h, FIX.forced, 1.6, 'interact'), 'interact 强制对话');
  const f = okr(await h.call.try('dlg'), '强制对话到选项');
  assert(f.at === 'choice' && !f.options.includes('（先这样）'), `强制对话不加“（先这样）”：${JSON.stringify(f)}`);
  // 对话里 goto / setState / reload 都是 busy
  reason(await h.call.try('goto', 'dev', 0, 8), 'busy', '对话中 goto');
  reason(await h.call.try('setState', { flags: {} }), 'busy', '对话中 setState');
  reason(await h.call.try('reload'), 'busy', '对话中 reload');
  okr(await h.call.try('choose', f.options.length), '强制对话选最后一项');
  await h.call('dlg');
});

test('input / choose(称呼面板)：错误反馈、正确、no_panel、bad_args', async h => {
  await home(h, { 'r1.log_taken': true, 'r1.met_tudi': true });
  reason(await h.call.try('input', '0000'), 'no_panel', '没有面板时 input');
  const op = okr(await approach(h, FIX.codeLock, 1.4, 'interact'), '打开密码锁');
  assert(op.opened === 'mode.panel_code', `面板打开即 settle：${JSON.stringify(op)}`);
  reason(await h.call.try('input', 'abc'), 'bad_args', 'input 非数字');
  const w = okr(await h.call.try('enterCode', '0000'), '错误密码');
  assert(w.correct === false && (w.feedback ?? '').includes(FIX.codeFail), `错误反馈：${JSON.stringify(w)}`);
  assert((await h.state()).mode === 'mode.panel_code', '错误后面板保持打开');
  const c = okr(await h.call.try('input', FIX.code), '正确密码');
  assert(c.correct === true, `正确：${JSON.stringify(c)}`);
  okr(await approach(h, FIX.naming, 1.4, 'interact'), '打开称呼面板');
  assert((await h.state()).mode === 'mode.panel_naming', '称呼面板打开');
  reason(await h.call.try('choose', 'name.laozhou'), 'bad_option', '选没收录的称呼');
  const n1 = okr(await h.call.try('choose', 'name.kanmende'), '错选称呼');
  assert((n1.feedback ?? '').includes(FIX.namingWrong), `错选反馈：${JSON.stringify(n1)}`);
  assert((await h.state()).mode === 'mode.panel_naming', '错选回到列表');
  okr(await h.call.try('choose', 'name.huoji'), '选对');
});

test('vcr：装带、seek、暂停/播放、索引、快进、退出；mode_disallows / bad_args', async h => {
  await home(h);
  reason(await h.call.try('vcr', 'play'), 'mode_disallows', '不在录像机面板');
  const o = okr(await approach(h, FIX.vcr, 1.4, 'interact'), '装带');
  assert(o.opened === 'mode.panel_vcr', `打开面板：${JSON.stringify(o)}`);
  assert((await h.state()).vcr.tc === '22:00:00', '装带停在 22:00:00');
  const s = okr(await h.call.try('vcr', 'seek', '03:14:05'), 'seek');
  assert(s.tc === '03:14:05', `seek：${JSON.stringify(s)}`);
  reason(await h.call.try('vcr', 'seek', '3点'), 'bad_args', 'seek 格式');
  assert(okr(await h.call.try('vcr', 'play'), 'play').playing === true, 'play');
  assert(okr(await h.call.try('vcr', 'pause'), 'pause').playing === false, 'pause');
  const i = okr(await h.call.try('vcr', 'index', 'next'), 'index next');
  assert(i.tc !== '03:14:05', `跳到下一个索引点：${JSON.stringify(i)}`);
  okr(await h.call.try('vcr', 'index', 'prev'), 'index prev');
  okr(await h.call.try('vcr', 'shuttle', 1), 'shuttle 按住');
  okr(await h.call.try('vcr', 'shuttle', 0), 'shuttle 松开');
  reason(await h.call.try('vcr', 'shuttle', 2), 'bad_args', 'shuttle 参数');
  // 面板叠加取景器：传输键照样生效
  await h.call('vf', true);
  assert(okr(await h.call.try('vcr', 'play'), '叠加时 play').playing === true, '叠加取景器时 play 下传给面板');
  await h.call('vcr', 'pause');
  await h.call('vf', false);
  okr(await h.call.try('vcr', 'exit'), 'exit');
  assert((await h.state()).mode === 'mode.explore', '离开面板');
});

test('console / tripod / bodyGoto：成功与 mode_disallows', async h => {
  await home(h);
  reason(await h.call.try('console', 1), 'mode_disallows', '不在监控台');
  reason(await h.call.try('tripod', 'start'), 'mode_disallows', '不在三脚架');
  reason(await h.call.try('bodyGoto', 0, 0), 'mode_disallows', '不在三脚架 bodyGoto');
  const o = okr(await approach(h, FIX.crt, 1.2, 'interact'), '打开监控台');
  assert(o.opened === 'mode.panel_console', `面板：${JSON.stringify(o)}`);
  assert(okr(await h.call.try('console', 2), 'CH2').channel === 2, 'CH2');
  reason(await h.call.try('console', 9), 'bad_args', '频道 9');
  okr(await h.call.try('console', 'exit'), '离开监控台');
  okr(await approach(h, FIX.bracket, 2.5, 'interact'), '进三脚架');
  assert((await h.state()).mode === 'mode.tripod', 'mode.tripod');
  okr(await h.call.try('bodyGoto', ...FIX.tripodZone), 'bodyGoto');
  const c = okr(await h.call.try('tripod', 'cancel'), '取消三脚架');
  assert(c.state === 'off' && (await h.state()).mode === 'mode.explore', `取消后回到 explore：${JSON.stringify(c)}`);
});

test('back / wait / 冻结：暂停菜单里 wait 为 mode_disallows、游戏时间不走', async h => {
  await home(h);
  const t0 = okr(await h.call.try('wait', 0.5), 'wait 0.5').time;
  const t1 = okr(await h.call.try('wait', 1), 'wait 1').time;
  assert(near(t1 - t0, 1, 1e-3), `wait(1) 精确推进 1 秒：${t0} → ${t1}`);
  reason(await h.call.try('wait', -1), 'bad_args', 'wait 负数');
  const p = okr(await h.call.try('back'), 'back → 暂停');
  assert(p.mode === 'mode.pause', `explore 下 back 是暂停菜单：${JSON.stringify(p)}`);
  reason(await h.call.try('wait', 1), 'mode_disallows', '冻结时 wait');
  okr(await h.call.try('back'), 'back → 继续');
  assert((await h.state()).mode === 'mode.explore', '继续');
  // 真实按键 Tab 打开相册：冻结世界（ARCH §3.2）。按键可能在下一次 step 才生效，也可能已经生效——两种都要冻结住时间
  const before = okr(await h.call.try('wait', 0), 'wait 0').time;
  await h.page.keyboard.press('Tab');
  await h.page.waitForTimeout(200);
  let st = await h.state();
  if (st.mode === 'mode.album') {
    reason(await h.call.try('wait', 1), 'mode_disallows', '相册打开时 wait');
  } else {
    const during = okr(await h.call.try('wait', 1), 'Tab 后 wait').time;
    st = await h.state();
    assert(st.mode === 'mode.album', `Tab 打开相册：${st.mode}`);
    assert(during - before < 0.1, `相册打开后游戏时间不走：${before} → ${during}`);
  }
  await h.call('back');
});

test('hint / setTimeScale / frame / lint / perf', async h => {
  await home(h);
  const hi = okr(await h.call.try('hint'), 'hint');
  assert(typeof hi.text === 'string' && hi.text.length > 0, `hint 文本：${JSON.stringify(hi)}`);
  okr(await h.call.try('setTimeScale', 2), 'setTimeScale 2');
  reason(await h.call.try('setTimeScale', 0), 'bad_args', 'setTimeScale 0');
  okr(await h.call.try('setTimeScale', 1), 'setTimeScale 1');
  okr(await h.call.try('frame', 2), 'frame 2');
  reason(await h.call.try('frame', 0), 'bad_args', 'frame 0');
  const l = okr(await h.call.try('lint'), 'lint');
  assert(Array.isArray(l.issues), 'lint issues 是数组');
  if (l.issues.length) console.log(`        lint（dev）：${l.issues.length} 条\n          ${l.issues.slice(0, 12).join('\n          ')}`);
  const pf = okr(await h.call.try('perf'), 'perf');
  const { BUDGET } = await import(pathToFileURL(path.join(ROOT, 'src/data/render.ts')).href);
  assert(pf.callsMain <= BUDGET.callsMain && pf.calls <= BUDGET.callsTotal && pf.tris <= BUDGET.tris && pf.lights <= BUDGET.lights
    && pf.canvasMB * 1048576 <= BUDGET.canvasBytes && pf.frames >= 1,
    `dev 区域 perf() 在预算内（M1d：含 CanvasTexture 总量；calls 为一个辅助 RT 周期内的最大值）：${JSON.stringify(pf)}`);
  console.log(`        perf（dev）：${JSON.stringify(pf)}`);
});

test('灯数与着色器恒定：开关取景器、切红外前后 programs/lights 不变', async h => {
  await home(h, { 'r2.ability_ir': true });
  const p0 = okr(await h.call.try('perf'), 'perf 0');
  await h.call('vf', true);
  await h.call('lens', 'ir');
  await h.call('frame', 2);
  await h.call('lens', 'normal');
  await h.call('vf', false);
  await h.call('frame', 2);
  const p1 = okr(await h.call.try('perf'), 'perf 1');
  assert(p1.programs === p0.programs, `programs 变了：${p0.programs} → ${p1.programs}`);
  assert(p1.lights === p0.lights, `lights 变了：${p0.lights} → ${p1.lights}`);
});

test('★ setFlags / giveItem / givePhoto / setState：成功与 bad_args', async h => {
  await home(h);
  okr(await h.call.try('setFlags', { 'r1.log_taken': true, 'r2.wang_floor': 2 }), 'setFlags');
  reason(await h.call.try('setFlags', { 'r9.nope': true }), 'bad_args', '未登记 flag');
  reason(await h.call.try('setFlags', { 'r1.log_taken': 3 }), 'bad_args', '布尔 flag 给数值');
  okr(await h.call.try('giveItem', 'it.log'), 'giveItem');
  reason(await h.call.try('giveItem', 'it.nope'), 'bad_args', '未登记物品');
  okr(await h.call.try('givePhoto', 'ph.old_1'), 'givePhoto');
  reason(await h.call.try('givePhoto', 'ph.empty_3'), 'bad_args', '空镜不能 give');
  const s = await h.state();
  assert(s.flags['r1.log_taken'] === true && s.flags['r2.wang_floor'] === 2 && s.items.some(i => i.id === 'it.log') && s.photos.includes('ph.old_1'), `写进去了：${JSON.stringify({ f: s.flags, i: s.items, p: s.photos })}`);
  reason(await h.call.try('setState', { spawn: 'spawn.r3_west', area: 'r1' }), 'bad_args', '出生点不属于该区域');
});

test('★ shot / selftest / selftests', async h => {
  const list = okr(await h.call.try('shot', 'dev', '*'), 'shot 列表');
  assert(Array.isArray(list.shots), 'shot(area, "*") 列出机位');
  reason(await h.call.try('shot', 'dev', 'shot.dev.none'), 'no_such_target', '没有的机位');
  const names = okr(await h.call.try('selftests'), 'selftests');
  assert(names.some(n => n.startsWith('wp7.')), `登记了 wp7.* 自测：${names.join(', ')}`);
  reason(await h.call.try('selftest', 'wp7.none'), 'no_such_target', '没有的自测');
  const ok1 = okr(await h.call.try('selftest', 'wp7.json_safe'), 'selftest wp7.json_safe');
  assert(ok1.ok === true, `wp7.json_safe：${JSON.stringify(ok1)}`);
  await home(h);
});

test('出生点与区域往返：五个区域都能进（出生点离触发体 ≥ 0.8m 在进区域时断言），往返 5 次资源计数回到基线', async h => {
  const nodes = {};
  for (const area of ['r1', 'r2', 'r2_502', 'r3', 'r4']) {
    okr(await h.call.try('setState', { area }), `进入 ${area}`);
    nodes[area] = okr(await h.call.try('perf'), `perf ${area}`).octreeNodes;
  }
  // M4：碰撞 Octree 不再病态细分（R2 原来约 20 万个节点、常驻 ~80MB 堆；ARCH §16 #37）
  assert(Object.values(nodes).every(n => typeof n === 'number' && n > 0 && n < 20000), `每区碰撞 Octree 节点数应 < 2 万：${JSON.stringify(nodes)}`);
  await home(h);
  okr(await h.call.try('setState', { area: 'r1' }), 'r1');
  await home(h);
  const base = okr(await h.call.try('perf'), 'perf 基线');
  for (let i = 0; i < 5; i++) {
    await h.call('setState', { area: 'r1' });
    await home(h);
  }
  const after = okr(await h.call.try('perf'), 'perf 往返后');
  const { BUDGET } = await import(pathToFileURL(path.join(ROOT, 'src/data/render.ts')).href);
  assert(Math.abs(after.geometries - base.geometries) <= BUDGET.resourceDrift && Math.abs(after.textures - base.textures) <= BUDGET.resourceDrift,
    `往返 5 次后 geometries/textures 应回到基线 ±${BUDGET.resourceDrift}：${JSON.stringify({ base, after })}`);
});

test('五个区域经出入口图互相走通：满足条件后逐跳 travel（hops）；条件不满足 blocked（路线上第一个被挡的出口与反馈）', async h => {
  await home(h, { 'r1.gate_unchained': true, 'r2.menshen_open': true });
  const legs = [
    ['r2', [0, 3.0, 1], ['exit.dev_to_r1', 'exit.r1_to_r2']],
    ['r2_502', [5.6, -1.5], ['exit.r2_to_502']],
    ['r3', [0.5, 1.5], ['exit.r2_502_to_r2', 'exit.r2_to_r1', 'exit.r1_to_r3']],
    ['r4', [-16, 0], ['exit.r3_to_r1', 'exit.r1_to_r4']],
    ['r1', [-6.5, 20.9], ['exit.r4_to_r1']],
  ];
  for (const [area, xz, hops] of legs) {
    const r = okr(await h.call.try('goto', area, ...xz), `goto ${area}`);
    assert(r.area === area && near(r.pos[0], xz[0], 0.3) && near(r.pos[2], xz[1], 0.3), `落点：${JSON.stringify(r)}`);
    assert(JSON.stringify(r.hops) === JSON.stringify(hops), `goto ${area} 的出入口路线应为 ${hops.join(' → ')}：${JSON.stringify(r.hops)}`);
    const s = await h.state();
    assert(s.mode === 'mode.explore' && s.loading === false, `进区域后 explore 且不在加载：${s.mode} ${s.loading}`);
  }
  // dev → r1 → r2 → r2_502：院门锁着（r1 → r3/r4 挡住）也不相干，挡住的是路线上的 502 门（要 r2.menshen_open）
  await fresh(h);
  const b = await h.call.try('goto', 'r2_502', 5.6, -1.5);
  reason(b, 'blocked', 'goto r2_502（门神没放行）');
  assert(b.result && b.result.exit === 'exit.r2_to_502' && typeof b.result.feedback === 'string' && b.result.feedback.length > 0,
    `blocked 应带路线上第一个被挡的出口 exit.r2_to_502 与它的反馈（ARCH §4.5；docs/requests/engine-wp7.md #1）：${JSON.stringify(b.result)}`);
});

test('newGame / 存档 → reload() 一致 / continueGame / dev 里 reload 拒绝', async h => {
  reason(await h.call.try('reload'), 'mode_disallows', 'dev 沙盒不存档，reload 拒绝');
  const ng = okr(await h.call.try('newGame'), 'newGame');
  assert(ng.area === 'r1', `新游戏进 r1：${JSON.stringify(ng)}`);
  await h.call('dlg');
  const s0 = await h.state();
  assert(s0.mode === 'mode.explore', `开场过场后 explore：${s0.mode}`);
  await h.call('setFlags', { 'r1.log_taken': true, 'r1.gate_lamp_on': true });
  await h.call('giveItem', 'it.log');
  await h.call('givePhoto', 'ph.tudi');
  await h.call('wait', 0.2);   // 让 flushIfSafe 在安全时刻落盘
  const { reloadCheck } = await import('./lib/harness.mjs');
  await reloadCheck(h, '（core）');
  const cg = okr(await h.call.try('continueGame'), 'continueGame');
  assert(cg.area === 'r1', `继续：${JSON.stringify(cg)}`);
  reason(await h.call.try('continueGame', 'save.yin'), 'no_such_target', '没有寅时存档');
  await home(h);
});

// ==================================================================== 运行

async function runApi(h, filter) {
  console.log('== §12.3 方法与回归例（dev 沙盒）');
  for (const c of CASES) {
    if (filter && !c.name.includes(filter)) continue;
    const t0 = Date.now();
    try {
      h.clearErrors();
      await c.fn(h);
      h.checkErrors(c.name);
      results.push({ name: c.name, status: 'ok' });
      console.log(`  ok    ${c.name}（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
    } catch (err) {
      if (err instanceof Skip) {
        results.push({ name: c.name, status: 'skip', note: err.message });
        console.log(`  skip  ${c.name}：${err.message}`);
      } else {
        results.push({ name: c.name, status: 'fail', note: err.message });
        console.error(`  FAIL  ${c.name}：${err.message}`);
        await dumpFailure(h, 'core', null);
      }
    }
    // 下一例从干净的沙盒开始（失败的用例可能停在任何模式里）
    try {
      await home(h);
    } catch (err) {
      console.error(`  （回到沙盒失败：${err.message}）`);
    }
  }
}

async function runSelftests(h, only) {
  const dir = path.join(HERE, 'selftest');
  // 各 WP 的 wpN.mjs，加上整合代理的 m1c.mjs（M1c 起）、m1d.mjs（M1d 起）与 m4.mjs（M4 第 2 轮）
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^(wp\d+|m1[cd]|m4)\.mjs$/.test(f)).sort() : [];
  console.log(`== scripts/selftest/*.mjs（${files.join(' ')}）`);
  for (const f of files) {
    const name = f.replace(/\.mjs$/, '');
    if (only && name !== only) continue;
    const t0 = Date.now();
    try {
      await fresh(h);
      h.clearErrors();
      const mod = await import(pathToFileURL(path.join(dir, f)).href);
      if (typeof mod.default !== 'function') throw new Error('没有默认导出 run(h)');
      const r = await mod.default(h);
      const ok = r === undefined || r === true || (r && r.ok !== false);
      h.checkErrors(name);
      if (!ok) {
        const all = (r.notes ?? (r.results ?? []).flatMap(x => (x.ok === false ? [`${x.name ?? x.label}: ${(x.notes ?? [x.detail]).join(' | ')}`] : []))).map(String);
        // 先列失败行（各 WP 的 notes 格式不同：'FAIL …'、'✗ …'），没有再列全部非 ok 行
        const failing = all.filter(x => /FAIL|✗/.test(x));
        const lines = failing.length ? failing : all.filter(x => !x.startsWith('ok'));
        throw new Error(lines.slice(0, 20).join('\n          '));
      }
      results.push({ name: `selftest ${name}`, status: 'ok' });
      console.log(`  ok    ${name}（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
    } catch (err) {
      results.push({ name: `selftest ${name}`, status: 'fail', note: err.message });
      console.error(`  FAIL  ${name}：${err.message}`);
    }
  }
}

async function main() {
  const args = parseArgs();
  const quality = typeof args.quality === 'string' ? args.quality : 'low';
  const only = typeof args.only === 'string' ? args.only : null;
  const t0 = Date.now();
  const h = await launch({ query: DEV_QUERY.replace('quality=low', `quality=${quality}`), label: 'core' });
  try {
    if (!only && !args['skip-api']) await runApi(h, typeof args.case === 'string' ? args.case : null);
    if (!args['skip-selftests']) await runSelftests(h, only);
  } finally {
    await h.close();
  }
  const fails = results.filter(r => r.status === 'fail');
  const skips = results.filter(r => r.status === 'skip');
  console.log(`\ncore：${results.length - fails.length - skips.length} 通过，${fails.length} 失败，${skips.length} 跳过（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  for (const f of fails) console.log(`  FAIL ${f.name}`);
  console.log(fails.length ? 'CORE: FAIL' : 'CORE: OK');
  process.exit(fails.length ? 1 : 0);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
