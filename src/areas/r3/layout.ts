// owner: R3
// R3 老街·长明照相馆的全部坐标（GDD §4.4、§13.2）。原点在照相馆门口；+x 东，-z 北；y 向上。
// 室内与两侧人行道的地面 y = 0（GDD 的高度都以它为准）；中间的柏油马路低 0.1m（路沿 ≤ STEP_MAX，走得上去）。

import type { V3, XZ } from '../../core/types';

/** 地面高度（AreaDef.groundY）。 */
export const GROUND = {
  street: -0.1,
  walk: 0,
  /** 北侧人行道 z ∈ [0, northWalkZ]；南侧人行道 z ∈ [southWalkZ, 10.6] */
  northWalkZ: 1.7,
  southWalkZ: 8.4,
} as const;

export function groundAt(_x: number, z: number): number {
  return z <= GROUND.northWalkZ || z >= GROUND.southWalkZ ? GROUND.walk : GROUND.street;
}

/** 街道范围（GDD：x -22~22，z 0~10）；碰撞外墙稍外一点。 */
export const STREET = { x0: -22, x1: 22, z0: 0, z1: 10, wallX0: -23.2, wallX1: 22.6, wallZ1: 10.9 } as const;

/** 北侧铺面（GDD §4.4），x 区间；facade 在 z = 0。 */
export const SHOPS = {
  watch: { x0: -18, x1: -12 },
  paper: { x0: -11, x1: -5 },
  studio: { x0: -3, x1: 3 },
  breakfast: { x0: 5, x1: 11 },
  store: { x0: 13, x1: 19 },
} as const;

/** 底层（铺面层）高度、二层窗户中心高。 */
export const FACADE = { groundH: 3.6, upperWinY: 5.05, topBase: 6.6 } as const;

/** 出生点与出入口（GDD §13.2）。 */
export const SPAWN_WEST: V3 = [-20.2, 0, 5];
export const EXIT_WEST: V3 = [-22, 1.25, 5];

/** 路灯（钠灯杆脚，灯臂朝北伸向马路；南侧人行道上）。 */
export const SODIUM_POLES: readonly V3[] = [[-8.5, 0, 9.35], [9.5, 0, 9.35]];

/** 梧桐（南侧人行道）。 */
export const PLANE_TREES: readonly XZ[] = [[-17.5, 9.5], [-2.5, 9.6], [5.2, 9.5], [21.2, 9.6]];

/** 公交站、邮筒（GDD §4.4）。 */
export const BUS_STOP: V3 = [17, 0, 9];
export const MAILBOX: V3 = [15, 0, 9];

// ———————————————————————————————— 照相馆（x -3~3）

/** 外墙厚度与内墙面。 */
export const SHOP = {
  x0: -3.35, x1: 3.35,
  /** 西墙内侧面（取件格正面就在这里） */
  inWest: -2.9,
  inEast: 2.9,
  back: -14.3,
  hallCeil: 3.2,
  studioCeil: 3.4,
  darkCeil: 2.75,
} as const;

/** 玻璃门（GDD：r3.shop_door (0,0)）：门洞 x -0.5~0.5。 */
export const DOOR = { at: [0, 0, 0] as V3, w: 1.0, h: 2.25 } as const;
/** 门铃（GDD）。 */
export const BELL: V3 = [0.8, 1.4, 0];
/** 冷迹（GDD）。 */
export const COLD_DOOR: V3 = [0.6, 0, 1.2];
/** 霓虹招牌中心（门楣上方，朝南）。 */
export const NEON_AT: V3 = [0, 3.25, 0.16];

/** 样片橱窗：门两侧，橱窗玻璃在 z=0，展板在 z=-0.42。 */
export const DISPLAY = { west: { x0: -2.85, x1: -0.72 }, east: { x0: 0.72, x1: 2.85 }, y0: 0.72, y1: 2.55, depth: 0.5 } as const;

/** 前厅柜台（GDD：z=-3）。 */
export const COUNTER = { x0: -1.55, x1: 2.9, z: -3, depth: 0.55, h: 1.0 } as const;
/** 陆师傅站位（GDD：柜台后 (0,-4)）；拿到新单子后站到大座机后面。 */
export const LU_COUNTER: V3 = [0, 0, -4];
export const LU_CAMERA: V3 = [0.15, 0, -5.8];

/** 取件格（GDD）：x = -2.9，10×10，每格 0.25；左上角 00，横着数到 99。 */
export const GRID = { x: -2.9, top: 2.9, z0: -1.5, cell: 0.25, n: 10 } as const;
/** 格 (r, c) 的中心（GDD 原式）。 */
export function holeCenter(n: number): V3 {
  const r = Math.floor(n / 10), c = n % 10;
  return [GRID.x, GRID.top - (r + 0.5) * GRID.cell, GRID.z0 - (c + 0.5) * GRID.cell];
}
/** 取件格整体中心（读字目标 rd.pickup_numbers）。 */
export const GRID_CENTER: V3 = [GRID.x, GRID.top - (GRID.n * GRID.cell) / 2, GRID.z0 - (GRID.n * GRID.cell) / 2];

/** 前厅与影棚之间的隔墙（z = -5），门洞在西侧（x -2.55~-1.35）挂布帘。 */
export const PARTITION = { z: -5, doorX0: -2.55, doorX1: -1.35, doorH: 2.2 } as const;

// ———————————————————————————————— 影棚（z -5~-11）

export const BIG_CAMERA: V3 = [0, 0, -6.5];
export const STOOL: V3 = [0, 0, -9.6];
export const EASEL: V3 = [2.3, 0, -7.5];
export const TLR: V3 = [-2.8, 1.6, -6];
/** 残影点（GDD）。 */
export const RP_STUDIO: V3 = [0, 0, -8.5];
/** 背景布（北墙，暗房门以东）。 */
export const BACKDROP = { x0: -0.85, x1: 2.85, z: -10.92, top: 3.25, bottom: 0 } as const;
/** 影棚钨丝灯（唯一的投影光，GDD §9.3）：灯泡位置，在坐凳右前上方。 */
export const STUDIO_LAMP: V3 = [0.85, 2.5, -8.55];

// ———————————————————————————————— 暗房（x -3~0，z -11~-14）

export const DARK = { x0: -2.9, x1: 0, z0: -11, z1: -14, doorX: -1.5, doorW: 0.86 } as const;
/** 门背后的守则（GDD）。 */
export const RULES: V3 = [-1.5, 1.5, -11.1];
/** 灯绳（GDD）。 */
export const LAMP_CORD: V3 = [-0.3, 1.8, -11.4];
/** 暗房的灯（GDD：红灯 (-1.5,2.3,-12.5)；白灯/红灯是同一盏）。 */
export const DARK_LAMP: V3 = [-1.5, 2.3, -12.5];
/** 北墙工作台（GDD：z = -13.6，台面高）。 */
export const BENCH = { z: -13.6, top: 0.86, x0: -2.9, x1: 0, depth: 0.7 } as const;
/** 三件容器与水池（GDD：从西往东）。 */
export const PLATE_CHIPPED: V3 = [-2.6, BENCH.top, BENCH.z];
export const TRAY_SQUARE: V3 = [-1.9, BENCH.top, BENCH.z];
export const BASIN_XI: V3 = [-1.2, BENCH.top, BENCH.z];
export const SINK: V3 = [-0.4, 0, BENCH.z];
/** 晾片绳（GDD：z=-12，高 1.9m，5 个夹子）。 */
export const DRYING = { x0: -2.55, x1: -0.45, y: 1.9, z: -12, clips: 5 } as const;
/** 底片挂在中间那个夹子上，正面朝北（玩家站在绳与工作台之间往南看）。 */
export const FILM_X = -1.5;
/** 底片每格边长与间距（120 胶卷的 6×6，略放大一点好认）。 */
export const FILM = { frame: 0.078, gap: 0.012, leader: 0.035, width: 0.094 } as const;
/** 第 i 格（1 起）的中心高度。 */
export function filmFrameY(i: number): number {
  return DRYING.y - 0.02 - FILM.leader - (i - 0.5) * FILM.frame - (i - 1) * FILM.gap;
}

/** 玩家/NPC 所在“屋里”的判定（雨停、室内声）。 */
export function insideShop(x: number, z: number): boolean {
  return x > SHOP.x0 && x < SHOP.x1 && z < -0.05 && z > SHOP.back;
}
export function insideDarkroom(x: number, z: number): boolean {
  return x > DARK.x0 - 0.1 && x < DARK.x1 + 0.1 && z < DARK.z0 - 0.05 && z > DARK.z1 - 0.1;
}
