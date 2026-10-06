// owner: WP6
// CSS 文本、字体栈、调色板变量（ARCH §7）：颜色用 PALETTE 生成的 CSS 变量（--osd: #7CFFB2 等）。
// WP 内部模块（ARCH §2.13）：除 paletteCssVars/buildCss/injectStyles/UI_FONT 外的导出只供 src/ui 使用。
//
// 视觉基调：监控 OSD（等宽、磷绿、REC 红）+ 老物件（巡夜本纸张、圆珠笔、相册黑卡纸、铜锁）。
// 文字一律保证对比度：浅字配 ≥60% 不透明度的深底，深字配纸色底；动画只用在 REC 闪烁、墨迹反光、提示淡入等少数地方。

import { PALETTE, IR_RAMP } from '../data/palette';
import { FONT_STACK } from '../kit/text';

/** PALETTE → CSS 变量名（'--osd' 等；M1a 已实现）。 */
export function paletteCssVars(): string {
  return Object.entries(PALETTE)
    .map(([k, v]) => `--${k.toLowerCase().replace(/_/g, '-')}: ${v};`)
    .join('\n  ');
}

/** 供其他 UI 文件拼内联样式时引用。 */
export const UI_FONT = FONT_STACK;
/** OSD、计数器：等宽拉丁字形 + CJK 回退（“周四”这类字落到系统 CJK 字体）。 */
export const MONO_FONT = `"DejaVu Sans Mono","Menlo","Consolas","Liberation Mono",${FONT_STACK}`;
/** 老周的手写：有楷体就用楷体，没有就退到黑体（测试机只有文泉驿正黑，靠颜色与笔触模拟）。 */
export const HAND_FONT = `"Kaiti SC","STKaiti","KaiTi","BiauKai","AR PL UKai CN",${FONT_STACK}`;
/** 印刷品（讣告、公告、旧书）：有宋体用宋体。 */
export const SERIF_FONT = `"Songti SC","STSong","SimSun","Noto Serif SC","Noto Serif CJK SC","AR PL UMing CN",${FONT_STACK}`;

/** 红外色标（0℃ 在下、45℃ 在上）。 */
export const IR_GRADIENT = `linear-gradient(to top, ${IR_RAMP.join(', ')})`;

/** 四角折线（取景框、角标）：一个元素 8 段背景渐变画出 4 个 L 形角。len 为臂长，w 为线宽。 */
function corners(len: string, w: string): string {
  const g = 'linear-gradient(currentColor,currentColor)';
  return [
    `${g} left top / ${len} ${w}`, `${g} left top / ${w} ${len}`,
    `${g} right top / ${len} ${w}`, `${g} right top / ${w} ${len}`,
    `${g} left bottom / ${len} ${w}`, `${g} left bottom / ${w} ${len}`,
    `${g} right bottom / ${len} ${w}`, `${g} right bottom / ${w} ${len}`,
  ].join(',\n    ');
}

/** 全部 UI 的 CSS 文本（字体栈 FONT_STACK、字幕三档字号、各层 z 序）。 */
export function buildCss(): string {
  return `
/* ================================================================ 根与分层（ARCH §7） */
.cm-ui {
  ${paletteCssVars()}
  --ink-old: #23408e;
  --ink-wet: #0d1733;
  --panel-bg: rgba(8, 11, 20, 0.9);
  --panel-line: rgba(237, 230, 214, 0.16);
  --dim: #a9adb8;
  --grey: #8e929b;
  --fx: 0px; --fy: 0px; --fw: 100%; --fh: 100%;
  position: absolute; inset: 0; z-index: 10; overflow: hidden;
  pointer-events: none; user-select: none; -webkit-user-select: none;
  font-family: ${UI_FONT};
  font-size: clamp(13px, calc(1.9vmin + 4px), 22px);
  line-height: 1.5; color: var(--paper);
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
}
.cm-ui.cm-ui-hidden { visibility: hidden; }
.cm-layer { position: absolute; inset: 0; pointer-events: none; }
#world-markers { z-index: 1; } #hud { z-index: 2; } #vf { z-index: 3; } #subs { z-index: 4; }
#panels { z-index: 5; } #menus { z-index: 7; } #fade { z-index: 8; }
/* M1d：全屏面板（密码锁、称呼面板）开着时 #subs 升到面板之上，错码/错称呼的反馈与“巡夜本上多了一行字”看得见；反馈条移到面板框下方 */
.cm-ui.cm-panel-open #subs { z-index: 6; }
.cm-ui.cm-panel-open .cm-toasts { top: 84%; }
/* M1d：暂停页在区域/楼层过渡的黑幕里（旧路径直接压了暂停）也要看得见：暂停页开着时 #menus 升到 #fade 之上 */
.cm-ui.cm-pause-on #menus { z-index: 9; }
.cm-hidden { display: none !important; }
:where(.cm-ui button) {
  font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0;
  cursor: pointer; pointer-events: auto; outline: none; text-align: inherit;
}
.cm-click { cursor: pointer; pointer-events: auto; }
.cm-mono { font-family: ${MONO_FONT}; letter-spacing: 0.02em; }
.cm-kbd {
  display: inline-block; min-width: 1.4em; padding: 0 0.35em; margin-right: 0.35em;
  font-family: ${MONO_FONT}; font-size: 0.82em; line-height: 1.45; text-align: center;
  color: var(--paper); border: 1px solid rgba(237, 230, 214, 0.5); border-bottom-width: 2px; border-radius: 3px;
  background: rgba(237, 230, 214, 0.08);
}
.cm-keyhints { display: flex; flex-wrap: wrap; gap: 0.3em 1.1em; font-size: 0.8em; color: var(--dim); }
.cm-keyhint { white-space: nowrap; }
.cm-frame { position: absolute; left: var(--fx); top: var(--fy); width: var(--fw); height: var(--fh); }
@keyframes cm-fadein { from { opacity: 0; } to { opacity: 1; } }
@keyframes cm-bob { 0%, 100% { transform: translateY(0); opacity: 0.9; } 50% { transform: translateY(0.18em); opacity: 0.5; } }
@keyframes cm-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-0.4em); } 40% { transform: translateX(0.35em); } 60% { transform: translateX(-0.25em); } 80% { transform: translateX(0.15em); } }

/* ================================================================ 常规 HUD（GDD §10.2）：左下时辰与钟点、REC 点 */
.cm-hud-corner {
  position: absolute; left: 2.2em; bottom: 1.7em; display: flex; align-items: center; gap: 0.7em;
  padding: 0.3em 0.8em 0.3em 0.7em; border-radius: 2px;
  background: linear-gradient(90deg, rgba(4, 6, 12, 0.62), rgba(4, 6, 12, 0.0));
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
}
.cm-hud-shichen { font-size: 1.3em; letter-spacing: 0.14em; color: var(--paper); transition: text-shadow 0.4s, color 0.4s; }
.cm-hud-clock { font-family: ${MONO_FONT}; color: var(--osd); font-size: 1.02em; opacity: 0.92; }
.cm-rec-dot { width: 0.55em; height: 0.55em; border-radius: 50%; background: var(--rec); box-shadow: 0 0 6px var(--rec); }
.cm-rec-dot.cm-off { opacity: 0.12; box-shadow: none; }
.cm-hud-corner.cm-shichen-change .cm-hud-shichen { color: #fff; text-shadow: 0 0 10px rgba(237, 230, 214, 0.9), 0 0 22px rgba(232, 195, 90, 0.6); }
.cm-hud-hintkey { position: absolute; right: 2.2em; bottom: 1.8em; font-size: 0.78em; color: rgba(237, 230, 214, 0.5); text-shadow: 0 1px 2px #000; }
.cm-colorhint {
  position: absolute; left: 50%; top: calc(50% + 2.3em); transform: translateX(-50%);
  padding: 0.15em 0.8em; background: rgba(4, 6, 12, 0.72); border-radius: 2px; white-space: nowrap;
  font-size: 1.05em; color: #fff;
}

/* ---------------------------------------------------------------- 交互角标（#world-markers） */
.cm-marker { position: absolute; left: 0; top: 0; width: 0; height: 0; color: #fff; }
.cm-marker-box {
  position: absolute; left: -0.5em; top: -0.5em; width: 1em; height: 1em;
  background: ${corners('38%', '2px')};
  background-repeat: no-repeat; filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.95));
  transition: left 0.12s, top 0.12s, width 0.12s, height 0.12s;
}
.cm-marker-tag {
  position: absolute; left: 0; top: 0.85em; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 0.1em; white-space: nowrap;
}
.cm-marker-label { padding: 0.05em 0.55em; font-size: 0.86em; background: rgba(4, 6, 12, 0.66); border-radius: 2px; color: #fff; }
.cm-marker-reason { padding: 0 0.55em; font-size: 0.76em; font-style: italic; color: #c4c7ce; background: rgba(4, 6, 12, 0.66); border-radius: 2px; }
.cm-marker.cm-grey { color: #8a8e97; }
.cm-marker.cm-grey .cm-marker-label { color: #aeb1b8; }
.cm-marker.cm-focus .cm-marker-box { left: -0.7em; top: -0.7em; width: 1.4em; height: 1.4em; }
.cm-marker.cm-focus .cm-marker-tag { top: 1.05em; }
.cm-marker.cm-focus .cm-marker-label { background: rgba(4, 6, 12, 0.82); font-size: 0.92em; }
.cm-marker:not(.cm-focus) .cm-marker-label { opacity: 0.82; }
.cm-marker.cm-blink .cm-marker-box { animation: cm-marker-blink 0.3s ease-in-out 2; }
.cm-marker.cm-blink .cm-marker-label { animation: cm-marker-blink 0.3s ease-in-out 2; }
@keyframes cm-marker-blink { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.15; transform: scale(1.5); } }

/* ================================================================ 取景器 HUD（GDD §10.2、M1） */
.cm-vf { position: absolute; inset: 0; }
.cm-vf .cm-frame { color: rgba(237, 245, 238, 0.85); }
.cm-vf-corners {
  position: absolute; inset: 3.2% 2.6%;
  background: ${corners('2.4em', '2px')};
  background-repeat: no-repeat; opacity: 0.8;
}
.cm-osd {
  font-family: ${MONO_FONT}; color: var(--osd); letter-spacing: 0.04em; white-space: nowrap;
  text-shadow: 0 0 5px rgba(124, 255, 178, 0.45), 0 1px 1px rgba(0, 0, 0, 0.9);
}
.cm-vf-top { position: absolute; left: 5%; top: 5%; display: flex; align-items: center; gap: 0.8em; font-size: 0.98em; }
.cm-vf-rec { display: flex; align-items: center; gap: 0.35em; color: var(--rec); font-family: ${MONO_FONT}; font-weight: bold; text-shadow: 0 0 5px rgba(255, 32, 32, 0.6); }
.cm-vf-rec.cm-off .cm-rec-dot { opacity: 0.15; box-shadow: none; }
.cm-vf-right { position: absolute; right: 5%; top: 5%; display: flex; align-items: center; gap: 0.7em; }
.cm-vf-lens {
  display: flex; align-items: center; gap: 0.35em; padding: 0.05em 0.5em; border: 1px solid rgba(124, 255, 178, 0.55);
  border-radius: 2px; font-size: 0.86em;
}
.cm-vf-lens-icon { width: 0.9em; height: 0.9em; border-radius: 50%; border: 2px solid currentColor; box-sizing: border-box; }
.cm-vf-lens.cm-ir { color: #ffd43b; border-color: rgba(255, 212, 59, 0.7); text-shadow: 0 0 5px rgba(217, 72, 15, 0.8); }
.cm-vf-lens.cm-ir .cm-vf-lens-icon { background: radial-gradient(circle, #fff 0 20%, #ffd43b 30%, #d9480f 70%); border-color: #ffd43b; }
.cm-vf-zoomtxt { font-size: 1.05em; }
.cm-vf-cross {
  position: absolute; left: 50%; top: 50%; width: 2.2em; height: 2.2em; transform: translate(-50%, -50%);
  background:
    linear-gradient(currentColor, currentColor) center / 2px 100% no-repeat,
    linear-gradient(currentColor, currentColor) center / 100% 2px no-repeat;
  color: rgba(124, 255, 178, 0.95); filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.95));
  -webkit-mask: radial-gradient(circle, transparent 0 0.32em, #000 0.34em);
  mask: radial-gradient(circle, transparent 0 0.32em, #000 0.34em);
}
.cm-vf-cross::after { content: ""; position: absolute; left: 50%; top: 50%; width: 3px; height: 3px; margin: -1.5px 0 0 -1.5px; background: currentColor; border-radius: 50%; }
.cm-vf-cross-ring {
  position: absolute; left: 50%; top: 50%; width: 3.4em; height: 3.4em; transform: translate(-50%, -50%);
  color: rgba(124, 255, 178, 0.55);
  background: ${corners('22%', '1.5px')};
  background-repeat: no-repeat;
}
.cm-vf.cm-ir-on .cm-vf-cross, .cm-vf.cm-ir-on .cm-vf-cross-ring { color: rgba(255, 255, 255, 0.92); }
.cm-vf.cm-ir-on .cm-osd { color: #fff; text-shadow: 0 0 4px rgba(0, 0, 0, 0.9), 0 1px 1px #000; }
.cm-vf-temp {
  position: absolute; left: calc(50% + 2.1em); top: calc(50% + 0.9em); font-size: 1.15em; font-weight: bold;
  color: #fff; font-family: ${MONO_FONT}; text-shadow: 0 0 3px #000, 0 1px 1px #000;
}
.cm-vf-scale { position: absolute; left: 3.2%; top: 24%; height: 52%; display: flex; gap: 0.35em; }
.cm-vf-scale-bar { width: 0.65em; height: 100%; background: ${IR_GRADIENT}; border: 1px solid rgba(255, 255, 255, 0.55); position: relative; }
.cm-vf-scale-mark {
  position: absolute; left: 100%; width: 0; height: 0; margin-top: -0.35em;
  border-top: 0.35em solid transparent; border-bottom: 0.35em solid transparent; border-left: 0.55em solid #fff;
  filter: drop-shadow(0 0 1px #000); transition: bottom 0.15s;
}
.cm-vf-scale-labels { display: flex; flex-direction: column; justify-content: space-between; font-family: ${MONO_FONT}; font-size: 0.7em; color: #fff; text-shadow: 0 1px 1px #000; margin-left: 0.7em; }
.cm-vf-zoom { position: absolute; left: 50%; bottom: 5%; transform: translateX(-50%); display: flex; align-items: flex-end; gap: 0.2em; font-family: ${MONO_FONT}; font-size: 0.82em; }
.cm-vf-zoom span { padding: 0.05em 0.45em; color: rgba(124, 255, 178, 0.42); border-bottom: 2px solid rgba(124, 255, 178, 0.22); }
.cm-vf-zoom span.cm-on { color: var(--osd); border-bottom-color: var(--osd); text-shadow: 0 0 5px rgba(124, 255, 178, 0.6); }
.cm-vf.cm-ir-on .cm-vf-zoom span { color: rgba(255, 255, 255, 0.5); border-bottom-color: rgba(255, 255, 255, 0.25); }
.cm-vf.cm-ir-on .cm-vf-zoom span.cm-on { color: #fff; border-bottom-color: #fff; }
.cm-vf-hint {
  position: absolute; left: 50%; bottom: 12.5%; transform: translateX(-50%); white-space: nowrap;
  padding: 0.12em 0.9em; color: var(--paper); font-size: 0.95em; letter-spacing: 0.08em;
  background: rgba(4, 6, 12, 0.62); border: 1px solid rgba(237, 230, 214, 0.35); border-radius: 2px;
  animation: cm-fadein 0.3s ease-out;
}
.cm-vf-panelhint { position: absolute; right: 5%; bottom: 5%; display: flex; flex-direction: column; align-items: flex-end; gap: 0.3em; }
.cm-vf-panelstatus { font-size: 1.05em; padding: 0.1em 0.6em; background: rgba(0, 0, 0, 0.45); }

/* ---------------------------------------------------------------- 回放 HUD（GDD M4、§10.2） */
.cm-rp .cm-frame { color: #efe9c9; }
.cm-rp-osd {
  position: absolute; left: 5%; top: 5%; font-family: ${MONO_FONT}; font-size: 1.12em; color: #f1ecd0; letter-spacing: 0.05em;
  text-shadow: 2px 0 0 rgba(255, 60, 60, 0.35), -2px 0 0 rgba(60, 200, 255, 0.35), 0 1px 2px #000;
}
.cm-rp-osd b { font-weight: bold; margin-right: 0.5em; }
.cm-rp-count { font-family: ${MONO_FONT}; font-size: 1.25em; color: #f1ecd0; letter-spacing: 0.1em; }
.cm-rp-bottom { position: absolute; left: 7%; right: 7%; bottom: 5.5%; }
.cm-rp-bar { position: relative; height: 0.42em; background: rgba(241, 236, 208, 0.18); border: 1px solid rgba(241, 236, 208, 0.4); }
.cm-rp-fill { position: absolute; left: 0; top: 0; bottom: 0; background: rgba(241, 236, 208, 0.75); }
.cm-rp-ticks { position: absolute; inset: 0; background: repeating-linear-gradient(90deg, transparent 0 calc(var(--tick) - 1px), rgba(0, 0, 0, 0.45) calc(var(--tick) - 1px) var(--tick)); }
.cm-rp-meta { display: flex; justify-content: space-between; align-items: baseline; margin-top: 0.35em; font-family: ${MONO_FONT}; font-size: 0.78em; color: rgba(241, 236, 208, 0.85); text-shadow: 0 1px 1px #000; }
.cm-rp-keys { margin: 0.4em auto 0; justify-content: center; width: fit-content; padding: 0.2em 0.9em; background: rgba(4, 6, 12, 0.6); text-shadow: 0 1px 1px #000; }

/* ---------------------------------------------------------------- 三脚架 HUD（GDD X2/X4、§10.2） */
.cm-tp .cm-frame { color: var(--osd); }
.cm-tp-osd { position: absolute; left: 5%; top: 5%; font-size: 0.98em; }
.cm-tp-timer { position: absolute; right: 5%; top: 5%; text-align: right; }
.cm-tp-timer .cm-osd { font-size: 1.8em; }
.cm-tp-timer small { display: block; font-size: 0.8em; color: var(--osd); opacity: 0.8; font-family: ${MONO_FONT}; }
.cm-tp-ring { position: absolute; left: 50%; top: 50%; width: 7em; height: 7em; transform: translate(-50%, -50%); }
.cm-tp-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.cm-tp-ring circle { fill: none; stroke-width: 5; }
.cm-tp-ring .cm-bg { stroke: rgba(237, 230, 214, 0.2); }
.cm-tp-ring .cm-fg { stroke: var(--paper); stroke-linecap: round; filter: drop-shadow(0 0 3px rgba(237, 230, 214, 0.7)); }
.cm-tp-still { position: absolute; left: 50%; top: calc(50% + 4.6em); transform: translateX(-50%); padding: 0.1em 0.9em; font-size: 1.15em; letter-spacing: 0.25em; background: rgba(4, 6, 12, 0.66); white-space: nowrap; }
.cm-tp-keys { position: absolute; left: 50%; bottom: 6%; transform: translateX(-50%); padding: 0.3em 0.9em; background: rgba(4, 6, 12, 0.6); }

/* ================================================================ 字幕、反馈条（#subs） */
.cm-subs {
  /* M4 整合：宽度两边各让出 14em（左下角时辰牌 2.2em + 约 8.5em、其上方的“得到：……”最宽 11.8em），长字幕/两行字幕不再压住它们 */
  /* M4 第 2 轮：窗口很窄（< 约 800px）时 calc(100% - 28em) 会把字幕挤成一条窄柱、竖着冲出上沿——宽度至少保留 60% */
  position: absolute; left: 50%; bottom: 7%; transform: translateX(-50%); width: min(92%, 58em, max(calc(100% - 28em), 60%));
  display: flex; flex-direction: column; align-items: center; gap: 0.35em; transition: bottom 0.2s;
}
.cm-ui.cm-dlg-open .cm-subs { bottom: calc(4.5% + 11em); }
.cm-ui.cm-replay-on .cm-subs { bottom: calc(5.5% + 5.2em); }
/* M1d：取景器的变焦刻度在画框底部 5%，字幕让到它上面 */
.cm-ui.cm-vf-on .cm-subs { bottom: calc(5% + 2.6em); }
.cm-sub {
  max-width: 100%; padding: 0.22em 0.95em; border-radius: 3px; text-align: center; line-height: 1.6;
  background: rgba(4, 6, 12, 0.7); color: var(--paper); text-shadow: 0 1px 1px rgba(0, 0, 0, 0.8);
  animation: cm-fadein 0.18s ease-out;
}
.cm-sub .cm-who { color: var(--tudi-gold); margin-right: 0.45em; }
.cm-sub.cm-narr { font-style: italic; color: #e2dccd; }
.cm-sub.cm-rec-only { color: var(--rec); font-family: ${MONO_FONT}; }
.cm-sub-0 .cm-sub, .cm-sub-0 .cm-dlg-text, .cm-sub-0 .cm-read-text { font-size: 1em; }
.cm-sub-1 .cm-sub, .cm-sub-1 .cm-dlg-text, .cm-sub-1 .cm-read-text { font-size: 1.18em; }
.cm-sub-2 .cm-sub, .cm-sub-2 .cm-dlg-text, .cm-sub-2 .cm-read-text { font-size: 1.42em; }
.cm-toasts { position: absolute; left: 50%; top: 64%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 0.4em; width: min(90%, 44em); }
.cm-toast { max-width: 100%; text-align: center; animation: cm-fadein 0.2s ease-out; transition: opacity 0.35s; }
.cm-toast.cm-leaving { opacity: 0; }
.cm-toast-feedback { padding: 0.28em 1.1em; background: rgba(4, 6, 12, 0.76); border-left: 2px solid var(--paper); border-right: 2px solid var(--paper); font-size: 1.02em; }
.cm-toast-tutorial { padding: 0.25em 1em; font-family: ${MONO_FONT}; color: var(--osd); background: rgba(4, 12, 8, 0.72); border: 1px solid rgba(124, 255, 178, 0.45); border-radius: 3px; letter-spacing: 0.04em; }
.cm-toasts-page { position: absolute; right: 2.2em; top: 2em; display: flex; flex-direction: column; align-items: flex-end; gap: 0.4em; }
.cm-toast-page {
  display: flex; align-items: center; gap: 0.6em; padding: 0.35em 0.9em 0.35em 0.6em;
  background: #ece4cf; color: var(--ink-old); font-family: ${HAND_FONT}; font-size: 1.02em;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.5); border-radius: 2px;
}
.cm-toast-page::before {
  content: ""; width: 1.1em; height: 1.35em; background:
    repeating-linear-gradient(to bottom, transparent 0 0.22em, rgba(35, 64, 142, 0.5) 0.22em 0.27em),
    #f7f1e1;
  border: 1px solid #6b5a3a; border-left: 3px solid #7a3b2e;
}
.cm-toasts-system { position: absolute; left: 50%; top: 2.2em; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 0.4em; }
.cm-toast-system { padding: 0.3em 1.1em; background: rgba(30, 18, 6, 0.88); color: #ffd9a0; border: 1px solid rgba(255, 154, 60, 0.6); border-radius: 2px; }

/* ---------------------------------------------------------------- 读字覆盖层（GDD §3.14：镜中字 scaleX(-1)） */
.cm-read { position: absolute; left: 50%; bottom: 17%; transform: translateX(-50%); max-width: min(88%, 50em); display: flex; flex-direction: column; align-items: center; }
.cm-read-box {
  padding: 0.45em 1.2em 0.55em; background: rgba(3, 10, 7, 0.82); border: 1px solid rgba(124, 255, 178, 0.5);
  box-shadow: 0 0 18px rgba(124, 255, 178, 0.12); animation: cm-fadein 0.2s ease-out;
}
.cm-read-tag { display: block; font-family: ${MONO_FONT}; font-size: 0.68em; color: var(--osd); letter-spacing: 0.2em; opacity: 0.75; margin-bottom: 0.15em; }
.cm-read-text { display: inline-block; white-space: pre-wrap; color: #f4fff8; line-height: 1.6; text-align: center; }
.cm-read-text.cm-mirror { transform: scaleX(-1); }
.cm-read-hint { padding: 0.2em 0.9em; background: rgba(4, 6, 12, 0.66); color: #c9ccd3; font-size: 0.95em; }

/* ================================================================ 对话框（ARCH §6.13） */
.cm-dlg {
  position: absolute; left: 50%; bottom: 4.5%; transform: translateX(-50%); width: min(92%, 52em); box-sizing: border-box;
  padding: 0.85em 1.5em 1em; pointer-events: auto;
  background: linear-gradient(to bottom, rgba(12, 15, 26, 0.93), rgba(6, 8, 15, 0.95));
  border: 1px solid var(--panel-line); border-top: 2px solid rgba(232, 195, 90, 0.6);
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.55); animation: cm-fadein 0.15s ease-out;
}
.cm-dlg-name { font-size: 0.92em; letter-spacing: 0.18em; color: var(--tudi-gold); margin-bottom: 0.25em; min-height: 1.2em; }
.cm-dlg-text { line-height: 1.75; min-height: 3.4em; white-space: pre-wrap; color: #f3eee2; }
.cm-dlg.cm-narr .cm-dlg-text { font-style: italic; color: #dcd6c7; }
.cm-dlg-rec { display: flex; align-items: center; gap: 0.5em; min-height: 3.4em; font-family: ${MONO_FONT}; font-size: 1.3em; color: var(--rec); font-weight: bold; letter-spacing: 0.1em; }
.cm-dlg-rec .cm-rec-dot { width: 0.7em; height: 0.7em; }
.cm-dlg-opts { margin-top: 0.55em; display: flex; flex-direction: column; gap: 0.15em; }
.cm-dlg-opt { display: flex; width: 100%; padding: 0.28em 0.7em; border-left: 2px solid transparent; line-height: 1.5; }
.cm-dlg-opt:hover { background: rgba(237, 230, 214, 0.08); border-left-color: var(--tudi-gold); }
.cm-dlg-opt .cm-k { flex: none; font-family: ${MONO_FONT}; color: var(--tudi-gold); margin-right: 0.8em; }
.cm-dlg-more { position: absolute; right: 1.2em; bottom: 0.55em; color: var(--tudi-gold); font-size: 0.85em; animation: cm-bob 1.2s ease-in-out infinite; }

/* ================================================================ 动作菜单（mode.album 的 menu 子状态） */
.cm-amenu {
  position: absolute; left: 50%; top: 57%; transform: translateX(-50%); min-width: 13em; pointer-events: auto;
  padding: 0.35em 0 0.45em; background: var(--panel-bg); border: 1px solid rgba(237, 230, 214, 0.28);
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.55); animation: cm-fadein 0.12s ease-out;
}
.cm-amenu-title { padding: 0.2em 1.1em 0.4em; font-size: 0.84em; color: var(--dim); border-bottom: 1px solid var(--panel-line); margin-bottom: 0.25em; letter-spacing: 0.08em; }
.cm-amenu-item { display: block; width: 100%; padding: 0.35em 1.1em; font-size: 1.05em; }
.cm-amenu-item:hover { background: rgba(237, 230, 214, 0.1); color: #fff; }
.cm-amenu .cm-keyhints { padding: 0.35em 1.1em 0; }

/* ================================================================ 相册与物品栏（GDD §10.3），兼作挑选器 */
.cm-backdrop { position: absolute; inset: 0; isolation: isolate; pointer-events: auto; background: rgba(3, 4, 8, 0.72); display: flex; align-items: center; justify-content: center; animation: cm-fadein 0.15s ease-out; }
.cm-album-sheet {
  position: relative; box-sizing: border-box; width: min(95%, 66em); height: min(92%, 39em);
  display: grid; grid-template-columns: minmax(0, 1fr) 15.5em; grid-template-rows: auto minmax(0, 1fr) auto; gap: 0.7em 1.3em;
  padding: 1.1em 1.4em 1em; border-radius: 4px;
  background:
    radial-gradient(ellipse at 30% 20%, rgba(255, 255, 255, 0.035), transparent 60%),
    repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.012) 0 2px, transparent 2px 5px),
    #1b1814;
  border: 1px solid #3a3226; box-shadow: 0 16px 50px rgba(0, 0, 0, 0.7), inset 0 0 60px rgba(0, 0, 0, 0.5);
}
.cm-album-head { grid-column: 1 / 3; display: flex; align-items: baseline; justify-content: space-between; gap: 1em; border-bottom: 1px solid rgba(237, 230, 214, 0.12); padding-bottom: 0.45em; }
.cm-album-tabs { display: flex; gap: 1.4em; font-size: 1.1em; letter-spacing: 0.2em; }
.cm-album-tabs span { color: rgba(237, 230, 214, 0.45); }
.cm-album-tabs span.cm-on { color: var(--paper); border-bottom: 2px solid var(--tudi-gold); }
.cm-album-pickfor { color: var(--tudi-gold); font-size: 1em; letter-spacing: 0.06em; }
.cm-album-page { font-family: ${MONO_FONT}; font-size: 0.8em; color: var(--dim); }
.cm-album-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-template-rows: repeat(3, minmax(0, 1fr)); gap: 0.75em 0.9em; min-height: 0; }
.cm-photo {
  position: relative; display: flex; flex-direction: column; min-height: 0; padding: 0.3em 0.3em 0.2em;
  background: #0f0d0b; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
}
.cm-photo::before, .cm-photo::after { content: ""; position: absolute; width: 0.7em; height: 0.7em; background: #2c261e; z-index: 1; }
.cm-photo::before { left: -0.15em; top: -0.15em; clip-path: polygon(0 0, 100% 0, 0 100%); }
.cm-photo::after { right: -0.15em; bottom: 1.5em; clip-path: polygon(100% 0, 100% 100%, 0 100%); }
.cm-photo-img { flex: 1 1 auto; min-height: 0; background: #262320 center / cover no-repeat; }
.cm-photo-img.cm-noimg { background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.05) 0 1px, transparent 1px 3px), radial-gradient(circle at 50% 45%, #3b3a33, #1a1916 70%); }
.cm-photo-title { flex: none; font-size: 0.74em; line-height: 1.5; margin-top: 0.2em; color: #d9d2c2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cm-photo.cm-empty .cm-photo-title { color: #8f8a80; }
.cm-photo.cm-print { background: #f2ecdf; padding: 0.4em 0.4em 0.25em; transform: rotate(-0.7deg); }
.cm-photo.cm-print .cm-photo-title { color: #3a342a; }
.cm-photo-key { position: absolute; right: 0.3em; top: 0.3em; width: 0; height: 0; border-left: 0.9em solid transparent; border-top: 0.9em solid var(--rec); filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.8)); z-index: 2; }
.cm-photo.cm-hover { outline: 2px solid rgba(237, 230, 214, 0.55); outline-offset: 2px; }
.cm-photo.cm-sel { outline: 2px solid var(--tudi-gold); outline-offset: 2px; }
.cm-photo-blank { background: rgba(255, 255, 255, 0.025); border: 1px dashed rgba(237, 230, 214, 0.08); }
.cm-items { display: flex; flex-direction: column; gap: 0.35em; min-height: 0; overflow-y: auto; padding-right: 0.2em; }
.cm-items-title { font-size: 1.1em; letter-spacing: 0.2em; color: rgba(237, 230, 214, 0.45); }
.cm-items-title.cm-on { color: var(--paper); }
.cm-item {
  position: relative; display: flex; align-items: center; justify-content: space-between; gap: 0.5em;
  padding: 0.38em 0.7em; background: rgba(237, 230, 214, 0.06); border-left: 3px solid rgba(237, 230, 214, 0.25);
}
.cm-item-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cm-item-doc { font-size: 0.72em; color: var(--dim); margin-left: 0.3em; }
.cm-item-used { flex: none; font-size: 0.72em; padding: 0 0.4em; color: #7a3b2e; border: 1.5px solid #b0503c; border-radius: 2px; transform: rotate(-6deg); background: rgba(237, 230, 214, 0.9); font-weight: bold; }
.cm-item.cm-used .cm-item-name { color: #b8b2a4; }
.cm-item.cm-hover { background: rgba(237, 230, 214, 0.12); }
.cm-item.cm-sel { border-left-color: var(--tudi-gold); background: rgba(232, 195, 90, 0.14); }
.cm-items-empty, .cm-album-empty { color: #7d786e; font-size: 0.9em; font-style: italic; }
.cm-album-empty { grid-column: 1 / 5; grid-row: 1 / 4; display: flex; align-items: center; justify-content: center; }
.cm-album-foot { grid-column: 1 / 3; display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5em; border-top: 1px solid rgba(237, 230, 214, 0.12); padding-top: 0.45em; min-height: 2.8em; }
.cm-album-detail { min-width: 0; }
.cm-album-detail b { font-weight: normal; color: #fff; margin-right: 0.8em; }
.cm-album-detail span { color: var(--dim); font-size: 0.9em; }

/* ================================================================ 巡夜本（GDD §10.3、M9） */
.cm-book {
  position: relative; box-sizing: border-box; width: min(95%, 68em); height: min(84%, 40em); margin-bottom: 1.6em;
  display: grid; grid-template-columns: 1fr 1fr; padding: 0.7em; border-radius: 5px;
  background: linear-gradient(90deg, #3a2a1c, #4a3522 49%, #2a1d12 50%, #4a3522 51%, #3a2a1c); box-shadow: 0 18px 60px rgba(0, 0, 0, 0.75);
}
.cm-page {
  position: relative; box-sizing: border-box; min-height: 0; overflow-y: auto; padding: 1.2em 1.6em 1.4em 2.6em;
  color: #2a2620; font-family: ${HAND_FONT}; --lh: 1.9em; line-height: var(--lh);
  background:
    linear-gradient(90deg, transparent 1.9em, rgba(179, 0, 27, 0.35) 1.9em, rgba(179, 0, 27, 0.35) calc(1.9em + 1px), transparent calc(1.9em + 1px)),
    repeating-linear-gradient(to bottom, transparent 0 calc(var(--lh) - 1px), rgba(70, 100, 150, 0.22) calc(var(--lh) - 1px) var(--lh)),
    radial-gradient(ellipse at 60% 40%, #f4eedd, #e7ddc4 85%);
  background-attachment: local;
}
.cm-page-l { border-radius: 3px 0 0 3px; box-shadow: inset -16px 0 22px -14px rgba(60, 40, 10, 0.55); }
.cm-page-r { border-radius: 0 3px 3px 0; box-shadow: inset 16px 0 22px -14px rgba(60, 40, 10, 0.55); }
.cm-page-title { font-family: ${SERIF_FONT}; font-size: 1.15em; letter-spacing: 0.35em; color: #5a4a30; line-height: var(--lh); margin: 0; }
.cm-page-sub { font-family: ${UI_FONT}; font-size: 0.72em; color: #8a7a60; letter-spacing: 0.1em; line-height: var(--lh); }
.cm-log-entry { margin: 0; white-space: pre-wrap; }
.cm-ink-old { color: var(--ink-old); text-shadow: 0 0 0.6px rgba(35, 64, 142, 0.55); }
.cm-ink-wet {
  color: var(--ink-wet); font-weight: 600;
  background: linear-gradient(105deg, var(--ink-wet) 0%, var(--ink-wet) 45%, #4a5f94 50%, var(--ink-wet) 55%, var(--ink-wet) 100%);
  background-size: 300% 100%; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  animation: cm-wet 6s linear infinite; filter: drop-shadow(0 0 0.5px rgba(13, 23, 51, 0.8));
}
@keyframes cm-wet { from { background-position: 100% 0; } to { background-position: -50% 0; } }
.cm-log-new-mark { font-family: ${UI_FONT}; font-size: 0.7em; color: #b3001b; margin-right: 0.4em; -webkit-text-fill-color: #b3001b; }
.cm-page-r h4 { margin: 0; font-family: ${SERIF_FONT}; font-weight: normal; font-size: 1em; letter-spacing: 0.3em; color: #5a4a30; line-height: var(--lh); border-bottom: 1px solid rgba(90, 74, 48, 0.35); }
.cm-page-r ul { list-style: none; margin: 0 0 var(--lh); padding: 0; }
.cm-page-r li { line-height: var(--lh); }
.cm-name-text { color: var(--ink-old); font-size: 1.08em; margin-right: 0.5em; }
.cm-name-src { font-family: ${UI_FONT}; font-size: 0.72em; color: #6f6452; }
.cm-clue { font-family: ${UI_FONT}; font-size: 0.86em; color: #3b352b; }
.cm-clue::before { content: "· "; color: #8a7a60; }
.cm-page-empty { font-family: ${UI_FONT}; font-size: 0.8em; color: #9a8f7a; font-style: italic; }
.cm-ants { font-size: 1.2em; color: #3b2c18; letter-spacing: 0.08em; }
.cm-book-foot { position: absolute; left: 50%; bottom: -2.1em; transform: translateX(-50%); }

/* ================================================================ 文档阅读器（ARCH §6.16） */
.cm-doc-wrap { position: relative; max-width: min(90%, 42em); max-height: 80%; display: flex; margin-bottom: 1.4em; }
.cm-doc {
  position: relative; box-sizing: border-box; overflow-y: auto; padding: 1.6em 2em 1.8em; min-width: 18em;
  background: #f1ebdc; color: #25211b; font-family: ${SERIF_FONT}; line-height: 1.85;
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.7); border-radius: 2px;
}
.cm-doc-title { font-family: ${UI_FONT}; font-size: 0.78em; letter-spacing: 0.2em; color: #7c705c; margin-bottom: 0.8em; border-bottom: 1px solid rgba(124, 112, 92, 0.3); padding-bottom: 0.3em; }
.cm-doc-body { white-space: pre-wrap; font-size: 1.05em; line-height: 1.85em; }
/* 横格纸：格线画在正文自己的背景上，周期 = 正文行高，所以线总落在每行字下面 */
.cm-doc-ballpoint .cm-doc-body, .cm-doc-wet_ink .cm-doc-body, .cm-doc-letter .cm-doc-body {
  background: repeating-linear-gradient(to bottom, transparent 0 calc(1.85em - 1px), var(--rule) calc(1.85em - 1px) 1.85em);
}
.cm-doc-ballpoint, .cm-doc-wet_ink { font-family: ${HAND_FONT}; background: #f3edde; --rule: rgba(70, 100, 150, 0.25); }
.cm-doc-ballpoint .cm-doc-body { color: var(--ink-old); }
.cm-doc-wet_ink .cm-doc-body { color: var(--ink-wet); }
.cm-doc-print .cm-doc-body { font-size: 1em; }
.cm-doc-notice { background: #efe9dc; border-top: 0.5em solid #7a3b2e; }
.cm-doc-notice .cm-doc-body::first-line { font-size: 1.3em; letter-spacing: 0.4em; }
.cm-doc-slip { background: #e9e0cb; font-family: ${UI_FONT}; border: 1px dashed #9c8c6c; }
.cm-doc-slip .cm-doc-body { font-size: 0.98em; }
.cm-doc-letter { font-family: ${HAND_FONT}; background: #f4efe2; --rule: rgba(179, 0, 27, 0.22); }
.cm-doc-ticket { background: linear-gradient(135deg, #cfe1ea, #aecbd8); color: #1e2a33; font-family: ${MONO_FONT}; border-radius: 6px; }
.cm-doc-book { background: #e3d3ad; color: #3a2e1a; box-shadow: inset 0 0 40px rgba(110, 80, 30, 0.45), 0 14px 44px rgba(0, 0, 0, 0.7); }
.cm-doc-plaque { background: linear-gradient(160deg, #3a2c1c, #22190f); color: #e8c35a; border: 3px double #8a6a36; text-align: center; letter-spacing: 0.25em; }
.cm-doc-plaque .cm-doc-title { color: #b39a64; }
.cm-stain {
  display: inline-block; width: 1.05em; height: 1.05em; vertical-align: -0.15em; border-radius: 45% 55% 50% 48%;
  background: radial-gradient(circle at 45% 45%, rgba(92, 78, 52, 0.55), rgba(120, 100, 64, 0.35) 45%, rgba(160, 135, 90, 0.15) 70%, transparent 72%);
  box-shadow: 0 0 0.25em rgba(120, 100, 64, 0.25);
}
.cm-covered {
  display: inline; padding: 0.1em 0.2em; color: transparent; border-radius: 1px;
  background: repeating-linear-gradient(-45deg, #d9d2c0 0 0.4em, #cfc6b0 0.4em 0.8em);
  box-shadow: 0 0 0 0.15em #cfc6b0; -webkit-box-decoration-break: clone; box-decoration-break: clone;
}
.cm-covered-note { display: block; font-family: ${UI_FONT}; font-size: 0.72em; color: #8a7d64; margin-top: 0.4em; }
.cm-doc-vf .cm-doc { filter: saturate(0.75) contrast(1.05); }
.cm-doc-vf .cm-faded { color: #0a7a4a; text-shadow: 0 0 6px rgba(124, 255, 178, 0.9); -webkit-text-fill-color: #0a7a4a; }
.cm-doc-scan {
  position: absolute; inset: 0; pointer-events: none; mix-blend-mode: multiply;
  background: repeating-linear-gradient(to bottom, rgba(20, 60, 40, 0.0) 0 2px, rgba(20, 60, 40, 0.16) 2px 3px);
  box-shadow: inset 0 0 70px rgba(10, 60, 30, 0.45);
}
.cm-doc-osd { position: absolute; left: 0; right: 0; top: -1.8em; display: flex; justify-content: space-between; gap: 0.8em; font-size: 0.9em; white-space: nowrap; }
.cm-doc-foot { position: absolute; left: 50%; bottom: -2.1em; transform: translateX(-50%); white-space: nowrap; }

/* ================================================================ 面板：密码转轮锁、称呼（ARCH §6.15） */
.cm-lock {
  position: relative; padding: 1.3em 1.8em 1.2em; text-align: center; pointer-events: auto;
  background: linear-gradient(160deg, #6b5226, #3d2d12 60%, #2a1f0d); border: 2px solid #a8843f; border-radius: 10px;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 230, 160, 0.35), inset 0 -8px 20px rgba(0, 0, 0, 0.4);
  color: #f5e6c0;
}
.cm-lock.cm-shake { animation: cm-shake 0.4s ease-in-out; }
.cm-lock-title { font-size: 0.95em; letter-spacing: 0.25em; color: #f0d890; margin-bottom: 0.8em; }
.cm-wheels { display: flex; justify-content: center; gap: 0.45em; margin-bottom: 0.9em; }
.cm-wheel {
  width: 2.3em; height: 3.4em; display: flex; flex-direction: column; align-items: center; justify-content: space-between;
  border-radius: 4px; overflow: hidden;
  background: linear-gradient(to bottom, #1b140a, #d8c291 22%, #f6ead0 50%, #d8c291 78%, #1b140a);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6), 0 2px 3px rgba(0, 0, 0, 0.6);
}
.cm-wheel span { font-family: ${MONO_FONT}; color: #2a1f0d; line-height: 1; }
.cm-wheel .cm-ghost { font-size: 0.75em; opacity: 0.35; }
.cm-wheel .cm-cur { font-size: 1.6em; font-weight: bold; }
.cm-wheel.cm-active { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.6), 0 0 0 2px #ffd46b, 0 0 12px rgba(255, 212, 107, 0.6); }
.cm-keypad { display: grid; grid-template-columns: repeat(5, 2.1em); gap: 0.3em; justify-content: center; margin-bottom: 0.7em; }
.cm-keypad button, .cm-lock-actions button {
  padding: 0.15em 0; border-radius: 3px; background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(240, 216, 144, 0.35);
  font-family: ${MONO_FONT}; color: #f5e6c0; text-align: center;
}
.cm-keypad button:hover, .cm-lock-actions button:hover { background: rgba(240, 216, 144, 0.2); }
.cm-lock-actions { display: flex; justify-content: center; gap: 0.5em; margin-bottom: 0.6em; }
.cm-lock-actions button { padding: 0.15em 0.9em; font-family: ${UI_FONT}; }
.cm-lock-fails { font-size: 0.8em; color: #e8b070; min-height: 1.3em; }
.cm-lock .cm-keyhints { justify-content: center; color: #d8c79f; }

.cm-slip {
  position: relative; width: min(90%, 30em); box-sizing: border-box; pointer-events: auto;
  padding: 1.2em 1.6em 1em; background: #efe6cf; color: #2c261c; border-radius: 2px;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.7); border-top: 0.4em solid #b3001b;
}
.cm-slip-head { font-family: ${SERIF_FONT}; font-size: 1.05em; letter-spacing: 0.08em; padding-bottom: 0.6em; border-bottom: 1px dashed #9c8c6c; margin-bottom: 0.6em; white-space: pre-wrap; }
.cm-slip-list { display: flex; flex-direction: column; gap: 0.15em; }
.cm-slip-opt { display: flex; align-items: baseline; width: 100%; padding: 0.25em 0.5em; border-left: 3px solid transparent; font-size: 1.1em; }
.cm-slip-opt:hover { background: rgba(179, 0, 27, 0.08); border-left-color: #b3001b; }
.cm-slip-opt .cm-k { font-family: ${MONO_FONT}; color: #b3001b; margin-right: 0.9em; font-size: 0.85em; }
.cm-slip-opt .cm-name { font-family: ${HAND_FONT}; color: var(--ink-old); }
.cm-slip .cm-keyhints { margin-top: 0.8em; color: #6f6452; }
.cm-slip .cm-kbd { color: #2c261c; border-color: rgba(44, 38, 28, 0.5); background: rgba(44, 38, 28, 0.06); }

/* ================================================================ 录像机面板与监控台（GDD M6/M7、§10.2） */
.cm-deck {
  position: absolute; left: 50%; bottom: 2.5%; transform: translateX(-50%); width: min(94%, 54em); box-sizing: border-box;
  pointer-events: auto; padding: 0.7em 1.1em 0.6em; border-radius: 6px;
  background: linear-gradient(to bottom, #2a2c30, #1a1b1e 40%, #121315);
  border: 1px solid #45474d; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  color: #d7d9dd; transition: opacity 0.2s;
}
.cm-deck.cm-dim { opacity: 0.55; }
.cm-deck-row { display: flex; align-items: center; gap: 0.9em; }
.cm-vfd {
  flex: none; min-width: 11.5em; padding: 0.2em 0.7em; border-radius: 3px; background: #04120d; border: 1px solid #0e2a20;
  font-family: ${MONO_FONT}; color: #7cffe0; text-shadow: 0 0 6px rgba(124, 255, 224, 0.75); box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.8);
}
.cm-vfd-date { font-size: 0.7em; opacity: 0.8; display: block; }
.cm-vfd-tc { font-size: 1.35em; letter-spacing: 0.06em; }
.cm-vfd-state { font-size: 0.8em; margin-left: 0.4em; }
.cm-transport { display: flex; gap: 0.3em; }
.cm-transport button {
  min-width: 2.4em; padding: 0.25em 0.45em; border-radius: 3px; text-align: center; font-family: ${MONO_FONT};
  background: linear-gradient(#3b3e44, #26282c); border: 1px solid #55585f; color: #e4e6ea; box-shadow: 0 2px 0 #0b0c0d;
}
.cm-transport button:hover { background: linear-gradient(#4a4e55, #2e3035); }
.cm-transport button.cm-on { color: #7cffe0; text-shadow: 0 0 5px rgba(124, 255, 224, 0.8); }
.cm-lamps { display: flex; gap: 0.5em; margin-left: auto; font-family: ${MONO_FONT}; font-size: 0.82em; }
.cm-lamp { padding: 0.05em 0.5em; border-radius: 2px; border: 1px solid #3a3c41; color: #4b4e55; }
.cm-lamp.cm-slow.cm-on { color: #ffd43b; border-color: #ffd43b; text-shadow: 0 0 6px rgba(255, 212, 59, 0.8); }
.cm-lamp.cm-alarm.cm-on { color: #ff4040; border-color: #ff4040; text-shadow: 0 0 6px rgba(255, 64, 64, 0.8); }
.cm-lamp.cm-blinkoff { opacity: 0.3; }
.cm-index { position: relative; height: 2.5em; margin: 0.65em 0.3em 0.2em; }
.cm-index-bar { position: absolute; left: 0; right: 0; top: 0.2em; height: 0.35em; background: #0b0c0e; border: 1px solid #3d4046; }
.cm-index-slow { position: absolute; top: 0; bottom: 0; background: rgba(255, 212, 59, 0.45); }
.cm-index-alarm { position: absolute; top: 0; bottom: 0; right: 0; background: rgba(255, 64, 64, 0.12); }
.cm-index-tick { position: absolute; top: -0.1em; width: 1px; height: 0.95em; background: #c8cad0; }
.cm-index-lbl { position: absolute; top: 0.95em; transform: translateX(-50%); font-family: ${MONO_FONT}; font-size: 0.62em; color: #8d9098; white-space: nowrap; }
.cm-index-head { position: absolute; top: -0.35em; width: 0; height: 0; margin-left: -0.35em; border-left: 0.35em solid transparent; border-right: 0.35em solid transparent; border-top: 0.55em solid #7cffe0; filter: drop-shadow(0 0 3px rgba(124, 255, 224, 0.9)); }
.cm-deck .cm-keyhints { margin-top: 0.35em; }
.cm-deck .cm-kbd { color: #d7d9dd; }
.cm-ch { display: flex; gap: 0.35em; }
.cm-ch button {
  padding: 0.3em 0.7em; border-radius: 3px; text-align: left; line-height: 1.25;
  background: linear-gradient(#34373c, #222428); border: 1px solid #505359; box-shadow: 0 2px 0 #0b0c0d;
}
.cm-ch button b { display: block; font-family: ${MONO_FONT}; font-size: 0.95em; color: #e4e6ea; }
.cm-ch button small { font-size: 0.72em; color: #9a9da5; }
.cm-ch button.cm-on { border-color: var(--osd); box-shadow: 0 0 0 1px var(--osd), 0 0 10px rgba(124, 255, 178, 0.4); }
.cm-ch button.cm-on b { color: var(--osd); text-shadow: 0 0 5px rgba(124, 255, 178, 0.7); }
.cm-jack { display: flex; align-items: center; gap: 0.45em; margin-left: auto; font-size: 0.85em; color: #9a9da5; white-space: nowrap; }
.cm-jack-led { width: 0.6em; height: 0.6em; border-radius: 50%; background: #3a1010; box-shadow: inset 0 0 2px #000; }
.cm-jack.cm-on .cm-jack-led { background: var(--osd); box-shadow: 0 0 6px var(--osd); }
.cm-jack.cm-on { color: #d7d9dd; }

/* ================================================================ 标题 / 暂停 / 设置菜单（ARCH §3.1、§7） */
.cm-menu-screen { position: absolute; inset: 0; pointer-events: auto; animation: cm-fadein 0.25s ease-out; }
.cm-title-bg {
  position: absolute; inset: 0; overflow: hidden;
  background: radial-gradient(ellipse at 70% 110%, rgba(255, 154, 60, 0.22), transparent 55%), radial-gradient(ellipse at 20% 0%, #1a2238, var(--night) 70%);
}
.cm-title-rain {
  position: absolute; inset: -20% -10%;
  background: repeating-linear-gradient(100deg, transparent 0 13px, rgba(157, 184, 200, 0.07) 13px 14px);
  animation: cm-rain 0.6s linear infinite;
}
@keyframes cm-rain { from { transform: translate(0, -28px); } to { transform: translate(-5px, 0); } }
.cm-scanlines { position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(to bottom, rgba(0, 0, 0, 0) 0 2px, rgba(0, 0, 0, 0.22) 2px 3px); }
.cm-vignette { position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 18vmin rgba(0, 0, 0, 0.85); }
.cm-title-osd { position: absolute; left: 5%; top: 5%; display: flex; gap: 0.8em; align-items: center; font-size: 0.95em; }
.cm-title-block { position: absolute; left: 9%; top: 26%; }
.cm-title-name { font-size: 3.1em; letter-spacing: 0.32em; color: #f4efe4; font-weight: 300; text-shadow: 0 0 22px rgba(237, 230, 214, 0.25), 0 2px 3px rgba(0, 0, 0, 0.8); }
.cm-title-sub { margin-top: 0.4em; font-family: ${MONO_FONT}; color: var(--osd); letter-spacing: 0.3em; opacity: 0.85; }
.cm-menu-list { position: absolute; left: 9%; top: 56%; display: flex; flex-direction: column; gap: 0.35em; min-width: 12em; }
.cm-menu-item { display: flex; align-items: center; padding: 0.2em 0.4em; font-size: 1.25em; letter-spacing: 0.25em; color: rgba(237, 230, 214, 0.72); }
.cm-menu-item::before { content: "▶"; font-size: 0.55em; width: 1.8em; color: var(--rec); opacity: 0; transition: opacity 0.12s; }
.cm-menu-item:hover, .cm-menu-item.cm-sel { color: #fff; }
.cm-menu-item:hover::before, .cm-menu-item.cm-sel::before { opacity: 1; }
.cm-menu-foot { position: absolute; right: 5%; bottom: 5%; font-family: ${MONO_FONT}; font-size: 0.72em; color: rgba(237, 230, 214, 0.35); letter-spacing: 0.1em; }
.cm-pause-bg { position: absolute; inset: 0; background: rgba(4, 6, 12, 0.72); }
.cm-pause-title { position: absolute; left: 9%; top: 30%; font-size: 2.2em; letter-spacing: 0.5em; color: var(--paper); }
.cm-pause-title small { display: block; margin-top: 0.3em; font-size: 0.36em; letter-spacing: 0.2em; font-family: ${MONO_FONT}; color: var(--osd); }
.cm-settings {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(94%, 58em); max-height: 90%; overflow-y: auto; box-sizing: border-box;
  padding: 1em 1.6em 1em; background: #080b14; border: 1px solid var(--panel-line); box-shadow: 0 16px 50px rgba(0, 0, 0, 0.7);
}
.cm-settings-body { display: grid; grid-template-columns: repeat(auto-fit, minmax(19em, 1fr)); column-gap: 2.4em; }
.cm-settings h2 { margin: 0 0 0.6em; font-weight: normal; font-size: 1.25em; letter-spacing: 0.4em; }
.cm-set-row { display: flex; align-items: center; justify-content: space-between; gap: 1em; padding: 0.3em 0; border-bottom: 1px solid rgba(237, 230, 214, 0.07); }
.cm-set-label { color: #dcd6c8; }
.cm-seg { display: flex; border: 1px solid rgba(237, 230, 214, 0.25); border-radius: 3px; overflow: hidden; }
.cm-seg button { padding: 0.12em 0.8em; color: var(--dim); }
.cm-seg button + button { border-left: 1px solid rgba(237, 230, 214, 0.18); }
.cm-seg button.cm-on { background: rgba(232, 195, 90, 0.2); color: #fff; }
.cm-seg button:hover { color: #fff; }
.cm-slider { display: flex; align-items: center; gap: 0.5em; }
.cm-slider button.cm-step { width: 1.6em; text-align: center; border: 1px solid rgba(237, 230, 214, 0.25); border-radius: 3px; color: var(--dim); }
.cm-slider button.cm-step:hover { color: #fff; }
.cm-slider-track { position: relative; width: 7em; height: 0.5em; background: rgba(237, 230, 214, 0.12); border-radius: 3px; cursor: pointer; pointer-events: auto; }
.cm-slider-fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--tudi-gold); border-radius: 3px; }
.cm-slider-val { width: 3.2em; text-align: right; font-family: ${MONO_FONT}; font-size: 0.85em; color: var(--dim); }
.cm-settings-foot { margin-top: 0.9em; display: flex; justify-content: flex-end; }
.cm-btn { padding: 0.2em 1.2em; border: 1px solid rgba(237, 230, 214, 0.35); border-radius: 3px; letter-spacing: 0.2em; }
.cm-btn:hover { background: rgba(237, 230, 214, 0.1); }
.cm-licenses { height: 90%; display: flex; flex-direction: column; overflow: hidden; }
.cm-licenses h2, .cm-licenses-foot { flex-shrink: 0; }
.cm-licenses-body {
  flex: 1; min-height: 0; margin: 0; padding-right: 0.6em; overflow-y: auto; overscroll-behavior: contain;
  white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.65;
}
.cm-licenses-foot { align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.6em; }

/* ================================================================ “点击继续”（ARCH §4.6） */
.cm-gate { position: absolute; inset: 0; pointer-events: auto; cursor: pointer; display: flex; align-items: center; justify-content: center; background: rgba(4, 6, 12, 0.45); animation: cm-fadein 0.2s ease-out; }
.cm-gate-box { display: flex; align-items: center; gap: 0.7em; padding: 0.55em 1.5em; background: rgba(4, 6, 12, 0.8); border: 1px solid rgba(237, 230, 214, 0.35); font-size: 1.2em; letter-spacing: 0.3em; }

/* ================================================================ #fade：淡黑、白闪、时辰字样、载入中 */
.cm-fade-black, .cm-fade-white { position: absolute; inset: 0; opacity: 0; }
.cm-fade-black { background: #000; }
.cm-fade-white { background: #fff; }
.cm-fade-title { position: absolute; left: 50%; top: 44%; transform: translate(-50%, -50%); text-align: center; opacity: 0; white-space: nowrap; }
.cm-fade-title-main { font-size: 2.8em; letter-spacing: 0.55em; margin-right: -0.55em; color: #f4efe4; text-shadow: 0 0 24px rgba(237, 230, 214, 0.35), 0 2px 4px rgba(0, 0, 0, 0.9); }
.cm-fade-title-sub { margin-top: 0.5em; font-size: 1em; letter-spacing: 0.3em; color: rgba(237, 230, 214, 0.75); text-shadow: 0 1px 2px #000; }
.cm-loading { position: absolute; right: 4%; bottom: 5%; font-family: ${MONO_FONT}; color: var(--osd); letter-spacing: 0.2em; text-shadow: 0 0 6px rgba(124, 255, 178, 0.6); }
.cm-loading::before { content: ""; display: inline-block; width: 0.55em; height: 0.55em; margin-right: 0.6em; border-radius: 50%; background: var(--rec); animation: cm-bob 1s ease-in-out infinite; }
/* ================================================================ 拍照反馈（M1c：GDD M2 右下角飞入缩略图） */
.cm-phototoast { position: absolute; left: calc(var(--fx) + var(--fw) - 1.6em - min(24vmin, 13em)); top: calc(var(--fy) + var(--fh) - 5.2em - min(18vmin, 9.75em)); width: min(24vmin, 13em); transition: opacity 0.45s; }
.cm-phototoast.cm-leaving { opacity: 0; }
.cm-phototoast.cm-suppressed { visibility: hidden; }
/* M1d：面板上叠取景器时右下角是录像机/监控台状态行，缩略图让到它上面 */
.cm-ui.cm-vf-panel .cm-phototoast { top: calc(var(--fy) + var(--fh) - 7.4em - min(18vmin, 9.75em)); }
.cm-phototoast-card { position: relative; padding: 0.35em 0.35em 0.3em; background: #ece6d8; box-shadow: 0 0.3em 1.2em rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(0, 0, 0, 0.4); transform-origin: 50% 50%; }
.cm-phototoast-img { width: 100%; aspect-ratio: 4 / 3; background: #10131c center / cover no-repeat; }
.cm-phototoast-img.cm-noimg { background: repeating-linear-gradient(135deg, #1a1e2a 0 6px, #141824 6px 12px); }
.cm-phototoast-title { margin-top: 0.3em; font-size: 0.78em; line-height: 1.35; color: #2a2419; text-align: center; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.cm-phototoast.cm-key .cm-phototoast-card::after { content: ""; position: absolute; right: -0.25em; top: -0.25em; width: 0.7em; height: 0.7em; border-radius: 50%; background: var(--rec); box-shadow: 0 0 0.4em rgba(255, 60, 60, 0.7); }

/* ================================================================ M4 打磨：分层避让（对话框/字幕/反馈条/读字/照片卡片/取景器角标） */
/* 对话框打开：字幕排在对话框上沿之上（--cm-dlg-h 由 UI 每帧写入对话框实际高度，含选项）；反馈条再往上（--cm-subs-h 同理）；
   照片卡片抬到对话框上沿之上。选择器写得比 .cm-vf-on / .cm-replay-on 的同类规则更具体，取景器里和阴物说话时也生效 */
.cm-ui.cm-dlg-open .cm-subs, .cm-ui.cm-dlg-open.cm-vf-on .cm-subs, .cm-ui.cm-dlg-open.cm-replay-on .cm-subs {
  bottom: calc(4.5% + var(--cm-dlg-h, 11em) + 0.6em);
}
.cm-ui.cm-dlg-open .cm-toasts, .cm-ui.cm-dlg-open.cm-vf-on .cm-toasts {
  top: auto; bottom: calc(4.5% + var(--cm-dlg-h, 11em) + 1em + var(--cm-subs-h, 0px));
}
.cm-ui.cm-dlg-open .cm-phototoast, .cm-ui.cm-dlg-open.cm-vf-panel .cm-phototoast {
  top: auto; bottom: calc(4.5% + var(--cm-dlg-h, 11em) + 0.8em);
}
/* 取景器（不在对话里）：底部从下往上依次是倍率条 → 操作提示行 → 读字框 → 字幕；反馈条/教学条挪到画框上部（OSD 行之下、准星之上） */
/* M4 第 2 轮：按 4:3 画框算（窄而高的窗口里画框上下有黑边，按视口算的 5% 会压到画框底部的倍率条与按键行上）；16:9 时与原来相同 */
.cm-ui.cm-vf-on .cm-subs { bottom: calc(100% - var(--fy) - var(--fh) + var(--fh) * 0.05 + 3.4em); }
.cm-ui.cm-vf-on.cm-read-on .cm-subs { bottom: calc(100% - var(--fy) - var(--fh) + var(--fh) * 0.05 + 3.9em + var(--cm-read-h, 4em)); }
.cm-ui.cm-vf-on .cm-read { bottom: calc(100% - var(--fy) - var(--fh) + var(--fh) * 0.05 + 3.4em); }
.cm-ui.cm-vf-on .cm-toasts { top: calc(var(--fy) + var(--fh) * 0.15); }
.cm-ui.cm-vf-on.cm-read-on .cm-vf-hint { bottom: calc(5% + 3.9em + var(--cm-read-h, 4em)); }
/* “巡夜本上多了一行字”：取景器里挪进画框、镜头/倍率那一行下面，不再盖住“常光/红外 1×” */
.cm-ui.cm-vf-on .cm-toasts-page { top: calc(var(--fy) + var(--fh) * 0.05 + 2.3em); right: calc(100% - var(--fx) - var(--fw) * 0.95); }
/* 色彩辅助字幕在取景器里让到聚焦名下面 */
.cm-ui.cm-vf-on .cm-colorhint { top: calc(50% + 4.7em); }
/* 取景器常驻的操作提示（倍率条上方一行，半透明；回放中、叠在面板上时隐藏） */
/* M4 第 2 轮：原来 0.72em × 0.8em、62% 不透明度（720p 下 10px），几乎读不出——放大到 0.9em、85%，键帽不小于 11px；bottom 折算后与原来同高 */
.cm-vf-keys { position: absolute; left: 50%; bottom: calc(5% + 2.04em); transform: translateX(-50%); font-size: 0.9em; opacity: 0.85; white-space: nowrap; }
.cm-vf-keys .cm-kbd { font-size: max(11px, 0.78em); }
.cm-vf-keys .cm-keyhints { flex-wrap: nowrap; gap: 0.3em 1.2em; color: #dfe6df; text-shadow: 0 1px 2px #000; }
.cm-vf.cm-ir-on .cm-vf-keys .cm-keyhints { color: #fff; }

/* 交互角标：聚焦对象在取景器里不画角框（准星已经框住它），名字固定画在准星环外下方；NPC 的名字画在头顶锚点上方（不盖脸）；
   探索里未聚焦的只画角框；按键提示 E 只给聚焦且可用的 */
.cm-marker.cm-vf-focus .cm-marker-box { display: none; }
.cm-marker.cm-vf-focus .cm-marker-tag { top: 0; }
.cm-marker.cm-npc:not(.cm-vf-focus) .cm-marker-tag { top: auto; bottom: 0.85em; flex-direction: column-reverse; }
.cm-marker.cm-nolabel .cm-marker-tag { display: none; }
.cm-marker-key { display: none; margin-right: 0.35em; }
.cm-marker.cm-keyable .cm-marker-key { display: inline-block; }
.cm-marker-key .cm-kbd { margin-right: 0; font-size: 0.78em; }
.cm-marker.cm-far { color: #8a8e97; }
.cm-marker.cm-far .cm-marker-label { color: #aeb1b8; }
.cm-marker-labelrow { display: flex; align-items: center; }

/* 字幕字号（设置）也作用于反馈条、教学条、对话选项、色彩辅助、文档正文与巡夜本（默认“中”不变；小 ×0.85、大 ×1.2） */
.cm-sub-0 .cm-toast-feedback, .cm-sub-0 .cm-toast-tutorial, .cm-sub-0 .cm-dlg-opt, .cm-sub-0 .cm-colorhint, .cm-sub-0 .cm-doc-body, .cm-sub-0 .cm-log-entry, .cm-sub-0 .cm-clue { zoom: 0.85; }
.cm-sub-2 .cm-toast-feedback, .cm-sub-2 .cm-toast-tutorial, .cm-sub-2 .cm-dlg-opt, .cm-sub-2 .cm-colorhint, .cm-sub-2 .cm-doc-body, .cm-sub-2 .cm-log-entry, .cm-sub-2 .cm-clue { zoom: 1.2; }

/* 文档阅读器：内容超出一屏时底部渐隐 + 跳动的“▼”，滚到底收起；信、书放宽到 86% */
.cm-doc-more { display: none; position: absolute; right: 1.1em; bottom: 0.5em; color: #7c705c; font-size: 0.9em; animation: cm-bob 1.2s ease-in-out infinite; pointer-events: none; }
.cm-doc-wrap.cm-can-scroll .cm-doc-more { display: block; }
.cm-doc-fade { display: none; position: absolute; left: 0; right: 0; bottom: 0; height: 2.8em; pointer-events: none; border-radius: 0 0 2px 2px;
  background: linear-gradient(to bottom, transparent, var(--doc-fade, #f1ebdc) 78%); }
.cm-doc-wrap.cm-can-scroll .cm-doc-fade { display: block; }
.cm-doc-wrap:has(.cm-doc-ballpoint), .cm-doc-wrap:has(.cm-doc-wet_ink) { --doc-fade: #f3edde; }
.cm-doc-wrap:has(.cm-doc-notice) { --doc-fade: #efe9dc; }
.cm-doc-wrap:has(.cm-doc-slip) { --doc-fade: #e9e0cb; }
.cm-doc-wrap:has(.cm-doc-letter) { --doc-fade: #f4efe2; }
.cm-doc-wrap:has(.cm-doc-ticket) { --doc-fade: #aecbd8; }
.cm-doc-wrap:has(.cm-doc-book) { --doc-fade: #e3d3ad; }
.cm-doc-wrap:has(.cm-doc-plaque) { --doc-fade: #22190f; }
.cm-doc-wrap:has(.cm-doc-letter), .cm-doc-wrap:has(.cm-doc-book) { max-height: 86%; }

/* 标题里的全角标点不跟着字距拉开（“天 亮 了 ， 叫 我”） */
.cm-punct { letter-spacing: 0; margin-left: -0.35em; }

/* 物品提示（拿到东西时）：左下角时辰牌上方 */
.cm-toasts-item { position: absolute; left: 2.2em; bottom: 4.6em; max-width: 11.8em; display: flex; flex-direction: column; align-items: flex-start; gap: 0.4em; }
.cm-toast-item {
  padding: 0.3em 1em 0.3em 0.7em; background: rgba(4, 6, 12, 0.8); border-left: 3px solid var(--tudi-gold); color: #f3eee2;
  font-size: 1em; letter-spacing: 0.04em; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.45);
}
.cm-toast-item b { color: var(--tudi-gold); font-weight: normal; margin-right: 0.4em; }
.cm-ui.cm-vf-on .cm-toasts-item { left: calc(var(--fx) + var(--fw) * 0.05); bottom: calc(5% + 6.2em); }
.cm-ui.cm-dlg-open .cm-toasts-item { bottom: calc(4.5% + var(--cm-dlg-h, 11em) + 0.8em); }

/* 暂停页的操作说明（GDD §10.1 摘要） */
.cm-pause-keys { position: absolute; right: 7%; top: 22%; width: min(34em, 50%); padding: 0.8em 1.2em; background: rgba(12, 15, 26, 0.72); border: 1px solid var(--panel-line); }
.cm-pause-keys h3 { margin: 0 0 0.45em; font-weight: normal; font-size: 0.95em; letter-spacing: 0.3em; color: var(--tudi-gold); }
.cm-pause-keys table { border-collapse: collapse; font-size: 0.8em; }
.cm-pause-keys td { padding: 0.12em 0.8em 0.12em 0; vertical-align: top; color: #dcd6c8; }
.cm-pause-keys td:first-child { white-space: nowrap; color: var(--paper); }
/* 标题页的存档损坏提示（toast 在 #subs 层被标题页盖住） */
.cm-title-warn { position: absolute; left: 9%; top: calc(56% - 2.4em); padding: 0.2em 0.9em; background: rgba(30, 18, 6, 0.88); color: #ffd9a0; border: 1px solid rgba(255, 154, 60, 0.6); border-radius: 2px; font-size: 0.9em; }
/* 设置页键盘选中行 */
.cm-set-row.cm-sel { background: rgba(232, 195, 90, 0.1); box-shadow: inset 3px 0 0 var(--tudi-gold); }

/* ================================================================ M4 第 2 轮 */
/* 标题菜单：覆盖进度的二次确认（“再按一次：覆盖当前进度”） */
.cm-menu-item.cm-warn { color: #ffd9a0; letter-spacing: 0.12em; }
.cm-menu-item.cm-warn::before { opacity: 1; color: #ff9a3c; }
/* 录像机/监控台面板（deck）开着、没举取景器：字幕层升到面板之上，字幕排在 deck 上沿之上；反馈条挪到画面上部，物品提示抬到 deck 之上 */
.cm-ui.cm-deck-open #subs { z-index: 6; }
.cm-ui.cm-deck-open .cm-subs { bottom: calc(2.5% + var(--cm-deck-h, 11em) + 0.8em); }
.cm-ui.cm-deck-open .cm-toasts { top: 16%; }
.cm-ui.cm-deck-open .cm-toasts-item { bottom: calc(2.5% + var(--cm-deck-h, 11em) + 0.8em); }
/* 暂停页、设置页下：冻结的字幕、反馈条、物品提示、新页提示不透出来（系统提示——上下文丢失——照常） */
.cm-ui.cm-pause-on .cm-subs, .cm-ui.cm-pause-on .cm-toasts, .cm-ui.cm-pause-on .cm-toasts-item, .cm-ui.cm-pause-on .cm-toasts-page { visibility: hidden; }
/* 拍照卡片（画框右下角）显示时字幕收窄，右端不压到卡片（左右对称：宽度 = 2 ×（卡片左沿 − 屏幕中线）− 留白） */
.cm-ui.cm-photo-on .cm-subs {
  width: min(92%, 58em, max(calc(100% - 28em), 60%), max(40%, calc(2 * (var(--fx) + var(--fw) - 1.6em - min(24vmin, 13em)) - 100% - 1.6em)));
}
/* 取景器聚焦名：画在准星上方（读字框显示时/取件格）或右侧（倍率 ≥ 3×，下方正是要看的嘴、眼珠） */
.cm-marker.cm-vf-focus.cm-vf-above .cm-marker-tag { top: auto; bottom: 0; }
.cm-marker.cm-vf-focus.cm-vf-right .cm-marker-tag { top: 0; transform: translateY(-50%); align-items: flex-start; opacity: 0.78; }
/* 挑选器：已用的物品沉到底部并变暗；物品栏超出一屏时底部渐隐 + “▼” */
.cm-album.cm-picking .cm-item.cm-used { opacity: 0.5; }
.cm-items-col { position: relative; min-height: 0; display: flex; flex-direction: column; }
.cm-items-col .cm-items { flex: 1 1 auto; }
.cm-items-fade { display: none; position: absolute; left: 0; right: 0; bottom: 0; height: 3em; pointer-events: none; background: linear-gradient(to bottom, rgba(27, 24, 20, 0), #1b1814 80%); }
.cm-items-more { display: none; position: absolute; left: 50%; bottom: 0.2em; transform: translateX(-50%); color: var(--tudi-gold); font-size: 0.85em; pointer-events: none; animation: cm-bob 1.2s ease-in-out infinite; }
.cm-items-col.cm-can-scroll .cm-items-fade, .cm-items-col.cm-can-scroll .cm-items-more { display: block; }
/* WebGL 上下文丢失：常驻遮罩（原来是一条 4 秒就消失的反馈条，恢复不了时只剩黑屏） */
.cm-lost { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.88); pointer-events: auto; }
.cm-lost-box { max-width: min(86%, 34em); padding: 0.7em 1.6em; text-align: center; color: #ffd9a0; background: rgba(30, 18, 6, 0.9); border: 1px solid rgba(255, 154, 60, 0.6); border-radius: 2px; letter-spacing: 0.06em; line-height: 1.7; }
/* 窄窗口（< 900px）：字幕整体上移，避开左下角时辰牌与物品提示 */
@media (max-width: 900px) {
  .cm-subs { bottom: calc(7% + 3.4em); }
}

`;
}

const STYLE_ID = 'cm-ui-styles';

/** 把 CSS 注入 document.head（只注入一次）。 */
export function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = buildCss();
  doc.head.append(el);
}
