// owner: WP3
// 音乐（ARCH §9；GDD §9.5）：D–E–A 主动机（八音盒音色）、《送别》八音盒（John P. Ordway 1851，公有领域）、二胡式变奏。WP3 内部。
//
// 八音盒音色 = 加法合成：基音 + 2、3 倍泛音 + 一个 5.4 倍的非谐“叮”（音梳齿的高阶振动），各自指数衰减，起音带一点咔嗒；
// 再过一个短混响（程序生成的 1.6s 脉冲响应）。《送别》按 D 大调（1 = D5），与主动机 D–E–A（= 1–2–5）同主音。
// 二胡：锯齿波 → 高通/共鸣峰/低通，音与音之间滑音，每个音先直后揉（延迟颤音），叠一点弓毛噪声；循环到被停止。
// 音符由前瞻调度器按 AudioContext 时钟排程（不一次性建几百个节点）。

import type { AudioRuntime, MusicCue } from './engine';
import { midiToHz } from './synth';

/** 音符：MIDI 音高与拍数。 */
export interface Note { midi: number; beats: number }

/** 播放中的音乐：stop(fadeSec) 淡出并收尾。 */
export interface MusicHandle { stop(fadeSec?: number): void; readonly done: boolean }

/** 主动机 D–E–A。 */
export const MOTIF_DEA: readonly Note[] = [
  { midi: 62, beats: 1 },
  { midi: 64, beats: 1 },
  { midi: 69, beats: 2 },
];

// 简谱 → MIDI（D 大调，1 = D5 = 74；low7 = 升 C5）
const D = { low7: 73, 1: 74, 2: 76, 3: 78, 4: 79, 5: 81, 6: 83, 7: 85, hi1: 86 } as const;
const n = (midi: number, beats: number): Note => ({ midi, beats });

/** 《送别》旋律（4/4，每小节 4 拍）：A A' B A'。 */
export const SONGBIE: readonly Note[] = [
  // A：长亭外，古道边，芳草碧连天
  n(D[5], 1), n(D[3], 0.5), n(D[5], 0.5), n(D.hi1, 2),
  n(D[6], 1), n(D.hi1, 1), n(D[5], 2),
  n(D[5], 1), n(D[1], 0.5), n(D[2], 0.5), n(D[3], 1), n(D[2], 0.5), n(D[1], 0.5),
  n(D[2], 4),
  // A'：晚风拂柳笛声残，夕阳山外山
  n(D[5], 1), n(D[3], 0.5), n(D[5], 0.5), n(D.hi1, 1.5), n(D[7], 0.5),
  n(D[6], 1), n(D.hi1, 1), n(D[5], 2),
  n(D[5], 1), n(D[2], 0.5), n(D[3], 0.5), n(D[4], 1.5), n(D.low7, 0.5),
  n(D[1], 4),
  // B：天之涯，地之角，知交半零落
  n(D[6], 1), n(D.hi1, 1), n(D.hi1, 2),
  n(D[7], 1), n(D[6], 0.5), n(D[7], 0.5), n(D.hi1, 2),
  n(D[6], 0.5), n(D[7], 0.5), n(D.hi1, 0.5), n(D[6], 0.5), n(D[6], 0.5), n(D[5], 0.5), n(D[3], 0.5), n(D[1], 0.5),
  n(D[2], 4),
  // A'：一壶浊酒尽余欢，今宵别梦寒
  n(D[5], 1), n(D[3], 0.5), n(D[5], 0.5), n(D.hi1, 1.5), n(D[7], 0.5),
  n(D[6], 1), n(D.hi1, 1), n(D[5], 2),
  n(D[5], 1), n(D[2], 0.5), n(D[3], 0.5), n(D[4], 1.5), n(D.low7, 0.5),
  n(D[1], 4),
];

/** 每小节的低音根音（D3 = 50、G3 = 55、A3 = 57）：I IV I V / I IV V I / IV I IV V / I IV V I。 */
export const SONGBIE_BASS: readonly number[] = [
  50, 55, 50, 57,
  50, 55, 57, 50,
  55, 50, 55, 57,
  50, 55, 57, 50,
];

/** 二胡变奏：D–E–A 展开成一句，末尾长音；循环之间空 2 拍。 */
export const ERHU_DEA: readonly Note[] = [
  n(62, 1.5), n(64, 0.5), n(69, 2),
  n(71, 1), n(69, 1), n(64, 1), n(62, 1),
  n(64, 1.5), n(62, 0.5), n(59, 1), n(57, 1),
  n(62, 4),
];

export function totalBeats(notes: readonly Note[]): number {
  return notes.reduce((s, x) => s + x.beats, 0);
}

// ---------------------------------------------------------------- 八音盒

const PARTIALS: readonly [ratio: number, amp: number, decay: number][] = [
  [1, 1, 1.8],
  [2, 0.28, 0.7],
  [3, 0.1, 0.35],
  [5.4, 0.05, 0.12],
];

function musicBoxNote(rt: AudioRuntime, out: AudioNode, t: number, midi: number, vel: number): void {
  const ac = rt.ctx;
  const f = midiToHz(midi);
  for (const [ratio, amp, decay] of PARTIALS) {
    if (f * ratio > 16000) continue;
    const o = ac.createOscillator();
    o.frequency.value = f * ratio;
    const g = ac.createGain();
    // 高音衰减更快（短齿）
    const d = decay * Math.min(1.4, Math.max(0.45, 900 / f));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp * vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(1e-4, t + d);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + d + 0.02);
  }
  // 拨齿的咔嗒
  const click = ac.createOscillator();
  click.frequency.value = f * 11;
  const cg = ac.createGain();
  cg.gain.setValueAtTime(0.03 * vel, t);
  cg.gain.exponentialRampToValueAtTime(1e-4, t + 0.012);
  click.connect(cg).connect(out);
  click.start(t);
  click.stop(t + 0.02);
}

/** 八音盒的输出链：干声 + 短混响 → 主增益。 */
function boxChain(rt: AudioRuntime, out: AudioNode): { input: GainNode; master: GainNode } {
  const ac = rt.ctx;
  const master = ac.createGain();
  master.gain.value = 0.55;
  master.connect(out);
  const input = ac.createGain();
  input.connect(master);
  const conv = ac.createConvolver();
  conv.buffer = rt.kit.impulse(1.6, 3.2);
  const wet = ac.createGain();
  wet.gain.value = 0.28;
  input.connect(conv).connect(wet).connect(master);
  return { input, master };
}

interface Ev { beat: number; fire(t: number): void }

/** 按拍排程一串事件；tempo = 每拍秒数（可带渐慢）；loop 时一轮结束后从头再来。 */
function sequence(rt: AudioRuntime, events: readonly Ev[], secPerBeat: (beat: number) => number, lengthBeats: number, loop: boolean, onEnd: () => void): () => void {
  const ac = rt.ctx;
  const start = ac.currentTime + 0.08;
  // 预先把拍 → 时间积分好（渐慢时每拍长度不同）
  const timeOf = (beat: number): number => {
    let t = 0;
    const whole = Math.floor(beat);
    for (let b = 0; b < whole; b++) t += secPerBeat(b);
    return t + (beat - whole) * secPerBeat(whole);
  };
  const cycle = timeOf(lengthBeats);
  let i = 0;
  let round = 0;
  let cancelled = false;
  const cancel = rt.schedule(until => {
    if (cancelled) return false;
    for (;;) {
      if (i >= events.length) {
        if (!loop) {
          const endT = start + cycle + 2.5;
          if (ac.currentTime >= endT) {
            onEnd();
            return false;
          }
          return true;
        }
        i = 0;
        round++;
      }
      const ev = events[i]!;
      const t = start + round * cycle + timeOf(ev.beat);
      if (t > until) return true;
      if (t >= ac.currentTime - 0.05) ev.fire(Math.max(t, ac.currentTime));
      i++;
    }
  });
  return () => {
    cancelled = true;
    cancel();
  };
}

function melodyEvents(notes: readonly Note[], play: (t: number, note: Note, index: number) => void): Ev[] {
  const out: Ev[] = [];
  let beat = 0;
  notes.forEach((note, i) => {
    const b = beat;
    out.push({ beat: b, fire: t => play(t, note, i) });
    beat += note.beats;
  });
  return out;
}

function fadeOut(rt: AudioRuntime, g: GainNode, sec: number): void {
  const t = rt.ctx.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(g.gain.value, t);
  g.gain.linearRampToValueAtTime(0, t + Math.max(0.02, sec));
  const end = t + sec + 0.1;
  rt.schedule(() => {
    if (rt.ctx.currentTime < end) return true;
    g.disconnect();
    return false;
  });
}

function playMotif(rt: AudioRuntime, out: AudioNode): MusicHandle {
  const { input, master } = boxChain(rt, out);
  const spb = 0.6;
  const events = melodyEvents(MOTIF_DEA, (t, note) => musicBoxNote(rt, input, t, note.midi + 12, 0.9));
  // 最后一个 A 下面垫一个低音 D
  events.push({ beat: 2, fire: t => musicBoxNote(rt, input, t, 50, 0.5) });
  events.sort((a, b) => a.beat - b.beat);
  const h = { done: false, stop: (f = 0.8) => { cancel(); fadeOut(rt, master, f); h.done = true; } };
  const cancel = sequence(rt, events, () => spb, totalBeats(MOTIF_DEA), false, () => {
    h.done = true;
    fadeOut(rt, master, 0.1);
  });
  return h;
}

function playSongbie(rt: AudioRuntime, out: AudioNode): MusicHandle {
  const { input, master } = boxChain(rt, out);
  const total = totalBeats(SONGBIE);
  // 72 bpm，最后两小节渐慢（发条快松了）
  const spb = (beat: number): number => {
    const base = 60 / 72;
    const slowFrom = total - 8;
    return beat < slowFrom ? base : base * (1 + ((beat - slowFrom) / 8) * 0.45);
  };
  const events = melodyEvents(SONGBIE, (t, note) => musicBoxNote(rt, input, t, note.midi, 0.85));
  SONGBIE_BASS.forEach((root, bar) => {
    events.push({ beat: bar * 4, fire: t => musicBoxNote(rt, input, t, root, 0.45) });
    events.push({ beat: bar * 4 + 2, fire: t => musicBoxNote(rt, input, t, root + 7, 0.28) });
  });
  events.sort((a, b) => a.beat - b.beat);
  const h = { done: false, stop: (f = 1.5) => { cancel(); fadeOut(rt, master, f); h.done = true; } };
  const cancel = sequence(rt, events, spb, total, false, () => {
    h.done = true;
    fadeOut(rt, master, 0.1);
  });
  return h;
}

function playErhu(rt: AudioRuntime, out: AudioNode): MusicHandle {
  const ac = rt.ctx;
  const master = ac.createGain();
  master.gain.setValueAtTime(0, ac.currentTime);
  master.gain.linearRampToValueAtTime(0.5, ac.currentTime + 0.6);
  master.connect(out);
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = midiToHz(ERHU_DEA[0]!.midi);
  const hp = rt.kit.filter('highpass', 220);
  const body = rt.kit.filter('peaking', 1050, 1.4);
  body.gain.value = 7;
  const nasal = rt.kit.filter('peaking', 2600, 2);
  nasal.gain.value = 4;
  const lp = rt.kit.filter('lowpass', 3200, 0.9);
  const bow = ac.createGain();
  bow.gain.value = 0;
  osc.connect(hp).connect(body).connect(nasal).connect(lp).connect(bow).connect(master);
  // 颤音：LFO 深度按音符包络（先直后揉）
  const vib = ac.createOscillator();
  vib.frequency.value = 5.6;
  const vibDepth = ac.createGain();
  vibDepth.gain.value = 0;
  vib.connect(vibDepth).connect(osc.frequency);
  // 弓毛噪声跟着弓的力度走
  const hiss = rt.kit.noise('pink');
  const hbp = rt.kit.filter('bandpass', 3200, 1.5);
  const hg = ac.createGain();
  hg.gain.value = 0.05;
  hiss.connect(hbp).connect(hg).connect(bow);
  osc.start();
  vib.start();
  hiss.start();

  const spb = 1.0;
  const events: Ev[] = melodyEvents(ERHU_DEA, (t, note) => {
    const f = midiToHz(note.midi);
    const dur = note.beats * spb;
    osc.frequency.setTargetAtTime(f, t, 0.045);          // 滑音
    bow.gain.setTargetAtTime(0.1, t, 0.02);              // 换弓的一下轻
    bow.gain.setTargetAtTime(0.22, t + 0.08, 0.18);
    bow.gain.setTargetAtTime(0.16, t + dur * 0.6, 0.4);
    vibDepth.gain.setTargetAtTime(0, t, 0.02);
    vibDepth.gain.setTargetAtTime(f * 0.012, t + Math.min(0.35, dur * 0.4), 0.2);
  });
  // 句尾空两拍：弓停下
  events.push({ beat: totalBeats(ERHU_DEA), fire: t => bow.gain.setTargetAtTime(0, t, 0.25) });
  const loopBeats = totalBeats(ERHU_DEA) + 2;
  let stopped = false;
  const h = {
    done: false,
    stop: (fade = 1.2) => {
      if (stopped) return;
      stopped = true;
      cancel();
      fadeOut(rt, master, fade);
      const end = ac.currentTime + fade + 0.1;
      for (const s of [osc, vib, hiss]) s.stop(end);
      h.done = true;
    },
  };
  const cancel = sequence(rt, events, () => spb, loopBeats, true, () => undefined);
  return h;
}

/** 播放音乐提示；'stop' 返回 null（由 AudioEngine 负责停掉当前的）。 */
export function playMusic(rt: AudioRuntime, cue: MusicCue, out: AudioNode): MusicHandle | null {
  switch (cue) {
    case 'motif_dea':
      return playMotif(rt, out);
    case 'songbie':
      return playSongbie(rt, out);
    case 'erhu_dea':
      return playErhu(rt, out);
    case 'stop':
      return null;
  }
}
