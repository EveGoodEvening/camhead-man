// owner: WP6
// 常规 HUD（ARCH §7；GDD §10.2）：左下时辰与钟点、REC 点、交互角标（现算 label、灰/白、聚焦原因、blink）、色彩辅助字幕。
// 数据来源：#hud 与 #world-markers 层；每帧从 game.sys.interaction.list() 与 game.sys.shichen 读状态。UI 只读系统状态、只通过 game.dispatch() 或系统公开方法发起动作，不直接改状态。
//
// 同文件的 SubtitleLayer 管 #subs 里的字幕与反馈条（ARCH §2.5：hud.ts 负责“字幕与 toast”）；它由 UI 直接驱动，
// 因为字幕在过场、对话、面板里也要显示，而常规 HUD 在这些时候是隐藏的。

import * as THREE from 'three';
import type { Game } from '../core/game';
import type { InteractId, NpcId, SpeakerId } from '../data/ids';
import type { InteractableStatus } from '../game/interaction';
import type { View, ToastKind } from './ui';
import { STRINGS } from '../data/strings';
import { TIMING, SHICHEN_TRANSITION_SEC } from '../data/time';
import { readLen, readSec } from '../game/effects';
import { isNarration, speakerName, SPEAKERS } from '../data/speakers';
import { evalDyn, h, kbd, setClass, setShown, setStyle, setText, stackHas } from './dom';

/** blink() 的闪烁时长（ARCH §7：一次 0.6s 闪烁）。 */
const BLINK_SEC = 0.6;
/** 取景器外（第三人称）角标只画在视口内侧这么多像素内，避免贴边闪烁。 */
const EDGE_PX = 8;

interface MarkerEl { root: HTMLElement; tag: HTMLElement; label: HTMLElement; reason: HTMLElement; seen: boolean }

/** 探索（第三人称）里最多画这么多个角框（离玩家最近的；聚焦与正在闪的不计数，M4）。 */
const EXPLORE_MAX_BOXES = 4;
/** 取景器里聚焦名画在准星中心下方这么多 em（准星环 3.4em 高，M4）。 */
const VF_FOCUS_TAG_EM = 2.5;
/**
 * 画框顶部让给 OSD 行、底部让给倍率条与操作提示行（em，另加画框高的 5%；M4）。
 * M4 第 2 轮：按键行放大到 0.9em 后，贴底的角框连同它下面的名字（约 2.3em）会压在按键行上——底部让出 5.6em。
 */
const VF_TOP_EM = 1.9;
const VF_BOTTOM_EM = 5.6;
/** 取景器画框左右内缩（画框宽的比例；角标不画到 4:3 框外的黑边上，M4）。 */
const VF_SIDE = 0.04;

/** M4 第 2 轮：取景器聚焦名在准星右侧时离中心多少 em（倍率 ≥ 3×：下方正是要看的嘴、眼珠）。 */
const VF_FOCUS_RIGHT_EM = 2.2;

interface Placed { m: MarkerEl; s: InteractableStatus; x: number; y: number; npc: boolean; vfFocus: boolean; far: boolean; rank: number; side: 'below' | 'above' | 'right' }

export class HudView implements View {
  readonly el: HTMLElement;
  /** 交互角标容器，由 UI 挂到 #world-markers（与 el 分属两层）。 */
  readonly markersEl: HTMLElement;
  protected readonly game: Game;
  private readonly corner: HTMLElement;
  private readonly shichenEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly recDot: HTMLElement;
  private readonly hintKey: HTMLElement;
  private readonly colorHint: HTMLElement;
  private readonly markers = new Map<InteractId, MarkerEl>();
  private readonly blinks = new Map<InteractId, number>();
  private readonly v = new THREE.Vector3();
  private shown = false;
  private t = 0;
  private shichenFx = 0;
  private recBlinkUntil = 0;
  private emKey = '';
  private emCache = 16;
  /** M4 第 2 轮：名字标签的实测尺寸（按文字与样式缓存；原来按字数估算，和实际渲染宽度对不上，电闸“开关②③④”叠成一串） */
  private readonly tagSize = new Map<string, { w: number; h: number }>();

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-hud');
    this.markersEl = h('div', 'cm-markers');
    this.corner = h('div', 'cm-hud-corner');
    this.shichenEl = h('span', 'cm-hud-shichen');
    this.clockEl = h('span', 'cm-hud-clock');
    this.recDot = h('span', 'cm-rec-dot');
    this.corner.append(this.shichenEl, this.clockEl, this.recDot);
    this.hintKey = h('div', 'cm-hud-hintkey');
    this.hintKey.append(kbd('H'), document.createTextNode(STRINGS.hud.hintKey));
    this.colorHint = h('div', 'cm-colorhint');
    setShown(this.colorHint, false);
    this.el.append(this.corner, this.hintKey, this.colorHint);
    setShown(this.el, false);
    setShown(this.markersEl, false);
    // 时辰切换：HUD 字样做 2 秒强调（GDD §3.10 的“时辰过场：远钟 + HUD 字样变化”）；M4：跟着字卡真正播出的时刻
    game.events.on('shichen:card', () => { this.shichenFx = SHICHEN_TRANSITION_SEC; });
  }

  show(_arg?: unknown): void {
    this.shown = true;
    setShown(this.el, true);
    setShown(this.markersEl, true);
  }
  hide(): void {
    this.shown = false;
    setShown(this.el, false);
    setShown(this.markersEl, false);
  }

  /**
   * 让一个交互物的角标闪一次（0.6s，UI 自己计时）。M1c：InteractableHandle.blink() 与提示空闲闪烁走系统状态
   * （`InteractableStatus.blink`，本视图每帧读 list()），这个方法只留给 UI 自己/调试用（engine-wp6.md #2）。
   */
  blink(id: InteractId): void {
    this.blinks.set(id, BLINK_SEC);
  }

  /** pc.huoji 的台词行只让 REC 灯闪（ARCH §6.13）：在这段时间里 REC 快闪。 */
  flashRec(sec: number): void {
    this.recBlinkUntil = this.t + sec;
  }

  update(dt: number): void {
    const frozen = this.game.modes.freezesWorld();
    const gdt = frozen ? 0 : dt;
    this.t += dt;
    for (const [id, left] of this.blinks) {
      const next = left - gdt;
      if (next <= 0) this.blinks.delete(id);
      else this.blinks.set(id, next);
    }
    if (this.shichenFx > 0) this.shichenFx = Math.max(0, this.shichenFx - gdt);
    if (!this.shown) return;

    const g = this.game;
    const stack = g.modes.stack;
    const top = g.modes.top;
    // 左下角只在“自由行动”时显示：取景器里有 OSD，面板/相册/巡夜本/对话框占着屏幕下方
    const cornerOn = !stack.some(m => m !== 'mode.explore' && m !== 'mode.pause');
    setShown(this.corner, cornerOn);
    setShown(this.hintKey, top === 'mode.explore');
    if (cornerOn) {
      const sc = g.sys.shichen;
      setText(this.shichenEl, sc.hudLabel());
      setText(this.clockEl, sc.clockText());
      setClass(this.corner, 'cm-shichen-change', this.shichenFx > 0);
      const fast = this.t < this.recBlinkUntil;
      const period = fast ? 0.25 : TIMING.recBlinkSec;
      setClass(this.recDot, 'cm-off', (this.t % period) >= period / 2);
    }

    // 取景器叠在面板上时（视点固定在面板、E/Esc 下传给面板“离开”）不画世界里的交互角标（M1c）
    const onPanel = stack.includes('mode.panel_vcr') || stack.includes('mode.panel_console');
    const markersOn = !onPanel && (top === 'mode.explore' || top === 'mode.viewfinder' || top === 'mode.replay');
    setShown(this.markersEl, markersOn);
    if (markersOn) this.updateMarkers();
    else this.clearMarkers();
    this.updateColorHint(markersOn);
  }

  private updateMarkers(): void {
    const g = this.game;
    const list = g.sys.interaction.list();
    const vf = stackHas(g, 'mode.viewfinder');
    const top = g.modes.top;
    const cam = g.cameras.camera;
    cam.updateMatrixWorld();
    const w = g.host.clientWidth || window.innerWidth;
    const hgt = g.host.clientHeight || window.innerHeight;
    const em = this.emPx();
    const fr = vf ? this.frame(w, hgt) : null;
    const farId = g.sys.interaction.farFocused;
    for (const m of this.markers.values()) m.seen = false;
    const placed: Placed[] = [];
    for (const s of list) {
      const far = s.id === farId && !s.focused;
      if (!far && !this.wantMarker(s, vf)) continue;
      const npc = s.id.startsWith('npc.');
      // 就近规则选出的聚焦对象可能不在准星上：那时照常画在它自己身上（带角框），只有准星对着的才固定画在准星下方
      const vfFocus = vf && s.focused && g.sys.interaction.focusedByRay;
      let x: number, y: number;
      let side: Placed['side'] = 'below';
      if (vfFocus) {
        // 聚焦对象在取景器里：准星已经框住它，名字固定画在准星环外（M4：原来锚点就在准星处，准星的竖线穿过名字）。
        // M4 第 2 轮：缺省在下方；读字框显示时在上方（对象自己的编号/字印在下面，如取件格），倍率 ≥ 3× 时在右侧（4× 看破绽时下方正是嘴）；
        // InteractableDef.vfLabel 可指定
        const want = g.sys.interaction.get(s.id)?.vfLabel;
        side = want ?? (g.sys.viewfinder.zoom >= 3 ? 'right' : this.readShown() ? 'above' : 'below');
        x = side === 'right' ? w / 2 + VF_FOCUS_RIGHT_EM * em : w / 2;
        y = side === 'right' ? hgt / 2 : side === 'above' ? hgt / 2 - VF_FOCUS_TAG_EM * em : hgt / 2 + VF_FOCUS_TAG_EM * em;
      } else {
        const p = this.anchor(s.id, npc);
        if (!p) continue;
        this.v.copy(p).project(cam);
        // 相机后方或远出画面：不画
        if (this.v.z > 1 || this.v.z < -1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) continue;
        x = (this.v.x + 1) * 0.5 * w;
        y = (1 - this.v.y) * 0.5 * hgt;
        if (fr) {
          // 取景器里按 4:3 画框：框外（黑边上）的不画；OSD 行与倍率条让开（M4）
          const x0 = fr.x + fr.w * VF_SIDE, x1 = fr.x + fr.w * (1 - VF_SIDE);
          if (x < x0 || x > x1) continue;
          const y0 = fr.y + fr.h * 0.05 + VF_TOP_EM * em, y1 = fr.y + fr.h * 0.95 - VF_BOTTOM_EM * em;
          if (y < fr.y || y > fr.y + fr.h) continue;
          y = Math.min(y1, Math.max(y0, y));
        } else {
          x = Math.min(w - EDGE_PX, Math.max(EDGE_PX, x));
          y = Math.min(hgt - EDGE_PX, Math.max(EDGE_PX, y));
        }
      }
      const m = this.markerFor(s.id);
      const rank = (s.focused ? 1e6 : 0) + (this.isBlinking(s) ? 1e5 : 0) + (far ? 5e4 : 0) + (g.sys.interaction.get(s.id)?.priority ?? 0) * 100 - s.distance;
      placed.push({ m, s, x, y, npc, vfFocus, far, rank, side });
    }
    // 探索（第三人称）：未聚焦、没在闪的只画角框，最多画最近的几个（M4：门卫室里七八个标签堆成一团）
    const explore = !vf;
    if (explore) {
      const plain = placed.filter(p => !p.s.focused && !this.isBlinking(p.s) && !p.far).sort((a, b) => a.s.distance - b.s.distance);
      const drop = new Set(plain.slice(EXPLORE_MAX_BOXES).map(p => p.m));
      for (let i = placed.length - 1; i >= 0; i--) if (drop.has(placed[i]!.m)) placed.splice(i, 1);
    }
    // 名字按优先级贪心避让：矩形相交就往下（NPC 往上）推一行，推两次还相交就只留角框（M4）
    placed.sort((a, b) => b.rank - a.rank);
    const rects: { x0: number; y0: number; x1: number; y1: number }[] = [];
    // M4 第 2 轮：取景器里读字框、常驻按键行、倍率条占的矩形也算障碍——角标名字推开或只留角框，不压在读出来的字、按键说明上
    if (vf) {
      const hb = this.markersEl.parentElement?.getBoundingClientRect();
      const ox = hb?.left ?? 0, oy = hb?.top ?? 0;
      const block = (el: Element | null | undefined): void => {
        if (!el) return;
        const rb = el.getBoundingClientRect();
        if (rb.width > 0 && rb.height > 0) rects.push({ x0: rb.left - ox, y0: rb.top - oy, x1: rb.right - ox, y1: rb.bottom - oy });
      };
      if (this.readShown()) block(this.game.ui.read.el);
      const vfEl = this.game.ui.vf.el;
      block(vfEl.querySelector('.cm-vf-keys:not(.cm-hidden)'));
      block(vfEl.querySelector('.cm-vf-zoom'));
    }
    const keyable = top === 'mode.explore' || top === 'mode.viewfinder' || top === 'mode.replay';
    for (const p of placed) {
      const { m, s } = p;
      m.seen = true;
      setStyle(m.root, 'transform', `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`);
      setText(m.label, s.label);
      setClass(m.root, 'cm-grey', !s.available || p.far);
      setClass(m.root, 'cm-far', p.far);
      setClass(m.root, 'cm-focus', s.focused);
      setClass(m.root, 'cm-vf-focus', p.vfFocus);
      setClass(m.root, 'cm-npc', p.npc);
      setClass(m.root, 'cm-blink', this.isBlinking(s));
      const keyOn = s.focused && s.available && keyable;
      setClass(m.root, 'cm-keyable', keyOn);
      setClass(m.root, 'cm-vf-above', p.vfFocus && p.side === 'above');
      setClass(m.root, 'cm-vf-right', p.vfFocus && p.side === 'right');
      // “前置不满足时灰色，聚焦时附一句原因”（GDD §10.2）；射程外的聚焦候选附“（走近点）”（M4）
      const reason = p.far ? STRINGS.hud.tooFar : s.focused && !s.available && s.blockedText ? s.blockedText : '';
      setText(m.reason, reason);
      setShown(m.reason, reason !== '');
      let wantLabel = s.focused || this.isBlinking(s) || p.far || !explore;
      let dx = 0, dy = 0;
      if (wantLabel) {
        // M4 第 2 轮：实测标签尺寸（按样式与文字缓存，只在第一次出现时量一次）
        const size = this.measureTag(m, `${s.label}|${reason}|${keyOn ? 1 : 0}|${s.focused ? 1 : 0}|${s.available && !p.far ? 1 : 0}`);
        const lw = size.w, lh = size.h;
        const up = (p.npc && !p.vfFocus) || (p.vfFocus && p.side === 'above');
        const dir = up ? -1 : 1;
        // 标签矩形的左上角（相对锚点）：居中的在 x − w/2；准星右侧的左对齐
        const bx = p.vfFocus && p.side === 'right' ? p.x : p.x - lw / 2;
        const by = p.vfFocus
          ? (p.side === 'right' ? p.y - lh / 2 : p.side === 'above' ? p.y - lh : p.y)
          : up ? p.y - 0.85 * em - lh : p.y + (s.focused ? 1.05 : 0.85) * em;
        // 候选位置：原位 → （取景器里）左右各让 0.6 个标签宽 → 往下（NPC 往上）一行、两行
        const step = 1.55 * em;
        const cands: [number, number][] = vf && !p.vfFocus
          ? [[0, 0], [0.6 * lw, 0], [-0.6 * lw, 0], [0, dir * step], [0.6 * lw, dir * step], [-0.6 * lw, dir * step]]
          : [[0, 0], [0, dir * step], [0, dir * 2 * step]];
        let ok = false;
        for (const [cx, cy] of cands) {
          const r = { x0: bx + cx, y0: by + cy, x1: bx + cx + lw, y1: by + cy + lh };
          if (!rects.some(o => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0)) {
            rects.push(r);
            dx = cx;
            dy = cy;
            ok = true;
            break;
          }
        }
        // 聚焦者总显示名字（哪怕和别人叠着）；其余推不开的只留角框
        if (!ok && s.focused) {
          ok = true;
          dx = dy = 0;
        }
        wantLabel = ok;
      }
      setClass(m.root, 'cm-nolabel', !wantLabel);
      // M4 第 2 轮更正：setStyle 走 style.setProperty，属性名必须是 kebab-case——原来写的 'marginTop' 静默无效，第 1 轮的“推一行”从没生效过
      setStyle(m.tag, 'margin-top', dy > 0 ? `${dy.toFixed(1)}px` : '');
      setStyle(m.tag, 'margin-bottom', dy < 0 ? `${(-dy).toFixed(1)}px` : '');
      setStyle(m.tag, 'margin-left', dx !== 0 ? `${dx.toFixed(1)}px` : '');
    }
    for (const [id, m] of this.markers) {
      if (!m.seen) {
        m.root.remove();
        this.markers.delete(id);
      }
    }
  }

  /**
   * M4 第 2 轮：名字标签的实际像素尺寸（offsetWidth/Height，按 key 缓存——key 含文字、原因行、E 键、聚焦/灰色样式；窗口尺寸变了整表清空）。
   * 量之前先去掉 cm-nolabel（display:none 量不出来）；只在缓存未命中时强制排版一次。
   */
  private measureTag(m: MarkerEl, key: string): { w: number; h: number } {
    const hit = this.tagSize.get(key);
    if (hit) return hit;
    setClass(m.root, 'cm-nolabel', false);
    const w = m.tag.offsetWidth, h = m.tag.offsetHeight;
    const em = this.emCache;
    // 还没排版（隐藏的祖先）时量出 0：退回估算，不缓存
    if (w <= 0 || h <= 0) return { w: (Math.max(2, key.split('|')[0]!.length) * 0.92 + 1.3) * em, h: 1.5 * em };
    const size = { w, h };
    if (this.tagSize.size > 400) this.tagSize.clear();
    this.tagSize.set(key, size);
    return size;
  }

  /** 读字框此刻是否显示（取景器聚焦名改画在准星上方）。 */
  private readShown(): boolean {
    const r = this.game.sys.read;
    return r.reading !== null || r.hint !== null;
  }

  /** 根字号（像素）：角标避让按 em 估算标签大小。 */
  private emPx(): number {
    // 根字号只随视口变（clamp(13px, 1.9vmin + 4px, 22px)）：按视口尺寸缓存，免得每帧 getComputedStyle
    const key = `${window.innerWidth}x${window.innerHeight}`;
    if (key === this.emKey) return this.emCache;
    this.tagSize.clear();
    const el = this.markersEl.parentElement ?? this.markersEl;
    const f = parseFloat(getComputedStyle(el).fontSize);
    this.emKey = key;
    this.emCache = Number.isFinite(f) && f > 0 ? f : 16;
    return this.emCache;
  }

  /** 取景器 4:3 画框（CSS 像素，与 styles 的 --fx/--fy/--fw/--fh 同一套算法）。 */
  private frame(w: number, hgt: number): { x: number; y: number; w: number; h: number } {
    const ww = w / hgt >= 4 / 3 ? hgt * (4 / 3) : w;
    const hh = w / hgt >= 4 / 3 ? hgt : w * (3 / 4);
    return { x: (w - ww) / 2, y: (hgt - hh) / 2, w: ww, h: hh };
  }

  /**
   * 哪些对象画角标：在场、在射程内（或正被聚焦、正在闪）；阴物只在其可见的视图下出现（ARCH §6.6 聚焦规则 3、§7；红外专属对象只在红外里，M1d）。
   * view === 'naked' 的对象在取景器里仍画，这样玩家能按 E 得到 wrongView 反馈。
   */
  private wantMarker(s: InteractableStatus, vf: boolean): boolean {
    if (!s.present) return false;
    if (s.view === 'viewfinder' && !vf) return false;
    // 红外专属对象（冷迹）只在红外里画（M1d，与 InteractionSystem 的聚焦规则一致）
    if (s.lens === 'ir' && !(vf && this.game.sys.viewfinder.lens === 'ir')) return false;
    return s.inRange || s.focused || this.isBlinking(s);
  }

  /** 正在闪：系统状态里的剩余闪烁秒（InteractableHandle.blink()、提示空闲闪烁；M1c 起的主通道）或 UI 自己的 blink(id)。 */
  private isBlinking(s: InteractableStatus): boolean {
    return s.blink > 0 || this.blinks.has(s.id);
  }

  private anchor(id: InteractId, npc = false): THREE.Vector3 | null {
    // NPC 的名字画在头顶上方（M4：锚点在胸口或脸上，“土地”两个字正好盖住他的脸和胡子）
    if (npc && this.game.sys.npc.markerAnchor(id as NpcId, this.v)) return this.v;
    const def = this.game.sys.interaction.get(id);
    if (!def) return null;
    const at = def.at;
    if (typeof at === 'function') return this.v.copy(at());
    return this.v.set(at[0], at[1], at[2]);
  }

  private markerFor(id: InteractId): MarkerEl {
    let m = this.markers.get(id);
    if (m) return m;
    const root = h('div', 'cm-marker');
    const box = h('div', 'cm-marker-box');
    const tag = h('div', 'cm-marker-tag');
    const row = h('div', 'cm-marker-labelrow');
    // M4：聚焦且可用时名字前带按键提示 E（GDD §3.2“按 E 拾取”；原来从头到尾没教过 E）
    const key = h('span', 'cm-marker-key');
    key.append(kbd('E'));
    const label = h('div', 'cm-marker-label');
    row.append(key, label);
    const reason = h('div', 'cm-marker-reason');
    tag.append(row, reason);
    root.append(box, tag);
    this.markersEl.append(root);
    m = { root, tag, label, reason, seen: true };
    this.markers.set(id, m);
    return m;
  }

  private clearMarkers(): void {
    for (const m of this.markers.values()) m.root.remove();
    this.markers.clear();
  }

  /** “色彩辅助”：聚焦对象的 colorHint 现算，有值才以字幕形式出现在准星下方，不进角标（ARCH §7）。 */
  private updateColorHint(active: boolean): void {
    const g = this.game;
    let text: string | undefined;
    if (active && g.settings.colorAssist) {
      const id = g.sys.interaction.focused;
      const def = id ? g.sys.interaction.get(id) : undefined;
      text = def ? evalDyn(def.colorHint, g.state) : undefined;
    }
    setText(this.colorHint, text ?? '');
    setShown(this.colorHint, !!text);
  }
}

// ---------------------------------------------------------------- 字幕与反馈条（#subs）

interface SubLine { el: HTMLElement; text: string; left: number; hint?: boolean }
interface ToastLine { el: HTMLElement; text: string; kind: ToastKind; left: number }

/** 同时最多显示的字幕行与反馈条数。 */
const MAX_SUBS = 2;
const MAX_TOASTS = 3;
/** 反馈条停留：每字 0.15 秒（M4，原 0.1），最少 2.5 秒；教学提示与“新页”提示更久一点；拿到物品 ≥ 3.5 秒。 */
const TOAST_MIN: Readonly<Record<ToastKind, number>> = { feedback: 2.5, tutorial: 4.5, page: 3.5, system: 4, item: 3.8 };
const FADE_OUT = 0.35;

export class SubtitleLayer {
  readonly el: HTMLElement;
  private readonly subsBox: HTMLElement;
  private readonly toastBox: HTMLElement;
  private readonly pageBox: HTMLElement;
  private readonly systemBox: HTMLElement;
  private readonly itemBox: HTMLElement;
  private subs: SubLine[] = [];
  private toasts: ToastLine[] = [];

  constructor() {
    this.el = h('div', 'cm-subs-layer');
    this.subsBox = h('div', 'cm-subs');
    this.toastBox = h('div', 'cm-toasts');
    this.pageBox = h('div', 'cm-toasts-page');
    this.systemBox = h('div', 'cm-toasts-system');
    this.itemBox = h('div', 'cm-toasts-item');
    this.el.append(this.toastBox, this.pageBox, this.systemBox, this.itemBox, this.subsBox);
  }

  /** M4：字幕框此刻的高度（像素；对话框打开时反馈条排在字幕上方，UI 写进 --cm-subs-h）。 */
  subsHeight(): number {
    return this.subs.length ? this.subsBox.offsetHeight : 0;
  }

  /**
   * dur 缺省按字数：每字 0.12 秒，最少 2 秒（ARCH §6.3 say）。同文字正在显示时只刷新时长。
   * M4 第 2 轮：kind 'hint'（H 的提示）——先撤掉屏幕上别的提示行再加（替换，不叠两行）。
   */
  subtitle(text: string, who: SpeakerId | '' | undefined, dur?: number, kind?: 'hint'): void {
    const sec = dur ?? readSec(text);
    if (kind === 'hint') {
      this.subs = this.subs.filter(l => {
        if (!l.hint || l.text === text) return true;
        l.el.remove();
        return false;
      });
    }
    const same = this.subs.find(s => s.text === text);
    if (same) {
      same.left = Math.max(same.left, sec);
      same.el.classList.remove('cm-leaving');
      if (kind === 'hint') same.hint = true;
      return;
    }
    const el = h('div', 'cm-sub');
    const w = who ?? '';
    if (w !== '' && SPEAKERS[w].recOnly) {
      // pc.huoji 不出字，只有 REC（ARCH §6.13）；字幕里也只给一个 REC 标记
      el.classList.add('cm-rec-only');
      el.textContent = `● ${STRINGS.hud.rec}`;
    } else if (isNarration(w)) {
      el.classList.add('cm-narr');
      el.textContent = text;
    } else {
      el.append(h('span', 'cm-who', `${speakerName(w)}：`), document.createTextNode(text));
    }
    this.subsBox.append(el);
    this.subs.push(kind === 'hint' ? { el, text, left: sec, hint: true } : { el, text, left: sec });
    while (this.subs.length > MAX_SUBS) this.subs.shift()?.el.remove();
  }

  toast(text: string, kind: ToastKind): void {
    const sec = Math.max(TOAST_MIN[kind], readLen(text) * TIMING.toastReadSecPerChar);
    const same = this.toasts.find(t => t.text === text && t.kind === kind);
    if (same) {
      same.left = Math.max(same.left, sec);
      same.el.classList.remove('cm-leaving');
      return;
    }
    let el: HTMLElement;
    if (kind === 'item' && text.startsWith(STRINGS.hud.gotItems)) {
      el = h('div', 'cm-toast cm-toast-item');
      el.append(h('b', undefined, STRINGS.hud.gotItems), document.createTextNode(text.slice(STRINGS.hud.gotItems.length)));
    } else {
      el = h('div', `cm-toast cm-toast-${kind}`, text);
    }
    const box = kind === 'page' ? this.pageBox : kind === 'system' ? this.systemBox : kind === 'item' ? this.itemBox : this.toastBox;
    box.append(el);
    this.toasts.push({ el, text, kind, left: sec });
    const sameKind = this.toasts.filter(t => t.kind === kind);
    if (sameKind.length > MAX_TOASTS) {
      const old = sameKind[0];
      old.el.remove();
      this.toasts = this.toasts.filter(t => t !== old);
    }
  }

  /** M4：让某条还在显示的反馈条/教学条立刻淡出（动作已经做了的教学提示）。 */
  dismiss(text: string): void {
    for (const t of this.toasts) if (t.text === text && t.left > 0) t.left = 0;
  }

  /** M4 第 2 轮：还剩 ≥ minLeft 秒的这条反馈条直接撤掉（过场开始时收回没读完的教学条）；撤了返回 true。 */
  takeBack(text: string, minLeft: number): boolean {
    const hit = this.toasts.find(t => t.text === text && t.left >= minLeft);
    if (!hit) return false;
    hit.el.remove();
    this.toasts = this.toasts.filter(t => t !== hit);
    return true;
  }

  /** 这段文字此刻是否已作为字幕或反馈条显示着（去重用）。 */
  isShowing(text: string): boolean {
    return this.subs.some(s => s.text === text && s.left > 0) || this.toasts.some(t => t.text === text && t.left > 0);
  }

  /** 当前显示中的字幕（最新一行；DebugState.subtitle）。 */
  current(): string | null {
    for (let i = this.subs.length - 1; i >= 0; i--) if (this.subs[i].left > 0) return this.subs[i].text;
    return null;
  }

  /** 计时（游戏时间：冻结时 UI 传 0）。 */
  update(gdt: number): void {
    this.subs = this.tick(this.subs, gdt);
    this.toasts = this.tick(this.toasts, gdt);
  }

  clear(): void {
    for (const s of this.subs) s.el.remove();
    for (const t of this.toasts) t.el.remove();
    this.subs = [];
    this.toasts = [];
  }

  private tick<T extends { el: HTMLElement; left: number }>(lines: T[], gdt: number): T[] {
    const keep: T[] = [];
    for (const l of lines) {
      l.left -= gdt;
      if (l.left <= -FADE_OUT) {
        l.el.remove();
        continue;
      }
      setClass(l.el, 'cm-leaving', l.left <= 0);
      keep.push(l);
    }
    return keep;
  }
}
