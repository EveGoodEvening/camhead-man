# engine-wp1：WP1 的接口需求与缺陷（M1b）

> 唯一写入者：WP1（只**追加**，不改别人的条目；ARCH §2.12、§15.2、§15.6）。M1c 起由整合代理逐条处理，并把“状态”行改为结论。
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

<!-- WP1 的条目从这里往下追加，编号从 1 开始。 -->

## 1. `Game.settle()` 超时时 reject（TimeoutError），不返回 Settle
- 类型：接口需求
- 现象/需要什么：`settle(o?)` 的签名只能返回 `'idle' | 'waiting'`，没有“超时”这一值。WP1 的实现：真实时间超过 `maxRealMs`（默认 60 000）或游戏时间超过 `maxGameSec`（默认 600）时 **reject 一个 `name === 'TimeoutError'` 的 Error**，而不是谎报 `'idle'`。另外两条语义：栈顶是冻结模式且 runner 忙时返回 `'waiting'`（冻结时 runner 不会前进，等的是玩家）；`areas.isLoading()` 为真时一直推进/等待，直到区域加载与淡入淡出结束。
- 影响：WP7 `debug/api.ts` 调 `game.settle()` 时须 `try/catch`，把 `TimeoutError` 映射成 `{ ok:false, reason:'timeout' }`。
- 临时绕开：无（WP7 包一层 catch 即可）
- 状态：resolved（M1c：语义写进 ARCH §4.4“settle() 与新游戏/读档”与 §12.2“引擎异常与超时”；debug/api.ts 已把 TimeoutError 映射为 { ok:false, reason:'timeout' }，不改代码）

## 2. 不属于冻结签名、但别的 WP/整合时可能想用的 WP1 内部成员
- 类型：接口需求
- 现象/需要什么：下列成员在 WP1 文件里是 public（带“WP1 内部”注释），别的 WP 按 §15 通用规则**不得依赖**；M1c 若觉得有用，可以决定冻结并写进 ARCH：
  - `Game.waitGame(sec)`：按游戏时间等待（非锁步等 rAF，锁步下自己 `advance`；身处 step/另一个 advance 之中时只让出宏任务、不重入）。`Game.drive(done, maxGameSec?)` 是它的通用版。区域切换、换楼层、带淡入的传送、`walkTo` 都用它。
  - `RenderPipeline.lastFrameCalls`（`{ total, feeds }`，最近一帧整帧与其中辅助 RT 的 draw call）：`perf()` 的 `callsMain` 需要“主场景 draw call”，§4.7.2 的 `stats()` 没有这一项，RenderPass 在 WP3 的 PostPipeline 里，WP1 取不到差值。建议 M1c 在 `stats()` 里加 `callsMain`（WP3 提供 RenderPass 前后的计数）。
  - `RenderPipeline.renderMain(dt)`（只渲主场景，不调度 feed；`Game.renderNow()` 用它）、`RenderPipeline.onResize`。
  - `InputManager.translate(b, down)`、`inject(b, down)`、`takeFrameButtons()`、`attach()`、`suspended`；`ModeStack.pointerPolicy()`、`cameraFor()`、`refresh()`。
  - `CollisionWorld.capsuleFreeAt(x, y, z)`、`groundBelow(x, yTop, z, maxDrop)`、`colliderVersion`；`collision.ts` 导出的 `shapeToObb`、`capsuleVsObb`。
  - `CameraRig.tpCameraPosition(yaw, pitch, out)`、`fixedYaw()`、`boomLength`、`viewport`。
  - `PlayerController.eyeFor(yaw, out)`、`applyLook()`、`clampPitch()`、`nudge()`、`driveWalk()`、`teleportSeq`、`walking`；导出常量 `LENS_FORWARD`、`PITCH_LIMITS`。
  - `AreaManager.init()`、`changeLevel(n)`、`building`、`buildingForMs()`、`segmentArea()`；`AreaContextImpl.applyAreaLook()`、`applyLevel(n, force?)`、`levelY(n)`；`TriggerSystem.addDirect()`、`resync()`、`keys()`；`triggers.ts` 导出的 `pointBoxDistance`、`spawnClearanceIssues`、`SPAWN_CLEARANCE`；`actions.ts` 的 `keymapButtons()`。
- 影响：无（只是列清单，供 M1c 决定）
- 临时绕开：无
- 状态：resolved（M1c 决定：只冻结 perf 需要的一项——`RenderPipeline.stats()` 加 `callsMain/trisMain`（取 WP3 的 `PostPipeline.sceneStats`，同时冻结），debug/api.ts 的 perf() 改用它、删掉另渲 8×8 RT 的 measureMain；其余成员仍是 WP1 内部，ARCH §2.13 写明“本文没写进代码块的公开成员都不得依赖”。改了 src/core/render.ts、src/debug/api.ts、ARCH §4.7.2/§8.1/§12.3/§2.13）

## 3. `MoveInput` 的坐标约定：x 向右为正，z 向前为 −1
- 类型：文档矛盾
- 现象/需要什么：ARCH §4.6 只写了“相机坐标系，|v|≤1”，没写正负号。WP1 取 three 相机空间的约定：`x = +1` 向右（D）、`z = −1` 向前（W）、`z = +1` 向后（S）；三脚架模式（`move === 'body'`）相对固定机位相机的水平朝向。任何调用 `input.setMove()` 的代码（WP5 三脚架 `bodyGoto` 若用它、WP7 的 `walk()` 走 `player.walkTo` 则无需关心）须按此约定。
- 影响：ARCH §4.6 `MoveInput` 注释
- 临时绕开：无
- 状态：resolved（M1c：写进 ARCH §4.6 `MoveInput` 注释；代码不变）

## 4. 动态碰撞体 `box.rotYDeg` 与 `wall(a, b, …)` 的几何约定
- 类型：文档矛盾
- 现象/需要什么：ARCH §4.8 没写 `rotYDeg` 的方向。WP1：`rotYDeg` 与 three 的 `object.rotation.y` 同义（绕 +Y、逆时针、度），`ColliderBuilder.box` 与 `DynamicShape.box` 一致；`wall(a, b, y0, height, thickness=0.2)` 是以线段 a→b 为中心线、局部 x 轴对齐 a→b 的竖直盒子。WP2 `kit/doors.ts` 的 `DoorRig.collider` 若用 `box` 形状，须按门的 `rotation.y`（弧度 → 度）填 `rotYDeg`。
- 影响：ARCH §4.8；WP2 `door().collider`
- 临时绕开：无
- 状态：resolved（M1c：核对 WP1 `collision.ts`/`areaContext.ts` 与 WP2 `kit/geom.ts`/`kit/instancing.ts` 都是 three 的 rotation.y 约定（度、俯视逆时针为正、不是 yaw），wall 的几何也写明；写进 ARCH §4.8“几何约定”与 §10.2 注释；代码不变）

## 5. 连通性栅格用 0.25m 格、半径 0.28（ARCH 写的是 0.5m、0.3）
- 类型：文档矛盾
- 现象/需要什么：0.5m 格 + 0.3 膨胀时，0.9–1.0m 宽的门洞里可通行带只有 0.3–0.4m，格心不一定落进去，`goto` 会把明明走得过去的门误判为 `unreachable`。WP1 改用 0.25m 格、测试胶囊半径 0.28、胶囊底离地 0.15（更矮的门槛/路沿不算障碍）；格子按需测试（只 flood-fill 到目标为止）并按“碰撞体版本号 + 层高”缓存。`reachable(from, to, level)` 在 from 与 to 高差 > 1.2m 时直接返回 false：楼层之间“经楼梯口连通”由 `AreaManager.goto` 处理——先测“玩家 → 当前层楼梯口 (0, y, 1.8)”，再测“目标层楼梯口 → 目标点”。
- 影响：ARCH §4.5（goto）、§4.8（reachable）
- 临时绕开：无
- 状态：resolved（M1c：ARCH §4.5 goto 段与 §4.8 `reachable` 注释改成 0.25m 格、半径 0.28、底离地 0.15、高差 > 1.2m 为 false、楼层经楼梯口分两段测）

## 6. 取景器视点在身体中轴前方 0.18m（`LENS_FORWARD`），WP2 的 `lensAnchor` 宜与之重合
- 类型：接口需求
- 现象/需要什么：`PlayerController.eye` = 脚底 + `PC_DIMS.lensY`（1.85）+ 沿水平朝向前移 0.18m（头壳长 0.34，镜头在前脸）。fp 相机、`lookAtPoint('fp')`、读字/拍照的视点都用它，不读 `playerModel.head.lensAnchor`（保证判定不受模型动画影响，ARCH §4.7“朝向只由 yaw/pitch 决定、不跟随行走起伏”）。WP2 的头部模型里镜头中心若不在前方 0.18m 处，镜中贴条与取景器视点会差几厘米。
- 影响：WP2 `rigs/cameraHead.ts`；GDD §2.7 镜面高度（只影响水平位置，不影响 1.85/1.93 两个高度）
- 临时绕开：无
- 状态：resolved（M1c：新增页面内自测 `m1c.lens_anchor`（src/areas/dev/m1c.ts）验证俯仰 0、头跟随视角时 `lensAnchor` 与 `player.eye` 高差 < 1cm、水平差 < 3cm，通过；ARCH §4.7/§5.2 写明判定一律用 eye（LENS_FORWARD 0.18），lensAnchor 只是模型点）

## 7. `LevelsDef.onChange` 在进区域放置玩家时总会调用一次（可能 n === prev）
- 类型：文档矛盾
- 现象/需要什么：为保证楼层节点显隐与出生点楼层一致，WP1 在 enter 第 5 步放置玩家时调用一次 `onChange(spawn.floor ?? current, current)`，即使两者相等；此后 `levels.set(n)` 只在 n 变化时调用。区域的 `onChange` 须幂等（R2 占位已是“按 n 设各层 visible”，天然幂等）。楼层编号由区域自定（R2 用 1–5），WP1 不按 `count` 钳制。
- 影响：R2（`src/areas/r2/`）
- 临时绕开：无
- 状态：resolved（M1c：写进 ARCH §11.2 `LevelsDef` 注释：进区域总会调一次、onChange 必须幂等、引擎不按 count 钳制）

## 8. 只有 `via`、没有 `box` 的出入口没有实现
- 类型：接口需求
- 现象/需要什么：ARCH §4.5 说本作没有 `via` 出口。WP1 只为带 `box` 的出口生成触发体；只有 `via` 的出口在启动校验时 `devWarn`，不会生成任何入口。真要做“按 E 出门”，区域可登记一个交互物 `onInteract: g => g.travel(EXIT.X)`（与触发体走同一个 `areas.travel`）。
- 影响：无（GDD §13.2 全是触发体出口）
- 临时绕开：交互物 + `g.travel()`
- 状态：resolved（M1c：写进 ARCH §4.5 `ExitDef.via` 注释（只有 via 的出口 devWarn、不生成入口；用交互物 + g.travel() 代替））

## 9. viewfinder 的 KEYMAP 行含面板传输键；过场里的空格只有“按下”
- 类型：接口需求
- 现象/需要什么：附录 A 要求叠在面板上的取景器把 `play/shuttle/stepSec/index/digit` 以 `pass` 下传给面板，但按键翻译按**栈顶**模式查 KEYMAP，所以这些键写进了 `mode.viewfinder` 行（Space、Z/C 按住、逗号/句号、[ ]、Digit0–9）。WP5 的 `ViewfinderMode.handle` 须在叠在面板上时对它们返回 `{ ok:false, pass:true }`，不在面板上时返回 `mode_disallows`（`interact`、`back` 同理按附录 A 下传）。另：`mode.cutscene` 的 Space 只在按下时产生一次 `{ t:'play' }`（键盘自动重复被滤掉），“重看时长按空格跳过”需要按住时长——`Action` 里 `play` 没有 `down` 字段，WP4 若要做长按，需要 M1c 给 `play` 加 `down?: boolean`（或 KEYMAP 在 cutscene 行按下/松开各发一次）。
- 影响：WP5 `game/modes/viewfinder.ts`；WP4 `game/modes/cutscene.ts`（可选功能）
- 临时绕开：无
- 状态：resolved（viewfinder 行含面板键、ViewfinderMode 按叠加 pass 下传：已核对 src/game/modes/viewfinder.ts，写进 ARCH §4.6 叠加规则；“长按空格跳过”不做（wontfix 这一半）：按 WP4 #7 简化为按一下即跳过，写进 ARCH §6.14）

## 10. `RenderPipeline.render(dt)` 的 dt 是“上次渲染以来的游戏时间”
- 类型：文档矛盾
- 现象/需要什么：锁步下 rAF 只渲染、模拟只在 `advance()` 里走且 advance 期间不渲染。为了让后期的淡入淡出/白闪在锁步下也按游戏时间推进到位，WP1 把**自上次渲染以来累计的游戏时间**传给 `pipeline.render(dt)`（非锁步时就是本帧 dt；锁步 rAF 在两次 API 调用之间传 0；advance 结束渲染的那一帧传整段累计）。WP3 的 `PostPipeline.render(dt)` 应只用这个 dt 推进 push/pop 的淡入淡出，不自己计时（ARCH §16 #16 同理）。区域切换的黑场用 DOM 的 `ui.fade.black()`，逻辑等待走 `waitGame`，与后期无关。
- 影响：WP3 `fx/post.ts`
- 临时绕开：无
- 状态：resolved（M1c：与 WP3 #4 的实现一致（动画时间只累加 dt，过渡时间在 dt=0 时用真实时间），写进 ARCH §4.7.2“render(dt) 的 dt”与 §8.1；代码不变）

## 11. 沙盒底座还没有地面与灯：别的 WP 的页面内自测会因玩家下坠而失败
- 类型：引擎缺陷
- 现象/需要什么：M1b 期间 `src/areas/dev/base.ts`（WP7）仍是占位，只有出生点与出口，没有地面碰撞体。用真实模块启动 `?debug=1&test=1&lockstep=1&area=dev` 时玩家从出生点一直往下掉；`wp5.replay` 因此在回放中途以 `walked_out` 退出（`pos=-9.00,-0.11,-4.50`）。WP1 的夹具自带一块 8×14m 地面（`dev/wp1.ts`），本包的 14 个页面自测不受影响。
- 影响：WP5、WP6 的部分页面自测；M1c 等 WP7 的底座落地后复跑
- 临时绕开：各 WP 夹具自带地面（WP1 已这样做）
- 状态：resolved（WP7 的沙盒底座已有 30×30m 地面（src/areas/dev/base.ts）；M1c 起 wp1–wp7 与 m1c 的全部页面内自测都在同一个沙盒里通过）

## Lessons
- three r186 `Octree.capsuleIntersect` 在胶囊跨过大地面四边形的对角线时，棱边接触给出略斜的法线；直接沿法线推、再按法线去掉速度，会把走直线的人横着推出 0.2m。本项目可行走面都水平：法线 y > 0.7 的接触只往上推、不动水平速度（`core/player.ts`）。
- `Octree.capsuleIntersect` 返回的 `normal` 是模块级临时向量（`_center`），拿去存或和动态碰撞体比较前必须 `clone()`；`rayIntersect` 的命中点字段叫 `position`，而且不按 far 截断。
- 连续调用只走微任务的短 `advance()`（settle/drive 的循环）会饿死宏任务：`setTimeout`、`compileAsync` 的轮询、建区里的真实异步都等不到。这类循环每轮 `await` 一次 `setTimeout(0)`。
- `renderer.compileAsync` 在没有 `KHR_parallel_shader_compile`（SwiftShader）时经 `extensions.get()` 打一条警告；先 `renderer.extensions.has(...)`，没有就直接 `renderer.compile()`。
- 指针事件对“已按住一个键时再按另一个键”（chorded buttons）不发 pointerdown，只发 pointermove：鼠标键用 mouse 事件监听。合成的拖拽（Playwright）不一定带 `movementX`，未锁定的拖拽用 clientX 差分。
- node 侧测 `src/core` 的 TS 模块：vite 8 的 `createServer({ appType:'custom', server:{ middlewareMode:true } }).ssrLoadModule()` 可直接加载，别的 WP 的模块用 `resolveId` 插件换成替身；`Game` 需要 WebGL 与全部系统，改用 `Object.create(Game.prototype)` 配假字段测 step/advance/settle（`scripts/selftest/wp1.mjs`）。
- 在多个代理同时改文件的仓库里用 vite dev server 跑集成页面，必须 `server.hmr: false` 且 `server.watch.ignored: ['**/*']`，否则别人一保存页面就整页重载（Playwright 报 “Execution context was destroyed”）。
- 第三人称吊臂按 ARCH 最近 0.9m：身后离墙不到约 1.1m 时相机仍会进墙；区域在狭窄处（R2 楼道）要么留出 ≥1.1m 的纵深，要么接受相机贴墙。
