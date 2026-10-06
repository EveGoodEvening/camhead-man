// owner: WP6
// 回放 HUD（ARCH §7）：左上 ◀◀ 日期时间、底部时间轴与片段序号（如“2/3”）。
// 数据来源：读 game.sys.replay.active。UI 只读系统状态、只通过 game.dispatch() 或系统公开方法发起动作，不直接改状态。
// 片段的 osd（'2018-02-16 10:21'）与 dur 取自当前区域的 AreaDef.segments（片段只能静态登记，ARCH §6.9）。

import type { Game } from '../core/game';
import type { SegmentId } from '../data/ids';
import type { ReplaySegmentDef } from '../game/replay';
import type { View } from './ui';
import { STRINGS, fmt } from '../data/strings';
import { formatTc, parseTc } from '../core/math';
import { h, keyHints, setShown, setStyle, setText } from './dom';

/** 'YYYY-MM-DD HH:MM[:SS]' + t 秒 → 'YYYY-MM-DD HH:MM:SS'（GDD M4：◀◀ 2018-02-16 10:21:05）。 */
export function replayOsd(osd: string, t: number): string {
  const m = /^(.*?)(\d{1,2}:\d{2}(?::\d{2})?)\s*$/.exec(osd);
  if (!m) return osd;
  let base: number;
  try {
    base = parseTc(m[2]);
  } catch {
    return osd;   // 区域写了不合法的钟点：原样显示，不让 HUD 抛错
  }
  return `${m[1]}${formatTc(base + Math.floor(Math.max(0, t)), { seconds: true })}`;
}

export class ReplayHud implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private readonly osd: HTMLElement;
  private readonly count: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly ticks: HTMLElement;
  private readonly tNow: HTMLElement;
  private readonly tDur: HTMLElement;
  private shown = false;
  private segCache: { id: SegmentId; def: ReplaySegmentDef | null } | null = null;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-rp');
    const frame = h('div', 'cm-frame');
    this.osd = h('div', 'cm-rp-osd');
    this.count = h('div', 'cm-rp-count');
    const bottom = h('div', 'cm-rp-bottom');
    const bar = h('div', 'cm-rp-bar');
    this.fill = h('div', 'cm-rp-fill');
    this.ticks = h('div', 'cm-rp-ticks');
    bar.append(this.fill, this.ticks);
    const meta = h('div', 'cm-rp-meta');
    this.tNow = h('span');
    this.tDur = h('span');
    meta.append(this.tNow, this.tDur);
    const keys = keyHints([['空格', '播放/暂停'], ['Z/C', '倒退/快进 5 秒'], [',/.', '逐秒'], ['R', '更早一段'], ['F', '回到现在']]);
    keys.classList.add('cm-rp-keys');
    bottom.append(bar, meta, keys);
    // GDD §10.2：片段序号在底部时间轴旁边
    meta.insertBefore(this.count, this.tDur);
    frame.append(this.osd, bottom);
    this.el.append(frame);
    setShown(this.el, false);
  }

  show(_arg?: unknown): void {
    this.shown = true;
    setShown(this.el, true);
  }
  hide(): void {
    this.shown = false;
    this.segCache = null;
    setShown(this.el, false);
  }

  update(_dt: number): void {
    if (!this.shown) return;
    const a = this.game.sys.replay.active;
    if (!a) return;
    const seg = this.segment(a.seg);
    const dur = seg?.dur ?? 0;
    const t = dur > 0 ? Math.min(a.t, dur) : a.t;
    const date = seg ? replayOsd(seg.osd, t) : '';
    setText(this.osd, `◀◀ ${date}${a.playing ? '' : '  ❚❚'}`);
    // active.index 从 1 起（WP5 的实现，与 DebugState.replay.index 一致；M1c 写明，engine-wp6.md #10）
    setText(this.count, fmt(STRINGS.hud.replayCounter, { i: a.index, n: a.count }));
    const f = dur > 0 ? Math.min(1, Math.max(0, t / dur)) : 0;
    setStyle(this.fill, 'width', `${(f * 100).toFixed(2)}%`);
    // 每 5 秒一格刻度
    setStyle(this.ticks, '--tick', dur > 0 ? `${((5 / dur) * 100).toFixed(3)}%` : '100%');
    setText(this.tNow, `${t.toFixed(1)}s`);
    setText(this.tDur, dur > 0 ? `${dur.toFixed(0)}s` : '');
  }

  private segment(id: SegmentId): ReplaySegmentDef | null {
    if (this.segCache?.id === id) return this.segCache.def;
    const def = this.game.areas.current?.def.segments?.find(s => s.id === id) ?? null;
    this.segCache = { id, def };
    return def;
  }
}
