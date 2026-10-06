// owner: integrator
// （M1a 写全量并冻结；此后只有整合代理/引擎维护者能改，ARCH §2.12）
// 说话人显示名与含糊人声的音色（ARCH §2.3、§6.13；GDD §2.7、§13.7）。

import { NPC, PC, SPK } from './ids';
import type { SpeakerId } from './ids';

/** audio.murmur 的音色类别（ARCH §6.13：门神/灶君用低频共振峰嗡声；pc.huoji 不出声，只闪 REC）。 */
export type VoiceKind = 'old_man' | 'old_woman' | 'man' | 'child' | 'god' | 'none';

export interface SpeakerMeta {
  /** 对话框里的名字；旁白为空串 */
  name: string;
  /** 旁白：正文用斜体 */
  italic?: boolean;
  /** 只闪 REC 灯，不出字（pc.huoji） */
  recOnly?: boolean;
  voice: VoiceKind;
}

export const SPEAKERS: Readonly<Record<SpeakerId, SpeakerMeta>> = {
  [NPC.TUDI]: { name: '土地', voice: 'old_man' },
  [NPC.WANG]: { name: '王奶奶', voice: 'old_woman' },
  [NPC.LU]: { name: '陆师傅', voice: 'old_man' },
  [NPC.BOY]: { name: '门童', voice: 'child' },
  [NPC.HUANG]: { name: '黄三爷', voice: 'old_man' },
  [NPC.ZHOU]: { name: '老周', voice: 'old_man' },
  [SPK.YUCHI]: { name: '尉迟恭', voice: 'god' },
  [SPK.QIN]: { name: '秦琼', voice: 'god' },
  [SPK.ZAOWANG]: { name: '灶王爷', voice: 'god' },
  [SPK.ZAONAINAI]: { name: '灶王奶奶', voice: 'god' },
  [SPK.WORKER]: { name: '拆迁工人', voice: 'man' },
  [SPK.NARRATOR]: { name: '', italic: true, voice: 'none' },
  [PC.HUOJI]: { name: '伙计', recOnly: true, voice: 'none' },
};

/** 显示名；who 为 '' 或 spk.narrator 时是旁白（空串）。 */
export function speakerName(who: SpeakerId | ''): string {
  return who === '' ? '' : SPEAKERS[who].name;
}

/** 是否按旁白显示（斜体、无名字）。 */
export function isNarration(who: SpeakerId | ''): boolean {
  return who === '' || SPEAKERS[who].italic === true;
}
