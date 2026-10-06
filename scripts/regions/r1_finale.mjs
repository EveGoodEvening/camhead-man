// owner: WP7（M1b 写骨架）→ M2 起归 R1-finale（ARCH §2.12、§15.4）
// R1 终章单区域测试：GDD §11 步骤 12、46–58（P12、P13、P14、南柯），预置 ants、yin_nanke、yin。
//   段 1：ants → 步骤 12（蚁穴收旧照一、二）
//   段 2：yin_nanke → 步骤 46–58（100% 路线，结局 'nanke'）
//   段 3：yin → 步骤 47–58（主线路线，没有南柯段落，结局 'main'）
// 不断言 R1-world 负责的内容（步骤 52 末尾土地的站位、R1-world 的对话文本，ARCH §15.4）；步骤 53 的 interact(r1.crt) 在 R1-world 完成前走占位交互物。
// 用法：npm run build && node scripts/regions/r1_finale.mjs [--until=<n>] [--only=steps|cases] [--case=<子串>]

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { freshState, runRegion } from '../lib/harness.mjs';
import { PRESETS } from '../lib/presets.mjs';
import { confirmWant, pickSteps, tryFeedback } from '../walkthrough.mjs';

export const AREA = 'r1';
export const PRESET_NAMES = ['ants', 'yin', 'yin_nanke'];
for (const p of PRESET_NAMES) if (!(p in PRESETS)) throw new Error(`presets.mjs 没有预置 ${p}`);

/** 支架确认正文里的南柯进度（M4 第 2 轮；GDD §5 P14 第 3 步、§11 步骤 56，判据在 walkthrough.mjs 的 confirmWant）。 */
function assertConfirm(g, text, n) {
  g.assert(typeof text === 'string' && text.includes(confirmWant(n)), `确认对话应显示南柯进度“${confirmWant(n)}”：${JSON.stringify(text)}`);
  if (n === 0) g.assert(!text.includes('蚂蚁') && !text.includes('/6'), `一张没交过的玩家不该在确认对话里看到蚁穴：${JSON.stringify(text)}`);
}

/** 片名大字卡的文字（M4 第 2 轮：南柯的题名改成大字卡；DebugState 没有片名字段，页面里挂一个 MutationObserver 记下来）。 */
async function watchTitles(g) {
  await g.page.evaluate(() => {
    const w = window;
    w.__titleLog = w.__titleLog ?? [];
    if (w.__titleObs) return;
    const el = document.querySelector('.cm-fade-title-main');
    if (!el) return;
    w.__titleObs = new MutationObserver(() => w.__titleLog.push(el.textContent));
    w.__titleObs.observe(el, { childList: true, subtree: true, characterData: true });
  });
}
async function titlesSeen(g) {
  return g.page.evaluate(() => window.__titleLog ?? []);
}

/**
 * §11 步骤 58 的本区版本（M4 第 2 轮改了南柯题名）：walkthrough.mjs 的步骤 58 两种题名都认，这里另断言主结局片名不带书名号、南柯是大字卡。
 * （步骤 56 的新确认正文已由第 2 轮整合同步进 walkthrough.mjs。）
 */
const STEP_OVERRIDES = {
  58: {
    run: async g => {
      g.nanke = (await g.refresh()).flags['r1.nanke'] === true;
      if (g.route === 'main' || g.route === 'full') g.assert(g.nanke === (g.route === 'full'), `路线 ${g.route} 与 r1.nanke=${g.nanke} 不符`);
      await watchTitles(g);
      const r = await g.call('dlg', { maxReal: 300_000 });
      const titles = await titlesSeen(g);
      g.assert(titles.some(t => t.includes('天亮了，叫我')) && !titles.some(t => t.includes('《')), `主结局片名卡应是“天亮了，叫我”（不带书名号）：${JSON.stringify(titles)}`);
      if (!g.nanke) return;
      g.assert(r.at === 'await', `南柯段落应停在变焦等待：${JSON.stringify(r)}`);
      await g.call('zoom', 6);
      await g.refresh();
      g.assert((await titlesSeen(g)).some(t => t.includes('南柯')), `南柯的题名应是大字卡“南柯”：${JSON.stringify(await titlesSeen(g))}`);
      await g.call('dlg', { maxReal: 300_000 });
    },
  },
};

export const PHASES = [
  { label: 'ants · 步骤 12', preset: 'ants', steps: pickSteps(12, 12) },
  { label: 'yin_nanke · 步骤 46–58（南柯）', preset: 'yin_nanke', steps: pickSteps(46, 58, STEP_OVERRIDES), route: 'full' },
  { label: 'yin · 步骤 47–58（主线）', preset: 'yin', steps: pickSteps(47, 58, STEP_OVERRIDES), route: 'main' },
];

/** 读档复验：两个中间步骤之后（52 之后是 ARCH §15.5 的检查点之一）。 */
export const RELOAD_AT = [49, 52];

/** 在门岗桌前（录像机与监控台）的站位。 */
const DESK = [-6.5, 20.9];

/** 装好带子、打开录像机面板（P12 的用例用）。 */
async function openTape(g) {
  await g.call('goto', 'r1', ...DESK);
  await g.call('use', 'r1.vcr', 'it.tape_830');
  await g.check.mode('mode.panel_vcr');
}

export const CASES = [
  // ———————————————— P12 那一夜
  {
    puzzle: 'P12', name: '播放中按快门：糊了', preset: 'yin',
    run: async g => {
      await openTape(g);
      await g.call('vcr', 'seek', '03:14:05');
      await g.call('vcr', 'play');
      await g.call('vf', true);
      await g.call('aimAt', 'pt.tape_face');
      await tryFeedback(g, '糊了。先停住。', 'shoot');
      g.expect.noFlags('r1.tape_watched');
    },
  },
  {
    puzzle: 'P12', name: '红外拍屏幕：一团热', preset: 'yin',
    run: async g => {
      await openTape(g);
      await g.call('vcr', 'seek', '03:14:05');
      await g.call('vcr', 'pause');
      await g.call('vf', true);
      await g.call('lens', 'ir');
      await g.call('aimAt', 'pt.tape_face');
      await tryFeedback(g, '屏幕上只剩一团热。先切回常光（Q）。', 'shoot');
    },
  },
  {
    puzzle: 'P12', name: '暂停在 23:05：一屏袖子', preset: 'yin',
    run: async g => {
      await openTape(g);
      await g.call('vcr', 'seek', '23:05:00');
      await g.call('vcr', 'pause');
      await g.call('vf', true);
      await g.call('aimAt', 'pt.tape_face');
      await tryFeedback(g, '一屏袖子。', 'shoot');
    },
  },
  {
    puzzle: 'P12', name: '没看完带子就去门口倒带', preset: 'yin',
    run: async g => {
      await g.call('goto', 'r1', -3.6, 20.8);
      await g.call('vf', true);
      await tryFeedback(g, '雪花太密了。好像有什么东西不让你看。', 'replay', 'rp.r1_booth', 'seg.booth_2023');
      g.expect.noFlags('r1.heard_voice');
    },
  },
  {
    puzzle: 'P12', name: '在别处使用录像带', preset: 'yin',
    run: async g => {
      await g.call('goto', 'r1', ...DESK);
      await tryFeedback(g, '这儿没有放带子的地方。', 'use', 'r1.desk', 'it.tape_830');
      g.expect.noFlags('r1.tape_in_vcr');
    },
  },
  // ———————————————— P13 看见他
  {
    puzzle: 'P13', name: '画还没摆上就用照片', preset: 'yin',
    extra: { flags: { 'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.heard_voice': true }, photos: ['ph.tape_face'] },
    run: async g => {
      await g.call('goto', 'r1', ...DESK);
      await tryFeedback(g, '先把画摆上。', 'use', 'r1.desk', 'ph.tape_face');
      await g.call('dlg');
      g.expect.noFlags('r1.portrait_complete');
    },
  },
  {
    puzzle: 'P13', name: '用底片第三格补脸：后脑勺', preset: 'yin',
    extra: { flags: { 'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.heard_voice': true, 'r1.portrait_placed': true }, items: [{ id: 'it.portrait', used: true }], photos: ['ph.tape_face'] },
    run: async g => {
      await g.call('goto', 'r1', ...DESK);
      await tryFeedback(g, '这是后脑勺。', 'use', 'r1.desk', 'ph.film3');
      await g.call('dlg');
      g.expect.noFlags('r1.portrait_complete');
    },
  },
  {
    puzzle: 'P13', name: '照妖镜：倍率不是 1× / 频道不对', preset: 'yin',
    extra: {
      flags: { 'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.heard_voice': true, 'r1.portrait_placed': true, 'r1.portrait_complete': true },
      items: [{ id: 'it.portrait', used: true }], photos: ['ph.tape_face'],
    },
    run: async g => {
      await g.call('goto', 'r1', -5.9, 20.9);
      await g.call('interact', 'r1.crt_jack');
      await g.call('interact', 'r1.crt');
      await g.call('console', 2);
      await g.call('vf', true);
      await g.call('aimAt', 'pt.zhou_tunnel');
      await tryFeedback(g, '只拍到了 CH2 的画面。', 'shoot');
      await g.call('vf', false);
      await g.call('console', 1);
      await g.call('vf', true);
      await g.call('zoom', 2);
      await g.call('aimAt', 'pt.zhou_tunnel');
      await tryFeedback(g, '太近了，看不全。', 'shoot');
      g.expect.noFlags('r1.zhou_visible');
    },
  },
  {
    // M4：拍中以后面板视点上不显形（近裁面会切开一大块青影）；关掉监控台才在屋角 CH2 里显形，玩家退到椅子东北边一步（不站在他身上）
    puzzle: 'P13', name: '照妖镜拍中：面板上不贴脸显形；关掉监控台以后过场显形，玩家不与老周重叠', preset: 'yin',
    extra: {
      flags: { 'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.heard_voice': true, 'r1.portrait_placed': true, 'r1.portrait_complete': true },
      items: [{ id: 'it.portrait', used: true }], photos: ['ph.tape_face'],
    },
    run: async g => {
      await g.call('goto', 'r1', -5.9, 20.9);
      await g.call('interact', 'r1.crt_jack');
      await g.call('interact', 'r1.crt');
      await g.call('console', 1);
      await g.call('vf', true);
      await g.call('zoom', 1);
      await g.call('aimAt', 'pt.zhou_tunnel');
      const r = await g.call('shoot');
      g.assert(r && r.photo === 'ph.zhou_tunnel', `应拍到 ph.zhou_tunnel：${JSON.stringify(r)}`);
      let s = await g.refresh();
      g.expect.flags('r1.zhou_visible');
      g.assert(s.cutscene === null && s.mode === 'mode.viewfinder', `面板开着时不播显形过场、仍在叠在面板上的取景器里：${JSON.stringify({ mode: s.mode, cutscene: s.cutscene })}`);
      await g.call('vf', false);
      await g.call('console', 'exit');
      s = await g.refresh();
      g.expect.mode('mode.explore');
      g.assert(s.cutscene === null, `console('exit') 应一直推到显形过场播完：${JSON.stringify(s.cutscene)}`);
      const [x, , z] = s.pos;
      g.assert(Math.hypot(x + 6.5, z - 20.8) > 0.9, `显形后玩家不该站在椅子上的老周身上：${x.toFixed(2)},${z.toFixed(2)}`);
      g.assert(Math.hypot(x - -6.5, z - 21.5) < 2, `玩家离桌子不超过 2m（视频线不拔出）：${x.toFixed(2)},${z.toFixed(2)}`);
    },
  },
  // ———————————————— P14 天亮了，叫我
  {
    puzzle: 'P14', name: '老周显形之前放馄饨', preset: 'yin',
    run: async g => {
      await g.call('goto', 'r1', ...DESK);
      await tryFeedback(g, '椅子是空的。你把碗放下，又端了起来。', 'use', 'r1.desk', 'it.wonton');
      g.expect.noFlags('r1.zhou_fed');
    },
  },
  {
    puzzle: 'P14', name: '吃饭之前交互支架', preset: 'yin',
    run: async g => {
      await g.call('goto', 'r1', -3.8, 20.6);
      await tryFeedback(g, '支架空着。还不是时候。', 'interact', 'r1.bracket');
      g.expect.mode('mode.explore');
    },
  },
  {
    puzzle: 'P14', name: '“再等等”：回到 explore，什么也不变', preset: 'yin',
    extra: {
      flags: {
        'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.heard_voice': true, 'r1.portrait_placed': true, 'r1.portrait_complete': true,
        'r1.zhou_visible': true, 'r1.zhou_fed': true,
      },
      items: [{ id: 'it.portrait', used: true }, { id: 'it.wonton', used: true }], photos: ['ph.tape_face', 'ph.zhou_tunnel'],
    },
    run: async g => {
      await g.call('goto', 'r1', -3.8, 20.6);
      await g.call('interact', 'r1.bracket');
      await g.call('choose', 2);
      await g.call('dlg');
      await g.refresh();
      g.expect.mode('mode.explore');
      g.expect.eq('saves.hold', false);
      g.expect.noFlags('r1.soul_returned');
    },
  },
  {
    puzzle: 'P14', name: '三脚架：曝光时不在叉上 / 定时前按 E 取消', preset: 'yin',
    extra: {
      flags: {
        'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.heard_voice': true, 'r1.portrait_placed': true, 'r1.portrait_complete': true,
        'r1.zhou_visible': true, 'r1.zhou_fed': true,
      },
      items: [{ id: 'it.portrait', used: true }, { id: 'it.wonton', used: true }], photos: ['ph.tape_face', 'ph.zhou_tunnel'],
    },
    run: async g => {
      await g.call('goto', 'r1', -3.8, 20.6);
      await g.call('interact', 'r1.bracket');
      await g.call('choose', 1);
      await g.check.mode('mode.tripod');
      await g.call('tripod', 'start');
      await g.call('wait', 14);           // 身子没挪到叉上
      await g.refresh();
      g.expect.feedback('画面边上多了半截衣袖子。');
      g.expect.noFlags('r1.soul_returned');
      await g.call('dlg');
      await g.call('tripod', 'cancel');
      await g.refresh();
      g.expect.mode('mode.explore');
      g.expect.eq('saves.hold', false);
    },
  },
  {
    puzzle: 'P13', name: '摆了画、还没在门口倒过带就补脸：陆师傅那句，不写 portrait_complete', preset: 'yin',
    extra: { flags: { 'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.portrait_placed': true }, items: [{ id: 'it.portrait', used: true }], photos: ['ph.tape_face'] },
    run: async g => {
      await g.call('goto', 'r1', ...DESK);
      await tryFeedback(g, '你先上门口站站，他还有句话没说完。', 'use', 'r1.desk', 'ph.tape_face');
      await g.call('dlg');
      g.expect.noFlags('r1.portrait_complete');
      await tryFeedback(g, '这是两只手。他那天不想让人看。', 'use', 'r1.desk', 'ph.covered_face');
      await tryFeedback(g, '这不是他的脸。', 'use', 'r1.desk', 'ph.huang_ir');
      g.expect.noFlags('r1.portrait_complete');
    },
  },
  {
    puzzle: 'P13', name: '补脸之前拍照妖镜：最里头那把椅子是空的 / 拍镜子', preset: 'yin',
    extra: { flags: { 'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.heard_voice': true, 'r1.portrait_placed': true }, items: [{ id: 'it.portrait', used: true }], photos: ['ph.tape_face'] },
    run: async g => {
      await g.call('goto', 'r1', -5.9, 20.9);
      await g.call('interact', 'r1.crt_jack');
      await g.call('interact', 'r1.crt');
      await g.call('console', 1);
      await g.call('vf', true);
      await g.call('zoom', 1);
      await g.call('aimAt', 'pt.zhou_tunnel');
      await tryFeedback(g, '镜子套着镜子，一层比一层黑。最里头那把椅子是空的。', 'shoot');
      g.expect.noFlags('r1.zhou_visible');
      await g.call('vf', false);
      await g.call('console', 'exit');
      await g.call('goto', 'r1', -5.8, 19.5);
      await g.call('vf', true);
      await g.call('aimAt', 'r1.mirror');
      await tryFeedback(g, '镜子里只有一台旧摄像头。', 'shoot');
      g.expect.noFlags('r1.zhou_visible');
    },
  },
  {
    puzzle: 'P14', name: '三脚架：曝光时有移动 → 糊了（老周：你动啥？再来。）', preset: 'yin',
    extra: {
      flags: {
        'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.heard_voice': true, 'r1.portrait_placed': true, 'r1.portrait_complete': true,
        'r1.zhou_visible': true, 'r1.zhou_fed': true,
      },
      items: [{ id: 'it.portrait', used: true }, { id: 'it.wonton', used: true }], photos: ['ph.tape_face', 'ph.zhou_tunnel'],
    },
    run: async g => {
      await g.call('goto', 'r1', -3.8, 20.6);
      await g.call('interact', 'r1.bracket');
      await g.call('choose', 1);
      await g.check.mode('mode.tripod');
      await g.call('tripod', 'start');
      await g.call('bodyGoto', -2.37, 22.28);
      await g.call('wait', 10.6);          // 定时走完，进入 3 秒曝光
      await g.call.try('walk', -3.0, 22.6);  // 曝光中挪身子（真实移动输入）
      await g.call('wait', 3);
      await g.refresh();
      g.expect.feedback('糊了。');
      g.expect.noFlags('r1.soul_returned');
      g.assert(!g.snap.photos.includes('ph.final'), '失败不该得到 ph.final');
    },
  },
  {
    puzzle: 'P14', name: '合影成功后、字幕“天亮了。”出现前按快门：天还黑着（不写 called_at_dawn）', preset: 'yin',
    extra: {
      flags: {
        'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.heard_voice': true, 'r1.portrait_placed': true, 'r1.portrait_complete': true,
        'r1.zhou_visible': true, 'r1.zhou_fed': true,
      },
      items: [{ id: 'it.portrait', used: true }, { id: 'it.wonton', used: true }], photos: ['ph.tape_face', 'ph.zhou_tunnel'],
    },
    run: async g => {
      await g.call('goto', 'r1', -3.8, 20.6);
      await g.call('interact', 'r1.bracket');
      await g.call('choose', 1);
      await g.call('tripod', 'start');
      await g.call('bodyGoto', -2.37, 22.28);
      await g.call('wait', 14);
      await g.refresh();
      g.expect.flags('r1.soul_returned');
      g.expect.eq('saves.hold', true);
      // 等到 cs.r1.dawn（合影后的过场 cs.r1.fin_soul 播完）
      for (let i = 0; i < 30; i++) {
        const s = await g.refresh();
        if (s.cutscene?.id === 'cs.r1.dawn') break;
        await g.call('wait', 2);
      }
      g.expect.eq('cutscene.id', 'cs.r1.dawn');
      g.expect.eq('cutscene.awaiting', null);
      // 过场里按快门：early 文本走 toast，结果里带 early；调用的 settle 会把过场推到 await 步骤（字幕“天亮了。”与提示会盖掉 toast），所以直接看返回值
      const r = await g.call.try('shoot');
      g.assert(r.ok && r.result?.early === '天还黑着。', `字幕出现前按快门应得到“天还黑着。”：${JSON.stringify(r)}`);
      await g.refresh();
      g.expect.noFlags('r1.called_at_dawn');
      g.expect.eq('cutscene.id', 'cs.r1.dawn');
    },
  },
  // ———————————————— 时辰差异（GDD §4.6）与灯数恒定、角标不泄题
  {
    name: '丑时：陆师傅已在门岗西北角、老周不在；桌子在场', preset: 'r4_start',
    run: async g => {
      const L = await g.call('listInteractables');
      const st = id => L.find(x => x.id === id);
      g.assert(st('npc.lu')?.present === true, `丑时陆师傅应在门岗：${JSON.stringify(st('npc.lu'))}`);
      g.assert(!st('npc.zhou')?.present, '丑时老周不该在场');
      g.assert(st('r1.desk')?.present === true, '巡夜本拿走以后桌子在场');
      g.assert(st('r1.bracket')?.present === true, '支架在场（前置未满足时灰色）');
      const a = await g.call('aimAt', 'npc.lu');
      const [x, , z] = a.point;
      g.assert(Math.hypot(x + 7.4, z - 19.6) < 0.3, `陆师傅应站在 (-7.4,19.6)，实际 ${x.toFixed(2)},${z.toFixed(2)}`);
      await tryFeedback(g, '椅子是空的。你把碗放下，又端了起来。', 'use', 'r1.desk', 'it.wonton');
      g.expect.noFlags('r1.zhou_fed');
    },
  },
  {
    name: '寅时：补脸后陆师傅离开；显形后老周趴在椅子上，吃完馄饨站到门口；各时辰灯数恒定；角标同组一致', preset: 'yin',
    run: async g => {
      const lights = [];
      const perf = async () => lights.push((await g.call('perf')).lights);
      const present = async id => (await g.call('listInteractables')).find(x => x.id === id)?.present === true;
      const base = { 'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.heard_voice': true, 'r1.portrait_placed': true };
      await perf();
      g.assert(await present('npc.lu'), '寅时补脸前陆师傅在门岗');
      g.assert(!(await present('npc.zhou')), '显形前老周不在场');
      await g.call('setState', { flags: { ...base, 'r1.portrait_complete': true }, area: 'r1', spawn: 'spawn.r1_start' });
      await perf();
      g.assert(!(await present('npc.lu')), '补上脸以后陆师傅化光离开');
      await g.call('setState', { flags: { 'r1.zhou_visible': true }, area: 'r1', spawn: 'spawn.r1_start' });
      await perf();
      g.assert(await present('npc.zhou'), '显形后老周常光可见、可交互');
      let p = (await g.call('aimAt', 'npc.zhou')).point;
      g.assert(Math.hypot(p[0] + 6.5, p[2] - 20.8) < 0.3, `显形后老周在椅子上 (-6.5,20.8)，实际 ${p[0].toFixed(2)},${p[2].toFixed(2)}`);
      await g.call('setState', { flags: { 'r1.zhou_fed': true }, items: [{ id: 'it.wonton', used: true }], area: 'r1', spawn: 'spawn.r1_start' });
      await perf();
      p = (await g.call('aimAt', 'npc.zhou')).point;
      g.assert(Math.hypot(p[0] + 1.9, p[2] - 21.51) < 0.3, `吃完馄饨老周站到门口 (-1.9,21.51)（M4 合影构图），实际 ${p[0].toFixed(2)},${p[2].toFixed(2)}`);
      g.assert(new Set(lights).size === 1, `各时辰/各阶段灯数应恒定：${JSON.stringify(lights)}`);
      const lint = (await g.call('lint')).issues;
      const mine = lint.filter(x => /r1\.(desk|vcr|crt_jack|bracket|anthill)|npc\.(lu|zhou)|dlg\.r1\.(fin_|bracket)|cs\.r1\.(fin_|dawn)|pt\.(tape_face|zhou_tunnel|final)|rd\.portrait_sketch|seg\.booth_2023/.test(x));
      g.assert(mine.length === 0, `lint：${JSON.stringify(mine)}`);
    },
  },
  {
    // M4 第 2 轮：合影判定只看身子离粉笔叉 ≤ 1.5m，老周站的地方离叉 0.9m——他挡人，身子走不进他的魂影里
    puzzle: 'P14', name: '门口的老周挡人：身子走不进他身上', preset: 'yin',
    extra: {
      flags: {
        'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.heard_voice': true, 'r1.portrait_placed': true, 'r1.portrait_complete': true,
        'r1.zhou_visible': true, 'r1.zhou_fed': true,
      },
      items: [{ id: 'it.portrait', used: true }, { id: 'it.wonton', used: true }], photos: ['ph.tape_face', 'ph.zhou_tunnel'],
    },
    run: async g => {
      await g.call('goto', 'r1', -3.2, 21.3);
      await g.call.try('walk', -1.9, 21.51);
      const s = await g.refresh();
      const d = Math.hypot(s.pos[0] + 1.9, s.pos[2] - 21.51);
      g.assert(d >= 0.45, `身子不该走进门口的老周身上（离他 ${d.toFixed(2)}m）：${JSON.stringify(s.pos)}`);
    },
  },
  {
    // M4 第 2 轮：收了 1–5 张时，确认正文说“收了 n 张，还差 6−n 张”（不再是“n/6”）
    puzzle: 'P14', name: '支架确认：蚁穴收了 2 张 → “还差 4 张”', preset: 'yin',
    extra: {
      flags: {
        'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.heard_voice': true, 'r1.portrait_placed': true, 'r1.portrait_complete': true,
        'r1.zhou_visible': true, 'r1.zhou_fed': true, 'r1.ant_old_1': true, 'r1.ant_old_2': true,
      },
      items: [{ id: 'it.portrait', used: true }, { id: 'it.wonton', used: true }], photos: ['ph.tape_face', 'ph.zhou_tunnel', 'ph.old_1', 'ph.old_2'],
    },
    run: async g => {
      await g.call('goto', 'r1', -3.8, 20.6);
      await g.call('interact', 'r1.bracket');
      const s = await g.refresh();
      assertConfirm(g, s.dialogue && s.dialogue.text, 2);
      await g.call('choose', 2);
      await g.call('dlg');
    },
  },
  {
    // M4 第 2 轮：摆上遗像给 1.8 秒的桌面特写（cs.r1.fin_place），播完回到 explore；陆师傅那句字幕照旧
    puzzle: 'P13', name: '摆上遗像：桌面特写过场，回到 explore', preset: 'yin',
    extra: { flags: { 'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.heard_voice': true }, photos: ['ph.tape_face'] },
    run: async g => {
      await g.call('goto', 'r1', -6.5, 20.9);
      await tryFeedback(g, '摆上吧。还差一张脸。', 'use', 'r1.desk', 'it.portrait');
      g.expect.mode('mode.explore');
      g.expect.flags('r1.portrait_placed');
    },
  },
  // ———————————————— H 南柯
  {
    puzzle: 'H', name: '蚁穴：非旧照 / 物品 / 重复', preset: 'ants',
    run: async g => {
      await g.call('goto', 'r1', -2.5, 1.8);
      await tryFeedback(g, '蚂蚁绕开了这张。', 'use', 'r1.anthill', 'ph.tudi');
      await tryFeedback(g, '蚂蚁不搬这个。', 'use', 'r1.anthill', 'it.log');
      await g.call('use', 'r1.anthill', 'ph.old_1');
      await tryFeedback(g, '这张它们收过了。', 'use', 'r1.anthill', 'ph.old_1');
      await g.refresh();
      g.expect.flags('r1.ant_old_1');
      g.expect.noFlags('r1.ant_old_2', 'r1.nanke');
      g.expect.has('ph.old_1');
    },
  },
];

// M4 第 2 轮：门口倒带时老周在不在画里（GDD §11 步骤 50 的站位、从院里走来的站位；调试 API 的 replay() 先转向残影点，
// 与真人对着雪花按 R 一样，之后引擎按片段 focus 转向）。页面里用 three 的 __THREE_DEVTOOLS__ 钩子拿场景，
// 把 ghost.zhou_2023 的头投影到取景器相机上，要求落在 4:3 画框内（16:9 视口的 |x| ≤ 0.75）。
// 要在页面加载前挂钩子：本例重载页面，所以放在最后。
CASES.push({
  puzzle: 'P12', name: '门口倒带：“伙计……替我看着点。”响起时老周在取景器画框里（两个站位）', preset: 'yin',
  extra: { flags: { 'r1.tape_in_vcr': true, 'r1.tape_watched': true }, photos: ['ph.tape_face'] },
  run: async g => {
    await g.page.addInitScript(() => {
      const et = new EventTarget();
      window.__THREE_DEVTOOLS__ = et;
      window.__scenes = [];
      et.addEventListener('observe', e => {
        const d = e.detail;
        if (d && d.isScene) window.__scenes.push(d);
      });
    });
    await g.goto('debug=1&test=1&lockstep=1&quality=low');
    await freshState(g, 'yin', { flags: { 'r1.tape_in_vcr': true, 'r1.tape_watched': true }, photos: ['ph.tape_face'] });
    for (const [x, z] of [[-3.6, 20.8], [-2.6, 21.0]]) {
      await g.call('goto', 'r1', x, z);
      await g.call('vf', true);
      await g.call('replay', 'rp.r1_booth', 'seg.booth_2023');
      await g.call('replaySeek', 11);
      await g.call('wait', 0.6);
      await g.page.evaluate(() => {
        const sc = window.__scenes.find(s => s.getObjectByName('ghost.zhou_2023'));
        if (!sc || sc.__finHook) return;
        const orig = sc.onBeforeRender;
        sc.onBeforeRender = function (r, s, cam, rt) {
          if (cam && (cam.name === 'cam.fp' || cam.name === 'cam.tp')) window.__mainCam = cam;
          return orig.call(this, r, s, cam, rt);
        };
        sc.__finHook = true;
      });
      await g.call('frame', 2);
      const p = await g.page.evaluate(() => {
        const sc = window.__scenes.find(s => s.getObjectByName('ghost.zhou_2023'));
        const cam = window.__mainCam;
        if (!sc || !cam) return null;
        const ghost = sc.getObjectByName('ghost.zhou_2023');
        const head = ghost.getObjectByName('head') ?? ghost;
        const v = head.getWorldPosition(new head.position.constructor());
        const w = { x: v.x, y: v.y, z: v.z };
        v.project(cam);
        return { ndc: [v.x, v.y, v.z], world: w, cam: cam.name };
      });
      g.assert(p !== null, '取不到场景或取景器相机');
      const [nx, ny, nz] = p.ndc;
      g.assert(nz < 1 && Math.abs(nx) <= 0.75 && Math.abs(ny) <= 1, `站在 (${x},${z}) 倒带，t≈11.6s 老周的头应在取景器 4:3 画框内：${JSON.stringify(p)}`);
      await g.call('replaySeek', 24);
      await g.call('replayExit');
      await g.call('vf', false);
    }
  },
});

export async function run() {
  return runRegion({ name: 'r1_finale', phases: PHASES, cases: CASES, reloadAt: RELOAD_AT });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  run().then(ok => process.exit(ok ? 0 : 1), err => { console.error(err); process.exit(1); });
}
