// owner: integrator
// char2 人物重做（test-artifacts/work/char2/PLAN.md）的开发沙盒自测汇总：合并各 WP 自己的 char2_*.ts（每个 WP 只改自己那个文件），
// 并登记 WP0 的自测与工具：
//   char2.spawn       工具（截图脚本 scripts/charshots.mjs 用）：按 globalThis.__char2spawn 在沙盒里生成角色/人群/纸人、开关摄影棚灯
//   char2.layout      关节布局（成年/老人 = 旧版数值；儿童、土地按 PLAN §2.6）、地标、人偶的关节与布局一致
//   char2.seams       接缝圈（点数、顺序、法线、成年人数值、体型缩放）与 checkRingMatch/snapRing
//   char2.skin_probe  蒙皮基础设施：右臂换成一根蒙皮管子的人偶——四种外观 + 红外都画得出、弯肘、淡出、胶囊射线、包围盒跟随姿势、释放回基线
//   char2.invariants  全部角色 × 外观：能建、'neck'/'head' 名字与遍历顺序、腕踝关节、蒙皮网格的骨架
// scripts/selftest/char2.mjs 自动跑全部 'char2.*'（char2.spawn 除外）。

import * as THREE from 'three';
import type { AreaPart } from '../../core/area';
import { Disposer } from '../../core/disposer';
import type { Game } from '../../core/game';
import type { Pose } from '../../core/types';
import type { SelftestResult } from '../../debug/selftest';
import { registerSelftest } from '../../debug/selftest';
import { IrRenderer } from '../../fx/ir';
import { createCharacter, type CharacterKind, type CharacterOpts } from '../../rigs/characters';
import { createCrowd, type CrowdOpts } from '../../rigs/crowd';
import { LEGACY_LAYOUT, createHumanoidInternal } from '../../rigs/human/assemble';
import { BONES, FEMALE_SHOULDER, SEAMS, boneIndex, jointLayout, landmarksOf, profileOf } from '../../rigs/human/profile';
import { blend2, checkRingMatch, loftRings, planeRing, setSkin, smooth01, snapRing } from '../../rigs/human/shared';
import type { BodyProfile, BuildCtx, RegionResult, SkinnedPiece } from '../../rigs/human/types';
import { buildUpper } from '../../rigs/human/upper';
import { createPaperFigure, type PaperOpts } from '../../rigs/paper';
import head from './char2_head';
import upper from './char2_upper';
import lower from './char2_lower';
import surface from './char2_surface';
import cast from './char2_cast';
import crowd from './char2_crowd';

/** dev/index.ts 把这些并进沙盒（各 WP 的 char2_*.ts 默认导出一个 AreaPart，可以有 build()、shots……）。 */
export const CHAR2_PARTS: readonly AreaPart[] = [head, upper, lower, surface, cast, crowd];

// ---------------------------------------------------------------- 小工具

function report(): { t: (what: string, cond: boolean, detail?: string) => boolean; done: () => SelftestResult } {
  const notes: string[] = [];
  let ok = true;
  return {
    t(what, cond, detail) {
      if (!cond) ok = false;
      notes.push(`${cond ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
      return cond;
    },
    done: () => ({ ok, notes }),
  };
}
const f3 = (v: THREE.Vector3 | readonly number[]) => {
  const a = Array.isArray(v) ? v : [(v as THREE.Vector3).x, (v as THREE.Vector3).y, (v as THREE.Vector3).z];
  return `(${a.map(x => (x as number).toFixed(4)).join(', ')})`;
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

/** 离屏渲一帧，数“不是背景”的像素（同一个 renderer；渲完恢复渲染目标与清屏色）。 */
function countPixels(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, size = 128): number {
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, depthBuffer: true });
  const prev = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
  renderer.setRenderTarget(prev);
  renderer.setClearColor(prevClear, prevAlpha);
  rt.dispose();
  let n = 0;
  for (let i = 0; i < size * size; i++) if (px[i * 4]! + px[i * 4 + 1]! + px[i * 4 + 2]! > 12) n++;
  return n;
}

function testScene(): THREE.Scene {
  const s = new THREE.Scene();
  // check-allow: no-raw-light（离屏测试场景/截图摄影棚灯，不进区域灯数预算）
  s.add(new THREE.AmbientLight('#ffffff', 0.8));
  const d = new THREE.DirectionalLight('#ffe6c8', 2.2);
  d.position.set(1.5, 3, -2.5);
  s.add(d);
  return s;
}

// ================================================================ char2.spawn（截图工具）

interface SpawnCfg {
  op?: 'spawn' | 'clear' | 'studio';
  clear?: boolean;
  kind?: CharacterKind; opts?: CharacterOpts; look?: CharacterOpts['look'];
  /** 生成后先 3 帧 0.016s，再 steps 帧 1/30s、速度 speed（走路） */
  pose?: Pose; steps?: number; speed?: number;
  pos?: readonly [number, number, number]; yaw?: number;
  crowd?: CrowdOpts; paper?: PaperOpts;
  /** op 'studio'：开/关摄影棚灯，target = 主光对准的点 */
  on?: boolean; target?: readonly [number, number, number];
}
interface Spawned { root: THREE.Object3D; dispose(): void; update?(dt: number, speed: number): void }
const spawned: Spawned[] = [];
let studio: THREE.Group | null = null;
const G = globalThis as { __char2spawn?: SpawnCfg; __char2spawned?: Spawned[]; __char2spawnInfo?: unknown };

registerSelftest('char2.spawn', (game: Game) => {
  const r = report();
  const cfg: SpawnCfg = G.__char2spawn ?? {};
  const area = game.areas.current;
  if (!area) {
    r.t('有当前区域', false);
    return r.done();
  }
  const clearAll = () => {
    for (const s of spawned.splice(0)) {
      s.root.removeFromParent();
      s.dispose();
    }
  };
  const op = cfg.op ?? 'spawn';
  if (op === 'clear' || cfg.clear) clearAll();
  if (op === 'studio') {
    if (cfg.on && !studio) {
      studio = new THREE.Group();
      studio.name = 'char2.studio';
      // check-allow: no-raw-light（离屏测试场景/截图摄影棚灯，不进区域灯数预算）
      const hemi = new THREE.HemisphereLight('#dfe6ee', '#3a3632', 1.2);
      const key = new THREE.DirectionalLight('#fff4e6', 2.2);
      const fill = new THREE.DirectionalLight('#cfe0ff', 0.8);
      studio.add(hemi, key, fill, key.target, fill.target);
      studio.traverse(o => { o.layers.mask = 0xffffffff; });
      area.root.add(studio);
    }
    if (studio) {
      studio.visible = !!cfg.on;
      const t = cfg.target ?? [0, 1, 0];
      const [, key, fill] = studio.children as [THREE.Light, THREE.DirectionalLight, THREE.DirectionalLight];
      key.position.set(t[0] + 2.5, 4.5, t[2] + 3.5);
      key.target.position.set(t[0], 1, t[2]);
      fill.position.set(t[0] - 3.5, 2, t[2] + 2.5);
      fill.target.position.set(t[0], 1, t[2]);
      studio.updateMatrixWorld(true);
    }
    r.t(`摄影棚灯 ${cfg.on ? '开' : '关'}`, true);
    G.__char2spawnInfo = { studio: !!cfg.on };
    return r.done();
  }
  if (op === 'spawn' && (cfg.kind || cfg.crowd || cfg.paper)) {
    let s: Spawned;
    if (cfg.crowd) {
      const c = createCrowd(cfg.crowd);
      s = { root: c.mesh, dispose: () => c.dispose() };
    } else if (cfg.paper) {
      const p = createPaperFigure(cfg.paper);
      p.update(0.016);
      s = { root: p.root, dispose: () => p.dispose(), update: dt => p.update(dt) };
    } else {
      const rig = createCharacter(cfg.kind!, { ...(cfg.opts ?? {}), ...(cfg.look ? { look: cfg.look } : {}) });
      // 与 before/ 截图时一样：摆姿势、3 帧 0.016s 静止，再 steps 帧 1/30s（speed > 0 时走路）
      rig.setPose(cfg.pose ?? 'stand', 0);
      for (let i = 0; i < 3; i++) rig.update(0.016, 0);
      for (let i = 0; i < (cfg.steps ?? 0); i++) rig.update(1 / 30, cfg.speed ?? 0);
      s = { root: rig.root, dispose: () => rig.dispose(), update: (dt, sp) => rig.update(dt, sp) };
    }
    const p = cfg.pos ?? [0, 0, 0];
    s.root.position.set(p[0], p[1], p[2]);
    s.root.rotation.y = ((cfg.yaw ?? 0) * Math.PI) / 180;
    s.root.userData.char2spawn = true;
    area.root.add(s.root);
    s.root.updateMatrixWorld(true);
    spawned.push(s);
    const b = new THREE.Box3().setFromObject(s.root);
    const size = b.isEmpty() ? new THREE.Vector3() : b.getSize(new THREE.Vector3());
    G.__char2spawnInfo = { h: +size.y.toFixed(3), w: +size.x.toFixed(3), n: spawned.length };
    r.t(`生成 ${cfg.kind ?? (cfg.crowd ? 'crowd' : 'paper')}`, true);
  } else {
    G.__char2spawnInfo = { n: spawned.length };
    r.t(`清空（剩 ${spawned.length}）`, true);
  }
  G.__char2spawned = spawned;
  return r.done();
});

// ================================================================ char2.layout

/** 旧版（拆分前 humanoid.ts）的关节数值，逐项核对用。 */
function legacyLocal(s: number, bw: number, hunch: boolean): Record<string, [number, number, number]> {
  const drop = hunch ? 0.02 * s : 0;
  return {
    hips: [0, 0.95 * s, 0], spine: [0, 0.1 * s, 0], neck: [0, 0.45 * s, 0], headSlot: [0, 0, 0],
    shoulderL: [-0.195 * s * bw, 0.378 * s - drop, 0], shoulderR: [0.195 * s * bw, 0.378 * s - drop, 0],
    elbowL: [0, -0.29 * s, 0], elbowR: [0, -0.29 * s, 0], hipL: [-0.095 * s * bw, -0.03 * s, 0], hipR: [0.095 * s * bw, -0.03 * s, 0],
    kneeL: [0, -0.43 * s, 0], kneeR: [0, -0.43 * s, 0], wristL: [0, -0.245 * s, 0], wristR: [0, -0.245 * s, 0], ankleL: [0, -0.415 * s, 0], ankleR: [0, -0.415 * s, 0],
  };
}

registerSelftest('char2.layout', () => {
  const r = report();
  const BW = { normal: 1, slim: 0.86, stout: 1.14, hunch: 0.94 } as const;
  let bad: string[] = [];
  for (const build of ['normal', 'slim', 'stout', 'hunch'] as const) {
    for (const age of ['young', 'old'] as const) {
      for (const h of [1.75, 1.5, 1.82]) {
        const s = h / 1.75;
        const spec = { height: h, build, shirt: '#888', pants: '#444', head: 'human' as const };
        const face = { skin: '#c99a78', hair: '#222', hairStyle: 'crop' as const, age };
        const lay = jointLayout(profileOf(spec, face), s);
        const want = legacyLocal(s, BW[build], build === 'hunch');
        for (const [j, v] of Object.entries(want)) {
          const got = lay.local[j as keyof typeof lay.local];
          if (!got.every((x, i) => near(x, v[i]!, 1e-9))) bad.push(`${build}/${age}/${h} ${j} ${f3(got)} ≠ ${f3(v)}`);
        }
      }
    }
  }
  r.t('成年人、老人（四种体型、三种身高）的关节布局 = 旧版数值', bad.length === 0, bad.slice(0, 4).join('；'));
  // 儿童、土地（PLAN §2.6）
  const s = 1.2 / 1.75;
  const child = jointLayout(profileOf({ height: 1.2, shirt: '#888', pants: '#444', head: 'human' }, { skin: '#c99a78', hair: '#222', hairStyle: 'child_bowl', age: 'child' }), s);
  const cw: Record<string, [number, number, number]> = {
    hips: [0, 0.82 * s, 0], hipR: [0.085 * s, -0.03 * s, 0], kneeR: [0, -0.37 * s, 0], ankleR: [0, -0.345 * s, 0], spine: [0, 0.1 * s, 0], neck: [0, 0.44 * s, 0],
    headSlot: [0, -0.025 * s, 0], shoulderR: [0.17 * s, 0.355 * s, 0], elbowR: [0, -0.255 * s, 0], wristR: [0, -0.215 * s, 0],
  };
  bad = Object.entries(cw).filter(([j, v]) => !child.local[j as keyof typeof child.local].every((x, i) => near(x, v[i]!, 1e-9))).map(([j]) => j);
  // fix1：孩子 5.3–5.6 头身（hips 0.82s、领口 1.36s、headSlot -0.025s、头 ×1.38）
  r.t('儿童布局（hips 0.82s、领口 1.36s、headSlot -0.025s、肩 ±0.17s@0.355s、肘 -0.255s、腕 -0.215s、膝 -0.37s、踝 -0.345s、踝高 0.075s）',
    bad.length === 0 && near(child.collarY, 1.36 * s, 1e-9) && near(child.bind.ankleR[1], 0.075 * s, 1e-9), bad.join(','));
  const deity = jointLayout(profileOf({ height: 1.2, build: 'stout', shirt: '#888', pants: '#444', head: 'human' }, undefined, { profile: { deity: true } }), s);
  r.t('土地布局（hips 0.84s、neck 0.33s、headSlot -0.02s、踝高 0.075s）', near(deity.hipsY, 0.84 * s, 1e-9) && near(deity.local.neck[1], 0.33 * s, 1e-9) && near(deity.local.headSlot[1], -0.02 * s, 1e-9) && near(deity.bind.ankleR[1], 0.075 * s, 1e-6), `ankle ${deity.bind.ankleR[1].toFixed(4)}`);
  const adult = jointLayout(profileOf({ height: 1.75, shirt: '#888', pants: '#444', head: 'human' }), 1);
  r.t('成年人领口 1.50、踝高 0.075', near(adult.collarY, 1.5, 1e-9) && near(adult.bind.ankleR[1], 0.075, 1e-9));
  const legacyChild = jointLayout(profileOf({ height: 1.2, shirt: '#888', pants: '#444', head: 'human' }, { skin: '#c99a78', hair: '#222', hairStyle: 'crop', age: 'child' }), s, { legacy: true });
  r.t('legacy 布局对儿童也用成年人数值', near(legacyChild.hipsY, 0.95 * s, 1e-9));
  // 人偶的关节 = 布局（当前 LEGACY_LAYOUT）
  bad = [];
  for (const [spec, face] of [
    [{ height: 1.75, build: 'hunch' as const, shirt: '#888', pants: '#444', head: 'human' as const }, undefined],
    [{ height: 1.2, shirt: '#888', pants: '#444', head: 'human' as const }, { skin: '#c99a78', hair: '#222', hairStyle: 'crop' as const, age: 'child' as const }],
  ] as const) {
    const hm = createHumanoidInternal(spec, face);
    const lay = jointLayout(hm.profile, hm.s, { legacy: LEGACY_LAYOUT });
    for (const j of Object.keys(lay.local) as (keyof typeof lay.local)[]) {
      const g = (hm.joints as Record<string, THREE.Group>)[j] ?? (hm.extraJoints as Record<string, THREE.Group>)[j];
      const v = lay.local[j];
      if (!g) { bad.push(`${j} missing`); continue; }
      if (j === 'hips') continue; // 动作改 hips.position.y（呼吸/行走起伏只在走路时；站立 = hipsY）
      if (!near(g.position.x, v[0], 1e-9) || !near(g.position.y, v[1], 1e-9) || !near(g.position.z, v[2], 1e-9)) bad.push(`${j} ${f3(g.position)} ≠ ${f3(v)}`);
    }
    hm.dispose();
  }
  r.t(`人偶关节位置 = jointLayout（LEGACY_LAYOUT ${LEGACY_LAYOUT}）`, bad.length === 0, bad.slice(0, 4).join('；'));
  // 地标与旧锚点一致（characters.ts makeAnchors）
  const land = landmarksOf(profileOf({ height: 1.75, shirt: '#888', pants: '#444', head: 'human' }), 1);
  r.t('地标：anchorHead (0,0.14,0)、anchorMouth (0,0.075,-0.1)、anchorChest (0,0.3,-0.12)、腕 -0.245、掌心 -0.30、踝高 0.075',
    land.head.anchorHead[1] === 0.14 && near(land.head.anchorMouth[2], -0.1) && near(land.torso.anchorChest[1], 0.3) && near(land.torso.anchorChest[2], -0.12)
    && near(land.arm.wristY, -0.245) && near(land.arm.palmCentreY, -0.3) && near(land.leg.ankleHeight, 0.075),
    `palm ${land.arm.palmCentreY.toFixed(3)} seatY ${land.leg.seatY.toFixed(3)}`);
  return r.done();
});

// ================================================================ char2.seams

const NECK_TILT = (18 * Math.PI) / 180, NECK_DOWN = (10 * Math.PI) / 180;

registerSelftest('char2.seams', () => {
  const r = report();
  const base = { height: 1.75, shirt: '#888', pants: '#444', head: 'human' as const };
  const profiles: [string, BodyProfile, number][] = [];
  for (const build of ['normal', 'slim', 'stout', 'hunch'] as const) profiles.push([`m/${build}`, profileOf({ ...base, build }), 1]);
  profiles.push(['f', profileOf(base, { skin: '#c99a78', hair: '#222', hairStyle: 'bun', age: 'young', female: true }), 1.6 / 1.75]);
  profiles.push(['old', profileOf({ ...base, build: 'hunch' }, { skin: '#c99a78', hair: '#222', hairStyle: 'crop', age: 'old' }), 1]);
  profiles.push(['boy', profileOf(base, { skin: '#c99a78', hair: '#222', hairStyle: 'child_bowl', age: 'child' }), 1.2 / 1.75]);
  profiles.push(['girl', profileOf(base, { skin: '#c99a78', hair: '#222', hairStyle: 'bun', age: 'child', female: true }), 1.2 / 1.75]);
  profiles.push(['deity', profileOf({ ...base, build: 'stout' }, undefined, { profile: { deity: true } }), 1.2 / 1.75]);
  const bad: string[] = [];
  for (const [tag, p, s] of profiles) {
    const seams = SEAMS(p, s);
    for (const ring of [seams.NECK_TOP, seams.WAIST]) {
      const want = ring.name === 'NECK_TOP' ? 20 : 24;
      if (ring.count !== want || ring.pos.length !== want * 3 || ring.nor.length !== want * 3) bad.push(`${tag} ${ring.name} count ${ring.count}`);
      const c = ring.centre;
      // 顶点 0 在 +x；count/4 在正前（z 最小）；count/2 在 -x
      const x0 = ring.pos[0]! - c[0], z0 = ring.pos[2]! - c[2];
      const q = ring.count / 4;
      const zq = ring.pos[q * 3 + 2]! - c[2], xh = ring.pos[2 * q * 3]! - c[0];
      if (!(x0 > 0 && Math.abs(z0) < 1e-6 && zq < 0 && xh < 0)) bad.push(`${tag} ${ring.name} order x0 ${x0.toFixed(4)} z0 ${z0.toFixed(4)} zq ${zq.toFixed(4)}`);
      let minZ = Infinity, minI = -1;
      for (let i = 0; i < ring.count; i++) {
        const nx = ring.nor[i * 3]!, ny = ring.nor[i * 3 + 1]!, nz = ring.nor[i * 3 + 2]!;
        const len = Math.hypot(nx, ny, nz);
        const out = nx * (ring.pos[i * 3]! - c[0]) + nz * (ring.pos[i * 3 + 2]! - c[2]);
        if (Math.abs(len - 1) > 1e-5 || out <= 0) bad.push(`${tag} ${ring.name} normal ${i} len ${len.toFixed(5)} out ${out.toFixed(5)}`);
        // NECK_TOP：圈平面法线 up = (0, cos18°, −sin18°)；接缝法线比圈平面内的外法线往下转 10° → n·up = −sin10°
        if (ring.name === 'NECK_TOP' && Math.abs(ny * Math.cos(NECK_TILT) - nz * Math.sin(NECK_TILT) + Math.sin(NECK_DOWN)) > 1e-5) bad.push(`${tag} NECK_TOP normal ${i} not tilted 10° below the ring plane`);
        if (ring.name === 'WAIST' && Math.abs(ny) > 1e-6) bad.push(`${tag} WAIST normal ${i} not horizontal`);
        if (ring.pos[i * 3 + 2]! < minZ) { minZ = ring.pos[i * 3 + 2]!; minI = i; }
      }
      if (minI !== q) bad.push(`${tag} ${ring.name} front vertex ${minI} ≠ ${q}`);
      const wsum = ring.skin.weights.reduce((a, b) => a + b, 0);
      if (!near(wsum, 1, 1e-9)) bad.push(`${tag} ${ring.name} weights sum ${wsum}`);
    }
  }
  r.t('全部体型：NECK_TOP 20 点、WAIST 24 点；顶点顺序（0 在 +x、count/4 正前）；单位外法线（NECK 往下倾、WAIST 水平）；蒙皮权重和 1', bad.length === 0, bad.slice(0, 5).join('；'));
  // 成年男人的冻结数值
  const ad = SEAMS(profileOf(base), 1);
  const nk = ad.NECK_TOP, wa = ad.WAIST;
  const fp = [nk.pos[15]!, nk.pos[16]!, nk.pos[17]!], bp = [nk.pos[45]!, nk.pos[46]!, nk.pos[47]!];
  r.t('NECK_TOP 成年人：前点 ≈ (0, 1.556, -0.033)，后点 ≈ (0, 1.584, 0.053)，中心 (0, 1.570, 0.010)',
    near(fp[0]!, 0, 1e-6) && near(fp[1]!, 1.556, 1e-3) && near(fp[2]!, -0.033, 1e-3) && near(bp[1]!, 1.584, 1e-3) && near(bp[2]!, 0.053, 1e-3) && near(nk.centre[1], 1.57, 1e-9),
    `front ${f3(fp)} back ${f3(bp)}`);
  r.t('NECK_TOP 100% headSlot；WAIST hips 0.65 / spine 0.35', nk.skin.bones[0] === boneIndex('headSlot') && nk.skin.weights[0] === 1
    && wa.skin.bones[0] === boneIndex('hips') && wa.skin.weights[0] === 0.65 && wa.skin.bones[1] === boneIndex('spine'));
  r.t('WAIST 成年人：y 0.975、半宽 0.150、半深 0.104', near(wa.pos[1]!, 0.975, 1e-6) && near(wa.pos[0]!, 0.15, 1e-6) && near(-wa.pos[6 * 3 + 2]!, 0.104, 1e-6), `${f3([wa.pos[0]!, wa.pos[1]!, wa.pos[6 * 3 + 2]!])}`);
  const fem = SEAMS(profileOf(base, { skin: '#c', hair: '#2', hairStyle: 'bun', age: 'young', female: true }), 1);
  r.t('女：NECK_TOP x×0.93 z×0.95（fix1）、WAIST x×0.92 z×0.95（fix2：再 × 女肩宽系数 bw）', near(fem.NECK_TOP.pos[0]! - fem.NECK_TOP.centre[0], 0.052 * 0.93, 1e-6) && near(fem.WAIST.pos[0]!, 0.15 * 0.92 * FEMALE_SHOULDER, 1e-6)
    && near(-fem.WAIST.pos[6 * 3 + 2]!, 0.104 * 0.95, 1e-6));
  const stout = SEAMS(profileOf({ ...base, build: 'stout' }), 1).WAIST;
  r.t('stout WAIST 前面鼓出 belly·0.5', near(-stout.pos[6 * 3 + 2]!, 0.104 * 1.22 + 0.025, 1e-6), (-stout.pos[6 * 3 + 2]!).toFixed(4));
  // checkRingMatch / snapRing：一段从接缝往下的放样，最后一圈 snap 到接缝
  const lower = planeRing([0, 0.8, 0], new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), 0.16, 0.11, 24, { exp: 3 });
  const geo = loftRings([lower, wa.pos]);
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array((geo.attributes.position as THREE.BufferAttribute).count * 4), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array((geo.attributes.position as THREE.BufferAttribute).count * 4), 4));
  snapRing(geo, 25, wa, { dupSeam: true });
  const m1 = checkRingMatch(geo, wa);
  r.t('snapRing 之后 checkRingMatch 通过（≤0.1mm、法线点积 > 0.999）', m1.ok, m1.notes);
  (geo.attributes.position as THREE.BufferAttribute).setY(25 + 3, (geo.attributes.position as THREE.BufferAttribute).getY(25 + 3) + 5e-4);
  const m2 = checkRingMatch(geo, wa);
  r.t('偏 0.5mm 时 checkRingMatch 报错', !m2.ok, m2.notes);
  const sw = geo.attributes.skinWeight as THREE.BufferAttribute;
  r.t('snapRing 写上接缝的蒙皮', near(sw.getX(25), 0.65) && near(sw.getY(25), 0.35));
  geo.dispose();
  return r.done();
});

// ================================================================ char2.skin_probe

/** 探针：右臂（肩 → 肘 → 腕再往下 2cm）换成一根蒙皮管子，sleeve 槽（合并成 'sleeves'）。 */
function probeTube(ctx: BuildCtx): SkinnedPiece {
  const b = ctx.layout.bind;
  const R = 0.05 * ctx.s;
  const top = b.shoulderR[1] + 0.02 * ctx.s, bot = b.wristR[1] - 0.02 * ctx.s;
  const x = b.shoulderR[0];
  const rows = 28;
  const rings: Float32Array[] = [];
  const ex = new THREE.Vector3(1, 0, 0), ez = new THREE.Vector3(0, 0, 1);
  for (let j = 0; j < rows; j++) {
    const y = top + (bot - top) * (j / (rows - 1));
    rings.push(planeRing([x, y, 0], ex, ez, R, R, 16));
  }
  const geo = loftRings(rings, { capStart: [x, top, 0], capEnd: [x, bot, 0] });
  const sh = boneIndex('shoulderR'), el = boneIndex('elbowR'), wr = boneIndex('wristR');
  setSkin(geo, p => {
    if (p.y > b.elbowR[1]) return blend2(sh, el, smooth01(b.elbowR[1] + 0.025 * ctx.s, b.elbowR[1] - 0.025 * ctx.s, p.y));
    return blend2(el, wr, smooth01(b.wristR[1] + 0.02 * ctx.s, b.wristR[1] - 0.005 * ctx.s, p.y));
  });
  return { kind: 'skinned', name: 'probeTube', slot: 'sleeve', geo };
}

function createProbe() {
  const upper = (ctx: BuildCtx): RegionResult => {
    const res = buildUpper(ctx);
    return { ...res, parts: [...res.parts.filter(p => !/^(upperArmR|forearmR|cuffR|handR|sleeveR|sleeveHemR)$/.test(p.name)), probeTube(ctx)] };
  };
  return createHumanoidInternal({ height: 1.75, shirt: '#5a6c8a', pants: '#303236', sleeves: 'long', head: 'human' }, undefined, undefined, { builders: { upper } });
}

registerSelftest('char2.skin_probe', (game: Game) => {
  const r = report();
  const renderer = game.renderer;
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
  cam.position.set(0.9, 1.25, -2.6);
  cam.lookAt(0.2, 1.1, 0);
  cam.layers.enableAll();
  const counts: { geo: number; tex: number; prog: number }[] = [];
  const ir = new IrRenderer();
  for (let cycle = 0; cycle < 3; cycle++) {
    const scene = testScene();
    const h = createProbe();
    scene.add(h.root);
    const tube = h.parts.sleeves as THREE.SkinnedMesh | undefined;
    if (cycle === 0) {
      r.t('探针：sleeves 是 SkinnedMesh，骨架 17 根骨头、名为 bone.<关节>、是关节的子节点',
        !!tube?.isSkinnedMesh && tube.skeleton.bones.length === BONES.length && tube.skeleton.bones.every((b, i) => b.name === `bone.${BONES[i]}` && b.parent?.name === BONES[i]));
      r.t('extraJoints：腕在肘下、踝在膝下', h.extraJoints.wristR.parent === h.joints.elbowR && h.extraJoints.ankleL.parent === h.joints.kneeL);
    }
    if (!tube) break;
    const others = Object.values(h.parts).filter(m => m !== tube);
    const solo = (on: boolean) => { for (const m of others) m.visible = !on; };
    // ---- 四种外观 + 红外：只留管子也画得出来
    solo(true);
    const px: Record<string, number> = {};
    for (const m of ['standard', 'ghost', 'replay', 'silhouette'] as const) {
      h.setMaterialMode(m);
      scene.background = m === 'silhouette' ? new THREE.Color('#808080') : null;
      px[m] = countPixels(renderer, scene, cam);
      if (m === 'silhouette') px[m] = 128 * 128 - px[m]; // 灰底上数黑像素：背景亮、剪影暗
    }
    scene.background = null;
    h.setMaterialMode('standard');
    ir.begin([scene]);
    try {
      px.ir = countPixels(renderer, scene, cam);
    } finally {
      ir.end();
    }
    if (cycle === 0) r.t('蒙皮管子在 standard/ghost/replay/silhouette/红外下都画得出（> 150 像素）', Object.values(px).every(n => n > 150), JSON.stringify(px));
    // ---- 淡出
    h.setOpacity(0.4);
    const mat = tube.material as THREE.Material;
    const fadePx = countPixels(renderer, scene, cam);
    if (cycle === 0) r.t('setOpacity(0.4)：管子材质透明、不透明度 0.4、仍画得出', mat.transparent && near(mat.opacity, 0.4, 1e-6) && fadePx > 150, `${mat.opacity} px ${fadePx}`);
    h.setOpacity(1);
    solo(false);
    // ---- 弯肘：管子最下端（100% 腕）跟着腕关节走
    h.joints.elbowR.rotation.x = 1.2;
    h.root.updateMatrixWorld(true);
    const pos = tube.geometry.attributes.position as THREE.BufferAttribute;
    let lo = 0;
    for (let i = 1; i < pos.count; i++) if (pos.getY(i) < pos.getY(lo)) lo = i;
    const got = tube.getVertexPosition(lo, new THREE.Vector3());
    const wb = createProbeLayout(h);
    const want = h.extraJoints.wristR.localToWorld(new THREE.Vector3(pos.getX(lo) - wb[0], pos.getY(lo) - wb[1], pos.getZ(lo) - wb[2]));
    if (cycle === 0) r.t('elbowR.x = 1.2：管子末端跟着腕关节（误差 < 1mm）', got.distanceTo(want) < 1e-3, `${f3(got)} vs ${f3(want)}`);
    const elbowW = h.joints.elbowR.getWorldPosition(new THREE.Vector3()), wristW = h.extraJoints.wristR.getWorldPosition(new THREE.Vector3());
    const forearmDown = wristW.y > elbowW.y - 0.2 && wristW.z < elbowW.z - 0.1;
    if (cycle === 0) r.t('弯肘后前臂往前抬', forearmDown, `elbow ${f3(elbowW)} wrist ${f3(wristW)}`);
    // ---- 胶囊射线：前臂中点，从 +x 侧打过来命中，偏开 r + 5cm 不中
    const mid = elbowW.clone().lerp(wristW, 0.5);
    const rc = new THREE.Raycaster(new THREE.Vector3(mid.x + 1, mid.y, mid.z), new THREE.Vector3(-1, 0, 0), 0, 5);
    rc.layers.enableAll();
    const hit = rc.intersectObject(tube, false);
    const R = 0.05 * h.s;
    const dir = wristW.clone().sub(elbowW).normalize();
    const perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(1, 0, 0)).normalize();
    // 只量这根前臂附近（far 1.2）：集成后 sleeves 里还有另一条胳膊，整条射线横穿身体会打中它
    const rc2 = new THREE.Raycaster(new THREE.Vector3(mid.x + 1, mid.y, mid.z).addScaledVector(perp, R + 0.05), new THREE.Vector3(-1, 0, 0), 0, 1.2);
    const miss = rc2.intersectObject(tube, false);
    if (cycle === 0) {
      r.t('射线命中前臂（距离 ≈ 1 − r，±1cm）', hit.length > 0 && Math.abs(hit[0]!.distance - (1 - R)) < 0.01, hit.length ? hit[0]!.distance.toFixed(4) : 'no hit');
      r.t('偏开 r + 5cm 的射线不中', miss.length === 0, miss.length ? miss[0]!.distance.toFixed(4) : '');
    }
    // ---- 包围盒跟随姿势；保守视锥球包住全部顶点
    h.joints.elbowR.rotation.x = 0;
    const b0 = h.bounds(new THREE.Box3());
    h.joints.shoulderR.rotation.x = 2.62;
    const b1 = h.bounds(new THREE.Box3());
    h.root.updateMatrixWorld(true);
    let maxTip = -Infinity;
    for (let i = 0; i < pos.count; i++) maxTip = Math.max(maxTip, tube.getVertexPosition(i, new THREE.Vector3()).y);
    if (cycle === 0) r.t('举臂（shoulderR.x 2.62）后 bounds 上沿跟着升高、包住管子', b1.max.y > b0.max.y + 0.1 && b1.max.y >= maxTip - 1e-3, `max.y ${b0.max.y.toFixed(3)} → ${b1.max.y.toFixed(3)}，管子最高 ${maxTip.toFixed(3)}`);
    h.update(0, 0); // 动作 apply：关节回到姿势，刷新视锥球
    h.joints.shoulderR.rotation.x = 2.62;
    h.joints.elbowR.rotation.x = 2.0;
    h.root.updateMatrixWorld(true);
    const sph = tube.boundingSphere!;
    let outside = 0;
    for (let i = 0; i < pos.count; i++) if (sph.distanceToPoint(tube.getVertexPosition(i, new THREE.Vector3())) > 1e-4) outside++;
    if (cycle === 0) r.t('任意姿势下保守视锥球包住全部顶点', outside === 0, `r ${sph.radius.toFixed(3)} outside ${outside}`);
    // 世界里挪动 root：射线照样命中
    h.update(0, 0);
    h.root.position.set(3, 0, -2);
    h.root.rotation.y = 0.7;
    h.root.updateMatrixWorld(true);
    const ew = h.joints.elbowR.getWorldPosition(new THREE.Vector3()).lerp(h.extraJoints.wristR.getWorldPosition(new THREE.Vector3()), 0.5);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(h.root.quaternion);
    const rc3 = new THREE.Raycaster(ew.clone().addScaledVector(side, 1), side.clone().negate(), 0, 5);
    const hit3 = rc3.intersectObject(tube, false);
    if (cycle === 0) r.t('root 平移旋转后射线仍命中（胶囊在世界空间）', hit3.length > 0 && Math.abs(hit3[0]!.distance - (1 - R)) < 0.01, hit3.length ? hit3[0]!.distance.toFixed(4) : 'no hit');
    countPixels(renderer, scene, cam);
    if (cycle === 0) {
      // 区域卸载走 Disposer.trackObject（只释放几何/材质/贴图，不调 rig.dispose）：骨骼贴图也得跟着释放（roundtrip 不漏贴图）
      const hadBoneTex = !!tube.skeleton.boneTexture;
      const d = new Disposer();
      d.trackObject(h.root);
      d.dispose();
      r.t('区域卸载（Disposer.trackObject）也释放骨骼贴图', hadBoneTex && tube.skeleton.boneTexture === null, `had ${hadBoneTex}`);
    }
    h.dispose();
    scene.clear();
    counts.push({ geo: renderer.info.memory.geometries, tex: renderer.info.memory.textures, prog: renderer.info.programs?.length ?? 0 });
  }
  const [, c1, c2] = counts;
  r.t('建/画/释放三轮：几何、贴图、着色器程序数回到同一基线（第 2、3 轮相同）', !!c1 && !!c2 && c1.geo === c2.geo && c1.tex === c2.tex && c1.prog === c2.prog, JSON.stringify(counts));
  return r.done();
});

/** 探针人偶的腕关节绑定位置（profile 布局）。 */
function createProbeLayout(h: ReturnType<typeof createHumanoidInternal>): readonly [number, number, number] {
  return jointLayout(h.profile, h.s, { legacy: LEGACY_LAYOUT }).bind.wristR;
}

// ================================================================ char2.invariants

registerSelftest('char2.invariants', () => {
  const r = report();
  const kinds: CharacterKind[] = ['tudi', 'wang', 'lu', 'huang', 'zhou', 'jianguo', 'kid', 'bride', 'apprentice', 'junkman', 'worker', 'neighbor'];
  const bad: string[] = [];
  let n = 0;
  for (const k of kinds) {
    for (const look of ['live', 'ghost', 'replay', 'silhouette'] as const) {
      for (const variant of k === 'huang' ? ['man', 'weasel', 'masked'] : [undefined]) {
        try {
          const c = createCharacter(k, { look, seed: 3, ...(variant ? { variant } : {}) });
          c.setPose('walk');
          c.update(1 / 30, 1.2);
          const root = c.root;
          // 遍历顺序里第一个 'neck' 是关节 Group，第一个 'head' 是 headSlot 下的网格（或没有）
          const neck = root.getObjectByName('neck');
          if (!neck || (neck as THREE.Mesh).isMesh || neck !== c.joints.neck) bad.push(`${k}/${look} first 'neck' is not the joint`);
          const head = root.getObjectByName('head') as THREE.Mesh | undefined;
          if (head && k !== 'huang' && (!head.isMesh || head.parent !== c.joints.headSlot)) bad.push(`${k}/${look} first 'head' not a mesh under headSlot`);
          let wrists = 0;
          root.traverse(o => { if (o.name === 'wristR' || o.name === 'ankleL') wrists++; });
          if (k !== 'huang' && wrists < 2) bad.push(`${k}/${look} missing wrist/ankle joints`);
          root.traverse(o => {
            const sm = o as THREE.SkinnedMesh;
            if (!sm.isSkinnedMesh) return;
            if (sm.skeleton.bones.length !== BONES.length) bad.push(`${k}/${look} ${sm.name} skeleton ${sm.skeleton.bones.length}`);
            if (!sm.parent?.getObjectByName('pivot') || sm.parent.children.indexOf(sm.parent.getObjectByName('pivot')!) < 0) bad.push(`${k}/${look} ${sm.name} not under rig root`);
            if (sm.castShadow) bad.push(`${k}/${look} ${sm.name} castShadow`);
          });
          let lights = 0;
          root.traverse(o => { if ((o as THREE.Light).isLight) lights++; });
          if (lights) bad.push(`${k}/${look} has ${lights} lights`);
          c.setOpacity(0.5);
          c.dispose();
          n++;
        } catch (err) {
          bad.push(`${k}/${look}/${variant ?? ''}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
  r.t(`全部角色 × 外观（${n}）：'neck'/'head' 名字与顺序、腕踝关节、蒙皮网格挂在 root、骨架 17、无阴影、无灯`, bad.length === 0, bad.slice(0, 6).join('；'));
  return r.done();
});
