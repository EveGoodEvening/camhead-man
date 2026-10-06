// owner: R1-world
// R1-world 的谜题（ARCH §6.17）：P1 引路灯、P2 伙计的生日。三级提示照抄 GDD §5（text.ts）。
// 空闲闪烁的目标按进度现算（GDD §3.12）。

import type { PuzzleDef } from '../../game/hints';
import { F, NPC, OBJ, PZ, RP } from '../../data/ids';
import { HINTS } from './text';

export const PUZZLES: readonly PuzzleDef[] = [
  {
    id: PZ.P01_GUIDE_LAMP, order: 1, area: 'r1',
    available: 'true',
    done: F.R1_MISSION_GIVEN,
    hints: HINTS.p1,
    // M4：分阶段提示——卡在后面的步骤时，H 不再从“开关上的字”说起（GDD §3.12、§5 P1）
    stage: s => (!s.flag(F.R1_GATE_LAMP_ON) ? 0 : !s.flag(F.R1_MET_TUDI) ? 1 : !s.flag(F.R1_P1_DONE) ? 2 : 3),
    stageHints: HINTS.p1Stages,
    target: s => {
      if (!s.flag(F.R1_LOG_TAKEN)) return OBJ.R1_LOG;
      if (!s.flag(F.R1_GATE_LAMP_ON)) return OBJ.R1_SWITCH_BOX;
      // 门灯亮了、还没见着土地：闪槐树下的土地庙（常光下看得见的角标；土地本人只在取景器里有角标，常光下闪了也看不见，M4）
      if (!s.flag(F.R1_MET_TUDI)) return OBJ.R1_SHRINE;
      if (!s.flag(F.R1_P1_DONE)) return RP.R1_GATE;
      return NPC.TUDI;
    },
  },
  {
    id: PZ.P02_HUOJI_BIRTHDAY, order: 2, area: 'r1',
    available: F.R1_LOG_TAKEN,
    done: F.R1_GATE_UNCHAINED,
    hints: HINTS.p2,
    // M4 第 2 轮：分阶段提示——抽屉开了以后 H 讲院门，不再从“脑门上的字”说起（GDD §3.12）
    stage: s => (s.flag(F.R1_DRAWER_OPEN) ? 1 : 0),
    stageHints: HINTS.p2Stages,
    target: s => (s.flag(F.R1_DRAWER_OPEN) ? OBJ.R1_GATE : OBJ.R1_DRAWER),
  },
];
