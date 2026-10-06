// owner: R2
// R2_502 王奶奶家的坐标（GDD §4.3；原点在入户门内，+x 东、-z 北）：客厅 x:0~5、厨房 x:5~7.5、z:-4~0；入户门在客厅西墙，
// 门洞中心 (0,0,-0.8)。灶台砌筑块 x:6.6~7.5、z:-2.3~-0.7、高 0.8，正面（朝西）贴白瓷砖；灶君纸像在灶台上方东墙。
// 卧室（只剩床架，布景）在客厅北边，经北墙的门洞进去。

import type { V3 } from '../../core/types';

export const H = 2.75;   // 层高（顶棚）

export const L502 = {
  living: { x0: 0, x1: 5, z0: -4, z1: 0 },
  kitchen: { x0: 5, x1: 7.5, z0: -4, z1: 0 },
  bedroom: { x0: 0, x1: 3.4, z0: -7, z1: -4 },
  /**
   * 客厅—厨房隔墙 x=5 上的门洞（M4 第 2 轮：高 2.1 → 2.4m）。站在灶台跟前低头时第三人称相机的吊臂从门洞上沿往后穿：
   * 2.1m 高的过梁把相机卡在墙里（吊臂最短 0.9m），准星的射线先打在过梁上，什么都选不中；2.4m 时吊臂从门洞里过去，
   * 相机停在客厅那侧顶棚底下，射线从过梁下面穿进厨房。
   */
  kitchenGap: { z0: -2.6, z1: -0.35, h: 2.4 },
  /** 客厅北墙上的卧室门洞 */
  bedroomGap: { x0: 0.9, x1: 1.9, h: 2.05 },
  /** 入户门洞（西墙 x=0） */
  entry: { z0: -1.25, z1: -0.35, h: 2.05 },
  counter: { x0: 6.6, x1: 7.5, z0: -2.3, z1: -0.7, h: 0.8 },
  zaojun: [7.45, 1.7, -1.5] as V3,
  tileLeftLow: [6.6, 0.25, -2.0] as V3,
  tileRightLow: [6.6, 0.25, -1.0] as V3,
  tileTop: [7.45, 1.25, -1.5] as V3,
  rpKitchen: [5.8, 0, -1.5] as V3,
  wang: [6.0, 0, -0.5] as V3,
  /** 读信时王奶奶面朝灶君纸像（yaw 度：0 = 北 -z、90 = 东 +x） */
  wangReadYaw: 58,
  /** 读信过场开场把伙计挪到厨房北头、面朝南边的灶台与窗（读信那几个机位都看不见他：CAM_KITCHEN 就在他身前；临别前再挪到 farewellPlayer） */
  cutPlayer: [6.0, 0, -3.55] as V3,
  cutPlayerYaw: 165,
  /** 临别那几句（M4 第 2 轮）：伙计在黑场里挪到她跟前 1.05m、面朝南看着她（过场完了他就站在这儿，面朝她化光飞出去的南窗） */
  farewellPlayer: [6.0, 0, -1.55] as V3,
  farewellPlayerYaw: 180,
  /** 挂历：客厅南墙、窗户与厨房隔墙之间（朝北） */
  calendar: [4.3, 1.62, -0.025] as V3,
  stoveFire: [7.05, 0.98, -1.5] as V3,
  /** 客厅南窗、厨房南窗、卧室北窗 */
  winLiving: { x0: 1.8, x1: 3.4, y0: 0.9, y1: 2.15 },
  winKitchen: { x0: 5.5, x1: 6.4, y0: 1.0, y1: 2.05 },
  winBed: { x0: 1.1, x1: 2.3, y0: 0.9, y1: 2.05 },
} as const;

/** 王奶奶（1.5m 高的人偶）眼睛的高度 */
export const WANG_EYE_Y = 1.38;

/** 按读信朝向 wangReadYaw，把她身上的局部偏移（往前 fwd、往右 right，米）换成世界坐标。 */
function readLocal(x: number, z: number, fwd: number, right: number, y: number): V3 {
  const a = (L502.wangReadYaw * Math.PI) / 180;
  const fx = Math.sin(a), fz = -Math.cos(a), rx = Math.cos(a), rz = Math.sin(a);
  return [x + fx * fwd + rx * right, y, z + fz * fwd + rz * right];
}

/**
 * 读信时信纸（中心）的位置：她右手捏着信的下沿（carry 姿势的右手在身前 0.25m、偏右 0.17m、高 1.04m），信举在手的上方——
 * 近景里前臂在信的下面，不挡“就是皮擀不圆”那一行。按她的站位 (x, z) 算。
 */
export function letterAt(x: number, z: number): V3 {
  return readLocal(x, z, 0.3, 0.12, 1.2);
}

/** 信的近景机位：她右肩外侧后上方，视线从右肩前头擦过去落在信上（不穿过她的头和肩）。 */
export function letterCamAt(x: number, z: number): V3 {
  return readLocal(x, z, -0.12, 0.46, 1.62);
}
