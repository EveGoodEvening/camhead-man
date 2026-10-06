# r1-world：R1-world 区域代理的需求与缺陷

> 唯一写入者：R1-world 区域代理（ARCH §2.12、§15.6）。只追加。引擎维护者的结论写在 `docs/requests/m2-engine.md`。

## 1. GameApi 没有“打开文档/巡夜本”的入口（墙上文档、开场自动翻开巡夜本）
- 类型：接口需求
- 现象/需要什么：GDD §3.2 开场“按 E 拾取（巡夜本），自动打开，读到夹页和新页①”；GDD §13.9 的墙上文档（`doc.obituary`/`doc.demolition`/`doc.water_notice` 在 `r1.notice_board`，`doc.estate_sign` 在 `r1.estate_sign`，`doc.shrine_couplet` 在 `r1.shrine`，`doc.cctv_notice` 在 `r1.cctv_notice`）按 E 应该在阅读器里打开。区域只拿得到 `GameApi`（ARCH §6.3），而 `JournalSystem.openDoc/openJournal` 不在门面上，区域无法打开阅读器。需要 `GameApi.openDoc(id: DocId, o?: { vf?: boolean }): ApiResult` 与 `GameApi.openJournal(): ApiResult`（或等价的 Effect `E.doc(id)`/`E.journal()`），语义同 `JournalSystem.openDoc/openJournal`（压 `mode.journal`，`activate` 按“面板已打开”settle）。
- 影响：GDD §11 步骤 1（拾取后不会自动翻开，步骤本身的 expect 不受影响）；墙上文档只能用旁白对话逐段念出来（`rd.obituary_hidden` 读到之前讣告下半截不念）。regions 脚本无 blockedBy。
- 临时绕开：拾取巡夜本后给一条教学提示“J：巡夜本”（E.tutorial）并由引擎照常 toast“巡夜本上多了一行字”；墙上文档用 `dlg.r1.doc_*` 旁白对话显示原文（text.ts 的同一份常量，文档本身仍登记在 `AreaDef.docs`）。入口加上后 R1-world 把这几处换成 openDoc/openJournal。
- 状态：resolved（M3）：`GameApi.openDoc(id, o?)`/`openJournal()` 与 Effect `E.doc(id, vf?)`/`E.journal()`（`game/effects.ts`；阻塞到阅读器合上，连写几个就是一张接一张读；阅读器开着时 settle 为 'waiting'），`DebugState.doc`（`debug/api.ts`），测试助手 `readDocs`（`scripts/lib/harness.mjs`）；ARCH §6.3、§6.16、§12.3。R1-world 已换回真正的阅读器：拾取巡夜本后 `E.journal()` 自动翻开（合上后再给“J：巡夜本”教学提示），公告栏 `[E.doc(拆迁公告), E.doc(讣告), E.doc(停水通知)]`（讣告下半截按 `DocDef.covered` 打码），小区简介、监控调试注意事项、土地庙对联同样 `E.doc`/`g.openDoc`；旁白念文档的 `dlg.r1.doc_*` 与 `obituarySpoken` 已删（`r1/logic.ts`、`dialogue.ts`、`text.ts`）。walkthrough 步骤 1 在拾取后 `back()` 合上巡夜本；`regions/r1.mjs` 新增“墙上文档在阅读器里读”用例。

## 2. 跨区域协调：`doc.slip_0473` 归 R3、`doc.idcard` 归 R1-world
- 类型：文档矛盾
- 现象/需要什么：这两份文档属于 R1 抽屉里拿到的随身物品（`it.slip_0473`、`it.idcard`，GDD §7.1、§13.9），ARCH §11.6 只写了“R1 文档”，没写归谁登记；两边都登记时 `JournalSystem.registerDocs` 在 dev/test 下抛“文档重复”，整局起不来（R1-world 第一次打包时就撞上了：R3 的 `src/areas/r3/text.ts` 已登记 `doc.slip_0473`，正文带 P6 的肉眼注释）。现状：`doc.slip_0473` 由 R3 登记、R1-world 不登记；`doc.idcard` 由 R1-world 登记（R3 没有）。请 M3 确认这个分法并写进 ARCH §11.6 的分工表。
- 影响：全部测试（重复登记时启动即失败）。regions 脚本无 blockedBy。
- 临时绕开：已按上面的分法各登一份。
- 状态：resolved（M3）：确认现在的分法——`doc.idcard` 归 R1-world，`doc.slip_0473` 归 R3（正文带 P6 的肉眼注释），原则是“文档正文归用它的谜题所在的区域、只登记一次”，已写进 ARCH §11.6 的“M3 定稿的跨代理约定”。

## 3. 跨代理协调：R1 的 8 盏实时灯已由 R1-world 用满；`decoy.r1.*` 镜子诱饵、视频线自动拔出归 R1-finale
- 类型：文档矛盾
- 现象/需要什么：GDD §4.1“本区实时光 7 盏加半球光，合计 8”（半球光、钠灯①②、门灯、CRT 磷绿、土地灯笼、车棚灯、公告栏灯）全部由 R1-world 在 build 里 `ctx.light()` 建好；R1-finale 的 build 再调 `ctx.light()` 会超预算（dev 下抛错）。录像带 `tapeScene` 的灯另计，不受影响。另：P13 的“拍镜子：空镜标题‘镜子里只有一台旧摄像头。’”属于 P13 的错误反馈，R1-world 不登记镜子诱饵，由 R1-finale 以 `decoy.r1.<snake>` 登记（主体 ref `r1.mirror`，R1-world 已登记）；“离桌子 > 2m 自动拔出视频线”随 `r1.crt_jack` 归 R1-finale。
- 影响：R1 加载（灯数超预算即失败）。regions 脚本无 blockedBy。
- 临时绕开：无；R1-world 登记的 ref 见 `src/areas/r1/world.ts` 文件头（`r1.desk` `r1.crt` `r1.vcr` `r1.crt_jack` `r1.bracket` `r1.mirror`，另有 `r1.anthill` 蚁穴网格供 R1-finale 的交互物 hit 用）。
- 状态：resolved（M3）：确认——R1 的 8 盏灯全由 R1-world 建，终章不加灯、只改颜色/强度/可见性；`decoy.r1.fin_mirror` 与“离桌 > 2m 自动拔线”归 R1-finale（现状如此）。写进 ARCH §11.6。

## 4. `shot()` 的自由机位（`view.cam`）只藏了身子，摄像头脑袋和视频线还悬在出生点
- 类型：引擎缺陷
- 现象/需要什么：`debug/shots.ts` 的 `runShot` 对 `view: { cam }` 调 `game.playerModel.setVisible(false)`，而 `rigs/player.ts` 的 `setVisible` 只隐藏身子网格与假阴影（结局要“身子不见、头留在门楣上”），头壳、铁皮帽与后脑的视频线仍然渲染。R1 的第一个出生点是门卫室里的椅子（`spawn.r1_start`），所以凡是拍门卫室内部的自由机位，画面正中都悬着一颗摄像头脑袋和一根下垂的线（复现：`shot('r1', …)` 任一 `cam` 机位对着 (-6.5,1.9,20.8)）。需要：自由机位时连头一起藏（例如 `playerModel.root.visible = false`，拍完复原），或 `ShotDef` 允许指定隐藏玩家时的站位。
- 影响：只影响截图（`shots.mjs`），不影响玩法与 §11 步骤。regions 脚本无 blockedBy。
- 临时绕开：R1 的门卫室内部机位改用第三人称/取景器（玩家本来就在画里），自由机位只用在室外（出生点的椅子被门卫室的墙挡住）。
- 状态：resolved（M3）：`debug/shots.ts` 的 `runShot` 对 `view.cam` 另外 `playerModel.root.visible = false`（身子、装在身上的头与视频线一起藏；头在支架上时不在 root 下照常渲染），下一次进区域由 `Game.areaReady` 复原；ARCH §12.5。门卫室内部的自由机位以后可以用了（现有机位没改）。

## 5. 跨代理协调：门卫室桌前的拾取代理、门扇/院门的开向、CRT 机壳（回应 r1-finale.md #5/#6）
- 类型：文档矛盾
- 现象/需要什么：（1）R1-finale 把 `r1.desk` 的拾取代理加高到 1.3m（priority 2，`present: r1.log_taken`）。门卫室净高 2.6m，第三人称相机在桌前被天花板压到 ~2.4m、俯仰到 −35° 下限，准星射线从桌沿上方掠过、落进这块代理，GDD §11 步骤 6/8 的 `interact(r1.drawer)`（从 (-6.5,20.9)）因此 `not_focusable {focused: r1.desk}`。（2）r1-finale.md #6：门卫室门扇（原来往外开、停在门洞南侧）与院门西扇（原来往院里开）挡住终章 CH1 画面。（3）r1-finale.md #5：`PROPS.crt()` 前面板正面在屏幕平面前 8mm，屏幕四周被埋。请 M3 把（1）的约定写进 ARCH §11.6 的分工表（两边的桌上拾取代理的优先级/范围），并确认（2）的开向。
- 影响：GDD §11 步骤 6、8（已绕开，全部通过）；终章 56–58 的观感。regions 脚本无 blockedBy。
- 临时绕开：（1）R1-world 的 `r1.drawer` 拾取代理在桌子正中前沿、桌面上方竖一块同宽的代理（抽屉打开后不在场），巡夜本 priority 升到 4（`logic.ts`）；（2）门卫室门装在东墙内侧、合页在北、往屋里开到贴墙（`booth.ts`），院门正面（铁链）朝院里、解链后两扇往人行道推开（`yard.ts`，开着的门扇另有动态碰撞体 `r1w_gate_leaf_w/e`，条件 `r1.gate_unchained`），陆师傅的回放路线与湿脚印绕开门扇；（3）CRT 机壳比屏幕往后挪 1cm（屏幕仍在 layout 的 `crtScreen`，`r1.crt` 坐标不变）。kit 本身（`PROPS.crt()`）未改，建议 M3 顺手把前面板改成开口的框。
- 状态：resolved（M3）：（1）桌上三块拾取代理的优先级/范围写进 ARCH §11.6（`r1.log` 4、`r1.drawer` 3、`r1.desk` 2 与各自的形状，改一块两边的 regions 脚本都要重跑）；（2）门卫室门往屋里开到贴墙、院门往人行道推开，确认并写进 ARCH §11.6（终章截图 `shot.r1.fin_ch1_mao` 复看过）；（3）kit `PROPS.crt()` 的前面板改成开口的框（`kit/props.ts`），`booth.ts` 的机壳改回按 kit 的相对位置摆（去掉往后挪 1cm），终章的 `unhideCrtScreen` 删除。

## 6. 跨代理协调：结局的天亮由终章接管（回应 r1-finale.md #3）；镜面只在朝北看时渲染
- 类型：文档矛盾
- 现象/需要什么：（1）r1-finale.md #3 提出二选一：R1-world 登记天色对象的 ref，或在 `r1.soul_returned && !r1.called_at_dawn` 期间不跑天亮。GDD P14 第 5–6 步合影后老周回屋时还是夜里，“东边发白”在 `cs.r1.dawn` 里，所以 R1-world 取后者：在本区里写下 `r1.soul_returned` 时不再自己跑 12 秒的天亮过渡（雨照样停），进区域时已是卯时（读档、截图预置）才直接摆成黎明；终章的 `EnvGrade` 按名字（kit 的 `skyDome`、`rain`、半球光）接管期间的颜色，不增删灯。环境贴图（`AreaDef.environment` 的函数形式）与环境声（卯时鸡鸣）仍随 flag 立即切换，终章过场需要时可以用 `ctx.ambience` 临时覆盖。（2）GDD §3.14 “只在玩家处于门卫室内时渲染”镜面：R1-world 另加“视线大致朝北（镜子所在的北墙，yaw ±100°）”——坐在椅子上看桌子、开场过场对着 CRT 时镜子在身后，不必每两帧多画一遍门卫室（无头测试里 newGame 的开场因此快不少）。代价：终章若有过场的固定机位在玩家朝南时拍到镜子，镜面会停在上一次渲染的画面。请 M3 确认这两条。
- 影响：无 flag 影响；终章观感与性能。regions 脚本无 blockedBy。
- 临时绕开：如上（`logic.ts` 的 `syncFrame`、`registerMirror`）。
- 状态：resolved（M3）：两条都确认并写进 ARCH §11.6。另给出正式耦合接口：`r1/layout.ts` 的 `R1_ENV_REFS`（`r1_hemi`/`r1_sky`/`r1_rain`，区域内部名），R1-world 在 build 里 `ctx.ref()` 登记（`world.ts`），终章 `EnvGrade` 改用 `ctx.getRef()`（`finale/stage.ts`），不再按对象名在对方子树里查找。

## Lessons
- 五个区域代理共用同一个 scratchpad 目录（会话级，不是代理级）：私用脚本与日志一律放自己的子目录（R1-world 用 `scratchpad/r1w/`），别起 `probe.mjs`、`myshots.mjs`、`shots-run1.log` 这类通用名字——R1-world 曾误覆盖别人的 `myshots.mjs`（已按调用方式重建，文件头有说明）。
- 门卫室这种净高 2.6m 的小屋里，第三人称相机被天花板压到 ~2.4m、俯仰顶到 −35° 下限，准星射线从桌沿上方 ~1.6m 掠过：桌上/桌下的低矮交互物要让拾取代理够到这条射线经过的高度，且用 priority 排好先后（别家的高代理会抢走聚焦，`interact` 报 `not_focusable {focused: …}`）。
- `ShotDef.view.replay`：玩家必须站在残影点 `startRadius`（2.5m）以内（引擎真的 dispatch 倒带），否则 `not_near_replay_point`；回放的棕绿调色把高光压暗，回放机位要把灯头或亮窗框得大一点才过“亮度 > 0.8 的像素 ≥ 0.5%”。昏暗的屋内镜子特写基本过不了这条，别拍。
- 雾 0.045 下 40m 外的楼会变成雾色（比天顶亮）的平板：远景用 `MeshBasicMaterial({ fog: false })` 画比天顶还暗的剪影，高度压在院子里看过去仰角 ≲ 20° 的地平线光带里；远处亮窗 HDR 1.5 左右，太亮会被 Bloom 吹成浮在天上的光球。
- kit `door().setOpen()` 最多开 95°；要让门扇贴墙，直接转 `door.leaf.children[0]`（合页节点）到 ~174°，并把门装在墙的内侧面（装在外侧面的话门扇会折进墙里）。
- `BoxGeometry` 顶面的贴图上沿朝 −z：桌上的本子要让坐在北边的人读正，得转 π。
- `boardSign` 灯箱的 `glow` 是 emissiveIntensity 本身（不乘 3.5）：近看 > ~1 就吹白、字看不清；0.5–0.85 字清楚、底子仍算高光。
- 截图机位别把玩家放进动态/静态碰撞体里（门扇、家具）：`shot()` 走 `goto` 的可达性检查，会 `unreachable`。
- 机器负载高（load 50+）时 harness 的 90 秒调用超时会让 `newGame()` 偶发 timeout，后面排队的调用跟着超时；单独重跑受影响的用例即可（R1-world 用 `scratchpad/r1w/cases.mjs <子串…>`）。
