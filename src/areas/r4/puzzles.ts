// owner: R4
// R4 的谜题定义（ARCH §6.17；GDD §5 P9–P11 的前置、完成条件与三级提示）。

import type { PuzzleDef } from '../../game/hints';
import { F, NPC, OBJ, PZ, RP } from '../../data/ids';
import { TEXT } from './text';

export const PUZZLES: readonly PuzzleDef[] = [
  {
    // P9 鬼市：丑时（r2.wang_done && r3.saw_true_form），持有买路钱；揭下面具即完成
    id: PZ.P09_GHOST_MARKET, order: 9, area: 'r4',
    available: 'r2.wang_done && r3.saw_true_form && has(it.money)',
    done: F.R4_FOUND_HUANG,
    hints: TEXT.hints.p9,
    // 空闲闪烁（M4）：开市前闪门童；开市后、还没看出面具在喘气时绝不能闪 S3（十个纸人里只有它冒角标 = 泄题，GDD §3.12、§10.2），
    // 改闪规矩牌（“三不收活物”）；读到 rd.huang_breath（r4.spotted_huang）之后玩家已经知道是他，再闪黄三爷
    target: s => (!s.flag(F.R4_GHOST_MARKET_OPEN) ? NPC.BOY : s.flag(F.R4_SPOTTED_HUANG) ? NPC.HUANG : OBJ.R4_RULES_BOARD),
  },
  {
    // P10 樟木箱：前置 r4.found_huang、r1.ability_replay；黄三爷认账即完成
    id: PZ.P10_CAMPHOR_CHEST, order: 10, area: 'r4',
    available: 'r4.found_huang && r1.ability_replay',
    done: F.R4_HUANG_ADMITS,
    hints: TEXT.hints.p10,
    target: s => (s.hasPhoto('ph.huang_hides') ? NPC.HUANG : RP.R4_STALL),
  },
  {
    // P11 讨封：前置 r4.huang_admits、r2.ability_ir；拿到录像带即完成
    id: PZ.P11_SEEK_TITLE, order: 11, area: 'r4',
    available: 'r4.huang_admits && r2.ability_ir',
    done: F.R4_GOT_TAPE,
    hints: TEXT.hints.p11,
    target: () => NPC.HUANG,
  },
];
