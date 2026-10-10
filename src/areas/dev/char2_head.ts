// owner: WP2
// char2 WP-H：头、脸、头发、黄鼬头的开发沙盒自测（scripts/selftest/char2.mjs 自动跑全部 'char2.*'）：
//   char2.head_landmarks  头网格：一个名为 head 的网格挂在 headSlot 下、底圈 = NECK_TOP（checkRingMatch）、
//                         地标 ±3mm（鼻尖 = 最前的点、头顶 = 最高、耳 = |x| 最大、下巴 = 前脸最低）
//   char2.head_nose       鼻尖不是球：水平曲率半径 ≥ 8mm、鼻尖与相邻点法线夹角 ≤ 70°
//   char2.head_shell      头发就是外壳：从头心往外约 450 个方向，每条射线只穿过头网格一次（耳朵、发髻方向另计）
//   char2.head_tris       三角形 3.0–4.5k（§4 全部头），黄鼬头 ≤ 4k、有胡须、底圈 = NECK_TOP
//   char2.head_canvas     贴图 ≤ 512×384、按参数缓存、女人/小孩下巴不整片发暗（< 3%）、王奶奶的头发（发髻）灰、年轻王/新娘黑
//   char2.head_patch      headShell 贴片贴着脸（含鼻子）、在表面外 1–12mm
// 工具：char2.head_gallery（按 globalThis.__headGallery 摆一排 §4 的头，截图脚本用）。

import * as THREE from 'three';
import type { AreaPart } from '../../core/area';
import type { Game } from '../../core/game';
import type { SelftestResult } from '../../debug/selftest';
import { registerSelftest } from '../../debug/selftest';
import { createHumanoidInternal } from '../../rigs/human/assemble';
import { type HeadShellOpts, faceTexture, headShell } from '../../rigs/human/head';
import { HEAD_C, HEAD_ORIGIN, alphaOf, psiOf, uvOfPoint } from '../../rigs/human/head/mapping';
import { SEAMS, jointLayout } from '../../rigs/human/profile';
import { checkRingMatch } from '../../rigs/human/shared';
import type { FaceOpts, HumanoidInternal, HumanoidSpec, HumanoidStyle } from '../../rigs/human/types';

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

const SPEC = (h: number, o?: Partial<HumanoidSpec>): HumanoidSpec => ({ height: h, shirt: '#56606e', pants: '#3a3d44', head: 'human', ...o });

/** PLAN §4 的头部参数（WP-C 写进 characters.ts；这里拿来做自测与截图）。 */
export const HEAD_LOOKS: Readonly<Record<string, { h: number; face: FaceOpts; style?: HumanoidStyle; spec?: Partial<HumanoidSpec> }>> = {
  zhou: { h: 1.75, spec: { build: 'hunch' }, face: { skin: '#A07E66', hair: '#4A4642', hairStyle: 'crop', age: 'old', seed: 1960, head: 'oldMan', sculpt: { jawW: 0.5, noseW: 0.4, cheekFull: -0.3, browRidge: 0.4 }, paint: { eyeShape: 'droop', brow: 'bushy', wrinkles: 0.7, stubble: 0.25 } } },
  lu: { h: 1.82, spec: { build: 'slim' }, face: { skin: '#C49A7E', hair: '#6E6C68', hairStyle: 'side_part', age: 'old', seed: 11, head: 'oldMan', sculpt: { faceLen: 0.6, jawW: -0.4, cheekbone: 0.5, noseBridge: 0.5, lipFull: -0.4 }, paint: { eyeShape: 'single', brow: 'thin', wrinkles: 0.6 } } },
  wang: { h: 1.5, spec: { build: 'hunch' }, face: { skin: '#C9A080', hair: '#8D8A86', hairStyle: 'bun', age: 'old', female: true, seed: 7, head: 'oldWoman', sculpt: { cheekFull: 0.4, chin: -0.3, lipFull: -0.5 }, paint: { eyeShape: 'droop', brow: 'thin', wrinkles: 0.8, spots: 0.3, blush: 0.15 } } },
  wang_young: { h: 1.58, face: { skin: '#D2AA88', hair: '#1c1816', hairStyle: 'bun', age: 'young', female: true, seed: 7, head: 'woman', sculpt: { cheekFull: 0.2 }, paint: { blush: 0.25 } } },
  tudi: { h: 1.2, spec: { build: 'stout' }, style: { profile: { deity: true } }, face: { skin: '#C49A7A', hair: '#E8E6E0', hairStyle: 'bald', age: 'old', brows: 1.2, seed: 5, head: 'deity', sculpt: { earlobe: 1, cheekFull: 0.8 }, paint: { eyeShape: 'droop', brow: 'white', wrinkles: 0.5 } } },
  jianguo: { h: 1.73, face: { skin: '#C4A080', hair: '#15120f', hairStyle: 'crop', age: 'young', seed: 1986, head: 'man', sculpt: { jawW: 0.2 } } },
  jianguo_child: { h: 1.15, face: { skin: '#D1A788', hair: '#15120f', hairStyle: 'child_bowl', age: 'child', seed: 1986, head: 'boy' } },
  girl: { h: 1.25, face: { skin: '#D6AE90', hair: '#141210', hairStyle: 'bun', age: 'child', female: true, seed: 4, head: 'girl' } },
  bride: { h: 1.6, face: { skin: '#D8B090', hair: '#120e0c', hairStyle: 'long', age: 'young', female: true, seed: 1990, head: 'woman', sculpt: { lipFull: 0.3 }, paint: { lips: '#B0302E', blush: 0.3, eyeShape: 'inner_fold', brow: 'arched' } } },
  apprentice: { h: 1.7, spec: { build: 'slim' }, face: { skin: '#C9A080', hair: '#15120f', hairStyle: 'side_part', age: 'young', seed: 17, head: 'man', sculpt: { eyeSize: 0.2, cheekFull: -0.3 } } },
  junkman: { h: 1.66, spec: { build: 'hunch' }, face: { skin: '#A88468', hair: '#6b665e', hairStyle: 'thin_old', age: 'old', seed: 23, head: 'oldMan', sculpt: { chin: -0.2 }, paint: { stubble: 0.5, wrinkles: 0.8 } } },
  worker: { h: 1.76, spec: { build: 'stout' }, face: { skin: '#B08A6A', hair: '#15120f', hairStyle: 'crop', age: 'young', seed: 28, head: 'man', sculpt: { jawW: 0.5 }, paint: { stubble: 0.4 } } },
  huang: { h: 1.4, spec: { build: 'slim' }, face: { skin: '#B08A68', hair: '#3a3026', hairStyle: 'thin_old', age: 'old', seed: 1970, head: 'oldMan', sculpt: { chin: 0.6, cheekbone: 0.4, earSize: 0.3 }, paint: { eyeShape: 'single', wrinkles: 0.6, ...({ smile: 0.6 } as object) } } },
  flat: { h: 1.75, face: { skin: '#C49A7E', hair: '#15120f', hairStyle: 'flat_top', age: 'young', seed: 3, head: 'man' } },
};

function makeHead(key: string, mode?: 'ghost' | 'replay' | 'silhouette'): HumanoidInternal {
  const L = HEAD_LOOKS[key]!;
  const h = createHumanoidInternal(SPEC(L.h, { skin: L.face.skin, ...(L.spec ?? {}) }), L.face, L.style);
  if (mode) h.setMaterialMode(mode);
  return h;
}

function headMeshOf(h: HumanoidInternal): THREE.Mesh {
  const m = h.root.getObjectByName('head') as THREE.Mesh | undefined;
  if (!m) throw new Error('no head mesh');
  return m;
}

/** 头网格局部 → 绑定姿势下的人偶根空间的偏移（headSlot 的绑定位置 + 头网格位置），与人偶的 NECK_TOP。 */
function seamOf(h: HumanoidInternal, head: THREE.Mesh): { ring: ReturnType<typeof SEAMS>['NECK_TOP']; origin: [number, number, number] } {
  const lay = jointLayout(h.profile, h.s);
  const ring = SEAMS(h.profile, h.s, lay).NECK_TOP;
  const hb = lay.bind.headSlot;
  return { ring, origin: [hb[0] + head.position.x, hb[1] + head.position.y, hb[2] + head.position.z] };
}

const mm = (a: number) => (a * 1000).toFixed(1);

// ---------------------------------------------------------------- 地标、接缝

registerSelftest('char2.head_landmarks', () => {
  const r = report();
  for (const key of ['jianguo', 'worker', 'zhou', 'lu', 'wang', 'bride', 'tudi', 'jianguo_child', 'flat']) {
    const h = makeHead(key);
    const head = headMeshOf(h);
    const parents: string[] = [];
    h.root.traverse(o => { if (o.name === 'head') parents.push(o.parent?.name ?? '?'); });
    r.t(`${key}：只有一个 head、挂在 headSlot 下`, parents.length === 1 && parents[0] === 'headSlot', parents.join(','));
    const k = h.land.head.scale;
    const { ring, origin } = seamOf(h, head);
    const sm = checkRingMatch(head.geometry, ring, { origin });
    r.t(`${key}：底圈 = NECK_TOP`, sm.ok, sm.notes);
    const pos = head.geometry.attributes.position as THREE.BufferAttribute;
    const L = h.land.head;
    const tip = new THREE.Vector3(0, 0, 1);
    let crown = -1, earX = 0, chinY = 1;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).add(head.position);
      if (v.z < tip.z) tip.copy(v);
      crown = Math.max(crown, v.y);
      earX = Math.max(earX, Math.abs(v.x));
      if (v.z < -0.06 * k && Math.abs(v.x) < 0.02 * k) chinY = Math.min(chinY, v.y);
    }
    const adult = key === 'jianguo' || key === 'worker';
    const tol = 0.003 * k;
    if (adult) {
      r.t(`${key}：鼻尖 (${mm(tip.y)}, ${mm(tip.z)})（地标 ${mm(L.noseTip[1])}, ${mm(L.noseTip[2])}）`, Math.abs(tip.z - L.noseTip[2]) <= tol && Math.abs(tip.y - L.noseTip[1]) <= tol);
      r.t(`${key}：耳 |x| ${mm(earX)}（地标 ${mm(L.earR[0])}）`, Math.abs(earX - L.earR[0]) <= tol);
      r.t(`${key}：下巴 y ${mm(chinY)}（地标 ${mm(L.chin[1])}）`, Math.abs(chinY - L.chin[1]) <= tol);
      r.t(`${key}：头顶 y ${mm(crown)}（hairTop ${mm(L.hairTop)}）`, Math.abs(crown - L.hairTop) <= tol);
    } else {
      r.t(`${key}：鼻尖 (${mm(tip.y)}, ${mm(tip.z)})、耳 ${mm(earX)}、下巴 ${mm(chinY)}、头顶 ${mm(crown)}（hairTop ${mm(L.hairTop)}）`,
        Math.abs(crown - L.hairTop) <= 0.006 * k || key === 'wang' || key === 'bride');
    }
    h.dispose();
  }
  return r.done();
});

// ---------------------------------------------------------------- 鼻子

registerSelftest('char2.head_nose', () => {
  const r = report();
  for (const key of ['jianguo', 'zhou', 'bride', 'tudi', 'jianguo_child']) {
    const h = makeHead(key);
    const geo = headMeshOf(h).geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute, nor = geo.attributes.normal as THREE.BufferAttribute;
    const start = geo.userData.headGridStart as number, cols = (geo.userData.headCols as number) + 1, rows = geo.userData.headRows as number;
    let tip = -1, best = 1;
    for (let i = start; i < start + rows * cols; i++) if (pos.getZ(i) < best) { best = pos.getZ(i); tip = i; }
    const li = tip - 1, ri = tip + 1;
    const dx = Math.abs(pos.getX(ri) - pos.getX(li)) / 2;
    const dz = (pos.getZ(li) + pos.getZ(ri)) / 2 - pos.getZ(tip);
    const R = dz > 1e-7 ? (dx * dx) / (2 * dz) : 1;
    r.t(`${key}：鼻尖水平曲率半径 ${mm(R)}mm ≥ 8mm`, R >= 0.008);
    const nt = new THREE.Vector3().fromBufferAttribute(nor, tip);
    let worst = 0;
    for (const j of [li, ri, tip - cols, tip + cols]) worst = Math.max(worst, (nt.angleTo(new THREE.Vector3().fromBufferAttribute(nor, j)) * 180) / Math.PI);
    r.t(`${key}：鼻尖与相邻点法线最大夹角 ${worst.toFixed(0)}° ≤ 70°`, worst <= 70);
    h.dispose();
  }
  return r.done();
});

// ---------------------------------------------------------------- 外壳：没有里层

registerSelftest('char2.head_shell', () => {
  const r = report();
  for (const key of ['jianguo', 'lu', 'zhou', 'wang', 'bride', 'jianguo_child', 'tudi', 'flat', 'huang']) {
    const h = makeHead(key);
    const head = headMeshOf(h);
    const k = h.land.head.scale;
    const probe = new THREE.Mesh(head.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    probe.updateMatrixWorld(true);
    const rc = new THREE.Raycaster();
    const o = new THREE.Vector3((HEAD_C[0] - HEAD_ORIGIN[0]) * k, (HEAD_C[1] - HEAD_ORIGIN[1]) * k, (HEAD_C[2] - HEAD_ORIGIN[2]) * k);
    let bad = 0, total = 0, extra = 0;
    const worst: string[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < 500; i++) {
      const y = 1 - (i / 499) * 2, rr = Math.sqrt(1 - y * y), th = golden * i;
      const d = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr);
      if (d.y < -0.6) continue; // 颈口
      rc.set(o, d);
      const ds: number[] = [];
      for (const hh of rc.intersectObject(probe, false)) if (!ds.some(x => Math.abs(x - hh.distance) < 3e-4)) ds.push(hh.distance);
      total++;
      // 0 次：射线正好擦过顶点/棱（数值上漏掉），不算
      if (ds.length <= 1) continue;
      const p = d.clone().multiplyScalar(ds[0] ?? 0).add(o).divideScalar(k).add(new THREE.Vector3(...HEAD_ORIGIN));
      const ap = (Math.abs(psiOf(p.x, p.z)) * 180) / Math.PI, al = (alphaOf(p.x, p.y, p.z) * 180) / Math.PI;
      const earDir = ap > 68 && ap < 114 && al > 52 && al < 124;
      // 发髻是长在头发外面的一团：从头心看，擦着它边缘的射线会多穿 2–3 次（穿出头发、进出发髻）
      const bunDir = (key === 'wang' || key === 'bride') && ap > 120;
      if (earDir || bunDir) { extra++; continue; }
      bad++;
      if (worst.length < 5) worst.push(`ψ${ap.toFixed(0)} α${al.toFixed(0)}×${ds.length}`);
    }
    r.t(`${key}：${total} 条射线里 ${bad} 条多穿（耳/发髻方向 ${extra}）`, bad === 0, worst.join(' '));
    (probe.material as THREE.Material).dispose();
    h.dispose();
  }
  return r.done();
});

// ---------------------------------------------------------------- 三角形、黄鼬

registerSelftest('char2.head_tris', () => {
  const r = report();
  for (const key of Object.keys(HEAD_LOOKS)) {
    const h = makeHead(key);
    const g = headMeshOf(h).geometry;
    const t = (g.index ? g.index.count : g.attributes.position!.count) / 3;
    r.t(`${key}：${t} 三角形`, t >= 3000 && t <= 4500);
    h.dispose();
  }
  const w = createHumanoidInternal(SPEC(1.4, { head: 'weasel', skin: '#B57C3C', build: 'slim' }));
  const wh = headMeshOf(w);
  const wt = wh.geometry.index!.count / 3;
  r.t(`黄鼬头：${wt} 三角形 ≤ 4000`, wt <= 4000);
  const wk = w.root.getObjectByName('whiskers') as THREE.LineSegments | undefined;
  r.t('黄鼬：胡须是 LineSegments（红外下隐藏）', !!wk && wk.isLineSegments === true, `${(wk?.geometry.attributes.position?.count ?? 0) / 2} 段`);
  const { ring, origin } = seamOf(w, wh);
  const m = checkRingMatch(wh.geometry, ring, { origin });
  r.t('黄鼬头：底圈 = NECK_TOP', m.ok, m.notes);
  w.dispose();
  return r.done();
});

// ---------------------------------------------------------------- 贴图

registerSelftest('char2.head_canvas', () => {
  const r = report();
  const lumAt = (tex: THREE.CanvasTexture, pts: readonly (readonly [number, number, number])[], rad = 3) => {
    const c = tex.image as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    let s = 0, n = 0;
    for (const [x, y, z] of pts) {
      const [u, v] = uvOfPoint(x, y, z);
      const X = Math.round(u * c.width), Y = Math.round((1 - v) * c.height);
      const d = g.getImageData(X - rad, Y - rad, rad * 2, rad * 2).data;
      for (let i = 0; i < d.length; i += 4) { s += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!; n++; }
    }
    return s / n;
  };
  for (const key of ['bride', 'wang_young', 'jianguo_child', 'girl']) {
    const f = HEAD_LOOKS[key]!.face;
    const tex = faceTexture(f);
    const c = tex.image as HTMLCanvasElement;
    r.t(`${key}：画布 ${c.width}×${c.height} ≤ 512×384`, c.width * c.height <= 512 * 384);
    r.t(`${key}：同参数复用同一张贴图`, faceTexture({ ...f }) === tex);
    const jaw = lumAt(tex, [[0.036, 0.062, -0.08], [-0.036, 0.062, -0.08], [0.048, 0.074, -0.07], [-0.048, 0.074, -0.07]]);
    const cheek = lumAt(tex, [[0.052, 0.128, -0.08], [-0.052, 0.128, -0.08]]);
    r.t(`${key}：下巴不发暗（${((1 - jaw / cheek) * 100).toFixed(1)}% < 3%）`, jaw >= cheek * 0.97);
  }
  const hairLum = (key: string) => lumAt(faceTexture(HEAD_LOOKS[key]!.face), [[0, 0.2, 0.09], [0.03, 0.23, 0.05]]);
  const lw = hairLum('wang'), ly = hairLum('wang_young'), lb = hairLum('bride');
  r.t(`王奶奶的头发（发髻同色）是灰的（${lw.toFixed(0)}），年轻王（${ly.toFixed(0)}）、新娘（${lb.toFixed(0)}）是黑的`, lw > 90 && ly < 60 && lb < 60);
  return r.done();
});

// ---------------------------------------------------------------- 贴片

registerSelftest('char2.head_patch', () => {
  const r = report();
  const h = makeHead('zhou');
  const head = headMeshOf(h);
  const probe = new THREE.Mesh(head.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  probe.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  const cases: [string, HeadShellOpts][] = [
    ['录像带', { lon: [Math.PI * 1.5 - 1.05, Math.PI * 1.5 + 1.05], lat: [0.31, 2.84], offset: 0.0035 }],
    ['笑脸', { lon: [Math.PI * 1.5 - 0.71, Math.PI * 1.5 + 0.71], lat: [0.4, 2.65], offset: 0.003, centre: [0, -0.005, 0.045] }],
  ];
  for (const [name, o] of cases) {
    const geo = headShell(head, o);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    let lo = 1, hi = 0;
    const p = new THREE.Vector3(), d = new THREE.Vector3(), c = new THREE.Vector3(...(o.centre ?? [0, 0, 0]));
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      d.copy(p).sub(c).normalize();
      rc.set(c, d);
      const hit = rc.intersectObject(probe, false)[0];
      if (!hit) continue;
      const gap = p.distanceTo(c) - hit.distance;
      lo = Math.min(lo, gap);
      hi = Math.max(hi, gap);
    }
    r.t(`${name}贴片在表面外 ${mm(lo)}–${mm(hi)}mm（鼻子不穿出）`, lo > 0.0008 && hi < 0.012);
    geo.dispose();
  }
  (probe.material as THREE.Material).dispose();
  h.dispose();
  return r.done();
});

// ---------------------------------------------------------------- 截图工具：头像陈列

interface GalleryItem { key: string; pos: [number, number, number]; yaw?: number; mode?: 'ghost' | 'replay' | 'silhouette'; weasel?: boolean }
const gallery: HumanoidInternal[] = [];
registerSelftest('char2.head_gallery', (game: Game) => {
  const r = report();
  const cfg = (globalThis as { __headGallery?: { op?: 'spawn' | 'clear'; items?: GalleryItem[] } }).__headGallery ?? {};
  for (const h of gallery.splice(0)) {
    h.root.removeFromParent();
    h.dispose();
  }
  const area = game.areas.current;
  if (cfg.op !== 'clear' && area) {
    for (const it of cfg.items ?? []) {
      const h = it.weasel ? createHumanoidInternal(SPEC(1.4, { head: 'weasel', skin: '#B57C3C', build: 'slim', shirt: '#4E5A63' })) : makeHead(it.key);
      if (it.mode) h.setMaterialMode(it.mode);
      h.setPose('stand', 0);
      for (let i = 0; i < 3; i++) h.update(0.016, 0);
      h.root.position.set(...it.pos);
      h.root.rotation.y = ((it.yaw ?? 0) * Math.PI) / 180;
      h.root.userData.char2spawn = true;
      area.root.add(h.root);
      h.root.updateMatrixWorld(true);
      gallery.push(h);
    }
  }
  r.t(`陈列 ${gallery.length}`, true);
  return r.done();
});

const part: AreaPart = {};
export default part;
