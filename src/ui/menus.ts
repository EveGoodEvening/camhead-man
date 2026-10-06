// owner: WP6
// 标题、暂停、设置与第三方许可菜单（ARCH §3.1、§7）。**没有**确认框：游戏内确认一律是强制对话。
// 菜单按钮 tabindex="-1"，点击后立即 blur()（ARCH §4.6）。
//
// 设置页的选项照 GDD §10.4（字段与取值范围见 game/settings.ts），改动一律经 applySetting(game, key, value)
// （写 game.settings、落盘、发 'settings'；画质改动由它安排重进区域）。
// 键盘：菜单可见时方向键上下移动、Enter 确认（UI 经 InputManager.onButton 转进来）；暂停页的 Esc 由 KEYMAP 的 pause→back 处理，
// 设置页的 Esc 回到打开它的那一页（暂停流程经 PauseMode 调 backFromSettings；标题流程由 UI 的按键镜像调用，M1c）。

import type { Game } from '../core/game';
import type { Button } from '../core/input';
import type { View } from './ui';
import type { Settings } from '../game/settings';
import { applySetting } from '../game/settings';
import { STRINGS } from '../data/strings';
import { SAVE } from '../data/ids';
import { GAME_DATE, SHICHEN_CLOCK, TIMING } from '../data/time';
import { formatTc, parseTc } from '../core/math';
import { h, punctSpans, setClass, setShown, setStyle, setText, stackHas, topPointerPolicy, uiButton } from './dom';
import thirdPartyNotices from '../../public/THIRD_PARTY_NOTICES.txt?raw';

/**
 * M4：暂停页的操作说明（GDD §10.1 摘要；游戏里只有一次性的 4.5 秒教学条，暂停页原来只有“继续”“设置”）。
 */
const CONTROL_ROWS: readonly (readonly [string, string])[] = [
  ['WASD / Shift', '移动 / 快走'],
  ['鼠标', '看（第三人称环绕 / 取景器瞄准）'],
  ['E', '交互；对话里推进'],
  ['右键', '举起 / 放下取景器（伙计的眼睛）'],
  ['左键', '取景器里按快门'],
  ['滚轮', '取景器里变焦'],
  ['Q', '取景器里切常光 / 红外'],
  ['R', '取景器里靠近雪花旋涡倒带；回放中切更早一段'],
  ['F / 空格', '回放中回到现在 / 播放暂停'],
  ['Z / C', '回放中倒退 / 快进 5 秒'],
  ['Tab / J', '相册与物品 / 巡夜本'],
  ['H', '提示（想想土地爷的话）'],
  ['1–4', '对话选项'],
  ['Esc', '暂停（对话与过场中也可）；面板与取景器里是离开'],
];

/** M4 第 2 轮：覆盖进度的二次确认窗口（毫秒，真实时间；UI 基础设施，不是玩法计时）。 */
const CONFIRM_MS = 3000;

/** 菜单项：继续（save.auto）、从寅时重来（save.yin）、新游戏、暂停菜单的继续、设置、第三方许可 */
export type MenuItem = 'continue' | 'yin' | 'new' | 'resume' | 'settings' | 'licenses';

type Page = 'none' | 'title' | 'pause' | 'settings' | 'licenses';

interface SliderSpec { min: number; max: number; step: number; fmt: (v: number) => string }
type SettingRow =
  | { key: keyof Settings; label: string; kind: 'seg'; opts: readonly (readonly [string | number | boolean, string])[] }
  | { key: 'volume' | 'mouseSens' | 'grain'; label: string; kind: 'slider'; spec: SliderSpec };

const S = STRINGS.settings;
const ON_OFF = [[false, S.off], [true, S.on]] as const;
const RT_BAKED = [['rt', S.realtime], ['baked', S.baked]] as const;
/** GDD §10.4 的顺序。 */
const SETTING_ROWS: readonly SettingRow[] = [
  { key: 'volume', label: S.volume, kind: 'slider', spec: { min: 0, max: 1, step: 0.1, fmt: v => `${Math.round(v * 100)}%` } },
  { key: 'mouseSens', label: S.mouseSens, kind: 'slider', spec: { min: 0.2, max: 3, step: 0.1, fmt: v => `${v.toFixed(1)}×` } },
  { key: 'invertY', label: S.invertY, kind: 'seg', opts: ON_OFF },
  { key: 'vfMode', label: S.vfMode, kind: 'seg', opts: [['toggle', S.vfToggle], ['hold', S.vfHold]] },
  { key: 'subSize', label: S.subSize, kind: 'seg', opts: [[0, S.subSizes[0]], [1, S.subSizes[1]], [2, S.subSizes[2]]] },
  { key: 'grain', label: S.grain, kind: 'slider', spec: { min: 0, max: 2, step: 0.25, fmt: v => `${v.toFixed(2)}×` } },
  { key: 'quality', label: S.quality, kind: 'seg', opts: [['low', STRINGS.quality.low], ['mid', STRINGS.quality.mid], ['high', STRINGS.quality.high]] },
  { key: 'reduceFlash', label: S.reduceFlash, kind: 'seg', opts: ON_OFF },
  { key: 'colorAssist', label: S.colorAssist, kind: 'seg', opts: ON_OFF },
  { key: 'hintNoCooldown', label: S.hintNoCooldown, kind: 'seg', opts: ON_OFF },
  { key: 'mirrorMode', label: S.mirrorMode, kind: 'seg', opts: RT_BAKED },
  { key: 'tunnelMode', label: S.tunnelMode, kind: 'seg', opts: RT_BAKED },
];

export class Menus implements View {
  readonly el: HTMLElement;
  protected readonly game: Game;
  private readonly titleScreen: HTMLElement;
  private readonly titleList: HTMLElement;
  private readonly titleOsd: HTMLElement;
  private readonly titleRec: HTMLElement;
  private readonly pauseScreen: HTMLElement;
  private readonly pauseList: HTMLElement;
  private readonly pauseClock: HTMLElement;
  private readonly settingsScreen: HTMLElement;
  private readonly settingsBody: HTMLElement;
  private readonly licensesScreen: HTMLElement;
  private readonly licensesBody: HTMLElement;
  /** M4：标题页的存档损坏提示（toast 在 #subs 层被全屏标题页盖住，GDD §3.13） */
  private readonly titleWarn: HTMLElement;
  /** M4：设置页的行（键盘选择）与当前行号 */
  private settingRows: { row: SettingRow; el: HTMLElement }[] = [];
  private settingsSel = 0;
  private page: Page = 'none';
  private settingsFrom: 'title' | 'pause' = 'title';
  private items: { item: MenuItem; btn: HTMLButtonElement }[] = [];
  private sel = 0;
  private refreshers: (() => void)[] = [];
  private t = 0;

  constructor(game: Game) {
    this.game = game;
    this.el = h('div', 'cm-menus');

    // ---- 标题：一路监控画面（夜雨、扫描线、OSD），左侧标题与菜单
    this.titleScreen = h('div', 'cm-menu-screen');
    const bg = h('div', 'cm-title-bg');
    bg.append(h('div', 'cm-title-rain'));
    const osd = h('div', 'cm-title-osd');
    this.titleRec = h('span', 'cm-vf-rec');
    this.titleRec.append(h('span', 'cm-rec-dot'), document.createTextNode(STRINGS.hud.rec));
    this.titleOsd = h('span', 'cm-osd');
    osd.append(this.titleRec, this.titleOsd);
    const block = h('div', 'cm-title-block');
    const name = h('div', 'cm-title-name');
    name.append(...punctSpans(STRINGS.game.title));
    block.append(name, h('div', 'cm-title-sub', STRINGS.game.subtitle));
    this.titleList = h('div', 'cm-menu-list');
    this.titleWarn = h('div', 'cm-title-warn', STRINGS.save.corrupted);
    setShown(this.titleWarn, false);
    const foot = h('div', 'cm-menu-foot', STRINGS.tutorial.move);
    this.titleScreen.append(bg, h('div', 'cm-scanlines'), h('div', 'cm-vignette'), osd, block, this.titleWarn, this.titleList, foot);

    // ---- 暂停
    this.pauseScreen = h('div', 'cm-menu-screen');
    const ptitle = h('div', 'cm-pause-title', STRINGS.menu.paused);
    this.pauseClock = h('small');
    ptitle.append(this.pauseClock);
    this.pauseList = h('div', 'cm-menu-list');
    const keys = h('div', 'cm-pause-keys');
    const table = document.createElement('table');
    for (const [k, v] of CONTROL_ROWS) {
      const tr = document.createElement('tr');
      tr.append(h('td', undefined, k), h('td', undefined, v));
      table.append(tr);
    }
    keys.append(h('h3', undefined, '操作'), table);
    this.pauseScreen.append(h('div', 'cm-pause-bg'), ptitle, this.pauseList, keys);

    // ---- 设置
    this.settingsScreen = h('div', 'cm-menu-screen');
    const panel = h('div', 'cm-settings');
    this.settingsBody = h('div', 'cm-settings-body');
    const sfoot = h('div', 'cm-settings-foot');
    sfoot.append(uiButton(STRINGS.menu.back, 'cm-btn', () => this.closeSettings()));
    panel.append(h('h2', undefined, STRINGS.menu.settings), this.settingsBody, sfoot);
    this.settingsScreen.append(h('div', 'cm-pause-bg'), panel);
    this.buildSettings();

    // ---- 第三方许可：直接读取发布声明，避免另存一份许可证文案。
    this.licensesScreen = h('div', 'cm-menu-screen');
    const licensesPanel = h('div', 'cm-settings cm-licenses');
    this.licensesBody = h('pre', 'cm-licenses-body', thirdPartyNotices);
    const licensesFoot = h('div', 'cm-settings-foot cm-licenses-foot');
    licensesFoot.append(
      h('span', 'cm-keyhints', STRINGS.menu.licensesHint),
      uiButton(STRINGS.menu.back, 'cm-btn', () => this.showTitle()),
    );
    licensesPanel.append(h('h2', undefined, STRINGS.menu.licenses), this.licensesBody, licensesFoot);
    this.licensesScreen.append(h('div', 'cm-pause-bg'), licensesPanel);

    this.el.append(this.titleScreen, this.pauseScreen, this.settingsScreen, this.licensesScreen);
    for (const s of [this.titleScreen, this.pauseScreen, this.settingsScreen, this.licensesScreen]) {
      s.addEventListener('mousedown', ev => ev.preventDefault());
      setShown(s, false);
    }
  }

  /** 标题菜单：“继续”仅 save.has('save.auto')；“从寅时重来”仅 save.has('save.yin')；“新游戏”总有（ARCH §3.1 第 6 步；M1a 补写） */
  showTitle(): void {
    const save = this.game.save;
    // 存档读不出或校验失败：不显示“继续”，提示“存档损坏，只能重新开始。”（ARCH §3.1、§6.4）。
    // M4：提示写在标题页自己的一行里（toast 在 #subs 层，被全屏的标题页盖住看不见）；save.yin 损坏同样提示
    const auto = save.read(SAVE.AUTO);
    const yin = save.read(SAVE.YIN);
    // M4 第 2 轮：只有 save.yin 坏、save.auto 完好时不说“只能重新开始”（下面明明还有“继续”），单说寅时存档坏了
    const autoBad = !auto.ok && auto.reason !== 'missing';
    const yinBad = !yin.ok && yin.reason !== 'missing';
    setText(this.titleWarn, autoBad ? STRINGS.save.corrupted : STRINGS.save.yinCorrupted);
    setShown(this.titleWarn, autoBad || yinBad);
    this.disarm();
    const list: [MenuItem, string][] = [];
    if (auto.ok) list.push(['continue', STRINGS.menu.continue]);
    if (yin.ok) list.push(['yin', STRINGS.menu.fromYin]);
    list.push(['new', STRINGS.menu.newGame], ['settings', STRINGS.menu.settings], ['licenses', STRINGS.menu.licenses]);
    this.fillList(this.titleList, list);
    this.setPage('title');
  }
  /** 暂停菜单（mode.pause 的 enter 调用；M1a 补写） */
  showPause(): void {
    this.fillList(this.pauseList, [['resume', STRINGS.menu.resume], ['settings', STRINGS.menu.settings]]);
    this.setPage('pause');
  }
  /** 执行菜单项：'new' → game.newGame()；'continue' → continueFrom('save.auto')；'yin' → continueFrom('save.yin')；'resume' → 弹出 mode.pause。?new=1 与调试 API newGame() 走同一个函数（M1a 补写） */
  async select(item: MenuItem): Promise<void> {
    const g = this.game;
    switch (item) {
      case 'new':
        this.hide();
        await g.newGame();
        return;
      case 'continue':
      case 'yin': {
        this.hide();
        const ok = await g.continueFrom(item === 'yin' ? SAVE.YIN : SAVE.AUTO);
        if (!ok) this.showTitle();
        return;
      }
      case 'resume':
        if (stackHas(g, 'mode.pause')) g.modes.pop('mode.pause');
        this.hide();
        return;
      case 'settings':
        this.settingsFrom = this.page === 'pause' || stackHas(g, 'mode.pause') ? 'pause' : 'title';
        this.refreshSettings();
        this.setPage('settings');
        this.settingsSel = 0;
        this.markSettingsRow();
        return;
      case 'licenses':
        this.setPage('licenses');
        this.licensesBody.scrollTop = 0;
        return;
    }
  }

  show(_arg?: unknown): void {
    if (this.page !== 'none') return;
    if (stackHas(this.game, 'mode.pause')) this.showPause();
    else this.showTitle();
  }
  hide(): void {
    this.setPage('none');
  }

  /** 当前页（UI 用来决定其他层是否让位）。 */
  currentPage(): Page {
    return this.page;
  }
  /** 暂停页，或从暂停页打开的设置页（mode.pause 被弹出时 UI 一并收起它们）。 */
  inPauseFlow(): boolean {
    return this.page === 'pause' || (this.page === 'settings' && this.settingsFrom === 'pause');
  }

  /** 菜单导航与阅读：设置页用方向键改值；许可页用 ↑↓/PageUp/PageDown/空格滚动，Enter/Esc 返回标题。 */
  key(b: Button): void {
    if (this.page === 'licenses') {
      if (b === 'Escape' || b === 'Enter') this.showTitle();
      else if (b === 'ArrowUp' || b === 'ArrowDown' || b === 'PageUp' || b === 'PageDown' || b === 'Space') {
        const body = this.licensesBody;
        const lh = parseFloat(getComputedStyle(body).lineHeight) || 30;
        const dir = b === 'ArrowUp' || b === 'PageUp' ? -1 : 1;
        const step = b === 'ArrowUp' || b === 'ArrowDown' ? lh : Math.max(lh, body.clientHeight - lh * 1.5);
        body.scrollTop += dir * step;
      }
      return;
    }
    if (b !== 'ArrowUp' && b !== 'ArrowDown' && b !== 'ArrowLeft' && b !== 'ArrowRight' && b !== 'Enter') return;
    if (this.page === 'settings') {
      this.settingsKey(b);
      return;
    }
    if (b === 'ArrowLeft' || b === 'ArrowRight') return;
    if (this.page !== 'title' && this.page !== 'pause') return;
    if (this.items.length === 0) return;
    if (b === 'Enter') {
      const it = this.items[this.sel];
      if (it) this.activate(it.item);
      return;
    }
    const d = b === 'ArrowUp' ? -1 : 1;
    this.sel = (this.sel + d + this.items.length) % this.items.length;
    this.items.forEach((it, i) => setClass(it.btn, 'cm-sel', i === this.sel));
    if (this.armed && this.items[this.sel]?.item !== this.armed.item) this.disarm();
  }

  update(dt: number): void {
    this.t += dt;
    if (this.armed && performance.now() - this.armed.at > CONFIRM_MS) this.disarm();
    if (this.page === 'title') {
      // 装饰：标题画面是一路 CH1 监控，从子时起点开始走秒
      const sec = parseTc(SHICHEN_CLOCK.zi.start) + Math.floor(this.t);
      setText(this.titleOsd, `CH1 ${GAME_DATE.before} ${formatTc(sec)}`);
      setClass(this.titleRec, 'cm-off', (this.t % TIMING.recBlinkSec) >= TIMING.recBlinkSec / 2);
    } else if (this.page === 'pause') {
      setText(this.pauseClock, this.game.areas.current ? `${this.game.sys.shichen.hudLabel()}　${this.game.sys.shichen.clockText()}` : '');
    }
  }

  // ---------------------------------------------------------------- 内部

  private setPage(p: Page): void {
    if (p !== this.page) this.disarm();
    this.page = p;
    setShown(this.titleScreen, p === 'title');
    setShown(this.pauseScreen, p === 'pause');
    setShown(this.settingsScreen, p === 'settings');
    setShown(this.licensesScreen, p === 'licenses');
    if (p === 'title') this.bindItems(this.titleList);
    else if (p === 'pause') this.bindItems(this.pauseList);
    else this.items = [];
  }

  private fillList(list: HTMLElement, entries: readonly (readonly [MenuItem, string])[]): void {
    list.replaceChildren(...entries.map(([item, label]) => {
      const b = uiButton(label, 'cm-menu-item', () => this.activate(item));
      b.dataset.item = item;
      b.addEventListener('mouseenter', () => {
        const i = this.items.findIndex(x => x.btn === b);
        if (i >= 0) { this.sel = i; this.items.forEach((it, k) => setClass(it.btn, 'cm-sel', k === i)); }
        if (this.armed && this.armed.item !== item) this.disarm();
      });
      return b;
    }));
  }

  private bindItems(list: HTMLElement): void {
    this.items = [...list.querySelectorAll<HTMLButtonElement>('button.cm-menu-item')].map(btn => ({ item: btn.dataset.item as MenuItem, btn }));
    this.sel = 0;
    this.items.forEach((it, i) => setClass(it.btn, 'cm-sel', i === 0));
  }

  /**
   * M4 第 2 轮：有可覆盖的进度（save.auto 读得出）时，“新游戏”“从寅时重来”要按两次——第一次只把按钮换成“再按一次：覆盖当前进度”，
   * 3 秒内（真实时间，UI 基础设施）对同一项再激活才执行；移到别的项或超时就撤销。不弹确认框（本文件头的约定）。
   * 只管玩家的点击/回车（activate）；select() 本身（?new=1、调试 API newGame）照旧直接执行。
   */
  private armed: { item: MenuItem; at: number; btn: HTMLButtonElement; label: string } | null = null;

  private needsConfirm(item: MenuItem): boolean {
    if (item !== 'new' && item !== 'yin') return false;
    if (this.page !== 'title') return false;
    return this.game.save.read(SAVE.AUTO).ok;
  }

  private disarm(): void {
    const a = this.armed;
    if (!a) return;
    this.armed = null;
    a.btn.textContent = a.label;
    setClass(a.btn, 'cm-warn', false);
  }

  /** 点击/回车触发（用户手势）：“继续”回到需要锁定指针的模式时顺手请求锁定，省掉一次“点击继续”。 */
  private activate(item: MenuItem): void {
    if (this.needsConfirm(item)) {
      const now = performance.now();
      const a = this.armed;
      if (!a || a.item !== item || now - a.at > CONFIRM_MS) {
        this.disarm();
        const entry = this.items.find(x => x.item === item);
        if (entry) {
          this.armed = { item, at: now, btn: entry.btn, label: entry.btn.textContent ?? '' };
          entry.btn.textContent = STRINGS.menu.confirmOverwrite;
          setClass(entry.btn, 'cm-warn', true);
          return;
        }
      }
    }
    this.disarm();
    void this.select(item).then(() => {
      const g = this.game;
      if (item === 'resume' && g.input.lockAvailable && !g.input.pointerLocked && topPointerPolicy(g) === 'lock') g.input.requestPointerLock();
    });
  }

  /**
   * 设置页的 Esc（M1c）：回到打开它的那一页（暂停页或标题页），不关掉整个暂停。
   * 暂停流程里 PauseMode 收到 back 时先问这里；标题页没有模式接 Esc，由 UI 的按键镜像调用。返回是否处理了。
   */
  backFromSettings(): boolean {
    if (this.page !== 'settings') return false;
    this.closeSettings();
    return true;
  }

  private closeSettings(): void {
    if (this.settingsFrom === 'pause' && stackHas(this.game, 'mode.pause')) this.showPause();
    else if (this.settingsFrom === 'title') this.showTitle();
    else this.hide();
  }

  /** 设置页的键盘操作（M4）。 */
  private settingsKey(b: 'ArrowUp' | 'ArrowDown' | 'Enter' | 'ArrowLeft' | 'ArrowRight'): void {
    const n = this.settingRows.length;
    if (n === 0) return;
    if (b === 'ArrowUp' || b === 'ArrowDown') {
      this.settingsSel = (this.settingsSel + (b === 'ArrowUp' ? -1 : 1) + n) % n;
      this.markSettingsRow();
      return;
    }
    const { row } = this.settingRows[this.settingsSel]!;
    const dir = b === 'ArrowLeft' ? -1 : 1;
    const cur = this.game.settings[row.key];
    if (row.kind === 'seg') {
      const i = row.opts.findIndex(([v]) => v === cur);
      const k = b === 'Enter' ? (i + 1) % row.opts.length : Math.min(row.opts.length - 1, Math.max(0, i + dir));
      const v = row.opts[k]?.[0];
      if (v !== undefined && v !== cur) this.apply(row.key, v);
    } else if (b !== 'Enter') {
      const { spec } = row;
      const v = Math.min(spec.max, Math.max(spec.min, (cur as number) + dir * spec.step));
      this.apply(row.key, Number(v.toFixed(4)));
    }
  }

  private markSettingsRow(): void {
    this.settingRows.forEach((r, i) => setClass(r.el, 'cm-sel', i === this.settingsSel));
  }

  private buildSettings(): void {
    this.refreshers = [];
    this.settingRows = [];
    for (const row of SETTING_ROWS) {
      const r = h('div', 'cm-set-row');
      this.settingRows.push({ row, el: r });
      r.append(h('span', 'cm-set-label', row.label));
      if (row.kind === 'seg') {
        const seg = h('div', 'cm-seg');
        const btns = row.opts.map(([v, label]) => {
          const b = uiButton(label, '', () => {
            this.apply(row.key, v);
          });
          seg.append(b);
          return [v, b] as const;
        });
        this.refreshers.push(() => {
          const cur = this.game.settings[row.key];
          for (const [v, b] of btns) setClass(b, 'cm-on', cur === v);
        });
        r.append(seg);
      } else {
        const { spec } = row;
        const wrap = h('div', 'cm-slider');
        const track = h('div', 'cm-slider-track');
        const fill = h('div', 'cm-slider-fill');
        track.append(fill);
        const val = h('span', 'cm-slider-val');
        const set = (v: number): void => {
          const snapped = Math.round((Math.min(spec.max, Math.max(spec.min, v)) - spec.min) / spec.step) * spec.step + spec.min;
          this.apply(row.key, Number(snapped.toFixed(4)));
        };
        const fromX = (x: number): void => {
          const rect = track.getBoundingClientRect();
          set(spec.min + ((x - rect.left) / Math.max(1, rect.width)) * (spec.max - spec.min));
        };
        track.addEventListener('mousedown', ev => {
          ev.preventDefault();
          fromX(ev.clientX);
        });
        // M4：按住拖动（原来只能点）
        track.addEventListener('mousemove', ev => {
          if ((ev.buttons & 1) === 1) fromX(ev.clientX);
        });
        wrap.append(
          uiButton('−', 'cm-step', () => set(this.game.settings[row.key] - spec.step)),
          track,
          uiButton('+', 'cm-step', () => set(this.game.settings[row.key] + spec.step)),
          val,
        );
        this.refreshers.push(() => {
          const cur = this.game.settings[row.key];
          setStyle(fill, 'width', `${(((cur - spec.min) / (spec.max - spec.min)) * 100).toFixed(1)}%`);
          setText(val, spec.fmt(cur));
        });
        r.append(wrap);
      }
      this.settingsBody.append(r);
    }
  }

  private apply(key: keyof Settings, value: string | number | boolean): void {
    // 取值来自上面的固定表，与 Settings[key] 的类型一一对应；applySetting 自己还会再校验一次
    applySetting(this.game, key, value as Settings[typeof key]);
    this.refreshSettings();
  }

  private refreshSettings(): void {
    for (const f of this.refreshers) f();
  }
}
