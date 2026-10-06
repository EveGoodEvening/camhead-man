// owner: WP7
// 真实键鼠输入测试（ARCH §12.4、§4.6）：?test=1&nolock=1（不锁指针，按住左键拖拽转视角），用 Playwright 的 keyboard/mouse 而不是 API；
// window.__game 只用来读 state() 断言，外加少量“布置现场”的定位/预置（goto、setFlags/giveItem，只在 ?debug=1 的沙盒模式里用，
// 标明 setup，不代替被测的操作）。不带 lockstep：rAF 每帧照常 step，按键在下一帧生效。
//
// 用法：npm run build && node scripts/input.mjs          沙盒模式（M1c 起必须通过）：dev 沙盒里的等价夹具
//       node scripts/input.mjs --game                   真实游戏（M3 起）：P1 步骤 1–4、抽屉转轮、录像机、相册/巡夜本、动作菜单与挑选器
//       --case=<名字子串>                                只跑名字含该子串的用例

import { launch, parseArgs, dumpFailure } from './lib/harness.mjs';

const args = parseArgs();
const GAME = !!args.game;

const results = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** 轮询 state() 直到 pred 为真（真实时间，默认 5 秒）。 */
async function until(h, pred, what, ms = 5000) {
  const t0 = Date.now();
  let s;
  for (;;) {
    s = await h.state();
    if (pred(s)) return s;
    if (Date.now() - t0 > ms) throw new Error(`等待超时：${what}；state=${JSON.stringify({ mode: s.mode, vf: s.vf, lens: s.lens, zoom: s.zoom, pos: s.pos, yaw: s.yaw, album: s.album, panel: s.panel, vcr: s.vcr, dialogue: s.dialogue, lastFeedback: s.lastFeedback })}`);
    await sleep(50);
  }
}

async function tap(h, key, holdMs = 60) {
  await h.page.keyboard.down(key);
  await sleep(holdMs);
  await h.page.keyboard.up(key);
  await sleep(60);
}

/** 画布中心（鼠标操作都在这里，不点到 DOM 按钮上）。 */
async function center(h) {
  const box = await h.page.evaluate(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  return box;
}

/** 按住左键拖拽（nolock 下的视角操作；拖动 ≥ 4px 不算快门点击）。 */
async function drag(h, dx, dy, steps = 12) {
  const c = await center(h);
  await h.page.mouse.move(c.x, c.y);
  await h.page.mouse.down({ button: 'left' });
  await h.page.mouse.move(c.x + dx, c.y + dy, { steps });
  await h.page.mouse.up({ button: 'left' });
  await sleep(120);
}

async function rightClick(h) {
  const c = await center(h);
  await h.page.mouse.click(c.x, c.y, { button: 'right' });
  await sleep(120);
}

async function leftClick(h) {
  const c = await center(h);
  await h.page.mouse.click(c.x, c.y, { button: 'left' });
  await sleep(120);
}

async function wheel(h, dy) {
  const c = await center(h);
  await h.page.mouse.move(c.x, c.y);
  await h.page.mouse.wheel(0, dy);
  await sleep(150);
}

/** 焦点不在任何 DOM 按钮上（ARCH §4.6：按钮 tabindex=-1、点击后 blur）。 */
async function noButtonFocus(h, where) {
  const tag = await h.page.evaluate(() => document.activeElement ? document.activeElement.tagName : null);
  assert(tag !== 'BUTTON' && tag !== 'INPUT' && tag !== 'SELECT', `${where}：焦点落在 <${tag}> 上`);
}

/**
 * 拖拽瞄准到 (yaw, pitch)：先用一次小拖拽标定“每像素多少度”，再按差值拖（最多 4 轮逼近）。
 * 只用鼠标，不调用 aimAt。
 */
async function dragAim(h, yaw, pitch, tol = 1.5) {
  let s = await h.state();
  const y0 = s.yaw;
  await drag(h, 40, 0);
  s = await h.state();
  const ky = angleDiff(y0, s.yaw) / 40 || 0.2;
  const p0 = s.pitch;
  await drag(h, 0, 30);
  s = await h.state();
  const kp = (s.pitch - p0) / 30 || -0.2;
  for (let i = 0; i < 4; i++) {
    s = await h.state();
    const dyaw = angleDiff(s.yaw, yaw);
    const dpitch = pitch - s.pitch;
    if (Math.abs(dyaw) < tol && Math.abs(dpitch) < tol) return s;
    await drag(h, Math.round(dyaw / ky), Math.round(dpitch / kp), 16);
  }
  return h.state();
}

function angleDiff(a, b) {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

/**
 * 从玩家眼睛看向 p 的 yaw/pitch（ARCH §1.3 的约定）。取景器里的视点在身体前方 LENS_FORWARD（0.18m，ARCH §5.2）：
 * 离目标不到 1m 时（电闸的开关）差十几度，按 yaw 迭代几次（M3）。
 */
function yawPitchTo(s, p) {
  const fwd = s.vf ? 0.18 : 0;
  let yaw = s.yaw;
  let pitch = 0;
  for (let i = 0; i < 4; i++) {
    const r = (yaw * Math.PI) / 180;
    const eye = [s.pos[0] + Math.sin(r) * fwd, s.pos[1] + 1.85, s.pos[2] - Math.cos(r) * fwd];
    const dx = p[0] - eye[0];
    const dy = p[1] - eye[1];
    const dz = p[2] - eye[2];
    yaw = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
    pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
  }
  return { yaw, pitch };
}

const CASES = [];
const test = (name, fn) => CASES.push({ name, fn });

// ==================================================================== 沙盒模式

async function setupHome(h, flags) {
  await h.call('setState', { area: 'dev', spawn: 'spawn.dev_start', ...(flags ? { flags } : {}) });
  await until(h, s => s.mode === 'mode.explore' && !s.loading, '回到沙盒');
}

/** setup：清空进度（setState 只加不减）再回沙盒——newGame() + dlg() 跑完开场，再进 dev。 */
async function freshHome(h, flags) {
  await h.call('newGame');
  await h.call('dlg');
  await setupHome(h, flags);
}

/** 'HH:MM:SS' → 秒（录像带 03:1x 附近不跨午夜）。 */
const tcSec = tc => tc.split(':').reduce((a, x) => a * 60 + Number(x), 0);

/** 只读探针：wait(0) 不推进时间，返回当前游戏时间（录像带速率要按游戏时间算，无头 SwiftShader 下帧率低、真实时间不可靠）。 */
async function gameTime(h) {
  return (await h.call('wait', 0)).time;
}

/**
 * 真实输入持续期间，等游戏时间至少走 sec 秒（真实时间上限 capMs）；返回 { state, time }。
 * 速率类断言要用足够长的游戏时间窗：state().vcr.tc 只到整秒，窗口不到 1 秒时量化误差能把 1× 量成 0×（M1c：并行跑时帧率低，曾偶发失败）。
 */
async function afterGameSec(h, t0, sec, capMs = 20_000) {
  const r0 = Date.now();
  for (;;) {
    const t = await gameTime(h);
    if (t - t0 >= sec || Date.now() - r0 > capMs) return { state: await h.state(), time: t };
    await sleep(100);
  }
}

/** E 之后若弹出动作菜单（既能交谈又收东西），按 1 选“交谈/查看”。 */
async function talkVia(h) {
  const s = await until(h, x => x.mode === 'mode.dialogue' || (x.mode === 'mode.album' && x.album && x.album.kind === 'menu'), 'E 开始对话或弹出动作菜单');
  if (s.mode === 'mode.album') await tap(h, 'Digit1');
}

if (!GAME) {
  test('WASD 移动、Shift 快走', async h => {
    await setupHome(h);
    // 按住的时长一律按游戏时间（M1c：真实时间 700ms 在负载高时只走 0.2–0.3 秒游戏时间，偶发“没走够 0.5m”）
    const hold = async (keys, gameSec) => {
      const g0 = await gameTime(h);
      for (const k of keys) await h.page.keyboard.down(k);
      try {
        await afterGameSec(h, g0, gameSec);
      } finally {
        for (const k of [...keys].reverse()) await h.page.keyboard.up(k);
      }
      await sleep(100);
    };
    const s0 = await h.state();
    await hold(['KeyW'], 0.6);
    const s1 = await until(h, s => Math.hypot(s.pos[0] - s0.pos[0], s.pos[2] - s0.pos[2]) > 0.5, '按住 W 走动');
    assert(s1.pos[2] < s0.pos[2], `yaw 0 朝北，W 往 -z 走：${s0.pos[2]} → ${s1.pos[2]}`);
    await hold(['KeyS'], 0.6);
    const s2 = await h.state();
    assert(s2.pos[2] > s1.pos[2], `S 往回走：${s1.pos[2]} → ${s2.pos[2]}`);
    await hold(['KeyD'], 0.4);
    const s3 = await h.state();
    assert(s3.pos[0] > s2.pos[0], `D 往东：${s2.pos[0]} → ${s3.pos[0]}`);
    // Shift 快走：同样按住 W，按游戏时间折算的速度明显更快（2.2 → 3.6 m/s，player.ts）
    const speedOf = async keys => {
      const p0 = (await h.state()).pos;
      const g0 = await gameTime(h);
      await hold(keys, 1);
      const g1 = await gameTime(h);
      const p1 = (await h.state()).pos;
      return Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) / Math.max(1e-3, g1 - g0);
    };
    const walk = await speedOf(['KeyW']);
    const run = await speedOf(['ShiftLeft', 'KeyW']);
    assert(walk > 0.5 && run > walk * 1.25, `Shift+W 应比 W 快：${walk.toFixed(2)} vs ${run.toFixed(2)} m/s（游戏时间）`);
  });

  test('按住左键拖拽转视角（nolock）', async h => {
    await setupHome(h);
    const s0 = await h.state();
    await drag(h, 120, 0);
    const s1 = await h.state();
    assert(Math.abs(angleDiff(s0.yaw, s1.yaw)) > 3, `拖拽后 yaw 应变：${s0.yaw} → ${s1.yaw}`);
    await drag(h, 0, 60);
    const s2 = await h.state();
    assert(Math.abs(s2.pitch - s1.pitch) > 2, `竖着拖 pitch 应变：${s1.pitch} → ${s2.pitch}`);
    assert(s2.mode === 'mode.explore', '拖拽不是快门点击');
  });

  test('右键取景器、Q 红外、滚轮变焦、Esc 退出（未锁定时 Esc = back）', async h => {
    await setupHome(h, { 'r2.ability_ir': true });
    await rightClick(h);
    await until(h, s => s.vf === true && s.mode === 'mode.viewfinder', '右键进入取景器');
    await tap(h, 'KeyQ');
    await until(h, s => s.lens === 'ir', 'Q 切红外');
    await tap(h, 'KeyQ');
    await until(h, s => s.lens === 'normal', 'Q 切回常光');
    await wheel(h, -120);
    await until(h, s => s.zoom === 2, '滚轮向上放大到 2×');
    await wheel(h, 120);
    await until(h, s => s.zoom === 1, '滚轮向下回到 1×');
    await tap(h, 'Escape');
    await until(h, s => s.vf === false && s.mode === 'mode.explore', 'Esc 退出取景器');
    await rightClick(h);
    await until(h, s => s.vf === true, '再次右键进入');
    await rightClick(h);
    await until(h, s => s.vf === false, '右键退出');
  });

  test('Tab 相册 / J 巡夜本 打开与关闭；焦点不在按钮上', async h => {
    await setupHome(h);
    await h.call('giveItem', 'it.log');                                 // setup
    await tap(h, 'Tab');
    await until(h, s => s.mode === 'mode.album' && s.album && s.album.kind === 'browse', 'Tab 打开相册');
    await noButtonFocus(h, '相册打开');
    await tap(h, 'Tab');
    await until(h, s => s.mode === 'mode.explore', 'Tab 关闭相册');
    await tap(h, 'KeyJ');
    await until(h, s => s.mode === 'mode.journal', 'J 打开巡夜本');
    await tap(h, 'KeyJ');
    await until(h, s => s.mode === 'mode.explore', 'J 关闭巡夜本');
    await tap(h, 'Space');
    await tap(h, 'Enter');
    await noButtonFocus(h, '按 Space/Enter 之后');
    assert((await h.state()).mode === 'mode.explore', 'Space/Enter 没有点到任何按钮');
  });

  test('E 交互（地标牌）', async h => {
    await setupHome(h);                                                   // 地标牌就在出生点前方约 2m（dev/base.ts）
    const a = await h.call('aimAt', 'r1.estate_sign');                  // setup：只取锚点坐标
    await h.call('goto', 'dev', 0, 8);                                   // setup：aimAt 转过身了，回到出生点、朝北
    const s0 = await h.state();
    const t = yawPitchTo(s0, a.point);
    await dragAim(h, t.yaw, t.pitch);
    await until(h, s => s.focused === 'r1.estate_sign', '聚焦到地标牌');
    await tap(h, 'KeyE');
    await until(h, s => (s.lastFeedback ?? '').includes('引擎沙盒'), 'E 之后出现反馈');
  });

  test('对话：E 开始、Space 推进、数字键选项', async h => {
    await setupHome(h);
    const a = await h.call('aimAt', 'npc.wang');                        // setup：取 NPC 锚点
    await h.call('goto', 'dev', a.point[0], a.point[2] + 1.6);
    const s0 = await h.state();
    const t = yawPitchTo(s0, a.point);
    await dragAim(h, t.yaw, t.pitch);
    await until(h, s => s.focused === 'npc.wang', '聚焦 NPC');
    await tap(h, 'KeyE');
    await talkVia(h);
    await until(h, s => s.mode === 'mode.dialogue', 'E（动作菜单 1）开始对话');
    for (let i = 0; i < 10; i++) {
      const s = await h.state();
      if (s.dialogue && s.dialogue.options.length) break;
      await tap(h, 'Space');
    }
    const s1 = await until(h, s => s.dialogue && s.dialogue.options.length > 0, '推进到选项');
    await tap(h, `Digit${s1.dialogue.options.length}`);                 // 最后一项“（先这样）”
    for (let i = 0; i < 6; i++) {
      if ((await h.state()).mode !== 'mode.dialogue') break;
      await tap(h, 'Space');
    }
    await until(h, s => s.mode === 'mode.explore', '对话结束');
  });

  test('动作菜单 1/2 与挑选器（方向键 + Enter）', async h => {
    await freshHome(h);
    await h.call('giveItem', 'it.wonton');                              // setup：身上只有一样东西（挑选器里默认就选中它）
    const a = await h.call('aimAt', 'npc.wang');
    await h.call('goto', 'dev', a.point[0], a.point[2] + 1.6);
    const s0 = await h.state();
    const t = yawPitchTo(s0, a.point);
    await dragAim(h, t.yaw, t.pitch);
    await until(h, s => s.focused === 'npc.wang', '聚焦 NPC');
    await tap(h, 'KeyE');
    await until(h, s => s.mode === 'mode.album' && s.album && s.album.kind === 'menu', 'E 弹出动作菜单（既有对话又有 offers）');
    await tap(h, 'Digit2');
    await until(h, s => s.album && s.album.kind === 'pick', '2 → 挑选器');
    await tap(h, 'ArrowRight');
    await tap(h, 'ArrowLeft');
    await tap(h, 'Enter');
    await until(h, s => s.mode !== 'mode.album', 'Enter 确认后弹出 album');
    const s = await until(h, x => x.items.some(i => i.id === 'it.wonton' && i.used), '出示被接受（馄饨标已用）');
    assert((s.lastFeedback ?? '').includes('馄饨') || s.lastFeedback !== null, `有反馈：${s.lastFeedback}`);
    await noButtonFocus(h, '挑选器之后');
  });

  test('密码面板：数字键输入、滚轮拨转轮、Backspace、Enter', async h => {
    await setupHome(h);
    const a = await h.call('aimAt', 'r1.drawer');
    await h.call('goto', 'dev', a.point[0], a.point[2] + 1.4);
    const s0 = await h.state();
    const t = yawPitchTo(s0, a.point);
    await dragAim(h, t.yaw, t.pitch);
    await until(h, s => s.focused === 'r1.drawer', '聚焦抽屉');
    await tap(h, 'KeyE');
    await until(h, s => s.mode === 'mode.panel_code', 'E 打开密码锁');
    await wheel(h, -120);
    await wheel(h, 120);
    await tap(h, 'Digit9');
    await tap(h, 'Backspace');
    for (const d of '0000') await tap(h, `Digit${d}`);
    await tap(h, 'Enter');
    await until(h, s => (s.lastFeedback ?? '').includes('锁纹丝不动'), '错误反馈');
    for (const d of '0618') await tap(h, `Digit${d}`);
    await tap(h, 'Enter');
    await until(h, s => s.mode !== 'mode.panel_code', '正确后面板关闭');
  });

  // M4 第 2 轮：对话里 Esc = 暂停；暂停页上 Enter 选“继续”只关暂停，不漏给下面的对话/密码锁（原来跳一句台词、多确认一位）
  test('暂停：对话里 Esc 暂停、Enter“继续”不漏给对话；密码锁上暂停后 Enter 不多确认一位', async h => {
    await setupHome(h);
    const a = await h.call('aimAt', 'npc.wang');
    await h.call('goto', 'dev', a.point[0], a.point[2] + 1.6);
    const s0 = await h.state();
    const t = yawPitchTo(s0, a.point);
    await dragAim(h, t.yaw, t.pitch);
    await until(h, s => s.focused === 'npc.wang', '聚焦 NPC');
    await tap(h, 'KeyE');
    await talkVia(h);
    const d0 = await until(h, s => s.mode === 'mode.dialogue' && s.dialogue, 'E 开始对话');
    await tap(h, 'Escape');
    await until(h, s => s.mode === 'mode.pause', '对话里 Esc → 暂停页');
    await tap(h, 'Enter');
    const d1 = await until(h, s => s.mode === 'mode.dialogue', 'Enter 选“继续”回到对话');
    await sleep(400);
    const d2 = await h.state();
    assert(d2.mode === 'mode.dialogue' && d2.dialogue && d2.dialogue.text === d0.dialogue.text, `Enter 漏给了对话：${d0.dialogue.text} → ${d2.dialogue?.text}（${d1.mode}）`);
    for (let i = 0; i < 12 && (await h.state()).mode === 'mode.dialogue'; i++) {
      const s = await h.state();
      if (s.dialogue && s.dialogue.options.length) await tap(h, `Digit${s.dialogue.options.length}`);
      else await tap(h, 'Space');
    }
    await until(h, s => s.mode === 'mode.explore', '对话结束');
    // 密码锁
    const b = await h.call('aimAt', 'r1.drawer');
    await h.call('goto', 'dev', b.point[0], b.point[2] + 1.4);
    const s3 = await h.state();
    const t3 = yawPitchTo(s3, b.point);
    await dragAim(h, t3.yaw, t3.pitch);
    await until(h, s => s.focused === 'r1.drawer', '聚焦抽屉');
    await tap(h, 'KeyE');
    await until(h, s => s.mode === 'mode.panel_code', 'E 打开密码锁');
    await tap(h, 'Digit1');
    await tap(h, 'Digit9');
    const p0 = await until(h, s => s.panel && s.panel.entered.replace(/[^0-9]/g, '').startsWith('19'), '输入 19');
    await h.page.evaluate(() => window.__cmGame.requestPause());         // setup：模拟切标签页压暂停（与 visibilitychange 同一入口）
    await until(h, s => s.mode === 'mode.pause', '压上暂停');
    await tap(h, 'Enter');
    await until(h, s => s.mode === 'mode.panel_code', 'Enter“继续”回到密码锁');
    await sleep(400);
    const p1 = await h.state();
    assert(p1.panel && p1.panel.entered === p0.panel.entered, `Enter 漏给了密码锁：${p0.panel.entered} → ${p1.panel?.entered}`);
    await tap(h, 'Escape');
    await until(h, s => s.mode === 'mode.explore', 'Esc 离开密码锁');
  });

  test('录像机面板：] 跳索引、按住 C 快进、进入 03:13:30 自动降速、空格暂停、E 离开', async h => {
    await setupHome(h);
    const a = await h.call('aimAt', 'r1.vcr');
    await h.call('goto', 'dev', a.point[0], a.point[2] + 1.2);
    const s0 = await h.state();
    const t = yawPitchTo(s0, a.point);
    await dragAim(h, t.yaw, t.pitch);
    await until(h, s => s.focused === 'r1.vcr', '聚焦录像机');
    await tap(h, 'KeyE');
    const s1 = await until(h, s => s.mode === 'mode.panel_vcr' && s.vcr, 'E 装带打开面板');
    await tap(h, 'BracketRight');
    const s2 = await until(h, s => s.vcr.tc !== s1.vcr.tc, '] 跳到下一个索引点');
    await h.call('vcr', 'seek', '03:12:40');                             // setup：放到降速区前 50 秒
    // 速率一律按游戏时间算（gameTime 探针）：无头 SwiftShader 帧率低，dt 钳制在 0.1s，真实时间比游戏时间快
    await h.page.keyboard.down('KeyC');
    try {
      await sleep(300);
      const a0 = await h.state();
      const t0 = await gameTime(h);
      // 16× 时 1 秒游戏时间走 16 带子秒（离降速区还有 ~50 带子秒，不会冲过去）
      const { state: a1, time: t1 } = await afterGameSec(h, t0, 1);
      const fast = (tcSec(a1.vcr.tc) - tcSec(a0.vcr.tc)) / Math.max(1e-3, t1 - t0);
      if (a1.vcr.tc < '03:13:30') assert(fast > 8, `按住 C 快进 ×16：${a0.vcr.tc} → ${a1.vcr.tc}，游戏时间 ${(t1 - t0).toFixed(2)}s，速率 ${fast.toFixed(1)}×`);
      await until(h, s => s.vcr.tc >= '03:13:30', '按住 C 快进到 03:13:30', 30_000);
      const b0 = await h.state();
      const u0 = await gameTime(h);
      // 1× 下 3 秒游戏时间走 3±1 带子秒（tc 只到整秒）：速率落在 0.67–1.33
      const { state: b1, time: u1 } = await afterGameSec(h, u0, 3);
      const slow = (tcSec(b1.vcr.tc) - tcSec(b0.vcr.tc)) / Math.max(1e-3, u1 - u0);
      assert(u1 - u0 >= 3 && slow > 0.4 && slow < 2, `进入 03:13:30 后快进应降到 1×：${b0.vcr.tc} → ${b1.vcr.tc}，游戏时间 ${(u1 - u0).toFixed(2)}s，速率 ${slow.toFixed(2)}×`);
      assert(b1.vcr.tc < '03:14:30', `仍在降速区里：${b1.vcr.tc}`);
    } finally {
      await h.page.keyboard.up('KeyC');
    }
    // 每按一次都等它生效再按下一次（按键在下一帧才翻译；帧率低时连按两下再读状态，读到的可能是两次都还没生效的旧值——M1c 修掉的偶发失败）
    const p0 = (await h.state()).vcr.playing;
    await tap(h, 'Space');
    await until(h, s => s.vcr.playing !== p0, '空格切换播放/暂停');
    await tap(h, 'Space');
    await until(h, s => s.vcr.playing === p0, '再按空格切回来');
    await tap(h, 'KeyE');
    await until(h, s => s.mode === 'mode.explore', 'E 离开面板');
    void s2;
  });
}

// ==================================================================== 真实游戏（--game，M3 起）

if (GAME) {
  test('P1 步骤 1–4：WASD 走到巡夜本与电闸、E、右键取景器、拖拽瞄准、E 扳开关', async h => {
    // 开场过场：空格推进到 explore。R1 的开场（cs.r1.intro）约 15 秒游戏时间、第一次看不能跳过；非锁步下 SwiftShader 只有几帧每秒、
    // dt 钳在 0.1，游戏时间比真实时间慢好几倍（M3：原来 80 下空格 + 30 秒不够，改成按真实时间最多等 3 分钟）
    const t0 = Date.now();
    for (;;) {
      const s = await h.state();
      if (s.mode === 'mode.explore' && s.settle === 'idle') break;
      if (Date.now() - t0 > 180_000) break;
      await tap(h, 'Space');
      await sleep(400);
    }
    await until(h, s => s.mode === 'mode.explore', '开场过场结束', 30000);
    // 巡夜本：用 A/D/W 朝着它走过去（出生点在椅子上，巡夜本在桌上），E 拾起
    const log = (await h.call('aimAt', 'r1.log')).point;
    await walkToward(h, log, 1.2);
    await tap(h, 'KeyE');
    await until(h, s => s.flags['r1.log_taken'] === true, 'E 拾起巡夜本');
    // 拾起后自动翻开巡夜本（GDD §3.2；M3 起是真正的阅读器），Esc 合上
    await until(h, s => s.mode === 'mode.journal', '拾起后自动翻开巡夜本');
    await tap(h, 'Escape');
    await until(h, s => s.mode === 'mode.explore', 'Esc 合上巡夜本');
    // 电闸
    await walkToward(h, [-7, 1.2, 18.6], 1.0);
    const box = (await h.call('aimAt', 'r1.switch_box')).point;
    const t = yawPitchTo(await h.state(), box);
    await dragAim(h, t.yaw, t.pitch);
    await tap(h, 'KeyE');
    await rightClick(h);
    await until(h, s => s.vf, '右键进入取景器');
    const lab = (await h.call('aimAt', 'rd.switch_labels')).point;
    const t2 = yawPitchTo(await h.state(), lab);
    await dragAim(h, t2.yaw, t2.pitch);
    await until(h, s => s.reading && s.reading.id === 'rd.switch_labels', '取景器里读到开关名');
    const sw = (await h.call('aimAt', 'r1.switch_3')).point;
    const t3 = yawPitchTo(await h.state(), sw);
    await dragAim(h, t3.yaw, t3.pitch);
    await until(h, s => s.focused === 'r1.switch_3', '聚焦开关③');
    await tap(h, 'KeyE');
    await until(h, s => s.flags['r1.gate_lamp_on'] === true, 'E 扳开关③');
    await rightClick(h);
  });

  test('抽屉：滚轮拨转轮 + Enter', async h => {
    const drawer = (await h.call('aimAt', 'r1.drawer')).point;
    await walkToward(h, drawer, 1.0);
    const t = yawPitchTo(await h.state(), drawer);
    await dragAim(h, t.yaw, t.pitch);
    await tap(h, 'KeyE');
    await until(h, s => s.mode === 'mode.panel_code', '打开抽屉锁');
    for (const d of '0000') await tap(h, `Digit${d}`);
    await tap(h, 'Enter');
    await until(h, s => (s.lastFeedback ?? '').includes('锁纹丝不动'), '错误反馈');
    await tap(h, 'Escape');
    await until(h, s => s.mode === 'mode.explore', 'Esc 离开面板');
  });

  test('Tab/J：相册与巡夜本', async h => {
    await tap(h, 'Tab');
    await until(h, s => s.mode === 'mode.album', 'Tab');
    await tap(h, 'Tab');
    await tap(h, 'KeyJ');
    await until(h, s => s.mode === 'mode.journal', 'J');
    await tap(h, 'KeyJ');
    await until(h, s => s.mode === 'mode.explore', '关闭');
    await noButtonFocus(h, '相册/巡夜本之后');
  });
}

/**
 * 用 WASD 朝 p 走到水平距离 stop 以内：每轮先拖拽转向，再按住 W（真实输入，不传送）。
 * M4 第 2 轮：按住的时长按**游戏时间**算（afterGameSec，同沙盒的 WASD 用例）——原来按真实时间按 150–900ms，高负载下只有 2fps 时
 * 一次按键可能整个落在两帧之间，一步也没走，20 轮后“走不到”（input --game 的巡夜本→电闸、抽屉两处偶发失败）。
 */
async function walkToward(h, p, stop = 1.0) {
  for (let i = 0; i < 20; i++) {
    const s = await h.state();
    const d = Math.hypot(p[0] - s.pos[0], p[2] - s.pos[2]);
    if (d <= stop) return;
    const t = yawPitchTo(s, [p[0], s.pos[1] + 1.85, p[2]]);
    await dragAim(h, t.yaw, s.pitch, 4);
    // 步行 2.2 m/s：按剩余距离的 70% 走（留余量给起步加速与转向误差），每轮 0.08–0.45 秒游戏时间
    const g0 = await gameTime(h);
    await h.page.keyboard.down('KeyW');
    try {
      await afterGameSec(h, g0, Math.min(0.45, Math.max(0.08, ((d - stop) / 2.2) * 0.7)), 15_000);
    } finally {
      await h.page.keyboard.up('KeyW');
    }
    await sleep(100);
  }
  throw new Error(`走不到 ${JSON.stringify(p)}`);
}

// ==================================================================== 运行

async function main() {
  const t0 = Date.now();
  const query = GAME ? 'new=1&debug=1&test=1&nolock=1&quality=low' : 'debug=1&test=1&nolock=1&quality=low&area=dev';
  const h = await launch({ query, label: 'input', viewport: { width: 960, height: 540 } });
  try {
    // 让页面拿到焦点（输入只在 document.hasFocus() 时生效，ARCH §4.6）
    await h.page.bringToFront();
    const c = await center(h);
    await h.page.mouse.move(c.x, c.y);
    const filter = typeof args.case === 'string' ? args.case : null;
    for (const t of CASES) {
      if (filter && !t.name.includes(filter)) continue;
      const t1 = Date.now();
      try {
        h.clearErrors();
        await t.fn(h);
        h.checkErrors(t.name);
        results.push({ name: t.name, ok: true });
        console.log(`  ok    ${t.name}（${((Date.now() - t1) / 1000).toFixed(1)}s）`);
      } catch (err) {
        results.push({ name: t.name, ok: false });
        console.error(`  FAIL  ${t.name}：${err.message}`);
        await dumpFailure(h, 'input', null);
        if (GAME) break;   // 真实游戏里后面的用例依赖前面的进度
      }
    }
  } finally {
    await h.close();
  }
  const fails = results.filter(r => !r.ok).length;
  console.log(`\ninput${GAME ? ' --game' : ''}：${results.length - fails}/${results.length} 通过（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  console.log(fails ? 'INPUT: FAIL' : 'INPUT: OK');
  process.exit(fails ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
