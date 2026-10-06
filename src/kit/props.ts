// owner: WP2
// 常用道具（ARCH §10.2），一律低模。
// 约定：原点在道具底面中心（挂墙/悬挂类见各自注释），正面朝 -z（与人偶、门一致；区域用 rotation.y 摆朝向）。
// 静态部件按材质合并（mergeByMaterial）省 draw call；需要单独动的部件（抽屉、开关、镜面、屏幕、插槽、箱盖…）
// 保持独立并在返回值里给出，或者用 name 命名（group.getObjectByName）。

import * as THREE from 'three';
import type { V3 } from '../core/types';
import { PALETTE } from '../data/palette';
import { TEMP_C } from '../data/render';
import { MATERIALS } from '../fx/materials';
import { blotch, grain, paintTexture, shade, waterStain } from './canvas';
import { kitMat, mergeByMaterial, newMat, rod } from './geom';
import { rng, range, pick } from './rng';
import { FONT_STACK } from './text';

export interface PropKit {
  bicycle(seed?: number): THREE.Group;
  clothesLine(len: number, seed?: number): THREE.Group;
  wires(a: V3, b: V3, sag: number, n?: number): THREE.LineSegments;
  crt(): { group: THREE.Group; screen: THREE.Mesh };
  vcr(): { group: THREE.Group; slot: THREE.Object3D };
  desk(o?: { drawer?: boolean }): THREE.Group;
  chair(): THREE.Group;
  thermos(): THREE.Group;
  mirrorRound(d: number): { group: THREE.Group; surface: THREE.Mesh };
  switchBox(n: number): { group: THREE.Group; switches: THREE.Object3D[]; labelSlots: THREE.Object3D[] };
  noticeBoard(w: number, h: number): { group: THREE.Group; slots: THREE.Object3D[] };
  bracket(): THREE.Group;
  brazier(): THREE.Group;
  stoneTable(): THREE.Group;
  mailbox(): THREE.Group;
  busStop(): THREE.Group;
  hoarding(w: number, h: number): THREE.Group;
  kiosk(): THREE.Group;
  stall(seed?: number): THREE.Group;
  lanternPaper(text?: string): THREE.Group;
  trashBin(): THREE.Group;
  tapeRack(labels: readonly string[]): THREE.Group;
  drawerLock(): THREE.Group;
  stool(): THREE.Group;
  easel(): THREE.Group;
  bigCamera(): THREE.Group;
  tlr(): THREE.Group;
  tray(shape: 'square' | 'basin_xi' | 'plate_chipped'): THREE.Group;
  sink(): THREE.Group;
  dryingLine(len: number, clips: number): THREE.Group;
  camphorChest(): THREE.Group;
  tinBox(): THREE.Group;
  stove(): THREE.Group;
}

// ---------------------------------------------------------------- 小工具

function bx(g: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, name?: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (name) m.name = name;
  g.add(m);
  return m;
}

function cy(g: THREE.Object3D, rt: number, rb: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 16, name?: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  if (name) m.name = name;
  g.add(m);
  return m;
}

function rd(g: THREE.Object3D, a: V3, b: V3, r: number, mat: THREE.Material, seg = 6): THREE.Mesh {
  const m = rod(new THREE.Vector3(...a), new THREE.Vector3(...b), r, mat, seg);
  g.add(m);
  return m;
}

/** 把静态部件按材质合并；keep 里的对象（及其子树）原样保留在返回的 group 里。 */
function finish(name: string, statics: THREE.Group, keep: THREE.Object3D[] = []): THREE.Group {
  const out = mergeByMaterial(statics);
  out.name = name;
  for (const k of keep) out.add(k);
  return out;
}

const texCache = new Map<string, THREE.CanvasTexture>();
function tex(key: string, w: number, h: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  let t = texCache.get(key);
  if (!t) {
    t = paintTexture(w, h, paint);
    t.name = `prop.${key}`;
    texCache.set(key, t);
  }
  return t;
}

const M = {
  black: () => kitMat('p.black', { color: '#141416', roughness: 0.55, metalness: 0.2 }),
  rubber: () => kitMat('p.rubber', { color: '#0f0f10', roughness: 0.85 }),
  chrome: () => kitMat('p.chrome', { color: '#B8BCC2', roughness: 0.25, metalness: 0.9 }),
  brass: () => kitMat('p.brass', { color: '#A88A3A', roughness: 0.35, metalness: 0.85 }),
  iron: () => kitMat('p.iron', { color: '#2A2C30', roughness: 0.6, metalness: 0.55 }),
  plasticBeige: () => kitMat('p.beige', { color: '#B9B29E', roughness: 0.55 }),
  cloth: (c: string) => MATERIALS.cloth(c),
};

// ---------------------------------------------------------------- 各道具

function bicycle(seed = 1): THREE.Group {
  const r = rng(seed);
  const paint = kitMat(`bike.${seed % 3}`, { color: pick(r, ['#141414', '#1F3A2A', '#1E2C4A']), roughness: 0.4, metalness: 0.5 });
  const g = new THREE.Group();
  const R = 0.33;
  for (const x of [-0.55, 0.55]) {
    const tire = new THREE.Mesh(new THREE.TorusGeometry(R, 0.018, 6, 28), M.rubber());
    tire.position.set(x, R, 0);
    g.add(tire);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.025, 0.007, 4, 28), M.chrome());
    rim.position.set(x, R, 0);
    g.add(rim);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      rd(g, [x, R, 0], [x + Math.cos(a) * (R - 0.03), R + Math.sin(a) * (R - 0.03), (i % 2 ? 0.01 : -0.01)], 0.0018, M.chrome(), 3);
    }
    cy(g, 0.03, 0.03, 0.08, M.chrome(), x, R, 0, 8).rotation.x = Math.PI / 2;
  }
  // 二八大杠：横梁水平
  const bb: V3 = [0, 0.3, 0], seatTop: V3 = [-0.2, 0.95, 0], head: V3 = [0.42, 0.93, 0];
  rd(g, bb, seatTop, 0.017, paint);
  rd(g, bb, head, 0.018, paint);
  rd(g, [-0.18, 0.9, 0], head, 0.017, paint);
  rd(g, bb, [-0.55, R, 0.04], 0.012, paint);
  rd(g, bb, [-0.55, R, -0.04], 0.012, paint);
  rd(g, seatTop, [-0.55, R, 0.04], 0.011, paint);
  rd(g, seatTop, [-0.55, R, -0.04], 0.011, paint);
  rd(g, head, [0.55, R, 0.04], 0.013, paint);
  rd(g, head, [0.55, R, -0.04], 0.013, paint);
  // 车把、车座、后货架、链罩
  rd(g, head, [0.4, 1.08, 0], 0.014, M.chrome());
  rd(g, [0.36, 1.08, -0.28], [0.36, 1.08, 0.28], 0.012, M.chrome());
  bx(g, 0.24, 0.05, 0.12, M.black(), -0.22, 1.0, 0);
  bx(g, 0.4, 0.015, 0.16, M.chrome(), -0.58, 0.72, 0);
  rd(g, [-0.4, 0.72, 0.06], [-0.55, R, 0.06], 0.008, M.chrome());
  rd(g, [-0.4, 0.72, -0.06], [-0.55, R, -0.06], 0.008, M.chrome());
  bx(g, 0.5, 0.1, 0.02, paint, -0.25, 0.32, 0.06);
  // 铃铛
  cy(g, 0.025, 0.025, 0.02, M.chrome(), 0.37, 1.1, -0.2, 10);
  const out = finish('bicycle', g);
  // 立着的时候车身略歪向撑脚
  out.rotation.x = 0.08;
  return out;
}

function clothesLine(len: number, seed = 1): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  // 衣服贴图集：四种衣物（衬衫、裤子、毛巾、背心），透明底
  const atlas = tex('clothes', 512, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    const cells = [
      { col: '#5B7FA6', draw: (x: number) => { c.fillRect(x + 20, 20, 88, 150); c.fillRect(x + 4, 20, 120, 50); } },
      { col: '#5E5B55', draw: (x: number) => { c.fillRect(x + 24, 12, 80, 40); c.fillRect(x + 24, 12, 36, 220); c.fillRect(x + 68, 12, 36, 220); } },
      { col: '#B8423A', draw: (x: number) => { c.fillRect(x + 14, 10, 100, 180); } },
      { col: '#E6E2D6', draw: (x: number) => { c.fillRect(x + 30, 16, 68, 150); c.clearRect(x + 44, 16, 40, 30); } },
    ];
    cells.forEach((cell, i) => {
      c.fillStyle = cell.col;
      cell.draw(i * 128);
      c.fillStyle = 'rgba(255,255,255,0.18)';
      if (i === 2) for (let y = 30; y < 180; y += 24) c.fillRect(i * 128 + 14, y, 100, 6);
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(i * 128 + 20, 20, 4, 150);
    });
  });
  const mat = kitMat('clothes', { color: 0xffffff, map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 });
  const n = Math.max(2, Math.floor(len / 0.45));
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const cell = Math.floor(r() * 4);
    const hgt = cell === 1 ? 0.8 : 0.55;
    const p = new THREE.PlaneGeometry(0.4, hgt);
    const uv = p.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (cell + uv.getX(k)) / 4, uv.getY(k));
    p.rotateY(range(r, -0.15, 0.15));
    const x = ((i + 0.5) / n) * len;
    const sag = -0.08 * Math.sin((x / len) * Math.PI);
    p.translate(x, sag - hgt / 2, 0);
    geos.push(p);
  }
  for (const p of geos) g.add(new THREE.Mesh(p, mat));
  // 晾衣绳（下垂）
  const pts: number[] = [];
  for (let i = 0; i < 12; i++) {
    const t0 = i / 12, t1 = (i + 1) / 12;
    pts.push(t0 * len, -0.08 * Math.sin(t0 * Math.PI), 0, t1 * len, -0.08 * Math.sin(t1 * Math.PI), 0);
  }
  const line = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: '#1a1a1a' }));
  line.name = 'clothesRope';
  return finish('clothesLine', g, [line]);
}

function wires(a: V3, b: V3, sag: number, n = 12): THREE.LineSegments {
  const pts: number[] = [];
  const P = (t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
  for (let i = 0; i < n; i++) pts.push(...P(i / n), ...P((i + 1) / n));
  const l = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: '#0d0d0f' }));
  l.name = 'wires';
  l.userData.noOcclude = true;
  return l;
}

/** 监控 CRT：屏幕 0.36×0.27（R1 layout 的尺寸），略带弧面；屏幕中心在 (0, 0.2, -0.2)。 */
function crt(): { group: THREE.Group; screen: THREE.Mesh } {
  const g = new THREE.Group();
  const caseMat = kitMat('crt.case', { color: '#6E716C', roughness: 0.55, metalness: 0.15 });
  const bezel = kitMat('crt.bezel', { color: '#1d1e20', roughness: 0.6 });
  // 机壳：前 0.44×0.36，往后收成 0.3×0.26 的屁股
  const body = new THREE.BoxGeometry(1, 1, 1);
  const p = body.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const back = p.getZ(i) > 0;
    p.setXYZ(i, p.getX(i) * (back ? 0.3 : 0.44), p.getY(i) * (back ? 0.26 : 0.36) + 0.2 - (back ? 0.02 : 0), p.getZ(i) * 0.4);
  }
  body.computeVertexNormals();
  g.add(new THREE.Mesh(body, caseMat));
  // 前面板是一圈框（中间开 0.36×0.27 的口，正好是屏幕）：原来是一整块板，正面在屏幕平面前 8mm，
  // 屏幕四周被埋、只剩中间鼓出来的八边形（M3，docs/requests/r1-finale.md #5）
  bx(g, 0.42, 0.03, 0.02, bezel, 0, 0.2 + 0.15, -0.205);
  bx(g, 0.42, 0.03, 0.02, bezel, 0, 0.2 - 0.15, -0.205);
  bx(g, 0.03, 0.27, 0.02, bezel, 0.195, 0.2, -0.205);
  bx(g, 0.03, 0.27, 0.02, bezel, -0.195, 0.2, -0.205);
  // 旋钮、电源灯、标签
  for (let i = 0; i < 3; i++) cy(g, 0.012, 0.012, 0.02, M.black(), 0.13 + i * 0.03, 0.05, -0.215, 10).rotation.x = Math.PI / 2;
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 6), MATERIALS.emissive(PALETTE.OSD, 2));
  led.position.set(-0.17, 0.05, -0.216);
  g.add(led);
  bx(g, 0.34, 0.04, 0.3, caseMat, 0, 0.02, 0);
  const screenGeo = new THREE.PlaneGeometry(0.36, 0.27, 8, 6);
  const sp = screenGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i) / 0.18, y = sp.getY(i) / 0.135;
    sp.setZ(i, 0.012 * (1 - 0.5 * (x * x + y * y)));
  }
  screenGeo.computeVertexNormals();
  screenGeo.rotateY(Math.PI);
  const screen = new THREE.Mesh(screenGeo, MATERIALS.crtScreen());
  screen.name = 'crtScreen';
  screen.position.set(0, 0.2, -0.207);
  const out = finish('crt', g, [screen]);
  out.userData.screenCenter = [0, 0.2, -0.207] as V3;
  return { group: out, screen };
}

/** 录像机：正面朝 -z；slot = 进带口；userData.jack = “视频入1”插孔（R1 的 r1.crt_jack）。 */
function vcr(): { group: THREE.Group; slot: THREE.Object3D } {
  const g = new THREE.Group();
  const top = kitMat('vcr.body', { color: '#1c1c1f', roughness: 0.5, metalness: 0.3 });
  const front = tex('vcrFront', 512, 128, (c, w, h) => {
    c.fillStyle = '#9A9DA2';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#16171a';
    c.fillRect(w * 0.08, h * 0.25, w * 0.42, h * 0.3);
    c.fillStyle = '#0a1a10';
    c.fillRect(w * 0.58, h * 0.2, w * 0.2, h * 0.28);
    c.fillStyle = PALETTE.OSD;
    c.font = `bold ${Math.round(h * 0.22)}px monospace`;
    c.fillText('-:--', w * 0.61, h * 0.42);
    c.fillStyle = '#222';
    for (let i = 0; i < 6; i++) c.fillRect(w * (0.08 + i * 0.07), h * 0.68, w * 0.05, h * 0.12);
    c.fillStyle = '#111';
    c.font = `${Math.round(h * 0.12)}px ${FONT_STACK}`;
    c.fillText('视频入1', w * 0.84, h * 0.82);
    c.fillText('VIDEO IN 1', w * 0.82, h * 0.95);
    c.fillText('长时间录像机', w * 0.08, h * 0.16);
  });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.095, 0.3).translate(0, 0.0475, 0), top));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.43, 0.095), kitMat('vcr.front', { color: 0xffffff, map: front, roughness: 0.4, metalness: 0.3 }));
  face.rotation.y = Math.PI;
  face.position.set(0, 0.0475, -0.1505);
  g.add(face);
  const slot = new THREE.Object3D();
  slot.name = 'vcrSlot';
  slot.position.set(0.075, 0.06, -0.152);
  const jack = cy(new THREE.Group(), 0.006, 0.006, 0.012, M.chrome(), -0.19, 0.03, -0.155, 10);
  jack.rotation.x = Math.PI / 2;
  jack.name = 'vcrJack';
  const out = finish('vcr', g, [slot, jack]);
  out.userData.jack = jack;
  return { group: out, slot };
}

/** 旧写字台：1.2×0.76×0.6；drawer 时右侧有抽屉（name 'drawer'，可沿 -z 拉出）。 */
function desk(o?: { drawer?: boolean }): THREE.Group {
  const g = new THREE.Group();
  const wood = MATERIALS.wood();
  const dark = kitMat('desk.dark', { color: '#4A3322', roughness: 0.7 });
  bx(g, 1.2, 0.04, 0.6, wood, 0, 0.74, 0);
  bx(g, 0.04, 0.72, 0.56, dark, -0.58, 0.36, 0);
  bx(g, 0.4, 0.72, 0.56, dark, 0.38, 0.36, 0);
  bx(g, 1.12, 0.3, 0.02, dark, 0, 0.55, 0.27);
  // 右侧柜门
  bx(g, 0.36, 0.4, 0.02, wood, 0.38, 0.26, -0.29);
  bx(g, 0.03, 0.08, 0.015, M.brass(), 0.25, 0.3, -0.305);
  const keep: THREE.Object3D[] = [];
  if (o?.drawer) {
    const drawer = new THREE.Group();
    drawer.name = 'drawer';
    bx(drawer, 0.36, 0.16, 0.5, kitMat('desk.drawerBox', { color: '#5A3E28', roughness: 0.8 }), 0, 0, 0.02);
    bx(drawer, 0.37, 0.17, 0.02, wood, 0, 0, -0.24);
    bx(drawer, 0.1, 0.018, 0.02, M.brass(), 0, 0.03, -0.255);
    drawer.position.set(0.38, 0.6, 0);
    keep.push(mergeByMaterial(drawer));
    keep[0]!.name = 'drawer';
  } else bx(g, 0.37, 0.17, 0.02, wood, 0.38, 0.6, -0.29);
  return finish('desk', g, keep);
}

function chair(): THREE.Group {
  const g = new THREE.Group();
  const wood = MATERIALS.wood();
  bx(g, 0.44, 0.03, 0.42, wood, 0, 0.45, 0);
  for (const [x, z] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]] as const) bx(g, 0.035, 0.45, 0.035, wood, x, 0.225, z);
  for (const x of [-0.19, 0.19]) bx(g, 0.035, 0.5, 0.035, wood, x, 0.7, 0.19);
  for (const y of [0.62, 0.8, 0.93]) bx(g, 0.4, 0.05, 0.02, wood, 0, y, 0.19);
  bx(g, 0.38, 0.02, 0.02, wood, 0, 0.15, -0.18);
  return finish('chair', g);
}

function thermos(): THREE.Group {
  const g = new THREE.Group();
  const shell = tex('thermos', 256, 128, (c, w, h) => {
    c.fillStyle = '#B8322A';
    c.fillRect(0, 0, w, h);
    const r = rng(50);
    for (let i = 0; i < 26; i++) {
      c.fillStyle = r() < 0.5 ? '#F2D46A' : '#EDE6D6';
      const x = r() * w, y = range(r, 0.15, 0.85) * h;
      for (let k = 0; k < 5; k++) {
        c.beginPath();
        c.arc(x + Math.cos(k * 1.26) * 4, y + Math.sin(k * 1.26) * 4, 3, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.fillStyle = '#E8C04A';
    c.fillRect(0, 0, w, 6);
    c.fillRect(0, h - 6, w, 6);
  });
  const shellMat = kitMat('thermos.shell', { color: 0xffffff, map: shell, roughness: 0.35, metalness: 0.3, tempC: TEMP_C.thermos });
  cy(g, 0.07, 0.072, 0.3, shellMat, 0, 0.17, 0, 18);
  cy(g, 0.075, 0.075, 0.02, M.chrome(), 0, 0.01, 0, 18);
  cy(g, 0.045, 0.065, 0.05, M.chrome(), 0, 0.345, 0, 16);
  cy(g, 0.028, 0.03, 0.04, kitMat('thermos.cork', { color: '#C9A878', roughness: 0.9 }), 0, 0.385, 0, 10);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 5, 12, Math.PI), M.chrome());
  handle.rotation.set(0, 0, -Math.PI / 2);
  handle.position.set(0.07, 0.2, 0);
  g.add(handle);
  const out = finish('thermos', g);
  out.userData.tempC = TEMP_C.thermos;
  out.traverse(o => { o.userData.tempC = TEMP_C.thermos; });
  return out;
}

/** 圆镜：原点在镜面中心，镜面朝 -z（与其他道具一致；R1 挂在北墙上照南面时转 180°）；surface 交给 MirrorSystem 换反射材质。 */
function mirrorRound(d: number): { group: THREE.Group; surface: THREE.Mesh } {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.TorusGeometry(d / 2, 0.018, 8, 40), kitMat('mirror.frame', { color: '#C9C2AE', roughness: 0.4 }));
  g.add(frame);
  bx(g, d * 0.9, d * 0.9, 0.01, kitMat('mirror.back', { color: '#3a3530', roughness: 0.8 }), 0, 0, 0.012);
  const geo = new THREE.CircleGeometry(d / 2 - 0.004, 40);
  geo.rotateY(Math.PI);
  const surface = new THREE.Mesh(geo, newMat({ color: '#8C9396', roughness: 0.04, metalness: 1, envMapIntensity: 1.5 }));
  surface.name = 'mirrorSurface';
  surface.position.z = -0.004;
  // 挂绳与钉子
  rd(g, [-d * 0.3, d * 0.45, 0.005], [0, d * 0.75, 0.01], 0.002, M.black(), 3);
  rd(g, [d * 0.3, d * 0.45, 0.005], [0, d * 0.75, 0.01], 0.002, M.black(), 3);
  return { group: finish('mirrorRound', g, [surface]), surface };
}

/** 电闸箱：原点在箱子中心，正面朝 -z；箱门往左开着；switches 是各把闸刀的转轴（绕 x 转），labelSlots 是每把闸刀上方贴条的位置（贴平面朝 -z）。 */
function switchBox(n: number): { group: THREE.Group; switches: THREE.Object3D[]; labelSlots: THREE.Object3D[] } {
  const g = new THREE.Group();
  const w = Math.max(0.3, 0.1 * n + 0.1);
  const box = kitMat('switchbox', { color: '#8A8F88', roughness: 0.5, metalness: 0.4 });
  const inner = kitMat('switchbox.inner', { color: '#2d2f2c', roughness: 0.8 });
  bx(g, w, 0.46, 0.02, box, 0, 0, 0.06);
  bx(g, 0.02, 0.46, 0.12, box, -w / 2, 0, 0);
  bx(g, 0.02, 0.46, 0.12, box, w / 2, 0, 0);
  bx(g, w, 0.02, 0.12, box, 0, 0.23, 0);
  bx(g, w, 0.02, 0.12, box, 0, -0.23, 0);
  bx(g, w - 0.04, 0.42, 0.01, inner, 0, 0, 0.045);
  // 打开的箱门（合页在左）
  const doorG = new THREE.Group();
  bx(doorG, w, 0.46, 0.015, box, w / 2, 0, 0);
  doorG.position.set(-w / 2, 0, -0.06);
  doorG.rotation.y = 1.9;
  g.add(doorG);
  // 闪电警示
  const warn = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.07), kitMat('switchbox.warn', {
    color: 0xffffff, map: tex('warnSign', 64, 64, (c, ww, hh) => {
      c.fillStyle = '#F2C230';
      c.beginPath();
      c.moveTo(ww / 2, 2);
      c.lineTo(ww - 2, hh - 2);
      c.lineTo(2, hh - 2);
      c.fill();
      c.fillStyle = '#111';
      c.font = `bold ${hh * 0.5}px ${FONT_STACK}`;
      c.textAlign = 'center';
      c.fillText('⚡', ww / 2, hh * 0.85);
    }), roughness: 0.6,
  }));
  warn.rotation.y = Math.PI;
  warn.position.set(w / 2 - 0.06, 0.17, 0.035);
  g.add(warn);
  const switches: THREE.Object3D[] = [], labelSlots: THREE.Object3D[] = [];
  const keep: THREE.Object3D[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.1;
    const base = new THREE.Group();
    bx(base, 0.06, 0.1, 0.03, kitMat('switch.base', { color: '#E6E0CC', roughness: 0.6 }), 0, 0, 0);
    base.position.set(x, -0.08, 0.025);
    const sw = new THREE.Group();
    sw.name = `switch${i + 1}`;
    sw.position.set(x, -0.08, 0.005);
    const lever = bx(sw, 0.015, 0.09, 0.015, M.black(), 0, 0.045, 0);
    lever.name = 'lever';
    bx(sw, 0.04, 0.02, 0.02, kitMat('switch.knob', { color: '#1a1a1a', roughness: 0.4 }), 0, 0.09, 0);
    sw.rotation.x = 0.5;
    const slot = new THREE.Object3D();
    slot.name = `labelSlot${i + 1}`;
    slot.position.set(x, 0.09, 0.037);
    slot.rotation.y = Math.PI;
    keep.push(mergeByMaterial(base), sw, slot);
    switches.push(sw);
    labelSlots.push(slot);
  }
  const out = finish('switchBox', g, keep);
  return { group: out, switches, labelSlots };
}

/** 公告栏：立在地上，板面中心 1.5m，正面朝 -z；slots 是贴纸的位置（3 列 × 2 行，贴平面朝 -z）。 */
function noticeBoard(w: number, h: number): { group: THREE.Group; slots: THREE.Object3D[] } {
  const g = new THREE.Group();
  const frame = kitMat('notice.frame', { color: '#2F4B3A', roughness: 0.55, metalness: 0.3 });
  const cy0 = 1.5;
  bx(g, w + 0.1, h + 0.1, 0.06, frame, 0, cy0, 0);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), kitMat('notice.board', {
    color: 0xffffff, map: tex('noticeBoard', 256, 128, (c, ww, hh) => {
      c.fillStyle = '#6E5A3E';
      c.fillRect(0, 0, ww, hh);
      grain(c, ww, hh, 0.4, 3);
      const r = rng(4);
      for (let i = 0; i < 20; i++) {
        c.fillStyle = `rgba(230,225,210,${range(r, 0.2, 0.5)})`;
        c.fillRect(r() * ww, r() * hh, range(r, 6, 20), range(r, 4, 12));
      }
    }), roughness: 0.9,
  }));
  board.rotation.y = Math.PI;
  board.position.set(0, cy0, -0.031);
  g.add(board);
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) bx(g, 0.07, cy0 - h / 2, 0.07, frame, x, (cy0 - h / 2) / 2, 0.04);
  // 小雨棚
  bx(g, w + 0.3, 0.03, 0.35, frame, 0, cy0 + h / 2 + 0.12, -0.12).rotation.x = -0.25;
  const slots: THREE.Object3D[] = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const s = new THREE.Object3D();
      s.name = `slot${row * 3 + col}`;
      s.position.set((col - 1) * (w / 3), cy0 + (0.5 - row) * (h / 2), -0.034);
      s.rotation.y = Math.PI;
      slots.push(s);
    }
  }
  return { group: finish('noticeBoard', g, slots), slots };
}

/**
 * 门楣上的空支架：原点在贴墙的底板中心，墙在 +z 侧，支臂往 -z 伸出 0.28m；
 * name 'mount' 的节点是摄像头云台底座的安装点（三脚架模式把头挂在这里，朝 -z）；还有一截断了的视频线头垂着。
 */
function bracket(): THREE.Group {
  const g = new THREE.Group();
  const metal = kitMat('bracket', { color: '#C9C4B6', roughness: 0.45, metalness: 0.4 });
  bx(g, 0.12, 0.16, 0.012, metal, 0, 0, 0);
  for (const [x, y] of [[-0.04, 0.055], [0.04, 0.055], [-0.04, -0.055], [0.04, -0.055]] as const) cy(g, 0.008, 0.008, 0.012, M.chrome(), x, y, -0.008, 6).rotation.x = Math.PI / 2;
  // L 形支臂：先水平伸出，再往上一截
  bx(g, 0.035, 0.035, 0.26, metal, 0, 0, -0.13);
  bx(g, 0.035, 0.08, 0.035, metal, 0, 0.04, -0.26);
  cy(g, 0.036, 0.036, 0.012, metal, 0, 0.085, -0.26, 14);
  rd(g, [0, -0.015, -0.02], [0, 0.03, -0.24], 0.008, metal);
  const mount = new THREE.Object3D();
  mount.name = 'mount';
  mount.position.set(0, 0.091 + 0.016, -0.26);
  // 断掉的视频线头：从支臂根部垂下来一截，末端是剪断的铜芯
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0.02, -0.01, -0.03), new THREE.Vector3(0.03, -0.12, -0.05), new THREE.Vector3(0.02, -0.26, -0.04), new THREE.Vector3(0.035, -0.34, -0.06)]);
  const stub = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.0068, 6), M.rubber());
  stub.name = 'cableStub';
  g.add(stub);
  cy(g, 0.004, 0.004, 0.02, kitMat('copper', { color: '#C07A3A', metalness: 0.9, roughness: 0.3 }), 0.035, -0.355, -0.06, 5);
  return finish('bracket', g, [mount]);
}

function brazier(): THREE.Group {
  const g = new THREE.Group();
  const iron = M.iron();
  const prof = [[0.2, 0.3], [0.26, 0.42], [0.3, 0.5], [0.285, 0.5], [0.245, 0.42], [0.19, 0.31]].map(([x, y]) => new THREE.Vector2(x ?? 0, y ?? 0));
  const basin = new THREE.Mesh(new THREE.LatheGeometry(prof, 20), kitMat('brazier.iron', { color: '#2A2522', roughness: 0.7, metalness: 0.5, side: THREE.DoubleSide }));
  g.add(basin);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    rd(g, [Math.cos(a) * 0.2, 0.32, Math.sin(a) * 0.2], [Math.cos(a) * 0.28, 0, Math.sin(a) * 0.28], 0.015, iron);
  }
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.25, 20).rotateX(-Math.PI / 2), kitMat('brazier.ash', {
    color: 0xffffff, roughness: 1,
    map: tex('ash', 128, 128, (c, w, h) => {
      c.fillStyle = '#3d3a37';
      c.fillRect(0, 0, w, h);
      const r = rng(9);
      for (let i = 0; i < 40; i++) blotch(c, r, r() * w, r() * h, range(r, 4, 12), r() < 0.2 ? '#8a3a12' : '#6d6a64', 0.5, 3);
    }),
    emissive: '#FF6A2A', emissiveIntensity: 0.25,
  }));
  ash.position.y = 0.45;
  g.add(ash);
  return finish('brazier', g);
}

function stoneTable(): THREE.Group {
  const g = new THREE.Group();
  const stone = kitMat('stone', {
    color: 0xffffff, roughness: 0.85,
    map: tex('granite', 256, 256, (c, w, h) => {
      c.fillStyle = '#8A8A86';
      c.fillRect(0, 0, w, h);
      const r = rng(21);
      for (let i = 0; i < 4000; i++) {
        const v = Math.round(range(r, 60, 180));
        c.fillStyle = `rgb(${v},${v},${v - 4})`;
        c.fillRect(r() * w, r() * h, 2, 2);
      }
      for (let i = 0; i < 8; i++) blotch(c, r, r() * w, r() * h, range(r, 10, 30), '#4a5a3a', 0.25, 4);
    }),
  });
  cy(g, 0.5, 0.5, 0.08, stone, 0, 0.76, 0, 24);
  cy(g, 0.14, 0.2, 0.72, stone, 0, 0.36, 0, 12);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.42, 12), stone);
    s.position.set(Math.cos(a) * 0.85, 0.21, Math.sin(a) * 0.85);
    s.scale.set(1, 1, 1);
    g.add(s);
  }
  return finish('stoneTable', g);
}

function mailbox(): THREE.Group {
  const g = new THREE.Group();
  const green = kitMat('mailbox', {
    color: 0xffffff, roughness: 0.45, metalness: 0.3,
    map: tex('mailbox', 256, 256, (c, w, h) => {
      c.fillStyle = '#1F6B3A';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#E8C04A';
      c.font = `bold ${Math.round(h * 0.13)}px ${FONT_STACK}`;
      c.textAlign = 'center';
      c.fillText('中国邮政', w * 0.5, h * 0.35);
      c.fillStyle = '#111';
      c.fillRect(w * 0.38, h * 0.45, w * 0.24, h * 0.04);
      const r = rng(2);
      for (let i = 0; i < 10; i++) blotch(c, r, r() * w, range(r, 0.6, 1) * h, range(r, 4, 10), '#6b3a1a', 0.3, 3);
    }),
  });
  cy(g, 0.24, 0.24, 0.95, green, 0, 0.6, 0, 20).rotation.y = Math.PI / 2;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), kitMat('mailbox.plain', { color: '#1F6B3A', roughness: 0.45, metalness: 0.3 }));
  dome.position.y = 1.075;
  dome.scale.y = 0.45;
  g.add(dome);
  cy(g, 0.26, 0.28, 0.12, M.iron(), 0, 0.06, 0, 20);
  return finish('mailbox', g);
}

function busStop(): THREE.Group {
  const g = new THREE.Group();
  const steel = kitMat('busstop.steel', { color: '#5E6670', roughness: 0.4, metalness: 0.6 });
  for (const x of [-1.4, 1.4]) bx(g, 0.08, 2.5, 0.08, steel, x, 1.25, 0.3);
  bx(g, 3.2, 0.08, 1.2, kitMat('busstop.roof', { color: '#2E5A8A', roughness: 0.5 }), 0, 2.54, 0);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.6), MATERIALS.glass());
  back.position.set(0, 1.3, 0.34);
  back.userData.noOcclude = true;
  g.add(back);
  bx(g, 2.0, 0.05, 0.35, steel, 0, 0.48, 0.15);
  for (const x of [-0.8, 0.8]) bx(g, 0.05, 0.46, 0.05, steel, x, 0.23, 0.15);
  // 站牌
  bx(g, 0.06, 2.6, 0.06, steel, 1.75, 1.3, -0.3);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), kitMat('busstop.board', {
    color: 0xffffff, roughness: 0.6,
    map: tex('busBoard', 128, 192, (c, w, h) => {
      c.fillStyle = '#F2EFE6';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#2E5A8A';
      c.fillRect(0, 0, w, h * 0.22);
      c.fillStyle = '#fff';
      c.font = `bold ${Math.round(h * 0.12)}px ${FONT_STACK}`;
      c.textAlign = 'center';
      c.fillText('公交站', w / 2, h * 0.15);
      c.fillStyle = '#222';
      c.font = `${Math.round(h * 0.07)}px ${FONT_STACK}`;
      ['老街', '人民路', '机床厂', '火车站'].forEach((t, i) => c.fillText(t, w / 2, h * (0.35 + i * 0.12)));
    }),
  }));
  board.rotation.y = Math.PI;
  board.position.set(1.75, 2.2, -0.34);
  g.add(board);
  return finish('busStop', g);
}

function hoarding(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const t = tex('hoarding', 512, 256, (c, ww, hh) => {
    c.fillStyle = '#1E4C8C';
    c.fillRect(0, 0, ww, hh);
    for (let x = 0; x < ww; x += 16) {
      c.fillStyle = 'rgba(255,255,255,0.08)';
      c.fillRect(x, 0, 6, hh);
    }
    c.fillStyle = '#EDEDE8';
    c.fillRect(0, hh * 0.35, ww, hh * 0.3);
    c.fillStyle = '#1E4C8C';
    c.font = `bold ${Math.round(hh * 0.18)}px ${FONT_STACK}`;
    c.textAlign = 'center';
    c.fillText('施工重地  闲人免进', ww / 2, hh * 0.56);
    const r = rng(8);
    for (let i = 0; i < 16; i++) blotch(c, r, r() * ww, range(r, 0.7, 1) * hh, range(r, 6, 20), '#3a3020', 0.3, 4);
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), kitMat('hoarding', { color: 0xffffff, map: t, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide }));
  panel.rotation.y = Math.PI; // 字面朝 -z
  panel.position.y = h / 2;
  g.add(panel);
  const post = kitMat('hoarding.post', { color: '#5a5d62', roughness: 0.5, metalness: 0.5 });
  for (let x = -w / 2; x <= w / 2 + 1e-3; x += Math.max(1.5, w / Math.ceil(w / 2.5))) bx(g, 0.06, h + 0.1, 0.06, post, x, (h + 0.1) / 2, 0.05);
  return finish('hoarding', g);
}

function kiosk(): THREE.Group {
  const g = new THREE.Group();
  const green = kitMat('kiosk', { color: '#2E6B48', roughness: 0.5, metalness: 0.3 });
  bx(g, 2.0, 2.3, 1.5, green, 0, 1.15, 0);
  bx(g, 2.3, 0.08, 1.9, green, 0, 2.34, -0.1);
  const shutter = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.2), kitMat('kiosk.shutter', {
    color: 0xffffff, roughness: 0.5, metalness: 0.4,
    map: tex('shutter', 128, 128, (c, w, h) => {
      c.fillStyle = '#9A9DA2';
      c.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 8) {
        c.fillStyle = '#6E7176';
        c.fillRect(0, y, w, 2);
      }
      const r = rng(6);
      for (let i = 0; i < 6; i++) blotch(c, r, r() * w, r() * h, range(r, 4, 12), '#7a4a2a', 0.3, 3);
    }),
  }));
  shutter.rotation.y = Math.PI;
  shutter.position.set(0, 1.35, -0.751);
  g.add(shutter);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.3), kitMat('kiosk.sign', {
    color: 0xffffff, roughness: 0.7,
    map: tex('kioskSign', 256, 64, (c, w, h) => {
      c.fillStyle = '#B8322A';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#F2EFE6';
      c.font = `bold ${Math.round(h * 0.6)}px ${FONT_STACK}`;
      c.textAlign = 'center';
      c.fillText('报  刊', w / 2, h * 0.75);
    }),
  }));
  sign.rotation.y = Math.PI;
  sign.position.set(0, 2.1, -0.752);
  g.add(sign);
  return finish('kiosk', g);
}

/** 鬼市摊子：矮桌、黑布、纸钱、纸扎小楼、香；按 seed 摆法不同。 */
function stall(seed = 1): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const wood = MATERIALS.wood();
  bx(g, 1.3, 0.04, 0.6, wood, 0, 0.62, 0);
  for (const [x, z] of [[-0.6, -0.25], [0.6, -0.25], [-0.6, 0.25], [0.6, 0.25]] as const) bx(g, 0.04, 0.6, 0.04, wood, x, 0.3, z);
  const cloth = kitMat('stall.cloth', { color: '#1B1B22', roughness: 1, side: THREE.DoubleSide });
  bx(g, 1.34, 0.4, 0.005, cloth, 0, 0.44, -0.305);
  bx(g, 1.34, 0.01, 0.62, cloth, 0, 0.645, 0);
  const paper = kitMat('stall.joss', { color: '#E8C04A', roughness: 0.9 });
  const white = kitMat('stall.white', { color: PALETTE.PAPER, roughness: 0.95 });
  const red = kitMat('stall.red', { color: '#B01818', roughness: 0.9 });
  for (let i = 0; i < 4; i++) {
    const x = range(r, -0.5, 0.5), z = range(r, -0.2, 0.2), hgt = range(r, 0.04, 0.12);
    bx(g, 0.16, hgt, 0.09, r() < 0.6 ? paper : white, x, 0.65 + hgt / 2, z);
  }
  // 纸扎小楼
  const hx = range(r, -0.4, 0.4);
  bx(g, 0.2, 0.18, 0.16, white, hx, 0.74, 0.1);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.1, 4), red);
  roof.position.set(hx, 0.88, 0.1);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  // 一把香
  for (let i = 0; i < 5; i++) rd(g, [0.5 + i * 0.01, 0.65, -0.1], [0.5 + i * 0.015, 0.95, -0.08], 0.003, red, 3);
  return finish(`stall`, g);
}

/** 白纸灯笼：原点在挂点，灯笼挂在下方；竖排字朝 -z。灯罩 emissive（阴火的 6℃ 由区域写 tempC）。 */
function lanternPaper(text?: string): THREE.Group {
  const g = new THREE.Group();
  const key = `lanternPaper.${text ?? ''}`;
  const t = tex(key, 256, 256, (c, w, h) => {
    c.fillStyle = PALETTE.LANTERN;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(120,100,70,0.35)';
    for (let x = 0; x < w; x += 12) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    if (text) {
      c.fillStyle = '#141414';
      const chars = [...text];
      const size = Math.min(40, (h * 0.8) / chars.length);
      c.font = `bold ${Math.round(size)}px ${FONT_STACK}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      chars.forEach((ch, i) => c.fillText(ch, w * 0.5, h * 0.1 + size * (i + 0.5)));
    }
  });
  const prof = [[0.001, 0.2], [0.12, 0.19], [0.18, 0.1], [0.19, 0], [0.18, -0.1], [0.12, -0.19], [0.001, -0.2]].map(([x, y]) => new THREE.Vector2(x ?? 0, y ?? 0));
  const geo = new THREE.LatheGeometry(prof, 18);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), 1 - uv.getY(i));
  const glowMat = newMat({ color: '#ffffff', map: t, emissive: PALETTE.LANTERN, emissiveMap: t, emissiveIntensity: 1.4, roughness: 0.9, side: THREE.DoubleSide, tempC: TEMP_C.lamp });
  const body = new THREE.Mesh(geo, glowMat);
  body.name = 'lanternBody';
  body.position.y = -0.35;
  const cap = kitMat('lantern.black', { color: '#1a1714', roughness: 0.8 });
  cy(g, 0.07, 0.09, 0.04, cap, 0, -0.13, 0, 10);
  cy(g, 0.09, 0.07, 0.04, cap, 0, -0.57, 0, 10);
  rd(g, [0, 0, 0], [0, -0.11, 0], 0.004, cap, 4);
  return finish('lanternPaper', g, [body]);
}

function trashBin(): THREE.Group {
  const g = new THREE.Group();
  const green = kitMat('trashbin', { color: '#2F6B3A', roughness: 0.55 });
  cy(g, 0.26, 0.22, 0.85, green, 0, 0.425, 0, 16);
  cy(g, 0.28, 0.28, 0.05, kitMat('trashbin.lid', { color: '#245630', roughness: 0.5 }), 0, 0.875, 0, 16);
  bx(g, 0.2, 0.08, 0.02, M.black(), 0, 0.72, -0.25);
  return finish('trashBin', g);
}

/** 录像带架：三层 × 10 格，label 为空串 = 空格；带子侧面朝 -z，贴着标签。原点在架子中心。 */
function tapeRack(labels: readonly string[]): THREE.Group {
  const g = new THREE.Group();
  const wood = MATERIALS.wood();
  const cols = 10, rows = Math.max(1, Math.ceil(labels.length / cols));
  const W = cols * 0.045 + 0.06, H = rows * 0.22 + 0.04;
  for (let i = 0; i <= rows; i++) bx(g, W, 0.02, 0.2, wood, 0, -H / 2 + i * 0.22 + 0.01, 0);
  bx(g, 0.02, H, 0.2, wood, -W / 2, 0, 0);
  bx(g, 0.02, H, 0.2, wood, W / 2, 0, 0);
  bx(g, W, H, 0.01, wood, 0, 0, 0.1);
  const key = `tapes.${labels.join('|')}`;
  const atlas = tex(key, 1024, 256, (c, w, h) => {
    const cw = w / 32;
    labels.forEach((lab, i) => {
      if (i >= 32) return;
      c.fillStyle = '#121214';
      c.fillRect(i * cw, 0, cw, h);
      if (!lab) return;
      c.fillStyle = '#EDE9DC';
      c.fillRect(i * cw + 3, h * 0.12, cw - 6, h * 0.76);
      c.save();
      c.translate(i * cw + cw / 2, h / 2);
      c.rotate(-Math.PI / 2);
      c.fillStyle = '#1d3a8a';
      c.font = `bold ${Math.round(cw * 0.62)}px ${FONT_STACK}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(lab, 0, 0);
      c.restore();
    });
  });
  const tapeMat = kitMat(`tapes.${key.length}.${labels.length}`, { color: 0xffffff, map: atlas, roughness: 0.6 });
  const tapes = new THREE.Group();
  labels.forEach((lab, i) => {
    if (!lab || i >= 32) return;
    const col = i % cols, row = Math.floor(i / cols);
    const geo = new THREE.BoxGeometry(0.028, 0.19, 0.105);
    // 所有面都取这盘带子在图集里的那一条（侧脊朝 -z）
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (i + uv.getX(k)) / 32, uv.getY(k));
    const m = new THREE.Mesh(geo, tapeMat);
    m.position.set(-W / 2 + 0.03 + col * 0.045 + 0.01, -H / 2 + row * 0.22 + 0.02 + 0.095, -0.04);
    tapes.add(m);
  });
  g.add(tapes);
  return finish('tapeRack', g);
}

/** 四位转轮锁：锁体 + 四个数字轮（name 'wheel0'…'wheel3'，绕 x 转），正面朝 -z。 */
function drawerLock(): THREE.Group {
  const g = new THREE.Group();
  bx(g, 0.12, 0.05, 0.03, M.brass(), 0, 0, 0);
  const digits = tex('lockDigits', 256, 64, (c, w, h) => {
    c.fillStyle = '#1b1b1b';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#E8E4D8';
    c.font = `bold ${Math.round(h * 0.5)}px monospace`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i < 10; i++) c.fillText(String(i), (i + 0.5) * (w / 10), h / 2);
  });
  const wheelMat = kitMat('lock.wheel', { color: 0xffffff, map: digits, roughness: 0.5, metalness: 0.3 });
  const wheels: THREE.Object3D[] = [];
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.018, 20).rotateZ(Math.PI / 2), wheelMat);
    w.name = `wheel${i}`;
    w.position.set(-0.033 + i * 0.022, 0, -0.012);
    wheels.push(w);
  }
  return finish('drawerLock', g, wheels);
}

function stool(): THREE.Group {
  const g = new THREE.Group();
  const wood = MATERIALS.wood();
  // 马扎：两副交叉腿 + 布面
  for (const z of [-0.12, 0.12]) {
    rd(g, [-0.15, 0, z], [0.15, 0.3, z], 0.012, wood);
    rd(g, [0.15, 0, z], [-0.15, 0.3, z], 0.012, wood);
  }
  for (const x of [-0.15, 0.15]) rd(g, [x, 0.3, -0.13], [x, 0.3, 0.13], 0.012, wood);
  bx(g, 0.28, 0.01, 0.24, MATERIALS.cloth('#5A3A2A'), 0, 0.305, 0);
  return finish('stool', g);
}

/** 画架：三条腿 + 横档 + 一块未完成的炭精画（name 'canvas'，正面朝 -z）。 */
function easel(): THREE.Group {
  const g = new THREE.Group();
  const wood = MATERIALS.wood();
  rd(g, [-0.3, 0, -0.1], [0, 1.7, 0], 0.018, wood);
  rd(g, [0.3, 0, -0.1], [0, 1.7, 0], 0.018, wood);
  rd(g, [0, 0, 0.45], [0, 1.6, 0.02], 0.018, wood);
  bx(g, 0.56, 0.04, 0.05, wood, 0, 0.82, -0.08);
  const drawing = tex('charcoalPortrait', 256, 320, (c, w, h) => {
    c.fillStyle = '#E8E2D2';
    c.fillRect(0, 0, w, h);
    // 炭精画：头的轮廓、帽檐、肩膀已经起了稿，五官还空着
    c.strokeStyle = 'rgba(40,40,40,0.8)';
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(w / 2, h * 0.42, w * 0.2, h * 0.2, 0, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(w * 0.1, h * 0.95);
    c.quadraticCurveTo(w * 0.2, h * 0.66, w * 0.5, h * 0.64);
    c.quadraticCurveTo(w * 0.8, h * 0.66, w * 0.9, h * 0.95);
    c.stroke();
    c.fillStyle = 'rgba(40,40,40,0.25)';
    c.fillRect(w * 0.26, h * 0.2, w * 0.48, h * 0.06);
    const r = rng(12);
    for (let i = 0; i < 40; i++) {
      c.strokeStyle = `rgba(30,30,30,${range(r, 0.05, 0.2)})`;
      c.beginPath();
      const x = w * range(r, 0.3, 0.7), y = h * range(r, 0.25, 0.6);
      c.moveTo(x, y);
      c.lineTo(x + range(r, -20, 20), y + range(r, -8, 8));
      c.stroke();
    }
    waterStain(c, r, w * 0.8, h * 0.2, 30);
  });
  const canvas = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.64, 0.02), kitMat('easel.canvas', { color: 0xffffff, map: drawing, roughness: 0.9 }));
  canvas.name = 'canvas';
  canvas.position.set(0, 1.18, -0.07);
  canvas.rotation.x = -0.08;
  return finish('easel', g, [canvas]);
}

/** 老座机（大座机）：木箱机身 + 皮腔 + 黄铜镜头 + 搭在后面的遮光黑布，架在三脚木架上。正面（镜头）朝 -z。 */
function bigCamera(): THREE.Group {
  const g = new THREE.Group();
  const wood = kitMat('bigcam.wood', { color: '#6A3E22', roughness: 0.55 });
  const brass = M.brass();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    rd(g, [0, 1.05, 0], [Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45], 0.025, wood);
  }
  bx(g, 0.34, 0.05, 0.5, wood, 0, 1.08, 0);
  bx(g, 0.3, 0.32, 0.08, wood, 0, 1.27, 0.18);
  bx(g, 0.26, 0.28, 0.06, wood, 0, 1.25, -0.2);
  // 皮腔：一节节的黑色折纸
  const bellows = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.3, 1, 1, 6), kitMat('bigcam.bellows', {
    color: 0xffffff, roughness: 0.9,
    map: tex('bellows', 64, 128, (c, w, h) => {
      c.fillStyle = '#141414';
      c.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) {
        c.fillStyle = '#2a2a2a';
        c.fillRect(0, y, w, 6);
      }
    }),
  }));
  bellows.position.set(0, 1.26, -0.02);
  g.add(bellows);
  cy(g, 0.06, 0.07, 0.14, brass, 0, 1.25, -0.29, 16).rotation.x = Math.PI / 2;
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), kitMat('bigcam.glass', { color: '#0c0f18', roughness: 0.05, metalness: 0.8 }));
  glass.rotation.y = Math.PI;
  glass.position.set(0, 1.25, -0.361);
  g.add(glass);
  // 遮光黑布：从机身后面垂下来
  const cloth = new THREE.PlaneGeometry(0.5, 0.6, 4, 6);
  const cp = cloth.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) cp.setZ(i, Math.sin((cp.getY(i) + 0.3) * 5) * 0.04 + (0.3 - cp.getY(i)) * 0.3);
  cloth.computeVertexNormals();
  const cm = new THREE.Mesh(cloth, kitMat('bigcam.cloth', { color: '#0e0e10', roughness: 1, side: THREE.DoubleSide }));
  cm.position.set(0, 1.2, 0.25);
  g.add(cm);
  return finish('bigCamera', g);
}

function tlr(): THREE.Group {
  const g = new THREE.Group();
  const leather = kitMat('p.tlrLeather', { color: '#1a1a1a', roughness: 0.75 });
  bx(g, 0.08, 0.13, 0.075, leather, 0, 0.065, 0);
  bx(g, 0.075, 0.03, 0.07, M.chrome(), 0, 0.145, 0);
  for (const y of [0.095, 0.04]) cy(g, 0.02, 0.022, 0.03, M.chrome(), 0, y, -0.052, 14).rotation.x = Math.PI / 2;
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.004, 4, 16, Math.PI), leather);
  strap.position.y = 0.15;
  g.add(strap);
  return finish('tlr', g);
}

/** 暗房的三件容器（GDD §4.4 的轮廓，红光下只能认形状）。原点在底面中心。 */
function tray(shape: 'square' | 'basin_xi' | 'plate_chipped'): THREE.Group {
  const g = new THREE.Group();
  if (shape === 'square') {
    // 黄搪瓷方盘 0.35×0.28×0.06，四个角磕秃露出黑铁
    const enamel = MATERIALS.enamelYellow();
    const t = 0.006;
    bx(g, 0.35, t, 0.28, enamel, 0, t / 2, 0);
    bx(g, 0.35, 0.06, t, enamel, 0, 0.03, -0.14);
    bx(g, 0.35, 0.06, t, enamel, 0, 0.03, 0.14);
    bx(g, t, 0.06, 0.28, enamel, -0.175, 0.03, 0);
    bx(g, t, 0.06, 0.28, enamel, 0.175, 0.03, 0);
    for (const [x, z] of [[-0.172, -0.137], [0.172, -0.137], [-0.172, 0.137], [0.172, 0.137]] as const) bx(g, 0.018, 0.02, 0.018, M.black(), x, 0.055, z);
  } else if (shape === 'basin_xi') {
    // 红双喜脸盆：直径 0.38 的深圆盆，盆底凸起“囍”
    const prof = [[0.001, 0.005], [0.12, 0.005], [0.16, 0.05], [0.19, 0.12], [0.195, 0.125], [0.19, 0.125], [0.155, 0.055], [0.115, 0.012], [0.001, 0.012]].map(([x, y]) => new THREE.Vector2(x ?? 0, y ?? 0));
    g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 28), MATERIALS.enamelRed()));
    const xi = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), kitMat('basin.xi', {
      color: 0xffffff, transparent: true, depthWrite: false, roughness: 0.4,
      map: tex('xi', 128, 128, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.fillStyle = '#F2D46A';
        c.font = `bold ${Math.round(h * 0.8)}px ${FONT_STACK}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('囍', w / 2, h / 2);
      }),
    }));
    xi.rotation.x = -Math.PI / 2;
    xi.position.y = 0.016;
    g.add(xi);
    // 凸起的纹：一个薄薄的“囍”形小台
    bx(g, 0.07, 0.006, 0.07, MATERIALS.enamelRed(), 0, 0.013, 0);
  } else {
    // 白瓷缺口盘：直径 0.30 扁圆盘，盘沿一个 V 形豁口
    const shape2 = new THREE.Shape();
    const n = 40;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const notch = Math.abs(((a + Math.PI) % (Math.PI * 2)) - Math.PI) < 0.12 ? 0.035 * (1 - Math.abs(((a + Math.PI) % (Math.PI * 2)) - Math.PI) / 0.12) : 0;
      const rr = 0.15 - notch;
      if (i === 0) shape2.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else shape2.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    const geo = new THREE.ExtrudeGeometry(shape2, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    g.add(new THREE.Mesh(geo, MATERIALS.porcelain()));
  }
  return finish(`tray.${shape}`, g);
}

function sink(): THREE.Group {
  const g = new THREE.Group();
  const c = MATERIALS.concrete();
  bx(g, 0.6, 0.06, 0.45, c, 0, 0.73, 0);
  bx(g, 0.6, 0.2, 0.04, c, 0, 0.85, -0.205);
  bx(g, 0.6, 0.2, 0.04, c, 0, 0.85, 0.205);
  bx(g, 0.04, 0.2, 0.45, c, -0.28, 0.85, 0);
  bx(g, 0.04, 0.2, 0.45, c, 0.28, 0.85, 0);
  for (const x of [-0.25, 0.25]) bx(g, 0.06, 0.73, 0.06, c, x, 0.365, 0.15);
  // 水龙头
  rd(g, [0, 1.15, 0.24], [0, 1.15, 0.1], 0.012, M.chrome());
  rd(g, [0, 1.15, 0.1], [0, 1.05, 0.08], 0.01, M.chrome());
  bx(g, 0.05, 0.02, 0.02, M.chrome(), 0, 1.19, 0.2);
  return finish('sink', g);
}

/** 晾片绳：原点在左端，沿 +x 长 len；夹子均匀分布（name 'clip0'…）。 */
function dryingLine(len: number, clips: number): THREE.Group {
  const g = new THREE.Group();
  const keep: THREE.Object3D[] = [];
  const pts: number[] = [0, 0, 0, len, 0, 0];
  const line = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: '#d8d0c0' }));
  line.name = 'dryingWire';
  keep.push(line);
  const wood = kitMat('clip.wood', { color: '#C9A878', roughness: 0.8 });
  for (let i = 0; i < clips; i++) {
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.01), wood);
    clip.name = `clip${i}`;
    clip.position.set(((i + 0.5) / clips) * len, -0.02, 0);
    keep.push(clip);
  }
  for (const x of [0, len]) cy(g, 0.01, 0.01, 0.04, M.iron(), x, 0, 0, 6);
  return finish('dryingLine', g, keep);
}

/** 樟木箱：0.9×0.5×0.5，铜包角、搭扣；箱盖 name 'lid'（转轴在后沿，绕 x 负向打开）。 */
function camphorChest(): THREE.Group {
  const g = new THREE.Group();
  const wood = kitMat('camphor', {
    color: 0xffffff, roughness: 0.6,
    map: tex('camphor', 256, 128, (c, w, h) => {
      c.fillStyle = '#7A3A22';
      c.fillRect(0, 0, w, h);
      const r = rng(31);
      for (let i = 0; i < 60; i++) {
        c.strokeStyle = `rgba(40,15,5,${range(r, 0.1, 0.3)})`;
        c.beginPath();
        const y = r() * h;
        c.moveTo(0, y);
        c.bezierCurveTo(w * 0.3, y + range(r, -8, 8), w * 0.6, y + range(r, -8, 8), w, y + range(r, -4, 4));
        c.stroke();
      }
      // 雕花框
      c.strokeStyle = 'rgba(30,10,5,0.6)';
      c.lineWidth = 3;
      c.strokeRect(w * 0.1, h * 0.15, w * 0.8, h * 0.7);
    }),
  });
  bx(g, 0.9, 0.42, 0.5, wood, 0, 0.21, 0);
  for (const [x, z] of [[-0.44, -0.24], [0.44, -0.24], [-0.44, 0.24], [0.44, 0.24]] as const) bx(g, 0.035, 0.44, 0.035, M.brass(), x, 0.22, z);
  const lid = new THREE.Group();
  lid.name = 'lid';
  lid.position.set(0, 0.42, 0.25);
  bx(lid, 0.9, 0.08, 0.5, wood, 0, 0.04, -0.25);
  bx(lid, 0.08, 0.1, 0.02, M.brass(), 0, 0.0, -0.505);
  return finish('camphorChest', g, [mergeByMaterial(lid)]);
}

/** 铁皮盒（饼干盒）：盒身印花，盒盖 name 'lid'。 */
function tinBox(): THREE.Group {
  const g = new THREE.Group();
  const printed = kitMat('tinbox', {
    color: 0xffffff, roughness: 0.4, metalness: 0.5,
    map: tex('tinbox', 256, 128, (c, w, h) => {
      c.fillStyle = '#2B4C8C';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#E8C04A';
      c.fillRect(0, h * 0.1, w, h * 0.08);
      c.fillRect(0, h * 0.82, w, h * 0.08);
      c.fillStyle = '#F2EFE6';
      c.font = `bold ${Math.round(h * 0.28)}px ${FONT_STACK}`;
      c.textAlign = 'center';
      c.fillText('什锦饼干', w / 2, h * 0.6);
      const r = rng(77);
      for (let i = 0; i < 12; i++) blotch(c, r, r() * w, r() * h, range(r, 3, 10), '#8a4a1a', 0.4, 3);
    }),
  });
  bx(g, 0.26, 0.09, 0.18, printed, 0, 0.045, 0);
  const lid = bx(new THREE.Group(), 0.27, 0.025, 0.19, printed, 0, 0.1, 0, 'lid');
  return finish('tinBox', g, [lid]);
}

function stove(): THREE.Group {
  const g = new THREE.Group();
  const steel = kitMat('stove.steel', { color: '#B8BCC0', roughness: 0.35, metalness: 0.7 });
  const enamel = kitMat('stove.top', { color: '#1c1c1e', roughness: 0.3 });
  bx(g, 0.7, 0.1, 0.4, steel, 0, 0.05, 0);
  bx(g, 0.68, 0.01, 0.38, enamel, 0, 0.105, 0);
  for (const x of [-0.17, 0.17]) {
    cy(g, 0.09, 0.09, 0.012, M.iron(), x, 0.115, 0.02, 18);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      bx(g, 0.1, 0.015, 0.012, M.iron(), x + Math.cos(a) * 0.06, 0.13, 0.02 + Math.sin(a) * 0.06).rotation.y = -a;
    }
    cy(g, 0.022, 0.022, 0.025, M.black(), x, 0.05, -0.21, 12).rotation.x = Math.PI / 2;
  }
  return finish('stove', g);
}

export const PROPS: PropKit = {
  bicycle, clothesLine, wires, crt, vcr, desk, chair, thermos, mirrorRound, switchBox, noticeBoard, bracket, brazier, stoneTable,
  mailbox, busStop, hoarding, kiosk, stall, lanternPaper, trashBin, tapeRack, drawerLock, stool, easel, bigCamera, tlr, tray, sink,
  dryingLine, camphorChest, tinBox, stove,
};

/** 旧物做旧用的小工具（区域私有 helper 也可以用）：把一张贴图上随机洒一些锈斑。 */
export function rustSpots(c: CanvasRenderingContext2D, w: number, h: number, seed: number, n = 12): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) blotch(c, r, r() * w, r() * h, range(r, 3, 12), shade('#8a4a1a', range(r, 0.8, 1.2)), 0.35, 3);
}
