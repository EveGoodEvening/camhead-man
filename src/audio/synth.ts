// owner: WP3
// SynthKit 合成原语（ARCH §9）。
// 所有节点都“新建不启动”（osc/noise 由调用者 start）除了 lfo/fmBell/formantNoise：它们自带生命周期，见各自注释。
// 声音时间用 AudioContext 的时钟——声音本身不是玩法计时（ARCH §1.4 只约束玩法）。

export interface SynthKit {
  ctx: AudioContext;
  /** 循环噪声缓冲（共享） */
  noise(type: 'white' | 'pink' | 'brown', seconds?: number): AudioBufferSourceNode;
  osc(type: OscillatorType, freq: number): OscillatorNode;
  filter(type: BiquadFilterType, freq: number, q?: number): BiquadFilterNode;
  gain(v: number): GainNode;
  env(param: AudioParam, a: number, d: number, s: number, r: number, peak?: number, at?: number): void;
  lfo(target: AudioParam, rate: number, depth: number): OscillatorNode;
  /** 程序生成脉冲响应（R4 长混响） */
  impulse(seconds: number, decay: number): AudioBuffer;
  fmBell(freq: number, ratio: number, dur: number, out: AudioNode): void;
  /** 低语、门神嗡声 */
  formantNoise(formants: number[], out: AudioNode): AudioNode;
}

/** formantNoise 返回的节点 → 它背后的噪声源（stopSources 用）。 */
const owned = new WeakMap<AudioNode, AudioScheduledSourceNode[]>();

/** 停掉 formantNoise 等返回节点背后的声源（when 为 ctx 时间；WP3 内部）。 */
export function stopSources(node: AudioNode, when: number): void {
  for (const s of owned.get(node) ?? []) {
    try {
      s.stop(when);
    } catch {
      // 已经 stop 过的声源再 stop 会抛 InvalidStateError，忽略
    }
  }
  owned.delete(node);
}

/** 登记 node 背后的声源（WP3 内部：ambience/voice 自建的复合节点也用它统一收尾）。 */
export function ownSources(node: AudioNode, sources: AudioScheduledSourceNode[]): void {
  const list = owned.get(node) ?? [];
  list.push(...sources);
  owned.set(node, list);
}

/** 线性增益 ↔ dB。 */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** MIDI 音高 → 频率（A4 = 69 = 440Hz）。 */
export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function fillNoise(type: 'white' | 'pink' | 'brown', data: Float32Array, rand: () => number): void {
  if (type === 'white') {
    for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
    return;
  }
  if (type === 'brown') {
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = (last + 0.02 * (rand() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    return;
  }
  // pink：Paul Kellet 的经济版滤波
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
}

/** 纯函数的 xorshift，噪声缓冲可复现（与画面无关，只图稳定）。 */
function xorshift(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** 为一个已解锁的 AudioContext 创建 SynthKit（WP3 内部；AudioEngine.unlock 后调用）。 */
export function createSynthKit(ctx: AudioContext): SynthKit {
  const buffers = new Map<string, AudioBuffer>();
  const noiseBuffer = (type: 'white' | 'pink' | 'brown', seconds: number): AudioBuffer => {
    const key = `${type}:${seconds}`;
    const hit = buffers.get(key);
    if (hit) return hit;
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    fillNoise(type, buf.getChannelData(0), xorshift(0x9e3779b9 ^ len ^ type.length));
    buffers.set(key, buf);
    return buf;
  };

  const kit: SynthKit = {
    ctx,
    noise(type, seconds = 4) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(type, seconds);
      src.loop = true;
      return src;
    },
    osc(type, freq) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      return o;
    },
    filter(type, freq, q = 0.707) {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    },
    gain(v) {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    },
    /**
     * 单次包络：0 →(a) peak →(d) peak·s →(r) 0，从 at 开始；总长 a + d + r。
     * 衰减段用指数（听感自然），目标不能为 0，所以落到 1e-4 再线性归零。
     */
    env(param, a, d, s, r, peak = 1, at = ctx.currentTime) {
      const t0 = Math.max(at, ctx.currentTime);
      const sus = Math.max(1e-4, peak * s);
      param.cancelScheduledValues(t0);
      param.setValueAtTime(0, t0);
      param.linearRampToValueAtTime(peak, t0 + Math.max(0.001, a));
      param.exponentialRampToValueAtTime(sus, t0 + Math.max(0.001, a) + Math.max(0.001, d));
      param.exponentialRampToValueAtTime(1e-4, t0 + Math.max(0.001, a) + Math.max(0.001, d) + Math.max(0.001, r));
      param.linearRampToValueAtTime(0, t0 + a + d + r + 0.01);
    },
    /** 正弦 LFO：立即 start，输出乘 depth 加到 target 上；返回振荡器（调用者负责 stop）。 */
    lfo(target, rate, depth) {
      const o = ctx.createOscillator();
      o.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(target);
      o.start();
      return o;
    },
    impulse(seconds, decay) {
      const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        const r = xorshift(0x51ed270b + ch * 7919);
        for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      return buf;
    },
    /** FM 钟：载波 freq、调制 freq·ratio，调制指数随时间衰减（钟声的“金属感”先亮后暗）；自动 start/stop。 */
    fmBell(freq, ratio, dur, out) {
      const t = ctx.currentTime;
      const car = ctx.createOscillator();
      car.frequency.value = freq;
      const mod = ctx.createOscillator();
      mod.frequency.value = freq * ratio;
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(freq * 2.2, t);
      modGain.gain.exponentialRampToValueAtTime(freq * 0.05, t + dur);
      mod.connect(modGain).connect(car.frequency);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.5, t + 0.004);
      amp.gain.exponentialRampToValueAtTime(1e-4, t + dur);
      car.connect(amp).connect(out);
      car.start(t);
      mod.start(t);
      car.stop(t + dur + 0.05);
      mod.stop(t + dur + 0.05);
    },
    /** 共振峰噪声：粉噪声 → 并联带通（各共振峰）→ 求和；立即 start，用 stopSources(返回值, when) 停。 */
    formantNoise(formants, out) {
      const src = kit.noise('pink', 3);
      const sum = ctx.createGain();
      sum.gain.value = 1;
      formants.forEach((f, i) => {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f;
        bp.Q.value = 9;
        const g = ctx.createGain();
        g.gain.value = 1.6 / (1 + i * 0.6);
        src.connect(bp).connect(g).connect(sum);
      });
      sum.connect(out);
      src.start();
      ownSources(sum, [src]);
      return sum;
    },
  };
  return kit;
}
