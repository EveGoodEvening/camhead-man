// owner: R2
// R2 的谜题定义（ARCH §6.17；GDD §5 P3、P4，提示照抄 text.ts）。P5 在 ../r2_502/puzzles.ts。

import type { PuzzleDef } from '../../game/hints';
import { F, NPC, OBJ, PH, PZ, RP } from '../../data/ids';
import type { InteractId } from '../../data/ids';
import { TEXT } from './text';
import { floorOf } from './layout';

const LAMPS: readonly InteractId[] = [OBJ.R2_LAMP_1F, OBJ.R2_LAMP_2F, OBJ.R2_LAMP_3F, OBJ.R2_LAMP_4F, OBJ.R2_LAMP_5F];

export const PUZZLES: readonly PuzzleDef[] = [
  {
    id: PZ.P03_VOICE_LAMPS, order: 3, area: 'r2',
    available: F.R1_MISSION_GIVEN,
    done: `${F.R2_WANG_FLOOR} >= 5`,
    hints: TEXT.hints.p3,
    // M4 第 2 轮：阶段 0 = 还没进三号楼、没见着王奶奶（在院子里按 H）→ 先说她在哪栋楼；阶段 1 = 进了楼 → 灯怎么亮（原 p3）
    stage: s => (s.area !== 'r2' && !s.flag(F.R2_WANG_MET) ? 0 : 1),
    stageHints: [TEXT.hints.p3Find, TEXT.hints.p3],
    // 空闲闪烁：还没见过面 → 王奶奶；三楼没装灯泡 → 灯座；否则她上面一层的灯（只在玩家所在楼层有角标）
    target: s => {
      if (!s.flag(F.R2_WANG_MET)) return floorOf(s) === 1 ? OBJ.R2_LAMP_1F : NPC.WANG;
      const next = Math.min(5, Math.max(1, s.num(F.R2_WANG_FLOOR)) + 1);
      if (next === 3 && !s.flag(F.R2_BULB_INSTALLED)) return OBJ.R2_LAMP_SOCKET_3F;
      return LAMPS[next - 1];
    },
  },
  {
    id: PZ.P04_DOOR_GODS, order: 4, area: 'r2',
    available: `${F.R2_WANG_FLOOR} >= 5 && ${F.R1_ABILITY_REPLAY}`,
    done: F.R2_MENSHEN_OPEN,
    hints: TEXT.hints.p4,
    target: s => (s.hasPhoto(PH.MENSHEN_2018) ? OBJ.R2_MENSHEN : RP.R2_DOOR),
  },
];
