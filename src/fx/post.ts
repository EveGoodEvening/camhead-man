// owner: WP3
// 后期链（ARCH §8.1）：RenderPass → UnrealBloomPass → CameraFxPass（取代 OutputPass；色调映射 + sRGB 编码 + 全部显示空间效果）。
// 共 3 个 pass（ARCH §13.2）。红外时 RenderPass 前后由 IrRenderer 换/还材质，并关 Bloom；红外/常规在 CameraFxPass 里是 uniform 分支。
//
// 时间：
// - 动画时间（颗粒、VHS、频闪、魂影微光）只按 render(dt) 的 dt 累加 = 游戏时间，锁步截图可复现（ARCH §1.4、§3.2）。
// - 过渡时间（push/pop 的淡入淡出、白闪衰减）是纯视觉：dt > 0 时用 dt；dt === 0（锁步下 rAF 只调 render(0)、renderNow()）时
//   改用两次 render 之间的真实时间（上限 0.1s），否则锁步下白闪永远不退、叠加层永远到不了目标值。

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { QualityLevel } from '../core/types';
import type { Settings } from '../game/settings';
import type { PostPresetId } from './presets';
import { FX_DEFAULTS, POST_PRESETS } from './presets';
import { IrRenderer } from './ir';
import { createCameraFxPass, updateCameraFxUniforms } from './cameraFxShader';
import { FX_TIME } from './ghostMaterials';
import { setSharedAnisotropy } from './materials';
import { QUALITY } from '../data/render';
import { TIMING } from '../data/time';
import { devWarn } from '../core/log';

export interface FxParams {
  grain: number; scanline: number; chroma: number; vignette: number;
  bloom: { strength: number; radius: number; threshold: number };
  /** 0/1：暗房红灯 */
  monoRed: number;
  /** 0..1：回放跟踪条纹、抖动、色溢 */
  vhs: number;
  /** 固定机位/CH1 0.08 */
  barrel: number;
  /** 0/1：红外色带 */
  ir: number;
  /** 回放棕绿、卯时黎明粉、鬼市偏绿 */
  tint: readonly [number, number, number]; tintAmt: number;
  /** 0/1：4:3 黑边 */
  frame43: number;
  /** 0..1 快门白闪（reduceFlash 时短闪不闪、长的淡入白改为柔和淡入） */
  flash: number;
  /** 0..1 淡黑 */
  fade: number;
  /** 灯管频闪幅度（reduceFlash 时为 0） */
  flicker: number;
  /** CameraFxPass 的 uExposure（M1c look-dev 后冻结基准值，ARCH §15.3） */
  exposure: number;
}

type ScalarKey = Exclude<keyof FxParams, 'bloom' | 'tint'>;
const SCALAR_KEYS: readonly ScalarKey[] = [
  'grain', 'scanline', 'chroma', 'vignette', 'monoRed', 'vhs', 'barrel', 'ir', 'tintAmt', 'frame43', 'flash', 'fade', 'flicker', 'exposure',
];

/** 可写的完整参数（FxStack 内部与 resolve() 的输出）。 */
export type MutableFxParams = { -readonly [K in keyof FxParams]: FxParams[K] };

export function cloneFx(p: Readonly<FxParams>): MutableFxParams {
  return { ...p, bloom: { ...p.bloom }, tint: [p.tint[0], p.tint[1], p.tint[2]] };
}

/** 预设（或预设 + 覆盖）展开成完整参数：FX_DEFAULTS ← POST_PRESETS[preset] ← overrides。 */
export function resolvePreset(preset: PostPresetId, overrides?: Partial<FxParams>): MutableFxParams {
  const out = cloneFx(FX_DEFAULTS);
  assignFx(out, POST_PRESETS[preset]);
  if (overrides) assignFx(out, overrides);
  return out;
}

function assignFx(out: MutableFxParams, p: Partial<FxParams>): void {
  for (const k of SCALAR_KEYS) {
    const v = p[k];
    if (v !== undefined) out[k] = v;
  }
  if (p.bloom) out.bloom = { ...p.bloom };
  if (p.tint) out.tint = [p.tint[0], p.tint[1], p.tint[2]];
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;


interface FxLayer {
  key: string;
  p: Partial<FxParams>;
  /** 当前权重 0..1 */
  w: number;
  /** 目标权重：1 = 淡入/已在；0 = 正在 pop */
  target: 0 | 1;
  /** 每秒权重变化量（fadeSec = 0 时为 Infinity，立即到位） */
  rate: number;
}

/**
 * 叠加栈（纯逻辑，便于在 node 里测试）。叠加规则（ARCH §8.1）：base 之上按 push 顺序覆盖；标量取最后一个定义者（按权重插值）；
 * chroma 在 'vf' 层是乘法（×p.chroma）。重复 push 同一个 key：原位置更新参数并淡回 1。
 */
export class FxStack {
  private base: MutableFxParams = cloneFx(FX_DEFAULTS);
  private readonly layers: FxLayer[] = [];

  setBase(preset: PostPresetId, overrides?: Partial<FxParams>): void {
    this.base = resolvePreset(preset, overrides);
  }
  /** 直接给完整的基础参数（测试用） */
  setBaseParams(p: Readonly<FxParams>): void {
    this.base = cloneFx(p);
  }
  push(key: string, p: Partial<FxParams>, fadeSec = 0): void {
    const rate = fadeSec > 0 ? 1 / fadeSec : Number.POSITIVE_INFINITY;
    const found = this.layers.find(l => l.key === key);
    if (found) {
      found.p = p;
      found.target = 1;
      found.rate = rate;
      if (!Number.isFinite(rate)) found.w = 1;
      return;
    }
    this.layers.push({ key, p, w: Number.isFinite(rate) ? 0 : 1, target: 1, rate });
  }
  pop(key: string, fadeSec = 0): void {
    const i = this.layers.findIndex(l => l.key === key);
    if (i < 0) return;
    const l = this.layers[i]!;
    if (fadeSec <= 0) {
      this.layers.splice(i, 1);
      return;
    }
    l.target = 0;
    l.rate = 1 / fadeSec;
  }
  has(key: string): boolean {
    return this.layers.some(l => l.key === key && l.target === 1);
  }
  keys(): string[] {
    return this.layers.map(l => l.key);
  }
  /** 推进淡入淡出；淡出完成的层移除。 */
  advance(sec: number): void {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const l = this.layers[i]!;
      if (l.w !== l.target) {
        const step = Number.isFinite(l.rate) ? l.rate * Math.max(0, sec) : 1;
        l.w = l.target > l.w ? Math.min(1, l.w + step) : Math.max(0, l.w - step);
      }
      if (l.target === 0 && l.w <= 0) this.layers.splice(i, 1);
    }
  }
  resolve(out: MutableFxParams = cloneFx(this.base)): MutableFxParams {
    if (out !== this.base) {
      assignFx(out, this.base);
    }
    for (const l of this.layers) {
      const w = l.w;
      if (w <= 0) continue;
      for (const k of SCALAR_KEYS) {
        const v = l.p[k];
        if (v === undefined) continue;
        if (k === 'chroma' && l.key === 'vf') out.chroma *= lerp(1, v, w);
        else out[k] = lerp(out[k], v, w);
      }
      const b = l.p.bloom;
      if (b) {
        out.bloom = {
          strength: lerp(out.bloom.strength, b.strength, w),
          radius: lerp(out.bloom.radius, b.radius, w),
          threshold: lerp(out.bloom.threshold, b.threshold, w),
        };
      }
      const t = l.p.tint;
      if (t) out.tint = [lerp(out.tint[0], t[0], w), lerp(out.tint[1], t[1], w), lerp(out.tint[2], t[2], w)];
    }
    return out;
  }
}

/** RenderPass + 红外替换：ir 开启时在渲染主场景前后调用 IrRenderer.begin/end（ARCH §6.8.2）；顺便统计主场景 draw call。 */
class SceneRenderPass extends RenderPass {
  irActive = false;
  readonly stats = { calls: 0, triangles: 0 };
  private readonly ir: IrRenderer;

  constructor(scene: THREE.Scene, camera: THREE.Camera, ir: IrRenderer) {
    super(scene, camera);
    this.ir = ir;
  }

  override render(
    renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean,
  ): void {
    const calls0 = renderer.info.render.calls;
    const tris0 = renderer.info.render.triangles;
    if (this.irActive) {
      this.ir.begin([this.scene]);
      try {
        super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      } finally {
        this.ir.end();
      }
    } else {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    }
    this.stats.calls = renderer.info.render.calls - calls0;
    this.stats.triangles = renderer.info.render.triangles - tris0;
  }
}

export class PostPipeline {
  protected readonly renderer: THREE.WebGLRenderer;
  protected readonly scene: THREE.Scene;
  protected camera: THREE.Camera;

  readonly composer: EffectComposer;
  /** 红外替换材质（mat.ir_override）：params.ir > 0.5 时 PostPipeline 在 RenderPass 前后调用 begin/end（M1a 补写） */
  readonly ir: IrRenderer;

  private readonly stack = new FxStack();
  private readonly renderPass: SceneRenderPass;
  private readonly bloom: UnrealBloomPass;
  private readonly fx: ShaderPass;
  private readonly params: MutableFxParams = cloneFx(FX_DEFAULTS);
  private quality: QualityLevel = 'mid';
  private userGrain = 1;
  private reduceFlash = false;
  private cssW = 1;
  private cssH = 1;
  private animTime = 0;
  private lastRealMs: number | null = null;
  /** 快门白闪包络：已过时间 / 总时长（秒）；dur = 0 表示没有白闪 */
  private flashT = 0;
  private flashDur = 0;
  private flashSoft = false;
  private flashPeak = 1;
  /** M4 第 2 轮（WP3 内部）：回放暂停着——VHS 跟踪噪声条停在画面底部（ReplaySystem 每帧写） */
  vhsPaused = false;

  /** WP1 的 Game 构造（M1a 补写）：主场景、当前主相机。 */
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.ir = new IrRenderer();

    const size = renderer.getSize(new THREE.Vector2());
    this.cssW = Math.max(1, size.x);
    this.cssH = Math.max(1, size.y);
    // 默认 RT 是 HalfFloat（线性 HDR，ARCH §16 #18）；不开 MSAA，颗粒与扫描线会掩盖锯齿
    this.composer = new EffectComposer(renderer);
    this.composer.setSize(this.cssW, this.cssH);
    this.renderPass = new SceneRenderPass(scene, camera, this.ir);
    const b = FX_DEFAULTS.bloom;
    // UnrealBloomPass 内部第一级就是 resolution/2，传完整尺寸即为半分辨率 Bloom（ARCH §16 #17）
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.cssW, this.cssH), b.strength, b.radius, b.threshold);
    this.fx = createCameraFxPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.fx);
  }

  /** 主场景这一帧的 draw call 与三角面（RenderPass 前后取差，给 perf() 的 callsMain 用；WP3 补充，非冻结签名）。 */
  get sceneStats(): { readonly calls: number; readonly triangles: number } {
    return this.renderPass.stats;
  }
  /** 当前合成后的参数（调试/自测只读）。 */
  get current(): Readonly<FxParams> {
    return this.params;
  }
  /** 当前叠加层的 key（按 push 顺序；调试/自测用）。 */
  layers(): string[] {
    return this.stack.keys();
  }

  setCamera(cam: THREE.Camera): void {
    this.camera = cam;
    this.renderPass.camera = cam;
  }
  setSize(w: number, h: number, pixelRatio: number): void {
    this.cssW = Math.max(1, w);
    this.cssH = Math.max(1, h);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(this.cssW, this.cssH);   // 同时调用每个 pass 的 setSize（含 Bloom）
  }
  /** 区域基础预设 */
  setBase(preset: PostPresetId, overrides?: Partial<FxParams>): void {
    this.stack.setBase(preset, overrides);
  }
  /** 叠加层：vf / replay / ir / ch1 / darkroom_red / market … */
  push(key: string, p: Partial<FxParams>, fadeSec?: number): void {
    this.stack.push(key, p, fadeSec ?? 0);
  }
  pop(key: string, fadeSec?: number): void {
    this.stack.pop(key, fadeSec ?? 0);
  }
  /**
   * 白闪，默认 80ms（快门）：前 30% 满白，再线性退掉。过场的 {fade:'white', dur} 也走这里（ms = dur）。
   * reduceFlash（GDD §10.4“关掉快门白闪、镁光灯”，M1d）：短闪（< 0.3s：快门、镁光灯）直接不闪；长的“淡入白”过场改为正弦式柔和淡入淡出（仍到全白）。
   */
  flash(ms = 80): void {
    const sec = Math.max(0.016, ms / 1000);
    if (this.reduceFlash && sec < TIMING.shortFlashSec) return;
    this.flashSoft = this.reduceFlash;
    this.flashDur = sec;
    this.flashPeak = 1;
    this.flashT = 0;
  }
  /** composer.render(dt)，显式传 dt */
  render(dt: number): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const real = this.lastRealMs === null ? 0 : Math.min(0.1, Math.max(0, (now - this.lastRealMs) / 1000));
    this.lastRealMs = now;
    const tdt = dt > 0 ? dt : real;
    this.stack.advance(tdt);
    // 白闪按“本帧开始时”的进度取值、画完再推进（M1c）：否则帧时 ≥ 80ms（低帧率、锁步 advance 后的第一帧）时
    // 第一帧之前就已退完，玩家根本看不到快门白闪；这样 flash() 之后的第一帧总是满白。
    const flashNow = this.flashLevel();
    if (this.flashDur > 0) {
      this.flashT += tdt;
      if (this.flashT >= this.flashDur) this.flashDur = 0;
    }
    this.animTime += Math.max(0, dt);
    FX_TIME.value = this.animTime;

    const p = this.stack.resolve(this.params);
    p.grain *= this.userGrain;
    p.chroma *= this.userGrain;
    if (this.reduceFlash) p.flicker = 0;
    p.flash = Math.max(p.flash, flashNow);

    const irOn = p.ir >= 0.5;
    this.renderPass.irActive = irOn;
    this.bloom.enabled = !irOn && this.quality !== 'low' && p.bloom.strength > 0.001;
    this.bloom.strength = p.bloom.strength;
    this.bloom.radius = p.bloom.radius;
    this.bloom.threshold = p.bloom.threshold;

    const rt = this.composer.readBuffer;
    updateCameraFxUniforms(this.fx, p, { time: this.animTime, w: rt.width, h: rt.height, cssW: this.cssW, cssH: this.cssH, vhsPaused: this.vhsPaused });
    this.composer.render(dt);
  }
  /** 画质：low 关 Bloom（M1a 补写；RenderPipeline.setQuality 调用） */
  setQuality(q: QualityLevel): void {
    this.quality = q;
    // 共享材质贴图的各向异性也跟画质档走（ARCH §13.2：low 1、mid/high 4）
    setSharedAnisotropy(QUALITY[q].anisotropy);
  }
  /** 用户设置：grain 乘到 grain 与 chroma 上；reduceFlash 时 flash 改为柔和淡入、flicker 恒为 0（M1a 补写；Game 在 'settings' 事件后调用） */
  applySettings(s: Pick<Settings, 'grain' | 'reduceFlash'>): void {
    this.userGrain = Number.isFinite(s.grain) ? Math.max(0, s.grain) : 1;
    this.reduceFlash = s.reduceFlash === true;
  }

  /**
   * 预热用（fx/warmup.ts）：把 Bloom 往 target、CameraFxPass 的常规与红外两个分支往**屏幕**各渲一次，确保它们实际用的程序已编译
   * （M1d：CameraFxPass 平时画到屏幕，程序的 outputColorSpace 按渲染目标区分，往 RT 里画编出的是用不上的变体；进区域时屏幕在黑幕后，画一次无妨）。
   * 不改任何参数（渲完还原 uIr 与 renderToScreen）。WP3 内部。
   */
  warm(target: THREE.WebGLRenderTarget): void {
    const u = this.fx.uniforms as Record<string, THREE.IUniform<unknown>>;
    const irU = u['uIr'];
    if (!irU) {
      devWarn('PostPipeline.warm: CameraFxPass 缺 uIr');
      return;
    }
    const prevIr = irU.value;
    const prevScreen = this.fx.renderToScreen;
    this.fx.renderToScreen = true;
    try {
      if (this.quality !== 'low') {
        // Bloom 只读 readBuffer（高通）再把结果混回它，中间都在自己的 RT 里：target 同时当读写不构成反馈环
        const prevBloomScreen = this.bloom.renderToScreen;
        this.bloom.renderToScreen = false;
        this.bloom.render(this.renderer, target, target, 0, false);
        this.bloom.renderToScreen = prevBloomScreen;
      }
      // CameraFxPass 读 composer 的 readBuffer、写屏幕（renderToScreen），读写不是同一张（否则 GL feedback loop 警告）
      for (const v of [0, 1]) {
        irU.value = v;
        this.fx.render(this.renderer, target, this.composer.readBuffer, 0, false);
      }
    } finally {
      irU.value = prevIr;
      this.fx.renderToScreen = prevScreen;
    }
  }

  private flashLevel(): number {
    if (this.flashDur <= 0) return 0;
    const x = Math.min(1, this.flashT / this.flashDur);
    if (this.flashSoft) return this.flashPeak * Math.sin(Math.PI * x);
    // 满白保持前 30%，再线性退掉
    return x < 0.3 ? 1 : 1 - (x - 0.3) / 0.7;
  }
}
