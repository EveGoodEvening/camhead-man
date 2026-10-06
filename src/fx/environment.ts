// owner: WP3
// 区域环境贴图（ARCH §8.3）：程序化“夜景环境”→ PMREM 低强度环境贴图，按区域色调缓存。
// 引擎（WP1）拿返回的贴图写 scene.environment，并把 AreaDef.environment.intensity 写进 scene.environmentIntensity。
// 注意：r186 在用 scene.environment 时会把 envMapIntensity 统一设成 scene.environmentIntensity，材质自己的 envMapIntensity 不起作用
// （除非材质自己设了 envMap：主角头部就这样做，见 rigs/cameraHead.ts）。
//
// M1c look-dev：原来用的 RoomEnvironment 是一间被 900cd 点光照亮的白房间加六块大面光——当夜景的环境贴图时，
// 漫反射底光太亮（整个场景被抬成灰蓝），湿地面与瓷砖还会映出摄影棚式的白色方块。换成一张“夜空”：
//   - 天穹：天顶靛蓝近黑，地平线一圈很淡的城市光（带区域色），地平线以下是暗的湿地；
//   - 一圈远处的“灯”：几颗小而亮的光斑（区域色为主，另有两颗偏白的窗光），金属、镜头玻璃、湿地面上映出点状高光；
//   - 头顶一片很暗的冷色云光：朝上的金属面（铁皮帽）有一层淡淡的冷光泽。
// 漫反射几乎只来自光斑与云光，所以 intensity 可以开到 ~1 让金属有反光，而墙面不会被抬亮。
// 色调只取色相与饱和度：按最大分量归一（暗色的 tint 不会把环境贴图压成全黑），亮度由 intensity 决定。

import * as THREE from 'three';

const cache = new Map<string, THREE.WebGLRenderTarget>();

/** tint → 归一化后的线性色（最大分量 = 1；纯黑退化为白）。 */
export function normalizedTint(tint: THREE.ColorRepresentation): THREE.Color {
  const c = new THREE.Color(tint);
  const m = Math.max(c.r, c.g, c.b);
  return m > 1e-4 ? c.multiplyScalar(1 / m) : c.setRGB(1, 1, 1);
}

/** 夜景环境的各项亮度（线性；look-dev 冻结，改这里会改所有区域的金属/玻璃观感）。 */
export const NIGHT_ENV = {
  /** 天顶（靛蓝近黑） */
  zenith: [0.004, 0.007, 0.016] as const,
  /** 地平线城市光：区域色 × 这个亮度 */
  horizon: 0.05,
  /** 地平线以下（暗湿地） */
  ground: [0.004, 0.0045, 0.006] as const,
  /** 远处的灯：区域色光斑的亮度与颗数；偏白窗光的亮度 */
  lamp: 14,
  lamps: 5,
  window: 5,
  /** 头顶云光（冷色） */
  cloud: [0.035, 0.04, 0.06] as const,
} as const;

/** 构造夜景环境场景（PMREM 用；调用方负责 dispose）。 */
export function nightEnvironmentScene(tint: THREE.Color): THREE.Scene {
  const scene = new THREE.Scene();
  const E = NIGHT_ENV;
  // 天穹：按方向的 y 分量上色（顶点色），BackSide
  const dome = new THREE.SphereGeometry(40, 48, 24);
  const pos = dome.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const zen = new THREE.Color().setRGB(E.zenith[0], E.zenith[1], E.zenith[2], THREE.LinearSRGBColorSpace);
  const hor = tint.clone().multiplyScalar(E.horizon).lerp(zen, 0.35);
  const gnd = new THREE.Color().setRGB(E.ground[0], E.ground[1], E.ground[2], THREE.LinearSRGBColorSpace);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 40;
    if (y >= 0) c.copy(hor).lerp(zen, Math.pow(Math.min(1, y / 0.55), 0.6));
    else c.copy(hor).lerp(gnd, Math.min(1, -y / 0.12));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  dome.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const domeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false });
  scene.add(new THREE.Mesh(dome, domeMat));

  const blob = (dir: THREE.Vector3, r: number, color: THREE.Color): void => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color, fog: false, toneMapped: false }));
    m.position.copy(dir.normalize().multiplyScalar(34));
    scene.add(m);
  };
  // 远处的灯：地平线上 6°–24°，方位角错开（固定布局，所有区域一致，截图可复现）
  const lampCol = new THREE.Color(1, 1, 1).lerp(tint, 0.85).multiplyScalar(E.lamp);
  const az = [20, 95, 160, 230, 300];
  const el = [9, 18, 6, 14, 22];
  for (let i = 0; i < E.lamps; i++) {
    const a = THREE.MathUtils.degToRad(az[i] ?? 0), e = THREE.MathUtils.degToRad(el[i] ?? 10);
    blob(new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)), 1.1, lampCol);
  }
  // 两颗偏白的窗光（冷一点）
  const winCol = new THREE.Color().setRGB(0.9, 0.95, 1.0, THREE.LinearSRGBColorSpace).multiplyScalar(E.window);
  blob(new THREE.Vector3(-0.6, 0.35, -0.7), 0.9, winCol);
  blob(new THREE.Vector3(0.75, 0.25, 0.6), 0.7, winCol);
  // 头顶云光：一块很大的暗冷色面
  const cloud = new THREE.Mesh(
    new THREE.CircleGeometry(22, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(E.cloud[0], E.cloud[1], E.cloud[2], THREE.LinearSRGBColorSpace), side: THREE.DoubleSide, fog: false, toneMapped: false }),
  );
  cloud.rotation.x = Math.PI / 2;
  cloud.position.y = 30;
  scene.add(cloud);
  return scene;
}

function disposeScene(s: THREE.Scene): void {
  s.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  });
}

/** = new THREE.PMREMGenerator(renderer).fromScene(nightEnvironmentScene(tint), 0.04).texture；按 tint 缓存，context restored 时重建 */
export function areaEnvironment(renderer: THREE.WebGLRenderer, tint: THREE.ColorRepresentation): THREE.Texture {
  const c = normalizedTint(tint);
  const key = c.getHexString(THREE.LinearSRGBColorSpace);
  const hit = cache.get(key);
  if (hit) return hit.texture;
  const env = nightEnvironmentScene(c);
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    const rt = pmrem.fromScene(env, 0.04);
    rt.texture.name = `env:${key}`;
    cache.set(key, rt);
    return rt.texture;
  } finally {
    disposeScene(env);
    pmrem.dispose();
  }
}

/** context restored 后清空缓存（下次 areaEnvironment 重建；M1a 补写，WP1 调用）。 */
export function resetEnvironmentCache(): void {
  for (const rt of cache.values()) rt.dispose();
  cache.clear();
}

/** 缓存中的环境贴图数（自测用）。 */
export function environmentCacheSize(): number {
  return cache.size;
}
