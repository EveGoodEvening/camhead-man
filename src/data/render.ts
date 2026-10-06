// owner: integrator
// （M1a 写全量并冻结；此后只有整合代理/引擎维护者能改，ARCH §2.12）
// 渲染与性能常量（ARCH §10.3、§13.2、§13.3；GDD §3.3 温度、§9.3 预算）。
// LIGHT_SCALE、LOOK：M1c look-dev 关卡（dev 沙盒 lookdev 角落）调好后已冻结（ARCH §15.3、§10.3）；改动需整合代理重跑 shot.dev.lookdev_*。

import type { QualityLevel } from '../core/types';

/**
 * GDD 的“设计强度” → three 物理单位的换算系数（ARCH §10.3；M1c look-dev 冻结）。
 * - point/spot：坎德拉 = design × 0.1 × distance²（designLight()/lamp()；见 kit/lamps.ts 的 designCandela）。
 *   GDD 的“强度 X、距离 Y”是旧版 three 线性衰减的心智（灯“照到 Y 米”）；按 distance² 归一后，钠灯 2.2/14、CRT 0.6/3、
 *   声控灯 1.6/6、灯笼 0.9/5 都落在合适的亮度（原初值 point 20 是“×20 不看距离”：钠灯够亮时 CRT 0.6/3 会把小屋照爆）。
 * - hemi/ambient/dir：intensity = design × π（与旧版 three 的“艺术家单位”一致：颜色 × 设计强度 ≈ 受光面反照率的比例，
 *   R2“环境光 0.12 保底”就是一成的底光）。R1 的 #1B2233/#0B1020 × 0.25 几乎是黑的——R1 的暗部靠环境贴图与夜空，这是 GDD 要的夜色。
 */
export const LIGHT_SCALE = { point: 0.1, spot: 0.1, hemi: Math.PI, ambient: Math.PI, dir: Math.PI };

export interface QualitySpec {
  /** 像素比上限 */
  pixelRatio: number;
  /** 是否启用动态分辨率 */
  dynamicRes: boolean;
  bloom: boolean;
  /** 雨丝数量 */
  rain: number;
  shadows: boolean;
  shadowMapSize: number;
  /** 镜面 RT 边长与刷新间隔（帧） */
  mirrorRT: number;
  mirrorEvery: number;
  /** CH2 / 录像带 RT 刷新间隔（帧） */
  feedEvery: number;
  anisotropy: number;
}

/** 画质三档（ARCH §13.2）。默认 mid。 */
export const QUALITY: Readonly<Record<QualityLevel, QualitySpec>> = {
  low: { pixelRatio: 1.0, dynamicRes: false, bloom: false, rain: 1000, shadows: false, shadowMapSize: 512, mirrorRT: 512, mirrorEvery: 3, feedEvery: 4, anisotropy: 1 },
  mid: { pixelRatio: 1.25, dynamicRes: true, bloom: true, rain: 2000, shadows: true, shadowMapSize: 512, mirrorRT: 1024, mirrorEvery: 2, feedEvery: 2, anisotropy: 4 },
  high: { pixelRatio: 1.5, dynamicRes: true, bloom: true, rain: 3000, shadows: true, shadowMapSize: 512, mirrorRT: 1024, mirrorEvery: 2, feedEvery: 2, anisotropy: 4 },
};
export const DEFAULT_QUALITY: QualityLevel = 'mid';

/**
 * 动态分辨率（ARCH §13.2）：按最近 2 秒平均帧时在各级之间切换。
 * M1d：scales 是相对系数——像素比 = scale × min(devicePixelRatio, 本档 pixelRatio)。原来的绝对像素比 1.0/1.25/1.5 在 DPR 1 的屏幕
 * （目标机型：集显 1080p）上全被钳成 1，降档毫无作用；UI 是 DOM，低于原生分辨率也不糊字。
 */
export const DYN_RES = {
  scales: [0.7, 0.85, 1.0],
  windowSec: 2,
  downAboveMs: 18,
  upBelowMs: 13,
  upHoldSec: 4,
  cooldownSec: 3,
} as const;

/** 硬预算（ARCH §13.3）。 */
export const BUDGET = {
  callsMain: 250,
  callsTotal: 400,
  tris: 250_000,
  /** 每区实时灯总数（含半球光/环境光），进区域后恒定 */
  lights: 8,
  /** 录像带 tapeScene 另计 */
  tapeLights: 3,
  /** 全局投影光 */
  shadowLights: 1,
  /** CanvasTexture 总量（按 w×h×4 估算） */
  canvasBytes: 64 * 1024 * 1024,
  /** 每区动态碰撞体 */
  dynamicColliders: 16,
  /** 每区网格数（红外逐帧换材质的规模上限） */
  meshes: 2000,
  /** 区域切换 5 次后 geometries/textures 回到基线 ± 这个数 */
  resourceDrift: 5,
} as const;

/** 辅助 RenderTarget 尺寸（ARCH §13.3）。 */
export const RT_SIZE = {
  ch: [256, 192],
  tape: [256, 192],
  split5Atlas: [512, 384],
  mirrorFar: 8,
} as const;

/**
 * look-dev 基准（M1c 冻结，dev 沙盒 shot.dev.lookdev_* 调出来的）：
 * - exposure：CameraFxPass 的 uExposure（线性，乘在 Neutral 色调映射之前）。1.0 → 1.5：R1 标准夜景的平均亮度 ≈ 0.13（shots.mjs 区间 0.05–0.35 的下三分之一），
 *   暗部仍是靛蓝近黑。区域只在极端场景（暗房、灯全灭的楼道）用 AreaDef.post 的 overrides 微调 ±0.3。
 * - bloomThreshold 0.8（线性 HDR）：自发光 ×2.2 以上的灯罩、亮窗、霓虹才出光，受光的墙面不出光。各区 Bloom 强度照 GDD §9.2（R1 0.5…R4 0.8）。
 * - bloomRadius 0.4 → 0.45：雨夜里灯的光晕略大一圈。
 * - envIntensity：区域环境贴图（fx/environment.ts 的夜景环境）的建议强度范围；它主要给金属、玻璃、湿地面反光，几乎不抬亮墙面。
 *   R1 1.0；楼道/屋内 0.6–0.8；霓虹街、鬼市 1.0–1.4。低于 0.5 镜头玻璃发黑，高于 1.5 玻璃变成一块铜镜。
 */
export const LOOK = {
  exposure: 1.5,
  bloomThreshold: 0.8,
  bloomRadius: 0.45,
  envIntensity: [0.6, 1.4] as const,
  envDefault: 1.0,
};

/** 红外温度（℃，GDD §3.3 M5；ARCH §6.8.2）。obj.userData.tempC 优先于材质 userData.tempC，缺省 ambient。 */
export const TEMP_C = {
  ambient: 18,
  yin: 6,
  paper: 6,
  /** 鬼市灯笼是阴火 */
  ghostLantern: 6,
  cold: 3,
  alive: 36,
  huang: 36.5,
  thermos: 50,
  lamp: 60,
} as const;

/** 渲染顺序（ARCH §13.1）：四者 depthWrite:false。 */
export const RENDER_ORDER = { rain: 5, ghost: 10, paperGlow: 15, replay: 20 } as const;
