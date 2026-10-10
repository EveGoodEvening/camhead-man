// owner: WP2
// char2 WP-X：人群、纸人（char2.crowd_*） 的开发沙盒自测。只有这个 WP 改这个文件（PLAN §5.7）。
// - char2.crowd_person：人形 ≤ 3.6k 三角形、孩子比例（头身比 ≤ 5.8）、法线有限、头发外壳只穿一次（头里没东西）。
// - char2.crowd_meshes：回放 ≤ 3 + 1 个 InstancedMesh、孩子在 'crowd.kids'、剪影 mesh.count = 总人数；三种外观都画得出来。
// - char2.crowd_paper：纸扎摊主 ≤ 2.6k 三角形、头是封顶的壳（没有开口盒）、门童 ≤ 8 次绘制 ≤ 4k 三角形、名字不变。

import * as THREE from 'three';
import type { AreaPart } from '../../core/area';
import type { Game } from '../../core/game';
import type { SelftestResult } from '../../debug/selftest';
import { registerSelftest } from '../../debug/selftest';
import { createCrowd, crowdPersonGeometry } from '../../rigs/crowd';
import { createPaperFigure, createPaperStalls } from '../../rigs/paper';

function report(): { t: (what: string, cond: boolean, detail?: string) => boolean; done: () => SelftestResult } {
  const notes: string[] = [];
  let ok = true;
  return {
    t(what, cond, detail) {
      if (!cond) ok = false;
      notes.push(`${cond ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
      return cond;
    },
    done: () => ({ ok, notes }),
  };
}
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;

registerSelftest('char2.crowd_person', () => {
  const r = report();
  const adult = crowdPersonGeometry(false), kid = crowdPersonGeometry(true);
  r.t('大人 ≤ 3600 三角形', tris(adult) <= 3600, `${tris(adult)}`);
  r.t('孩子 ≤ 3600 三角形', tris(kid) <= 3600, `${tris(kid)}`);
  for (const [name, g] of [['大人', adult], ['孩子', kid]] as const) {
    const n = g.attributes.normal!.array as Float32Array;
    let bad = 0;
    for (let i = 0; i < n.length; i++) if (!Number.isFinite(n[i]!)) bad++;
    r.t(`${name}：有 uv、normal，法线有限`, !!g.attributes.uv && bad === 0);
  }
  // 头身比（头高：大人 0.24，孩子 ×1.3）
  adult.computeBoundingBox();
  kid.computeBoundingBox();
  const hA = adult.boundingBox!.max.y, hK = kid.boundingBox!.max.y;
  const headA = 0.24, headK = 0.24 * 1.3;
  r.t('大人 7–8 头身', hA / headA > 6.9 && hA / headA < 8.1, (hA / headA).toFixed(2));
  r.t('孩子 5–5.8 头身（不是缩小的大人）', hK / headK > 4.9 && hK / headK < 5.8, (hK / headK).toFixed(2));
  // 头发就是外壳：从头中心往上半球打射线，只穿过一层面（没有头皮在头发里面）
  const mesh = new THREE.Mesh(adult, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const ray = new THREE.Raycaster();
  const c = new THREE.Vector3(0, 1.64, -0.006);
  let multi = 0, total = 0;
  for (let i = 0; i < 160; i++) {
    const phi = (i / 160) * Math.PI * 2 * 7.3, y = 0.25 + 0.7 * ((i * 0.618) % 1);
    const d = new THREE.Vector3(Math.cos(phi) * Math.sqrt(1 - y * y), y, Math.sin(phi) * Math.sqrt(1 - y * y));
    ray.set(c, d);
    const hits = ray.intersectObject(mesh).filter(h => h.distance < 0.3);
    total++;
    if (hits.length !== 1) multi++;
  }
  (mesh.material as THREE.Material).dispose();
  r.t('头（上半）只有一层外壳', multi === 0, `${multi}/${total} 条射线不是恰好一次`);
  return r.done();
});

registerSelftest('char2.crowd_meshes', (game: Game) => {
  const r = report();
  const rep = createCrowd({ count: 30, cols: 10, spacing: 0.62, look: 'replay', seed: 1984, kidsFrontRow: 8 });
  const all = [rep.mesh, ...rep.mesh.children] as THREE.InstancedMesh[];
  r.t('回放 ≤ 4 个 InstancedMesh（3 套衣服 + 孩子）', all.length <= 4, all.map(m => `${m.name}:${m.count}`).join(' '));
  const kids = rep.mesh.getObjectByName('crowd.kids') as THREE.InstancedMesh | undefined;
  r.t('孩子单独一份几何', !!kids && kids.count === 8 && kids.geometry !== rep.mesh.geometry);
  r.t('总人数 30', all.reduce((a, m) => a + m.count, 0) === 30);
  r.t('回放材质写深度（只剩外壳）', all.every(m => (m.material as THREE.Material).depthWrite && (m.material as THREE.Material).userData.ghostDepth === true));
  const sil = createCrowd({ count: 20, cols: 7, spacing: 0.6, look: 'silhouette', kidsFrontRow: 3 });
  r.t('剪影：mesh.count = 总人数（终章复制它）', sil.mesh.count === 20);
  // 三种外观都画得出来
  const renderer = game.renderer;
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 30);
  cam.position.set(0, 1.4, -5);
  cam.lookAt(0, 1, 0.5);
  cam.updateMatrixWorld();
  const ghost = createCrowd({ count: 12, cols: 6, spacing: 0.6, look: 'ghost', kidsFrontRow: 2 });
  for (const [name, c] of [['回放', rep], ['剪影', sil], ['魂影', ghost]] as const) {
    const scene = new THREE.Scene();
    scene.add(c.mesh);
    c.mesh.traverse(o => { o.layers.enableAll(); });
    cam.layers.enableAll();
    const rt = new THREE.WebGLRenderTarget(96, 96, { type: THREE.UnsignedByteType });
    const prevRt = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(name === '剪影' ? 0xffffff : 0x000000, 1);
    renderer.clear();
    renderer.render(scene, cam);
    const px = new Uint8Array(96 * 96 * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, 96, 96, px);
    renderer.setRenderTarget(prevRt);
    renderer.setClearColor(prevClear, prevAlpha);
    rt.dispose();
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      const s = px[i]! + px[i + 1]! + px[i + 2]!;
      if (name === '剪影' ? s < 300 : s > 30) n++;
    }
    r.t(`${name}：画出人形`, n > 200, `${n} px`);
    scene.remove(c.mesh);
  }
  rep.dispose();
  sil.dispose();
  ghost.dispose();
  return r.done();
});

registerSelftest('char2.crowd_paper', () => {
  const r = report();
  const stalls = createPaperStalls([{ pos: [0, 0, 0], yaw: 0, seed: 3 }]);
  r.t('纸扎摊主（实例几何）≤ 2600 三角形', tris(stalls.geometry) <= 2600, `${tris(stalls.geometry)}`);
  const v = createPaperFigure({ kind: 'vendor', seed: 3 });
  const body = v.root.getObjectByName('paperBody') as THREE.Mesh;
  // 头是封顶的壳：从头顶上方往下打射线，先碰帽子、再碰头壳的顶（没有开口的盒子）
  const ray = new THREE.Raycaster(new THREE.Vector3(0.021, 2, 0.013), new THREE.Vector3(0, -1, 0));
  const m2 = new THREE.Mesh(body.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const hits = ray.intersectObject(m2).filter(h => h.point.y > 1.25).map(h => h.point.y.toFixed(3));
  (m2.material as THREE.Material).dispose();
  r.t('头顶：帽子 + 封顶的头壳（1.25m 以上 ≥ 3 层面）', hits.length >= 3, hits.join(','));
  r.t('名字：paperBody / paperFace', !!body && v.face.name === 'paperFace');
  v.dispose();
  const boy = createPaperFigure({ kind: 'boy', lanternText: '过路留钱' });
  let calls = 0, t = 0;
  boy.root.traverse(o => {
    if ((o as THREE.Mesh).isMesh && o.visible) { calls++; t += tris((o as THREE.Mesh).geometry); }
  });
  r.t('门童 ≤ 8 次绘制、≤ 4000 三角形', calls <= 8 && t <= 4000, `${calls} / ${t}`);
  r.t('门童 boyLantern 还在', !!boy.root.getObjectByName('boyLantern'));
  boy.dispose();
  stalls.geometry.dispose();
  return r.done();
});

const part: AreaPart = {};
export default part;
