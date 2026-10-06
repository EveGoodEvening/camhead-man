// owner: WP6
// #fade 层（ARCH §7）：DOM 淡黑/白闪、时辰过场字样、过场标题卡、“载入中…”。
// 画面内（canvas）的淡黑与快门白闪走 PostPipeline 的 fade/flash 参数；本层盖在全部 UI 之上。计时用 update(dt) 传入的时间。
//
// 淡入淡出按 update(dt) 的时间推进（锁步测试里随 advance() 走）；?test=1 时时长 ×0.05（ARCH §3.1，与 TIMING.testFadeScale 一致）。
// “载入中…”的 300ms 延迟按真实时间（TIMING.loadingDelayMs 的注释：真实时间），用 setTimeout——它不推进任何玩法。

import type { Game } from '../core/game';
import type { View } from './ui';
import { STRINGS } from '../data/strings';
import { SHICHEN_TRANSITION_SEC, TIMING } from '../data/time';
import { h, punctSpans, setShown, setStyle, setText } from './dom';

interface Ramp { from: number; to: number; t: number; dur: number }
/** 白闪：attack 秒升到 peak，再用余下时间落回 0（attack = 0 即硬闪）。 */
interface Pulse { peak: number; attack: number; t: number; dur: number }

const TITLE_IN = 0.35;
const TITLE_OUT = 0.55;

export class FadeLayer implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private readonly blackEl: HTMLElement;
  private readonly whiteEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly titleMain: HTMLElement;
  private readonly titleSub: HTMLElement;
  private readonly loadingEl: HTMLElement;
  private readonly lostEl: HTMLElement;
  private readonly lostText: HTMLElement;
  private black01 = 0;
  private blackRamp: Ramp | null = null;
  private white01 = 0;
  private whitePulse: Pulse | null = null;
  private titleT = 0;
  private titleDur = 0;
  private loadingOn = false;
  private loadingTimer: number | null = null;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-fade');
    this.blackEl = h('div', 'cm-fade-black');
    this.whiteEl = h('div', 'cm-fade-white');
    this.titleEl = h('div', 'cm-fade-title');
    this.titleMain = h('div', 'cm-fade-title-main');
    this.titleSub = h('div', 'cm-fade-title-sub');
    this.titleEl.append(this.titleMain, this.titleSub);
    this.loadingEl = h('div', 'cm-loading', STRINGS.loading);
    this.lostEl = h('div', 'cm-lost');
    this.lostText = h('div', 'cm-lost-box');
    this.lostEl.append(this.lostText);
    this.el.append(this.blackEl, this.whiteEl, this.titleEl, this.loadingEl, this.lostEl);
    setShown(this.titleEl, false);
    setShown(this.loadingEl, false);
    setShown(this.lostEl, false);
  }

  /**
   * M4 第 2 轮：WebGL 上下文丢失期间的常驻遮罩（与“载入中…”同层；text 为 null 时撤掉）。
   * 原来是一条 4 秒的系统反馈条，过期后只剩黑屏，浏览器放弃恢复时玩家不知道该刷新。
   */
  setLostOverlay(text: string | null): void {
    setText(this.lostText, text ?? '');
    setShown(this.lostEl, text !== null);
  }
  /** 上下文丢失遮罩此刻的文字（自测用；没显示时 null）。 */
  lostOverlay(): string | null {
    return this.lostEl.classList.contains('cm-hidden') ? null : this.lostText.textContent;
  }

  /** DOM 黑幕渐变到 level01（0 = 透明，1 = 全黑），用时 sec（M1a 补写） */
  black(level01: number, sec?: number): void {
    const to = Math.min(1, Math.max(0, level01));
    const dur = this.scaled(sec ?? 0);
    if (dur <= 0) {
      this.black01 = to;
      this.blackRamp = null;
    } else {
      this.blackRamp = { from: this.black01, to, t: 0, dur };
    }
    this.apply();
  }

  /**
   * 白闪（快门、过场 {fade:'white'} 的 DOM 版）：遵守 reduceFlash（ARCH §8.1，M1d 按 GDD §10.4 改）——短闪（< 0.3s）直接不闪，
   * 长的淡入白改为柔和的升降（attack = 一半时长）。冻结签名之外的补充（engine-wp6.md #3），画面内的白闪仍走 PostPipeline.flash。
   */
  flash(ms: number = TIMING.flashMs): void {
    const dur = Math.max(0.016, ms / 1000);
    if (this.game.settings.reduceFlash && dur < TIMING.shortFlashSec) return;
    this.whitePulse = this.game.settings.reduceFlash
      ? { peak: 1, attack: dur / 2, t: 0, dur }
      : { peak: 1, attack: 0, t: 0, dur };
    this.white01 = this.whitePulse.attack > 0 ? 0 : this.whitePulse.peak;
    this.apply();
  }

  /** 居中字样：时辰过场（“丑时”）、过场 {title, sub, dur} 步骤（M1a 补写） */
  title(text: string, sub?: string, sec?: number): void {
    // M4：全角标点不跟着大字距拉开（“天 亮 了 ， 叫 我”）
    this.titleMain.replaceChildren(...punctSpans(text));
    setText(this.titleSub, sub ?? '');
    setShown(this.titleSub, !!sub);
    this.titleDur = Math.max(TITLE_IN + TITLE_OUT, sec ?? SHICHEN_TRANSITION_SEC);
    this.titleT = 0;
    setShown(this.titleEl, true);
    this.apply();
  }

  /** “载入中…”（UI.setLoading 转给它；M1a 补写）：打开后 300ms（真实时间）仍在载入才显示，关闭立即隐藏。 */
  setLoading(on: boolean): void {
    if (on === this.loadingOn) return;
    this.loadingOn = on;
    if (this.loadingTimer !== null) {
      window.clearTimeout(this.loadingTimer);
      this.loadingTimer = null;
    }
    if (on) {
      this.loadingTimer = window.setTimeout(() => {
        this.loadingTimer = null;
        if (this.loadingOn) setShown(this.loadingEl, true);
      }, TIMING.loadingDelayMs);
    } else {
      setShown(this.loadingEl, false);
    }
  }

  /** “载入中…”此刻是否可见（自测用）。 */
  loadingVisible(): boolean {
    return !this.loadingEl.classList.contains('cm-hidden');
  }
  /** 当前黑幕不透明度（自测、截图前检查用）。 */
  blackLevel(): number {
    return this.black01;
  }

  show(_arg?: unknown): void {
    setShown(this.el, true);
  }
  hide(): void {
    setShown(this.el, false);
  }

  update(dt: number): void {
    const step = (r: Ramp | null): { v: number; r: Ramp | null } | null => {
      if (!r) return null;
      r.t += dt;
      const f = Math.min(1, r.t / r.dur);
      const e = f * f * (3 - 2 * f);
      return { v: r.from + (r.to - r.from) * e, r: f >= 1 ? null : r };
    };
    const b = step(this.blackRamp);
    if (b) { this.black01 = b.v; this.blackRamp = b.r; }
    const p = this.whitePulse;
    if (p) {
      p.t += dt;
      if (p.t >= p.dur) {
        this.white01 = 0;
        this.whitePulse = null;
      } else {
        this.white01 = p.t < p.attack ? (p.peak * p.t) / p.attack : p.peak * (1 - (p.t - p.attack) / (p.dur - p.attack));
      }
    }
    if (this.titleDur > 0) {
      this.titleT += dt;
      if (this.titleT >= this.titleDur) {
        this.titleDur = 0;
        setShown(this.titleEl, false);
      }
    }
    this.apply();
  }

  private scaled(sec: number): number {
    return this.game.url.test ? sec * TIMING.testFadeScale : sec;
  }

  private apply(): void {
    setStyle(this.blackEl, 'opacity', this.black01.toFixed(3));
    setStyle(this.whiteEl, 'opacity', this.white01.toFixed(3));
    if (this.titleDur > 0) {
      const t = this.titleT;
      const a = t < TITLE_IN ? t / TITLE_IN : t > this.titleDur - TITLE_OUT ? Math.max(0, (this.titleDur - t) / TITLE_OUT) : 1;
      setStyle(this.titleEl, 'opacity', a.toFixed(3));
    }
  }
}
