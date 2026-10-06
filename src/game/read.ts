// owner: WP5
// 读字目标（ARCH §6.8.6）：普通判定与镜中虚像判定。全部用几何与射线（ARCH §3.3）。

import * as THREE from 'three';
import type { V3, ZoomLevel } from '../core/types';
import type { InteractId, ReadId } from '../data/ids';
import type { Game } from '../core/game';
import type { Cond } from './expr';
import { compileCond } from './expr';
import type { GameApi, Handler } from './effects';
import type { StateView } from './state';
import { devAssert, devWarn } from '../core/log';
import { reflectPoint, segmentPlaneIntersect, signedDistanceToPlane } from '../core/math';
import { STRINGS } from '../data/strings';
import { collectOccluders, occludedBetween } from './photo';

export interface ReadTargetDef {
  id: ReadId;
  /**
   * 字迹中心（世界坐标）。函数形式每帧求值：跟随 NPC（rd.huang_breath 取黄三爷 anchors.mouth），
   * 或镜中字取“实物点”（rd.sticker_mirror：g.player.model.stickerWorld()）
   */
  at: V3 | ((g: GameApi) => THREE.Vector3);
  /** 镜中字：at 是实物点，判定用它关于该镜面平面的虚像 */
  via?: { mirror: InteractId };
  maxDist: number;
  minZoom: ZoomLevel;
  /** rd.portrait_sketch 为 'ir'；rd.huang_breath 为 'normal'（缺省按 'normal'：红外画面里没有褪字层，字是看不见的，GDD §3.3 M5） */
  lens?: 'normal' | 'ir';
  /** 默认 0.5 */
  frameBox?: number;
  when?: Cond;
  /** UI 覆盖层原文 */
  text: string;
  /** 覆盖层用 scaleX(-1) 显示 */
  mirror?: boolean;
  /** 默认 STRINGS.feedback.readTooSmall“（字太小了，滚轮拉近点。）”；null = 倍率不够时什么也不显示 */
  tooSmall?: string | null;
  /** via.mirror 时虚像不在镜面圆盘里的反馈 */
  notInMirror?: string;
  /** 第一次读到时执行（可写 flag、线索）；必须幂等 */
  onRead?: Handler;
}

interface ReadEntry { def: ReadTargetDef; when: ((s: StateView) => boolean) | null }
type ReadOutcome =
  | { kind: 'none' }
  | { kind: 'read'; d: number }
  | { kind: 'hint'; text: string; d: number };

const DEFAULT_FRAME_BOX = 0.5;
const _eye = new THREE.Vector3();
const _p = new THREE.Vector3();
const _img = new THREE.Vector3();
const _x = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const _dir = new THREE.Vector3();
/** M4 第 2 轮：镜中字“站偏”判定用的中心射线（frameDist 用 _dir/_ndc，这里另用一套，免得互相覆盖） */
const _aimDir = new THREE.Vector3();
const _aimHit = new THREE.Vector3();

export class ReadSystem {
  protected readonly game: Game;
  private readonly defs = new Map<ReadId, ReadEntry>();
  private _reading: { id: ReadId; text: string } | null = null;
  private _hint: string | null = null;
  /** 本次运行已执行过 onRead 的目标（onRead 本身必须幂等，这里只避免每帧重复排队） */
  private readonly readOnce = new Set<ReadId>();

  constructor(game: Game) {
    this.game = game;
  }

  /** 当前正在读的目标（state() 暴露） */
  get reading(): { id: ReadId; text: string } | null {
    return this._reading;
  }
  /** 当前显示的 tooSmall/notInMirror 文本（state() 暴露为 reading 为空时的 readHint） */
  get hint(): string | null {
    return this._reading ? null : this._hint;
  }

  /** AreaManager.enter 第 4 步（AreaDef.readTargets）与 ctx.readTarget() 调用；id 重复在 dev 下抛错 */
  register(defs: readonly ReadTargetDef[]): void {
    for (const def of defs) {
      devAssert(!this.defs.has(def.id), `ReadSystem.register: duplicate read target '${def.id}'`);
      const when = def.when === undefined ? null : typeof def.when === 'function' ? def.when : compileCond(def.when, `readTarget ${def.id}`);
      this.defs.set(def.id, { def, when });
    }
  }

  /** 离开区域时清空本区目标 */
  clearArea(): void {
    this.defs.clear();
    this._reading = null;
    this._hint = null;
    // onRead 本来就要求幂等，readOnce 只防每帧重复排队：换区域（含新游戏、读档重进）清掉，否则同一页面里重开后 onRead 永不再执行（M1d）
    this.readOnce.clear();
  }

  /** ARCH §3.2 第 6 步由 Game.step 每帧调用：取景器开启时做判定，未开启时只把 reading/hint 清为 null；aimAt() 后立即执行一次 */
  evaluate(): void {
    const vf = this.game.sys.viewfinder;
    if (!vf.on || this.defs.size === 0) {
      this._reading = null;
      this._hint = null;
      return;
    }
    const cam = vf.syncPhotoCamera();
    cam.getWorldPosition(_eye);
    const root = this.game.areas.current?.root ?? null;
    let occluders: THREE.Object3D[] | null = null;
    const getOccluders = (): THREE.Object3D[] => (occluders ??= root ? collectOccluders(root, cam) : []);

    let best: { id: ReadId; text: string; d: number } | null = null;
    let hint: { text: string; d: number } | null = null;
    for (const [id, e] of this.defs) {
      const r = this.judge(e, cam, getOccluders);
      if (r.kind === 'read' && (!best || r.d < best.d)) best = { id, text: e.def.text, d: r.d };
      else if (r.kind === 'hint' && (!hint || r.d < hint.d)) hint = { text: r.text, d: r.d };
    }
    const prev = this._reading?.id ?? null;
    this._reading = best ? { id: best.id, text: best.text } : null;
    this._hint = hint ? hint.text : null;
    // M4：第一次因为倍率不够读不出字时，顺带教一次“滚轮：变焦”（与 E.tutorial 同一个去重键，一局只教一次）
    if (!best && this._hint === STRINGS.feedback.readTooSmall) {
      const key = `tutorial:${STRINGS.tutorial.zoom}`;
      // node 自测的假 Game 没有 seen/markSeen：跳过
      const st = this.game.state as { seen?: (k: string) => boolean; markSeen?: (k: string) => void };
      if (st.seen && st.markSeen && !st.seen(key)) {
        st.markSeen(key);
        // 只出教学条、不发 'feedback'（读字提示本身已经是 readHint）；M4 第 2 轮：走 UI.tutorial 的“风平浪静”闸门
        const ui = this.game.ui as { tutorial?: (t: string) => void; subs?: { toast(t: string, k: 'tutorial'): void } } | undefined;
        if (typeof ui?.tutorial === 'function') ui.tutorial(STRINGS.tutorial.zoom);
        else ui?.subs?.toast(STRINGS.tutorial.zoom, 'tutorial');
      }
    }
    if (best && best.id !== prev) {
      this.game.events.emit('read', { id: best.id });
      const def = this.defs.get(best.id)?.def;
      if (def?.onRead && !this.readOnce.has(best.id)) {
        this.readOnce.add(best.id);
        this.game.effects.runHandler(def.onRead, `read:${best.id}`).catch((err: unknown) => devWarn(`ReadSystem: onRead ${best?.id} failed`, err));
      }
    }
  }

  /** 本区目标（调试 API 瞄准点解析用；M1a 补写） */
  get(id: ReadId): ReadTargetDef | undefined {
    return this.defs.get(id)?.def;
  }

  /** 目标此刻的瞄准点（函数 at 现算；via.mirror 时取虚像点；M1a 补写） */
  aimPoint(id: ReadId, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 | null {
    const def = this.defs.get(id)?.def;
    if (!def) return null;
    this.atPoint(def, target);
    if (def.via) {
      const disc = this.game.sys.mirror.disc(def.via.mirror);
      reflectPoint(target, disc.center, disc.normal, target);
    }
    return target;
  }

  // ------------------------------------------------------------------ 内部

  private atPoint(def: ReadTargetDef, target: THREE.Vector3): THREE.Vector3 {
    if (typeof def.at === 'function') return target.copy(def.at(this.game.api));
    return target.set(def.at[0], def.at[1], def.at[2]);
  }

  /** 画框检查：点在相机前方且 |ndc| ≤ frameBox；返回到画面中心的 NDC 距离（不在框内为 null）。 */
  private frameDist(cam: THREE.PerspectiveCamera, p: THREE.Vector3, frameBox: number): number | null {
    cam.getWorldDirection(_dir);
    if (_ndc.copy(p).sub(_eye).dot(_dir) <= 1e-4) return null;
    _ndc.copy(p).project(cam);
    if (Math.abs(_ndc.x) > frameBox || Math.abs(_ndc.y) > frameBox) return null;
    return Math.hypot(_ndc.x, _ndc.y);
  }

  /** M4 第 2 轮：镜头中心射线打在镜盘内时返回交点到镜心的距离（归一到半径，当排序用的 d），否则 null。 */
  private aimOnDisc(cam: THREE.PerspectiveCamera, center: THREE.Vector3, normal: THREE.Vector3, radius: number): number | null {
    cam.getWorldDirection(_aimDir);
    const denom = _aimDir.dot(normal);
    if (Math.abs(denom) < 1e-6) return null;
    const t = _aimHit.copy(center).sub(_eye).dot(normal) / denom;
    if (t <= 0) return null;
    _aimHit.copy(_eye).addScaledVector(_aimDir, t);
    const r = _aimHit.distanceTo(center);
    return r <= radius ? r / Math.max(1e-6, radius) : null;
  }

  private tooSmallText(def: ReadTargetDef): string | null {
    return def.tooSmall === undefined ? STRINGS.feedback.readTooSmall : def.tooSmall;
  }

  private judge(e: ReadEntry, cam: THREE.PerspectiveCamera, getOccluders: () => THREE.Object3D[]): ReadOutcome {
    const def = e.def;
    const vf = this.game.sys.viewfinder;
    if (e.when && !e.when(this.game.state)) return { kind: 'none' };
    if (vf.lens !== (def.lens ?? 'normal')) return { kind: 'none' };
    const frameBox = def.frameBox ?? DEFAULT_FRAME_BOX;
    this.atPoint(def, _p);

    if (def.via) {
      // 镜中字（ARCH §6.8.6）：虚像 P' 定方向，镜头到镜面平面的距离定远近，视线与镜面的交点必须落在圆盘里
      const disc = this.game.sys.mirror.disc(def.via.mirror);
      if (disc.radius <= 0) return { kind: 'none' };
      const sd = signedDistanceToPlane(_eye, disc.center, disc.normal);
      if (sd <= 0 || sd > def.maxDist) return { kind: 'none' };
      reflectPoint(_p, disc.center, disc.normal, _img);
      const d = this.frameDist(cam, _img, frameBox);
      const x = segmentPlaneIntersect(_eye, _img, disc.center, disc.normal, _x);
      if (!x || x.distanceTo(disc.center) > disc.radius) {
        // 站偏了：虚像不在镜盘里。M4 第 2 轮：真人站偏时照常对着镜子中心看（虚像在镜外的墙上、画面外），
        // 所以准星射线落在镜盘内也给 notInMirror（原来只有准星对着镜外的虚像时才给，基本不会出现）
        if (!def.notInMirror) return { kind: 'none' };
        if (d !== null) return { kind: 'hint', text: def.notInMirror, d };
        const aim = this.aimOnDisc(cam, disc.center, disc.normal, disc.radius);
        return aim !== null ? { kind: 'hint', text: def.notInMirror, d: aim } : { kind: 'none' };
      }
      if (d === null) return { kind: 'none' };
      if (occludedBetween(_eye, x, getOccluders(), [])) return { kind: 'none' };
      if (vf.zoom >= def.minZoom) return { kind: 'read', d };
      const t = this.tooSmallText(def);
      return t === null ? { kind: 'none' } : { kind: 'hint', text: t, d };
    }

    const d = this.frameDist(cam, _p, frameBox);
    if (d === null) return { kind: 'none' };
    if (_eye.distanceTo(_p) > def.maxDist) return { kind: 'none' };
    if (occludedBetween(_eye, _p, getOccluders(), [])) return { kind: 'none' };
    if (vf.zoom >= def.minZoom) return { kind: 'read', d };
    const t = this.tooSmallText(def);
    return t === null ? { kind: 'none' } : { kind: 'hint', text: t, d };
  }
}
