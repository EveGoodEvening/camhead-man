# engine-wp7：WP7 的接口需求与缺陷（M1b）

> 唯一写入者：WP7（只**追加**，不改别人的条目；ARCH §2.12、§15.2、§15.6）。M1c 起由整合代理逐条处理，并把“状态”行改为结论。
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

<!-- WP7 的条目从这里往下追加，编号从 1 开始。 -->

## 1. `AreaManager.route()` 不可达时报的“第一个被挡出口”不在通往目标的路线上
- 类型：引擎缺陷（WP1，`src/core/area.ts` 的 `route()`）
- 现象/需要什么：新游戏状态（没有任何 flag），`?debug=1&test=1&lockstep=1&area=dev` 里 `goto('r2_502', 5.6, -1.5)` 返回 `{ ok:false, reason:'blocked', result:{ exit:'exit.r1_to_r3', feedback:'铁链上挂着把大锁。钥匙……老周说在抽屉里。' } }`。应为路线 dev → r1 → r2 → r2_502 上被挡的 `exit.r2_to_502` 与它的 blocked 文本（尉迟恭“站住！门里阳宅，门外阴客。”，ARCH §4.5“`exit` 是第一个被挡住的出口”）。原因：BFS 之后的兜底循环按发现顺序检查被挡出口，只问 `graphReach(b.to, to)`（无视条件）；r3 能经 r1（本来就可达）绕回 r2 → r2_502，于是院门东口被当成“打开它就能通到目标”的出口。建议：无视条件求 from → to 的最短路径，返回路径上第一个 `when` 为假的出口（或兜底时只接受不经过已 `seen` 区域的 `graphReach`）。
- 影响：所有跨区域 `goto` 被挡时的 `result.exit/feedback`（ARCH §4.5、§12.3）；`scripts/core.mjs` 用例“五个区域经出入口图互相走通”的最后一段（M1c 必须通过，现在因此失败）；`regions/r2.mjs` 的 502 门用例（该预置里院门已开，碰巧不受影响）。
- 临时绕开：无（调试 API 原样转发 `areas.goto()` 的结论，不自己寻路）
- 状态：resolved（M1c：`AreaManager.route()` 不可达时改为在无视条件的出入口图上求“被挡出口数最少、其次跳数最少”的路线，返回路线上第一个被挡出口（新增私有 `firstBlockedOnRoute`，删掉 `graphReach`）；新游戏 dev → r2_502 现在报 exit.r2_to_502 与尉迟恭的台词。改了 src/core/area.ts，ARCH §4.5；core.mjs 的“五个区域互相走通”通过）

## 2. dev 沙盒负例里的假 id 被 `check.mjs` 判违规（`src/areas/dev/wp4.ts`）
- 类型：引擎缺陷（跨 WP：WP4 的文件、WP7 的检查）
- 现象/需要什么：`node scripts/check.mjs` 报 3 条 `unknown-id`：`src/areas/dev/wp4.ts:401 'r1.no_such_flag'`、`:566 'it.bogus'`、`:569 'ph.bogus'`——都是 WP4 故意构造的“未登记 id 必须报错/被丢弃”的负例。ARCH §14.2 要求 `src/` 下的 id 字面量都在 `ALL_IDS ∪ DEV_IDS` 中，check.mjs 照做（dev 沙盒只对“区域目录禁用 API”降为警告，id 规则不降）；它支持逐行豁免：在该行或上一行写 `// check-allow: unknown-id`（规则名就是输出方括号里的名字）。请整合者在这三处加豁免注释（WP7 不改 WP4 的文件），并把 `check-allow` 机制写进 ARCH §14.2。
- 影响：M1c 完成定义“`check.mjs` 无违规”
- 临时绕开：无
- 状态：resolved（M1c：三处负例加 `// check-allow: unknown-id` 并写明原因（src/areas/dev/wp4.ts）；豁免机制写进 ARCH §14.2，并收紧为“只在引擎文件与 dev 沙盒生效，正式区域目录不得自我豁免”（scripts/check.mjs），scripts/selftest/wp7.mjs 的用例相应更新；check.mjs 全树 0 违规）

## 3. 调试 API 在 ARCH §12 之外的补充行为（建议同步进 ARCH §12.2、§12.3、§12.5）
- 类型：文档矛盾
- 现象/需要什么：以下是 WP7 自定、ARCH 没写到的行为（均在 `src/debug/*.ts` 注释里写明）：
  - `shot(area, '*')`：不摆机位，只列出本区全部 `ShotDef`：`result = { keys: [], shots: [{ id, label, ui, keys, brightness }] }`（`ShotListing`，`debug/shots.ts`）。`scripts/shots.mjs` 用它枚举机位（机位定义在区域模块里，Node 侧读不到）。
  - 瞄准点解析（§12.3 的顺序）末尾追加：都解析不到时取本区 `ctx.getRef(id)` 的世界包围盒中心（§12.5 说 `ShotDef.keys` 可以写 ref）。
  - 失败原因 `exception`：方法内部抛出非超时异常时返回 `{ ok:false, reason:'exception', result:{ error } }` 并 `console.error`（harness 因此判失败）——是引擎缺陷而不是调用方的错，不在 `FailReason` 里。`Game.settle()` reject 的 `TimeoutError`（engine-wp1.md #1）映射为 `{ ok:false, reason:'timeout', result:{ method, error, state } }`，不打 console.error。
  - `reload()` 在 dev 沙盒里返回 `mode_disallows`（沙盒不存档，读回的会是别处的旧存档）；`continueGame(slot)` 在该槽没有可用存档时返回 `no_such_target`；`readDoc(id)` 对既不属于任何物品、也没有区域登记的文档返回 `no_such_target`（先于 `not_owned`）。
  - `show/use`：与 `interact` 相同的转向与真人路径检查 → 验证 `mode.album{pick}` 在当前模式能压栈（压入即弹出）→ `interaction.activate(target, {verb, thing}, 'api')`，即 ARCH §6.6“挑选器里确认 → 弹出 album 并 `activate({verb, thing})`（与调试 API show/use 是同一个入口）”。没有用 `{t:'pick', index}` 选格：格子序号约定（engine-wp4.md #1）还不是冻结签名；整合者若冻结它，可改为 dispatch pick，把挑选器本身也覆盖到（`input.mjs` 已用真实方向键 + Enter 覆盖）。
  - `setFlags/giveItem/givePhoto/setState`（★）写入后调用 `save.request('manual')`（`debugSet` 不经 `setFlag`，不标脏的话预置之后的 `reload()` 会读回预置前的存档）；时辰推导值变了就 `shichen.resetClock()`；不给 area 时 `npc.reevaluate()`，给 area 时重进区域。
  - `perf().tris` 取整帧与主场景两者中的大值；`callsMain` 由 `perf()` 当场把主场景单独渲到一张 8×8 RT 测得（`renderer.info` 随后还原）。
- 影响：ARCH §12.2、§12.3、§12.5 的文字
- 临时绕开：无（已实现）
- 状态：resolved（M1c：写进 ARCH §12.2“引擎异常与超时”、§12.3 瞄准点解析末尾的 ref 兜底与“WP7 自定、M1c 写明的补充行为”；perf 的 callsMain 改用 RenderPipeline.stats()（见 engine-wp1.md #2））

## 4. 测试脚本与 selftest 的约定（给 M1c 与各 WP）
- 类型：接口需求
- 现象/需要什么：
  - `scripts/selftest/wpN.mjs` 由 `core.mjs` 自动发现：默认导出 `run(h)`，返回 `{ ok, notes }`（或 `true/undefined`）；`h` 是 harness 句柄（`call`/`call.try`/`page`/`state`，页面在 `?debug=1&test=1&lockstep=1&quality=low&area=dev`）。**每个模块之前 core.mjs 都把页面重置为“新游戏状态 + dev 出生点”**（`newGame` → `dlg` → `setState({area:'dev'})`；`setState` 只加不减），各 WP 的页面内自测可以按新游戏状态写断言（WP4 的 `wp4.album_pick` 依赖这一点）。`core.mjs --only=wpN` 只跑一个。
  - core.mjs 在同一个 node 进程里顺序 import 各 WP 的 selftest：harness 已把 vite `preview()` 改掉的 `process.env.NODE_ENV` 还原；各 selftest 自己装到 `globalThis` 上的替身（document、window、localStorage……）用完请还原。
  - 并行运行多个脚本：`CAMERA_DIST=<构建目录> CAMERA_PORT=<起始端口>`（端口被占用会自动往后找）。
  - harness 的 GL 警告正则严格照 ARCH §12.4：`/GL_INVALID|WebGL:|feedback loop|deprecated|has been removed/i`，不含 “GPU stall due to ReadPixels”（回应 engine-wp3.md #9：确认不放宽）；未处理的 Promise rejection 以 `pageerror` 抓到。
  - 沙盒底座（WP7）现在有 30×30m 地面碰撞体（回应 engine-wp1.md #11，可 resolved）；地标牌 `r1.estate_sign`（沙盒说明）就在出生点前方约 2m、射程内（WP6 的 `wp6.markers` 需要出生点附近有射程内的交互物）；WP7 的其余夹具在东侧 x≈11–14、z≈1–8。dev 另有 3 个 WP7 截图机位 `shot.dev.wp7_free/_tp/_vf`（验证 `shot()` 与 `shots.mjs` 的整条链路），look-dev 的 `shot.dev.lookdev_*` 由 M1c 另加。
- 影响：`scripts/core.mjs`、各 `scripts/selftest/wpN.mjs`
- 临时绕开：无
- 状态：resolved（M1c：写进 ARCH §12.4“selftest 与 harness 的约定”；core.mjs 的自动发现另加整合代理的 scripts/selftest/m1c.mjs）

## Lessons
- vite 的 `preview()`（harness 起静态服务用）会把 `process.env.NODE_ENV` 设成 `'production'` 且不还原；同一 node 进程里之后再 `createServer()` + `ssrLoadModule` 时 `import.meta.env.DEV === false`，所有“dev 下抛错”的 node 侧用例都会挂——起 preview 前保存、起完还原（`scripts/lib/harness.mjs` 已这样做）。
- `setState`/`setFlags`/`giveItem`（★）只加不减：要“干净的进度”就先 `newGame()` + `dlg()` 再 `setState({ area, … })`（core.mjs 的 `fresh()`、harness 的 `freshState()`）。
- 无头 SwiftShader 帧率低、`dt` 钳到 0.1s，非锁步（`input.mjs`）下游戏时间比真实时间慢：速率类断言（录像机快进/降速、Shift 快走）要按游戏时间算——`wait(0)` 不推进时间，返回的 `time` 就是当前游戏时间。
- 在 dev 下（`?test=1` 也算）`ctx.interactable()` 对“有 when 没 blocked”直接抛错，所以 `lint()` 的这条规则在运行期造不出负例；测它要拿合成的 `AreaDef` 调 `lintAreaDefs()`。
- 沙盒截图机位的 `keys` 用交互物 id（锚点在牌面中心）而不是 ref：ref 取的是整个 Group 的包围盒中心，带立柱的牌子会落在暗的立柱上，5×5 亮度验收过不去。
- Playwright 的 `pageerror` 同时抓到未捕获异常与未处理的 Promise rejection；`console` 事件的 warning 类型是 `'warning'`。
