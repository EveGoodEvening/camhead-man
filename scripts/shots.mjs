// owner: WP7
// 截图与亮度验收（ARCH §12.4、§12.5）：对每个 AreaDef.shots 截图到 test-artifacts/shots/<shotId>.png，记录 perf() 到
// test-artifacts/shots/perf.json（M3：带 --area 时写 perf.<区域,…>.json，几个区域并行跑互不覆盖）。
// 通过标准：无报错；每张图（UI 隐藏时）平均亮度在 [0.05, 0.35]（ShotDef.brightness 可覆盖）、有一块成片的亮核
// （M4 第 2 轮：3×3 模糊后亮度的第 99.5 百分位 ≥ highlight − 0.08，缺省 0.72——等价于原来“亮度 > 0.8 的像素 ≥ 0.5%”，但不再被
// 雨丝、颗粒、雪花这些单像素噪点左右；ShotDef.highlight 仍是原来的阈值语义，可改或 false 跳过，M3）；
// ShotDef.keys 的锚点投影处 5×5 像素平均亮度 > 0.04；perf() 满足 §13.3 的 BUDGET。
// --area 指定的区域（或 --strict 时的全部区域）另要求至少 8 个机位（dev 除外）。
//
// 用法：npm run build && node scripts/shots.mjs [--area r3 | --area=r3] [--quality high] [--only=<机位 id 子串>] [--strict]
//   默认 1280×720、quality=high（ARCH §12.5）、锁步（截图可复现）。
//   超时（M3，高负载下 SwiftShader 截一张 1280×720 可能超过 Playwright 默认的 30 秒）：截图 CAMERA_SHOT_TIMEOUT（毫秒，默认 180000），
//   调用 CAMERA_CALL_TIMEOUT（默认 400000）；单张出错只记为该机位的问题，不中断整轮。

import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { launch, artifactDir, decodePng, lumaStats, patchLuma, ROOT } from './lib/harness.mjs';

/** 同时支持 --area r3 与 --area=r3。 */
function args() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a[i]);
    if (!m) continue;
    if (m[2] !== undefined) out[m[1]] = m[2];
    else if (a[i + 1] !== undefined && !a[i + 1].startsWith('--') && ['area', 'quality', 'only'].includes(m[1])) out[m[1]] = a[++i];
    else out[m[1]] = true;
  }
  return out;
}

const ALL_AREAS = ['dev', 'r1', 'r2', 'r2_502', 'r3', 'r4'];
const DEFAULT_RANGE = [0.05, 0.35];
const DEFAULT_HIGHLIGHT = 0.8;
/** M4 第 2 轮：亮核判据 = 模糊后第 99.5 百分位 ≥ highlight − CORE_MARGIN（模糊把亮核边缘拉低了一点）。 */
const CORE_MARGIN = 0.08;
const MIN_SHOTS = 8;
const SHOT_TIMEOUT = Number(process.env.CAMERA_SHOT_TIMEOUT ?? 180_000);
const CALL_TIMEOUT = Number(process.env.CAMERA_CALL_TIMEOUT ?? 400_000);

async function main() {
  const opt = args();
  const quality = typeof opt.quality === 'string' ? opt.quality : 'high';
  const areas = typeof opt.area === 'string' ? opt.area.split(',') : ALL_AREAS;
  const only = typeof opt.only === 'string' ? opt.only : null;
  const outDir = artifactDir('shots');
  const { BUDGET } = await import(pathToFileURL(path.join(ROOT, 'src/data/render.ts')).href);
  const perfLog = {};
  const problems = [];
  let count = 0;
  const t0 = Date.now();
  const h = await launch({ query: `debug=1&test=1&lockstep=1&quality=${quality}&area=dev`, viewport: { width: 1280, height: 720 }, label: 'shots', callTimeout: CALL_TIMEOUT });
  try {
    for (const area of areas) {
      const lr = await h.call.try('shot', area, '*');
      if (!lr.ok) {
        problems.push(`${area}：列不出机位（${lr.reason}）`);
        continue;
      }
      const shots = lr.result.shots;
      console.log(`== ${area}：${shots.length} 个机位`);
      if (area !== 'dev' && (typeof opt.area === 'string' || opt.strict) && shots.length < MIN_SHOTS) problems.push(`${area}：只有 ${shots.length} 个机位（至少 ${MIN_SHOTS} 个，ARCH §12.5）`);
      for (const s of shots) {
        if (only && !s.id.includes(only)) continue;
        count++;
        h.clearErrors();
        let r;
        let buf;
        const file = path.join(outDir, `${s.id}.png`);
        try {
          r = await h.call.try('shot', area, s.id);
          if (r.ok) buf = await h.page.screenshot({ path: file, timeout: SHOT_TIMEOUT });
        } catch (err) {
          problems.push(`${s.id}：${err && err.message ? err.message.split('\n')[0] : err}`);
          console.error(`  FAIL  ${s.id}：${err && err.message ? err.message.split('\n')[0] : err}`);
          continue;
        }
        if (!r.ok) {
          problems.push(`${s.id}：shot() → ${r.reason} ${JSON.stringify(r.result ?? '')}`);
          console.error(`  FAIL  ${s.id}：shot() → ${r.reason}`);
          continue;
        }
        const img = decodePng(buf);
        const hi = s.highlight ?? DEFAULT_HIGHLIGHT;
        const st = lumaStats(img, hi === false ? DEFAULT_HIGHLIGHT : hi);
        const range = s.brightness ?? DEFAULT_RANGE;
        const issues = [];
        if (st.mean < range[0] || st.mean > range[1]) issues.push(`平均亮度 ${st.mean.toFixed(3)} 不在 [${range[0]}, ${range[1]}]`);
        const coreMin = (hi === false ? DEFAULT_HIGHLIGHT : hi) - CORE_MARGIN;
        if (hi !== false && st.coreP995 < coreMin) issues.push(`亮核不足：3×3 模糊后亮度第 99.5 百分位 ${st.coreP995.toFixed(3)} < ${coreMin.toFixed(2)}（灯与霓虹没亮、没入画？）`);
        for (const k of r.result.keys) {
          if (k.x < 0 || k.y < 0 || k.x >= img.width || k.y >= img.height) {
            issues.push(`关键对象 ${k.id} 不在画面里（${k.x}, ${k.y}）`);
            continue;
          }
          const l = patchLuma(img, k.x, k.y, 5);
          if (l <= 0.04) issues.push(`关键对象 ${k.id} 处太暗（5×5 平均亮度 ${l.toFixed(3)}）`);
        }
        const pf = await h.call.try('perf');
        if (pf.ok) {
          perfLog[s.id] = pf.result;
          const p = pf.result;
          if (p.callsMain > BUDGET.callsMain) issues.push(`主场景 draw call ${p.callsMain} > ${BUDGET.callsMain}`);
          if (p.calls > BUDGET.callsTotal) issues.push(`整帧 draw call ${p.calls} > ${BUDGET.callsTotal}`);
          if (p.tris > BUDGET.tris) issues.push(`三角面 ${p.tris} > ${BUDGET.tris}`);
          if (p.lights > BUDGET.lights) issues.push(`灯 ${p.lights} > ${BUDGET.lights}`);
          // M1d：CanvasTexture 总量（§13.3）
          if (typeof p.canvasMB === 'number' && p.canvasMB * 1024 * 1024 > BUDGET.canvasBytes) issues.push(`CanvasTexture ${p.canvasMB}MB > ${BUDGET.canvasBytes / 1048576}MB`);
        } else {
          issues.push(`perf() → ${pf.reason}`);
        }
        for (const e of h.errors) issues.push(`页面错误 [${e.kind}] ${e.text.split('\n')[0]}`);
        const line = `${s.id}（${s.label}）mean=${st.mean.toFixed(3)} core=${st.coreP995.toFixed(3)} bright=${(st.brightFrac * 100).toFixed(2)}%${pf.ok ? ` calls=${pf.result.calls}/${pf.result.callsMain} tris=${pf.result.tris} lights=${pf.result.lights} canvas=${pf.result.canvasMB}MB` : ''}`;
        if (issues.length) {
          problems.push(`${s.id}：${issues.join('；')}`);
          console.error(`  FAIL  ${line}\n        ${issues.join('\n        ')}`);
        } else {
          console.log(`  ok    ${line}`);
        }
      }
    }
  } finally {
    await h.close();
  }
  const perfName = typeof opt.area === 'string' ? `perf.${areas.join(',')}${only ? `.${only.replace(/[^\w.-]+/g, '_')}` : ''}.json` : 'perf.json';
  fs.writeFileSync(path.join(outDir, perfName), `${JSON.stringify(perfLog, null, 2)}\n`);
  console.log(`\nshots：${count} 张，${problems.length} 个问题（${((Date.now() - t0) / 1000).toFixed(0)}s）→ ${path.relative(ROOT, outDir)}/`);
  for (const p of problems) console.log(`  - ${p}`);
  console.log(problems.length ? 'SHOTS: FAIL' : 'SHOTS: OK');
  process.exit(problems.length ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
