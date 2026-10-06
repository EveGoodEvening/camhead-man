// owner: WP7（M1b 写骨架）→ M2 起归 R2（ARCH §2.12、§15.4）
// R2 单区域测试（覆盖 r2 与 r2_502）：GDD §11 步骤 13–26（P3、P4、P5、旧照三与四），预置 r2_start（起点在 r1，步骤 13 的 goto 走出入口进楼）。
// 另有：每个谜题 ≥ 2 条错误反馈与“前置未满足不写 flag”、502 门与单元门的 walk() 门槛、楼梯井强制对话与楼梯口触发体、
// 时辰差异（王奶奶在场/不在场、灯数恒定）、角标不泄题（lint、三块瓷砖同名）、读档复验。
// 用法：vite build --outDir <dir> && CAMERA_DIST=<dir> CAMERA_PORT=<port> node scripts/regions/r2.mjs [--main] [--until=<n>] [--only=steps|cases] [--case=<子串>]

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readDocs, runRegion } from '../lib/harness.mjs';
import { PRESETS } from '../lib/presets.mjs';
import { pickSteps, tryFeedback } from '../walkthrough.mjs';

export const AREA = 'r2';
export const PRESET_NAMES = ['r2_start', 'r3_start', 'r4_start', 'yin'];
for (const p of PRESET_NAMES) if (!(p in PRESETS)) throw new Error(`presets.mjs 没有预置 ${p}`);

/** 建国的信：抠开左下瓷砖即在阅读器里翻开（M4 第 2 轮）。 */
const LETTER_DOC = 'doc.letter_jianguo';

// 步骤 25 抠开铁盒即翻开建国的信（M4 第 2 轮）：walkthrough.mjs 的步骤 25 自己断言这封信并合上（第 2 轮整合同步）。
export const STEPS = pickSteps(13, 26);
/**
 * 读档复验点（步骤表里）：22 之后（下一步 goto 进 502、explore 下找已常显的王奶奶）。
 * 其余中间点（护送到三楼后、抠出铁盒后）的“读档后接着推进”写成下面的 reload 用例：
 * 步骤表里的下一步都默认取景器还开着，读档会把模式复位成 explore。
 */
export const RELOAD_AT = [22];

/** 王奶奶护送到 n 层时的状态（用例用）。 */
const escort = n => ({ flags: { 'r2.lobby_lamp_lit': true, 'r2.wang_met': true, 'r2.wang_escort': true, 'r2.wang_floor': n } });
/** 进了 502 的状态。 */
const in502 = (more = {}) => ({ flags: { ...escort(5).flags, 'r2.bulb_installed': true, 'r2.menshen_open': true, ...more }, items: [{ id: 'it.bulb', used: true }], photos: ['ph.menshen_2018'] });

const photoOf = r => (r && r.photo) || (r && r.result && r.result.photo);

/** listInteractables 里某个交互物的状态。 */
async function status(g, id) {
  const list = await g.call('listInteractables');
  return list.find(x => x.id === id) ?? null;
}

/** 走一段（可能被挡、可能中途换区域），然后等过渡结束。 */
async function walkThrough(g, x, z) {
  const r = await g.call.try('walk', x, z);
  await g.call('wait', 1.5);
  await g.refresh();
  return r;
}

export const CASES = [
  // ———————————————— P3 声控灯
  {
    puzzle: 'P3', name: '门厅灯没亮就找王奶奶（前置未满足：不写 r2.wang_met）', preset: 'r2_start',
    run: async g => {
      await g.call('goto', 'r2', 0.8, 1.2, 1);
      await g.call('vf', true);
      await tryFeedback(g, '太黑了。台阶上缩着个人影。', 'interact', 'npc.wang');
      await g.call('dlg');
      await g.refresh();
      g.expect.noFlags('r2.wang_met', 'r2.wang_escort');
    },
  },
  {
    puzzle: 'P3', name: '灯亮着才见得着面；20 秒后灯灭', preset: 'r2_start',
    run: async g => {
      await g.call('goto', 'r2', 0.8, 1.6, 1);
      await g.call('vf', true);
      await g.call('shoot');
      await g.refresh();
      g.assert(g.snap.temp.lamp_lit_1 === true, `快门后一楼灯应亮着：${JSON.stringify(g.snap.temp)}`);
      g.expect.flags('r2.lobby_lamp_lit');
      g.expect.feedback('原来它认这一声');
      for (let i = 0; i < 3; i++) await g.call('wait', 7);
      await g.refresh();
      g.assert(g.snap.temp.lamp_lit_1 === false, `20 秒后一楼灯应灭：${JSON.stringify(g.snap.temp)}`);
      await tryFeedback(g, '太黑了。', 'interact', 'npc.wang');
      await g.call('dlg');
      g.expect.noFlags('r2.wang_met');
    },
  },
  {
    puzzle: 'P3', name: 'r1.mission_given 之前：快门照样点灯，但不写 flag、王奶奶不在', preset: 'new',
    extra: { flags: { 'r1.log_taken': true, 'r1.gate_lamp_on': true }, area: 'r2', spawn: 'spawn.r2_lobby' },
    run: async g => {
      await g.call('goto', 'r2', 0, 3.0, 1);
      await g.call('vf', true);
      await g.call('shoot');
      await g.refresh();
      g.assert(g.snap.temp.lamp_lit_1 === true, '灯应亮');
      g.expect.noFlags('r2.lobby_lamp_lit');
      const w = await status(g, 'npc.wang');
      g.assert(w && w.present === false, `mission_given 之前王奶奶不在：${JSON.stringify(w)}`);
    },
  },
  {
    puzzle: 'P3', name: '在别处使用灯泡', preset: 'r2_start',
    run: async g => {
      await g.call('goto', 'r2', 0, 1.2, 1);
      await tryFeedback(g, '这儿不缺灯泡。', 'use', 'r2.lamp_1f', 'it.bulb');
      g.expect.noFlags('r2.bulb_installed');
      await tryFeedback(g, '你想喊一声。你没有嘴。', 'interact', 'r2.lamp_1f');
    },
  },
  {
    puzzle: 'P3', name: '越层点灯：王奶奶不跟', preset: 'r2_start', extra: escort(1),
    run: async g => {
      await g.call('goto', 'r2', 0, 1.2, 4);
      await g.call('vf', true);
      await tryFeedback(g, '黑……俺瞅不见道。', 'shoot');
      g.expect.eq('flags.r2.wang_floor', 1);
    },
  },
  {
    puzzle: 'P3', name: '三楼没装灯泡就按快门', preset: 'r2_start', extra: escort(2),
    run: async g => {
      await g.call('goto', 'r2', 0.3, 1.4, 3);
      await g.call('vf', true);
      await tryFeedback(g, '咔嚓一声。灯座里是空的。', 'shoot');
      g.expect.eq('flags.r2.wang_floor', 2);
      g.expect.noFlags('r2.bulb_installed');
      await tryFeedback(g, '灯座里是空的。', 'interact', 'r2.lamp_socket_3f');
    },
  },
  {
    puzzle: 'P3', name: '护送中和她说话', preset: 'r2_start', extra: escort(1),
    run: async g => {
      await g.call('goto', 'r2', 0.8, 1.2, 1);
      await g.call('vf', true);
      await tryFeedback(g, '上头亮了，俺就上去。', 'interact', 'npc.wang');
      await g.call('dlg');
    },
  },
  // ———————————————— P4 门神认人
  {
    puzzle: 'P4', name: '出示 2019 / 2025 / 其他照片', preset: 'r2_start', extra: { ...escort(5), photos: ['ph.door_2019', 'ph.door_2025'] },
    run: async g => {
      await g.call('goto', 'r2', -2.8, 1.2, 5);
      await g.call('vf', true);
      await tryFeedback(g, '这是抬出去的。', 'show', 'r2.menshen', 'ph.door_2019');
      await g.call('dlg');
      await tryFeedback(g, '这个我们认得，是她儿子。', 'show', 'r2.menshen', 'ph.door_2025');
      await g.call('dlg');
      await tryFeedback(g, '拿走拿走。', 'show', 'r2.menshen', 'ph.tudi');
      await g.call('dlg');
      g.expect.noFlags('r2.menshen_open');
    },
  },
  {
    puzzle: 'P4', name: '第 6–8 秒拍：还没贴好呢；只拍到门神：得一块儿进画', preset: 'r2_start', extra: escort(5),
    run: async g => {
      await g.call('goto', 'r2', -2.8, 1.2, 5);
      await g.call('vf', true);
      await g.call('replay', 'rp.r2_door', 'seg.door_2018');
      await g.call('replaySeek', 7);
      await g.call('aimAt', 'pt.menshen_2018');
      await tryFeedback(g, '还没贴好呢。', 'shoot');
      await g.call('replaySeek', 12);
      await g.call('zoom', 4);
      await g.call('aimAt', 'r2.menshen');
      const r = await tryFeedback(g, '得一块儿进画。', 'shoot');
      g.assert(photoOf(r.result) !== 'ph.menshen_2018', `只对门神不该得到 ph.menshen_2018：${JSON.stringify(r)}`);
      await g.call('zoom', 1);
      await g.call('replayExit');
    },
  },
  {
    puzzle: 'P4', name: '前置未满足：王奶奶还没到门口就出示贴门神的照片', preset: 'r2_start', extra: { ...escort(3), photos: ['ph.menshen_2018'] },
    run: async g => {
      await g.call('goto', 'r2', -2.8, 1.2, 5);
      await g.call('vf', true);
      await tryFeedback(g, '站住！门里阳宅，门外阴客。', 'show', 'r2.menshen', 'ph.menshen_2018');
      await g.call('dlg');
      await g.refresh();
      g.expect.noFlags('r2.menshen_open');
    },
  },
  {
    puzzle: 'P4', name: '误导照片拍得到：2025 搬家、2019 担架', preset: 'r2_start', extra: escort(5),
    run: async g => {
      await g.call('goto', 'r2', -1.8, 2.2, 5);
      await g.call('vf', true);
      await g.call('replay', 'rp.r2_door', 'seg.door_2025');
      await g.call('replaySeek', 6);
      await g.call('aimAt', 'pt.door_2025');
      let r = await g.call('shoot');
      g.assert(photoOf(r) === 'ph.door_2025', `应拍到 ph.door_2025：${JSON.stringify(r)}`);
      await g.call('replay', 'rp.r2_door', 'seg.door_2019');
      await g.call('replaySeek', 7);
      await g.call('aimAt', 'pt.door_2019');
      r = await g.call('shoot');
      g.assert(photoOf(r) === 'ph.door_2019', `应拍到 ph.door_2019：${JSON.stringify(r)}`);
      await g.call('replayExit');
    },
  },
  {
    puzzle: 'P3', name: '提示：楼道里 H 指向 P3，502 里指向 P5', preset: 'r2_start',
    run: async g => {
      await g.call('goto', 'r2', 0, 3.0, 1);
      let r = await g.call('hint');
      g.assert(r.puzzle === 'pz.p03_voice_lamps' && r.text.startsWith('王家婶子只走亮着的道'), `R2 提示：${JSON.stringify(r)}`);
      await g.call('setState', { ...in502(), area: 'r2_502' });
      r = await g.call('hint');
      g.assert(r.puzzle === 'pz.p05_kitchen_god' && r.text.includes('眼皮子底下'), `502 提示：${JSON.stringify(r)}`);
    },
  },
  {
    puzzle: 'P3', name: 'M4 第 2 轮：院子里（还没见着王奶奶）按 H 先说她在三号楼；进了楼再讲灯', preset: 'r2_start',
    run: async g => {
      await g.call('goto', 'r1', -6, 8);
      let r = await g.call('hint');
      g.assert(r.puzzle === 'pz.p03_voice_lamps' && r.text.includes('三号楼'), `院子里的 P3 提示应说她在三号楼：${JSON.stringify(r)}`);
      await g.call('goto', 'r2', 0, 3.0, 1);
      r = await g.call('hint');
      g.assert(r.puzzle === 'pz.p03_voice_lamps' && r.text.startsWith('王家婶子只走亮着的道'), `楼里的 P3 提示应讲灯：${JSON.stringify(r)}`);
    },
  },
  {
    puzzle: 'P4', name: 'M4 第 2 轮：在门口残影点旁进 2018，镜头自己转向门神；不动视角，第 10 秒按快门就拍到 ph.menshen_2018', preset: 'r2_start', extra: escort(5),
    run: async g => {
      // 残影点 (-2.0,1.2)：站在它两边 0.8m 上下、面朝它（正站在旋涡上低头时镜头与“指向旋涡上方 0.8m”的夹角到不了 30° 以内，按不了 R）；
      // (-2.8,1.2) 是 GDD §11 步骤 20 和门神说完话的地方，门在身后
      for (const [x, z] of [[-2.8, 1.2], [-1.2, 1.4]]) {
        await g.call('goto', 'r2', x, z, 5);
        await g.call('vf', true);
        await g.call('replay', 'rp.r2_door', 'seg.door_2018');
        await g.call('wait', 0.6);
        const s = await g.refresh();
        g.assert(Math.abs(((s.yaw - 270 + 540) % 360) - 180) < 25, `(${x},${z}) 进段后镜头应转向 502 门（yaw≈270）：yaw=${s.yaw}`);
        await g.call('replaySeek', 10);
        const r = await g.call('shoot');
        g.assert(photoOf(r) === 'ph.menshen_2018', `(${x},${z}) 不动视角第 10 秒应拍到 ph.menshen_2018：${JSON.stringify(r)}`);
        await g.call('replayExit');
      }
    },
  },
  // ———————————————— P5 灶王爷眼皮底下
  {
    puzzle: 'P5', name: '上面、右下两块瓷砖：死砖', preset: 'r2_start', extra: in502(),
    run: async g => {
      await g.call('goto', 'r2_502', 5.6, -1.5);
      await g.call('vf', true);
      await tryFeedback(g, '砖是死的。后头是实心墙。', 'interact', 'r2.tile_top');
      await tryFeedback(g, '砖是死的。后头是实心的灶膛。', 'interact', 'r2.tile_right_low');
      await g.refresh();
      g.expect.noFlags('r2.tin_opened');
      // 角标不泄题：三块瓷砖同名、同样可用
      const list = await g.call('listInteractables');
      const tiles = list.filter(x => x.id.startsWith('r2.tile_'));
      g.assert(tiles.length === 3 && tiles.every(t => t.label === '瓷砖' && t.available === true && t.hasOffers === false), `三块瓷砖角标应一致：${JSON.stringify(tiles)}`);
    },
  },
  {
    puzzle: 'P5', name: 'M4 第 2 轮：灶台跟前第三人称与取景器都聚焦得到低处两块瓷砖；取景器贴近时灶君不靠就近规则抢焦点；灶台照样选得中', preset: 'r2_start', extra: in502(),
    run: async g => {
      const bad = [];
      for (const vf of [false, true]) {
        for (const [x, z] of [[5.6, -1.5], [5.3, -1.6], [5.0, -1.6]]) {
          await g.call('goto', 'r2_502', x, z);
          await g.call('vf', vf);
          await g.call('wait', 0.1);
          for (const id of ['r2.tile_left_low', 'r2.tile_right_low']) {
            const a = await g.call('aimAt', id);
            if (a.focused !== id) bad.push(`${vf ? 'vf' : 'tp'} (${x},${z}) ${id} → ${a.focused}${a.clamped ? '（俯仰到底）' : ''}`);
          }
        }
      }
      await g.call('goto', 'r2_502', 5.71, -1.79);
      await g.call('vf', true);
      await g.call('wait', 0.1);
      const a = await g.call('aimAt', 'r2.tile_left_low');
      if (a.focused !== 'r2.tile_left_low') bad.push(`vf 贴近灶台 (5.71,-1.79) 瞄左下砖 → ${a.focused}`);
      await g.call('vf', false);
      await g.call('goto', 'r2_502', 5.6, -1.2);
      await g.call('wait', 0.1);
      const st = await g.call('aimAt', 'r2.stove');
      if (st.focused !== 'r2.stove') bad.push(`tp 瞄灶台 → ${st.focused}`);
      g.assert(bad.length === 0, bad.join('；'));
    },
  },
  {
    puzzle: 'P5', name: '出示票根 / 老花镜 / 别的：不推进', preset: 'r2_start',
    extra: { ...in502({ 'r2.tin_opened': true }), items: [{ id: 'it.bulb', used: true }, 'it.letter', 'it.train_ticket', 'it.glasses'] },
    run: async g => {
      await g.call('goto', 'r2_502', 5.6, -1.5);
      await g.call('vf', true);
      await tryFeedback(g, '深圳北……他回来过？', 'show', 'npc.wang', 'it.train_ticket');
      await g.call('dlg');
      await tryFeedback(g, '俺的镜子！', 'show', 'npc.wang', 'it.glasses');
      await g.call('dlg');
      await tryFeedback(g, '这是啥？俺不认得。', 'show', 'npc.wang', 'ph.menshen_2018');
      await g.call('dlg');
      await g.refresh();
      g.expect.noFlags('r2.wang_done');
    },
  },
  {
    puzzle: 'P5', name: '前置未满足：没抠铁盒就拿着信（调试给的）出示 → 不写 r2.wang_done', preset: 'r2_start',
    extra: { ...in502(), items: [{ id: 'it.bulb', used: true }, 'it.letter'] },
    run: async g => {
      await g.call('goto', 'r2_502', 5.6, -1.5);
      await g.call('vf', true);
      await tryFeedback(g, '这是啥？俺不认得。', 'show', 'npc.wang', 'it.letter');
      await g.call('dlg');
      await g.refresh();
      g.expect.noFlags('r2.wang_done', 'r2.ability_ir');
    },
  },
  {
    puzzle: 'P5', name: 'M4：抠开左下瓷砖即翻开建国的信、合上后一句说出铁盒里的三样；把信给王奶奶，读信近景念出信里的原句（最后一句“就是皮擀不圆”），临别时伙计被挪到她跟前',
    preset: 'r2_start', extra: in502(),
    run: async g => {
      await g.call('goto', 'r2_502', 5.6, -1.5);
      await g.call('vf', true);
      // M4 第 2 轮：拾取即在阅读器里翻开建国的信（门神、电梯、“写包”几处伏笔），合上后才说盒子里的三样
      await readDocs(g, 'r2.tile_left_low', [[LETTER_DOC, '您一回也没坐上']]);
      await g.check.feedback('牡丹饼干铁盒：一封信、一张票根、一副老花镜。');
      g.expect.flags('r2.tin_opened');
      g.expect.has('it.letter', 'it.train_ticket', 'it.glasses');
      // 读信近景念的两句（text.ts TEXT.letterRead）都是信里的原句
      const d = await g.call('readDoc', 'doc.letter_jianguo');
      for (const part of ['房子要拆了。东西我都收拾了，您那些瓶瓶罐罐我一样没扔，拉深圳去了，您别骂我。', '馄饨您别包了。我会包了，您教的，就是皮擀不圆。']) {
        g.assert(d.text.includes(part), `建国的信里应有“${part}”：${JSON.stringify(d.text)}`);
      }
      const r = await g.call.try('show', 'npc.wang', 'it.letter');
      g.assert(r.ok, `出示信：${JSON.stringify(r).slice(0, 300)}`);
      await g.refresh();
      g.expect.feedback('就是皮擀不圆。”', r);
      await g.call('dlg');
      await g.refresh();
      g.expect.flags('r2.wang_done', 'r2.ability_ir');
      g.expect.has('it.wonton', 'it.money');
      // M4 第 2 轮：临别那几句伙计被挪到她跟前 (6.0,-1.55)，过场完了就站在那儿
      const p = g.snap.pos;
      g.assert(Array.isArray(p) && Math.abs(p[0] - 6.0) < 0.2 && Math.abs(p[2] + 1.55) < 0.2, `过场后伙计应在她跟前 (6.0,-1.55)：${JSON.stringify(p)}`);
    },
  },
  {
    puzzle: 'P5', name: 'M4：灶君的角标锚在纸像下沿（供桌、“一家之主”），不压在两张脸上，照样聚焦得到、对得上话', preset: 'r2_start', extra: in502(),
    run: async g => {
      await g.call('goto', 'r2_502', 5.6, -1.5);
      await g.call('vf', true);
      const a = await g.call('aimAt', 'r2.zaojun');
      g.assert(a.focused === 'r2.zaojun' && a.point[1] < 1.5, `灶君角标应在纸像下沿（y < 1.5）且能聚焦：${JSON.stringify(a)}`);
      const r = await g.call('interact', 'r2.zaojun');
      g.assert(r.opened === 'mode.dialogue', `灶君应开对话：${JSON.stringify(r)}`);
      await g.call('dlg');
    },
  },
  // ———————————————— 门槛与楼梯
  {
    name: '502 门：门神放行前 goto 进 502 被挡', preset: 'r2_start', extra: escort(5),
    run: async g => {
      await g.call('goto', 'r2', -2.8, 1.2, 5);
      const r = await g.call.try('goto', 'r2_502', 5.6, -1.5);
      g.assert(r.ok === false && r.reason === 'blocked' && r.result && r.result.exit === 'exit.r2_to_502', `应被 exit.r2_to_502 挡住：${JSON.stringify(r)}`);
      g.expect.feedback('站住！', r);
    },
  },
  {
    name: '502 门：walk() 放行前被门挡住，放行后走进去就进了 502', preset: 'r2_start', extra: escort(5),
    run: async g => {
      await g.call('goto', 'r2', -3.4, 1.2, 5);
      const r = await walkThrough(g, -6.2, 1.2);
      g.assert(r.ok === false && r.reason === 'blocked', `门没开应被挡：${JSON.stringify(r)}`);
      g.expect.eq('area', 'r2');
      g.assert(g.snap.pos[0] > -5.1, `应停在门外：${JSON.stringify(g.snap.pos)}`);
      // setFlags 不发 'flag' 事件（动态碰撞体不会重算）：带 area 重进区域
      await g.call('setState', { flags: { 'r2.menshen_open': true }, area: 'r2', spawn: 'spawn.r2_f5' });
      await g.call('goto', 'r2', -3.4, 1.2, 5);
      await walkThrough(g, -6.2, 1.2);
      g.expect.eq('area', 'r2_502');
      // 从 502 走出来回到五楼
      await walkThrough(g, -1.2, -0.8);
      g.expect.eq('area', 'r2');
      g.expect.eq('floor', 5);
    },
  },
  {
    // M3：墙上的捐款榜在文档阅读器里读（E.doc，docs/requests/r2.md #1）
    name: '门厅捐款榜：在文档阅读器里读 doc.donation_board', preset: 'r2_start',
    run: async g => {
      await g.call('goto', 'r2', 3.6, 3.4, 1);
      await readDocs(g, 'r2.donation_board', [['doc.donation_board', '门岗　周守仁　伍佰元']]);
      await g.check.mode('mode.explore');
    },
  },
  {
    name: '单元门：走出去回到院子', preset: 'r2_start',
    run: async g => {
      await g.call('goto', 'r2', 0, 3.6, 1);
      await walkThrough(g, 0, 6.4);
      g.expect.eq('area', 'r1');
    },
  },
  {
    name: '楼梯井强制对话：上楼、下楼、（算了）；一楼没有“下楼”', preset: 'r2_start',
    run: async g => {
      await g.call('goto', 'r2', 0, 1.8, 1);
      await g.call('interact', 'r2.stairs');
      let d = await g.call('dlg');
      g.assert(d.at === 'choice' && JSON.stringify(d.options) === JSON.stringify(['上楼', '（算了）']), `一楼选项应是 上楼/（算了）：${JSON.stringify(d)}`);
      await g.call('choose', 1);
      await g.call('dlg');
      await g.refresh();
      g.expect.eq('floor', 2);
      await g.call('interact', 'r2.stairs');
      d = await g.call('dlg');
      g.assert(d.at === 'choice' && d.options.length === 3, `二楼应有三个选项：${JSON.stringify(d)}`);
      await g.call('choose', 3);
      await g.call('dlg');
      await g.refresh();
      g.expect.eq('floor', 2);
      await g.call('interact', 'r2.stairs');
      await g.call('dlg');
      await g.call('choose', 2);
      await g.call('dlg');
      await g.refresh();
      g.expect.eq('floor', 1);
    },
  },
  {
    // M4 第 2 轮整合（节奏）：王奶奶的事了了以后，三楼及以上多一个“下到一楼”，一次换层回门厅；之前没有
    name: '楼梯井：r2.wang_done 以后五楼多一个“下到一楼”，选了直接回一楼；没做完时没有', preset: 'r2_start',
    extra: { flags: { ...escort(5).flags, 'r2.wang_done': true } },
    run: async g => {
      await g.call('goto', 'r2', 0, 1.8, 5);
      await g.call('interact', 'r2.stairs');
      const d = await g.call('dlg');
      g.assert(d.at === 'choice' && JSON.stringify(d.options) === JSON.stringify(['下楼', '下到一楼', '（算了）']), `五楼（王奶奶的事了了）选项应是 下楼/下到一楼/（算了）：${JSON.stringify(d)}`);
      await g.call('choose', 2);
      await g.call('dlg');
      await g.refresh();
      g.expect.eq('floor', 1);
    },
  },
  {
    name: '楼梯井：王奶奶的事没了之前五楼没有“下到一楼”', preset: 'r2_start', extra: escort(5),
    run: async g => {
      await g.call('goto', 'r2', 0, 1.8, 5);
      await g.call('interact', 'r2.stairs');
      const d = await g.call('dlg');
      g.assert(d.at === 'choice' && JSON.stringify(d.options) === JSON.stringify(['下楼', '（算了）']), `五楼（没做完）选项应是 下楼/（算了）：${JSON.stringify(d)}`);
      await g.call('choose', 2);
      await g.call('dlg');
    },
  },
  {
    name: '楼梯口触发体：走进“上楼”口换到上一层，“下楼”口回来', preset: 'r2_start',
    run: async g => {
      await g.call('goto', 'r2', -0.8, 1.7, 1);
      await walkThrough(g, -0.8, -0.1);
      g.expect.eq('floor', 2);
      await g.call('goto', 'r2', 0.8, 1.7, 2);
      await walkThrough(g, 0.8, -0.1);
      g.expect.eq('floor', 1);
    },
  },
  // ———————————————— 时辰差异（GDD §4.6）与灯数恒定
  {
    name: '时辰：子时王奶奶在一楼台阶；丑时、寅时已走，502 灶火长明；灯数不变', preset: 'r2_start',
    run: async g => {
      await g.call('goto', 'r2', 0, 3.0, 1);
      let w = await status(g, 'npc.wang');
      g.assert(w && w.present === true, `子时王奶奶应在：${JSON.stringify(w)}`);
      const lightsZi = (await g.call('perf')).lights;
      for (const preset of ['r4_start', 'yin']) {
        const { presetPatch } = await import('../lib/presets.mjs');
        await g.call('setState', { ...presetPatch(preset), area: 'r2', spawn: 'spawn.r2_lobby' });
        await g.refresh();
        g.expect.eq('shichen', preset === 'yin' ? 'yin' : 'chou');
        w = await status(g, 'npc.wang');
        g.assert(!w || w.present === false, `${preset}：王奶奶应已走：${JSON.stringify(w)}`);
        g.assert((await g.call('perf')).lights === lightsZi, `${preset}：R2 灯数应不变`);
        await g.call('goto', 'r2_502', 5.2, -1.4);
        w = await status(g, 'npc.wang');
        g.assert(!w || w.present === false, `${preset}：502 里王奶奶也已走`);
        await tryFeedback(g, '灶膛里一团青火', 'interact', 'r2.stove');
      }
      const l502 = (await g.call('perf')).lights;
      await g.call('setState', { ...(await import('../lib/presets.mjs')).presetPatch('r3_start'), area: 'r2_502', spawn: 'spawn.r2_502_door' });
      g.assert((await g.call('perf')).lights === l502, '502：灶火亮前后灯数不变');
    },
  },
  {
    name: '角标不泄题：lint() 无问题（r2、r2_502）', preset: 'r2_start', extra: in502(),
    run: async g => {
      for (const area of ['r2', 'r2_502']) {
        await g.call('setState', { area });
        const r = await g.call('lint');
        // lint() 还会带出全局登记的别的区域的数据问题（对话、文档）：只看本区的
        const mine = r.issues.filter(i => !/^(r1|r3|r4|dev)\b/.test(i));
        g.assert(mine.length === 0, `${area} lint：${JSON.stringify(mine)}`);
      }
    },
  },
  // ———————————————— 读档复验（中间步骤之后 reload，状态一致、能接着推进）
  {
    name: '读档复验：护送到三楼后读档，接着四楼点灯', preset: 'r2_start', extra: { ...escort(3), flags: { ...escort(3).flags, 'r2.bulb_installed': true }, items: [{ id: 'it.bulb', used: true }] },
    run: async g => {
      await g.call('goto', 'r2', 0, 1.2, 3);
      const { reloadCheck } = await import('../lib/harness.mjs');
      await reloadCheck(g, '（护送到三楼）');
      await g.call('goto', 'r2', 0, 1.2, 4);
      await g.call('vf', true);
      await g.call('shoot');
      await g.refresh();
      g.expect.eq('flags.r2.wang_floor', 4);
    },
  },
  {
    name: '读档复验：抠出铁盒后读档，接着把信给王奶奶', preset: 'r2_start',
    extra: { ...in502({ 'r2.tin_opened': true }), items: [{ id: 'it.bulb', used: true }, 'it.letter', 'it.train_ticket', 'it.glasses'] },
    run: async g => {
      await g.call('goto', 'r2_502', 5.6, -1.5);
      const { reloadCheck } = await import('../lib/harness.mjs');
      await reloadCheck(g, '（抠出铁盒）');
      await g.call('goto', 'r2_502', 5.6, -1.5);
      await g.call('vf', true);
      await g.call('show', 'npc.wang', 'it.letter');
      await g.call('dlg');
      await g.refresh();
      g.expect.flags('r2.wang_done', 'r2.ability_ir');
      g.expect.has('it.wonton', 'it.money');
    },
  },
];

export async function run() {
  return runRegion({ name: 'r2', phases: [{ preset: 'r2_start', steps: STEPS }], cases: CASES, reloadAt: RELOAD_AT });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  run().then(ok => process.exit(ok ? 0 : 1), err => { console.error(err); process.exit(1); });
}
