// owner: WP3
// WP3（fx + audio）的最小自测（ARCH §15.2）。页面内自测函数登记在 src/areas/dev/wp3.ts（registerSelftest('wp3.*')）。
//
// 三部分：
//   1. unit()：node 里用 vite 的 runnerImport 直接加载 src/fx、src/audio 的 TS 模块，测纯逻辑（叠加栈规则、预设完整性、
//      红外温度量化/灰度、4:3 画框、《送别》小节拍数……）。不需要浏览器，M1b 就必须通过。
//   2. standalone()：起一个 vite dev 服务器（不需要构建、不需要别的 WP），浏览器里用一个最小的假 Game（真实的 PostPipeline、
//      AudioEngine，替身的区域上下文）布置 dev/wp3.ts 的夹具、调用 warmupArea，然后跑全部 wp3.* 页面内自测；
//      另外用 OfflineAudioContext 把每个音效/环境声/音乐/人声各渲一遍，检查有声、不削波、无报错。M1b 就必须通过。
//   3. run(h)（scripts/core.mjs 自动发现时调用）：unit + 经 window.__game.selftest(name) 在真实游戏的 dev 沙盒里跑 wp3.*（M1c 起必须通过）。
//
// 用法：
//   node scripts/selftest/wp3.mjs              unit + standalone（M1b 默认）
//   node scripts/selftest/wp3.mjs --unit       只跑 unit
//   node scripts/selftest/wp3.mjs --page       unit + 对已构建的 dist/ 跑页面内自测（先 npm run build；--dist=<目录> 指定构建目录）

import path from 'node:path';
import { launchChromium } from '../lib/browserSlots.mjs';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
/** harness 会判失败的 console 警告（ARCH §12.4） */
const BAD_WARN = /GL_INVALID|WebGL:|feedback loop|deprecated|has been removed/i;

export const name = 'wp3';
/** src/areas/dev/wp3.ts 登记的页面内自测（顺序即执行顺序）。 */
export const PAGE_TESTS = [
  'wp3.post_passes',
  'wp3.post_stack',
  'wp3.materials',
  'wp3.crt_material',
  'wp3.feeds',
  'wp3.environment',
  'wp3.ir_restore',
  'wp3.ir_instance_color',
  'wp3.ir_decal_shape',
  'wp3.ir_programs_stable',
  'wp3.audio_locked',
];

// ---------------------------------------------------------------- 小工具

function report(label) {
  const notes = [];
  let failed = 0;
  const t = (what, cond, detail = '') => {
    if (!cond) failed++;
    notes.push(`${cond ? 'ok  ' : 'FAIL'} ${label}: ${what}${detail ? ` — ${detail}` : ''}`);
    return cond;
  };
  return { t, notes, get failed() { return failed; } };
}

function printResults(results) {
  let ok = true;
  for (const [n, r] of Object.entries(results)) {
    const pass = !!r && r.ok === true;
    ok &&= pass;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}`);
    for (const note of r?.notes ?? []) console.log(`        ${note}`);
  }
  return ok && Object.keys(results).length > 0;
}

async function vite() {
  return import(pathToFileURL(path.join(ROOT, 'node_modules/vite/dist/node/index.js')).href);
}

async function playwright() {
  const { createRequire } = await import('node:module');
  return createRequire(path.join(ROOT, 'package.json'))('playwright');
}

// ---------------------------------------------------------------- 1. node 单元测试

export async function unit() {
  const { runnerImport } = await vite();
  const load = async rel => (await runnerImport(path.join(ROOT, rel), { configFile: false, root: ROOT, logLevel: 'error' })).module;
  const post = await load('src/fx/post.ts');
  const presets = await load('src/fx/presets.ts');
  const ir = await load('src/fx/ir.ts');
  const fxShader = await load('src/fx/cameraFxShader.ts');
  const music = await load('src/audio/music.ts');
  const engine = await load('src/audio/engine.ts');
  const r = report('unit');
  const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

  // 预设：全部 PostPresetId 都有；区域基础预设照 GDD §9.2
  const ids = ['r1', 'r1_yin', 'r1_mao', 'r2', 'r3', 'r4', 'r4_market', 'vf', 'replay', 'ir', 'ch1', 'darkroom_red', 'dev'];
  r.t('POST_PRESETS 覆盖全部 PostPresetId', ids.every(k => k in presets.POST_PRESETS));
  const P = presets.POST_PRESETS;
  const gdd = { r1: [0.08, 0.003, 0.45, 0.5], r2: [0.10, 0.004, 0.60, 0.3], r3: [0.07, 0.005, 0.45, 0.7], r4: [0.12, 0.006, 0.55, 0.8] };
  for (const [k, [g, c, v, b]] of Object.entries(gdd)) {
    r.t(`${k} 颗粒/色差/暗角/Bloom = GDD §9.2`, near(P[k].grain, g) && near(P[k].chroma, c) && near(P[k].vignette, v) && near(P[k].bloom.strength, b));
  }
  r.t('寅时颗粒 0.06、卯时 0.04 + 黎明粉', near(P.r1_yin.grain, 0.06) && near(P.r1_mao.grain, 0.04) && P.r1_mao.tintAmt > 0);
  r.t('vf：扫描线 0.25、色差 ×2.5、4:3', near(P.vf.scanline, 0.25) && near(P.vf.chroma, 2.5) && P.vf.frame43 === 1);
  r.t('replay：vhs 1 + 棕绿 tint', P.replay.vhs === 1 && P.replay.tintAmt > 0);
  r.t('ch1 桶形 0.08、darkroom 单红、ir 开', near(P.ch1.barrel, 0.08) && P.darkroom_red.monoRed === 1 && P.ir.ir === 1);
  r.t('R4 有灯管频闪，鬼市没有（灯管熄灭）且偏绿', P.r4.flicker > 0 && P.r4_market.flicker === 0 && P.r4_market.tintAmt > 0);

  // 叠加栈
  const s = new post.FxStack();
  s.setBase('r1');
  let o = s.resolve();
  r.t('base = FX_DEFAULTS ← r1', near(o.grain, 0.08) && near(o.chroma, 0.003) && o.frame43 === 0);
  s.push('vf', P.vf, 0);
  o = s.resolve();
  r.t('vf 层 chroma 乘法（×2.5）', near(o.chroma, 0.0075), `${o.chroma}`);
  s.push('ir', P.ir, 0);
  o = s.resolve();
  r.t('标量取最后定义者（ir 的颗粒 0.18 覆盖）', near(o.grain, 0.18) && o.ir === 1 && o.frame43 === 1);
  s.pop('ir', 0.5);
  s.advance(0.25);
  o = s.resolve();
  r.t('pop 带淡出：一半时权重 0.5', near(o.grain, 0.13) && s.keys().includes('ir'), `${o.grain}`);
  s.advance(0.3);
  r.t('淡出结束后层被移除', !s.keys().includes('ir'));
  s.push('replay', P.replay, 1);
  s.advance(0.5);
  o = s.resolve();
  r.t('push 带淡入：tintAmt 线性插值', near(o.tintAmt, 0.25) && near(o.vhs, 0.5));
  s.push('replay', P.replay, 0);
  r.t('重复 push 同 key 原位更新（不新增层）', s.keys().filter(k => k === 'replay').length === 1 && s.resolve().vhs === 1);
  s.pop('vf');
  s.pop('replay');
  r.t('pop 默认立即移除', s.keys().length === 0);
  const s2 = new post.FxStack();
  s2.setBase('r1', { grain: 0.02, bloom: { strength: 0.1, radius: 0.2, threshold: 0.9 } });
  o = s2.resolve();
  r.t('setBase 的 overrides 生效（含 bloom 对象）', near(o.grain, 0.02) && near(o.bloom.threshold, 0.9) && near(o.chroma, 0.003));

  // 红外
  r.t('0.5℃ 量化', ir.quantizeTemp(36.4) === 36.5 && ir.quantizeTemp(36.2) === 36 && ir.quantizeTemp(3) === 3);
  r.t('灰度 = t/45（0℃→0，45℃→1，60℃ 饱和到 >1 由色带端点钳住）', near(ir.irGray(0), 0) && near(ir.irGray(45), 1) && near(ir.irGray(18), 0.4) && ir.irGray(60) > 1);
  r.t('IrRenderer.tempOf：obj > 材质 > 18', ir.IrRenderer.tempOf({ userData: { tempC: 36 }, material: { userData: { tempC: 6 } } }) === 36
    && ir.IrRenderer.tempOf({ userData: {}, material: { userData: { tempC: 6 } } }) === 6
    && ir.IrRenderer.tempOf({ userData: {} }) === 18);

  // 4:3 画框（与 CameraRig.frameRect 同一定义）
  const f169 = fxShader.frame43Rect(1600, 900);
  r.t('16:9 → 画框与视口同高、居中', near(f169.y, 0) && near(f169.w, 1) && near((f169.z - f169.x) * 1600 / 900, 4 / 3, 1e-9));
  const f34 = fxShader.frame43Rect(600, 800);
  r.t('3:4 → 画框与视口同宽', near(f34.x, 0) && near(f34.z, 1) && near(600 / ((f34.w - f34.y) * 800), 4 / 3, 1e-9));

  // 音乐数据
  const beats = music.totalBeats(music.SONGBIE);
  r.t('《送别》16 小节 × 4 拍', beats === 64 && music.SONGBIE_BASS.length === 16, `${beats} 拍`);
  let bar = 0, acc = 0, barsOk = true;
  for (const n of music.SONGBIE) {
    acc += n.beats;
    if (acc > 4 + 1e-9) barsOk = false;
    if (Math.abs(acc - 4) < 1e-9) { bar++; acc = 0; }
  }
  r.t('《送别》每小节恰好 4 拍（没有跨小节的音）', barsOk && bar === 16);
  r.t('主动机 D–E–A', music.MOTIF_DEA.map(n => n.midi % 12).join(',') === '2,4,9');
  r.t('二胡变奏以 D–E–A 开头', music.ERHU_DEA.slice(0, 3).map(n => n.midi % 12).join(',') === '2,4,9');
  r.t('音频清单完整（29 音效（M1c 加 crt_on）、19 环境声、4 音乐）', engine.SFX_CUES.length === 29 && engine.AMB_PRESETS.length === 19 && engine.MUSIC_CUES.length === 4);

  // AudioEngine 在 node 里（没有 window/AudioContext）：构造与解锁前的调用都是空操作
  const a = new engine.AudioEngine({ muted: true });
  await a.unlock();
  a.sfx('shutter');
  a.music('songbie');
  const hs = a.setAmbience([{ preset: 'rain' }], 0);
  r.t('muted：unlock 后 ctx 仍为 null，调用都是空操作', a.ctx === null && !a.running && hs.length === 1);

  for (const n of r.notes) console.log(n);
  return { ok: r.failed === 0, notes: r.notes };
}

// ---------------------------------------------------------------- 2. 独立页面（假 Game）

const STANDALONE_ENTRY = `
import * as THREE from 'three';
import wp3 from '/src/areas/dev/wp3.ts';
import { listSelftests, runSelftest } from '/src/debug/selftest.ts';
import { PostPipeline } from '/src/fx/post.ts';
import { warmupArea } from '/src/fx/warmup.ts';
import { areaEnvironment } from '/src/fx/environment.ts';
import { AudioEngine, SFX_CUES, AMB_PRESETS } from '/src/audio/engine.ts';
import { createSynthKit } from '/src/audio/synth.ts';
import { playSfx } from '/src/audio/sfx.ts';
import { playMusic } from '/src/audio/music.ts';
import { playMurmur } from '/src/audio/voice.ts';
import { startAmbience } from '/src/audio/ambience.ts';

const W = 800, H = 450;
const renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false });
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1;
renderer.info.autoReset = false;
renderer.setPixelRatio(1);
renderer.setSize(W, H);
document.getElementById('app').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b1020');
scene.fog = new THREE.FogExp2('#141a26', 0.03);
scene.environment = areaEnvironment(renderer, '#5a6aa0');
scene.environmentIntensity = 0.2;
const hemi = new THREE.HemisphereLight('#3a4a70', '#101010', 0.6); scene.add(hemi);
const lamp = new THREE.PointLight('#ff9a3c', 60, 14, 2); lamp.position.set(11, 4, -7); scene.add(lamp);
const cam = new THREE.PerspectiveCamera(60, W / H, 0.05, 200);
cam.position.set(11, 1.8, -4.5); cam.lookAt(11, 1.0, -9.5); cam.updateMatrixWorld();
const post = new PostPipeline(renderer, scene, cam);
post.setSize(W, H, 1);
post.setBase('dev');
const root = new THREE.Group(); scene.add(root);
const refs = new Map();
const ctx = {
  root, scene,
  add(o, opt) {
    (opt?.parent ?? root).add(o);
    if (opt?.ref) refs.set(opt.ref, o);
    if (opt?.tempC !== undefined) o.traverse(c => { if (c.isMesh) c.userData.tempC = opt.tempC; });
    return o;
  },
  ref(id, o) { refs.set(id, o); },
  getRef(id) { return refs.get(id); },
  track(r) { return r; },
};
const game = { renderer, scene, pipeline: { post }, cameras: { camera: cam, fp: cam }, areas: { current: { ctx } }, audio: new AudioEngine({ muted: true }) };

function stats(buf) {
  let s = 0, p = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const v = d[i]; s += v * v; if (Math.abs(v) > p) p = Math.abs(v); if (!Number.isFinite(v)) return { rms: NaN, peak: NaN }; }
  }
  return { rms: Math.sqrt(s / (buf.length * buf.numberOfChannels)), peak: p };
}
function offline(seconds) {
  const ac = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
  const kit = createSynthKit(ac);
  const rt = { kit, ctx: ac, schedule: job => { job(seconds + 10); return () => {}; }, setReverb: () => {} };
  return { rt, ac };
}
async function audioChecks() {
  const notes = [];
  const check = (label, st, minRms) => {
    const good = Number.isFinite(st.rms) && st.rms > minRms && st.peak <= 1.0;
    notes.push((good ? 'ok  ' : 'FAIL') + ' ' + label + ' rms=' + st.rms.toFixed(4) + ' peak=' + st.peak.toFixed(3));
  };
  for (const cue of SFX_CUES) { const { rt, ac } = offline(6.5); playSfx(rt, cue, ac.destination); check('sfx ' + cue, stats(await ac.startRendering()), 1e-4); }
  for (const cue of ['motif_dea', 'songbie', 'erhu_dea']) { const secs = cue === 'songbie' ? 68 : cue === 'erhu_dea' ? 20 : 6; const { rt, ac } = offline(secs); playMusic(rt, cue, ac.destination); check('music ' + cue, stats(await ac.startRendering()), 1e-3); }
  for (const v of ['old_man', 'old_woman', 'man', 'child', 'god']) { const { rt, ac } = offline(3); playMurmur(rt, v, 2.5, ac.destination); check('voice ' + v, stats(await ac.startRendering()), 1e-3); }
  for (const p of AMB_PRESETS) { const { rt, ac } = offline(6); startAmbience(rt, p, ac.destination, {}); check('amb ' + p, stats(await ac.startRendering()), 1e-4); }
  { const { rt, ac } = offline(2); startAmbience(rt, 'crt_whine', ac.destination, { boot: 1 }); const st = stats(await ac.startRendering()); check('amb crt_whine boot（开机声）', st, 0.01); }
  { const { rt, ac } = offline(2); const h = startAmbience(rt, 'rain', ac.destination, { intensity: 0 }); h.set('intensity', 1, 0); check('amb rain set(intensity)', stats(await ac.startRendering()), 0.01); }
  return { ok: notes.every(n => n.startsWith('ok')), notes };
}

window.__wp3run = async () => {
  await wp3.build(ctx);
  post.render(1 / 30);
  await warmupArea(renderer, scene, { fp: cam }, { ir: post.ir, post, replayRoots: [], feeds: [] });
  post.render(1 / 30);
  const out = {};
  for (const n of listSelftests().filter(n => n.startsWith('wp3.'))) {
    const r = await runSelftest(game, n);
    out[n] = r.ok ? r.result : { ok: false, notes: ['selftest → ' + r.reason] };
  }
  out['wp3.audio_offline'] = await audioChecks();
  post.render(1 / 30);
  return out;
};
window.__wp3ready = true;
`;

export async function standalone() {
  const { createServer } = await vite();
  const { chromium } = await playwright();
  const VIRTUAL = 'virtual:wp3-selftest';
  const server = await createServer({
    configFile: false,
    root: ROOT,
    logLevel: 'error',
    server: { port: 5287, strictPort: false, host: '127.0.0.1' },
    plugins: [{
      name: 'wp3-selftest',
      resolveId: id => (id === VIRTUAL ? '\0' + VIRTUAL : null),
      load: id => (id === '\0' + VIRTUAL ? STANDALONE_ENTRY : null),
      configureServer(s) {
        s.middlewares.use('/__wp3', (_req, res) => {
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#000"><div id="app"></div><script type="module" src="/@id/${VIRTUAL}"></script></body></html>`);
        });
      },
    }],
  });
  await server.listen();
  const port = server.config.server.port ?? 5287;
  const browser = await launchChromium(chromium, { args: CHROMIUM_ARGS }, 'wp3');
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const problems = [];
  page.on('pageerror', e => problems.push(`pageerror: ${e}`));
  page.on('console', m => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
    if (m.type() === 'warning' && BAD_WARN.test(m.text())) problems.push(`console.warn: ${m.text()}`);
  });
  try {
    // ?test=1：DEV_CHECKS 开（devAssert 生效），与测试 harness 一致
    await page.goto(`http://127.0.0.1:${port}/__wp3?test=1`);
    await page.waitForFunction(() => window.__wp3ready === true, null, { timeout: 120000 });
    const results = await page.evaluate(() => window.__wp3run());
    results['wp3.console_clean'] = { ok: problems.length === 0, notes: problems.length ? problems : ['ok   没有 pageerror / console.error / GL 警告'] };
    if (process.env.WP3_SHOT) await page.screenshot({ path: process.env.WP3_SHOT });
    return { ok: printResults(results), results };
  } finally {
    await browser.close();
    await server.close();
  }
}

// ---------------------------------------------------------------- 3. 真实游戏里的页面内自测

async function runInPage(page) {
  await page.waitForFunction(() => typeof window.__game === 'object' && typeof window.__game.selftest === 'function', null, { timeout: 90000 });
  const results = {};
  for (const n of PAGE_TESTS) {
    results[n] = await page.evaluate(async t => {
      const r = await window.__game.selftest(t);
      return r.ok ? r.result : { ok: false, notes: [`selftest(${t}) → ${r.reason}`] };
    }, n);
  }
  return { ok: printResults(results), results };
}

/** core.mjs 的入口：h 至少有 page（已在 ?debug=1&area=dev 沙盒里）。 */
export default async function run(h) {
  const u = await unit();
  if (!u.ok) throw new Error('wp3 unit 失败');
  if (!h?.page) throw new Error('wp3 selftest: harness 没有提供 page');
  const p = await runInPage(h.page);
  if (!p.ok) throw new Error(`wp3 selftest 失败：${Object.entries(p.results).filter(([, x]) => !x?.ok).map(([n]) => n).join(', ')}`);
  return p;
}

async function pageAgainstDist(distDir) {
  const harnessPath = path.join(ROOT, 'scripts/lib/harness.mjs');
  const query = 'debug=1&test=1&lockstep=1&quality=low&area=dev&spawn=spawn.dev_start';
  if (fs.existsSync(harnessPath)) {
    const harness = await import(pathToFileURL(harnessPath).href);
    const h = await harness.launch({ query });
    try {
      return await runInPage(h.page);
    } finally {
      await h.close();
    }
  }
  const { preview } = await vite();
  const { chromium } = await playwright();
  const server = await preview({ root: ROOT, build: { outDir: distDir }, preview: { port: 4189, host: '127.0.0.1', strictPort: false } });
  const browser = await launchChromium(chromium, { args: CHROMIUM_ARGS }, 'wp3');
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
    await page.goto(`http://127.0.0.1:${server.config.preview.port ?? 4189}/?${query}`);
    return await runInPage(page);
  } finally {
    await browser.close();
    server.httpServer.close();
  }
}

// ---------------------------------------------------------------- CLI

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const distArg = args.find(a => a.startsWith('--dist='));
  let ok = true;
  try {
    console.log('== wp3 unit');
    ok = (await unit()).ok && ok;
    if (args.includes('--page')) {
      console.log('== wp3 page (dist)');
      ok = (await pageAgainstDist(distArg ? path.resolve(distArg.slice(7)) : path.join(ROOT, 'dist'))).ok && ok;
    } else if (!args.includes('--unit')) {
      console.log('== wp3 standalone');
      ok = (await standalone()).ok && ok;
    }
  } catch (err) {
    console.error(err);
    ok = false;
  }
  console.log(ok ? 'WP3 SELFTEST: OK' : 'WP3 SELFTEST: FAIL');
  process.exit(ok ? 0 : 1);
}
