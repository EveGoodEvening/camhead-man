// owner: R1-world
// R1-world 的对话树（dlg.r1.*，ARCH §0.3、§6.13）：土地（GDD §8.1）。墙上文档用文档阅读器（GameApi.openDoc / E.doc，M3；docs/requests/r1-world.md #1）。
// 台词全部来自 text.ts（照抄 GDD）；选项用〔〕的原文。

import type { DialogueDef, DNode } from '../../game/dialogue';
import { defineDialogues, seq } from '../../game/dialogue';
import { E } from '../../game/effects';
import type { StateView } from '../../game/state';
import { F, NPC } from '../../data/ids';
import { STRINGS } from '../../data/strings';
import { TUDI } from './text';

/** 本文件定义的对话 id（logic.ts 引用；R1-finale 不用这些）。 */
export const DLG_ID = {
  tudiNoLamp: 'dlg.r1.tudi_no_lamp',
  tudiFirst: 'dlg.r1.tudi_first',
  /** 没跟土地说话就直接拍了他：初见的前半句（M4，GDD P1 第 5–6 步的次序） */
  tudiFirstShot: 'dlg.r1.tudi_first_shot',
  tudiPhoto: 'dlg.r1.tudi_photo',
  tudiGoReplay: 'dlg.r1.tudi_go_replay',
  tudiMission: 'dlg.r1.tudi_mission',
  tudiIdle: 'dlg.r1.tudi_idle',
  tudiChou: 'dlg.r1.tudi_chou',
  tudiYin: 'dlg.r1.tudi_yin',
  /** M4 第 2 轮：寅时看完带子 / 听完那句话 / 摆上画以后的土地（GDD §8.1“寅时”待同步） */
  tudiYinTape: 'dlg.r1.tudi_yin_tape',
  tudiYinVoice: 'dlg.r1.tudi_yin_voice',
  tudiYinPlaced: 'dlg.r1.tudi_yin_placed',
  tudiBooth: 'dlg.r1.tudi_booth',
} as const;

/** 蚁穴收了 1–5 张旧照（合影前提醒的条件，GDD §8.1）。 */
const antsPartial = (s: StateView): boolean => s.antCount() >= 1 && s.antCount() < 6;

/** 可选话题〔这树〕〔您是谁〕：说完回到选项；非强制对话自动追加“（先这样）”。 */
function topicNodes(): Record<string, DNode> {
  return {
    topics: {
      type: 'choice', who: NPC.TUDI,
      options: [
        { label: `〔${TUDI.topicTree}〕`, next: 'tree' },
        { label: `〔${TUDI.topicWho}〕`, next: 'who' },
      ],
    },
    tree: { who: NPC.TUDI, text: TUDI.tree, next: 'topics' },
    who: { who: NPC.TUDI, text: TUDI.who, next: 'topics' },
    end: { type: 'end' },
  };
}

/** 一句话 + 蚁穴 1–5 张时的合影前提醒 + 话题。 */
function lineThenTopics(text: string, o?: { remind?: boolean; topics?: boolean }): Omit<DialogueDef, 'id'> {
  const topics = o?.topics !== false;
  const after = topics ? 'topics' : 'end';
  const nodes: Record<string, DNode> = {
    l0: { who: NPC.TUDI, text, next: o?.remind ? 'remindCheck' : after },
    ...(topics ? topicNodes() : { end: { type: 'end' } }),
  };
  if (o?.remind) {
    nodes.remindCheck = { type: 'branch', cases: [{ when: antsPartial, next: 'remind' }], else: after };
    nodes.remind = { who: NPC.TUDI, text: TUDI.antsRemind, next: after };
  }
  return { start: 'l0', nodes };
}

/** 交代任务（r1.p1_done 后）：第一句就写 r1.mission_given（先写 flag 再说话，ARCH §11.5 第 9 条；中途被打断也不漏写）。 */
function missionDialogue(): Omit<DialogueDef, 'id'> {
  const nodes: Record<string, DNode> = {};
  TUDI.mission.forEach((text, i) => {
    nodes[`l${i}`] = {
      who: NPC.TUDI, text, next: i + 1 < TUDI.mission.length ? `l${i + 1}` : 'end',
      ...(i === 0 ? { effects: [E.flag(F.R1_MISSION_GIVEN)] } : {}),
    };
  });
  nodes.end = { type: 'end' };
  return { start: 'l0', nodes };
}

export const DIALOGUES: readonly DialogueDef[] = defineDialogues('r1', {
  // —— 土地（GDD §8.1）
  [DLG_ID.tudiNoLamp]: seq([[NPC.TUDI, TUDI.noLamp]]),
  // 说过初见这一句记 seen（拍照时据此决定要不要先补上前半句）
  [DLG_ID.tudiFirst]: seq([[NPC.TUDI, TUDI.first]], [E.seen(DLG_ID.tudiFirst), E.tutorial(STRINGS.tutorial.shutter)]),
  [DLG_ID.tudiFirstShot]: seq([[NPC.TUDI, TUDI.firstHalf]], [E.seen(DLG_ID.tudiFirst)]),
  [DLG_ID.tudiPhoto]: seq([[NPC.TUDI, TUDI.afterPhoto]], [E.tutorial(STRINGS.tutorial.rewind)]),
  [DLG_ID.tudiGoReplay]: seq([[NPC.TUDI, TUDI.goReplay]]),
  [DLG_ID.tudiMission]: missionDialogue(),
  // 交代完差事、丑时以前：先把差事再说一遍，再给两个话题（M4：原来直接从选项开始，对话框里没有正文）
  [DLG_ID.tudiIdle]: lineThenTopics(TUDI.idle),
  [DLG_ID.tudiChou]: lineThenTopics(TUDI.chou),
  [DLG_ID.tudiYin]: lineThenTopics(TUDI.yin, { remind: true }),
  [DLG_ID.tudiYinTape]: lineThenTopics(TUDI.yinTape, { remind: true }),
  [DLG_ID.tudiYinVoice]: lineThenTopics(TUDI.yinVoice, { remind: true }),
  [DLG_ID.tudiYinPlaced]: lineThenTopics(TUDI.yinPlaced, { remind: true }),
  [DLG_ID.tudiBooth]: lineThenTopics(TUDI.afterFace, { remind: true, topics: false }),
});
