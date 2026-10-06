// owner: integrator
// M1c look-dev 样板角落（ARCH §15.3 第 3 步）：沙盒东南角按 R1 的标准夜景搭一小块“基准画面”，冻结 LIGHT_SCALE、曝光、Bloom、
// 环境贴图强度与后期预设时就看这几张图（shot.dev.lookdev_*）。区域代理照这里的用法写灯与材质，就能得到同样的画面。
//
// 布局（俯视，+x 东，-z 北；机位多从北往南看，所以画面左边是东）：
//   门岗（门卫室）x 5.0–9.8、z 12.2–14.85，靠着南墙，正面朝北：木门 + 两级台阶、门灯、门楣空支架、传达室窗（窗里一台亮着的 CRT）；
//   钠灯杆脚 (11.8, 10.6)，灯臂朝西伸到门岗前（wetStreak）；槐树一角 (3.6, 9.9) 与一串彩灯（emissive）；南墙、东墙内侧贴砖（院墙）与红圈“拆”；
//   墙外街上两盏只有灯罩的远灯（light:false，靠 Bloom 出光）；
//   西侧一段院墙收住布景；夜空天穹（skyDome）；墙外两栋几乎全黑的居民楼（少量亮窗，z ≈ 27 与 z ≈ 50，雾里分出层次）；
//   雨、湿地面（asphaltWet）。
//   门口站着一个摄像头人（主角同款模型，近景机位看镜头环、铁皮帽、贴条）；窗前一个魂影（layer.yin，只在取景器里看得见）；
//   院门口一个残影点（借 GDD 的 rp.r1_gate / seg.gate_2026，只在 dev 区域这样用），回放机位看回放人影与 VHS 后期。
// 灯：沙盒底座 1 盏（R1 的半球光）+ 这里 3 盏（钠灯、门灯、CRT 磷绿）= 4 盏（≤ 8；R1 本身 8 盏里没有月光，基准画面也不用）。
// 设计强度一律照 GDD（钠灯 2.2/14、CRT 0.6/3），门灯是墙上 2.5m 高的近灯，另取 0.5/7（见 AGENTS.md 的 look-dev 用法）。

import * as THREE from 'three';
import type { AreaContext, AreaPart } from '../../core/area';
import type { PlayerController } from '../../core/player';
import type { V3 } from '../../core/types';
import { GHOST, RP, SEG, F } from '../../data/ids';
import { PALETTE } from '../../data/palette';
import { QUALITY } from '../../data/render';
import { setLayerRecursive } from '../../core/layers';
import { MATERIALS } from '../../fx/materials';
import { createCrtScreenMaterial } from '../../fx/crtScreen';
import { lamp } from '../../kit/lamps';
import { rain, type RainRig } from '../../kit/rain';
import { building } from '../../kit/building';
import { huaiTree, skyDome } from '../../kit/nature';
import { door } from '../../kit/doors';
import { sign } from '../../kit/signs';
import { PROPS } from '../../kit/props';
import { PAINT } from '../../kit/canvas';
import { box } from '../../kit/geom';
import { createResidueVortex, createFootprints } from '../../kit/residue';
import { createCharacter } from '../../rigs/characters';
import { createPlayerModel, type PlayerModel } from '../../rigs/player';
import { FONT_STACK } from '../../kit/text';
import { registerSelftest } from '../../debug/selftest';
import type { FxParams } from '../../fx/post';

// ==================================================================== 布局常量

/** 门岗（门卫室）外框。 */
export const LD_BOOTH = { x0: 5.0, x1: 9.8, z0: 12.2, z1: 14.85, h: 2.9 } as const;
/** 门洞（底边中点）与窗洞。 */
const DOOR = { x: 6.1, w: 1.0, y0: 0.3, h: 2.05 } as const;
const WIN = { x0: 7.3, x1: 9.2, y0: 0.95, y1: 2.05 } as const;
/** 钠灯杆脚（灯臂朝西，灯头在杆脚以西 1.25m）。 */
export const LD_SODIUM: V3 = [11.8, 0, 10.6];
/** 门灯（墙上，门洞正上方）。 */
const GATE_LAMP_AT: V3 = [DOOR.x, 2.62, LD_BOOTH.z0];
/** 门口站着的摄像头人（主角同款模型）。 */
export const LD_DUMMY: V3 = [7.0, 0, 11.45];
/** 窗前的魂影（layer.yin）。 */
const LD_GHOST: V3 = [9.0, 0, 11.2];
/** 残影点（院门口）。 */
export const LD_REPLAY_AT: V3 = [8.6, 0, 9.4];
/** 槐树一角。 */
const LD_TREE: V3 = [3.6, 0, 9.9];
/** 湿地面与院墙贴砖的范围。 */
const LD_GROUND = { x0: 3.0, x1: 14.85, z0: 3.5, z1: 14.85 } as const;
const WALL_IN = 14.84;

// ==================================================================== 小工具

function add(ctx: AreaContext, o: THREE.Object3D, opts?: Parameters<AreaContext['add']>[1]): void {
  ctx.add(o, opts);
}

/** CRT 画面：一路监控（院门口，夜里，灰绿）。 */
function crtFeedTexture(ctx: AreaContext): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 192;
  const g = cv.getContext('2d');
  if (g) {
    const sky = g.createLinearGradient(0, 0, 0, 192);
    sky.addColorStop(0, '#1b2229');
    sky.addColorStop(0.55, '#3b4652');
    sky.addColorStop(1, '#262b30');
    g.fillStyle = sky;
    g.fillRect(0, 0, 256, 192);
    // 院门、路灯的一团光、地上的反光
    g.fillStyle = '#12161b';
    g.fillRect(60, 70, 136, 80);
    g.fillStyle = '#6d7a86';
    for (let i = 0; i < 9; i++) g.fillRect(66 + i * 15, 76, 4, 70);
    const lampG = g.createRadialGradient(206, 44, 2, 206, 44, 40);
    lampG.addColorStop(0, 'rgba(255,255,230,1)');
    lampG.addColorStop(1, 'rgba(255,255,230,0)');
    g.fillStyle = lampG;
    g.fillRect(160, 0, 96, 100);
    g.fillStyle = 'rgba(220,230,210,0.35)';
    g.fillRect(190, 150, 30, 42);
    g.fillStyle = PALETTE.OSD;
    g.font = `bold 15px ${FONT_STACK}`;
    g.fillText('CH1  院门', 10, 20);
    g.fillText('23:40:12', 170, 184);
  }
  const t = ctx.track(new THREE.CanvasTexture(cv));
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ==================================================================== 建造

function buildGround(ctx: AreaContext): void {
  const G = LD_GROUND;
  // 湿沥青（三向投影，贴图密度只看“米/张”）：盖在沙盒网格地面上 4mm
  const wet = new THREE.Mesh(new THREE.PlaneGeometry(G.x1 - G.x0, G.z1 - G.z0).rotateX(-Math.PI / 2), MATERIALS.asphaltWet());
  wet.position.set((G.x0 + G.x1) / 2, 0.004, (G.z0 + G.z1) / 2);
  wet.name = 'lookdev.wetGround';
  add(ctx, wet);
  // 门岗前的水泥台（人行道）
  add(ctx, box(LD_BOOTH.x1 - LD_BOOTH.x0 + 0.8, 0.06, 1.2, MATERIALS.concrete(), [(LD_BOOTH.x0 + LD_BOOTH.x1) / 2, 0.03, LD_BOOTH.z0 - 0.6]));
}

function buildCourtyardWalls(ctx: AreaContext): void {
  const G = LD_GROUND;
  const brick = MATERIALS.brick();
  const coping = MATERIALS.concrete();
  // 南墙、东墙内侧贴一层砖（沙盒外墙 3m 高，院墙同高），顶上压一条水泥压顶
  const southLen = G.x1 - G.x0;
  add(ctx, box(southLen, 3.0, 0.06, brick, [(G.x0 + G.x1) / 2, 1.5, WALL_IN - 0.03]));
  add(ctx, box(southLen, 0.1, 0.4, coping, [(G.x0 + G.x1) / 2, 3.05, 15]));
  const eastLen = G.z1 - G.z0;
  add(ctx, box(0.06, 3.0, eastLen, brick, [WALL_IN - 0.03, 1.5, (G.z0 + G.z1) / 2]));
  add(ctx, box(0.4, 0.1, eastLen, coping, [15, 3.05, (G.z0 + G.z1) / 2]));
  // 红圈“拆”：南墙上、钠灯下
  const mark = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 1.7),
    new THREE.MeshStandardMaterial({ map: ctx.track(PAINT.demolitionMark()), transparent: true, depthWrite: false, roughness: 0.9 }),
  );
  mark.rotation.y = Math.PI;
  mark.position.set(11.9, 1.75, WALL_IN - 0.07);
  mark.renderOrder = 1;
  mark.name = 'lookdev.demolition';
  add(ctx, mark, { occlude: false });
  // 小广告
  const posters = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.1),
    new THREE.MeshStandardMaterial({ map: ctx.track(PAINT.posters({ lines: ['开锁', '通下水道', '回收旧家电'], seed: 12 })), transparent: true, depthWrite: false, roughness: 0.9 }),
  );
  posters.rotation.y = -Math.PI / 2;
  posters.position.set(WALL_IN - 0.07, 1.2, 9.0);
  posters.renderOrder = 1;
  add(ctx, posters, { occlude: false });
}

function buildBooth(ctx: AreaContext): void {
  const B = LD_BOOTH;
  const wallT = 0.2;
  const plaster = MATERIALS.plaster();
  const lime = MATERIALS.lime();
  const dadoMat = new THREE.MeshStandardMaterial({ color: PALETTE.DADO, roughness: 0.55 });
  const zc = B.z0 + wallT / 2;
  const piece = (x0: number, x1: number, y0: number, y1: number) => add(ctx, box(x1 - x0, y1 - y0, wallT, plaster, [(x0 + x1) / 2, (y0 + y1) / 2, zc]));
  const dx0 = DOOR.x - DOOR.w / 2, dx1 = DOOR.x + DOOR.w / 2, dTop = DOOR.y0 + DOOR.h;
  // 正面（留门洞与窗洞）
  piece(B.x0, dx0, 0, B.h);
  piece(dx0, dx1, dTop, B.h);
  piece(dx1, WIN.x0, 0, B.h);
  piece(WIN.x0, WIN.x1, 0, WIN.y0);
  piece(WIN.x0, WIN.x1, WIN.y1, B.h);
  piece(WIN.x1, B.x1, 0, B.h);
  // 墙裙：正面下半截刷绿（门洞处断开）
  const dadoH = 0.95;
  const dado = (x0: number, x1: number) => add(ctx, box(x1 - x0, dadoH, 0.02, dadoMat, [(x0 + x1) / 2, dadoH / 2, B.z0 - 0.011]));
  dado(B.x0, dx0);
  dado(dx1, B.x1);
  // 两侧墙
  add(ctx, box(wallT, B.h, B.z1 - B.z0, plaster, [B.x0 + wallT / 2, B.h / 2, (B.z0 + B.z1) / 2]));
  add(ctx, box(wallT, B.h, B.z1 - B.z0, plaster, [B.x1 - wallT / 2, B.h / 2, (B.z0 + B.z1) / 2]));
  // 屋内：地面、后墙（石灰白）、顶棚
  add(ctx, box(B.x1 - B.x0 - 2 * wallT, 0.3, B.z1 - B.z0 - wallT, MATERIALS.concrete(), [(B.x0 + B.x1) / 2, 0.15, (B.z0 + B.z1) / 2 + wallT / 2]));
  add(ctx, box(B.x1 - B.x0 - 2 * wallT, B.h, 0.05, lime, [(B.x0 + B.x1) / 2, B.h / 2, B.z1 - 0.2]));
  // 屋顶：出檐的水泥板
  add(ctx, box(B.x1 - B.x0 + 0.5, 0.16, B.z1 - B.z0 + 0.35, MATERIALS.concrete(), [(B.x0 + B.x1) / 2, B.h + 0.08, (B.z0 + B.z1) / 2 - 0.17]));
  // 碰撞：整个门岗一个盒子（门不开）
  ctx.collider.box([(B.x0 + B.x1) / 2, B.h / 2, (B.z0 + B.z1) / 2], [B.x1 - B.x0, B.h, B.z1 - B.z0]);

  // 门 + 两级台阶
  const d = door({ w: DOOR.w, h: DOOR.h, style: 'wood', at: [DOOR.x, DOOR.y0, B.z0 + 0.02], yaw: 0 });
  add(ctx, d.group);
  const concrete = MATERIALS.concrete();
  add(ctx, box(1.5, 0.3, 0.34, concrete, [DOOR.x, 0.15, B.z0 - 0.17]));
  add(ctx, box(1.5, 0.15, 0.34, concrete, [DOOR.x, 0.075, B.z0 - 0.51]));
  ctx.collider.box([DOOR.x, 0.15, B.z0 - 0.34], [1.5, 0.3, 0.68]);

  // 窗：钢窗框 + 玻璃（noOcclude）+ 窗台
  const steel = MATERIALS.metal();
  const wcx = (WIN.x0 + WIN.x1) / 2, wcy = (WIN.y0 + WIN.y1) / 2, ww = WIN.x1 - WIN.x0, wh = WIN.y1 - WIN.y0;
  add(ctx, box(ww + 0.1, 0.05, 0.3, concrete, [wcx, WIN.y0 - 0.02, B.z0 - 0.02]));
  for (const x of [WIN.x0 + 0.02, wcx, WIN.x1 - 0.02]) add(ctx, box(0.04, wh, 0.05, steel, [x, wcy, B.z0 + 0.1]));
  for (const y of [WIN.y0 + 0.02, WIN.y0 + wh * 0.62, WIN.y1 - 0.02]) add(ctx, box(ww, 0.04, 0.05, steel, [wcx, y, B.z0 + 0.1]));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), MATERIALS.glass());
  glass.rotation.y = Math.PI;
  glass.position.set(wcx, wcy, B.z0 + 0.1);
  add(ctx, glass, { occlude: false });

  // 屋里：桌子 + 一台亮着的 CRT（屏幕斜对着窗外）
  const desk = PROPS.desk();
  desk.position.set(wcx + 0.1, 0.3, B.z0 + 0.75);
  desk.rotation.y = Math.PI;
  add(ctx, desk);
  const crt = PROPS.crt();
  crt.group.position.set(wcx + 0.3, 1.06, B.z0 + 0.5);
  crt.group.rotation.y = -0.25;
  const screenMat = createCrtScreenMaterial();
  screenMat.uniforms.map.value = crtFeedTexture(ctx);
  screenMat.uniforms.noise.value = 0.15;
  ctx.track(screenMat);
  crt.screen.material = screenMat;
  add(ctx, crt.group, { ref: 'lookdev.crt' });
  const glow = lamp({ kind: 'crt_glow', at: [wcx + 0.25, 1.3, B.z0 + 0.2], light: { design: 0.6, distance: 3 } });
  add(ctx, glow.group);
  if (glow.light) ctx.light(glow.light);

  // 门灯（墙上，灯具朝北）+ 门楣空支架 + “传达室”牌匾
  const gate = lamp({ kind: 'gate_lamp', at: GATE_LAMP_AT, light: { design: 0.5, distance: 7 }, wetStreak: false });
  add(ctx, gate.group);
  if (gate.light) ctx.light(gate.light);
  const bracket = PROPS.bracket();
  bracket.position.set(DOOR.x + 0.72, 2.55, B.z0);
  add(ctx, bracket);
  const plaque = sign({ text: '传达室', style: 'plaque', w: 0.9, h: 0.3 });
  plaque.group.rotation.y = Math.PI;
  plaque.group.position.set(wcx, 2.42, B.z0 - 0.02);
  add(ctx, plaque.group);
}

function buildStreet(ctx: AreaContext): void {
  // 钠灯：灯臂朝西（rotation.y = π/2 把灯具的 -z 转到 -x），湿地光带
  const sodium = lamp({ kind: 'sodium_pole', at: LD_SODIUM, light: { design: 2.2, distance: 14 }, wetStreak: true });
  sodium.group.rotation.y = Math.PI / 2;
  sodium.group.updateMatrixWorld(true);
  if (sodium.light) {
    const head = new THREE.Vector3(0, 5.55, -1.25).applyMatrix4(sodium.group.matrixWorld);
    sodium.light.position.copy(head);
    ctx.light(sodium.light);
  }
  add(ctx, sodium.group, { ref: 'lookdev.sodium' });
  ctx.collider.box([LD_SODIUM[0], 1.5, LD_SODIUM[2]], [0.3, 3, 0.3]);
  // 电线：灯杆 → 东墙外
  add(ctx, PROPS.wires([LD_SODIUM[0], 5.3, LD_SODIUM[2]], [16, 6.2, 4], 0.35));
  add(ctx, PROPS.wires([LD_SODIUM[0], 5.1, LD_SODIUM[2]], [LD_BOOTH.x1, LD_BOOTH.h + 0.1, LD_BOOTH.z0 + 0.5], 0.25));

  // 墙外街上的两盏远灯：只有灯罩（light:false），靠 Bloom 出光（GDD §9.3“远处的灯只保留 emissive 灯罩”）
  for (const [x, z, rot] of [[16.5, 22, Math.PI / 2], [-2.5, 25, -Math.PI / 2]] as const) {
    const far = lamp({ kind: 'sodium_pole', at: [x, 0, z], light: false });
    far.group.rotation.y = rot;
    add(ctx, far.group);
  }
  // 槐树彩灯（GDD §4.1：只用 emissive）：从树干拉到门岗屋檐
  const bulbs = lamp({ kind: 'string_lights', at: [6.9, 3.35, 11.0], light: false });
  bulbs.group.rotation.y = -0.44;
  add(ctx, bulbs.group);

  // 槐树一角（树干在画面右前方，树冠压在头顶）
  const tree = huaiTree({ trunkR: 0.7, canopyR: 7, seed: 1984 });
  tree.group.position.set(...LD_TREE);
  add(ctx, tree.group);
  const c = tree.collider;
  ctx.collider.box([c.center[0] + LD_TREE[0], c.center[1], c.center[2] + LD_TREE[2]], c.size);

  // 西侧一段院墙把布景收住（后面是别的 WP 的夹具）：砖墙 + 压顶，墙上贴一片小广告
  add(ctx, box(0.24, 2.6, 7.85, MATERIALS.brick(), [4.85, 1.3, 10.925]));
  add(ctx, box(0.4, 0.1, 7.85, MATERIALS.concrete(), [4.85, 2.65, 10.925]));
  ctx.collider.wall([4.85, 7.0], [4.85, 14.85], 0, 2.6, 0.24);
  const ads = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 1.0),
    new THREE.MeshStandardMaterial({ map: ctx.track(PAINT.posters({ lines: ['开锁', '办证', '回收旧家电'], seed: 31 })), transparent: true, depthWrite: false, roughness: 0.9 }),
  );
  ads.rotation.y = Math.PI / 2;
  ads.position.set(4.98, 1.25, 9.4);
  ads.renderOrder = 1;
  add(ctx, ads, { occlude: false });

  // 夜空：地平线的城市光 + 低云，远处的楼在雾里是比天暗的剪影
  add(ctx, skyDome({ clouds: 0.5 }));

  // 墙外远处两栋几乎全黑的居民楼（只建朝北的立面；少量亮窗）
  const near = building({ x0: -10, x1: 30, z0: 27, z1: 37, floors: 5, facade: 'brick', faces: ['n'], roof: 'parapet', seed: 11,
    windows: { w: 1.1, h: 1.3, spacing: 3.1, litRatio: 0.1, frame: 'steel' } });
  add(ctx, near.group, { occlude: false });
  const far = building({ x0: 8, x1: 44, z0: 50, z1: 60, floors: 13, facade: 'plaster', faces: ['n'], roof: 'flat', seed: 23,
    windows: { w: 1.2, h: 1.4, spacing: 3.3, litRatio: 0.04 } });
  add(ctx, far.group, { occlude: false });
  // 近楼山墙上刷的大红圈“拆”（高出院墙，从院里看得见）
  const bigMark = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 3.6),
    new THREE.MeshStandardMaterial({ map: ctx.track(PAINT.demolitionMark()), transparent: true, depthWrite: false, roughness: 0.9 }),
  );
  bigMark.rotation.y = Math.PI;
  bigMark.position.set(3.5, 8.8, 26.95);
  bigMark.renderOrder = 1;
  add(ctx, bigMark, { occlude: false });
}

/** 门口站着的摄像头人：主角同款模型（头改到 world 层，取景器里也看得见；贴条字迹仍只在镜中+取景器）。 */
function buildDummy(ctx: AreaContext): { model: PlayerModel; pc: PlayerController } {
  const model = createPlayerModel();
  setLayerRecursive(model.head.group, 'world');
  model.head.neck.layers.set(0);
  const ink = model.head.sticker.getObjectByName('stickerInk');
  if (ink) setLayerRecursive(ink, 'self_sticker_vf');
  // 朝东北（看向院门口的来人；近景机位从东北方拍他的 3/4 正面，门灯在他身后）
  const yaw = 24;
  const pc = { position: new THREE.Vector3(...LD_DUMMY), bodyYaw: yaw, yaw, pitch: 0, velocity: new THREE.Vector3() } as unknown as PlayerController;
  model.update(0, pc, 'mode.cutscene');
  add(ctx, model.root, { ref: 'lookdev.dummy' });
  ctx.collider.box([LD_DUMMY[0], 0.9, LD_DUMMY[2]], [0.5, 1.8, 0.4]);
  return { model, pc };
}

function buildYin(ctx: AreaContext): void {
  // 窗前的魂影（王奶奶），只在取景器里看得见
  const ghost = createCharacter('wang', { look: 'ghost', seed: 3 });
  ghost.root.position.set(...LD_GHOST);
  ghost.root.rotation.y = 0.35;
  add(ctx, ghost.root, { layer: 'yin' });
  // 残影点旋涡 + 从院门口走向门岗的一串湿脚印
  const vortex = createResidueVortex();
  vortex.position.set(LD_REPLAY_AT[0], 0.02, LD_REPLAY_AT[2]);
  add(ctx, vortex);
  add(ctx, createFootprints([[10.5, 4.5], [9.4, 7.5], [8.2, 10.0], [7.2, 11.2]], { seed: 5 }));
}

// ==================================================================== AreaPart

let rainRig: RainRig | null = null;
let dummy: { model: PlayerModel; pc: PlayerController } | null = null;

/** look-dev 机位（ARCH §12.5；GDD §9 的基准画面）。 */
export const LOOKDEV_SHOTS: NonNullable<AreaPart['shots']> = [
  {
    id: 'shot.dev.lookdev_tp', label: 'look-dev：第三人称，雨夜门岗、钠灯、湿地倒影、槐树一角、远处居民楼',
    view: { player: [9.0, 6.6], yaw: 189, pitch: 3.5, mode: 'tp' }, keys: ['lookdev.crt', 'lookdev.dummy'],
  },
  {
    id: 'shot.dev.lookdev_vf', label: 'look-dev：取景器 1×，门岗、摄像头人与窗前魂影（阴物）、彩灯',
    view: { player: [8.55, 6.4], yaw: 182, pitch: 7.5, mode: 'vf', zoom: 1 }, ui: true, keys: ['lookdev.dummy'],
  },
  {
    id: 'shot.dev.lookdev_ir', label: 'look-dev：红外，门岗前（CRT 42℃、摄像头人、钠灯 60℃、魂影 6℃）',
    view: { player: [8.55, 6.4], yaw: 182, pitch: 7.5, mode: 'vf', lens: 'ir', zoom: 1 }, ui: true,
    preset: { flags: { [F.R2_ABILITY_IR]: true } }, brightness: [0.05, 0.6],
  },
  {
    id: 'shot.dev.lookdev_close', label: 'look-dev：主角近景（镜头环、镀膜玻璃、铁皮帽、贴条），门灯逆光',
    view: { cam: { pos: [7.52, 1.84, 10.6], target: [LD_DUMMY[0] - 0.22, 2.05, LD_DUMMY[2] + 0.2], fov: 40 } },
  },
  {
    id: 'shot.dev.lookdev_replay', label: 'look-dev：回放（seg.gate_2026 第 9.5 秒，VHS 与回放人影）',
    view: { player: [8.4, 7.3], yaw: 178, pitch: 6, mode: 'vf', zoom: 1, replay: { point: RP.R1_GATE, seg: SEG.GATE_2026, t: 9.5 } }, ui: true,
    preset: { flags: { [F.R1_ABILITY_REPLAY]: true } },
    // M4 第 2 轮：高光验收改看 3×3 模糊后的第 99.5 百分位（shots.mjs），VHS 扫描线与颗粒不再让它上下跳，撤掉原来放宽的 highlight 0.7
  },
];

const part: AreaPart = {
  shots: LOOKDEV_SHOTS,
  replayPoints: [{ id: RP.R1_GATE, at: LD_REPLAY_AT, segments: [SEG.GATE_2026] }],
  segments: [
    {
      id: SEG.GATE_2026, point: RP.R1_GATE, order: 1, osd: '2026-08-27 23:00', dur: 20, loop: true,
      actors: [
        // 王奶奶从院门口走到窗前停下；陆师傅先站在门口，再出院门
        { id: GHOST.WANG_2026, rig: 'mannequin', character: 'wang', keys: [
          { t: 0, pos: [10.8, 0, 5.0], yaw: 200, pose: 'walk' },
          { t: 9, pos: [9.9, 0, 10.2], yaw: 190, pose: 'walk' },
          { t: 12, pos: [9.85, 0, 10.4], yaw: 175, pose: 'stand' },
        ] },
        { id: GHOST.LU_2026, rig: 'mannequin', character: 'lu', keys: [
          { t: 0, pos: [7.2, 0, 10.9], yaw: 20, pose: 'stand' },
          { t: 12, pos: [7.2, 0, 10.9], yaw: 20, pose: 'stand' },
          { t: 20, pos: [10.8, 0, 5.2], yaw: 20, pose: 'walk' },
        ] },
      ],
      subs: [],
    },
  ],
  build(ctx) {
    buildGround(ctx);
    buildCourtyardWalls(ctx);
    buildBooth(ctx);
    buildStreet(ctx);
    buildYin(ctx);
    dummy = buildDummy(ctx);
    rainRig = rain({ count: QUALITY[ctx.quality].rain, box: { w: 36, h: 16, d: 36 } });
    add(ctx, rainRig.mesh);
  },
  update(_ctx, dt) {
    rainRig?.update(dt);
    if (dummy) dummy.model.update(dt, dummy.pc, 'mode.cutscene');
  },
  onExit() {
    rainRig = null;
    dummy = null;
  },
};

// ==================================================================== look-dev 调参钩子（只在 ?debug=1 下经 __game.selftest 调用）

/**
 * 'lookdev.tweak'：在当前画面上临时改灯光/环境/雾/后期，再渲几帧（参数来自 globalThis.__lookdevTweak）。
 * 给 look-dev 批量对比参数用：先 __game.shot('dev', id) 摆好机位，再设 __lookdevTweak 并调本自测，然后截图。
 * 灯按类型或名字乘系数（相对进区域时的强度）；post 覆盖 'dev' 预设的字段（与 AreaDef.post 的 overrides 同义）。
 */
export interface LookdevTweak {
  env?: number; fog?: number; hemi?: number; point?: number;
  byName?: Record<string, number>;
  post?: Partial<FxParams>;
  frames?: number;
}

registerSelftest('lookdev.tweak', async game => {
  const o = (globalThis as { __lookdevTweak?: LookdevTweak }).__lookdevTweak ?? {};
  const scene = game.scene;
  const notes: string[] = [];
  if (o.env !== undefined) scene.environmentIntensity = o.env;
  scene.traverse(obj => {
    const l = obj as THREE.Light;
    if (!l.isLight) return;
    const base = (l.userData.lookdevBase as number | undefined) ?? l.intensity;
    l.userData.lookdevBase = base;
    let k = 1;
    if ((l as THREE.HemisphereLight).isHemisphereLight && o.hemi !== undefined) k = o.hemi;
    if ((l as THREE.PointLight).isPointLight && o.point !== undefined) k = o.point;
    const byName = o.byName?.[l.name];
    if (byName !== undefined) k *= byName;
    l.intensity = base * k;
    notes.push(`${l.name || l.type}: ${l.intensity.toFixed(3)}`);
  });
  if (o.fog !== undefined && scene.fog && 'density' in scene.fog) scene.fog.density = o.fog;
  if (o.post) game.pipeline.post.setBase('dev', o.post);
  for (let i = 0; i < (o.frames ?? 4); i++) await game.nextFrame();
  return { ok: true, notes };
});

export default part;
