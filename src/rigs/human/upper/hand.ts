// owner: WP2
// char2 WP-U：手（右手，绑定姿势；左手由 arm.ts 镜像）。手掌是从腕圈往下的放样（24 点，与胳膊同一约定：0 = 手背 +x、
// 6 = 拇指侧 -z、12 = 手心 -x、18 = 小指侧 +z），掌根侧面开一个 8 点的洞长出拇指；指根那一圈由四根手指的根圈拼成，
// 指缝用小三角补上（指蹼）。四指各一根 8 点的管子，按 MCP/PIP/DIP 自然弯曲、略张开；全部 100% 跟腕骨。

import * as THREE from 'three';
import { boneIndex } from '../profile';
import type { UpperDims } from './dims';
import { MeshBuilder, gauss, type Skin } from './mesh';

const rotZ = (v: THREE.Vector3, a: number) => v.applyAxisAngle(new THREE.Vector3(0, 0, 1), a);

/**
 * 右手。wristRing：胳膊最后一圈（皮肤，25 个下标，与掌圈同一约定）；wrist：腕关节绑定位置。piece：皮肤部件。
 * 返回指尖等测量点（自测用）。
 */
export function buildHand(mb: MeshBuilder, d: UpperDims, wristRing: number[], wrist: THREE.Vector3, piece: number): { tipMiddle: THREE.Vector3; palmCentre: THREE.Vector3 } {
  const s = d.s;
  const hs = s * d.handK;
  const bone = boneIndex('wristR');
  const skin: Skin = [[bone, 1]];
  const child = d.child, old = d.old;
  const thick = child ? 1.15 : d.female ? 0.95 : 1;
  const fingerW = child ? 1.12 : old ? 0.92 : d.female ? 0.95 : 1;
  const knuckle = old ? 1.12 : 1;
  const N = 24;
  const ang = (j: number) => (j / N) * Math.PI * 2;

  // ---------------------------------------------------------------- 手掌
  // [dy, 半厚 rx, 半宽 rz, 大鱼际, 小鱼际, 指节背]
  const rowsSpec: [number, number, number, number, number, number][] = [
    [-0.016, 0.0195, 0.034, 0.004, 0.0025, 0],
    [-0.036, 0.0172, 0.0395, 0.0062, 0.003, 0],
    [-0.057, 0.0155, 0.0418, 0.0025, 0.0022, 0],
    [-0.08, 0.0146, 0.0428, 0, 0.001, 0.0018],
  ];
  const palmRings: number[][] = [wristRing];
  const centres: THREE.Vector3[] = [];
  for (const [dy, rx0, rz0, then, hypo, kn] of rowsSpec) {
    const c = new THREE.Vector3(wrist.x, wrist.y + dy * hs, wrist.z);
    centres.push(c);
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j < N; j++) {
      const t = ang(j);
      const cx = Math.cos(t), sz = Math.sin(t);
      let rx = rx0 * hs * thick, rz = rz0 * hs * (child ? 1.03 : 1);
      // 手心一侧略平、手背圆
      if (cx < 0) rx *= 0.92;
      const p = new THREE.Vector3(c.x + cx * rx, c.y, c.z - sz * rz);
      // 大鱼际（拇指根，手心偏拇指侧：t ≈ 120°–150°）、小鱼际（手心偏小指侧：t ≈ 215°–240°）
      const th = then * hs * gauss(t - 2.3, 0.42), hy = hypo * hs * gauss(t - 3.95, 0.4);
      const outx = cx, outz = -sz;
      p.x += outx * (th + hy);
      p.z += outz * (th + hy);
      // 指节：手背上四个小鼓包
      if (kn && cx > 0.3) {
        for (const zc of [-0.0285, -0.0095, 0.0095, 0.027]) p.x += kn * hs * knuckle * gauss(p.z - c.z - zc * hs, 0.006 * hs) * cx;
      }
      pts.push(p);
    }
    palmRings.push(mb.ring(pts, 0, () => skin));
  }
  // 拇指洞：R1 → R3（两行），列 8..10（两格）
  const TH0 = 8, TH1 = 10;
  const axisRef = (q: THREE.Vector3) => new THREE.Vector3(wrist.x, q.y, wrist.z);
  const tPalm = mb.triCount;
  for (let r = 0; r + 1 < palmRings.length; r++) {
    const hole = r === 1 || r === 2;
    mb.strip(palmRings[r]!, palmRings[r + 1]!, piece, hole ? (i => i >= TH0 && i < TH1) : undefined);
  }
  mb.orient(tPalm, mb.triCount, axisRef);

  // ---------------------------------------------------------------- 四指
  const F = [
    { z: -0.0285, dy: -0.101, len: 0.072, w: 0.009, t: 0.0081, curl: 1, fan: -0.07 },
    { z: -0.0095, dy: -0.105, len: 0.08, w: 0.0093, t: 0.0083, curl: 1.1, fan: -0.015 },
    { z: 0.0095, dy: -0.102, len: 0.075, w: 0.0087, t: 0.0079, curl: 1.22, fan: 0.035 },
    { z: 0.027, dy: -0.094, len: 0.06, w: 0.0076, t: 0.0069, curl: 1.38, fan: 0.085 },
  ];
  const D2R = Math.PI / 180;
  const fingerRings: number[][] = [];
  const fingerCentres: THREE.Vector3[][] = [];
  let tipMiddle = new THREE.Vector3();
  const ringPts = (c: THREE.Vector3, dir: THREE.Vector3, dorsal: THREE.Vector3, rx: number, rz: number, flatDorsal = 1): THREE.Vector3[] => {
    const ex = dorsal.clone().addScaledVector(dir, -dorsal.dot(dir)).normalize();
    const ez = new THREE.Vector3().crossVectors(ex, dir).normalize();
    if (ez.z < 0) ez.negate();
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < 8; k++) {
      const t = (k / 8) * Math.PI * 2;
      const cx = Math.cos(t);
      const r1 = cx > 0 ? rx * (1 - (1 - flatDorsal) * cx * cx) : rx * 0.96;
      pts.push(c.clone().addScaledVector(ex, cx * r1).addScaledVector(ez, -Math.sin(t) * rz));
    }
    return pts;
  };
  const shared = (pts: THREE.Vector3[]): number[] => {
    const idx = pts.map(p => mb.v(p.x, p.y, p.z, 0, 0, skin));
    idx.push(idx[0]!);
    return idx;
  };
  const tFingers = mb.triCount;
  const baseRings: number[][] = [];
  F.forEach((f, fi) => {
    const L = f.len * hs * (child ? 0.92 : 1);
    const rw = f.w * hs * fingerW * (child ? 1.12 : 1), rt = f.t * hs * fingerW * thick;
    const base = new THREE.Vector3(wrist.x + 0.0018 * hs, wrist.y + f.dy * hs, wrist.z + f.z * hs);
    const d0 = new THREE.Vector3(0, -1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), f.fan);
    const ck = d.curl ?? 1;
    const c1 = -12 * D2R * f.curl * ck, c2 = -25 * D2R * f.curl * Math.min(ck, 2.6), c3 = -15 * D2R * f.curl * Math.min(ck, 2.2);
    const d1 = rotZ(d0.clone(), c1), d2 = rotZ(d1.clone(), c2), d3 = rotZ(d2.clone(), c3);
    const x0 = new THREE.Vector3(1, 0, 0);
    const x1 = rotZ(x0.clone(), c1), x2 = rotZ(x1.clone(), c2), x3 = rotZ(x2.clone(), c3);
    const PIP = base.clone().addScaledVector(d1, 0.45 * L);
    const DIP = PIP.clone().addScaledVector(d2, 0.3 * L);
    const lenD = 0.25 * L;
    const bis = (a: THREE.Vector3, b: THREE.Vector3) => a.clone().add(b).normalize();
    const spec: [THREE.Vector3, THREE.Vector3, THREE.Vector3, number, number, number][] = [
      // [中心, 方向, 手背方向, 半厚倍数, 半宽倍数, 手背压平]
      [base.clone().addScaledVector(d1, 0.22 * L), d1, x1, 0.97, 0.97, 1],
      [PIP, bis(d1, d2), bis(x1, x2), 1.03 * knuckle, 1.03 * knuckle, 1],
      [PIP.clone().addScaledVector(d2, 0.15 * L), d2, x2, 0.92, 0.92, 1],
      [DIP, bis(d2, d3), bis(x2, x3), 0.92 * (old ? 1.08 : 1), 0.93 * (old ? 1.06 : 1), 1],
      [DIP.clone().addScaledVector(d3, 0.5 * lenD), d3, x3, 0.86, 0.88, 0.8],
      [DIP.clone().addScaledVector(d3, 0.84 * lenD), d3, x3, 0.66, 0.74, 0.85],
    ];
    const taper = (k: number) => 1 - 0.2 * (k / spec.length);
    const r0 = shared(ringPts(base, d1, x0, rt, rw));
    baseRings.push(r0);
    const rings = [r0];
    const cens = [base.clone()];
    spec.forEach(([c, dir, dor, kt, kw, flat], k) => {
      rings.push(shared(ringPts(c, dir, dor, rt * kt * taper(k), rw * kw * taper(k), flat)));
      cens.push(c.clone());
    });
    const tip = DIP.clone().addScaledVector(d3, lenD).addScaledVector(x3, -0.0012 * hs);
    if (fi === 1) tipMiddle = tip.clone();
    const tipV = mb.v(tip.x, tip.y, tip.z, 0, 0, skin);
    const t0 = mb.triCount;
    for (let k = 0; k + 1 < rings.length; k++) mb.strip(rings[k]!, rings[k + 1]!, piece);
    const last = rings[rings.length - 1]!;
    for (let k = 0; k < 8; k++) mb.t(last[k]!, last[k + 1]!, tipV, piece);
    cens.push(tip);
    mb.orient(t0, mb.triCount, q => nearest(cens, q));
    fingerRings.push(...rings);
    fingerCentres.push(cens);
  });
  void tFingers; void fingerRings; void fingerCentres;

  // 指根拼圈：中指背（7,0,1）、食指背、食指心（3,4,5）、中指心、无名指心、小指心、小指背、无名指背
  const [ix, md, rg, lt] = baseRings as [number[], number[], number[], number[]];
  const comp = [md[7]!, md[0]!, md[1]!, ix[7]!, ix[0]!, ix[1]!,
    ix[3]!, ix[4]!, ix[5]!, md[3]!, md[4]!, md[5]!, rg[3]!, rg[4]!, rg[5]!, lt[3]!, lt[4]!, lt[5]!,
    lt[7]!, lt[0]!, lt[1]!, rg[7]!, rg[0]!, rg[1]!];
  comp.push(comp[0]!);
  const tPalm0 = mb.triCount;
  mb.strip(palmRings[palmRings.length - 1]!, comp, piece);
  mb.orient(tPalm0, mb.triCount, axisRef);
  // 指蹼与两头
  const down = new THREE.Vector3(0, -1, 0);
  for (const [f, g] of [[ix, md], [md, rg], [rg, lt]] as const) {
    mb.tOriented(f[7]!, f[6]!, g[2]!, piece, down);
    mb.tOriented(f[7]!, g[2]!, g[1]!, piece, down);
    mb.tOriented(f[6]!, f[5]!, g[3]!, piece, down);
    mb.tOriented(f[6]!, g[3]!, g[2]!, piece, down);
  }
  mb.tOriented(ix[1]!, ix[2]!, ix[3]!, piece, new THREE.Vector3(0, -0.3, -1));
  mb.tOriented(lt[5]!, lt[6]!, lt[7]!, piece, new THREE.Vector3(0, -0.3, 1));

  // ---------------------------------------------------------------- 拇指
  const R1 = palmRings[2]!, R2 = palmRings[3]!, R3 = palmRings[4]!;
  // palmRings[0] = 腕圈，[1] = R1 … 洞在 palmRings[2]→[4]（两行）
  const loop = [R1[TH0]!, R1[TH0 + 1]!, R1[TH1]!, R2[TH1]!, R3[TH1]!, R3[TH0 + 1]!, R3[TH0]!, R2[TH0]!];
  const lp = loop.map(i => mb.P(i));
  const lc = lp.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / 8);
  // 洞的外法线（大鱼际朝外）
  const n0 = new THREE.Vector3().subVectors(lp[2]!, lp[0]!).cross(new THREE.Vector3().subVectors(lp[6]!, lp[0]!)).normalize();
  const outRef = lc.clone().sub(new THREE.Vector3(wrist.x, lc.y, wrist.z)).normalize();
  if (n0.dot(outRef) < 0) n0.negate();
  const tdir = new THREE.Vector3(-0.3, -0.78, -0.55).normalize();
  const TL = 0.064 * hs * (child ? 0.92 : 1);
  const tr = 0.0108 * hs * fingerW * (child ? 1.1 : 1);
  const tbase = lc.clone().addScaledVector(n0, 0.006 * hs).addScaledVector(tdir, 0.014 * hs);
  const e1 = lp[0]!.clone().sub(lc);
  e1.addScaledVector(tdir, -e1.dot(tdir)).normalize();
  let e2 = new THREE.Vector3().crossVectors(tdir, e1).normalize();
  if (e2.dot(lp[2]!.clone().sub(lc)) < 0) e2 = e2.negate();
  const tring = (c: THREE.Vector3, dir: THREE.Vector3, r: number, flat = 1): THREE.Vector3[] => {
    const a = e1.clone().addScaledVector(dir, -e1.dot(dir)).normalize();
    let b = new THREE.Vector3().crossVectors(dir, a).normalize();
    if (b.dot(e2) < 0) b = b.negate();
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < 8; k++) {
      const t = (k / 8) * Math.PI * 2;
      pts.push(c.clone().addScaledVector(a, Math.cos(t) * r * (Math.cos(t) > 0 ? flat : 1)).addScaledVector(b, Math.sin(t) * r * 0.92));
    }
    return pts;
  };
  const bendAxis = new THREE.Vector3().crossVectors(tdir, new THREE.Vector3(-1, 0, 0)).normalize();
  const td2 = tdir.clone().applyAxisAngle(bendAxis, 0.22);
  const IP = tbase.clone().addScaledVector(tdir, 0.5 * TL);
  const tSpec: [THREE.Vector3, THREE.Vector3, number, number][] = [
    [tbase, tdir, 1.08, 1],
    [tbase.clone().addScaledVector(tdir, 0.26 * TL), tdir, 1.0, 1],
    [IP, tdir.clone().add(td2).normalize(), 0.98 * knuckle, 1],
    [IP.clone().addScaledVector(td2, 0.22 * TL), td2, 0.9, 0.85],
    [IP.clone().addScaledVector(td2, 0.4 * TL), td2, 0.68, 0.85],
  ];
  const tRings: number[][] = [[...loop, loop[0]!]];
  const tCens: THREE.Vector3[] = [lc.clone()];
  for (const [c, dir, k] of tSpec) {
    const pts = tring(c, dir, tr * k);
    tRings.push(shared(pts));
    tCens.push(c.clone());
  }
  const ttip = IP.clone().addScaledVector(td2, 0.49 * TL);
  const ttipV = mb.v(ttip.x, ttip.y, ttip.z, 0, 0, skin);
  tCens.push(ttip);
  const tt0 = mb.triCount;
  for (let k = 0; k + 1 < tRings.length; k++) mb.strip(tRings[k]!, tRings[k + 1]!, piece);
  const tl = tRings[tRings.length - 1]!;
  for (let k = 0; k < 8; k++) mb.t(tl[k]!, tl[k + 1]!, ttipV, piece);
  mb.orient(tt0, mb.triCount, q => nearest(tCens, q));
  void R2;

  const palmCentre = new THREE.Vector3(wrist.x, wrist.y - 0.055 * hs, wrist.z);
  return { tipMiddle, palmCentre };
}

function nearest(cs: readonly THREE.Vector3[], q: THREE.Vector3): THREE.Vector3 {
  let best = cs[0]!, bd = Infinity;
  for (const c of cs) {
    const d = c.distanceToSquared(q);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
