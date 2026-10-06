# engine-wp6：WP6 的接口需求与缺陷（M1b）

> 唯一写入者：WP6（只**追加**，不改别人的条目；ARCH §2.12、§15.2、§15.6）。M1c 起由整合代理逐条处理，并把“状态”行改为结论。
> 签名不够用、或发现别的 WP 的契约有问题时：不改签名、不改别人的文件；先在自己的文件里绕开，再在这里追加一条。
> 交付时在文件末尾加一个 `## Lessons` 小节（每条一行），由整合代理收录进 AGENTS.md（WP 不写 AGENTS.md）。

## 条目格式（ARCH §15.6）

```md
## <编号>. <一句话标题>
- 类型：接口需求 | 引擎缺陷 | 缺 id | 文档矛盾
- 现象/需要什么：……（引擎缺陷附复现步骤与 state() 片段）
- 影响：GDD §11 步骤 …；regions 脚本里的 blockedBy
- 临时绕开：……（没有就写“无”）
- 状态：open            ← 整合者处理后改为 resolved（改了哪些文件）/ wontfix（理由）
```

<!-- WP6 的条目从这里往下追加，编号从 1 开始。 -->

## 1. 相册/挑选器的 `pick.index` 下标空间、方向键规则与光标读取
- 类型：接口需求
- 现象/需要什么：ARCH §7 只说“点击发 `{t:'pick', index}`、方向键发 `nav`、Enter/左键确认”，没有定义 index 指什么，AlbumMode 的键盘光标也没有任何冻结的读取方式（UI 要高亮它，调试 API `show/use` 要“选中 thing”也要同一个下标）。WP6 的约定（已实现，见 `src/ui/album.ts` 顶部）：
  1. 下标空间：`entries = [...state.listPhotos(), ...state.listItems()]`（照片在前、物品在后，各按系统返回的顺序），`pick.index` 就是它的下标；相册（左，4×3 分页）与物品栏（右，一列）同屏，不需要页签状态（`AlbumArg.tab` 只决定初始光标：`'items'` 时落在第一件物品，否则 0）。
  2. `pick` = 选中这一格并确认（挑选器里等于 Enter；浏览时等于“打开”，文档类物品 → `openDoc`，`opensJournal` → `openJournal`）。UI 点击只发 `pick`，不再另发 `confirm`。
  3. 方向键规则 `albumNav(i, dx, dy, P, N)`（`ui/album.ts` 导出）：照片区里上下 = ±4 且不出照片区，物品区里上下 = ±1 且不出物品区，左右 = 总列表 ±1（可跨区），都钳到 [0, N-1]。请 AlbumMode 采用同一规则。
  4. 请给 AlbumMode 加只读 `cursor: number`（属性或无参方法均可）并写进 ARCH；UI 已按“有就用”读取（`readNumber(modes.handler('mode.album'), 'cursor')`）。
  5. 动作菜单按 2 切到挑选器时，必须让 `modes.arg('mode.album')` 变成 `{pick}`（例如 pop 再 push，或 ModeStack 提供替换 arg），UI 与 `DebugState.album.kind` 都靠它区分 menu/pick。动作菜单的点选发 `{t:'digit', n: 1|2}`（与附录 A 的 digit 行一致）。
- 影响：GDD M8 全部出示/使用步骤；`show()/use()` 调试 API（WP7 需要同一个 index）；`input.mjs` 的挑选器方向键/Enter 用例
- 临时绕开：UI 经 `game.input.onButton` 镜像方向键（album 为栈顶时），按上面的规则移动自己的高亮；两边规则一致时 Enter 与高亮一致。
- 状态：resolved（M1c：AlbumMode 与 AlbumView 的约定一致（格子总列表、pick、albumNav、子状态切换用 pop+push 让 arg 变成 {pick}、动作菜单点选发 digit），`AlbumMode.cursor` 等冻结；写进 ARCH §6.6）

## 2. 角标闪烁（`InteractableHandle.blink()`、提示空闲闪烁）没有到 UI 的通道
- 类型：接口需求
- 现象/需要什么：ARCH §7 要求 `blink()` 做一次 0.6s 闪烁，但 `InteractableStatus` 里没有闪烁状态，UI 也没有冻结的方法可调。WP6 已实现 `HudView.blink(id: InteractId): void`（按游戏时间 0.6s，目标即使不在射程内也画出角标）。请冻结它（ARCH §7 的 HudView 加一行），由 WP4 的 `InteractableHandle.blink()` 与 `HintSystem` 空闲闪烁调用 `game.ui.hud.blink(id)`；或者改为在 `InteractableStatus` 加 `blink?: boolean`（UI 两种都容易接）。
- 影响：GDD §3.12 空闲闪烁；ARCH §6.6 `InteractableHandle.blink`
- 临时绕开：无（WP4 可以先直接调 `game.ui.hud.blink`）
- 状态：resolved（M1c：通道定为系统状态——`InteractableStatus.blink`（剩余闪烁秒，WP4 已写）冻结，HudView 每帧读 list() 里的 blink 闪角标（原来只认 UI 自己的 blink(id)，InteractableHandle.blink() 与提示空闲闪烁从未显示）。改了 src/game/interaction.ts、src/ui/hud.ts；`m1c.blink` 覆盖；ARCH §6.6/§7）

## 3. 过场的 `{osd}`、白闪、`{await}` 提示没有 UI 方法
- 类型：接口需求
- 现象/需要什么：`CutStep` 的 `{ osd: string | fn | null }`（“过场一律用监控固定机位：画面带 OSD”，GDD §3.1）在冻结的 UI 签名里没有显示通道；`{fade:'white'}` 与 `{await, prompt, early}` 也没写走哪里。WP6 已补：
  - `UI.setOsd(text: string | null): void`：过场 OSD 行（REC + 文本，画在 4:3 画框左上），只在 `mode.cutscene` 在栈上时显示，过场结束自动清空；函数形式的 osd 由 CutsceneSystem 每帧求值后调用；
  - `FadeLayer.flash(ms?: number): void`：DOM 白闪，遵守 `reduceFlash`（改为 0.25s 柔和淡入淡出）；
  - 提示类文本建议用 `ui.toast(prompt, 'tutorial')`，`early` 用 `ui.toast(early)`。
  请冻结 `UI.setOsd` 与 `FadeLayer.flash`（或给出别的通道）。
- 影响：开场 `cs.r1.intro`、结局 `cs.r1.dawn` 等所有带 OSD 的过场
- 临时绕开：无（WP4 可以先直接调用）
- 状态：resolved（M1c：过场 OSD 的通道定为 `CutsceneSystem.osdText()`（冻结），UI.update 每帧拉取（原来没人调 setOsd，过场 OSD 从不显示）；`{fade:'white'}` 走 post.flash，`{await}` 的 prompt/early 走 toast。UI.setOsd、FadeLayer.flash 留作 WP6 内部。改了 src/ui/ui.ts；`m1c.cutscene_osd` 覆盖；ARCH §6.14/§7）

## 4. `PanelSystem.code` 缺位数与标题，`PanelSystem.naming` 缺表头
- 类型：接口需求
- 现象/需要什么：密码面板要画 N 个转轮，称呼面板要画“长明照相馆　取件单　No.0474　姓名：＿＿”，但冻结的 `code: { owner; entered; fails }`、`naming: { owner; options }` 里没有 `CodeLockDef.digits/title` 与 `NamingDef.header`，也没有按 owner 取定义的方法。请在两个只读状态里加上：`code.digits: number`、`code.title?: string`、`naming.header: string`（只加字段，不影响现有读者）。
- 影响：GDD P2（抽屉密码锁）、P8（称呼面板）的界面
- 临时绕开：UI 读可选字段（`readNumber(code,'digits')`、`readString(code,'title')`、`readString(naming,'header')`），缺省为 4 位（全作唯一的密码锁 r1.drawer 是四位）、标题用 owner 交互物的现算角标名、表头用“<角标名>　姓名：＿＿”。WP4 现在就在对象上多放这几个字段，UI 即刻生效。
- 状态：resolved（M1c：`PanelSystem.code/naming` 的类型改为冻结的 `CodeState`（digits/title/wheels/cursor）与 `NamingState`（header/labels）；CodePanel/NamingPanel 直接读字段，密码面板显示正在拨的转轮。改了 src/game/panels.ts、src/ui/codePanel.ts、src/ui/namingPanel.ts；ARCH §6.15）

## 5. 文档 `covered` 段“已读过”的判定没有持久来源
- 类型：接口需求
- 现象/需要什么：`DocDef.covered = { text, readBy }`（讣告下半截，读到 `rd.obituary_hidden` 之前在阅读器里打码），但 `renderDoc` 不处理 covered，ReadSystem 也没说首次读到时会记 `seen`。UI 现在的判定是 `state.seen(readBy) || 本局收到过 'read' 事件`——读档后若没有 `seen`，讣告会重新被打码。请 WP5 在第一次读到某 `rd.*` 时 `state.markSeen(rd.id)`（与 onRead 同时，存档里持久），并把这条写进 ARCH §6.8.6；或者由 `renderDoc` 负责 covered 并在 ARCH §6.16 写明。
- 影响：GDD §7.4 讣告；R1 文档
- 临时绕开：见上（本局内正确，读档后依赖 seen）
- 状态：resolved（M1c：持久来源是 JournalSystem 在 'read' 事件时 markSeen(rd.id)（seen 进存档），所以读档后 state.seen(readBy) 仍为真；不需要 WP5 另写。写进 ARCH §6.8.6）

## 6. `DialogueSystem.active.text` 的语义（全文还是已打出的前缀）与 `rec` 次数
- 类型：文档矛盾
- 现象/需要什么：ARCH §6.13 只说打字机在 `dialogue.update`，`active.text` 是“求值后的字符串”，没说是全文还是打字中的前缀；`DNode.rec: 1|2`（伙计闪几下 REC）也不在 `active` 里。UI 两种 text 都兼容：`typing` 为真时按 30 字/秒（游戏时间）逐字显出（取与 text 长度的较小者），`typing` 变假立即全文；伙计的行（`SPEAKERS[who].recOnly`）不出字，只让对话框与 HUD 的 REC 快闪 1.2 秒。建议写明 `active.text` 为全文（`DebugState.dialogue.text` 与测试断言要全文），并在 `active` 加 `rec?: 1 | 2`。
- 影响：无（显示层）
- 临时绕开：见上
- 状态：resolved（M1c：`DialogueActive` 冻结：text 恒为全文、shown = 打字机字数、rec；DialogueBox 改为按 shown 显示（原来 UI 自己按 30 字/秒另算一遍）。改了 src/game/dialogue.ts、src/ui/dialogueBox.ts；ARCH §6.13）

## 7. `UI.setLoading(on)` 的调用约定：300ms 延迟由 UI 做
- 类型：文档矛盾
- 现象/需要什么：ARCH §7 写“载入中…（areas.isLoading() 超过 300ms）”，§3.1 第 8 步写“持续超过 300ms 时淡黑层上显示”，没说延迟由谁做；WP6 的最小自测要求“setLoading 300ms 后可见”。UI 的实现：`setLoading(true)` 之后 300ms（真实时间，`TIMING.loadingDelayMs`）仍未关才显示，`setLoading(false)` 立即隐藏。所以 WP1 应在 `isLoading()` 变真时立刻调 `setLoading(true)`、变假时调 `setLoading(false)`，不要自己再等 300ms（否则实际是 600ms）。
- 影响：无
- 临时绕开：无需
- 状态：resolved（M1c：WP1 原来在建区超过 300ms 后才 setLoading(true)，加上 UI 的 300ms 实际是 600ms；改为建区开始即 setLoading(true)、结束即 false（src/core/game.ts `updateLoadingOverlay`），ARCH §7 写明）

## 8. `'feedback'` 事件、`toast`/`subtitle` 与 `lastFeedback()` 的分工
- 类型：接口需求
- 现象/需要什么：ARCH 只写了“toast 同时发 'feedback' 事件”，`'feedback'` 又被定义为“任何反馈/旁白/字幕文本”。UI 的实现（请整合者确认并写进 ARCH §7）：
  - `UI.toast(text, kind)` 与 `UI.subtitle(text, who, dur)` 都显示并发 `'feedback'`（字幕带 `speaker`）；产出方（WP4 的 say/feedback/交互反馈、WP5 的回放字幕与读字反馈等）只需调用这两个方法，不要自己再发事件；
  - `lastFeedback()` = 最近一次 `'feedback'` 事件的文字（含字幕），`currentSubtitle()` = 此刻显示中的最新一行字幕；
  - 别处直接 `emit('feedback')`（没经过 UI）的文字，UI 在本帧末尾补显示（带 speaker → 字幕，否则 → 反馈条），同一文字已在显示或正是对话框当前台词时跳过，所以两边都做了也不会重复显示；
  - `subtitle` 的 `dur` 缺省按每字 0.12 秒、最少 2 秒；字幕与反馈条按游戏时间倒计时（冻结时停）。
- 影响：`expect.feedback()`、`DebugState.subtitle/lastFeedback`
- 临时绕开：无需
- 状态：resolved（M1c：采用 WP6 的分工（toast/subtitle 发事件、产出方不发），删掉 WP4 speak() 的重复 emit；ARCH §7“反馈与字幕”写明）

## 9. 三脚架 OSD 文字（`TripodConfig.osd(remaining)`）读不到
- 类型：接口需求
- 现象/需要什么：`TripodSystem` 只公开 `state/remaining/exposure01`，区域提供的 `osd(remaining)` 文字 UI 拿不到。请加 `TripodSystem.osdText(): string`（或把它交给 CH1 画面的 OSD）。
- 影响：GDD X4 画面
- 临时绕开：UI 左上角用 `shichen.osdLine(1)`，右上角自己画 `00:SS` 倒计时（`Math.ceil(remaining)`），曝光时中央进度环 + “保持不动”。
- 状态：resolved（M1c：冻结 `TripodSystem.osdText()`，TripodHud 显示它（空时退回 shichen.osdLine(1)）；src/ui/tripodHud.ts，ARCH §6.12）

## 10. `ReplaySystem.active.index` 从 0 还是 1 起
- 类型：文档矛盾
- 现象/需要什么：回放 HUD 显示“2/3”这样的片段序号，ARCH §6.9 的 `active: { index; count }` 没说 index 的起点。UI 按 0 起（`point.segments` 的下标）显示 `index + 1`。请写明（与 `DebugState.replay.index` 一致）。
- 影响：回放 HUD 的序号
- 临时绕开：见上
- 状态：resolved（M1c：定为从 1 起（WP5 的实现、DebugState 同值）；修 src/ui/replayHud.ts 的 index + 1（第一段原来显示 2/2）；ARCH §6.9；scripts/selftest/m1c.mjs 验证）

## 11. 时辰过场、指针锁定遮罩、暂停菜单的显隐由 UI 按状态自动处理（说明，供整合核对）
- 类型：接口需求
- 现象/需要什么：为了不依赖别的 WP 何时调用 show/hide，UI.update 按状态自行处理，别的 WP 调用也不冲突（show/hide 幂等）：
  - `'shichen'` 事件 → HUD 左下时辰字样做 2 秒强调（“远钟 + HUD 字样变化”的字样部分；远钟由音频负责）；WP4 若另外调 `ui.fade.title(字样)` 会再叠一个居中字样，可选；
  - “点击继续”：栈顶按栈求值的指针策略为 `lock`、`input.lockAvailable`、未锁定、没有菜单 → 显示；点击时 `input.requestPointerLock()`；
  - 暂停：`mode.pause` 在栈上而菜单没显示 → `menus.showPause()`；`mode.pause` 被弹出 → 收起暂停页（含从暂停页打开的设置页）；暂停菜单“继续”（用户手势）在回到 lock 模式时顺手 `requestPointerLock()`。
  - 标题菜单：`showTitle()` 读 `save.read('save.auto')`，损坏（reason 不是 missing）时 toast `STRINGS.save.corrupted`（'system'），所以 SaveSystem.read 自己不必再 toast（重复了也会被去重）。
- 影响：无
- 临时绕开：无需
- 状态：resolved（M1c 核对无冲突，写进 ARCH §7“显隐由 UI 按状态推导”）

## 12. WP6 在冻结签名之外新增的公开成员（整合时决定是否冻结）
- 类型：接口需求
- 现象/需要什么：以下成员是 WP6 为自测、调试或上面 #1–#3、#14 的通道加的，别的 WP 目前不得依赖（#2、#3、#14 的除外，建议冻结）：`UI.subs`（SubtitleLayer）、`UI.root`、`UI.isHidden()`、`UI.setOsd()`、`UI.isUiEventTarget()`、`HudView.markersEl/blink()/flashRec()`、`FadeLayer.flash()/loadingVisible()/blackLevel()`、`Menus.currentPage()/inPauseFlow()/key()`、`AlbumView.nav()/selected()`、`PointerGate.visible`；新增 WP6 内部模块 `src/ui/dom.ts`（DOM 小工具，与 `ui/styles.ts` 同属 WP 内部模块，ARCH §2.13 的清单可以加上它）。
- 影响：无
- 临时绕开：无需
- 状态：resolved（M1c 冻结 `UI.isUiEventTarget()`（InputManager 用），blink/osd 通道改由系统状态提供（见 #2、#3），其余成员与 `ui/dom.ts` 列为 WP6 内部（ARCH §7 末尾、§2.13））

## 13. `UI.setFrameRect(r)` 的单位：#app 内的 CSS 像素
- 类型：文档矛盾
- 现象/需要什么：ARCH §4.7 的 `CameraRig.frameRect()` 只说“4:3 画框在屏幕上的像素矩形（UI 与判定共用）”，没说是 CSS 像素还是渲染缓冲区像素。UI 把它直接写成 CSS 变量（`--fx/--fy/--fw/--fh`，单位 px，相对 #app 左上角）。请写明 `frameRect()` 返回 CSS 像素；若它返回的是乘过 DPR/动态分辨率的缓冲区像素，WP1 调 `setFrameRect` 前要先除回去，否则高 DPI 屏上取景框画错位置。`setFrameRect` 从未被调用时 UI 用 #app 尺寸自己算中央最大 4:3（与 ARCH §4.7 的规则相同）兜底。
- 影响：取景器 HUD、回放 HUD、三脚架 HUD、过场 OSD 的位置
- 临时绕开：见上
- 状态：resolved（M1c 核对：RenderPipeline.resize 用 host 的 clientWidth/Height（CSS 像素）调 setViewport，frameRect 就是 CSS 像素；写进 ARCH §4.7 与 §7）

## 14. 点在 UI 上的鼠标不要再被 InputManager 翻译成 Action
- 类型：接口需求
- 现象/需要什么：UI 的相册格子点击发 `{t:'pick', index}`、对话选项点击发 `{t:'choose', k}`、菜单与面板按钮各发自己的 Action（ARCH 附录 A 的“点选（UI）”）。如果 InputManager 在 window 捕获阶段监听 pointerdown/mousedown，同一次点击还会被翻译成 `MouseLeft`（挑选器里的 confirm、取景器叠加时的快门……），造成一次点击触发两次。请 InputManager 对 `game.ui.isUiEventTarget(ev.target)` 为真的鼠标按键事件不产生 Action（UI 已实现该方法；各层 pointer-events:none，只有可点元素能成为事件目标，所以判断就是“目标在 UI 根下”），或者只在 canvas 上监听鼠标按键。键盘不受影响。
- 影响：GDD M8 挑选器、对话选项、`input.mjs` 的鼠标用例
- 临时绕开：UI 的点击处理里 `stopPropagation()`（只挡得住冒泡阶段的监听）
- 状态：resolved（M1c：`InputManager.onGameSurface` 对 `game.ui.isUiEventTarget(target)` 为真的鼠标键不产生 Action（src/core/input.ts）；`m1c.ui_click` 验证取景器里点在 UI 上不按快门、点在 canvas 上照常；ARCH §4.6）

## Lessons
- CSS 重置写成 `.cm-ui button { padding:0 }`（特异度 0,1,1）会压过组件的单类规则 `.cm-amenu-item { padding:… }`（0,1,0），组件样式全失效；重置一律包在 `:where(.cm-ui button)` 里（特异度 0）。
- 绝对定位但没有 z-index 的容器不构成层叠上下文：相册照片角的 `z-index:1/2` 会越过后面兄弟节点（文档阅读器）画在它上面；每个全屏面板根节点加 `isolation: isolate`。
- 横格纸的格线要画在正文元素自己的背景上，周期取正文的行高（同一个 em），标题等其他元素不要共用这张背景，否则线与字逐行错位。
- 一次性的浏览器内测试不需要构建：vite `createServer({ configFile: false, root, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [虚拟模块 + configureServer 中间件返回一个 HTML] })`，页面脚本写 `/@id/__x00__virtual:xxx`。不要让 vite 加载一个“按绝对路径 import vite”的配置文件——它会把 vite 自己打包一遍并刷屏告警。
- `src/areas/**` 里连注释也别写 `setTimeout`/`__game` 这类 check.mjs 禁用词；dev 夹具里等真实时间用 `requestAnimationFrame` 轮询 `performance.now()`。
- UI 从模式栈推导显隐（每帧比较、变化时调幂等的 show/hide）比依赖各模式处理器调用 show/hide 稳：谁先谁后、漏调都不影响结果。
