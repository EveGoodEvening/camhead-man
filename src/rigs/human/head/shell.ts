// owner: WP2
// char2 WP-H：贴着人头表面的一块贴片（PLAN §3.1“Patches”）：R1 结局录像带里的五官、老周的笑脸用它，代替原来写死的球面。
// 经纬参数与 three 的 SphereGeometry 相同（lon = phi：1.5π 是正前 -z；lat = theta：0 在头顶），UV 在所给范围里 0..1
// （v = 1 在 lat0），所以原来按球面画的贴图版式照样能用。每个格点从 centre 沿该方向打到头网格上（含鼻子），沿插值法线往外偏 offset。

import * as THREE from 'three';

export interface HeadShellOpts {
  /** 经度（SphereGeometry 的 phi）范围 [起, 止] */
  lon: readonly [number, number];
  /** 纬度（theta，0 = 头顶）范围 [起, 止] */
  lat: readonly [number, number];
  /** 沿表面法线往外偏（米），缺省 0.003 */
  offset?: number;
  /** 射线起点（头网格局部），缺省原点 */
  centre?: readonly [number, number, number];
  /** 分段，缺省 16 × 12 */
  segments?: readonly [number, number];
}

/** 找到人偶的头网格：target 本身叫 'head'，或它下面名为 'head' 的网格。 */
function findHead(target: THREE.Object3D | { root: THREE.Object3D }): THREE.Mesh | null {
  const o = (target as { root?: THREE.Object3D }).root ?? (target as THREE.Object3D);
  const m = (o.name === 'head' ? o : o.getObjectByName('head')) as THREE.Mesh | undefined;
  return m && (m as THREE.Mesh).isMesh ? m : null;
}

/**
 * 贴着人头（头网格局部坐标）的一块曲面：挂到头网格下即可（`head.add(new Mesh(headShell(head, …), mat))`）。
 * 头网格找不到时退回半径 0.1 的球面（不抛错）。
 */
export function headShell(target: THREE.Object3D | { root: THREE.Object3D }, o: HeadShellOpts): THREE.BufferGeometry {
  const head = findHead(target);
  const [sx, sy] = o.segments ?? [16, 12];
  const off = o.offset ?? 0.003;
  const c = new THREE.Vector3(...(o.centre ?? [0, 0, 0]));
  const geo = head?.geometry;
  const probe = geo ? new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })) : null;
  probe?.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  const nor = geo?.attributes.normal as THREE.BufferAttribute | undefined;
  const pos: number[] = [], uv: number[] = [];
  const dir = new THREE.Vector3(), n = new THREE.Vector3(), na = new THREE.Vector3(), nb = new THREE.Vector3(), nc = new THREE.Vector3();
  let lastR = 0.1;
  for (let iy = 0; iy <= sy; iy++) {
    const theta = o.lat[0] + (iy / sy) * (o.lat[1] - o.lat[0]);
    for (let ix = 0; ix <= sx; ix++) {
      const phi = o.lon[0] + (ix / sx) * (o.lon[1] - o.lon[0]);
      dir.set(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)).normalize();
      let px: number, py: number, pz: number;
      const hits = probe ? (rc.set(c, dir), rc.intersectObject(probe, false)) : [];
      const h = hits[0];
      if (h && h.face && nor) {
        const bc = h.barycoord ?? new THREE.Vector3(1 / 3, 1 / 3, 1 / 3);
        na.fromBufferAttribute(nor, h.face.a);
        nb.fromBufferAttribute(nor, h.face.b);
        nc.fromBufferAttribute(nor, h.face.c);
        n.set(0, 0, 0).addScaledVector(na, bc.x).addScaledVector(nb, bc.y).addScaledVector(nc, bc.z).normalize();
        if (n.dot(dir) < 0) n.negate();
        px = h.point.x + n.x * off; py = h.point.y + n.y * off; pz = h.point.z + n.z * off;
        lastR = h.distance;
      } else {
        px = c.x + dir.x * (lastR + off); py = c.y + dir.y * (lastR + off); pz = c.z + dir.z * (lastR + off);
      }
      pos.push(px, py, pz);
      uv.push(ix / sx, 1 - iy / sy);
    }
  }
  (probe?.material as THREE.Material | undefined)?.dispose();
  const idx: number[] = [];
  for (let iy = 0; iy < sy; iy++) {
    for (let ix = 0; ix < sx; ix++) {
      const a = iy * (sx + 1) + ix + 1, b = iy * (sx + 1) + ix, cc = (iy + 1) * (sx + 1) + ix, d = (iy + 1) * (sx + 1) + ix + 1;
      idx.push(a, b, d, b, cc, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
