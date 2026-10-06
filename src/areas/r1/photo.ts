// owner: R1-world
// R1-world 的拍照目标与读字目标（GDD §7.3、H 表）：pt.tudi、pt.old_1、pt.old_2；rd.switch_labels、rd.sticker_mirror、rd.obituary_hidden。
// （pt.tape_face、pt.zhou_tunnel、pt.final 与镜子诱饵归 R1-finale，docs/requests/r1-world.md #3。）

import type { PhotoTargetDef } from '../../game/photo';
import type { ReadTargetDef } from '../../game/read';
import type { AreaDef } from '../../core/area';
import { F, GHOST, NPC, OBJ, PT, RD, SEG } from '../../data/ids';
import { E } from '../../game/effects';
import { DLG_ID } from './dialogue';
import { FB, READ, TUDI } from './text';
import { SWITCH_LABELS_AT } from './build/booth';
import { OBITUARY_HIDDEN_AT } from './build/yard';

export const PHOTO_TARGETS: readonly PhotoTargetDef[] = [
  {
    // P1：取景器里拍土地（GDD §7.3：live、常光、≤6m、≥1×、条件 r1.gate_lamp_on）
    id: PT.TUDI,
    subjects: [{ ref: NPC.TUDI }],
    maxDist: 6, minZoom: 1, lens: 'normal',
    context: { kind: 'live' },
    when: F.R1_GATE_LAMP_ON,
    // 先写 flag 再开对话（ARCH §11.5 第 9 条）；幂等：只在第一次拍到时写、接话。
    // 没跟他说话就直接拍（拍照游戏里很自然）：先补上初见的前半句“……看门的，站那么远干啥？”，再接“嗯，手不抖”（M4，GDD P1 第 5–6 步的次序）
    onHit: async g => {
      if (g.state.flag(F.R1_MET_TUDI)) return;
      const talked = g.state.seen(DLG_ID.tudiFirst);
      g.setFlag(F.R1_MET_TUDI);
      g.setFlag(F.R1_ABILITY_REPLAY);
      // 拍下来就算“看见过”：此后常光下是土地本人，不再是自己飘着的灯笼（与取景器里跟他说话同效，GDD §4.6）
      await g.run([E.seen(NPC.TUDI)]);
      if (!talked) await g.dialogue(DLG_ID.tudiFirstShot);
      await g.dialogue(DLG_ID.tudiPhoto);
    },
    // 没点门灯就拍：土地那句“先把门口灯点上”（前置未满足，不写 flag）；没对准：“往哪儿照呢？照我。”
    captions: { cond: TUDI.noLamp, not_in_frame: FB.tudiMissed, partial: FB.tudiMissed },
  },
  {
    // 旧照一：1984 年槐下大合影（seg.tree_1984 第 5–15 秒，≤8m，≥1×，常光）
    id: PT.OLD_1,
    subjects: [{ ref: GHOST.CROWD_1984 }],
    maxDist: 8, minZoom: 1, lens: 'normal',
    context: { kind: 'replay', segment: SEG.TREE_1984, t: [5, 15] },
    when: F.R1_ABILITY_REPLAY,
  },
  {
    // 旧照二：2012 年车棚，老周扶着后座教孩子骑车（seg.shed_2012 第 4–14 秒）
    id: PT.OLD_2,
    subjects: [{ ref: GHOST.ZHOU_2012 }, { ref: GHOST.KID_2012 }],
    maxDist: 8, minZoom: 1, lens: 'normal',
    context: { kind: 'replay', segment: SEG.SHED_2012, t: [4, 14] },
    when: F.R1_ABILITY_REPLAY,
  },
];

export const READ_TARGETS: readonly ReadTargetDef[] = [
  // P1：电闸上的四张贴条（取景器、≤2m）
  { id: RD.SWITCH_LABELS, at: SWITCH_LABELS_AT, maxDist: 2, minZoom: 1, text: READ.switchLabels },
  // P2：镜子里自己脑门上的贴条（镜头到镜面平面 ≤1.2m、≥3×；虚像须落在镜面圆盘里，GDD §3.14、§7.3）
  {
    id: RD.STICKER_MIRROR, at: g => g.player.model.stickerWorld(), via: { mirror: OBJ.R1_MIRROR },
    maxDist: 1.2, minZoom: 3, mirror: true, text: READ.stickerMirror, notInMirror: FB.notInMirror,
  },
  // 公告栏：拆迁公告底下被盖住的讣告下半截（取景器 ≥2×）
  { id: RD.OBITUARY_HIDDEN, at: OBITUARY_HIDDEN_AT, maxDist: 4, minZoom: 2, text: READ.obituaryHidden },
];

/** 本区空镜的默认标题：土地叫你照一张之后、对着他那边乱按快门（GDD P1“往哪儿照呢？照我。”）。 */
export const emptyCaption: NonNullable<AreaDef['emptyCaption']> = (s, near) =>
  s.flag(F.R1_GATE_LAMP_ON) && !s.flag(F.R1_MET_TUDI) && (near === NPC.TUDI || near === OBJ.R1_SHRINE) ? FB.tudiMissed : undefined;
