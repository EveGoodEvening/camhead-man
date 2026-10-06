// owner: WP1
// 模式栈（ARCH §4.6、附录 A）。

import type { ApiResult, ModeId } from './types';
import { fail, ok } from './types';
import type { Action, ActionResult } from './actions';
import type { PointerPolicy } from './input';
import type { Game } from './game';
import { devAssert } from './log';

export type ModeCamera = 'tp' | 'fp' | 'fixed' | 'inherit';
export type ModeMove = 'normal' | 'slow' | 'body' | 'none';

export interface ModeHandler {
  readonly id: ModeId;
  /** replay、panel_…、dialogue、cutscene、tripod、album、journal 为 true：推迟存档（GDD §3.13） */
  readonly transient: boolean;
  /** pause/album/journal 为 true：栈顶时 step 跳过模拟（ARCH §3.2） */
  readonly freezesWorld: boolean;
  /** 见 ARCH §4.6 策略表；viewfinder 叠在面板上时为 'free' */
  readonly pointer: PointerPolicy | ((stack: readonly ModeId[]) => PointerPolicy);
  readonly camera: ModeCamera;
  /** viewfinder 叠在面板上时为 'none'（M1a：允许按栈求值，与 look/pointer 相同） */
  readonly move: ModeMove | ((stack: readonly ModeId[]) => ModeMove);
  /** viewfinder 叠在面板上时为 false */
  readonly look: boolean | ((stack: readonly ModeId[]) => boolean);
  enter(prev: ModeId | null, arg?: unknown): void;
  exit(next: ModeId | null): void;
  /** 不合法返回 { ok:false, reason:'mode_disallows' } */
  handle(a: Action): ActionResult;
  update?(dt: number): void;
}

interface Entry { id: ModeId; arg: unknown }

const PANELS: readonly ModeId[] = ['mode.panel_vcr', 'mode.panel_console'];
/** popToBase 不弹的模式：它们由各自系统结束（ARCH §4.6）。 */
const SELF_ENDING: readonly ModeId[] = ['mode.dialogue', 'mode.cutscene', 'mode.tripod'];

export class ModeStack {
  protected readonly game: Game;
  private readonly handlers = new Map<ModeId, ModeHandler>();
  /** 底部永远是 explore（不调用它的 enter：它不是被“进入”的，而是一直在） */
  private entries: Entry[] = [{ id: 'mode.explore', arg: undefined }];
  /** 正在逐层 exit（resetTo）时，handler 在 exit 里再调 pop/push 不应打乱遍历 */
  private resetting = false;

  constructor(game: Game) {
    this.game = game;
  }

  /** 登记一个模式处理器（Game 构造时为 13 个模式各登记一次；同 id 重复登记在 dev 下抛错）。 */
  register(h: ModeHandler): void {
    devAssert(!this.handlers.has(h.id), `ModeStack.register: ${h.id} 重复登记`);
    this.handlers.set(h.id, h);
  }
  /** 已登记的处理器。 */
  handler(id: ModeId): ModeHandler | undefined {
    return this.handlers.get(id);
  }

  get top(): ModeId {
    return this.entries[this.entries.length - 1]!.id;
  }
  /** 底部永远是 mode.explore */
  get stack(): readonly ModeId[] {
    return this.entries.map(e => e.id);
  }
  has(id: ModeId): boolean {
    return this.entries.some(e => e.id === id);
  }
  /** 该模式进入时的参数（如 album 的 pick）；同一模式在栈上出现多次时取最上面的一层 */
  arg<T>(id: ModeId): T | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i]!.id === id) return this.entries[i]!.arg as T | undefined;
    return undefined;
  }

  push(id: ModeId, arg?: unknown): ApiResult {
    if (id === 'mode.explore') return fail('bad_args');
    const h = this.handlers.get(id);
    if (!h) return fail('mode_disallows');
    // 暂停不叠两层（意外解锁与 Esc 键可能先后到达）
    if (id === 'mode.pause' && this.top === 'mode.pause') return fail('mode_disallows');
    const prev = this.top;
    this.entries.push({ id, arg });
    h.enter(prev, arg);
    this.changed(prev);
    return ok();
  }

  pop(expect?: ModeId): ApiResult {
    if (this.entries.length <= 1) return fail('mode_disallows');
    const top = this.top;
    if (expect !== undefined && top !== expect) return fail('mode_disallows');
    // 先出栈再 exit：exit 里若再调 pop(自己) 会拿到 mode_disallows 而不是弹掉下一层
    this.entries.pop();
    const next = this.top;
    this.handlers.get(top)?.exit(next);
    this.changed(top);
    return ok();
  }

  /**
   * 弹到 explore 或 viewfinder（回放 → viewfinder）；不弹对话/过场/三脚架（它们由各自系统结束）。
   * 只有直接叠在 explore 上的取景器才算“底”：叠在面板上的取景器是面板的一部分，随面板一起弹掉。
   */
  popToBase(): void {
    for (let guard = 0; guard < 32; guard++) {
      const top = this.top;
      if (top === 'mode.explore' || SELF_ENDING.includes(top)) return;
      if (top === 'mode.viewfinder' && this.entries.length === 2) return;
      if (!this.pop(top).ok) return;
    }
  }

  /** 先 effects.cancelAll('reset')，再逐层 exit */
  resetTo(_id: 'mode.explore'): void {
    if (this.resetting) return;
    this.resetting = true;
    try {
      this.game.effects.cancelAll('reset');
      // 回放在模式重置时以 'mode' 退出（ARCH §6.9；ReplayMode.exit 通常也会做，这里保证即使回放模式已不在栈上也复原）
      if (this.game.sys.replay.active) this.game.sys.replay.exit('mode');
      const first = this.top;
      while (this.entries.length > 1) {
        const top = this.top;
        this.entries.pop();
        this.handlers.get(top)?.exit(this.top);
      }
      if (first !== 'mode.explore') this.changed(first);
    } finally {
      this.resetting = false;
    }
  }

  /** 栈顶 handle；pass=true 时交给下一层（例如 H 在各模式都可用） */
  dispatch(a: Action): ActionResult {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const h = this.handlers.get(this.entries[i]!.id);
      if (!h) continue;
      const r = h.handle(a);
      if (!r.pass) return r;
    }
    return fail('mode_disallows');
  }

  /** 栈上任一模式 transient */
  isTransient(): boolean {
    return this.entries.some(e => this.handlers.get(e.id)?.transient === true);
  }
  /** 栈顶模式 freezesWorld */
  freezesWorld(): boolean {
    return this.handlers.get(this.top)?.freezesWorld === true;
  }
  /** 栈顶（按栈求值后）的移动方式与视角是否可用（Game.step 用）。 */
  moveMode(): ModeMove {
    const h = this.handlers.get(this.top);
    if (!h) return this.top === 'mode.explore' ? 'normal' : 'none';
    return typeof h.move === 'function' ? h.move(this.stack) : h.move;
  }
  lookEnabled(): boolean {
    const h = this.handlers.get(this.top);
    if (!h) return this.top === 'mode.explore';
    return typeof h.look === 'function' ? h.look(this.stack) : h.look;
  }

  /**
   * 每帧调用栈顶（及 overlay 允许的下层）模式的 update。
   * “overlay 允许的下层”：取景器叠在面板上时面板照常更新；回放叠在取景器上时取景器照常更新（回放是取景器的子状态）。
   */
  update(dt: number): void {
    const ids = this.stack;
    let i = ids.length - 1;
    const run: ModeId[] = [ids[i]!];
    while (i > 0) {
      const upper = ids[i]!;
      const lower = ids[i - 1]!;
      const overlay = (upper === 'mode.viewfinder' && PANELS.includes(lower)) || (upper === 'mode.replay' && lower === 'mode.viewfinder');
      if (!overlay) break;
      run.push(lower);
      i--;
    }
    for (const id of run.reverse()) this.handlers.get(id)?.update?.(dt);
  }

  // ---------------------------------------------------------------- WP1 内部
  /** 当前栈顶的指针策略（按栈求值）。 */
  pointerPolicy(): PointerPolicy {
    const h = this.handlers.get(this.top);
    if (!h) return 'lock';
    return typeof h.pointer === 'function' ? h.pointer(this.stack) : h.pointer;
  }

  /** 按栈求值当前应使用的主相机：自顶向下第一个不是 'inherit' 的。 */
  cameraFor(): 'tp' | 'fp' | 'fixed' {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const c = this.handlers.get(this.entries[i]!.id)?.camera;
      if (c && c !== 'inherit') return c;
    }
    return 'tp';
  }

  /** 重新应用指针策略与相机（进区域后、模式变化后）。 */
  refresh(): void {
    this.game.cameras.active = this.cameraFor();
    this.game.input.applyPolicy(this.pointerPolicy());
  }

  private changed(prev: ModeId): void {
    if (this.resetting && this.entries.length > 1) return;
    this.refresh();
    this.game.events.emit('mode', { top: this.top, prev, stack: this.stack });
  }
}
