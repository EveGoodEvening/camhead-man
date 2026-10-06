// owner: R3
// R3 私有的建造小工具：按材质合并静态网格（省 draw call，ARCH §13.3）、贴花、文字贴图材质。

import * as THREE from 'three';
import type { AreaAddOptions, AreaContext } from '../../../core/area';
import type { V3 } from '../../../core/types';
import { DEG2RAD } from '../../../core/math';
import { merge } from '../../../kit/geom';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paintTexture } from '../../../kit/canvas';
import { isSharedMaterial } from '../../../fx/materials';

/**
 * 静态网格按材质合并：add 进来的网格（或 box/cyl/plane 快捷写法）在 flush 时按材质合成一个网格再 ctx.add。
 * 网格的世界矩阵按它自己的 position/rotation/scale 算（没有父节点）；需要挂父节点的请先摆好再 add。
 */
export class Batch {
  private readonly lists = new Map<THREE.Material, THREE.Mesh[]>();
  /** 色板件：UV 全部指到色板贴图的某一格，合并成一个网格（小道具不用各自开材质，省 draw call） */
  private readonly swatches: { mesh: THREE.Mesh; color: string; glossy: boolean | 'metal' }[] = [];
  constructor(readonly name: string) {}

  add(m: THREE.Mesh): THREE.Mesh {
    const mat = m.material as THREE.Material;
    let l = this.lists.get(mat);
    if (!l) {
      l = [];
      this.lists.set(mat, l);
    }
    l.push(m);
    return m;
  }
  /** 盒子：at = 中心；rotY 为 three 的 rotation.y（度）。 */
  box(mat: THREE.Material, w: number, h: number, d: number, at: V3, rotY = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(at[0], at[1], at[2]);
    if (rotY) m.rotation.y = rotY * DEG2RAD;
    return this.add(m);
  }
  /** 由两个角点给出的轴对齐盒子。 */
  aabb(mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.Mesh {
    return this.box(mat, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
  }
  cyl(mat: THREE.Material, rTop: number, rBot: number, h: number, at: V3, seg = 12): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
    m.position.set(at[0], at[1], at[2]);
    return this.add(m);
  }
  /** 平面（法线默认 +z），rotY 为 three 的 rotation.y（度）。 */
  plane(mat: THREE.Material, w: number, h: number, at: V3, rotY = 0, rotX = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(at[0], at[1], at[2]);
    m.rotation.set(rotX * DEG2RAD, rotY * DEG2RAD, 0, 'YXZ');
    return this.add(m);
  }
  /** 从 a 到 b 的细杆。 */
  rod(mat: THREE.Material, a: V3, b: V3, r: number, seg = 6): THREE.Mesh {
    return this.add(rodMesh(mat, a, b, r, seg));
  }
  // —— 色板件（纯色小道具）
  sbox(color: string, w: number, h: number, d: number, at: V3, rotY = 0, glossy = false): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
    m.position.set(at[0], at[1], at[2]);
    if (rotY) m.rotation.y = rotY * DEG2RAD;
    this.swatches.push({ mesh: m, color, glossy });
    return m;
  }
  saabb(color: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, glossy = false): THREE.Mesh {
    return this.sbox(color, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], 0, glossy);
  }
  scyl(color: string, rTop: number, rBot: number, h: number, at: V3, seg = 12, glossy = false): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg));
    m.position.set(at[0], at[1], at[2]);
    this.swatches.push({ mesh: m, color, glossy });
    return m;
  }
  srod(color: string, a: V3, b: V3, r: number, seg = 6, glossy = false): THREE.Mesh {
    const m = rodMesh(null, a, b, r, seg);
    this.swatches.push({ mesh: m, color, glossy });
    return m;
  }
  /** 任意几何的色板件（已经摆好 position/rotation）。 */
  sgeo(color: string, m: THREE.Mesh, glossy = false): THREE.Mesh {
    this.swatches.push({ mesh: m, color, glossy });
    return m;
  }
  /** 合并后挂进场景；返回合成的网格（按材质）。 */
  flush(ctx: AreaContext, o?: AreaAddOptions): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    // 纯色材质（没有贴图、不透明、单面、不发光）的网格也并进色板：一类质感一个 draw call
    for (const [mat, list] of [...this.lists]) {
      const m = mat as THREE.MeshStandardMaterial;
      if (!m.isMeshStandardMaterial || m.map || m.transparent || m.side !== THREE.FrontSide || m.emissiveIntensity * (m.emissive.r + m.emissive.g + m.emissive.b) > 0) continue;
      if (m.userData.tempC !== undefined && m.userData.tempC !== 18) continue;
      const kind: boolean | 'metal' = m.metalness >= 0.5 ? 'metal' : m.roughness < 0.5 ? true : false;
      for (const mesh of list) this.swatches.push({ mesh, color: `#${m.color.getHexString()}`, glossy: kind });
      this.lists.delete(mat);
    }
    // 色板：每种颜色一格（1×N 的小贴图），网格的 UV 全部指到格子中心
    if (this.swatches.length) {
      const colors = [...new Set(this.swatches.map(s => s.color))];
      const N = Math.max(1, colors.length);
      const tex = ctx.track(paintTexture(N * 4, 4, g => {
        colors.forEach((c, i) => {
          g.fillStyle = c;
          g.fillRect(i * 4, 0, 4, 4);
        });
      }));
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      for (const glossy of [false, true, 'metal'] as const) {
        const list = this.swatches.filter(s => s.glossy === glossy);
        if (!list.length) continue;
        const mat = new THREE.MeshStandardMaterial({
          map: tex, roughness: glossy === 'metal' ? 0.45 : glossy ? 0.3 : 0.8, metalness: glossy === 'metal' ? 0.6 : glossy ? 0.15 : 0,
        });
        mat.name = glossy === 'metal' ? 'r3.swatchMetal' : glossy ? 'r3.swatchGloss' : 'r3:swatch';
        for (const s of list) {
          const u = (colors.indexOf(s.color) + 0.5) / N;
          const uv = s.mesh.geometry.attributes.uv as THREE.BufferAttribute;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, u, 0.5);
          s.mesh.material = mat;
          this.add(s.mesh);
        }
      }
      this.swatches.length = 0;
    }
    for (const [mat, list] of this.lists) {
      if (list.length === 0) continue;
      const m = list.length === 1 && !list[0]!.parent ? list[0]! : merge(list, mat);
      if (m !== list[0]) for (const src of list) src.geometry.dispose();
      m.name = `${this.name}.${mat.name || 'mat'}`;
      out.push(ctx.add(m, o));
    }
    this.lists.clear();
    return out;
  }
}

function rodMesh(mat: THREE.Material | null, a: V3, b: V3, r: number, seg: number): THREE.Mesh {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const m = mat ? new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat) : new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg));
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return m;
}

/** 贴图材质（颜色贴图 SRGB）；roughness 默认 0.85。 */
export function paintedMat(
  ctx: AreaContext, w: number, h: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  o?: { roughness?: number; metalness?: number; transparent?: boolean; alphaTest?: number; side?: THREE.Side; emissive?: number; basic?: boolean; name?: string },
): THREE.MeshStandardMaterial | THREE.MeshBasicMaterial {
  const tex = ctx.track(paintTexture(w, h, paint));
  if (o?.basic) {
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: o.transparent ?? false, alphaTest: o.alphaTest ?? 0, side: o.side ?? THREE.FrontSide });
    if (o.transparent) m.depthWrite = false;
    m.name = o.name ?? 'r3:painted';
    return m;
  }
  const m = new THREE.MeshStandardMaterial({
    map: tex, roughness: o?.roughness ?? 0.85, metalness: o?.metalness ?? 0, transparent: o?.transparent ?? false,
    alphaTest: o?.alphaTest ?? 0, side: o?.side ?? THREE.FrontSide,
  });
  if (o?.emissive) {
    m.emissive.set(0xffffff);
    m.emissiveMap = tex;
    m.emissiveIntensity = o.emissive;
  }
  if (o?.transparent) {
    m.depthWrite = false;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
  }
  m.name = o?.name ?? 'r3:painted';
  return m;
}

/** 透明贴花（小广告、粉笔字、水渍）：不挡准星与拍照（noOcclude）。 */
export function decal(ctx: AreaContext, tex: THREE.Texture, w: number, h: number, at: V3, rotYDeg: number, o?: { rough?: number; emissive?: number }): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false, roughness: o?.rough ?? 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  if (o?.emissive) {
    mat.emissive.set(0xffffff);
    mat.emissiveMap = tex;
    mat.emissiveIntensity = o.emissive;
  }
  mat.name = 'r3:decal';
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(at[0], at[1], at[2]);
  m.rotation.y = rotYDeg * DEG2RAD;
  m.renderOrder = 1;
  m.userData.noOcclude = true;
  return ctx.add(m, { occlude: false });
}

/** 画布上的小工具：圆角矩形路径。 */
export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** 平面朝向：法线指向 yaw（度；0 北、90 东、180 南、270 西）时的 rotation.y（度）。 */
export function faceYawDeg(yaw: number): number {
  return 180 - yaw;
}

/**
 * 把一个已经摆好的组里“同材质的静态子网格”按世界坐标合并，挂到区域 root（省 draw call）；keep 返回 true 的留在组里。
 * 用于 kit 的灯杆、自行车、公交站这类由多件同材质零件拼成的道具（它们自己没合并）。
 */
export function flattenStatics(ctx: AreaContext, group: THREE.Object3D, keep: (m: THREE.Mesh) => boolean = () => false): void {
  group.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.Mesh[]>();
  group.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material) || keep(m)) return;
    if (m.onBeforeRender !== THREE.Mesh.prototype.onBeforeRender) return;   // 带逐帧回调的（灯罩同步光源、湿地光带）不动
    const l = byMat.get(m.material) ?? [];
    l.push(m);
    byMat.set(m.material, l);
  });
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const merged = merge(list, mat);
    merged.name = `${group.name}.flat`;
    for (const m of list) {
      m.parent?.remove(m);
      m.geometry.dispose();
    }
    ctx.add(merged);
  }
}

/** 多段电线合成一个 LineSegments（每段一条下垂的弧线）。 */
export function wireBundle(spans: readonly { a: V3; b: V3; sag: number }[], n = 12): THREE.LineSegments {
  const pts: number[] = [];
  for (const { a, b, sag } of spans) {
    const P = (t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
    for (let i = 0; i < n; i++) pts.push(...P(i / n), ...P((i + 1) / n));
  }
  const l = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: '#0d0d0f' }));
  l.name = 'r3:wires';
  l.userData.noOcclude = true;
  l.raycast = () => {};
  return l;
}

/** 挂到已经 ctx.add 过的组下面的网格：自己追踪几何与（非共享）材质，免得区域卸载时漏释放。 */
export function trackTree(ctx: AreaContext, obj: THREE.Object3D): void {
  obj.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    ctx.track(m.geometry);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) if (!isSharedMaterial(mat)) ctx.track(mat);
  });
}

/**
 * 地上的软接触影（没有投影光的地方给大件“落地”：GDD §9.3 其余物体用圆形假阴影）。
 * 黑色 + 径向 alpha 的贴图直接当 map 用（RGB 为 0，不走 alphaMap 的绿通道），一批椭圆合成一个网格；红外下隐藏。
 */
export function contactShadows(ctx: AreaContext, items: readonly { x: number; z: number; rx: number; rz: number; a?: number; y?: number }[]): THREE.Mesh {
  const tex = ctx.track(paintTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.85)');
    grd.addColorStop(0.45, 'rgba(0,0,0,0.55)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }));
  const geos: THREE.BufferGeometry[] = [];
  for (const it of items) {
    const geo = new THREE.PlaneGeometry(it.rx * 2, it.rz * 2).rotateX(-Math.PI / 2);
    const a = it.a ?? 1;
    const n = geo.attributes.position!.count;
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 3 ? a : 1)), 4));
    geo.translate(it.x, (it.y ?? 0) + 0.006, it.z);
    geos.push(geo);
  }
  const merged = new THREE.Mesh(mergeGeometries(geos) ?? geos[0]!, new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  for (const g of geos) g.dispose();
  (merged.material as THREE.Material).name = 'r3.contactShadow';
  merged.name = 'r3.contactShadows';
  merged.userData.irHide = true;
  merged.userData.noOcclude = true;
  merged.raycast = () => {};
  merged.renderOrder = 1;
  return ctx.add(merged, { occlude: false });
}
