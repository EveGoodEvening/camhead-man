// owner: integrator
// （M1a 写全量并冻结；此后只有整合代理/引擎维护者能改，ARCH §2.12）
// 强类型事件总线（ARCH §4.3）。区域里用 ctx.on(type, fn) 订阅，卸载时自动解绑。

import type * as THREE from 'three';
import type { AreaKey, LensMode, ModeId, Shichen, Verb, ZoomLevel } from './types';
import type {
  CutsceneId, DialogueId, FlagId, InteractId, ItemId, PhotoTargetId, ReadId, ReplayPointId, SegmentId, SpeakerId, ThingId,
} from '../data/ids';
import type { PhotoRecord } from '../game/state';
import type { PhotoContext } from '../game/photo';
import type { Settings } from '../game/settings';

export interface GameEvents {
  'flag': { id: FlagId; value: boolean | number; prev: boolean | number };
  'item': { id: ItemId; kind: 'added' | 'used' };
  'photo': { record: PhotoRecord; hit: PhotoTargetId | null };
  /** 取景器每按一次快门都发（含空镜、面板叠加时）；三脚架与过场里的快门不发 */
  'shutter': { area: AreaKey; pos: THREE.Vector3; context: PhotoContext; lens: LensMode };
  'interact': { id: InteractId; verb: Verb; thing?: ThingId; accepted: boolean };
  /** 任何反馈/旁白/字幕文本（测试断言用） */
  'feedback': { text: string; speaker?: SpeakerId };
  'mode': { top: ModeId; prev: ModeId | null; stack: readonly ModeId[] };
  'area:enter': { id: AreaKey; spawn: string; from: AreaKey | null };
  'area:exit': { id: AreaKey };
  'shichen': { now: Shichen; prev: Shichen };
  /**
   * M4：时辰字卡与远钟真正播出的那一刻（'shichen' 在 flag 变化的同一帧发，NPC/灯光立即对账；字卡要等过场、对话、面板都结束，
   * 免得“丑时/寅时”大字叠在本相揭示、读信、讨封这些画面上）。HUD 左下角时辰字样的强调跟着它。
   */
  'shichen:card': { now: Shichen };
  'viewfinder': { on: boolean };
  'lens': { lens: LensMode };
  'zoom': { zoom: ZoomLevel };
  'read': { id: ReadId };
  'replay:start': { point: ReplayPointId; seg: SegmentId };
  'replay:complete': { seg: SegmentId };
  'replay:end': { point: ReplayPointId; reason: 'exit' | 'walked_out' | 'mode' };
  /** 播放头移动（含 seek） */
  'vcr:tc': { tc: number; from: number };
  'cctv:channel': { channel: 1 | 2 | 3 | 4 | 5 };
  'jack': { plugged: boolean };
  'dialogue:start': { id: DialogueId };
  'dialogue:end': { id: DialogueId };
  'cutscene:start': { id: CutsceneId };
  'cutscene:end': { id: CutsceneId };
  'journal:page': { index: number };
  'save': { slot: 'save.auto' | 'save.yin' };
  /** GameApi.endingDone（E.ending）发出：主结局片尾或南柯段落播完 */
  'ending': { kind: 'main' | 'nanke' };
  /** 设置变化（reduceFlash、colorAssist、quality…） */
  'settings': { key: keyof Settings; value: unknown };
  /** 区域临时状态变化（ARCH §11.2），NPC 与条件据此重新求值 */
  'temp': { area: AreaKey; key: string; value: boolean | number };
  /** 仅调试面板使用；区域不要订阅 */
  'frame': { dt: number };
}

type Listener = (e: unknown) => void;

/** 同步派发的强类型事件总线；监听器抛错只记录（console.error）不中断派发。 */
export class EventBus<E> {
  private readonly listeners = new Map<keyof E, Set<Listener>>();

  /** 订阅；返回取消订阅函数。 */
  on<K extends keyof E>(type: K, fn: (e: E[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const l = fn as unknown as Listener;
    set.add(l);
    return () => {
      set.delete(l);
    };
  }

  /** 只触发一次的订阅；返回取消订阅函数。 */
  once<K extends keyof E>(type: K, fn: (e: E[K]) => void): () => void {
    const off = this.on(type, e => {
      off();
      fn(e);
    });
    return off;
  }

  /** 同步派发；派发过程中新增/移除的监听器不影响本次派发。 */
  emit<K extends keyof E>(type: K, e: E[K]): void {
    const set = this.listeners.get(type);
    if (!set || set.size === 0) return;
    for (const l of [...set]) {
      try {
        l(e);
      } catch (err) {
        console.error(`[events] listener for '${String(type)}' threw`, err);
      }
    }
  }

  /** 当前监听器数量（调试与资源回收检查用）。 */
  listenerCount(type?: keyof E): number {
    if (type !== undefined) return this.listeners.get(type)?.size ?? 0;
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }

  /** 移除全部监听器。 */
  clear(): void {
    this.listeners.clear();
  }
}
