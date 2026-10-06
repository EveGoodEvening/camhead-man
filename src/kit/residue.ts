// owner: WP2
// 残影点雪花旋涡、红外冷迹、阴物湿脚印贴花（ARCH §10.2）。

import * as THREE from 'three';
import type { XZ } from '../core/types';
import { setLayerRecursive } from '../core/layers';
import { FX_TIME } from '../fx/ghostMaterials';
import { PALETTE } from '../data/palette';
import { TEMP_C } from '../data/render';
import { createHumanoidInternal } from '../rigs/humanoid';
import { paintTexture } from './canvas';
import { merge } from './geom';
import { rng, range } from './rng';

const noRaycast: THREE.Mesh['raycast'] = () => {};

const VORTEX_VERT = /* glsl */ `
uniform float uTime;
attribute float aPhase;
attribute float aRadius;
attribute float aSpeed;
varying float vBright;
void main() {
  // 绕竖轴旋转、边转边往上飘，到顶了回到底（旋涡是一团 CRT 雪花）
  float t = uTime * aSpeed + aPhase;
  float h = fract(position.y + uTime * 0.12 * aSpeed);
  float r = aRadius * (0.55 + 0.45 * sin(h * 3.14159));
  vec3 p = vec3(cos(t) * r, h * 2.1, sin(t) * r);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // M4 第 2 轮：点的大小上限 6 → 4 像素；离镜头近的点淡下去，镜头离这根柱子不到 2.5m 时整柱压到 40%——
  // 取景器里近处的一整柱雪花原来盖在灶台、门神这些要看的东西前面（“▶ 残影 · R”已经指明了位置）
  gl_PointSize = clamp(34.0 / -mv.z, 1.5, 4.0);
  // 取景器变焦按“看上去的距离”算（2× 时 3m 外的柱子看着像 1.5m）：1× 取景器 fov 50° 时 projectionMatrix[1][1] = cot(25°) ≈ 2.1445
  vec4 axis = modelViewMatrix * vec4(0.0, 1.0, 0.0, 1.0);
  float apparent = length(axis.xyz) * 2.1445 / max(projectionMatrix[1][1], 0.1);
  float col = mix(0.4, 1.0, smoothstep(2.0, 2.8, apparent));
  // 电视雪花：每个点亮度随时间乱跳
  vBright = fract(sin(dot(vec2(aPhase, floor(uTime * 24.0)), vec2(12.9898, 78.233))) * 43758.5453);
  vBright *= smoothstep(0.0, 0.15, h) * (1.0 - smoothstep(0.8, 1.0, h));
  vBright *= (smoothstep(0.8, 2.6, -mv.z) * 0.7 + 0.3) * col;
}`;

const VORTEX_FRAG = /* glsl */ `
varying float vBright;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  gl_FragColor = vec4(vec3(0.75 + 0.25 * vBright), vBright * 0.85);
}`;

/**
 * 残影点雪花旋涡（layer.yin，自带动画）：约 420 个点绕一根 2.1m 高的竖轴打旋上飘、亮度像 CRT 雪花一样乱跳，
 * 底下一圈淡淡的地面光晕。动画用共享的后期动画时间 FX_TIME（游戏时间；纯装饰，不影响玩法，ARCH §1.4）。
 */
export function createResidueVortex(): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'residueVortex';
  const n = 420;
  const r = rng(4242);
  const pos = new Float32Array(n * 3), phase = new Float32Array(n), radius = new Float32Array(n), speed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3 + 1] = r();
    phase[i] = r() * Math.PI * 2;
    radius[i] = range(r, 0.12, 0.62);
    speed[i] = range(r, 0.6, 1.6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(radius, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  const uTime = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime }, vertexShader: VORTEX_VERT, fragmentShader: VORTEX_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  mat.userData.tempC = TEMP_C.yin;
  const pts = new THREE.Points(geo, mat);
  pts.name = 'vortexSnow';
  pts.frustumCulled = false;
  pts.renderOrder = 11;
  // M4 第 2 轮：按共享的后期动画时间（游戏时间，冻结时停）转，锁步截图可复现（原来用真实时钟，每张截图的雪花都不一样）
  pts.onBeforeRender = () => {
    uTime.value = FX_TIME.value % 10000;
  };
  g.add(pts);
  // 地面光晕
  const halo = new THREE.Mesh(new THREE.CircleGeometry(0.75, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    alphaMap: paintTexture(64, 64, (c, w, h) => {
      const grd = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)');
      grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = grd;
      c.fillRect(0, 0, w, h);
    }, { mask: true }),
    color: '#9fb0c0', transparent: true, depthWrite: false, opacity: 0.14, blending: THREE.AdditiveBlending,
  }));
  halo.name = 'vortexHalo';
  halo.position.y = 0.015;
  halo.raycast = noRaycast;
  halo.userData.irHide = true;
  g.add(halo);
  g.userData.irHide = true;
  // M4：回放开始时 ReplaySystem 按这个标记把残影点上的旋涡藏起来（回放里雪花不再盖住画面中央）
  g.userData.residueVortex = true;
  g.traverse(o => {
    o.userData.noOcclude = true;
    o.userData.noBounds = true;
  });
  setLayerRecursive(g, 'yin');
  return g;
}

/**
 * 红外冷迹（layer.ir_only，tempC 3）：人形的一块“凉”，按姿势摆好后合成一个网格（坐着 = 椅子上，站着、蹲着）。
 * 只在红外取景器里渲染；常光与第三人称都看不见。
 */
export function createColdTrace(shape: 'sitting' | 'standing' | 'crouching'): THREE.Object3D {
  const h = createHumanoidInternal({ height: 1.75, build: 'hunch', shirt: '#000', pants: '#000', sleeves: 'short', head: 'human' });
  h.setPose(shape === 'sitting' ? 'sit' : shape === 'crouching' ? 'crouch' : 'stand', 0);
  h.update(0, 0);
  h.root.updateWorldMatrix(true, true);
  const meshes: THREE.Mesh[] = [];
  h.root.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh) meshes.push(m);
  });
  const mat = new THREE.MeshBasicMaterial({ color: PALETTE.NIGHT });
  mat.userData.tempC = TEMP_C.cold;
  const merged = merge(meshes, mat);
  merged.name = `coldTrace.${shape}`;
  // 冷迹是一团“印子”：略微放大、边缘不那么清楚
  merged.scale.set(1.05, 1.0, 1.08);
  merged.userData.tempC = TEMP_C.cold;
  h.dispose();
  const g = new THREE.Group();
  g.name = 'coldTrace';
  g.add(merged);
  g.userData.tempC = TEMP_C.cold;
  setLayerRecursive(g, 'ir_only');
  return g;
}

let footTex: THREE.CanvasTexture | null = null;
function footprintTexture(): THREE.CanvasTexture {
  footTex ??= paintTexture(64, 128, (g, w, h) => {
    // 湿布鞋印：前掌 + 后跟，边缘有水晕
    g.clearRect(0, 0, w, h);
    const blob = (x: number, y: number, rx: number, ry: number, a: number) => {
      const grd = g.createRadialGradient(x, y, 1, x, y, Math.max(rx, ry));
      grd.addColorStop(0, `rgba(255,255,255,${a})`);
      grd.addColorStop(0.7, `rgba(255,255,255,${a * 0.8})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    };
    blob(w / 2, h * 0.3, w * 0.36, h * 0.25, 0.95);
    blob(w / 2, h * 0.75, w * 0.28, h * 0.17, 0.9);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(w * 0.35, h * 0.5, w * 0.3, h * 0.12);
  }, { mask: true });
  return footTex;
}

/**
 * 阴物湿脚印贴花（layer.yin，只在取景器可见；透明贴花，irHide）：沿折线每隔 stride（默认 0.65m）左右交替放一只脚印。
 * R1 用它画 GDD §4.1 的两串：rp.r1_gate → 三号楼单元门（王奶奶）；rp.r1_gate → 门卫室窗外 → 出院门往东口（陆师傅）
 */
export function createFootprints(path: readonly XZ[], o?: { stride?: number; seed?: number; y?: number }): THREE.InstancedMesh {
  const stride = o?.stride ?? 0.65;
  const y = o?.y ?? 0.012;
  const r = rng(o?.seed ?? 77);
  const xf: THREE.Matrix4[] = [];
  // 沿折线按弧长每 stride 取一个点，左右脚交替（右脚在行进方向右侧 0.09m）
  let next = stride * 0.5, acc = 0, side = 1;
  const up = new THREE.Vector3(0, 1, 0), flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!, b = path[i + 1]!;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len, uz = dz / len;
    // 平放后贴图的脚尖朝 -z；绕 y 转 atan2(-ux, -uz) 让脚尖指向行进方向
    const heading = Math.atan2(-ux, -uz);
    while (next <= acc + len) {
      const d = next - acc;
      const px = a[0] + ux * d - uz * 0.09 * side + range(r, -0.02, 0.02);
      const pz = a[1] + uz * d + ux * 0.09 * side + range(r, -0.02, 0.02);
      const q = new THREE.Quaternion().setFromAxisAngle(up, heading + range(r, -0.12, 0.12) - side * 0.08).multiply(flat);
      xf.push(new THREE.Matrix4().compose(new THREE.Vector3(px, y, pz), q, new THREE.Vector3(side * range(r, 0.95, 1.05), 1, 1)));
      side = -side;
      next += stride;
    }
    acc += len;
  }
  const mat = new THREE.MeshBasicMaterial({
    color: PALETTE.GHOST, alphaMap: footprintTexture(), transparent: true, depthWrite: false, opacity: 0.55, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  mat.userData.tempC = TEMP_C.yin;
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.11, 0.27), mat, Math.max(1, xf.length));
  mesh.name = 'footprints';
  mesh.count = xf.length;
  xf.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  mesh.renderOrder = 3;
  mesh.userData.irHide = true;
  mesh.userData.noOcclude = true;
  mesh.raycast = noRaycast;
  setLayerRecursive(mesh, 'yin');
  return mesh;
}
