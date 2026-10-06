// owner: R1-world
// 开场过场 cs.r1.intro（GDD §2.2、§3.2 开场三分钟节拍 0:00–1:00；id 固定：新游戏时引擎播它，ARCH §11.6）：
// 黑屏里 CRT“嗡——啪”开机，五路分屏；CH2（屋角半球机位）里坐着一个脖子上是摄像头的人；CH1“无信号”；标题叠字。
// 镜头拉开到肩后，看见坐在 CRT 前的自己；桌上的巡夜本墨迹未干，新写的一行“伙计，门口的灯灭了。”；切到第三人称，提示“WASD 移动 / 鼠标看”。

import type { CutsceneDef } from '../../game/cutscene';
import { E } from '../../game/effects';
import { STRINGS } from '../../data/strings';
import { R1 } from './layout';
import { INTRO } from './text';
import { LOG_AT } from './build/booth';
import { TEMP } from './logic';

const S = R1.derived.crtScreen.center;

export const CS_INTRO = 'cs.r1.intro' as const;

export const CUTSCENES: readonly CutsceneDef[] = [
  {
    id: CS_INTRO,
    skippable: 'rewatch',
    steps: [
      { effects: g => g.player.model.setPose('sit', 0) },
      { fade: 'out', dur: 0.01 },
      // 对着屏幕：五路分屏（CH2 那格是屋角半球机位的实时画面，看得见坐在椅子上的自己；CH1“无信号”）
      { cam: { pos: [S[0], S[1] + 0.01, S[2] - 0.56], target: [S[0], S[1], S[2]], fov: 40 }, blend: 0 },
      { crt: { layout: 'split5', channel: 2 } },
      { sfx: 'crt_on' },
      { fade: 'in', dur: 1.2 },
      { wait: 1.0 },
      { title: STRINGS.game.title, sub: STRINGS.game.subtitle, dur: 3.2 },
      // 拉开到肩后：一颗白色的摄像头脑袋，对着一台亮着的 CRT（停住看一会儿）
      { cam: { pos: [-7.2, 1.75, 20.1], target: [-6.68, 1.05, 21.3], fov: 54 }, blend: 2.4 },
      { wait: 2.6 },
      // 桌上的巡夜本：墨迹未干的新一行。
      // M4：机位从伙计左臂内侧（画面右下是失焦的胳膊和手指）挪到本子正上方偏北、往下看：字是正的、整页入画，两只胳膊都在画外；
      // 这一镜把本子四周的光环压暗（temp(intro_log)，logic.ts），墨迹那一行是画面里最亮的东西
      // 趁镜头在本子上，把收尾的第三人称视角摆成低头、略偏西（M4 第 2 轮：原来 yaw 180 / pitch −6，发光的本子被自己的后背和摄像头脑袋挡住；
      // 现在本子露在头的左边，接下来拿控制、按 E 拾取时看得见它）
      { run: (g, ctx) => { ctx.setTemp(TEMP.introLog, true); g.player.look?.(190, -26); } },
      { cam: { pos: [-6.42, 1.46, 21.1], target: [LOG_AT[0] + 0.01, LOG_AT[1], LOG_AT[2] + 0.03], fov: 34 }, blend: 1.2 },
      { wait: 0.6 },
      { say: INTRO.logLine, who: '', dur: 3.2 },
      // 光环等镜头拉回去以后再亮回来（拉镜头的 1.2 秒里本子还在画面中央，提前恢复会闪出一圈粗白框）
      { cam: 'player', blend: 1.2 },
      { wait: 0.6 },
      { run: (_g, ctx) => ctx.setTemp(TEMP.introLog, false) },
      { effects: [E.tutorial(STRINGS.tutorial.move)] },
    ],
  },
];
