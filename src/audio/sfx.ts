// owner: WP3
// SfxCue 的合成实现（ARCH §9；GDD §9.5 关键音效表）。WP3 内部：AudioEngine.sfx 调用。
// 每个音效都是一次性的：节点在调用时建好、按 AudioContext 时钟排好起止，结束后自然回收。
// rate：音高/速度倍率（1 = 原样），用于同一音效的变化（如镜头环正反转）。返回值是音效时长（秒），引擎据此回收外层节点。

import type { AudioRuntime, SfxCue } from './engine';

const rand = (lo: number, hi: number): number => lo + (hi - lo) * Math.random();

interface Ctx {
  rt: AudioRuntime;
  ac: AudioContext;
  out: AudioNode;
  t: number;
  rate: number;
}

/** 单个振荡器 + 包络（线性起音、指数衰减），可选滑音。 */
function tone(c: Ctx, o: {
  type?: OscillatorType; f: number; f1?: number; at?: number; dur: number; peak: number; attack?: number; glide?: number;
  lp?: number; bp?: [number, number]; dest?: AudioNode;
}): OscillatorNode {
  const { ac } = c;
  const t = c.t + (o.at ?? 0) / c.rate;
  const dur = o.dur / c.rate;
  const osc = ac.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f * c.rate, t);
  if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 * c.rate), t + (o.glide ?? dur));
  const g = ac.createGain();
  const a = Math.max(0.001, (o.attack ?? 0.003) / c.rate);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.peak, t + a);
  g.gain.exponentialRampToValueAtTime(1e-4, t + Math.max(a + 0.002, dur));
  let node: AudioNode = osc;
  if (o.lp) {
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.lp;
    node.connect(f);
    node = f;
  }
  if (o.bp) {
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = o.bp[0] * c.rate;
    f.Q.value = o.bp[1];
    node.connect(f);
    node = f;
  }
  node.connect(g).connect(o.dest ?? c.out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  return osc;
}

/** 噪声爆发（从共享噪声缓冲里截一段），可选高通/低通/带通与滤波扫频。 */
function noise(c: Ctx, o: {
  type?: 'white' | 'pink' | 'brown'; at?: number; dur: number; peak: number; attack?: number;
  hp?: number; lp?: number; lp1?: number; bp?: [number, number]; bp1?: number; hold?: number; dest?: AudioNode;
}): void {
  const { ac, rt } = c;
  const t = c.t + (o.at ?? 0) / c.rate;
  const dur = o.dur / c.rate;
  const src = rt.kit.noise(o.type ?? 'white', 4);
  src.loop = true;
  let node: AudioNode = src;
  if (o.hp) {
    const f = ac.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = o.hp;
    node.connect(f);
    node = f;
  }
  if (o.lp) {
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(o.lp, t);
    if (o.lp1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.lp1), t + dur);
    node.connect(f);
    node = f;
  }
  if (o.bp) {
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(o.bp[0], t);
    f.Q.value = o.bp[1];
    if (o.bp1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.bp1), t + dur);
    node.connect(f);
    node = f;
  }
  const g = ac.createGain();
  const a = Math.max(0.001, o.attack ?? 0.002);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.peak, t + a);
  if (o.hold) g.gain.setValueAtTime(o.peak, t + a + o.hold);
  g.gain.exponentialRampToValueAtTime(1e-4, t + Math.max(a + (o.hold ?? 0) + 0.002, dur));
  node.connect(g).connect(o.dest ?? c.out);
  src.start(t, rand(0, 3.5));
  src.stop(t + dur + 0.05);
}

/** 机械咔嗒：很短的高通噪声 + 一个共振的小正弦。 */
function click(c: Ctx, at: number, peak: number, ping = 3200): void {
  noise(c, { at, dur: 0.012, peak, hp: 1800 });
  tone(c, { f: ping, at, dur: 0.02, peak: peak * 0.5 });
}

type Impl = (c: Ctx) => number;

const DTMF_ROWS = [697, 770, 852, 941];
const DTMF_COLS = [1209, 1336, 1477];

const SFX: Record<SfxCue, Impl> = {
  // 20ms 噪声爆发加两下咔嗒（间隔 30ms）
  shutter(c) {
    click(c, 0, 0.5, 2600);
    noise(c, { at: 0.004, dur: 0.02, peak: 0.35, bp: [3200, 0.8] });
    click(c, 0.03, 0.42, 2100);
    tone(c, { f: 180, at: 0, dur: 0.05, peak: 0.12, type: 'triangle' });
    return 0.1;
  },
  // 1kHz 正弦，80ms
  rec_beep(c) {
    tone(c, { f: 1000, dur: 0.08, peak: 0.22, attack: 0.004 });
    return 0.1;
  },
  // 锯齿波 200→260Hz 滑音（镜头环的小马达）
  zoom_motor(c) {
    const dur = 0.35;
    tone(c, { type: 'sawtooth', f: 200, f1: 260, dur, peak: 0.07, attack: 0.02, lp: 1400 });
    tone(c, { type: 'square', f: 400, f1: 520, dur, peak: 0.015, attack: 0.02, lp: 2200 });
    noise(c, { dur, peak: 0.02, bp: [1800, 1.2], attack: 0.02 });
    return dur + 0.05;
  },
  // 锯齿波向下扫频 2k→200Hz，叠加噪声，wow 调制 LFO 4Hz
  rewind(c) {
    const { ac } = c;
    const dur = 1.3 / c.rate;
    const osc = tone(c, { type: 'sawtooth', f: 2000, f1: 200, dur: 1.3, peak: 0.08, attack: 0.03, lp: 3000 });
    const lfo = ac.createOscillator();
    lfo.frequency.value = 4;
    const depth = ac.createGain();
    depth.gain.value = 60;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(c.t);
    lfo.stop(c.t + dur + 0.05);
    noise(c, { dur: 1.3, peak: 0.06, bp: [2500, 0.7], bp1: 400, attack: 0.03, hold: 0.8 });
    click(c, 0, 0.25, 1500);
    return dur + 0.1;
  },
  // 一声闷响加嗡鸣
  ir_toggle(c) {
    tone(c, { f: 110, f1: 55, dur: 0.22, peak: 0.35, glide: 0.18 });
    noise(c, { dur: 0.06, peak: 0.12, lp: 600 });
    tone(c, { type: 'sawtooth', f: 120, at: 0.03, dur: 0.45, peak: 0.035, attack: 0.05, lp: 700 });
    return 0.55;
  },
  // 密码转轮：短促机械咔嗒
  dial_click(c) {
    click(c, 0, 0.28, rand(2800, 3400));
    return 0.05;
  },
  // 确认时 DTMF 双频
  dtmf(c) {
    const r = DTMF_ROWS[Math.floor(Math.random() * DTMF_ROWS.length)]!;
    const k = DTMF_COLS[Math.floor(Math.random() * DTMF_COLS.length)]!;
    tone(c, { f: r, dur: 0.14, peak: 0.12, attack: 0.005 });
    tone(c, { f: k, dur: 0.14, peak: 0.12, attack: 0.005 });
    return 0.2;
  },
  // 纸钱：一串高通噪声的细碎声
  paper_money(c) {
    let at = 0;
    for (let i = 0; i < 16; i++) {
      noise(c, { at, dur: rand(0.015, 0.05), peak: rand(0.05, 0.14), hp: 3000, bp: [rand(4500, 7500), 1] });
      at += rand(0.02, 0.06);
    }
    return at + 0.1;
  },
  // 门神、灶君说话：低频共振峰嗡声（短的一声“嗯——”）
  god_voice(c) {
    const { ac } = c;
    const dur = 1.2;
    const src = ac.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(70, c.t);
    src.frequency.linearRampToValueAtTime(62, c.t + dur);
    const sum = ac.createGain();
    for (const [f, q, g] of [[320, 6, 1], [800, 8, 0.5], [2400, 10, 0.12]] as const) {
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const gg = ac.createGain();
      gg.gain.value = g;
      src.connect(bp).connect(gg).connect(sum);
    }
    const amp = ac.createGain();
    amp.gain.setValueAtTime(0, c.t);
    amp.gain.linearRampToValueAtTime(0.5, c.t + 0.12);
    amp.gain.setValueAtTime(0.5, c.t + dur - 0.3);
    amp.gain.linearRampToValueAtTime(0, c.t + dur);
    sum.connect(amp).connect(c.out);
    src.start(c.t);
    src.stop(c.t + dur + 0.05);
    noise(c, { type: 'brown', dur, peak: 0.08, lp: 200, attack: 0.1, hold: dur - 0.4 });
    return dur + 0.1;
  },
  // 镁光灯“噗”：噪声爆发加低通扫频
  magnesium(c) {
    noise(c, { dur: 0.45, peak: 0.45, lp: 9000, lp1: 250, attack: 0.002 });
    tone(c, { f: 90, f1: 45, dur: 0.25, peak: 0.25 });
    click(c, 0, 0.2, 1800);
    return 0.5;
  },
  // 长曝光：每 0.5 秒一下滴答（调用方按节拍调用，这里只是一下）
  exposure_tick(c) {
    tone(c, { f: 1800, dur: 0.018, peak: 0.16, attack: 0.001 });
    noise(c, { dur: 0.008, peak: 0.1, hp: 2500 });
    return 0.05;
  },
  // 照妖镜：7–9kHz 多个失谐正弦的啸叫（随套叠层数渐强——调用方用 gain 调）
  feedback_howl(c) {
    const dur = 1.6;
    for (const f of [7050, 7380, 7920, 8430, 8910]) {
      tone(c, { f: f * rand(0.995, 1.005), f1: f * rand(1.0, 1.02), dur, peak: 0.02, attack: 0.6 });
    }
    tone(c, { f: 3520, dur, peak: 0.01, attack: 0.8 });
    return dur + 0.1;
  },
  // 焚化：随机噼啪 + “呼”的一声
  burn(c) {
    noise(c, { type: 'pink', dur: 1.4, peak: 0.22, bp: [400, 0.8], bp1: 1400, attack: 0.25, hold: 0.4 });
    let at = 0.05;
    for (let i = 0; i < 14; i++) {
      noise(c, { at, dur: rand(0.004, 0.015), peak: rand(0.1, 0.3), hp: 2000 });
      at += rand(0.04, 0.16);
    }
    return Math.max(1.5, at + 0.1);
  },
  // 声控灯“咔哒”加 120Hz 嗡鸣
  lamp_click(c) {
    click(c, 0, 0.35, 2400);
    tone(c, { type: 'sawtooth', f: 120, at: 0.01, dur: 0.6, peak: 0.04, attack: 0.03, lp: 900 });
    return 0.7;
  },
  // 电闸：沉的一下“咔嚓”
  switch(c) {
    tone(c, { f: 140, f1: 70, dur: 0.12, peak: 0.35 });
    noise(c, { dur: 0.05, peak: 0.3, bp: [1400, 1.2] });
    click(c, 0.012, 0.3, 2200);
    return 0.2;
  },
  // 门：合页吱呀（摩擦的锯齿，音高不稳）+ 落锁
  door(c) {
    const { ac } = c;
    const dur = 1.0;
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420 * c.rate, c.t);
    for (let i = 1; i <= 8; i++) osc.frequency.linearRampToValueAtTime(rand(300, 620) * c.rate, c.t + (dur * i) / 8);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 4;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, c.t);
    g.gain.linearRampToValueAtTime(0.06, c.t + 0.08);
    for (let i = 1; i <= 8; i++) g.gain.linearRampToValueAtTime(rand(0.02, 0.08), c.t + (dur * i) / 8);
    g.gain.linearRampToValueAtTime(0, c.t + dur);
    osc.connect(bp).connect(g).connect(c.out);
    osc.start(c.t);
    osc.stop(c.t + dur + 0.05);
    tone(c, { f: 95, f1: 60, at: dur, dur: 0.18, peak: 0.3 });
    click(c, dur + 0.01, 0.25, 1700);
    return dur + 0.3;
  },
  // 抽屉：木头滑动（低通噪声，强弱起伏）+ 碰到头
  drawer(c) {
    noise(c, { type: 'pink', dur: 0.45, peak: 0.16, bp: [700, 1.1], bp1: 500, attack: 0.05, hold: 0.25 });
    tone(c, { f: 130, f1: 80, at: 0.45, dur: 0.15, peak: 0.28 });
    click(c, 0.45, 0.15, 1200);
    return 0.65;
  },
  // 铁链：一串非谐的金属小碰撞
  chain(c) {
    let at = 0;
    for (let i = 0; i < 9; i++) {
      const f = rand(2200, 4800);
      tone(c, { f, at, dur: rand(0.06, 0.18), peak: rand(0.04, 0.1) });
      tone(c, { f: f * 2.76, at, dur: 0.05, peak: 0.03 });
      noise(c, { at, dur: 0.01, peak: 0.06, hp: 4000 });
      at += rand(0.03, 0.09);
    }
    return at + 0.25;
  },
  // 撬瓷砖：刮擦 + 一声瓷片脆响
  tile_pry(c) {
    for (let i = 0; i < 6; i++) noise(c, { at: i * 0.06, dur: 0.05, peak: rand(0.08, 0.16), bp: [rand(1800, 3200), 3] });
    tone(c, { f: 3100, at: 0.42, dur: 0.25, peak: 0.12 });
    tone(c, { f: 4870, at: 0.42, dur: 0.15, peak: 0.07 });
    noise(c, { at: 0.42, dur: 0.04, peak: 0.2, hp: 2500 });
    return 0.7;
  },
  // 倒水：带通噪声，中心频率快速乱跳（冒泡），音调随水位慢慢升高
  water_pour(c) {
    const dur = 1.6;
    let at = 0;
    while (at < dur) {
      const f = 380 + (at / dur) * 500;
      noise(c, { type: 'pink', at, dur: rand(0.03, 0.08), peak: rand(0.05, 0.12), bp: [f * rand(0.8, 1.5), 8] });
      tone(c, { f: f * rand(1.2, 2.2), f1: f * 2.6, at, dur: 0.04, peak: 0.03 });
      at += rand(0.015, 0.04);
    }
    noise(c, { type: 'pink', dur, peak: 0.05, lp: 900, attack: 0.1, hold: dur - 0.3 });
    return dur + 0.1;
  },
  // 远处钟声（时辰过场）：低沉的 FM 钟，经低通显得远
  bell_distant(c) {
    const { ac, rt } = c;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const g = ac.createGain();
    g.gain.value = 0.55;
    lp.connect(g).connect(c.out);
    rt.kit.fmBell(196 * c.rate, 1.4, 5.5, lp);
    rt.kit.fmBell(98 * c.rate, 2.01, 5, lp);
    return 6;
  },
  // 翻页：带通噪声扫一下
  page_turn(c) {
    noise(c, { dur: 0.3, peak: 0.12, bp: [1500, 0.8], bp1: 5000, attack: 0.06 });
    noise(c, { at: 0.2, dur: 0.06, peak: 0.08, hp: 3000 });
    return 0.35;
  },
  ui_open(c) {
    tone(c, { f: 660, dur: 0.07, peak: 0.08 });
    tone(c, { f: 990, at: 0.05, dur: 0.1, peak: 0.07 });
    return 0.2;
  },
  ui_close(c) {
    tone(c, { f: 880, dur: 0.07, peak: 0.07 });
    tone(c, { f: 587, at: 0.05, dur: 0.1, peak: 0.07 });
    return 0.2;
  },
  ui_tick(c) {
    tone(c, { f: 1500, dur: 0.012, peak: 0.08, attack: 0.001 });
    return 0.03;
  },
  error(c) {
    tone(c, { type: 'square', f: 180, dur: 0.12, peak: 0.05, lp: 1200 });
    tone(c, { type: 'square', f: 150, at: 0.14, dur: 0.16, peak: 0.05, lp: 1200 });
    return 0.35;
  },
  // 塞录像带：塑料壳的“咔哒——咚”，接着一小段机芯转动
  tape_insert(c) {
    click(c, 0, 0.3, 1600);
    noise(c, { type: 'pink', at: 0.05, dur: 0.25, peak: 0.1, bp: [900, 1.2], attack: 0.03 });
    tone(c, { f: 120, f1: 80, at: 0.3, dur: 0.15, peak: 0.3 });
    click(c, 0.3, 0.2, 1300);
    tone(c, { type: 'sawtooth', f: 85, at: 0.45, dur: 0.7, peak: 0.04, attack: 0.08, lp: 600 });
    return 1.2;
  },
  // 录像机机芯：马达呜呜声（锯齿 90Hz + 泛音 + 低通噪声）
  vcr_motor(c) {
    const dur = 1.0;
    tone(c, { type: 'sawtooth', f: 90, f1: 96, dur, peak: 0.05, attack: 0.1, lp: 700 });
    tone(c, { f: 180, dur, peak: 0.025, attack: 0.1 });
    noise(c, { type: 'pink', dur, peak: 0.03, lp: 1200, attack: 0.1, hold: dur - 0.3 });
    return dur + 0.1;
  },
  // CRT 开机（M1c，engine-wp3.md #10）：消磁线圈 50Hz 的“嗡”（低通、很快衰减）+ 继电器的“咚”+ 几下高压静电噼啪
  // + 行输出啸叫从 2kHz 爬到 7kHz 再淡成背景。与环境声 crt_whine 的 on/boot 开机是同一段合成（那边还会接着持续啸叫）。
  crt_on(c) {
    tone(c, { type: 'sawtooth', f: 50, dur: 0.9, peak: 0.22, attack: 0.02, lp: 420 });
    tone(c, { f: 90, f1: 45, dur: 0.25, peak: 0.3, glide: 0.25 });
    for (let i = 0; i < 5; i++) noise(c, { at: 0.05 + i * rand(0.03, 0.09), dur: rand(0.004, 0.02), peak: rand(0.05, 0.12), hp: 3000 });
    tone(c, { f: 2000, f1: 7000, at: 0.01, dur: 1.2, peak: 0.012, attack: 0.4, glide: 0.5 });
    return 1.3;
  },
};

/** 播放一个音效到 out；返回时长（秒）。 */
export function playSfx(rt: AudioRuntime, cue: SfxCue, out: AudioNode, o?: { gain?: number; rate?: number }): number {
  const rate = o?.rate && o.rate > 0 ? o.rate : 1;
  let dest: AudioNode = out;
  if (o?.gain !== undefined && o.gain !== 1) {
    const g = rt.ctx.createGain();
    g.gain.value = Math.max(0, o.gain);
    g.connect(out);
    dest = g;
  }
  return SFX[cue]({ rt, ac: rt.ctx, out: dest, t: rt.ctx.currentTime + 0.005, rate });
}
