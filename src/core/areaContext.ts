// owner: WP1
// AreaContext 的实现（ARCH §11.2）：场景挂载、注册表、资源追踪、定时器、事件订阅自动解绑、区域临时状态、灯数冻结、console 合并。
// 玩法登记方法是各系统公开方法的薄包装（只转交，不另写逻辑）：console 的分次合并由 ConsoleSystem.configure 负责（ARCH §6.11）。

import * as THREE from 'three';
import type { AreaKey, ZoomLevel } from './types';
import type { InteractId } from '../data/ids';
import type { GameEvents } from './events';
import type { Game, GameCaps } from './game';
import type { ColliderBuilder, DynamicColliderHandle, DynamicShape } from './collision';
import type { TriggerDef, TriggerHandle } from './triggers';
import type { AreaAddOptions, AreaContext, AreaDef, AreaEnvironment, AreaPost, LevelsDef, LevelsHandle } from './area';
import { GameTimers } from './timers';
import { Disposer } from './disposer';
import { setLayerRecursive } from './layers';
import type { V3, XZ } from './types';
import { DEG2RAD } from './math';
import { devAssert, devWarn } from './log';
import type { StateView } from '../game/state';
import type { Cond } from '../game/expr';
import { compileCond } from '../game/expr';
import type { Effect, GameApi, RunOutcome } from '../game/effects';
import type { InteractableDef, InteractableHandle, TalkEntry } from '../game/interaction';
import type { NpcDef, NpcHandle } from '../game/npc';
import type { PhotoDecoyDef, PhotoTargetDef } from '../game/photo';
import type { ReadTargetDef } from '../game/read';
import type { ReplayPointDef } from '../game/replay';
import type { CodeLockDef, NamingDef } from '../game/panels';
import type { MirrorDef } from '../game/mirror';
import type { VcrConfig } from '../game/vcr';
import type { TripodConfig } from '../game/tripod';
import type { ConsoleConfig } from '../game/cctv';
import type { AmbienceHandle, AmbienceSpec } from '../audio/engine';
import type { PostPresetId } from '../fx/presets';
import type { FxParams } from '../fx/post';
import { areaEnvironment } from '../fx/environment';
import { BUDGET, LIGHT_SCALE, LOOK } from '../data/render';
import { rng as seededRng, seedFromString } from '../kit/rng';

/** 碰撞体共用的单位盒（只进 Octree，不进场景、不上传 GPU）。 */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

interface HdEntry {
  mesh: THREE.Mesh;
  lo: () => THREE.Texture;
  hi: () => THREE.Texture;
  minZoom: ZoomLevel;
  maxDist: number;
  loTex: THREE.Texture | null;
  hiTex: THREE.Texture | null;
  isHi: boolean;
}

interface Variant { naked?: THREE.Object3D; vf?: THREE.Object3D; ir?: THREE.Object3D }

type MapMaterial = THREE.Material & { map: THREE.Texture | null };

function hasMap(m: THREE.Material | THREE.Material[]): m is MapMaterial {
  return !Array.isArray(m) && 'map' in m;
}

function containsLight(obj: THREE.Object3D): boolean {
  let found = false;
  obj.traverse(o => {
    if ((o as THREE.Light).isLight === true) found = true;
  });
  return found;
}

export class AreaContextImpl implements AreaContext {
  readonly id: AreaKey;
  readonly root: THREE.Group;
  readonly lightsRoot: THREE.Group;
  /** 不加入场景的碰撞体根节点（ARCH §4.8） */
  readonly colliderRoot: THREE.Group;
  /** 本区游戏时间定时器（ARCH §3.2 第 7 步 ctx.timers.update(dt)） */
  readonly timers: GameTimers;
  readonly collider: ColliderBuilder;
  protected readonly gameRef: Game;
  protected readonly def: AreaDef;
  private readonly refMap = new Map<string, THREE.Object3D>();
  private readonly temps = new Map<string, boolean | number>();
  private readonly disposer = new Disposer();
  private readonly unsubs: (() => void)[] = [];
  private readonly lightList: THREE.Light[] = [];
  private lightsFrozen = false;
  private readonly variants: Variant[] = [];
  private readonly hd: HdEntry[] = [];
  private lvDef: LevelsDef | null = null;
  private lvHandle: LevelsHandle | null = null;
  private lvCurrent = 0;
  private postSpec: AreaPost;
  private envSpec: AreaDef['environment'];
  private ambSpec: AreaDef['ambience'];
  private lastPostKey: unknown = null;
  private lastEnvKey = '';
  private lastAmb: readonly AmbienceSpec[] | null = null;
  /** 当前那组环境声的句柄（与 lastAmb 同序；M1c，engine-wp3.md #11） */
  private ambHandles: readonly AmbienceHandle[] = [];
  private disposed = false;
  /** 本区经 GameApi.post.push（与 restore:false 的过场 post 步骤）推入的叠加层 key：卸载时逐个弹掉（M1d） */
  private readonly postKeys = new Set<string>();

  constructor(game: Game, def: AreaDef, root: THREE.Group) {
    this.gameRef = game;
    this.def = def;
    this.id = def.id;
    this.root = root;
    this.lightsRoot = new THREE.Group();
    this.lightsRoot.name = 'lightsRoot';
    // 永不隐藏：挂在 root 下，root 本身从不隐藏
    root.add(this.lightsRoot);
    this.colliderRoot = new THREE.Group();
    this.colliderRoot.name = 'colliderRoot';
    this.timers = new GameTimers();
    this.postSpec = def.post;
    this.envSpec = def.environment;
    this.ambSpec = def.ambience;
    this.collider = this.makeColliderBuilder();
    // 本区加载期间的 flag 变化：区域 onFlag 钩子；按状态现算的后期/环境贴图/环境声随之更新
    this.unsubs.push(game.events.on('flag', e => {
      if (this.disposed) return;
      try {
        this.def.onFlag?.(this, e);
      } catch (err) {
        console.error(`[AreaContext] ${this.id}.onFlag`, err);
      }
      this.applyAreaLook();
    }));
    // 函数形式的 post/environment/ambience 可以读区域临时状态（s.temp(key)）：'temp' 变化也重算（M1d）
    this.unsubs.push(game.events.on('temp', e => {
      if (this.disposed || e.area !== this.id) return;
      this.applyAreaLook();
    }));
  }

  // —— 引擎侧（非区域）公开成员（M1a 补写，ARCH §11.2）——
  /** ctx.levels() 返回的句柄；没有楼层的区域为 null（GameApi.setLevel、goto 的 floor、DebugState.floor 用它） */
  get levelsHandle(): LevelsHandle | null {
    return this.lvHandle;
  }
  /** 当前区域临时状态快照（DebugState.temp） */
  tempSnapshot(): Record<string, boolean | number> {
    return Object.fromEntries(this.temps);
  }
  /** 已登记的实时灯数（≤ 8，进区域后冻结） */
  get lightCount(): number {
    return this.lightList.length;
  }
  /** 全部 ref（lint 与主体解析校验用） */
  refs(): ReadonlyMap<string, THREE.Object3D> {
    return this.refMap;
  }
  /** 记下一个区域推入的后期叠加层 key（GameApi.post.push 调用；卸载时弹掉，M1d）。 */
  notePostKey(key: string): void {
    if (!this.disposed) this.postKeys.add(key);
  }
  /** ARCH §3.2 第 7 步每帧调用：按 game.sys.viewfinder 的 on/lens/zoom 与距离切换 viewVariant 与 hdText（ARCH §4.7、§6.8.1；ViewfinderSystem 不做）。 */
  updateViews(): void {
    if (this.variants.length === 0 && this.hd.length === 0) return;
    const vf = this.gameRef.sys.viewfinder;
    const view: 'naked' | 'vf' | 'ir' = vf.on ? (vf.lens === 'ir' ? 'ir' : 'vf') : 'naked';
    for (const v of this.variants) this.applyVariant(v, view);
    if (this.hd.length === 0) return;
    const eye = this.gameRef.player.eye;
    const p = new THREE.Vector3();
    for (const e of this.hd) {
      const want = vf.on && vf.zoom >= e.minZoom && e.mesh.getWorldPosition(p).distanceTo(eye) <= e.maxDist;
      if (want !== e.isHi) this.setHd(e, want);
    }
  }
  /**
   * build 结束（ARCH §4.5 第 4 步）：冻结灯数；game.sys.cctv.validate() 与 game.sys.interaction.pendingTalks()
   * 任一非空时在 dev 下抛错（信息列出缺失字段 / 未登记的 id）；出生点距离断言（triggers.assertSpawnClearance）。
   */
  finalize(): void {
    this.lightsFrozen = true;
    const g = this.gameRef;
    const missing = g.sys.cctv.validate();
    devAssert(missing.length === 0, () => `区域 ${this.id}：监控台配置缺字段 ${missing.join('、')}（ctx.console 需在 build 结束前提供齐全）`);
    const talks = g.sys.interaction.pendingTalks();
    devAssert(talks.length === 0, () => `区域 ${this.id}：addTalk 的目标没有登记：${talks.join('、')}`);
    const spawns = g.triggers.assertSpawnClearance(this.def.spawns);
    devAssert(spawns.length === 0, () => `区域 ${this.id}：出生点离触发体太近：\n${spawns.join('\n')}`);
  }
  /**
   * 卸载（ARCH §4.5 第 3 步）：依次调用 game.sys 的 replay/interaction/npc/photo/read/panels/vcr/cctv.clearArea()、crt.detach()、
   * mirror/tripod.clearArea() 与 game.triggers.clearArea()，再移除 root、释放追踪资源、清定时器/订阅/临时状态。
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const g = this.gameRef;
    const s = g.sys;
    const steps: [string, () => void][] = [
      ['replay.clearArea', () => s.replay.clearArea()],
      ['interaction.clearArea', () => s.interaction.clearArea()],
      ['npc.clearArea', () => s.npc.clearArea()],
      ['photo.clearArea', () => s.photo.clearArea()],
      ['read.clearArea', () => s.read.clearArea()],
      ['panels.clearArea', () => s.panels.clearArea()],
      ['vcr.clearArea', () => s.vcr.clearArea()],
      ['cctv.clearArea', () => s.cctv.clearArea()],
      ['crt.detach', () => s.crt.detach()],
      ['mirror.clearArea', () => s.mirror.clearArea()],
      ['tripod.clearArea', () => s.tripod.clearArea()],
      ['triggers.clearArea', () => g.triggers.clearArea()],
    ];
    // 一个系统清理失败不能让其余系统留着上一个区域的东西
    for (const [name, fn] of steps) {
      try {
        fn();
      } catch (err) {
        console.error(`[AreaContext] ${this.id} dispose: ${name}`, err);
      }
    }
    this.timers.clear();
    for (const u of this.unsubs.splice(0)) u();
    this.temps.clear();
    // 本区推的后期叠加层（暗房红灯、黎明色……）不带进下一个区域（M1d）
    for (const k of this.postKeys) g.pipeline.post.pop(k);
    this.postKeys.clear();
    // 视频线插头还插在本区的插孔上：先拔出（插孔节点随区域释放，插头的几何与材质是主角的）
    const pm = g.playerModel;
    pm.head.cable.plugTo(null);
    g.scene.remove(this.root);
    // 主角模型跨区域常驻：即使头还挂在本区的门楣支架上也不释放它
    const skip = (o: THREE.Object3D): boolean => o === pm.root || o === pm.head.group || o === pm.head.cable.plug;
    this.disposer.trackObject(this.root, skip);
    for (const e of this.hd) {
      if (e.loTex) this.disposer.track(e.loTex);
      if (e.hiTex) this.disposer.track(e.hiTex);
    }
    this.disposer.dispose();
    for (const o of this.colliderRoot.children) {
      const geo = (o as THREE.Mesh).geometry;
      if (geo && geo !== UNIT_BOX) geo.dispose();
    }
    this.colliderRoot.clear();
    g.scene.fog = null;
    g.scene.background = null;
    g.scene.environment = null;
    this.refMap.clear();
    this.variants.length = 0;
    this.hd.length = 0;
  }

  // —— AreaContext ——
  get game(): GameApi {
    return this.gameRef.api;
  }
  get state(): StateView {
    return this.gameRef.state;
  }
  get scene(): THREE.Scene {
    return this.gameRef.scene;
  }
  get quality(): 'low' | 'mid' | 'high' {
    return this.gameRef.settings.quality;
  }
  get caps(): GameCaps {
    return this.gameRef.caps;
  }

  add<T extends THREE.Object3D>(obj: T, o?: AreaAddOptions): T {
    devAssert(!containsLight(obj), () => `ctx.add(${obj.name || obj.type})：子树里有灯；灯只能用 ctx.light() 挂在 root/lightsRoot 下（ARCH §4.7）`);
    (o?.parent ?? this.root).add(obj);
    if (o?.layer !== undefined) setLayerRecursive(obj, o.layer);
    if (o?.tempC !== undefined) {
      const t = o.tempC;
      obj.traverse(n => {
        n.userData.tempC = t;
      });
    }
    if (o?.occlude !== undefined) {
      const no = !o.occlude;
      obj.traverse(n => {
        if ((n as THREE.Mesh).isMesh) n.userData.noOcclude = no;
      });
    }
    if (o?.ref !== undefined) this.ref(o.ref, obj);
    if (o?.collide) {
      obj.updateWorldMatrix(true, true);
      const b = new THREE.Box3().setFromObject(obj);
      if (!b.isEmpty()) {
        const c = b.getCenter(new THREE.Vector3());
        const sz = b.getSize(new THREE.Vector3());
        this.collider.box([c.x, c.y, c.z], [sz.x, sz.y, sz.z]);
      }
    }
    this.disposer.trackObject(obj);
    return obj;
  }
  ref(id: string, obj: THREE.Object3D): void {
    const prev = this.refMap.get(id);
    if (prev && prev !== obj) {
      // 同一个 id 指向两个不同对象多半是登记重复（例如 NPC 根节点与它的 hit 网格都按 NPC id 登记）：
      // 保留先登记的（拍照主体、hideWorld 可能已经引用它），只警告，不让整个区域加载失败
      devWarn(`ctx.ref('${id}')：已登记为另一个对象，保留先登记的那个`);
      return;
    }
    this.refMap.set(id, obj);
  }
  getRef(id: string): THREE.Object3D | undefined {
    return this.refMap.get(id);
  }
  light<T extends THREE.Light>(l: T, parent?: THREE.Object3D): T {
    const p = parent ?? this.root;
    devAssert(p === this.root || p === this.lightsRoot, `ctx.light：父节点只能是 root 或 lightsRoot（灯挂在可隐藏节点下会改变灯数，ARCH §4.7）`);
    devAssert(!this.lightsFrozen, `ctx.light：区域 ${this.id} 进区域后灯数已冻结，不能再加灯（关灯用强度 0）`);
    devAssert(this.lightList.length < BUDGET.lights, `ctx.light：区域 ${this.id} 实时灯超过 ${BUDGET.lights} 盏`);
    if (l.castShadow) {
      const shadows = this.lightList.filter(x => x.castShadow).length;
      devAssert(shadows < BUDGET.shadowLights, `ctx.light：投影光全局最多 ${BUDGET.shadowLights} 盏`);
    }
    l.layers.enableAll();
    p.add(l);
    // 聚光/平行光的 target 不在场景里时矩阵不更新：顺手挂到同一父节点下
    const target = (l as unknown as { target?: THREE.Object3D }).target;
    if (target && !target.parent) p.add(target);
    this.lightList.push(l);
    this.disposer.track(l);
    return l;
  }
  hemi(sky: THREE.ColorRepresentation, ground: THREE.ColorRepresentation, design: number): THREE.HemisphereLight {
    const h = new THREE.HemisphereLight(sky, ground, design * LIGHT_SCALE.hemi);
    h.name = 'hemi';
    return this.light(h);
  }
  fog(color: THREE.ColorRepresentation, density: number): void {
    this.gameRef.scene.fog = new THREE.FogExp2(color, density);
  }
  background(color: THREE.ColorRepresentation): void {
    this.gameRef.scene.background = new THREE.Color(color);
  }
  environment(e: AreaEnvironment): void {
    this.envSpec = e;
    this.applyEnv(true);
  }
  post(p: AreaDef['post']): void {
    this.postSpec = p;
    this.applyPost(true);
  }
  ambience(specs: readonly AmbienceSpec[], fadeSec?: number): readonly AmbienceHandle[] {
    this.ambSpec = specs;
    this.lastAmb = specs;
    this.ambHandles = this.gameRef.audio.setAmbience(specs, fadeSec);
    return this.ambHandles;
  }
  ambienceHandles(): readonly AmbienceHandle[] {
    return this.ambHandles;
  }
  viewVariant(o: { naked?: THREE.Object3D; vf?: THREE.Object3D; ir?: THREE.Object3D }): void {
    const v: Variant = {};
    if (o.naked) v.naked = o.naked;
    if (o.vf) v.vf = o.vf;
    if (o.ir) v.ir = o.ir;
    for (const n of [v.naked, v.vf, v.ir]) if (n) devAssert(!containsLight(n), `ctx.viewVariant：变体节点下不得挂灯（ARCH §4.7）`);
    this.variants.push(v);
    const vf = this.gameRef.sys.viewfinder;
    this.applyVariant(v, vf.on ? (vf.lens === 'ir' ? 'ir' : 'vf') : 'naked');
  }
  hdText(mesh: THREE.Mesh, lo: () => THREE.Texture, hi: () => THREE.Texture, o?: { minZoom?: ZoomLevel; maxDist?: number }): void {
    devAssert(hasMap(mesh.material), `ctx.hdText：网格 ${mesh.name || mesh.uuid} 的材质没有 map`);
    const e: HdEntry = { mesh, lo, hi, minZoom: o?.minZoom ?? 2, maxDist: o?.maxDist ?? 6, loTex: null, hiTex: null, isHi: true };
    this.hd.push(e);
    this.setHd(e, false);
  }
  setTemp(key: string, v: boolean | number): void {
    devAssert(key.length > 0 && !key.includes('.'), `ctx.setTemp('${key}')：临时状态键不带点（ARCH §0.3）`);
    const prev = this.temps.get(key) ?? false;
    if (prev === v) return;
    this.temps.set(key, v);
    this.gameRef.events.emit('temp', { area: this.id, key, value: v });
  }
  getTemp(key: string): boolean | number {
    return this.temps.get(key) ?? false;
  }
  interactable(d: InteractableDef): InteractableHandle {
    return this.gameRef.sys.interaction.register(d, this.id);
  }
  addTalk(id: InteractId, entries: TalkEntry[], o?: { first?: boolean }): void {
    this.gameRef.sys.interaction.addTalk(id, entries, o);
  }
  npc(d: NpcDef): NpcHandle {
    return this.gameRef.sys.npc.add(d);
  }
  trigger(d: TriggerDef): TriggerHandle {
    return this.gameRef.triggers.add(d);
  }
  photoTarget(d: PhotoTargetDef): void {
    this.gameRef.sys.photo.register([d], []);
  }
  photoDecoy(d: PhotoDecoyDef): void {
    this.gameRef.sys.photo.register([], [d]);
  }
  readTarget(d: ReadTargetDef): void {
    this.gameRef.sys.read.register([d]);
  }
  replayPoint(d: ReplayPointDef): void {
    this.gameRef.sys.replay.register([d], []);
  }
  codeLock(d: CodeLockDef): void {
    this.gameRef.sys.panels.registerCode(d);
  }
  naming(d: NamingDef): void {
    this.gameRef.sys.panels.registerNaming(d);
  }
  mirror(d: MirrorDef): void {
    this.gameRef.sys.mirror.register(d);
  }
  vcr(c: VcrConfig): void {
    this.gameRef.sys.vcr.configure(c);
  }
  tripod(c: TripodConfig): void {
    this.gameRef.sys.tripod.configure(c);
  }
  /** 可分多次提供并合并：直接转交 ConsoleSystem.configure（它负责合并与“同一字段给两次”的 dev 断言，ARCH §6.11）；齐全与否由 finalize 校验。 */
  console(c: Partial<ConsoleConfig>): void {
    this.gameRef.sys.cctv.configure(c);
  }
  levels(d: LevelsDef): LevelsHandle {
    devAssert(this.lvDef === null, `ctx.levels：区域 ${this.id} 只能登记一组楼层`);
    this.lvDef = d;
    this.lvCurrent = d.initial ?? 0;
    const self = this;
    this.lvHandle = {
      get current() {
        return self.lvCurrent;
      },
      set(n: number) {
        self.gameRef.areas.changeLevel(n).catch(err => console.error('[LevelsHandle.set]', err));
      },
    };
    return this.lvHandle;
  }
  on<K extends keyof GameEvents>(type: K, fn: (e: GameEvents[K]) => void): void {
    this.unsubs.push(this.gameRef.events.on(type, fn));
  }
  after(sec: number, fn: () => void): void {
    this.timers.after(sec, fn);
  }
  every(sec: number, fn: () => void): void {
    this.timers.every(sec, fn);
  }
  track<T extends { dispose(): void }>(r: T): T {
    return this.disposer.track(r);
  }
  run(list: readonly Effect[]): Promise<RunOutcome> {
    return this.gameRef.effects.run(list, `area:${this.id}`);
  }
  rng(salt?: number): () => number {
    return seededRng((seedFromString(this.id) + Math.imul(salt ?? 0, 0x9e3779b1)) >>> 0);
  }

  // ---------------------------------------------------------------- WP1 内部
  /** 进区域时（build 之前）按 AreaDef 应用后期、环境贴图、环境声；flag 变化后对函数形式的配置重算。 */
  applyAreaLook(): void {
    this.applyPost(false);
    this.applyEnv(false);
    this.applyAmbience();
  }

  /** 楼层 n 的地面高度（LevelsDef.y）。 */
  levelY(n: number): number {
    return this.lvDef ? this.lvDef.y(n) : 0;
  }

  /** 立即切到楼层 n（调用 LevelsDef.onChange，不淡出、不传送）；force 时即使同层也调用一次（进区域放置玩家时）。 */
  applyLevel(n: number, force = false): void {
    const d = this.lvDef;
    if (!d) return;
    // 楼层编号由区域自定（R2 用 1–5），这里只取整，不按 count 钳制
    const clamped = Math.round(n);
    const prev = this.lvCurrent;
    if (clamped === prev && !force) return;
    this.lvCurrent = clamped;
    d.onChange(clamped, prev);
    // 楼层节点显隐会改变 NPC 可见性等：按新楼层重算站位
    if (clamped !== prev) this.gameRef.sys.npc.reevaluate();
  }

  private applyVariant(v: Variant, view: 'naked' | 'vf' | 'ir'): void {
    const sel = view === 'ir' ? (v.ir ?? v.vf ?? v.naked) : view === 'vf' ? (v.vf ?? v.naked) : v.naked;
    for (const n of [v.naked, v.vf, v.ir]) if (n) n.visible = n === sel;
  }

  private setHd(e: HdEntry, hi: boolean): void {
    const m = e.mesh.material;
    if (!hasMap(m)) return;
    e.isHi = hi;
    if (hi) e.hiTex ??= e.hi();
    else e.loTex ??= e.lo();
    // 两张都是非空 map：换贴图不改变着色器变体，不需要 needsUpdate
    m.map = hi ? e.hiTex : e.loTex;
  }

  private applyPost(force: boolean): void {
    const spec = this.postSpec;
    let preset: PostPresetId;
    let overrides: Partial<FxParams> | undefined;
    if (typeof spec === 'function') preset = spec(this.gameRef.state);
    else if (typeof spec === 'string') preset = spec;
    else {
      preset = spec.preset;
      overrides = spec.overrides;
    }
    const key = overrides ? spec : preset;
    if (!force && key === this.lastPostKey) return;
    this.lastPostKey = key;
    this.gameRef.pipeline.post.setBase(preset, overrides);
  }

  private applyEnv(force: boolean): void {
    const spec = this.envSpec;
    const e: AreaEnvironment = spec === undefined
      ? { tint: '#ffffff', intensity: LOOK.envDefault }
      : typeof spec === 'function' ? spec(this.gameRef.state) : spec;
    const key = `${new THREE.Color(e.tint).getHexString()}|${e.intensity}`;
    if (!force && key === this.lastEnvKey) return;
    this.lastEnvKey = key;
    // M1d：look-dev 冻结的建议范围（§8.3）；低于 0.5 镜头玻璃与金属发黑。只提醒，不钳制
    const [lo, hi] = LOOK.envIntensity;
    if (e.intensity < lo || e.intensity > hi) devWarn(`区域 ${this.id} 的 environment.intensity ${e.intensity} 超出建议范围 [${lo}, ${hi}]（ARCH §8.3）`);
    const scene = this.gameRef.scene;
    scene.environment = areaEnvironment(this.gameRef.renderer, e.tint);
    scene.environmentIntensity = e.intensity;
  }

  private applyAmbience(): void {
    const spec = this.ambSpec;
    const list = spec === undefined ? [] : typeof spec === 'function' ? spec(this.gameRef.state) : spec;
    if (this.lastAmb && sameAmbience(this.lastAmb, list)) return;
    this.lastAmb = list;
    this.ambHandles = this.gameRef.audio.setAmbience(list);
  }

  private makeColliderBuilder(): ColliderBuilder {
    const root = this.colliderRoot;
    const box = (center: V3, size: V3, rotYDeg?: number): void => {
      const m = new THREE.Mesh(UNIT_BOX);
      m.position.set(center[0], center[1], center[2]);
      m.scale.set(Math.max(1e-3, Math.abs(size[0])), Math.max(1e-3, Math.abs(size[1])), Math.max(1e-3, Math.abs(size[2])));
      m.rotation.y = (rotYDeg ?? 0) * DEG2RAD;
      root.add(m);
    };
    const game = this.gameRef;
    return {
      box,
      wall(a: XZ, b: XZ, y0: number, height: number, thickness = 0.2): void {
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 1e-6) return;
        // 局部 x 轴对齐 a→b（与 collision.shapeToObb 的墙换算一致）
        box([(a[0] + b[0]) / 2, y0 + height / 2, (a[1] + b[1]) / 2], [len, height, thickness], Math.atan2(-dz, dx) / DEG2RAD);
      },
      floor(x0: number, z0: number, x1: number, z1: number, y = 0): void {
        // 顶面在 y 的 0.2m 厚板：够厚，快速下落时也不会穿过去
        box([(x0 + x1) / 2, y - 0.1, (z0 + z1) / 2], [Math.abs(x1 - x0), 0.2, Math.abs(z1 - z0)]);
      },
      mesh(m: THREE.Mesh): void {
        devAssert(!(m as THREE.InstancedMesh).isInstancedMesh, 'ctx.collider.mesh：InstancedMesh 请用 collider.instanced()');
        m.updateWorldMatrix(true, false);
        const g = m.geometry.clone();
        g.applyMatrix4(m.matrixWorld);
        root.add(new THREE.Mesh(g));
      },
      instanced(im: THREE.InstancedMesh): void {
        im.updateWorldMatrix(true, false);
        const inst = new THREE.Matrix4();
        const world = new THREE.Matrix4();
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, inst);
          world.multiplyMatrices(im.matrixWorld, inst);
          const g = im.geometry.clone();
          g.applyMatrix4(world);
          root.add(new THREE.Mesh(g));
        }
      },
      dynamic(key: string, shape: DynamicShape, enabled: Cond, o?: { seeThrough?: boolean }): DynamicColliderHandle {
        return game.collision.addDynamic(key, shape, compileCond(enabled, `collider:${key}`), o);
      },
    };
  }
}

/** 环境声配置是否“同一组”：函数形式的 ambience 每次调用都可能返回新数组，按内容比较，避免每个 flag 都重启环境声。 */
function sameAmbience(a: readonly AmbienceSpec[], b: readonly AmbienceSpec[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) continue;
    if ('custom' in x || 'custom' in y) return false;
    if (x.preset !== y.preset || x.gain !== y.gain) return false;
    if (JSON.stringify(x.params ?? null) !== JSON.stringify(y.params ?? null)) return false;
    if (JSON.stringify(x.at ?? null) !== JSON.stringify(y.at ?? null)) return false;
  }
  return true;
}
