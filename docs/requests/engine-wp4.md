# engine-wp4：WP4 的接口需求与缺陷（M1b）

> 唯一写入者：WP4（只**追加**，不改别人的条目；ARCH §2.12、§15.2、§15.6）。M1c 起由整合代理逐条处理，并把“状态”行改为结论。
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

<!-- WP4 的条目从这里往下追加，编号从 1 开始。 -->

## 1. AlbumMode 的键盘光标与格子序号约定需要写进 ARCH（WP6 的 UI、WP7 的 show/use 都要用）
- 类型：接口需求
- 现象/需要什么：冻结签名里读不到挑选器的选中格。WP4 采用 WP6 在 ui/album.ts 里写明的约定：格子总列表 `things = [...state.listPhotos().map(p => p.id), ...state.listItems().map(i => i.id)]`，`{t:'pick', index}` 与光标都是它的下标；方向键规则同 WP6 的 albumNav（照片区上下 ±4、物品区上下 ±1、左右总列表 ±1、钳位）。`AlbumMode` 另公开（非冻结）：`cursor`、`kind`（browse/menu/pick）、`menuIndex`、`things()`、`selectThing(thing): boolean`。建议把这些连同“`pick` = 选中并确认（挑选器）/打开（浏览）”写进 ARCH §6.6、§7。WP7 的 `show(target, thing)` 可以：push `album{pick}` → `(modes.handler('mode.album') as AlbumMode).selectThing(thing)` → dispatch `{t:'confirm'}`（确认即弹出 album 并 `activate(target,{verb,thing},'player')`，之后 `game.settle()`）；或 dispatch `{t:'pick', index: things().indexOf(thing)}`，一步到位。
- 影响：GDD §11 所有 show/use 步骤（调试 API）；input.mjs 的挑选器方向键/Enter
- 临时绕开：无（WP4 已按上述约定实现）
- 状态：resolved（M1c：核对 AlbumMode 与 WP6 AlbumView 的下标空间与方向键规则一致；格子序号、pick 语义、方向键、初始光标、`AlbumMode.cursor/kind/menuIndex/things()/selectThing()` 冻结进 ARCH §6.6。WP7 的 show/use 仍直接 activate（与挑选器确认同一入口），挑选器本身由 input.mjs 的真实按键覆盖）

## 2. WP4 系统给 UI 的补充字段（运行期附加，非冻结签名）
- 类型：接口需求
- 现象/需要什么：UI 需要、冻结签名里没有的读数，WP4 已在返回对象上附加（类型见各文件导出的 *Ex/*State 接口）：
  `DialogueSystem.active` 另有 `shown`（打字机已显示字数）、`rec`（pc.huoji 行的 REC 次数）；`PanelSystem.code` 另有 `wheels`/`cursor`/`digits`/`title`，`naming` 另有 `header`/`labels`；`InteractionSystem.list()` 的每项另有 `marker`（此刻该画角标）、`blink`（剩余闪烁秒）、`colorHint`（现算）、`menuVerb`；
  另有方法 `CutsceneSystem.osdText()`（过场 OSD）、`JournalSystem.right()`（巡夜本右页：称呼+来源、线索、`树底下 n/6`）、`JournalSystem.pageSeen(i)`、`ShichenSystem.transitioning`、`InteractionSystem.hasPrimaryAction(id)`/`verbOf(id)`/`anchorOf(id)`/`check(id)`（WP7 的 `lint()` 判断“按 E 是否弹动作菜单”= hasPrimaryAction && hasOffers，以及 menuVerb）。
  建议 M1c 挑 UI/调试真正用到的写进 ARCH（§6.6、§6.13–6.16、§7）。
- 影响：WP6 的 DialogueBox/CodePanel/NamingPanel/角标/巡夜本；WP7 的 lint、DebugState
- 临时绕开：无
- 状态：resolved（M1c 冻结 UI/调试真正用到的：`InteractableStatus` 并入 marker/blink/colorHint/menuVerb（`InteractableStatusEx` 改为别名）、`InteractionSystem.blink/hasPrimaryAction/verbOf`、`DialogueActive`（shown/rec）、`CodeState`/`NamingState`、`CutsceneSystem.osdText()`；getter 的返回类型改成这些命名类型。UI 改为读它们：对话框打字机按 shown、密码面板画 wheels/cursor、角标按 status.blink 闪、过场 OSD 从 osdText() 拉。`JournalSystem.right()/pageSeen()`、`ShichenSystem.transitioning`、`anchorOf/check` 仍为内部。改了 src/game/{interaction,dialogue,panels}.ts、src/ui/{hud,dialogueBox,codePanel,namingPanel,ui}.ts，ARCH §6.6/§6.13/§6.14/§6.15/§7）

## 3. 字幕的 'feedback' 事件由 WP4 发，UI.subtitle 不要再发
- 类型：文档矛盾
- 现象/需要什么：ARCH §4.3 说 'feedback' 覆盖“任何反馈/旁白/字幕文本”，但只写了 `UI.toast` 会同时发。WP4 的 `E.say`、`GameApi.say`、过场 `{say}`、提示（H 键）经内部 `speak()` 调 `ui.subtitle(...)` 并**自己**发 `'feedback'`（带 speaker）。若 WP6 的 `UI.subtitle` 也发，会重复一条。交互反馈走 `ui.toast`（由 UI 发），WP4 不重复发。
- 影响：`expect.feedback`、`state().lastFeedback`
- 临时绕开：无（重复一条不影响断言）
- 状态：resolved（M1c 统一为“UI.toast/UI.subtitle 发 'feedback'，产出方不自己发”：删掉 `speak()`（src/game/effects.ts）里的重复 emit；新增页面内自测 `m1c.feedback_once`（say/feedback 各恰好一次）；ARCH §7 写明）

## 4. 对话结束顺序：先弹 mode.dialogue，再执行“终止选项”与 end 节点的 effects
- 类型：文档矛盾
- 现象/需要什么：`dlg.r1.bracket_confirm` 的“装回去”是 `E.call(g => g.tripod.enter())`，tripod.enter 会压 mode.tripod。若选项 effects 在对话仍在栈上时执行，栈变成 `[explore, dialogue, tripod]`，对话结束时弹不掉自己（pop 要求栈顶匹配）。WP4 的实现：选项的 next 指向 end 节点（或是“（先这样）”）时，先弹 mode.dialogue，再在同一 scope 里执行该选项与 end 节点的 effects，最后 resolve；非终止选项/节点的 effects 在对话仍在栈上时执行。另有自愈：栈顶那层 mode.dialogue/mode.cutscene 没有对话/过场认领时，`DialogueMode.update`/`CutsceneMode.update` 把它弹掉。建议写进 ARCH §6.13。
- 影响：GDD §11 步骤 57（支架确认 → 三脚架）；R2 楼梯井（选项 effects 里 setLevel 时已回到 explore）
- 临时绕开：无
- 状态：resolved（M1c：“终止选项先弹 mode.dialogue 再执行 effects”与自愈规则写进 ARCH §6.13）

## 5. 模式栈要允许同一模式叠多层（对话 → 过场 → 对话）
- 类型：文档矛盾
- 现象/需要什么：ARCH §6.3/§6.14 要求“对话 → 过场 → 对话”内联嵌套，栈上会出现 `[… dialogue, cutscene, dialogue]`；§4.6 没写 push 是否允许重复 id、arg(id) 取哪层。WP1 的 ModeStack 当前实现允许重复、arg 取最上面一层，与 WP4 的假设一致；请把这条写进 ARCH §4.6。对话里直接再开对话（节点 effects 里 E.dialogue）时 WP4 复用栈顶那层 mode.dialogue，不再压栈；过场同理。
- 影响：结局的嵌套过场
- 临时绕开：无
- 状态：resolved（M1c：ARCH §4.6 写明 push 允许同一模式叠多层、arg(id) 取最上面一层；§6.13 写明对话里再开对话复用栈顶那层）

## 6. 过场 {cam:'ch1'} 没有 CH1 机位来源
- 类型：接口需求
- 现象/需要什么：CutStep 的 `'ch1'` 要“用 ch1 角色（不含 self_head）”，但引擎侧拿不到 CH1 机位（在 R1 的 layout.ts 与 TripodConfig.camPose 里，都不是 WP4 能读的公开数据）。WP4 的实现：`{cam:'ch1'}` 保持固定相机当前位姿、只切到 ch1 角色；过场开播时固定相机先摆到当前主相机的位姿。R1-finale 要用 CH1 机位时先写 `{ cam: R1.derived.ch1Cam }`（或在三脚架之后，固定相机本来就在 CH1 机位），再 `{ cam:'ch1' }`；或给 CutStep 加可选 `pose`。`{cam:'player'}` = 固定相机摆回第三人称相机的位姿。
- 影响：cs.r1.dawn、结局片尾
- 临时绕开：见上
- 状态：resolved（M1c 不加 CutStep 字段（R1 的 layout.ts 可直接给 CameraPose）：`{cam:'ch1'}` 保持当前位姿只切角色、`{cam:'player'}` 的语义与用法写进 ARCH §6.14）

## 7. “重看时长按空格跳过”简化为按一下
- 类型：接口需求
- 现象/需要什么：Action 里没有按键时长（`{t:'play'}` 只在按下时发），CutsceneMode 分不出长按。WP4：已看过（seen(cs id)）且 `skippable !== 'never'` 时按一下空格即跳过——此后计时步骤（wait/say/title/fade/during）立即完成，effects/对话/await 照常执行（进度不会漏写）。需要真长按的话要给 KEYMAP/Action 加 down/up（WP1）。
- 影响：无（walkthrough 不跳过过场）
- 临时绕开：见上
- 状态：wontfix（真长按需要给 Action 加按住时长；M1c 维持“再看时按一下空格即跳过、计时步骤立即完成、effects 照常执行”，ARCH §6.14 相应更正，GDD 的“长按”视为同一交互）

## 8. 密码锁的输入模型（转轮 + 光标）写进 ARCH §6.15
- 类型：文档矛盾
- 现象/需要什么：§6.15 只写了“数字键输入、滚轮拨当前转轮、Enter 确认、Backspace 删除”，而 input.mjs 要求“只用滚轮 + Enter 输入密码”。WP4 的模型：digits 个转轮 + 光标；数字键 = 当前轮设成该数字并右移；滚轮（`wheel`，panel_code 里的 `zoom` 也当滚轮）= 拨当前轮；Enter = 确认当前轮并右移，已在最后一轮（或已输满）时提交；Backspace = 光标左移。`code.entered` = 已确认的前几位。调试 `input('0618')` = 逐位 digit + confirm；真人滚轮 = 每位拨到数字后 Enter，第 4 次 Enter 即提交。错误：failText 反馈、清零、面板保持打开；连错 `failClue.after` 次写线索并 toast“巡夜本上多了一行字”；失败计数按 owner 记在内存，成功清零。
- 影响：WP6 的 CodePanel、WP7 的 input.mjs
- 临时绕开：无
- 状态：resolved（M1c：转轮 + 光标的输入模型写进 ARCH §6.15；UI 的密码面板改为显示 `CodeState.wheels`（原来只显示已确认的前缀，滚轮拨号时看不到数字），`m1c.code_wheels` 覆盖）

## 9. 面板自动接线的优先级：talk → onInteract → 名下面板
- 类型：文档矛盾
- 现象/需要什么：`ctx.codeLock/naming` 是 `PanelSystem.registerCode/registerNaming` 的薄包装，而 GameApi 没有打开面板的方法，所以“自动给 owner 交互物接上 openCode”由 InteractionSystem 做：主动作按 talk（第一个满足的）→ onInteract → owner 名下的密码锁/称呼面板 → “这儿用不上。”的顺序。所以 owner 交互物**不要写 onInteract**；前置用它自己的 `when/blocked`（如 r3.stool“单子还没开呢，坐那儿干啥。”），解开之后的反馈也用 when/blocked（如 `when: '!r1.drawer_open'`）。建议写进 ARCH §6.15、§11.3。
- 影响：R1-world 的 r1.drawer、R3 的 r3.stool
- 临时绕开：无
- 状态：resolved（M1c：面板自动接线的优先级（talk → onInteract → 名下面板）与“owner 不写 onInteract”写进 ARCH §6.6 与 §6.15）

## 10. NpcDef.onPlaced 的语义
- 类型：文档矛盾
- 现象/需要什么：ARCH 只写“站位变化时（可做淡出淡入）”。WP4：NPC 本来在场、新站位不同、且定义了 onPlaced 时，引擎**不瞬移**，只调用 `onPlaced(npc, prevPos)`，由区域 `npc.fadeTo(新站位, yaw)` 把它挪过去（王奶奶换层）；首次摆放、出现/消失、没有 onPlaced 时直接摆到位再通知。建议写进 ARCH §6.7。
- 影响：R2 王奶奶护送
- 临时绕开：无
- 状态：resolved（M1c：写进 ARCH §6.7 `onPlaced` 注释）

## 11. 存档：hold 的清除时机、hold 期间的 E.save、通关后不再写 save.auto
- 类型：文档矛盾
- 现象/需要什么：ARCH 没写成功通关后 `hold('ending')` 由谁释放。WP4：`clearCompleted()`（新游戏、从寅时重来）与 `load()`（读档）都会清掉 hold；hold 期间的 `E.save` 直接丢弃（不在 release 后补写）；`completed` 为真后 flushIfSafe 不再写 save.auto（否则标题又出现“继续”）；`markCompleted` 不受 hold 限制。另：`read()` 失败时把原字符串另存 `<key>.bad`、原键保留（has() 仍为假），存档区域 id 不是 AreaId 时修复为 r1。WP1 的 Game.newGame/continueFrom 请调用 `save.clearCompleted()` / `save.load()`（已在 ARCH），并在新游戏时 `state.reset()` 后调用 `sys.shichen.resetClock()`。
- 影响：GDD §3.13、§11 步骤 58、M3“从寅时重来”
- 临时绕开：无
- 状态：resolved（M1c：hold 的清除时机、hold 期间丢弃 E.save、通关后不写 save.auto、.bad 备份写进 ARCH §6.4；WP1 的 newGame/continueFrom 已调 clearCompleted/load、state.reset、shichen.resetClock（核对 src/core/game.ts））

## 12. activate 的 settle：api 来源用 game.settle()，玩家来源只等 effects.settled()
- 类型：接口需求
- 现象/需要什么：`activate(..., 'api')` 内部 `await game.settle()`（锁步下由 WP1 推进时间直到 settle），所以 WP1 的 `Game.settle` 要能在调试 API 方法里被嵌套调用（WP7 的 interact 之后通常还会再 settle 一次）。玩家来源（E 键、菜单、挑选器）不推进时间，只 `await effects.settled()`。activate 若发现栈顶是指向该对象的 album（menu/pick），会先弹掉它再检查模式。`result.feedback` 在成功时是本次执行期间最后一条 'feedback' 文本（如取件格“空的。”）。
- 影响：WP1 的 Game.settle、WP7 的 interact/show/use
- 临时绕开：无
- 状态：resolved（M1c：写进 ARCH §6.6“settle 与反馈”；WP1 的 Game.settle 可嵌套调用（ARCH §4.4））

## 13. debugSet / restore / reset 不发事件；readDoc 要 back 两次
- 类型：文档矛盾
- 现象/需要什么：`GameState.debugSet/restore/reset` 不发 'flag'/'item'（它们重建状态）：时辰系统在下一帧静默对账（不播时辰过场）；巡夜本新页在没有 'flag'/'temp' 事件时静默记 seen（不 toast）；NPC 站位要调用方 `npc.reevaluate()`（ARCH 已写）；区域 onFlag 不会被触发，所以 regions 预置用 `setState({…, area})` 重进区域。另：从相册点开文档时 mode.journal 压在 album 之上，Esc 先合上文档回到相册，所以 WP7 的 `readDoc` 要 dispatch `back` 两次才回到探索（或 `modes.popToBase()`）。
- 影响：WP7 的 setFlags/setState/readDoc
- 临时绕开：无
- 状态：resolved（M1c：写进 ARCH §6.1；WP7 的 readDoc 已一路 back 回调用前的栈深（核对 src/debug/api.ts），ARCH §12.3 补充行为写明）

## 14. 读字的 'read' 事件用于“被盖住的字”显出
- 类型：接口需求
- 现象/需要什么：`DocDef.covered.readBy` 的判定是 `state.seen(readBy)`；JournalSystem 监听 `'read'` 事件并 `markSeen(e.id)`。请 WP5 的 ReadSystem 在读到时发 `'read' { id }`（ARCH §6.8.6 已写“发 read”）。
- 影响：doc.obituary（rd.obituary_hidden）
- 临时绕开：无
- 状态：resolved（M1c 核对：ReadSystem 读到时发 'read'（src/game/read.ts），JournalSystem 监听并 markSeen；写进 ARCH §6.8.6“读过的持久来源”）

## 15. 提示进度（每题看到第几级）只在内存里，新游戏/读档时没人清
- 类型：接口需求
- 现象/需要什么：GDD §3.13 提示计时不存档。`HintSystem.resetProgress()`（WP4 内部）可清掉；建议 WP1 在 newGame/continueFrom 里调用（或在 ARCH 补一个钩子）。不调用只影响“读档后 H 键从第几级开始”，不影响正确性。
- 影响：无硬影响
- 临时绕开：无
- 状态：resolved（M1c：`HintSystem.resetProgress()` 冻结，`Game.newGame/continueFrom/?area= 开局` 调用；改了 src/core/game.ts，ARCH §4.4/§6.17）

## 16. WP4 的 dev 夹具 id 与自测临时 id
- 类型：接口需求
- 现象/需要什么：沙盒北侧中间（WP4_ORIGIN = (0.5,0,-6.5)，x≈-3…4、z≈-11…-4，都不加碰撞体）的夹具用了这些 GDD id：`r4.rules_board`（when/blocked）、`npc.wang`（对话树 dlg.dev.wp4_tree + offers）、`npc.boy`（阴物）、`r2.stairs`（强制对话 dlg.dev.wp4_forced）、`r1.drawer`（密码锁 0618）、`r3.stool`（称呼面板，正解 name.huoji）、`r3.darkroom_door` + `npc.lu`（玻璃门把手 + 玻璃后 priority 2 的 NPC）。自测临时登记并随即 remove 的 id：`r2.mailboxes`、`r2.donation_board`。M1c 若与别的 WP 的夹具冲突，只改 `WP4_FIX`/`TMP_*`。对话/过场：`dlg.dev.wp4_{line,tree,forced,outer,inner}`、`cs.dev.wp4_{mid,fx,await}`（WP7 的 core.mjs 可以直接用它们测“（先这样）”、强制对话、过场 await 与 wait() 快进）。
- 影响：WP7 的 core.mjs
- 临时绕开：无
- 状态：resolved（M1c：沙盒各 WP 夹具与 m1c 夹具合并后没有 id/位置冲突（mergeAreaParts 的 dev 重复检查通过，core.mjs 全部页面内自测通过），不需要搬家）

## Lessons
- 锁步下 `Game.advance()` 每 30 步才让出一次宏任务（ARCH §3.4），promise 续延在两次让出之间不执行：用 async/await 串起来的“wait 之后再做 X”会被量化成 1 秒。WP4 的 EffectRunner/过场步骤机因此用续延（CPS）：wait 在 `pump(dt)` 到点、计时步骤在 `update(dt)` 到点后**同步**接着执行；只有区域写的 async Handler 走 promise。
- node 里跑 src 下的 TS 单测：`createServer({ root, configFile:false, appType:'custom', server:{ middlewareMode:true, hmr:false, ws:false }, optimizeDeps:{ noDiscovery:true, include:[] } }).ssrLoadModule('/src/…ts')`（vite 8 可用）；`three` 被外部化成与脚本里同一个实例；`import.meta.env.DEV` 为真，devAssert 生效。
- 对话的“终止选项”effects 要在弹出 mode.dialogue 之后执行，否则选项里压的模式（tripod.enter）会压在对话之上，对话再也弹不掉自己（`pop(expect)` 要求栈顶匹配）。
- 准星聚焦的射线：three 的 Raycaster 不看 `visible`，用 `traverseVisible` 收集网格并对命中查祖先链；玻璃的 `noOcclude` 可能在材质 `userData` 上（`MATERIALS.glass()`），对象与材质两处都要看。
- TS `target: ES2022`（useDefineForClassFields）下，类字段初始化器先于构造函数参数属性赋值执行：字段初始化器里不能解引用 `constructor(private readonly game)` 的参数（箭头函数延迟读取可以）。
