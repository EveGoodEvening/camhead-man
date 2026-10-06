// owner: WP7
// 单区域测试的前置状态（ARCH §15.4）：均为 GDD §11 走到该步之前应有的状态。regions/<id>.mjs 在 ?debug=1 下用 setState(PRESETS.x) 预置。
// 截图机位的时辰简写（'zi' = r2_start、'chou' = r4_start、'yin' = yin、'mao'）在 src/debug/shots.ts 的 SHOT_PRESETS 里另有一份，
// scripts/selftest/wp7.mjs 校验两边一致；改这里就同步改那里。
//
// 物品写 'it.x'（未用）或 { id, used: true }；同一物品后出现的条目覆盖前面的（'it.bulb' 在 r2_start 未用、r3_start 已用）。

const used = id => ({ id, used: true });

/** 合并：flags 覆盖、items 按 id 以后者为准、photos 去重。 */
export function mergePreset(...parts) {
  const flags = {};
  const items = new Map();
  const photos = [];
  for (const p of parts) {
    if (!p) continue;
    Object.assign(flags, p.flags ?? {});
    for (const it of p.items ?? []) items.set(typeof it === 'string' ? it : it.id, it);
    for (const ph of p.photos ?? []) if (!photos.includes(ph)) photos.push(ph);
  }
  return { flags, items: [...items.values()], photos };
}

const R2_START = {
  flags: {
    'r1.log_taken': true, 'r1.gate_lamp_on': true, 'r1.met_tudi': true, 'r1.ability_replay': true, 'r1.p1_done': true,
    'r1.mission_given': true, 'r1.drawer_open': true, 'r1.gate_unchained': true,
  },
  items: ['it.log', used('it.keys'), 'it.bulb', 'it.slip_0473', 'it.idcard'],
  photos: ['ph.tudi'],
};

const R3_START = mergePreset(R2_START, {
  flags: {
    'r2.lobby_lamp_lit': true, 'r2.wang_met': true, 'r2.wang_escort': true, 'r2.wang_floor': 5, 'r2.bulb_installed': true,
    'r2.menshen_open': true, 'r2.tin_opened': true, 'r2.wang_done': true, 'r2.ability_ir': true,
  },
  items: [used('it.bulb'), used('it.letter'), 'it.train_ticket', 'it.glasses', 'it.wonton', 'it.money'],
  photos: ['ph.menshen_2018'],
});

const R4_START = mergePreset(R3_START, {
  flags: { 'r3.lu_door_open': true, 'r3.got_envelope': true, 'r3.film_hung': true, 'r3.film_developed': true, 'r3.saw_true_form': true },
  items: [used('it.slip_0473'), 'it.film', used('it.slip_0474'), 'it.portrait'],
  photos: ['ph.covered_face', 'ph.film3', 'ph.true_form'],
});

const YIN = mergePreset(R4_START, {
  flags: { 'r4.ghost_market_open': true, 'r4.spotted_huang': true, 'r4.found_huang': true, 'r4.asked_tape': true, 'r4.huang_admits': true, 'r4.got_tape': true },
  items: [used('it.money'), 'it.tape_830'],
  photos: ['ph.huang_hides', 'ph.huang_normal', 'ph.huang_ir'],
});

/** 截图机位的“卯时”：寅时 + 终章 flags 直到 r1.soul_returned（ARCH §12.5）。 */
const MAO = mergePreset(YIN, {
  flags: {
    'r1.tape_in_vcr': true, 'r1.tape_watched': true, 'r1.heard_voice': true, 'r1.portrait_placed': true, 'r1.portrait_complete': true,
    'r1.zhou_visible': true, 'r1.zhou_fed': true, 'r1.soul_returned': true,
  },
  items: [used('it.tape_830'), used('it.portrait'), used('it.wonton')],
  photos: ['ph.tape_face', 'ph.zhou_tunnel', 'ph.final'],
});

/**
 * ARCH §15.4 的预置。new = 新游戏（不 setState，用 newGame() + dlg()）。
 * 每项另带 start：setState 时进入的区域与出生点（区域测试的第一步都以 goto 开头，出生点只要可达即可）。
 */
export const PRESETS = {
  new: null,
  r2_start: { ...R2_START, start: { area: 'r1', spawn: 'spawn.r1_start' } },
  r3_start: { ...R3_START, start: { area: 'r1', spawn: 'spawn.r1_start' } },
  r4_start: { ...R4_START, start: { area: 'r1', spawn: 'spawn.r1_start' } },
  yin: { ...YIN, start: { area: 'r1', spawn: 'spawn.r1_start' } },
  /** R1-finale 测步骤 12 用 */
  ants: { ...mergePreset(R2_START, { photos: ['ph.old_1', 'ph.old_2'] }), start: { area: 'r1', spawn: 'spawn.r1_start' } },
  /** 测步骤 46 与南柯路线 */
  yin_nanke: {
    ...mergePreset(YIN, { flags: { 'r1.ant_old_1': true, 'r1.ant_old_2': true }, photos: ['ph.old_1', 'ph.old_2', 'ph.old_3', 'ph.old_4', 'ph.old_5', 'ph.old_6'] }),
    start: { area: 'r1', spawn: 'spawn.r1_start' },
  },
};

/** shots 的时辰简写（与 src/debug/shots.ts 的 SHOT_PRESETS 对应）。 */
export const SHOT_PRESETS = { zi: R2_START, chou: R4_START, yin: YIN, mao: MAO };

/** setState 的参数：{ flags, items, photos, area, spawn }。 */
export function presetPatch(name, start) {
  const p = PRESETS[name];
  if (p === undefined) throw new Error(`没有这个预置：${name}`);
  if (p === null) return null;
  const s = start ?? p.start;
  return { flags: { ...p.flags }, items: [...p.items], photos: [...p.photos], ...(s ? { area: s.area, spawn: s.spawn } : {}) };
}

/**
 * 在 ?debug=1 的页面里应用预置：new → newGame() + dlg() 跑完开场；其余 → setState({...预置, area, spawn})。
 * 返回之后模式应为 explore。
 */
export async function applyPreset(h, name, start) {
  const patch = presetPatch(name, start);
  if (patch === null) {
    await h.call('newGame');
    await h.call('dlg');
    return;
  }
  await h.call('setState', patch);
}
