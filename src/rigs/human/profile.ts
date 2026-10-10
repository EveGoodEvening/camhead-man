// owner: WP2
// char2 WP0（冻结）：体型表、关节表、缺省人脸。

import * as THREE from 'three';
import type { BuildDims, FaceOpts, HumanoidSpec, JointName } from './types';

export const JOINT_NAMES: readonly JointName[] = ['hips', 'spine', 'neck', 'headSlot', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR'];

export const BUILD: Readonly<Record<NonNullable<HumanoidSpec['build']>, BuildDims>> = {
  normal: { w: 1, d: 1, belly: 0 },
  slim: { w: 0.86, d: 0.9, belly: 0 },
  stout: { w: 1.14, d: 1.22, belly: 0.05 },
  hunch: { w: 0.94, d: 1, belly: 0 },
};

/** 人头缺省外观（没给 FaceOpts 时：回放的 createHumanoid、冷迹）。 */
export function faceOf(spec: Readonly<HumanoidSpec>, face?: Readonly<FaceOpts>): FaceOpts {
  return face ? { ...face } : { skin: `#${new THREE.Color(spec.skin ?? '#C99A78').getHexString()}`, hair: '#1e1a17', hairStyle: 'short', age: 'old' };
}
