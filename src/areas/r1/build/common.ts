// owner: R1-world
// R1-world 建造用的私有小工具（ARCH §10：区域只调 kit；缺的写在自己目录里）：
// - Statics：把全场静态网格收进一个组，最后按材质合并（mergeByMaterial），把几百个小件压成几十个 draw call（ARCH §13.3）。
// - DecalAtlas：墙上的小广告、红圈“拆”、水渍、粉笔字画在一张 1024² 图集里，所有贴花合成一个网格（一个 draw call）。
// - 墙体开洞、悬链电线合成一条 LineSegments、面朝 yaw 摆放等。

import * as THREE from 'three';
import type { AreaContext } from '../../../core/area';
import type { V3 } from '../../../core/types';
import { DEG2RAD } from '../../../core/math';
import { mergeByMaterial, kitMat } from '../../../kit/geom';
import type { KitMatOpts } from '../../../kit/geom';
import { PAINT, createCanvas, canvasToTexture } from '../../../kit/canvas';
import { makeTextTexture } from '../../../kit/text';
import type { TextTexOpts } from '../../../kit/text';

/** yaw（度，0 = 朝北 -z，90 = 朝东 +x）→ 让“正面朝 -z”的道具面朝该方向的 rotation.y。 */
export function rotForYaw(yaw: number): number {
  return -yaw * DEG2RAD;
}

/** 让“正面朝 +z”的平面/招牌（makeTextPlane、sign）面朝 yaw。 */
export function rotPlaneForYaw(yaw: number): number {
  return (180 - yaw) * DEG2RAD;
}

/** 摆放：position + 朝向（道具正面朝 -z 的约定）。 */
export function place<T extends THREE.Object3D>(o: T, at: V3, yaw = 0): T {
  o.position.set(at[0], at[1], at[2]);
  o.rotation.y = rotForYaw(yaw);
  return o;
}

/** R1 私有的缓存材质（名字统一加 r1w. 前缀，kitMat 按 key 缓存）。 */
export function mat(key: string, o: KitMatOpts): THREE.MeshStandardMaterial {
  return kitMat(`r1w.${key}`, o);
}

/**
 * 静态网格收集器：build 期间往 group 里塞（世界坐标），flush 时合并：
 * - 没有贴图、不透明、不自发光的 MeshStandardMaterial（区域与 kit 的纯色小件：桌椅、搪瓷、铁件、布……）按（粗糙度、金属度、面、温度）分桶，
 *   颜色烘进顶点色，一桶一个网格——几十种颜色压成十来个 draw call（ARCH §13.3）；
 * - 其余按材质合并（mergeByMaterial：共享的砖、抹灰、水泥、木纹……各一个 draw call）。
 * 注意：合并会丢掉 renderOrder、onBeforeRender、raycast 覆盖与逐网格 userData，
 * 所以透明贴花、灯罩、要单独开关/动的东西、自带特殊 tempC 的东西都别放进来。
 */
export class Statics {
  readonly group = new THREE.Group();
  /** 楼的窗户（InstancedMesh）：flush 时按贴图合并成几个实例网格 */
  readonly windows: THREE.InstancedMesh[] = [];
  /** flush 之后：合并出来的窗户网格用的材质（亮窗 = instanceColor × material.color；天亮了 logic.ts 把 color 压暗） */
  readonly windowMaterials: THREE.MeshBasicMaterial[] = [];
  /** 晾衣绳等 LineSegments（本地坐标 + 世界矩阵）：flush 时烘成一条 */
  readonly ropes: THREE.LineSegments[] = [];
  /** 电线悬链：flush 时合成一条 LineSegments */
  readonly spans: { a: V3; b: V3; sag: number; n?: number }[] = [];
  constructor(readonly name: string) {
    this.group.name = name;
  }
  add<T extends THREE.Object3D>(o: T): T {
    this.group.add(o);
    return o;
  }
  box(w: number, h: number, d: number, m: THREE.Material, at: V3, rotYDeg = 0): THREE.Mesh {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(at[0], at[1], at[2]);
    if (rotYDeg) b.rotation.y = rotYDeg * DEG2RAD;
    this.group.add(b);
    return b;
  }
  cyl(rTop: number, rBot: number, h: number, m: THREE.Material, at: V3, seg = 12): THREE.Mesh {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), m);
    c.position.set(at[0], at[1], at[2]);
    this.group.add(c);
    return c;
  }
  /** 水平面（朝上）。 */
  floor(x0: number, z0: number, x1: number, z1: number, y: number, m: THREE.Material): THREE.Mesh {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), m);
    p.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    this.group.add(p);
    return p;
  }
  /** 合并后挂进场景。 */
  flush(ctx: AreaContext): void {
    this.group.updateMatrixWorld(true);
    const buckets = new Map<string, { mat: THREE.MeshStandardMaterial; geos: THREE.BufferGeometry[] }>();
    const moved: THREE.Mesh[] = [];
    const col = new THREE.Color();
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
      const mt = m.material as THREE.MeshStandardMaterial;
      if (!isPlain(mt)) return;
      const temp = (mt.userData.tempC as number | undefined) ?? 18;
      const key = `${Math.round(mt.roughness * 20)}|${Math.round(mt.metalness * 10)}|${mt.side}|${temp}|${mt.flatShading ? 1 : 0}`;
      let b = buckets.get(key);
      if (!b) {
        const bm = new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: Math.round(mt.roughness * 20) / 20, metalness: Math.round(mt.metalness * 10) / 10, side: mt.side, flatShading: mt.flatShading,
        });
        bm.name = `r1w.tint.${key}`;
        bm.userData.tempC = temp;
        b = { mat: bm, geos: [] };
        buckets.set(key, b);
      }
      const g0 = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', g0.attributes.position!.clone());
      if (g0.attributes.normal) g.setAttribute('normal', g0.attributes.normal.clone());
      else g.computeVertexNormals();
      g0.dispose();
      g.applyMatrix4(m.matrixWorld);
      col.copy(mt.color);
      const n = g.attributes.position!.count;
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        c[i * 3] = col.r;
        c[i * 3 + 1] = col.g;
        c[i * 3 + 2] = col.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      b.geos.push(g);
      moved.push(m);
    });
    for (const m of moved) m.parent?.remove(m);
    // 其余按材质合并
    this.group.traverse(o => {
      delete o.userData.tempC;
    });
    const merged = mergeByMaterial(this.group);
    merged.name = this.name;
    this.group.clear();
    ctx.add(merged);
    for (const b of buckets.values()) {
      const mesh = new THREE.Mesh(mergeAttrs(b.geos, ['position', 'normal', 'color']), b.mat);
      mesh.name = `${this.name}.tint`;
      ctx.add(mesh);
    }
    this.flushWindows(ctx);
    this.flushLines(ctx);
  }

  /** 同一张窗贴图的窗户合成一个 InstancedMesh（亮/暗仍按 instanceColor）。 */
  private flushWindows(ctx: AreaContext): void {
    const byMap = new Map<THREE.Texture | null, THREE.InstancedMesh[]>();
    for (const w of this.windows) {
      const map = (w.material as THREE.MeshBasicMaterial).map;
      const list = byMap.get(map) ?? [];
      list.push(w);
      byMap.set(map, list);
    }
    const m = new THREE.Matrix4(), wm = new THREE.Matrix4(), c = new THREE.Color();
    for (const list of byMap.values()) {
      const first = list[0]!;
      let n = 0;
      for (const w of list) n += w.count;
      const out = new THREE.InstancedMesh(first.geometry, first.material, Math.max(1, n));
      out.name = 'windows';
      out.userData.sharedGeometry = true;
      let k = 0;
      for (const w of list) {
        w.updateWorldMatrix(true, false);
        wm.copy(w.matrixWorld);
        for (let i = 0; i < w.count; i++) {
          w.getMatrixAt(i, m);
          out.setMatrixAt(k, m.premultiply(wm));
          if (w.instanceColor) {
            w.getColorAt(i, c);
            out.setColorAt(k, c);
          }
          k++;
        }
      }
      out.count = k;
      out.instanceMatrix.needsUpdate = true;
      if (out.instanceColor) out.instanceColor.needsUpdate = true;
      out.computeBoundingSphere();
      out.computeBoundingBox();
      out.userData.noOcclude = true;
      ctx.add(out, { occlude: false });
      const winMat = out.material as THREE.MeshBasicMaterial;
      if (!this.windowMaterials.includes(winMat)) this.windowMaterials.push(winMat);
    }
  }

  /** 晾衣绳与电线合成一条 LineSegments。 */
  private flushLines(ctx: AreaContext): void {
    const pts: number[] = [];
    const v = new THREE.Vector3();
    for (const r of this.ropes) {
      r.updateWorldMatrix(true, false);
      const p = r.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(r.matrixWorld);
        pts.push(v.x, v.y, v.z);
      }
    }
    for (const s of this.spans) {
      const n = s.n ?? 14;
      const P = (t: number): V3 => [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t - s.sag * 4 * t * (1 - t), s.a[2] + (s.b[2] - s.a[2]) * t];
      for (let i = 0; i < n; i++) pts.push(...P(i / n), ...P((i + 1) / n));
    }
    if (pts.length === 0) return;
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#07080a' }));
    l.name = 'wires';
    l.userData.noOcclude = true;
    l.raycast = () => {};
    ctx.add(l, { occlude: false });
  }
}

/** 纯色材质：没有任何贴图、不透明、不自发光、没有自定义着色器改写。 */
function isPlain(m: THREE.Material): boolean {
  const s = m as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial || (s as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) return false;
  if (s.map || s.alphaMap || s.emissiveMap || s.normalMap || s.roughnessMap || s.metalnessMap || s.aoMap || s.bumpMap || s.envMap) return false;
  if (s.transparent || s.opacity < 1 || s.alphaTest > 0 || s.vertexColors || !s.visible) return false;
  if (s.emissiveIntensity > 0 && (s.emissive.r > 0 || s.emissive.g > 0 || s.emissive.b > 0)) return false;
  if (s.onBeforeCompile.toString() !== THREE.Material.prototype.onBeforeCompile.toString()) return false;
  return true;
}

/** 合并若干非索引几何的指定属性（都已在世界坐标）。 */
export function mergeAttrs(geos: readonly THREE.BufferGeometry[], names: readonly string[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = geos[0]?.attributes[name]?.itemSize ?? 3;
    let n = 0;
    for (const g of geos) n += g.attributes[name]?.count ?? 0;
    const arr = new Float32Array(n * size);
    let o = 0;
    for (const g of geos) {
      const a = g.attributes[name] as THREE.BufferAttribute | undefined;
      if (!a) continue;
      arr.set(a.array as Float32Array, o);
      o += a.count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  for (const g of geos) g.dispose();
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** 把一个子树里除 keep 以外的网格按世界变换搬进静态收集器（灯杆、灯臂这些不动的部件）。 */
export function staticize(root: THREE.Object3D, st: Statics, keep: (m: THREE.Mesh) => boolean): void {
  root.updateMatrixWorld(true);
  const move: THREE.Mesh[] = [];
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !keep(m)) move.push(m);
  });
  for (const m of move) {
    const wm = m.matrixWorld.clone();
    m.parent?.remove(m);
    wm.decompose(m.position, m.quaternion, m.scale);
    st.add(m);
  }
}

/** 墙：沿 x（axis 'x'，在 z = c 处）或沿 z（axis 'z'，在 x = c 处）从 s0 到 s1、高 y0..y1、厚 t，挖掉若干洞（s0,s1,y0,y1）。 */
export function wallPieces(
  st: Statics, m: THREE.Material, axis: 'x' | 'z', c: number, s0: number, s1: number, y0: number, y1: number, t: number,
  holes: readonly (readonly [number, number, number, number])[] = [],
): void {
  const piece = (a0: number, a1: number, b0: number, b1: number) => {
    if (a1 - a0 < 1e-3 || b1 - b0 < 1e-3) return;
    const mid = (a0 + a1) / 2, len = a1 - a0, h = b1 - b0, yc = (b0 + b1) / 2;
    if (axis === 'x') st.box(len, h, t, m, [mid, yc, c]);
    else st.box(t, h, len, m, [c, yc, mid]);
  };
  const hs = [...holes].sort((a, b) => a[0] - b[0]);
  let cur = s0;
  for (const [h0, h1, hy0, hy1] of hs) {
    piece(cur, h0, y0, y1);
    piece(h0, h1, y0, hy0);
    piece(h0, h1, hy1, y1);
    cur = h1;
  }
  piece(cur, s1, y0, y1);
}

// ==================================================================== 贴花图集

/** 图集格子：4 × 4，每格 256px。 */
export const DECAL = {
  postersA: 0, postersB: 1, postersC: 2, chai: 3, chaiFaded: 4, stainStreak: 5, chalkKids: 6, fu: 7,
  meterPlate: 8, noParking: 9, rustStreak: 10, oldCouplet: 11, chalkChai: 12, hopscotch: 13, mold: 14, number3: 15,
} as const;
export type DecalCell = (typeof DECAL)[keyof typeof DECAL];

const CELL = 256;

/**
 * 贴花图集：透明底 1024²（4MB）。quad(cell, at, w, h, yaw) 往一个合并几何里加一块贴花（正面朝 yaw，即面向看它的人；
 * 地面贴花用 ground()）。finish() 生成一个网格（透明、不写深度、polygonOffset，贴墙不闪；不挡准星/拍照）。
 */
export class DecalAtlas {
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly tex: THREE.CanvasTexture;
  constructor(ctx: AreaContext) {
    const { canvas, g } = createCanvas(CELL * 4, CELL * 4);
    g.clearRect(0, 0, canvas.width, canvas.height);
    const cell = (i: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) => {
      g.save();
      g.translate((i % 4) * CELL, Math.floor(i / 4) * CELL);
      g.beginPath();
      g.rect(0, 0, CELL, CELL);
      g.clip();
      draw(g, CELL, CELL);
      g.restore();
    };
    const fromTex = (t: THREE.CanvasTexture, alpha = 1, rot = 0) => (c: CanvasRenderingContext2D, w: number, h: number) => {
      c.globalAlpha = alpha;
      if (rot) {
        c.translate(w / 2, h / 2);
        c.rotate(rot);
        c.translate(-w / 2, -h / 2);
      }
      c.drawImage(t.image as HTMLCanvasElement, 0, 0, w, h);
      t.dispose();
    };
    cell(DECAL.postersA, fromTex(PAINT.posters({ lines: ['开锁', '通下水道', '回收旧家电'], seed: 11 })));
    cell(DECAL.postersB, fromTex(PAINT.posters({ lines: ['办证', '疏通管道', '高价回收', '搬家'], seed: 23 })));
    cell(DECAL.postersC, fromTex(PAINT.posters({ lines: ['家电维修', '开锁换锁', '空调加氟', '收旧书'], seed: 37 })));
    cell(DECAL.chai, fromTex(PAINT.demolitionMark()));
    cell(DECAL.chaiFaded, fromTex(PAINT.demolitionMark(), 0.55, 0.12));
    cell(DECAL.stainStreak, (c, w, h) => {
      // 雨水从窗台/墙顶往下淌的黑印子
      for (let i = 0; i < 9; i++) {
        const x = w * (0.1 + i * 0.1) + Math.sin(i * 7.1) * 6;
        const len = h * (0.45 + 0.5 * Math.abs(Math.sin(i * 3.7)));
        const grd = c.createLinearGradient(0, 0, 0, len);
        grd.addColorStop(0, 'rgba(15,15,12,0.55)');
        grd.addColorStop(1, 'rgba(15,15,12,0)');
        c.fillStyle = grd;
        c.fillRect(x, 0, 6 + (i % 3) * 4, len);
      }
    });
    cell(DECAL.chalkKids, (c, w, h) => {
      // 孩子们的粉笔画：太阳、小人、歪歪扭扭的“1+1=2”
      c.strokeStyle = 'rgba(235,232,220,0.85)';
      c.lineWidth = 4;
      c.lineCap = 'round';
      c.beginPath();
      c.arc(w * 0.22, h * 0.24, w * 0.09, 0, Math.PI * 2);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        c.moveTo(w * 0.22 + Math.cos(a) * w * 0.12, h * 0.24 + Math.sin(a) * w * 0.12);
        c.lineTo(w * 0.22 + Math.cos(a) * w * 0.17, h * 0.24 + Math.sin(a) * w * 0.17);
      }
      c.stroke();
      c.beginPath();
      c.arc(w * 0.68, h * 0.42, w * 0.05, 0, Math.PI * 2);
      c.moveTo(w * 0.68, h * 0.47);
      c.lineTo(w * 0.68, h * 0.68);
      c.moveTo(w * 0.58, h * 0.55);
      c.lineTo(w * 0.78, h * 0.55);
      c.moveTo(w * 0.68, h * 0.68);
      c.lineTo(w * 0.6, h * 0.82);
      c.moveTo(w * 0.68, h * 0.68);
      c.lineTo(w * 0.76, h * 0.82);
      c.stroke();
      c.fillStyle = 'rgba(235,232,220,0.8)';
      c.font = `bold ${Math.round(h * 0.13)}px sans-serif`;
      c.fillText('1+1=2', w * 0.1, h * 0.9);
    });
    cell(DECAL.fu, (c, w, h) => {
      c.translate(w / 2, h / 2);
      c.rotate(Math.PI / 4);
      c.fillStyle = 'rgba(176,30,32,0.85)';
      c.fillRect(-w * 0.3, -h * 0.3, w * 0.6, h * 0.6);
      c.rotate(-Math.PI / 4);
      c.fillStyle = 'rgba(30,12,6,0.85)';
      c.font = `bold ${Math.round(h * 0.4)}px "Noto Sans SC","WenQuanYi Zen Hei",sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('福', 0, 4);
    });
    cell(DECAL.meterPlate, (c, w, h) => {
      c.fillStyle = '#E9E4D2';
      c.fillRect(w * 0.1, h * 0.3, w * 0.8, h * 0.4);
      c.strokeStyle = '#B01E20';
      c.lineWidth = 6;
      c.strokeRect(w * 0.1, h * 0.3, w * 0.8, h * 0.4);
      c.fillStyle = '#B01E20';
      c.font = `bold ${Math.round(h * 0.13)}px "Noto Sans SC","WenQuanYi Zen Hei",sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('有电危险', w / 2, h / 2);
    });
    cell(DECAL.noParking, (c, w, h) => {
      c.fillStyle = 'rgba(210,210,200,0.7)';
      c.font = `bold ${Math.round(h * 0.2)}px "Noto Sans SC","WenQuanYi Zen Hei",sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('门前', w / 2, h * 0.36);
      c.fillText('禁止停车', w / 2, h * 0.64);
    });
    cell(DECAL.rustStreak, (c, w, h) => {
      for (let i = 0; i < 5; i++) {
        const x = w * (0.3 + i * 0.1);
        const grd = c.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, 'rgba(120,58,22,0.65)');
        grd.addColorStop(1, 'rgba(120,58,22,0)');
        c.fillStyle = grd;
        c.fillRect(x, 0, 5 + i, h * (0.6 + i * 0.08));
      }
    });
    cell(DECAL.oldCouplet, (c, w, h) => {
      // 褪色的旧对联残条（门框两侧）
      c.fillStyle = 'rgba(150,40,36,0.8)';
      c.fillRect(w * 0.12, 0, w * 0.2, h);
      c.fillRect(w * 0.68, h * 0.1, w * 0.2, h * 0.9);
      c.fillStyle = 'rgba(40,20,10,0.6)';
      c.font = `bold ${Math.round(w * 0.15)}px "Noto Sans SC","WenQuanYi Zen Hei",sans-serif`;
      c.textAlign = 'center';
      ['春', '满', '人'].forEach((ch, i) => c.fillText(ch, w * 0.22, h * (0.2 + i * 0.28)));
      ['福', '临', '门'].forEach((ch, i) => c.fillText(ch, w * 0.78, h * (0.3 + i * 0.26)));
    });
    cell(DECAL.chalkChai, (c, w, h) => {
      c.fillStyle = 'rgba(236,232,222,0.8)';
      c.font = `bold ${Math.round(h * 0.28)}px "Noto Sans SC","WenQuanYi Zen Hei",sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('8.28', w / 2, h * 0.35);
      c.font = `bold ${Math.round(h * 0.2)}px "Noto Sans SC","WenQuanYi Zen Hei",sans-serif`;
      c.fillText('已腾空', w / 2, h * 0.7);
    });
    cell(DECAL.hopscotch, (c, w, h) => {
      c.strokeStyle = 'rgba(232,228,214,0.7)';
      c.lineWidth = 5;
      const s = w * 0.2;
      const boxes: [number, number][] = [[0.4, 0.82], [0.4, 0.62], [0.3, 0.42], [0.5, 0.42], [0.4, 0.22], [0.3, 0.02], [0.5, 0.02]];
      for (const [x, y] of boxes) c.strokeRect(w * x, h * y, s, s * 0.95);
      c.fillStyle = 'rgba(232,228,214,0.7)';
      c.font = `bold ${Math.round(s * 0.5)}px sans-serif`;
      boxes.forEach(([x, y], i) => c.fillText(String(i + 1), w * x + s * 0.35, h * y + s * 0.65));
    });
    cell(DECAL.mold, (c, w, h) => {
      for (let i = 0; i < 30; i++) {
        const x = w * (0.5 + 0.4 * Math.sin(i * 12.9)), y = h * (0.6 + 0.35 * Math.sin(i * 4.3));
        const r = 10 + (i % 5) * 7;
        const grd = c.createRadialGradient(x, y, 1, x, y, r);
        grd.addColorStop(0, 'rgba(30,38,24,0.35)');
        grd.addColorStop(1, 'rgba(30,38,24,0)');
        c.fillStyle = grd;
        c.fillRect(x - r, y - r, r * 2, r * 2);
      }
    });
    cell(DECAL.number3, (c, w, h) => {
      c.fillStyle = 'rgba(200,196,184,0.85)';
      c.font = `bold ${Math.round(h * 0.7)}px sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('3', w / 2, h * 0.52);
    });
    this.tex = ctx.track(canvasToTexture(canvas, { anisotropy: 4 }));
  }

  private push(cell: number, geo: THREE.PlaneGeometry): void {
    const col = cell % 4, row = Math.floor(cell / 4);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      uv.setXY(i, (col + u) / 4, 1 - (row + 1 - v) / 4);
    }
    this.geos.push(geo);
  }

  /** 竖直贴花：中心 at，宽 w 高 h，正面朝 yaw（面向看它的人所在的方向）。 */
  quad(cell: number, at: V3, w: number, h: number, yaw: number, tiltDeg = 0): void {
    const geo = new THREE.PlaneGeometry(w, h);
    if (tiltDeg) geo.rotateZ(tiltDeg * DEG2RAD);
    geo.rotateY(rotPlaneForYaw(yaw));
    geo.translate(at[0], at[1], at[2]);
    this.push(cell, geo);
  }

  /** 地面贴花（朝上）；rotDeg 绕 y。 */
  ground(cell: number, x: number, z: number, w: number, h: number, rotDeg = 0, y = 0.012): void {
    const geo = new THREE.PlaneGeometry(w, h);
    geo.rotateX(-Math.PI / 2);
    if (rotDeg) geo.rotateY(rotDeg * DEG2RAD);
    geo.translate(x, y, z);
    this.push(cell, geo);
  }

  finish(ctx: AreaContext): THREE.Mesh | null {
    if (this.geos.length === 0) return null;
    const merged = mergePlain(this.geos);
    const m = new THREE.MeshStandardMaterial({
      map: this.tex, transparent: true, depthWrite: false, roughness: 0.92, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    m.name = 'r1w.decals';
    const mesh = new THREE.Mesh(ctx.track(merged), ctx.track(m));
    mesh.name = 'decals';
    mesh.renderOrder = 1;
    mesh.userData.noOcclude = true;
    mesh.raycast = () => {};
    return ctx.add(mesh, { occlude: false });
  }
}

/** 把一组“已在世界坐标”的平面几何合成一个（只保留 position/normal/uv）。 */
export function mergePlain(geos: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of geos) n += (g.index ? g.index.count : g.attributes.position!.count);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
  let o = 0;
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const P = g.attributes.position as THREE.BufferAttribute, N = g.attributes.normal as THREE.BufferAttribute, U = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < P.count; i++, o++) {
      pos[o * 3] = P.getX(i); pos[o * 3 + 1] = P.getY(i); pos[o * 3 + 2] = P.getZ(i);
      nor[o * 3] = N.getX(i); nor[o * 3 + 1] = N.getY(i); nor[o * 3 + 2] = N.getZ(i);
      uvs[o * 2] = U ? U.getX(i) : 0; uvs[o * 2 + 1] = U ? U.getY(i) : 0;
    }
    if (g !== g0) g.dispose();
    g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// ==================================================================== 文字

/** 文字平面（MeshStandardMaterial 或自发光），正面朝 yaw。text 贴图由 ctx 追踪。 */
export function textPanel(
  ctx: AreaContext, o: TextTexOpts & { w: number; h: number; at: V3; yaw: number; glow?: number; roughness?: number; ref?: string },
): THREE.Mesh {
  const tex = ctx.track(makeTextTexture({ ...o, height: o.height ?? Math.round((o.width ?? 1024) * o.h / o.w) }));
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: o.roughness ?? 0.85, metalness: 0, transparent: !o.bg });
  if (o.glow) {
    m.emissive.set('#ffffff');
    m.emissiveMap = tex;
    m.emissiveIntensity = o.glow;
    m.userData.tempC = 40;
  }
  if (!o.bg) {
    m.depthWrite = false;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
  }
  ctx.track(m);
  const mesh = new THREE.Mesh(ctx.track(new THREE.PlaneGeometry(o.w, o.h)), m);
  mesh.position.set(o.at[0], o.at[1], o.at[2]);
  mesh.rotation.y = rotPlaneForYaw(o.yaw);
  mesh.name = 'textPanel';
  if (!o.bg) mesh.userData.noOcclude = true;
  return ctx.add(mesh, o.ref ? { ref: o.ref } : undefined);
}

/** 画一张 CanvasTexture（区域私有；ctx 追踪）。 */
export function canvasTex(ctx: AreaContext, w: number, h: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const { canvas, g } = createCanvas(w, h);
  paint(g, w, h);
  return ctx.track(canvasToTexture(canvas, { srgb, anisotropy: 4 }));
}

// ==================================================================== 招牌（省画布：kit/signs 的招牌按 2048 宽画字，R1 的小牌子用这里的）

export interface BoardSign { face: THREE.Mesh; setOn(on: boolean): void }

/**
 * 小招牌/牌匾/灯箱：底板（并进静态网格）+ 字面（一张按尺寸取像素的画布，约 400px/m，最多 512 宽）。
 * 正面朝 yaw。lightbox 的字面自发光（setOn 开关）；plaque 是黑漆金字宋体；painted 是平涂底色。
 */
export function boardSign(
  ctx: AreaContext, st: Statics,
  o: {
    text: string; w: number; h: number; at: V3; yaw: number; style: 'plaque' | 'painted' | 'lightbox'; color: string; bg: string; glow?: number; on?: boolean; depth?: number; frame?: THREE.Material;
    /** painted/plaque：反光膜路牌这类夜里要读得出的牌子，字面自发光（emissiveMap = 字面贴图）的强度；可读的牌子 0.5–0.9（AGENTS.md Lessons） */
    selfLit?: number;
  },
): BoardSign {
  const pw = Math.min(512, Math.max(128, Math.round((o.w * 420) / 32) * 32));
  const ph = Math.max(32, Math.round((pw * o.h) / o.w));
  const serif = o.style === 'plaque';
  const tex = canvasTex(ctx, pw, ph, (g, w, h) => {
    g.fillStyle = o.bg;
    g.fillRect(0, 0, w, h);
    if (o.style === 'plaque') {
      g.strokeStyle = 'rgba(210,170,80,0.55)';
      g.lineWidth = Math.max(2, h * 0.05);
      g.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16);
    }
    g.fillStyle = o.color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = h * 0.62;
    const family = serif ? '"Noto Serif SC","Noto Serif CJK SC","Songti SC","SimSun","Noto Sans SC","WenQuanYi Zen Hei",serif' : '"Noto Sans SC","Noto Sans CJK SC","PingFang SC","Microsoft YaHei","WenQuanYi Zen Hei",sans-serif';
    g.font = `bold ${Math.round(size)}px ${family}`;
    const tw = g.measureText(o.text).width;
    if (tw > w * 0.88) {
      size *= (w * 0.88) / tw;
      g.font = `bold ${Math.round(size)}px ${family}`;
    }
    g.fillText(o.text, w / 2, h * 0.53);
    if (o.style !== 'lightbox') {
      // 雨淋的旧痕
      g.globalAlpha = 0.18;
      g.fillStyle = '#000';
      for (let i = 0; i < 6; i++) g.fillRect((i / 6) * w + (i % 2) * 7, 0, 3, h * (0.4 + (i % 3) * 0.2));
      g.globalAlpha = 1;
    }
  });
  const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: o.style === 'lightbox' ? 0.6 : 0.7, metalness: 0 });
  const glow = o.glow ?? 1.2;
  if (o.style === 'lightbox') {
    faceMat.emissive.set('#ffffff');
    faceMat.emissiveMap = tex;
    faceMat.userData.tempC = 40;
  } else if (o.selfLit) {
    faceMat.emissive.set('#ffffff');
    faceMat.emissiveMap = tex;
    faceMat.emissiveIntensity = o.selfLit;
  }
  const depth = o.depth ?? (o.style === 'lightbox' ? 0.16 : 0.05);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), faceMat);
  const r = rotPlaneForYaw(o.yaw);
  face.rotation.y = r;
  face.position.set(o.at[0], o.at[1], o.at[2]);
  face.name = `sign:${o.text}`;
  face.userData.text = o.text;
  ctx.add(face);
  // 底板在字面后面（沿 -法线）
  const n = new THREE.Vector3(Math.sin(r), 0, Math.cos(r));
  const frame = o.frame ?? (o.style === 'lightbox' ? mat('lightboxFrame', { color: '#7E8286', roughness: 0.45, metalness: 0.55 }) : mat('signBoard', { color: '#3A2A1E', roughness: 0.75 }));
  const board = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.06, o.h + 0.06, depth), frame);
  board.rotation.y = r;
  board.position.set(o.at[0] - n.x * (depth / 2 + 0.003), o.at[1], o.at[2] - n.z * (depth / 2 + 0.003));
  st.add(board);
  const setOn = (on: boolean) => {
    if (o.style === 'lightbox') faceMat.emissiveIntensity = on ? glow : 0;
  };
  setOn(o.on ?? true);
  return { face, setOn };
}
