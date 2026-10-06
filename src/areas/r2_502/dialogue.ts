// owner: R2
// R2_502 的全部对话树（dlg.r2_502.*，ARCH §6.13；台词照抄 GDD §8.2 王奶奶、§8.4 灶君）与读信过场（cs.r2_502.letter）。

import * as THREE from 'three';
import { defineDialogues, seq } from '../../game/dialogue';
import type { DNode, DialogueDef } from '../../game/dialogue';
import type { CutsceneDef } from '../../game/cutscene';
import { NPC, SPK } from '../../data/ids';
import type { CameraPose } from '../../core/types';
import type { CutsceneId, DialogueId, SpeakerId } from '../../data/ids';
import { STRINGS } from '../../data/strings';
import { E } from '../../game/effects';
import { TEXT } from './text';
import { L502, letterAt, letterCamAt } from './layout';
import { SCENE, zaoFx } from './anim';

/** 带“谁在说”的线性对话（纸像鼓动、眼珠瞟）。 */
function zaoSeq(lines: readonly (readonly [SpeakerId | '', string, boolean?])[]): Omit<DialogueDef, 'id'> {
  const nodes: Record<string, DNode> = {};
  lines.forEach(([who, text, glance], i) => {
    nodes[`l${i}`] = { who, text, next: i + 1 < lines.length ? `l${i + 1}` : 'end', effects: zaoFx(who, glance === true) };
  });
  nodes.end = { type: 'end', effects: zaoFx('') };
  return { start: 'l0', nodes };
}

export const DLG_502 = {
  WANG_ENTER: 'dlg.r2_502.wang_enter',
  ZAOJUN_FIRST: 'dlg.r2_502.zaojun_first',
  ZAOJUN_DONE: 'dlg.r2_502.zaojun_done',
  LETTER: 'dlg.r2_502.letter',
  /** M4 第 2 轮：临别三句拆成单独一段，换机位（两人侧面同框）、她转过身来看着伙计 */
  FAREWELL: 'dlg.r2_502.farewell',
} as const satisfies Record<string, DialogueId>;

export const CS_LETTER: CutsceneId = 'cs.r2_502.letter';

export const DIALOGUES = defineDialogues('r2_502', {
  // 进屋（GDD §8.2）
  [DLG_502.WANG_ENTER]: seq([[NPC.WANG, TEXT.wang.enter1], [NPC.WANG, TEXT.wang.enter2]]),
  // 灶君（GDD §8.4）：灶王奶奶那一句时眼珠往左下瞟了一下
  [DLG_502.ZAOJUN_FIRST]: zaoSeq([[SPK.ZAOWANG, TEXT.zao.wang], [SPK.ZAONAINAI, TEXT.zao.nainai, true]]),
  [DLG_502.ZAOJUN_DONE]: zaoSeq([[SPK.ZAOWANG, TEXT.zao.doneWang], [SPK.ZAONAINAI, TEXT.zao.doneNainai]]),
  // 读信过场里的对话：看完信 → 灶君事毕（GDD §8.2、§8.4）；临别在 FAREWELL（换机位后）
  [DLG_502.LETTER]: zaoSeq([
    [NPC.WANG, TEXT.wang.afterLetter],
    [SPK.ZAOWANG, TEXT.zao.doneWang],
    [SPK.ZAONAINAI, TEXT.zao.doneNainai],
  ]),
  [DLG_502.FAREWELL]: zaoSeq([
    [NPC.WANG, TEXT.wang.farewell1],
    ['', TEXT.wang.farewellLook],
    [NPC.WANG, TEXT.wang.farewell2],
  ]),
});

const K = L502;
/** 过场机位（M4 重摆，都在厨房里，伙计先被挪到厨房北头 K.cutPlayer、正好在 CAM_KITCHEN 身后）：
 *  CAM_KITCHEN 从厨房北头往南看——左边灶台、瓷砖与墙上的灶君，尽头窗前的王奶奶；
 *  CAM_LETTER 从王奶奶右肩后头顺着她的视线看手上的信（信纸正面朝她，近景里认得出字）；CAM_WINDOW 看她化成的光出南窗。 */
const CAM_KITCHEN: CameraPose = { pos: [6.05, 1.62, -3.05], target: [6.75, 1.2, -0.85], fov: 50 };
const CAM_LETTER: CameraPose = (() => {
  const [lx, ly, lz] = letterAt(K.wang[0], K.wang[2]);
  return { pos: letterCamAt(K.wang[0], K.wang[2]), target: [lx, ly - 0.01, lz], fov: 30 };
})();
const CAM_WINDOW: CameraPose = { pos: [4.2, 1.45, -2.9], target: [6.2, 1.6, -0.2], fov: 50 };
/**
 * 临别（M4 第 2 轮）：伙计在黑场里挪到她跟前 K.farewellPlayer（面朝南看着她），她转过身来面朝伙计（临时状态 face_player）；
 * 机位在灶台上方、贴着东墙往西看（两人中点的正东）——两人都是侧脸，左边（南）是她，右边（北）是伙计的摄像头脑袋，
 * 背景是厨房门洞外黑着的客厅。厨房只有 2.5m 宽：两人原来隔着 3m（伙计在北头），任何机位都框不进一个画面。
 */
const CAM_FAREWELL: CameraPose = { pos: [7.36, 1.62, -1.02], target: [6.0, 1.5, -1.02], fov: 50 };
/** 读信过场的机位（shots.ts 的读信机位也用它们） */
export const CAM_502 = { KITCHEN: CAM_KITCHEN, LETTER: CAM_LETTER, FAREWELL: CAM_FAREWELL, WINDOW: CAM_WINDOW } as const;

/**
 * 读信过场（GDD P5 解法 4、§8.2）：王奶奶转身对着灶君读信（手里那页信，近景里念出信里的两句：“瓶瓶罐罐”“皮擀不圆”，M4）
 * → 灶火亮起（青色）→ 她煮好馄饨、对话 → 临别（两人侧面同框，她转过身看着伙计）→ 化成一点光，从厨房窗口飞向槐树。
 * flags 与物品在出示信的那一刻已经写好（先写 flag，再开过场，ARCH §11.5 第 9 条）；区域临时状态 farewell/fire_hold/reading
 * 让她在过场里还在、灶火晚一点再亮、手上拿着信。开场黑一下，把伙计挪到厨房北头（不挡镜头）。
 */
export const CUTSCENES: readonly CutsceneDef[] = [
  {
    id: CS_LETTER,
    steps: [
      { fade: 'out', dur: 0.35 },
      { run: async (g, ctx) => {
        ctx.setTemp('reading', true);
        await g.player.teleport(K.cutPlayer, K.cutPlayerYaw, 0);
      } },
      { cam: CAM_KITCHEN, blend: 0 },
      { fade: 'in', dur: 0.5 },
      { wait: 1.4 },
      // 切到信的近景（插入镜头，不推拉：推拉会从灶台上头扫过去），念信里的两句，再切回来
      { cam: CAM_LETTER, blend: 0 },
      { wait: 0.8 },
      // 第一句约 45 字：停 8 秒，两句之间镜头多停 0.6 秒（M4 第 2 轮：原来 5 秒，约 9 字/秒读不完）
      { say: TEXT.letterRead[0], dur: 8 },
      { wait: 0.6 },
      { say: TEXT.letterRead[1], dur: 4.5 },
      { cam: CAM_KITCHEN, blend: 0 },
      { run: (_g, ctx) => {
        ctx.setTemp('reading', false);
        ctx.setTemp('fire_hold', false);
      } },
      { sfx: 'burn' },
      { wait: 1.4 },
      { dialogue: DLG_502.LETTER },
      // 临别：黑一下，伙计挪到她跟前、她转过身来，换成两人侧面同框的机位（M4 第 2 轮）
      { fade: 'out', dur: 0.3 },
      { run: async (g, ctx) => {
        ctx.setTemp('face_player', true);
        await g.player.teleport(K.farewellPlayer, K.farewellPlayerYaw, 0);
      } },
      { cam: CAM_FAREWELL, blend: 0 },
      { fade: 'in', dur: 0.4 },
      { dialogue: DLG_502.FAREWELL },
      { cam: CAM_WINDOW, blend: 0.8 },
      { music: 'motif_dea' },
      {
        during: 3.2,
        tick: (_g, t01) => {
          // 她化成一点光，飞出厨房南窗，往槐树那边去（GDD P5“完成后”）
          const rig = SCENE.wangRig;
          if (rig) rig.setOpacity(Math.max(0, 1 - t01 * 2.2));
          const orb = SCENE.orb;
          if (orb) {
            orb.visible = t01 > 0.05 && t01 < 0.98;
            const a = Math.min(1, t01 * 1.25);
            const p0 = new THREE.Vector3(K.wang[0], 1.1, K.wang[2]);
            const p1 = new THREE.Vector3(5.95, 1.7, 0.4);
            const p2 = new THREE.Vector3(4.8, 3.2, 6.0);
            const q = a < 0.55 ? p0.lerp(p1, a / 0.55) : p1.lerp(p2, (a - 0.55) / 0.45);
            orb.position.copy(q);
            const s = 0.6 + 0.4 * Math.sin(t01 * 30);
            orb.scale.setScalar((1 - a * 0.6) * s + 0.4);
          }
        },
      },
      { run: (_g, ctx) => {
        if (SCENE.orb) SCENE.orb.visible = false;
        ctx.setTemp('farewell', false);
        ctx.setTemp('face_player', false);
      } },
      { effects: [E.tutorial(STRINGS.tutorial.lens)] },
      { cam: 'player', blend: 0.6 },
    ],
  },
];
