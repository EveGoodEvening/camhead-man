// owner: WP7
// 冒烟测试（ARCH §12.4）：启动 → 新游戏 → 过场结束 → explore；报告 WebGL 版本。
// 通过标准：无 pageerror / console.error / GL 与弃用警告；state().mode === 'mode.explore'。
// 用法：npm run build && node scripts/smoke.mjs [截图路径]    （CAMERA_DIST / CAMERA_PORT 见 scripts/lib/harness.mjs）

import path from 'node:path';
import { launch, artifactDir, DEFAULT_QUERY, ROOT } from './lib/harness.mjs';

const shotPath = process.argv[2] || path.join(artifactDir(), 'smoke.png');
let failed = false;
let h;
const t0 = Date.now();
try {
  h = await launch({ query: DEFAULT_QUERY, label: 'smoke' });
  const gl = await h.page.evaluate(() => {
    const c = document.createElement('canvas');
    const ctx = c.getContext('webgl2');
    if (!ctx) return null;
    const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
    return { version: String(ctx.getParameter(ctx.VERSION)), renderer: dbg ? String(ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(ctx.getParameter(ctx.RENDERER)) };
  });
  console.log('WebGL:', gl ? `${gl.version} · ${gl.renderer}` : '(none)');
  if (!gl) throw new Error('WebGL2 不可用');
  // 开场过场：dlg() 推进到结束（新游戏在第一句等输入前就返回，ARCH §4.4）
  const d = await h.call('dlg');
  console.log('dlg():', JSON.stringify(d));
  const s = await h.state();
  console.log(`state: area=${s.area} mode=${s.mode} shichen=${s.shichen} clock=${s.clock} pos=${JSON.stringify(s.pos)}`);
  if (s.mode !== 'mode.explore') throw new Error(`过场结束后模式应为 mode.explore，实际 ${s.mode}`);
  if (s.area !== 'r1') throw new Error(`新游戏应在 r1，实际 ${s.area}`);
  const perf = await h.call('perf');
  console.log('perf():', JSON.stringify(perf));
  await h.screenshot(shotPath);
  h.checkErrors('smoke');
} catch (err) {
  failed = true;
  console.error(err && err.message ? err.message : err);
  if (h) {
    await h.screenshot(shotPath).catch(() => {});
    for (const e of h.errors) console.error(`  [${e.kind}] ${e.text.split('\n')[0]}`);
  }
} finally {
  await h?.close();
}
console.log(`截图：${path.relative(ROOT, shotPath)}`);
console.log(`${failed ? 'SMOKE: FAIL' : 'SMOKE: OK'}（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
process.exit(failed ? 1 : 0);
