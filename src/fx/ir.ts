// owner: WP3
// 红外（ARCH §6.8.2）：mat.ir_override 的实现——渲染前把可见 Mesh/InstancedMesh 的材质暂换为 irMaterial(tempC)，渲染后立即还原。
// irMaterial 输出线性灰度 t/45（0–45℃ → 0–1），色带映射在 CameraFxPass 的红外分支里做（ARCH §8.1）。
//
// 规则（M1b 实现细节）：
// - userData.irHide 的对象、所有 Line/Points/Sprite 在红外下隐藏（雨、湿地光带、脚印贴花、精灵光晕）。
// - material.visible === false 的网格（MATERIALS.hitProxy 交互拾取代理）保持原样：换成可见材质会把拾取盒画出来。
// - 几乎全透明的网格（transparent 且 opacity < 0.05，如淡出到 0 的身体）在红外下隐藏。
// - 透明、无贴图、opacity < 0.6 的普通材质（玻璃）在红外下隐藏：否则会变成一整块不透明的 18℃ 板子挡住后面的东西。
//   ShaderMaterial（魂影、回放人影）不在此列：它们在红外下是一个实心的冷/常温轮廓，这正是 GDD“只看冷热轮廓”的效果。
// - InstancedMesh.instanceColor 暂存并置空（否则 USE_COLOR 会把灰度染色，ARCH §16 #33）。
// - 透明贴花（transparent && map && 无 alphaTest）继承 alpha 轮廓，alphaTest = 0.5；贴图只用 alpha（onBeforeCompile 改写 map_fragment）。
// - 掠射面至多压暗 20%（掠射角发射率下降）、朝天的面再压 6%（向夜空散热；M1c look-dev），同温的墙地箱子在红外下仍有转折；
//   正对镜头的竖直面系数为 1（像素与 tempC 的色带一致）。
// - 所有 irMaterial 共用一个 customProgramCacheKey，变体只由 three 自己的参数决定（实例化、贴图、side、alphaTest），由 fx/warmup.ts 预热。

import * as THREE from 'three';
import { TEMP_C } from '../data/render';
import { IR_RANGE_C } from '../data/palette';
import { devAssert } from '../core/log';

type AnyMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;


function isRenderableNonMesh(o: THREE.Object3D): boolean {
  const r = o as THREE.Object3D & { isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
  return r.isLine === true || r.isPoints === true || r.isSprite === true;
}

function isMesh(o: THREE.Object3D): o is AnyMesh {
  return (o as THREE.Object3D & { isMesh?: boolean }).isMesh === true;
}

function isInstanced(o: THREE.Object3D): o is THREE.InstancedMesh {
  return (o as THREE.Object3D & { isInstancedMesh?: boolean }).isInstancedMesh === true;
}

function isShaderMat(m: THREE.Material): boolean {
  return (m as THREE.Material & { isShaderMaterial?: boolean }).isShaderMaterial === true;
}

function texOf(m: THREE.Material, key: 'map' | 'alphaMap'): THREE.Texture | null {
  const v = (m as THREE.Material & { map?: THREE.Texture | null; alphaMap?: THREE.Texture | null })[key];
  return v ?? null;
}

/** 这个材质在红外下应该让整个网格消失吗（见文件头的规则）。 */
function hiddenInIr(m: THREE.Material): boolean {
  if (!m.transparent) return false;
  if (m.opacity < 0.05) return true;
  if (isShaderMat(m)) return false;
  return m.opacity < 0.6 && !texOf(m, 'map') && !texOf(m, 'alphaMap');
}

export class IrRenderer {
  // 本轮被换掉材质的网格、原材质、原 instanceColor（平行数组：每帧不为每个网格分配对象）
  private readonly sMesh: AnyMesh[] = [];
  private readonly sMat: (THREE.Material | THREE.Material[])[] = [];
  private readonly sColor: (THREE.InstancedBufferAttribute | null | undefined)[] = [];
  private readonly hidden: THREE.Object3D[] = [];
  private active = false;

  /** 当前是否在 begin/end 之间（调试用） */
  get isActive(): boolean {
    return this.active;
  }

  /** 渲染前：遍历可见 Mesh/InstancedMesh，把 material 暂换为 irMaterial(tempC)；暂存并置空 instanceColor；irHide 的对象与 Line/Points 隐藏 */
  begin(roots: THREE.Object3D[]): void {
    devAssert(!this.active, 'IrRenderer.begin: 上一次 begin 还没有 end');
    if (this.active) this.end();
    this.active = true;
    for (const r of roots) this.walk(r);
  }

  /** 渲染后立即还原（玩法代码永远看不到被替换的材质） */
  end(): void {
    for (let i = this.sMesh.length - 1; i >= 0; i--) {
      const mesh = this.sMesh[i]!;
      mesh.material = this.sMat[i]!;
      const ic = this.sColor[i];
      if (ic !== undefined && isInstanced(mesh)) mesh.instanceColor = ic;
    }
    for (let i = this.hidden.length - 1; i >= 0; i--) this.hidden[i]!.visible = true;
    this.sMesh.length = 0;
    this.sMat.length = 0;
    this.sColor.length = 0;
    this.hidden.length = 0;
    this.active = false;
  }

  /** obj.userData.tempC ?? material.userData.tempC ?? 18（M1a 已实现） */
  static tempOf(obj: THREE.Object3D): number {
    const own = obj.userData.tempC as unknown;
    if (typeof own === 'number') return own;
    const mat = (obj as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }).material;
    const first = Array.isArray(mat) ? mat[0] : mat;
    const fromMat = first?.userData.tempC as unknown;
    return typeof fromMat === 'number' ? fromMat : TEMP_C.ambient;
  }

  private hide(o: THREE.Object3D): void {
    o.visible = false;
    this.hidden.push(o);
  }

  private walk(o: THREE.Object3D): void {
    if (!o.visible) return;
    if (o.userData.irHide === true || isRenderableNonMesh(o)) {
      this.hide(o);
      return;
    }
    if (isMesh(o)) this.swap(o);
    for (const c of o.children) this.walk(c);
  }

  private swap(mesh: AnyMesh): void {
    const src = mesh.material;
    const own = mesh.userData.tempC as unknown;
    let repl: THREE.Material | THREE.Material[];
    if (!Array.isArray(src)) {
      // 常见情况：单材质（每帧每个网格都走这里，避免分配）
      if (!src.visible) return;                       // 拾取代理：原样保留（它本来就不绘制）
      if (hiddenInIr(src)) {
        this.hide(mesh);                              // 全透明/玻璃：隐藏而不是换材质
        return;
      }
      repl = irMaterialFor(own, src);
    } else {
      if (src.every(m => !m.visible)) return;
      if (src.every(m => !m.visible || hiddenInIr(m))) {
        this.hide(mesh);
        return;
      }
      // 多材质：每个网格一个温度，按各自的 side/贴图分别换
      repl = src.map(m => (m.visible ? irMaterialFor(own, m) : m));
    }
    this.sMesh.push(mesh);
    this.sMat.push(src);
    // undefined = 不是带 instanceColor 的实例网格（还原时不动）
    if (isInstanced(mesh) && mesh.instanceColor) {
      this.sColor.push(mesh.instanceColor);
      mesh.instanceColor = null;
    } else {
      this.sColor.push(undefined);
    }
    mesh.material = repl;
  }
}

/** obj.userData.tempC 优先于材质 userData.tempC，缺省 18。 */
function irMaterialFor(own: unknown, m: THREE.Material): THREE.MeshBasicMaterial {
  const matTemp = m.userData.tempC as unknown;
  const t = typeof own === 'number' ? own : typeof matTemp === 'number' ? matTemp : TEMP_C.ambient;
  return irMaterial(t, m);
}

// ---------------------------------------------------------------- irMaterial 缓存

const irCache = new Map<string, THREE.MeshBasicMaterial>();
/** 贴图 → 引用它的缓存键（贴图 dispose 时一并释放对应的红外材质，避免区域卸载后缓存里留着已释放的贴图） */
const texKeys = new Map<THREE.Texture, Set<string>>();

/**
 * 贴图只取 alpha：map 用于树叶卡片、纸人轮廓、文字贴花的裁切，颜色必须保持纯灰度 t/45。
 * 另外按视线与法线的夹角把掠射面压暗至多 20%（热像里真实存在的“掠射角发射率下降”），朝天的面再压 6%：同温的墙、地、箱子在红外下
 * 仍看得出转折，否则一整片 18℃ 完全是平的。正对镜头的面系数为 1，所以正面采样的像素与 tempC 的色带颜色一致。
 */
const IR_VERT_DECL = /* glsl */ `#include <common>
varying float vIrNdv;
varying float vIrUp;`;
const IR_VERT_NDV = /* glsl */ `#include <project_vertex>
vec3 irN = normal;
#ifdef USE_INSTANCING
  irN = mat3( instanceMatrix ) * irN;
#endif
vIrUp = normalize( mat3( modelMatrix ) * irN ).y;
irN = normalize( normalMatrix * irN );
vIrNdv = abs( dot( irN, normalize( -mvPosition.xyz ) ) );`;
const IR_FRAG_DECL = /* glsl */ `#include <common>
varying float vIrNdv;
varying float vIrUp;`;
// M1c look-dev：掠射面压暗 12% → 20%，朝天的面再凉 6%（夜里向冷天空辐射散热：地面、台阶、屋顶比墙低一两度），
// 红外画面里同温的墙、地、台阶、门框分得开；正对镜头的竖直面系数仍为 1（像素与 tempC 的色带一致）。
const ALPHA_ONLY_MAP = /* glsl */ `
#ifdef USE_MAP
  diffuseColor.a *= texture2D( map, vMapUv ).a;
#endif
diffuseColor.rgb *= ( 0.8 + 0.2 * sqrt( clamp( vIrNdv, 0.0, 1.0 ) ) ) * ( 1.0 - 0.06 * clamp( vIrUp, 0.0, 1.0 ) );
`;

function irOnBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', IR_VERT_DECL)
    .replace('#include <project_vertex>', IR_VERT_NDV);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', IR_FRAG_DECL)
    .replace('#include <map_fragment>', ALPHA_ONLY_MAP);
}

/** 温度 → 线性灰度（ARCH §6.8.2：t/45；超出 0–45℃ 在色带两端饱和）。 */
export function irGray(tempC: number): number {
  const [lo, hi] = IR_RANGE_C;
  return Math.max(0, (tempC - lo) / (hi - lo));
}

/** 0.5℃ 量化（缓存键与颜色都用量化后的值，所以读数 36.4 与 36.5 的物体颜色一致）。 */
export function quantizeTemp(tempC: number): number {
  return Math.round(tempC * 2) / 2;
}

function onTextureDispose(this: THREE.Texture): void {
  const keys = texKeys.get(this);
  if (!keys) return;
  for (const k of keys) {
    irCache.get(k)?.dispose();
    irCache.delete(k);
  }
  texKeys.delete(this);
  this.removeEventListener('dispose', onTextureDispose);
}

/**
 * 红外替换材质：按 0.5℃ 量化缓存；MeshBasicMaterial（支持实例化，fog:false），颜色为线性灰度 t/45；
 * 继承原材质的 side、alphaTest 与 map（只用于 alpha 裁切）；透明贴花没有 alphaTest 时设 0.5。WP3 内部。
 */
export function irMaterial(tempC: number, src: THREE.Material): THREE.MeshBasicMaterial {
  const t = quantizeTemp(tempC);
  const map = texOf(src, 'map');
  const alphaMap = texOf(src, 'alphaMap');
  // 快路径：按源材质记住结果（每帧每个网格都会调用，免得每次拼缓存键）；源材质的贴图/透明/side 变了就重建
  let fast = bySource.get(src);
  if (!fast || fast.map !== map || fast.alphaMap !== alphaMap || fast.alphaTest !== src.alphaTest || fast.transparent !== src.transparent || fast.side !== src.side) {
    fast = { map, alphaMap, alphaTest: src.alphaTest, transparent: src.transparent, side: src.side, byTemp: new Map() };
    bySource.set(src, fast);
  }
  const quick = fast.byTemp.get(t);
  if (quick) return quick;
  const made = irMaterialSlow(t, src, map, alphaMap);
  fast.byTemp.set(t, made);
  return made;
}

interface SourceEntry {
  map: THREE.Texture | null; alphaMap: THREE.Texture | null; alphaTest: number; transparent: boolean; side: THREE.Side;
  byTemp: Map<number, THREE.MeshBasicMaterial>;
}
const bySource = new WeakMap<THREE.Material, SourceEntry>();

function irMaterialSlow(t: number, src: THREE.Material, map: THREE.Texture | null, alphaMap: THREE.Texture | null): THREE.MeshBasicMaterial {
  let alphaTest = src.alphaTest;
  if (alphaTest <= 0 && src.transparent && (map || alphaMap)) alphaTest = 0.5;
  const useMap = alphaTest > 0 ? map : null;
  const useAlphaMap = alphaTest > 0 ? alphaMap : null;
  const key = `${t}|${src.side}|${useMap?.uuid ?? '-'}|${useAlphaMap?.uuid ?? '-'}|${alphaTest}`;
  const hit = irCache.get(key);
  if (hit) return hit;

  const g = irGray(t);
  const m = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(g, g, g, THREE.LinearSRGBColorSpace),
    side: src.side,
    fog: false,
    alphaTest,
    map: useMap,
    alphaMap: useAlphaMap,
    toneMapped: false,
  });
  m.name = `ir:${t}`;
  m.userData.tempC = t;
  m.userData.irOverride = true;
  m.onBeforeCompile = irOnBeforeCompile;
  // 所有红外材质共用同一套着色器改写：固定缓存键，避免 three 用函数源码当键
  m.customProgramCacheKey = () => 'cm-ir-alpha-map';
  irCache.set(key, m);
  for (const tex of [useMap, useAlphaMap]) {
    if (!tex) continue;
    let set = texKeys.get(tex);
    if (!set) {
      set = new Set();
      texKeys.set(tex, set);
      tex.addEventListener('dispose', onTextureDispose);
    }
    set.add(key);
  }
  return m;
}

/** 缓存中的红外材质数（自测与资源统计用）。 */
export function irMaterialCount(): number {
  return irCache.size;
}
