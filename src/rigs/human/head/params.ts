// owner: WP2
// char2 WP-H：头型预设、塑形滑杆、发型定义（PLAN §3.1、§4）。纯数据与小函数，几何（shape.ts）和贴图（paint.ts）都读它。

import { headPresetOf, normHair } from '../profile';
import type { FaceOpts, HairStyle, HeadPreset, SculptKey } from '../types';
import { DEG, polyline } from './mapping';

export type NormHair = Exclude<HairStyle, 'short'>;
export const SCULPT_KEYS: readonly SculptKey[] = ['jawW', 'chin', 'cheekFull', 'cheekbone', 'noseLen', 'noseW', 'noseBridge', 'browRidge',
  'foreheadH', 'faceLen', 'earSize', 'earlobe', 'lipFull', 'eyeSize'];

/** 头型预设的缺省塑形（-1..1 量级；face.sculpt 叠加在上面）。 */
export const PRESET_SCULPT: Readonly<Record<HeadPreset, Partial<Record<SculptKey, number>>>> = {
  man: { jawW: 0.35, chin: 0.15, browRidge: 0.35, noseBridge: 0.1 },
  woman: { jawW: -0.6, chin: -0.25, cheekbone: 0.35, noseLen: -0.45, noseW: -0.35, noseBridge: -0.25, browRidge: -0.9, lipFull: 0.5, eyeSize: 0.25, earSize: -0.25, cheekFull: 0.15 },
  oldMan: { faceLen: 0.55, cheekFull: -0.55, browRidge: 0.6, earSize: 0.35, earlobe: 0.45, noseLen: 0.3, noseBridge: 0.35, lipFull: -0.45, jawW: 0.1 },
  oldWoman: { jawW: -0.45, chin: -0.5, cheekFull: 0.5, lipFull: -0.6, noseLen: -0.2, browRidge: -0.7, earlobe: 0.35, faceLen: -0.15 },
  boy: { chin: -0.55, jawW: 0.1, cheekFull: 1.1, browRidge: -1, noseLen: -0.4, noseBridge: -0.8, eyeSize: 0.6, lipFull: 0.1, earSize: -0.1 },
  girl: { chin: -0.6, jawW: -0.1, cheekFull: 1.1, browRidge: -1.2, noseLen: -0.5, noseBridge: -0.9, eyeSize: 0.7, lipFull: 0.3, earSize: -0.25 },
  deity: { cheekFull: 1.3, chin: -0.35, jawW: 0.45, earlobe: 1.6, earSize: 0.45, browRidge: 0.25, noseW: 0.35, foreheadH: 0.6, lipFull: 0.1 },
};

/** 解析后的头部参数（几何与贴图共用）。 */
export interface HeadParams {
  preset: HeadPreset;
  female: boolean; child: boolean; old: boolean; deity: boolean;
  /** 预设 + face.sculpt（每项缺省 0） */
  sc: Readonly<Record<SculptKey, number>>;
  hair: NormHair;
}

export function headParams(face: Readonly<FaceOpts>): HeadParams {
  const preset = headPresetOf(face);
  const base = PRESET_SCULPT[preset];
  const sc = {} as Record<SculptKey, number>;
  for (const k of SCULPT_KEYS) sc[k] = Math.max(-2, Math.min(2.5, (base[k] ?? 0) + (face.sculpt?.[k] ?? 0)));
  const child = preset === 'boy' || preset === 'girl';
  const female = preset === 'woman' || preset === 'oldWoman' || preset === 'girl';
  return {
    preset, female, child, deity: preset === 'deity', old: preset === 'oldMan' || preset === 'oldWoman' || preset === 'deity',
    sc, hair: normHair(face.hairStyle),
  };
}

// ---------------------------------------------------------------- 发型

/** 一种发型（几何的厚度场 + 发际线；贴图用同一组函数画头发区）。角度一律弧度，厚度单位米（单位坐标）。 */
export interface HairDef {
  /** 下沿发际线 α(|ψ|)（没有 = 不长头发） */
  line: ((apsi: number) => number) | null;
  /** 上沿（秃顶的一圈：只到这个 α） */
  top?: (apsi: number) => number;
  /** 只在 |ψ| ≥ minPsi 处长（秃顶：前面没有） */
  minPsi?: number;
  /** 厚度：头顶、两侧、后脑、后颈 */
  tTop: number; tSide: number; tBack: number; tNape: number;
  /** 发际线渐变的半宽（弧度）：几何上 4–6mm 的坡 */
  ramp: number;
  /** 分缝：方位 ψ、深度、半宽（弧度） */
  part?: { psi: number; depth: number; width: number };
  /** 大边前额的发帘多出来的厚度（侧分） */
  fringe?: number;
  /** 平头：头顶压平到这个 y */
  flat?: number;
  /** 发髻 */
  bun?: 'bun' | 'chignon';
  /** 发束起伏（厚度的相对幅度） */
  clumps?: number;
  /** 碗盖头：边上不变薄（一圈齐刷刷的边） */
  hardEdge?: boolean;
}

const K = (pts: readonly (readonly [number, number])[]) => {
  const f = polyline(pts.map(([p, a]) => [p * DEG, a * DEG] as const));
  return (apsi: number) => f(apsi);
};

/** 男式发际线：前额 126°，额角微微后退，鬓角，绕过耳朵，耳后落到后颈。 */
const LINE_M = K([[0, 126], [20, 127], [38, 131], [55, 126], [68, 114], [75, 99], [80, 104], [86, 114], [101, 114], [110, 90], [120, 74], [140, 63], [160, 59], [180, 58]]);
/** 女式：圆一点、没有鬓角。 */
// 集成：前额正中高一点、往两边额角圆圆地落下来（原来前额一段几乎是平的，往后梳的发型读成齐刘海）
const LINE_F = K([[0, 133.5], [10, 132.6], [22, 130.2], [35, 126.2], [50, 120.6], [62, 115.6], [72, 110], [80, 112], [86, 115], [101, 115], [110, 92], [120, 76], [140, 64], [160, 60], [180, 59]]);
/** 老头的稀发：前额和额角都退了。 */
const LINE_THIN = K([[0, 137], [22, 139], [38, 143], [55, 133], [68, 117], [75, 101], [80, 105], [86, 114], [101, 114], [110, 90], [120, 74], [140, 63], [160, 59], [180, 58]]);
/** 碗盖：一圈平平的边（前额压低成刘海）。 */
const LINE_BOWL = K([[0, 116], [30, 116], [55, 114], [70, 111], [80, 113], [86, 115], [101, 115], [112, 100], [126, 86], [150, 76], [180, 74]]);
/** 秃顶的发环上沿。 */
const TOP_BALD = K([[60, 100], [90, 111], [120, 113], [180, 114]]);

export function hairDef(h: NormHair, female: boolean): HairDef {
  const line = female ? LINE_F : LINE_M;
  switch (h) {
    case 'none': return { line: null, tTop: 0, tSide: 0, tBack: 0, tNape: 0, ramp: 0.02 };
    case 'crop': return { line, tTop: 0.0085, tSide: 0.0048, tBack: 0.0058, tNape: 0.0026, ramp: 1.4 * DEG, clumps: 0.06 };
    case 'side_part': return {
      line, tTop: 0.0125, tSide: 0.0056, tBack: 0.0066, tNape: 0.003, ramp: 1.3 * DEG,
      part: { psi: 34 * DEG, depth: 0.0032, width: 3.2 * DEG }, fringe: 0.0035, clumps: 0.1,
    };
    case 'thin_old': return { line: LINE_THIN, tTop: 0.0032, tSide: 0.0036, tBack: 0.0042, tNape: 0.002, ramp: 1.6 * DEG };
    case 'bald': return { line: LINE_M, top: TOP_BALD, minPsi: 74 * DEG, tTop: 0.0042, tSide: 0.0042, tBack: 0.0045, tNape: 0.0025, ramp: 1.6 * DEG };
    case 'flat_top': return { line, tTop: 0.012, tSide: 0.0055, tBack: 0.006, tNape: 0.0028, ramp: 1.3 * DEG, flat: 0.272 };
    case 'bun': return { line: LINE_F, tTop: 0.0058, tSide: 0.0046, tBack: 0.0052, tNape: 0.0034, ramp: 1.2 * DEG, bun: 'bun' };
    case 'long': return {
      line: LINE_F, tTop: 0.0062, tSide: 0.0058, tBack: 0.0066, tNape: 0.0055, ramp: 1.2 * DEG, bun: 'chignon',
      part: { psi: 0, depth: 0.0028, width: 2.8 * DEG }, clumps: 0.08,
    };
    case 'child_bowl': return { line: LINE_BOWL, tTop: 0.0115, tSide: 0.0085, tBack: 0.009, tNape: 0.0075, ramp: 0.7 * DEG, clumps: 0.07, hardEdge: true };
  }
}

/**
 * 发型的覆盖系数（0..1，几何的厚度和贴图的头发区都乘它）与边：ψ、α 处是不是头发。
 * 只看角度，与头的大小、体型无关（贴图按 FaceOpts 缓存，不知道身高）。
 */
export function hairCover(d: HairDef, psi: number, alpha: number, soft = 1): number {
  if (!d.line) return 0;
  const ap = Math.abs(psi);
  const r = d.ramp * soft;
  const lo = d.line(ap);
  let e = smooth(lo - r, lo + r, alpha);
  if (d.top) {
    const hi = d.top(ap);
    e *= 1 - smooth(hi - r, hi + r, alpha);
  }
  if (d.minPsi !== undefined) e *= smooth(d.minPsi - 4 * DEG, d.minPsi + 4 * DEG, ap);
  return e;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 头发区里的厚度（不含覆盖系数）：头顶/两侧/后脑/后颈混合，加分缝、发帘、发束。y、ny = 该点（基础曲面）的高度与法线 y（平头用）。 */
export function hairThickness(d: HairDef, psi: number, alpha: number, y: number, ny: number): number {
  const ap = Math.abs(psi);
  const wt = smooth(112 * DEG, 160 * DEG, alpha);
  const wb = smooth(100 * DEG, 150 * DEG, ap);
  const lat = d.tSide + (d.tBack - d.tSide) * wb;
  const wn = (1 - smooth(58 * DEG, 82 * DEG, alpha)) * smooth(95 * DEG, 130 * DEG, ap);
  let t = lat + (d.tNape - lat) * wn;
  let top = d.tTop;
  if (d.flat !== undefined && ny > 0.25) top = Math.min(0.024, Math.max(d.tSide, (d.flat - y) / Math.max(ny, 0.4)));
  t += (top - t) * wt;
  if (d.part) {
    const lo = d.line ? d.line(ap) : 0;
    const along = smooth(lo, lo + 10 * DEG, alpha) * (1 - smooth(158 * DEG, 172 * DEG, alpha));
    t -= d.part.depth * Math.exp(-(((psi - d.part.psi) / d.part.width) ** 2)) * along;
    if (d.fringe && d.line) {
      // 大边（分缝右边，ψ 小于分缝）前额那一片蓬起来，压在发际线上
      const side = smooth(d.part.psi - 4 * DEG, d.part.psi - 18 * DEG, psi) * smooth(-70 * DEG, -30 * DEG, psi);
      const front = smooth(lo - 1 * DEG, lo + 3 * DEG, alpha) * (1 - smooth(lo + 10 * DEG, lo + 26 * DEG, alpha));
      t += d.fringe * side * front;
    }
  }
  if (d.clumps) t *= 1 + d.clumps * Math.sin(psi * 9 + alpha * 2.5) * smooth(100 * DEG, 150 * DEG, alpha);
  return Math.max(0, t);
}
