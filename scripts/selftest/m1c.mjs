// owner: integrator
// M1c 整合自测（ARCH §15.3）：跨 WP 接缝的页面内自测（src/areas/dev/m1c.ts 登记的 'm1c.*'）+ 几条要经调试 API 驱动的检查。
// core.mjs 自动发现（默认导出 run(h)，h 在 ?debug=1&test=1&lockstep=1&area=dev 的沙盒里，已重置为新游戏状态）。
//
// 单独运行：npm run build && node scripts/selftest/m1c.mjs

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const PAGE_TESTS = ['m1c.lens_anchor', 'm1c.feedback_once', 'm1c.ui_click', 'm1c.code_wheels', 'm1c.blink', 'm1c.cutscene_osd',
  'm1c.shutter_flash', 'm1c.photo_toast', 'm1c.settings_esc', 'm1c.panel_vf_markers'];

/** 回放 HUD：开始回放时片段序号显示“1/N”（ReplaySystem.active.index 从 1 起；engine-wp6.md #10）。 */
async function replayCounter(h, notes) {
  // WP5 的回放夹具：站位 (-9, -4.5)（WP5_POS，与 core.mjs 的 FIX.replayStand 相同），取景器里
  await h.call('goto', 'dev', -9, -4.5);
  await h.call('vf', true);
  await h.call('setFlags', { 'r1.ability_replay': true });
  const r = await h.call.try('replay', 'rp.r4_stall');
  if (!r.ok) {
    notes.push(`FAIL replay HUD：replay(rp.r4_stall) → ${r.reason}`);
    return false;
  }
  await h.call('wait', 0.1);
  const text = await h.page.evaluate(() => document.querySelector('.cm-rp-count')?.textContent ?? null);
  const want = `${r.result.index}/${r.result.count}`;
  const ok = r.result.index === 1 && text === want;
  notes.push(`${ok ? 'ok  ' : 'FAIL'} replay HUD：第一段 index=${r.result.index}，HUD 显示 ${text}（应为 1/${r.result.count}）`);
  await h.call.try('replayExit');
  await h.call.try('vf', false);
  return ok;
}

export async function page(h) {
  const notes = [];
  let ok = true;
  const call = h.call.try ?? h.call;
  for (const name of PAGE_TESTS) {
    const r = await call('selftest', name);
    const res = r?.result ?? r;
    const pass = r?.ok === true && res?.ok === true;
    ok &&= pass;
    notes.push(`${pass ? 'ok  ' : 'FAIL'} page ${name}`);
    for (const n of res?.notes ?? []) if (!pass) notes.push(`      ${n}`);
  }
  ok = (await replayCounter(h, notes)) && ok;
  return { ok, notes };
}

export default async function run(h) {
  if (!h || !h.call) return { ok: true, notes: ['(m1c: 没有 harness，跳过页面内自测)'] };
  return page(h);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const lib = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/harness.mjs')).href);
  const h = await lib.launch({ query: lib.DEV_QUERY, label: 'm1c' });
  try {
    const r = await run(h);
    for (const n of r.notes) console.log(n);
    h.checkErrors('m1c');
    console.log(r.ok ? 'M1C: OK' : 'M1C: FAIL');
    process.exitCode = r.ok ? 0 : 1;
  } finally {
    await h.close();
  }
}
