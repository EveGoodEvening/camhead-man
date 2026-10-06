// owner: integrator
// （M1a 写全量并冻结；此后只有整合代理/引擎维护者能改，ARCH §2.12）
// 时间相关常量（GDD §3.10 时辰钟点、§3.8 录像带时间轴；ARCH §6.5、§6.10）与少量换算函数。

import { formatTc, parseTc } from '../core/math';
import type { Shichen } from '../core/types';

// ---------------------------------------------------------------- 时辰钟点（GDD §3.10）
export interface ShichenClock {
  /** 进入该时辰时 HUD 钟点的起点 'HH:MM' */
  start: string;
  /** 走到这里停住 'HH:MM' */
  stop: string;
  /** 每走 1 分钟需要的游戏秒数 */
  secPerMin: number;
}
/** 子时 23:40 起每 20 秒 1 分钟停在 00:59；丑时 01:05、寅时 03:05 起每 10 秒 1 分钟，停在 02:59、04:59。卯时由结局加速钟接管。 */
export const SHICHEN_CLOCK: Readonly<Record<Exclude<Shichen, 'mao'>, ShichenClock>> = {
  zi: { start: '23:40', stop: '00:59', secPerMin: 20 },
  chou: { start: '01:05', stop: '02:59', secPerMin: 10 },
  yin: { start: '03:05', stop: '04:59', secPerMin: 10 },
};
/** 字样与钟点的对应区间（子时 23:00–00:59、丑时 01:00–02:59、寅时 03:00–04:59、卯时 05:00 起）。 */
export const SHICHEN_RANGE: Readonly<Record<Shichen, readonly [string, string]>> = {
  zi: ['23:00', '00:59'],
  chou: ['01:00', '02:59'],
  yin: ['03:00', '04:59'],
  mao: ['05:00', '12:00'],
};
/** 推导值已是 mao 时，HUD 字样在钟点到这里才从“寅时”换成“卯时”。 */
export const MAO_HUD_SWITCH = '05:00';
/** 结局加速钟：04:58:00 → 05:12:00，真实用时 12 秒（= 70 钟秒/秒）。 */
export const DAWN_CLOCK = { from: '04:58:00', to: '05:12:00', realSec: 12, rate: 70 } as const;
/** 时辰过场时长（远钟 + HUD 字样变化）。 */
export const SHICHEN_TRANSITION_SEC = 2;

// ---------------------------------------------------------------- 取景器 OSD 日期（GDD §3.10）
export const GAME_DATE = { before: '2026-08-27 周四', after: '2026-08-28 周五' } as const;
/** 按钟点（当日秒数）给 OSD 日期：00:00 前（12:00–23:59）是 08-27 周四，之后是 08-28 周五。 */
export function osdDateForClock(clockSec: number): string {
  const t = ((clockSec % 86400) + 86400) % 86400;
  return t >= 12 * 3600 ? GAME_DATE.before : GAME_DATE.after;
}
/** 片尾与南柯的固定 OSD（GDD §8.9）。 */
export const OSD_FIXED = {
  epilogue: 'CH1 2026-08-28 周五 08:12:40',
  nanke: 'CH1 2026-08-29 周六 06:40',
} as const;

// ---------------------------------------------------------------- 录像带 it.tape_830（GDD §3.8）
export const TAPE = {
  startLabel: '2023-08-29 周二 22:00:00',
  start: '22:00:00',
  end: '06:00:00',
  /** 22:00:00 → 06:00:00 */
  lengthSec: 28800,
  dateBefore: '2023-08-29 周二',
  dateAfter: '2023-08-30 周三',
  /** 此前延时录像：1× = 120 带子秒/真实秒；此后实时：1× = 1 */
  timelapseUntil: '02:51:00',
  timelapseRate: 120,
  alarmFrom: '02:51:00',
  /** 从这里起左 CH1 | 右 CH2 双分屏 */
  splitFrom: '02:51:00',
  /** 快进/倒退倍率 */
  shuttleRate: 16,
  /** 快进进入即降到 1×，屏角闪“SLOW” */
  slowZone: ['03:13:30', '03:14:30'],
  /** [ ] 跳转的 7 个索引点 */
  index: ['23:04:00', '00:30:00', '02:51:00', '03:12:00', '03:14:00', '03:16:00', '05:12:00'],
  /** pt.tape_face 的暂停窗口 */
  faceWindow: ['03:14:00', '03:14:15'],
  /** 到达或越过即设 r1.tape_watched */
  watchedAt: '03:16:00',
  /** 带子里的事件（GDD §3.8） */
  events: {
    sleeve: ['23:04:00', '23:06:00'],
    steps: ['00:30:00', '01:10:00'],
    alarm: '02:51:00',
    walkOut: '03:12:00',
    face: ['03:14:00', '03:14:15'],
    backInside: '03:16:00',
    dawn: '05:12:00',
  },
} as const;

/** 挂钟时刻 'HH:MM[:SS]' → 带子秒（0 = 22:00:00，跨过午夜继续累加；06:00:00 = 28800）。 */
export function tapeSec(tc: string): number {
  const s = parseTc(tc) - parseTc(TAPE.start);
  return s < 0 ? s + 86400 : s;
}
/** 带子秒 → 挂钟 'HH:MM:SS'。 */
export function tapeClock(sec: number): string {
  return formatTc(sec + parseTc(TAPE.start));
}
/** 带子秒 → OSD 日期（00:00:00 跨到 08-30 周三）。 */
export function tapeDate(sec: number): string {
  return sec < 2 * 3600 ? TAPE.dateBefore : TAPE.dateAfter;
}

// ---------------------------------------------------------------- 其他玩法时长（全部是游戏时间）
export const TIMING = {
  /** 区域切换淡出淡入（ARCH §4.5） */
  areaFadeSec: 0.8,
  /** R2 楼层切换 */
  floorFadeSec: 0.4,
  /** ?test=1 时淡入淡出时长乘数 */
  testFadeScale: 0.05,
  /** areas.isLoading() 持续这么久才显示“载入中…”（真实时间，ms） */
  loadingDelayMs: 300,
  /** E.say / 字幕默认时长：每字 0.12 秒，最少 2 秒 */
  saySecPerChar: 0.12,
  sayMinSec: 2,
  /**
   * M4：字幕与反馈条在屏幕上的停留（只管显示，不改过场节拍）：字幕每字 0.17 秒、最少 2.5 秒，反馈条每字 0.15 秒；
   * “……”“——”各算 1 个字（中文游戏字幕每秒 5–6 字比较舒服；原来每秒 8–10 字，边走边读来不及）。显式给了时长的不受影响。
   */
  subReadSecPerChar: 0.17,
  subReadMinSec: 2.5,
  toastReadSecPerChar: 0.15,
  /** 三级提示冷却（每级，按谜题分别计时） */
  hintCooldownSec: 60,
  /** 空闲闪烁：无 flag 变化且无交互这么久 → 目标角标闪一次 */
  hintIdleSec: 120,
  /** 快门白闪 80ms；减少闪光时短于 shortFlashSec 的白闪（快门、镁光灯）直接不闪（M1d，GDD §10.4） */
  flashMs: 80,
  /** 柔和白闪的最短时长（M1d 起不再使用：减少闪光时短闪不闪、长的淡入白按自身时长柔化；保留以免改动冻结的数据表） */
  softFlashSec: 0.25,
  /** M1d：短于它的白闪算“闪光”（快门、镁光灯），减少闪光时直接不闪 */
  shortFlashSec: 0.3,
  /** 三脚架：定时与曝光 */
  tripodCountdownSec: 10,
  tripodStillSec: 3,
  /** REC 灯闪烁周期 */
  recBlinkSec: 1,
} as const;
