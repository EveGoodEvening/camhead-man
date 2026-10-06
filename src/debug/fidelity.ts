// owner: WP7
// 调试 API 的“真人路径”检查（ARCH §3.5、§12.3）：interact 的视线与聚焦检查、aimAt 的俯仰钳制、walk()；
// 出入口图寻路与连通性栅格调用 core 的 areas.route()、collision.reachable()（由 AreaManager.goto 在 ?test=1 下做）。
// 另有瞄准点解析（§12.3 的顺序）与 lint() 的数据自检。WP7 内部模块（ARCH §2.13：导出不属于冻结签名），只被 debug/* 与 dev/wp7.ts 使用。

import * as THREE from 'three';
import type { ApiResult, V3 } from '../core/types';
import { fail, ok } from '../core/types';
import type { InteractId, NpcId, PhotoTargetId, ReadId, ReplayPointId, SubjectRef } from '../data/ids';
import { F, HOLE_IDS, NPC, OBJ, STALL } from '../data/ids';
import { STRINGS } from '../data/strings';
import type { Game } from '../core/game';
import type { AreaDef } from '../core/area';
import type { InteractableDef, InteractableStatus } from '../game/interaction';
import type { PhotoDecoyDef } from '../game/photo';
import type { StateView } from '../game/state';

const v3 = (p: V3, target = new THREE.Vector3()): THREE.Vector3 => target.set(p[0], p[1], p[2]);

/** 让出一次宏任务（基础设施，不是玩法计时；ARCH §3.4 的 advance 同样这样让出）。 */
export function macrotask(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// ==================================================================== 瞄准点解析（ARCH §12.3）

/** 对象的世界包围盒中心（空包围盒退回世界坐标原点）。 */
function worldCenter(obj: THREE.Object3D, target = new THREE.Vector3()): THREE.Vector3 {
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(obj);
  return box.isEmpty() ? obj.getWorldPosition(target) : box.getCenter(target);
}

/** 拍照主体/诱饵主体的质心：anchor 是主体的局部坐标偏移，缺省取世界包围盒中心（ARCH §6.8.3）。 */
function subjectsCentroid(game: Game, subjects: readonly { ref: SubjectRef | string; anchor?: V3 }[]): THREE.Vector3 | null {
  const sum = new THREE.Vector3();
  const p = new THREE.Vector3();
  let n = 0;
  for (const s of subjects) {
    const obj = game.sys.photo.resolveSubject(s.ref);
    if (!obj) continue;
    if (s.anchor) {
      obj.updateWorldMatrix(true, false);
      obj.localToWorld(v3(s.anchor, p));
    } else {
      worldCenter(obj, p);
    }
    sum.add(p);
    n++;
  }
  return n > 0 ? sum.divideScalar(n) : null;
}

/** 交互物定义里的锚点（V3 或现算函数）。 */
function anchorOfDef(def: InteractableDef): THREE.Vector3 {
  return typeof def.at === 'function' ? def.at().clone() : v3(def.at);
}

/**
 * 解析瞄准点（ARCH §12.3 的顺序）：`AreaDef.automation[id].aim` → `pt.*`（全部主体锚点的质心，回放人影取当前时刻）
 * → `rd.*`（`read.aimPoint`：函数则现算，镜中字取虚像点）→ `rp.*`（`at + (0, 0.8, 0)`）→ 交互物/NPC 的锚点 → `decoy.*`（同 pt）。
 * 另外（WP7 补充）：都不是时退回本区 `ctx.ref()` 登记对象的包围盒中心（ShotDef.keys 可以写 ref）。
 */
export function resolveAimPoint(game: Game, id: string): THREE.Vector3 | null {
  const cur = game.areas.current;
  const auto = cur?.def.automation?.[id]?.aim;
  if (auto) return v3(auto);
  const ns = id.slice(0, id.indexOf('.') + 1);
  if (ns === 'pt.') {
    const t = game.sys.photo.target(id as PhotoTargetId);
    if (t) return subjectsCentroid(game, t.subjects);
  }
  if (ns === 'rd.') {
    const p = game.sys.read.aimPoint(id as ReadId);
    if (p) return p.clone();
  }
  if (ns === 'rp.') {
    const r = game.sys.replay.point(id as ReplayPointId);
    if (r) return v3(r.at).add(new THREE.Vector3(0, 0.8, 0));
  }
  const def = game.sys.interaction.get(id as InteractId);
  if (def) return anchorOfDef(def);
  if (ns === 'npc.') {
    const npc = game.sys.npc.get(id as NpcId);
    if (npc) return npc.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.2, 0));
  }
  if (ns === 'decoy.') {
    const d = game.sys.photo.decoy(id as PhotoDecoyDef['key']);
    if (d) return subjectsCentroid(game, d.subjects);
  }
  const ref = cur?.ctx.getRef(id);
  return ref ? worldCenter(ref) : null;
}

// ==================================================================== 转向与画框

/** 当前视角用哪台相机的俯仰限制：取景器（含回放、面板叠加）用 fp，其余用 tp。 */
export function viaOf(game: Game): 'fp' | 'tp' {
  return game.cameras.active === 'fp' || game.sys.viewfinder.on ? 'fp' : 'tp';
}

/**
 * 把视角转向 p（ARCH §12.3）：explore 下先 `faceTowards`（身体朝向，决定邻近聚焦的 ±60° 扇区）再 `lookAtPoint(p,'tp')`
 * （让第三人称相机中心射线穿过 p）；取景器中 `lookAtPoint(p,'fp')`。视角被禁用（面板叠加取景器）时不改 yaw/pitch。
 * 俯仰按模式钳制（lookAtPoint 自己做），被钳制时 clamped = true。
 */
export function turnTowards(game: Game, p: THREE.Vector3, o?: { face?: boolean }): { turned: boolean; clamped: boolean } {
  if (!game.modes.lookEnabled()) return { turned: false, clamped: false };
  const via = viaOf(game);
  if (via === 'tp' && o?.face !== false) game.player.faceTowards(p);
  const r = game.player.lookAtPoint(p, via);
  game.cameras.sync();
  return { turned: true, clamped: r.clamped };
}

/** p 此刻是否在画面里：取景器开启时按 4:3 画框（frameNdcScale），否则按当前相机视口；在相机后方为假。 */
export function pointInFrame(game: Game, p: THREE.Vector3): boolean {
  const cam = game.cameras.camera;
  cam.updateMatrixWorld();
  const local = cam.worldToLocal(p.clone());
  if (local.z >= -cam.near) return false;
  const ndc = p.clone().project(cam);
  let sx = 1;
  let sy = 1;
  if (game.sys.viewfinder.on) ({ sx, sy } = game.sys.viewfinder.frameNdcScale());
  return Math.abs(ndc.x * sx) <= 1 && Math.abs(ndc.y * sy) <= 1;
}

// ==================================================================== interact/show/use 的真人路径检查

/** 目标此刻“因视图规则”不可聚焦（ARCH §6.6 聚焦规则 3）：阴物在肉眼下且未常显，或 naked 目标在取景器里。 */
function viewBlocks(game: Game, st: InteractableStatus): boolean {
  const vf = game.sys.viewfinder.on;
  if (st.view === 'viewfinder') return !vf && !game.state.seen(st.id);
  if (st.view === 'naked') return vf;
  return false;
}

function wrongViewText(def: InteractableDef | undefined, s: StateView): string | undefined {
  const w = def?.wrongView;
  if (w === undefined) return undefined;
  return typeof w === 'function' ? w(s) : w;
}

export interface FidelityResult { feedback?: string; focused?: InteractId | null; blocker?: string; distance?: number }

/**
 * ?test=1 下 interact/show/use 的检查（ARCH §12.3）：
 * ① `collision.raycast(眼 → 锚点, far = 距离 − 0.15, { skipSeeThrough: true, ignoreKeys: [id] })` 无遮挡
 *   （玻璃门这类 seeThrough 动态碰撞体与目标自身的碰撞体不算遮挡）；
 * ② 转向之后 `interaction.focusCandidate() === id`。
 * 因视图规则不可聚焦 → `wrong_view`（附 wrongView 文本）；其他不满足 → `not_focusable`。调用方负责先转向。
 */
export function checkInteractFidelity(game: Game, id: InteractId, anchor?: THREE.Vector3): ApiResult<FidelityResult> {
  const ia = game.sys.interaction;
  const def = ia.get(id);
  if (!def) return fail('no_such_target');
  const st = ia.list().find(s => s.id === id);
  if (st && viewBlocks(game, st)) {
    const fb = wrongViewText(def, game.state);
    return fail('wrong_view', fb === undefined ? {} : { feedback: fb });
  }
  const p = anchor ?? resolveAimPoint(game, id) ?? anchorOfDef(def);
  const eye = game.player.eye.clone();
  const dir = p.clone().sub(eye);
  const dist = dir.length();
  if (dist > 0.16) {
    dir.divideScalar(dist);
    const hit = game.collision.raycast(eye, dir, dist - 0.15, { skipSeeThrough: true, ignoreKeys: [id] });
    if (hit) return fail('not_focusable', { blocker: hit.key ?? 'static', distance: Math.round(hit.distance * 100) / 100 });
  }
  const cand = ia.focusCandidate();
  if (cand !== id) return fail('not_focusable', { focused: cand });
  return ok({});
}

// ==================================================================== 推进时间直到完成（walk 等）

/**
 * 等 done() 为真：锁步下自己 `advance()` 推进游戏时间（advance 在 Game 内部串行，别的系统同时在推进也不会交错），
 * 非锁步时等真实渲染帧。maxGameSec 防止永远走不到（真实时间上限由 api.ts 的超时兜底）。
 */
export async function driveUntil(game: Game, done: () => boolean, maxGameSec = 120): Promise<boolean> {
  const g0 = game.time;
  while (!done()) {
    if (game.time - g0 > maxGameSec) return false;
    if (game.lockstep) {
      const t = game.time;
      await game.advance(0.25, 1 / 30, done);
      // 冻结模式下游戏时间不走：再推也没用，交给调用方的超时
      if (game.time === t && !done()) await macrotask();
    } else {
      await game.nextFrame();
    }
  }
  return true;
}

/** walk(x, z) 的实现：`player.walkTo` 经正常的 MoveInput 与碰撞真走（ARCH §12.3）；1 秒无进展由 walkTo 判为被挡。 */
export async function walkTo(game: Game, x: number, z: number): Promise<{ ok: boolean; pos: V3 }> {
  let out: { ok: boolean; pos: V3 } | null = null;
  const p = game.player.walkTo(x, z).then(r => {
    out = r;
    return r;
  });
  await driveUntil(game, () => out !== null, 600);
  return await p;
}

// ==================================================================== lint()：数据自检（ARCH §12.3、§6.6）

/** 角标比较时去掉序号（开关①…④、取件格编号等只允许序号不同）。 */
function stripOrdinals(s: string): string {
  return s.replace(/[0-9０-９①-⑳]/g, '').trim();
}

function emptyText(v: unknown): boolean {
  return typeof v === 'string' && v.trim() === '';
}

/** STRINGS 里的空串（说话人等特意为空的不在 STRINGS 里）。 */
function lintStrings(obj: unknown, path: string, out: string[]): void {
  if (typeof obj === 'string') {
    if (obj.trim() === '') out.push(`strings: ${path} 为空串`);
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => lintStrings(v, `${path}[${i}]`, out));
    return;
  }
  if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) lintStrings(v, path ? `${path}.${k}` : k, out);
}

/**
 * label：'same'（默认）= 去掉序号后角标文字必须相同；'shape' = 角标按形状各叫各的（GDD §10.2 暗房三件容器“方盘”“深盆”“豁口盘”），
 * 只比较其余几项，并要求文字里没有颜色字（M3，docs/requests/r3.md #3：颜色是 P7 的谜底，色彩辅助只走 colorHint）。
 */
interface LintGroup { name: string; ids: readonly InteractId[]; active?: (s: StateView) => boolean; label?: 'same' | 'shape' }

/** 'shape' 组角标里不许出现的颜色字。 */
const COLOR_CHARS = /[红黄白绿蓝紫黑灰橙青褐粉]/;

/** 同组角标与交互流程必须一致的对象组（ARCH §6.6 硬规则、GDD §10.2）。 */
const LINT_GROUPS: readonly LintGroup[] = [
  { name: '取件格 r3.hole_*', ids: HOLE_IDS },
  { name: '开关 r1.switch_*', ids: [OBJ.R1_SWITCH_1, OBJ.R1_SWITCH_2, OBJ.R1_SWITCH_3, OBJ.R1_SWITCH_4] },
  { name: '暗房容器', ids: [OBJ.R3_TRAY_SQUARE, OBJ.R3_BASIN_XI, OBJ.R3_PLATE_CHIPPED], label: 'shape' },
  { name: '三块新瓷砖', ids: [OBJ.R2_TILE_LEFT_LOW, OBJ.R2_TILE_RIGHT_LOW, OBJ.R2_TILE_TOP] },
  { name: '纸人摊主 r4.stall_* + npc.huang（看破前）', ids: [...Object.values(STALL), NPC.HUANG], active: s => !s.flag(F.R4_FOUND_HUANG) },
];

function defaultVerb(id: InteractId): 'show' | 'use' {
  return id.startsWith('npc.') || (Object.values(STALL) as string[]).includes(id) ? 'show' : 'use';
}

/**
 * lint 的静态部分：检查区域定义的数据（带 when 的交互物/出入口是否写了 blocked、文本常量是否为空、截图机位 id 前缀）。
 * 单独导出，dev/wp7.ts 的自测拿合成的 AreaDef 验证它（dev 下 ctx.interactable 对“有 when 没 blocked”直接抛错，运行期造不出这种数据）。
 */
export function lintAreaDefs(defs: Iterable<AreaDef>): string[] {
  const out: string[] = [];
  for (const def of defs) {
    const a = def.id;
    for (const d of def.interactables ?? []) {
      if (d.when !== undefined && d.blocked === undefined) out.push(`${a}: 交互物 ${d.id} 有 when 却没有 blocked`);
      if (emptyText(d.label)) out.push(`${a}: 交互物 ${d.id} 的 label 为空`);
    }
    for (const e of def.exits) if (e.when !== undefined && !e.blocked) out.push(`${a}: 出入口 ${e.id} 有 when 却没有 blocked`);
    for (const dl of def.dialogues ?? []) {
      for (const [k, n] of Object.entries(dl.nodes)) {
        if ((n.type === undefined || n.type === 'line') && emptyText(n.text)) out.push(`${a}: 对话 ${dl.id} 节点 ${k} 正文为空`);
        if (n.type === 'choice') n.options.forEach((o, i) => { if (emptyText(o.label)) out.push(`${a}: 对话 ${dl.id} 节点 ${k} 选项 ${i + 1} 为空`); });
      }
    }
    for (const seg of def.segments ?? []) seg.subs.forEach((s, i) => { if (emptyText(s.text)) out.push(`${a}: 片段 ${seg.id} 字幕 ${i + 1} 为空`); });
    for (const doc of def.docs ?? []) {
      if (emptyText(doc.title)) out.push(`${a}: 文档 ${doc.id} 标题为空`);
      if (emptyText(doc.body)) out.push(`${a}: 文档 ${doc.id} 正文为空`);
    }
    for (const pz of def.puzzles ?? []) pz.hints.forEach((h, i) => { if (emptyText(h)) out.push(`${a}: 谜题 ${pz.id} 第 ${i + 1} 级提示为空`); });
    for (const pg of def.journalPages ?? []) if (emptyText(pg.text)) out.push(`${a}: 巡夜本新页 ${pg.index} 为空`);
    for (const t of def.photoTargets ?? []) for (const [f, c] of Object.entries(t.captions ?? {})) if (emptyText(c)) out.push(`${a}: ${t.id} 的空镜标题 ${f} 为空`);
    for (const r of def.readTargets ?? []) if (emptyText(r.text)) out.push(`${a}: 读字目标 ${r.id} 的原文为空`);
    for (const s of def.shots ?? []) if (!s.id.startsWith(`shot.${a}.`)) out.push(`${a}: 截图机位 ${s.id} 不以 shot.${a}. 开头`);
  }
  return out;
}

/**
 * lint()：返回问题列表（`check.mjs` 调用）。静态部分见 lintAreaDefs（全部区域）与 STRINGS 空串；
 * 当前区域另外检查 build 里登记的交互物、拍照主体与 hideWorld 的 ref 能否解析、同组角标与交互流程是否一致。
 */
export function lintGame(game: Game): string[] {
  const out = lintAreaDefs(game.areas.defs.values());
  lintStrings(STRINGS, '', out);

  const cur = game.areas.current;
  if (!cur) return out;
  const a = cur.def.id;
  const ia = game.sys.interaction;
  const statuses = ia.list();
  const byId = new Map(statuses.map(s => [s.id, s] as const));
  const staticIds = new Set((cur.def.interactables ?? []).map(d => d.id));
  for (const st of statuses) {
    const d = ia.get(st.id);
    if (!d) continue;
    if (!staticIds.has(st.id) && d.when !== undefined && d.blocked === undefined) out.push(`${a}: 交互物 ${st.id} 有 when 却没有 blocked`);
    if (st.label.trim() === '') out.push(`${a}: 交互物 ${st.id} 的角标文字现算为空`);
  }
  // 拍照主体、诱饵主体与 hideWorld 的 ref 能否解析（区域加载后校验，ARCH §6.8.3）
  const ghosts = new Set<string>();
  for (const seg of cur.def.segments ?? []) for (const act of seg.actors) ghosts.add(act.id);
  const checkRef = (owner: string, ref: string): void => {
    if (ref === 'pc.body' || ref === 'pc.huoji') return;
    if (ref.startsWith('ghost.')) {
      if (!ghosts.has(ref)) out.push(`${a}: ${owner} 的主体 ${ref} 不在本区任何片段的人影里`);
      return;
    }
    if (ref.startsWith('npc.')) {
      if (!game.sys.npc.get(ref as NpcId)) out.push(`${a}: ${owner} 的主体 ${ref} 不是本区 NPC`);
      return;
    }
    if (!cur.ctx.getRef(ref) && !game.sys.photo.resolveSubject(ref)) out.push(`${a}: ${owner} 的主体 ref ${ref} 解析不到`);
  };
  for (const t of cur.def.photoTargets ?? []) for (const s of t.subjects) checkRef(t.id, s.ref);
  for (const d of cur.def.photoDecoys ?? []) for (const s of d.subjects) checkRef(d.key, s.ref);
  for (const seg of cur.def.segments ?? []) {
    for (const h of seg.hideWorld ?? []) if (!cur.ctx.getRef(h.ref)) out.push(`${a}: 片段 ${seg.id} 的 hideWorld ref ${h.ref} 解析不到`);
  }
  // 同组角标与交互流程一致（灰/白、文字、hasOffers、是否弹动作菜单、menuVerb）
  for (const g of LINT_GROUPS) {
    if (g.active && !g.active(game.state)) continue;
    const members = g.ids.map(id => byId.get(id)).filter((s): s is InteractableStatus => s !== undefined && s.present);
    if (members.length < 2) continue;
    const sig = (s: InteractableStatus): string => {
      const d = ia.get(s.id);
      const primary = !!(d && (d.onInteract !== undefined || (d.talk?.length ?? 0) > 0));
      const menu = s.hasOffers && primary;
      const verb = menu ? (d?.menuVerb ?? defaultVerb(s.id)) : '-';
      const text = g.label === 'shape' ? '(形状)' : stripOrdinals(s.label);
      return JSON.stringify([s.available ? 'white' : 'grey', text, s.hasOffers, menu, verb]);
    };
    if (g.label === 'shape') {
      for (const m of members) if (COLOR_CHARS.test(m.label)) out.push(`${a}: 同组“${g.name}”的角标 ${m.id}“${m.label}”含颜色字（只按形状叫，GDD §10.2）`);
    }
    const ref0 = members[0]!;
    const want = sig(ref0);
    for (const m of members.slice(1)) {
      const got = sig(m);
      if (got !== want) out.push(`${a}: 同组“${g.name}”不一致：${ref0.id} ${want} ≠ ${m.id} ${got}`);
    }
  }
  return out;
}
