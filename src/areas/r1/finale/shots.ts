// owner: R1-finale
// 终章的截图机位（ARCH §12.5；shot.r1.fin_*，与 R1-world 的 shot.r1.* 不重名）。
// 预置写成完整的 flags/物品/照片（ShotDef.preset 的对象形式不与时辰简写合并），从 GDD §11 走到该处应有的状态抄来。

import type { ShotDef } from '../../../core/area';
import type { ItemId, PhotoId } from '../../../data/ids';
import { F, NPC, OBJ, RP, SEG } from '../../../data/ids';
import { CREDITS_CAM, EPILOGUE_CAM, NANKE_CAM } from './ending';
import { CH1_POSE } from './stage';
import { SMILE_SHOT_CAM, TEMP_SHOT, WONTON_SHOT_CAM } from './cutscenes';

type Flags = Record<string, boolean | number>;

/** 寅时（regions 预置 yin，GDD §11 步骤 45 之后） */
const YIN: Flags = {
  'r1.log_taken': true, 'r1.gate_lamp_on': true, 'r1.met_tudi': true, 'r1.ability_replay': true, 'r1.p1_done': true, 'r1.mission_given': true,
  'r1.drawer_open': true, 'r1.gate_unchained': true,
  'r2.lobby_lamp_lit': true, 'r2.wang_met': true, 'r2.wang_escort': true, 'r2.wang_floor': 5, 'r2.bulb_installed': true, 'r2.menshen_open': true,
  'r2.tin_opened': true, 'r2.wang_done': true, 'r2.ability_ir': true,
  'r3.lu_door_open': true, 'r3.got_envelope': true, 'r3.film_hung': true, 'r3.film_developed': true, 'r3.saw_true_form': true,
  'r4.ghost_market_open': true, 'r4.spotted_huang': true, 'r4.found_huang': true, 'r4.asked_tape': true, 'r4.huang_admits': true, 'r4.got_tape': true,
};
const ITEMS_YIN: ItemId[] = ['it.log', 'it.keys', 'it.idcard', 'it.train_ticket', 'it.glasses', 'it.wonton', 'it.film', 'it.portrait', 'it.tape_830'];
const PHOTOS_YIN: PhotoId[] = ['ph.tudi', 'ph.menshen_2018', 'ph.covered_face', 'ph.film3', 'ph.true_form', 'ph.huang_hides', 'ph.huang_normal', 'ph.huang_ir'];

const TAPE_DONE: Flags = { ...YIN, [F.R1_TAPE_IN_VCR]: true, [F.R1_TAPE_WATCHED]: true };
const PLACED: Flags = { ...TAPE_DONE, [F.R1_HEARD_VOICE]: true, [F.R1_PORTRAIT_PLACED]: true };
const COMPLETE: Flags = { ...PLACED, [F.R1_PORTRAIT_COMPLETE]: true };
const VISIBLE: Flags = { ...COMPLETE, [F.R1_ZHOU_VISIBLE]: true };
const FED: Flags = { ...VISIBLE, [F.R1_ZHOU_FED]: true };
const ENDING: Flags = { ...FED, [F.R1_SOUL_RETURNED]: true, [F.R1_CALLED_AT_DAWN]: true, [F.R1_NANKE]: true };

const PH_ALL: PhotoId[] = [...PHOTOS_YIN, 'ph.tape_face', 'ph.zhou_tunnel', 'ph.final'];

const ANTS: Flags = { ...YIN, 'r1.ant_old_1': true, 'r1.ant_old_2': true, 'r1.ant_old_3': true, 'r1.ant_old_4': true, 'r1.ant_old_5': true, 'r1.ant_old_6': true, 'r1.nanke': true };
const PH_OLD: PhotoId[] = ['ph.old_1', 'ph.old_2', 'ph.old_3', 'ph.old_4', 'ph.old_5', 'ph.old_6'];

export const SHOTS: readonly ShotDef[] = [
  {
    id: 'shot.r1.fin_anthill', label: '寅时·南柯：槐树根下的蚁穴收齐了六张旧照，洞口漏出一点暖光、飘起一粒光；远处是钠灯①与三号楼的晾衣绳',
    preset: { flags: ANTS, items: ITEMS_YIN, photos: [...PHOTOS_YIN, ...PH_OLD] },
    view: { cam: { pos: [0.0, 0.8, 2.4], target: [-2.54, 1.05, 0.811], fov: 56 } },
    keys: [OBJ.R1_ANTHILL],
  },
  {
    id: 'shot.r1.fin_booth_lu', label: '寅时·门卫室（取景器，从门外往里看）：陆师傅站在屋里西北角；门口残影点的雪花打着旋，门楣上空支架垂着断线；窗里是遗像前的烛光',
    preset: { flags: PLACED, items: ITEMS_YIN, photos: [...PHOTOS_YIN, 'ph.tape_face'] },
    // M4 第 2 轮：往东退 0.7m、朝向偏北一点，“传达室”灯箱整块与陆师傅全身都进画（原来灯箱切成“达室”、陆师傅下半身压在按键行上）
    view: { player: [-2.3, 20.9], yaw: 276, pitch: 2, mode: 'vf', zoom: 1 }, ui: true,
    keys: [NPC.LU],
  },
  {
    id: 'shot.r1.fin_portrait', label: '寅时·遗像补上了脸（桌上，CRT 与录像机之间，一对白蜡烛）',
    preset: { flags: COMPLETE, items: ITEMS_YIN, photos: [...PHOTOS_YIN, 'ph.tape_face'] },
    // 门卫室里的机位一律用玩家视角（自由机位只藏身子，摄像头脑袋会悬在出生点的椅子上，docs/requests/r1-world.md #4）
    view: { player: [-6.3, 20.4], yaw: 190, pitch: -44, mode: 'vf', zoom: 2 },
    keys: [OBJ.R1_DESK],
    // M4：烛光按评审压成两粒小火苗（原来两团光晕盖住遗像下半），亮度 > 0.8 的只剩火苗芯（约 0.17%）；高光阈值放到 0.55（遗像的纸面与火苗）
    highlight: 0.55,
  },
  {
    id: 'shot.r1.fin_ir_sketch', label: '寅时·红外看遗像：炭精底下透出铅笔稿，唯独脸那一块是空白（右边 CRT 42℃、左下暖壶 50℃）',
    preset: { flags: PLACED, items: ITEMS_YIN, photos: [...PHOTOS_YIN, 'ph.tape_face'] },
    view: { player: [-6.4, 20.15], yaw: 184, pitch: -30, mode: 'vf', lens: 'ir', zoom: 1 }, ui: true,
    brightness: [0.05, 0.6],
  },
  {
    id: 'shot.r1.fin_zhou_chair', label: '寅时·老周显了形，趴在桌前的椅子上（常光可见）；桌上遗像、蜡烛，CRT 里是 CH2 的他',
    preset: { flags: VISIBLE, items: ITEMS_YIN, photos: [...PHOTOS_YIN, 'ph.tape_face', 'ph.zhou_tunnel'] },
    // M4：从屋子西北角斜着俯看他的背：两支蜡烛（挪开以后）一左一右在他脑袋两边，不再叠在头上；右边是 CRT 里 CH2 的他
    view: { player: [-7.1, 20.15], yaw: 137, pitch: -47, mode: 'vf', zoom: 1 },
    keys: [NPC.ZHOU],
    // 同 shot.r1.fin_portrait：烛光只剩两粒火苗芯，高光阈值 0.55
    highlight: 0.55,
  },
  {
    id: 'shot.r1.fin_door_mark', label: '寅时·老周戴上帽子站在门口，身边地上一个粉笔叉；门楣上的空支架（从院里朝门岗看）',
    preset: { flags: FED, items: ITEMS_YIN, photos: [...PHOTOS_YIN, 'ph.tape_face', 'ph.zhou_tunnel'] },
    // M4 整合：老周与粉笔叉挪到 (-1.9,21.51)/(-2.37,22.28)（合影构图）以后，原机位离他只有 2m、粉笔叉压在他腿上；
    // 机位往东退到院子里，老周、粉笔叉、门楣空支架与门口的土地（灯笼）一起入画
    view: { cam: { pos: [1.0, 1.85, 19.2], target: [-3.1, 1.25, 21.5], fov: 62 } },
    keys: [NPC.ZHOU, OBJ.R1_BRACKET],
  },
  {
    id: 'shot.r1.fin_booth_replay', label: '寅时·门口倒带：2023 年 03:13，老周站在门前抬头冲门楣说话（脸是一团雪花）',
    preset: { flags: TAPE_DONE, items: ITEMS_YIN, photos: [...PHOTOS_YIN, 'ph.tape_face'] },
    // M4 第 2 轮：原机位朝西南看的是灯箱和空支架，t=12 时老周在身后。挪到门岗北边、离残影点 2.2m，朝南看着他（居中）
    view: { player: [-2.4, 19.0], yaw: 170, pitch: -4, mode: 'vf', zoom: 1, replay: { point: RP.R1_BOOTH, seg: SEG.BOOTH_2023, t: 12 } }, ui: true,
  },
  {
    // M4 第 2 轮验收：结局推近那一拍（机位同 cs.r1.fin_ending 的 CH1_AHEAD、fov 11）——老周实起来，身后是门柱与院墙，不再透出铁门的竖栏
    id: 'shot.r1.fin_smile', label: '卯时·叫醒以后：伙计这只眼拉近看院门口回头摆手的老周（“这是头一回，他冲着你笑”）',
    preset: { flags: { ...FED, [F.R1_SOUL_RETURNED]: true }, items: ITEMS_YIN, photos: [...PHOTOS_YIN, 'ph.tape_face', 'ph.zhou_tunnel', 'ph.final'] },
    temp: { [TEMP_SHOT]: 1 },
    // （不写 keys：NPC 的锚点按站位算，在椅子上；摆拍把他挪到了院门口）
    view: { cam: SMILE_SHOT_CAM },
    brightness: [0.05, 0.5],
    highlight: false,
  },
  {
    // M4 第 2 轮验收：吃完馄饨的长谈（伙计自己这只眼，老周坐着侧过身来）
    id: 'shot.r1.fin_wonton_talk', label: '寅时·吃完馄饨：老周坐在椅子上侧过身来，冲着伙计说那一夜（伙计自己的视角）',
    preset: { flags: VISIBLE, items: ITEMS_YIN, photos: [...PHOTOS_YIN, 'ph.tape_face', 'ph.zhou_tunnel'] },
    temp: { [TEMP_SHOT]: 2 },
    view: { cam: WONTON_SHOT_CAM },
    keys: [NPC.ZHOU],
    highlight: 0.55,
  },
  {
    id: 'shot.r1.fin_ch1_mao', label: '卯时·CH1 固定机位：门口空了，粉笔叉还在，东边发白',
    preset: 'mao',
    view: { cam: CH1_POSE },
  },
  {
    id: 'shot.r1.fin_epilogue', label: '尾声·8 月 28 日上午：晨雾里挖掘机的剪影，拆迁工人爬上梯子',
    preset: { flags: ENDING, items: ITEMS_YIN, photos: PH_ALL },
    view: { cam: EPILOGUE_CAM },
    // 天亮以后的晨雾：比夜景亮是本意（GDD §2.5 第 8 条）
    brightness: [0.05, 0.5],
  },
  {
    id: 'shot.r1.fin_credits', label: '片尾照片：合影（老周一辈子第二张照片，伙计第一次进了画）',
    preset: { flags: ENDING, items: ITEMS_YIN, photos: PH_ALL },
    view: { cam: CREDITS_CAM },
    brightness: [0.05, 0.45],
  },
  {
    id: 'shot.r1.fin_nanke', label: '南柯·拆迁工人阳台的视角（1×）：院子平了，只剩槐树墩子',
    preset: { flags: ENDING, items: ITEMS_YIN, photos: PH_ALL },
    view: { cam: NANKE_CAM },
    brightness: [0.05, 0.7],
  },
  {
    id: 'shot.r1.fin_nanke_zoom', label: '南柯·6×：树墩下的蚁穴里亮着一座小小的槐安里，小老周冲镜头摆手',
    preset: { flags: ENDING, items: ITEMS_YIN, photos: PH_ALL },
    view: { cam: { ...NANKE_CAM, fov: (2 * Math.atan(Math.tan((NANKE_CAM.fov! / 2) * (Math.PI / 180)) / 6) * 180) / Math.PI } },
    brightness: [0.05, 0.7],
  },
];
