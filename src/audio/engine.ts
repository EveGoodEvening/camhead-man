// owner: WP3
// AudioEngine（ARCH §9）：总线、解锁；§9 的公开类型（SfxCue、MusicCue、AmbPreset、AmbienceSpec、AmbienceHandle）都从本文件导出。
// 第一次 pointerdown 或 keydown 时才 new AudioContext() 并 resume()；?test=1 / ?mute=1 不解锁。
//
// 结构：各总线（ambience/sfx/music/voice）→ master（音量）→ 压缩器（防削波）→ destination。
// R4 的长混响是一条共享的 send：ambience/sfx/voice 各有一个 send 增益进 ConvolverNode，'tunnel_reverb' 环境声开着时 send > 0。
// 稀疏事件（雨滴、钟摆、铃、车流、音乐的音符）由一个前瞻调度器按 AudioContext 时钟排程：setInterval 每 50ms 醒一次，
// 把未来 0.25s 内的事件排进去——这是声音的排程，不是玩法计时（ARCH §1.4 只约束玩法），页面隐藏时 ctx 已 suspend，时钟停住。
// 解锁之前 ctx 为 null，所有方法是空操作；setAmbience 在解锁前被调用时记下来，解锁后补上（返回的句柄届时接到真实声音上）。

import type * as THREE from 'three';
import type { V3 } from '../core/types';
import type { SpeakerId } from '../data/ids';
import type { SynthKit } from './synth';
import { createSynthKit, dbToGain } from './synth';
import { startAmbience } from './ambience';
import { playSfx } from './sfx';
import { playMusic } from './music';
import type { MusicHandle } from './music';
import { playMurmur } from './voice';
import { SPEAKERS } from '../data/speakers';
import { devWarn } from '../core/log';

export type SfxCue =
  | 'shutter' | 'rec_beep' | 'zoom_motor' | 'rewind' | 'ir_toggle' | 'dial_click' | 'dtmf' | 'paper_money' | 'god_voice'
  | 'magnesium' | 'exposure_tick' | 'feedback_howl' | 'burn' | 'lamp_click' | 'switch' | 'door' | 'drawer' | 'chain'
  | 'tile_pry' | 'water_pour' | 'bell_distant' | 'page_turn' | 'ui_open' | 'ui_close' | 'ui_tick' | 'error' | 'tape_insert' | 'vcr_motor'
  | 'crt_on';   // M1c 补写（engine-wp3.md #10）：CRT 开机（消磁“嗡—咚”、静电噼啪、啸叫爬升），开场“CRT 开机，五路分屏”
export type MusicCue = 'motif_dea' | 'songbie' | 'erhu_dea' | 'stop';
export type AmbPreset =
  | 'rain' | 'drips' | 'sodium_hum' | 'mains_hum' | 'crt_whine' | 'room_tone' | 'tv_murmur' | 'clock_tick' | 'stove_fire'
  | 'traffic' | 'neon_hiss' | 'paper_rustle' | 'darkroom_water' | 'tunnel_reverb' | 'tube_hum' | 'whispers' | 'fm_bells'
  | 'erhu_drone' | 'rooster';
export type AmbienceSpec =
  /** gain 为 dB */
  | { preset: AmbPreset; gain?: number; params?: Record<string, number>; at?: V3 }
  | { custom: (kit: SynthKit, out: AudioNode) => AmbienceHandle; gain?: number };
export interface AmbienceHandle { set(param: string, v: number, rampSec?: number): void; stop(fadeSec?: number): void }

export interface AudioBuses { master: GainNode; ambience: GainNode; sfx: GainNode; music: GainNode; voice: GainNode }

/** 全部 SfxCue / AmbPreset / MusicCue（自测与试听页用）。 */
export const SFX_CUES: readonly SfxCue[] = [
  'shutter', 'rec_beep', 'zoom_motor', 'rewind', 'ir_toggle', 'dial_click', 'dtmf', 'paper_money', 'god_voice',
  'magnesium', 'exposure_tick', 'feedback_howl', 'burn', 'lamp_click', 'switch', 'door', 'drawer', 'chain',
  'tile_pry', 'water_pour', 'bell_distant', 'page_turn', 'ui_open', 'ui_close', 'ui_tick', 'error', 'tape_insert', 'vcr_motor',
  'crt_on',
];
export const AMB_PRESETS: readonly AmbPreset[] = [
  'rain', 'drips', 'sodium_hum', 'mains_hum', 'crt_whine', 'room_tone', 'tv_murmur', 'clock_tick', 'stove_fire',
  'traffic', 'neon_hiss', 'paper_rustle', 'darkroom_water', 'tunnel_reverb', 'tube_hum', 'whispers', 'fm_bells',
  'erhu_drone', 'rooster',
];
export const MUSIC_CUES: readonly MusicCue[] = ['motif_dea', 'songbie', 'erhu_dea', 'stop'];

/** 前瞻调度的一个任务：把 ≤ until 的事件排进去；返回 false 表示结束（移除）。 */
export type AudioJob = (until: number) => boolean;

/** ambience/sfx/music/voice 的实现拿到的运行时（WP3 内部）。 */
export interface AudioRuntime {
  readonly kit: SynthKit;
  readonly ctx: AudioContext;
  /** 登记前瞻任务；返回取消函数 */
  schedule(job: AudioJob): () => void;
  /** R4 长混响的湿声量（0 = 关）；'tunnel_reverb' 环境声调用 */
  setReverb(wet: number, rampSec: number): void;
}

const BUS_LEVEL = { master: 0.9, ambience: 0.75, sfx: 0.9, music: 0.55, voice: 0.6 } as const;
const LOOKAHEAD = 0.25;
const TICK_MS = 50;

/** 句柄代理：解锁前先记下 set/stop，接上真实句柄后重放；也负责整组淡入淡出的包装增益。 */
class AmbProxy implements AmbienceHandle {
  private real: AmbienceHandle | null = null;
  private readonly params = new Map<string, number>();
  private stopped = false;
  wrapper: GainNode | null = null;
  target = 1;
  stopFade = 0;
  constructor(readonly spec: AmbienceSpec) {}

  bind(real: AmbienceHandle, wrapper: GainNode): void {
    this.real = real;
    this.wrapper = wrapper;
    for (const [k, v] of this.params) real.set(k, v, 0);
  }
  set(param: string, v: number, rampSec?: number): void {
    if (this.stopped) return;
    if (param === 'gain') {
      // 通用参数：线性增益（乘在 spec.gain 的 dB 之上）；解锁前设置的会在 startProxy 的淡入里生效
      this.target = Math.max(0, v);
      if (!this.wrapper) return;
      const g = this.wrapper.gain;
      const t = this.wrapper.context.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(this.target * this.baseGain(), t + Math.max(0.01, rampSec ?? 0));
      return;
    }
    this.params.set(param, v);
    this.real?.set(param, v, rampSec);
  }
  stop(fadeSec = 1): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stopFade = Math.max(0, fadeSec);
    if (this.wrapper) {
      const g = this.wrapper.gain;
      const t = this.wrapper.context.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + Math.max(0.02, fadeSec));
    }
    this.real?.stop(fadeSec);
  }
  get isStopped(): boolean {
    return this.stopped;
  }
  baseGain(): number {
    return dbToGain(this.spec.gain ?? 0);
  }
}

export class AudioEngine {
  protected readonly muted: boolean;
  private _ctx: AudioContext | null = null;
  private _bus: AudioBuses | null = null;
  private runtime: AudioRuntime | null = null;
  private volume = 1;
  private amb: AmbProxy[] = [];
  /** 解锁前最后一次 setAmbience 的淡入时长（解锁后补上 amb 里那组环境声时用） */
  private pendingFade = 1;
  private musicHandle: MusicHandle | null = null;
  private jobs: AudioJob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private reverbSends: GainNode[] = [];
  private unlocking: Promise<void> | null = null;

  /** WP1 的 Game 构造（M1a 补写）：muted = ?test=1 || ?mute=1，此时 unlock() 为空操作、ctx 永远为 null。构造时**不**创建 AudioContext。 */
  constructor(o?: { muted?: boolean }) {
    this.muted = o?.muted === true;
  }

  /** unlock 之前、或不可用时为 null，所有方法变空操作 */
  get ctx(): AudioContext | null {
    return this._ctx;
  }
  /** ctx.state === 'running'；未运行时不创建节点 */
  get running(): boolean {
    return this._ctx !== null && this._ctx.state === 'running';
  }
  get bus(): AudioBuses | null {
    return this._bus;
  }

  /** 第一次 pointerdown 或 keydown 时调用：此时才 new AudioContext() 并 resume()；之前请求的环境声在解锁后补上 */
  unlock(): Promise<void> {
    if (this.muted) return Promise.resolve();
    if (this._ctx) return this.safeResume();
    if (this.unlocking) return this.unlocking;
    this.unlocking = this.doUnlock();
    return this.unlocking;
  }
  /** 页面 hidden */
  suspend(): void {
    const c = this._ctx;
    if (!c || c.state === 'closed') return;
    c.suspend().catch(() => undefined);
  }
  /** 页面 visible */
  resume(): void {
    if (this._ctx) void this.safeResume();
  }
  /** gain 为 dB（与 AmbienceSpec 一致，默认 0）；pan -1..1；at 为世界坐标（按 setListener 定位）；rate 为音高/速度倍率 */
  sfx(cue: SfxCue, o?: { gain?: number; pan?: number; at?: V3; rate?: number }): void {
    const rt = this.runtime;
    const bus = this._bus;
    if (!rt || !bus || !this.running) return;
    const ctx = rt.ctx;
    const g = ctx.createGain();
    g.gain.value = dbToGain(o?.gain ?? 0);
    let tail: AudioNode = g;
    if (o?.at) {
      const p = this.makePanner(o.at);
      g.connect(p);
      tail = p;
    } else if (o?.pan !== undefined && o.pan !== 0) {
      const sp = ctx.createStereoPanner();
      sp.pan.value = Math.max(-1, Math.min(1, o.pan));
      g.connect(sp);
      tail = sp;
    }
    tail.connect(bus.sfx);
    const dur = playSfx(rt, cue, g, { rate: o?.rate ?? 1 });
    // 声音结束后把这条小链断开，让它被回收
    const end = ctx.currentTime + dur + 0.5;
    this.addJob(() => {
      if (ctx.currentTime < end) return true;
      tail.disconnect();
      if (tail !== g) g.disconnect();
      return false;
    });
  }
  /** 区域进入时替换整组 */
  setAmbience(specs: readonly AmbienceSpec[], fadeSec?: number): AmbienceHandle[] {
    const fade = Math.max(0, fadeSec ?? 1);
    for (const p of this.amb) p.stop(fade);
    this.amb = specs.map(s => new AmbProxy(s));
    this.pendingFade = fade;
    if (this.runtime && this._bus) for (const p of this.amb) this.startProxy(p, fade);
    return [...this.amb];
  }
  music(cue: MusicCue): void {
    const rt = this.runtime;
    const bus = this._bus;
    this.musicHandle?.stop(cue === 'stop' ? 1.5 : 0.8);
    this.musicHandle = null;
    if (cue === 'stop' || !rt || !bus || !this.running) return;
    this.musicHandle = playMusic(rt, cue, bus.music);
  }
  murmur(who: SpeakerId | '', durSec: number): void {
    const rt = this.runtime;
    const bus = this._bus;
    if (!rt || !bus || !this.running || who === '' || durSec <= 0) return;
    const voice = SPEAKERS[who].voice;
    if (voice === 'none') return;
    playMurmur(rt, voice, Math.min(durSec, 12), bus.voice);
  }
  setListener(pos: THREE.Vector3, yaw: number): void {
    const c = this._ctx;
    if (!c) return;
    const l = c.listener;
    const r = (yaw * Math.PI) / 180;
    const fx = Math.sin(r), fz = -Math.cos(r);
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = fx;
      l.forwardY.value = 0;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    }
  }
  /** 对话时压低环境声：环境声总线降 |db| 分贝，sec 秒后回到原位（新的 duck 覆盖旧的） */
  duck(db: number, sec: number): void {
    const bus = this._bus;
    if (!bus) return;
    const g = bus.ambience.gain;
    const t = bus.ambience.context.currentTime;
    const low = BUS_LEVEL.ambience * dbToGain(-Math.abs(db));
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(low, t, 0.08);
    g.setTargetAtTime(BUS_LEVEL.ambience, t + Math.max(0, sec), 0.3);
  }
  /** 主音量 0–1（settings.volume；M1a 补写） */
  setVolume(v01: number): void {
    this.volume = Number.isFinite(v01) ? Math.max(0, Math.min(1, v01)) : 1;
    const bus = this._bus;
    if (!bus) return;
    const t = bus.master.context.currentTime;
    bus.master.gain.setTargetAtTime(BUS_LEVEL.master * this.volume, t, 0.05);
  }

  // ---------------------------------------------------------------- 内部

  /** 当前环境声句柄（调试/自测用）。 */
  get ambience(): readonly AmbienceHandle[] {
    return this.amb;
  }
  /** 当前前瞻任务数（自测用：停掉的环境声会把自己的任务移除）。 */
  get jobCount(): number {
    return this.jobs.length;
  }

  private async doUnlock(): Promise<void> {
    const Ctor = typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
    if (!Ctor) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch (err) {
      devWarn('AudioContext 创建失败', err);
      return;
    }
    this._ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = BUS_LEVEL.master * this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    master.connect(comp).connect(ctx.destination);
    const mk = (v: number): GainNode => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(master);
      return g;
    };
    this._bus = { master, ambience: mk(BUS_LEVEL.ambience), sfx: mk(BUS_LEVEL.sfx), music: mk(BUS_LEVEL.music), voice: mk(BUS_LEVEL.voice) };
    const kit = createSynthKit(ctx);
    this.runtime = {
      kit,
      ctx,
      schedule: job => this.addJob(job),
      setReverb: (wet, ramp) => this.setReverb(wet, ramp),
    };
    this.timer = setInterval(() => this.tick(), TICK_MS);
    for (const p of this.amb) this.startProxy(p, this.pendingFade);
    await this.safeResume();
  }

  private async safeResume(): Promise<void> {
    const c = this._ctx;
    if (!c || c.state === 'running' || c.state === 'closed') return;
    try {
      await c.resume();
    } catch {
      // 没有用户手势时浏览器会拒绝：下一次 pointerdown/keydown 再调用 unlock() 就好
    }
  }

  private addJob(job: AudioJob): () => void {
    this.jobs.push(job);
    const c = this._ctx;
    // 立即跑一次，让第一个事件不用等下一个 tick
    if (c && !job(c.currentTime + LOOKAHEAD)) this.removeJob(job);
    return () => this.removeJob(job);
  }

  private removeJob(job: AudioJob): void {
    const i = this.jobs.indexOf(job);
    if (i >= 0) this.jobs.splice(i, 1);
  }

  private tick(): void {
    const c = this._ctx;
    if (!c || c.state !== 'running') return;
    const until = c.currentTime + LOOKAHEAD;
    for (const job of [...this.jobs]) {
      let keep = false;
      try {
        keep = job(until);
      } catch (err) {
        devWarn('audio job 出错，已移除', err);
      }
      if (!keep) this.removeJob(job);
    }
  }

  private startProxy(p: AmbProxy, fade: number): void {
    const rt = this.runtime;
    const bus = this._bus;
    if (!rt || !bus || p.isStopped) return;
    const ctx = rt.ctx;
    const wrapper = ctx.createGain();
    const t = ctx.currentTime;
    wrapper.gain.setValueAtTime(0, t);
    wrapper.gain.linearRampToValueAtTime(p.baseGain() * p.target, t + Math.max(0.02, fade));
    if ('preset' in p.spec && p.spec.at) {
      wrapper.connect(this.makePanner(p.spec.at)).connect(bus.ambience);
    } else {
      wrapper.connect(bus.ambience);
    }
    let real: AmbienceHandle;
    try {
      real = 'preset' in p.spec
        ? startAmbience(rt, p.spec.preset, wrapper, p.spec.params)
        : p.spec.custom(rt.kit, wrapper);
    } catch (err) {
      devWarn('环境声启动失败', err);
      wrapper.disconnect();
      return;
    }
    p.bind(real, wrapper);
    // 停掉后稍等淡出结束再断开包装节点
    this.addJob(() => {
      if (!p.isStopped) return true;
      const end = ctx.currentTime + p.stopFade + 1;
      this.addJob(() => {
        if (ctx.currentTime < end) return true;
        wrapper.disconnect();
        return false;
      });
      return false;
    });
  }

  private makePanner(at: V3): PannerNode {
    const c = this._ctx!;
    const p = c.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 1.5;
    p.maxDistance = 80;
    p.rolloffFactor = 1.1;
    p.positionX.value = at[0];
    p.positionY.value = at[1];
    p.positionZ.value = at[2];
    return p;
  }

  private setReverb(wet: number, rampSec: number): void {
    const rt = this.runtime;
    const bus = this._bus;
    if (!rt || !bus) return;
    const ctx = rt.ctx;
    if (this.reverbSends.length === 0) {
      if (wet <= 0) return;
      const conv = ctx.createConvolver();
      // GDD §9.5：程序生成 3 秒指数衰减噪声作脉冲响应
      conv.buffer = rt.kit.impulse(3, 2.6);
      const ret = ctx.createGain();
      ret.gain.value = 0.8;
      conv.connect(ret).connect(bus.master);
      for (const src of [bus.ambience, bus.sfx, bus.voice]) {
        const s = ctx.createGain();
        s.gain.value = 0;
        src.connect(s).connect(conv);
        this.reverbSends.push(s);
      }
    }
    const t = ctx.currentTime;
    for (const s of this.reverbSends) {
      s.gain.cancelScheduledValues(t);
      s.gain.setValueAtTime(s.gain.value, t);
      s.gain.linearRampToValueAtTime(Math.max(0, wet), t + Math.max(0.02, rampSec));
    }
  }

  /** 关掉一切（测试页用；游戏里不调用）。 */
  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.jobs = [];
    const c = this._ctx;
    this._ctx = null;
    this._bus = null;
    this.runtime = null;
    if (c) c.close().catch(() => undefined);
  }
}
