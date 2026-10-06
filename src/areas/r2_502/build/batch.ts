// owner: R2
// R2 私有建造小工具：按材质合并的几何批（一个楼层节点的静态件合成少数几个网格，省 draw call，ARCH §13.3），
// 带米制 UV 的墙面四边形（MATERIALS.dado 按网格 UV：v 0→1 从下到上，墙裙分界在 45%）、楼梯跑段。
// 与 ../../r2/build/batch.ts 相同（区域目录互不 import，所以各留一份）。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { XZ } from '../../../core/types';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** 统一成非索引、只含 position/normal/uv 的几何（mergeGeometries 要求属性一致）。 */
function normalize(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((out.attributes.position?.count ?? 0) * 2), 2));
  out = out.clone();
  return out;
}

export class Batch {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly stack: THREE.Matrix4[] = [];

  /** 在局部坐标系里建一件道具：原点 (x,y,z)、绕 y 转 rotYDeg（three 的 rotation.y，度）。可嵌套。 */
  at(x: number, y: number, z: number, rotYDeg: number, fn: () => void, scale = 1): void {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotYDeg * THREE.MathUtils.DEG2RAD, 0)), new THREE.Vector3(scale, scale, scale));
    const top = this.stack[this.stack.length - 1];
    this.stack.push(top ? top.clone().multiply(m) : m);
    try {
      fn();
    } finally {
      this.stack.pop();
    }
  }

  /** 加入一块几何（会被 matrix 就地变换；调用方不要再用它）。 */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, matrix?: THREE.Matrix4): void {
    if (matrix) geo.applyMatrix4(matrix);
    const top = this.stack[this.stack.length - 1];
    if (top) geo.applyMatrix4(top);
    const list = this.parts.get(mat) ?? [];
    list.push(normalize(geo));
    this.parts.set(mat, list);
  }

  /** 盒子：中心 (x,y,z)，rotY 为 three 的 rotation.y（度）。 */
  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0, rotX = 0, rotZ = 0): void {
    const g = new THREE.BoxGeometry(w, h, d);
    _q.setFromEuler(_e.set(rotX * THREE.MathUtils.DEG2RAD, rotY * THREE.MathUtils.DEG2RAD, rotZ * THREE.MathUtils.DEG2RAD));
    this.add(g, mat, _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1)));
  }

  /** 竖直圆柱。 */
  cyl(mat: THREE.Material, rTop: number, rBot: number, h: number, x: number, y: number, z: number, seg = 10, rotX = 0, rotZ = 0): void {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
    _q.setFromEuler(_e.set(rotX * THREE.MathUtils.DEG2RAD, 0, rotZ * THREE.MathUtils.DEG2RAD));
    this.add(g, mat, _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1)));
  }

  /** 两点之间的细杆（栏杆、扶手、线槽）。 */
  rod(mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6, square = false): void {
    const len = a.distanceTo(b);
    const g = square ? new THREE.BoxGeometry(r * 2, len, r * 2) : new THREE.CylinderGeometry(r, r, len, seg);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    this.add(g, mat, _m.compose(_p.copy(a).add(b).multiplyScalar(0.5), _q, _s.set(1, 1, 1)));
  }

  /**
   * 竖直墙面四边形：从 a 到 b（XZ），y0–y1；法线 = (b−a) × 上 = (−dz, 0, dx)（a→b 朝 +x 时法线朝 +z）。
   * UV：u = 沿墙米数 / uMeters（+ uOffset），v = (y − floorY) / vMeters（dado 墙裙按 2.8m 一张）。
   */
  wall(mat: THREE.Material, a: XZ, b: XZ, y0: number, y1: number, o?: { floorY?: number; uMeters?: number; vMeters?: number; uOffset?: number }): void {
    const floorY = o?.floorY ?? y0, um = o?.uMeters ?? 2.6, vm = o?.vMeters ?? 2.8, uo = o?.uOffset ?? 0;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const v0 = (y0 - floorY) / vm, v1 = (y1 - floorY) / vm;
    const u0 = uo, u1 = uo + len / um;
    const pos = new Float32Array([
      a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1],
      a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1],
    ]);
    const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
    const nor = new Float32Array(18);
    for (let i = 0; i < 6; i++) { nor[i * 3] = nx; nor[i * 3 + 2] = nz; }
    const uv = new Float32Array([u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.add(g, mat);
  }

  /** 水平面（地面朝上 / 顶棚朝下）：x0..x1, z0..z1 在高度 y；UV 按 uvMeters 米一张。 */
  flat(mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y: number, up: boolean, uvMeters = 1): void {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (x1 - x0) + x0) / uvMeters, (uv.getY(i) * (z1 - z0) + z0) / uvMeters);
    g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    this.add(g, mat);
  }

  /** 贴墙的平面（贴花、招牌）：中心 at，法线朝 yaw 方向的水平面（normal = 'x+'|'x-'|'z+'|'z-'），UV 取 atlas 的子矩形。 */
  decal(mat: THREE.Material, w: number, h: number, x: number, y: number, z: number, normal: 'x+' | 'x-' | 'z+' | 'z-',
    rect: readonly [number, number, number, number] = [0, 0, 1, 1], tiltDeg = 0): void {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, rect[0] + uv.getX(i) * (rect[2] - rect[0]), rect[1] + uv.getY(i) * (rect[3] - rect[1]));
    if (tiltDeg) g.rotateZ(tiltDeg * THREE.MathUtils.DEG2RAD);
    const ry = normal === 'z+' ? 0 : normal === 'z-' ? Math.PI : normal === 'x+' ? Math.PI / 2 : -Math.PI / 2;
    g.rotateY(ry);
    g.translate(x, y, z);
    this.add(g, mat);
  }

  /** 水平贴花（顶棚水渍朝下 up=false / 地面污渍朝上）：UV 取 atlas 的子矩形。 */
  decalFlat(mat: THREE.Material, w: number, d: number, x: number, y: number, z: number, up: boolean,
    rect: readonly [number, number, number, number] = [0, 0, 1, 1]): void {
    const g = new THREE.PlaneGeometry(w, d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, rect[0] + uv.getX(i) * (rect[2] - rect[0]), rect[1] + uv.getY(i) * (rect[3] - rect[1]));
    g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
    g.translate(x, y, z);
    this.add(g, mat);
  }

  /** 合并并挂到 parent：每种材质一个网格。 */
  flush(parent: THREE.Object3D, name: string): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const m = new THREE.Mesh(merged, mat);
      m.name = `${name}.${mat.name || 'mat'}`;
      if ((mat as THREE.MeshStandardMaterial).transparent) {
        m.renderOrder = 1;
        m.userData.noOcclude = true;
      }
      parent.add(m);
      out.push(m);
    }
    this.parts.clear();
    return out;
  }
}

/**
 * 楼梯跑段（实心踏步 + 斜底板，看得见的楼梯底面是斜的，不是一整块）：从 (x0..x1, y, z) 起，往 dir（-1 北 / +1 南）爬 steps 级。
 * 返回顶端的 z。
 */
export function flight(b: Batch, stepMat: THREE.Material, soffitMat: THREE.Material, noseMat: THREE.Material,
  x0: number, x1: number, y: number, z: number, dir: -1 | 1, steps: number, rise: number, run: number): number {
  const w = x1 - x0, cx = (x0 + x1) / 2;
  for (let i = 0; i < steps; i++) {
    const top = y + (i + 1) * rise;
    const zc = z + dir * (i + 0.5) * run;
    // 每级是踏面下 0.22m 厚的一块（叠起来是锯齿，底下用斜板收住）
    b.box(stepMat, w, 0.22, run, cx, top - 0.11, zc);
    b.box(noseMat, w, 0.018, 0.035, cx, top - 0.004, z + dir * i * run + dir * 0.0175);
  }
  // 斜底板
  const len = Math.hypot(steps * run, steps * rise);
  const ang = Math.atan2(steps * rise, steps * run);
  const mid = new THREE.Vector3(cx, y + (steps * rise) / 2 - 0.2, z + (dir * steps * run) / 2);
  const g = new THREE.BoxGeometry(w, 0.1, len);
  _q.setFromEuler(_e.set(dir < 0 ? ang : -ang, 0, 0));
  b.add(g, soffitMat, _m.compose(mid, _q, _s.set(1, 1, 1)));
  return z + dir * steps * run;
}
