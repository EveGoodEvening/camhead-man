// owner: R2
// R2 三号楼一单元的全部对话树（dlg.r2.*，ARCH §6.13；台词照抄 GDD §8.2、§8.3）。
// dlg.r2.stairs 是 GDD §13.12 点名的强制对话（选项“上楼/下楼/（算了）”，一楼没有“下楼”、五楼没有“上楼”）。

import { defineDialogues, seq } from '../../game/dialogue';
import type { DNode, DialogueDef } from '../../game/dialogue';
import { DLG, F, NPC, SPK } from '../../data/ids';
import type { DialogueId, SpeakerId } from '../../data/ids';
import { TEXT } from './text';
import { FLOORS, floorOf } from './layout';
import { speakFx } from './anim';

/** 纸像说的线性对话：每行之前记下“谁在说”（纸像鼓动）。 */
function paperSeq(lines: readonly (readonly [SpeakerId | '', string])[]): Omit<DialogueDef, 'id'> {
  const nodes: Record<string, DNode> = {};
  lines.forEach(([who, text], i) => {
    nodes[`l${i}`] = { who, text, next: i + 1 < lines.length ? `l${i + 1}` : 'end', effects: speakFx(who) };
  });
  nodes.end = { type: 'end', effects: speakFx('') };
  return { start: 'l0', nodes };
}

export const DLG_R2 = {
  WANG_FIRST: 'dlg.r2.wang_first',
  WANG_ESCORT: 'dlg.r2.wang_escort',
  WANG_DOOR: 'dlg.r2.wang_door',
  MENSHEN_HALT: 'dlg.r2.menshen_halt',
  MENSHEN_FIRST: 'dlg.r2.menshen_first',
  MENSHEN_AGAIN: 'dlg.r2.menshen_again',
  MENSHEN_OPEN: 'dlg.r2.menshen_open',
  MENSHEN_AFTER: 'dlg.r2.menshen_after',
} as const satisfies Record<string, DialogueId>;

export const DIALOGUES = defineDialogues('r2', {
  // 楼梯井：强制对话（GDD §3.4、§4.2），选项 effects 换层（g.setLevel）
  [DLG.R2_STAIRS]: {
    forced: true,
    start: 'q',
    nodes: {
      q: {
        type: 'choice', who: '',
        options: [
          { label: TEXT.stairs.up, next: 'end', when: s => floorOf(s) < FLOORS, effects: g => g.setLevel(floorOf(g.state) + 1) },
          { label: TEXT.stairs.down, next: 'end', when: s => floorOf(s) > 1, effects: g => g.setLevel(floorOf(g.state) - 1) },
          // M4 第 2 轮节奏：P5 做完（r2.wang_done）以后楼里没事了，三楼及以上多一个“下到一楼”，一次淡出直接回门厅
          { label: TEXT.stairs.ground, next: 'end', when: s => floorOf(s) > 2 && s.flag(F.R2_WANG_DONE), effects: g => g.setLevel(1) },
          { label: TEXT.stairs.cancel, next: 'end' },
        ],
      },
      end: { type: 'end' },
    },
  },
  // 王奶奶（GDD §8.2）
  [DLG_R2.WANG_FIRST]: seq([[NPC.WANG, TEXT.wang.first1], [NPC.WANG, TEXT.wang.first2]]),
  [DLG_R2.WANG_ESCORT]: seq([[NPC.WANG, TEXT.wang.escort]]),
  [DLG_R2.WANG_DOOR]: seq([[NPC.WANG, TEXT.wang.door1], [NPC.WANG, TEXT.wang.door2]]),
  // 门神（GDD §8.3）：老太太还没到门口时只喝一声（台词取 §8.3 尉迟恭第一句的前半）
  [DLG_R2.MENSHEN_HALT]: paperSeq([[SPK.YUCHI, TEXT.fb.door502Blocked]]),
  [DLG_R2.MENSHEN_FIRST]: paperSeq([[SPK.YUCHI, TEXT.gods.yuchiHalt], [SPK.QIN, TEXT.gods.qinFirst]]),
  [DLG_R2.MENSHEN_AGAIN]: paperSeq([[SPK.QIN, TEXT.gods.qinAgain]]),
  [DLG_R2.MENSHEN_OPEN]: paperSeq([[SPK.YUCHI, TEXT.gods.yuchiKnown], [SPK.QIN, TEXT.gods.qinOpen], [SPK.YUCHI, TEXT.gods.yuchiPeer]]),
  [DLG_R2.MENSHEN_AFTER]: paperSeq([[SPK.YUCHI, TEXT.gods.yuchiPeer]]),
});
