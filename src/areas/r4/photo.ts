// owner: R4
// R4 的拍照目标（GDD §7.3 与 H 表）。读字目标 rd.huang_breath 要跟着黄三爷的嘴走（函数 at），在 logic.ts 的 build 里用 ctx.readTarget 登记。

import type { PhotoTargetDef } from '../../game/photo';
import { F, GHOST, NPC, OBJ, PT, SEG } from '../../data/ids';
import { TEXT } from './text';

/** 黄三爷的拍照锚点：站位上方 1.1m（胸口，高过摊桌上的货，从过道拍不会被桌上的东西挡住）。 */
const HUANG_ANCHOR = [0, 1.1, 0] as const;
/** pt.huang_hides：2023 年黄三爷蹲在箱子西边塞带子时的上身（人影根节点在脚下）。 */
const HIDES_GHOST_ANCHOR = [0, 0.7, 0] as const;
/** pt.huang_hides：樟木箱箱盖中心（箱身 0.42m + 盖 0.08m，kit/props.ts camphorChest）。 */
const HIDES_CHEST_ANCHOR = [0, 0.5, 0] as const;

export const PHOTO_TARGETS: readonly PhotoTargetDef[] = [
  {
    // 揭面具后常光拍到的是黄鼠狼（P11 的误导项）
    id: PT.HUANG_NORMAL,
    subjects: [{ ref: NPC.HUANG, anchor: HUANG_ANCHOR }],
    maxDist: 5, minZoom: 1, lens: 'normal', context: { kind: 'live' },
    when: F.R4_FOUND_HUANG,
  },
  {
    // P10：回放里黄三爷的影子与樟木箱同框（带子正被塞进箱子的第 10–18 秒）。
    // 锚点（M4 第 2 轮）：影子取蹲姿的上身（手里那盘带子的高度），箱子取箱盖中心——带子从这儿塞进去，俯拍时看得见的也是箱盖。
    // 缺省的包围盒中心分别在 0.5m、0.25m（拾取代理不渲染，不算进包围盒），从摊前俯拍时比画面里看见的东西低一截。
    id: PT.HUANG_HIDES,
    subjects: [{ ref: GHOST.HUANG_2023, anchor: HIDES_GHOST_ANCHOR }, { ref: OBJ.R4_CAMPHOR_CHEST, anchor: HIDES_CHEST_ANCHOR }],
    maxDist: 6, minZoom: 1, lens: 'normal',
    context: { kind: 'replay', segment: SEG.STALL_2023, t: [10, 18] },
    captions: { too_early: TEXT.cap.hidesEarly },
  },
  {
    // P11：红外 4m 内拍黄三爷（全场唯一的暖色）。M4 第 2 轮：揭了面具就拍得到（原先要等认账，认账前在红外里拍他会落到
    // pt.huang_normal 上，空镜标题“颜色不对”，教玩家“红外不对”，到 P11 反而不敢用）；进度仍由出示判定——认账前出示这张，
    // 他说“急啥？账还没算清呢。”（logic.ts showIr），不写 flag
    id: PT.HUANG_IR,
    subjects: [{ ref: NPC.HUANG, anchor: HUANG_ANCHOR }],
    maxDist: 4, minZoom: 1, lens: 'ir', context: { kind: 'live' },
    when: F.R4_FOUND_HUANG,
  },
  {
    // 旧照六：1997 年开通剪彩的街坊（H 表：回放、常光、maxDist 8、minZoom 1、时间窗 4–14）
    // 锚点（M4 第 2 轮）：头一、二排之间的人头高度（人群原点在第一排中间的地面，往后每排 +z；rigs/crowd.ts）。
    // 缺省的包围盒中心在腰下（头排是三个小孩），从残影点东边、贴着人堆按 R 时（转向的俯仰只到胸口高的焦点）一屏人脸也判成“没对准”
    id: PT.OLD_6,
    subjects: [{ ref: GHOST.CROWD_1997, anchor: [0, 1.35, 0.2] }],
    maxDist: 8, minZoom: 1, lens: 'normal',
    context: { kind: 'replay', segment: SEG.MID_1997, t: [4, 14] },
  },
];
