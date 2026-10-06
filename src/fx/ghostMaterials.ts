// owner: WP3
// mat.ghost、mat.replay、mat.paper_glow 的 ShaderMaterial 实现（ARCH §8.3）。
// transparent:true、depthWrite:false、renderOrder 分别 10/20/15（由使用处设置），最后绘制；需要雾时合并 UniformsLib.fog。
// 本文件的导出是 WP3 内部实现细节（MATERIALS.ghost/replay/paperGlow 调用它们），其他 WP 只经 MATERIALS 使用。
//
// 顶点部分用 three 的 chunk 写（morph/skinning/instancing 都照常工作：人偶、实例化人群、纸人都可能用到）。
// 颜色是线性 HDR：边缘光超过 Bloom 阈值，所以在夜景里自己会发一点光。
// 动画时间 FX_TIME 是所有这类材质共享的 uniform 对象，由 PostPipeline.render 每帧写入游戏时间（冻结时不走）。

import * as THREE from 'three';
import { PALETTE } from '../data/palette';

/** 共享的动画时间（秒，游戏时间）。 */
export const FX_TIME: THREE.IUniform<number> = { value: 0 };

const VERT = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <fog_pars_vertex>

varying vec3 vViewNormal;
varying vec3 vViewDir;
varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  #include <fog_vertex>

  vec4 wp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  vWorldPos = wp.xyz;
  vViewNormal = normalize( transformedNormal );
  vViewDir = normalize( -mvPosition.xyz );
  vUv = uv;
}
`;

/**
 * 冷青魂影：半透明，菲涅尔边缘光，缓慢上行的明暗带，轻微呼吸。
 * M4：可带原件的贴图与底色（人偶按部件各自一份，见 rigs/humanoid.ts）——贴图亮度调制魂影（碎花、中山装、眉眼嘴看得出来），
 * 身子中间保留一部分原来的色相（边缘仍是纯魂色）；uSolid 让辨识道具（帽子、发髻、眼镜、相机）更实一些。
 */
const GHOST_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform sampler2D uMap;
uniform float uHasMap;
uniform float uMapAmt;
uniform vec3 uBase;
uniform float uBaseAmt;
uniform float uSolid;
varying vec3 vViewNormal;
varying vec3 vViewDir;
varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
  vec3 n = normalize( vViewNormal );
  float ndv = abs( dot( n, normalize( vViewDir ) ) );
  float fres = pow( 1.0 - clamp( ndv, 0.0, 1.0 ), 2.4 );
  float band = 0.82 + 0.18 * sin( vWorldPos.y * 16.0 - uTime * 2.2 );
  float breathe = 0.93 + 0.07 * sin( uTime * 1.3 + vWorldPos.x * 0.7 );
  vec3 tex = uHasMap > 0.5 ? texture2D( uMap, vUv ).rgb : vec3( 1.0 );
  float tl = dot( tex, vec3( 0.3, 0.59, 0.11 ) );
  float detail = uMapAmt * uHasMap;
  vec3 col = uColor * ( 0.28 + 0.22 * detail + 1.9 * fres ) * band * breathe;
  col *= mix( 1.0, 0.15 + 1.9 * tl, detail );
  // 原色：按亮度归一的底色 × 贴图，只取色相，亮度跟魂影走；边缘仍是魂色
  vec3 alb = uBase * tex;
  vec3 hue = min( alb / max( dot( alb, vec3( 0.3, 0.59, 0.11 ) ), 0.02 ), vec3( 3.0 ) );
  col = mix( col, hue * dot( col, vec3( 0.3, 0.59, 0.11 ) ), uBaseAmt * ( 1.0 - 0.7 * fres ) );
  float a = uOpacity * mix( 0.42 + 0.6 * detail + 1.1 * fres, 1.55 + 0.4 * fres, uSolid ) * mix( 1.0, band, 0.5 );
  gl_FragColor = vec4( col, clamp( a, 0.0, 1.0 ) );
  #include <fog_fragment>
}
`;

/**
 * 回放人影：棕绿、半透明，录像带式的横向扫描条纹与偶发的整行闪断。M4：可带贴图亮度（衣服花色、五官）与一点原来的色相。
 * M4 第 2 轮：扫描线改成屏幕空间（3 像素一个周期、只压暗 10%）、整行闪断按 6 像素的屏幕行、概率 1.5%，都只压暗颜色、不再调制不透明度——
 * 原来按世界高度每 4.5cm 一条、亮度差 25%、连 alpha 一起乘，2–3m 外的人读成一摞摞圆盘；录像带质感交给 CameraFxPass 的回放预设。
 */
const REPLAY_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform sampler2D uMap;
uniform float uHasMap;
uniform float uMapAmt;
uniform vec3 uBase;
uniform float uBaseAmt;
uniform float uSolid;
varying vec3 vViewNormal;
varying vec3 vViewDir;
varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
  vec3 n = normalize( vViewNormal );
  float ndv = abs( dot( n, normalize( vViewDir ) ) );
  float fres = pow( 1.0 - clamp( ndv, 0.0, 1.0 ), 1.8 );
  // 伪“受光”：朝上的面亮一点，免得低模人偶完全平
  // M4 第 2 轮：朝下的面不再压到 0.55（膝、肘的填缝球下半圈一道道黑箍）
  float up = 0.7 + 0.3 * clamp( n.y * 0.5 + 0.5, 0.0, 1.0 );
  float line = 0.9 + 0.1 * step( 0.5, fract( gl_FragCoord.y / 3.0 ) );
  float row = floor( gl_FragCoord.y / 6.0 );
  float drop = step( 0.985, fract( sin( row * 91.7 + floor( uTime * 9.0 ) * 13.1 ) * 43758.5453 ) );
  vec3 tex = uHasMap > 0.5 ? texture2D( uMap, vUv ).rgb : vec3( 1.0 );
  float tl = dot( tex, vec3( 0.3, 0.59, 0.11 ) );
  float detail = uMapAmt * uHasMap;
  vec3 col = uColor * ( 0.55 * up + 1.4 * fres ) * line * ( 1.0 - 0.3 * drop );
  col *= mix( 1.0, 0.45 + 1.0 * tl, detail );
  vec3 alb = uBase * tex;
  vec3 hue = min( alb / max( dot( alb, vec3( 0.3, 0.59, 0.11 ) ), 0.02 ), vec3( 3.0 ) );
  col = mix( col, hue * dot( col, vec3( 0.3, 0.59, 0.11 ) ), uBaseAmt * ( 1.0 - 0.7 * fres ) );
  float a = uOpacity * mix( 0.75 + 0.5 * fres, 1.3, uSolid );
  gl_FragColor = vec4( col, clamp( a, 0.0, 1.0 ) );
  #include <fog_fragment>
}
`;

/** 纸像发光：金色，贴近边缘（UV 边框）与掠射角（菲涅尔）最亮，缓慢呼吸；加法混合叠在纸像上。 */
const PAPER_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
varying vec3 vViewNormal;
varying vec3 vViewDir;
varying vec3 vWorldPos;
varying vec2 vUv;

void main() {
  vec3 n = normalize( vViewNormal );
  float ndv = abs( dot( n, normalize( vViewDir ) ) );
  float fres = pow( 1.0 - clamp( ndv, 0.0, 1.0 ), 2.0 );
  // 贴边的一圈亮（纸像“描金”）向内很快衰减，中间只有一层很淡的金光，不盖住画
  vec2 e2 = min( vUv, 1.0 - vUv );
  float edge = 1.0 - smoothstep( 0.0, 0.09, min( e2.x, e2.y ) );
  edge *= edge;
  float glow = max( edge, fres * 0.8 );
  float pulse = 0.8 + 0.2 * sin( uTime * 1.6 );
  vec3 col = uColor * ( 0.05 + 1.5 * glow ) * pulse;
  gl_FragColor = vec4( col * uOpacity, 1.0 );
  // 加法混合下不能“混向雾色”（那会凭空加一层雾色光）：雾只让光变弱
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb *= 1.0 - fogFactor;
  #endif
}
`;

/**
 * 魂影/回放材质的“原件细节”（M4，WP3 内部）：人偶按部件各建一份（rigs/humanoid.ts），共享同一个着色器程序（全是 uniform，不加 define）。
 * - map：原材质的贴图（衣服花色、脸）；mapAmt 贴图亮度调制的强度（脸 0.95、衣服 0.5）
 * - base：原材质的底色；baseAmt 保留多少原色相（0.3–0.4）
 * - solid：0 = 普通魂影，1 = 辨识道具（帽子、发髻、眼镜、相机）更实一些（不透明度 ≥ 0.8）
 */
export interface GhostDetail {
  map?: THREE.Texture | null;
  mapAmt?: number;
  base?: THREE.ColorRepresentation;
  baseAmt?: number;
  solid?: number;
  /** M4 第 2 轮：不透明度（缺省：魂影 0.5、回放 0.6；人偶的回放部件用 0.75） */
  opacity?: number;
}

function makeUniforms(color: THREE.ColorRepresentation, opacity: number, d?: GhostDetail): Record<string, THREE.IUniform<unknown>> {
  return THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity },
      uMap: { value: null }, uHasMap: { value: d?.map ? 1 : 0 }, uMapAmt: { value: d?.mapAmt ?? 0 },
      uBase: { value: new THREE.Color(d?.base ?? 0xffffff) }, uBaseAmt: { value: d?.baseAmt ?? 0 }, uSolid: { value: d?.solid ?? 0 },
    },
  ]) as Record<string, THREE.IUniform<unknown>>;
}

function make(name: string, frag: string, color: THREE.ColorRepresentation, opacity: number, blending: THREE.Blending, d?: GhostDetail): THREE.ShaderMaterial {
  const uniforms = makeUniforms(color, opacity, d);
  // FX_TIME 必须是同一个对象（merge 会克隆），所以在 merge 之后再挂上；贴图也在 merge 之后挂（merge 会克隆贴图）
  uniforms['uTime'] = FX_TIME;
  if (d?.map) (uniforms['uMap'] as THREE.IUniform<THREE.Texture | null>).value = d.map;
  const m = new THREE.ShaderMaterial({
    name,
    uniforms,
    vertexShader: VERT,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    fog: true,
    blending,
  });
  return m;
}

/** 半透明冷青魂影，菲涅尔边缘光（GDD §2.7：#8FD3D6，opacity 0.5）。d：M4 的原件细节（缺省 = 纯魂色）。 */
export function createGhostMaterial(color: THREE.ColorRepresentation = PALETTE.GHOST, d?: GhostDetail): THREE.ShaderMaterial {
  return make('mat.ghost', GHOST_FRAG, color, d?.opacity ?? 0.5, THREE.NormalBlending, d);
}

/** 棕绿半透明回放人影（REPLAY #8A8A5A）。d：M4 的原件细节（缺省 = 纯回放色）。 */
export function createReplayMaterial(d?: GhostDetail): THREE.ShaderMaterial {
  return make('mat.replay', REPLAY_FRAG, PALETTE.REPLAY, d?.opacity ?? 0.6, THREE.NormalBlending, d);
}

/** 纸像取景器发光（TUDI_GOLD #E8C35A）。加法混合：叠在门神/灶君纸像上，只加光不遮画。 */
export function createPaperGlowMaterial(): THREE.ShaderMaterial {
  return make('mat.paper_glow', PAPER_FRAG, PALETTE.TUDI_GOLD, 0.9, THREE.AdditiveBlending);
}

/**
 * 魂影/回放人身的深度预通道材质（M4，共享）：只写深度不写颜色、透明队列里比魂影早一档画（renderOrder − 1），
 * 这样魂影只画最外一层壳，四肢、提篮不再从躯干里透出来（X 光感）。放在透明队列是为了排在全部不透明物体之后——
 * 放在不透明队列会先于背后的墙写深度，把墙挖出黑洞。
 */
let prepassMat: THREE.MeshBasicMaterial | null = null;
export function ghostPrepassMaterial(): THREE.MeshBasicMaterial {
  if (!prepassMat) {
    prepassMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, fog: false });
    prepassMat.name = 'mat.ghost_prepass';
    prepassMat.userData.noOcclude = true;
    prepassMat.userData.sharedPrepass = true;
  }
  return prepassMat;
}
