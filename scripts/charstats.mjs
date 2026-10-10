// owner: integrator
// char2 人物统计（test-artifacts/work/char2/PLAN.md §0.3、§0.4）：Node 侧（vite ssrLoadModule，不开浏览器）逐个建角色，
// 数可见网格（= draw call）、三角形、不同贴图数、贴图画布字节，以及人群、纸人、主角身子。
//
// 用法：node scripts/charstats.mjs [--json] [--kinds zhou,lu]   （在仓库根目录或任意 worktree 里跑，读的是该目录的 src）
// 画布字节 = 角色可见网格引用的贴图 image 宽×高×4（同一贴图只算一次；不含 mipmap）。

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const kindsArg = (() => {
  const i = argv.findIndex(a => a === '--kinds' || a.startsWith('--kinds='));
  if (i < 0) return null;
  const v = argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1];
  return v ? v.split(',') : null;
})();

// ---- 假 DOM：canvas 的 2D 上下文是一个吞掉一切调用的 Proxy（只要宽高）
const noop = () => P;
const P = new Proxy(noop, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'width' || k === 'height' ? 256 : P), apply: () => P, construct: () => P });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => P, addEventListener() {}, toDataURL: () => '' }),
  createElementNS: () => ({ style: {} }),
};
globalThis.window ??= globalThis;
globalThis.self ??= globalThis;

const tris = g => (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
function visibleChain(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
function measure(root) {
  let meshes = 0, t = 0;
  const maps = new Map();
  const names = [];
  root.updateMatrixWorld?.(true);
  root.traverse(o => {
    if (!o.isMesh || !visibleChain(o)) return;
    meshes++;
    names.push(o.name || '(anon)');
    t += tris(o.geometry) * (o.isInstancedMesh ? o.count : 1);
    for (const m of [].concat(o.material)) {
      for (const k of ['map', 'alphaMap', 'emissiveMap']) {
        const tex = m?.[k];
        if (tex && !maps.has(tex.uuid)) maps.set(tex.uuid, (tex.image?.width ?? 0) * (tex.image?.height ?? 0) * 4);
      }
      const u = m?.uniforms;
      if (u) for (const v of Object.values(u)) if (v?.value?.isTexture && !maps.has(v.value.uuid)) maps.set(v.value.uuid, (v.value.image?.width ?? 0) * (v.value.image?.height ?? 0) * 4);
    }
  });
  const bytes = [...maps.values()].reduce((a, b) => a + b, 0);
  return { meshes, tris: Math.round(t), maps: maps.size, canvasMiB: +(bytes / 1048576).toFixed(3), names };
}

const ROWS = [
  ['tudi', {}], ['wang', {}], ['wang', { age: 'young' }, 'wang_young'], ['lu', {}], ['zhou', {}], ['zhou', { variant: 'nocap' }, 'zhou_nocap'],
  ['jianguo', {}], ['jianguo', { age: 'young' }, 'jianguo_child'], ['kid', { seed: 3 }, 'kid'], ['kid', { seed: 8 }, 'kid8'], ['bride', {}], ['apprentice', {}],
  ['junkman', {}], ['worker', {}], ['neighbor', { seed: 2008 }, 'neighbor'], ['neighbor', { seed: 7 }, 'neighbor7'],
  ['huang', { variant: 'masked', seed: 3 }, 'huang_masked'], ['huang', { variant: 'man' }, 'huang_man'], ['huang', { variant: 'weasel' }, 'huang_weasel'],
];

const server = await createServer({
  root: ROOT, configFile: false, appType: 'custom', logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] },
});
const out = { kinds: {}, crowd: null, paper: {}, player: null };
try {
  const C = await server.ssrLoadModule('/src/rigs/characters.ts');
  for (const [kind, opts, tag = kind] of ROWS) {
    if (kindsArg && !kindsArg.some(k => tag === k || tag.startsWith(k))) continue;
    const r = C.createCharacter(kind, opts);
    r.setPose?.('stand', 0);
    r.update?.(0.016, 0);
    out.kinds[tag] = measure(r.root);
    r.dispose();
  }
  if (!kindsArg) {
    const Cr = await server.ssrLoadModule('/src/rigs/crowd.ts');
    const c = Cr.createCrowd({ count: 12, cols: 6, spacing: 0.7, look: 'replay' });
    const g = c.mesh.geometry;
    out.crowd = { personTris: tris(g), instancedMeshes: 1 + c.mesh.children.filter(o => o.isMesh).length };
    c.dispose?.();
    const Pp = await server.ssrLoadModule('/src/rigs/paper.ts');
    for (const [kind, seed, tag] of [['vendor', 3, 'vendor3'], ['boy', 1, 'boy']]) {
      const p = Pp.createPaperFigure({ kind, seed, breathing: kind === 'vendor', lanternText: '引路' });
      out.paper[tag] = measure(p.root);
      p.dispose?.();
    }
    const Pl = await server.ssrLoadModule('/src/rigs/player.ts');
    const pm = Pl.createPlayerModel();
    const all = measure(pm.root);
    const body = measure(pm.body.root);
    const head = measure(pm.head.group);
    out.player = { all, bodyOnly: { meshes: body.meshes - head.meshes, tris: body.tris - head.tris } };
  }
} catch (err) {
  console.error('ERR', err?.stack ?? err);
  process.exitCode = 1;
} finally {
  await server.close();
}

if (JSON_OUT) {
  for (const v of Object.values(out.kinds)) delete v.names;
  for (const v of Object.values(out.paper)) delete v.names;
  if (out.player) delete out.player.all.names;
  console.log(JSON.stringify(out, null, 1));
} else {
  console.log('kind            meshes   tris   maps  canvasMiB');
  for (const [k, v] of Object.entries(out.kinds)) console.log(`${k.padEnd(15)} ${String(v.meshes).padStart(6)} ${String(v.tris).padStart(6)} ${String(v.maps).padStart(6)} ${String(v.canvasMiB).padStart(10)}`);
  if (out.crowd) console.log(`crowd person tris ${out.crowd.personTris}, instanced meshes ${out.crowd.instancedMeshes}`);
  for (const [k, v] of Object.entries(out.paper)) console.log(`paper ${k.padEnd(9)} ${String(v.meshes).padStart(6)} ${String(v.tris).padStart(6)} ${String(v.maps).padStart(6)} ${String(v.canvasMiB).padStart(10)}`);
  if (out.player) console.log(`player all ${out.player.all.meshes} meshes ${out.player.all.tris} tris; body only ${out.player.bodyOnly.meshes} meshes ${out.player.bodyOnly.tris} tris`);
}
