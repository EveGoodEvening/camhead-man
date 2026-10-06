// owner: WP6
// 三脚架 HUD（ARCH §7；GDD §10.2）：CH1 画面 OSD 倒计时，曝光时中央进度环“保持不动”。
// 数据来源：读 game.sys.tripod。UI 只读系统状态、只通过 game.dispatch() 或系统公开方法发起动作，不直接改状态。
// OSD 行是区域给的 TripodConfig.osd(remaining)，经 TripodSystem.osdText()（M1c 冻结，engine-wp6.md #9）；区域没给时退回 shichen.osdLine(1)。
// 倒计时另画在右上角。

import type { Game } from '../core/game';
import type { View } from './ui';
import { STRINGS } from '../data/strings';
import { TIMING } from '../data/time';
import { h, keyHints, setClass, setShown, setStyle, setText } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RING_R = 42;
const RING_LEN = 2 * Math.PI * RING_R;

export class TripodHud implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private readonly osd: HTMLElement;
  private readonly rec: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly timerNum: HTMLElement;
  private readonly timerLbl: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly ringFg: SVGCircleElement;
  private readonly still: HTMLElement;
  private readonly keysArmed: HTMLElement;
  private shown = false;
  private t = 0;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-tp');
    const frame = h('div', 'cm-frame');
    const top = h('div', 'cm-tp-osd cm-vf-top');
    this.rec = h('div', 'cm-vf-rec');
    this.rec.append(h('span', 'cm-rec-dot'), document.createTextNode(STRINGS.hud.rec));
    this.osd = h('span', 'cm-osd');
    top.append(this.rec, this.osd);

    this.timer = h('div', 'cm-tp-timer');
    this.timerNum = h('div', 'cm-osd');
    this.timerLbl = h('small', undefined, '定时');
    this.timer.append(this.timerNum, this.timerLbl);

    this.ring = h('div', 'cm-tp-ring');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    const bg = document.createElementNS(SVG_NS, 'circle');
    const fg = document.createElementNS(SVG_NS, 'circle');
    for (const c of [bg, fg]) {
      c.setAttribute('cx', '50');
      c.setAttribute('cy', '50');
      c.setAttribute('r', String(RING_R));
    }
    bg.setAttribute('class', 'cm-bg');
    fg.setAttribute('class', 'cm-fg');
    fg.setAttribute('stroke-dasharray', RING_LEN.toFixed(2));
    fg.setAttribute('stroke-dashoffset', RING_LEN.toFixed(2));
    svg.append(bg, fg);
    this.ringFg = fg;
    this.ring.append(svg);
    this.still = h('div', 'cm-tp-still', STRINGS.hud.keepStill);

    this.keysArmed = h('div', 'cm-tp-keys');
    this.keysArmed.append(keyHints([['左键', '开始定时'], ['WASD', '走过去'], ['E', '取消']]));
    frame.append(top, this.timer, this.ring, this.still, this.keysArmed);
    this.el.append(frame);
    setShown(this.el, false);
  }

  show(_arg?: unknown): void {
    this.shown = true;
    setShown(this.el, true);
    this.update(0);
  }
  hide(): void {
    this.shown = false;
    setShown(this.el, false);
  }

  update(dt: number): void {
    this.t += dt;
    if (!this.shown) return;
    const tp = this.game.sys.tripod;
    const st = tp.state;
    setText(this.osd, tp.osdText() || this.game.sys.shichen.osdLine(1));
    setClass(this.rec, 'cm-off', (this.t % TIMING.recBlinkSec) >= TIMING.recBlinkSec / 2);

    const counting = st === 'countdown';
    setShown(this.timer, counting || st === 'armed');
    const secs = counting ? Math.max(0, Math.ceil(tp.remaining)) : TIMING.tripodCountdownSec;
    setText(this.timerNum, `00:${String(secs).padStart(2, '0')}`);
    setText(this.timerLbl, counting ? '定时中' : '定时');

    const exposing = st === 'exposing';
    setShown(this.ring, exposing);
    setShown(this.still, exposing);
    if (exposing) {
      const f = Math.min(1, Math.max(0, tp.exposure01));
      this.ringFg.setAttribute('stroke-dashoffset', (RING_LEN * (1 - f)).toFixed(2));
    }
    setShown(this.keysArmed, st === 'armed');
    setStyle(this.el, 'opacity', st === 'off' ? '0' : '1');
  }
}
