// owner: WP2
// char2 WP-L：裤子、腿、鞋、长袍（char2.lower_*） 的开发沙盒自测。只有这个 WP 改这个文件（PLAN §5.7）。
// 全部是 CPU 几何检查（绑定几何 + applyBoneTransform 蒙皮后的位置），不需要 WebGL，Node 里也能跑：
//   char2.lower_seams      WAIST 对缝（裤子/皮带/长袍/裙，各体型）、网格名与 draw call（≤ 3）、三角形预算、法线是单位向量
//   char2.lower_shell      没有骨盆块/大腿球头：从腿骨轴往外的射线只穿过裤子一次；长袍里没有腿（从 hips 往下的射线只碰到长袍）
//   char2.lower_feet       站姿鞋底贴地 [0, 5mm]、鞋长 land.leg.shoeLen（0.265s，女 0.235s）±1cm
//   char2.lower_sit        坐姿：膝前半径 ≥ 静止的 70%、座面（坐姿大腿下最低点）= land.leg.seatY ±1.5cm、走路时裆不裂
//   char2.lower_robe       长袍/裙法线朝外 > 95%；坐姿时大腿被下摆盖住（上、外侧、外上、内上、膝头往前）；下摆不入地；站回原形

import * as THREE from 'three';
import type { AreaPart } from '../../core/area';
import type { SelftestResult } from '../../debug/selftest';
import { registerSelftest } from '../../debug/selftest';
import { createCharacter, type CharacterKind, type CharacterRig } from '../../rigs/characters';
import { createHumanoidInternal } from '../../rigs/human/assemble';
import { SEAMS } from '../../rigs/human/profile';
import { checkRingMatch } from '../../rigs/human/shared';
import type { FaceOpts, HumanoidSpec, HumanoidStyle } from '../../rigs/human/types';

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
const f3 = (n: number) => n.toFixed(3);

/** 测试用的几种下身（直接建 HumanoidInternal，款式写明）。 */
function cases(): [string, HumanoidSpec, FaceOpts | undefined, HumanoidStyle | undefined][] {
  const F = (age: FaceOpts['age'], female = false): FaceOpts => ({ skin: '#c99a78', hair: '#222', hairStyle: 'crop', age, female });
  const S = (height: number, extra: Partial<HumanoidSpec> = {}): HumanoidSpec => ({ height, shirt: '#5a6c8a', pants: '#303236', head: 'human', ...extra });
  return [
    ['adult', S(1.75), F('young'), { garment: { bottom: 'trousers', shoes: 'leather', tucked: true } }],
    ['oldHunch', S(1.75, { build: 'hunch' }), F('old'), { garment: { bottom: 'work_trousers', shoes: 'cloth', tucked: true } }],
    ['untucked', S(1.82, { build: 'slim' }), F('old'), { garment: { top: 'zhongshan', bottom: 'trousers', shoes: 'leather', tucked: false, hemDrop: 0.16 } }],
    ['woman', S(1.5, { build: 'hunch' }), F('old', true), { garment: { bottom: 'trousers', shoes: 'cloth', tucked: false, hemDrop: 0.1 } }],
    ['stout', S(1.76, { build: 'stout' }), F('young'), { garment: { bottom: 'work_trousers', shoes: 'boot', tucked: true } }],
    ['turnup', S(1.7, { build: 'slim' }), F('young'), { garment: { bottom: 'trousers', shoes: 'sneaker', tucked: true, cuffs: 'turnup' } }],
    ['child', S(1.2), F('child'), { garment: { bottom: 'trousers', shoes: 'sneaker' } }],
    ['deityRobe', S(1.2, { build: 'stout', robe: true, sleeves: 'long' }), F('old'), { profile: { deity: true }, garment: { bottom: 'robe', shoes: 'cloth' } }],
    ['qipao', S(1.6, { build: 'slim', robe: true, sleeves: 'long' }), F('young', true), { garment: { bottom: 'qipao_skirt', shoes: 'embroidered' } }],
  ];
}

const LOWER = ['pants', 'shoes', 'belt', 'robe'];
function lowerMeshes(h: { root: THREE.Object3D }): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = [];
  h.root.traverse(o => { if (LOWER.includes(o.name) && (o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh); });
  return out;
}
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position!.count) / 3;

/** 蒙皮后的世界坐标（全部顶点）。 */
function skinned(mesh: THREE.SkinnedMesh): Float32Array {
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const out = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
  }
  return out;
}

/** 射线与三角形网格的全部交点距离（Möller–Trumbore；pos = 顶点坐标数组）；同一点穿过共边的两个三角形算一次。 */
function rayHits(pos: ArrayLike<number>, index: ArrayLike<number>, o: THREE.Vector3, d: THREE.Vector3, maxT = 10): number[] {
  const hits: number[] = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), pv = new THREE.Vector3(), tv = new THREE.Vector3(), qv = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let k = 0; k < index.length; k += 3) {
    const ia = index[k]! * 3, ib = index[k + 1]! * 3, ic = index[k + 2]! * 3;
    a.set(pos[ia]!, pos[ia + 1]!, pos[ia + 2]!);
    b.set(pos[ib]!, pos[ib + 1]!, pos[ib + 2]!);
    c.set(pos[ic]!, pos[ic + 1]!, pos[ic + 2]!);
    e1.subVectors(b, a); e2.subVectors(c, a);
    pv.crossVectors(d, e2);
    const det = e1.dot(pv);
    if (Math.abs(det) < 1e-14) continue;
    const inv = 1 / det;
    tv.subVectors(o, a);
    const u = tv.dot(pv) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    qv.crossVectors(tv, e1);
    const v = d.dot(qv) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const t = e2.dot(qv) * inv;
    if (t > 1e-6 && t < maxT) hits.push(t);
  }
  hits.sort((x, y) => x - y);
  return hits.filter((t, i) => i === 0 || t - hits[i - 1]! > 1e-4);
}
const idxOf = (g: THREE.BufferGeometry): ArrayLike<number> => (g.index ? g.index.array : Array.from({ length: g.attributes.position!.count }, (_, i) => i));

// ================================================================ char2.lower_seams

registerSelftest('char2.lower_seams', () => {
  const r = report();
  const bad: string[] = [], budget: string[] = [];
  for (const [tag, spec, face, style] of cases()) {
    const h = createHumanoidInternal(spec, face, style);
    const meshes = lowerMeshes(h);
    const names = meshes.map(m => m.name).sort();
    const g = style?.garment ?? {};
    const belted = !spec.robe && g.tucked === true && (g.hemDrop ?? 0) <= 0 && h.profile.age !== 'child';
    const seamName = spec.robe ? (g.bottom === 'robe' ? 'belt' : 'robe') : belted ? 'belt' : 'pants';
    const seamMesh = meshes.find(m => m.name === seamName);
    if (!seamMesh) bad.push(`${tag}: no ${seamName} in ${names.join(',')}`);
    else {
      const m = checkRingMatch(seamMesh.geometry, SEAMS(h.profile, h.s).WAIST);
      if (!m.ok) bad.push(`${tag} ${seamMesh.name}: ${m.notes}`);
    }
    const want = (spec.robe ? ['robe', 'shoes', ...(g.bottom === 'robe' ? ['belt'] : [])] : ['pants', 'shoes', ...(belted ? ['belt'] : [])]).sort();
    if (names.join(',') !== want.join(',')) bad.push(`${tag}: meshes ${names.join(',')} ≠ ${want.join(',')}`);
    let t = 0, nan = 0;
    for (const m of meshes) {
      t += tris(m.geometry);
      const n = m.geometry.attributes.normal as THREE.BufferAttribute, p = m.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < n.count; i++) {
        const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
        if (!(Math.abs(l - 1) < 0.02) || !Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))) nan++;
      }
    }
    if (nan) bad.push(`${tag}: ${nan} bad normals/positions`);
    budget.push(`${tag} ${t}`);
    // 预算（PLAN §5.3）：下身 2.5–3.5k（长袍 ≤ 4k；土地的布腰带结与垂带另算 ≤ 0.6k）、≤ 3 个网格
    const lim = spec.robe ? 4000 + 600 : 3500;
    if (t > lim || meshes.length > 3) bad.push(`${tag}: ${t} tris / ${meshes.length} meshes over budget`);
    h.dispose();
  }
  r.t('WAIST 对缝（0.1mm、法线 0.999）、下身网格名、≤ 3 个网格、三角形预算、法线是单位向量', bad.length === 0, bad.slice(0, 6).join('；'));
  r.t('三角形', true, budget.join(' '));
  return r.done();
});

// ================================================================ char2.lower_shell

registerSelftest('char2.lower_shell', () => {
  const r = report();
  const bad: string[] = [];
  let rays = 0;
  for (const [tag, spec, face, style] of cases()) {
    const h = createHumanoidInternal(spec, face, style);
    h.root.updateMatrixWorld(true);
    const s = h.s;
    const pants = h.parts.pants as THREE.SkinnedMesh | undefined, robe = h.parts.robe as THREE.SkinnedMesh | undefined;
    const jp = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    if (pants) {
      const pos = pants.geometry.attributes.position!.array as ArrayLike<number>, idx = idxOf(pants.geometry);
      // 两条腿：从腿骨轴往外水平射 12 个方向，只穿过裤子一次（没有大腿球头、没有里面的腿）
      for (const side of ['L', 'R'] as const) {
        const hip = jp(h.joints[`hip${side}`]), knee = jp(h.joints[`knee${side}`]), ank = jp(h.extraJoints[`ankle${side}`]);
        for (const f of [0.45, 0.6, 0.75, 0.9, 1.05, 1.3, 1.6, 1.85]) {
          const o = f <= 1 ? hip.clone().lerp(knee, f) : knee.clone().lerp(ank, f - 1);
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2;
            const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
            // 朝另一条腿的方向会再穿过那条腿（2 次）：只数到两腿正中（x = 0）为止
            const toward = side === 'L' ? d.x > 0.2 : d.x < -0.2;
            const maxT = toward ? Math.abs(o.x / d.x) : 0.4 * s;
            const n = rayHits(pos, idx, o, d, maxT).length;
            rays++;
            if (n !== 1) bad.push(`${tag} leg${side} f${f} dir${k}: ${n} crossings`);
          }
        }
      }
      // 骨盆：从 hips 正中往外（水平）只穿过一次——没有闭合的骨盆块、没有里面的东西
      const hc = jp(h.joints.hips);
      const belt = h.parts.belt as THREE.SkinnedMesh | undefined;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        // 皮带那一段的外壳是皮带（裤子从皮带下沿开始）
        const n = rayHits(pos, idx, hc, d, 0.35 * s).length + (belt ? rayHits(belt.geometry.attributes.position!.array as ArrayLike<number>, idxOf(belt.geometry), hc, d, 0.35 * s).length : 0);
        rays++;
        // 正前方还会穿过带扣（皮带上的小凸板）
        const ok = n === 1 || (belt && d.z < -0.9 && n === 2);
        if (!ok) bad.push(`${tag} pelvis dir${k}: ${n}`);
      }
      // 从 hips 正下方往下：穿过裆一次（裆是封住的，里面没有骨盆底）
      const nDown = rayHits(pos, idx, hc, new THREE.Vector3(0, -1, 0.0001).normalize(), 0.5 * s).length;
      rays++;
      if (nDown !== 1) bad.push(`${tag} crotch down: ${nDown}`);
    }
    if (robe) {
      // 长袍里没有腿：从 hips 往下、往外的射线只碰长袍一次；别的下身网格不在袍子里
      const others = lowerMeshes(h).filter(m => m !== robe && m.name !== 'shoes');
      const pos = robe.geometry.attributes.position!.array as ArrayLike<number>, idx = idxOf(robe.geometry);
      const hc = jp(h.joints.hips);
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        for (const dy of [-0.3, -0.9, -1.6]) {
          const d = new THREE.Vector3(Math.cos(a), dy, Math.sin(a)).normalize();
          const n = rayHits(pos, idx, hc, d, 1.2 * s).filter(t => hc.y + d.y * t > 0.12 * s).length;
          rays++;
          if (n > 1) bad.push(`${tag} robe dir${k}/${dy}: ${n}`);
          for (const m of others) {
            const n2 = rayHits(m.geometry.attributes.position!.array as ArrayLike<number>, idxOf(m.geometry), hc, d, 1.2 * s).filter(t => hc.y + d.y * t < hc.y - 0.1 * s).length;
            if (n2) bad.push(`${tag} ${m.name} inside the robe (dir${k}/${dy})`);
          }
        }
      }
      if (h.parts.pants) bad.push(`${tag}: robe character has pants`);
    }
    h.dispose();
  }
  r.t(`裤子/长袍只有一层外壳（${rays} 条射线）`, bad.length === 0, bad.slice(0, 6).join('；'));
  return r.done();
});

// ================================================================ char2.lower_feet

registerSelftest('char2.lower_feet', () => {
  const r = report();
  const bad: string[] = [], info: string[] = [];
  for (const [tag, spec, face, style] of cases()) {
    const h = createHumanoidInternal(spec, face, style);
    h.root.updateMatrixWorld(true);
    const P = skinned(h.parts.shoes as THREE.SkinnedMesh);
    let minY = Infinity;
    for (let i = 1; i < P.length; i += 3) minY = Math.min(minY, P[i]!);
    // 右脚：沿脚的方向（−z 往 +x 转 6°）量长度
    const a = (6 * Math.PI) / 180;
    const dx = Math.sin(a), dz = -Math.cos(a);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < P.length; i += 3) {
      if (P[i]! <= 0) continue;
      const t = P[i]! * dx + P[i + 2]! * dz;
      lo = Math.min(lo, t); hi = Math.max(hi, t);
    }
    const len = hi - lo, want = h.land.leg.shoeLen;
    info.push(`${tag} minY ${(minY * 1000).toFixed(1)}mm len ${f3(len)}/${f3(want)}`);
    if (!(minY >= -1e-6 && minY <= 0.005)) bad.push(`${tag} sole minY ${minY.toFixed(4)}`);
    if (Math.abs(len - want) > 0.01) bad.push(`${tag} shoe length ${f3(len)} ≠ ${f3(want)}`);
    h.dispose();
  }
  r.t('站姿鞋底贴地 [0, 5mm]、鞋长 land.leg.shoeLen ±1cm', bad.length === 0, bad.join('；'));
  r.t('鞋', true, info.join(' | '));
  return r.done();
});

// ================================================================ char2.lower_sit

registerSelftest('char2.lower_sit', () => {
  const r = report();
  const bad: string[] = [], info: string[] = [];
  for (const [tag, spec, face, style] of cases()) {
    if (spec.robe) continue;
    const h = createHumanoidInternal(spec, face, style);
    const s = h.s;
    const pants = h.parts.pants as THREE.SkinnedMesh;
    const bind = pants.geometry.attributes.position as THREE.BufferAttribute;
    h.root.updateMatrixWorld(true);
    const kneeB = new THREE.Vector3().setFromMatrixPosition(h.joints.kneeR.matrixWorld);
    // 膝前：右腿前片中线附近（|x − 膝 x| < 2cm、膝关节上下 6cm、在膝前）的点到膝关节（铰链轴 = x）的距离；静止与坐下用同一组点
    const set: number[] = [];
    for (let i = 0; i < bind.count; i++) {
      const x = bind.getX(i), y = bind.getY(i), z = bind.getZ(i);
      if (x > 0 && Math.abs(x - kneeB.x) < 0.02 * s && Math.abs(y - kneeB.y) < 0.06 * s && z < kneeB.z - 0.03 * s) set.push(i);
    }
    let rest = Infinity;
    for (const i of set) rest = Math.min(rest, Math.hypot(bind.getY(i) - kneeB.y, bind.getZ(i) - kneeB.z));
    h.setPose('sit', 0);
    h.update(0.016, 0);
    h.root.updateMatrixWorld(true);
    const P = skinned(pants);
    const kw = new THREE.Vector3().setFromMatrixPosition(h.joints.kneeR.matrixWorld);
    let minD = Infinity;
    for (const i of set) minD = Math.min(minD, Math.hypot(P[i * 3 + 1]! - kw.y, P[i * 3 + 2]! - kw.z));
    // 座面：坐姿大腿下最低点（髋与膝之间）
    const hipW = new THREE.Vector3().setFromMatrixPosition(h.joints.hipR.matrixWorld);
    let seat = Infinity;
    for (let i = 0; i < bind.count; i++) {
      const z = P[i * 3 + 2]!;
      if (z < hipW.z - 0.05 * s && z > kw.z + 0.11 * s) seat = Math.min(seat, P[i * 3 + 1]!);
    }
    // 相对髋关节（不受动作的 bodyDrop 影响）：land 的约定 = 髋关节高 − 0.101s（儿童 ×0.8）
    const rel = seat - hipW.y;
    const relWant = -0.101 * s * (h.profile.age === 'child' ? 0.8 : 1);
    info.push(`${tag} knee ${f3(minD / rest)} seat ${f3(seat)} (rel ${f3(rel)}/${f3(relWant)}; land ${f3(h.land.leg.seatY)})`);
    if (!(minD >= 0.7 * rest)) bad.push(`${tag} knee front ${f3(minD)} < 0.7 × ${f3(rest)}`);
    if (Math.abs(rel - relWant) > 0.015) bad.push(`${tag} seat rel ${f3(rel)} vs ${f3(relWant)}`);
    if (h.profile.age !== 'child' && Math.abs(seat - h.land.leg.seatY) > 0.015) bad.push(`${tag} seat ${f3(seat)} vs land ${f3(h.land.leg.seatY)}`);
    // 走路：重合的点（裆弧、分裆圈）两边同一权重 → 摆腿时不裂
    h.setPose('stand', 0);
    for (let k = 0; k < 12; k++) h.update(1 / 30, 1.3);
    h.root.updateMatrixWorld(true);
    const Q = skinned(pants);
    const byKey = new Map<string, number[]>();
    for (let i = 0; i < bind.count; i++) {
      const key = `${bind.getX(i).toFixed(5)},${bind.getY(i).toFixed(5)},${bind.getZ(i).toFixed(5)}`;
      const l = byKey.get(key);
      if (l) l.push(i); else byKey.set(key, [i]);
    }
    let gap = 0;
    for (const l of byKey.values()) {
      for (let k = 1; k < l.length; k++) gap = Math.max(gap, Math.hypot(Q[l[0]! * 3]! - Q[l[k]! * 3]!, Q[l[0]! * 3 + 1]! - Q[l[k]! * 3 + 1]!, Q[l[0]! * 3 + 2]! - Q[l[k]! * 3 + 2]!));
    }
    if (gap > 1e-5) bad.push(`${tag} walking opens a seam (${(gap * 1000).toFixed(2)}mm)`);
    h.dispose();
  }
  r.t('坐姿膝前 ≥ 70%、座面 ±1.5cm、走路时裆/分裆圈不裂', bad.length === 0, bad.join('；'));
  r.t('坐姿', true, info.join(' | '));
  return r.done();
});

// ================================================================ char2.lower_robe

registerSelftest('char2.lower_robe', () => {
  const r = report();
  const bad: string[] = [], info: string[] = [];
  const kinds: CharacterKind[] = ['tudi', 'bride'];
  for (const kind of kinds) {
    const c: CharacterRig = createCharacter(kind, {});
    c.root.updateMatrixWorld(true);
    let found: THREE.SkinnedMesh | null = null;
    c.root.traverse(o => { if (!found && o.name === 'robe' && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh; });
    if (!found) { bad.push(`${kind}: no robe`); c.dispose(); continue; }
    const rb: THREE.SkinnedMesh = found;
    const g = rb.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute;
    const rest = Float32Array.from(pos.array as Float32Array);
    let n = 0, good = 0;
    for (let i = 0; i < pos.count; i++) {
      const rx = pos.getX(i), rz = pos.getZ(i);
      if (Math.hypot(rx, rz) < 1e-3) continue;
      n++;
      if (rx * nor.getX(i) + rz * nor.getZ(i) > 0) good++;
    }
    const out = good / n;
    if (out <= 0.95) bad.push(`${kind} robe outward ${out.toFixed(3)}`);
    c.setPose('sit', 0);
    c.update(0.016, 0);
    c.root.updateMatrixWorld(true);
    const P = skinned(rb), idx = idxOf(g);
    // fix1：土地的酒桶肚（布腰带、袍子上身）在坐下时盖住大腿根：这几层也算“盖住”（只要大腿不从衣服外面露出来）
    const covers: [Float32Array, ArrayLike<number>][] = [[P, idx]];
    c.root.traverse(o => {
      if ((o.name === 'belt' || o.name === 'torso') && (o as THREE.SkinnedMesh).isSkinnedMesh && o.visible) covers.push([skinned(o as THREE.SkinnedMesh), idxOf((o as THREE.Mesh).geometry)]);
    });
    const s = c.height / 1.75;
    let covered = 0, total = 0;
    const miss: string[] = [];
    for (const side of ['L', 'R'] as const) {
      const hip = new THREE.Vector3().setFromMatrixPosition(c.joints[`hip${side}`].matrixWorld);
      const knee = new THREE.Vector3().setFromMatrixPosition(c.joints[`knee${side}`].matrixWorld);
      const axis = knee.clone().sub(hip).normalize();
      const sg = side === 'R' ? 1 : -1;
      const rt = 0.07 * s;
      // 大腿根（f < 0.5）在肚子/上衣底下，不归下摆管
      for (const f of [0.5, 0.7, 0.85, 1.0]) {
        const o = hip.clone().lerp(knee, f);
        const dirs = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(sg, 0, 0), new THREE.Vector3(sg, 1, 0).normalize(), new THREE.Vector3(-sg * 0.4, 1, 0).normalize()];
        if (f === 1) dirs.push(axis.clone());
        for (const d of dirs) {
          total++;
          if (covers.some(([PP, ii]) => rayHits(PP, ii, o.clone().addScaledVector(d, rt), d, 0.5).length >= 1)) covered++;
          else miss.push(`${side}${f}/${d.toArray().map(v => v.toFixed(1)).join(',')}`);
        }
      }
    }
    let minY = Infinity;
    for (let i = 1; i < P.length; i += 3) minY = Math.min(minY, P[i]!);
    info.push(`${kind} outward ${out.toFixed(3)} thigh covered ${covered}/${total} seated hem minY ${f3(minY)}`);
    if (covered < total) bad.push(`${kind} thigh pokes out: ${miss.join(' ')}`);
    if (minY < 0.005) bad.push(`${kind} seated hem below floor ${f3(minY)}`);
    c.setPose('stand', 0);
    c.update(0.016, 0);
    let dmax = 0;
    const now = pos.array as Float32Array;
    for (let i = 0; i < rest.length; i++) dmax = Math.max(dmax, Math.abs(now[i]! - rest[i]!));
    if (dmax > 1e-6) bad.push(`${kind} stand after sit differs ${dmax}`);
    c.dispose();
  }
  r.t('长袍/裙：法线朝外 > 95%、坐姿大腿被盖住、下摆不入地、站回原形', bad.length === 0, bad.join('；'));
  r.t('长袍', true, info.join(' | '));
  return r.done();
});
