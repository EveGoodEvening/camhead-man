// owner: R4
// R4 的截图机位（ARCH §12.5：入口远景、主要地标、每个谜题的关键位置、取景器、红外、回放、各时辰）。

import type { ShotDef } from '../../core/area';
import { IT, PH, RP, SEG } from '../../data/ids';

/** 丑时（r4_start）的核心 flags + 开市；用对象形式的 preset 时要写全推导时辰所需的 flags。 */
const CHOU = {
  'r1.log_taken': true, 'r1.gate_lamp_on': true, 'r1.met_tudi': true, 'r1.ability_replay': true, 'r1.p1_done': true, 'r1.mission_given': true,
  'r1.drawer_open': true, 'r1.gate_unchained': true, 'r2.wang_done': true, 'r2.ability_ir': true, 'r3.saw_true_form': true,
} as const;
const MARKET = { ...CHOU, 'r4.ghost_market_open': true } as const;
const FOUND = { ...MARKET, 'r4.spotted_huang': true, 'r4.found_huang': true } as const;
const ADMITS = { ...FOUND, 'r4.asked_tape': true, 'r4.huang_admits': true } as const;

// 自由机位（cam）只隐藏玩家的身子，摄像头脑袋与视频线照样渲染（docs/requests/r4.md #4）：机位一律不把出生点 (-17,0,0.5) 的头框进去。
export const SHOTS: readonly ShotDef[] = [
  {
    id: 'shot.r4.entry_zi', label: '子时·楼梯口望向东：空通道、一闪一闪的灯管、褪色壁画、关着的报刊亭、东头的围挡',
    preset: 'zi', view: { player: [-16.6, 0.9], yaw: 92, pitch: 2, mode: 'tp' }, keys: ['r4.kiosk'],
    // （M4 整合曾因“> 0.8 的像素贴着 0.5%”放到 highlight 0.7；第 2 轮的亮核判据（模糊后 P99.5）实测 0.86，撤掉）
  },
  {
    id: 'shot.r4.hoarding_zi', label: '子时·东头地铁施工围挡与黄闪灯',
    preset: 'zi', view: { cam: { pos: [9.5, 1.65, -0.9], target: [19.5, 1.2, 0.6], fov: 55 } },
  },
  {
    id: 'shot.r4.boy_chou', label: '丑时（未开市）·楼梯口的纸扎门童，提着写字的白灯笼；规矩牌挂出来了',
    preset: 'chou', view: { cam: { pos: [-16.6, 1.45, 0.3], target: [-15.5, 0.9, -1.5], fov: 62 } }, keys: ['npc.boy', 'r4.rules_board'],
  },
  {
    id: 'shot.r4.rules_close', label: '丑时·规矩牌与门童的灯笼同框（蹲在门童身边看）：鬼市规矩原文（doc.market_rules）两处都读得清',
    preset: 'chou', view: { cam: { pos: [-15.0, 1.1, -0.2], target: [-17.02, 1.1, -2.42], fov: 50 } }, keys: ['r4.rules_board'],
  },
  {
    id: 'shot.r4.market_wide', label: '开市·从西头望鬼市：灯笼阵、两排纸人摊主、飘着的影子、偏绿的雾',
    preset: { flags: MARKET, items: [IT.MONEY] }, view: { cam: { pos: [-16.8, 1.75, 0.35], target: [6, 1.25, 0], fov: 55 } },
  },
  {
    id: 'shot.r4.market_east', label: '开市·从东头往回望：南排 S3 黄三爷（与别的纸人一模一样）、樟木箱、楼梯口',
    preset: { flags: MARKET, items: [IT.MONEY] }, view: { cam: { pos: [16.6, 1.7, -0.3], target: [-6, 1.3, 0.5], fov: 55 } },
    keys: ['npc.huang', 'r4.camphor_chest'],
  },
  {
    id: 'shot.r4.stall_close', label: '开市·摊位细节：N3 的老照片摊（相框、散照片、价签）、灯笼上的字、纸人摊主画上去的脸',
    preset: { flags: MARKET, items: [IT.MONEY] }, view: { cam: { pos: [1.7, 1.55, 0.25], target: [0.2, 0.85, -1.7], fov: 50 } },
    keys: ['r4.stall_n3'],
  },
  {
    id: 'shot.r4.huang_vf4', label: 'P9·取景器 4×：S3 的纸面具，嘴那块洇湿了（高清脸贴图，一鼓一瘪）',
    preset: { flags: MARKET, items: [IT.MONEY] }, view: { player: [3, 0.3], yaw: 180, pitch: -16, mode: 'vf', zoom: 4 }, ui: true,
  },
  {
    id: 'shot.r4.weasel_vf', label: 'P9 之后·取景器常光：揭了面具，是一只人立的黄鼠狼',
    preset: { flags: FOUND, items: [IT.MONEY] }, view: { player: [2.7, 0.1], yaw: 172, pitch: -9, mode: 'vf', zoom: 1 }, ui: true,
    keys: ['npc.huang'],
  },
  {
    id: 'shot.r4.replay_stall', label: 'P10·回放 seg.stall_2023 第 14 秒：黄三爷把带子塞进樟木箱',
    preset: { flags: FOUND, items: [IT.MONEY], photos: [PH.TRUE_FORM] },
    view: { player: [3.8, 0.2], yaw: 170, pitch: -24, mode: 'vf', zoom: 1, replay: { point: RP.R4_STALL, seg: SEG.STALL_2023, t: 14 } }, ui: true,
  },
  {
    id: 'shot.r4.huang_ir', label: 'P11·红外：全场只有黄三爷一个暖色（灯笼是阴火，纸人 6℃）',
    preset: { flags: ADMITS, items: [IT.MONEY], photos: [PH.HUANG_HIDES] },
    view: { player: [3, 0.6], yaw: 180, pitch: -13, mode: 'vf', lens: 'ir', zoom: 1 }, ui: true, brightness: [0.05, 0.6],
  },
  {
    id: 'shot.r4.replay_mid', label: '旧照六·回放 seg.mid_1997 第 9 秒：地下通道开通剪彩，摊子底下一双黄鼠狼的眼睛',
    preset: { flags: MARKET, items: [IT.MONEY] },
    view: { player: [-8.4, -0.3], yaw: 96, pitch: -3, mode: 'vf', zoom: 1, replay: { point: RP.R4_MID, seg: SEG.MID_1997, t: 9 } }, ui: true,
  },
  {
    id: 'shot.r4.yin', label: '寅时·鬼市照常营业，灯笼亮着（方便回来拍旧照六）',
    preset: 'yin', view: { player: [-4.5, -0.2], yaw: 96, pitch: 1, mode: 'tp' },
  },
];
