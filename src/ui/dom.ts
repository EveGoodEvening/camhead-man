// owner: WP6
// UI 内部的 DOM 小工具与安全读取（WP6 内部模块，不属于冻结签名；ARCH §2.13 的“WP 内部模块”同类）。
// 所有按钮都经 uiButton 创建：tabindex="-1"、mousedown 不抢焦点、点击后立即 blur()（ARCH §4.6、§7）。

import type { Game } from '../core/game';
import type { ModeId } from '../core/types';
import type { PointerPolicy } from '../core/input';
import type { StateView } from '../game/state';
import type { Dyn } from '../game/interaction';

/** 建元素：h('div', 'cm-x', '文字') */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** 只在变化时写 textContent：每帧调用也不会触发无谓的重排。 */
export function setText(el: HTMLElement, s: string): void {
  if (el.textContent !== s) el.textContent = s;
}

/** 显隐统一用 .cm-hidden（display:none），避免与各组件自己的 display 冲突。 */
export function setShown(el: HTMLElement, on: boolean): void {
  el.classList.toggle('cm-hidden', !on);
}

/** 只在变化时切 class。 */
export function setClass(el: HTMLElement, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

/** 只在变化时写内联样式属性（transform、width 等每帧更新的值）。 */
/** prop 是 CSS 属性名（kebab-case，如 'margin-top'；M4 第 2 轮写明：camelCase 的 'marginTop' 在 setProperty 里静默无效）。 */
export function setStyle(el: HTMLElement, prop: string, value: string): void {
  if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
}

/**
 * DOM 按钮：tabindex=-1（Tab 不会把焦点移到按钮上，Space/Enter 不会误触发它，ARCH §4.6）；
 * mousedown 时 preventDefault，从源头上不让按钮拿到焦点；click 里再 blur() 一次兜底。
 */
export function uiButton(label: string, cls: string, onClick: (ev: MouseEvent) => void): HTMLButtonElement {
  const b = h('button', cls, label);
  b.type = 'button';
  b.tabIndex = -1;
  b.addEventListener('mousedown', ev => ev.preventDefault());
  b.addEventListener('click', ev => {
    b.blur();
    ev.stopPropagation();
    onClick(ev);
  });
  return b;
}

/** 让一个非 button 元素也可点：同样不抢焦点。 */
export function clickable(el: HTMLElement, onClick: (ev: MouseEvent) => void): void {
  el.classList.add('cm-click');
  el.addEventListener('mousedown', ev => ev.preventDefault());
  el.addEventListener('click', ev => {
    ev.stopPropagation();
    onClick(ev);
  });
}

/** Dyn<T> 现算（ARCH §6.6：角标、colorHint 按当前状态求值）。 */
export function evalDyn<T>(v: Dyn<T> | undefined, s: StateView): T | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'function' ? (v as (s: StateView) => T)(s) : v;
}

/** 读一个对象上的可选属性（值类型未知）。用于兼容其他 WP 可能额外提供的字段，见 engine-wp6.md。 */
export function readProp(obj: unknown, key: string): unknown {
  if (typeof obj !== 'object' || obj === null) return undefined;
  return (obj as Record<string, unknown>)[key];
}

/** 读数字属性，或无参方法返回的数字。 */
export function readNumber(obj: unknown, key: string): number | null {
  const v = readProp(obj, key);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'function') {
    const r: unknown = (v as (this: unknown) => unknown).call(obj);
    if (typeof r === 'number' && Number.isFinite(r)) return r;
  }
  return null;
}

export function readString(obj: unknown, key: string): string | null {
  const v = readProp(obj, key);
  return typeof v === 'string' ? v : null;
}

/** 栈上是否有某模式。 */
export function stackHas(game: Game, id: ModeId): boolean {
  return game.modes.stack.includes(id);
}

/** 栈顶模式按栈求值后的指针策略（ARCH §4.6 策略表）。 */
export function topPointerPolicy(game: Game): PointerPolicy {
  const stack = game.modes.stack;
  const h0 = game.modes.handler(game.modes.top);
  if (!h0) return 'free';
  return typeof h0.pointer === 'function' ? h0.pointer(stack) : h0.pointer;
}

/** 录像机/监控台面板上是否叠着取景器（ARCH §4.6 叠加规则）。 */
export function vfOnPanel(stack: readonly ModeId[]): boolean {
  const i = stack.indexOf('mode.viewfinder');
  if (i < 0) return false;
  return stack.slice(0, i).some(m => m === 'mode.panel_vcr' || m === 'mode.panel_console');
}

/** 键帽样式的小提示：kbd('E') */
export function kbd(key: string): HTMLElement {
  return h('span', 'cm-kbd', key);
}

/** “键 + 说明”组成的一行提示，如 [E] 离开　[右键] 取景器。 */
export function keyHints(pairs: readonly (readonly [string, string])[]): HTMLElement {
  const row = h('div', 'cm-keyhints');
  for (const [k, text] of pairs) {
    const item = h('span', 'cm-keyhint');
    item.append(kbd(k), document.createTextNode(text));
    row.append(item);
  }
  return row;
}

/** M4：全角标点包进 .cm-punct（标题的大字距下“，”不再被拉开成一个字的宽度）。 */
export function punctSpans(text: string): Node[] {
  const out: Node[] = [];
  let buf = '';
  for (const ch of text) {
    if (/[，。、：；！？“”‘’（）《》·—…]/.test(ch)) {
      if (buf) out.push(document.createTextNode(buf));
      buf = '';
      out.push(h('span', 'cm-punct', ch));
    } else buf += ch;
  }
  if (buf) out.push(document.createTextNode(buf));
  return out;
}
