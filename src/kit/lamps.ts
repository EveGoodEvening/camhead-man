// owner: WP2
// 灯（ARCH §10.2、§10.3）：灯罩 emissive + 可选真实光；关灯 = intensity 0（不移除、不隐藏光源）。
// 真实光不挂在 group 下，而是交给 ctx.light() 挂到 root/lightsRoot，位置同步到灯罩。
//
// 约定：
// - `at`：'sodium_pole' 是灯杆脚（地面）；其余是灯具本身（灯泡/灯罩）的位置。group.position = at，灯具朝 -z；
//   墙上的灯（门灯）请区域自己转 group（rotation.y）让它背对墙。
// - 真实光创建时就放在灯泡的世界位置（假定 group 挂在区域 root 下、不再移动）；之后若 group 被移动，灯泡网格的
//   onBeforeRender 会把光的位置同步过去（只在灯泡可见时）。区域要做的只是 ctx.light(rig.light)。
// - wetStreak：灯下湿地面的加法光带（ARCH §8.3），贴在世界 y=0 的地面上（室外用），每次绘制前转向当前相机，
//   像真的湿地倒影一样朝观察者拉长。

import * as THREE from 'three';
import type { V3 } from '../core/types';
import { LIGHT_SCALE, TEMP_C } from '../data/render';
import { PALETTE } from '../data/palette';
import { MATERIALS } from '../fx/materials';
import { paintTexture } from './canvas';
import { kitMat, newMat, rod } from './geom';

export type LampKind = 'sodium_pole' | 'gate_lamp' | 'hall_bulb' | 'fluorescent' | 'lantern' | 'tungsten_pendant' | 'safelight' | 'crt_glow' | 'string_lights';

export interface LampOpts {
  kind: LampKind; at: V3; color?: THREE.ColorRepresentation;
  light?: { design: number; distance: number; castShadow?: boolean } | false; on?: boolean;
  /** 灯下湿地面的加法混合竖向光带贴花（ARCH §8.3） */
  wetStreak?: boolean | { length: number; width: number };
}

export interface LampRig {
  group: THREE.Group;
  light: THREE.PointLight | THREE.SpotLight | null;
  setOn(on: boolean): void;
  setLevel(v01: number): void;
  setColor(c: THREE.ColorRepresentation): void;
}

/**
 * GDD“设计强度”→物理单位（M1c look-dev 冻结，ARCH §10.3）：坎德拉 = design × LIGHT_SCALE.point × distance²。
 * GDD 的“强度 X、距离 Y”是旧版 three 的线性衰减心智（灯“照到 Y 米那么远”），物理衰减（decay 2）下同样的 design，
 * 照得远的灯需要多得多的坎德拉：按 distance² 归一后，钠灯 2.2/14、CRT 0.6/3、声控灯 1.6/6、灯笼 0.9/5 都落在合适的亮度。
 * 例：designLight('point', SODIUM, 2.2, 14) → new PointLight(SODIUM, 2.2 × 0.1 × 14², 14, 2)。
 */
/** designLight 的换算（自测与区域估算用）：design × LIGHT_SCALE[kind] × distance²。 */
export function designCandela(kind: 'point' | 'spot', design: number, distance: number): number {
  return design * LIGHT_SCALE[kind] * distance * distance;
}

export function designLight(kind: 'point' | 'spot', color: THREE.ColorRepresentation, design: number, distance: number): THREE.PointLight | THREE.SpotLight {
  let l: THREE.PointLight | THREE.SpotLight;
  if (kind === 'spot') {
    const s = new THREE.SpotLight(color, designCandela('spot', design, distance), distance, Math.PI / 3.2, 0.45, 2);
    // 目标挂在灯下面（跟着灯走，矩阵随场景遍历更新），默认朝下
    s.target.position.set(0, -1, 0);
    s.add(s.target);
    l = s;
  } else {
    l = new THREE.PointLight(color, designCandela('point', design, distance), distance, 2);
  }
  l.userData.design = design;
  l.layers.enableAll();
  return l;
}

const DEFAULT_COLOR: Readonly<Record<LampKind, string>> = {
  sodium_pole: PALETTE.SODIUM, gate_lamp: PALETTE.SODIUM, hall_bulb: PALETTE.HALL_LAMP, fluorescent: '#CFF5E1', lantern: PALETTE.LANTERN,
  tungsten_pendant: '#FFC98A', safelight: PALETTE.SAFELIGHT, crt_glow: PALETTE.OSD, string_lights: '#FFD27A',
};

/**
 * 灯罩/灯泡的自发光强度（M1c look-dev 冻结）。亮到色调映射后灯芯烧成近白、四周留一圈灯色的 Bloom 光晕——
 * 橙色/黄色的像素在显示空间里亮度到不了 0.8，只有接近白的灯芯才算“高光”（shots.mjs 的验收，ARCH §12.4）。
 * 纸灯笼、暗房红灯是大面积的柔光，不烧白。
 */
const GLOW: Readonly<Record<LampKind, number>> = {
  sodium_pole: 8, gate_lamp: 6, hall_bulb: 6, fluorescent: 5, lantern: 3.2, tungsten_pendant: 6, safelight: 3, crt_glow: 2.6, string_lights: 2.6,
};

/** 彩灯串小灯泡的亮度（HDR，MeshBasicMaterial × instanceColor；M1c look-dev：原来 ≤ 1 进不了 Bloom） */
const STRING_GLOW = 4;

/** 各种灯的灯泡相对 at 的位置。 */
function bulbOffset(kind: LampKind): V3 {
  switch (kind) {
    case 'sodium_pole': return [0, 5.55, -1.25];
    case 'gate_lamp': return [0, -0.08, -0.34];
    case 'tungsten_pendant': return [0, -0.08, 0];
    case 'lantern': return [0, -0.1, 0];
    default: return [0, 0, 0];
  }
}

let streakTex: THREE.CanvasTexture | null = null;
/**
 * 湿地倒影光带的 alpha（M1c look-dev 重画）：v 从灯脚（0）到观察者一端（1）。
 * 窄而亮的芯 + 很淡的宽晕；沿长度在灯脚附近很快亮起、在前 20% 处最亮、往观察者方向拖一条长尾；
 * 芯被横向的“水纹”打断成一截一截（湿沥青上的倒影不是一块完整的色块）。
 */
function streakTexture(): THREE.CanvasTexture {
  streakTex ??= paintTexture(64, 256, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1);
      const rise = Math.min(1, v / 0.08);
      const along = rise * rise * Math.pow(1 - v, 1.35) * (1 + 0.6 * Math.exp(-((v - 0.2) ** 2) / 0.02));
      // 横向水纹：一截亮一截暗（固定图案，不随时间动）
      const ripple = 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.sin(y * 0.55 + Math.sin(y * 0.13) * 2.0), 2);
      for (let x = 0; x < w; x++) {
        const u = (x / (w - 1)) * 2 - 1;
        const core = Math.exp(-u * u * 16) * ripple;
        // 宽晕到边上正好归零（不留一块有硬边的淡橙色“布”）
        const halo = Math.max(0, Math.exp(-u * u * 4) - Math.exp(-4)) * 0.1;
        const a = Math.max(0, Math.min(1, along * (core + halo) / 1.3));
        // three 的 alphaMap 读的是**绿通道**（alphamap_fragment：.g），所以形状写进 RGB 灰度、alpha 满（M1c 修正：
        // 原来写在 alpha 里、RGB 全白，alphaMap 读到的恒为 1，光带成了一整块实心的橙色矩形）
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(a * 255);
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
  return streakTex;
}

/** 湿地光带的不透明度（加法混合，乘灯色；look-dev 冻结）。 */
const STREAK_OPACITY = 0.7;
/** 湿地光带的颜色增益（HDR，look-dev 冻结） */
const STREAK_GAIN = 2.5;

const noRaycast: THREE.Mesh['raycast'] = () => {};

/** 湿地光带：每次绘制前绕 y 转向当前相机（长轴从灯脚指向观察者）。 */
function wetStreak(color: THREE.Color, length: number, width: number, groundLocalY: number): { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
  const geo = new THREE.PlaneGeometry(width, length);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, length * 0.46); // 灯脚附近开始，朝 +z（转向后 = 朝相机）拉长
  // 灯色 × STREAK_GAIN（HDR）：水面倒影几乎和灯一样亮，芯经色调映射后发白，两侧与长尾仍是灯色
  const mat = new THREE.MeshBasicMaterial({
    color: color.clone().multiplyScalar(STREAK_GAIN), alphaMap: streakTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: STREAK_OPACITY,
  });
  const m = new THREE.Mesh(geo, mat);
  m.name = 'wetStreak';
  m.position.y = groundLocalY + 0.02;
  m.renderOrder = 2;
  m.userData.irHide = true;
  m.userData.noOcclude = true;
  m.raycast = noRaycast;
  const wp = new THREE.Vector3(), cp = new THREE.Vector3(), pq = new THREE.Quaternion(), pe = new THREE.Euler();
  m.onBeforeRender = (_r, _s, camera) => {
    m.getWorldPosition(wp);
    camera.getWorldPosition(cp);
    const parentYaw = m.parent ? pe.setFromQuaternion(m.parent.getWorldQuaternion(pq), 'YXZ').y : 0;
    m.rotation.y = Math.atan2(cp.x - wp.x, cp.z - wp.z) - parentYaw;
    m.updateMatrixWorld();
  };
  return { mesh: m, mat };
}

/** 灯具外形（灯罩/灯泡材质单独返回，开关灯时改它的 emissive）。 */
function fixture(kind: LampKind, g: THREE.Group, glow: THREE.MeshStandardMaterial): THREE.Mesh | null {
  const metal = MATERIALS.metal();
  const add = <T extends THREE.Object3D>(o: T): T => {
    g.add(o);
    return o;
  };
  switch (kind) {
    case 'sodium_pole': {
      const pole = kitMat('lamp.pole', { color: '#4A4E54', roughness: 0.6, metalness: 0.5 });
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 5.7, 10).translate(0, 2.85, 0), pole)).name = 'pole';
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.5, 10).translate(0, 0.25, 0), pole)).name = 'poleFoot';
      // 弯臂
      const arm = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 5.5, 0), new THREE.Vector3(0, 5.85, -0.3), new THREE.Vector3(0, 5.8, -1.0), new THREE.Vector3(0, 5.7, -1.25)]);
      add(new THREE.Mesh(new THREE.TubeGeometry(arm, 12, 0.045, 6), pole)).name = 'arm';
      // 眼镜蛇头灯罩 + 底下的发光灯罩
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), pole);
      head.scale.set(0.75, 0.35, 1.2);
      head.position.set(0, 5.62, -1.3);
      add(head).name = 'lampHead';
      // 发光的碗形灯罩（M1c look-dev 放大一点：0.95×0.35×1.3 → 1.1×0.42×1.45，远处也有一块烧白的灯芯）
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), glow);
      lens.scale.set(1.1, 0.42, 1.45);
      lens.position.set(0, 5.62, -1.3);
      return add(lens);
    }
    case 'gate_lamp': {
      // 墙上支架 + 绿搪瓷伞形灯罩 + 灯泡
      // 底板从挂点往灯罩那一侧（−z）凸出 3cm（M1d：原来 +z 半边藏在墙里、正面与墙面共面，z-fight 成锯齿）
      add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.03).translate(0, 0, -0.015), metal)).name = 'wallPlate';
      add(rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.08, -0.3), 0.012, metal)).name = 'bracketArm';
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.12, 16, 1, true).translate(0, -0.02, 0), kitMat('lamp.enamelGreen', { color: '#2F5B45', roughness: 0.35, side: THREE.DoubleSide }));
      shade.position.set(0, 0.02, -0.34);
      add(shade).name = 'shade';
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), glow);
      bulb.position.set(0, -0.08, -0.34);
      return add(bulb);
    }
    case 'hall_bulb': {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.06, 10).translate(0, 0.07, 0), kitMat('lamp.socketWhite', { color: '#DDD8CA', roughness: 0.5 }))).name = 'socket';
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), glow);
      bulb.scale.set(1, 1.3, 1);
      return add(bulb);
    }
    case 'fluorescent': {
      add(new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.04, 0.08).translate(0, 0.04, 0), metal)).name = 'holder';
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.2, 8).rotateZ(Math.PI / 2), glow);
      return add(tube);
    }
    case 'lantern': {
      const prof = [[0.001, 0.2], [0.11, 0.19], [0.17, 0.1], [0.18, 0], [0.17, -0.1], [0.11, -0.19], [0.001, -0.2]].map(([x, y]) => new THREE.Vector2(x ?? 0, y ?? 0));
      const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 16), glow);
      body.position.y = -0.1;
      const cap = kitMat('lamp.lanternCap', { color: '#2a2622', roughness: 0.8 });
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.04, 10).translate(0, 0.11, 0), cap)).name = 'capTop';
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.04, 10).translate(0, -0.31, 0), cap)).name = 'capBottom';
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.4, 4).translate(0, 0.33, 0), cap)).name = 'string';
      return add(body);
    }
    case 'tungsten_pendant': {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 1.0, 4).translate(0, 0.55, 0), MATERIALS.metal())).name = 'cord';
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 16, 1, true), kitMat('lamp.pendantShade', { color: '#2B2B2E', roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }));
      shade.position.y = 0.02;
      add(shade).name = 'shade';
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), glow);
      bulb.position.y = -0.08;
      return add(bulb);
    }
    case 'safelight': {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.1), kitMat('lamp.safelightBox', { color: '#1d1d1f', roughness: 0.6, metalness: 0.3 }))).name = 'box';
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.12), glow);
      glass.rotation.y = Math.PI;
      glass.position.z = -0.051;
      return add(glass);
    }
    case 'string_lights':
    case 'crt_glow':
      return null;
  }
}

/** 彩灯串：沿一段下垂的弧线的小灯泡（实例化，一次绘制；纯 emissive，不带真实光）。 */
function stringLights(g: THREE.Group, color: THREE.Color): THREE.InstancedMesh {
  const n = 18, len = 4.2, sag = 0.35;
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  mat.userData.tempC = TEMP_C.lamp;
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 6, 5), mat, n);
  mesh.name = 'stringBulbs';
  const palette = [color, new THREE.Color('#FF5A5A'), new THREE.Color('#6AD1FF'), new THREE.Color('#7CFF8A'), new THREE.Color('#FFD27A')];
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = (t - 0.5) * len;
    const y = -sag * (1 - (2 * t - 1) ** 2);
    m.makeTranslation(x, y, 0);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, palette[i % palette.length] ?? color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  // 电线
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    pts.push(new THREE.Vector3((t - 0.5) * len, -sag * (1 - (2 * t - 1) ** 2) + 0.04, 0));
  }
  const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#111' }));
  wire.name = 'stringWire';
  g.add(mesh, wire);
  return mesh;
}

/** 灯罩 emissive + 可选真实光；关灯 = intensity 0（不移除、不隐藏光源）。真实光不挂在 group 下，而是交给 ctx.light() 挂到 root/lightsRoot，位置同步到灯罩 */
export function lamp(o: LampOpts): LampRig {
  const color = new THREE.Color(o.color ?? DEFAULT_COLOR[o.kind]);
  const group = new THREE.Group();
  group.name = `lamp.${o.kind}`;
  group.position.set(o.at[0], o.at[1], o.at[2]);
  // 灯罩发光材质每盏灯一份（开关、调光互不影响）；亮时 60℃（ARCH §6.8.2）
  const glowIntensity = GLOW[o.kind];
  const glow = newMat({ color: color.clone().multiplyScalar(0.25), emissive: color, emissiveIntensity: glowIntensity, roughness: 0.4, tempC: TEMP_C.lamp });
  glow.name = 'lampGlow';
  if (o.kind === 'lantern') glow.side = THREE.DoubleSide;
  const bulb = fixture(o.kind, group, glow);
  const bulbs = o.kind === 'string_lights' ? stringLights(group, color) : null;

  let light: THREE.PointLight | THREE.SpotLight | null = null;
  if (o.light) {
    const spot = o.kind === 'tungsten_pendant' && o.light.castShadow === true;
    light = designLight(spot ? 'spot' : 'point', color, o.light.design, o.light.distance);
    light.name = `lampLight.${o.kind}`;
    const off = bulbOffset(o.kind);
    light.position.set(o.at[0] + off[0], o.at[1] + off[1], o.at[2] + off[2]);
    if (o.light.castShadow) {
      light.castShadow = true;
      light.shadow.mapSize.set(512, 512);
      light.shadow.bias = -0.0008;
    }
    if (bulb) {
      const lp = new THREE.Vector3();
      const l = light;
      const prev = bulb.onBeforeRender;
      bulb.onBeforeRender = (...args) => {
        prev.apply(bulb, args);
        bulb.getWorldPosition(lp);
        if (lp.distanceToSquared(l.position) > 1e-6 && l.parent) l.parent.worldToLocal(l.position.copy(lp));
      };
    }
  }

  let streak: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } | null = null;
  if (o.wetStreak) {
    const ws = o.wetStreak === true ? { length: o.kind === 'sodium_pole' ? 7.0 : 3.5, width: o.kind === 'sodium_pole' ? 1.4 : 0.9 } : o.wetStreak;
    streak = wetStreak(color, ws.length, ws.width, -o.at[1]);
    const off = o.kind === 'sodium_pole' ? bulbOffset(o.kind) : [0, 0, 0];
    streak.mesh.position.x = off[0] ?? 0;
    streak.mesh.position.z = off[2] ?? 0;
    group.add(streak.mesh);
  }

  const baseLight = light?.intensity ?? 0;
  let on = o.on ?? true;
  let level = 1;
  const apply = () => {
    const k = on ? level : 0;
    glow.emissiveIntensity = glowIntensity * k;
    glow.userData.tempC = k > 0.05 ? TEMP_C.lamp : TEMP_C.ambient;
    if (light) light.intensity = baseLight * k;
    if (streak) streak.mat.opacity = STREAK_OPACITY * k;
    if (streak) streak.mesh.visible = k > 0.001;
    if (bulbs) {
      const bm = bulbs.material as THREE.MeshBasicMaterial;
      bm.color.setScalar((0.15 + 0.85 * k) * STRING_GLOW);
    }
  };
  apply();
  return {
    group,
    light,
    setOn(v) {
      on = v;
      apply();
    },
    setLevel(v) {
      level = Math.max(0, Math.min(1, v));
      apply();
    },
    setColor(c) {
      color.set(c);
      glow.emissive.copy(color);
      glow.color.copy(color).multiplyScalar(0.25);
      light?.color.copy(color);
      streak?.mat.color.copy(color).multiplyScalar(STREAK_GAIN);
    },
  };
}
