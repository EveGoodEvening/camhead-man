// owner: WP2
// 实例化雨丝（ARCH §10.2）：面向相机细长四边形，一次 draw call；userData.irHide = userData.auxHide = true；renderOrder 5、depthWrite:false。
//
// 做法：InstancedMesh 的实例矩阵只存每根雨丝在盒子里的随机初始位置（平移）；顶点着色器里按时间下落、以相机为中心
// 在盒子内取模环绕（相机走动时雨丝不跟着走，视差正确），再沿“下落方向 × 视线”做 billboard，宽度按距离换算成约
// 1.5 像素。setIntensity 用 gl_InstanceID 的哈希决定哪些雨丝显示（淡入淡出不改 count、不重编译）。

import * as THREE from 'three';
import { RENDER_ORDER } from '../data/render';

/**
 * update(dt, cam?)：推进下落时间与淡入淡出。cam 可省（M1c look-dev 放宽：区域拿不到相机）——雨盒中心每次绘制前
 * 都按**正在渲染的相机**重算（onBeforeRender），所以第三人称、取景器、固定机位、镜面/CH2 各自看到以自己为中心的雨。
 */
export interface RainRig { mesh: THREE.InstancedMesh; update(dt: number, cam?: THREE.Camera): void; setIntensity(v01: number, fadeSec?: number): void }

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uSpeed;
uniform vec2 uWind;
uniform float uPx;
uniform float uIntensity;
varying float vAlpha;
float hash(float n) { return fract(sin(n) * 43758.5453123); }
void main() {
  vec3 seed = instanceMatrix[3].xyz;
  float id = float(gl_InstanceID);
  float h1 = hash(id * 1.37 + 0.11), h2 = hash(id * 2.71 + 3.7);
  float spd = uSpeed * (0.85 + 0.3 * h1);
  float len = 0.3 + 0.2 * h2;
  vec3 dir = normalize(vec3(uWind.x, -1.0, uWind.y));
  // 下落 + 以相机为中心的盒子内环绕
  vec3 p = seed + dir * spd * uTime;
  vec3 rel = p - uCenter + 0.5 * uBox;
  rel = mod(rel, uBox);
  vec3 world = uCenter - 0.5 * uBox + rel;
  vec3 toCam = cameraPosition - world;
  float dist = length(toCam);
  vec3 side = normalize(cross(dir, toCam / max(dist, 1e-4)));
  float w = uPx * dist;
  float on = step(hash(id * 7.13 + 1.3), uIntensity);
  vec3 pos = world + side * position.x * w * on + dir * position.y * len * on;
  vec4 mvPosition = viewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // 近处与盒子边缘淡出（避免贴脸的粗线和换位时的闪烁）
  vec3 e = abs(rel / uBox - 0.5) * 2.0;
  float edge = 1.0 - smoothstep(0.75, 1.0, max(e.x, max(e.y, e.z)));
  vAlpha = edge * smoothstep(0.4, 1.5, dist) * (0.55 + 0.45 * position.y);
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vAlpha);
  #include <fog_fragment>
}`;

/** 雨丝不透明度（M1c look-dev 冻结：1280×720 下看得见、不抢戏） */
const RAIN_OPACITY = 0.26;

/** count 由画质决定（low 1000 / mid 2000 / high 3000，见 data/render.ts 的 QUALITY） */
export function rain(o: { count: number; box: { w: number; h: number; d: number }; speed?: number; color?: THREE.ColorRepresentation }): RainRig {
  const count = Math.max(1, Math.floor(o.count));
  // 细长四边形：x ∈ [-0.5, 0.5]（宽），y ∈ [0, 1]（沿下落方向）
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(o.box.w, o.box.h, o.box.d) },
      uSpeed: { value: o.speed ?? 9 }, uWind: { value: new THREE.Vector2(0.06, 0.02) }, uPx: { value: 0.002 },
      uIntensity: { value: 1 }, uColor: { value: new THREE.Color(o.color ?? '#A9BCD2') }, uOpacity: { value: RAIN_OPACITY },
    },
  ]);
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
  });
  mat.name = 'rain';
  mat.userData.tempC = 18;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = 'rain';
  mesh.frustumCulled = false;
  mesh.renderOrder = RENDER_ORDER.rain;
  mesh.userData.irHide = true;
  mesh.userData.auxHide = true;
  mesh.userData.noOcclude = true;
  mesh.raycast = () => {};
  const m = new THREE.Matrix4();
  // 构建期随机用确定的哈希（ARCH §1.5：截图可复现）
  let s = 0x9e3779b9;
  const rnd = () => {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    m.makeTranslation((rnd() - 0.5) * o.box.w, rnd() * o.box.h, (rnd() - 0.5) * o.box.d);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;

  // 宽度 ≈ 1.5 像素：每次绘制前按当前渲染目标的高度与相机视场换算（任何相机都对）；雨盒中心跟着正在渲染的相机
  const size = new THREE.Vector2();
  const cp = new THREE.Vector3();
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    const cam = camera as THREE.PerspectiveCamera;
    const target = renderer.getRenderTarget();
    const hPx = target ? target.height : renderer.getDrawingBufferSize(size).y;
    const fov = cam.isPerspectiveCamera ? cam.getEffectiveFOV() : 50;
    uniforms.uPx.value = (1.5 * 2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, hPx);
    camera.getWorldPosition(cp);
    uniforms.uCenter.value.set(cp.x, cp.y + o.box.h * 0.25, cp.z);
  };

  let intensity = 1, from = 1, to = 1, fadeT = 1, fadeDur = 0;
  return {
    mesh,
    update(dt, cam) {
      uniforms.uTime.value = (uniforms.uTime.value + dt) % 1000;
      if (cam) {
        cam.getWorldPosition(cp);
        uniforms.uCenter.value.set(cp.x, cp.y + o.box.h * 0.25, cp.z);
      }
      if (fadeT < 1) {
        fadeT = Math.min(1, fadeT + dt / fadeDur);
        intensity = from + (to - from) * fadeT;
        uniforms.uIntensity.value = intensity;
      }
      mesh.visible = intensity > 0.001;
    },
    setIntensity(v, fadeSec = 0) {
      const target = Math.max(0, Math.min(1, v));
      if (fadeSec <= 0) {
        intensity = to = target;
        fadeT = 1;
        uniforms.uIntensity.value = intensity;
        mesh.visible = intensity > 0.001;
        return;
      }
      from = intensity;
      to = target;
      fadeT = 0;
      fadeDur = fadeSec;
      mesh.visible = true;
    },
  };
}
