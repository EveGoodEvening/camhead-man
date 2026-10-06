// owner: WP2
// 实例化散布（ARCH §10.2）。

import * as THREE from 'three';
import type { V3 } from '../core/types';
import { DEG2RAD } from '../core/math';

/**
 * 按变换表放一批相同的几何（一次 draw call）。rotY 为绕 y 的欧拉角（度，three 约定，俯视逆时针为正——不是 yaw）；
 * scale 为统一缩放或三轴缩放；colors 给了就写 instanceColor（红外下由 IrRenderer 暂时置空，ARCH §6.8.2）。
 * 内部调用 computeBoundingSphere()（ARCH §16 #13）。
 */
export function scatter(
  geo: THREE.BufferGeometry, mat: THREE.Material,
  xf: readonly { pos: V3; rotY?: number; scale?: V3 | number }[], colors?: readonly THREE.ColorRepresentation[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, xf.length));
  mesh.name = 'scatter';
  mesh.count = xf.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  xf.forEach((t, i) => {
    p.set(t.pos[0], t.pos[1], t.pos[2]);
    q.setFromEuler(e.set(0, (t.rotY ?? 0) * DEG2RAD, 0));
    if (Array.isArray(t.scale)) s.set(t.scale[0] ?? 1, t.scale[1] ?? 1, t.scale[2] ?? 1);
    else s.setScalar(typeof t.scale === 'number' ? t.scale : 1);
    mesh.setMatrixAt(i, m.compose(p, q, s));
    const col = colors?.[i % Math.max(1, colors.length)];
    if (col !== undefined) mesh.setColorAt(i, c.set(col));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  return mesh;
}
