// owner: WP4
// 游戏状态（ARCH §6.1）：flags、物品、照片、线索、seen 与只读视图 StateView；单调写入校验。
//
// 实现要点：
// - setFlag 是 flag 的唯一写入口：布尔 flag 只能 false→true，数值 flag 只增；未登记 id 在 dev 下抛错。
// - GameState 自己不发 'photo'（它不知道命中了哪个目标）：'photo' 由 PhotoSystem 在 shoot/award 里发；addPhoto 只记账并 save.request。
// - restore/reset/debugSet 不发 'flag'/'item' 事件（它们重建状态而不是“玩家做了什么”）；依赖推导量的系统（时辰、新页）在下一帧自行对账。
// - 视图字段（area/mode/vf/lens/zoom、temp）现取自 game，不在这里存。

import type { AreaKey, LensMode, ModeId, Shichen, ZoomLevel } from '../core/types';
import { ANT_FLAGS, F, IT, NUMERIC_FLAGS, PH, emptyPhotoId, isEmptyPhotoId } from '../data/ids';
import type { EmptyPhotoId, FlagId, ItemId, KeyPhotoId, NameId, PhotoId } from '../data/ids';
import { namesFromFlags } from '../data/names';
import { EMPTY_KEEP, PHOTO_META } from '../data/photos';
import type { Game } from '../core/game';
import type { PhotoContext } from './photo';
import type { SaveDataV1 } from './save';
import { devAssert, devWarn } from '../core/log';
import { deriveShichen } from './shichen';

export interface ItemEntry { id: ItemId; used: boolean; order: number }

export interface PhotoRecord {
  id: PhotoId; title: string; caption?: string;
  /** 关键照片（相册红标，永不删除） */
  key: boolean;
  /** 实物照片（ph.covered_face、ph.true_form） */
  print: boolean;
  seq: number; area: AreaKey; lens: LensMode; zoom: ZoomLevel;
  context: PhotoContext['kind'] | 'print' | 'tripod';
  /** 192×144 JPEG dataURL（可能缺失） */
  thumb?: string;
}

export interface StateView {
  /** 数值 flag：> 0 为真 */
  flag(id: FlagId): boolean;
  num(id: FlagId): number;
  has(id: ItemId): boolean;
  used(id: ItemId): boolean;
  hasPhoto(id: PhotoId): boolean;
  seen(key: string): boolean;
  /** 由 flags 推导（GDD §3.11） */
  names(): readonly NameId[];
  /** r1.ant_old_1..6 为真的个数 */
  antCount(): number;
  /** 当前区域的临时状态（ARCH §11.2 ctx.setTemp；未设置 = false；换区域即清空；不存档） */
  temp(key: string): boolean | number;
  /** 由 flags 推导（GDD §3.10） */
  readonly shichen: Shichen;
  readonly area: AreaKey;
  readonly mode: ModeId;
  readonly vf: boolean;
  readonly lens: LensMode;
  readonly zoom: ZoomLevel;
}

export const FLAG_IDS: ReadonlySet<string> = new Set<string>(Object.values(F));
export const ITEM_IDS: ReadonlySet<string> = new Set<string>(Object.values(IT));
export const KEY_PHOTO_IDS: ReadonlySet<string> = new Set<string>(Object.values(PH));

/** 数值 flag 的合法范围（GDD §13.3：r2.wang_floor 0–5）。 */
export const NUMERIC_MAX = 5;

export class GameState implements StateView {
  protected readonly game: Game;
  private readonly flags = new Map<FlagId, boolean | number>();
  private readonly items = new Map<ItemId, ItemEntry>();
  private photos: PhotoRecord[] = [];
  private readonly photoIndex = new Map<PhotoId, PhotoRecord>();
  private clues: string[] = [];
  private readonly seenSet = new Set<string>();
  private emptySeq = 0;
  private photoSeq = 0;
  private itemSeq = 0;

  constructor(game: Game) {
    this.game = game;
  }

  // —— StateView ——
  flag(id: FlagId): boolean {
    const v = this.flags.get(id);
    return typeof v === 'number' ? v > 0 : v === true;
  }
  num(id: FlagId): number {
    const v = this.flags.get(id);
    return typeof v === 'number' ? v : v === true ? 1 : 0;
  }
  has(id: ItemId): boolean {
    return this.items.has(id);
  }
  used(id: ItemId): boolean {
    return this.items.get(id)?.used === true;
  }
  hasPhoto(id: PhotoId): boolean {
    return this.photoIndex.has(id);
  }
  seen(key: string): boolean {
    return this.seenSet.has(key);
  }
  names(): readonly NameId[] {
    return namesFromFlags(id => this.flag(id));
  }
  antCount(): number {
    let n = 0;
    for (const id of ANT_FLAGS) if (this.flag(id)) n++;
    return n;
  }
  temp(key: string): boolean | number {
    // game.areas 在 Game 构造的后段才建；条件只在运行期求值，这里防御一下
    const cur = this.game.areas?.current;
    return cur ? cur.ctx.getTemp(key) : false;
  }
  get shichen(): Shichen {
    return deriveShichen(this);
  }
  get area(): AreaKey {
    return this.game.areas?.current?.def.id ?? 'r1';
  }
  get mode(): ModeId {
    return this.game.modes?.top ?? 'mode.explore';
  }
  get vf(): boolean {
    return this.game.sys?.viewfinder.on ?? false;
  }
  get lens(): LensMode {
    return this.game.sys?.viewfinder.lens ?? 'normal';
  }
  get zoom(): ZoomLevel {
    return this.game.sys?.viewfinder.zoom ?? 1;
  }

  // —— 写入（唯一入口）——
  /** 只能 false→true；数值只增；返回是否变化；变化时发 'flag' 并 save.request() */
  setFlag(id: FlagId, value?: true | number): boolean {
    devAssert(FLAG_IDS.has(id), `setFlag: 未登记的 flag '${id}'`);
    if (!FLAG_IDS.has(id)) return false;
    const numeric = NUMERIC_FLAGS.has(id);
    const prev: boolean | number = numeric ? this.num(id) : this.flag(id);
    let next: boolean | number;
    if (numeric) {
      devAssert(typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= NUMERIC_MAX,
        `setFlag('${id}'): 数值 flag 需要 0–${NUMERIC_MAX} 的整数，得到 ${String(value)}`);
      const n = typeof value === 'number' ? Math.max(0, Math.min(NUMERIC_MAX, Math.floor(value))) : 1;
      if (n <= (prev as number)) return false;   // 只增
      next = n;
    } else {
      devAssert(value === undefined || value === true, `setFlag('${id}'): 布尔 flag 不接受数值 ${String(value)}`);
      if (prev === true) return false;           // 只能 false→true
      next = true;
    }
    this.flags.set(id, next);
    this.game.events.emit('flag', { id, value: next, prev });
    this.game.save.request('flag');
    return true;
  }
  /** 已有则无操作 */
  giveItem(id: ItemId): boolean {
    devAssert(ITEM_IDS.has(id), `giveItem: 未登记的物品 '${id}'`);
    if (!ITEM_IDS.has(id) || this.items.has(id)) return false;
    this.items.set(id, { id, used: false, order: ++this.itemSeq });
    this.game.events.emit('item', { id, kind: 'added' });
    this.game.save.request('item');
    return true;
  }
  markUsed(id: ItemId): void {
    const e = this.items.get(id);
    if (!e) {
      // 没有的东西不能“用过”；多半是区域 handler 的守卫漏了
      devWarn(`markUsed('${id}')：身上没有这件物品`);
      return;
    }
    if (e.used) return;
    e.used = true;
    this.game.events.emit('item', { id, kind: 'used' });
    this.game.save.request('item');
  }
  /** 关键照片重复获得时保留旧记录（不重复），返回旧记录 */
  addPhoto(r: Omit<PhotoRecord, 'seq'>): PhotoRecord {
    const empty = isEmptyPhotoId(r.id);
    devAssert(empty || KEY_PHOTO_IDS.has(r.id), `addPhoto: 未登记的照片 '${r.id}'`);
    const old = this.photoIndex.get(r.id);
    if (old) return old;
    const rec: PhotoRecord = { ...r, seq: ++this.photoSeq };
    this.photos.push(rec);
    this.photoIndex.set(rec.id, rec);
    if (empty) this.trimEmpties();
    this.game.save.request('photo');
    return rec;
  }
  /** ph.empty_<n>，n 递增；空镜只保留最近 20 张 */
  nextEmptyId(): EmptyPhotoId {
    this.emptySeq++;
    return emptyPhotoId(this.emptySeq);
  }
  /** 按全文去重 */
  addClue(text: string): boolean {
    if (!text || this.clues.includes(text)) return false;
    this.clues.push(text);
    this.game.save.request('manual');
    return true;
  }
  /** 阴物常显、已读文档、已浮现新页、已看过的过场 */
  markSeen(key: string): void {
    if (this.seenSet.has(key)) return;
    this.seenSet.add(key);
    this.game.save.request('manual');
  }
  snapshot(): SaveDataV1['core'] {
    const flags: Record<string, boolean | number> = {};
    for (const [k, v] of this.flags) flags[k] = v;
    return {
      flags,
      items: this.listItems().map(e => ({ ...e })),
      photos: this.photos.map(p => ({ ...p })),
      clues: [...this.clues],
      seen: [...this.seenSet],
      emptySeq: this.emptySeq,
    };
  }
  /** 装入已校验的存档核心（SaveSystem.read 已修复过内容）。不发事件。 */
  restore(d: SaveDataV1['core']): void {
    this.clearAll();
    for (const [k, v] of Object.entries(d.flags)) {
      if (!FLAG_IDS.has(k)) continue;
      if (v === false || v === 0) continue;
      this.flags.set(k as FlagId, v);
    }
    for (const e of [...d.items].sort((a, b) => a.order - b.order)) {
      if (!ITEM_IDS.has(e.id) || this.items.has(e.id)) continue;
      this.items.set(e.id, { id: e.id, used: e.used, order: e.order });
      this.itemSeq = Math.max(this.itemSeq, e.order);
    }
    for (const p of [...d.photos].sort((a, b) => a.seq - b.seq)) {
      if (this.photoIndex.has(p.id)) continue;
      const rec: PhotoRecord = { ...p };
      this.photos.push(rec);
      this.photoIndex.set(rec.id, rec);
      this.photoSeq = Math.max(this.photoSeq, p.seq);
    }
    this.clues = [...new Set(d.clues)];
    for (const s of d.seen) this.seenSet.add(s);
    this.emptySeq = Math.max(d.emptySeq, maxEmptyNo(this.photos));
  }
  /** 清空全部进度（新游戏；M1a 补写） */
  reset(): void {
    this.clearAll();
  }

  // —— 列表读取（相册、物品栏、巡夜本、DebugState；M1a 补写）——
  /** 物品（按获得顺序） */
  listItems(): readonly ItemEntry[] {
    return [...this.items.values()].sort((a, b) => a.order - b.order);
  }
  /** 照片（按 seq） */
  listPhotos(): readonly PhotoRecord[] {
    return this.photos;
  }
  /** 一张照片的记录（没有返回 null；M3 补写：GameApi.photo.record 的实现，只读） */
  photoRecord(id: PhotoId): Readonly<PhotoRecord> | null {
    return this.photoIndex.get(id) ?? null;
  }
  /** 巡夜本“已知线索” */
  listClues(): readonly string[] {
    return this.clues;
  }
  /** 全部已设置的 flag（未设置的不列出） */
  listFlags(): Readonly<Record<string, boolean | number>> {
    const out: Record<string, boolean | number> = {};
    for (const [k, v] of this.flags) out[k] = v;
    return out;
  }
  /** seen 集合（调试与自测用；WP4 补充，非冻结签名） */
  listSeen(): readonly string[] {
    return [...this.seenSet];
  }

  /**
   * 只供 ?debug=1：原样设置（绕过单调校验；false/0 = 清除该 flag），不发 'flag'/'item' 事件
   * （调试 API 的 setFlags 另行调用 npc.reevaluate，ARCH §12.3）。照片按 PHOTO_META 生成记录（空镜 id 也接受）。
   */
  debugSet(p: { flags?: Record<string, boolean | number>; items?: (ItemId | { id: ItemId; used: boolean })[]; photos?: PhotoId[] }): void {
    if (p.flags) {
      for (const [k, v] of Object.entries(p.flags)) {
        devAssert(FLAG_IDS.has(k), `debugSet: 未登记的 flag '${k}'`);
        if (!FLAG_IDS.has(k)) continue;
        const id = k as FlagId;
        if (v === false || v === 0) this.flags.delete(id);
        else if (NUMERIC_FLAGS.has(id)) this.flags.set(id, typeof v === 'number' ? Math.max(0, Math.min(NUMERIC_MAX, Math.floor(v))) : 1);
        else this.flags.set(id, true);
      }
    }
    if (p.items) {
      for (const it of p.items) {
        const id = typeof it === 'string' ? it : it.id;
        const used = typeof it === 'string' ? false : it.used;
        devAssert(ITEM_IDS.has(id), `debugSet: 未登记的物品 '${id}'`);
        if (!ITEM_IDS.has(id)) continue;
        const e = this.items.get(id);
        if (e) e.used = used;
        else this.items.set(id, { id, used, order: ++this.itemSeq });
      }
    }
    if (p.photos) {
      for (const id of p.photos) {
        if (this.photoIndex.has(id)) continue;
        if (isEmptyPhotoId(id)) {
          this.addPhoto({ id, title: '空镜', key: false, print: false, area: this.area, lens: 'normal', zoom: 1, context: 'live' });
          this.emptySeq = Math.max(this.emptySeq, Number(id.slice('ph.empty_'.length)));
          continue;
        }
        devAssert(KEY_PHOTO_IDS.has(id), `debugSet: 未登记的照片 '${id}'`);
        if (!KEY_PHOTO_IDS.has(id)) continue;
        const meta = PHOTO_META[id as KeyPhotoId];
        this.addPhoto({ id, title: meta.title, key: meta.key, print: meta.print, area: this.area, lens: 'normal', zoom: 1, context: meta.print ? 'print' : 'live' });
      }
    }
    this.game.save.request('manual');
  }

  private clearAll(): void {
    this.flags.clear();
    this.items.clear();
    this.photos = [];
    this.photoIndex.clear();
    this.clues = [];
    this.seenSet.clear();
    this.emptySeq = 0;
    this.photoSeq = 0;
    this.itemSeq = 0;
  }

  /** 空镜只保留最近 EMPTY_KEEP 张（关键照片永不删除）。 */
  private trimEmpties(): void {
    const empties = this.photos.filter(p => isEmptyPhotoId(p.id));
    const extra = empties.length - EMPTY_KEEP;
    if (extra <= 0) return;
    const drop = new Set(empties.slice(0, extra).map(p => p.id));
    this.photos = this.photos.filter(p => !drop.has(p.id));
    for (const id of drop) this.photoIndex.delete(id);
  }
}

/** 现存空镜编号的最大值（读档修复 emptySeq 用）。 */
export function maxEmptyNo(photos: readonly { id: string }[]): number {
  let m = 0;
  for (const p of photos) if (isEmptyPhotoId(p.id)) m = Math.max(m, Number(p.id.slice('ph.empty_'.length)));
  return m;
}
