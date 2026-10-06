// owner: WP7
// 页面内自测登记（ARCH §2.10）：各 WP 在自己的 src/areas/dev/wpN.ts 里 registerSelftest(name, fn)，
// scripts/selftest/wpN.mjs 经 __game.selftest(name)（仅 ?debug=1）调用。M1a 已实现登记表（dev/wpN.ts 在模块加载时就会调用）。

import type { ApiResult, Awaitable } from '../core/types';
import type { Game } from '../core/game';

export interface SelftestResult {
  ok: boolean;
  /** 逐条断言的说明（失败的写原因） */
  notes?: string[];
}

export type SelftestFn = (game: Game) => Awaitable<SelftestResult>;

const registry = new Map<string, SelftestFn>();

/** 登记一个页面内自测；name 建议 'wpN.<snake>'。同名重复登记抛错。 */
export function registerSelftest(name: string, fn: SelftestFn): void {
  if (registry.has(name)) throw new Error(`registerSelftest: duplicate '${name}'`);
  registry.set(name, fn);
}

export function listSelftests(): string[] {
  return [...registry.keys()].sort();
}

/** 运行一个自测；不存在 → { ok:false, reason:'no_such_target' }；抛错 → { ok:true, result:{ ok:false, notes:[错误] } }。 */
export async function runSelftest(game: Game, name: string): Promise<ApiResult<SelftestResult>> {
  const fn = registry.get(name);
  if (!fn) return { ok: false, reason: 'no_such_target' };
  try {
    return { ok: true, result: await fn(game) };
  } catch (err) {
    return { ok: true, result: { ok: false, notes: [err instanceof Error ? `${err.name}: ${err.message}` : String(err)] } };
  }
}
