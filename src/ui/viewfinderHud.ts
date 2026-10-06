// owner: WP6
// 取景器 HUD（ARCH §7；GDD §10.2）：4:3 画框、OSD、准星、倍率条、镜头图标、红外温度读数与左侧色标、“▶ 残影 · R”。
// 数据来源：#vf 层；读 game.sys.viewfinder、game.sys.shichen.osdLine()、game.sys.replay.canStart()。UI 只读系统状态、只通过 game.dispatch() 或系统公开方法发起动作，不直接改状态。
// 画框位置来自 UI.setFrameRect（CSS 变量 --fx/--fy/--fw/--fh，.cm-frame 按它定位）；画框外的黑边由后期 frame43 画。

import type { Game } from '../core/game';
import { ZOOM_STEPS } from '../core/types';
import type { View } from './ui';
import { STRINGS } from '../data/strings';
import { TAPE, TIMING, tapeSec } from '../data/time';
import { IR_RANGE_C } from '../data/palette';
import { F } from '../data/ids';
import { h, keyHints, setClass, setShown, setStyle, setText, stackHas, vfOnPanel } from './dom';

export class ViewfinderHud implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private readonly osd: HTMLElement;
  private readonly rec: HTMLElement;
  private readonly top: HTMLElement;
  private readonly lens: HTMLElement;
  private readonly lensText: HTMLElement;
  private readonly zoomText: HTMLElement;
  private readonly temp: HTMLElement;
  private readonly scale: HTMLElement;
  private readonly scaleMark: HTMLElement;
  private readonly zoomSteps: HTMLElement[] = [];
  private readonly zoomBar: HTMLElement;
  private readonly replayHint: HTMLElement;
  private readonly panelHint: HTMLElement;
  private readonly panelStatus: HTMLElement;
  /** M4：倍率条上方常驻的一行操作提示（有了红外能力才出现 Q） */
  private readonly keys: HTMLElement;
  private keysIr: boolean | null = null;
  private shown = false;
  private t = 0;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-vf');
    const frame = h('div', 'cm-frame');
    const corners = h('div', 'cm-vf-corners');

    this.top = h('div', 'cm-vf-top');
    this.rec = h('div', 'cm-vf-rec');
    this.rec.append(h('span', 'cm-rec-dot'), document.createTextNode(STRINGS.hud.rec));
    this.osd = h('span', 'cm-osd');
    this.top.append(this.rec, this.osd);

    const right = h('div', 'cm-vf-right');
    this.lens = h('div', 'cm-vf-lens cm-osd');
    this.lensText = h('span');
    this.lens.append(h('span', 'cm-vf-lens-icon'), this.lensText);
    this.zoomText = h('span', 'cm-osd cm-vf-zoomtxt');
    right.append(this.lens, this.zoomText);

    const cross = h('div', 'cm-vf-cross');
    const ring = h('div', 'cm-vf-cross-ring');
    this.temp = h('div', 'cm-vf-temp');

    // 红外色标：0℃ 在下、45℃ 在上；三角指示当前读数
    this.scale = h('div', 'cm-vf-scale');
    const bar = h('div', 'cm-vf-scale-bar');
    this.scaleMark = h('div', 'cm-vf-scale-mark');
    bar.append(this.scaleMark);
    const labels = h('div', 'cm-vf-scale-labels');
    const [lo, hi] = IR_RANGE_C;
    for (const c of [hi, (hi * 2) / 3, hi / 3, lo]) labels.append(h('span', undefined, `${Math.round(c)}℃`));
    this.scale.append(bar, labels);

    const zoom = h('div', 'cm-vf-zoom');
    for (const z of ZOOM_STEPS) {
      const s = h('span', undefined, `${z}×`);
      this.zoomSteps.push(s);
      zoom.append(s);
    }
    this.zoomBar = zoom;

    this.replayHint = h('div', 'cm-vf-hint', STRINGS.hud.replayHint);
    this.panelHint = h('div', 'cm-vf-panelhint');
    this.panelStatus = h('div', 'cm-osd cm-vf-panelstatus');
    this.panelHint.append(this.panelStatus, keyHints([['右键', '回到面板'], ['E', '离开面板']]));

    this.keys = h('div', 'cm-vf-keys');

    frame.append(corners, this.top, right, ring, cross, this.temp, this.scale, zoom, this.keys, this.replayHint, this.panelHint);
    this.el.append(frame);
    setShown(this.el, false);
  }

  show(_arg?: unknown): void {
    this.shown = true;
    setShown(this.el, true);
  }
  hide(): void {
    this.shown = false;
    setShown(this.el, false);
  }

  update(dt: number): void {
    this.t += dt;
    if (!this.shown) return;
    const g = this.game;
    const vf = g.sys.viewfinder;
    const stack = g.modes.stack;
    const inReplay = stackHas(g, 'mode.replay');
    const onPanel = vfOnPanel(stack);
    const ir = vf.lens === 'ir';

    // 回放中左上角换成回放 HUD 的 ◀◀ 时间码、底部换成时间轴（ReplayHud）；这里让出位置，倍率只留右上角的读数
    setShown(this.top, !inReplay);
    if (!inReplay) setText(this.osd, g.sys.shichen.osdLine(1));
    const period = TIMING.recBlinkSec;
    setClass(this.rec, 'cm-off', (this.t % period) >= period / 2);

    setClass(this.el, 'cm-ir-on', ir);
    setClass(this.lens, 'cm-ir', ir);
    setText(this.lensText, ir ? '红外' : '常光');
    setText(this.zoomText, `${vf.zoom}×`);
    ZOOM_STEPS.forEach((z, i) => setClass(this.zoomSteps[i], 'cm-on', z === vf.zoom));

    // 红外：准星旁温度读数（0.1℃）与左侧色标
    setShown(this.scale, ir);
    const tc = ir ? vf.tempReading() : null;
    setShown(this.temp, tc !== null);
    if (tc !== null) {
      setText(this.temp, `${tc.toFixed(1)}℃`);
      const [lo, hi] = IR_RANGE_C;
      const f = Math.min(1, Math.max(0, (tc - lo) / (hi - lo)));
      setStyle(this.scaleMark, 'bottom', `${(f * 100).toFixed(1)}%`);
    }
    setShown(this.scaleMark, tc !== null);

    // “▶ 残影 · R”：取景器中、靠近残影点并看着它（replay.canStart()）；回放中与面板上不显示
    const canReplay = !inReplay && !onPanel && g.modes.top === 'mode.viewfinder' && g.sys.replay.canStart().ok;
    setShown(this.replayHint, canReplay);
    const panelTop = onPanel && g.modes.top === 'mode.viewfinder';
    setShown(this.panelHint, panelTop);
    setShown(this.zoomBar, !inReplay && !panelTop);
    if (panelTop) setText(this.panelStatus, this.panelLine());
    // 常驻操作提示（M4：取景器里原来没有，Q/R/E/左键快门只靠一次性的 4.5 秒提示）；回放中与叠在面板上时不显示
    const keysOn = !inReplay && !onPanel && g.modes.top === 'mode.viewfinder';
    setShown(this.keys, keysOn);
    if (keysOn) {
      const hasIr = g.state.flag(F.R2_ABILITY_IR);
      if (hasIr !== this.keysIr) {
        this.keysIr = hasIr;
        const pairs: [string, string][] = [['左键', '快门'], ['滚轮', '变焦']];
        if (hasIr) pairs.push(['Q', '红外']);
        pairs.push(['E', '交互'], ['右键', '收起']);
        this.keys.replaceChildren(keyHints(pairs));
      }
    }
  }

  /** 叠在面板上时，右下角显示面板状态（录像机：走带 + 时间码 + SLOW/ALARM；监控台：频道 + 视频线）。 */
  private panelLine(): string {
    const g = this.game;
    if (stackHas(g, 'mode.panel_vcr')) {
      const v = g.sys.vcr;
      const st = v.shuttle > 0 ? '▶▶' : v.shuttle < 0 ? '◀◀' : v.playing ? '▶' : '❚❚';
      const tc = v.tc;
      const slow = tc >= tapeSec(TAPE.slowZone[0]) && tc <= tapeSec(TAPE.slowZone[1]) ? `  ${STRINGS.hud.slow}` : '';
      return `VCR ${st} ${v.tcString()}${slow}`;
    }
    const c = g.sys.cctv;
    return `CH${c.channel}${c.channel === 1 && !c.jack ? `  ${STRINGS.hud.noSignal}` : ''}`;
  }
}
