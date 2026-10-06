// owner: WP4
// 交互系统（ARCH §6.6）：聚焦、角标、activate() 唯一入口、动作菜单/挑选器流程（mode.album 的 pick 参数）。
// 角标不得泄露谜底（硬规则，GDD §10.2）。
//
// 实现要点（WP4）：
// - 聚焦（每帧，仅栈顶为 explore/viewfinder/replay 且栈上没有面板时）：
//   1) 当前主相机的中心射线，与本区可见网格求交（Raycaster.layers = 相机掩码；three 的 Raycaster 不看 visible，
//      所以只收集 traverseVisible 得到的网格，命中后再查祖先链）。按距离依次看：属于某交互物 hit 子树的 → 候选
//      （在场、视图允许、镜头到锚点 ≤ range）；userData.noOcclude（对象或材质上）或 occlude:false、材质不可见的非交互网格 → 穿过；
//      其他网格 → 挡住，停。没有 hit 的交互物按锚点处直径 0.25m 的球参与同一条射线。候选取 priority 最高、再取最近。
//   2) 射线没选中时：射程内、proximityFocus !== false、在身体朝向 ±60° 内的交互物取 priority 最高、再取最近。
//   3) 视图不符的阴物（view 为 'viewfinder' 且未因 revealOnVfInteract+seen 放宽，而取景器没开）不参与聚焦、角标不显示；
//      红外专属对象（lens 'ir'）在没开红外时同样不参与聚焦、角标不显示（M1d）。
//   透明网格默认不挡准星（与拍照/读字遮挡同一条规则 occludesView，M1d）。
// - activate 的检查顺序与 reason 照 ARCH §6.6；wrong_view/wrong_lens/blocked 显示反馈并放进 result.feedback。
//   主动作：有满足条件的 talk → 开对话；否则 onInteract；都没有时打开 owner 名下的密码锁/称呼面板（ctx.codeLock/naming 的自动接线）；
//   再没有 → “这儿用不上。”。出示/使用：accept[thing] → any(thing, g) → fallback/byKind/通用反馈；show 与 use 逻辑等价。
//   handler 作为顶层 run 执行（排队规则 §6.3）；api 来源用 game.settle() 等到 settle（锁步下推进时间），玩家来源只等 effects.settled()。
//   result.feedback：失败时是显示的反馈；成功时是本次执行期间最后一条 'feedback' 事件的文本（如取件格的“空的。”）。
// - E 键（interactFocused）：先做与 activate 相同的前置检查（失败直接给反馈）；既有主动作又有 offers → album{menu}；只有 offers → album{pick}；
//   只有主动作 → activate(primary)。offers 按当前状态现算，undefined 算“没有”（伪装中的黄三爷）。
// - InteractableStatus 另带 marker（该不该画角标）与 blink（剩余闪烁秒）两个字段（运行期附加，非冻结签名），给 UI 用。

import * as THREE from 'three';
import type { ApiResult, AreaKey, Awaitable, LensMode, ModeId, Settle, V3 } from '../core/types';
import { fail, ok } from '../core/types';
import type { DialogueId, InteractId, ItemId, PhotoId, ThingId } from '../data/ids';
import { STRINGS } from '../data/strings';
import type { Game } from '../core/game';
import type { ActionResult } from '../core/actions';
import type { StateView } from './state';
import type { Cond } from './expr';
import { compileCond } from './expr';
import type { GameApi, Handler } from './effects';
import { E } from './effects';
import { angleDiff, yawTowards } from '../core/math';
import { occludesView } from './viewfinder';
import { devAssert, devWarn } from '../core/log';

/** 随 flags/临时状态现算的字段 */
export type Dyn<T> = T | ((s: StateView) => T);
export type ViewReq = 'any' | 'viewfinder' | 'naked';
export type LensReq = 'any' | 'normal' | 'ir';
export interface TalkEntry { when?: Cond; dialogue: DialogueId }

export interface InteractableDef {
  id: InteractId;
  /** 角标名字；**不得泄露谜底**（GDD §10.2） */
  label: Dyn<string>;
  /** 锚点（角标位置、距离计算、aimAt 目标） */
  at: V3 | (() => THREE.Vector3);
  /** 准星拾取用的网格（或 ref id）；缺省按锚点直径 0.25m 的球 */
  hit?: THREE.Object3D | string;
  /** 默认 3（从镜头位置到锚点的直线距离） */
  range?: Dyn<number>;
  /** 必须在哪种视图下交互（阴物 = 'viewfinder'），默认 'any' */
  view?: Dyn<ViewReq>;
  /** 默认 'any' */
  lens?: Dyn<LensReq>;
  /** 是否在场：假 → 无角标、不可交互（reason 'not_present'） */
  present?: Cond;
  /** 前置：假 → 灰色角标，交互显示 blocked。会泄题的对象不用 when */
  when?: Cond;
  /** 前置不满足的专属反馈（有 when 就必须写） */
  blocked?: string | ((s: StateView) => string);
  /** 视图/镜头不对时的反馈 */
  wrongView?: string | ((s: StateView) => string);
  /** 主动作（查看/拾取/扳开关）；可以在函数里按 g.vf.lens 等分支 */
  onInteract?: Handler;
  /** NPC/纸像：按序取第一个满足的对话 */
  talk?: TalkEntry[];
  /** 可出示/使用；按状态现算，undefined = 此刻没有出示/使用 */
  offers?: Dyn<OfferTable | undefined>;
  /** 阴物：取景器中交互后写 seen(id)，此后常光下半透明常显 */
  revealOnVfInteract?: boolean;
  /** 默认 true；取件格等密集物体设 false，只能用准星选中 */
  proximityFocus?: boolean;
  /** 聚焦优先级（大者优先） */
  priority?: number;
  /** 动作菜单里显示“出示…”还是“使用…”（NPC/纸像默认 show，物体默认 use） */
  menuVerb?: 'show' | 'use';
  /** “色彩辅助”打开时悬停显示的字幕，按状态现算，undefined = 不显示；不进角标 */
  colorHint?: Dyn<string | undefined>;
  /**
   * M4 第 2 轮：取景器里准星对着它时，名字画在准星环的哪一侧（缺省按规则：读字框显示时画在上方、倍率 ≥ 3× 时画在右侧，否则下方）。
   * 'above'：对象自己的编号/字印在它下面（取件格），名字别压住。
   */
  vfLabel?: 'below' | 'above' | 'right';
}

export interface OfferTable {
  /** 命中：执行（Handler 负责 E.used 等） */
  accept: Partial<Record<ThingId, Handler>>;
  /** accept 未命中时的通用处理器：返回 true 视为接受 */
  any?: (thing: ThingId, g: GameApi) => Awaitable<boolean>;
  /** 其他东西的专属反馈（原样退回） */
  fallback?: string | ((thing: ThingId, s: StateView) => string);
  byKind?: { photo?: string; item?: string };
}

export interface InteractableHandle {
  readonly id: InteractId;
  setAt(p: V3): void;
  setLabel(t: Dyn<string>): void;
  blink(): void;
  remove(): void;
}

export interface InteractableStatus {
  id: InteractId; label: string; distance: number; inRange: boolean; present: boolean;
  available: boolean; blockedText?: string; view: ViewReq; lens: LensReq;
  focused: boolean; hasOffers: boolean; screen?: { x: number; y: number };
  // —— M1c 冻结（WP4 的运行期字段，engine-wp4.md #2 / engine-wp6.md #2）——
  /** 此刻该画角标（在场、射程内、视图允许聚焦） */
  marker: boolean;
  /** 剩余闪烁秒（InteractableHandle.blink() 与提示空闲闪烁写 0.6，按游戏时间递减；UI 的角标据此闪烁） */
  blink: number;
  /** 现算的色彩辅助字幕 */
  colorHint?: string;
  /** 按 E 弹动作菜单时第二项的动词 */
  menuVerb: 'show' | 'use';
}

/** M1a/M1b 的别名：字段已并入 InteractableStatus（M1c）。 */
export type InteractableStatusEx = InteractableStatus;

export type ActivateRequest = { verb: 'primary' } | { verb: 'show' | 'use'; thing: ThingId };
/** activate 的返回（ARCH §6.6；DebugApi.interact/show/use 同形） */
export type ActivateResult = ApiResult<{ accepted: boolean; feedback?: string; opened?: ModeId; settle: Settle }>;

/** mode.album 的进入参数（ARCH §6.6 E 键流程） */
export type AlbumArg =
  | { tab?: 'photos' | 'items' }
  | { menu: { target: InteractId } }
  | { pick: { target: InteractId; verb: 'show' | 'use' } };

/** 缺省拾取球半径（直径 0.25m）。 */
export const DEFAULT_HIT_RADIUS = 0.125;
/** 默认交互距离（镜头到锚点）。 */
export const DEFAULT_RANGE = 3;
/** 就近聚焦的朝向半角。 */
export const PROXIMITY_HALF_ANGLE = 60;
/** 射线聚焦的最远距离（相机到命中点；第三人称相机在镜头后约 2.7m）。 */
const RAY_FAR = 14;
/** 一次闪烁的时长。 */
const BLINK_SEC = 0.6;
/** M4：取景器里准星对着射程外这么远以内的交互物时给灰色角标“（走近点）”，按 E 提示“太远了” */
const FAR_FOCUS_EXTRA = 4;

type MutableDef = { -readonly [K in keyof InteractableDef]: InteractableDef[K] };

interface Entry {
  readonly id: InteractId;
  readonly def: MutableDef;
  readonly area: AreaKey;
  readonly present: (s: StateView) => boolean;
  readonly when: (s: StateView) => boolean;
  hitObj: THREE.Object3D | null;
  blink: number;
  handle: InteractableHandle;
}

type Pre = { ok: true; e: Entry } | { ok: false; res: ActivateResult; show?: string };

const BASE_MODES: readonly ModeId[] = ['mode.explore', 'mode.viewfinder', 'mode.replay'];

const dyn = <T>(v: Dyn<T>, s: StateView): T => (typeof v === 'function' ? (v as (s: StateView) => T)(s) : v);

/** 对象及其祖先都 visible。 */
export function visibleChain(o: THREE.Object3D | null): boolean {
  for (let x = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

/** 不挡准星的网格：与拍照/读字遮挡同一条规则（M1d，viewfinder.ts 的 occludesView；透明网格默认不挡）。 */
function seeThrough(o: THREE.Object3D): boolean {
  return !occludesView(o);
}

export class InteractionSystem {
  protected readonly game: Game;
  private readonly entries = new Map<InteractId, Entry>();
  private readonly pending = new Map<InteractId, { entries: TalkEntry[]; first: boolean }[]>();
  private focusId: InteractId | null = null;
  /** M4：取景器里准星对着、但在射程外（≤ 射程 + 4m）的交互物；没有正常聚焦时才有 */
  private farId: InteractId | null = null;
  /** M4：当前聚焦是不是中心射线命中的（false = 就近规则选出来的，可能不在准星上） */
  private byRay = false;
  private readonly ray = new THREE.Raycaster();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  private readonly sphere = new THREE.Sphere();

  constructor(game: Game) {
    this.game = game;
  }

  get focused(): InteractId | null {
    return this.focusId;
  }
  /** M4（WP4 内部）：准星对着的射程外交互物（取景器里；有正常聚焦时为 null）。HUD 画灰色角标“（走近点）”。 */
  /** M4（WP4 内部）：当前聚焦对象是准星（中心射线）对着的；就近规则选出的为 false。HUD 据此决定名字画在准星下方还是对象身上。 */
  get focusedByRay(): boolean {
    return this.focusId !== null && this.byRay;
  }
  get farFocused(): InteractId | null {
    return this.focusId === null ? this.farId : null;
  }
  /** hit 为 ref id 时经 game.areas.current!.ctx 解析（build 期间 current 已指向本区，ARCH §4.5 第 4 步） */
  register(def: InteractableDef, area: AreaKey): InteractableHandle {
    devAssert(!this.entries.has(def.id), `InteractionSystem.register: 交互物 '${def.id}' 重复登记`);
    devAssert(def.when === undefined || def.blocked !== undefined, `交互物 '${def.id}' 有 when 就必须写 blocked（ARCH §11.3）`);
    const copy: MutableDef = { ...def };
    if (def.talk) copy.talk = [...def.talk];
    const e: Entry = {
      id: def.id, def: copy, area,
      present: compileCond(def.present, `interactable ${def.id}.present`),
      when: compileCond(def.when, `interactable ${def.id}.when`),
      hitObj: null, blink: 0,
      handle: null as unknown as InteractableHandle,
    };
    e.handle = {
      id: def.id,
      setAt: p => { e.def.at = p; },
      setLabel: t => { e.def.label = t; },
      blink: () => { e.blink = BLINK_SEC; },
      remove: () => {
        if (this.entries.get(def.id) === e) this.entries.delete(def.id);
        if (this.focusId === def.id) this.focusId = null;
      },
    };
    this.entries.set(def.id, e);
    this.resolveHit(e);
    // 按调用顺序合并排队的 addTalk
    const q = this.pending.get(def.id);
    if (q) {
      this.pending.delete(def.id);
      for (const p of q) this.mergeTalk(e, p.entries, p.first);
    }
    return e.handle;
  }
  /** 向对象追加对话项；id 尚未登记时先排队，登记时按调用顺序合并；区域 build 结束仍未登记的 id 由 AreaContextImpl.finalize() 经 pendingTalks() 在 dev 下抛错 */
  addTalk(id: InteractId, entries: TalkEntry[], o?: { first?: boolean }): void {
    for (const t of entries) compileCond(t.when, `addTalk ${id}`);
    const e = this.entries.get(id);
    if (e) {
      this.mergeTalk(e, entries, o?.first === true);
      return;
    }
    const q = this.pending.get(id) ?? [];
    q.push({ entries: [...entries], first: o?.first === true });
    this.pending.set(id, q);
  }
  /** 离开区域时清空本区交互物与排队的 addTalk */
  clearArea(): void {
    this.entries.clear();
    this.pending.clear();
    this.focusId = null;
    this.farId = null;
  }
  /**
   * 已排队但目标仍未登记的 addTalk id（M1a 补写，ARCH §6.6）。dev 与生产都照实返回、自身不抛错；
   * AreaContextImpl.finalize() 在 build 结束时调用，dev 下非空即抛错。
   */
  pendingTalks(): readonly InteractId[] {
    return [...this.pending.keys()];
  }
  get(id: InteractId): InteractableDef | undefined {
    return this.entries.get(id)?.def;
  }
  list(): InteractableStatus[] {
    const g = this.game;
    const s = g.state;
    const eye = this.eye(this.v1);
    const out: InteractableStatus[] = [];
    for (const e of this.entries.values()) {
      const at = this.anchor(e, this.v2);
      const distance = eye.distanceTo(at);
      const range = dyn(e.def.range ?? DEFAULT_RANGE, s);
      const present = e.present(s);
      const available = e.when(s);
      const view = this.viewReq(e, s);
      const lens = this.lensReq(e, s);
      const offers = e.def.offers === undefined ? undefined : dyn(e.def.offers, s);
      const inRange = distance <= range;
      const st: InteractableStatusEx = {
        id: e.id, label: dyn(e.def.label, s), distance, inRange, present, available,
        view, lens,
        focused: this.focusId === e.id, hasOffers: offers !== undefined,
        marker: present && inRange && this.viewAllowsFocus(view, s) && this.lensAllowsFocus(lens, s), blink: e.blink, menuVerb: this.menuVerb(e),
      };
      if (!available) st.blockedText = this.blockedText(e, s);
      if (e.def.colorHint !== undefined) {
        const h = dyn(e.def.colorHint, s);
        if (h !== undefined) st.colorHint = h;
      }
      const sc = this.project(at);
      if (sc) st.screen = sc;
      out.push(st);
    }
    return out;
  }
  /** 唯一的交互入口：E 键、动作菜单、挑选器、调试 API 都调用它；按 ARCH §6.3 的 settle 语义返回 */
  async activate(id: InteractId, req: ActivateRequest, source: 'player' | 'api'): Promise<ActivateResult> {
    try {
      return await this.activateInner(id, req, source);
    } catch (err) {
      console.error(`[interaction] activate(${id}) 出错`, err);
      return fail('cancelled');
    }
  }
  /**
   * E 键流程（ARCH §6.6；explore/viewfinder/replay 的 interact 动作调用，M1a 补写）：对当前聚焦对象——
   * 既有主动作又有 offers → push mode.album{menu}；只有 offers → {pick}；只有主动作 → activate(primary)。
   * 同步返回（activate 在后台继续）；没有聚焦对象 → { ok:false, reason:'no_such_target' }。
   */
  interactFocused(source: 'player' | 'api'): ActionResult {
    const id = this.focusId;
    if (id === null) {
      // M4：准星对着射程外的东西按 E——给一句“太远了”，不触发任何动作（原来什么反馈都没有，新手以为按错了）
      if (this.farFocused !== null) {
        this.game.ui.toast(STRINGS.feedback.tooFar, 'feedback');
        return fail('out_of_range');
      }
      return fail('no_such_target');
    }
    const pre = this.precheck(id);
    if (!pre.ok) {
      this.reportFail(pre);
      return pre.res;
    }
    const e = pre.e;
    const s = this.game.state;
    const offers = e.def.offers === undefined ? undefined : dyn(e.def.offers, s);
    const primary = this.hasPrimary(e);
    if (offers !== undefined && primary) return this.game.modes.push('mode.album', { menu: { target: id } } satisfies AlbumArg);
    if (offers !== undefined) return this.game.modes.push('mode.album', { pick: { target: id, verb: this.menuVerb(e) } } satisfies AlbumArg);
    void this.activate(id, { verb: 'primary' }, source);
    return ok({ id });
  }
  /** 用当前相机立即重算一次聚焦（调试 API 的聚焦检查用） */
  focusCandidate(): InteractId | null {
    this.focusId = this.computeFocus();
    return this.focusId;
  }
  /** 计算聚焦与角标 */
  update(dt: number): void {
    for (const e of this.entries.values()) if (e.blink > 0) e.blink = Math.max(0, e.blink - dt);
    this.focusId = this.computeFocus();
    this.teachInteract();
  }

  /**
   * M4：第一次聚焦到一个可用的交互物时教一次“E：交互”（GDD §3.2“巡夜本在发光，按 E 拾取”；原来 STRINGS.tutorial.interact 从没用过）。
   * 与 E.tutorial 同一个去重键（存档里记着，一局只教一次）；角标上另有常驻的 E 提示。
   */
  private teachInteract(): void {
    const id = this.focusId;
    if (id === null) return;
    const g = this.game;
    const top = g.modes.top;
    if (top !== 'mode.explore' && top !== 'mode.viewfinder') return;
    // M4 第 2 轮：只在“风平浪静”（没有过场/对话/面板、不在加载与淡入、runner 空闲，持续 0.5 秒，UI.calmFor）时才算第一次聚焦——
    // 原来新游戏进区域的淡入里（开场过场压栈之前）就聚焦到了桌上的巡夜本，“E：交互”盖在片名卡上，玩家拿到控制时早过期了
    const ui = g.ui as { calmFor?: number; tutorial?: (t: string) => void; subs?: { toast(t: string, k: 'tutorial'): void } } | undefined;
    if (typeof ui?.calmFor === 'number' && ui.calmFor < 0.5) return;
    const st = g.state as { seen?: (k: string) => boolean; markSeen?: (k: string) => void };
    if (!st.seen || !st.markSeen) return;
    const key = `tutorial:${STRINGS.tutorial.interact}`;
    if (st.seen(key)) return;
    const e = this.entries.get(id);
    if (!e || !e.when(g.state)) return;
    st.markSeen(key);
    // 只出教学条、不发 'feedback'（不是剧情反馈；也不该混进正在进行的交互结果里）
    if (typeof ui?.tutorial === 'function') ui.tutorial(STRINGS.tutorial.interact);
    else ui?.subs?.toast(STRINGS.tutorial.interact, 'tutorial');
  }

  // ——————————————————————————————— WP4 内部（非冻结签名）

  /** 让某个交互物的角标闪一次（提示系统的空闲闪烁）。 */
  blink(id: InteractId): void {
    const e = this.entries.get(id);
    if (e) e.blink = BLINK_SEC;
  }
  /** 该对象此刻有没有主动作（talk / onInteract / 名下的面板）。 */
  hasPrimaryAction(id: InteractId): boolean {
    const e = this.entries.get(id);
    return e !== undefined && this.hasPrimary(e);
  }
  /** 动作菜单的出示/使用文案（menuVerb；NPC 与纸人默认 show，物体默认 use）。 */
  verbOf(id: InteractId): 'show' | 'use' {
    const e = this.entries.get(id);
    return e ? this.menuVerb(e) : 'use';
  }
  /** 当前锚点（世界坐标）；调试 API 的瞄准点解析也可用。 */
  anchorOf(id: InteractId, target = new THREE.Vector3()): THREE.Vector3 | null {
    const e = this.entries.get(id);
    return e ? this.anchor(e, target) : null;
  }
  /** 前置检查（不执行）：返回 reason 与应显示的反馈。调试 API 的“wrong_view”预判也可用。 */
  check(id: InteractId): ActivateResult {
    const pre = this.precheck(id);
    return pre.ok ? ok({ accepted: true, settle: 'idle' }) : pre.res;
  }

  private mergeTalk(e: Entry, entries: TalkEntry[], first: boolean): void {
    const cur = e.def.talk ?? [];
    e.def.talk = first ? [...entries, ...cur] : [...cur, ...entries];
  }

  private resolveHit(e: Entry): THREE.Object3D | null {
    if (e.hitObj) return e.hitObj;
    const h = e.def.hit;
    if (h === undefined) return null;
    const ctx = this.game.areas?.current?.ctx;
    const obj = typeof h === 'string' ? ctx?.getRef(h) ?? null : h;
    if (!obj) return null;
    e.hitObj = obj;
    // 带 hit 网格的交互物同时登记为同 id 的 ref（拍照主体解析，ARCH §6.8.3）
    if (ctx && ctx.getRef(e.id) === undefined) ctx.ref(e.id, obj);
    return obj;
  }

  private anchor(e: Entry, target: THREE.Vector3): THREE.Vector3 {
    const at = e.def.at;
    if (typeof at === 'function') return target.copy(at());
    return target.set(at[0], at[1], at[2]);
  }
  private eye(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.game.player.eye);
  }

  /** 生效的视图要求：revealOnVfInteract 且已被看见 → 'any'。 */
  private viewReq(e: Entry, s: StateView): ViewReq {
    if (e.def.revealOnVfInteract && s.seen(e.id)) return 'any';
    return e.def.view === undefined ? 'any' : dyn(e.def.view, s);
  }
  /** 视图不符的阴物（'viewfinder' 且取景器没开）不参与聚焦、不画角标。'naked' 在取景器里照样可聚焦（交互时给 wrongView）。 */
  private viewAllowsFocus(view: ViewReq, s: StateView): boolean {
    return view !== 'viewfinder' || s.vf;
  }
  private lensReq(e: Entry, s: StateView): LensReq {
    return e.def.lens === undefined ? 'any' : dyn(e.def.lens, s);
  }
  /**
   * 红外专属对象（lens 'ir'：冷迹等，只在红外画面里看得见）在没开红外时不参与聚焦、不画角标（M1d，GDD §3.7/§10.2“阴物只在其可见的视图下出现”）。
   * lens 'normal' 的对象在红外里照样看得见（红外画一切），仍可聚焦，交互时给 wrong_lens 反馈。
   */
  private lensAllowsFocus(lens: LensReq, s: StateView): boolean {
    return lens !== 'ir' || (s.vf && s.lens === 'ir');
  }

  private hasPrimary(e: Entry): boolean {
    return (e.def.talk?.length ?? 0) > 0 || e.def.onInteract !== undefined || this.game.sys.panels.hasPanel(e.id);
  }
  private menuVerb(e: Entry): 'show' | 'use' {
    if (e.def.menuVerb) return e.def.menuVerb;
    return e.id.startsWith('npc.') || e.id.startsWith('r4.stall_') ? 'show' : 'use';
  }
  private blockedText(e: Entry, s: StateView): string {
    const b = e.def.blocked;
    if (b === undefined) return STRINGS.reason.blocked;
    return typeof b === 'function' ? b(s) : b;
  }

  /** 视图/镜头/前置等同步检查（ARCH §6.6 的顺序），不执行也不显示。 */
  private precheck(id: InteractId): Pre {
    const g = this.game;
    const e = this.entries.get(id);
    const res = (reason: Parameters<typeof fail>[0], feedback?: string): Pre => ({
      ok: false,
      res: fail(reason, feedback === undefined ? { accepted: false, settle: 'idle' } : { accepted: false, feedback, settle: 'idle' }),
      ...(feedback === undefined ? {} : { show: feedback }),
    });
    if (!e) return res('no_such_target');
    const s = g.state;
    if (!e.present(s)) return res('not_present');
    if (!this.modeAllows(id)) return res('mode_disallows');
    const dist = this.eye(this.v1).distanceTo(this.anchor(e, this.v2));
    if (dist > dyn(e.def.range ?? DEFAULT_RANGE, s)) return res('out_of_range');
    const view = this.viewReq(e, s);
    const vf = g.sys.viewfinder.on;
    const wrong = (): string => {
      const w = e.def.wrongView;
      if (w === undefined) return STRINGS.reason.wrong_view;
      return typeof w === 'function' ? w(s) : w;
    };
    if ((view === 'viewfinder' && !vf) || (view === 'naked' && vf)) return res('wrong_view', wrong());
    const lensReq: LensReq = e.def.lens === undefined ? 'any' : dyn(e.def.lens, s);
    const lens: LensMode = vf ? g.sys.viewfinder.lens : 'normal';
    if (lensReq !== 'any' && lensReq !== lens) return res('wrong_lens', e.def.wrongView === undefined ? STRINGS.reason.wrong_lens : wrong());
    if (!e.when(s)) return res('blocked', this.blockedText(e, s));
    return { ok: true, e };
  }

  /** 当前模式允许交互：栈顶 explore/viewfinder/replay 且栈上没有面板；或栈顶是指向该对象的动作菜单/挑选器（先弹出它）。 */
  private modeAllows(id: InteractId): boolean {
    const m = this.game.modes;
    if (m.top === 'mode.album') {
      const arg = m.arg<AlbumArg>('mode.album');
      const target = arg && 'menu' in arg ? arg.menu.target : arg && 'pick' in arg ? arg.pick.target : null;
      if (target !== id) return false;
      m.pop('mode.album');
    }
    if (!BASE_MODES.includes(m.top)) return false;
    return !(m.has('mode.panel_vcr') || m.has('mode.panel_console') || m.has('mode.panel_code') || m.has('mode.panel_naming'));
  }

  private reportFail(pre: Extract<Pre, { ok: false }>): void {
    if (pre.show !== undefined) this.game.ui.toast(pre.show, 'feedback');
  }

  private owned(thing: ThingId): boolean {
    const s = this.game.state;
    return thing.startsWith('ph.') ? s.hasPhoto(thing as PhotoId) : s.has(thing as ItemId);
  }

  private async activateInner(id: InteractId, req: ActivateRequest, source: 'player' | 'api'): Promise<ActivateResult> {
    const g = this.game;
    const pre = this.precheck(id);
    if (!pre.ok) {
      this.reportFail(pre);
      return pre.res;
    }
    const e = pre.e;
    const s = g.state;
    if (req.verb !== 'primary' && !this.owned(req.thing)) return fail('not_owned', { accepted: false, settle: 'idle' });

    const topBefore = g.modes.top;
    let lastFb: string | undefined;
    const off = g.events.on('feedback', f => { lastFb = f.text; });
    let accepted = true;
    let decided: Promise<boolean> | null = null;
    try {
      // 取景器中成功交互阴物：此后常光下常显（先记，再开对话，对话里就能看见它）
      if (e.def.revealOnVfInteract && g.sys.viewfinder.on) s.markSeen(id);
      if (req.verb === 'primary') {
        this.runPrimary(e);
        g.events.emit('interact', { id, verb: 'primary', accepted: true });
      } else {
        decided = this.runOffer(e, req.verb, req.thing);
      }
      const settle = source === 'api' ? await g.settle() : await g.effects.settled();
      if (decided) {
        // any() 可能还在等（例如它开了对话）：已进入处理流程就算接受
        const d = await Promise.race([decided, Promise.resolve<null>(null)]);
        accepted = d ?? true;
      }
      const top = g.modes.top;
      const r: { accepted: boolean; feedback?: string; opened?: ModeId; settle: Settle } = { accepted, settle };
      if (lastFb !== undefined) r.feedback = lastFb;
      if (top !== topBefore && !BASE_MODES.includes(top)) r.opened = top;
      return ok(r);
    } finally {
      off();
    }
  }

  /** 主动作：talk（第一个满足的）→ onInteract → 名下面板 → 通用反馈。作为顶层 run。 */
  private runPrimary(e: Entry): void {
    const g = this.game;
    const s = g.state;
    const talk = e.def.talk?.find(t => compileCond(t.when, `talk ${e.id}`)(s));
    if (talk) {
      void g.effects.run([E.dialogue(talk.dialogue)], `interact:${e.id}`);
      return;
    }
    if (e.def.onInteract !== undefined) {
      void g.effects.runHandler(e.def.onInteract, `interact:${e.id}`);
      return;
    }
    if (g.sys.panels.hasPanel(e.id)) {
      const r = g.sys.panels.openFor(e.id);
      if (!r.ok) devWarn(`交互物 '${e.id}' 的面板打不开：${r.reason ?? ''}`);
      return;
    }
    g.ui.toast(STRINGS.feedback.nothingHere, 'feedback');
  }

  /** 出示/使用：accept → any → fallback/byKind/通用反馈。整个流程是一个顶层 run；返回“是否接受”。 */
  private runOffer(e: Entry, verb: 'show' | 'use', thing: ThingId): Promise<boolean> {
    const g = this.game;
    return new Promise<boolean>(resolve => {
      let decided = false;
      const decide = (v: boolean): void => {
        if (decided) return;
        decided = true;
        g.events.emit('interact', { id: e.id, verb, thing, accepted: v });
        resolve(v);
      };
      const offers = e.def.offers === undefined ? undefined : dyn(e.def.offers, g.state);
      const hit = offers?.accept[thing];
      const reject = (api: GameApi): void => {
        decide(false);
        api.feedback(this.rejectText(offers, thing));
      };
      if (hit !== undefined) {
        decide(true);
        void g.effects.runHandler(hit, `${verb}:${e.id}:${thing}`);
        return;
      }
      if (offers?.any) {
        const anyFn = offers.any;
        void g.effects.runHandler(async api => {
          const yes = await anyFn(thing, api);
          if (yes) decide(true);
          else reject(api);
        }, `${verb}:${e.id}:${thing}`).then(() => decide(true));
        return;
      }
      void g.effects.runHandler(api => reject(api), `${verb}:${e.id}:${thing}`);
    });
  }

  private rejectText(offers: OfferTable | undefined, thing: ThingId): string {
    const s = this.game.state;
    if (offers?.fallback !== undefined) return typeof offers.fallback === 'function' ? offers.fallback(thing, s) : offers.fallback;
    const kind = thing.startsWith('ph.') ? offers?.byKind?.photo : offers?.byKind?.item;
    return kind ?? STRINGS.feedback.nothingHere;
  }

  /** 把世界坐标投到画布 CSS 像素（在相机后方或没有画布时 undefined）。 */
  private project(p: THREE.Vector3): { x: number; y: number } | undefined {
    const g = this.game;
    const el = g.renderer?.domElement as HTMLCanvasElement | undefined;
    const cam = g.cameras?.camera;
    if (!el || !cam) return undefined;
    const v = this.v3.copy(p).project(cam);
    if (v.z < -1 || v.z > 1) return undefined;
    const w = el.clientWidth || el.width;
    const h = el.clientHeight || el.height;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  /** 聚焦规则（见文件头）。M4：顺带算出取景器里准星对着的射程外对象（this.farId）。 */
  private computeFocus(): InteractId | null {
    this.farId = null;
    this.byRay = false;
    const g = this.game;
    const m = g.modes;
    if (!BASE_MODES.includes(m.top)) return null;
    if (m.has('mode.panel_vcr') || m.has('mode.panel_console')) return null;
    const cur = g.areas.current;
    if (!cur || this.entries.size === 0) return null;
    const s = g.state;
    const eye = this.eye(this.v1);
    const vfOn = s.vf;

    // 可聚焦的交互物（在场、视图允许、射程内）；取景器里另记射程外不远的（M4）
    const ok = new Map<Entry, number>();   // entry → 镜头到锚点距离
    const far = new Map<Entry, number>();
    for (const e of this.entries.values()) {
      if (!e.present(s)) continue;
      if (!this.viewAllowsFocus(this.viewReq(e, s), s)) continue;
      if (!this.lensAllowsFocus(this.lensReq(e, s), s)) continue;
      const d = eye.distanceTo(this.anchor(e, this.v2));
      const range = dyn(e.def.range ?? DEFAULT_RANGE, s);
      if (d > range) {
        if (vfOn && d <= range + FAR_FOCUS_EXTRA) far.set(e, d);
        continue;
      }
      ok.set(e, d);
    }
    if (ok.size === 0 && far.size === 0) return null;

    // 1) 中心射线
    const cam = g.cameras.camera;
    cam.updateMatrixWorld();
    const origin = cam.getWorldPosition(this.v2);
    const dir = cam.getWorldDirection(this.v3);
    this.ray.set(origin, dir);
    this.ray.near = 0;
    this.ray.far = RAY_FAR;
    this.ray.layers.mask = cam.layers.mask;

    const owner = new Map<THREE.Object3D, Entry>();
    for (const e of this.entries.values()) {
      const h = this.resolveHit(e);
      if (h) h.traverse(o => { owner.set(o, e); });
    }
    const meshes = new Set<THREE.Object3D>();
    cur.root.traverseVisible(o => {
      if (!(o as THREE.Mesh).isMesh) return;
      if (o.userData.auxHide === true || o.userData.irHide === true) return;   // 雨丝等：不挡、不值得测
      meshes.add(o);
    });
    // hit 网格不一定挂在区域根下（例如单独的代理盒），也要测
    for (const o of owner.keys()) if ((o as THREE.Mesh).isMesh) meshes.add(o);

    type Hit = { d: number; e: Entry | null; stop: boolean };
    const hits: Hit[] = [];
    for (const h of this.ray.intersectObjects([...meshes], false)) {
      if (!visibleChain(h.object)) continue;
      const e = owner.get(h.object) ?? null;
      if (e) hits.push({ d: h.distance, e, stop: false });
      else hits.push({ d: h.distance, e: null, stop: !seeThrough(h.object) });
    }
    // 没有 hit 的交互物：锚点处的小球
    const sphere = this.sphere;
    for (const e of [...ok.keys(), ...far.keys()]) {
      if (e.def.hit !== undefined) continue;
      sphere.set(this.anchor(e, sphere.center), DEFAULT_HIT_RADIUS);
      const p = this.ray.ray.intersectSphere(sphere, this.v4);
      if (p) hits.push({ d: p.distanceTo(origin), e, stop: false });
    }
    hits.sort((a, b) => a.d - b.d);
    let best: { e: Entry; d: number } | null = null;
    let farBest: Entry | null = null;
    for (const h of hits) {
      if (h.stop) break;
      if (!h.e) continue;
      if (!ok.has(h.e)) {
        // M4 第 2 轮：准星先碰到的是射程外（取景器里 ≤ 4m）的对象——它挡在前面，就显示它的“（走近点）”，不再穿过它去选后面射程内的东西
        // （门厅里对着 3.2m 外的王奶奶，准星下写的是她身后的“楼梯”，按 E 弹出上楼对话）
        if (far.has(h.e)) {
          farBest ??= h.e;
          break;
        }
        continue;
      }
      const pr = h.e.def.priority ?? 0;
      if (!best || pr > (best.e.def.priority ?? 0)) best = { e: h.e, d: h.d };
    }
    if (best) {
      this.byRay = true;
      return best.e.id;
    }
    // 准星对着射程外的对象：优先显示它的“（走近点）”，不再按就近规则选别的
    if (farBest) {
      this.farId = farBest.id;
      return null;
    }
    if (ok.size === 0) return null;

    // 2) 就近：射程内、身体前方 ±60°；先比 priority 再比距离，隔着墙（碰撞体挡住眼 → 锚点）的不算（M3，docs/requests/r3.md #5）
    const pos = g.player.position;
    const body = g.player.bodyYaw;
    const near: { e: Entry; d: number }[] = [];
    for (const [e, d] of ok) {
      if (e.def.proximityFocus === false) continue;
      const a = this.anchor(e, this.v2);
      const dx = a.x - pos.x;
      const dz = a.z - pos.z;
      if (dx * dx + dz * dz > 1e-6 && Math.abs(angleDiff(body, yawTowards(pos, a))) > PROXIMITY_HALF_ANGLE) continue;
      near.push({ e, d });
    }
    near.sort((x, y) => (y.e.def.priority ?? 0) - (x.e.def.priority ?? 0) || x.d - y.d);
    for (const c of near) if (!this.wallBetween(eye, c.e)) return c.e.id;
    return null;
  }

  /**
   * 眼 → 锚点之间有没有墙（M3）：与调试 API interact 的真人路径检查同一判据（ARCH §12.3）——
   * `collision.raycast(眼 → 锚点, far = 距离 − 0.15, { skipSeeThrough: true, ignoreKeys: [id] })`：玻璃门这类 seeThrough 动态碰撞体与目标自身的碰撞体不算。
   */
  private wallBetween(eye: THREE.Vector3, e: Entry): boolean {
    // node 侧自测的简化 Game 没有碰撞系统：当作没有墙
    const col = (this.game as { collision?: Game['collision'] }).collision;
    if (!col) return false;
    const a = this.anchor(e, this.v4);
    const dir = this.v3.subVectors(a, eye);
    const dist = dir.length();
    if (dist <= 0.16) return false;
    dir.divideScalar(dist);
    return col.raycast(eye, dir, dist - 0.15, { skipSeeThrough: true, ignoreKeys: [e.id] }) !== null;
  }
}
