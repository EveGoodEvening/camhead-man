// owner: integrator
// （M1a 写好并冻结；M2 期间归引擎维护者，R1-world 与 R1-finale 只读，互不 import 对方，但都可以 import 本文件）
// R1 槐安里的全部坐标常量（GDD §4.1、§4.6、§3.8、P1–P14）。原点在槐树干中心；+x 东，-z 北；米。
// `derived` 里是 GDD 没有直接给出、由 M1a 按 GDD 描述推定的值（桌面上的 CRT/录像机、面板视点、CH1/CH2 机位等）；
// 要改请写 docs/requests/r1-world.md 或 r1-finale.md，由引擎维护者改这里。

export const R1 = {
  // ---------------------------------------------------------------- 院子与外围
  /** 院内 x∈[-25,25]，z∈[-24,24] */
  yard: { x0: -25, x1: 25, z0: -24, z1: 24 },
  /** 院外人行道 z∈[24,30] */
  sidewalk: { x0: -25, x1: 25, z0: 24, z1: 30 },
  /** 二百多年的古槐：树干中心、树干半径 1.0、树冠半径 9 */
  tree: { center: [0, 0, 0], trunkR: 1.0, canopyR: 9 },
  /** 三号楼 x:-22~6, z:-24~-14 */
  building3: { x0: -22, x1: 6, z0: -24, z1: -14 },
  /** 三号楼单元门（exit.r1_to_r2 的触发位置） */
  unitDoor: [-8, 0, -14],
  /** 二号楼立面 x=-20、一号楼立面 x=20 */
  building2FacadeX: -20,
  building1FacadeX: 20,
  /** 车棚 x:10~18, z:-8~-4 */
  shed: { x0: 10, x1: 18, z0: -8, z1: -4 },
  /** 钠灯①②（灯杆底部） */
  sodium1: [-12, 0, 0],
  sodium2: [12, 0, 8],
  /** 土地庙 r1.shrine */
  shrine: [1.6, 0, 1.2],
  /** 土地（npc.tudi）在槐树下的站位 */
  tudi: [2.4, 0, 2.0],
  /** 蚁穴 r1.anthill */
  anthill: [-1.3, 0, 0.9],
  /** 石桌 */
  stoneTable: [-8, 0, 6],
  /** 公告栏 r1.notice_board */
  noticeBoard: [9, 0, 20],
  /** 小区简介牌 r1.estate_sign */
  estateSign: [-4, 0, 23.5],
  /** 火盆 r1.brazier */
  brazier: [-1.8, 0, 23.0],
  /** 院门 r1.gate：x:-3~3，z=24（铁链锁） */
  gate: { x0: -3, x1: 3, z: 24 },
  /** 门灯 r1.gate_lamp（GDD 给出 (3.5,23.4)；高度见 derived.gateLampY） */
  gateLamp: [3.5, 0, 23.4],
  /** 冷迹·台阶 r1.cold_steps */
  coldSteps: [-7.0, 0, -12.9],

  // ---------------------------------------------------------------- 门卫室（3m×3.5m）
  /** 门卫室 x:-8~-5, z:18.5~22；门在东墙 (-5,20.2) 朝东；南窗下是桌子 */
  booth: { x0: -8, x1: -5, z0: 18.5, z1: 22, door: [-5, 0, 20.2], doorYaw: 90 },
  /** 门楣空支架 r1.bracket（CH1 机位，头装回去的位置） */
  bracket: [-4.9, 2.8, 20.2],
  /** 桌子 r1.desk */
  desk: [-6.5, 0, 21.5],
  /** 桌子抽屉 r1.drawer（4 位转轮锁） */
  drawer: [-6.5, 0.7, 21.3],
  /** 椅子（spawn.r1_start；红外冷迹 r1.cold_chair；寅时老周趴桌的椅子） */
  chair: [-6.5, 0, 20.8],
  /** 西墙录像带架 r1.tape_rack（8.1–8.29，8.30 那格空着） */
  tapeRack: [-7.8, 1.2, 20],
  /** 西墙《监控调试注意事项》r1.cctv_notice */
  cctvNotice: [-7.95, 1.6, 21.2],
  /** 北墙电闸箱 r1.switch_box（内有 r1.switch_1–4） */
  switchBox: [-7, 1.5, 18.6],
  /** 北墙圆镜 r1.mirror：中心 (-5.8,1.80,18.6)，直径 0.5（覆盖离地 1.55–2.05m），镜面朝南（+z） */
  mirror: { center: [-5.8, 1.8, 18.6], diameter: 0.5, normal: [0, 0, 1] },
  /** 镜面上贴条虚像的对应点（约离地 1.89m，GDD §7.3 rd.sticker_mirror） */
  stickerMirrorPoint: [-5.8, 1.89, 18.6],
  /** 屋角 CH2 半球摄像头 */
  ch2CamPos: [-7.8, 2.4, 18.8],

  // ---------------------------------------------------------------- 残影点（GDD §13.6）
  replay: {
    /** rp.r1_gate：院门口 */
    gate: [0, 0, 22.5],
    /** rp.r1_tree：树北 */
    tree: [0, 0, -3.5],
    /** rp.r1_shed：车棚 */
    shed: [14, 0, -6],
    /** rp.r1_booth：门岗（锁定直到 r1.tape_watched） */
    booth: [-4.2, 0, 20.2],
  },

  // ---------------------------------------------------------------- NPC 站位（GDD §4.6、P13、P14）
  npcSpots: {
    /** 土地在槐树下 */
    tudiTree: [2.4, 0, 2.0],
    /** r1.portrait_complete 后土地移到门岗门口 */
    tudiBoothDoor: [-3.6, 0, 19.2],
    /** r3.saw_true_form 后陆师傅站在门卫室西北角 */
    luBooth: [-7.4, 0, 19.6],
    /** r1.zhou_visible 后老周趴在桌前椅子上 */
    zhouChair: [-6.5, 0, 20.8],
    /**
     * r1.zhou_fed 后老周站到门口（也是 2023 年 03:12 他站住的地方）。
     * M4 合影构图：原 (-3.4,21.4) 离 CH1 只有 1.88m，脚压在 66° 视场下缘、粉笔叉上的身子被他挡住半边；
     * 改到离 CH1 约 3.2m、与粉笔叉垂直于视轴并排（CH1 视轴 (0.848,0.53)、右向量 (-0.53,0.848)，两人横向相距 0.9m，
     * 头俯角约 17°、脚约 40°，不改 ch1Cam 也整个入画，更靠近院门口的门灯光池）。老周在画面左、粉笔叉在右。
     */
    zhouDoor: [-1.9, 0, 21.51],
  },
  /** 粉笔叉 r1.mark_photo（P14 才出现；三脚架 zone，半径 1.5）。M4：见 npcSpots.zhouDoor 的合影构图说明 */
  markPhoto: [-2.37, 0, 22.28],
  markPhotoRadius: 1.5,

  // ---------------------------------------------------------------- 出生点与出入口（GDD §13.2）
  spawns: {
    /** 椅子，朝南 */
    start: [-6.5, 0, 20.8],
    fromR2: [-8, 0, -12.2],
    fromR3: [23.2, 0, 27],
    fromR4: [-23.2, 0, 27],
  },
  /** 出入口触发体中心（地面点；触发体 1.5m 见方、高 2.5m） */
  exits: {
    toR2: [-8, 0, -14],
    toR3: [25, 0, 27],
    toR4: [-25, 0, 27],
  },

  // ---------------------------------------------------------------- M1a 推定值（GDD 未直接给出）
  derived: {
    /** 桌面高度 */
    deskTopY: 0.76,
    /** 桌子外形（中心、尺寸 x×y×z） */
    deskBox: { center: [-6.5, 0.38, 21.5], size: [1.2, 0.76, 0.6] },
    /** CRT 机身（桌上偏西，屏幕朝北对着椅子） */
    crtBody: { center: [-6.8, 0.96, 21.6], size: [0.46, 0.4, 0.44] },
    /** CRT 屏幕（ref r1.crt 的网格）：中心、尺寸 0.36×0.27、法线朝北 */
    crtScreen: { center: [-6.8, 0.98, 21.375], size: [0.36, 0.27], normal: [0, 0, -1] },
    /** 录像机 r1.vcr（桌上偏东） */
    vcrBody: { center: [-6.15, 0.805, 21.6], size: [0.36, 0.09, 0.28] },
    /** “视频入1”插孔 r1.crt_jack（录像机前面板） */
    crtJack: [-6.02, 0.8, 21.455],
    /** 监控台/录像机面板视点：离屏幕约 0.5m（ARCH §4.7、§6.11） */
    panelView: { pos: [-6.8, 1.02, 20.875], target: [-6.8, 0.98, 21.375], fov: 50 },
    /**
     * CH1 机位：门楣支架上，朝院门方向（偏东南）俯拍门口（三脚架、合影后的过场、天亮、结局固定机位）。
     * M3 定稿（docs/requests/r1-finale.md #6）：按终章截图调过的朝向——俯 24°、广角 66°，老周站的门口（M4 起 (-1.9,21.51)）连脚在画里、
     * 上缘是院门、街对面的楼与一线天（M1a 推定的 target (-2.9,0.9,21.9)、fov 60 俯得太陡、视场太窄）。
     */
    ch1Cam: { pos: [-4.85, 2.75, 20.2], target: [-1.76, 1.09, 22.13], fov: 66 },
    /** CH2 机位：屋角半球机位俯拍门卫室（看得到桌上 CRT 正面与椅子） */
    ch2Cam: { pos: [-7.8, 2.4, 18.8], target: [-6.4, 0.9, 21.0], fov: 70 },
    /** 门灯灯头高度 */
    gateLampY: 2.6,
    /** 钠灯灯头高度 */
    sodiumY: 5.5,
    /** 门卫室门洞宽、室内净高 */
    boothDoorW: 0.9,
    boothH: 2.6,
  },
} as const;

export type R1Layout = typeof R1;

/**
 * R1-world 登记、R1-finale 读取的环境对象 ref（M3 定稿的耦合接口，ARCH §11.6；docs/requests/r1-finale.md #3、r1-world.md #6）。
 * 区域内部名（不带点，不是游戏 id）：R1-world 在 build 里 `ctx.ref(R1_ENV_REFS.hemi, 半球光)` 等登记，
 * 终章结局期间用 `ctx.getRef()` 取来改颜色/强度/可见性（不增删灯）；雾直接改 `ctx.scene.fog`。
 */
export const R1_ENV_REFS = {
  /** 半球光（HemisphereLight，R1 的 8 盏灯之一） */
  hemi: 'r1_hemi',
  /** 夜空天穹（kit/nature 的 skyDome 网格，材质 uniforms：uZenith/uHorizon/uGlow） */
  sky: 'r1_sky',
  /** 跟着相机走的雨（kit/rain 的网格） */
  rain: 'r1_rain',
} as const;
