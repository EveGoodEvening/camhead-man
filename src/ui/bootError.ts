// owner: WP6
// 启动失败页（ARCH §3.1、§7）：不支持 WebGL2、启动异常。不依赖 UI 实例（UI 可能根本没建起来），样式全部内联。
// 画成一路断了信号的监控画面：左上 OSD“CH1 · 无信号”，居中标题与中文说明，异常摘要用等宽小字。

import { STRINGS } from '../data/strings';
import { PALETTE } from '../data/palette';
import { FONT_STACK } from '../kit/text';

const MONO = `"DejaVu Sans Mono","Menlo","Consolas","Liberation Mono",${FONT_STACK}`;

function el(tag: string, css: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function showBootError(host: HTMLElement, kind: 'no_webgl2' | 'exception', detail?: string): void {
  host.querySelector(':scope > .cm-boot-error')?.remove();
  const box = el('div', [
    'position:absolute', 'inset:0', 'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
    'gap:14px', 'padding:24px', 'box-sizing:border-box', 'overflow:hidden', 'text-align:center', 'z-index:100',
    `background:radial-gradient(ellipse at 50% 40%, #16203a, ${PALETTE.NIGHT} 70%)`, `color:${PALETTE.PAPER}`,
    `font-family:${FONT_STACK}`, 'font-size:clamp(15px, calc(1.6vmin + 6px), 22px)', 'line-height:1.7',
  ].join(';'));
  box.className = 'cm-boot-error';
  box.setAttribute('role', 'alert');

  // 扫描线与暗角：纯装饰，不挡文字对比度
  box.append(el('div', 'position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(to bottom,rgba(0,0,0,0) 0 2px,rgba(0,0,0,0.25) 2px 3px)'));
  box.append(el('div', 'position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 20vmin rgba(0,0,0,0.85)'));

  const osd = el('div', `position:absolute;left:5%;top:5%;font-family:${MONO};color:${PALETTE.OSD};letter-spacing:0.08em;text-shadow:0 0 6px rgba(124,255,178,0.5)`);
  const dot = el('span', `display:inline-block;width:0.6em;height:0.6em;border-radius:50%;margin-right:0.6em;background:${PALETTE.REC};box-shadow:0 0 6px ${PALETTE.REC}`);
  osd.append(dot, document.createTextNode('CH1　—— 无信号'));
  box.append(osd);

  const title = el('div', `position:relative;font-size:2em;letter-spacing:0.3em;margin-right:-0.3em;color:#f4efe4;text-shadow:0 0 18px rgba(237,230,214,0.25)`, STRINGS.game.title);
  const sub = el('div', `position:relative;font-family:${MONO};color:${PALETTE.OSD};letter-spacing:0.3em;opacity:0.8;font-size:0.85em`, STRINGS.game.subtitle);
  const msg = el('div', 'position:relative;max-width:36em;margin-top:0.8em;padding:0.7em 1.4em;background:rgba(4,6,12,0.7);border:1px solid rgba(237,230,214,0.25)');
  if (kind === 'no_webgl2') {
    msg.textContent = STRINGS.boot.noWebgl2;
  } else {
    msg.append(document.createTextNode(STRINGS.boot.exception));
    if (detail) {
      const d = el('span', `font-family:${MONO};font-size:0.85em;color:#ffd9a0;word-break:break-all`, detail);
      msg.append(d);
    }
  }
  box.append(title, sub, msg);
  host.append(box);
}
