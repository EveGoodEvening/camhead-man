// owner: integrator
// （M1a 写全量并冻结；此后只有整合代理/引擎维护者能改，ARCH §2.12）
// GDD §13「标识符总表」的全部游戏 id（ARCH §4.2）。区域代理只能引用，不得自造；缺 id 写 docs/requests/。
// 常量命名：去掉命名空间前缀后转大写蛇形；flag 与交互物保留区域前缀。

import type { AreaId, AreaKey, ModeId } from '../core/types';

type ValueOf<T> = T[keyof T];

// ---------------------------------------------------------------- 区域（§13.2）
export const AREA = { R1: 'r1', R2: 'r2', R2_502: 'r2_502', R3: 'r3', R4: 'r4' } as const satisfies Record<string, AreaId>;

// ---------------------------------------------------------------- 出生点、出入口（§13.2）
export const SPAWN = {
  R1_START: 'spawn.r1_start',
  R1_FROM_R2: 'spawn.r1_from_r2',
  R1_FROM_R3: 'spawn.r1_from_r3',
  R1_FROM_R4: 'spawn.r1_from_r4',
  R2_LOBBY: 'spawn.r2_lobby',
  R2_F2: 'spawn.r2_f2',
  R2_F3: 'spawn.r2_f3',
  R2_F4: 'spawn.r2_f4',
  R2_F5: 'spawn.r2_f5',
  R2_502_DOOR: 'spawn.r2_502_door',
  R3_WEST: 'spawn.r3_west',
  R4_BOTTOM: 'spawn.r4_bottom',
} as const;
export const EXIT = {
  R1_TO_R2: 'exit.r1_to_r2',
  R1_TO_R3: 'exit.r1_to_r3',
  R1_TO_R4: 'exit.r1_to_r4',
  R2_TO_R1: 'exit.r2_to_r1',
  R2_TO_502: 'exit.r2_to_502',
  R2_502_TO_R2: 'exit.r2_502_to_r2',
  R3_TO_R1: 'exit.r3_to_r1',
  R4_TO_R1: 'exit.r4_to_r1',
} as const;

/**
 * 开发沙盒（ARCH §0.3 的 `dev` 区域）专用的出生点与出入口。不是 GDD 游戏 id，不在 ALL_IDS 里，
 * 只能在 src/areas/dev/ 与引擎自测中使用（check.mjs 接受 ALL_IDS ∪ DEV_IDS）。
 */
export const DEV_SPAWN = { START: 'spawn.dev_start', LOOKDEV: 'spawn.dev_lookdev' } as const;
export const DEV_EXIT = { TO_R1: 'exit.dev_to_r1' } as const;

// ---------------------------------------------------------------- Flags（§13.3）
export const F = {
  // P1–P2
  R1_LOG_TAKEN: 'r1.log_taken',
  R1_GATE_LAMP_ON: 'r1.gate_lamp_on',
  R1_MET_TUDI: 'r1.met_tudi',
  R1_ABILITY_REPLAY: 'r1.ability_replay',
  R1_P1_DONE: 'r1.p1_done',
  R1_MISSION_GIVEN: 'r1.mission_given',
  R1_DRAWER_OPEN: 'r1.drawer_open',
  R1_GATE_UNCHAINED: 'r1.gate_unchained',
  // P3–P5
  R2_LOBBY_LAMP_LIT: 'r2.lobby_lamp_lit',
  R2_WANG_MET: 'r2.wang_met',
  R2_WANG_ESCORT: 'r2.wang_escort',
  R2_WANG_FLOOR: 'r2.wang_floor',
  R2_BULB_INSTALLED: 'r2.bulb_installed',
  R2_MENSHEN_OPEN: 'r2.menshen_open',
  R2_TIN_OPENED: 'r2.tin_opened',
  R2_WANG_DONE: 'r2.wang_done',
  R2_ABILITY_IR: 'r2.ability_ir',
  // P6–P8
  R3_LU_DOOR_OPEN: 'r3.lu_door_open',
  R3_GOT_ENVELOPE: 'r3.got_envelope',
  R3_FILM_HUNG: 'r3.film_hung',
  R3_FILM_DEVELOPED: 'r3.film_developed',
  R3_SAW_TRUE_FORM: 'r3.saw_true_form',
  // P9–P11
  R4_GHOST_MARKET_OPEN: 'r4.ghost_market_open',
  R4_SPOTTED_HUANG: 'r4.spotted_huang',
  R4_FOUND_HUANG: 'r4.found_huang',
  R4_ASKED_TAPE: 'r4.asked_tape',
  R4_HUANG_ADMITS: 'r4.huang_admits',
  R4_GOT_TAPE: 'r4.got_tape',
  // P12–P14
  R1_TAPE_IN_VCR: 'r1.tape_in_vcr',
  R1_TAPE_WATCHED: 'r1.tape_watched',
  R1_HEARD_VOICE: 'r1.heard_voice',
  R1_PORTRAIT_PLACED: 'r1.portrait_placed',
  R1_PORTRAIT_COMPLETE: 'r1.portrait_complete',
  R1_ZHOU_VISIBLE: 'r1.zhou_visible',
  R1_ZHOU_FED: 'r1.zhou_fed',
  R1_SOUL_RETURNED: 'r1.soul_returned',
  R1_CALLED_AT_DAWN: 'r1.called_at_dawn',
  // H 南柯
  R1_ANT_OLD_1: 'r1.ant_old_1',
  R1_ANT_OLD_2: 'r1.ant_old_2',
  R1_ANT_OLD_3: 'r1.ant_old_3',
  R1_ANT_OLD_4: 'r1.ant_old_4',
  R1_ANT_OLD_5: 'r1.ant_old_5',
  R1_ANT_OLD_6: 'r1.ant_old_6',
  R1_NANKE: 'r1.nanke',
} as const;
export type FlagId = ValueOf<typeof F>;
/** 数值 flag（0–5，只增不减）；其余 flag 全是布尔。 */
export const NUMERIC_FLAGS: ReadonlySet<FlagId> = new Set<FlagId>([F.R2_WANG_FLOOR]);
/** r1.ant_old_1..6，按旧照编号顺序（下标 0 = 旧照一）。 */
export const ANT_FLAGS: readonly FlagId[] = [F.R1_ANT_OLD_1, F.R1_ANT_OLD_2, F.R1_ANT_OLD_3, F.R1_ANT_OLD_4, F.R1_ANT_OLD_5, F.R1_ANT_OLD_6];

// ---------------------------------------------------------------- 物品（§13.4）
export const IT = {
  LOG: 'it.log',
  KEYS: 'it.keys',
  BULB: 'it.bulb',
  SLIP_0473: 'it.slip_0473',
  IDCARD: 'it.idcard',
  LETTER: 'it.letter',
  TRAIN_TICKET: 'it.train_ticket',
  GLASSES: 'it.glasses',
  WONTON: 'it.wonton',
  MONEY: 'it.money',
  FILM: 'it.film',
  SLIP_0474: 'it.slip_0474',
  PORTRAIT: 'it.portrait',
  TAPE_830: 'it.tape_830',
} as const;
export type ItemId = ValueOf<typeof IT>;

// ---------------------------------------------------------------- 照片、拍照目标、读字目标（§13.5）
/** 关键照片（不含空镜 ph.empty_<n>）。 */
export const PH = {
  TUDI: 'ph.tudi',
  MENSHEN_2018: 'ph.menshen_2018',
  DOOR_2019: 'ph.door_2019',
  DOOR_2025: 'ph.door_2025',
  COVERED_FACE: 'ph.covered_face',
  FILM3: 'ph.film3',
  TRUE_FORM: 'ph.true_form',
  HUANG_NORMAL: 'ph.huang_normal',
  HUANG_HIDES: 'ph.huang_hides',
  HUANG_IR: 'ph.huang_ir',
  TAPE_FACE: 'ph.tape_face',
  ZHOU_TUNNEL: 'ph.zhou_tunnel',
  FINAL: 'ph.final',
  OLD_1: 'ph.old_1',
  OLD_2: 'ph.old_2',
  OLD_3: 'ph.old_3',
  OLD_4: 'ph.old_4',
  OLD_5: 'ph.old_5',
  OLD_6: 'ph.old_6',
} as const;
export type KeyPhotoId = ValueOf<typeof PH>;
export type EmptyPhotoId = `ph.empty_${number}`;
export type PhotoId = KeyPhotoId | EmptyPhotoId;
/** 空镜 id：ph.empty_<n>。 */
export const emptyPhotoId = (n: number): EmptyPhotoId => `ph.empty_${Math.floor(n)}` as EmptyPhotoId;
export const isEmptyPhotoId = (id: string): id is EmptyPhotoId => /^ph\.empty_\d+$/.test(id);

export const PT = {
  TUDI: 'pt.tudi',
  MENSHEN_2018: 'pt.menshen_2018',
  DOOR_2019: 'pt.door_2019',
  DOOR_2025: 'pt.door_2025',
  FILM3: 'pt.film3',
  HUANG_NORMAL: 'pt.huang_normal',
  HUANG_HIDES: 'pt.huang_hides',
  HUANG_IR: 'pt.huang_ir',
  TAPE_FACE: 'pt.tape_face',
  ZHOU_TUNNEL: 'pt.zhou_tunnel',
  FINAL: 'pt.final',
  OLD_1: 'pt.old_1',
  OLD_2: 'pt.old_2',
  OLD_3: 'pt.old_3',
  OLD_4: 'pt.old_4',
  OLD_5: 'pt.old_5',
  OLD_6: 'pt.old_6',
} as const;
export type PhotoTargetId = ValueOf<typeof PT>;

export const RD = {
  SWITCH_LABELS: 'rd.switch_labels',
  STICKER_MIRROR: 'rd.sticker_mirror',
  PICKUP_NUMBERS: 'rd.pickup_numbers',
  OBITUARY_HIDDEN: 'rd.obituary_hidden',
  PORTRAIT_SKETCH: 'rd.portrait_sketch',
  HUANG_BREATH: 'rd.huang_breath',
} as const;
export type ReadId = ValueOf<typeof RD>;

// ---------------------------------------------------------------- 残影点与回放片段（§13.6）
export const RP = {
  R1_GATE: 'rp.r1_gate',
  R1_TREE: 'rp.r1_tree',
  R1_SHED: 'rp.r1_shed',
  R1_BOOTH: 'rp.r1_booth',
  R2_LOBBY: 'rp.r2_lobby',
  R2_DOOR: 'rp.r2_door',
  R2_KITCHEN: 'rp.r2_kitchen',
  R3_STUDIO: 'rp.r3_studio',
  R4_STALL: 'rp.r4_stall',
  R4_MID: 'rp.r4_mid',
} as const;
export type ReplayPointId = ValueOf<typeof RP>;

export const SEG = {
  GATE_2026: 'seg.gate_2026',
  TREE_1984: 'seg.tree_1984',
  SHED_2012: 'seg.shed_2012',
  BOOTH_2023: 'seg.booth_2023',
  LOBBY_2008: 'seg.lobby_2008',
  DOOR_2025: 'seg.door_2025',
  DOOR_2019: 'seg.door_2019',
  DOOR_2018: 'seg.door_2018',
  KITCHEN_1986: 'seg.kitchen_1986',
  STUDIO_1990: 'seg.studio_1990',
  STALL_2023: 'seg.stall_2023',
  MID_1997: 'seg.mid_1997',
} as const;
export type SegmentId = ValueOf<typeof SEG>;

export const GHOST = {
  WANG_2026: 'ghost.wang_2026',
  LU_2026: 'ghost.lu_2026',
  CROWD_1984: 'ghost.crowd_1984',
  ZHOU_2012: 'ghost.zhou_2012',
  KID_2012: 'ghost.kid_2012',
  ZHOU_2023: 'ghost.zhou_2023',
  NEIGHBORS_2008: 'ghost.neighbors_2008',
  JIANGUO_2025: 'ghost.jianguo_2025',
  STRETCHER_2019: 'ghost.stretcher_2019',
  JIANGUO_2018: 'ghost.jianguo_2018',
  WANG_2018: 'ghost.wang_2018',
  WANG_1986: 'ghost.wang_1986',
  JIANGUO_1986: 'ghost.jianguo_1986',
  LU_1990: 'ghost.lu_1990',
  BRIDE_1990: 'ghost.bride_1990',
  APPRENTICE_1990: 'ghost.apprentice_1990',
  HUANG_2023: 'ghost.huang_2023',
  JUNKMAN_2023: 'ghost.junkman_2023',
  CROWD_1997: 'ghost.crowd_1997',
  WEASEL_EYES_1997: 'ghost.weasel_eyes_1997',
} as const;
export type GhostId = ValueOf<typeof GHOST>;

// ---------------------------------------------------------------- 角色、说话人、人偶（§13.7）
export const PC = { HUOJI: 'pc.huoji', BODY: 'pc.body' } as const;
export type PcId = ValueOf<typeof PC>;
export const NPC = { TUDI: 'npc.tudi', WANG: 'npc.wang', LU: 'npc.lu', BOY: 'npc.boy', HUANG: 'npc.huang', ZHOU: 'npc.zhou' } as const;
export type NpcId = ValueOf<typeof NPC>;
export const SPK = {
  YUCHI: 'spk.yuchi',
  QIN: 'spk.qin',
  ZAOWANG: 'spk.zaowang',
  ZAONAINAI: 'spk.zaonainai',
  WORKER: 'spk.worker',
  NARRATOR: 'spk.narrator',
} as const;
export type SpeakerSpkId = ValueOf<typeof SPK>;
export const RIG = { MANNEQUIN: 'rig.mannequin', PAPER: 'rig.paper' } as const;
export type RigId = ValueOf<typeof RIG>;
/** 鬼市纸人摊主（S3 即 npc.huang，不在此表）。 */
export const STALL = {
  R4_STALL_N1: 'r4.stall_n1',
  R4_STALL_N2: 'r4.stall_n2',
  R4_STALL_N3: 'r4.stall_n3',
  R4_STALL_N4: 'r4.stall_n4',
  R4_STALL_N5: 'r4.stall_n5',
  R4_STALL_S1: 'r4.stall_s1',
  R4_STALL_S2: 'r4.stall_s2',
  R4_STALL_S4: 'r4.stall_s4',
  R4_STALL_S5: 'r4.stall_s5',
} as const;
export type StallId = ValueOf<typeof STALL>;

// ---------------------------------------------------------------- 交互物（§13.8，不含 r3.hole_xx）
export const OBJ = {
  // r1
  R1_LOG: 'r1.log',
  R1_SWITCH_BOX: 'r1.switch_box',
  R1_SWITCH_1: 'r1.switch_1',
  R1_SWITCH_2: 'r1.switch_2',
  R1_SWITCH_3: 'r1.switch_3',
  R1_SWITCH_4: 'r1.switch_4',
  R1_MIRROR: 'r1.mirror',
  R1_DRAWER: 'r1.drawer',
  R1_DESK: 'r1.desk',
  R1_CRT: 'r1.crt',
  R1_VCR: 'r1.vcr',
  R1_CRT_JACK: 'r1.crt_jack',
  R1_TAPE_RACK: 'r1.tape_rack',
  R1_CCTV_NOTICE: 'r1.cctv_notice',
  R1_GATE: 'r1.gate',
  R1_GATE_LAMP: 'r1.gate_lamp',
  R1_NOTICE_BOARD: 'r1.notice_board',
  R1_ESTATE_SIGN: 'r1.estate_sign',
  R1_SHRINE: 'r1.shrine',
  R1_ANTHILL: 'r1.anthill',
  R1_BRAZIER: 'r1.brazier',
  R1_BRACKET: 'r1.bracket',
  /** 粉笔叉：区域（三脚架 zone），不可交互（GDD §13.8）。 */
  R1_MARK_PHOTO: 'r1.mark_photo',
  R1_COLD_CHAIR: 'r1.cold_chair',
  R1_COLD_STEPS: 'r1.cold_steps',
  // r2
  R2_LAMP_1F: 'r2.lamp_1f',
  R2_LAMP_2F: 'r2.lamp_2f',
  R2_LAMP_3F: 'r2.lamp_3f',
  R2_LAMP_4F: 'r2.lamp_4f',
  R2_LAMP_5F: 'r2.lamp_5f',
  R2_LAMP_SOCKET_3F: 'r2.lamp_socket_3f',
  R2_STAIRS: 'r2.stairs',
  R2_MAILBOXES: 'r2.mailboxes',
  R2_DONATION_BOARD: 'r2.donation_board',
  R2_ELEVATOR: 'r2.elevator',
  R2_DOOR_502: 'r2.door_502',
  R2_MENSHEN: 'r2.menshen',
  // r2_502（物体也用 r2. 前缀）
  R2_ZAOJUN: 'r2.zaojun',
  R2_STOVE: 'r2.stove',
  R2_TILE_LEFT_LOW: 'r2.tile_left_low',
  R2_TILE_RIGHT_LOW: 'r2.tile_right_low',
  R2_TILE_TOP: 'r2.tile_top',
  R2_CALENDAR: 'r2.calendar',
  // r3
  R3_BELL: 'r3.bell',
  R3_SHOP_DOOR: 'r3.shop_door',
  R3_PICKUP_GRID: 'r3.pickup_grid',
  R3_TLR: 'r3.tlr',
  R3_BIG_CAMERA: 'r3.big_camera',
  R3_STOOL: 'r3.stool',
  R3_EASEL: 'r3.easel',
  R3_DARKROOM_DOOR: 'r3.darkroom_door',
  R3_DARKROOM_RULES: 'r3.darkroom_rules',
  R3_LAMP_CORD: 'r3.lamp_cord',
  R3_TRAY_SQUARE: 'r3.tray_square',
  R3_BASIN_XI: 'r3.basin_xi',
  R3_PLATE_CHIPPED: 'r3.plate_chipped',
  R3_SINK: 'r3.sink',
  R3_DRYING_LINE: 'r3.drying_line',
  R3_FILM_FRAME1: 'r3.film_frame1',
  R3_FILM_FRAME2: 'r3.film_frame2',
  R3_FILM_FRAME3: 'r3.film_frame3',
  R3_FILM_FRAME4: 'r3.film_frame4',
  R3_COLD_DOOR: 'r3.cold_door',
  // r4（摊主见 STALL）
  R4_RULES_BOARD: 'r4.rules_board',
  R4_KIOSK: 'r4.kiosk',
  R4_CAMPHOR_CHEST: 'r4.camphor_chest',
  R4_OLD_BOOK: 'r4.old_book',
  R4_COLD_STAIRS: 'r4.cold_stairs',
} as const;
export type ObjId = ValueOf<typeof OBJ>;

type D = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
/** 取件格 r3.hole_00 – r3.hole_99（生成式）。 */
export type HoleId = `r3.hole_${D}${D}`;
export const holeId = (n: number): HoleId => `r3.hole_${String(Math.floor(n)).padStart(2, '0')}` as HoleId;
export const HOLE_IDS: readonly HoleId[] = Array.from({ length: 100 }, (_, n) => holeId(n));

export type InteractId = ObjId | HoleId | NpcId | StallId;

// ---------------------------------------------------------------- 文档（§13.9）
export const DOC = {
  LOG_OLD: 'doc.log_old',
  LOG_NEW: 'doc.log_new',
  OBITUARY: 'doc.obituary',
  DEMOLITION: 'doc.demolition',
  WATER_NOTICE: 'doc.water_notice',
  ESTATE_SIGN: 'doc.estate_sign',
  SHRINE_COUPLET: 'doc.shrine_couplet',
  CCTV_NOTICE: 'doc.cctv_notice',
  IDCARD: 'doc.idcard',
  SLIP_0473: 'doc.slip_0473',
  DONATION_BOARD: 'doc.donation_board',
  ZAOJUN_COUPLET: 'doc.zaojun_couplet',
  LETTER_JIANGUO: 'doc.letter_jianguo',
  TRAIN_TICKET: 'doc.train_ticket',
  DARKROOM_RULES: 'doc.darkroom_rules',
  TLR_TAPE: 'doc.tlr_tape',
  SLIP_0474: 'doc.slip_0474',
  MARKET_RULES: 'doc.market_rules',
  OLD_BOOK: 'doc.old_book',
} as const;
export type DocId = ValueOf<typeof DOC>;

// ---------------------------------------------------------------- 称呼（§13.10）
export const NAME = {
  HUOJI: 'name.huoji',
  KANMENDE: 'name.kanmende',
  ZHOU_SHOUREN: 'name.zhou_shouren',
  XIAOZHOU: 'name.xiaozhou',
  TONGHANG: 'name.tonghang',
  LAOZHOU: 'name.laozhou',
} as const;
export type NameId = ValueOf<typeof NAME>;

// ---------------------------------------------------------------- 谜题（§13.11）
export const PZ = {
  P01_GUIDE_LAMP: 'pz.p01_guide_lamp',
  P02_HUOJI_BIRTHDAY: 'pz.p02_huoji_birthday',
  P03_VOICE_LAMPS: 'pz.p03_voice_lamps',
  P04_DOOR_GODS: 'pz.p04_door_gods',
  P05_KITCHEN_GOD: 'pz.p05_kitchen_god',
  P06_PICKUP_SLIP: 'pz.p06_pickup_slip',
  P07_DARKROOM: 'pz.p07_darkroom',
  P08_TRUE_FORM: 'pz.p08_true_form',
  P09_GHOST_MARKET: 'pz.p09_ghost_market',
  P10_CAMPHOR_CHEST: 'pz.p10_camphor_chest',
  P11_SEEK_TITLE: 'pz.p11_seek_title',
  P12_THAT_NIGHT: 'pz.p12_that_night',
  P13_SEE_HIM: 'pz.p13_see_him',
  P14_WAKE_ME: 'pz.p14_wake_me',
  H_NANKE: 'pz.h_nanke',
} as const;
export type PuzzleId = ValueOf<typeof PZ>;

// ---------------------------------------------------------------- 模式、图层、材质、存档、设置、对话（§13.12）
export const MODE = {
  EXPLORE: 'mode.explore',
  VIEWFINDER: 'mode.viewfinder',
  REPLAY: 'mode.replay',
  PANEL_VCR: 'mode.panel_vcr',
  PANEL_CONSOLE: 'mode.panel_console',
  PANEL_CODE: 'mode.panel_code',
  PANEL_NAMING: 'mode.panel_naming',
  DIALOGUE: 'mode.dialogue',
  ALBUM: 'mode.album',
  JOURNAL: 'mode.journal',
  TRIPOD: 'mode.tripod',
  CUTSCENE: 'mode.cutscene',
  PAUSE: 'mode.pause',
} as const satisfies Record<string, ModeId>;
/** GDD 的图层 id（layer.*）。代码里的图层编号与名字见 core/layers.ts 的 LAYER。 */
export const LAYER_ID = {
  WORLD: 'layer.world',
  YIN: 'layer.yin',
  FADED_TEXT: 'layer.faded_text',
  SELF_HEAD: 'layer.self_head',
  SELF_STICKER_VF: 'layer.self_sticker_vf',
  REPLAY: 'layer.replay',
  IR_ONLY: 'layer.ir_only',
} as const;
export type LayerIdStr = ValueOf<typeof LAYER_ID>;
export const MAT = { REPLAY: 'mat.replay', GHOST: 'mat.ghost', PAPER_GLOW: 'mat.paper_glow', IR_OVERRIDE: 'mat.ir_override' } as const;
export type MatId = ValueOf<typeof MAT>;
export const SAVE = { AUTO: 'save.auto', YIN: 'save.yin' } as const;
export type SaveSlot = ValueOf<typeof SAVE>;
export const SETTING = {
  VOLUME: 'settings.volume',
  MOUSE_SENS: 'settings.mouse_sens',
  INVERT_Y: 'settings.invert_y',
  VF_MODE: 'settings.vf_mode',
  SUB_SIZE: 'settings.sub_size',
  GRAIN: 'settings.grain',
  QUALITY: 'settings.quality',
  REDUCE_FLASH: 'settings.reduce_flash',
  COLOR_ASSIST: 'settings.color_assist',
  HINT_NO_COOLDOWN: 'settings.hint_no_cooldown',
  MIRROR_MODE: 'settings.mirror_mode',
  TUNNEL_MODE: 'settings.tunnel_mode',
} as const;
export type SettingId = ValueOf<typeof SETTING>;
/** GDD §13.12 点名的对话；其余对话由区域按 dlg.<区域>.<snake> 自行命名（ARCH §0.3）。 */
export const DLG = { R1_BRACKET_CONFIRM: 'dlg.r1.bracket_confirm', R2_STAIRS: 'dlg.r2.stairs' } as const;

// ---------------------------------------------------------------- 派生联合类型（ARCH §4.2）
export type SpawnId = ValueOf<typeof SPAWN> | ValueOf<typeof DEV_SPAWN>;
export type ExitId = ValueOf<typeof EXIT> | ValueOf<typeof DEV_EXIT>;
/** 可以“出示/使用”的东西。 */
export type ThingId = ItemId | PhotoId;
export type SpeakerId = NpcId | SpeakerSpkId | 'pc.huoji';
export type SubjectRef = InteractId | GhostId | 'pc.body' | 'pc.huoji';
/** 对话树 id：dlg.<区域>.<snake>（dev 沙盒用 dlg.dev.*）。 */
export type DialogueId = `dlg.${AreaKey}.${string}`;
/** 过场 id：cs.<区域>.<snake>（dev 沙盒用 cs.dev.*）。 */
export type CutsceneId = `cs.${AreaKey}.${string}`;

// ---------------------------------------------------------------- 全集
const GROUPS: readonly Readonly<Record<string, string>>[] = [
  AREA, SPAWN, EXIT, F, IT, PH, PT, RD, RP, SEG, GHOST, PC, NPC, SPK, RIG, STALL, OBJ, DOC, NAME, PZ,
  MODE, LAYER_ID, MAT, SAVE, SETTING, DLG,
];

/** GDD §13 的全部 id（含生成式 r3.hole_00–99；不含 ph.empty_<n> 与 DEV_*）。供 expr.ts、save.ts 与 check.mjs 校验。 */
export const ALL_IDS: ReadonlySet<string> = new Set<string>([
  ...GROUPS.flatMap(g => Object.values(g)),
  ...HOLE_IDS,
]);

/** 开发沙盒专用 id（不是 GDD id）。 */
export const DEV_IDS: ReadonlySet<string> = new Set<string>([...Object.values(DEV_SPAWN), ...Object.values(DEV_EXIT)]);

/** 是否是已登记的 id（ALL_IDS 或空镜 ph.empty_<n>）。 */
export function isKnownId(id: string): boolean {
  return ALL_IDS.has(id) || isEmptyPhotoId(id);
}
