// owner: WP4
// 提示（ARCH §6.17；GDD §3.12）：当前谜题、三级提示、追加提示（南柯接在 P14 后面）、空闲闪烁。
//
// 实现要点（WP4）：
// - current()：带 appendTo 的谜题不参与；候选 = available && !done；优先当前区域的第一个，否则第一个（按 order）。
// - request()（H 键）：每题各自记“已看到第几级、何时看的”（游戏时间）。第 1 级随时可看；距上一级 ≥ 60 秒才给下一级，
//   否则重复当前级；settings.hintNoCooldown 取消冷却。候选为空 → 依次轮换土地闲话（STRINGS.tudiIdle），level 恒 1。
// - 追加提示：appendTo.puzzle === 当前谜题且 appendTo.when 为真（且追加者自身 available && !done）时，给同级提示，
//   共用宿主的级别与冷却（南柯：when = 'ants >= 1 && ants < 6'）。
// - 显示：土地说话的字幕（speaker = npc.tudi），同时发 'feedback'。
// - 空闲闪烁：只在栈顶是 explore/viewfinder 时累计；每次 'flag'/'interact' 清零；满 120 秒让当前谜题 target 的角标闪一次，然后重新计时。

import type { ApiResult, AreaId } from '../core/types';
import { ok } from '../core/types';
import type { InteractId, PuzzleId, ReplayPointId } from '../data/ids';
import { NPC } from '../data/ids';
import { STRINGS } from '../data/strings';
import { TIMING } from '../data/time';
import type { Game } from '../core/game';
import type { StateView } from './state';
import type { Cond } from './expr';
import { compileCond } from './expr';
import { speak } from './effects';
import { devAssert } from '../core/log';

export interface PuzzleDef {
  /** P1=1 … P14=14，H=15 */
  id: PuzzleId; order: number;
  area: AreaId;
  available: Cond; done: Cond;
  hints: readonly [string, string, string];
  /** 不参与当前谜题计算；当 current() === puzzle 且 when 为真时，把本谜题同级提示接在它后面 */
  appendTo?: { puzzle: PuzzleId; when: Cond };
  /** 空闲闪烁的目标 */
  target?: (s: StateView) => InteractId | ReplayPointId | undefined;
  /**
   * M4 补写：谜题内的阶段（0 起，按状态现算）。P1 这种要经过好几步的谜题，玩家卡在后面的步骤时，
   * 第 1、2 级不该还在说已经做完的那一步——阶段一变，H 就从该阶段的第 1 级重新给（每个阶段各自记级别与冷却）。
   */
  stage?: (s: StateView) => number;
  /** M4 补写：按阶段分组的三级提示；stageHints[stage] 缺省（或越界）时退回 hints */
  stageHints?: readonly (readonly [string, string, string] | undefined)[];
  /** M4 补写（最小改法）：此刻至少从第几级给，例如 P1 门灯亮了以后直接从第 3 级给 */
  minLevel?: (s: StateView) => 1 | 2 | 3;
}

/** 某谜题某阶段的第 level 级提示（stageHints 缺省时退回 hints；M4）。 */
function hintText(d: PuzzleDef, stage: number, level: 1 | 2 | 3): string {
  const set = d.stageHints?.[stage] ?? d.hints;
  return set[level - 1] ?? d.hints[level - 1]!;
}

export type HintResult = ApiResult<{ puzzle: PuzzleId | null; level: 1 | 2 | 3; text: string; appended?: { puzzle: PuzzleId; text: string } }>;

interface P {
  def: PuzzleDef;
  available: (s: StateView) => boolean;
  done: (s: StateView) => boolean;
  appendWhen: ((s: StateView) => boolean) | null;
}

export class HintSystem {
  protected readonly game: Game;
  private puzzles: P[] = [];
  /** 每题（M4：每题每阶段，键 `${id}#${stage}`）已看到的级别与时间（游戏时间，不存档） */
  private readonly seenLevel = new Map<string, { level: 1 | 2 | 3; at: number }>();
  private idle = 0;
  private idleCount = 0;

  constructor(game: Game) {
    this.game = game;
    game.events.on('flag', () => { this.idle = 0; });
    game.events.on('interact', () => { this.idle = 0; });
  }

  /** 启动时由 AreaManager 汇总全部区域的 AreaDef.puzzles 登记，按 order 排序 */
  register(puzzles: readonly PuzzleDef[]): void {
    for (const d of puzzles) {
      devAssert(!this.puzzles.some(p => p.def.id === d.id), `HintSystem.register: 谜题 '${d.id}' 重复`);
      this.puzzles.push({
        def: d,
        available: compileCond(d.available, `puzzle ${d.id}.available`),
        done: compileCond(d.done, `puzzle ${d.id}.done`),
        appendWhen: d.appendTo ? compileCond(d.appendTo.when, `puzzle ${d.id}.appendTo`) : null,
      });
    }
    this.puzzles.sort((a, b) => a.def.order - b.def.order);
  }
  /** GDD §3.12：可用未完成者（不含带 appendTo 的）中优先本区域，否则第一个 */
  current(): PuzzleId | null {
    const s = this.game.state;
    const cands = this.puzzles.filter(p => !p.def.appendTo && p.available(s) && !p.done(s));
    if (cands.length === 0) return null;
    const area = s.area;
    return (cands.find(p => p.def.area === area) ?? cands[0]!).def.id;
  }
  /** H 键；候选为空 → 土地闲话 */
  request(): HintResult {
    const id = this.current();
    if (id === null) {
      const lines = STRINGS.tudiIdle;
      const text = lines[this.idleCount++ % lines.length]!;
      speak(this.game, text, NPC.TUDI, undefined, 'hint');
      return ok({ puzzle: null, level: 1, text });
    }
    const p = this.puzzles.find(x => x.def.id === id)!;
    const s = this.game.state;
    const now = this.game.time;
    const stage = p.def.stage?.(s) ?? 0;
    const key = `${id}#${stage}`;
    const prev = this.seenLevel.get(key);
    const min = p.def.minLevel?.(s) ?? 1;
    let level: 1 | 2 | 3 = min;
    let repeat = false;
    if (prev) {
      const ready = this.game.settings.hintNoCooldown || now - prev.at >= TIMING.hintCooldownSec - 1e-6;
      level = prev.level < 3 && ready ? ((prev.level + 1) as 2 | 3) : prev.level;
      if (level < min) level = min;
      repeat = level === prev.level;
    }
    if (!prev || level !== prev.level) this.seenLevel.set(key, { level, at: now });
    const text = hintText(p.def, stage, level);
    const app = this.puzzles.find(x => x.def.appendTo?.puzzle === id && x.appendWhen !== null && x.appendWhen(s) && x.available(s) && !x.done(s));
    const appText = app ? hintText(app.def, app.def.stage?.(s) ?? 0, level) : null;
    // M4：冷却中重复同一级时告诉玩家稍后能问得更细（第 3 级不再追加）
    const later = repeat && level < 3 && !this.game.settings.hintNoCooldown ? STRINGS.feedback.hintLater : '';
    // M4 第 2 轮：提示字幕带 kind 'hint'，新提示替换屏幕上的旧提示（连按 H 不再叠两行）
    speak(this.game, `${appText !== null ? `${text}\n${appText}` : text}${later}`, NPC.TUDI, undefined, 'hint');
    if (app && appText !== null) return ok({ puzzle: id, level, text, appended: { puzzle: app.def.id, text: appText } });
    return ok({ puzzle: id, level, text });
  }
  /** 只在 explore/viewfinder 下累计：120 秒无 flag 变化且无交互 → 目标角标闪一次 */
  update(dt: number): void {
    const top = this.game.modes.top;
    if (top !== 'mode.explore' && top !== 'mode.viewfinder') return;
    this.idle += dt;
    if (this.idle < TIMING.hintIdleSec) return;
    this.idle = 0;
    const id = this.current();
    if (id === null) return;
    const target = this.puzzles.find(x => x.def.id === id)?.def.target?.(this.game.state);
    // 残影点没有角标（旋涡只在取景器里可见），只闪交互物
    if (target && !target.startsWith('rp.')) this.game.sys.interaction.blink(target as InteractId);
  }

  // ——————————————————————————————— WP4 内部（非冻结签名）

  /** 空闲计时（自测用）。 */
  get idleSec(): number {
    return this.idle;
  }
  /** 新游戏/读档时清掉提示进度（提示计时不存档，GDD §3.13）。 */
  resetProgress(): void {
    this.seenLevel.clear();
    this.idle = 0;
  }
}
