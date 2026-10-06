// owner: R3
// P8 本相的过场（GDD P8“完成后”、§8.5）：伙计坐上坐凳 → 从大座机的镜头看过去 → 镁光一闪（减少闪光时淡入白）
// → 旁白分三句跟着三个镜头出（M4）：“镁光……亮”（坐凳）→ 陆师傅把底片举到灯下（中景）→ “底片上没有人……”（底片近景，
// 片子对着影棚的钨丝灯）→ 主动机 → 陆师傅的话（dlg.r3.lu_after）→ 起身。
// flag 与物品在 onCorrect 里先写（ARCH §11.5 第 9 条），过场被打断也不会漏写进度。

import type { CameraPose, V3 } from '../../core/types';
import type { CutsceneDef } from '../../game/cutscene';
import type { GameApi } from '../../game/effects';
import { LU_CAMERA, STOOL } from './layout';
import { DLG_R3 } from './dialogue';
import { hideNegative, holdNegative } from './negative';
import { TEXT } from './text';

export const CS_R3 = { TRUE_FORM: 'cs.r3.true_form' } as const;
/** 区域临时状态：本相过场期间陆师傅还站在大座机后面（r3.saw_true_form 已写，但人还没走）。 */
export const LU_FAREWELL = 'lu_farewell';

/** 大座机镜头的位置看坐凳上的伙计：整颗摄像头脑袋连铁皮帽檐都在画面里（M4：原来 target y1.25 / fov 40 把帽子切了）。 */
const STOOL_SHOT: CameraPose = { pos: [0.02, 1.28, -6.95], target: [0, 1.5, STOOL[2]], fov: 44 };
/** 陆师傅的中景：从大座机西北边看他（站在大座机后面，面朝北；右手举片子，机位放在他左前方，胳膊不挡脸）。 */
const LU_SHOT: CameraPose = { pos: [LU_CAMERA[0] - 0.8, 1.5, LU_CAMERA[2] - 1.9], target: [LU_CAMERA[0] + 0.05, 1.7, LU_CAMERA[2]], fov: 42 };
/** 底片举起来后的位置（右手在眼前上方，negative.ts HOLD；M4 截图实测 (0.26, 1.90, -6.29)）。 */
export const NEG_AT: V3 = [LU_CAMERA[0] + 0.11, 1.9, LU_CAMERA[2] - 0.49];
/**
 * 底片近景机位：陆师傅右肩后头、顺着他的视线看片子（片子正面朝这里）。影棚的钨丝灯在画面右缘外约 26°，只留一圈光晕——
 * 把灯框进画面试过（M4），灯的 Bloom 光斑比片子还大、片子也被挤到边上斜着，不如让片子居中。
 */
export const NEG_CAM: V3 = [LU_CAMERA[0] + 0.25, 1.76, LU_CAMERA[2] - 0.06];
const NEG_SHOT: CameraPose = { pos: NEG_CAM, target: NEG_AT, fov: 24 };

/** 坐上坐凳（面朝大座机）。 */
async function sitDown(g: GameApi): Promise<void> {
  await g.player.teleport([STOOL[0], 0, STOOL[2]], 180, 0);
  g.player.model.setPose('sit', 0.2);
}

export const CUTSCENES: readonly CutsceneDef[] = [
    {
      id: CS_R3.TRUE_FORM,
      skippable: 'rewatch',
      steps: [
        { fade: 'out', dur: 0.4 },
        { run: g => sitDown(g) },
        { cam: STOOL_SHOT, blend: 0, layers: ['yin'] },
        { fade: 'in', dur: 0.5 },
        { wait: 1.2 },
        { sfx: 'magnesium' },
        { fade: 'white', dur: 0.9 },
        { say: TEXT.cs.flash, who: '', dur: 2.4 },
        // 陆师傅把底片举到灯下
        { run: () => holdNegative(true, NEG_CAM) },
        { cam: LU_SHOT, blend: 1.2, layers: ['yin'] },
        { say: TEXT.cs.negative, who: '', dur: 3.6 },
        // 底片近景：先看清片子，再出“底片上没有人……”
        { cam: NEG_SHOT, blend: 0, layers: ['yin'] },
        { wait: 0.8 },
        { say: TEXT.cs.trueForm, who: '', dur: 4 },
        { cam: LU_SHOT, blend: 0, layers: ['yin'] },
        { run: () => holdNegative(false) },
        { music: 'motif_dea' },
        { dialogue: DLG_R3.LU_AFTER },
        { fade: 'out', dur: 0.5 },
        // 陆师傅去门岗等你（GDD P8）：送别的临时站位撤掉，他就不在馆里了（GDD §4.6）
        { run: (g, ctx) => { hideNegative(); g.player.model.setPose('stand', 0); ctx.setTemp(LU_FAREWELL, false); } },
        { cam: 'player', blend: 0 },
        { fade: 'in', dur: 0.6 },
      ],
    },
];
