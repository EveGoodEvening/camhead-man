// owner: WP1
// 基于游戏时间的 after/every（ARCH §1.4）。区域内经 ctx.after/ctx.every 使用，卸载时自动清除。
// 只由 Game.step 第 7 步的 ctx.timers.update(dt) 推进，所以冻结、锁步与 advance() 快进都自然生效。

interface TimerEntry {
  at: number;
  /** every 的周期；after 为 0 */
  period: number;
  fn: () => void;
  alive: boolean;
}

export class GameTimers {
  private now = 0;
  private list: TimerEntry[] = [];

  /** 当前挂起的定时器数量。 */
  get size(): number {
    return this.list.length;
  }

  /** sec 秒（游戏时间）后调用一次；返回取消函数。 */
  after(sec: number, fn: () => void): () => void {
    return this.add(Math.max(0, sec), 0, fn);
  }

  /** 每 sec 秒（游戏时间）调用一次；返回取消函数。 */
  every(sec: number, fn: () => void): () => void {
    // 周期为 0 会在同一帧里无限触发；最短按 1ms 算
    const period = Math.max(1e-3, sec);
    return this.add(period, period, fn);
  }

  /** 推进游戏时间（冻结时不调用）。 */
  update(dt: number): void {
    this.now += dt;
    if (this.list.length === 0) return;
    // 回调里可能增删定时器：先取快照，按到期先后执行
    const due = this.list.filter(t => t.alive && t.at <= this.now + 1e-9).sort((a, b) => a.at - b.at);
    for (const t of due) {
      if (!t.alive) continue;
      // every 在一次长 dt 内可能跨过多个周期：逐个补发，但设上限，避免 dt 异常时卡死
      let guard = 0;
      do {
        this.fire(t);
        if (t.period > 0) t.at += t.period;
        else t.alive = false;
      } while (t.alive && t.period > 0 && t.at <= this.now + 1e-9 && ++guard < 16);
    }
    this.list = this.list.filter(t => t.alive);
  }

  /** 清除全部定时器。 */
  clear(): void {
    for (const t of this.list) t.alive = false;
    this.list = [];
  }

  private add(sec: number, period: number, fn: () => void): () => void {
    const t: TimerEntry = { at: this.now + sec, period, fn, alive: true };
    this.list.push(t);
    return () => {
      t.alive = false;
    };
  }

  private fire(t: TimerEntry): void {
    try {
      t.fn();
    } catch (err) {
      // 一个区域定时器出错不应让同一帧的其他定时器失效；错误照样上报（harness 会判失败）
      console.error('[GameTimers]', err);
    }
  }
}
