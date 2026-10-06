// owner: WP6
// 巡夜本（ARCH §6.16、§7；GDD §10.3）：左页旧页与新页（新页“墨迹未干”反光），右页称呼/已知线索/树底下 n/6。
// 数据来源：读 game.sys.journal.visiblePages()、game.state.names()/listClues()/antCount()。UI 只读系统状态、只通过 game.dispatch() 或系统公开方法发起动作，不直接改状态。
// 左页的旧页正文是 doc.log_old（R1 的 text.ts 登记），新页是 visiblePages()（GDD §7.4 ①–⑨）。

import type { Game } from '../core/game';
import type { View } from './ui';
import { STRINGS, fmt } from '../data/strings';
import { DOC } from '../data/ids';
import { NAMES } from '../data/names';
import { h, keyHints, setShown } from './dom';

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫'];

export class JournalView implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private readonly left: HTMLElement;
  private readonly right: HTMLElement;
  private key = '';
  private shown = false;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-journal cm-backdrop');
    const book = h('div', 'cm-book');
    this.left = h('div', 'cm-page cm-page-l');
    this.right = h('div', 'cm-page cm-page-r');
    const foot = h('div', 'cm-book-foot');
    foot.append(keyHints([['↑↓', '翻看'], ['J', '合上'], ['Tab', '相册'], ['Esc', '关闭']]));
    book.append(this.left, this.right, foot);
    this.el.append(book);
    this.el.addEventListener('mousedown', ev => ev.preventDefault());
    setShown(this.el, false);
  }

  show(_arg?: unknown): void {
    const first = !this.shown;
    this.shown = true;
    setShown(this.el, true);
    this.refresh(true);
    // 打开时翻到最新一页（左页滚到底）
    if (first) this.left.scrollTop = this.left.scrollHeight;
  }
  hide(): void {
    this.shown = false;
    setShown(this.el, false);
  }
  update(_dt: number): void {
    if (this.shown) this.refresh(false);
  }

  /** M4：键盘翻看（↑/↓ 一行、PageUp/PageDown 一屏）：滚左页（老周的字）。UI.bindInput 在巡夜本开着时转给它。 */
  scrollBy(lines: number, page = false): void {
    const p = this.left;
    const lh = parseFloat(getComputedStyle(p).lineHeight) || 30;
    p.scrollTop += page ? Math.sign(lines) * Math.max(lh, p.clientHeight - lh * 1.5) : lines * lh;
  }

  private refresh(force: boolean): void {
    const g = this.game;
    const st = g.state;
    const pages = g.sys.journal.visiblePages().slice().sort((a, b) => a.index - b.index);
    const names = st.names();
    const clues = st.listClues();
    const ants = st.antCount();
    const key = `${pages.map(p => p.index).join(',')}|${names.join(',')}|${clues.length}|${clues[clues.length - 1] ?? ''}|${ants}`;
    if (!force && key === this.key) return;
    this.key = key;

    // ---- 左页：老周的字（旧页蓝圆珠笔，新页墨迹未干）
    this.left.replaceChildren(h('h3', 'cm-page-title', STRINGS.journal.title), h('div', 'cm-page-sub', '第十九本'));
    const oldDoc = g.sys.journal.doc(DOC.LOG_OLD);
    if (oldDoc) {
      const body = g.sys.journal.renderDoc(DOC.LOG_OLD, false);
      for (const para of body.split(/\n+/)) {
        const t = para.replace(/^>\s?/, '').trim();
        if (t) this.left.append(h('p', 'cm-log-entry cm-ink-old', t));
      }
    }
    const newest = pages.length ? pages[pages.length - 1].index : -1;
    for (const p of pages) {
      const para = h('p', 'cm-log-entry cm-ink-wet');
      // 墨迹反光的动画只给最新一页，其余新页只用湿墨的颜色（动画克制）
      if (p.index !== newest) para.style.animation = 'none';
      para.append(h('span', 'cm-log-new-mark', CIRCLED[p.index - 1] ?? `(${p.index})`), document.createTextNode(p.text));
      this.left.append(para);
    }
    if (!oldDoc && pages.length === 0) this.left.append(h('div', 'cm-page-empty', '（空白）'));

    // ---- 右页：称呼 / 已知线索 / 树底下 n/6
    const nameList = h('ul');
    if (names.length === 0) nameList.append(h('li', 'cm-page-empty', '（还没有）'));
    for (const id of names) {
      const li = h('li');
      li.append(h('span', 'cm-name-text', NAMES[id].text), h('span', 'cm-name-src', NAMES[id].source));
      nameList.append(li);
    }
    const clueList = h('ul');
    if (clues.length === 0) clueList.append(h('li', 'cm-page-empty', '（还没有）'));
    for (const c of clues) clueList.append(h('li', 'cm-clue', c));
    this.right.replaceChildren(
      h('h4', undefined, STRINGS.journal.names), nameList,
      h('h4', undefined, STRINGS.journal.clues), clueList,
      h('div', 'cm-ants', fmt(STRINGS.journal.ants, { n: ants })),
    );
  }
}
