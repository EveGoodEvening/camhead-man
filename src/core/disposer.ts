// owner: WP1
// 资源追踪（ARCH §2.2）：区域卸载时释放 geometry/material/texture/RT；共享的 MATERIALS 不释放。
// WP 内部模块（ARCH §2.13）：trackObject 的 skip 参数是 WP1 自己的扩充。

import type * as THREE from 'three';
import { isSharedMaterial } from '../fx/materials';

type Disposable = { dispose(): void };

type MaybeRenderable = THREE.Object3D & {
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
  isInstancedMesh?: boolean;
};

function isTexture(v: unknown): v is THREE.Texture {
  return typeof v === 'object' && v !== null && (v as { isTexture?: boolean }).isTexture === true;
}

export class Disposer {
  private readonly items = new Set<Disposable>();

  /** 追踪一个可释放资源，原样返回。 */
  track<T extends { dispose(): void }>(r: T): T {
    this.items.add(r);
    return r;
  }

  /**
   * 追踪对象子树里的全部 geometry/material/texture（跳过共享材质，见 fx/materials.ts 的 isSharedMaterial）。
   * skip 返回 true 的节点连同子树都不追踪（例：挂到区域门楣上的主角头部，它跨区域常驻）。
   */
  trackObject(obj: THREE.Object3D, skip?: (o: THREE.Object3D) => boolean): void {
    const visit = (o: THREE.Object3D): void => {
      if (skip?.(o)) return;
      const r = o as MaybeRenderable;
      if (r.geometry && typeof r.geometry.dispose === 'function') this.items.add(r.geometry);
      if (r.isInstancedMesh === true) this.items.add(o as unknown as Disposable);
      const mats = r.material === undefined ? [] : Array.isArray(r.material) ? r.material : [r.material];
      for (const m of mats) this.trackMaterial(m);
      for (const c of o.children) visit(c);
    };
    visit(obj);
  }

  /** 释放全部已追踪资源并清空列表。 */
  dispose(): void {
    const list = [...this.items];
    this.items.clear();
    for (const r of list) {
      try {
        r.dispose();
      } catch (err) {
        console.error('[Disposer]', err);
      }
    }
  }

  /** 当前追踪的资源数。 */
  get size(): number {
    return this.items.size;
  }

  private trackMaterial(m: THREE.Material): void {
    if (isSharedMaterial(m)) return;
    this.items.add(m);
    // 材质上的贴图（map、emissiveMap、uniforms 里的 value…）。RT 贴图归各 feed 的拥有者释放，这里跳过。
    const scan = (v: unknown): void => {
      if (isTexture(v) && !(v as { isRenderTargetTexture?: boolean }).isRenderTargetTexture) this.items.add(v);
    };
    for (const v of Object.values(m)) scan(v);
    const uniforms = (m as { uniforms?: Record<string, { value?: unknown }> }).uniforms;
    if (uniforms) for (const u of Object.values(uniforms)) scan(u?.value);
  }
}
