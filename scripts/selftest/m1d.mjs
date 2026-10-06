// owner: integrator
// M1d 引擎评审修复的回归自测（ARCH §15.3）：src/areas/dev/m1d.ts 登记的页面内自测 'm1d.*'。
// core.mjs 自动发现（默认导出 run(h)，h 在 ?debug=1&test=1&lockstep=1&area=dev 的沙盒里，已重置为新游戏状态）。
// 'm1d.ending_title' 会卸载沙盒并开新游戏，放在最后；跑完之后 core.mjs 在下一个模块前照常重置。
//
// 单独运行：npm run build && node scripts/selftest/m1d.mjs

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const PAGE_TESTS = ['m1d.pause_in_fade', 'm1d.teleport_failsafe', 'm1d.vf_panel', 'm1d.curb', 'm1d.cutscene_vf_post',
  'm1d.area_post', 'm1d.quality_deferred', 'm1d.ending_title'];

/** 进区域（mid 画质，含 Bloom）之后逐项玩一遍：取景器/红外、回放两段 + 红外、监控台（插线套叠、CH2）、三脚架、镜面、身子/NPC 淡出——
 *  这些都不得现场编译新着色器（预编译/预热已覆盖）；录像机打开时预热带子场景，之后 seek 过分屏、播放也不得再编译（M1d，性能评审）。
 *  第二遍整套再走一次，程序数不变。 */
async function programsStable(h, notes) {
  const T = (what, cond, detail) => {
    notes.push(`${cond ? 'ok  ' : 'FAIL'} programs：${what}${cond ? '' : `（${detail}）`}`);
    return cond;
  };
  const approach = async (id, dist, method) => {
    const a = await h.call.try('aimAt', id);
    if (!a.ok) return a;
    const [x, , z] = a.result.point;
    for (const [dx, dz] of [[0, dist], [0, -dist], [dist, 0], [-dist, 0], [dist * 0.7, dist * 0.7], [-dist * 0.7, dist * 0.7], [dist * 0.7, -dist * 0.7], [-dist * 0.7, -dist * 0.7]]) {
      const r = await h.call.try('goto', 'dev', x + dx, z + dz);
      if (!r.ok) continue;
      const res = await h.call.try(method, id);
      if (res.ok || res.reason !== 'not_focusable') return res;
    }
    return { ok: false, reason: 'no_stand' };
  };
  const progs = async () => (await h.call('perf')).result?.programs ?? (await h.call('perf')).programs;
  const perfN = async () => { const r = await h.call.try('perf'); return r.ok ? r.result.programs : -1; };
  let ok = true;
  const q = await h.call.try('selftest', 'm1d.quality_mid');
  if (!(q.ok && q.result.ok)) return T('切到 mid 画质', false, JSON.stringify(q));
  await h.call('setFlags', { 'r1.ability_replay': true, 'r2.ability_ir': true });
  await h.call('frame', 2);
  const p0 = await perfN();
  const passLive = async () => {
    await h.call('goto', 'dev', 0, 8);
    await h.call('vf', true);
    await h.call('lens', 'ir');
    await h.call('frame', 4);
    await h.call('lens', 'normal');
    await h.call('goto', 'dev', -9, -4.5);
    await h.call.try('replay', 'rp.r4_stall');
    await h.call.try('replaySeek', 5);
    await h.call('frame', 4);
    await h.call.try('replay', 'rp.r4_stall', 'seg.mid_1997');
    await h.call('lens', 'ir');
    await h.call('frame', 4);
    await h.call('lens', 'normal');
    await h.call.try('replayExit');
    await h.call.try('vf', false);
    await h.call('selftest', 'm1d.console_pass');
    const t = await approach('r1.bracket', 2.5, 'interact');
    if (t.ok) {
      await h.call('frame', 4);
      await h.call.try('tripod', 'cancel');
    }
    await h.call('goto', 'dev', -13, -2.1);
    await h.call('vf', true);
    await h.call.try('aimAt', 'rd.sticker_mirror');
    await h.call('frame', 6);
    await h.call('vf', false);
    await h.call('selftest', 'm1d.fade_pass');
    await h.call('frame', 2);
  };
  await passLive();
  const p1 = await perfN();
  ok = T(`取景器/红外/回放/监控台/三脚架/镜面/淡出 不现场编译（进区域后 ${p0} → ${p1}）`, p1 === p0, `${p0} → ${p1}`) && ok;
  const v = await approach('r1.vcr', 1.4, 'interact');
  ok = T('打开录像机面板', v.ok, JSON.stringify(v)) && ok;
  await h.call('frame', 2);
  const p2 = await perfN();
  await h.call.try('vcr', 'seek', '02:51:00');
  await h.call('frame', 6);
  await h.call.try('vcr', 'play');
  await h.call('wait', 2);
  await h.call.try('vcr', 'seek', '03:14:05');
  await h.call('frame', 4);
  await h.call.try('vcr', 'exit');
  const p3 = await perfN();
  ok = T(`录像机打开后 seek 过分屏、播放不再编译（${p2} → ${p3}）`, p3 === p2, `${p2} → ${p3}`) && ok;
  await passLive();
  const p4 = await perfN();
  ok = T(`第二遍整套程序数不变（${p3} → ${p4}）`, p4 === p3, `${p3} → ${p4}`) && ok;
  const back = await h.call.try('selftest', 'm1d.quality_low');
  ok = T('切回 low', back.ok && back.result.ok, JSON.stringify(back)) && ok;
  void progs;
  return ok;
}

export async function page(h) {
  const notes = [];
  let ok = true;
  const call = h.call.try ?? h.call;
  ok = (await programsStable(h, notes)) && ok;
  await call('newGame');
  await call('dlg');
  await call('setState', { area: 'dev' });
  for (const name of PAGE_TESTS) {
    const r = await call('selftest', name);
    const res = r?.result ?? r;
    const pass = r?.ok === true && res?.ok === true;
    ok &&= pass;
    notes.push(`${pass ? 'ok  ' : 'FAIL'} page ${name}`);
    for (const n of res?.notes ?? []) if (!pass || process.env.M1D_VERBOSE) notes.push(`      ${n}`);
  }
  return { ok, notes };
}

export default async function run(h) {
  if (!h || !h.call) return { ok: true, notes: ['(m1d: 没有 harness，跳过页面内自测)'] };
  return page(h);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const lib = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/harness.mjs')).href);
  const h = await lib.launch({ query: lib.DEV_QUERY, label: 'm1d' });
  try {
    const r = await run(h);
    for (const n of r.notes) console.log(n);
    h.checkErrors('m1d');
    console.log(r.ok ? 'M1D: OK' : 'M1D: FAIL');
    process.exitCode = r.ok ? 0 : 1;
  } finally {
    await h.close();
  }
}
