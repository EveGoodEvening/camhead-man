# engine-wp5：WP5 的接口需求与缺陷（M1b）

> 唯一写入者：WP5（只**追加**，不改别人的条目；ARCH §2.12、§15.2、§15.6）。M1c 起由整合代理逐条处理，并把“状态”行改为结论。
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

<!-- WP5 的条目从这里往下追加，编号从 1 开始。 -->

## 1. 拍照失败标题的挑选加了“在画面里”这一层（细化 ARCH §6.8.4 第 6 步）
- 类型：文档矛盾
- 现象/需要什么：ARCH 原文“标题取通过项数最多的候选的 captions[fail]”。检查顺序是 情境 → when → 镜头/倍率 → 主体，所以一个完全在画外的目标（倍率、镜头都对）比一个正对着但倍率不够的目标“通过项数”还多；对着天空按快门会拿到某个画外目标的“太小了，看不清”。WP5 的实现：失败候选先按 onScreen（至少一个主体的锚点投影落在整个画面 |ndc| ≤ 1 内；被 hideWorld 隐去、只在别的图层的主体也按位置算）降序，再按通过项数、priority、登记顺序；**没有任何目标在画面里时 fail 记为 `nothing`**（不取画外目标的专属标题，直接走区域 `emptyCaption(state, near)` → `EMPTY_CAPTIONS.nothing`）。诱饵只在命中时出标题，不参与失败标题的挑选。另：回放人影不在当前片段时解析不到，算“不在画面里”——所以 `wrong_segment` 的专属标题只有在目标至少有一个现世主体（如 `r2.menshen`）正对着时才会出现（`pt.menshen_2018` 满足）。
- 影响：GDD §11 各谜题的空镜标题断言（P4 步骤 21 的“门上还是光的。”、P12 的暂停时刻表、P13 的 CH{n}、H 旧照）都在“主体在画面里”的前提下，行为与原文一致；只改变“什么都没对准”时的标题。
- 临时绕开：无（已实现；`PhotoSystem.lastJudgement` 记录每个候选的 fail/score/onScreen，便于调试）
- 状态：resolved（M1c：onScreen 分层与“没有目标在画面里记为 nothing”写进 ARCH §6.8.4 第 6 步）

## 2. 面板视点借 `ch1` 角色的图层掩码
- 类型：接口需求
- 现象/需要什么：`panel_vcr`/`panel_console` 的相机是肉眼看屏幕（只该有 world 层），而且面板视点离 CRT 约 0.5m、正好在玩家头的位置附近，`fixed` 角色的掩码含 `self_head` 会把自己的摄像头脑袋拍进来。`CameraRig.setFixedPose` 只有 `'fixed' | 'ch1' | 'tripod'` 三种角色，WP5 的两个面板模式用 `{ role: 'ch1' }`（= world，不含 self_head）。语义上是“面板”而不是“CH1 机位”，若将来 ch1 角色另加东西（例如 barrel 后期）会误伤面板。
- 影响：无（当前行为正确）
- 临时绕开：面板模式 enter 时 `setFixedPose(viewPose, 0.3, { role: 'ch1' })`
- 状态：resolved（M1c 决定不加 CamRole：面板借 ch1 角色的理由与注意事项写进 ARCH §4.7“面板视点”）

## 3. 录像机与三脚架的几处语义取舍（ARCH 未写明，WP5 的实现）
- 类型：文档矛盾
- 现象/需要什么：
  - `VcrSystem.loaded` = 已 `configure` 且（本次 `insert()` 过 或 `r1.tape_in_vcr`）。`insert()` **不写** `r1.tape_in_vcr`（进度 flag 由 R1 在 `use(r1.vcr, it.tape_830)` 的 handler 里先写，再 `g.vcr.insert()`）。没装带时 `open()` 返回 `blocked`，没配置时 `no_such_target`。
  - 快进进入降速区 = 转成 1× 播放并闪 SLOW（shuttle 归 0）；在降速区里再按 C 仍是 1×；出了降速区才能重新快进。一帧内跨过 02:51 延时边界或降速区入口时按边界拆开积分（`advance()` 的大 dt 也不会越界）。
  - 离开面板时暂停（GDD §3.4“暂停的画面在退出面板后保留”），带子位置保留；离开区域（`clearArea`）时位置复位到 22:00:00、事件“已触发”记录清空（事件本身必须幂等）。
  - `jumpIndex(-1)` 取严格早于“当前 − 0.5 带子秒”的索引点（正在 03:14:00.3 时按 [ 回到 03:12:00 的上一个点而不是原地）。
  - 三脚架：`enter()` 在对话（或相册）还在栈上时不立即压 `mode.tripod`，而是监听 `'mode'` 事件，栈上没有对话的那一刻再压（强制对话 `dlg.r1.bracket_confirm` 的选项 effects 里调用 `g.tripod.enter()`，此时对话还在栈顶，直接压会让对话结束时弹掉三脚架）。`enter()` 一开始就 `save.hold('ending')`。
  - 三脚架成功：先弹 `mode.tripod`、状态回 `off`，再以顶层 run 执行 `onSuccess`（R1 在里面 award `ph.final`、开过场）；头留在门楣支架上、`ending` hold 不释放；`clearArea()`（片尾后新游戏/读档换区域）时才把头装回身子。成功后紧接着的 `photo.award()` 记为 `context: 'tripod'`。
  - “出圈”在倒计时结束（曝光开始）那一刻判一次，曝光结束再判一次；“移动”在曝光期间每帧判。
- 影响：R1-finale 的 P12/P14 数据与 regions/r1_finale.mjs
- 临时绕开：无
- 状态：resolved（M1c：录像机与三脚架的语义取舍写进 ARCH §6.10 与 §6.12“细节语义”）

## 4. 回放的几处语义取舍（ARCH 未写明，WP5 的实现）
- 类型：文档矛盾
- 现象/需要什么：
  - `onComplete`“每次进入回放最多一次”按**片段**计：一次回放里用 R 切到别的片段，那一段的 onComplete 也各自最多一次；F 退出后重新进入回放可以再触发。
  - `seek(t ≥ dur)` 越过终点后 t 置为 0（不是 t − dur）；`update` 播放越过终点时按 t − dur 续播。`stepSec` 先暂停再走一秒。
  - 锁住的片段（`locked` 为真）：开始回放时跳过，从下一个没锁的开始；全锁则显示第一段的 `lockedText`（默认“雪花太密了……”）并返回 `locked`。R 循环时同样跳过锁住的段。
  - 片段字幕 `subs` 用 `GameApi.say`（只出字幕，不进 dialogue）；seek 落进某句字幕的时间窗时补显示剩余部分。`speaker: ''` 传 `undefined`。
  - “画面断了。”只在真的走出 `walkRadius` 时显示；WP1 为传送调 `exit('walked_out')` 时不出这句。
  - `exit(reason)`：`'exit'`/`'walked_out'` 会在 `mode.replay` 在栈顶时把它弹掉；`'mode'` 不弹（ReplayMode.exit 与 ModeStack.resetTo 走这条，模式栈自己在弹）。
  - `ActorDef.rig:'paper'` 用 `createPaperFigure({ kind: characterOpts.variant === 'boy' ? 'boy' : 'vendor' })` 再换 `MATERIALS.replay()`；字符串 `props.mesh` 视为 `ctx.ref` 登记的现世对象，克隆一份并换 `mat.replay`；函数形式的道具只设 replay 层与 renderOrder，材质由区域负责。`character:'zhou'` 一律 `faceMask:true`（区域不能关）。
- 影响：R1/R2/R3/R4 的片段数据
- 临时绕开：无
- 状态：resolved（M1c：回放的语义取舍写进 ARCH §6.9“细节语义”；`active.index` 从 1 起也写进 §6.9，并修了 UI 回放 HUD 的“i/n”多加 1 的错（src/ui/replayHud.ts；scripts/selftest/m1c.mjs 验证第一段显示 1/2））

## 5. 读字目标 `lens` 缺省按 `'normal'`
- 类型：文档矛盾
- 现象/需要什么：ARCH §6.8.6 `lens?: 'normal' | 'ir'` 没写缺省。红外画面里没有褪字层、文字看不见（GDD §3.3 M5），WP5 把缺省定为 `'normal'`：红外镜头下不读任何没写 `lens:'ir'` 的目标（`rd.portrait_sketch` 写 `'ir'`）。
- 影响：各区域读字数据（GDD §7.3 的表都在常光下读，除 rd.portrait_sketch）
- 临时绕开：无
- 状态：resolved（M1c：ARCH §6.8.6 `lens` 注释写明缺省 'normal'）

## 6. dev 沙盒夹具的位置与借用的 id
- 类型：接口需求
- 现象/需要什么：WP5 的夹具全部以 `WP5_ORIGIN = (-9, 0, 0)` 为基准（沙盒西半边，x≈-14…-4），避开 WP7 的出生点 (0,0,8)、look-dev (8,0,8)、北出口 (0,-14)。拍照主体类型要求 InteractId/GhostId，所以借用了真 id：ref `r3.big_camera` `r4.camphor_chest` `r3.film_frame3` `r4.old_book` `r4.kiosk` `r1.mirror` `r1.crt` `r1.desk` `r1.vcr` `r1.bracket` `r1.mark_photo`；交互物 `r1.crt` `r1.vcr` `r1.crt_jack` `r1.bracket`；拍照目标 `pt.tudi` `pt.film3` `pt.huang_normal` `pt.huang_ir` `pt.huang_hides` `pt.door_2025` `pt.old_1` `pt.old_2` `pt.tape_face` `pt.zhou_tunnel` `pt.final`；诱饵 `decoy.dev.wp5_mirror`；读字 `rd.switch_labels` `rd.sticker_mirror` `rd.huang_breath`；残影点 `rp.r4_stall` `rp.r4_mid`、片段 `seg.stall_2023` `seg.mid_1997` `seg.lobby_2008`。dev 区域还 `ctx.mirror/console/vcr/tripod` 了一整套（屏幕 0.36×0.27 在 (-13,1.0,8.5) 朝 +z，面板视点在其前 0.5m）。
- 影响：别的 WP 的 dev 夹具若也用这些 id（mergeAreaParts 会在 dev 下抛重复）或占了同一块地方，M1c 调整
  夹具区自带一块地面碰撞体（`ctx.collider.floor`，x −14.5…−3.5、z −12…12，y 0），不依赖沙盒底座的地面（底座还没有地面时站位会掉下去，回放以“走出半径”退出）。
- 临时绕开：只改 `WP5_ORIGIN` 即可整体搬家
- 状态：resolved（M1c：沙盒夹具合并后无冲突，不需要搬家；core.mjs 的 FIX 表按这些位置写）

## 7. WP5 对外多出来的非冻结成员（M1c 决定是否冻结）
- 类型：接口需求
- 现象/需要什么：为了 WP5 内部协作与自测，几个类多了公开成员（都不在 ARCH 冻结签名里，别的 WP 目前不依赖）：
  - `ViewfinderSystem.syncPhotoCamera()`（把 cameras.photo 摆成取景器画面：fp 世界矩阵或面板视点、4:3、vfov 50、zoom、取景器掩码；拍照/读字/温度/CH1 都用它，不依赖 WP1 何时同步 photo）、`panelViewPose()`、`fpMaskBits()`、`frameNdc()`；模块级工具 `poseCamera` `layerMaskBits` `vfOnPanel` `visibleChain` `flaggedChain` `firstMaterial` `isRenderableNode`。
  - `PhotoSystem.lastJudgement`（每个候选的 fail/score/onScreen）、`currentContext()`、`judge()`、`unresolvedRefs()`（跳过 ghost.* 的 ref 解析检查，WP7 的 `lint()` 可用）；模块级 `visibleBounds` `anchorWorld` `collectOccluders` `occludedBetween`。
  - `ReplaySystem.segmentRoot(id)`、受保护的 `createActor()`（测试替换人影工厂）；模块级 `sampleKeys()`。
  - `VcrSystem.viewPose` `screenContent()` `openPanel()` `closePanel()` `tapeScene` `integrate()`；`ConsoleSystem.viewPose` `screenContent()`。
  - `CrtScreenController.attached` `setLiveMap()`；`TripodSystem.osdText()`（WP6 的 TripodHud 可用它显示区域给的 OSD 文字）`modeEntered()` `modeExited()` `consumeShot()` `restoreHead()`（成功后仍在支架上的头装回身子；clearArea 与自测收尾用）。
  - `mirror.ts` 的 `withAuxHidden()`；`crt.ts` 的 `CrtContent` `makeCanvas()`。
- 影响：WP6 的 TripodHud/VcrPanel 若想显示区域的 OSD 函数结果或 SLOW 闪烁，可用 `tripod.osdText()`、`vcr.screenContent()?.osd.slow`
- 临时绕开：无
- 状态：resolved（M1c 冻结 `TripodSystem.osdText()`（WP6 的 TripodHud 改为显示它，区域没给时退回 shichen.osdLine(1)）；其余成员仍为 WP5 内部（ARCH §2.13 写明）。改了 src/ui/tripodHud.ts，ARCH §6.12/§7）

## 8. `scripts/selftest/wp5.mjs` 的接口（给 WP7 的 core.mjs）
- 类型：接口需求
- 现象/需要什么：selftest 脚本的导出形状 ARCH 没定。WP5 的约定：`export default async function run(h?)` → `{ ok, notes }`；`h` 是 harness（有 `call(method, ...args)`，可选 `call.try`）时再跑页面内自测（`__game.selftest(name)`，需要 `?debug=1&area=dev`），没有 `h` 时只跑 node 单元自测。另导出 `unit()`、`page(h)`、`PAGE_TESTS`。单独运行：`node scripts/selftest/wp5.mjs`（node 部分）、`--page`（用 `scripts/lib/harness.mjs` 的 `launch({ query:'debug=1&test=1&lockstep=1&quality=low&area=dev' })` 起页面）。node 部分用 vite 的 `createServer().ssrLoadModule` 直接加载 TS，不需要先 build。
  M1b 结束时用一次性页面（scratchpad，直接 `new Game()` + `boot()` 进 `?debug=1&test=1&lockstep=1&area=dev`，再 `runSelftest`）对当时的整棵树跑过 7 个页面自测，全部通过；WP7 的 harness 就绪后以 `--page` 为准。
- 影响：core.mjs 的自动发现
- 临时绕开：无
- 状态：resolved（M1c：selftest 模块的导出形状与 core.mjs 的发现/重置约定写进 ARCH §12.4；wp5 的 7 个页面内自测在 core.mjs 里通过）

## Lessons
- three r186 平面镜：反射相机站在镜后朝房间看，世界 +x 在它左手边，所以镜面局部 +x 那一侧 `textureMatrix` 投影出来 u < 0.5——这正是对的（投影采样、不翻 UV，镜子只翻前后不翻左右）；写自测时别按“u > 0.5”断言。斜裁面正确时镜面平面上的点投影到反射相机 NDC z ≈ -1。
- 模块级临时向量要防“被调用方覆盖”：`inFront(cam, p)` 里用 `cam.getWorldPosition(_corner)` 覆盖了传进来的 `p`（同一个 `_corner`），后续 `project` 出 NaN，所有“太小”的判定静默通过。给每个工具函数用自己私有的临时向量。
- 拍照判定的“通过项数最多”要先按“主体在不在画面里”分层，否则画外目标（倍率镜头都对）会压过正对着但倍率不够的目标。
- `acquireFeed('ch1'|'ch2')` 在 dev 下要求 `pingpong:true`，同 key 同时只能有一个（先 dispose 再取）；CH1 的 RT 只在插线期间占用。swap 之后立刻把屏幕材质的 map 指向 `feed.read`，本帧主画面就采样刚渲好的那张，下一帧写的是另一张，不会形成反馈环。
- 录像带双分屏：同一张 RT 上改 `rt.viewport/scissor/scissorTest` 后再 `setRenderTarget(rt)` 才生效（three 在 setRenderTarget 时拷贝这三个值），渲完要还原，RT 是池里复用的。
- node 里跑 TS 自测：`createServer({ configFile:false, server:{ middlewareMode:true, hmr:false, ws:false }, appType:'custom', optimizeDeps:{ noDiscovery:true } }).ssrLoadModule('/src/...')` 直接加载源码（`import.meta.env.DEV` 为真，devAssert 生效）；要走 CanvasTexture 路径时装一个 `globalThis.document = { createElement: () => 假画布 }`，2D context 用 Proxy 让任何方法都是空函数。
- 强制对话选项里调用会压模式的系统（`g.tripod.enter()`）时，对话还在栈顶：监听 `'mode'` 事件、等栈上没有对话再压，否则对话结束时弹掉的是新压的模式。
