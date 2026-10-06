// owner: integrator
// M4 第 2 轮引擎修复的回归自测（ARCH §15.7.3）：scripts/selftest/m4.mjs 经 __game.selftest('m4.*') 调用。
// 页面内直接调用系统（不经调试 API）；每个自测对应一条评审问题，在沙盒里自己布置、结束时还原状态与临时对象。

import * as THREE from 'three';
import type { AreaPart } from '../../core/area';
import type { Game } from '../../core/game';
import type { SelftestResult } from '../../debug/selftest';
import { registerSelftest } from '../../debug/selftest';
import { IT, OBJ } from '../../data/ids';
import type { CutsceneId, DialogueId, InteractId } from '../../data/ids';
import { STRINGS } from '../../data/strings';
import { E } from '../../game/effects';
import { createCharacter } from '../../rigs/characters';

const part: AreaPart = {};
export default part;

/** wp4.ts 的沙盒对话与过场（dev 区域登记）。 */
const DLG_LINE = 'dlg.dev.wp4_line' as DialogueId;
const CS_FX = 'cs.dev.wp4_fx' as CutsceneId;
/** 借用两个在 dev 沙盒里没有登记的真实 id 当临时交互物（同 wp4.ts 的 TMP_A/TMP_B）。 */
const TMP_FAR: InteractId = OBJ.R2_MAILBOXES;
const TMP_BEHIND: InteractId = OBJ.R2_DONATION_BOARD;

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

async function isolated(game: Game, fn: () => Promise<void> | void): Promise<void> {
  const snap = game.state.snapshot();
  try {
    await fn();
  } finally {
    game.effects.cancelAll('reset');
    if (game.modes.stack.length > 1) game.modes.resetTo('mode.explore');
    game.state.restore(snap);
    game.sys.npc.reevaluate();
    game.ui.resetHeld();
    game.ui.subs.clear();
  }
}

async function advance(game: Game, sec: number): Promise<void> {
  await game.advance(sec, 1 / 30);
}

/** 屏幕上（#subs 层）某类提示条的文字。 */
function toastTexts(game: Game, kind: 'item' | 'tutorial' | 'page'): string[] {
  return [...game.ui.root.querySelectorAll(`.cm-toast-${kind}`)].map(e => e.textContent ?? '');
}

// ==================================================================== 取景器：射程外的对象挡在射程内的对象前面

registerSelftest('m4.far_focus', async game => {
  const n = new Notes();
  const ia = game.sys.interaction;
  const cur = game.areas.current;
  if (!cur || ia.get(TMP_FAR) || ia.get(TMP_BEHIND)) {
    n.check(false, '沙盒可用且临时 id 未占用');
    return n.result();
  }
  const meshes: THREE.Mesh[] = [];
  const handles: { remove(): void }[] = [];
  await isolated(game, async () => {
    const v = game.dispatch(game.settings.vfMode === 'hold' ? { t: 'vf', down: true } : { t: 'vf' });
    n.check(v.ok, '举起取景器', v.reason);
    // 找一个前方 3m 内没有墙的朝向
    const eye = new THREE.Vector3();
    const dir = new THREE.Vector3();
    let clear = false;
    for (let k = 0; k < 8 && !clear; k++) {
      game.player.yaw = k * 45;
      game.player.bodyYaw = game.player.yaw;
      game.player.pitch = 0;
      game.cameras.sync();
      game.cameras.camera.updateMatrixWorld();
      game.cameras.camera.getWorldPosition(eye);
      game.cameras.camera.getWorldDirection(dir);
      clear = game.collision.raycast(eye, dir, 3.2) === null;
    }
    n.check(clear, '找到前方 3m 空旷的朝向');
    const mk = (d: number, color: string): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial({ color }));
      m.position.copy(eye).addScaledVector(dir, d);
      cur.root.add(m);
      m.updateMatrixWorld(true);
      meshes.push(m);
      return m;
    };
    const far = mk(2.0, '#884444');
    const behind = mk(2.8, '#448844');
    const at = (m: THREE.Mesh): [number, number, number] => [m.position.x, m.position.y, m.position.z];
    // 近的那个射程只有 1.5m（锚点 2.0m：射程外、4m 之内）；后面那个射程 6m
    handles.push(ia.register({ id: TMP_FAR, label: '（沙盒）远处的人', at: at(far), hit: far, range: 1.5 }, cur.def.id));
    handles.push(ia.register({ id: TMP_BEHIND, label: '（沙盒）楼梯', at: at(behind), hit: behind, range: 6, onInteract: [] }, cur.def.id));
    const focus = ia.focusCandidate();
    n.check(focus === null, '准星先碰到射程外的对象：不穿过它聚焦后面射程内的东西', focus);
    n.check(ia.farFocused === TMP_FAR, 'farFocused 是挡在前面的射程外对象（灰色“（走近点）”）', ia.farFocused);
    // 对照：挪开前面那个，后面的被准星选中
    far.visible = false;
    const focus2 = ia.focusCandidate();
    n.check(focus2 === TMP_BEHIND, '前面没东西挡着时聚焦后面射程内的对象', focus2);
  });
  for (const h of handles) h.remove();
  for (const m of meshes) {
    m.removeFromParent();
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
  return n.result();
});

// ==================================================================== 物品/新页提示挂起到过场结束

registerSelftest('m4.news_defer', async game => {
  const n = new Notes();
  await isolated(game, async () => {
    game.ui.resetHeld();
    n.check(!game.state.has(IT.BULB), '沙盒里还没有灯泡');
    const run = game.effects.run([E.cutscene(CS_FX)], 'm4.news_defer');
    // CS_FX：1 秒后 E.item(灯泡)，再一句字幕与 1 秒等待
    await advance(game, 1.4);
    n.check(game.state.has(IT.BULB), '过场里已经给了灯泡（flag 与物品先写）');
    n.check(game.modes.has('mode.cutscene'), '过场还在播');
    n.check(toastTexts(game, 'item').length === 0, '过场里不弹“得到：……”', toastTexts(game, 'item'));
    await game.drive(() => !game.modes.has('mode.cutscene') && !game.effects.busy);
    await run.catch(() => undefined);
    await advance(game, 0.4);
    const t = toastTexts(game, 'item');
    n.check(t.some(x => x.includes(STRINGS.hud.gotItems)), '过场结束后弹出“得到：……”', t);
  });
  return n.result();
});

// ==================================================================== 教学条挂起到“风平浪静”

registerSelftest('m4.tutorial_defer', async game => {
  const n = new Notes();
  const TXT = '（沙盒）教学条';
  await isolated(game, async () => {
    game.ui.resetHeld();
    void game.effects.run([E.dialogue(DLG_LINE)], 'm4.tutorial_defer');
    await advance(game, 0.3);
    n.check(game.modes.top === 'mode.dialogue', '对话开着');
    game.ui.tutorial(TXT);
    await advance(game, 0.6);
    n.check(!toastTexts(game, 'tutorial').includes(TXT), '对话里不弹教学条', toastTexts(game, 'tutorial'));
    for (let i = 0; i < 6 && game.modes.has('mode.dialogue'); i++) {
      game.dispatch({ t: 'advance' });
      await advance(game, 0.2);
    }
    n.check(!game.modes.has('mode.dialogue'), '对话推完了');
    await advance(game, 0.2);
    n.check(!toastTexts(game, 'tutorial').includes(TXT), '对话结束后 0.5 秒内还不弹');
    await advance(game, 0.6);
    n.check(toastTexts(game, 'tutorial').includes(TXT), '平静 0.5 秒后弹出', toastTexts(game, 'tutorial'));
  });
  return n.result();
});

// ==================================================================== 暂停页的 Enter 不漏给下面的模式；对话里 Esc = 暂停

registerSelftest('m4.pause_keys', async game => {
  const n = new Notes();
  await isolated(game, async () => {
    void game.effects.run([E.dialogue(DLG_LINE)], 'm4.pause_keys');
    await advance(game, 0.3);
    const line0 = game.sys.dialogue.active?.text ?? null;
    n.check(game.modes.top === 'mode.dialogue' && line0 !== null, '对话开着', game.modes.stack);
    // Esc：对话里压暂停
    game.input.inject('Escape', true);
    game.input.inject('Escape', false);
    await advance(game, 0.1);
    n.check(game.modes.top === 'mode.pause', '对话里按 Esc → 暂停页', game.modes.stack);
    n.check(game.ui.menus.currentPage() === 'pause', '暂停菜单显示');
    // Enter 选“继续”：只关掉暂停，不推进台词
    game.input.inject('Enter', true);
    game.input.inject('Enter', false);
    await advance(game, 0.2);
    n.check(game.modes.top === 'mode.dialogue', 'Enter 选“继续”回到对话', game.modes.stack);
    n.check((game.sys.dialogue.active?.text ?? null) === line0, '这一下 Enter 没有漏给对话（台词没变）', game.sys.dialogue.active?.text);
    // 再压一次暂停，Esc 回到对话
    game.input.inject('Escape', true);
    game.input.inject('Escape', false);
    await advance(game, 0.1);
    game.input.inject('Escape', true);
    game.input.inject('Escape', false);
    await advance(game, 0.1);
    n.check(game.modes.top === 'mode.dialogue', '暂停页再按 Esc 回到对话', game.modes.stack);
  });
  return n.result();
});

// ==================================================================== H：新提示替换旧提示

registerSelftest('m4.hint_replace', async game => {
  const n = new Notes();
  await isolated(game, async () => {
    game.ui.subs.clear();
    const a = game.sys.hints.request();
    const b = game.sys.hints.request();
    n.check(a.ok && b.ok, 'H 两次都给了提示');
    const lines = [...game.ui.root.querySelectorAll('.cm-sub')].map(e => e.textContent ?? '');
    n.check(lines.length === 1, '屏幕上只剩一行提示（新的替换旧的）', lines);
  });
  return n.result();
});

// ==================================================================== 开场：“E：交互”不在过场里弹、过场后第一次聚焦才教（会开新游戏，必须最后跑）

registerSelftest('m4.intro_tutorial', async game => {
  const n = new Notes();
  const TXT = STRINGS.tutorial.interact;
  await game.newGame();
  let during = false;
  let n0 = 0;
  for (let i = 0; i < 80 && game.modes.has('mode.cutscene'); i++) {
    await advance(game, 0.5);
    n0++;
    if (game.modes.has('mode.cutscene') && toastTexts(game, 'tutorial').includes(TXT)) during = true;
  }
  n.check(n0 > 2, '开场过场播了一阵', n0);
  n.check(!during, '开场过场里没有弹“E：交互”');
  n.check(!game.modes.has('mode.cutscene'), '开场过场播完了', game.modes.stack);
  for (let i = 0; i < 8 && !game.state.seen(`tutorial:${TXT}`); i++) await advance(game, 0.25);
  const focused = game.sys.interaction.focused;
  if (focused !== null) {
    n.check(game.state.seen(`tutorial:${TXT}`), `过场后聚焦（${focused}）→ 教“E：交互”`);
    n.check(toastTexts(game, 'tutorial').includes(TXT), '“E：交互”教学条在屏幕上', toastTexts(game, 'tutorial'));
  } else {
    n.check(true, '过场后没有聚焦对象（不教；由 r1 的镜头决定）');
  }
  return n.result();
});

// ==================================================================== look-dev：人偶排成一排（截图探针用，不在 PAGE_TESTS 里）

/**
 * 在 look-dev 角落（钠灯旁）摆一排人偶：王奶奶、陆师傅、老周、土地、建国、黄三爷（人形）、街坊。
 * 页面里先设 `globalThis.__m4lineup = { look: 'live'|'ghost'|'replay', yaw: 度 }`（缺省 live、面朝 +z 即 yaw 180）。
 * 再次调用先撤掉上一排。截图探针用 __cmGame.cameras.setFixedPose 摆机位（人偶在 z = 9，x 从 8.2 起每 0.8m 一个）。
 */
let lineupRoot: THREE.Group | null = null;
let lineupRigs: { dispose(): void }[] = [];
registerSelftest('m4.lineup', async game => {
  const n = new Notes();
  const cfg = ((globalThis as { __m4lineup?: { look?: 'live' | 'ghost' | 'replay'; yaw?: number } }).__m4lineup) ?? {};
  for (const r of lineupRigs) r.dispose();
  lineupRigs = [];
  lineupRoot?.removeFromParent();
  const root = new THREE.Group();
  root.name = 'm4.lineup';
  const look = cfg.look ?? 'live';
  const yaw = ((cfg.yaw ?? 180) * Math.PI) / 180;
  const kinds = [['wang', {}], ['lu', {}], ['zhou', { variant: 'cap' }], ['tudi', {}], ['jianguo', {}], ['huang', { variant: 'man' }], ['neighbor', { seed: 2008 }]] as const;
  kinds.forEach(([kind, o], i) => {
    const rig = createCharacter(kind, { ...o, look: kind === 'huang' && look === 'ghost' ? 'live' : look });
    rig.root.position.set(8.2 + i * 0.8, 0, 9.0);
    rig.root.rotation.y = yaw;
    rig.setPose('stand', 0);
    rig.update(0.016, 0);
    root.add(rig.root);
    lineupRigs.push(rig);
  });
  game.areas.current?.root.add(root);
  root.updateMatrixWorld(true);
  lineupRoot = root;
  n.check(true, `摆了 ${kinds.length} 个人偶（${look}）`);
  return n.result();
});
