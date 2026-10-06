// owner: integrator
// （M1a 写全量并冻结；此后只有整合代理/引擎维护者能改，ARCH §2.12）
// 基础类型（ARCH §4.1）。只有类型与少量常量，不依赖任何其他模块。

/** 位置元组（米）。y 轴向上，+x 东，-z 北（ARCH §1.3）。 */
export type V3 = readonly [number, number, number];
/** 二维地面点 (x, z)。 */
export type XZ = readonly [number, number];

export type AreaId = 'r1' | 'r2' | 'r2_502' | 'r3' | 'r4';
/** 含开发沙盒 `dev`（ARCH §0.3，只在 ?debug=1&area=dev 下可达）。 */
export type AreaKey = AreaId | 'dev';
export const AREA_IDS: readonly AreaId[] = ['r1', 'r2', 'r2_502', 'r3', 'r4'];

export type ModeId =
  | 'mode.explore' | 'mode.viewfinder' | 'mode.replay'
  | 'mode.panel_vcr' | 'mode.panel_console' | 'mode.panel_code' | 'mode.panel_naming'
  | 'mode.dialogue' | 'mode.album' | 'mode.journal' | 'mode.tripod' | 'mode.cutscene' | 'mode.pause';
export const MODE_IDS: readonly ModeId[] = [
  'mode.explore', 'mode.viewfinder', 'mode.replay',
  'mode.panel_vcr', 'mode.panel_console', 'mode.panel_code', 'mode.panel_naming',
  'mode.dialogue', 'mode.album', 'mode.journal', 'mode.tripod', 'mode.cutscene', 'mode.pause',
];

export type LensMode = 'normal' | 'ir';
export type ZoomLevel = 1 | 2 | 3 | 4 | 6;
export const ZOOM_STEPS: readonly ZoomLevel[] = [1, 2, 3, 4, 6];
export type Shichen = 'zi' | 'chou' | 'yin' | 'mao';
export type Pose = 'stand' | 'walk' | 'sit' | 'crouch' | 'raise_arm' | 'carry' | 'lie' | 'look_up';
export type Verb = 'primary' | 'show' | 'use';
/** 画质档（ARCH §13.2）。 */
export type QualityLevel = 'low' | 'mid' | 'high';

/** 相机位姿：位置 + 注视点；fov 为垂直视场（度）；roll 为度。 */
export interface CameraPose { pos: V3; target: V3; fov?: number; roll?: number }

/**
 * 调试 API 与各系统动作的统一返回（ARCH §4.1）。
 * ok = 动作被执行了（即便是“用错了”的反馈）；ok:false = 动作无法执行，reason 取 FailReason 之一。
 */
export interface ApiResult<T = unknown> { ok: boolean; reason?: string; result?: T }

/** ApiResult.reason 的取值全集（ARCH §4.1）。 */
export type FailReason =
  | 'mode_disallows' | 'no_such_target' | 'not_present' | 'out_of_range' | 'wrong_view' | 'wrong_lens'
  | 'blocked' | 'not_owned' | 'no_ability' | 'not_near_replay_point' | 'locked' | 'not_in_viewfinder'
  | 'no_dialogue' | 'no_choice' | 'bad_option' | 'no_panel' | 'busy' | 'bad_args' | 'timeout'
  | 'not_focusable' | 'unreachable' | 'cancelled';

export type Awaitable<T = void> = T | Promise<T>;

/** idle：没有未完成的 Effect；waiting：阻塞点正在等玩家输入（对话行/选项、过场 await、面板已打开）。 */
export type Settle = 'idle' | 'waiting';

/** 构造失败结果的小工具（不改变语义，仅减少样板）。 */
export function fail<T = unknown>(reason: FailReason, result?: T): ApiResult<T> {
  return result === undefined ? { ok: false, reason } : { ok: false, reason, result };
}
/** 构造成功结果。 */
export function ok<T = unknown>(result?: T): ApiResult<T> {
  return result === undefined ? { ok: true } : { ok: true, result };
}
