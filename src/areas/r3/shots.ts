// owner: R3
// R3 的截图机位（ARCH §12.5：入口远景、主要地标、每个谜题的关键位置、取景器、红外、回放、时辰差异）。
// 暗房红灯是区域临时状态 safelight：M3 起用 ShotDef.temp 摆出来（shot.r3.darkroom_red），单红通道画面的高光阈值用 ShotDef.highlight
// （docs/requests/r3.md #4）；scripts/regions/r3.mjs 另在真实流程里拉灯绳后截图验收（test-artifacts/r3/darkroom_red.png）。

import type { ShotDef } from '../../core/area';
import { F, IT, OBJ, PH, RP, SEG } from '../../data/ids';

const DOOR_OPEN = { flags: { [F.R1_MISSION_GIVEN]: true, [F.R1_ABILITY_REPLAY]: true, [F.R1_GATE_UNCHAINED]: true, [F.R3_LU_DOOR_OPEN]: true }, items: [IT.SLIP_0473] };
const HUNG = {
  flags: { ...DOOR_OPEN.flags, [F.R3_GOT_ENVELOPE]: true, [F.R3_FILM_HUNG]: true },
  items: [IT.SLIP_0473, IT.FILM], photos: [PH.COVERED_FACE],
};

export const SHOTS: readonly ShotDef[] = [
  {
    id: 'shot.r3.street_west', label: '子时·老街西口远景（雨、钠灯、梧桐、一排关着门的铺面，远处红霓虹“长明照相馆”）',
    preset: 'zi', view: { player: [-18.4, 5.0], yaw: 96, pitch: 7, mode: 'tp' }, keys: ['r3:neon'],
  },
  {
    id: 'shot.r3.facade', label: '子时·照相馆门脸（“馆”字不亮的霓虹、玻璃门、样片橱窗、门铃、“取件请按铃”）',
    preset: 'zi', view: { cam: { pos: [3.4, 1.65, 6.4], target: [-0.3, 2.0, -0.4], fov: 50 } }, keys: ['r3:neon', OBJ.R3_BELL],
  },
  {
    id: 'shot.r3.glass_vf', label: 'P6·取景器隔着玻璃门看见柜台后的陆师傅（阴物）',
    preset: 'zi', view: { player: [0.1, 2.1], yaw: 0, pitch: 2, mode: 'vf', zoom: 1 }, ui: true,
  },
  {
    id: 'shot.r3.grid_2x', label: 'P6·取景器 2×：西墙取件格，每格印着两位编号（左上角 00；顶上“取件处”灯箱）',
    preset: DOOR_OPEN, view: { player: [0.9, -2.3], yaw: 266, pitch: 10, mode: 'vf', zoom: 2 }, ui: true,
  },
  {
    id: 'shot.r3.hall', label: '前厅（柜台、钨丝吊灯、老照片墙、价目表、取件格）',
    preset: DOOR_OPEN, view: { cam: { pos: [2.55, 1.95, -0.8], target: [-1.8, 1.3, -3.6], fov: 62 } },
  },
  {
    id: 'shot.r3.studio', label: '影棚（背景布、大座机、坐凳、画架、墙钩上的双反、暗房门）',
    preset: DOOR_OPEN, view: { cam: { pos: [2.55, 1.9, -5.45], target: [-1.2, 1.05, -9.9], fov: 64 } },
  },
  {
    id: 'shot.r3.darkroom', label: 'P7·暗房白灯：工作台上的方盘（黄）、深盆（红双喜）、豁口盘（白）、水池、晾片绳',
    preset: DOOR_OPEN, view: { cam: { pos: [-0.3, 2.05, -11.3], target: [-1.9, 1.15, -13.3], fov: 64 } },
  },
  {
    id: 'shot.r3.film_vf', label: 'P7·取景器 2×：晾片绳上的底片——伙计的眼睛看到的是正片，第三格老周给摄像头扣铁皮帽子',
    preset: HUNG, view: { player: [-1.5, -12.9], yaw: 180, pitch: -12, mode: 'vf', zoom: 2 }, ui: true,
  },
  {
    id: 'shot.r3.replay_1990', label: '旧照五·回放 1990-05-01：陆师傅在自己影棚里成婚（第 12 秒，徒弟刚捏过镁光，两句字幕之间）',
    preset: DOOR_OPEN, view: { player: [-1.0, -6.4], yaw: 24, pitch: -3, mode: 'vf', zoom: 1, replay: { point: RP.R3_STUDIO, seg: SEG.STUDIO_1990, t: 12 } }, ui: true,
  },
  {
    id: 'shot.r3.cold_ir', label: '红外·照相馆玻璃门外凉了一块（冷迹 3℃；霓虹 60℃）',
    preset: { flags: { ...DOOR_OPEN.flags, [F.R2_ABILITY_IR]: true } }, view: { player: [0.9, 5.0], yaw: 356, pitch: -4, mode: 'vf', lens: 'ir', zoom: 1 }, ui: true,
    brightness: [0.05, 0.6],
  },
  {
    id: 'shot.r3.easel_ir', label: '红外·画架上的遗像：铅笔稿都起好了，唯独脸那一块是空白（左上影棚灯罩 55℃）',
    preset: { flags: { ...DOOR_OPEN.flags, [F.R2_ABILITY_IR]: true } }, view: { player: [0.2, -5.45], yaw: 30, pitch: -5, mode: 'vf', lens: 'ir', zoom: 1 }, ui: true,
    brightness: [0.05, 0.6],
  },
  {
    id: 'shot.r3.street_chou', label: '丑时·本相之后：霓虹熄了，陆师傅不在馆里，门还开着',
    preset: 'chou', view: { player: [2.4, 3.3], yaw: 302, pitch: 9, mode: 'tp' },
  },
  {
    // M3：ShotDef.temp 摆出红灯；画面压成单红通道（sRGB 亮度上限约 0.21）。红灯泡在头顶正上方、框不进画，
    // 单红通道里没有“高光”可言：highlight: false，平均亮度区间放宽（单红通道本身由 regions/r3.mjs 的真实流程断言 G/B ≈ 0）
    id: 'shot.r3.darkroom_red', label: 'P7·暗房红灯（取景器）：画面压成单红通道——门背后的守则、晾片绳上的底片夹、架子上的药瓶都只剩红与黑',
    preset: HUNG, temp: { safelight: true }, view: { player: [-1.5, -12.9], yaw: 205, pitch: 2, mode: 'vf', zoom: 1 },
    highlight: false, brightness: [0.01, 0.3],
  },
];
