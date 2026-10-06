// owner: R1-finale
// R1-finale 的入口（ARCH §2.11、§11.1）：export default { …AreaPart }，由冻结的 r1/index.ts 与 R1-world 的 world.ts 合并。
// 与 R1-world 互不 import，只通过 ../layout.ts、flags/物品/照片、ctx.getRef()（r1.desk r1.crt r1.vcr r1.crt_jack r1.bracket r1.mirror）、
// ctx.console() 的另一半字段（tunnelInner/tunnelBaked）与 NPC 根节点的 ref 耦合。
//
// 负责：P12（录像带 tapeScene、门口倒带）、P13（遗像、补脸、视频线、照妖镜）、P14（馄饨、合影三脚架、天亮叫醒）、南柯、结局与尾声；
// 交互物 r1.desk r1.vcr r1.crt_jack r1.bracket r1.anthill；NPC npc.lu（门岗）npc.zhou；对话 dlg.r1.bracket_confirm 与 dlg.r1.fin_*；
// 过场 cs.r1.dawn（id 固定）与 cs.r1.fin_*（见 cutscenes.ts）。

import type { AreaPart } from '../../../core/area';
import { F, OBJ } from '../../../data/ids';
import { LOOK } from '../../../data/render';
import { DIALOGUES } from './dialogue';
import { PUZZLES } from './puzzles';
import { PHOTO_DECOYS, PHOTO_TARGETS, READ_TARGETS } from './photo';
import { REPLAY_POINTS, SEGMENTS } from './replay';
import { CUTSCENES } from './cutscenes';
import { SHOTS } from './shots';
import { buildLogic, updateLogic } from './logic';
import { clearRt, rt, sync, DESK_AIM } from './stage';
import { EPILOGUE_CAM, WORKER_ON_LADDER, buildCredits, buildEpilogue, buildNanke } from './ending';
import { yawToRotY, yawTowards } from '../../../core/math';
import { MAO_POST, stageShot } from './cutscenes';
import type { EpilogueSet, CreditsStage } from './ending';

/** 截图用：已经走到结局（r1.called_at_dawn）的状态进区域时，把尾声、片尾、南柯的布景直接摆好（正常流程里它们由过场的 run 步骤按需建）。 */
function stageForShots(): void {
  const r = rt();
  if (!r) return;
  const ctx = r.ctx;
  // 卯时、还没叫醒（截图的 'mao' 预置；正常流程里只会在 cs.r1.dawn 里）：天亮后的雾、半球光与天穹，雨停
  if (ctx.state.flag(F.R1_SOUL_RETURNED) && !ctx.state.flag(F.R1_CALLED_AT_DAWN)) {
    r.env.mode = 'dawn';
    r.env.t01 = 1;
    r.env.hideFollowers(true, false);
    ctx.game.post.push(MAO_POST.key, MAO_POST.params);
    return;
  }
  if (!ctx.state.flag(F.R1_CALLED_AT_DAWN)) return;
  r.env.mode = 'morning';
  // 土地已经领着光出了院门（结局过场里写的；R1-world 的 tudiPlacement 读它）
  ctx.setTemp('fin_tudi_gone', true);
  ctx.game.post.push('fin.morning', { exposure: LOOK.exposure + 0.05, tint: [0.96, 0.9, 0.84], tintAmt: 0.18, grain: 0.05, vignette: 0.45 });
  const e: EpilogueSet = buildEpilogue(ctx);
  r.sets.epilogue = e;
  e.excavator.position.x = 3.5;
  e.worker.root.visible = true;
  e.worker.root.position.set(...WORKER_ON_LADDER);
  e.worker.root.rotation.y = yawToRotY(yawTowards(WORKER_ON_LADDER, EPILOGUE_CAM.pos));
  e.worker.setPose('look_up', 0);
  const c: CreditsStage = buildCredits(ctx, ctx.game);
  r.sets.credits = c;
  c.show(4, 1, 0.6);
  const n = buildNanke(ctx);
  r.sets.nanke = n;
  r.env.hideFollowers(true);
}

/**
 * M4（性能）：已经走到终章后半（r1.soul_returned，或寅时录像带已经放进录像机）时，进区域就把尾声、片尾、南柯三组布景藏着建好：
 * AreaManager 的预热会把藏着的无灯子树临时显示、真渲一遍，程序在进区域时编译、贴图在进区域时上传；结局过场里只切可见。
 * 其余时候（没走到这一步就进了区域）由过场的 run 步骤现建，和原来一样（首帧在黑幕后面卡一下）。画布预算 < 64MB（三组约 8.4MB）。
 */
function prebuildEnding(): void {
  const r = rt();
  if (!r) return;
  const s = r.ctx.state;
  if (!(s.flag(F.R1_SOUL_RETURNED) || (s.flag(F.R4_GOT_TAPE) && s.flag(F.R1_TAPE_IN_VCR)))) return;
  if (!r.sets.epilogue) {
    const e = buildEpilogue(r.ctx);
    e.group.visible = false;
    r.sets.epilogue = e;
  }
  if (!r.sets.credits) {
    const c = buildCredits(r.ctx, r.ctx.game);
    c.group.visible = false;
    r.sets.credits = c;
  }
  if (!r.sets.nanke) {
    const n = buildNanke(r.ctx);
    n.group.visible = false;
    r.sets.nanke = n;
  }
}

const finale = {
  dialogues: DIALOGUES,
  cutscenes: CUTSCENES,
  puzzles: PUZZLES,
  photoTargets: PHOTO_TARGETS,
  photoDecoys: PHOTO_DECOYS,
  readTargets: READ_TARGETS,
  replayPoints: REPLAY_POINTS,
  segments: SEGMENTS,
  shots: SHOTS,
  // 调试 API 的瞄准点（ARCH §12.3）：r1.desk 瞄遗像那一小块桌面；其余交互物的锚点按 R1-world 的实际网格在 build 时算（interactable.at）
  automation: {
    [OBJ.R1_DESK]: { aim: DESK_AIM },
  },
  build(ctx) {
    buildLogic(ctx);
    stageForShots();
    prebuildEnding();
  },
  update(_ctx, dt) {
    const r = rt();
    if (!r) return;
    updateLogic(r, dt);
    sync(r, dt);
    stageShot(r);
  },
  onExit() {
    clearRt();
  },
} satisfies AreaPart;

export default finale;

