# r1-finale：R1-finale 区域代理的需求与缺陷

> 唯一写入者：R1-finale 区域代理（ARCH §2.12、§15.6）。只追加。引擎维护者的结论写在 `docs/requests/m2-engine.md`。

## 1. GameApi 没有读照片记录（缩略图）的只读接口（片尾照片）
- 类型：接口需求
- 现象/需要什么：GDD §8.9 片尾依次放 `ph.film3`、`ph.menshen_2018`、`ph.huang_ir`、`ph.tape_face`、`ph.final`。最动人的做法是放玩家自己拍的那几张，但区域只拿得到 `GameApi`/`StateView`（`hasPhoto(id)` 只有真假），拿不到 `PhotoRecord.thumb`。用 `g.photo.award(id)` 对已有的关键照片“读”记录有副作用（发 `'photo'` 事件 → 界面飞缩略图、`save.request`、`tripod.consumeShot()`），不能这么用。需要 `GameApi.photo.record(id: PhotoId): Readonly<PhotoRecord> | null`（或 `StateView.photoRecord(id)`），只读、不发事件。
- 影响：GDD §11 步骤 58 的观感（片尾照片）；不影响任何 flag。regions 脚本无 blockedBy。
- 临时绕开：`finale/logic.ts` 在 R1 里监听 `'photo'` 事件记下缩略图（`ph.tape_face`、`ph.final` 都在 R1 拍，一般能拿到）；其余三张（R2/R3/R4 拍的）用 `finale/art.ts` 画好的卡片（同一构图的程序化插画）。接口加上后把 `ending.ts` 的 `ownThumb()` 换成它。
- 状态：resolved（M3）：`GameApi.photo.record(id): Readonly<PhotoRecord> | null`（`game/effects.ts`，实现 `GameState.photoRecord`），只读、不发事件；`finale/ending.ts` 的 `ownThumb()` 改用它，`finale/logic.ts` 监听 'photo' 记缩略图的绕开删除（R2/R3/R4 拍的三张也能用玩家自己的缩略图）。ARCH §6.3。

## 2. GameApi 读不到当前钟点（过场 OSD）
- 类型：接口需求
- 现象/需要什么：终章寅时的过场（吃馄饨 `cs.r1.fin_wonton`、合影后 `cs.r1.fin_soul`）用 CH1/CH2 固定机位，OSD 应是 `CH2 2026-08-28 周五 04:31:12` 这种“当前钟点起走”的样式。钟点只在 `ShichenSystem.clockText()/osdLine()` 里（内存、装饰），`GameApi.shichen` 只有 `override()`。需要 `GameApi.shichen.clock(): string`（'HH:MM:SS'，与 HUD 同源）或 `osdLine(channel)`。
- 影响：无 flag 影响；观感。regions 脚本无 blockedBy。
- 临时绕开：`cs.r1.fin_wonton` 的 OSD 只写日期（`CH2 2026-08-28 周五`）；`cs.r1.fin_soul` 从 04:57:31 起走（紧接着 `cs.r1.dawn` 的 04:58:00，与 HUD 的寅时钟点可能对不上，寅时钟点停在 04:59，所以不会出现“倒走”到 HUD 之前太多）。
- 状态：resolved（M3）：`GameApi.shichen.clock()`（'HH:MM:SS'，`ShichenSystem.clockSeconds`）与 `osdLine(ch)`（`game/effects.ts`、`game/shichen.ts`）；`finale/cutscenes.ts` 用 `osdLive()`：`cs.r1.fin_wonton` 的 CH2/CH1 从当前钟点起走，`cs.r1.fin_soul` 从当前钟点起走但起点不晚于 04:57:31（接下来 `cs.r1.dawn` 从 04:58:00 走，OSD 不倒走）。ARCH §6.3。

## 3. 跨代理协调：结局过场要接管 R1-world 的半球光、雾、夜空天穹与雨（ARCH §2.11 没有列出的耦合）
- 类型：文档矛盾
- 现象/需要什么：R1 的 8 盏实时灯由 R1-world 用满（r1-world.md #3），终章没有自己的灯。结局的“天亮”（`cs.r1.dawn`：OSD 04:58→05:12 的 12 秒里东边发白）、尾声的晨雾、片尾与南柯的远景都要改雾、半球光、天穹颜色，并藏起跟着相机走的雨与天穹。R1-world 在 `r1.soul_returned` 写入后自己跑一段 12 秒的天亮（`logic.ts` 的 `applySky`），而合影后的 `cs.r1.fin_soul`（老周回屋、趴桌）按 GDD P14 第 6 步还应是夜里，天亮要等 `cs.r1.dawn`。ARCH §2.11 的耦合方式（layout、flags、`ctx.getRef()`、`ctx.console()`、`ctx.addTalk()`）里没有“另一方的灯/雾/天穹”这一条。
- 影响：无 flag 影响；结局观感。regions 脚本无 blockedBy。
- 临时绕开：`finale/stage.ts` 的 `EnvGrade` 在结局期间（只在终章过场的 run 步骤里打开）每帧按名字找到 R1-world 的 `HemisphereLight`、`skyDome`（kit/nature 的 name）、`rain`（kit/rain 的 name）并覆盖颜色/强度/可见性（区域 update 按 world → finale 的顺序调用，所以终章最后写）。只改颜色与强度，不增删灯（灯数恒定）。请 M3 把这条耦合写进 ARCH §11.6 的分工表（例如 R1-world 以 `ctx.ref('r1.hemi'|'r1.sky'|'r1.rain', …)` 登记，终章用 `getRef` 取），或裁定由 R1-world 在 `r1.soul_returned && !r1.called_at_dawn` 期间不跑天亮。
- 状态：resolved（M3）：正式接口 `R1_ENV_REFS`（`r1/layout.ts`：`r1_hemi` 半球光、`r1_sky` 天穹、`r1_rain` 雨），R1-world 在 build 里 `ctx.ref()` 登记，终章 `EnvGrade`/`hideFollowers` 用 `ctx.getRef()`；同时确认 R1-world 在 `r1.soul_returned && !r1.called_at_dawn` 期间不跑天亮。写进 ARCH §11.6。

## 4. GDD 缺文本：GDD 没给原文、又必须有一句话的两处（待整合时校对）
- 类型：文档矛盾
- 现象/需要什么：（1）没装带时对 `r1.vcr` 按 E：GDD P12 只写“录像带架上‘8.30’那一格空着”（线索），没有反馈原文；现用“录像机里没有带子。架子上‘8.30’那一格空着。”（2）三脚架 OSD 行：GDD X4/§10.2 只写“OSD 显示倒计时”；现用 `CH1 2026-08-28 周五  定时 NN`。两句都在 `finale/text.ts` 的 `EXTRA` 里，请 M3 校对或补进 GDD。
- 影响：无。regions 脚本无 blockedBy。
- 临时绕开：如上。
- 状态：resolved（M3）：两句校对后原样收进 GDD——P12 错误反馈加“没装带时对 `r1.vcr` 按 E：录像机里没有带子。架子上‘8.30’那一格空着。”，§10.2 三脚架写明 OSD 行 `CH1 2026-08-28 周五  定时 NN`。

## 5. `PROPS.crt()` 的屏幕四周被前面板挡住，只剩中间一个八边形（kit 缺陷）
- 类型：引擎缺陷
- 现象/需要什么：`kit/props.ts` 的 `crt()`：前面板 `bx(g, 0.42, 0.33, 0.02, bezel, 0, 0.2, -0.205)` 的正面在本地 z = −0.215；屏幕 `PlaneGeometry(0.36, 0.27, 8, 6)` 放在 z = −0.207，只有中间鼓出来的部分（`0.012·(1 − 0.5·(x²+y²)) > 0.008`，即 x²+y² < 0.67 的椭圆，按 8×6 分段就是个八边形）跑到面板前面，四周都埋在面板后面。录像机面板与监控台面板里看到的 CRT 画面因此只剩中间一块八边形，录像带的 CH1|CH2 双分屏、OSD 的四角、ALARM 字样都被切掉一部分（复现：寅时 `use(r1.vcr, it.tape_830)`，截图看 CRT）。
- 修法建议：前面板改成中间开 0.36×0.27 口子的框（四条 `bx`），或屏幕整体往前挪到 z ≈ −0.218（鼓包仍朝外），`userData.screenCenter` 同步。R1-world 的 `booth.ts` 按 `screenCenter` 摆屏幕（把屏幕从 group 里拿出来单独 `ctx.add`），改完两边都对得上。
- 影响：GDD §11 步骤 47–49、53 的观感（P12 看带子、P13 照妖镜）；不影响判定（`pt.tape_face`/`pt.zhou_tunnel` 的主体是屏幕网格的包围盒）。regions 脚本无 blockedBy。
- 临时绕开：`finale/stage.ts` 的 `unhideCrtScreen()`：终章建造时从屏幕四角沿法线打一条 5cm 的短射线，角被挡住就把 `r1.crt` 屏幕网格沿法线往外挪 1.2cm（没被挡就不动，kit 或 R1-world 修好以后自动失效）。修好后删掉这个函数。
- 状态：resolved（M3）：kit `PROPS.crt()` 的前面板改成中间开 0.36×0.27 口子的框（`kit/props.ts`），`unhideCrtScreen()` 与它的调用已删除（`finale/stage.ts`、`finale/logic.ts`），R1-world 的机壳也改回按 kit 摆。

## 6. 跨代理协调：终章 CH1 的朝向与 layout 推定值不同；门卫室门扇、院门西扇会不会挡画面要随 R1-world 的门一起复核
- 类型：文档矛盾
- 现象/需要什么：GDD §3.1/§3.8/P14 的 CH1 是“门楣上的伙计，朝院门方向俯拍门口”，终章三脚架（X4）、合影、`cs.r1.dawn` 与结局都停在这台固定机位上。layout 的 `ch1Cam`（target (-2.9,0.9,21.9)、fov 60）俯得太陡、视场太窄，只看得见门口一小块地；终章改用 `finale/stage.ts` 的 `CH1_POSE`（位置 = layout 的 `ch1Cam.pos`，朝东南俯 24°、fov 66：老周站的 (-3.4,21.4) 连脚在画里、粉笔叉在他左手边，上缘是院门、街对面的楼与一线天，天亮时看得见东边发白）。M2 早期的截图里门卫室朝外开的门扇（门洞南侧 x −5…−4.1）挡住了老周的腿；按现在的 `CH1_POSE` 与 R1-world 现在的门，门扇已不在画里（截图：`shot.r1.fin_ch1_mao`）。
- 需要：M3 确认 CH1 的朝向以 `CH1_POSE` 为准（或把它写回 layout 的 `ch1Cam`）；R1-world 以后改门卫室门、院门的开法时，复看一次 `shot.r1.fin_ch1_mao` 与三脚架倒计时画面。
- 影响：GDD §11 步骤 56–58 的观感；不影响判定（三脚架只看身子到粉笔叉的距离与移动输入）。regions 脚本无 blockedBy。
- 临时绕开：如上（终章自带 `CH1_POSE`）。
- 状态：resolved（M3）：以 `CH1_POSE` 为准，写回 `r1/layout.ts` 的 `derived.ch1Cam`（target (-1.76,1.09,22.13)、fov 66），终章 `CH1_POSE = R1.derived.ch1Cam`；门的开法与“改门后复看 `shot.r1.fin_ch1_mao`”写进 ARCH §11.6。

## 7. 《送别》带尾奏的长版（M4 第一轮评审，叙事：《送别》撑不到片尾照片）
- 类型：接口需求
- 现象/需要什么：`songbie` 一遍约 55 秒（72 bpm、末两小节渐慢），土地领光出门时起奏，到片尾照片正好奏完。M4 R1 修复者在片尾照片段重起一遍 `{ music: 'songbie' }`（`finale/cutscenes.ts`），希望引擎另给一个带尾奏的长版（`music.ts`），片尾就不用重起。
- 影响：无（不影响判定）；regions 脚本无 blockedBy。
- 临时绕开：片尾照片段重起一遍《送别》（`AudioEngine.music` 同名重起时旧的 0.8 秒淡出）。
- 状态：wontfix（M4 整合）：片尾照片前是黑场 + 片名字卡，新起一遍正好是新的一段，听感自然；长版要改 `MusicCue`（冻结的联合类型）并按过场的游戏时间去对音频时钟，收益小、风险大。保留重起的写法。

## Lessons
- 五个区域代理同时跑 SwiftShader 时负载常在 40 以上：`shots.mjs` 的 `page.screenshot` 默认 30 秒超时会直接失败（与画面无关）。调机位时用本地复制的截图脚本（超时放宽）配一个临时的 getter 版 `ShotDef`（`preset`/`view` 写成 getter，读 `globalThis` 上的参数），同一个页面里连试多个机位、不必每次重新构建；交付前删掉。
- 区域代码不能 import `src/debug`（`check.mjs` 的 area-imports-debug），所以区域里登记不了 `registerSelftest`；也拿不到 `Game`（`window.__game` 只挂 API，不挂 game）。
- `shot()` 的玩家机位要求胶囊放得下：3m×3.5m 的门卫室里离墙至少 0.45m，否则返回 `unreachable`（截图脚本照样截下上一个画面，别被骗）。
- `MATERIALS.ghost` 中心的不透明度只有 0.2 左右：缩到 1:10 的小人、站在亮地面上时几乎看不见。做微缩场景（南柯的小槐安里）用不透明的 matcap，借 `createCrowd` 的几何体与 `instanceMatrix` 另建 `InstancedMesh` 并 `setColorAt` 上色。
- 夜景截图的“≥0.5% 像素亮度 > 0.8”：室外把钠灯灯芯、亮窗框进画面最稳；室内（门卫室只有 CRT 磷绿一盏灯）靠烛火这类 HDR 自发光 + 加法光晕。加法光晕要随相机距离缩放，否则特写（取景器 2×、0.9m）会糊成一大团盖住主体。
- kit 的 `PROPS.crt()` 前面板比屏幕靠前：用“从屏幕四角沿法线打短射线，被挡才挪”的办法绕开，别人修好以后自动失效，不会挪两次。
- 过场里要改别的代理的灯/雾/天穹时，只改颜色与强度（不增删灯、不改可见性以外的结构），并在每帧 `update` 里写（区域 update 按 world → finale 顺序调用，终章最后写）；同一 run 里别忘了自己也要还原或随区域卸载。
