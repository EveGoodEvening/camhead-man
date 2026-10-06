// owner: R4
// R4 的环境声（GDD §9.5）：3 秒指数衰减噪声脉冲的长混响（tunnel_reverb）、滴水、灯管 120Hz 嗡鸣随频闪断续；
// 开市后灯管的嗡鸣停了，换成鬼市的人声低语（whispers）、FM 铃铛（fm_bells）、二胡似的长音（erhu_drone）。
// 函数形式：'flag' 事件后引擎重算，开市时整组交叉淡换（ARCH §11.2）。

import type { AmbienceSpec } from '../../audio/engine';
import { F } from '../../data/ids';
import type { StateView } from '../../game/state';
import { R4L } from './layout';

const BASE: readonly AmbienceSpec[] = [
  { preset: 'tunnel_reverb', gain: -16, params: { wet: 0.45 } },
  // 雨水顺着楼梯往下滴
  { preset: 'drips', gain: -20, at: [R4L.exitCenter[0], 1.0, -4.0] },
];

const BEFORE: readonly AmbienceSpec[] = [...BASE, { preset: 'tube_hum', gain: -26, params: { on: 1 } }];
/** 开市前那组里灯管嗡鸣的下标（logic 让它跟着频闪断续：ctx.ambienceHandles()[HUM_INDEX].set('on', …)）。 */
export const HUM_INDEX = BEFORE.length - 1;

const MARKET: readonly AmbienceSpec[] = [
  ...BASE,
  { preset: 'whispers', gain: -22, params: { density: 0.8 } },
  { preset: 'fm_bells', gain: -22, params: { rate: 0.8 } },
  { preset: 'erhu_drone', gain: -30, params: { level: 0.8 } },
];

export function ambienceFor(s: StateView): readonly AmbienceSpec[] {
  return s.flag(F.R4_GHOST_MARKET_OPEN) ? MARKET : BEFORE;
}
