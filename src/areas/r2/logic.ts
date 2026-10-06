// owner: R2
// R2 的玩法逻辑（ARCH §11.3）：楼层节点、声控灯（快门点亮 5m 内的灯 20 秒，GDD §3.3 M2、P3）、王奶奶的护送、楼梯井强制对话与
// 楼梯口触发体、门神（P4）、交互物、REC 点光。进度只由 flags 推导；灯的亮灭、楼层、门神问过没有都是临时状态（不存档）。
//
// 灯（本区固定 3 盏，GDD §4.2）：半球光（HALL_LAMP/#0E0C0A 0.12 保底）、一盏复用的声控灯点光（#FFD9A0 1.6/6，移到当前楼层
// 亮着的灯位，灭了强度 0）、主角头上的 REC 红点光（lightsRoot 下每帧跟随镜头）。其他灯位只有 emissive。

import * as THREE from 'three';
import type { AreaContext, LevelsHandle } from '../../core/area';
import type { GameEvents } from '../../core/events';
import type { V3 } from '../../core/types';
import { DOC, F, IT, NPC, OBJ, EXIT, PH, SEG, SPK } from '../../data/ids';
import type { InteractId, ThingId } from '../../data/ids';
import { PALETTE } from '../../data/palette';
import { LOOK, TEMP_C } from '../../data/render';
import { STRINGS } from '../../data/strings';
import { MATERIALS } from '../../fx/materials';
import { E } from '../../game/effects';
import type { GameApi } from '../../game/effects';
import type { NpcHandle } from '../../game/npc';
import type { StateView } from '../../game/state';
import { designLight } from '../../kit/lamps';
import { createCharacter, type CharacterRig } from '../../rigs/characters';
import { yawToRotY } from '../../core/math';
import { TEXT } from './text';
import { DLG_R2 } from './dialogue';
import { DLG } from '../../data/ids';
import { CEIL, FLOORS, LAMP_RANGE, LAMP_SEC, R2, floorOf, levelY } from './layout';
import type { R2World } from './build/floors';
import type { R2Mats } from './build/mats';
import { PAPER_TALK } from './anim';
import { ceilingHaloTexture } from './build/paint';

const LAMP_IDS: readonly InteractId[] = [OBJ.R2_LAMP_1F, OBJ.R2_LAMP_2F, OBJ.R2_LAMP_3F, OBJ.R2_LAMP_4F, OBJ.R2_LAMP_5F];
export const litKey = (n: number): string => `lamp_lit_${n}`;
/** 灯亮起那一下的后期层 key（自动曝光冲白再收回） */
const HUNT = 'lampHunt';

/** 王奶奶在 R2 的站位（GDD §4.2、§4.6；只读 flags 与区域临时状态）。 */
export function wangPlacement(s: StateView): { pos: V3; yaw: number; pose: 'sit' | 'stand'; floor: number } | null {
  if (!s.flag(F.R1_MISSION_GIVEN) || s.flag(F.R2_WANG_DONE)) return null;
  if (s.flag(F.R2_MENSHEN_OPEN) && s.temp('wang_entering') !== true) return null;   // 502 门开了，她先进了屋
  const f = Math.max(1, s.num(F.R2_WANG_FLOOR));
  if (f <= 1) return { pos: R2.wangSeat, yaw: 180, pose: 'sit', floor: 1 };
  if (f < FLOORS) return { pos: R2.wangMid(f), yaw: 245, pose: 'stand', floor: f };
  return { pos: R2.wangDoor, yaw: 285, pose: 'stand', floor: FLOORS };
}

/** 声控灯点亮的那一下（“啪”）：灯丝过冲、闪一下暗、再稳住。t 为点亮后的秒数。 */
function ignite(t: number): number {
  if (t < 0.035) return 1.45;
  if (t < 0.09) return 0.18;
  if (t < 0.13) return 0.95;
  if (t < 0.17) return 0.55;
  if (t < 0.32) return 0.55 + ((t - 0.17) / 0.15) * 0.45;
  return 1;
}

interface LampState { remain: number; t: number }

/**
 * 声控灯的光（M4 第 2 轮，look-dev 调过）：lift = 光源在顶棚上方多高（虚光源，见 buildLogic）、angle/penumbra = 聚光半角与软边、
 * range = 截止距离、gain = 相对 designLight(1.6/6) 的倍数（光源抬高后墙面离光源远了，补回来）、halo/haloR = 顶棚光晕的亮度与半径。
 */
const HALL = { lift: 0.6, angle: (72 * Math.PI) / 180, penumbra: 0.55, range: 8, gain: 3.0, halo: 0.35, haloR: 0.9 };

export interface R2Runtime {
  update(dt: number): void;
  onFlag(e: GameEvents['flag']): void;
  dispose(): void;
}

export function buildLogic(ctx: AreaContext, w: R2World, mats: R2Mats): R2Runtime {
  const g: GameApi = ctx.game;
  const floors = w.floors;
  const lamps: LampState[] = floors.map(() => ({ remain: 0, t: 99 }));

  // ———————————————— 灯（3 盏，进区域后数量固定）
  ctx.hemi(PALETTE.HALL_LAMP, '#0E0C0A', 0.12);
  // 声控灯（M4 第 2 轮）：朝下的聚光，光源“虚放”在顶棚上方 HALL.lift 处（不投影，顶棚挡不住它；顶棚底面背对光源，不受直射）。
  // 原来是灯泡下 0.55m 的点光：离主角头顶只有 5cm，摄像头脑袋烧成白块、顶棚上一大片白斑。光源抬高以后头顶到光源 ≥ 1.2m，
  // 头、墙、地的受光比从几百倍收到几倍；顶棚上那一圈光晕改用贴在顶棚下的加法光晕（haloMesh）。
  const hall = designLight('spot', PALETTE.HALL_LAMP, 1.6, 6) as THREE.SpotLight;
  hall.name = 'hallLamp';
  const hallCd = hall.intensity;
  hall.intensity = 0;
  hall.angle = HALL.angle;
  hall.penumbra = HALL.penumbra;
  hall.distance = HALL.range;
  hall.position.set(...R2.lamp(1));
  ctx.light(hall);
  const haloMat = new THREE.MeshBasicMaterial({
    map: ctx.track(ceilingHaloTexture()), color: new THREE.Color(PALETTE.HALL_LAMP), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false, toneMapped: true,
  });
  haloMat.userData.tempC = TEMP_C.lamp;
  const halo = new THREE.Mesh(ctx.track(new THREE.PlaneGeometry(1, 1)), ctx.track(haloMat));
  halo.name = 'lampHalo';
  halo.rotation.x = Math.PI / 2;   // 面朝下
  halo.frustumCulled = false;
  halo.userData.noOcclude = true;
  halo.userData.irHide = true;
  halo.raycast = () => undefined;
  halo.visible = false;
  ctx.add(halo);
  const rec = designLight('point', PALETTE.REC, 0.35, 2) as THREE.PointLight;
  rec.name = 'recLamp';
  const recCd = rec.intensity;
  rec.intensity = 0;
  ctx.light(rec, ctx.lightsRoot);

  // 楼梯口的拾取挡板（不渲染；每层一块，只有当前楼层那块可见）：准星对着楼梯口哪儿都算“楼梯”，不会被栏杆挡住
  const stairHit = new THREE.Group();
  stairHit.name = 'stairsHit';
  const geoHit = ctx.track(new THREE.BoxGeometry(2.8, 1.9, 0.05));
  for (let n = 1; n <= FLOORS; n++) {
    const proxy = new THREE.Mesh(geoHit, MATERIALS.hitProxy());
    proxy.position.set(0, levelY(n) + 1.2, -0.28);
    stairHit.add(proxy);
  }
  ctx.add(stairHit, { occlude: false });

  // ———————————————— 楼层节点
  let levels: LevelsHandle | null = null;
  const applyFloor = (n: number) => {
    for (const f of floors) f.group.visible = f.n === n;
    stairHit.children.forEach((c, i) => { c.visible = i + 1 === n; });
    ctx.setTemp('floor', n);
  };
  levels = ctx.levels({ count: FLOORS, y: levelY, initial: 1, onChange: n => applyFloor(n) });
  const cur = (): number => levels?.current ?? 1;

  // 三楼：装灯泡之前只有空灯座
  const syncBulb = () => {
    const on = ctx.state.flag(F.R2_BULB_INSTALLED);
    const f3 = floors[2];
    if (!f3) return;
    f3.lamp.group.visible = on;
    if (f3.socket) f3.socket.visible = !on;
    if (on) f3.lamp.setColor('#FFE9C8');
  };
  syncBulb();

  // 502 门：门神放行后开着（开门动画在 update 里走）
  let doorOpen = ctx.state.flag(F.R2_MENSHEN_OPEN) ? 1 : 0;
  w.door502.setOpen(doorOpen);

  // ———————————————— 点灯
  const lampPos = new THREE.Vector3();
  const light = (n: number) => {
    const L = lamps[n - 1];
    if (!L) return;
    if (L.remain <= 0) {
      L.t = 0;
      g.sfx('lamp_click', R2.lamp(n));
      // “啪”的那一下：摄像头的自动曝光跟不上，画面先冲白一截，再慢慢收回来（“减少闪光”时不做）
      if (n === cur() && !g.settings.reduceFlash) {
        g.post.push(HUNT, { exposure: LOOK.exposure + 0.6 });
        ctx.after(0.08, () => g.post.pop(HUNT, 0.9));
      }
    }
    L.remain = LAMP_SEC;
    ctx.setTemp(litKey(n), true);
  };

  ctx.on('shutter', e => {
    if (e.area !== 'r2') return;
    const n = cur();
    lampPos.set(...R2.lamp(n));
    if (e.pos.distanceTo(lampPos) > LAMP_RANGE) return;
    const s = ctx.state;
    if (n === 3 && !s.flag(F.R2_BULB_INSTALLED)) {
      g.feedback(TEXT.fb.socketEmpty);
      return;
    }
    light(n);
    if (n === 1) {
      // r1.mission_given 之前快门照样点亮灯，但不写 flag、不出旁白（GDD P3 解法 2）
      if (s.flag(F.R1_MISSION_GIVEN) && !s.flag(F.R2_LOBBY_LAMP_LIT)) {
        g.setFlag(F.R2_LOBBY_LAMP_LIT);
        g.say(TEXT.fb.lobbyLit);
      }
      return;
    }
    // 护送：只有在第 n 层按快门、该层灯亮、且王奶奶正在第 n-1 层时，她才升一层（GDD P3 规则）
    if (!s.flag(F.R2_WANG_ESCORT) || s.flag(F.R2_MENSHEN_OPEN) || s.flag(F.R2_WANG_DONE)) return;
    const wf = s.num(F.R2_WANG_FLOOR);
    if (wf === n - 1) {
      g.setFlag(F.R2_WANG_FLOOR, n);
      const line = TEXT.escort[n];
      if (line) ctx.after(1.1, () => g.say(line, NPC.WANG));
    } else if (wf >= 1 && wf < n - 1) {
      g.say(TEXT.fb.skipFloor, NPC.WANG);
    }
  });

  // ———————————————— 王奶奶
  const wangRig: CharacterRig = createCharacter('wang', { look: 'ghost', seed: 3 });
  let entering = -1;   // ≥0：进 502 的动画已走的秒数
  let enterFrom: V3 | null = null;
  let npcHandle: NpcHandle | null = null;
  let dimWang = 0;   // 模糊程度的当前值（见 applyDim）；进区域时灯总是灭的
  // 模糊人影（vis 0 = 灯黑着，1 = 看清）：不透明度、原件细节（贴图、原色、道具实心）、魂色亮度一起降，人影横向抖一抖
  const dimBase = new WeakMap<THREE.ShaderMaterial, { map: number; base: number; solid: number; color: THREE.Color }>();
  const applyDim = (vis: number) => {
    wangRig.setOpacity(0.2 + 0.8 * vis);
    wangRig.root.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (!m || !m.isShaderMaterial || !m.uniforms['uMapAmt']) return;
      const u = m.uniforms as Record<string, THREE.IUniform>;
      let b = dimBase.get(m);
      if (!b) {
        b = { map: u['uMapAmt']?.value as number, base: (u['uBaseAmt']?.value as number) ?? 0, solid: (u['uSolid']?.value as number) ?? 0, color: (u['uColor']?.value as THREE.Color).clone() };
        dimBase.set(m, b);
      }
      if (u['uMapAmt']) u['uMapAmt'].value = b.map * vis;
      if (u['uBaseAmt']) u['uBaseAmt'].value = b.base * vis;
      if (u['uSolid']) u['uSolid'].value = b.solid * vis;
      (u['uColor']?.value as THREE.Color | undefined)?.copy(b.color).multiplyScalar(0.3 + 0.7 * vis);
    });
    // 抖：每 1/12 秒换一个横向偏移（最多 3cm），像取景器里信号不稳
    const amp = 0.03 * (1 - vis);
    const q = Math.floor(g.time * 12);
    const rx = Math.sin(q * 12.9898) * 43758.5453;
    const rz = Math.sin(q * 78.233) * 12543.1234;
    wangRig.root.position.set(amp * (2 * (rx - Math.floor(rx)) - 1), 0, amp * 0.5 * (2 * (rz - Math.floor(rz)) - 1));
  };
  const startEnter = () => {
    entering = 0;
    enterFrom = npcHandle ? [npcHandle.root.position.x, npcHandle.root.position.y, npcHandle.root.position.z] : R2.wangDoor;
  };
  npcHandle = ctx.npc({
    id: NPC.WANG, rig: wangRig, yin: true, tempC: TEMP_C.yin, photoAnchorY: 1.2,
    placement: s => {
      const p = wangPlacement(s);
      return p ? { pos: p.pos, yaw: p.yaw, pose: p.pose, floor: p.floor } : null;
    },
    onPlaced: (npc, prev) => {
      const p = wangPlacement(ctx.state);
      if (!p || !prev) return;
      const at = npc.root.position;
      if (Math.abs(at.x - p.pos[0]) < 1e-3 && Math.abs(at.y - p.pos[1]) < 1e-3 && Math.abs(at.z - p.pos[2]) < 1e-3) return;
      // 换层：淡出 → 瞬移 → 淡入（GDD P3“淡出淡入传送，不寻路”）；姿势在看不见的时候换
      void npc.fadeTo(p.pos, p.yaw, 1.6);
      ctx.after(0.8, () => npc.setPose(p.pose));
    },
    interact: {
      label: TEXT.label.wang, view: 'viewfinder', revealOnVfInteract: true, priority: 1, anchorY: 1.0,
      onInteract: async api => {
        const s = api.state;
        if (!s.flag(F.R2_WANG_MET)) {
          // 初见条件：一楼灯此刻亮着（20 秒的临时灯态），不是 r2.lobby_lamp_lit（GDD P3）
          if (s.temp(litKey(1)) !== true) {
            api.feedback(TEXT.fb.wangDark);
            return;
          }
          api.setFlag(F.R2_WANG_MET);
          api.setFlag(F.R2_WANG_ESCORT);
          if (s.num(F.R2_WANG_FLOOR) < 1) api.setFlag(F.R2_WANG_FLOOR, 1);
          await api.dialogue(DLG_R2.WANG_FIRST);
          return;
        }
        if (s.num(F.R2_WANG_FLOOR) >= FLOORS) await api.dialogue(DLG_R2.WANG_DOOR);
        else await api.dialogue(DLG_R2.WANG_ESCORT);
      },
    },
    update: (npc, dt) => {
      const s = ctx.state;
      // 还没见过面：灯黑着时她只是台阶上一团模糊的影子（GDD P3 解法 1），灯亮了 0.4 秒内看清（M4 第 2 轮：原来只把不透明度压到 0.32，
      // 魂影的边缘光与衣服花色、篮子照样清楚——现在再去掉原件细节、压暗魂色，并让整个人影像信号不好一样轻轻抖）
      if (!s.flag(F.R2_WANG_MET)) {
        const want = s.temp(litKey(1)) === true ? 1 : 0;
        dimWang = dimWang + (want - dimWang) * Math.min(1, dt * 6);
        if (want === 1 && dimWang > 0.985) dimWang = 1;
        applyDim(dimWang);
      } else if (dimWang < 1) {
        dimWang = 1;
        applyDim(1);
      }
      // 门神放行后：她走进 502 门、身影淡掉（然后按 flags 不在场）
      if (entering >= 0 && enterFrom) {
        entering += dt;
        const k = Math.min(1, entering / 1.8);
        const tx = -5.4, tz = 1.2;
        npc.root.position.set(enterFrom[0] + (tx - enterFrom[0]) * k, enterFrom[1], enterFrom[2] + (tz - enterFrom[2]) * k);
        npc.root.rotation.y = yawToRotY(270);
        wangRig.setOpacity(1 - k);
        if (k >= 1) {
          entering = -1;
          ctx.setTemp('wang_entering', false);
        }
      }
    },
  });

  // ———————————————— 交互物
  const nothing = STRINGS.feedback.nothingHere;
  floors.forEach((f, i) => {
    const n = f.n;
    const at = R2.lamp(n);
    ctx.interactable({
      id: LAMP_IDS[i] as InteractId,
      label: TEXT.label.lamp,
      at: [at[0], at[1] - 0.08, at[2]],
      hit: f.lampHit,
      present: s => floorOf(s) === n && (n !== 3 || s.flag(F.R2_BULB_INSTALLED)),
      onInteract: [E.feedback(TEXT.fb.lampTouch)],
      offers: { accept: {}, fallback: (thing: ThingId) => (thing === IT.BULB ? TEXT.fb.bulbElsewhere : nothing) },
      menuVerb: 'use',
    });
  });
  const f3 = floors[2];
  if (f3?.socket) {
    const at = R2.lamp(3);
    ctx.interactable({
      id: OBJ.R2_LAMP_SOCKET_3F,
      label: TEXT.label.socket,
      // 锚点在空灯头的中心（拾取网格要包住锚点，准星对着它才打得中）
      at: [at[0], at[1] - 0.05, at[2]],
      hit: f3.socket,
      present: s => floorOf(s) === 3 && !s.flag(F.R2_BULB_INSTALLED),
      onInteract: [E.feedback(TEXT.fb.socketLook)],
      offers: {
        // 装灯泡：GDD P3 解法 5（提前装也行，GDD §6.2 第 6 条）
        accept: { [IT.BULB]: [E.used(IT.BULB), E.flag(F.R2_BULB_INSTALLED), E.sfx('lamp_click', [at[0], at[1], at[2]])] },
        fallback: nothing,
      },
      menuVerb: 'use',
    });
  }
  ctx.interactable({
    id: OBJ.R2_STAIRS,
    label: TEXT.label.stairs,
    at: () => new THREE.Vector3(...R2.stairsAnchor(cur())),
    // 拾取用楼梯口的一块不可见挡板（每层一块，随楼层节点显隐）：准星对着楼梯口任何地方都算楼梯，不会被栏杆挡住
    hit: stairHit,
    talk: [{ dialogue: DLG.R2_STAIRS }],
  });
  ctx.interactable({
    id: OBJ.R2_MAILBOXES, label: TEXT.label.mailboxes, at: R2.mailboxes, hit: w.mailboxes,
    present: s => floorOf(s) === 1,
    onInteract: [E.feedback(TEXT.fb.mailboxes)],
  });
  ctx.interactable({
    id: OBJ.R2_DONATION_BOARD, label: TEXT.label.donation, at: [4.93, R2.donation[1], R2.donation[2]], hit: w.donation,
    present: s => floorOf(s) === 1,
    // 墙上的捐款榜在文档阅读器里读（GameApi.openDoc / E.doc，M3；docs/requests/r2.md #1）
    onInteract: [E.doc(DOC.DONATION_BOARD)],
  });
  ctx.interactable({
    // 电梯门在楼梯口挡板后面：准星穿过挡板打到电梯门时电梯优先
    id: OBJ.R2_ELEVATOR, label: TEXT.label.elevator, range: 6.2, priority: 1,
    at: () => {
      const n = cur();
      const p = R2.elevator(n);
      return new THREE.Vector3(p[0], n === FLOORS ? p[1] - 2.8 : p[1], p[2] + 0.12);
    },
    onInteract: [E.feedback(TEXT.fb.elevator)],
  });
  const handleAt = new THREE.Vector3();
  ctx.interactable({
    id: OBJ.R2_DOOR_502, label: TEXT.label.door502,
    at: () => w.door502.handle.getWorldPosition(handleAt).clone(),
    hit: w.door502.handle,
    present: s => floorOf(s) === FLOORS,
    when: F.R2_MENSHEN_OPEN, blocked: TEXT.fb.door502Blocked,
    // 门开着：按 E 等于走进去（travel 必须是 handler 的最后一步，ARCH §4.5）
    onInteract: api => api.travel(EXIT.R2_TO_502),
  });

  // 门神（P4）：取景器里交互；出示照片
  let menshenAsked = false;
  const menshenLine = (who: typeof SPK.YUCHI | typeof SPK.QIN, text: string) => (api: GameApi) => {
    PAPER_TALK.who = who;
    PAPER_TALK.t = 0;
    api.say(text, who);
  };
  ctx.interactable({
    id: OBJ.R2_MENSHEN, label: TEXT.label.menshen, at: [R2.menshenCenter[0] + 0.02, R2.menshenCenter[1], R2.menshenCenter[2]],
    hit: w.menshen, view: 'viewfinder', priority: 2, menuVerb: 'show',
    present: s => floorOf(s) === FLOORS,
    onInteract: async api => {
      const s = api.state;
      if (s.num(F.R2_WANG_FLOOR) < FLOORS || !s.flag(F.R2_WANG_ESCORT)) await api.dialogue(DLG_R2.MENSHEN_HALT);
      else if (s.flag(F.R2_MENSHEN_OPEN)) await api.dialogue(DLG_R2.MENSHEN_AFTER);
      else if (!menshenAsked) {
        menshenAsked = true;
        await api.dialogue(DLG_R2.MENSHEN_FIRST);
      } else await api.dialogue(DLG_R2.MENSHEN_AGAIN);
    },
    offers: {
      accept: {
        [PH.MENSHEN_2018]: async api => {
          const s = api.state;
          if (s.flag(F.R2_MENSHEN_OPEN)) {
            await api.dialogue(DLG_R2.MENSHEN_AFTER);
            return;
          }
          // 前置：王奶奶已到门口（r2.wang_floor >= 5）、有倒带（照片本身就是倒带里拍的）
          if (s.num(F.R2_WANG_FLOOR) < FLOORS || !s.flag(F.R1_ABILITY_REPLAY)) {
            await api.dialogue(DLG_R2.MENSHEN_HALT);
            return;
          }
          ctx.setTemp('wang_entering', true);   // 先留住她的站位，对话之后走进门
          api.setFlag(F.R2_MENSHEN_OPEN);
          await api.dialogue(DLG_R2.MENSHEN_OPEN);
          startEnter();
        },
      },
      // 其他照片与东西：GDD P4 错误反馈（原样退回；门神开口说话，所以用带说话人的字幕）
      any: (thing, api) => {
        if (thing === PH.DOOR_2019) menshenLine(SPK.QIN, TEXT.menshen.door2019)(api);
        else if (thing === PH.DOOR_2025) menshenLine(SPK.QIN, TEXT.menshen.door2025)(api);
        else menshenLine(SPK.YUCHI, TEXT.menshen.other)(api);
        return true;
      },
    },
  });

  // ———————————————— 楼梯口触发体：走进去就换层（GDD §4.2）
  for (let n = 1; n <= FLOORS; n++) {
    if (n < FLOORS) {
      const p = R2.upTrigger(n);
      ctx.trigger({ key: `stairs_up_${n}`, box: { center: [p[0], p[1] + 1.25, p[2]], size: [1.5, 2.5, 1.5] }, onEnter: api => api.setLevel(n + 1) });
    }
    if (n > 1) {
      const p = R2.downTrigger(n);
      ctx.trigger({ key: `stairs_down_${n}`, box: { center: [p[0], p[1] + 1.25, p[2]], size: [1.5, 2.5, 1.5] }, onEnter: api => api.setLevel(n - 1) });
    }
  }

  // 王奶奶的湿脚印：到过的楼层才有（阴物层，取景器里看得见）
  const syncPrints = () => {
    const s = ctx.state;
    const f = s.flag(F.R1_MISSION_GIVEN) ? Math.max(1, s.num(F.R2_WANG_FLOOR)) : 0;
    w.prints.forEach((p, i) => { p.visible = i + 1 <= f; });
  };
  syncPrints();

  // 灯下的浮尘：灯一亮，灯泡周围一团慢慢飘的亮点（只在当前楼层的灯下，纯装饰）
  const DUST = 90;
  const dustPos = new Float32Array(DUST * 3);
  const dustSeed = new Float32Array(DUST * 3);
  const rr = ctx.rng(7);
  for (let i = 0; i < DUST; i++) {
    dustSeed[i * 3] = rr() * Math.PI * 2;
    dustSeed[i * 3 + 1] = 0.15 + rr() * 1.15;
    dustSeed[i * 3 + 2] = rr();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({ color: new THREE.Color(PALETTE.HALL_LAMP).multiplyScalar(1.6), size: 0.014, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.name = 'lampDust';
  dust.frustumCulled = false;
  dust.userData.irHide = true;
  dust.userData.noOcclude = true;
  dust.raycast = () => undefined;
  ctx.add(dust);

  // ———————————————— 每帧
  const eyeTmp = new THREE.Vector3();
  let recT = 0;
  let humOn = -1;
  let doorTarget = doorOpen;
  const pulse = new Map<string, number>();
  let winDay = false;
  const DAY_WIN = new THREE.Color('#e8f0ff').multiplyScalar(3.4);
  const winBase = new Map<THREE.MeshBasicMaterial, { color: THREE.Color; map: THREE.Texture | null }>(
    [...mats.courtyard, mats.landingWin].map(c => [c, { color: c.color.clone(), map: c.map }] as const),
  );
  // 回放里换下来的贴图不挂在任何材质上：交给区域释放（挂着的再释放一次也无妨）
  ctx.track(mats.courtyardDay);
  for (const b of winBase.values()) if (b.map) ctx.track(b.map);
  return {
    update(dt) {
      const s = ctx.state;
      const n = cur();
      // 灯的计时
      lamps.forEach((L, i) => {
        // 临时状态被别处直接写成亮（截图机位的 ShotDef.temp，M3，docs/requests/r2.md #2）：当作刚点亮过、已经亮稳
        if (L.remain <= 0 && s.temp(litKey(i + 1)) === true) {
          L.remain = LAMP_SEC;
          L.t = Math.max(L.t, 1);
        }
        L.t += dt;
        if (L.remain > 0) {
          L.remain -= dt;
          if (L.remain <= 0) {
            L.remain = 0;
            ctx.setTemp(litKey(i + 1), false);
            if (i + 1 === n) g.sfx('lamp_click', R2.lamp(i + 1));
          }
        }
      });
      // 回放里的“过去”：2008 年的门厅灯是好的；2018、2025 年的上午是白天的天光（只改颜色与强度，灯数不变）
      const rp = g.replay.active;
      const past = rp ? (rp.seg === SEG.LOBBY_2008 ? 'lamp' : rp.seg === SEG.DOOR_2018 || rp.seg === SEG.DOOR_2025 ? 'day' : 'dark') : null;
      let curLevel = 0;
      floors.forEach((f, i) => {
        const L = lamps[i];
        if (!L) return;
        let k = 0;
        if (L.remain > 0) {
          // “减少闪光”：不闪那一下、不抖，0.25 秒柔和亮起（GDD §10.4）
          const calm = g.settings.reduceFlash;
          k = (calm ? Math.min(1, L.t / 0.25) : ignite(L.t)) * f.level;
          if (f.flicker > 0 && !calm) {
            // 四楼接触不良：隔一会儿抖两下
            const ph = (L.t * 1.7) % 4.3;
            if (ph < 0.12 || (ph > 0.2 && ph < 0.26)) k *= 0.25;
            else k *= 0.92 + 0.08 * Math.sin(L.t * 97);
          }
        }
        if (past === 'lamp' && f.n === 1) k = f.level;
        if (past === 'day' || past === 'dark') k = 0;
        f.lamp.setOn(k > 0.001);
        f.lamp.setLevel(Math.min(1, k));
        if (f.n === n) curLevel = k;
      });
      const L = R2.lamp(n);
      const cfg = HALL;
      hall.position.set(L[0], levelY(n) + CEIL + cfg.lift, L[2]);
      if (past === 'day') {
        // 白天：天光从南窗进来（窗子白得发亮），走廊整个亮一截
        hall.color.set('#E3E9F2');
        hall.intensity = hallCd * cfg.gain * 1.8;
        hall.position.set(0, levelY(n) + CEIL + cfg.lift, 1.9);
      } else {
        hall.color.set(n === 3 ? '#FFE9C8' : PALETTE.HALL_LAMP);
        hall.intensity = hallCd * cfg.gain * curLevel;
      }
      // 顶棚光晕：随灯的亮度（含点亮那一下的过冲与四楼的抖）
      halo.visible = curLevel > 0.01;
      if (halo.visible) {
        halo.position.set(L[0], levelY(n) + CEIL - 0.004, L[2]);
        halo.scale.setScalar(cfg.haloR * 2);
        haloMat.color.set(n === 3 ? '#FFE9C8' : PALETTE.HALL_LAMP).multiplyScalar(cfg.halo * Math.min(1.3, curLevel));
      }
      // 回放里的白天：窗外是亮的（HDR 白），夜里恢复钠灯夜景
      const dayWin = past === 'day';
      if (dayWin !== winDay) {
        winDay = dayWin;
        for (const c of [...mats.courtyard, mats.landingWin]) {
          const base = winBase.get(c);
          if (!base) continue;
          c.color.copy(dayWin ? DAY_WIN : base.color);
          c.map = dayWin ? mats.courtyardDay : base.map;
        }
      }
      // 浮尘
      dust.visible = curLevel > 0.02;
      if (dust.visible) {
        dustMat.opacity = Math.min(1, curLevel) * 0.8;
        const tt = g.time;
        for (let i = 0; i < DUST; i++) {
          const a = (dustSeed[i * 3] ?? 0) + tt * 0.07 * (0.5 + (dustSeed[i * 3 + 2] ?? 0));
          const r = dustSeed[i * 3 + 1] ?? 0.5;
          const h = (((dustSeed[i * 3 + 2] ?? 0) * 2.1 + tt * 0.02) % 2.1);
          dustPos[i * 3] = L[0] + Math.cos(a) * r;
          dustPos[i * 3 + 1] = L[1] - 0.1 - h;
          dustPos[i * 3 + 2] = L[2] + Math.sin(a * 1.3) * r * 0.8;
        }
        (dustGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }
      // 声控灯的 120Hz 嗡鸣（GDD §9.5）：当前楼层灯亮着时
      const want = curLevel > 0.01 ? 1 : 0;
      if (want !== humOn) {
        humOn = want;
        const h = ctx.ambienceHandles()[2];
        h?.set('on', want, 0.08);
      }
      // REC 红点光：跟着镜头（lightsRoot 下），每秒闪一次（GDD §4.2）
      recT = (recT + dt) % 1;
      const eye = g.player.eye;
      eyeTmp.set(eye.x, eye.y + 0.1, eye.z);
      const yaw = (g.player.yaw * Math.PI) / 180;
      eyeTmp.x += Math.sin(yaw) * 0.12;
      eyeTmp.z -= Math.cos(yaw) * 0.12;
      if (rec.parent) rec.parent.worldToLocal(rec.position.copy(eyeTmp));
      rec.intensity = recT < 0.4 ? recCd : 0;
      // 502 门：门神放行后开门
      doorTarget = s.flag(F.R2_MENSHEN_OPEN) ? 1 : 0;
      if (doorOpen !== doorTarget) {
        doorOpen = doorTarget > doorOpen ? Math.min(doorTarget, doorOpen + dt / 1.4) : doorTarget;
        w.door502.setOpen(doorOpen);
      }
      // 门神说话时纸像微微鼓动（GDD §2.7）；对话结束后慢慢平
      PAPER_TALK.t += dt;
      const talking = g.modes.stack.includes('mode.dialogue') || PAPER_TALK.t < 2.2 ? PAPER_TALK.who : '';
      for (const [who, idx] of [[SPK.YUCHI, 0], [SPK.QIN, 1]] as const) {
        const target = talking === who ? 1 : 0;
        const p0 = pulse.get(who) ?? 0;
        const p = p0 + (target - p0) * Math.min(1, dt * 6);
        pulse.set(who, p);
        // 纸像本身与它上面那层描金（children[idx] 与 children[idx + 2]）一起鼓
        const k = 1 + p * 0.035 * (0.5 + 0.5 * Math.sin(PAPER_TALK.t * 11));
        for (const mesh of [w.menshen.children[idx], w.menshen.children[idx + 2]]) mesh?.scale.set(k, k, 1);
      }
    },
    onFlag(e) {
      if (e.id === F.R2_BULB_INSTALLED) syncBulb();
      if (e.id === F.R2_WANG_FLOOR || e.id === F.R1_MISSION_GIVEN) syncPrints();
    },
    dispose() {
      npcHandle = null;
    },
  };
}
