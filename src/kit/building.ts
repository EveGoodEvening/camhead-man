// owner: WP2
// 楼体（ARCH §10.2）：只建看得见的立面；窗户实例化。
//
// 全部几何按世界坐标建（group 不带变换）：墙面是平面（外法线朝外，UV 按米数平铺），楼层线、勒脚、女儿墙压顶、
// 阳台各合成一个网格；所有立面的窗户合成一个 InstancedMesh（一次 draw call）。门（doors）建成 DoorRig 挂进 group，
// 也放在 group.userData.doors 里（区域要给门登记碰撞体/交互时从那里拿）。碰撞体只给一个楼体整盒。

import * as THREE from 'three';
import type { V3 } from '../core/types';
import { MATERIALS } from '../fx/materials';
import { PAINT } from './canvas';
import { door, type DoorRig, type DoorSpec } from './doors';
import { merge } from './geom';
import { PROPS } from './props';
import { rng, range } from './rng';
import { windowMesh, windowTransforms, type WindowSpec } from './windows';

export interface BuildingSpec {
  /** floorH 默认 2.8 */
  x0: number; x1: number; z0: number; z1: number; floors: number; floorH?: number;
  facade: 'brick' | 'plaster' | 'tile';
  windows?: WindowSpec; doors?: DoorSpec[]; balconies?: boolean; clothesLines?: number;
  roof?: 'flat' | 'parapet'; marks?: ('demolition' | 'posters')[]; seed?: number;
  /** 只建看得见的立面 */
  faces?: ('n' | 's' | 'e' | 'w')[];
}

type Face = 'n' | 's' | 'e' | 'w';

/** 立面几何：从楼外看过去的左端 a、右端 b（XZ）与外法线。 */
function faceFrame(s: BuildingSpec, f: Face): { a: THREE.Vector3; b: THREE.Vector3; n: THREE.Vector3 } {
  switch (f) {
    case 'n': return { a: new THREE.Vector3(s.x1, 0, s.z0), b: new THREE.Vector3(s.x0, 0, s.z0), n: new THREE.Vector3(0, 0, -1) };
    case 's': return { a: new THREE.Vector3(s.x0, 0, s.z1), b: new THREE.Vector3(s.x1, 0, s.z1), n: new THREE.Vector3(0, 0, 1) };
    case 'e': return { a: new THREE.Vector3(s.x1, 0, s.z1), b: new THREE.Vector3(s.x1, 0, s.z0), n: new THREE.Vector3(1, 0, 0) };
    case 'w': return { a: new THREE.Vector3(s.x0, 0, s.z0), b: new THREE.Vector3(s.x0, 0, s.z1), n: new THREE.Vector3(-1, 0, 0) };
  }
}

/** 贴图一格对应的米数（按立面材质） */
const TILE_M = { brick: 1.2, plaster: 3, tile: 1.6 } as const;

/** 一块竖直的矩形：左下角 a、沿 right 长 len、高 h，法线 n；UV 按 tileM 米一格。 */
function wallQuad(a: THREE.Vector3, right: THREE.Vector3, n: THREE.Vector3, len: number, y0: number, h: number, tileM: number, offset = 0): THREE.Mesh {
  const g = new THREE.PlaneGeometry(len, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / tileM, (y0 + uv.getY(i) * h) / tileM);
  const m = new THREE.Mesh(g);
  const basis = new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), n);
  m.quaternion.setFromRotationMatrix(basis);
  m.position.copy(a).addScaledVector(right, len / 2).addScaledVector(n, offset);
  m.position.y = y0 + h / 2;
  return m;
}

function bar(a: THREE.Vector3, right: THREE.Vector3, n: THREE.Vector3, len: number, y: number, h: number, depth: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, depth));
  const basis = new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), n);
  m.quaternion.setFromRotationMatrix(basis);
  m.position.copy(a).addScaledVector(right, len / 2).addScaledVector(n, depth / 2 - 0.02);
  m.position.y = y;
  return m;
}

export function building(s: BuildingSpec): { group: THREE.Group; colliders: { center: V3; size: V3 }[]; windows: THREE.InstancedMesh } {
  const fh = s.floorH ?? 2.8;
  const H = s.floors * fh;
  const parapet = s.roof === 'parapet' ? 0.8 : 0;
  const faces = s.faces ?? ['n', 's', 'e', 'w'];
  const r = rng(s.seed ?? 1);
  const group = new THREE.Group();
  group.name = 'building';
  const facadeMat = s.facade === 'brick' ? MATERIALS.brick() : s.facade === 'plaster' ? MATERIALS.plaster() : MATERIALS.tileWhite();
  const concrete = MATERIALS.concrete();
  const walls: THREE.Mesh[] = [], trims: THREE.Mesh[] = [], balc: THREE.Mesh[] = [];
  const winXf: THREE.Matrix4[] = [];
  const doors: DoorRig[] = (s.doors ?? []).map(d => door(d));
  const doorAt = s.doors ?? [];
  let balconyFace: Face | null = null;
  if (s.balconies) balconyFace = faces.includes('s') ? 's' : faces[0] ?? null;
  const balconySpots: THREE.Vector3[] = [];

  for (const f of faces) {
    const { a, b, n } = faceFrame(s, f);
    const right = b.clone().sub(a);
    const len = right.length();
    right.normalize();
    walls.push(wallQuad(a, right, n, len, 0, H + parapet, TILE_M[s.facade]));
    // 勒脚、楼层线
    trims.push(bar(a, right, n, len, 0.25, 0.5, 0.06));
    for (let i = 1; i < s.floors; i++) trims.push(bar(a, right, n, len, i * fh, 0.12, 0.1));
    if (parapet) trims.push(bar(a, right, n, len, H + parapet + 0.04, 0.08, 0.14));
    else trims.push(bar(a, right, n, len, H + 0.05, 0.1, 0.12));
    // 窗
    if (s.windows) {
      const ws = s.windows;
      const cols = Math.max(0, Math.floor((len - 1.2) / ws.spacing) + 1);
      if (cols > 0) {
        const span = (cols - 1) * ws.spacing;
        const start = a.clone().addScaledVector(right, (len - span) / 2);
        const origin: V3 = [start.x, 1.55, start.z];
        const up: V3 = [0, fh, 0];
        const doorCols = new Set<number>();
        for (const d of doorAt) {
          for (let c = 0; c < cols; c++) {
            const cx = start.x + right.x * c * ws.spacing, cz = start.z + right.z * c * ws.spacing;
            if (Math.hypot(cx - d.at[0], cz - d.at[2]) < (d.w + ws.w) / 2 + 0.2 && Math.abs(d.at[1]) < 0.5) doorCols.add(c);
          }
        }
        winXf.push(...windowTransforms({ origin, right: [right.x, right.y, right.z], up, cols, rows: s.floors }, ws, (c, row) => row === 0 && doorCols.has(c)));
        if (f === balconyFace) {
          for (let row = 1; row < s.floors; row++) {
            for (let c = 0; c < cols; c += 2) {
              const p = start.clone().addScaledVector(right, c * ws.spacing);
              p.y = row * fh;
              const slab = bar(p.clone().addScaledVector(right, -0.75), right, n, 1.5, p.y + 0.05, 0.1, 1.0);
              const rail = bar(p.clone().addScaledVector(right, -0.75).addScaledVector(n, 0.9), right, n, 1.5, p.y + 0.55, 0.9, 0.08);
              balc.push(slab, rail);
              balconySpots.push(p.clone().addScaledVector(n, 0.55).setY(p.y + 1.7));
            }
          }
        }
      }
    }
  }
  if (walls.length) {
    const wm = merge(walls, facadeMat);
    wm.name = 'facade';
    group.add(wm);
    for (const w of walls) w.geometry.dispose();
  }
  if (trims.length) {
    const tm = merge(trims, concrete);
    tm.name = 'trims';
    group.add(tm);
    for (const t of trims) t.geometry.dispose();
  }
  if (balc.length) {
    const bm = merge(balc, MATERIALS.plaster());
    bm.name = 'balconies';
    group.add(bm);
    for (const t of balc) t.geometry.dispose();
  }
  // 屋顶
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(s.x1 - s.x0, s.z1 - s.z0).rotateX(-Math.PI / 2), concrete);
  roof.position.set((s.x0 + s.x1) / 2, H + 0.01, (s.z0 + s.z1) / 2);
  roof.name = 'roof';
  group.add(roof);

  const windows = windowMesh(winXf, s.windows ?? { w: 1.2, h: 1.4, spacing: 3 }, s.seed ?? 1);
  group.add(windows);
  for (const d of doors) group.add(d.group);
  group.userData.doors = doors;

  // 晾衣：挂在阳台外沿
  for (let i = 0; i < (s.clothesLines ?? 0) && balconySpots.length; i++) {
    const spot = balconySpots[Math.floor(r() * balconySpots.length)] ?? balconySpots[0]!;
    const line = PROPS.clothesLine(1.3, (s.seed ?? 1) * 31 + i);
    const f = faceFrame(s, balconyFace ?? 's');
    const right = f.b.clone().sub(f.a).normalize();
    line.position.copy(spot).addScaledVector(right, -0.65);
    line.rotation.y = Math.atan2(-right.z, right.x);
    group.add(line);
  }
  // 标记：红圈“拆”、小广告
  for (const mk of s.marks ?? []) {
    const f = faces[Math.floor(r() * faces.length)] ?? 's';
    const { a, b, n } = faceFrame(s, f);
    const right = b.clone().sub(a);
    const len = right.length();
    right.normalize();
    const size = mk === 'demolition' ? 2.2 : 1.4;
    const tex = mk === 'demolition' ? PAINT.demolitionMark() : PAINT.posters({ lines: ['开锁', '通下水道', '回收旧家电', '办证'], seed: (s.seed ?? 1) + 7 });
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.9 }));
    decal.name = mk === 'demolition' ? 'demolitionMark' : 'posters';
    decal.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), n));
    decal.position.copy(a).addScaledVector(right, range(r, 0.2, 0.8) * len).addScaledVector(n, 0.03);
    decal.position.y = mk === 'demolition' ? range(r, 1.6, 2.4) : 1.1;
    decal.renderOrder = 1;
    group.add(decal);
  }

  const colliders = [{ center: [(s.x0 + s.x1) / 2, (H + parapet) / 2, (s.z0 + s.z1) / 2] as V3, size: [s.x1 - s.x0, H + parapet, s.z1 - s.z0] as V3 }];
  return { group, colliders, windows };
}
