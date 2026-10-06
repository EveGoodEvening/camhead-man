// owner: WP1
// 开发期断言与占位（ARCH §2.2）。M1a 已真实实现 notImplemented / devAssert / devWarn；WP1 可以扩充但不得改变签名。

/**
 * “dev 下”检查是否生效。测试对生产构建跑（ARCH §12.1），所以除了 vite dev 之外，
 * URL 带 ?debug=1 或 ?test=1 时同样开启（ARCH 各处“dev 下抛错”都指 DEV_CHECKS 为真）。
 */
export const DEV_CHECKS: boolean = computeDevChecks();

function computeDevChecks(): boolean {
  let dev = false;
  try {
    dev = import.meta.env.DEV === true;
  } catch {
    dev = false;
  }
  if (typeof location !== 'undefined' && /[?&](debug|test)=1(&|$)/.test(location.search)) dev = true;
  return dev;
}

/** M1a 占位抛出的错误类型；scripts/check.mjs --stubs 统计源码里残留的 notImplemented 调用。 */
export class NotImplementedError extends Error {
  constructor(readonly what: string) {
    super(`notImplemented: ${what}`);
    this.name = 'NotImplementedError';
  }
}

/** M1a 的占位：调用即抛 NotImplementedError。返回 never，可直接写在任何返回类型的方法里。 */
export function notImplemented(what: string): never {
  throw new NotImplementedError(what);
}

/** 开发期断言：DEV_CHECKS 为真且条件为假时抛错；生产构建（且没有 ?debug/?test）里是空操作。 */
export function devAssert(cond: unknown, msg: string | (() => string)): asserts cond {
  if (!DEV_CHECKS || cond) return;
  throw new Error(`[devAssert] ${typeof msg === 'function' ? msg() : msg}`);
}

/** 开发期警告：DEV_CHECKS 为真时 console.warn；否则空操作。不要在消息里写 “deprecated” 一类字样（harness 会判失败）。 */
export function devWarn(...args: unknown[]): void {
  if (DEV_CHECKS) console.warn('[dev]', ...args);
}
