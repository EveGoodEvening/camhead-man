// owner: WP2
// 程序化人身（ARCH §5.1）的门面：char2 WP0 起实现分到 src/rigs/human/（types/shared/profile/assemble 冻结；head/upper/lower/surface/motion
// 是各区域的构建器，见 test-artifacts/work/char2/PLAN.md §2.2）。这里原名转出原来的全部公开与内部接口。

export type {
  FaceOpts, HumanoidInternal, HumanoidMaterialMode, HumanoidRig, HumanoidSpec, HumanoidStyle, JointName,
} from './human/types';
export { createHumanoid, createHumanoidInternal } from './human/assemble';
export { squircleLoft } from './human/shared';
export { faceTexture } from './human/head';
export { torsoSurface } from './human/upper';
export { addRim, setMaterialOpacity } from './human/surface';
