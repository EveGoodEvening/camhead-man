// owner: WP3
// CRT 屏幕 ShaderMaterial（ARCH §8.4）：磷绿 emissive 基色、OSD、ALARM、扫描线、桶形畸变、五路分屏布局、照妖镜套叠。
// 屏幕自发光不受灯光影响；它是场景里的普通材质，输出线性 HDR，最终由 CameraFxPass 统一做色调映射。
//
// 各 uniform 的约定（WP5 的 CrtScreenController 写它们）：
// - map：当前频道画面（RT 或 CanvasTexture；null = 无画面，只剩磷光底色）。CanvasTexture 应设 SRGBColorSpace。
// - osd：透明底的 OSD 画布（日期时间、CH 号、ALARM、SLOW…），叠在最上层；由控制器画。
// - noise：轻噪点与偶发横纹（静态频道的“噪点动画”）0..1；noSignal：雪花替换画面 0..1（切台、没信号）。
// - scan：屏幕扫描线 0..1（远看时按屏幕像素密度自动淡出，避免摩尔纹）；barrel：屏幕弯曲 0..0.3。
// - tunnel/tunnelMix：照妖镜。tunnelMix ∈ (0,1) 时把整张 tunnel（RT 模式下的 tunnelInner）缩到屏幕正中约 42% 大小、带暗框，
//   按 tunnelMix 混入（M4：原来只在中心圆里混一块，最深处老周的脸落在遮罩外）；
//   tunnelMix = 1 时整屏换成 tunnel 并带缓慢的推近动画（预制 8 层嵌套贴图，settings.tunnelMode='baked'）。
// - layout = 1（split5）：atlas 是整屏的 3 列 × 2 行布局图（512×384），读序 CH1 CH2 CH3 / CH4 CH5 日期；
//   着色器在 CH2 格（上排中间）换成 ch2 的实时 RT，并画格线。
// - split = 1：录像带双分屏——画中缝，并在右半左上角贴“CH2”标签（左半的 OSD 由 osd 画布负责）。
// - time：动画时间（秒）。
// 另有 WP3 内部 uniform：uLayout（layout 的镜像：layout 是 GLSL 保留字）、uPower（0 = 未通电的黑玻璃，MATERIALS.crtScreen() 用）、uLabel、uHas*（onBeforeRender 按贴图是否为 null 自动写）。

import * as THREE from 'three';
import { PALETTE } from '../data/palette';
import { TEMP_C } from '../data/render';

export interface CrtUniforms {
  map: THREE.Texture | null; osd: THREE.CanvasTexture; noise: number; scan: number; barrel: number; noSignal: number;
  tunnel: THREE.Texture | null; tunnelMix: number; time: number;
  /** 0 single；1 split5（五路分屏，ARCH §6.11） */
  layout: 0 | 1;
  /** split5 时 CH2 格的实时 RT */
  ch2: THREE.Texture | null;
  /** split5 时其余格的 512×384 静态画布图集 */
  atlas: THREE.Texture | null;
  /** 录像带双分屏时的中缝与右半 OSD（tapeScene 已把两半渲进同一张 RT，这里只画分隔线与标签） */
  split: 0 | 1;
}

export type CrtScreenMaterial = THREE.ShaderMaterial & { uniforms: { [K in keyof CrtUniforms]: { value: CrtUniforms[K] } } };

/** 红外：通电的 CRT 是热的——P13“屏幕上只剩一团热”（GDD）。 */
export const CRT_TEMP_C = 42;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform sampler2D osd;
uniform sampler2D tunnel;
uniform sampler2D ch2;
uniform sampler2D atlas;
uniform sampler2D uLabel;
uniform float noise;
uniform float scan;
uniform float barrel;
uniform float noSignal;
uniform float tunnelMix;
uniform float time;
uniform float uLayout;
uniform float split;
uniform float uPower;
uniform float uHasMap;
uniform float uHasTunnel;
uniform float uHasCh2;
uniform float uHasAtlas;
uniform float uHasLabel;
uniform vec3 uPhosphor;
varying vec2 vUv;

const vec3 CM_LUMA = vec3( 0.2126, 0.7152, 0.0722 );
// 实时照妖镜：最深处画面占屏幕的比例（M4）
const float TUNNEL_INNER_SIZE = 0.42;

float cmHash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

// 磷光余辉：主样本 + 横向 4 个小偏移的模糊样本，亮处泛出一圈软光
vec3 cmSoft( sampler2D t, vec2 uv ) {
  vec3 c = texture2D( t, uv ).rgb;
  vec2 d = vec2( 0.004, 0.0 );
  vec3 b = texture2D( t, uv + d ).rgb + texture2D( t, uv - d ).rgb + texture2D( t, uv + 2.0 * d ).rgb + texture2D( t, uv - 2.0 * d ).rgb;
  return c * 0.85 + b * 0.25 * 0.3;
}

void main() {
  // 屏幕弯曲：各轴按另一轴的平方外鼓；弯出屏幕的部分是黑色边框
  vec2 c = vUv * 2.0 - 1.0;
  c *= 1.0 + barrel * ( c.yx * c.yx );
  vec2 uv = c * 0.5 + 0.5;
  float inside = step( 0.0, uv.x ) * step( uv.x, 1.0 ) * step( 0.0, uv.y ) * step( uv.y, 1.0 );

  // 玻璃上的一点环境反光（通电与否都有；未通电时它就是屏幕的全部观感）
  float glare = ( 1.0 - smoothstep( 0.0, 0.75, length( ( vUv - vec2( 0.28, 0.78 ) ) * vec2( 1.0, 1.6 ) ) ) ) * 0.035;
  vec3 glass = vec3( 0.010, 0.013, 0.012 ) + vec3( glare );

  if ( uPower < 0.5 ) {
    gl_FragColor = vec4( glass, 1.0 );
    return;
  }

  vec3 content = vec3( 0.0 );
  if ( uLayout > 0.5 ) {
    if ( uHasAtlas > 0.5 ) content = texture2D( atlas, uv ).rgb;
    vec2 g = uv * vec2( 3.0, 2.0 );
    vec2 cell = floor( g );
    vec2 f = fract( g );
    // CH2 格：上排（uv.y > 0.5 → cell.y = 1）中间一列
    if ( uHasCh2 > 0.5 && cell.x == 1.0 && cell.y == 1.0 ) content = cmSoft( ch2, f );
    // 格线
    vec2 gl = min( f, 1.0 - f ) * vec2( 3.0, 2.0 );
    float lineW = 0.006;
    content *= step( lineW, min( gl.x, gl.y ) );
  } else if ( uHasMap > 0.5 ) {
    content = cmSoft( map, uv );
  }

  // 照妖镜
  if ( uHasTunnel > 0.5 && tunnelMix > 0.0 ) {
    float breath = 0.5 + 0.5 * sin( time * 0.9 );
    if ( tunnelMix >= 0.999 ) {
      // 预制：整屏换成 8 层嵌套贴图并缓慢推近
      vec2 tuv = 0.5 + ( uv - 0.5 ) * ( 1.0 - 0.07 * breath );
      content = texture2D( tunnel, tuv ).rgb;
    } else {
      // 实时（M4）：把整张最深处的画面（椅子上的老周）缩进屏幕正中，当作“最里一层屏幕”——约 42% 大小、带一圈暗框，
      // 不再只在中心圆里混一块（那样老周的脸落在遮罩外，GDD P13“最深处那把椅子上坐着老周，正抬头看你”看不出来）
      float k = TUNNEL_INNER_SIZE * ( 1.0 - 0.025 * breath );
      vec2 tuv = 0.5 + ( uv - 0.5 ) / k;
      vec2 d = abs( tuv - 0.5 );
      vec2 px = max( fwidth( tuv ), vec2( 1e-4 ) );
      float inside = step( d.x, 0.5 ) * step( d.y, 0.5 );
      // 暗框：内沿 1.5px + 外沿 2.5px（最里层 CRT 的边框）
      float bezel = step( d.x, 0.5 + 2.5 * px.x ) * step( d.y, 0.5 + 2.5 * px.y )
        * ( 1.0 - step( d.x, 0.5 - 1.5 * px.x ) * step( d.y, 0.5 - 1.5 * px.y ) );
      vec3 tc = texture2D( tunnel, clamp( tuv, 0.0, 1.0 ) ).rgb;
      content = mix( content, tc, tunnelMix * inside );
      content *= 1.0 - 0.88 * bezel * tunnelMix;
    }
  }

  // 录像带双分屏：中缝 + 右半标签
  if ( split > 0.5 ) {
    content *= step( 0.004, abs( uv.x - 0.5 ) );
    if ( uHasLabel > 0.5 ) {
      vec2 luv = ( uv - vec2( 0.53, 0.86 ) ) / vec2( 0.16, 0.08 );
      if ( luv.x >= 0.0 && luv.x <= 1.0 && luv.y >= 0.0 && luv.y <= 1.0 ) {
        vec4 lab = texture2D( uLabel, luv );
        content = mix( content, lab.rgb, lab.a );
      }
    }
  }

  // 磷光：轻微偏向磷绿的单色感
  float l = dot( content, CM_LUMA );
  content = mix( content, l * uPhosphor / max( dot( uPhosphor, CM_LUMA ), 1e-3 ), 0.22 );

  // 雪花（无信号）与轻噪点
  float frameNo = floor( time * 30.0 );
  float snow = cmHash12( floor( uv * vec2( 320.0, 240.0 ) ) + frameNo * 1.37 );
  float snowBar = 0.85 + 0.15 * sin( ( uv.y + time * 0.35 ) * 20.0 );
  content = mix( content, vec3( snow * 0.8 * snowBar ), clamp( noSignal, 0.0, 1.0 ) );
  if ( noise > 0.0 ) {
    float n = cmHash12( floor( uv * vec2( 256.0, 192.0 ) ) + frameNo * 3.7 ) - 0.5;
    float streak = step( 0.985, cmHash12( vec2( floor( uv.y * 96.0 ), frameNo ) ) );
    content += ( n * 0.25 + streak * 0.35 ) * noise;
  }

  // OSD 在最上层
  vec4 o = texture2D( osd, uv );
  content = mix( content, o.rgb * 1.25, o.a );

  // 扫描线：屏幕上约 240 行；按像素密度淡出（fwidth > 0.5 行/像素时会出摩尔纹）
  float rows = uv.y * 240.0;
  float fw = fwidth( rows );
  float scanAmt = scan * ( 1.0 - smoothstep( 0.35, 0.8, fw ) );
  content *= 1.0 - scanAmt * 0.55 * ( 0.5 + 0.5 * cos( rows * 6.28318530718 ) );

  // 屏幕四周暗角（显像管边缘更暗）与磷光底色（黑也不是纯黑）
  vec2 e = min( uv, 1.0 - uv );
  float edge = smoothstep( 0.0, 0.07, min( e.x, e.y ) );
  vec3 lit = max( content, uPhosphor * 0.012 ) * edge * 1.3;

  gl_FragColor = vec4( mix( glass, lit + vec3( glare ), inside ), 1.0 );
}
`;

let emptyOsd: THREE.CanvasTexture | null = null;
let splitLabel: THREE.CanvasTexture | null = null;

/** 默认 OSD：1×1 透明画布（控制器 attach 后会换成自己的 OSD 画布）。 */
function blankOsd(): THREE.CanvasTexture {
  if (emptyOsd) return emptyOsd;
  const cv = document.createElement('canvas');
  cv.width = 1;
  cv.height = 1;
  emptyOsd = new THREE.CanvasTexture(cv);
  emptyOsd.colorSpace = THREE.SRGBColorSpace;
  emptyOsd.name = 'crt:blank-osd';
  return emptyOsd;
}

/** 双分屏右半的“CH2”标签（磷绿等宽字，透明底）。 */
function splitLabelTexture(): THREE.CanvasTexture {
  if (splitLabel) return splitLabel;
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 64;
  const g = cv.getContext('2d');
  if (g) {
    g.clearRect(0, 0, cv.width, cv.height);
    g.font = 'bold 40px "DejaVu Sans Mono","Menlo","Consolas",monospace';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillText('CH2', 6, 34);
    g.fillStyle = PALETTE.OSD;
    g.fillText('CH2', 4, 32);
  }
  splitLabel = new THREE.CanvasTexture(cv);
  splitLabel.colorSpace = THREE.SRGBColorSpace;
  splitLabel.name = 'crt:split-label';
  return splitLabel;
}

type CrtAll = CrtUniforms & {
  uLabel: THREE.Texture | null; uLayout: number; uPower: number; uHasMap: number; uHasTunnel: number; uHasCh2: number; uHasAtlas: number; uHasLabel: number;
  uPhosphor: THREE.Color;
};

/** 每次调用新建一个实例（CrtScreenController 私有；MATERIALS.crtScreen() 是另一个共享的静态外观实例） */
export function createCrtScreenMaterial(o?: { powered?: boolean }): CrtScreenMaterial {
  const values: CrtAll = {
    map: null, osd: blankOsd(), noise: 0, scan: 0.35, barrel: 0.12, noSignal: 0,
    tunnel: null, tunnelMix: 0, time: 0, layout: 0, ch2: null, atlas: null, split: 0,
    uLabel: null, uLayout: 0, uPower: o?.powered === false ? 0 : 1, uHasMap: 0, uHasTunnel: 0, uHasCh2: 0, uHasAtlas: 0, uHasLabel: 0,
    uPhosphor: new THREE.Color(PALETTE.OSD),
  };
  const uniforms: Record<string, THREE.IUniform<unknown>> = {};
  for (const [k, v] of Object.entries(values)) uniforms[k] = { value: v };
  const m = new THREE.ShaderMaterial({
    name: 'crtScreen',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
  }) as CrtScreenMaterial;
  m.userData.tempC = o?.powered === false ? TEMP_C.ambient : CRT_TEMP_C;
  // 着色器用 uHas* 区分“贴图为 null”与“贴图全黑”：WP5 只写冻结的 CrtUniforms，这里在每次绘制前自动同步
  const u = uniforms as { [K in keyof CrtAll]: { value: CrtAll[K] } };
  m.onBeforeRender = () => {
    // `layout` 是 GLSL ES 3.0 的保留字，着色器里用 uLayout；冻结的 CrtUniforms 键名仍是 layout
    u.uLayout.value = u.layout.value;
    u.uHasMap.value = u.map.value ? 1 : 0;
    u.uHasTunnel.value = u.tunnel.value ? 1 : 0;
    u.uHasCh2.value = u.ch2.value ? 1 : 0;
    u.uHasAtlas.value = u.atlas.value ? 1 : 0;
    if (u.split.value === 1 && !u.uLabel.value) u.uLabel.value = splitLabelTexture();
    u.uHasLabel.value = u.uLabel.value ? 1 : 0;
  };
  return m;
}
