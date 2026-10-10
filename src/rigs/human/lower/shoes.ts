// owner: WP2
// char2 WP-L：鞋（PLAN §3.3）。一只鞋是沿脚长方向放样的鞋楦：后跟杯 → 脚背 → 前掌 → 翘起 1cm 的鞋头；
// 截面 = 上面的鞋面（超椭圆拱）+ 鞋沿外凸一圈（沿条）+ 平底；鞋口往上收成一截“鞋腰”（藏在裤脚里，不露空心）。
// 五种：cloth 布鞋（低帮、圆头、鞋头中缝、贴图画白沿条）、leather 皮鞋（鞋带区凸起、包头缝、2cm 底 + 2.5cm 鞋跟、足弓离地）、
// sneaker 球鞋（厚橡胶底、包头）、boot 靴（高帮 12cm、3cm 厚底）、embroidered 绣花鞋（尖圆头、薄底、低帮）。
// UV 与 clothShoeTexture 一致：v 0.05–0.24 鞋底、0.24–0.30 沿条线、0.30–1 鞋面；u = 沿脚长（后跟 0 → 鞋头 1）。
// 蒙皮：整只鞋跟踝骨；鞋腰最上一圈 70/30 踝/膝。

import * as THREE from 'three';
import { loftRings, setSkin, smooth01 } from '../shared';
import type { BuildCtx, GarmentSpec, SkinnedPiece } from '../types';
import { table, W } from './geom';

const ZETA = [0, 0.03, 0.08, 0.16, 0.27, 0.39, 0.51, 0.62, 0.72, 0.81, 0.88, 0.935, 0.97, 1];
/** 鞋面拱的点数（奇数：正中一点在鞋背中线上）。 */
const UP = 9;

interface ShoeShape {
  /** 鞋面在沿条处的半宽（m，s = 1 成年男人） */
  w: (z: number) => number;
  /** 鞋背/鞋腰最高点离地 */
  top: (z: number) => number;
  /** 鞋底底面离地（鞋头翘、足弓） */
  yb: (z: number) => number;
  /** 鞋底厚 */
  ts: (z: number) => number;
  /** 沿条比鞋面宽多少 */
  welt: number;
  /** 截面超椭圆指数（后跟方 → 鞋头圆） */
  exp: (z: number) => number;
  /** 鞋面正中一点额外抬高（鞋头中缝、鞋带区） */
  ridge: (z: number) => number;
  /** 鞋面整体内收（包头缝） */
  groove: (z: number) => number;
}

function shapeOf(kind: GarmentSpec['shoes']): ShoeShape {
  const wBase = [0.024, 0.031, 0.036, 0.0375, 0.036, 0.0345, 0.0375, 0.0435, 0.0465, 0.0455, 0.041, 0.0335, 0.024, 0.007];
  const topBase = [0.056, 0.07, 0.094, 0.112, 0.115, 0.106, 0.086, 0.07, 0.059, 0.051, 0.0455, 0.04, 0.033, 0.025];
  const toeSpring = (z: number) => 0.01 * Math.pow(smooth01(0.7, 1, z), 2) + 0.004 * Math.max(0, 1 - z / 0.035);
  const exp = table([0, 0.3, 0.7, 1], [3.2, 3.0, 2.6, 2.2]);
  const none = () => 0;
  const base: ShoeShape = {
    w: table(ZETA, wBase), top: table(ZETA, topBase), yb: toeSpring, ts: () => 0.015, welt: 0.0022, exp, ridge: none, groove: none,
  };
  switch (kind) {
    case 'cloth':
      return { ...base, ridge: z => (z > 0.6 ? 0.0009 * smooth01(0.6, 0.75, z) : 0), top: table(ZETA, topBase.map((t, i) => (i >= 6 ? t * 0.95 : t))) };
    case 'leather': {
      const heel = (z: number) => 1 - smooth01(0.25, 0.3, z);
      const arch = (z: number) => smooth01(0.27, 0.34, z) * (1 - smooth01(0.54, 0.62, z));
      return {
        ...base,
        w: table(ZETA, wBase.map((w, i) => (i >= 10 ? w * 0.97 : w))),
        yb: z => toeSpring(z) + 0.007 * arch(z),
        ts: z => 0.013 + 0.013 * heel(z) + 0.001 * arch(z),
        welt: 0.0036,
        ridge: z => 0.0016 * smooth01(0.38, 0.45, z) * (1 - smooth01(0.6, 0.66, z)),
        groove: z => 0.0013 * Math.exp(-Math.pow((z - 0.81) / 0.012, 2)),
      };
    }
    case 'sneaker':
      return {
        ...base,
        w: table(ZETA, wBase.map(w => w * 1.04)),
        ts: z => 0.021 + 0.009 * smooth01(0.88, 0.99, z),
        welt: 0.0035,
        top: table(ZETA, topBase.map((t, i) => (i >= 8 ? t * 1.08 : t))),
      };
    case 'boot':
      return {
        ...base,
        w: table(ZETA, wBase.map((w, i) => (i >= 1 && i <= 6 ? w + 0.004 : w * 1.05))),
        top: table(ZETA, topBase.map((t, i) => (i >= 1 && i <= 5 ? Math.max(t, [0, 0.13, 0.165, 0.17, 0.17, 0.155][i]!) : i <= 8 ? t * 1.1 : t * 1.05))),
        ts: () => 0.028,
        welt: 0.0035,
      };
    case 'embroidered':
      return {
        ...base,
        w: table(ZETA, wBase.map((w, i) => (i >= 9 ? w * [1, 0.92, 0.8, 0.6, 0.5][i - 9]! : w * 0.97))),
        top: table(ZETA, topBase.map((t, i) => (i >= 6 ? t * 0.88 : t))),
        yb: z => toeSpring(z) + 0.006 * Math.pow(smooth01(0.85, 1, z), 2),
        ts: () => 0.009,
        welt: 0.0015,
        ridge: z => 0.0007 * smooth01(0.6, 0.8, z),
      };
  }
}

/** 一只鞋（side R：+x；L 镜像）。返回绑定姿势、根空间的蒙皮几何。 */
export function shoeGeo(ctx: BuildCtx, kind: GarmentSpec['shoes'], side: 'L' | 'R'): THREE.BufferGeometry {
  const s = ctx.s, p = ctx.profile;
  const female = p.sex === 'f' && p.age !== 'child';
  const L = ctx.land.leg.shoeLen;
  const kw = s * (female ? 0.9 : 1) * (p.build === 'stout' ? 1.05 : 1);
  const kh = s * (female ? 0.93 : 1);
  const sh = shapeOf(kind);
  const ank = ctx.layout.bind[side === 'R' ? 'ankleR' : 'ankleL'];
  const sg = side === 'R' ? 1 : -1;
  const alpha = (6 * Math.PI) / 180;
  // 脚的方向（右脚鞋头略朝 +x）与横向
  const dx = sg * Math.sin(alpha), dz = -Math.cos(alpha);
  const ex = sg * Math.cos(alpha), ez = Math.sin(alpha); // 横向：+e 朝外（右脚 +x、左脚 −x）
  const rings: Float32Array[] = [];
  const uvV: number[][] = [];
  const RN = UP + 6;
  for (const z of ZETA) {
    const q = (z - 0.25) * L;
    const lat = -0.005 * s * smooth01(0.7, 1, z); // 鞋头偏向大脚趾一侧（内侧）
    const ox = ank[0] + dx * q + ex * lat, oz = ank[2] + dz * q + ez * lat;
    const yb = sh.yb(z) * s, ts = sh.ts(z) * s, y0 = yb + ts;
    const wu = Math.max(0.002 * s, (sh.w(z) - sh.groove(z)) * kw);
    const ws = sh.w(z) * kw + sh.welt * s;
    const top = Math.max(y0 + 0.004 * s, sh.top(z) * kh - sh.groove(z) * s);
    const hu = top - y0;
    const e = 2 / sh.exp(z);
    const pts: [number, number][] = [];
    for (let j = 0; j < UP; j++) {
      const b = (j / (UP - 1)) * Math.PI;
      const c = Math.cos(b), sn = Math.sin(b);
      const xx = wu * Math.sign(c) * Math.pow(Math.abs(c), e);
      let yy = y0 + hu * Math.pow(sn, e);
      if (j === (UP - 1) / 2) yy += sh.ridge(z) * s;
      else if (Math.abs(j - (UP - 1) / 2) === 1) yy += sh.ridge(z) * s * 0.35;
      pts.push([xx, yy]);
    }
    const yWelt = y0 - 0.0016 * s;
    pts.push([-ws, yWelt], [-ws * 0.985, yb + 0.35 * ts], [-ws * 0.8, yb], [ws * 0.8, yb], [ws * 0.985, yb + 0.35 * ts], [ws, yWelt]);
    // 鞋头最后一站收成一个小点（封口三角形很小，不会在鞋尖上拉出一条贴图的黑线）
    if (z === 1) {
      const yc = (yb + top) / 2 - 0.004 * s;
      for (const q of pts) { q[0] *= 0.6; q[1] = yc + (q[1] - yc) * 0.22; }
    }
    const r = new Float32Array(RN * 3);
    const vv: number[] = [];
    pts.forEach(([xx, yy], i) => {
      // 截面的横向 xx 沿 e（右脚朝外）
      r.set([ox + ex * xx, yy, oz + ez * xx], i * 3);
      vv.push(i < UP ? 0.3 + 0.68 * Math.min(1, Math.max(0, (yy - y0) / Math.max(1e-4, 0.11 * s))) : 0.05 + 0.19 * Math.min(1, Math.max(0, (yy - yb) / Math.max(1e-4, ts))));
    });
    rings.push(r);
    uvV.push(vv);
  }
  const first = rings[0]!, lastR = rings[rings.length - 1]!;
  const centre = (r: Float32Array): [number, number, number] => {
    let x = 0, y = 0, zz = 0;
    for (let i = 0; i < RN; i++) { x += r[i * 3]!; y += r[i * 3 + 1]!; zz += r[i * 3 + 2]!; }
    return [x / RN, y / RN, zz / RN];
  };
  // 后跟、鞋头的封口中心往外推一点，封口是圆的不是平的
  const c0 = centre(first), c1 = centre(lastR);
  const capS: [number, number, number] = [c0[0] - dx * 0.004 * s, c0[1], c0[2] - dz * 0.004 * s];
  const capE: [number, number, number] = [c1[0] + dx * 0.003 * s, c1[1], c1[2] + dz * 0.003 * s];
  const geo = loftRings(rings, { capStart: capS, capEnd: capE });
  // UV：u 沿脚长，v 按截面里的位置（鞋底/沿条/鞋面）
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const Wd = RN + 1;
  ZETA.forEach((z, j) => {
    for (let i = 0; i <= RN; i++) uv.setXY(j * Wd + i, z, uvV[j]![i % RN]!);
  });
  uv.setXY(ZETA.length * Wd, 0, 0.6);
  uv.setXY(ZETA.length * Wd + 1, 1, 0.6);
  uv.needsUpdate = true;
  const ab = side === 'R' ? 'ankleR' : 'ankleL', kb = side === 'R' ? 'kneeR' : 'kneeL';
  const yTop = 0.1 * s;
  setSkin(geo, pp => {
    const k = 0.3 * smooth01(yTop, 0.115 * s, pp.y) + 0.12 * smooth01(0.12 * s, 0.17 * s, pp.y);
    return W([[ab, 1 - k], [kb, k]]);
  });
  return geo;
}

export function buildShoes(ctx: BuildCtx, kind: GarmentSpec['shoes']): SkinnedPiece[] {
  return (['L', 'R'] as const).map(side => ({ kind: 'skinned' as const, name: `shoe${side}`, slot: 'shoes' as const, geo: ctx.track(shoeGeo(ctx, kind, side)) }));
}
