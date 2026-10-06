// owner: WP2
// 8 种关键姿势（ARCH §5.1）。WP2 内部数据：createHumanoid 使用；其他 WP 只经 HumanoidRig.setPose 使用。
//
// 角度约定（与 ARCH §5.1 的文字描述符号相反，注意）：人偶面朝 -z、右手在 +x，按 three 右手系：
//   绕 X 为正 = 下垂的肢体往前（-z）摆：髋前屈（抬大腿）、肩前举、肘屈为正；膝屈为负；
//   躯干（朝上）绕 X 为负 = 向前弯腰；颈绕 X 为正 = 抬头；
//   绕 Z 为正 = 下垂的肢体往 +x（右侧）摆，所以左臂外展为负、右臂外展为正。
// ARCH 写的“sit 髋 -90°、膝 90°”“raise_arm 右肩 -150°”“look_up 颈 -35°”是同一组动作，只是按“前屈为负”描述。

import type { Pose, V3 } from '../core/types';
import type { JointName } from './humanoid';

/** 关节欧拉角（弧度，XYZ）与整体偏移。 */
export interface PoseDef {
  joints: Partial<Record<JointName, V3>>;
  /** 身体整体下移（×高度比），sit 为 0.45 */
  bodyDrop?: number;
  /** 整体绕 x 轴旋转（弧度），lie 为 π/2 */
  rootRotX?: number;
}

const ARMS_REST: Partial<Record<JointName, V3>> = {
  shoulderL: [0.02, 0, -0.07], shoulderR: [0.02, 0, 0.07], elbowL: [0.14, 0, 0], elbowR: [0.14, 0, 0],
};

export const POSES: Readonly<Record<Pose, PoseDef>> = {
  stand: { joints: { ...ARMS_REST } },
  walk: { joints: { ...ARMS_REST } },
  // 坐：大腿水平前伸、小腿垂直；双手搭在腿上
  sit: {
    joints: {
      hipL: [Math.PI / 2, 0, -0.04], hipR: [Math.PI / 2, 0, 0.04], kneeL: [-Math.PI / 2, 0, 0], kneeR: [-Math.PI / 2, 0, 0],
      spine: [-0.05, 0, 0], shoulderL: [0.55, 0, -0.08], shoulderR: [0.55, 0, 0.08], elbowL: [0.75, 0, 0], elbowR: [0.75, 0, 0],
    },
    bodyDrop: 0.45,
  },
  // 蹲：深屈膝、上身前倾，双手前伸
  crouch: {
    joints: {
      hipL: [1.75, 0, -0.18], hipR: [1.75, 0, 0.18], kneeL: [-2.2, 0, 0], kneeR: [-2.2, 0, 0],
      spine: [-0.42, 0, 0], neck: [0.35, 0, 0], shoulderL: [0.75, 0, -0.1], shoulderR: [0.75, 0, 0.1], elbowL: [0.6, 0, 0], elbowR: [0.6, 0, 0],
    },
    bodyDrop: 0.38,
  },
  // 举右手（指/够高处）
  raise_arm: { joints: { ...ARMS_REST, shoulderR: [2.62, 0, 0.12], elbowR: [0.18, 0, 0], neck: [0.15, 0, 0] } },
  // 双臂前伸 60°（抬担架、端东西）
  carry: { joints: { shoulderL: [1.05, 0, -0.03], shoulderR: [1.05, 0, 0.03], elbowL: [0.35, 0, 0], elbowR: [0.35, 0, 0] } },
  // 平躺（担架）：整体绕 x 转 90°，脸朝上、头朝 +z（原点仍在脚底）
  lie: { joints: { shoulderL: [0.05, 0, -0.12], shoulderR: [0.05, 0, 0.12], elbowL: [0.1, 0, 0], elbowR: [0.1, 0, 0] }, rootRotX: Math.PI / 2 },
  // 仰头
  look_up: { joints: { ...ARMS_REST, neck: [0.61, 0, 0], spine: [0.06, 0, 0] } },
};
