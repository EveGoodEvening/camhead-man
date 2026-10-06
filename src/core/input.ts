// owner: WP1
// 键盘、鼠标、滚轮与指针锁定策略（ARCH §4.6）→ Button 事件与移动/视角轴；捕获阶段拦截浏览器默认按键。
//
// 数据流：DOM 回调只记录“按钮按下/松开”（入队，并同步通知 onButton 监听者）与鼠标位移累加；
// Game.step 第 1 步 beginFrame() 把本帧的队列与位移定格，第 2 步按**当时的**栈顶模式查 KEYMAP 翻译成 Action 并 dispatch。
// 翻译放在帧内而不是 DOM 回调里，是为了同一帧里连按两个键时，第二个键按第一个键生效后的模式解释（Tab 后紧跟 J）。

import type { Game } from './game';
import type { Action } from './actions';
import { KEYMAP, keymapButtons } from './actions';
import { STRINGS } from '../data/strings';

export type Button =
  | 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'ShiftLeft' | 'KeyE' | 'KeyQ' | 'KeyR' | 'KeyF' | 'KeyZ' | 'KeyC'
  | 'KeyJ' | 'KeyH' | 'Tab' | 'Escape' | 'Space' | 'Enter' | 'Backspace' | 'Comma' | 'Period'
  | 'BracketLeft' | 'BracketRight' | `Digit${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}` | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
  | 'MouseLeft' | 'MouseRight' | 'WheelUp' | 'WheelDown'
  /** M4：文档阅读器/巡夜本翻页（只经 onButton 给 UI，不进 KEYMAP） */
  | 'PageUp' | 'PageDown';

/**
 * 相机坐标系下的移动轴，|v| ≤ 1（WP1 约定，与 three 的相机空间一致）：
 * x = +1 向右（D）、−1 向左（A）；z = −1 向前（W）、+1 向后（S）。sprint = Shift（只在 explore 生效）。
 */
export interface MoveInput { x: number; z: number; sprint: boolean }
export type PointerPolicy = 'lock' | 'free';

/** 按下时产生的原始按钮事件（WP1 内部）。 */
export interface ButtonEvent { b: Button; down: boolean }

const KEY_CODES: readonly Button[] = [
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'KeyE', 'KeyQ', 'KeyR', 'KeyF', 'KeyZ', 'KeyC', 'KeyJ', 'KeyH',
  'Tab', 'Escape', 'Space', 'Enter', 'Backspace', 'Comma', 'Period', 'BracketLeft', 'BracketRight',
  'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown',
];
/** KeyboardEvent.code → Button（右 Shift、小键盘数字与回车并入主键区）。 */
const CODE_TO_BUTTON: ReadonlyMap<string, Button> = new Map<string, Button>([
  ...KEY_CODES.map(c => [c, c] as const),
  ['ShiftRight', 'ShiftLeft'],
  ['NumpadEnter', 'Enter'],
  ...Array.from({ length: 10 }, (_, n) => [`Numpad${n}`, `Digit${n}` as Button] as const),
]);

/** 1× 灵敏度下每像素转多少度。 */
const DEG_PER_PX = 0.1;
/** 未锁定时“按住左键拖拽”：松开时位移小于它才算一次点击（ARCH §4.6）。 */
const CLICK_SLOP_PX = 4;
/** 滚轮累计多少（像素当量）算一格；触控板的细碎事件会被合并。 */
const WHEEL_NOTCH = 50;
/** 连续两格滚轮的最短间隔（毫秒，真实时间：这是输入去抖，不是玩法计时）。 */
const WHEEL_MIN_GAP_MS = 60;
/** 意外解锁后这段时间内到达的 Esc keydown 视为解锁那一下的余波，丢弃（否则刚压入的暂停会被它立刻关掉）。 */
const ESC_AFTER_UNLOCK_MS = 250;
/** 刚锁定后这段时间内的 mousemove 丢弃（锁定切换时的位移尖峰；真实时间，输入去抖）。 */
const LOCK_SETTLE_MS = 80;
/** 单个 mousemove 超过这么多像素视为尖峰丢弃（正常甩鼠标一帧很少超过 200px）。 */
const MOVE_SPIKE_PX = 400;
/** M4 第 2 轮：从没锁上过又连续被拒这么多次 → 降级为拖拽转视角。 */
const LOCK_FAIL_FALLBACK = 2;
/** M4 第 2 轮：键盘自动重复只放行这些键（只通知 onButton 监听者：文档/巡夜本翻页、设置页滑块），其余一律丢弃。 */
const REPEATABLE: ReadonlySet<Button> = new Set<Button>(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']);

const INTERACTIVE = 'button, input, textarea, select, a, [contenteditable=""], [contenteditable="true"], [data-ui-interactive]';

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (t as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color'].includes(type);
}

const ZERO_MOVE: MoveInput = Object.freeze({ x: 0, z: 0, sprint: false });

export class InputManager {
  protected readonly game: Game;
  /** 锁定目标（renderer 的 canvas） */
  private target: HTMLElement | null = null;
  private attached = false;
  private readonly removers: (() => void)[] = [];
  private readonly mapped: ReadonlySet<Button> = keymapButtons();
  /** 当前按住的按钮（键盘与鼠标键） */
  private readonly held = new Set<Button>();
  private readonly listeners = new Set<(b: Button, down: boolean) => void>();
  private queue: ButtonEvent[] = [];
  private frameButtons: ButtonEvent[] = [];
  private accDx = 0;
  private accDy = 0;
  private frameLook = { dx: 0, dy: 0 };
  private override: MoveInput | null = null;
  private policy: PointerPolicy = 'lock';
  /** 脚本主动 exitPointerLock 触发的那次 pointerlockchange 不算“意外解锁” */
  private scriptExit = false;
  private lockPending = false;
  private lockFailedAt = Number.NEGATIVE_INFINITY;
  /** M4：冷却期内点击排的一次重试 */
  private lockRetry: number | null = null;
  /** M4 第 2 轮：连续被拒的次数（锁上一次就清零）与本页面是否锁上过 */
  private lockFails = 0;
  private everLocked = false;
  /** 当前按住的按钮里有没有 b（M4：按住模式的取景器在盖过它的模式关掉后检查右键是否还按着） */
  isHeld(b: Button): boolean {
    return this.held.has(b);
  }
  private unlockedAt = Number.NEGATIVE_INFINITY;
  private lockedAt = Number.NEGATIVE_INFINITY;
  private gateShown = false;
  private drag: { active: boolean; x0: number; y0: number; lastX: number; lastY: number; moved: number } = { active: false, x0: 0, y0: 0, lastX: 0, lastY: 0, moved: 0 };
  private wheelAcc = 0;
  private wheelLastEventAt = 0;
  private wheelLastStepAt = 0;
  /** 区域切换/楼层淡出期间锁输入（ARCH §4.5 第 1、7 步）：丢弃按钮、移动与视角。WP1 内部。 */
  suspended = false;

  constructor(game: Game) {
    this.game = game;
  }

  get pointerLocked(): boolean {
    return this.target !== null && typeof document !== 'undefined' && document.pointerLockElement === this.target;
  }
  /** 浏览器支持且不是 ?test=1/?nolock=1；M4 第 2 轮：指针锁定一直被拒（iframe 没有 allow="pointer-lock"、浏览器策略）时降级为拖拽转视角 */
  get lockAvailable(): boolean {
    if (this.game.url.test || this.game.url.nolock || this.dragFallback) return false;
    return typeof Element !== 'undefined' && 'requestPointerLock' in Element.prototype;
  }
  /**
   * M4 第 2 轮（WP1 内部）：本页面从没锁上过、又连续 LOCK_FAIL_FALLBACK 次被拒 → true，此后走“按住左键拖拽”（与 ?nolock=1 同一路径），
   * 收起“点击继续”（ARCH §4.6）。
   */
  dragFallback = false;
  /** 当前帧 WASD 轴 */
  get move(): MoveInput {
    if (this.override) return this.override;
    if (this.suspended) return ZERO_MOVE;
    const x = (this.held.has('KeyD') ? 1 : 0) - (this.held.has('KeyA') ? 1 : 0);
    const z = (this.held.has('KeyS') ? 1 : 0) - (this.held.has('KeyW') ? 1 : 0);
    const len = Math.hypot(x, z);
    const k = len > 1 ? 1 / len : 1;
    return { x: x * k, z: z * k, sprint: this.held.has('ShiftLeft') };
  }
  /** 本帧鼠标位移（已乘灵敏度、Y 反转；单位：度，dx>0 向右转，dy>0 向下看）；锁定不可用时来自“按住左键拖拽” */
  get lookDelta(): { dx: number; dy: number } {
    return this.frameLook;
  }

  /** 帧开始：定格本帧的按钮队列与鼠标位移（ARCH §3.2 第 1 步）。 */
  beginFrame(): void {
    // 暂停页开着时照常收键（M1d）：暂停冻结世界，不会与过渡里的淡入淡出抢输入；否则暂停页上的 Esc 被丢掉
    if (this.suspended && !this.pauseOnTop()) {
      this.queue = [];
      this.accDx = this.accDy = 0;
    }
    this.frameButtons = this.queue;
    this.queue = [];
    const s = this.game.settings;
    const k = DEG_PER_PX * (s.mouseSens > 0 ? s.mouseSens : 1);
    this.frameLook = { dx: this.accDx * k, dy: this.accDy * k * (s.invertY ? -1 : 1) };
    this.accDx = this.accDy = 0;
  }
  /** 有任何移动键按下（长曝光判定用） */
  moveActive(): boolean {
    if (this.override) return this.override.x !== 0 || this.override.z !== 0;
    return this.held.has('KeyW') || this.held.has('KeyA') || this.held.has('KeyS') || this.held.has('KeyD');
  }
  /** 模式切换时由 ModeStack 调用（ARCH §4.6 策略表） */
  applyPolicy(p: PointerPolicy): void {
    this.policy = p;
    if (!this.attached) return;
    if (p === 'free') {
      if (this.pointerLocked) {
        this.scriptExit = true;
        document.exitPointerLock();
      }
    } else if (this.lockAvailable && !this.pointerLocked && this.inGame() && this.userActivationActive()) {
      // 由点击触发的模式切换（暂停菜单“继续”、面板按钮）还带着用户激活，可以直接请求；否则等“点击继续”
      this.requestPointerLock();
    }
    this.updateGate();
  }
  /** requestPointerLock().catch(() => {})；被拒绝则 1 秒后在下一次点击时重试 */
  requestPointerLock(): void {
    const el = this.target;
    if (!el || !this.lockAvailable || this.pointerLocked || this.lockPending) return;
    const since = performance.now() - this.lockFailedAt;
    if (since < 1000) {
      // M4（ARCH §4.6“被拒绝则 1 秒后重试一次”）：冷却期内的点击不再被吞掉，排一次冷却结束后的重试
      // （点击带来的用户激活有 5 秒有效期，覆盖这段等待；真实时间，输入基础设施，不是玩法计时）
      if (this.lockRetry === null) {
        this.lockRetry = window.setTimeout(() => {
          this.lockRetry = null;
          this.requestPointerLock();
        }, 1000 - since + 30);
      }
      return;
    }
    this.lockPending = true;
    let r: unknown;
    try {
      r = el.requestPointerLock();
    } catch {
      this.onLockError();
      return;
    }
    // 老浏览器返回 undefined（失败走 pointerlockerror）；新浏览器返回 Promise，必须 catch，否则变成未处理的 rejection
    if (r instanceof Promise) r.then(() => undefined, () => this.onLockError());
  }
  onButton(fn: (b: Button, down: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  /** 仅 player.walkTo()/调试 walk() 使用：覆盖本帧移动轴（null = 还给键盘） */
  setMove(m: MoveInput | null): void {
    this.override = m ? { x: m.x, z: m.z, sprint: m.sprint } : null;
  }
  /** 移除全部 DOM 监听（context lost / 测试用）。 */
  dispose(): void {
    for (const r of this.removers.splice(0)) r();
    this.attached = false;
    this.releaseAll();
    if (this.pointerLocked) {
      this.scriptExit = true;
      document.exitPointerLock();
    }
  }

  // ---------------------------------------------------------------- WP1 内部
  /** Game.boot 调用：挂 DOM 监听（构造函数里不碰 DOM 以外的系统）。 */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.target = this.game.renderer.domElement;
    // fn 的参数写成 never：各监听器按事件类型声明自己的参数（KeyboardEvent/MouseEvent…），这里只负责登记与移除
    const on = (t: EventTarget, type: string, fn: (e: never) => void, o?: AddEventListenerOptions): void => {
      const h = fn as unknown as EventListener;
      t.addEventListener(type, h, o);
      this.removers.push(() => t.removeEventListener(type, h, o));
    };
    on(window, 'keydown', (e: KeyboardEvent) => this.onKeyDown(e), { capture: true });
    on(window, 'keyup', (e: KeyboardEvent) => this.onKeyUp(e), { capture: true });
    on(window, 'mousedown', (e: MouseEvent) => this.onMouseDown(e));
    on(window, 'mouseup', (e: MouseEvent) => this.onMouseUp(e));
    on(window, 'mousemove', (e: MouseEvent) => this.onMouseMove(e));
    on(window, 'wheel', (e: WheelEvent) => this.onWheel(e), { passive: false });
    on(window, 'contextmenu', (e: Event) => e.preventDefault());
    on(window, 'blur', () => this.releaseAll());
    on(document, 'pointerlockchange', () => this.onLockChange());
    on(document, 'pointerlockerror', () => this.onLockError());
    this.applyPolicy(this.policy);
  }

  /** Game.step 第 2 步：本帧定格的按钮事件。 */
  takeFrameButtons(): ButtonEvent[] {
    const out = this.frameButtons;
    this.frameButtons = [];
    return out;
  }

  /** 按当前栈顶模式把按钮翻译成 Action（右键的“切换/按住”按设置处理，ARCH §4.6）。 */
  translate(b: Button, down: boolean): Action | null {
    const bind = KEYMAP[this.game.modes.top][b];
    if (!bind) return null;
    const a = bind(down);
    if (!a) return null;
    if (a.t === 'vf' && this.game.settings.vfMode !== 'hold') return down ? { t: 'vf' } : null;
    return a;
  }

  /** 注入一个按钮事件（与真实按键同一路径；WP1 自测与调试用）。 */
  inject(b: Button, down: boolean): void {
    this.emit(b, down);
  }

  private inGame(): boolean {
    return this.game.areas.current !== null;
  }

  private userActivationActive(): boolean {
    const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    return ua?.isActive === true;
  }

  private emit(b: Button, down: boolean): void {
    if (down) {
      if (this.held.has(b)) return;
      this.held.add(b);
    } else {
      if (!this.held.has(b)) return;
      this.held.delete(b);
    }
    // M4 第 2 轮：菜单页（标题、暂停、设置）开着时，按下的键由 UI 的监听者（菜单）消费，不再进队列翻译成游戏动作——
    // 否则在暂停页按 Enter 选“继续”，同一下 Enter 在下一帧按“当时的”栈顶（对话、密码锁、挑选器）再翻译一次（跳台词、多确认一位）；
    // 标题页上的 Tab/J 也不会把看不见的相册、巡夜本压进栈。必须在通知监听者**之前**读：监听者会同步关掉暂停页。
    // Esc 照旧入队（暂停流程里设置页的返回、暂停页的“继续”靠 PauseMode 的 back）；松开事件照常入队（无害）。
    const menuOpen = down && b !== 'Escape' && this.menuPage() !== 'none';
    this.notify(b, down);
    if (menuOpen) return;
    if (!this.suspended || this.pauseOnTop()) this.queue.push({ b, down });
  }

  private notify(b: Button, down: boolean): void {
    for (const fn of this.listeners) fn(b, down);
  }

  /** 当前菜单页（node 侧自测的假 Game 没有 UI：当作没有菜单）。 */
  private menuPage(): string {
    const menus = (this.game.ui as { menus?: { currentPage(): string } } | undefined)?.menus;
    return menus ? menus.currentPage() : 'none';
  }

  private pauseOnTop(): boolean {
    return this.game.modes.top === 'mode.pause';
  }

  /** 滚轮之类没有“按住”的按钮：按下立刻松开。 */
  private tap(b: Button): void {
    this.emit(b, true);
    this.emit(b, false);
  }

  private releaseAll(): void {
    for (const b of [...this.held]) this.emit(b, false);
    this.drag.active = false;
    this.accDx = this.accDy = 0;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (isTextField(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const b = CODE_TO_BUTTON.get(e.code);
    if (!b) return;
    // 防止 Tab 移走焦点、Space/Enter 触发 DOM 按钮、方向键/空格滚动页面（ARCH §4.6）
    if (this.mapped.has(b)) e.preventDefault();
    if (e.repeat) {
      // M4 第 2 轮：按住方向键/PageUp/PageDown 连续翻页、连续调滑块——只通知 UI 的监听者，不改 held、不入队（不产生游戏动作）
      if (REPEATABLE.has(b) && this.held.has(b)) this.notify(b, true);
      return;
    }
    if (b === 'Escape' && (this.pointerLocked || performance.now() - this.unlockedAt < ESC_AFTER_UNLOCK_MS)) return;
    this.emit(b, true);
  }

  private onKeyUp(e: KeyboardEvent): void {
    const b = CODE_TO_BUTTON.get(e.code);
    if (!b) return;
    if (this.mapped.has(b) && !isTextField(e.target)) e.preventDefault();
    this.emit(b, false);
  }

  /**
   * 点在 UI 上的鼠标键归 UI，不当作游戏输入（engine-wp6.md #14）：UI 各层 pointer-events:none，只有可点元素
   * （按钮、相册格子、面板、对话框、菜单、“点击继续”）能成为事件目标，所以“目标在 UI 根下”就是点在界面上——
   * 否则一次点击会被 UI 的 click（pick/choose/按钮）与这里的 MouseLeft（挑选器确认、取景器快门）各处理一次。
   * UI 根之外的 DOM 控件（按钮、输入框、带 data-ui-interactive 的元素）同理。指针锁定时事件目标恒为 canvas。
   */
  private onGameSurface(t: EventTarget | null): boolean {
    if (this.pointerLocked) return true;
    if (!(t instanceof Element)) return false;
    if (t === this.target) return true;
    if (this.game.ui.isUiEventTarget(t)) return false;
    return t.closest(INTERACTIVE) === null;
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0 && e.button !== 2) return;
    if (!this.onGameSurface(e.target)) return;
    if (e.button === 2) {
      this.emit('MouseRight', true);
      return;
    }
    if (this.pointerLocked) {
      this.emit('MouseLeft', true);
      return;
    }
    if (!this.lockAvailable) {
      // 拖拽转视角：点击与否等松开时按位移判断
      this.drag = { active: true, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: 0 };
      return;
    }
    if (this.policy === 'lock' && this.inGame()) {
      // 这一下点击用来重新锁定（用户手势），不当作快门
      this.requestPointerLock();
      return;
    }
    this.emit('MouseLeft', true);
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button === 2) {
      this.emit('MouseRight', false);
      return;
    }
    if (e.button !== 0) return;
    if (this.drag.active) {
      this.drag.active = false;
      if (this.drag.moved < CLICK_SLOP_PX) this.tap('MouseLeft');
      return;
    }
    this.emit('MouseLeft', false);
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.pointerLocked) {
      // 刚锁定的那一下与偶发的尖峰：Chrome 在锁定切换前后会报一次“从上次位置到这里”的巨大 movementX（M1c 试玩时视角一下转了两百多度），丢掉
      if (performance.now() - this.lockedAt < LOCK_SETTLE_MS || Math.abs(e.movementX) > MOVE_SPIKE_PX || Math.abs(e.movementY) > MOVE_SPIKE_PX) return;
      this.accDx += e.movementX;
      this.accDy += e.movementY;
      return;
    }
    if (!this.drag.active) return;
    if ((e.buttons & 1) === 0) {
      this.drag.active = false;
      return;
    }
    // 用 clientX 差分而不是 movementX：合成事件（Playwright）不一定带 movementX
    this.accDx += e.clientX - this.drag.lastX;
    this.accDy += e.clientY - this.drag.lastY;
    this.drag.lastX = e.clientX;
    this.drag.lastY = e.clientY;
    this.drag.moved = Math.max(this.drag.moved, Math.hypot(e.clientX - this.drag.x0, e.clientY - this.drag.y0));
  }

  private onWheel(e: WheelEvent): void {
    const row = KEYMAP[this.game.modes.top];
    // 当前模式不用滚轮（相册、巡夜本、阅读器）时让页面照常滚动 UI
    if (!row.WheelUp && !row.WheelDown) return;
    e.preventDefault();
    const now = performance.now();
    if (now - this.wheelLastEventAt > 200) this.wheelAcc = 0;
    this.wheelLastEventAt = now;
    const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    this.wheelAcc += e.deltaY * scale;
    if (Math.abs(this.wheelAcc) < WHEEL_NOTCH || now - this.wheelLastStepAt < WHEEL_MIN_GAP_MS) return;
    const b: Button = this.wheelAcc < 0 ? 'WheelUp' : 'WheelDown';
    this.wheelAcc = 0;
    this.wheelLastStepAt = now;
    this.tap(b);
  }

  private onLockChange(): void {
    this.lockPending = false;
    if (this.pointerLocked) {
      this.lockedAt = performance.now();
      this.accDx = this.accDy = 0;
      this.lockFails = 0;
      this.everLocked = true;
      this.updateGate();
      return;
    }
    this.unlockedAt = performance.now();
    // 解锁时鼠标键的松开事件可能收不到
    if (this.held.has('MouseLeft')) this.emit('MouseLeft', false);
    if (this.held.has('MouseRight')) this.emit('MouseRight', false);
    if (this.scriptExit) {
      this.scriptExit = false;
    } else if (this.policy === 'lock' && this.inGame() && this.game.modes.top !== 'mode.pause') {
      // 意外解锁（典型是玩家按了 Esc）→ 暂停菜单（ARCH §4.6）；区域/楼层过渡期间推迟到过渡结束（M1d，Game.requestPause）
      this.game.requestPause();
    }
    this.updateGate();
  }

  private onLockError(): void {
    this.lockPending = false;
    this.lockFailedAt = performance.now();
    this.lockFails++;
    // M4 第 2 轮：本页面从没锁上过、又连续被拒 → 降级为按住左键拖拽转视角（iframe 缺 allow="pointer-lock"、浏览器策略禁用），
    // 收起“点击继续”（否则玩家永远卡在遮罩上），并说一次怎么转视角
    if (!this.everLocked && this.lockFails >= LOCK_FAIL_FALLBACK && !this.dragFallback) {
      this.dragFallback = true;
      if (this.lockRetry !== null) {
        window.clearTimeout(this.lockRetry);
        this.lockRetry = null;
      }
      this.game.ui.toast(STRINGS.boot.lockFallback, 'system');
    }
    this.updateGate();
  }

  private updateGate(): void {
    const show = this.attached && this.policy === 'lock' && this.lockAvailable && !this.pointerLocked && this.inGame();
    if (show === this.gateShown) return;
    this.gateShown = show;
    if (show) this.game.ui.pointerGate.show();
    else this.game.ui.pointerGate.hide();
  }
}
