// owner: integrator
// （M1a 写全量并冻结；此后只有整合代理/引擎维护者能改，ARCH §2.12）
// 调色板（GDD §9.1，全部 20 色）与红外色带。区域代理只能引用。

export const PALETTE = {
  /** 夜靛：天空、远景 */
  NIGHT: '#0B1020',
  /** 雨雾灰蓝：R1 的雾 */
  FOG_R1: '#141A26',
  /** 钠灯橙：路灯、门灯 */
  SODIUM: '#FF9A3C',
  /** 旧砖红：楼体 */
  BRICK: '#7A3B2E',
  /** 墙裙绿：楼道、通道的下半截墙 */
  DADO: '#3F6B5A',
  /** 石灰白：楼道上半截墙 */
  LIME: '#C9C3B5',
  /** 楼道昏黄：声控灯 */
  HALL_LAMP: '#FFD9A0',
  /** 霓虹红：照相馆招牌 */
  NEON: '#FF3B3B',
  /** 暗房红 */
  SAFELIGHT: '#B3001B',
  /** 魂影青：鬼魂 */
  GHOST: '#8FD3D6',
  /** 回放棕绿：回放人影与色调 */
  REPLAY: '#8A8A5A',
  /** 土地金：土地描边、纸像发光 */
  TUDI_GOLD: '#E8C35A',
  /** 纸白：纸扎、门神底色 */
  PAPER: '#EDE6D6',
  /** 灯笼白：鬼市灯笼 */
  LANTERN: '#F3EEDC',
  /** 灶火青 */
  STOVE: '#4FE0C8',
  /** 监控磷绿：OSD、CRT */
  OSD: '#7CFFB2',
  /** REC 红：录制灯 */
  REC: '#FF2020',
  /** 值勤藏蓝：主角与老周的衬衫 */
  UNIFORM: '#2E3A55',
  /** 黎明粉：卯时 */
  DAWN: '#F2B8A0',
  /** 晨青：卯时 */
  MORNING: '#9DB8C8',
} as const;
export type PaletteName = keyof typeof PALETTE;

/** 陆师傅的魂影偏暖白（GDD §2.7；不在 20 色表里，ARCH §5.3 用它给 lu 的 ghost 外观）。 */
export const GHOST_LU = '#E8E0D0';

/** 红外色带：#120024 → #5B0F8A → #D9480F → #FFD43B → #FFFFFF，对应 0℃ → 45℃（GDD §3.3 M5、§9.1）。 */
export const IR_RAMP = ['#120024', '#5B0F8A', '#D9480F', '#FFD43B', '#FFFFFF'] as const;
/** 色带映射的温度区间（℃）。 */
export const IR_RANGE_C = [0, 45] as const;
