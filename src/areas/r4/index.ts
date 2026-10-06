// owner: R4
// R4 人民路地下通道·鬼市（GDD §4.5、§4.6、§5 P9–P11、H 表旧照六、§8.6–8.7）。
// 原点在通道中心；通道 x∈[-20,20]，z∈[-3,3]，层高 3m。布局常量在 layout.ts，场景在 build/，玩法在 logic.ts。

import { defineArea } from '../../core/area';
import { EXIT, F, SPAWN } from '../../data/ids';
import { PALETTE } from '../../data/palette';
import { ambienceFor } from './audio';
import { DIALOGUES } from './dialogue';
import { R4L } from './layout';
import { CUTSCENES, buildR4, r4OnExit, r4OnFlag, r4Update } from './logic';
import { PHOTO_TARGETS } from './photo';
import { PUZZLES } from './puzzles';
import { REPLAY_POINTS, SEGMENTS } from './replay';
import { SHOTS } from './shots';
import { TEXT } from './text';

export default defineArea({
  id: 'r4',
  name: TEXT.areaName,
  spawns: {
    [SPAWN.R4_BOTTOM]: { pos: R4L.spawn, yaw: 90 },
  },
  exits: [
    // 楼梯口 (-18,0,-3)：触发体以 (-18,0,-2.6) 为中心（GDD §13.2）
    { id: EXIT.R4_TO_R1, to: SPAWN.R1_FROM_R4, box: { center: R4L.exitCenter, size: [1.5, 2.5, 1.5] } },
  ],
  // 开市前灯管频闪（r4），开市后偏绿、没有频闪（r4_market）；GDD §9.2
  post: s => (s.flag(F.R4_GHOST_MARKET_OPEN) ? 'r4_market' : 'r4'),
  // 环境贴图 tint 取本区主光色：开市前灯管 #CFF5E1，开市后灯笼（AGENTS.md look-dev）
  environment: s => (s.flag(F.R4_GHOST_MARKET_OPEN) ? { tint: PALETTE.LANTERN, intensity: 1.1 } : { tint: '#CFF5E1', intensity: 0.8 }),
  ambience: ambienceFor,
  dialogues: DIALOGUES,
  cutscenes: CUTSCENES,
  docs: TEXT.docs,
  puzzles: PUZZLES,
  photoTargets: PHOTO_TARGETS,
  replayPoints: REPLAY_POINTS,
  segments: SEGMENTS,
  shots: SHOTS,
  build: buildR4,
  update: r4Update,
  onFlag: r4OnFlag,
  onExit: r4OnExit,
});
