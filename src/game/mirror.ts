// owner: WP5
// 镜面（ARCH §6.11）：照搬 three r186 examples/jsm/objects/Reflector.js（onBeforeRender，约 115–240 行）的数学——
// 反射相机（位置与注视点关于镜面平面镜像、up 同样镜像后 lookAt）、textureMatrix = bias·P·V·M + texture2DProj 投影采样（不翻 UV）、
// 斜投影近裁面（镜后的墙不漏进来）、渲染期间隐藏镜面自身。唯一不同：反射相机的图层掩码显式按 ARCH §4.7 设置。
// 另有 baked 模式（settings.mirrorMode='baked'）：预制镜像贴图按普通 UV 贴上。镜面圆盘几何给读字判定用（§6.8.6）。
//
// 本文件另导出 withAuxHidden()：镜面、CH1/CH2 的辅助 RT 渲染期间临时隐藏 userData.auxHide 的对象（雨、近处粒子，ARCH §4.7）。

import * as THREE from 'three';
import type { InteractId } from '../data/ids';
import type { Game } from '../core/game';
import type { GameApi } from './effects';
import type { FeedTarget } from '../fx/feeds';
import { acquireFeed } from '../fx/feeds';
import { layerMaskFor } from '../core/layers';
import { devAssert, devWarn } from '../core/log';
import { QUALITY, RT_SIZE } from '../data/render';
import { layerMaskBits } from './viewfinder';

export interface MirrorDef {
  /** 'r1.mirror'（读字的 via.mirror 用它找圆盘） */
  id: InteractId;
  /** 圆镜；镜面朝向为其局部 +z；圆盘半径取自几何 */
  mesh: THREE.Mesh;
  size?: 1024;
  /** 玩家在门卫室内 */
  activeWhen: (g: GameApi) => boolean;
  /** 每 2 帧 */
  every?: 2;
  /** 反射相机 far，默认 8 */
  far?: number;
  /** settings.mirrorMode='baked' 的预制镜像贴图 */
  baked: () => THREE.Texture;
}

/** 在 fn 执行期间把 root 下 userData.auxHide 的对象设为不可见，结束后还原（ARCH §4.7“辅助 RT 排除项”）。 */
export function withAuxHidden(root: THREE.Object3D | null | undefined, fn: () => void, also: readonly THREE.Object3D[] = []): void {
  const hidden: THREE.Object3D[] = [];
  const hide = (o: THREE.Object3D): void => {
    if (o.visible) {
      o.visible = false;
      hidden.push(o);
    }
  };
  for (const o of also) hide(o);
  root?.traverseVisible(o => {
    if (o.userData.auxHide === true) hide(o);
  });
  try {
    fn();
  } finally {
    for (const o of hidden) o.visible = true;
  }
}

const ReflectorShader = {
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4( position, 1.0 );
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 tint;
    uniform sampler2D tDiffuse;
    varying vec4 vUv;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec4 base = texture2DProj( tDiffuse, vUv );
      gl_FragColor = vec4( base.rgb * tint, 1.0 );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/** 镜子本身略暗、偏冷一点（旧圆镜），不是纯反射。 */
const MIRROR_TINT = new THREE.Color(0.82, 0.86, 0.9);
const CLIP_BIAS = 0.003;

interface MirrorRt {
  def: MirrorDef;
  original: THREE.Material | THREE.Material[];
  rtMat: THREE.ShaderMaterial | null;
  bakedMat: THREE.MeshBasicMaterial | null;
  feed: FeedTarget | null;
  unregister: (() => void) | null;
  readonly reflCam: THREE.PerspectiveCamera;
  readonly textureMatrix: THREE.Matrix4;
  mode: 'rt' | 'baked' | null;
}

const _mirrorPos = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _rot = new THREE.Matrix4();
const _normal = new THREE.Vector3();
const _view = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _target = new THREE.Vector3();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
const _scale = new THREE.Vector3();

export class MirrorSystem {
  protected readonly game: Game;
  private readonly mirrors = new Map<InteractId, MirrorRt>();

  constructor(game: Game) {
    this.game = game;
    // 设置里切换镜面模式时就地换材质（不必重进区域）
    game.events.on('settings', e => {
      if (e.key === 'mirrorMode' || e.key === 'quality') for (const m of this.mirrors.values()) this.applyMode(m);
    });
  }

  register(d: MirrorDef): void {
    devAssert(!this.mirrors.has(d.id), `MirrorSystem.register: duplicate mirror '${d.id}'`);
    const m: MirrorRt = {
      def: d, original: d.mesh.material, rtMat: null, bakedMat: null, feed: null, unregister: null,
      reflCam: new THREE.PerspectiveCamera(), textureMatrix: new THREE.Matrix4(), mode: null,
    };
    this.mirrors.set(d.id, m);
    this.applyMode(m);
    const key = this.mirrors.size === 1 ? 'mirror' : `mirror:${d.id}`;
    m.unregister = this.game.pipeline.addFeed({
      key,
      due: frameNo => this.modeOf() === 'rt' && frameNo % this.everyOf(m) === 0 && this.isActive(m),
      render: r => this.renderMirror(m, r),
    });
  }

  get active(): boolean {
    for (const m of this.mirrors.values()) if (this.isActive(m)) return true;
    return false;
  }

  /** 读字判定用（ARCH §6.8.6）：圆盘中心、单位法线（局部 +z）、半径（几何 × 世界缩放）。未登记的 id 给半径 0 的圆盘。 */
  disc(id: InteractId): { center: THREE.Vector3; normal: THREE.Vector3; radius: number } {
    const m = this.mirrors.get(id);
    if (!m) {
      devWarn(`MirrorSystem.disc: unknown mirror '${id}'`);
      return { center: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, 1), radius: 0 };
    }
    const mesh = m.def.mesh;
    mesh.updateWorldMatrix(true, false);
    const center = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
    const normal = new THREE.Vector3(0, 0, 1).applyMatrix4(_rot.extractRotation(mesh.matrixWorld)).normalize();
    mesh.matrixWorld.decompose(_view, new THREE.Quaternion(), _scale);
    const s = Math.max(Math.abs(_scale.x), Math.abs(_scale.y));
    return { center, normal, radius: localRadius(mesh.geometry) * s };
  }

  /** 离开区域：清除镜面并注销 feed（M1a 补写；ARCH §4.5 第 3 步由 AreaContextImpl.dispose() 调用）。 */
  clearArea(): void {
    for (const m of this.mirrors.values()) {
      m.unregister?.();
      m.def.mesh.material = m.original;
      m.rtMat?.dispose();
      m.bakedMat?.dispose();
      m.feed?.dispose();
    }
    this.mirrors.clear();
  }

  // ------------------------------------------------------------------ 内部

  private modeOf(): 'rt' | 'baked' {
    return this.game.settings.mirrorMode === 'baked' ? 'baked' : 'rt';
  }

  private everyOf(m: MirrorRt): number {
    return Math.max(1, m.def.every ?? QUALITY[this.game.settings.quality].mirrorEvery);
  }

  private isActive(m: MirrorRt): boolean {
    return m.def.activeWhen(this.game.api);
  }

  private applyMode(m: MirrorRt): void {
    const mode = this.modeOf();
    if (mode === 'baked') {
      if (!m.bakedMat) m.bakedMat = new THREE.MeshBasicMaterial({ map: m.def.baked() });
      m.def.mesh.material = m.bakedMat;
      m.feed?.dispose();   // 预制模式不占 RT
      m.feed = null;
    } else {
      if (!m.rtMat) {
        m.rtMat = new THREE.ShaderMaterial({
          name: 'MirrorReflector',
          uniforms: { tDiffuse: { value: null }, tint: { value: MIRROR_TINT.clone() }, textureMatrix: { value: m.textureMatrix } },
          vertexShader: ReflectorShader.vertexShader,
          fragmentShader: ReflectorShader.fragmentShader,
        });
      }
      m.def.mesh.material = m.rtMat;
    }
    m.mode = mode;
  }

  private feedOf(m: MirrorRt): FeedTarget {
    if (!m.feed) {
      const size = m.def.size ?? QUALITY[this.game.settings.quality].mirrorRT;
      m.feed = acquireFeed(`mirror:${m.def.id}`, size, size);
    }
    return m.feed;
  }

  /** Reflector.onBeforeRender 的数学（three r186），对当前主相机求反射相机并渲进镜面 RT。 */
  private renderMirror(m: MirrorRt, r: THREE.WebGLRenderer): void {
    if (m.mode !== 'rt' || !m.rtMat) return;
    const game = this.game;
    const mesh = m.def.mesh;
    const cam = game.cameras.camera;
    mesh.updateWorldMatrix(true, false);
    cam.updateWorldMatrix(true, false);

    _mirrorPos.setFromMatrixPosition(mesh.matrixWorld);
    _camPos.setFromMatrixPosition(cam.matrixWorld);
    _rot.extractRotation(mesh.matrixWorld);
    _normal.set(0, 0, 1).applyMatrix4(_rot);
    _view.subVectors(_mirrorPos, _camPos);
    if (_view.dot(_normal) > 0) return;   // 镜面背对相机
    _view.reflect(_normal).negate();
    _view.add(_mirrorPos);

    _rot.extractRotation(cam.matrixWorld);
    _lookAt.set(0, 0, -1).applyMatrix4(_rot).add(_camPos);
    _target.subVectors(_mirrorPos, _lookAt).reflect(_normal).negate().add(_mirrorPos);

    const rc = m.reflCam;
    rc.position.copy(_view);
    rc.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_normal);
    rc.lookAt(_target);
    // 与主相机同视场/比例/变焦，但 far 取镜面的（默认 8m）：远处不渲，省 draw call（ARCH §6.11 第 4 条）
    rc.fov = cam.fov;
    rc.aspect = cam.aspect;
    rc.zoom = cam.zoom;
    rc.near = cam.near;
    rc.far = m.def.far ?? RT_SIZE.mirrorFar;
    rc.updateProjectionMatrix();
    rc.updateMatrixWorld();

    m.textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    );
    m.textureMatrix.multiply(rc.projectionMatrix);
    m.textureMatrix.multiply(rc.matrixWorldInverse);
    m.textureMatrix.multiply(mesh.matrixWorld);

    // 斜投影近裁面（http://www.terathon.com/code/oblique.html），与 Reflector 相同
    _plane.setFromNormalAndCoplanarPoint(_normal, _mirrorPos);
    _plane.applyMatrix4(rc.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const pe = rc.projectionMatrix.elements;
    _q.x = (Math.sign(_clip.x) + (pe[8] ?? 0)) / (pe[0] ?? 1);
    _q.y = (Math.sign(_clip.y) + (pe[9] ?? 0)) / (pe[5] ?? 1);
    _q.z = -1.0;
    _q.w = (1.0 + (pe[10] ?? 0)) / (pe[14] ?? 1);
    _clip.multiplyScalar(2.0 / _clip.dot(_q));
    pe[2] = _clip.x;
    pe[6] = _clip.y;
    pe[10] = _clip.z + 1.0 - CLIP_BIAS;
    pe[14] = _clip.w;

    // 唯一与 Reflector 不同：图层显式设置（world + self_head；取景器开启时再加 yin、faded_text、self_sticker_vf）
    const vf = game.sys.viewfinder;
    rc.layers.mask = layerMaskBits(layerMaskFor('mirror', { vf: vf.on, lens: vf.lens, replay: false }));

    const feed = this.feedOf(m);
    const prev = r.getRenderTarget();
    withAuxHidden(game.areas.current?.root, () => {
      r.setRenderTarget(feed.write);
      r.state.buffers.depth.setMask(true);
      if (r.autoClear === false) r.clear();
      r.render(game.scene, rc);
    }, [mesh]);
    r.setRenderTarget(prev);
    feed.swap();
    if (m.rtMat) m.rtMat.uniforms.tDiffuse.value = feed.read;
  }
}

/** 圆盘几何的局部半径：CircleGeometry/RingGeometry 取 parameters.radius/outerRadius，否则取包围盒 x/y 半宽的较大者。 */
function localRadius(geom: THREE.BufferGeometry): number {
  const p = (geom as THREE.BufferGeometry & { parameters?: { radius?: number; outerRadius?: number } }).parameters;
  if (p?.radius !== undefined) return p.radius;
  if (p?.outerRadius !== undefined) return p.outerRadius;
  if (!geom.boundingBox) geom.computeBoundingBox();
  const b = geom.boundingBox;
  if (!b) return 0;
  return Math.max(b.max.x - b.min.x, b.max.y - b.min.y) / 2;
}
