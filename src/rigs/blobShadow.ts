// owner: WP2
// 圆形假阴影（ARCH §13.1：角色一律 blobShadow）。M1a 补写签名：区域与其他 WP 也可以用它给道具加假阴影。

import * as THREE from 'three';
import { paintTexture } from '../kit/canvas';

let blobTex: THREE.CanvasTexture | null = null;
const blobGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);

function blobTexture(): THREE.CanvasTexture {
  if (blobTex) return blobTex;
  blobTex = paintTexture(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }, { mask: true });
  return blobTex;
}

/** 与射线求交时永远不命中：假阴影不该挡准星、不该被拍照遮挡判定当成遮挡物。 */
const noRaycast: THREE.Mesh['raycast'] = () => {};

/** 贴地的圆形半透明暗斑（depthWrite:false、irHide、auxHide），原点在圆心、朝上。radius 默认 0.35，opacity 默认 0.45。 */
export function createBlobShadow(radius = 0.35, opacity = 0.45): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    alphaMap: blobTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const m = new THREE.Mesh(blobGeo, mat);
  m.name = 'blobShadow';
  m.scale.set(radius, 1, radius);
  m.position.y = 0.012;
  m.renderOrder = 1;
  m.userData.irHide = true;
  m.userData.auxHide = true;
  m.userData.noOcclude = true;
  m.userData.noBounds = true;
  m.userData.sharedGeometry = true;
  m.raycast = noRaycast;
  return m;
}
