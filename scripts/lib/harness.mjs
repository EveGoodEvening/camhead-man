// owner: WP7
// 测试 harness（ARCH §12.4）：vite preview 起静态服务（对已构建的 dist/）→ 无头 Chromium（SwiftShader 参数）→ 打开游戏 → call()/expect() 工具。
//
// 失败判定：pageerror、console.error、以及匹配 BAD_WARN 的 console 警告（GL_INVALID…、WebGL:、feedback loop、deprecated、has been removed；
// GL 反馈环在 Chrome 里只报 warning）都收集进 h.errors，h.checkErrors() 有则抛错（ARCH §14.1 第 4 条）。
//
// 并行：CAMERA_DIST（构建目录，默认 <repo>/dist）、CAMERA_PORT（起始端口，默认 4179，被占用时自动往后找）两个环境变量，
// 也可以用 launch({ dist, port }) 传入。脚本不自动构建：先 npm run build（或 vite build --outDir <dir>）。
// 负载很高时：CAMERA_SLOW=k（1–20）给带 test=1 的页面加 ?slow=k，页面内与 Node 侧的真实时间超时都乘 k（M4；缺省 1 = 原样）。
//
// 用法：
//   const h = await launch({ query: 'debug=1&test=1&lockstep=1&quality=low&area=dev' });
//   try { await h.call('goto', 'dev', 0, 8); const r = await h.call.try('interact', 'r1.log'); ... h.checkErrors(); }
//   finally { await h.close(); }
// call(m, ...a)：ok=false 时抛出 `${m}(${a}) → ${reason}`；call.try(m, ...a)：不抛，返回 ApiResult；两者都有 Node 侧真实时间超时
// （默认 90 秒，比页面内 60 秒略长；dlg({maxReal}) 自动放宽），超时即截图、打印 state() 并失败。
// expect.*：对最近一次 refresh() 得到的 state() 快照（h.snap）与最近一次调用结果（h.last）做同步断言；check.* 是先 refresh 再断言的异步版本。

import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './browserSlots.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
/** 这些 console 警告视为错误（ARCH §12.4、§14.1）。 */
export const BAD_WARN = /GL_INVALID|WebGL:|feedback loop|deprecated|has been removed/i;
export const DEFAULT_QUERY = 'new=1&test=1&lockstep=1&quality=low';
export const DEV_QUERY = 'debug=1&test=1&lockstep=1&quality=low&area=dev';
export const ARTIFACTS = path.join(ROOT, 'test-artifacts');
/** Node 侧真实时间超时（ARCH §12.4）。 */
export const CALL_TIMEOUT_MS = 90_000;
/** M4：CAMERA_SLOW=k —— 高负载机器上把真实时间超时（页面内 ?slow=k 与 Node 侧）一起放宽 k 倍。 */
export const SLOW = Math.min(20, Math.max(1, Number(process.env.CAMERA_SLOW) || 1));
function withSlow(query) {
  if (SLOW === 1 || !/(^|&)test=1(&|$)/.test(query) || /(^|&)slow=/.test(query)) return query;
  return `${query}&slow=${SLOW}`;
}
const LONG_CALLS = new Set(['selftest', 'shot', 'newGame', 'continueGame', 'reload', 'setState']);

// ==================================================================== 小工具

export class HarnessError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'HarnessError';
    Object.assign(this, extra);
  }
}

/** 解析 --a --b=1 形式的参数：{ a: true, b: '1', _: [位置参数] }。 */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
    else out._.push(a);
  }
  return out;
}

export function artifactDir(sub = '') {
  const d = path.join(ARTIFACTS, sub);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function distDir(dist) {
  return path.resolve(dist ?? process.env.CAMERA_DIST ?? path.join(ROOT, 'dist'));
}

const fmtArgs = args => args.map(a => JSON.stringify(a)).join(', ');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 值为真：布尔 true，或数值 flag > 0（与 StateView.flag 同义）。 */
const truthy = v => v === true || (typeof v === 'number' && v > 0);

/** 按点路径取值；'flags.<id>' 的 id 本身带点，整体当键。 */
export function getPath(obj, p) {
  if (p.startsWith('flags.')) return obj?.flags?.[p.slice(6)];
  return p.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ==================================================================== PNG 解码（shots.mjs 的亮度验收；不引入依赖）

/** 解码 8 位、非隔行的 PNG（Chromium 截图的格式）→ { width, height, data: RGBA Uint8Array }。 */
export function decodePng(buf) {
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') throw new Error('不是 PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`不支持的 PNG：bitDepth=${bitDepth} interlace=${interlace}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`不支持的 PNG colorType ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
    prev = cur;
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    let r;
    let g;
    let b;
    let al = 255;
    if (colorType === 0) r = g = b = px[s];
    else if (colorType === 4) { r = g = b = px[s]; al = px[s + 1]; }
    else if (colorType === 3) { r = palette[px[s] * 3]; g = palette[px[s] * 3 + 1]; b = palette[px[s] * 3 + 2]; }
    else { r = px[s]; g = px[s + 1]; b = px[s + 2]; if (channels === 4) al = px[s + 3]; }
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = al;
  }
  return { width, height, data };
}

/** 亮度（0–1，sRGB 编码值的 Rec.709 加权，即人眼看到的明暗）。 */
export function luma(data, i) {
  return (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
}

/**
 * 整图平均亮度、“亮度 > hi 的像素占比”，以及（M4 第 2 轮）先做 3×3 盒式模糊再取的亮度第 99.5 百分位 coreP995——
 * shots.mjs 的高光验收改看它（ARCH §12.4）：单像素的雨丝、胶片颗粒、VHS 雪花被模糊掉，只有成片的亮核（灯芯、亮窗、CRT、霓虹）
 * 才撑得起第 99.5 百分位；原来逐像素数“> 0.8 的占比”对这些随机噪点很敏感，好几张图贴着 0.5% 抖。
 */
export function lumaStats(img, hi = 0.8) {
  const w = img.width, h = img.height;
  const n = w * h;
  const L = new Float32Array(n);
  let sum = 0;
  let bright = 0;
  for (let i = 0; i < n; i++) {
    const l = luma(img.data, i * 4);
    L[i] = l;
    sum += l;
    if (l > hi) bright++;
  }
  // 3×3 盒式模糊（可分离：先横后竖；边缘按实际像素数平均）→ 直方图取第 99.5 百分位
  const rowB = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      let s = L[o + x], c = 1;
      if (x > 0) { s += L[o + x - 1]; c++; }
      if (x < w - 1) { s += L[o + x + 1]; c++; }
      rowB[o + x] = s / c;
    }
  }
  const BINS = 1024;
  const hist = new Uint32Array(BINS);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let s = rowB[i], c = 1;
      if (y > 0) { s += rowB[i - w]; c++; }
      if (y < h - 1) { s += rowB[i + w]; c++; }
      hist[Math.min(BINS - 1, Math.floor((s / c) * BINS))]++;
    }
  }
  let acc = 0;
  let core = 0;
  const want = n * 0.995;
  for (let b = 0; b < BINS; b++) {
    acc += hist[b];
    if (acc >= want) {
      core = (b + 0.5) / BINS;
      break;
    }
  }
  return { mean: sum / n, brightFrac: n ? bright / n : 0, coreP995: core };
}

/** (x, y) 周围 size×size 像素的平均亮度（越界的像素不算）。 */
export function patchLuma(img, x, y, size = 5) {
  const r = Math.floor(size / 2);
  let sum = 0;
  let n = 0;
  for (let yy = Math.round(y) - r; yy <= Math.round(y) + r; yy++) {
    for (let xx = Math.round(x) - r; xx <= Math.round(x) + r; xx++) {
      if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue;
      sum += luma(img.data, (yy * img.width + xx) * 4);
      n++;
    }
  }
  return n ? sum / n : 0;
}

// ==================================================================== 静态服务

/** vite preview 起 dist 的静态服务；端口被占用时自动往后找（并行跑多个脚本时用 CAMERA_PORT 错开起点）。 */
export async function startServer({ dist, port } = {}) {
  const d = distDir(dist);
  if (!fs.existsSync(path.join(d, 'index.html'))) {
    throw new HarnessError(`找不到构建产物 ${d}/index.html：先 npm run build（或 vite build --outDir <dir> 并设 CAMERA_DIST）`);
  }
  const { preview } = await import('vite');
  const want = Number(port ?? process.env.CAMERA_PORT ?? 4179);
  // vite 的 preview() 会把 process.env.NODE_ENV 设成 'production' 且不还原；同一进程里之后再起的 vite dev 服务器
  // （各 WP 的 node 侧自测用 ssrLoadModule）就会得到 import.meta.env.DEV === false，“dev 下抛错”的用例全部失败。
  const nodeEnv = process.env.NODE_ENV;
  let server;
  try {
    server = await preview({
      root: ROOT, configFile: false, logLevel: 'error',
      build: { outDir: d },
      preview: { port: want, host: '127.0.0.1', strictPort: false },
    });
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
  const addr = server.httpServer.address();
  const actual = typeof addr === 'object' && addr ? addr.port : want;
  return {
    server, dist: d, port: actual, url: `http://127.0.0.1:${actual}`,
    async close() {
      if (typeof server.close === 'function') await server.close();
      else await new Promise(r => server.httpServer.close(() => r()));
    },
  };
}

// ==================================================================== launch

/**
 * 启动 preview + Chromium，打开 `/?${query}`，等 window.__game 出现且 state().loading === false。
 * 返回 harness 句柄 h（见文件头）。选项：query、viewport、port、dist、headless、bootTimeout、callTimeout、waitReady、deviceScaleFactor、
 * label（失败截图的文件名前缀）、dumpOnTimeout（默认 true：调用超时即截图并打印 state()；故意测超时的自测关掉它）。
 */
export async function launch(opts = {}) {
  const {
    query = DEFAULT_QUERY, viewport = { width: 800, height: 450 }, port, dist, headless = true,
    bootTimeout = 120_000, callTimeout = CALL_TIMEOUT_MS, waitReady = true, deviceScaleFactor = 1, label = 'harness', dumpOnTimeout = true,
  } = opts;
  const srv = await startServer({ dist, port });
  const { chromium } = await import('playwright');
  let browser;
  try {
    browser = await launchChromium(chromium, { args: CHROMIUM_ARGS, headless }, label);
  } catch (err) {
    await srv.close();
    throw err;
  }
  const context = await browser.newContext({ viewport, deviceScaleFactor });
  const page = await context.newPage();
  const h = makeHandle({ page, browser, context, srv, callTimeout, bootTimeout, label });
  h.dumpOnTimeout = dumpOnTimeout;
  try {
    await h.goto(query, { waitReady });
  } catch (err) {
    await h.close();
    throw err;
  }
  return h;
}

function makeHandle({ page, browser, context, srv, callTimeout, bootTimeout, label }) {
  const errors = [];
  const allowed = [];
  const isAllowed = text => allowed.some(re => re.test(text));
  page.on('pageerror', e => {
    const text = String(e && e.stack ? e.stack : e);
    if (!isAllowed(text)) errors.push({ kind: 'pageerror', text });
  });
  page.on('console', m => {
    const type = m.type();
    const text = m.text();
    if (type === 'error') {
      if (!isAllowed(text)) errors.push({ kind: 'console.error', text });
    } else if ((type === 'warning' || type === 'warn') && BAD_WARN.test(text)) {
      if (!isAllowed(text)) errors.push({ kind: 'console.warning', text });
    }
  });

  const h = {
    page, browser, context, server: srv.server, url: srv.url, port: srv.port, dist: srv.dist, errors, label,
    /** 最近一次 refresh() 的 state() 快照（expect.* 用） */
    snap: null,
    /** 最近一次 call/call.try 的结果 */
    last: null,
    /** 允许出现的错误（正则），例如故意制造的错误反馈测试；只在确有必要时用 */
    allowErrors(re) {
      allowed.push(re);
    },
    clearErrors() {
      errors.length = 0;
    },
    /** 有收集到的错误就抛（ARCH §14.1 第 4 条）。 */
    checkErrors(what = label) {
      if (!errors.length) return;
      const lines = errors.map(e => `  [${e.kind}] ${e.text.split('\n').slice(0, 6).join('\n    ')}`);
      throw new HarnessError(`${what}：页面出现 ${errors.length} 条错误/警告\n${lines.join('\n')}`, { errors: [...errors] });
    },
    async goto(query, { waitReady = true } = {}) {
      await page.goto(`${srv.url}/?${withSlow(query)}`);
      if (waitReady) await waitForGame(h, bootTimeout * SLOW);
    },
    async screenshot(file, o = {}) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      return page.screenshot({ path: file, ...o });
    },
    async close() {
      try {
        await browser.close();
      } catch {
        /* 已关闭 */
      }
      await srv.close().catch(() => {});
    },
    async refresh() {
      h.snap = await h.state();
      return h.snap;
    },
    async state() {
      const r = await rawCall(h, 'state', [], callTimeout);
      if (!r || !r.ok) throw new HarnessError(`state() → ${r ? r.reason : 'null'}`, { result: r });
      return r.result;
    },
    assert(cond, msg = 'assert') {
      if (!cond) throw new HarnessError(`断言失败：${msg}`);
    },
  };

  const call = async (method, ...args) => {
    const r = await rawCall(h, method, args, callTimeout);
    h.last = r;
    if (!r || r.ok !== true) {
      const err = new HarnessError(`${method}(${fmtArgs(args)}) → ${r ? r.reason : 'null'}${r && r.result !== undefined ? ` ${JSON.stringify(r.result).slice(0, 400)}` : ''}`, { result: r });
      throw err;
    }
    return r.result;
  };
  call.try = async (method, ...args) => {
    const r = await rawCall(h, method, args, callTimeout);
    h.last = r;
    return r;
  };
  h.call = call;
  h.expect = makeExpect(h);
  h.check = makeCheck(h);
  return h;
}

/** 等 window.__game 出现（或启动失败页出现）且 state().loading === false。 */
async function waitForGame(h, timeoutMs) {
  const t0 = Date.now();
  const kind = await h.page.waitForFunction(() => {
    if (document.querySelector('.cm-boot-error')) return 'boot-error';
    return typeof window.__game === 'object' && window.__game !== null ? 'api' : false;
  }, null, { timeout: timeoutMs, polling: 100 }).then(x => x.jsonValue());
  if (kind === 'boot-error') {
    const text = await h.page.evaluate(() => document.querySelector('.cm-boot-error')?.textContent ?? '');
    throw new HarnessError(`游戏启动失败：${text.trim()}\n${h.errors.map(e => `  [${e.kind}] ${e.text.split('\n')[0]}`).join('\n')}`);
  }
  for (;;) {
    const r = await rawCall(h, 'state', [], Math.max(1000, timeoutMs - (Date.now() - t0)));
    if (r && r.ok && r.result && r.result.loading === false) return;
    if (Date.now() - t0 > timeoutMs) throw new HarnessError(`等待游戏就绪超时（${timeoutMs}ms）：${JSON.stringify(r).slice(0, 300)}`);
    await sleep(100);
  }
}

function timeoutFor(method, args, base) {
  if ((method === 'dlg' || method === 'advanceDialogue') && args[0] && typeof args[0].maxReal === 'number') return Math.max(base, args[0].maxReal + 30_000) * SLOW;
  if (LONG_CALLS.has(method)) return Math.max(base, 300_000) * SLOW;
  return base * SLOW;
}

/** page.evaluate(window.__game[m](...a))，带 Node 侧真实时间超时；超时截图并打印 state()。 */
async function rawCall(h, method, args, base) {
  const ms = timeoutFor(method, args, base);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new HarnessError(`${method}(${fmtArgs(args)}) 超时（Node 侧 ${ms}ms）`)), ms);
  });
  const run = h.page.evaluate(async ([m, a]) => {
    const g = window.__game;
    if (!g) return { ok: false, reason: 'no_api' };
    if (typeof g[m] !== 'function') return { ok: false, reason: 'no_such_method' };
    return await g[m](...a);
  }, [method, args]);
  try {
    const r = await Promise.race([run, timeout]);
    if (r && r.reason === 'timeout' && method !== 'state' && h.dumpOnTimeout) await dumpFailure(h, `timeout-${method}`, r.result && r.result.state);
    return r;
  } catch (err) {
    if (err instanceof HarnessError && h.dumpOnTimeout) await dumpFailure(h, `timeout-${method}`, null);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 失败现场：截图到 test-artifacts/fail/，打印 state()（取不到就算了）。 */
export async function dumpFailure(h, tag, st) {
  const file = path.join(artifactDir('fail'), `${h.label}-${tag}-${Date.now()}.png`.replace(/[^\w.-]+/g, '_'));
  await h.page.screenshot({ path: file }).catch(() => {});
  let s = st;
  if (!s) {
    s = await Promise.race([
      h.page.evaluate(async () => (window.__game ? (await window.__game.state()).result : null)).catch(() => null),
      sleep(5000).then(() => null),
    ]);
  }
  console.error(`  现场截图：${path.relative(ROOT, file)}`);
  if (s) console.error(`  state(): ${JSON.stringify(s, null, 0).slice(0, 4000)}`);
}

// ==================================================================== expect

function makeExpect(h) {
  const snap = () => {
    if (!h.snap) throw new HarnessError('expect.*：还没有 state() 快照（先 await h.refresh()）');
    return h.snap;
  };
  const fail = msg => {
    throw new HarnessError(`expect 失败：${msg}`);
  };
  const ex = {
    /** 这些 flag 都为真（数值 flag > 0）。 */
    flags(...ids) {
      const s = snap();
      const miss = ids.filter(id => !truthy(s.flags[id]));
      if (miss.length) fail(`flag 未设置：${miss.join(', ')}`);
    },
    /** 这些 flag 都未设置（验证“错误反馈不改 flag”）。 */
    noFlags(...ids) {
      const s = snap();
      const set = ids.filter(id => truthy(s.flags[id]));
      if (set.length) fail(`flag 不该被设置：${set.join(', ')}`);
    },
    /** 快照里 path 的值等于 value（深比较；'flags.<id>' 取 flag）。 */
    eq(p, value) {
      const got = getPath(snap(), p);
      if (!sameJson(got, value)) fail(`${p} = ${JSON.stringify(got)}，期望 ${JSON.stringify(value)}`);
    },
    /** 物品或照片在身上。 */
    has(...ids) {
      const s = snap();
      const miss = ids.filter(id => !s.items.some(i => i.id === id) && !s.photos.includes(id));
      if (miss.length) fail(`没有：${miss.join(', ')}`);
    },
    /** 物品已用过。 */
    used(...ids) {
      const s = snap();
      const miss = ids.filter(id => !s.items.some(i => i.id === id && i.used));
      if (miss.length) fail(`物品未标记已用：${miss.join(', ')}`);
    },
    /** 称呼表含该称呼。 */
    name(...ids) {
      const s = snap();
      const miss = ids.filter(id => !s.names.includes(id));
      if (miss.length) fail(`称呼表没有：${miss.join(', ')}`);
    },
    mode(m) {
      const got = snap().mode;
      if (got !== m) fail(`mode = ${got}，期望 ${m}`);
    },
    /**
     * 反馈文本含 substr：依次看 r（默认最近一次调用结果）的 result.feedback / caption / text / chosen，
     * 以及快照的 lastFeedback、subtitle、reading、readHint、dialogue.text、doc.text（打开着的文档阅读器，M3）（ARCH §12.4：result.feedback / state().lastFeedback / 空镜标题）。
     */
    feedback(substr, r = h.last) {
      const res = r && r.result && typeof r.result === 'object' ? r.result : {};
      const s = h.snap ?? {};
      const cands = [res.feedback, res.caption, res.text, res.chosen, s.lastFeedback, s.subtitle, s.reading && s.reading.text, s.readHint, s.dialogue && s.dialogue.text, s.doc && s.doc.text]
        .filter(x => typeof x === 'string');
      if (!cands.some(x => x.includes(substr))) fail(`没有看到反馈“${substr}”；候选：${JSON.stringify(cands)}`);
    },
    /** 调用结果（默认最近一次）的 ok/reason。 */
    reason(reason, r = h.last) {
      if (!r || r.ok !== false || r.reason !== reason) fail(`期望 { ok:false, reason:'${reason}' }，实际 ${JSON.stringify(r).slice(0, 300)}`);
    },
    ok(cond, msg = 'ok') {
      if (!cond) fail(msg);
    },
  };
  return ex;
}

/** expect.* 的异步版本：先 refresh() 再断言（step.run 里随手断言用）。 */
function makeCheck(h) {
  const out = {};
  for (const k of ['flags', 'noFlags', 'eq', 'has', 'used', 'name', 'mode', 'feedback']) {
    out[k] = async (...a) => {
      await h.refresh();
      h.expect[k](...a);
    };
  }
  return out;
}

// ==================================================================== 文档阅读器（M3：墙上文档 E.doc / GameApi.openDoc）

/**
 * 对 target 按 E，断言文档阅读器依次打开 docs 里的每一张（[docId, 正文应含的子串?]），逐张 back() 合上；
 * 最后断言阅读器已合上（连读几张的交互物，如 R1 公告栏：拆迁公告 → 讣告 → 停水通知）。返回每张的正文。
 */
export async function readDocs(h, target, docs) {
  await h.call('interact', target);
  const texts = [];
  for (const [docId, substr] of docs) {
    const s = await h.refresh();
    if (s.mode !== 'mode.journal' || !s.doc || s.doc.id !== docId) {
      throw new HarnessError(`${target}：应在文档阅读器里打开 ${docId}，实际 mode=${s.mode} doc=${JSON.stringify(s.doc)}`);
    }
    if (substr && !s.doc.text.includes(substr)) throw new HarnessError(`${target}：${docId} 的正文里没有“${substr}”：${JSON.stringify(s.doc.text)}`);
    texts.push(s.doc.text);
    await h.call('back');
  }
  const s = await h.refresh();
  if (s.mode === 'mode.journal') throw new HarnessError(`${target}：读完 ${docs.length} 张后阅读器还开着：${JSON.stringify(s.doc)}`);
  return texts;
}

// ==================================================================== 步骤表执行器（walkthrough.mjs 与 regions/*.mjs 共用）

/** reload() 前后进度一致（flags、物品、照片、线索、称呼），模式回到 explore（ARCH §15.5 读档复验）。 */
export async function reloadCheck(h, tag = '') {
  const s0 = await h.state();
  await h.call('reload');
  const s1 = await h.state();
  for (const k of ['flags', 'items', 'photos', 'clues', 'names']) {
    const a = k === 'items' ? [...s0[k]].sort((x, y) => x.id.localeCompare(y.id)) : k === 'flags' ? s0[k] : [...s0[k]].sort();
    const b = k === 'items' ? [...s1[k]].sort((x, y) => x.id.localeCompare(y.id)) : k === 'flags' ? s1[k] : [...s1[k]].sort();
    if (!sameJson(k === 'flags' ? sortKeys(a) : a, k === 'flags' ? sortKeys(b) : b)) {
      throw new HarnessError(`reload()${tag} 后 ${k} 不一致：\n  前 ${JSON.stringify(a)}\n  后 ${JSON.stringify(b)}`);
    }
  }
  if (s1.mode !== 'mode.explore') throw new HarnessError(`reload()${tag} 后模式应为 explore，实际 ${s1.mode}`);
  return s1;
}

function sortKeys(o) {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * 按步骤表执行：step = { n, title?, optional?, blockedBy?, run(g), expect?(g) }；g 就是 harness 句柄。
 * run 之后自动 refresh() 再调用 expect（expect 里的 g.expect.* 是同步断言）。遇到第一个失败即停（后面的步骤依赖前面的状态）。
 * 选项：main（跳过 optional）、from、until、shots（每步截图到 test-artifacts/<name>/NN.png）、reloadAt（这些步骤之后 reload 复验）、
 * beforeEach(g, step)（例如 hint 检查）、name。
 */
export async function runSteps(h, steps, opts = {}) {
  const { main = false, from = 1, until = Infinity, shots = false, reloadAt = [], beforeEach = null, name = 'walk' } = opts;
  const summary = { passed: 0, skipped: 0, blocked: [], failed: null };
  const shotDir = shots ? artifactDir(name) : null;
  for (const step of steps) {
    if (step.n < from) continue;
    if (step.n > until) break;
    const tag = `步骤 ${String(step.n).padStart(2, '0')}${step.title ? ` ${step.title}` : ''}`;
    if (main && step.optional) {
      summary.skipped++;
      console.log(`  skip  ${tag}（可选）`);
    } else if (step.blockedBy) {
      summary.blocked.push({ n: step.n, by: step.blockedBy });
      console.log(`  BLOCK ${tag} → ${step.blockedBy}`);
    } else {
      const t0 = Date.now();
      try {
        if (beforeEach) await beforeEach(h, step);
        await step.run(h);
        await h.refresh();
        if (step.expect) await step.expect(h);
        h.checkErrors(tag);
        summary.passed++;
        console.log(`  ok    ${tag}（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
        if (shotDir) await h.screenshot(path.join(shotDir, `${String(step.n).padStart(2, '0')}.png`));
      } catch (err) {
        summary.failed = { n: step.n, error: err };
        console.error(`  FAIL  ${tag}：${err && err.message ? err.message : err}`);
        await dumpFailure(h, `step${step.n}`, null);
        return summary;
      }
    }
    if (reloadAt.includes(step.n)) {
      try {
        await reloadCheck(h, `（步骤 ${step.n} 之后）`);
        console.log(`  ok    reload() 复验（步骤 ${step.n} 之后）`);
      } catch (err) {
        summary.failed = { n: step.n, error: err };
        console.error(`  FAIL  reload() 复验（步骤 ${step.n} 之后）：${err.message}`);
        await dumpFailure(h, `reload${step.n}`, null);
        return summary;
      }
    }
  }
  return summary;
}

// ==================================================================== 单区域测试执行器（regions/*.mjs 共用，ARCH §15.4）

/**
 * 从干净的新游戏重建前置：newGame() → dlg() 跑完开场 → setState(预置 + extra)。
 * extra = { flags, items, photos, area, spawn }（覆盖预置里的同名项；area/spawn 缺省用预置的起点）。
 */
export async function freshState(h, preset, extra = {}) {
  const { presetPatch } = await import('./presets.mjs');
  await h.call('newGame');
  await h.call('dlg');
  if (preset === 'new' && !extra.flags && !extra.items && !extra.photos && !extra.area && !extra.spawn) return;
  const base = preset === 'new' ? { flags: {}, items: [], photos: [] } : presetPatch(preset);
  const patch = {
    flags: { ...base.flags, ...(extra.flags ?? {}) },
    items: [...base.items, ...(extra.items ?? [])],
    photos: [...base.photos, ...(extra.photos ?? [])],
  };
  const area = extra.area ?? base.area ?? 'r1';
  const spawn = extra.spawn ?? (extra.area ? undefined : base.spawn ?? 'spawn.r1_start');
  await h.call('setState', { ...patch, area, ...(spawn ? { spawn } : {}) });
}

/**
 * regions/<id>.mjs 的主流程：
 *   phases：[{ preset, steps, route?, label? }] —— 每段从预置开始按 §11 步骤表跑（runSteps），遇到失败即停该段；
 *   cases： [{ name, puzzle?, preset, extra?, run(g), blockedBy? }] —— 错误反馈、前置未满足、门槛 walk()、时辰差异等独立用例，
 *           每例先 freshState 重建前置，失败不影响下一例；
 *   reloadAt：在这些步骤之后 reload() 复验（ARCH §15.4：本区任意两个中间步骤）。
 * CLI：--main（跳过〔可选〕步骤）、--until=<n>、--only=steps|cases、--case=<名字子串>、--quality=、--shots。
 */
export async function runRegion(def) {
  const args = parseArgs();
  const quality = typeof args.quality === 'string' ? args.quality : 'low';
  const t0 = Date.now();
  const report = { steps: [], cases: [] };
  const h = await launch({ query: `new=1&debug=1&test=1&lockstep=1&quality=${quality}`, label: def.name });
  try {
    if (args.only !== 'cases') {
      for (const ph of def.phases) {
        const label = ph.label ?? `${ph.preset}`;
        console.log(`== ${def.name} 步骤（${label}）`);
        if (ph.preset === 'new' && ph === def.phases[0]) {
          // 页面带 new=1 打开：开场过场正在播，第一步自己 dlg()
        } else if (ph.preset === 'new') {
          // 不是第一段：重开新游戏（开场过场同样留给第一步的 dlg()）
          await h.call('newGame');
        } else {
          await freshState(h, ph.preset);
        }
        h.route = ph.route;
        const res = await runSteps(h, ph.steps, {
          main: !!args.main, until: args.until ? Number(args.until) : Infinity, reloadAt: def.reloadAt ?? [],
          shots: !!args.shots, name: `${def.name}-${label}`,
        });
        h.route = undefined;
        report.steps.push({ label, ...res });
        // 各段互不依赖：下一段会 newGame() + 预置重建，所以一段失败也接着跑下一段（失败都记在 report 里）
      }
    }
    if (args.only !== 'steps') {
      const filter = typeof args.case === 'string' ? args.case : null;
      console.log(`== ${def.name} 用例`);
      for (const c of def.cases ?? []) {
        if (filter && !c.name.includes(filter)) continue;
        const tag = `${c.puzzle ? `[${c.puzzle}] ` : ''}${c.name}`;
        if (c.blockedBy) {
          report.cases.push({ name: tag, status: 'blocked', by: c.blockedBy });
          console.log(`  BLOCK ${tag} → ${c.blockedBy}`);
          continue;
        }
        const t1 = Date.now();
        try {
          h.clearErrors();
          await freshState(h, c.preset ?? def.phases[0].preset, c.extra ?? {});
          await c.run(h);
          h.checkErrors(tag);
          report.cases.push({ name: tag, status: 'ok' });
          console.log(`  ok    ${tag}（${((Date.now() - t1) / 1000).toFixed(1)}s）`);
        } catch (err) {
          report.cases.push({ name: tag, status: 'fail', error: err.message });
          console.error(`  FAIL  ${tag}：${err.message}`);
          await dumpFailure(h, `case-${c.name}`, null);
        }
      }
    }
  } finally {
    await h.close();
  }
  const stepFail = report.steps.some(s => s.failed);
  const blocked = report.steps.reduce((n, s) => n + s.blocked.length, 0) + report.cases.filter(c => c.status === 'blocked').length;
  const caseFail = report.cases.filter(c => c.status === 'fail').length;
  const passed = report.steps.reduce((n, s) => n + s.passed, 0);
  console.log(`\n${def.name}：步骤通过 ${passed}${stepFail ? '（有失败）' : ''}，用例 ${report.cases.filter(c => c.status === 'ok').length}/${report.cases.length}${blocked ? `，blocked ${blocked}` : ''}（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  const ok = !stepFail && caseFail === 0;
  console.log(`REGION ${def.name}: ${ok ? (blocked ? 'OK（有 blockedBy）' : 'OK') : 'FAIL'}`);
  return ok;
}
