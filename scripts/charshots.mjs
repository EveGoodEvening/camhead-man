// owner: integrator
// char2 人物截图（test-artifacts/work/char2/PLAN.md §5.0 第 4 步）：对已构建的 dist（CAMERA_DIST，不用开发服务器）在 dev 沙盒里
// 摆人偶、固定机位截图。文件名与 test-artifacts/work/char2/before/ 一致，before/after 一一对应。
//
// 用法（浏览器很重：必须经 heavy-gate，后台运行；harness 的 launch() 已经走 browserSlots）：
//   CAMERA_DIST=<dist 副本> CAMERA_PORT=<端口> ~/.claude/bin/heavy-gate -n 1 -l <label> -- \
//     node scripts/charshots.mjs --out <dir> --phases lineup,solo,extras,poses,crowd,paper,studio,player[,shots]
//     [--kinds zhou,lu] [--looks live,ghost] [--views front,q34] [--shots shot.r1.fin_booth_lu,shot.r1.fin_smile] [--quality high]
// --kinds 按标签过滤 solo/extras/studio/poses（标签 = 文件名里的那一段：solo 的 huang_man，extras 的 kid8、wang_young……，
//   poses 的 zhou_slump_sit……；写 zhou 也匹配 zhou_nocap、zhou_slump_sit）。--looks 过滤 lineup/solo/crowd，--views 过滤视角标签。
// 摆放：舞台人偶在 (11.6, 12.2) 面朝 -z，机位在 z 9.2–6；先藏掉 x 11.2–12.4、z 10–11.2 里的路灯杆；一排 7 人 x 9.9–14.1（间距 0.7）。
// 额外的人偶、人群、纸人由页面内自测 char2.spawn（src/areas/dev/char2.ts）生成：globalThis.__char2spawn = {...}。

import path from 'node:path';
import fs from 'node:fs';
import { launch, ROOT } from './lib/harness.mjs';

/** --key value 与 --key=value 两种写法都认。 */
function parseCli(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) continue;
    if (m[2] !== undefined) out[m[1]] = m[2];
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[m[1]] = argv[++i];
    else out[m[1]] = true;
  }
  return out;
}
const args = parseCli();
const list = v => (typeof v === 'string' && v.length ? v.split(',').map(s => s.trim()).filter(Boolean) : null);
const OUT = path.resolve(typeof args.out === 'string' ? args.out : path.join(ROOT, 'test-artifacts/work/char2/after'));
const PHASES = list(args.phases) ?? ['lineup'];
const KINDS = list(args.kinds);
const LOOKS = list(args.looks);
const VIEWS = list(args.views);
const SHOTS = list(args.shots) ?? [];
const QUALITY = typeof args.quality === 'string' ? args.quality : 'high';
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const wantKind = tag => !KINDS || KINDS.some(k => tag === k || tag.startsWith(`${k}_`) || tag.startsWith(k));
const wantLook = l => !LOOKS || LOOKS.includes(l);
const wantView = v => !VIEWS || VIEWS.includes(v);

/** 页面内的截图助手（?debug=1 时有 window.__cmGame）。只读探测 + 摆机位，不改 src。 */
const INSTALL = `
(() => {
  const g = window.__cmGame;
  if (!g) throw new Error('no __cmGame (need ?debug=1)');
  const T = { g };
  T.frames = async (n = 3) => { for (let i = 0; i < n; i++) await g.nextFrame(); };
  T.pose = async (pos, target, fov = 40) => {
    g.cameras.setFixedPose({ pos, target, fov }, 0, { role: 'fixed' });
    g.cameras.active = 'fixed';
    await T.frames(3);
  };
  T.lineup = async (look, yaw) => {
    globalThis.__m4lineup = { look, yaw };
    const r = await window.__game.selftest('m4.lineup');
    const root = g.areas.current.root.getObjectByName('m4.lineup');
    T.rigs = root ? [...root.children] : [];
    return { ok: r.ok, n: T.rigs.length };
  };
  T.solo = (i, p, yawDeg) => {
    (T.rigs || []).forEach((r, k) => { r.visible = i < 0 || k === i; });
    if (i >= 0 && p) { const r = T.rigs[i]; r.position.set(p[0], 0, p[1]); if (yawDeg !== undefined) r.rotation.y = yawDeg * Math.PI / 180; r.updateMatrixWorld(true); }
  };
  T.hideLineup = () => { (T.rigs || []).forEach(r => { r.visible = false; }); };
  T.lineupLayout = (x0, dx, z, yawDeg) => {
    T.rigs.forEach((r, k) => { r.visible = true; r.position.set(x0 + k * dx, 0, z); if (yawDeg !== undefined) r.rotation.y = yawDeg * Math.PI / 180; r.updateMatrixWorld(true); });
  };
  T.hidden = [];
  T.hideBox = (min, max) => {
    const root = g.areas.current.root;
    root.traverse(o => {
      if (!o.isMesh && !o.isLine && !o.isPoints && !o.isSprite) return;
      if (!o.geometry) return;
      for (let p = o; p; p = p.parent) if (p.name === 'm4.lineup' || p.userData.char2spawn) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      o.updateMatrixWorld(true);
      const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      if (bb.min.y < 0.02 && bb.max.y < 0.05) return;
      if ((bb.max.x - bb.min.x) > 8 || (bb.max.z - bb.min.z) > 8) return;
      const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
      if (cx > min[0] && cx < max[0] && cz > min[1] && cz < max[1] && o.visible) { o.visible = false; T.hidden.push(o); }
    });
    return T.hidden.length;
  };
  T.spawned = () => globalThis.__char2spawned || [];
  T.rot = (yawDeg, i = 0) => { const r = T.spawned()[i]; if (!r) return; r.root.rotation.y = yawDeg * Math.PI / 180; r.root.updateMatrixWorld(true); };
  window.__T = T;
  return true;
})()
`;

const h = await launch({ query: `debug=1&test=1&lockstep=1&quality=${QUALITY}&area=dev`, viewport: { width: 1280, height: 720 }, label: 'charshots', callTimeout: 400_000 });
const ev = (fn, arg) => h.page.evaluate(fn, arg);
const shotFiles = [];
async function shoot(name) {
  await ev(() => window.__T.frames(2));
  const file = path.join(OUT, `${name}.png`);
  await h.page.screenshot({ path: file, timeout: 180_000 });
  shotFiles.push(file);
  log('shot', name);
}
const pose = (pos, target, fov = 40) => ev(([p, t, f]) => window.__T.pose(p, t, f), [pos, target, fov]);
async function baseShot() {
  const r = await h.call.try('shot', 'dev', 'shot.dev.lookdev_close');
  if (!r.ok) throw new Error(`shot failed ${JSON.stringify(r).slice(0, 300)}`);
  await h.page.evaluate(INSTALL);
}
/** 页面内 char2.spawn（见 src/areas/dev/char2.ts）。返回 globalThis.__char2spawnInfo。 */
async function spawn(cfg) {
  await ev(c => { globalThis.__char2spawn = c; }, cfg);
  const r = await h.call.try('selftest', 'char2.spawn');
  const res = r?.result ?? r;
  if (!r.ok || res?.ok === false) throw new Error(`char2.spawn ${JSON.stringify(cfg)} → ${JSON.stringify(r).slice(0, 400)}`);
  return ev(() => globalThis.__char2spawnInfo);
}

const ST = [11.6, 12.2];
const F = (d, y) => [ST[0], y, ST[1] - d];
const HIDE = () => ev(() => window.__T.hideBox([11.2, 10.0], [12.4, 11.2]));
/** m4.lineup 的顺序与 solo 文件名（标称身高只用来定机位）。 */
const LINEUP = ['wang', 'lu', 'zhou', 'tudi', 'jianguo', 'huang_man', 'neighbor'];
const HEIGHT = { wang: 1.55, lu: 1.72, zhou: 1.7, tudi: 1.2, jianguo: 1.75, huang_man: 1.65, neighbor: 1.65 };
const VIEWS9 = H => [
  ['front', 0, F(3.0, H * 0.55), H * 0.52, 40], ['q34', 40, F(3.0, H * 0.6), H * 0.52, 40], ['side', 90, F(3.0, H * 0.55), H * 0.52, 40],
  ['back', 180, F(3.0, H * 0.6), H * 0.52, 40], ['lowside', 90, F(2.2, 0.3), 0.42, 40], ['head', 0, F(1.2, H - 0.1), H - 0.12, 22],
  ['head34', 35, F(1.2, H - 0.08), H - 0.12, 22], ['headside', 90, F(1.2, H - 0.1), H - 0.12, 22], ['hands', 20, F(1.2, H * 0.5), H * 0.47, 36],
];
const VIEWS_EXTRA = H => VIEWS9(H).filter(v => ['front', 'q34', 'side', 'head', 'head34', 'hands'].includes(v[0]));

const t0 = Date.now();
try {
  await baseShot();
  for (const phase of PHASES) {
    log('phase', phase);
    if (phase === 'lineup') {
      for (const look of ['live', 'ghost', 'replay']) {
        if (!wantLook(look)) continue;
        for (const [tag, yaw] of [['front', 0], ['q34', 40], ['side', 90], ['back', 180]]) {
          if (!wantView(tag)) continue;
          await ev(([l, y]) => window.__T.lineup(l, y), [look, yaw]);
          await ev(([y]) => window.__T.lineupLayout(9.9, 0.7, 12.2, y), [yaw]);
          await HIDE();
          await pose([12.0, 1.1, 6.0], [12.0, 0.95, 12.2], 44);
          await shoot(`lineup_${look}_${tag}`);
        }
      }
      if (wantLook('live') && wantView('lowside')) {
        await ev(() => window.__T.lineup('live', 90));
        await ev(() => window.__T.lineupLayout(9.9, 0.7, 12.2, 90));
        await HIDE();
        await pose([12.0, 0.3, 7.5], [12.0, 0.45, 12.2], 44);
        await shoot('lineup_live_lowside');
      }
      await ev(() => window.__T.hideLineup());
    }
    if (phase === 'solo') {
      for (const look of ['live', 'ghost', 'replay']) {
        if (!wantLook(look)) continue;
        await ev(([l]) => window.__T.lineup(l, 0), [look]);
        await HIDE();
        for (let i = 0; i < LINEUP.length; i++) {
          const k = LINEUP[i], H = HEIGHT[k];
          if (!wantKind(k)) continue;
          const views = look === 'live' ? VIEWS9(H) : [['q34', 40, F(3.0, H * 0.6), H * 0.52, 40], ['head', 20, F(1.2, H - 0.1), H - 0.12, 24]];
          for (const [tag, yaw, cam, ty, fov] of views) {
            if (!wantView(tag)) continue;
            await ev(([ii, st, y]) => window.__T.solo(ii, st, y), [i, ST, yaw]);
            await pose(cam, [ST[0], ty, ST[1]], fov);
            await shoot(`solo_${k}_${look}_${tag}`);
          }
        }
        await ev(() => window.__T.hideLineup());
      }
    }
    if (phase === 'extras' || phase === 'studio') {
      const studio = phase === 'studio';
      await ev(() => window.__T.hideLineup());
      await spawn({ op: 'studio', on: studio, target: [ST[0], 0, ST[1] - 1.5] });
      await HIDE();
      const items = studio
        ? [['wang', {}, 'wang'], ['lu', {}, 'lu'], ['zhou', { variant: 'cap' }, 'zhou'], ['tudi', {}, 'tudi'], ['jianguo', {}, 'jianguo'], ['huang', { variant: 'man' }, 'huang_man'],
          ['neighbor', { seed: 2008 }, 'neighbor'], ['kid', { seed: 3 }, 'kid'], ['bride', {}, 'bride'], ['worker', {}, 'worker']]
        : [['kid', { seed: 3 }, 'kid'], ['kid', { seed: 8 }, 'kid8'], ['bride', {}, 'bride'], ['apprentice', {}, 'apprentice'], ['junkman', {}, 'junkman'], ['worker', {}, 'worker'],
          ['wang', { age: 'young' }, 'wang_young'], ['jianguo', { age: 'young' }, 'jianguo_child'], ['zhou', { variant: 'nocap' }, 'zhou_nocap'],
          ['huang', { variant: 'masked', seed: 3 }, 'huang_masked'], ['huang', { variant: 'weasel' }, 'huang_weasel'], ['neighbor', { seed: 7 }, 'neighbor7'], ['neighbor', { seed: 31 }, 'neighbor31']];
      for (const [kind, opts, tag] of items) {
        if (!wantKind(tag)) continue;
        const info = await spawn({ op: 'spawn', clear: true, kind, opts, pose: 'stand', pos: [ST[0], 0, ST[1]], yaw: 0 });
        log(tag, JSON.stringify(info));
        const H = Math.max(0.8, info?.h ?? 1.7);
        const vv = studio ? VIEWS_EXTRA(H).filter(v => ['front', 'side', 'head', 'head34'].includes(v[0])) : VIEWS_EXTRA(H);
        for (const [vt, yaw, cam, ty, fov] of vv) {
          if (!wantView(vt)) continue;
          await ev(([y]) => window.__T.rot(y), [yaw]);
          await pose(cam, [ST[0], ty, ST[1]], fov);
          await shoot(`${studio ? 'studio' : 'extra'}_${tag}_${vt}`);
        }
      }
      await spawn({ op: 'clear' });
      if (studio) await spawn({ op: 'studio', on: false });
    }
    if (phase === 'poses') {
      await ev(() => window.__T.hideLineup());
      await HIDE();
      const items = [['zhou', { variant: 'slump' }, 'sit', 'zhou_slump_sit'], ['tudi', {}, 'sit', 'tudi_sit'], ['wang', {}, 'walk', 'wang_walk'], ['jianguo', {}, 'walk', 'jianguo_walk'],
        ['lu', {}, 'raise_arm', 'lu_raise'], ['neighbor', { seed: 2008 }, 'crouch', 'neighbor_crouch'], ['bride', {}, 'sit', 'bride_sit']];
      for (const [kind, opts, p, tag] of items) {
        if (!wantKind(tag)) continue;
        await spawn({ op: 'spawn', clear: true, kind, opts, pose: p, pos: [ST[0], 0, ST[1]], yaw: 0, steps: 20, speed: p === 'walk' ? 1.2 : 0 });
        for (const [vt, yaw] of [['q34', 40], ['side', 90], ['front', 0]]) {
          if (vt === 'front' && !VIEWS?.includes('front')) continue; // front：只在 --views 明确要求时（before/ 只有 q34、side）
          if (!wantView(vt)) continue;
          await ev(([y]) => window.__T.rot(y), [yaw]);
          await pose(F(2.8, 0.95), [ST[0], 0.7, ST[1]], 40);
          await shoot(`pose_${tag}_${vt}`);
        }
      }
      await spawn({ op: 'clear' });
    }
    if (phase === 'crowd') {
      await ev(() => window.__T.hideLineup());
      await HIDE();
      for (const look of ['replay', 'ghost', 'silhouette']) {
        if (!wantLook(look)) continue;
        await spawn({ op: 'spawn', clear: true, crowd: { count: 12, cols: 6, spacing: 0.6, look, seed: 1984, kidsFrontRow: 2 }, pos: [ST[0], 0, ST[1] - 0.5], yaw: 180 });
        for (const [vt, cam, ty, fov] of [['wide', F(4.5, 1.3), 0.9, 44], ['close', F(1.8, 1.45), 1.25, 36]]) {
          if (!wantView(vt)) continue;
          await pose(cam, [ST[0], ty, ST[1]], fov);
          await shoot(`crowd_${look}_${vt}`);
        }
        if (wantView('side')) {
          await ev(() => window.__T.rot(90));
          await pose(F(4.5, 1.2), [ST[0], 0.9, ST[1]], 44);
          await shoot(`crowd_${look}_side`);
        }
      }
      await spawn({ op: 'clear' });
    }
    if (phase === 'paper') {
      await ev(() => window.__T.hideLineup());
      await HIDE();
      for (const [kind, seed, tag] of [['vendor', 3, 'vendor3'], ['vendor', 9, 'vendor9'], ['boy', 1, 'boy']]) {
        if (!wantKind(tag)) continue;
        await spawn({ op: 'spawn', clear: true, paper: { kind, seed, breathing: kind === 'vendor', lanternText: '引路' }, pos: [ST[0], 0, ST[1]], yaw: 0 });
        for (const [vt, yaw, d, y, ty, fov] of [['front', 0, 3, 0.9, 0.8, 40], ['q34', 40, 3, 1.0, 0.8, 40], ['side', 90, 3, 0.9, 0.8, 40], ['head', 0, 1.2, 1.4, 1.35, 24]]) {
          if (!wantView(vt)) continue;
          await ev(([yy]) => window.__T.rot(yy), [yaw]);
          await pose(F(d, y), [ST[0], ty, ST[1]], fov);
          await shoot(`paper_${tag}_${vt}`);
        }
      }
      await spawn({ op: 'clear' });
    }
    if (phase === 'player') {
      // look-dev 样板角落的主角人偶：(7.0, 11.45)，yaw 24°
      await ev(() => window.__T.hideLineup());
      const D = [7.0, 11.45];
      const yaw = (24 * Math.PI) / 180;
      const dirs = { a: [Math.sin(yaw), Math.cos(yaw)], b: [-Math.sin(yaw), -Math.cos(yaw)], c: [Math.cos(yaw), -Math.sin(yaw)], d: [-Math.cos(yaw), Math.sin(yaw)] };
      for (const [tag, d] of Object.entries(dirs)) {
        if (wantView('full') || wantView(`full_${tag}`)) {
          await pose([D[0] + d[0] * 2.6, 1.2, D[1] + d[1] * 2.6], [D[0], 1.0, D[1]], 42);
          await shoot(`player_full_${tag}`);
        }
        if (wantView('upper') || wantView(`upper_${tag}`)) {
          await pose([D[0] + d[0] * 1.2, 1.8, D[1] + d[1] * 1.2], [D[0], 1.55, D[1]], 32);
          await shoot(`player_upper_${tag}`);
        }
      }
      if (wantView('lowside')) {
        await pose([D[0] + dirs.c[0] * 2.0, 0.3, D[1] + dirs.c[1] * 2.0], [D[0], 0.45, D[1]], 42);
        await shoot('player_lowside');
      }
    }
    if (phase === 'shots') {
      for (const id of SHOTS) {
        const area = id.split('.')[1];
        const r = await h.call.try('shot', area, id);
        if (!r.ok) {
          log('FAIL', id, JSON.stringify(r).slice(0, 300));
          continue;
        }
        await h.page.evaluate(INSTALL);
        await shoot(`game_${id.replace(/^shot\./, '')}`);
      }
      // 后面若还有阶段，回到 dev 沙盒
      if (PHASES.indexOf(phase) < PHASES.length - 1) await baseShot();
    }
  }
} finally {
  if (h.errors.length) log('page errors', JSON.stringify(h.errors.slice(0, 5)).slice(0, 1500));
  await h.close();
}
log(`done: ${shotFiles.length} images → ${OUT}（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
