// owner: WP2
// char2 WP-C：角色设定、配件、主角（char2.cast_*）的开发沙盒自测。只有这个 WP 改这个文件（PLAN §5.7）。
//   char2.cast_props    各角色 props 的键（PLAN §5.5 验收表）、每件配件的网格数、主角的袖箍与描边规则
//   char2.cast_fit      配件贴着头/身子：帽子不让头发穿出来也不悬空、眼镜搭在鼻梁上、背带绕过后颈、胡子够长、袖箍半径、发簪在发髻上
//   char2.cast_huang    黄三爷本人：帽檐压低，但从 3m 外 1.6m 的眼高看过去下巴和嘴不被帽子挡住
// scripts/selftest/char2.mjs 自动跑全部 'char2.*'。

import * as THREE from 'three';
import type { AreaPart } from '../../core/area';
import type { SelftestResult } from '../../debug/selftest';
import { registerSelftest } from '../../debug/selftest';
import { HeadFit } from '../../rigs/cast/geo';
import { LEGACY_LAYOUT } from '../../rigs/human/assemble';
import { createCharacter, type CharacterKind } from '../../rigs/characters';
import { createPlayerModel } from '../../rigs/player';

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
const f3 = (v: THREE.Vector3) => `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;

/** 可见网格数（= draw call）。 */
function calls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible(o => { if ((o as THREE.Mesh).isMesh) n++; });
  return n;
}
function meshesOf(o: THREE.Object3D | undefined): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  o?.traverse(c => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); });
  return out;
}
/** 网格顶点换到某个祖先节点的局部坐标。 */
function pointsIn(m: THREE.Mesh, frame: THREE.Object3D): THREE.Vector3[] {
  frame.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  const mat = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
  const pos = m.geometry.attributes.position as THREE.BufferAttribute;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mat));
  return out;
}
/** 网格上法线接近水平（|n.y| < 0.5）的顶点：帽身的侧壁（帽檐的上下面是平的，不算）。 */
function wallPoints(m: THREE.Mesh, frame: THREE.Object3D): THREE.Vector3[] {
  const pts = pointsIn(m, frame);
  const nor = m.geometry.attributes.normal as THREE.BufferAttribute;
  const nm = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().copy(frame.matrixWorld).invert().multiply(m.matrixWorld));
  const n = new THREE.Vector3();
  return pts.filter((_, i) => Math.abs(n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize().y) < 0.5);
}

/** headSlot 下名为 'head' 的人头网格。 */
function headUnder(slot: THREE.Object3D): THREE.Mesh | null {
  let h: THREE.Mesh | null = null;
  slot.traverse(o => { if (!h && o.name === 'head' && (o as THREE.Mesh).isMesh) h = o as THREE.Mesh; });
  return h;
}

// ================================================================ props

const PROPS: Readonly<Partial<Record<CharacterKind, readonly string[]>>> = {
  tudi: ['lantern', 'lanternLight', 'cane', 'beard'],
  wang: ['bun', 'basket'],
  lu: ['glasses', 'tlr', 'suit'],
  zhou: ['collar', 'armband', 'cap', 'mug'],
  huang: ['masked', 'man', 'weasel', 'mask', 'hat', 'tail'],
  kid: ['scarf'],
  bride: ['bun'],
  junkman: ['cap'],
  worker: ['hardHat'],
};
/** 每件配件最多几个网格（PLAN §3.6：眼镜 1、双反 ≤ 2……） */
const ACC_MESHES: Readonly<Record<string, number>> = {
  glasses: 1, tlr: 2, cap: 1, hat: 2, hardHat: 1, beard: 1, mug: 1, basket: 1, scarf: 1, armband: 1, bun: 2, tail: 1, cane: 3,
};

registerSelftest('char2.cast_props', () => {
  const r = report();
  const bad: string[] = [];
  const counts: string[] = [];
  for (const [k, keys] of Object.entries(PROPS) as [CharacterKind, readonly string[]][]) {
    for (const look of ['live', 'ghost', 'replay'] as const) {
      const c = createCharacter(k, { look, seed: 3, ...(k === 'huang' ? { variant: 'man' } : {}) });
      for (const key of keys) if (!c.props[key]) bad.push(`${k}/${look} 缺 props.${key}`);
      if (look === 'live') {
        for (const [key, max] of Object.entries(ACC_MESHES)) {
          const o = c.props[key];
          if (!o || o.userData.rigPart) continue;
          const n = meshesOf(o).length;
          if (n > max) bad.push(`${k}.${key} ${n} 个网格 > ${max}`);
        }
        counts.push(`${k} ${calls(c.root)}`);
      }
      c.dispose();
    }
  }
  const zr = createCharacter('zhou', { look: 'replay' });
  r.t('zhou 回放：faceSnow', !!zr.props.faceSnow);
  zr.dispose();
  r.t('props 的键齐全（PLAN §5.5）、每件配件的网格数不超', bad.length === 0, bad.slice(0, 8).join('；'));
  r.t('各角色可见网格数（参考；旧版人身时偏多）', true, counts.join('，'));
  // 主角：袖箍在左臂上、描边不上皮肤和鞋
  const m = createPlayerModel();
  const band = m.body.root.getObjectByName('armband');
  r.t('主角：左臂袖箍', !!band && band.parent === m.body.joints.shoulderL);
  let rimBad = 0;
  m.body.root.traverse(o => {
    const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!mm || !(o as THREE.Mesh).isMesh) return;
    if ((mm.userData.skin === true || mm.userData.shoes === true) && mm.userData.rimUniform) rimBad++;
  });
  r.t('主角：皮肤与鞋没有轮廓光', rimBad === 0, String(rimBad));
  return r.done();
});

// ================================================================ 贴合

registerSelftest('char2.cast_fit', () => {
  const r = report();
  // ---- 帽子：头（含头发）在帽箍以上的部分全在帽身里（不穿出来 > 3mm），帽顶高过头顶，帽箍离头不超过 5mm
  for (const [k, key, variant] of [['zhou', 'cap', undefined], ['junkman', 'cap', undefined], ['worker', 'hardHat', undefined], ['huang', 'hat', 'man']] as const) {
    const c = createCharacter(k, { seed: 3, ...(variant ? { variant } : {}) });
    c.update(1 / 60, 0);
    const hat = c.props[key];
    const slot = (hat?.parent ?? c.joints.headSlot) as THREE.Object3D;
    const head = headUnder(slot);
    if (!head || !hat) {
      r.t(`${k}.${key}：有头和帽子`, false);
      c.dispose();
      continue;
    }
    const hp = pointsIn(head, slot);
    const capPts = meshesOf(hat).flatMap(m => pointsIn(m, slot));
    const wall = meshesOf(hat).flatMap(m => wallPoints(m, slot));
    const cx = 0;
    const cz = (Math.min(...hp.map(p => p.z)) + Math.max(...hp.map(p => p.z))) / 2;
    const headFit = new HeadFit(head, { centre: [cx, 0, cz], ax: [0.1, 0.1, 0.1] });
    const capFit = HeadFit.fromPoints(capPts, [cx, 0, cz]);
    const wallFit = HeadFit.fromPoints(wall, [cx, 0, cz]);
    // 帽箍下沿：后半圈、离头表面 1.2cm 以内的最低点（避开帽檐）
    const backPts = wall.filter(p => {
      if (p.z < cz + 0.03) return false;
      const ang = Math.atan2(-(p.z - cz), p.x - cx);
      return Math.hypot(p.x - cx, p.z - cz) < headFit.radius(p.y, ang, 0.006, 0.12) + 0.012;
    });
    const bandY = Math.min(...backPts.map(p => p.y));
    const capTop = Math.max(...capPts.map(p => p.y));
    const headTop = Math.max(...hp.map(p => p.y));
    let poke = 0, worst = '';
    for (const p of hp) {
      if (p.y < bandY + 0.012 || p.y > capTop - 0.012) continue;
      const ang = Math.atan2(-(p.z - cz), p.x - cx);
      const rh = Math.hypot(p.x - cx, p.z - cz);
      const rc = capFit.radius(p.y, ang, 0.006, 0.12);
      if (rc > 0 && rh - rc > poke) { poke = rh - rc; worst = f3(p); }
    }
    r.t(`${k}.${key}：头发不从帽身里穿出来（≤ 3mm）`, poke <= 0.003, `${(poke * 1000).toFixed(1)}mm @ ${worst}`);
    r.t(`${k}.${key}：帽顶高过头顶`, capTop > headTop + 0.002, `${capTop.toFixed(3)} vs ${headTop.toFixed(3)}`);
    // 帽箍一圈离头表面（同高同方位）≤ 5.5mm（硬壳安全帽留帽衬空隙 ≤ 24mm）
    let gap = 0, gapAt = '';
    // 旧版蛋头的头发壳是另一层（壳边与头皮之间有 1cm 的台阶），帽箍量出来总差一截：旧版时只查“不离谱”（≤ 15mm）
    // 集成：雕出来的后脑勺在帽箍上方 1cm 内往里收 1cm（量法取 ±4–6mm 窗口里的最远点），帽箍实际贴着头（≤ 3mm，见 integ 笔记），
    // 这里的数要容下窗口误差：布帽/毡帽 ≤ 9.5mm
    const lim = key === 'hardHat' ? 0.024 : LEGACY_LAYOUT ? 0.015 : 0.0095;
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      if (Math.sin(ang) > -0.5) continue; // 只量后半圈（前面是帽檐；毡帽两侧的帽檐往上翘、高过后面的帽箍）
      const y = bandY + 0.005;
      const rc = wallFit.radius(y, ang, 0.004, 0.1), rh = headFit.radius(y, ang, 0.006, 0.12);
      if (rc > 0 && rh > 0 && rc - rh > gap) { gap = rc - rh; gapAt = `ang ${(ang * 180 / Math.PI).toFixed(0)}° y ${y.toFixed(3)} cap ${rc.toFixed(3)} head ${rh.toFixed(3)}`; }
    }
    r.t(`${k}.${key}：帽箍贴着头（离头 ≤ ${(lim * 1000).toFixed(1)}mm）`, gap <= lim, `${(gap * 1000).toFixed(1)}mm ${gapAt}`);
    c.dispose();
  }
  // ---- 眼镜：镜框在脸前（不嵌进脸里），鼻桥搭在鼻梁上（≤ 6mm）
  {
    const c = createCharacter('lu');
    c.update(1 / 60, 0);
    const slot = c.joints.headSlot;
    const head = headUnder(slot)!;
    const hf = new HeadFit(head, { centre: [0, 0, 0], ax: [0.1, 0.1, 0.1] });
    const gp = meshesOf(c.props.glasses).flatMap(m => pointsIn(m, slot));
    const ey = gp.filter(p => Math.abs(p.x) < 0.06 && p.z < -0.05);
    // 镜框（镜片平面 ±8mm 内的点；镜腿往后走，不算）
    const zMin = Math.min(...ey.map(p => p.z));
    let inside = 0;
    for (const p of ey) if (p.z < zMin + 0.008 && Math.abs(p.x) > 0.012 && Math.abs(p.x) < 0.05 && p.z > hf.front(p.x, p.y, 0.003) + 0.001) inside++;
    r.t('眼镜：镜框在脸面前，不嵌进脸', inside === 0, `${inside} 点`);
    const bridge = ey.filter(p => Math.abs(p.x) < 0.003);
    const bz = Math.max(...bridge.map(p => p.z));
    const nose = hf.front(0, Math.max(...bridge.map(p => p.y)) - 0.004, 0.004);
    r.t('眼镜：鼻桥搭在鼻梁上（离鼻梁 ≤ 6mm）', Math.abs(nose - bz) < 0.006, `bridge z ${bz.toFixed(3)} nose ${nose.toFixed(3)}`);
    // ---- 双反相机背带绕过后颈，不从下巴里穿出来
    const spine = c.joints.spine;
    const tp = meshesOf(c.props.tlr).filter(m => m.name === 'tlrBody').flatMap(m => pointsIn(m, spine));
    const neckY = c.joints.neck.position.y;
    const behind = tp.some(p => p.z > 0.05 && Math.abs(p.y - neckY) < 0.04 && Math.abs(p.x) < 0.02);
    const maxY = Math.max(...tp.map(p => p.y));
    r.t('双反背带从后颈绕过去', behind);
    r.t('双反背带不高过领口 2cm（不从下巴里穿出来）', maxY < neckY + 0.02, `${maxY.toFixed(3)} vs 领口 ${neckY.toFixed(3)}`);
    const cam = tp.filter(p => Math.abs(p.x) < 0.03 && p.y < neckY - 0.15);
    const camBack = Math.max(...cam.map(p => p.z));
    r.t('相机挂在胸前（在胸口前面）', camBack < -0.08, camBack.toFixed(3));
    c.dispose();
  }
  // ---- 胡子：下巴往下 ≥ 0.16m
  {
    const c = createCharacter('tudi', { look: 'ghost' });
    c.update(1 / 60, 0);
    const slot = c.joints.headSlot;
    const hp = pointsIn(headUnder(slot)!, slot);
    const chinY = Math.min(...hp.filter(p => p.z < -0.03).map(p => p.y));
    const bp = meshesOf(c.props.beard).flatMap(m => pointsIn(m, slot));
    const tip = Math.min(...bp.map(p => p.y));
    r.t('土地的胡子：从下巴往下 ≥ 0.16m', chinY - tip >= 0.16, `${(chinY - tip).toFixed(3)}m`);
    c.dispose();
  }
  // ---- 袖箍半径 ≈ 0.066s；发簪在发髻上（头后上方）
  {
    const c = createCharacter('zhou');
    const ap = meshesOf(c.props.armband).flatMap(m => pointsIn(m, c.joints.shoulderL));
    const rmax = Math.max(...ap.map(p => Math.hypot(p.x, p.z)));
    r.t('袖箍半径 ≈ 0.066s（±3mm）', Math.abs(rmax - 0.066) < 0.003, rmax.toFixed(4));
    c.dispose();
    const w = createCharacter('wang');
    const pin = meshesOf(w.props.bun).flatMap(m => pointsIn(m, w.joints.headSlot));
    const cz = pin.reduce((a, p) => a + p.z, 0) / pin.length, cy = pin.reduce((a, p) => a + p.y, 0) / pin.length;
    r.t('发簪在头后上方（发髻处）', cz > 0.06 && cy > 0.13, `(${cy.toFixed(3)}, ${cz.toFixed(3)})`);
    w.dispose();
  }
  return r.done();
});

// ================================================================ 黄三爷的脸

registerSelftest('char2.cast_huang', () => {
  const r = report();
  const c = createCharacter('huang', { variant: 'man' });
  c.update(1 / 60, 0);
  c.root.updateWorldMatrix(true, true);
  const hatObj = c.props.hat!;
  const slot = hatObj.parent!;
  const head = headUnder(slot)!;
  const hat = meshesOf(hatObj);
  const hp = pointsIn(head, slot);
  const front = hp.filter(p => Math.abs(p.x) < 0.01 && p.z < -0.02);
  const chinLocal = front.reduce((a, p) => (p.y < a.y ? p : a), front[0]!);
  // 嘴：脸前正中、下巴往上约 4cm 那一带最靠前的点
  const mouthLocal = front.filter(p => Math.abs(p.y - (chinLocal.y + 0.04)) < 0.008).reduce((a, p) => (p.z < a.z ? p : a), chinLocal);
  const eye = new THREE.Vector3(0, 1.6, -3);
  const ray = new THREE.Raycaster();
  const what: string[] = [];
  for (const [name, lp] of [['chin', chinLocal], ['mouth', mouthLocal]] as const) {
    const wp = lp.clone().add(new THREE.Vector3(0, 0, -0.004)).applyMatrix4(slot.matrixWorld);
    ray.set(eye, wp.clone().sub(eye).normalize());
    ray.far = eye.distanceTo(wp) - 0.002;
    const hits = ray.intersectObjects(hat, false);
    if (hits.length) what.push(`${name} ${f3(wp)} 被 ${hits[0]!.object.name} 挡住`);
  }
  r.t('黄三爷：3m 外、眼高 1.6m 看得见下巴和嘴（帽檐不挡）', what.length === 0, what.join('；'));
  // 帽檐压到眉眼一带（脸“埋在帽檐下”）
  const hb = new THREE.Box3();
  for (const m of hat) hb.expandByObject(m);
  const eyeY = new THREE.Vector3(0, chinLocal.y + 0.11, 0).applyMatrix4(slot.matrixWorld).y;
  r.t('帽檐前沿压到眉眼一带', hb.min.y < eyeY + 0.03, `brim min ${hb.min.y.toFixed(3)} eye ${eyeY.toFixed(3)}`);
  c.dispose();
  return r.done();
});
