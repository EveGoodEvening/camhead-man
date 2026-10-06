// owner: integrator
// （M1a 写全量并冻结；此后只有整合代理/引擎维护者能改，ARCH §2.12）
// 称呼表（GDD §3.11）。已收录的称呼只由 flags 推导。

import { F, NAME } from './ids';
import type { FlagId, NameId } from './ids';

export interface NameMeta {
  /** 显示文字 */
  text: string;
  /** 收录时机：该 flag 为真即收录 */
  flag: FlagId;
  /** 巡夜本“称呼”栏的来源说明 */
  source: string;
  /** 称呼面板与巡夜本中的排序（1 起） */
  order: number;
}

export const NAMES: Readonly<Record<NameId, NameMeta>> = {
  [NAME.HUOJI]: { text: '伙计', flag: F.R1_LOG_TAKEN, source: '巡夜本夹页“就叫它伙计”，新页①“伙计，门口的灯灭了”', order: 1 },
  [NAME.KANMENDE]: { text: '看门的', flag: F.R1_MET_TUDI, source: '土地：“看门的，站那么远干啥？”', order: 2 },
  [NAME.ZHOU_SHOUREN]: { text: '周守仁', flag: F.R1_DRAWER_OPEN, source: '工作证、取件单上的姓名', order: 3 },
  [NAME.XIAOZHOU]: { text: '小周', flag: F.R2_WANG_MET, source: '王奶奶：“是小周吧？”', order: 4 },
  [NAME.TONGHANG]: { text: '同行', flag: F.R2_MENSHEN_OPEN, source: '尉迟恭：“同行不为难同行。”', order: 5 },
  [NAME.LAOZHOU]: { text: '老周', flag: F.R2_WANG_DONE, source: '王奶奶：“那给老周带去……”', order: 6 },
};

/** 全部称呼，按 order 排序。 */
export const NAME_ORDER: readonly NameId[] = (Object.keys(NAMES) as NameId[]).sort((a, b) => NAMES[a].order - NAMES[b].order);

/** 由 flags 推导已收录的称呼（按 order 排序）。GameState.names() 用它。 */
export function namesFromFlags(flag: (id: FlagId) => boolean): NameId[] {
  return NAME_ORDER.filter(id => flag(NAMES[id].flag));
}
