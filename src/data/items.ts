// owner: integrator
// （M1a 写全量并冻结；此后只有整合代理/引擎维护者能改，ARCH §2.12）
// 物品元数据（GDD §7.1）。所有物品都不消耗，使用后只标“已用”。

import { DOC, IT } from './ids';
import type { DocId, ItemId } from './ids';

export interface ItemMeta {
  /** 物品栏显示名 */
  name: string;
  /** 物品栏说明（玩家可见，只写肉眼可知的信息，不泄题） */
  desc: string;
  /** 点开时打开的随身文档（readDoc 与“文档类物品”判定用，ARCH §6.16） */
  doc?: DocId;
  /** 同样随身携带、但点开时不直接打开的其他文档（it.log 的新页） */
  extraDocs?: readonly DocId[];
  /** 点开 = 打开巡夜本（J），而不是文档阅读器 */
  opensJournal?: boolean;
  /** 已用后的显示名（it.film → “底片（已冲）”） */
  usedName?: string;
  /** 已用后的附注 */
  usedNote?: string;
  /** 物品栏排序 */
  order: number;
}

export const ITEMS: Readonly<Record<ItemId, ItemMeta>> = {
  [IT.LOG]: { name: '巡夜本', desc: '第十九本。', doc: DOC.LOG_OLD, extraDocs: [DOC.LOG_NEW], opensJournal: true, order: 1 },
  [IT.KEYS]: { name: '钥匙串', desc: '老周抽屉里的。', order: 2 },
  [IT.BULB]: { name: '灯泡', desc: '附纸条“三楼”。', order: 3 },
  [IT.SLIP_0473]: { name: '取件单', desc: '泡过水，肉眼看是 No.04▯3。', doc: DOC.SLIP_0473, order: 4 },
  [IT.IDCARD]: { name: '工作证', desc: '照片栏用圆珠笔写着“待补”。', doc: DOC.IDCARD, order: 5 },
  [IT.LETTER]: { name: '建国的信', desc: '王奶奶家灶台瓷砖后头的铁盒里。', doc: DOC.LETTER_JIANGUO, order: 6 },
  [IT.TRAIN_TICKET]: { name: '高铁票根', desc: '2025-10-02，深圳北。', doc: DOC.TRAIN_TICKET, order: 7 },
  [IT.GLASSES]: { name: '老花镜', desc: '一副老花镜。', order: 8 },
  [IT.WONTON]: { name: '一碗馄饨', desc: '王婶留的。', order: 9 },
  [IT.MONEY]: { name: '一串买路钱', desc: '王奶奶给的。', order: 10 },
  [IT.FILM]: { name: '未冲胶卷', desc: '双反相机里的胶卷。', doc: DOC.TLR_TAPE, usedName: '底片（已冲）', order: 11 },
  [IT.SLIP_0474]: { name: '取件单 No.0474', desc: '空白。', doc: DOC.SLIP_0474, usedNote: '姓名栏写着“伙计”。', order: 12 },
  [IT.PORTRAIT]: { name: '未完成的遗像', desc: '陆师傅画的，脸还空着。', usedNote: '摆在桌上。', order: 13 },
  [IT.TAPE_830]: { name: '录像带“8.30”', desc: '写着 8.30，黄三爷樟木箱里的。', usedNote: '在机器里。', order: 14 },
};

/** 该物品携带的全部随身文档（doc + extraDocs）。 */
export function itemDocs(id: ItemId): readonly DocId[] {
  const m = ITEMS[id];
  return [...(m.doc ? [m.doc] : []), ...(m.extraDocs ?? [])];
}

/** 哪个物品携带这份文档（不是随身文档则 undefined；readDoc 的“属于身上的物品”判定）。 */
export function docOwnerItem(doc: DocId): ItemId | undefined {
  for (const id of Object.keys(ITEMS) as ItemId[]) if (itemDocs(id).includes(doc)) return id;
  return undefined;
}

/** 物品当前显示名（已用且有 usedName 时换名）。 */
export function itemDisplayName(id: ItemId, used: boolean): string {
  const m = ITEMS[id];
  return used && m.usedName ? m.usedName : m.name;
}
