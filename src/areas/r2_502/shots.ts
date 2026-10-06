// owner: R2
// R2_502 的截图机位（ARCH §12.5）：进门看空客厅（灰印、挂历、月光）、厨房（王奶奶、灶君、三块新瓷砖）、取景器里的灶君（眼珠）、
// 瓷砖特写、回放 1986 包馄饨、丑时灶火长明、红外里的灶火、卧室床架。

import type { ShotDef } from '../../core/area';
import { F, IT, RP, SEG } from '../../data/ids';
import { CAM_502 } from './dialogue';

const IN_502 = {
  [F.R1_MISSION_GIVEN]: true, [F.R1_ABILITY_REPLAY]: true, [F.R2_LOBBY_LAMP_LIT]: true, [F.R2_WANG_MET]: true, [F.R2_WANG_ESCORT]: true,
  [F.R2_WANG_FLOOR]: 5, [F.R2_BULB_INSTALLED]: true, [F.R2_MENSHEN_OPEN]: true,
};

/** 读信过场里：flags 在出示信时已写，区域临时状态让她还在、灶火还没点、手上拿着信 */
const READING = { ...IN_502, [F.R2_TIN_OPENED]: true, [F.R2_WANG_DONE]: true, [F.R2_ABILITY_IR]: true };
const READING_TEMP = { farewell: true, fire_hold: true, reading: true };

export const SHOTS: readonly ShotDef[] = [
  {
    id: 'shot.r2_502.entry', label: '子时·进门：空客厅，月光在地上铺出窗格，照出家具搬走后的灰印；停在 2019 年 12 月的挂历，厨房门里灶前的王奶奶',
    preset: { flags: IN_502 }, view: { player: [0.6, -3.3], yaw: 125, pitch: -13, mode: 'vf', zoom: 1 }, keys: ['r2.calendar'],
    // （M4 整合曾因“> 0.8 的像素在 0.5% 上下跳”放到 highlight 0.7；第 2 轮的亮核判据（模糊后 P99.5）实测 0.77，撤掉）
  },
  {
    id: 'shot.r2_502.kitchen_vf', label: '子时·取景器：灶前的王奶奶、灶君纸像描金、三块新瓷砖',
    preset: { flags: IN_502 }, view: { player: [4.2, -2.3], yaw: 121, pitch: -6, mode: 'vf', zoom: 1 }, ui: true, keys: ['r2.zaojun', 'npc.wang'],
  },
  {
    id: 'shot.r2_502.zaojun_eyes', label: '取景器 4×：灶君纸像（灶王爷、灶王奶奶）的脸，眼白发亮，眼珠贴在左下眼角（P5 的线索：刚举起取景器的头 3 秒一直瞟着，之后每 5 秒瞟 2.5 秒）',
    preset: { flags: IN_502 }, view: { player: [5.75, -1.5], yaw: 90, pitch: -2.5, mode: 'vf', zoom: 4 }, ui: true,
  },
  {
    id: 'shot.r2_502.tiles', label: '子时·取景器从厨房门口看灶台：正面左下、右下与灶君底下三块颜色新的瓷砖，灶君纸像描金，灶前一团雪花（残影点），南窗月光下的王奶奶',
    preset: { flags: IN_502 }, view: { player: [4.3, -2.6], yaw: 132, pitch: -17, mode: 'vf', zoom: 1 }, keys: ['r2.tile_left_low', 'r2.tile_right_low', 'r2.tile_top'],
  },
  {
    id: 'shot.r2_502.replay_1986', label: '回放 1986-02-08：年轻的王奶奶教小建国包馄饨（旧照三）',
    preset: { flags: IN_502 }, view: { player: [4.4, -2.6], yaw: 128, pitch: -7, mode: 'vf', zoom: 1, replay: { point: RP.R2_KITCHEN, seg: SEG.KITCHEN_1986, t: 9 } }, ui: true,
  },
  {
    id: 'shot.r2_502.letter_read', label: '读信过场近景：从王奶奶右肩后头看她手上那页信（信的最后三段，“就是皮擀不圆”那一行认得出；截图里没交互过取景器，阴身的她不显形）',
    preset: { flags: READING }, temp: READING_TEMP, view: { cam: CAM_502.LETTER }, highlight: 0.7,
  },
  {
    id: 'shot.r2_502.chou_fire', label: '丑时·灶火长明（青火）、一锅馄饨，王奶奶已走',
    preset: 'chou', view: { cam: { pos: [4.6, 1.6, -0.3], target: [7.0, 0.95, -1.5], fov: 52 } },
  },
  {
    id: 'shot.r2_502.ir', label: '丑时·红外：灶火与锅是一团热，月光下的屋子是凉的',
    preset: { flags: { ...IN_502, [F.R2_TIN_OPENED]: true, [F.R2_WANG_DONE]: true, [F.R2_ABILITY_IR]: true }, items: [IT.WONTON] },
    view: { player: [4.3, -1.2], yaw: 100, pitch: -6, mode: 'vf', lens: 'ir', zoom: 1 }, ui: true, brightness: [0.05, 0.6],
  },
  {
    id: 'shot.r2_502.bedroom', label: '子时·卧室：只剩床架，北窗的月光',
    preset: { flags: IN_502 }, view: { cam: { pos: [2.85, 1.55, -4.45], target: [1.5, 0.95, -6.6], fov: 56 } },
  },
];
