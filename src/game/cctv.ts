// owner: WP5
// 监控台（ARCH §6.11；GDD §3.9，M7）：频道源、视频线、照妖镜、五路分屏布局。
//
// - configure 可分次（R1-world 给 screen/viewPose/channels，R1-finale 给 tunnelInner/tunnelBaked），同一字段给两次在 dev 下抛错。
// - live 频道（CH2）与 self 频道（CH1，视频线插上 = 取景器画面）各是一个 AuxFeed，RT 一律两张乒乓（相机看得见正在采样自身 RT 的屏幕，ARCH §6.11）。
//   RT 只在真的要显示时才取（CH1 只在插线后，ARCH §13.3）；feed 在 configure 时注册、clearArea 时注销。
// - static 频道（CH3–5）画进 256×192 画布；五路分屏另画一张 512×384 图集：3 列 × 2 行，按阅读顺序
//   CH1 | CH2 | CH3 / CH4 | CH5 | 日期 OSD；CH2 那一格留空，由 crtScreen 着色器采样 ch2 实时 RT（docs/requests/engine-wp5.md #2）。

import * as THREE from 'three';
import type { ApiResult, CameraPose } from '../core/types';
import { fail, ok } from '../core/types';
import type { Game } from '../core/game';
import type { StateView } from './state';
import type { AuxFeed } from '../core/render';
import type { FeedTarget } from '../fx/feeds';
import { acquireFeed } from '../fx/feeds';
import { layerMaskFor } from '../core/layers';
import { devAssert } from '../core/log';
import { QUALITY, RT_SIZE } from '../data/render';
import { FONT_STACK } from '../kit/text';
import { PALETTE } from '../data/palette';
import { layerMaskBits, poseCamera } from './viewfinder';
import { withAuxHidden } from './mirror';
import type { CrtContent } from './crt';
import { makeCanvas } from './crt';

export type ChannelSource =
  /** CH2：低分辨率实时 */
  | { kind: 'live'; camPose: CameraPose; every?: number }
  /** CH1：视频线插上 = 取景器画面 */
  | { kind: 'self'; noSignal: (g: CanvasRenderingContext2D, w: number, h: number) => void }
  /** CH3–5 */
  | { kind: 'static'; paint: (g: CanvasRenderingContext2D, w: number, h: number, s: StateView, t: number) => void; animate?: boolean };

export interface ConsoleConfig {
  screen: THREE.Mesh;
  viewPose: CameraPose;
  channels: Record<1 | 2 | 3 | 4 | 5, ChannelSource>;
  /** 照妖镜预制：8 层嵌套 CanvasTexture（settings.tunnelMode='baked'） */
  tunnelBaked: () => THREE.Texture;
  /** 隧道最深处画面（椅子上的老周） */
  tunnelInner?: (g: CanvasRenderingContext2D, w: number, h: number, s: StateView) => void;
}

export type CrtLayout = 'single' | 'split5';
type Ch = 1 | 2 | 3 | 4 | 5;

const CHANNELS: readonly Ch[] = [1, 2, 3, 4, 5];
const REQUIRED: readonly (keyof ConsoleConfig)[] = ['screen', 'viewPose', 'channels', 'tunnelBaked'];
const [CH_W, CH_H] = RT_SIZE.ch;
const [ATLAS_W, ATLAS_H] = RT_SIZE.split5Atlas;
/** CH2 半球机位默认视场（广角） */
const LIVE_FOV = 70;
/** 动画频道的重画间隔（游戏时间） */
const ANIM_EVERY = 1 / 12;
const TUNNEL_MAX_DEPTH = 8;
const TUNNEL_INNER_MAX_MIX = 0.9;
/** 实时照妖镜：最深处画面从出现到混满的时长（游戏时间，M4） */
const TUNNEL_INNER_FADE_SEC = 1.5;
/** 切台时的雪花（noSignal 从 1 淡到 0 的时长，游戏时间） */
const SWITCH_SNOW_SEC = 0.25;
/** 屏幕离当前相机超过这么远就不刷新实时画面（M1d：看不清屏幕上的内容，省掉整场景重渲；ARCH §6.11、§13.2） */
const FEED_VISIBLE_DIST = 12;

interface PaintSlot { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; dirty: boolean; lastPaint: number }
interface LiveFeed { ch: Ch; cam: THREE.PerspectiveCamera; target: FeedTarget | null; every: number }

export class ConsoleSystem {
  protected readonly game: Game;
  private cfg: Partial<ConsoleConfig> = {};
  private configured = false;
  private _channel: Ch = 2;
  private _jack = false;
  private _layout: CrtLayout = 'single';
  private depth = 0;
  /** 实时照妖镜最深处画面的当前混入比例（按 TUNNEL_INNER_FADE_SEC 渐变，M4） */
  private innerMix = 0;
  private time = 0;
  private readonly live = new Map<Ch, LiveFeed>();
  private self: { cam: THREE.PerspectiveCamera; target: FeedTarget | null } | null = null;
  private readonly unregister: (() => void)[] = [];
  private readonly slots = new Map<string, PaintSlot>();
  private bakedTex: THREE.Texture | null = null;
  private atlasClock = -1;
  private switchSnow = 0;
  /** 画图集单格用的临时画布（复用） */
  private cellCanvas: HTMLCanvasElement | null = null;

  constructor(game: Game) {
    this.game = game;
    // 静态频道与照妖镜最深处的画面随 flag / 区域临时状态变化
    const markDirty = (): void => {
      for (const s of this.slots.values()) s.dirty = true;
    };
    game.events.on('flag', markDirty);
    game.events.on('temp', markDirty);
    // 过场结束回到单画面（ARCH §6.11 setLayout 注释）
    game.events.on('cutscene:end', () => this.setLayout('single'));
  }

  get channel(): 1 | 2 | 3 | 4 | 5 {
    return this._channel;
  }
  /** 临时状态：视频线是否插在“视频入1” */
  get jack(): boolean {
    return this._jack;
  }
  get layout(): CrtLayout {
    return this._layout;
  }

  /**
   * 可分多次提供字段并合并（R1-world 给 screen/viewPose/channels，R1-finale 给 tunnelInner/tunnelBaked）；
   * 同一字段给两次在 dev 下抛错；区域 build 结束时必须齐全
   */
  configure(c: Partial<ConsoleConfig>): void {
    this.configured = true;
    const cfg = this.cfg as Record<string, unknown>;
    for (const [k, v] of Object.entries(c)) {
      if (v === undefined) continue;
      devAssert(cfg[k] === undefined, `ConsoleSystem.configure: field '${k}' given twice`);
      cfg[k] = v;
    }
    if (c.screen) this.game.sys.crt.attach(c.screen);
    if (c.channels) this.setupFeeds(c.channels);
  }

  /**
   * build 结束时缺失字段列表（M1a 补写；AreaContextImpl.finalize() 调用，dev 下非空即抛错）。
   * 本区从未调用过 configure 时返回 []（只有调用过的区域要求 screen/viewPose/channels/tunnelBaked 齐全）。
   */
  validate(): string[] {
    if (!this.configured) return [];
    const cfg = this.cfg as Record<string, unknown>;
    return REQUIRED.filter(k => cfg[k] === undefined).map(k => `console.${k}`);
  }

  /** 推 mode.panel_console */
  open(): ApiResult {
    if (!this.cfg.screen || !this.cfg.viewPose) return fail('no_such_target');
    const modes = this.game.modes;
    if (modes.has('mode.panel_console')) return ok({ channel: this._channel });
    // 从取景器（或回放）里按 E 打开面板：先弹掉裸取景器/回放再压面板（M1d），面板上要取景器由右键再叠一层——
    // 否则两层 viewfinder 共用一个开关，面板视点上还叠着取景器的后期与 HUD
    while (modes.top === 'mode.replay' || modes.top === 'mode.viewfinder') if (!modes.pop(modes.top).ok) break;
    const r = modes.push('mode.panel_console');
    return r.ok ? ok({ channel: this._channel }) : r;
  }

  select(ch: 1 | 2 | 3 | 4 | 5): ApiResult {
    if (!CHANNELS.includes(ch)) return fail('bad_args');
    if (ch !== this._channel) {
      this._channel = ch;
      this.switchSnow = SWITCH_SNOW_SEC;
      this.game.audio.sfx('dial_click');
      this.game.events.emit('cctv:channel', { channel: ch });
    }
    return ok({ channel: ch });
  }

  /** 'split5'：开场“五路分屏”（GDD §2.2）；过场结束或打开面板时回到 'single' */
  setLayout(l: CrtLayout): void {
    if (l === this._layout) return;
    this._layout = l;
    this.atlasClock = -1;
  }

  /** R1 负责“离桌子 > 2m 自动拔出” */
  plugJack(): ApiResult {
    if (!this.configured) return fail('no_such_target');
    if (!this._jack) {
      this._jack = true;
      this.game.events.emit('jack', { plugged: true });
    }
    return ok({ plugged: true });
  }

  unplugJack(): void {
    if (!this._jack) return;
    this._jack = false;
    // CH1 的乒乓 RT 只在插线期间占用（ARCH §13.3）
    this.self?.target?.dispose();
    if (this.self) this.self.target = null;
    this.depth = 0;
    this.game.events.emit('jack', { plugged: false });
  }

  /** 当前套叠层数（音效渐强用） */
  tunnelDepth(): number {
    return this.depth;
  }

  /** 离开区域：清除配置并注销 feed（M1a 补写；ARCH §4.5 第 3 步由 AreaContextImpl.dispose() 调用） */
  clearArea(): void {
    for (const u of this.unregister) u();
    this.unregister.length = 0;
    for (const f of this.live.values()) f.target?.dispose();
    this.live.clear();
    this.self?.target?.dispose();
    this.self = null;
    for (const s of this.slots.values()) s.tex.dispose();
    this.slots.clear();
    this.bakedTex = null;
    this.cfg = {};
    this.configured = false;
    this._jack = false;
    this._channel = 2;
    this._layout = 'single';
    this.depth = 0;
    this.innerMix = 0;
    this.atlasClock = -1;
  }

  /** ARCH §3.2 第 6 步由 Game.step 调用（“离桌 > 2m 自动拔线”由 R1 做） */
  update(dt: number): void {
    if (!this.configured) return;
    this.time += dt;
    this.switchSnow = Math.max(0, this.switchSnow - dt);
    this.depth = this.computeDepth();
    // 最深处画面随套叠深度在 1.5 秒内淡入（M4）；套叠断了（离开、拔线、换台）立即收回
    const target = Math.min(TUNNEL_INNER_MAX_MIX, Math.max(0, (this.depth - 2) / 3));
    this.innerMix = target <= 0 ? 0 : Math.min(target, this.innerMix + dt * (TUNNEL_INNER_MAX_MIX / TUNNEL_INNER_FADE_SEC));
  }

  // ------------------------------------------------------------------ WP5 内部

  /** 面板视点（取景器叠在监控台上时 fp/photo 取它）。 */
  get viewPose(): CameraPose | null {
    return this.cfg.viewPose ?? null;
  }

  /** CRT 控制器每帧取内容（录像机面板没占用屏幕时）。未配置监控台时 null。 */
  screenContent(): CrtContent | null {
    const cfg = this.cfg;
    if (!this.configured || !cfg.channels) return null;
    const noOsd = { line: '', right: '', alarm: false, slow: false };
    if (this._layout === 'split5') {
      return {
        layout: 1, map: null, ch2: this.live.get(2)?.target?.read ?? null, atlas: this.atlasTexture(),
        noSignal: 0, tunnel: null, tunnelMix: 0, split: 0, noise: 0, osd: noOsd,
      };
    }
    const ch = this._channel;
    const src = cfg.channels[ch];
    const osd = { line: this.osdLine(ch), right: '', alarm: false, slow: false };
    const snow = this.switchSnow / SWITCH_SNOW_SEC;
    const base: CrtContent = { layout: 0, map: null, ch2: null, atlas: null, noSignal: snow, tunnel: null, tunnelMix: 0, split: 0, noise: 0, osd };
    switch (src.kind) {
      case 'live':
        return { ...base, map: this.live.get(ch)?.target?.read ?? null };
      case 'self': {
        if (!this._jack) return { ...base, map: this.slotTexture(`nosig${ch}`, g => src.noSignal(g, CH_W, CH_H), false) };
        const inner = cfg.tunnelInner ? this.slotTexture('inner', g => cfg.tunnelInner?.(g, CH_W, CH_H, this.game.state), false) : null;
        if (this.game.settings.tunnelMode === 'baked') {
          // 预制照妖镜：tunnelMix = 1 时 crtScreen 整屏换成 8 层嵌套贴图并缓慢推近（fx/crtScreen.ts 的约定）
          return { ...base, map: this.self?.target?.read ?? null, tunnel: this.baked(), tunnelMix: 1 };
        }
        // 实时照妖镜：套叠到第 3 层起，把 tunnelInner（最深处的椅子/老周）按比例混进画面中心；必须 < 1（= 1 是预制模式的整屏替换）
        const mix = Math.min(TUNNEL_INNER_MAX_MIX, this.innerMix);
        return { ...base, map: this.self?.target?.read ?? null, tunnel: inner, tunnelMix: inner ? mix : 0 };
      }
      case 'static':
        return { ...base, map: this.slotTexture(`ch${ch}`, g => src.paint(g, CH_W, CH_H, this.game.state, this.game.time), src.animate === true) };
    }
  }

  // ------------------------------------------------------------------ 内部

  private osdLine(ch: Ch): string {
    return this.game.sys.shichen.osdLine(ch);
  }

  private baked(): THREE.Texture | null {
    if (!this.bakedTex && this.cfg.tunnelBaked) this.bakedTex = this.cfg.tunnelBaked();
    return this.bakedTex;
  }

  /** CRT 此刻是否在显示监控台内容（录像机面板占用屏幕时不是）。 */
  private showingConsole(): boolean {
    return this.game.sys.vcr.screenContent() === null;
  }

  /**
   * 屏幕此刻看得见（M1d，性能评审）：面板开着（面板视点正对屏幕）、分屏过场里，或屏幕在当前主相机视锥内且不远于 12m；
   * 红外画面里 CRT 只是一团热斑，看不见内容，也不刷新。实时频道（CH2）与 CH1 自身画面只在看得见时重渲整个场景。
   */
  private screenVisible(): boolean {
    const g = this.game;
    const m = g.modes;
    if (m.has('mode.panel_console') || m.has('mode.panel_vcr')) return true;
    if (this._layout === 'split5' && m.has('mode.cutscene')) return true;
    if (g.pipeline.post?.current && g.pipeline.post.current.ir >= 0.5) return false;
    const screen = this.cfg.screen;
    const cam = g.cameras.camera;
    if (!screen || !cam) return false;
    for (let o: THREE.Object3D | null = screen; o; o = o.parent) if (!o.visible) return false;
    const geo = screen.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    if (!geo.boundingSphere) return false;
    screen.updateWorldMatrix(true, false);
    const sph = this.visSphere.copy(geo.boundingSphere).applyMatrix4(screen.matrixWorld);
    cam.updateMatrixWorld();
    const eye = cam.getWorldPosition(this.visEye);
    if (sph.center.distanceTo(eye) - sph.radius > FEED_VISIBLE_DIST) return false;
    this.visMat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    return this.visFrustum.setFromProjectionMatrix(this.visMat).intersectsSphere(sph);
  }
  private readonly visSphere = new THREE.Sphere();
  private readonly visEye = new THREE.Vector3();
  private readonly visMat = new THREE.Matrix4();
  private readonly visFrustum = new THREE.Frustum();

  private setupFeeds(channels: ConsoleConfig['channels']): void {
    const pipeline = this.game.pipeline;
    for (const ch of CHANNELS) {
      const src = channels[ch];
      if (src.kind === 'live') {
        const cam = new THREE.PerspectiveCamera(src.camPose.fov ?? LIVE_FOV, CH_W / CH_H, 0.05, 60);
        poseCamera(cam, src.camPose);
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);
        // CH2 看得见坐在椅子上的自己（world + self_head，ARCH §4.7）
        cam.layers.mask = layerMaskBits(layerMaskFor('ch2', { vf: false, lens: 'normal', replay: false }));
        const lf: LiveFeed = { ch, cam, target: null, every: src.every ?? 0 };
        this.live.set(ch, lf);
        this.unregister.push(pipeline.addFeed(this.liveFeed(lf)));
      } else if (src.kind === 'self' && !this.self) {
        this.self = { cam: new THREE.PerspectiveCamera(), target: null };
        this.unregister.push(pipeline.addFeed(this.selfFeed(ch)));
      }
    }
  }

  private liveFeed(lf: LiveFeed): AuxFeed {
    return {
      key: `ch${lf.ch}`,
      due: frameNo => {
        const every = Math.max(1, lf.every || QUALITY[this.game.settings.quality].feedEvery);
        const shown = this._layout === 'split5' ? lf.ch === 2 : this._channel === lf.ch;
        // 与镜面错开一帧（镜面用 frameNo % every === 0）：两路辅助 RT 不挤在同一帧（M1d）
        return shown && (frameNo + 1) % every === 0 && this.showingConsole() && this.screenVisible();
      },
      render: r => {
        lf.target ??= acquireFeed(`ch${lf.ch}`, CH_W, CH_H, { pingpong: true });
        const t = lf.target;
        // 渲之前也保证屏幕不采样要写的那张（锁步 rAF 只渲染不 step 时 crt.update 不会重算，M3）
        this.game.sys.crt.setLiveMap(this._layout === 'split5' ? 'ch2' : 'map', t.read, t.write.texture);
        const prev = r.getRenderTarget();
        withAuxHidden(this.game.areas.current?.root, () => {
          r.setRenderTarget(t.write);
          if (!r.autoClear) r.clear();
          r.render(this.game.scene, lf.cam);
        });
        r.setRenderTarget(prev);
        t.swap();
        this.game.sys.crt.setLiveMap(this._layout === 'split5' ? 'ch2' : 'map', t.read, t.write.texture);
      },
    };
  }

  /** CH1 自身画面：每帧把取景器画面渲进乒乓 RT；屏幕显示上一帧，对准屏幕时自然形成无限套叠（X3 照妖镜）。 */
  private selfFeed(ch: Ch): AuxFeed {
    return {
      key: `ch${ch}`,
      due: () => this._jack && this._channel === ch && this._layout === 'single' && this.game.settings.tunnelMode !== 'baked' && this.showingConsole() && this.screenVisible(),
      render: r => {
        const self = this.self;
        if (!self || !this._jack) return;   // 预热时也可能被调用：没插线就什么也不渲
        self.target ??= acquireFeed(`ch${ch}`, CH_W, CH_H, { pingpong: true });
        const t = self.target;
        this.game.sys.crt.setLiveMap('map', t.read, t.write.texture);
        const vf = this.game.sys.viewfinder;
        const src = vf.syncPhotoCamera();
        const cam = self.cam;
        cam.position.copy(src.position);
        cam.quaternion.copy(src.quaternion);
        cam.fov = src.fov;
        cam.aspect = CH_W / CH_H;
        cam.zoom = src.zoom;
        cam.near = src.near;
        cam.far = src.far;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);
        // 插线后是“伙计的眼睛”：取景器开着时就是取景器掩码，否则只有现世层
        cam.layers.mask = vf.on ? vf.fpMaskBits() : layerMaskBits(layerMaskFor('ch1', { vf: false, lens: 'normal', replay: false }));
        const prev = r.getRenderTarget();
        withAuxHidden(this.game.areas.current?.root, () => {
          r.setRenderTarget(t.write);
          if (!r.autoClear) r.clear();
          r.render(this.game.scene, cam);
        });
        r.setRenderTarget(prev);
        t.swap();
        this.game.sys.crt.setLiveMap('map', t.read, t.write.texture);
      },
    };
  }

  /**
   * 套叠层数：CH1 插线且屏幕在取景器画面里正对镜头时，每一层按“屏幕占画框的比例 s”缩小，
   * 直到小于约 2 像素（192 高）为止；s 接近 1 时封顶 8 层。不在 CH1、没插线、屏幕不在画里时为 0。
   */
  private computeDepth(): number {
    const screen = this.cfg.screen;
    const vf = this.game.sys.viewfinder;
    if (!screen || !this._jack || this._channel !== 1 || this._layout !== 'single' || !vf.on) return 0;
    const cam = vf.syncPhotoCamera();
    const b = new THREE.Box3().setFromObject(screen);
    if (b.isEmpty()) return 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const p = new THREE.Vector3();
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const eye = cam.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      if (p.clone().sub(eye).dot(dir) <= 0) return 0;
      p.project(cam);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    if (maxX < -1 || minX > 1 || maxY < -1 || minY > 1) return 0;
    const s = Math.min((maxX - minX) / 2, (maxY - minY) / 2);
    if (s <= 0.02) return 0;
    if (s >= 0.97) return TUNNEL_MAX_DEPTH;
    return Math.max(0, Math.min(TUNNEL_MAX_DEPTH, Math.floor(Math.log(2 / CH_H) / Math.log(s))));
  }

  /** 256×192 画布贴图槽：animate 时按 ANIM_EVERY 重画，否则只在 flag/temp 变化后重画。无 DOM 时返回 null。 */
  private slotTexture(key: string, paint: (g: CanvasRenderingContext2D) => void, animate: boolean): THREE.CanvasTexture | null {
    let s = this.slots.get(key);
    if (!s) {
      const canvas = makeCanvas(CH_W, CH_H);
      if (!canvas) return null;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      s = { canvas, tex, dirty: true, lastPaint: -Infinity };
      this.slots.set(key, s);
    }
    if (s.dirty || (animate && this.time - s.lastPaint >= ANIM_EVERY)) {
      const g = s.canvas.getContext('2d');
      if (g) {
        g.save();
        paint(g);
        g.restore();
        s.tex.needsUpdate = true;
      }
      s.dirty = false;
      s.lastPaint = this.time;
    }
    return s.tex;
  }

  /** 五路分屏图集（3 列 × 2 行：CH1 | CH2 | CH3 / CH4 | CH5 | 日期），每半秒重画一次（钟点在走）。 */
  private atlasTexture(): THREE.CanvasTexture | null {
    const channels = this.cfg.channels;
    if (!channels) return null;
    let s = this.slots.get('atlas');
    if (!s) {
      const canvas = makeCanvas(ATLAS_W, ATLAS_H);
      if (!canvas) return null;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      s = { canvas, tex, dirty: true, lastPaint: -Infinity };
      this.slots.set('atlas', s);
    }
    if (!s.dirty && this.time - this.atlasClock < 0.5) return s.tex;
    this.atlasClock = this.time;
    s.dirty = false;
    const g = s.canvas.getContext('2d');
    if (!g) return s.tex;
    const cw = ATLAS_W / 3;
    const chh = ATLAS_H / 2;
    g.fillStyle = '#000';
    g.fillRect(0, 0, ATLAS_W, ATLAS_H);
    const cell = (i: number, draw: (cg: CanvasRenderingContext2D) => void): void => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const tmp = (this.cellCanvas ??= makeCanvas(CH_W, CH_H));
      if (!tmp) return;
      const cg = tmp.getContext('2d');
      if (!cg) return;
      cg.save();
      cg.clearRect(0, 0, CH_W, CH_H);
      draw(cg);
      cg.restore();
      g.drawImage(tmp, col * cw, row * chh, cw, chh);
    };
    CHANNELS.forEach((ch, i) => {
      if (ch === 2) return;   // CH2 格由着色器采样实时 RT
      const src = channels[ch];
      cell(i, cg => {
        if (src.kind === 'static') src.paint(cg, CH_W, CH_H, this.game.state, this.game.time);
        else if (src.kind === 'self') src.noSignal(cg, CH_W, CH_H);
        else {
          cg.fillStyle = '#111';
          cg.fillRect(0, 0, CH_W, CH_H);
        }
      });
    });
    // 第 6 格：日期 OSD
    cell(5, cg => {
      cg.fillStyle = '#050805';
      cg.fillRect(0, 0, CH_W, CH_H);
      cg.fillStyle = PALETTE.OSD;
      cg.textAlign = 'center';
      cg.textBaseline = 'middle';
      cg.font = `bold 22px ${FONT_STACK}`;
      cg.fillText(this.game.sys.shichen.osdDate(), CH_W / 2, CH_H / 2 - 16);
      cg.fillText(this.game.sys.shichen.clockText(), CH_W / 2, CH_H / 2 + 16);
    });
    // 格线
    g.strokeStyle = 'rgba(124,255,178,0.35)';
    g.lineWidth = 2;
    for (let c = 1; c < 3; c++) {
      g.beginPath();
      g.moveTo(c * cw, 0);
      g.lineTo(c * cw, ATLAS_H);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(0, chh);
    g.lineTo(ATLAS_W, chh);
    g.stroke();
    s.tex.needsUpdate = true;
    return s.tex;
  }
}
