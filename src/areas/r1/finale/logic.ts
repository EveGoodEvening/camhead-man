// owner: R1-finale
// 终章的交互物、NPC、录像机/三脚架/监控台（照妖镜那一半）配置与每帧逻辑（ARCH §11.3、§11.6 的 R1-finale 一栏）。
// 交互物：r1.desk r1.vcr r1.crt_jack r1.bracket r1.anthill；NPC：npc.lu（门岗）、npc.zhou。
// 每个写 flag 的处理都先查前置、不满足就给专属反馈且不写 flag（ARCH §11.5 第 2 条）；先写 flag 再开对话/过场（第 9 条）。

import * as THREE from 'three';
import type { AreaContext } from '../../../core/area';
import type { V3 } from '../../../core/types';
import type { GameApi, Handler } from '../../../game/effects';
import type { OfferTable } from '../../../game/interaction';
import type { StateView } from '../../../game/state';
import type { ThingId } from '../../../data/ids';
import { ANT_FLAGS, F, IT, NPC, OBJ, PH } from '../../../data/ids';
import { OLD_PHOTOS } from '../../../data/photos';
import { GAME_DATE, TAPE, TIMING } from '../../../data/time';
import { TEMP_C } from '../../../data/render';
import { STRINGS } from '../../../data/strings';
import { E } from '../../../game/effects';
import { createCharacter } from '../../../rigs/characters';
import { yawToRotY } from '../../../core/math';
import { devWarn } from '../../../core/log';
import { paintTexture } from '../../../kit/canvas';
import { R1 } from '../layout';
import { EXTRA, LABEL, NANKE, P12, P13, P14, ZHOU as ZHOU_LINES } from './text';
import { D } from './dialogue';
import { CS, luLightPath } from './cutscenes';
import { createTapeTrack } from './tape';
import { paintTunnelBaked, paintTunnelInner, smileFaceTexture } from './art';
import type { FinaleRt } from './stage';
import {
  ANTHILL_AT, CH1_POSE, JACK_AT, LU_AT, LU_YAW, LU_LEAVE_SEC, ZHOU_CHAIR, ZHOU_DOOR, ZHOU_DOOR_YAW, arcPath, boxProxy, buildDeskProxy, createRt, proxyForRef, refBox, DESK_AIM, TABLETOP_REACH,
} from './stage';

// ==================================================================== 站位

/** 老周：显形后趴在桌前椅子上；吃完馄饨站到门口；魂还回去以后（卯时）回屋趴着。temp(fin_zhou_out)：合影过场里他还在门口。 */
function zhouPlacement(s: StateView): { pos: V3; yaw: number } | null {
  if (!s.flag(F.R1_ZHOU_VISIBLE)) return null;
  if (s.flag(F.R1_SOUL_RETURNED) && !s.temp('fin_zhou_out')) return { pos: ZHOU_CHAIR, yaw: 180 };
  if (s.flag(F.R1_ZHOU_FED)) return { pos: ZHOU_DOOR, yaw: ZHOU_DOOR_YAW };
  return { pos: ZHOU_CHAIR, yaw: 180 };
}

/** 陆师傅：本相之后在门岗西北角，补上脸以后化光离开（temp(fin_lu_leave)：正在道别/化光，还在）。 */
function luPlacement(s: StateView): { pos: V3; yaw: number; pose: 'stand' } | null {
  if (!s.flag(F.R3_SAW_TRUE_FORM)) return null;
  if (s.flag(F.R1_PORTRAIT_COMPLETE) && !s.temp('fin_lu_leave')) return null;
  return { pos: LU_AT, yaw: LU_YAW, pose: 'stand' };
}

// ==================================================================== 处理器

function nothingHere(g: GameApi): void {
  g.feedback(STRINGS.feedback.nothingHere);
}

/** P14 第 1 步：把馄饨放在他面前（桌子或老周本人都行）。 */
const wonton: Handler = async g => {
  if (!g.state.flag(F.R1_ZHOU_VISIBLE)) {
    g.feedback(P14.wontonEmpty);
    return;
  }
  if (g.state.flag(F.R1_ZHOU_FED)) {
    nothingHere(g);
    return;
  }
  g.markUsed(IT.WONTON);
  // r1.zhou_fed 在对话结束时设（GDD P14 第 1 步），对话在过场里
  await g.cutscene(CS.WONTON);
};

/** 蚁穴收旧照（GDD §5 H）：只收 ph.old_1–6；照片不消耗。 */
async function antsTake(thing: ThingId, g: GameApi): Promise<boolean> {
  const k = (OLD_PHOTOS as readonly string[]).indexOf(thing);
  if (k < 0) return false;
  const flag = ANT_FLAGS[k]!;
  if (g.state.flag(flag)) {
    g.feedback(NANKE.dup);
    return true;
  }
  if (!g.state.flag(F.R1_ABILITY_REPLAY)) return false;
  g.setFlag(flag);
  g.say(NANKE.taken);
  const r = rtRef;
  if (r) {
    const p = g.player.position;
    for (let i = 0; i < 6; i++) {
      r.motes.spawn(() => [p.x + (i - 2.5) * 0.06, 1.1 + (i % 2) * 0.1, p.z], arcPath([(p.x + ANTHILL_AT[0]) / 2, 1.4, (p.z + ANTHILL_AT[2]) / 2], [ANTHILL_AT[0], 0.05, ANTHILL_AT[2]], 0.05), {
        dur: 1.6, delay: i * 0.12, color: '#D8B98A', hdr: 2.2,
      });
    }
  }
  if (ANT_FLAGS.every(f => g.state.flag(f))) {
    g.setFlag(F.R1_NANKE);
    g.say(NANKE.done, NPC.TUDI);
  }
  return true;
}

let rtRef: FinaleRt | null = null;

/**
 * 老周魂影头上的一张笑脸（结局“十九年，你看过他几千回头顶。这是头一回，他冲着你笑。”那一拍，M4）：
 * 与录像带里的五官贴片同一块球面（art.ts smileFaceTexture 的版式），平时藏着，只在 cs.r1.fin_ending 推近的那几秒显示。
 */
function attachSmile(ctx: AreaContext, root: THREE.Object3D): THREE.Mesh | null {
  const head = root.getObjectByName('head');
  if (!head) {
    devWarn('R1-finale：老周的人偶上找不到 head 节点，笑脸贴片没挂上');
    return null;
  }
  const tex = ctx.track(smileFaceTexture());
  const mat = ctx.track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  mat.userData.tempC = TEMP_C.yin;
  // 纬度范围按人偶自己的五官对齐（M4 第 2 轮：原来 0.5–2.0 rad，整张笑脸比人偶的眼睛、嘴高出一截，推近时两张脸叠在一起；
  // 显示笑脸时人偶自己的五官贴图收起来，见 stage.ts 的 sync）
  const geo = ctx.track(new THREE.SphereGeometry(0.1015, 16, 12, Math.PI * 1.5 - 0.95, 1.9, 0.53, 2.18).scale(0.92 * 1.06, 1.12 * 1.06, 1.06));
  const face = new THREE.Mesh(geo, mat);
  face.name = 'fin.zhou.smile';
  face.renderOrder = 12;
  face.userData.noBounds = true;
  face.userData.irHide = true;
  face.raycast = () => {};
  face.visible = false;
  head.add(face);
  return face;
}

// ==================================================================== build

export function buildLogic(ctx: AreaContext): FinaleRt {
  const r = createRt(ctx);
  rtRef = r;

  // ---------------------------------------------------------------- 桌子：摆遗像、补脸、放馄饨
  const deskProxy = buildDeskProxy(ctx);
  const portrait: Handler = async g => {
    if (g.state.flag(F.R1_PORTRAIT_PLACED)) {
      nothingHere(g);
      return;
    }
    g.markUsed(IT.PORTRAIT);
    g.setFlag(F.R1_PORTRAIT_PLACED);
    // 陆师傅只出底部字幕，不进入对话（GDD P13 第 1 步）
    g.say(P13.luPlaced, NPC.LU);
    // M4 第 2 轮：1.8 秒的桌面特写（第三人称里自己的脑袋盖着桌面，刚摆上的画看不见）
    await g.cutscene(CS.PLACE);
  };
  const face: Handler = async g => {
    const s = g.state;
    if (!s.flag(F.R1_PORTRAIT_PLACED)) {
      g.feedback(P13.placeFirst);
      return;
    }
    if (s.flag(F.R1_PORTRAIT_COMPLETE)) {
      nothingHere(g);
      return;
    }
    if (!s.flag(F.R1_HEARD_VOICE)) {
      g.say(P13.luNotYet, NPC.LU);
      return;
    }
    // 陆师傅道别、化成一点光：道别期间他还在（temp），先写 flag 再开过场。
    // M4：补好的遗像先给一个特写（cs.r1.fin_portrait：只看补好的脸 + 主动机，再在特写里道别），不在第三人称里被自己的脑袋挡住
    ctx.setTemp('fin_lu_leave', true);
    g.setFlag(F.R1_PORTRAIT_COMPLETE);
    await g.cutscene(CS.PORTRAIT);
    r.luLeave = 0;
    luLightPath(r);
    // 补上脸以后，土地从槐树下移到门岗门口（站位由 R1-world 按 r1.portrait_complete 推导），说出那句话
    ctx.after(LU_LEAVE_SEC * 0.6, () => ctx.game.say(P13.tudiAfter, NPC.TUDI));
  };
  const deskOffers: OfferTable = {
    accept: { [IT.PORTRAIT]: portrait, [PH.TAPE_FACE]: face, [IT.WONTON]: wonton },
    fallback: (thing, s) => {
      if (thing === IT.TAPE_830) return P12.tapeElsewhere;
      if (!thing.startsWith('ph.')) return STRINGS.feedback.nothingHere;
      if (!s.has(IT.PORTRAIT)) return STRINGS.feedback.nothingHere;
      if (!s.flag(F.R1_PORTRAIT_PLACED)) return P13.placeFirst;
      if (s.flag(F.R1_PORTRAIT_COMPLETE)) return STRINGS.feedback.nothingHere;
      if (thing === PH.COVERED_FACE) return P13.coveredFace;
      if (thing === PH.FILM3) return P13.film3;
      if (thing === PH.OLD_2) return P13.old2;
      return P13.otherPhoto;
    },
  };
  ctx.interactable({
    id: OBJ.R1_DESK, label: LABEL.desk, at: DESK_AIM, hit: deskProxy, priority: 2, proximityFocus: false, menuVerb: 'use',
    // 巡夜本拿走以后桌子才在场（开场桌上只有巡夜本一个角标）；此后随时可用，提前放馄饨、提前摆遗像都有反馈（GDD §6.2 第 6 条）
    present: F.R1_LOG_TAKEN,
    offers: deskOffers,
  });

  // ---------------------------------------------------------------- 录像机
  // 录像机：按 R1-world 的录像机网格的实际包围盒，往上加高（见 stage.ts 的 DESK_PROXY 注释）
  const vcrBox = refBox(ctx, OBJ.R1_VCR, { center: R1.derived.vcrBody.center as V3, size: R1.derived.vcrBody.size as V3 });
  vcrBox.expandByScalar(0.01);
  const vcrTop = vcrBox.max.y;
  vcrBox.max.y = Math.max(vcrBox.max.y, TABLETOP_REACH);
  const vcrHit = boxProxy(ctx, 'fin.hit.vcr', vcrBox);
  r.anchors.vcr = [(vcrBox.min.x + vcrBox.max.x) / 2, vcrTop + 0.02, (vcrBox.min.z + vcrBox.max.z) / 2];
  ctx.interactable({
    id: OBJ.R1_VCR, label: LABEL.vcr, at: r.anchors.vcr, hit: vcrHit, proximityFocus: false, menuVerb: 'use',
    onInteract: g => {
      if (g.state.flag(F.R1_TAPE_IN_VCR)) return g.vcr.open();
      g.feedback(EXTRA.vcrEmpty);
      return undefined;
    },
    offers: s => (s.flag(F.R1_TAPE_IN_VCR) ? undefined : {
      accept: { [IT.TAPE_830]: [E.flag(F.R1_TAPE_IN_VCR), E.used(IT.TAPE_830), E.call(g => g.vcr.insert())] },
    }),
  });
  const crt = ctx.getRef(OBJ.R1_CRT);
  if (crt && (crt as THREE.Mesh).isMesh) {
    ctx.vcr({
      screen: crt as THREE.Mesh,
      viewPose: R1.derived.panelView,
      track: createTapeTrack(ctx),
      timelapseUntil: TAPE.timelapseUntil,
      alarmFrom: TAPE.alarmFrom,
      slowZone: TAPE.slowZone,
      index: TAPE.index,
      // 播放头以任何方式到达或越过 03:16:00（含正好跳到这个索引点）即设 r1.tape_watched（GDD §3.8）
      events: [{ tc: TAPE.watchedAt, effects: [E.flag(F.R1_TAPE_WATCHED)] }],
      // 05:12 天亮了、没人叫他（M4 第 2 轮：片名“天亮了，叫我”的第一次出现，原来只有 CH2 的窗户变亮，玩家很容易看漏）
      subtitles: [
        { from: TAPE.events.steps[0], to: TAPE.events.steps[1], text: P12.noSound },
        { from: TAPE.events.dawn, to: '05:13:30', text: P12.dawnNobody },
      ],
    });
  } else {
    devWarn('R1-finale：找不到 r1.crt 屏幕网格（R1-world 的 ref），录像机没有配置');
  }

  // ---------------------------------------------------------------- 视频入1（插上后离桌子超过 2m 自动拔出，见 update）
  const jackNode = ctx.getRef(OBJ.R1_CRT_JACK);
  const jp = jackNode ? jackNode.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(...JACK_AT);
  r.anchors.jack = [jp.x, jp.y, jp.z - 0.012];
  // 插孔很小（R1-world 的 BNC 座）：代理是贴在录像机前面板外侧的一片竖条（往上加高，见 DESK_PROXY 注释），对准它时总是最近的那一个
  const jackBox = new THREE.Box3(new THREE.Vector3(jp.x - 0.13, jp.y - 0.03, jp.z - 0.1), new THREE.Vector3(jp.x + 0.13, 3.0, jp.z - 0.006));
  const jackHit = { mesh: boxProxy(ctx, 'fin.hit.jack', jackBox) };
  ctx.interactable({
    id: OBJ.R1_CRT_JACK, label: LABEL.jack, at: r.anchors.jack, hit: jackHit.mesh, priority: 1, range: 2.5, proximityFocus: false,
    onInteract: g => {
      g.cctv.plugJack();
      const node = ctx.getRef(OBJ.R1_CRT_JACK);
      if (node && !g.player.model.cable.plugged) g.player.model.cable.plugTo(node);
      g.feedback(P13.jackIn);
    },
  });

  // ---------------------------------------------------------------- 门楣空支架 → 强制确认 → 三脚架
  // 空支架：代理只包住云台底座那一截（R1-world 的支架包围盒还带着垂下来的断线头，太大会挡住门口的老周）
  const mountAt = r.mount.getWorldPosition(new THREE.Vector3());
  // 往下、往外放大到门楣一带：仰拍支架时第三人称准星的俯仰迭代会差个十几二十公分（门洞在 2.05m 以下，不盖住）
  const bracketHit = boxProxy(ctx, 'fin.hit.bracket', new THREE.Box3(
    new THREE.Vector3(Math.max(R1.booth.x1 + 0.02, mountAt.x - 0.35), 2.12, mountAt.z - 0.4),
    new THREE.Vector3(mountAt.x + 0.35, mountAt.y + 0.2, mountAt.z + 0.4),
  ));
  r.anchors.bracket = [mountAt.x, mountAt.y, mountAt.z];
  ctx.interactable({
    id: OBJ.R1_BRACKET, label: LABEL.bracket, at: r.anchors.bracket, hit: bracketHit, range: 3.2, proximityFocus: false,
    present: `!${F.R1_SOUL_RETURNED}`,
    when: F.R1_ZHOU_FED, blocked: P14.bracketNotYet,
    onInteract: g => g.dialogue(D.BRACKET),
  });
  // 站在门口等合影的老周挡人（M4 第 2 轮）：合影判定只看身子离粉笔叉 ≤ 1.5m，他站的地方离叉只有 0.9m，
  // 原来身子可以直接走进他的魂影里过关，拍出来两人叠在一起。吃完馄饨到合影成功之间给他一个 0.5m 见方的碰撞盒
  // （加上身子的半径 0.3m，两人至少隔 0.55m）；不挡视线检查（seeThrough），合影成功（r1.soul_returned）即撤掉，过场里他照常走回屋
  ctx.collider.dynamic('r1f_zhou_door', { box: { center: [ZHOU_DOOR[0], 0.9, ZHOU_DOOR[2]], size: [0.5, 1.8, 0.5] } }, `${F.R1_ZHOU_FED} && !${F.R1_SOUL_RETURNED}`, { seeThrough: true });
  ctx.tripod({
    mount: r.mount,
    camPose: CH1_POSE,
    zone: R1.markPhoto,
    radius: R1.markPhotoRadius,
    countdown: TIMING.tripodCountdownSec,
    stillSec: TIMING.tripodStillSec,
    osd: rem => EXTRA.tripodOsd(GAME_DATE.after, rem),
    // 合影成功：r1.soul_returned（先写 flag），再开过场。过场里他还在门口（temp），走回屋再交还站位
    onSuccess: async g => {
      ctx.setTemp('fin_zhou_out', true);
      g.setFlag(F.R1_SOUL_RETURNED);
      await g.cutscene(CS.SOUL);
    },
    onFailOutside: [E.say(ZHOU_LINES.failOutside, NPC.ZHOU), E.feedback(P14.failOutside)],
    onFailMoved: [E.say(ZHOU_LINES.failMoved, NPC.ZHOU), E.feedback(P14.failMoved)],
  });

  // ---------------------------------------------------------------- 蚁穴
  const antHit = proxyForRef(ctx, OBJ.R1_ANTHILL, 0.1, { center: ANTHILL_AT, size: [0.4, 0.14, 0.4] });
  r.anchors.anthill = [antHit.center[0], Math.max(antHit.center[1], 0.1), antHit.center[2]];
  ctx.interactable({
    id: OBJ.R1_ANTHILL, label: LABEL.anthill, at: r.anchors.anthill, hit: antHit.mesh, menuVerb: 'use',
    offers: {
      accept: {},
      any: antsTake,
      fallback: thing => (thing.startsWith('ph.') ? NANKE.other : NANKE.item),
    },
  });

  // ---------------------------------------------------------------- 照妖镜（ConsoleConfig 的 R1-finale 那一半）
  const baked = ctx.track(paintTexture(512, 384, (g, w, h) => paintTunnelBaked(g, w, h, false)));
  r.baked = { tex: baked, zhou: false };
  ctx.console({
    tunnelInner: (g, w, h, s) => paintTunnelInner(g, w, h, s.flag(F.R1_PORTRAIT_COMPLETE)),
    tunnelBaked: () => baked,
  });

  // ---------------------------------------------------------------- NPC：老周
  const zhou = createCharacter('zhou', { look: 'ghost', variant: 'slump', seed: 1960 });
  r.zhou = zhou;
  r.zhouSmile = attachSmile(ctx, zhou.root);
  r.zhouNpc = ctx.npc({
    id: NPC.ZHOU, rig: zhou, yin: false, tempC: TEMP_C.yin,
    placement: zhouPlacement,
    interact: {
      label: LABEL.zhou, view: 'any', present: F.R1_ZHOU_VISIBLE, anchorY: 1.0, priority: 1, menuVerb: 'use',
      talk: [
        { when: `!${F.R1_ZHOU_FED}`, dialogue: D.ZHOU_ASLEEP },
        { when: `${F.R1_ZHOU_FED} && !${F.R1_SOUL_RETURNED}`, dialogue: D.ZHOU_DOOR },
      ],
      offers: s => (s.flag(F.R1_ZHOU_FED) ? undefined : { accept: { [IT.WONTON]: wonton } }),
    },
    // 换站位（椅子 ↔ 门口）：本来就走到了就只对齐，不然淡出淡入挪过去
    onPlaced: (npc, prev) => {
      const p = zhouPlacement(ctx.state);
      if (!p || !prev) return;
      const d = Math.hypot(npc.root.position.x - p.pos[0], npc.root.position.z - p.pos[2]);
      if (d < 0.6) {
        npc.root.position.set(...p.pos);
        npc.root.rotation.y = yawToRotY(p.yaw);
        return;
      }
      void npc.fadeTo(p.pos, p.yaw, 1.2);
    },
  });

  // ---------------------------------------------------------------- 土地（R1-world 的 NPC）：显形以后、吃饭以前的一句（GDD P14“线索”）
  ctx.addTalk(NPC.TUDI, [{ when: `${F.R1_ZHOU_VISIBLE} && !${F.R1_ZHOU_FED}`, dialogue: D.TUDI_WONTON }], { first: true });

  // ---------------------------------------------------------------- NPC：陆师傅（门岗）
  const lu = createCharacter('lu', { look: 'ghost', seed: 11 });
  r.lu = lu;
  // 出示遗像或 03:14 那张照片：“搁桌上。”（不写 flag；M4：P13 第 1–2 步原来没有任何线索指向桌子）
  const luShow: Handler = g => g.say(P13.luShow, NPC.LU);
  r.luNpc = ctx.npc({
    id: NPC.LU, rig: lu, yin: true, tempC: TEMP_C.yin,
    placement: luPlacement,
    interact: {
      label: LABEL.lu, view: 'viewfinder', revealOnVfInteract: true, talk: [{ dialogue: D.LU_BOOTH }],
      offers: s => (s.flag(F.R1_PORTRAIT_COMPLETE) ? undefined : { accept: { [IT.PORTRAIT]: luShow, [PH.TAPE_FACE]: luShow } }),
    },
  });

  return r;
}


// ==================================================================== 每帧

/** 插着线离桌子超过 2m 自动拔出（GDD P13 第 3 步）。 */
const JACK_REACH = 2;

export function updateLogic(r: FinaleRt, dt: number): void {
  const ctx = r.ctx;
  const g = ctx.game;
  // 视频线
  if (g.cctv.jack) {
    const p = g.player.position;
    if (Math.hypot(p.x - R1.desk[0], p.z - R1.desk[2]) > JACK_REACH) {
      g.cctv.unplugJack();
      if (g.player.model.cable.plugged) g.player.model.cable.plugTo(null);
    }
  }
  // 照妖镜啸叫：套叠三层起，越深越密（GDD §9.5）
  const depth = g.cctv.tunnelDepth();
  if (depth >= 3) {
    r.howlT -= dt;
    if (r.howlT <= 0) {
      g.sfx('feedback_howl');
      r.howlT = 1.5 / (1 + (depth - 3) * 0.6);
    }
  } else {
    r.howlT = 0;
  }
  // 预制照妖镜的最深处跟着补脸换一版
  const want = ctx.state.flag(F.R1_PORTRAIT_COMPLETE);
  if (r.baked && r.baked.zhou !== want) {
    const cv = r.baked.tex.image as HTMLCanvasElement;
    const cg = cv.getContext('2d');
    if (cg) paintTunnelBaked(cg, cv.width, cv.height, want);
    r.baked.tex.needsUpdate = true;
    r.baked.zhou = want;
  }
  // 曝光开始：老周“别动啊。……我也不动。”
  const st = g.tripod.state;
  if (st === 'exposing' && r.tripodPrev !== 'exposing') g.say(ZHOU_LINES.exposing, NPC.ZHOU, TIMING.tripodStillSec);
  r.tripodPrev = st;
}
