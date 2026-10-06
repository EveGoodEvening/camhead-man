// owner: R2
// R2 本区材质（每次进区域新建，随区域根节点释放；共享的 MATERIALS 不释放）。小金属件 roughness ≥ 0.5（Bloom 阈值 0.8，AGENTS.md）。

import * as THREE from 'three';
import { MATERIALS } from '../../../fx/materials';
import { newMat } from '../../../kit/geom';
import { PAINT } from '../../../kit/canvas';
import { TEMP_C } from '../../../data/render';
import type { AdsAtlas, Atlas } from './paint';
import { adsAtlas, courtyardDayTexture, courtyardTexture, donationTexture, grimeAtlas, menshenTexture, outsideTexture, signAtlas, terrazzo, wallWashTexture } from './paint';
import { TEXT } from '../text';

export interface R2Mats {
  dado: THREE.Material; lime: THREE.Material; ceiling: THREE.Material; plaster: THREE.Material;
  floor: THREE.Material; concrete: THREE.Material; stairs: THREE.Material; nosing: THREE.Material;
  wood: THREE.Material; darkWood: THREE.Material; handrail: THREE.Material; iron: THREE.Material; steel: THREE.Material;
  metal: THREE.Material; plastic: THREE.Material; rubber: THREE.Material; black: THREE.Material;
  cardboard: THREE.Material; jar: THREE.Material; clay: THREE.Material; leafDead: THREE.Material; leaf: THREE.Material;
  soil: THREE.Material; cloth: THREE.Material; mat: THREE.Material; shoe: THREE.Material; shoe2: THREE.Material;
  briquette: THREE.Material; redPlastic: THREE.Material; bluePlastic: THREE.Material; gasPipe: THREE.Material; enamel: THREE.Material;
  signs: THREE.MeshStandardMaterial; grime: THREE.MeshStandardMaterial; posters: THREE.MeshStandardMaterial; posters2: THREE.MeshStandardMaterial;
  menshen: THREE.MeshStandardMaterial; donation: THREE.MeshStandardMaterial; outside: THREE.MeshBasicMaterial;
  emissiveWarm: THREE.Material; glowGap: THREE.MeshBasicMaterial; courtyard: THREE.MeshBasicMaterial[]; landingWin: THREE.MeshBasicMaterial; glass: THREE.Material;
  /** 回放里上午的窗外（换进 courtyard/landingWin 的 map；M4 第 2 轮） */
  courtyardDay: THREE.CanvasTexture;
  atlas: Atlas; grimeRect: (i: number) => readonly [number, number, number, number];
  /** 墙上的“牛皮癣”：喷涂电话、白灰盖的一条、小纸条、红章、身高线 */
  ads: THREE.MeshStandardMaterial; adsAtlas: AdsAtlas;
  /** 整面墙叠一层的做旧（熏黑、蹭脏、掉漆、鞋印） */
  wash: THREE.MeshStandardMaterial;
}

function decalMat(map: THREE.Texture, roughness = 0.9): THREE.MeshStandardMaterial {
  const m = newMat({ map, transparent: true, roughness, depthWrite: false });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  m.userData.tempC = TEMP_C.ambient;
  return m;
}

export function r2Mats(): R2Mats {
  const atlas = signAtlas();
  const ads = adsAtlas();
  const adsMat = decalMat(ads.tex, 0.92);
  adsMat.name = 'ads';
  // 同招牌：一点点自发光，灯灭着的时候凑近也认得出是一墙小广告（灯亮了才看得清字）
  adsMat.emissiveMap = ads.tex;
  adsMat.emissive.set('#ffffff');
  adsMat.emissiveIntensity = 0.1;
  const grime = grimeAtlas();
  const menshen = newMat({ map: menshenTexture(), roughness: 0.85, tempC: TEMP_C.paper });
  menshen.name = 'menshen';
  const posters = decalMat(PAINT.posters({ lines: TEXT.set.posterLines, seed: 23 }));
  const posters2 = decalMat(PAINT.posters({ lines: TEXT.set.posterLines2, seed: 57 }));
  const signs = decalMat(atlas.tex, 0.8);
  signs.name = 'signs';
  // 标牌、门牌、春联带一点点自发光（look-dev：招牌底板微亮），灯灭时在 0.12 的环境光里也认得出来
  signs.emissiveMap = atlas.tex;
  signs.emissive.set('#ffffff');
  signs.emissiveIntensity = 0.16;
  const wash = decalMat(wallWashTexture(), 1);
  wash.name = 'wash';
  const g = decalMat(grime.tex, 1);
  g.name = 'grime';
  // 门外、窗外的夜景是 HDR（颜色 >1）：钠灯的那一团光烧白，暗处仍是暗的
  const outside = new THREE.MeshBasicMaterial({ map: outsideTexture(), color: new THREE.Color('#ffffff').multiplyScalar(5.0) });
  outside.userData.tempC = 16;
  const courtyard = [2, 3, 4, 5].map(n => {
    const c = new THREE.MeshBasicMaterial({ map: courtyardTexture(n), color: new THREE.Color('#ffffff').multiplyScalar(2.8) });
    c.userData.tempC = 16;
    return c;
  });
  const landingWin = new THREE.MeshBasicMaterial({ map: courtyardTexture(1, 0.45), color: new THREE.Color('#ffffff').multiplyScalar(3.5) });
  landingWin.userData.tempC = 16;
  const glowGap = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc98a').multiplyScalar(3.2) });
  glowGap.userData.tempC = TEMP_C.lamp;
  return {
    dado: MATERIALS.dado(), lime: MATERIALS.lime(), plaster: MATERIALS.plaster(),
    // 顶棚：半球光的地面色近黑，灯灭时顶棚会是一整块死黑；给一点点“窗外来的反光”，只够看出灯座与线槽的轮廓
    ceiling: newMat({ color: '#b9b4a6', roughness: 0.95, emissive: '#3a3630', emissiveIntensity: 0.22 }),
    floor: newMat({ map: terrazzo(3), roughness: 0.62, tempC: TEMP_C.ambient }),
    concrete: MATERIALS.concrete(),
    stairs: newMat({ map: terrazzo(9), color: '#c9c6bc', roughness: 0.7 }),
    nosing: newMat({ color: '#2b2b2b', roughness: 0.7 }),
    wood: MATERIALS.wood(),
    darkWood: newMat({ color: '#4a3424', roughness: 0.75 }),
    handrail: newMat({ color: '#5A3A22', roughness: 0.55 }),
    iron: newMat({ color: '#1f2226', roughness: 0.55, metalness: 0.55, tempC: 15 }),
    steel: newMat({ color: '#9ea3a6', roughness: 0.5, metalness: 0.6, tempC: 15 }),
    metal: MATERIALS.metal(),
    plastic: newMat({ color: '#e6e1d2', roughness: 0.55, emissive: '#e6e1d2', emissiveIntensity: 0.12 }),
    rubber: newMat({ color: '#141414', roughness: 0.9 }),
    black: newMat({ color: '#0d0d0f', roughness: 0.8 }),
    cardboard: newMat({ color: '#9c7a4e', roughness: 0.95 }),
    jar: newMat({ color: '#5a3a20', roughness: 0.35, metalness: 0.05 }),
    clay: newMat({ color: '#8a4a2e', roughness: 0.85 }),
    leafDead: newMat({ color: '#6b5a32', roughness: 0.9 }),
    leaf: newMat({ color: '#2f5a2c', roughness: 0.8 }),
    soil: newMat({ color: '#2a1f16', roughness: 1 }),
    cloth: newMat({ color: '#6a5a8a', roughness: 0.95 }),
    mat: newMat({ color: '#6b2a26', roughness: 1 }),
    shoe: newMat({ color: '#2a2622', roughness: 0.6 }),
    shoe2: newMat({ color: '#b8b2a4', roughness: 0.7 }),
    briquette: newMat({ color: '#1c1b1a', roughness: 1 }),
    redPlastic: newMat({ color: '#b3302a', roughness: 0.5 }),
    bluePlastic: newMat({ color: '#2d5a9a', roughness: 0.5 }),
    gasPipe: newMat({ color: '#c9a227', roughness: 0.55, metalness: 0.3 }),
    enamel: newMat({ color: '#eeeae0', roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide }),
    signs, grime: g, posters, posters2, menshen,
    donation: (() => {
      const t = donationTexture();
      return newMat({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.3, roughness: 0.85, tempC: TEMP_C.paper });
    })(),
    outside,
    emissiveWarm: MATERIALS.emissive('#ffc98a', 0.5),
    glowGap, courtyard, landingWin, courtyardDay: courtyardDayTexture(), glass: MATERIALS.glass(),
    atlas, grimeRect: grime.rect,
    ads: adsMat, adsAtlas: ads, wash,
  };
}
