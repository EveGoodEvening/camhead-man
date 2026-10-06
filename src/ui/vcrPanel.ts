// owner: WP6
// 录像机面板（ARCH §7；GDD §10.2）：CRT 占画面中央，底部传输控件与 7 个索引刻度、SLOW/ALARM。
// 数据来源：读 game.sys.vcr。UI 只读系统状态、只通过 game.dispatch() 或系统公开方法发起动作，不直接改状态。
// CRT 画面本身（带 OSD/ALARM 的 3D 屏幕）在场景里，面板视点正对着它；这里只画屏幕下方的机器面板：
// 荧光计数器（日期 + 带子时间码 + 走带状态）、SLOW/ALARM 指示灯、传输键、刻着 7 个索引点的索引条。
// 按键与键盘同一套 Action：空格 {t:'play'}、按住 Z/C {t:'shuttle',dir,down}、逗号/句号 {t:'stepSec'}、[ ] {t:'index'}。

import type { Game } from '../core/game';
import type { Action } from '../core/actions';
import type { View } from './ui';
import { STRINGS } from '../data/strings';
import { TAPE, tapeDate, tapeSec } from '../data/time';
import { h, keyHints, setClass, setShown, setStyle, setText, stackHas, uiButton } from './dom';

/** 索引条上一格的横向位置（0–1）。 */
function tapeFrac(sec: number): number {
  return Math.min(1, Math.max(0, sec / TAPE.lengthSec));
}

/** 相距不到 minGap（条长比例）的索引点合成一个标签：'03:12/14/16'。 */
export function indexLabelGroups(index: readonly string[], minGap = 0.03): { label: string; frac: number }[] {
  const out: { label: string; frac: number; last: number }[] = [];
  for (const tc of index) {
    const f = tapeFrac(tapeSec(tc));
    const hm = tc.slice(0, 5);
    const g = out[out.length - 1];
    if (g && f - g.last < minGap) {
      g.label += `/${hm.slice(3)}`;
      g.last = f;
    } else {
      out.push({ label: hm, frac: f, last: f });
    }
  }
  return out.map(({ label, frac }) => ({ label, frac }));
}

export class VcrPanel implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private readonly deck: HTMLElement;
  private readonly vfdDate: HTMLElement;
  private readonly vfdTc: HTMLElement;
  private readonly vfdState: HTMLElement;
  private readonly slow: HTMLElement;
  private readonly alarm: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly rewBtn: HTMLButtonElement;
  private readonly ffBtn: HTMLButtonElement;
  private readonly head: HTMLElement;
  private held: -1 | 1 | 0 = 0;
  private shown = false;
  private t = 0;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-vcrpanel');
    this.deck = h('div', 'cm-deck');
    const row = h('div', 'cm-deck-row');

    const vfd = h('div', 'cm-vfd');
    this.vfdDate = h('span', 'cm-vfd-date');
    this.vfdTc = h('span', 'cm-vfd-tc');
    this.vfdState = h('span', 'cm-vfd-state');
    vfd.append(this.vfdDate, this.vfdTc, this.vfdState);

    const tr = h('div', 'cm-transport');
    this.rewBtn = this.holdButton('◀◀', -1);
    this.ffBtn = this.holdButton('▶▶', 1);
    this.playBtn = uiButton('▶', '', () => this.send({ t: 'play' }));
    tr.append(
      uiButton('[◀', '', () => this.send({ t: 'index', dir: -1 })),
      this.rewBtn,
      uiButton('◀|', '', () => this.send({ t: 'stepSec', dir: -1 })),
      this.playBtn,
      uiButton('|▶', '', () => this.send({ t: 'stepSec', dir: 1 })),
      this.ffBtn,
      uiButton('▶]', '', () => this.send({ t: 'index', dir: 1 })),
    );

    const lamps = h('div', 'cm-lamps');
    this.slow = h('span', 'cm-lamp cm-slow', STRINGS.hud.slow);
    this.alarm = h('span', 'cm-lamp cm-alarm', STRINGS.hud.alarm);
    lamps.append(this.slow, this.alarm);
    row.append(vfd, tr, lamps);

    // 索引条：22:00 → 06:00，7 个索引刻度、降速区、报警之后的区段
    const index = h('div', 'cm-index');
    const bar = h('div', 'cm-index-bar');
    const slowBand = h('div', 'cm-index-slow');
    const a = tapeFrac(tapeSec(TAPE.slowZone[0]));
    const b = tapeFrac(tapeSec(TAPE.slowZone[1]));
    slowBand.style.left = `${(a * 100).toFixed(2)}%`;
    slowBand.style.width = `${Math.max(0.4, (b - a) * 100).toFixed(2)}%`;
    const alarmBand = h('div', 'cm-index-alarm');
    alarmBand.style.left = `${(tapeFrac(tapeSec(TAPE.alarmFrom)) * 100).toFixed(2)}%`;
    bar.append(alarmBand, slowBand);
    index.append(bar);
    for (const x of TAPE.index) {
      const tick = h('div', 'cm-index-tick');
      tick.style.left = `${(tapeFrac(tapeSec(x)) * 100).toFixed(2)}%`;
      index.append(tick);
    }
    // 标签：挨得太近的索引点（03:12/03:14/03:16 在 8 小时的条上几乎重合）合成一个标签，相邻标签上下错开两排
    indexLabelGroups(TAPE.index).forEach((grp, i) => {
      const lbl = h('div', 'cm-index-lbl', grp.label);
      lbl.style.left = `${(grp.frac * 100).toFixed(2)}%`;
      // M1d：两排的间距要大于标签行高（em 按标签自己的字号算；1.9em 时 02:51 与 03:12/14/16 两排还叠着 ~0.25em）
      if (i % 2 === 1) lbl.style.top = '2.2em';
      index.append(lbl);
    });
    for (const [tc, align] of [[TAPE.start, 'left'], [TAPE.end, 'right']] as const) {
      const lbl = h('div', 'cm-index-lbl', tc.slice(0, 5));
      lbl.style.left = align === 'left' ? '0%' : '100%';
      lbl.style.transform = align === 'left' ? 'none' : 'translateX(-100%)';
      lbl.style.top = '-1.3em';
      index.append(lbl);
    }
    this.head = h('div', 'cm-index-head');
    index.append(this.head);

    this.deck.append(row, index, keyHints([['空格', '播放/暂停'], ['按住 Z/C', '倒退/快进 ×16'], [',/.', '逐秒'], ['[ ]', '索引点'], ['右键', '取景器'], ['E/Esc', '离开']]));
    this.el.append(this.deck);
    this.deck.addEventListener('mousedown', ev => ev.preventDefault());
    setShown(this.el, false);
  }

  show(_arg?: unknown): void {
    this.shown = true;
    setShown(this.el, true);
    this.update(0);
  }
  hide(): void {
    // 面板已经关了：不再发“松开”（此时栈顶不是录像机，发了也只会得到 mode_disallows），走带状态由 PanelVcrMode.exit 复位
    this.held = 0;
    this.shown = false;
    setShown(this.el, false);
  }

  update(dt: number): void {
    this.t += dt;
    if (!this.shown) return;
    const g = this.game;
    const v = g.sys.vcr;
    const tc = v.tc;
    setText(this.vfdDate, tapeDate(tc));
    setText(this.vfdTc, v.tcString());
    const st = v.shuttle > 0 ? '▶▶ ×16' : v.shuttle < 0 ? '◀◀ ×16' : v.playing ? (tc < tapeSec(TAPE.timelapseUntil) ? '▶ 延时' : '▶') : '❚❚';
    setText(this.vfdState, st);
    setText(this.playBtn, v.playing ? '❚❚' : '▶');
    setClass(this.playBtn, 'cm-on', v.playing && v.shuttle === 0);
    setClass(this.rewBtn, 'cm-on', v.shuttle < 0);
    setClass(this.ffBtn, 'cm-on', v.shuttle > 0);
    // SLOW：播放头在 03:13:30–03:14:30 且在走带时闪（快进进入即降到 1×，GDD §3.8）
    const inSlow = tc >= tapeSec(TAPE.slowZone[0]) && tc <= tapeSec(TAPE.slowZone[1]);
    const moving = v.playing || v.shuttle !== 0;
    setClass(this.slow, 'cm-on', inSlow);
    setClass(this.slow, 'cm-blinkoff', inSlow && moving && (this.t % 0.8) >= 0.4);
    setClass(this.alarm, 'cm-on', tc >= tapeSec(TAPE.alarmFrom));
    setStyle(this.head, 'left', `${(tapeFrac(tc) * 100).toFixed(3)}%`);
    // 叠加取景器时面板让位：传输键仍有效（ARCH §4.6 叠加规则），走带状态改由取景器 HUD 右下角显示
    setShown(this.deck, !stackHas(g, 'mode.viewfinder'));
  }

  private send(a: Action): void {
    this.game.dispatch(a);
  }

  /** 按住才走的快进/倒退键：按下发 down:true，松开/移出发 down:false。 */
  private holdButton(label: string, dir: -1 | 1): HTMLButtonElement {
    const b = h('button', undefined, label);
    b.type = 'button';
    b.tabIndex = -1;
    b.addEventListener('mousedown', ev => ev.preventDefault());
    b.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      this.release();
      this.held = dir;
      this.send({ t: 'shuttle', dir, down: true });
    });
    const up = (): void => {
      if (this.held === dir) this.release();
      b.blur();
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('click', ev => { ev.stopPropagation(); b.blur(); });
    return b;
  }

  private release(): void {
    if (this.held === 0) return;
    const dir = this.held;
    this.held = 0;
    if (this.shown) this.send({ t: 'shuttle', dir, down: false });
  }
}
