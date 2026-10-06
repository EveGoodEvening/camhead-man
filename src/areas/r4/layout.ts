// owner: R4
// R4 人民路地下通道·鬼市的坐标常量（GDD §4.5）。原点在通道中心；通道 x∈[-20,20]，z∈[-3,3]，层高 3m；+x 东，-z 北。
//
//   北墙 z=-3   楼梯口 (-18,0,-3)（出口触发体以 (-18,0,-2.6) 为中心）  冷迹 (-16.6,0,-2.4)  规矩牌 (-16,1.8,-2.95)  报刊亭 (-10,-2.5)
//   北排 z=-2.2 N1(-12) N2(-6) N3(0) N4(6) N5(12)（面朝南）
//               门童 (-15.5,-1.2)   残影点 rp.r4_mid (-6,0)   残影点 rp.r4_stall (3,1.2)
//   南排 z=2.2  S1(-9) S2(-3) S3=黄三爷 (3,2.2) S4(9) S5(15)（面朝北）
//               樟木箱 (4.3,0,2.4)（S3 摊子东侧后方）  旧书残页在 S3 摊上
//   东端 x=20   施工围挡

import type { V3, XZ } from '../../core/types';
import { STALL, NPC, type StallId, type NpcId } from '../../data/ids';

export const R4L = {
  /** 通道内墙面（玩家可走范围再往里收 0.3m 胶囊半径） */
  hall: { x0: -20.5, x1: 20.5, z0: -3, z1: 3, h: 3 },
  /** 施工围挡（东头）所在的 x */
  hoardingX: 19.6,
  /** 楼梯口：北墙上的开口 x∈[x0,x1]，楼梯往北爬到 zTop */
  stairs: { x0: -19.1, x1: -16.9, zTop: -9.5, rise: 0.16, run: 0.3 },
  spawn: [-17, 0, 0.5] as V3,
  exitCenter: [-18, 1.25, -2.6] as V3,
  rulesBoard: [-16, 1.8, -2.95] as V3,
  coldStairs: [-16.6, 0, -2.4] as V3,
  kiosk: [-10, 0, -2.2] as V3,
  boy: { pos: [-15.5, 0, -1.2] as V3, yaw: 222 },
  rpMid: [-6, 0, 0] as V3,
  rpStall: [3, 0, 1.2] as V3,
  chest: { pos: [4.3, 0, 2.4] as V3, yaw: 0 },
  /** 摊主站位的 z（北排、南排）与摊桌（桌面高、宽、深、离摊主的距离） */
  rowZ: { n: -2.2, s: 2.2 },
  table: { h: 0.66, w: 1.3, d: 0.6, gap: 0.62 },
  /** 真实光：灯管 3 盏（开市前，朝下的聚光）、楼梯口路灯漏光 1 盏（点光） */
  tubeLights: [[-13, 2.82, 0], [-1, 2.82, 0], [11, 2.82, 0]] as readonly V3[],
  streetSpill: [-18, 5.0, -8.6] as V3,
} as const;

/** 鬼市整组（摊位、灯笼、纸人摊主、纸幡、樟木箱……）的 ref 名（区域内部名，不是游戏 id）：
 *  1997 年开通剪彩的回放里隐去它（hideWorld），那会儿通道是新的、空的。 */
export const MARKET_REF = 'r4_market';

export interface StallSlot {
  /** 交互物 id（S3 是 npc.huang） */
  id: StallId | NpcId;
  /** 摊主站位 */
  pos: V3;
  /** 摊主朝向（北排朝南 180，南排朝北 0） */
  yaw: number;
  /** 纸人脸格子的 seed（黄三爷的伪装与同 seed 的摊主逐像素一致，ARCH §5.3） */
  seed: number;
  row: 'n' | 's';
  /** 摆摊主题（0–9，对应 TEXT.decor.lanterns / tags 的下标） */
  theme: number;
}

const N = (id: StallId, x: number, seed: number, theme: number): StallSlot => ({ id, pos: [x, 0, -2.2], yaw: 180, seed, row: 'n', theme });
const S = (id: StallId | NpcId, x: number, seed: number, theme: number): StallSlot => ({ id, pos: [x, 0, 2.2], yaw: 0, seed, row: 's', theme });

/** 十个摊位（GDD §4.5）。seed 取 0–7 各格，黄三爷 seed 3（与 N2 的脸格子不同、与 S5 同格——同一张纸脸两个摊主，看破只能靠 4× 看嘴）。 */
export const STALLS: readonly StallSlot[] = [
  N(STALL.R4_STALL_N1, -12, 0, 0),
  N(STALL.R4_STALL_N2, -6, 1, 1),
  N(STALL.R4_STALL_N3, 0, 2, 2),
  N(STALL.R4_STALL_N4, 6, 4, 3),
  N(STALL.R4_STALL_N5, 12, 5, 4),
  S(STALL.R4_STALL_S1, -9, 6, 5),
  S(STALL.R4_STALL_S2, -3, 7, 6),
  S(NPC.HUANG, 3, 3, 7),
  S(STALL.R4_STALL_S4, 9, 9, 8),
  S(STALL.R4_STALL_S5, 15, 11, 9),
];

/** 摊桌中心（摊主正前方 table.gap）。 */
export function tableCenter(s: StallSlot): XZ {
  const dz = s.row === 'n' ? R4L.table.gap : -R4L.table.gap;
  return [s.pos[0], s.pos[2] + dz];
}

/** 灯笼挑在摊主哪一侧（+1 东、-1 西）：摊主右手边——北排（面朝南）在西、南排（面朝北）在东。
 *  S3 的灯笼因此在黄三爷东边、樟木箱西北，它那盏真实点光同时照着 S3 的纸脸（P9）与东侧后方的樟木箱（P10）。 */
export function lanternSide(s: StallSlot): 1 | -1 {
  return s.row === 'n' ? -1 : 1;
}

/** 摊位灯笼（每摊一盏，挑在摊主身侧、脸的高度，往过道探出一点）：一排灯笼照着一排纸脸。 */
export function lanternAt(s: StallSlot): V3 {
  const dz = s.row === 'n' ? 0.42 : -0.42;
  return [s.pos[0] + 0.5 * lanternSide(s), 1.52, s.pos[2] + dz];
}
