// owner: integrator
// （M1a 写好并冻结；M2 期间归引擎维护者，区域代理只读）
// R1 槐安里 = base（出生点/出入口/后期）+ R1-world（world.ts）+ R1-finale（finale/index.ts）。只有本文件同时 import 二者（ARCH §2.11）。

import { defineArea, mergeAreaParts } from '../../core/area';
import type { ExitDef } from '../../core/area';
import type { V3 } from '../../core/types';
import { EXIT, F, SPAWN } from '../../data/ids';
import { R1 } from './layout';
import world from './world';
import finale from './finale';

/** 出入口触发体：以地面点为中心、1.5m 见方、高 2.5m（GDD §13.2）。 */
const trigger = (p: V3): NonNullable<ExitDef['box']> => ({ center: [p[0], p[1] + 1.25, p[2]], size: [1.5, 2.5, 1.5] });

/** 院门没开时从东口/西口出去的反馈（GDD P2“没有钥匙时交互院门”）。 */
const GATE_LOCKED = '铁链上挂着把大锁。钥匙……老周说在抽屉里。';

export default defineArea(mergeAreaParts({
  id: 'r1',
  name: '槐安里',
  spawns: {
    [SPAWN.R1_START]: { pos: R1.spawns.start, yaw: 180 },
    [SPAWN.R1_FROM_R2]: { pos: R1.spawns.fromR2, yaw: 180 },
    [SPAWN.R1_FROM_R3]: { pos: R1.spawns.fromR3, yaw: 270 },
    [SPAWN.R1_FROM_R4]: { pos: R1.spawns.fromR4, yaw: 90 },
  },
  exits: [
    { id: EXIT.R1_TO_R2, to: SPAWN.R2_LOBBY, box: trigger(R1.exits.toR2) },
    { id: EXIT.R1_TO_R3, to: SPAWN.R3_WEST, box: trigger(R1.exits.toR3), when: F.R1_GATE_UNCHAINED, blocked: GATE_LOCKED },
    { id: EXIT.R1_TO_R4, to: SPAWN.R4_BOTTOM, box: trigger(R1.exits.toR4), when: F.R1_GATE_UNCHAINED, blocked: GATE_LOCKED },
  ],
  post: s => (s.flag(F.R1_SOUL_RETURNED) ? 'r1_mao' : s.flag(F.R4_GOT_TAPE) ? 'r1_yin' : 'r1'),
}, [world, finale]));
