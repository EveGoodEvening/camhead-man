// owner: WP7
// ?debug=1 时的 FPS/drawcall/灯数面板（ARCH §2.10）。WP7 内部（mountDebugApi 调用；导出不属于冻结签名）。
// 面板自己不挂 rAF：由 debug/api.ts 的计时器每个真实渲染帧调 update(dt)（锁步下 Game.step 不在 rAF 里跑）。
// 纯装饰：pointer-events:none、没有按钮，不会抢焦点；截图时由 runShot 隐藏。

import type { Game } from '../core/game';

export interface DebugOverlay {
  readonly el: HTMLElement;
  update(dt: number): void;
  setHidden(hidden: boolean): void;
  dispose(): void;
}

/** 刷新间隔（秒，真实时间）：pipeline.stats() 要遍历场景，没必要每帧算。 */
const REFRESH_SEC = 0.5;

export function mountOverlay(game: Game): DebugOverlay {
  const el = document.createElement('div');
  el.className = 'cm-debug-overlay';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'absolute', right: '6px', top: '6px', zIndex: '10000', pointerEvents: 'none',
    font: '11px/1.35 ui-monospace, Menlo, Consolas, monospace', color: '#7CFFB2', background: 'rgba(0,0,0,0.55)',
    padding: '4px 6px', whiteSpace: 'pre', borderRadius: '2px',
  } satisfies Partial<CSSStyleDeclaration>);
  game.host.appendChild(el);

  let acc = 0;
  let frames = 0;
  let hidden = false;
  const refresh = (fps: number): void => {
    const info = game.renderer.info;
    const st = game.pipeline.stats();
    const area = game.areas.current?.def.id ?? '-';
    el.textContent =
      `FPS ${fps.toFixed(0)}  calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(1)}k\n` +
      `lights ${st.lights} (on ${st.lightsOn})  geo ${info.memory.geometries}  tex ${info.memory.textures}  prog ${info.programs?.length ?? 0}\n` +
      `${area}  ${game.modes.top.replace('mode.', '')}  scale ${st.renderScale.toFixed(2)}${game.lockstep ? '  lockstep' : ''}`;
  };

  return {
    el,
    update(dt) {
      if (hidden) return;
      acc += dt;
      frames++;
      if (acc < REFRESH_SEC) return;
      refresh(frames / acc);
      acc = 0;
      frames = 0;
    },
    setHidden(h) {
      hidden = h;
      el.style.display = h ? 'none' : '';
    },
    dispose() {
      el.remove();
    },
  };
}
