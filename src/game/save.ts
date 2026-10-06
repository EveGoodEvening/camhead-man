// owner: WP4
// 存档（ARCH §6.4；GDD §3.13）：槽位、延迟存档、版本号、读档校验、结局期间暂停落盘、通关标记。
//
// 实现要点（WP4）：
// - request() 只标脏；真正落盘在 flushIfSafe()（Game.step 第 12 步）：栈上无临时模式、没有 hold、当前区域是真实区域（dev 不存档）。
// - E.save('save.yin') → requestSlot：安全时立即写，否则记下，等 flushIfSafe 在回到安全模式时写（写时状态已含 r4.got_tape）。
// - hold('ending') 挡住一切落盘（flushIfSafe、requestSlot、writeSlot）；markCompleted 是唯一例外（片尾播完要写通关标记）。
//   “新游戏”“从寅时重来”（clearCompleted）与读档（load）会清掉 hold：它们都从结局之前的状态重新开始。
// - read() 校验失败（parse/version/schema）时把原始字符串另存为 `<key>.bad`（原数据保留，has() 仍为假）；
//   结构对但内容可疑时就地修复并列在 repaired 里（未知 id 丢弃、r2.wang_floor 钳到 0–5、区域/出生点纠正、emptySeq 对齐）。
// - localStorage 不可用或写入失败时只在内存中继续（try/catch）；缩略图超配额时去掉 thumb 重试。

import type { AreaId, LensMode, ZoomLevel } from '../core/types';
import { AREA_IDS, ZOOM_STEPS } from '../core/types';
import { NUMERIC_FLAGS, SPAWN, isEmptyPhotoId } from '../data/ids';
import type { FlagId, ItemId, PhotoId, SpawnId } from '../data/ids';
import type { Game } from '../core/game';
import type { ItemEntry, PhotoRecord } from './state';
import { FLAG_IDS, ITEM_IDS, KEY_PHOTO_IDS, NUMERIC_MAX, maxEmptyNo } from './state';
import { devWarn } from '../core/log';
import { STRINGS } from '../data/strings';

export interface SaveDataV1 {
  v: 1; savedAt: number;
  core: {
    flags: Record<string, boolean | number>;
    items: ItemEntry[];
    /** 缩略图超配额时去掉 thumb 重试 */
    photos: PhotoRecord[];
    clues: string[];
    seen: string[];
    emptySeq: number;
  };
  /** dev 沙盒不存档 */
  area: AreaId; spawn: SpawnId;
}

export type SaveReadResult = { ok: true; data: SaveDataV1; repaired: string[] } | { ok: false; reason: 'missing' | 'parse' | 'version' | 'schema' };

export type SaveSlotName = 'save.auto' | 'save.yin';

/** localStorage 键（ARCH §6.4）。损坏存档另存为 `${key}.bad`。 */
export const SAVE_KEYS = {
  'save.auto': 'camhead-man.save.auto',
  'save.yin': 'camhead-man.save.yin',
  settings: 'camhead-man.settings',
  completed: 'camhead-man.completed',
} as const;

/** 取 localStorage（不可用时 null；隐私模式、node 自测都可能没有）。 */
export function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}
function getItem(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function setItem(key: string, value: string): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
function removeItem(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* 只在内存中继续 */
  }
}

/** 出生点 → 区域的静态推断（AreaManager 不可用时的后备，按 GDD §13.2 的命名）。 */
function spawnAreaGuess(spawn: string): AreaId | null {
  const m = /^spawn\.(r2_502|r1|r2|r3|r4)_/.exec(spawn);
  return m ? (m[1] as AreaId) : null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

export class SaveSystem {
  protected readonly game: Game;
  private dirty = false;
  private readonly holds = new Set<'ending'>();
  private pendingYin = false;
  /** 存储不可用时的内存后备（通关标记） */
  private completedMem: boolean | null = null;
  /** M4 第 2 轮：写入失败已经提示过（一个页面只提示一次） */
  private writeWarned = false;

  constructor(game: Game) {
    this.game = game;
  }

  /** 标记脏 */
  request(_reason: 'flag' | 'area' | 'item' | 'photo' | 'manual'): void {
    this.dirty = true;
  }
  /** 栈上无临时模式、且没有 hold 时写 save.auto */
  flushIfSafe(): void {
    if (!this.dirty && !this.pendingYin) return;
    if (!this.safe()) return;
    if (this.pendingYin) {
      this.pendingYin = false;
      this.writeSlot('save.yin');
    }
    if (this.dirty) {
      this.dirty = false;
      // 已通关后不再写 save.auto（否则标题菜单又会出现“继续”）
      if (!this.completed) this.writeSlot('save.auto');
    }
  }
  /** 暂停一切落盘（含 flushIfSafe 与 E.save），直到 release */
  hold(key: 'ending'): void {
    this.holds.add(key);
  }
  release(key: 'ending'): void {
    this.holds.delete(key);
  }
  /** 有未 release 的 hold（DebugState.saves.hold 读它） */
  get held(): boolean {
    return this.holds.size > 0;
  }
  /** try/catch；失败只在内存中继续 */
  writeSlot(slot: SaveSlotName): boolean {
    if (this.held) return false;
    const cur = this.game.areas?.current;
    if (!cur || !(AREA_IDS as readonly string[]).includes(cur.def.id)) return false;   // 标题画面与 dev 沙盒不存档
    const data: SaveDataV1 = {
      v: 1,
      savedAt: Date.now(),
      core: this.game.state.snapshot(),
      area: cur.def.id as AreaId,
      spawn: cur.spawnUsed,
    };
    let ok = setItem(SAVE_KEYS[slot], JSON.stringify(data));
    if (!ok) {
      // 多半是配额：去掉缩略图再试一次
      const lean: SaveDataV1 = {
        ...data,
        core: { ...data.core, photos: data.core.photos.map(p => { const c = { ...p }; delete c.thumb; return c; }) },
      };
      ok = setItem(SAVE_KEYS[slot], JSON.stringify(lean));
    }
    if (!ok) {
      devWarn(`存档 ${slot} 写入失败，只在内存中继续`);
      // M4 第 2 轮：告诉玩家（存储被禁用、配额满时原来毫无提示，关页面就丢进度）；一个页面只提示一次。
      // 浏览器禁用站点数据时 storage() 为 null，进第一个区域的那次存档就会走到这里
      if (!this.writeWarned) {
        this.writeWarned = true;
        this.game.ui?.toast(STRINGS.save.writeFailed, 'system');
      }
      return false;
    }
    this.game.events.emit('save', { slot });
    return true;
  }
  /** 解析 + 版本 + schema 校验（ARCH §6.4） */
  read(slot: SaveSlotName): SaveReadResult {
    const key = SAVE_KEYS[slot];
    const raw = getItem(key);
    if (raw === null) return { ok: false, reason: 'missing' };
    const r = this.validate(raw);
    // 原数据另存一份备份（原键保留；has() 每帧被问也不重复写）
    if (!r.ok && getItem(`${key}.bad`) !== raw) setItem(`${key}.bad`, raw);
    return r;
  }
  /** = read(slot).ok（损坏的存档不算“有”） */
  has(slot: SaveSlotName): boolean {
    return this.read(slot).ok;
  }
  /** read(slot) 通过后 state.restore(data.core) 并返回结果；ok:false 时不改状态、原数据另存 *.bad（M1a 补写；Game.continueFrom 用） */
  load(slot: SaveSlotName): SaveReadResult {
    const r = this.read(slot);
    if (!r.ok) return r;
    this.game.state.restore(r.data.core);
    this.holds.clear();
    this.dirty = false;
    this.pendingYin = false;
    return r;
  }
  /** 片尾播完：删除 save.auto，写 camhead-man.completed = 时间戳 */
  markCompleted(): void {
    removeItem(SAVE_KEYS['save.auto']);
    if (!setItem(SAVE_KEYS.completed, String(Date.now()))) this.completedMem = true;
    else this.completedMem = null;
    this.dirty = false;
  }
  get completed(): boolean {
    if (this.completedMem !== null) return this.completedMem;
    return getItem(SAVE_KEYS.completed) !== null;
  }
  /** 清除通关标记（“新游戏”“从寅时重来”；M1a 补写） */
  clearCompleted(): void {
    removeItem(SAVE_KEYS.completed);
    this.completedMem = null;
    this.holds.clear();
    this.dirty = false;
    this.pendingYin = false;
  }
  clearAll(): void {
    removeItem(SAVE_KEYS['save.auto']);
    removeItem(SAVE_KEYS['save.yin']);
    removeItem(SAVE_KEYS.completed);
    this.completedMem = null;
    this.holds.clear();
    this.dirty = false;
    this.pendingYin = false;
  }

  // ——————————————————————————————— WP4 内部（非冻结签名）

  /** E.save(slot)：安全时立即写；否则推迟到 flushIfSafe（回到 explore/viewfinder 且无 hold）。 */
  requestSlot(slot: 'save.yin'): void {
    if (slot !== 'save.yin' || this.held) return;   // hold 期间一切落盘都停（ARCH §6.4）
    if (this.safe()) this.writeSlot(slot);
    else this.pendingYin = true;
  }
  /** 有待写的寅时槽（自测用）。 */
  get pending(): { auto: boolean; yin: boolean } {
    return { auto: this.dirty, yin: this.pendingYin };
  }

  private safe(): boolean {
    if (this.held) return false;
    const m = this.game.modes;
    return !m.isTransient();
  }

  /** 解析 + 版本 + 结构校验 + 就地修复。 */
  private validate(raw: string): SaveReadResult {
    let j: unknown;
    try {
      j = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'parse' };
    }
    if (!isObj(j)) return { ok: false, reason: 'schema' };
    if (j.v !== 1) return { ok: false, reason: 'version' };
    const c = j.core;
    if (!isNum(j.savedAt) || !isObj(c) || !isStr(j.area) || !isStr(j.spawn)) return { ok: false, reason: 'schema' };
    if (!isObj(c.flags) || !Array.isArray(c.items) || !Array.isArray(c.photos) || !Array.isArray(c.clues) || !Array.isArray(c.seen) || !isNum(c.emptySeq)) {
      return { ok: false, reason: 'schema' };
    }
    const repaired: string[] = [];

    // flags
    const flags: Record<string, boolean | number> = {};
    for (const [k, v] of Object.entries(c.flags)) {
      if (!isBool(v) && !isNum(v)) return { ok: false, reason: 'schema' };
      if (!FLAG_IDS.has(k)) {
        repaired.push(`丢弃未知 flag ${k}`);
        continue;
      }
      const id = k as FlagId;
      if (NUMERIC_FLAGS.has(id)) {
        const n = isNum(v) ? v : v ? 1 : 0;
        const clamped = Math.max(0, Math.min(NUMERIC_MAX, Math.round(n)));
        if (clamped !== v) repaired.push(`${k} 钳到 ${clamped}`);
        if (clamped > 0) flags[k] = clamped;
      } else {
        if (v === true) flags[k] = true;
        else if (v !== false) {
          // 布尔 flag 存成了数值：>0 视为真
          repaired.push(`${k} 改为布尔`);
          if (v > 0) flags[k] = true;
        }
      }
    }

    // items
    const items: ItemEntry[] = [];
    const seenItems = new Set<string>();
    for (const e of c.items) {
      if (!isObj(e) || !isStr(e.id) || !isBool(e.used) || !isNum(e.order)) return { ok: false, reason: 'schema' };
      if (!ITEM_IDS.has(e.id)) {
        repaired.push(`丢弃未知物品 ${e.id}`);
        continue;
      }
      if (seenItems.has(e.id)) {
        repaired.push(`丢弃重复物品 ${e.id}`);
        continue;
      }
      seenItems.add(e.id);
      items.push({ id: e.id as ItemId, used: e.used, order: e.order });
    }

    // photos
    const photos: PhotoRecord[] = [];
    const seenPhotos = new Set<string>();
    for (const p of c.photos) {
      if (!isObj(p) || !isStr(p.id) || !isStr(p.title) || !isBool(p.key) || !isBool(p.print) || !isNum(p.seq) || !isStr(p.area) || !isStr(p.context)) {
        return { ok: false, reason: 'schema' };
      }
      if (p.caption !== undefined && !isStr(p.caption)) return { ok: false, reason: 'schema' };
      if (p.thumb !== undefined && !isStr(p.thumb)) return { ok: false, reason: 'schema' };
      if (!KEY_PHOTO_IDS.has(p.id) && !isEmptyPhotoId(p.id)) {
        repaired.push(`丢弃未知照片 ${p.id}`);
        continue;
      }
      if (seenPhotos.has(p.id)) {
        repaired.push(`丢弃重复照片 ${p.id}`);
        continue;
      }
      seenPhotos.add(p.id);
      const lens: LensMode = p.lens === 'ir' ? 'ir' : 'normal';
      if (p.lens !== lens) repaired.push(`照片 ${p.id} 的镜头改为 normal`);
      const zoom = (ZOOM_STEPS as readonly unknown[]).includes(p.zoom) ? (p.zoom as ZoomLevel) : 1;
      if (p.zoom !== zoom) repaired.push(`照片 ${p.id} 的倍率改为 1`);
      const rec: PhotoRecord = {
        id: p.id as PhotoId, title: p.title, key: p.key, print: p.print, seq: p.seq,
        area: (AREA_IDS as readonly string[]).includes(p.area) || p.area === 'dev' ? (p.area as PhotoRecord['area']) : 'r1',
        lens, zoom,
        context: p.context as PhotoRecord['context'],
      };
      if (p.caption !== undefined) rec.caption = p.caption;
      if (p.thumb !== undefined) rec.thumb = p.thumb;
      photos.push(rec);
    }

    if (!c.clues.every(isStr) || !c.seen.every(isStr)) return { ok: false, reason: 'schema' };
    const clues = [...new Set(c.clues as string[])];
    const seen = [...new Set(c.seen as string[])];

    let emptySeq = Math.max(0, Math.floor(c.emptySeq));
    const maxNo = maxEmptyNo(photos);
    if (emptySeq < maxNo) {
      repaired.push(`emptySeq ${emptySeq} → ${maxNo}`);
      emptySeq = maxNo;
    }

    // 区域与出生点
    let area: AreaId;
    if ((AREA_IDS as readonly string[]).includes(j.area)) area = j.area as AreaId;
    else {
      repaired.push(`区域 ${j.area} 无效，改为 r1`);
      area = 'r1';
    }
    const spawns = this.spawnsOf(area);
    let spawn = j.spawn as SpawnId;
    if (!spawns.includes(spawn)) {
      const fallback = spawns[0] ?? SPAWN.R1_START;
      repaired.push(`出生点 ${j.spawn} 不属于 ${area}，改为 ${fallback}`);
      spawn = fallback;
    }

    const data: SaveDataV1 = { v: 1, savedAt: j.savedAt, core: { flags, items, photos, clues, seen, emptySeq }, area, spawn };
    return { ok: true, data, repaired };
  }

  /** 区域的出生点（按 AreaDef.spawns 的声明顺序；AreaManager 不可用时按 id 命名推断）。 */
  private spawnsOf(area: AreaId): SpawnId[] {
    const def = this.game.areas?.defs.get(area);
    if (def) return Object.keys(def.spawns) as SpawnId[];
    return (Object.values(SPAWN) as SpawnId[]).filter(s => spawnAreaGuess(s) === area);
  }
}
