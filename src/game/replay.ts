// owner: WP5
// 回放（ARCH §6.9）：残影点、片段播放、人影插值、hideWorld、现世 NPC 让位、onComplete。
//
// - 距离一律 3D（R2 楼层上下叠放，隔着楼板不能启动/保持另一层的回放）。
// - 人影在进区域时 prebuild 隐藏地建好（避免第一次倒带现编译着色器），回放时只切 visible，离开区域时销毁。
// - 片段时间 t 只由 update(dt)（游戏时间，冻结时不调用）与 seek 系列推进；锁步下只在 advance() 里走（ARCH §3.2）。
// - onComplete：播放头第一次越过 dur（播放、seekRel、stepSec、seek 都算）时触发，每次进入回放每段最多一次；越过后从 0 循环。

import * as THREE from 'three';
import type { ApiResult, Pose, V3 } from '../core/types';
import { fail, ok } from '../core/types';
import type { GhostId, ReplayPointId, SegmentId, SpeakerId } from '../data/ids';
import { F } from '../data/ids';
import type { Game } from '../core/game';
import type { Cond } from './expr';
import { compileCond } from './expr';
import type { Handler } from './effects';
import type { StateView } from './state';
import type { CharacterKind, CharacterOpts } from '../rigs/characters';
import { createCharacter } from '../rigs/characters';
import type { CrowdOpts } from '../rigs/crowd';
import { createCrowd } from '../rigs/crowd';
import { createHumanoid } from '../rigs/humanoid';
import type { HumanoidRig } from '../rigs/humanoid';
import { createPaperFigure } from '../rigs/paper';
import type { PaperRig } from '../rigs/paper';
import type { SfxCue } from '../audio/engine';
import { MATERIALS } from '../fx/materials';
import { setLayerRecursive } from '../core/layers';
import { Disposer } from '../core/disposer';
import { devAssert, devWarn } from '../core/log';
import { DEG2RAD, lerpAngle, yawToRotY } from '../core/math';
import { RENDER_ORDER } from '../data/render';
import { STRINGS } from '../data/strings';
import { POST_PRESETS } from '../fx/presets';
import { vfOnPanel } from './viewfinder';

export interface ReplayPointDef {
  id: ReplayPointId;
  at: V3;
  /** 按 R 的顺序：[0] = 最近 */
  segments: readonly SegmentId[];
  /** 默认 2.5（3D 距离：R2 楼层上下叠放，隔着楼板不能启动另一层的回放） */
  startRadius?: number;
  /** 默认 8（3D 距离）：走出即退出回放（“画面断了”）；也是现世 NPC 让位的半径 */
  walkRadius?: number;
  /** 默认 30°：镜头前向与指向 at+0.8m 的夹角上限 */
  lookAngle?: number;
  /** 默认恒真（旋涡是否存在） */
  present?: Cond;
  /**
   * M4 补写：残影点的旋涡对象（区域 createResidueVortex 得到的）。回放开始时藏起、退出时还原。
   * 不给也行：ReplaySystem 会自己找本区 root 下离残影点 1.2m 内、带 userData.residueVortex 的对象。
   */
  marker?: THREE.Object3D;
}

export interface ReplayActorKey { t: number; pos: V3; yaw: number; pose: Pose }

export interface ReplaySegmentDef {
  /** 1 = 最近 */
  id: SegmentId; point: ReplayPointId; order: number;
  /** '2018-02-16 10:21' */
  osd: string;
  dur: number; loop: true;
  actors: {
    id: GhostId;
    rig: 'mannequin' | 'paper' | 'crowd';
    /** 'mannequin' 时用哪个造型（默认通用人形）；zhou 自动 faceMask */
    character?: CharacterKind; characterOpts?: CharacterOpts;
    /** 'crowd' 时必填 */
    crowd?: CrowdOpts;
    keys: readonly ReplayActorKey[];
  }[];
  /** 片段道具（layer.replay，mat.replay 调色） */
  props?: { id: string; mesh: string | (() => THREE.Object3D); keys: { t: number; pos: V3; yaw?: number; visible?: boolean }[] }[];
  /** 片段内 [from,to) 秒隐去的现世对象（ctx.ref 登记的 id） */
  hideWorld?: { ref: string; from: number; to: number }[];
  subs: { t: number; dur: number; speaker: SpeakerId | ''; text: string }[];
  sfx?: { t: number; cue: SfxCue }[];
  /** 为真时显示 lockedText，不能播放 */
  locked?: Cond;
  /** 默认“雪花太密了。好像有什么东西不让你看。” */
  lockedText?: string;
  /** 播放头第一次越过 dur（含 seek 越过）时执行，每次进入回放最多一次 */
  onComplete?: Handler;
  /**
   * M4 补写：进入这一段时镜头在 0.4 秒内转向的点（世界坐标，镜头中心射线穿过它）。不给时取片段里人影全部关键帧位置的平均点（胸口高），
   * 至少把俯仰抬到 −15° 以上——按 R 的那一刻玩家大多在俯视脚下的旋涡，人影都在画外。玩家自己一动视角（或 aimAt）就停止转向。
   */
  focus?: V3;
}

type ActorDef = ReplaySegmentDef['actors'][number];
type PropDef = NonNullable<ReplaySegmentDef['props']>[number];

/** 一个人影的运行时（WP5 内部；测试可覆盖 createActor 换成简易人影）。 */
export interface ReplayActorRuntime {
  readonly obj: THREE.Object3D;
  readonly rig: HumanoidRig | null;
  readonly paper: PaperRig | null;
  dispose(): void;
}

interface ActorRt { def: ActorDef; keys: readonly ReplayActorKey[]; rt: ReplayActorRuntime; pose: Pose | null }
interface PropRt { def: PropDef; keys: PropDef['keys']; obj: THREE.Object3D; dispose: (() => void) | null }
interface SegRt { def: ReplaySegmentDef; root: THREE.Group; actors: Map<GhostId, ActorRt>; props: PropRt[]; locked: ((s: StateView) => boolean) | null }
interface PointRt { def: ReplayPointDef; present: ((s: StateView) => boolean) | null }
interface Active {
  point: ReplayPointId;
  segIndex: number;
  t: number;
  playing: boolean;
  /** 上次触发字幕/音效时的 t（(lastT, t] 内的事件本帧触发） */
  lastT: number;
  /** 本次进入回放已触发过 onComplete 的片段 */
  completed: Set<SegmentId>;
  /** hideWorld 对象进入片段时的原始 visible */
  hidden: Map<THREE.Object3D, boolean>;
}

const DEFAULTS = { startRadius: 2.5, walkRadius: 8, lookAngle: 30 } as const;
/** M4：进回放时转向片段焦点的时长（游戏秒）与俯仰下限（度） */
const TURN_SEC = 0.4;
const TURN_MIN_PITCH = -15;
/**
 * M4 第 2 轮整合：片段写了 focus（作者点名要看的东西，常在地上：樟木箱、蹲着的人影）时俯仰下限放到 −40°，
 * “焦点就在脚边、只抬头不转身”的水平距离阈值从 0.8m 降到 0.35m（门口倒带时老周离玩家 0.6m 也要转过去）。
 * 缺省焦点（人影关键帧均值）照旧 −15° / 0.8m：人影围着玩家时均值常落在脚边。
 */
const TURN_MIN_PITCH_FOCUS = -40;
const NEAR_FOCUS = 0.8;
const NEAR_FOCUS_EXPLICIT = 0.35;
/** M4：回放开始时藏起残影点旋涡的搜索半径（水平，米） */
const VORTEX_RADIUS = 1.2;
const POSE_BLEND = 0.3;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function compile(c: Cond | undefined, where: string): ((s: StateView) => boolean) | null {
  if (c === undefined) return null;
  return typeof c === 'function' ? c : compileCond(c, where);
}

/** 关键帧采样：位置线性、yaw 最短角插值；pose = 最近一个 t ≤ 当前的关键帧的姿势；speed = 所在区间的平均速度。 */
export function sampleKeys<K extends { t: number; pos: V3; yaw?: number }>(keys: readonly K[], t: number, pos: THREE.Vector3): { yaw: number; key: K; speed: number } {
  const n = keys.length;
  const first = keys[0];
  const last = keys[n - 1];
  if (!first || !last) throw new Error('sampleKeys: empty keys');
  if (n === 1 || t <= first.t) {
    pos.set(first.pos[0], first.pos[1], first.pos[2]);
    return { yaw: first.yaw ?? 0, key: first, speed: 0 };
  }
  if (t >= last.t) {
    pos.set(last.pos[0], last.pos[1], last.pos[2]);
    return { yaw: last.yaw ?? 0, key: last, speed: 0 };
  }
  let i = 0;
  while (i < n - 2 && (keys[i + 1] as K).t <= t) i++;
  const a = keys[i] as K;
  const b = keys[i + 1] as K;
  const span = Math.max(1e-6, b.t - a.t);
  const u = (t - a.t) / span;
  pos.set(a.pos[0] + (b.pos[0] - a.pos[0]) * u, a.pos[1] + (b.pos[1] - a.pos[1]) * u, a.pos[2] + (b.pos[2] - a.pos[2]) * u);
  const dist = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]);
  return { yaw: lerpAngle(a.yaw ?? 0, b.yaw ?? a.yaw ?? 0, u), key: a, speed: dist / span };
}

export class ReplaySystem {
  protected readonly game: Game;
  private readonly points = new Map<ReplayPointId, PointRt>();
  private readonly segDefs = new Map<SegmentId, ReplaySegmentDef>();
  private readonly segs = new Map<SegmentId, SegRt>();
  private act: Active | null = null;
  /** M4：进回放时的镜头转向（玩家自己动了视角就取消） */
  private turn: { y0: number; p0: number; y1: number; p1: number; t: number; lastY: number; lastP: number } | null = null;
  /** M4：回放期间藏起的旋涡与它们原来的 visible */
  private readonly hiddenMarkers = new Map<THREE.Object3D, boolean>();

  constructor(game: Game) {
    this.game = game;
  }

  get active(): { point: ReplayPointId; seg: SegmentId; index: number; count: number; t: number; playing: boolean } | null {
    const a = this.act;
    if (!a) return null;
    const p = this.points.get(a.point);
    const seg = p?.def.segments[a.segIndex];
    if (!p || !seg) return null;
    // index 从 1 起（HUD 的“2/3”）
    return { point: a.point, seg, index: a.segIndex + 1, count: p.def.segments.length, t: a.t, playing: a.playing };
  }

  /** 取景器中、倒带能力、近残影点并看着它、非面板（纯查询，无副作用；HUD 的“▶ 残影 · R”也可用它） */
  canStart(): ApiResult<{ point: ReplayPointId }> {
    const modes = this.game.modes;
    if (vfOnPanel(modes.stack)) return fail('mode_disallows');   // 残影点在任何面板模式下都不响应 R
    if (modes.top !== 'mode.viewfinder' && modes.top !== 'mode.replay') return fail('not_in_viewfinder');
    const p = this.lookedPoint();
    if (!p) return fail('not_near_replay_point');
    if (!this.game.state.flag(F.R1_ABILITY_REPLAY)) return fail('no_ability', { point: p.def.id });
    return ok({ point: p.def.id });
  }

  /** 开始；已在回放中则切到更早一段（最早之后回到最近） */
  pressR(): ApiResult<{ seg: SegmentId }> {
    const a = this.act;
    if (a) {
      const p = this.points.get(a.point);
      if (!p) return fail('no_such_target');
      const n = p.def.segments.length;
      for (let k = 1; k <= n; k++) {
        const idx = (a.segIndex + k) % n;
        if (idx === a.segIndex) break;
        const seg = this.segRt(p.def.segments[idx]);
        if (!seg || this.isLocked(seg)) continue;   // 锁住的片段跳过（全锁时停在当前段）
        this.switchTo(a, idx);
        this.game.audio.sfx('rewind');
        return ok({ seg: seg.def.id });
      }
      const cur = p.def.segments[a.segIndex];
      return cur ? ok({ seg: cur }) : fail('no_such_target');
    }
    const can = this.canStart();
    if (!can.ok || !can.result) {
      if (can.reason === 'no_ability') this.game.api.feedback(STRINGS.feedback.replayNoAbility);
      return { ok: false, reason: can.reason ?? 'mode_disallows' };
    }
    const p = this.points.get(can.result.point);
    if (!p) return fail('no_such_target');
    let startIdx = -1;
    let lockedSeg: SegRt | null = null;
    for (let i = 0; i < p.def.segments.length; i++) {
      const seg = this.segRt(p.def.segments[i]);
      if (!seg) continue;
      if (this.isLocked(seg)) {
        lockedSeg ??= seg;
        continue;
      }
      startIdx = i;
      break;
    }
    if (startIdx < 0) {
      this.game.api.feedback(lockedSeg?.def.lockedText ?? STRINGS.feedback.replayLocked);
      return fail('locked');
    }
    this.start(p, startIdx);
    const seg = p.def.segments[startIdx];
    return seg ? ok({ seg }) : fail('no_such_target');
  }

  /** F：回到现在 */
  present(): ApiResult {
    if (!this.act) return fail('mode_disallows');
    this.exit('exit');
    return ok();
  }

  togglePlay(): void {
    if (this.act) this.act.playing = !this.act.playing;
  }

  /** 钳制到 [0, dur]；t ≥ dur 视为越过终点 → 触发 onComplete，然后从 0 循环 */
  seek(t: number): void {
    const a = this.act;
    const seg = a ? this.currentSeg(a) : null;
    if (!a || !seg) return;
    let nt = Math.max(0, t);
    if (nt >= seg.def.dur) {
      this.complete(a, seg);
      nt = 0;
    }
    a.t = nt;
    a.lastT = nt;
    this.applySeg(a, seg, 0, true);
    this.showSubAt(seg, nt);
  }

  /** Z/C ±5 */
  seekRel(sec: number): void {
    if (this.act) this.seek(this.act.t + sec);
  }

  /** 暂停时逐秒（播放中先停住再走一秒） */
  stepSec(dir: -1 | 1): void {
    const a = this.act;
    if (!a) return;
    a.playing = false;
    this.seek(Math.floor(a.t + 1e-6) + dir);
  }

  /** 拍照判定 */
  actorObject(id: GhostId): THREE.Object3D | null {
    const a = this.act;
    const seg = a ? this.currentSeg(a) : null;
    return seg?.actors.get(id)?.rt.obj ?? null;
  }

  /** AreaManager.enter 第 4 步（AreaDef.replayPoints/segments）与 ctx.replayPoint() 调用；可多次调用（合并） */
  register(points: readonly ReplayPointDef[], segs: readonly ReplaySegmentDef[]): void {
    for (const d of points) {
      devAssert(!this.points.has(d.id), `ReplaySystem.register: duplicate replay point '${d.id}'`);
      this.points.set(d.id, { def: d, present: compile(d.present, `replayPoint ${d.id}`) });
    }
    for (const s of segs) {
      devAssert(!this.segDefs.has(s.id), `ReplaySystem.register: duplicate segment '${s.id}'`);
      devAssert(s.dur > 0, `ReplaySystem.register: segment '${s.id}' has dur <= 0`);
      for (const a of s.actors) devAssert(a.keys.length > 0, `ReplaySystem.register: ${s.id}/${a.id} has no keys`);
      this.segDefs.set(s.id, s);
    }
  }

  /** 隐藏地构建本区全部片段的人影与道具并挂到 root 下，返回各片段根节点供 warmupArea 预热（ARCH §8.5） */
  prebuild(root: THREE.Object3D): readonly THREE.Object3D[] {
    for (const p of this.points.values()) {
      for (const sid of p.def.segments) devAssert(this.segDefs.has(sid), `ReplaySystem.prebuild: ${p.def.id} lists unknown segment '${sid}'`);
    }
    const out: THREE.Object3D[] = [];
    for (const def of this.segDefs.values()) {
      let seg = this.segs.get(def.id);
      if (!seg) {
        seg = this.buildSeg(def);
        this.segs.set(def.id, seg);
      }
      if (seg.root.parent !== root) root.add(seg.root);
      out.push(seg.root);
    }
    return out;
  }

  /** 退出回放（任何传送、levels.set()、模式重置调用；reason 记为 walked_out 或 mode；M1a 补写） */
  exit(reason: 'exit' | 'walked_out' | 'mode'): void {
    const a = this.act;
    if (!a) return;
    this.act = null;   // 先清空：下面的 modes.pop 会回调 ReplayMode.exit → exit('mode')，此时是空操作
    const seg = this.currentSeg(a);
    if (seg) this.deactivate(a, seg);
    const game = this.game;
    game.sys.npc.restoreYield();
    game.pipeline.post.pop('replay');
    game.pipeline.post.vhsPaused = false;
    const vf = game.sys.viewfinder;
    game.cameras.applyLayerMasks({ vf: vf.on, lens: vf.lens, replay: false });
    // reason 'mode'：模式栈正在弹出/重置 replay（ReplayMode.exit 调来），不能再 pop 一次
    if (reason !== 'mode') {
      if (game.modes.top === 'mode.replay') game.modes.pop('mode.replay');
      else if (game.modes.has('mode.replay')) devWarn(`ReplaySystem.exit(${reason}): mode.replay is not on top`, game.modes.stack);
    }
    this.turn = null;
    for (const [o, v] of this.hiddenMarkers) o.visible = v;
    this.hiddenMarkers.clear();
    game.events.emit('replay:end', { point: a.point, reason });
  }

  /** 本区残影点（调试 API 瞄准点解析 rp.* → at + (0,0.8,0)；M1a 补写） */
  point(id: ReplayPointId): ReplayPointDef | undefined {
    return this.points.get(id)?.def;
  }

  /** 离开区域：退出回放（walked_out）、销毁人影与道具、清空本区数据 */
  clearArea(): void {
    this.exit('walked_out');
    for (const seg of this.segs.values()) {
      seg.root.removeFromParent();
      for (const a of seg.actors.values()) a.rt.dispose();
      for (const p of seg.props) p.dispose?.();
    }
    this.segs.clear();
    this.segDefs.clear();
    this.points.clear();
  }

  update(dt: number): void {
    const a = this.act;
    // M4 第 2 轮：暂停时 VHS 跟踪噪声条停在画面底部（CameraFxPass uVhsPaused）
    const post = (this.game.pipeline as { post?: { vhsPaused: boolean } } | undefined)?.post;
    if (post) post.vhsPaused = !!a && !a.playing;
    if (!a) return;
    const p = this.points.get(a.point);
    const seg = this.currentSeg(a);
    if (!p || !seg) {
      this.exit('walked_out');
      return;
    }
    const walk = p.def.walkRadius ?? DEFAULTS.walkRadius;
    if (this.game.player.position.distanceTo(_v.set(p.def.at[0], p.def.at[1], p.def.at[2])) > walk) {
      this.game.api.feedback(STRINGS.feedback.replayWalkedOut);
      this.exit('walked_out');
      return;
    }
    let dtT = 0;
    if (a.playing && dt > 0) {
      dtT = dt;
      let nt = a.t + dt;
      if (nt >= seg.def.dur) {
        this.fireEvents(seg, a.lastT, seg.def.dur);
        this.complete(a, seg);
        nt -= seg.def.dur;
        nt = Math.min(nt, seg.def.dur);
        a.lastT = -1e-6;
      }
      this.fireEvents(seg, a.lastT, nt);
      a.t = nt;
      a.lastT = nt;
    }
    this.applySeg(a, seg, dtT, false);
    this.stepTurn(dt);
  }

  // ------------------------------------------------------------------ WP5 内部

  /** M4：开始（或切段）时转向片段焦点：算出目标 yaw/pitch，按 TURN_SEC 缓动过去。 */
  private beginTurn(seg: SegRt): void {
    const pl = this.game.player;
    // node 自测的假玩家没有 eye/lookAtPoint：不转
    if (!pl || typeof pl.lookAtPoint !== 'function' || !pl.eye) {
      this.turn = null;
      return;
    }
    const y0 = pl.yaw, p0 = pl.pitch, b0 = pl.bodyYaw;
    let target: THREE.Vector3 | null = null;
    if (seg.def.focus) target = new THREE.Vector3(seg.def.focus[0], seg.def.focus[1], seg.def.focus[2]);
    else {
      const c = new THREE.Vector3();
      let n = 0;
      for (const a of seg.def.actors) {
        const m = new THREE.Vector3();
        for (const k of a.keys) m.add(_w.set(k.pos[0], k.pos[1], k.pos[2]));
        if (a.keys.length) {
          c.add(m.divideScalar(a.keys.length));
          n++;
        }
      }
      if (n > 0) target = c.divideScalar(n).add(_w.set(0, 1.2, 0));
    }
    let y1 = y0, p1 = p0;
    if (target) {
      const eye = pl.eye;
      // 焦点就在脚边（人影围着玩家）时只抬头，不转身
      if (Math.hypot(target.x - eye.x, target.z - eye.z) > (seg.def.focus ? NEAR_FOCUS_EXPLICIT : NEAR_FOCUS)) {
        pl.lookAtPoint(target, 'fp');
        y1 = pl.yaw;
        p1 = pl.pitch;
        pl.yaw = y0;
        pl.pitch = p0;
        pl.bodyYaw = b0;
      }
    }
    p1 = Math.max(p1, seg.def.focus ? TURN_MIN_PITCH_FOCUS : TURN_MIN_PITCH);
    if (Math.abs(((y1 - y0 + 540) % 360) - 180) < 0.5 && Math.abs(p1 - p0) < 0.5) {
      this.turn = null;
      return;
    }
    this.turn = { y0, p0, y1, p1, t: 0, lastY: y0, lastP: p0 };
  }

  private stepTurn(dt: number): void {
    const tr = this.turn;
    if (!tr || dt <= 0 || !this.game.player) return;
    const pl = this.game.player;
    // 玩家自己动了视角（鼠标、aimAt）：交还控制
    if (Math.abs(pl.yaw - tr.lastY) > 0.01 || Math.abs(pl.pitch - tr.lastP) > 0.01) {
      this.turn = null;
      return;
    }
    tr.t = Math.min(TURN_SEC, tr.t + dt);
    const k = tr.t / TURN_SEC;
    const e = k * k * (3 - 2 * k);
    const dy = ((tr.y1 - tr.y0 + 540) % 360) - 180;
    pl.yaw = (((tr.y0 + dy * e) % 360) + 360) % 360;
    pl.pitch = tr.p0 + (tr.p1 - tr.p0) * e;
    pl.bodyYaw = pl.yaw;
    tr.lastY = pl.yaw;
    tr.lastP = pl.pitch;
    if (k >= 1) this.turn = null;
  }

  /** M4：藏起残影点上的旋涡（ReplayPointDef.marker，或本区 root 下 1.2m 内带 userData.residueVortex 的对象）。 */
  private hideMarkers(p: PointRt): void {
    const found: THREE.Object3D[] = [];
    if (p.def.marker) found.push(p.def.marker);
    const root = this.game.areas.current?.root;
    if (root) {
      const at = _v.set(p.def.at[0], p.def.at[1], p.def.at[2]);
      root.traverse(o => {
        if (o.userData.residueVortex !== true || found.includes(o)) return;
        o.getWorldPosition(_w);
        if (Math.hypot(_w.x - at.x, _w.z - at.z) <= VORTEX_RADIUS && Math.abs(_w.y - at.y) < 2) found.push(o);
      });
    }
    for (const o of found) {
      if (!this.hiddenMarkers.has(o)) this.hiddenMarkers.set(o, o.visible);
      o.visible = false;
    }
  }

  /** 该片段的根节点（dev 自测检查“预建隐藏”用）。 */
  segmentRoot(id: SegmentId): THREE.Object3D | null {
    return this.segs.get(id)?.root ?? null;
  }

  /**
   * 建一个人影（mat.replay 由角色工厂的 look:'replay' 负责；纸人与克隆道具由这里换材质）。
   * 受保护：node 自测用子类换成简易几何，避免依赖 WP2 的角色工厂。
   */
  protected createActor(a: ActorDef, seed: number): ReplayActorRuntime {
    if (a.rig === 'crowd') {
      devAssert(a.crowd, `ReplaySystem: crowd actor ${a.id} needs 'crowd' options`);
      const c = createCrowd({ ...(a.crowd ?? { count: 12, cols: 6, spacing: 0.6 }), look: 'replay' });
      return { obj: c.mesh, rig: null, paper: null, dispose: () => c.dispose() };
    }
    if (a.rig === 'paper') {
      const p = createPaperFigure({ kind: a.characterOpts?.variant === 'boy' ? 'boy' : 'vendor', seed: a.characterOpts?.seed ?? seed });
      const mat = MATERIALS.replay();
      p.root.traverse(o => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat;
      });
      return { obj: p.root, rig: null, paper: p, dispose: () => p.dispose() };
    }
    if (a.character) {
      // 老周的脸在回放里一律是雪花（GDD M4、§3.6）；其他角色照区域给的选项
      const opts: CharacterOpts = { ...a.characterOpts, look: 'replay', ...(a.character === 'zhou' ? { faceMask: true } : {}) };
      const r = createCharacter(a.character, opts);
      return { obj: r.root, rig: r, paper: null, dispose: () => r.dispose() };
    }
    const h = createHumanoid({ height: 1.75, shirt: '#8a8a5a', pants: '#5a5a3c', head: 'human', material: 'replay' });
    return { obj: h.root, rig: h, paper: null, dispose: () => h.dispose() };
  }

  private buildSeg(def: ReplaySegmentDef): SegRt {
    const root = new THREE.Group();
    root.name = `replay:${def.id}`;
    root.visible = false;
    const actors = new Map<GhostId, ActorRt>();
    def.actors.forEach((a, i) => {
      const rt = this.createActor(a, i + 1);
      rt.obj.name = a.id;
      setLayerRecursive(rt.obj, 'replay');
      // 人身部件的深度预通道子网格（M4，rigs/humanoid.ts）比人影早一档画
      rt.obj.traverse(o => {
        o.renderOrder = o.userData.ghostPrepass === true ? RENDER_ORDER.replay - 1 : RENDER_ORDER.replay;
      });
      root.add(rt.obj);
      actors.set(a.id, { def: a, keys: [...a.keys].sort((x, y) => x.t - y.t), rt, pose: null });
    });
    const props: PropRt[] = [];
    for (const pd of def.props ?? []) {
      let obj: THREE.Object3D | null = null;
      let dispose: (() => void) | null = null;
      if (typeof pd.mesh === 'function') {
        obj = pd.mesh();
        // 函数形式的道具（M3，docs/requests/r4.md #2）：离开区域时像区域 Disposer 一样释放它的几何、非共享材质与贴图
        // （片段根节点在 Disposer 遍历区域 root 之前就被 clearArea 摘下了，不在这里释放就每进一次区域泄一批）。
        // 区域在模块里缓存复用这些资源也没关系：释放后再用会被重新上传。
        const built = obj;
        dispose = () => {
          const d = new Disposer();
          d.trackObject(built);
          d.dispose();
        };
      } else {
        // 字符串 = ctx.ref 登记的现世对象：克隆一份（共享几何），换成 mat.replay 调色；克隆体不释放共享资源
        const src = this.game.areas.current?.ctx.getRef(pd.mesh);
        devAssert(src, `ReplaySystem: prop ${def.id}/${pd.id} refers to unknown ref '${pd.mesh}'`);
        if (src) {
          obj = src.clone(true);
          const mat = MATERIALS.replay();
          obj.traverse(o => {
            if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat;
          });
          dispose = () => undefined;
        }
      }
      if (!obj) continue;
      obj.name = `prop:${pd.id}`;
      setLayerRecursive(obj, 'replay');
      obj.traverse(o => {
        o.renderOrder = RENDER_ORDER.replay;
      });
      root.add(obj);
      props.push({ def: pd, keys: [...pd.keys].sort((x, y) => x.t - y.t), obj, dispose });
    }
    return { def, root, actors, props, locked: compile(def.locked, `segment ${def.id}`) };
  }

  private segRt(id: SegmentId | undefined): SegRt | null {
    if (!id) return null;
    let seg = this.segs.get(id);
    if (!seg) {
      // 未经 prebuild（例如测试直接 register 后开播）：现建并挂到本区 root 下
      const def = this.segDefs.get(id);
      const root = this.game.areas.current?.root;
      if (!def || !root) return null;
      seg = this.buildSeg(def);
      this.segs.set(id, seg);
      root.add(seg.root);
    }
    return seg;
  }

  private currentSeg(a: Active): SegRt | null {
    return this.segRt(this.points.get(a.point)?.def.segments[a.segIndex]);
  }

  private isLocked(seg: SegRt): boolean {
    return seg.locked !== null && seg.locked(this.game.state);
  }

  /** 离玩家最近、在 startRadius 内（3D）、在场、并且镜头前向与指向 at+0.8m 的夹角 ≤ lookAngle 的残影点。 */
  private lookedPoint(): PointRt | null {
    const game = this.game;
    const feet = game.player.position;
    const cam = game.sys.viewfinder.syncPhotoCamera();
    const eye = cam.getWorldPosition(new THREE.Vector3());
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    let best: PointRt | null = null;
    let bestD = Infinity;
    for (const p of this.points.values()) {
      if (p.present && !p.present(game.state)) continue;
      const at = _v.set(p.def.at[0], p.def.at[1], p.def.at[2]);
      const d = feet.distanceTo(at);
      if (d > (p.def.startRadius ?? DEFAULTS.startRadius) || d >= bestD) continue;
      _w.set(p.def.at[0], p.def.at[1] + 0.8, p.def.at[2]).sub(eye);
      if (_w.lengthSq() > 1e-8 && fwd.angleTo(_w) > (p.def.lookAngle ?? DEFAULTS.lookAngle) * DEG2RAD) continue;
      best = p;
      bestD = d;
    }
    return best;
  }

  private start(p: PointRt, segIndex: number): void {
    const game = this.game;
    const a: Active = { point: p.def.id, segIndex, t: 0, playing: true, lastT: -1e-6, completed: new Set(), hidden: new Map() };
    this.act = a;
    game.sys.npc.yieldWithin(p.def.at, p.def.walkRadius ?? DEFAULTS.walkRadius);
    const vf = game.sys.viewfinder;
    game.cameras.applyLayerMasks({ vf: true, lens: vf.lens, replay: true });
    game.pipeline.post.push('replay', POST_PRESETS.replay);
    game.audio.sfx('rewind');
    const seg = this.currentSeg(a);
    if (seg) this.activate(a, seg);
    game.modes.push('mode.replay');
    this.hideMarkers(p);
    if (seg) this.beginTurn(seg);
    if (seg) game.events.emit('replay:start', { point: p.def.id, seg: seg.def.id });
  }

  private switchTo(a: Active, idx: number): void {
    const old = this.currentSeg(a);
    if (old) this.deactivate(a, old);
    a.segIndex = idx;
    a.t = 0;
    a.lastT = -1e-6;
    a.playing = true;
    const seg = this.currentSeg(a);
    if (seg) {
      this.activate(a, seg);
      this.beginTurn(seg);
      this.game.events.emit('replay:start', { point: a.point, seg: seg.def.id });
    }
  }

  private activate(a: Active, seg: SegRt): void {
    a.hidden.clear();
    const ctx = this.game.areas.current?.ctx;
    for (const h of seg.def.hideWorld ?? []) {
      const obj = ctx?.getRef(h.ref);
      devAssert(obj, `ReplaySystem: hideWorld ref '${h.ref}' of ${seg.def.id} is not registered`);
      if (obj && !a.hidden.has(obj)) a.hidden.set(obj, obj.visible);
    }
    for (const r of seg.actors.values()) r.pose = null;
    seg.root.visible = true;
    this.applySeg(a, seg, 0, true);
    this.fireEvents(seg, a.lastT, a.t);
    a.lastT = a.t;
  }

  private deactivate(a: Active, seg: SegRt): void {
    seg.root.visible = false;
    for (const [obj, vis] of a.hidden) obj.visible = vis;
    a.hidden.clear();
  }

  /** 按当前 t 摆人影、道具与 hideWorld。snap = seek/开播（姿势不过渡、行走相位不走）。 */
  private applySeg(a: Active, seg: SegRt, dtT: number, snap: boolean): void {
    const t = a.t;
    for (const r of seg.actors.values()) {
      const s = sampleKeys(r.keys, t, r.rt.obj.position);
      r.rt.obj.rotation.set(0, yawToRotY(s.yaw), 0);
      if (r.rt.rig) {
        if (r.pose !== s.key.pose) {
          r.rt.rig.setPose(s.key.pose, snap || r.pose === null ? 0 : POSE_BLEND);
          r.pose = s.key.pose;
        }
        r.rt.rig.update(dtT, s.speed);
      }
      r.rt.paper?.update(dtT);
    }
    for (const p of seg.props) {
      if (p.keys.length === 0) continue;
      const s = sampleKeys(p.keys, t, p.obj.position);
      p.obj.rotation.set(0, yawToRotY(s.yaw), 0);
      p.obj.visible = s.key.visible !== false;
    }
    if (a.hidden.size > 0) {
      const ctx = this.game.areas.current?.ctx;
      const hideNow = new Set<THREE.Object3D>();
      for (const h of seg.def.hideWorld ?? []) {
        const obj = ctx?.getRef(h.ref);
        if (obj && t >= h.from && t < h.to) hideNow.add(obj);
      }
      for (const [obj, vis] of a.hidden) obj.visible = hideNow.has(obj) ? false : vis;
    }
  }

  /** (from, to] 内的字幕与音效（say 只出字幕，不进 dialogue、不打断回放）。 */
  private fireEvents(seg: SegRt, from: number, to: number): void {
    for (const s of seg.def.subs) if (s.t > from && s.t <= to) this.say(s.text, s.speaker, s.dur);
    for (const s of seg.def.sfx ?? []) if (s.t > from && s.t <= to) this.game.audio.sfx(s.cue);
  }

  /** seek 落到某句字幕的时间窗里时，补显示这一句的剩余部分。 */
  private showSubAt(seg: SegRt, t: number): void {
    for (const s of seg.def.subs) if (t >= s.t && t < s.t + s.dur) this.say(s.text, s.speaker, s.t + s.dur - t);
  }

  private say(text: string, speaker: SpeakerId | '', dur: number): void {
    if (speaker === '') this.game.api.say(text, undefined, dur);
    else this.game.api.say(text, speaker, dur);
  }

  private complete(a: Active, seg: SegRt): void {
    if (a.completed.has(seg.def.id)) return;
    a.completed.add(seg.def.id);
    this.game.events.emit('replay:complete', { seg: seg.def.id });
    const h = seg.def.onComplete;
    if (h) this.game.effects.runHandler(h, `replay:${seg.def.id}`).catch((err: unknown) => devWarn(`ReplaySystem: onComplete ${seg.def.id} failed`, err));
  }
}
