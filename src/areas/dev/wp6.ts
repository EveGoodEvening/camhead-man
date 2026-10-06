// owner: WP6
// WP6 在开发沙盒里的测试夹具（ARCH §15.2 “沙盒要包含的夹具”），并用 debug/selftest.ts 的 registerSelftest('wp6.<snake>', fn) 登记页面内自测；
// scripts/selftest/wp6.mjs 经调试 API 的 selftest(name)（?debug=1&area=dev）调用。
//
// UI 没有要摆进场景的夹具（角标、挑选器、面板用的是别的 WP 布置的交互物与面板），所以 AreaPart 为空，只登记自测。
// 自测分两类：
//   - M1B_SELFTESTS：只依赖 M1a 基础件与 WP6 自己（UI 实例、事件总线、纯函数），M1b 就用 scripts/selftest/wp6.mjs --standalone 跑通；
//   - 其余（wp6.markers、wp6.album_mode）要真实的交互系统、模式栈与 KEYMAP，M1c 起经调试 API 的 selftest 跑。
// 注意：src/areas 下不得出现定时器/存储/指针锁定等字样（check.mjs），等待一律用 requestAnimationFrame 轮询。

import type { AreaPart } from '../../core/area';
import type { Game } from '../../core/game';
import type { SelftestResult } from '../../debug/selftest';
import { registerSelftest } from '../../debug/selftest';
import { STRINGS } from '../../data/strings';
import { TAPE } from '../../data/time';
import { UI_LAYER_IDS, uiViewShown } from '../../ui/ui';
import type { View } from '../../ui/ui';
import { showBootError } from '../../ui/bootError';
import { albumEntries, albumNav } from '../../ui/album';
import { markRange, parseFaded, splitStains } from '../../ui/docReader';
import { replayOsd } from '../../ui/replayHud';
import { indexLabelGroups } from '../../ui/vcrPanel';

const wp6: AreaPart = {};

export default wp6;

/** M1b 就能通过的自测（scripts/selftest/wp6.mjs --standalone 用假 Game 跑它们）。 */
export const M1B_SELFTESTS: readonly string[] = [
  'wp6.layers', 'wp6.buttons_tabindex', 'wp6.menu_blur', 'wp6.loading_delay', 'wp6.boot_error', 'wp6.frame_rect',
  'wp6.feedback', 'wp6.subtitle', 'wp6.hidden', 'wp6.album_nav', 'wp6.doc_segments', 'wp6.replay_osd', 'wp6.vcr_index',
];

class Notes {
  readonly notes: string[] = [];
  check(cond: unknown, msg: string): void {
    if (!cond) this.notes.push(msg);
  }
  result(): SelftestResult {
    return this.notes.length ? { ok: false, notes: this.notes } : { ok: true };
  }
}

/** 真实时间等待（只用 rAF 轮询，见文件头）。 */
async function waitMs(ms: number): Promise<void> {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) await new Promise<void>(r => requestAnimationFrame(() => r()));
}

function allViews(game: Game): View[] {
  const u = game.ui;
  return [u.hud, u.vf, u.replay, u.dialogue, u.actionMenu, u.album, u.journal, u.doc, u.code, u.naming, u.vcr, u.console,
    u.tripod, u.read, u.menus, u.fade, u.pointerGate];
}

// ---- 全部视图节点存在、分层顺序正确（ARCH §7）
registerSelftest('wp6.layers', game => {
  const n = new Notes();
  const root = game.ui.root;
  n.check(game.host.contains(root), 'UI 根节点不在 host 里');
  const ids = [...root.children].map(c => c.id);
  n.check(JSON.stringify(ids) === JSON.stringify(UI_LAYER_IDS), `层顺序不对：${ids.join(',')}`);
  for (const v of allViews(game)) n.check(root.contains(v.el), `视图 ${v.el.className} 不在 UI 根下`);
  n.check(root.querySelector('#world-markers')?.contains(game.ui.hud.markersEl) === true, '角标容器不在 #world-markers');
  return n.result();
});

// ---- 所有按钮 tabindex=-1（ARCH §4.6）
registerSelftest('wp6.buttons_tabindex', game => {
  const n = new Notes();
  const buttons = [...game.ui.root.querySelectorAll('button')];
  n.check(buttons.length > 20, `按钮太少（${buttons.length}），视图没建全？`);
  for (const b of buttons) n.check(b.tabIndex === -1, `按钮“${b.textContent ?? ''}”的 tabindex 是 ${b.tabIndex}`);
  return n.result();
});

// ---- 点击菜单后焦点不在按钮上（ARCH §4.6：点击后立即 blur）
registerSelftest('wp6.menu_blur', game => {
  const n = new Notes();
  const menus = game.ui.menus;
  menus.showPause();
  const btn = [...menus.el.querySelectorAll<HTMLButtonElement>('button.cm-menu-item')].find(b => b.dataset.item === 'settings');
  n.check(btn, '暂停菜单里没有“设置”按钮');
  if (btn) {
    btn.focus();
    btn.click();
    const a = document.activeElement;
    n.check(!(a instanceof HTMLButtonElement), `点击后焦点仍在按钮上：${a?.textContent ?? ''}`);
    n.check(menus.currentPage() === 'settings', `点击“设置”后页面是 ${menus.currentPage()}`);
    const seg = menus.el.querySelector<HTMLButtonElement>('.cm-seg button');
    n.check(seg?.tabIndex === -1, '设置页按钮 tabindex 不是 -1');
  }
  menus.hide();
  n.check(menus.currentPage() === 'none', '菜单没有收起');
  return n.result();
});

// ---- setLoading：300ms（真实时间）后才可见，关掉立即隐藏
registerSelftest('wp6.loading_delay', async game => {
  const n = new Notes();
  const f = game.ui.fade;
  game.ui.setLoading(false);
  const t0 = performance.now();
  game.ui.setLoading(true);
  n.check(!f.loadingVisible(), '“载入中…”一打开就可见（应延迟 300ms）');
  await waitMs(120);
  // 真实时间：机器负载高时 waitMs(120) 可能睡过 300ms（M3）——只在确实还没到 300ms 时断言“还不可见”
  const early = !f.loadingVisible();
  if (performance.now() - t0 < 280) n.check(early, '120ms 时“载入中…”已可见');
  await waitMs(260);
  n.check(f.loadingVisible(), '380ms 后“载入中…”仍不可见');
  n.check(f.el.textContent?.includes(STRINGS.loading) === true, '没有“载入中…”字样');
  game.ui.setLoading(false);
  n.check(!f.loadingVisible(), '关闭后“载入中…”仍可见');
  return n.result();
});

// ---- showBootError 渲染出中文错误页（不依赖 UI 实例）
registerSelftest('wp6.boot_error', () => {
  const n = new Notes();
  const a = document.createElement('div');
  showBootError(a, 'exception', 'TypeError: boom');
  const box = a.querySelector('.cm-boot-error');
  n.check(box?.getAttribute('role') === 'alert', '错误页没有 role=alert');
  n.check(box?.textContent?.includes(STRINGS.boot.exception) === true, '异常页没有“启动失败：”');
  n.check(box?.textContent?.includes('TypeError: boom') === true, '异常页没有错误摘要');
  n.check(box?.textContent?.includes(STRINGS.game.title) === true, '错误页没有标题');
  const b = document.createElement('div');
  showBootError(b, 'no_webgl2');
  showBootError(b, 'no_webgl2');
  n.check(b.querySelectorAll('.cm-boot-error').length === 1, '重复调用叠出了多个错误页');
  n.check(b.textContent?.includes(STRINGS.boot.noWebgl2) === true, 'WebGL2 错误页文字不对');
  return n.result();
});

// ---- setFrameRect：4:3 画框写进 CSS 变量，.cm-frame 按它定位
registerSelftest('wp6.frame_rect', game => {
  const n = new Notes();
  const ui = game.ui;
  const s = ui.root.style;
  const prev = ['--fx', '--fy', '--fw', '--fh'].map(k => s.getPropertyValue(k));
  ui.setFrameRect({ x: 12, y: 34, w: 400, h: 300 });
  n.check(s.getPropertyValue('--fx') === '12.0px' && s.getPropertyValue('--fw') === '400.0px', `画框变量不对：${s.getPropertyValue('--fx')} ${s.getPropertyValue('--fw')}`);
  const frame = ui.vf.el.querySelector<HTMLElement>('.cm-frame');
  const cs = frame ? getComputedStyle(frame) : null;
  n.check(cs?.left === '12px' && cs?.top === '34px' && cs?.width === '400px' && cs?.height === '300px', `取景框位置不对：${cs?.left} ${cs?.top} ${cs?.width} ${cs?.height}`);
  // 还原（WP1 的 resize 之后还会再调一次）
  const [fx, fy, fw, fh] = prev.map(v => parseFloat(v) || 0);
  if (fw > 0) ui.setFrameRect({ x: fx, y: fy, w: fw, h: fh });
  return n.result();
});

// ---- toast 同时发 'feedback'，lastFeedback 跟着变
registerSelftest('wp6.feedback', game => {
  const n = new Notes();
  const got: string[] = [];
  const off = game.events.on('feedback', e => { got.push(e.text); });
  const text = `（自测反馈 ${Math.floor(performance.now())}）`;
  game.ui.toast(text);
  off();
  n.check(got.includes(text), "toast 没有发 'feedback' 事件");
  n.check(game.ui.lastFeedback() === text, `lastFeedback() = ${game.ui.lastFeedback() ?? 'null'}`);
  n.check(game.ui.subs.isShowing(text), '反馈条没有显示');
  return n.result();
});

// ---- subtitle → currentSubtitle
registerSelftest('wp6.subtitle', game => {
  const n = new Notes();
  const text = `（自测字幕 ${Math.floor(performance.now())}）`;
  game.ui.subtitle(text, '', 3);
  n.check(game.ui.currentSubtitle() === text, `currentSubtitle() = ${game.ui.currentSubtitle() ?? 'null'}`);
  n.check(game.ui.lastFeedback() === text, '字幕没有记为 lastFeedback');
  return n.result();
});

// ---- setHidden：截图时隐藏全部 UI
registerSelftest('wp6.hidden', game => {
  const n = new Notes();
  game.ui.setHidden(true);
  n.check(getComputedStyle(game.ui.root).visibility === 'hidden', 'setHidden(true) 后 UI 仍可见');
  game.ui.setHidden(false);
  n.check(getComputedStyle(game.ui.root).visibility !== 'hidden', 'setHidden(false) 后 UI 仍隐藏');
  return n.result();
});

// ---- 相册/挑选器的序号与方向键规则（engine-wp6.md #1）
registerSelftest('wp6.album_nav', () => {
  const n = new Notes();
  const P = 14;
  const T = 18;
  n.check(albumNav(0, 1, 0, P, T) === 1, '右移 +1');
  n.check(albumNav(1, 0, 1, P, T) === 5, '照片区下移 +4');
  n.check(albumNav(12, 0, 1, P, T) === 13, '照片区下移不出照片区（钳到最后一张）');
  n.check(albumNav(13, 1, 0, P, T) === 14, '照片区最后一张右移进物品区');
  n.check(albumNav(14, 0, 1, P, T) === 15, '物品区下移 +1');
  n.check(albumNav(14, 0, -1, P, T) === 14, '物品区上移不出物品区');
  n.check(albumNav(17, 1, 0, P, T) === 17, '末尾右移钳住');
  n.check(albumNav(0, -1, -1, P, T) === 0, '开头左上钳住');
  n.check(albumNav(5, 1, 0, 0, 0) === 0, '空列表恒为 0');
  const e = albumEntries([], []);
  n.check(e.length === 0, '空相册条目数不为 0');
  return n.result();
});

// ---- 文档阅读器的正文片段：褪字、水渍、打码
registerSelftest('wp6.doc_segments', () => {
  const n = new Notes();
  const segs = parseFaded('No.04〔7〕3');
  n.check(segs.length === 3 && segs[1].kind === 'faded' && segs[1].t === '7', `〔〕解析不对：${JSON.stringify(segs)}`);
  const st = splitStains([{ t: 'No.04▯3', kind: 'text' }], STRINGS.doc.waterStain);
  n.check(st.length === 3 && st[1].kind === 'stain', `水渍拆分不对：${JSON.stringify(st)}`);
  const cov = markRange([{ t: 'abc', kind: 'text' }, { t: 'def', kind: 'faded' }], 2, 4, 'covered');
  n.check(cov.map(s => `${s.kind}:${s.t}`).join('|') === 'text:ab|covered:c|covered:d|faded:ef', `打码区间不对：${JSON.stringify(cov)}`);
  return n.result();
});

// ---- 回放 OSD：'2018-02-16 10:21' + 5.7 秒 → '2018-02-16 10:21:05'（GDD M4）
registerSelftest('wp6.replay_osd', () => {
  const n = new Notes();
  n.check(replayOsd('2018-02-16 10:21', 5.7) === '2018-02-16 10:21:05', replayOsd('2018-02-16 10:21', 5.7));
  n.check(replayOsd('2019-11-02 23:59', 75) === '2019-11-02 00:00:15', replayOsd('2019-11-02 23:59', 75));
  n.check(replayOsd('奇怪的标签', 3) === '奇怪的标签', '不合法的 osd 应原样返回');
  return n.result();
});

// ---- 录像机索引条：7 个索引点，03:12/03:14/03:16 合成一个标签
registerSelftest('wp6.vcr_index', () => {
  const n = new Notes();
  const g = indexLabelGroups(TAPE.index);
  n.check(TAPE.index.length === 7, '索引点不是 7 个');
  n.check(g.map(x => x.label).join(',') === '23:04,00:30,02:51,03:12/14/16,05:12', `索引标签：${g.map(x => x.label).join(',')}`);
  return n.result();
});

// ================================================================ M1c 起才能通过（要真实系统）

// ---- 角标：在场、射程内、视图相符的交互物都有角标，文字 = 现算 label（不泄题由 lint 保证）
// M4：探索（第三人称）里未聚焦、没在闪的只画离玩家最近的 4 个（且只画角框，名字元素仍在、隐藏）；取景器里照旧都画
registerSelftest('wp6.markers', game => {
  const n = new Notes();
  game.ui.update(0);
  const vf = game.modes.stack.includes('mode.viewfinder');
  let list = game.sys.interaction.list().filter(s => s.present && s.inRange && !(s.view === 'viewfinder' && !vf));
  n.check(list.length > 0, '沙盒出生点附近没有射程内的交互物（需要 WP4/WP7 的夹具）');
  if (!vf) {
    const special = list.filter(s => s.focused || s.blink > 0);
    const rest = list.filter(s => !(s.focused || s.blink > 0)).sort((a, b) => a.distance - b.distance).slice(0, 4);
    list = [...special, ...rest];
  }
  const labels = [...game.ui.hud.markersEl.querySelectorAll('.cm-marker-label')].map(e => e.textContent ?? '');
  for (const s of list) n.check(labels.includes(s.label), `交互物 ${s.id} 没有角标（或文字不是“${s.label}”）`);
  if (!vf) n.check(game.ui.hud.markersEl.querySelectorAll('.cm-marker').length <= list.length, '探索里角框不多于“聚焦/在闪 + 最近 4 个”');
  return n.result();
});

// ---- 相册：Tab 打开 → 视图可见；Esc 关闭 → 隐藏（按模式栈显隐，ARCH §7）
registerSelftest('wp6.album_mode', game => {
  const n = new Notes();
  const r = game.dispatch({ t: 'album' });
  n.check(r.ok, `dispatch album 失败：${r.reason ?? ''}`);
  game.ui.update(0);
  n.check(game.modes.top === 'mode.album', `栈顶是 ${game.modes.top}`);
  n.check(uiViewShown(game.ui, game.ui.album), '相册视图没有显示');
  n.check(!uiViewShown(game.ui, game.ui.actionMenu), '浏览相册时动作菜单不该显示');
  game.dispatch({ t: 'back' });
  game.ui.update(0);
  n.check(!game.modes.stack.includes('mode.album'), 'Esc 后 album 仍在栈上');
  n.check(!uiViewShown(game.ui, game.ui.album), '关闭后相册视图仍显示');
  return n.result();
});
