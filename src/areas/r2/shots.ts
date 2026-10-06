// owner: R2
// R2 的截图机位（ARCH §12.5）：门厅远景、取景器里的湿脚印与残影点、护送中的王奶奶、楼梯井与“停用”电梯、三楼空灯座、
// 五楼 502 门与门神、两段回放（2018 贴门神、2008 门厅）、丑时（王奶奶已走）。时辰差异用 preset。
// 声控灯只由快门点亮 20 秒（临时状态 lamp_lit_<n>）：M3 起用 ShotDef.temp 摆出灯亮着的楼道（shot.r2.lobby_lit、shot.r2.f3_lit，
// docs/requests/r2.md #2）；其余机位灯灭着，靠窗外/门外的钠灯取高光。M4 第 2 轮：窗外钠灯只剩灯芯烧白，几个只有窗子的机位
// 高光阈值按实测放低（highlight）；shot.r2.f2_under_lamp 是“站在灯下，摄像头脑袋不烧白”的回归机位。

import type { ShotDef } from '../../core/area';
import { F, RP, SEG } from '../../data/ids';

const escort = (n: number) => ({ flags: { [F.R1_MISSION_GIVEN]: true, [F.R1_ABILITY_REPLAY]: true, [F.R2_LOBBY_LAMP_LIT]: true, [F.R2_WANG_MET]: true, [F.R2_WANG_ESCORT]: true, [F.R2_WANG_FLOOR]: n } });

export const SHOTS: readonly ShotDef[] = [
  {
    id: 'shot.r2.lobby_door', label: '子时·门厅：单元门外雨夜里的钠灯、捐款榜、自行车、电表箱、墙上的小广告（灯灭着，0.12 环境光保底）',
    preset: 'zi', view: { player: [0.0, 2.0], yaw: 160, pitch: -10, floor: 1, mode: 'tp' }, keys: ['r2.donation_board'],
  },
  {
    id: 'shot.r2.lobby_vf', label: '子时·取景器：从楼梯口望单元门——湿脚印一路从雨里走进门厅，门厅中间一团雪花（残影点）',
    preset: 'zi', view: { player: [0.25, 0.55], yaw: 182, pitch: -13, floor: 1, mode: 'vf', zoom: 1 }, ui: true,
  },
  {
    id: 'shot.r2.wang_f2', label: '子时·取景器：护送到二楼，王奶奶站在楼梯口旁；南窗外院子里的钠灯，墙上一撮一撮的小广告',
    // 她只在二楼灯亮着时才上来：灯亮着（M4 第 2 轮：南窗外的钠灯不再烧成半扇窗的光盘，画面的高光改靠灯泡）
    preset: escort(2), temp: { lamp_lit_2: true }, view: { player: [-3.6, 0.35], yaw: 108, pitch: -2, floor: 2, mode: 'vf', zoom: 1 }, ui: true, keys: ['npc.wang'],
    // M4 第 2 轮：窗外钠灯只剩灯芯烧白（不再是半扇窗的光盘），本机位的高光只有那一小块灯芯/灯泡：阈值按实测放低
    highlight: 0.75,
  },
  {
    id: 'shot.r2.stairwell', label: '子时·二楼楼梯口：上跑尽头“停用”的电梯门，楼梯井里往下看得见下半层平台高窗外的钠灯，井壁上一路盖上去的红章',
    preset: escort(1), view: { player: [0.45, 1.3], yaw: 358, pitch: -4, floor: 2, mode: 'vf', zoom: 1 }, keys: ['r2.elevator'],
    // M4 第 2 轮：窗外钠灯只剩灯芯烧白（不再是半扇窗的光盘），本机位的高光只有那一小块灯芯/灯泡：阈值按实测放低
    highlight: 0.44,
  },
  {
    id: 'shot.r2.f2_south', label: '子时·二楼走廊往西看：南窗外院子的钠灯、202 的春联与腌菜坛、消防栓箱、喷在墙上的电话',
    preset: escort(1), view: { player: [3.5, 0.6], yaw: 254, pitch: 2, floor: 2, mode: 'vf', zoom: 1 },
    // M4 第 2 轮：窗外钠灯只剩灯芯烧白（不再是半扇窗的光盘），本机位的高光只有那一小块灯芯/灯泡：阈值按实测放低
    highlight: 0.44,
  },
  {
    id: 'shot.r2.f3_socket', label: '子时·三楼：顶棚上的空灯座、纸箱、童车、“楼道禁止堆放杂物”、南窗',
    preset: escort(2), view: { player: [1.4, 0.4], yaw: 228, pitch: 7, floor: 3, mode: 'vf', zoom: 1 }, keys: ['r2.lamp_socket_3f'],
  },
  {
    id: 'shot.r2.f5_door', label: '子时·取景器 2×：从五楼走廊东头望 502，门神描金发光（左边那张歪），王奶奶在门旁，门口一团残影；西头小窗外的钠灯、晾着的衣服',
    preset: escort(5), view: { player: [2.3, 0.35], yaw: 259, pitch: -2, floor: 5, mode: 'vf', zoom: 2 }, ui: true, keys: ['r2.menshen', 'npc.wang'],
    // M4 第 2 轮：窗外钠灯只剩灯芯烧白（不再是半扇窗的光盘），本机位的高光只有那一小块灯芯/灯泡：阈值按实测放低
    highlight: 0.6,
  },
  {
    id: 'shot.r2.replay_2018', label: '回放 2018-02-16 10:21：建国贴完门神，王奶奶站在门边嫌歪（第 12 秒；上午的天光从西头小窗进来）',
    preset: escort(5), view: { player: [-1.8, 0.45], yaw: 250, pitch: -3, floor: 5, mode: 'vf', zoom: 1, replay: { point: RP.R2_DOOR, seg: SEG.DOOR_2018, t: 12 } }, ui: true,
  },
  {
    id: 'shot.r2.replay_2008', label: '回放 2008-08-08 20:05：街坊挤在门厅看小电视里的开幕式（旧照四；那年门厅灯是好的）',
    preset: 'zi', view: { player: [1.6, 3.9], yaw: 314, pitch: 3, floor: 1, mode: 'vf', zoom: 1, replay: { point: RP.R2_LOBBY, seg: SEG.LOBBY_2008, t: 10 } }, ui: true,
    // M4 第 2 轮：窗外钠灯只剩灯芯烧白（不再是半扇窗的光盘），本机位的高光只有那一小块灯芯/灯泡：阈值按实测放低
    highlight: 0.76,
  },
  {
    id: 'shot.r2.f4_chou', label: '丑时·四楼：王奶奶已走；401 还住着人，门缝里漏出电视的光；南窗的钠灯',
    preset: 'chou', view: { player: [-2.0, 1.25], yaw: 106, pitch: 2, floor: 4, mode: 'vf', zoom: 1 },
  },
  {
    // M3：ShotDef.temp 摆出声控灯亮着的门厅（“声控灯亮起的那一下”是本区的主画面）
    id: 'shot.r2.lobby_lit', label: '子时·门厅声控灯亮着：昏黄的一圈光里，信报箱、捐款榜、电表箱、墙上的小广告都认得出来',
    preset: 'zi', temp: { lamp_lit_1: true }, view: { player: [0.0, 2.0], yaw: 160, pitch: -10, floor: 1, mode: 'tp' }, keys: ['r2.donation_board'],
  },
  {
    id: 'shot.r2.f3_lit', label: '子时·三楼灯座装上灯泡、声控灯亮着：纸箱、童车、“楼道禁止堆放杂物”',
    preset: { flags: { ...escort(3).flags, [F.R2_BULB_INSTALLED]: true } }, temp: { lamp_lit_3: true },
    // M4 第 2 轮：南窗外的钠灯只剩灯芯烧白（不再是半扇窗的光盘），镜头抬高一点把装上的灯泡也框进来（高光靠它）
    view: { player: [1.4, 0.4], yaw: 236, pitch: 3, floor: 3, mode: 'vf', zoom: 1 },
  },
  {
    // M4 第 2 轮：主角就站在声控灯正下方（护送时最常站的位置）——摄像头脑袋不该烧成一块白，顶棚上不该有一大片白斑
    id: 'shot.r2.f2_under_lamp', label: '子时·二楼声控灯正下方（第三人称）：灯亮着，摄像头脑袋的外壳、铁皮帽认得出来，顶棚只有灯座一圈光晕',
    preset: escort(2), temp: { lamp_lit_2: true }, view: { player: [0.1, 1.25], yaw: 262, pitch: -6, floor: 2, mode: 'tp' },
    // 画面里的亮点只有灯泡与南窗外的钠灯芯（都不大）：> 0.8 的像素在 0.3% 上下，阈值放到 0.65
    highlight: 0.65,
  },
];
