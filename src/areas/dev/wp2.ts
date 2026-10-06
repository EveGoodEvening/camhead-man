// owner: WP2
// WP2 在开发沙盒里的测试夹具（ARCH §15.2 “沙盒要包含的夹具”），并用 debug/selftest.ts 的 registerSelftest('wp2.<snake>', fn) 登记页面内自测；
// scripts/selftest/wp2.mjs 经 __game.selftest(name)（?debug=1&area=dev）调用，也能在独立页面（假 Game，只有 renderer）里跑。
//
// 夹具（出生点身后的南边一条，WP2_ORIGIN 附近，x≈-3…4、z≈11…14，全部面朝北——站在出生点转过身就能看见；
// 从出生点往北做的测试都看不到它们。不加碰撞体、不加真实灯光，免得挡别的 WP 的走路测试、占本区的灯数预算）：
// 站着的老周（常光）、戴面具的黄三爷与同 seed 的实例化纸扎摊主并排、一个冷迹（红外）、一串湿脚印与一个残影旋涡
// （取景器）、一盏只有灯罩的门灯、一扇玻璃门、一块霓虹招牌。

import * as THREE from 'three';
import type { AreaContext, AreaPart } from '../../core/area';
import type { Game } from '../../core/game';
import type { PlayerController } from '../../core/player';
import type { ModeId, V3 } from '../../core/types';
import type { SelftestResult } from '../../debug/selftest';
import { registerSelftest } from '../../debug/selftest';
import { LAYER, isRenderableBy, layerMaskFor } from '../../core/layers';
import { LIGHT_SCALE, TEMP_C } from '../../data/render';
import { building } from '../../kit/building';
import { door } from '../../kit/doors';
import { lamp } from '../../kit/lamps';
import { rain } from '../../kit/rain';
import { createColdTrace, createFootprints, createResidueVortex } from '../../kit/residue';
import { sign } from '../../kit/signs';
import { detectCjk, makeTextTexture } from '../../kit/text';
import { createCharacter, type CharacterKind } from '../../rigs/characters';
import { createCrowd } from '../../rigs/crowd';
import { createPaperFigure, createPaperStalls, faceCellOf, vendorAtlas } from '../../rigs/paper';
import { PC_DIMS } from '../../rigs/cameraHead';
import { createPlayerModel, type PlayerModel } from '../../rigs/player';

/** 夹具基准点（M1c 若与别的 WP 的夹具重叠，只改这里）。 */
export const WP2_ORIGIN: V3 = [0.5, 0, 12.5];
const at = (dx: number, y: number, dz: number): V3 => [WP2_ORIGIN[0] + dx, WP2_ORIGIN[1] + y, WP2_ORIGIN[2] + dz];

// ---------------------------------------------------------------- 小工具

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

const f3 = (v: THREE.Vector3) => `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;

/** 只有 PlayerModel.update 用得到的字段的假控制器（签名是 PlayerController，测试里只读这几项）。 */
function fakePlayer(): PlayerController & { position: THREE.Vector3; velocity: THREE.Vector3 } {
  const p = { position: new THREE.Vector3(), velocity: new THREE.Vector3(), bodyYaw: 0, yaw: 0, pitch: 0, enabled: true, onGround: true };
  return p as unknown as PlayerController & { position: THREE.Vector3; velocity: THREE.Vector3 };
}

function step(m: PlayerModel, p: PlayerController, mode: ModeId, sec: number): void {
  const n = Math.max(1, Math.round(sec * 60));
  for (let i = 0; i < n; i++) m.update(1 / 60, p, mode);
}

function worldBox(o: THREE.Object3D): THREE.Box3 {
  o.updateWorldMatrix(true, true);
  const b = new THREE.Box3(), tmp = new THREE.Box3();
  o.traverseVisible(c => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || m.userData.noBounds) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    tmp.copy(m.geometry.boundingBox as THREE.Box3).applyMatrix4(m.matrixWorld);
    b.union(tmp);
  });
  return b;
}

function isDescendant(o: THREE.Object3D, anc: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === anc) return true;
  return false;
}

function camFor(role: 'tp' | 'fp' | 'mirror', vf: boolean): THREE.Camera {
  const c = new THREE.PerspectiveCamera();
  c.layers.disableAll();
  for (const l of layerMaskFor(role, { vf, lens: 'normal', replay: false })) c.layers.enable(LAYER[l]);
  return c;
}

/** 在一个离屏 RT 里渲一帧、读回像素（同一个 renderer；渲完恢复原来的渲染目标）。 */
function renderPixels(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, size = 192): Uint8Array {
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, depthBuffer: true });
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
  renderer.setRenderTarget(prev);
  rt.dispose();
  return px;
}

function testScene(): THREE.Scene {
  const s = new THREE.Scene();
  s.add(new THREE.AmbientLight('#ffffff', 0.6));
  const d = new THREE.DirectionalLight('#ffe6c8', 2.2);
  d.position.set(1.5, 3, -2.5);
  s.add(d);
  return s;
}

// ---------------------------------------------------------------- 页面内自测

/** PC_DIMS：镜头、贴条、帽顶、外壳上下沿、支架的世界高度；图层（ARCH §5.2、§4.7）。 */
registerSelftest('wp2.pc_dims', () => {
  const r = report();
  const m = createPlayerModel();
  const p = fakePlayer();
  step(m, p, 'mode.viewfinder', 0.5);
  const lens = m.head.lensAnchor.getWorldPosition(new THREE.Vector3());
  r.t('镜头中心离地 = PC_DIMS.lensY（±1cm）', Math.abs(lens.y - PC_DIMS.lensY) < 0.01, f3(lens));
  const st = m.stickerWorld();
  r.t('贴条中心离地 = PC_DIMS.stickerY（±1cm）', Math.abs(st.y - PC_DIMS.stickerY) < 0.01, f3(st));
  r.t('贴条在镜头正上方、前脸上（与镜头同一竖直面附近）', Math.abs(st.x - lens.x) < 0.02 && st.z < 0 && lens.z < st.z + 0.01, `${f3(st)} vs ${f3(lens)}`);
  const hat = worldBox(m.head.tinHat);
  r.t('铁皮帽顶 ≈ PC_DIMS.hatTopY（±1.5cm）', Math.abs(hat.max.y - PC_DIMS.hatTopY) < 0.015, hat.max.y.toFixed(3));
  const housing = m.head.group.getObjectByName('housing');
  const hb = housing ? worldBox(housing) : new THREE.Box3();
  r.t('外壳底边 1.77、顶边 1.99（±5mm）', Math.abs(hb.min.y - PC_DIMS.headBottomY) < 0.005 && Math.abs(hb.max.y - PC_DIMS.headTopY) < 0.005, `${hb.min.y.toFixed(3)}…${hb.max.y.toFixed(3)}`);
  const hs = hb.getSize(new THREE.Vector3());
  r.t('外壳 宽 0.20 × 高 0.22 × 长 0.34', Math.abs(hs.x - 0.2) < 0.003 && Math.abs(hs.y - 0.22) < 0.003 && Math.abs(hs.z - 0.34) < 0.003, f3(hs));
  const nb = worldBox(m.head.neck);
  r.t('支架圆柱从领口 1.50 伸到头底 1.77（±2cm）', Math.abs(nb.min.y - PC_DIMS.collarY) < 0.02 && Math.abs(nb.max.y - PC_DIMS.headBottomY) < 0.02, `${nb.min.y.toFixed(3)}…${nb.max.y.toFixed(3)}`);
  const lensR = m.head.group.getObjectByName('lensBarrel');
  const lr = lensR ? worldBox(lensR).getSize(new THREE.Vector3()) : new THREE.Vector3();
  r.t('镜头 r0.06', Math.abs(Math.max(lr.x, lr.y) / 2 - 0.06) < 0.004, f3(lr));
  // 图层
  let headOk = true, inkOk = false;
  m.head.group.traverse(o => {
    const mm = o as THREE.Mesh;
    if (!mm.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) return;
    if (o.name === 'stickerInk') inkOk = o.layers.mask === 1 << LAYER.self_sticker_vf;
    else if (o.layers.mask !== 1 << LAYER.self_head) headOk = false;
  });
  r.t('整颗头在 self_head 层（递归）', headOk);
  r.t('贴条字迹只在 self_sticker_vf 层', inkOk);
  r.t('支架圆柱在 self_head 层', m.head.neck.layers.mask === 1 << LAYER.self_head);
  let bodyWorld = true;
  m.body.root.traverse(o => {
    const mm = o as THREE.Mesh;
    if (mm.isMesh && !isDescendant(mm, m.head.group) && mm !== m.head.neck && mm.layers.mask !== 1) bodyWorld = false;
  });
  r.t('身子在 world 层', bodyWorld);
  r.t('第三人称看得见头、取景器看不见', isRenderableBy(m.head.group, camFor('tp', false)) && !isRenderableBy(m.head.group, camFor('fp', true)));
  const ink = m.head.sticker.getObjectByName('stickerInk') as THREE.Object3D;
  r.t('贴条字迹只有“镜面相机且取景器开启”看得见', isRenderableBy(ink, camFor('mirror', true)) && !isRenderableBy(ink, camFor('mirror', false)) && !isRenderableBy(ink, camFor('tp', false)));
  r.t('headMounted', m.headMounted === true);
  return r.done();
});

/** PlayerModel 的 setPose / setBodyOpacity / setVisible / detach / 变焦 / REC / 云台 / 视频线。 */
registerSelftest('wp2.player_api', () => {
  const r = report();
  const m = createPlayerModel();
  const p = fakePlayer();
  step(m, p, 'mode.explore', 0.2);
  m.setPose('sit', 0);
  step(m, p, 'mode.cutscene', 0.2);
  const sitLens = m.head.lensAnchor.getWorldPosition(new THREE.Vector3()).y;
  r.t('sit：整个人矮下去（镜头 < 1.45）', sitLens < 1.45, sitLens.toFixed(3));
  p.velocity.set(0, 0, -2.2);
  step(m, p, 'mode.explore', 0.6);
  p.velocity.set(0, 0, 0);
  step(m, p, 'mode.explore', 0.6);
  const standLens = m.head.lensAnchor.getWorldPosition(new THREE.Vector3()).y;
  r.t('移动时自动回到站姿（镜头回到 1.85 附近）', Math.abs(standLens - PC_DIMS.lensY) < 0.04, standLens.toFixed(3));
  // 取景器：头跟着视角转
  p.yaw = 40;
  p.pitch = 20;
  step(m, p, 'mode.viewfinder', 0.6);
  const lens = m.head.lensAnchor.getWorldPosition(new THREE.Vector3());
  r.t('取景器里云台跟着 yaw 转（镜头偏向东）、跟着 pitch 抬头', lens.x > 0.05 && lens.y > PC_DIMS.lensY - 0.005, f3(lens));
  p.yaw = 0;
  p.pitch = 0;
  // 变焦：镜头环转到对应角度
  const ring0 = m.head.lensRing.rotation.z;
  m.head.setZoom(4);
  step(m, p, 'mode.viewfinder', 1);
  r.t('setZoom(4)：镜头环转过去', Math.abs(m.head.lensRing.rotation.z - ring0) > 1, m.head.lensRing.rotation.z.toFixed(2));
  // REC：一秒内亮灭各有
  const led = m.head.recLed.material as THREE.MeshStandardMaterial;
  let on = 0, off = 0;
  for (let i = 0; i < 60; i++) {
    m.update(1 / 60, p, 'mode.explore');
    if (led.emissiveIntensity > 0) on++;
    else off++;
  }
  r.t('REC 灯每秒闪一次（亮暗都有）', on > 10 && off > 10, `亮 ${on} 帧 / 暗 ${off} 帧`);
  // 待机云台扫描
  step(m, p, 'mode.explore', 5);
  const scan = m.head.lensAnchor.getWorldPosition(new THREE.Vector3());
  r.t('探索里站着不动 → 云台慢慢扫（镜头偏离正前方）', Math.abs(scan.x) > 0.03, f3(scan));
  // 视频线：插头垂在背后腰间
  const plug = m.head.cable.plug.getWorldPosition(new THREE.Vector3());
  r.t('BNC 插头垂到腰间（0.85–1.3m）、在背后（z > 0）', plug.y > 0.85 && plug.y < 1.3 && plug.z > 0.05, f3(plug));
  // 淡出
  m.setBodyOpacity(0, 1);
  step(m, p, 'mode.cutscene', 0.5);
  let mid = false;
  m.body.root.traverse(o => {
    const mm = o as THREE.Mesh;
    if (mm.isMesh && !isDescendant(mm, m.head.group) && mm.name === 'torso') mid = (mm.material as THREE.Material).transparent && (mm.material as THREE.Material).opacity < 0.9;
  });
  r.t('setBodyOpacity(0, 1)：一半时切成透明材质', mid);
  step(m, p, 'mode.cutscene', 0.7);
  const torso = m.body.root.getObjectByName('torso') as THREE.Mesh;
  r.t('淡完身子不渲染', torso.visible === false);
  r.t('头还在', m.head.group.visible === true && isRenderableBy(m.head.group, camFor('tp', false)));
  m.setBodyOpacity(1);
  r.t('恢复后回到不透明材质', torso.visible && (torso.material as THREE.Material).transparent === false);
  m.setVisible(false);
  r.t('setVisible(false)：身子与假阴影不见', !torso.visible && !m.blob.visible);
  m.setVisible(true);
  r.t('setVisible(true)', torso.visible && m.blob.visible);
  // 三脚架：摘头、装回
  const g = m.head.detach();
  r.t('detach()：返回头，headMounted = false', g === m.head.group && m.headMounted === false && g.parent === null);
  const bracket = new THREE.Group();
  bracket.add(g);
  step(m, p, 'mode.tripod', 0.3);
  m.head.reattach();
  step(m, p, 'mode.explore', 0.2);
  const back = m.head.lensAnchor.getWorldPosition(new THREE.Vector3());
  r.t('reattach()：装回领口，headMounted = true、镜头回到 1.85', m.headMounted && Math.abs(back.y - PC_DIMS.lensY) < 0.04, f3(back));
  // 摆位
  p.position.set(5, 0, -3);
  p.bodyYaw = 90;
  step(m, p, 'mode.explore', 0.1);
  r.t('root 跟随 PlayerController 的 position/bodyYaw', m.root.position.distanceTo(new THREE.Vector3(5, 0, -3)) < 1e-6 && Math.abs(m.root.rotation.y + Math.PI / 2) < 1e-6);
  return r.done();
});

/** 黄三爷 masked 复用纸扎摊主：包围盒一致、高清脸、变体、36.5℃（ARCH §5.3）。 */
registerSelftest('wp2.huang_masked', () => {
  const r = report();
  const seed = 5;
  const huang = createCharacter('huang', { variant: 'masked', seed });
  const paper = createPaperFigure({ kind: 'vendor', seed });
  const a = huang.bounds(new THREE.Box3()), b = worldBox(paper.root);
  const same = a.min.distanceTo(b.min) < 1e-4 && a.max.distanceTo(b.max) < 1e-4;
  r.t('masked 黄三爷与同 seed 纸扎摊主包围盒一致', same, `${f3(a.min)}…${f3(a.max)} vs ${f3(b.min)}…${f3(b.max)}`);
  const hd = huang.hdFace;
  r.t('hdFace 存在，lo() 就是摊主共用的贴图集', !!hd && hd.lo() === vendorAtlas() && (hd.mesh.material as THREE.MeshStandardMaterial).map === vendorAtlas());
  const hi = hd?.hi();
  const hiImg = hi?.image as HTMLCanvasElement | undefined;
  r.t('hi() 是另一张更大的贴图（首次调用才生成）', !!hi && hi !== vendorAtlas() && (hiImg?.width ?? 0) >= 2048);
  let warm = true;
  huang.root.traverse(o => {
    if ((o as THREE.Mesh).isMesh && o.userData.tempC !== TEMP_C.huang) warm = false;
  });
  r.t('整棵子树 userData.tempC = 36.5', warm);
  r.t('anchors.mouth 给 rd.huang_breath', !!huang.anchors.mouth);
  huang.setVariant?.('weasel');
  const vis = (k: string) => (huang.props[k] as THREE.Object3D).visible;
  r.t("setVariant('weasel')：只剩黄鼠狼", vis('weasel') && !vis('man') && !vis('masked'));
  huang.setVariant?.('man');
  r.t("setVariant('man')：只剩人形", vis('man') && !vis('weasel') && !vis('masked'));
  let lights = 0;
  huang.root.traverse(o => {
    if ((o as THREE.Light).isLight) lights++;
  });
  r.t('任何变体下都不挂灯', lights === 0);
  return r.done();
});

/** 1× 下 masked 黄三爷与同 seed 实例化摊主逐像素一致；换上高清贴图后嘴部不同且鼓瘪小平面出现。 */
registerSelftest('wp2.huang_pixels', (game: Game) => {
  const r = report();
  const renderer = game.renderer;
  const seed = 7;
  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
  // 纸人面朝 -z：相机放在前面（-z）往 +z 看；实例与纸人都用单位矩阵，保证顶点变换逐位相同
  cam.position.set(0.05, 1.3, -2.4);
  cam.lookAt(0, 1.15, 0);
  cam.updateMatrixWorld();
  const sA = testScene();
  const huang = createCharacter('huang', { variant: 'masked', seed });
  sA.add(huang.root);
  const pa = renderPixels(renderer, sA, cam);
  const sB = testScene();
  const stalls = createPaperStalls([{ pos: [0, 0, 0], yaw: 0, seed }]);
  sB.add(stalls);
  const pb = renderPixels(renderer, sB, cam);
  let diff = 0, lit = 0;
  for (let i = 0; i < pa.length; i += 4) {
    if (pa[i] !== pb[i] || pa[i + 1] !== pb[i + 1] || pa[i + 2] !== pb[i + 2]) diff++;
    if ((pa[i] ?? 0) + (pa[i + 1] ?? 0) + (pa[i + 2] ?? 0) > 30) lit++;
  }
  r.t('画面里真的有纸人', lit > 500, `${lit} px`);
  r.t('1×：与同 seed 实例化摊主逐像素一致', diff === 0, `${diff} px 不同`);
  const other = createPaperStalls([{ pos: [0, 0, 0], yaw: 0, seed: seed + 1 }]);
  const sC = testScene();
  sC.add(other);
  const pc = renderPixels(renderer, sC, cam);
  let diffOther = 0;
  for (let i = 0; i < pa.length; i += 4) if (pa[i] !== pc[i] || pa[i + 1] !== pc[i + 1] || pa[i + 2] !== pc[i + 2]) diffOther++;
  r.t('不同 seed 的摊主脸不同（格子选择生效）', faceCellOf(seed) === faceCellOf(seed + 1) || diffOther > 20, `${diffOther} px`);
  // ≥4×、≤5m：由 WP1 的 ctx.hdText 换贴图；这里直接换，验证破绽只在高清版里
  const hd = huang.hdFace;
  if (hd) {
    const mat = hd.mesh.material as THREE.MeshStandardMaterial;
    mat.map = hd.hi();
    mat.needsUpdate = true;
    huang.update(1 / 60, 0);
    const patch = huang.root.getObjectByName('breathPatch');
    r.t('换上高清贴图后，嘴部鼓瘪小平面可见', !!patch && patch.visible);
    const ph = renderPixels(renderer, sA, cam);
    let diffHi = 0;
    for (let i = 0; i < pa.length; i += 4) if (pa[i] !== ph[i] || pa[i + 1] !== ph[i + 1] || pa[i + 2] !== ph[i + 2]) diffHi++;
    r.t('高清贴图下脸与摊主不同（水渍、卷边）', diffHi > 30, `${diffHi} px`);
    mat.map = hd.lo();
    mat.needsUpdate = true;
    huang.update(1 / 60, 0);
    r.t('换回低清后小平面隐藏', !!patch && !patch.visible);
  }
  huang.dispose();
  stalls.geometry.dispose();
  other.geometry.dispose();
  return r.done();
});

/** 纸人与实例化摊主同源：同一份几何数据、同一个材质与贴图集、实例的 aCell 就是 seed 的格子。 */
registerSelftest('wp2.paper_same_source', () => {
  const r = report();
  const fig = createPaperFigure({ kind: 'vendor', seed: 3 });
  const stalls = createPaperStalls([{ pos: [1, 0, 2], yaw: 90, seed: 3 }, { pos: [3, 0, 2], yaw: 90, seed: 4 }]);
  const body = fig.root.getObjectByName('paperBody') as THREE.Mesh;
  const pb = body.geometry.attributes.position as THREE.BufferAttribute, pf = fig.face.geometry.attributes.position as THREE.BufferAttribute;
  const ps = stalls.geometry.attributes.position as THREE.BufferAttribute;
  let same = ps.count === pb.count + pf.count;
  for (let i = 0; same && i < pb.array.length; i++) if (ps.array[i] !== pb.array[i]) same = false;
  for (let i = 0; same && i < pf.array.length; i++) if (ps.array[pb.array.length + i] !== pf.array[i]) same = false;
  r.t('实例几何 = 纸人身体 + 脸（顶点逐位相同）', same);
  r.t('共用同一个材质与贴图集', stalls.material === body.material && (body.material as THREE.MeshStandardMaterial).map === vendorAtlas());
  const cells = stalls.geometry.attributes.aCell as THREE.InstancedBufferAttribute;
  const fc = fig.face.geometry.attributes.aCell as THREE.BufferAttribute;
  r.t('实例 0 的脸格子 = 同 seed 纸人的脸格子', !!cells && cells.getX(0) === fc.getX(0) && cells.getY(0) === fc.getY(0));
  r.t('不用 instanceColor', stalls.instanceColor === null);
  r.t('一次绘制：InstancedMesh.count = 2', stalls.count === 2);
  r.t('纸 6℃', (stalls.material as THREE.Material).userData.tempC === TEMP_C.paper);
  const boy = createPaperFigure({ kind: 'boy', lanternText: '过路留钱' });
  r.t('门童纸人能建（Plane+Box，提灯笼）', !!boy.root.getObjectByName('boyLantern') && !!boy.face);
  boy.setJitter(1);
  const before = boy.root.children[0]!.position.clone();
  boy.update(1 / 60);
  boy.update(1 / 60);
  r.t('setJitter：纸片轻微抖动', boy.root.children[0]!.position.distanceTo(before) > 0 || boy.root.children[0]!.rotation.y !== 0);
  return r.done();
});

/** 全部角色 × 全部外观都能建；faceMask 规则；土地的灯笼是 props.lantern。 */
registerSelftest('wp2.characters', () => {
  const r = report();
  const kinds: CharacterKind[] = ['tudi', 'wang', 'lu', 'huang', 'zhou', 'jianguo', 'kid', 'bride', 'apprentice', 'junkman', 'worker', 'neighbor'];
  const looks = ['live', 'ghost', 'replay', 'silhouette'] as const;
  let built = 0;
  const bad: string[] = [];
  for (const k of kinds) {
    for (const look of looks) {
      try {
        const c = createCharacter(k, { look, seed: 3 });
        c.setPose('walk');
        c.update(1 / 30, 1.2);
        const h = c.bounds(new THREE.Box3()).getSize(new THREE.Vector3()).y;
        if (!(h > 0.9 && h < 2.3)) bad.push(`${k}/${look} 高 ${h.toFixed(2)}`);
        c.setOpacity(0.5);
        c.dispose();
        built++;
      } catch (err) {
        bad.push(`${k}/${look}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  r.t(`12 种角色 × 4 种外观都能建（${built}/48）`, bad.length === 0, bad.join('；'));
  const zr = createCharacter('zhou', { look: 'replay' });
  const zl = createCharacter('zhou', { look: 'live' });
  r.t("zhou look:'replay' 默认雪花脸；look:'live' 没有", !!zr.props.faceSnow && !zl.props.faceSnow);
  const wm = createCharacter('wang', { look: 'replay', faceMask: true });
  r.t('faceMask:true 的任何角色都有雪花脸', !!wm.props.faceSnow);
  const tudi = createCharacter('tudi', { look: 'ghost' });
  r.t('土地：props.lantern（跟随灯锚点）、拐杖', !!tudi.props.lantern && !!tudi.props.cane);
  const h = tudi.bounds(new THREE.Box3());
  r.t('土地 1.2m（算上拐杖不超过 1.45）', h.max.y > 1.1 && h.max.y < 1.45, h.max.y.toFixed(2));
  const lo = createCharacter('tudi', { variant: 'lantern_only' });
  const lob = lo.bounds(new THREE.Box3()).getSize(new THREE.Vector3());
  r.t("tudi 'lantern_only'：只剩一盏灯笼", lob.y < 0.5 && lob.x < 0.4, f3(lob));
  const lu = createCharacter('lu', { look: 'ghost' });
  r.t('陆师傅：双反相机、老花镜', !!lu.props.tlr && !!lu.props.glasses);
  const wang = createCharacter('wang');
  r.t('王奶奶：竹篮、发髻', !!wang.props.basket && !!wang.props.bun);
  const zs = createCharacter('zhou', { variant: 'slump' });
  zs.setPose('sit', 0);
  zs.update(1 / 60, 0);
  r.t("zhou 'slump' + sit：上身趴下去", zs.joints.spine.rotation.x < -0.5);
  // M4：Lathe 部件（短袖袖筒、长袍）法线朝外——轮廓自上而下给点时整件内外翻转，从外面看穿到胳膊/小腿（ARCH §16 #39）
  const outward = (root: THREE.Object3D, name: string): number => {
    let mesh: THREE.Mesh | null = null;
    root.traverse(o => { if (!mesh && o.name === name && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
    if (!mesh) return -1;
    const g = (mesh as THREE.Mesh).geometry;
    const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute;
    let n = 0, good = 0;
    for (let i = 0; i < pos.count; i++) {
      const rx = pos.getX(i), rz = pos.getZ(i);
      if (Math.hypot(rx, rz) < 1e-3) continue;
      n++;
      if (rx * nor.getX(i) + rz * nor.getZ(i) > 0) good++;
    }
    return n > 0 ? good / n : -1;
  };
  const zo = outward(zl.root, 'sleeveL'), ro = outward(tudi.root, 'robe');
  r.t('短袖袖筒、长袍的法线朝外（Lathe 轮廓自下而上）', zo > 0.95 && ro > 0.95, `sleeve ${zo.toFixed(2)} robe ${ro.toFixed(2)}`);
  for (const c of [zr, zl, wm, tudi, lo, lu, wang, zs]) c.dispose();
  return r.done();
});

/** 门：collider 形状、handle、玻璃 noOcclude、开门。 */
registerSelftest('wp2.door', () => {
  const r = report();
  const d = door({ w: 1.2, h: 2.1, style: 'glass_shop', at: [5, 0, 3], yaw: 90 });
  const c = d.collider;
  const ok = 'wall' in c && Math.abs(c.wall.a[0] - 5) < 1e-6 && Math.abs(c.wall.b[0] - 5) < 1e-6
    && Math.abs(Math.min(c.wall.a[1], c.wall.b[1]) - 2.4) < 1e-6 && Math.abs(Math.max(c.wall.a[1], c.wall.b[1]) - 3.6) < 1e-6
    && c.wall.y0 === 0 && c.wall.height === 2.1;
  r.t('yaw 90 的 1.2m 门：collider 是 x=5、z 2.4→3.6 的墙片，高 2.1', ok, JSON.stringify(c));
  r.t('handle 是门扇上的小盒子（跟着门扇转）', isDescendant(d.handle, d.leaf) && (d.handle as THREE.Mesh).isMesh);
  let glassOk = false;
  d.group.traverse(o => {
    if (o.name === 'doorGlass') glassOk = o.userData.noOcclude === true;
  });
  r.t('玻璃门扇 userData.noOcclude', glassOk);
  const b0 = worldBox(d.handle).getCenter(new THREE.Vector3());
  d.setOpen(1);
  const b1 = worldBox(d.handle).getCenter(new THREE.Vector3());
  r.t('setOpen(1)：门把手跟着门扇转开', b0.distanceTo(b1) > 0.5, `${f3(b0)} → ${f3(b1)}`);
  const g = door({ w: 6, h: 2.2, style: 'iron_gate', at: [0, 0, 24], yaw: 180 });
  r.t('铁院门：两扇、有铁链', !!g.group.getObjectByName('chain') && g.leaf.children.length === 2);
  const gw = g.collider;
  r.t('院门 collider 横跨 x -3→3（z=24）', 'wall' in gw && Math.abs(Math.abs(gw.wall.a[0] - gw.wall.b[0]) - 6) < 1e-6 && Math.abs(gw.wall.a[1] - 24) < 1e-6);
  return r.done();
});

/** 灯：真实光不挂在 group 下、designLight 换算、关灯 = intensity 0、wetStreak。 */
registerSelftest('wp2.lamp', () => {
  const r = report();
  const l = lamp({ kind: 'sodium_pole', at: [2, 0, 3], light: { design: 2.2, distance: 14 }, wetStreak: true });
  r.t('有真实光，且不在 group 子树里', !!l.light && !isDescendant(l.light, l.group));
  r.t('强度 = 设计强度 × LIGHT_SCALE.point × distance²（M1c）、decay 2、distance 14', !!l.light && Math.abs(l.light.intensity - 2.2 * LIGHT_SCALE.point * 14 * 14) < 1e-6 && l.light.decay === 2 && l.light.distance === 14);
  r.t('灯 layers.enableAll()', !!l.light && l.light.layers.mask === (0xffffffff | 0));
  r.t('光放在灯头（杆顶 ~5.5m）', !!l.light && l.light.position.y > 5 && l.light.position.y < 6);
  let lights = 0;
  l.group.traverse(o => {
    if ((o as THREE.Light).isLight) lights++;
  });
  r.t('group 里没有灯（ctx.add 不会因为含灯而抛错）', lights === 0);
  const light = l.light;
  l.setOn(false);
  r.t('关灯 = intensity 0（同一个灯对象）', l.light === light && l.light?.intensity === 0);
  l.setOn(true);
  l.setLevel(0.5);
  r.t('setLevel(0.5)', !!l.light && Math.abs(l.light.intensity - 1.1 * LIGHT_SCALE.point * 14 * 14) < 1e-6);
  const streak = l.group.getObjectByName('wetStreak') as THREE.Mesh | undefined;
  r.t('wetStreak：加法混合、depthWrite:false、irHide', !!streak && (streak.material as THREE.Material).blending === THREE.AdditiveBlending && (streak.material as THREE.Material).depthWrite === false && streak.userData.irHide === true);
  const off = lamp({ kind: 'lantern', at: [0, 2, 0], light: false });
  r.t('light:false → 只有灯罩', off.light === null);
  return r.done();
});

/** 雨：1 个 draw call、irHide/auxHide、renderOrder 5、depthWrite:false。 */
registerSelftest('wp2.rain', (game: Game) => {
  const r = report();
  const renderer = game.renderer;
  const rr = rain({ count: 3000, box: { w: 30, h: 14, d: 30 } });
  const m = rr.mesh;
  r.t('userData.irHide/auxHide、renderOrder 5、depthWrite:false', m.userData.irHide === true && m.userData.auxHide === true && m.renderOrder === 5 && (m.material as THREE.Material).depthWrite === false);
  const s = new THREE.Scene();
  s.add(m);
  const cam = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
  cam.position.set(0, 1.6, 0);
  cam.lookAt(0, 1.6, -5);
  cam.updateMatrixWorld();
  rr.update(0.5, cam);
  const autoReset = renderer.info.autoReset;
  renderer.info.autoReset = false;
  renderer.info.reset();
  const px = renderPixels(renderer, s, cam, 128);
  const calls = renderer.info.render.calls;
  renderer.info.reset();
  renderer.info.autoReset = autoReset;
  r.t('一次 draw call', calls === 1, `${calls}`);
  let lit = 0;
  for (let i = 0; i < px.length; i += 4) if ((px[i] ?? 0) + (px[i + 1] ?? 0) + (px[i + 2] ?? 0) > 20) lit++;
  r.t('画得出雨丝', lit > 20, `${lit} px`);
  rr.setIntensity(0);
  rr.update(0.1, cam);
  r.t('setIntensity(0) → 不渲染', m.visible === false);
  (m.material as THREE.Material).dispose();
  m.geometry.dispose();
  return r.done();
});

/** 残影旋涡（yin）、冷迹（ir_only、3℃）、湿脚印（yin、irHide、按 stride 左右交替）。 */
registerSelftest('wp2.residue', () => {
  const r = report();
  const v = createResidueVortex();
  let yin = true;
  v.traverse(o => {
    if (((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) && o.layers.mask !== 1 << LAYER.yin) yin = false;
  });
  r.t('旋涡只在 yin 层', yin);
  const ct = createColdTrace('sitting');
  let ir = true, cold = true;
  ct.traverse(o => {
    if ((o as THREE.Mesh).isMesh) {
      if (o.layers.mask !== 1 << LAYER.ir_only) ir = false;
      if (o.userData.tempC !== TEMP_C.cold) cold = false;
    }
  });
  r.t('冷迹只在 ir_only 层、tempC 3', ir && cold);
  const sb = worldBox(ct).getSize(new THREE.Vector3());
  r.t('坐着的冷迹比站着矮', sb.y < 1.4, sb.y.toFixed(2));
  const fp = createFootprints([[0, 0], [0, -6.5]], { seed: 1 });
  r.t('脚印按 0.65m 一只（6.5m → 10 只）', fp.count === 10, `${fp.count}`);
  r.t('脚印在 yin 层、irHide', fp.layers.mask === 1 << LAYER.yin && fp.userData.irHide === true);
  const a = new THREE.Matrix4(), b = new THREE.Matrix4();
  fp.getMatrixAt(0, a);
  fp.getMatrixAt(1, b);
  const pa = new THREE.Vector3().setFromMatrixPosition(a), pb = new THREE.Vector3().setFromMatrixPosition(b);
  r.t('左右交替', Math.sign(pa.x) !== Math.sign(pb.x) && Math.abs(pb.z - pa.z - -0.65) < 0.05, `${f3(pa)} ${f3(pb)}`);
  return r.done();
});

/** 文字：CJK 检测、sRGB、镜像、坏字。 */
registerSelftest('wp2.text', () => {
  const r = report();
  r.t('detectCjk() 在测试机为真', detectCjk() === true);
  const t = makeTextTexture({ text: '伙计', font: { size: 120 }, color: '#222', bg: '#fff' });
  r.t('文字贴图 sRGB、没有退化', t.colorSpace === THREE.SRGBColorSpace && t.userData.fallback !== true);
  const img = t.image as HTMLCanvasElement;
  r.t('默认宽 1024、高是 2 的幂', img.width === 1024 && (img.height & (img.height - 1)) === 0, `${img.width}×${img.height}`);
  const n = makeTextTexture({ text: '长明照相馆', glow: { color: '#ff3b3b', blur: 20 }, brokenChars: [4], font: { size: 150 }, bg: null });
  r.t('霓虹坏字能画', n.userData.text === '长明照相馆');
  const m = makeTextTexture({ text: '04.6.18', mirror: true, font: { size: 100 }, vertical: false });
  r.t('镜像字能画', m.image !== undefined);
  return r.done();
});

/** 楼、人群、实例化。 */
registerSelftest('wp2.build_kit', () => {
  const r = report();
  const b = building({ x0: -4, x1: 4, z0: -3, z1: 3, floors: 4, facade: 'plaster', windows: { w: 1.1, h: 1.3, spacing: 2.6 }, faces: ['s', 'e'], doors: [{ w: 1.2, h: 2.2, style: 'unit', at: [0, 0, 3], yaw: 180 }], balconies: true, roof: 'parapet' });
  r.t('窗户是一个 InstancedMesh、带 instanceColor', b.windows.isInstancedMesh && b.windows.count > 8 && b.windows.instanceColor !== null, `${b.windows.count}`);
  r.t('碰撞体 1 个整盒', b.colliders.length === 1 && Math.abs((b.colliders[0]?.size[0] ?? 0) - 8) < 1e-6);
  r.t('门挂在 group.userData.doors', Array.isArray(b.group.userData.doors) && b.group.userData.doors.length === 1);
  const crowd = createCrowd({ count: 20, cols: 7, spacing: 0.6, look: 'silhouette', kidsFrontRow: 3 });
  r.t('人群一个 InstancedMesh、20 人', crowd.mesh.count === 20 && !crowd.bounds.isEmpty());
  crowd.dispose();
  const s = sign({ text: '长明照相馆', style: 'neon', w: 2.4, h: 0.6, brokenChars: [4] });
  s.setOn(false);
  s.flicker(0.5);
  r.t('霓虹招牌能开关', s.group.children.length > 0);
  return r.done();
});

// ---------------------------------------------------------------- 夹具

const wp2: AreaPart = {
  build(ctx: AreaContext) {
    // 老周（常光，录像带里的样子）与戴面具的黄三爷 + 同 seed 的实例化纸扎摊主并排（取景器 4×、5m 内可以比对出破绽）
    const zhou = createCharacter('zhou', { look: 'live' });
    zhou.root.position.set(...at(-2.5, 0, 0));
    ctx.add(zhou.root, { ref: 'wp2_zhou' });
    const huang = createCharacter('huang', { variant: 'masked', seed: 7 });
    huang.root.position.set(...at(-1, 0, 0));
    ctx.add(huang.root, { ref: 'wp2_huang', tempC: TEMP_C.huang });
    if (huang.hdFace) ctx.hdText(huang.hdFace.mesh, huang.hdFace.lo, huang.hdFace.hi, { minZoom: 4, maxDist: 5 });
    ctx.add(createPaperStalls([{ pos: at(0, 0, 0), yaw: 0, seed: 7 }, { pos: at(1, 0, 0), yaw: 0, seed: 2 }]), { ref: 'wp2_stalls', tempC: TEMP_C.paper });
    // 冷迹（红外）、湿脚印与残影旋涡（取景器）
    const ct = createColdTrace('standing');
    ct.position.set(...at(2.5, 0, 0.5));
    ctx.add(ct, { layer: 'ir_only', tempC: TEMP_C.cold });
    ctx.add(createFootprints([[WP2_ORIGIN[0] - 3, WP2_ORIGIN[2] - 1.5], [WP2_ORIGIN[0] + 1, WP2_ORIGIN[2] - 1.2], [WP2_ORIGIN[0] + 3.4, WP2_ORIGIN[2] + 1]], { seed: 2 }), { layer: 'yin' });
    const vortex = createResidueVortex();
    vortex.position.set(...at(3.5, 0, 1.5));
    ctx.add(vortex, { layer: 'yin' });
    // 只有灯罩的门灯（不占本区的灯数预算）、一扇玻璃门（门扇 noOcclude）、一块霓虹招牌（招牌正面朝 +z，转 180° 朝北）
    const gl = lamp({ kind: 'gate_lamp', at: at(-3.5, 2.6, 1.5), light: false });
    ctx.add(gl.group);
    const d = door({ w: 1.2, h: 2.2, style: 'glass_shop', at: at(-3.5, 0, 1.5), yaw: 0 });
    ctx.add(d.group);
    const s = sign({ text: '长明照相馆', style: 'neon', w: 2.0, h: 0.5, brokenChars: [4] });
    s.group.position.set(...at(0, 2.8, 1.6));
    s.group.rotation.y = Math.PI;
    s.flicker(0.3);
    ctx.add(s.group);
  },
};

export default wp2;
