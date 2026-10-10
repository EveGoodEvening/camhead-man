// owner: WP2
// char2 区域：头、脸、头发、黄鼬头（WP-H）。冻结接口：buildHead(ctx)、faceTexture(o)；头网格必须是 headSlot 下名为 'head' 的一个网格。
// WP0 时是原样搬来的旧版实现（球头 + 头发壳 + 耳鼻；黄鼬头；摄像头人偶的方盒头）。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEMP_C } from '../../../data/render';
import { canvasToTexture, createCanvas, shade } from '../../../kit/canvas';
import { newMat } from '../../../kit/geom';
import { rng, range } from '../../../kit/rng';
import { cached, limbGeo, q } from '../shared';
import type { BuildCtx, ExtraObject, FaceOpts, RegionResult, RigidPart } from '../types';

/**
 * true = 这里还是 WP0 搬来的旧版构建器（按成年人关节写死）。三个区域（head/upper/lower）都是 true 时，assemble 用旧版关节布局
 * （儿童、土地也按成年人数值摆），外观与拆分前逐像素一致。换上新构建器（按 ctx.layout/ctx.land/ctx.seams 建）后改成 false：
 * 只要有一个区域是 false，全部人偶就用 profile 的关节布局（profile.ts jointLayout）。
 */
export const REGION_LEGACY = true;

/** 头部基础椭球的半轴：x 0.92、y 1.12、z 1（× r），在此基础上塑造面部轮廓。 */
const HEAD_AX = [0.92, 1.12, 1] as const;

/**
 * 人头贴图的发际线（canvas 的 y / H，与 faceTexture 画头发的公式一致）：d = 离正脸的角距离（0 正前、0.25 耳侧、0.5 后脑）。
 * 头发壳的下沿就沿着它，所以壳边正好压在贴图的发际线上。
 */
function hairlineFrac(style: FaceOpts['hairStyle'], d: number, child: boolean): number {
  if (style === 'bald') return d < 0.17 ? 0 : 0.44 + (d - 0.17) * 0.5;
  if (style === 'long') return 0.3 + THREE.MathUtils.smoothstep(d, 0, 0.15) * 0.08 + Math.max(0, d - 0.15) * 1.1;
  return 0.31 + THREE.MathUtils.smoothstep(d, 0, 0.18) * 0.09 + Math.max(0, d - 0.22) * 0.5 + (child ? 0.03 : 0);
}

/**
 * M4 第 2 轮：头发壳（经纬网格，头的 1.04–1.07 倍）：short/long 从头顶盖到发际线（前额 → 耳上 → 后脑），long 在赤道以下直直垂到颈后；
 * bald（土地）只剩后脑到两侧的一圈发环。UV 指向人头贴图里的头发区（带发丝），与头共用一张贴图、一个网格。
 */
function hairShellGeo(r: number, style: FaceOpts['hairStyle'], child: boolean): THREE.BufferGeometry | null {
  if (style === 'none') return null;
  const nx = 32, ny = 8;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  // bald：只取后脑那一段（离正脸 d ≥ 0.17），发环上沿在贴图的 0.36H
  const bald = style === 'bald';
  const phi0 = bald ? Math.PI * 1.5 + 0.17 * Math.PI * 2 : 0;
  const phiLen = bald ? Math.PI * 2 * (1 - 0.34) : Math.PI * 2;
  for (let iy = 0; iy <= ny; iy++) {
    const v = iy / ny;
    for (let ix = 0; ix <= nx; ix++) {
      const phi = phi0 + (ix / nx) * phiLen;
      const uu = (phi / (Math.PI * 2)) % 1;
      let d = Math.abs(uu - 0.75);
      if (d > 0.5) d = 1 - d;
      const top = bald ? 0.36 : 0;
      const bot = Math.max(top + 0.02, hairlineFrac(style, d, child) + 0.01);
      // bald 的发环两端收成尖（贴图里 d = 0.17 处发环宽度接近 0）
      const frac = top + (bot - top) * v;
      const theta = frac * Math.PI;
      // 头顶最厚（发量），往发际线收薄
      const k = r * (1.075 - 0.045 * v + 0.012 * Math.sin(phi * 18 + v * 3) * Math.sin(v * Math.PI));
      const st = Math.sin(Math.min(theta, Math.PI / 2)), ct = Math.cos(theta);
      // 赤道以下（长发）不再往里收：保持赤道的水平半径直直垂下
      const hx = HEAD_AX[0] * k * (theta > Math.PI / 2 ? 1 : st);
      const hz = HEAD_AX[2] * k * (theta > Math.PI / 2 ? 1 : st);
      pos.push(-hx * Math.cos(phi), HEAD_AX[1] * k * ct, hz * Math.sin(phi));
      // 贴图：u 同头，v 落在头发区（short/long：0.03H–0.26H；bald：0.37H 起的发环）
      const cy = bald ? 0.37 + (Math.max(0.38, bot - 0.02) - 0.37) * v * 0.8 : 0.03 + 0.23 * v;
      uv.push(uu, 1 - cy);
    }
  }
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const a = iy * (nx + 1) + ix + 1, b = iy * (nx + 1) + ix, c = (iy + 1) * (nx + 1) + ix, dd = (iy + 1) * (nx + 1) + ix + 1;
      // 与 three 的 SphereGeometry 同绕序（外法线）；顶排退化三角形只留一个
      if (iy !== 0 || bald) idx.push(a, b, dd);
      idx.push(b, c, dd);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 把几何的 UV 全部指到贴图上的一点（耳朵、鼻子取脸上的一块纯肤色）。 */
function flatUv(g: THREE.BufferGeometry, u: number, v: number): THREE.BufferGeometry {
  const a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, u, v);
  return g;
}

/** 面部有颧骨、眼窝、下颌和鼻梁；所有细节仍合为一个头网格，帽子、眼镜和拍照锚点位置不变。 */
function humanHeadGeo(r: number, face: FaceOpts): THREE.BufferGeometry {
  const child = face.age === 'child';
  return cached(`head:${q(r)}:${face.hairStyle}:${face.age}:${!!face.female}`, () => {
    const list: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry) => {
      list.push(g.toNonIndexed());
      g.dispose();
    };
    const sphere = new THREE.SphereGeometry(r, 32, 24);
    sphere.scale(HEAD_AX[0], HEAD_AX[1], HEAD_AX[2]);
    const p = sphere.attributes.position as THREE.BufferAttribute;
    const bump = (x: number, y: number, cx: number, cy: number, wx: number, wy: number) => Math.exp(-(((x - cx) / wx) ** 2 + ((y - cy) / wy) ** 2));
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / r, y = p.getY(i) / r, z = p.getZ(i) / r;
      const lower = Math.max(0, -y / HEAD_AX[1]);
      const jaw = 1 - (face.female ? 0.18 : child ? 0.08 : 0.1) * lower;
      let zz = z;
      if (z < 0) {
        const front = Math.pow(-z, 3);
        const socket = bump(Math.abs(x), y, 0.32, 0, 0.2, 0.16);
        const cheek = bump(Math.abs(x), y, 0.48, -0.27, 0.26, 0.22);
        const brow = bump(Math.abs(x), y, 0.32, 0.18, 0.24, 0.1);
        const chin = bump(x, y, 0, -0.72, 0.32, 0.23);
        zz += front * (0.09 * socket - 0.1 * cheek - 0.065 * brow - 0.21 * chin);
      }
      p.setXYZ(i, x * jaw * r, y * r, zz * r);
    }
    sphere.computeVertexNormals();
    add(sphere);
    const hair = hairShellGeo(r, face.hairStyle, child);
    if (hair) add(hair);
    if (face.hairStyle !== 'long') {
      for (const sx of [-1, 1]) {
        const ear = new THREE.SphereGeometry(1, 12, 8);
        ear.scale(0.1 * r, 0.23 * r, 0.135 * r);
        ear.rotateY(sx * 0.22);
        ear.translate(sx * 0.91 * r, -0.07 * r, 0.025 * r);
        add(flatUv(ear, 0.66, 0.48));
      }
    }
    // 鼻梁与鼻头重叠嵌入脸面，取代尖锥；鼻头大小按儿童/成年人区分。
    const bridge = new THREE.SphereGeometry(1, 12, 10);
    bridge.scale(0.105 * r, 0.28 * r, 0.125 * r);
    bridge.rotateX(-0.2);
    bridge.translate(0, -0.13 * r, -0.975 * r);
    add(flatUv(bridge, 0.735, 0.46));
    const tip = new THREE.SphereGeometry(1, 12, 8);
    tip.scale((child ? 0.1 : 0.14) * r, 0.1 * r, 0.12 * r);
    tip.translate(0, -0.31 * r, -1.075 * r);
    add(flatUv(tip, 0.735, 0.44));
    const merged = mergeGeometries(list, false)!;
    for (const g of list) g.dispose();
    merged.computeBoundingSphere();
    return merged;
  });
}

// ---------------------------------------------------------------- 人脸贴图

const faceCache = new Map<string, THREE.CanvasTexture>();

/**
 * 人头贴图（经纬展开，u=0.75 是正脸 -z，v=1 是头顶）：肤色、发型、五官、老人的皱纹。
 * 同参数缓存复用；colorSpace = SRGB。
 */
export function faceTexture(o: FaceOpts): THREE.CanvasTexture {
  const key = JSON.stringify(o);
  const hit = faceCache.get(key);
  if (hit) return hit;
  const W = 512, H = 256;
  const { canvas, g } = createCanvas(W, 384);
  // 纵向提高眼睑/嘴唇的采样密度，保持 512×256 绘画坐标；整区仍须落在 64 MiB 贴图预算内。
  g.scale(1, 1.5);
  const r = rng(o.seed ?? 1);
  const fx = W * 0.75;
  // 皮肤底色 + 脸颊的一点红
  g.fillStyle = o.skin;
  g.fillRect(0, 0, W, H);
  const cheek = g.createRadialGradient(fx, H * 0.58, 4, fx, H * 0.58, W * 0.14);
  cheek.addColorStop(0, 'rgba(190,90,70,0.12)');
  cheek.addColorStop(1, 'rgba(190,90,70,0)');
  g.fillStyle = cheek;
  g.fillRect(0, 0, W, H);
  // 下巴底下的阴影
  const jaw = g.createLinearGradient(0, H * 0.66, 0, H * 0.8);
  jaw.addColorStop(0, 'rgba(0,0,0,0)');
  jaw.addColorStop(1, 'rgba(60,30,20,0.35)');
  g.fillStyle = jaw;
  g.fillRect(0, H * 0.66, W, H * 0.34);
  // 耳朵（左右两侧 u=0.5、u=0/1）
  for (const ex of [W * 0.5, 0, W]) {
    g.fillStyle = shade(o.skin, 0.85);
    g.beginPath();
    g.ellipse(ex, H * 0.52, W * 0.025, H * 0.06, 0, 0, Math.PI * 2);
    g.fill();
  }
  // 头发：发际线 hl(x) 按离正脸的角距离从前额往后脑降低
  const circ = (x: number) => {
    let d = Math.abs(x - fx) / W;
    if (d > 0.5) d = 1 - d;
    return d; // 0 = 正前，0.25 = 耳侧，0.5 = 后脑
  };
  if (o.hairStyle !== 'none') {
    g.fillStyle = o.hair;
    g.beginPath();
    g.moveTo(0, 0);
    for (let x = 0; x <= W; x += 4) {
      const hl = H * hairlineFrac(o.hairStyle, circ(x), o.age === 'child');
      g.lineTo(x, hl + range(r, -0.4, 0.4));
    }
    g.lineTo(W, 0);
    g.closePath();
    g.fill();
    if (o.hairStyle === 'bald') {
      // 秃顶：头顶一圈皮肤、两侧与后脑剩一圈
      g.fillStyle = o.skin;
      g.fillRect(0, 0, W, H * 0.36);
    }
    // 发丝
    g.strokeStyle = shade(o.hair, 0.7);
    g.lineWidth = 1;
    for (let i = 0; i < 160; i++) {
      const x = r() * W;
      const y = r() * H * 0.45;
      if (y > H * hairlineFrac(o.hairStyle, circ(x), o.age === 'child') || (o.hairStyle === 'bald' && y < H * 0.36)) continue;
      g.globalAlpha = 0.35;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + range(r, -3, 3), y + range(r, 4, 10));
      g.stroke();
    }
    g.globalAlpha = 1;
    if (o.female && o.hairStyle !== 'bald') {
      // 中分发缝
      g.strokeStyle = shade(o.skin, 0.9);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(fx, H * 0.08);
      g.lineTo(fx, H * 0.3);
      g.stroke();
    }
  }
  // 五官
  const eyeY = H * 0.5, eyeDx = W * 0.05;
  const browK = o.brows ?? (o.age === 'young' ? 1 : 0.8);
  // 收敛成杏眼与细眼睑，不用放大的白椭圆和黑点冒充五官。
  const EYE = 1.1, STROKE = 0.85;
  for (const sgn of [-1, 1]) {
    const ex = fx + sgn * eyeDx;
    // 眼窝阴影
    g.fillStyle = 'rgba(80,40,30,0.24)';
    g.beginPath();
    g.ellipse(ex, eyeY, W * 0.028 * EYE, H * 0.03 * EYE, 0, 0, Math.PI * 2);
    g.fill();
    const ew = W * 0.019, eh = H * (o.age === 'old' ? 0.009 : 0.012);
    g.save();
    g.beginPath();
    g.moveTo(ex - ew, eyeY);
    g.bezierCurveTo(ex - ew * 0.4, eyeY - eh * 1.35, ex + ew * 0.45, eyeY - eh, ex + ew, eyeY);
    g.bezierCurveTo(ex + ew * 0.4, eyeY + eh, ex - ew * 0.45, eyeY + eh * 0.8, ex - ew, eyeY);
    g.fillStyle = '#bdb5a4';
    g.fill();
    g.clip();
    g.fillStyle = '#4a3829';
    g.beginPath();
    g.arc(ex, eyeY, H * 0.011, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#191715';
    g.beginPath();
    g.arc(ex, eyeY, H * 0.006, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(238,226,206,0.7)';
    g.fillRect(ex - 0.6, eyeY - 1.4, 0.7, 0.7);
    g.restore();
    g.strokeStyle = 'rgba(48,30,23,0.8)';
    g.lineWidth = 1.1;
    g.beginPath();
    g.moveTo(ex - ew, eyeY);
    g.bezierCurveTo(ex - ew * 0.4, eyeY - eh * 1.35, ex + ew * 0.45, eyeY - eh, ex + ew, eyeY);
    g.stroke();
    // 眉
    g.strokeStyle = o.hairStyle === 'bald' ? o.hair : shade(o.hair, 0.8);
    g.lineWidth = 3 * browK * STROKE;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(ex - sgn * W * 0.02, eyeY - H * 0.05);
    g.quadraticCurveTo(ex, eyeY - H * 0.07, ex + sgn * W * 0.022, eyeY - H * 0.045);
    g.stroke();
    if (o.age === 'old') {
      // 眼袋与鱼尾纹
      g.strokeStyle = 'rgba(70,40,30,0.35)';
      g.lineWidth = 1 * STROKE;
      g.beginPath();
      g.moveTo(ex - W * 0.014, eyeY + H * 0.025);
      g.quadraticCurveTo(ex, eyeY + H * 0.035, ex + W * 0.014, eyeY + H * 0.025);
      g.moveTo(ex + sgn * W * 0.025, eyeY - H * 0.005);
      g.lineTo(ex + sgn * W * 0.035, eyeY - H * 0.015);
      g.moveTo(ex + sgn * W * 0.025, eyeY + H * 0.005);
      g.lineTo(ex + sgn * W * 0.035, eyeY + H * 0.01);
      g.stroke();
    }
  }
  // 鼻子：侧影 + 鼻翼
  g.strokeStyle = 'rgba(90,50,35,0.4)';
  g.lineWidth = 2 * STROKE;
  g.beginPath();
  g.moveTo(fx - W * 0.006, eyeY + H * 0.01);
  g.lineTo(fx - W * 0.01, eyeY + H * 0.1);
  g.stroke();
  g.fillStyle = 'rgba(70,35,25,0.45)';
  g.beginPath();
  g.ellipse(fx - W * 0.008, eyeY + H * 0.11, W * 0.006, H * 0.006, 0, 0, Math.PI * 2);
  g.ellipse(fx + W * 0.008, eyeY + H * 0.11, W * 0.006, H * 0.006, 0, 0, Math.PI * 2);
  g.fill();
  // 嘴
  const mouthY = H * 0.665;
  g.fillStyle = o.female ? 'rgba(158,76,71,0.35)' : 'rgba(130,72,58,0.26)';
  g.beginPath();
  g.ellipse(fx, mouthY + 0.5, W * 0.024, H * 0.008, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(78,44,35,0.65)';
  g.lineWidth = 0.85;
  g.beginPath();
  g.moveTo(fx - W * 0.025, mouthY);
  g.bezierCurveTo(fx - W * 0.012, mouthY + 0.8, fx - W * 0.006, mouthY - 0.8, fx, mouthY);
  g.bezierCurveTo(fx + W * 0.006, mouthY - 0.8, fx + W * 0.012, mouthY + 0.8, fx + W * 0.025, mouthY);
  g.stroke();
  if (o.age === 'old') {
    // 法令纹、抬头纹
    g.strokeStyle = 'rgba(85,53,40,0.17)';
    g.lineWidth = 0.7;
    for (const sgn of [-1, 1]) {
      g.beginPath();
      g.moveTo(fx + sgn * W * 0.02, eyeY + H * 0.09);
      g.quadraticCurveTo(fx + sgn * W * 0.04, mouthY - H * 0.025, fx + sgn * W * 0.035, mouthY + H * 0.012);
      g.stroke();
    }
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(fx - W * 0.04, H * (0.36 + i * 0.025));
      g.quadraticCurveTo(fx, H * (0.35 + i * 0.025), fx + W * 0.04, H * (0.36 + i * 0.025));
      g.stroke();
    }
  }
  const tex = canvasToTexture(canvas);
  tex.name = 'face';
  faceCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------- 黄鼬头、摄像头人偶

/** 黄鼠狼头：Sphere 脑袋 + Cone 尖嘴 + 两只小耳朵 + 黑豆眼 + 白下巴与胡须（GDD §2.7）。 */
export function weaselHead(s: number): { parts: RigidPart[]; extras: ExtraObject[] } {
  const fur = newMat({ color: '#B07A3A', roughness: 0.95, tempC: TEMP_C.huang });
  const furLight = newMat({ color: '#EAD2A2', roughness: 0.95, tempC: TEMP_C.huang });
  const eye = newMat({ color: '#050505', roughness: 0.15, metalness: 0.4, tempC: TEMP_C.huang });
  const parts: RigidPart[] = [];
  const add = (name: string, geo: THREE.BufferGeometry, slot: THREE.Material, position: [number, number, number], rotation?: [number, number, number]) => {
    parts.push({ kind: 'rigid', name, joint: 'headSlot', geo, slot, position, ...(rotation ? { rotation } : {}) });
  };
  add('neckFur', limbGeo(0.05 * s, 0.055 * s, 0.1 * s), fur, [0, 0.08 * s, 0]);
  add('head', cached(`wz:head:${q(s)}`, () => {
    const g = new THREE.SphereGeometry(0.085 * s, 14, 10);
    g.scale(0.92, 0.88, 1.1);
    return g;
  }), fur, [0, 0.14 * s, 0]);
  // 尖嘴：略微朝下
  add('snout', cached(`wz:snout:${q(s)}`, () => {
    const g = new THREE.ConeGeometry(0.046 * s, 0.11 * s, 10);
    g.rotateX(-Math.PI / 2 - 0.25);
    return g;
  }), fur, [0, 0.118 * s, -0.115 * s]);
  add('chin', cached(`wz:chin:${q(s)}`, () => {
    const g = new THREE.SphereGeometry(0.042 * s, 10, 8);
    g.scale(1.1, 0.8, 1.2);
    return g;
  }), furLight, [0, 0.095 * s, -0.085 * s]);
  add('nose', cached(`wz:nose:${q(s)}`, () => new THREE.SphereGeometry(0.012 * s, 6, 5)), eye, [0, 0.105 * s, -0.172 * s]);
  for (const sx of [-1, 1]) {
    // 耳朵往两边支出来（戴着破毡帽也看得见）
    add(`ear${sx}`, cached(`wz:ear:${q(s)}`, () => new THREE.ConeGeometry(0.026 * s, 0.05 * s, 6)), fur, [sx * 0.078 * s, 0.19 * s, 0.01 * s], [0, 0, -sx * 0.95]);
    add(`eye${sx}`, cached(`wz:eye:${q(s)}`, () => new THREE.SphereGeometry(0.014 * s, 8, 6)), eye, [sx * 0.043 * s, 0.168 * s, -0.078 * s]);
  }
  // 胡须：两边各三根（1 像素线，近景细节，ARCH §16 #25）
  const pts: number[] = [];
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) pts.push(sx * 0.02 * s, 0.11 * s, -0.14 * s, sx * 0.11 * s, (0.1 + (i - 1) * 0.02) * s, -0.12 * s);
  }
  const whiskers = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: '#E8E0D0' }));
  whiskers.name = 'whiskers';
  return { parts, extras: [{ joint: 'headSlot', object: whiskers }] };
}

function boxGeo(w: number, h: number, d: number, cy: number, cz = 0): THREE.BufferGeometry {
  return cached(`box:${q(w)}:${q(h)}:${q(d)}:${q(cy)}:${q(cz)}`, () => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, cy, cz);
    return g;
  });
}

/** 摄像头人偶的方盒头（createHumanoid({head:'camera'})，主角模型另有 cameraHead.ts）。 */
function cameraHeadParts(s: number): RigidPart[] {
  const housing = newMat({ color: '#D9D4C7', roughness: 0.45, tempC: 28 });
  const dark = newMat({ color: '#1a1b1f', roughness: 0.3, metalness: 0.5 });
  return [
    { kind: 'rigid', name: 'head', joint: 'headSlot', geo: boxGeo(0.2 * s, 0.22 * s, 0.34 * s, 0.38 * s), slot: housing },
    {
      kind: 'rigid', name: 'lens', joint: 'headSlot', slot: dark, geo: cached(`camlens:${q(s)}`, () => {
        const g = new THREE.CylinderGeometry(0.06 * s, 0.06 * s, 0.07 * s, 16);
        g.rotateX(Math.PI / 2);
        g.translate(0, 0.35 * s, -0.2 * s);
        return g;
      }),
    },
    { kind: 'rigid', name: 'neckPole', joint: 'neck', geo: limbGeo(0.025 * s, 0.025 * s, 0.27 * s), slot: dark, position: [0, 0.27 * s, 0] },
  ];
}

/**
 * 头部构建器：spec.head 'human'（人头，face 槽材质）、'weasel'（黄鼬头）、'camera'（方盒头）、'none'（空）。
 * 头网格名为 'head'、挂在 headSlot 下（npc.markerAnchor、R1 的贴片、maskZhouFace 都靠它）。
 */
export function buildHead(ctx: BuildCtx): RegionResult {
  const { spec, s } = ctx;
  if (spec.head === 'human') {
    const f = ctx.face as FaceOpts;
    // 面部轮廓与耳鼻、头发合并，五官细化不增加头部 draw call。
    return { parts: [{ kind: 'rigid', name: 'head', joint: 'headSlot', geo: humanHeadGeo(0.1 * s, f), slot: 'face', position: [0, 0.14 * s, -0.005 * s] }] };
  }
  if (spec.head === 'weasel') return weaselHead(s);
  if (spec.head === 'camera') return { parts: cameraHeadParts(s) };
  return { parts: [] };
}
