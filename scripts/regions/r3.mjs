// owner: WP7（M1b 写骨架）→ M2 起归 R3（ARCH §2.12、§15.4）
// R3 单区域测试：GDD §11 步骤 27–37（P6、P7、P8、旧照五），预置 r3_start（起点在 r1，步骤 27 的 goto 走东口进老街）。
// 另有：每个谜题 ≥ 2 条错误反馈与“前置未满足不写 flag”、照相馆玻璃门门槛的 walk()、时辰差异（NPC 在场/不在场、灯数恒定）、
// 红外冷迹、角标不泄题、暗房红灯单红通道（截图 test-artifacts/r3/darkroom_red.png 并验色）、读档复验。
// 用法：npm run build && node scripts/regions/r3.mjs [--main] [--until=<n>] [--only=steps|cases] [--case=<子串>]

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runRegion, artifactDir, decodePng, readDocs } from '../lib/harness.mjs';
import { PRESETS } from '../lib/presets.mjs';
import { pickSteps, tryFeedback } from '../walkthrough.mjs';

export const AREA = 'r3';
export const PRESET_NAMES = ['r3_start', 'r4_start', 'yin'];
for (const p of PRESET_NAMES) if (!(p in PRESETS)) throw new Error(`presets.mjs 没有预置 ${p}`);

export const STEPS = pickSteps(27, 37);
// 读档复验（ARCH §15.4：本区任意两个中间步骤）：读档回到出生点、模式复位为 explore——选下一步不依赖取景器开着的地方
export const RELOAD_AT = [27, 35];

const DOOR_OPEN = { flags: { 'r3.lu_door_open': true }, items: [{ id: 'it.slip_0473', used: true }] };
const ENVELOPE = { flags: { 'r3.lu_door_open': true, 'r3.got_envelope': true }, items: [{ id: 'it.slip_0473', used: true }], photos: ['ph.covered_face'] };
const DEVELOPED = {
  flags: { ...ENVELOPE.flags, 'r3.film_hung': true, 'r3.film_developed': true },
  items: [...ENVELOPE.items, { id: 'it.film', used: true }], photos: [...ENVELOPE.photos, 'ph.film3'],
};

/** listInteractables() 里某个对象的状态。 */
async function statusOf(g, id) {
  const list = await g.call('listInteractables');
  return list.find(s => s.id === id) ?? null;
}

/**
 * 截图并统计画面上半部（y 12%–60%：避开右上角的调试面板、下半部的提示条/反馈条/字幕这些 DOM 界面）的颜色：
 * red = 平均红通道；nonRed = G 或 B 明显不为零的像素占比（角标文字、准星会占一点点）。
 */
async function redStats(g, file) {
  const buf = await g.page.screenshot({ path: file, timeout: 180000 });
  const img = decodePng(buf);
  let r = 0, n = 0, nonRed = 0;
  for (let y = Math.floor(img.height * 0.12); y < img.height * 0.6; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const R = img.data[i] / 255, G = img.data[i + 1] / 255, B = img.data[i + 2] / 255;
      r += R;
      n++;
      if (G > 0.2 * R + 0.03 || B > 0.2 * R + 0.03) nonRed++;
    }
  }
  return { red: r / n, nonRed: nonRed / n };
}

export const CASES = [
  // ———————————————— P6 二十二年的取件单
  {
    puzzle: 'P6', name: '再按门铃 / 门没开时推门', preset: 'r3_start',
    run: async g => {
      await g.call('goto', 'r3', 0.5, 1.5);
      await tryFeedback(g, '没人应。', 'interact', 'r3.bell');
      await tryFeedback(g, '没人应。玻璃后头好像有个人影。', 'interact', 'r3.bell');
      // 门把手在门的西半边（门铃在东边）：站到门前偏西，离把手比离门铃近
      await g.call('goto', 'r3', -0.3, 1.2);
      await tryFeedback(g, '门锁着。门上挂着牌子：取件请按铃。', 'interact', 'r3.shop_door');
      g.expect.noFlags('r3.lu_door_open');
      const door = await statusOf(g, 'r3.shop_door');
      g.assert(door && door.available === false && door.label === '玻璃门', `门没开时玻璃门是灰角标：${JSON.stringify(door)}`);
    },
  },
  {
    puzzle: 'P6', name: '陆师傅只在取景器里瞧得见；对他出示别的东西', preset: 'r3_start',
    run: async g => {
      await g.call('goto', 'r3', 0, 0.6);
      const naked = await g.call.try('interact', 'npc.lu');
      g.assert(!naked.ok && ['wrong_view', 'not_focusable'].includes(naked.reason), `肉眼看不见陆师傅：${JSON.stringify(naked)}`);
      await g.call('vf', true);
      await tryFeedback(g, '这不是单子。', 'show', 'npc.lu', 'it.idcard');
      await g.call('dlg');
      g.expect.noFlags('r3.lu_door_open');
      await g.call('interact', 'npc.lu');
      await g.check.feedback('打烊了。……取件？单子拿来。');
      await g.call('dlg');
      g.expect.noFlags('r3.lu_door_open');
    },
  },
  {
    puzzle: 'P6', name: '取件单：肉眼只见水渍；别的格子：空的 / 照片格；角标一律“取件格”', preset: 'r3_start', extra: DOOR_OPEN,
    run: async g => {
      const naked = await g.call('readDoc', 'doc.slip_0473');
      g.assert(naked.text.includes('No.04……第三位泡成了一团水渍。') && !naked.text.includes('No.0473'), `肉眼翻开取件单：${JSON.stringify(naked)}`);
      await g.call('goto', 'r3', -1.5, -2.4);
      await g.call('vf', true);
      const small = await g.call('aimAt', 'rd.pickup_numbers');
      g.assert(!small.reading, `1× 读不出编号：${JSON.stringify(small)}`);
      await tryFeedback(g, '空的。', 'interact', 'r3.hole_03');
      await tryFeedback(g, '空的。', 'interact', 'r3.hole_63');
      await tryFeedback(g, '一对新人，一九九五年，没来取。', 'interact', 'r3.hole_12');
      await tryFeedback(g, '一张百日照，背面写着“囡囡百日”。', 'interact', 'r3.hole_38');
      g.expect.noFlags('r3.got_envelope');
      const list = await g.call('listInteractables');
      const holes = list.filter(s => s.id.startsWith('r3.hole_'));
      g.assert(holes.length === 100 && holes.every(s => s.label === '取件格' && s.available), '取件格角标一律只叫“取件格”，同一条件（不泄题）');
      const lint = await g.call('lint');
      // M3：lint 的“暗房容器”组只按形状叫（docs/requests/r3.md #3 已修），不再过滤
      const bad = lint.issues.filter(s => s.startsWith('r3'));
      g.assert(bad.length === 0, `lint：${JSON.stringify(bad)}`);
    },
  },
  {
    puzzle: 'P6', name: '门没开时取件格是灰的（前置未满足不写 flag）', preset: 'r3_start',
    run: async g => {
      await g.call('goto', 'r3', -2.2, 0.8);
      const s = await statusOf(g, 'r3.hole_73');
      g.assert(s && s.available === false && s.blockedText === '门锁着。门上挂着牌子：取件请按铃。', `门没开时取件格灰：${JSON.stringify(s)}`);
      g.expect.noFlags('r3.got_envelope');
    },
  },
  {
    // M4 第 2 轮：P5 之后在 R1 按 H，先说照相馆在哪儿（阶段 2，待同步 GDD §5 P6“分阶段提示”）；进了老街回到阶段 0
    puzzle: 'P6', name: 'H：还在 R1、门没开 → 提示讲照相馆在东口外的老街', preset: 'r3_start',
    run: async g => {
      await g.refresh();
      g.expect.eq('area', 'r1');
      const r = await g.call('hint');
      g.assert(r.puzzle === 'pz.p06_pickup_slip' && r.text.includes('老街'), `R1 里的 P6 提示应讲照相馆在老街：${JSON.stringify(r)}`);
      await g.call('goto', 'r3', -18, 5);
      const r2 = await g.call('hint');
      g.assert(r2.puzzle === 'pz.p06_pickup_slip' && !r2.text.includes('老街'), `进了老街以后回到“认单子”那一阶段：${JSON.stringify(r2)}`);
    },
  },
  // ———————————————— P7 暗房
  {
    puzzle: 'P7', name: '拿到信封之前交互双反；守则念全文', preset: 'r3_start', extra: DOOR_OPEN,
    run: async g => {
      await g.call('goto', 'r3', -2.0, -6);
      await tryFeedback(g, '墙钩上挂着一台双反。陆师傅没发话，你没动。', 'interact', 'r3.tlr');
      g.expect.noFlags('r3.film_hung');
      await g.refresh();
      g.assert(!g.snap.items.some(i => i.id === 'it.film'), '没拿到胶卷');
      await g.call('goto', 'r3', -1.5, -12.9);
      // 守则在文档阅读器里读（M3：E.doc，docs/requests/r3.md #2）
      await readDocs(g, 'r3.darkroom_rules', [['doc.darkroom_rules']]);
      await g.check.mode('mode.explore');
    },
  },
  {
    puzzle: 'P7', name: '白灯下放胶卷 / 次序错 / 没有胶卷；色彩辅助只在白灯下；红灯单红通道', preset: 'r3_start', extra: ENVELOPE,
    run: async g => {
      await g.call('goto', 'r3', -1.5, -12.9);
      await tryFeedback(g, '盘里是药水，一股醋味儿。', 'interact', 'r3.tray_square');
      const white = await statusOf(g, 'r3.tray_square');
      g.assert(white.colorHint === '黄色' && white.label === '方盘', `白灯下色彩辅助给颜色：${JSON.stringify(white)}`);
      await g.call('goto', 'r3', -2.0, -6);
      await g.call('interact', 'r3.tlr');
      await g.check.has('it.film');
      await g.call('goto', 'r3', -1.5, -12.9);
      await tryFeedback(g, '片子见了白光——瞎了。', 'interact', 'r3.tray_square');
      await g.call('interact', 'r3.lamp_cord');
      // 从灯绳那边一转身就去点豁口盘（M3：interact 的转向迭代到收敛，docs/requests/r3.md #7，不再需要先 aimAt + wait）
      await tryFeedback(g, '片子发灰了——次序错了。', 'interact', 'r3.plate_chipped');
      g.expect.noFlags('r3.film_hung');
      // 次序错归零：从头按对也能冲好（不损失任何东西）
      await tryFeedback(g, '片子还没冲好', 'interact', 'r3.drying_line');
      g.expect.noFlags('r3.film_hung');
      const list = await g.call('listInteractables');
      const by = Object.fromEntries(list.filter(s => ['r3.tray_square', 'r3.basin_xi', 'r3.plate_chipped'].includes(s.id)).map(s => [s.id, s]));
      g.assert(by['r3.tray_square'].label === '方盘' && by['r3.basin_xi'].label === '深盆' && by['r3.plate_chipped'].label === '豁口盘', `红灯下容器角标只按形状叫：${JSON.stringify(by)}`);
      g.assert(Object.values(by).every(s => s.colorHint === undefined), `红灯下色彩辅助不给颜色：${JSON.stringify(by)}`);
      // 单红通道：画面里 G、B 几乎为零（GDD §4.4“颜色无法分辨”）
      await g.call('wait', 3);
      const red = await redStats(g, path.join(artifactDir('r3'), 'darkroom_red.png'));
      g.assert(red.red > 0.01 && red.nonRed < 0.03, `红灯下画面应压成单红通道：${JSON.stringify(red)}`);
    },
  },
  {
    // M4 第 2 轮：暗房第三人称——顶棚、吊灯加了碰撞体（低头时相机不再钻到顶棚上面、整屏黑），三件容器与水池有拾取代理，
    // 灯绳、守则不参与就近聚焦。原来瞄方盘按 E 拉了灯绳（红灯变白灯，片子瞎了），瞄深盆点了方盘（次序错了）
    puzzle: 'P7', name: '暗房第三人称：瞄哪件容器就聚焦哪件；红灯下对着方盘按 E 是显影，不会拉灯绳', preset: 'r3_start',
    extra: { ...ENVELOPE, items: [...ENVELOPE.items, 'it.film'] },
    run: async g => {
      await g.call('goto', 'r3', -1.9, -12.9);
      await tryFeedback(g, '红灯亮了', 'interact', 'r3.lamp_cord');
      const bad = [];
      for (const [x, z] of [[-1.9, -12.9], [-1.5, -12.6], [-1.1, -12.9]]) {
        await g.call('goto', 'r3', x, z);
        for (const id of ['r3.tray_square', 'r3.basin_xi', 'r3.plate_chipped', 'r3.sink']) {
          const r = await g.call('aimAt', id);
          if (r.focused !== id) bad.push(`@(${x},${z}) ${id} → ${r.focused}`);
        }
      }
      g.assert(bad.length === 0, `第三人称瞄容器应聚焦到它自己：${bad.join('；')}`);
      // 真按键：站在方盘跟前瞄它、按 E
      await g.call('goto', 'r3', -1.9, -12.9);
      await g.call('aimAt', 'r3.tray_square');
      await g.page.keyboard.down('KeyE');
      await g.page.keyboard.up('KeyE');
      await g.call('frame', 1);
      await g.call('wait', 1);
      await g.refresh();
      g.assert(g.snap.lastFeedback === '片子沉进药水里，你数着秒。' && g.snap.temp?.safelight === true && g.snap.temp?.dev_step === 1,
        `红灯下对着方盘按 E 应是显影（红灯不灭）：${JSON.stringify({ fb: g.snap.lastFeedback, temp: g.snap.temp })}`);
      // 影棚里对着暗房门：聚焦的是门，不是门背后的守则
      await g.call('goto', 'r3', -1.56, -9.97);
      const door = await g.call('aimAt', 'r3.darkroom_door');
      g.assert(door.focused === 'r3.darkroom_door', `影棚里瞄暗房门应聚焦门：${JSON.stringify(door)}`);
    },
  },
  // ———————————————— P8 本相
  {
    puzzle: 'P8', name: '没拿到新单子就坐', preset: 'r3_start', extra: DEVELOPED,
    run: async g => {
      await g.call('goto', 'r3', 0, -9.0);
      await tryFeedback(g, '单子还没开呢，坐那儿干啥。', 'interact', 'r3.stool');
      g.expect.mode('mode.explore');
      g.expect.noFlags('r3.saw_true_form');
    },
  },
  {
    puzzle: 'P8', name: '错选称呼：看门的 / 同行 / 老周 / 小周', preset: 'r3_start',
    extra: { ...DEVELOPED, items: [...DEVELOPED.items, 'it.slip_0474'] },
    run: async g => {
      await g.call('goto', 'r3', 0, -9.0);
      await g.call('interact', 'r3.stool');
      await g.check.mode('mode.panel_naming');
      await tryFeedback(g, '看门的多了，门神也看门。', 'choose', 'name.kanmende');
      await tryFeedback(g, '跟门神称同行，好大的口气。', 'choose', 'name.tonghang');
      await tryFeedback(g, '老周要坐这儿，早捂脸了。', 'choose', 'name.laozhou');
      await tryFeedback(g, '王家婶子眼神不济，她的话你也信？', 'choose', 'name.xiaozhou');
      g.expect.noFlags('r3.saw_true_form');
      g.expect.mode('mode.panel_naming');
    },
  },
  {
    // M4：GDD 那一整段旁白原来挤成一条两行字幕（换行拆开“摄/像头”、嵌套的‘’显示成撇号）；现在拆成三句、跟着三个镜头逐句出
    puzzle: 'P8', name: '本相过场：旁白三句逐句出（镁光 → 举底片 → 底片近景），然后是陆师傅的话', preset: 'r3_start',
    extra: { ...DEVELOPED, items: [...DEVELOPED.items, 'it.slip_0474'] },
    run: async g => {
      await g.call('goto', 'r3', 0, -9.0);
      await g.call('interact', 'r3.stool');
      await g.check.mode('mode.panel_naming');
      // choose() 要等到过场停在对话上才返回，看不到中间的字幕：按数字键选（与玩家同一条路径），再一小段一小段推时间
      const k = g.snap.panel && g.snap.panel.options ? g.snap.panel.options.indexOf('name.huoji') : -1;
      g.assert(k >= 0 && k < 6, `称呼面板里有“伙计”：${JSON.stringify(g.snap.panel)}`);
      await g.page.keyboard.press(`Digit${k + 1}`);
      const seen = [];
      for (let i = 0; i < 80; i++) {
        await g.call.try('wait', 0.4);
        await g.refresh();
        const sub = g.snap.subtitle;
        if (sub && seen[seen.length - 1] !== sub) seen.push(sub);
        if (g.snap.mode === 'mode.dialogue' || g.snap.mode === 'mode.explore') break;
      }
      const want = ['镁光“噗”地一亮。', '陆师傅把底片举到灯下，看了很久：“……出来了。”', '底片上没有人，是一台戴铁皮帽子的摄像头。'];
      g.assert(JSON.stringify(seen) === JSON.stringify(want), `过场旁白逐句出：${JSON.stringify(seen)}`);
      g.assert(g.snap.dialogue && g.snap.dialogue.id === 'dlg.r3.lu_after', `旁白之后是陆师傅的话：${JSON.stringify(g.snap.dialogue)}`);
      await g.call('dlg');
      g.expect.flags('r3.saw_true_form');
      g.expect.has('ph.true_form', 'it.portrait');
      await g.check.mode('mode.explore');
    },
  },
  // ———————————————— 门槛：照相馆玻璃门（seeThrough 动态碰撞体）
  {
    name: '玻璃门：开门前 walk() 被挡、隔门能和陆师傅说话；开门后能进店', preset: 'r3_start',
    run: async g => {
      await g.call('goto', 'r3', 0, 0.8);
      const blocked = await g.call.try('walk', 0, -1.5);
      g.assert(blocked.ok === false && blocked.reason === 'blocked', `开门前应被挡：${JSON.stringify(blocked)}`);
      const inside = await g.call.try('goto', 'r3', 0, -2.2);
      g.assert(inside.ok === false && inside.reason === 'unreachable', `开门前 goto 进店应为 unreachable：${JSON.stringify(inside)}`);
      await g.call('goto', 'r3', 0, 0.8);
      await g.call('vf', true);
      await g.call('interact', 'npc.lu');
      await g.call('dlg');
      await g.call('show', 'npc.lu', 'it.slip_0473');
      await g.call('dlg');
      await g.check.flags('r3.lu_door_open');
      await g.check.used('it.slip_0473');
      await g.call('vf', false);
      await g.call('wait', 1.5);
      await g.call('walk', 0, -1.5);
      await g.call('goto', 'r3', -1.5, -12.9);
    },
  },
  // ———————————————— 时辰差异（GDD §4.6）与灯数恒定
  {
    name: '时辰：mission 之前陆师傅不在；子时在柜台后；丑时/寅时不在馆里、门开着；灯数恒定', preset: 'new',
    extra: {
      flags: { 'r1.log_taken': true, 'r1.gate_lamp_on': true, 'r1.met_tudi': true, 'r1.ability_replay': true, 'r1.drawer_open': true, 'r1.gate_unchained': true },
      items: ['it.log', { id: 'it.keys', used: true }, 'it.bulb', 'it.slip_0473', 'it.idcard'],
      area: 'r3', spawn: 'spawn.r3_west',
    },
    run: async g => {
      await g.call('goto', 'r3', 0.5, 1.5);
      const lu0 = await statusOf(g, 'npc.lu');
      g.assert(lu0 && lu0.present === false, `r1.mission_given 之前陆师傅不在：${JSON.stringify(lu0)}`);
      await tryFeedback(g, '没人应。', 'interact', 'r3.bell');
      await tryFeedback(g, '没人应。', 'interact', 'r3.bell');
      const lights0 = (await g.call('perf')).lights;
      // 子时（r3_start）：柜台后
      await g.call('setState', { ...(await import('../lib/presets.mjs')).presetPatch('r3_start'), area: 'r3', spawn: 'spawn.r3_west' });
      await g.call('goto', 'r3', 0.5, 1.5);
      const lu1 = await statusOf(g, 'npc.lu');
      g.assert(lu1 && lu1.present === true, `子时陆师傅在柜台后：${JSON.stringify(lu1)}`);
      const lights1 = (await g.call('perf')).lights;
      // 丑时（r4_start）：不在馆里、门开着
      await g.call('setState', { ...(await import('../lib/presets.mjs')).presetPatch('r4_start'), area: 'r3', spawn: 'spawn.r3_west' });
      await g.refresh();
      g.expect.eq('shichen', 'chou');
      const lu2 = await statusOf(g, 'npc.lu');
      g.assert(lu2 && lu2.present === false, `丑时陆师傅不在馆里：${JSON.stringify(lu2)}`);
      await g.call('goto', 'r3', 0, -2.2);
      const lights2 = (await g.call('perf')).lights;
      // 寅时（yin）：同丑时
      await g.call('setState', { ...(await import('../lib/presets.mjs')).presetPatch('yin'), area: 'r3', spawn: 'spawn.r3_west' });
      await g.refresh();
      g.expect.eq('shichen', 'yin');
      const lu3 = await statusOf(g, 'npc.lu');
      g.assert(lu3 && lu3.present === false, `寅时陆师傅不在馆里：${JSON.stringify(lu3)}`);
      await g.call('goto', 'r3', 0, -2.2);
      const lights3 = (await g.call('perf')).lights;
      g.assert(lights0 === lights1 && lights1 === lights2 && lights2 === lights3 && lights0 <= 8, `各时辰灯数恒定：${[lights0, lights1, lights2, lights3]}`);
    },
  },
  // ———————————————— 红外冷迹（X5）
  {
    name: '红外冷迹：照相馆玻璃门外凉了一块（记一条已知线索）', preset: 'r3_start',
    run: async g => {
      await g.call('goto', 'r3', 0.6, 3.0);
      await g.call('vf', true);
      await g.call('lens', 'ir');
      await tryFeedback(g, '照相馆玻璃门外凉了一块。有人跟到这儿，没进去。', 'interact', 'r3.cold_door');
      await g.refresh();
      g.assert(g.snap.clues.includes('照相馆玻璃门外凉了一块。有人跟到这儿，没进去。'), '冷迹记进巡夜本已知线索');
      await g.call('lens', 'normal');
      await g.call('vf', false);
    },
  },
  // ———————————————— 旧照五的错误：不在时间窗里拍
  {
    name: '旧照五：拍早了是空镜（时间窗 6–16 秒）', preset: 'r3_start', extra: DOOR_OPEN,
    run: async g => {
      await g.call('goto', 'r3', 0, -7.6);
      await g.call('vf', true);
      await g.call('replay', 'rp.r3_studio', 'seg.studio_1990');
      await g.call('replaySeek', 2);
      await g.call('aimAt', 'rp.r3_studio');
      const r = await g.call('shoot');
      g.assert(r.hit !== 'pt.old_5', `2 秒时不该拍到旧照五：${JSON.stringify(r)}`);
      await g.call('replayExit');
      await g.refresh();
      g.assert(!g.snap.photos.includes('ph.old_5'), '没有旧照五');
    },
  },
  // ———————————————— 性能：影棚深处/暗房里街景整批不画（M4：暗房朝店门 draw call 249/250）
  {
    name: '影棚深处与暗房朝店门：隔墙后面的整条街不提交绘制，灯数不变', preset: 'r3_start', extra: DEVELOPED,
    run: async g => {
      /**
       * 站到 (x,z)、朝店门看后取 perf。街景的藏/显在 AreaDef.update 里按人的位置切换：锁步下 frame() 只渲染、不走 Game.step，
       * 所以先 wait() 推一点游戏时间让 update 跑到。
       */
      const measure = async (x, z, vf = false) => {
        await g.call('goto', 'r3', x, z);
        await g.call('wait', 0.3);
        if (vf) await g.call('vf', true);
        await g.call('aimAt', 'r3.shop_door');
        await g.call('frame', 3);
        const p = await g.call('perf');
        if (vf) await g.call('vf', false);
        return p;
      };
      // 隔墙（z = -5）北边 2m 是分界：两边各站开 0.4m，画面几乎一样，差的就是那一整条街
      const near = await measure(-1.2, -6.6);
      const deep = await measure(-1.2, -7.4);
      g.assert(near.callsMain - deep.callsMain >= 40, `隔墙北边 2m 以外街景不画：near ${near.callsMain} / deep ${deep.callsMain}`);
      // 暗房朝店门（原来 249/250）：第三人称与取景器都留足余量
      await g.call('goto', 'r3', -1.5, -12.9);
      await g.call('interact', 'r3.lamp_cord');
      const tp = await measure(-1.5, -12.9);
      const vf = await measure(-1.5, -12.9, true);
      g.assert(tp.callsMain < 200 && vf.callsMain < 200, `暗房朝店门 draw call：第三人称 ${tp.callsMain}、取景器 ${vf.callsMain}（预算 250）`);
      // 走回隔墙边：街又画了；灯数从头到尾不变（藏的节点下面没有灯）
      const back = await measure(-1.2, -6.6);
      g.assert(back.callsMain - deep.callsMain >= 40, `回到隔墙边街景又画了：back ${back.callsMain} / deep ${deep.callsMain}`);
      const lights = [near, deep, tp, vf, back].map(p => p.lights);
      g.assert(lights.every(n => n === lights[0]), `灯数恒定：${lights}`);
      console.log(`        callsMain：隔墙边 ${near.callsMain} / 影棚深处 ${deep.callsMain} / 暗房 ${tp.callsMain}（取景器 ${vf.callsMain}）/ 回到隔墙边 ${back.callsMain}；灯 ${lights[0]}`);
    },
  },
];

export async function run() {
  return runRegion({ name: 'r3', phases: [{ preset: 'r3_start', steps: STEPS }], cases: CASES, reloadAt: RELOAD_AT });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  run().then(ok => process.exit(ok ? 0 : 1), err => { console.error(err); process.exit(1); });
}
