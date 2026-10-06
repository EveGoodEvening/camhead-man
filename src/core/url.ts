// owner: WP1
// URL 参数（ARCH §3.1）：new debug test lockstep nolock quality area spawn mute。M1a 已实现解析。

import type { AreaKey, QualityLevel } from './types';

export interface UrlOptions {
  /** ?new=1：清空存档、跳过标题直接新游戏 */
  newGame: boolean;
  /** ?debug=1：调试专用 API 与性能面板 */
  debug: boolean;
  /** ?test=1：测试模式（淡入淡出 ×0.05、打字机即时、静音、不请求指针锁定、隐藏页面不自动暂停） */
  test: boolean;
  /** ?lockstep=1：锁步（只在 test 下有效） */
  lockstep: boolean;
  /** ?nolock=1：不请求指针锁定，按住左键拖拽转视角 */
  nolock: boolean;
  /** ?quality=low|mid|high */
  quality: QualityLevel | null;
  /** ?area=<id>（仅 debug） */
  area: AreaKey | null;
  /** ?spawn=<spawnId>（仅 debug） */
  spawn: string | null;
  /** ?mute=1 */
  mute: boolean;
  /**
   * M4：?slow=k（只在 test 下有效，1–20，缺省 1）：测试用的真实时间上限（调试 API 60 秒、Game.settle 60 秒、Game.drive 90 秒）乘 k。
   * 机器负载很高时无头 SwiftShader 每秒只推进零点几秒游戏时间，15 秒的开场过场就超时；harness 的 CAMERA_SLOW 环境变量带上它。
   */
  slow?: number;
}

const AREA_KEYS: readonly string[] = ['r1', 'r2', 'r2_502', 'r3', 'r4', 'dev'];

export function parseUrl(search: string = typeof location !== 'undefined' ? location.search : ''): UrlOptions {
  const p = new URLSearchParams(search);
  const flag = (k: string): boolean => p.get(k) === '1';
  const q = p.get('quality');
  const a = p.get('area');
  const test = flag('test');
  const debug = flag('debug');
  return {
    newGame: flag('new'),
    debug,
    test,
    lockstep: test && flag('lockstep'),
    nolock: flag('nolock'),
    quality: q === 'low' || q === 'mid' || q === 'high' ? q : null,
    area: debug && a !== null && AREA_KEYS.includes(a) ? (a as AreaKey) : null,
    spawn: debug ? p.get('spawn') : null,
    mute: flag('mute'),
    slow: test ? Math.min(20, Math.max(1, Number(p.get('slow')) || 1)) : 1,
  };
}
