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
import { faceTexture } from '../head';
import type { FaceOpts, HumanoidMaterialMode, HumanoidSpec, HumanoidStyle, MatSlot } from '../types';

const fabricCache: Partial<Record<'shirt' | 'sleeve' | 'pants', THREE.CanvasTexture>> = {};

/** 无花纹衣料仍有缝线、受力褶和细织纹；灰度图乘原色，不改角色的服装配色。 */
export function fabricTexture(part: 'shirt' | 'sleeve' | 'pants'): THREE.CanvasTexture {
  const hit = fabricCache[part];
  if (hit) return hit;
  const { canvas, g } = createCanvas(256, 256);
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(0,0,0,0.035)';
  g.lineWidth = 0.5;
  for (let i = 0; i < 256; i += 3) {
    g.beginPath();
    g.moveTo(i, 0); g.lineTo(i, 256);
    g.moveTo(0, i); g.lineTo(256, i);
    g.stroke();
  }
  const r = rng(part === 'shirt' ? 81 : part === 'pants' ? 82 : 83);
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.shadowColor = 'rgba(0,0,0,0.18)';
  g.shadowBlur = 6;
  for (let i = 0; i < 14; i++) {
    const x = r() * 256, y = part === 'pants' ? range(r, 110, 245) : range(r, 165, 250);
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + 10, y - 12, x + range(r, -15, 15), y - range(r, 22, 55));
    g.stroke();
  }
  g.shadowBlur = 0;
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(0,0,0,0.2)';
  if (part === 'shirt') {
    g.strokeRect(62, 12, 4, 244);
    g.strokeRect(26, 62, 22, 38);
    g.strokeRect(80, 62, 22, 38);
    g.fillStyle = '#8d8d8d';
    for (let y = 38; y < 256; y += 43) {
      g.beginPath();
      g.arc(64, y, 1.3, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    g.beginPath();
    g.moveTo(3, 0); g.lineTo(3, 256);
    g.moveTo(0, 246); g.lineTo(256, 246);
    g.stroke();
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
  const shirt = own(newMat({ color: spec.shirt, map: fabricTexture('shirt'), roughness: 0.88, tempC: liveTemp }));
  const pants = own(newMat({ color: spec.pants, map: fabricTexture('pants'), roughness: 0.9, tempC: liveTemp }));
  const shoes = own(newMat({ color: spec.shoes ?? '#16161a', roughness: 0.75, tempC: liveTemp }));
  shoes.userData.shoes = true;
  // M4：皮肤更哑（0.7 的高光加上主角的冷色轮廓光，像上了清漆的木棍）
  const skin = own(newMat({ color: skinColor, roughness: 0.85, tempC: liveTemp }));
  skin.userData.skin = true;
  const belt = own(newMat({ color: '#1b1714', roughness: 0.55, metalness: 0.1, tempC: liveTemp }));
  if (style?.shoeMap) {
    shoes.map = style.shoeMap;
    shoes.color.set(0xffffff);
  }
  const torso = style?.torsoMap ? own(newMat({ color: 0xffffff, map: style.torsoMap, roughness: 0.88, tempC: liveTemp })) : shirt;
  const sleeve = own(newMat({ color: style?.sleeveMap ? 0xffffff : spec.shirt, map: style?.sleeveMap ?? fabricTexture('sleeve'), roughness: 0.88, tempC: liveTemp }));
  const robe = style?.robeMap ? own(newMat({ color: 0xffffff, map: style.robeMap, roughness: 0.92, tempC: liveTemp })) : sleeve;
  const hemColor = new THREE.Color(spec.robe ? 0xffffff : spec.shirt).multiplyScalar(0.72);
  const hem = own(newMat({ color: hemColor, roughness: 0.9, tempC: liveTemp }));
  const faceMat = spec.head === 'human' && face
    ? own(newMat({ color: 0xffffff, map: faceTexture(face as FaceOpts), roughness: 0.8, tempC: liveTemp }))
    : own(newMat({ color: skinColor, roughness: 0.85, tempC: liveTemp }));
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
  const replay = m === 'replay';
  return {
    map,
    mapAmt: map ? (o.face ? 1 : replay ? 0.85 : 0.5) : 0,
    base: o.src?.color ?? 0xffffff,
    baseAmt: replay ? 0.45 : tune?.baseAmt ?? (o.face ? 0.3 : 0.36),
    solid: o.solidOverride ?? (o.accessory ? 1 : o.face ? 0.35 : 0.22),
    rim: replay ? 0.22 : 0.32,
    albedo: 1,
    ...(replay ? { opacity: 0.75 } : {}),
  };
}

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
