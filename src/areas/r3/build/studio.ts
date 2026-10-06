// owner: R3
// 影棚（z -5 ~ -11）：北墙四卷背景布、大座机、坐凳、画架（未完成的炭精画 + 红外才看得见的铅笔底稿）、
// 西墙墙钩上的双反、两盏没开的灯架、道具椅与小圆桌、墙上的大幅样片；北墙西段是暗房门（门背后贴守则）。
// 影棚钨丝灯是全区唯一的投影光（GDD §9.3，512 阴影贴图，只给影棚里的大件 castShadow）。

import * as THREE from 'three';
import type { AreaContext } from '../../../core/area';
import { MATERIALS } from '../../../fx/materials';
import { paintTexture } from '../../../kit/canvas';
import { door, type DoorRig } from '../../../kit/doors';
import { kitMat } from '../../../kit/geom';
import { designLight } from '../../../kit/lamps';
import { PROPS } from '../../../kit/props';
import { rng, range } from '../../../kit/rng';
import { BACKDROP, BIG_CAMERA, DARK, EASEL, FACADE, PARTITION, SHOP, STOOL, STUDIO_LAMP, TLR, RULES } from '../layout';
import { TEXT } from '../text';
import { Batch, contactShadows, paintedMat, trackTree } from './util';
import { atlasQuads } from './shop';
import { backdrops, rulesSheet } from './textures';

/**
 * 影棚钨丝灯投影（GDD §9.3：全局最多 1 盏投影光，给 R3 影棚）。'off' = 退成不投影的点光；'build' = 聚光灯在 build 里就开投影。
 * （M2 时第二次进入 R3 刷 GL_INVALID_OPERATION，当时的绕开是 onEnter 再开 castShadow；M3 查明是引擎在预编译/预热之前没让新灯建阴影贴图——
 * 空阴影贴图走数组 uniform 时没有比较模式——已在 core/area.ts 修好，docs/requests/r3.md #1。）
 */
export const STUDIO_SHADOW: 'off' | 'build' = 'build';

export interface StudioRig {
  /** 影棚钨丝灯（点光；STUDIO_SHADOW 时是朝坐凳的聚光） */
  light: THREE.PointLight | THREE.SpotLight;
  easel: THREE.Group;
  canvas: THREE.Object3D | null;
  sketch: THREE.Mesh;
  tlr: THREE.Group;
  bigCamera: THREE.Group;
  stool: THREE.Group;
  darkDoor: DoorRig;
  rules: THREE.Mesh;
  /** 暗房门上方的“工作中”小红灯（红灯亮时亮） */
  busyLamp: THREE.MeshStandardMaterial;
}

/** a → b 的细杆（局部坐标，挂在调用方的组里）。 */
function rodBetween(mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 5), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/** 背景布：竖直挂下来，下端 sweep 弯到地上（sweep = 0 则直挂到 y0）。 */
function backdropPanel(w: number, top: number, y0: number, sweep: number, uv: [number, number]): THREE.BufferGeometry {
  const segs = 16;
  const g = new THREE.PlaneGeometry(w, 1, 1, segs);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uvs = g.attributes.uv as THREE.BufferAttribute;
  const vertLen = top - y0 - sweep;
  const arcLen = sweep > 0 ? (Math.PI / 2) * sweep : 0;
  const floorLen = sweep > 0 ? 0.35 : 0;
  const total = vertLen + arcLen + floorLen;
  for (let i = 0; i < pos.count; i++) {
    const t = 1 - (pos.getY(i) + 0.5);     // 0 = 顶，1 = 底
    const s = t * total;
    let y: number, z: number;
    if (s <= vertLen) {
      y = top - s;
      z = 0;
    } else if (s <= vertLen + arcLen) {
      const a = (s - vertLen) / sweep;
      y = y0 + sweep - Math.sin(a) * sweep;
      z = sweep - Math.cos(a) * sweep;
    } else {
      y = y0 + 0.004;
      z = sweep + (s - vertLen - arcLen);
    }
    pos.setY(i, y);
    pos.setZ(i, z);
    uvs.setXY(i, uv[0] + (uvs.getX(i)) * (uv[1] - uv[0]), 1 - t * ((top - y0) / 3.25));
  }
  g.computeVertexNormals();
  return g;
}

export function buildStudio(ctx: AreaContext, B: Batch, atlas: THREE.Texture): StudioRig {
  const metal = MATERIALS.metal();
  const darkWood = kitMat('r3.darkWood', { color: '#3a2618', roughness: 0.7 });
  const studioWall = kitMat('r3.studioWall', { color: '#857968', roughness: 0.95 });
  const z0 = PARTITION.z, z1 = DARK.z0;

  // 地板：旧木地板（按米铺 UV）
  const planks = ctx.track(paintTexture(256, 256, (g, w, h) => {
    const r = rng(7);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `rgb(${Math.round(range(r, 70, 92))},${Math.round(range(r, 46, 60))},${Math.round(range(r, 30, 40))})`;
      g.fillRect(0, (i * h) / 8, w, h / 8);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(0, (i * h) / 8, w, 2);
      g.fillRect(range(r, 0, w), (i * h) / 8, 2, h / 8);
      for (let k = 0; k < 20; k++) {
        g.fillStyle = `rgba(20,10,5,${range(r, 0.05, 0.15)})`;
        g.fillRect(0, (i * h) / 8 + range(r, 3, h / 8 - 3), w, 1);
      }
    }
  }, { repeat: [1, 1] }));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(SHOP.inEast - SHOP.inWest, z0 - z1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: planks, roughness: 0.6 }));
  const fuv = floor.geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * 5.8 / 1.6, fuv.getY(i) * 6 / 1.6);
  floor.position.set(0, 0.002, (z0 + z1) / 2);
  floor.receiveShadow = true;
  floor.name = 'r3.studioFloor';
  ctx.add(floor);

  // 墙、顶（影棚的墙刷深色，接影子）
  const walls = new Batch('r3.studioWalls');
  walls.aabb(studioWall, SHOP.x0, 0, z1, SHOP.inWest, SHOP.studioCeil, z0);
  walls.aabb(studioWall, SHOP.inEast, 0, z1, SHOP.x1, SHOP.studioCeil, z0);
  // 北墙：暗房门洞 x -1.93 ~ -1.07
  const dx0 = DARK.doorX - DARK.doorW / 2, dx1 = DARK.doorX + DARK.doorW / 2;
  walls.aabb(studioWall, SHOP.inWest, 0, z1 - 0.075, dx0, SHOP.studioCeil, z1 + 0.075);
  walls.aabb(studioWall, dx1, 0, z1 - 0.075, SHOP.inEast, SHOP.studioCeil, z1 + 0.075);
  walls.aabb(studioWall, dx0, 2.2, z1 - 0.075, dx1, SHOP.studioCeil, z1 + 0.075);
  walls.aabb(kitMat('r3.studioCeil', { color: '#2a2622', roughness: 1 }), SHOP.x0, SHOP.studioCeil, z1, SHOP.x1, SHOP.studioCeil + 0.1, z0);
  for (const m of walls.flush(ctx)) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  ctx.collider.box([(SHOP.x0 + SHOP.inWest) / 2, 1.7, (z0 + z1) / 2], [SHOP.inWest - SHOP.x0, 3.4, z0 - z1]);
  ctx.collider.box([(SHOP.x1 + SHOP.inEast) / 2, 1.7, (z0 + z1) / 2], [SHOP.x1 - SHOP.inEast, 3.4, z0 - z1]);
  ctx.collider.box([(SHOP.inWest + dx0) / 2, 1.7, z1], [dx0 - SHOP.inWest, 3.4, 0.15]);
  ctx.collider.box([(dx1 + SHOP.inEast) / 2, 1.7, z1], [SHOP.inEast - dx1, 3.4, 0.15]);
  // 暗房门楣与影棚顶棚的碰撞板（M4 第 2 轮：第三人称相机只躲碰撞体，低头时吊臂会钻进顶棚板、门楣里）；
  // 顶棚板一直补到楼上那块碰撞体的底（FACADE.groundH）
  ctx.collider.box([DARK.doorX, (2.2 + SHOP.studioCeil) / 2, z1], [dx1 - dx0, SHOP.studioCeil - 2.2, 0.15]);
  ctx.collider.box([0, (SHOP.studioCeil + FACADE.groundH) / 2, (z0 + z1) / 2], [SHOP.x1 - SHOP.x0, FACADE.groundH - SHOP.studioCeil, z0 - z1]);

  // 背景布（北墙，暗房门以东；4 卷：灰、天蓝、山水、暗红）
  const bdTex = ctx.track(paintTexture(768, 384, backdrops));
  const bdMat = new THREE.MeshStandardMaterial({ map: bdTex, roughness: 0.95, side: THREE.DoubleSide });
  bdMat.name = 'r3:backdrop';
  const bw = (BACKDROP.x1 - BACKDROP.x0) / 4;
  const drop = [{ y0: 0, sweep: 0.55 }, { y0: 0.9, sweep: 0 }, { y0: 1.7, sweep: 0 }, { y0: 2.7, sweep: 0 }];
  const bdGeos: THREE.BufferGeometry[] = [];
  drop.forEach((d, i) => {
    const geo = backdropPanel(bw - 0.03, BACKDROP.top, d.y0, d.sweep, [i / 4, (i + 1) / 4]);
    geo.translate(BACKDROP.x0 + bw * (i + 0.5), 0, BACKDROP.z);
    bdGeos.push(geo);
    // 布卷（顶上的轴）
    B.cyl(kitMat('r3.bdRoll', { color: '#2a2420', roughness: 0.8 }), 0.06, 0.06, bw - 0.02, [BACKDROP.x0 + bw * (i + 0.5), BACKDROP.top + 0.02, BACKDROP.z + 0.06], 10).rotation.z = Math.PI / 2;
    // 拉链子
    B.rod(metal, [BACKDROP.x0 + bw * (i + 0.9), BACKDROP.top, BACKDROP.z + 0.1], [BACKDROP.x0 + bw * (i + 0.9), Math.max(d.y0, 1.2), BACKDROP.z + 0.1], 0.004);
  });
  for (const geo of bdGeos) {
    const m = new THREE.Mesh(geo, bdMat);
    m.receiveShadow = true;
    m.name = 'r3.backdropPanel';
    ctx.add(m);
  }
  B.aabb(metal, BACKDROP.x0 - 0.05, BACKDROP.top + 0.08, BACKDROP.z + 0.02, BACKDROP.x1 + 0.05, BACKDROP.top + 0.12, BACKDROP.z + 0.14);

  // 大座机（GDD：(0,-6.5)，镜头朝北对着坐凳）
  const bigCamera = PROPS.bigCamera();
  bigCamera.position.set(...BIG_CAMERA);
  bigCamera.traverse(o => { o.castShadow = true; });
  ctx.add(bigCamera);
  ctx.collider.box([BIG_CAMERA[0], 0.7, BIG_CAMERA[2]], [0.8, 1.4, 0.8]);

  // 坐凳（圆面木凳）
  const stool = new THREE.Group();
  stool.name = 'r3.stoolGroup';
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.045, 18), darkWood);
  seat.position.y = 0.46;
  stool.add(seat);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.46, 6), darkWood);
    leg.position.set(Math.cos(a) * 0.13, 0.23, Math.sin(a) * 0.13);
    leg.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
    stool.add(leg);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.01, 4, 18), darkWood);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.16;
  stool.add(ring);
  stool.position.set(...STOOL);
  stool.traverse(o => { o.castShadow = true; });
  ctx.add(stool);
  ctx.collider.box([STOOL[0], 0.25, STOOL[2]], [0.4, 0.5, 0.4]);

  // 画架（朝西）：未完成的炭精画；红外下能透过墨层看见铅笔底稿（layer.ir_only）
  const easel = PROPS.easel();
  easel.position.set(...EASEL);
  easel.rotation.y = Math.PI / 2;
  easel.traverse(o => { o.castShadow = true; });
  ctx.add(easel);
  ctx.collider.box([EASEL[0] + 0.1, 0.8, EASEL[2]], [0.55, 1.6, 0.7]);
  const canvas = easel.getObjectByName('canvas') ?? null;
  const sketchTex = ctx.track(paintTexture(256, 320, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = rng(31);
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 6;
    g.lineCap = 'round';
    // 铅笔稿：头型、帽檐、衣领、袖箍都起好了，唯独脸是空的
    g.beginPath();
    g.ellipse(w / 2, h * 0.42, w * 0.2, h * 0.2, 0, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(w * 0.24, h * 0.3);
    g.quadraticCurveTo(w / 2, h * 0.17, w * 0.76, h * 0.3);
    g.lineTo(w * 0.82, h * 0.33);
    g.lineTo(w * 0.18, h * 0.33);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.moveTo(w * 0.1, h * 0.97);
    g.quadraticCurveTo(w * 0.2, h * 0.66, w * 0.5, h * 0.64);
    g.quadraticCurveTo(w * 0.8, h * 0.66, w * 0.9, h * 0.97);
    g.moveTo(w * 0.42, h * 0.65);
    g.lineTo(w * 0.5, h * 0.75);
    g.lineTo(w * 0.58, h * 0.65);
    g.stroke();
    g.lineWidth = 4;
    for (let i = 0; i < 30; i++) {
      g.strokeStyle = `rgba(255,255,255,${range(r, 0.55, 0.9)})`;
      g.beginPath();
      const x = w * range(r, 0.12, 0.88), y = h * range(r, 0.66, 0.95);
      g.moveTo(x, y);
      g.lineTo(x + range(r, -12, 12), y + range(r, -6, 6));
      g.stroke();
    }
    // 脸那一块：虚线框，空着
    g.setLineDash([10, 8]);
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.strokeRect(w * 0.36, h * 0.34, w * 0.28, h * 0.2);
  }, { mask: false }));
  const sketchMat = new THREE.MeshBasicMaterial({ map: sketchTex, transparent: true, depthWrite: false });
  sketchMat.userData.tempC = 30;
  sketchMat.name = 'r3.pencilSketch';
  const sketch = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.58), sketchMat);
  sketch.name = 'r3.pencilSketch';
  if (canvas) {
    canvas.updateMatrixWorld(true);
    easel.updateMatrixWorld(true);
    const p = new THREE.Vector3(0, 0, -0.012).applyMatrix4(canvas.matrixWorld);
    sketch.position.copy(p);
    sketch.quaternion.copy(canvas.getWorldQuaternion(new THREE.Quaternion())).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
  }
  sketch.userData.tempC = 30;
  sketch.userData.noOcclude = true;
  ctx.add(sketch, { layer: 'ir_only', occlude: false, tempC: 30 });
  // 画架边的小桌：炭精粉、一叠画纸
  B.aabb(darkWood, EASEL[0] - 0.1, 0.7, EASEL[2] + 0.45, EASEL[0] + 0.4, 0.74, EASEL[2] + 0.95);
  for (const [x, z] of [[-0.05, 0.5], [0.35, 0.5], [-0.05, 0.9], [0.35, 0.9]] as const) B.aabb(darkWood, EASEL[0] + x, 0, EASEL[2] + z, EASEL[0] + x + 0.04, 0.7, EASEL[2] + z + 0.04);
  B.aabb(kitMat('r3.drawPaper', { color: '#e0d8c4', roughness: 0.9 }), EASEL[0] - 0.05, 0.74, EASEL[2] + 0.5, EASEL[0] + 0.3, 0.76, EASEL[2] + 0.8);
  B.cyl(kitMat('r3:charcoal', { color: '#101010', roughness: 1 }), 0.03, 0.03, 0.05, [EASEL[0] + 0.3, 0.77, EASEL[2] + 0.85], 8);
  ctx.collider.box([EASEL[0] + 0.15, 0.37, EASEL[2] + 0.7], [0.55, 0.74, 0.55]);

  // 西墙墙钩上的双反（GDD：(-2.8, 1.6, -6)）
  B.box(metal, 0.03, 0.03, 0.12, [SHOP.inWest + 0.03, TLR[1] + 0.18, TLR[2]]);
  B.box(metal, 0.06, 0.02, 0.02, [SHOP.inWest + 0.06, TLR[1] + 0.21, TLR[2]]);
  const tlr = PROPS.tlr();
  tlr.position.set(TLR[0], TLR[1] - 0.07, TLR[2]);
  tlr.rotation.y = -Math.PI / 2;
  ctx.add(tlr);

  // 两盏没开的灯架：反光伞（外黑里银，八根伞骨），伞口朝着坐凳，灯头插在伞杆上（没开）
  const clothBlack = kitMat('r3:umbrella', { color: '#1e1d1f', roughness: 0.8, metalness: 0 });
  const clothSilver = kitMat('r3.umbrellaIn', { color: '#cfcdc6', roughness: 0.5, metalness: 0.3, side: THREE.BackSide });
  const ribMat = kitMat('r3.umbrellaRib', { color: '#2a2a2a', roughness: 0.6, metalness: 0.3 });
  const lampHeadMat = kitMat('r3.flashHead', { color: '#2e2d2b', roughness: 0.55, metalness: 0.35 });
  for (const [x, z, yaw] of [[-1.35, -8.0, -0.7], [1.5, -8.3, 0.86]] as const) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      B.rod(metal, [x, 1.0, z], [x + Math.cos(a) * 0.35, 0, z + Math.sin(a) * 0.35], 0.012);
    }
    B.rod(metal, [x, 1.0, z], [x, 1.9, z], 0.016);
    // 伞：局部 +y 指向伞顶（背对坐凳），伞口朝局部 -y；绕 x 转 70° 再绕 y 转向坐凳
    const u = new THREE.Group();
    u.position.set(x, 2.02, z);
    u.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2 - 0.35, yaw, 0, 'YXZ'));
    const R = 0.48, H = 0.22;
    const canopy = new THREE.ConeGeometry(R, H, 8, 1, true);
    u.add(new THREE.Mesh(canopy, clothBlack), new THREE.Mesh(canopy.clone(), clothSilver));
    for (let k = 0; k < 8; k++) {
      const th = (k / 8) * Math.PI * 2;
      u.add(rodBetween(ribMat, new THREE.Vector3(0, H / 2, 0), new THREE.Vector3(Math.sin(th) * R, -H / 2, Math.cos(th) * R), 0.006));
    }
    u.add(rodBetween(ribMat, new THREE.Vector3(0, H / 2 + 0.04, 0), new THREE.Vector3(0, -0.34, 0), 0.008));
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.2, 14), lampHeadMat);
    head.position.set(0, -0.3, 0);
    u.add(head);
    u.updateMatrixWorld(true);
    for (const c of [...u.children] as THREE.Mesh[]) {
      c.matrixWorld.decompose(c.position, c.quaternion, c.scale);
      u.remove(c);
      B.add(c);
    }
    ctx.collider.box([x, 0.5, z], [0.6, 1.0, 0.6]);
  }
  // 道具椅、小圆桌与一瓶塑料花
  const chair = PROPS.chair();
  chair.position.set(1.55, 0, -10.2);
  chair.rotation.y = Math.PI + 0.3;
  ctx.add(chair);
  ctx.collider.box([1.55, 0.45, -10.2], [0.55, 0.9, 0.55]);
  B.cyl(darkWood, 0.26, 0.26, 0.03, [-0.95, 0.68, -10.25], 16);
  B.cyl(darkWood, 0.03, 0.05, 0.68, [-0.95, 0.34, -10.25], 8);
  B.cyl(kitMat('r3:vase', { color: '#2a5a7a', roughness: 0.2, metalness: 0.1 }), 0.05, 0.07, 0.22, [-0.95, 0.8, -10.25], 12);
  const flower = kitMat('r3:flower', { color: '#d83a4a', roughness: 0.7 });
  for (let i = 0; i < 5; i++) B.cyl(flower, 0.04, 0.02, 0.05, [-0.95 + Math.cos(i) * 0.06, 0.98 + (i % 2) * 0.05, -10.25 + Math.sin(i) * 0.06], 8);
  ctx.collider.box([-0.95, 0.4, -10.25], [0.55, 0.8, 0.55]);
  // 东墙两幅大样片（婚纱照、全家福）与西墙一面整衣镜
  const photoMat = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.55 });
  photoMat.name = 'r3.studioPhotos';
  ctx.add(atlasQuads([
    { at: [SHOP.inEast - 0.035, 1.85, -6.3], w: 0.8, h: 1.0, rotY: -90, cell: 1 },
    { at: [SHOP.inEast - 0.035, 1.8, -9.4], w: 0.9, h: 0.7, rotY: -90, cell: 2 },
  ], photoMat));
  const gilt = kitMat('r3:gilt', { color: '#a88a3a', roughness: 0.5, metalness: 0.6 });
  B.box(gilt, 0.03, 1.1, 0.9, [SHOP.inEast - 0.02, 1.85, -6.3]);
  B.box(gilt, 0.03, 0.8, 1.0, [SHOP.inEast - 0.02, 1.8, -9.4]);
  const mirror = kitMat('r3.dressMirror', { color: '#9aa4ac', roughness: 0.08, metalness: 0.9 });
  B.aabb(mirror, SHOP.inWest, 0.5, -9.1, SHOP.inWest + 0.02, 1.9, -8.5);
  B.aabb(darkWood, SHOP.inWest, 0.45, -9.15, SHOP.inWest + 0.015, 1.95, -8.45);
  // 影棚钨丝灯：吊在坐凳右前上方的摄影泡（宽口铝反光罩 + 大号磨砂钨丝泡），照着坐凳和背景布；全区唯一的投影光（STUDIO_SHADOW）
  const lampAt = STUDIO_LAMP;
  B.rod(kitMat('r3:cord', { color: '#1a1a1a', roughness: 0.8 }), [lampAt[0], SHOP.studioCeil, lampAt[2]], [lampAt[0], lampAt[1] + 0.2, lampAt[2]], 0.007);
  // 反光罩被钨丝泡烤得烫手（红外下 55℃，烧成一圈白）
  const reflectorMat = kitMat('r3.floodReflector', { color: '#c9c6bd', roughness: 0.55, metalness: 0.6 });
  reflectorMat.userData.tempC = 55;
  const reflectorGeo = new THREE.CylinderGeometry(0.07, 0.34, 0.2, 24, 1, true);
  const reflector = new THREE.Mesh(reflectorGeo, reflectorMat);
  reflector.position.set(lampAt[0], lampAt[1] + 0.1, lampAt[2]);
  ctx.add(reflector, { tempC: 55 });
  // 罩子里面被钨丝泡照得发亮（从下往上看是一圈暖白的碗）：只发光，不另加灯
  const reflectorIn = new THREE.MeshStandardMaterial({ color: '#3a3026', emissive: '#FFD9A8', emissiveIntensity: 2.4, roughness: 0.5, side: THREE.BackSide });
  reflectorIn.name = 'r3.floodReflectorIn';
  reflectorIn.userData.tempC = 55;
  const reflectorInside = new THREE.Mesh(reflectorGeo.clone(), reflectorIn);
  reflectorInside.position.copy(reflector.position);
  ctx.add(reflectorInside, { tempC: 55 });
  B.cyl(kitMat('r3.floodSocket', { color: '#2a2a2a', roughness: 0.6, metalness: 0.3 }), 0.05, 0.06, 0.1, [lampAt[0], lampAt[1] + 0.22, lampAt[2]], 12);
  const floodBulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 12), MATERIALS.emissive('#FFD9A8', 1.9));
  floodBulb.position.set(lampAt[0], lampAt[1] + 0.02, lampAt[2]);
  floodBulb.name = 'r3.floodBulb';
  ctx.add(floodBulb);
  const studioLight = designLight(STUDIO_SHADOW !== 'off' ? 'spot' : 'point', '#FFC98A', 1.9, 6.5);
  studioLight.name = 'r3.studioLight';
  studioLight.position.set(lampAt[0], lampAt[1] - 0.06, lampAt[2]);
  if (studioLight instanceof THREE.SpotLight) {
    // 宽口反光罩：几乎是半球的泛光，罩子以上不亮
    studioLight.angle = 1.5;
    studioLight.penumbra = 0.2;
    studioLight.target.position.set(STOOL[0] - lampAt[0], 0.3 - lampAt[1], STOOL[2] - lampAt[2] + 0.6);
    studioLight.shadow.mapSize.set(512, 512);
    studioLight.shadow.bias = -0.0008;
    studioLight.shadow.normalBias = 0.02;
    studioLight.shadow.camera.near = 0.3;
    studioLight.shadow.camera.far = 8;
    studioLight.castShadow = true;
  }
  ctx.light(studioLight);

  // 暗房门（门朝南开向暗房里；门背后贴守则 r3.darkroom_rules）
  const darkDoor = door({ w: DARK.doorW, h: 2.15, style: 'darkroom', at: [DARK.doorX, 0, DARK.z0], yaw: 180, hinge: 'left' });
  ctx.add(darkDoor.group);
  darkDoor.group.traverse(o => { o.castShadow = true; });
  let rulesLo: THREE.Texture | null = null, rulesHi: THREE.Texture | null = null;
  const lo = () => (rulesLo ??= ctx.track(paintTexture(512, 704, rulesSheet(false))));
  const hi = () => (rulesHi ??= ctx.track(paintTexture(1024, 1408, rulesSheet(true))));
  const rulesMat = new THREE.MeshStandardMaterial({ map: lo(), roughness: 0.9, transparent: true, alphaTest: 0.02, side: THREE.FrontSide });
  rulesMat.name = 'r3:rules';
  const rules = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.63), rulesMat);
  rules.name = 'r3.rulesSheet';
  const leafPanel = darkDoor.leaf.getObjectByName('leafPanel');
  if (leafPanel) {
    // 门扇局部：合页在 x = 0，门扇往 -x 展开，背面（暗房里）是局部 +z
    rules.position.set(-DARK.doorW / 2, RULES[1], 0.026);
    leafPanel.add(rules);
    trackTree(ctx, rules);
  }
  ctx.hdText(rules, lo, hi, { minZoom: 2, maxDist: 3 });
  // 门楣上“暗房　闲人免进”与“工作中”小红灯
  const doorSign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.18), paintedMat(ctx, 400, 90, (g, w, h) => {
    g.fillStyle = '#e8e0c8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#8a1a1a';
    g.font = `bold ${Math.round(h * 0.6)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(TEXT.sign.darkroom, w / 2, h / 2);
  }, { roughness: 0.7 }));
  doorSign.position.set(DARK.doorX, 2.42, DARK.z0 + 0.08);
  ctx.add(doorSign);
  const busyLamp = new THREE.MeshStandardMaterial({ color: '#3a0a0a', emissive: '#ff2a1a', emissiveIntensity: 0, roughness: 0.4 });
  busyLamp.name = 'r3.busyLamp';
  busyLamp.userData.tempC = 18;
  const busy = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), busyLamp);
  busy.position.set(DARK.doorX + 0.55, 2.42, DARK.z0 + 0.1);
  ctx.add(busy);

  // 没有投影（docs/requests/r3.md #1）：大件底下垫一层软接触影
  contactShadows(ctx, [
    { x: BIG_CAMERA[0], z: BIG_CAMERA[2], rx: 0.55, rz: 0.55 }, { x: STOOL[0], z: STOOL[2], rx: 0.3, rz: 0.3 },
    { x: EASEL[0] + 0.1, z: EASEL[2], rx: 0.4, rz: 0.5, a: 0.8 }, { x: -1.35, z: -8.0, rx: 0.42, rz: 0.42, a: 0.7 }, { x: 1.5, z: -8.3, rx: 0.42, rz: 0.42, a: 0.7 },
    { x: 1.55, z: -10.2, rx: 0.36, rz: 0.36 }, { x: -0.95, z: -10.25, rx: 0.32, rz: 0.32 }, { x: EASEL[0] + 0.15, z: EASEL[2] + 0.7, rx: 0.36, rz: 0.36, a: 0.8 },
  ]);
  return { light: studioLight, easel, canvas, sketch, tlr, bigCamera, stool, darkDoor, rules, busyLamp };
}
