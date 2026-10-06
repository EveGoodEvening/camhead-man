// owner: WP3
// 环境声预设（ARCH §9；GDD §9.5 各区域环境声）。WP3 内部：AudioEngine.setAmbience 调用。
//
// 每个预设 = 若干持续声源（噪声/振荡器 → 滤波 → 增益）+ 若干稀疏事件（前瞻调度器按 AudioContext 时钟排程）。
// 通用参数：'level'（预设总增益，线性，默认 1）；'gain' 由 AudioEngine 的句柄代理处理（乘在 spec.gain 的 dB 上）。
// 各预设自己的参数（set(param, v, rampSec)）：
//   rain.intensity 0..1（寅时雨停：set('intensity', 0, 6)）· sodium_hum/mains_hum/crt_whine/neon_hiss/tube_hum.on 0/1
//   crt_whine.boot（>0 放一次 CRT 开机声；on 从 0 到 1 也会放）
//   tv_murmur.level · traffic.level · tunnel_reverb.wet 0..1 · whispers.density 0..1 · fm_bells.rate（倍率）· erhu_drone.level
// 启动时 spec.params 里的同名参数就是初值。未知参数 dev 下警告并忽略。

import type { AmbPreset, AmbienceHandle, AudioRuntime } from './engine';
import { dbToGain } from './synth';
import { devWarn } from '../core/log';

const rand = (lo: number, hi: number): number => lo + (hi - lo) * Math.random();
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function rampTo(p: AudioParam, v: number, sec: number, ctx: BaseAudioContext): void {
  const t = ctx.currentTime;
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  if (sec <= 0) p.setValueAtTime(v, t);
  else p.linearRampToValueAtTime(v, t + sec);
}

/** 一个运行中的预设：收集声源与调度任务，统一停。 */
class Amb implements AmbienceHandle {
  readonly g: GainNode;
  readonly ctx: AudioContext;
  private readonly srcs: AudioScheduledSourceNode[] = [];
  private readonly cancels: (() => void)[] = [];
  private readonly handlers = new Map<string, (v: number, ramp: number) => void>();
  private stopped = false;

  constructor(readonly rt: AudioRuntime, out: AudioNode, readonly name: string) {
    this.ctx = rt.ctx;
    this.g = rt.kit.gain(1);
    this.g.connect(out);
    this.param('level', (v, r) => rampTo(this.g.gain, Math.max(0, v), r, this.ctx));
  }
  /** 启动并登记一个持续声源 */
  src<T extends AudioScheduledSourceNode>(s: T): T {
    s.start();
    this.srcs.push(s);
    return s;
  }
  /** 登记一个已启动的声源（lfo 这类自己 start 的） */
  own(s: AudioScheduledSourceNode): void {
    this.srcs.push(s);
  }
  /** 随机间隔的稀疏事件：间隔在 [minGap, maxGap] 秒（再除以 density()） */
  every(minGap: number, maxGap: number, fire: (t: number) => void, density: () => number = () => 1, firstDelay = rand(0.05, maxGap)): void {
    let next = this.ctx.currentTime + firstDelay;
    this.cancels.push(this.rt.schedule(until => {
      if (this.stopped) return false;
      // 挂起很久后恢复（页面隐藏）：不补发过去的事件
      if (next < this.ctx.currentTime - 0.5) next = this.ctx.currentTime;
      while (next <= until) {
        fire(Math.max(next, this.ctx.currentTime));
        next += rand(minGap, maxGap) / Math.max(0.05, density());
      }
      return true;
    }));
  }
  param(name: string, fn: (v: number, ramp: number) => void): void {
    this.handlers.set(name, fn);
  }
  set(param: string, v: number, rampSec?: number): void {
    if (this.stopped) return;
    const h = this.handlers.get(param);
    if (!h) {
      devWarn(`ambience '${this.name}' 没有参数 '${param}'`);
      return;
    }
    h(v, Math.max(0, rampSec ?? 0));
  }
  stop(fadeSec = 1): void {
    if (this.stopped) return;
    this.stopped = true;
    const f = Math.max(0.02, fadeSec);
    rampTo(this.g.gain, 0, f, this.ctx);
    const end = this.ctx.currentTime + f + 0.05;
    for (const s of this.srcs) {
      try {
        s.stop(end);
      } catch {
        // 已停
      }
    }
    for (const c of this.cancels) c();
    this.onStop?.(f);
  }
  onStop: ((fade: number) => void) | null = null;
}

// ---------------------------------------------------------------- 常用的小声音

/** 正弦“滴”：从 f0 滑到 f1，指数衰减。 */
function blip(ctx: AudioContext, dest: AudioNode, t: number, f0: number, f1: number, dur: number, peak: number, pan = 0): void {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.002);
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
  let tail: AudioNode = g;
  if (pan !== 0) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    tail = p;
  }
  tail.connect(dest);
  o.connect(g);
  o.start(t);
  o.stop(t + dur + 0.03);
}

/** 噪声爆发：从共享噪声缓冲的随机位置截一小段，经高通/带通。 */
function burst(rt: AudioRuntime, dest: AudioNode, t: number, dur: number, peak: number, o?: { hp?: number; bp?: number; q?: number; pan?: number; type?: 'white' | 'pink' | 'brown' }): void {
  const ctx = rt.ctx;
  const n = rt.kit.noise(o?.type ?? 'white', 4);
  n.loop = false;
  let node: AudioNode = n;
  if (o?.hp) {
    const f = rt.kit.filter('highpass', o.hp);
    node.connect(f);
    node = f;
  }
  if (o?.bp) {
    const f = rt.kit.filter('bandpass', o.bp, o.q ?? 1);
    node.connect(f);
    node = f;
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.min(0.004, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
  node.connect(g);
  let tail: AudioNode = g;
  if (o?.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    g.connect(p);
    tail = p;
  }
  tail.connect(dest);
  n.start(t, rand(0, 3.5));
  n.stop(t + dur + 0.02);
}

/** 水滴落进水里的“嘟”：短正弦下滑 + 一点噪声。 */
function plop(rt: AudioRuntime, dest: AudioNode, t: number, pitch: number, peak: number, pan: number): void {
  blip(rt.ctx, dest, t, pitch * 1.6, pitch * 0.7, 0.09, peak, pan);
  burst(rt, dest, t, 0.012, peak * 0.3, { hp: 3000, pan });
}

// ---------------------------------------------------------------- 预设

type Builder = (a: Amb, p: Record<string, number>) => void;

/** 嗡声：锯齿基音 + 正弦谐波 → mix → trem（颤音插槽，默认 1）→ 低通 → on 开关 → 输出。返回 trem 供调用者加颤音。 */
function hum(a: Amb, freq: number, harmonics: readonly [number, number][], lp: number, level: number, on: number): GainNode {
  const { kit } = a.rt;
  const onG = kit.gain(on);
  const mix = kit.gain(level);
  const trem = kit.gain(1);
  const f = kit.filter('lowpass', lp, 0.8);
  mix.connect(trem).connect(f).connect(onG).connect(a.g);
  const base = a.src(kit.osc('sawtooth', freq));
  base.connect(mix);
  for (const [mult, g] of harmonics) {
    const o = a.src(kit.osc('sine', freq * mult));
    const gg = kit.gain(g);
    o.connect(gg).connect(mix);
  }
  a.param('on', (v, r) => rampTo(onG.gain, clamp01(v), Math.max(r, 0.03), a.ctx));
  return trem;
}

const PRESETS: Record<AmbPreset, Builder> = {
  // R1：白噪声带通 800–3000Hz + 随机水滴 + 檐沟滴水（GDD §9.5）
  rain(a, p) {
    const { kit, ctx } = a.rt;
    let intensity = clamp01(p['intensity'] ?? 1);
    const bed = kit.gain(intensity);
    bed.connect(a.g);
    const white = a.src(kit.noise('white'));
    const hp = kit.filter('highpass', 800, 0.6);
    const lp = kit.filter('lowpass', 3000, 0.6);
    const hi = kit.gain(0.2);
    white.connect(hp).connect(lp).connect(hi).connect(bed);
    const pink = a.src(kit.noise('pink'));
    const lp2 = kit.filter('lowpass', 650);
    const lo = kit.gain(0.16);
    pink.connect(lp2).connect(lo).connect(bed);
    const dropBus = kit.gain(1);
    dropBus.connect(a.g);
    a.every(0.03, 0.1, t => {
      if (Math.random() > intensity) return;
      blip(ctx, dropBus, t, rand(1800, 4200), rand(1400, 3000), rand(0.01, 0.03), rand(0.015, 0.05) * intensity, rand(-0.9, 0.9));
    });
    for (const pan of [-0.55, 0.45]) {
      const pitch = rand(650, 950);
      a.every(0.35, 1.1, t => {
        if (intensity < 0.15) return;
        plop(a.rt, dropBus, t, pitch * rand(0.95, 1.05), 0.09 * intensity, pan);
      });
    }
    a.param('intensity', (v, r) => {
      intensity = clamp01(v);
      rampTo(bed.gain, intensity, r, ctx);
    });
  },
  drips(a) {
    a.every(0.7, 2.6, t => {
      const pan = rand(-0.8, 0.8);
      const pitch = rand(500, 1300);
      plop(a.rt, a.g, t, pitch, rand(0.05, 0.1), pan);
      if (Math.random() < 0.25) plop(a.rt, a.g, t + rand(0.08, 0.2), pitch * 1.04, 0.04, pan);
    });
  },
  // 100Hz 锯齿波加谐波，-36dB，轻微颤音（GDD §9.5）
  sodium_hum(a, p) {
    const trem = hum(a, 100, [[2, 0.35], [3, 0.12]], 900, dbToGain(-34), p['on'] ?? 1);
    trem.gain.value = 0.85;
    a.own(a.rt.kit.lfo(trem.gain, 0.3, 0.12));
  },
  // 门卫室：50Hz 电源嗡声（GDD §9.5）
  mains_hum(a, p) {
    hum(a, 50, [[2, 0.5], [3, 0.2]], 320, 0.05, p['on'] ?? 1);
  },
  // 很轻的 7kHz CRT 高频啸叫
  // 另外：on 从 0 变 1（或 set('boot', 1)）时放一次“开机”——消磁的“嗡—咚”、高压建立时的滋啦声、啸叫从低往上爬到 7kHz
  // （SfxCue 里没有 CRT 开机，开场“CRT 开机，五路分屏”用 crt_whine 句柄的 on/boot 触发，见 engine-wp3.md）
  crt_whine(a, p) {
    const { kit, ctx } = a.rt;
    let on = clamp01(p['on'] ?? 1);
    const onG = kit.gain(on);
    const o = a.src(kit.osc('sine', 7000));
    const g = kit.gain(0.004);
    o.connect(g).connect(onG).connect(a.g);
    a.own(kit.lfo(o.frequency, 0.23, 12));
    const boot = (): void => {
      const t = ctx.currentTime + 0.01;
      // 消磁线圈：50Hz 锯齿的一声“嗡”，很快衰减
      const deg = kit.osc('sawtooth', 50);
      const dbp = kit.filter('lowpass', 420);
      const dg = kit.gain(0);
      dg.gain.setValueAtTime(0, t);
      dg.gain.linearRampToValueAtTime(0.22, t + 0.02);
      dg.gain.exponentialRampToValueAtTime(1e-4, t + 0.9);
      deg.connect(dbp).connect(dg).connect(a.g);
      deg.start(t);
      deg.stop(t + 1.0);
      // 继电器/高压的“咚”
      blip(ctx, a.g, t, 90, 45, 0.25, 0.3);
      // 高压建立：几下静电噼啪
      for (let i = 0; i < 5; i++) burst(a.rt, a.g, t + 0.05 + i * rand(0.03, 0.09), rand(0.004, 0.02), rand(0.05, 0.12), { hp: 3000 });
      // 啸叫从 2kHz 爬到 7kHz
      o.frequency.cancelScheduledValues(t);
      o.frequency.setValueAtTime(2000, t);
      o.frequency.exponentialRampToValueAtTime(7000, t + 0.5);
      onG.gain.cancelScheduledValues(t);
      onG.gain.setValueAtTime(0, t);
      onG.gain.linearRampToValueAtTime(1, t + 0.4);
    };
    a.param('on', (v, r) => {
      const next = clamp01(v);
      if (on < 0.5 && next >= 0.5) boot();
      else rampTo(onG.gain, next, Math.max(r, 0.03), ctx);
      on = next;
    });
    a.param('boot', v => {
      if (v > 0) {
        on = 1;
        boot();
      }
    });
    if (p['boot'] !== undefined && p['boot'] > 0) boot();
  },
  // R2：褐噪声低通 200Hz 房间底噪
  room_tone(a) {
    const { kit } = a.rt;
    const n = a.src(kit.noise('brown'));
    const lp = kit.filter('lowpass', 200);
    const g = kit.gain(0.4);
    n.connect(lp).connect(g).connect(a.g);
  },
  // 远处电视：滤波噪声，音节式起伏，整体忽起忽落，隔着墙（低通）
  tv_murmur(a, p) {
    const { kit, ctx } = a.rt;
    const n = a.src(kit.noise('pink'));
    const bp = kit.filter('bandpass', 620, 0.9);
    const wall = kit.filter('lowpass', 1100);
    const syl = kit.gain(0);
    const lvl = kit.gain(0.12 * (p['level'] ?? 1));
    n.connect(bp).connect(wall).connect(syl).connect(lvl).connect(a.g);
    const swell = kit.gain(0.04);
    const lfo = a.src(kit.osc('sine', 0.05));
    lfo.connect(swell).connect(lvl.gain);
    a.every(0.09, 0.28, t => {
      const v = Math.random() < 0.18 ? 0 : rand(0.3, 1);
      syl.gain.setTargetAtTime(v, t, 0.03);
    }, () => 1, 0.05);
    a.param('level', (v, r) => rampTo(lvl.gain, 0.12 * Math.max(0, v), r, ctx));
  },
  // R2_502：挂钟滴答（10ms 方波脉冲），滴/答两个音高
  clock_tick(a) {
    const { ctx } = a.rt;
    let n = 0;
    a.every(1, 1, t => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = n++ % 2 === 0 ? 2300 : 1850;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2100;
      bp.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.001);
      g.gain.exponentialRampToValueAtTime(1e-4, t + 0.012);
      o.connect(bp).connect(g).connect(a.g);
      o.start(t);
      o.stop(t + 0.02);
    }, () => 1, 0.05);
  },
  // 灶火：褐噪声闪烁 + 偶尔的噼啪
  stove_fire(a) {
    const { kit } = a.rt;
    const n = a.src(kit.noise('brown'));
    const lp = kit.filter('lowpass', 480);
    const flick = kit.gain(0.6);
    const g = kit.gain(0.45);
    n.connect(lp).connect(flick).connect(g).connect(a.g);
    a.every(0.05, 0.16, t => flick.gain.setTargetAtTime(rand(0.3, 1), t, 0.04), () => 1, 0.02);
    a.every(0.08, 0.7, t => burst(a.rt, a.g, t, rand(0.003, 0.012), rand(0.08, 0.25), { hp: 2500, pan: rand(-0.3, 0.3) }));
  },
  // R3：车流远声（低通噪声起伏，偶尔一辆车从左到右开过）
  traffic(a, p) {
    const { kit, ctx } = a.rt;
    const lvl = kit.gain(p['level'] ?? 1);
    lvl.connect(a.g);
    const n = a.src(kit.noise('brown'));
    const lp = kit.filter('lowpass', 300);
    const bed = kit.gain(0.18);
    n.connect(lp).connect(bed).connect(lvl);
    a.own(kit.lfo(bed.gain, 0.03, 0.05));
    a.every(4, 11, t => {
      const dur = rand(3, 6);
      const src = kit.noise('pink', 4);
      src.loop = true;
      const bp = kit.filter('bandpass', 260, 0.7);
      bp.frequency.setValueAtTime(260, t);
      bp.frequency.linearRampToValueAtTime(rand(550, 800), t + dur * 0.5);
      bp.frequency.linearRampToValueAtTime(240, t + dur);
      const g = kit.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(0.08, 0.16), t + dur * 0.5);
      g.gain.linearRampToValueAtTime(0, t + dur);
      const pan = ctx.createStereoPanner();
      const dir = Math.random() < 0.5 ? 1 : -1;
      pan.pan.setValueAtTime(-0.8 * dir, t);
      pan.pan.linearRampToValueAtTime(0.8 * dir, t + dur);
      src.connect(bp).connect(g).connect(pan).connect(lvl);
      src.start(t, rand(0, 3));
      src.stop(t + dur + 0.05);
    });
    a.param('level', (v, r) => rampTo(lvl.gain, Math.max(0, v), r, ctx));
  },
  // 霓虹嘶嘶声：高频噪声 + 120Hz 细嗡 + 偶发电弧噼啪
  neon_hiss(a, p) {
    const { kit } = a.rt;
    const onG = kit.gain(p['on'] ?? 1);
    onG.connect(a.g);
    const n = a.src(kit.noise('white'));
    const hp = kit.filter('highpass', 6000);
    const g = kit.gain(0.012);
    n.connect(hp).connect(g).connect(onG);
    const o = a.src(kit.osc('sawtooth', 120));
    const bp = kit.filter('bandpass', 240, 4);
    const og = kit.gain(0.012);
    o.connect(bp).connect(og).connect(onG);
    a.every(0.4, 4, t => burst(a.rt, onG, t, rand(0.005, 0.03), rand(0.03, 0.08), { hp: 3500 }));
    a.param('on', (v, r) => rampTo(onG.gain, clamp01(v), Math.max(r, 0.03), a.ctx));
  },
  // 纸扎店纸张沙沙（高通噪声短促爆发，成簇）
  paper_rustle(a) {
    a.every(1.2, 5, t => {
      const count = Math.floor(rand(3, 9));
      let tt = t;
      for (let i = 0; i < count; i++) {
        burst(a.rt, a.g, tt, rand(0.02, 0.06), rand(0.03, 0.09), { hp: 2500, bp: 5200, q: 0.8, pan: rand(-0.5, 0.5) });
        tt += rand(0.02, 0.07);
      }
    });
  },
  // 暗房流水（粉噪声带通）+ 盘里的水滴
  darkroom_water(a) {
    const { kit } = a.rt;
    const n = a.src(kit.noise('pink'));
    const bp = kit.filter('bandpass', 1400, 1.1);
    const mod = kit.gain(0.8);
    const g = kit.gain(0.12);
    n.connect(bp).connect(mod).connect(g).connect(a.g);
    a.every(0.1, 0.3, t => mod.gain.setTargetAtTime(rand(0.55, 1), t, 0.06), () => 1, 0.02);
    a.every(1.5, 4, t => plop(a.rt, a.g, t, rand(1000, 1500), 0.05, rand(-0.4, 0.4)));
  },
  // R4：3 秒指数衰减噪声脉冲响应的长混响（打开共享 send）+ 远处的低频隆隆
  tunnel_reverb(a, p) {
    const { kit } = a.rt;
    let wet = clamp01(p['wet'] ?? 0.35);
    a.rt.setReverb(wet, 1.5);
    const n = a.src(kit.noise('brown'));
    const lp = kit.filter('lowpass', 75);
    const g = kit.gain(0.22);
    n.connect(lp).connect(g).connect(a.g);
    a.param('wet', (v, r) => {
      wet = clamp01(v);
      a.rt.setReverb(wet, r);
    });
    a.onStop = f => a.rt.setReverb(0, f);
  },
  // 灯管 120Hz 嗡鸣随频闪断续
  tube_hum(a, p) {
    const { kit } = a.rt;
    const onG = kit.gain(p['on'] ?? 1);
    const gate = kit.gain(1);
    onG.connect(a.g);
    const o = a.src(kit.osc('sawtooth', 120));
    const lp = kit.filter('lowpass', 1500);
    const g = kit.gain(0.03);
    o.connect(lp).connect(gate).connect(g).connect(onG);
    const o2 = a.src(kit.osc('sine', 240));
    const g2 = kit.gain(0.012);
    o2.connect(g2).connect(gate);
    a.every(0.05, 0.25, t => gate.gain.setTargetAtTime(Math.random() < 0.18 ? 0.05 : 1, t, 0.008), () => 1, 0.02);
    a.param('on', (v, r) => rampTo(onG.gain, clamp01(v), Math.max(r, 0.03), a.ctx));
  },
  // 鬼市：人声低语（共振峰带通扫频噪声，多路）
  whispers(a, p) {
    const { kit, ctx } = a.rt;
    let density = clamp01(p['density'] ?? 1);
    const voices = 4;
    for (let i = 0; i < voices; i++) {
      const n = a.src(kit.noise('pink'));
      const hp = kit.filter('highpass', 380);
      n.connect(hp);
      const sum = kit.gain(1);
      const formants = [rand(350, 750), rand(1000, 1900), rand(2300, 3100)];
      formants.forEach((f, k) => {
        const bp = kit.filter('bandpass', f, 7);
        a.own(kit.lfo(bp.frequency, rand(0.8, 2.2), f * 0.25));
        const gg = kit.gain(1.4 / (1 + k * 0.7));
        hp.connect(bp).connect(gg).connect(sum);
      });
      const env = kit.gain(0);
      const pan = ctx.createStereoPanner();
      pan.pan.value = rand(-0.85, 0.85);
      const lvl = kit.gain(0.07);
      sum.connect(env).connect(lvl).connect(pan).connect(a.g);
      const idx = i;
      a.every(0.1, 0.35, t => {
        const active = idx < Math.round(voices * density);
        env.gain.setTargetAtTime(active && Math.random() > 0.3 ? rand(0.3, 1) : 0, t, 0.05);
      }, () => 1, rand(0.02, 0.4));
    }
    a.param('density', v => {
      density = clamp01(v);
    });
  },
  // 鬼市：FM 铃铛（比值 1:3.5）
  fm_bells(a, p) {
    const { kit, ctx } = a.rt;
    let rate = Math.max(0.1, p['rate'] ?? 1);
    const notes = [587.33, 659.26, 880, 987.77, 1174.66];
    a.every(3, 9, () => {
      const pan = ctx.createStereoPanner();
      pan.pan.value = rand(-0.8, 0.8);
      const g = kit.gain(rand(0.06, 0.12));
      g.connect(pan).connect(a.g);
      const f = notes[Math.floor(Math.random() * notes.length)]! * (Math.random() < 0.3 ? 0.5 : 1);
      kit.fmBell(f, 3.5, rand(2.5, 4.2), g);
    }, () => rate, rand(0.5, 2.5));
    a.param('rate', v => {
      rate = Math.max(0.1, v);
    });
  },
  // 鬼市：二胡似的锯齿波长音（颤音、低通），音与音之间滑过去
  erhu_drone(a, p) {
    const { kit, ctx } = a.rt;
    const notes = [146.83, 220, 293.66, 329.63, 220];
    let k = 0;
    const o = a.src(kit.osc('sawtooth', notes[0]!));
    const lp = kit.filter('lowpass', 1400, 1.2);
    const body = kit.filter('peaking', 900, 1.5);
    body.gain.value = 6;
    const bow = kit.gain(0.03);
    const lvl = kit.gain(0.9 * (p['level'] ?? 1));
    o.connect(lp).connect(body).connect(bow).connect(lvl).connect(a.g);
    a.own(kit.lfo(o.frequency, 5.3, 2.5));
    const hiss = a.src(kit.noise('pink'));
    const hbp = kit.filter('bandpass', 2600, 2);
    const hg = kit.gain(0.004);
    hiss.connect(hbp).connect(hg).connect(lvl);
    a.every(5, 9, t => {
      k = (k + 1) % notes.length;
      o.frequency.setTargetAtTime(notes[k]!, t, 0.12);
      bow.gain.setTargetAtTime(0.018, t, 0.05);
      bow.gain.setTargetAtTime(0.045, t + 0.25, 0.6);
      bow.gain.setTargetAtTime(0.03, t + 2.5, 1.2);
    });
    a.param('level', (v, r) => rampTo(lvl.gain, 0.9 * Math.max(0, v), r, ctx));
  },
  // 卯时：远处鸡鸣（带谐波的正弦滑音）
  rooster(a) {
    const { kit, ctx } = a.rt;
    a.every(14, 28, t => {
      const lp = kit.filter('lowpass', 2800);
      const pan = ctx.createStereoPanner();
      pan.pan.value = rand(-0.5, 0.5);
      const amp = kit.gain(0);
      amp.connect(lp).connect(pan).connect(a.g);
      // “喔—喔—喔——”：短、短、长
      const segs: [number, number][] = [[0, 0.16], [0.22, 0.38], [0.46, 1.45]];
      for (const [s, e] of segs) {
        amp.gain.setValueAtTime(0, t + s);
        amp.gain.linearRampToValueAtTime(0.05, t + s + 0.03);
        amp.gain.setValueAtTime(0.05, t + e - 0.12);
        amp.gain.linearRampToValueAtTime(0, t + e);
      }
      const f0 = rand(460, 540);
      for (const h of [1, 2, 3, 4]) {
        const o = kit.osc('sine', f0 * h);
        const f = o.frequency;
        f.setValueAtTime(f0 * h, t);
        f.linearRampToValueAtTime(f0 * 1.32 * h, t + 0.5);
        f.setValueAtTime(f0 * 1.3 * h, t + 1.0);
        f.linearRampToValueAtTime(f0 * 0.85 * h, t + 1.45);
        const g = kit.gain(1 / (h * 1.4));
        o.connect(g).connect(amp);
        o.start(t);
        o.stop(t + 1.5);
      }
    }, () => 1, rand(1.5, 5));
  },
};

export function startAmbience(rt: AudioRuntime, preset: AmbPreset, out: AudioNode, params?: Record<string, number>): AmbienceHandle {
  const a = new Amb(rt, out, preset);
  PRESETS[preset](a, params ?? {});
  const lvl = params?.['level'];
  if (lvl !== undefined && preset !== 'tv_murmur' && preset !== 'traffic' && preset !== 'erhu_drone') a.set('level', lvl, 0);
  return a;
}
