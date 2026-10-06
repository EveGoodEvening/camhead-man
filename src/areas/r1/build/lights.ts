// owner: R1-world
// R1 的 8 盏实时灯（GDD §4.1：7 盏 + 半球光；ARCH §10.3 设计强度经 lamp()/designLight()/ctx.hemi()）：
//   半球光 #1B2233/#0B1020 0.25；钠灯①②（2.2/14，灯头 5.55m，湿地光带）；门灯（立柱上的近灯 0.5/7，r1.gate_lamp_on 后亮）；
//   CRT 磷绿（0.6/3，灯在屏幕前 0.6m）；土地灯笼（0.6/5，跟着土地走、挂在灯笼前下方 0.7m 的地上方；M4 第 2 轮从 0.9/4 调下来）；
//   车棚灯（开关①）；公告栏灯（开关②）。
// 灯数从进区域起固定，开关只改强度（关灯 = setOn(false)）。槐树彩灯、院外路灯、亮窗、灯箱只用 emissive。

import * as THREE from 'three';
import type { AreaContext } from '../../../core/area';
import type { V3 } from '../../../core/types';
import { PALETTE } from '../../../data/palette';
import { TEMP_C } from '../../../data/render';
import { designLight, lamp } from '../../../kit/lamps';
import type { LampRig } from '../../../kit/lamps';
import { R1 } from '../layout';
import { BOARD_LAMP_AT, GATE_LAMP_MOUNT, SHED_LAMP_AT } from './yard';
import { Statics, mat, staticize } from './common';

/** 土地灯笼的红光（GDD §4.1：#FF5A3A，强度 0.5，距离 4）。 */
export const LANTERN_RED = '#FF5A3A';

export interface R1Lights {
  hemi: THREE.HemisphereLight;
  sodium: [LampRig, LampRig];
  gate: LampRig;
  crt: LampRig;
  shed: LampRig;
  board: LampRig;
  lantern: THREE.PointLight;
  /** 槐树彩灯（开关④）：亮的那一半 */
  strings: StringLights;
}

/** 槐树彩灯：几串灯泡合成两个实例网格（能亮的一半、早坏了的一半），电线进全场电线束。只用 emissive。 */
export interface StringLights { setOn(on: boolean): void; wires: { a: V3; b: V3; sag: number }[] }

/** 钠灯：灯臂朝 armYaw（度，0 = 北）伸出；真实光放在转过之后的灯头上。 */
function sodium(ctx: AreaContext, st: Statics, at: V3, armYaw: number): LampRig {
  const l = lamp({ kind: 'sodium_pole', at, light: { design: 2.2, distance: 14 }, wetStreak: true });
  l.group.rotation.y = (-armYaw * Math.PI) / 180;
  l.group.updateMatrixWorld(true);
  if (l.light) {
    const head = new THREE.Vector3(0, 5.55, -1.25).applyMatrix4(l.group.matrixWorld);
    l.light.position.copy(head);
    l.light.name = 'sodium';
    ctx.light(l.light);
  }
  keepGlowOnly(l, st);
  ctx.add(l.group, { occlude: false });
  ctx.collider.box([at[0], 1.5, at[2]], [0.34, 3, 0.34]);
  return l;
}

/** 灯杆、灯臂、灯罩外壳这些不动的部件并进静态网格；只留发光的灯泡/灯罩（开关改它的自发光）与湿地光带。 */
export function keepGlowOnly(l: LampRig, st: Statics): void {
  staticize(l.group, st, m => m.name === 'wetStreak' || (m.material as THREE.Material).name === 'lampGlow');
}

const STRING_GLOW = 4;
/** 没通电的彩灯泡：彩色玻璃壳在钠灯下隐约看得见（×4 之后约 0.2，不发光） */
const STRING_OFF = 0.05;
const STRING_COLORS = ['#FFD27A', '#FF5A5A', '#6AD1FF', '#7CFF8A', '#FFB060'];

function stringLights(ctx: AreaContext, anchors: readonly { at: V3; rotY: number }[]): StringLights {
  const n = 18, len = 4.2, sag = 0.35;
  const geo = ctx.track(new THREE.SphereGeometry(0.035, 6, 5));
  const make = (list: { at: V3; rotY: number }[], name: string) => {
    const matl = new THREE.MeshBasicMaterial({ color: 0xffffff });
    matl.userData.tempC = TEMP_C.lamp;
    const mesh = new THREE.InstancedMesh(geo, matl, Math.max(1, list.length * n));
    mesh.name = name;
    const m = new THREE.Matrix4(), c = new THREE.Color();
    let k = 0;
    for (const a of list) {
      const cs = Math.cos(a.rotY), sn = Math.sin(a.rotY);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const x = (t - 0.5) * len;
        const y = -sag * (1 - (2 * t - 1) ** 2);
        m.makeTranslation(a.at[0] + x * cs, a.at[1] + y, a.at[2] - x * sn);
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, c.set(STRING_COLORS[(i + k) % STRING_COLORS.length]!));
        k++;
      }
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData.noOcclude = true;
    mesh.raycast = () => {};
    ctx.add(mesh, { occlude: false });
    return matl;
  };
  const on = make(anchors.filter((_, i) => i % 2 === 0), 'stringsOn');
  const broken = make(anchors.filter((_, i) => i % 2 === 1), 'stringsBroken');
  broken.color.setScalar(STRING_OFF * STRING_GLOW);
  broken.userData.tempC = TEMP_C.ambient;
  const wires = anchors.map(a => {
    const cs = Math.cos(a.rotY), sn = Math.sin(a.rotY);
    return {
      a: [a.at[0] - (len / 2) * cs, a.at[1] + 0.04, a.at[2] + (len / 2) * sn] as V3,
      b: [a.at[0] + (len / 2) * cs, a.at[1] + 0.04, a.at[2] - (len / 2) * sn] as V3,
      sag,
    };
  });
  return {
    wires,
    setOn(v) {
      on.color.setScalar((v ? 1 : STRING_OFF) * STRING_GLOW);
      on.userData.tempC = v ? TEMP_C.lamp : TEMP_C.ambient;
    },
  };
}

export function buildLights(ctx: AreaContext, st: Statics, stringAnchors: readonly { at: V3; rotY: number }[]): R1Lights {
  const hemi = ctx.hemi('#1B2233', PALETTE.NIGHT, 0.25);
  // 钠灯①在树西，灯臂朝东伸向槐树；钠灯②在树东南，灯臂朝西北
  const s1 = sodium(ctx, st, R1.sodium1, 90);
  const s2 = sodium(ctx, st, R1.sodium2, 300);
  // 门灯：东立柱朝院里的那一面（背对墙，灯罩朝北）；开关③
  // （墙上近灯按 look-dev 取 0.5/7：钠灯的 2.2/14 挂在墙上会把灯下 0.5m 的墙照爆）
  const gate = lamp({ kind: 'gate_lamp', at: GATE_LAMP_MOUNT, light: { design: 0.5, distance: 7 }, wetStreak: { length: 3.2, width: 0.9 }, on: false });
  gate.light!.name = 'gateLamp';
  ctx.light(gate.light!);
  keepGlowOnly(gate, st);
  ctx.add(gate.group, { occlude: false });
  // CRT 磷绿（look-dev：灯在屏幕前 ≥0.3m，否则桌面照爆）
  const cs = R1.derived.crtScreen.center;
  // （放在屏幕前 1.1m、1.45m 高——屋子正中：小屋里只有这一盏灯，磷绿要同时铺到桌面、椅子、北墙的电闸箱与镜子；
  //   贴着屏幕放则桌面一块白斑、北墙全黑。look-dev：CRT 光 ≥ 0.3m 放在屏幕前）
  const crt = lamp({ kind: 'crt_glow', at: [cs[0] + 0.05, 1.45, cs[2] - 1.1], light: { design: 0.6, distance: 3 } });
  crt.light!.name = 'crtGlow';
  ctx.light(crt.light!);
  ctx.add(crt.group, { occlude: false });
  // 车棚灯（开关①）：棚顶吊下来的一只灯泡
  const shed = lamp({ kind: 'hall_bulb', at: SHED_LAMP_AT, light: { design: 1.4, distance: 6 }, on: false });
  shed.light!.name = 'shedLamp';
  ctx.light(shed.light!);
  keepGlowOnly(shed, st);
  ctx.add(shed.group, { occlude: false });
  st.cyl(0.004, 0.004, 0.3, mat('cord', { color: '#111', roughness: 0.8 }), [SHED_LAMP_AT[0], SHED_LAMP_AT[1] + 0.22, SHED_LAMP_AT[2]], 4);
  // 公告栏灯（开关②）：雨棚下的一盏小搪瓷灯罩，照着板面
  const board = lamp({ kind: 'gate_lamp', at: [BOARD_LAMP_AT[0], BOARD_LAMP_AT[1] + 0.08, BOARD_LAMP_AT[2] + 0.34], light: { design: 0.5, distance: 6 }, on: false });
  board.light!.name = 'boardLamp';
  ctx.light(board.light!);
  keepGlowOnly(board, st);
  ctx.add(board.group, { occlude: false });
  // 土地的灯笼：灯挂在 lightsRoot 下，由 NpcDef.lights 每帧跟到灯笼前下方的锚点上（土地不在场时强度 0）
  // M4 第 2 轮：0.9/4 → 0.6/5，锚点从灯笼挪到它前下方 0.7m（logic.ts registerTudi）：红光铺在他脚前的地上，
  // 不再从 0.3m 处直打他的脸和胸（原来照度是 look-dev 墙面值的十几倍，取景器里整个人烧成一尊金色人偶）
  const lantern = designLight('point', LANTERN_RED, 0.6, 5) as THREE.PointLight;
  lantern.name = 'tudiLantern';
  lantern.position.set(...(R1.npcSpots.tudiTree as V3));
  ctx.light(lantern, ctx.lightsRoot);
  // 槐树彩灯（只用 emissive）：一半亮（开关④），一半早坏了
  const strings = stringLights(ctx, stringAnchors);
  strings.setOn(false);
  st.spans.push(...strings.wires);
  return { hemi, sodium: [s1, s2], gate, crt, shed, board, lantern, strings };
}
