// owner: integrator
// 拍照反馈（GDD §3.1 M2：“快门声，白闪 80ms，右下角飞入照片缩略图”；M1c 补上——M1b 的 UI 没有这一件）：
// 'photo' 事件 → 缩略图从 4:3 画框中央缩小飞到画框右下角，下方是照片标题（空镜就是失败原因，如“太远了”“门上还是光的。”），
// 关键照片右上角红标；停留 PHOTO_TOAST_SEC 后淡出。连拍时新的一张顶替旧的。
// 数据来源：'photo' 事件的 PhotoRecord（已拥有的关键照片重拍时记录里没有 thumb，退回相册里那张的 thumb）。
// 计时是纯装饰：按 UI.update 的 dt 走（冻结时也走），不影响玩法。UI 只读系统状态，不改状态、不发 'feedback'。

import type { Game } from '../core/game';
import type { PhotoRecord } from '../game/state';
import type { View } from './ui';
import { h, setClass, setShown, setText } from './dom';

/** 停留时长（秒，含飞入）。 */
const PHOTO_TOAST_SEC = 3.2;
/** 飞入动画时长（毫秒）。 */
const FLY_MS = 420;

export class PhotoToast implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private readonly img: HTMLElement;
  private readonly title: HTMLElement;
  private left = 0;
  private flyPending = false;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-phototoast');
    const card = h('div', 'cm-phototoast-card');
    this.img = h('div', 'cm-phototoast-img');
    this.title = h('div', 'cm-phototoast-title');
    card.append(this.img, this.title);
    this.el.append(card);
    setShown(this.el, false);
    game.events.on('photo', e => this.onPhoto(e.record));
  }

  /** 最近一张的标题（自测用；没有在显示时 null）。 */
  currentTitle(): string | null {
    return this.left > 0 ? this.title.textContent : null;
  }

  show(_arg?: unknown): void {
    setShown(this.el, true);
  }
  hide(): void {
    this.left = 0;
    setShown(this.el, false);
  }

  update(dt: number): void {
    if (this.left <= 0) return;
    if (this.flyPending) {
      this.flyPending = false;
      this.fly();
    }
    this.left -= dt;
    setClass(this.el, 'cm-leaving', this.left < 0.45);
    if (this.left <= 0) this.hide();
  }

  private onPhoto(rec: PhotoRecord): void {
    const thumb = rec.thumb ?? this.game.state.listPhotos().find(p => p.id === rec.id)?.thumb;
    if (thumb) this.img.style.backgroundImage = `url("${thumb}")`;
    else this.img.style.backgroundImage = '';
    setClass(this.img, 'cm-noimg', !thumb);
    setClass(this.el, 'cm-key', rec.key);
    setClass(this.el, 'cm-print', rec.print);
    setText(this.title, rec.caption ?? rec.title);
    this.left = PHOTO_TOAST_SEC;
    setClass(this.el, 'cm-leaving', false);
    this.show();
    // 飞入要在布局之后算起点：下一次 update 再做（同一帧里拍照事件可能先于 UI.update）
    this.flyPending = true;
  }

  /** 从画框中央、画框大小，缩到右下角的卡片位置（Web Animations；没有这个 API 的环境直接出现）。 */
  private fly(): void {
    const card = this.el.firstElementChild as HTMLElement | null;
    if (!card || typeof card.animate !== 'function') return;
    const root = this.el.closest('.cm-ui') as HTMLElement | null;
    const r = card.getBoundingClientRect();
    const host = (root ?? this.el).getBoundingClientRect();
    if (r.width <= 0 || host.width <= 0) return;
    const cs = root ? getComputedStyle(root) : null;
    const px = (name: string, dflt: number): number => {
      const v = cs ? parseFloat(cs.getPropertyValue(name)) : NaN;
      return Number.isFinite(v) ? v : dflt;
    };
    const fw = px('--fw', host.width);
    const fh = px('--fh', host.height);
    const fx = px('--fx', 0);
    const fy = px('--fy', 0);
    const s = Math.min(fw / r.width, fh / r.height) * 0.9;
    const dx = host.left + fx + fw / 2 - (r.left + r.width / 2);
    const dy = host.top + fy + fh / 2 - (r.top + r.height / 2);
    card.animate(
      [
        { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${s.toFixed(3)})`, opacity: 0.2, filter: 'brightness(2.2)' },
        { transform: 'translate(0, 0) scale(1)', opacity: 1, filter: 'brightness(1)' },
      ],
      { duration: FLY_MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
    );
  }
}
