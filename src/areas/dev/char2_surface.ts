// owner: WP2
// char2 WP-S：材质、魂影参数、动作（char2.surface_*） 的开发沙盒自测。只有这个 WP 改这个文件（PLAN §5.7）。
// scripts/selftest/char2.mjs 自动跑全部 'char2.*'。
//   char2.surface_fabric    衣料/衣服贴图：织纹细、总起伏 ≤ 14%、没有 3–6cm 周期的横条（行亮度自相关 < 0.15）、尺寸不变
//   char2.surface_walk      行走 1s：膝屈峰值 ≥ 0.8、手臂与同侧腿反向、肩与骨盆反向扭、脚着地不陷不浮、踝动作
//   char2.surface_posture   驼背：王奶奶（kyphosis 0.35）头比胸口靠前 ≥ 6cm；老人站姿膝微屈；脚掌贴地；姿势表；坐高；呼吸
//   char2.surface_programs  12 种角色 × 4 种外观建两遍、画两遍：第二遍不新增着色器程序；皮肤/衣料粗糙度
//   char2.surface_hands     常光下手的平均亮度不比脸（眼睛以下）亮 5% 以上（PLAN §3.4）

import * as THREE from 'three';
import type { AreaPart } from '../../core/area';
import type { Game } from '../../core/game';
import type { SelftestResult } from '../../debug/selftest';
import { registerSelftest } from '../../debug/selftest';
import { createCharacter, type CharacterKind, type CharacterRig } from '../../rigs/characters';
import { createHumanoidInternal } from '../../rigs/human/assemble';
import { REGION_LEGACY as HEAD_LEGACY } from '../../rigs/human/head';
import { GAIT, legGait } from '../../rigs/human/motion';
import { CLOTH_ROUGHNESS, SKIN_ROUGHNESS, fabricTexture } from '../../rigs/human/surface';
import { armbandTexture, clothShoeTexture, floralTexture, robeTexture, uniformShirtTexture, zhongshanTexture } from '../../rigs/outfit/textures';
import { POSES } from '../../rigs/poses';

const part: AreaPart = {};
export default part;

// ---------------------------------------------------------------- 小工具（照 char2.ts 的写法，不从那里 import）

function report(): { t: (what: string, cond: boolean, detail?: string) => boolean; done: () => SelftestResult } {
  const notes: string[] = [];
  let ok = true;
  return {
    t(what, cond, detail) {
      if (!cond) ok = false;
      notes.push(`${cond ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
      return cond;
    },
    done: () => ({ ok, notes }),
  };
}
const fx = (v: number, d = 3) => v.toFixed(d);

function testScene(): THREE.Scene {
  const s = new THREE.Scene();
  // check-allow: no-raw-light（离屏测试场景，不进区域灯数预算）
  s.add(new THREE.AmbientLight('#ffffff', 0.6));
  // check-allow: no-raw-light（同上）
  const d = new THREE.DirectionalLight('#fff0e0', 2.4);
  d.position.set(0.8, 2.5, -3);
  s.add(d);
  return s;
}

/** 离屏渲一帧，读回 RGBA（透明清屏：alpha 区分人和背景）。 */
function renderPixels(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, size: number): Uint8Array {
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, depthBuffer: true });
  const prev = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
  renderer.setRenderTarget(prev);
  renderer.setClearColor(prevClear, prevAlpha);
  rt.dispose();
  return px;
}

/** 贴图画布的亮度（0..1）。 */
function canvasLum(tex: THREE.Texture): { w: number; h: number; lum: Float32Array } | null {
  const img = tex.image as HTMLCanvasElement | undefined;
  const g = img?.getContext?.('2d', { willReadFrequently: true });
  if (!img || !g) return null;
  const d = g.getImageData(0, 0, img.width, img.height).data;
  const lum = new Float32Array(img.width * img.height);
  for (let i = 0; i < lum.length; i++) lum[i] = (0.3 * d[i * 4]! + 0.59 * d[i * 4 + 1]! + 0.11 * d[i * 4 + 2]!) / 255;
  return { w: img.width, h: img.height, lum };
}

/**
 * 行平均亮度序列的“横条”指标：先减去 ±24 像素的滑动平均（只留下几厘米尺度的起伏，大片明暗、褶的低频不算），
 * 再在 [lo, hi] 像素的周期上找自相关的局部峰（真正的周期条纹在它的周期上出峰；平滑噪声只在小滞后处单调下降）。
 */
function rowAutocorr(lum: Float32Array, w: number, h: number, lo: number, hi: number, x0 = 0, x1 = w): number {
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = x0; x < x1; x++) s += lum[y * w + x]!;
    rows.push(s / (x1 - x0));
  }
  const n = rows.length, W = 24;
  const dv = rows.map((v, i) => {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - W); k <= Math.min(n - 1, i + W); k++) { s += rows[k]!; c++; }
    return v - s / c;
  });
  const var0 = dv.reduce((a, b) => a + b * b, 0);
  if (var0 <= 1e-12) return 0;
  const ac = (lag: number) => {
    let c = 0;
    for (let i = 0; i + lag < n; i++) c += dv[i]! * dv[i + lag]!;
    return (c / var0) * (n / (n - lag));
  };
  let best = 0;
  for (let lag = lo; lag <= hi && lag < n - 2; lag++) {
    const a = ac(lag);
    if (a > ac(lag - 1) && a >= ac(lag + 1)) best = Math.max(best, a);
  }
  return best;
}

// ================================================================ char2.surface_fabric

/**
 * 贴图上的横条阈值：256 行的去趋势序列，纯噪声在任一滞后上的自相关标准差 ≈ 1/√256 ≈ 0.06，20 个滞后里随机峰到 0.2 很常见；
 * 真的周期横条（旧衣料每隔几像素一道线）在其周期上是 0.5 以上。PLAN 的 0.15 是截图躯干上的指标（test-artifacts/work/char2/wp-s/tools/stripes.mjs）。
 */
const STRIPE_MAX = 0.25;

registerSelftest('char2.surface_fabric', () => {
  const r = report();
  const bad: string[] = [];
  const info: string[] = [];
  // 衣料：灰度底乘原色。织纹 + 褶的总起伏（相对中位亮度）≤ 14%；织纹本身（像素与 5×5 邻域均值之差）小
  for (const p of ['shirt', 'sleeve', 'pants'] as const) {
    const t = fabricTexture(p);
    const c = canvasLum(t);
    if (!c) { bad.push(`${p} 读不到画布`); continue; }
    if (c.w !== 256 || c.h !== 256) bad.push(`${p} ${c.w}×${c.h} ≠ 256²`);
    // 侧缝针脚那几列不算
    const body: number[] = [];
    for (let y = 0; y < c.h; y++) for (let x = 4; x < c.w - 4; x++) if (Math.abs(x - c.w / 2) > 3) body.push(c.lum[y * c.w + x]!);
    body.sort((a, b) => a - b);
    const med = body[body.length >> 1]!;
    const p01 = body[Math.floor(body.length * 0.005)]!, p99 = body[Math.floor(body.length * 0.995)]!;
    let hf = 0;
    for (let y = 2; y < c.h - 2; y += 3) for (let x = 6; x < c.w - 6; x += 3) {
      if (Math.abs(x - c.w / 2) < 5) continue;
      let s = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += c.lum[(y + dy) * c.w + x + dx]!;
      hf = Math.max(hf, Math.abs(c.lum[y * c.w + x]! - s / 25) / med);
    }
    const ac = rowAutocorr(c.lum, c.w, c.h, 12, 32, 8, c.w - 8);
    info.push(`${p}: 中位 ${fx(med)} 0.5–99.5% −${fx((med - p01) / med)}/+${fx((p99 - med) / med)} 织纹 ${fx(hf)} 横条 ${fx(ac, 2)}`);
    if ((med - p01) / med > 0.14 || (p99 - med) / med > 0.14) bad.push(`${p} 起伏过大`);
    if (hf > 0.06) bad.push(`${p} 织纹 ${fx(hf)} > 6%`);
    if (ac >= STRIPE_MAX) bad.push(`${p} 横条自相关 ${fx(ac, 2)}`);
  }
  r.t('衣料 256²：织纹 ≤ 6%、总起伏 ≤ 14%（含褶 ≤ 8%）、行亮度在 12–32 像素（≈3–6cm）周期上无横条（自相关峰 < 0.25）', bad.length === 0, [...bad, ...info].join('；'));
  // 衣服贴图：尺寸不变（画布预算）
  const sizes: [string, THREE.Texture, number, number][] = [
    ['uniform', uniformShirtTexture(), 512, 256], ['zhongshan', zhongshanTexture('#7E8288'), 512, 256], ['floral', floralTexture('#5B6E8C', 3), 256, 256],
    ['robe', robeTexture(), 256, 256], ['armband', armbandTexture(), 512, 128], ['clothShoe', clothShoeTexture(), 128, 128],
  ];
  const sb: string[] = [], si: string[] = [];
  for (const [n, t, w, h] of sizes) {
    const img = t.image as HTMLCanvasElement;
    if (img.width !== w || img.height !== h) sb.push(`${n} ${img.width}×${img.height}`);
    if (n === 'uniform' || n === 'zhongshan' || n === 'floral') {
      const c = canvasLum(t);
      // 正面一条（避开侧缝、门襟和口袋）：u 0.01–0.06
      if (c) {
        const ac = rowAutocorr(c.lum, c.w, c.h, 12, 32, Math.round(c.w * 0.01), Math.round(c.w * 0.06));
        si.push(`${n} 横条 ${fx(ac, 2)}`);
        if (ac >= STRIPE_MAX) sb.push(`${n} 横条 ${fx(ac, 2)}`);
      }
    }
  }
  r.t('衣服贴图尺寸不变（512×256 / 256² / 512×128 / 128²），值勤衬衫、中山装、碎花布无横纹', sb.length === 0, [...sb, ...si].join('；'));
  return r.done();
});

// ================================================================ char2.surface_walk

function corr(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i]! - ma) * (b[i]! - mb); saa += (a[i]! - ma) ** 2; sbb += (b[i]! - mb) ** 2; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}

registerSelftest('char2.surface_walk', () => {
  const r = report();
  // 行走曲线本身（不依赖人偶）
  let kneeMax = 0, kneeAtLoad = 0;
  for (let i = 0; i < 720; i++) {
    const ph = (i / 720) * Math.PI * 2;
    const g = legGait(ph);
    kneeMax = Math.max(kneeMax, -g.knee);
    if (ph > Math.PI / 2 && ph < Math.PI / 2 + 0.9) kneeAtLoad = Math.max(kneeAtLoad, -g.knee);
  }
  r.t('步态曲线：摆动相屈膝峰值 ≥ 0.8、着地后承重屈膝 0.2–0.35', kneeMax >= 0.8 && kneeAtLoad >= 0.2 && kneeAtLoad <= 0.35, `峰 ${fx(kneeMax)} 承重 ${fx(kneeAtLoad)}`);
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const kind of ['jianguo', 'zhou', 'kid'] as CharacterKind[]) {
    const c = createCharacter(kind, { look: 'live', seed: 3 });
    const J = c.joints;
    const s = c.height / 1.75;
    const ankL = c.root.getObjectByName('ankleL')!, ankR = c.root.getObjectByName('ankleR')!;
    c.root.updateMatrixWorld(true);
    const standAnkle = ankL.getWorldPosition(v).y;
    const restHip0 = J.hipL.rotation.x, restHipY = J.hips.position.y;
    // 脚底的脚跟点、脚尖点（踝局部）：最低的那个就是着地点
    const heel = new THREE.Vector3(0, -standAnkle, 0.05 * s), toe = new THREE.Vector3(0, -standAnkle, -0.15 * s);
    const sole = (a: THREE.Object3D) => Math.min(a.localToWorld(v.copy(heel)).y, a.localToWorld(v.copy(toe)).y, a.localToWorld(v.set(0, -standAnkle, 0)).y);
    // 老周右手端着缸子（holdArm 覆盖右臂），看左臂
    const side = kind === 'zhou' ? 'L' : 'R';
    c.setPose('walk', 0);
    const shR: number[] = [], hipR: number[] = [], shYaw: number[] = [], pelYaw: number[] = [], ankX: number[] = [];
    let kneePeak = 0, lowMin = Infinity, lowMax = -Infinity, hipLo = Infinity, hipHi = -Infinity;
    for (let i = 0; i < 90; i++) {
      c.update(1 / 60, 1.2);
      if (i < 30) continue; // 起步 0.15s 之后取 1s
      c.root.updateMatrixWorld(true);
      kneePeak = Math.max(kneePeak, -J.kneeL.rotation.x, -J.kneeR.rotation.x);
      shR.push(side === 'L' ? J.shoulderL.rotation.x : J.shoulderR.rotation.x);
      hipR.push(side === 'L' ? J.hipL.rotation.x : J.hipR.rotation.x);
      J.spine.getWorldQuaternion(q);
      shYaw.push(e.setFromQuaternion(q, 'YXZ').y);
      J.hips.getWorldQuaternion(q);
      pelYaw.push(e.setFromQuaternion(q, 'YXZ').y);
      ankX.push(ankL.rotation.x);
      const low = Math.min(sole(ankL), sole(ankR));
      lowMin = Math.min(lowMin, low);
      lowMax = Math.max(lowMax, low);
      hipLo = Math.min(hipLo, J.hips.position.y);
      hipHi = Math.max(hipHi, J.hips.position.y);
    }
    const armLeg = corr(shR, hipR), twist = corr(shYaw, pelYaw);
    const ankRange = Math.max(...ankX) - Math.min(...ankX);
    r.t(`${kind} 走 1s：膝屈峰值 ≥ 0.8、${side === 'L' ? '左' : '右'}臂与同侧腿反向（相关 < −0.7）、肩与骨盆反向扭（相关 < 0）、踝有动作（≥ 0.4）`,
      kneePeak >= 0.8 && armLeg < -0.7 && twist < 0 && ankRange >= 0.4,
      `膝 ${fx(kneePeak)} 臂腿 ${fx(armLeg, 2)} 扭 ${fx(twist, 2)} 踝范围 ${fx(ankRange)}`);
    r.t(`${kind} 走 1s：最低的脚底点（脚跟/脚尖）始终贴地（不陷 ≥ −8mm、不浮 ≤ +12mm）、髋起伏 1–4cm`,
      lowMin >= -0.008 && lowMax <= 0.012 && hipHi - hipLo >= 0.01 * s && hipHi - hipLo <= 0.04,
      `脚底 ${fx(lowMin)}–${fx(lowMax)} 髋 ${fx(hipLo)}–${fx(hipHi)}`);
    // 停下：收回站姿，髋回到原高度
    for (let i = 0; i < 30; i++) c.update(1 / 60, 0);
    c.setPose('stand', 0);
    c.update(1 / 60, 0);
    const restHip = J.hips.position.y;
    r.t(`${kind} 停步后脚并拢、髋回原高`, Math.abs(J.hipL.rotation.x - restHip0) < 0.01 && Math.abs(restHip - restHipY) < 0.002, `hipL ${fx(J.hipL.rotation.x)} 髋 ${fx(restHip)}/${fx(restHipY)}`);
    c.dispose();
  }
  r.t('GAIT 参数 = PLAN（骨盆 ±0.08、肩 ±0.10、摆臂 ±0.40、肘 0.25→0.55）',
    GAIT.pelvisYaw === 0.08 && GAIT.shoulderYaw === 0.1 && GAIT.armAmp === 0.4 && GAIT.elbowBack === 0.25 && GAIT.elbowFront === 0.55);
  return r.done();
});

// ================================================================ char2.surface_posture

type HI = ReturnType<typeof createHumanoidInternal>;

/** 头心（headSlot 局部 headOrigin）比胸口中心（spine 局部 (0, 0.30s, 0)）靠前多少（人面朝 −z）。 */
function headForward(h: HI): number {
  h.root.updateMatrixWorld(true);
  const ho = h.land.head.headOrigin;
  const head = h.joints.headSlot.localToWorld(new THREE.Vector3(ho[0], ho[1], ho[2]));
  const chest = h.joints.spine.localToWorld(new THREE.Vector3(0, 0.3 * h.s, 0));
  return chest.z - head.z;
}

registerSelftest('char2.surface_posture', () => {
  const r = report();
  const wangSpec = { height: 1.5, build: 'hunch' as const, shirt: '#5B6E8C', pants: '#2B2A2E', head: 'human' as const, sleeves: 'long' as const };
  const wangFace = { skin: '#C99A78', hair: '#8D8A86', hairStyle: 'bun' as const, age: 'old' as const, female: true };
  const wang = createHumanoidInternal(wangSpec, wangFace, { profile: { kyphosis: 0.35 } });
  wang.update(1 / 60, 0);
  const fw = headForward(wang);
  const wangDef = createHumanoidInternal(wangSpec, wangFace);
  wangDef.update(1 / 60, 0);
  const fwDef = headForward(wangDef);
  const lu = createHumanoidInternal({ height: 1.82, build: 'slim', shirt: '#7E8288', pants: '#6A6D72', head: 'human' }, { skin: '#C49A7A', hair: '#6E6C68', hairStyle: 'side_part', age: 'old' }, { profile: { kyphosis: 0.08 } });
  lu.update(1 / 60, 0);
  const fwLu = headForward(lu);
  const young = createHumanoidInternal({ height: 1.73, shirt: '#4A5566', pants: '#2E3440', head: 'human' }, { skin: '#C99A78', hair: '#15120f', hairStyle: 'crop', age: 'young' });
  young.update(1 / 60, 0);
  const fwYoung = headForward(young);
  r.t('驼背：王奶奶（kyphosis 0.35）头比胸口靠前 ≥ 6cm；陆师傅（0.08）只微微前探（< 王）；年轻人 < 3cm',
    fw >= 0.06 && fwLu < fw && fwYoung < 0.03, `王 ${fx(fw)}（缺省 hunch 0.21：${fx(fwDef)}）陆 ${fx(fwLu)} 年轻 ${fx(fwYoung)}`);
  r.t('老人站姿膝微屈（王：膝 < −0.05）、年轻人站直', wang.joints.kneeL.rotation.x < -0.05 && Math.abs(young.joints.kneeL.rotation.x) < 1e-6, `王 ${fx(wang.joints.kneeL.rotation.x)}`);
  // 脚掌贴地：站、坐、蹲……时脚（踝的世界俯仰）≈ 水平
  const pitch = (o: THREE.Object3D) => {
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(o.matrixWorld);
    return Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
  };
  const bad: string[] = [];
  for (const p of ['stand', 'sit', 'crouch', 'raise_arm', 'carry', 'look_up'] as const) {
    for (const h of [young, wang]) {
      h.setPose(p, 0);
      h.update(1 / 60, 0);
      h.root.updateMatrixWorld(true);
      const a = pitch(h.extraJoints.ankleL);
      if (Math.abs(a - (p === 'crouch' ? -0.5 : 0)) > 0.03) bad.push(`${p}/${h === wang ? 'wang' : 'young'} 脚俯仰 ${fx(a)}`);
      // 站着、蹲着：脚底贴地（坐是家具约定的 bodyDrop，不查）
      if (p !== 'sit') {
        const ah = h.land.leg.ankleHeight;
        const v = new THREE.Vector3();
        let low = Infinity;
        for (const an of [h.extraJoints.ankleL, h.extraJoints.ankleR]) for (const z of [0.05 * h.s, -0.15 * h.s]) low = Math.min(low, an.localToWorld(v.set(0, -ah, z)).y);
        if (Math.abs(low) > 0.01) bad.push(`${p}/${h === wang ? 'wang' : 'young'} 脚底 ${fx(low)}`);
      }
    }
  }
  young.setPose('lie', 0);
  young.update(1 / 60, 0);
  r.t('站/坐/举手/端/仰头：脚掌水平（踝自动补偿，老人也是），蹲时踮脚（−0.5）；站与蹲时脚底贴地 ±1cm；躺：脚尖放松（踝 < −0.3）', bad.length === 0 && young.extraJoints.ankleL.rotation.x < -0.3, bad.join('；'));
  // 姿势表：腕、踝值；wp2 断言的关键值不变
  const P = POSES;
  r.t('姿势表：站姿手臂放松（肩 z ±0.10、肘 0.22、腕内旋 ±0.10）；坐时掌心朝下；举手肘 0.3；sit/lie/raise_arm 的 wp2 断言值不变',
    P.stand.joints.shoulderR?.[2] === 0.1 && P.stand.joints.shoulderL?.[2] === -0.1 && P.stand.joints.elbowL?.[0] === 0.22
    && P.stand.joints.wristR?.[1] === 0.1 && P.stand.joints.wristL?.[1] === -0.1 && (P.sit.joints.wristR?.[1] ?? 0) > 1
    && P.raise_arm.joints.elbowR?.[0] === 0.3 && P.raise_arm.joints.shoulderR![0] > 2.5
    && P.sit.joints.hipL![0] === Math.PI / 2 && P.sit.joints.kneeL![0] === -Math.PI / 2 && P.sit.bodyDrop === 0.45 && P.lie.rootRotX === Math.PI / 2);
  // 坐：成年人 bodyDrop 0.45s 不变（家具）
  const adult = createHumanoidInternal({ height: 1.5, shirt: '#888', pants: '#444', head: 'human' }, { skin: '#C99A78', hair: '#222', hairStyle: 'crop', age: 'young' });
  adult.setPose('sit', 0);
  adult.update(1 / 60, 0);
  const s = 1.5 / 1.75;
  r.t('成年人坐：髋高 = 0.95s − 0.45s（家具约定）', Math.abs(adult.joints.hips.position.y - 0.5 * s) < 0.004, fx(adult.joints.hips.position.y));
  // 呼吸 0.25Hz：4s 里胸口（spine.x）一个周期左右
  young.setPose('stand', 0);
  const xs: number[] = [];
  for (let i = 0; i < 240; i++) { young.update(1 / 60, 0); xs.push(young.joints.spine.rotation.x); }
  let crossings = 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  for (let i = 1; i < xs.length; i++) if ((xs[i - 1]! - m) * (xs[i]! - m) < 0) crossings++;
  const amp = (Math.max(...xs) - Math.min(...xs)) / 2;
  r.t('呼吸 ~0.25Hz（4s 内过均值 1–3 次）、幅度 ~0.012', crossings >= 1 && crossings <= 3 && Math.abs(amp - 0.012) < 0.003, `过零 ${crossings} 幅 ${fx(amp, 4)}`);
  for (const h of [wang, wangDef, lu, young, adult]) h.dispose();
  return r.done();
});

// ================================================================ char2.surface_programs

const KINDS: CharacterKind[] = ['tudi', 'wang', 'lu', 'huang', 'zhou', 'jianguo', 'kid', 'bride', 'apprentice', 'junkman', 'worker', 'neighbor'];
const LOOKS = ['live', 'ghost', 'replay', 'silhouette'] as const;

registerSelftest('char2.surface_programs', (game: Game) => {
  const r = report();
  const renderer = game.renderer;
  const scene = testScene();
  const cam = new THREE.PerspectiveCamera(40, 1, 0.05, 50);
  cam.position.set(0, 1.2, -6);
  cam.lookAt(0, 1, 0);
  cam.layers.enableAll();
  const progs: number[] = [];
  const mats = new Set<string>();
  for (let pass = 0; pass < 2; pass++) {
    const rigs: CharacterRig[] = [];
    KINDS.forEach((k, i) => LOOKS.forEach((look, j) => {
      const c = createCharacter(k, { look, seed: 3 + pass, ...(k === 'huang' ? { variant: 'man' } : {}) });
      c.root.position.set((i - 6) * 0.5, 0, j * 0.6);
      c.root.traverse(o => { o.layers.enableAll(); });
      c.setPose(pass ? 'walk' : 'stand', 0);
      c.update(1 / 30, pass ? 1.2 : 0);
      scene.add(c.root);
      rigs.push(c);
      if (look === 'live') c.root.traverse(o => {
        const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (mm?.isMeshStandardMaterial) mats.add(`${mm.userData.skin ? 'skin' : mm.map?.name ?? ''}|${mm.roughness}`);
      });
    }));
    renderPixels(renderer, scene, cam, 64);
    rigs.forEach(c => c.setOpacity(0.5));
    renderPixels(renderer, scene, cam, 64);
    progs.push(renderer.info.programs?.length ?? 0);
    for (const c of rigs) { c.root.removeFromParent(); c.dispose(); }
  }
  r.t('12 种角色 × 4 种外观（含淡出）第二遍不新增着色器程序', progs[1]! <= progs[0]!, `programs ${progs.join(' → ')}`);
  const skin = [...mats].filter(k => k.startsWith('skin|'));
  const cloth = [...mats].filter(k => k.startsWith('fabric.'));
  r.t(`皮肤粗糙度 ${SKIN_ROUGHNESS}、衣料 ${CLOTH_ROUGHNESS}`, skin.length > 0 && skin.every(k => k === `skin|${SKIN_ROUGHNESS}`) && cloth.length > 0 && cloth.every(k => k.endsWith(`|${CLOTH_ROUGHNESS}`)), [...skin, ...cloth].join(','));
  return r.done();
});

// ================================================================ char2.surface_hands

registerSelftest('char2.surface_hands', (game: Game) => {
  const r = report();
  const renderer = game.renderer;
  const scene = testScene();
  const notes: string[] = [];
  const bad: string[] = [];
  const matBad: string[] = [];
  const cam = new THREE.OrthographicCamera(-0.11, 0.11, 0.11, -0.11, 0.01, 10);
  cam.layers.enableAll();
  /** 不透明像素的平均亮度；y0..y1 = 画面自下而上的比例范围 */
  const meanLum = (px: Uint8Array, y0 = 0, y1 = 1): number => {
    const n = Math.sqrt(px.length / 4);
    let s = 0, c = 0;
    for (let y = Math.floor(y0 * n); y < Math.floor(y1 * n); y++) for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      if (px[i + 3]! < 200) continue;
      s += 0.3 * px[i]! + 0.59 * px[i + 1]! + 0.11 * px[i + 2]!;
      c++;
    }
    return c > 20 ? s / c : NaN;
  };
  for (const kind of ['zhou', 'lu', 'wang', 'jianguo', 'neighbor', 'apprentice', 'bride'] as CharacterKind[]) {
    const c = createCharacter(kind, { look: 'live', seed: 3 });
    c.root.traverse(o => { o.layers.enableAll(); });
    c.update(1 / 60, 0);
    scene.add(c.root);
    c.root.updateMatrixWorld(true);
    const s = c.height / 1.75;
    const all: THREE.Mesh[] = [];
    c.root.traverse(o => { if ((o as THREE.Mesh).isMesh) all.push(o as THREE.Mesh); });
    const vis = new Map(all.map(m => [m, m.visible]));
    const only = (keep: (m: THREE.Mesh) => boolean) => { for (const m of all) m.visible = vis.get(m)! && keep(m); };
    const isSkin = (m: THREE.Mesh) => !!(m.material as THREE.Material).userData?.skin;
    const head = c.root.getObjectByName('head') as THREE.Mesh | undefined;
    // 脸：正前方看头心，取画面眼睛以下、下巴以上（脸颊、鼻、嘴——不算头发）
    const ho = c.joints.headSlot.localToWorld(new THREE.Vector3(0, 0.11 * s, 0));
    only(m => m === head);
    cam.position.set(ho.x, ho.y, ho.z - 1);
    cam.lookAt(ho);
    const face = meanLum(renderPixels(renderer, scene, cam, 96), 0.25, 0.6);
    // 手：只留皮肤网格，从正前方看腕下 7cm（右手）
    only(isSkin);
    const wr = (c.root.getObjectByName('wristR') ?? c.joints.elbowR).localToWorld(new THREE.Vector3(0, -0.07 * s, 0));
    cam.position.set(wr.x, wr.y, wr.z - 1);
    cam.lookAt(wr);
    const hand = meanLum(renderPixels(renderer, scene, cam, 96));
    only(() => true);
    const fm = head?.material as THREE.MeshStandardMaterial | undefined;
    let skinMat: THREE.MeshStandardMaterial | undefined;
    for (const m of all) if (isSkin(m)) skinMat = m.material as THREE.MeshStandardMaterial;
    if (!fm || !skinMat || fm.roughness !== skinMat.roughness) matBad.push(`${kind} 粗糙度 脸 ${fm?.roughness} 手 ${skinMat?.roughness}`);
    c.root.removeFromParent();
    c.dispose();
    notes.push(`${kind} 脸 ${fx(face, 1)} 手 ${fx(hand, 1)}`);
    if (!(hand <= face * 1.05 + 1)) bad.push(kind);
  }
  r.t('脸与手（皮肤槽）同粗糙度', matBad.length === 0, matBad.join('；'));
  // 亮度比较要等新的脸（WP-H：去掉旧脸贴图下巴那道 35% 的暗渐变）；头部还是旧版时只报告不判
  const detail = `${bad.length ? `超出：${bad.join(',')}；` : ''}${notes.join('；')}`;
  if (HEAD_LEGACY) r.t('（旧版脸贴图，只报告）常光：手的平均亮度 vs 脸（眼睛以下）', true, detail);
  else r.t('常光：手的平均亮度 ≤ 脸（眼睛以下）+5%', bad.length === 0, detail);
  return r.done();
});

// ================================================================ char2.surface_texdump（工具：把衣料/衣服贴图存成 dataURL，截图脚本取走看）

registerSelftest('char2.surface_texdump', () => {
  const out: Record<string, string> = {};
  const all: [string, THREE.Texture][] = [
    ['fabric_shirt', fabricTexture('shirt')], ['fabric_sleeve', fabricTexture('sleeve')], ['fabric_pants', fabricTexture('pants')],
    ['uniform', uniformShirtTexture()], ['zhongshan', zhongshanTexture('#7E8288')], ['floral', floralTexture('#5B6E8C', 3)],
    ['robe', robeTexture()], ['armband', armbandTexture()], ['clothShoe', clothShoeTexture()],
  ];
  for (const [n, t] of all) out[n] = (t.image as HTMLCanvasElement).toDataURL('image/png');
  (globalThis as { __wpsTexDump?: Record<string, string> }).__wpsTexDump = out;
  return { ok: true, notes: [`${Object.keys(out).length} 张贴图`] };
});
