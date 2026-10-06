// owner: WP3
// 共享材质库（ARCH §8.3）：工厂函数返回缓存的共享实例（同参数同实例），区域不得 dispose() 它们。
// 每个共享材质自带 userData.tempC（红外，ARCH §6.8.2）。
//
// 贴图：砖、瓷砖、墙裙、锈、湿地面用 kit/canvas.ts 的 PAINT；抹灰/石灰/水泥/木纹/白绿瓷砖用 paintTexture 画（本文件的画法）。
// 大面材质（砖、抹灰、石灰、瓷砖、水泥、湿地面）用**世界空间三向投影**（triplanar）采样贴图：贴图密度只由 uTriScale（米/张）决定，
// 与网格 UV 无关——kit 的 box()/building() 怎么生成 UV 都不会把砖拉伸。代价是每像素 3 次采样，且移动的物体上纹理会“滑”，
// 所以门、道具这类会动或需要精确对位的（木、墙裙、锈铁）仍用网格 UV。
// 金属类 metalness 0.4–0.7、roughness 0.35–0.6：观感依赖区域环境贴图（fx/environment.ts）。

import * as THREE from 'three';
import { PAINT, paintTexture } from '../kit/canvas';
import { rng, range } from '../kit/rng';
import { PALETTE } from '../data/palette';
import { TEMP_C } from '../data/render';
import { createGhostMaterial, createPaperGlowMaterial, createReplayMaterial, ghostPrepassMaterial } from './ghostMaterials';
import { createCrtScreenMaterial } from './crtScreen';

export interface MaterialLibrary {
  brick(): THREE.MeshStandardMaterial;
  plaster(): THREE.MeshStandardMaterial;
  lime(): THREE.MeshStandardMaterial;
  dado(): THREE.MeshStandardMaterial;
  tileWhite(): THREE.MeshStandardMaterial;
  tileGreenWhite(): THREE.MeshStandardMaterial;
  concrete(): THREE.MeshStandardMaterial;
  asphaltWet(): THREE.MeshStandardMaterial;
  wood(): THREE.MeshStandardMaterial;
  metal(): THREE.MeshStandardMaterial;
  tin(): THREE.MeshStandardMaterial;
  enamelYellow(): THREE.MeshStandardMaterial;
  enamelRed(): THREE.MeshStandardMaterial;
  porcelain(): THREE.MeshStandardMaterial;
  /** tempC 6 */
  paper(): THREE.MeshStandardMaterial;
  cloth(color: THREE.ColorRepresentation): THREE.MeshStandardMaterial;
  /** transparent，userData.noOcclude = true */
  glass(): THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
  /** 灯罩、霓虹（tempC 60） */
  emissive(color: THREE.ColorRepresentation, intensity?: number): THREE.MeshStandardMaterial;
  /** mat.ghost */
  ghost(color?: THREE.ColorRepresentation): THREE.ShaderMaterial;
  /** mat.replay */
  replay(): THREE.ShaderMaterial;
  /** mat.paper_glow（纸像取景器发光，TUDI_GOLD） */
  paperGlow(): THREE.ShaderMaterial;
  /** 见 fx/crtScreen.ts；共享实例，仅作未通电/装饰用 CRT 的静态外观（不接任何 feed）；通电的屏幕由 CrtScreenController.attach 换成私有实例（ARCH §6.11） */
  crtScreen(): THREE.ShaderMaterial;
  /** visible:false：交互拾取代理（对象本身 visible 为真，射线能命中，但不绘制） */
  hitProxy(): THREE.MeshBasicMaterial;
  /** M4：魂影/回放人身的深度预通道（只写深度，透明队列里比魂影早一档；见 fx/ghostMaterials.ts ghostPrepassMaterial） */
  ghostPrepass(): THREE.MeshBasicMaterial;
}

// ---------------------------------------------------------------- 缓存

const cache = new Map<string, THREE.Material>();
const shared = new WeakSet<THREE.Material>();

/** 共享材质用到的贴图（画质档改各向异性时统一改，ARCH §13.2） */
const sharedTextures = new Set<THREE.Texture>();
let anisotropy = 4;

function once<T extends THREE.Material>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit) return hit as T;
  const m = make();
  if (!m.name) m.name = `mat.${key}`;
  cache.set(key, m);
  shared.add(m);
  const map = (m as THREE.Material & { map?: THREE.Texture | null }).map;
  if (map) {
    map.anisotropy = anisotropy;
    sharedTextures.add(map);
  }
  return m;
}

/** 画质档的贴图各向异性（low 1、mid/high 4）；PostPipeline.setQuality 调用。three 上传时会再按显卡上限钳一次。 */
export function setSharedAnisotropy(n: number): void {
  const v = Math.max(1, Math.round(n));
  if (v === anisotropy) return;
  anisotropy = v;
  for (const t of sharedTextures) {
    t.anisotropy = v;
    t.needsUpdate = true;
  }
}

function colorKey(c: THREE.ColorRepresentation): string {
  return new THREE.Color(c).getHexString();
}

// ---------------------------------------------------------------- 三向投影

const TRI_VERT_DECL = /* glsl */ `#include <common>
varying vec3 vTriPos;
varying vec3 vTriNrm;`;

const TRI_VERT_BODY = /* glsl */ `#include <worldpos_vertex>
vec4 cmTriP = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  cmTriP = batchingMatrix * cmTriP;
#endif
#ifdef USE_INSTANCING
  cmTriP = instanceMatrix * cmTriP;
#endif
cmTriP = modelMatrix * cmTriP;
vTriPos = cmTriP.xyz;
vec3 cmTriN = objectNormal;
#ifdef USE_INSTANCING
  cmTriN = mat3( instanceMatrix ) * cmTriN;
#endif
vTriNrm = mat3( modelMatrix ) * cmTriN;`;

const TRI_FRAG_DECL = /* glsl */ `#include <common>
uniform vec2 uTriScale;
varying vec3 vTriPos;
varying vec3 vTriNrm;`;

// 竖直面：u 沿水平、v 沿世界 y（贴图“上”朝上）；地面：xz
const TRI_FRAG_MAP = /* glsl */ `#ifdef USE_MAP
  vec3 cmTw = pow( abs( normalize( vTriNrm ) ), vec3( 4.0 ) );
  cmTw /= max( cmTw.x + cmTw.y + cmTw.z, 1e-5 );
  vec4 cmTx = texture2D( map, vTriPos.zy / uTriScale );
  vec4 cmTy = texture2D( map, vTriPos.xz / uTriScale );
  vec4 cmTz = texture2D( map, vTriPos.xy / uTriScale );
  diffuseColor *= cmTx * cmTw.x + cmTy * cmTw.y + cmTz * cmTw.z;
#endif`;

/** 给 MeshStandardMaterial 装上世界空间三向投影（metersPerTile：一张贴图在世界里覆盖的宽、高，米）。 */
function triplanar(m: THREE.MeshStandardMaterial, metersPerTile: readonly [number, number]): THREE.MeshStandardMaterial {
  const scale = new THREE.Vector2(metersPerTile[0], metersPerTile[1]);
  m.onBeforeCompile = shader => {
    shader.uniforms['uTriScale'] = { value: scale };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', TRI_VERT_DECL)
      .replace('#include <worldpos_vertex>', TRI_VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', TRI_FRAG_DECL)
      .replace('#include <map_fragment>', TRI_FRAG_MAP);
  };
  // 所有三向投影材质共用同一段改写：固定缓存键，程序可以共享（每个材质的 uTriScale 仍各自独立）
  m.customProgramCacheKey = () => 'cm-triplanar';
  m.userData.triplanar = [metersPerTile[0], metersPerTile[1]];
  return m;
}

// ---------------------------------------------------------------- 本文件画的贴图

/** 抹灰/石灰墙的明暗斑驳（近白的细节图，乘材质颜色用）：返潮、雨痕、修补过的方块。 */
function stuccoTexture(seed: number): THREE.CanvasTexture {
  const r = rng(seed);
  return paintTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#f2f0ec';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const v = Math.round(range(r, 205, 250));
      g.fillStyle = `rgba(${v},${v - 3},${v - 8},${range(r, 0.15, 0.4)})`;
      g.beginPath();
      g.ellipse(r() * w, r() * h, range(r, 6, 40), range(r, 4, 26), r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    // 修补过的方块
    for (let i = 0; i < 3; i++) {
      g.fillStyle = `rgba(215,212,205,${range(r, 0.3, 0.55)})`;
      g.fillRect(r() * w, r() * h, range(r, 30, 90), range(r, 20, 60));
    }
    // 竖向雨痕（顶部更深）
    for (let i = 0; i < 14; i++) {
      const x = r() * w;
      const grd = g.createLinearGradient(0, 0, 0, h * range(r, 0.3, 1));
      grd.addColorStop(0, `rgba(90,85,75,${range(r, 0.08, 0.2)})`);
      grd.addColorStop(1, 'rgba(90,85,75,0)');
      g.fillStyle = grd;
      g.fillRect(x, 0, range(r, 3, 12), h);
    }
    // 细颗粒
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * 18;
      d[i] = Math.max(0, Math.min(255, (d[i] ?? 0) + n));
      d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] ?? 0) + n));
      d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] ?? 0) + n));
    }
    g.putImageData(img, 0, 0);
  }, { repeat: [1, 1] });
}

/** 水泥：灰底、骨料斑点、浇筑缝与几道裂纹。 */
function concreteTexture(seed: number): THREE.CanvasTexture {
  const r = rng(seed);
  return paintTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#8c8b87';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) {
      const v = Math.round(range(r, 110, 160));
      g.fillStyle = `rgba(${v},${v},${v - 4},${range(r, 0.12, 0.3)})`;
      g.beginPath();
      g.ellipse(r() * w, r() * h, range(r, 10, 60), range(r, 8, 40), r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 6000; i++) {
      const v = Math.round(range(r, 70, 190));
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(r() * w, r() * h, range(r, 1, 2.5), range(r, 1, 2.5));
    }
    g.strokeStyle = 'rgba(40,40,40,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, h * 0.5);
    g.lineTo(w, h * 0.5);
    g.stroke();
    g.strokeStyle = 'rgba(30,30,30,0.5)';
    g.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      let x = r() * w, y = r() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += range(r, -30, 30);
        y += range(r, 10, 40);
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }, { repeat: [1, 1] });
}

/** 木纹：竖向木板，年轮细纹、节疤、旧漆磨损。 */
function woodTexture(seed: number): THREE.CanvasTexture {
  const r = rng(seed);
  return paintTexture(512, 512, (g, w, h) => {
    const planks = 4;
    const pw = w / planks;
    for (let p = 0; p < planks; p++) {
      const k = range(r, 0.8, 1.1);
      g.fillStyle = `rgb(${Math.round(112 * k)},${Math.round(74 * k)},${Math.round(46 * k)})`;
      g.fillRect(p * pw, 0, pw, h);
      for (let i = 0; i < 40; i++) {
        const x = p * pw + r() * pw;
        g.strokeStyle = `rgba(${r() < 0.5 ? '60,38,20' : '150,105,65'},${range(r, 0.08, 0.25)})`;
        g.lineWidth = range(r, 0.6, 2.2);
        g.beginPath();
        g.moveTo(x, 0);
        g.bezierCurveTo(x + range(r, -6, 6), h * 0.33, x + range(r, -6, 6), h * 0.66, x + range(r, -4, 4), h);
        g.stroke();
      }
      if (r() < 0.7) {
        const kx = p * pw + range(r, 0.2, 0.8) * pw, ky = r() * h;
        g.fillStyle = 'rgba(50,30,15,0.55)';
        g.beginPath();
        g.ellipse(kx, ky, range(r, 3, 7), range(r, 6, 12), 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(25,15,8,0.6)';
      g.fillRect(p * pw, 0, 2, h);
    }
  }, { repeat: [1, 1] });
}

/** 1990 年代通道里的白绿瓷砖：白底，每四行一排绿砖（GDD §4.5）。 */
function greenWhiteTiles(seed: number): THREE.CanvasTexture {
  const r = rng(seed);
  return paintTexture(512, 512, (g, w, h) => {
    const n = 8;
    const s = w / n;
    const m = Math.max(2, s * 0.06);
    g.fillStyle = '#6f7a70';
    g.fillRect(0, 0, w, h);
    for (let row = 0; row < n; row++) {
      const green = row % 4 === 3;
      for (let c = 0; c < n; c++) {
        const k = range(r, 0.86, 1.0);
        const base = green ? [70, 140, 108] : [226, 230, 220];
        g.fillStyle = `rgb(${Math.round(base[0]! * k)},${Math.round(base[1]! * k)},${Math.round(base[2]! * k)})`;
        g.fillRect(c * s + m / 2, row * s + m / 2, s - m, s - m);
        if (r() < 0.1) {
          g.fillStyle = 'rgba(120,100,60,0.18)';
          g.fillRect(c * s + m / 2, row * s + m / 2, s - m, s - m);
        }
      }
    }
  }, { repeat: [1, 1] });
}

function withTemp<T extends THREE.Material>(m: T, tempC: number): T {
  m.userData.tempC = tempC;
  return m;
}

function std(o: THREE.MeshStandardMaterialParameters, tempC: number): THREE.MeshStandardMaterial {
  return withTemp(new THREE.MeshStandardMaterial(o), tempC);
}

// 夜里的湿地面比墙凉一点，红外下地面与墙有一点层次（GDD 只规定“环境 18”，这里只差 2℃）
const WET_GROUND_C = 16;
// 金属发射率低，热像仪里看起来偏凉
const METAL_C = 15;

export const MATERIALS: MaterialLibrary = {
  brick: () => once('brick', () => triplanar(std({ map: PAINT.bricks(), roughness: 0.92, metalness: 0 }, TEMP_C.ambient), [2.0, 1.0])),
  plaster: () => once('plaster', () => triplanar(std({ map: stuccoTexture(21), color: '#9c968a', roughness: 0.95, metalness: 0 }, TEMP_C.ambient), [3.0, 3.0])),
  lime: () => once('lime', () => triplanar(std({ map: stuccoTexture(23), color: PALETTE.LIME, roughness: 0.9, metalness: 0 }, TEMP_C.ambient), [2.5, 2.5])),
  // 墙裙按网格 UV：v 从下到上 0→1，分界在 45% 高（一层 2.8m 的墙约 1.26m）
  dado: () => once('dado', () => std({ map: PAINT.dado(), roughness: 0.55, metalness: 0 }, TEMP_C.ambient)),
  tileWhite: () => once('tileWhite', () => triplanar(std({ map: PAINT.tiles(), roughness: 0.25, metalness: 0 }, TEMP_C.ambient), [1.6, 1.6])),
  tileGreenWhite: () => once('tileGreenWhite', () => triplanar(std({ map: greenWhiteTiles(31), roughness: 0.25, metalness: 0 }, TEMP_C.ambient), [1.6, 1.6])),
  concrete: () => once('concrete', () => triplanar(std({ map: concreteTexture(41), roughness: 0.95, metalness: 0 }, TEMP_C.ambient), [2.5, 2.5])),
  asphaltWet: () => once('asphaltWet', () => triplanar(std({ map: PAINT.wetGround(), roughness: 0.34, metalness: 0.05 }, WET_GROUND_C), [4.0, 4.0])),
  wood: () => once('wood', () => std({ map: woodTexture(51), roughness: 0.78, metalness: 0 }, TEMP_C.ambient)),
  metal: () => once('metal', () => std({ color: '#6b6e72', roughness: 0.42, metalness: 0.65 }, METAL_C)),
  tin: () => once('tin', () => std({ map: PAINT.rust(), roughness: 0.55, metalness: 0.5 }, METAL_C)),
  enamelYellow: () => once('enamelYellow', () => std({ color: '#d6ad38', roughness: 0.32, metalness: 0.08 }, TEMP_C.ambient)),
  enamelRed: () => once('enamelRed', () => std({ color: '#b3302a', roughness: 0.32, metalness: 0.08 }, TEMP_C.ambient)),
  porcelain: () => once('porcelain', () => std({ color: '#ecebe4', roughness: 0.22, metalness: 0 }, TEMP_C.ambient)),
  paper: () => once('paper', () => std({ color: PALETTE.PAPER, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }, TEMP_C.paper)),
  cloth: color => once(`cloth:${colorKey(color)}`, () => std({ color, roughness: 0.9, metalness: 0 }, TEMP_C.ambient)),
  glass: () => once('glass', () => {
    const m = std({ color: '#a9bcc0', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false }, 16);
    m.userData.noOcclude = true;
    return m;
  }),
  emissive: (color, intensity = 1) => once(`emissive:${colorKey(color)}:${intensity}`, () => {
    const c = new THREE.Color(color);
    // 自发光 ×3.5（M1c look-dev；原 ×2.2）：远超 Bloom 阈值（0.8），色调映射后灯芯发白、周围一圈灯色光晕；
    // 底色压暗，免得受光面把灯罩照成灰白。只要“亮着但不刺眼”的（招牌底板、指示灯）传 intensity 0.3–0.6。
    return std({ color: c.clone().multiplyScalar(0.15), emissive: c, emissiveIntensity: 3.5 * intensity, roughness: 0.6, metalness: 0 }, TEMP_C.lamp);
  }),
  ghost: color => once(`ghost:${color === undefined ? 'default' : colorKey(color)}`, () => withTemp(createGhostMaterial(color), TEMP_C.yin)),
  // 回放人影是“过去的影像”，不是在场的东西：红外下与环境同温，看不出来
  replay: () => once('replay', () => withTemp(createReplayMaterial(), TEMP_C.ambient)),
  paperGlow: () => once('paperGlow', () => withTemp(createPaperGlowMaterial(), TEMP_C.paper)),
  crtScreen: () => once('crtScreen', () => createCrtScreenMaterial({ powered: false })),
  hitProxy: () => once('hitProxy', () => new THREE.MeshBasicMaterial({ visible: false })),
  ghostPrepass: () => once('ghostPrepass', () => ghostPrepassMaterial()),
};

/** 是否是 MATERIALS 缓存的共享实例（Disposer 与区域卸载时跳过它们；M1a 补写）。 */
export function isSharedMaterial(m: THREE.Material): boolean {
  return shared.has(m);
}

/** 已创建的共享材质数（自测用）。 */
export function sharedMaterialCount(): number {
  return cache.size;
}
