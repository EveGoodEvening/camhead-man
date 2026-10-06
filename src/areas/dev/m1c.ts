// owner: integrator
// M1c 整合的沙盒夹具与页面内自测（ARCH §15.3）：跨 WP 的接缝各测一例，scripts/selftest/m1c.mjs 经 __game.selftest('m1c.*') 调用。
// - 夹具文档 doc.slip_0473：readDoc 的成功路径在 M2 之前也能测（dev 沙盒的 docs 与正式区域同 id 时让位，见 AreaManager.init）。
// - 自测：取景器视点与模型镜头点重合、一次字幕只发一次 'feedback'、点在 UI 上的鼠标不产生游戏动作、
//   密码转轮显示正在拨的数字、角标闪烁走系统状态、过场 OSD 从 CutsceneSystem 拉到 UI。
//   回放 HUD 的片段序号要真的开始回放（瞄准残影点），在 scripts/selftest/m1c.mjs 里经调试 API 测。
// 页面内自测直接调用系统，不经调试 API（selftest 本身在 API 的串行队列里）。

import * as THREE from 'three';
import type { AreaPart } from '../../core/area';
import type { Game } from '../../core/game';
import type { SelftestResult } from '../../debug/selftest';
import { registerSelftest } from '../../debug/selftest';
import { DOC, NPC, OBJ } from '../../data/ids';
import type { CutsceneId, InteractId } from '../../data/ids';
import { E } from '../../game/effects';
import { LENS_FORWARD } from '../../core/player';
import { PC_DIMS } from '../../rigs/cameraHead';

/** 夹具文档正文：〔〕 里的字只在取景器中翻开时显出（与 GDD §7.4 取件单同一写法）。 */
const SLIP_BODY = '（沙盒）长明照相馆　取件单\nNo.04〔7〕3\n姓名：＿＿';

const part: AreaPart = {
  docs: [{ id: DOC.SLIP_0473, title: '（沙盒）取件单', style: 'slip', body: SLIP_BODY }],
};
export default part;

// ==================================================================== 小工具

class Notes {
  readonly notes: string[] = [];
  private bad = 0;
  check(cond: unknown, msg: string, detail?: unknown): void {
    if (cond) this.notes.push(`ok: ${msg}`);
    else {
      this.bad++;
      this.notes.push(`FAIL: ${msg}${detail === undefined ? '' : `（${typeof detail === 'string' ? detail : JSON.stringify(detail)}）`}`);
    }
  }
  result(): SelftestResult {
    return { ok: this.bad === 0, notes: this.notes };
  }
}

/** 跑 fn，结束后（无论成败）清栈、还原进度（与 WP4 的 withSnapshot 相同）。 */
async function isolated(game: Game, fn: () => Promise<void> | void): Promise<void> {
  const snap = game.state.snapshot();
  try {
    await fn();
  } finally {
    if (game.modes.stack.length > 1 || game.effects.busy) game.modes.resetTo('mode.explore');
    game.state.restore(snap);
    game.sys.npc.reevaluate();
  }
}

// ==================================================================== 自测

/** 模型的镜头点（lensAnchor）在俯仰 0、头跟随视角时与 PlayerController 的取景器视点重合（engine-wp1.md #6）。 */
registerSelftest('m1c.lens_anchor', game => {
  const n = new Notes();
  const p = game.player;
  const pm = game.playerModel;
  const saved = { pitch: p.pitch, bodyYaw: p.bodyYaw, vel: p.velocity.clone() };
  try {
    // 前提（M3）：站着、不动（core.mjs 里前面的用例会留下别的姿势或残余速度，走路动画会让镜头点前后晃几厘米）
    p.pitch = 0;
    p.bodyYaw = p.yaw;
    p.velocity.set(0, 0, 0);
    pm.setPose('stand', 0);
    for (let i = 0; i < 40; i++) pm.update(1 / 30, p, 'mode.viewfinder');
    pm.root.updateMatrixWorld(true);
    const lens = pm.head.lensAnchor.getWorldPosition(new THREE.Vector3());
    const eye = p.eyeFor(p.yaw, new THREE.Vector3());
    const dy = lens.y - eye.y;
    const dh = Math.hypot(lens.x - eye.x, lens.z - eye.z);
    const hp = pm.head.group.getWorldPosition(new THREE.Vector3());
    const r3 = (v: THREE.Vector3): string => v.toArray().map(x => x.toFixed(3)).join(',');
    const body = pm.body as unknown as { pose?: string };
    const ctx = `v(before)=${saved.vel.length().toFixed(2)} pose=${body.pose} root=${r3(pm.root.position)} p=${r3(p.position)} head=${r3(hp)} lens=${r3(lens)} eye=${r3(eye)} yaw=${p.yaw.toFixed(1)} body=${p.bodyYaw.toFixed(1)} mounted=${pm.headMounted}`;
    n.check(Math.abs(dy) < 0.01, `镜头点高度 = 脚底 + ${PC_DIMS.lensY}（±1cm）`, `${dy.toFixed(3)} ${ctx}`);
    n.check(dh < 0.03, `镜头点在身体中轴前 ${LENS_FORWARD}m（水平偏差 < 3cm）`, `${dh.toFixed(3)} ${ctx}`);
  } finally {
    p.pitch = saved.pitch;
    p.bodyYaw = saved.bodyYaw;
    p.velocity.copy(saved.vel);
  }
  return n.result();
});

/** 一句字幕 / 一条反馈只发一次 'feedback'（engine-wp4.md #3、engine-wp6.md #8）。 */
registerSelftest('m1c.feedback_once', game => {
  const n = new Notes();
  let count = 0;
  const off = game.events.on('feedback', () => { count++; });
  try {
    game.api.say('（沙盒）一句字幕', NPC.WANG);
    n.check(count === 1, 'GameApi.say → 恰好一次 feedback', count);
    count = 0;
    game.api.feedback('（沙盒）一条反馈');
    n.check(count === 1, 'GameApi.feedback → 恰好一次 feedback', count);
    n.check(game.ui.lastFeedback() === '（沙盒）一条反馈', 'lastFeedback 是最后一条', game.ui.lastFeedback());
  } finally {
    off();
  }
  return n.result();
});

/** 点在 UI 元素上的鼠标键不被 InputManager 翻译成 MouseLeft（取景器里不会误按快门；engine-wp6.md #14）；点在 canvas 上照常。 */
registerSelftest('m1c.ui_click', async game => {
  const n = new Notes();
  const photo = game.sys.photo;
  const orig = photo.shoot.bind(photo);
  let shots = 0;
  photo.shoot = () => {
    shots++;
    return { ok: true };
  };
  const click = (el: EventTarget, x: number, y: number): void => {
    el.dispatchEvent(new MouseEvent('mousedown', { button: 0, buttons: 1, bubbles: true, clientX: x, clientY: y }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, buttons: 0, bubbles: true, clientX: x, clientY: y }));
  };
  try {
    await isolated(game, async () => {
      n.check(game.modes.push('mode.viewfinder').ok, '进取景器');
      click(game.ui.hud.el, 200, 200);
      await game.advance(2 / 30);
      n.check(shots === 0, '点在 UI 上：没有快门', shots);
      click(game.renderer.domElement, 200, 200);
      await game.advance(2 / 30);
      n.check(shots === 1, '点在 canvas 上：快门一次', shots);
    });
  } finally {
    photo.shoot = orig;
  }
  return n.result();
});

/** 密码面板：滚轮拨当前轮时，面板上的转轮显示正在拨的数字（engine-wp6.md #4、engine-wp4.md #8）。 */
registerSelftest('m1c.code_wheels', async game => {
  const n = new Notes();
  await isolated(game, () => {
    const owner = OBJ.R1_DRAWER as InteractId;
    const r = game.sys.panels.openCode(owner);
    n.check(r.ok, '打开 WP4 夹具的密码锁 r1.drawer', r);
    if (!r.ok) return;
    game.dispatch({ t: 'wheel', dir: 1 });
    game.dispatch({ t: 'wheel', dir: 1 });
    game.ui.update(0);
    const code = game.sys.panels.code;
    n.check(code !== null && code.wheels[0] === 2 && code.entered === '', '拨两格：当前轮 = 2，尚未确认', code);
    const cur = game.ui.code.el.querySelector('.cm-wheel .cm-cur')?.textContent;
    n.check(cur === '2', '面板第一个转轮显示 2', cur);
    game.dispatch({ t: 'back' });
  });
  return n.result();
});

/** 角标闪烁：InteractableHandle.blink() / InteractionSystem.blink() 经系统状态让 UI 的角标闪（engine-wp6.md #2）。 */
registerSelftest('m1c.blink', game => {
  const n = new Notes();
  const id = OBJ.R1_ESTATE_SIGN as InteractId;
  game.sys.interaction.blink(id);
  const st = game.sys.interaction.list().find(s => s.id === id);
  n.check(st !== undefined && st.blink > 0, 'list() 带剩余闪烁秒', st?.blink);
  game.ui.update(0);
  const el = game.ui.hud.markersEl.querySelector('.cm-marker.cm-blink');
  n.check(el !== null, '沙盒地标牌的角标在闪');
  return n.result();
});

/** 过场 {osd}：UI 每帧从 CutsceneSystem.osdText() 拉，过场结束清掉（engine-wp6.md #3）。 */
registerSelftest('m1c.cutscene_osd', async game => {
  const n = new Notes();
  await isolated(game, async () => {
    const osdEl = (): HTMLElement | null => game.ui.root.querySelector('.cm-csosd');
    const run = game.effects.runHandler([E.cutscene('cs.dev.wp4_fx' as CutsceneId)], 'test:m1c.osd');
    game.ui.update(0);
    const el = osdEl();
    n.check(el !== null && !el.classList.contains('cm-hidden') && (el.textContent ?? '').includes('CH1 沙盒'), '过场中显示 OSD 行', el?.textContent);
    await game.settle();
    await run;
    game.ui.update(0);
    n.check(osdEl()?.classList.contains('cm-hidden') === true, '过场结束后 OSD 收起');
  });
  return n.result();
});

/** 快门白闪：flash() 之后渲染的第一帧总是满白，哪怕这一帧的 dt 已经超过闪光时长（低帧率、锁步 advance 后的第一帧）。 */
registerSelftest('m1c.shutter_flash', game => {
  const n = new Notes();
  const post = game.pipeline.post;
  post.flash();
  post.render(0.2);
  n.check(post.current.flash >= 0.99, 'flash() 后第一帧 flash = 1（dt 0.2s > 80ms）', post.current.flash);
  post.render(0.2);
  n.check(post.current.flash === 0, '下一帧退完', post.current.flash);
  return n.result();
});

/** 拍照反馈卡片：取景器里按快门 → 右下角出现缩略图卡片，标题是这张照片的标题（空镜 = 失败原因）。 */
registerSelftest('m1c.photo_toast', async game => {
  const n = new Notes();
  await isolated(game, async () => {
    n.check(game.modes.push('mode.viewfinder').ok, '进取景器');
    const r = game.dispatch({ t: 'shutter' });
    n.check(r.ok, '快门', r);
    game.ui.update(1 / 30);
    const title = game.ui.photoToast.currentTitle();
    const cap = (r.result as { caption?: string } | undefined)?.caption;
    n.check(title !== null && title === cap, '卡片标题 = 空镜标题', { title, cap });
    const el = game.ui.photoToast.el;
    n.check(!el.classList.contains('cm-hidden') && !el.classList.contains('cm-suppressed'), '卡片可见');
    game.ui.update(5);
    n.check(game.ui.photoToast.currentTitle() === null && el.classList.contains('cm-hidden'), '几秒后收起');
  });
  return n.result();
});

/** 暂停里打开设置页：Esc 回到暂停页；再 Esc 才继续游戏。 */
registerSelftest('m1c.settings_esc', async game => {
  const n = new Notes();
  await isolated(game, async () => {
    n.check(game.modes.push('mode.pause').ok, '压暂停');
    game.ui.update(0);
    await game.ui.menus.select('settings');
    n.check(game.ui.menus.currentPage() === 'settings', '打开设置页', game.ui.menus.currentPage());
    game.dispatch({ t: 'back' });
    game.ui.update(0);
    n.check(game.modes.top === 'mode.pause' && game.ui.menus.currentPage() === 'pause', 'Esc 回到暂停页', { top: game.modes.top, page: game.ui.menus.currentPage() });
    game.dispatch({ t: 'back' });
    game.ui.update(0);
    n.check(!game.modes.has('mode.pause') && game.ui.menus.currentPage() === 'none', '再 Esc 继续游戏', { stack: game.modes.stack, page: game.ui.menus.currentPage() });
  });
  return n.result();
});

/** 取景器叠在面板上时不画世界里的交互角标（E/Esc 下传给面板“离开”，角标会误导）。 */
registerSelftest('m1c.panel_vf_markers', async game => {
  const n = new Notes();
  await isolated(game, async () => {
    game.ui.update(0);
    n.check(game.ui.hud.markersEl.querySelectorAll('.cm-marker').length > 0, '探索时出生点附近有角标');
    const r = game.sys.cctv.open();
    n.check(r.ok, '打开 WP5 夹具的监控台', r);
    if (!r.ok) return;
    n.check(game.modes.push('mode.viewfinder').ok, '面板上叠取景器');
    game.ui.update(0);
    n.check(game.ui.hud.markersEl.querySelectorAll('.cm-marker').length === 0, '叠加时没有角标');
  });
  return n.result();
});
