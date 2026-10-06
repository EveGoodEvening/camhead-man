// owner: WP3
// 辅助 RenderTarget 池与乒乓缓冲（ARCH §8.5）；“看得见自己屏幕的 feed”规则（ARCH §6.11）：
// CH1、CH2 必须 pingpong:true；镜面用单张 + 渲染期间隐藏镜面；tape 单张。
//
// RT 规格：HalfFloat（线性工作空间，辅助画面不做色调映射，贴进场景后随主画面一起被 CameraFxPass 映射一次，ARCH §13.1）、
// 带深度、无 mipmap、Linear 过滤、默认 NoColorSpace。dispose() 把 RT 还回池子（按尺寸），同尺寸下次 acquire 直接复用，
// 所以在两个区域间往返时 textures 计数不涨（ARCH §13.3）。

import * as THREE from 'three';
import { devAssert } from '../core/log';

export interface FeedTarget {
  /** 屏幕/镜面材质采样这一张（乒乓时是上一帧） */
  readonly read: THREE.Texture;
  /** 本帧渲进这一张 */
  readonly write: THREE.WebGLRenderTarget;
  /** 乒乓：交换 read/write（非乒乓时空操作，read === write.texture） */
  swap(): void;
  /** 归还池 */
  dispose(): void;
}

const free = new Map<string, THREE.WebGLRenderTarget[]>();
const active = new Map<string, FeedTarget>();

function sizeKey(w: number, h: number): string {
  return `${w}x${h}`;
}

function takeRT(w: number, h: number, label: string): THREE.WebGLRenderTarget {
  const list = free.get(sizeKey(w, h));
  const rt = list?.pop() ?? new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  rt.texture.name = `feed:${label}`;
  return rt;
}

function giveBack(rt: THREE.WebGLRenderTarget): void {
  const k = sizeKey(rt.width, rt.height);
  let list = free.get(k);
  if (!list) {
    list = [];
    free.set(k, list);
  }
  list.push(rt);
}

class Feed implements FeedTarget {
  private readonly rts: THREE.WebGLRenderTarget[];
  private i = 0;
  private disposed = false;

  constructor(readonly key: string, rts: THREE.WebGLRenderTarget[]) {
    this.rts = rts;
  }
  get write(): THREE.WebGLRenderTarget {
    return this.rts[this.i]!;
  }
  get read(): THREE.Texture {
    return this.rts.length > 1 ? this.rts[1 - this.i]!.texture : this.rts[0]!.texture;
  }
  swap(): void {
    if (this.rts.length > 1) this.i = 1 - this.i;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const rt of this.rts) giveBack(rt);
    if (active.get(this.key) === this) active.delete(this.key);
  }
}

/** CH1、CH2 必须 pingpong:true；镜面用单张 + 渲染期间隐藏镜面（ARCH §6.11）；tape 单张。同一 key 同时只能有一个（dev 下重复抛错）。 */
export function acquireFeed(key: string, w: number, h: number, o?: { pingpong?: boolean }): FeedTarget {
  devAssert(!active.has(key), `acquireFeed: '${key}' 仍在使用中（先 dispose 旧的）`);
  devAssert(!/^ch[12]$/.test(key) || o?.pingpong === true, `acquireFeed: '${key}' 必须 pingpong:true（看得见自己屏幕的 feed，ARCH §6.11）`);
  active.get(key)?.dispose();
  const ww = Math.max(1, Math.round(w));
  const hh = Math.max(1, Math.round(h));
  const rts = [takeRT(ww, hh, key)];
  if (o?.pingpong) rts.push(takeRT(ww, hh, key));
  const f = new Feed(key, rts);
  active.set(key, f);
  return f;
}

/**
 * 通用渲染助手（WP3 补充，非冻结签名；WP5 的 AuxFeed.render 可直接用）：
 * 把 scene 用 camera 渲进 feed.write——期间隐藏 hide 列表里的对象（自己的屏幕、镜面）与所有可见的 userData.auxHide 对象（雨、近处粒子，ARCH §4.7），
 * 渲完还原可见性与渲染目标，最后 swap()。
 */
export function renderIntoFeed(
  r: THREE.WebGLRenderer, feed: FeedTarget, scene: THREE.Scene, camera: THREE.Camera, o?: { hide?: readonly THREE.Object3D[] },
): void {
  const hidden: THREE.Object3D[] = [];
  for (const obj of o?.hide ?? []) {
    if (obj.visible) {
      obj.visible = false;
      hidden.push(obj);
    }
  }
  scene.traverseVisible(obj => {
    if (obj.userData.auxHide === true) hidden.push(obj);
  });
  for (const obj of hidden) obj.visible = false;
  const prev = r.getRenderTarget();
  try {
    r.setRenderTarget(feed.write);
    r.clear();
    r.render(scene, camera);
  } finally {
    r.setRenderTarget(prev);
    for (const obj of hidden) obj.visible = true;
  }
  feed.swap();
}

/** 池子与在用 feed 的计数（自测与资源统计用）。 */
export function feedPoolStats(): { active: number; free: number } {
  let n = 0;
  for (const l of free.values()) n += l.length;
  return { active: active.size, free: n };
}

/** 释放池子里所有空闲 RT（在用的不动）。 */
export function drainFeedPool(): void {
  for (const l of free.values()) for (const rt of l) rt.dispose();
  free.clear();
}
