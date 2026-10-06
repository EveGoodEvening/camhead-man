// owner: WP1
// 区域契约类型（ARCH §4.5、§11.1、§11.2）、defineArea / mergeAreaParts（M1a 已实现）、AreaManager（WP1 实现）。
// 注意：src/areas/* 在模块求值时就调用 defineArea/mergeAreaParts，所以本文件不得在运行时 import core/game.ts（ARCH §4.4）。

import * as THREE from 'three';
import type { ApiResult, AreaKey, Awaitable, ModeId, V3, ZoomLevel } from './types';
import { fail, ok } from './types';
import type { ExitId, InteractId, KeyPhotoId, NpcId, SpawnId } from '../data/ids';
import { DEV_IDS, isKnownId } from '../data/ids';
import { TIMING } from '../data/time';
import type { GameEvents } from './events';
import type { GameCaps, Game } from './game';
import type { LayerName } from './layers';
import type { ColliderBuilder } from './collision';
import type { TriggerDef, TriggerHandle } from './triggers';
import { spawnClearanceIssues } from './triggers';
import { AreaContextImpl } from './areaContext';
import type { Cond } from '../game/expr';
import { compileCond } from '../game/expr';
import type { StateView } from '../game/state';
import type { Effect, GameApi, RunOutcome } from '../game/effects';
import type { InteractableDef, InteractableHandle, TalkEntry } from '../game/interaction';
import type { NpcDef, NpcHandle } from '../game/npc';
import type { PhotoDecoyDef, PhotoTargetDef } from '../game/photo';
import type { ReadTargetDef } from '../game/read';
import type { ReplayPointDef, ReplaySegmentDef } from '../game/replay';
import type { DialogueDef } from '../game/dialogue';
import type { CutsceneDef } from '../game/cutscene';
import type { DocDef, JournalPageDef } from '../game/journal';
import type { PuzzleDef } from '../game/hints';
import type { CodeLockDef, NamingDef } from '../game/panels';
import type { MirrorDef } from '../game/mirror';
import type { VcrConfig } from '../game/vcr';
import type { TripodConfig } from '../game/tripod';
import type { ConsoleConfig } from '../game/cctv';
import type { FxParams } from '../fx/post';
import type { PostPresetId } from '../fx/presets';
import type { AmbienceHandle, AmbienceSpec } from '../audio/engine';
import type { ShotDef } from '../debug/shots';
/** M1d：再导出截图机位类型，区域的 shots.ts 从这里 import type（ARCH §2.12、§12.5）。 */
export type { ShotDef } from '../debug/shots';
import { warmupArea } from '../fx/warmup';
import { DEV_CHECKS, devAssert, devWarn } from './log';

// ---------------------------------------------------------------- 出生点与出入口（ARCH §4.5）
export interface SpawnDef { pos: V3; yaw: number; floor?: number }
export interface ExitDef {
  id: ExitId;
  to: SpawnId;
  /** 触发体积（走进去即切换）；GDD 规定 1.5m 见方；门洞类放在门框平面外侧（GDD §4 开头、§13.2） */
  box?: { center: V3; size: V3 };
  /** 或者：对该交互物按 E 时切换（本作目前没有这种出口） */
  via?: InteractId;
  /** 默认 'true' */
  when?: Cond;
  /** 条件不满足时的反馈；玩家被推回 0.6m */
  blocked?: string;
  /** 默认 0.8s */
  fade?: number;
  /** R2：触发体所在楼层。M1d 写明：信息字段，引擎目前不读（出入口图把 R2 各楼层视为连通；goto 按目标楼层经楼梯口测连通性） */
  floor?: number;
}

// ---------------------------------------------------------------- AreaDef（ARCH §11.1）
export type AreaPost = PostPresetId | { preset: PostPresetId; overrides?: Partial<FxParams> } | ((s: StateView) => PostPresetId);
export type AreaEnvironment = { tint: THREE.ColorRepresentation; intensity: number };

export interface AreaDef {
  id: AreaKey;
  /** '老街·长明照相馆' */
  name: string;
  /** 本区全部出生点（GDD §13.2） */
  spawns: Partial<Record<SpawnId, SpawnDef>>;
  exits: readonly ExitDef[];
  post: AreaPost;
  ambience?: readonly AmbienceSpec[] | ((s: StateView) => readonly AmbienceSpec[]);
  // —— 纯数据（进入时自动登记；启动时汇总到全局表）——
  /** 不依赖场景对象的交互物（也可在 build 里用 ctx.interactable 登记） */
  interactables?: readonly InteractableDef[];
  photoTargets?: readonly PhotoTargetDef[];
  photoDecoys?: readonly PhotoDecoyDef[];
  readTargets?: readonly ReadTargetDef[];
  replayPoints?: readonly ReplayPointDef[];
  segments?: readonly ReplaySegmentDef[];
  /** 来自 dialogue.ts */
  dialogues?: readonly DialogueDef[];
  cutscenes?: readonly CutsceneDef[];
  /** 来自 text.ts；启动时全局登记（阅读器随时可打开） */
  docs?: readonly DocDef[];
  /** 只有 R1 提供（新页①–⑨） */
  journalPages?: readonly JournalPageDef[];
  /** 启动时全局登记（提示系统跨区域使用） */
  puzzles?: readonly PuzzleDef[];
  photoArt?: Partial<Record<KeyPhotoId, (g: CanvasRenderingContext2D, w: number, h: number) => void>>;
  /** 本区空镜默认标题 */
  emptyCaption?: (s: StateView, near: InteractId | null) => string | undefined;
  /** 调试 API 的瞄准点覆盖（aimAt/interact/replay 的瞄准点解析第一步，ARCH §12.3）。M1d：删掉从未实现的 stand/floor（站位由测试脚本自己 goto） */
  automation?: Readonly<Record<string, { aim?: V3 }>>;
  /** 截图机位（ARCH §12.5） */
  shots?: readonly ShotDef[];
  /** 默认 0 */
  groundY?: (x: number, z: number) => number;
  /** ARCH §8.3 */
  environment?: AreaEnvironment | ((s: StateView) => AreaEnvironment);
  // —— 生命周期 ——
  /** 程序化几何、灯光、雾、碰撞、NPC、触发器、动态交互物 */
  build(ctx: AreaContext): Awaitable;
  onEnter?(ctx: AreaContext, info: { from: AreaKey | null; spawn: SpawnId }): void;
  onExit?(ctx: AreaContext): void;
  update?(ctx: AreaContext, dt: number): void;
  /** 本区加载期间的 flag 变化（开灯、开门……） */
  onFlag?(ctx: AreaContext, e: GameEvents['flag']): void;
}

/** 一个区域由几个独立代理/工作包分块编写时用：R1 = world + finale；dev = 各 WP 的测试布置。 */
export type AreaPart = Partial<Omit<AreaDef, 'id' | 'name' | 'spawns' | 'exits' | 'post' | 'build'>> & { build?(ctx: AreaContext): Awaitable };

/** mergeAreaParts 的第一个参数：id/name/spawns/exits/post 必填，其余可选（dev 沙盒的 base.ts 导出这个形状）。 */
export type AreaBase = Pick<AreaDef, 'id' | 'name' | 'spawns' | 'exits' | 'post'> & Partial<AreaDef>;

/** 只做类型收窄与 dev 校验。 */
export function defineArea(def: AreaDef): AreaDef {
  devAssert(typeof def.build === 'function', `defineArea(${def.id}): build 必须是函数`);
  for (const [spawn, s] of Object.entries(def.spawns)) {
    devAssert(spawn.startsWith('spawn.'), `defineArea(${def.id}): 出生点 id '${spawn}' 不是 spawn.*`);
    devAssert(s !== undefined && s.pos.length === 3, `defineArea(${def.id}): 出生点 '${spawn}' 缺 pos`);
  }
  const exitIds = new Set<string>();
  for (const e of def.exits) {
    devAssert(!exitIds.has(e.id), `defineArea(${def.id}): 出入口 '${e.id}' 重复`);
    exitIds.add(e.id);
    devAssert(e.box !== undefined || e.via !== undefined, `defineArea(${def.id}): 出入口 '${e.id}' 既没有 box 也没有 via`);
  }
  return def;
}

/**
 * 数组字段按顺序拼接（id 重复在 dev 下抛错）；photoArt/automation 合并（键重复抛错）；
 * build/onEnter/onExit/update/onFlag 按顺序依次调用；emptyCaption 依次询问，取第一个非 undefined；
 * ambience/groundY/environment 只允许 base 或一个 part 提供。
 */
export function mergeAreaParts(base: AreaBase, parts: readonly AreaPart[]): AreaDef {
  const all: readonly AreaPart[] = [base, ...parts];
  const where = `mergeAreaParts(${base.id})`;

  const cat = <T>(pick: (p: AreaPart) => readonly T[] | undefined, idOf: (t: T) => string, what: string): readonly T[] | undefined => {
    const out: T[] = [];
    const seen = new Set<string>();
    let any = false;
    for (const p of all) {
      const list = pick(p);
      if (!list) continue;
      any = true;
      for (const t of list) {
        const id = idOf(t);
        devAssert(!seen.has(id), `${where}: ${what} '${id}' 重复`);
        seen.add(id);
        out.push(t);
      }
    }
    return any ? out : undefined;
  };
  const rec = <V>(pick: (p: AreaPart) => Readonly<Record<string, V>> | undefined, what: string): Record<string, V> | undefined => {
    let out: Record<string, V> | undefined;
    for (const p of all) {
      const r = pick(p);
      if (!r) continue;
      out ??= {};
      for (const [k, v] of Object.entries(r)) {
        devAssert(!(k in out), `${where}: ${what} 的键 '${k}' 重复`);
        if (!(k in out)) out[k] = v;
      }
    }
    return out;
  };
  const single = <T>(pick: (p: AreaPart) => T | undefined, what: string): T | undefined => {
    let found: T | undefined;
    let n = 0;
    for (const p of all) {
      const v = pick(p);
      if (v === undefined) continue;
      n++;
      if (found === undefined) found = v;
    }
    devAssert(n <= 1, `${where}: ${what} 只能由 base 或一个 part 提供（现有 ${n} 个）`);
    return found;
  };

  const def: AreaDef = {
    id: base.id,
    name: base.name,
    spawns: base.spawns,
    exits: base.exits,
    post: base.post,
    async build(ctx) {
      for (const p of all) if (p.build) await p.build(ctx);
    },
  };

  const interactables = cat(p => p.interactables, d => d.id, 'interactables');
  if (interactables) def.interactables = interactables;
  const photoTargets = cat(p => p.photoTargets, d => d.id, 'photoTargets');
  if (photoTargets) def.photoTargets = photoTargets;
  const photoDecoys = cat(p => p.photoDecoys, d => d.key, 'photoDecoys');
  if (photoDecoys) def.photoDecoys = photoDecoys;
  const readTargets = cat(p => p.readTargets, d => d.id, 'readTargets');
  if (readTargets) def.readTargets = readTargets;
  const replayPoints = cat(p => p.replayPoints, d => d.id, 'replayPoints');
  if (replayPoints) def.replayPoints = replayPoints;
  const segments = cat(p => p.segments, d => d.id, 'segments');
  if (segments) def.segments = segments;
  const dialogues = cat(p => p.dialogues, d => d.id, 'dialogues');
  if (dialogues) def.dialogues = dialogues;
  const cutscenes = cat(p => p.cutscenes, d => d.id, 'cutscenes');
  if (cutscenes) def.cutscenes = cutscenes;
  const docs = cat(p => p.docs, d => d.id, 'docs');
  if (docs) def.docs = docs;
  const journalPages = cat(p => p.journalPages, d => String(d.index), 'journalPages');
  if (journalPages) def.journalPages = journalPages;
  const puzzles = cat(p => p.puzzles, d => d.id, 'puzzles');
  if (puzzles) def.puzzles = puzzles;
  const shots = cat(p => p.shots, d => d.id, 'shots');
  if (shots) def.shots = shots;

  const photoArt = rec(p => p.photoArt, 'photoArt');
  if (photoArt) def.photoArt = photoArt as AreaDef['photoArt'];
  const automation = rec(p => p.automation, 'automation');
  if (automation) def.automation = automation;

  const ambience = single(p => p.ambience, 'ambience');
  if (ambience !== undefined) def.ambience = ambience;
  const groundY = single(p => p.groundY, 'groundY');
  if (groundY !== undefined) def.groundY = groundY;
  const environment = single(p => p.environment, 'environment');
  if (environment !== undefined) def.environment = environment;

  const withEnter = all.filter(p => p.onEnter);
  if (withEnter.length) def.onEnter = (ctx, info) => { for (const p of withEnter) p.onEnter?.(ctx, info); };
  const withExit = all.filter(p => p.onExit);
  if (withExit.length) def.onExit = ctx => { for (const p of withExit) p.onExit?.(ctx); };
  const withUpdate = all.filter(p => p.update);
  if (withUpdate.length) def.update = (ctx, dt) => { for (const p of withUpdate) p.update?.(ctx, dt); };
  const withFlag = all.filter(p => p.onFlag);
  if (withFlag.length) def.onFlag = (ctx, e) => { for (const p of withFlag) p.onFlag?.(ctx, e); };
  const withCaption = all.filter(p => p.emptyCaption);
  if (withCaption.length) {
    def.emptyCaption = (s, near) => {
      for (const p of withCaption) {
        const r = p.emptyCaption?.(s, near);
        if (r !== undefined) return r;
      }
      return undefined;
    };
  }
  return def;
}

// ---------------------------------------------------------------- AreaContext（ARCH §11.2）
export interface LevelsDef {
  count: number;
  y: (n: number) => number;
  initial?: number;
  /** 负责显隐楼层节点、移动复用的声控灯（灯挂在 root/lightsRoot 下，只改位置与强度，不随楼层节点隐藏） */
  onChange: (n: number, prev: number) => void;
}
/** set 会先退出回放（walked_out），再淡出淡入 0.4s、传送到该层 (0,y,1.8) */
export interface LevelsHandle { readonly current: number; set(n: number): void }

export interface AreaAddOptions {
  /** 递归设置（跳过灯） */
  layer?: LayerName | LayerName[];
  /** 登记为可引用对象（拍照主体、aimAt、交互 hit、hideWorld、R1-world 与 R1-finale 共用的场景对象） */
  ref?: string;
  /** 写 userData.tempC（递归到网格） */
  tempC?: number;
  /** 默认：不透明网格 true */
  occlude?: boolean;
  /** true：同时以包围盒登记碰撞体（仅简单物体） */
  collide?: boolean;
  parent?: THREE.Object3D;
}

export interface AreaContext {
  readonly id: AreaKey;
  readonly game: GameApi;
  readonly state: StateView;
  readonly scene: THREE.Scene;
  /** 本区内容挂在这里 */
  readonly root: THREE.Group;
  readonly quality: 'low' | 'mid' | 'high';
  readonly caps: GameCaps;
  /** 永不隐藏的灯节点（跟随 NPC/头部的灯挂这里，ARCH §4.7） */
  readonly lightsRoot: THREE.Group;
  // 场景
  /** obj 子树里若含灯，dev 下抛错：灯只能用 ctx.light() 加 */
  add<T extends THREE.Object3D>(obj: T, o?: AreaAddOptions): T;
  ref(id: string, obj: THREE.Object3D): void;
  getRef(id: string): THREE.Object3D | undefined;
  /** 含 dynamic()（ARCH §4.8） */
  readonly collider: ColliderBuilder;
  /** 计入预算（≤8 含半球/环境光，dev 超出即抛错）；自动 layers.enableAll()；parent 只能是 root 或 lightsRoot（缺省 root）；进区域后灯数冻结，再加即抛错 */
  light<T extends THREE.Light>(l: T, parent?: THREE.Object3D): T;
  hemi(sky: THREE.ColorRepresentation, ground: THREE.ColorRepresentation, design: number): THREE.HemisphereLight;
  /** FogExp2 */
  fog(color: THREE.ColorRepresentation, density: number): void;
  background(color: THREE.ColorRepresentation): void;
  /** 运行中改环境贴图（寅时/卯时，ARCH §8.3） */
  environment(e: AreaEnvironment): void;
  /** 运行中改基础预设（寅时/卯时） */
  post(p: AreaDef['post']): void;
  /**
   * 运行中整组替换环境声（交叉淡变）。M1c：返回与 specs 同序的句柄（engine-wp3.md #11），区域可对单条环境声
   * set/stop（寅时雨声 `set('intensity', 0, 6)`、开市灯管 `tube_hum.set('on', 0, 0.5)`、CRT `crt_whine.set('on', 1)` 开机）。
   */
  ambience(specs: readonly AmbienceSpec[], fadeSec?: number): readonly AmbienceHandle[];
  /** M1c：当前生效的那组环境声句柄（`AreaDef.ambience` 自动设置的或最近一次 `ambience()` 设置的），与其 specs 同序。 */
  ambienceHandles(): readonly AmbienceHandle[];
  /** 按视图/镜头切换可见性（变体下不得挂灯） */
  viewVariant(o: { naked?: THREE.Object3D; vf?: THREE.Object3D; ir?: THREE.Object3D }): void;
  /** 取景器开启、倍率 ≥ minZoom（默认 2）、距离 ≤ maxDist（默认 6m）时换高清；黄三爷面具用 { minZoom: 4, maxDist: 5 } */
  hdText(mesh: THREE.Mesh, lo: () => THREE.Texture, hi: () => THREE.Texture, o?: { minZoom?: ZoomLevel; maxDist?: number }): void;
  // 区域临时状态（不存档，换区域清空；变化发 'temp' 事件；条件里用 temp(key)）
  /** key 不带点，如 'lamp_lit_1' */
  setTemp(key: string, v: boolean | number): void;
  getTemp(key: string): boolean | number;
  // 玩法登记
  interactable(d: InteractableDef): InteractableHandle;
  /** 给对象/NPC 追加对话项（R1-finale 用）；id 尚未登记时先排队，登记时合并（与另一方 build 的先后无关，ARCH §6.6） */
  addTalk(id: InteractId, entries: TalkEntry[], o?: { first?: boolean }): void;
  npc(d: NpcDef): NpcHandle;
  trigger(d: TriggerDef): TriggerHandle;
  photoTarget(d: PhotoTargetDef): void;
  photoDecoy(d: PhotoDecoyDef): void;
  readTarget(d: ReadTargetDef): void;
  replayPoint(d: ReplayPointDef): void;
  /** 自动给 owner 交互物接上 openCode */
  codeLock(d: CodeLockDef): void;
  naming(d: NamingDef): void;
  mirror(d: MirrorDef): void;
  vcr(c: VcrConfig): void;
  tripod(c: TripodConfig): void;
  /** 可分多次提供并合并（ARCH §6.11） */
  console(c: Partial<ConsoleConfig>): void;
  /** R2 楼层节点 */
  levels(d: LevelsDef): LevelsHandle;
  // 生命周期工具（卸载时自动清理）
  on<K extends keyof GameEvents>(type: K, fn: (e: GameEvents[K]) => void): void;
  after(sec: number, fn: () => void): void;
  every(sec: number, fn: () => void): void;
  track<T extends { dispose(): void }>(r: T): T;
  /** 顶层 run（排队，ARCH §6.3） */
  run(list: readonly Effect[]): Promise<RunOutcome>;
  /** 以区域 id 为种子 */
  rng(salt?: number): () => number;
}

// ---------------------------------------------------------------- 预编译

/**
 * renderer.compile/compileAsync 的包装（M1d，性能评审）：编译期间把渲染目标设成一张 1×1 的线性半浮点 RT。
 * three r186 按“当前渲染目标”决定程序的 outputColorSpace：目标为 null 时编出的是画到屏幕的 sRGB 变体，
 * 而主场景只画进后期链的线性 RT（CameraFxPass 才画到屏幕）——那样预编译的程序一个都用不上（M1c 实测 86 个里 35 个是死变体）。
 * compileAsync 内部先同步调用 compile()，所以渲染目标只需在调用前后切换。没有 KHR_parallel_shader_compile（SwiftShader）时直接 compile。
 */
export async function precompile(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera): Promise<void> {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const prev = renderer.getRenderTarget();
  let wait: Promise<unknown> = Promise.resolve();
  renderer.setRenderTarget(rt);
  try {
    if (renderer.extensions.has('KHR_parallel_shader_compile')) wait = renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
  } finally {
    renderer.setRenderTarget(prev);
  }
  try {
    await wait;
  } finally {
    rt.dispose();
  }
}

// ---------------------------------------------------------------- AreaManager（ARCH §4.5）
export interface LoadedArea {
  readonly def: AreaDef;
  readonly ctx: AreaContextImpl;
  readonly root: THREE.Group;
  readonly spawnUsed: SpawnId;
}

export type EnterReason = 'new' | 'load' | 'exit' | 'debug' | 'quality' | 'restored';

/** M4：原地重进用的快照（AreaManager.snapshotPlace；画质切换、WebGL 上下文恢复）。 */
export interface AreaPlaceSnapshot {
  area: AreaKey; spawn: SpawnId; pos: V3; yaw: number; pitch: number; floor?: number;
  temp: Record<string, boolean | number>;
}

/** goto 期间不能被传送打断的模式（ARCH §4.5、§12.2）。 */
const BUSY_MODES: readonly ModeId[] = ['mode.dialogue', 'mode.cutscene', 'mode.tripod'];
/** 进区域后的默认俯仰：第三人称略微低头，看得见脚下与前方的地面。 */
const DEFAULT_PITCH = -6;
/** 楼层切换后的落点（ARCH §11.2 LevelsHandle：传送到该层 (0, y, 1.8)，即楼梯口）。 */
const LEVEL_LANDING: readonly [number, number] = [0, 1.8];

type ExitCond = (s: StateView) => boolean;

export class AreaManager {
  protected readonly game: Game;
  private readonly defMap: ReadonlyMap<AreaKey, AreaDef>;
  private cur: LoadedArea | null = null;
  private readonly spawnIndex = new Map<SpawnId, AreaKey>();
  private readonly segmentIndex = new Map<string, AreaKey>();
  private readonly exitConds = new Map<string, ExitCond>();
  /** 进行中的切换（进区域、换楼层、带淡入淡出的传送）；>0 时 isLoading() 为真、输入被锁 */
  private transitions = 0;
  /** enter 的第 3–5 步（卸载旧区、建新区）期间为真：Game.step 跳过模拟 */
  private buildingNow = false;
  private buildStartedAt = 0;
  /** enter 串行化：同一时刻只建一个区域 */
  private enterChain: Promise<void> = Promise.resolve();
  private initialized = false;

  /** Game 构造时传入 src/areas/index.ts 的 AREAS。 */
  constructor(game: Game, defs: readonly AreaDef[]) {
    this.game = game;
    this.defMap = new Map(defs.map(d => [d.id, d] as const));
    // 出生点 → 区域、片段 → 区域：纯数据索引，构造时就能建（不访问其他系统）
    for (const d of defs) {
      for (const s of Object.keys(d.spawns) as SpawnId[]) {
        devAssert(!this.spawnIndex.has(s), `AreaManager: 出生点 ${s} 在两个区域里重复`);
        this.spawnIndex.set(s, d.id);
      }
      for (const seg of d.segments ?? []) this.segmentIndex.set(seg.id, d.id);
    }
  }

  /**
   * enter 第 4 步一建好新 root 与 AreaContextImpl 就指向新区域（静态登记与 build 期间已可用：NpcSystem.add、
   * InteractionSystem.register 经它取本区 root/ctx）；第 3 步卸载期间仍指向旧区，ctx.dispose() 返回后置 null（ARCH §4.5）。
   */
  get current(): LoadedArea | null {
    return this.cur;
  }
  get defs(): ReadonlyMap<AreaKey, AreaDef> {
    return this.defMap;
  }
  spawnArea(spawn: SpawnId): AreaKey {
    const a = this.spawnIndex.get(spawn);
    if (!a) throw new Error(`AreaManager.spawnArea: 未知出生点 ${spawn}`);
    return a;
  }

  enter(area: AreaKey, spawn: SpawnId, opts?: { reason?: EnterReason; fade?: number; restore?: AreaPlaceSnapshot }): Promise<void> {
    // 串行：画质切换与出口触发同时发生时不会交错地建两个区域
    const run = (): Promise<void> => this.doEnter(area, spawn, opts ?? {});
    const p = this.enterChain.then(run, run);
    this.enterChain = p.catch(() => undefined);
    return p;
  }

  /** 出入口的唯一执行路径：触发体、via 交互、GameApi.travel、goto 逐跳都调它；when 假 → { ok:false, reason:'blocked' } */
  travel(exit: ExitId): Promise<ApiResult<{ exit: ExitId; feedback?: string }>> {
    return this.travelImpl(exit, false);
  }

  /**
   * 出入口图 BFS，每跳要求 when 为真；失败时给出第一个被挡住的出口。
   * 不可达时（M1c）：在无视条件的出入口图上求一条“被挡出口数最少、其次跳数最少”的路线（0-1 最短路，
   * 字典序代价 [blocked, hops]），返回这条路线上的第一个被挡出口——即玩家沿最近的路走过去会撞上的那道门
   * （engine-wp7.md #1：以前按 BFS 发现顺序兜底，会报出不在路线上的出口）。目标在图上根本不连通时 exit 为 null。
   */
  route(from: AreaKey, to: AreaKey): { ok: true; hops: ExitId[] } | { ok: false; exit: ExitId | null } {
    if (from === to) return { ok: true, hops: [] };
    const prev = new Map<AreaKey, { area: AreaKey; exit: ExitId }>();
    const seen = new Set<AreaKey>([from]);
    const queue: AreaKey[] = [from];
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head]!;
      for (const e of this.defMap.get(u)?.exits ?? []) {
        const v = this.spawnIndex.get(e.to);
        if (v === undefined || seen.has(v) || !this.exitOpen(e)) continue;
        seen.add(v);
        prev.set(v, { area: u, exit: e.id });
        if (v === to) {
          const hops: ExitId[] = [];
          for (let a: AreaKey = to; a !== from;) {
            const p = prev.get(a)!;
            hops.unshift(p.exit);
            a = p.area;
          }
          return { ok: true, hops };
        }
        queue.push(v);
      }
    }
    return { ok: false, exit: this.firstBlockedOnRoute(from, to) };
  }

  /** 无视条件的最短路（代价 [被挡出口数, 跳数] 按字典序）上的第一个被挡出口；不连通时 null。 */
  private firstBlockedOnRoute(from: AreaKey, to: AreaKey): ExitId | null {
    type Node = { blocked: number; hops: number; firstBlocked: ExitId | null };
    const best = new Map<AreaKey, Node>([[from, { blocked: 0, hops: 0, firstBlocked: null }]]);
    const done = new Set<AreaKey>();
    const better = (a: Node, b: Node | undefined): boolean => !b || a.blocked < b.blocked || (a.blocked === b.blocked && a.hops < b.hops);
    // 区域数只有个位数：朴素 Dijkstra（每轮取未完成的最小代价节点）足够
    for (;;) {
      let u: AreaKey | null = null;
      let un: Node | undefined;
      for (const [k, n] of best) if (!done.has(k) && better(n, un)) { u = k; un = n; }
      if (u === null || !un) return null;
      if (u === to) return un.firstBlocked;
      done.add(u);
      for (const e of this.defMap.get(u)?.exits ?? []) {
        const v = this.spawnIndex.get(e.to);
        if (v === undefined || done.has(v)) continue;
        const open = this.exitOpen(e);
        const cand: Node = { blocked: un.blocked + (open ? 0 : 1), hops: un.hops + 1, firstBlocked: un.firstBlocked ?? (open ? null : e.id) };
        if (better(cand, best.get(v))) best.set(v, cand);
      }
    }
  }

  /**
   * 同区域；正在回放则先退出回放（reason walked_out）。
   * M1d：带淡入淡出时 beginTransition 之后的全部步骤都在 try/finally 里——等待超时或抛错时也会解锁输入、把黑幕撤掉，
   * 不会留下永久黑屏与挂起的输入。
   */
  async teleport(pos: V3, opts?: { yaw?: number; floor?: number; fade?: number }): Promise<void> {
    const g = this.game;
    if (g.sys.replay.active) g.sys.replay.exit('walked_out');
    const fade = opts?.fade && opts.fade > 0 ? this.fadeSec(opts.fade) : 0;
    const place = (): void => {
      const ctx = this.cur?.ctx;
      if (ctx && opts?.floor !== undefined) ctx.applyLevel(opts.floor);
      g.player.teleport(pos, opts?.yaw);
      g.triggers.resync();
      g.cameras.sync();
    };
    if (fade <= 0) {
      place();
      return;
    }
    this.beginTransition();
    try {
      g.ui.fade.black(1, fade);
      try {
        await g.waitGame(fade);
      } finally {
        place();
      }
      g.ui.fade.black(0, fade);
      await g.waitGame(fade);
    } catch (err) {
      g.ui.fade.black(0, 0);
      throw err;
    } finally {
      this.endTransition();
    }
  }

  /** 调试传送（ARCH §4.5） */
  async goto(area: AreaKey, x: number, z: number, floor?: number): Promise<ApiResult> {
    const g = this.game;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return fail('bad_args');
    if (!this.defMap.has(area)) return fail('bad_args');
    if (BUSY_MODES.some(m => g.modes.has(m)) || this.isLoading()) return fail('busy');
    if (!this.cur) return fail('no_such_target');
    let hops: ExitId[] | undefined;
    if (area !== this.cur.def.id) {
      const r = this.route(this.cur.def.id, area);
      if (!r.ok) {
        const feedback = r.exit ? this.findExit(r.exit)?.blocked : undefined;
        return { ok: false, reason: 'blocked', result: { exit: r.exit, feedback } };
      }
      hops = r.hops;
      // 逐跳走出入口（与玩家走进触发体是同一条路径，中间区域也完整进入一次）
      for (const h of r.hops) {
        const res = await this.travel(h);
        if (!res.ok) return res;
      }
    }
    const cur = this.cur;
    if (!cur) return fail('no_such_target');
    g.modes.popToBase();
    const ctx = cur.ctx;
    const lv = ctx.levelsHandle;
    const curFloor = lv?.current;
    const targetFloor = floor ?? curFloor;
    const y = lv && targetFloor !== undefined ? ctx.levelY(targetFloor) : (cur.def.groundY?.(x, z) ?? 0);
    if (g.url.test) {
      // “真人路径”检查（ARCH §3.5）：目标必须与玩家所在处在碰撞栅格上连通；楼层之间经楼梯口连通
      const p = g.player.position;
      const here: V3 = [p.x, p.y, p.z];
      let reachable: boolean;
      if (lv && curFloor !== undefined && targetFloor !== undefined && targetFloor !== curFloor) {
        const l0: V3 = [LEVEL_LANDING[0], ctx.levelY(curFloor), LEVEL_LANDING[1]];
        const l1: V3 = [LEVEL_LANDING[0], ctx.levelY(targetFloor), LEVEL_LANDING[1]];
        reachable = g.collision.reachable(here, l0, curFloor) && g.collision.reachable(l1, [x, y, z], targetFloor);
      } else {
        // 无楼层的区域用玩家所在高度做栅格（地面起伏由 groundY 决定，栅格只看障碍）
        reachable = g.collision.reachable(here, [x, lv ? y : p.y, z], curFloor);
      }
      if (!reachable) return fail('unreachable');
    }
    await this.teleport([x, y, z], lv && floor !== undefined ? { floor } : undefined);
    // M4：同区域 goto 相当于真人走过去——坐着/躺着/蹲着的主角站起来（与 placePlayer 一致；真人一动 WASD 就会站起来，
    // 原来锁步截图里伙计保持坐姿“悬空坐着平移”）。过场里的传送另行摆姿势，不在这里改
    if (!g.modes.has('mode.cutscene')) g.playerModel.setPose('stand', 0);
    const pos = g.player.position;
    const out: { area: AreaKey; pos: [number, number, number]; mode: ModeId; hops?: ExitId[] } = { area, pos: [pos.x, pos.y, pos.z], mode: g.modes.top };
    if (hops) out.hops = hops;
    return ok(out);
  }

  isLoading(): boolean {
    return this.transitions > 0;
  }

  // ---------------------------------------------------------------- WP1 内部
  /** enter 第 3–5 步（卸载旧区、建新区）期间为真。 */
  get building(): boolean {
    return this.buildingNow;
  }
  /** 本次建区已持续的真实毫秒数（“载入中…”在 300ms 后出现，ARCH §3.1 第 8 步）。 */
  buildingForMs(): number {
    return this.buildingNow ? performance.now() - this.buildStartedAt : 0;
  }
  /** 片段所属区域（启动时建的全局索引）。 */
  segmentArea(seg: string): AreaKey | undefined {
    return this.segmentIndex.get(seg);
  }

  /**
   * 启动（ARCH §3.1 第 5 步）：汇总全部区域的对话、过场、谜题、文档、新页并登记给各系统；
   * dev 下校验出入口的目标出生点存在、每个出生点离本区出入口触发体 ≥ 0.8m、静态 id 已登记。
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    const all = [...this.defMap.values()];
    const s = this.game.sys;
    s.dialogue.register(all.flatMap(d => d.dialogues ?? []));
    s.cutscene.register(all.flatMap(d => d.cutscenes ?? []));
    s.hints.register(all.flatMap(d => d.puzzles ?? []));
    // dev 沙盒的 docs 是夹具（M1c）：与正式区域同 id 时让位给正式区域，不算重复（M2 起 R3 登记 doc.slip_0473 后沙盒那份自动失效）
    const realDocs = all.filter(d => d.id !== 'dev').flatMap(d => d.docs ?? []);
    const realDocIds = new Set<string>(realDocs.map(d => d.id));
    const devDocs = (this.defMap.get('dev')?.docs ?? []).filter(d => !realDocIds.has(d.id));
    s.journal.registerDocs([...realDocs, ...devDocs]);
    s.journal.registerPages(all.flatMap(d => d.journalPages ?? []));
    if (!DEV_CHECKS) return;
    const issues: string[] = [];
    const known = (id: string): boolean => isKnownId(id) || DEV_IDS.has(id);
    for (const d of all) {
      for (const sp of Object.keys(d.spawns)) if (!known(sp)) issues.push(`${d.id}: 出生点 ${sp} 未登记`);
      for (const e of d.exits) {
        if (!known(e.id)) issues.push(`${d.id}: 出入口 ${e.id} 未登记`);
        // via 出口（对交互物按 E 切换）本作没有，WP1 没有实现：只登记了 box 的出口会生成触发体
        if (!e.box) devWarn(`${d.id}: 出入口 ${e.id} 只有 via、没有 box，不会生成触发体（via 出口未实现；可用交互物 onInteract: g => g.travel(id)）`);
        if (!this.spawnIndex.has(e.to)) issues.push(`${d.id}: 出入口 ${e.id} 的目标出生点 ${e.to} 不属于任何区域`);
      }
      issues.push(...spawnClearanceIssues(d.spawns, d.exits.filter(e => e.box).map(e => ({ key: e.id, box: e.box! }))).map(t => `${d.id}: ${t}`));
      const points = new Set((d.replayPoints ?? []).map(p => p.id));
      for (const seg of d.segments ?? []) if (!points.has(seg.point)) issues.push(`${d.id}: 片段 ${seg.id} 的残影点 ${seg.point} 不在本区 replayPoints 里`);
    }
    devAssert(issues.length === 0, () => `区域静态校验失败：\n${issues.join('\n')}`);
  }

  /** 楼层切换（LevelsHandle.set 的实现，ARCH §11.2）：先退出回放，淡出 0.4s → onChange → 传送到该层楼梯口 → 淡入。 */
  async changeLevel(n: number): Promise<void> {
    const g = this.game;
    const ctx = this.cur?.ctx;
    const lv = ctx?.levelsHandle;
    if (!ctx || !lv || n === lv.current || this.isLoading()) return;
    if (g.sys.replay.active) g.sys.replay.exit('walked_out');
    const fade = this.fadeSec(TIMING.floorFadeSec);
    this.beginTransition();
    try {
      g.ui.fade.black(1, fade);
      await g.waitGame(fade);
      ctx.applyLevel(n);
      g.player.teleport([LEVEL_LANDING[0], ctx.levelY(n), LEVEL_LANDING[1]]);
      g.triggers.resync();
      g.cameras.sync();
      g.sys.npc.reevaluate();
      g.ui.fade.black(0, fade);
      await g.waitGame(fade);
    } catch (err) {
      // M1d：等待超时或 onChange 抛错时也撤掉黑幕（否则永久黑屏）
      g.ui.fade.black(0, 0);
      throw err;
    } finally {
      this.endTransition();
    }
  }

  /**
   * 离开当前区域、不进新区域（M1d：结局播完回标题，Game.toTitle 用；ARCH §4.5）：锁输入 → 淡出 → 卸载（与 enter 第 3 步相同）→
   * current = null → 黑幕撤掉（标题菜单盖在上面）。没有区域时只撤黑幕。
   */
  leave(opts?: { fade?: number }): Promise<void> {
    const run = async (): Promise<void> => {
      const g = this.game;
      if (!this.cur) {
        g.ui.fade.black(0, 0);
        return;
      }
      const fade = this.fadeSec(opts?.fade ?? TIMING.areaFadeSec);
      this.beginTransition();
      try {
        g.effects.cancelAll('area');
        if (g.modes.stack.length > 1) g.modes.resetTo('mode.explore');
        g.ui.fade.black(1, fade);
        try {
          await g.waitGame(fade);
        } finally {
          this.buildingNow = true;
          this.buildStartedAt = performance.now();
          this.unload();
          this.buildingNow = false;
        }
      } finally {
        g.ui.fade.black(0, 0);
        this.endTransition();
      }
    };
    const p = this.enterChain.then(run, run);
    this.enterChain = p.catch(() => undefined);
    return p;
  }

  /**
   * M4（WP1 内部）：记下当前区域里玩家的位置、朝向、楼层与区域临时状态（画质切换、WebGL 上下文恢复后原地复原用）。
   */
  snapshotPlace(): AreaPlaceSnapshot | null {
    const cur = this.cur;
    if (!cur) return null;
    const g = this.game;
    const p = g.player.position;
    const floor = cur.ctx.levelsHandle?.current;
    return {
      area: cur.def.id, spawn: cur.spawnUsed, pos: [p.x, p.y, p.z], yaw: g.player.yaw, pitch: g.player.pitch,
      ...(floor !== undefined ? { floor } : {}), temp: cur.ctx.tempSnapshot(),
    };
  }

  /**
   * M4（WP1 内部）：WebGL 上下文丢失时同步卸载当前区域——旧的 GL 资源管理器此刻还在，释放调用落在已丢失的上下文上是静默的空操作；
   * 等上下文恢复（three 换了新的管理器）再释放，就会刷几百条“object does not belong to this context”。返回卸下前的位置快照。
   */
  unloadForContextLoss(): AreaPlaceSnapshot | null {
    if (!this.cur || this.buildingNow) return null;
    const g = this.game;
    const snap = this.snapshotPlace();
    g.effects.cancelAll('area');
    if (g.modes.stack.length > 1) g.modes.resetTo('mode.explore');
    this.unload();
    return snap;
  }

  private async doEnter(area: AreaKey, spawn: SpawnId, opts: { reason?: EnterReason; fade?: number; restore?: AreaPlaceSnapshot }): Promise<void> {
    const g = this.game;
    const def = this.defMap.get(area);
    if (!def) throw new Error(`AreaManager.enter: 未知区域 ${area}`);
    let spawnId = spawn;
    if (!def.spawns[spawnId]) {
      if (DEV_CHECKS) throw new Error(`AreaManager.enter: 出生点 ${spawn} 不属于区域 ${area}`);
      spawnId = Object.keys(def.spawns)[0] as SpawnId;
    }
    const from = this.cur?.def.id ?? null;
    const fade = this.fadeSec(opts.fade ?? TIMING.areaFadeSec);
    this.beginTransition();
    try {
      // 1. 打断一切进行中的 Effect 与临时模式（阻塞中的对话/过场以 cancelled 结束，§6.3）
      g.effects.cancelAll('area');
      if (g.modes.stack.length > 1) g.modes.resetTo('mode.explore');
      // 2. 淡出（游戏时间照走；锁步下 waitGame 自己 advance）
      if (this.cur) {
        g.ui.fade.black(1, fade);
        await g.waitGame(fade);
      } else {
        g.ui.fade.black(1, 0);
      }
      this.buildingNow = true;
      this.buildStartedAt = performance.now();
      // 画质：推迟的重进被回标题/新游戏取代时，渲染管线可能还是旧档（M1d）
      if (g.pipeline.qualityLevel !== g.settings.quality) g.pipeline.setQuality(g.settings.quality);
      // 3. 卸载旧区（期间 current 仍指向旧区）
      if (this.cur) this.unload();
      // 4. 建新区：root 与 ctx 一建好就把 current 指过去（build 期间各系统经它取本区）
      const root = new THREE.Group();
      root.name = `area:${area}`;
      g.scene.add(root);
      const ctx = new AreaContextImpl(g, def, root);
      this.cur = { def, ctx, root, spawnUsed: spawnId };
      ctx.applyAreaLook();
      for (const d of def.interactables ?? []) g.sys.interaction.register(d, def.id);
      const photoOpts: { emptyCaption?: AreaDef['emptyCaption']; photoArt?: AreaDef['photoArt'] } = {};
      if (def.emptyCaption) photoOpts.emptyCaption = def.emptyCaption;
      if (def.photoArt) photoOpts.photoArt = def.photoArt;
      g.sys.photo.register(def.photoTargets ?? [], def.photoDecoys ?? [], photoOpts);
      g.sys.read.register(def.readTargets ?? []);
      g.sys.replay.register(def.replayPoints ?? [], def.segments ?? []);
      for (const e of def.exits) {
        if (e.box) g.triggers.addDirect(e.id, e.box, () => this.onExitTrigger(e.id));
      }
      await def.build(ctx);
      g.collision.build(ctx.colliderRoot);
      const replayRoots = g.sys.replay.prebuild(root);
      this.validateLoaded(def, ctx);
      ctx.finalize();
      // 预编译（只覆盖此刻可见的材质变体）→ 预热其余变体（红外、后期分支、回放人影、feed，§13.1）
      // 预热之前就让阴影图更新（M3，docs/requests/r3.md #1）：shadowMap.autoUpdate = false 时新灯的 shadow.map 要等第一次阴影 pass 才建；
      // 在那之前渲染，r186 给 sampler2DShadow 数组绑的是没设比较模式的空深度贴图（WebGLUniforms 的数组 setter 不设 compareFunction），
      // 刷 GL_INVALID_OPERATION“texture format 与 sampler type 不符”。预热的 1×1 渲染顺带把阴影图建好、画好。
      g.renderer.shadowMap.needsUpdate = true;
      await precompile(g.renderer, g.scene, g.cameras.camera);
      await warmupArea(g.renderer, g.scene, g.cameras, { ir: g.pipeline.post.ir, post: g.pipeline.post, replayRoots, feeds: g.pipeline.feeds });
      g.renderer.shadowMap.needsUpdate = true;
      // 5. 放置玩家；模式为 explore；NPC 站位
      this.placePlayer(def, ctx, spawnId);
      // M4：画质切换/上下文恢复的重进——回到原位（胶囊放得下才回，否则留在出生点）
      const rs = opts.restore && opts.restore.area === area ? opts.restore : null;
      if (rs) {
        const lv = ctx.levelsHandle;
        if (lv && rs.floor !== undefined && rs.floor !== lv.current) ctx.applyLevel(rs.floor, true);
        if (g.collision.capsuleFreeAt(rs.pos[0], rs.pos[1], rs.pos[2])) {
          g.player.teleport(rs.pos, rs.yaw);
          g.player.pitch = rs.pitch;
        } else if (lv && rs.floor !== undefined) {
          ctx.applyLevel(lv.current, true);
        }
      }
      if (g.modes.stack.length > 1) g.modes.resetTo('mode.explore');
      g.sys.npc.reevaluate();
      g.triggers.resync();
      this.buildingNow = false;
      g.areaReady();
      // 6. 钩子与事件
      def.onEnter?.(ctx, { from, spawn: spawnId });
      // M4：原地重进时把区域临时状态（暗房红灯、声控灯计时……）还原（在 onEnter 之后，免得被它的初始化覆盖）
      if (rs) for (const [k, v] of Object.entries(rs.temp)) ctx.setTemp(k, v);
      g.events.emit('area:enter', { id: area, spawn: spawnId, from });
      g.save.request('area');
      g.modes.refresh();
      // 7. 淡入
      g.ui.fade.black(0, fade);
      await g.waitGame(fade);
    } catch (err) {
      // M1d：淡出等待超时、build 抛错等：撤掉黑幕再把错误交给调用方（否则玩家对着永久黑屏）
      g.ui.fade.black(0, 0);
      throw err;
    } finally {
      this.buildingNow = false;
      this.endTransition();
    }
  }

  private unload(): void {
    const cur = this.cur;
    if (!cur) return;
    const g = this.game;
    try {
      cur.def.onExit?.(cur.ctx);
    } catch (err) {
      console.error(`[AreaManager] ${cur.def.id}.onExit`, err);
    }
    g.events.emit('area:exit', { id: cur.def.id });
    cur.ctx.dispose();
    this.cur = null;
    g.collision.clear();
    g.audio.setAmbience([], 0);
  }

  private placePlayer(def: AreaDef, ctx: AreaContextImpl, spawnId: SpawnId): void {
    const g = this.game;
    const s = def.spawns[spawnId]!;
    const lv = ctx.levelsHandle;
    // 楼层：出生点指定了就切到那层，否则保持 initial；进区域时总调用一次 onChange，保证楼层节点显隐与落点一致
    if (lv) ctx.applyLevel(s.floor ?? lv.current, true);
    g.player.teleport(s.pos, s.yaw);
    g.player.pitch = DEFAULT_PITCH;
    // 进区域一律站在出生点上（M3）：上一处留下的姿势（R1 开场过场让伙计坐在椅子上）不带进新区域；要坐着的过场在进区域之后自己设
    g.playerModel.setPose('stand', 0);
    g.cameras.sync();
  }

  private onExitTrigger(id: ExitId): void {
    this.travelImpl(id, true).catch(err => console.error(`[AreaManager] travel(${id})`, err));
  }

  private async travelImpl(exitId: ExitId, physical: boolean): Promise<ApiResult<{ exit: ExitId; feedback?: string }>> {
    const cur = this.cur;
    if (!cur) return fail('no_such_target');
    if (this.isLoading()) return fail('busy');
    const e = cur.def.exits.find(x => x.id === exitId);
    if (!e) return fail('no_such_target');
    if (!this.exitOpen(e)) {
      const feedback = e.blocked;
      if (feedback) this.game.api.feedback(feedback);
      if (physical && e.box) this.pushBack(e.box);
      const result: { exit: ExitId; feedback?: string } = { exit: exitId };
      if (feedback !== undefined) result.feedback = feedback;
      return { ok: false, reason: 'blocked', result };
    }
    const reason: EnterReason = 'exit';
    const o: { reason: EnterReason; fade?: number } = { reason };
    if (e.fade !== undefined) o.fade = e.fade;
    await this.enter(this.spawnArea(e.to), e.to, o);
    return ok({ exit: exitId });
  }

  /** 出口条件不满足时把玩家推回 0.6m（ExitDef.blocked，ARCH §4.5）：沿“触发体中心 → 玩家”的水平方向。 */
  private pushBack(box: { center: V3; size: V3 }): void {
    const p = this.game.player;
    let dx = p.position.x - box.center[0];
    let dz = p.position.z - box.center[2];
    let len = Math.hypot(dx, dz);
    if (len < 1e-3) {
      const y = p.bodyYaw * (Math.PI / 180);
      dx = -Math.sin(y);
      dz = Math.cos(y);
      len = 1;
    }
    p.nudge((dx / len) * 0.6, (dz / len) * 0.6);
  }

  private exitOpen(e: ExitDef): boolean {
    if (e.when === undefined) return true;
    let c = this.exitConds.get(e.id);
    if (!c) {
      c = compileCond(e.when, `exit:${e.id}`);
      this.exitConds.set(e.id, c);
    }
    return c(this.game.state);
  }

  private findExit(id: ExitId): ExitDef | undefined {
    for (const d of this.defMap.values()) {
      const e = d.exits.find(x => x.id === id);
      if (e) return e;
    }
    return undefined;
  }

  /** build 之后的 dev 校验（ARCH §4.5 第 4 步中不归 finalize 的几项）：拍照主体与 hideWorld 的 ref 可解析。 */
  private validateLoaded(def: AreaDef, ctx: AreaContextImpl): void {
    if (!DEV_CHECKS) return;
    const issues: string[] = [];
    const resolvable = (ref: string): boolean =>
      ref.startsWith('ghost.') || ref.startsWith('pc.') || ctx.getRef(ref) !== undefined || this.game.sys.npc.get(ref as NpcId) !== undefined;
    for (const t of def.photoTargets ?? []) for (const s of t.subjects) if (!resolvable(s.ref)) issues.push(`拍照目标 ${t.id} 的主体 ${s.ref} 无法解析`);
    for (const t of def.photoDecoys ?? []) for (const s of t.subjects) if (!resolvable(s.ref)) issues.push(`诱饵 ${t.key} 的主体 ${s.ref} 无法解析`);
    for (const seg of def.segments ?? []) for (const h of seg.hideWorld ?? []) if (!ctx.getRef(h.ref)) issues.push(`片段 ${seg.id} 的 hideWorld ref ${h.ref} 未登记`);
    devAssert(issues.length === 0, () => `区域 ${def.id} 加载校验失败：\n${issues.join('\n')}`);
  }

  private fadeSec(sec: number): number {
    return Math.max(0, sec) * (this.game.url.test ? TIMING.testFadeScale : 1);
  }

  private beginTransition(): void {
    this.transitions++;
    this.game.input.suspended = true;
  }

  private endTransition(): void {
    this.transitions = Math.max(0, this.transitions - 1);
    if (this.transitions > 0) return;
    this.game.input.suspended = false;
    // 过渡期间推迟的暂停（意外解锁、切走标签页、context lost）此刻补压（M1d）
    this.game.transitionsEnded();
  }
}
