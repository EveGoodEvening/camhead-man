// owner: WP7（M1b 写骨架）→ M2 起归 R1-world（ARCH §2.12、§15.4）
// R1 单区域测试：GDD §11 步骤 1–11（P1、P2、旧照一与二），预置 new（新游戏）。
// 另有：每个谜题 ≥ 2 条错误反馈（call.try + expect.feedback）与“前置未满足不写 flag”、院门门槛的 walk()、读档复验（reloadAt）。
// 区域代理按 GDD 与 r1/layout.ts 校对坐标与文本；引擎挡路的步骤/用例标 blockedBy: 'docs/requests/r1-world.md#<编号>'
// （步骤用 pickSteps 的 overrides：pickSteps(1, 11, { 7: { blockedBy: '…' } })）。
// 用法：npm run build && node scripts/regions/r1.mjs [--main] [--until=<n>] [--only=steps|cases] [--case=<子串>]

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readDocs, runRegion } from '../lib/harness.mjs';
import { PRESETS } from '../lib/presets.mjs';
import { pickSteps, tryFeedback } from '../walkthrough.mjs';

export const AREA = 'r1';
/** 本区用到的预置（ARCH §15.4；定义在 scripts/lib/presets.mjs 的 PRESETS）。 */
export const PRESET_NAMES = ['new', 'r2_start', 'r3_start', 'r4_start', 'yin'];
for (const p of PRESET_NAMES) if (!(p in PRESETS)) throw new Error(`presets.mjs 没有预置 ${p}`);

/** §11 步骤 1–11（代码与 walkthrough.mjs 同源；需要改哪一步就在 overrides 里换掉它）。 */
export const STEPS = pickSteps(1, 11);

/** 读档复验：本区两个中间步骤之后（ARCH §15.4）。 */
export const RELOAD_AT = [5, 9];

/** 错误反馈、前置未满足、门槛 walk()（每例从干净的新游戏 + 预置/extra 开始）。 */
export const CASES = [
  // ———————————————— P1 引路灯
  {
    // 开关是 7.5cm 宽的闸刀、间距 10cm：与 §11 步骤 2 一样在取景器里扳（第三人称的准星瞄不准这么小的东西）
    puzzle: 'P1', name: '开关①②④：对应的灯亮起并附一句旁白，可以再关掉（不写 gate_lamp_on）', preset: 'new', extra: { flags: { 'r1.log_taken': true }, items: ['it.log'] },
    run: async g => {
      await g.call('goto', 'r1', -7, 19.3);
      await g.call('vf', true);
      await tryFeedback(g, '车棚的灯亮了。几辆没人要的自行车在灯下淋雨。', 'interact', 'r1.switch_1');
      await tryFeedback(g, '公告栏的灯亮了。拆迁公告底下，还压着一张更旧的纸。', 'interact', 'r1.switch_2');
      await tryFeedback(g, '槐树上那串彩灯亮了一半，另一半早坏了。', 'interact', 'r1.switch_4');
      await g.refresh();
      g.assert(g.snap.temp.lamp_shed === true && g.snap.temp.lamp_board === true && g.snap.temp.lamp_tree === true, `三盏灯应亮着：${JSON.stringify(g.snap.temp)}`);
      await g.call('interact', 'r1.switch_1');
      await g.refresh();
      g.assert(g.snap.temp.lamp_shed === false, `再扳一次车棚灯应灭：${JSON.stringify(g.snap.temp)}`);
      await g.check.noFlags('r1.gate_lamp_on');
      const p = await g.call('perf');
      g.assert(p.lights === 8, `开关灯前后灯数恒为 8：${p.lights}`);
      await g.call('vf', false);
    },
  },
  {
    puzzle: 'P1', name: '开关③再扳：这个别关', preset: 'new', extra: { flags: { 'r1.log_taken': true, 'r1.gate_lamp_on': true }, items: ['it.log'] },
    run: async g => {
      await g.call('goto', 'r1', -7, 19.3);
      await g.call('vf', true);
      await tryFeedback(g, '这个别关。门口得有灯。', 'interact', 'r1.switch_3');
      await g.check.flags('r1.gate_lamp_on');
      await g.call('vf', false);
    },
  },
  {
    puzzle: 'P1', name: '没点灯就找土地', preset: 'new', extra: { flags: { 'r1.log_taken': true }, items: ['it.log'] },
    run: async g => {
      await g.call('goto', 'r1', 2.2, 3.4);
      await g.call('vf', true);
      await tryFeedback(g, '先把门口灯点上，不然他们找不着家。', 'interact', 'npc.tudi');
      await g.call('dlg');
      await g.check.noFlags('r1.met_tudi');
    },
  },
  {
    puzzle: 'P1', name: '没学会倒带就按 R', preset: 'new', extra: { flags: { 'r1.log_taken': true, 'r1.gate_lamp_on': true }, items: ['it.log'] },
    run: async g => {
      await g.call('goto', 'r1', 0, 21.5);
      await g.call('vf', true);
      const r = await tryFeedback(g, '你还不会看这个', 'replay', 'rp.r1_gate', 'seg.gate_2026');
      g.assert(r.ok === false && r.reason === 'no_ability', `应为 no_ability：${JSON.stringify(r)}`);
    },
  },
  // ———————————————— P2 伙计的生日
  {
    puzzle: 'P2', name: '连错 3 次写线索', preset: 'new', extra: { flags: { 'r1.log_taken': true }, items: ['it.log'] },
    run: async g => {
      await g.call('goto', 'r1', -6.5, 20.9);
      await g.call('interact', 'r1.drawer');
      for (const code of ['0000', '1234']) await tryFeedback(g, '锁纹丝不动。', 'input', code);
      // 第 3 次：“锁纹丝不动。”之后紧跟着“巡夜本上多了一行字”（后者是最后一条反馈）
      const r = await g.call('input', '9999');
      g.assert(r.correct === false, `input('9999') 应为 correct:false：${JSON.stringify(r)}`);
      await g.refresh();
      g.assert(g.snap.clues.some(c => c.includes('抽屉的号在伙计脑门上')), `应补一条线索：${JSON.stringify(g.snap.clues)}`);
      await g.check.noFlags('r1.drawer_open');
    },
  },
  {
    // 前置未满足（GDD P2 前置 r1.log_taken）：拿巡夜本之前抽屉不在场、交互不到，不会越过前置写 r1.drawer_open
    puzzle: 'P2', name: '拿巡夜本之前：抽屉不在场，不写 drawer_open', preset: 'new',
    run: async g => {
      const list = await g.call('listInteractables');
      const d = list.find(x => x.id === 'r1.drawer');
      g.assert(!d || !d.present, `拿巡夜本之前抽屉不该在场：${JSON.stringify(d)}`);
      const r = await g.call.try('interact', 'r1.drawer');
      g.assert(r.ok === false, `interact(r1.drawer) 应失败：${JSON.stringify(r)}`);
      await g.check.noFlags('r1.drawer_open', 'r1.log_taken');
    },
  },
  {
    puzzle: 'P2', name: '镜中贴条：倍率不到 3×', preset: 'new', extra: { flags: { 'r1.log_taken': true }, items: ['it.log'] },
    run: async g => {
      await g.call('goto', 'r1', -5.8, 19.5);
      await g.call('vf', true);
      await g.call('zoom', 2);
      const r = await g.call('aimAt', 'rd.sticker_mirror');
      g.assert(r.reading === null && (r.readHint ?? '').includes('字太小了'), `2× 应提示字太小：${JSON.stringify(r)}`);
    },
  },
  {
    puzzle: 'P2', name: '镜中贴条：站偏了', preset: 'new', extra: { flags: { 'r1.log_taken': true }, items: ['it.log'] },
    run: async g => {
      await g.call('goto', 'r1', -6.4, 19.5);   // 镜面平面前 0.9m、横向偏 0.6m（ARCH §6.8.6；往西偏——往东 0.6m 就进了东墙）
      await g.call('vf', true);
      await g.call('zoom', 3);
      const r = await g.call('aimAt', 'rd.sticker_mirror');
      g.assert(r.reading === null && (r.readHint ?? '').includes('镜子里照不到你的脑门'), `站偏应得到 notInMirror：${JSON.stringify(r)}`);
    },
  },
  {
    puzzle: 'P2', name: '没有钥匙时交互院门', preset: 'new', extra: { flags: { 'r1.log_taken': true }, items: ['it.log'] },
    run: async g => {
      await g.call('goto', 'r1', 0, 23.3);
      await tryFeedback(g, '铁链上挂着把大锁。', 'interact', 'r1.gate');
      await g.check.noFlags('r1.gate_unchained');
    },
  },
  {
    puzzle: 'P1', name: '学会倒带但还没看片段就找土地', preset: 'new',
    extra: { flags: { 'r1.log_taken': true, 'r1.gate_lamp_on': true, 'r1.met_tudi': true, 'r1.ability_replay': true }, items: ['it.log'], photos: ['ph.tudi'] },
    run: async g => {
      await g.call('goto', 'r1', 2.2, 3.4);
      await g.call('vf', true);
      await tryFeedback(g, '院门口那串脚印，你倒回去看看。', 'interact', 'npc.tudi');
      await g.call('dlg');
      await g.check.noFlags('r1.p1_done', 'r1.mission_given');
    },
  },
  {
    puzzle: 'P1', name: '门灯没亮就拍土地：前置未满足，不写 flag', preset: 'new', extra: { flags: { 'r1.log_taken': true }, items: ['it.log'] },
    run: async g => {
      await g.call('goto', 'r1', 2.4, 4.6);
      await g.call('vf', true);
      await g.call('aimAt', 'pt.tudi');
      const r = await g.call.try('shoot');
      await g.refresh();
      g.expect.feedback('先把门口灯点上', r);
      await g.check.noFlags('r1.met_tudi', 'r1.ability_replay');
    },
  },
  {
    puzzle: 'P1', name: '常光下对土地庙按 E：只见空马扎和灯笼；见过土地之后改看对联', preset: 'new', extra: { flags: { 'r1.log_taken': true }, items: ['it.log'] },
    run: async g => {
      await g.call('goto', 'r1', 2.2, 3.4);
      await tryFeedback(g, '马扎上没人，灯笼自己飘着。', 'interact', 'r1.shrine');
      await g.check.noFlags('r1.met_tudi');
      await g.call('setFlags', { 'r1.gate_lamp_on': true, 'r1.met_tudi': true });
      // 对联在文档阅读器里读（M3：E.doc / GameApi.openDoc，docs/requests/r1-world.md #1）
      await readDocs(g, 'r1.shrine', [['doc.shrine_couplet', '土能生万物']]);
    },
  },
  {
    name: '墙上文档在阅读器里读：公告栏三张一张接一张（讣告下半截读到 rd.obituary_hidden 之前打码）、小区简介、监控调试注意事项', preset: 'new', extra: { flags: { 'r1.log_taken': true }, items: ['it.log'] },
    run: async g => {
      await g.call('goto', 'r1', 8.6, 18.4);
      const [, obit] = await readDocs(g, 'r1.notice_board', [['doc.demolition', '拆除'], ['doc.obituary', '周守仁'], ['doc.water_notice']]);
      g.assert(obit.includes('█') && !obit.includes('无直系亲属'), `讣告下半截读到之前应打码：${JSON.stringify(obit)}`);
      await g.call('goto', 'r1', -7.0, 20.4);
      await readDocs(g, 'r1.cctv_notice', [['doc.cctv_notice', '监控调试注意事项']]);
      await g.check.mode('mode.explore');
    },
  },
  {
    puzzle: 'P2', name: '常光下照镜子：第一次“这是……我？”，之后“镜子里是一颗摄像头”', preset: 'new', extra: { flags: { 'r1.log_taken': true }, items: ['it.log'] },
    run: async g => {
      await g.call('goto', 'r1', -5.8, 19.5);
      await tryFeedback(g, '这是……我？', 'interact', 'r1.mirror');
      await tryFeedback(g, '镜子里是一颗摄像头。脑门上贴着张纸条', 'interact', 'r1.mirror');
      await g.check.noFlags('r1.drawer_open');
    },
  },
  {
    // M4 第 2 轮：抽屉开了以后 H 讲院门，不再从“脑门上的字”说起（GDD §3.12 分阶段提示；待同步 GDD §5 P2）
    puzzle: 'P2', name: 'H：抽屉开了、院门还锁着 → 提示讲院门', preset: 'new',
    extra: {
      flags: { 'r1.log_taken': true, 'r1.gate_lamp_on': true, 'r1.met_tudi': true, 'r1.ability_replay': true, 'r1.p1_done': true, 'r1.mission_given': true, 'r1.drawer_open': true },
      items: ['it.log', 'it.keys', 'it.bulb', 'it.slip_0473', 'it.idcard'], photos: ['ph.tudi'],
    },
    run: async g => {
      const r = await g.call('hint');
      g.assert(r.puzzle === 'pz.p02_huoji_birthday' && r.text.includes('院门') && !r.text.includes('脑门'), `抽屉开了以后的 P2 提示应讲院门：${JSON.stringify(r)}`);
    },
  },
  {
    // M4 第 2 轮：寅时按带子看到哪儿，土地换话（原来看完带子、听完那句话还是“先瞅瞅吧”；待同步 GDD §8.1“寅时”）
    name: '寅时的土地：看完带子 / 听完那句话 / 摆上画以后各说一句', preset: 'yin',
    run: async g => {
      const talk = async (flags, want) => {
        await g.call('setState', { flags, area: 'r1', spawn: 'spawn.r1_start' });
        await g.call('goto', 'r1', 2.2, 3.6);
        await g.call('vf', true);
        await tryFeedback(g, want, 'interact', 'npc.tudi');
        // 说完一句接两个话题：选最后一项（非强制对话自动追加的“（先这样）”）离开
        for (let i = 0; i < 4; i++) {
          const s = await g.refresh();
          if (!s.dialogue) break;
          if (s.dialogue.options.length) await g.call('choose', s.dialogue.options.length);
          else await g.call('dlg');
        }
        await g.call('vf', false);
      };
      await talk({ 'r1.tape_in_vcr': true }, '先瞅瞅吧');
      await talk({ 'r1.tape_watched': true }, '门口那团雪花还记着');
      await talk({ 'r1.heard_voice': true }, '陆师傅那张画，摆到桌上');
      await talk({ 'r1.portrait_placed': true }, '画还差一张脸');
    },
  },
  // ———————————————— 门槛：院门（动态碰撞体）
  {
    name: '院门：开锁前 walk() 被挡，开锁后能走出去', preset: 'new', extra: { flags: { 'r1.log_taken': true, 'r1.drawer_open': true }, items: ['it.log', 'it.keys'] },
    run: async g => {
      // 院门 x:-3~3 在 z=24（layout.ts）；门里 z=22.6、门外人行道 z=26
      await g.call('goto', 'r1', 0, 22.6);
      const blocked = await g.call.try('walk', 0, 26);
      g.assert(blocked.ok === false && blocked.reason === 'blocked', `开锁前应被挡：${JSON.stringify(blocked)}`);
      await g.call('goto', 'r1', 0, 23.3);
      await g.call('interact', 'r1.gate');
      await g.check.flags('r1.gate_unchained');
      await g.call('goto', 'r1', 0, 22.6);
      await g.call('walk', 0, 26);
    },
  },
  // ———————————————— 出入口：东口、西口在开锁前不通（goto 走出入口图）
  {
    name: '开锁前跨区域 goto 到 r3 → blocked', preset: 'new', extra: { flags: { 'r1.log_taken': true }, items: ['it.log'] },
    run: async g => {
      const r = await g.call.try('goto', 'r3', 0, 1.5);
      g.assert(r.ok === false && r.reason === 'blocked' && r.result && r.result.exit === 'exit.r1_to_r3', `应被 exit.r1_to_r3 挡住：${JSON.stringify(r)}`);
    },
  },
  // ———————————————— 时辰差异（GDD §4.6）：土地站位、灯数恒定
  ...[
    { tag: '子时开局', preset: 'new', extra: { flags: {}, items: [] }, at: [2.4, 2.0] },
    { tag: '子时', preset: 'r2_start', extra: {}, at: [2.4, 2.0] },
    { tag: '丑时', preset: 'r4_start', extra: {}, at: [2.4, 2.0] },
    { tag: '寅时', preset: 'yin', extra: {}, at: [2.4, 2.0] },
    { tag: '寅时·补脸之后', preset: 'yin', extra: { flags: { 'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.heard_voice': true, 'r1.portrait_placed': true, 'r1.portrait_complete': true } }, at: [-3.6, 19.2] },
  ].map(t => ({
    name: `时辰差异：${t.tag}，土地在 (${t.at.join(',')})，灯 8 盏`, preset: t.preset, extra: t.extra,
    run: async g => {
      await g.call('goto', 'r1', 0.5, 12);
      const list = await g.call('listInteractables');
      const tudi = list.find(x => x.id === 'npc.tudi');
      g.assert(tudi && tudi.present, `土地应在场：${JSON.stringify(tudi)}`);
      const a = await g.call('aimAt', 'npc.tudi');
      const d = Math.hypot(a.point[0] - t.at[0], a.point[2] - t.at[1]);
      g.assert(d < 0.6, `土地应在 (${t.at})，实际 ${JSON.stringify(a.point)}`);
      const p = await g.call('perf');
      g.assert(p.lights === 8, `灯数应恒为 8：${p.lights}`);
    },
  })),
  // ———————————————— X1 焚化、X5 冷迹、文档、角标
  {
    name: 'X1 火盆：烧“土地爷”——默认旁白 + 土地的画外音，照片仍在相册，不设 flag', preset: 'r2_start',
    run: async g => {
      await g.call('goto', 'r1', -1.8, 21.9);
      const before = (await g.state()).flags;
      const r = await g.call('use', 'r1.brazier', 'ph.tudi');
      await g.refresh();
      g.expect.feedback('纸灰打着旋儿飞走了', r);
      g.expect.feedback('烧我干啥？我就在这儿坐着呢。', { result: {} });
      g.expect.has('ph.tudi');
      g.assert(JSON.stringify(g.snap.flags) === JSON.stringify(before), '焚化不该改 flag');
      await tryFeedback(g, '这儿用不上。', 'use', 'r1.brazier', 'it.log');
    },
  },
  {
    name: 'X5 红外冷迹：椅子上一块人形的凉 → 巡夜本线索', preset: 'r3_start',
    run: async g => {
      await g.call('goto', 'r1', -6.4, 19.3);
      await g.call('vf', true);
      await g.call('lens', 'ir');
      await tryFeedback(g, '椅子上有一块人形的凉。', 'interact', 'r1.cold_chair');
      await g.refresh();
      g.assert(g.snap.clues.some(c => c.includes('椅子上有一块人形的凉')), `应记一条线索：${JSON.stringify(g.snap.clues)}`);
      await g.call('lens', 'normal');
    },
  },
  {
    name: '巡夜本新页①（拾取后）与公告栏讣告下半截（取景器 2×）', preset: 'new', extra: { flags: { 'r1.log_taken': true }, items: ['it.log'] },
    run: async g => {
      const d = await g.call('readDoc', 'doc.log_new');
      g.assert(d.text.includes('伙计，门口的灯灭了。今儿七月半'), `新页①：${d.text}`);
      await g.call('goto', 'r1', 8.6, 18.3);
      await g.call('vf', true);
      await g.call('zoom', 2);
      const r = await g.call('aimAt', 'rd.obituary_hidden');
      g.assert(r.reading && r.reading.id === 'rd.obituary_hidden', `应读到讣告下半截：${JSON.stringify(r)}`);
      await g.call('zoom', 1);
    },
  },
  {
    name: '角标不泄题：四个开关叫“开关①…④”，lint 无问题', preset: 'new', extra: { flags: { 'r1.log_taken': true }, items: ['it.log'] },
    run: async g => {
      await g.call('goto', 'r1', -7, 19.3);
      const list = await g.call('listInteractables');
      for (const [i, id] of ['r1.switch_1', 'r1.switch_2', 'r1.switch_3', 'r1.switch_4'].entries()) {
        const it = list.find(x => x.id === id);
        g.assert(it && it.label === `开关${'①②③④'[i]}`, `${id} 的角标：${JSON.stringify(it)}`);
      }
      const lint = await g.call('lint');
      // R1-world 的条目（dlg.r1.fin_* 等 R1-finale 的数据归它自己的脚本断言）
      const mine = lint.issues.filter(x => /r1\./.test(x) && !/\.fin_/.test(x));
      g.assert(mine.length === 0, `lint：${JSON.stringify(mine)}`);
    },
  },
];

export async function run() {
  return runRegion({ name: 'r1', phases: [{ preset: 'new', steps: STEPS }], cases: CASES, reloadAt: RELOAD_AT });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  run().then(ok => process.exit(ok ? 0 : 1), err => { console.error(err); process.exit(1); });
}
