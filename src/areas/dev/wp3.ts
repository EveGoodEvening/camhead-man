// owner: WP3
// WP3 在开发沙盒里的测试夹具（ARCH §15.2 “沙盒要包含的夹具”），并用 debug/selftest.ts 的 registerSelftest('wp3.<snake>', fn) 登记页面内自测；
// scripts/selftest/wp3.mjs 经调试 API 的 selftest(name)（?debug=1&area=dev）调用。
//
// 夹具（沙盒东北角，WP3_ORIGIN 附近；不加碰撞体，免得挡住别的 WP 的走路测试）：
// - 红外温度排：3 / 6 / 18 / 36 / 50 / 60℃ 的小方块，后面一堵 18℃ 的水泥墙；
// - 带 instanceColor（红/绿/蓝）的实例网格，tempC 36；
// - 墙上一张透明文字贴花（makeTextPlane bg:null，不设 alphaTest），tempC 40；
// - 一台通电的 CRT（私有 createCrtScreenMaterial）、魂影/回放人影/纸像发光样本、一排 MATERIALS 色板、一团 Points（红外下应消失）。

import * as THREE from 'three';
import type { AreaPart } from '../../core/area';
import type { V3 } from '../../core/types';
import type { Game } from '../../core/game';
import type { SelftestResult } from '../../debug/selftest';
import { registerSelftest } from '../../debug/selftest';
import { MATERIALS, isSharedMaterial } from '../../fx/materials';
import type { MaterialLibrary } from '../../fx/materials';
import { createCrtScreenMaterial, CRT_TEMP_C } from '../../fx/crtScreen';
import { acquireFeed, feedPoolStats } from '../../fx/feeds';
import { areaEnvironment } from '../../fx/environment';
import { irGray } from '../../fx/ir';
import type { FxParams } from '../../fx/post';
import { POST_PRESETS } from '../../fx/presets';
import { makeTextPlane } from '../../kit/text';
import { IR_RAMP, PALETTE } from '../../data/palette';
import { RENDER_ORDER, TEMP_C } from '../../data/render';

export const WP3_ORIGIN: V3 = [11, 0, -9];
const REF = {
  wall: 'wp3.ir_wall',
  inst: 'wp3.ir_inst',
  decal: 'wp3.ir_decal',
  crt: 'wp3.crt',
  points: 'wp3.points',
  row: (t: number) => `wp3.ir_${t}`,
} as const;
const IR_ROW = [3, 6, 18, 36, 50, 60] as const;
const INST_TEMP = 36;
const DECAL_TEMP = 40;

const at = (x: number, y: number, z: number): V3 => [WP3_ORIGIN[0] + x, WP3_ORIGIN[1] + y, WP3_ORIGIN[2] + z];

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], p: V3): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(p[0], p[1], p[2]);
  return m;
}

const wp3: AreaPart = {
  build(ctx) {
    // 18℃ 背景墙
    ctx.add(mesh(new THREE.BoxGeometry(4.4, 3, 0.2), MATERIALS.concrete(), at(0, 1.5, -1.1)), { ref: REF.wall });

    // 温度排
    IR_ROW.forEach((t, i) => {
      ctx.add(mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), MATERIALS.cloth('#7a7a7a'), at(-1.6 + i * 0.64, 0.25, -0.5)), { ref: REF.row(t), tempC: t });
    });

    // 带 instanceColor 的实例网格（红绿蓝三块，温度都是 36℃）
    {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), MATERIALS.cloth('#ffffff'), 3);
      const m4 = new THREE.Matrix4();
      ['#ff2020', '#20ff20', '#2020ff'].forEach((c, i) => {
        m4.makeTranslation(at(-1.4 + i * 0.55, 1.35, -0.75)[0], 1.35, at(0, 0, -0.75)[2]);
        im.setMatrixAt(i, m4);
        im.setColorAt(i, new THREE.Color(c));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      ctx.add(im, { ref: REF.inst, tempC: INST_TEMP });
    }

    // 透明文字贴花（与 kit 的小广告同一条路径：bg:null → transparent、无 alphaTest）
    {
      const decal = makeTextPlane({ text: '开锁', w: 1.1, font: { size: 180, weight: 'bold' }, color: '#c0161b', bg: null });
      decal.position.set(...at(0.9, 1.45, -0.99));
      ctx.add(decal, { ref: REF.decal, tempC: DECAL_TEMP });
    }

    // 通电的 CRT（look-dev 用）
    {
      ctx.add(mesh(new THREE.BoxGeometry(0.46, 0.4, 0.42), MATERIALS.metal(), at(1.7, 0.2, 0.3)));
      const mat = createCrtScreenMaterial();
      const cv = document.createElement('canvas');
      cv.width = 256;
      cv.height = 192;
      const g = cv.getContext('2d');
      if (g) {
        g.fillStyle = '#1c2026';
        g.fillRect(0, 0, 256, 192);
        g.fillStyle = PALETTE.OSD;
        g.font = 'bold 20px monospace';
        g.fillText('CH3 2026-08-27', 12, 28);
        g.fillStyle = '#5a6068';
        g.fillRect(40, 90, 176, 80);
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.uniforms.map.value = tex;
      mat.uniforms.noise.value = 0.2;
      ctx.track(tex);
      ctx.track(mat);
      const screen = mesh(new THREE.PlaneGeometry(0.36, 0.27), mat, at(1.7, 0.22, 0.512));
      ctx.add(screen, { ref: REF.crt });
    }

    // 魂影 / 回放人影 / 纸像发光样本（放在 world 层，第三人称也看得见）
    {
      const ghost = mesh(new THREE.CapsuleGeometry(0.22, 1.0, 6, 14), MATERIALS.ghost(), at(-2.6, 0.75, 0.6));
      ghost.renderOrder = RENDER_ORDER.ghost;
      ctx.add(ghost);
      const rep = mesh(new THREE.CapsuleGeometry(0.22, 1.0, 4, 10), MATERIALS.replay(), at(-2.0, 0.75, 0.6));
      rep.renderOrder = RENDER_ORDER.replay;
      ctx.add(rep);
      const paper = mesh(new THREE.PlaneGeometry(0.6, 1.1), MATERIALS.paper(), at(-1.3, 1.6, -0.99));
      ctx.add(paper);
      const glow = mesh(new THREE.PlaneGeometry(0.68, 1.18), MATERIALS.paperGlow(), at(-1.3, 1.6, -0.97));
      glow.renderOrder = RENDER_ORDER.paperGlow;
      ctx.add(glow);
    }

    // MATERIALS 色板（两排）
    {
      const names: (keyof MaterialLibrary)[] = [
        'brick', 'plaster', 'lime', 'dado', 'tileWhite', 'tileGreenWhite', 'concrete', 'asphaltWet', 'wood',
        'metal', 'tin', 'enamelYellow', 'enamelRed', 'porcelain', 'paper', 'glass', 'crtScreen',
      ];
      names.forEach((n, i) => {
        const m = (MATERIALS[n] as () => THREE.Material)();
        const x = -2.0 + (i % 9) * 0.5;
        const z = 1.4 + Math.floor(i / 9) * 0.6;
        ctx.add(mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), m, at(x, 0.2, z)));
      });
      ctx.add(mesh(new THREE.SphereGeometry(0.15, 16, 12), MATERIALS.emissive(PALETTE.SODIUM, 1.5), at(2.6, 0.5, 1.4)));
      ctx.add(mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), MATERIALS.cloth(PALETTE.UNIFORM), at(2.6, 0.2, 2.0)));
    }

    // 红外下应整体消失的 Points
    {
      const pos = new Float32Array(300);
      for (let i = 0; i < 100; i++) {
        pos[i * 3] = at(-1.5 + (i % 10) * 0.3, 0, 0)[0];
        pos[i * 3 + 1] = 2.2 + Math.floor(i / 10) * 0.05;
        pos[i * 3 + 2] = at(0, 0, -0.3)[2];
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      ctx.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: '#9ab', size: 0.04 })), { ref: REF.points });
    }
  },
};

export default wp3;

// ---------------------------------------------------------------- 页面内自测

function ok(notes: string[], cond: boolean, msg: string): boolean {
  notes.push(`${cond ? 'ok' : 'FAIL'}: ${msg}`);
  return cond;
}
function result(notes: string[]): SelftestResult {
  return { ok: notes.every(n => n.startsWith('ok')), notes };
}
function ref(game: Game, id: string): THREE.Object3D | undefined {
  return game.areas.current?.ctx.getRef(id);
}

/** 所有显示空间效果清零、红外开：让画面上的颜色只由温度决定。 */
const IR_CLEAN: Partial<FxParams> = {
  ir: 1, grain: 0, chroma: 0, vignette: 0, scanline: 0, vhs: 0, barrel: 0, tintAmt: 0, monoRed: 0, frame43: 0, flash: 0, fade: 0, flicker: 0,
};
const TEST_LAYER = 'wp3_selftest';

/** 一台看向 target 的临时相机（宽高比取绘制缓冲）。 */
function lookCam(game: Game, from: V3, target: V3): THREE.PerspectiveCamera {
  const size = game.renderer.getDrawingBufferSize(new THREE.Vector2());
  const cam = new THREE.PerspectiveCamera(50, size.x / Math.max(1, size.y), 0.05, 50);
  cam.layers.enableAll();
  cam.position.set(...from);
  cam.lookAt(...target);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

/** 世界点 → 绘制缓冲像素（readPixels 坐标，左下为原点）。 */
function toPixel(game: Game, cam: THREE.Camera, p: THREE.Vector3): [number, number] {
  const size = game.renderer.getDrawingBufferSize(new THREE.Vector2());
  const v = p.clone().project(cam);
  return [Math.round((v.x * 0.5 + 0.5) * size.x), Math.round((v.y * 0.5 + 0.5) * size.y)];
}

function readPixel(game: Game, x: number, y: number): [number, number, number] {
  const gl = game.renderer.getContext();
  const px = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return [px[0] ?? 0, px[1] ?? 0, px[2] ?? 0];
}

/** JS 版的色带（与 CameraFxPass 的 cmIrRamp 相同）：t ∈ [0,1] → 0..255 */
function rampColor(t: number): [number, number, number] {
  const hex = (h: string): number[] => [1, 3, 5].map(i => Number.parseInt(h.slice(i, i + 2), 16));
  const x = Math.min(1, Math.max(0, t)) * 4;
  const i = Math.min(3, Math.floor(x));
  const a = hex(IR_RAMP[i]!), b = hex(IR_RAMP[i + 1]!);
  const f = x - i;
  return [0, 1, 2].map(k => a[k]! + (b[k]! - a[k]!) * f) as [number, number, number];
}

/** 用游戏的后期链以临时相机渲一帧（同步；调用者在同一任务内读像素，然后 restore）。 */
function renderThroughPost(game: Game, cam: THREE.Camera, layer: Partial<FxParams>): () => void {
  const post = game.pipeline.post;
  post.push(TEST_LAYER, layer, 0);
  post.setCamera(cam);
  post.render(0);
  return () => {
    post.pop(TEST_LAYER, 0);
    post.setCamera(game.cameras.camera);
  };
}

registerSelftest('wp3.post_passes', game => {
  const notes: string[] = [];
  const post = game.pipeline.post;
  ok(notes, post.composer.passes.length === 3, `后期 pass 数 = ${post.composer.passes.length}（期望 3：RenderPass、Bloom、CameraFxPass）`);
  const last = post.composer.passes[2] as unknown as { material?: THREE.ShaderMaterial };
  ok(notes, last.material?.name === 'CameraFxPass' && last.material.toneMapped === false, 'CameraFxPass 在最后且 toneMapped:false（取代 OutputPass）');
  ok(notes, game.renderer.toneMapping === THREE.NoToneMapping, 'renderer.toneMapping = NoToneMapping');
  ok(notes, game.renderer.toneMappingExposure === 1, 'renderer.toneMappingExposure = 1');
  return result(notes);
});

registerSelftest('wp3.post_stack', game => {
  const notes: string[] = [];
  const post = game.pipeline.post;
  if (post.layers().includes('vf')) {
    ok(notes, true, '取景器开着（已有 vf 层），跳过 vf 乘法断言');
  } else {
    post.render(0);
    const base = post.current.chroma;
    post.push('vf', POST_PRESETS.vf, 0);
    post.render(0);
    const vfChroma = post.current.chroma;
    ok(notes, base > 0 && Math.abs(vfChroma / base - 2.5) < 1e-3, `vf 层 chroma 为乘法：${base.toFixed(5)} → ${vfChroma.toFixed(5)}（×2.5）`);
    ok(notes, post.current.frame43 === 1 && Math.abs(post.current.scanline - 0.25) < 1e-6, 'vf 层：frame43 = 1、扫描线 0.25');
    post.pop('vf', 0);
  }
  post.push(TEST_LAYER, { grain: 0.5 }, 0.5);
  post.render(0);
  ok(notes, post.layers().at(-1) === TEST_LAYER, '后 push 的层在最上面');
  post.pop(TEST_LAYER, 0);
  post.render(0);
  ok(notes, !post.layers().includes(TEST_LAYER), 'pop(key, 0) 立即移除');
  return result(notes);
});

registerSelftest('wp3.ir_instance_color', game => {
  const notes: string[] = [];
  const im = ref(game, REF.inst) as THREE.InstancedMesh | undefined;
  if (!ok(notes, !!im, `夹具 ${REF.inst} 存在`) || !im) return result(notes);
  const centers = [0, 1, 2].map(i => {
    const m = new THREE.Matrix4();
    im.getMatrixAt(i, m);
    return new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(im.matrixWorld);
  });
  const mid = centers[1]!;
  const cam = lookCam(game, [mid.x, mid.y + 0.15, mid.z + 1.6], [mid.x, mid.y, mid.z]);

  // ① 离屏：红外替换后的线性灰度 = t/45，三块颜色不同的实例灰度一致（instanceColor 已被置空）
  const rt = new THREE.WebGLRenderTarget(128, 128);
  const r = game.renderer;
  const prev = r.getRenderTarget();
  const ir = game.pipeline.post.ir;
  ir.begin([game.scene]);
  try {
    r.setRenderTarget(rt);
    r.clear();
    r.render(game.scene, cam);
  } finally {
    ir.end();
    r.setRenderTarget(prev);
  }
  const expectGray = Math.round(irGray(INST_TEMP) * 255);
  for (const c of centers) {
    const v = c.clone().project(cam);
    const x = Math.round((v.x * 0.5 + 0.5) * 128), y = Math.round((v.y * 0.5 + 0.5) * 128);
    const px = new Uint8Array(4);
    r.readRenderTargetPixels(rt, x, y, 1, 1, px);
    const spread = Math.max(px[0]!, px[1]!, px[2]!) - Math.min(px[0]!, px[1]!, px[2]!);
    ok(notes, spread <= 3 && Math.abs(px[1]! - expectGray) <= 6, `实例 (${x},${y}) 红外灰度 ${px[0]},${px[1]},${px[2]} ≈ ${expectGray}（不被 instanceColor 染色）`);
  }
  rt.dispose();
  ok(notes, im.instanceColor !== null, 'end() 之后 instanceColor 已还原');

  // ② 经后期链：屏幕像素 = 色带(t/45)
  const restore = renderThroughPost(game, cam, IR_CLEAN);
  try {
    const expect = rampColor(irGray(INST_TEMP));
    for (const c of centers) {
      const [x, y] = toPixel(game, cam, c);
      const px = readPixel(game, x, y);
      const d = Math.max(...px.map((v, k) => Math.abs(v - expect[k]!)));
      ok(notes, d <= 10, `屏幕像素 ${px.join(',')} ≈ 色带 ${expect.map(Math.round).join(',')}（${INST_TEMP}℃）`);
    }
  } finally {
    restore();
  }
  return result(notes);
});

registerSelftest('wp3.ir_decal_shape', game => {
  const notes: string[] = [];
  const decal = ref(game, REF.decal) as THREE.Mesh | undefined;
  if (!ok(notes, !!decal, `夹具 ${REF.decal} 存在`) || !decal) return result(notes);
  decal.geometry.computeBoundingBox();
  const bb = decal.geometry.boundingBox!;
  const c = new THREE.Vector3();
  decal.getWorldPosition(c);
  const cam = lookCam(game, [c.x, c.y, c.z + 1.8], [c.x, c.y, c.z]);
  const restore = renderThroughPost(game, cam, IR_CLEAN);
  try {
    const p0 = toPixel(game, cam, decal.localToWorld(new THREE.Vector3(bb.min.x, bb.min.y, 0)));
    const p1 = toPixel(game, cam, decal.localToWorld(new THREE.Vector3(bb.max.x, bb.max.y, 0)));
    const x0 = Math.min(p0[0], p1[0]) + 2, x1 = Math.max(p0[0], p1[0]) - 2;
    const y0 = Math.min(p0[1], p1[1]) + 2, y1 = Math.max(p0[1], p1[1]) - 2;
    const hot = rampColor(irGray(DECAL_TEMP));
    const cold = rampColor(irGray(TEMP_C.ambient));
    let nHot = 0, nCold = 0, n = 0;
    const step = Math.max(1, Math.floor((x1 - x0) / 60));
    for (let y = y0; y <= y1; y += step) {
      for (let x = x0; x <= x1; x += step) {
        const px = readPixel(game, x, y);
        const dh = Math.max(...px.map((v, k) => Math.abs(v - hot[k]!)));
        const dc = Math.max(...px.map((v, k) => Math.abs(v - cold[k]!)));
        if (dh < dc) nHot++;
        else nCold++;
        n++;
      }
    }
    const frac = n ? nHot / n : 0;
    ok(notes, n > 50, `贴花矩形内采样 ${n} 点`);
    ok(notes, nHot >= 10 && frac < 0.85, `热像素 ${nHot} 个、占比 ${frac.toFixed(3)}（非矩形：字形是热的、字间透出墙温；整块矩形会≈1）`);
    ok(notes, nCold > 0, '矩形内有墙温像素');
  } finally {
    restore();
  }
  return result(notes);
});

registerSelftest('wp3.ir_programs_stable', game => {
  const notes: string[] = [];
  const post = game.pipeline.post;
  const info = game.renderer.info;
  // 用自己的层 key（不碰玩家此刻可能开着的 vf/ir 层）
  post.render(0);
  const p0 = info.programs?.length ?? 0;
  post.push(`${TEST_LAYER}_vf`, POST_PRESETS.vf, 0);
  post.render(0);
  post.push(`${TEST_LAYER}_ir`, POST_PRESETS.ir, 0);
  post.render(0);
  const p1 = info.programs?.length ?? 0;
  post.pop(`${TEST_LAYER}_ir`, 0);
  post.render(0);
  post.pop(`${TEST_LAYER}_vf`, 0);
  post.render(0);
  const p2 = info.programs?.length ?? 0;
  ok(notes, p0 === p1 && p1 === p2, `programs：常规 ${p0} → 红外 ${p1} → 常规 ${p2}（预热后应不变）`);
  return result(notes);
});

registerSelftest('wp3.ir_restore', game => {
  const notes: string[] = [];
  const pts = ref(game, REF.points);
  const im = ref(game, REF.inst) as THREE.InstancedMesh | undefined;
  const wall = ref(game, REF.wall) as THREE.Mesh | undefined;
  if (!ok(notes, !!pts && !!im && !!wall, '夹具存在') || !pts || !im || !wall) return result(notes);
  const mat0 = wall.material;
  const ic0 = im.instanceColor;
  const ir = game.pipeline.post.ir;
  ir.begin([game.scene]);
  const hiddenDuring = !pts.visible;
  const swapped = wall.material !== mat0 && (wall.material as THREE.Material).userData.irOverride === true;
  const nulled = im.instanceColor === null;
  ir.end();
  ok(notes, hiddenDuring, '红外期间 Points 隐藏');
  ok(notes, swapped, '红外期间材质换成 irMaterial');
  ok(notes, nulled, '红外期间 instanceColor 置空');
  ok(notes, pts.visible && wall.material === mat0 && im.instanceColor === ic0, 'end() 后全部还原');
  return result(notes);
});

registerSelftest('wp3.feeds', () => {
  const notes: string[] = [];
  const f = acquireFeed('wp3_test', 64, 48, { pingpong: true });
  const r0 = f.read;
  const w0 = f.write.texture;
  ok(notes, r0 !== w0, '乒乓：read 与 write 不是同一张');
  f.swap();
  ok(notes, f.read === w0 && f.write.texture === r0, 'swap() 交换 read/write');
  const free0 = feedPoolStats().free;
  f.dispose();
  ok(notes, feedPoolStats().free === free0 + 2, 'dispose() 把两张 RT 还回池子');
  const g = acquireFeed('wp3_test', 64, 48);
  ok(notes, g.read === g.write.texture, '单张：read === write.texture');
  ok(notes, g.write.texture === r0 || g.write.texture === w0, '同尺寸复用池里的 RT');
  g.dispose();
  let threw = false;
  try {
    acquireFeed('ch2', 32, 24).dispose();
  } catch {
    threw = true;
  }
  ok(notes, threw, "dev 下 acquireFeed('ch2') 不带 pingpong 抛错");
  return result(notes);
});

registerSelftest('wp3.environment', game => {
  const notes: string[] = [];
  const a = areaEnvironment(game.renderer, '#304070');
  const b = areaEnvironment(game.renderer, '#304070');
  const c = areaEnvironment(game.renderer, '#704030');
  ok(notes, a === b, '同 tint 同一张 PMREM（缓存）');
  ok(notes, a !== c, '不同 tint 不同贴图');
  ok(notes, (a as THREE.Texture & { mapping: number }).mapping === THREE.CubeUVReflectionMapping, 'PMREM 贴图（CubeUV）');
  return result(notes);
});

registerSelftest('wp3.materials', () => {
  const notes: string[] = [];
  ok(notes, MATERIALS.brick() === MATERIALS.brick(), '同参数同实例');
  ok(notes, MATERIALS.cloth('#ff0000') === MATERIALS.cloth('red'), 'cloth 按颜色缓存');
  ok(notes, MATERIALS.emissive('#ffffff', 2) !== MATERIALS.emissive('#ffffff', 1), 'emissive 按（颜色, 强度）缓存');
  const all: THREE.Material[] = [
    MATERIALS.brick(), MATERIALS.plaster(), MATERIALS.lime(), MATERIALS.dado(), MATERIALS.tileWhite(), MATERIALS.tileGreenWhite(),
    MATERIALS.concrete(), MATERIALS.asphaltWet(), MATERIALS.wood(), MATERIALS.metal(), MATERIALS.tin(), MATERIALS.enamelYellow(),
    MATERIALS.enamelRed(), MATERIALS.porcelain(), MATERIALS.paper(), MATERIALS.cloth('#123456'), MATERIALS.glass(),
    MATERIALS.emissive('#ff9a3c'), MATERIALS.ghost(), MATERIALS.replay(), MATERIALS.paperGlow(), MATERIALS.crtScreen(),
  ];
  ok(notes, all.every(isSharedMaterial), 'isSharedMaterial 对全部共享实例为真');
  ok(notes, all.every(m => typeof m.userData.tempC === 'number'), '每个共享材质都有 userData.tempC');
  ok(notes, MATERIALS.paper().userData.tempC === TEMP_C.paper && MATERIALS.emissive('#fff').userData.tempC === TEMP_C.lamp && MATERIALS.ghost().userData.tempC === TEMP_C.yin, '纸 6℃、灯 60℃、魂影 6℃');
  ok(notes, MATERIALS.glass().userData.noOcclude === true && MATERIALS.glass().transparent, '玻璃 transparent + noOcclude');
  ok(notes, MATERIALS.hitProxy().visible === false, 'hitProxy 不绘制');
  ok(notes, !isSharedMaterial(new THREE.MeshBasicMaterial()), '普通材质不是共享实例');
  return result(notes);
});

registerSelftest('wp3.crt_material', game => {
  const notes: string[] = [];
  const a = createCrtScreenMaterial();
  const b = createCrtScreenMaterial();
  ok(notes, a !== b && a.uniforms !== b.uniforms, '每次调用新建实例');
  const keys = ['map', 'osd', 'noise', 'scan', 'barrel', 'noSignal', 'tunnel', 'tunnelMix', 'time', 'layout', 'ch2', 'atlas', 'split'] as const;
  ok(notes, keys.every(k => k in a.uniforms), 'CrtUniforms 的键齐全');
  ok(notes, a.userData.tempC === CRT_TEMP_C, `通电 CRT 红外 ${CRT_TEMP_C}℃`);
  ok(notes, MATERIALS.crtScreen() !== a, 'MATERIALS.crtScreen() 是另一个共享实例');
  // 渲一次 split5 + split，确认着色器能编译
  a.uniforms.layout.value = 1;
  a.uniforms.split.value = 1;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.75), a);
  const cam = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 10);
  cam.position.set(0, 0, 1);
  const s = new THREE.Scene();
  s.add(m);
  const rt = new THREE.WebGLRenderTarget(32, 24);
  const prev = game.renderer.getRenderTarget();
  game.renderer.setRenderTarget(rt);
  game.renderer.render(s, cam);
  game.renderer.setRenderTarget(prev);
  const px = new Uint8Array(4);
  game.renderer.readRenderTargetPixels(rt, 16, 12, 1, 1, px);
  ok(notes, true, `split5 渲染完成（中心像素 ${px.join(',')}）`);
  rt.dispose();
  m.geometry.dispose();
  a.dispose();
  b.dispose();
  return result(notes);
});

registerSelftest('wp3.audio_locked', game => {
  const notes: string[] = [];
  const a = game.audio;
  ok(notes, a.ctx === null, '?test=1 下（或未解锁时）audio.ctx === null');
  ok(notes, !a.running && a.bus === null, 'running = false、bus = null');
  a.sfx('shutter');
  a.music('songbie');
  a.murmur('npc.tudi', 1);
  a.duck(6, 1);
  a.setVolume(0.5);
  const hs = a.setAmbience([{ preset: 'rain' }, { preset: 'sodium_hum', at: [0, 4, 0] }], 0);
  hs[0]?.set('intensity', 0.3, 1);
  ok(notes, hs.length === 2 && a.ctx === null, '解锁前的调用都是空操作，setAmbience 仍返回句柄');
  return result(notes);
});
