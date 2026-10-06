// owner: WP4
// mode.album 的 ModeHandler（ARCH §4.6、§6.6、附录 A）。相册与物品栏（arg: AlbumArg）：浏览 / 动作菜单 / 挑选器；冻结世界。
//
// 实现要点（WP4）：
// - 格子序号与 WP6 的 AlbumView 相同：一条总列表 things = [...state.listPhotos(), ...state.listItems()]，
//   {t:'pick', index} 与 cursor 都是它的下标（相册 4 列在左、物品一列在右，同屏）。
// - 方向键规则同 WP6 的 albumNav：照片区里上下 = ±4（不出照片区），物品区里上下 = ±1（不出物品区），左右 = 总列表 ±1，钳到 [0, N-1]。
//   公开 cursor（非冻结签名）给 UI 画键盘光标。
// - 浏览：Enter/左键/点击 = 打开选中的物品（opensJournal → 巡夜本；有 doc → openDoc，vf = 栈上有取景器）；Tab/Esc 关闭；J 切到巡夜本。
// - 动作菜单 {menu}：1（或点第 0 项）= 弹出相册并 activate(primary)；2（或点第 1 项）= 切到挑选器；方向键上下选、Enter 确认；Esc 关闭。
// - 挑选器 {pick}：方向键/点击选、Enter/左键确认 → 弹出相册并 activate(target, {verb, thing}, 'player')（与调试 API 同一入口）；
//   Esc 回到动作菜单（从菜单进来时）或关闭；Tab 在照片区与物品区之间跳。
// - 子状态切换用 pop + push（UI 与 DebugState 都从 modes.arg('mode.album') 读子状态）。

import type { ModeId } from '../../core/types';
import { fail, ok } from '../../core/types';
import type { Action, ActionResult } from '../../core/actions';
import type { ModeCamera, ModeHandler, ModeMove } from '../../core/modes';
import type { PointerPolicy } from '../../core/input';
import type { Game } from '../../core/game';
import type { InteractId, ItemId, ThingId } from '../../data/ids';
import { isEmptyPhotoId } from '../../data/ids';
import { ITEMS } from '../../data/items';
import type { AlbumArg, OfferTable } from '../interaction';
import type { ItemEntry, PhotoRecord } from '../state';

/**
 * 相册/挑选器的两条列表（M4 第 2 轮，AlbumMode 与 WP6 的 AlbumView 共用，格子序号 = [...photos, ...items] 的下标）。
 * - 浏览：照片按拍摄顺序、物品按获得顺序（原样）。
 * - 挑选器（出示/使用）：要用的东西放前面——物品“未用的在前、同组里新得的在前”，已用的沉到底；照片“关键照片在前、新拍的在前”，
 *   空镜收到最后，目标不收任意照片时（只有火盆这种 accept 为空、靠 any 收一切的才收）直接不列空镜。
 *   原来到了寅时物品 14 项，要放进录像机的带子是最后一项、在折叠线下面，前排全是已用的钥匙串、灯泡；光标还停在一张无关照片上。
 */
export function albumLists(game: Pick<Game, 'state'> & { sys?: Partial<Game['sys']> }, arg: AlbumArg | undefined): { photos: PhotoRecord[]; items: ItemEntry[] } {
  const s = game.state;
  const photos = [...s.listPhotos()];
  const items = [...s.listItems()];
  if (!arg || !('pick' in arg)) return { photos, items };
  const def = game.sys?.interaction?.get(arg.pick.target);
  const raw = def?.offers;
  const offers: OfferTable | undefined = typeof raw === 'function' ? raw(s) : raw;
  const takesAnything = !!offers?.any && Object.keys(offers.accept).length === 0;
  const rank = (p: PhotoRecord): number => (isEmptyPhotoId(p.id) ? 2 : p.key ? 0 : 1);
  const ph = photos
    .filter(p => takesAnything || !isEmptyPhotoId(p.id))
    .sort((a, b) => rank(a) - rank(b) || b.seq - a.seq);
  const it = items.sort((a, b) => (a.used ? 1 : 0) - (b.used ? 1 : 0) || b.order - a.order);
  return { photos: ph, items: it };
}

/** 相册每行 4 格（GDD §10.3）。 */
export const ALBUM_COLS = 4;

/** 方向键规则（与 WP6 的 ui/album.ts albumNav 一致）。 */
export function albumNavIndex(i: number, dx: number, dy: number, photoCount: number, total: number): number {
  if (total <= 0) return 0;
  let j = Math.min(Math.max(i, 0), total - 1);
  if (dy !== 0) {
    if (j < photoCount) j = Math.min(Math.max(j + ALBUM_COLS * dy, 0), photoCount - 1);
    else j = Math.min(Math.max(j + dy, photoCount), total - 1);
  }
  if (dx !== 0) j = Math.min(Math.max(j + dx, 0), total - 1);
  return j;
}

type Sub =
  | { kind: 'browse' }
  | { kind: 'menu'; target: InteractId }
  | { kind: 'pick'; target: InteractId; verb: 'show' | 'use' };

export class AlbumMode implements ModeHandler {
  readonly id: 'mode.album' = 'mode.album';
  readonly transient = true;
  readonly freezesWorld = true;
  readonly pointer: PointerPolicy | ((stack: readonly ModeId[]) => PointerPolicy) = 'free';
  readonly camera: ModeCamera = 'inherit';
  readonly move: ModeMove | ((stack: readonly ModeId[]) => ModeMove) = 'none';
  readonly look: boolean | ((stack: readonly ModeId[]) => boolean) = false;
  protected readonly game: Game;
  private sub: Sub = { kind: 'browse' };
  private cur = 0;
  private menuSel: 0 | 1 = 0;
  /** 挑选器是从动作菜单切过来的（Esc 回菜单） */
  private fromMenu = false;
  /** pop+push 切子状态期间，把“从菜单来”带给下一次 enter */
  private carryFromMenu: boolean | null = null;

  constructor(game: Game) {
    this.game = game;
  }

  // ——————————————————————————————— WP4 补充（非冻结签名；UI 与调试 API 用）

  /** 键盘光标：things() 的下标。 */
  get cursor(): number {
    return this.cur;
  }
  /** 动作菜单当前选中项（0 = 交谈/查看，1 = 出示…/使用…）。 */
  get menuIndex(): 0 | 1 {
    return this.menuSel;
  }
  /** 当前子状态。 */
  get kind(): 'browse' | 'menu' | 'pick' {
    return this.sub.kind;
  }
  /** 格子总列表：照片在前、物品在后（M4 第 2 轮：挑选器里按 albumLists 排序）。 */
  things(): ThingId[] {
    const l = this.lists();
    return [...l.photos.map(p => p.id), ...l.items.map(i => i.id)];
  }
  /** 当前子状态下的两条列表（albumLists）。 */
  private lists(): { photos: PhotoRecord[]; items: ItemEntry[] } {
    return albumLists(this.game, this.game.modes.arg<AlbumArg>('mode.album'));
  }
  /** 把光标移到某件东西上（调试 show/use 的“选中”）；不在列表里返回 false。 */
  selectThing(thing: ThingId): boolean {
    const i = this.things().indexOf(thing);
    if (i < 0) return false;
    this.cur = i;
    return true;
  }

  enter(_prev: ModeId | null, arg?: unknown): void {
    const a = arg as AlbumArg | undefined;
    const l = albumLists(this.game, a);
    const photoCount = l.photos.length;
    const total = photoCount + l.items.length;
    this.fromMenu = this.carryFromMenu ?? false;
    this.carryFromMenu = null;
    this.menuSel = 0;
    if (a && 'menu' in a) {
      this.sub = { kind: 'menu', target: a.menu.target };
    } else if (a && 'pick' in a) {
      this.sub = { kind: 'pick', target: a.pick.target, verb: a.pick.verb };
      // 使用 → 先指到第一件未用的物品（排在物品区最前；一件没有就指到最新的关键照片）；出示 → 先指到最新的关键照片（没有照片就指到物品）
      const unused = l.items.some(i => !i.used);
      const wantItems = a.pick.verb === 'use' ? unused || photoCount === 0 : photoCount === 0;
      this.cur = wantItems && total > photoCount ? photoCount : 0;
    } else {
      this.sub = { kind: 'browse' };
      this.cur = a && 'tab' in a && a.tab === 'items' && total > photoCount ? photoCount : 0;
    }
    this.game.audio.sfx('ui_open');
  }
  exit(_next: ModeId | null): void {
    this.game.audio.sfx('ui_close');
  }
  /** 不合法返回 { ok:false, reason:'mode_disallows' }；需要下传时返回 { ok:false, pass:true } */
  handle(a: Action): ActionResult {
    switch (this.sub.kind) {
      case 'browse':
        return this.browse(a);
      case 'menu':
        return this.menu(a, this.sub.target);
      case 'pick':
        return this.pick(a, this.sub.target, this.sub.verb);
    }
  }
  update(_dt: number): void {
    // 冻结世界：栈顶时 Game.step 不调用 modes.update
  }

  private nav(dx: number, dy: number): ActionResult {
    const l = this.lists();
    const photoCount = l.photos.length;
    const total = photoCount + l.items.length;
    this.cur = albumNavIndex(this.cur, dx, dy, photoCount, total);
    this.game.audio.sfx('ui_tick');
    return ok({ cursor: this.cur });
  }

  private close(): ActionResult {
    const m = this.game.modes;
    m.pop('mode.album');
    return ok({ mode: m.top });
  }

  private browse(a: Action): ActionResult {
    const m = this.game.modes;
    switch (a.t) {
      case 'nav':
        return this.nav(a.dx, a.dy);
      case 'pick':
        this.cur = a.index;
        return this.openSelected();
      case 'confirm':
      case 'shutter':
        return this.openSelected();
      case 'album':
      case 'back':
        return this.close();
      case 'journal':
        m.pop('mode.album');
        return this.game.sys.journal.openJournal();
      default:
        return fail('mode_disallows');
    }
  }

  /** 浏览时打开选中格：巡夜本物品 → 巡夜本；文档类物品 → 阅读器（取景器中翻开显褪字）；照片与其他物品只选中。 */
  private openSelected(): ActionResult {
    const thing = this.things()[this.cur];
    if (thing === undefined) return fail('bad_option');
    if (thing.startsWith('ph.')) return ok({ thing });
    const meta = ITEMS[thing as ItemId];
    const j = this.game.sys.journal;
    if (meta.opensJournal) return j.openJournal();
    if (meta.doc) return j.openDoc(meta.doc, { vf: this.game.modes.has('mode.viewfinder') });
    return ok({ thing });
  }

  private menu(a: Action, target: InteractId): ActionResult {
    const act = (k: number): ActionResult => {
      if (k === 1) {
        this.close();
        void this.game.sys.interaction.activate(target, { verb: 'primary' }, 'player');
        return ok({ target });
      }
      if (k === 2) {
        const verb = this.game.sys.interaction.verbOf(target);
        this.switchTo({ pick: { target, verb } }, true);
        return ok({ target, verb });
      }
      return fail('bad_option');
    };
    switch (a.t) {
      case 'digit':
        return act(a.n);
      case 'choose':
        return typeof a.k === 'number' ? act(a.k) : fail('bad_args');
      case 'pick':
        return act(a.index + 1);
      case 'nav':
        if (a.dy !== 0 || a.dx !== 0) this.menuSel = this.menuSel === 0 ? 1 : 0;
        return ok({ menu: this.menuSel });
      case 'confirm':
      case 'shutter':
        return act(this.menuSel + 1);
      case 'back':
        return this.close();
      default:
        return fail('mode_disallows');
    }
  }

  private pick(a: Action, target: InteractId, verb: 'show' | 'use'): ActionResult {
    const confirm = (): ActionResult => {
      const thing = this.things()[this.cur];
      if (thing === undefined) return fail('bad_option');
      this.close();
      void this.game.sys.interaction.activate(target, { verb, thing }, 'player');
      return ok({ target, verb, thing });
    };
    switch (a.t) {
      case 'nav':
        return this.nav(a.dx, a.dy);
      case 'pick':
        this.cur = a.index;
        return confirm();
      case 'confirm':
      case 'shutter':
        return confirm();
      case 'album': {
        // Tab：在照片区与物品区之间跳
        const photoCount = this.lists().photos.length;
        const total = this.things().length;
        this.cur = this.cur < photoCount ? (total > photoCount ? photoCount : this.cur) : photoCount > 0 ? 0 : this.cur;
        return ok({ cursor: this.cur });
      }
      case 'back':
        if (this.fromMenu) {
          this.switchTo({ menu: { target } }, false);
          return ok({ mode: this.game.modes.top });
        }
        return this.close();
      default:
        return fail('mode_disallows');
    }
  }

  /** 子状态切换：pop + push（保留光标）。 */
  private switchTo(arg: AlbumArg, fromMenu: boolean): void {
    const m = this.game.modes;
    const keep = this.cur;
    m.pop('mode.album');
    this.carryFromMenu = fromMenu;
    m.push('mode.album', arg);
    if ('pick' in arg && fromMenu) return;   // 进挑选器：用 enter 里按 verb 选的初始格
    this.cur = keep;
  }
}
