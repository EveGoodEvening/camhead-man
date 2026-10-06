// owner: WP4
// 巡夜本与文档（ARCH §6.16）：新页浮现、称呼表、已知线索、“树底下 n/6”；文档注册表；文档视图（取景器中显褪字）。
//
// 实现要点（WP4）：
// - renderDoc(id, vf)：〔…〕 是褪字层，vf 时换成里面的字，否则整段换成一个水渍符号 STRINGS.doc.waterStain（“▯”）。
//   covered（讣告下半截）附在正文之后：读到 readBy 之前每个非空白字打码成“█”。读字系统发 'read' 事件时本系统记 seen(readId)。
// - openDoc 压 mode.journal（arg = { doc, vf }），vf 缺省 = 栈上有 viewfinder；打开时记 seen(docId)（“已读文档”）。
//   从相册点开时压在 album 之上：Esc 先合上文档、回到相册（readDoc 调试路径要 back 两次才回到探索）。
// - 新页：update() 每帧（冻结时不调用）按 when 求可见；新近可见且未 seen('page:<n>') 的页——若自上次检查以来有过
//   'flag'/'temp' 事件（玩家推进导致）就 toast“巡夜本上多了一行字” + 主动机 + 发 'journal:page'；否则（读档、调试预置）静默记 seen。

import type { ApiResult } from '../core/types';
import { fail, ok } from '../core/types';
import type { DocId, ReadId } from '../data/ids';
import { STRINGS, fmt } from '../data/strings';
import { NAMES } from '../data/names';
import type { Game } from '../core/game';
import type { StateView } from './state';
import type { Cond } from './expr';
import { compileCond } from './expr';
import { devAssert } from '../core/log';

export interface DocDef {
  id: DocId; title: string;
  style: 'ballpoint' | 'wet_ink' | 'print' | 'notice' | 'slip' | 'letter' | 'ticket' | 'book' | 'plaque';
  /** 褪字层标记：〔…〕 包住的文字只在取景器中翻开时显出（GDD M1、§7.4 取件单“No.04〔7〕3”） */
  body: string | ((s: StateView) => string);
  /** 讣告下半截：读到 rd.obituary_hidden 之前在阅读器里打码 */
  covered?: { text: string; readBy: ReadId };
}

/** 新页①–⑨（R1 text.ts 提供） */
export interface JournalPageDef { index: number; when: Cond; text: string }

/** mode.journal 的进入参数：打开文档时 { doc, vf }；打开巡夜本时 undefined（M1a 补写） */
export type JournalArg = { doc: DocId; vf: boolean } | undefined;

/** 褪字层标记。 */
const FADED = /〔([^〕]*)〕/g;
/** 被盖住的字的打码符号。 */
export const COVER_MASK = '█';

/** 巡夜本右页数据（UI 用；WP4 补充，非冻结签名）。 */
export interface JournalRight {
  names: { id: string; text: string; source: string }[];
  clues: readonly string[];
  ants: number;
  antsText: string;
}

export class JournalSystem {
  protected readonly game: Game;
  private readonly docs = new Map<DocId, DocDef>();
  private pages: { def: JournalPageDef; when: (s: StateView) => boolean }[] = [];
  /** 自上次 update 以来有没有 flag/temp 变化（区分“玩家推进出新页”与“读档/预置后本来就可见”） */
  private dirty = false;

  constructor(game: Game) {
    this.game = game;
    game.events.on('flag', () => { this.dirty = true; });
    game.events.on('temp', () => { this.dirty = true; });
    game.events.on('read', e => game.state.markSeen(e.id));
  }

  /** 启动时从全部区域的 text.ts 汇总 */
  registerDocs(docs: readonly DocDef[]): void {
    for (const d of docs) {
      devAssert(!this.docs.has(d.id), `JournalSystem.registerDocs: 文档 '${d.id}' 重复`);
      this.docs.set(d.id, d);
    }
  }
  registerPages(p: readonly JournalPageDef[]): void {
    for (const def of p) {
      devAssert(!this.pages.some(x => x.def.index === def.index), `JournalSystem.registerPages: 新页 ${def.index} 重复`);
      this.pages.push({ def, when: compileCond(def.when, `journal page ${def.index}`) });
    }
    this.pages.sort((a, b) => a.def.index - b.def.index);
  }
  /** 推 mode.journal，arg = { doc, vf }；vf 缺省 = 当前栈上有 viewfinder */
  openDoc(id: DocId, o?: { vf?: boolean }): ApiResult {
    if (!this.docs.has(id)) return fail('no_such_target');
    const vf = o?.vf ?? this.game.modes.has('mode.viewfinder');
    const arg: JournalArg = { doc: id, vf };
    const r = this.game.modes.push('mode.journal', arg);
    if (!r.ok) return r;
    this.game.state.markSeen(id);
    return ok({ doc: id, vf });
  }
  /** 纯文本正文：vf 时〔…〕换成里面的字，否则换成水渍符号“▯”（UI 画成一团水渍） */
  renderDoc(id: DocId, vf: boolean): string {
    const d = this.docs.get(id);
    if (!d) return '';
    const s = this.game.state;
    const faded = (t: string): string => t.replace(FADED, (_m, inner: string) => (vf ? inner : STRINGS.doc.waterStain));
    let text = faded(typeof d.body === 'function' ? d.body(s) : d.body);
    if (d.covered) {
      const c = faded(d.covered.text);
      text += `\n${s.seen(d.covered.readBy) ? c : c.replace(/\S/g, COVER_MASK)}`;
    }
    return text;
  }
  /** 已登记的文档定义（阅读器 UI 用；M1a 补写） */
  doc(id: DocId): DocDef | undefined {
    return this.docs.get(id);
  }
  openJournal(): ApiResult {
    const r = this.game.modes.push('mode.journal');
    if (!r.ok) return r;
    return ok();
  }
  visiblePages(): JournalPageDef[] {
    const s = this.game.state;
    return this.pages.filter(p => p.when(s)).map(p => p.def);
  }
  /** ARCH §3.2 第 6 步由 Game.step 调用（冻结时不调用）：检查新页，首次可见 → toast“巡夜本上多了一行字” + 主动机 + markSeen */
  update(): void {
    const live = this.dirty;
    this.dirty = false;
    const s = this.game.state;
    let fresh = 0;
    for (const p of this.pages) {
      const key = pageKey(p.def.index);
      if (s.seen(key) || !p.when(s)) continue;
      s.markSeen(key);
      if (!live) continue;
      fresh++;
      this.game.events.emit('journal:page', { index: p.def.index });
    }
    if (fresh > 0) {
      // M4 第 2 轮：过场/对话里出的新页，提示与主动机一起延后到它们结束（UI.toast 的 'page' 闸门；onShow 在真正显示时调）
      const audio = this.game.audio;
      this.game.ui.toast(STRINGS.hud.newPage, 'page', { onShow: () => audio.music('motif_dea') });
    }
  }

  // ——————————————————————————————— WP4 内部（非冻结签名）

  /**
   * M4：巡夜本本身打开时（JournalMode.enter 且没有 arg），此刻可见的新页都算已经看过——拾取巡夜本自动翻开读到新页①，
   * 合上后不再弹“巡夜本上多了一行字”（世界冻结期间 update() 不跑，原来要等合上后才补这条 toast）。
   */
  markVisibleSeen(): void {
    const s = this.game.state;
    for (const p of this.pages) {
      const key = pageKey(p.def.index);
      if (s.seen(key) || !p.when(s)) continue;
      s.markSeen(key);
      if (this.dirty) this.game.events.emit('journal:page', { index: p.def.index });
    }
  }

  /** 巡夜本右页：称呼（state.names() + NAMES 来源说明）、已知线索、树底下 n/6。 */
  right(): JournalRight {
    const s = this.game.state;
    const n = s.antCount();
    return {
      names: s.names().map(id => ({ id, text: NAMES[id].text, source: NAMES[id].source })),
      clues: this.game.state.listClues(),
      ants: n,
      antsText: fmt(STRINGS.journal.ants, { n }),
    };
  }
  /** 该页是否已浮现过（UI 画“墨迹未干”用）。 */
  pageSeen(index: number): boolean {
    return this.game.state.seen(pageKey(index));
  }
}

/** 新页的 seen 键。 */
export function pageKey(index: number): string {
  return `page:${index}`;
}
