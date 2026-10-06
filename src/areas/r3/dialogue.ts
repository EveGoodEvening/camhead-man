// owner: R3
// R3 的全部对话树（GDD §8.5 陆师傅；台词逐字照抄）。id 一律 dlg.r3.*（ARCH §0.3）。
// 暗房守则（doc.darkroom_rules）贴在门背后：在文档阅读器里读（GameApi.openDoc / E.doc，M3；docs/requests/r3.md #2），不在这里。

import { IT, NPC } from '../../data/ids';
import { E } from '../../game/effects';
import { defineDialogues, seq } from '../../game/dialogue';

const LU = NPC.LU;

export const DLG_R3 = {
  LU_GLASS: 'dlg.r3.lu_glass',
  LU_SLIP: 'dlg.r3.lu_slip',
  LU_PICKUP: 'dlg.r3.lu_pickup',
  LU_ENVELOPE: 'dlg.r3.lu_envelope',
  LU_FILM: 'dlg.r3.lu_film',
  LU_SIT: 'dlg.r3.lu_sit',
  LU_AFTER: 'dlg.r3.lu_after',
} as const;

/** GDD §8.5 的原文。 */
const L = {
  glass: '打烊了。……取件？单子拿来。',
  slip1: 'No.04……泡了一位。周守仁，二〇〇四年六月。二十二年，你才来取。',
  slipLook: '（他看了你很久）',
  slip2: '……你不是周守仁。周守仁不让人照相；你倒好，浑身上下就一个脑袋是照相的。',
  pickup: '取件格按单子的尾号放，两位数。自己拿。……尾号泡了？拿眼睛瞅，别拿眼珠子瞅。',
  env1: '他那天坐下，快门一响，一把把脸捂上了。底片上就是两只手。他说他娘讲的：照相摄魂，照一张，少一块。——钱他倒是付了。',
  env2: '后来我偷着拍过他几回，从背后，他不知道。胶卷在墙上那台双反里，没来得及冲，我人就走了。暗房在后头，守则贴门背后。你手稳，你来。',
  film1: '第三格，你瞅这顶帽子。老周拿罐头盒子剪的，我在门口看着他剪的。……你这顶，一模一样。',
  film2: '坐那儿，我给你照一张。我这台老座机，照鬼照不出，照人照得出人样，照精怪照得出本相。这是新单子，填吧，写你的名字。',
  after1: '……伙计。老周管你叫伙计。他跟谁都不多话，就跟你说。他说你不照人，光照门，嘴严。',
  // 原文一框 94 字，M4 第 2 轮拆成两框（“带子让街道收了，后来跟着废品走了”是 P10 的线索，GDD P10“线索”，保留）
  after2: '我给他画遗像画了半年，脸画不出来，这院里谁也没见过他正脸。可有一样东西见过：那天夜里，就你看着。',
  after3: '带子让街道收了，后来跟着废品走了。七月半，丢了的东西都在鬼市上，丑时开。这张画你拿着，找着他的脸，给他补上。我在门岗等你。',
} as const;

export const LU_LINES = L;

export const DIALOGUES = defineDialogues('r3', {
  // 隔着玻璃（门没开时）
  [DLG_R3.LU_GLASS]: seq([[LU, L.glass]]),
  // 看了单子（show 取件单之后；flag 已在 offers 里先写）
  [DLG_R3.LU_SLIP]: seq([[LU, L.slip1], ['', L.slipLook], [LU, L.slip2], [LU, L.pickup]]),
  // 门开了、还没取到照片：再说一遍规矩
  [DLG_R3.LU_PICKUP]: seq([[LU, L.pickup]]),
  // 取到照片后
  [DLG_R3.LU_ENVELOPE]: seq([[LU, L.env1], [LU, L.env2]]),
  // 冲出底片后：对话结束时递新单子（GDD P8 解法 1）
  [DLG_R3.LU_FILM]: seq([[LU, L.film1], [LU, L.film2]], [E.item(IT.SLIP_0474)]),
  // 拿了新单子、还没坐
  [DLG_R3.LU_SIT]: seq([[LU, L.film2]]),
  // 本相之后（过场里）
  [DLG_R3.LU_AFTER]: seq([[LU, L.after1], [LU, L.after2], [LU, L.after3]]),
  // 暗房守则（门背后）：旁白逐条念
});
