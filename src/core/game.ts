// owner: WP1
// Game（ARCH §3、§4.4）：启动、主循环、step()、advance()、新游戏/读档、子系统装配。
//
// 装配约定（M1a 冻结，ARCH §4.4）：
// - 只有本文件在运行时 import 各系统类（main.ts 动态 import 本文件，ARCH §3.1）；其他模块对 Game 一律 `import type`，避免循环依赖。
// - 所有系统/模式处理器/UI 的构造函数签名是 `constructor(game: Game)`（例外见 ARCH §4.4 装配表），
//   构造函数里只能保存 game 引用、订阅 game.events，不得访问其他系统（它们可能尚未创建）；跨系统引用在调用时经 game.sys.* 取。

import * as THREE from 'three';
import type { ActionResult, Action } from './actions';
import type { ModeHandler } from './modes';
import type { AreaKey, Settle } from './types';
import { EventBus } from './events';
import type { GameEvents } from './events';
import { parseUrl } from './url';
import type { UrlOptions } from './url';
import { createRenderer, RenderPipeline } from './render';
import { CameraRig } from './cameras';
import { InputManager } from './input';
import { ModeStack } from './modes';
import { AreaManager } from './area';
import type { AreaPlaceSnapshot } from './area';
import { CollisionWorld } from './collision';
import { PlayerController } from './player';
import { TriggerSystem } from './triggers';
import { DEV_CHECKS, devAssert } from './log';
import { F, SPAWN } from '../data/ids';
import type { CutsceneId, SpawnId } from '../data/ids';
import { STRINGS } from '../data/strings';
import { detectCjk } from '../kit/text';
import { resetEnvironmentCache } from '../fx/environment';
import { AREAS } from '../areas';
import { GameState } from '../game/state';
import { E, EffectRunner, createGameApi } from '../game/effects';
import type { GameApi } from '../game/effects';
import { SaveSystem } from '../game/save';
import { loadSettings } from '../game/settings';
import type { Settings } from '../game/settings';
import { InteractionSystem } from '../game/interaction';
import { NpcSystem } from '../game/npc';
import { ViewfinderSystem } from '../game/viewfinder';
import { PhotoSystem } from '../game/photo';
import { ReadSystem } from '../game/read';
import { ReplaySystem } from '../game/replay';
import { VcrSystem } from '../game/vcr';
import { ConsoleSystem } from '../game/cctv';
import { CrtScreenController } from '../game/crt';
import { MirrorSystem } from '../game/mirror';
import { TripodSystem } from '../game/tripod';
import { DialogueSystem } from '../game/dialogue';
import { CutsceneSystem } from '../game/cutscene';
import { PanelSystem } from '../game/panels';
import { JournalSystem } from '../game/journal';
import { HintSystem } from '../game/hints';
import { ShichenSystem } from '../game/shichen';
import { ExploreMode } from '../game/modes/explore';
import { ViewfinderMode } from '../game/modes/viewfinder';
import { ReplayMode } from '../game/modes/replay';
import { PanelVcrMode } from '../game/modes/panelVcr';
import { PanelConsoleMode } from '../game/modes/panelConsole';
import { PanelCodeMode } from '../game/modes/panelCode';
import { PanelNamingMode } from '../game/modes/panelNaming';
import { DialogueMode } from '../game/modes/dialogue';
import { AlbumMode } from '../game/modes/album';
import { JournalMode } from '../game/modes/journal';
import { TripodMode } from '../game/modes/tripod';
import { CutsceneMode } from '../game/modes/cutscene';
import { PauseMode } from '../game/modes/pause';
import { UI } from '../ui/ui';
import { AudioEngine } from '../audio/engine';
import { PostPipeline } from '../fx/post';
import { createPlayerModel } from '../rigs/player';
import type { PlayerModel } from '../rigs/player';

export interface GameCaps { webgl2: boolean; cjk: boolean; maxAnisotropy: number }

export interface GameSystems {
  interaction: InteractionSystem; npc: NpcSystem; viewfinder: ViewfinderSystem; photo: PhotoSystem; read: ReadSystem;
  replay: ReplaySystem; vcr: VcrSystem; cctv: ConsoleSystem; crt: CrtScreenController; mirror: MirrorSystem;
  tripod: TripodSystem; dialogue: DialogueSystem; cutscene: CutsceneSystem; panels: PanelSystem;
  journal: JournalSystem; hints: HintSystem; shichen: ShichenSystem;
}

export class Game {
  readonly host: HTMLElement;
  readonly caps: GameCaps;
  readonly url: UrlOptions;
  readonly events: EventBus<GameEvents>;
  readonly renderer: THREE.WebGLRenderer;
  readonly pipeline: RenderPipeline;
  /** 唯一场景；区域内容挂在 areas.current.root 下 */
  readonly scene: THREE.Scene;
  readonly cameras: CameraRig;
  readonly input: InputManager;
  readonly modes: ModeStack;
  readonly state: GameState;
  readonly effects: EffectRunner;
  readonly save: SaveSystem;
  readonly settings: Settings;
  readonly areas: AreaManager;
  readonly collision: CollisionWorld;
  readonly player: PlayerController;
  readonly playerModel: PlayerModel;
  readonly triggers: TriggerSystem;
  readonly audio: AudioEngine;
  readonly ui: UI;
  readonly sys: GameSystems;
  /** 给区域与 Effect 的受限门面（ARCH §6.3） */
  readonly api: GameApi;
  /** ?test=1&lockstep=1 */
  readonly lockstep: boolean;
  /** 累计游戏时间（秒；冻结时不走） */
  time = 0;
  /** 默认 1 */
  timeScale = 1;
  frameNo = 0;
  /** 运行期结局状态（不存档）：GameApi.endingDone 写入，DebugState.ending 读取；新游戏/读档时复位为 'none'（M1a 补写） */
  ending: 'none' | 'main' | 'nanke' = 'none';

  constructor(host: HTMLElement) {
    this.host = host;
    this.url = parseUrl();
    this.lockstep = this.url.test && this.url.lockstep;
    this.caps = { webgl2: false, cjk: false, maxAnisotropy: 1 };
    this.events = new EventBus<GameEvents>();
    this.settings = loadSettings();
    // ?quality= 覆盖只改内存：不落盘、不发 'settings'（ARCH §4.4）
    if (this.url.quality) this.settings.quality = this.url.quality;
    this.scene = new THREE.Scene();
    this.renderer = createRenderer();   // WebGL2 不可用时抛 NoWebGL2Error（main.ts 显示 'no_webgl2' 错误页）
    // canvas 放在 #app 最底层（UI 的各层随后由 UI 构造函数追加在它上面，ARCH §7）
    host.prepend(this.renderer.domElement);
    this.caps.webgl2 = true;
    this.caps.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.cameras = new CameraRig(this);
    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.cameras, new PostPipeline(this.renderer, this.scene, this.cameras.camera));
    this.input = new InputManager(this);
    this.modes = new ModeStack(this);
    this.state = new GameState(this);
    this.effects = new EffectRunner(this);
    this.save = new SaveSystem(this);
    this.collision = new CollisionWorld(this);
    this.player = new PlayerController(this);
    this.playerModel = createPlayerModel();
    // M4：第三人称相机太近时主角的头和身子淡一点（小房间里别挡住要看的东西）
    this.playerModel.watchCamera?.(this.cameras.tp);
    this.triggers = new TriggerSystem(this);
    this.audio = new AudioEngine({ muted: this.url.test || this.url.mute });
    this.sys = {
      interaction: new InteractionSystem(this),
      npc: new NpcSystem(this),
      viewfinder: new ViewfinderSystem(this),
      photo: new PhotoSystem(this),
      read: new ReadSystem(this),
      replay: new ReplaySystem(this),
      vcr: new VcrSystem(this),
      cctv: new ConsoleSystem(this),
      crt: new CrtScreenController(this),
      mirror: new MirrorSystem(this),
      tripod: new TripodSystem(this),
      dialogue: new DialogueSystem(this),
      cutscene: new CutsceneSystem(this),
      panels: new PanelSystem(this),
      journal: new JournalSystem(this),
      hints: new HintSystem(this),
      shichen: new ShichenSystem(this),
    };
    this.ui = new UI(host, this);
    this.api = createGameApi(this);
    this.areas = new AreaManager(this, AREAS);
    const handlers: ModeHandler[] = [
      new ExploreMode(this), new ViewfinderMode(this), new ReplayMode(this),
      new PanelVcrMode(this), new PanelConsoleMode(this), new PanelCodeMode(this), new PanelNamingMode(this),
      new DialogueMode(this), new AlbumMode(this), new JournalMode(this), new TripodMode(this),
      new CutsceneMode(this), new PauseMode(this),
    ];
    for (const h of handlers) this.modes.register(h);
  }

  /** ARCH §3.1 */
  async boot(): Promise<void> {
    // 2. context lost / restored（ARCH §3.1 第 2 步）
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      this.onContextLost();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.onContextRestored().catch(err => console.error('[Game] context restored', err));
    });
    // 3. 字体就绪后做 CJK 字形检测
    try {
      await document.fonts.ready;
    } catch {
      /* 没有 FontFaceSet 的环境：按系统字体检测 */
    }
    this.caps.cjk = detectCjk();
    // 4. 共享资源：玩家模型常驻场景（进第一个区域前先藏起来，标题菜单后面不留一个孤零零的人）
    this.scene.add(this.playerModel.root);
    this.playerModel.root.visible = false;
    this.pipeline.onResize = () => {
      this.ui.setFrameRect(this.cameras.frameRect());
      // M4 第 2 轮：暂停页不再逐帧渲染，窗口尺寸变了要补画一帧
      this.forceRender = true;
    };
    this.pipeline.setQuality(this.settings.quality);
    this.pipeline.setDynamicResolution(!this.url.test);
    this.watchResize();
    this.pipeline.post.applySettings({ grain: this.settings.grain, reduceFlash: this.settings.reduceFlash });
    this.audio.setVolume(this.settings.volume);
    this.events.on('settings', e => this.onSetting(e.key));
    this.input.attach();
    this.modes.refresh();
    // 5. 全局索引与静态校验
    this.areas.init();
    // 8. 主循环先跑起来：进区域的淡入淡出按游戏时间计，非锁步时要靠它推进
    this.timer.connect(document);
    this.renderer.setAnimationLoop(this.frame);
    // 9. 音频在第一次 pointerdown/keydown 时解锁；页面隐藏时挂起并暂停
    this.setupAudioUnlock();
    document.addEventListener('visibilitychange', () => this.onVisibility());
    // 6/7. 标题或直接开局
    if (this.url.newGame) this.save.clearAll();
    if (this.url.area) await this.startDebugArea(this.url.area, this.url.spawn);
    else if (this.url.newGame) await this.ui.menus.select('new');
    else this.ui.menus.showTitle();
  }
  /** 唯一的动作入口（输入与调试 API 共用） */
  dispatch(a: Action): ActionResult {
    return this.modes.dispatch(a);
  }
  /** ARCH §3.2 */
  step(dt: number, render: boolean): void {
    devAssert(!this.inStep, 'Game.step 不可重入');
    this.inStep = true;
    this.stepDt = dt;
    try {
      this.frameNo++;
      // 1–2. 本帧按钮 → Action → 模式栈
      this.input.beginFrame();
      this.flushButtons();
      const frozen = this.modes.freezesWorld();
      const area = this.areas.current;
      // 建区期间（卸载旧区到放好玩家）与标题画面（没有区域）不跑模拟
      const sim = !frozen && !this.areas.building && area !== null;
      if (sim) {
        // 3. 模式
        this.modes.update(dt);
        this.applyLook();
        // 4. 玩家（walkTo 先把本帧移动轴喂给 InputManager）
        this.player.driveWalk();
        this.player.update(dt, this.input.move, this.modes.moveMode());
        // 5. 触发体
        this.triggers.update();
        // 6. 系统（顺序固定，ARCH §3.2）
        const s = this.sys;
        s.npc.update(dt);
        s.interaction.update(dt);
        s.viewfinder.update(dt);
        s.read.evaluate();
        s.replay.update(dt);
        s.vcr.update(dt);
        s.cctv.update(dt);
        s.crt.update(dt);
        s.tripod.update(dt);
        s.cutscene.update(dt);
        s.dialogue.update(dt);
        s.journal.update();
        s.hints.update(dt);
        s.shichen.update(dt);
        // 7. 区域
        area.def.update?.(area.ctx, dt);
        area.ctx.updateViews();
        area.ctx.timers.update(dt);
        // 8. 异步 Effect
        this.effects.pump(dt);
        // 9. 时间、玩家模型、相机
        this.time += dt;
        this.playerModel.update(dt, this.player, this.modes.top);
        this.cameras.update(dt);
        this.audio.setListener(this.cameras.camera.position, this.player.yaw);
      }
      // 10. UI（冻结时也更新）
      this.ui.update(dt);
      // 11. 渲染：dt 取自上次渲染以来的游戏时间（advance 期间不渲染，最后一帧一次性交给后期的淡入淡出）
      this.pendingRenderDt += dt;
      if (render) {
        // M4 第 2 轮：暂停页开着、进暂停后已经画过 PAUSE_RENDER_FRAMES 帧就不再画（世界冻结，画面不变；preserveDrawingBuffer 为 false，
        // 不提交新帧时画布保留最后一帧）——集显笔记本挂在暂停页不再满负荷。窗口尺寸变了、上下文刚恢复时补画（forceRender）。
        const paused = this.modes.top === 'mode.pause';
        this.pausedFrames = paused ? this.pausedFrames + 1 : 0;
        if (paused && this.pausedFrames > PAUSE_RENDER_FRAMES && !this.forceRender) {
          this.pipeline.holdDynamicResolution(500);
          // 恢复后的第一帧只补一小段后期动画时间（原来暂停期间每帧都在走）
          this.pendingRenderDt = Math.min(this.pendingRenderDt, 0.1);
        } else {
          this.forceRender = false;
          this.pipeline.render(this.pendingRenderDt);
          this.pendingRenderDt = 0;
          this.checkLights();
        }
      }
      // 12–13
      this.save.flushIfSafe();
      this.events.emit('frame', { dt });
    } finally {
      this.inStep = false;
    }
    // 帧末的推迟动作（M1d）：结局播完回标题、推迟的画质重进。放在 step 之外的同一调用里，
    // 这样它们不会在某个模式切换/Effect 的同步回调中途发生（例如三脚架成功时先弹 mode.tripod 再开结局 run）
    this.runDeferred();
  }
  /** ARCH §3.4：无渲染快进 */
  advance(sec: number, fixedDt?: number, until?: () => boolean): Promise<void> {
    if (this.inStep) return Promise.reject(new Error('Game.advance() 不能在 step() 内调用'));
    // 串行：同一时刻只有一个 advance 在推进（进区域的淡入淡出、settle、wait 可能同时想推进时间）
    const run = (): Promise<void> => this.advanceImpl(sec, fixedDt ?? 1 / 30, until);
    const p = this.advanceChain.then(run, run);
    this.advanceChain = p.then(() => undefined, () => undefined);
    return p;
  }
  /** 推进（锁步下调用 advance）直到 effects.settled()，ARCH §6.3 */
  async settle(o?: { maxGameSec?: number; maxRealMs?: number }): Promise<Settle> {
    const maxReal = o?.maxRealMs ?? 60_000 * (this.url?.slow ?? 1);
    const maxGame = o?.maxGameSec ?? 600;
    const t0 = performance.now();
    const g0 = this.time;
    for (;;) {
      const st = this.settleState();
      if (st) return st;
      if (performance.now() - t0 > maxReal || this.time - g0 > maxGame) throw timeoutError('Game.settle');
      if (this.lockstep) {
        // 每轮都让出一次宏任务：短 advance 只走微任务，连着调会饿死建区里的真实异步（compileAsync、预热）
        if (!this.inStep && !this.advancing) await this.advance(0.25, 1 / 30, () => this.settleState() !== null);
        await macrotask();
      } else {
        await this.nextFrame();
      }
    }
  }
  /** 同步渲染一帧（缩略图、截图用） */
  renderNow(): void {
    this.pipeline.renderMain(0);
  }
  /** 等到下一次 rAF 渲染完成 */
  nextFrame(): Promise<void> {
    return new Promise(resolve => this.frameWaiters.push(resolve));
  }
  async newGame(): Promise<void> {
    this.ending = 'none';
    this.save.clearCompleted();
    this.state.reset();
    this.resetRun();
    await this.areas.enter('r1', SPAWN.R1_START, { reason: 'new' });
    // 开场过场不等它播完：boot/newGame 在第一句等输入之前就返回（调试 API 用 dlg() 推进）
    this.playCutscene('r1', 'cs.r1.intro');
  }
  async continueFrom(slot: 'save.auto' | 'save.yin'): Promise<boolean> {
    const r = this.save.load(slot);
    if (!r.ok) return false;
    this.ending = 'none';
    if (slot === 'save.yin') this.save.clearCompleted();
    // 读到已叫醒过的存档：视同已通关（GDD §3.13、ARCH §6.4）
    if (this.state.flag(F.R1_CALLED_AT_DAWN)) {
      this.save.markCompleted();
      this.ui.menus.showTitle();
      return false;
    }
    this.resetRun();
    const abnormal = this.state.flag(F.R1_SOUL_RETURNED);
    // 异常存档（soul_returned 却没叫醒）：进 R1 后直接播天亮那段
    const area = abnormal ? 'r1' : r.data.area;
    const spawn = abnormal && r.data.area !== 'r1' ? SPAWN.R1_START : r.data.spawn;
    await this.areas.enter(area, spawn, { reason: 'load' });
    if (abnormal) this.playCutscene('r1', 'cs.r1.dawn');
    return true;
  }
  /**
   * 以 spawnUsed 重新进入（画质切换、context 恢复）。
   * M1d：结局期间（save.held，三脚架之后到片尾）重进会丢掉正在播的结局——context 恢复时按读档的规则处理：
   * 已叫醒（r1.called_at_dawn）视同通关、回标题；已归位未叫醒（r1.soul_returned）重进 R1 后补播 cs.r1.dawn（ARCH §6.4“异常存档”）。
   * 画质切换在结局期间不会走到这里（推迟到 hold 释放，见 requestReenter）。
   */
  async reenterCurrentArea(reason: 'quality' | 'context_restored'): Promise<void> {
    const cur = this.areas.current;
    if (reason === 'quality') this.pipeline.setQuality(this.settings.quality);
    if (!cur) return;
    // M4：画质切换原地重进——回到原位、还原区域临时状态（原来被传回区域入口，暗房红灯之类全部复位）
    if (reason === 'quality') {
      const snap = this.areas.snapshotPlace();
      await this.areas.enter(cur.def.id, cur.spawnUsed, { reason: 'quality', ...(snap ? { restore: snap } : {}) });
      return;
    }
    if (reason === 'context_restored' && this.save.held) {
      if (this.state.flag(F.R1_CALLED_AT_DAWN)) {
        this.save.markCompleted();
        await this.toTitle();
        return;
      }
      await this.areas.enter(cur.def.id, cur.spawnUsed, { reason: 'restored' });
      if (this.state.flag(F.R1_SOUL_RETURNED)) this.playCutscene('r1', 'cs.r1.dawn');
      return;
    }
    await this.areas.enter(cur.def.id, cur.spawnUsed, { reason: 'restored' });
  }
  /**
   * 推迟的区域重进（M1d，ARCH §6.4）：画质切换一律经这里。Game.step 末尾在“可以安全重进”时执行：栈顶 explore/viewfinder、
   * 栈上没有临时模式、runner 空闲（没有进行中的顶层 run，例如三脚架成功后刚开始的结局过场）、没有存档 hold（结局期间）、不在加载中。
   * 没有区域（标题画面）时立即把画质交给渲染管线，下次进区域自然用新画质。
   */
  requestReenter(reason: 'quality'): void {
    if (!this.areas.current) {
      if (reason === 'quality') this.pipeline.setQuality(this.settings.quality);
      return;
    }
    this.pendingReenter = reason;
  }
  /**
   * 回到标题（M1d，ARCH §4.4、§6.4）：取消一切 Effect、清栈、淡出后卸载当前区域（areas.leave）、复位主角模型与取景器光学，
   * 然后显示标题菜单。结局播完（GameApi.endingDone 写通关标记的那一次）由引擎在 runner 空闲后自动调用；
   * context 恢复时读到已叫醒的结局状态也走这里。
   */
  async toTitle(): Promise<void> {
    this.titlePending = false;
    this.pendingReenter = null;
    this.pausePending = false;
    const seq = ++this.runSeq;
    this.effects.cancelAll('reset');
    if (this.modes.stack.length > 1) this.modes.resetTo('mode.explore');
    await this.areas.leave();
    // 淡出期间已经开了新局/读了档（调试 API 可以在标题出现前就调用）：不再显示标题
    if (seq !== this.runSeq) return;
    this.resetPlayerModel();
    this.playerModel.root.visible = false;
    this.sys.viewfinder.resetOptics();
    this.ui.menus.showTitle();
    this.modes.refresh();
    // 标题菜单要用鼠标点：结局最后回到 explore 时可能又锁上了指针，这里释放（下次进区域 enter 里的 modes.refresh() 再按模式策略锁定）
    this.input.applyPolicy('free');
  }
  /**
   * 结局播完后回标题（M1d）：GameApi.endingDone 在写通关标记时调用；Game.step 末尾等 runner 空闲、不在过场与加载中时执行 toTitle()。
   */
  returnToTitleWhenIdle(): void {
    this.titlePending = true;
  }
  /**
   * 意外解锁、页面隐藏、context lost 时压暂停（M1d）：区域/楼层/传送的淡入淡出期间不压（暂停冻结世界，淡入淡出就永远走不完，
   * 暂停页还被 #fade 盖住），记下来，等过渡结束（AreaManager 的最后一个 endTransition）再压。
   */
  requestPause(): void {
    if (!this.areas.current) return;
    if (this.areas.isLoading()) {
      this.pausePending = true;
      return;
    }
    this.pausePending = false;
    if (this.modes.top !== 'mode.pause') this.modes.push('mode.pause');
  }
  /** AreaManager 的最后一个过渡结束时调用：补压过渡期间推迟的暂停（M1d）。WP1 内部。 */
  transitionsEnded(): void {
    if (!this.pausePending) return;
    this.pausePending = false;
    if (this.areas.current && this.modes.top !== 'mode.pause') this.modes.push('mode.pause');
  }

  // ---------------------------------------------------------------- WP1 内部（不属于冻结签名）
  private readonly timer = new THREE.Timer();
  private inStep = false;
  private advancing = false;
  private advanceChain: Promise<void> = Promise.resolve();
  private frameWaiters: (() => void)[] = [];
  private pendingRenderDt = 0;
  private stepDt = 0;
  private expectedLights = -1;
  private lightAssertFired = false;
  private readonly reportedErrors = new Set<string>();
  private loadingShown = false;
  /** 结局播完、等 runner 空闲后回标题（M1d） */
  private titlePending = false;
  /** 推迟的画质重进（M1d） */
  private pendingReenter: 'quality' | null = null;
  /** 过渡期间推迟的暂停（M1d） */
  private pausePending = false;
  /** M4：WebGL 上下文丢失时卸下的区域与玩家位置（恢复后原地重进） */
  private lostPlace: AreaPlaceSnapshot | null = null;
  /** 每开一局/回一次标题加一：toTitle 淡出期间开了新局时不再显示标题（M1d） */
  private runSeq = 0;
  /** M4 第 2 轮：进暂停后已经渲染的帧数（超过 PAUSE_RENDER_FRAMES 就不再渲染）；forceRender = 下一帧无论如何都画 */
  private pausedFrames = 0;
  private forceRender = false;
  /** M4 第 2 轮：WebGL 上下文丢失以来“页面可见”的真实毫秒数（null = 没丢失）；超过 15 秒换成“请刷新页面” */
  private lostVisibleMs: number | null = null;
  private lostLastAt = 0;

  /** 当前 step 的 dt（TriggerSystem.onStay 用）。 */
  frameDt(): number {
    return this.stepDt;
  }

  /** 是否正在 advance()（调试）。 */
  get isAdvancing(): boolean {
    return this.advancing;
  }

  /**
   * 推进游戏直到 done() 为真：非锁步时等 rAF 帧（rAF 在走 step）；锁步时自己 advance，
   * 但若已经身处 step 或另一个 advance 之中（例如出口触发体在 walk() 的 advance 里触发了进区域），只让出宏任务、等外层去推进。
   */
  async drive(done: () => boolean, maxGameSec = 120): Promise<void> {
    const g0 = this.time;
    // 真实时间上限（M1d）：只累计“世界在走、页面可见”的时间，单次间隔最多记 250ms——暂停菜单开着、标签页切走（rAF 停摆，
    // 切回来第一帧的间隔可能是几分钟）时游戏时间本来就不走，不能因此判超时（否则淡入淡出抛错、黑幕永远不退）
    let realMs = 0;
    let last = performance.now();
    while (!done()) {
      const now = performance.now();
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (!hidden && !this.modes.freezesWorld()) realMs += Math.min(250, Math.max(0, now - last));
      last = now;
      if (realMs > 90_000 * (this.url?.slow ?? 1)) throw timeoutError('Game.drive（真实时间）');
      if (!this.lockstep) {
        await this.nextFrame();
        continue;
      }
      if (this.inStep || this.advancing) {
        await macrotask();
        continue;
      }
      if (this.time - g0 > maxGameSec) throw timeoutError('Game.drive（游戏时间）');
      await this.advance(0.5, 1 / 30, done);
      if (!done()) await macrotask();
    }
  }

  /** 等 sec 秒游戏时间（进区域与换楼层的淡入淡出用；冻结时不走）。 */
  waitGame(sec: number): Promise<void> {
    const target = this.time + Math.max(0, sec);
    return this.drive(() => this.time >= target - 1e-9, sec + 30);
  }

  /** AreaManager.enter 第 5 步之后调用：记下本区压入渲染的灯数（dev 下此后每帧断言恒定，ARCH §4.7）。 */
  areaReady(): void {
    this.playerModel.root.visible = true;
    // M4：进区域后的头一秒（着色器预热、贴图上传的长帧）不算进动态分辨率的帧时
    this.pipeline.holdDynamicResolution(1000);
    this.expectedLights = this.pipeline.stats().lights;
    this.lightAssertFired = false;
  }

  private settleState(): Settle | null {
    if (this.areas.isLoading()) return null;
    if (!this.effects.busy) return 'idle';
    if (this.effects.waitingInput) return 'waiting';
    // 冻结模式（暂停、相册、巡夜本）下 runner 不会前进：那就是在等玩家
    if (this.modes.freezesWorld()) return 'waiting';
    return null;
  }

  private async advanceImpl(sec: number, fixedDt: number, until?: () => boolean): Promise<void> {
    this.advancing = true;
    const t0 = performance.now();
    try {
      const dtMax = fixedDt > 0 ? fixedDt : 1 / 30;
      let remaining = Math.max(0, sec);
      if (remaining <= 1e-9) this.step(0, false);
      let n = 0;
      while (remaining > 1e-9) {
        // 建区期间（异步的 build/预编译/预热）不消耗预算：advance(sec) 保证推进 sec 秒“有区域的”游戏时间
        if (this.areas.building) {
          if (performance.now() - t0 > 90_000) throw timeoutError('Game.advance（等待建区）');
          await macrotask();
          continue;
        }
        const dt = Math.min(dtMax, remaining);
        this.step(dt, false);
        remaining -= dt;
        if (until?.()) break;
        if (++n % 30 === 0) await macrotask();
      }
    } finally {
      this.advancing = false;
    }
    // 结束后渲染一帧（锁步下画面停在推进后的时刻）；渲染失败不影响模拟结果
    try {
      this.pipeline.render(this.pendingRenderDt);
      this.pendingRenderDt = 0;
    } catch (err) {
      this.reportError('Game.advance render', err);
    }
  }

  private readonly frame = (timestamp: number): void => this.onFrame(timestamp);

  /** rAF 回调体（拆成方法便于自测）。 */
  private onFrame(timestamp: number): void {
    this.timer.update(timestamp);
    const real = Math.min(this.timer.getDelta(), 0.1);
    // M4 第 2 轮：动态分辨率按 rAF 的时间戳（垂直同步时刻）采样帧间隔；原来用渲染结束后的 performance.now()，
    // 间隔 = 16.7ms ± 相邻两帧工作量之差，60Hz 屏上降档后几乎永远升不回来（ARCH §13.2）
    this.pipeline.frameStamp = timestamp;
    if (this.lostVisibleMs !== null) this.tickContextLost();
    // M4：建区/加载中的长帧不算进动态分辨率（结束后再等 1 秒）
    if (this.areas?.building || this.areas?.isLoading()) this.pipeline.holdDynamicResolution(1000);
    try {
      if (this.lockstep) {
        // 锁步：rAF 只渲染；真实按键照样翻译派发、鼠标照样转视角（都不推进游戏时间），画面相关的 UI/相机按 dt=0 就位
        this.input.beginFrame();
        this.flushButtons();
        if (this.areas.current && !this.areas.building && !this.modes.freezesWorld()) this.applyLook();
        this.ui.update(0);
        this.cameras.update(0);
        this.pipeline.render(this.pendingRenderDt);
        this.pendingRenderDt = 0;
      } else if (this.advancing) {
        this.pipeline.render(0);
      } else {
        this.step(real * this.timeScale, true);
      }
      this.updateLoadingOverlay();
    } catch (err) {
      this.reportError('Game.frame', err);
    }
    const waiters = this.frameWaiters;
    this.frameWaiters = [];
    for (const w of waiters) w();
  }

  /** 本帧鼠标视角 → 玩家 yaw/pitch；取景器里按倍率降低灵敏度，高倍率下才瞄得住。 */
  private applyLook(): void {
    const via: 'fp' | 'tp' = this.cameras.active === 'fp' ? 'fp' : 'tp';
    if (this.modes.lookEnabled()) {
      const l = this.input.lookDelta;
      const k = via === 'fp' ? 1 / Math.max(1, this.sys.viewfinder.zoom) : 1;
      this.player.applyLook(l.dx * k, l.dy * k, via);
    }
    this.player.clampPitch(via);
  }

  private flushButtons(): void {
    for (const ev of this.input.takeFrameButtons()) {
      const a = this.input.translate(ev.b, ev.down);
      if (a) this.dispatch(a);
    }
  }

  /** 同一条错误只报一次：rAF 里每帧都抛同一个错时不刷屏（harness 仍会因为 console.error 判失败）。 */
  private reportError(where: string, err: unknown): void {
    const key = `${where}:${err instanceof Error ? err.message : String(err)}`;
    if (this.reportedErrors.has(key)) return;
    this.reportedErrors.add(key);
    console.error(`[${where}]`, err);
  }

  private checkLights(): void {
    if (!DEV_CHECKS || this.lightAssertFired || this.expectedLights < 0 || this.areas.building || !this.areas.current) return;
    const n = this.pipeline.stats().lights;
    if (n !== this.expectedLights) {
      this.lightAssertFired = true;
      devAssert(false, `区域 ${this.areas.current.def.id} 压入渲染的灯数从 ${this.expectedLights} 变成了 ${n}（灯挂在被隐藏的节点下？ARCH §4.7）`);
    }
  }

  /**
   * “载入中…”：建区一开始就 setLoading(true)、结束立即 setLoading(false)；300ms 的延迟（TIMING.loadingDelayMs）
   * 由 UI 自己做（engine-wp6.md #7），这里不再等，否则实际是 600ms。
   */
  private updateLoadingOverlay(): void {
    const show = this.areas.building;
    if (show === this.loadingShown) return;
    this.loadingShown = show;
    this.ui.setLoading(show);
  }

  private async startDebugArea(area: AreaKey, spawn: string | null): Promise<void> {
    const def = this.areas.defs.get(area);
    if (!def) return;
    this.ending = 'none';
    this.state.reset();
    this.resetRun();
    const spawns = Object.keys(def.spawns) as SpawnId[];
    const s = spawn !== null && (spawns as string[]).includes(spawn) ? (spawn as SpawnId) : spawns[0];
    if (!s) throw new Error(`?area=${area}：该区域没有出生点`);
    await this.areas.enter(area, s, { reason: 'debug' });
  }

  private playCutscene(area: AreaKey, id: CutsceneId): void {
    // 区域还没提供这段过场（M2 之前的占位区域）时不播，免得 CutsceneSystem 报未登记
    if (!this.areas.defs.get(area)?.cutscenes?.some(c => c.id === id)) return;
    this.effects.run([E.cutscene(id)], `game:${id}`).catch(err => console.error(`[Game] ${id}`, err));
  }

  private onContextLost(): void {
    // M4 第 2 轮：常驻遮罩（原来是 4 秒就消失的系统反馈条）；15 秒（真实时间、只计页面可见的时间）还没恢复就请玩家刷新
    this.ui.fade.setLostOverlay(STRINGS.boot.contextLost);
    this.lostVisibleMs = 0;
    this.lostLastAt = performance.now();
    // M4：趁旧的 GL 资源管理器还在，同步卸载当前区域（释放落在已丢失的上下文上，静默无害）；恢复后原地重进。
    // 结局期间（save.held）仍走原来的重进规则（reenterCurrentArea），这里只记下暂停
    if (this.areas.current && !this.save.held && !this.areas.building) {
      this.lostPlace = this.areas.unloadForContextLoss();
      if (this.lostPlace) {
        // PMREM 环境贴图缓存也在这时释放（恢复之后再 dispose 旧上下文的 RT 会报“object does not belong to this context”）
        resetEnvironmentCache();
        return;
      }
    }
    this.requestPause();
  }

  /** 上下文丢失期间每个 rAF：累计页面可见的真实时间（单次间隔最多记 250ms），超过 15 秒换文案。 */
  private tickContextLost(): void {
    const now = performance.now();
    const gap = Math.min(250, Math.max(0, now - this.lostLastAt));
    this.lostLastAt = now;
    if (typeof document !== 'undefined' && document.hidden) return;
    const before = this.lostVisibleMs ?? 0;
    this.lostVisibleMs = before + gap;
    if (before < CONTEXT_DEAD_MS && this.lostVisibleMs >= CONTEXT_DEAD_MS) this.ui.fade.setLostOverlay(STRINGS.boot.contextDead);
  }

  private async onContextRestored(): Promise<void> {
    this.lostVisibleMs = null;
    this.ui.fade.setLostOverlay(null);
    this.forceRender = true;
    // three 在 restored 时自己重建 GL 状态；RT 由各系统在重新进区域时重新申请，PMREM 缓存要清掉
    resetEnvironmentCache();
    const lost = this.lostPlace;
    this.lostPlace = null;
    if (!lost) {
      await this.reenterCurrentArea('context_restored');
      return;
    }
    await this.areas.enter(lost.area, lost.spawn, { reason: 'restored', restore: lost });
    // 丢失前压了暂停（或本来就该暂停）：恢复后停在暂停页，玩家确认再继续
    if (this.areas.current && this.modes.top !== 'mode.pause') this.modes.push('mode.pause');
    this.forceRender = true;
    this.pausedFrames = 0;
  }

  private onVisibility(): void {
    if (document.hidden) {
      this.audio.suspend();
      if (!this.url.test) this.requestPause();
    } else if (this.modes.top !== 'mode.pause') {
      // M4：切回标签页时暂停菜单还开着就先不出声（“继续”时 PauseMode.exit 再恢复）
      this.audio.resume();
    }
  }

  /**
   * 音频在用户手势时解锁（M4：给多次机会）：Esc 与 Shift/Ctrl/Alt/Meta 按下不算激活手势，这时建出来的 AudioContext 是 suspended、
   * resume() 被拒——原来第一次按键就把监听摘了，整局没有声音。现在直到 AudioContext 真的 running 才摘；另外也听 click。
   */
  private setupAudioUnlock(): void {
    if (this.url.test || this.url.mute) return;
    const types = ['pointerdown', 'keydown', 'click'] as const;
    const remove = (): void => {
      for (const t of types) window.removeEventListener(t, onGesture, true);
    };
    const onGesture = (e: Event): void => {
      if (this.audio.running) {
        remove();
        return;
      }
      if (e instanceof KeyboardEvent && (e.key === 'Escape' || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta')) return;
      this.audio.unlock().then(() => {
        if (this.audio.running) remove();
      }).catch(err => console.error('[Game] audio unlock', err));
    };
    for (const t of types) window.addEventListener(t, onGesture, true);
  }

  private onSetting(key: keyof Settings): void {
    const s = this.settings;
    // M4 第 2 轮：暂停页（设置页）里改了颗粒/闪光等设置，补画一帧让画面跟上
    this.forceRender = true;
    if (key === 'grain' || key === 'reduceFlash') this.pipeline.post.applySettings({ grain: s.grain, reduceFlash: s.reduceFlash });
    else if (key === 'volume') this.audio.setVolume(s.volume);
    // quality：applySetting 自己调用 requestReenter('quality')（M1d：由 step 末尾在安全时重进），这里不重复
  }

  /**
   * 换一局时的运行期复位（新游戏、读档、?area= 调试开局；M1d 补上主角模型）：时辰钟、提示进度、取景器光学（§6.8.1）、
   * 主角模型（显隐、透明度、姿势、头装回、视频线收回——上一局的结局可能让身子不见、头留在门楣上）、推迟的动作。
   */
  private resetRun(): void {
    this.runSeq++;
    this.titlePending = false;
    this.pendingReenter = null;
    this.sys.shichen.resetClock();
    this.sys.hints.resetProgress();
    this.sys.viewfinder.resetOptics();
    this.resetPlayerModel();
    // M4 第 2 轮：上一局还在排队的教学条/新页提示不带进这一局
    this.ui.resetHeld();
  }

  private resetPlayerModel(): void {
    this.playerModel.reset();
  }

  /** Game.step 末尾（step 之外）：结局后回标题、推迟的画质重进（M1d）。 */
  private runDeferred(): void {
    if (this.inStep || this.areas.isLoading()) return;
    if (this.titlePending) {
      if (this.effects.busy || this.modes.has('mode.cutscene')) return;
      this.titlePending = false;
      this.toTitle().catch(err => console.error('[Game] toTitle', err));
      return;
    }
    if (this.pendingReenter) {
      const top = this.modes.top;
      const safe = (top === 'mode.explore' || top === 'mode.viewfinder') && !this.modes.isTransient();
      if (!safe || this.effects.busy || this.save.held) return;
      const reason = this.pendingReenter;
      this.pendingReenter = null;
      this.reenterCurrentArea(reason).catch(err => console.error('[Game] reenter', err));
    }
  }

  /** ResizeObserver 与 DPR 变化共用一个 150ms 防抖的 resize()（ARCH §4.7.1；防抖是 UI 基础设施，不是玩法计时）。 */
  private watchResize(): void {
    let handle = 0;
    const kick = (): void => {
      window.clearTimeout(handle);
      handle = window.setTimeout(() => this.pipeline.resize(), 150);
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(kick).observe(this.host);
    else window.addEventListener('resize', kick);
    const watchDpr = (): void => {
      const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', () => {
        kick();
        watchDpr();
      }, { once: true });
    };
    watchDpr();
  }
}

/** M4 第 2 轮：进暂停后再渲染这么多帧（让暂停那一刻的画面、淡入的暂停页落定），之后停止渲染直到离开暂停。 */
const PAUSE_RENDER_FRAMES = 2;
/** M4 第 2 轮：WebGL 上下文丢失超过这么久（真实毫秒、页面可见）还没恢复 → “画面无法恢复，请刷新页面”。 */
const CONTEXT_DEAD_MS = 15_000;

function macrotask(): Promise<void> {
  // 让出一次宏任务（基础设施：给 rAF、网络、Playwright 的 evaluate 留机会；不属于玩法计时）
  return new Promise(resolve => setTimeout(resolve, 0));
}

function timeoutError(what: string): Error {
  const e = new Error(`${what}: timeout`);
  e.name = 'TimeoutError';
  return e;
}
