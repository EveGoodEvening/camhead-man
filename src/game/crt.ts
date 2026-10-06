// owner: WP5
// CRT 屏幕控制（ARCH §6.11）：同一块 CRT 屏幕在录像机面板 > 监控台频道（或五路分屏）> 待机（当前频道）之间切换内容。
//
// 内容来源（WP5 内部约定）：VcrSystem.screenContent() 在录像机面板打开且装了带时给出带子画面；
// 否则 ConsoleSystem.screenContent() 给出当前频道 / 五路分屏；两者都没有配置时显示无信号。
// OSD 是控制器自己的一张透明 CanvasTexture（CrtUniforms.osd），文字变化时才重画。

import * as THREE from 'three';
import type { Game } from '../core/game';
import { createCrtScreenMaterial } from '../fx/crtScreen';
import type { CrtScreenMaterial } from '../fx/crtScreen';
import { FONT_STACK } from '../kit/text';
import { PALETTE } from '../data/palette';
import { STRINGS } from '../data/strings';

/** 屏幕此刻要显示的内容（WP5 内部：cctv/vcr → crt）。 */
export interface CrtContent {
  layout: 0 | 1;
  map: THREE.Texture | null;
  ch2: THREE.Texture | null;
  atlas: THREE.Texture | null;
  noSignal: number;
  tunnel: THREE.Texture | null;
  tunnelMix: number;
  split: 0 | 1;
  /** 额外噪声（快进/倒退时的走带雪花） */
  noise: number;
  osd: { line: string; right: string; alarm: boolean; slow: boolean };
}

export const EMPTY_CONTENT: CrtContent = {
  layout: 0, map: null, ch2: null, atlas: null, noSignal: 1, tunnel: null, tunnelMix: 0, split: 0, noise: 0,
  osd: { line: '', right: '', alarm: false, slow: false },
};

const OSD_W = 512;
const OSD_H = 384;

/** 建一张画布（无 DOM 的环境——node 自测——返回 null，调用方跳过绘制）。 */
export function makeCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class CrtScreenController {
  protected readonly game: Game;
  private screen: THREE.Mesh | null = null;
  private original: THREE.Material | THREE.Material[] | null = null;
  private mat: CrtScreenMaterial | null = null;
  private osdCanvas: HTMLCanvasElement | null = null;
  private osdTex: THREE.CanvasTexture | null = null;
  private osdKey = '';
  private time = 0;
  private baseNoise = 0;

  constructor(game: Game) {
    this.game = game;
  }

  /**
   * 把 screen.material 换成本控制器私有的 createCrtScreenMaterial() 实例（即 this.material），detach 时还原原材质；
   * 由 cctv/vcr 的 configure 收到 screen 时调用（同一块屏幕重复 attach 是空操作）。
   * MATERIALS.crtScreen() 是共享的静态外观实例（tapeScene 里的 2023 年 CRT 也用它），不得改它的 uniforms（ARCH §6.11）。
   */
  attach(screen: THREE.Mesh): void {
    if (this.screen === screen) return;
    if (this.screen) this.detach();
    this.screen = screen;
    this.original = screen.material;
    screen.material = this.material;
    this.update(0);
  }

  /** fx/crtScreen.ts 的 createCrtScreenMaterial() 私有实例 */
  get material(): THREE.ShaderMaterial {
    if (!this.mat) {
      this.mat = createCrtScreenMaterial();
      this.baseNoise = this.mat.uniforms.noise.value;
      const osd = this.osdTexture();
      if (osd) this.mat.uniforms.osd.value = osd;
    }
    return this.mat;
  }

  /** 每帧按优先级决定屏幕内容（M1a 补写；ARCH §3.2 第 6 步由 Game.step 调用）。 */
  update(dt: number): void {
    if (!this.screen) return;
    this.time += dt;
    const m = this.material as CrtScreenMaterial;
    const u = m.uniforms;
    const c = this.game.sys.vcr.screenContent() ?? this.game.sys.cctv.screenContent() ?? EMPTY_CONTENT;
    u.time.value = this.time;
    u.layout.value = c.layout;
    u.map.value = c.map;
    u.ch2.value = c.ch2;
    u.atlas.value = c.atlas;
    u.noSignal.value = c.noSignal;
    u.tunnel.value = c.tunnel;
    u.tunnelMix.value = c.tunnelMix;
    u.split.value = c.split;
    u.noise.value = this.baseNoise + c.noise;
    this.drawOsd(c.osd, c.split === 1);
  }

  /** 离开区域时解除绑定并还原 screen.material；未挂接时是空操作（M1a 补写；ARCH §4.5 第 3 步由 AreaContextImpl.dispose() 调用）。 */
  detach(): void {
    if (!this.screen) return;
    if (this.original) this.screen.material = this.original;
    this.screen = null;
    this.original = null;
    const u = this.mat?.uniforms;
    if (u) {
      // 不再引用区域释放掉的 RT/画布贴图
      u.map.value = null;
      u.ch2.value = null;
      u.atlas.value = null;
      u.tunnel.value = null;
    }
  }

  // ------------------------------------------------------------------ WP5 内部

  /** 当前挂接的屏幕网格（自测与照妖镜深度估算用）。 */
  get attached(): THREE.Mesh | null {
    return this.screen;
  }

  /**
   * 录像机/监控台的 feed 在 swap 之后调用：让本帧主画面立刻采样刚渲好的那张（乒乓时另一张正好空出来给下一帧写）。
   * stale（M3）：乒乓里下一次要写的那张；任何槽位还在采样它就一并换成 tex。锁步的 rAF（以及 advancing 期间）只渲染不 step，
   * update() 不会重算内容——开场五路分屏结束后 ch2 槽位留着旧的那张，CH2 连渲两次就“采样自己正在写的 RT”（GL 反馈环）。
   */
  setLiveMap(slot: 'map' | 'ch2', tex: THREE.Texture, stale?: THREE.Texture): void {
    if (!this.mat || !this.screen) return;
    const u = this.mat.uniforms;
    if (slot === 'map' && u.map.value !== null) u.map.value = tex;
    if (slot === 'ch2' && u.ch2.value !== null) u.ch2.value = tex;
    if (stale) {
      if (u.map.value === stale) u.map.value = tex;
      if (u.ch2.value === stale) u.ch2.value = tex;
    }
  }

  private osdTexture(): THREE.CanvasTexture | null {
    if (this.osdTex) return this.osdTex;
    this.osdCanvas = makeCanvas(OSD_W, OSD_H);
    if (!this.osdCanvas) return null;
    this.osdTex = new THREE.CanvasTexture(this.osdCanvas);
    this.osdTex.colorSpace = THREE.SRGBColorSpace;
    return this.osdTex;
  }

  /** OSD 文字：左上时间行、右上 ALARM、右下闪烁的 SLOW；文字没变就不重画。 */
  private drawOsd(o: CrtContent['osd'], split: boolean): void {
    const slowOn = o.slow && Math.floor(this.time * 2.5) % 2 === 0;
    const key = `${o.line}|${o.right}|${o.alarm ? 1 : 0}|${slowOn ? 1 : 0}|${split ? 1 : 0}`;
    if (key === this.osdKey) return;
    this.osdKey = key;
    const cv = this.osdCanvas;
    const g = cv?.getContext('2d');
    if (!cv || !g || !this.osdTex) return;
    g.clearRect(0, 0, OSD_W, OSD_H);
    g.textBaseline = 'top';
    g.font = `bold 20px ${FONT_STACK}`;
    g.shadowColor = 'rgba(0,0,0,0.85)';
    g.shadowBlur = 3;
    g.fillStyle = PALETTE.OSD;
    // 双分屏时左半的 OSD 不能压到右半（右半左上角是着色器画的“CH2”标签）
    if (o.line) g.fillText(o.line, 18, 16, split ? OSD_W / 2 - 30 : OSD_W - 36);
    if (o.right) {
      g.textAlign = 'right';
      g.fillText(o.right, OSD_W - 18, 16);
      g.textAlign = 'left';
    }
    if (o.alarm) {
      g.fillStyle = PALETTE.REC;
      g.font = `bold 24px ${FONT_STACK}`;
      g.textAlign = 'right';
      g.fillText(STRINGS.hud.alarm, OSD_W - 18, o.right ? 44 : 16);
      g.textAlign = 'left';
    }
    if (slowOn) {
      g.fillStyle = PALETTE.OSD;
      g.font = `bold 22px ${FONT_STACK}`;
      g.textAlign = 'right';
      g.textBaseline = 'bottom';
      g.fillText(STRINGS.hud.slow, OSD_W - 18, OSD_H - 16);
      g.textAlign = 'left';
      g.textBaseline = 'top';
    }
    this.osdTex.needsUpdate = true;
  }
}
