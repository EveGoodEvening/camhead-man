// owner: R4
// 通道本体（GDD §4.5）：1990 年代白绿瓷砖、水磨石地、日光灯管、褪色公益壁画、东头地铁施工围挡、关着的报刊亭、楼梯口、
// 规矩牌（丑时起）；外加生活痕迹：小广告、水渍霉斑、消火栓、电表箱、痰盂、自行车、报纸捆、“小心地滑”、积水。
// 灯（ARCH §10.3，设计强度照写）：灯管 3 盏真实光（开市前；朝下的宽角聚光）+ 楼梯口路灯漏进来的 1 盏点光；其余灯管只用 emissive。

import * as THREE from 'three';
import type { AreaContext } from '../../../core/area';
import type { V3 } from '../../../core/types';
import { PALETTE } from '../../../data/palette';
import { TEMP_C } from '../../../data/render';
import { MATERIALS } from '../../../fx/materials';
import { box } from '../../../kit/geom';
import { designLight } from '../../../kit/lamps';
import { PROPS } from '../../../kit/props';
import { stairsVisual } from '../../../kit/stairs';
import { rng, range } from '../../../kit/rng';
import { R4L } from '../layout';
import { TEXT } from '../text';
import {
  adSheetTexture, exitSignTexture, leakGlowTexture, muralTexture, payphoneFaceTexture, payphoneSignTexture, plateTexture, radialGlowMask, rulesBoardTexture, skirtingTexture, stainDecalTexture,
  streetSignTexture, terrazzoTexture,
} from './textures';
import { addMerged, bake, boxG, cylG } from './util';

/** 灯管：13 根（每 3m 一根），各自的状态。 */
export interface TubeRig {
  mesh: THREE.InstancedMesh;
  mat: THREE.MeshBasicMaterial;
  xs: readonly number[];
  /** 0 = 常亮，1 = 闪，2 = 坏了（不亮） */
  kind: readonly number[];
  /** 三盏真实灯（x = R4L.tubeLights）：朝下的宽角聚光，灯管罩子只往下照（点光离顶板 0.18m，会把顶板照成一团白） */
  lights: THREE.SpotLight[];
  base: number[];
  /** 每根灯管在顶板上映出的一团柔光（加法贴花，实例色 = 灯管亮度） */
  glow: THREE.InstancedMesh;
}

export interface CorridorRig {
  tubes: TubeRig;
  /** 规矩牌（丑时起才挂出来） */
  rulesBoard: THREE.Object3D;
  /** 围挡顶上的三只黄闪灯（emissive 材质） */
  warn: THREE.MeshBasicMaterial;
  /** 半球光（开市前后换色、换强度） */
  hemi: THREE.HemisphereLight;
}

const TUBE_GLOW = new THREE.Color(PALETTE.OSD).lerp(new THREE.Color('#ffffff'), 0.72);

function decal(ctx: AreaContext, tex: THREE.Texture, w: number, h: number, pos: V3, rotY: number, opts?: { order?: number }): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(pos[0], pos[1], pos[2]);
  m.rotation.y = rotY;
  m.renderOrder = opts?.order ?? 1;
  m.userData.noOcclude = true;
  ctx.add(m, { occlude: false });
  return m;
}

// ———————————————————————————————————————————— 墙、地、顶

function buildShell(ctx: AreaContext): void {
  const H = R4L.hall;
  const S = R4L.stairs;
  const tile = MATERIALS.tileGreenWhite();
  const walls: THREE.BufferGeometry[] = [];
  const W = 0.2;
  // 北墙（留出楼梯口），南墙，西墙
  walls.push(bake(boxG(S.x0 - H.x0, H.h, W), [(H.x0 + S.x0) / 2, H.h / 2, H.z0 - W / 2]));
  walls.push(bake(boxG(H.x1 - S.x1, H.h, W), [(S.x1 + H.x1) / 2, H.h / 2, H.z0 - W / 2]));
  walls.push(bake(boxG(S.x1 - S.x0, 0.62, W), [(S.x0 + S.x1) / 2, H.h - 0.31, H.z0 - W / 2]));
  walls.push(bake(boxG(H.x1 - H.x0, H.h, W), [0, H.h / 2, H.z1 + W / 2]));
  walls.push(bake(boxG(W, H.h, H.z1 - H.z0), [H.x0 - W / 2, H.h / 2, 0]));
  // 楼梯井两侧的墙（一直往上到街面）
  const len = -S.zTop + H.z0;
  walls.push(bake(boxG(W, 6.4, len), [S.x0 - W / 2, 3.2, (H.z0 + S.zTop) / 2]));
  walls.push(bake(boxG(W, 6.4, len), [S.x1 + W / 2, 3.2, (H.z0 + S.zTop) / 2]));
  addMerged(ctx, walls, tile, 'r4:walls', undefined, false);

  // 踢脚（深绿水泥，按网格 UV 平铺）
  const skTex = ctx.track(skirtingTexture());
  skTex.wrapS = THREE.RepeatWrapping;
  skTex.repeat.set(20, 1);
  const skMat = new THREE.MeshStandardMaterial({ map: skTex, roughness: 0.85 });
  const sk: THREE.BufferGeometry[] = [];
  sk.push(bake(boxG(S.x0 - H.x0, 0.2, 0.03), [(H.x0 + S.x0) / 2, 0.1, H.z0 + 0.015]));
  sk.push(bake(boxG(H.x1 - S.x1, 0.2, 0.03), [(S.x1 + H.x1) / 2, 0.1, H.z0 + 0.015]));
  sk.push(bake(boxG(H.x1 - H.x0, 0.2, 0.03), [0, 0.1, H.z1 - 0.015]));
  sk.push(bake(boxG(0.03, 0.2, H.z1 - H.z0), [H.x0 + 0.015, 0.1, 0]));
  addMerged(ctx, sk, skMat, 'r4:skirting');

  // 水磨石地面（UV 按 2m 一张平铺）+ 贴墙一道深色水泥边 + 南墙根的排水篦子
  const tz = ctx.track(terrazzoTexture());
  tz.wrapS = tz.wrapT = THREE.RepeatWrapping;
  tz.repeat.set((H.x1 - H.x0) / 2, (H.z1 - H.z0) / 2);
  tz.anisotropy = 4;
  const floorMat = ctx.track(new THREE.MeshStandardMaterial({ map: tz, roughness: 0.38, metalness: 0.02 }));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(H.x1 - H.x0, H.z1 - H.z0).rotateX(-Math.PI / 2), floorMat);
  floor.name = 'r4:floor';
  ctx.add(floor);
  const edge = MATERIALS.cloth('#3a3d38');
  const edges: THREE.BufferGeometry[] = [];
  edges.push(bake(boxG(H.x1 - H.x0, 0.01, 0.22), [0, 0.005, H.z0 + 0.11]));
  edges.push(bake(boxG(H.x1 - H.x0, 0.01, 0.22), [0, 0.005, H.z1 - 0.11]));
  addMerged(ctx, edges, edge, 'r4:floorEdge', undefined, false);
  const grateMat = ctx.track(new THREE.MeshStandardMaterial({ color: '#1c1e1f', roughness: 0.55, metalness: 0.5 }));
  const grates: THREE.BufferGeometry[] = [];
  for (let x = H.x0 + 0.6; x < H.x1 - 0.6; x += 0.9) for (let k = 0; k < 6; k++) grates.push(bake(boxG(0.03, 0.012, 0.16), [x + k * 0.12, 0.012, H.z1 - 0.3]));
  addMerged(ctx, grates, grateMat, 'r4:grates');

  // 顶：水泥板 + 每 5m 一道梁 + 北侧的电缆桥架与两根水管
  const conc = MATERIALS.concrete();
  const ceil: THREE.BufferGeometry[] = [bake(boxG(H.x1 - H.x0, 0.2, H.z1 - H.z0), [0, H.h + 0.1, 0])];
  for (let x = -17.5; x <= 17.5; x += 5) ceil.push(bake(boxG(0.32, 0.26, H.z1 - H.z0), [x, H.h - 0.13, 0]));
  // 楼梯井的斜顶（与楼梯平行，净高 3m）
  const stairLen = S.zTop - H.z0;
  const slope = Math.atan2(S.rise, S.run);
  const sl = boxG(S.x1 - S.x0 + 0.4, 0.2, Math.abs(stairLen) / Math.cos(slope) + 0.4);
  sl.rotateX(slope);
  ceil.push(bake(sl, [(S.x0 + S.x1) / 2, H.h + 0.1 + (Math.abs(stairLen) * S.rise) / S.run / 2, (H.z0 + S.zTop) / 2]));
  addMerged(ctx, ceil, conc, 'r4:ceiling', undefined, false);
  const metal = MATERIALS.metal();
  const tray: THREE.BufferGeometry[] = [];
  tray.push(bake(boxG(H.x1 - H.x0 - 1, 0.08, 0.3), [0.5, 2.62, H.z0 + 0.2]));
  for (let x = -19; x < 20; x += 2.5) tray.push(bake(boxG(0.03, 0.34, 0.03), [x, 2.79, H.z0 + 0.32]));
  addMerged(ctx, tray, metal, 'r4:tray', undefined, false);
  const pipeMat = ctx.track(new THREE.MeshStandardMaterial({ color: '#4a5a52', roughness: 0.6, metalness: 0.35 }));
  const pipes: THREE.BufferGeometry[] = [];
  for (const [z, y, r] of [[H.z1 - 0.18, 2.78, 0.06], [H.z1 - 0.34, 2.84, 0.04]] as const) {
    const p = cylG(r, r, H.x1 - H.x0, 10);
    p.rotateZ(Math.PI / 2);
    pipes.push(bake(p, [0, y, z]));
    for (let x = -19; x < 20; x += 3) pipes.push(bake(boxG(0.04, 0.1, 0.04), [x, y + 0.08, z]));
  }
  addMerged(ctx, pipes, pipeMat, 'r4:pipes');
  // 碰撞：地面、四面墙、楼梯井（楼梯不可走：出口触发体在楼梯口，井里 z=-3.7 处封住）
  ctx.collider.floor(H.x0, H.z0, H.x1, H.z1, 0);
  ctx.collider.wall([H.x0, H.z0], [S.x0, H.z0], 0, H.h);
  ctx.collider.wall([S.x1, H.z0], [H.x1, H.z0], 0, H.h);
  ctx.collider.wall([H.x0, H.z1], [H.x1, H.z1], 0, H.h);
  ctx.collider.wall([H.x0, H.z0], [H.x0, H.z1], 0, H.h);
  ctx.collider.wall([R4L.hoardingX, H.z0], [R4L.hoardingX, H.z1], 0, H.h);
  ctx.collider.wall([S.x0, H.z0], [S.x0, -3.9], 0, H.h);
  ctx.collider.wall([S.x1, H.z0], [S.x1, -3.9], 0, H.h);
  ctx.collider.wall([S.x0, -3.8], [S.x1, -3.8], 0, H.h);
  // 顶板也要碰撞体（M3）：第三人称相机的避障只认碰撞体，低头看摊桌时（俯仰 -35°）吊臂会把相机顶到 3.3m，钻到顶板上面去，
  // 画面里多出一截顶板、准星射线先打在顶板上（interact 旧书时 not_focusable）
  ctx.collider.box([0, H.h + 0.1, 0], [H.x1 - H.x0, 0.2, H.z1 - H.z0]);
}

// ———————————————————————————————————————————— 楼梯口

function buildStairs(ctx: AreaContext): void {
  const S = R4L.stairs;
  const steps = Math.round((S.zTop - R4L.hall.z0) / -S.run);
  const st = stairsVisual({ width: S.x1 - S.x0, rise: S.rise, run: S.run, steps, landing: 1.2, rail: true });
  st.position.set((S.x0 + S.x1) / 2, 0, R4L.hall.z0 - 0.02);
  ctx.add(st);
  // 雨水从街面顺着台阶淌下来：台阶脚下一滩积水、台阶上几道湿痕
  const wet = ctx.track(new THREE.MeshStandardMaterial({ color: '#141a18', roughness: 0.03, metalness: 0.25, transparent: true, opacity: 0.42, depthWrite: false }));
  const r = rng(71);
  const puddles: THREE.BufferGeometry[] = [];
  for (const [x, z, sx, sz] of [[-18.1, -2.35, 1.5, 0.9], [-17.2, -1.4, 0.9, 0.6], [-16.1, -0.4, 0.6, 0.4], [-18.8, -0.9, 0.5, 0.7]] as const) {
    const g = new THREE.CircleGeometry(0.5, 20);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 1; i < p.count; i++) p.setXY(i, p.getX(i) * range(r, 0.8, 1.2), p.getY(i) * range(r, 0.8, 1.2));
    g.rotateX(-Math.PI / 2);
    puddles.push(bake(g, [x, 0.004, z], 0, [sx * 2, 1, sz * 2]));
  }
  const pm = addMerged(ctx, puddles, wet, 'r4:puddles', undefined, false);
  pm.renderOrder = 1;
  pm.userData.noOcclude = true;
  // 路牌“人民路地下通道”（楼梯口上方，面朝通道）
  const signTex = ctx.track(streetSignTexture(TEXT.decor.stairSign, TEXT.decor.stairSub));
  const signMat = ctx.track(new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.45, metalness: 0.2, emissive: '#ffffff', emissiveMap: signTex, emissiveIntensity: 0.12 }));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.48), signMat);
  sign.position.set((S.x0 + S.x1) / 2, 2.62, R4L.hall.z0 + 0.03);
  sign.name = 'r4:stairSign';
  ctx.add(sign);
  // 街面的一角夜空（楼梯尽头的开口）
  const skyMat = ctx.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.NIGHT).multiplyScalar(1.4), fog: false }));
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), skyMat);
  sky.position.set((S.x0 + S.x1) / 2, steps * S.rise + 2.5, S.zTop - 1.3);
  ctx.add(sky, { occlude: false });
  // 路灯漏进楼梯井的光（真实点光 1 盏）
  const spill = designLight('point', PALETTE.SODIUM, 1.0, 8);
  spill.name = 'r4:streetSpill';
  spill.position.set(...R4L.streetSpill);
  ctx.light(spill);
  // 楼梯墙上的雨痕与霉斑
  for (const [z, s] of [[-4.2, 3], [-6.4, 5]] as const) {
    decal(ctx, ctx.track(stainDecalTexture(s)), 1.6, 2.2, [S.x0 + 0.01, 1.6 + (-z - 3) * 0.5, z], Math.PI / 2);
    decal(ctx, ctx.track(stainDecalTexture(s + 1)), 1.6, 2.2, [S.x1 - 0.01, 1.6 + (-z - 3) * 0.5, z - 0.6], -Math.PI / 2);
  }
}

// ———————————————————————————————————————————— 灯管

function buildTubes(ctx: AreaContext): TubeRig {
  const xs: number[] = [];
  for (let x = -18; x <= 18.01; x += 3) xs.push(x);
  // 坏的、闪的（GDD §4.5：一闪一闪的日光灯管）；真实光跟着离它最近的好灯管（x=-13 → -12 闪、-1 → 0 闪、11 → 12 常亮），
  // 所以楼梯口进来第一段地上的光就是一闪一闪的。楼梯口头顶那根（-15）常亮：进来第一眼总有一根亮着的灯管
  const kind = xs.map(x => (x === -9 || x === 15 ? 2 : x === 0 || x === -12 || x === 9 ? 1 : 0));
  const holderGeo = new THREE.BoxGeometry(1.3, 0.05, 0.12);
  const holders = new THREE.InstancedMesh(holderGeo, MATERIALS.metal(), xs.length);
  const tubeGeo = new THREE.CylinderGeometry(0.022, 0.022, 1.2, 8).rotateZ(Math.PI / 2);
  // 灯管本身 HDR 自发光：管芯烧白、Bloom 出一圈冷绿的晕（×5 同 kit 的 fluorescent 灯罩时，近处的两根连着顶板的光晕糊成一团）
  const mat = new THREE.MeshBasicMaterial({ color: TUBE_GLOW.clone().multiplyScalar(3.5) });
  mat.userData.tempC = TEMP_C.lamp;
  const tubes = new THREE.InstancedMesh(tubeGeo, mat, xs.length * 2);
  const m = new THREE.Matrix4();
  xs.forEach((x, i) => {
    holders.setMatrixAt(i, m.makeTranslation(x, 2.945, 0));
    tubes.setMatrixAt(i * 2, m.makeTranslation(x, 2.9, -0.035));
    tubes.setMatrixAt(i * 2 + 1, m.makeTranslation(x, 2.9, 0.035));
    const c = new THREE.Color(1, 1, 1);
    if (kind[i] === 2) c.setRGB(0.05, 0.05, 0.05);
    tubes.setColorAt(i * 2, c);
    tubes.setColorAt(i * 2 + 1, c);
  });
  holders.instanceMatrix.needsUpdate = true;
  tubes.instanceMatrix.needsUpdate = true;
  if (tubes.instanceColor) tubes.instanceColor.needsUpdate = true;
  holders.computeBoundingSphere();
  tubes.computeBoundingSphere();
  holders.name = 'r4:tubeHolders';
  tubes.name = 'r4:tubes';
  ctx.track(mat);
  ctx.add(holders);
  ctx.add(tubes);
  // 顶板上的一团冷光（真实灯是朝下的聚光，顶板照不到；光管往上散的那点光用贴花假一下，不加灯）
  const glowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#CFF5E1').multiplyScalar(0.13), alphaMap: ctx.track(radialGlowMask()), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  ctx.track(glowMat);
  const glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.6, 1.6).rotateX(Math.PI / 2), glowMat, xs.length);
  glow.name = 'r4:tubeGlow';
  xs.forEach((x, i) => {
    glow.setMatrixAt(i, m.makeTranslation(x, R4L.hall.h - 0.012, 0));
    glow.setColorAt(i, new THREE.Color(1, 1, 1));
  });
  glow.instanceMatrix.needsUpdate = true;
  if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
  glow.computeBoundingSphere();
  glow.renderOrder = 3;
  glow.userData.irHide = true;
  glow.userData.noOcclude = true;
  glow.raycast = () => {};
  ctx.add(glow, { occlude: false });
  const lights: THREE.SpotLight[] = [];
  const base: number[] = [];
  for (const p of R4L.tubeLights) {
    const l = designLight('spot', '#CFF5E1', 1.5, 8) as THREE.SpotLight;
    // 72° 半角：3m 外的墙面照到 2m 高左右（瓷砖、壁画都亮），顶板只剩半球光与灯管本身的自发光
    l.angle = 72 * (Math.PI / 180);
    l.penumbra = 0.55;
    l.name = 'r4:tubeLight';
    l.position.set(p[0], p[1], p[2]);
    ctx.light(l);
    lights.push(l);
    base.push(l.intensity);
  }
  return { mesh: tubes, mat, xs, kind, lights, base, glow };
}

// ———————————————————————————————————————————— 墙上的东西

function buildWallDressing(ctx: AreaContext): { rulesBoard: THREE.Object3D; warn: THREE.MeshBasicMaterial } {
  const H = R4L.hall;
  // 褪色公益壁画（南墙 x∈[-15.4,-4.4]）+ 一圈水泥框
  const muralTex = ctx.track(muralTexture());
  muralTex.anisotropy = 4;
  const mural = new THREE.Mesh(new THREE.PlaneGeometry(11, 1.72), ctx.track(new THREE.MeshStandardMaterial({ map: muralTex, roughness: 0.9 })));
  mural.rotation.y = Math.PI;
  mural.position.set(-9.9, 1.98, H.z1 - 0.02);
  mural.name = 'r4:mural';
  ctx.add(mural);
  const frame: THREE.BufferGeometry[] = [];
  frame.push(bake(boxG(11.2, 0.08, 0.05), [-9.9, 2.88, H.z1 - 0.02]));
  frame.push(bake(boxG(11.2, 0.08, 0.05), [-9.9, 1.08, H.z1 - 0.02]));
  addMerged(ctx, frame, MATERIALS.concrete(), 'r4:muralFrame', undefined, false);

  // 小广告（贴在瓷砖上，几张一簇）
  const ads = TEXT.decor.posters.map((lines, i) => ctx.track(adSheetTexture(lines, 300 + i)));
  const r = rng(909);
  const spots: [number, number, number, number][] = [
    [-14.2, 1.4, H.z0 + 0.012, 0], [-13.8, 1.1, H.z0 + 0.012, 0], [-6.9, 1.5, H.z0 + 0.012, 0], [3.4, 1.35, H.z0 + 0.012, 0],
    [9.1, 1.25, H.z0 + 0.012, 0], [-1.2, 1.45, H.z1 - 0.012, Math.PI], [7.2, 1.3, H.z1 - 0.012, Math.PI], [13.6, 1.5, H.z1 - 0.012, Math.PI],
  ];
  spots.forEach(([x, y, z, ry], i) => {
    const d = decal(ctx, ads[i % ads.length] as THREE.Texture, 0.34, 0.51, [x, y, z], ry, { order: 2 });
    d.rotation.z = range(r, -0.06, 0.06);
  });
  // 水渍霉斑
  for (const [x, z, ry, s] of [[-2.5, H.z0 + 0.012, 0, 11], [12.8, H.z1 - 0.012, Math.PI, 12], [17.5, H.z0 + 0.012, 0, 13], [5, H.z1 - 0.012, Math.PI, 14]] as const) {
    decal(ctx, ctx.track(stainDecalTexture(s)), 1.8, 1.4, [x, 0.9, z], ry);
  }

  // 安全出口灯箱（吊在楼梯口东边的顶上，两面朝东西）
  const exitTex = ctx.track(exitSignTexture());
  const exitMat = ctx.track(new THREE.MeshStandardMaterial({ map: exitTex, emissiveMap: exitTex, emissive: '#ffffff', emissiveIntensity: 1.25, roughness: 0.5 }));
  exitMat.userData.tempC = TEMP_C.ambient;
  const exitBox = new THREE.Group();
  exitBox.name = 'r4:exitSign';
  exitBox.add(box(0.05, 0.3, 0.8, MATERIALS.cloth('#d9ded8')));
  for (const s of [1, -1]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.29), exitMat);
    f.rotation.y = (s * Math.PI) / 2;
    f.position.x = s * 0.027;
    exitBox.add(f);
  }
  exitBox.add(box(0.01, 0.2, 0.01, MATERIALS.metal(), [0, 0.25, -0.3]));
  exitBox.add(box(0.01, 0.2, 0.01, MATERIALS.metal(), [0, 0.25, 0.3]));
  exitBox.position.set(-15.6, 2.55, -1.0);
  ctx.add(exitBox);

  // 消火栓（南墙，红门白字）、电表箱（北墙，灰铁皮）
  const fireTex = ctx.track(plateTexture(TEXT.decor.fireBox, '#b3221b', '#f5f0e6', { w: 256, h: 128 }));
  const fire = new THREE.Group();
  fire.add(box(0.7, 0.9, 0.2, MATERIALS.enamelRed(), [0, 0, 0]));
  const fireFace = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), ctx.track(new THREE.MeshStandardMaterial({ map: fireTex, roughness: 0.4 })));
  fireFace.position.set(0, 0.2, 0.101);
  fire.add(fireFace);
  fire.add(box(0.6, 0.35, 0.01, MATERIALS.glass(), [0, -0.15, 0.105]));
  fire.rotation.y = Math.PI;
  fire.position.set(-16.2, 1.05, H.z1 - 0.1);
  ctx.add(fire);
  const meterTex = ctx.track(plateTexture(TEXT.decor.meterBox, '#9aa0a2', '#1a1a1a', { w: 512, h: 96 }));
  const meter = new THREE.Group();
  meter.add(box(0.8, 0.6, 0.22, MATERIALS.metal(), [0, 0, 0]));
  const meterFace = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.12), ctx.track(new THREE.MeshStandardMaterial({ map: meterTex, roughness: 0.5 })));
  meterFace.position.set(0, 0.18, 0.111);
  meter.add(meterFace);
  meter.position.set(-3.2, 1.9, H.z0 + 0.11);
  ctx.add(meter);

  // 规矩牌（丑时起挂在楼梯口东边的北墙上；木框 + 贴着的大白纸）
  const rbTex = ctx.track(rulesBoardTexture());
  rbTex.anisotropy = 4;
  const rb = new THREE.Group();
  rb.name = 'r4:rulesBoard';
  rb.add(box(0.66, 1.26, 0.05, MATERIALS.wood(), [0, 0, 0]));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.2), ctx.track(new THREE.MeshStandardMaterial({ map: rbTex, roughness: 0.85 })));
  face.position.z = 0.026;
  rb.add(face);
  rb.position.set(...R4L.rulesBoard);
  rb.position.z += 0.02;
  ctx.add(rb);

  // 东头：地铁施工围挡（面朝西）+ 施工牌 + 三只黄闪灯
  const hoard = PROPS.hoarding(H.z1 - H.z0, 2.7);
  hoard.rotation.y = Math.PI / 2;
  hoard.position.set(R4L.hoardingX, 0, 0);
  ctx.add(hoard);
  const plateTex = ctx.track(plateTexture(TEXT.decor.hoardingPlate, '#f2c230', '#141414', { w: 512, h: 192, stripes: true, size: 64 }));
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.56), ctx.track(new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.6 })));
  plate.rotation.y = -Math.PI / 2;
  plate.position.set(R4L.hoardingX - 0.03, 0.9, -0.9);
  ctx.add(plate);
  const warn = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb020').multiplyScalar(3) });
  warn.userData.tempC = TEMP_C.ambient;
  ctx.track(warn);
  const warnGeo: THREE.BufferGeometry[] = [];
  for (const z of [-2.2, 0, 2.2]) warnGeo.push(bake(new THREE.SphereGeometry(0.06, 10, 8), [R4L.hoardingX - 0.08, 2.78, z]));
  addMerged(ctx, warnGeo, warn, 'r4:warnLights', undefined, false);
  // 围挡前：一排红白水马、三只锥筒、一小垛沙袋、一截没收的电缆盘（地铁工地堆过来的）
  const H2 = R4L.hoardingX;
  const red = MATERIALS.enamelRed();
  const white = ctx.track(new THREE.MeshStandardMaterial({ color: '#dcdad2', roughness: 0.6 }));
  const bars: { r: THREE.BufferGeometry[]; w: THREE.BufferGeometry[] } = { r: [], w: [] };
  [-2.1, -1.05, 0, 1.05, 2.1].forEach((z, i) => {
    // 水马：梯形截面（底宽顶窄）的一截，沿 z 摆成一排
    const g = new THREE.CylinderGeometry(0.16, 0.24, 0.62, 4, 1).rotateY(Math.PI / 4);
    g.scale(1, 1, 3.1);
    (i % 2 ? bars.w : bars.r).push(bake(g, [H2 - 0.75, 0.31, z]));
  });
  addMerged(ctx, bars.r, red, 'r4:barriersRed', undefined, false);
  addMerged(ctx, bars.w, white, 'r4:barriersWhite');
  ctx.collider.box([H2 - 0.75, 0.31, 0], [0.5, 0.62, H.z1 - H.z0]);
  const orange = ctx.track(new THREE.MeshStandardMaterial({ color: '#e0561f', roughness: 0.55 }));
  const cones: THREE.BufferGeometry[] = [], bands: THREE.BufferGeometry[] = [];
  for (const [x, z, tilt] of [[H2 - 1.6, -1.6, 0], [H2 - 1.45, 0.9, 0], [H2 - 2.3, 1.7, 1]] as const) {
    if (tilt) {
      // 倒在地上的一只
      cones.push(bake(new THREE.ConeGeometry(0.13, 0.48, 12), [x, 0.13, z], 30, 1, [0, 0, 90]));
      bands.push(bake(new THREE.CylinderGeometry(0.078, 0.092, 0.07, 12), [x - 0.02, 0.13, z], 30, 1, [0, 0, 90]));
      continue;
    }
    cones.push(bake(new THREE.ConeGeometry(0.13, 0.48, 12), [x, 0.27, z]));
    cones.push(bake(new THREE.BoxGeometry(0.34, 0.03, 0.34), [x, 0.015, z]));
    bands.push(bake(new THREE.CylinderGeometry(0.066, 0.08, 0.07, 12), [x, 0.3, z]));
  }
  addMerged(ctx, cones, orange, 'r4:cones');
  addMerged(ctx, bands, white, 'r4:coneBands', undefined, false);
  const sack = ctx.track(new THREE.MeshStandardMaterial({ color: '#8d8467', roughness: 1 }));
  const sacks: THREE.BufferGeometry[] = [];
  const rs = rng(3030);
  for (let i = 0; i < 7; i++) {
    const row = i < 4 ? 0 : 1;
    const k = row ? i - 4 : i;
    const g = new THREE.SphereGeometry(0.2, 10, 6);
    g.scale(1.45, 0.42, 0.85);
    sacks.push(bake(g, [H2 - 1.3 + range(rs, -0.03, 0.03), 0.08 + row * 0.15, -2.55 + k * 0.42 + row * 0.2], range(rs, -8, 8) + 90));
  }
  addMerged(ctx, sacks, sack, 'r4:sandbags');
  ctx.collider.box([H2 - 1.3, 0.2, -2.1], [0.6, 0.4, 1.8]);
  const spool = new THREE.Group();
  spool.name = 'r4:cableSpool';
  const plank = MATERIALS.wood();
  for (const zz of [-0.18, 0.18]) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 16).rotateX(Math.PI / 2), plank);
    disc.position.z = zz;
    spool.add(disc);
  }
  const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.32, 16).rotateX(Math.PI / 2), MATERIALS.cloth('#161616'));
  spool.add(coil);
  spool.position.set(H2 - 1.1, 0.42, 2.45);
  spool.rotation.y = 0.3;
  ctx.add(spool);
  ctx.collider.box([H2 - 1.1, 0.42, 2.45], [0.9, 0.84, 0.6]);
  // 围挡前地上一层黄泥浆脚印（从工地那边带出来的）
  const mudTex = ctx.track(stainDecalTexture(21));
  const mud = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5.4).rotateX(-Math.PI / 2), ctx.track(new THREE.MeshStandardMaterial({
    map: mudTex, color: '#8a7040', transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })));
  mud.position.set(H2 - 1.7, 0.006, 0);
  mud.renderOrder = 1;
  mud.userData.noOcclude = true;
  ctx.add(mud, { occlude: false });
  // 围挡上沿与顶板之间漏出来一线工地灯的冷光（只用 emissive，不加灯）
  const leakTex = ctx.track(leakGlowTexture());
  const leak = new THREE.Mesh(new THREE.PlaneGeometry(H.z1 - H.z0, 0.5), ctx.track(new THREE.MeshBasicMaterial({
    map: leakTex, color: new THREE.Color('#E6F2FF').multiplyScalar(2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })));
  leak.rotation.y = -Math.PI / 2;
  leak.position.set(H.x1 - 0.1, H.h - 0.26, 0);
  leak.userData.irHide = true;
  ctx.add(leak, { occlude: false });
  // 围挡后面：一片黑（工地），顶上漏一点点工地灯的冷光
  const back = new THREE.Mesh(new THREE.PlaneGeometry(H.z1 - H.z0 + 1, 3.2), ctx.track(new THREE.MeshBasicMaterial({ color: '#050607' })));
  back.rotation.y = -Math.PI / 2;
  back.position.set(H.x1 + 0.05, 1.5, 0);
  ctx.add(back, { occlude: false });

  return { rulesBoard: rb, warn };
}

// ———————————————————————————————————————————— 报刊亭与地上的生活痕迹

function buildProps(ctx: AreaContext): THREE.Object3D {
  const K = R4L.kiosk;
  const kiosk = PROPS.kiosk();
  kiosk.rotation.y = Math.PI;
  kiosk.position.set(K[0], 0, K[2]);
  ctx.add(kiosk);
  ctx.collider.box([K[0], 1.15, K[2]], [2.05, 2.3, 1.55]);
  // 报刊亭门口：几捆没拆的旧报纸、一只折叠凳、一个痰盂
  const paperMat = ctx.track(new THREE.MeshStandardMaterial({ color: '#cfc8b4', roughness: 0.95 }));
  const bundles: THREE.BufferGeometry[] = [];
  for (const [x, z, y, ry] of [[-11.2, -1.2, 0.11, 8], [-11.1, -1.25, 0.33, -6], [-9.2, -1.25, 0.11, 20]] as const) bundles.push(bake(boxG(0.46, 0.22, 0.32), [x, y, z], ry));
  addMerged(ctx, bundles, paperMat, 'r4:bundles');
  const string = ctx.track(new THREE.MeshStandardMaterial({ color: '#8a6a3a', roughness: 0.9 }));
  const strings: THREE.BufferGeometry[] = [];
  for (const [x, z, y, ry] of [[-11.2, -1.2, 0.11, 8], [-11.1, -1.25, 0.33, -6], [-9.2, -1.25, 0.11, 20]] as const) strings.push(bake(boxG(0.02, 0.225, 0.325), [x, y, z], ry));
  addMerged(ctx, strings, string, 'r4:bundleStrings');
  const stool = PROPS.stool();
  stool.position.set(-8.7, 0, -1.2);
  stool.rotation.y = 0.4;
  ctx.add(stool);
  // 痰盂（白搪瓷红边）
  const prof = [[0.001, 0], [0.12, 0], [0.13, 0.04], [0.1, 0.16], [0.08, 0.2], [0.13, 0.26], [0.14, 0.27], [0.1, 0.27]].map(([x, y]) => new THREE.Vector2(x ?? 0, y ?? 0));
  const spit = new THREE.Mesh(new THREE.LatheGeometry(prof, 18), MATERIALS.porcelain());
  spit.position.set(-8.95, 0, -1.65);
  ctx.add(spit);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 6, 18).rotateX(Math.PI / 2), MATERIALS.enamelRed());
  rim.position.set(-8.95, 0.27, -1.65);
  ctx.add(rim);
  // 北墙上一部 IC 卡公用电话（橙蓝半圆罩，九十年代的样子）；听筒挂在一边，线垂着
  const H = R4L.hall;
  const phone = new THREE.Group();
  phone.name = 'r4:payphone';
  const hoodMat = ctx.track(new THREE.MeshStandardMaterial({ color: '#d9722c', roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide }));
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.72, 16, 1, true, -Math.PI / 2, Math.PI), hoodMat);
  hood.position.set(0, 1.55, 0);
  phone.add(hood);
  // 半圆顶盖：扇形 θ∈[0,π] 在 +y 半边，绕 x 转 +90° 后落在 +z 半边（朝通道）
  const capTop = new THREE.Mesh(new THREE.CircleGeometry(0.36, 16, 0, Math.PI).rotateX(Math.PI / 2), hoodMat);
  capTop.position.set(0, 1.91, 0);
  phone.add(capTop);
  const signTex = ctx.track(payphoneSignTexture(TEXT.decor.phone.sign));
  const signMat = ctx.track(new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.5, emissive: '#ffffff', emissiveMap: signTex, emissiveIntensity: 0.08 }));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.365, 0.365, 0.14, 16, 1, true, -Math.PI / 2, Math.PI), signMat);
  band.position.set(0, 1.84, 0);
  phone.add(band);
  const faceTex = ctx.track(payphoneFaceTexture());
  const body = box(0.24, 0.36, 0.12, MATERIALS.metal(), [0, 1.5, 0.08]);
  phone.add(body);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.33), ctx.track(new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.6 })));
  face.position.set(0, 1.5, 0.141);
  phone.add(face);
  const handset = box(0.05, 0.24, 0.06, MATERIALS.cloth('#1c1d1f'), [-0.16, 1.52, 0.12]);
  handset.rotation.z = 0.08;
  phone.add(handset);
  const cordPts = [new THREE.Vector3(-0.16, 1.4, 0.13), new THREE.Vector3(-0.17, 1.22, 0.16), new THREE.Vector3(-0.1, 1.16, 0.15), new THREE.Vector3(-0.06, 1.34, 0.12)];
  phone.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cordPts), 16, 0.006, 4), MATERIALS.cloth('#1c1d1f')));
  phone.position.set(-8.1, 0, H.z0 + 0.02);
  ctx.add(phone);
  ctx.collider.box([-8.1, 1.55, H.z0 + 0.2], [0.74, 0.76, 0.4]);

  // 楼梯口西边一辆锁着的旧自行车（靠南墙）、垃圾桶、“小心地滑”牌
  const bike = PROPS.bicycle(4);
  bike.rotation.y = 0.12;
  bike.position.set(-19.2, 0, 2.62);
  ctx.add(bike);
  ctx.collider.box([-19.2, 0.5, 2.6], [1.9, 1.0, 0.4]);
  const bin = PROPS.trashBin();
  bin.position.set(-14.6, 0, 2.62);
  ctx.add(bin, { collide: true });
  const wf = new THREE.Group();
  const yellow = MATERIALS.enamelYellow();
  const wfTex = ctx.track(plateTexture(TEXT.decor.wetFloor, '#f2c230', '#141414', { w: 256, h: 96 }));
  const wfFace = ctx.track(new THREE.MeshStandardMaterial({ map: wfTex, roughness: 0.4 }));
  for (const s of [1, -1]) {
    const leaf = new THREE.Group();
    leaf.add(box(0.34, 0.62, 0.015, yellow, [0, 0.31, 0]));
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.11), wfFace);
    f.position.set(0, 0.42, s * 0.009);
    if (s < 0) f.rotation.y = Math.PI;
    leaf.add(f);
    leaf.rotation.x = s * 0.2;
    leaf.position.z = s * 0.06;
    wf.add(leaf);
  }
  wf.position.set(-19.5, 0, -1.9);
  wf.rotation.y = 1.2;
  ctx.add(wf);
  // 墙角一把竹扫帚
  const broom = new THREE.Group();
  broom.add(box(0.025, 1.2, 0.025, MATERIALS.wood(), [0, 0.75, 0]));
  broom.add(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 8, 1, true), ctx.track(new THREE.MeshStandardMaterial({ color: '#8a7446', roughness: 1, side: THREE.DoubleSide }))));
  broom.children[1]?.position.set(0, 0.16, 0);
  broom.rotation.z = 0.16;
  broom.position.set(-20.25, 0, 2.2);
  ctx.add(broom);
  return kiosk;
}

/** 通道本体。返回会随时辰/开市变化的部件。 */
export function buildCorridor(ctx: AreaContext): CorridorRig {
  buildShell(ctx);
  buildStairs(ctx);
  const tubes = buildTubes(ctx);
  const { rulesBoard, warn } = buildWallDressing(ctx);
  buildProps(ctx);
  // 半球光：开市前 #CFF5E1/#0D1512 0.15（AGENTS.md look-dev：地下通道开市前 0.15）；开市后在 logic 里换色降强度
  const hemi = ctx.hemi('#CFF5E1', '#0D1512', 0.15);
  return { tubes, rulesBoard, warn, hemi };
}
