// owner: WP1
// 渲染器与渲染管线（ARCH §4.7.1、§4.7.2、§13.1、§13.2）。
// 本模块在运行时只依赖 three、core/log 与 data/render（纯常量）：main.ts 静态导入它取 NoWebGL2Error（ARCH §3.1）。

import * as THREE from 'three';
import type { QualityLevel } from './types';
import type { CameraRig } from './cameras';
import type { PostPipeline } from '../fx/post';
import { devAssert } from './log';
import { DYN_RES, QUALITY } from '../data/render';

/**
 * createRenderer 拿不到 WebGL2 上下文时抛出（r186 只支持 WebGL2）；main.ts 据此显示 'no_webgl2' 错误页（ARCH §3.1、§4.4，M1a 补写）。
 * 本模块在运行时只依赖 three 与 core/log（main.ts 静态导入它），不得运行时导入区域或系统模块。
 */
export class NoWebGL2Error extends Error {
  constructor(message = 'WebGL2 is not available') {
    super(message);
    this.name = 'NoWebGL2Error';
  }
}

/**
 * 按 ARCH §13.1 创建全局唯一的 WebGLRenderer（antialias:false、NoToneMapping、toneMappingExposure 1、
 * PCFShadowMap、shadowMap.autoUpdate=false、info.autoReset=false）。WebGL2 不可用时抛 NoWebGL2Error（main.ts 显示错误页）。
 */
export function createRenderer(canvas?: HTMLCanvasElement): THREE.WebGLRenderer {
  const el = canvas ?? document.createElement('canvas');
  const attrs: WebGLContextAttributes = {
    alpha: false, antialias: false, depth: true, stencil: false, premultipliedAlpha: true,
    preserveDrawingBuffer: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false,
  };
  // 先自己要 webgl2：拿不到就明确抛 NoWebGL2Error，而不是让 three 抛一条笼统的 Error
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = el.getContext('webgl2', attrs);
  } catch {
    gl = null;
  }
  if (!gl) throw new NoWebGL2Error();
  const renderer = new THREE.WebGLRenderer({ canvas: el, context: gl, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;          // 默认值，显式写出（最终编码由 CameraFxPass 自己做，§8.1）
  renderer.toneMapping = THREE.NoToneMapping;                // 色调映射由 CameraFxPass 统一做
  renderer.toneMappingExposure = 1.0;                        // NeutralToneMapping 内部会乘它，曝光走 CameraFxPass 的 uExposure
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;              // r186 已弃用 PCFSoftShadowMap
  renderer.shadowMap.autoUpdate = false;                     // 静态阴影：区域进入与灯开关时 needsUpdate = true
  renderer.info.autoReset = false;                           // 每帧开始手动 renderer.info.reset()，统计整帧
  renderer.setTransparentSort(ghostAwareTransparentSort);    // M4：魂影/回放人身的部件由近到远画（见下）
  THREE.ColorManagement.enabled = true;
  el.style.display = 'block';
  el.style.position = 'absolute';
  el.style.inset = '0';
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.outline = 'none';
  return renderer;
}

interface SortItem { id: number; groupOrder: number; renderOrder: number; z: number; material: THREE.Material }

/**
 * 透明队列排序（M4；three 默认 reversePainterSortStable 的扩展）：同 groupOrder、同 renderOrder 里，
 * 带 `material.userData.ghostDepth` 的魂影/回放人身部件（rigs/humanoid.ts 的逐部件材质，depthWrite = true）排在前面、**由近到远**画——
 * 近的部件先写深度，被它挡住的远部件（躯干后面的胳膊、提篮、关节球）画不上去，魂影只剩最外一层壳，不再像 X 光透视；
 * 原来用的深度预通道子网格让每个部件多一次 draw call（回放 look-dev 机位 274 > 预算 250）。其余透明物体照旧由远到近。
 */
export function ghostAwareTransparentSort(a: SortItem, b: SortItem): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  const ga = a.material?.userData?.ghostDepth === true, gb = b.material?.userData?.ghostDepth === true;
  if (ga !== gb) return ga ? -1 : 1;
  if (a.z !== b.z) return ga ? a.z - b.z : b.z - a.z;
  return a.id - b.id;
}

/** 辅助 RT 的调度单元（镜面、CH1/CH2、录像带），由各系统实现并注册（ARCH §4.7.2）。 */
export interface AuxFeed {
  /** 'mirror' | 'ch1' | 'ch2' | 'tape'（同 key 重复注册在 dev 下抛错） */
  key: string;
  /** 本帧要不要渲 */
  due(frameNo: number): boolean;
  /** 渲进自己的 RT（自己负责乒乓 swap、渲染期间隐藏自身屏幕与 auxHide 对象，ARCH §6.11） */
  render(r: THREE.WebGLRenderer): void;
}

type Light = THREE.Light & { intensity: number };

/**
 * 动态分辨率调度（M4 重写；ARCH §13.2）：纯逻辑，喂 (now, 帧间隔) 返回要切到的档位下标或 null（node 侧自测直接用它）。
 * - 降：最近 2 秒平均帧间隔 > 18ms，降一档（每次切换后冷却 3 秒）。
 * - 升：平均 < 13ms，**或**帧间隔贴着显示器的垂直同步（平均 ≤ 1.1 × 估计的 vsync 周期、周期 ≤ 17.5ms，即没掉帧）持续 hold 秒。
 *   原来只认 < 13ms：60Hz 屏上垂直同步的间隔恒为 16.7ms，一次卡顿降到 0.7 之后整局都升不回来。
 *   vsync 周期取窗口内间隔的第 10 百分位。
 * - 升档后 5 秒内又降回来：下次试升的等待加倍（4 → 8 → 16 … 最多 64 秒）；升上去稳住 10 秒则复位。
 * - hold(ms)：这段时间不采样并清空窗口（建区、编译/预热的长帧不算，Game 在加载中与 areaReady 后 1 秒调用）。
 */
export class DynResGovernor {
  private times: number[] = [];
  private lastSwitchAt = -Infinity;
  private goodSince = 0;
  private holdUntil = -Infinity;
  private upHoldMs: number = DYN_RES.upHoldSec * 1000;
  private lastUpAt = -Infinity;

  constructor(private level: number, private readonly count: number) {}

  get current(): number {
    return this.level;
  }

  reset(level: number, now: number): void {
    this.level = level;
    this.times = [];
    this.goodSince = 0;
    this.lastSwitchAt = now;
  }

  hold(now: number, ms: number): void {
    this.holdUntil = Math.max(this.holdUntil, now + ms);
    this.times = [];
    this.goodSince = 0;
  }

  /** 喂一帧；返回新档位（要切换时）或 null。 */
  sample(now: number, dtMs: number): number | null {
    if (this.count < 2) return null;
    if (now < this.holdUntil) return null;
    // 超过 250ms 的帧是切后台/断点，不代表渲染负载
    if (dtMs <= 0 || dtMs > 250) return null;
    this.times.push(now, dtMs);
    const windowMs = DYN_RES.windowSec * 1000;
    while (this.times.length > 0 && now - this.times[0]! > windowMs) this.times.splice(0, 2);
    // 升上去稳住了：复位试升等待
    if (this.lastUpAt > -Infinity && now - this.lastUpAt > 10_000) {
      this.upHoldMs = DYN_RES.upHoldSec * 1000;
      this.lastUpAt = -Infinity;
    }
    if (now - this.lastSwitchAt < DYN_RES.cooldownSec * 1000) return null;
    const n = this.times.length / 2;
    if (n < 20) return null;
    const iv: number[] = [];
    let sum = 0;
    for (let i = 1; i < this.times.length; i += 2) {
      sum += this.times[i]!;
      iv.push(this.times[i]!);
    }
    const avg = sum / n;
    if (avg > DYN_RES.downAboveMs && this.level > 0) {
      // 刚升上去又撑不住：下次多等一会儿再试
      if (now - this.lastUpAt < 5000) this.upHoldMs = Math.min(64_000, this.upHoldMs * 2);
      this.lastUpAt = -Infinity;
      return this.switchTo(this.level - 1, now);
    }
    iv.sort((a, b) => a - b);
    const vsync = iv[Math.floor(iv.length * 0.1)] ?? avg;
    const smooth = avg < DYN_RES.upBelowMs || (vsync <= 17.5 && avg <= vsync * 1.1);
    if (smooth && this.level < this.count - 1) {
      if (this.goodSince === 0) this.goodSince = now;
      if (now - this.goodSince >= this.upHoldMs) {
        this.lastUpAt = now;
        return this.switchTo(this.level + 1, now);
      }
    } else {
      this.goodSince = 0;
    }
    return null;
  }

  private switchTo(idx: number, now: number): number {
    this.level = idx;
    this.lastSwitchAt = now;
    this.goodSince = 0;
    this.times = [];
    return idx;
  }
}

export class RenderPipeline {
  /** 后期链（GameApi.post、ViewfinderSystem 的叠加预设都经由它，ARCH §8.1） */
  readonly post: PostPipeline;
  protected readonly renderer: THREE.WebGLRenderer;
  protected readonly scene: THREE.Scene;
  protected readonly cameras: CameraRig;
  private feedList: AuxFeed[] = [];
  private frameNo = 0;
  private quality: QualityLevel = 'mid';
  private dynOn = true;
  /** 动态分辨率当前档（DYN_RES.scales 的下标；M1d：相对系数，像素比 = scale × min(DPR, 本档上限)） */
  private levelIdx = 0;
  private levels: number[] = [1];
  private lastFrameAt = 0;
  /** M4：动态分辨率调度（纯逻辑，见 DynResGovernor） */
  private gov = new DynResGovernor(0, 1);
  private postCamera: THREE.Camera | null = null;
  private lastCalls = { total: 0, feeds: 0 };
  /** resize() 之后回调（Game 用它把画框交给 UI）。WP1 内部。 */
  onResize: ((w: number, h: number) => void) | null = null;
  /**
   * M4 第 2 轮（WP1 内部）：本帧 rAF 的时间戳（Game.onFrame 写入，下一次 render 采样后清空）。动态分辨率的帧间隔按它算：
   * 渲染结束时刻的 performance.now() 带着相邻两帧工作量之差的抖动，60Hz 下 p10 间隔被拉低，“贴着垂直同步”的升档判据永远不成立。
   * advance/renderNow（测试、锁步）没有时间戳，退回 performance.now()（那时动态分辨率本来就关着）。
   */
  frameStamp: number | null = null;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cameras: CameraRig, post: PostPipeline) {
    this.renderer = renderer;
    this.scene = scene;
    this.cameras = cameras;
    this.post = post;
  }

  /** 返回注销函数；系统在 configure/register 时注册，离开区域时注销 */
  addFeed(f: AuxFeed): () => void {
    devAssert(!this.feedList.some(x => x.key === f.key), `RenderPipeline.addFeed: key '${f.key}' 重复注册`);
    this.feedList.push(f);
    return () => {
      this.feedList = this.feedList.filter(x => x !== f);
    };
  }
  /** 当前注册的 feed（warmupArea 预热用，ARCH §8.5） */
  get feeds(): readonly AuxFeed[] {
    return this.feedList;
  }

  /** 每帧：依次调用到期 feed 的 render → 主场景经 PostPipeline 合成；动态分辨率采样 */
  render(dt: number): void {
    this.renderer.info.reset();
    this.frameNo++;
    for (const f of [...this.feedList]) if (f.due(this.frameNo)) f.render(this.renderer);
    this.lastCalls.feeds = this.renderer.info.render.calls;
    this.renderMain(dt, false);
    this.sampleFrameTime();
  }

  /** ARCH §4.7.1 */
  resize(): void {
    const el = this.renderer.domElement;
    const host = el.parentElement;
    const w = Math.max(1, Math.round(host?.clientWidth ?? el.clientWidth ?? 1));
    const h = Math.max(1, Math.round(host?.clientHeight ?? el.clientHeight ?? 1));
    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, pr);
    this.cameras.setViewport(w, h);
    this.onResize?.(w, h);
  }

  /** ARCH §13.2 */
  setQuality(q: QualityLevel): void {
    this.quality = q;
    this.post.setQuality(q);
    const spec = QUALITY[q];
    this.renderer.shadowMap.enabled = spec.shadows;
    this.levels = spec.dynamicRes ? [...DYN_RES.scales] : [1];
    // 从本档上限起步：先给最好的画面，帧时超标再降
    this.levelIdx = this.levels.length - 1;
    this.gov = new DynResGovernor(this.levelIdx, this.levels.length);
    this.gov.reset(this.levelIdx, performance.now());
    this.resize();
  }

  /** 当前画质档（WP1 内部；AreaManager.enter 发现与设置不符时补一次 setQuality）。 */
  get qualityLevel(): QualityLevel {
    return this.quality;
  }

  /** 关闭/开启动态分辨率（?test=1 与截图时关闭） */
  setDynamicResolution(on: boolean): void {
    if (this.dynOn === on) return;
    this.dynOn = on;
    this.levelIdx = this.levels.length - 1;
    this.gov.reset(this.levelIdx, performance.now());
    this.resize();
  }

  /** M4（WP1 内部）：ms 毫秒内不采样动态分辨率并清空窗口（建区、预热的长帧与进区域后的头一秒不算负载）。 */
  holdDynamicResolution(ms: number): void {
    this.gov.hold(performance.now(), ms);
  }

  /**
   * 当前压入渲染的真实灯数 / 其中强度 > 0 的数目 / 动态分辨率系数；perf() 的来源之一（ARCH §12.3）。
   * M1c：另有最近一帧**主场景**的 draw call 与三角面（`post.sceneStats`，RenderPass 前后取差；不含辅助 RT 与后期 pass）。
   */
  stats(): { lights: number; lightsOn: number; renderScale: number; callsMain: number; trisMain: number } {
    let lights = 0;
    let lightsOn = 0;
    // three 的 projectObject 跳过不可见子树、对灯也做图层测试（灯一律 enableAll，所以只看可见性）
    this.scene.traverseVisible(o => {
      if ((o as THREE.Light).isLight !== true) return;
      lights++;
      if ((o as Light).intensity > 0) lightsOn++;
    });
    const main = this.post.sceneStats;
    return { lights, lightsOn, renderScale: this.renderScale(), callsMain: main.calls, trisMain: main.triangles };
  }

  // ---------------------------------------------------------------- WP1 内部
  /** 只渲主场景（不调度 feed）：Game.renderNow() 用。 */
  renderMain(dt: number, resetInfo = true): void {
    if (resetInfo) this.renderer.info.reset();
    const cam = this.cameras.camera;
    if (cam !== this.postCamera) {
      this.post.setCamera(cam);
      this.postCamera = cam;
    }
    this.post.render(dt);
    this.lastCalls.total = this.renderer.info.render.calls;
  }

  /** 最近一帧的 draw call：总数与其中辅助 RT 的部分（WP1 内部；主场景的部分见 stats().callsMain）。 */
  get lastFrameCalls(): { total: number; feeds: number } {
    return { ...this.lastCalls };
  }

  /** 动态分辨率系数（≤ 1）：当前像素比 / 本档不降级时的像素比。 */
  renderScale(): number {
    const cap = Math.min(this.dpr(), QUALITY[this.quality].pixelRatio);
    return cap > 0 ? this.pixelRatio() / cap : 1;
  }

  private dpr(): number {
    return typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  }

  private pixelRatio(): number {
    const cap = Math.min(this.dpr(), QUALITY[this.quality].pixelRatio);
    const scale = this.dynOn && QUALITY[this.quality].dynamicRes ? (this.levels[this.levelIdx] ?? 1) : 1;
    return cap * scale;
  }

  /** 动态分辨率采样（ARCH §13.2；M4：规则见 DynResGovernor）。帧时是真实时间（这是性能调度，不是玩法计时）。 */
  private sampleFrameTime(): void {
    const now = this.frameStamp ?? performance.now();
    this.frameStamp = null;
    const dtMs = this.lastFrameAt > 0 ? now - this.lastFrameAt : 0;
    this.lastFrameAt = now;
    if (!this.dynOn || !QUALITY[this.quality].dynamicRes || this.levels.length < 2) return;
    const next = this.gov.sample(now, dtMs);
    if (next !== null && next !== this.levelIdx) {
      this.levelIdx = next;
      this.resize();
    }
  }
}
