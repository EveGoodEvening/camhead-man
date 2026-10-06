// owner: WP6
// 动作菜单（ARCH §6.6、§7）：mode.album 的 menu 子状态，“1 交谈/查看”“2 出示…/使用…”。
// 数据来源：读 game.modes.arg('mode.album')（AlbumArg 的 menu）。UI 只读系统状态、只通过 game.dispatch() 或系统公开方法发起动作，不直接改状态。
// 点选发 {t:'digit', n: 1|2}：与键盘 1/2 在 album 模式里是同一个 Action（ARCH 附录 A 的 digit 行）。

import type { Game } from '../core/game';
import type { InteractId } from '../data/ids';
import type { AlbumArg, InteractableDef } from '../game/interaction';
import type { View } from './ui';
import { STRINGS } from '../data/strings';
import { NPC } from '../data/ids';
import { evalDyn, h, keyHints, setShown, setText, uiButton } from './dom';

const NPC_IDS: ReadonlySet<string> = new Set(Object.values(NPC));

/** 取 AlbumArg 里的 menu 目标（不是菜单子状态则 null）。 */
export function albumMenuTarget(arg: AlbumArg | undefined): InteractId | null {
  return arg && 'menu' in arg ? arg.menu.target : null;
}

/** “1 交谈”还是“1 查看”：有对话项或是 NPC 就是交谈。 */
export function menuPrimaryIsTalk(id: InteractId, def: InteractableDef | undefined): boolean {
  return NPC_IDS.has(id) || (def?.talk?.length ?? 0) > 0;
}

/** 菜单里显示“出示…”还是“使用…”（ARCH §6.6：NPC/纸像默认 show，物体默认 use）。 */
export function menuVerbOf(id: InteractId, def: InteractableDef | undefined): 'show' | 'use' {
  return def?.menuVerb ?? (menuPrimaryIsTalk(id, def) ? 'show' : 'use');
}

export class ActionMenu implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private readonly title: HTMLElement;
  private readonly primary: HTMLButtonElement;
  private readonly offer: HTMLButtonElement;
  private target: InteractId | null = null;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-amenu');
    this.title = h('div', 'cm-amenu-title');
    this.primary = uiButton('', 'cm-amenu-item', () => { this.game.dispatch({ t: 'digit', n: 1 }); });
    this.offer = uiButton('', 'cm-amenu-item', () => { this.game.dispatch({ t: 'digit', n: 2 }); });
    this.el.append(this.title, this.primary, this.offer, keyHints([['Esc', '返回']]));
    this.el.addEventListener('mousedown', ev => ev.preventDefault());
    setShown(this.el, false);
  }

  show(arg?: unknown): void {
    const a = (arg ?? this.game.modes.arg<AlbumArg>('mode.album')) as AlbumArg | undefined;
    this.target = albumMenuTarget(a);
    setShown(this.el, true);
    this.refresh();
  }
  hide(): void {
    this.target = null;
    setShown(this.el, false);
  }
  update(_dt: number): void {
    const t = albumMenuTarget(this.game.modes.arg<AlbumArg>('mode.album'));
    if (t !== this.target) {
      this.target = t;
      this.refresh();
    }
  }

  private refresh(): void {
    const id = this.target;
    if (!id) return;
    const def = this.game.sys.interaction.get(id);
    // 标题是角标同一个现算名字（不泄题：与角标一致，ARCH §6.6）
    setText(this.title, (def ? evalDyn(def.label, this.game.state) : undefined) ?? '');
    setText(this.primary, menuPrimaryIsTalk(id, def) ? STRINGS.actionMenu.talk : STRINGS.actionMenu.look);
    setText(this.offer, menuVerbOf(id, def) === 'show' ? STRINGS.actionMenu.show : STRINGS.actionMenu.use);
  }
}
