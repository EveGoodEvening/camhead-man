// owner: WP1
// 触发体积（ARCH §11.2）：AABB 触发体积、出入口触发、出生点距离断言。

import type { V3 } from './types';
import type { SpawnId } from '../data/ids';
import type { Cond } from '../game/expr';
import { compileCond } from '../game/expr';
import type { GameApi, Handler } from '../game/effects';
import type { StateView } from '../game/state';
import type { SpawnDef } from './area';
import type { Game } from './game';

export interface TriggerDef {
  key: string;
  box: { center: V3; size: V3 };
  when?: Cond;
  once?: boolean;
  onEnter?: Handler;
  onExit?: Handler;
  onStay?: (g: GameApi, dt: number) => void;
}
export interface TriggerHandle { remove(): void; setEnabled(on: boolean): void }

/** 出生点到触发体边缘的最小距离（GDD §4 开头、§13.2）。 */
export const SPAWN_CLEARANCE = 0.8;

/** 点到轴对齐盒子的 3D 距离（点在盒内为 0）。WP1 内部。 */
export function pointBoxDistance(p: V3, box: { center: V3; size: V3 }): number {
  let d2 = 0;
  for (let i = 0; i < 3; i++) {
    const h = Math.abs(box.size[i]!) / 2;
    const d = Math.abs(p[i]! - box.center[i]!) - h;
    if (d > 0) d2 += d * d;
  }
  return Math.sqrt(d2);
}

/** 出生点离一组触发体太近的违规描述（启动期静态校验与 finalize 共用）。WP1 内部。 */
export function spawnClearanceIssues(
  spawns: Readonly<Partial<Record<SpawnId, SpawnDef>>>, boxes: readonly { key: string; box: { center: V3; size: V3 } }[],
): string[] {
  const out: string[] = [];
  for (const [id, s] of Object.entries(spawns) as [SpawnId, SpawnDef | undefined][]) {
    if (!s) continue;
    for (const b of boxes) {
      const d = pointBoxDistance(s.pos, b.box);
      if (d < SPAWN_CLEARANCE - 1e-6) out.push(`${id} 离触发体 ${b.key} 边缘 ${d.toFixed(2)}m < ${SPAWN_CLEARANCE}m`);
    }
  }
  return out;
}

interface Entry {
  key: string;
  box: { center: V3; size: V3 };
  min: V3;
  max: V3;
  when: ((s: StateView) => boolean) | null;
  once: boolean;
  onEnter?: Handler;
  onExit?: Handler;
  onStay?: (g: GameApi, dt: number) => void;
  /** 出入口：不走 EffectRunner，直接回调（AreaManager.travel 会取消全部 Effect，不能在某个 run 里面执行） */
  direct?: () => void;
  enabled: boolean;
  inside: boolean;
  alive: boolean;
}

export class TriggerSystem {
  protected readonly game: Game;
  private list: Entry[] = [];

  constructor(game: Game) {
    this.game = game;
  }

  /** ctx.trigger() 与 AreaDef.exits 自动生成的出入口触发体都走这里 */
  add(d: TriggerDef): TriggerHandle {
    const e = this.make(d.key, d.box);
    e.when = d.when === undefined ? null : compileCond(d.when, `trigger:${d.key}`);
    e.once = d.once === true;
    if (d.onEnter) e.onEnter = d.onEnter;
    if (d.onExit) e.onExit = d.onExit;
    if (d.onStay) e.onStay = d.onStay;
    return this.handle(e);
  }

  /** 每个子步：玩家胶囊与各 AABB 求交，发 onEnter/onExit/onStay（when 为假的不触发） */
  update(): void {
    if (this.list.length === 0) return;
    const cap = this.game.player.capsule;
    const dt = this.game.frameDt();
    for (const e of [...this.list]) {
      if (!e.alive) continue;
      let inside = false;
      if (e.enabled && capsuleTouchesBox(cap.start.x, Math.min(cap.start.y, cap.end.y), Math.max(cap.start.y, cap.end.y), cap.start.z, cap.radius, e.min, e.max)) {
        inside = e.when ? this.evalWhen(e) : true;
      }
      if (inside && !e.inside) {
        e.inside = true;
        this.fire(e, 'enter');
        if (e.once) e.alive = false;
      } else if (!inside && e.inside) {
        e.inside = false;
        this.fire(e, 'exit');
      } else if (inside && e.onStay) {
        try {
          e.onStay(this.game.api, dt);
        } catch (err) {
          console.error(`[TriggerSystem] ${e.key} onStay`, err);
        }
      }
    }
    this.list = this.list.filter(e => e.alive);
  }

  /** 出生点到任一触发体边缘 ≥ 0.8m；返回违规列表（dev 下非空即抛错，core.mjs 逐区检查） */
  assertSpawnClearance(spawns: Readonly<Partial<Record<SpawnId, SpawnDef>>>): string[] {
    return spawnClearanceIssues(spawns, this.list.filter(e => e.alive));
  }

  clearArea(): void {
    for (const e of this.list) e.alive = false;
    this.list = [];
  }

  // ---------------------------------------------------------------- WP1 内部
  /** 出入口触发体（AreaManager.enter 登记）：进入时直接回调，不经 EffectRunner、不看 when（when 由 travel 检查并给 blocked 反馈）。 */
  addDirect(key: string, box: { center: V3; size: V3 }, cb: () => void): TriggerHandle {
    const e = this.make(key, box);
    e.direct = cb;
    return this.handle(e);
  }

  /** 当前登记的触发体（调试与自测）。 */
  keys(): string[] {
    return this.list.filter(e => e.alive).map(e => e.key);
  }

  /** 传送后把“是否在内”按新位置重置，但不发事件（出生点、goto 落点不应触发脚下的触发体两次）。 */
  resync(): void {
    const cap = this.game.player.capsule;
    for (const e of this.list) {
      e.inside = e.enabled && capsuleTouchesBox(cap.start.x, Math.min(cap.start.y, cap.end.y), Math.max(cap.start.y, cap.end.y), cap.start.z, cap.radius, e.min, e.max) && (e.when ? this.evalWhen(e) : true);
    }
  }

  private make(key: string, box: { center: V3; size: V3 }): Entry {
    const h = box.size.map(v => Math.abs(v) / 2);
    const e: Entry = {
      key, box,
      min: [box.center[0] - h[0]!, box.center[1] - h[1]!, box.center[2] - h[2]!],
      max: [box.center[0] + h[0]!, box.center[1] + h[1]!, box.center[2] + h[2]!],
      when: null, once: false, enabled: true, inside: false, alive: true,
    };
    this.list.push(e);
    return e;
  }

  private handle(e: Entry): TriggerHandle {
    return {
      remove: () => {
        e.alive = false;
        this.list = this.list.filter(x => x !== e);
      },
      setEnabled: (on: boolean) => {
        e.enabled = on;
        // 停用时静默复位：重新启用后若人仍在里面，按一次新的进入处理
        if (!on) e.inside = false;
      },
    };
  }

  private evalWhen(e: Entry): boolean {
    try {
      return e.when!(this.game.state);
    } catch (err) {
      console.error(`[TriggerSystem] ${e.key} when`, err);
      return false;
    }
  }

  private fire(e: Entry, what: 'enter' | 'exit'): void {
    if (e.direct) {
      if (what === 'enter') e.direct();
      return;
    }
    const h = what === 'enter' ? e.onEnter : e.onExit;
    if (!h) return;
    // 触发器是独立来源的顶层 run：排队执行（ARCH §6.3）
    this.game.effects.runHandler(h, `trigger:${e.key}:${what}`).catch(err => console.error(`[TriggerSystem] ${e.key} ${what}`, err));
  }
}

/** 竖直胶囊（轴 x/z 固定，y 从 y0 到 y1，半径 r）与 AABB 是否接触。 */
function capsuleTouchesBox(x: number, y0: number, y1: number, z: number, r: number, min: V3, max: V3): boolean {
  const dx = x < min[0] ? min[0] - x : x > max[0] ? x - max[0] : 0;
  const dz = z < min[2] ? min[2] - z : z > max[2] ? z - max[2] : 0;
  const dy = y1 < min[1] ? min[1] - y1 : y0 > max[1] ? y0 - max[1] : 0;
  return dx * dx + dy * dy + dz * dz <= r * r;
}
