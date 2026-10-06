// owner: WP7
// 截图机位（ARCH §12.5）：ShotDef 由区域在 AreaDef.shots 里填写；__game.shot(area, shotId) 按机位摆好画面。
// runShot 是 WP7 内部实现（ARCH §2.13），由 debug/api.ts 在 ?debug=1 下挂成 __game.shot；截图与亮度验收在 scripts/shots.mjs。

import * as THREE from 'three';
import type { ApiResult, AreaKey, CameraPose, FailReason, LensMode, ModeId, XZ, ZoomLevel } from '../core/types';
import { ZOOM_STEPS, fail, ok } from '../core/types';
import type { ItemId, PhotoId, ReplayPointId, SegmentId, SpawnId } from '../data/ids';
import type { Game } from '../core/game';
import type { DebugOverlay } from './overlay';
import { resolveAimPoint, turnTowards } from './fidelity';
import { STRINGS } from '../data/strings';

export interface ShotDef {
  id: `shot.${AreaKey}.${string}`;
  /** 评审时看的说明，如“子时·槐树下远景” */
  label: string;
  preset?: 'zi' | 'chou' | 'yin' | 'mao' | { flags?: Record<string, boolean | number>; items?: ItemId[]; photos?: PhotoId[] };
  /** 自由机位（隐藏玩家）或摆玩家与模式 */
  view:
    | { cam: CameraPose }
    | { player: XZ; yaw: number; pitch?: number; floor?: number; mode: 'tp' | 'vf'; lens?: LensMode; zoom?: ZoomLevel; replay?: { point: ReplayPointId; seg: SegmentId; t: number } };
  /** 默认 false；取景器 HUD、对话框等界面截图设 true */
  ui?: boolean;
  /** 截图前等待的真实帧数，默认 12 */
  settle?: number;
  /** 本机位里必须“看得清”的交互物/ref（shots.mjs 在其锚点投影处测亮度） */
  keys?: readonly string[];
  /** 覆盖默认的平均亮度区间 [0.05, 0.35] */
  brightness?: readonly [number, number];
  /**
   * M3 补写：进区域之后、摆机位之前写进当前区域的临时状态（ctx.setTemp，ARCH §11.2），用来拍“只由玩家操作点亮 N 秒”的画面
   * （R2 声控灯 lamp_lit_<n>、R3 暗房红灯 safelight）。之后照常推进淡入的 0.6 秒游戏时间，区域的 update/onTemp 据此摆灯。
   */
  temp?: Readonly<Record<string, boolean | number>>;
  /**
   * M3 补写：高光验收（shots.mjs：亮度 > 阈值的像素 ≥ 0.5%）的亮度阈值，默认 0.8；false = 不验这一条。
   * 单红通道画面（暗房红灯：CameraFxPass 压成 (v, 0.06v, 0.05v)，sRGB 亮度上限约 0.21）用低阈值或 false。
   */
  highlight?: number | false;
}

/** shot(area, '*') 的列表项（shots.mjs 用它枚举机位；WP7 补充）。 */
export interface ShotListing {
  id: string; label: string; ui: boolean; keys: readonly string[]; brightness: readonly [number, number] | null;
  /** M3 补写：ShotDef.highlight（null = 默认 0.8） */
  highlight: number | false | null;
}

type Patch = { flags: Record<string, boolean | number>; items: (ItemId | { id: ItemId; used: boolean })[]; photos: PhotoId[] };

// ==================================================================== 时辰预置（与 scripts/lib/presets.mjs 同源，scripts/selftest/wp7.mjs 校验二者一致）

const used = (id: ItemId): { id: ItemId; used: boolean } => ({ id, used: true });

const R2_START: Patch = {
  flags: {
    'r1.log_taken': true, 'r1.gate_lamp_on': true, 'r1.met_tudi': true, 'r1.ability_replay': true, 'r1.p1_done': true,
    'r1.mission_given': true, 'r1.drawer_open': true, 'r1.gate_unchained': true,
  },
  items: ['it.log', used('it.keys'), 'it.bulb', 'it.slip_0473', 'it.idcard'],
  photos: ['ph.tudi'],
};
const R3_START: Patch = {
  flags: {
    ...R2_START.flags, 'r2.lobby_lamp_lit': true, 'r2.wang_met': true, 'r2.wang_escort': true, 'r2.wang_floor': 5, 'r2.bulb_installed': true,
    'r2.menshen_open': true, 'r2.tin_opened': true, 'r2.wang_done': true, 'r2.ability_ir': true,
  },
  items: [...R2_START.items, used('it.bulb'), used('it.letter'), 'it.train_ticket', 'it.glasses', 'it.wonton', 'it.money'],
  photos: [...R2_START.photos, 'ph.menshen_2018'],
};
const R4_START: Patch = {
  flags: { ...R3_START.flags, 'r3.lu_door_open': true, 'r3.got_envelope': true, 'r3.film_hung': true, 'r3.film_developed': true, 'r3.saw_true_form': true },
  items: [...R3_START.items, used('it.slip_0473'), 'it.film', used('it.slip_0474'), 'it.portrait'],
  photos: [...R3_START.photos, 'ph.covered_face', 'ph.film3', 'ph.true_form'],
};
const YIN: Patch = {
  flags: { ...R4_START.flags, 'r4.ghost_market_open': true, 'r4.spotted_huang': true, 'r4.found_huang': true, 'r4.asked_tape': true, 'r4.huang_admits': true, 'r4.got_tape': true },
  items: [...R4_START.items, used('it.money'), 'it.tape_830'],
  photos: [...R4_START.photos, 'ph.huang_hides', 'ph.huang_normal', 'ph.huang_ir'],
};
/** 卯时：寅时 + 终章 flags 直到 r1.soul_returned（ARCH §12.5；结局相关状态用 debugSet 设，不经过 save.hold）。 */
const MAO: Patch = {
  flags: {
    ...YIN.flags, 'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.heard_voice': true, 'r1.portrait_placed': true, 'r1.portrait_complete': true,
    'r1.zhou_visible': true, 'r1.zhou_fed': true, 'r1.soul_returned': true,
  },
  items: [...YIN.items, used('it.tape_830'), used('it.portrait'), used('it.wonton')],
  photos: [...YIN.photos, 'ph.tape_face', 'ph.zhou_tunnel', 'ph.final'],
};

/** ShotDef.preset 的时辰简写（'zi' = r2_start、'chou' = r4_start、'yin' = yin、'mao' = yin + 终章，ARCH §12.5）。 */
export const SHOT_PRESETS: Readonly<Record<'zi' | 'chou' | 'yin' | 'mao', Patch>> = { zi: R2_START, chou: R4_START, yin: YIN, mao: MAO };

/** 同一物品后出现的条目覆盖前面的（'it.bulb' 先未用、后已用）。 */
function dedupeItems(items: Patch['items']): Patch['items'] {
  const m = new Map<ItemId, ItemId | { id: ItemId; used: boolean }>();
  for (const it of items) m.set(typeof it === 'string' ? it : it.id, it);
  return [...m.values()];
}

function patchFor(preset: ShotDef['preset']): Patch | null {
  if (preset === undefined) return null;
  if (typeof preset === 'string') {
    const p = SHOT_PRESETS[preset];
    return { flags: { ...p.flags }, items: dedupeItems(p.items), photos: [...new Set(p.photos)] };
  }
  return { flags: { ...(preset.flags ?? {}) }, items: [...(preset.items ?? [])], photos: [...(preset.photos ?? [])] };
}

// ==================================================================== runShot

const BUSY: readonly ModeId[] = ['mode.dialogue', 'mode.cutscene', 'mode.tripod'];
/** 进区域、开取景器、开回放之后留给后期淡入淡出的游戏时间（锁步下 rAF 以 dt=0 渲染，只有 advance 推得动淡入）。 */
const FADE_SETTLE_SEC = 0.6;

/** 世界点 → 页面 CSS 像素（相对视口，与 Playwright page.screenshot 的坐标一致）。 */
function toScreen(game: Game, p: THREE.Vector3): { x: number; y: number } {
  const cam = game.cameras.camera;
  cam.updateMatrixWorld();
  const local = cam.worldToLocal(p.clone());
  if (local.z >= -cam.near) return { x: -1, y: -1 };
  const ndc = p.clone().project(cam);
  const r = game.renderer.domElement.getBoundingClientRect();
  return { x: Math.round(r.left + ((ndc.x + 1) / 2) * r.width), y: Math.round(r.top + ((1 - ndc.y) / 2) * r.height) };
}

type ShotResult = ApiResult<{ keys: { id: string; x: number; y: number }[] }>;

/** 失败结果：带上失败在哪一步（stage）与原因细节，便于看截图脚本的日志。 */
function shotFail(reason: FailReason, stage: string, detail?: unknown): ShotResult {
  const result = { keys: [], stage, detail: detail ?? null };
  return { ok: false, reason, result };
}

function listShots(game: Game, area: AreaKey): ApiResult<{ keys: { id: string; x: number; y: number }[]; shots: ShotListing[] }> {
  const def = game.areas.defs.get(area);
  if (!def) return fail('no_such_target');
  const shots = (def.shots ?? []).map(s => ({
    id: s.id, label: s.label, ui: s.ui ?? false, keys: s.keys ?? [], brightness: s.brightness ?? null, highlight: s.highlight ?? null,
  }));
  return ok({ keys: [], shots });
}

/**
 * __game.shot 的实现（WP7 内部）：按 preset 设状态 → 进入区域 → 按 view 摆相机或摆玩家与模式 → ui.setHidden(!ui) → 等 settle 帧，
 * 返回 keys 的屏幕坐标。每次都从“新游戏状态 + 预置”重建并重新进入区域，保证同一机位的截图可复现、与前一张无关。
 * shotId 为 '*' 时只列出本区全部机位（WP7 补充：shots.mjs 用来枚举）。
 */
export async function runShot(game: Game, area: AreaKey, shotId: string, overlay?: DebugOverlay | null): Promise<ShotResult> {
  if (shotId === '*') return listShots(game, area);
  const def = game.areas.defs.get(area);
  const shot = def?.shots?.find(s => s.id === shotId);
  if (!def || !shot) return fail('no_such_target');
  const spawn = Object.keys(def.spawns)[0] as SpawnId | undefined;
  if (!spawn) return fail('no_such_target');

  // 1. 状态：清空 → 预置（debugSet 不发 'flag'，不触发区域逻辑，也不经过 save.hold）
  if (game.modes.stack.some(m => BUSY.includes(m)) || game.modes.isTransient()) game.modes.resetTo('mode.explore');
  game.playerModel.setVisible(true);
  game.state.reset();
  // 镜头与倍率跟新游戏一样复位（M1c look-dev 修正：离开取景器不复位镜头，上一张红外机位会把红外带进下一张没写 lens 的机位）
  game.sys.viewfinder.resetOptics();
  const patch = patchFor(shot.preset);
  if (patch) game.state.debugSet(patch);
  // M4：第一次聚焦/第一次倍率不够时的自动教学条（“E：交互”“滚轮：变焦”）不该出现在验收截图里：记为教过
  // （开页面时已经弹出来的也收起：下面的 advance 里淡出）
  for (const t of [STRINGS.tutorial.interact, STRINGS.tutorial.zoom]) {
    game.state.markSeen(`tutorial:${t}`);
    game.ui.dismiss(t);
  }
  // M4 第 2 轮：上一张机位里排队、还没显示的教学条/新页提示也丢掉
  game.ui.resetHeld();
  game.sys.shichen.resetClock();

  // 2. 进入区域（总是重建：灯、NPC 站位、雾都在 build 里按 flags 推导）
  await game.areas.enter(area, spawn, { reason: 'debug' });
  game.pipeline.setDynamicResolution(false);
  // 2b. 区域临时状态（M3：ShotDef.temp；区域的 update/onTemp 在下面的 advance 里据此摆灯）
  const ctx = game.areas.current?.ctx;
  if (shot.temp && ctx) for (const [k, v] of Object.entries(shot.temp)) ctx.setTemp(k, v);

  // 3. 机位
  const view = shot.view;
  if ('cam' in view) {
    // 自由机位隐藏整个主角：身子、装在身上的摄像头脑袋与视频线（M3；setVisible 只藏身子——尾声“头留在门楣上”的语义）。
    // 头装在支架上时它不在 root 下面，照常渲染。下一次进区域（AreaManager → Game.areaReady）把 root 复原为可见。
    game.playerModel.setVisible(false);
    game.playerModel.root.visible = false;
    game.cameras.setFixedPose(view.cam, 0, { role: 'fixed' });
    game.cameras.active = 'fixed';
    await game.advance(FADE_SETTLE_SEC);
    // advance 里的 cameras.update 会按模式把相机切回第三人称：再摆一次（锁步下之后只渲染、不模拟）
    game.cameras.setFixedPose(view.cam, 0, { role: 'fixed' });
    game.cameras.active = 'fixed';
  } else {
    const [x, z] = view.player;
    const r = await game.areas.goto(area, x, z, view.floor);
    if (!r.ok) return shotFail(r.reason === 'unreachable' ? 'unreachable' : 'blocked', 'goto', r.result);
    game.player.yaw = view.yaw;
    game.player.bodyYaw = view.yaw;
    game.player.pitch = view.pitch ?? 0;
    if (view.mode === 'vf' && !game.sys.viewfinder.on) {
      const v = game.dispatch(game.settings.vfMode === 'hold' ? { t: 'vf', down: true } : { t: 'vf' });
      if (!v.ok) return shotFail('mode_disallows', 'vf', v.reason);
    }
    if (view.lens && game.sys.viewfinder.lens !== view.lens) {
      const l = game.dispatch({ t: 'lens' });
      if (!l.ok) return shotFail(l.reason === 'no_ability' ? 'no_ability' : 'mode_disallows', 'lens', l.reason);
    }
    if (view.zoom !== undefined) {
      for (let i = 0; i <= ZOOM_STEPS.length && game.sys.viewfinder.zoom !== view.zoom; i++) {
        const dir: 1 | -1 = ZOOM_STEPS.indexOf(view.zoom) > ZOOM_STEPS.indexOf(game.sys.viewfinder.zoom) ? 1 : -1;
        if (!game.dispatch({ t: 'zoom', dir }).ok) break;
      }
    }
    game.cameras.sync();
    await game.advance(FADE_SETTLE_SEC);
    if (view.replay) {
      const p = resolveAimPoint(game, view.replay.point);
      if (p) turnTowards(game, p, { face: false });
      for (let i = 0; i < 4 && game.sys.replay.active?.seg !== view.replay.seg; i++) {
        if (!game.dispatch({ t: 'rewind' }).ok) break;
      }
      const a = game.sys.replay.active;
      if (!a || a.seg !== view.replay.seg) return shotFail('not_near_replay_point', 'replay', a?.seg ?? null);
      game.sys.replay.seek(view.replay.t);
      if (game.sys.replay.active?.playing) game.sys.replay.togglePlay();
      // 回放 HUD 与后期叠加淡入；暂停着，人影停在 t
      await game.advance(FADE_SETTLE_SEC);
      game.player.yaw = view.yaw;
      game.player.pitch = view.pitch ?? 0;
    }
    game.cameras.sync();
  }
  // M4：按最终机位刷新高清贴图与视图变体（它们本来在 step 里按相机现算；锁步下之后只渲染，不刷新就落后一帧）
  game.areas.current?.ctx.updateViews?.();

  // 4. 界面与帧
  game.ui.setHidden(!(shot.ui ?? false));
  overlay?.setHidden(true);
  const frames = Math.max(1, Math.min(240, shot.settle ?? 12));
  for (let i = 0; i < frames; i++) await game.nextFrame();

  // 5. 关键对象的屏幕坐标（shots.mjs 在那里测 5×5 亮度）
  const keys = (shot.keys ?? []).map(id => {
    const p = resolveAimPoint(game, id);
    return p ? { id, ...toScreen(game, p) } : { id, x: -1, y: -1 };
  });
  return ok({ keys });
}
