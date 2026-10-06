// owner: R2
// 纸像“说话时微微鼓动”（GDD §2.7 门神）的共享状态：对话行的 effects 写入当前说话的纸像，logic.ts 的 update 读它做动画。
// 纯视觉（不存档、不影响进度）；每次进区域 build 时复位。

import type { SpeakerId } from '../../data/ids';
import { E } from '../../game/effects';
import type { Effect } from '../../game/effects';

export const PAPER_TALK = { who: '' as SpeakerId | '', t: 0 };

/** 对话行 effects：这一行由哪张纸像说（行显示之前执行）。 */
export function speakFx(who: SpeakerId | ''): Effect[] {
  return [E.call(() => {
    PAPER_TALK.who = who;
    PAPER_TALK.t = 0;
  })];
}

export function resetPaperTalk(): void {
  PAPER_TALK.who = '';
  PAPER_TALK.t = 0;
}
