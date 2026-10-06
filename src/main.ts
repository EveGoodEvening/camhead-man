// owner: WP1
// 入口（ARCH §2.1、§3.1）：new Game(#app).boot()；任何一步抛错都显示中文错误页。
// core/game 与 debug/api 在 try 内动态导入：src/areas/* 在模块求值时就执行 defineArea/mergeAreaParts/defineDialogues 的 dev 断言，
// 静态导入时这类异常早于 main() 的 try/catch（只剩 pageerror 与空白页）。本文件只静态导入 bootError 与 core/render（NoWebGL2Error）。

import { showBootError } from './ui/bootError';
import { NoWebGL2Error } from './core/render';

async function main(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) throw new Error('#app not found');
  try {
    const { Game } = await import('./core/game');
    const game = new Game(host);
    await game.boot();
    const { mountDebugApi } = await import('./debug/api');
    mountDebugApi(game);
  } catch (err) {
    console.error(err);
    if (err instanceof NoWebGL2Error) showBootError(host, 'no_webgl2');
    else showBootError(host, 'exception', err instanceof Error ? err.message : String(err));
  }
}

void main();
