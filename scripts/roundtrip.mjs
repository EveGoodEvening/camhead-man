// owner: integrator
// M3 跨区域往返资源检查（ARCH §13.3“区域切换 5 次后 geometries/textures 回到基线 ±5”、§15.5）：
// 从寅时预置（全部出入口可走）出发，对 r2、r2_502、r3、r4 各做“先往返 2 次预热 → 在 R1 记基线 → 再往返 5 次 → 回到 R1 比较”，
// 往返走真实的出入口（goto 逐跳 travel），不是 setState 直接进区域。另外断言每次回到 R1 的灯数恒定、无页面错误。
//
// 用法：npm run build && node scripts/roundtrip.mjs [--quality=low|mid|high] [--area=r3,r4] [--trips=5]

import { launch, freshState, parseArgs, ROOT } from './lib/harness.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 各区域里一个可达的落点（goto 用；R2 要给楼层） */
const SPOTS = {
  r1: ['r1', 0, 21.5],
  r2: ['r2', 0, 3.0, 1],
  r2_502: ['r2_502', 5.6, -1.5],
  r3: ['r3', 0.5, 1.5],
  r4: ['r4', -16, 0],
};

async function main() {
  const args = parseArgs();
  const quality = typeof args.quality === 'string' ? args.quality : 'low';
  const areas = typeof args.area === 'string' ? args.area.split(',') : ['r2', 'r2_502', 'r3', 'r4'];
  const trips = args.trips ? Number(args.trips) : 5;
  const { BUDGET } = await import(pathToFileURL(path.join(ROOT, 'src/data/render.ts')).href);
  const t0 = Date.now();
  const h = await launch({ query: `new=1&debug=1&test=1&lockstep=1&quality=${quality}`, label: 'roundtrip' });
  const problems = [];
  const rows = [];
  try {
    await freshState(h, 'yin');
    const r1 = async () => {
      await h.call('goto', ...SPOTS.r1);
      await h.call('wait', 0.5);
      return h.call('perf');
    };
    const lights0 = (await r1()).lights;
    for (const area of areas) {
      const spot = SPOTS[area];
      if (!spot) {
        problems.push(`${area}：没有落点`);
        continue;
      }
      const t1 = Date.now();
      for (let i = 0; i < 2; i++) {
        await h.call('goto', ...spot);
        await h.call('wait', 0.5);
        await r1();
      }
      const base = await r1();
      let inArea = null;
      for (let i = 0; i < trips; i++) {
        await h.call('goto', ...spot);
        await h.call('wait', 0.5);
        if (i === 0) inArea = await h.call('perf');
        const p = await r1();
        if (p.lights !== lights0) problems.push(`${area}：第 ${i + 1} 次回到 R1 灯数 ${p.lights} ≠ ${lights0}`);
      }
      const after = await r1();
      const dg = after.geometries - base.geometries;
      const dt = after.textures - base.textures;
      const dp = after.programs - base.programs;
      rows.push({ area, base: { g: base.geometries, t: base.textures, p: base.programs }, after: { g: after.geometries, t: after.textures, p: after.programs }, inArea: inArea && { g: inArea.geometries, t: inArea.textures, lights: inArea.lights } });
      const line = `r1 ↔ ${area} × ${trips}：geometries ${base.geometries} → ${after.geometries}（${dg >= 0 ? '+' : ''}${dg}），textures ${base.textures} → ${after.textures}（${dt >= 0 ? '+' : ''}${dt}），programs ${base.programs} → ${after.programs}（${dp >= 0 ? '+' : ''}${dp}）（${((Date.now() - t1) / 1000).toFixed(0)}s）`;
      if (Math.abs(dg) > BUDGET.resourceDrift || Math.abs(dt) > BUDGET.resourceDrift) {
        problems.push(line);
        console.error(`  FAIL  ${line}`);
      } else {
        console.log(`  ok    ${line}`);
      }
    }
    for (const e of h.errors) problems.push(`页面错误 [${e.kind}] ${e.text.split('\n')[0]}`);
  } catch (err) {
    problems.push(err && err.message ? err.message : String(err));
  } finally {
    await h.close();
  }
  console.log(JSON.stringify(rows));
  for (const p of problems) console.log(`  - ${p}`);
  console.log(`ROUNDTRIP: ${problems.length ? 'FAIL' : 'OK'}（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  process.exit(problems.length ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
