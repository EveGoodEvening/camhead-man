// owner: R1-world
// 门卫室（GDD §4.1“门卫室内部”）：外壳、门、两扇窗、屋顶；屋里的桌子（抽屉转轮锁）、CRT、录像机、“视频入1”插孔、巡夜本、暖壶、
// 椅子、录像带架、《监控调试注意事项》、电闸箱与四个开关、圆镜、脸盆架、CH2 半球机位；门楣空支架与断线头、门口台阶、痰盂、电表箱。
// 坐标一律取 r1/layout.ts；ref（r1.desk r1.crt r1.vcr r1.crt_jack r1.bracket r1.mirror）的 id 与坐标与 M1a 占位一致（ARCH §15.4）。

import * as THREE from 'three';
import type { AreaContext } from '../../../core/area';
import type { V3 } from '../../../core/types';
import { OBJ } from '../../../data/ids';
import { PALETTE } from '../../../data/palette';
import { TEMP_C } from '../../../data/render';
import { MATERIALS } from '../../../fx/materials';
import { PROPS } from '../../../kit/props';
import { door } from '../../../kit/doors';
import { paintTexture, wrapText, agePaper, grain, drawHandLine, HAND_FONT_STACK } from '../../../kit/canvas';
import { FONT_STACK } from '../../../kit/text';
import { rng } from '../../../kit/rng';
import { R1 } from '../layout';
import { CCTV_NOTICE, IDCARD } from '../text';
import type { DecalAtlas } from './common';
import { DECAL, Statics, boardSign, canvasTex, mat, place, rotPlaneForYaw, wallPieces } from './common';

/** 门卫室外壳（墙的内外面）。外框约为 GDD 的 x:-8~-5、z:18.5~22；北墙内面在镜面后 2.5cm，西墙内面在注意事项纸后 0.5cm。 */
export const BOOTH = {
  x0: -8.08, x1: -5.0, z0: 18.45, z1: 21.92,
  inX0: -7.96, inX1: -5.12, inZ0: 18.575, inZ1: 21.8,
  ceil: 2.6, top: 3.0,
  door: { z0: 19.75, z1: 20.65, h: 2.05 },
  eastWin: { z0: 21.0, z1: 21.62, y0: 1.0, y1: 1.85 },
  southWin: { x0: -7.25, x1: -5.75, y0: 1.2, y1: 2.0 },
} as const;

/** 电闸箱：箱子中心（GDD r1.switch_box 的 x、y；z 往外挪到箱背贴着北墙内面），正面朝南。 */
export const SWITCH_BOX_AT: V3 = [R1.switchBox[0], R1.switchBox[1], 18.645];
/** 开关①–④ 的锚点（从左到右 = 从西到东，站在箱前看）。 */
export const SWITCH_AT: readonly V3[] = [0, 1, 2, 3].map(k => [R1.switchBox[0] - 0.15 + k * 0.1, R1.switchBox[1] - 0.06, SWITCH_BOX_AT[2] + 0.03] as V3);
/** 四张贴条的中心（rd.switch_labels 的读字点；箱里背板前 8mm）。 */
export const SWITCH_LABELS_AT: V3 = [R1.switchBox[0], R1.switchBox[1] + 0.09, SWITCH_BOX_AT[2] - 0.026];
/** 褪字层的字：浅蓝圆珠笔色，材质颜色再乘成 HDR，取景器里微微发亮（R1 的褪字都用它：电闸贴条、讣告下半截）。 */
export const FADED_INK = '#C2D2FF';
export const FADED_GLOW = new THREE.Color(2.3, 2.35, 2.5);
/** 巡夜本（桌上，CRT 与录像机之间的桌沿） */
export const LOG_AT: V3 = [-6.38, 0.772, 21.32];

export interface BoothHandles {
  screen: THREE.Mesh;
  mirror: THREE.Mesh;
  log: THREE.Object3D;
  logHit: THREE.Mesh;
  logGlow: THREE.Mesh;
  drawer: THREE.Object3D;
  drawerClosedZ: number;
  switchLevers: THREE.Object3D[];
  switchHits: THREE.Mesh[];
  switchBoxHit: THREE.Mesh;
  jack: THREE.Object3D;
  vcr: THREE.Object3D;
  deskHit: THREE.Mesh;
  bracket: THREE.Object3D;
  tapeRackHit: THREE.Mesh;
  noticeHit: THREE.Mesh;
}

// ==================================================================== 画布：注意事项、巡夜本、日历、镜子预制

/** 一张打印的纸：标题粗体 + 自动换行的正文 + 落款（R1 的墙上文档用）。 */
export function paperSheet(ctx: AreaContext, o: { title: string; lines: readonly string[]; sign?: string; w: number; h: number; seed: number; aged?: number; titleSize?: number; bodySize?: number; red?: boolean }): THREE.CanvasTexture {
  return canvasTex(ctx, o.w, o.h, (g, w, h) => {
    g.fillStyle = '#EFE9D8';
    g.fillRect(0, 0, w, h);
    const pad = w * 0.08;
    g.fillStyle = o.red ? '#9E1A1A' : '#1b1b1b';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    const ts = o.titleSize ?? Math.round(w * 0.07);
    g.font = `bold ${ts}px ${FONT_STACK}`;
    let y = pad;
    for (const l of wrapText(g, o.title, w - pad * 2)) {
      g.fillText(l, w / 2, y);
      y += ts * 1.3;
    }
    y += ts * 0.4;
    g.textAlign = 'left';
    g.fillStyle = '#1b1b1b';
    const bs = o.bodySize ?? Math.round(w * 0.045);
    g.font = `${bs}px ${FONT_STACK}`;
    for (const para of o.lines) {
      for (const l of wrapText(g, para, w - pad * 2)) {
        if (y > h - pad - bs) break;
        g.fillText(l, pad, y);
        y += bs * 1.55;
      }
      y += bs * 0.35;
    }
    if (o.sign) {
      g.textAlign = 'right';
      g.fillText(o.sign, w - pad, Math.min(h - pad - bs, y + bs * 0.6));
    }
    agePaper(g, w, h, o.aged ?? 0.4, o.seed, 2);
    grain(g, w, h, 0.18, o.seed + 1);
  });
}

function logTexture(ctx: AreaContext): THREE.CanvasTexture {
  // 摊开的巡夜本：左页旧字（蓝圆珠笔），右页一行墨迹未干的新字
  return canvasTex(ctx, 1024, 704, (g, w, h) => {
    g.fillStyle = '#EDE6D2';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(80,110,160,0.35)';
    g.lineWidth = 2;
    for (let y = h * 0.12; y < h * 0.95; y += h * 0.075) {
      g.beginPath();
      g.moveTo(w * 0.04, y);
      g.lineTo(w * 0.47, y);
      g.moveTo(w * 0.53, y);
      g.lineTo(w * 0.96, y);
      g.stroke();
    }
    const grd = g.createLinearGradient(w * 0.46, 0, w * 0.54, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.5, 'rgba(60,45,25,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(w * 0.46, 0, w * 0.08, h);
    const r = rng(830);
    const old = ['8月26日 路过五楼……', '门神还歪着。', '8月29日 三楼楼道灯', '又不亮了。灯泡买了，', '搁抽屉里，明儿换。', '心口有点闷……'];
    old.forEach((l, i) => drawHandLine(g, r, l, w * 0.06, h * (0.17 + i * 0.075) - 6, h * 0.05, '#23408f'));
    drawHandLine(g, r, '伙计，门口的灯灭了。', w * 0.56, h * 0.245 - 6, h * 0.058, '#0e1424', { smear: 0.6 });
    agePaper(g, w, h, 0.3, 31, 1);
  });
}

function calendarTexture(ctx: AreaContext): THREE.CanvasTexture {
  // 撕页日历停在 2023 年 8 月 30 日（那天没人再撕）
  return canvasTex(ctx, 256, 320, (g, w, h) => {
    g.fillStyle = '#F2EEE2';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#B51E22';
    g.fillRect(0, 0, w, h * 0.2);
    g.fillStyle = '#F7EFD9';
    g.font = `bold ${Math.round(h * 0.1)}px ${FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('2023年 八月', w / 2, h * 0.1);
    g.fillStyle = '#B51E22';
    g.font = `bold ${Math.round(h * 0.42)}px ${FONT_STACK}`;
    g.fillText('30', w / 2, h * 0.5);
    g.fillStyle = '#333';
    g.font = `${Math.round(h * 0.075)}px ${FONT_STACK}`;
    g.fillText('星期三　七月十五', w / 2, h * 0.8);
    g.fillText('中元节', w / 2, h * 0.9);
    agePaper(g, w, h, 0.5, 44, 1);
  });
}

/** 镜面预制（settings.mirrorMode='baked'）：摄像头脑袋的镜像线稿，头在上半部，贴条在镜头上方，贴条字已镜像（GDD §3.14）。 */
export function bakedMirrorTexture(ctx: AreaContext): THREE.CanvasTexture {
  return canvasTex(ctx, 512, 512, (g, w, h) => {
    const bg = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.7);
    bg.addColorStop(0, '#5d6770');
    bg.addColorStop(1, '#232a31');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 4;
    // 摄像头外壳（米白），镜头（深色圆），铁皮帽
    g.fillStyle = '#D9D3C4';
    g.fillRect(w * 0.26, h * 0.2, w * 0.48, h * 0.3);
    g.strokeRect(w * 0.26, h * 0.2, w * 0.48, h * 0.3);
    g.fillStyle = '#8C7B62';
    g.beginPath();
    g.moveTo(w * 0.18, h * 0.2);
    g.lineTo(w * 0.8, h * 0.16);
    g.lineTo(w * 0.82, h * 0.2);
    g.lineTo(w * 0.2, h * 0.24);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#16181b';
    g.beginPath();
    g.arc(w / 2, h * 0.41, w * 0.075, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#6b6e72';
    g.stroke();
    // 贴条（镜像字）
    g.fillStyle = '#E8E1CF';
    g.fillRect(w * 0.4, h * 0.26, w * 0.2, h * 0.07);
    g.save();
    g.translate(w * 0.5, h * 0.295);
    g.scale(-1, 1);
    g.fillStyle = '#2a3a7a';
    g.font = `bold ${Math.round(h * 0.045)}px ${HAND_FONT_STACK}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('04.6.18', 0, 0);
    g.restore();
    // 领口与肩膀（值勤藏蓝）
    g.fillStyle = PALETTE.UNIFORM;
    g.fillRect(w * 0.18, h * 0.62, w * 0.64, h * 0.4);
    g.fillStyle = '#9aa0a6';
    g.fillRect(w * 0.47, h * 0.5, w * 0.06, h * 0.12);
  });
}

// ==================================================================== 建造

/** 墙面的漆：室内下绿上白、室外抹灰下刷绿。 */
function skins(st: Statics): void {
  const b = BOOTH;
  const dado = mat('dado', { color: PALETTE.DADO, roughness: 0.6 });
  const lime = MATERIALS.lime();
  const plaster = MATERIALS.plaster();
  const dh = 1.05;
  const dz = b.door, ew = b.eastWin, sw = b.southWin;
  // 室内：四面墙内侧 1cm 的皮（下绿上白），窗洞/门洞照开
  const inner = (axis: 'x' | 'z', c: number, s0: number, s1: number, holes: (readonly [number, number, number, number])[]) => {
    wallPieces(st, dado, axis, c, s0, s1, 0, dh, 0.01, holes);
    wallPieces(st, lime, axis, c, s0, s1, dh, b.ceil, 0.01, holes);
  };
  inner('x', b.inZ0 + 0.005, b.inX0, b.inX1, []);
  inner('x', b.inZ1 - 0.005, b.inX0, b.inX1, [[sw.x0, sw.x1, sw.y0, sw.y1]]);
  inner('z', b.inX0 + 0.005, b.inZ0, b.inZ1, []);
  inner('z', b.inX1 - 0.005, b.inZ0, b.inZ1, [[dz.z0, dz.z1, 0, dz.h], [ew.z0, ew.z1, ew.y0, ew.y1]]);
  // 室外：墙裙一圈绿（到 0.9m）
  const oh = 0.9;
  wallPieces(st, dado, 'x', b.z0 - 0.006, b.x0 - 0.006, b.x1 + 0.006, 0, oh, 0.012, []);
  wallPieces(st, dado, 'x', b.z1 + 0.006, b.x0 - 0.006, b.x1 + 0.006, 0, oh, 0.012, []);
  wallPieces(st, dado, 'z', b.x0 - 0.006, b.z0, b.z1, 0, oh, 0.012, []);
  wallPieces(st, dado, 'z', b.x1 + 0.006, b.z0, b.z1, 0, oh, 0.012, [[dz.z0, dz.z1, 0, dz.h]]);
  // 屋里的地（水泥）与天花（石灰）
  st.floor(b.inX0, b.inZ0, b.inX1, b.inZ1, 0.004, MATERIALS.concrete());
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(b.inX1 - b.inX0, b.inZ1 - b.inZ0).rotateX(Math.PI / 2), lime);
  ceil.position.set((b.inX0 + b.inX1) / 2, b.ceil, (b.inZ0 + b.inZ1) / 2);
  st.add(ceil);
  void plaster;
}

function shell(ctx: AreaContext, st: Statics): void {
  const b = BOOTH;
  const plaster = MATERIALS.plaster();
  const concrete = MATERIALS.concrete();
  const tN = b.inZ0 - b.z0, tS = b.z1 - b.inZ1, tW = b.inX0 - b.x0, tE = b.x1 - b.inX1;
  const dz = b.door, ew = b.eastWin, sw = b.southWin;
  wallPieces(st, plaster, 'x', (b.z0 + b.inZ0) / 2, b.x0, b.x1, 0, b.top, tN);
  wallPieces(st, plaster, 'x', (b.z1 + b.inZ1) / 2, b.x0, b.x1, 0, b.top, tS, [[sw.x0, sw.x1, sw.y0, sw.y1]]);
  wallPieces(st, plaster, 'z', (b.x0 + b.inX0) / 2, b.inZ0, b.inZ1, 0, b.top, tW);
  wallPieces(st, plaster, 'z', (b.x1 + b.inX1) / 2, b.inZ0, b.inZ1, 0, b.top, tE, [[dz.z0, dz.z1, 0, dz.h], [ew.z0, ew.z1, ew.y0, ew.y1]]);
  // 屋顶：水泥板，东边（门楣一侧）几乎不出檐，支架淋得着雨
  st.box(b.x1 - b.x0 + 0.34, 0.16, b.z1 - b.z0 + 0.4, concrete, [(b.x0 + b.x1) / 2 - 0.12, b.top + 0.02, (b.z0 + b.z1) / 2]);
  st.box(b.x1 - b.x0 + 0.3, 0.1, 0.06, concrete, [(b.x0 + b.x1) / 2 - 0.12, b.top + 0.14, b.z0 - 0.17]);
  // 门口台阶（≤ STEP_MAX，走得上去）
  st.box(0.66, 0.1, 1.3, concrete, [b.x1 + 0.33, 0.05, (dz.z0 + dz.z1) / 2]);
  // 碰撞：四面墙（门洞处断开）
  const c = ctx.collider;
  c.wall([b.x0, (b.z0 + b.inZ0) / 2], [b.x1, (b.z0 + b.inZ0) / 2], 0, b.top, tN);
  c.wall([b.x0, (b.z1 + b.inZ1) / 2], [b.x1, (b.z1 + b.inZ1) / 2], 0, b.top, tS);
  c.wall([(b.x0 + b.inX0) / 2, b.z0], [(b.x0 + b.inX0) / 2, b.z1], 0, b.top, tW);
  c.wall([(b.x1 + b.inX1) / 2, b.z0], [(b.x1 + b.inX1) / 2, dz.z0], 0, b.top, tE);
  c.wall([(b.x1 + b.inX1) / 2, dz.z1], [(b.x1 + b.inX1) / 2, b.z1], 0, b.top, tE);
  c.box([(b.x0 + b.x1) / 2, b.top + 0.02, (b.z0 + b.z1) / 2], [b.x1 - b.x0 + 0.3, 0.16, b.z1 - b.z0 + 0.4]);
}

function doorAndWindows(ctx: AreaContext, st: Statics): void {
  const b = BOOTH;
  // 木门：装在东墙内侧，合页在北侧，往屋里开到底、贴着门洞北边的内墙（门洞一直敞着）：
  // 从院子里看得见门里的桌子和 CRT 的绿光，门楣上 CH1 机位（朝东南俯拍门口）也看不见门扇（docs/requests/r1-finale.md #6）
  const d = door({ w: 0.9, h: b.door.h, style: 'wood', at: [b.inX1 - 0.015, 0, (b.door.z0 + b.door.z1) / 2], yaw: 90, hinge: 'right' });
  const pivot = d.leaf.children[0];
  // kit 的 setOpen 最多开 95°（门扇横在屋里）；这里直接把合页转到 174°，门扇几乎贴墙
  if (pivot) pivot.rotation.y = -174 * Math.PI / 180;
  else d.setOpen(1);
  st.add(d.group);
  // 贴墙的门扇（挡人，只比内墙多出几厘米）
  ctx.collider.box([b.inX1 - 0.08, 1.0, b.door.z0 - 0.47], [0.1, 2.05, 0.9]);
  const steel = mat('winSteel', { color: '#39403f', roughness: 0.6, metalness: 0.5 });
  const sill = MATERIALS.concrete();
  const glass = MATERIALS.glass();
  // 南窗（桌子上方）
  const sw = b.southWin, swc = (sw.x0 + sw.x1) / 2, swy = (sw.y0 + sw.y1) / 2, sww = sw.x1 - sw.x0, swh = sw.y1 - sw.y0;
  for (const x of [sw.x0 + 0.02, swc, sw.x1 - 0.02]) st.box(0.035, swh, 0.05, steel, [x, swy, b.z1 - 0.05]);
  for (const y of [sw.y0 + 0.02, sw.y0 + swh * 0.6, sw.y1 - 0.02]) st.box(sww, 0.035, 0.05, steel, [swc, y, b.z1 - 0.05]);
  const g1 = new THREE.Mesh(new THREE.PlaneGeometry(sww, swh), glass);
  g1.position.set(swc, swy, b.z1 - 0.05);
  st.add(g1);
  st.box(sww + 0.12, 0.05, 0.22, sill, [swc, sw.y0 - 0.025, b.z1 + 0.06]);
  // 东窗（门南边，窗外就是陆师傅站过的地方）
  const ew = b.eastWin, ewc = (ew.z0 + ew.z1) / 2, ewy = (ew.y0 + ew.y1) / 2, eww = ew.z1 - ew.z0, ewh = ew.y1 - ew.y0;
  for (const z of [ew.z0 + 0.02, ew.z1 - 0.02]) st.box(0.05, ewh, 0.035, steel, [b.x1 - 0.05, ewy, z]);
  for (const y of [ew.y0 + 0.02, ew.y0 + ewh * 0.55, ew.y1 - 0.02]) st.box(0.05, 0.035, eww, steel, [b.x1 - 0.05, y, ewc]);
  const g2 = new THREE.Mesh(new THREE.PlaneGeometry(eww, ewh).rotateY(Math.PI / 2), glass);
  g2.position.set(b.x1 - 0.05, ewy, ewc);
  st.add(g2);
  st.box(0.22, 0.05, eww + 0.1, sill, [b.x1 + 0.05, ew.y0 - 0.025, ewc]);
  // 雨水管（东北角）与檐沟
  const tin = MATERIALS.tin();
  st.cyl(0.045, 0.045, b.top + 0.1, tin, [b.x1 + 0.08, (b.top + 0.1) / 2, b.z0 + 0.1], 8);
  st.box(0.12, 0.08, b.z1 - b.z0 + 0.3, tin, [b.x1 + 0.1, b.top - 0.02, (b.z0 + b.z1) / 2]);
}

/** 桌子（带中间抽屉与四位转轮锁）、椅子、CRT、录像机、插孔、巡夜本等。 */
function deskArea(ctx: AreaContext, st: Statics): Pick<BoothHandles, 'screen' | 'log' | 'logHit' | 'logGlow' | 'drawer' | 'drawerClosedZ' | 'jack' | 'vcr' | 'deskHit'> {
  const d = R1.derived;
  const wood = MATERIALS.wood();
  const dark = mat('deskDark', { color: '#4A3322', roughness: 0.72 });
  const [dx, , dzc] = d.deskBox.center;
  const [dw, dh, dd] = d.deskBox.size;
  const front = dzc - dd / 2;
  // 桌面、左柜（三个小抽屉）、右侧挡板、背板
  st.box(dw, 0.04, dd, wood, [dx, dh - 0.02, dzc]);
  st.box(0.34, dh - 0.04, dd - 0.04, dark, [dx - dw / 2 + 0.19, (dh - 0.04) / 2, dzc]);
  for (let i = 0; i < 3; i++) {
    st.box(0.3, 0.19, 0.02, wood, [dx - dw / 2 + 0.19, 0.12 + i * 0.21, front - 0.005]);
    st.box(0.08, 0.015, 0.02, mat('brassPull', { color: '#8C7438', roughness: 0.55, metalness: 0.6 }), [dx - dw / 2 + 0.19, 0.16 + i * 0.21, front - 0.02]);
  }
  st.box(0.04, dh - 0.04, dd - 0.04, dark, [dx + dw / 2 - 0.03, (dh - 0.04) / 2, dzc]);
  st.box(dw - 0.1, 0.5, 0.02, dark, [dx, dh - 0.3, dzc + dd / 2 - 0.03]);
  st.box(dw - 0.4, 0.13, 0.02, dark, [dx + 0.1, dh - 0.105, front + 0.01]);
  // 碰撞与 r1.desk（不渲染的拾取代理，尺寸 = 桌子；R1-finale 的 use(r1.desk, …) 用它）
  ctx.collider.box(d.deskBox.center, d.deskBox.size);
  const deskHit = new THREE.Mesh(new THREE.BoxGeometry(dw, dh, dd), MATERIALS.hitProxy());
  deskHit.position.set(dx, dh / 2, dzc);
  deskHit.name = 'deskHit';
  ctx.add(deskHit, { ref: OBJ.R1_DESK });

  // 中间抽屉（r1.drawer）：抽屉脸 + 四位转轮锁；打开后往外拉出
  const drawer = new THREE.Group();
  drawer.name = 'drawer';
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.022), wood);
  drawer.add(face);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.4), mat('drawerBox', { color: '#5A3E28', roughness: 0.85 }));
  box.position.set(0, 0, 0.21);
  drawer.add(box);
  const lock = PROPS.drawerLock();
  lock.position.set(0, 0, -0.026);
  drawer.add(lock);
  const drawerClosedZ = front - 0.005;
  drawer.position.set(R1.drawer[0], R1.drawer[1] - 0.04, drawerClosedZ);
  ctx.add(drawer);

  // 椅子（spawn.r1_start 在这儿，不给碰撞）
  st.add(place(PROPS.chair(), R1.chair, 180));

  // CRT：屏幕中心正好在 layout 的 crtScreen（底下垫一块 2cm 的木板）
  const crt = PROPS.crt();
  const cs = d.crtScreen.center;
  // 机壳与屏幕按 kit 的相对位置摆（kit 的前面板 M3 起是开口的框，屏幕不再被埋，docs/requests/r1-finale.md #5）
  crt.group.position.set(cs[0], cs[1] - 0.2, cs[2] + 0.207);
  st.box(0.5, 0.02, 0.46, mat('crtBoard', { color: '#6B4A2E', roughness: 0.8 }), [cs[0], dh + 0.01, cs[2] + 0.2]);
  crt.group.remove(crt.screen);
  st.add(crt.group);
  const screen = crt.screen;
  screen.position.set(cs[0], cs[1], cs[2]);
  screen.name = 'crtScreen';
  ctx.add(screen, { ref: OBJ.R1_CRT });

  // 录像机（ref r1.vcr）；kit 的插孔藏掉，用 layout 的 r1.crt_jack（“视频入1”字样下面）
  const vcr = PROPS.vcr();
  vcr.group.position.set(d.vcrBody.center[0], dh, d.vcrBody.center[2]);
  const kitJack = vcr.group.getObjectByName('vcrJack');
  if (kitJack) kitJack.visible = false;
  ctx.add(vcr.group, { ref: OBJ.R1_VCR });
  // 插孔：插头沿节点本地 −y 插入（ARCH §5.2）→ 本地 −y 指向录像机里（+z）
  const jack = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.014, 10), mat('bnc', { color: '#B8BCC2', roughness: 0.5, metalness: 0.7 }));
  jack.position.set(d.crtJack[0], d.crtJack[1], d.crtJack[2]);
  jack.rotation.x = -Math.PI / 2;
  jack.name = 'crtJack';
  ctx.add(jack, { ref: OBJ.R1_CRT_JACK });

  // 巡夜本：摊开在桌沿，墨迹未干，微微发光（开场“桌上的巡夜本在发光”）
  const logTex = logTexture(ctx);
  // 开场“桌上的巡夜本在发光”（GDD §3.2）：纸面自发光，墨迹未干的那一行在光里（引路光：进屋第一眼就看它）
  const logMat = new THREE.MeshStandardMaterial({ map: logTex, emissive: '#FFF0CC', emissiveMap: logTex, emissiveIntensity: 0.6, roughness: 0.85 });
  logMat.userData.tempC = TEMP_C.paper;
  const log = new THREE.Group();
  log.name = 'log';
  const pages = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.205), [
    mat('logEdge', { color: '#D8D0BC', roughness: 0.9 }), mat('logEdge', { color: '#D8D0BC', roughness: 0.9 }),
    ctx.track(logMat), mat('logCover', { color: '#2C3E5A', roughness: 0.7 }),
    mat('logEdge', { color: '#D8D0BC', roughness: 0.9 }), mat('logEdge', { color: '#D8D0BC', roughness: 0.9 }),
  ]);
  log.add(pages);
  log.position.set(LOG_AT[0], LOG_AT[1], LOG_AT[2]);
  // 字头朝南（背对椅子）：坐在椅子上的人读起来是正的（BoxGeometry 顶面的贴图上沿在 −z）
  log.rotation.y = Math.PI + 0.12;
  ctx.add(log);
  // 拾取代理：比本子高出一截（坐在椅子上时第三人称相机俯仰到头，准星从本子上方掠过也算对准）
  const logHit = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, 0.26), MATERIALS.hitProxy());
  logHit.position.set(LOG_AT[0], LOG_AT[1] + 0.45, LOG_AT[2]);
  logHit.name = 'logHit';
  ctx.add(logHit);
  // 本子四周一圈暖光（加法混合的光环，中间留空：纸面自己微微发光，近看字迹不被光晕盖掉）
  const HALO = { w: 0.66, h: 0.5 };
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(HALO.w, HALO.h).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    color: new THREE.Color('#FFE2A8').multiplyScalar(2.6), alphaMap: paintTexture(132, 100, (g, w, h) => {
      const img = g.createImageData(w, h);
      const bw = (0.3 / HALO.w) * w, bh = (0.205 / HALO.h) * h;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = Math.max(0, Math.abs(x + 0.5 - w / 2) - bw / 2), dy = Math.max(0, Math.abs(y + 0.5 - h / 2) - bh / 2);
        const d = Math.hypot(dx, dy);
        const a = d <= 0 ? 0.06 : 0.85 * Math.exp(-d / 7) * Math.min(1, d / 1.5);
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
      g.putImageData(img, 0, 0);
    }, { mask: true }), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8,
  }));
  halo.rotation.y = 0.12;
  halo.position.set(LOG_AT[0], LOG_AT[1] + 0.012, LOG_AT[2]);
  halo.userData.irHide = true;
  halo.userData.noOcclude = true;
  halo.raycast = () => {};
  halo.renderOrder = 2;
  ctx.add(halo, { occlude: false });

  // 桌上：搪瓷缸、圆珠笔、烟灰缸
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.038, 0.09, 14), mat('mug', { color: '#E9E6DA', roughness: 0.35, metalness: 0.1 }));
  mug.position.set(-6.0, dh + 0.045, 21.3);
  st.add(mug);
  st.cyl(0.043, 0.043, 0.012, mat('mugRim', { color: '#233E7A', roughness: 0.4 }), [-6.0, dh + 0.086, 21.3], 14);
  const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 6).rotateZ(Math.PI / 2), mat('pen', { color: '#1d3a8a', roughness: 0.4 }));
  pen.position.set(-6.2, dh + 0.005, 21.27);
  pen.rotation.y = 0.5;
  st.add(pen);
  st.cyl(0.05, 0.04, 0.02, mat('ashtray', { color: '#3E5B4A', roughness: 0.35, metalness: 0.2 }), [-7.0, dh + 0.01, 21.28], 12);

  return { screen, log, logHit, logGlow: halo, drawer, drawerClosedZ, jack, vcr: vcr.group, deskHit };
}

function northWall(ctx: AreaContext, st: Statics): Pick<BoothHandles, 'mirror' | 'switchLevers' | 'switchHits' | 'switchBoxHit'> {
  // 电闸箱（正面朝南，贴北墙）：铁皮箱体、黑色内衬、往西摊平的箱门（不挡第三人称的准星），四把闸刀单独（按状态上下扳）
  const [bx, by, bz] = SWITCH_BOX_AT;
  const boxM = mat('switchbox', { color: '#8A8F88', roughness: 0.55, metalness: 0.4 });
  const innerM = mat('switchboxInner', { color: '#2d2f2c', roughness: 0.85 });
  const W = 0.46, H = 0.5, D = 0.12, back = bz - D / 2;
  st.box(W, H, 0.02, boxM, [bx, by, back + 0.01]);
  st.box(W - 0.04, H - 0.04, 0.01, innerM, [bx, by, back + 0.025]);
  st.box(0.02, H, D, boxM, [bx - W / 2, by, bz]);
  st.box(0.02, H, D, boxM, [bx + W / 2, by, bz]);
  st.box(W, 0.02, D, boxM, [bx, by + H / 2, bz]);
  st.box(W, 0.02, D, boxM, [bx, by - H / 2, bz]);
  // 箱门：合页在西边，开到贴着墙（门里面刷着一个闪电）
  st.box(W, H, 0.015, boxM, [bx - W / 2 - W / 2 - 0.01, by, back + 0.02]);
  const warn = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.08), new THREE.MeshStandardMaterial({
    map: canvasTex(ctx, 64, 64, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.fillStyle = '#F2C230';
      c.beginPath();
      c.moveTo(w / 2, 2);
      c.lineTo(w - 2, h - 2);
      c.lineTo(2, h - 2);
      c.fill();
      c.fillStyle = '#111';
      c.beginPath();
      c.moveTo(w * 0.56, h * 0.28);
      c.lineTo(w * 0.4, h * 0.62);
      c.lineTo(w * 0.52, h * 0.62);
      c.lineTo(w * 0.44, h * 0.9);
      c.lineTo(w * 0.64, h * 0.52);
      c.lineTo(w * 0.52, h * 0.52);
      c.closePath();
      c.fill();
    }), transparent: true, roughness: 0.6,
  }));
  warn.position.set(bx - W - 0.01, by + 0.12, back + 0.029);
  st.add(warn);
  // 闸刀：底座（米色）+ 摇杆（黑）+ 把手；开关① 在最西边
  const baseM = mat('switchBase', { color: '#E6E0CC', roughness: 0.6 });
  const leverM = mat('switchLever', { color: '#141416', roughness: 0.55, metalness: 0.2 });
  const knobM = mat('switchKnob', { color: '#1a1a1a', roughness: 0.4 });
  const levers: THREE.Object3D[] = [];
  const leverRoot = new THREE.Group();
  leverRoot.name = 'switchLevers';
  SWITCH_AT.forEach((p, k) => {
    st.box(0.06, 0.1, 0.03, baseM, [p[0], by - 0.08, back + 0.045]);
    const sw = new THREE.Group();
    sw.name = `switch${k + 1}`;
    sw.position.set(p[0], by - 0.08, back + 0.06);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.09, 0.015), leverM);
    lever.position.set(0, 0.045, 0);
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.02), knobM);
    knob.position.set(0, 0.09, 0);
    sw.add(lever, knob);
    sw.rotation.x = 0.5;
    leverRoot.add(sw);
    levers.push(sw);
  });
  ctx.add(leverRoot);
  // 四张空白贴条（常光）+ 老周的字（褪字层，只在取景器里显出来）
  // 四张贴条一张图（每格 256×100，与贴条 0.085×0.034 同比例），老周的圆珠笔字
  const labelsTex = canvasTex(ctx, 1024, 100, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = rng(618);
    ['车棚', '公告栏', '门灯', '槐树'].forEach((t, i) => {
      const text = `${'①②③④'[i]}${t}`;
      const size = Math.min(h * 0.62, (w / 4) * 0.86 / [...text].length);
      g.save();
      g.globalAlpha = 0.9;
      drawHandLine(g, r, text, i * (w / 4) + w * 0.012, h * 0.7, size, FADED_INK);
      g.restore();
    });
  });
  const blank = mat('switchLabel', { color: '#E6E0CC', roughness: 0.9 });
  // 褪字层（只在取景器里画）：老周的圆珠笔字在取景器里微微发亮——“拿眼睛看”才显出来的字
  const inkMat = new THREE.MeshBasicMaterial({ map: labelsTex, color: FADED_GLOW, transparent: true, depthWrite: false });
  inkMat.userData.tempC = TEMP_C.paper;
  const inkGeos: THREE.BufferGeometry[] = [];
  const hits: THREE.Mesh[] = [];
  SWITCH_AT.forEach((p, k) => {
    const lx = p[0];
    const labelY = SWITCH_LABELS_AT[1];
    const z = SWITCH_LABELS_AT[2];
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.034), blank);
    paper.position.set(lx, labelY, z);
    st.add(paper);
    const ink = new THREE.PlaneGeometry(0.085, 0.034);
    const uv = ink.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (k + uv.getX(i)) / 4);
    ink.translate(lx, labelY, z + 0.002);
    inkGeos.push(ink);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.13, 0.06), MATERIALS.hitProxy());
    hit.position.set(p[0], p[1], p[2]);
    hit.name = `switchHit${k + 1}`;
    hits.push(ctx.add(hit));
  });
  const inkMesh = new THREE.Mesh(mergeInk(inkGeos), inkMat);
  inkMesh.name = 'switchLabelInk';
  inkMesh.userData.noOcclude = true;
  inkMesh.raycast = () => {};
  ctx.add(inkMesh, { layer: 'faded_text', occlude: false });
  const boxHit = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), MATERIALS.hitProxy());
  boxHit.position.set(SWITCH_BOX_AT[0], SWITCH_BOX_AT[1], SWITCH_BOX_AT[2]);
  boxHit.name = 'switchBoxHit';
  ctx.add(boxHit);

  // 圆镜（老周刮胡子用的）：框与背板合并，镜面单独（MirrorSystem 换反射材质；镜面朝向为局部 +z = 南）
  const mc = R1.mirror.center, rad = R1.mirror.diameter / 2;
  const frame = new THREE.Mesh(new THREE.TorusGeometry(rad + 0.004, 0.016, 8, 40), mat('mirrorFrame', { color: '#C9C2AE', roughness: 0.45 }));
  frame.position.set(mc[0], mc[1], mc[2] + 0.004);
  st.add(frame);
  st.box(rad * 1.8, rad * 1.8, 0.012, mat('mirrorBack', { color: '#3a3530', roughness: 0.8 }), [mc[0], mc[1], mc[2] - 0.012]);
  const mirror = new THREE.Mesh(new THREE.CircleGeometry(rad, 40), mat('mirrorFallback', { color: '#8C9396', roughness: 0.05, metalness: 1 }));
  mirror.position.set(mc[0], mc[1], mc[2] + 0.002);
  mirror.name = 'mirrorSurface';
  ctx.add(mirror, { ref: OBJ.R1_MIRROR });
  // 挂镜子的钉子和绳
  st.cyl(0.006, 0.006, 0.02, mat('nail', { color: '#6b6e72', roughness: 0.6, metalness: 0.5 }), [mc[0], mc[1] + rad + 0.13, R1.mirror.center[2] - 0.01], 6).rotation.x = Math.PI / 2;

  // 脸盆架（镜子下面）：三条腿 + 搪瓷盆 + 毛巾
  const leg = mat('basinStand', { color: '#6E5A44', roughness: 0.7 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.82, 6), leg);
    m.position.set(mc[0] + Math.cos(a) * 0.17, 0.41, 18.84 + Math.sin(a) * 0.17);
    m.rotation.z = Math.cos(a) * 0.08;
    m.rotation.x = -Math.sin(a) * 0.08;
    st.add(m);
  }
  const basinProf = [[0.05, 0], [0.16, 0.02], [0.2, 0.09], [0.205, 0.1], [0.19, 0.1], [0.15, 0.03], [0.001, 0.015]].map(([x, y]) => new THREE.Vector2(x ?? 0, y ?? 0));
  const basin = new THREE.Mesh(new THREE.LatheGeometry(basinProf, 20), mat('basin', { color: '#EEEAE0', roughness: 0.3, metalness: 0.05, side: THREE.DoubleSide }));
  basin.position.set(mc[0], 0.8, 18.84);
  st.add(basin);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.008, 5, 24).rotateX(Math.PI / 2), mat('basinRim', { color: '#233E7A', roughness: 0.35 }));
  rim.position.set(mc[0], 0.9, 18.84);
  st.add(rim);
  const towel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.1), mat('towel', { color: '#C9C3B0', roughness: 0.95 }));
  towel.position.set(mc[0] + 0.1, 0.92, 18.66);
  st.add(towel);
  st.box(0.3, 0.25, 0.012, mat('towel', { color: '#C9C3B0', roughness: 0.95 }), [mc[0] + 0.1, 0.8, 18.62]);
  return { mirror, switchLevers: levers, switchHits: hits, switchBoxHit: boxHit };
}

function mergeInk(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const pos: number[] = [], uv: number[] = [], nor: number[] = [];
  for (const g0 of geos) {
    const g = g0.toNonIndexed();
    const P = g.attributes.position as THREE.BufferAttribute, U = g.attributes.uv as THREE.BufferAttribute, N = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      uv.push(U.getX(i), U.getY(i));
      nor.push(N.getX(i), N.getY(i), N.getZ(i));
    }
    g.dispose();
    g0.dispose();
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}

function westWall(ctx: AreaContext, st: Statics): Pick<BoothHandles, 'tapeRackHit' | 'noticeHit'> {
  // 录像带架：8.1 … 8.29，“8.30”那一格空着（第 30 格）
  const labels = [...Array.from({ length: 29 }, (_, i) => `8.${i + 1}`), ''];
  const rack = PROPS.tapeRack(labels);
  rack.position.set(R1.tapeRack[0] + 0.02, R1.tapeRack[1], R1.tapeRack[2]);
  rack.rotation.y = -Math.PI / 2;
  st.add(rack);
  ctx.collider.box([R1.tapeRack[0] + 0.02, R1.tapeRack[1], R1.tapeRack[2]], [0.22, 0.72, 0.52]);
  const rackHit = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.7, 0.52), MATERIALS.hitProxy());
  rackHit.position.set(R1.tapeRack[0] + 0.02, R1.tapeRack[1], R1.tapeRack[2]);
  ctx.add(rackHit);
  // 《监控调试注意事项》：西墙上一张打印纸（朝东）
  const tex = paperSheet(ctx, { title: CCTV_NOTICE.title, lines: CCTV_NOTICE.lines, sign: CCTV_NOTICE.sign, w: 768, h: 1024, seed: 2004, aged: 0.55, titleSize: 58, bodySize: 36 });
  const notice = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.533), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  notice.position.set(R1.cctvNotice[0] + 0.004, R1.cctvNotice[1], R1.cctvNotice[2]);
  notice.rotation.y = rotPlaneForYaw(90);
  notice.name = 'cctvNotice';
  ctx.add(notice);
  // 墙上：撕页日历（停在 2023-08-30）、挂钟（停了）、雨衣
  const cal = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.25), new THREE.MeshStandardMaterial({ map: calendarTexture(ctx), roughness: 0.9 }));
  cal.position.set(BOOTH.inX0 + 0.012, 1.65, 19.1);
  cal.rotation.y = rotPlaneForYaw(90);
  ctx.add(cal);
  const clockFace = canvasTex(ctx, 128, 128, (g, w, h) => {
    g.fillStyle = '#EDE8D8';
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#222';
    g.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(w / 2 + Math.cos(a) * w * 0.4, h / 2 + Math.sin(a) * h * 0.4);
      g.lineTo(w / 2 + Math.cos(a) * w * 0.46, h / 2 + Math.sin(a) * h * 0.46);
      g.stroke();
    }
    // 停在三点十六分
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(w / 2, h / 2);
    g.lineTo(w / 2 + Math.cos(-Math.PI / 2 + (3.27 / 12) * Math.PI * 2) * w * 0.24, h / 2 + Math.sin(-Math.PI / 2 + (3.27 / 12) * Math.PI * 2) * h * 0.24);
    g.moveTo(w / 2, h / 2);
    g.lineTo(w / 2 + Math.cos(-Math.PI / 2 + (16 / 60) * Math.PI * 2) * w * 0.36, h / 2 + Math.sin(-Math.PI / 2 + (16 / 60) * Math.PI * 2) * h * 0.36);
    g.stroke();
  });
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.13, 24), new THREE.MeshStandardMaterial({ map: clockFace, roughness: 0.5 }));
  clock.position.set(-6.5, 2.18, BOOTH.inZ1 - 0.024);
  clock.rotation.y = Math.PI;
  ctx.add(clock);
  st.cyl(0.14, 0.14, 0.02, mat('clockRim', { color: '#7A2A22', roughness: 0.5 }), [-6.5, 2.18, BOOTH.inZ1 - 0.01], 20).rotation.x = Math.PI / 2;
  // 雨衣挂在门后墙上的钉子
  const coat = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.42), mat('raincoat', { color: '#2F4A3A', roughness: 0.55 }));
  coat.position.set(BOOTH.inX0 + 0.04, 1.35, 19.42);
  st.add(coat);
  const noticeHit = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.55, 0.42), MATERIALS.hitProxy());
  noticeHit.position.set(R1.cctvNotice[0] + 0.02, R1.cctvNotice[1], R1.cctvNotice[2]);
  ctx.add(noticeHit);
  return { tapeRackHit: rackHit, noticeHit };
}

function ceilingAndCorner(ctx: AreaContext, st: Statics): void {
  // CH2 半球摄像头（屋角）与支架
  const c = R1.ch2CamPos;
  st.box(0.14, 0.02, 0.14, mat('ch2Base', { color: '#DAD5C8', roughness: 0.6 }), [c[0] + 0.05, BOOTH.ceil - 0.01, c[2] + 0.05]);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat('ch2Dome', { color: '#1b1d20', roughness: 0.15, metalness: 0.3 }));
  dome.position.set(c[0] + 0.05, BOOTH.ceil - 0.02, c[2] + 0.05);
  st.add(dome);
  // 灭着的吊灯（灯泡坏了）。M4：吊线收短、灯罩提到离地 2.47m 以上——门卫室矮，第三人称相机被压到 2.4m 左右，
  // 原来垂到 2.17m 的灯罩（没有碰撞体）经常横在画面正中偏下，挡住主角和桌面。
  // 灯罩单独成网格、不接受射线：贴着天花板的相机就在它旁边，准星射线从它里面穿出去时不能被它挡住（否则桌上的“视频入1”等瞄不上）
  const shade = new THREE.Group();
  shade.name = 'deadPendant';
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 4), mat('cord', { color: '#111', roughness: 0.8 }));
  cord.position.set(-6.5, BOOTH.ceil - 0.025, 20.1);
  const tin = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.13, 0.08, 14), mat('shadeTin', { color: '#3E5B4A', roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }));
  tin.position.set(-6.5, BOOTH.ceil - 0.09, 20.1);
  for (const m of [cord, tin]) {
    m.raycast = () => {};
    m.userData.noOcclude = true;
    ctx.track(m.geometry);
    shade.add(m);
  }
  ctx.add(shade, { occlude: false });
}

function outside(ctx: AreaContext, st: Statics, decals: DecalAtlas): THREE.Object3D {
  const b = BOOTH;
  // 门楣空支架（ref r1.bracket）：贴东墙、支臂朝东伸出；name 'mount' 是摄像头云台底座；断掉的视频线头垂着
  const bracket = PROPS.bracket();
  bracket.position.set(b.x1 + 0.005, R1.bracket[1], R1.bracket[2]);
  bracket.rotation.y = -Math.PI / 2;
  ctx.add(bracket, { ref: OBJ.R1_BRACKET });
  // “传达室”牌（门南边、东窗上方）
  // 东窗上方一只小灯箱（门卫室自己的电，门灯灭了它还亮着；只有自发光）
  boardSign(ctx, st, { text: '传达室', style: 'lightbox', w: 1.0, h: 0.3, at: [b.x1 + 0.09, 2.24, 21.28], yaw: 90, color: '#8E0A10', bg: '#F2EEE0', glow: 0.85, depth: 0.08 });
  // 电表箱（北墙外）、红圈“拆”（北墙外，冲着院子）、小广告、雨水印
  const meter = mat('meterBox', { color: '#8E948C', roughness: 0.5, metalness: 0.35 });
  st.box(0.36, 0.46, 0.14, meter, [-7.35, 1.75, b.z0 - 0.07]);
  st.box(0.2, 0.12, 0.012, mat('meterGlass', { color: '#1d2427', roughness: 0.15, metalness: 0.2 }), [-7.35, 1.82, b.z0 - 0.145]);
  st.cyl(0.02, 0.02, 1.5, meter, [-7.2, 0.95, b.z0 - 0.04], 6);
  decals.quad(DECAL.meterPlate, [-7.35, 1.6, b.z0 - 0.146], 0.2, 0.2, 0);
  decals.quad(DECAL.chai, [-6.1, 1.65, b.z0 - 0.012], 1.4, 1.4, 0, 4);
  decals.quad(DECAL.postersB, [-7.6, 0.95, b.z0 - 0.013], 0.8, 0.8, 0, -3);
  decals.quad(DECAL.stainStreak, [-6.5, 2.55, b.z0 - 0.011], 2.2, 0.9, 0);
  decals.quad(DECAL.postersA, [b.x0 - 0.012, 1.1, 20.3], 0.9, 0.9, 270, 2);
  decals.quad(DECAL.chaiFaded, [b.x0 - 0.011, 1.8, 21.2], 1.2, 1.2, 270);
  decals.quad(DECAL.stainStreak, [b.x1 + 0.012, 2.55, 21.3], 1.0, 0.8, 90);
  decals.quad(DECAL.oldCouplet, [b.x1 + 0.013, 1.02, 20.2], 1.18, 2.0, 90);
  decals.quad(DECAL.noParking, [b.x1 + 0.012, 0.55, 21.35], 0.5, 0.5, 90);
  // 痰盂（搪瓷，门口）、花盆、墙根的蜂窝煤
  const spit = [[0.001, 0], [0.11, 0.01], [0.13, 0.08], [0.1, 0.16], [0.075, 0.2], [0.11, 0.26], [0.12, 0.27]].map(([x, y]) => new THREE.Vector2(x ?? 0, y ?? 0));
  const spittoon = new THREE.Mesh(new THREE.LatheGeometry(spit, 16), mat('spittoon', { color: '#E8E4D8', roughness: 0.3, metalness: 0.05, side: THREE.DoubleSide }));
  spittoon.position.set(b.x1 + 0.35, 0.1, b.door.z0 - 0.35);
  st.add(spittoon);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.008, 5, 18).rotateX(Math.PI / 2), mat('spitBand', { color: '#B3302A', roughness: 0.35 }));
  band.position.set(b.x1 + 0.35, 0.37, b.door.z0 - 0.35);
  st.add(band);
  return bracket;
}

/** 门卫室全部（外壳、屋里、门口）。 */
export function buildBooth(ctx: AreaContext, st: Statics, decals: DecalAtlas): BoothHandles {
  shell(ctx, st);
  skins(st);
  doorAndWindows(ctx, st);
  const desk = deskArea(ctx, st);
  const north = northWall(ctx, st);
  const west = westWall(ctx, st);
  ceilingAndCorner(ctx, st);
  const bracket = outside(ctx, st, decals);
  // 暖壶（50℃，红外里是一团热；单独挂，不并进静态网格——它的 tempC 与合并桶里的镀铬件不同）
  ctx.add(place(PROPS.thermos(), [-5.5, 0, 21.55], 200), { tempC: TEMP_C.thermos });
  void IDCARD;
  return { ...desk, ...north, ...west, bracket };
}
