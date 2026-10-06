// owner: integrator
// （M1a 写全量并冻结；此后只有整合代理/引擎维护者能改，ARCH §2.12）
// 引擎通用文本（ARCH §2.3）：操作提示、通用失败原因、空镜默认标题、菜单文字、载入中、启动失败页、存档损坏提示。
// 区域专属文本一律放在各区域的 text.ts / dialogue.ts，不放这里。

import type { FailReason, QualityLevel, Shichen } from '../core/types';
import type { PhotoFail } from '../game/photo';

export const STRINGS = {
  game: { title: '天亮了，叫我', subtitle: '槐安里·七月半' },
  loading: '载入中…',
  boot: {
    noWebgl2: '你的浏览器不支持 WebGL2，无法运行《天亮了，叫我》。请换用最新版的 Chrome、Edge、Firefox 或 Safari。',
    exception: '启动失败：',
    contextLost: '画面丢失，正在恢复…',
    /** M4 第 2 轮：上下文丢失超过 15 秒（真实时间、页面可见）还没恢复 */
    contextDead: '画面无法恢复，请刷新页面（进度已自动保存）',
    /** M4 第 2 轮：指针锁定一直被拒，降级为拖拽转视角 */
    lockFallback: '无法锁定鼠标：按住左键拖动来转视角',
  },
  save: {
    corrupted: '存档损坏，只能重新开始。',
    /** M4 第 2 轮：只有寅时存档损坏（save.auto 完好） */
    yinCorrupted: '寅时存档损坏，已无法从寅时重来。',
    /** M4 第 2 轮：自动存档写不进去（存储被禁用、配额满）；每局只提示一次 */
    writeFailed: '无法自动存档（浏览器存储不可用），关闭页面会丢失进度。',
  },
  menu: {
    continue: '继续',
    fromYin: '从寅时重来',
    newGame: '新游戏',
    resume: '继续',
    settings: '设置',
    licenses: '第三方许可',
    licensesHint: '↑↓ / PageUp / PageDown：滚动　Esc：返回',
    back: '返回',
    paused: '暂停',
    clickToContinue: '点击继续',
    /** M4 第 2 轮：有进度时“新游戏”“从寅时重来”要按两次（第一次换成这句，3 秒内再按一次才执行） */
    confirmOverwrite: '再按一次：覆盖当前进度',
  },
  settings: {
    volume: '音量',
    mouseSens: '鼠标灵敏度',
    invertY: 'Y 轴反转',
    vfMode: '取景器',
    vfToggle: '切换',
    vfHold: '按住',
    subSize: '字幕字号',
    subSizes: ['小', '中', '大'] as const,
    grain: '颗粒与色差强度',
    quality: '画质',
    reduceFlash: '减少闪光',
    colorAssist: '色彩辅助',
    hintNoCooldown: '提示无冷却',
    mirrorMode: '镜面模式',
    tunnelMode: '照妖镜模式',
    realtime: '实时',
    baked: '预制',
    on: '开',
    off: '关',
  },
  quality: { low: '低', mid: '中', high: '高' } satisfies Record<QualityLevel, string>,
  shichen: { zi: '子时', chou: '丑时', yin: '寅时', mao: '卯时' } satisfies Record<Shichen, string>,
  hud: {
    rec: 'REC',
    replayHint: '▶ 残影 · R',
    /** 回放片段序号，如“2/3” */
    replayCounter: '{i}/{n}',
    slow: 'SLOW',
    alarm: 'ALARM',
    noSignal: '无信号 · 视频入1 未接',
    keepStill: '保持不动',
    newPage: '巡夜本上多了一行字',
    hintKey: '想想土地爷的话',
    /** M4：取景器里准星对着射程外的交互物时，灰色角标下的一句 */
    tooFar: '（走近点）',
    /** M4：拿到物品时左下角的提示（“得到：钥匙串、灯泡”） */
    gotItems: '得到：',
  },
  /** 操作提示（GDD §3.2 开场节拍、§10.1） */
  tutorial: {
    move: 'WASD 移动 / 鼠标看',
    interact: 'E：交互',
    viewfinder: '右键：用你的眼睛看',
    shutter: '左键：快门',
    rewind: 'R：倒带',
    lens: 'Q：常光/红外',
    zoom: '滚轮：变焦',
    wake: '左键：按快门',
  },
  /** 动作菜单（mode.album 的 menu 子状态，GDD §3.3 M8） */
  actionMenu: { talk: '1 交谈', look: '1 查看', show: '2 出示…', use: '2 使用…' },
  dialogue: {
    /** 非强制对话的选项节点末尾自动追加的离开项（ARCH §6.13） */
    leave: '（先这样）',
  },
  album: { photos: '相册', items: '物品', used: '已用', empty: '空镜' },
  journal: {
    title: '巡夜本',
    names: '称呼',
    clues: '已知线索',
    /** “树底下 n/6” */
    ants: '树底下 {n}/6',
  },
  doc: {
    /** 褪字层在肉眼翻开时的替代符号（UI 画成一团水渍，ARCH §6.16） */
    waterStain: '▯',
  },
  feedback: {
    /** 出示/使用没有被接受时的通用反馈（ARCH §6.6） */
    nothingHere: '这儿用不上。',
    /** 未获得倒带能力时在残影点按 R（ARCH §6.9） */
    replayNoAbility: '（地上有一团雪花在打转。你还不会看这个。）',
    /** 片段 locked 时的默认文本 */
    replayLocked: '雪花太密了。好像有什么东西不让你看。',
    /** 走出回放半径 */
    replayWalkedOut: '画面断了。',
    /** 读字目标倍率不够的默认提示（M4：点明“滚轮”，“拉近”容易被理解成往前走） */
    readTooSmall: '（字太小了，滚轮拉近点。）',
    /** M4：取景器里准星对着射程外的交互物按 E */
    tooFar: '（太远了，走近点。）',
    /** M4：H 提示冷却中重复同一级时接在后面（到第 3 级不再追加） */
    hintLater: '（过一会儿再问，我说细点。）',
  },
  /** 候选谜题为空时 H 键显示的土地闲话（GDD §3.12；取自 GDD §8.1 土地台词） */
  tudiIdle: [
    '这树比这楼老。楼是八四年盖的，树是乾隆年间就有的。',
    '我？管这一亩三分地的。庙小，香火薄，一年就七月半有人给我磕个头。明儿庙一扒，我也得挪窝。',
  ] as const,
  /** 通用失败原因（ApiResult.reason → 玩家可见的简短说明；多数情况下区域会给专属反馈） */
  reason: {
    mode_disallows: '现在不行。',
    no_such_target: '这儿没有这个东西。',
    not_present: '那儿什么也没有。',
    out_of_range: '太远了，够不着。',
    wrong_view: '拿眼珠子看不见。',
    wrong_lens: '这个镜头看不出来。',
    blocked: '还不是时候。',
    not_owned: '你身上没有这个。',
    no_ability: '你还不会这个。',
    not_near_replay_point: '附近没有残影。',
    locked: '雪花太密了。',
    not_in_viewfinder: '先举起取景器。',
    no_dialogue: '没人说话。',
    no_choice: '现在没有可选的。',
    bad_option: '没有这一项。',
    no_panel: '没有打开的面板。',
    busy: '正忙着。',
    bad_args: '参数不对。',
    timeout: '超时了。',
    not_focusable: '对不准。',
    unreachable: '过不去。',
    cancelled: '被打断了。',
  } satisfies Record<FailReason, string>,
} as const;

/** 空镜默认标题（ARCH §6.8.4）：区域 captions 与 emptyCaption 都没给时用这里的。M4：一律不加句号（相册里并排看才整齐）。 */
export const EMPTY_CAPTIONS: Readonly<Record<PhotoFail, string>> = {
  nothing: '空镜',
  not_in_frame: '没对准',
  partial: '只拍进去一半',
  too_far: '太远了',
  zoom_low: '太小了，看不清',
  zoom_high: '太近了，看不全',
  wrong_lens: '颜色不对',
  too_small: '就一个小点儿',
  occluded: '被挡住了',
  hidden: '空镜',
  too_early: '空镜',
  too_late: '空镜',
  wrong_segment: '空镜',
  not_paused: '糊了，先停住',
  wrong_channel: '空镜',
  no_jack: '空镜',
  cond: '空镜',
};

/** 把 '{name}' 占位替换成值：fmt(STRINGS.journal.ants, { n: 3 }) → '树底下 3/6'。 */
export function fmt(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
