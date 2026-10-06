// owner: WP6
// WP6（ui）的最小自测（ARCH §15.2）。页面内自测函数登记在 src/areas/dev/wp6.ts（registerSelftest('wp6.*')）。
//
// 三种用法：
//   1) 由 scripts/core.mjs 自动发现：default export run(h)，h 是 scripts/lib/harness.mjs 的 launch() 结果
//      （至少有 page；页面已在 ?debug=1&area=dev），经 window.__game.selftest(name) 跑全部 wp6.* 自测。
//   2) node scripts/selftest/wp6.mjs --page：自己起 vite preview（先 npm run build）打开 dev 沙盒，跑全部 wp6.* 自测（M1c 起）。
//   3) node scripts/selftest/wp6.mjs [--standalone]（默认）：不需要构建、不需要其他 WP——起一个 vite dev 服务器，
//      用一个最小的假 Game 挂上真实的 UI，只跑 M1B_SELFTESTS（只依赖 M1a 基础件与 WP6 自己的用例，M1b 就必须通过）。

import { fileURLToPath } from 'node:url';
import { launchChromium } from '../lib/browserSlots.mjs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

/** 在已打开的页面里跑全部（或指定的）wp6.* 自测；返回 { ok, results }。 */
async function runInPage(page, only) {
  await page.waitForFunction(() => typeof window.__game === 'object' && typeof window.__game.selftests === 'function', null, { timeout: 60000 });
  const list = await page.evaluate(async () => (await window.__game.selftests()).result ?? []);
  const names = (only ?? list).filter(n => n.startsWith('wp6.'));
  const results = {};
  for (const name of names) {
    results[name] = await page.evaluate(async n => {
      const r = await window.__game.selftest(n);
      return r.ok ? r.result : { ok: false, notes: [`selftest(${n}) → ${r.reason}`] };
    }, name);
  }
  return summarize(results);
}

function summarize(results) {
  const failed = Object.entries(results).filter(([, r]) => !r || !r.ok);
  for (const [name, r] of Object.entries(results)) {
    console.log(`${r && r.ok ? 'PASS' : 'FAIL'}  ${name}${r && r.notes ? `\n        ${r.notes.join('\n        ')}` : ''}`);
  }
  return { ok: failed.length === 0 && Object.keys(results).length > 0, results };
}

/** core.mjs 的入口。 */
export default async function run(h) {
  const page = h?.page;
  if (!page) throw new Error('wp6 selftest: harness 没有提供 page');
  const r = await runInPage(page);
  if (!r.ok) throw new Error(`wp6 selftest 失败：${Object.entries(r.results).filter(([, x]) => !x.ok).map(([n]) => n).join(', ')}`);
  return r;
}

// ---------------------------------------------------------------- 独立运行

/** --standalone：浏览器里的入口（虚拟模块）。假 Game 只提供 UI 构造与 M1B_SELFTESTS 用得到的成员。 */
const STANDALONE_ENTRY = `
import { UI } from '/src/ui/ui.ts';
import { EventBus } from '/src/core/events.ts';
import { runSelftest } from '/src/debug/selftest.ts';
import { M1B_SELFTESTS } from '/src/areas/dev/wp6.ts';

const host = document.getElementById('app');
let stack = ['mode.explore'];
const game = {
  host,
  events: new EventBus(),
  url: { test: true },
  settings: { mouseSens: 1, invertY: false, vfMode: 'toggle', subSize: 1, grain: 1, quality: 'mid', reduceFlash: false, colorAssist: false, hintNoCooldown: false, mirrorMode: 'rt', tunnelMode: 'rt', volume: 0.8 },
  modes: {
    get stack() { return stack; }, get top() { return stack[stack.length - 1]; },
    arg: () => undefined, handler: () => ({ pointer: 'lock' }), freezesWorld: () => false,
    pop: () => { stack = stack.slice(0, -1); return { ok: true }; },
  },
  input: { pointerLocked: false, lockAvailable: false, onButton: () => () => {}, requestPointerLock: () => {} },
  save: { read: () => ({ ok: false, reason: 'missing' }), has: () => false },
  areas: { current: null, isLoading: () => false },
  state: { seen: () => false },
  sys: { dialogue: { active: null }, panels: { code: null, naming: null } },
  dispatch: () => ({ ok: false, reason: 'mode_disallows' }),
};
game.ui = new UI(host, game);
const results = {};
for (const name of M1B_SELFTESTS) {
  const r = await runSelftest(game, name);
  results[name] = r.ok ? r.result : { ok: false, notes: ['selftest ' + name + ' → ' + r.reason] };
}
window.__wp6 = results;
`;

async function standalone() {
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  const VIRTUAL = 'virtual:wp6-selftest';
  const server = await createServer({
    configFile: false,
    root: ROOT,
    logLevel: 'warn',
    server: { port: 0, host: '127.0.0.1', strictPort: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{
      name: 'wp6-selftest',
      resolveId: id => (id === VIRTUAL ? `\0${VIRTUAL}` : null),
      load: id => (id === `\0${VIRTUAL}` ? STANDALONE_ENTRY : null),
      configureServer(s) {
        s.middlewares.use('/__wp6_selftest.html', (_req, res) => {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>wp6 selftest</title></head>
<body style="margin:0;background:#000"><div id="app" style="position:fixed;inset:0"></div>
<script type="module" src="/@id/__x00__${VIRTUAL}"></script></body></html>`);
        });
      },
    }],
  });
  await server.listen();
  const port = server.httpServer.address().port;
  const browser = await launchChromium(chromium, { args: CHROMIUM_ARGS }, 'wp6');
  const errors = [];
  let ok = false;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', e => errors.push(`pageerror: ${e}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
    await page.goto(`http://127.0.0.1:${port}/__wp6_selftest.html`);
    await page.waitForFunction(() => window.__wp6 !== undefined, null, { timeout: 60000 });
    const results = await page.evaluate(() => window.__wp6);
    ok = summarize(results).ok;
  } finally {
    await browser.close();
    await server.close();
  }
  if (errors.length) {
    console.log(errors.join('\n'));
    ok = false;
  }
  console.log(ok ? 'WP6 SELFTEST (standalone): OK' : 'WP6 SELFTEST (standalone): FAIL');
  return ok;
}

async function pageMode() {
  const { preview } = await import('vite');
  const { chromium } = await import('playwright');
  const port = 4186;
  const server = await preview({ root: ROOT, preview: { port, host: '127.0.0.1', strictPort: true }, logLevel: 'warn' });
  const browser = await launchChromium(chromium, { args: CHROMIUM_ARGS }, 'wp6');
  let ok = false;
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await page.goto(`http://127.0.0.1:${port}/?new=1&debug=1&test=1&lockstep=1&quality=low&area=dev`);
    ok = (await runInPage(page)).ok;
  } finally {
    await browser.close();
    server.httpServer.close();
  }
  console.log(ok ? 'WP6 SELFTEST (page): OK' : 'WP6 SELFTEST (page): FAIL');
  return ok;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ok = process.argv.includes('--page') ? await pageMode() : await standalone();
  process.exit(ok ? 0 : 1);
}
