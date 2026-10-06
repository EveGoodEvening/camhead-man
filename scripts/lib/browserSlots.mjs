// owner: integrator
// 机器级的无头浏览器并发闸门。SwiftShader 下每个 Chromium 常驻 3–4 GB，16 GB 且无 swap 的机器上
// 并行代理各开一个就会触发全局 OOM（2026-09-28/29 两次把整个会话连带杀掉）。
//
// 规则：同一时刻最多 CAMERA_MAX_BROWSERS 个浏览器（默认 2，跨进程、跨代理，靠 /tmp 里的锁文件），
// 并且只有 MemAvailable ≥ CAMERA_MIN_FREE_MB（默认 4500）时才启动新的。拿不到就等（带抖动轮询）。
// 所有启动 Chromium 的脚本都应走 launchChromium()，不要直接 chromium.launch()。

import fs from 'node:fs';
import path from 'node:path';

const SLOT_DIR = process.env.CAMERA_SLOT_DIR || '/tmp/camhead-man-browser-slots';
const MAX = Math.max(1, Number(process.env.CAMERA_MAX_BROWSERS) || 2);
const MIN_FREE_MB = Math.max(0, Number(process.env.CAMERA_MIN_FREE_MB) || 4500);
const owned = new Set();

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function memAvailableMb() {
  try {
    const m = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
    return m ? Number(m[1]) / 1024 : Infinity;
  } catch {
    return Infinity;
  }
}

/** Remove slot files whose owning process is gone (crashed or SIGKILLed runs). */
function reapStale() {
  for (const name of fs.readdirSync(SLOT_DIR)) {
    const file = path.join(SLOT_DIR, name);
    const pid = Number(fs.readFileSync(file, 'utf8').split(' ')[0]);
    if (!pid || !alive(pid)) fs.rmSync(file, { force: true });
  }
}

function tryTake() {
  for (let i = 0; i < MAX; i++) {
    const file = path.join(SLOT_DIR, `slot-${i}`);
    try {
      fs.writeFileSync(file, `${process.pid} ${new Date().toISOString()}`, { flag: 'wx' });
      owned.add(file);
      return file;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  return null;
}

process.on('exit', () => {
  for (const file of owned) fs.rmSync(file, { force: true });
});

/** Wait for a free slot and enough RAM; returns a release function. */
export async function acquireBrowserSlot(label = 'browser') {
  fs.mkdirSync(SLOT_DIR, { recursive: true });
  let lastLog = 0;
  for (;;) {
    reapStale();
    const free = memAvailableMb();
    if (free >= MIN_FREE_MB) {
      const file = tryTake();
      if (file) {
        let released = false;
        return () => {
          if (released) return;
          released = true;
          owned.delete(file);
          fs.rmSync(file, { force: true });
        };
      }
    }
    if (Date.now() - lastLog > 60_000) {
      lastLog = Date.now();
      console.log(`[browserSlots] ${label}: waiting (max ${MAX} browsers, MemAvailable ${Math.round(free)} MB, need ${MIN_FREE_MB} MB)`);
    }
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
  }
}

/** chromium.launch() behind the machine-wide slot; the slot is released when the browser closes or disconnects. */
export async function launchChromium(chromium, options = {}, label = 'browser') {
  const release = await acquireBrowserSlot(label);
  let browser;
  try {
    browser = await chromium.launch(options);
  } catch (err) {
    release();
    throw err;
  }
  browser.on('disconnected', release);
  return browser;
}
