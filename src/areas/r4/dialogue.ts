// owner: R4
// R4 的全部对话树（dlg.r4.*，GDD §8.6 纸扎门童、§8.7 黄三爷）。台词在 text.ts，这里只排结构。
// 讨封那一段的“点头/摇头”只影响台词（GDD P11），做成强制对话：必须二选一，不追加“（先这样）”。

import { defineDialogues, seq } from '../../game/dialogue';
import { NPC } from '../../data/ids';
import { TEXT } from './text';

/** 对话 id（ARCH §0.3：dlg.<area>.<snake>，区域自行命名）。 */
export const DLG4 = {
  boyToll: 'dlg.r4.boy_toll',
  boyPaid: 'dlg.r4.boy_paid',
  boyAgain: 'dlg.r4.boy_again',
  huangUnmasked: 'dlg.r4.huang_unmasked',
  huangTrueForm: 'dlg.r4.huang_true_form',
  huangHides: 'dlg.r4.huang_hides',
  huangNormal: 'dlg.r4.huang_normal',
  huangIr: 'dlg.r4.huang_ir',
  huangIdle: 'dlg.r4.huang_idle',
  huangOldPhotos: 'dlg.r4.huang_old_photos',
} as const;

const B = NPC.BOY;
const H = NPC.HUANG;

export const DIALOGUES = defineDialogues('r4', {
  // —— 纸扎门童（§8.6）
  [DLG4.boyToll]: seq([[B, TEXT.boy.toll]]),
  [DLG4.boyPaid]: seq([[B, TEXT.boy.paid1], [B, TEXT.boy.paid2]]),
  [DLG4.boyAgain]: seq([[B, TEXT.boy.again]]),

  // —— 黄三爷（§8.7）
  // 揭面具的旁白是对话的第一行（M4：原先先发旁白字幕再开对话，取景器里字幕被对话框盖住，看不到揭面具这个动作）
  [DLG4.huangUnmasked]: seq([['', TEXT.fb.unmask], [H, TEXT.huang.unmasked]]),
  [DLG4.huangTrueForm]: seq([[H, TEXT.huang.trueForm]]),
  [DLG4.huangHides]: seq([[H, TEXT.huang.hides]]),
  // 动作单独成一行旁白，再是他的台词（M4 第 2 轮，与 huang_ir 的“（他笑出了声，又像在哭）”同一体例）
  [DLG4.huangNormal]: seq([['', TEXT.fb.huangNormalAside], [H, TEXT.fb.huangNormal]]),
  [DLG4.huangIr]: {
    start: 'l1',
    forced: true,
    nodes: {
      l1: { who: H, text: TEXT.huang.ir1, next: 'aside' },
      aside: { who: '', text: TEXT.huang.irAside, next: 'l2' },
      l2: { who: H, text: TEXT.huang.ir2, next: 'ask' },
      // 选项节点带上刚才那句（M4 第 2 轮整合：原来没有正文，出选项时他问的那句“有人说过你像个人没有？”被清空；同文本打字机不重播，同 r1 老周的 c1/c2）
      ask: {
        type: 'choice', who: H, text: TEXT.huang.ir2,
        options: [
          { label: TEXT.huang.optNod, next: 'nod' },
          { label: TEXT.huang.optShake, next: 'shake' },
        ],
      },
      nod: { who: H, text: TEXT.huang.nod, rec: 1, next: 'end' },
      shake: { who: H, text: TEXT.huang.shake, next: 'end' },
      end: { type: 'end' },
    },
  },
  // 出示旧照（ph.old_1–6）：他不收，指给你树底下那帮小的（§8.7“旧照提示”）
  [DLG4.huangOldPhotos]: seq([[H, TEXT.huang.oldPhotos]]),
  // 看破之后平常找他说话：按进度给一句，另有可选话题“旧照片”
  [DLG4.huangIdle]: {
    start: 'pick',
    nodes: {
      pick: {
        type: 'branch',
        cases: [
          { when: 'r4.got_tape', next: 'after' },
          { when: 'r4.huang_admits', next: 'admits' },
          { when: 'r4.asked_tape', next: 'asked' },
        ],
        else: 'found',
      },
      found: { who: H, text: TEXT.huang.unmasked, next: 'topics' },
      asked: { who: H, text: TEXT.huang.trueForm, next: 'topics' },
      admits: { who: H, text: TEXT.huang.hidesAgain, next: 'topics' },
      after: { who: H, text: TEXT.huang.after, next: 'topics' },
      topics: { type: 'choice', options: [{ label: TEXT.huang.optOldPhotos, next: 'old' }] },
      old: { who: H, text: TEXT.huang.oldPhotos, next: 'end' },
      end: { type: 'end' },
    },
  },

  // 世界里的文档（规矩牌、旧书残页）在文档阅读器里读（logic.ts 的 E.doc，M3；docs/requests/r4.md #1），不在这里
});
