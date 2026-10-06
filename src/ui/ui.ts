// owner: WP6
// UI 根与分层（ARCH §7）：#app 下 z 由低到高——canvas → #world-markers → #hud → #vf → #subs → #panels → #menus → #fade。
// M1d：密码锁/称呼面板开着时 #subs 临时升到 #panels 之上（.cm-panel-open），反馈条移到面板框下方。
// 纯 DOM + CSS，无框架。所有 DOM 按钮 tabindex="-1"、点击后立即 blur()。
//
// 显隐的唯一依据是模式栈与系统状态：UI.update 每帧按栈算出每个视图该不该显示，变化时调用它的 show/hide
// （模式处理器也可以自己调 show/hide——show/hide 都是幂等的，两边依据相同，结果一致）。
// 计时：字幕、反馈条、角标闪烁按游戏时间走（冻结时停）；淡入淡出、REC 闪烁等纯装饰按 update 的 dt 走。

import type { Game } from '../core/game';
import type { Button } from '../core/input';
import type { ModeId } from '../core/types';
import type { SpeakerId } from '../data/ids';
import type { AlbumArg } from '../game/interaction';
import type { JournalArg } from '../game/journal';
import { HudView, SubtitleLayer } from './hud';
import { ViewfinderHud } from './viewfinderHud';
import { ReplayHud } from './replayHud';
import { DialogueBox } from './dialogueBox';
import { ActionMenu } from './actionMenu';
import { AlbumView } from './album';
import { JournalView } from './journal';
import { DocReader } from './docReader';
import { CodePanel } from './codePanel';
import { NamingPanel } from './namingPanel';
import { VcrPanel } from './vcrPanel';
import { ConsolePanel } from './consolePanel';
import { TripodHud } from './tripodHud';
import { ReadOverlay } from './readOverlay';
import { Menus } from './menus';
import { FadeLayer } from './fade';
import { PointerGate } from './pointerGate';
import { PhotoToast } from './photoToast';
import { injectStyles } from './styles';
import { h, setClass, setShown, setText, topPointerPolicy } from './dom';
import { STRINGS } from '../data/strings';
import { TIMING } from '../data/time';
import { itemDisplayName } from '../data/items';

/** 每个组件相同的接口（ARCH §7） */
export interface View { readonly el: HTMLElement; show(arg?: unknown): void; hide(): void; update?(dt: number): void }

/** M4：'item' = 拿到物品（左下角，“得到：钥匙串、灯泡”） */
export type ToastKind = 'feedback' | 'tutorial' | 'page' | 'system' | 'item';

/** #app 下的层（ARCH §7）；id 即层名。 */
const LAYER_IDS = ['world-markers', 'hud', 'vf', 'subs', 'panels', 'menus', 'fade'] as const;
type LayerKey = (typeof LAYER_IDS)[number];

/** M4 第 2 轮：教学条要“风平浪静”持续这么久（游戏秒）才出；物品/新页提示等过场、对话结束这么久再出。 */
const TUTORIAL_CALM_SEC = 0.5;
const NEWS_CALM_SEC = 0.2;

/** 取景器外可交互的模式：角标、读字等只在这些栈顶下出现。 */
const LOOK_TOPS: ReadonlySet<ModeId> = new Set<ModeId>(['mode.viewfinder', 'mode.replay']);

export class UI {
  readonly hud: HudView;
  readonly vf: ViewfinderHud;
  readonly replay: ReplayHud;
  readonly dialogue: DialogueBox;
  readonly actionMenu: ActionMenu;
  readonly album: AlbumView;
  readonly journal: JournalView;
  readonly doc: DocReader;
  readonly code: CodePanel;
  readonly naming: NamingPanel;
  readonly vcr: VcrPanel;
  readonly console: ConsolePanel;
  readonly tripod: TripodHud;
  readonly read: ReadOverlay;
  readonly menus: Menus;
  readonly fade: FadeLayer;
  /** “点击继续”遮罩（ARCH §4.6） */
  readonly pointerGate: PointerGate;
  /** 字幕与反馈条（#subs；WP6 内部，toast/subtitle 转给它） */
  readonly subs: SubtitleLayer;
  /** 拍照反馈：缩略图飞入画框右下角 + 标题（GDD M2；M1c 补上，WP6 内部） */
  readonly photoToast: PhotoToast;
  /** UI 根节点 .cm-ui（自测与截图用） */
  readonly root: HTMLElement;
  protected readonly host: HTMLElement;
  protected readonly game: Game;
  /** 由 UI.update 按栈驱动显隐的视图与当前显隐 */
  private readonly vis = new Map<View, boolean>();
  private docKey = '';
  private albumKey = '';
  private hidden = false;
  private frameSet = false;
  private frameKey = '';
  private lastFb: string | null = null;
  private emitting = false;
  private foreign: { text: string; speaker?: SpeakerId }[] = [];
  private inputBound = false;
  /** 过场 {osd} 步骤的 OSD 行（engine-wp6.md #3）；过场结束自动清掉 */
  private readonly csOsd: HTMLElement;
  private readonly csOsdText: HTMLElement;
  private readonly csRec: HTMLElement;
  private csOsdValue: string | null = null;
  private wasCutscene = false;
  private t = 0;
  /** M4：本帧拿到的物品（帧末合成一条“得到：…”） */
  private itemQueue: string[] = [];
  /** M4：上次写进根节点的布局变量（对话框、字幕、读字框的高度），变了才写 */
  private layoutKey = '';
  private wasVf = false;
  /**
   * M4 第 2 轮：挂起显示的提示条。教学条（UI.tutorial）等“风平浪静”（栈顶 explore/viewfinder、没有过场/对话/面板/相册/巡夜本/三脚架/暂停、
   * 不在加载、runner 空闲或只在等玩家）持续 0.5 秒再出；“得到：……”与“巡夜本上多了一行字”等过场、对话、巡夜本都结束（面板不算）0.2 秒后再出。
   * 'feedback' 事件与 lastFeedback 照旧在调用时发（状态语义不变），只推迟显示。
   */
  private heldTutorials: string[] = [];
  private heldNews: { text: string; kind: 'page'; onShow?: () => void }[] = [];
  /** 由延后通道显示出去、还挂在屏幕上的教学条（过场/对话一开始就收回，等下次平静再出） */
  private liveTutorials = new Set<string>();
  private calmT = 0;
  private newsT = 0;

  /** WP1 的 Game 构造（M1a 补写）：host 为 #app，UI 在其中建分层 DOM。 */
  constructor(host: HTMLElement, game: Game) {
    this.host = host;
    this.game = game;
    injectStyles(document);
    this.hud = new HudView(game);
    this.vf = new ViewfinderHud(game);
    this.replay = new ReplayHud(game);
    this.dialogue = new DialogueBox(game);
    this.actionMenu = new ActionMenu(game);
    this.album = new AlbumView(game);
    this.journal = new JournalView(game);
    this.doc = new DocReader(game);
    this.code = new CodePanel(game);
    this.naming = new NamingPanel(game);
    this.vcr = new VcrPanel(game);
    this.console = new ConsolePanel(game);
    this.tripod = new TripodHud(game);
    this.read = new ReadOverlay(game);
    this.menus = new Menus(game);
    this.fade = new FadeLayer(game);
    this.pointerGate = new PointerGate(game);
    this.subs = new SubtitleLayer();
    this.photoToast = new PhotoToast(game);

    this.root = h('div', 'cm-ui cm-sub-1');
    const layers = {} as Record<LayerKey, HTMLElement>;
    for (const id of LAYER_IDS) {
      const el = h('div', 'cm-layer');
      el.id = id;
      layers[id] = el;
      this.root.append(el);
    }
    layers['world-markers'].append(this.hud.markersEl);
    layers.hud.append(this.hud.el);
    this.csOsd = h('div', 'cm-csosd cm-hidden');
    const csFrame = h('div', 'cm-frame');
    const csTop = h('div', 'cm-vf-top');
    this.csRec = h('span', 'cm-vf-rec');
    this.csRec.append(h('span', 'cm-rec-dot'), document.createTextNode(STRINGS.hud.rec));
    this.csOsdText = h('span', 'cm-osd');
    csTop.append(this.csRec, this.csOsdText);
    csFrame.append(csTop);
    this.csOsd.append(csFrame);
    layers.vf.append(this.vf.el, this.replay.el, this.tripod.el, this.csOsd, this.photoToast.el);
    layers.subs.append(this.read.el, this.subs.el);
    layers.panels.append(this.vcr.el, this.console.el, this.dialogue.el, this.actionMenu.el, this.album.el,
      this.journal.el, this.doc.el, this.code.el, this.naming.el);
    layers.menus.append(this.menus.el, this.pointerGate.el);
    layers.fade.append(this.fade.el);
    host.append(this.root);

    for (const v of [this.hud, this.vf, this.replay, this.tripod, this.read, this.dialogue, this.actionMenu, this.album,
      this.journal, this.doc, this.code, this.naming, this.vcr, this.console] as View[]) this.vis.set(v, false);

    // 任何反馈/字幕文本都记为 lastFeedback；别处直接发的 'feedback'（没经过 toast/subtitle）留到本帧末尾补显示
    game.events.on('feedback', e => {
      this.lastFb = e.text;
      if (!this.emitting) this.foreign.push({ text: e.text, speaker: e.speaker });
    });
    // M4：拿到物品时屏幕上给一句（原来只有一声音效，抽屉里一口气给的四样东西玩家不知道拿到了什么）。
    // 新游戏、读档、debugSet 不发 'item'，不会误报
    game.events.on('item', e => {
      if (e.kind === 'added') this.itemQueue.push(itemDisplayName(e.id, false));
    });
  }

  /**
   * 同时发 'feedback' 事件。M4 第 2 轮：'page'（巡夜本上多了一行字）在过场/对话/巡夜本期间只排队，结束后再显示；
   * o.onShow 在真正显示时调用（新页的主动机跟着延后）。
   */
  toast(text: string, kind: ToastKind = 'feedback', o?: { onShow?: () => void }): void {
    if (kind === 'page' && this.newsT < NEWS_CALM_SEC) {
      if (!this.heldNews.some(n => n.text === text)) this.heldNews.push(o?.onShow ? { text, kind, onShow: o.onShow } : { text, kind });
    } else {
      this.subs.toast(text, kind);
      o?.onShow?.();
    }
    this.emit(text);
  }
  /** o.kind 'hint'（M4 第 2 轮）：H 的提示——新的提示替换屏幕上旧的提示行，不叠两行。 */
  subtitle(text: string, who?: SpeakerId | '', dur?: number, o?: { kind?: 'hint' }): void {
    this.subs.subtitle(text, who, dur, o?.kind);
    this.emit(text, who === '' ? undefined : who);
  }
  /**
   * M4 第 2 轮：教学条（E.tutorial、第一次聚焦的“E：交互”、第一次读不清的“滚轮：变焦”）。不发 'feedback'；
   * 等“风平浪静”0.5 秒再显示（开场过场、对话、面板里弹出的教学条会盖在片名卡上，还没拿到控制就过期了）。
   */
  tutorial(text: string): void {
    if (this.calmT >= TUTORIAL_CALM_SEC && this.heldTutorials.length === 0) this.showTutorial(text);
    else if (!this.heldTutorials.includes(text)) this.heldTutorials.push(text);
  }
  /** M4 第 2 轮：收起一条教学/反馈条（已显示的淡出，还在排队的撤掉）。 */
  dismiss(text: string): void {
    this.subs.dismiss(text);
    this.heldTutorials = this.heldTutorials.filter(t => t !== text);
    this.liveTutorials.delete(text);
  }
  /** M4 第 2 轮（WP6 内部）：换一局（新游戏、读档、调试开局、截图机位）时丢掉还在排队的教学条与新页提示（上一局的不该出现在这一局）。 */
  resetHeld(): void {
    this.heldTutorials = [];
    this.heldNews = [];
    this.itemQueue = [];
    this.liveTutorials.clear();
  }
  /** M4 第 2 轮（WP6 内部）：“风平浪静”已持续的秒数（教学条的闸门；InteractionSystem 的第一次聚焦教学也看它）。 */
  get calmFor(): number {
    return this.calmT;
  }
  /** 截图时隐藏全部 UI */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    setClass(this.root, 'cm-ui-hidden', hidden);
  }
  /** 4:3 画框随窗口尺寸变化（ARCH §4.7.1） */
  setFrameRect(r: { x: number; y: number; w: number; h: number }): void {
    this.frameSet = true;
    this.applyFrame(r);
  }
  /** “载入中…”（areas.isLoading() 超过 300ms） */
  setLoading(on: boolean): void {
    this.fade.setLoading(on);
  }
  /** 调试 API state() 暴露 */
  lastFeedback(): string | null {
    return this.lastFb;
  }
  /** 当前显示中的字幕（DebugState.subtitle；M1a 补写） */
  currentSubtitle(): string | null {
    return this.subs.current();
  }
  /**
   * 过场 {osd} 步骤的监控 OSD 行（“过场一律用监控固定机位：画面带 OSD”，GDD §3.1）：text 为 null 时收起。
   * 只在 mode.cutscene 在栈上时显示，过场结束自动清空。M1c：UI.update 每帧从 `CutsceneSystem.osdText()` 拉取并调用它，
   * 所以别的系统不必调用（WP6 内部，非冻结签名；engine-wp6.md #3）。
   */
  setOsd(text: string | null): void {
    this.csOsdValue = text;
    setText(this.csOsdText, text ?? '');
  }
  /**
   * 这个 DOM 事件是否落在 UI 的可点元素上（按钮、面板、相册格子、菜单、“点击继续”）。各层本身 pointer-events:none，
   * 所以凡是目标在 UI 根下的鼠标事件都是点在界面上的——InputManager 不应再把它翻译成 MouseLeft 等 Action（engine-wp6.md #14）。
   */
  isUiEventTarget(t: EventTarget | null): boolean {
    return t instanceof Node && t !== this.root && this.root.contains(t);
  }
  /** 是否处于隐藏（截图）状态 */
  isHidden(): boolean {
    return this.hidden;
  }

  /** 每帧（冻结时也调用，ARCH §3.2 第 10 步）：按模式栈显隐各视图、角标投影、字幕计时（M1a 补写） */
  update(dt: number): void {
    const g = this.game;
    if (!this.inputBound) this.bindInput();
    const frozen = g.modes.freezesWorld();
    const gdt = frozen ? 0 : dt;
    const stack = g.modes.stack;
    const top = g.modes.top;

    if (!this.frameSet) this.applyFrame(this.defaultFrame());
    setClass(this.root, 'cm-sub-0', g.settings.subSize === 0);
    setClass(this.root, 'cm-sub-1', g.settings.subSize === 1);
    setClass(this.root, 'cm-sub-2', g.settings.subSize === 2);

    // ---- 菜单：暂停页跟着 mode.pause 走；标题页由 showTitle/select 控制
    const inPause = stack.includes('mode.pause');
    let page = this.menus.currentPage();
    if (inPause && (page === 'none' || page === 'title')) this.menus.showPause();
    else if (!inPause && this.menus.inPauseFlow()) this.menus.hide();
    page = this.menus.currentPage();
    const titleFlow = page === 'title' || page === 'licenses' || (page === 'settings' && !this.menus.inPauseFlow());
    const menuOn = page !== 'none';
    setClass(this.root, 'cm-pause-on', this.menus.inPauseFlow());

    const area = g.areas.current !== null;
    const cutscene = stack.includes('mode.cutscene');
    const inVf = stack.includes('mode.viewfinder');
    const albumArg = stack.includes('mode.album') ? g.modes.arg<AlbumArg>('mode.album') : undefined;
    const albumMenu = !!albumArg && 'menu' in albumArg;
    const jArg: JournalArg = stack.includes('mode.journal') ? g.modes.arg<JournalArg>('mode.journal') : undefined;
    const readState = inVf && LOOK_TOPS.has(top) ? g.sys.read : null;

    const live = !titleFlow && area;
    this.want(this.hud, live && !cutscene && top !== 'mode.tripod');
    this.want(this.vf, live && inVf && !cutscene);
    this.want(this.replay, live && stack.includes('mode.replay') && !cutscene);
    this.want(this.tripod, live && stack.includes('mode.tripod'));
    this.want(this.read, live && !cutscene && readState !== null && (readState.reading !== null || readState.hint !== null));
    this.want(this.dialogue, stack.includes('mode.dialogue') && g.sys.dialogue.active !== null);
    const albumKey = albumArg ? JSON.stringify(albumArg) : '';
    if (albumKey !== this.albumKey) {
      // 子状态变了（菜单 ↔ 挑选器）：让对应视图带着新参数重新 show
      this.albumKey = albumKey;
      if (this.vis.get(this.album)) this.album.show(albumArg);
    }
    this.want(this.actionMenu, stack.includes('mode.album') && albumMenu, albumArg);
    this.want(this.album, stack.includes('mode.album') && !albumMenu, albumArg);
    const docKey = jArg ? `${jArg.doc}|${jArg.vf}` : '';
    if (jArg && docKey !== this.docKey && this.vis.get(this.doc)) this.doc.show(jArg);
    this.docKey = docKey;
    this.want(this.doc, jArg !== undefined, jArg);
    this.want(this.journal, stack.includes('mode.journal') && jArg === undefined);
    this.want(this.code, stack.includes('mode.panel_code') && g.sys.panels.code !== null);
    this.want(this.naming, stack.includes('mode.panel_naming') && g.sys.panels.naming !== null);
    this.want(this.vcr, stack.includes('mode.panel_vcr'));
    this.want(this.console, stack.includes('mode.panel_console'));
    setClass(this.root, 'cm-dlg-open', this.vis.get(this.dialogue) === true);
    // 全屏面板开着：反馈条层升到面板之上（M1d；styles.ts 的 .cm-panel-open）
    setClass(this.root, 'cm-panel-open', this.vis.get(this.code) === true || this.vis.get(this.naming) === true);
    // M4 第 2 轮：录像机/监控台面板（屏幕下方的 deck）开着、没举取景器时，字幕层升到面板之上、字幕排在 deck 上沿之上
    // （“（录像机不录声音）”原来整条压在 deck 底下）；deck 实际高度每帧写进 --cm-deck-h
    const deckOpen = (this.vis.get(this.vcr) === true || this.vis.get(this.console) === true) && !inVf;
    setClass(this.root, 'cm-deck-open', deckOpen);
    setClass(this.root, 'cm-replay-on', this.vis.get(this.replay) === true);
    // M1d：取景器 HUD 显示时字幕让开变焦刻度；面板上叠取景器时拍照缩略图让开右下角的状态行
    setClass(this.root, 'cm-vf-on', this.vis.get(this.vf) === true && this.vis.get(this.replay) !== true);
    setClass(this.root, 'cm-vf-panel', inVf && (stack.includes('mode.panel_vcr') || stack.includes('mode.panel_console')));
    // M4：举起取景器时，还挂着的“右键：用你的眼睛看”教学条已经没用了，收起（免得和读字框、准星挤在一起；还在排队的也撤掉）
    if (inVf && !this.wasVf) this.dismiss(STRINGS.tutorial.viewfinder);
    this.wasVf = inVf;
    // 过场 OSD 从 CutsceneSystem 拉（{osd} 步骤的文本，函数形式已按步骤起算的游戏秒求值；M1c，engine-wp6.md #3）
    if (cutscene) {
      const osd = g.sys.cutscene.osdText();
      if (osd !== this.csOsdValue) this.setOsd(osd);
    } else if (this.wasCutscene) {
      this.setOsd(null);
    }
    this.wasCutscene = cutscene;
    this.t += dt;
    setShown(this.csOsd, cutscene && this.csOsdValue !== null);
    setClass(this.csRec, 'cm-off', (this.t % TIMING.recBlinkSec) >= TIMING.recBlinkSec / 2);

    // ---- “点击继续”：lock 策略的栈顶、锁定可用、当前未锁定、没有菜单盖着（ARCH §4.6）
    const input = g.input;
    const gate = live && !menuOn && input.lockAvailable && !input.pointerLocked && topPointerPolicy(g) === 'lock';
    if (gate && !this.pointerGate.visible) this.pointerGate.show();
    else if (!gate && this.pointerGate.visible) this.pointerGate.hide();

    // ---- 逐个更新（hud 即使隐藏也要走：角标闪烁与时辰强调按游戏时间倒计时）
    this.hud.update(dt);
    for (const [v, on] of this.vis) if (on && v !== this.hud) v.update?.(dt);
    // 拍照反馈卡片：过场与标题/菜单下不显示（过场里 award 的照片由过场自己呈现）
    const photoSuppressed = !live || cutscene || menuOn;
    setClass(this.photoToast.el, 'cm-suppressed', photoSuppressed);
    this.photoToast.update(dt);
    // M4 第 2 轮：照片卡片显示时字幕收窄，不压到卡片（卡片在画框右下角）
    setClass(this.root, 'cm-photo-on', !photoSuppressed && this.photoToast.currentTitle() !== null);
    this.menus.update(dt);
    this.fade.update(dt);
    this.pointerGate.update(dt);
    this.flushForeign();
    this.updateHeld(dt, area && !titleFlow);
    this.subs.update(gdt);
    this.syncLayoutVars();
  }

  /**
   * M4 第 2 轮：挂起的教学条、“得到：……”、新页提示的闸门（与时辰字卡 §15.7.1 同一套“风平浪静”判据）。
   * news（物品、新页）：不在加载、栈上没有过场/对话/巡夜本/暂停、runner 空闲或只在等玩家（面板不拦：密码锁错码给的新页照常显示）。
   * calm（教学）：再加上栈顶是 explore/viewfinder、栈上没有面板/相册/三脚架。
   */
  private updateHeld(dt: number, live: boolean): void {
    const g = this.game;
    const stack = g.modes.stack;
    const top = g.modes.top;
    // 自测里的迷你 Game 可能没有 effects/isLoading：当作空闲
    const eff = (g as { effects?: Game['effects'] }).effects;
    const loading = typeof g.areas?.isLoading === 'function' && g.areas.isLoading();
    const story = stack.some(m => m === 'mode.cutscene' || m === 'mode.dialogue' || m === 'mode.journal' || m === 'mode.pause');
    const news = live && !loading && !story && (!eff || !eff.busy || eff.waitingInput);
    const calm = news && (top === 'mode.explore' || top === 'mode.viewfinder')
      && !stack.some(m => m === 'mode.tripod' || m === 'mode.album' || m.startsWith('mode.panel_'));
    this.newsT = news ? this.newsT + dt : 0;
    this.calmT = calm ? this.calmT + dt : 0;
    // 过场/对话开始时，刚由延后通道弹出、还剩一秒以上没读完的教学条收回来，等下次平静再出（不算教过）
    if (story && this.liveTutorials.size > 0) {
      for (const t of [...this.liveTutorials]) {
        if (this.subs.takeBack(t, 1)) {
          if (!this.heldTutorials.includes(t)) this.heldTutorials.unshift(t);
        }
        this.liveTutorials.delete(t);
      }
    }
    for (const t of this.liveTutorials) if (!this.subs.isShowing(t)) this.liveTutorials.delete(t);
    if (this.newsT >= NEWS_CALM_SEC) {
      if (this.itemQueue.length) {
        this.subs.toast(`${STRINGS.hud.gotItems}${this.itemQueue.join('、')}`, 'item');
        this.itemQueue = [];
      }
      if (this.heldNews.length) {
        const list = this.heldNews;
        this.heldNews = [];
        for (const n of list) {
          this.subs.toast(n.text, n.kind);
          n.onShow?.();
        }
      }
    }
    if (this.calmT >= TUTORIAL_CALM_SEC && this.heldTutorials.length) {
      const list = this.heldTutorials;
      this.heldTutorials = [];
      for (const t of list) this.showTutorial(t);
    }
  }

  private showTutorial(text: string): void {
    this.subs.toast(text, 'tutorial');
    this.liveTutorials.add(text);
  }

  /**
   * M4：分层避让用的布局变量——对话框实际高度（含选项）、字幕框高度、读字框高度写到根节点，
   * styles.ts 据此把字幕排在对话框上沿之上、反馈条排在字幕之上、取景器里字幕排在读字框之上。
   */
  private syncLayoutVars(): void {
    // 只在对应元素显示时量（量高度会强制排版；探索里什么都不开时一次也不量）
    const dlgOn = this.vis.get(this.dialogue) === true;
    const dlg = dlgOn ? this.dialogue.el.offsetHeight : 0;
    const read = this.vis.get(this.read) === true ? this.read.el.offsetHeight : 0;
    const subs = dlgOn ? this.subs.subsHeight() : 0;
    // M4 第 2 轮：录像机/监控台的 deck 高度（字幕排在它上沿之上）
    const deckEl = this.root.classList.contains('cm-deck-open') ? (this.vis.get(this.vcr) ? this.vcr.el : this.console.el).querySelector<HTMLElement>('.cm-deck') : null;
    const deck = deckEl ? deckEl.offsetHeight : 0;
    setClass(this.root, 'cm-read-on', read > 0);
    const key = `${dlg}|${subs}|${read}|${deck}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    const st = this.root.style;
    if (dlg > 0) st.setProperty('--cm-dlg-h', `${dlg}px`);
    st.setProperty('--cm-subs-h', `${subs}px`);
    if (read > 0) st.setProperty('--cm-read-h', `${read}px`);
    if (deck > 0) st.setProperty('--cm-deck-h', `${deck}px`);
  }

  // ---------------------------------------------------------------- 内部

  private want(v: View, on: boolean, arg?: unknown): void {
    const cur = this.vis.get(v) === true;
    if (on === cur) return;
    this.vis.set(v, on);
    if (on) v.show(arg);
    else v.hide();
  }

  private emit(text: string, speaker?: SpeakerId): void {
    this.emitting = true;
    try {
      this.game.events.emit('feedback', speaker ? { text, speaker } : { text });
    } finally {
      this.emitting = false;
    }
    this.lastFb = text;
  }

  /**
   * 别的系统直接 emit 的 'feedback'（没经过 toast/subtitle）在帧末补显示：本帧已由 toast/subtitle 显示过的同一文字、
   * 或正是对话框此刻显示的台词，就不再重复（engine-wp6.md #8）。
   */
  private flushForeign(): void {
    if (this.foreign.length === 0) return;
    const list = this.foreign;
    this.foreign = [];
    const dlg = this.game.sys.dialogue.active;
    for (const f of list) {
      if (dlg && dlg.text === f.text) continue;
      if (this.subs.isShowing(f.text)) continue;
      if (f.speaker) this.subs.subtitle(f.text, f.speaker);
      else this.subs.toast(f.text, 'feedback');
    }
  }

  private bindInput(): void {
    this.inputBound = true;
    this.game.input.onButton((b: Button, down: boolean) => {
      if (!down) return;
      const page = this.menus.currentPage();
      if (page === 'title' || page === 'pause') {
        if (b === 'ArrowUp' || b === 'ArrowDown' || b === 'Enter') this.menus.key(b);
        return;
      }
      if (page === 'licenses') {
        this.menus.key(b);
        return;
      }
      // 标题流程的设置页：Esc 回标题（暂停流程的由 PauseMode 的 back 处理）
      if (page === 'settings' && b === 'Escape' && !this.menus.inPauseFlow()) {
        this.menus.backFromSettings();
        return;
      }
      // M4：设置页只用键盘也能改（↑↓ 选行、←→ 换选项、Enter 换到下一个）
      if (page === 'settings') {
        if (b === 'ArrowUp' || b === 'ArrowDown' || b === 'ArrowLeft' || b === 'ArrowRight' || b === 'Enter') this.menus.key(b);
        return;
      }
      // M4：巡夜本与文档阅读器的正文用键盘翻看（原来方向键在捕获阶段被拦下、journal 模式又不处理）
      if (this.game.modes.top === 'mode.journal') {
        const scroller = this.vis.get(this.doc) ? this.doc : this.vis.get(this.journal) ? this.journal : null;
        if (scroller) {
          if (b === 'ArrowUp' || b === 'ArrowDown') scroller.scrollBy(b === 'ArrowUp' ? -1 : 1);
          else if (b === 'PageUp' || b === 'PageDown' || b === 'Space') scroller.scrollBy(b === 'PageUp' ? -1 : 1, true);
        }
        return;
      }
      // 相册/挑选器：镜像 AlbumMode 的方向键光标（album.ts 顶部的约定）
      if (this.vis.get(this.album) && this.game.modes.top === 'mode.album') {
        if (b === 'ArrowLeft') this.album.nav(-1, 0);
        else if (b === 'ArrowRight') this.album.nav(1, 0);
        else if (b === 'ArrowUp') this.album.nav(0, -1);
        else if (b === 'ArrowDown') this.album.nav(0, 1);
      }
    });
  }

  /** setFrameRect 从未被调用时的兜底：视口中央最大的 4:3 矩形（ARCH §4.7 窗口尺寸）。 */
  private defaultFrame(): { x: number; y: number; w: number; h: number } {
    const W = this.host.clientWidth || window.innerWidth;
    const H = this.host.clientHeight || window.innerHeight;
    if (W / Math.max(1, H) >= 4 / 3) {
      const w = (H * 4) / 3;
      return { x: (W - w) / 2, y: 0, w, h: H };
    }
    const hh = (W * 3) / 4;
    return { x: 0, y: (H - hh) / 2, w: W, h: hh };
  }

  private applyFrame(r: { x: number; y: number; w: number; h: number }): void {
    const key = `${r.x.toFixed(1)},${r.y.toFixed(1)},${r.w.toFixed(1)},${r.h.toFixed(1)}`;
    if (key === this.frameKey) return;
    this.frameKey = key;
    const s = this.root.style;
    s.setProperty('--fx', `${r.x.toFixed(1)}px`);
    s.setProperty('--fy', `${r.y.toFixed(1)}px`);
    s.setProperty('--fw', `${r.w.toFixed(1)}px`);
    s.setProperty('--fh', `${r.h.toFixed(1)}px`);
  }
}

/** 自测用：列出 UI 的全部层元素 id（ARCH §7 的顺序）。 */
export const UI_LAYER_IDS: readonly string[] = LAYER_IDS;
/** 自测用：某视图此刻是否可见（在 UI 根下且没有 .cm-hidden）。 */
export function uiViewShown(ui: UI, v: View): boolean {
  return !v.el.classList.contains('cm-hidden') && ui.root.contains(v.el);
}
