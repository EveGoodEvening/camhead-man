// owner: R2
// R2 三号楼一单元的坐标常量（GDD §4.2；原点在一楼门厅地面，+x 东、-z 北，第 n 层走廊地面 y = 2.8(n-1)）。
// 每层是一段相同的走廊 x:-5~5、z:0~2.5；楼梯井 x:-1.5~1.5、z:-4.6~0 只作布景（GDD 写 z:-6~0，这里平台北墙收在 -4.6，
// 从走廊看得见平台上的“停用”电梯门）；一楼另有门厅 z:2.5~5，单元门 (0,0,5)；五楼 502 门 (-5,11.2,1.2)。

import type { V3, XZ } from '../../core/types';
import type { StateView } from '../../game/state';

export const FLOORS = 5;
export const FLOOR_H = 2.8;
/** 第 n 层（1–5）走廊地面高度 */
export const levelY = (n: number): number => FLOOR_H * (n - 1);
/** 走廊顶棚（离本层地面） */
export const CEIL = 2.65;

/** 当前楼层（区域临时状态 floor，楼层节点 onChange 时写；缺省 1） */
export function floorOf(s: StateView): number {
  const f = s.temp('floor');
  return typeof f === 'number' && f >= 1 ? f : 1;
}

export const R2 = {
  corridor: { x0: -5, x1: 5, z0: 0, z1: 2.5 },
  lobby: { x0: -5, x1: 5, z0: 2.5, z1: 5 },
  well: { x0: -1.5, x1: 1.5, z0: -4.6, z1: 0 },
  /** 楼梯：每跑 9 级，级高 0.1556、级深 0.3，从 z=-0.25 往北到 z=-2.95；平台 z:-4.6~-2.95 */
  stair: { steps: 9, rise: 1.4 / 9, run: 0.3, z0: -0.25, landingZ: -2.95 },
  /** 声控灯（每层一盏，GDD §4.2）：(0, y+2.6, 1.2) */
  lamp: (n: number): V3 => [0, levelY(n) + 2.6, 1.2],
  /** 户门：n02 在西端 x=-5，n01 在东端 x=5（门洞底边中点） */
  doorW: (n: number): V3 => [-5, levelY(n), 1.2],
  doorE: (n: number): V3 => [5, levelY(n), 1.2],
  unitDoor: [0, 0, 5] as V3,
  /** 楼梯口触发体中心（走进即换层，GDD §4.2）：上楼 (-0.8,y,-0.4)（五楼没有）、下楼 (0.8,y,-0.4)（一楼没有） */
  upTrigger: (n: number): V3 => [-0.8, levelY(n), -0.4],
  downTrigger: (n: number): V3 => [0.8, levelY(n), -0.4],
  /** 楼梯井交互物锚点（按层现算；在楼梯口挡块面 z=-0.25 之前、栏杆扶手右上方，视线检查与准星都不被栏杆挡住） */
  stairsAnchor: (n: number): V3 => [0.3, levelY(n) + 1.3, -0.15],
  /**
   * 半层平台北墙：西半是加装电梯的门（从走廊顺着上跑一眼看得见），东半高处一扇窗（东半下面被往上一层的那跑楼梯挡着，
   * 窗开在平台上方 1.5–2.5m，从走廊越过那跑楼梯看得见窗外的钠灯）。
   */
  windowX: 0.74,
  /** 五楼走廊西头、502 门边的小南窗（中心 x） */
  westWindowX: -4.15,
  elevatorX: -0.74,
  /** 电梯门（上半层平台北墙西半） */
  elevator: (n: number): V3 => [-0.74, levelY(n) + 1.4 + 1.05, -4.55],
  mailboxes: [-4.93, 1.35, 3.75] as V3,
  donation: [4.8, 1.5, 3.8] as V3,
  /** 残影点 */
  rpLobby: [0, 0, 3.5] as V3,
  /**
   * 502 门口的残影点（M4 第 2 轮：GDD 原为 (-4,11.2,1.2)，往东挪到 x=-2）：在旋涡跟前按 R，镜头转向门神（片段的 focus）时
   * 离门 2–3m——2018 年贴门神那段王奶奶（门北侧）、门神和建国都框得进一个画面；原来离门只有 1m，人影贴着镜头、门神只进来半张。
   * 不放在 -2.6：GDD §11 步骤 20 在 (-2.8,1.2) 和门神说完话就地倒带，离旋涡不到 0.8m 时镜头低头也对不准旋涡上方（按不了 R）。
   */
  rpDoor: [-2.0, levelY(5), 1.2] as V3,
  /** 王奶奶的站位（GDD §4.2） */
  wangSeat: [0.8, 0, -0.5] as V3,
  wangMid: (n: number): V3 => [1.8, levelY(n), 0.9],
  wangDoor: [-3.8, levelY(5), 0.8] as V3,
  /** 502 门口的门神（门扇外面，两张并排；左边那张歪约 8°） */
  menshenCenter: [-4.955, levelY(5) + 1.36, 1.2] as V3,
  /** 出生点离触发体检查用（GDD §13.2） */
  spawnXZ: [0, 1.8] as XZ,
} as const;

/** 声控灯亮着的秒数（GDD §3.3 M2） */
export const LAMP_SEC = 20;
/** 快门能点亮的距离（GDD §3.3 M2） */
export const LAMP_RANGE = 5;
