// owner: R2
// R2_502 的纯视觉共享状态（不存档、不影响进度）：灶君纸像的眼珠往左下瞟（GDD P5）、说话的纸像微微鼓动、
// 读信过场里用到的场景对象（王奶奶的人偶、化成的那一点光）。每次进区域 build 时复位。

import type * as THREE from 'three';
import type { SpeakerId } from '../../data/ids';
import { E } from '../../game/effects';
import type { Effect } from '../../game/effects';
import type { CharacterRig } from '../../rigs/characters';

export const ZAO = {
  /** 眼珠使劲往左下瞟的剩余秒数（灶王奶奶那一句） */
  glance: 0,
  /** 当前说话的纸像 */
  who: '' as SpeakerId | '',
  t: 0,
};

export const SCENE = {
  wangRig: null as CharacterRig | null,
  wangRoot: null as THREE.Object3D | null,
  orb: null as THREE.Object3D | null,
};

/** 对话行 effects：这一行由哪张纸像说；glance = 这一句眼珠往左下瞟。 */
export function zaoFx(who: SpeakerId | '', glance = false): Effect[] {
  return [E.call(() => {
    ZAO.who = who;
    ZAO.t = 0;
    if (glance) ZAO.glance = 2.6;
  })];
}

export function resetAnim(): void {
  ZAO.glance = 0;
  ZAO.who = '';
  ZAO.t = 0;
  SCENE.wangRig = null;
  SCENE.wangRoot = null;
  SCENE.orb = null;
}
