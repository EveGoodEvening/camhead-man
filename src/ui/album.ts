// owner: WP6
// 相册与物品栏（ARCH §7；GDD §10.3），兼作“出示/使用”挑选器：4×3 网格分页、关键照片红标、实物照片纸边、已用角标；鼠标悬停高亮、点击发 {t:'pick', index}。
// 数据来源：读 game.state.listPhotos()/listItems() 与 game.modes.arg('mode.album')。UI 只读系统状态、只通过 game.dispatch() 或系统公开方法发起动作，不直接改状态。
//
// 格子序号（pick.index）的约定（engine-wp6.md #1）：照片在前、物品在后的一条总列表
//   entries = [...state.listPhotos(), ...state.listItems()]，index 是它的下标。
// 相册（左，4×3 分页）与物品栏（右，一列）同屏显示，所以不需要额外的“页签”状态。
// 键盘光标由 AlbumMode 持有；冻结签名里读不到它，UI 按同一条 nav 规则（albumNav）镜像方向键，
// 若 AlbumMode 以后公开了数字属性/方法 cursor，就改用它（见 #1）。

import type { Game } from '../core/game';
import type { InteractId, ItemId } from '../data/ids';
import type { ItemEntry, PhotoRecord } from '../game/state';
import type { AlbumArg } from '../game/interaction';
import type { View } from './ui';
import { STRINGS } from '../data/strings';
import { ITEMS, itemDisplayName } from '../data/items';
import { isEmptyPhotoId } from '../data/ids';
import { clickable, evalDyn, h, keyHints, readNumber, setClass, setShown, setText } from './dom';
import { albumLists } from '../game/modes/album';

export type AlbumEntry = { kind: 'photo'; rec: PhotoRecord } | { kind: 'item'; entry: ItemEntry };

/** 相册每页 4 列 × 3 行（GDD §10.3）。 */
export const ALBUM_COLS = 4;
export const ALBUM_PAGE = 12;

/** 挑选器/相册的总列表（pick.index 的下标空间）。 */
export function albumEntries(photos: readonly PhotoRecord[], items: readonly ItemEntry[]): AlbumEntry[] {
  return [...photos.map(rec => ({ kind: 'photo' as const, rec })), ...items.map(entry => ({ kind: 'item' as const, entry }))];
}

/**
 * 方向键规则（UI 镜像 AlbumMode 的光标用；engine-wp6.md #1 请 AlbumMode 采用同一规则）：
 * 照片区里上下 = ±4（不出照片区），物品区里上下 = ±1（不出物品区）；左右 = 总列表 ±1（可跨区）；都钳到 [0, N-1]。
 */
export function albumNav(i: number, dx: number, dy: number, photoCount: number, total: number): number {
  if (total <= 0) return 0;
  let j = Math.min(Math.max(i, 0), total - 1);
  if (dy !== 0) {
    if (j < photoCount) j = Math.min(Math.max(j + ALBUM_COLS * dy, 0), photoCount - 1);
    else j = Math.min(Math.max(j + dy, photoCount), total - 1);
  }
  if (dx !== 0) j = Math.min(Math.max(j + dx, 0), total - 1);
  return j;
}

type AlbumSub = { kind: 'browse'; tab: 'photos' | 'items' } | { kind: 'pick'; target: InteractId; verb: 'show' | 'use' } | { kind: 'menu' };

function albumSub(arg: AlbumArg | undefined): AlbumSub {
  if (arg && 'pick' in arg) return { kind: 'pick', target: arg.pick.target, verb: arg.pick.verb };
  if (arg && 'menu' in arg) return { kind: 'menu' };
  return { kind: 'browse', tab: arg && 'tab' in arg && arg.tab === 'items' ? 'items' : 'photos' };
}

export class AlbumView implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private readonly tabPhotos: HTMLElement;
  private readonly tabItems: HTMLElement;
  private readonly pickFor: HTMLElement;
  private readonly pageEl: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly items: HTMLElement;
  /** M4 第 2 轮：物品栏外框（超出一屏时底部渐隐 + “▼”） */
  private readonly itemsCol: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly hints: HTMLElement;
  private entries: AlbumEntry[] = [];
  private photoCount = 0;
  private listKey = '';
  private cursor = 0;
  private hover: number | null = null;
  private page = -1;
  private subKey = '';
  private cells = new Map<number, HTMLElement>();
  private shown = false;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-album cm-backdrop');
    const sheet = h('div', 'cm-album-sheet');
    const head = h('div', 'cm-album-head');
    const tabs = h('div', 'cm-album-tabs');
    this.tabPhotos = h('span', undefined, STRINGS.album.photos);
    this.tabItems = h('span', undefined, STRINGS.album.items);
    tabs.append(this.tabPhotos, this.tabItems);
    this.pickFor = h('div', 'cm-album-pickfor');
    this.pageEl = h('div', 'cm-album-page');
    head.append(tabs, this.pickFor, this.pageEl);
    this.grid = h('div', 'cm-album-grid');
    const side = h('div', 'cm-items');
    this.items = side;
    this.itemsCol = h('div', 'cm-items-col');
    this.itemsCol.append(side, h('div', 'cm-items-fade'), h('div', 'cm-items-more', '▼'));
    side.addEventListener('scroll', () => this.syncScrollHint());
    const foot = h('div', 'cm-album-foot');
    this.detail = h('div', 'cm-album-detail');
    this.hints = h('div');
    foot.append(this.detail, this.hints);
    sheet.append(head, this.grid, this.itemsCol, foot);
    this.el.append(sheet);
    this.el.addEventListener('mousedown', ev => ev.preventDefault());
    setShown(this.el, false);
  }

  show(arg?: unknown): void {
    const a = (arg ?? this.game.modes.arg<AlbumArg>('mode.album')) as AlbumArg | undefined;
    const sub = albumSub(a);
    if (!this.shown) {
      this.shown = true;
      this.listKey = '';
      this.hover = null;
      this.rebuildIfChanged(true);
      this.cursor = sub.kind === 'browse' && sub.tab === 'items' && this.entries.length > this.photoCount ? this.photoCount : 0;
      this.render();
    }
    this.subKey = '';
    setShown(this.el, true);
    this.update(0);
  }
  hide(): void {
    this.shown = false;
    setShown(this.el, false);
  }

  /** 方向键镜像（UI 在 album 为栈顶时把 Arrow* 转进来；与 KEYMAP → AlbumMode 的 nav 同时发生）。 */
  nav(dx: -1 | 0 | 1, dy: -1 | 0 | 1): void {
    if (!this.shown) return;
    this.cursor = albumNav(this.cursor, dx, dy, this.photoCount, this.entries.length);
    this.hover = null;
    this.render();
  }

  /** 当前 UI 认为选中的格子（自测与调试用）。 */
  selected(): number {
    return this.cursor;
  }

  update(_dt: number): void {
    if (!this.shown) return;
    const g = this.game;
    const sub = albumSub(g.modes.arg<AlbumArg>('mode.album'));
    this.rebuildIfChanged(false);
    // AlbumMode 若公开了光标（数字属性或无参方法 cursor），以它为准
    const modeCursor = readNumber(g.modes.handler('mode.album'), 'cursor');
    if (modeCursor !== null && modeCursor !== this.cursor) {
      this.cursor = modeCursor;
      this.render();
    }
    const key = JSON.stringify(sub);
    if (key !== this.subKey) {
      this.subKey = key;
      if (sub.kind === 'pick') {
        const def = g.sys.interaction.get(sub.target);
        const label = (def ? evalDyn(def.label, g.state) : undefined) ?? '';
        setText(this.pickFor, `${sub.verb === 'show' ? '出示给' : '用在'}：${label}`);
        this.hints.replaceChildren(keyHints([['方向键', '挑一件'], ['Enter/左键', '确认'], ['Esc', '返回']]));
      } else {
        setText(this.pickFor, '');
        this.hints.replaceChildren(keyHints([['方向键', '挑选'], ['Enter/左键', '打开'], ['Tab', '合上'], ['J', '巡夜本']]));
      }
      setShown(this.pickFor, sub.kind === 'pick');
      setClass(this.el, 'cm-picking', sub.kind === 'pick');
    }
    this.syncScrollHint();
  }

  private rebuildIfChanged(force: boolean): void {
    // M4 第 2 轮：挑选器按 albumLists 排序（与 AlbumMode 同一份：未用的物品、关键照片在前，空镜最后或不列）
    const arg = this.game.modes.arg<AlbumArg>('mode.album');
    const { photos, items } = albumLists(this.game, arg);
    const pickKey = arg && 'pick' in arg ? `${arg.pick.target}:${arg.pick.verb}` : '';
    const key = `${pickKey}#${photos.map(p => `${p.id}:${p.thumb ? 1 : 0}`).join(',')}|${items.map(i => `${i.id}:${i.used ? 1 : 0}`).join(',')}`;
    if (!force && key === this.listKey) return;
    this.listKey = key;
    this.entries = albumEntries(photos, items);
    this.photoCount = photos.length;
    this.cursor = Math.min(this.cursor, Math.max(0, this.entries.length - 1));
    this.page = -1;
    this.buildItems();
    this.render();
  }

  /** M4 第 2 轮：物品栏超出一屏、还没滚到底时底部渐隐 + “▼”；键盘光标落在物品上时滚到看得见的地方。 */
  private syncScrollHint(): void {
    const el = this.items;
    const more = el.scrollHeight > el.clientHeight + 2 && el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    setClass(this.itemsCol, 'cm-can-scroll', more);
  }

  private buildItems(): void {
    this.items.replaceChildren();
    this.cells.clear();
    const title = h('div', 'cm-items-title', STRINGS.album.items);
    this.items.append(title);
    if (this.entries.length === this.photoCount) {
      this.items.append(h('div', 'cm-items-empty', '（身上什么也没有）'));
      return;
    }
    for (let i = this.photoCount; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.kind !== 'item') continue;
      const row = h('div', 'cm-item');
      const meta = ITEMS[e.entry.id];
      const name = h('span', 'cm-item-name', itemDisplayName(e.entry.id, e.entry.used));
      if (meta.doc || meta.opensJournal) name.append(h('span', 'cm-item-doc', '▤'));
      row.append(name);
      if (e.entry.used) {
        row.classList.add('cm-used');
        row.append(h('span', 'cm-item-used', STRINGS.album.used));
      }
      this.bindCell(row, i);
      this.items.append(row);
      this.cells.set(i, row);
    }
  }

  private buildPage(page: number): void {
    this.grid.replaceChildren();
    for (const i of [...this.cells.keys()]) if (i < this.photoCount) this.cells.delete(i);
    if (this.photoCount === 0) {
      this.grid.append(h('div', 'cm-album-empty', '（还没有照片）'));
      return;
    }
    const start = page * ALBUM_PAGE;
    for (let k = 0; k < ALBUM_PAGE; k++) {
      const i = start + k;
      if (i >= this.photoCount) {
        this.grid.append(h('div', 'cm-photo-blank'));
        continue;
      }
      const e = this.entries[i];
      if (e.kind !== 'photo') continue;
      const rec = e.rec;
      const empty = isEmptyPhotoId(rec.id);
      const cell = h('div', 'cm-photo');
      setClass(cell, 'cm-print', rec.print);
      setClass(cell, 'cm-empty', empty);
      const img = h('div', 'cm-photo-img');
      if (rec.thumb) img.style.backgroundImage = `url("${rec.thumb}")`;
      else img.classList.add('cm-noimg');
      const title = h('div', 'cm-photo-title', empty ? (rec.caption ?? rec.title) : rec.title);
      cell.append(img, title);
      if (rec.key) cell.append(h('span', 'cm-photo-key'));
      this.bindCell(cell, i);
      this.grid.append(cell);
      this.cells.set(i, cell);
    }
  }

  private bindCell(el: HTMLElement, index: number): void {
    el.addEventListener('mouseenter', () => { this.hover = index; this.render(); });
    el.addEventListener('mouseleave', () => { if (this.hover === index) { this.hover = null; this.render(); } });
    // 点击 = 选中这一格并确认（ARCH §7：点击发 {t:'pick', index}）
    clickable(el, () => {
      this.cursor = index;
      this.game.dispatch({ t: 'pick', index });
    });
  }

  private render(): void {
    const pages = Math.max(1, Math.ceil(this.photoCount / ALBUM_PAGE));
    const focus = this.hover ?? this.cursor;
    // 光标在照片区时翻到它所在的页；在物品区时保持当前页
    const want = Math.min(pages - 1, focus < this.photoCount ? Math.floor(focus / ALBUM_PAGE) : Math.max(0, this.page));
    if (want !== this.page) {
      this.page = want;
      this.buildPage(this.page);
    }
    setText(this.pageEl, this.photoCount > ALBUM_PAGE ? `${this.page + 1} / ${pages}` : '');
    for (const [i, el] of this.cells) {
      setClass(el, 'cm-sel', i === this.cursor);
      setClass(el, 'cm-hover', i === this.hover && i !== this.cursor);
    }
    // 键盘光标在物品栏里：滚到看得见（鼠标悬停时不动）
    if (this.hover === null && this.cursor >= this.photoCount) this.cells.get(this.cursor)?.scrollIntoView?.({ block: 'nearest' });
    const inItems = focus >= this.photoCount && this.entries.length > this.photoCount;
    setClass(this.tabPhotos, 'cm-on', !inItems);
    setClass(this.tabItems, 'cm-on', inItems);
    this.renderDetail(focus);
  }

  private renderDetail(i: number): void {
    const e = this.entries[i];
    this.detail.replaceChildren();
    if (!e) return;
    if (e.kind === 'photo') {
      const r = e.rec;
      this.detail.append(h('b', undefined, isEmptyPhotoId(r.id) ? STRINGS.album.empty : r.title));
      const cap = r.caption && r.caption !== r.title ? r.caption : '';
      if (cap) this.detail.append(h('span', undefined, cap));
    } else {
      const id: ItemId = e.entry.id;
      const meta = ITEMS[id];
      this.detail.append(h('b', undefined, itemDisplayName(id, e.entry.used)));
      const note = [meta.desc, e.entry.used ? meta.usedNote ?? '' : ''].filter(Boolean).join('　');
      if (note) this.detail.append(h('span', undefined, note));
    }
  }
}
