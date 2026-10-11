// owner: WP2
// char2 区域：表面（WP-S）。每个人偶的材质槽、无花纹衣料、魂影/回放/剪影的材质参数、淡出、菲涅尔描边。
// 冻结接口（assemble.ts 调用）：createRigMaterials、modeDetail、ghostTint、modeMaterial、setMaterialOpacity、addRim、fabricTexture。
// WP0 时是原样搬来的旧版实现。

import * as THREE from 'three';
import { PALETTE } from '../../../data/palette';
import { TEMP_C } from '../../../data/render';
import { MATERIALS } from '../../../fx/materials';
import type { GhostDetail } from '../../../fx/ghostMaterials';
import { canvasToTexture, createCanvas } from '../../../kit/canvas';
import { newMat } from '../../../kit/geom';
import { rng, range } from '../../../kit/rng';
import { clothMottle, clothWeave, softFold, stitchLine } from '../../outfit/textures';
import { faceTexture } from '../head';
import type { FaceOpts, HumanoidMaterialMode, HumanoidSpec, HumanoidStyle, MatSlot } from '../types';

/** 皮肤（脸、手、脖子、赤臂）的粗糙度（PLAN §3.4）。 */
export const SKIN_ROUGHNESS = 0.7;
/** 衣料（衬衫、袖、裤）的粗糙度：比皮肤哑得多，浅色衬衫在钠灯下也读成布、不读成皮肤。 */
export const CLOTH_ROUGHNESS = 0.93;

const fabricCache: Partial<Record<'shirt' | 'sleeve' | 'pants', THREE.CanvasTexture>> = {};

/**
 * 无花纹衣料（char2 WP-S）：浅灰底（≈0.93）乘原色，不改角色的服装配色。
 * - 逐像素的细织纹：衬衫/袖子平纹，裤子斜纹；纱线不匀、纤维噪点，亮度起伏 ≤ 6%（不再是每 3 像素一道的横竖线——浅色衬衫上读成肋骨）；
 * - 几道大而软、不对称的斜向褶（≤ 8%）：衬衫是腋下拉褶、腰上塞进去的短褶、后背肩胛；袖子是肘弯的斜褶；裤子是膝弯与脚踝；
 * - 侧缝的针脚。形体的明暗交给几何（WP-U/WP-L），口袋、门襟、扣子不画在这里。
 * UV：u 绕一圈（0 = +x，0.25 = 正前），v 自下而上；x 方向周期平铺。
 */
export function fabricTexture(part: 'shirt' | 'sleeve' | 'pants'): THREE.CanvasTexture {
  const hit = fabricCache[part];
  if (hit) return hit;
  const W = 256;
  const { canvas, g } = createCanvas(W, W);
  g.fillStyle = '#eeeeee';
  g.fillRect(0, 0, W, W);
  const r = rng(part === 'shirt' ? 81 : part === 'pants' ? 82 : 83);
  // 大片极淡的明暗（布料不是一块均匀的塑料）
  for (let i = 0; i < 6; i++) {
    const x = r() * W, y = r() * W, rad = range(r, 30, 70);
    for (const off of [-W, 0, W]) {
      const gr = g.createRadialGradient(x + off, y, 0, x + off, y, rad);
      gr.addColorStop(0, r() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x + off - rad, y - rad, rad * 2, rad * 2);
    }
  }
  // 中频的棉布斑驳（纱线粗细、染色不匀；3m 外仍看得出是布、不是塑料或皮肤）：8 像素一格的平滑值噪声，±3.5%
  clothMottle(g, W, W, part === 'shirt' ? 87 : part === 'pants' ? 88 : 89, 8, 0.035);
  // 褶：画布 y 向下 = v 向下（画布顶 = 衣服上端）。[x0, y0, x1, y1, 宽, 强度]（像素）
  const folds: [number, number, number, number, number, number][] = part === 'shirt'
    ? [
      // 腋下往胸口的拉褶（前：u 0.0–0.5 的两侧），后背肩胛的斜拉线，腰上塞进裤腰的短褶
      [2, 64, 26, 122, 9, 0.075], [8, 84, 30, 130, 6, 0.05], [126, 66, 100, 124, 9, 0.07], [120, 86, 98, 132, 6, 0.045],
      [160, 52, 186, 120, 9, 0.06], [226, 56, 204, 122, 9, 0.055],
      [60, 250, 68, 206, 6, 0.07], [90, 252, 82, 212, 6, 0.06], [36, 252, 42, 220, 5, 0.05], [176, 250, 182, 214, 6, 0.06], [214, 252, 208, 220, 5, 0.05],
    ]
    : part === 'sleeve'
      ? [[44, 118, 92, 150, 8, 0.075], [60, 100, 104, 128, 6, 0.06], [70, 138, 110, 160, 5, 0.05], [176, 132, 214, 112, 7, 0.05], [14, 30, 34, 66, 6, 0.04]]
      : [
        // 膝弯（裤子背面 u 0.75 附近横向的褶 + 正面膝盖的斜拉褶）、脚踝堆褶
        [168, 108, 210, 122, 8, 0.075], [176, 126, 214, 134, 6, 0.06], [50, 104, 84, 134, 8, 0.06], [80, 96, 102, 120, 6, 0.045],
        [30, 228, 76, 238, 6, 0.06], [140, 224, 190, 236, 6, 0.06], [96, 238, 132, 246, 5, 0.05], [110, 16, 122, 62, 7, 0.035],
      ];
  for (const [x0, y0, x1, y1, wd, a] of folds) softFold(g, W, x0, y0, x1, y1, wd, a);
  clothWeave(g, 0, 0, W, W, part === 'shirt' ? 84 : part === 'pants' ? 85 : 86, { amp: 0.05, twill: part === 'pants' });
  // 侧缝（u = 0/1 与 0.5）：缝份把布顶起一道，旁边一道很淡的阴影 + 针脚
  for (const x of [0, W / 2, W]) {
    const gr = g.createLinearGradient(x - 5, 0, x + 5, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.5, 'rgba(0,0,0,0.05)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - 5, 0, 10, W);
    stitchLine(g, [[Math.min(W - 0.5, Math.max(0.5, x)), 0], [Math.min(W - 0.5, Math.max(0.5, x)), W]], '#8a8a8a', { alpha: 0.45, dash: 3 });
  }
  const tex = canvasToTexture(canvas);
  tex.name = `fabric.${part}`;
  fabricCache[part] = tex;
  return tex;
}

/**
 * 每个人偶自己的一套材质（淡出、换色互不影响），按槽返回；同一个材质可以占几个槽（torso 没有贴图时就是 shirt……）。
 * own：人偶接管（userData.rigOwned、dispose 时释放、style.rim 时加描边）。创建顺序就是材质 id 顺序（不透明物体按材质 id 排序画）。
 * face：spec.head === 'human' 时带人脸贴图；其他头型是一份没有贴图的肤色材质（不建贴图，不占画布预算）。
 */
export function createRigMaterials(
  spec: Readonly<HumanoidSpec>, face: Readonly<FaceOpts> | undefined, style: Readonly<HumanoidStyle> | undefined,
  own: <T extends THREE.Material>(m: T) => T,
): Record<MatSlot, THREE.MeshStandardMaterial> {
  const liveTemp = TEMP_C.alive;
  const skinColor = spec.skin ?? '#C99A78';
  const shirt = own(newMat({ color: spec.shirt, map: fabricTexture('shirt'), roughness: CLOTH_ROUGHNESS, tempC: liveTemp }));
  const pants = own(newMat({ color: spec.pants, map: fabricTexture('pants'), roughness: CLOTH_ROUGHNESS, tempC: liveTemp }));
  const shoes = own(newMat({ color: spec.shoes ?? '#16161a', roughness: 0.75, tempC: liveTemp }));
  shoes.userData.shoes = true;
  // char2：皮肤 0.7（M4 曾调到 0.85——那时的木棍四肢一亮就像上了漆；连续的蒙皮表面需要一点生气）。脸、手、脖子同一颜色同一粗糙度，接缝处不出色差。
  const skin = own(newMat({ color: skinColor, roughness: SKIN_ROUGHNESS, tempC: liveTemp }));
  skin.userData.skin = true;
  const belt = own(newMat({ color: '#1b1714', roughness: 0.55, metalness: 0.1, tempC: liveTemp }));
  if (style?.shoeMap) {
    shoes.map = style.shoeMap;
    shoes.color.set(0xffffff);
  }
  const torso = style?.torsoMap ? own(newMat({ color: 0xffffff, map: style.torsoMap, roughness: CLOTH_ROUGHNESS, tempC: liveTemp })) : shirt;
  const sleeve = own(newMat({ color: style?.sleeveMap ? 0xffffff : spec.shirt, map: style?.sleeveMap ?? fabricTexture('sleeve'), roughness: CLOTH_ROUGHNESS, tempC: liveTemp }));
  const robe = style?.robeMap ? own(newMat({ color: 0xffffff, map: style.robeMap, roughness: 0.92, tempC: liveTemp })) : sleeve;
  const hemColor = new THREE.Color(spec.robe ? 0xffffff : spec.shirt).multiplyScalar(0.72);
  const hem = own(newMat({ color: hemColor, roughness: 0.9, tempC: liveTemp }));
  const faceMat = spec.head === 'human' && face
    ? own(newMat({ color: 0xffffff, map: faceTexture(face as FaceOpts), roughness: SKIN_ROUGHNESS, tempC: liveTemp }))
    : own(newMat({ color: skinColor, roughness: SKIN_ROUGHNESS, tempC: liveTemp }));
  return { torso, sleeve, pants, shoes, skin, belt, hem, robe, face: faceMat };
}

// ---------------------------------------------------------------- 模式材质

/** 剪影材质（纯黑，或给定颜色）。魂影/回放走 createGhostMaterial/createReplayMaterial + modeDetail。 */
export function modeMaterial(m: Exclude<HumanoidMaterialMode, 'standard'>, color: THREE.ColorRepresentation | undefined): THREE.Material {
  if (m === 'ghost') return MATERIALS.ghost(color ?? PALETTE.GHOST);
  if (m === 'replay') return MATERIALS.replay();
  const sil = new THREE.MeshBasicMaterial({ color: color ?? '#0b0d12' });
  sil.userData.rigOwned = true;
  return sil;
}

/** 部件在魂影/回放下的参数来源。 */
export interface ModeDetailIn {
  /** 部件的常光材质（贴图、底色来源） */
  src?: THREE.MeshStandardMaterial;
  /** 配件（adopt 进来的） */
  accessory: boolean;
  /** 人脸（头网格，spec.head === 'human'） */
  face: boolean;
  /** 配件自己定的实度（mesh.userData.ghostSolid） */
  solidOverride: number | null;
  style?: Readonly<HumanoidStyle>;
}

/**
 * 魂影/回放材质的参数（M4）：带原件的贴图与底色；只改 uniform，不新增着色器程序。
 * M4 第 2 轮：脸（连头发、耳朵、鼻子）贴图调制 1.0、头部 uSolid 0.35——1× 取景器 3m 外五官仍可读；
 * 回放：衣服花色 0.85、原色 0.45、不透明度 0.75（原来 0.5/0.22/0.6，被扫描条纹一压看不出谁是谁）
 */
export function modeDetail(m: 'ghost' | 'replay', o: ModeDetailIn): GhostDetail {
  const map = o.src?.map ?? null;
  const tune = m === 'ghost' ? o.style?.ghost : undefined;
  const T = MODE_TUNE[m];
  return {
    map,
    mapAmt: map ? (o.face ? T.faceMap : T.bodyMap) : 0,
    base: o.src?.color ?? 0xffffff,
    baseAmt: tune?.baseAmt ?? (o.face ? T.faceBase : T.bodyBase),
    solid: o.solidOverride ?? (o.accessory ? 1 : o.face ? T.faceSolid : T.bodySolid),
    rim: T.rim,
    albedo: 1,
    ...(m === 'replay' ? { opacity: MODE_TUNE.replay.opacity } : {}),
  };
}

/**
 * 魂影/回放的参数（全是 uniform，同一个着色器程序）。char2：身子是一整层连续的壳（没有叠在一起的零件替它加不透明度），
 * 衣料贴图的褶与斑驳也更值得看：身子的贴图调制 0.5 → 0.6、实度 0.22 → 0.25；脸（连头发）不变——五官在 3m 外仍可读、头发读成深色。
 * 回放：衣服花色 0.85、原色 0.45、不透明度 0.75（M4 第 2 轮）。
 */
export const MODE_TUNE = {
  // fix1：魂影的脸贴图调制 1.35（> 1 = 加对比：3m 外眼、眉、嘴仍看得出，不是一个光溜溜的蛋）、脸更实 0.45；
  // 回放的身子更实（0.25 → 0.62）、原色多留（0.45 → 0.6）：单层的壳在回放扫描线里不再化成一片雾（R2_502 年轻王桂芝）、红毛衣不再读成光身子
  ghost: { faceMap: 1.35, bodyMap: 0.6, faceBase: 0.3, bodyBase: 0.36, faceSolid: 0.45, bodySolid: 0.25, rim: 0.32 },
  replay: { faceMap: 1.2, bodyMap: 0.9, faceBase: 0.5, bodyBase: 0.6, faceSolid: 0.6, bodySolid: 0.62, rim: 0.22, opacity: 0.75 },
} as const;

/** 魂影颜色：style.ghost.tint 优先，其次调用方给的颜色，缺省 PALETTE.GHOST。 */
export function ghostTint(style: Readonly<HumanoidStyle> | undefined, color: THREE.ColorRepresentation | undefined): THREE.ColorRepresentation {
  return style?.ghost?.tint ?? color ?? PALETTE.GHOST;
}

/** ShaderMaterial 的透明度：优先写 uniforms（opacity/uOpacity），同时写 material.opacity（ARCH 没定 uniform 名，见 engine-wp2.md）。 */
export function setMaterialOpacity(mat: THREE.Material, a: number): void {
  const base = (mat.userData.baseOpacity as number | undefined) ?? (mat.userData.baseOpacity = readOpacity(mat));
  const v = base * a;
  mat.opacity = v;
  const sm = mat as THREE.ShaderMaterial;
  if (sm.isShaderMaterial && sm.uniforms) {
    for (const k of ['opacity', 'uOpacity', 'uAlpha']) {
      const u = sm.uniforms[k];
      if (u && typeof u.value === 'number') u.value = v;
    }
    // 写深度的魂影部件（M4）：淡得差不多了就不再写深度（一个快看不见的人形不该还挡着后面的雨、灯晕）
    if (mat.userData.ghostDepth === true) mat.depthWrite = a > 0.3;
  }
  if (!sm.isShaderMaterial) {
    const fading = v < 0.999;
    if (mat.transparent !== (fading || mat.userData.baseTransparent === true)) {
      mat.transparent = fading || mat.userData.baseTransparent === true;
      mat.needsUpdate = true;
    }
    mat.depthWrite = !fading && mat.userData.baseDepthWrite !== false;
  }
}

export function readOpacity(mat: THREE.Material): number {
  const sm = mat as THREE.ShaderMaterial;
  if (sm.isShaderMaterial && sm.uniforms) {
    for (const k of ['opacity', 'uOpacity', 'uAlpha']) {
      const u = sm.uniforms[k];
      if (u && typeof u.value === 'number') return u.value;
    }
  }
  mat.userData.baseTransparent = mat.transparent;
  mat.userData.baseDepthWrite = mat.depthWrite;
  return mat.opacity;
}

/**
 * 给 MeshStandardMaterial 加一圈菲涅尔自发光（描边）：视线掠过的边缘发 color 色的光。
 * 所有描边材质共用同一段着色器代码（customProgramCacheKey 固定），只多一个程序变体。
 */
export function addRim(mat: THREE.MeshStandardMaterial, color: THREE.ColorRepresentation, strength = 0.9): void {
  const uRim = { value: new THREE.Color(color).multiplyScalar(strength) };
  mat.userData.rimUniform = uRim;
  mat.onBeforeCompile = shader => {
    shader.uniforms.uRim = uRim;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += uRim * pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );');
  };
  mat.customProgramCacheKey = () => 'wp2.rim';
  mat.needsUpdate = true;
}
