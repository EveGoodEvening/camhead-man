// owner: WP3
// 后期预设（ARCH §8.2）。数值照 GDD §9.2；区域只选预设、微调数值。
// exposure、Bloom 阈值与半径取 data/render.ts 的 LOOK（M1c look-dev 后只改 LOOK 一处即可冻结基准）。

import type { FxParams } from './post';
import { LOOK } from '../data/render';
import { PALETTE } from '../data/palette';

export type PostPresetId = 'r1' | 'r1_yin' | 'r1_mao' | 'r2' | 'r3' | 'r4' | 'r4_market' | 'vf' | 'replay' | 'ir' | 'ch1' | 'darkroom_red' | 'dev';

/** Bloom 只按区域给强度；阈值与半径是全局 look-dev 基准。 */
function bloom(strength: number): FxParams['bloom'] {
  return { strength, radius: LOOK.bloomRadius, threshold: LOOK.bloomThreshold };
}

/** '#rrggbb' → 0..1 的 sRGB 分量（tint 在显示空间里混合，所以不转线性）。 */
function srgb(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 未被任何预设覆盖时的默认值（M1c look-dev 后冻结 exposure 与 Bloom 阈值）。 */
export const FX_DEFAULTS: Readonly<FxParams> = {
  grain: 0.08, scanline: 0, chroma: 0.003, vignette: 0.45,
  bloom: bloom(0.5),
  monoRed: 0, vhs: 0, barrel: 0, ir: 0,
  tint: [1, 1, 1], tintAmt: 0,
  frame43: 0, flash: 0, fade: 0, flicker: 0, exposure: LOOK.exposure,
};

// 鬼市“画面略偏绿”（GDD §4.5）：不在 20 色表里，取灶火青与纸白之间的一个淡绿。
const MARKET_GREEN: readonly [number, number, number] = [0.72, 0.95, 0.78];

/**
 * 叠加规则（ARCH §8.1）：base 之上按 push 顺序覆盖；标量取最后一个定义者；chroma 在 vf 层是乘法（×2.5）。
 * 'vf' 的 chroma 字段因此表示倍率。区域基础预设（r1…r4、dev）应把颗粒/色差/暗角/Bloom 写全，
 * 叠加预设（vf、replay、ir、ch1、darkroom_red）只写自己关心的字段。
 */
export const POST_PRESETS: Readonly<Record<PostPresetId, Partial<FxParams>>> = {
  r1: { grain: 0.08, chroma: 0.003, vignette: 0.45, bloom: bloom(0.5) },
  r1_yin: { grain: 0.06, chroma: 0.003, vignette: 0.45, bloom: bloom(0.5) },
  r1_mao: { grain: 0.04, chroma: 0.003, vignette: 0.45, bloom: bloom(0.5), tint: srgb(PALETTE.DAWN), tintAmt: 0.25 },
  r2: { grain: 0.10, chroma: 0.004, vignette: 0.60, bloom: bloom(0.3) },
  r3: { grain: 0.07, chroma: 0.005, vignette: 0.45, bloom: bloom(0.7) },
  r4: { grain: 0.12, chroma: 0.006, vignette: 0.55, bloom: bloom(0.8), flicker: 0.15 },
  // 开市后灯管全灭、换成灯笼（GDD §4.5），所以没有频闪
  r4_market: { grain: 0.12, chroma: 0.006, vignette: 0.55, bloom: bloom(0.8), tint: MARKET_GREEN, tintAmt: 0.15, flicker: 0 },
  vf: { scanline: 0.25, chroma: 2.5, frame43: 1 },
  replay: { vhs: 1, tint: srgb(PALETTE.REPLAY), tintAmt: 0.5 },
  // 红外：CameraFxPass 走色带分支、PostPipeline 关 Bloom；颗粒加粗
  ir: { ir: 1, grain: 0.18 },
  ch1: { barrel: 0.08 },
  darkroom_red: { monoRed: 1 },
  // 沙盒 = R1 标准夜景（M1c look-dev 的基准画面在沙盒里截）
  dev: { grain: 0.08, chroma: 0.003, vignette: 0.45, bloom: bloom(0.5) },
};
