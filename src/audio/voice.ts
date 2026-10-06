// owner: WP3
// 对话底子的含糊人声（ARCH §6.13、§9）：按 data/speakers.ts 的 VoiceKind 合成；门神/灶君用低频共振峰嗡声；pc.huoji 不出声。WP3 内部。
//
// 做法：声门源（锯齿波 + 轻微音高抖动）→ 三个带通共振峰，共振峰中心在几个元音目标之间按音节跳动 → 音节包络 → 低通（听不清字，只有语气）。
// 'god'：更低的基频（60–75Hz）、更窄更低的共振峰、慢速起伏，加一层褐噪声，像隔着纸的嗡声。

import type { VoiceKind } from '../data/speakers';
import type { AudioRuntime } from './engine';

const rand = (lo: number, hi: number): number => lo + (hi - lo) * Math.random();

interface VoiceSpec { f0: number; formantScale: number; syllable: [number, number]; lp: number; level: number; breath: number }

const VOICES: Record<Exclude<VoiceKind, 'none'>, VoiceSpec> = {
  old_man: { f0: 108, formantScale: 0.92, syllable: [0.13, 0.26], lp: 2400, level: 0.2, breath: 0.25 },
  old_woman: { f0: 205, formantScale: 1.08, syllable: [0.11, 0.22], lp: 2800, level: 0.18, breath: 0.3 },
  man: { f0: 118, formantScale: 1.0, syllable: [0.1, 0.2], lp: 2600, level: 0.2, breath: 0.15 },
  child: { f0: 290, formantScale: 1.25, syllable: [0.09, 0.17], lp: 3400, level: 0.16, breath: 0.1 },
  god: { f0: 68, formantScale: 0.6, syllable: [0.22, 0.45], lp: 900, level: 0.26, breath: 0 },
};

// 几个元音的前三共振峰（Hz，成年男性），按 formantScale 缩放
const VOWELS: readonly [number, number, number][] = [
  [730, 1090, 2440], // a
  [530, 1840, 2480], // e
  [270, 2290, 3010], // i
  [570, 840, 2410], // o
  [300, 870, 2240], // u
];

export function playMurmur(rt: AudioRuntime, voice: VoiceKind, durSec: number, out: AudioNode): void {
  if (voice === 'none' || durSec <= 0) return;
  const v = VOICES[voice];
  const ac = rt.ctx;
  const t0 = ac.currentTime + 0.02;
  const end = t0 + durSec;

  const src = ac.createOscillator();
  src.type = 'sawtooth';
  src.frequency.value = v.f0;
  // 音高抖动（jitter）与句调：整句慢慢往下走
  const jit = ac.createOscillator();
  jit.frequency.value = voice === 'god' ? 0.7 : 6.3;
  const jg = ac.createGain();
  jg.gain.value = v.f0 * 0.02;
  jit.connect(jg).connect(src.frequency);
  src.frequency.setValueAtTime(v.f0 * 1.06, t0);
  src.frequency.linearRampToValueAtTime(v.f0 * 0.9, end);

  const sum = ac.createGain();
  const filters: BiquadFilterNode[] = [];
  const q = voice === 'god' ? [6, 9, 12] : [7, 10, 12];
  for (let k = 0; k < 3; k++) {
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q[k]!;
    const g = ac.createGain();
    g.gain.value = [1.8, 1.1, 0.5][k]!;
    src.connect(bp).connect(g).connect(sum);
    filters.push(bp);
  }
  // 气声：粉噪声也过共振峰（老人、女声更多）
  let breath: AudioBufferSourceNode | null = null;
  if (v.breath > 0) {
    breath = rt.kit.noise('pink');
    const bg = ac.createGain();
    bg.gain.value = v.breath;
    breath.connect(bg);
    for (const f of filters) bg.connect(f);
  }
  const env = ac.createGain();
  env.gain.value = 0;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = v.lp;
  const lvl = ac.createGain();
  lvl.gain.value = v.level;
  sum.connect(env).connect(lp).connect(lvl).connect(out);

  // 音节：每个音节跳到一个元音，包络起落；偶尔一个停顿（逗号）
  let t = t0;
  while (t < end - 0.05) {
    const syl = rand(v.syllable[0], v.syllable[1]);
    const pause = Math.random() < 0.12;
    if (!pause) {
      const vw = VOWELS[Math.floor(Math.random() * VOWELS.length)]!;
      filters.forEach((f, k) => f.frequency.setTargetAtTime(vw[k]! * v.formantScale, t, 0.025));
      const peak = rand(0.6, 1);
      env.gain.setTargetAtTime(peak, t, 0.02);
      env.gain.setTargetAtTime(peak * 0.25, t + syl * 0.7, 0.03);
    } else {
      env.gain.setTargetAtTime(0, t, 0.03);
    }
    t += pause ? syl * 1.6 : syl;
  }
  env.gain.setTargetAtTime(0, end - 0.05, 0.04);

  if (voice === 'god') {
    // 门神/灶君：再垫一层褐噪声的低嗡
    const rumble = rt.kit.noise('brown');
    const rl = ac.createBiquadFilter();
    rl.type = 'lowpass';
    rl.frequency.value = 180;
    const rg = ac.createGain();
    rg.gain.setValueAtTime(0, t0);
    rg.gain.linearRampToValueAtTime(0.25, t0 + 0.2);
    rg.gain.setValueAtTime(0.25, end - 0.2);
    rg.gain.linearRampToValueAtTime(0, end);
    rumble.connect(rl).connect(rg).connect(out);
    rumble.start(t0);
    rumble.stop(end + 0.1);
  }

  src.start(t0);
  jit.start(t0);
  breath?.start(t0);
  const stopAt = end + 0.3;
  src.stop(stopAt);
  jit.stop(stopAt);
  breath?.stop(stopAt);
}
