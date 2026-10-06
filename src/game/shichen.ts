// owner: WP4
// 时辰（ARCH §6.5；GDD §3.10）：时辰推导、HUD 钟点、时辰过场。
//
// 钟点用“夜间秒”表示：当日秒数，00:00–11:59 再加 86400，这样 23:40→00:59 是连续递增的（跨午夜不回绕）。
// 子时从 23:40 起每 20 游戏秒走 1 分钟，停在 00:59:59；丑时 01:05、寅时 03:05 起每 10 秒 1 分钟，停在 02:59:59、04:59:59。
// 秒随钟点连续走（OSD 的秒按游戏时间走，冻结时不动）。卯时由 override 驱动（结局加速钟），override(null) 交还后钟停在当前值。
// 推导值变化只在 'flag' 事件里判断（→ 发 'shichen' + 钟点从新时辰起点走；M4：2 秒时辰过场——远钟与大字——挂起到过场/对话/面板结束后
// 才播，并发 'shichen:card'）；读档/新游戏/调试 debugSet
// 不发 'flag'，update() 发现推导值与记录不符时静默对账（不播过场），等价于 resetClock()。

import type { Shichen } from '../core/types';
import { F } from '../data/ids';
import { DAWN_CLOCK, MAO_HUD_SWITCH, SHICHEN_CLOCK, SHICHEN_TRANSITION_SEC, osdDateForClock } from '../data/time';
import { STRINGS } from '../data/strings';
import { parseTc } from '../core/math';
import type { Game } from '../core/game';
import type { StateView } from './state';

/** GDD §3.10 原样（M1a 已实现）。 */
export function deriveShichen(s: Pick<StateView, 'flag'>): Shichen {
  if (s.flag(F.R1_SOUL_RETURNED)) return 'mao';
  if (s.flag(F.R4_GOT_TAPE)) return 'yin';
  if (s.flag(F.R2_WANG_DONE) && s.flag(F.R3_SAW_TRUE_FORM)) return 'chou';
  return 'zi';
}

const DAY = 86400;
/** M4：字卡等到“风平浪静”持续这么久再播（游戏秒） */
const CARD_CALM_SEC = 0.5;
/** 'HH:MM[:SS]' → 夜间秒（12:00 之前的钟点加一天）。 */
export function nightSec(tc: string): number {
  const s = parseTc(tc);
  return s < 12 * 3600 ? s + DAY : s;
}
const pad2 = (n: number): string => String(n).padStart(2, '0');

export class ShichenSystem {
  protected readonly game: Game;
  private last: Shichen | null = null;
  /** 当前钟点（夜间秒，含小数） */
  private clock = nightSec(SHICHEN_CLOCK.zi.start);
  private overrideRate: number | null = null;
  private overrideStop = Infinity;
  /** 时辰过场剩余秒（游戏时间） */
  private transitionLeft = 0;
  /** M4：等着播的时辰字卡（过场、对话、面板结束后再播远钟与大字） */
  private pendingCard: Shichen | null = null;
  /** M4：“可以播字卡”的状态已经持续了多久（游戏秒；刚结束一段过场、紧接着又开对话时不抢这个空档） */
  private calmFor = 0;

  constructor(game: Game) {
    this.game = game;
    game.events.on('flag', () => this.onFlag());
  }

  get current(): Shichen {
    return deriveShichen(this.game.state);
  }
  /** HUD 字样：子时/丑时/寅时/卯时；推导值已是 mao 时，钟点到 05:00 才从“寅时”换成“卯时” */
  hudLabel(): string {
    const cur = this.current;
    if (cur === 'mao' && this.clock < nightSec(MAO_HUD_SWITCH)) return STRINGS.shichen.yin;
    return STRINGS.shichen[cur];
  }
  /** 'HH:MM'，按 data/time.ts 的钟点表（GDD §3.10） */
  clockText(): string {
    const t = Math.floor(this.clock) % DAY;
    return `${pad2(Math.floor(t / 3600))}:${pad2(Math.floor((t % 3600) / 60))}`;
  }
  /** 'HH:MM:SS'（M3 补写：GameApi.shichen.clock 的实现；与 HUD、OSD 同源） */
  clockSeconds(): string {
    const t = Math.floor(this.clock) % DAY;
    return `${this.clockText()}:${pad2(t % 60)}`;
  }
  /** 00:00 前 '2026-08-27 周四'，之后 '2026-08-28 周五' */
  osdDate(): string {
    return osdDateForClock(Math.floor(this.clock));
  }
  /** 'CH1 2026-08-27 周四 23:41:07'（秒按游戏时间走） */
  osdLine(channel = 1): string {
    const t = Math.floor(this.clock) % DAY;
    return `CH${channel} ${this.osdDate()} ${this.clockText()}:${pad2(t % 60)}`;
  }
  /** 冻结时不调用；监听 'flag'：推导值变化 → 发 'shichen' → 2 秒时辰过场（远钟 + HUD 字样），不重建当前区域 */
  update(dt: number): void {
    const cur = this.current;
    if (this.last !== cur) this.resync(cur);   // 读档/新游戏/debugSet：静默对账
    if (this.transitionLeft > 0) this.transitionLeft = Math.max(0, this.transitionLeft - dt);
    this.flushCard(dt);
    if (this.overrideRate !== null) {
      this.clock = Math.min(this.overrideStop, this.clock + dt * this.overrideRate);
      return;
    }
    if (cur === 'mao') return;                   // 卯时只由 override 驱动
    const c = SHICHEN_CLOCK[cur];
    const stop = nightSec(c.stop) + 59;
    this.clock = Math.min(stop, this.clock + (dt * 60) / c.secPerMin);
  }
  /** 结局加速钟（04:58:00→05:12:00，12 秒真实用时 = 70 钟秒/秒）由 r1 过场驱动；null = 交还时辰钟 */
  override(clock: string | null, rate?: number): void {
    if (clock === null) {
      this.overrideRate = null;
      this.overrideStop = Infinity;
      return;
    }
    this.clock = nightSec(clock);
    this.overrideRate = rate ?? DAWN_CLOCK.rate;
    // 从加速钟起点之前开始时，停在 05:12:00（dt 量化不会冲过头）
    const to = nightSec(DAWN_CLOCK.to);
    this.overrideStop = this.clock <= to ? to : Infinity;
  }
  /** 从当前时辰起点重新走钟（新游戏/读档后；M1a 补写） */
  resetClock(): void {
    this.resync(this.current);
  }

  // ——————————————————————————————— WP4 内部（非冻结签名）

  /** 时辰过场是否在播（HUD 可据此显示大字）。 */
  get transitioning(): boolean {
    return this.transitionLeft > 0;
  }

  /**
   * M4：挂起的时辰字卡在“风平浪静”时播：栈顶是 explore/viewfinder、栈上没有过场/对话/面板/三脚架、不在加载、
   * runner 空闲（或只是在等玩家），且这种状态持续 0.5 秒。
   */
  private flushCard(dt: number): void {
    if (this.pendingCard === null) return;
    const g = this.game;
    const m = g.modes;
    const top = m.top;
    // 自测里的迷你 Game 没有 effects/isLoading：当作空闲
    const eff = (g as { effects?: Game['effects'] }).effects;
    const loading = typeof g.areas?.isLoading === 'function' && g.areas.isLoading();
    const calm = (top === 'mode.explore' || top === 'mode.viewfinder')
      && !m.stack.some(x => x === 'mode.cutscene' || x === 'mode.dialogue' || x === 'mode.tripod' || x.startsWith('mode.panel_'))
      && !loading
      && (!eff || !eff.busy || eff.waitingInput);
    this.calmFor = calm ? this.calmFor + dt : 0;
    if (this.calmFor < CARD_CALM_SEC) return;
    const now = this.pendingCard;
    this.pendingCard = null;
    this.calmFor = 0;
    this.transitionLeft = SHICHEN_TRANSITION_SEC;
    g.audio.sfx('bell_distant');
    g.ui.fade.title(STRINGS.shichen[now], undefined, SHICHEN_TRANSITION_SEC);
    g.events.emit('shichen:card', { now });
  }

  private resync(cur: Shichen): void {
    this.last = cur;
    this.overrideRate = null;
    this.overrideStop = Infinity;
    this.transitionLeft = 0;
    this.pendingCard = null;
    this.calmFor = 0;
    this.clock = cur === 'mao' ? nightSec(DAWN_CLOCK.from) : nightSec(SHICHEN_CLOCK[cur].start);
  }

  private onFlag(): void {
    if (this.last === null) return;   // 还没对过账（开局前）：交给 update 静默对账
    const now = this.current;
    const prev = this.last;
    if (now === prev) return;
    this.last = now;
    if (now === 'mao') {
      // 卯时钟点由结局过场的 override 接管；在接管之前停在加速钟起点（HUD 仍显示“寅时”）
      if (this.overrideRate === null) this.clock = nightSec(DAWN_CLOCK.from);
    } else {
      this.overrideRate = null;
      this.clock = nightSec(SHICHEN_CLOCK[now].start);
    }
    this.game.events.emit('shichen', { now, prev });
    // 卯时的“时辰过场”就是结局本身，不另播远钟与字样。M4：其余时辰的远钟与大字挂起，等过场、对话、面板都结束再播（flushCard）
    this.pendingCard = now !== 'mao' ? now : null;
    this.calmFor = 0;
  }
}
