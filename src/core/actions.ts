// owner: WP1
// Action 联合类型与 KEYMAP（模式 × 按键 → Action，照抄 GDD §10.1 与 ARCH 附录 A）。

import type { ApiResult, ModeId } from './types';
import type { NameId } from '../data/ids';
import type { Button } from './input';

export type Action =
  | { t: 'interact' }                              // E
  | { t: 'shutter' }                               // 左键
  | { t: 'vf'; down?: boolean }                    // 右键：toggle 模式下 down 省略；hold 模式下按下/松开
  | { t: 'lens' }                                  // Q
  | { t: 'zoom'; dir: 1 | -1 }                     // 滚轮
  | { t: 'rewind' }                                // R
  | { t: 'present' }                               // F
  | { t: 'play' }                                  // 空格（回放、录像机）
  | { t: 'advance' }                               // E/空格（对话）
  | { t: 'seekRel'; sec: number }                  // 回放 Z/C = ∓5
  | { t: 'shuttle'; dir: -1 | 1; down: boolean }   // 录像机按住 Z/C
  | { t: 'stepSec'; dir: -1 | 1 }                  // 逗号/句号
  | { t: 'index'; dir: -1 | 1 }                    // [ ]
  | { t: 'digit'; n: number }                      // 数字键（频道、密码）
  | { t: 'choose'; k: number | NameId }            // 选项（对话 1–4、称呼 1–6 或称呼 id）
  | { t: 'wheel'; dir: 1 | -1 }                    // 密码面板转轮
  | { t: 'confirm' } | { t: 'erase' }              // Enter / Backspace（挑选器里 Enter 也是 confirm）
  | { t: 'nav'; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }   // 方向键（相册/挑选器）
  | { t: 'pick'; index: number }                   // 鼠标点中相册/挑选器的第 index 格（UI 发出）
  | { t: 'album' } | { t: 'journal' } | { t: 'hint' }
  | { t: 'back' };                                 // Esc

/** pass=true 表示栈顶不处理，交给下一层。 */
export type ActionResult = ApiResult & { pass?: true };

/** 按键 → Action；down 为按下/松开。只在按下时产生动作的键，松开时返回 null。 */
export type KeyBinding = (down: boolean) => Action | null;

// ---------------------------------------------------------------- 绑定构造（只在本文件内用）
/** 只在按下时产生动作（键盘自动重复已在 InputManager 里滤掉）。 */
const press = (a: Action): KeyBinding => d => (d ? a : null);
/** 按下与松开都产生动作（右键的“按住”取景器、录像机的按住快进/快退）。 */
const vfKey: KeyBinding = d => ({ t: 'vf', down: d });
const shuttle = (dir: -1 | 1): KeyBinding => d => ({ t: 'shuttle', dir, down: d });

type Row = Partial<Record<Button, KeyBinding>>;

const DIGITS = ['Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'] as const;

/** Digit<a>…Digit<b> → f(n)。 */
function digits(a: number, b: number, f: (n: number) => Action): Row {
  const row: Row = {};
  for (let n = a; n <= b; n++) row[DIGITS[n]!] = press(f(n));
  return row;
}

const WHEEL_ZOOM: Row = { WheelUp: press({ t: 'zoom', dir: 1 }), WheelDown: press({ t: 'zoom', dir: -1 }) };

/** 录像机面板的传输键（panel_vcr 本身，以及叠在面板上的 viewfinder 以 pass 下传）。 */
const VCR_TRANSPORT: Row = {
  Space: press({ t: 'play' }),
  KeyZ: shuttle(-1),
  KeyC: shuttle(1),
  Comma: press({ t: 'stepSec', dir: -1 }),
  Period: press({ t: 'stepSec', dir: 1 }),
  BracketLeft: press({ t: 'index', dir: -1 }),
  BracketRight: press({ t: 'index', dir: 1 }),
};

/**
 * 模式 × 按键 → Action（ARCH 附录 A；GDD §10.1、§3.4）。
 *
 * 读法与取舍：
 * - WASD/Shift 与鼠标位移不是 Action：它们是 InputManager 的移动轴与视角增量，由栈顶模式的 move/look 决定是否生效（附录 A 最后三行）。
 * - 右键一律产生 { t:'vf', down }；设置为“切换”时 InputManager 丢弃松开、去掉 down 字段（ARCH §4.6 vf 注释）。
 * - 附录 A 里写“叠加取景器时…”的格子（面板列的快门/变焦）由叠在上面的 viewfinder 的 KEYMAP 提供，
 *   因为那时栈顶是 viewfinder；反过来，面板的传输键、频道数字键也写进 viewfinder 行，由 ViewfinderMode 以 pass 下传给面板
 *   （附录 A 表下第一条；viewfinder 不在面板上时这些动作得到 mode_disallows）。
 * - 写“（UI）”的格子（对话/称呼面板的点选、挑选器的左键确认）由 UI 直接 dispatch（choose/pick），不走按键。
 * - Esc 的 back 只在指针未锁定时到得了这里（锁定时浏览器吞掉 Esc 并解锁，InputManager 改为压入暂停，ARCH §4.6）。
 */
export const KEYMAP: Record<ModeId, Partial<Record<Button, KeyBinding>>> = {
  'mode.explore': {
    KeyE: press({ t: 'interact' }),
    MouseRight: vfKey,
    Tab: press({ t: 'album' }),
    KeyJ: press({ t: 'journal' }),
    KeyH: press({ t: 'hint' }),
    Escape: press({ t: 'back' }),
  },
  'mode.viewfinder': {
    KeyE: press({ t: 'interact' }),
    MouseLeft: press({ t: 'shutter' }),
    MouseRight: vfKey,
    KeyQ: press({ t: 'lens' }),
    ...WHEEL_ZOOM,
    KeyR: press({ t: 'rewind' }),
    Tab: press({ t: 'album' }),
    KeyJ: press({ t: 'journal' }),
    KeyH: press({ t: 'hint' }),
    Escape: press({ t: 'back' }),
    // 叠在面板上时下传给面板的传输键与频道键
    ...VCR_TRANSPORT,
    ...digits(0, 9, n => ({ t: 'digit', n })),
  },
  'mode.replay': {
    KeyE: press({ t: 'interact' }),
    MouseLeft: press({ t: 'shutter' }),
    MouseRight: vfKey,
    KeyQ: press({ t: 'lens' }),
    ...WHEEL_ZOOM,
    KeyR: press({ t: 'rewind' }),
    KeyF: press({ t: 'present' }),
    Space: press({ t: 'play' }),
    KeyZ: press({ t: 'seekRel', sec: -5 }),
    KeyC: press({ t: 'seekRel', sec: 5 }),
    Comma: press({ t: 'stepSec', dir: -1 }),
    Period: press({ t: 'stepSec', dir: 1 }),
    KeyH: press({ t: 'hint' }),
    Escape: press({ t: 'back' }),
  },
  'mode.panel_vcr': {
    KeyE: press({ t: 'interact' }),
    MouseRight: vfKey,
    ...VCR_TRANSPORT,
    KeyH: press({ t: 'hint' }),
    Escape: press({ t: 'back' }),
  },
  'mode.panel_console': {
    KeyE: press({ t: 'interact' }),
    MouseRight: vfKey,
    ...digits(1, 5, n => ({ t: 'digit', n })),
    KeyH: press({ t: 'hint' }),
    Escape: press({ t: 'back' }),
  },
  'mode.panel_code': {
    ...digits(0, 9, n => ({ t: 'digit', n })),
    WheelUp: press({ t: 'wheel', dir: 1 }),
    WheelDown: press({ t: 'wheel', dir: -1 }),
    Enter: press({ t: 'confirm' }),
    Backspace: press({ t: 'erase' }),
    Escape: press({ t: 'back' }),
  },
  'mode.panel_naming': {
    ...digits(1, 6, n => ({ t: 'choose', k: n })),
    Escape: press({ t: 'back' }),
  },
  'mode.dialogue': {
    KeyE: press({ t: 'advance' }),
    Space: press({ t: 'advance' }),
    // M4：Enter 也能推进（原来只有 E/空格）
    Enter: press({ t: 'advance' }),
    ...digits(1, 4, n => ({ t: 'choose', k: n })),
    // M4 第 2 轮：对话里 Esc = 暂停菜单（只压暂停，不取消对话；强制对话同样只是暂停）
    Escape: press({ t: 'back' }),
  },
  'mode.album': {
    ...digits(1, 2, n => ({ t: 'digit', n })),
    ArrowUp: press({ t: 'nav', dx: 0, dy: -1 }),
    ArrowDown: press({ t: 'nav', dx: 0, dy: 1 }),
    ArrowLeft: press({ t: 'nav', dx: -1, dy: 0 }),
    ArrowRight: press({ t: 'nav', dx: 1, dy: 0 }),
    Enter: press({ t: 'confirm' }),
    Tab: press({ t: 'album' }),
    KeyJ: press({ t: 'journal' }),
    Escape: press({ t: 'back' }),
  },
  'mode.journal': {
    Tab: press({ t: 'album' }),
    KeyJ: press({ t: 'journal' }),
    Escape: press({ t: 'back' }),
  },
  'mode.tripod': {
    KeyE: press({ t: 'interact' }),
    MouseLeft: press({ t: 'shutter' }),
  },
  'mode.cutscene': {
    MouseLeft: press({ t: 'shutter' }),
    ...WHEEL_ZOOM,
    Space: press({ t: 'play' }),
    // M4 第 2 轮：过场里 Esc = 暂停菜单（开场、终章这样的长段落也能调音量、字号）
    Escape: press({ t: 'back' }),
  },
  'mode.pause': {
    Escape: press({ t: 'back' }),
  },
};

/** KEYMAP 里出现过的全部按键：InputManager 在捕获阶段对它们 preventDefault（ARCH §4.6）。WP1 内部。 */
export function keymapButtons(): ReadonlySet<Button> {
  const out = new Set<Button>();
  for (const row of Object.values(KEYMAP)) for (const b of Object.keys(row) as Button[]) out.add(b);
  return out;
}
