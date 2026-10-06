// owner: R1-finale
// P12、P13、P14 与隐藏的“南柯”（GDD §5、§3.12；ARCH §6.17）。
// P12 的“完成”按 GDD P12 的解法写到第 5 步（门口倒带，r1.heard_voice）并要求拿到 ph.tape_face：
// 否则看完带子却没拍脸的玩家，P13（要 ph.tape_face）还不可用、P12 又算完成，H 键就只剩土地的闲话。

import type { PuzzleDef } from '../../../game/hints';
import { F, IT, OBJ, PH, PZ, RP } from '../../../data/ids';
import { NANKE, P12, P13, P14 } from './text';

export const PUZZLES: readonly PuzzleDef[] = [
  {
    id: PZ.P12_THAT_NIGHT, order: 12, area: 'r1',
    available: F.R4_GOT_TAPE,
    done: `${F.R1_HEARD_VOICE} && photo(${PH.TAPE_FACE})`,
    hints: P12.hints,
    // M4：分阶段提示（拍脸与看到三点十六分的先后不限；没拍到脸就一直是阶段 1）
    stage: s => (!s.flag(F.R1_TAPE_IN_VCR) ? 0 : !s.hasPhoto(PH.TAPE_FACE) ? 1 : !s.flag(F.R1_TAPE_WATCHED) ? 2 : 3),
    stageHints: P12.stageHints,
    target: s => (s.flag(F.R1_TAPE_WATCHED) && s.hasPhoto(PH.TAPE_FACE) ? RP.R1_BOOTH : OBJ.R1_VCR),
  },
  {
    id: PZ.P13_SEE_HIM, order: 13, area: 'r1',
    available: `${F.R1_HEARD_VOICE} && has(${IT.PORTRAIT}) && photo(${PH.TAPE_FACE})`,
    done: F.R1_ZHOU_VISIBLE,
    hints: P13.hints,
    stage: s => (!s.flag(F.R1_PORTRAIT_PLACED) ? 0 : !s.flag(F.R1_PORTRAIT_COMPLETE) ? 1 : 2),
    stageHints: P13.stageHints,
    target: s => (!s.flag(F.R1_PORTRAIT_COMPLETE) ? OBJ.R1_DESK : OBJ.R1_CRT_JACK),
  },
  {
    id: PZ.P14_WAKE_ME, order: 14, area: 'r1',
    available: `${F.R1_ZHOU_VISIBLE} && has(${IT.WONTON})`,
    done: F.R1_CALLED_AT_DAWN,
    hints: P14.hints,
    stage: s => (!s.flag(F.R1_ZHOU_FED) ? 0 : !s.flag(F.R1_SOUL_RETURNED) ? 1 : 2),
    stageHints: P14.stageHints,
    target: s => (!s.flag(F.R1_ZHOU_FED) ? OBJ.R1_DESK : OBJ.R1_BRACKET),
  },
  {
    id: PZ.H_NANKE, order: 15, area: 'r1',
    available: F.R1_ABILITY_REPLAY,
    done: F.R1_NANKE,
    hints: NANKE.hints,
    appendTo: { puzzle: PZ.P14_WAKE_ME, when: 'ants >= 1 && ants < 6' },
    target: () => OBJ.R1_ANTHILL,
  },
];
