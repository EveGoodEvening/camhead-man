// owner: integrator
// M4 第 2 轮引擎修复的回归自测（ARCH §15.7.3）：src/areas/dev/m4.ts 登记的页面内自测 'm4.*'。
// core.mjs 自动发现（默认导出 run(h)，h 在 ?debug=1&test=1&lockstep=1&area=dev 的沙盒里）。'm4.intro_tutorial' 会开新游戏，放在最后。
// 另有 node 侧的动态分辨率用例在 wp1.mjs。
//
// 单独运行：npx vite build --outDir <dist> && CAMERA_DIST=<dist> CAMERA_PORT=<port> node scripts/selftest/m4.mjs

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const PAGE_TESTS = ['m4.far_focus', 'm4.news_defer', 'm4.tutorial_defer', 'm4.pause_keys', 'm4.hint_replace', 'm4.intro_tutorial'];

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
    for (const n of res?.notes ?? []) if (!pass || process.env.M4_VERBOSE) notes.push(`      ${n}`);
  }
  return { ok, notes };
}

export default async function run(h) {
  if (!h || !h.call) return { ok: true, notes: ['(m4: 没有 harness，跳过页面内自测)'] };
  return page(h);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const lib = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/harness.mjs')).href);
  const h = await lib.launch({ query: lib.DEV_QUERY, label: 'm4' });
  try {
    const r = await run(h);
    for (const n of r.notes) console.log(n);
    h.checkErrors('m4');
    console.log(r.ok ? 'M4: OK' : 'M4: FAIL');
    process.exitCode = r.ok ? 0 : 1;
  } finally {
    await h.close();
  }
}
