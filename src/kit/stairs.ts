// owner: WP2
// 楼梯（ARCH §10.2）：纯布景（楼梯不可行走，用触发体积/交互切换楼层）。
// 原点在第一级踏步前沿的中点（地面），往 -z 方向爬升；rise/run 为每级的高/深；landing 为顶上平台的进深；
// rail：左侧（-x）一道铁栏杆 + 木扶手。踏步与平台合成一个网格（水泥），踏步前沿一道深色防滑条合成另一个网格。

import * as THREE from 'three';
import { MATERIALS } from '../fx/materials';
import { kitMat, merge, rod } from './geom';

export function stairsVisual(o: { width: number; rise: number; run: number; steps: number; landing?: number; rail?: boolean }): THREE.Group {
  const g = new THREE.Group();
  g.name = 'stairs';
  const concrete = MATERIALS.concrete();
  const blocks: THREE.Mesh[] = [], nosing: THREE.Mesh[] = [];
  for (let i = 0; i < o.steps; i++) {
    const h = (i + 1) * o.rise;
    // 每一级是从地面到踏面的实心块（侧面看是锯齿，底下不会漏空）
    const b = new THREE.Mesh(new THREE.BoxGeometry(o.width, h, o.run));
    b.position.set(0, h / 2, -(i + 0.5) * o.run);
    blocks.push(b);
    const n = new THREE.Mesh(new THREE.BoxGeometry(o.width, 0.02, 0.04));
    n.position.set(0, h - 0.005, -i * o.run - 0.02);
    nosing.push(n);
  }
  const topY = o.steps * o.rise;
  if (o.landing && o.landing > 0) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(o.width, topY, o.landing));
    l.position.set(0, topY / 2, -o.steps * o.run - o.landing / 2);
    blocks.push(l);
  }
  const body = merge(blocks, concrete);
  body.name = 'stairSteps';
  g.add(body);
  const nm = merge(nosing, kitMat('stairs.nosing', { color: '#2b2b2b', roughness: 0.7 }));
  nm.name = 'stairNosing';
  g.add(nm);
  for (const m of [...blocks, ...nosing]) m.geometry.dispose();
  if (o.rail) {
    const iron = kitMat('stairs.rail', { color: '#1f2226', roughness: 0.5, metalness: 0.6 });
    const wood = kitMat('stairs.handrail', { color: '#5A3A22', roughness: 0.55 });
    const x = -o.width / 2 + 0.05;
    const posts: THREE.Mesh[] = [];
    for (let i = 0; i <= o.steps; i += 2) {
      const y = Math.min(i, o.steps) * o.rise;
      const z = -Math.min(i, o.steps) * o.run - 0.1;
      posts.push(rod(new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + 0.9, z), 0.012, iron, 5));
    }
    const pm = merge(posts, iron);
    pm.name = 'railPosts';
    g.add(pm);
    for (const p of posts) p.geometry.dispose();
    const hr = rod(new THREE.Vector3(x, 0.9, -0.1), new THREE.Vector3(x, topY + 0.9, -o.steps * o.run - 0.1), 0.028, wood, 8);
    hr.name = 'handrail';
    g.add(hr);
  }
  return g;
}
