// owner: R3
// R3 的谜题定义（GDD §5 P6–P8，§3.12 提示规则；ARCH §6.17）。
// 空闲闪烁的目标不能泄题（GDD §10.2）：P6 永远闪陆师傅（不闪 73 号格），P7 不闪容器。

import { F, IT, NPC, OBJ, PZ } from '../../data/ids';
import type { PuzzleDef } from '../../game/hints';
import { TEXT } from './text';

export const PUZZLES: readonly PuzzleDef[] = [
  {
    id: PZ.P06_PICKUP_SLIP, order: 6, area: 'r3',
    available: `${F.R1_GATE_UNCHAINED} && ${F.R1_MISSION_GIVEN} && has(${IT.SLIP_0473})`,
    done: F.R3_GOT_ENVELOPE,
    hints: TEXT.hints.p6,
    // M4：分阶段提示——门开了以后 H 不再说“把单子给他看”（GDD §3.12、§5 P6）；
    // M4 第 2 轮：人还不在老街、门也没开时（P5 之后在 R1 按 H）先说照相馆在哪儿、怎么走（阶段 2）
    stage: s => (s.flag(F.R3_LU_DOOR_OPEN) ? 1 : s.area !== 'r3' ? 2 : 0),
    stageHints: TEXT.hints.p6Stages,
    target: () => NPC.LU,
  },
  {
    id: PZ.P07_DARKROOM, order: 7, area: 'r3',
    available: F.R3_GOT_ENVELOPE,
    done: F.R3_FILM_DEVELOPED,
    hints: TEXT.hints.p7,
    target: s => (!s.has(IT.FILM) ? OBJ.R3_TLR : s.flag(F.R3_FILM_HUNG) ? OBJ.R3_DRYING_LINE : OBJ.R3_DARKROOM_RULES),
  },
  {
    id: PZ.P08_TRUE_FORM, order: 8, area: 'r3',
    available: F.R3_FILM_DEVELOPED,
    done: F.R3_SAW_TRUE_FORM,
    hints: TEXT.hints.p8,
    target: s => (s.has(IT.SLIP_0474) ? OBJ.R3_STOOL : NPC.LU),
  },
];
