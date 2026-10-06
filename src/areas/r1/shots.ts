// owner: R1-world
// R1 的截图机位（ARCH §12.5：入口远景、主要地标、各谜题关键位置、取景器、红外、回放、各时辰）。
// 每个机位都框进至少一个灯芯、亮窗、灯箱或发光的东西（shots.mjs 要求亮度 > 0.8 的像素 ≥ 0.5%）。
// 门卫室里一律用第三人称/取景器机位：自由机位只藏身子、不藏头，椅子（出生点）上会悬着一颗摄像头脑袋（docs/requests/r1-world.md #4）。

import type { ShotDef } from '../../core/area';
import { F, NPC, OBJ, RP, SEG } from '../../data/ids';

const LAMP = { [F.R1_GATE_LAMP_ON]: true };
const LOG_LAMP = { [F.R1_LOG_TAKEN]: true, [F.R1_GATE_LAMP_ON]: true };

export const SHOTS: readonly ShotDef[] = [
  {
    id: 'shot.r1.entrance', label: '子时·院门里望出去：铁链锁着的院门、门灯、门楣“出入平安”，院外人行道的两盏路灯与对面楼上的亮窗', preset: { flags: LOG_LAMP },
    view: { cam: { pos: [0.9, 1.6, 18.5], target: [0.4, 2.75, 30], fov: 60 } },
    keys: [OBJ.R1_GATE_LAMP],
  },
  {
    id: 'shot.r1.tree', label: '子时开局·钠灯①下的石桌与跳房子粉笔，古槐（树冠压顶）、树下土地庙旁自己飘着的红灯笼、一号楼的亮窗',
    view: { cam: { pos: [-12.6, 1.55, 4.4], target: [-6.2, 4.6, -2.6], fov: 66 } },
  },
  {
    id: 'shot.r1.booth_outside', label: '子时·门卫室外：门楣上的空支架与断线头、门口台阶与痰盂、传达室灯箱、屋里 CRT 的绿光和发光的巡夜本', preset: { flags: LAMP },
    view: { cam: { pos: [-2.2, 1.7, 18.0], target: [-5.3, 2.0, 20.6], fov: 56 } },
    keys: [OBJ.R1_BRACKET],
  },
  {
    id: 'shot.r1.booth_inside', label: '开场·门卫室里（取景器，东北角望西南）：桌上发光的巡夜本、CRT、录像机、椅子、录像带架、西墙上的注意事项',
    view: { player: [-5.62, 19.2], yaw: 212, pitch: -18, mode: 'vf', zoom: 1 }, ui: true,
    keys: [OBJ.R1_LOG, OBJ.R1_CRT],
    // （M4 整合曾因“> 0.8 的像素在 0.50% 上下跳”放到 highlight 0.7；第 2 轮的亮核判据（模糊后 P99.5）实测 0.78，撤掉）
  },
  {
    id: 'shot.r1.drawer_vf', label: 'P2·取景器低头看桌子：抽屉上的四位转轮锁、发光的巡夜本、CRT 与录像机',
    view: { player: [-6.5, 20.35], yaw: 180, pitch: -40, mode: 'vf', zoom: 1 }, ui: true,
    keys: [OBJ.R1_DRAWER],
  },
  {
    id: 'shot.r1.switch_vf', label: 'P1·取景器 2× 读电闸贴条：老周的字在取景器里显出来（①车棚 ②公告栏 ③门灯 ④槐树）', preset: { flags: { [F.R1_LOG_TAKEN]: true } },
    view: { player: [-7, 19.47], yaw: 0, pitch: -21, mode: 'vf', zoom: 2 }, ui: true,
  },
  {
    id: 'shot.r1.tudi_vf', label: 'P1·取景器里的土地（马扎、枣木拐杖、红灯笼，土地金描边）', preset: { flags: LOG_LAMP },
    // M4 第 2 轮：挪到他正前方（他坐着朝 200°，原机位在他右前 35°，脸侧着），脸、白胡子、灰袍都朝着镜头
    view: { player: [1.7, 4.3], yaw: 17, pitch: -13, mode: 'vf', zoom: 1 }, ui: true,
    keys: [NPC.TUDI],
    // M4 第 2 轮：灯笼不再是一团烧白的红光（原来整屏被它淹没），画面里的高光只剩三号楼的一扇亮窗与灯笼芯；夜里树下本来就暗
    brightness: [0.03, 0.35],
    highlight: 0.6,
  },
  {
    id: 'shot.r1.replay_gate', label: 'P1·回放 seg.gate_2026 第 7 秒：陆师傅站在门卫室东窗外，抬头看门楣上的空支架（门口是门岗那团雪花）',
    preset: { flags: { ...LOG_LAMP, [F.R1_MET_TUDI]: true, [F.R1_ABILITY_REPLAY]: true } },
    view: { player: [1.0, 20.5], yaw: 262, pitch: 2, mode: 'vf', zoom: 1, replay: { point: RP.R1_GATE, seg: SEG.GATE_2026, t: 7 } }, ui: true,
  },
  {
    id: 'shot.r1.old1_replay', label: '旧照一·回放 seg.tree_1984 第 10 秒：槐下大合影', preset: 'zi',
    view: { player: [0, -2.5], yaw: 0, pitch: -4, mode: 'vf', zoom: 1, replay: { point: RP.R1_TREE, seg: SEG.TREE_1984, t: 10 } }, ui: true,
  },
  {
    id: 'shot.r1.ir_chair', label: '红外·椅子上一块人形的凉（冷迹 3℃）、暖壶 50℃、CRT 42℃', preset: { flags: { ...LOG_LAMP, [F.R2_ABILITY_IR]: true } },
    view: { player: [-6.3, 19.1], yaw: 172, pitch: -20, mode: 'vf', lens: 'ir', zoom: 1 }, ui: true, brightness: [0.05, 0.6],
  },
  {
    id: 'shot.r1.chou', label: '丑时·取景器里：陆师傅站在门卫室西北角（门洞里），传达室灯箱亮着', preset: 'chou',
    view: { player: [-2.0, 20.6], yaw: 259.5, pitch: -3, mode: 'vf', zoom: 1 }, ui: true,
  },
  {
    id: 'shot.r1.yin', label: '寅时·雨停了，雾薄了：钠灯②下的积水，古槐与树下的红灯笼，远处三号楼的楼影', preset: 'yin',
    view: { cam: { pos: [12.5, 1.65, 12.2], target: [7.36, 4.07, 3.97], fov: 64 } },
  },
  {
    id: 'shot.r1.mao', label: '卯时·黎明色调：院门、门卫室、天边发白', preset: 'mao',
    view: { cam: { pos: [6.5, 1.8, 16.5], target: [-3.5, 2.4, 22.5], fov: 62 } },
    // 天亮了比夜景亮是本意（M4：卯时半球光、曝光与湿地面映的天光都提上去了，均值约 0.34，贴着默认上限 0.35；同 shot.r1.fin_epilogue）
    brightness: [0.05, 0.45],
  },
];
