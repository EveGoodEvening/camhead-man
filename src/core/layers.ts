// owner: WP1
// 渲染图层（ARCH §4.7；GDD §3.14）。M1a 已按表实现；WP1 可以优化但不得改签名与语义。

import type * as THREE from 'three';
import type { LensMode } from './types';

export const LAYER = { world: 0, yin: 1, faded_text: 2, self_head: 3, self_sticker_vf: 4, replay: 5, ir_only: 6 } as const;
export type LayerName = keyof typeof LAYER;

function isLight(o: THREE.Object3D): boolean {
  return (o as THREE.Object3D & { isLight?: boolean }).isLight === true;
}

/** 覆盖式设置图层（含子孙）；跳过灯（灯永远 enableAll，ARCH §4.7）。 */
export function setLayerRecursive(obj: THREE.Object3D, layers: LayerName | LayerName[]): void {
  const list = Array.isArray(layers) ? layers : [layers];
  obj.traverse(o => {
    if (isLight(o)) return;
    o.layers.disableAll();
    for (const l of list) o.layers.enable(LAYER[l]);
  });
}

/** 追加一个图层（含子孙）；跳过灯。 */
export function addLayerRecursive(obj: THREE.Object3D, layer: LayerName): void {
  obj.traverse(o => {
    if (!isLight(o)) o.layers.enable(LAYER[layer]);
  });
}

/** 去掉一个图层（含子孙）；跳过灯。 */
export function removeLayerRecursive(obj: THREE.Object3D, layer: LayerName): void {
  obj.traverse(o => {
    if (!isLight(o)) o.layers.disable(LAYER[layer]);
  });
}

type RenderableFlags = { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
function isRenderableNode(o: THREE.Object3D): boolean {
  const r = o as THREE.Object3D & RenderableFlags;
  return r.isMesh === true || r.isLine === true || r.isPoints === true || r.isSprite === true;
}

/**
 * 自身与祖先 visible，且（自身或任一可见子孙中的可渲染节点：Mesh/Line/Points/Sprite）layers.test(cam.layers)。
 * Group/Object3D/灯的图层不算：three r186 的 projectObject 逐节点测图层、对子节点照样递归，
 * 所以根节点留在 world 层、网格只在 yin 层的主体（如 NpcSystem 自建的根节点）对 fp 相机不可渲染。
 * 回放让位与 hideWorld 用 visible=false，因此自动算作不可见。
 */
export function isRenderableBy(obj: THREE.Object3D, cam: THREE.Camera): boolean {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (!o.visible) return false;
  let hit = false;
  obj.traverseVisible(o => {
    if (!hit && isRenderableNode(o) && o.layers.test(cam.layers)) hit = true;
  });
  return hit;
}

export type CamRole = 'tp' | 'fp' | 'mirror' | 'ch1' | 'ch2' | 'fixed' | 'tripod' | 'tape';

/** 按 ARCH §4.7 的表给出某相机角色应启用的图层。 */
export function layerMaskFor(
  role: CamRole, o: { vf: boolean; lens: LensMode; replay: boolean; extra?: readonly LayerName[] },
): LayerName[] {
  const out: LayerName[] = ['world'];
  switch (role) {
    case 'tp':
      out.push('self_head');
      break;
    case 'fp':
      out.push('yin');
      out.push(o.lens === 'ir' ? 'ir_only' : 'faded_text');
      if (o.replay) out.push('replay');
      break;
    case 'mirror':
      out.push('self_head');
      if (o.vf) out.push('yin', 'faded_text', 'self_sticker_vf');
      break;
    case 'ch2':
    case 'fixed':
      out.push('self_head');
      break;
    case 'ch1':
    case 'tripod':
      break;
    case 'tape':
      break;
  }
  for (const l of o.extra ?? []) if (!out.includes(l)) out.push(l);
  return out;
}
