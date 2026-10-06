// owner: WP3
// 预热（ARCH §8.5、§13.1 步骤 ③）：进区域的淡入期间往 1×1 RT 依次渲一帧——取景器掩码（含 yin/faded_text/replay 层，临时把隐藏的人影设可见）、
// 红外替换、CameraFxPass 的红外与常规分支、镜面/CH2 feed 各一次。不改任何玩法状态。
//
// 做法（为什么这样）：
// - three 的程序是在“真的绘制某个对象”时按（材质 × 对象类型 × 灯数 …）选出来的；compile()/compileAsync() 按材质去重，
//   同一个红外材质既给普通网格又给置空 instanceColor 的实例网格用时只会编一个变体。所以这里真的渲染。
// - 用一台打开全部图层的临时相机（fp 的克隆），并临时关掉视锥剔除，画面外的对象也会被绘制一次。
// - 临时显出隐藏的子树（回放人影、viewVariant 的其他变体、R2 其他楼层、不在场的 NPC），但**跳过含灯的子树**：
//   灯数一变就是另一套程序，而且 ARCH §4.7 本来就不允许灯挂在会隐藏的节点下。
// - 结束后全部还原（可见性、frustumCulled、渲染目标），RT 释放。

import * as THREE from 'three';
import type { CameraRig } from '../core/cameras';
import type { AuxFeed } from '../core/render';
import type { IrRenderer } from './ir';
import type { PostPipeline } from './post';

function isLight(o: THREE.Object3D): boolean {
  return (o as THREE.Object3D & { isLight?: boolean }).isLight === true;
}

function hasLight(o: THREE.Object3D): boolean {
  let found = false;
  o.traverse(c => {
    if (!found && isLight(c)) found = true;
  });
  return found;
}

/** 显出 root 下所有隐藏的、不含灯的子树；返回被改动的对象（用于还原）。 */
function revealHidden(root: THREE.Object3D, out: THREE.Object3D[]): void {
  const walk = (o: THREE.Object3D): void => {
    if (!o.visible) {
      if (hasLight(o)) return;
      o.visible = true;
      out.push(o);
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
}

/** 关掉所有可渲染节点的视锥剔除；返回被改动的对象。 */
function disableCulling(root: THREE.Object3D, out: THREE.Object3D[]): void {
  root.traverse(o => {
    if (o.frustumCulled) {
      o.frustumCulled = false;
      out.push(o);
    }
  });
}

const nextTask = (): Promise<void> => new Promise(res => setTimeout(res, 0));

/** 会淡出的人身（humanoid 根 userData.fadeCapable）下的非着色器材质临时设成透明画一遍，再还原。 */
function renderFadeVariants(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, cam: THREE.Camera): void {
  const mats = new Set<THREE.Material>();
  scene.traverse(o => {
    if (o.userData.fadeCapable !== true) return;
    o.traverse(c => {
      const m = (c as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const mm of Array.isArray(m) ? m : m ? [m] : []) {
        if (!mm.transparent && !(mm as THREE.ShaderMaterial).isShaderMaterial) mats.add(mm);
      }
    });
  });
  if (mats.size === 0) return;
  for (const m of mats) {
    m.transparent = true;
    m.needsUpdate = true;
  }
  try {
    renderer.render(scene, cam);
  } finally {
    for (const m of mats) {
      m.transparent = false;
      m.needsUpdate = true;
    }
  }
}

/**
 * 把一个独立场景（录像带场景）用给定相机各真画一次到 1×1 线性半浮点 RT（M1d，性能评审）：显出隐藏的不含灯子树、关掉视锥剔除，
 * 这样画面外、此刻隐藏的对象（到了 02:51 分屏才出现的 CH2 人物）的变体也都编好；画进 RT 得到的正是 feed 实际用的线性变体。
 * 画完全部还原（可见性、frustumCulled、渲染目标）。
 */
export function warmScene(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, cameras: readonly THREE.Camera[]): void {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const prevTarget = renderer.getRenderTarget();
  const revealed: THREE.Object3D[] = [];
  const unculled: THREE.Object3D[] = [];
  try {
    revealHidden(scene, revealed);
    disableCulling(scene, unculled);
    renderer.setRenderTarget(rt);
    for (const c of cameras) renderer.render(scene, c);
  } finally {
    for (let i = unculled.length - 1; i >= 0; i--) unculled[i]!.frustumCulled = true;
    for (let i = revealed.length - 1; i >= 0; i--) revealed[i]!.visible = false;
    renderer.setRenderTarget(prevTarget);
    rt.dispose();
  }
}

export async function warmupArea(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, cams: CameraRig,
  o: { ir: IrRenderer; post: PostPipeline; replayRoots: readonly THREE.Object3D[]; feeds: readonly AuxFeed[] },
): Promise<void> {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const prevTarget = renderer.getRenderTarget();
  const cam = cams.fp.clone();
  cam.layers.enableAll();
  cam.updateMatrixWorld();

  const revealed: THREE.Object3D[] = [];
  const unculled: THREE.Object3D[] = [];
  try {
    for (const r of o.replayRoots) {
      // 回放人影的根本身可能挂在区域根下的隐藏分组里：沿祖先链一并显出（不含灯的）
      for (let p: THREE.Object3D | null = r; p; p = p.parent) {
        if (!p.visible && !hasLight(p)) {
          p.visible = true;
          revealed.push(p);
        }
      }
    }
    revealHidden(scene, revealed);
    disableCulling(scene, unculled);

    // ① 常规：取景器/第三人称/回放共用的材质变体（全部图层）
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    // ①b 人身淡入淡出的透明变体（M1d）：HumanoidRig.setOpacity < 1 时材质切 transparent，r186 的程序按 opaque 区分——
    // P14“身子一点点空下去”、NPC fadeTo 的第一帧不该现场编译。临时把会淡出的人身材质设成透明画一遍再还原（还原只是查缓存，不再编译）
    renderFadeVariants(renderer, scene, cam);
    // ② 红外替换（含置空 instanceColor 的实例网格变体、alpha 裁切变体）
    o.ir.begin([scene]);
    try {
      renderer.render(scene, cam);
    } finally {
      o.ir.end();
    }
  } finally {
    for (let i = unculled.length - 1; i >= 0; i--) unculled[i]!.frustumCulled = true;
    for (let i = revealed.length - 1; i >= 0; i--) revealed[i]!.visible = false;
    renderer.setRenderTarget(prevTarget);
  }

  // 让出一次，免得整段预热卡住淡入动画
  await nextTask();

  try {
    // ③ 后期：Bloom、CameraFxPass 的常规与红外分支
    o.post.warm(rt);
    // ④ 辅助 feed（镜面、CH1/CH2、录像带）各渲一次：它们自己负责渲染期间隐藏屏幕与 auxHide（ARCH §6.11）
    for (const f of o.feeds) f.render(renderer);
  } finally {
    renderer.setRenderTarget(prevTarget);
    rt.dispose();
  }
}
