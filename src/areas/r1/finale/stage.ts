// owner: R1-finale
// 终章在 R1 场景里的运行期状态与小道具：遗像（桌上）、红外铅笔底稿、馄饨碗、粉笔叉、门楣支架上的安装点、门岗残影点的旋涡、
// “化成一点光”的光点、老周的姿势/造型控制、结局过场里对雾与半球光的接管（天亮、清晨、远景布景）。
// 一切外观都由 flags（与本区临时状态）在每帧 sync() 里推导（ARCH §11.5 第 1 条）；过场只临时接管（override），结束即交还。

import * as THREE from 'three';
import type { AreaContext } from '../../../core/area';
import type { Pose, V3 } from '../../../core/types';
import type { NpcHandle } from '../../../game/npc';
import type { StateView } from '../../../game/state';
import type { CharacterRig } from '../../../rigs/characters';
import { F, IT, OBJ } from '../../../data/ids';
import { PALETTE } from '../../../data/palette';
import { MATERIALS } from '../../../fx/materials';
import { createResidueVortex } from '../../../kit/residue';
import { pitchTowards, yawToRotY, yawTowards } from '../../../core/math';
import { R1, R1_ENV_REFS } from '../layout';
import { chalkTexture, glowTexture, portraitTexture, sketchTexture, wontonTexture } from './art';

// ==================================================================== 坐标（layout.ts 之外、只属于终章的）

/** 遗像：立在桌上 CRT 与录像机之间，朝北（对着椅子） */
export const PORTRAIT_AT: V3 = [-6.45, R1.derived.deskTopY, 21.63];
export const PORTRAIT_SIZE = { w: 0.2, h: 0.275 } as const;
/**
 * r1.desk 的拾取代理与锚点：遗像那一小块桌面（避开 R1-world 的巡夜本、抽屉；老周趴桌时也不被他挡住）。
 * 代理往上加高到 1.3m：第三人称的俯仰下限是 -35°（ARCH §4.7），站在椅子边看桌面时准星射线从桌面上方 0.3m 左右掠过，
 * 桌上的东西要能被这条射线扫到（录像机、插孔的代理同理）。
 */
export const DESK_PROXY = { center: [-6.45, 1.03, 21.62] as V3, size: [0.24, 0.54, 0.26] as V3 };
export const DESK_AIM: V3 = [-6.45, 0.95, 21.62];
/** 桌上东西的代理加高到这里（见 DESK_PROXY） */
export const TABLETOP_REACH = 1.3;
/** 馄饨碗：放在老周面前，夹在两支蜡烛中间（桌面前沿那一溜空地，M4 蜡烛挪开以后往东让 5cm） */
export const BOWL_AT: V3 = [-6.45, R1.derived.deskTopY, 21.29];
/** 视频入1 插孔的交互锚点（layout 的 crtJack） */
export const JACK_AT: V3 = R1.derived.crtJack as V3;
/** 录像机面板中心（交互锚点） */
export const VCR_AT: V3 = [R1.derived.vcrBody.center[0], R1.derived.vcrBody.center[1], R1.derived.vcrBody.center[2] - R1.derived.vcrBody.size[2] / 2];
/** 蚁穴 */
export const ANTHILL_AT: V3 = [R1.anthill[0], 0.12, R1.anthill[2]];
/** 陆师傅在门岗西北角，朝桌子 */
export const LU_AT: V3 = R1.npcSpots.luBooth as V3;
export const LU_YAW = yawTowards(R1.npcSpots.luBooth, R1.desk);
/** 老周：椅子（朝桌子，南）；门口（朝 CH1 镜头） */
export const ZHOU_CHAIR: V3 = R1.npcSpots.zhouChair as V3;
export const ZHOU_DOOR: V3 = R1.npcSpots.zhouDoor as V3;
export const ZHOU_DOOR_YAW = yawTowards(R1.npcSpots.zhouDoor, R1.derived.ch1Cam.pos);
/**
 * 终章用的 CH1 机位（三脚架、合影后的过场、天亮、叫醒）= layout 的 ch1Cam（M3 按终章截图定稿写回 layout，docs/requests/r1-finale.md #6）：
 * 门楣支架上，镜头朝院门方向（偏东南）俯 24°、广角 66°；老周站的门口 (-3.4,21.4) 连脚在画里、粉笔叉在他左手边，
 * 画面上缘是院门、街对面亮着灯的楼与一线天（天亮时看得见东边发白）。
 */
export const CH1_POSE = R1.derived.ch1Cam;
export const CH2_POSE = R1.derived.ch2Cam;

// ==================================================================== 光点

interface Mote { from: () => V3; path: (t01: number, from: V3) => V3; dur: number; t: number; delay: number; color: THREE.Color; size: number; from0: V3 | null }

/** 一组加法混合的光点（Points，一次绘制；红外下隐藏）。“化成一点光”、魂回到老周身上、街坊们的光都用它。 */
export class Motes {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly live: (Mote | null)[];
  private readonly tmp = new THREE.Color();

  constructor(ctx: AreaContext, readonly capacity = 48, size = 0.22) {
    this.pos = new Float32Array(capacity * 3).fill(0);
    this.col = new Float32Array(capacity * 3).fill(0);
    for (let i = 0; i < capacity; i++) this.pos[i * 3 + 1] = -500;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({
      size, map: ctx.track(glowTexture()), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
    });
    mat.userData.tempC = 6;
    this.points = new THREE.Points(geo, mat);
    this.points.name = 'fin.motes';
    this.points.frustumCulled = false;
    this.points.renderOrder = 16;
    this.points.userData.noOcclude = true;
    this.points.userData.irHide = true;
    this.points.userData.auxHide = true;
    this.points.raycast = () => {};
    this.live = new Array<Mote | null>(capacity).fill(null);
  }

  /** 发一粒：from 现取起点，path(t01, from) 给位置；delay 秒后出现，dur 秒走完；颜色是 HDR 倍数。 */
  spawn(from: () => V3, path: (t01: number, from: V3) => V3, o: { dur: number; delay?: number; color?: THREE.ColorRepresentation; hdr?: number; size?: number }): void {
    const i = this.live.findIndex(m => m === null);
    if (i < 0) return;
    const color = new THREE.Color(o.color ?? PALETTE.GHOST).multiplyScalar(o.hdr ?? 3);
    this.live[i] = { from, path, dur: Math.max(0.01, o.dur), t: 0, delay: o.delay ?? 0, color, size: o.size ?? 1, from0: null };
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.kill(i);
    this.flush();
  }

  get active(): number {
    return this.live.filter(m => m !== null).length;
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      const m = this.live[i];
      if (!m) continue;
      if (m.delay > 0) {
        m.delay -= dt;
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      m.from0 ??= m.from();
      m.t += dt;
      const u = Math.min(1, m.t / m.dur);
      const p = m.path(u, m.from0);
      this.pos[i * 3] = p[0];
      this.pos[i * 3 + 1] = p[1];
      this.pos[i * 3 + 2] = p[2];
      // 淡入 15%、淡出最后 25%，中间轻轻闪
      const a = Math.min(1, u / 0.15) * Math.min(1, (1 - u) / 0.25) * (0.85 + 0.15 * Math.sin(m.t * 9 + i));
      this.tmp.copy(m.color).multiplyScalar(a);
      this.col[i * 3] = this.tmp.r;
      this.col[i * 3 + 1] = this.tmp.g;
      this.col[i * 3 + 2] = this.tmp.b;
      if (u >= 1) this.kill(i);
    }
    this.flush();
  }

  private kill(i: number): void {
    this.live[i] = null;
    this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
    this.pos[i * 3 + 1] = -500;
  }

  private flush(): void {
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** 贝塞尔路径（起点 → 控制点 → 终点），外加一圈小小的螺旋。 */
export function arcPath(ctrl: V3, to: V3, swirl = 0.08): (u: number, from: V3) => V3 {
  return (u, from) => {
    const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
    const s = Math.sin(u * Math.PI) * swirl;
    return [
      a * from[0] + b * ctrl[0] + c * to[0] + Math.cos(u * 14) * s,
      a * from[1] + b * ctrl[1] + c * to[1] + Math.sin(u * 11) * s * 0.6,
      a * from[2] + b * ctrl[2] + c * to[2] + Math.sin(u * 14) * s,
    ];
  };
}

// ==================================================================== 雾与半球光的临时接管（结局过场）

export type EnvMode = 'off' | 'night' | 'dawn' | 'morning' | 'far';
interface EnvLook {
  fog: THREE.Color; density: number; sky: THREE.Color; ground: THREE.Color; hemi: number;
  /** 夜空天穹（R1-world 的 skyDome）的三色与场景背景色 */
  zenith: THREE.Color; horizon: THREE.Color; glow: THREE.Color;
}

const C = (hex: string): THREE.Color => new THREE.Color(hex);
/** 天穹三色：夜里与 R1-world 的夜空同色（低云被钠灯从下面照亮），卯时是东边发白的黎明（GDD §2.5 第 6 条、§9.1 DAWN/MORNING） */
const SKY_NIGHT = { zenith: C('#0B1020'), horizon: C('#1F2638'), glow: C('#4A3222') };
const SKY_MAO = { zenith: C('#5E7488'), horizon: C('#E8B8A0'), glow: C('#F2C8A0') };
const LOOKS: Record<'night' | 'mao' | 'morning' | 'far', EnvLook> = {
  // GDD §4.1：寅时雨停，雾 0.03；卯时雾 #CDB6A6、0.018，半球光 #F2B8A0/#3A4150（设计强度 0.25 × π）
  night: { fog: C(PALETTE.FOG_R1), density: 0.03, sky: C('#1B2233'), ground: C(PALETTE.NIGHT), hemi: 0.25 * Math.PI, ...SKY_NIGHT },
  // M4：半球光 0.25π 在湿地面上压不住夜色（“天亮了。”那一刻前景还是一片黑），提到 0.7π、地面色 #5A5660，才读得出黎明粉
  mao: { fog: C('#CDB6A6'), density: 0.018, sky: C(PALETTE.DAWN), ground: C('#5A5660'), hemi: 0.7 * Math.PI, ...SKY_MAO },
  // 尾声：拆迁那天上午，扬尘的晨雾（近处的人和挖掘机是雾里的剪影）
  morning: { fog: C('#D6CABB'), density: 0.036, sky: C('#F4E6D4'), ground: C('#6A6660'), hemi: 0.35 * Math.PI, zenith: C('#9DB8C8'), horizon: C('#E8D6C4'), glow: C('#F4E0C8') },
  // 远景布景（片尾照片、南柯）：材质不吃灯、不吃雾，这里只把雾压到很淡
  far: { fog: C('#D9D2C8'), density: 0.004, sky: C('#F4E6D4'), ground: C('#6A6660'), hemi: 0.3 * Math.PI, zenith: C('#9DB8C8'), horizon: C('#E8D6C4'), glow: C('#F4E0C8') },
};

/**
 * 与 R1-world 约定的区域临时状态键（两边不互相 import，字面量两边各写一份：R1-world 的 logic.ts FIN_SKY 同名同值）。
 * 远景剪影、远处亮窗、近处楼的亮窗、院外路灯、积水都是 R1-world 的材质，天色过渡要它们一起走，由 R1-world 自己按这两个键摆：
 * - fin_dawn：终章接管的天亮进度 0..1（量化到 0.05，免得每帧发 'temp' 事件）；设了它 R1-world 就按它、不按进区域时的卯时摆；
 * - fin_morning：尾声/片尾的上午（远景剪影变晨雾色、亮窗与路灯全灭、积水映着天）。
 */
export const FIN_SKY = { dawn: 'fin_dawn', morning: 'fin_morning' } as const;

/** 结局期间接管场景雾与 R1 的半球光（R1-world 的灯，只改颜色与强度，灯数不变）；mode 'off' 时一概不碰。 */
export class EnvGrade {
  mode: EnvMode = 'off';
  /** dawn：0 = 寅时的夜，1 = 卯时 */
  t01 = 0;
  private hemi: THREE.HemisphereLight | null | undefined;
  private hidden: THREE.Object3D[] = [];

  constructor(private readonly ctx: AreaContext) {}

  apply(): void {
    if (this.mode === 'off') return;
    // R1-world 的远景、亮窗、路灯与积水跟着走（见 FIN_SKY）
    if (this.mode === 'night' || this.mode === 'dawn') {
      this.ctx.setTemp(FIN_SKY.morning, false);
      this.ctx.setTemp(FIN_SKY.dawn, this.mode === 'night' ? 0 : Math.round(Math.min(1, Math.max(0, this.t01)) * 20) / 20);
    } else {
      this.ctx.setTemp(FIN_SKY.morning, true);
    }
    const look = this.mode === 'night' ? LOOKS.night : this.mode === 'morning' ? LOOKS.morning : this.mode === 'far' ? LOOKS.far : null;
    const fog = this.ctx.scene.fog as THREE.FogExp2 | null;
    const h = this.hemiLight();
    const sky = this.skyUniforms();
    const bg = this.ctx.scene.background as THREE.Color | null;
    const mix = (pick: (e: EnvLook) => THREE.Color, l: EnvLook | null, a: EnvLook, b: EnvLook, t: number, out: THREE.Color) => {
      if (l) out.copy(pick(l));
      else out.copy(pick(a)).lerp(pick(b), t);
    };
    const set = (l: EnvLook | null, a: EnvLook, b: EnvLook, t: number) => {
      if (fog && (fog as THREE.FogExp2).isFogExp2) {
        mix(e => e.fog, l, a, b, t, fog.color);
        fog.density = l ? l.density : a.density + (b.density - a.density) * t;
      }
      if (h) {
        mix(e => e.sky, l, a, b, t, h.color);
        mix(e => e.ground, l, a, b, t, h.groundColor);
        h.intensity = l ? l.hemi : a.hemi + (b.hemi - a.hemi) * t;
      }
      // 天穹与背景：R1-world 在 r1.soul_returned 后自己跑一段 12 秒的天亮；结局里天亮的节奏归 cs.r1.dawn，这里每帧盖过去
      if (sky) {
        mix(e => e.zenith, l, a, b, t, sky.uZenith);
        mix(e => e.horizon, l, a, b, t, sky.uHorizon);
        mix(e => e.glow, l, a, b, t, sky.uGlow);
      }
      if (bg && bg.isColor) mix(e => e.zenith, l, a, b, t, bg);
    };
    set(look, LOOKS.night, LOOKS.mao, this.t01);
  }

  /**
   * 结局期间藏起 R1-world 跟着相机走的雨（GDD §4.1：寅时雨停；天亮以后更不该下）与（远景布景期间）夜空天穹。
   * 只在结局过场里调用；片尾之后引擎回标题、卸载区域，不必还原。对象取 R1-world 登记的 ref（layout.ts 的 R1_ENV_REFS，ARCH §11.6）。
   */
  hideFollowers(on: boolean, sky = true): void {
    if (on) {
      const ids = sky ? [R1_ENV_REFS.rain, R1_ENV_REFS.sky] : [R1_ENV_REFS.rain];
      for (const id of ids) {
        const o = this.ctx.getRef(id);
        if (o && o.visible) this.hidden.push(o);
      }
      for (const o of this.hidden) o.visible = false;
    } else {
      for (const o of this.hidden) o.visible = true;
      this.hidden = [];
    }
  }

  private sky: { uZenith: THREE.Color; uHorizon: THREE.Color; uGlow: THREE.Color } | null | undefined;
  /** R1-world 的夜空天穹（ref R1_ENV_REFS.sky：kit/nature 的 skyDome）的颜色 uniform；没登记就不管天穹。 */
  private skyUniforms(): { uZenith: THREE.Color; uHorizon: THREE.Color; uGlow: THREE.Color } | null {
    if (this.sky !== undefined) return this.sky;
    const o = this.ctx.getRef(R1_ENV_REFS.sky);
    const u = ((o as THREE.Mesh | undefined)?.material as THREE.ShaderMaterial | undefined)?.uniforms;
    const z = u?.uZenith?.value, hz = u?.uHorizon?.value, gl = u?.uGlow?.value;
    this.sky = z instanceof THREE.Color && hz instanceof THREE.Color && gl instanceof THREE.Color ? { uZenith: z, uHorizon: hz, uGlow: gl } : null;
    return this.sky;
  }

  /** R1-world 的半球光（ref R1_ENV_REFS.hemi）。 */
  private hemiLight(): THREE.HemisphereLight | null {
    if (this.hemi !== undefined) return this.hemi;
    const o = this.ctx.getRef(R1_ENV_REFS.hemi) as THREE.HemisphereLight | undefined;
    this.hemi = o && o.isHemisphereLight ? o : null;
    return this.hemi;
  }
}

// ==================================================================== 运行期状态

export interface ZhouLook { pose: Pose; variant: 'cap' | 'nocap' | 'slump' }

export interface FinaleRt {
  readonly ctx: AreaContext;
  zhou: CharacterRig | null;
  zhouNpc: NpcHandle | null;
  lu: CharacterRig | null;
  luNpc: NpcHandle | null;
  /** 过场接管老周的姿势与造型（null = 按 flags） */
  zhouOverride: Partial<ZhouLook> | null;
  zhouApplied: { pose: Pose | null; variant: string | null };
  /** 陆师傅化光：0..LU_LEAVE_SEC；null = 没在化 */
  luLeave: number | null;
  readonly portrait: { root: THREE.Group; paper: THREE.Mesh; mat: THREE.MeshStandardMaterial; blank: THREE.Texture; done: THREE.Texture | null; sketch: THREE.Mesh; shown: 'none' | 'blank' | 'done' };
  readonly candles: Candles;
  readonly bowl: THREE.Object3D;
  /** 过场里“吃完了”（null = 按 r1.zhou_fed） */
  bowlEaten: boolean | null;
  readonly chalk: THREE.Mesh;
  /** 蚁穴洞口的一点暖光：收下的旧照越多越亮（南柯的伏笔：“蚂蚁替你收着”） */
  readonly antGlow: THREE.Group;
  /** 过场里画粉笔叉的进度（null = 按 flags） */
  chalkReveal: number | null;
  readonly mount: THREE.Object3D;
  readonly motes: Motes;
  /** 结局里“街坊们的光”的队伍（比 motes 大一号的光点，M4） */
  readonly procession: Motes;
  /** 老周显形过场里的淡入进度（null = 不接管） */
  zhouReveal: number | null;
  /** 面板视点（监控台/录像机面板，就在椅子上方）上把老周藏起来的进度 0..1（M4：免得近裁面切开一大块青影） */
  zhouPanelFade: number;
  /** 老周魂影头上的一张笑脸（结局里“他冲着你笑”那一拍才显示，M4） */
  zhouSmile: THREE.Mesh | null;
  readonly env: EnvGrade;
  /** 预制照妖镜贴图（settings.tunnelMode='baked'）与它画的是哪一版 */
  baked: { tex: THREE.CanvasTexture; zhou: boolean } | null;
  tripodPrev: string;
  antT: number;
  antMoteT: number;
  howlT: number;
  /** 结局布景（run 步骤里按需建） */
  sets: Record<string, unknown>;
  /** 每帧额外的动画（结局布景用；返回 false 即移除） */
  anims: ((dt: number) => boolean)[];
  /** 结局里老周冲你摆手：>0 时在 sync() 里逐帧摆右臂 */
  waving: number;
  /**
   * M4 第 2 轮：结局推近那一拍老周“实”起来（1 = 魂影 uSolid 0.8、不透明，身后的院门铁栏不再透过他的脸），0 = 原样；
   * zhouSolidK 是 sync() 里 1 秒缓动的当前值
   */
  zhouSolid: number;
  zhouSolidK: number;
  /** M4 第 2 轮：吃完馄饨以后老周坐在椅子上侧过身来、抬头看着你（1 = 转过来），zhouTurnK 是缓动的当前值 */
  zhouTurn: number;
  zhouTurnK: number;
  /** 侧过身看的点（null = 玩家的位置；截图机位里玩家藏在别处，用它） */
  zhouTurnAt: V3 | null;
  /** 笑脸贴片显示中、人偶自己的五官已收起 */
  smileMasked: boolean;
  /** M4 第 2 轮：合影成功那一刻按 CH1 位姿留下的一张大“照片”（片尾合影卡铺满画面区用；没拍到为 null） */
  finalPrint: HTMLCanvasElement | null;
  /** 渲染器（光点的 onBeforeRender 顺手记下；合影那一刻从它的画布裁大照片用） */
  renderer: THREE.WebGLRenderer | null;
  /** 粉笔叉呼吸的计时 */
  chalkT: number;
  /** 交互锚点（按 R1-world 的实际网格算出来的，build 时填） */
  anchors: { vcr: V3; jack: V3; bracket: V3; anthill: V3 };
}

let current: FinaleRt | null = null;
/** 当前 R1 的终章运行期状态（R1 没加载时为 null）。 */
export function rt(): FinaleRt | null {
  return current;
}
export function clearRt(): void {
  current = null;
}

export const LU_LEAVE_SEC = 3;

// ==================================================================== 建造

/** 门楣空支架上的“头”的安装点：取 R1-world 支架里名为 'mount' 的节点（PROPS.bracket），没有就用支架包围盒顶面中心；朝向 CH1 机位。 */
function buildMount(ctx: AreaContext): THREE.Object3D {
  const mount = new THREE.Object3D();
  mount.name = 'fin.mount';
  const bracket = ctx.getRef(OBJ.R1_BRACKET);
  const p = new THREE.Vector3(...(R1.bracket as V3));
  if (bracket) {
    bracket.updateWorldMatrix(true, true);
    const m = bracket.getObjectByName('mount');
    if (m) m.getWorldPosition(p);
    else {
      const b = new THREE.Box3().setFromObject(bracket);
      if (!b.isEmpty()) p.set((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2);
    }
  }
  mount.position.copy(p);
  // 头的正面是本地 -z：转到 CH1 的朝向，略微低头（俯拍门口）
  const c = CH1_POSE;
  mount.rotation.order = 'YXZ';
  mount.rotation.y = yawToRotY(yawTowards(c.pos, c.target));
  mount.rotation.x = pitchTowards(c.pos, c.target) * (Math.PI / 180);
  ctx.add(mount);
  return mount;
}

function buildPortrait(ctx: AreaContext): FinaleRt['portrait'] {
  const root = new THREE.Group();
  root.name = 'fin.portrait';
  const { w, h } = PORTRAIT_SIZE;
  const blank = ctx.track(portraitTexture('blank'));
  const mat = ctx.track(new THREE.MeshStandardMaterial({ map: blank, roughness: 0.75, metalness: 0 }));
  mat.userData.tempC = 18;
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  paper.name = 'fin.portrait.paper';
  paper.position.set(0, h / 2, 0.012);
  root.add(paper);
  // 相框背板与支脚
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), MATERIALS.wood());
  back.position.set(0, h / 2, 0);
  root.add(back);
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, h * 0.8, 0.012), MATERIALS.wood());
  leg.position.set(0, h * 0.38, -0.07);
  leg.rotation.x = -0.45;
  root.add(leg);
  // 红外里透出来的铅笔底稿（layer.ir_only，透明贴花，比纸面热一点才看得出线）
  const sketchMat = ctx.track(new THREE.MeshBasicMaterial({ map: ctx.track(sketchTexture()), transparent: true, depthWrite: false }));
  sketchMat.userData.tempC = 30;
  const sketch = new THREE.Mesh(new THREE.PlaneGeometry(w, h), sketchMat);
  sketch.name = 'fin.portrait.sketch';
  sketch.position.set(0, h / 2, 0.014);
  root.add(sketch);
  // 朝北（对着椅子），往后仰一点
  root.position.set(...PORTRAIT_AT);
  root.rotation.order = 'YXZ';
  root.rotation.y = Math.PI;
  root.rotation.x = -0.12;
  ctx.add(root);
  ctx.add(sketch, { layer: 'ir_only', parent: root, occlude: false });
  root.visible = false;
  return { root, paper, mat, blank, done: null, sketch, shown: 'none' };
}

/**
 * 遗像前的一对白蜡烛（摆上遗像以后才有；火苗只用自发光 + 加法光晕，不加灯，R1 的 8 盏灯已满）。
 * M4：各让出相框左右边缘（x -6.55～-6.35）5–10cm、再往前放（桌上 CRT 与录像机没空位；左边那支贴着 CRT 前脸的东角），
 * 从桌前看不再挡住遗像的下半与相框；老周趴桌时头也不落在烛光里（左边那支再往西让一点，从门口看过去在他脑袋的左边）。
 */
export const CANDLES_AT: readonly V3[] = [[-6.645, R1.derived.deskTopY, 21.34], [-6.30, R1.derived.deskTopY, 21.33]];
interface Candles { groups: THREE.Group[]; flames: THREE.Mesh[]; haloMat: THREE.MeshBasicMaterial }
const _haloP = new THREE.Vector3(), _camP = new THREE.Vector3();
function buildCandles(ctx: AreaContext): Candles {
  const waxMat = ctx.track(new THREE.MeshStandardMaterial({ color: '#efe9dc', roughness: 0.6, emissive: '#ffcf8a', emissiveIntensity: 0.08 }));
  waxMat.userData.tempC = 30;
  // 火苗芯仍会剪白（×4），光晕压到 ×1.3：从桌前看是两粒小火苗，不再是两团盖住遗像的光（M4）
  const flameMat = ctx.track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFD28A').multiplyScalar(4), fog: false }));
  flameMat.userData.tempC = 60;
  const haloMat = ctx.track(new THREE.MeshBasicMaterial({
    map: ctx.track(glowTexture()), color: new THREE.Color('#FFB866').multiplyScalar(1.3), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  }));
  const out: Candles = { groups: [], flames: [], haloMat };
  CANDLES_AT.forEach((at, i) => {
    const g = new THREE.Group();
    g.name = `fin.candle${i}`;
    const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.012, 14), MATERIALS.porcelain());
    holder.position.y = 0.006;
    g.add(holder);
    const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.09, 10), waxMat);
    wax.position.y = 0.057;
    g.add(wax);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6).scale(1, 2.2, 1), flameMat);
    flame.position.y = 0.117;
    g.add(flame);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), haloMat);
    halo.position.y = 0.115;
    halo.userData.irHide = true;
    halo.userData.noOcclude = true;
    halo.raycast = () => {};
    // 光晕朝着正在渲染的相机（蜡烛组没有旋转，本地朝向 = 世界朝向；r186 在 onBeforeRender 之后才算 modelView，这里自己更新矩阵）
    // 近看不糊成一大团：光晕随相机距离缩放（0.8m 内约 0.05m，1.8m 外约 0.11m）
    halo.onBeforeRender = (_r, _s, cam) => {
      halo.quaternion.copy(cam.quaternion);
      halo.getWorldPosition(_haloP);
      const d = _haloP.distanceTo(cam.getWorldPosition(_camP));
      halo.scale.setScalar((0.05 + 0.06 * Math.min(1, Math.max(0, (d - 0.8) / 1.0))) / 0.24);
      halo.updateMatrixWorld();
    };
    g.add(halo);
    g.position.set(...at);
    ctx.add(g, { occlude: false });
    g.visible = false;
    out.groups.push(g);
    out.flames.push(flame);
  });
  return out;
}

function buildBowl(ctx: AreaContext): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'fin.bowl';
  const pts = [new THREE.Vector2(0.0, 0), new THREE.Vector2(0.04, 0), new THREE.Vector2(0.045, 0.01), new THREE.Vector2(0.075, 0.05), new THREE.Vector2(0.085, 0.065), new THREE.Vector2(0.082, 0.068)];
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), MATERIALS.porcelain());
  g.add(bowl);
  const soupMat = ctx.track(new THREE.MeshStandardMaterial({ map: ctx.track(wontonTexture()), roughness: 0.25, metalness: 0 }));
  soupMat.userData.tempC = 50;
  const soup = new THREE.Mesh(new THREE.CircleGeometry(0.074, 20).rotateX(-Math.PI / 2), soupMat);
  soup.position.y = 0.052;
  soup.name = 'fin.bowl.soup';
  g.add(soup);
  const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.12), MATERIALS.porcelain());
  spoon.position.set(0.06, 0.07, 0.02);
  spoon.rotation.set(0.35, 0.5, 0);
  g.add(spoon);
  g.position.set(...BOWL_AT);
  ctx.add(g);
  g.visible = false;
  return g;
}

/** 粉笔叉的自发光（M4：CH1 俯拍下细淡的粉线一挡就看不见；白粉笔在湿地上本来就比地面亮一截） */
const CHALK_GLOW = 0.35;
function buildChalk(ctx: AreaContext): THREE.Mesh {
  const tex = ctx.track(chalkTexture());
  const mat = ctx.track(new THREE.MeshStandardMaterial({
    map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: CHALK_GLOW,
    transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  mat.userData.tempC = 17;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72).rotateX(-Math.PI / 2), mat);
  m.name = 'fin.chalk';
  m.position.set(R1.markPhoto[0], 0.012, R1.markPhoto[2]);
  m.rotation.y = 0.35;
  m.renderOrder = 2;
  ctx.add(m, { ref: OBJ.R1_MARK_PHOTO, occlude: false });
  m.visible = false;
  return m;
}

/** 蚁穴洞口漏出来的一点暖光：洞口一团竖着的柔光（朝着镜头）+ 土堆上一片很淡的光斑（加法混合，不吃灯、红外下隐藏、不挡射线）。 */
function buildAntGlow(ctx: AreaContext): THREE.Group {
  const g = new THREE.Group();
  g.name = 'fin.antGlow';
  const tex = ctx.track(glowTexture());
  const mk = (color: string, hdr: number): THREE.MeshBasicMaterial => ctx.track(new THREE.MeshBasicMaterial({
    map: tex, color: new THREE.Color(color).multiplyScalar(hdr), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  const spill = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2), mk('#FF9C4A', 0.55));
  spill.position.y = 0.095;
  spill.renderOrder = 6;
  g.add(spill);
  const core = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), mk('#FFC27A', 2.2));
  core.position.y = 0.11;
  core.renderOrder = 6;
  core.onBeforeRender = (_r, _s, cam) => {
    core.quaternion.copy(cam.quaternion);
    core.updateMatrixWorld();
  };
  g.add(core);
  for (const m of [spill, core]) {
    m.userData.irHide = true;
    m.userData.noOcclude = true;
    m.raycast = () => {};
  }
  g.position.set(ANTHILL_AT[0], 0, ANTHILL_AT[2]);
  ctx.add(g, { occlude: false });
  g.visible = false;
  return g;
}

/** 不绘制、能被射线命中的拾取代理盒（MATERIALS.hitProxy）。 */
export function hitBox(ctx: AreaContext, name: string, center: V3, size: V3): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), MATERIALS.hitProxy());
  m.name = name;
  m.position.set(...center);
  ctx.add(m, { occlude: false });
  return m;
}

/** ref 的世界包围盒（没有 ref 或为空时用 fallback）。 */
export function refBox(ctx: AreaContext, id: string, fallback: { center: V3; size: V3 }): THREE.Box3 {
  const obj = ctx.getRef(id);
  const box = new THREE.Box3();
  if (obj) {
    obj.updateWorldMatrix(true, true);
    box.setFromObject(obj);
  }
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(...fallback.center), new THREE.Vector3(...fallback.size));
  return box;
}

/** 按包围盒建拾取代理。 */
export function boxProxy(ctx: AreaContext, name: string, box: THREE.Box3): THREE.Mesh {
  const c = box.getCenter(new THREE.Vector3());
  const sz = box.getSize(new THREE.Vector3());
  return hitBox(ctx, name, [c.x, c.y, c.z], [sz.x, sz.y, sz.z]);
}

/** r1.desk 的拾取代理：遗像那一小块桌面。 */
export function buildDeskProxy(ctx: AreaContext): THREE.Mesh {
  return hitBox(ctx, 'fin.deskProxy', DESK_PROXY.center, DESK_PROXY.size);
}

/**
 * 按 R1-world 登记的 ref 的实际包围盒做拾取代理（外扩 pad）：锚点与准星都落在对方真实的网格上，
 * 不依赖 layout 推定值与对方模型的细节（M2 期间两边同时在改）。没有 ref 时用 fallback。
 */
export function proxyForRef(ctx: AreaContext, id: string, pad: number, fallback: { center: V3; size: V3 }): { mesh: THREE.Mesh; center: V3; box: THREE.Box3 } {
  const box = refBox(ctx, id, fallback);
  box.expandByScalar(pad);
  const c = box.getCenter(new THREE.Vector3());
  const sz = box.getSize(new THREE.Vector3());
  const center: V3 = [c.x, c.y, c.z];
  const mesh = hitBox(ctx, `fin.hit.${id.replace('.', '_')}`, center, [sz.x, sz.y, sz.z]);
  return { mesh, center, box };
}

export function createRt(ctx: AreaContext): FinaleRt {
  const motes = new Motes(ctx);
  ctx.add(motes.points, { occlude: false });
  const procession = new Motes(ctx, 48, 0.36);
  procession.points.name = 'fin.procession';
  ctx.add(procession.points, { occlude: false });
  // 门岗残影点 rp.r1_booth 的雪花旋涡（layer.yin，只在取景器里看得见；锁定时同样在，按 R 显示“雪花太密了”）
  const vortex = createResidueVortex();
  vortex.position.set(R1.replay.booth[0], 0.02, R1.replay.booth[2]);
  ctx.add(vortex);
  current = {
    ctx, zhou: null, zhouNpc: null, lu: null, luNpc: null, zhouOverride: null, zhouApplied: { pose: null, variant: null },
    luLeave: null, portrait: buildPortrait(ctx), candles: buildCandles(ctx), bowl: buildBowl(ctx), bowlEaten: null, chalk: buildChalk(ctx), antGlow: buildAntGlow(ctx), chalkReveal: null,
    mount: buildMount(ctx), motes, env: new EnvGrade(ctx), baked: null, tripodPrev: 'off', antT: 0, antMoteT: 0, howlT: 0, sets: {}, anims: [],
    anchors: { vcr: VCR_AT, jack: JACK_AT, bracket: R1.bracket as V3, anthill: ANTHILL_AT }, waving: 0,
    procession, zhouReveal: null, zhouPanelFade: 0, zhouSmile: null, chalkT: 0,
    zhouSolid: 0, zhouSolidK: 0, zhouTurn: 0, zhouTurnK: 0, zhouTurnAt: null, smileMasked: false, finalPrint: null, renderer: null,
  };
  // 区域 API 不给渲染器：光点每帧都画（frustumCulled = false），在它的 onBeforeRender 里记下来
  const rtNow = current;
  motes.points.onBeforeRender = renderer => {
    rtNow.renderer = renderer;
  };
  return current;
}

// ==================================================================== 每帧按 flags 同步外观

/**
 * 结局推近那一拍（M4 第 2 轮）：老周魂影的每个部件 uSolid → 0.8、uOpacity → 1（k = 0..1；0 还原成原值）。
 * 魂影片元的 a = uOpacity × mix(…, 1.55 + …, uSolid)：两者一起提上去才是不透明的（只 setOpacity(1) 是基础不透明度 0.5，铁栏仍透得过来）。
 * 颜色不变（仍是魂影青与边缘光）。原值记在材质的 userData 上，k 回到 0 时删掉。
 */
function applyZhouSolid(r: FinaleRt, k: number): void {
  if (!r.zhou) return;
  r.zhou.root.traverse(o => {
    const mesh = o as THREE.Mesh;
    const m = mesh.material as THREE.ShaderMaterial | undefined;
    if (!mesh.isMesh || !m || Array.isArray(m) || !m.isShaderMaterial) return;
    const uS = m.uniforms?.uSolid, uO = m.uniforms?.uOpacity;
    if (!uS || !uO) return;
    const ud = m.userData as { finSolid?: [number, number] };
    ud.finSolid ??= [uS.value as number, uO.value as number];
    const [s0, o0] = ud.finSolid;
    uS.value = s0 + (Math.max(s0, 0.8) - s0) * k;
    uO.value = o0 + (Math.max(o0, 1) - o0) * k;
    if (k <= 0) delete ud.finSolid;
  });
}

/** 老周头上人偶自己的五官贴图（魂影材质的 uHasMap）：on = 收起（笑脸贴片接管），off = 还原。 */
function maskZhouFace(r: FinaleRt, on: boolean): void {
  const head = r.zhou?.root.getObjectByName('head') as THREE.Mesh | undefined;
  const m = head?.material as THREE.ShaderMaterial | undefined;
  const u = m && !Array.isArray(m) && m.isShaderMaterial ? m.uniforms?.uHasMap : undefined;
  if (!m || !u) return;
  const ud = m.userData as { finHasMap?: number };
  if (on) {
    ud.finHasMap ??= u.value as number;
    u.value = 0;
  } else if (ud.finHasMap !== undefined) {
    u.value = ud.finHasMap;
    delete ud.finHasMap;
  }
}

/** 老周此刻该有的姿势与造型（没有过场接管时）。 */
function zhouLookFor(s: StateView): ZhouLook {
  if (s.flag(F.R1_SOUL_RETURNED)) return { pose: 'sit', variant: 'slump' };
  if (s.flag(F.R1_ZHOU_FED)) return { pose: 'stand', variant: 'cap' };
  return { pose: 'sit', variant: 'slump' };
}

export function sync(r: FinaleRt, dt: number): void {
  const s = r.ctx.state;
  // 遗像：摆上以后在桌上；补脸以后换成补好的那一版
  const want: FinaleRt['portrait']['shown'] = s.flag(F.R1_PORTRAIT_COMPLETE) ? 'done' : s.flag(F.R1_PORTRAIT_PLACED) ? 'blank' : 'none';
  const p = r.portrait;
  if (want !== p.shown) {
    p.shown = want;
    p.root.visible = want !== 'none';
    if (want === 'done') {
      p.done ??= r.ctx.track(portraitTexture('done'));
      p.mat.map = p.done;
      p.mat.needsUpdate = true;
    }
    p.sketch.visible = want === 'blank';
  }
  // 遗像前的蜡烛：摆上遗像就点着；火苗轻轻跳（纯视觉抖动），光晕朝着镜头
  const lit = want !== 'none' && !s.flag(F.R1_CALLED_AT_DAWN);
  for (const g of r.candles.groups) g.visible = lit;
  if (lit) {
    for (const f of r.candles.flames) f.scale.set(1, 0.85 + Math.random() * 0.3, 1);
    r.candles.haloMat.opacity = 0.75 + Math.random() * 0.25;
  }
  // 馄饨碗：放在他面前；吃完了只剩碗底一点汤
  r.bowl.visible = s.used(IT.WONTON) && s.flag(F.R1_ZHOU_VISIBLE);
  const eaten = r.bowlEaten ?? s.flag(F.R1_ZHOU_FED);
  const soup = r.bowl.getObjectByName('fin.bowl.soup');
  if (soup) {
    soup.position.y = eaten ? 0.018 : 0.052;
    soup.scale.setScalar(eaten ? 0.55 : 1);
  }
  // 粉笔叉
  const chalkMat = r.chalk.material as THREE.MeshStandardMaterial;
  if (r.chalkReveal !== null) {
    r.chalk.visible = r.chalkReveal > 0;
    chalkMat.opacity = r.chalkReveal;
  } else {
    r.chalk.visible = s.flag(F.R1_ZHOU_FED);
    chalkMat.opacity = 1;
  }
  // 三脚架模式里（CH1 俯拍）粉笔叉轻轻呼吸，身子站进 1.5m 圈里时再亮一档：看得出站没站到叉上（M4）
  const g = r.ctx.game;
  r.chalkT += dt;
  let glow = CHALK_GLOW;
  if (g.tripod.state !== 'off' && r.chalk.visible) {
    const p = g.player.position;
    const inZone = Math.hypot(p.x - R1.markPhoto[0], p.z - R1.markPhoto[2]) <= R1.markPhotoRadius;
    glow = inZone ? 0.8 : CHALK_GLOW + 0.25 * (0.5 + 0.5 * Math.sin(r.chalkT * 3.2));
  }
  chalkMat.emissiveIntensity = glow;
  // 蚁穴洞口的暖光（antCount 0 → 不亮，6 → 最亮；轻轻一明一暗）
  const ants = s.antCount();
  r.antGlow.visible = ants > 0;
  if (ants > 0) {
    r.antT += dt;
    const k = (0.3 + 0.7 * (ants / 6)) * (0.85 + 0.15 * Math.sin(r.antT * 1.7));
    for (const m of r.antGlow.children) ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = k;
    // 洞口时不时飘起一粒暖光（收下的旧照越多越勤；纯视觉）
    r.antMoteT -= dt;
    if (r.antMoteT <= 0) {
      r.antMoteT = 2.4 - 1.6 * (ants / 6);
      const x = ANTHILL_AT[0] + (Math.random() - 0.5) * 0.08, z = ANTHILL_AT[2] + (Math.random() - 0.5) * 0.08;
      r.motes.spawn(() => [x, 0.1, z], (u, f) => [f[0] + Math.sin(u * 6) * 0.04, f[1] + u * 0.7, f[2] + Math.cos(u * 5) * 0.04], { dur: 2.6, color: '#FFC27A', hdr: 1.6, size: 0.6 });
    }
  }
  // 老周的不透明度：显形过场里由 zhouReveal 接管；面板视点（监控台/录像机面板的视点就在椅子上方 0.3m）上 0.25 秒淡掉，
  // 离开面板再淡回来（M4：照妖镜拍中以后回到面板，不再被近裁面切开一大块青影）
  if (r.zhou && r.zhouNpc?.present) {
    if (r.zhouReveal !== null) {
      r.zhou.setOpacity(r.zhouReveal);
    } else {
      const stack = g.modes.stack;
      const onPanel = (stack.includes('mode.panel_console') || stack.includes('mode.panel_vcr')) && g.modes.top !== 'mode.cutscene';
      const want = onPanel ? 1 : 0;
      if (r.zhouPanelFade !== want) {
        r.zhouPanelFade = want > r.zhouPanelFade ? Math.min(1, r.zhouPanelFade + dt / 0.25) : Math.max(0, r.zhouPanelFade - dt / 0.25);
        if (dt === 0) r.zhouPanelFade = want;
        r.zhou.setOpacity(1 - r.zhouPanelFade);
      }
    }
  }
  // 老周的姿势与造型
  if (r.zhouNpc && r.zhou && r.zhouNpc.present) {
    const base = zhouLookFor(s);
    const look = { ...base, ...(r.zhouOverride ?? {}) };
    if (look.variant !== r.zhouApplied.variant) {
      r.zhouNpc.setVariant(look.variant);
      r.zhouApplied.variant = look.variant;
    }
    if (look.pose !== r.zhouApplied.pose) {
      r.zhou.setPose(look.pose, 0.4);
      r.zhouApplied.pose = look.pose;
    }
  }
  // 陆师傅化光
  if (r.luLeave !== null && r.lu) {
    r.luLeave += dt;
    r.lu.setOpacity(Math.max(0, 1 - r.luLeave / (LU_LEAVE_SEC * 0.8)));
    if (r.luLeave >= LU_LEAVE_SEC) {
      r.luLeave = null;
      r.ctx.setTemp('fin_lu_leave', false);
      r.lu.setOpacity(1);
    }
  }
  if (r.waving > 0 && r.zhou) {
    r.waving += dt;
    r.zhou.joints.shoulderR.rotation.z = 0.12 + Math.sin(r.waving * 7) * 0.35;
  }
  // 结局推近：笑脸贴片显示期间把人偶自己的五官贴图收起来（两张脸不叠在一起，M4 第 2 轮）
  const smiling = r.zhouSmile?.visible === true;
  if (smiling !== r.smileMasked) {
    r.smileMasked = smiling;
    maskZhouFace(r, smiling);
  }
  // 结局推近：魂影实起来（1 秒缓动）
  if (r.zhouSolidK !== r.zhouSolid) {
    r.zhouSolidK = dt === 0 ? r.zhouSolid : r.zhouSolid > r.zhouSolidK ? Math.min(r.zhouSolid, r.zhouSolidK + dt / 1.0) : Math.max(r.zhouSolid, r.zhouSolidK - dt / 1.0);
    applyZhouSolid(r, r.zhouSolidK);
  }
  // 吃完馄饨：坐着侧过身来看你（腰转一半、脖子转一半，最多 80°；0.8 秒缓动）
  if (r.zhouTurnK !== r.zhouTurn) {
    r.zhouTurnK = dt === 0 ? r.zhouTurn : r.zhouTurn > r.zhouTurnK ? Math.min(r.zhouTurn, r.zhouTurnK + dt / 0.8) : Math.max(r.zhouTurn, r.zhouTurnK - dt / 0.8);
  }
  if (r.zhouTurnK > 0 && r.zhou && r.zhouNpc) {
    const p = r.zhouTurnAt ? { x: r.zhouTurnAt[0], z: r.zhouTurnAt[2] } : g.player.position;
    const root = r.zhouNpc.root;
    const want = Math.atan2(-(p.x - root.position.x), -(p.z - root.position.z));
    let d = want - root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    d = Math.max(-1.4, Math.min(1.4, d));
    const e = r.zhouTurnK * r.zhouTurnK * (3 - 2 * r.zhouTurnK);
    r.zhou.joints.spine.rotation.y = d * 0.45 * e;
    r.zhou.joints.neck.rotation.y = d * 0.55 * e;
    // 抬起头看着站着的伙计（姿势每帧由 rig.update 重设，这里叠加；正 = 抬头，同 look_up）
    r.zhou.joints.neck.rotation.x += 0.42 * e;
  }
  r.motes.update(dt);
  r.procession.update(dt);
  for (let i = r.anims.length - 1; i >= 0; i--) if (!r.anims[i]!(dt)) r.anims.splice(i, 1);
  r.env.apply();
}
