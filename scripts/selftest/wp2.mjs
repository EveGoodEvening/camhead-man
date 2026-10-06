// owner: WP2
// WP2（rigs + kit）的最小自测（ARCH §15.2）。页面内自测函数登记在 src/areas/dev/wp2.ts（registerSelftest('wp2.*')）。
//
// 三部分：
//   1. unit()：node 里用 vite 的 runnerImport 直接加载 src/rigs、src/kit 的 TS 模块，测不需要画布的纯逻辑
//      （PC_DIMS 的关系、姿势表、designLight 换算、窗格变换、实例化散布、纸人脸格子）。M1b 就必须通过。
//   2. standalone()：起一个 vite dev 服务器（不构建、不需要别的 WP 的运行时），浏览器里用一个只有 renderer 的假 Game
//      跑全部 wp2.* 页面内自测，并用假的区域上下文布置一遍 dev/wp2.ts 的夹具。
//      src/fx/materials.ts 若仍是 M1a 占位（含 notImplemented），自动换成一个最小替身（只在这个测试页里）；
//      --stub-materials 强制用替身，--real-materials 强制用真的。M1b 就必须通过。
//   3. run(h)（scripts/core.mjs 自动发现时调用）：unit + 经 window.__game.selftest(name) 在真实游戏的 dev 沙盒里跑 wp2.*（M1c 起必须通过）。
//
// 用法：
//   node scripts/selftest/wp2.mjs              unit + standalone（M1b 默认）
//   node scripts/selftest/wp2.mjs --unit       只跑 unit
//   node scripts/selftest/wp2.mjs --page       unit + 对已构建的 dist/ 跑页面内自测（先 npm run build；--dist=<目录> 指定构建目录）
//   WP2_SHOT=<png> node scripts/selftest/wp2.mjs   standalone 结束时把夹具截一张图

import path from 'node:path';
import { launchChromium } from '../lib/browserSlots.mjs';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
/** harness 会判失败的 console 警告（ARCH §12.4） */
const BAD_WARN = /GL_INVALID|WebGL:|feedback loop|deprecated|has been removed/i;

export const name = 'wp2';
/** src/areas/dev/wp2.ts 登记的页面内自测（顺序即执行顺序）。 */
export const PAGE_TESTS = [
  'wp2.pc_dims',
  'wp2.player_api',
  'wp2.huang_masked',
  'wp2.huang_pixels',
  'wp2.paper_same_source',
  'wp2.characters',
  'wp2.door',
  'wp2.lamp',
  'wp2.rain',
  'wp2.residue',
  'wp2.text',
  'wp2.build_kit',
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
  const THREE = await import(pathToFileURL(path.join(ROOT, 'node_modules/three/build/three.module.js')).href);
  const head = await load('src/rigs/cameraHead.ts');
  const poses = await load('src/rigs/poses.ts');
  const lamps = await load('src/kit/lamps.ts');
  const windows = await load('src/kit/windows.ts');
  const inst = await load('src/kit/instancing.ts');
  const paper = await load('src/rigs/paper.ts');
  const rng = await load('src/kit/rng.ts');
  const render = await load('src/data/render.ts');
  const r = report('unit');
  const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

  const D = head.PC_DIMS;
  r.t('PC_DIMS = GDD §2.7（1.50 / 1.77 / 1.85 / 1.93 / 1.99 / 2.00，bodyH 1.75）', D.collarY === 1.5 && D.headBottomY === 1.77 && D.lensY === 1.85 && D.stickerY === 1.93 && D.headTopY === 1.99 && D.hatTopY === 2.0 && D.bodyH === 1.75);
  r.t('外壳高 0.22；镜头与贴条都在外壳高度内', near(D.headTopY - D.headBottomY, 0.22, 1e-9) && D.lensY > D.headBottomY && D.stickerY < D.headTopY && D.lensY < D.stickerY);
  r.t('镜面几何：镜头 1.85、贴条 1.93 的反射点落在圆镜 1.55–2.05 内', (D.lensY + D.lensY) / 2 > 1.55 && (D.lensY + D.stickerY) / 2 < 2.05);

  const allPoses = ['stand', 'walk', 'sit', 'crouch', 'raise_arm', 'carry', 'lie', 'look_up'];
  r.t('姿势表覆盖 8 种 Pose', allPoses.every(p => p in poses.POSES));
  r.t('sit：髋前屈 90°、膝屈 90°、下移 0.45', near(poses.POSES.sit.joints.hipL[0], Math.PI / 2) && near(poses.POSES.sit.joints.kneeL[0], -Math.PI / 2) && poses.POSES.sit.bodyDrop === 0.45);
  r.t('lie：整体绕 x 转 90°', near(poses.POSES.lie.rootRotX, Math.PI / 2));
  r.t('raise_arm：右肩抬过头（150°）', poses.POSES.raise_arm.joints.shoulderR[0] > 2.5);

  const pl = lamps.designLight('point', '#FF9A3C', 2.2, 14);
  r.t('designLight(point, 2.2, 14) = PointLight(2.2 × LIGHT_SCALE.point × 14², 14, decay 2)', pl.isPointLight && near(pl.intensity, 2.2 * render.LIGHT_SCALE.point * 14 * 14) && pl.distance === 14 && pl.decay === 2);
  r.t('designLight：layers.enableAll()', pl.layers.mask === (0xffffffff | 0));
  const sp = lamps.designLight('spot', '#FFC98A', 1.5, 8);
  r.t('designLight(spot)：SpotLight，目标挂在灯下（朝下）', sp.isSpotLight && sp.target.parent === sp && sp.target.position.y < 0 && near(sp.intensity, 1.5 * render.LIGHT_SCALE.spot * 8 * 8));

  // 北立面（外法线 -z）：right = -x，up = 一层楼
  const xf = windows.windowTransforms({ origin: [5, 1.5, -10], right: [-1, 0, 0], up: [0, 2.8, 0], cols: 3, rows: 2 }, { w: 1.2, h: 1.4, spacing: 3 });
  const p1 = new THREE.Vector3().setFromMatrixPosition(xf[1]), p3 = new THREE.Vector3().setFromMatrixPosition(xf[3]);
  const n = new THREE.Vector3(0, 0, 1).transformDirection(xf[0]);
  r.t('windowTransforms：3×2 = 6 扇，列距沿 right、行距 = up 长度', xf.length === 6 && near(p1.x, 2, 1e-6) && near(p3.y, 1.5 + 2.8, 1e-6));
  r.t('窗面法线 = right × up（朝楼外 -z），离墙 1cm', near(n.z, -1, 1e-6) && p1.z < -10);
  const xf2 = windows.windowTransforms({ origin: [0, 1.5, 0], right: [1, 0, 0], up: [0, 1, 0], cols: 2, rows: 2 }, { w: 1, h: 1, spacing: 2 });
  r.t('up 为单位向量时行距按 2.8m', near(new THREE.Vector3().setFromMatrixPosition(xf2[2]).y, 4.3, 1e-6));

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const im = inst.scatter(geo, new THREE.MeshBasicMaterial(), [{ pos: [0, 0, 0] }, { pos: [10, 0, 0], rotY: 90, scale: 2 }, { pos: [0, 0, 10], scale: [1, 3, 1] }], ['#ff0000']);
  r.t('scatter：一个 InstancedMesh、count 3、有 boundingSphere、instanceColor', im.isInstancedMesh && im.count === 3 && !!im.boundingSphere && im.boundingSphere.radius > 5 && !!im.instanceColor);
  const m1 = new THREE.Matrix4();
  im.getMatrixAt(1, m1);
  const e = new THREE.Euler().setFromRotationMatrix(m1.clone().scale(new THREE.Vector3(0.5, 0.5, 0.5)));
  r.t('scatter 的 rotY 是度（three 约定）', near(e.y, Math.PI / 2, 1e-6));

  r.t('纸人脸格子按 seed 取模（8 格），负数也合法', paper.faceCellOf(3) === 3 && paper.faceCellOf(11) === 3 && paper.faceCellOf(-1) === 7);
  const a = rng.rng(42), b = rng.rng(42);
  r.t('rng 同 seed 同序列', a() === b() && a() === b());

  for (const note of r.notes) console.log(note);
  return { ok: r.failed === 0, notes: r.notes };
}

// ---------------------------------------------------------------- 2. 独立页面（假 Game）

/** fx/materials.ts 的最小替身（只在 standalone 页面里替换；接口同 MaterialLibrary）。 */
const MATERIALS_STUB = `
import * as THREE from 'three';
const cache = new Map();
const shared = new Set();
function c(k, f, tempC = 18) { let m = cache.get(k); if (!m) { m = f(); m.userData.tempC = tempC; cache.set(k, m); shared.add(m); } return m; }
const std = o => new THREE.MeshStandardMaterial(o);
function sh(color, op) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: op } },
    vertexShader: 'void main(){ vec4 p = vec4(position,1.0);\\n#ifdef USE_INSTANCING\\n p = instanceMatrix * p;\\n#endif\\n gl_Position = projectionMatrix * modelViewMatrix * p; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; void main(){ gl_FragColor = vec4(uColor, uOpacity); }',
    transparent: true, depthWrite: false,
  });
}
export const MATERIALS = {
  brick: () => c('brick', () => std({ color: '#7A3B2E', roughness: 0.9 })), plaster: () => c('plaster', () => std({ color: '#B8B0A0' })),
  lime: () => c('lime', () => std({ color: '#C9C3B5' })), dado: () => c('dado', () => std({ color: '#3F6B5A' })),
  tileWhite: () => c('tw', () => std({ color: '#E4E2D8' })), tileGreenWhite: () => c('tgw', () => std({ color: '#CFE3D6' })),
  concrete: () => c('concrete', () => std({ color: '#6E6E6A' })), asphaltWet: () => c('asphalt', () => std({ color: '#23242a', roughness: 0.3 })),
  wood: () => c('wood', () => std({ color: '#6A4A2E' })), metal: () => c('metal', () => std({ color: '#7A7E84', metalness: 0.6, roughness: 0.45 })),
  tin: () => c('tin', () => std({ color: '#A0A4A6', metalness: 0.6 })), enamelYellow: () => c('ey', () => std({ color: '#E0B84A' })),
  enamelRed: () => c('er', () => std({ color: '#B8322A' })), porcelain: () => c('porc', () => std({ color: '#EEEDE6' })),
  paper: () => c('paper', () => std({ color: '#EDE6D6' }), 6), cloth: col => c('cloth' + new THREE.Color(col).getHexString(), () => std({ color: col })),
  glass: () => c('glass', () => { const m = std({ color: '#9fb6c4', transparent: true, opacity: 0.25 }); m.userData.noOcclude = true; return m; }),
  emissive: (col, i = 1.5) => c('em' + new THREE.Color(col).getHexString() + i, () => std({ color: '#000', emissive: col, emissiveIntensity: i }), 60),
  ghost: (col = '#8FD3D6') => c('ghost' + new THREE.Color(col).getHexString(), () => sh(col, 0.5), 6),
  replay: () => c('replay', () => sh('#8A8A5A', 0.55)), paperGlow: () => c('pglow', () => sh('#E8C35A', 0.6)),
  crtScreen: () => c('crt', () => new THREE.MeshBasicMaterial({ color: '#7CFFB2' })), hitProxy: () => c('hit', () => new THREE.MeshBasicMaterial({ visible: false })),
};
export function isSharedMaterial(m) { return shared.has(m); }
`;

const STANDALONE_ENTRY = `
import * as THREE from 'three';
import wp2 from '/src/areas/dev/wp2.ts';
import { listSelftests, runSelftest } from '/src/debug/selftest.ts';
import { setLayerRecursive } from '/src/core/layers.ts';
import { detectCjk } from '/src/kit/text.ts';

const W = 800, H = 450;
const renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false });
renderer.toneMapping = THREE.NoToneMapping;
renderer.info.autoReset = false;
renderer.setPixelRatio(1);
renderer.setSize(W, H);
document.getElementById('app').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b1020');
scene.add(new THREE.HemisphereLight('#3a4a70', '#101010', 0.8));
const key = new THREE.PointLight('#ff9a3c', 60, 20, 2); key.position.set(0.5, 4, 9); scene.add(key);
const cam = new THREE.PerspectiveCamera(55, W / H, 0.05, 200);
cam.position.set(0.5, 1.8, 7.5); cam.lookAt(0.5, 1.2, 12.5); cam.updateMatrixWorld();
cam.layers.enableAll();
const root = new THREE.Group(); scene.add(root);
const refs = new Map();
const hd = [];
const ctx = {
  root, scene,
  add(o, opt) {
    let lights = 0; o.traverse(c => { if (c.isLight) lights++; });
    if (lights) throw new Error('ctx.add: 子树里有灯');
    (opt?.parent ?? root).add(o);
    if (opt?.layer) setLayerRecursive(o, opt.layer);
    if (opt?.ref) refs.set(opt.ref, o);
    if (opt?.tempC !== undefined) o.traverse(c => { if (c.isMesh) c.userData.tempC = opt.tempC; });
    return o;
  },
  ref(id, o) { refs.set(id, o); },
  getRef(id) { return refs.get(id); },
  hdText(mesh, lo, hi, o) { hd.push({ mesh, lo, hi, o }); },
  track(r) { return r; },
};
const game = { renderer, scene };

window.__wp2run = async () => {
  await document.fonts.ready;
  detectCjk();
  const out = {};
  const b = await Promise.resolve(wp2.build(ctx)).then(() => ({ ok: true, notes: ['ok   夹具布置无报错（' + root.children.length + ' 个对象，hdText ' + hd.length + ' 个）'] }), e => ({ ok: false, notes: ['FAIL 夹具：' + (e && e.stack || e)] }));
  out['wp2.fixtures'] = b;
  renderer.render(scene, cam);
  for (const n of listSelftests().filter(n => n.startsWith('wp2.'))) {
    const r = await runSelftest(game, n);
    out[n] = r.ok ? r.result : { ok: false, notes: ['selftest → ' + r.reason] };
  }
  renderer.setRenderTarget(null);
  renderer.render(scene, cam);
  return out;
};
window.__wp2ready = true;
`;

function materialsIsStub() {
  try {
    return /notImplemented\(/.test(fs.readFileSync(path.join(ROOT, 'src/fx/materials.ts'), 'utf8'));
  } catch {
    return true;
  }
}

export async function standalone(o = {}) {
  const { createServer } = await vite();
  const { chromium } = await playwright();
  const VIRTUAL = 'virtual:wp2-selftest';
  const stub = o.stubMaterials ?? materialsIsStub();
  console.log(`   （fx/materials：${stub ? '替身' : '真实实现'}）`);
  const materialsPath = path.join(ROOT, 'src/fx/materials.ts');
  const server = await createServer({
    configFile: false,
    root: ROOT,
    logLevel: 'error',
    server: { port: 5288, strictPort: false, host: '127.0.0.1' },
    plugins: [{
      name: 'wp2-selftest',
      enforce: 'pre',
      resolveId: id => (id === VIRTUAL ? '\0' + VIRTUAL : null),
      load: id => {
        if (id === '\0' + VIRTUAL) return STANDALONE_ENTRY;
        if (stub && id.split('?')[0] === materialsPath) return MATERIALS_STUB;
        return null;
      },
      configureServer(s) {
        s.middlewares.use('/__wp2', (_req, res) => {
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#000"><div id="app"></div><script type="module" src="/@id/${VIRTUAL}"></script></body></html>`);
        });
      },
    }],
  });
  await server.listen();
  const port = server.config.server.port ?? 5288;
  const browser = await launchChromium(chromium, { args: CHROMIUM_ARGS }, 'wp2');
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const problems = [];
  page.on('pageerror', e => problems.push(`pageerror: ${e}`));
  page.on('console', m => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
    if (m.type() === 'warning' && BAD_WARN.test(m.text())) problems.push(`console.warn: ${m.text()}`);
  });
  try {
    // ?test=1：DEV_CHECKS 开（devAssert 生效），与测试 harness 一致
    await page.goto(`http://127.0.0.1:${port}/__wp2?test=1`);
    await page.waitForFunction(() => window.__wp2ready === true, null, { timeout: 120000 });
    const results = await page.evaluate(() => window.__wp2run());
    results['wp2.console_clean'] = { ok: problems.length === 0, notes: problems.length ? problems : ['ok   没有 pageerror / console.error / GL 警告'] };
    if (process.env.WP2_SHOT) await page.screenshot({ path: process.env.WP2_SHOT });
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
  if (!u.ok) throw new Error('wp2 unit 失败');
  if (!h?.page) throw new Error('wp2 selftest: harness 没有提供 page');
  const p = await runInPage(h.page);
  if (!p.ok) throw new Error(`wp2 selftest 失败：${Object.entries(p.results).filter(([, x]) => !x?.ok).map(([n]) => n).join(', ')}`);
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
  const server = await preview({ root: ROOT, build: { outDir: distDir }, preview: { port: 4190, host: '127.0.0.1', strictPort: false } });
  const browser = await launchChromium(chromium, { args: CHROMIUM_ARGS }, 'wp2');
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
    await page.goto(`http://127.0.0.1:${server.config.preview.port ?? 4190}/?${query}`);
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
    console.log('== wp2 unit');
    ok = (await unit()).ok && ok;
    if (args.includes('--page')) {
      console.log('== wp2 page (dist)');
      ok = (await pageAgainstDist(distArg ? path.resolve(distArg.slice(7)) : path.join(ROOT, 'dist'))).ok && ok;
    } else if (!args.includes('--unit')) {
      console.log('== wp2 standalone');
      const stubMaterials = args.includes('--stub-materials') ? true : args.includes('--real-materials') ? false : undefined;
      ok = (await standalone({ stubMaterials })).ok && ok;
    }
  } catch (err) {
    console.error(err);
    ok = false;
  }
  console.log(ok ? 'WP2 SELFTEST: OK' : 'WP2 SELFTEST: FAIL');
  process.exit(ok ? 0 : 1);
}
