// owner: R1-world
// R1 环境声（GDD §9.5）：雨（寅时停）、檐沟滴水、两盏钠灯的嗡声（-36dB）、门卫室里的 50Hz 电源嗡声与 CRT 高频啸叫、天亮以后远处鸡鸣。
// 函数形式：按 flags 现算，引擎按内容比较，flag 没改到这里就不重启（ARCH §9、§11.2）。

import type { AmbienceSpec } from '../../audio/engine';
import type { StateView } from '../../game/state';
import { F } from '../../data/ids';
import { R1 } from './layout';

const SODIUM_HEAD_Y = 5.55;

/** R1-finale 在 cs.r1.dawn 的最后四分之一写的区域临时状态：远处的鸡鸣从这时淡进来（两边各写一份字面量） */
const TEMP_ROOSTER = 'fin_rooster';

export function r1Ambience(s: StateView): readonly AmbienceSpec[] {
  const mao = s.flag(F.R1_SOUL_RETURNED);
  const yin = s.flag(F.R4_GOT_TAPE);
  const out: AmbienceSpec[] = [];
  // 寅时雨停（GDD §4.1、§4.6）；地上还湿，檐沟还在滴
  if (!yin && !mao) out.push({ preset: 'rain', gain: -8 });
  out.push({ preset: 'drips', gain: yin || mao ? -20 : -26 });
  out.push({ preset: 'sodium_hum', gain: -36, at: [R1.sodium1[0] + 1.25, SODIUM_HEAD_Y, R1.sodium1[2]] });
  out.push({ preset: 'sodium_hum', gain: -36, at: [R1.sodium2[0] - 1.25, SODIUM_HEAD_Y, R1.sodium2[2]] });
  out.push({ preset: 'mains_hum', gain: -30, at: [-6.5, 1.6, 20.2] });
  out.push({ preset: 'crt_whine', gain: -40, at: R1.derived.crtScreen.center });
  // 鸡鸣等东边发白（M4：r1.soul_returned 在合影成功时就写了，那时还是 04:57 的夜景，老周还说“我眯一会儿”）
  if (s.flag(F.R1_CALLED_AT_DAWN) || s.temp(TEMP_ROOSTER) === true) out.push({ preset: 'rooster', gain: -18 });
  return out;
}
