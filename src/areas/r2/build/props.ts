// owner: R2
// R2 的生活痕迹道具（低模，全部写进楼层的合并批里，一件道具不单独占 draw call）：鞋架、腌菜坛、花盆、纸箱、蜂窝煤、
// 童车、三轮车、雨伞、扫帚、门垫、奶箱、电表箱……以及回放片段道具（门神、纸箱、担架、电视）。
// 约定同 kit/props：原点在底面中心，正面朝 -z；摆放用 Batch.at(x, y, z, rotY, fn)。

import * as THREE from 'three';
import type { Batch } from './batch';
import type { R2Mats } from './mats';
import { rng, range } from '../../../kit/rng';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** 木鞋架（两层）+ 几双鞋。 */
export function shoeRack(b: Batch, m: R2Mats, seed: number): void {
  const r = rng(seed);
  b.box(m.darkWood, 0.7, 0.025, 0.28, 0, 0.12, 0);
  b.box(m.darkWood, 0.7, 0.025, 0.28, 0, 0.36, 0);
  b.box(m.darkWood, 0.7, 0.025, 0.28, 0, 0.6, 0);
  for (const x of [-0.34, 0.34]) for (const z of [-0.12, 0.12]) b.box(m.darkWood, 0.03, 0.6, 0.03, x, 0.3, z);
  for (const shelf of [0.14, 0.38, 0.62]) {
    for (let i = 0; i < 3; i++) {
      if (r() < 0.3) continue;
      const x = -0.22 + i * 0.22 + range(r, -0.03, 0.03);
      const mat = r() < 0.5 ? m.shoe : m.shoe2;
      b.box(mat, 0.09, 0.07, 0.24, x - 0.05, shelf + 0.045, 0, range(r, -8, 8));
      b.box(mat, 0.09, 0.07, 0.24, x + 0.05, shelf + 0.045, 0.01, range(r, -8, 8));
    }
  }
  // 地上随手一双拖鞋
  b.box(m.redPlastic, 0.1, 0.03, 0.25, 0.1, 0.015, -0.32, 12);
  b.box(m.redPlastic, 0.1, 0.03, 0.25, 0.24, 0.015, -0.3, -5);
}

/** 腌菜坛（酱色釉陶，带盖与压坛石）。 */
export function pickleJar(b: Batch, m: R2Mats, s = 1): void {
  b.cyl(m.jar, 0.15 * s, 0.12 * s, 0.1 * s, 0, 0.05 * s, 0, 14);
  b.cyl(m.jar, 0.12 * s, 0.17 * s, 0.22 * s, 0, 0.21 * s, 0, 14);
  b.cyl(m.jar, 0.1 * s, 0.12 * s, 0.05 * s, 0, 0.345 * s, 0, 14);
  b.cyl(m.jar, 0.14 * s, 0.14 * s, 0.03 * s, 0, 0.385 * s, 0, 14);
  b.cyl(m.concrete, 0.06 * s, 0.07 * s, 0.05 * s, 0.02, 0.42 * s, 0, 8);
}

/** 花盆（枯了的或还活着的一棵）。 */
export function flowerPot(b: Batch, m: R2Mats, alive: boolean, seed: number): void {
  const r = rng(seed);
  b.cyl(m.clay, 0.15, 0.11, 0.24, 0, 0.12, 0, 12);
  b.cyl(m.soil, 0.14, 0.14, 0.02, 0, 0.23, 0, 12);
  const leaf = alive ? m.leaf : m.leafDead;
  for (let i = 0; i < (alive ? 9 : 5); i++) {
    const a = r() * Math.PI * 2;
    const len = range(r, 0.2, alive ? 0.5 : 0.35);
    b.rod(leaf, V(0, 0.24, 0), V(Math.cos(a) * len * 0.5, 0.24 + len, Math.sin(a) * len * 0.5), 0.012, 4);
    if (alive) b.box(leaf, 0.09, 0.012, 0.05, Math.cos(a) * len * 0.5, 0.24 + len, Math.sin(a) * len * 0.5, (a * 180) / Math.PI, 20);
  }
}

/** 一摞纸箱（捆着的旧纸板）。 */
export function boxes(b: Batch, m: R2Mats, seed: number): void {
  const r = rng(seed);
  let y = 0;
  for (let i = 0; i < 3; i++) {
    const w = range(r, 0.35, 0.55), h = range(r, 0.22, 0.38), d = range(r, 0.3, 0.45);
    b.box(m.cardboard, w, h, d, range(r, -0.05, 0.05), y + h / 2, range(r, -0.05, 0.05), range(r, -12, 12));
    y += h;
  }
  // 压扁的一捆
  b.box(m.cardboard, 0.6, 0.12, 0.5, 0.55, 0.06, 0.05, 8);
  b.box(m.plastic, 0.62, 0.01, 0.02, 0.55, 0.125, 0.05, 8);
}

/** 蜂窝煤一摞（两垛）。 */
export function briquettes(b: Batch, m: R2Mats): void {
  for (const [x, n] of [[0, 7], [0.16, 5]] as const) {
    for (let i = 0; i < n; i++) b.cyl(m.briquette, 0.065, 0.065, 0.078, x, 0.04 + i * 0.08, 0, 10);
  }
}

/** 折起来的旧童车。 */
export function stroller(b: Batch, m: R2Mats): void {
  for (const x of [-0.18, 0.18]) {
    b.rod(m.steel, V(x, 0.08, 0.25), V(x, 0.95, -0.05), 0.012);
    b.rod(m.steel, V(x, 0.08, -0.2), V(x, 0.7, 0.1), 0.012);
    b.cyl(m.rubber, 0.07, 0.07, 0.03, x, 0.07, 0.25, 10, 0, 90);
    b.cyl(m.rubber, 0.07, 0.07, 0.03, x, 0.07, -0.2, 10, 0, 90);
  }
  b.rod(m.steel, V(-0.2, 0.95, -0.05), V(0.2, 0.95, -0.05), 0.014);
  b.box(m.bluePlastic, 0.38, 0.5, 0.06, 0, 0.5, 0.05, 0, 20);
}

/** 儿童三轮车。 */
export function tricycle(b: Batch, m: R2Mats): void {
  b.cyl(m.redPlastic, 0.14, 0.14, 0.04, 0, 0.14, -0.3, 12, 0, 90);
  b.cyl(m.rubber, 0.09, 0.09, 0.03, -0.18, 0.09, 0.15, 10, 0, 90);
  b.cyl(m.rubber, 0.09, 0.09, 0.03, 0.18, 0.09, 0.15, 10, 0, 90);
  b.rod(m.redPlastic, V(0, 0.14, -0.3), V(0, 0.42, 0.05), 0.02);
  b.rod(m.steel, V(-0.18, 0.09, 0.15), V(0.18, 0.09, 0.15), 0.012);
  b.box(m.black, 0.14, 0.04, 0.18, 0, 0.44, 0.08);
  b.rod(m.steel, V(0, 0.42, -0.2), V(0, 0.55, -0.22), 0.012);
  b.rod(m.steel, V(-0.14, 0.55, -0.22), V(0.14, 0.55, -0.22), 0.012);
}

/** 靠墙的长柄雨伞（收着）。 */
export function umbrella(b: Batch, m: R2Mats, lean = 12): void {
  b.at(0, 0, 0, 0, () => {
    const top = V(Math.sin((lean * Math.PI) / 180) * 0.85, 0.85, 0);
    b.rod(m.cloth, V(0, 0.05, 0), top, 0.035, 6);
    b.rod(m.black, V(0, 0, 0), V(0, 0.05, 0), 0.006);
    b.rod(m.darkWood, top, top.clone().add(V(0.03, 0.1, 0)), 0.012);
  });
}

/** 扫帚与簸箕。 */
export function broom(b: Batch, m: R2Mats): void {
  b.rod(m.wood, V(0, 0.28, 0), V(0.18, 1.2, 0.02), 0.013);
  b.box(m.leafDead, 0.24, 0.3, 0.05, 0, 0.15, 0, 0, 0, -10);
  b.box(m.redPlastic, 0.3, 0.02, 0.24, 0.35, 0.01, 0.05, 20);
  b.box(m.redPlastic, 0.3, 0.12, 0.02, 0.35, 0.06, 0.17, 20);
}

/** 白搪瓷痰盂（红边、印一朵花）。 */
export function spittoon(b: Batch, m: R2Mats): void {
  const prof = [[0.001, 0], [0.09, 0], [0.11, 0.03], [0.12, 0.1], [0.1, 0.17], [0.075, 0.2], [0.09, 0.23], [0.13, 0.26], [0.13, 0.275]].map(([x, y]) => new THREE.Vector2(x, y));
  b.add(new THREE.LatheGeometry(prof, 16), m.enamel);
  b.cyl(m.redPlastic, 0.132, 0.132, 0.012, 0, 0.278, 0, 16);
}

/** 门垫。 */
export function doormat(b: Batch, m: R2Mats): void {
  b.box(m.mat, 0.7, 0.012, 0.42, 0, 0.006, 0);
}

/** 墙上的铁皮箱（电表箱、消防栓箱、奶箱）：正面贴图集的 rect（decal 由调用方加）。 */
export function wallBox(b: Batch, mat: THREE.Material, w: number, h: number, d: number): void {
  b.box(mat, w, h, d, 0, 0, 0);
}

/** 声控灯的吸顶座 + 灯头的线 + 墙上的声控开关盒与明线槽（灯泡本身是 kit/lamps 的 hall_bulb）。 */
export function lampFixture(b: Batch, m: R2Mats, x: number, yCeil: number, z: number, wallZ: number): void {
  b.cyl(m.plastic, 0.07, 0.075, 0.025, x, yCeil - 0.0125, z, 16);
  b.cyl(m.black, 0.005, 0.005, 0.07, x, yCeil - 0.06, z, 4);
  // 声控开关盒（顶棚上，灯旁 0.3m）
  b.box(m.plastic, 0.09, 0.035, 0.09, x + 0.32, yCeil - 0.0175, z);
  b.box(m.black, 0.05, 0.004, 0.05, x + 0.32, yCeil - 0.036, z);
  // 明线槽：灯 → 开关盒 → 顶棚 → 墙
  b.box(m.plastic, 0.3, 0.012, 0.022, x + 0.16, yCeil - 0.006, z);
  b.box(m.plastic, 0.022, 0.012, Math.abs(wallZ - z), x + 0.32, yCeil - 0.006, (z + wallZ) / 2);
}

// ==================================================================== 回放片段道具（ReplaySystem 只设 replay 层与 renderOrder，材质由区域负责）

/** 一对门神（2018 贴门神时的片段道具）：原点在门神中心，贴面朝 +x（与现世的 r2.menshen 同形同位）。 */
export function menshenPair(map: THREE.MeshStandardMaterial | THREE.Material, tiltDeg = 8): THREE.Group {
  const g = new THREE.Group();
  g.name = 'menshenPair';
  const make = (u0: number, zOff: number, tilt: number) => {
    const geo = new THREE.PlaneGeometry(0.4, 0.74);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * 0.5);
    const mesh = new THREE.Mesh(geo, map);
    mesh.rotation.set(0, Math.PI / 2, 0);
    mesh.rotateZ((tilt * Math.PI) / 180);
    mesh.position.set(0, 0, zOff);
    g.add(mesh);
    return mesh;
  };
  // 站在门外面朝门（朝西）看：左手边（+z）是尉迟恭（歪约 8°），右手边（-z）是秦琼
  make(0, 0.215, tiltDeg);
  make(0.5, -0.215, 0);
  return g;
}

/** 纸箱（2025 搬家）。 */
export function replayBox(mat: THREE.Material): THREE.Object3D {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.36), mat);
  g.add(m);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.01, 0.07), mat);
  tape.position.y = 0.17;
  g.add(tape);
  return g;
}

/** 担架（2019）：两根杆、帆布、盖着被子的人形隆起；长轴沿局部 z。 */
export function replayStretcher(mat: THREE.Material): THREE.Object3D {
  const g = new THREE.Group();
  for (const x of [-0.28, 0.28]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.3, 6).rotateX(Math.PI / 2), mat);
    pole.position.set(x, 0, 0);
    g.add(pole);
  }
  const canvas = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.02, 1.8), mat);
  g.add(canvas);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.2, 4, 8).rotateX(Math.PI / 2), mat);
  body.scale.set(1, 0.55, 1);
  body.position.y = 0.1;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat);
  head.position.set(0, 0.13, -0.78);
  g.add(head);
  return g;
}

/** 黑白小电视 + 方凳（2008 看开幕式）：屏幕朝 +x（人群在它东边朝西看）。 */
export function replayTv(mat: THREE.Material, screen: THREE.Material): THREE.Object3D {
  const g = new THREE.Group();
  const stool = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.4), mat);
  stool.position.y = 0.55;
  g.add(stool);
  for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.55, 0.04), mat);
    leg.position.set(x, 0.275, z);
    g.add(leg);
  }
  const tv = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.34, 0.4), mat);
  tv.position.y = 0.75;
  g.add(tv);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.22), screen);
  scr.rotation.y = Math.PI / 2;
  scr.position.set(0.205, 0.76, 0);
  g.add(scr);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.4, 4), mat);
  ant.position.set(0, 1.08, 0.08);
  ant.rotation.x = 0.5;
  g.add(ant);
  return g;
}
