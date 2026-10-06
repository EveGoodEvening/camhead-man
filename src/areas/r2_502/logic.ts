// owner: R2
// R2_502 的玩法逻辑（GDD P5、§4.3、§4.6）：王奶奶（灶前）、灶君（取景器里交互，眼珠往左下瞟）、三块新瓷砖（只有左下那块抠得开）、
// 出示信 → 读信过场（灶火亮、化光、开火眼）、灶台、挂历。灯 3 盏：月光半球光、窗外月光方向光、灶火点光（进屋就在，灶火亮之前强度 0）。

import * as THREE from 'three';
import type { AreaContext } from '../../core/area';
import type { GameEvents } from '../../core/events';
import { DOC, F, IT, NPC, OBJ, SEG, SPK } from '../../data/ids';
import type { ThingId } from '../../data/ids';
import { LIGHT_SCALE, TEMP_C } from '../../data/render';
import { PALETTE } from '../../data/palette';
import { E } from '../../game/effects';
import type { GameApi } from '../../game/effects';
import type { StateView } from '../../game/state';
import { designLight } from '../../kit/lamps';
import { DEG2RAD, yawToRotY } from '../../core/math';
import { createCharacter } from '../../rigs/characters';
import { TEXT } from './text';
import { CS_LETTER, DLG_502 } from './dialogue';
import { L502, WANG_EYE_Y, letterAt, letterCamAt } from './layout';
import { ZAO_OVERLAY, type Apt } from './build/rooms';
import { SCENE, ZAO } from './anim';

/** 王奶奶在 502 的站位：门神放行后在灶前，读完信化光离开（过场里靠临时状态 farewell 多留一会儿）。 */
export function wangPlacement502(s: StateView): { pos: readonly [number, number, number]; yaw: number } | null {
  if (!s.flag(F.R2_MENSHEN_OPEN)) return null;
  if (s.flag(F.R2_WANG_DONE) && s.temp('farewell') !== true) return null;
  return { pos: L502.wang, yaw: 245 };
}

/** 灶火此刻亮不亮（读信过场里先不亮，王奶奶读完信才点着）。 */
export const fireLit = (s: StateView): boolean => s.flag(F.R2_WANG_DONE) && s.temp('fire_hold') !== true;

export interface R502Runtime { update(dt: number): void; onFlag(e: GameEvents['flag']): void }

export function buildLogic502(ctx: AreaContext, apt: Apt): R502Runtime {
  const g: GameApi = ctx.game;
  const K = L502;

  // —— 灯（3 盏）
  ctx.hemi('#9DB8C8', '#0E0C0A', 0.12);
  const moon = new THREE.DirectionalLight('#34405A', 0.3 * LIGHT_SCALE.dir);
  moon.name = 'moon';
  // 月亮在西南偏高：南窗进来的月光（无阴影的补光）也照得到朝西的灶台正面、灶君与瓷砖
  moon.position.set(-2.5, 6, 5);
  moon.target.position.set(4, 0, -2.5);
  ctx.light(moon);
  const stove = designLight('point', PALETTE.STOVE, 1.2, 4) as THREE.PointLight;
  stove.name = 'stoveFire';
  const stoveCd = stove.intensity;
  stove.intensity = 0;
  stove.position.set(K.stoveFire[0] - 0.3, K.stoveFire[1] + 0.3, K.stoveFire[2]);
  ctx.light(stove);

  // —— 王奶奶
  const rig = createCharacter('wang', { look: 'ghost', seed: 3 });
  SCENE.wangRig = rig;
  SCENE.wangRoot = rig.root;
  SCENE.orb = apt.orb;
  const nothingSay = (api: GameApi) => api.say(TEXT.show.other, NPC.WANG);
  ctx.npc({
    id: NPC.WANG, rig, yin: true, tempC: TEMP_C.yin, photoAnchorY: 1.2,
    placement: s => {
      const p = wangPlacement502(s);
      return p ? { pos: p.pos, yaw: p.yaw, pose: s.temp('reading') === true ? 'carry' : 'stand' } : null;
    },
    interact: {
      label: TEXT.label.wang, view: 'viewfinder', revealOnVfInteract: true, priority: 1, anchorY: 1.1, menuVerb: 'show',
      onInteract: [E.dialogue(DLG_502.WANG_ENTER)],
      offers: s => (s.flag(F.R2_WANG_DONE) ? undefined : {
        accept: {
          // P5 解法 4：出示信 → 读信过场；先写 flag 与物品，再开过场（ARCH §11.5 第 9 条）
          [IT.LETTER]: async api => {
            const st = api.state;
            if (st.flag(F.R2_WANG_DONE)) return;
            if (!st.flag(F.R2_MENSHEN_OPEN) || !st.flag(F.R2_TIN_OPENED)) {
              nothingSay(api);
              return;
            }
            ctx.setTemp('farewell', true);
            ctx.setTemp('fire_hold', true);
            api.markUsed(IT.LETTER);
            api.setFlag(F.R2_WANG_DONE);
            api.setFlag(F.R2_ABILITY_IR);
            api.give(IT.WONTON);
            api.give(IT.MONEY);
            await api.cutscene(CS_LETTER);
          },
          // 错误反馈（GDD P5）：不推进
          [IT.TRAIN_TICKET]: api => { api.say(TEXT.show.ticket, NPC.WANG); },
          [IT.GLASSES]: api => { api.say(TEXT.show.glasses, NPC.WANG); },
        },
        any: (_thing: ThingId, api: GameApi) => {
          nothingSay(api);
          return true;
        },
      }),
    },
  });

  // —— 灶君（取景器里交互，GDD P5 解法 2）：角标锚在纸像底下供桌与“一家之主”那一截（中心往下 0.275m），
  // 不压在两张脸上——取景器里要看的是眼珠往哪儿瞟
  ctx.interactable({
    id: OBJ.R2_ZAOJUN, label: TEXT.label.zaojun, at: [K.zaojun[0], K.zaojun[1] - 0.275, K.zaojun[2]], hit: apt.zaojun,
    // M4 第 2 轮：不参与就近聚焦——只在准星直接对着纸像时选中。原来在灶台跟前低头找瓷砖时（射线够不到砖），就近规则按 priority
    // 把灶君选上，E 弹出灶君对话，把“抠开左下那块”这一步打断
    view: 'viewfinder', priority: 2, proximityFocus: false,
    onInteract: api => api.dialogue(api.state.flag(F.R2_WANG_DONE) ? DLG_502.ZAOJUN_DONE : DLG_502.ZAOJUN_FIRST),
  });

  // —— 三块新瓷砖：角标一律“瓷砖”，前置/看破都写在 onInteract 里（GDD §10.2）
  const tileRun = (which: 'left' | 'right' | 'top') => async (api: GameApi) => {
    const s = api.state;
    if (which === 'right') { api.feedback(TEXT.fb.tileRightLow); return; }
    if (which === 'top') { api.feedback(TEXT.fb.tileTop); return; }
    if (s.flag(F.R2_TIN_OPENED)) { api.feedback(TEXT.fb.tileEmpty); return; }
    // 前置：门神放行进了屋（GDD P5 前置 r2.menshen_open）；不满足时与另外两块同样的“死砖”反馈
    if (!s.flag(F.R2_MENSHEN_OPEN)) { api.feedback(TEXT.fb.tileRightLow); return; }
    api.sfx('tile_pry', [K.tileLeftLow[0], K.tileLeftLow[1], K.tileLeftLow[2]]);
    api.setFlag(F.R2_TIN_OPENED);
    api.give(IT.LETTER);
    api.give(IT.TRAIN_TICKET);
    api.give(IT.GLASSES);
    // M4 第 2 轮：拾取即在阅读器里翻开建国的信（与拾取巡夜本自动翻开同一个体验）——信里门神、电梯、“写包”几处回收 P4、捐款榜与
    // 七月半，原来只有主动打开物品栏的人才读得到。openDoc 阻塞到合上；合上后再说一句盒子里还有什么
    await api.openDoc(DOC.LETTER_JIANGUO);
    api.feedback(TEXT.fb.tinFound);
  };
  // priority 1（高于灶台）：射线先穿过低处两块砖的拾取代理盒、再打到灶台面时选砖；就近聚焦时砖也排在灶台前面
  ctx.interactable({ id: OBJ.R2_TILE_LEFT_LOW, label: TEXT.label.tile, at: [K.tileLeftLow[0] - 0.02, K.tileLeftLow[1], K.tileLeftLow[2]], hit: apt.tiles.left, priority: 1, onInteract: tileRun('left') });
  ctx.interactable({ id: OBJ.R2_TILE_RIGHT_LOW, label: TEXT.label.tile, at: [K.tileRightLow[0] - 0.02, K.tileRightLow[1], K.tileRightLow[2]], hit: apt.tiles.right, priority: 1, onInteract: tileRun('right') });
  ctx.interactable({ id: OBJ.R2_TILE_TOP, label: TEXT.label.tile, at: [K.tileTop[0] + 0.02, K.tileTop[1], K.tileTop[2]], hit: apt.tiles.top, priority: 1, onInteract: tileRun('top') });

  // —— 灶台、挂历
  ctx.interactable({
    // 锚点在煤气灶上（z = 灶台中线，两块低处瓷砖的拾取代理盒之间；M4 第 2 轮，原来偏南 0.35m 贴着右下砖的代理盒）
    id: OBJ.R2_STOVE, label: TEXT.label.stove, at: [6.95, 0.95, (K.counter.z0 + K.counter.z1) / 2], hit: apt.counter,
    onInteract: api => api.feedback(fireLit(api.state) ? TEXT.fb.stoveLit : TEXT.fb.stoveCold),
  });
  ctx.interactable({
    id: OBJ.R2_CALENDAR, label: TEXT.label.calendar, at: [K.calendar[0], K.calendar[1], K.calendar[2] - 0.02], hit: apt.calendar,
    onInteract: [E.feedback(TEXT.fb.calendar)],
  });

  // —— 视觉状态（全部由 flags 与临时状态推导）
  const sync = () => {
    const s = ctx.state;
    const opened = s.flag(F.R2_TIN_OPENED);
    apt.tiles.left.visible = !opened;
    apt.hole.visible = opened;
    apt.tin.visible = opened && !s.flag(F.R2_WANG_DONE);
    apt.cooked.visible = s.flag(F.R2_WANG_DONE) && s.temp('fire_hold') !== true;
    // 读信过场：王奶奶手上那页信
    apt.letter.visible = s.temp('reading') === true;
  };
  sync();
  ctx.on('temp', () => sync());

  let fire = fireLit(ctx.state) ? 1 : 0;
  let pastDay = false;
  const DAY = new THREE.Color('#fff0d8').multiplyScalar(3.2);
  const winBase = new Map<THREE.MeshBasicMaterial, THREE.Color>(apt.windowViews.map(m => [m, m.color.clone()] as const));
  let t = 0;
  let vfWas = false;
  let vfHold = 0;
  const wh = new THREE.Vector3();
  const readFwd = new THREE.Vector3();
  const readEye = new THREE.Vector3();
  const readAt = new THREE.Vector3();
  const readCam = new THREE.Vector3();
  return {
    update(dt) {
      t += dt;
      const s = ctx.state;
      // 回放 1986 年腊月的下午：灶上正煮着馄饨（那会儿的火是好的），窗外是下午的天光
      const past = g.replay.active?.seg === SEG.KITCHEN_1986;
      if (past !== pastDay) {
        pastDay = past;
        for (const [mat, base] of winBase) mat.color.copy(past ? DAY : base);
      }
      // 灶火：亮起时 1.5 秒烧旺，之后一直青火闪动
      const want = fireLit(s) || past ? 1 : 0;
      fire = want > fire ? Math.min(1, fire + dt / 1.5) : want;
      apt.fire.visible = fire > 0.01;
      const flick = 0.85 + 0.1 * Math.sin(t * 17) + 0.05 * Math.sin(t * 41);
      stove.intensity = stoveCd * fire * flick;
      apt.flames.forEach((f, i) => {
        const k = fire * (0.75 + 0.35 * Math.abs(Math.sin(t * 9 + i * 1.7)));
        f.scale.set(1, Math.max(0.05, k), 1);
      });
      // 灶君的眼珠（取景器里才看得见）：平时每 5 秒往左下瞟 2.5 秒；刚举起取景器的头 3 秒、灶王奶奶那一句时一直瞟着
      // （以玩家面朝灶台为准：左 = 北 -z，下 = -y）
      ZAO.glance = Math.max(0, ZAO.glance - dt);
      ZAO.t += dt;
      const vfOn = g.vf.on;
      if (vfOn && !vfWas) vfHold = 3;
      vfWas = vfOn;
      vfHold = Math.max(0, vfHold - dt);
      const k = ZAO.glance > 0 || vfHold > 0 || (t % 5) >= 2.5 ? 1 : 0;
      apt.pupils.forEach(p => {
        // zaojun 组绕 y 转了 -90°：局部 -x 是世界 -z（玩家的左手边）；眼珠贴到椭圆眼白的左下沿（ZAO_OVERLAY）
        wh.copy(p.home);
        wh.x -= ZAO_OVERLAY.glanceX * k;
        wh.y -= ZAO_OVERLAY.glanceY * k;
        p.mesh.position.lerp(wh, Math.min(1, dt * 10));
      });
      // 读信：王奶奶转过身面朝灶君，信纸在她手上、正面朝着她的眼睛（过场近景 CAM_LETTER 从她右肩后头看）
      // （rig.root 挂在 NPC 系统的站位节点下面：朝向按父节点的 yaw 折算，位置取世界坐标）
      const root = SCENE.wangRoot;
      if (s.temp('reading') === true && root) {
        root.rotation.y = yawToRotY(K.wangReadYaw) - (root.parent?.rotation.y ?? 0);
        root.getWorldPosition(readAt);
        const [lx, ly, lz] = letterAt(readAt.x, readAt.z);
        apt.letter.position.set(lx, ly, lz);
        // 正面朝她的眼睛，再往近景机位那边偏一点（近景里字不至于斜得太厉害）
        readFwd.set(Math.sin(K.wangReadYaw * DEG2RAD), 0, -Math.cos(K.wangReadYaw * DEG2RAD));
        readEye.set(readAt.x, WANG_EYE_Y, readAt.z).addScaledVector(readFwd, 0.06);
        const [cx, cy, cz] = letterCamAt(readAt.x, readAt.z);
        readEye.lerp(readCam.set(cx, cy, cz), 0.35);
        apt.letter.lookAt(readEye);
      }
      // 临别（M4 第 2 轮）：她转过身面朝伙计（过场在黑场里写 face_player，这里直接摆朝向）
      if (s.temp('face_player') === true && root) {
        const p = g.player.position;
        root.getWorldPosition(readAt);
        const yaw = (Math.atan2(p.x - readAt.x, -(p.z - readAt.z)) * 180) / Math.PI;
        root.rotation.y = yawToRotY(yaw) - (root.parent?.rotation.y ?? 0);
      }
      // 说话的纸像微微鼓动
      const talking = g.modes.stack.includes('mode.dialogue') && (ZAO.who === SPK.ZAOWANG || ZAO.who === SPK.ZAONAINAI);
      const pk = talking ? 1 + 0.02 * (0.5 + 0.5 * Math.sin(ZAO.t * 11)) : 1;
      apt.zaojun.scale.set(pk, pk, 1);
      // 挂钟：秒针式的钟摆、分针慢走
      const [hh, mm, pend] = apt.clockHands;
      if (hh) hh.rotation.z = -((23 + 40 / 60) / 12) * Math.PI * 2;
      if (mm) mm.rotation.z = -((40 + t / 60) / 60) * Math.PI * 2;
      if (pend) pend.rotation.z = Math.sin(t * Math.PI) * 0.12;
    },
    onFlag(e) {
      if (e.id === F.R2_TIN_OPENED || e.id === F.R2_WANG_DONE) sync();
    },
  };
}
