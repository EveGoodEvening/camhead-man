// owner: WP2
// 基础网格快捷函数与合并（ARCH §10.2）。
// 约定：`at` 是网格中心的位置；`rotYDeg` 与 `rot` 都是 three 的欧拉角（rotation.y 的度数，俯视逆时针为正），**不是** yaw
// （yaw 与 rotation.y 的换算见 ARCH §1.3：rotation.y = -yaw）。
// 另有几条 WP2 内部共用的小工具（kitMat、newMat、taperedBox、rod、placeYaw、mergeByMaterial 等）也从这里导出，不属于冻结签名。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { V3 } from '../core/types';
import { DEG2RAD } from '../core/math';

export function box(w: number, h: number, d: number, mat: THREE.Material, at?: V3, rotYDeg?: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  if (at) m.position.set(at[0], at[1], at[2]);
  if (rotYDeg) m.rotation.y = rotYDeg * DEG2RAD;
  return m;
}

/** 平面（默认法线 +z）；rot 为欧拉角（度，XYZ）。 */
export function plane(w: number, h: number, mat: THREE.Material, at?: V3, rot?: V3): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  if (at) m.position.set(at[0], at[1], at[2]);
  if (rot) m.rotation.set(rot[0] * DEG2RAD, rot[1] * DEG2RAD, rot[2] * DEG2RAD);
  return m;
}

/** 竖直圆柱，at 为中心。 */
export function cyl(rTop: number, rBot: number, h: number, mat: THREE.Material, at?: V3, seg?: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg ?? 16), mat);
  if (at) m.position.set(at[0], at[1], at[2]);
  return m;
}

/**
 * 同材质静态网格合并（mergeGeometries）：按各网格的世界矩阵（先 updateWorldMatrix）烘焙；
 * 属性集合不一致时统一成 position/normal/uv，索引与非索引混用时统一转非索引（ARCH §16 #22）。
 * 结果网格位于原点；mat 缺省用第一个网格的材质。
 */
export function merge(meshes: readonly THREE.Mesh[], mat?: THREE.Material): THREE.Mesh {
  if (meshes.length === 0) return new THREE.Mesh(new THREE.BufferGeometry(), mat);
  const geos: THREE.BufferGeometry[] = [];
  const anyNonIndexed = meshes.some(m => !m.geometry.index);
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    let g = m.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      const n = g.attributes.position?.count ?? 0;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    if (anyNonIndexed && g.index) g = g.toNonIndexed();
    g.applyMatrix4(m.matrixWorld);
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  const firstMat = meshes[0]?.material;
  const useMat = mat ?? (Array.isArray(firstMat) ? firstMat[0] : firstMat);
  const out = new THREE.Mesh(merged ?? new THREE.BufferGeometry(), useMat);
  out.name = 'merged';
  return out;
}

// ---------------------------------------------------------------- WP2 内部工具

export interface KitMatOpts {
  color?: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  map?: THREE.Texture | null;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  emissiveMap?: THREE.Texture | null;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  envMapIntensity?: number;
  depthWrite?: boolean;
  /** 红外温度（写 material.userData.tempC） */
  tempC?: number;
  flatShading?: boolean;
  alphaTest?: number;
  vertexColors?: boolean;
}

const kitMatCache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * kit/rigs 内部的缓存材质（MATERIALS 没有的专用色/质感：邮筒绿、搪瓷缸、镜头玻璃……）。
 * 同 key 同实例；区域卸载时 Disposer 可能 dispose 它们，three 会在下次使用时重新上传，缓存仍然有效。
 * 需要逐实例改透明度/颜色的（人物淡出）不要用它，自己 new。
 */
export function kitMat(key: string, o: KitMatOpts): THREE.MeshStandardMaterial {
  const hit = kitMatCache.get(key);
  if (hit) return hit;
  const m = newMat(o);
  m.name = `kit.${key}`;
  kitMatCache.set(key, m);
  return m;
}

/** 新建（不缓存）的 MeshStandardMaterial，参数同 kitMat。 */
export function newMat(o: KitMatOpts): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: o.color ?? 0xffffff,
    roughness: o.roughness ?? 0.8,
    metalness: o.metalness ?? 0,
    map: o.map ?? null,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    emissiveMap: o.emissiveMap ?? null,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
    flatShading: o.flatShading ?? false,
    alphaTest: o.alphaTest ?? 0,
    vertexColors: o.vertexColors ?? false,
  });
  if (o.envMapIntensity !== undefined) m.envMapIntensity = o.envMapIntensity;
  if (o.depthWrite !== undefined) m.depthWrite = o.depthWrite;
  if (o.tempC !== undefined) m.userData.tempC = o.tempC;
  return m;
}

/**
 * 截头方盒（上下宽深不同）：躯干、柜子、灯罩用。原点在底面中心，高 h。
 */
export function taperedBox(wBot: number, dBot: number, wTop: number, dTop: number, h: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, h, 1, 1, 1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const top = y > 0;
    p.setX(i, p.getX(i) * (top ? wTop : wBot));
    p.setZ(i, p.getZ(i) * (top ? dTop : dBot));
    p.setY(i, y + h / 2);
  }
  g.computeVertexNormals();
  return g;
}

/** 两点之间的圆柱（杆、腿、电线段）。 */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, seg = 8): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/** 按 yaw（度，ARCH §1.3）摆放对象：position = at，rotation.y = -yaw。 */
export function placeYaw<T extends THREE.Object3D>(obj: T, at: V3, yaw: number): T {
  obj.position.set(at[0], at[1], at[2]);
  obj.rotation.y = -yaw * DEG2RAD;
  return obj;
}

/** 递归设 castShadow/receiveShadow（默认全关：角色一律 blobShadow，ARCH §13.1）。 */
export function setShadows(obj: THREE.Object3D, cast: boolean, receive: boolean): void {
  obj.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = cast;
      m.receiveShadow = receive;
    }
  });
}

/** 递归写 userData（irHide、auxHide、noOcclude、tempC……）。 */
export function tagTree(obj: THREE.Object3D, data: Record<string, unknown>): void {
  obj.traverse(o => Object.assign(o.userData, data));
}

/** 把子树里全部网格按材质合并（同材质一份 draw call），返回新的 Group；原子树不再使用。静态道具用它省 draw call。 */
export function mergeByMaterial(root: THREE.Object3D): THREE.Group {
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.Mesh[]>();
  const keep: THREE.Object3D[] = [];
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) {
      if (m.isMesh) keep.push(m);
      return;
    }
    const list = buckets.get(m.material) ?? [];
    list.push(m);
    buckets.set(m.material, list);
  });
  const out = new THREE.Group();
  out.name = root.name;
  for (const [mat, list] of buckets) {
    const merged = merge(list, mat);
    merged.geometry.applyMatrix4(inv);
    merged.userData = { ...(list[0]?.userData ?? {}) };
    out.add(merged);
  }
  for (const k of keep) {
    const clone = k.clone();
    k.updateWorldMatrix(true, false);
    clone.matrix.copy(inv).multiply(k.matrixWorld);
    clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
    out.add(clone);
  }
  out.position.copy(root.position);
  out.quaternion.copy(root.quaternion);
  out.scale.copy(root.scale);
  return out;
}
