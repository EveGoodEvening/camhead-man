// owner: WP7（M1b 写骨架）→ M2 起归 R4（ARCH §2.12、§15.4）
// R4 单区域测试：GDD §11 步骤 38–45（P9、P10、P11、旧照六），预置 r4_start（起点在 r1，步骤 38 的 goto 走西口下通道）。
// 另有：每个谜题 ≥ 2 条错误反馈与“前置未满足不写 flag”、时辰差异（子时空通道、丑时门童、寅时照常营业）、灯数恒定、
// 角标不泄题（lint 与 listInteractables）、开市后摊桌挡人的 walk()、X5 冷迹、读档复验。
// 用法：npm run build && node scripts/regions/r4.mjs [--main] [--until=<n>] [--only=steps|cases] [--case=<子串>]
//       并行时：CAMERA_DIST=<构建目录> CAMERA_PORT=<端口> node scripts/regions/r4.mjs

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readDocs, reloadCheck, runRegion } from '../lib/harness.mjs';
import { PRESETS } from '../lib/presets.mjs';
import { pickSteps, tryFeedback } from '../walkthrough.mjs';

export const AREA = 'r4';
export const PRESET_NAMES = ['r2_start', 'r3_start', 'r4_start', 'yin'];
for (const p of PRESET_NAMES) if (!(p in PRESETS)) throw new Error(`presets.mjs 没有预置 ${p}`);

/**
 * 步骤 43 的本区版本（M4 第 2 轮）：dlg.r4.huang_normal 拆成旁白“（他半天没出声，尾巴垂下去）”+ 黄三爷的台词两行；
 * walkthrough.mjs 只查第一行的“半天没出声”，这里另断言两行的说话人与正文（旁白不挂名字、台词不带括注）。
 */
async function step43(g) {
  await g.call('aimAt', 'pt.huang_normal');
  const r = await g.call('shoot');
  g.assert(r && r.photo === 'ph.huang_normal', `shoot() 应得到 ph.huang_normal，实际 ${JSON.stringify(r)}`);
  await tryFeedback(g, '半天没出声', 'show', 'npc.huang', 'ph.huang_normal');
  g.assert(g.snap.dialogue && g.snap.dialogue.who === '' && g.snap.dialogue.text === '（他半天没出声，尾巴垂下去）', `第一行应是单独的旁白：${JSON.stringify(g.snap.dialogue)}`);
  await nextLine(g, 'npc.huang');
  g.assert(g.snap.dialogue && g.snap.dialogue.text === '……你瞅见的是这个。你再好好瞅瞅。', `旁白之后是黄三爷的台词（不带括注）：${JSON.stringify(g.snap.dialogue)}`);
  await g.call('dlg');
}

/** 对话按一下空格，等到说话人变成 who（锁步下按键在下一帧才生效）。 */
async function nextLine(g, who) {
  await g.page.keyboard.press('Space');
  for (let i = 0; i < 20; i++) {
    await g.call('frame', 1);
    const st = await g.refresh();
    if (st.dialogue && st.dialogue.who === who) return;
  }
  g.assert(false, `按空格后说话人应变成 ${who}：${JSON.stringify(g.snap.dialogue)}`);
}

export const STEPS = pickSteps(38, 45, { 43: { run: step43 } });
/** 读档复验点：下一步以 goto 开头、且不依赖取景器仍开着（读档后模式复位为 explore）。 */
export const RELOAD_AT = [38, 45];

const MARKET = { flags: { 'r4.ghost_market_open': true }, items: [{ id: 'it.money', used: true }] };
const FOUND = { flags: { ...MARKET.flags, 'r4.spotted_huang': true, 'r4.found_huang': true }, items: MARKET.items };
const ASKED = { flags: { ...FOUND.flags, 'r4.asked_tape': true }, items: FOUND.items };
const ADMITS = { flags: { ...ASKED.flags, 'r4.huang_admits': true }, items: FOUND.items, photos: ['ph.huang_hides'] };

/** 摊前按 R 的几个站位（GDD P10 的 (3.8,0.2)，及残影点 2.5m 内偏西、偏东、再往前的几处）。 */
const STALL_SPOTS = [[3.8, 0.2], [3, 0], [2.2, 0.3], [4.8, 0.6]];
/** 其中离樟木箱 2.3m 以外的（引擎把转向俯仰夹在 −15° 也够）与贴着箱子的（要引擎放开俯仰）。 */
const STALL_SPOTS_FAR = [[3, 0], [2.2, 0.3]];
const STALL_SPOTS_NEAR = [[3.8, 0.2], [4.8, 0.6]];

/** P10：在摊前各站位按 R，等转向走完（TURN_SEC 0.4），不动视角跳到第 12 秒按快门，应得到 ph.huang_hides。 */
async function noMouseHides(g, spots) {
  for (const [x, z] of spots) {
    await g.call('goto', 'r4', x, z);
    await g.call('vf', true);
    await g.call('replay', 'rp.r4_stall', 'seg.stall_2023');
    await g.call('wait', 0.6);
    await g.call('replaySeek', 12);
    const st = await g.refresh();
    const r = await g.call('shoot');
    g.assert(r && r.photo === 'ph.huang_hides', `(${x},${z}) 进段后原样按快门应得到 ph.huang_hides（yaw ${st.yaw}、pitch ${st.pitch}）：${JSON.stringify(r)}`);
    await g.call('replayExit');
  }
}

/** 取景器画面中心（镜头在头前 0.18m）到地面点 p=[x,z] 的水平偏角（度，右正左负无所谓，只看绝对值）。yaw 0 = −z、90 = +x。 */
function yawOff(st, p) {
  const r = (st.yaw * Math.PI) / 180;
  const ex = st.pos[0] + Math.sin(r) * 0.18, ez = st.pos[2] - Math.cos(r) * 0.18;
  const want = (Math.atan2(p[0] - ex, -(p[1] - ez)) * 180) / Math.PI;
  return ((want - st.yaw + 540) % 360) - 180;
}

const STALL_IDS = ['r4.stall_n1', 'r4.stall_n2', 'r4.stall_n3', 'r4.stall_n4', 'r4.stall_n5', 'r4.stall_s1', 'r4.stall_s2', 'r4.stall_s4', 'r4.stall_s5'];

/** listInteractables() 里某个 id 的状态（没有就 undefined）。 */
async function status(g, id) {
  const list = await g.call('listInteractables');
  return list.find(s => s.id === id);
}
const present = s => !!s && s.present !== false;

/** 本区灯数（perf().lights）：各时辰必须相同（ARCH §13.3、§15.4）。 */
const LIGHTS = 8;
async function checkLights(g, tag) {
  const p = await g.call('perf');
  g.assert(p.lights === LIGHTS, `${tag}：灯数应为 ${LIGHTS}，实际 ${p.lights}`);
}

/**
 * 空闲闪烁（GDD §3.12）：120 秒没有 flag 变化、也没有交互 → 当前谜题 target 的角标闪一次（0.6 秒）。
 * 先快进 119 秒，再每 0.2 秒看一次 listInteractables 的 blink，返回正在闪的 id。
 */
async function idleBlink(g) {
  for (let left = 119; left > 0; left -= 30) await g.call('wait', Math.min(30, left));
  for (let i = 0; i < 25; i++) {
    await g.call('wait', 0.2);
    const on = (await g.call('listInteractables')).filter(s => s.blink > 0).map(s => s.id);
    if (on.length > 0) return on;
  }
  return [];
}

/** H 键：当前谜题与第 1 级提示（GDD §5 三级提示逐字；P9 第 1 级 M4 补了地点）。 */
async function checkHint(g, puzzle, text) {
  const h = await g.call('hint');
  g.assert(h.puzzle === puzzle && h.level === 1 && h.text === text, `提示应为 ${puzzle} 第 1 级“${text}”：${JSON.stringify(h)}`);
}

export const CASES = [
  // ———————————————— 时辰差异（GDD §4.6）
  {
    name: '子时：通道空着，没有门童、摊位、规矩牌；灯管在闪', preset: 'r3_start',
    run: async g => {
      // r3_start：wang_done 为真、saw_true_form 为假 → 仍是子时
      await g.call('goto', 'r4', -16, 0);
      const st = await g.state();
      g.assert(st.shichen === 'zi', `应为子时，实际 ${st.shichen}`);
      for (const id of ['npc.boy', 'npc.huang', 'r4.rules_board', 'r4.stall_n1', 'r4.camphor_chest', 'r4.old_book']) {
        g.assert(!present(await status(g, id)), `子时不该有 ${id}`);
      }
      g.assert(present(await status(g, 'r4.kiosk')), '报刊亭一直在');
      await checkLights(g, '子时');
      // 前置未满足：门童不在，买路钱给不出去，不写 flag
      const r = await g.call.try('use', 'npc.boy', 'it.money');
      g.assert(!r.ok, `子时对门童用钱应失败：${JSON.stringify(r)}`);
      await g.check.noFlags('r4.ghost_market_open');
    },
  },
  {
    name: '丑时（未开市）：门童在入口、规矩牌挂着，还没有摊位', preset: 'r4_start',
    run: async g => {
      await g.call('goto', 'r4', -16, 0);
      const st = await g.state();
      g.assert(st.shichen === 'chou', `应为丑时，实际 ${st.shichen}`);
      g.assert(present(await status(g, 'npc.boy')), '丑时门童应在入口');
      g.assert(present(await status(g, 'r4.rules_board')), '丑时规矩牌应挂出来');
      for (const id of ['npc.huang', 'r4.stall_s2', 'r4.camphor_chest']) g.assert(!present(await status(g, id)), `付钱前不该有 ${id}`);
      await checkLights(g, '丑时');
      // 规矩牌：在文档阅读器里读鬼市规矩原文（doc.market_rules；M3：E.doc，docs/requests/r4.md #1）
      await readDocs(g, 'r4.rules_board', [['doc.market_rules', '鬼市　丑时开　卯时散　过路留钱']]);
      // 付钱前找门童说话
      await tryFeedback(g, '鬼市丑时开，过路留下钱。', 'interact', 'npc.boy');
      await g.call('dlg');
      // H：当前谜题是 P9，第 1 级提示逐字照 GDD
      await checkHint(g, 'pz.p09_ghost_market', '西头人民路地下通道，鬼市开张了，规矩在灯笼上。过路要留钱，王家婶子临走塞给你啥了？');
    },
  },
  {
    name: '寅时：鬼市照常营业，门童、摊位、黄三爷都在', preset: 'yin',
    run: async g => {
      await g.call('goto', 'r4', -7, 0);
      const st = await g.state();
      g.assert(st.shichen === 'yin', `应为寅时，实际 ${st.shichen}`);
      g.assert(present(await status(g, 'npc.boy')), '寅时门童仍在');
      const h = await status(g, 'npc.huang');
      g.assert(present(h) && h.label === '黄三爷', `寅时黄三爷在摊后、角标“黄三爷”：${JSON.stringify(h)}`);
      g.assert(present(await status(g, 'r4.stall_n2')), '寅时摊位照常');
      await checkLights(g, '寅时');
    },
  },
  // ———————————————— P9 鬼市
  {
    puzzle: 'P9', name: '对门童出示别的东西（两样）不开市', preset: 'r4_start',
    run: async g => {
      await g.call('goto', 'r4', -16, 0);
      await tryFeedback(g, '这不是钱。', 'show', 'npc.boy', 'it.glasses');
      await g.call('dlg');
      await tryFeedback(g, '这不是钱。', 'show', 'npc.boy', 'ph.tudi');
      await g.call('dlg');
      await g.check.noFlags('r4.ghost_market_open');
      const money = g.snap.items.find(i => i.id === 'it.money');
      g.assert(money && money.used === false, `买路钱应原样退回（未用）：${JSON.stringify(money)}`);
    },
  },
  {
    puzzle: 'P9', name: '交互别的纸人；看破前黄三爷的角标与交互流程与纸人相同', preset: 'r4_start', extra: MARKET,
    run: async g => {
      await g.call('goto', 'r4', -3, 0.3);
      await tryFeedback(g, '纸人没有回答。它的嘴是画上去的。', 'interact', 'r4.stall_s2');
      await g.call('goto', 'r4', 0, -0.3);
      await tryFeedback(g, '纸人没有回答。它的嘴是画上去的。', 'interact', 'r4.stall_n3');
      await g.call('goto', 'r4', 3, 0.3);
      await tryFeedback(g, '纸人没有回答。它的嘴是画上去的。', 'interact', 'npc.huang');
      g.expect.noFlags('r4.spotted_huang', 'r4.found_huang');
      const list = await g.call('listInteractables');
      const group = list.filter(s => s.present && (STALL_IDS.includes(s.id) || s.id === 'npc.huang'));
      g.assert(group.length === 10, `十个纸人摊主都应在场：${group.map(s => s.id).join(',')}`);
      for (const s of group) g.assert(s.label === '纸人' && s.hasOffers === false, `纸人组角标/出示应一致：${JSON.stringify(s)}`);
      const lint = await g.call('lint');
      const bad = lint.issues.filter(s => s.includes('纸人摊主') || s.startsWith('r4'));
      g.assert(bad.length === 0, `纸人组角标/流程应一致、r4 数据无问题：${JSON.stringify(bad)}`);
    },
  },
  {
    puzzle: 'P9', name: '倍率不够时 rd.huang_breath 不冒提示；4× 才读得出', preset: 'r4_start', extra: MARKET,
    run: async g => {
      await g.call('goto', 'r4', 3, 0.3);
      await g.call('vf', true);
      for (const z of [1, 2, 3]) {
        await g.call('zoom', z);
        const r = await g.call('aimAt', 'rd.huang_breath');
        g.assert(r.reading === null && r.readHint === null, `${z}× 时不该有读字或提示：${JSON.stringify(r)}`);
      }
      await g.check.noFlags('r4.spotted_huang');
      // 同一倍率下别的纸人脸上什么也没有（读字目标只跟着 S3 的嘴）
      await g.call('zoom', 4);
      const other = await g.call('aimAt', 'r4.stall_s2');
      g.assert(other.reading === null && other.readHint === null, `看别的纸人不该有读字：${JSON.stringify(other)}`);
      await g.call('zoom', 1);
    },
  },
  {
    puzzle: 'P9', name: '红外里对他按 E 也算看破（不补设 spotted）', preset: 'r4_start', extra: MARKET,
    run: async g => {
      await g.call('goto', 'r4', 3, 0.3);
      await g.call('vf', true);
      await g.call('lens', 'ir');
      // 揭面具的旁白是对话第一行（在对话框里，不再被对话框盖住，M4），按空格才是他开口
      await tryFeedback(g, '你伸手揭下那张潮乎乎的纸面具。', 'interact', 'npc.huang');
      g.assert(g.snap.dialogue && g.snap.dialogue.who === '', `揭面具的第一行应是旁白：${JSON.stringify(g.snap.dialogue)}`);
      await g.page.keyboard.press('Space');
      for (let i = 0; i < 20; i++) {
        await g.call('frame', 1);
        const st = await g.refresh();
        if (st.dialogue && st.dialogue.who === 'npc.huang') break;
      }
      g.assert(g.snap.dialogue && g.snap.dialogue.who === 'npc.huang' && g.snap.dialogue.text.startsWith('嘿，让你瞅着了。'), `旁白之后是黄三爷开口：${JSON.stringify(g.snap.dialogue)}`);
      await g.call('dlg');
      await g.check.flags('r4.found_huang');
      g.expect.noFlags('r4.spotted_huang');
      await g.call('lens', 'normal');
      const h = await status(g, 'npc.huang');
      g.assert(h && h.label === '黄三爷', `揭面具后角标应改叫“黄三爷”：${JSON.stringify(h)}`);
    },
  },
  {
    puzzle: 'P9', name: '付过钱再找门童：规矩在灯笼上', preset: 'r4_start', extra: MARKET,
    run: async g => {
      await g.call('goto', 'r4', -16, 0);
      await tryFeedback(g, '规矩在灯笼上，自己瞅。', 'interact', 'npc.boy');
      await g.call('dlg');
    },
  },
  {
    puzzle: 'P9', name: '空闲闪烁不点破 S3：开市前闪门童，开市后闪规矩牌，看出喘气后才闪黄三爷', preset: 'r4_start',
    run: async g => {
      await g.call('goto', 'r4', -14.5, 0.3);
      let on = await idleBlink(g);
      g.assert(on.length === 1 && on[0] === 'npc.boy', `开市前空闲闪烁应只闪门童：${JSON.stringify(on)}`);
      await g.call('setState', { area: 'r4', ...MARKET });
      await g.call('goto', 'r4', 3, 0.3);
      on = await idleBlink(g);
      g.assert(on.length === 1 && on[0] === 'r4.rules_board', `开市后、看出喘气前只闪规矩牌，十个纸人都不闪：${JSON.stringify(on)}`);
      await g.call('setState', { area: 'r4', flags: { 'r4.spotted_huang': true } });
      await g.call('goto', 'r4', 3, 0.3);
      on = await idleBlink(g);
      g.assert(on.length === 1 && on[0] === 'npc.huang', `读到面具在喘气之后闪黄三爷：${JSON.stringify(on)}`);
    },
  },
  // ———————————————— P10 樟木箱
  {
    puzzle: 'P10', name: '出示其他照片 / 第 10 秒前拍', preset: 'r4_start', extra: FOUND,
    run: async g => {
      await g.call('goto', 'r4', 3.8, 0.2);
      await checkHint(g, 'pz.p10_camphor_chest', '嘴能撒谎，地方不会。');
      await g.call('vf', true);
      await tryFeedback(g, '这啥？三爷不认得。', 'show', 'npc.huang', 'ph.tudi');
      await g.call('dlg');
      await tryFeedback(g, '这啥？三爷不认得。', 'show', 'npc.huang', 'ph.covered_face');
      await g.call('dlg');
      await g.call('replay', 'rp.r4_stall', 'seg.stall_2023');
      await g.call('replaySeek', 5);
      await g.call('aimAt', 'pt.huang_hides');
      await tryFeedback(g, '还没藏呢。', 'shoot');
      await g.call('replayExit');
      await g.check.noFlags('r4.huang_admits');
    },
  },
  {
    puzzle: 'P10', name: '前置未满足：认账前红外照拍得到（不是“颜色不对”），出示了也不给带子', preset: 'r4_start', extra: FOUND,
    run: async g => {
      // M4 第 2 轮：pt.huang_ir 揭面具后就能拍（原先要等认账，认账前红外里拍他得空镜“颜色不对”，把人带偏）
      await g.call('goto', 'r4', 3, 0.6);
      await g.call('vf', true);
      await g.call('lens', 'ir');
      await g.call('aimAt', 'pt.huang_ir');
      const r = await g.call('shoot');
      g.assert(r && r.photo === 'ph.huang_ir', `认账前红外里拍黄三爷应得到 ph.huang_ir：${JSON.stringify(r)}`);
      await g.call('lens', 'normal');
      await g.call('vf', false);
      await tryFeedback(g, '急啥？账还没算清呢。', 'show', 'npc.huang', 'ph.huang_ir');
      g.assert((g.snap.subtitle ?? '').includes('急啥？账还没算清呢。') && !g.snap.dialogue, `应是黄三爷带名字的一句字幕，不开对话：${JSON.stringify({ sub: g.snap.subtitle, dlg: g.snap.dialogue })}`);
      await g.call('dlg');
      await g.check.noFlags('r4.got_tape', 'r4.huang_admits');
      g.expect.noFlags('r4.asked_tape');
    },
  },
  {
    puzzle: 'P10', name: '在摊前按 R：镜头自己转向樟木箱（影子与箱子都在画框横向中央 60% 里）', preset: 'r4_start', extra: ASKED,
    run: async g => {
      // M4 第 2 轮：seg.stall_2023 的 focus（原先转到人影平均点，朝通道西侧 yaw≈244°，箱子在身后左边）。
      // debug replay() 先转向残影点再按 R，与玩家对着旋涡按 R 相同；等 0.6 秒让转向走完（TURN_SEC 0.4）
      for (const [x, z] of STALL_SPOTS) {
        await g.call('goto', 'r4', x, z);
        await g.call('vf', true);
        await g.call('replay', 'rp.r4_stall', 'seg.stall_2023');
        await g.call('wait', 0.6);
        const st = await g.refresh();
        for (const [what, p] of [['樟木箱', [4.3, 2.4]], ['黄三爷蹲下塞带子的地方', [3.6, 2.35]]]) {
          const d = yawOff(st, p);
          g.assert(Math.abs(d) <= 20, `(${x},${z}) 进段后${what}应在画框横向中央 60% 以内（差 ${d.toFixed(1)}°，yaw ${st.yaw}）`);
        }
        await g.call('replayExit');
      }
    },
  },
  {
    // 离箱子 2.3m 以外按 R：影子（上身）与箱盖都在画框中央 60% 里（pt.huang_hides 的锚点，M4 第 2 轮）
    puzzle: 'P10', name: '在摊前偏西按 R 不动鼠标，第 12 秒直接按快门就是 ph.huang_hides', preset: 'r4_start', extra: ASKED,
    run: async g => noMouseHides(g, STALL_SPOTS_FAR),
  },
  {
    // 箱子在地上，从 (3.8,0.2) 看要俯到 −25° 左右才居中。引擎的回放转向原来一律把俯仰夹到 ≥ −15°，箱盖落在画框下沿（ndc.y ≈ −0.71，
    // 判定框 0.6），按快门得空镜“没对准”；M4 第 2 轮整合改成写了 focus 的片段俯仰下限 −40°（src/game/replay.ts TURN_MIN_PITCH_FOCUS）。
    puzzle: 'P10', name: '贴着箱子（GDD 的 (3.8,0.2)）按 R 不动鼠标，第 12 秒直接按快门就是 ph.huang_hides', preset: 'r4_start', extra: ASKED,
    run: async g => noMouseHides(g, STALL_SPOTS_NEAR),
  },
  {
    // 旧照六（M4 第 2 轮）：seg.mid_1997 的 focus 对着红绸后头的街坊，pt.old_6 的锚点在人头高度；
    // 从西边过来（玩家走的方向）或贴着人堆按 R，不动鼠标，第 9 秒按快门就是 ph.old_6
    name: '旧照六：在残影点周围按 R 不动鼠标，第 9 秒直接按快门就是 ph.old_6', preset: 'r4_start',
    run: async g => {
      for (const [x, z] of [[-7, 0], [-8, -0.6], [-6.5, 1], [-5, 0.4]]) {
        await g.call('goto', 'r4', x, z);
        await g.call('vf', true);
        await g.call('replay', 'rp.r4_mid', 'seg.mid_1997');
        await g.call('wait', 0.6);
        await g.call('replaySeek', 9);
        const st = await g.refresh();
        const r = await g.call('shoot');
        g.assert(r && r.photo === 'ph.old_6', `(${x},${z}) 进段后原样按快门应得到 ph.old_6（yaw ${st.yaw}、pitch ${st.pitch}）：${JSON.stringify(r)}`);
        await g.call('replayExit');
      }
    },
  },
  {
    puzzle: 'P10', name: '没问过带子直接出示藏带子照：先补设 asked_tape 再认账', preset: 'r4_start', extra: { ...FOUND, photos: ['ph.huang_hides'] },
    run: async g => {
      await g.call('goto', 'r4', 3, 0.6);
      await g.call('show', 'npc.huang', 'ph.huang_hides');
      await g.call('dlg');
      await g.check.flags('r4.asked_tape', 'r4.huang_admits');
    },
  },
  // ———————————————— P11 讨封
  {
    puzzle: 'P11', name: '出示藏带子照 / 本相 / 其他', preset: 'r4_start', extra: ADMITS,
    run: async g => {
      await g.call('goto', 'r4', 3, 0.6);
      await checkHint(g, 'pz.p11_seek_title', '讨封这事，你说他像啥，他就是啥。说他像神，折他的寿；说他像畜生，一百年白修。');
      await tryFeedback(g, '那是早年间的三爷，别提。', 'show', 'npc.huang', 'ph.huang_hides');
      await g.call('dlg');
      await tryFeedback(g, '那是你，不是我。', 'show', 'npc.huang', 'ph.true_form');
      await g.call('dlg');
      await tryFeedback(g, '这啥？', 'show', 'npc.huang', 'it.glasses');
      await g.call('dlg');
      await g.check.noFlags('r4.got_tape');
    },
  },
  {
    puzzle: 'P11', name: '选“摇头”：只影响台词，照样拿到带子、进寅时', preset: 'r4_start', extra: { ...ADMITS, photos: ['ph.huang_hides', 'ph.huang_ir'] },
    run: async g => {
      await g.call('goto', 'r4', 3, 0.6);
      await g.call('show', 'npc.huang', 'ph.huang_ir');
      const d = await g.call('dlg');
      g.assert(d.at === 'choice' && d.options.length === 2, `讨封的点头/摇头是强制二选一：${JSON.stringify(d)}`);
      g.assert(d.options.every(o => o.startsWith('〔') && o.endsWith('〕')), `选项用〔〕标出（GDD §8）：${JSON.stringify(d.options)}`);
      await g.call('choose', 2);
      await g.refresh();
      g.expect.feedback('你像。三爷封的');
      await g.call('dlg');
      await g.refresh();
      g.expect.flags('r4.got_tape');
      g.expect.has('it.tape_830');
      g.expect.eq('shichen', 'yin');
      g.expect.eq('saves.yin', true);
      // 拿到带子之后再找他
      await tryFeedback(g, '天快亮了，三爷也该收摊了。', 'interact', 'npc.huang');
      await g.call('dlg');
    },
  },
  {
    name: '旧照给黄三爷：他不收，指给树底下那帮小的', preset: 'r4_start', extra: { ...FOUND, photos: ['ph.old_1'] },
    run: async g => {
      await g.call('goto', 'r4', 3, 0.6);
      await tryFeedback(g, '你那一兜子旧照片，三爷不收，树底下那帮小的收。', 'show', 'npc.huang', 'ph.old_1');
      await g.call('dlg');
    },
  },
  // ———————————————— 布景交互、X5 冷迹
  {
    name: '旧书残页、樟木箱、报刊亭', preset: 'r4_start', extra: FOUND,
    run: async g => {
      await g.call('goto', 'r4', 3.2, -0.3);
      await readDocs(g, 'r4.old_book', [['doc.old_book', '北地多黄鼬']]);
      await g.call('goto', 'r4', 4.4, 0.3);
      await tryFeedback(g, '樟木箱', 'interact', 'r4.camphor_chest');
      await g.call('goto', 'r4', -10, -0.4);
      await tryFeedback(g, '报刊亭关着', 'interact', 'r4.kiosk');
    },
  },
  {
    name: 'X5 红外冷迹：楼梯口凉了一块（常光看不见）', preset: 'r4_start',
    run: async g => {
      await g.call('goto', 'r4', -16.2, -0.4);
      await g.call('vf', true);
      const r0 = await g.call.try('interact', 'r4.cold_stairs');
      g.assert(!r0.ok, `常光下冷迹不该能交互：${JSON.stringify(r0)}`);
      await g.call('lens', 'ir');
      await tryFeedback(g, '楼梯口凉了一块。到这儿，他就不往下走了。', 'interact', 'r4.cold_stairs');
      await g.refresh();
      g.assert(g.snap.clues.some(c => c.includes('楼梯口凉了一块')), `巡夜本已知线索应多一行：${JSON.stringify(g.snap.clues)}`);
      await g.call('lens', 'normal');
    },
  },
  // ———————————————— 读档复验（ARCH §15.4：本区任意两个中间步骤后 reload()，状态一致、可以接着推进）
  {
    name: '读档复验：揭面具之后、认账之后各 reload 一次，接着推进到拿到录像带', preset: 'r4_start', extra: FOUND,
    run: async g => {
      // 揭面具之后（步骤 39 的状态）：读档回到本区出生点，走回摊前接着问带子
      await g.call('goto', 'r4', 3, 0.6);
      const s1 = await reloadCheck(g, '（揭面具之后）');
      g.assert(s1.area === 'r4', `读档后应在 r4：${s1.area}`);
      let h = await status(g, 'npc.huang');
      g.assert(present(h) && h.label === '黄三爷', `读档后黄三爷仍在摊后、已揭面具：${JSON.stringify(h)}`);
      await checkLights(g, '读档后');
      await g.call('goto', 'r4', 3, 0.6);
      await g.call('show', 'npc.huang', 'ph.true_form');
      await g.call('dlg');
      await g.check.flags('r4.asked_tape');
      // 认账之后（步骤 42 的状态）：再读一次档，接着讨封
      await g.call('setState', { flags: { 'r4.huang_admits': true }, photos: ['ph.huang_hides'] });
      await reloadCheck(g, '（认账之后）');
      h = await status(g, 'npc.huang');
      g.assert(present(h) && h.label === '黄三爷', `读档后黄三爷仍在：${JSON.stringify(h)}`);
      await g.call('goto', 'r4', 3, 0.6);
      await g.call('vf', true);
      await g.call('lens', 'ir');
      await g.call('aimAt', 'pt.huang_ir');
      const r = await g.call('shoot');
      g.assert(r.photo === 'ph.huang_ir', `读档后红外照应得到 ph.huang_ir：${JSON.stringify(r)}`);
      await g.call('lens', 'normal');
      await g.call('show', 'npc.huang', 'ph.huang_ir');
      await g.call('dlg');
      await g.call('choose', 1);
      await g.call('dlg');
      await g.check.flags('r4.got_tape');
      g.expect.has('it.tape_830');
    },
  },
  // ———————————————— 挡人的门槛：开市前摊位那儿是空地，开市后被摊桌挡住
  {
    name: '门槛：开市前走得到南墙根，开市后被摊桌挡住', preset: 'r4_start',
    run: async g => {
      await g.call('goto', 'r4', 6, 0.2);
      const r0 = await g.call.try('walk', 6, 2.3);
      g.assert(r0.ok, `开市前应能走到南墙根：${JSON.stringify(r0)}`);
      await g.call('goto', 'r4', -16, 0);
      await g.call('use', 'npc.boy', 'it.money');
      await g.call('dlg');
      await g.check.flags('r4.ghost_market_open');
      await g.call('goto', 'r4', 6, 0.2);
      const r1 = await g.call.try('walk', 6, 2.3);
      g.assert(!r1.ok && r1.reason === 'blocked', `开市后摊桌应挡住：${JSON.stringify(r1)}`);
    },
  },
];

export async function run() {
  return runRegion({ name: 'r4', phases: [{ preset: 'r4_start', steps: STEPS }], cases: CASES, reloadAt: RELOAD_AT });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  run().then(ok => process.exit(ok ? 0 : 1), err => { console.error(err); process.exit(1); });
}
