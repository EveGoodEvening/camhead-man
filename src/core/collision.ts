// owner: WP1
// 碰撞（ARCH §4.8）：three/addons 的 Octree + Capsule，外加动态 OBB 碰撞体与连通性栅格。
//
// 约定（WP1）：
// - 盒子的 rotYDeg 与 three 的 object.rotation.y 同义（绕 +Y 逆时针，度），ColliderBuilder.box 与 DynamicShape 一致。
// - 墙 wall(a, b, …) 是以线段 a→b 为中心线、厚 thickness 的竖直盒子。
// - 动态碰撞体只有盒子一种几何（墙也换算成盒子），胶囊是竖直的，所以“胶囊 vs 盒子”在盒子的局部坐标里是“竖直线段 vs AABB”。

import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import type { V3, XZ } from './types';
import { DEG2RAD } from './math';
import type { StateView } from '../game/state';
import type { Cond } from '../game/expr';
import type { Game } from './game';
import { devAssert } from './log';
import { BUDGET } from '../data/render';

/** M4：Octree 细分参数（见 build()） */
const OCTREE_TRIS_PER_LEAF = 32;
const OCTREE_MAX_LEVEL = 8;
/**
 * three 的 Octree.split() 用 `new Octree(box)` 建子树，子树的 trianglesPerLeaf/maxLevel 是构造函数的默认值（8/16），
 * 只改根节点只管得了第一层。这里包一层：每个节点分裂前先把参数写成本项目的值（本项目只有碰撞系统用 Octree）。
 */
{
  type SplitFn = (this: Octree, level: number) => Octree;
  const proto = Octree.prototype as unknown as { split: SplitFn; __cmTuned?: boolean };
  if (!proto.__cmTuned) {
    const orig = proto.split;
    proto.split = function (this: Octree, level: number): Octree {
      this.trianglesPerLeaf = OCTREE_TRIS_PER_LEAF;
      this.maxLevel = OCTREE_MAX_LEVEL;
      return orig.call(this, level);
    };
    proto.__cmTuned = true;
  }
}

export type DynamicShape =
  | { box: { center: V3; size: V3; rotYDeg?: number } }
  | { wall: { a: XZ; b: XZ; y0: number; height: number; thickness?: number } };

export interface DynamicColliderHandle { readonly key: string; readonly enabled: boolean; refresh(): void; remove(): void }

/** 换算后的定向盒（只绕 Y 旋转）。WP1 内部。 */
export interface Obb { center: THREE.Vector3; half: THREE.Vector3; rotY: number }

/** DynamicShape → 盒子（墙换算成以 a→b 为中心线的盒子）。 */
export function shapeToObb(shape: DynamicShape): Obb {
  if ('box' in shape) {
    const b = shape.box;
    return {
      center: new THREE.Vector3(b.center[0], b.center[1], b.center[2]),
      half: new THREE.Vector3(Math.abs(b.size[0]) / 2, Math.abs(b.size[1]) / 2, Math.abs(b.size[2]) / 2),
      rotY: (b.rotYDeg ?? 0) * DEG2RAD,
    };
  }
  const w = shape.wall;
  const dx = w.b[0] - w.a[0];
  const dz = w.b[1] - w.a[1];
  const len = Math.hypot(dx, dz);
  return {
    center: new THREE.Vector3((w.a[0] + w.b[0]) / 2, w.y0 + w.height / 2, (w.a[1] + w.b[1]) / 2),
    half: new THREE.Vector3(len / 2, Math.abs(w.height) / 2, (w.thickness ?? 0.2) / 2),
    // 局部 +x 旋到 (dx, dz)：rotation.y = θ 时局部 x 轴 = (cosθ, 0, −sinθ)
    rotY: Math.atan2(-dz, dx),
  };
}

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _n = new THREE.Vector3();

/** 世界点 → 盒子局部（盒心为原点，未旋转）。 */
function toLocal(o: Obb, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const x = p.x - o.center.x;
  const z = p.z - o.center.z;
  const c = Math.cos(-o.rotY);
  const s = Math.sin(-o.rotY);
  // 绕 Y 旋转 −rotY（three 的 applyAxisAngle 公式：x' = x cos + z sin，z' = −x sin + z cos）
  return out.set(x * c + z * s, p.y - o.center.y, -x * s + z * c);
}
/** 局部方向 → 世界方向。 */
function dirToWorld(o: Obb, d: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(o.rotY);
  const s = Math.sin(o.rotY);
  return out.set(d.x * c + d.z * s, d.y, -d.x * s + d.z * c);
}

/**
 * 竖直胶囊 vs 定向盒：相交时返回把胶囊推出盒子的 { normal（世界，单位）, depth }。
 * 胶囊必须竖直（本项目的玩家胶囊恒竖直）；斜胶囊按其包围竖直段近似。
 */
export function capsuleVsObb(c: Capsule, o: Obb): { normal: THREE.Vector3; depth: number } | false {
  const r = c.radius;
  const a = toLocal(o, c.start, _p);
  const y0 = Math.min(c.start.y, c.end.y) - o.center.y;
  const y1 = Math.max(c.start.y, c.end.y) - o.center.y;
  const hx = o.half.x;
  const hy = o.half.y;
  const hz = o.half.z;
  // 线段上离盒子最近的 y：两区间重叠则取重叠段中点，否则取近端
  const lo = Math.max(y0, -hy);
  const hi = Math.min(y1, hy);
  const segY = lo <= hi ? (lo + hi) / 2 : y1 < -hy ? y1 : y0;
  const boxY = Math.min(hy, Math.max(-hy, segY));
  const bx = Math.min(hx, Math.max(-hx, a.x));
  const bz = Math.min(hz, Math.max(-hz, a.z));
  const dx = a.x - bx;
  const dy = segY - boxY;
  const dz = a.z - bz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > r * r) return false;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    _n.set(dx / d, dy / d, dz / d);
    return { normal: dirToWorld(o, _n, new THREE.Vector3()), depth: r - d };
  }
  // 轴线穿进盒子：沿最浅的面推出（水平四面与顶面；不从底面往下推）
  const cands: [number, number, number, number][] = [
    [hx - a.x, 1, 0, 0], [a.x + hx, -1, 0, 0], [hz - a.z, 0, 0, 1], [a.z + hz, 0, 0, -1], [hy - y0, 0, 1, 0],
  ];
  let best = cands[0]!;
  for (const cnd of cands) if (cnd[0] < best[0]) best = cnd;
  _n.set(best[1], best[2], best[3]);
  // 推到轴线离该面 r 处
  return { normal: dirToWorld(o, _n, new THREE.Vector3()), depth: best[0] + r };
}

/** 射线 vs 定向盒：返回世界距离或 null。 */
function rayVsObb(ray: THREE.Ray, o: Obb, box: THREE.Box3, local: THREE.Ray, hit: THREE.Vector3): number | null {
  toLocal(o, ray.origin, local.origin);
  const c = Math.cos(-o.rotY);
  const s = Math.sin(-o.rotY);
  const d = ray.direction;
  local.direction.set(d.x * c + d.z * s, d.y, -d.x * s + d.z * c);
  box.min.set(-o.half.x, -o.half.y, -o.half.z);
  box.max.set(o.half.x, o.half.y, o.half.z);
  if (!local.intersectBox(box, hit)) return null;
  return hit.distanceTo(local.origin);
}

interface Dyn {
  key: string;
  obb: Obb;
  pred: (s: StateView) => boolean;
  enabled: boolean;
  seeThrough: boolean;
  alive: boolean;
}

/** 玩家胶囊半径（PlayerController 与连通性栅格共用，M1d）。 */
export const PLAYER_RADIUS = 0.3;
/**
 * 最大门槛/路沿高度（M1d，ARCH §4.8、§4.9）：PlayerController 能直接迈上去的台阶高度，连通性栅格也按它放过低矮障碍——
 * 两边同一个常量，goto 放行的地方真人一定走得过去。区域里要挡人的矮墙/花坛边请高于 0.2m。
 */
export const STEP_MAX = 0.15;
/** 连通性栅格（WP1）：比 ARCH 写的 0.5m 细一倍，避免 0.9m 宽门洞里没有格心落在可通行带内而误判不连通。 */
const GRID = 0.25;
/**
 * 测试胶囊半径 = 玩家胶囊半径减 5mm 容差（M1d：原 0.28 会放过 0.56–0.6m 的窄缝；容差让“贴着桌边/墙站”的点仍算可达）。
 * 0.25m 格下 0.9m 门洞仍有格心落在 ≈0.31m 宽的可通行带内。
 */
const GRID_R = PLAYER_RADIUS - 0.005;
/** 栅格测试胶囊的底比地面高多少：不高于 STEP_MAX 的门槛/路沿不算障碍（多 1cm 容差，控制器实际能迈 STEP_MAX + 2cm） */
const GRID_LIFT = STEP_MAX + 0.01;
const GRID_MAX_CELLS = 250_000;

export class CollisionWorld {
  protected readonly game: Game;
  private tree: Octree | null = null;
  private colliderRoot: THREE.Object3D | null = null;
  private dyn: Dyn[] = [];
  /** 碰撞体版本号：Octree 重建、动态碰撞体增删或开关时递增（reachable 的缓存键） */
  private version = 0;
  private reachCache = new Map<string, Map<number, boolean>>();
  private bounds: THREE.Box3 | null = null;
  private readonly tmpCapsule = new Capsule(new THREE.Vector3(), new THREE.Vector3(), GRID_R);
  private readonly tmpRay = new THREE.Ray();
  private readonly tmpLocalRay = new THREE.Ray();
  private readonly tmpBox = new THREE.Box3();
  private readonly tmpHit = new THREE.Vector3();

  constructor(game: Game) {
    this.game = game;
    // 动态碰撞体的条件随 flag 与区域临时状态变化（ARCH §4.8）
    game.events.on('flag', () => this.reevaluate());
    game.events.on('temp', () => this.reevaluate());
  }

  get octree(): Octree | null {
    return this.tree;
  }

  /** new Octree().fromGraphNode(colliderRoot)；colliderRoot 不加入场景 */
  build(colliderRoot: THREE.Object3D): void {
    this.colliderRoot = colliderRoot;
    let meshes = 0;
    colliderRoot.traverse(o => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    // 空区域（只有动态碰撞体或什么都没有）不建树：Octree 对零三角形的 build 没有意义
    // M4：three 的默认（每叶 8 个三角形、最深 16 层）会把跨越多个格子的大三角形（楼板、墙）复制进每个相交的子树，
    // R2 只有 61 个盒子却细分出约 20 万个节点（常驻 ~80MB 堆、每次胶囊查询都要走很深的树）。查询结果与细分无关，只影响速度
    if (meshes > 0) {
      const t = new Octree();
      t.trianglesPerLeaf = OCTREE_TRIS_PER_LEAF;
      t.maxLevel = OCTREE_MAX_LEVEL;
      this.tree = t.fromGraphNode(colliderRoot);
    } else {
      this.tree = null;
    }
    this.bounds = meshes > 0 ? new THREE.Box3().setFromObject(colliderRoot) : null;
    this.bump();
  }

  /** M4（WP1 内部）：当前 Octree 的节点数（自测：每区应远小于 2 万）。 */
  octreeNodes(): number {
    let n = 0;
    const walk = (t: Octree): void => {
      n++;
      for (const c of t.subTrees) walk(c);
    };
    if (this.tree) walk(this.tree);
    return n;
  }

  /** 备选：按当前 colliderRoot 重建 Octree */
  rebuild(): void {
    if (this.colliderRoot) this.build(this.colliderRoot);
  }

  /** 同时清空动态碰撞体 */
  clear(): void {
    this.tree = null;
    this.colliderRoot = null;
    this.bounds = null;
    for (const d of this.dyn) d.alive = false;
    this.dyn = [];
    this.bump();
  }

  addDynamic(key: string, shape: DynamicShape, enabled: (s: StateView) => boolean, o?: { seeThrough?: boolean }): DynamicColliderHandle {
    devAssert(!this.dyn.some(d => d.key === key), `CollisionWorld.addDynamic: key '${key}' 重复`);
    devAssert(this.dyn.length < BUDGET.dynamicColliders, `CollisionWorld.addDynamic: 每区动态碰撞体 ≤ ${BUDGET.dynamicColliders}`);
    const d: Dyn = { key, obb: shapeToObb(shape), pred: enabled, enabled: this.safeEval(enabled, key), seeThrough: o?.seeThrough === true, alive: true };
    this.dyn.push(d);
    this.bump();
    const self = this;
    return {
      key,
      get enabled() {
        return d.enabled;
      },
      refresh() {
        const v = self.safeEval(d.pred, key);
        if (v !== d.enabled) {
          d.enabled = v;
          self.bump();
        }
      },
      remove() {
        if (!d.alive) return;
        d.alive = false;
        self.dyn = self.dyn.filter(x => x !== d);
        self.bump();
      },
    };
  }

  /** 先测 Octree，再测启用中的动态 OBB（胶囊 vs 盒子，取最深者；seeThrough 的照样挡人） */
  capsule(c: Capsule): { normal: THREE.Vector3; depth: number } | false {
    let best: { normal: THREE.Vector3; depth: number } | false = false;
    if (this.tree) {
      const r = this.tree.capsuleIntersect(c);
      // Octree 返回的 normal 是模块级临时向量，必须复制
      if (r) best = { normal: r.normal.clone(), depth: r.depth };
    }
    for (const d of this.dyn) {
      if (!d.enabled) continue;
      const r = capsuleVsObb(c, d.obb);
      if (r && (!best || r.depth > best.depth)) best = r;
    }
    return best;
  }

  /**
   * 同样包含启用中的动态碰撞体（命中时返回其 key）；skipSeeThrough：跳过 seeThrough 的动态碰撞体（玻璃门）；
   * ignoreKeys：跳过这些 key 的动态碰撞体（视线检查时跳过目标自身，如 r1.gate）
   */
  raycast(
    origin: THREE.Vector3, dir: THREE.Vector3, far: number,
    o?: { skipSeeThrough?: boolean; ignoreKeys?: readonly string[] },
  ): { distance: number; point: THREE.Vector3; key?: string } | null {
    if (!(far > 0)) return null;
    const ray = this.tmpRay;
    ray.origin.copy(origin);
    ray.direction.copy(dir);
    if (ray.direction.lengthSq() < 1e-12) return null;
    ray.direction.normalize();
    let best: { distance: number; point: THREE.Vector3; key?: string } | null = null;
    if (this.tree) {
      const r = this.tree.rayIntersect(ray);
      if (r && r.distance <= far) best = { distance: r.distance, point: r.position.clone() };
    }
    for (const d of this.dyn) {
      if (!d.enabled) continue;
      if (o?.skipSeeThrough && d.seeThrough) continue;
      if (o?.ignoreKeys?.includes(d.key)) continue;
      const dist = rayVsObb(ray, d.obb, this.tmpBox, this.tmpLocalRay, this.tmpHit);
      if (dist === null || dist > far || (best && dist >= best.distance)) continue;
      best = { distance: dist, point: ray.at(dist, new THREE.Vector3()), key: d.key };
    }
    return best;
  }

  /**
   * 连通性（ARCH §4.5 goto；仅 ?test=1 使用）：在 from 所在高度的一层上做栅格 flood-fill。
   * 格子是否可通行 = 在格心放一个竖直测试胶囊（半径 GRID_R，底离地 GRID_LIFT）是否与 Octree 或启用中的动态碰撞体（含 seeThrough）相交，
   * 即“按胶囊半径膨胀”。格子按需测试并按“碰撞体版本号 + 层高”缓存。from 与 to 高差 > 1.2m 视为不同楼层：直接 false，
   * 楼层之间经楼梯口连通由调用方（AreaManager.goto）处理。
   */
  reachable(from: V3, to: V3, level?: number): boolean {
    if (Math.abs(to[1] - from[1]) > 1.2) return false;
    const y = from[1];
    if (!this.capsuleFreeAt(to[0], y, to[2])) return false;
    const cacheKey = `${this.version}|${level ?? 'y'}|${y.toFixed(2)}`;
    let cached = this.reachCache.get(cacheKey);
    if (!cached) {
      // 版本变化时 bump() 已清空；同一版本下不同层高各占一张
      if (this.reachCache.size > 8) this.reachCache.clear();
      cached = new Map<number, boolean>();
      this.reachCache.set(cacheKey, cached);
    }
    const memo = cached;
    const ix0 = Math.floor(from[0] / GRID);
    const iz0 = Math.floor(from[2] / GRID);
    const ix1 = Math.floor(to[0] / GRID);
    const iz1 = Math.floor(to[2] / GRID);
    if (ix0 === ix1 && iz0 === iz1) return true;
    const b = this.gridBounds();
    const key = (ix: number, iz: number): number => (ix + 32768) * 65536 + (iz + 32768);
    const open = (ix: number, iz: number): boolean => {
      if (ix === ix1 && iz === iz1) return true;   // 目标点本身已单独测过
      if (b && (ix * GRID < b.min.x || (ix + 1) * GRID > b.max.x || iz * GRID < b.min.z || (iz + 1) * GRID > b.max.z)) return false;
      const k = key(ix, iz);
      let v = memo.get(k);
      if (v === undefined) {
        v = this.capsuleFreeAt((ix + 0.5) * GRID, y, (iz + 0.5) * GRID);
        memo.set(k, v);
      }
      return v;
    };
    // 起点格恒视为可通行（玩家确实站在那里，格心可能正好落进墙的膨胀带）
    const seen = new Set<number>([key(ix0, iz0)]);
    const queue: [number, number][] = [[ix0, iz0]];
    const N4: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const D4: readonly [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let head = 0; head < queue.length; head++) {
      if (seen.size > GRID_MAX_CELLS) return false;
      const [cx, cz] = queue[head]!;
      const visit = (nx: number, nz: number): boolean => {
        const k = key(nx, nz);
        if (seen.has(k) || !open(nx, nz)) return false;
        seen.add(k);
        if (nx === ix1 && nz === iz1) return true;
        queue.push([nx, nz]);
        return false;
      };
      for (const [dx, dz] of N4) if (visit(cx + dx, cz + dz)) return true;
      // 斜向只在两个正交邻格都通时才走（不能从墙角斜穿过去）
      for (const [dx, dz] of D4) if (open(cx + dx, cz) && open(cx, cz + dz) && visit(cx + dx, cz + dz)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- WP1 内部
  /** 碰撞体版本号（调试与自测用）。 */
  get colliderVersion(): number {
    return this.version;
  }

  /** 竖直胶囊放在 (x, y, z)（脚底）时是否与任何碰撞体（Octree + 启用中的动态，含 seeThrough）相交；贴地的地面不算。 */
  capsuleFreeAt(x: number, y: number, z: number, radius = GRID_R): boolean {
    const c = this.tmpCapsule;
    c.radius = radius;
    c.start.set(x, y + GRID_LIFT + radius, z);
    c.end.set(x, y + 1.45, z);
    if (c.end.y < c.start.y) c.end.y = c.start.y;
    if (this.tree && this.tree.capsuleIntersect(c)) return false;
    for (const d of this.dyn) if (d.enabled && capsuleVsObb(c, d.obb)) return false;
    return true;
  }

  /** 在 (x, z) 处从 yTop 向下找地面（Octree 与动态盒子顶面），返回地面高度；maxDrop 内没有则 null。 */
  groundBelow(x: number, yTop: number, z: number, maxDrop: number): number | null {
    _q.set(x, yTop, z);
    const hit = this.raycast(_q, new THREE.Vector3(0, -1, 0), maxDrop);
    return hit ? hit.point.y : null;
  }

  private gridBounds(): THREE.Box3 | null {
    if (!this.bounds && this.dyn.length === 0) return null;
    const b = this.bounds ? this.bounds.clone() : new THREE.Box3();
    for (const d of this.dyn) {
      const r = Math.hypot(d.obb.half.x, d.obb.half.z);
      b.expandByPoint(new THREE.Vector3(d.obb.center.x - r, d.obb.center.y, d.obb.center.z - r));
      b.expandByPoint(new THREE.Vector3(d.obb.center.x + r, d.obb.center.y, d.obb.center.z + r));
    }
    return b.expandByScalar(1);
  }

  private bump(): void {
    this.version++;
    this.reachCache.clear();
  }

  private safeEval(pred: (s: StateView) => boolean, key: string): boolean {
    try {
      return pred(this.game.state) === true;
    } catch (err) {
      console.error(`[CollisionWorld] 动态碰撞体 '${key}' 的条件求值失败`, err);
      return true;
    }
  }

  private reevaluate(): void {
    let changed = false;
    for (const d of this.dyn) {
      const v = this.safeEval(d.pred, d.key);
      if (v !== d.enabled) {
        d.enabled = v;
        changed = true;
      }
    }
    if (changed) this.bump();
  }
}

export interface ColliderBuilder {
  box(center: V3, size: V3, rotYDeg?: number): void;
  /** 默认厚 0.2 */
  wall(a: XZ, b: XZ, y0: number, height: number, thickness?: number): void;
  /** 地面（薄盒） */
  floor(x0: number, z0: number, x1: number, z1: number, y?: number): void;
  /** 克隆几何并烘焙世界矩阵（不能是 InstancedMesh） */
  mesh(m: THREE.Mesh): void;
  /** 逐实例展开成普通 Mesh 后加入 */
  instanced(m: THREE.InstancedMesh): void;
  /** 可开关的碰撞体：院门、照相馆玻璃门……；seeThrough = 挡人但不挡视线（玻璃） */
  dynamic(key: string, shape: DynamicShape, enabled: Cond, o?: { seeThrough?: boolean }): DynamicColliderHandle;
}
