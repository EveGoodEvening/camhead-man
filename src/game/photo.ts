// owner: WP5
// 拍照（ARCH §6.8.3–§6.8.5）：判定算法、空镜、缩略图、award()。区域只填数据。
//
// 判定全部用几何与射线（ARCH §3.3），不读像素；唯一读像素的是缩略图（renderNow 后同一任务内立即 drawImage，ARCH §16 #27）。
// 本文件另导出几个 WP5 内部工具（visibleBounds、collectOccluders、occludedBetween、anchorWorld），read.ts 也用它们。

import * as THREE from 'three';
import type { ApiResult, AreaKey, LensMode, V3, ZoomLevel } from '../core/types';
import { fail, ok } from '../core/types';
import type { GhostId, KeyPhotoId, NpcId, PhotoId, PhotoTargetId, SegmentId, SubjectRef } from '../data/ids';
import type { Game } from '../core/game';
import type { AreaDef } from '../core/area';
import type { StateView, PhotoRecord } from './state';
import type { Cond } from './expr';
import { compileCond } from './expr';
import type { Handler } from './effects';
import { isRenderableBy } from '../core/layers';
import { devAssert, devWarn } from '../core/log';
import { tapeSec } from '../data/time';
import { PHOTO_META, THUMB, photoForTarget } from '../data/photos';
import { EMPTY_CAPTIONS } from '../data/strings';
import { firstMaterial, isRenderableNode, occludesView } from './viewfinder';

export interface PhotoTargetDef {
  /** 命中得 ph.<同后缀> */
  id: PhotoTargetId;
  /** 多主体须同时满足；anchor = 主体局部坐标偏移，缺省 = 世界包围盒中心 */
  subjects: { ref: SubjectRef; anchor?: V3 }[];
  /** 默认 0.6：锚点须在 4:3 画框中央 60%（|ndc| ≤ 0.6） */
  frameBox?: number;
  /** 默认 0.12：主体包围盒投影高度 / 画框高度 */
  minScreenFrac?: number;
  /** 镜头到每个锚点 */
  maxDist: number;
  minZoom: ZoomLevel;
  maxZoom?: ZoomLevel;
  lens: 'normal' | 'ir' | 'any';
  context: PhotoContextReq;
  when?: Cond;
  /** 默认 true */
  occlusion?: boolean;
  priority?: number;
  onHit?: Handler;
  /** 失败时的空镜标题（GDD 各谜题“错误反馈”）；可按拍摄情境生成 */
  captions?: Partial<Record<PhotoFail, Caption>>;
}

export type Caption = string | ((c: PhotoContext, s: StateView) => string);

export type PhotoContextReq =
  | { kind: 'live' }
  | { kind: 'replay'; segment: SegmentId; t: readonly [number, number] }
  | { kind: 'vcr'; paused: true; tc: readonly [string, string] }
  | { kind: 'console'; channel: 1 | 2 | 3 | 4 | 5; jack?: boolean }
  /** 只登记元数据，判定在 TripodSystem */
  | { kind: 'tripod'; zone: string; radius: number; stillSec: number };

export type PhotoContext =
  | { kind: 'live' }
  | { kind: 'replay'; segment: SegmentId; t: number }
  | { kind: 'vcr'; paused: boolean; tc: number }
  | { kind: 'console'; channel: 1 | 2 | 3 | 4 | 5; jack: boolean };

export type PhotoFail =
  | 'nothing' | 'not_in_frame' | 'partial' | 'too_far' | 'zoom_low' | 'zoom_high' | 'wrong_lens' | 'too_small'
  | 'occluded' | 'hidden' | 'too_early' | 'too_late' | 'wrong_segment' | 'not_paused' | 'wrong_channel' | 'no_jack' | 'cond';

/** 只产出空镜 + 专属标题（底片 1/2/4 格、拍镜子等） */
export interface PhotoDecoyDef {
  key: `decoy.${AreaKey}.${string}`;
  subjects: { ref: SubjectRef | string; anchor?: V3 }[];
  caption: Caption;
  maxDist: number;
  minZoom?: ZoomLevel;
  lens?: 'normal' | 'ir' | 'any';
  context?: PhotoContextReq;
  when?: Cond;
  priority?: number;
}

export type ShootResult = ApiResult<{ photo: PhotoId; hit: PhotoTargetId | null; caption?: string }>;

// ==================================================================== WP5 内部几何工具

const _box = new THREE.Box3();
const _corner = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _rel = new THREE.Vector3();

/**
 * 主体在该相机下“画得出来”的部分的世界包围盒：只算可见、在相机图层里的可渲染节点（Mesh/Line/Points/Sprite），
 * 跳过 material.visible=false 的拾取代理；InstancedMesh 用对象级 boundingBox（含全部实例，ARCH §16 #13）。
 */
export function visibleBounds(obj: THREE.Object3D, cam: THREE.Camera | null, target: THREE.Box3 = new THREE.Box3(), includeHidden = false): THREE.Box3 {
  target.makeEmpty();
  obj.updateWorldMatrix(true, true);
  const visit = (o: THREE.Object3D): void => {
    if (!isRenderableNode(o)) return;
    if (cam && !o.layers.test(cam.layers)) return;
    const mat = firstMaterial(o);
    if (mat && mat.visible === false) return;
    const im = o as THREE.InstancedMesh;
    const geom = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!geom) return;
    if (im.isInstancedMesh === true) {
      if (im.boundingBox === null) im.computeBoundingBox();
      if (!im.boundingBox) return;
      _box.copy(im.boundingBox);
    } else {
      if (geom.boundingBox === null) geom.computeBoundingBox();
      if (!geom.boundingBox) return;
      _box.copy(geom.boundingBox);
    }
    _box.applyMatrix4(o.matrixWorld);
    target.union(_box);
  };
  if (includeHidden) obj.traverse(visit);
  else obj.traverseVisible(visit);
  return target;
}

/** 主体锚点的世界坐标：anchor 是主体局部坐标偏移；缺省取可见世界包围盒中心（全不可见时退到根节点位置）。 */
export function anchorWorld(obj: THREE.Object3D, anchor: V3 | undefined, cam: THREE.Camera | null, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  obj.updateWorldMatrix(true, false);
  if (anchor) return obj.localToWorld(target.set(anchor[0], anchor[1], anchor[2]));
  const b = visibleBounds(obj, cam, new THREE.Box3());
  // 相机看不见（别的图层、被隐去）时退到全部几何的包围盒：判定 hidden 也要知道它“在画面哪儿”
  if (b.isEmpty()) visibleBounds(obj, null, b, true);
  if (b.isEmpty()) return obj.getWorldPosition(target);
  return b.getCenter(target);
}

/**
 * 本区的遮挡体（ARCH §6.8.4 d）：可见、在相机图层里、不透明（或 userData.occlude === true 强制）、
 * 自身与祖先都没有 noOcclude、材质没有 noOcclude、不是拾取代理。只收 Mesh（含 InstancedMesh）。
 * 回放让位的 NPC 与 hideWorld 隐去的对象 visible=false，traverseVisible 自然跳过。
 */
export function collectOccluders(root: THREE.Object3D, cam: THREE.Camera): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverseVisible(o => {
    if ((o as THREE.Mesh).isMesh !== true) return;
    if (!o.layers.test(cam.layers)) return;
    // 与准星聚焦同一条规则（M1d，viewfinder.ts 的 occludesView）
    if (!occludesView(o)) return;
    out.push(o);
  });
  return out;
}

function isDescendantOf(o: THREE.Object3D, anc: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) if (n === anc) return true;
  return false;
}

const _rc = new THREE.Raycaster();
/** from → to 的线段（止于 to 前 margin 米）是否被遮挡体挡住；exclude 的子孙不算。 */
export function occludedBetween(
  from: THREE.Vector3, to: THREE.Vector3, occluders: readonly THREE.Object3D[], exclude: readonly THREE.Object3D[], margin = 0.15,
): boolean {
  const d = from.distanceTo(to);
  const far = d - margin;
  if (far <= 0 || occluders.length === 0) return false;
  _rc.ray.origin.copy(from);
  _rc.ray.direction.copy(to).sub(from).normalize();
  _rc.near = 0;
  _rc.far = far;
  _rc.layers.enableAll();   // 候选已按相机图层筛过
  for (const h of _rc.intersectObjects(occluders as THREE.Object3D[], false)) {
    if (exclude.some(e => isDescendantOf(h.object, e))) continue;
    return true;
  }
  return false;
}

/** 相机坐标系下 p 在相机前方（能被投影）。只写自己的临时向量：p 可以是任何调用方的向量（包括 _corner）。 */
function inFront(cam: THREE.Camera, p: THREE.Vector3): boolean {
  cam.getWorldDirection(_camDir);
  cam.getWorldPosition(_camPos);
  return _rel.copy(p).sub(_camPos).dot(_camDir) > 1e-4;
}

/** 包围盒在相机画框里的投影高度 / 画框高度（NDC y 跨度 / 2）。任一角点落到相机后方时视为占满（1）。 */
function screenFrac(cam: THREE.Camera, b: THREE.Box3): number {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    _corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
    if (!inFront(cam, _corner)) return 1;
    _corner.project(cam);
    minY = Math.min(minY, _corner.y);
    maxY = Math.max(maxY, _corner.y);
  }
  return (maxY - minY) / 2;
}

// ==================================================================== 判定记录（WP5 内部：自测与调试读取）

export interface JudgedCandidate {
  id: string;
  kind: 'target' | 'decoy';
  fail: PhotoFail | null;
  /** 第一个失败之前通过的检查项数 */
  score: number;
  /** 至少一个主体可见、在相机前方、落在整个画框内（|ndc| ≤ 1）：没有任何候选“在画面里”时标题按 nothing 给 */
  onScreen: boolean;
  centerDist: number;
  priority: number;
}
export interface PhotoJudgement {
  context: PhotoContext;
  hit: string | null;
  fail: PhotoFail | null;
  caption?: string;
  candidates: JudgedCandidate[];
}

interface TargetEntry { def: PhotoTargetDef; when: ((s: StateView) => boolean) | null; order: number }
interface DecoyEntry { def: PhotoDecoyDef; when: ((s: StateView) => boolean) | null; order: number }

interface SubjectEval { fail: PhotoFail | null; passes: number; onScreen: boolean; ndc: THREE.Vector3 | null }

const DEFAULT_FRAME_BOX = 0.6;
const DEFAULT_MIN_SCREEN_FRAC = 0.12;

function compileWhen(c: Cond | undefined, where: string): ((s: StateView) => boolean) | null {
  if (c === undefined) return null;
  // 函数条件直接用；字符串在登记时编译并校验 id（ARCH §6.2）
  return typeof c === 'function' ? c : compileCond(c, where);
}

export class PhotoSystem {
  protected readonly game: Game;
  private readonly targets = new Map<PhotoTargetId, TargetEntry>();
  private readonly decoys = new Map<PhotoDecoyDef['key'], DecoyEntry>();
  private emptyCaption: AreaDef['emptyCaption'] | undefined;
  private photoArt: Partial<Record<KeyPhotoId, (g: CanvasRenderingContext2D, w: number, h: number) => void>> = {};
  private order = 0;
  private thumbCanvas: HTMLCanvasElement | null = null;
  /** 最近一次 shoot() 的判定细节（WP5 内部：dev/wp5.ts 的自测与调试读取；不属于冻结签名） */
  lastJudgement: PhotoJudgement | null = null;

  constructor(game: Game) {
    this.game = game;
  }

  /** AreaManager.enter 第 4 步与 ctx.photoTarget/photoDecoy 调用；可多次调用（合并），id 重复在 dev 下抛错 */
  register(
    targets: readonly PhotoTargetDef[], decoys: readonly PhotoDecoyDef[],
    o?: { emptyCaption?: AreaDef['emptyCaption']; photoArt?: AreaDef['photoArt'] },
  ): void {
    for (const def of targets) {
      devAssert(!this.targets.has(def.id), `PhotoSystem.register: duplicate photo target '${def.id}'`);
      devAssert(def.subjects.length > 0 || def.context.kind === 'tripod', `PhotoSystem.register: '${def.id}' has no subjects`);
      this.targets.set(def.id, { def, when: compileWhen(def.when, `photoTarget ${def.id}`), order: this.order++ });
    }
    for (const def of decoys) {
      devAssert(!this.decoys.has(def.key), `PhotoSystem.register: duplicate photo decoy '${def.key}'`);
      this.decoys.set(def.key, { def, when: compileWhen(def.when, `photoDecoy ${def.key}`), order: this.order++ });
    }
    if (o?.emptyCaption) this.emptyCaption = o.emptyCaption;
    if (o?.photoArt) {
      for (const [k, fn] of Object.entries(o.photoArt) as [KeyPhotoId, (g: CanvasRenderingContext2D, w: number, h: number) => void][]) {
        devAssert(!(k in this.photoArt), `PhotoSystem.register: duplicate photoArt '${k}'`);
        this.photoArt[k] = fn;
      }
    }
  }

  /** 离开区域时清空本区目标、诱饵、emptyCaption 与 photoArt */
  clearArea(): void {
    this.targets.clear();
    this.decoys.clear();
    this.emptyCaption = undefined;
    this.photoArt = {};
    this.lastJudgement = null;
  }

  /** ARCH §6.8.4 的算法；onHit 作为顶层 run 交给 EffectRunner（调试 API 再按 ARCH §6.3 settle） */
  shoot(): ShootResult {
    const game = this.game;
    const top = game.modes.top;
    if (top !== 'mode.viewfinder' && top !== 'mode.replay') return fail('not_in_viewfinder');

    const vf = game.sys.viewfinder;
    const context = this.currentContext();
    const cam = vf.syncPhotoCamera();
    const j = this.judge(context, cam);
    this.lastJudgement = j;

    const lens: LensMode = vf.lens;
    const zoom: ZoomLevel = vf.zoom;
    const area: AreaKey = game.areas.current?.def.id ?? game.state.area;
    // 先发 shutter（R2 声控灯监听它），再出缩略图与照片记录（ARCH §6.8.4 第 7 步）
    game.events.emit('shutter', { area, pos: cam.getWorldPosition(new THREE.Vector3()), context, lens });

    let record: PhotoRecord;
    let hitId: PhotoTargetId | null = null;
    let caption: string | undefined;
    const hitTarget = j.hit ? this.targets.get(j.hit as PhotoTargetId) : undefined;
    if (hitTarget) {
      hitId = hitTarget.def.id;
      const pid = photoForTarget(hitId);
      const meta = PHOTO_META[pid];
      const had = game.state.hasPhoto(pid);
      const thumb = had ? undefined : this.captureRender();
      record = game.state.addPhoto({
        id: pid, title: meta.title, key: meta.key, print: meta.print, area, lens, zoom, context: context.kind, ...(thumb ? { thumb } : {}),
      });
    } else {
      caption = j.caption ?? EMPTY_CAPTIONS.nothing;
      const thumb = this.captureRender();
      record = game.state.addPhoto({
        // 相册标题不带句末句号（M4：区域 captions 兼作反馈句，常以“。”结尾；caption 原样保留）
        id: game.state.nextEmptyId(), title: caption.replace(/。+$/u, '') || caption, caption, key: false, print: false, area, lens, zoom, context: context.kind,
        ...(thumb ? { thumb } : {}),
      });
    }
    game.pipeline.post.flash();
    game.audio.sfx('shutter');
    game.save.request('photo');
    game.events.emit('photo', { record, hit: hitId });
    if (hitTarget?.def.onHit) this.runTop(hitTarget.def.onHit, `photo:${hitTarget.def.id}`);
    return ok({ photo: record.id, hit: hitId, ...(caption !== undefined ? { caption } : {}) });
  }

  /** ARCH §6.8.5：供三脚架、Effect photo 使用 */
  award(id: KeyPhotoId, opts?: { caption?: string; thumb?: 'render' | 'art' }): PhotoRecord {
    const game = this.game;
    const meta = PHOTO_META[id];
    const art = this.photoArt[id];
    const mode = opts?.thumb ?? (art ? 'art' : 'render');
    const had = game.state.hasPhoto(id);
    const thumb = had ? undefined : mode === 'art' && art ? this.captureArt(art) : this.captureRender();
    const vf = game.sys.viewfinder;
    const fromTripod = game.sys.tripod.consumeShot();
    const context: PhotoRecord['context'] = meta.print ? 'print' : fromTripod ? 'tripod' : 'live';
    const record = game.state.addPhoto({
      id, title: meta.title, key: meta.key, print: meta.print, area: game.areas.current?.def.id ?? game.state.area,
      lens: vf.lens, zoom: vf.zoom, context, ...(opts?.caption !== undefined ? { caption: opts.caption } : {}), ...(thumb ? { thumb } : {}),
    });
    game.save.request('photo');
    game.events.emit('photo', { record, hit: null });
    return record;
  }

  /** 主体 ref 解析（区域加载后的校验与 aimAt 共用） */
  resolveSubject(ref: SubjectRef | string): THREE.Object3D | null {
    const game = this.game;
    if (ref.startsWith('ghost.')) return game.sys.replay.actorObject(ref as GhostId);
    if (ref.startsWith('npc.')) {
      const h = game.sys.npc.get(ref as NpcId);
      if (h) return h.root;
    }
    if (ref === 'pc.body') return game.playerModel.body.root;
    if (ref === 'pc.huoji') return game.playerModel.head.group;
    return game.areas.current?.ctx.getRef(ref) ?? null;
  }

  /** 本区全部目标（调试 API 的瞄准点解析：pt.* → 全部主体锚点的质心；M1a 补写） */
  target(id: PhotoTargetId): PhotoTargetDef | undefined {
    return this.targets.get(id)?.def;
  }

  /** 本区诱饵（静态登记与 ctx.photoDecoy 登记的都在内；调试 API 的瞄准点解析 decoy.* 用；M1a 补写） */
  decoy(key: PhotoDecoyDef['key']): PhotoDecoyDef | undefined {
    return this.decoys.get(key)?.def;
  }

  // ------------------------------------------------------------------ WP5 内部

  /** 拍摄上下文（ARCH §6.8.4 第 1 步）：回放中 → replay；叠在录像机面板上 → vcr；叠在监控台上 → console；否则 live */
  currentContext(): PhotoContext {
    const game = this.game;
    const rp = game.sys.replay.active;
    if (rp) return { kind: 'replay', segment: rp.seg, t: rp.t };
    const stack = game.modes.stack;
    if (stack.includes('mode.panel_vcr')) {
      const v = game.sys.vcr;
      return { kind: 'vcr', paused: !v.playing && v.shuttle === 0, tc: v.tc };
    }
    if (stack.includes('mode.panel_console')) {
      const c = game.sys.cctv;
      return { kind: 'console', channel: c.channel, jack: c.jack };
    }
    return { kind: 'live' };
  }

  /** 登记数据里引用、此刻却解析不到的主体 ref（ghost.* 只在回放中存在，不算）。给 lint/加载校验用。 */
  unresolvedRefs(): string[] {
    const out: string[] = [];
    const refs = [
      ...[...this.targets.values()].flatMap(t => t.def.subjects.map(s => s.ref as string)),
      ...[...this.decoys.values()].flatMap(d => d.def.subjects.map(s => s.ref)),
    ];
    for (const r of refs) if (!r.startsWith('ghost.') && !this.resolveSubject(r) && !out.includes(r)) out.push(r);
    return out;
  }

  /** 纯判定（不写状态）：给定上下文与已摆好的 photo 相机，算出命中者或失败标题。 */
  judge(context: PhotoContext, cam: THREE.PerspectiveCamera): PhotoJudgement {
    const game = this.game;
    const s = game.state;
    const root = game.areas.current?.root ?? null;
    let occluders: THREE.Object3D[] | null = null;
    const getOccluders = (): THREE.Object3D[] => (occluders ??= root ? collectOccluders(root, cam) : []);

    const judged: (JudgedCandidate & { entry: TargetEntry | DecoyEntry; order: number })[] = [];
    const evalOne = (
      id: string, kind: 'target' | 'decoy', entry: TargetEntry | DecoyEntry,
      p: {
        req: PhotoContextReq; lens: 'normal' | 'ir' | 'any'; minZoom: ZoomLevel; maxZoom?: ZoomLevel; subjects: readonly { ref: string; anchor?: V3 }[];
        frameBox: number; minScreenFrac: number; maxDist: number; occlusion: boolean; priority: number;
      },
    ): void => {
      if (p.req.kind === 'tripod' || p.req.kind !== context.kind) return;   // 情境种类不同：跳过，不计入失败
      let failR: PhotoFail | null = null;
      let score = 1;   // 情境种类吻合
      // a. 情境细节（每个子项一分：片段/暂停/频道，然后时间窗/插线）
      if (p.req.kind === 'replay' && context.kind === 'replay') {
        if (context.segment !== p.req.segment) failR = 'wrong_segment';
        else {
          score++;
          if (context.t < p.req.t[0]) failR = 'too_early';
          else if (context.t > p.req.t[1]) failR = 'too_late';
          else score++;
        }
      } else if (p.req.kind === 'vcr' && context.kind === 'vcr') {
        if (!context.paused) failR = 'not_paused';
        else {
          score++;
          if (context.tc < tapeSec(p.req.tc[0])) failR = 'too_early';
          else if (context.tc > tapeSec(p.req.tc[1])) failR = 'too_late';
          else score++;
        }
      } else if (p.req.kind === 'console' && context.kind === 'console') {
        if (context.channel !== p.req.channel) failR = 'wrong_channel';
        else {
          score++;
          if (p.req.jack && !context.jack) failR = 'no_jack';
          else score++;
        }
      } else {
        score += 2;
      }
      // b. 条件
      if (!failR) {
        if (entry.when && !entry.when(s)) failR = 'cond';
        else score++;
      }
      // c. 镜头与倍率
      const vf = game.sys.viewfinder;
      if (!failR) {
        if (p.lens !== 'any' && p.lens !== vf.lens) failR = 'wrong_lens';
        else score++;
      }
      if (!failR) {
        if (vf.zoom < p.minZoom) failR = 'zoom_low';
        else score++;
      }
      if (!failR) {
        if (p.maxZoom !== undefined && vf.zoom > p.maxZoom) failR = 'zoom_high';
        else score++;
      }
      // d. 主体（相关性 onScreen 总是算，供挑选失败标题用）
      const evals = p.subjects.map(sub => this.evalSubject(sub.ref, sub.anchor, cam, p, getOccluders, failR === null));
      const onScreen = evals.some(e => e.onScreen);
      let centerDist = Infinity;
      if (!failR) {
        const passed = evals.filter(e => e.fail === null);
        score += evals.reduce((a, e) => a + e.passes, 0);
        if (passed.length === evals.length) {
          const c = new THREE.Vector2();
          for (const e of evals) if (e.ndc) c.add(new THREE.Vector2(e.ndc.x, e.ndc.y));
          c.divideScalar(Math.max(1, evals.length));
          centerDist = c.length();
        } else if (passed.length > 0) {
          failR = 'partial';
        } else {
          failR = evals[0]?.fail ?? 'nothing';
        }
      }
      judged.push({ id, kind, entry, fail: failR, score, onScreen, centerDist, priority: p.priority, order: entry.order });
    };

    for (const [id, e] of this.targets) {
      const d = e.def;
      evalOne(id, 'target', e, {
        req: d.context, lens: d.lens, minZoom: d.minZoom, ...(d.maxZoom !== undefined ? { maxZoom: d.maxZoom } : {}), subjects: d.subjects,
        frameBox: d.frameBox ?? DEFAULT_FRAME_BOX, minScreenFrac: d.minScreenFrac ?? DEFAULT_MIN_SCREEN_FRAC, maxDist: d.maxDist,
        occlusion: d.occlusion !== false, priority: d.priority ?? 0,
      });
    }
    for (const [key, e] of this.decoys) {
      const d = e.def;
      evalOne(key, 'decoy', e, {
        req: d.context ?? { kind: 'live' }, lens: d.lens ?? 'any', minZoom: d.minZoom ?? 1, subjects: d.subjects,
        frameBox: DEFAULT_FRAME_BOX, minScreenFrac: DEFAULT_MIN_SCREEN_FRAC, maxDist: d.maxDist, occlusion: true, priority: d.priority ?? 0,
      });
    }

    const candidates: JudgedCandidate[] = judged.map(({ entry: _e, order: _o, ...c }) => c);
    // 5. 命中者：priority 降序，再按锚点到画面中心的距离升序
    const hits = judged.filter(c => c.fail === null).sort((a, b) => b.priority - a.priority || a.centerDist - b.centerDist || a.order - b.order);
    const best = hits[0];
    if (best) {
      if (best.kind === 'target') return { context, hit: best.id, fail: null, candidates };
      const decoy = (best.entry as DecoyEntry).def;
      return { context, hit: best.id, fail: null, caption: this.evalCaption(decoy.caption, context), candidates };
    }
    // 6. 无命中：取“通过项数最多”的目标（诱饵没有失败标题）。本包的细化：先看是否在画面里（onScreen），
    //    没有任何目标的主体出现在画面里时按 nothing 处理——否则对着天空按快门也会拿到某个画外目标的“太小了”。
    const failing = judged.filter(c => c.kind === 'target')
      .sort((a, b) => Number(b.onScreen) - Number(a.onScreen) || b.score - a.score || b.priority - a.priority || a.order - b.order);
    const closest = failing[0];
    const failR: PhotoFail = closest && closest.onScreen && closest.fail ? closest.fail : 'nothing';
    let caption: string | undefined;
    // nothing 不取某个画外目标的专属标题，直接交给区域 emptyCaption / 默认“空镜”
    const cap = closest && failR !== 'nothing' ? (closest.entry as TargetEntry).def.captions?.[failR] : undefined;
    if (cap !== undefined) caption = this.evalCaption(cap, context);
    if (caption === undefined && this.emptyCaption) caption = this.emptyCaption(s, game.sys.interaction.focused);
    caption ??= EMPTY_CAPTIONS[failR];
    return { context, hit: null, fail: failR, caption, candidates };
  }

  private evalSubject(
    ref: string, anchor: V3 | undefined, cam: THREE.PerspectiveCamera,
    p: { frameBox: number; minScreenFrac: number; maxDist: number; occlusion: boolean },
    getOccluders: () => THREE.Object3D[], full: boolean,
  ): SubjectEval {
    const obj = this.resolveSubject(ref);
    if (!obj) return { fail: 'hidden', passes: 0, onScreen: false, ndc: null };   // 回放人影不在当前片段、NPC 不在场
    const pos = anchorWorld(obj, anchor, cam, new THREE.Vector3());
    const front = inFront(cam, pos);
    const ndc = front ? pos.clone().project(cam) : null;
    // 相关性：锚点落在整个画面里（被隐去的主体也算——玩家正对着它按快门，失败标题应当是 hidden 而不是空镜）
    const onScreen = ndc !== null && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
    if (!isRenderableBy(obj, cam)) return { fail: 'hidden', passes: 0, onScreen, ndc };
    if (!ndc) return { fail: 'not_in_frame', passes: 1, onScreen: false, ndc: null };
    if (!full) return { fail: null, passes: 0, onScreen, ndc };   // 前面的检查已失败：只要相关性
    let passes = 1;
    if (Math.abs(ndc.x) > p.frameBox || Math.abs(ndc.y) > p.frameBox) return { fail: 'not_in_frame', passes, onScreen, ndc };
    passes++;
    const camPos = cam.getWorldPosition(new THREE.Vector3());
    const dist = camPos.distanceTo(pos);
    if (dist > p.maxDist) return { fail: 'too_far', passes, onScreen, ndc };
    passes++;
    const b = visibleBounds(obj, cam, new THREE.Box3());
    if (!b.isEmpty() && screenFrac(cam, b) < p.minScreenFrac) return { fail: 'too_small', passes, onScreen, ndc };
    passes++;
    if (p.occlusion && occludedBetween(camPos, pos, getOccluders(), [obj])) return { fail: 'occluded', passes, onScreen, ndc };
    passes++;
    return { fail: null, passes, onScreen, ndc };
  }

  private evalCaption(c: Caption, ctx: PhotoContext): string {
    return typeof c === 'function' ? c(ctx, this.game.state) : c;
  }

  private runTop(h: Handler, origin: string): void {
    this.game.effects.runHandler(h, origin).catch((err: unknown) => devWarn(`PhotoSystem: ${origin} failed`, err));
  }

  private thumbCtx(): CanvasRenderingContext2D | null {
    if (typeof document === 'undefined') return null;
    this.thumbCanvas ??= Object.assign(document.createElement('canvas'), { width: THUMB.w, height: THUMB.h });
    return this.thumbCanvas.getContext('2d');
  }

  /** 缩略图：renderNow() 同步渲染一帧后立即从 WebGL canvas 4:3 居中裁切（同一任务内读取，不需要 preserveDrawingBuffer）。 */
  private captureRender(): string | undefined {
    try {
      const g = this.thumbCtx();
      if (!g || !this.thumbCanvas) return undefined;
      this.game.renderNow();
      const src = this.game.renderer.domElement;
      const sw = src.width;
      const sh = src.height;
      if (sw <= 0 || sh <= 0) return undefined;
      let cw = sw;
      let ch = (sw * 3) / 4;
      if (ch > sh) {
        ch = sh;
        cw = (sh * 4) / 3;
      }
      g.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, THUMB.w, THUMB.h);
      return this.thumbCanvas.toDataURL('image/jpeg', THUMB.quality);
    } catch (err) {
      devWarn('PhotoSystem: thumbnail capture failed', err);
      return undefined;
    }
  }

  private captureArt(art: (g: CanvasRenderingContext2D, w: number, h: number) => void): string | undefined {
    try {
      const g = this.thumbCtx();
      if (!g || !this.thumbCanvas) return undefined;
      g.clearRect(0, 0, THUMB.w, THUMB.h);
      art(g, THUMB.w, THUMB.h);
      return this.thumbCanvas.toDataURL('image/jpeg', THUMB.quality);
    } catch (err) {
      devWarn('PhotoSystem: photoArt failed', err);
      return undefined;
    }
  }
}
