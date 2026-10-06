// owner: WP4
// NPC（ARCH §6.7）：站位由 flags 推导、阴物常显、回放期间让位、跟随 NPC 的灯。
//
// 实现要点（WP4）：
// - add()：建 NPC 根节点（名字 = NPC id）挂进本区 root（经 ctx.add：图层 yin/world、tempC、登记同 id 的 ref——拍照主体），
//   另把整棵子树写 userData.tempC；再登记交互物（锚点 = 站位 + anchorY，hit = NPC 根节点；present 叠加“在场且没让位”）。
// - 站位只由 placement(state) 推导（'flag'/'temp' 事件后与进区域时 reevaluate）。null → 不在场（visible=false）。
//   有 onPlaced 且 NPC 在场状态不变、只是换了站位时，**不**瞬移，交给 onPlaced（通常调 npc.fadeTo 到新站位）；
//   其余情况（首次、出现/消失、没有 onPlaced）直接摆到位再通知 onPlaced。
// - 阴物常显：state.seen(id) 为真后（取景器中交互过，或 E.seen）给根节点追加 world 层，CharacterRig 换 'ghost' 材质（每帧检查，seen 没有事件）。
// - 让位：yieldWithin(center, r) 让 3D 距离 ≤ r 的在场 NPC visible=false、yielded=true（不渲染、不挡镜头、交互 not_present）；restoreYield 复原。
// - 跟随灯：灯由区域 ctx.light() 挂在 lightsRoot 下；每帧把灯移到锚点世界坐标；不在场/让位时把强度记下并置 0（灯数不变），回来时还原。
// - fadeTo：淡出（HumanoidRig.setOpacity，没有就直接隐藏）→ 瞬移 → 淡入，按游戏时间。

import * as THREE from 'three';
import type { Pose, V3 } from '../core/types';
import type { NpcId } from '../data/ids';
import type { Game } from '../core/game';
import type { StateView } from './state';
import type { InteractableDef, InteractableHandle } from './interaction';
import type { CharacterRig } from '../rigs/characters';
import type { PaperRig } from '../rigs/paper';
import { addLayerRecursive } from '../core/layers';
import { compileCond } from './expr';
import { yawToRotY, yawTowards } from '../core/math';
import { devAssert, devWarn } from '../core/log';

export interface NpcDef {
  id: NpcId;
  rig: CharacterRig | PaperRig | THREE.Object3D;
  /** 阴物：layer.yin；取景器中交互后常显 */
  yin: boolean;
  /** null = 不在场 */
  placement: (s: StateView) => { pos: V3; yaw: number; pose?: Pose; floor?: number } | null;
  /** 锚点 = 站位 + anchorY（默认 1.2） */
  interact: Omit<InteractableDef, 'id' | 'at'> & { anchorY?: number };
  /** 红外温度；鬼魂 6、黄三爷 36.5（写到整棵子树的 userData.tempC） */
  tempC?: number;
  /** 拍照锚点高度（默认头部） */
  photoAnchorY?: number;
  /** 跟随 NPC 的灯：灯本身由 ctx.light() 挂在 lightsRoot 下，引擎每帧把它移到锚点（rig.props 的键或对象）的世界坐标；NPC 不在场时强度置 0，灯数不变 */
  lights?: { light: THREE.Light; anchor: THREE.Object3D | string }[];
  /** 站位变化时（可做淡出淡入） */
  onPlaced?(npc: NpcHandle, prevPos: V3 | null): void;
  update?(npc: NpcHandle, dt: number): void;
}

export interface NpcHandle {
  readonly id: NpcId;
  readonly root: THREE.Object3D;
  readonly present: boolean;
  /** 正在为回放让位 */
  readonly yielded: boolean;
  /** 淡出→瞬移→淡入（王奶奶换层） */
  fadeTo(pos: V3, yaw: number, sec?: number): Promise<void>;
  setPose(p: Pose): void;
  lookAt(p: V3): void;
  /** 改角标（等价于 InteractableHandle.setLabel） */
  setLabel(t: string | ((s: StateView) => string)): void;
  /** 转给 CharacterRig.setVariant（黄三爷揭面具） */
  setVariant(v: string): void;
}

/** 默认交互锚点高度（站位上方）。 */
export const NPC_ANCHOR_Y = 1.2;
/** fadeTo 默认时长。 */
const FADE_SEC = 0.8;

interface FollowLight { light: THREE.Light; anchor: THREE.Object3D | null; saved: number | null }
interface Fade { target: V3; yaw: number; total: number; t: number; moved: boolean; done: () => void }

type RigLike = {
  root?: THREE.Object3D;
  setPose?: (p: Pose, blend?: number) => void;
  setOpacity?: (a: number) => void;
  setMaterialMode?: (m: 'standard' | 'ghost' | 'replay' | 'silhouette') => void;
  setVariant?: (v: string) => void;
  update?: (dt: number, speed: number) => void;
  props?: Readonly<Record<string, THREE.Object3D>>;
};

class Npc implements NpcHandle {
  readonly root = new THREE.Group();
  present = false;
  yielded = false;
  revealed = false;
  placedPos: V3 | null = null;
  fade: Fade | null = null;
  interaction: InteractableHandle | null = null;
  readonly lights: FollowLight[] = [];
  readonly rig: RigLike;
  readonly body: THREE.Object3D;

  constructor(readonly def: NpcDef, private readonly sys: NpcSystem) {
    this.root.name = def.id;
    this.rig = def.rig as RigLike;
    this.body = def.rig instanceof THREE.Object3D ? def.rig : (def.rig as { root: THREE.Object3D }).root;
    this.root.add(this.body);
  }
  get id(): NpcId {
    return this.def.id;
  }
  fadeTo(pos: V3, yaw: number, sec = FADE_SEC): Promise<void> {
    this.fade?.done();
    return new Promise(resolve => {
      this.fade = { target: pos, yaw, total: Math.max(0.001, sec), t: 0, moved: false, done: resolve };
    });
  }
  setPose(p: Pose): void {
    this.rig.setPose?.(p);
  }
  lookAt(p: V3): void {
    this.root.rotation.y = yawToRotY(yawTowards(this.root.position, p));
  }
  setLabel(t: string | ((s: StateView) => string)): void {
    this.interaction?.setLabel(t);
  }
  setVariant(v: string): void {
    if (this.rig.setVariant) this.rig.setVariant(v);
    else devWarn(`NPC '${this.def.id}' 的造型没有 setVariant`);
  }
  setOpacity(a: number): void {
    if (this.rig.setOpacity) this.rig.setOpacity(a);
    else this.body.visible = a > 0.5;
  }
  /** 渲染可见 = 在场且没让位 */
  syncVisible(): void {
    this.root.visible = this.present && !this.yielded;
    this.sys.syncLights(this);
  }
}

export class NpcSystem {
  protected readonly game: Game;
  private readonly npcs = new Map<NpcId, Npc>();
  private readonly tmp = new THREE.Vector3();

  constructor(game: Game) {
    this.game = game;
    game.events.on('flag', () => this.reevaluate());
    game.events.on('temp', () => this.reevaluate());
  }

  /** ctx.npc() 调用：建根节点、登记交互物（InteractionSystem.register）与拍照主体 ref（id 同 NPC id）、跟随灯；本区 root/ctx 经 game.areas.current 取（build 期间已指向本区，ARCH §4.5 第 4 步） */
  add(d: NpcDef): NpcHandle {
    const cur = this.game.areas.current;
    devAssert(cur !== null, `NpcSystem.add(${d.id})：当前没有区域`);
    devAssert(!this.npcs.has(d.id), `NpcSystem.add: NPC '${d.id}' 重复登记`);
    const npc = new Npc(d, this);
    npc.root.visible = false;
    if (cur) {
      const o: { layer: 'yin' | 'world'; ref: string; tempC?: number } = { layer: d.yin ? 'yin' : 'world', ref: d.id };
      if (d.tempC !== undefined) o.tempC = d.tempC;
      cur.ctx.add(npc.root, o);
    }
    if (d.tempC !== undefined) {
      const t = d.tempC;
      npc.root.traverse(x => { x.userData.tempC = t; });
    }
    npc.root.userData.npc = d.id;
    if (d.photoAnchorY !== undefined) npc.root.userData.photoAnchorY = d.photoAnchorY;
    for (const l of d.lights ?? []) {
      const anchor = typeof l.anchor === 'string' ? (npc.rig.props?.[l.anchor] ?? npc.root.getObjectByName(l.anchor) ?? null) : l.anchor;
      devAssert(anchor !== null, `NPC '${d.id}' 的跟随灯锚点 '${String(l.anchor)}' 找不到`);
      npc.lights.push({ light: l.light, anchor, saved: null });
    }
    const { anchorY, ...interact } = d.interact;
    const ay = anchorY ?? NPC_ANCHOR_Y;
    const userPresent = compileCond(interact.present, `npc ${d.id}.present`);
    const def: InteractableDef = {
      ...interact,
      id: d.id,
      at: () => npc.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, ay, 0)),
      hit: interact.hit ?? npc.root,
      present: s => npc.present && !npc.yielded && userPresent(s),
    };
    this.npcs.set(d.id, npc);
    npc.interaction = this.game.sys.interaction.register(def, cur?.def.id ?? 'dev');
    this.place(npc, true);
    return npc;
  }
  get(id: NpcId): NpcHandle | undefined {
    return this.npcs.get(id);
  }
  /** 进区域、每次 'flag'/'temp' 事件后按 placement 重算站位与在场 */
  reevaluate(): void {
    for (const n of this.npcs.values()) this.place(n, false);
  }
  /** 回放让位：3D 距离 ≤ radius 的现世 NPC visible=false、yielded=true（ReplaySystem 调用，ARCH §6.9） */
  yieldWithin(center: V3, radius: number): void {
    const c = this.tmp.set(center[0], center[1], center[2]);
    for (const n of this.npcs.values()) {
      if (!n.present || n.yielded) continue;
      if (n.root.getWorldPosition(new THREE.Vector3()).distanceTo(c) > radius) continue;
      n.yielded = true;
      n.syncVisible();
    }
  }
  /** 回到现在时复原 */
  restoreYield(): void {
    for (const n of this.npcs.values()) {
      if (!n.yielded) continue;
      n.yielded = false;
      n.syncVisible();
    }
  }
  /** 离开区域时移除本区全部 NPC */
  clearArea(): void {
    for (const n of this.npcs.values()) {
      n.fade?.done();
      n.fade = null;
      n.root.parent?.remove(n.root);
    }
    this.npcs.clear();
  }
  /** 淡入淡出、跟随灯、NpcDef.update */
  update(dt: number): void {
    const s = this.game.state;
    for (const n of this.npcs.values()) {
      if (n.def.yin && !n.revealed && s.seen(n.def.id)) this.reveal(n);
      if (n.fade) this.stepFade(n, dt);
      if (n.present && !n.yielded) {
        n.rig.update?.(dt, 0);
        n.def.update?.(n, dt);
      }
      this.syncLights(n);
    }
  }

  // ——————————————————————————————— WP4 内部（非冻结签名）

  /** 跟随灯：摆到锚点；不在场/让位时强度置 0 并记下原值，回来时还原。 */
  syncLights(n: Npc): void {
    if (n.lights.length === 0) return;
    const on = n.present && !n.yielded;
    for (const f of n.lights) {
      if (on) {
        if (f.saved !== null) {
          f.light.intensity = f.saved;
          f.saved = null;
        }
        if (f.anchor) {
          const p = f.anchor.getWorldPosition(this.tmp);
          if (f.light.parent) f.light.parent.worldToLocal(p);
          f.light.position.copy(p);
        }
      } else if (f.saved === null) {
        f.saved = f.light.intensity;
        f.light.intensity = 0;
      }
    }
  }
  /**
   * M4：角标锚点——头顶上方（UI 用；交互距离、瞄准点仍用 NpcDef 的 anchorY 锚点）。
   * 有头部锚点且头部网格可见时取头心 + 0.25m（头顶再往上一点，名字不盖脸）；否则（纸人、只剩灯笼的土地）
   * 取交互锚点与头部锚点中较高者再往上 0.15m。不在场或让位时返回 null。
   */
  markerAnchor(id: NpcId, target: THREE.Vector3): THREE.Vector3 | null {
    const n = this.npcs.get(id);
    if (!n || !n.present || n.yielded) return null;
    const anchors = (n.rig as { anchors?: { head?: THREE.Object3D } }).anchors;
    const head = anchors?.head;
    const slot = head?.parent ?? null;
    const rigRoot = (n.rig as { root?: THREE.Object3D }).root;
    // 头部锚点直接挂在造型根上（黄三爷：三个变体共用）时算可见；挂在关节上时看同一关节下的头部网格是否可见
    const headShown = !!slot && (slot === rigRoot || slot.children.some(c => (c as THREE.Mesh).isMesh && c.visible));
    if (head && headShown) {
      head.getWorldPosition(target);
      target.y += 0.25;
      return target;
    }
    const ay = n.def.interact.anchorY ?? NPC_ANCHOR_Y;
    n.root.getWorldPosition(target);
    target.y += ay + 0.15;
    return target;
  }
  /** 已登记的 NPC id（自测用）。 */
  ids(): NpcId[] {
    return [...this.npcs.keys()];
  }

  private reveal(n: Npc): void {
    n.revealed = true;
    addLayerRecursive(n.root, 'world');
    n.rig.setMaterialMode?.('ghost');
  }

  private place(n: Npc, first: boolean): void {
    const p = n.def.placement(this.game.state);
    const wasPresent = n.present;
    const prev = n.placedPos;
    if (!p) {
      if (!wasPresent && !first) return;
      n.present = false;
      n.placedPos = null;
      n.syncVisible();
      if (wasPresent) n.def.onPlaced?.(n, prev);
      return;
    }
    const moved = !prev || prev[0] !== p.pos[0] || prev[1] !== p.pos[1] || prev[2] !== p.pos[2];
    if (wasPresent && !moved) {
      if (p.pose) n.rig.setPose?.(p.pose);
      return;
    }
    n.present = true;
    n.placedPos = p.pos;
    if (wasPresent && moved && n.def.onPlaced) {
      // 换站位交给区域（通常 fadeTo）；这里不瞬移
      n.def.onPlaced(n, prev);
      return;
    }
    n.root.position.set(p.pos[0], p.pos[1], p.pos[2]);
    n.root.rotation.y = yawToRotY(p.yaw);
    if (p.pose) n.rig.setPose?.(p.pose);
    n.syncVisible();
    n.def.onPlaced?.(n, prev);
  }

  private stepFade(n: Npc, dt: number): void {
    const f = n.fade!;
    f.t += dt;
    const half = f.total / 2;
    if (!f.moved && f.t >= half) {
      f.moved = true;
      n.root.position.set(f.target[0], f.target[1], f.target[2]);
      n.root.rotation.y = yawToRotY(f.yaw);
    }
    const a = f.t < half ? 1 - f.t / half : Math.min(1, (f.t - half) / half);
    n.setOpacity(a);
    if (f.t >= f.total) {
      n.setOpacity(1);
      n.fade = null;
      f.done();
    }
  }
}
