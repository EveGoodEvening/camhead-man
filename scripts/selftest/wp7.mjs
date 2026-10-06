// owner: WP7
// WP7（debug + scripts + 沙盒底座）的自测（ARCH §15.2）。两部分：
//   1. node 侧（M1b 就必须通过，不需要构建、不依赖别的 WP 的实现）：
//      - check.mjs：在临时目录里放一棵有意违规的 src 树，逐条规则必须报出来；干净的树零违规；--stubs 按拥有者统计；
//      - harness：对一个极小的临时页面（假 window.__game）跑 launch/call/call.try/expect/超时，
//        并验证 pageerror、console.error、console.warn('GL_INVALID_OPERATION …') 都被判为失败、启动失败页被识别、PNG 解码与亮度统计；
//      - presets：全部 id 已登记；scripts/lib/presets.mjs 与 src/debug/shots.ts 的时辰预置一致；预置逐级包含；
//      - walkthrough/regions：58 步齐全、〔可选〕步骤正确、区域脚本的步骤范围与用例；
//      - debug/api.ts：用 vite ssrLoadModule 加载，配一个假 Game（只有 API 用到的字段），测串行排队、真实时间超时、异常兜底、
//        bad_args/busy/mode_disallows、幂等、★ 方法只在 ?debug=1 出现、JSON 化。
//   2. 页面内（M1c 起必须通过）：经 __game.selftest('wp7.*') 跑 src/areas/dev/wp7.ts 登记的自测，并检查 API 表面（全部方法与别名）。
//
// 用法：node scripts/selftest/wp7.mjs            只跑 node 侧（M1b 的默认）
//       node scripts/selftest/wp7.mjs --page     再对已构建的 dist/ 跑页面内自测（CAMERA_DIST 可指定构建目录）
// scripts/core.mjs 自动发现本文件时调用默认导出 run(h)：node 侧 + 页面内。

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const imp = rel => import(pathToFileURL(path.join(ROOT, rel)).href);

export const name = 'wp7';
export const PAGE_TESTS = ['wp7.json_safe', 'wp7.base_layout', 'wp7.aim_resolution', 'wp7.fidelity', 'wp7.lint'];

// ==================================================================== 断言小工具

function makeReport(label) {
  const notes = [];
  let failed = 0;
  const t = (what, cond, detail = '') => {
    if (!cond) failed++;
    notes.push(`${cond ? 'ok  ' : 'FAIL'} ${label}: ${what}${cond || !detail ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
    return !!cond;
  };
  return { t, notes, get failed() { return failed; } };
}

function tmpDir(tag) {
  const base = process.env.WP7_TMP ?? path.join(os.tmpdir(), 'camhead-man-wp7');
  const d = path.join(base, `${tag}-${process.pid}-${Date.now()}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function write(root, rel, text) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

// ==================================================================== 1a. check.mjs

async function testCheck() {
  const R = makeReport('check');
  const bad = tmpDir('check-bad');
  write(bad, 'src/areas/r3/bad.ts', [
    '// owner: R3',
    "import * as THREE from 'three';",
    "import { x } from '../r4/y';                  // cross-area-import",
    "import { UI } from '../../ui/ui';             // area-imports-ui（值导入）",
    "import type { View } from '../../ui/ui';      // 只导入类型：允许",
    "import { runShot } from '../../debug/shots';  // area-imports-debug",
    "import { Game } from '../../core/game';       // area-imports-game",
    "import lodash from 'lodash';                    // only-three",
    'export const a = [x, UI, runShot, Game, lodash];',
    "export const re = /'/;                         // 正则里的引号不能打乱词法",
    "export const id1 = 'r3.no_such';               // unknown-id",
    "export const id2 = 'r3.hole_';                 // 前缀：允许",
    "export const id3 = 'ph.empty_12';              // 空镜：允许",
    "export const id4 = 'spawn.dev_start';          // DEV_IDS：允许",
    "export const id5 = 'dlg.r4.hi';                // dlg-area",
    "export const id6 = 'dlg.r3.hi';                // 本区对话：允许",
    'export const id7 = `r3.${id1}`;                 // 带 ${} 的模板：不查',
    "export const txt = '别用 localStorage，也别碰 __game';   // 字符串里的字不算",
    '// 注释里写 setTimeout(、__game、new THREE.PointLight 都不算',
    'setTimeout(() => {}, 1);                       // no-setTimeout',
    'setInterval(() => {}, 1);                      // check-allow: no-setInterval（豁免）',
    'export const l = new THREE.PointLight();       // no-raw-light',
    'export const n: any = 1;                       // no-any',
    '// @ts-ignore',
    'export const m = 2;',
    '',
  ].join('\n'));
  write(bad, 'src/areas/r3/noowner.ts', "// 没有 owner 注释\nexport const z = 1;\n");
  write(bad, 'src/areas/r1/finale/x.ts', "// owner: R1-finale\nimport { R1 } from '../layout';\nimport w from '../world';\nexport const q = [R1, w];\n");
  write(bad, 'src/areas/r1/index.ts', "// owner: integrator\nimport world from './world';\nimport finale from './finale';\nexport default [world, finale];\n");
  write(bad, 'src/areas/dev/wp9.ts', "// owner: WP7\nexport const t = () => setTimeout(() => {}, 1);\n// check-allow: unknown-id —— 负例\nexport const u = 'it.bogus';\nexport const v = 'it.bogus2';\n");
  write(bad, 'src/debug/z.ts', "// owner: WP7\nexport function f(): never { return notImplemented('z'); }\n// notImplemented( 在注释里不算\n");
  write(bad, 'src/core/log.ts', "// owner: WP1\nexport function notImplemented(what: string): never { throw new Error(what); }\n");

  const run = (root, extra = []) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/check.mjs'), `--root=${root}`, '--no-lint', ...extra], { encoding: 'utf8' });
  const r = run(bad, ['--json']);
  R.t('有违规时退出码 1', r.status === 1, `${r.status} ${r.stderr}`);
  let out = { violations: [], warnings: [] };
  try {
    out = JSON.parse(r.stdout);
  } catch (err) {
    R.t('--json 输出可解析', false, `${err.message}: ${r.stdout.slice(0, 300)}`);
  }
  const has = (rule, file, line) => out.violations.some(v => v.rule === rule && v.file.endsWith(file) && (line === undefined || v.line === line));
  R.t('跨区域 import', has('cross-area-import', 'areas/r3/bad.ts', 3), out.violations);
  R.t('区域对 ui 的值导入', has('area-imports-ui', 'areas/r3/bad.ts', 4));
  R.t('区域对 ui 的 import type 允许', !has('area-imports-ui', 'areas/r3/bad.ts', 5));
  R.t('区域 import debug', has('area-imports-debug', 'areas/r3/bad.ts', 6));
  R.t('区域运行时 import core/game', has('area-imports-game', 'areas/r3/bad.ts', 7));
  R.t('只用 three', has('only-three', 'areas/r3/bad.ts', 8));
  R.t('未登记的 id', has('unknown-id', 'areas/r3/bad.ts', 11));
  R.t('正则里的引号没有打乱词法（后面的字符串照样查到）', has('unknown-id', 'areas/r3/bad.ts', 11));
  R.t('前缀 / 空镜 / DEV_IDS / 带 ${} 的模板 不报', !out.violations.some(v => v.rule === 'unknown-id' && [12, 13, 14, 17].includes(v.line)));
  R.t('dlg 的区域段', has('dlg-area', 'areas/r3/bad.ts', 15) && !has('dlg-area', 'areas/r3/bad.ts', 16));
  R.t('字符串与注释里的字不算禁用 API', !out.violations.some(v => v.file.endsWith('bad.ts') && [18, 19].includes(v.line)));
  R.t('禁用 setTimeout', has('no-setTimeout', 'areas/r3/bad.ts', 20));
  // M1c：豁免只在引擎文件与 dev 沙盒里生效，正式区域目录不得自我豁免（ARCH §14.2）
  R.t('check-allow 在区域目录里不生效', has('no-setInterval', 'areas/r3/bad.ts', 21));
  R.t('check-allow 在 dev 沙盒里豁免下一行', !has('unknown-id', 'areas/dev/wp9.ts', 4) && has('unknown-id', 'areas/dev/wp9.ts', 5));
  R.t('禁用 new THREE.PointLight', has('no-raw-light', 'areas/r3/bad.ts', 22));
  R.t('禁用 any', has('no-any', 'areas/r3/bad.ts', 23));
  R.t('禁用 @ts-ignore', has('no-ts-ignore', 'areas/r3/bad.ts', 24));
  R.t('缺 owner 注释', has('owner-header', 'areas/r3/noowner.ts', 1));
  R.t('finale 可以 import r1/layout', !has('cross-area-import', 'areas/r1/finale/x.ts', 2));
  R.t('finale 不得 import r1 的其余部分', has('cross-area-import', 'areas/r1/finale/x.ts', 3));
  R.t('r1/index.ts 可以同时 import world 与 finale', !out.violations.some(v => v.file.endsWith('areas/r1/index.ts')));
  R.t('dev 沙盒里的禁用 API 只报警告', !has('no-setTimeout', 'areas/dev/wp9.ts') && out.warnings.some(w => w.rule === 'no-setTimeout' && w.file.endsWith('areas/dev/wp9.ts')));
  const st = run(bad, ['--stubs', '--owner=WP7']);
  R.t('--stubs --owner=WP7：有残留时退出码 1、按拥有者列出文件', st.status === 1 && /WP7\s+1/.test(st.stdout) && st.stdout.includes('src/debug/z.ts'), st.stdout);
  R.t('--stubs：notImplemented 的定义与注释不算', !/log\.ts/.test(st.stdout));
  const st2 = run(bad, ['--stubs', '--owner=WP1']);
  R.t('--stubs --owner=WP1：没有残留时退出码 0', st2.status === 0, st2.stdout);

  const good = tmpDir('check-good');
  write(good, 'src/areas/r3/index.ts', "// owner: R3\nimport { defineArea } from '../../core/area';\nimport { OBJ } from '../../data/ids';\nimport type { View } from '../../ui/ui';\nexport const a = [defineArea, OBJ.R3_BELL, 'r3.bell', 'dlg.r3.lu_glass'];\nexport type V = View;\n");
  write(good, 'src/game/x.ts', "// owner: WP4\nimport * as THREE from 'three';\nimport { Octree } from 'three/addons/math/Octree.js';\nexport const o = [THREE, Octree, 'it.log', 'r3.hole_'];\n");
  const g = run(good);
  R.t('干净的树：零违规、退出码 0', g.status === 0 && /0 条违规/.test(g.stdout), g.stdout);

  // 真实仓库：只报告，不判失败（别的 WP 的文件在 M1b 期间还在变）；WP7 自己的文件必须零违规
  const real = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check.mjs'), '--no-lint', '--json'], { encoding: 'utf8' });
  try {
    const o = JSON.parse(real.stdout);
    const mine = o.violations.filter(v => /src\/(debug\/|areas\/dev\/(base|wp7)\.ts)/.test(v.file));
    R.t('仓库里 WP7 的文件零违规', mine.length === 0, mine);
    R.notes.push(`note  check: 仓库全树 ${o.violations.length} 条违规、${o.warnings.length} 条警告（M1b 期间只报告）`);
  } catch (err) {
    R.t('仓库 check --json 可解析', false, err.message);
  }
  return R;
}

// ==================================================================== 1b. harness

const STUB_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>wp7 harness stub</title>
<style>html,body{margin:0;height:100%;background:#808080}</style></head><body>
<canvas width="16" height="16" style="position:fixed;inset:0;width:100%;height:100%"></canvas>
<script>
  const st = { loading: false, mode: 'mode.explore', flags: { 'r1.a': true, 'r2.wang_floor': 2 }, items: [{ id: 'it.x', used: true }],
    photos: ['ph.y'], names: ['name.huoji'], clues: [], lastFeedback: '你好，伙计', subtitle: null, dialogue: null, reading: null, readHint: null, vcr: { tc: '22:00:00' } };
  window.__game = {
    state: async () => ({ ok: true, result: st }),
    echo: async (...a) => ({ ok: true, result: a }),
    bad: async () => ({ ok: false, reason: 'bad_args', result: { why: 'test' } }),
    warnGL: async () => { console.warn('[.WebGL-0x1]GL_INVALID_OPERATION: Feedback loop formed between Framebuffer and active Texture.'); return { ok: true }; },
    warnDep: async () => { console.warn('THREE.Clock: This module has been deprecated.'); return { ok: true }; },
    warnOk: async () => { console.warn('普通的警告，不算失败'); return { ok: true }; },
    err: async () => { console.error('boom'); return { ok: true }; },
    throwLater: async () => { setTimeout(() => { throw new Error('kaboom'); }, 0); return { ok: true }; },
    rejectLater: async () => { Promise.reject(new Error('unhandled-nope')); return { ok: true }; },
    slow: () => new Promise(() => {}),
  };
  window.__cam = window.__game;
</script></body></html>`;

const BOOT_ERROR_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="cm-boot-error">启动失败：测试用的启动失败页</div><script>console.error('boot failed (stub)');</script></body></html>`;

async function testHarness() {
  const R = makeReport('harness');
  const H = await imp('scripts/lib/harness.mjs');
  R.t('CHROMIUM_ARGS 是 SwiftShader 三件套', JSON.stringify(H.CHROMIUM_ARGS) === JSON.stringify(['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']));
  for (const [s, bad] of [['GL_INVALID_OPERATION: x', true], ['WebGL: INVALID_VALUE', true], ['Feedback loop formed', true], ['THREE.X has been removed', true], ['is deprecated', true], ['普通警告', false]]) {
    R.t(`BAD_WARN ${JSON.stringify(s)} → ${bad}`, H.BAD_WARN.test(s) === bad);
  }
  const args = (() => {
    const save = process.argv;
    process.argv = ['node', 'x', '--main', '--until=12', 'pos'];
    try {
      return H.parseArgs();
    } finally {
      process.argv = save;
    }
  })();
  R.t('parseArgs', args.main === true && args.until === '12' && args._[0] === 'pos', args);
  R.t('getPath：flags.<带点的 id>', H.getPath({ flags: { 'r2.wang_floor': 3 } }, 'flags.r2.wang_floor') === 3 && H.getPath({ saves: { yin: true } }, 'saves.yin') === true);

  const dist = tmpDir('stub-dist');
  write(dist, 'index.html', STUB_PAGE);
  const port = Number(process.env.WP7_PORT ?? 4290);
  let h;
  try {
    h = await H.launch({ dist, port, query: 'test=1', callTimeout: 2500, label: 'wp7-stub', dumpOnTimeout: false });
    R.t('launch：preview + Chromium 起来并等到 __game 就绪', typeof h.url === 'string' && h.url.startsWith('http://127.0.0.1:'));
    const e = await h.call('echo', 1, 'a');
    R.t('call 返回 result', JSON.stringify(e) === '[1,"a"]', e);
    let threw = null;
    try {
      await h.call('bad');
    } catch (err) {
      threw = err;
    }
    R.t('call：ok=false 时抛出 method(args) → reason', threw && /bad\(\) → bad_args/.test(threw.message), threw && threw.message);
    const t = await h.call.try('bad');
    R.t('call.try：不抛，返回 ApiResult', t.ok === false && t.reason === 'bad_args');
    const nm = await h.call.try('nope');
    R.t('没有的方法 → no_such_method', nm.ok === false && nm.reason === 'no_such_method');
    R.t('干净的页面没有错误', h.errors.length === 0, h.errors);
    await h.refresh();
    let exErr = null;
    try {
      h.expect.flags('r1.a', 'r2.wang_floor');
      h.expect.has('it.x', 'ph.y');
      h.expect.used('it.x');
      h.expect.name('name.huoji');
      h.expect.eq('mode', 'mode.explore');
      h.expect.eq('flags.r2.wang_floor', 2);
      h.expect.eq('vcr.tc', '22:00:00');
      h.expect.feedback('伙计');
      h.expect.noFlags('r1.b');
      h.expect.reason('bad_args', t);
    } catch (err) {
      exErr = err;
    }
    R.t('expect.* 通过的断言', exErr === null, exErr && exErr.message);
    const expectFails = [
      () => h.expect.flags('r1.b'), () => h.expect.has('it.nope'), () => h.expect.name('name.laozhou'), () => h.expect.eq('mode', 'mode.album'),
      () => h.expect.feedback('没有这句'), () => h.expect.noFlags('r1.a'), () => h.expect.mode('mode.dialogue'),
    ];
    R.t('expect.* 失败的断言都抛出', expectFails.every(f => { try { f(); return false; } catch { return true; } }));
    await h.call('warnOk');
    R.t('普通 console.warn 不算失败', h.errors.length === 0, h.errors);
    await h.call('warnGL');
    await h.page.waitForTimeout(100);
    R.t("抓到 console.warn('GL_INVALID_OPERATION …')", h.errors.some(x => x.kind === 'console.warning' && x.text.includes('GL_INVALID_OPERATION')), h.errors);
    let ce = null;
    try {
      h.checkErrors('stub');
    } catch (err) {
      ce = err;
    }
    R.t('checkErrors 有错误时抛出', ce !== null && /GL_INVALID_OPERATION/.test(ce.message));
    h.clearErrors();
    await h.call('warnDep');
    await h.call('err');
    await h.call('throwLater');
    await h.call('rejectLater');
    await h.page.waitForTimeout(200);
    R.t('抓到弃用警告', h.errors.some(x => x.kind === 'console.warning' && /deprecated/.test(x.text)), h.errors);
    R.t('抓到 console.error', h.errors.some(x => x.kind === 'console.error' && x.text.includes('boom')));
    R.t('抓到 pageerror', h.errors.some(x => x.kind === 'pageerror' && x.text.includes('kaboom')));
    R.t('抓到未处理的 Promise rejection', h.errors.some(x => x.text.includes('unhandled-nope')), h.errors);
    h.clearErrors();
    const t0 = Date.now();
    let to = null;
    try {
      await h.call('slow');
    } catch (err) {
      to = err;
    }
    // CAMERA_SLOW=k 时 harness 的超时整体放宽 k 倍（M4）
    R.t('Node 侧真实时间超时', to && /超时/.test(to.message) && Date.now() - t0 < 10_000 * (H.SLOW ?? 1), to && to.message);
    const buf = await h.page.screenshot();
    const img = H.decodePng(buf);
    R.t('PNG 解码：尺寸与视口一致', img.width === 800 && img.height === 450, `${img.width}×${img.height}`);
    const ls = H.lumaStats(img);
    R.t('亮度统计：#808080 背景平均亮度 ≈ 0.50', Math.abs(ls.mean - 128 / 255) < 0.02 && ls.brightFrac === 0, ls);
    R.t('5×5 块亮度', Math.abs(H.patchLuma(img, 400, 225, 5) - 128 / 255) < 0.02);
  } catch (err) {
    R.t('harness 跑通', false, err.stack || err.message);
  } finally {
    await h?.close();
  }

  const dist2 = tmpDir('boot-error-dist');
  write(dist2, 'index.html', BOOT_ERROR_PAGE);
  let be = null;
  try {
    const h2 = await H.launch({ dist: dist2, port, query: 'test=1', bootTimeout: 10_000, label: 'wp7-boot' });
    await h2.close();
  } catch (err) {
    be = err;
  }
  R.t('识别启动失败页（launch 抛出、带页面文字）', be && /游戏启动失败/.test(be.message) && be.message.includes('测试用的启动失败页'), be && be.message);
  let missing = null;
  try {
    await H.launch({ dist: path.join(dist2, 'nope'), port });
  } catch (err) {
    missing = err;
  }
  R.t('没有构建产物时给出清楚的错误', missing && /找不到构建产物/.test(missing.message));
  return R;
}

// ==================================================================== 1c. presets / walkthrough / regions

async function testData(server) {
  const R = makeReport('data');
  const ids = await imp('src/data/ids.ts');
  const known = new Set([...ids.ALL_IDS, ...ids.DEV_IDS]);
  const P = await imp('scripts/lib/presets.mjs');
  const idsOf = p => [...Object.keys(p.flags), ...p.items.map(i => (typeof i === 'string' ? i : i.id)), ...p.photos];
  for (const [n, p] of Object.entries(P.PRESETS)) {
    if (p === null) continue;
    const bad = idsOf(p).filter(id => !known.has(id));
    R.t(`预置 ${n} 的 id 都已登记`, bad.length === 0, bad);
    if (p.start) R.t(`预置 ${n} 的起点出生点已登记`, known.has(p.start.spawn), p.start);
  }
  const chain = ['r2_start', 'r3_start', 'r4_start', 'yin'];
  for (let i = 1; i < chain.length; i++) {
    const a = P.PRESETS[chain[i - 1]];
    const b = P.PRESETS[chain[i]];
    const missing = Object.keys(a.flags).filter(k => !(k in b.flags));
    R.t(`${chain[i]} ⊇ ${chain[i - 1]}（flags）`, missing.length === 0, missing);
  }
  R.t('r2_start 与 ARCH §15.4 一致（8 个 flag、5 件物品、ph.tudi）', Object.keys(P.PRESETS.r2_start.flags).length === 8 && P.PRESETS.r2_start.items.length === 5 && P.PRESETS.r2_start.photos.join() === 'ph.tudi');
  R.t('r3_start 里 it.bulb 已用（后者覆盖前者）', P.PRESETS.r3_start.items.some(i => typeof i === 'object' && i.id === 'it.bulb' && i.used) && !P.PRESETS.r3_start.items.includes('it.bulb'));
  R.t('r2.wang_floor = 5（数值 flag）', P.PRESETS.r3_start.flags['r2.wang_floor'] === 5);
  R.t('yin_nanke 有六张旧照与 ant_old_1/2', P.PRESETS.yin_nanke.photos.filter(p => p.startsWith('ph.old_')).length === 6 && P.PRESETS.yin_nanke.flags['r1.ant_old_2'] === true);
  const patch = P.presetPatch('r4_start');
  R.t('presetPatch 带起点', patch.area === 'r1' && patch.spawn === 'spawn.r1_start');
  // shots.ts 的 SHOT_PRESETS 与 presets.mjs 一致
  try {
    const shots = await server.ssrLoadModule('/src/debug/shots.ts');
    for (const k of ['zi', 'chou', 'yin', 'mao']) {
      const a = P.mergePreset(P.SHOT_PRESETS[k]);
      const b = P.mergePreset(shots.SHOT_PRESETS[k]);
      const norm = p => JSON.stringify({ f: Object.entries(p.flags).sort(), i: p.items.map(i => (typeof i === 'string' ? [i, false] : [i.id, i.used])).sort(), p: [...p.photos].sort() });
      R.t(`时辰预置 ${k}：presets.mjs 与 src/debug/shots.ts 一致`, norm(a) === norm(b));
      const bad = idsOf(b).filter(id => !known.has(id));
      R.t(`shots.ts 预置 ${k} 的 id 都已登记`, bad.length === 0, bad);
    }
  } catch (err) {
    R.t('加载 src/debug/shots.ts', false, err.message);
  }
  // walkthrough
  const W = await imp('scripts/walkthrough.mjs');
  R.t('walkthrough：58 步、编号 1–58 连续', W.STEPS.length === 58 && W.STEPS.every((s, i) => s.n === i + 1));
  R.t('〔可选〕步骤 = 10 11 12 15 24 31 45 46', W.STEPS.filter(s => s.optional).map(s => s.n).join(' ') === '10 11 12 15 24 31 45 46');
  R.t('每步都有 run', W.STEPS.every(s => typeof s.run === 'function'));
  const src = fs.readFileSync(path.join(ROOT, 'scripts/walkthrough.mjs'), 'utf8');
  R.t('步骤 44 末尾必做 lens(normal)', /n: 44[\s\S]*?lens', 'normal'[\s\S]*?n: 45/.test(src));
  R.t('支持 --main --until --shuttle --reload --hints --shots --quality', ['main', 'until', 'shuttle', 'reload', 'hints', 'shots', 'quality'].every(k => src.includes(`args.${k}`)));
  const walkIds = [...src.matchAll(/'((?:r1|r2|r3|r4|it|ph|pt|rd|rp|seg|npc|doc|name)\.[a-z0-9_]+)'/g)].map(m => m[1]).filter(id => !known.has(id) && !/_$/.test(id));
  R.t('walkthrough 里的 id 字面量都已登记', walkIds.length === 0, [...new Set(walkIds)]);
  // regions
  const ranges = { r1: [[1, 11]], r1_finale: [[12, 12], [46, 58], [47, 58]], r2: [[13, 26]], r3: [[27, 37]], r4: [[38, 45]] };
  for (const [area, want] of Object.entries(ranges)) {
    const m = await imp(`scripts/regions/${area}.mjs`);
    const phases = m.PHASES ?? [{ steps: m.STEPS }];
    const got = phases.map(p => [p.steps[0].n, p.steps[p.steps.length - 1].n]);
    R.t(`regions/${area}.mjs 的步骤范围 ${JSON.stringify(want)}`, JSON.stringify(got) === JSON.stringify(want), got);
    R.t(`regions/${area}.mjs 有错误反馈用例（${m.CASES.length}）`, Array.isArray(m.CASES) && m.CASES.length >= 5 && m.CASES.every(c => c.name && typeof c.run === 'function'));
    const all = phases.flatMap(p => p.steps.map(s => s.n));
    R.t(`regions/${area}.mjs 的 reload 点在本区步骤里`, m.RELOAD_AT.every(n => all.includes(n)), m.RELOAD_AT);
    R.t(`regions/${area}.mjs 引用的预置存在`, m.PRESET_NAMES.every(n => n in P.PRESETS));
  }
  return R;
}

// ==================================================================== 1d. debug/api.ts（假 Game）

/**
 * 装上 api.ts/overlay.ts 在 node 里要用的最小 DOM 替身，返回还原函数。总是覆盖：core.mjs 在同一个进程里先跑别的 WP 的
 * node 侧自测，它们可能留下了形状不同的 globalThis.document（例如没有 setAttribute）。
 */
function installDomStubs() {
  const g = globalThis;
  const keys = ['window', 'document', 'requestAnimationFrame'];
  const saved = keys.map(k => [k, Object.getOwnPropertyDescriptor(g, k)]);
  const el = () => ({ style: {}, className: '', textContent: '', setAttribute() {}, remove() {}, appendChild() {} });
  const def = (k, value) => Object.defineProperty(g, k, { value, configurable: true, writable: true, enumerable: true });
  def('window', g);
  def('requestAnimationFrame', () => 0);   // 性能计时器在 node 里不跑
  def('document', { createElement: el, querySelector: () => null });
  return () => {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(g, k, d);
      else delete g[k];
    }
  };
}

function makeFakeGame(THREE, o = {}) {
  const calls = [];
  const vf = { on: false, lens: 'normal', zoom: 1, frameNdcScale: () => ({ sx: 1, sy: 1 }) };
  const stack = ['mode.explore', ...(o.extraModes ?? [])];
  let advancing = 0;
  let maxConcurrent = 0;
  const game = {
    url: { debug: o.debug !== false, test: true, lockstep: true },
    lockstep: true, time: 0, timeScale: 1, frameNo: 0, ending: 'none',
    settings: { vfMode: o.vfMode ?? 'toggle' },
    host: { appendChild() {} },
    renderer: { info: { render: { calls: 10, triangles: 100 }, memory: { geometries: 5, textures: 3 }, programs: [1, 2] } },
    pipeline: { stats: () => ({ lights: 2, lightsOn: 2, renderScale: 1 }) },
    events: { on: () => () => {} },
    modes: {
      get top() { return stack[stack.length - 1]; },
      get stack() { return [...stack]; },
      has: m => stack.includes(m), arg: () => undefined, freezesWorld: () => stack.includes('mode.pause'),
      isTransient: () => stack.some(m => !['mode.explore', 'mode.viewfinder', 'mode.pause'].includes(m)),
      lookEnabled: () => true, moveMode: () => 'normal', push: (m) => { stack.push(m); return { ok: true }; }, pop: () => { stack.pop(); return { ok: true }; },
    },
    dispatch(a) {
      calls.push(a);
      if (a.t === 'vf') vf.on = a.down ?? !vf.on;
      if (a.t === 'zoom') { const z = [1, 2, 3, 4, 6]; vf.zoom = z[Math.max(0, Math.min(4, z.indexOf(vf.zoom) + a.dir))]; }
      if (a.t === 'lens') { if (o.noIr) return { ok: false, reason: 'no_ability' }; vf.lens = vf.lens === 'ir' ? 'normal' : 'ir'; }
      return { ok: true };
    },
    settle: async () => {
      if (o.settleTimeout) {
        const e = new Error('settle 超时（测试）');
        e.name = 'TimeoutError';
        throw e;
      }
      return 'idle';
    },
    async advance(sec) {
      if (o.hangAdvance) return new Promise(() => {});
      advancing++;
      maxConcurrent = Math.max(maxConcurrent, advancing);
      await new Promise(r => setTimeout(r, o.advanceMs ?? 5));
      game.time += sec;
      advancing--;
    },
    nextFrame: async () => {},
    effects: { busy: !!o.busy, waitingInput: false },
    state: {
      area: 'dev', shichen: 'zi',
      listFlags: () => ({ 'r1.log_taken': true }), listItems: () => [{ id: 'it.log', used: false, order: 1 }], listPhotos: () => [{ id: 'ph.tudi' }],
      listClues: () => [], names: () => ['name.huoji'], antCount: () => 0, seen: () => false,
      debugSet: p => calls.push({ debugSet: p }),
    },
    save: { has: () => false, completed: false, held: false, request: r => calls.push({ save: r }), flushIfSafe() {} },
    sys: {
      viewfinder: vf,
      interaction: { focused: null, get: () => undefined, list: () => [], update() {}, focusCandidate: () => null },
      read: { reading: null, hint: null, evaluate() {}, aimPoint: () => null },
      replay: { active: null, point: () => undefined, seek() {} },
      vcr: { loaded: false, tcString: () => '22:00:00', playing: false, shuttle: 0 },
      cctv: { jack: false, layout: 'single', channel: 1 },
      dialogue: { active: null }, cutscene: { active: null }, panels: { code: null, naming: null },
      tripod: { state: 'off', remaining: 0 },
      shichen: { current: 'zi', clockText: o.throwClock ? () => { throw new Error('clock broke'); } : () => '23:40', resetClock() {} },
      npc: { reevaluate: () => calls.push({ npc: 'reevaluate' }), get: () => undefined },
      photo: { target: () => undefined, decoy: () => undefined, resolveSubject: () => null },
      journal: { doc: () => undefined },
    },
    ui: { currentSubtitle: () => null, lastFeedback: () => null, menus: { select: async () => {} }, setHidden() {} },
    areas: {
      current: { def: { id: 'dev', spawns: { 'spawn.dev_start': {} }, automation: {} }, ctx: { levelsHandle: { current: 1 }, tempSnapshot: () => ({}), getRef: () => undefined }, spawnUsed: 'spawn.dev_start' },
      isLoading: () => false, defs: new Map([['dev', { spawns: { 'spawn.dev_start': {} } }]]),
      goto: async () => ({ ok: true }), route: () => ({ ok: true, hops: [] }), spawnArea: s => { if (s === 'spawn.dev_start') return 'dev'; throw new Error('unknown'); },
    },
    player: { position: new THREE.Vector3(1.23456, 0, 8), yaw: 0, pitch: 0, eye: new THREE.Vector3(1.2, 1.85, 8) },
    cameras: { active: 'tp', camera: new THREE.PerspectiveCamera(), sync() {} },
  };
  return { game, calls, vf, stack, get maxConcurrent() { return maxConcurrent; } };
}

async function testApi(server) {
  const restore = installDomStubs();
  try {
    return await testApiInner(server);
  } finally {
    restore();
  }
}

async function testApiInner(server) {
  const R = makeReport('api');
  const THREE = await server.ssrLoadModule('three');
  const api = await server.ssrLoadModule('/src/debug/api.ts');
  R.t('API_TIMEOUT_MS = 60 秒（ARCH §12.2）', api.API_TIMEOUT_MS === 60_000);
  const F1 = makeFakeGame(THREE);
  const a = api.mountDebugApi(F1.game);
  R.t('挂到 window.__game，window.__cam 是同一个对象', globalThis.window.__game === a && globalThis.window.__cam === a);
  const methods = ['state', 'getState', 'newGame', 'continueGame', 'reload', 'goto', 'teleport', 'walk', 'listInteractables', 'focused', 'interact', 'show',
    'showItem', 'use', 'useItem', 'readDoc', 'vf', 'setViewfinder', 'lens', 'setLensMode', 'zoom', 'aimAt', 'shoot', 'takePhoto', 'replay', 'replaySeek',
    'replayPause', 'replayPlay', 'replayExit', 'dlg', 'advanceDialogue', 'choose', 'chooseDialogOption', 'input', 'enterCode', 'vcr', 'console', 'tripod',
    'bodyGoto', 'back', 'hint', 'wait', 'setTimeScale', 'frame', 'lint', 'perf', 'shot', 'setFlags', 'giveItem', 'givePhoto', 'setState', 'selftest', 'selftests'];
  const missing = methods.filter(m => typeof a[m] !== 'function');
  R.t(`?debug=1：全部 ${methods.length} 个方法（含别名与 ★）都在`, missing.length === 0, missing);
  for (const [x, y] of [['getState', 'state'], ['teleport', 'goto'], ['showItem', 'show'], ['useItem', 'use'], ['setViewfinder', 'vf'], ['setLensMode', 'lens'],
    ['takePhoto', 'shoot'], ['advanceDialogue', 'dlg'], ['chooseDialogOption', 'choose'], ['enterCode', 'input']]) R.t(`${x} 是 ${y} 的别名`, a[x] === a[y]);
  // state()：可 JSON 序列化、位置取整
  const s = await a.state();
  R.t('state() ok', s.ok === true && s.result.area === 'dev' && s.result.floor === 1 && s.result.mode === 'mode.explore', s);
  R.t('state() 可 JSON 往返、pos 是三元数组', JSON.stringify(JSON.parse(JSON.stringify(s))) === JSON.stringify(s) && Array.isArray(s.result.pos) && s.result.pos[0] === 1.235, s.result.pos);
  R.t('state().settle', s.result.settle === 'idle');
  // bad_args
  const badCalls = [
    ['goto', 'nowhere', 0, 0], ['goto', 'dev', 'x', 0], ['walk', 'x', 1], ['vf', 'maybe'], ['lens', 'uv'], ['zoom', 5], ['aimAt', ''], ['wait', -1],
    ['frame', 0], ['setTimeScale', 0], ['choose', 'name.nope'], ['input', 'ab'], ['console', 9], ['tripod', 'go'], ['bodyGoto', 'a', 1],
    ['setFlags', { 'r9.nope': true }], ['setFlags', { 'r1.log_taken': 2 }], ['giveItem', 'it.nope'], ['givePhoto', 'ph.empty_3'],
    ['setState', { spawn: 'spawn.nope' }], ['setState', { area: 'r1', spawn: 'spawn.dev_start' }], ['replay', 5], ['replaySeek', 'x'],
  ];
  for (const [m, ...args] of badCalls) {
    const r = await a[m](...args);
    R.t(`${m}(${args.map(x => JSON.stringify(x)).join(', ')}) → bad_args`, r.ok === false && r.reason === 'bad_args', r);
  }
  // 模式不对
  const r1 = await a.replaySeek(3);
  R.t('不在回放里 replaySeek → mode_disallows', r1.reason === 'mode_disallows');
  const r2 = await a.vcr('play');
  R.t('不在录像机面板 vcr → mode_disallows', r2.reason === 'mode_disallows');
  const r3 = await a.input('0618');
  R.t('没有密码面板 input → no_panel', r3.reason === 'no_panel');
  const r4 = await a.choose(1);
  R.t('没有对话 choose → no_dialogue', r4.reason === 'no_dialogue');
  const r5 = await a.interact('r1.log');
  R.t('本区没有的交互物 → no_such_target', r5.reason === 'no_such_target');
  const r6 = await a.aimAt('nothing');
  R.t('解析不到瞄准点 → no_such_target', r6.reason === 'no_such_target');
  const r7 = await a.reload();
  R.t('dev 沙盒里 reload → mode_disallows（不存档）', r7.reason === 'mode_disallows');
  // vf 幂等 / hold 模式
  F1.calls.length = 0;
  const v1 = await a.vf(true);
  const v2 = await a.vf('on');
  R.t('vf(true) dispatch {t:"vf"}、再调用幂等', v1.ok && v2.ok && F1.calls.filter(c => c.t === 'vf').length === 1 && F1.calls[0].down === undefined, F1.calls);
  const z = await a.zoom(4);
  R.t('zoom(4)：反复 dispatch 直到倍率为 4', z.ok && z.result.zoom === 4 && F1.calls.filter(c => c.t === 'zoom').length === 3, F1.calls);
  const z1 = await a.zoom(1);
  R.t('zoom(1)：往回按', z1.ok && F1.vf.zoom === 1);
  const l1 = await a.lens('ir');
  const l2 = await a.lens('ir');
  R.t('lens 幂等', l1.ok && l2.ok && F1.calls.filter(c => c.t === 'lens').length === 1);
  await a.lens('normal');
  const w = await a.wait(2);
  R.t('wait(2)：推进 2 秒游戏时间', w.ok && Math.abs(w.result.time - 2) < 1e-9, w);
  const w30 = await a.wait(100);
  R.t('wait 单次上限 30 秒', w30.ok && Math.abs(w30.result.time - 32) < 1e-9, w30);
  // ★
  F1.calls.length = 0;
  const sf = await a.setFlags({ 'r1.log_taken': true, 'r2.wang_floor': 3 });
  R.t('setFlags → debugSet + npc.reevaluate + save.request', sf.ok && F1.calls.some(c => c.debugSet) && F1.calls.some(c => c.npc) && F1.calls.some(c => c.save), F1.calls);
  const sel = await a.selftests();
  R.t('selftests() 列出登记的自测', sel.ok && Array.isArray(sel.result));
  const st = await a.selftest('nope.none');
  R.t("selftest('没有的') → no_such_target", st.ok === false && st.reason === 'no_such_target');
  // 非 debug：★ 方法不存在
  const F2 = makeFakeGame(THREE, { debug: false });
  const b = api.mountDebugApi(F2.game);
  R.t('非 ?debug=1：★ 方法不存在', ['shot', 'setFlags', 'giveItem', 'givePhoto', 'setState', 'selftest', 'selftests'].every(m => !(m in b)));
  // hold 模式的取景器
  const F3 = makeFakeGame(THREE, { vfMode: 'hold' });
  const c = api.mountDebugApi(F3.game);
  await c.vf(true);
  R.t('vfMode=hold：dispatch {t:"vf", down:true}', F3.calls.some(x => x.t === 'vf' && x.down === true), F3.calls);
  // 对话/过场/三脚架中：goto / reload / setState → busy
  const F4 = makeFakeGame(THREE, { extraModes: ['mode.dialogue'] });
  const d = api.mountDebugApi(F4.game);
  R.t('对话中 goto → busy', (await d.goto('dev', 0, 0)).reason === 'busy');
  R.t('对话中 reload → busy', (await d.reload()).reason === 'busy');
  R.t('对话中 setState → busy', (await d.setState({ flags: {} })).reason === 'busy');
  // 冻结：暂停菜单里 wait → mode_disallows
  const F5 = makeFakeGame(THREE, { extraModes: ['mode.pause'] });
  const e = api.mountDebugApi(F5.game);
  R.t('冻结时 wait → mode_disallows', (await e.wait(1)).reason === 'mode_disallows');
  // 串行排队：并发发起的调用不交错
  const F6 = makeFakeGame(THREE, { advanceMs: 30 });
  const f = api.mountDebugApi(F6.game);
  const order = [];
  await Promise.all([1, 2, 3].map(i => f.wait(1).then(() => order.push(i))));
  R.t('串行排队：并发调用依次执行、不交错', order.join() === '1,2,3' && F6.maxConcurrent === 1, { order, max: F6.maxConcurrent });
  // 真实时间超时：推进卡死的 dlg({maxReal}) → timeout，队列放行下一个调用
  const F7 = makeFakeGame(THREE, { busy: true, hangAdvance: true });
  const gq = api.mountDebugApi(F7.game);
  const t0 = Date.now();
  const to = await gq.dlg({ maxReal: 300 });
  const after = await gq.focused();
  R.t('真实时间超时 → { ok:false, reason:"timeout" }，附 state 快照', to.ok === false && to.reason === 'timeout' && Date.now() - t0 < 3000 && to.result && to.result.method === 'dlg', to);
  R.t('超时之后队列照常放行', after.ok === true);
  // 异常兜底：内部抛错 → exception（并 console.error，harness 会据此判失败）
  const F8 = makeFakeGame(THREE, { throwClock: true });
  const ex = api.mountDebugApi(F8.game);
  const errs = [];
  const orig = console.error;
  console.error = (...x) => errs.push(x.map(String).join(' '));
  let r8;
  try {
    r8 = await ex.state();
  } finally {
    console.error = orig;
  }
  R.t('内部异常 → { ok:false, reason:"exception" } 并 console.error', r8.ok === false && r8.reason === 'exception' && errs.some(x => x.includes('state')), { r8, errs });
  // Game.settle() 超时 reject TimeoutError（engine-wp1.md #1）→ { ok:false, reason:'timeout' }，不当成引擎异常
  const F9 = makeFakeGame(THREE, { settleTimeout: true });
  const tq = api.mountDebugApi(F9.game);
  const errs2 = [];
  const orig2 = console.error;
  console.error = (...x) => errs2.push(x.map(String).join(' '));
  let r9;
  try {
    r9 = await tq.vf(true);
  } finally {
    console.error = orig2;
  }
  R.t('settle 抛 TimeoutError → timeout（附 state 快照），不打 console.error', r9.ok === false && r9.reason === 'timeout' && r9.result && r9.result.state && errs2.length === 0, { r9, errs2 });
  // jsonSafe
  const js = api.jsonSafe({ v: new THREE.Vector3(1, 2, 3), n: NaN, f: () => 1 });
  R.t('jsonSafe', JSON.stringify(js) === '{"v":[1,2,3],"n":null}', js);
  return R;
}

// ==================================================================== 2. 页面内（M1c 起）

export async function page(h) {
  const R = makeReport('page');
  const call = h.call.try ?? h.call;
  const surface = await h.page.evaluate(() => ({ same: window.__cam === window.__game, n: Object.keys(window.__game).length }));
  R.t('window.__cam === window.__game', surface.same === true);
  for (const n of PAGE_TESTS) {
    const r = await call('selftest', n);
    const res = r && r.result ? r.result : r;
    const pass = r && r.ok === true && res && res.ok === true;
    R.t(`selftest ${n}`, pass, pass ? '' : (res && res.notes ? res.notes.filter(x => !x.startsWith('ok')).join(' | ') : r && r.reason));
  }
  return R;
}

// ==================================================================== 入口

async function nodeTests() {
  const reports = [];
  reports.push(await testCheck());
  const { createServer } = await import('vite');
  const server = await createServer({
    root: ROOT, configFile: false, logLevel: 'error', appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    reports.push(await testData(server));
    reports.push(await testApi(server));
  } finally {
    await server.close();
  }
  reports.push(await testHarness());
  return reports;
}

/** core.mjs 的入口：node 侧 + 页面内（h 在 ?debug=1&area=dev 的沙盒里）。 */
export default async function run(h) {
  const reports = await nodeTests();
  if (h && h.page) reports.push(await page(h));
  const notes = reports.flatMap(r => r.notes);
  return { ok: reports.every(r => r.failed === 0), notes };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const t0 = Date.now();
  let h = null;
  let reports = [];
  try {
    reports = await nodeTests();
    if (process.argv.includes('--page')) {
      const H = await imp('scripts/lib/harness.mjs');
      h = await H.launch({ query: H.DEV_QUERY, label: 'wp7-page' });
      reports.push(await page(h));
      try {
        h.checkErrors('wp7 page');
      } catch (err) {
        const R = makeReport('page');
        R.t('页面没有错误/警告', false, err.message);
        reports.push(R);
      }
    }
  } catch (err) {
    const R = makeReport('fatal');
    R.t('自测跑完', false, err.stack || err.message);
    reports.push(R);
  } finally {
    await h?.close();
  }
  const verbose = process.argv.includes('-v');
  let total = 0;
  let bad = 0;
  for (const r of reports) {
    for (const n of r.notes) {
      if (n.startsWith('ok')) total++;
      if (n.startsWith('FAIL')) { total++; bad++; }
      if (verbose || !n.startsWith('ok')) console.log(n);
    }
  }
  console.log(`\nwp7 selftest：${total - bad}/${total} 通过（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  process.exit(bad ? 1 : 0);
}
