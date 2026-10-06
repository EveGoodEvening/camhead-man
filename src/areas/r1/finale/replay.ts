// owner: R1-finale
// 门岗残影点 rp.r1_booth 与片段 seg.booth_2023（GDD §13.6、P12 第 5 步）：
// 2023-08-30 03:12，老周扶着门框走出来，在门前站住、抬头冲门楣上的伙计说话（录像机录不下的声音），再回屋。
// 片段里老周的脸照例是一团雪花（character:'zhou' 的回放人影一律 faceMask，ARCH §6.9）。锁定直到 r1.tape_watched。

import type { ReplayPointDef, ReplaySegmentDef } from '../../../game/replay';
import type { V3 } from '../../../core/types';
import { F, GHOST, NPC, RP, SEG } from '../../../data/ids';
import { E } from '../../../game/effects';
import { R1 } from '../layout';
import { P12 } from './text';

const DOOR_IN: V3 = [-5.55, 0, 20.25];
const DOOR: V3 = [-5.02, 0, 20.3];
/**
 * 03:13 他站住、抬头冲门楣说话的地方 = layout 的 npcSpots.zhouDoor（“也是 2023 年 03:12 他站住的地方”，M4 合影构图挪到 (-1.9,21.51)）。
 * 带子里 03:12 的站位是 (-3.4,21.4)（tape.ts FRONT，CH1 的取景按那里定的）。第 2 轮评审建议挪回去；第 2 轮整合把引擎的回放转向改成
 * “写了 focus 的片段在焦点离眼睛 < 0.35m 时才只抬头不转身”（src/game/replay.ts）之后试过：从 GDD §11 步骤 50 的站位 (-3.6,20.8)、
 * 从院里走来的 (-2.6,21.0) 按 R，他离镜头 0.6–0.9m，一团雪花的脑袋占满整个取景器，读不出是个人抬头说话
 * （test-artifacts/work/m4r2-int/booth/）。所以仍站在这里：离门口一带按 R 的玩家 1.8m 上下，半身入画。
 */
const FRONT: V3 = [R1.npcSpots.zhouDoor[0], 0, R1.npcSpots.zhouDoor[2]];
/**
 * 进回放时镜头转向的点：他抬起来的头（M4 第 2 轮；原来缺省取关键帧均值 (-3.57,1.2,20.9)，离站在门口按 R 的玩家不到 0.8m，
 * 镜头不转，“伙计……替我看着点。”响起时他在玩家身后）。
 */
const FOCUS: V3 = [FRONT[0], 1.55, FRONT[2]];
/** 抬头看门楣（CH1 支架）的朝向 */
const UP_YAW = 310;

export const REPLAY_POINTS: readonly ReplayPointDef[] = [
  { id: RP.R1_BOOTH, at: R1.replay.booth, segments: [SEG.BOOTH_2023] },
];

export const SEGMENTS: readonly ReplaySegmentDef[] = [
  {
    // OSD 03:13：录像带里 03:12 他才走出门，03:13–03:14 站在门前抬头（M4 第 2 轮：原来写 03:12，与带子对不上）
    id: SEG.BOOTH_2023, point: RP.R1_BOOTH, order: 1, osd: '2023-08-30 03:13', dur: 24, loop: true, focus: FOCUS,
    actors: [
      {
        id: GHOST.ZHOU_2023, rig: 'mannequin', character: 'zhou', characterOpts: { variant: 'cap', seed: 1960 },
        keys: [
          { t: 0, pos: DOOR_IN, yaw: 90, pose: 'walk' },
          { t: 2.5, pos: DOOR, yaw: 95, pose: 'stand' },          // 扶着门框
          { t: 4.5, pos: DOOR, yaw: 110, pose: 'stand' },
          { t: 7.5, pos: FRONT, yaw: 140, pose: 'walk' },
          { t: 8.5, pos: FRONT, yaw: 150, pose: 'stand' },        // 站住，低着头
          { t: 9.5, pos: FRONT, yaw: UP_YAW, pose: 'look_up' },   // 抬头冲上面说话
          { t: 19, pos: FRONT, yaw: UP_YAW, pose: 'look_up' },
          { t: 20, pos: FRONT, yaw: 250, pose: 'stand' },
          { t: 23, pos: DOOR, yaw: 280, pose: 'walk' },
          { t: 24, pos: DOOR_IN, yaw: 270, pose: 'walk' },
        ],
      },
    ],
    subs: [
      { t: 10.5, dur: 4, speaker: NPC.ZHOU, text: P12.voice[0] },
      { t: 15, dur: 4, speaker: NPC.ZHOU, text: P12.voice[1] },
    ],
    locked: `!${F.R1_TAPE_WATCHED}`,
    lockedText: P12.boothLocked,
    // 看完（播放头第一次越过终点，含 seek）：r1.heard_voice，旁白（GDD §8.9）
    onComplete: [E.flag(F.R1_HEARD_VOICE), E.say(P12.heardVoice)],
  },
];
