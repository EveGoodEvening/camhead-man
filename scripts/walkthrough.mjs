// owner: WP7
// GDD §11 完整通关（ARCH §12.4、§15.5）：58 步写成数据，逐步断言；M3 跑通。
//
// 用法：npm run build && node scripts/walkthrough.mjs [选项]
//   （无选项）      100% 路线（含〔可选〕步骤），结局 ending === 'nanke'
//   --main           跳过〔可选〕步骤，结局 ending === 'main'（步骤 44 末尾的 lens('normal') 仍执行）
//   --shuttle        步骤 48 用 vcr('shuttle', 1) 走进降速区（验证 03:13:30 起自动降到 1×）代替直接 seek
//   --until=<n>      跑到第 n 步为止
//   --reload[=12,26] 在这些步骤之后 reload() 复验存档（缺省 12,26,37,45,52，ARCH §15.5）
//   --hints          每步之前（当前模式允许 H 时）调用 hint()，断言返回的谜题“可用且未完成”
//   --yin            通关之后：标题菜单没有“继续”、有“从寅时重来”；continueGame('save.yin') 进寅时再把终章（步骤 47–58）通关一次，
//                    之后标题菜单仍然没有“继续”（ARCH §15.5；M3 加）
//   --shots          每步后截图到 test-artifacts/walk/NN.png
//   --quality=low|mid|high  （默认 low）
// 失败时自动截图到 test-artifacts/fail/ 并打印 state()。不带 ?debug=1：setFlags/giveItem/setState 这些捷径根本不存在。
//
// 记法：每步的 run 只用 GDD §3.15 的 API；验证错误反馈的地方用 call.try + expect.feedback（ARCH §12.4 列出的那几处），
// 并断言相关 flag 没变（expect.noFlags）。expect(g) 在 run 之后、对 refresh() 得到的 state() 快照做同步断言。

import { launch, parseArgs, runSteps } from './lib/harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** 当前路线（'full' | 'main'），步骤 56 的南柯进度正文与步骤 58 的结局要按路线断言；regions/r1_finale.mjs 用 h.route 覆盖。 */
let ROUTE = 'full';
const routeOf = g => g.route ?? ROUTE;

const photoOf = r => (r && r.photo) || (r && r.result && r.result.photo);

/** 快门得到了某张照片（shoot() 的 result.photo）。 */
async function shootExpect(g, photo) {
  const r = await g.call('shoot');
  g.assert(r && r.photo === photo, `shoot() 应得到 ${photo}，实际 ${JSON.stringify(r)}`);
  return r;
}

/** 回放里拍旧照：replay → seek → aimAt → shoot → replayExit。 */
async function replayShot(g, rp, seg, t, pt, photo) {
  await g.call('replay', rp, seg);
  await g.call('replaySeek', t);
  await g.call('aimAt', pt);
  await shootExpect(g, photo);
  await g.call('replayExit');
}

/** 快照里的字幕/反馈/对话正文含 substr（不抛出；expect.feedback 的布尔版）。 */
function sawFeedback(s, substr) {
  return [s.subtitle, s.lastFeedback, s.dialogue && s.dialogue.text].some(x => typeof x === 'string' && x.includes(substr));
}

/** 支架确认对话里的南柯进度（GDD §11 步骤 56；regions/r1_finale.mjs 也用）：0 张只说“把头装回去，就下不来了。”，1–5 张“还差 6−n 张”，收齐“都收齐了”。 */
export function confirmWant(n) {
  return n >= 6 ? '都收齐了' : n >= 1 ? `还差 ${6 - n} 张` : '把头装回去，就下不来了。';
}

/** 从本表挑出第 from–to 步（regions/*.mjs 用）；overrides 按步号覆盖字段，例如 { 17: { blockedBy: 'docs/requests/r2.md#3' } }。 */
export function pickSteps(from, to, overrides = {}) {
  return STEPS.filter(s => s.n >= from && s.n <= to).map(s => ({ ...s, ...(overrides[s.n] ?? {}) }));
}

/** 反馈验证：call.try 之后刷新快照，断言反馈文本（结果的 feedback/caption、lastFeedback、字幕、对话正文）含 substr。 */
export async function tryFeedback(g, substr, method, ...args) {
  const r = await g.call.try(method, ...args);
  await g.refresh();
  g.expect.feedback(substr, r);
  return r;
}

export const STEPS = [
  // ———————————————————————————————— 子时 · R1
  {
    n: 1, title: '巡夜本',
    run: async g => {
      await g.call('dlg');
      await g.check.mode('mode.explore');
      g.expect.eq('area', 'r1');
      await g.call('interact', 'r1.log');
      // 拾取后自动翻开巡夜本（GDD §3.2，E.journal 阻塞到合上）：合上再走
      await g.check.mode('mode.journal');
      await g.call('back');
      await g.check.mode('mode.explore');
    },
    expect: g => { g.expect.flags('r1.log_taken'); g.expect.has('it.log'); g.expect.name('name.huoji'); },
  },
  {
    n: 2, title: '电闸与门灯',
    run: async g => {
      await g.call('goto', 'r1', -7, 19.3);
      await g.call('interact', 'r1.switch_box');
      await g.call('vf', true);
      const r = await g.call('aimAt', 'rd.switch_labels');
      g.assert(r.reading && r.reading.id === 'rd.switch_labels', `应读到 rd.switch_labels：${JSON.stringify(r)}`);
      await g.call('interact', 'r1.switch_3');
      await g.call('vf', false);
    },
    expect: g => g.expect.flags('r1.gate_lamp_on'),
  },
  {
    n: 3, title: '土地',
    run: async g => {
      await g.call('goto', 'r1', 2.2, 3.4);
      await tryFeedback(g, '马扎上没人，灯笼自己飘着。灯笼里有个声音', 'interact', 'r1.shrine');
      g.expect.noFlags('r1.met_tudi');
      await g.call('vf', true);
      await g.call('interact', 'npc.tudi');
      await g.call('dlg');
      await g.call('aimAt', 'pt.tudi');
      await shootExpect(g, 'ph.tudi');
      await g.call('dlg');
    },
    expect: g => { g.expect.flags('r1.met_tudi', 'r1.ability_replay'); g.expect.name('name.kanmende'); g.expect.has('ph.tudi'); },
  },
  {
    n: 4, title: '院门口倒带',
    run: async g => {
      await g.call('goto', 'r1', 0, 21.5);
      await g.call('replay', 'rp.r1_gate', 'seg.gate_2026');
      await g.call('replaySeek', 20);
      await g.refresh();
      g.expect.feedback('看完了？回来，跟你说个事儿。');
      await g.call('replayExit');
    },
    expect: g => g.expect.flags('r1.p1_done'),
  },
  {
    n: 5, title: '土地交代差事',
    run: async g => {
      await g.call('goto', 'r1', 2.4, 4.0);
      await g.call('interact', 'npc.tudi');
      await g.call('dlg');
    },
    expect: g => g.expect.flags('r1.mission_given'),
  },
  {
    n: 6, title: '抽屉（错误密码）',
    run: async g => {
      await g.call('goto', 'r1', -6.5, 20.9);
      await g.call('interact', 'r1.drawer');
      const r = await tryFeedback(g, '锁纹丝不动。', 'input', '0000');
      g.assert(r.ok && r.result.correct === false, `input('0000') 应为 correct:false：${JSON.stringify(r)}`);
    },
    expect: g => g.expect.noFlags('r1.drawer_open'),
  },
  {
    n: 7, title: '镜中贴条',
    run: async g => {
      await g.call('goto', 'r1', -5.8, 19.5);
      await g.call('vf', true);
      await g.call('zoom', 3);
      const r = await g.call('aimAt', 'rd.sticker_mirror');
      g.assert(r.reading && r.reading.id === 'rd.sticker_mirror', `镜前 0.9m、3× 应读到贴条：${JSON.stringify(r)}`);
      await g.call('zoom', 1);
      await g.call('vf', false);
    },
  },
  {
    n: 8, title: '抽屉（0618）',
    run: async g => {
      await g.call('goto', 'r1', -6.5, 20.9);
      await g.call('interact', 'r1.drawer');
      const r = await g.call('input', '0618');
      g.assert(r.correct === true, `input('0618') 应正确：${JSON.stringify(r)}`);
    },
    expect: g => {
      g.expect.flags('r1.drawer_open');
      g.expect.has('it.keys', 'it.bulb', 'it.slip_0473', 'it.idcard');
      g.expect.name('name.zhou_shouren');
    },
  },
  {
    n: 9, title: '院门铁链',
    run: async g => {
      await g.call('goto', 'r1', 0, 23.3);
      await g.call('interact', 'r1.gate');
    },
    expect: g => g.expect.flags('r1.gate_unchained'),
  },
  {
    n: 10, title: '旧照一', optional: true,
    run: async g => {
      await g.call('goto', 'r1', 0, -2.5);
      await g.call('vf', true);
      await replayShot(g, 'rp.r1_tree', 'seg.tree_1984', 10, 'pt.old_1', 'ph.old_1');
    },
    expect: g => g.expect.has('ph.old_1'),
  },
  {
    n: 11, title: '旧照二', optional: true,
    run: async g => {
      await g.call('goto', 'r1', 12.5, -6);
      await replayShot(g, 'rp.r1_shed', 'seg.shed_2012', 9, 'pt.old_2', 'ph.old_2');
      await g.call('vf', false);
    },
    expect: g => g.expect.has('ph.old_2'),
  },
  {
    n: 12, title: '蚁穴收旧照', optional: true,
    run: async g => {
      await g.call('goto', 'r1', -2.5, 1.8);
      await g.call('use', 'r1.anthill', 'ph.old_1');
      await g.call('use', 'r1.anthill', 'ph.old_2');
    },
    expect: g => { g.expect.flags('r1.ant_old_1', 'r1.ant_old_2'); g.expect.has('ph.old_1', 'ph.old_2'); },
  },
  // ———————————————————————————————— R2 三号楼
  {
    n: 13, title: '门厅声控灯',
    run: async g => {
      await g.call('goto', 'r2', 0, 3.0, 1);
      await g.call('vf', true);
      const r = await g.call('shoot');
      g.assert(typeof photoOf(r) === 'string' && photoOf(r).startsWith('ph.empty_'), `门厅第一张应是空镜：${JSON.stringify(r)}`);
    },
    expect: g => g.expect.flags('r2.lobby_lamp_lit'),
  },
  {
    n: 14, title: '王奶奶',
    run: async g => {
      await g.call('goto', 'r2', 0.8, 1.2, 1);
      await g.call('interact', 'npc.wang');
      await g.call('dlg');
    },
    expect: g => { g.expect.flags('r2.wang_met', 'r2.wang_escort'); g.expect.eq('flags.r2.wang_floor', 1); g.expect.name('name.xiaozhou'); },
  },
  {
    n: 15, title: '旧照四', optional: true,
    run: async g => {
      await g.call('goto', 'r2', 0, 2.6, 1);
      await replayShot(g, 'rp.r2_lobby', 'seg.lobby_2008', 10, 'pt.old_4', 'ph.old_4');
    },
    expect: g => g.expect.has('ph.old_4'),
  },
  {
    n: 16, title: '二楼',
    run: async g => {
      await g.call('goto', 'r2', 0, 1.2, 2);
      await g.call('shoot');
    },
    expect: g => g.expect.eq('flags.r2.wang_floor', 2),
  },
  {
    n: 17, title: '三楼空灯座',
    run: async g => {
      await g.call('goto', 'r2', -1.0, 1.2, 3);
      await tryFeedback(g, '咔嚓一声。灯座里是空的。', 'shoot');
      g.expect.eq('flags.r2.wang_floor', 2);
      await g.call('use', 'r2.lamp_socket_3f', 'it.bulb');
      await g.check.flags('r2.bulb_installed');
      await g.call('shoot');
    },
    expect: g => g.expect.eq('flags.r2.wang_floor', 3),
  },
  {
    n: 18, title: '四楼',
    run: async g => { await g.call('goto', 'r2', 0, 1.2, 4); await g.call('shoot'); },
    expect: g => g.expect.eq('flags.r2.wang_floor', 4),
  },
  {
    n: 19, title: '五楼',
    run: async g => { await g.call('goto', 'r2', 0, 1.2, 5); await g.call('shoot'); },
    expect: g => g.expect.eq('flags.r2.wang_floor', 5),
  },
  {
    n: 20, title: '门神',
    run: async g => {
      await g.call('goto', 'r2', -2.8, 1.2, 5);
      await g.call('interact', 'r2.menshen');
      await g.call('dlg');
    },
  },
  {
    n: 21, title: '2018 贴门神',
    run: async g => {
      await g.call('replay', 'rp.r2_door', 'seg.door_2018');
      await g.call('replaySeek', 4);
      await g.call('aimAt', 'pt.menshen_2018');
      const r = await tryFeedback(g, '门上还是光的。', 'shoot');
      g.assert(r.ok && photoOf(r.result) !== 'ph.menshen_2018', `第 4 秒不该拍到门神：${JSON.stringify(r)}`);
      await g.call('replaySeek', 12);
      await g.call('aimAt', 'pt.menshen_2018');
      await shootExpect(g, 'ph.menshen_2018');
      await g.call('replayExit');
    },
    expect: g => g.expect.has('ph.menshen_2018'),
  },
  {
    n: 22, title: '出示门神照',
    run: async g => {
      await g.call('show', 'r2.menshen', 'ph.menshen_2018');
      await g.call('dlg');
    },
    expect: g => { g.expect.flags('r2.menshen_open'); g.expect.name('name.tonghang'); },
  },
  {
    n: 23, title: '502 王奶奶与灶君',
    run: async g => {
      await g.call('goto', 'r2_502', 5.6, -1.5);
      await g.check.mode('mode.explore');
      await g.call('interact', 'npc.wang');
      await g.call('dlg');
      await g.call('vf', true);
      await g.call('interact', 'r2.zaojun');
      await g.call('dlg');
    },
  },
  {
    n: 24, title: '旧照三', optional: true,
    run: async g => replayShot(g, 'rp.r2_kitchen', 'seg.kitchen_1986', 8, 'pt.old_3', 'ph.old_3'),
    expect: g => g.expect.has('ph.old_3'),
  },
  {
    n: 25, title: '瓷砖与铁盒',
    run: async g => {
      await tryFeedback(g, '砖是死的。', 'interact', 'r2.tile_right_low');
      g.expect.noFlags('r2.tin_opened');
      await g.call('interact', 'r2.tile_left_low');
      // 抠开铁盒即在阅读器里翻开建国的信（M4 第 2 轮，同步骤 1 的巡夜本）：断言是这封信，合上再走
      const s = await g.refresh();
      g.assert(s.mode === 'mode.journal' && s.doc && s.doc.id === 'doc.letter_jianguo' && s.doc.text.includes('您一回也没坐上'), `抠开铁盒后应翻开建国的信：${JSON.stringify({ mode: s.mode, doc: s.doc && s.doc.id })}`);
      await g.call('back');
      const after = await g.refresh();
      g.assert(after.mode !== 'mode.journal', `合上信后阅读器还开着：${after.mode}`);
    },
    expect: g => { g.expect.flags('r2.tin_opened'); g.expect.has('it.letter', 'it.train_ticket', 'it.glasses'); },
  },
  {
    n: 26, title: '建国的信',
    run: async g => {
      await g.call('show', 'npc.wang', 'it.letter');
      await g.call('dlg');
      await g.refresh();
      g.expect.eq('shichen', 'zi');
      await g.call('vf', false);
    },
    expect: g => {
      g.expect.flags('r2.wang_done', 'r2.ability_ir');
      g.expect.has('it.wonton', 'it.money');
      g.expect.name('name.laozhou');
      g.expect.eq('shichen', 'zi');
    },
  },
  // ———————————————————————————————— R3 老街·照相馆
  {
    n: 27, title: '门铃',
    run: async g => {
      await g.call('goto', 'r3', 0.5, 1.5);
      await tryFeedback(g, '没人应', 'interact', 'r3.bell');
    },
  },
  {
    n: 28, title: '陆师傅开门',
    run: async g => {
      await g.call('goto', 'r3', 0, 0.6);
      await g.call('vf', true);
      await g.call('interact', 'npc.lu');
      await g.call('dlg');
      await g.call('show', 'npc.lu', 'it.slip_0473');
      await g.call('dlg');
    },
    expect: g => g.expect.flags('r3.lu_door_open'),
  },
  {
    n: 29, title: '取件单与 73 号格',
    run: async g => {
      const vfText = await g.call('readDoc', 'doc.slip_0473');
      g.assert(vfText.vf === true && vfText.text.includes('No.0473'), `取景器中翻开应显出 No.0473：${JSON.stringify(vfText)}`);
      // 肉眼下同一调用只有“No.04”加水渍（ARCH §6.16）
      await g.call('vf', false);
      const naked = await g.call('readDoc', 'doc.slip_0473');
      g.assert(naked.vf === false && naked.text.includes('No.04') && !naked.text.includes('No.0473'), `肉眼下不该显出第三位：${JSON.stringify(naked)}`);
      await g.call('vf', true);
      await g.call('goto', 'r3', -1.5, -2.4);
      await g.call('zoom', 2);
      const r = await g.call('aimAt', 'rd.pickup_numbers');
      g.assert(r.reading && r.reading.id === 'rd.pickup_numbers', `2× 应读到格子编号：${JSON.stringify(r)}`);
      await g.call('interact', 'r3.hole_73');
      await g.check.flags('r3.got_envelope');
      await g.call('zoom', 1);
    },
    expect: g => { g.expect.flags('r3.got_envelope'); g.expect.has('ph.covered_face'); },
  },
  {
    n: 30, title: '陆师傅（信封）',
    run: async g => {
      await g.call('goto', 'r3', 0, -2.2);
      await g.call('interact', 'npc.lu');
      await g.call('dlg');
    },
  },
  {
    n: 31, title: '旧照五', optional: true,
    run: async g => {
      await g.call('goto', 'r3', 0, -7.6);
      await replayShot(g, 'rp.r3_studio', 'seg.studio_1990', 11, 'pt.old_5', 'ph.old_5');
    },
    expect: g => g.expect.has('ph.old_5'),
  },
  {
    n: 32, title: '双反相机',
    run: async g => {
      await g.call('goto', 'r3', -2.0, -6);
      await g.call('interact', 'r3.tlr');
    },
    expect: g => g.expect.has('it.film'),
  },
  {
    n: 33, title: '暗房红灯',
    run: async g => {
      await g.call('goto', 'r3', -1.5, -12.9);
      await g.call('interact', 'r3.lamp_cord');
    },
  },
  {
    n: 34, title: '冲洗',
    run: async g => {
      for (const id of ['r3.tray_square', 'r3.basin_xi', 'r3.plate_chipped', 'r3.sink', 'r3.drying_line']) await g.call('interact', id);
    },
    expect: g => g.expect.flags('r3.film_hung'),
  },
  {
    n: 35, title: '底片第三格',
    run: async g => {
      await g.call('vf', true);
      await g.call('zoom', 2);
      await g.call('aimAt', 'pt.film3');
      await shootExpect(g, 'ph.film3');
      await g.check.flags('r3.film_developed');
      await g.call('zoom', 1);
      await g.call('vf', false);
      await g.call('interact', 'r3.lamp_cord');
    },
    expect: g => { g.expect.flags('r3.film_developed'); g.expect.has('ph.film3'); },
  },
  {
    n: 36, title: '取件单 0474',
    run: async g => {
      await g.call('goto', 'r3', 0, -2.2);
      await g.call('interact', 'npc.lu');
      await g.call('dlg');
    },
    expect: g => g.expect.has('it.slip_0474'),
  },
  {
    n: 37, title: '本相',
    run: async g => {
      await g.call('goto', 'r3', 0, -9.0);
      await g.call('interact', 'r3.stool');
      const r = await tryFeedback(g, '底片是白的', 'choose', 'name.zhou_shouren');
      g.assert(r.ok, `choose(name.zhou_shouren) 应被执行（错选反馈）：${JSON.stringify(r)}`);
      g.expect.noFlags('r3.saw_true_form');
      g.expect.mode('mode.panel_naming');
      await g.call('choose', 'name.huoji');
      await g.call('dlg');
    },
    expect: g => { g.expect.flags('r3.saw_true_form'); g.expect.has('ph.true_form', 'it.portrait'); g.expect.eq('shichen', 'chou'); },
  },
  // ———————————————————————————————— 丑时 · R4 鬼市
  {
    n: 38, title: '纸扎门童',
    run: async g => {
      await g.call('goto', 'r4', -16, 0);
      await g.call('use', 'npc.boy', 'it.money');
      await g.call('dlg');
    },
    expect: g => g.expect.flags('r4.ghost_market_open'),
  },
  {
    n: 39, title: '看破黄三爷',
    run: async g => {
      await g.call('goto', 'r4', 3, 0.3);
      await g.call('vf', true);
      await tryFeedback(g, '纸人没有回答。', 'interact', 'npc.huang');
      g.expect.noFlags('r4.spotted_huang', 'r4.found_huang');
      const list = await g.call('listInteractables');
      const huang = list.find(s => s.id === 'npc.huang');
      g.assert(!huang || huang.label === '纸人', `看破前角标应叫“纸人”：${JSON.stringify(huang)}`);
      await g.call('zoom', 4);
      const r = await g.call('aimAt', 'rd.huang_breath');
      g.assert(r.reading && r.reading.text.includes('这张纸面具的嘴那块洇湿了'), `4× 应读到面具的嘴：${JSON.stringify(r)}`);
      await g.check.flags('r4.spotted_huang');
      await g.call('interact', 'npc.huang');
      await g.call('dlg');
      await g.check.flags('r4.found_huang');
      await g.call('zoom', 1);
    },
    expect: g => g.expect.flags('r4.spotted_huang', 'r4.found_huang'),
  },
  {
    n: 40, title: '出示本相',
    run: async g => { await g.call('show', 'npc.huang', 'ph.true_form'); await g.call('dlg'); },
    expect: g => g.expect.flags('r4.asked_tape'),
  },
  {
    n: 41, title: '2023 藏带子',
    run: async g => {
      await g.call('goto', 'r4', 3.8, 0.2);
      await replayShot(g, 'rp.r4_stall', 'seg.stall_2023', 14, 'pt.huang_hides', 'ph.huang_hides');
    },
    expect: g => g.expect.has('ph.huang_hides'),
  },
  {
    n: 42, title: '出示藏带子',
    run: async g => { await g.call('show', 'npc.huang', 'ph.huang_hides'); await g.call('dlg'); },
    expect: g => g.expect.flags('r4.huang_admits'),
  },
  {
    n: 43, title: '常光照（误导项）',
    run: async g => {
      await g.call('aimAt', 'pt.huang_normal');
      await shootExpect(g, 'ph.huang_normal');
      // 旁白“（他半天没出声，尾巴垂下去）”单独一行，接着才是他的台词（M4 第 2 轮）
      await tryFeedback(g, '半天没出声', 'show', 'npc.huang', 'ph.huang_normal');
      await g.call('dlg');
    },
    expect: g => { g.expect.has('ph.huang_normal'); g.expect.noFlags('r4.got_tape'); },
  },
  {
    n: 44, title: '红外讨封',
    run: async g => {
      await g.call('goto', 'r4', 3, 0.6);
      await g.call('lens', 'ir');
      await g.call('aimAt', 'pt.huang_ir');
      await shootExpect(g, 'ph.huang_ir');
      await g.call('show', 'npc.huang', 'ph.huang_ir');
      await g.call('dlg');
      await g.call('choose', 1);
      await g.call('dlg');
      // 必做：离开取景器不复位镜头（ARCH §6.8.1），不切回常光步骤 48、53 会拍出“屏幕上只剩一团热”
      await g.call('lens', 'normal');
    },
    expect: g => {
      g.expect.flags('r4.got_tape');
      g.expect.has('it.tape_830');
      g.expect.eq('shichen', 'yin');
      g.expect.eq('saves.yin', true);
      g.expect.eq('lens', 'normal');
    },
  },
  {
    n: 45, title: '旧照六', optional: true,
    run: async g => {
      await g.call('goto', 'r4', -7, 0);
      await replayShot(g, 'rp.r4_mid', 'seg.mid_1997', 9, 'pt.old_6', 'ph.old_6');
      await g.call('vf', false);
    },
    expect: g => g.expect.has('ph.old_6'),
  },
  // ———————————————————————————————— 寅时 · R1
  {
    n: 46, title: '蚁穴收齐', optional: true,
    run: async g => {
      await g.call('goto', 'r1', -2.5, 1.8);
      for (const k of [3, 4, 5, 6]) await g.call('use', 'r1.anthill', `ph.old_${k}`);
    },
    expect: g => g.expect.flags('r1.ant_old_3', 'r1.ant_old_4', 'r1.ant_old_5', 'r1.ant_old_6', 'r1.nanke'),
  },
  {
    n: 47, title: '装带',
    run: async g => {
      await g.call('goto', 'r1', -6.5, 20.9);
      await g.call('use', 'r1.vcr', 'it.tape_830');
    },
    expect: g => { g.expect.flags('r1.tape_in_vcr'); g.expect.mode('mode.panel_vcr'); g.expect.eq('vcr.tc', '22:00:00'); },
  },
  {
    n: 48, title: '三点十四分',
    run: async g => {
      if (g.shuttle) {
        // --shuttle：按住快进走进降速区（03:13:30 起自动降到 1×），而不是直接 seek 过去
        await g.call('vcr', 'seek', '03:13:00');
        await g.call('vcr', 'shuttle', 1);
        const a = await g.call('wait', 2);
        g.assert(a.time > 0, 'wait(2)');
        const s1 = (await g.refresh()).vcr;
        g.assert(s1.tc >= '03:13:30' && s1.tc < '03:13:40', `快进进入降速区应降到 1×（停在 03:13:30 附近），实际 ${s1.tc}`);
        await g.call('vcr', 'shuttle', 0);
        await g.call('vcr', 'play');
        // 1× 播到 03:14:05
        for (let i = 0; i < 4; i++) {
          const tc = (await g.refresh()).vcr.tc;
          const [hh, mm, ss] = tc.split(':').map(Number);
          const left = (3 * 3600 + 14 * 60 + 5) - (hh * 3600 + mm * 60 + ss);
          if (left <= 0) break;
          await g.call('wait', Math.min(30, left));
        }
        await g.call('vcr', 'pause');
        const tc = (await g.refresh()).vcr.tc;
        g.assert(tc >= '03:14:00' && tc <= '03:14:15', `暂停时刻应在 [03:14:00, 03:14:15]，实际 ${tc}`);
      } else {
        await g.call('vcr', 'seek', '03:14:05');
        await g.call('vcr', 'pause');
      }
      await g.call('vf', true);
      await g.call('aimAt', 'pt.tape_face');
      await shootExpect(g, 'ph.tape_face');
      await g.call('vf', false);
      await g.check.mode('mode.panel_vcr');
    },
    expect: g => g.expect.has('ph.tape_face'),
  },
  {
    n: 49, title: '三点十六分（正好落在索引点上）',
    run: async g => {
      await g.call('vcr', 'seek', '03:16:00');
      await g.check.flags('r1.tape_watched');
      await g.call('vcr', 'exit');
    },
    expect: g => g.expect.flags('r1.tape_watched'),
  },
  {
    n: 50, title: '门口倒带（录像机录不下的声音）',
    run: async g => {
      await g.call('goto', 'r1', -3.6, 20.8);
      await g.call('vf', true);
      await g.call('replay', 'rp.r1_booth', 'seg.booth_2023');
      await g.call('replaySeek', 24);
      await g.call('replayExit');
      await g.call('vf', false);
    },
    expect: g => g.expect.flags('r1.heard_voice'),
  },
  {
    n: 51, title: '摆上遗像',
    run: async g => {
      await g.call('goto', 'r1', -6.5, 20.9);
      await tryFeedback(g, '摆上吧。还差一张脸。', 'use', 'r1.desk', 'it.portrait');
      g.expect.mode('mode.explore');
    },
    expect: g => { g.expect.flags('r1.portrait_placed'); g.expect.mode('mode.explore'); },
  },
  {
    n: 52, title: '补脸',
    run: async g => {
      await tryFeedback(g, '这是两只手', 'use', 'r1.desk', 'ph.covered_face');
      await g.call('dlg');
      g.expect.noFlags('r1.portrait_complete');
      const s = await g.refresh();
      if (s.photos.includes('ph.old_2')) {
        await tryFeedback(g, '照片上他的脸是一团雪花', 'use', 'r1.desk', 'ph.old_2');
        await g.call('dlg');
      }
      await g.call('use', 'r1.desk', 'ph.tape_face');
      await g.call('dlg');
    },
    expect: g => g.expect.flags('r1.portrait_complete'),
  },
  {
    n: 53, title: '照妖镜',
    run: async g => {
      await g.call('goto', 'r1', -5.9, 20.9);
      await g.call('interact', 'r1.crt_jack');
      await g.call('interact', 'r1.crt');
      await g.call('console', 1);
      await g.call('vf', true);
      await g.call('zoom', 1);
      await g.call('aimAt', 'pt.zhou_tunnel');
      await shootExpect(g, 'ph.zhou_tunnel');
      await g.check.flags('r1.zhou_visible');
      await g.call('vf', false);
      await g.call('console', 'exit');
    },
    expect: g => { g.expect.flags('r1.zhou_visible'); g.expect.has('ph.zhou_tunnel'); },
  },
  {
    n: 54, title: '馄饨',
    run: async g => {
      await g.call('use', 'r1.desk', 'it.wonton');
      await g.call('dlg');
      await g.call('choose', 1);
      await g.call('dlg');
      await g.call('choose', 1);
      await g.call('dlg');
    },
    expect: g => g.expect.flags('r1.zhou_fed'),
  },
  {
    n: 55, title: '老周',
    run: async g => {
      await g.call('goto', 'r1', -3.8, 20.6);
      await g.call('interact', 'npc.zhou');
      await g.call('dlg');
    },
  },
  {
    n: 56, title: '装回去',
    run: async g => {
      await g.call('interact', 'r1.bracket');
      let s = await g.refresh();
      g.assert(s.dialogue !== null, '应开出强制对话 dlg.r1.bracket_confirm');
      // 正文显示南柯进度（GDD §11 步骤 56、§6.13；M4 第 2 轮改写）：收齐 →“都收齐了”，1–5 张 →“还差 6−n 张”，
      // 一张没交（主线路线）→ 只有“把头装回去，就下不来了。”、不提蚁穴；按实际收下的张数断言（M3：--yin 从寅时重来时是寅时存档里的张数）
      const want = confirmWant(s.ants);
      if (routeOf(g) === 'main') g.assert(s.ants === 0, `主线路线蚁穴应一张没收：${s.ants}`);
      if (routeOf(g) === 'full') g.assert(s.ants >= 6, `100% 路线蚁穴应收齐：${s.ants}`);
      if (!s.dialogue.text.includes(want) && s.dialogue.options.length === 0) {
        await g.call('dlg');
        s = await g.refresh();
      }
      g.assert(s.dialogue && s.dialogue.text.includes(want), `确认对话应显示南柯进度“${want}”：${JSON.stringify(s.dialogue)}`);
      if (s.ants === 0) g.assert(!s.dialogue.text.includes('蚂蚁') && !s.dialogue.text.includes('/6'), `一张没交过的玩家不该在确认对话里看到蚁穴：${JSON.stringify(s.dialogue.text)}`);
      await g.call('choose', 1);
      await g.check.mode('mode.tripod');
      await g.call('tripod', 'start');
      await g.call('bodyGoto', -2.37, 22.28);   // 粉笔叉 R1.markPhoto（M4 合影构图）
      await g.call('wait', 14);
    },
    expect: g => { g.expect.flags('r1.soul_returned'); g.expect.has('ph.final'); g.expect.eq('shichen', 'mao'); },
  },
  {
    n: 57, title: '天亮了，叫我',
    run: async g => {
      // 字幕“天亮了。”在 12 秒加速钟（04:58→05:12，GDD P14 第 6 步）走完时出现：过场若把加速钟做成 wait 步骤，dlg() 已经推过去了；
      // 若做成不阻塞的计时、过场直接停在 await:'shutter'，要 wait(12) 之后才出现——两处都看，出现过一次即可
      await g.call('dlg', { maxReal: 120_000 });
      const early = sawFeedback(await g.refresh(), '天亮了。');
      await g.call('wait', 12);
      const late = sawFeedback(await g.refresh(), '天亮了。');
      g.assert(early || late, `dlg() 与 wait(12) 之后都没看到字幕“天亮了。”：${JSON.stringify({ subtitle: g.snap.subtitle, lastFeedback: g.snap.lastFeedback, cutscene: g.snap.cutscene })}`);
      await g.call('shoot');
    },
    expect: g => g.expect.flags('r1.called_at_dawn'),
  },
  {
    n: 58, title: '结局',
    run: async g => {
      // 有没有南柯段落看 r1.nanke（M3：按状态断言，--yin 重来时与路线无关）
      g.nanke = (await g.refresh()).flags['r1.nanke'] === true;
      const route = routeOf(g);
      if (route === 'main' || route === 'full') g.assert(g.nanke === (route === 'full'), `路线 ${route} 与 r1.nanke=${g.nanke} 不符`);
      const r = await g.call('dlg', { maxReal: 300_000 });
      if (!g.nanke) return;
      g.assert(r.at === 'await', `南柯段落应停在变焦等待：${JSON.stringify(r)}`);
      // 题名“南柯”：原来是一行字幕（'feedback'）；M4 第 2 轮 R1-finale 改成与片名同一种大字卡（ui.fade.title，不发 'feedback'，
      // zoom 的 settle 会一路推过它）——在页面上记下大字卡出现过的文字，两种都认
      await g.page.evaluate(() => {
        const w = window;
        w.__cmTitles = [];
        const el = document.querySelector('.cm-fade-title-main');
        if (el) new MutationObserver(() => w.__cmTitles.push(el.textContent ?? '')).observe(el, { childList: true, subtree: true, characterData: true });
      });
      await g.call('zoom', 6);
      await g.refresh();
      const titles = await g.page.evaluate(() => window.__cmTitles ?? []);
      if (!titles.some(t => t.includes('南柯'))) g.expect.feedback('南柯');
      await g.call('dlg', { maxReal: 300_000 });
    },
    expect: g => g.expect.eq('ending', g.nanke ? 'nanke' : 'main'),
  },
];

/**
 * 谜题 → 完成条件（--hints：返回的谜题不能是已完成的）。照 GDD §5 各谜题“解法”的最后一步（M3 更正：P2 到院门解链为止——
 * 解法第 4 步是用钥匙开院门；P12 到门口倒带听见那句话、手里有老周的脸为止——解法第 5 步），与各区域 puzzles 的 done 一致。
 */
const PUZZLE_DONE = {
  'pz.p01_guide_lamp': s => s.flags['r1.mission_given'] === true,
  'pz.p02_huoji_birthday': s => s.flags['r1.gate_unchained'] === true,
  'pz.p03_voice_lamps': s => (s.flags['r2.wang_floor'] ?? 0) >= 5,
  'pz.p04_door_gods': s => s.flags['r2.menshen_open'] === true,
  'pz.p05_kitchen_god': s => s.flags['r2.wang_done'] === true,
  'pz.p06_pickup_slip': s => s.flags['r3.got_envelope'] === true,
  'pz.p07_darkroom': s => s.flags['r3.film_developed'] === true,
  'pz.p08_true_form': s => s.flags['r3.saw_true_form'] === true,
  'pz.p09_ghost_market': s => s.flags['r4.found_huang'] === true,
  'pz.p10_camphor_chest': s => s.flags['r4.huang_admits'] === true,
  'pz.p11_seek_title': s => s.flags['r4.got_tape'] === true,
  'pz.p12_that_night': s => s.flags['r1.heard_voice'] === true && s.photos.includes('ph.tape_face'),
  'pz.p13_see_him': s => s.flags['r1.zhou_visible'] === true,
  'pz.p14_wake_me': s => s.flags['r1.called_at_dawn'] === true,
  'pz.h_nanke': s => s.flags['r1.nanke'] === true,
};
/** 谜题 → 可用条件（GDD §5 各谜题的“前置”；与各区域 puzzles 的 available 一致；has() = 身上有，用过的也算）。 */
const has = (s, id) => s.items.some(i => i.id === id);
const PUZZLE_AVAILABLE = {
  'pz.p01_guide_lamp': () => true,
  'pz.p02_huoji_birthday': s => s.flags['r1.log_taken'] === true,
  'pz.p03_voice_lamps': s => s.flags['r1.mission_given'] === true,
  'pz.p04_door_gods': s => (s.flags['r2.wang_floor'] ?? 0) >= 5 && s.flags['r1.ability_replay'] === true,
  'pz.p05_kitchen_god': s => s.flags['r2.menshen_open'] === true,
  'pz.p06_pickup_slip': s => s.flags['r1.gate_unchained'] === true && s.flags['r1.mission_given'] === true && has(s, 'it.slip_0473'),
  'pz.p07_darkroom': s => s.flags['r3.got_envelope'] === true,
  'pz.p08_true_form': s => s.flags['r3.film_developed'] === true,
  'pz.p09_ghost_market': s => s.flags['r2.wang_done'] === true && s.flags['r3.saw_true_form'] === true && has(s, 'it.money'),
  'pz.p10_camphor_chest': s => s.flags['r4.found_huang'] === true && s.flags['r1.ability_replay'] === true,
  'pz.p11_seek_title': s => s.flags['r4.huang_admits'] === true && s.flags['r2.ability_ir'] === true,
  'pz.p12_that_night': s => s.flags['r4.got_tape'] === true,
  'pz.p13_see_him': s => s.flags['r1.heard_voice'] === true && has(s, 'it.portrait') && s.photos.includes('ph.tape_face'),
  'pz.p14_wake_me': s => s.flags['r1.zhou_visible'] === true && has(s, 'it.wonton'),
  'pz.h_nanke': s => s.flags['r1.ability_replay'] === true,
};
const HINT_MODES = ['mode.explore', 'mode.viewfinder', 'mode.replay', 'mode.panel_vcr', 'mode.panel_console'];

async function hintCheck(g) {
  const s = await g.state();
  if (!HINT_MODES.includes(s.mode)) return;
  const r = await g.call('hint');
  if (r.puzzle === null) {
    // 候选为空（返回土地闲话）时确实没有可用未完成的谜题（南柯只追加、不作候选）
    const open = Object.keys(PUZZLE_AVAILABLE).filter(id => id !== 'pz.h_nanke' && PUZZLE_AVAILABLE[id](s) && !PUZZLE_DONE[id](s));
    g.assert(open.length === 0, `hint() 返回空，但这些谜题可用且未完成：${open.join(', ')}`);
    g.assert(typeof r.text === 'string' && r.text.length > 0, 'hint() 闲话文本为空');
    return;
  }
  const isDone = PUZZLE_DONE[r.puzzle];
  g.assert(typeof isDone === 'function', `hint() 返回了未知的谜题 ${r.puzzle}`);
  const done = isDone(s);
  g.assert(!done, `hint() 返回了已完成的谜题 ${r.puzzle}`);
  g.assert(PUZZLE_AVAILABLE[r.puzzle](s), `hint() 返回了还不可用的谜题 ${r.puzzle}`);
  g.assert(typeof r.text === 'string' && r.text.length > 0, 'hint() 文本为空');
  if (r.appended) g.assert(r.puzzle === 'pz.p14_wake_me' && s.ants >= 1 && s.ants < 6, `南柯追加提示只在 P14 且 1 ≤ n < 6 时出现：${JSON.stringify({ r, ants: s.ants })}`);
  // 反过来也要出现（M3：--yin --hints 从寅时重来时蚁穴收了 2 张，P14 的提示后面接着南柯的同级提示）
  if (r.puzzle === 'pz.p14_wake_me' && s.ants >= 1 && s.ants < 6) {
    g.assert(r.appended && r.appended.puzzle === 'pz.h_nanke' && typeof r.appended.text === 'string' && r.appended.text.length > 0, `P14 且 1 ≤ n < 6 时应追加南柯提示：${JSON.stringify({ r, ants: s.ants })}`);
    g.hintAppendedSeen = (g.hintAppendedSeen ?? 0) + 1;
  }
}

/** 结局之后：等引擎回到标题（areas.current 卸掉、标题菜单出现），返回标题菜单的菜单项（data-item）。 */
async function titleItems(h) {
  const t0 = Date.now();
  for (;;) {
    const items = await h.page.evaluate(() => {
      const list = document.querySelector('.cm-menu-list');
      if (!list || !list.isConnected || list.getClientRects().length === 0) return null;
      return [...list.querySelectorAll('button.cm-menu-item')].map(b => b.dataset.item);
    });
    const s = await h.state();
    if (items && items.length > 0 && s.loading === false && s.ending !== 'none') return { items, state: s };
    if (Date.now() - t0 > 120_000) throw new Error(`等不到结局后的标题菜单：${JSON.stringify({ items, ending: s.ending, area: s.area })}`);
    await h.call('wait', 1).catch(() => h.call('frame', 5));
  }
}

/** --yin：通关后标题没有“继续”；从寅时重来再把终章通关一次（ARCH §15.5）。 */
async function yinReplay(h, beforeEach = null) {
  const check = (tag, { items, state }) => {
    h.assert(!items.includes('continue'), `${tag}：标题菜单不该有“继续”：${JSON.stringify(items)}`);
    h.assert(items.includes('yin'), `${tag}：标题菜单应有“从寅时重来”：${JSON.stringify(items)}`);
    h.assert(state.saves.completed === true && state.saves.auto === false, `${tag}：saves 应为已通关、无自动存档：${JSON.stringify(state.saves)}`);
  };
  check('第一次通关后', await titleItems(h));
  console.log('  ok    通关后标题：没有“继续”，有“从寅时重来”');
  await h.call('continueGame', 'save.yin');
  const s = await h.refresh();
  // save.yin 在设 r4.got_tape 时写入（GDD §3.13、P11），所以读回来在 R4（写档时的区域），寅时
  h.assert(s.shichen === 'yin' && s.area === 'r4' && s.ending === 'none' && s.mode === 'mode.explore', `从寅时重来应回到寅时、拿到带子时的 R4：${JSON.stringify({ shichen: s.shichen, area: s.area, ending: s.ending, mode: s.mode })}`);
  h.assert(s.flags['r4.got_tape'] === true && !s.flags['r1.tape_in_vcr'] && !s.flags['r1.soul_returned'], `寅时存档应停在拿到带子之后、装带之前：${JSON.stringify(s.flags)}`);
  console.log(`  ok    从寅时重来：寅时 R4（拿到带子时写的档），南柯 ${s.ants}/6`);
  h.route = 'yin';
  const res = await runSteps(h, STEPS.filter(st => st.n >= 47), { name: 'walk-yin', beforeEach });
  h.route = undefined;
  if (res.failed) throw new Error(`从寅时重来：失败于步骤 ${res.failed.n}：${res.failed.error && res.failed.error.message}`);
  check('从寅时重来通关后', await titleItems(h));
  console.log(`  ok    从寅时重来再通关（${res.passed} 步），标题菜单仍然没有“继续”`);
}

async function main() {
  const args = parseArgs();
  ROUTE = args.main ? 'main' : 'full';
  const quality = typeof args.quality === 'string' ? args.quality : 'low';
  const reloadAt = args.reload === undefined ? [] : args.reload === true ? [12, 26, 37, 45, 52] : String(args.reload).split(',').map(Number);
  const until = args.until ? Number(args.until) : Infinity;
  const t0 = Date.now();
  console.log(`walkthrough：${ROUTE === 'main' ? '--main（跳过〔可选〕）' : '100% 路线'}${args.shuttle ? ' --shuttle' : ''}${reloadAt.length ? ` reload@${reloadAt.join(',')}` : ''}${args.hints ? ' --hints' : ''}${args.yin ? ' --yin' : ''}${Number.isFinite(until) ? ` until=${until}` : ''}`);
  const h = await launch({ query: `new=1&test=1&lockstep=1&quality=${quality}`, label: 'walk' });
  let ok = false;
  try {
    h.shuttle = !!args.shuttle;
    const res = await runSteps(h, STEPS, {
      main: ROUTE === 'main', until, shots: !!args.shots, reloadAt, name: 'walk',
      beforeEach: args.hints ? hintCheck : null,
    });
    ok = res.failed === null && res.blocked.length === 0;
    console.log(`\n通过 ${res.passed} 步，跳过 ${res.skipped} 步${res.blocked.length ? `，blocked ${res.blocked.length} 步` : ''}${res.failed ? `，失败于步骤 ${res.failed.n}` : ''}`);
    if (ok) h.checkErrors('walkthrough');
    if (ok && args.yin && !Number.isFinite(until)) {
      console.log('== --yin：从寅时重来');
      await yinReplay(h, args.hints ? hintCheck : null);
      if (args.hints) {
        h.assert((h.hintAppendedSeen ?? 0) > 0, '--yin --hints：从寅时重来（蚁穴收了 1–5 张）的 P14 期间应至少见到一次南柯追加提示');
        console.log(`  ok    南柯追加提示出现 ${h.hintAppendedSeen} 次（P14，1 ≤ n < 6）`);
      }
      h.checkErrors('walkthrough --yin');
    }
  } catch (err) {
    ok = false;
    console.error(err.message);
  } finally {
    await h.close();
  }
  console.log(`WALKTHROUGH (${ROUTE}): ${ok ? 'OK' : 'FAIL'}（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
