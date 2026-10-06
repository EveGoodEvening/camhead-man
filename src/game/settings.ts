// owner: WP4
// 设置（ARCH §6.4）：localStorage `camhead-man.settings`，与 GDD §13.12 的 settings.* 一一对应。
//
// 存储格式：JSON 对象，键为 Settings 字段名（mouseSens…）；读取时也认 GDD 的 settings.* id 作键（SETTING_IDS 反查）。
// 读不出或字段非法时逐项用默认值补齐（不整体作废）。
// applySetting 是设置的唯一写入口（设置菜单与调试都走它）：写 game.settings、落盘、发 'settings'。
// 画质变化要重新进入当前区域（雨丝数量、阴影、RT 尺寸都在 build 时读取）。M1d：一律交给 Game.requestReenter('quality')，
// 由 Game.step 末尾在安全时执行（栈顶 explore/viewfinder、无临时模式、runner 空闲、没有结局 hold）；以前挂在 'mode' 事件上同步触发，
// 三脚架成功“先弹模式、再开结局 run”的那一下就会重进区域、把结局过场取消。

import type { QualityLevel } from '../core/types';
import { SETTING } from '../data/ids';
import type { SettingId } from '../data/ids';
import type { Game } from '../core/game';
import { SAVE_KEYS, storage } from './save';

export interface Settings {
  mouseSens: number; invertY: boolean; vfMode: 'toggle' | 'hold'; subSize: 0 | 1 | 2; grain: number;
  quality: QualityLevel; reduceFlash: boolean; colorAssist: boolean; hintNoCooldown: boolean;
  mirrorMode: 'rt' | 'baked'; tunnelMode: 'rt' | 'baked'; volume: number;
}

/** 默认值（quality 默认 'mid'，ARCH §13.2）。 */
export const DEFAULT_SETTINGS: Readonly<Settings> = {
  mouseSens: 1,
  invertY: false,
  vfMode: 'toggle',
  subSize: 1,
  grain: 1,
  quality: 'mid',
  reduceFlash: false,
  colorAssist: false,
  hintNoCooldown: false,
  mirrorMode: 'rt',
  tunnelMode: 'rt',
  volume: 0.8,
};

/** Settings 字段 ↔ GDD settings.* id（ARCH §6.4 的映射表）。 */
export const SETTING_IDS: Readonly<Record<keyof Settings, SettingId>> = {
  volume: SETTING.VOLUME,
  mouseSens: SETTING.MOUSE_SENS,
  invertY: SETTING.INVERT_Y,
  vfMode: SETTING.VF_MODE,
  subSize: SETTING.SUB_SIZE,
  grain: SETTING.GRAIN,
  quality: SETTING.QUALITY,
  reduceFlash: SETTING.REDUCE_FLASH,
  colorAssist: SETTING.COLOR_ASSIST,
  hintNoCooldown: SETTING.HINT_NO_COOLDOWN,
  mirrorMode: SETTING.MIRROR_MODE,
  tunnelMode: SETTING.TUNNEL_MODE,
};

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

/** 单项校验：合法返回规范化后的值，否则 undefined（调用方用默认值）。WP4 内部，自测也用它。 */
export function coerceSetting<K extends keyof Settings>(key: K, v: unknown): Settings[K] | undefined {
  const num = (lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);
  const bool = (): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
  const oneOf = <T extends string | number>(opts: readonly T[]): T | undefined => (opts as readonly unknown[]).includes(v) ? (v as T) : undefined;
  let out: unknown;
  switch (key) {
    case 'volume': out = num(0, 1); break;
    case 'mouseSens': out = num(0.1, 5); break;
    case 'grain': out = num(0, 2); break;
    case 'invertY': case 'reduceFlash': case 'colorAssist': case 'hintNoCooldown': out = bool(); break;
    case 'vfMode': out = oneOf(['toggle', 'hold'] as const); break;
    case 'subSize': out = oneOf([0, 1, 2] as const); break;
    case 'quality': out = oneOf(['low', 'mid', 'high'] as const); break;
    case 'mirrorMode': case 'tunnelMode': out = oneOf(['rt', 'baked'] as const); break;
  }
  return out as Settings[K] | undefined;
}

/** 从 localStorage 读设置（读不出/字段非法时用默认值补齐）。不读 URL：?quality= 覆盖由 Game 构造函数只在内存里做（ARCH §4.4）。 */
export function loadSettings(): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(SAVE_KEYS.settings) ?? null;
  } catch {
    raw = null;
  }
  if (raw === null) return out;
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof j !== 'object' || j === null) return out;
  const rec = j as Record<string, unknown>;
  const put = <K extends keyof Settings>(k: K): void => {
    const v = coerceSetting(k, k in rec ? rec[k] : rec[SETTING_IDS[k]]);
    if (v !== undefined) out[k] = v;
  };
  for (const k of KEYS) put(k);
  return out;
}

function persist(s: Settings): void {
  try {
    storage()?.setItem(SAVE_KEYS.settings, JSON.stringify(s));
  } catch {
    /* 只在内存中继续 */
  }
}

/**
 * 改一项设置（设置菜单与调试用；M1a 补写）：写 game.settings、存 localStorage、发 'settings' 事件；
 * quality 变化时 game.requestReenter('quality')（M1d：在 Game.step 末尾安全时重进，ARCH §6.4）。
 */
export function applySetting<K extends keyof Settings>(game: Game, key: K, value: Settings[K]): void {
  const v = coerceSetting(key, value);
  if (v === undefined) {
    console.error(`[settings] ${String(key)} 的值非法：${JSON.stringify(value)}`);
    return;
  }
  const prev = game.settings[key];
  game.settings[key] = v;
  persist(game.settings);
  if (prev === v) return;
  game.events.emit('settings', { key, value: v });
  if (key === 'quality') game.requestReenter('quality');
}
