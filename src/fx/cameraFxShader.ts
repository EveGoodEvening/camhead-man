// owner: WP3
// CameraFxPass（ARCH §8.1）：合并的 ShaderPass，取代 OutputPass。着色器内顺序：
// 桶形畸变 UV → 径向色差采样（线性）→ VHS → 分支：红外（线性灰度查 IR_RAMP → 粗噪点 → 轮廓线）或常规（uExposure → 传感器饱和 → NeutralToneMapping → sRGBTransferOETF）
// → 单红通道 → tint → 灯管频闪 → 暗角 → 扫描线 → 颗粒 → 4:3 黑边（按 frameRect）→ 白闪 → 淡黑。
// material.toneMapped = false；renderer.toneMappingExposure 固定为 1（r186 的 NeutralToneMapping 会乘它）。
// 本文件的导出是 WP3 内部实现细节（PostPipeline 使用）。
//
// 注意（r186 已核实）：非 Raw 的 ShaderMaterial 的片元前缀**已经**内联了 colorspace_pars_fragment（WebGLProgram.js，
// 供 linearToOutputTexel 用），所以这里只 #include <tonemapping_pars_fragment>；再 include 一次 colorspace 会重复定义
// sRGBTransferOETF 而编译失败。tonemapping_pars_fragment 只在 toneMapping !== NoToneMapping 时才进前缀，本材质 toneMapped:false，所以要自己带。
// 红外/常规的切换是 uniform 分支（不是 define），切换不触发重编译（ARCH §16 #6）。

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { FxParams } from './post';
import { IR_RAMP } from '../data/palette';

export interface CameraFxUniforms {
  [name: string]: THREE.IUniform<unknown>;
  tDiffuse: THREE.IUniform<THREE.Texture | null>;
  uResolution: THREE.IUniform<THREE.Vector2>;
  uTime: THREE.IUniform<number>;
  uExposure: THREE.IUniform<number>;
  uGrain: THREE.IUniform<number>;
  uScanline: THREE.IUniform<number>;
  uChroma: THREE.IUniform<number>;
  uVignette: THREE.IUniform<number>;
  uMonoRed: THREE.IUniform<number>;
  uVhs: THREE.IUniform<number>;
  /** M4 第 2 轮：回放暂停（1 = 跟踪噪声条停在画面底部 6% 处，不再滚过人脸；ReplaySystem 写） */
  uVhsPaused: THREE.IUniform<number>;
  uBarrel: THREE.IUniform<number>;
  uIr: THREE.IUniform<number>;
  uTint: THREE.IUniform<THREE.Vector3>;
  uTintAmt: THREE.IUniform<number>;
  uFrame43: THREE.IUniform<number>;
  /** 4:3 画框在屏幕 UV 中的矩形：x0, y0, x1, y1 */
  uFrameRect: THREE.IUniform<THREE.Vector4>;
  uFlash: THREE.IUniform<number>;
  uFade: THREE.IUniform<number>;
  uFlicker: THREE.IUniform<number>;
  uIrRamp: THREE.IUniform<THREE.Vector3[]>;
}

/** '#rrggbb' → 显示空间（sRGB 编码后）的 0..1 分量：红外分支的输出已经是显示色，不再做 OETF。 */
function displayRgb(hex: string): THREE.Vector3 {
  const n = Number.parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const FRAG = /* glsl */ `
#include <tonemapping_pars_fragment>

uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uTime;
uniform float uExposure;
uniform float uGrain;
uniform float uScanline;
uniform float uChroma;
uniform float uVignette;
uniform float uMonoRed;
uniform float uVhs;
uniform float uVhsPaused;
uniform float uBarrel;
uniform float uIr;
uniform vec3 uTint;
uniform float uTintAmt;
uniform float uFrame43;
uniform vec4 uFrameRect;
uniform float uFlash;
uniform float uFade;
uniform float uFlicker;
uniform vec3 uIrRamp[ 5 ];

varying vec2 vUv;

#define CM_PI 3.141592653589793
// 传感器饱和的起止亮度与最大程度（look-dev 冻结，见 4b）
#define CM_CLIP_LO 0.7
#define CM_CLIP_HI 3.0
#define CM_CLIP_AMT 0.85
const vec3 CM_LUMA = vec3( 0.2126, 0.7152, 0.0722 );

// Dave Hoskins 的 hash（无 sin，跨 GPU 稳定）
float cmHash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

vec3 cmIrRamp( float t ) {
  float x = clamp( t, 0.0, 1.0 ) * 4.0;
  int i = int( min( floor( x ), 3.0 ) );
  return mix( uIrRamp[ i ], uIrRamp[ i + 1 ], x - float( i ) );
}

vec3 cmSample( vec2 uv ) {
  // 画面外（桶形畸变或抖动把 UV 推出去）一律黑
  vec2 inside = step( vec2( 0.0 ), uv ) * step( uv, vec2( 1.0 ) );
  return texture2D( tDiffuse, clamp( uv, 0.0, 1.0 ) ).rgb * inside.x * inside.y;
}

void main() {
  float aspect = uResolution.x / max( uResolution.y, 1.0 );
  // 动画用的“帧号”：颗粒与 VHS 按 24fps 换样，游戏时间停住时画面也停住（锁步截图可复现）
  float frameNo = floor( uTime * 24.0 );

  // 1) 桶形畸变：边缘向内压（直线外凸），并按角点归一，四角仍落在四角，不出黑边
  vec2 uv = vUv;
  if ( uBarrel > 0.0 ) {
    vec2 c = uv - 0.5;
    float r2 = dot( c, c );
    uv = 0.5 + c * ( 1.0 + uBarrel * r2 * 4.0 ) / ( 1.0 + uBarrel * 2.0 );
  }

  // 3a) VHS 的几何部分（行抖动、跟踪带、磁头切换噪声）要在采样前改 UV
  float trackBand = 0.0;
  if ( uVhs > 0.0 ) {
    float line = floor( uv.y * 240.0 );
    float jitter = ( cmHash12( vec2( line, frameNo ) ) - 0.5 ) * 0.0035;
    float wobble = sin( uv.y * 7.0 + uTime * 1.7 ) * 0.0015;
    // M4 第 2 轮：暂停时噪声条停在画面底部（真录像机暂停也是这样），不再横在要拍的人头上
    float bandPos = mix( 1.0 - fract( uTime * 0.13 ), 0.06, uVhsPaused );
    float bd = abs( uv.y - bandPos );
    trackBand = 1.0 - smoothstep( 0.0, 0.03, bd );
    float bandShift = ( cmHash12( vec2( line * 0.37, frameNo + 17.0 ) ) - 0.5 ) * 0.03 * trackBand;
    float head = 1.0 - smoothstep( 0.0, 0.035, uv.y );          // 底部磁头切换的横向错位
    uv.x += ( jitter + wobble + bandShift + head * 0.02 ) * uVhs;
  }

  // 2) 径向色差（线性空间采样）：偏移 = dir × chroma × r²（r² 按屏幕对角线归一：中心为 0、四角为 1）。
  //    M1c look-dev：原来是 dir × chroma × 2（线性、全屏都偏），取景器 ×2.5 后 1280 宽的画面边缘分出近 10px 的红绿蓝；
  //    现在中心干净，R1 常规画面四角约 2px、取景器 4:3 画框四角约 2–3px。
  vec2 dir = uv - 0.5;
  vec2 dirA = dir * vec2( aspect, 1.0 );
  float cr2 = dot( dirA, dirA ) / ( 0.25 * ( aspect * aspect + 1.0 ) );
  vec2 off = dir * uChroma * cr2;
  vec3 col;
  col.r = cmSample( uv + off ).r;
  col.g = cmSample( uv ).g;
  col.b = cmSample( uv - off ).b;

  // 3b) VHS 的色溢（色度横向拖尾，亮度保持）与跟踪带的雪花
  if ( uVhs > 0.0 ) {
    vec2 bleed = vec2( 0.006 * uVhs, 0.0 );
    vec3 smear = ( cmSample( uv - bleed ) + cmSample( uv - 2.0 * bleed ) + col ) / 3.0;
    float yl = dot( col, CM_LUMA );
    float ys = dot( smear, CM_LUMA );
    col = mix( col, max( smear - ys + yl, 0.0 ), 0.7 * uVhs );
    float snow = step( 0.82, cmHash12( floor( gl_FragCoord.xy * vec2( 0.5, 1.0 ) ) + frameNo * 3.1 ) );
    col += snow * trackBand * 0.22 * uVhs;
    col *= 1.0 - 0.14 * trackBand * uVhs;
  }

  vec3 disp;
  if ( uIr > 0.5 ) {
    // 4a) 红外：RenderPass 输出的是线性灰度 t/45（irMaterial），直接查铁虹色带；粗噪点（2px 块）加在温度上
    float t = dot( col, CM_LUMA );
    // 轮廓线（M1c look-dev，热像仪的 MSX 式边缘增强）：温度/掠射角突变处叠一道淡白线，
    // 同温的墙、门、窗框、台阶在红外下也分得清；只在红外分支多 4 次采样。
    vec2 ipx = 1.5 / uResolution;
    float ex = dot( cmSample( uv + vec2( ipx.x, 0.0 ) ) - cmSample( uv - vec2( ipx.x, 0.0 ) ), CM_LUMA );
    float ey = dot( cmSample( uv + vec2( 0.0, ipx.y ) ) - cmSample( uv - vec2( 0.0, ipx.y ) ), CM_LUMA );
    float irEdge = smoothstep( 0.006, 0.05, abs( ex ) + abs( ey ) );
    float n = cmHash12( floor( gl_FragCoord.xy / 2.0 ) + frameNo * 7.13 ) - 0.5;
    t += n * uGrain * 0.25;
    disp = cmIrRamp( t );
    disp = mix( disp, vec3( 1.0, 0.97, 0.9 ), irEdge * 0.28 );
  } else {
    // 4b) 常规：曝光 → 传感器饱和 → Neutral 色调映射 → sRGB 编码
    // 传感器饱和（M1c look-dev）：监控摄像头的高光会“溢”成白——HDR 亮度 > ~1 的像素（灯芯、灯罩、近处的亮窗）
    // 按亮度往最大通道收拢，灯芯烧白、光晕外圈保留灯色；Neutral 本身保色相，没有这一步钠灯永远是一块纯橙，远看不像“亮”。
    // 墙面、地面这类受光面到不了这个亮度，不受影响。
    vec3 hx = col * uExposure;
    float hl = dot( hx, CM_LUMA );
    hx = mix( hx, vec3( max( max( hx.r, hx.g ), hx.b ) ), smoothstep( CM_CLIP_LO, CM_CLIP_HI, hl ) * CM_CLIP_AMT );
    disp = NeutralToneMapping( hx );
    disp = sRGBTransferOETF( vec4( disp, 1.0 ) ).rgb;
  }

  // 5) 暗房单红通道：红灯下只剩红通道的明暗（颜色信息全部丢失，GDD P7）
  if ( uMonoRed > 0.0 ) {
    float v = disp.r;
    disp = mix( disp, vec3( v, v * 0.06, v * 0.05 ), uMonoRed );
  }

  // 6) 色调（回放棕绿、卯时黎明粉、鬼市偏绿）：保亮度地染色
  if ( uTintAmt > 0.0 ) {
    float l = dot( disp, CM_LUMA );
    vec3 tinted = l * uTint / max( dot( uTint, CM_LUMA ), 1e-3 );
    disp = mix( disp, tinted, uTintAmt );
  }

  // 7) 灯管频闪：偶发的掉光 + 轻微的慢波纹
  if ( uFlicker > 0.0 ) {
    float dip = smoothstep( 0.72, 1.0, cmHash12( vec2( floor( uTime * 17.0 ), 5.0 ) ) );
    float ripple = 0.5 + 0.5 * sin( uTime * 2.0 * CM_PI * 6.0 );
    disp *= 1.0 - uFlicker * ( 0.8 * dip + 0.15 * ripple );
  }

  // 8) 暗角：取景器（frame43）时相对 4:3 画框计算，否则相对全屏
  vec2 fuv = mix( vUv, ( vUv - uFrameRect.xy ) / max( uFrameRect.zw - uFrameRect.xy, vec2( 1e-4 ) ), step( 0.5, uFrame43 ) );
  float fa = mix( aspect, 4.0 / 3.0, step( 0.5, uFrame43 ) );
  vec2 vc = ( fuv - 0.5 ) * vec2( fa, 1.0 );
  float vr = length( vc ) / length( vec2( fa, 1.0 ) * 0.5 );
  float vig = smoothstep( 0.3, 1.1, vr );
  disp *= 1.0 - uVignette * vig * 1.15;

  // 9) 扫描线：每 3 个设备像素一条，外加监控画面上缓慢滚动的亮带
  if ( uScanline > 0.0 ) {
    float lines = uResolution.y / 3.0;
    float s = 0.5 + 0.5 * cos( vUv.y * lines * 2.0 * CM_PI );
    float roll = smoothstep( 0.0, 0.12, fract( vUv.y * 0.7 - uTime * 0.05 ) ) * ( 1.0 - smoothstep( 0.12, 0.3, fract( vUv.y * 0.7 - uTime * 0.05 ) ) );
    disp *= 1.0 - uScanline * ( 0.55 * s - 0.25 * roll );
  }

  // 10) 颗粒：暗部更明显（传感器噪声），按 24fps 换样
  if ( uGrain > 0.0 ) {
    float l = clamp( dot( disp, CM_LUMA ), 0.0, 1.0 );
    float n = cmHash12( gl_FragCoord.xy + vec2( frameNo * 17.31, frameNo * 5.77 ) ) - 0.5;
    disp += n * uGrain * mix( 0.65, 0.3, l );
  }

  // 11) 4:3 黑边
  if ( uFrame43 > 0.0 ) {
    vec2 inR = step( uFrameRect.xy, vUv ) * step( vUv, uFrameRect.zw );
    disp *= mix( 1.0, inR.x * inR.y, clamp( uFrame43, 0.0, 1.0 ) );
  }

  // 12) 白闪 → 13) 淡黑
  disp = mix( disp, vec3( 1.0 ), clamp( uFlash, 0.0, 1.0 ) );
  disp = mix( disp, vec3( 0.0 ), clamp( uFade, 0.0, 1.0 ) );

  gl_FragColor = vec4( clamp( disp, 0.0, 1.0 ), 1.0 );
}
`;

/** 创建 CameraFxPass（renderToScreen 由 EffectComposer 按“最后一个启用的 pass”自动设置）。 */
export function createCameraFxPass(): ShaderPass {
  const uniforms: CameraFxUniforms = {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uExposure: { value: 1 },
    uGrain: { value: 0 },
    uScanline: { value: 0 },
    uChroma: { value: 0 },
    uVignette: { value: 0 },
    uMonoRed: { value: 0 },
    uVhs: { value: 0 },
    uVhsPaused: { value: 0 },
    uBarrel: { value: 0 },
    uIr: { value: 0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uTintAmt: { value: 0 },
    uFrame43: { value: 0 },
    uFrameRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uFlash: { value: 0 },
    uFade: { value: 0 },
    uFlicker: { value: 0 },
    uIrRamp: { value: IR_RAMP.map(displayRgb) },
  };
  const material = new THREE.ShaderMaterial({
    name: 'CameraFxPass',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  return new ShaderPass(material);
}

/** 画框矩形（屏幕 UV）：视口中央最大的 4:3 矩形（与 CameraRig.frameRect() 同一定义，ARCH §4.7）。 */
export function frame43Rect(w: number, h: number, target = new THREE.Vector4()): THREE.Vector4 {
  const aspect = w / Math.max(h, 1);
  if (aspect >= 4 / 3) {
    const fw = (4 / 3) / aspect;
    return target.set(0.5 - fw / 2, 0, 0.5 + fw / 2, 1);
  }
  const fh = aspect / (4 / 3);
  return target.set(0, 0.5 - fh / 2, 1, 0.5 + fh / 2);
}

/** 把合成后的 FxParams 写入 pass 的 uniforms（w/h 为绘制缓冲像素尺寸）。 */
export function updateCameraFxUniforms(
  pass: ShaderPass, p: Readonly<FxParams>, o: { time: number; w: number; h: number; cssW: number; cssH: number; vhsPaused?: boolean },
): void {
  const u = pass.uniforms as CameraFxUniforms;
  u.uVhsPaused.value = o.vhsPaused ? 1 : 0;
  u.uResolution.value.set(Math.max(1, o.w), Math.max(1, o.h));
  u.uTime.value = o.time;
  u.uExposure.value = p.exposure;
  u.uGrain.value = Math.max(0, p.grain);
  u.uScanline.value = Math.max(0, p.scanline);
  u.uChroma.value = Math.max(0, p.chroma);
  u.uVignette.value = Math.max(0, p.vignette);
  u.uMonoRed.value = Math.min(1, Math.max(0, p.monoRed));
  u.uVhs.value = Math.min(1, Math.max(0, p.vhs));
  u.uBarrel.value = Math.max(0, p.barrel);
  u.uIr.value = p.ir >= 0.5 ? 1 : 0;
  u.uTint.value.set(p.tint[0], p.tint[1], p.tint[2]);
  u.uTintAmt.value = Math.min(1, Math.max(0, p.tintAmt));
  u.uFrame43.value = Math.min(1, Math.max(0, p.frame43));
  frame43Rect(o.cssW, o.cssH, u.uFrameRect.value);
  u.uFlash.value = Math.min(1, Math.max(0, p.flash));
  u.uFade.value = Math.min(1, Math.max(0, p.fade));
  u.uFlicker.value = Math.max(0, p.flicker);
}
