// owner: integrator
// （M1a 写全量并冻结；此后只有整合代理/引擎维护者能改，ARCH §2.12）
// 照片元数据（GDD §7.2）。空镜 ph.empty_<n> 不在此表（标题由拍照判定生成）。

import { PH } from './ids';
import type { KeyPhotoId, PhotoTargetId } from './ids';

export interface PhotoMeta {
  /** 相册标题（GDD §7.2） */
  title: string;
  /** 关键照片：相册红标，永不删除 */
  key: boolean;
  /** 实物照片（带纸边；ph.covered_face、ph.true_form） */
  print: boolean;
  /** 旧照一至六（南柯） */
  old: boolean;
  /** 旧照编号 1–6 */
  oldIndex?: 1 | 2 | 3 | 4 | 5 | 6;
}

export const PHOTO_META: Readonly<Record<KeyPhotoId, PhotoMeta>> = {
  [PH.TUDI]: { title: '土地爷', key: true, print: false, old: false },
  [PH.MENSHEN_2018]: { title: '贴门神·2018', key: true, print: false, old: false },
  [PH.DOOR_2019]: { title: '抬出去的那天', key: true, print: false, old: false },
  [PH.DOOR_2025]: { title: '建国搬家', key: true, print: false, old: false },
  [PH.COVERED_FACE]: { title: '捂脸的一寸照', key: true, print: true, old: false },
  [PH.FILM3]: { title: '老周与伙计', key: true, print: false, old: false },
  [PH.TRUE_FORM]: { title: '本相', key: true, print: true, old: false },
  [PH.HUANG_NORMAL]: { title: '黄三爷·常光', key: true, print: false, old: false },
  [PH.HUANG_HIDES]: { title: '三爷藏带子', key: true, print: false, old: false },
  [PH.HUANG_IR]: { title: '热乎的三爷', key: true, print: false, old: false },
  [PH.TAPE_FACE]: { title: '老周的脸', key: true, print: false, old: false },
  [PH.ZHOU_TUNNEL]: { title: '照妖镜', key: true, print: false, old: false },
  [PH.FINAL]: { title: '合影', key: true, print: false, old: false },
  [PH.OLD_1]: { title: '旧照一', key: true, print: false, old: true, oldIndex: 1 },
  [PH.OLD_2]: { title: '旧照二', key: true, print: false, old: true, oldIndex: 2 },
  [PH.OLD_3]: { title: '旧照三', key: true, print: false, old: true, oldIndex: 3 },
  [PH.OLD_4]: { title: '旧照四', key: true, print: false, old: true, oldIndex: 4 },
  [PH.OLD_5]: { title: '旧照五', key: true, print: false, old: true, oldIndex: 5 },
  [PH.OLD_6]: { title: '旧照六', key: true, print: false, old: true, oldIndex: 6 },
};

/** 旧照一至六，按编号顺序。 */
export const OLD_PHOTOS: readonly KeyPhotoId[] = [PH.OLD_1, PH.OLD_2, PH.OLD_3, PH.OLD_4, PH.OLD_5, PH.OLD_6];

/** 空镜只保留最近 20 张（GDD §3.5）。 */
export const EMPTY_KEEP = 20;

/** 拍照目标 pt.X → 照片 ph.X（后缀一一对应，GDD §13.1）。 */
export function photoForTarget(pt: PhotoTargetId): KeyPhotoId {
  return pt.replace(/^pt\./, 'ph.') as KeyPhotoId;
}

/** 缩略图尺寸（ARCH §6.8.5）。 */
export const THUMB = { w: 192, h: 144, quality: 0.7 } as const;
