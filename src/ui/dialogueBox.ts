// owner: WP6
// 对话框（ARCH §6.13、§7）：说话人名、打字机正文、选项（1–4，鼠标点选发 {t:'choose',k}）；pc.huoji 的行只闪 REC。
// 数据来源：读 game.sys.dialogue.active；旁白（who 为 '' 或 spk.narrator）用斜体。UI 只读系统状态、只通过 game.dispatch() 或系统公开方法发起动作，不直接改状态。
//
// 打字机的节奏归 DialogueSystem（游戏时间；?test=1 即时）：active.text 恒为全文，typing 为真时显示前 active.shown 个字，
// typing 变假立即显示全文（M1c 冻结，engine-wp6.md #6）。

import type { Game } from '../core/game';
import type { View } from './ui';
import { STRINGS } from '../data/strings';
import { isNarration, speakerName, SPEAKERS } from '../data/speakers';
import { h, setClass, setShown, setText, uiButton } from './dom';

/** pc.huoji 的一行：HUD 的 REC 点跟着快闪这么久。 */
const REC_FLASH_SEC = 1.2;

export class DialogueBox implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private readonly name: HTMLElement;
  private readonly text: HTMLElement;
  private readonly rec: HTMLElement;
  private readonly recDot: HTMLElement;
  private readonly opts: HTMLElement;
  private readonly more: HTMLElement;
  private shown = false;
  private key = '';
  private fullText = '';
  private revealed = 0;
  private optKey = '';
  private t = 0;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-dlg');
    this.name = h('div', 'cm-dlg-name');
    this.text = h('div', 'cm-dlg-text');
    this.rec = h('div', 'cm-dlg-rec');
    this.recDot = h('span', 'cm-rec-dot');
    this.rec.append(this.recDot, document.createTextNode(STRINGS.hud.rec));
    this.opts = h('div', 'cm-dlg-opts');
    this.more = h('div', 'cm-dlg-more', '▼');
    this.el.append(this.name, this.text, this.rec, this.opts, this.more);
    // 左键在对话里只用来点选项（ARCH 附录 A）；推进走 E/空格，所以正文区不接点击
    this.el.addEventListener('mousedown', ev => ev.preventDefault());
    setShown(this.el, false);
  }

  show(_arg?: unknown): void {
    if (!this.shown) {
      this.key = '';
      this.optKey = '';
    }
    this.shown = true;
    setShown(this.el, true);
  }
  hide(): void {
    this.shown = false;
    setShown(this.el, false);
  }

  update(dt: number): void {
    this.t += dt;
    if (!this.shown) return;
    const g = this.game;
    const a = g.sys.dialogue.active;
    if (!a) {
      setShown(this.el, false);
      return;
    }
    setShown(this.el, true);
    const recOnly = a.who !== '' && SPEAKERS[a.who].recOnly === true;
    const narr = isNarration(a.who);
    setClass(this.el, 'cm-narr', narr);
    setText(this.name, recOnly || narr ? '' : speakerName(a.who));

    // 新的一行：从头显出（同一节点的文字如果只是变长了——系统自己在打字——不重置）
    const key = `${a.id}#${a.node}`;
    if (key !== this.key || !a.text.startsWith(this.fullText.slice(0, Math.min(this.fullText.length, a.text.length)))) {
      this.key = key;
      this.revealed = 0;
      if (recOnly) this.game.ui.hud.flashRec(REC_FLASH_SEC);
    }
    this.fullText = a.text;
    const chars = [...a.text];
    // 打字机进度的唯一来源是 DialogueSystem（active.shown，游戏时间；M1c 冻结，engine-wp6.md #6）
    this.revealed = a.typing ? a.shown : chars.length;
    const n = Math.min(chars.length, Math.floor(this.revealed));
    // 没有正文的选项节点（只有选项）不留空白
    setShown(this.text, !recOnly && a.text !== '');
    setShown(this.rec, recOnly);
    if (recOnly) setClass(this.recDot, 'cm-off', (this.t % 0.5) >= 0.25);
    else setText(this.text, chars.slice(0, n).join(''));

    // 选项：1 起编号；点选发 {t:'choose', k}（与数字键同一条路径，ARCH §6.13）
    const optKey = a.options.join('\u0001');
    if (optKey !== this.optKey) {
      this.optKey = optKey;
      this.opts.replaceChildren(...a.options.map((label, i) => {
        const b = uiButton('', 'cm-dlg-opt', () => { this.game.dispatch({ t: 'choose', k: i + 1 }); });
        b.append(h('span', 'cm-k', String(i + 1)), h('span', undefined, label));
        return b;
      }));
    }
    const typingDone = !a.typing && n >= chars.length;
    setShown(this.opts, a.options.length > 0 && typingDone);
    setShown(this.more, a.options.length === 0 && typingDone);
  }
}
