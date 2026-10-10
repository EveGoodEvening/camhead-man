// owner: integrator
// char2 人物重做的自测（test-artifacts/work/char2/PLAN.md §5）：跑页面里登记的全部 'char2.*' 自测（src/areas/dev/char2.ts 与各 WP 的 char2_*.ts），
// 工具 char2.spawn 除外。core.mjs 自动发现（默认导出 run(h)，h 在 ?debug=1&test=1&lockstep=1&area=dev 的沙盒里）。
//
// 单独运行（浏览器：经 heavy-gate、后台）：
//   CAMERA_DIST=<dist 副本> CAMERA_PORT=<端口> ~/.claude/bin/heavy-gate -n 1 -l char2 -- node scripts/selftest/char2.mjs [--only=char2.head]
// --only=<前缀>（或环境变量 CHAR2_ONLY）只跑名字以它开头的；CHAR2_VERBOSE=1 打印通过项的细节。

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKIP = new Set(['char2.spawn']);

function onlyPrefix() {
  const a = process.argv.find(x => x.startsWith('--only='));
  return (a ? a.slice('--only='.length) : process.env.CHAR2_ONLY) || '';
}

export async function page(h, prefix = '') {
  const call = h.call.try ?? h.call;
  const list = await call('selftests');
  const all = (list?.result ?? list ?? []).filter(n => typeof n === 'string' && n.startsWith('char2.') && !SKIP.has(n));
  const names = all.filter(n => !prefix || n.startsWith(prefix));
  const notes = [];
  let ok = names.length > 0;
  if (!names.length) notes.push(`FAIL 没有匹配的 char2 自测（前缀 '${prefix}'，已登记 ${all.join(' ')}）`);
  for (const name of names) {
    const t0 = Date.now();
    const r = await call('selftest', name);
    const res = r?.result ?? r;
    const pass = r?.ok === true && res?.ok === true;
    ok &&= pass;
    notes.push(`${pass ? 'ok  ' : 'FAIL'} page ${name}（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
    for (const n of res?.notes ?? []) if (!pass || process.env.CHAR2_VERBOSE) notes.push(`      ${n}`);
    if (!r?.ok) notes.push(`      ${JSON.stringify(r).slice(0, 300)}`);
  }
  return { ok, notes };
}

export default async function run(h) {
  if (!h || !h.call) return { ok: true, notes: ['(char2: 没有 harness，跳过页面内自测)'] };
  return page(h, onlyPrefix().startsWith('char2') ? onlyPrefix() : '');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const lib = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/harness.mjs')).href);
  const h = await lib.launch({ query: lib.DEV_QUERY, label: 'char2', callTimeout: 400_000 });
  try {
    const r = await page(h, onlyPrefix());
    for (const n of r.notes) console.log(n);
    h.checkErrors('char2');
    console.log(r.ok ? 'CHAR2: OK' : 'CHAR2: FAIL');
    process.exitCode = r.ok ? 0 : 1;
  } finally {
    await h.close();
  }
}
