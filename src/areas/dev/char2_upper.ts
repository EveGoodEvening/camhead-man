// owner: WP2
// char2 WP-U：躯干、脖子、胳膊、手、衬衫（char2.upper_*） 的开发沙盒自测。只有这个 WP 改这个文件（PLAN §5.7）。
//   char2.upper_seams     WAIST / NECK_TOP 接缝（checkRingMatch）；部件与 draw call（torso、sleeves、skin、collar ≤ 4）；三角形
//   char2.upper_shell     袖子下面没有胳膊、衣服下面没有身子：从骨轴往外的射线只穿过一层（领子、贴面除外）；袖子法线朝外
//   char2.upper_pose      举臂（shoulderR.x 2.62）胳膊不插进躯干 > 5mm；弯肘 2.0 肘背不塌（≥ 60% 半径）
//   char2.upper_hand      手长、掌心位置（肘下 -0.30s ±1cm）、手心朝大腿
//   char2.upper_landmarks anchorChest 在胸前 ±1cm、肩下 0.10s 的袖子半径 0.058/0.062 ±3mm、背后线缆平面
//   char2.upper_spawn     工具（WP-U 截图脚本用）：按 globalThis.__upperSpawn 在沙盒里摆按 PLAN §4 穿好衣服的人身
// 除 upper_spawn 外都不需要 WebGL（几何、CPU 蒙皮），Node 侧也能跑。

import * as THREE from 'three';
import type { AreaPart } from '../../core/area';
import type { Game } from '../../core/game';
import type { Pose } from '../../core/types';
import type { SelftestResult } from '../../debug/selftest';
import { registerSelftest } from '../../debug/selftest';
import { createHumanoidInternal } from '../../rigs/human/assemble';
import { boneIndex } from '../../rigs/human/profile';
import { checkRingMatch } from '../../rigs/human/shared';
import type { BuildCtx, FaceOpts, HumanoidInternal, HumanoidSpec, HumanoidStyle } from '../../rigs/human/types';
import { buildUpper, upperInfo } from '../../rigs/human/upper';
import { section, upperDims } from '../../rigs/human/upper/dims';

const part: AreaPart = {};
export default part;

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

type Cast = { spec: HumanoidSpec; face?: FaceOpts; style?: HumanoidStyle };
/** PLAN §4 的上身款式（WP-C 最终定；这里只为自测与截图）。 */
export const UPPER_CAST: Record<string, Cast> = {
  zhou: { spec: { height: 1.75, build: 'hunch', shirt: '#2E3A55', pants: '#3B3D42', shoes: '#141416', skin: '#A07E66', sleeves: 'short', head: 'human' }, face: { skin: '#A07E66', hair: '#4A4642', hairStyle: 'crop', age: 'old', seed: 1960 }, style: { garment: { top: 'work_shirt', collar: 'shirt', placket: 'buttons', pockets: 'chest2', tucked: true, bottom: 'work_trousers', shoes: 'cloth' } } },
  lu: { spec: { height: 1.82, build: 'slim', shirt: '#7E8288', pants: '#6A6D72', shoes: '#1d1a18', skin: '#C49A7E', sleeves: 'long', head: 'human' }, face: { skin: '#C49A7E', hair: '#6E6C68', hairStyle: 'side_part', age: 'old', seed: 11 }, style: { profile: { kyphosis: 0.08 }, garment: { top: 'zhongshan', collar: 'stand', placket: 'zhongshan5', pockets: 'zhongshan4', tucked: false, hemDrop: 0.16, bottom: 'trousers', shoes: 'leather' } } },
  wang: { spec: { height: 1.5, build: 'hunch', shirt: '#5B6E8C', pants: '#2B2A2E', shoes: '#141416', skin: '#C9A080', sleeves: 'long', head: 'human' }, face: { skin: '#C9A080', hair: '#8D8A86', hairStyle: 'bun', age: 'old', female: true, seed: 7 }, style: { profile: { kyphosis: 0.35 }, garment: { top: 'blouse', collar: 'mandarin', placket: 'side_frog', tucked: false, hemDrop: 0.1, cuffs: 'band', bottom: 'trousers', shoes: 'cloth' } } },
  tudi: { spec: { height: 1.2, build: 'stout', shirt: '#7C7A74', pants: '#4C4A46', shoes: '#1a1a1a', skin: '#C49A7A', sleeves: 'long', robe: true, head: 'human' }, face: { skin: '#C49A7A', hair: '#E8E6E0', hairStyle: 'bald', age: 'old', seed: 5 }, style: { profile: { deity: true }, garment: { top: 'robe_top', collar: 'none', bottom: 'robe', shoes: 'cloth' } } },
  bride: { spec: { height: 1.6, build: 'slim', shirt: '#B3202A', pants: '#B3202A', shoes: '#7A1018', skin: '#D8B090', sleeves: 'long', robe: true, head: 'human' }, face: { skin: '#D8B090', hair: '#120e0c', hairStyle: 'long', age: 'young', female: true, seed: 1990 }, style: { profile: { waistTaper: 0.85 }, garment: { top: 'blouse', collar: 'mandarin', placket: 'side_frog', tucked: false, hemDrop: 0.06, bottom: 'qipao_skirt', shoes: 'embroidered' } } },
  worker: { spec: { height: 1.76, build: 'stout', shirt: '#D86A1E', pants: '#2C3440', shoes: '#1a1816', skin: '#B08A6A', sleeves: 'long', head: 'human' }, face: { skin: '#B08A6A', hair: '#15120f', hairStyle: 'crop', age: 'young', seed: 28 }, style: { garment: { top: 'work_shirt', collar: 'shirt', placket: 'buttons', pockets: 'chest2', tucked: true, cuffs: 'turnup', bottom: 'work_trousers', shoes: 'boot' } } },
  apprentice: { spec: { height: 1.7, build: 'slim', shirt: '#E6E2D6', pants: '#2E3036', shoes: '#1a1816', skin: '#C9A080', sleeves: 'long', head: 'human' }, face: { skin: '#C9A080', hair: '#15120f', hairStyle: 'side_part', age: 'young', seed: 17 }, style: { garment: { top: 'work_shirt', collar: 'shirt', placket: 'buttons', tucked: true, cuffs: 'turnup', bottom: 'trousers', shoes: 'sneaker' } } },
  kid: { spec: { height: 1.25, build: 'slim', shirt: '#E6E4DC', pants: '#2F4A7E', shoes: '#EDEBE3', skin: '#D1A788', sleeves: 'short', head: 'human' }, face: { skin: '#D1A788', hair: '#141210', hairStyle: 'child_bowl', age: 'child', seed: 3 }, style: { garment: { top: 'tshirt', collar: 'crew', tucked: false, hemDrop: 0.05, bottom: 'trousers', shoes: 'sneaker' } } },
  jianguo: { spec: { height: 1.73, build: 'normal', shirt: '#4A5566', pants: '#2E3440', shoes: '#2a2420', skin: '#C39C80', sleeves: 'long', head: 'human' }, face: { skin: '#C39C80', hair: '#15120f', hairStyle: 'crop', age: 'young', seed: 1986 }, style: { garment: { top: 'jacket', collar: 'shirt', tucked: false, hemDrop: 0.06, cuffs: 'band', bottom: 'trousers', shoes: 'leather' } } },
  junkman: { spec: { height: 1.66, build: 'hunch', shirt: '#5A5850', pants: '#3E3C38', shoes: '#231f1a', skin: '#A88468', sleeves: 'long', head: 'human' }, face: { skin: '#A88468', hair: '#6b665e', hairStyle: 'thin_old', age: 'old', seed: 23 }, style: { garment: { top: 'cotton_padded', collar: 'crew', tucked: false, hemDrop: 0.12, bottom: 'trousers', shoes: 'cloth' } } },
  huang: { spec: { height: 1.4, build: 'slim', shirt: '#4E5A63', pants: '#3A3A36', shoes: '#1a1814', skin: '#B08A68', sleeves: 'long', head: 'human' }, face: { skin: '#B08A68', hair: '#3a3026', hairStyle: 'thin_old', age: 'old', seed: 1970 }, style: { garment: { top: 'zhongshan', collar: 'stand', placket: 'zhongshan5', pockets: 'zhongshan4', tucked: false, hemDrop: 0.12, bottom: 'trousers', shoes: 'leather' } } },
  neighborF: { spec: { height: 1.58, build: 'normal', shirt: '#7A2E2E', pants: '#3C4A6A', shoes: '#1d1a18', skin: '#C9A080', sleeves: 'short', head: 'human' }, face: { skin: '#C9A080', hair: '#15120f', hairStyle: 'bun', age: 'young', female: true, seed: 31 }, style: { garment: { top: 'blouse', collar: 'crew', tucked: false, hemDrop: 0.08, bottom: 'trousers', shoes: 'cloth' } } },
  player: { spec: { height: 1.75, build: 'normal', shirt: '#2E3A55', pants: '#3B3D42', shoes: '#141416', skin: '#A98A74', sleeves: 'short', head: 'none' }, style: { garment: { top: 'work_shirt', collar: 'shirt_open', placket: 'buttons', pockets: 'chest2', tucked: true, bottom: 'trousers', shoes: 'cloth' } } },
};

/** 建一个人偶的构建上下文（不留人偶）。 */
function ctxOf(c: Cast): BuildCtx {
  let ctx: BuildCtx | null = null;
  const h = createHumanoidInternal(c.spec, c.face, c.style, { extra: [x => { ctx = x; return { parts: [] }; }] });
  h.dispose();
  return ctx!;
}

/** buildUpper 的分部件结果（合并前：躯干、贴面、领子分开）。 */
function piecesOf(ctx: BuildCtx): Record<string, THREE.BufferGeometry> {
  const res = buildUpper(ctx);
  const pieces: Record<string, THREE.BufferGeometry> = {};
  for (const p of res.parts) if (p.kind === 'skinned') pieces[p.name] = p.geo;
  return pieces;
}
const disposePieces = (p: Record<string, THREE.BufferGeometry>) => { for (const g of Object.values(p)) g.dispose(); };

/** 射线与几何（绑定姿势）的全部交点距离（双面，去掉重合的）。 */
function crossings(geos: readonly THREE.BufferGeometry[], ray: THREE.Ray, far: number): number[] {
  const out: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();
  for (const g of geos) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const idx = g.index!;
    for (let t = 0; t < idx.count; t += 3) {
      a.fromBufferAttribute(pos, idx.getX(t)); b.fromBufferAttribute(pos, idx.getX(t + 1)); c.fromBufferAttribute(pos, idx.getX(t + 2));
      if (ray.intersectTriangle(a, b, c, false, hit)) {
        const d = hit.distanceTo(ray.origin);
        if (d <= far && !out.some(x => Math.abs(x - d) < 2e-4)) out.push(d);
      }
    }
  }
  return out.sort((x, y) => x - y);
}

const CHECK = ['zhou', 'lu', 'wang', 'tudi', 'bride', 'worker', 'apprentice', 'kid', 'jianguo', 'junkman', 'huang', 'neighborF', 'player'];

registerSelftest('char2.upper_seams', () => {
  const r = report();
  const bad: string[] = [], triBad: string[] = [], callBad: string[] = [], tris: string[] = [];
  for (const n of CHECK) {
    const c = UPPER_CAST[n]!;
    const ctx = ctxOf(c);
    const h = createHumanoidInternal(c.spec, c.face, c.style);
    const torso = h.parts.torso;
    if (!torso) bad.push(`${n}: no torso mesh`);
    else {
      const m = checkRingMatch(torso.geometry, ctx.seams.WAIST);
      if (!m.ok) bad.push(`${n} WAIST ${m.notes}`);
      if (!(torso as THREE.SkinnedMesh).isSkinnedMesh) bad.push(`${n}: torso not skinned`);
    }
    if (c.spec.head === 'human') {
      const skin = h.parts.skin;
      const m = skin ? checkRingMatch(skin.geometry, ctx.seams.NECK_TOP) : null;
      if (!m?.ok) bad.push(`${n} NECK_TOP ${m?.notes ?? 'no skin mesh'}`);
    }
    const info = upperInfo(c.spec)!;
    tris.push(`${n} ${info.tris}`);
    if (info.tris < 4500 || info.tris > 6500) triBad.push(`${n} ${info.tris}`);
    const upperMeshes = ['torso', 'sleeves', 'skin', 'collar'].filter(k => h.parts[k]);
    const legacy = Object.keys(h.parts).filter(k => /^(torsoOverlay|neckSkin|upperArm|forearm|hand[LR]|sleeve[LR]|sleeveHem|cuff)/.test(k));
    if (legacy.length) callBad.push(`${n} ${legacy.join(',')}`);
    if (upperMeshes.length > 4) callBad.push(`${n} ${upperMeshes.join(',')}`);
    const g = c.style?.garment;
    if (g?.collar && g.collar !== 'none' && !h.parts.collar) bad.push(`${n}: no collar mesh`);
    h.dispose();
  }
  r.t('WAIST、NECK_TOP 接缝：位置 ≤ 0.1mm、法线点积 > 0.999（13 种体型/款式）', bad.length === 0, bad.slice(0, 4).join('；'));
  r.t('上身 draw call ≤ 4（torso、sleeves、skin、collar），没有旧版部件', callBad.length === 0, callBad.slice(0, 3).join('；'));
  r.t('上身 + 手三角形 4.5k–6.5k', triBad.length === 0, `${triBad.join('；')} | ${tris.join(', ')}`);
  return r.done();
});

registerSelftest('char2.upper_shell', () => {
  const r = report();
  const bad: string[] = [];
  for (const n of ['zhou', 'lu', 'wang', 'worker', 'tudi', 'kid', 'player']) {
    const c = UPPER_CAST[n]!;
    const ctx = ctxOf(c);
    const pieces = piecesOf(ctx);
    const b = ctx.layout.bind;
    const s = ctx.s;
    const xS = b.shoulderR[0];
    // 胳膊：从骨轴（肩 → 肘 → 腕）水平往外打 16 个方向，只算 sleeves + skin（右臂附近）
    const armGeos = [pieces.sleeves, pieces.skin].filter((g): g is THREE.BufferGeometry => !!g);
    const yS = b.shoulderR[1], yE = b.elbowR[1], yWr = b.wristR[1];
    // 宽袍袖：肘下袖口里看得见前臂与衬里（那是真的里面），只量肘上
    const samples = n === 'tudi' ? [yS - 0.2 * s, yS - 0.24 * s] : [yS - 0.2 * s, yS - 0.24 * s, yE + 0.035 * s, yE - 0.06 * s, yE - 0.14 * s, yWr + 0.045 * s];
    let rays = 0, fails = 0;
    const local: string[] = [];
    for (const y of samples) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + 0.0137;
        const ray = new THREE.Ray(new THREE.Vector3(xS, y, 0), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
        // 往里（-x）的射线会碰到躯干：长度只到胳膊外面一点
        const hits = crossings(armGeos, ray, 0.15 * s);
        rays++;
        if (hits.length !== 1) { fails++; if (local.length < 3) local.push(`arm y${((y - yS) / s).toFixed(2)}s a${k} ×${hits.length}`); }
      }
    }
    // 躯干：从中轴水平往外（胸、腰），只算 torso + skin（不含贴面、领子）；避开两侧胳膊
    const tGeos = [pieces.torso, pieces.skin].filter((g): g is THREE.BufferGeometry => !!g);
    const W = ctx.seams.WAIST.centre[1];
    for (const y of [W + 0.06 * s, W + 0.16 * s, W + 0.28 * s, yS - 0.13 * s]) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2 + 0.0137;
        if (Math.abs(Math.cos(a)) > 0.55) continue;
        const ray = new THREE.Ray(new THREE.Vector3(0, y, 0), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
        const hits = crossings(tGeos, ray, 0.3 * s);
        rays++;
        if (hits.length !== 1) { fails++; if (local.length < 5) local.push(`torso y${((y - W) / s).toFixed(2)}s a${k} ×${hits.length}`); }
      }
    }
    if (fails) bad.push(`${n} ${fails}/${rays}: ${local.join(', ')}`);
    disposePieces(pieces);
  }
  r.t('胳膊、躯干：从骨轴往外的射线只穿过一层（没有藏在里面的几何）', bad.length === 0, bad.join('；'));
  // 袖子法线朝外（同 wp2：zhou 的 'sleeves'，绕各自的肩轴量水平分量）
  const zc = UPPER_CAST.zhou!;
  const zh = createHumanoidInternal(zc.spec, zc.face, zc.style);
  const xS = Math.abs(zh.joints.shoulderR.position.x);
  const sl = zh.parts.sleeves!;
  const pos = sl.geometry.attributes.position as THREE.BufferAttribute, nor = sl.geometry.attributes.normal as THREE.BufferAttribute;
  let tot = 0, good = 0;
  for (let i = 0; i < pos.count; i++) {
    const rx = pos.getX(i) - Math.sign(pos.getX(i)) * xS, rz = pos.getZ(i);
    if (Math.hypot(rx, rz) < 1e-3) continue;
    tot++;
    if (rx * nor.getX(i) + rz * nor.getZ(i) > 0) good++;
  }
  r.t('zhou 袖子法线朝外 > 95%（wp2.characters 同款）', good / tot > 0.95, (good / tot).toFixed(3));
  zh.dispose();
  return r.done();
});

registerSelftest('char2.upper_pose', () => {
  const r = report();
  const R_ARM = new Set([boneIndex('shoulderR'), boneIndex('elbowR'), boneIndex('wristR')]);
  for (const n of ['zhou', 'lu', 'worker', 'wang']) {
    const c = UPPER_CAST[n]!;
    const ctx = ctxOf(c);
    const h = createHumanoidInternal(c.spec, c.face, c.style);
    const d = upperDims(c.spec, ctx.profile, ctx.s, ctx.layout, ctx.seams, ctx.garment);
    const s = ctx.s;
    h.setPose('stand', 0);
    h.update(0, 0);
    h.joints.shoulderR.rotation.set(2.62, 0, 0.12);
    h.joints.elbowR.rotation.set(0.3, 0, 0);
    h.root.updateMatrixWorld(true);
    const spineInv = new THREE.Matrix4().copy(h.joints.spine.matrixWorld).invert();
    const sb = ctx.layout.bind.spine;
    let worst = 0, cnt = 0;
    const v = new THREE.Vector3();
    for (const name of ['sleeves', 'skin']) {
      const m = h.parts[name] as THREE.SkinnedMesh | undefined;
      if (!m) continue;
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      const si = m.geometry.attributes.skinIndex as THREE.BufferAttribute, sw = m.geometry.attributes.skinWeight as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let main = si.getX(i), mw = sw.getX(i);
        for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > mw) { mw = sw.getComponent(i, k); main = si.getComponent(i, k); }
        if (!R_ARM.has(main)) continue;
        m.getVertexPosition(i, v).applyMatrix4(h.root.matrixWorld).applyMatrix4(spineInv);
        const p = v.add(new THREE.Vector3(sb[0], sb[1], sb[2]));
        const hh = (p.y - d.yW) / (d.ySt - d.yW);
        if (hh < 0.05 || hh > 0.9) continue;
        const sec = section(d, ctx.profile, hh);
        const e = 2 / sec.n;
        const rad = Math.pow(Math.pow(Math.abs(p.x) / sec.a, 2 / e) + Math.pow(Math.abs(p.z - sec.zc) / (p.z - sec.zc < 0 ? sec.bf : sec.bb), 2 / e), e / 2);
        if (rad < 1) {
          const depth = (1 - rad) * Math.min(sec.a, sec.bf);
          worst = Math.max(worst, depth);
          if (depth > 0.005 * s) cnt++;
        }
      }
    }
    r.t(`${n} 举右臂（shoulderR.x 2.62）：胳膊不插进躯干 > 5mm`, cnt === 0, `最深 ${(worst * 1000).toFixed(1)}mm，超过的点 ${cnt}`);
    // 弯肘 2.0：肘背（肘关节那一圈 ±1.2cm、背面）的点到肘关节的距离 ≥ 60% 原半径
    h.setPose('stand', 0);
    h.update(0, 0);
    h.joints.shoulderR.rotation.set(0, 0, 0);
    h.joints.elbowR.rotation.set(2.0, 0, 0);
    h.root.updateMatrixWorld(true);
    const eW = h.joints.elbowR.getWorldPosition(new THREE.Vector3());
    const eb = ctx.layout.bind.elbowR;
    let minK = Infinity;
    for (const name of ['sleeves', 'skin']) {
      const m = h.parts[name] as THREE.SkinnedMesh | undefined;
      if (!m) continue;
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (x < 0 || Math.abs(y - eb[1]) > 0.012 * s || z < 0.01 * s) continue;
        const r0 = Math.hypot(x - eb[0], z - eb[2]);
        if (r0 < 0.02 * s || r0 > 0.08 * s) continue;
        m.getVertexPosition(i, v).applyMatrix4(h.root.matrixWorld);
        minK = Math.min(minK, v.distanceTo(eW) / r0);
      }
    }
    r.t(`${n} 弯肘 2.0：肘背不塌（到肘关节距离 ≥ 60% 原半径）`, minK >= 0.6, `最小 ${(minK * 100).toFixed(0)}%`);
    h.dispose();
  }
  return r.done();
});

registerSelftest('char2.upper_hand', () => {
  const r = report();
  for (const n of ['zhou', 'wang', 'kid', 'bride', 'worker']) {
    const c = UPPER_CAST[n]!;
    const ctx = ctxOf(c);
    const pieces = piecesOf(ctx);
    const info = upperInfo(c.spec)!;
    const s = ctx.s;
    const lay = ctx.layout;
    const wr = new THREE.Vector3(...lay.bind.wristR);
    const handLen = ctx.land.arm.handLen;
    const hk = handLen / (0.185 * s);
    // 手长：腕 → 中指尖（手指自然弯着，直线距离比沿手指量短 ~1cm）
    const len = wr.distanceTo(info.tipMiddle);
    r.t(`${n} 手长：腕到中指尖 ${(len * 1000).toFixed(0)}mm（0.185s 弯指后 ${(handLen * 0.95 * 1000).toFixed(0)}±8mm）`, Math.abs(len - handLen * 0.95) < 0.008 * s);
    // 掌心：皮肤几何里 腕下 3–8cm、x > 0 的点的中心
    const g = pieces.skin!;
    const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute;
    const cen = new THREE.Vector3(), pn = new THREE.Vector3();
    let k = 0, kn = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), x = pos.getX(i);
      if (x < lay.bind.shoulderR[0] - 0.06 * s || y > wr.y - 0.03 * s * hk || y < wr.y - 0.085 * s * hk) continue;
      cen.add(new THREE.Vector3(x, y, pos.getZ(i)));
      k++;
      if (x < wr.x - 0.009 * s * hk && Math.abs(pos.getZ(i) - wr.z) < 0.03 * s * hk) { pn.add(new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i))); kn++; }
    }
    cen.multiplyScalar(1 / Math.max(1, k));
    const elbowLocal = cen.y - lay.bind.elbowR[1];
    const wantY = ctx.land.arm.palmCentreY;
    r.t(`${n} 掌心在肘下 ${(-wantY / s).toFixed(3)}s ±1cm`, Math.abs(elbowLocal - wantY) < 0.01, `${(elbowLocal / s).toFixed(3)}s`);
    pn.normalize();
    r.t(`${n} 手心朝大腿（手心法线 · -x > 0.7）`, kn > 0 && pn.x < -0.7, `(${pn.x.toFixed(2)}, ${pn.y.toFixed(2)}, ${pn.z.toFixed(2)})`);
    disposePieces(pieces);
  }
  return r.done();
});

registerSelftest('char2.upper_landmarks', () => {
  const r = report();
  for (const n of ['zhou', 'jianguo', 'lu', 'worker', 'apprentice']) {
    const c = UPPER_CAST[n]!;
    const ctx = ctxOf(c);
    const pieces = piecesOf(ctx);
    const s = ctx.s;
    const b = ctx.layout.bind;
    const ac = ctx.land.torso.anchorChest;
    const p = new THREE.Vector3(ac[0] + b.spine[0], ac[1] + b.spine[1], ac[2] + b.spine[2]);
    const hits = crossings([pieces.torso!], new THREE.Ray(new THREE.Vector3(p.x, p.y, -1), new THREE.Vector3(0, 0, 1)), 2);
    const z = hits.length ? hits[0]! - 1 : NaN;
    r.t(`${n} anchorChest 在胸前衣服表面 ±1cm`, Math.abs(z - p.z) < 0.01, `表面 z ${z.toFixed(3)}，锚点 ${p.z.toFixed(3)}`);
    // 肩下 0.10s 的袖子外侧半径
    const y = b.shoulderR[1] + ctx.land.torso.sleeveProbeY;
    const sh = crossings([pieces.sleeves!, pieces.torso!], new THREE.Ray(new THREE.Vector3(b.shoulderR[0] + 0.3, y, 0), new THREE.Vector3(-1, 0, 0)), 1);
    const rad = sh.length ? 0.3 - sh[0]! : NaN;
    const short = c.spec.sleeves === 'short';
    const want = short ? ctx.land.torso.sleeveRShort : ctx.land.torso.sleeveRLong;
    r.t(`${n} 肩下 0.10s 袖子外侧半径 ${short ? '0.062' : '0.058'}s ±3mm`, Math.abs(rad - want) <= 0.003 * s + 1e-4, `${(rad * 1000).toFixed(1)}mm / ${(want * 1000).toFixed(1)}mm`);
    // 背后线缆平面：spine 局部 0.10s–0.40s 背面 z ≤ 0.122s
    const tp = pieces.torso!.attributes.position as THREE.BufferAttribute;
    let maxZ = -1;
    const [y0, y1] = ctx.land.torso.backPlaneY;
    for (let i = 0; i < tp.count; i++) {
      const yl = tp.getY(i) - b.spine[1];
      if (yl >= y0 && yl <= y1) maxZ = Math.max(maxZ, tp.getZ(i));
    }
    r.t(`${n} 背后 z ≤ ${(ctx.land.torso.backPlaneZ / s).toFixed(3)}s（线缆平面）`, maxZ <= ctx.land.torso.backPlaneZ + 1e-6, `${(maxZ / s).toFixed(3)}s`);
    disposePieces(pieces);
  }
  return r.done();
});

// ================================================================ char2.upper_spawn（截图工具）

interface UpperSpawn { op?: 'spawn' | 'clear'; name?: string; pos?: [number, number, number]; yaw?: number; pose?: Pose; steps?: number; speed?: number; look?: 'standard' | 'ghost' | 'replay' | 'silhouette' }
const G = globalThis as { __upperSpawn?: UpperSpawn; __char2spawned?: { root: THREE.Object3D; dispose(): void }[] };
const mine: HumanoidInternal[] = [];

registerSelftest('char2.upper_spawn', (game: Game) => {
  const r = report();
  const cfg = G.__upperSpawn ?? {};
  const area = game.areas.current;
  for (const h of mine.splice(0)) h.dispose();
  G.__char2spawned = [];
  if (cfg.op !== 'clear' && cfg.name && area) {
    const c = UPPER_CAST[cfg.name];
    if (!c) return { ok: false, notes: [`no cast ${cfg.name}`] };
    const h = createHumanoidInternal(c.spec, c.face, c.style);
    h.setPose(cfg.pose ?? 'stand', 0);
    for (let i = 0; i < 3; i++) h.update(0.016, 0);
    for (let i = 0; i < (cfg.steps ?? 0); i++) h.update(1 / 30, cfg.speed ?? 0);
    if (cfg.look && cfg.look !== 'standard') h.setMaterialMode(cfg.look);
    const p = cfg.pos ?? [0, 0, 0];
    h.root.position.set(p[0], p[1], p[2]);
    h.root.rotation.y = ((cfg.yaw ?? 0) * Math.PI) / 180;
    h.root.userData.char2spawn = true;
    area.root.add(h.root);
    h.root.updateMatrixWorld(true);
    mine.push(h);
    G.__char2spawned = [{ root: h.root, dispose: () => h.dispose() }];
  }
  r.t(`upper_spawn ${cfg.name ?? 'clear'}`, true);
  return r.done();
});
