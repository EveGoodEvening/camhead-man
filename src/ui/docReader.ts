// owner: WP6
// 文档阅读器（ARCH §6.16、§7）：取景器中打开时带扫描线与 OSD 并显出褪字；肉眼翻开时褪字处画成一团水渍；covered 段打码。
// 数据来源：show(arg: { doc: DocId; vf: boolean })；正文取 game.sys.journal.renderDoc(doc, vf)。UI 只读系统状态、只通过 game.dispatch() 或系统公开方法发起动作，不直接改状态。
//
// 正文以 renderDoc 为准。为了把“显出来的褪字”画得与众不同，取景器模式下另外解析 DocDef.body 的〔…〕标记，
// 只有解析结果去掉标记后与 renderDoc 的正文逐字相同时才用它来上色（否则按 renderDoc 的纯文本显示）。
// covered（讣告下半截）：读到 readBy 之前打码。是否读过看 state.seen(readBy)，再并上本局收到的 'read' 事件（engine-wp6.md #5）。

import type { Game } from '../core/game';
import type { DocId, ReadId } from '../data/ids';
import type { DocDef } from '../game/journal';
import { COVER_MASK } from '../game/journal';
import type { View } from './ui';
import { STRINGS } from '../data/strings';
import { TIMING } from '../data/time';
import { h, keyHints, setClass, setShown, setText } from './dom';

/** 正文片段：t 为文字，kind 决定画法。 */
export interface DocSeg { t: string; kind: 'text' | 'faded' | 'stain' | 'covered' }

/** 把〔…〕褪字标记拆成片段（取景器中显出的样子）。 */
export function parseFaded(body: string): DocSeg[] {
  const out: DocSeg[] = [];
  const re = /〔([^〕]*)〕/g;
  let last = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m.index > last) out.push({ t: body.slice(last, m.index), kind: 'text' });
    out.push({ t: m[1], kind: 'faded' });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ t: body.slice(last), kind: 'text' });
  return out;
}

/** 普通文字里的水渍符号“▯”拆成 stain 片段。 */
export function splitStains(segs: readonly DocSeg[], stain: string): DocSeg[] {
  const out: DocSeg[] = [];
  for (const s of segs) {
    if (s.kind !== 'text' || !s.t.includes(stain)) { out.push(s); continue; }
    const parts = s.t.split(stain);
    parts.forEach((p, i) => {
      if (p) out.push({ t: p, kind: 'text' });
      if (i < parts.length - 1) out.push({ t: stain, kind: 'stain' });
    });
  }
  return out;
}

/** 把整段文字里 [start, end) 这一段标成 kind（跨片段也行）。 */
export function markRange(segs: readonly DocSeg[], start: number, end: number, kind: DocSeg['kind']): DocSeg[] {
  const out: DocSeg[] = [];
  let pos = 0;
  for (const s of segs) {
    const a = pos;
    const b = pos + s.t.length;
    pos = b;
    if (b <= start || a >= end) { out.push(s); continue; }
    const i0 = Math.max(start, a) - a;
    const i1 = Math.min(end, b) - a;
    if (i0 > 0) out.push({ t: s.t.slice(0, i0), kind: s.kind });
    out.push({ t: s.t.slice(i0, i1), kind });
    if (i1 < s.t.length) out.push({ t: s.t.slice(i1), kind: s.kind });
  }
  return out;
}

export class DocReader implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private readonly wrap: HTMLElement;
  private readonly paper: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly note: HTMLElement;
  private readonly scan: HTMLElement;
  private readonly osd: HTMLElement;
  private readonly osdLine: HTMLElement;
  private readonly rec: HTMLElement;
  /** M4：正文超出一屏时底部的“▼”与渐隐（滚到底后收起） */
  private readonly more: HTMLElement;
  private readonly readSeen = new Set<ReadId>();
  private cur: { doc: DocId; vf: boolean } | null = null;
  private key = '';
  private t = 0;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-docreader cm-backdrop');
    this.wrap = h('div', 'cm-doc-wrap');
    this.paper = h('div', 'cm-doc');
    this.title = h('div', 'cm-doc-title');
    this.body = h('div', 'cm-doc-body');
    this.note = h('div', 'cm-covered-note');
    this.paper.append(this.title, this.body, this.note);
    this.scan = h('div', 'cm-doc-scan');
    this.osd = h('div', 'cm-doc-osd');
    this.rec = h('span', 'cm-vf-rec');
    this.rec.append(h('span', 'cm-rec-dot'), document.createTextNode(STRINGS.hud.rec));
    this.osdLine = h('span', 'cm-osd');
    this.osd.append(this.rec, this.osdLine);
    const foot = h('div', 'cm-doc-foot');
    foot.append(keyHints([['↑↓', '翻看'], ['Esc', '合上']]));
    this.more = h('div', 'cm-doc-more', '▼');
    // 底部渐隐：盖在纸上的一条纸色渐变（不用 mask——mask 会把纸本身也变透明，底下的字幕、反馈条透上来）
    const fade = h('div', 'cm-doc-fade');
    this.wrap.append(this.paper, fade, this.scan, this.osd, this.more, foot);
    this.el.append(this.wrap);
    this.el.addEventListener('mousedown', ev => ev.preventDefault());
    setShown(this.el, false);
    game.events.on('read', e => { this.readSeen.add(e.id); });
  }

  /** ARCH §7：参数必填（方法参数双变检查，仍满足 View.show(arg?: unknown)） */
  show(arg: { doc: DocId; vf: boolean }): void {
    if (!this.cur || this.cur.doc !== arg.doc || this.cur.vf !== arg.vf) {
      this.cur = { doc: arg.doc, vf: arg.vf };
      this.key = '';
      this.paper.scrollTop = 0;
    }
    setShown(this.el, true);
    this.render();
  }
  hide(): void {
    this.cur = null;
    setShown(this.el, false);
  }
  update(dt: number): void {
    this.t += dt;
    if (!this.cur) return;
    this.render();
    // 还有没看到的下文：底部渐隐 + 跳动的“▼”（M4；叠加滚动条下看不出能滚）
    const p = this.paper;
    const more = p.scrollHeight - p.clientHeight - p.scrollTop > 4;
    setClass(this.wrap, 'cm-can-scroll', more);
    if (this.cur.vf) {
      setText(this.osdLine, this.game.sys.shichen.osdLine(1));
      setClass(this.rec, 'cm-off', (this.t % TIMING.recBlinkSec) >= TIMING.recBlinkSec / 2);
    }
  }

  /** M4：键盘翻看（↑/↓ 一行、PageUp/PageDown/空格一屏）。UI.bindInput 在阅读器开着时转给它。 */
  scrollBy(lines: number, page = false): void {
    const p = this.paper;
    const lh = parseFloat(getComputedStyle(p).lineHeight) || 28;
    p.scrollTop += page ? Math.sign(lines) * Math.max(lh, p.clientHeight - lh * 1.5) : lines * lh;
  }

  private isRead(id: ReadId): boolean {
    return this.readSeen.has(id) || this.game.state.seen(id);
  }

  private render(): void {
    const cur = this.cur;
    if (!cur) return;
    const j = this.game.sys.journal;
    const def = j.doc(cur.doc);
    const text = j.renderDoc(cur.doc, cur.vf);
    const coveredOpen = def?.covered ? this.isRead(def.covered.readBy) : true;
    const key = `${cur.doc}|${cur.vf}|${text}|${coveredOpen}`;
    if (key === this.key) return;
    this.key = key;

    const style = def?.style ?? 'print';
    this.paper.className = `cm-doc cm-doc-${style}`;
    setClass(this.wrap, 'cm-doc-vf', cur.vf);
    setShown(this.scan, cur.vf);
    setShown(this.osd, cur.vf);
    setText(this.title, def?.title ?? '');

    const segs = this.segments(def, text, cur.vf, coveredOpen);
    this.body.replaceChildren(...segs.map(s => {
      if (s.kind === 'text') return document.createTextNode(s.t);
      if (s.kind === 'stain') {
        const el = h('span', 'cm-stain');
        el.title = '水渍';
        return el;
      }
      // 打码段不把原文放进 DOM（只按字数留出同样宽的一块），免得选中/读 DOM 就能看到
      return s.kind === 'faded' ? h('span', 'cm-faded', s.t) : h('span', 'cm-covered', s.t.replace(/[^\n]/g, '\u3000'));
    }));
    const coveredNote = def?.covered && !coveredOpen ? '（下半截被别的纸盖住了）' : '';
    setText(this.note, coveredNote);
    setShown(this.note, coveredNote !== '');
  }

  private segments(def: DocDef | undefined, text: string, vf: boolean, coveredOpen: boolean): DocSeg[] {
    let segs: DocSeg[] = [{ t: text, kind: 'text' }];
    if (vf && def) {
      const raw = typeof def.body === 'function' ? def.body(this.game.state) : def.body;
      const parsed = parseFaded(raw);
      if (parsed.map(s => s.t).join('') === text) segs = parsed;
    }
    if (!vf) segs = splitStains(segs, STRINGS.doc.waterStain);
    if (def?.covered && !coveredOpen) {
      // M4：renderDoc 已把没读到的下半截逐字换成 COVER_MASK（█）接在正文末尾——只把这一段画成一块斜纹遮挡，
      // 不再另外补一段（原来原文找不到就又追加一段，讣告下面出现两行涂黑 + 三条斜纹，像审查涂黑）。
      // 读到之后 renderDoc 已经带上原文，什么也不用补。
      const at = text.indexOf(COVER_MASK);
      if (at >= 0) segs = markRange(segs, at, text.length, 'covered');
      else {
        const ct = def.covered.text;
        const i = text.indexOf(ct);
        if (i >= 0) segs = markRange(segs, i, i + ct.length, 'covered');
      }
    }
    return segs;
  }
}
