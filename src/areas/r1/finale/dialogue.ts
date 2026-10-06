// owner: R1-finale
// R1 终章的全部对话树（dlg.r1.*；R1-world 也登记 dlg.r1.*，所以终章自取的一律带 fin_ 前缀，GDD §13.12 点名的 dlg.r1.bracket_confirm 除外）。
// 台词逐字照抄 GDD §8.5、§8.8、§5 P13/P14；选项用〔〕的保留〔〕（它们是动作，不是话）。

import type { DialogueId } from '../../../data/ids';
import { DLG, F, NPC, PH } from '../../../data/ids';
import { E } from '../../../game/effects';
import { defineDialogues, seq } from '../../../game/dialogue';
import { P13, P14, ZHOU } from './text';
import { rt } from './stage';

export const D = {
  BRACKET: DLG.R1_BRACKET_CONFIRM,
  ZHOU_ASLEEP: 'dlg.r1.fin_zhou_asleep',
  ZHOU_WONTON: 'dlg.r1.fin_zhou_wonton',
  ZHOU_DOOR: 'dlg.r1.fin_zhou_door',
  LU_BOOTH: 'dlg.r1.fin_lu_booth',
  LU_FAREWELL: 'dlg.r1.fin_lu_farewell',
  ZHOU_BYE: 'dlg.r1.fin_zhou_bye',
  TUDI_WONTON: 'dlg.r1.fin_tudi_wonton',
} as const satisfies Record<string, DialogueId>;

export const DIALOGUES = defineDialogues('r1', {
  // P14 第 3 步：把头装回门楣支架的确认（强制对话，GDD §3.4、§6.13；正文随蚁穴进度生成 n/6）
  [D.BRACKET]: {
    forced: true,
    start: 'ask',
    nodes: {
      ask: {
        type: 'choice', who: '', text: s => P14.confirm(s.antCount()),
        options: [
          // 三脚架阶段只留曝光的滴答（M4：门口那段二胡在这里收掉）
          { label: P14.confirmGo, next: 'go', effects: [E.music('stop'), E.call(g => g.tripod.enter())] },
          { label: P14.confirmWait, next: 'end' },
        ],
      },
      go: { type: 'end' },
      end: { type: 'end' },
    },
  },
  // 显形之后、吃饭之前跟他说话
  [D.ZHOU_ASLEEP]: seq([['', P13.zhouAppear]]),
  // P14 第 1 步：吃完馄饨，老周讲那一夜（选项只影响台词，不影响进程；对话结束设 r1.zhou_fed，GDD P14）
  [D.ZHOU_WONTON]: {
    forced: true,
    start: 'l0',
    nodes: {
      l0: { who: NPC.ZHOU, text: ZHOU.afterWonton, next: 'l1', effects: () => { const r = rt(); if (r) r.zhouOverride = { pose: 'sit', variant: 'nocap' }; } },
      l1: { who: NPC.ZHOU, text: ZHOU.look, next: 'c1' },
      // 选项节点带上刚才那句（M4 第 2 轮：原来没有正文，出选项时对话框里只剩名字“老周”和两个动作；同文本打字机不重播）
      c1: {
        type: 'choice', who: NPC.ZHOU, text: ZHOU.look,
        options: [
          { label: ZHOU.optRec, next: 'recReply' },
          { label: ZHOU.optTurn, next: 'turn' },
        ],
      },
      // 〔REC 灯闪两下〕：伙计没有嘴，REC 灯闪两下代替点头（与老周这句同时）
      recReply: { who: NPC.ZHOU, text: ZHOU.recReply, rec: 2, next: 'l3' },
      turn: { who: NPC.ZHOU, text: ZHOU.turnReply, next: 'l3' },
      l3: { who: NPC.ZHOU, text: ZHOU.notebook, next: 'l4' },
      l4: { who: NPC.ZHOU, text: ZHOU.afraid, next: 'l5' },
      l5: { who: NPC.ZHOU, text: ZHOU.thatNight, next: 'l6' },
      l6: { who: NPC.ZHOU, text: ZHOU.grewUp, next: 'c2' },
      c2: {
        type: 'choice', who: NPC.ZHOU, text: ZHOU.grewUp,
        options: [
          { label: ZHOU.optShow, next: 'show', when: `photo(${PH.TRUE_FORM})` },
          { label: ZHOU.optNoShow, next: 'knock' },
        ],
      },
      show: { who: NPC.ZHOU, text: ZHOU.showReply, next: 'l8' },
      knock: { who: '', text: ZHOU.knock, next: 'knock2', effects: [E.sfx('lamp_click')] },
      knock2: { who: NPC.ZHOU, text: ZHOU.noShowReply, next: 'l8' },
      l8: { who: NPC.ZHOU, text: ZHOU.giveBack, next: 'end' },
      end: { type: 'end', effects: [E.flag(F.R1_ZHOU_FED)] },
    },
  },
  // P14 第 2 步：门口（戴上帽子，在地上画叉）；蚁穴收到 1–5 张时土地插一句（GDD §8.1“合影前提醒”）。
  // 老周说话时垫二胡（GDD §9.5），说完就收（M4：原来吃馄饨起的二胡一直循环到天亮）
  [D.ZHOU_DOOR]: {
    start: 'l0',
    nodes: {
      ...Object.fromEntries(ZHOU.door.map((t, i) => [`l${i}`, {
        who: NPC.ZHOU, text: t, next: i + 1 < ZHOU.door.length ? `l${i + 1}` : 'end', ...(i === 0 ? { effects: [E.music('erhu_dea')] } : {}),
      }])),
      end: {
        type: 'end',
        effects: g => {
          g.music('stop');
          const n = g.state.antCount();
          if (n >= 1 && n < 6) g.say(P14.tudiRemind, NPC.TUDI);
        },
      },
    },
  },
  // 陆师傅在门岗（P13 线索；摆上遗像以后换一句）
  [D.LU_BOOTH]: {
    start: 'b',
    nodes: {
      b: { type: 'branch', cases: [{ when: F.R1_PORTRAIT_PLACED, next: 'placed' }], else: 'clue' },
      clue: { who: NPC.LU, text: P13.luClue, next: 'end' },
      placed: { who: NPC.LU, text: P13.luPlaced, next: 'end' },
      end: { type: 'end' },
    },
  },
  // 天亮，你按下快门：他走到院门口，回头冲你摆手（结局过场里的一句，等玩家按一下再往下走）
  [D.ZHOU_BYE]: seq([[NPC.ZHOU, ZHOU.wave]]),
  // 老周显形以后、吃饭以前找土地（ctx.addTalk 追加在 R1-world 的土地对话最前面，GDD P14“线索”）
  [D.TUDI_WONTON]: seq([[NPC.TUDI, P14.tudiWonton]]),
  // 补上脸：陆师傅道别（之后化成一点光，见 logic.ts）
  [D.LU_FAREWELL]: seq([
    [NPC.LU, P13.luFarewell[0]],
    ['', P13.luFarewell[1]],
    [NPC.LU, P13.luFarewell[2]],
  ]),
});
