// owner: WP2
// 8 种关键姿势（ARCH §5.1）。WP2 内部数据：createHumanoid 使用；其他 WP 只经 HumanoidRig.setPose 使用。
//
// 角度约定（与 ARCH §5.1 的文字描述符号相反，注意）：人偶面朝 -z、右手在 +x，按 three 右手系：
//   绕 X 为正 = 下垂的肢体往前（-z）摆：髋前屈（抬大腿）、肩前举、肘屈为正；膝屈为负；
//   躯干（朝上）绕 X 为负 = 向前弯腰；颈绕 X 为正 = 抬头；
//   绕 Z 为正 = 下垂的肢体往 +x（右侧）摆，所以左臂外展为负、右臂外展为正。
//   char2 腕、踝（human/ 内部关节）：腕绕 Y 为“沿前臂转”，右手为正 = 内旋（掌心转向后），左手相反；
//   腕绕 X 为正 = 手往前弯；踝绕 X 为正 = 勾脚尖（背屈），负 = 绷脚（跖屈）。
// ARCH 写的“sit 髋 -90°、膝 90°”“raise_arm 右肩 -150°”“look_up 颈 -35°”是同一组动作，只是按“前屈为负”描述。
// char2：踝缺省按“脚掌贴地”自动求（踝 = −(髋 + 膝)，见 human/motion），姿势里写的踝值加在它上面；feet: 'free' 的姿势（躺）不求。

import type { Pose, V3 } from '../core/types';
import type { JointName } from './humanoid';
import type { ExtraJointName } from './human/types';

/** 关节欧拉角（弧度，XYZ）与整体偏移。 */
export interface PoseDef {
  joints: Partial<Record<JointName | ExtraJointName, V3>>;
  /** 身体整体下移（×高度比），sit 为 0.45（儿童、土地按腿长缩放，见 human/motion） */
  bodyDrop?: number;
  /** 整体绕 x 轴旋转（弧度），lie 为 π/2 */
  rootRotX?: number;
  /**
   * 髋高怎么定：'legs' = 按腿的姿态求，让最低的脚底刚好着地（站、走、蹲；bodyDrop 不用）；'drop' = 用 bodyDrop（坐：家具约定）。
   * 缺省：有 bodyDrop 或 rootRotX 的是 'drop'，其余 'legs'。
   */
  ground?: 'legs' | 'drop';
  /** 'flat'（缺省）= 脚掌贴地：踝自动补偿髋 + 膝；'free' = 不补偿（躺下时脚尖朝上、自然下垂） */
  feet?: 'flat' | 'free';
}

/** 放松站立的手臂（PLAN §3.4）：肩略外展 ±0.10、肘自然微屈 0.22、腕内旋 0.10（掌心略朝后，不是立正的“贴裤缝”）。 */
const ARMS_REST: Partial<Record<JointName | ExtraJointName, V3>> = {
  shoulderL: [0.03, 0, -0.1], shoulderR: [0.03, 0, 0.1], elbowL: [0.22, 0, 0], elbowR: [0.22, 0, 0],
  wristL: [0.06, -0.1, 0], wristR: [0.06, 0.1, 0],
};

export const POSES: Readonly<Record<Pose, PoseDef>> = {
  stand: { joints: { ...ARMS_REST } },
  walk: { joints: { ...ARMS_REST } },
  // 坐：大腿水平前伸、小腿垂直；双手搭在大腿上（腕内旋把掌心转向下、略背伸让手掌平贴），脚掌平放
  sit: {
    joints: {
      hipL: [Math.PI / 2, 0, -0.04], hipR: [Math.PI / 2, 0, 0.04], kneeL: [-Math.PI / 2, 0, 0], kneeR: [-Math.PI / 2, 0, 0],
      spine: [-0.05, 0, 0], shoulderL: [0.55, 0, -0.08], shoulderR: [0.55, 0, 0.08], elbowL: [0.75, 0, 0], elbowR: [0.75, 0, 0],
      wristL: [-0.25, -1.25, 0], wristR: [-0.25, 1.25, 0],
    },
    bodyDrop: 0.45,
  },
  // 蹲：深屈膝、上身前倾，双手前伸、手腕放松下垂；踮着前脚掌蹲（脚跟抬起 ~0.5）。髋高按腿求，脚尖着地（旧版 bodyDrop 0.38 让脚悬空 ~10cm）
  crouch: {
    joints: {
      hipL: [1.75, 0, -0.18], hipR: [1.75, 0, 0.18], kneeL: [-2.2, 0, 0], kneeR: [-2.2, 0, 0],
      spine: [-0.42, 0, 0], neck: [0.35, 0, 0], shoulderL: [0.75, 0, -0.1], shoulderR: [0.75, 0, 0.1], elbowL: [0.6, 0, 0], elbowR: [0.6, 0, 0],
      wristL: [0.35, -0.5, 0], wristR: [0.35, 0.5, 0], ankleL: [-0.5, 0, 0], ankleR: [-0.5, 0, 0],
    },
    bodyDrop: 0.38,
    ground: 'legs',
  },
  // 举右手（指/够高处）：肘略弯、上身微后仰并稍往举手一侧靠，抬头看手
  raise_arm: {
    joints: {
      ...ARMS_REST, shoulderR: [2.62, 0, 0.12], elbowR: [0.3, 0, 0], wristR: [-0.15, 0.3, 0],
      spine: [0.05, 0, -0.04], neck: [0.17, 0, 0],
    },
  },
  // 双臂前伸 60°（抬担架、端东西）：掌心相对、手腕略背伸托住
  carry: {
    joints: {
      shoulderL: [1.05, 0, -0.03], shoulderR: [1.05, 0, 0.03], elbowL: [0.35, 0, 0], elbowR: [0.35, 0, 0],
      wristL: [-0.2, 0, 0], wristR: [-0.2, 0, 0], spine: [0.04, 0, 0],
    },
  },
  // 平躺（担架）：整体绕 x 转 90°，脸朝上、头朝 +z（原点仍在脚底）；脚尖自然放松下垂，手放松
  lie: {
    joints: {
      shoulderL: [0.05, 0, -0.12], shoulderR: [0.05, 0, 0.12], elbowL: [0.12, 0, 0], elbowR: [0.12, 0, 0],
      wristL: [0.15, -0.3, 0], wristR: [0.15, 0.3, 0], ankleL: [-0.45, 0, -0.08], ankleR: [-0.45, 0, 0.08],
    },
    rootRotX: Math.PI / 2,
    feet: 'free',
  },
  // 仰头
  look_up: { joints: { ...ARMS_REST, neck: [0.61, 0, 0], spine: [0.06, 0, 0] } },
};
