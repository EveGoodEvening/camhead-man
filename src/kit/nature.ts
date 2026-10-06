// owner: WP2
// 植物（ARCH §10.2）：二百年古槐、梧桐、灌木。
// 树干与枝条（Lathe + 收细的 Tube）合成一个网格，树叶是实例化的叶片卡（alphaTest 透贴，一次 draw call）。
// 原点在树干底部中心。叶片卡的 alphaTest 由红外替换材质继承（ARCH §6.8.2），红外下也是树叶轮廓。

import * as THREE from 'three';
import type { V3 } from '../core/types';
import { blotch, grain, paintTexture, shade } from './canvas';
import { kitMat } from './geom';
import { rng, range } from './rng';

type R = () => number;

const texCache = new Map<string, THREE.CanvasTexture>();
function cachedTex(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    t.name = key;
    texCache.set(key, t);
  }
  return t;
}

/** 树皮：竖向深沟 + 斑驳；梧桐是一块块剥落的青白斑。 */
function barkTexture(kind: 'huai' | 'wutong'): THREE.CanvasTexture {
  return cachedTex(`bark.${kind}`, () => paintTexture(256, 512, (g, w, h) => {
    const r = rng(kind === 'huai' ? 200 : 300);
    if (kind === 'huai') {
      g.fillStyle = '#3A322B';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        const x = r() * w;
        g.strokeStyle = r() < 0.5 ? 'rgba(15,12,10,0.7)' : 'rgba(95,85,72,0.35)';
        g.lineWidth = range(r, 2, 6);
        g.beginPath();
        g.moveTo(x, 0);
        let yy = 0, xx = x;
        while (yy < h) {
          yy += range(r, 20, 60);
          xx += range(r, -6, 6);
          g.lineTo(xx, yy);
        }
        g.stroke();
      }
      for (let i = 0; i < 20; i++) blotch(g, r, r() * w, r() * h, range(r, 8, 24), '#4f5a3a', 0.25, 4);
    } else {
      g.fillStyle = '#8A8676';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 60; i++) blotch(g, r, r() * w, r() * h, range(r, 10, 34), r() < 0.5 ? '#C8C3A8' : '#5E6A4E', 0.7, 5);
    }
    grain(g, w, h, 0.2, 7);
  }, { repeat: [1, 1] }));
}

/** 叶片卡：透明底上一簇叶子。槐树是羽状小叶，梧桐是几片大掌叶，灌木是碎叶。 */
function leafTexture(kind: 'huai' | 'wutong' | 'shrub'): THREE.CanvasTexture {
  return cachedTex(`leaf.${kind}`, () => paintTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = rng(kind.length * 17);
    const greens = kind === 'wutong' ? ['#3E5A2A', '#4F6B30', '#2F4A22', '#5C7536'] : ['#2E4A2A', '#3B5A30', '#27402A', '#476B38'];
    const leaf = (x: number, y: number, len: number, wid: number, ang: number) => {
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.fillStyle = greens[Math.floor(r() * greens.length)] ?? '#2E4A2A';
      g.beginPath();
      g.ellipse(0, 0, wid, len, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(20,30,15,0.5)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, -len);
      g.lineTo(0, len);
      g.stroke();
      g.restore();
    };
    if (kind === 'huai') {
      // 羽状复叶：一根叶轴两边成对的小叶
      for (let k = 0; k < 9; k++) {
        const cx = range(r, 40, 216), cy = range(r, 40, 216), ang = r() * Math.PI * 2;
        g.save();
        g.translate(cx, cy);
        g.rotate(ang);
        g.strokeStyle = '#2a3a20';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(0, -60);
        g.lineTo(0, 60);
        g.stroke();
        for (let j = -5; j <= 5; j++) {
          leaf(-9, j * 11, 9, 4.5, -0.6);
          leaf(9, j * 11, 9, 4.5, 0.6);
        }
        g.restore();
      }
    } else if (kind === 'wutong') {
      for (let k = 0; k < 6; k++) {
        const cx = range(r, 50, 206), cy = range(r, 50, 206);
        const s = range(r, 26, 40);
        for (let j = 0; j < 5; j++) leaf(cx + Math.cos(j * 1.25) * s * 0.5, cy + Math.sin(j * 1.25) * s * 0.5, s * 0.6, s * 0.35, j * 1.25 + Math.PI / 2);
      }
    } else {
      for (let k = 0; k < 90; k++) leaf(range(r, 20, 236), range(r, 20, 236), range(r, 6, 11), range(r, 3, 5), r() * Math.PI * 2);
    }
  }, { srgb: true }));
}

/** 收细的枝条：沿曲线的 Tube，半径从 r0 线性收到 r1。 */
function branch(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, seg = 12, radial = 6): THREE.BufferGeometry {
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const p = g.attributes.position as THREE.BufferAttribute;
  const ring = radial + 1;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const c = curve.getPointAt(t);
    const rr = r0 + (r1 - r0) * t;
    for (let j = 0; j < ring; j++) {
      const idx = i * ring + j;
      p.setXYZ(idx, c.x + (p.getX(idx) - c.x) * rr, c.y + (p.getY(idx) - c.y) * rr, c.z + (p.getZ(idx) - c.z) * rr);
    }
  }
  g.computeVertexNormals();
  // 树皮贴图沿枝条竖着走
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 2, uv.getX(i) * curve.getLength() * 0.6);
  return g;
}

/** 只合并 position/normal/uv（枝干各段）。 */
function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0, ni = 0;
  for (const g of geos) {
    n += g.attributes.position?.count ?? 0;
    ni += g.index ? g.index.count : g.attributes.position?.count ?? 0;
  }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    const P = g.attributes.position as THREE.BufferAttribute;
    pos.set(P.array as Float32Array, vo * 3);
    nor.set((g.attributes.normal as THREE.BufferAttribute).array as Float32Array, vo * 3);
    const U = g.attributes.uv as THREE.BufferAttribute | undefined;
    if (U) uv.set(U.array as Float32Array, vo * 2);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < P.count; i++) idx[io++] = i + vo;
    vo += P.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** 叶片卡实例：点散在若干个球团里（每根枝梢一团），卡片朝外、随机倾斜。 */
function leafCards(r: R, clusters: { c: THREE.Vector3; rad: number; n: number }[], size: number, tex: THREE.Texture, tint: string): THREE.InstancedMesh {
  const total = clusters.reduce((a, c) => a + c.n, 0);
  const mat = kitMat(`leaves.${tex.name}.${tint}`, { color: tint, map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.92 });
  const geo = new THREE.PlaneGeometry(size, size);
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, total));
  mesh.name = 'leaves';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const col = new THREE.Color();
  let i = 0;
  for (const cl of clusters) {
    for (let k = 0; k < cl.n; k++) {
      // 球团里偏外层的位置
      const u = r() * Math.PI * 2, v = Math.acos(range(r, -0.6, 1)), rr = cl.rad * Math.cbrt(range(r, 0.35, 1));
      p.set(cl.c.x + Math.sin(v) * Math.cos(u) * rr, cl.c.y + Math.cos(v) * rr * 0.7, cl.c.z + Math.sin(v) * Math.sin(u) * rr);
      e.set(range(r, -1.2, 1.2), u + range(r, -0.6, 0.6), range(r, -0.8, 0.8));
      q.setFromEuler(e);
      s.setScalar(range(r, 0.75, 1.25));
      mesh.setMatrixAt(i, m.compose(p, q, s));
      mesh.setColorAt(i, col.set(tint).multiplyScalar(range(r, 0.75, 1.2)));
      i++;
    }
  }
  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  return mesh;
}

/** 二百年古槐：Lathe 树干 + 实例化叶片卡 */
export function huaiTree(o?: { trunkR?: number; canopyR?: number; seed?: number }): { group: THREE.Group; collider: { center: V3; size: V3 } } {
  const tr = o?.trunkR ?? 1.0, cr = o?.canopyR ?? 9;
  const r = rng(o?.seed ?? 1984);
  const group = new THREE.Group();
  group.name = 'huaiTree';
  // 树干：根部外撇、中段收、到 3.4m 处分杈；表面按噪声起伏（老树疙瘩）
  const prof = [[1.35, 0], [1.12, 0.35], [1.0, 0.9], [0.92, 1.8], [0.88, 2.6], [0.95, 3.2], [0.7, 3.6]].map(([x, y]) => new THREE.Vector2((x ?? 1) * tr, y ?? 0));
  const trunk = new THREE.LatheGeometry(prof, 18);
  const tp = trunk.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), y = tp.getY(i), z = tp.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.09 * Math.sin(a * 5 + y * 1.3) + 0.06 * Math.sin(a * 11 - y * 2.1) + (y < 0.5 ? 0.12 * Math.max(0, Math.sin(a * 4)) : 0);
    tp.setXYZ(i, x * k, y, z * k);
  }
  trunk.computeVertexNormals();
  const tuv = trunk.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) * 3, tuv.getY(i) * 1.6);
  const woodGeos: THREE.BufferGeometry[] = [trunk];
  const clusters: { c: THREE.Vector3; rad: number; n: number }[] = [];
  // 主枝：从分杈处往四周、往上伸，再分出细枝；枝梢挂叶团
  const mains = 5;
  for (let i = 0; i < mains; i++) {
    const a = (i / mains) * Math.PI * 2 + range(r, -0.3, 0.3);
    const reach = cr * range(r, 0.55, 0.75);
    const p0 = new THREE.Vector3(Math.cos(a) * 0.3 * tr, 3.3, Math.sin(a) * 0.3 * tr);
    const p1 = new THREE.Vector3(Math.cos(a) * reach * 0.35, range(r, 5.2, 6.2), Math.sin(a) * reach * 0.35);
    const p2 = new THREE.Vector3(Math.cos(a) * reach * 0.75, range(r, 6.8, 7.8), Math.sin(a) * reach * 0.75);
    const p3 = new THREE.Vector3(Math.cos(a + range(r, -0.2, 0.2)) * reach, range(r, 7.2, 8.6), Math.sin(a + range(r, -0.2, 0.2)) * reach);
    const main = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
    woodGeos.push(branch(main, 0.42 * tr, 0.08, 14, 7));
    clusters.push({ c: p3.clone(), rad: range(r, 2.2, 3.0), n: 80 });
    clusters.push({ c: p2.clone().setY(p2.y + 0.8), rad: range(r, 2.0, 2.6), n: 55 });
    for (let j = 0; j < 2; j++) {
      const t = range(r, 0.45, 0.8);
      const s0 = main.getPointAt(t);
      const b = a + (j ? 1 : -1) * range(r, 0.5, 1.0);
      const len = range(r, 2.2, 3.4);
      const e1 = new THREE.Vector3(s0.x + Math.cos(b) * len, s0.y + range(r, 1.0, 2.0), s0.z + Math.sin(b) * len);
      const mid = s0.clone().lerp(e1, 0.5).add(new THREE.Vector3(0, 0.4, 0));
      woodGeos.push(branch(new THREE.CatmullRomCurve3([s0, mid, e1]), 0.12, 0.04, 8, 5));
      clusters.push({ c: e1, rad: range(r, 1.6, 2.2), n: 40 });
    }
  }
  // 树冠顶
  clusters.push({ c: new THREE.Vector3(0, 9.2, 0), rad: 3.2, n: 90 });
  const wood = new THREE.Mesh(mergeGeos(woodGeos), kitMat('bark.huai', { color: 0xffffff, map: barkTexture('huai'), roughness: 0.95 }));
  wood.name = 'huaiWood';
  group.add(wood);
  group.add(leafCards(r, clusters, 1.7, leafTexture('huai'), '#5E7A48'));
  // 树干上系的祈福红布条
  const red = kitMat('huai.ribbon', { color: '#A3161C', roughness: 0.95, side: THREE.DoubleSide });
  const ribbonGeos: THREE.BufferGeometry[] = [];
  const band = new THREE.CylinderGeometry(0.93 * tr * 1.02, 0.95 * tr * 1.02, 0.12, 18, 1, true);
  band.translate(0, 1.7, 0);
  ribbonGeos.push(band);
  for (let i = 0; i < 7; i++) {
    const a = range(r, 0, Math.PI * 2);
    const strip = new THREE.PlaneGeometry(0.07, range(r, 0.4, 0.7));
    strip.translate(0, -0.3, 0);
    strip.rotateY(-a + Math.PI / 2);
    strip.translate(Math.cos(a) * 0.97 * tr, 1.68, Math.sin(a) * 0.97 * tr);
    ribbonGeos.push(strip);
  }
  const ribbons = new THREE.Mesh(mergeGeos(ribbonGeos), red);
  ribbons.name = 'huaiRibbons';
  group.add(ribbons);
  return { group, collider: { center: [0, 2, 0], size: [2 * tr * 1.1, 4, 2 * tr * 1.1] } };
}

/** 梧桐：斑驳的直干，4m 处分三杈，大叶团。 */
export function plane_tree(o?: { seed?: number }): THREE.Group {
  const r = rng(o?.seed ?? 7);
  const group = new THREE.Group();
  group.name = 'planeTree';
  const geos: THREE.BufferGeometry[] = [];
  const trunkTop = range(r, 3.6, 4.4);
  geos.push(branch(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(range(r, -0.1, 0.1), trunkTop * 0.5, 0), new THREE.Vector3(0, trunkTop, range(r, -0.1, 0.1))]), 0.24, 0.18, 8, 8));
  const clusters: { c: THREE.Vector3; rad: number; n: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + range(r, -0.4, 0.4);
    const end = new THREE.Vector3(Math.cos(a) * range(r, 1.6, 2.4), trunkTop + range(r, 2.8, 4.0), Math.sin(a) * range(r, 1.6, 2.4));
    const mid = new THREE.Vector3(end.x * 0.4, trunkTop + 1.2, end.z * 0.4);
    geos.push(branch(new THREE.CatmullRomCurve3([new THREE.Vector3(0, trunkTop - 0.2, 0), mid, end]), 0.14, 0.05, 10, 6));
    clusters.push({ c: end, rad: range(r, 1.8, 2.4), n: 45 });
  }
  clusters.push({ c: new THREE.Vector3(0, trunkTop + 3.6, 0), rad: 2.4, n: 50 });
  const wood = new THREE.Mesh(mergeGeos(geos), kitMat('bark.wutong', { color: 0xffffff, map: barkTexture('wutong'), roughness: 0.9 }));
  wood.name = 'planeTreeWood';
  group.add(wood);
  group.add(leafCards(r, clusters, 1.5, leafTexture('wutong'), '#6B8448'));
  return group;
}

export function shrub(o?: { seed?: number }): THREE.Group {
  const r = rng(o?.seed ?? 11);
  const group = new THREE.Group();
  group.name = 'shrub';
  const n = 3 + Math.floor(r() * 3);
  const clusters = Array.from({ length: n }, () => ({ c: new THREE.Vector3(range(r, -0.4, 0.4), range(r, 0.35, 0.7), range(r, -0.4, 0.4)), rad: range(r, 0.35, 0.55), n: 14 }));
  group.add(leafCards(r, clusters, 0.7, leafTexture('shrub'), shade('#4E6B3E', range(r, 0.85, 1.1))));
  return group;
}

// ---------------------------------------------------------------- 夜空（M1c look-dev 补写，ARCH §10.2）

export interface SkyDomeOpts {
  /** 天顶色（默认 PALETTE.NIGHT #0B1020） */
  zenith?: THREE.ColorRepresentation;
  /** 地平线的天光（默认 #1C2233：比 R1 的雾色 #141A26 略亮的靛灰，雾里的楼因此比天暗） */
  horizon?: THREE.ColorRepresentation;
  /** 贴着地平线的一道窄的城市光（默认 #3A2A20：钠灯照亮的低空；R3 霓虹街可用偏红，R4 地面出口可用偏青） */
  glow?: THREE.ColorRepresentation;
  /** 低云的亮度 0..1（默认 0.5：地平线上方一层被城市光从下面照亮的云；0 = 晴夜） */
  clouds?: number;
}

const SKY_VERT = /* glsl */ `
varying vec3 vSkyDir;
void main() {
  vSkyDir = normalize( ( modelMatrix * vec4( position, 0.0 ) ).xyz );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform float uClouds;
varying vec3 vSkyDir;
float skyHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float skyNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( skyHash( i ), skyHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( skyHash( i + vec2( 0.0, 1.0 ) ), skyHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
void main() {
  vec3 d = normalize( vSkyDir );
  float y = d.y;
  // 地平线最亮，往上很快沉到天顶的靛蓝；地平线以下（被楼挡住的部分）略暗于地平线
  vec3 col = mix( uHorizon, uZenith, smoothstep( 0.0, 0.38, y ) );
  col += uGlow * exp( -max( y, 0.0 ) * 16.0 );
  col = mix( col, uHorizon * 0.55, smoothstep( 0.0, -0.2, y ) );
  // 低云：投到 y 上方的一层平面上的两层值噪声，只在地平线往上 ~35° 内、被城市光从下面照亮
  if ( uClouds > 0.0 && y > 0.0 ) {
    vec2 p = d.xz / ( y + 0.18 ) * 1.6;
    float n = skyNoise( p ) * 0.65 + skyNoise( p * 2.3 + 7.1 ) * 0.35;
    float c = smoothstep( 0.42, 0.85, n ) * ( 1.0 - smoothstep( 0.05, 0.6, y ) );
    col += ( uHorizon * 0.7 + uGlow * 0.5 ) * c * uClouds;
  }
  gl_FragColor = vec4( col, 1.0 );
}`;

/**
 * 夜空天穹（M1c look-dev 补写）：一个跟着相机走的大球，先于一切绘制（renderOrder -1000、不写深度），
 * 地平线一圈城市光、天顶靛蓝、可选一层被城市光照亮的低云——远处的楼在雾里成了**比天暗**的剪影，
 * 而不是纯色背景上漂着几扇亮窗。室外区域（R1、R3 街面）用；室内/楼道/地下通道不用（用 ctx.background 的纯色）。
 * 红外下隐藏（irHide，热像里天空就是背景色的冷黑）；不挡射线、不参与遮挡判定。ctx.add(skyDome()) 即可。
 */
export function skyDome(o?: SkyDomeOpts): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    name: 'skyDome',
    uniforms: {
      uZenith: { value: new THREE.Color(o?.zenith ?? '#0B1020') },
      uHorizon: { value: new THREE.Color(o?.horizon ?? '#1C2233') },
      uGlow: { value: new THREE.Color(o?.glow ?? '#3A2A20') },
      uClouds: { value: o?.clouds ?? 0.5 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  mat.userData.tempC = 0;
  const m = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), mat);
  m.name = 'skyDome';
  m.renderOrder = -1000;
  m.frustumCulled = false;
  m.userData.irHide = true;
  m.userData.noOcclude = true;
  m.userData.noBounds = true;
  m.raycast = () => {};
  const cp = new THREE.Vector3();
  m.onBeforeRender = (_r, _s, camera) => {
    camera.getWorldPosition(cp);
    m.position.copy(cp);
    m.updateMatrixWorld();
  };
  return m;
}
