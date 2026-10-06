// owner: R3
// R3 环境声（GDD §9.5）：车流远声、霓虹嘶嘶、纸扎店纸张沙沙、暗房流水；外加雨（R3 下雨，GDD §4.4）。
// 句柄顺序固定（ctx.ambienceHandles() 与 specs 同序）：霓虹熄灭（r3.saw_true_form）时 neon.set('on', 0)；
// 进了照相馆雨声、车流压低（logic.ts 的 update）。

import type { AmbienceSpec } from '../../audio/engine';
import { DARK, NEON_AT, SHOPS, SINK } from './layout';

export const AMB = { rain: 0, traffic: 1, neon: 2, paper: 3, water: 4 } as const;

export const AMBIENCE: readonly AmbienceSpec[] = [
  { preset: 'rain', gain: -14 },
  { preset: 'traffic', gain: -26 },
  { preset: 'neon_hiss', gain: -28, at: NEON_AT },
  { preset: 'paper_rustle', gain: -30, at: [(SHOPS.paper.x0 + SHOPS.paper.x1) / 2, 1.2, -0.4] },
  { preset: 'darkroom_water', gain: -24, at: [SINK[0], 1.0, (DARK.z0 + DARK.z1) / 2 - 1] },
];
