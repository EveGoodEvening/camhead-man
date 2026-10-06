// owner: WP2
// 种子随机（ARCH §1.5）：构建期随机一律用它，保证截图可复现。M1a 已实现（mulberry32）。

/** mulberry32：返回 [0,1) 的伪随机函数。 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(r: () => number, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pick: empty array');
  return arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))] as T;
}

/** 字符串 → 32 位种子（FNV-1a）；ctx.rng() 以区域 id 为种子时用它（M1a 补写）。 */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** [lo, hi) 的随机数。 */
export function range(r: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * r();
}
