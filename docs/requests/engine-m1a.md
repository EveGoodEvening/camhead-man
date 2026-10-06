# engine-m1a：M1a 变更记录

> 写入者：M1a 骨架代理（M1b 期间冻结；M1c 起由整合代理逐条复核并在“状态”行写结论，ARCH §2.12、§15.3）。
> 下面每一条都已经改了代码并**同步写进 ARCH**（ARCH 里标“M1a 补写”或“M1a：”的注释处）。M1a 结束时宣布**签名冻结**：此后公开签名只能由整合代理修改，改了必须同步改 ARCH。

## 条目格式（ARCH §15.6）

```md
## <编号>. <一句话标题>
- 类型：接口需求 | 引擎缺陷 | 缺 id | 文档矛盾
- 现象/需要什么：……
- 影响：……
- 临时绕开：……（没有就写“无”）
- 状态：open            ← 整合者处理后改为 resolved（改了哪些文件）/ wontfix（理由）
```

## M1a 变更记录

### A. 偏离 ARCH 原签名（TS 类型检查或契约缺口逼出来的，已同步改 ARCH）

## 1. Handler / E.call / Effect call / CutStep run 的函数返回类型改为 `Awaitable<unknown>`
- 类型：文档矛盾
- 现象/需要什么：ARCH 原写 `(g: GameApi) => Awaitable`（= `void | Promise<void>`），但 ARCH 自己的例子 `E.call(g => g.tripod.enter())`、§15.1 的 `onInteract: g => g.cctv.open()` 返回 `ApiResult`，TS 不接受（非 `void` 返回值不能赋给 `void | Promise<void>` 联合）。改为 `Awaitable<unknown>`：运行器 await 后丢弃返回值。
- 影响：ARCH §6.3（Effect、E.call、Handler）、§6.14（CutStep run）；`src/game/effects.ts`、`src/game/cutscene.ts`
- 临时绕开：无
- 状态：resolved（M1a 改代码与 ARCH；M1c 复核：tsc 通过，effects/cutscene 的 Handler/CutStep 运行器 await 后丢弃返回值）

## 2. `DialogueId` / `CutsceneId` / `PhotoDecoyDef.key` / `ShotDef.id` 的区域段改为 `AreaKey`，`defineDialogues(area: AreaKey, …)`
- 类型：文档矛盾
- 现象/需要什么：原为 `AreaId`，不含 `dev`；但 dev 沙盒的夹具需要 `dlg.dev.*`（带选项的对话、强制对话）、`cs.dev.*`，§15.3 的 look-dev 机位就叫 `shot.dev.lookdev_tp`。
- 影响：ARCH §4.2、§6.8.3、§6.13、§12.5；`src/data/ids.ts`、`src/game/photo.ts`、`src/game/dialogue.ts`、`src/debug/shots.ts`
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核：dev 的 dlg.dev.*、cs.dev.*、shot.dev.* 在 check.mjs 与 core.mjs 下正常）

## 3. `ModeHandler.move` 可以是按栈求值的函数
- 类型：文档矛盾
- 现象/需要什么：附录 A 要求 viewfinder 叠在面板上时不能移动，但 `move` 原为静态值（`look`/`pointer` 已经允许按栈求值）。改为 `ModeMove | ((stack) => ModeMove)`；另导出别名 `ModeCamera`、`ModeMove`。
- 影响：ARCH §4.6；`src/core/modes.ts`、`src/game/modes/viewfinder.ts`
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核：ViewfinderMode 的 move/look/pointer 按栈求值，面板叠加时 move 'none'）

## 4. `ViewfinderSystem.frameAspect` 的类型改为 `number`
- 类型：文档矛盾
- 现象/需要什么：ARCH 写 `readonly frameAspect: 4 / 3;`，`4 / 3` 不是合法的 TS 类型。改为 `number`，值恒为 4/3。
- 影响：ARCH §6.8.1；`src/game/viewfinder.ts`
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核通过）

## 5. `JournalSystem.registerDocs/registerPages` 接受只读数组
- 类型：文档矛盾
- 现象/需要什么：`AreaDef.docs/journalPages` 是 `readonly` 数组，AreaManager 汇总后传给 `registerDocs(docs: DocDef[])` 过不了类型检查。改为 `readonly DocDef[]` / `readonly JournalPageDef[]`（只放宽）。
- 影响：ARCH §6.16；`src/game/journal.ts`
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核通过）

## 6. dev 沙盒的出生点/出入口 id 与 `dev/base.ts` 的形状
- 类型：接口需求
- 现象/需要什么：沙盒需要出生点与“一个通往 r1 的出入口”，而 `SpawnId`/`ExitId` 只含 GDD id、不许自造。新增 `DEV_SPAWN = { START: 'spawn.dev_start', LOOKDEV: 'spawn.dev_lookdev' }`、`DEV_EXIT = { TO_R1: 'exit.dev_to_r1' }`、`DEV_IDS`；`SpawnId`/`ExitId` 包含它们；它们**不在** `ALL_IDS` 里（ALL_IDS 与 GDD §13 严格相等），`check.mjs` 须接受 `ALL_IDS ∪ DEV_IDS`。另：`mergeAreaParts` 的 base 必须带 spawns/exits/post，而 `AreaPart` 不能带，所以 `dev/base.ts` 导出 `DEV_BASE: AreaBase`（新增类型 `AreaBase`），不是 `AreaPart`；`dev/wpN.ts` 仍是空 `AreaPart`。
- 影响：ARCH §2.12 表、§4.2、§11.2、§15.1；`src/data/ids.ts`、`src/core/area.ts`、`src/areas/dev/*`
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核：check.mjs 接受 ALL_IDS ∪ DEV_IDS，dev 出入口 exit.dev_to_r1 在 core.mjs 的区域互通用例里走通）

## 7. `POST_PRESETS` 的类型加 `Readonly<…>`
- 类型：文档矛盾
- 现象/需要什么：共享常量表不应被改写；类型由 `Record<…>` 收紧为 `Readonly<Record<…>>`。读取方不受影响。
- 影响：ARCH §8.2；`src/fx/presets.ts`
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核通过）

## 8. `EffectRunner.pump` 带 `dt`
- 类型：文档矛盾
- 现象/需要什么：§3.2 第 8 步写 `effects.pump()`，但 `wait` 按游戏时间计时，需要 dt。签名为 `pump(dt: number): void`。
- 影响：ARCH §6.3；`src/game/effects.ts`（§3.2 第 8 步的写法由评审修补 #21 同步）
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核：Game.step 第 8 步 effects.pump(dt)）

### B. 为跨 WP 调用补写的签名（ARCH 没写，已同步进 ARCH 对应章节）

## 9. 装配约定与各构造函数签名
- 类型：接口需求
- 现象/需要什么：WP1 的 `Game` 要构造其他 WP 的全部系统、模式处理器、UI、音频、后期。约定：系统/模式/UI 视图一律 `constructor(game: Game)`，构造函数里不得访问其他系统；只有 `core/game.ts` 与 `main.ts` 在运行时 import 系统类；构造顺序与例外（`createRenderer`、`new RenderPipeline(…)`、`new PostPipeline(renderer, scene, camera)`、`new AreaManager(game, AREAS)`、`new AreaContextImpl(game, def, root)`、`new AudioEngine({ muted })`、`new UI(host, game)`、`createGameApi(game, scope?)`、`loadSettings()`、`createPlayerModel()`、`mountDebugApi(game)`）见表；13 个模式处理器类名 `ExploreMode`…`PauseMode`。新增 `GameSystems` 接口、`Game.ending` 字段（运行期结局，GameApi.endingDone 写、DebugState.ending 读）。
- 影响：ARCH §4.4（装配约定与表）；`src/core/game.ts`、`src/main.ts`、`src/game/modes/*.ts`
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核：src/core/game.ts 的构造顺序与装配表一致；M1c 在 newGame/continueFrom/?area= 开局加了 hints.resetProgress 与 viewfinder.resetOptics，写进 ARCH §4.4）

## 10. core：`ModeStack` / `InputManager` / `RenderPipeline` / `AreaManager` / `AreaContextImpl` / `GameTimers` / `Disposer` 的补充成员
- 类型：接口需求
- 现象/需要什么：`ModeStack.register/handler/moveMode/lookEnabled/update`；`InputManager.beginFrame/dispose`；`KeyBinding` 别名；`createRenderer()`、`RenderPipeline.post`（GameApi.post 与取景器叠加经由它）、`setDynamicResolution()`；`AreaManager` 构造函数与 `EnterReason`；`AreaContextImpl` 的引擎侧成员 `colliderRoot/timers/levelsHandle/lightCount/tempSnapshot()/refs()/updateViews()/finalize()/dispose()`（WP4 的 setLevel、WP7 的 DebugState.floor/temp 要用）；`AreaAddOptions`、`AreaPost`、`AreaEnvironment` 别名；`GameTimers`、`Disposer`。
- 影响：ARCH §4.5、§4.6、§4.7.2、§11.2；`src/core/*`
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核：tsc 通过；RenderPipeline.stats() 另加 callsMain/trisMain，见 engine-wp1.md #2）

## 11. game（WP4）：`GameState` 列表读取、`createGameApi`、存档与设置
- 类型：接口需求
- 现象/需要什么：相册/物品栏/巡夜本/DebugState 需要列表：`GameState.listItems/listPhotos/listClues/listFlags`、新游戏 `reset()`；`createGameApi(game, scope?)`；`SaveSystem.load(slot)`（Game.continueFrom 用）、`clearCompleted()`（新游戏/从寅时重来清通关标记）、`SAVE_KEYS`、`SaveSlotName`；`DEFAULT_SETTINGS`、`SETTING_IDS`（字段 ↔ settings.* 映射表）、`loadSettings()`、`applySetting(game, key, value)`（设置菜单用）；`ShichenSystem.resetClock()`；`InteractionSystem.interactFocused(source)`（E 键流程入口，explore/viewfinder/replay 的 interact 动作共用）；`Dyn` 导出；`ActivateRequest`/`ActivateResult`、`HintResult` 别名；`JournalSystem.doc(id)`、`JournalArg`；`PanelSystem.clearArea()`。
- 影响：ARCH §6.1、§6.3、§6.4、§6.5、§6.6、§6.15、§6.16；`src/game/*`
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核通过；InteractionSystem/PanelSystem 的状态类型另有 M1c 冻结的字段，见 engine-wp4.md #2）

## 12. game（WP5）：清理与查询方法
- 类型：接口需求
- 现象/需要什么：`ViewfinderSystem.setOn/update`；`PhotoSystem.target(id)`、`ShootResult`；`ReadSystem.get/aimPoint`（调试 API 瞄准点解析）；`ReplaySystem.exit(reason)`（WP1 的传送/levels.set/resetTo 调用）、`point(id)`；`VcrSystem/ConsoleSystem/MirrorSystem/TripodSystem.clearArea()`（AreaManager 卸载时调用）；`ConsoleSystem.validate()`（build 结束校验字段齐全）、`update()`；`CrtScreenController.update/detach`。评审修补追加 `PhotoSystem.decoy(key)`（#25）。
- 影响：ARCH §6.8.1、§6.8.4、§6.8.6、§6.9–§6.12；`src/game/*`
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核通过；另冻结 TripodSystem.osdText()，见 engine-wp5.md #7）

## 13. ui（WP6）：`UI` 构造与每帧更新、菜单与淡入层 API、视图类名
- 类型：接口需求
- 现象/需要什么：`UI` 的 `constructor(host, game)`、`update(dt)`（§3.2 第 10 步）、`currentSubtitle()`（DebugState.subtitle）；`ToastKind`；`Menus.showTitle/showPause/select(item)`（§3.1 的 `menus.select('new')`）与 `MenuItem`；`FadeLayer.black/title/setLoading`（时辰过场字样、过场 title 步骤）；17 个视图类名与文件（`HudView`…`PointerGate`），视图从系统状态拉数据；`showBootError` 已有最小实现。
- 影响：ARCH §7；`src/ui/*`
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核通过；另冻结 UI.isUiEventTarget()，见 engine-wp6.md #12）

## 14. fx/audio（WP3）：后期与音频的补充成员
- 类型：接口需求
- 现象/需要什么：`PostPipeline` 构造函数、`ir: IrRenderer`（红外替换在 PostPipeline 里包住 RenderPass）、`setQuality(q)`、`applySettings({ grain, reduceFlash })`；`FX_DEFAULTS`；`isSharedMaterial(m)`（Disposer 跳过共享材质）、`MaterialLibrary`；`resetEnvironmentCache()`；`CrtScreenMaterial` 别名（初版漏写进 §8.4，评审修补 #37 补上）；`AudioEngine` 构造函数 `({ muted })`、`setVolume(v)`、`AudioBuses`；§9 的类型都从 `audio/engine.ts` 导出。
- 影响：ARCH §8.1–§8.3、§9；`src/fx/*`、`src/audio/*`
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核通过；另冻结 PostPipeline.sceneStats、SfxCue 'crt_on'，见 engine-wp1.md #2、engine-wp3.md #10）

## 15. rigs/kit（WP2）：`CableRig`、`createBlobShadow`、`seedFromString`
- 类型：接口需求
- 现象/需要什么：`CameraHead.cable: CableRig` 的类型 ARCH 没写：`{ group; plug; update(dt) }`；`createBlobShadow(radius?, opacity?)`（角色与道具假阴影）；`HumanoidMaterialMode` 别名；`kit/rng.ts` 的 `seedFromString(s)`（ctx.rng 以区域 id 为种子）、`range()`；`PaintKit`、`PropKit` 接口名。`POSES`、`ACCESSORIES`、`createCameraHead` 声明为 WP2 内部。
- 影响：ARCH §5.2、§10.2；`src/rigs/*`、`src/kit/*`
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核通过）

## 16. debug（WP7）：`DebugApi` 完整类型、`mountDebugApi`、自测登记
- 类型：接口需求
- 现象/需要什么：ARCH 只有方法表没有类型。补写 `DebugApi`（含全部别名；★ 方法为可选成员）、`DebugResult`、`InteractOutcome`、`AimOutcome`、`PerfStats`、`HintOutcome`、`GotoOutcome`、`DebugStatePatch`；`mountDebugApi(game)`（main.ts 在 boot 后调用）；`DebugApi.selftest/selftests`（§2.10 说了 `__game.selftest(name)` 但方法表没列）；`debug/selftest.ts` 的 `registerSelftest/listSelftests/runSelftest`、`SelftestResult`（已实现）。
- 影响：ARCH §12.1、§12.3；`src/debug/*`
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核：core.mjs 检查全部方法与别名都挂在 window.__game/__cam 上，selftest/selftests 可用）

## 17. data：`src/data/*` 的完整导出
- 类型：接口需求
- 现象/需要什么：ARCH §2.3 只写了内容不写形状。补写 `ids.ts` 的 `AREA/PC/STALL/RIG/MODE/LAYER_ID/MAT/SAVE/SETTING/ANT_FLAGS/HOLE_IDS/emptyPhotoId/isEmptyPhotoId/isKnownId` 与 `DEV_*`；`palette/items/photos/names/speakers/time/render/strings` 的全部导出（ARCH 新增 §4.2.1）。`ItemMeta` 用 `doc` + `extraDocs`（it.log 同时带 doc.log_old 与 doc.log_new）；`data/time.ts` 提供录像带秒换算 `tapeSec/tapeClock/tapeDate` 与全部钟点常量；`data/render.ts` 另有 `TEMP_C`（GDD §3.3 温度）、`RENDER_ORDER`、`RT_SIZE`、`LOOK`；`data/strings.ts` 的键名冻结。
- 影响：ARCH §4.2、§4.2.1；`src/data/*`
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核：check.mjs 全树 0 违规）

## 18. 源码约定：owner 注释、DEV_CHECKS、M1a 已实现的函数、类型所在文件
- 类型：接口需求
- 现象/需要什么：新增 ARCH §2.13：每个文件第一行恰好 `// owner: <TOKEN>`（`integrator` = M1a 写全量的冻结文件）；“dev 下”= `DEV_CHECKS`（vite dev 或 `?debug=1`/`?test=1`，因为测试对生产构建跑）；M1a 已真实实现、M1b 可直接依赖的函数清单；`core/math.ts`、`core/url.ts` 的签名；本文代码块未写文件名的类型所在文件；WP 内部模块清单（不属于冻结签名）。另补 `core/types.ts` 的 `FailReason`、`QualityLevel`、`AREA_IDS`、`MODE_IDS`、`fail()`、`ok()`；`EventBus.listenerCount/clear`。
- 影响：ARCH §2.13、§4.1、§4.3
- 临时绕开：无
- 状态：resolved（M1a；M1c 复核：check.mjs 的 owner-header 规则全树通过；新文件 src/areas/dev/m1c.ts、src/ui/photoToast.ts 用 `// owner: integrator`）

### C. 给后续阶段的提醒（不是签名变更）

## 19. R1 `layout.ts` 里的推定坐标
- 类型：接口需求
- 现象/需要什么：GDD 没给 CRT/录像机在桌上的具体位置、面板视点、CH1/CH2 机位注视点、门灯与钠灯高度；M1a 按 GDD 描述推定，放在 `R1.derived`（CRT 屏幕中心 (-6.8,0.98,21.375) 朝北、0.36×0.27；面板视点距屏幕 0.5m；CH1 机位 (-4.85,2.75,20.2) 看向 (-2.9,0.9,21.9)，粉笔叉与老周站位都在画内）。`layout.ts` 冻结，R1 两位代理要改须提 requests。
- 影响：`src/areas/r1/layout.ts`
- 临时绕开：无
- 状态：resolved（M1c：面板视点在 R1 占位区域实测——走到 CRT 前按 E 打开监控台，CRT 居中、屏幕在面板控件之上完整可见（test-artifacts/playtest/A1_r1_console.png），推定坐标可用；CH1 构图要等 R1-finale 放上粉笔叉与老周（M2），由 M1c look-dev 步骤与 R1-finale 的 shot.r1.* 截图复核，不在本次整合范围）

## 20. 出入口 `blocked` 占位文本
- 类型：文档矛盾
- 现象/需要什么：GDD 没给“出入口条件不满足”的专属文本。M1a 用了 GDD 里最接近的原句：R1 东/西口用 P2“铁链上挂着把大锁。钥匙……老周说在抽屉里。”，R2 的 502 门用 §8.3 尉迟恭“站住！门里阳宅，门外阴客。”。这两处只有 goto 寻路（或穿过物理门槛）时才会出现。
- 影响：`src/areas/r1/index.ts`（冻结）、`src/areas/r2/text.ts`（R2 可改）
- 临时绕开：无
- 状态：wontfix（M1c 不改：GDD 没有“出入口条件不满足”的专属文本，沿用最接近的原句；留给 M3 统一校对文本时复核）

### D. M1a 评审修补（仍属 M1a；代码与 ARCH 已同步改）

## 21. §3.2 帧循环写全每帧方法的调用方
- 类型：文档矛盾
- 现象/需要什么：第 6 步写的是 `read`（ReadSystem 没有 `update`），没有 `crt`、`journal`；`AreaContextImpl.updateViews()`、`PlayerModel.update(dt, p, mode)` 全文没写谁调；第 8 步仍是 `effects.pump()`。改为：第 6 步 `npc → interaction → viewfinder → read.evaluate()（每帧调用；取景器未开启时只清空 reading/hint）→ replay → vcr → cctv → crt → tripod → cutscene → dialogue → journal.update() → hints → shichen`；第 7 步 `area.update?(ctx, dt); ctx.updateViews(); ctx.timers.update(dt)`；第 8 步 `effects.pump(dt)`；第 9 步 `game.time += dt; playerModel.update(dt, player, modes.top); cameras.update(dt)`。另写明：以上调用全由 WP1 的 `Game.step` 发出，系统不得自己订阅 `'frame'`；`MirrorSystem`/`PanelSystem` 没有每帧方法。（评审的 read.evaluate“仅取景器开启时”调用会让离开取景器后 `reading` 残留，所以改为每帧调用、由 evaluate 自己在取景器关闭时清空。）
- 影响：ARCH §3.2、§5.2、§6.8.6（evaluate 注释）、§6.11、§6.16；`src/game/crt.ts` `viewfinder.ts` `read.ts` `journal.ts` `cctv.ts`、`src/rigs/player.ts` 注释（删掉“WP5 内部”）
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核：src/core/game.ts 的 step 顺序与 §3.2 一致）

## 22. §4.5 第 3 步的卸载清单写全
- 类型：文档矛盾
- 现象/需要什么：原清单只有 interaction/npc/photo/read/replay/triggers 的 `clearArea()`，缺 `panels.clearArea()` 与 `crt.detach()`，vcr/cctv/mirror/tripod 只写了“配置清除”。改为完整清单：`replay/interaction/npc/photo/read/panels/vcr/cctv.clearArea()` → `crt.detach()` → `mirror/tripod.clearArea()` → `triggers.clearArea()`，由 WP1 的 `AreaContextImpl.dispose()` 调用；各方法在本区从未登记/配置/挂接时是空操作。
- 影响：ARCH §4.5、§6.11、§6.12、§6.15、§11.2（dispose 注释）；`src/core/areaContext.ts`、`src/game/{panels,mirror,tripod,vcr,cctv,crt}.ts` 注释
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核：AreaContextImpl.dispose() 的清单与顺序与 §4.5 一致，单步失败不影响其余）

## 23. `AreaManager.current` 在 enter 期间的切换时机
- 类型：文档矛盾
- 现象/需要什么：`ctx.npc()` → `NpcSystem.add(d)`、`InteractionSystem.register(def, area)` 只转交、不带 ctx，系统只能经 `game.areas.current` 取本区 root/ref，但 ARCH 没写 `current` 何时指向新区。写明：第 3 步卸载期间仍指向旧区，`ctx.dispose()` 返回后置 null；第 4 步新建 root 与 `AreaContextImpl` 后**立即**设为新的 `LoadedArea`，再做静态登记与 `await def.build(ctx)`。签名不变。
- 影响：ARCH §4.5（`current` 注释与第 3、4 步）、§6.6 `register` 注释、§6.7 `add` 注释；`src/core/area.ts`、`src/game/npc.ts`、`src/game/interaction.ts` 注释
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核：core.mjs 的区域往返与五区互通用例通过）

## 24. 新增 `InteractionSystem.pendingTalks(): readonly InteractId[]`
- 类型：接口需求
- 现象/需要什么：§11.2 要求 WP1 的 `finalize()` 校验 addTalk 排队，但排队数据在 WP4，冻结签名没有查询方法。新增 `pendingTalks()`：返回已排队但目标仍未登记的 id（dev 与生产都照实返回、自身不抛错）；`finalize()` 调用它，dev 下非空即抛错（信息列出 id）。`finalize()` 同时负责 `cctv.validate()` 与出生点距离断言。
- 影响：ARCH §4.5 第 4 步、§6.6、§11.2；`src/game/interaction.ts`（WP4 占位 +1）、`src/core/areaContext.ts` 注释
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核通过）

## 25. 新增 `PhotoSystem.decoy(key: PhotoDecoyDef['key']): PhotoDecoyDef | undefined`
- 类型：接口需求
- 现象/需要什么：§12.3 的瞄准点解析要求 `decoy.*` 同 pt，但 `ctx.photoDecoy()` 登记的诱饵只在 PhotoSystem 内部，WP7 的 `resolveAimPoint` 按冻结签名拿不到。新增 `decoy(key)`（本区诱饵，含静态与 build 中登记的）。§12.3 的解析顺序同时写明各段用哪个查询方法（`photo.target`、`read.aimPoint`、`replay.point`、`photo.decoy`）。
- 影响：ARCH §6.8.4、§12.3；`src/game/photo.ts`（WP5 占位 +1）
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核：wp7.aim_resolution 页面内自测通过）

## 26. `NoWebGL2Error` 与启动流程里 renderer 的创建位置
- 类型：文档矛盾
- 现象/需要什么：§4.4 规定 renderer/pipeline/cameras/UI/audio/playerModel 在 `Game` 构造函数里建，§3.1 仍写成 `boot()` 第 2、4 步建，且“`caps.webgl2 === false` → WebGL2 错误页”走不到（`createRenderer` 失败时在 `new Game()` 里就抛错；main.ts 里 `isWebGL2 !== true` 分支不可达）。新增 `core/render.ts` 导出 `class NoWebGL2Error extends Error`，`createRenderer` 在 WebGL2 不可用时抛它；`Game` 构造函数在 `createRenderer` 成功后写 `caps.webgl2 = true`、`caps.maxAnisotropy = renderer.capabilities.getMaxAnisotropy()`；main.ts 的 catch 按 `instanceof NoWebGL2Error` 选 `'no_webgl2'`/`'exception'`。
- 影响：ARCH §2.13（类型所在文件）、§3.1、§4.4（构造顺序与装配表）、§4.7.2；`src/core/render.ts`、`src/core/game.ts`、`src/main.ts`
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核：smoke.mjs 与 wp6.boot_error 通过）

## 27. main.ts 动态导入 `core/game` 与 `debug/api`
- 类型：引擎缺陷
- 现象/需要什么：区域模块在 import 时执行 `defineArea`/`mergeAreaParts`/`defineDialogues` 的 dev 断言；main.ts 静态导入时这类异常发生在模块图求值阶段、早于 `main()` 的 try/catch，页面空白、只有 pageerror。改为在 try 内 `await import('./core/game')`、`await import('./debug/api')`；main.ts 只静态导入 `ui/bootError.ts` 与 `core/render.ts`（后者运行时只依赖 three 与 core/log）。“只有 core/game.ts 与 main.ts 运行时 import 系统类”（#9）相应改为“只有 core/game.ts”。
- 影响：ARCH §3.1、§4.4；`src/main.ts`、`src/core/game.ts` 注释。构建产物多出 `game-*.js`、`api-*.js` 两个 chunk；`scripts/smoke.mjs` 仍得到启动失败页、无 pageerror
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核：smoke 通过，构建产物含 game-*.js、api-*.js）

## 28. `?quality=` 覆盖由 Game 构造函数只在内存里做
- 类型：文档矛盾
- 现象/需要什么：只有 settings.ts 注释提过“?quality= 覆盖由 Game 处理”，ARCH 没写。§4.4 构造顺序写明 `this.settings = loadSettings(); if (this.url.quality) this.settings.quality = this.url.quality;`（不落盘、不发 `'settings'`，WP1 做）；§6.4 注明 `loadSettings` 不读 URL。M1a 已在 `Game` 构造函数里写上这一行。
- 影响：ARCH §3.1 第 1 步、§4.4、§6.4；`src/core/game.ts`、`src/game/settings.ts` 注释
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核通过）

## 29. §14.2 的 id 字面量检查接受 `ALL_IDS ∪ DEV_IDS`，`ids.ts` 自身豁免
- 类型：文档矛盾
- 现象/需要什么：#6 规定 check.mjs 接受 `ALL_IDS ∪ DEV_IDS`，但 WP7 的依据 §14.2 仍写“必须在 ALL_IDS 中”，照此实现会把 `spawn.dev_start`/`spawn.dev_lookdev`/`exit.dev_to_r1` 判为未登记。
- 影响：ARCH §14.2
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核：check.mjs 实现与 §14.2 一致；M1c 另写明 check-allow 豁免规则，见 engine-wp7.md #2）

## 30. `isRenderableBy` 只统计可渲染节点（M1a 已实现函数的缺陷）
- 类型：引擎缺陷
- 现象/需要什么：原实现对所有节点（Group/Object3D/灯）做 `layers.test`；新建 Group 默认在 world 层，所以“根节点在 world、网格只在 yin 层”的主体会被 fp 相机判为可渲染，拍照 `hidden` 判定出错。改为只统计 `isMesh/isLine/isPoints/isSprite` 节点（与 three r186 `projectObject` 逐节点测图层、照样递归子节点的行为一致）。
- 影响：ARCH §4.7；`src/core/layers.ts`
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核：wp1.layers_skip_lights 等页面内自测通过）

## 31. `reflectPoint` / `segmentPlaneIntersect` 就地调用安全（M1a 已实现函数的缺陷）
- 类型：引擎缺陷
- 现象/需要什么：`reflectPoint(v, C, n, v)` 时第一行 `target.copy(p).sub(planePoint)` 先改掉了 p，结果少加回一个 C。改为先求有符号距离、最后一次 `target.set(...)` 写入；`segmentPlaneIntersect` 改用 `lerpVectors`（`target` 为 b 时原写法同样出错）。§2.13 注明带 `target` 的函数允许与输入同一向量。
- 影响：ARCH §2.13；`src/core/math.ts`
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核：镜中读字用例（aimAt 的镜中读字、wp5.mirror）通过）

## 32. hdText/viewVariant 的每帧切换归 WP1 的 `AreaContextImpl.updateViews()`
- 类型：文档矛盾
- 现象/需要什么：§11.2 已把切换定给 WP1，但 §2.4、§6.8.1、附录 B 与 `game/viewfinder.ts` 注释仍写成 ViewfinderSystem 负责。统一为：`updateViews()` 在 §3.2 第 7 步按 `game.sys.viewfinder` 的 on/lens/zoom 与距离切换，ViewfinderSystem 不做。
- 影响：ARCH §2.4、§6.8.1、§11.2、附录 B；`src/game/viewfinder.ts`、`src/core/areaContext.ts` 注释
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核：updateViews 只换 map，见 engine-wp2.md #2；wp2.huang_pixels 通过）

## 33. `DocReader.show` 的参数类型与 ARCH §7 一致
- 类型：文档矛盾
- 现象/需要什么：代码是 `show(_arg?: unknown)`，ARCH 是 `show(arg: { doc: DocId; vf: boolean })`。代码改为后者（方法参数双变检查，仍满足 `implements View`）。
- 影响：`src/ui/docReader.ts`
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核通过）

## 34. §6.8.4 第 6 步 `emptyCaption` 的调用形式
- 类型：文档矛盾
- 现象/需要什么：原写“区域 emptyCaption(ctx)”，与 `AreaDef.emptyCaption(s, near)` 不符，`near` 未定义。改为 `emptyCaption(state, near)`，`near` = 快门时 `interaction.focused`（没有则 null）；再退到 `EMPTY_CAPTIONS[fail]`（无候选时 fail = 'nothing'）。
- 影响：ARCH §6.8.4
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核通过；§6.8.4 第 6 步另写明 onScreen 分层，见 engine-wp5.md #1）

## 35. `ConsoleSystem.validate()` 在本区未 configure 时返回 `[]`
- 类型：文档矛盾
- 现象/需要什么：契约没说没有监控台的区域 validate 返回什么；测试都带 `?test=1`（DEV_CHECKS 为真），照字面“列出缺失必填字段”会让 r2/r3/r4/r2_502/dev 一加载就抛错。写明：本区从未调用过 configure 时返回 []，只有调用过的区域要求 screen/viewPose/channels/tunnelBaked 齐全；调用方是 `AreaContextImpl.finalize()`。
- 影响：ARCH §4.5 第 4 步、§6.11；`src/game/cctv.ts` 注释
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核：dev/r2/r3/r4 进区域时 finalize 不因 validate 抛错）

## 36. `CrtScreenController.attach` 换上私有材质；`MATERIALS.crtScreen()` 只作静态外观
- 类型：文档矛盾
- 现象/需要什么：`MATERIALS.crtScreen()` 是共享缓存实例（R1 占位屏幕与 tapeScene 里 2023 年的 CRT 都可能用它）；若控制器直接改它的 uniforms，所有 CRT 都显示同一路画面，tapeScene 里的 CRT 采样 tape RT 还会形成 GL feedback loop。写明：attach 把 `screen.material` 换成控制器私有的 `createCrtScreenMaterial()` 实例（即 `this.material`），detach 时还原（未挂接时空操作）；由 WP5 在 cctv/vcr 的 configure 收到 screen 时调用；`MATERIALS.crtScreen()` 只作未通电/装饰 CRT 的静态外观、不接 feed。
- 影响：ARCH §6.11、§8.3、§8.4；`src/game/crt.ts`、`src/fx/materials.ts` 注释
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核：wp3.crt_material、wp5.console 通过，CRT 屏幕挂接私有材质）

## 37. `CrtScreenMaterial` 别名写进 ARCH §8.4
- 类型：文档矛盾
- 现象/需要什么：#14 说已同步，但 §8.4 的代码块里没有，按 §15 通用规则不算冻结签名。§8.4 补上 `export type CrtScreenMaterial = …`，`createCrtScreenMaterial(): CrtScreenMaterial`（每次调用新建实例）；§2.13 类型所在文件表同步。
- 影响：ARCH §2.13、§8.4
- 临时绕开：无
- 状态：resolved（评审修补；M1c 复核通过；§8.4 另冻结 createCrtScreenMaterial 的 powered 参数与 CRT_TEMP_C）
