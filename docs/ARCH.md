# 《天亮了，叫我》技术架构文档（ARCH）

> 适用版本：three `0.186.1`、@types/three `0.186.0`、vite `8.3.1`（rolldown）、TypeScript `7.0.2`（原生 tsc）、playwright `1.63.0`。
> 本文是 `docs/GDD.md`（最终设计）的**实现契约**。读者是：M1a 骨架代理、M1b 各引擎工作包代理（WP1–WP7）、M1c/M3 整合代理（M2 期间兼任引擎维护者）、M1d/M4 评审代理、M2 各区域代理（分工见 §15）。
> 代码标识符一律英文；游戏内文本一律简体中文；所有游戏 id 以 GDD §13 为准。

---

## 0. 定位、优先级与对 GDD 的覆盖

### 0.1 优先级

1. **玩法、文本、id、数值**：以 GDD 为准。本文不改任何谜题、flag、物品、文本。
2. **代码组织、接口签名、目录、命名、测试 API**：以本文为准。GDD 中出现的实现细节（路径、函数名）若与本文不同，按本文执行（见 0.2）。
3. 本文没写到、GDD 也没写到的：拥有该文件的引擎工作包（M1b）自行决定，但必须写进代码注释，并且不得破坏本文的公开接口（M1a 结束时冻结，见 §15.1）。区域代理（M2）遇到接口不够用或引擎缺陷时，**不得修改引擎文件**：能在自己目录里用私有 helper 绕开就绕开，并把需求或缺陷写进 `docs/requests/<区域>.md`（格式见 §15.6），由引擎维护者（M1c/M1d 的整合代理，M2 期间继续唯一拥有全部引擎文件，§2.12）在 M2 期间先进先出串行处理，条目 resolved 后区域代理去掉对应的 `blockedBy`；只涉及区域代码或跨区域协调的条目留给 M3 的整合代理。

### 0.2 对 GDD 实现细节的覆盖表

| GDD 中的写法 | 本文的写法 | 说明 |
|---|---|---|
| 区域（region）、`RegionId`、`defineRegion` | 区域（area）、`AreaId`、`defineArea` | 纯改名。区域 id 仍是 `r1` `r2` `r2_502` `r3` `r4` |
| `src/engine/` | `src/core/` `src/game/` `src/ui/` `src/fx/` `src/audio/` `src/rigs/` `src/kit/` `src/debug/` | 引擎拆成多个目录，见 §2 |
| `src/regions/r1/` | `src/areas/r1/`；`r2_502` 单独一个目录 `src/areas/r2_502/`（仍归 R2 代理） | |
| `src/regions/r1/dialogue.json` | `src/areas/r1/dialogue.ts`（TS 数据，受类型检查） | tsconfig 不开 `resolveJsonModule`，也不需要 |
| `window.__cam` | `window.__game`，同时挂别名 `window.__cam`（同一个对象） | 方法名沿用 GDD §3.15，另加别名，见 §12 |
| GDD §3.5 `PhotoTarget.region` 字段 | 去掉；归属区域由注册它的区域模块决定 | |
| GDD §3.5 `subjects[].anchor` | 明确为**主体对象的局部坐标偏移** | 默认取主体世界包围盒中心 |
| GDD §3.5 `context.console` | 增加可选 `jack?: boolean` | 照妖镜需要“视频线已插” |
| GDD §3.6 `actors[].rig` | 增加 `'crowd'`（实例化人群） | 1984 合影、2008 门厅、1997 剪彩 |
| GDD §3.5 空镜标题“按拍摄情境生成” | `captions` 的值可以是函数 `(c: PhotoContext, s: StateView) => string`（§6.8.3） | P12 按暂停时刻、P13 按频道 |
| GDD §3.14 镜面“贴图水平翻转后贴在镜面上” | 照搬 three `Reflector` 的投影纹理做法，**不翻转 UV**（§6.11） | 反射相机本身已经镜像，再翻一次就错了 |
| GDD §9.3“雨：单个 LineSegments” | 实例化的面向相机细长四边形，一次 draw call（§10.2 `rain()`） | 1px 线在 DPR>1 时几乎看不见 |
| GDD §9.3 画质“默认高” | 默认 `mid` 加动态分辨率（§13.2） | 集显 60fps |
| GDD §9.5“音频在第一次点击后才启动” | 第一次 `pointerdown` **或** `keydown` 时创建并解锁 `AudioContext`（§3.1） | 只用键盘的玩家也有声音 |
| GDD §3.15 `wait` 上限 30 秒 | `wait(sec)` 仍按游戏时间、单次上限 30 秒；API 的超时另按**真实时间**计（§12.2） | |
| GDD §3.3 M1、§3.4、§10.1：Esc 退出取景器/回放 | 指针锁定时 Esc 被浏览器用于解锁，页面压入 `mode.pause`，“继续”后回到原模式；仅在未锁定（`?nolock=1`、锁定不可用）时 Esc 走 `back`（§4.6、附录 A） | GDD 已在这三处注明；退出取景器用右键，退出回放用 F/右键 |
| GDD §12.2 里程碑 E0–E4、§12.5 并行开发契约 | 本文 §15：M1a–M4、WP1–WP7、区域代理 R1-world/R1-finale/R2/R3/R4，M2 期间另有 1 个引擎维护者 | 不单独做 E1 垂直切片；缺 id 写 `docs/requests/`，由整合代理（M2 期间为引擎维护者）补进 GDD §13 与 `ids.ts`（§0.3） |

### 0.3 本文新增的命名空间（不是 GDD 游戏 id，只在区域内部使用）

| 命名空间 | 形式 | 用途 |
|---|---|---|
| 对话 | `dlg.<areaId>.<snake>`，如 `dlg.r1.tudi_first` | 对话树 id，只能由该区域注册、该区域使用。GDD §13.12 点名的两个（`dlg.r1.bracket_confirm`、`dlg.r2.stairs`）同时登记在 `ids.ts` 的 `DLG` 常量里，其余由区域自行命名 |
| 过场 | `cs.<areaId>.<snake>`，如 `cs.r1.intro` | 过场脚本 id |
| 诱饵拍照目标 | `decoy.<areaId>.<snake>` | 只产出“空镜”并附专属标题（如底片第 1/2/4 格、镜子） |
| 截图机位 | `shot.<areaId>.<snake>` | `scripts/shots.mjs` 用 |
| 开发沙盒区域 | `dev` | 只在 `?debug=1&area=dev` 下可达，引擎自测用 |
| 区域临时状态键 | 不带点的 `snake_case`，如 `lamp_lit_1` | `ctx.setTemp()`/`s.temp()`（§11.2）：本区加载期间有效、不存档；不带点，所以不会被 `check.mjs` 当成游戏 id |

除上表外，**任何游戏 id（flag、物品、照片、目标、残影点、片段、交互物、NPC、说话人、文档、称呼、谜题、出生点、出入口）都必须来自 `src/data/ids.ts`**。区域代理缺 id 时不许自造，写进 `docs/requests/<区域>.md`，由整合代理补进 GDD §13 与 `ids.ts`。

---

## 1. 技术栈与全局约定

### 1.1 依赖与导入

- 只用 `three`（含 addons）。不引入其他运行时依赖（不要 cannon、不要 react、不要 GSAP）。
- 导入写法（已在本仓库用 TS 7 实测通过类型检查）：

```ts
import * as THREE from 'three';                        // Timer、PMREMGenerator、PCFShadowMap 等都在核心包
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
// fx/environment.ts（§8.3）原用 three/addons/environments/RoomEnvironment.js；M1c look-dev 换成自建的夜景环境场景，不再导入
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
```

- **addons 路径必须带 `.js` 后缀**；`three/addons/*` 映射到 `three/examples/jsm/*`（three 与 @types/three 的 `exports` 都有此映射）。
- 仅类型导入用 `import type`（`isolatedModules: true`）。
- 着色器写成 TS 模板字符串（`/* glsl */ \`...\``），不使用 `?raw` 导入。

### 1.2 资源

- **零外部资源文件**：没有 glTF、没有图片、没有音频文件、没有字体文件。几何体程序化生成，贴图用 CanvasTexture 绘制，声音用 WebAudio 合成。
- 中文字体使用系统 CJK 字体栈（GDD §3.14）：`"Noto Sans SC","Noto Sans CJK SC","Source Han Sans SC","PingFang SC","Microsoft YaHei","WenQuanYi Zen Hei",sans-serif`。测试机已装 WenQuanYi Zen Hei。

### 1.3 坐标、单位、朝向

- 米、秒、角度制（接口里的角度一律用**度**，内部换算弧度）。y 轴向上，+x 东，-z 北（与 GDD §4 一致）。
- **yaw 约定**：`yaw = 0` 面朝北（-z），`90` 面朝东（+x），`180` 面朝南（+z），`270` 面朝西。换算：`object.rotation.y = -yaw * DEG2RAD`；前向量 `(sin(yawRad), 0, -cos(yawRad))`。`src/core/math.ts` 提供 `yawToRotY()`、`forwardFromYaw()`、`yawTowards(from, to)`。
- **pitch**：度，正值抬头。
- 位置元组类型 `V3 = readonly [number, number, number]`；二维地面点 `XZ = readonly [number, number]`。

### 1.4 时间

- **所有玩法计时一律用游戏时间**（主循环传入的 `dt`，已乘时间倍率）。禁止用 `setTimeout`/`setInterval`/CSS transition 的结束事件来推进玩法（UI 纯装饰动画除外）。原因：调试 API 的 `wait(sec)` 通过“无渲染快进模拟”推进游戏时间（§3.4），只有 dt 驱动的逻辑会被正确快进。
- 区域内计时用 `ctx.after(sec, fn)` / `ctx.every(sec, fn)`（卸载时自动清除）。
- **冻结**：栈顶模式 `freezesWorld` 为真时（暂停、相册与挑选器、巡夜本，§4.6），游戏时间不前进，所有系统与区域计时都停住，只更新 UI 与渲染。
- **锁步（lockstep）**：`?lockstep=1`（测试 harness 默认带上）时，rAF 只负责渲染，模拟**只**在 `Game.advance()` 里推进；两次调试 API 调用之间游戏时间不走，保证测试可复现（§3.2、§12.2）。
- 例外：调试 API 的超时一律按**真实时间**计（§12.2），因为它防的是脚本卡死，不是玩法。

### 1.5 随机

- 构建期随机（窗户亮灭、小广告位置、树叶）一律用 `src/kit/rng.ts` 的种子随机 `rng(seed)`，保证截图可复现。`Math.random()` 只允许用于纯视觉的每帧抖动（颗粒、雨滴、闪烁）。

---

## 2. 目录结构与文件职责

### 2.1 总览

```
camhead-man/
├─ index.html                 入口：<title>天亮了，叫我</title>、#app 容器、body 黑底；加载 /src/main.ts
├─ vite.config.ts             （可选，不参与 tsc）build.chunkSizeWarningLimit=4000；不需要其他配置
├─ package.json  tsconfig.json  AGENTS.md
├─ docs/GDD.md  docs/ARCH.md
├─ docs/requests/             需求与缺陷（§15.6）：engine-m1a.md、engine-wp1.md…engine-wp7.md（M1b，每个 WP 一个文件）；
│                             <区域>.md（M2，每区一个文件）；m2-engine.md（M2 引擎维护者的处理结论）
├─ scripts/
│  ├─ lib/harness.mjs         启动 vite preview + 无头 Chromium（SwiftShader 参数）；call()/expect() 工具
│  ├─ lib/presets.mjs         单区域测试的前置状态（§15.4）
│  ├─ smoke.mjs               （WP7 改写）启动游戏→标题→新游戏→无报错→WebGL2
│  ├─ core.mjs                引擎验收：在 dev 沙盒里逐个调用 API 动作；自动发现并运行 selftest/*.mjs
│  ├─ selftest/wp1.mjs … wp7.mjs   各引擎工作包自己的最小自测（各 WP 拥有自己的那一个）
│  ├─ input.mjs               真实键鼠输入测试（Playwright 键盘/鼠标，不走 API 捷径，§12.4）
│  ├─ walkthrough.mjs         GDD §11 完整通关（WP7 写好全部步骤，M3 跑通）
│  ├─ regions/r1.mjs r1_finale.mjs r2.mjs r3.mjs r4.mjs   单区域测试（r2.mjs 覆盖 r2 与 r2_502）
│  ├─ shots.mjs               各区域截图与亮度验收（视觉评审）
│  ├─ roundtrip.mjs           （M3，integrator）跨区域往返资源检查：r1 ↔ 各区域 × 5，geometries/textures 回到基线（§13.3）
│  └─ check.mjs               静态检查：跨区域 import、区域目录禁用 API、未注册 id 字面量、残留 notImplemented
└─ src/
   ├─ main.ts                 new Game(document.getElementById('app')!).boot()
   ├─ core/                   引擎基础设施（与玩法无关）
   ├─ data/                   id 注册表与共享静态数据
   ├─ game/                   玩法系统（状态、交互、拍照、回放、录像机……）
   │  └─ modes/               各模式的 ModeHandler
   ├─ ui/                     DOM 界面
   ├─ fx/                     后期、共享材质、红外、CRT 屏幕材质、RenderTarget 池
   ├─ rigs/                   角色模型：人身、摄像头头部、各 NPC 造型、纸人、人群
   ├─ kit/                    程序化建造工具库（文字贴图、建筑、窗、门、招牌、灯、雨……）
   ├─ audio/                  WebAudio 合成
   ├─ debug/                  window.__game、截图支持、性能面板
   └─ areas/
      ├─ index.ts             AREAS 注册表（引擎所有）
      ├─ dev/                 引擎沙盒（index.ts 合并各 WP 的 dev/wpN.ts 测试布置与整合代理的 dev/m1c.ts）
      ├─ r1/                  index.ts、layout.ts 由 M1a 写好，此后归整合代理（M2 期间为引擎维护者，区域代理只读）；其余归 R1-world；finale/ 归 R1-finale
      ├─ r2/  r2_502/  r3/  r4/     区域目录（区域代理所有）
```

### 2.2 `src/core/`

| 文件 | 职责 |
|---|---|
| `types.ts` | 基础类型：`V3`、`XZ`、`AreaId`、`AreaKey`、`ModeId`、`LensMode`、`ZoomLevel`、`Shichen`、`Pose`、`CameraPose`、`ApiResult`、`Verb` |
| `events.ts` | 强类型事件总线 `EventBus<GameEvents>` 与 `GameEvents` 定义 |
| `game.ts` | `Game`：启动、主循环、`step()`、`advance()`、新游戏/读档、子系统装配 |
| `input.ts` | `InputManager`：键盘、鼠标、滚轮、指针锁定策略（§4.6）→ `Button` 事件与移动/视角轴；捕获阶段拦截浏览器默认按键 |
| `actions.ts` | `Action` 联合类型；`KEYMAP`（模式 × 按键 → Action，照抄 GDD §10.1 与附录 A） |
| `modes.ts` | `ModeStack`、`ModeHandler` 接口、临时模式判定、`freezesWorld` 判定 |
| `area.ts` | `defineArea()`、`AreaDef`/`AreaPart` 等区域契约类型、`mergeAreaParts()`、`AreaManager`（加载/卸载/切换/出生点/传送/出入口图寻路） |
| `areaContext.ts` | `AreaContext` 实现：场景挂载、注册表、资源追踪、定时器、事件订阅自动解绑、区域临时状态 |
| `render.ts` | 创建 `WebGLRenderer`；`RenderPipeline`（签名见 §4.7.2）：每帧调度辅助 RT（镜面、CH1/CH2、录像带，经 `AuxFeed`）与主合成；画质档；尺寸、像素比、动态分辨率；context lost/restored |
| `layers.ts` | `LAYER` 常量（GDD §3.14）、`setLayerRecursive()`（跳过灯）、`layerMaskFor()` |
| `cameras.ts` | `CameraRig`：第三人称/取景器/固定机位/拍照相机，第三人称避障，变焦，窄视口时的视场换算 |
| `collision.ts` | `CollisionWorld`（Octree + Capsule + 动态碰撞体）；`ColliderBuilder`（box/wall/floor/mesh/dynamic）；连通性栅格 |
| `player.ts` | `PlayerController`：胶囊移动、重力贴地、朝向、传送、`lookAtPoint()`、`walkTo()`（调试 `walk()` 用） |
| `triggers.ts` | `TriggerSystem`：AABB 触发体积、出入口触发、出生点距离断言 |
| `timers.ts` | `GameTimers`：基于游戏时间的 after/every |
| `disposer.ts` | `Disposer`：追踪 geometry/material/texture/RT，区域卸载时释放 |
| `url.ts` | URL 参数：`new` `debug` `test` `lockstep` `nolock` `quality` `area` `spawn` `mute`（M4 补写：`slow`，见 §15.7.1） |
| `math.ts` | yaw 换算、插值、`parseTc('03:14:05')`、`formatTc()`、角度差、平面镜像 `reflectPoint()` |
| `log.ts` | `devAssert()`、`devWarn()`（生产构建里变成空操作）；`notImplemented(what): never`（M1a 占位用，`check.mjs` 统计残留） |

### 2.3 `src/data/`（引擎所有；区域只读）

| 文件 | 内容 |
|---|---|
| `ids.ts` | GDD §13 的全部 id：`F`（flags）、`IT`、`PH`、`PT`、`RD`、`RP`、`SEG`、`AREA`、`SPAWN`、`EXIT`、`NPC`、`SPK`、`GHOST`、`RIG`、`OBJ`（交互物，含 `r3.hole_00`–`99` 生成式）、`DOC`、`NAME`、`PZ`、`MODE`、`LAYER_ID`、`SAVE`、`SETTING`、`MAT`、`DLG`（GDD §13.12 点名的对话）；以及对应的联合类型 `FlagId`、`ItemId`、`PhotoId`…（见 §4.2） |
| `palette.ts` | `PALETTE`（GDD §9.1，全部 20 色）、`IR_RAMP`（5 色） |
| `items.ts` | `ITEMS: Record<ItemId, ItemMeta>`：名称、说明、关联文档（`readDoc` 用它判断“随身文档”）、用过后的显示名（如 `it.film` →“底片（已冲）”） |
| `photos.ts` | `PHOTO_META: Record<KeyPhotoId, PhotoMeta>`：标题（GDD §7.2）、是否关键、是否实物、是否旧照（`ph.old_1`–`6`） |
| `names.ts` | `NAMES`：称呼、显示文字、收录 flag、来源说明（GDD §3.11） |
| `speakers.ts` | 说话人显示名：`npc.tudi`→“土地”、`spk.yuchi`→“尉迟恭”、`spk.narrator`→“”（旁白用斜体）、`pc.huoji`→“伙计”（只闪 REC） |
| `time.ts` | 时辰钟点表（起点 23:40/01:05/03:05，停点 00:59/02:59/04:59，每分钟游戏秒数 子时 20、丑寅 10；卯时 HUD 在 05:00 切换；结局加速钟 04:58→05:12 用时 12 秒，GDD §3.10）、OSD 日期规则、录像带时间轴常量、索引点、双分屏起点 02:51:00 |
| `render.ts` | `LIGHT_SCALE`、`QUALITY` 三档、`BUDGET` 硬上限、look-dev 冻结的曝光与 Bloom 阈值 |
| `strings.ts` | 引擎通用文本：操作提示、通用失败原因、空镜默认标题、菜单文字、载入中、启动失败页、存档损坏提示 |

### 2.4 `src/game/`

| 文件 | 职责 |
|---|---|
| `state.ts` | `GameState`（flags、物品、照片、线索、seen）与只读视图 `StateView`；单调写入校验 |
| `expr.ts` | `Cond` 编译：FlagExpr 字符串解析器 + 注册表校验 |
| `effects.ts` | `Effect` 联合类型、`E` 构造器、`EffectRunner`（可重入、settle 与取消语义，§6.3）、`GameApi` 实现 |
| `save.ts` | `SaveSystem`：槽位、延迟存档、版本号、读档校验、结局期间暂停落盘、通关标记 |
| `settings.ts` | `Settings` 读写（localStorage `camhead-man.settings`） |
| `shichen.ts` | 时辰推导、HUD 钟点、时辰过场 |
| `interaction.ts` | `InteractionSystem`：聚焦、角标、`activate()` 唯一入口、动作菜单/挑选器流程（`mode.album` 的 pick 参数） |
| `npc.ts` | `NpcSystem`：站位由 flags 推导、阴物常显、回放期间让位、跟随 NPC 的灯 |
| `viewfinder.ts` | `ViewfinderSystem`：镜头（常光/红外）、变焦档、温度读数（高清贴图与 viewVariant 的切换在 `core/areaContext.ts` 的 `updateViews()`，§6.8.1） |
| `photo.ts` | `PhotoSystem`：拍照判定、空镜、缩略图、`award()` |
| `read.ts` | `ReadSystem`：读字目标 `rd.*`（含镜中虚像判定、跟随 NPC 的目标） |
| `replay.ts` | `ReplaySystem`：残影点、片段播放、人影插值、`hideWorld`、现世 NPC 让位、onComplete |
| `vcr.ts` | `VcrSystem`：M6 录像机；独立的 `tapeScene`（2023 年门岗，CH1/CH2 双分屏） |
| `cctv.ts` | `ConsoleSystem`：M7 监控台、频道源、视频线、照妖镜、五路分屏布局 |
| `crt.ts` | `CrtScreenController`：同一块 CRT 屏幕在录像机/监控台/待机之间切换内容 |
| `mirror.ts` | `MirrorSystem`：Reflector 式反射相机 RT 或预制贴图；镜面圆盘几何（读字判定用） |
| `tripod.ts` | `TripodSystem`：X4 三脚架 + X2 长曝光 |
| `dialogue.ts` | `DialogueSystem`：数据驱动对话树 |
| `cutscene.ts` | `CutsceneSystem`：步骤脚本 |
| `panels.ts` | 密码转轮锁、称呼面板的逻辑 |
| `journal.ts` | 巡夜本：新页浮现、称呼表、已知线索、“树底下 n/6”；文档注册表；文档视图（取景器中显褪字） |
| `hints.ts` | `HintSystem`：当前谜题、三级提示、追加提示（南柯接在 P14 后面）、空闲闪烁 |
| `modes/*.ts` | 每个 `mode.*` 一个 `ModeHandler`：`explore` `viewfinder` `replay` `panelVcr` `panelConsole` `panelCode` `panelNaming` `dialogue` `album`（含动作菜单与挑选器） `journal` `tripod` `cutscene` `pause` |

### 2.5 `src/ui/`（纯 DOM + CSS，无框架）

`ui.ts`（根与分层）、`styles.ts`（CSS 文本、字体栈、调色板变量）、`hud.ts`（时辰钟、REC 点、交互角标、字幕与 toast）、`viewfinderHud.ts`（4:3 框、OSD、准星、倍率条、镜头图标、温度读数、色标、“▶ 残影 · R”）、`replayHud.ts`、`dialogueBox.ts`、`actionMenu.ts`（`mode.album` 的动作菜单子状态：1 交谈/查看、2 出示…/使用…）、`album.ts`（相册与物品栏，兼作挑选器）、`journal.ts`、`docReader.ts`（取景器中打开时带扫描线与 OSD，并显出褪字）、`codePanel.ts`、`namingPanel.ts`、`vcrPanel.ts`、`consolePanel.ts`、`tripodHud.ts`、`readOverlay.ts`（读字覆盖层，镜像字用 `scaleX(-1)`）、`menus.ts`（标题、暂停、设置、第三方许可；**没有**确认框，游戏内确认一律是强制对话）、`fade.ts`（淡黑、白闪、时辰过场字样、“载入中…”）、`bootError.ts`（启动失败页：不支持 WebGL2、启动异常）、`pointerGate.ts`（“点击继续”遮罩，指针锁定被意外解除时显示）。

### 2.6 `src/fx/`

`post.ts`（`PostPipeline`）、`cameraFxShader.ts`（合并的 ShaderPass：色调映射 + sRGB 编码 + 全部显示空间效果，取代 OutputPass）、`presets.ts`（`POST_PRESETS`）、`materials.ts`（`MATERIALS` 共享材质库）、`ghostMaterials.ts`（`mat.ghost`、`mat.replay`、`mat.paper_glow`）、`ir.ts`（`IrRenderer`，即 `mat.ir_override` 的实现）、`crtScreen.ts`（CRT 屏幕 ShaderMaterial，含五路分屏布局）、`feeds.ts`（`acquireFeed()`：RenderTarget 池与乒乓缓冲；“看得见自己屏幕的 feed”规则，签名见 §8.5）、`environment.ts`（程序化夜景环境 → PMREM 环境贴图，按区域着色缓存；M1c look-dev 前是 RoomEnvironment）、`warmup.ts`（`warmupArea()`：进区域时把红外、后期变体、回放人影往 1×1 RT 各渲一帧，预编译着色器，签名见 §8.5）。

### 2.7 `src/rigs/`

`humanoid.ts`（程序化人身骨架与行走）、`poses.ts`（8 种关键姿势）、`cameraHead.ts`（主角摄像头头部、`PC_DIMS` 高度常量）、`player.ts`（主角整体模型）、`characters.ts`（土地、王奶奶、陆师傅、黄三爷（戴面具时复用纸扎摊主外形）、老周（回放里脸上叠雪花）、建国、拆迁工人剪影、回放人影通用体）、`paper.ts`（`rig.paper` 纸人与实例化纸人，二者外形一致）、`crowd.ts`（实例化人群）、`accessories.ts`（帽子、发髻、竹篮、拐杖灯笼、搪瓷缸、双反相机、尾巴、纸面具、脸部雪花遮罩……）、`blobShadow.ts`。

### 2.8 `src/kit/`

`rng.ts`、`text.ts`（`makeTextTexture()`、字体检测）、`canvas.ts`（通用 Canvas 绘制与做旧）、`geom.ts`（基础网格快捷函数、合并）、`building.ts`、`windows.ts`、`doors.ts`、`stairs.ts`、`signs.ts`、`lamps.ts`（含湿地竖向光带贴花）、`rain.ts`（实例化雨丝）、`props.ts`（常用道具）、`nature.ts`（槐树、梧桐、灌木）、`instancing.ts`、`residue.ts`（残影点雪花旋涡、红外冷迹、阴物湿脚印贴花）。

### 2.9 `src/audio/`

`engine.ts`（`AudioEngine`、总线、解锁）、`synth.ts`（`SynthKit` 合成原语）、`sfx.ts`（`SfxCue` 实现）、`ambience.ts`（环境声预设）、`music.ts`（D–E–A 主动机、《送别》八音盒、二胡变奏）、`voice.ts`（对话底子的含糊人声）。

### 2.10 `src/debug/`

`api.ts`（`window.__game`/`window.__cam`，含锁步与 settle 等待）、`shots.ts`（截图机位）、`overlay.ts`（`?debug=1` 时的 FPS/drawcall/灯数面板）、`selftest.ts`（`registerSelftest(name, fn)` 与 `__game.selftest(name)`，仅 `?debug=1`：各 WP 在自己的 `src/areas/dev/wpN.ts` 里登记页面内自测函数，`scripts/selftest/wpN.mjs` 调用它们）、`fidelity.ts`（调试 API 的“真人路径”检查：`interact` 的视线与聚焦检查、`aimAt` 的俯仰钳制、`walk()`；出入口图寻路与连通性栅格调用 core 的 `areas.route()`、`collision.reachable()`，§4.5、§12.3）。

### 2.11 区域目录（每个区域相同的推荐布局）

```
src/areas/r3/
├─ index.ts        export default defineArea({...})：组装 spawns/exits/静态数据/build/钩子
├─ build/          场景构建，自由拆分（street.ts、shop.ts、studio.ts、darkroom.ts…）
├─ logic.ts        交互物、触发器、NPC、密码锁/称呼面板、区域 update
├─ photo.ts        PhotoTargetDef / ReadTargetDef / 诱饵
├─ replay.ts       ReplayPointDef 与 ReplaySegmentDef 关键帧数据
├─ dialogue.ts     本区全部对话树（dlg.r3.*）                    ← 区域文本数据文件
├─ text.ts         文档全文、反馈文本、提示文本、巡夜本新页、过场字幕 ← 区域文本数据文件
├─ puzzles.ts      本区 PuzzleDef（条件 + 三级提示引用 text.ts）
├─ audio.ts        环境声配置
└─ shots.ts        截图机位
```

**R1 拆成两个区域代理**（§15.4）。`src/areas/r1/` 的布局：

```
src/areas/r1/
├─ index.ts        M1a 写好并冻结：defineArea(mergeAreaParts(base, [world, finale]))，base = spawns/exits/post
│                  （ambience、environment 由 R1-world 的 world.ts 提供；finale 只在过场里用 ctx.ambience 临时切换）
├─ layout.ts       M1a 写好并冻结：GDD §4.1 的全部坐标常量（门卫室、桌子、CRT、录像机、支架、镜子、粉笔叉、残影点……）
├─ world.ts        R1-world 的入口：export default { …AreaPart }
├─ build/ logic.ts photo.ts replay.ts dialogue.ts text.ts puzzles.ts audio.ts shots.ts   R1-world 自由组织
└─ finale/
   ├─ index.ts     R1-finale 的入口：export default { interactables, dialogues, cutscenes, puzzles, build, … } satisfies AreaPart
   └─ …            R1-finale 自由组织
```

两者只通过 `layout.ts`、flags/物品/照片、`ctx.getRef()` 登记的场景对象（如 `r1.desk`、`r1.crt`、`r1.vcr` 的网格由 R1-world 建造并 `ctx.ref()` 登记）、可合并的配置（`ctx.console()` 分两次提供字段，各自只提供自己那一半，§6.11、§11.2）以及 `ctx.addTalk()`（向另一方的 NPC 追加对话项；对方尚未登记时先排队，§6.6）耦合，**互不 import**（只有冻结的 `r1/index.ts` 同时 import 二者）。

### 2.12 文件所有权（并行开发的硬规则）

| 路径 | M1a（1 个代理） | M1b（WP1–WP7 并行） | M1c/M1d | M2（区域并行） | M3/M4 |
|---|---|---|---|---|---|
| `src/data/*`、`src/core/types.ts` `events.ts` `math.ts` | 骨架代理写全量 | **冻结**（只读） | 整合代理 | 引擎维护者（整合代理） | 整合代理 |
| §2.2–§2.10 列出的其余每个引擎文件（含 `core/url.ts`、`core/log.ts`） | 骨架代理写“只有公开签名”的模块（`log.ts` 的 `notImplemented`/`devAssert` 必须可用） | 拥有它的那个 WP（清单见 §15.2） | 整合代理 | 引擎维护者（整合代理；区域代理只读） | 整合代理 |
| `src/main.ts` `index.html` `package.json` | 骨架代理 | WP1（`main.ts`、`index.html`）；`package.json` 冻结 | 整合代理 | 引擎维护者（整合代理） | 整合代理 |
| `vite.config.ts` `tsconfig.json` `.gitignore` | 骨架代理 | 冻结 | 整合代理 | 引擎维护者（整合代理） | 整合代理 |
| `src/areas/index.ts`、`src/areas/r1/index.ts`、`src/areas/r1/layout.ts`、`src/areas/dev/index.ts` | 骨架代理 | 冻结 | 整合代理 | 引擎维护者（整合代理） | 整合代理 |
| `src/areas/dev/base.ts`、`src/areas/dev/wpN.ts`、`src/areas/dev/m1c.ts`（M1c 新增，owner integrator：跨 WP 接缝的夹具与页面内自测，`scripts/selftest/m1c.mjs` 调用）、`src/areas/dev/m1d.ts`（M1d 新增，owner integrator：评审修复的回归自测，`scripts/selftest/m1d.mjs` 调用） | 骨架代理写占位（`base.ts` 导出 `DEV_BASE: AreaBase`——区域头部 id/name/spawns/exits/post，§11.2；`wpN.ts` 导出空的 `AreaPart`） | WP7（`base.ts`）、WP N（`wpN.ts`） | 整合代理 | 引擎维护者（整合代理） | 整合代理 |
| `src/areas/r1/`（除上面两个文件与 `finale/`） | 骨架代理写占位 | — | 整合代理（只修占位） | R1-world | 整合代理；M4 回派期间归对应区域代理，整合代理在回派结束前不改该目录 |
| `src/areas/r1/finale/` | 骨架代理写占位 | — | 同上 | R1-finale | 同上 |
| `src/areas/r2/` + `src/areas/r2_502/` | 骨架代理写占位 | — | 同上 | R2 | 同上 |
| `src/areas/r3/`、`src/areas/r4/` | 骨架代理写占位 | — | 同上 | R3、R4 | 同上 |
| `scripts/regions/<id>.mjs`（`r1` `r1_finale` `r2` `r3` `r4`） | — | WP7 写骨架 | 整合代理 | 对应区域代理 | 同上 |
| `scripts/selftest/wpN.mjs` | — | WP N | 整合代理 | 引擎维护者（整合代理） | 整合代理 |
| `scripts/lib/` `smoke.mjs` `core.mjs` `input.mjs` `walkthrough.mjs` `shots.mjs` `check.mjs` | — | WP7 | 整合代理 | 引擎维护者（整合代理） | 整合代理 |
| `docs/requests/engine-m1a.md` | 骨架代理建文件并写“M1a 变更记录” | 冻结 | 整合代理处理并标注结论 | 引擎维护者 | 整合代理 |
| `docs/requests/engine-wpN.md`（`engine-wp1.md`…`engine-wp7.md`） | 骨架代理建七个空文件（带 §15.6 的格式说明） | WP N（只追加自己的那一个） | 整合代理逐个处理并标注结论 | 引擎维护者 | 整合代理 |
| `docs/requests/<区域>.md`（`r1-world` `r1-finale` `r2` `r3` `r4`） | — | — | — | 对应区域代理（只追加） | 整合代理处理并标注结论；M4 回派期间归对应区域代理 |
| `docs/requests/m2-engine.md` | — | — | 整合代理建空文件 | 引擎维护者（为各区域条目写结论，§15.4） | 整合代理 |
| `docs/GDD.md` | 只读 | 冻结 | 整合代理（只补 §13 的 id、修已裁定的矛盾） | 引擎维护者（只补 §13 的 id） | 整合代理 |
| `docs/ARCH.md` | 骨架代理（只改偏离之处） | 冻结 | 整合代理 | 引擎维护者（改公开签名时同步） | 整合代理 |
| `AGENTS.md` | 骨架代理（在 `## Lessons` 末尾追加） | 冻结（各 WP 的 Lessons 写进最终回复与 `engine-wpN.md` 末尾的 `## Lessons` 小节） | 整合代理（追加，并收录 M1b 各 WP 的 Lessons） | 引擎维护者（追加，并收录各区域 requests 文件末尾的 Lessons） | 整合代理（M4 回派的区域代理照 M2 的写法） |

- 同一时刻每个文件只有一个拥有者；不是自己的文件一律只读。M1b 各 WP 之间**只通过 M1a 冻结的签名互相调用**，不得为了方便去改别人的文件；签名确实不够用时，写进自己的 `docs/requests/engine-wpN.md`，M1c 由整合者逐个处理。
- **引擎维护者**：M1c/M1d 的整合代理在 M2 期间继续**唯一**拥有全部引擎文件（上表“引擎维护者”各行），与 5 个区域代理同时工作，但自己串行处理 `docs/requests/*.md` 的 open 条目（§15.4）。区域代理对这些文件只读。
- 区域代理**只能 import**：`src/core`、`src/game`、`src/ui`（只用公开类型）、`src/fx`、`src/rigs`、`src/kit`、`src/audio`、`src/data`（M1d：另可 `import type` 自 `src/debug/shots`，截图机位类型；推荐从 `core/area` 取再导出的 `ShotDef`），以及**自己目录内**的文件（R1-world 与 R1-finale 都可以读 `r1/layout.ts`，但互不 import）。**禁止 import 其他区域目录**（`scripts/check.mjs` 会检查）。区域之间只通过 flags、物品、照片耦合（§11.6）。

### 2.13 源码约定与导出位置（M1a 补写，冻结）

- **owner 注释**：`src/` 下每个 `.ts` 文件第一行恰好是 `// owner: <TOKEN>`（TOKEN ∈ `WP1`…`WP7`、`R1-world`、`R1-finale`、`R2`、`R3`、`R4`、`integrator`），说明写在第二行起。`integrator` = §2.12 表里 M1a 写全量、此后归整合代理/引擎维护者的文件（`src/data/*`、`core/types.ts` `events.ts` `math.ts`、`areas/index.ts`、`r1/index.ts`、`r1/layout.ts`、`dev/index.ts`）。`check.mjs --stubs` 按这个 TOKEN 分组。
- **“dev 下”**：本文所有“dev 下抛错/断言”都指 `core/log.ts` 的 `DEV_CHECKS` 为真——vite dev 服务器，**或** URL 带 `?debug=1` / `?test=1`（测试对生产构建跑，§12.1）。`devAssert(cond, msg)`、`devWarn(...)` 在 `DEV_CHECKS` 为假时是空操作；`notImplemented(what): never` 抛 `NotImplementedError`。
- **M1a 已真实实现、M1b 可直接依赖的函数**（其余导出都是占位：读属性给默认值、方法 `throw notImplemented('Class.method')`）：`core/types.ts` `events.ts`（`EventBus`）`log.ts` `math.ts` 全部；`core/layers.ts` 全部；`core/url.ts` 的 `parseUrl`；`core/render.ts` 的 `NoWebGL2Error`；`core/area.ts` 的 `defineArea`、`mergeAreaParts`；`game/effects.ts` 的 `E`；`game/dialogue.ts` 的 `defineDialogues`、`seq`；`game/shichen.ts` 的 `deriveShichen`；`fx/ir.ts` 的 `IrRenderer.tempOf`；`kit/rng.ts` 全部；`ui/bootError.ts` 的 `showBootError`（最小版）；`debug/selftest.ts` 全部；`src/data/*` 全部。
- **`core/math.ts`**（M1a）：`DEG2RAD` `RAD2DEG`；`yawToRotY(yaw)` `rotYToYaw(rotY)` `forwardFromYaw(yaw, target?)` `dirFromYawPitch(yaw, pitch, target?)` `yawTowards(from, to)` `pitchTowards(from, to)`（from/to 为 `V3 | THREE.Vector3`）；`normYaw` `angleDiff(a, b)`（b−a，(-180,180]）`lerpAngle`；`clamp` `clamp01` `lerp` `invLerp` `smoothstep` `damp(cur, target, lambda, dt)` `approach`；`asTuple` `toVec3` `fromVec3` `dist3` `distXZ`；`parseTc('HH:MM[:SS]')` → 当日秒数、`formatTc(sec, { seconds? })` → 'HH:MM:SS'（录像带秒用 `data/time.ts` 的 `tapeSec`/`tapeClock`）；`reflectPoint(p, planePoint, planeNormal, target?)` `signedDistanceToPlane` `segmentPlaneIntersect(a, b, planePoint, planeNormal, target?)`（镜中读字的交点）；带 `target` 的函数都允许 `target` 与输入是同一个向量（就地调用，如 `reflectPoint(v, C, n, v)`）。
- **`core/url.ts`**（M1a）：`export interface UrlOptions { newGame; debug; test; lockstep; nolock; quality: QualityLevel | null; area: AreaKey | null; spawn: string | null; mute }`（lockstep 只在 test 下为真；area/spawn 只在 debug 下有值）；`export function parseUrl(search?: string): UrlOptions`。
- **类型所在文件**（本文代码块未写文件名的，以此为准）：`Cond`→`game/expr.ts`；`StateView` `ItemEntry` `PhotoRecord`→`game/state.ts`；`Effect` `E` `Handler` `RunOutcome` `RunScope` `GameApi`→`game/effects.ts`；`SaveDataV1` `SaveReadResult`→`game/save.ts`；`Settings`→`game/settings.ts`；`Dyn` `ViewReq` `LensReq` `TalkEntry` `InteractableDef` `OfferTable` `InteractableHandle` `InteractableStatus` `AlbumArg`→`game/interaction.ts`；`NpcDef` `NpcHandle`→`game/npc.ts`；`PhotoTargetDef` `Caption` `PhotoContextReq` `PhotoContext` `PhotoFail` `PhotoDecoyDef`→`game/photo.ts`；`ReadTargetDef`→`game/read.ts`；`ReplayPointDef` `ReplayActorKey` `ReplaySegmentDef`→`game/replay.ts`；`TapeTrack` `TapeKit` `VcrConfig`→`game/vcr.ts`；`ChannelSource` `ConsoleConfig` `CrtLayout`→`game/cctv.ts`；`MirrorDef`→`game/mirror.ts`；`TripodConfig`→`game/tripod.ts`；`DText` `DNode` `DOption` `DialogueDef`→`game/dialogue.ts`；`CutStep` `CutsceneDef`→`game/cutscene.ts`；`CodeLockDef` `NamingDef`→`game/panels.ts`；`DocDef` `JournalPageDef`→`game/journal.ts`；`PuzzleDef`→`game/hints.ts`（另有别名 `HintResult`）；`SpawnDef` `ExitDef` `AreaDef` `AreaPart` `AreaContext` `LevelsDef` `LevelsHandle` `LoadedArea`→`core/area.ts`；`TriggerDef` `TriggerHandle`→`core/triggers.ts`；`DynamicShape` `DynamicColliderHandle` `ColliderBuilder`→`core/collision.ts`；`Action` `ActionResult` `KEYMAP`→`core/actions.ts`；`Button` `MoveInput` `PointerPolicy`→`core/input.ts`；`ModeHandler`→`core/modes.ts`；`LAYER` `LayerName` `CamRole`→`core/layers.ts`；`AuxFeed` `NoWebGL2Error`→`core/render.ts`；`PLAYER_RADIUS` `STEP_MAX`→`core/collision.ts`（M1d）；`GameCaps`→`core/game.ts`；`FxParams`→`fx/post.ts`；`PostPresetId`→`fx/presets.ts`；`CrtUniforms` `CrtScreenMaterial`→`fx/crtScreen.ts`；`FeedTarget`→`fx/feeds.ts`；§9 的音频类型→`audio/engine.ts`（`SynthKit`→`audio/synth.ts`）；`JointName` `HumanoidSpec` `HumanoidRig`→`rigs/humanoid.ts`；`PC_DIMS` `CameraHead` `CableRig`→`rigs/cameraHead.ts`；`PlayerModel`→`rigs/player.ts`；`CharacterKind` `CharacterOpts` `CharacterRig`→`rigs/characters.ts`；`PaperOpts` `PaperRig`→`rigs/paper.ts`；`CrowdOpts`→`rigs/crowd.ts`；`TextTexOpts` `FONT_STACK`→`kit/text.ts`；`paintTexture` `PAINT`→`kit/canvas.ts`；`BuildingSpec`→`kit/building.ts`；`WindowSpec`→`kit/windows.ts`；`DoorSpec` `DoorRig`→`kit/doors.ts`；`SignSpec` `SignRig`→`kit/signs.ts`；`LampKind` `LampOpts` `LampRig` `designLight`→`kit/lamps.ts`；`RainRig`→`kit/rain.ts`；`DebugApi` `DebugState`→`debug/api.ts`；`ShotDef`→`debug/shots.ts`（M1d：`core/area.ts` 再导出，区域的 `shots.ts` 写 `import type { ShotDef } from '../../core/area'`；`check.mjs` 也放行 `import type` 自 `debug/shots`）。
- **日志与错误处理约定**（M1c 统一）：引擎内部捕获到的异常一律 `console.error('[模块] 说明', err)`（harness 据此判失败，`Game` 的 rAF 里同一条只报一次）；开发期提醒用 `core/log.ts` 的 `devWarn`（仅 `DEV_CHECKS`），契约违反用 `devAssert`（仅 `DEV_CHECKS` 抛错）；不写 `console.log`，消息里不出现 “deprecated”/“WebGL:” 一类会被 harness 当成 GL/弃用警告的字样。监听器、定时器、Effect、触发体、区域 onFlag/onExit、Disposer 的单步失败只记录不中断其余步骤；调试 API 把方法内异常映射为 `{ ok:false, reason:'exception' }`（§12.2）。
- **WP 内部模块**（导出不属于冻结签名，拥有者可自由改）：`fx/ghostMaterials.ts`、`fx/cameraFxShader.ts`、`fx/ir.ts` 的 `irMaterial`、`audio/sfx.ts` `ambience.ts` `music.ts` `voice.ts` 与 `synth.ts` 的 `createSynthKit`、`rigs/poses.ts` `accessories.ts` 与 `cameraHead.ts` 的 `createCameraHead`、`ui/styles.ts`、`ui/dom.ts`（M1c 补记）、`debug/overlay.ts` `fidelity.ts` 与 `shots.ts` 的 `runShot`、`core/disposer.ts`。M1c 另补：各 WP 在类上多出的公开成员，凡本文没写进代码块的（例如 `Game.waitGame/drive`、`RenderPipeline.lastFrameCalls/renderMain`、`InputManager.translate/inject`、`PostPipeline.current/layers()/warm()`、`ViewfinderSystem.syncPhotoCamera()`、`PhotoSystem.lastJudgement`、`VcrSystem.screenContent()`、`JournalSystem.right()`）都是拥有者内部的，别的模块不得依赖；M1c 冻结的只有本文写明“M1c 冻结/补写”的那些。M1d 同理：`Game.transitionsEnded()`、`RenderPipeline.qualityLevel`、`ConsoleSystem` 的屏幕可见性判断等是内部的；M1d 冻结的是本文写明“M1d 补写”的那些。

---

## 3. 运行时总览

### 3.1 启动流程（`Game.boot()`）

`main.ts` 用 `try/catch` 包住 `new Game(host)` 与整个 `boot()`；任何一步抛错都改为显示 `ui/bootError.ts` 的中文错误页，并 `console.error` 原始错误：`err instanceof NoWebGL2Error`（`core/render.ts` 导出；r186 只支持 WebGL2，`createRenderer` 拿不到 WebGL2 上下文时抛它）→ `showBootError(host, 'no_webgl2')`（“你的浏览器不支持 WebGL2……”）；其余 → `showBootError(host, 'exception', <错误摘要>)`（“启动失败：<错误摘要>”）。

**M1a 补写**：`main.ts` 在 `try` 内**动态** `await import('./core/game')`（`mountDebugApi` 同理 `await import('./debug/api')`），以便区域模块求值期的 dev 断言也走 bootError——`src/areas/*` 在模块加载时就执行 `defineArea`/`mergeAreaParts`/`defineDialogues` 的校验（§4.4），静态导入时这类异常发生在 ES 模块图求值阶段、早于 `main()` 的 `try/catch`，页面只剩空白与 pageerror。`main.ts` 只静态导入 `ui/bootError.ts` 与 `core/render.ts`（取 `NoWebGL2Error`；`core/render.ts` 在运行时只依赖 `three` 与 `core/log.ts`，不得运行时导入区域或系统模块）。

1. 读 URL 参数（`src/core/url.ts`；在 `Game` 构造函数里完成，`?quality=` 覆盖 `settings.quality` 的方式见 §4.4 构造顺序）：
   - `?new=1` 清空存档、跳过标题直接新游戏；`?debug=1` 挂载调试专用 API（`setFlags/giveItem/givePhoto/setState/shot`）与性能面板；`?test=1` 测试模式（淡入淡出时长 ×0.05、打字机即时、音频静音、从不请求指针锁定、页面隐藏时不自动暂停；不跳过过场，过场由 `dlg()`/`wait()` 快进）；`?lockstep=1` 锁步（§3.2，只在 `?test=1` 下有效；harness 默认带上）；`?nolock=1` 不请求指针锁定，改为按住左键拖拽转视角（`input.mjs` 用）；`?quality=low|mid|high`；`?area=<id>&spawn=<spawnId>`（仅 debug）；`?mute=1`；M4 补写：`?slow=k`（仅 test，测试的真实时间上限乘 k，§15.7.1）。
2. `Game` 构造函数（§4.4 的构造顺序）创建 renderer（`createRenderer()`；WebGL2 不可用时抛 `NoWebGL2Error` → 错误页）、`RenderPipeline`、`CameraRig`、玩家模型、`UI`、`AudioEngine`（**不创建** `AudioContext`，避免浏览器的自动播放警告）；`createRenderer` 成功后构造函数写 `caps.webgl2 = true`、`caps.maxAnisotropy = renderer.capabilities.getMaxAnisotropy()`（M1a 补写：这些都是 `Game` 的 readonly 字段，只能在构造函数里建，`boot()` 不再创建）。`boot()` 从这里开始：监听 `webglcontextlost`（`preventDefault()`，压入 `mode.pause` 并显示“画面丢失，正在恢复…”）与 `webglcontextrestored`（重建 RT 与 PMREM 后，以 `spawnUsed` 重新进入当前区域）。
3. `await document.fonts.ready`，运行 CJK 字形检测（`kit/text.ts` 的 `detectCjk()`），结果写入 `game.caps.cjk`。
4. 初始化共享资源：`MATERIALS`、`POST_PRESETS`、`PALETTE`、环境贴图（`fx/environment.ts`）；把玩家模型的 `root` 加入场景（模型本身已在构造函数里由 `createPlayerModel()` 创建）。
5. 静态导入 `src/areas/index.ts` 的全部 `AreaDef`（只是数据与函数，`build` 此时不执行），建立全局索引：出生点 → 区域、片段 → 区域、谜题表、文档表、对话表、出入口图。**校验**所有静态引用的 id 存在、每个出生点到本区任一出入口触发体边缘 ≥ 0.8m（GDD §4 开头；dev 下失败即抛错）。
6. 显示标题菜单（`ui/menus.ts`）：
   - “继续”：`save.read('save.auto')` **读得出且通过校验**（§6.4）才显示；读不出或校验失败时原数据另存为 `camhead-man.save.auto.bad`，toast“存档损坏，只能重新开始。”，不显示“继续”。
   - “从寅时重来”：`save.yin` 通过校验时显示。
   - “新游戏”：总有。
   - “设置”、“第三方许可”：总有；后者打开声明全文阅读页（§7）。
   - 通关后（片尾播完，§6.4）`save.auto` 已删除，不再显示“继续”；“从寅时重来”（存档有效时）、“新游戏”、“设置”、“第三方许可”仍保留。
   - `?new=1` 或调试 API `newGame()` 直接走“新游戏”分支（与点击菜单是同一个函数 `menus.select('new')`）。
   - 菜单按钮 `tabindex="-1"`，点击后立即 `blur()`（§4.6）。
7. 新游戏：清空状态与通关标记 → `areas.enter('r1', 'spawn.r1_start', {reason:'new'})` → 播 `cs.r1.intro` 过场。继续：`save.load('save.auto')` → `areas.enter(save.area, save.spawn, {reason:'load'})`；若存档里 `r1.soul_returned && !r1.called_at_dawn`（异常情况，GDD §3.13），进入 R1 后直接播 `cs.r1.dawn`（天亮那段过场，从 04:58 走起、等快门）。从寅时重来：`save.load('save.yin')`，同样清除通关标记。
8. `renderer.setAnimationLoop(frame)` 启动主循环。`areas.isLoading()` 持续超过 300ms 时，淡黑层上显示“载入中…”。
9. 音频：第一次 `pointerdown` **或** `keydown`（捕获阶段）时调用 `audio.unlock()`，此时才 `new AudioContext()` 并 `resume()`（M4：直到 AudioContext 真的 running 才摘监听，Esc/修饰键不算手势，另听 click，§15.7.1）；`?test=1`/`?mute=1` 不解锁。`visibilitychange` 为 hidden 时 `ctx.suspend()`，回到 visible 再 `resume()`；同时（非 `?test=1`）若栈顶不是 `mode.pause`，压入 `mode.pause`。

### 3.2 帧循环（`Game.step(dt, render)`）

`dt` 来自 `THREE.Timer`（`timer.update(timestamp)` 后 `getDelta()`），钳制到 `≤ 0.1s`，再乘 `timeScale`。

```
step(dt, render):
  1  input.beginFrame()                  → 本帧按钮事件已由 InputManager 在 DOM 回调里翻译成 Action 并入队
  2  actions.flush()                      → 队列里的 Action 依次交给 modes.dispatch()
     frozen = modes.freezesWorld()        → 栈顶模式 freezesWorld（pause、album、journal）时为真
  3  if !frozen: modes.update(dt)         → 栈顶模式（及 overlay 允许的下层模式）的 update
  4  if !frozen: player.update(dt, moveInput)   → 仅当栈顶模式允许移动；胶囊碰撞 5 次子步（静态 Octree + 动态碰撞体）
  5  if !frozen: triggers.update()        → 出入口/区域触发体积（进入、离开）
  6  if !frozen: systems.update(dt)       → 顺序固定（Game.step 逐个调用 game.sys.*）：
                                            npc.update(dt) → interaction.update(dt)(聚焦/角标) → viewfinder.update(dt)
                                            → read.evaluate()(每帧调用；取景器未开启时它只清空 reading/hint)
                                            → replay.update(dt) → vcr.update(dt) → cctv.update(dt) → crt.update(dt)(CRT 内容：录像机面板 > 频道/五路分屏 > 待机)
                                            → tripod.update(dt) → cutscene.update(dt) → dialogue.update(dt)(打字机) → journal.update()(新页 toast)
                                            → hints.update(dt) → shichen.update(dt)
  7  if !frozen: area.update?(ctx, dt); ctx.updateViews(); ctx.timers.update(dt)   → updateViews：viewVariant 与 hdText 的每帧切换（§11.2）
  8  if !frozen: effects.pump(dt)         → 推进异步 Effect 队列（wait 等游戏时间计时）
  9  if !frozen: game.time += dt；playerModel.update(dt, player, modes.top)；cameras.update(dt)   → 玩家模型（姿势混合、云台扫描、REC 灯、视频线摆锤）；第三人称跟随与避障、第一人称贴镜头、固定机位
  10 ui.update(dt)                        → 角标投影到屏幕、HUD 文本（冻结时也更新：相册、菜单要响应）
  11 if render: pipeline.render(dt)       → 辅助 RT（镜面/CH1/CH2/录像带，按画质与节流）→ 主合成
  12 save.flushIfSafe()                   → 有待存档且当前不在临时模式、也没有被 hold 时写 localStorage
  13 events.emit('frame', {dt})           → 仅调试面板使用；区域不要订阅
  14 （step 之外、同一调用里）runDeferred() → M1d：结局后回标题、推迟的画质重进（条件见 §4.4“帧末的推迟动作”）
```

- **调用方（M1a 补写）**：上面第 1–13 步里的每个调用都由 WP1 的 `Game.step` 发出；各系统**不得**自己订阅 `'frame'` 或另起循环来代替。第 6 步的列表就是全部“每帧方法”——`MirrorSystem`、`PanelSystem` 没有每帧方法（镜面经 `AuxFeed.due()` 在第 11 步渲染），`ViewfinderSystem.setOn` 由 `mode.viewfinder` 的 enter/exit 调用。
- **冻结**：栈顶是 `freezesWorld` 模式时，第 3–9 步全部跳过：回放与录像机不走、三脚架不倒计时、时辰钟不走、提示空闲计时不累计、NPC 淡入淡出停住、打字机停住。只有 UI 与渲染继续。
- **锁步**：`?test=1&lockstep=1` 时 rAF 回调只做 `pipeline.render(0)`（第 11 步，`dt=0` 保证画面静止），不调用 `step()`；模拟只在 `Game.advance()` 内推进（§3.4）。调试 API 的每个方法在需要时间的地方（淡入淡出、进区域、打字机、回放 seek 后的一帧）自己调用 `advance()` 推进所需时长。两次 API 调用之间游戏时间一帧也不走，所以 `replaySeek(14)` → `aimAt` → `shoot` 瞄的是同一时刻的人影。
- 非锁步（真人）时，rAF 每帧调用 `step(dt, true)`。

### 3.3 模拟与渲染分离

- 所有系统都不得在 `render` 阶段修改玩法状态；拍照判定、读字判定、温度读数都用几何计算与射线，**不依赖读像素**（唯一例外是缩略图，§6.8.5）。
- 因此无头 SwiftShader 下帧率很低也不影响判定结果。

### 3.4 `Game.advance(sec)`：无渲染快进

```ts
async advance(sec: number, fixedDt = 1 / 30): Promise<void>
```

- 暂停 rAF 里的 `step` 更新（rAF 仍渲染画面），用固定 `dt` 连续调用 `step(fixedDt, false)`，每 30 步让出一次宏任务（`await new Promise(r => setTimeout(r, 0))`；这是基础设施，不属于玩法计时）；结束后渲染一帧。
- 可选的提前结束条件：`advance(sec, fixedDt, until?: () => boolean)`，每步后检查 `until()`，为真就停（`dlg()` 用它“推进到等玩家输入或结束为止”，§6.3 的 settle）。
- 调试 API 的 `wait(sec)`、`dlg()` 跑过场、`tripod` 倒计时、锁步下的淡入淡出都用它。真人玩家的游戏逻辑与它走**同一个** `step()`。
- 冻结模式下 `advance()` 同样不推进游戏时间（step 自己跳过），所以 `wait()` 在暂停菜单里等于空转；调试 API 在调用 `wait()` 前若栈顶冻结，返回 `mode_disallows`。

### 3.5 调试 API 与玩家输入的汇合点（“同一代码路径”原则）

```
键盘/鼠标 → InputManager → KEYMAP[栈顶模式] → Action ─┐
                                                       ├─→ game.dispatch(action) → ModeStack → ModeHandler.handle()
window.__game.xxx() ────────────── 构造同样的 Action ──┘                          └→ 各系统（interaction.activate、photo.shoot、replay.pressR…）
```

- 能改变 flags/物品/照片的，**只有**各系统在处理 Action 或执行 Effect 时调用 `GameState` 的写方法。调试 API 从不直接写 flag（`?debug=1` 专用的 `setFlags/giveItem/givePhoto/setState` 除外，且 `walkthrough.mjs` 不带 `?debug=1`，这些方法根本不存在）。
- 调试 API 允许的“定位类”捷径（不经过物理/输入，但不改进度状态）：`goto`（传送）、`bodyGoto`、`aimAt`（直接设视角）、`replaySeek`、`vcr('seek')`、`wait`、`setTimeScale`、`shot`。这些都调用玩家也会用到的底层函数（`player.teleport`、`player.lookAtPoint`、`replay.seek`、`vcr.seek`）。
- **捷径不得绕过真人会被挡住的地方**（`?test=1` 下强制，§4.5、§12.3）：跨区域 `goto` 沿出入口图逐跳走、每跳检查 `when`；同区域 `goto` 要求目标与玩家所在处在碰撞栅格上连通；`interact` 要求视线无遮挡且自动转向后聚焦系统选中的正是该 id；`aimAt` 受当前模式的俯仰限制。关键门槛（院门、照相馆门等）另用 `walk(x, z)` 真走一遍（经过 `MoveInput` 与碰撞）。`scripts/input.mjs` 再用真实键鼠把 KEYMAP 与指针路径测一遍。

---

## 4. `src/core` 接口

### 4.1 基础类型（`core/types.ts`）

```ts
export type V3 = readonly [number, number, number];
export type XZ = readonly [number, number];
export type AreaId = 'r1' | 'r2' | 'r2_502' | 'r3' | 'r4';
export type AreaKey = AreaId | 'dev';
export type ModeId =
  | 'mode.explore' | 'mode.viewfinder' | 'mode.replay'
  | 'mode.panel_vcr' | 'mode.panel_console' | 'mode.panel_code' | 'mode.panel_naming'
  | 'mode.dialogue' | 'mode.album' | 'mode.journal' | 'mode.tripod' | 'mode.cutscene' | 'mode.pause';
export type LensMode = 'normal' | 'ir';
export type ZoomLevel = 1 | 2 | 3 | 4 | 6;
export const ZOOM_STEPS: readonly ZoomLevel[] = [1, 2, 3, 4, 6];
export type Shichen = 'zi' | 'chou' | 'yin' | 'mao';
export type Pose = 'stand' | 'walk' | 'sit' | 'crouch' | 'raise_arm' | 'carry' | 'lie' | 'look_up';
export type Verb = 'primary' | 'show' | 'use';
export interface CameraPose { pos: V3; target: V3; fov?: number; roll?: number }
export interface ApiResult<T = unknown> { ok: boolean; reason?: string; result?: T }
export type Awaitable<T = void> = T | Promise<T>;
```

`ApiResult.ok` 的语义：**动作被执行了**就是 `true`，即便结果是“用错了”的反馈（此时 `result.accepted === false`、`result.feedback` 是反馈文本）；**动作无法执行**（模式不允许、不在范围、没有该物品、目标不存在）才是 `false`，`reason` 取下列之一：

`'mode_disallows' | 'no_such_target' | 'not_present' | 'out_of_range' | 'wrong_view' | 'wrong_lens' | 'blocked' | 'not_owned' | 'no_ability' | 'not_near_replay_point' | 'locked' | 'not_in_viewfinder' | 'no_dialogue' | 'no_choice' | 'bad_option' | 'no_panel' | 'busy' | 'bad_args' | 'timeout' | 'not_focusable' | 'unreachable' | 'cancelled'`

`blocked` 与 `wrong_view/wrong_lens` 时也会显示对应反馈文本，并放在 `result.feedback` 里。`not_focusable`（有遮挡，或转过去后聚焦落在别的对象上）、`unreachable`（同区域目标与玩家不连通）只在 `?test=1` 的调试 API 里出现；`cancelled` 表示被 `modes.resetTo`/切区域打断（§6.3）。

```ts
export type Settle = 'idle' | 'waiting';   // idle：没有未完成的 Effect；waiting：阻塞点正在等玩家输入（对话行/选项、过场 await、面板已打开）
// —— M1a 补写（冻结）——
export type FailReason = 'mode_disallows' | 'no_such_target' | …;   // 上面 reason 列表的联合类型（ApiResult.reason 仍是 string）
export type QualityLevel = 'low' | 'mid' | 'high';                  // 画质档（§13.2）；Settings.quality、setQuality 等处的 'low'|'mid'|'high' 就是它
export const AREA_IDS: readonly AreaId[];                            // ['r1','r2','r2_502','r3','r4']
export const MODE_IDS: readonly ModeId[];                            // 13 个模式
export function fail<T>(reason: FailReason, result?: T): ApiResult<T>;   // { ok:false, reason, result? }
export function ok<T>(result?: T): ApiResult<T>;                        // { ok:true, result? }
```

### 4.2 id 注册表形式（`data/ids.ts`）

```ts
export const F = {
  R1_LOG_TAKEN: 'r1.log_taken', R1_GATE_LAMP_ON: 'r1.gate_lamp_on', /* …GDD §13.3 全部… */
  R2_WANG_FLOOR: 'r2.wang_floor', R1_NANKE: 'r1.nanke',
} as const;
export type FlagId = (typeof F)[keyof typeof F];
export const NUMERIC_FLAGS: ReadonlySet<FlagId> = new Set([F.R2_WANG_FLOOR]);

export const IT = { LOG: 'it.log', KEYS: 'it.keys', /* … */ } as const;         export type ItemId = (typeof IT)[keyof typeof IT];
export const PH = { TUDI: 'ph.tudi', /* …不含空镜… */ } as const;              export type KeyPhotoId = (typeof PH)[keyof typeof PH];
export type EmptyPhotoId = `ph.empty_${number}`;                               export type PhotoId = KeyPhotoId | EmptyPhotoId;
export const PT = { TUDI: 'pt.tudi', /* … */ } as const;                       export type PhotoTargetId = (typeof PT)[keyof typeof PT];
export const RD = { /* rd.* */ } as const;  export const RP = { /* rp.* */ } as const;  export const SEG = { /* seg.* */ } as const;
export const SPAWN = { /* spawn.* */ } as const;  export const EXIT = { /* exit.* */ } as const;
export const NPC = { TUDI: 'npc.tudi', WANG: 'npc.wang', LU: 'npc.lu', BOY: 'npc.boy', HUANG: 'npc.huang', ZHOU: 'npc.zhou' } as const;
export const SPK = { /* spk.* */ } as const;  export const GHOST = { /* ghost.*，GDD §13.6 表中出现的全部 */ } as const;
export const OBJ = { R1_LOG: 'r1.log', /* …GDD §13.8 全部，不含 r3.hole_xx… */ } as const;
export const DLG = { R1_BRACKET_CONFIRM: 'dlg.r1.bracket_confirm', R2_STAIRS: 'dlg.r2.stairs' } as const;   // GDD §13.12 点名的对话
type D = '0'|'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9';
export type HoleId = `r3.hole_${D}${D}`;
export const holeId = (n: number): HoleId => `r3.hole_${String(n).padStart(2, '0')}` as HoleId;
export type InteractId = (typeof OBJ)[keyof typeof OBJ] | HoleId | NpcId | StallId;
export const DOC = { /* doc.* */ } as const;  export const NAME = { /* name.* */ } as const;  export const PZ = { /* pz.* */ } as const;
export type ThingId = ItemId | PhotoId;                    // 可以“出示/使用”的东西
export type SpeakerId = NpcId | SpeakerSpkId | 'pc.huoji';
export type SubjectRef = InteractId | GhostId | 'pc.body' | 'pc.huoji';
export type DialogueId = `dlg.${AreaKey}.${string}`;      // M1a：AreaKey（含 dev；沙盒夹具要用 dlg.dev.*）
export type CutsceneId = `cs.${AreaKey}.${string}`;       // M1a：同上
export const ALL_IDS: ReadonlySet<string>;                 // 供 expr.ts 与 check.mjs 校验
```

M1a 必须把 GDD §13 的每一个 id 都登记进来（含 `r1.cold_steps`、`r4.kiosk`、`spk.worker`、`rig.*`、`mat.*`、`settings.*` 等只在少处出现的，以及 `r4.spotted_huang`、`rd.huang_breath`、`dlg.r1.bracket_confirm`、`dlg.r2.stairs`）。

- 需要导出的联合类型：`FlagId` `ItemId` `KeyPhotoId` `PhotoId` `PhotoTargetId` `ReadId` `ReplayPointId` `SegmentId` `SpawnId` `ExitId` `NpcId` `SpeakerSpkId` `GhostId` `ObjId` `StallId` `HoleId` `InteractId` `DocId` `NameId` `PuzzleId` `ThingId` `SpeakerId` `SubjectRef` `DialogueId` `CutsceneId`（`AreaId`/`ModeId` 在 `core/types.ts`）。
- 常量命名：去掉命名空间前缀后转大写蛇形；flag 与交互物保留区域前缀。例：`F.R1_LOG_TAKEN = 'r1.log_taken'`、`OBJ.R3_BELL = 'r3.bell'`、`IT.SLIP_0473 = 'it.slip_0473'`、`PH.COVERED_FACE = 'ph.covered_face'`、`SPAWN.R3_WEST = 'spawn.r3_west'`、`EXIT.R3_TO_R1 = 'exit.r3_to_r1'`、`NPC.LU = 'npc.lu'`、`GHOST.WANG_2018 = 'ghost.wang_2018'`、`SEG.DOOR_2018 = 'seg.door_2018'`。
- 能力 flag：倒带 = `F.R1_ABILITY_REPLAY`，红外 = `F.R2_ABILITY_IR`（引擎系统直接引用这两个常量）。

**M1a 补写（`data/ids.ts`，冻结）**：

```ts
export const AREA = { R1: 'r1', R2: 'r2', R2_502: 'r2_502', R3: 'r3', R4: 'r4' } as const;
export const PC = { HUOJI: 'pc.huoji', BODY: 'pc.body' } as const;                 export type PcId;
export const STALL = { R4_STALL_N1: 'r4.stall_n1', /* …n5、s1、s2、s4、s5 */ } as const;   // S3 即 npc.huang，不在表内；StallId 由它派生
export const RIG = { MANNEQUIN: 'rig.mannequin', PAPER: 'rig.paper' } as const;    export type RigId;
export const MODE = { EXPLORE: 'mode.explore', /* …13 个 */ } as const;           // 值 satisfies ModeId
export const LAYER_ID = { WORLD: 'layer.world', /* … */ } as const;               export type LayerIdStr;   // GDD 的 layer.*；代码里的图层用 core/layers.ts 的 LAYER
export const MAT = { REPLAY: 'mat.replay', GHOST: 'mat.ghost', PAPER_GLOW: 'mat.paper_glow', IR_OVERRIDE: 'mat.ir_override' } as const;  export type MatId;
export const SAVE = { AUTO: 'save.auto', YIN: 'save.yin' } as const;              export type SaveSlot;
export const SETTING = { VOLUME: 'settings.volume', /* …12 项 */ } as const;      export type SettingId;
export const ANT_FLAGS: readonly FlagId[];                    // r1.ant_old_1..6（下标 0 = 旧照一）
export const HOLE_IDS: readonly HoleId[];                     // r3.hole_00..99
export const emptyPhotoId: (n: number) => EmptyPhotoId;
export const isEmptyPhotoId: (id: string) => id is EmptyPhotoId;
export function isKnownId(id: string): boolean;               // ALL_IDS 或空镜 ph.empty_<n>
// 开发沙盒专用（§0.3）：不是 GDD id，不在 ALL_IDS 里；check.mjs 接受 ALL_IDS ∪ DEV_IDS
export const DEV_SPAWN = { START: 'spawn.dev_start', LOOKDEV: 'spawn.dev_lookdev' } as const;
export const DEV_EXIT = { TO_R1: 'exit.dev_to_r1' } as const;
export const DEV_IDS: ReadonlySet<string>;
export type SpawnId = /* GDD 的 spawn.* */ | /* DEV_SPAWN 的值 */;   export type ExitId = /* GDD 的 exit.* */ | /* DEV_EXIT 的值 */;
```

- `ALL_IDS` 恰好等于 GDD §13 的全部 id：440 个（含 5 个区域 id、`pc.*`、生成式 `r3.hole_00`–`99`；不含 `ph.empty_<n>` 与 `DEV_*`）。M1a 用脚本从 GDD §13 抽取全部反引号 id（展开 `a_1`–`a_4` 这类区间）与 `ALL_IDS` 双向比对，差集均为空。
- `DialogueId`/`CutsceneId`、§6.8.3 的 `decoy.*`、§12.5 的 `shot.*` 的区域段是 `AreaKey`（含 `dev`）：dev 沙盒的夹具要用 `dlg.dev.*`、`cs.dev.*`、`shot.dev.*`。

### 4.2.1 `src/data` 其余文件的导出（M1a 补写，冻结）

```ts
// data/palette.ts
export const PALETTE = { NIGHT: '#0B1020', FOG_R1: '#141A26', /* …GDD §9.1 全部 20 色，键名同该表“常量”列… */ } as const;
export type PaletteName = keyof typeof PALETTE;
export const GHOST_LU = '#E8E0D0';                              // 陆师傅的暖白魂影（GDD §2.7，不在 20 色表）
export const IR_RAMP: readonly [string, string, string, string, string];   // #120024 → #5B0F8A → #D9480F → #FFD43B → #FFFFFF
export const IR_RANGE_C: readonly [0, 45];

// data/items.ts
export interface ItemMeta {
  name: string; desc: string;                // 物品栏显示名与说明（玩家可见，不泄题）
  doc?: DocId;                               // 点开时打开的随身文档
  extraDocs?: readonly DocId[];              // 同样随身、但点开时不直接打开的文档（it.log 的 doc.log_new）
  opensJournal?: boolean;                    // it.log：点开 = 打开巡夜本
  usedName?: string; usedNote?: string;      // it.film 已用后叫“底片（已冲）”；it.slip_0474“姓名栏写着‘伙计’”
  order: number;
}
export const ITEMS: Readonly<Record<ItemId, ItemMeta>>;
export function itemDocs(id: ItemId): readonly DocId[];          // doc + extraDocs（readDoc 的“属于身上的物品”判定）
export function docOwnerItem(doc: DocId): ItemId | undefined;
export function itemDisplayName(id: ItemId, used: boolean): string;

// data/photos.ts
export interface PhotoMeta { title: string; key: boolean; print: boolean; old: boolean; oldIndex?: 1 | 2 | 3 | 4 | 5 | 6 }
export const PHOTO_META: Readonly<Record<KeyPhotoId, PhotoMeta>>;   // 标题照 GDD §7.2；全部 key；print = covered_face、true_form
export const OLD_PHOTOS: readonly KeyPhotoId[];                      // ph.old_1..6
export const EMPTY_KEEP = 20;                                         // 空镜只保留最近 20 张
export const THUMB = { w: 192, h: 144, quality: 0.7 };               // §6.8.5
export function photoForTarget(pt: PhotoTargetId): KeyPhotoId;       // pt.X → ph.X

// data/names.ts
export interface NameMeta { text: string; flag: FlagId; source: string; order: number }   // GDD §3.11
export const NAMES: Readonly<Record<NameId, NameMeta>>;
export const NAME_ORDER: readonly NameId[];
export function namesFromFlags(flag: (id: FlagId) => boolean): NameId[];   // StateView.names() 用它

// data/speakers.ts
export type VoiceKind = 'old_man' | 'old_woman' | 'man' | 'child' | 'god' | 'none';   // audio.murmur 的音色；门神/灶君 = 'god'
export interface SpeakerMeta { name: string; italic?: boolean; recOnly?: boolean; voice: VoiceKind }
export const SPEAKERS: Readonly<Record<SpeakerId, SpeakerMeta>>;     // spk.narrator 名字为空串、italic；pc.huoji recOnly
export function speakerName(who: SpeakerId | ''): string;
export function isNarration(who: SpeakerId | ''): boolean;

// data/time.ts
export interface ShichenClock { start: string; stop: string; secPerMin: number }
export const SHICHEN_CLOCK: Readonly<Record<'zi' | 'chou' | 'yin', ShichenClock>>;   // 23:40→00:59 每 20s/分；01:05→02:59、03:05→04:59 每 10s/分
export const SHICHEN_RANGE: Readonly<Record<Shichen, readonly [string, string]>>;     // 字样与钟点的对应区间
export const MAO_HUD_SWITCH = '05:00';
export const DAWN_CLOCK = { from: '04:58:00', to: '05:12:00', realSec: 12, rate: 70 } as const;
export const SHICHEN_TRANSITION_SEC = 2;
export const GAME_DATE = { before: '2026-08-27 周四', after: '2026-08-28 周五' } as const;
export function osdDateForClock(clockSec: number): string;
export const OSD_FIXED = { epilogue: 'CH1 2026-08-28 周五 08:12:40', nanke: 'CH1 2026-08-29 周六 06:40' } as const;
export const TAPE: {                              // 录像带 it.tape_830（GDD §3.8），as const
  startLabel: '2023-08-29 周二 22:00:00'; start: '22:00:00'; end: '06:00:00'; lengthSec: 28800;
  dateBefore: '2023-08-29 周二'; dateAfter: '2023-08-30 周三';
  timelapseUntil: '02:51:00'; timelapseRate: 120; alarmFrom: '02:51:00'; splitFrom: '02:51:00'; shuttleRate: 16;
  slowZone: ['03:13:30', '03:14:30']; index: [/* 7 个索引点 */]; faceWindow: ['03:14:00', '03:14:15']; watchedAt: '03:16:00';
  events: { sleeve; steps; alarm; walkOut; face; backInside; dawn };
};
export function tapeSec(tc: string): number;      // 挂钟 'HH:MM[:SS]' → 带子秒（0 = 22:00:00，跨午夜累加；06:00:00 = 28800）
export function tapeClock(sec: number): string;   // 带子秒 → 'HH:MM:SS'
export function tapeDate(sec: number): string;    // 00:00:00 起为 08-30 周三
export const TIMING: {                            // 玩法时长（游戏时间），as const
  areaFadeSec: 0.8; floorFadeSec: 0.4; testFadeScale: 0.05; loadingDelayMs: 300; saySecPerChar: 0.12; sayMinSec: 2;
  hintCooldownSec: 60; hintIdleSec: 120; flashMs: 80; softFlashSec: 0.25; shortFlashSec: 0.3; tripodCountdownSec: 10; tripodStillSec: 3; recBlinkSec: 1;   // M1d：shortFlashSec 新增（减少闪光时短于它的白闪不闪），softFlashSec 不再使用
};

// data/render.ts
export const LIGHT_SCALE: { point: number; spot: number; hemi: number; ambient: number; dir: number };   // §10.3；M1c look-dev 冻结：point/spot 0.1（× distance²）、hemi/ambient/dir π
export interface QualitySpec { pixelRatio: number; dynamicRes: boolean; bloom: boolean; rain: number; shadows: boolean; shadowMapSize: number; mirrorRT: number; mirrorEvery: number; feedEvery: number; anisotropy: number }
export const QUALITY: Readonly<Record<QualityLevel, QualitySpec>>;   // §13.2 的表
export const DEFAULT_QUALITY: QualityLevel;                          // 'mid'
export const DYN_RES: { scales: [0.7, 0.85, 1.0]; windowSec: 2; downAboveMs: 18; upBelowMs: 13; upHoldSec: 4; cooldownSec: 3 };   // M1d：scales 是相对系数（原 levels 为绝对像素比），§13.2
export const BUDGET: { callsMain: 250; callsTotal: 400; tris: 250000; lights: 8; tapeLights: 3; shadowLights: 1; canvasBytes: number; dynamicColliders: 16; meshes: 2000; resourceDrift: 5 };
export const RT_SIZE: { ch: [256, 192]; tape: [256, 192]; split5Atlas: [512, 384]; mirrorFar: 8 };
export const LOOK: { exposure: number; bloomThreshold: number; bloomRadius: number; envIntensity: readonly [number, number]; envDefault: number };   // look-dev 基准，M1c 冻结：exposure 1.5、bloomThreshold 0.8、bloomRadius 0.45、envIntensity [0.6, 1.4]、envDefault 1.0
export const TEMP_C = { ambient: 18, yin: 6, paper: 6, ghostLantern: 6, cold: 3, alive: 36, huang: 36.5, thermos: 50, lamp: 60 } as const;   // GDD §3.3 M5
export const RENDER_ORDER = { rain: 5, ghost: 10, paperGlow: 15, replay: 20 } as const;

// data/strings.ts（键名冻结；文本可由整合代理校对）
export const STRINGS: {
  game: { title; subtitle }; loading; boot: { noWebgl2; exception; contextLost }; save: { corrupted };
  menu: { continue; fromYin; newGame; resume; settings; back; paused; clickToContinue };
  settings: { volume; mouseSens; invertY; vfMode; vfToggle; vfHold; subSize; subSizes; grain; quality; reduceFlash; colorAssist; hintNoCooldown; mirrorMode; tunnelMode; realtime; baked; on; off };
  quality: Record<QualityLevel, string>; shichen: Record<Shichen, string>;
  hud: { rec; replayHint; replayCounter; slow; alarm; noSignal; keepStill; newPage; hintKey };
  tutorial: { move; interact; viewfinder; shutter; rewind; lens; zoom; wake };
  actionMenu: { talk; look; show; use }; dialogue: { leave }; album: { photos; items; used; empty };
  journal: { title; names; clues; ants }; doc: { waterStain };
  feedback: { nothingHere; replayNoAbility; replayLocked; replayWalkedOut; readTooSmall };
  tudiIdle: readonly string[];                                   // 候选谜题为空时 H 键的土地闲话
  reason: Record<FailReason, string>;                            // 通用失败原因
};
export const EMPTY_CAPTIONS: Readonly<Record<PhotoFail, string>>;    // §6.8.4 的默认空镜标题
export function fmt(template: string, vars: Readonly<Record<string, string | number>>): string;   // '{n}' 占位替换
```

### 4.3 事件总线（`core/events.ts`）

```ts
export interface GameEvents {
  'flag':            { id: FlagId; value: boolean | number; prev: boolean | number };
  'item':            { id: ItemId; kind: 'added' | 'used' };
  'photo':           { record: PhotoRecord; hit: PhotoTargetId | null };
  'shutter':         { area: AreaKey; pos: THREE.Vector3; context: PhotoContext; lens: LensMode };  // 取景器每按一次快门都发（含空镜、面板叠加时）；三脚架与过场里的快门不发
  'interact':        { id: InteractId; verb: Verb; thing?: ThingId; accepted: boolean };
  'feedback':        { text: string; speaker?: SpeakerId };   // 任何反馈/旁白/字幕文本（测试断言用）
  'mode':            { top: ModeId; prev: ModeId | null; stack: readonly ModeId[] };
  'area:enter':      { id: AreaKey; spawn: string; from: AreaKey | null };
  'area:exit':       { id: AreaKey };
  'shichen':         { now: Shichen; prev: Shichen };
  'viewfinder':      { on: boolean };
  'lens':            { lens: LensMode };
  'zoom':            { zoom: ZoomLevel };
  'read':            { id: ReadId };
  'replay:start':    { point: ReplayPointId; seg: SegmentId };
  'replay:complete': { seg: SegmentId };
  'replay:end':      { point: ReplayPointId; reason: 'exit' | 'walked_out' | 'mode' };
  'vcr:tc':          { tc: number; from: number };            // 播放头移动（含 seek）
  'cctv:channel':    { channel: 1 | 2 | 3 | 4 | 5 };
  'jack':            { plugged: boolean };
  'dialogue:start':  { id: DialogueId };  'dialogue:end': { id: DialogueId };
  'cutscene:start':  { id: CutsceneId };  'cutscene:end': { id: CutsceneId };
  'journal:page':    { index: number };
  'save':            { slot: 'save.auto' | 'save.yin' };
  'ending':          { kind: 'main' | 'nanke' };               // GameApi.endingDone（E.ending）发出：主结局片尾或南柯段落播完
  'settings':        { key: keyof Settings; value: unknown };   // 设置变化（reduceFlash、colorAssist、quality…）
  'temp':            { area: AreaKey; key: string; value: boolean | number };   // 区域临时状态变化（§11.2），NPC 与条件据此重新求值
  'frame':           { dt: number };
}
export class EventBus<E> {
  on<K extends keyof E>(type: K, fn: (e: E[K]) => void): () => void;   // 返回取消订阅函数
  once<K extends keyof E>(type: K, fn: (e: E[K]) => void): () => void;
  emit<K extends keyof E>(type: K, e: E[K]): void;                      // 同步派发；监听器抛错只记录不中断
  listenerCount(type?: keyof E): number;                                // M1a 补写：调试与资源回收检查
  clear(): void;                                                        // M1a 补写
}
```

区域里用 `ctx.on(type, fn)` 订阅，卸载时自动解绑。

### 4.4 `Game`（`core/game.ts`）

```ts
export interface GameCaps { webgl2: boolean; cjk: boolean; maxAnisotropy: number }
export class Game {
  readonly host: HTMLElement;
  readonly caps: GameCaps;
  readonly url: UrlOptions;
  readonly events: EventBus<GameEvents>;
  readonly renderer: THREE.WebGLRenderer;
  readonly pipeline: RenderPipeline;
  readonly scene: THREE.Scene;              // 唯一场景；区域内容挂在 areas.current.root 下
  readonly cameras: CameraRig;
  readonly input: InputManager;
  readonly modes: ModeStack;
  readonly state: GameState;
  readonly effects: EffectRunner;
  readonly save: SaveSystem;
  readonly settings: Settings;
  readonly areas: AreaManager;
  readonly collision: CollisionWorld;
  readonly player: PlayerController;
  readonly playerModel: PlayerModel;
  readonly triggers: TriggerSystem;
  readonly audio: AudioEngine;
  readonly ui: UI;
  readonly sys: {
    interaction: InteractionSystem; npc: NpcSystem; viewfinder: ViewfinderSystem; photo: PhotoSystem; read: ReadSystem;
    replay: ReplaySystem; vcr: VcrSystem; cctv: ConsoleSystem; crt: CrtScreenController; mirror: MirrorSystem;
    tripod: TripodSystem; dialogue: DialogueSystem; cutscene: CutsceneSystem; panels: PanelSystem;
    journal: JournalSystem; hints: HintSystem; shichen: ShichenSystem;
  };
  readonly api: GameApi;                    // 给区域与 Effect 的受限门面（§6.3）
  readonly lockstep: boolean;               // ?test=1&lockstep=1
  time: number;                             // 累计游戏时间（秒；冻结时不走）
  timeScale: number;                        // 默认 1
  frameNo: number;
  ending: 'none' | 'main' | 'nanke';        // M1a 补写：运行期结局（GameApi.endingDone 写、DebugState.ending 读；新游戏/读档时复位）

  constructor(host: HTMLElement);
  boot(): Promise<void>;
  dispatch(a: Action): ActionResult;        // 唯一的动作入口（输入与调试 API 共用）
  step(dt: number, render: boolean): void;
  advance(sec: number, fixedDt?: number, until?: () => boolean): Promise<void>;
  settle(o?: { maxGameSec?: number; maxRealMs?: number }): Promise<Settle>;   // 推进（锁步下调用 advance）直到 effects.settled()，§6.3；M1c 写明语义见下
  renderNow(): void;                        // 同步渲染一帧（缩略图、截图用）
  nextFrame(): Promise<void>;               // 等到下一次 rAF 渲染完成
  newGame(): Promise<void>;
  continueFrom(slot: 'save.auto' | 'save.yin'): Promise<boolean>;
  reenterCurrentArea(reason: 'quality' | 'context_restored'): Promise<void>;   // 以 spawnUsed 重新进入（画质切换、context 恢复）；M1d：结局期间的 context 恢复见下
  // —— M1d 补写 ——
  requestReenter(reason: 'quality'): void;  // 推迟的区域重进（画质切换一律经它，§6.4）：Game.step 末尾在安全时执行；没有区域时立即 pipeline.setQuality
  toTitle(): Promise<void>;                 // 回到标题：cancelAll + resetTo + areas.leave()（淡出、卸载区域）+ playerModel.reset() + 取景器光学复位 + ui.menus.showTitle()
  returnToTitleWhenIdle(): void;            // GameApi.endingDone 写通关标记时调用：runner 空闲、不在过场与加载中时由 Game.step 末尾执行 toTitle()
  requestPause(): void;                     // 意外解锁、页面隐藏、context lost 时压暂停；areas.isLoading() 期间推迟到最后一个过渡结束（§4.5）
}
```

**`settle()` 与新游戏/读档（M1c 补写，WP1 的实现；engine-wp1.md #1、engine-wp4.md #11/#15）**：
- `settle(o?)`：真实时间超过 `maxRealMs`（默认 60 000）或游戏时间超过 `maxGameSec`（默认 600）时 **reject 一个 `name === 'TimeoutError'` 的 Error**（不谎报 `'idle'`；调试 API 映射成 `{ ok:false, reason:'timeout' }`，§12.2）。栈顶是冻结模式且 runner 忙时返回 `'waiting'`（冻结时 runner 不会前进，等的是玩家）；`areas.isLoading()` 为真时一直推进/等待到加载与淡入淡出结束。可以在调试 API 方法里嵌套调用（`activate(…, 'api')` 内部就 settle 一次）。
- `newGame()`：`ending = 'none'` → `save.clearCompleted()` → `state.reset()` → `sys.shichen.resetClock()` → `sys.hints.resetProgress()`（提示进度不存档，GDD §3.13）→ `sys.viewfinder.resetOptics()`（镜头回常光、倍率回 1×，§6.8.1）→ M1d：`playerModel.reset()`（身子可见、不透明、站姿、头装回、视频线拔出——上一局的结局可能让身子不见、头留在门楣上，§5.2）、清掉推迟的回标题/重进 → 进 R1 并播 `cs.r1.intro`（不等它播完）。`continueFrom(slot)` 在 `save.load(slot)` 成功后做同样的复位（`save.yin` 还 `clearCompleted()`）；`?area=` 调试开局同理。区域经 `GameApi.post.push` 推的后期层随区域卸载弹掉（§6.3），所以换一局也不会带进来。
- WP1 内部的 `waitGame(sec)`/`drive(done)`（按游戏时间等待，锁步下自己 advance）、`frameDt()` 等不属于冻结签名。M1d：`drive` 的 90 秒真实时间上限只累计“世界没冻结、页面可见”的时间（单次间隔最多记 250ms）——暂停菜单开着、标签页切走时游戏时间本来就不走，不能因此判超时。
- **帧末的推迟动作（M1d）**：`Game.step` 返回前（不在 step 内、不在加载中）依次检查：① `returnToTitleWhenIdle()` 挂起且 `effects.busy` 为假、栈上没有 `mode.cutscene` → `toTitle()`；② `requestReenter('quality')` 挂起且栈顶是 explore/viewfinder、栈上没有临时模式、`effects.busy` 为假、`save.held` 为假（结局期间）→ `reenterCurrentArea('quality')`。以前推迟的画质重进挂在 `'mode'` 事件上同步触发，三脚架成功“先弹 `mode.tripod`、再开结局 run”的那一下就会重进区域、把结局过场取消（M1d 评审）。
- **结局期间的 context 恢复（M1d）**：`save.held` 时 `reenterCurrentArea('context_restored')` 按读档规则处理——已叫醒（`r1.called_at_dawn`）→ `markCompleted()` 后 `toTitle()`；否则重进当前区域，若 `r1.soul_returned` 再补播 `cs.r1.dawn`（§6.4“异常存档”）。

**装配约定（M1a 补写，冻结）**：

- `sys` 的类型另以 `export interface GameSystems` 导出（字段同上）。
- 只有 `core/game.ts` 在运行时 import 各系统类（`main.ts` 动态 import `core/game.ts` 与 `debug/api.ts`，§3.1）；其他模块对 `Game` 与系统类一律 `import type`。`src/areas/*` 在模块加载时就会求值 `defineArea`/`mergeAreaParts`/`E`/`defineDialogues`/`seq`/`holeId`（M1a 已真实实现），这些模块不得在运行时 import `core/game.ts`，以免循环依赖。
- 构造函数：下表之外的系统（`game.sys.*`、`GameState`、`EffectRunner`、`SaveSystem`、`InputManager`、`ModeStack`、`CameraRig`、`CollisionWorld`、`PlayerController`、`TriggerSystem`、`CrtScreenController`）、13 个模式处理器、UI 各视图一律 `constructor(game: Game)`。构造函数里只保存 `game`、订阅 `game.events`，**不得**访问其他系统（它们可能尚未创建）；跨系统引用在调用时经 `game.sys.*` 等取。
- Game 构造顺序：url → caps（初值 `{ webgl2:false, cjk:false, maxAnisotropy:1 }`）→ events → settings（`this.settings = loadSettings(); if (this.url.quality) this.settings.quality = this.url.quality;`——`?quality=` 覆盖只改内存、不落盘、不发 `'settings'`，由 WP1 在这里做；`loadSettings` 不读 URL，§6.4）→ scene → renderer（`createRenderer()`；成功后 `caps.webgl2 = true`、`caps.maxAnisotropy = renderer.capabilities.getMaxAnisotropy()`）→ cameras → pipeline（含 `new PostPipeline(renderer, scene, cameras.camera)`）→ input → modes → state → effects → save → collision → player → playerModel（`createPlayerModel()`）→ triggers → audio → sys.* → ui → api（`createGameApi(this)`）→ areas（`new AreaManager(this, AREAS)`）→ `modes.register(…)` 13 次。

| 构造 | 签名 | 文件 |
|---|---|---|
| 渲染器 | `createRenderer(canvas?: HTMLCanvasElement): THREE.WebGLRenderer`（§13.1 的设定；WebGL2 不可用时抛 `NoWebGL2Error`）；`export class NoWebGL2Error extends Error`（M1a 补写：`main.ts` 据此显示 `'no_webgl2'` 错误页，§3.1） | `core/render.ts` |
| 渲染管线 | `new RenderPipeline(renderer, scene, cameras, post)` | `core/render.ts` |
| 后期 | `new PostPipeline(renderer, scene, camera)` | `fx/post.ts` |
| 区域管理 | `new AreaManager(game, defs: readonly AreaDef[])` | `core/area.ts` |
| 区域上下文 | `new AreaContextImpl(game, def, root)`（§11.2 的 M1a 补写） | `core/areaContext.ts` |
| 音频 | `new AudioEngine(o?: { muted?: boolean })`（muted = `?test=1 || ?mute=1`；构造时不建 AudioContext） | `audio/engine.ts` |
| UI | `new UI(host: HTMLElement, game)` | `ui/ui.ts` |
| GameApi | `createGameApi(game, scope?: RunScope): GameApi`（无 scope = 顶层门面 `Game.api`） | `game/effects.ts` |
| 设置 | `loadSettings(): Settings` | `game/settings.ts` |
| 玩家模型 | `createPlayerModel(): PlayerModel` | `rigs/player.ts` |
| 调试 API | `mountDebugApi(game): DebugApi`（`main.ts` 在 `boot()` 之后调用；与 `core/game` 一样动态导入，§3.1） | `debug/api.ts` |
| 模式处理器 | `ExploreMode` `ViewfinderMode` `ReplayMode` `PanelVcrMode` `PanelConsoleMode` `PanelCodeMode` `PanelNamingMode` `DialogueMode` `AlbumMode` `JournalMode` `TripodMode` `CutsceneMode` `PauseMode`，各在 `game/modes/<explore|viewfinder|replay|panelVcr|panelConsole|panelCode|panelNaming|dialogue|album|journal|tripod|cutscene|pause>.ts`，`implements ModeHandler`，`constructor(game)`；属性值照附录 A | `game/modes/*.ts` |

### 4.5 区域管理（`core/area.ts`）

```ts
export interface SpawnDef { pos: V3; yaw: number; floor?: number }
export interface ExitDef {
  id: ExitId;
  to: SpawnId;
  box?: { center: V3; size: V3 };           // 触发体积（走进去即切换）；GDD 规定 1.5m 见方；门洞类放在门框平面外侧（GDD §4 开头、§13.2）
  via?: InteractId;                         // 或者：对该交互物按 E 时切换（本作目前没有这种出口；502 门是门洞触发体，见 GDD §13.2）。M1c 写明（engine-wp1.md #8）：引擎只为带 box 的出口生成触发体，只有 via 的出口在启动校验时 devWarn、不生成入口；真要“按 E 出门”就登记一个 onInteract: g => g.travel(EXIT.X) 的交互物（与触发体走同一个 areas.travel）
  when?: Cond;                              // 默认 'true'
  blocked?: string;                         // 条件不满足时的反馈；玩家被推回 0.6m
  fade?: number;                            // 默认 0.8s
  floor?: number;                           // R2：触发体所在楼层。M1d 写明：信息字段，引擎目前不读（出入口图把 R2 各楼层视为连通）
}
export class AreaManager {
  constructor(game: Game, defs: readonly AreaDef[]);   // M1a 补写：Game 传入 src/areas/index.ts 的 AREAS
  readonly current: LoadedArea | null;      // M1a 补写：enter 第 4 步一建好新 root/ctx 就指向新区域（build 期间已可用），第 3 步卸载期间仍指向旧区，见下文“切换流程”
  readonly defs: ReadonlyMap<AreaKey, AreaDef>;
  spawnArea(spawn: SpawnId): AreaKey;
  enter(area: AreaKey, spawn: SpawnId, opts?: { reason?: EnterReason; fade?: number }): Promise<void>;   // EnterReason = 'new' | 'load' | 'exit' | 'debug' | 'quality' | 'restored'
  travel(exit: ExitId): Promise<ApiResult<{ exit: ExitId; feedback?: string }>>;   // 出入口的唯一执行路径：触发体、via 交互、GameApi.travel、goto 逐跳都调它；when 假 → { ok:false, reason:'blocked' }
  route(from: AreaKey, to: AreaKey): { ok: true; hops: ExitId[] } | { ok: false; exit: ExitId | null };   // 出入口图 BFS，每跳要求 when 为真；失败时给出第一个被挡住的出口（M1c：无视条件时“被挡出口数最少、其次跳数最少”那条路线上的第一个被挡出口；图上不连通时 null）
  teleport(pos: V3, opts?: { yaw?: number; floor?: number; fade?: number }): Promise<void>;   // 同区域；正在回放则先退出回放（reason walked_out）
  goto(area: AreaKey, x: number, z: number, floor?: number): Promise<ApiResult>;             // 调试传送（见下）
  isLoading(): boolean;
  leave(opts?: { fade?: number }): Promise<void>;   // M1d 补写：离开当前区域、不进新区域（Game.toTitle 用）：锁输入 → 淡出 → 卸载（同第 3 步）→ current = null → 撤黑幕
}
export function precompile(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera): Promise<void>;   // M1d 补写：第 4 步的预编译（见下）
export interface LoadedArea {
  readonly def: AreaDef;
  readonly ctx: AreaContextImpl;
  readonly root: THREE.Group;
  readonly spawnUsed: SpawnId;
}
```

**切换流程**（`enter`）：

1. `effects.cancelAll('area')`（M1d 更正：**无条件**——不只在临时模式；阻塞中的对话/过场以 `cancelled` 结束，同一 handler 后续 effects 丢弃，§6.3。所以 `onInteract: g => g.travel(EXIT.X)` 这类 handler 自己也会被取消：**travel 必须是 handler 的最后一步**，写进度放在它前面；取消后的写入在 dev 下 devWarn）→ 栈上不止 explore 时 `modes.resetTo('mode.explore')`（依次对栈上各模式调用 `exit`，回放/面板/对话/过场都会被正常关闭）。锁输入。
2. 淡出（默认 0.8s；R2 楼层切换 0.4s；`?test=1` 乘 0.05），期间游戏时间照走（锁步下由 `enter` 自己 `advance()`）。
3. 旧区域：`def.onExit?.(ctx)` → 发 `area:exit` → `ctx.dispose()`：清空本区注册表——依次调用 `game.sys` 的 `replay.clearArea()`、`interaction.clearArea()`、`npc.clearArea()`、`photo.clearArea()`、`read.clearArea()`、`panels.clearArea()`、`vcr.clearArea()`、`cctv.clearArea()`、`crt.detach()`、`mirror.clearArea()`、`tripod.clearArea()`，以及 `game.triggers.clearArea()`（M1a 补写：这是完整清单，由 WP1 的 `AreaContextImpl.dispose()` 调用；各方法在本区从未登记/配置/挂接过时是空操作；镜面/监控台/录像机/三脚架/CRT 在各自的 clearArea/detach 里清除配置、还原材质并注销其 `AuxFeed`）→ 移除 root、释放 ctx 追踪的 geometry/material/texture/RT（共享的 `MATERIALS` 不释放）、清定时器、事件订阅与临时状态 → `collision.clear()`、停环境声。整个第 3 步期间 `areas.current` 仍指向旧区域；`ctx.dispose()` 返回后置为 `null`。
4. 新区域：新建 `root` 加入场景、`new AreaContextImpl(game, def, root)`，**立即**把 `areas.current` 设为新的 `LoadedArea`（`def`/`ctx`/`root`/`spawnUsed`），然后才做下面的静态登记与 `await def.build(ctx)`（M1a 补写：`ctx.npc()` → `NpcSystem.add(d)`、`InteractionSystem.register(def, area)` 这类只转交、不带 ctx 的登记方法，由各系统在登记时经 `game.areas.current!.root` / `.ctx.ref()` / `.ctx.getRef()` 访问本区，所以 build 期间 `current` 必须已是新区域）→ 注册 `def` 里的静态数据（`interaction.register`、`photo.register`、`read.register`、`replay.register`；出入口经 `triggers.add`）→ `await def.build(ctx)` → 用 `ctx` 收集的碰撞体构建 Octree，登记动态碰撞体 → `replay.prebuild(root)` 预先**隐藏地**构建本区全部回放人影（§6.9）→ 校验（灯数 ≤ 8 且此后恒定、灯不挂在可隐藏节点下、拍照主体与 `hideWorld` 的 ref 可解析、交互物 id 已登记、`addTalk` 排队的 id 都已登记（`interaction.pendingTalks()` 为空）、`ctx.console()` 字段齐全（`cctv.validate()` 为空；本区未配置过监控台时恒为空）、出生点离触发体 ≥ 0.8m；后三项与冻结灯数由 `ctx.finalize()` 做，§11.2）→ `renderer.shadowMap.needsUpdate = true`（M3 补写，docs/requests/r3.md #1：`shadowMap.autoUpdate = false`，新灯的 `shadow.map` 要等第一次阴影 pass 才建；在那之前的渲染里 r186 给 `sampler2DShadow` 数组绑的是**没设比较模式**的空深度贴图——`WebGLUniforms` 的数组 setter 不设 `emptyShadowTexture.compareFunction`——刷 `GL_INVALID_OPERATION: Mismatch between texture format and sampler type`；第一次进区域时恰好不刷，第二次进同一区域必刷。预热的 1×1 渲染顺带把阴影图建好）→ `precompile(renderer, scene, camera)` 预编译（M1d：`compileAsync`/`compile` 期间渲染目标设成 1×1 线性半浮点 RT，编出的是主场景实际用的线性变体，§13.1、§16）→ `warmupArea(…)` 预热（§8.5、§13.1）→ 再 `shadowMap.needsUpdate = true`（放好玩家之后的第一帧重画阴影）。对话、过场、谜题、文档不在这里登记：启动时 `AreaManager` 汇总全部区域的 `AreaDef.dialogues/cutscenes/puzzles/docs/journalPages`，分别交给 `dialogue.register`、`cutscene.register`、`hints.register`、`journal.registerDocs/registerPages`。
5. 放置玩家到出生点（`floor` 由 `levels` 处理；M3 补写：主角姿势一律复位成 `stand`——R1 开场过场让伙计坐在椅子上，这个姿势不带进下一个区域，要坐着的过场在进区域之后自己设）；模式为 `mode.explore`；`npc.reevaluate()`。
6. `def.onEnter?.(ctx, { from, spawn })` → 发 `area:enter` → `save.request('area')`。
7. 淡入，解锁输入。

**过渡的失败保护与暂停（M1d）**：`enter`/`changeLevel`/带淡入淡出的 `teleport`/`leave` 从 `beginTransition` 起全部在 try/finally 里：等待超时或抛错时照样解锁输入、复位 `isLoading()`，并把黑幕撤掉（`ui.fade.black(0, 0)`）再把错误交给调用方——不会留下永久黑屏与挂起的输入。过渡期间（`isLoading()`）的意外解锁、页面隐藏、context lost 不立刻压暂停（暂停冻结世界，淡入淡出就永远走不完，暂停页还被 `#fade` 盖住），`Game.requestPause()` 记下，最后一个过渡结束时补压；暂停页在栈顶时 `InputManager` 即使在挂起状态也照常收键（Esc 能关掉暂停）。

**`goto(area, x, z, floor?)`**（调试 API；`?test=1` 下按“真人路径”检查，§3.5）：
- 对话、过场、三脚架期间调用一律返回 `busy`（它们不能被传送打断）。
- 跨区域：`route(current, area)` 在出入口图上做 BFS（节点是区域，边是 `AreaDef.exits`，每一跳都要求当时 `when` 为真；R2 各楼层视为连通，因为楼梯井总能走）。不可达 → `{ ok:false, reason:'blocked', result:{ exit, feedback } }`（`exit` 是第一个被挡住的出口，`feedback` 是它的 `blocked` 文本；M1c：“第一个”按路线定义——在无视条件的出入口图上取被挡出口数最少、其次跳数最少的路线，返回这条路线上第一个 `when` 为假的出口，例如新游戏时 dev → r2_502 报 `exit.r2_to_502` 而不是不在路线上的 `exit.r1_to_r3`）。可达 → 逐跳调用 `travel(exit)`（与玩家走进触发体完全同一条代码路径，中间区域也完整进入一次），到达后在目标区域内按同区域规则 `teleport` 到 (x, y, z)。完成后模式为 `mode.explore`。
- 同区域：`modes.popToBase()` —— 弹掉面板、相册、巡夜本、暂停；回放中则退出回放回到取景器；**取景器保留**。`?test=1` 下先做连通性检查：`collision.reachable(from, to, level)` 把本区碰撞盒、墙与**当前启用的**动态碰撞体栅格化成 0.25m 网格（测试胶囊半径 0.295 = 玩家半径 − 5mm、底离地 STEP_MAX + 1cm；M1c/M1d 按实现更正，§4.8：原写 0.5m/0.3 会把 0.9–1.0m 宽的门洞误判为不通，M1c 的 0.28 又放过 0.56–0.6m 的窄缝），从玩家所在格 flood-fill；R2 不同楼层之间经楼梯口连通（先测“玩家 → 当前层楼梯口 (0, y, 1.8)”，再测“目标层楼梯口 → 目标点”）。目标格被占或不连通 → `{ ok:false, reason:'unreachable' }`（例如照相馆门没开时 `goto` 进店里）。然后 `teleport`（R2 给 `floor` 时先切楼层）。朝向保持不变。
- y 取值：`levels` 存在时 `levels.y(floor ?? current)`；否则 `def.groundY?.(x, z) ?? 0`。传送后胶囊贴地。
- 任何传送（`teleport`、`levels.set()`、出入口）都会先退出回放，`replay:end` 的 reason 记为 `walked_out`。

### 4.6 输入、动作与模式栈

```ts
// core/input.ts
export type Button =
  | 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'ShiftLeft' | 'KeyE' | 'KeyQ' | 'KeyR' | 'KeyF' | 'KeyZ' | 'KeyC'
  | 'KeyJ' | 'KeyH' | 'Tab' | 'Escape' | 'Space' | 'Enter' | 'Backspace' | 'Comma' | 'Period'
  | 'BracketLeft' | 'BracketRight' | `Digit${0|1|2|3|4|5|6|7|8|9}` | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
  | 'MouseLeft' | 'MouseRight' | 'WheelUp' | 'WheelDown';
export interface MoveInput { x: number; z: number; sprint: boolean }     // 相机坐标系，|v|≤1。M1c 写明（three 相机空间）：x = +1 向右（D）、z = −1 向前（W）、z = +1 向后（S）；三脚架（move 'body'）相对固定机位相机的水平朝向
export type PointerPolicy = 'lock' | 'free';
export class InputManager {
  readonly pointerLocked: boolean;
  readonly lockAvailable: boolean;          // 浏览器支持且不是 ?test=1/?nolock=1
  readonly move: MoveInput;                 // 当前帧 WASD 轴
  readonly lookDelta: { dx: number; dy: number };   // 本帧鼠标位移（已乘灵敏度、Y 反转）；锁定不可用时来自“按住左键拖拽”
  moveActive(): boolean;                    // 有任何移动键按下（长曝光判定用）
  applyPolicy(p: PointerPolicy): void;      // 模式切换时由 ModeStack 调用（见策略表）
  requestPointerLock(): void;               // requestPointerLock().catch(() => {})；被拒绝则 1 秒后重试一次（Chrome 退出锁定后约 1 秒内会拒绝）
  onButton(fn: (b: Button, down: boolean) => void): () => void;
  setMove(m: MoveInput | null): void;       // 仅 player.walkTo()/调试 walk() 使用：覆盖本帧移动轴（null = 还给键盘）
  beginFrame(): void;                       // M1a 补写：§3.2 第 1 步
  dispose(): void;                          // M1a 补写：移除全部 DOM 监听
}
```

- 右键 `contextmenu` 必须 `preventDefault`；滚轮监听用 `{ passive: false }`。
- **点在 UI 上的鼠标键不是游戏输入**（M1c，engine-wp6.md #14）：未锁定时，目标在 UI 根下（`game.ui.isUiEventTarget(ev.target)`；UI 各层 pointer-events:none，只有可点元素能成为目标）或落在 DOM 控件上的 mousedown 不产生 `MouseLeft`/`MouseRight`，由 UI 自己的点击处理发 `pick`/`choose`/按钮动作——否则一次点击会被处理两次（挑选器确认、取景器叠在面板上时的快门）。指针锁定时事件目标恒为 canvas，不受影响。
- **指针锁定下的位移尖峰**（M1c）：刚锁定后 80ms 内的 mousemove 与单次 |movementX/Y| > 400px 的 mousemove 丢弃（Chrome 在锁定切换前后会报一次“从上次位置到这里”的巨大位移，试玩时视角一下转了两百多度）。
- **Esc 与菜单**（M1c）：标题画面（还没有区域，M1d：或标题页可见）与建区期间 explore 的 `back` 返回 `mode_disallows`，不压暂停（否则标题菜单会被换成暂停菜单）；暂停里打开的设置页上 Esc 回到暂停页（`PauseMode` 先问 `ui.menus.backFromSettings()`），再按一次才继续；标题流程的设置页、第三方许可页 Esc 回标题（UI 的按键镜像处理）。
- 按键在帧内翻译（WP1 的实现）：DOM 回调只把按钮事件入队，`Game.step` 第 1–2 步按**当时的**栈顶模式查 KEYMAP 翻译并 dispatch，所以同一帧连按两个键时第二个键按第一个键生效后的模式解释（Tab 后紧跟 J）。键盘自动重复（`e.repeat`）一律丢弃：`{ t:'play' }` 等只在按下时产生一次。
- **浏览器默认按键**：在 `window` 上用**捕获阶段**监听 `keydown`；只要焦点不在文本输入框里，就对 KEYMAP 里出现的所有键（含 Tab、Space、Enter、方向键、Backspace）调用 `preventDefault()`，防止 Tab 把焦点移到 DOM 按钮后 Space/Enter 触发按钮点击。所有 DOM 按钮 `tabindex="-1"`，鼠标点击后立即 `blur()`。
- 输入只在 `document.hasFocus()` 时生效；失焦时清空按键状态。

**指针锁定策略表**（`ModeHandler.pointer`）：

| 模式 | 策略 | 说明 |
|---|---|---|
| `explore` `viewfinder` `replay` `tripod` | `lock` | 进入时若未锁定，显示 `ui/pointerGate.ts` 的“点击继续”，点击（用户手势）时 `requestPointerLock()` |
| `panel_*` `dialogue` `album`（含动作菜单与挑选器）`journal` `pause` `cutscene` | `free` | 进入时主动 `document.exitPointerLock()`（脚本主动退出的锁，之后重新锁定不必等 Esc 冷却，但仍需一次点击） |
| 面板上叠加的 `viewfinder` | `free` | 视角固定在面板视点，不需要锁定（§4.7） |

- 在 `lock` 策略的模式里发生**意外解锁**（`pointerlockchange` 且不是脚本主动退出，典型是玩家按了 Esc：锁定状态下 Chrome 用 Esc 解锁，页面通常收不到这次 keydown）→ 压入 `mode.pause`（显示暂停菜单与“点击继续”；M1d：经 `Game.requestPause()`，区域/楼层/传送的过渡期间推迟到过渡结束，§4.5）。所以“取景器里按 Esc 退出取景器”只在未锁定（`?nolock=1`、锁定不可用）时生效；锁定时 Esc 的效果是暂停，暂停菜单“继续”后回到取景器。
- `requestPointerLock()` 返回的 Promise 一律 `.catch(() => {})`，被拒绝时 1 秒后在下一次用户点击时重试；不得留下未处理的 rejection（会变成 console.error）。
- 锁定不可用（`?test=1`、`?nolock=1`、浏览器不支持）时降级：按住左键拖拽转视角（`lookDelta` 来自 `pointermove` 且 `buttons & 1`）；此时左键的“快门”在松开且拖动距离 < 4px 时才算点击。`?test=1` 下从不请求锁定。
- M4 第 2 轮：本页面**从没锁上过**、`requestPointerLock` 又连续 2 次被拒（部署在没有 `allow="pointer-lock"` 的 iframe、浏览器策略禁用）→ `InputManager.dragFallback = true`，`lockAvailable` 从此为假，走上一条的拖拽路径、收起“点击继续”，并提示一次 `STRINGS.boot.lockFallback`（“无法锁定鼠标：按住左键拖动来转视角”）。锁上过一次就不再降级（Chrome 退出锁定后约 1 秒内的正常拒绝不算）。
- M4 第 2 轮：键盘自动重复（`e.repeat`）只放行方向键与 PageUp/PageDown，而且只通知 `onButton` 监听者（文档/巡夜本连续翻页、设置页滑块连续调），不改“按住”状态、不入队；菜单页（标题/暂停/设置）开着时按下的键（Esc 除外）只给监听者、不入队（附录 A 表下注）。

```ts
// core/actions.ts
export type Action =
  | { t: 'interact' }                          // E
  | { t: 'shutter' }                           // 左键
  | { t: 'vf'; down?: boolean }                // 右键：toggle 模式下 down 省略；hold 模式下按下/松开
  | { t: 'lens' }                              // Q
  | { t: 'zoom'; dir: 1 | -1 }                 // 滚轮
  | { t: 'rewind' }                            // R
  | { t: 'present' }                           // F
  | { t: 'play' }                              // 空格（回放、录像机）
  | { t: 'advance' }                           // E/空格（对话）
  | { t: 'seekRel'; sec: number }              // 回放 Z/C = ∓5
  | { t: 'shuttle'; dir: -1 | 1; down: boolean }   // 录像机按住 Z/C
  | { t: 'stepSec'; dir: -1 | 1 }              // 逗号/句号
  | { t: 'index'; dir: -1 | 1 }                // [ ]
  | { t: 'digit'; n: number }                  // 数字键（频道、密码）
  | { t: 'choose'; k: number | NameId }        // 选项（对话 1–4、称呼 1–6 或称呼 id）
  | { t: 'wheel'; dir: 1 | -1 }                // 密码面板转轮
  | { t: 'confirm' } | { t: 'erase' }          // Enter / Backspace（挑选器里 Enter 也是 confirm）
  | { t: 'nav'; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }   // 方向键（相册/挑选器）
  | { t: 'pick'; index: number }               // 鼠标点中相册/挑选器的第 index 格（UI 发出）
  | { t: 'album' } | { t: 'journal' } | { t: 'hint' }
  | { t: 'back' };                             // Esc
export type ActionResult = ApiResult & { pass?: true };   // pass=true 表示栈顶不处理，交给下一层
export type KeyBinding = (down: boolean) => Action | null;   // M1a 补写：别名
export const KEYMAP: Record<ModeId, Partial<Record<Button, KeyBinding>>>;
```

`KEYMAP` 逐格照抄 GDD §10.1（本文附录 A 给出模式 × 动作矩阵，含动作菜单与挑选器的 1/2、方向键、Enter、左键、Esc）。

```ts
// core/modes.ts
export interface ModeHandler {
  readonly id: ModeId;
  readonly transient: boolean;              // replay/panel_*/dialogue/cutscene/tripod/album/journal 为 true：推迟存档（GDD §3.13）
  readonly freezesWorld: boolean;           // pause/album/journal 为 true：栈顶时 step 跳过模拟（§3.2）
  readonly pointer: PointerPolicy | ((stack: readonly ModeId[]) => PointerPolicy);   // 见 §4.6 策略表；viewfinder 叠在面板上时为 'free'
  readonly camera: ModeCamera;              // ModeCamera = 'tp' | 'fp' | 'fixed' | 'inherit'
  readonly move: ModeMove | ((stack: readonly ModeId[]) => ModeMove);   // ModeMove = 'normal' | 'slow' | 'body' | 'none'；M1a：允许按栈求值（viewfinder 叠在面板上时为 'none'）
  readonly look: boolean | ((stack: readonly ModeId[]) => boolean);   // viewfinder 叠在面板上时为 false
  enter(prev: ModeId | null, arg?: unknown): void;
  exit(next: ModeId | null): void;
  handle(a: Action): ActionResult;          // 不合法返回 { ok:false, reason:'mode_disallows' }
  update?(dt: number): void;
}
export class ModeStack {
  readonly top: ModeId;
  readonly stack: readonly ModeId[];        // 底部永远是 mode.explore
  has(id: ModeId): boolean;
  arg<T>(id: ModeId): T | undefined;        // 该模式进入时的参数（如 album 的 pick）；同一模式在栈上有多层时取最上面一层
  push(id: ModeId, arg?: unknown): ApiResult;   // M1c 写明：允许同一模式叠多层（对话 → 过场 → 对话：[…, dialogue, cutscene, dialogue]，§6.13/§6.14）；只有 pause 不叠两层
  pop(expect?: ModeId): ApiResult;
  popToBase(): void;                        // 弹到 explore 或 viewfinder（回放 → viewfinder）；不弹对话/过场/三脚架（它们由各自系统结束）
  resetTo(id: 'mode.explore'): void;        // 先 effects.cancelAll('reset')，再逐层 exit
  dispatch(a: Action): ActionResult;        // 栈顶 handle；pass=true 时交给下一层（例如 H 在各模式都可用）
  isTransient(): boolean;                   // 栈上任一模式 transient
  freezesWorld(): boolean;                  // 栈顶模式 freezesWorld
  // —— M1a 补写 ——
  register(h: ModeHandler): void;           // Game 构造时为 13 个模式各登记一次（同 id 重复在 dev 下抛错）
  handler(id: ModeId): ModeHandler | undefined;
  moveMode(): ModeMove;                     // 栈顶按栈求值后的移动方式（Game.step 传给 player.update）
  lookEnabled(): boolean;                   // 栈顶按栈求值后视角是否可用
  update(dt: number): void;                 // §3.2 第 3 步：栈顶（及 overlay 允许的下层）模式的 update
}
export type ModeCamera = 'tp' | 'fp' | 'fixed' | 'inherit';   // M1a 补写：别名
export type ModeMove = 'normal' | 'slow' | 'body' | 'none';   // M1a 补写：别名
```

典型栈：`[explore]`、`[explore, viewfinder]`、`[explore, viewfinder, replay]`、`[explore, viewfinder, dialogue]`（与阴物对话）、`[explore, album{menu}]`（动作菜单）、`[explore, album{pick}]`（出示/使用挑选器）、`[explore, viewfinder, album]`（取景器中按 Tab；在这里点开文档 = 取景器中翻开，显褪字）、`[explore, dialogue]`（强制对话：支架确认、楼梯井）、`[explore, panel_vcr]`、`[explore, panel_vcr, viewfinder]`（面板叠加取景器：相机用面板视点，传输键仍有效）、`[explore, panel_console, viewfinder]`、`[explore, panel_code]`、`[explore, tripod]`、`[explore, cutscene]`、`[explore, pause]`。

**叠加规则**：`viewfinder` 在 `panel_vcr/panel_console` 之上时：
- 未处理的传输键动作（`play`、`shuttle`、`stepSec`、`index`、`digit`）以 `pass` 下传给面板；
- `interact`（E）与 `back`（Esc）也以 `pass` 下传给面板，由面板执行“离开面板”（同时弹掉上面的取景器），不会去交互世界里的物体（GDD M6：E/Esc 离开面板）；
- 右键 `vf` 退回面板；
- 按键翻译只查**栈顶**模式的 KEYMAP 行，所以面板的传输键与频道数字键（Space、按住 Z/C、逗号/句号、[ ]、Digit0–9）同时写在 `mode.viewfinder` 行里（M1c 写明，engine-wp1.md #9）：`ViewfinderMode.handle` 叠在面板上时对它们返回 `{ ok:false, pass:true }`，不在面板上时返回 `mode_disallows`；
- 视角禁用（`look` 为假）：鼠标不转动相机，相机固定在面板视点；调试 API `aimAt` 在这种叠加下不改玩家的 yaw/pitch，只计算并返回目标是否 `inFrame`（§12.3）。

### 4.7 图层与相机（`core/layers.ts`、`core/cameras.ts`）

```ts
export const LAYER = { world: 0, yin: 1, faded_text: 2, self_head: 3, self_sticker_vf: 4, replay: 5, ir_only: 6 } as const;
export type LayerName = keyof typeof LAYER;
export function setLayerRecursive(obj: THREE.Object3D, layers: LayerName | LayerName[]): void;   // 覆盖式设置，含子孙；**跳过 isLight**（灯永远 enableAll）
export function addLayerRecursive(obj: THREE.Object3D, layer: LayerName): void;      // 同样跳过灯
export function removeLayerRecursive(obj: THREE.Object3D, layer: LayerName): void;   // 同样跳过灯
export function isRenderableBy(obj: THREE.Object3D, cam: THREE.Camera): boolean;   // 自身与祖先 visible 且（自身或任一可见子孙中的可渲染节点——isMesh/isLine/isPoints/isSprite）layers.test(cam.layers)；Group/Object3D/灯的图层不算（three 的 projectObject 逐节点测图层、对子节点照样递归，所以根节点留在 world 层、网格只在 yin 层的主体对 fp 相机不可渲染）；回放让位与 hideWorld 用 visible=false 实现，因此自动算作不可见

export type CamRole = 'tp' | 'fp' | 'mirror' | 'ch1' | 'ch2' | 'fixed' | 'tripod' | 'tape';
export function layerMaskFor(role: CamRole, o: { vf: boolean; lens: LensMode; replay: boolean; extra?: readonly LayerName[] }): LayerName[];
```

| 相机 | 启用的图层 |
|---|---|
| 第三人称 `tp` | world、self_head |
| 取景器 `fp`，常光 | world、yin、faded_text（回放中再加 replay）；**不含** self_head |
| 取景器 `fp`，红外 | world、yin、ir_only（回放中再加 replay）；**不含** faded_text、self_head |
| 镜像相机 `mirror` | world、self_head；取景器开启时再加 yin、faded_text、self_sticker_vf |
| CH2 实时画面 `ch2` | world、self_head（开场 CH2 里看得见自己的摄像头脑袋，GDD §2.2、§3.14） |
| 过场固定机位 `fixed` | world、self_head，再加 `CutStep.cam.layers` 指定的（如 yin、replay） |
| CH1 机位 `ch1`、三脚架 `tripod` | world（过场可按需加 yin）；**不含** self_head——这两个机位正好在头的位置上（头装回支架后，或 CH1 = 取景器画面时） |
| 录像带画面 `tape` | 不用主场景：`tapeScene` 是独立的 `THREE.Scene`（§6.10），用它自己的相机与图层；主角与 2026 年的一切都不会进带子 |

- **self_head 层的内容**：整颗摄像头头部（外壳、镜头、贴条底纸、铁皮帽、视频线）**连同从领口托头的支架圆柱**。取景器往下看时只看得见身子，不会看到贴着近裁面的支架。
- **灯光**：WebGLRenderer 也按 `camera.layers` 过滤灯光，所以**所有灯光**在加入时执行 `light.layers.enableAll()`（`ctx.light()` 自动做），且 `setLayerRecursive/add/remove` 一律跳过 `isLight`，否则 tp 与 fp 看到的灯数不同，每次开关取景器都会触发全量着色器重编译。
- **灯不挂在会被隐藏的节点下**：r186 的 `projectObject` 遇到 `visible === false` 直接返回，挂在隐藏父节点（不在场的 NPC、R2 楼层节点、`viewVariant` 变体）下的灯不计入，灯数一变就重编译。`ctx.light()` 只接受 `root` 或 `ctx.lightsRoot`（永不隐藏）作父节点，dev 下违反即抛错；NPC 身上的灯（土地灯笼、REC 点光）由 `NpcDef.lights`/区域 update 每帧把灯的位置同步到锚点（§6.7）。dev 下每帧断言本区压入渲染的灯数恒定。
- **阴物常显**：阴物在取景器里被交互过（`state.seen(id)`），`NpcSystem` 给它追加 world 层并换半透明魂影材质。
- **按视图换造型**（黄三爷面具、底片正负像等）：用 `ctx.viewVariant(obj, { naked, vf, ir })`，由引擎在视图/镜头变化时切换各变体的 `visible`（不新增图层）。变体节点下不得挂灯。
- **辅助 RT 排除项**：`userData.auxHide = true` 的对象（雨、近处粒子）在镜面与 CH2 的 RT 渲染期间临时隐藏，控制 draw call。

```ts
export class CameraRig {
  readonly tp: THREE.PerspectiveCamera;       // fov 60，near 0.05，far 200
  readonly fp: THREE.PerspectiveCamera;       // 1× 时垂直 fov 50（视口比例 ≥ 4:3 时）；变焦用 camera.zoom
  readonly fixed: THREE.PerspectiveCamera;    // 过场、三脚架、面板视点、截图
  readonly photo: THREE.PerspectiveCamera;    // 与 fp 同位姿、同 zoom，aspect 固定 4/3，视场由屏幕上的 4:3 画框矩形推导（判定与缩略图）
  active: 'tp' | 'fp' | 'fixed';
  fixedRole: 'fixed' | 'ch1' | 'tripod';      // fixed 相机当前扮演的角色（决定图层掩码）
  get camera(): THREE.PerspectiveCamera;      // 当前主相机
  setFixedPose(p: CameraPose, blendSec?: number, o?: { role?: 'fixed' | 'ch1' | 'tripod'; layers?: readonly LayerName[] }): void;
  setZoom(z: ZoomLevel): void;                // fp.zoom = z，同步 photo
  applyLayerMasks(o: { vf: boolean; lens: LensMode; replay: boolean }): void;
  setViewport(w: number, h: number): void;    // 窗口/DPR 变化时由 RenderPipeline 调用（见下）
  frameRect(): { x: number; y: number; w: number; h: number };   // 4:3 画框在屏幕上的矩形（UI 与判定共用）；M1c 写明：#app 内的 CSS 像素（不乘 DPR/动态分辨率）
  sync(): void;                               // 立即按 player 的 yaw/pitch 更新 fp/tp 矩阵（aimAt 后调用）
  update(dt: number): void;
}
```

- **第三人称**：相机在角色身后 2.6m、高 1.9m、右偏 0.5m；俯仰 -35°～+50°；从头部枢轴（脚底上方 1.6m）向期望位置做 `collision.raycast`，命中则拉近到 `命中距离 - 0.2`，最近 0.9m；拉近立即、放远平滑（0.3s）。
- **取景器**：相机位置 = 镜头点（离地 1.85m，`PC_DIMS.lensY`；M1c 写明：取 `PlayerController` 的 eye = 脚底 + 1.85 + 沿水平朝向前移 `LENS_FORWARD` 0.18m，不读模型的 `lensAnchor`，§5.2）；朝向只由 yaw/pitch 决定（不跟随行走起伏）；俯仰 -60°～+60°；取景器中移动 1.2m/s。
- **面板视点**：`panel_vcr`/`panel_console` 的相机 = 面板配置的 `viewPose`（离 CRT 约 0.5m）；在面板上叠加取景器时，`fp` 直接取该视点（“自动对准 CRT”），视角禁用（§4.6 叠加规则）。面板模式用 `setFixedPose(viewPose, 0.3, { role: 'ch1' })`（M1c 写明，engine-wp5.md #2）：面板是肉眼看屏幕，只该有 world 层，而视点正好在玩家头附近，`fixed` 角色的掩码含 `self_head` 会把自己的头拍进来；`ch1` 角色的掩码恰好是 world。以后若给 ch1 角色加专属东西，要先给面板另立角色。
- **窗口尺寸**：画框是视口中央最大的 4:3 矩形。视口比例 ≥ 4:3 时画框与视口同高，fp 垂直 fov 50；比例 < 4:3（竖屏、窄窗口）时画框与视口同宽，fp 的垂直 fov 按“画框宽度对应的水平视场 = 4:3 下 fov 50 的水平视场”反推（`vfov = 2·atan(tan(25°)·(4/3)/aspect)`），保证玩家在画框里看到的内容与 `photo` 相机判定的一致。`photo` 相机总是 aspect 4/3、垂直 fov 50（乘 zoom）。

### 4.7.1 尺寸与像素比（`core/render.ts`）

- 用 `ResizeObserver` 监听 `#app`，另用 `matchMedia('(resolution: <当前 DPR>dppx)')` 的 change 事件监听 DPR 变化（换显示器、浏览器缩放），两者都走同一个 150ms 防抖的 `resize()`：`renderer.setPixelRatio(min(DPR, 当前档上限) × 动态分辨率系数)` → `renderer.setSize` → `composer.setSize`、`bloom.setSize` → `cameras.setViewport` → CameraFxPass 的 `frame43` 画框 uniform → UI 画框 DOM（`frameRect()`）。
- 动态分辨率见 §13.2。

### 4.7.2 渲染管线（`core/render.ts` 的 `RenderPipeline`，WP1）

镜面（WP5 `MirrorSystem`）、CH1/CH2（WP5 `ConsoleSystem`）、录像带（WP5 `VcrSystem`）这些辅助 RT 由各系统实现 `AuxFeed` 并注册，`RenderPipeline` 只负责按帧调度；RT 本身从 `fx/feeds.ts` 的 `acquireFeed()` 取（§8.5）。

```ts
export interface AuxFeed {
  key: string;                                     // 'mirror' | 'ch1' | 'ch2' | 'tape'（同 key 重复注册在 dev 下抛错）
  due(frameNo: number): boolean;                   // 本帧要不要渲（镜面每 every 帧且 activeWhen 为真；CH1 视频线插上时每帧；CH2 按 every；tape 只在 panel_vcr 在栈上时）
  render(r: THREE.WebGLRenderer): void;            // 渲进自己的 RT（自己负责乒乓 swap、渲染期间隐藏自身屏幕与 auxHide 对象，§6.11）
}
export function createRenderer(canvas?: HTMLCanvasElement): THREE.WebGLRenderer;   // M1a 补写：§13.1 的设定；WebGL2 不可用时抛 NoWebGL2Error（同文件导出，§3.1、§4.4）
export class RenderPipeline {
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cameras: CameraRig, post: PostPipeline);
  readonly post: PostPipeline;                     // M1a 补写：GameApi.post、ViewfinderSystem 的 vf/ir 叠加预设都经由它
  addFeed(f: AuxFeed): () => void;                 // 返回注销函数；系统在 configure/register 时注册，离开区域时注销
  readonly feeds: readonly AuxFeed[];              // 当前注册的 feed（warmupArea 预热用，§8.5）
  render(dt: number): void;                        // 每帧：依次调用到期 feed 的 render → 主场景经 PostPipeline 合成；动态分辨率采样
  resize(): void;                                  // §4.7.1
  setQuality(q: 'low' | 'mid' | 'high'): void;     // §13.2
  setDynamicResolution(on: boolean): void;         // M1a 补写：?test=1 与截图时关闭
  stats(): { lights: number; lightsOn: number; renderScale: number; callsMain: number; trisMain: number };   // 当前压入渲染的真实灯数 / 其中强度 > 0 的数目 / 动态分辨率系数；M1c：callsMain/trisMain = 最近一帧主场景（RenderPass 前后取差，= post.sceneStats）的 draw call 与三角面；perf() 的来源（§12.3）
}
```

`Game.renderNow()` 同步渲染一次主场景（`RenderPipeline` 内部的 `renderMain(0)`，不调度 feed）。

**`render(dt)` 的 dt（M1c 补写，engine-wp1.md #10、engine-wp3.md #4）**：dt 是“自上次渲染以来累计的游戏时间”——非锁步时就是本帧 dt；锁步 rAF 在两次 API 调用之间传 0；`advance()` 结束时渲染的那一帧传整段累计。`PostPipeline.render(dt)` 的**动画时间**（颗粒按 24fps 换样、VHS、频闪、魂影/回放人影/纸像的微光，经 `fx/ghostMaterials.ts` 的 `FX_TIME`）只累加这个 dt，游戏时间停住画面也停住，锁步截图可复现；**过渡时间**（push/pop 的 fadeSec、白闪衰减）dt > 0 时用 dt，dt === 0（锁步 rAF、`renderNow()`）时用两次 render 之间的真实时间（上限 0.1s），否则锁步下白闪永远不退。区域切换的黑场用 DOM 的 `ui.fade.black()`，与后期无关。`MirrorSystem`、`ConsoleSystem`、`VcrSystem` 各自在 `register`/`configure`/`open` 时 `game.pipeline.addFeed(...)`。

### 4.8 碰撞（`core/collision.ts`）

**方案**：three/addons 的 `Octree` + `Capsule`（与官方 games_fps 示例同构）。

```ts
export type DynamicShape = { box: { center: V3; size: V3; rotYDeg?: number } } | { wall: { a: XZ; b: XZ; y0: number; height: number; thickness?: number } };
export interface DynamicColliderHandle { readonly key: string; readonly enabled: boolean; refresh(): void; remove(): void }
export class CollisionWorld {
  readonly octree: Octree | null;
  build(colliderRoot: THREE.Object3D): void;       // new Octree().fromGraphNode(colliderRoot)；colliderRoot 不加入场景
  rebuild(): void;                                 // 备选：按当前 colliderRoot 重建 Octree（本项目区域三角面少，毫秒级）
  clear(): void;                                   // 同时清空动态碰撞体
  addDynamic(key: string, shape: DynamicShape, enabled: (s: StateView) => boolean, o?: { seeThrough?: boolean }): DynamicColliderHandle;
  capsule(c: Capsule): { normal: THREE.Vector3; depth: number } | false;   // 先测 Octree，再测启用中的动态 OBB（胶囊 vs 盒子，取最深者；seeThrough 的照样挡人）
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, far: number, o?: { skipSeeThrough?: boolean; ignoreKeys?: readonly string[] }): { distance: number; point: THREE.Vector3; key?: string } | null;
  // 同样包含启用中的动态碰撞体（命中时返回其 key）；skipSeeThrough：跳过 seeThrough 的动态碰撞体（玻璃门）；ignoreKeys：跳过这些 key 的动态碰撞体（视线检查时跳过目标自身，如 r1.gate）
  reachable(from: V3, to: V3, level?: number): boolean;   // 栅格 flood-fill（§4.5 goto 的连通性检查；仅 ?test=1 使用）。0.25m 格；M1d 更正：测试胶囊半径 = PLAYER_RADIUS − 5mm（0.295，原 0.28 会放过 0.56–0.6m 的窄缝），胶囊底离地 STEP_MAX + 1cm（不高于 STEP_MAX 的门槛/路沿不算障碍，玩家控制器一定迈得过去）；格子按需测试（flood-fill 到目标为止）并按“碰撞体版本号 + 层高”缓存；from 与 to 高差 > 1.2m 直接 false（楼层之间由 goto 经楼梯口分两段测）
}
export const PLAYER_RADIUS = 0.3;   // M1d 补写：玩家胶囊半径（PlayerController 与连通性栅格共用）
export const STEP_MAX = 0.15;       // M1d 补写：最大门槛/路沿高度——控制器直接迈上去、栅格放行；要挡人的矮墙/花坛边请高于 0.2m
export interface ColliderBuilder {
  box(center: V3, size: V3, rotYDeg?: number): void;
  wall(a: XZ, b: XZ, y0: number, height: number, thickness?: number): void;   // 默认厚 0.2
  floor(x0: number, z0: number, x1: number, z1: number, y?: number): void;    // 地面（薄盒）
  mesh(m: THREE.Mesh): void;                       // 克隆几何并烘焙世界矩阵（不能是 InstancedMesh）
  instanced(m: THREE.InstancedMesh): void;         // 逐实例展开成普通 Mesh 后加入
  dynamic(key: string, shape: DynamicShape, enabled: Cond, o?: { seeThrough?: boolean }): DynamicColliderHandle;   // 可开关的碰撞体：院门、照相馆玻璃门……；seeThrough = 挡人但不挡视线（玻璃）
}
```

- **几何约定（M1c 补写，engine-wp1.md #4、engine-wp2.md #1）**：所有 `rotYDeg`（`ColliderBuilder.box`、`DynamicShape` 的 `box`、`kit/geom.box`）与 `kit/instancing.scatter` 的 `rotY` 都与 three 的 `object.rotation.y` 同义——**度**、绕 +Y、俯视逆时针为正，**不是** yaw（§1.3：`rotation.y = -yaw`）；所以区域可以把同一个数同时传给视觉盒子与碰撞盒。`wall(a, b, y0, height, thickness = 0.2)`（ColliderBuilder 与 `DynamicShape` 相同）是以线段 a→b 为中心线、局部 x 轴对齐 a→b 的竖直盒子，底在 y0。`kit/doors.ts` 的 `DoorRig.collider` 用 `wall` 形状（世界 XZ 的门框两侧），不依赖角度约定。
- 碰撞体放在**不加入场景**的 `colliderRoot` 里（Octree 构建会遍历不可见网格；不放进场景可避免它们被渲染或被拍照射线命中）。
- 碰撞体用简单盒子/墙片即可，**不要**把视觉网格整体塞进 Octree（三角面多、构建慢）。
- **动态碰撞体**：`ctx.collider.dynamic(key, shape, enabled)` 登记一个小列表（每区 ≤ 16 个）；`CollisionWorld` 在每个子步查完 Octree 后再测这些 OBB，并在收到 `'flag'`/`'temp'` 事件时重新求值 `enabled`。例：R1 院门 `ctx.collider.dynamic('r1.gate', gateDoor.collider, '!r1.gate_unchained')`；R3 玻璃门 `ctx.collider.dynamic('r3.shop_door', shopDoor.collider, '!r3.lu_door_open', { seeThrough: true })`。`kit/doors.ts` 的 `DoorRig.collider` 就是为此准备的形状。动态碰撞体的 key 用它所挡的交互物 id（如 `r1.gate`、`r3.shop_door`），这样调试 API 的视线检查可以用 `ignoreKeys: [目标 id]` 跳过目标自身的碰撞体（§12.3）。
- **透明碰撞体**：`seeThrough: true` 的动态碰撞体照样挡人（`capsule`、`walkTo`、`reachable` 都算），但 `raycast(…, { skipSeeThrough: true })` 跳过它。与渲染网格的 `userData.noOcclude`（拍照遮挡与准星聚焦用，§6.6、§6.8.4）是两套东西：玻璃门的门扇网格设 `noOcclude`，它的动态碰撞体设 `seeThrough`，二者都要写。嵌在静态碰撞体里的交互物（如桌内抽屉 `r1.drawer`）的锚点要么在碰撞体外，要么在朝向玩家的碰撞面以内不超过 0.15m（视线检查的 `far = 距离 − 0.15`）。
- 出入口触发体不负责挡人；“条件不满足时推回 0.6m”只用于出口本身（`ExitDef.blocked`）。真正要挡住玩家的地方一律用动态碰撞体。
- 楼梯不可行走（GDD：楼梯用触发体积/交互切换）。所有可行走面都是水平面。**门槛/路沿/门口台阶**（M1d）：高 ≤ `STEP_MAX`（0.15m）的可以直接放，玩家走得上去、`goto` 也放行；0.15–0.2m 之间的不要用（栅格与控制器的余量只有几厘米）；要挡人就 ≥ 0.2m 或用墙/动态碰撞体。
- R2 五个楼层都在同一个 Octree 里（各自 y 不同，互不干扰）；连通性栅格按楼层分层，楼层之间经楼梯口连通。

### 4.9 玩家控制器（`core/player.ts`）

```ts
export class PlayerController {
  readonly capsule: Capsule;                  // 半径 0.3；start=(x, y+0.3, z)，end=(x, y+1.45, z)
  readonly position: THREE.Vector3;           // 脚底
  readonly velocity: THREE.Vector3;
  yaw: number;                                // 视角 yaw（度）
  pitch: number;                              // 视角 pitch（度）
  bodyYaw: number;                            // 身体朝向（第三人称下平滑转向移动方向；取景器下 = yaw）
  onGround: boolean;
  enabled: boolean;
  speedWalk: 2.2; speedRun: 3.6; speedSlow: 1.2;  // m/s
  update(dt: number, move: MoveInput, mode: 'normal' | 'slow' | 'body' | 'none'): void;
  teleport(pos: V3, yaw?: number): void;      // 重置速度与胶囊
  lookAtPoint(p: THREE.Vector3, via: 'fp' | 'tp'): { clamped: boolean };   // 设 yaw/pitch，使该相机中心射线穿过 p（迭代修正镜头偏移；M3：迭代到收敛（≤12 次，变化 < 0.01°），原来固定 3 次，第三人称从差 150° 的朝向在小屋里转过来收不拢，docs/requests/r3.md #7）；pitch 按该视角的俯仰限制钳制（tp -35°～+50°，fp -60°～+60°），被钳制时 clamped=true
  faceTowards(p: THREE.Vector3): void;        // 只改 yaw 与 bodyYaw
  walkTo(x: number, z: number, o?: { timeoutSec?: number }): Promise<{ ok: boolean; pos: V3 }>;   // 沿直线把 MoveInput 喂给 input.setMove()，经正常 update 与碰撞；到达 0.2m 内成功，1 秒无进展判为被挡
  get eye(): THREE.Vector3;                   // 镜头世界坐标
  get forward(): THREE.Vector3;
}
```

- 物理：重力 20 m/s²，没有跳跃。每帧 5 个子步：`velocity` 积分 → `capsule.translate` → `collision.capsule()`（Octree + 动态碰撞体）。M1d 按实现写明：接触法线 `y > (R − STEP_MAX − 0.02)/R`（≈ 0.43，底球碰到高 ≤ STEP_MAX + 2cm 的棱）当地面——只竖直推出 `depth / n.y`（单次 ≤ 0.2m），不动水平速度，于是门槛/路沿直接迈上去；更斜的接触当墙沿法线推出并去掉朝墙的水平速度；`n.y > 0.1` 即着地、消除向下的速度。
- 三脚架模式（`move === 'body'`）时，同一控制器驱动**没有头的身体**，移动方向相对固定机位相机。

---

## 5. 角色模型（`src/rigs/`）

所有角色都由基础几何体拼成，**不做骨骼蒙皮**。关节是嵌套的 `Group`，动画只转关节。

### 5.1 程序化人身（`rigs/humanoid.ts`、`rigs/poses.ts`）

```ts
export type JointName = 'hips' | 'spine' | 'neck' | 'headSlot'
  | 'shoulderL' | 'elbowL' | 'shoulderR' | 'elbowR' | 'hipL' | 'kneeL' | 'hipR' | 'kneeR';
export interface HumanoidSpec {
  height: number;                                   // 标称身高（含人头时的身高，决定各部件比例）：1.75 主角/老周；1.2 土地；1.4 黄三爷。head:'none' 时身子只到领口（主角领口 1.50，PC_DIMS.collarY）
  build?: 'normal' | 'slim' | 'stout' | 'hunch';    // hunch：脊柱前倾 12°、肩下沉
  shirt: THREE.ColorRepresentation; pants: THREE.ColorRepresentation; shoes?: THREE.ColorRepresentation;
  skin?: THREE.ColorRepresentation;
  sleeves?: 'short' | 'long';
  robe?: boolean;                                   // 长袍（土地）：腿部换成 Lathe 下摆
  head: 'none' | 'human' | 'camera' | 'weasel';     // 'none' = 留空 headSlot 由外部挂载
  material?: 'standard' | 'ghost' | 'replay' | 'silhouette';
}
export interface HumanoidRig {
  readonly root: THREE.Group;                       // 原点在两脚中间地面，面朝 -z
  readonly joints: Readonly<Record<JointName, THREE.Group>>;
  readonly height: number;
  setPose(p: Pose, blendSec?: number): void;        // 默认 0.3s 过渡
  update(dt: number, speed: number): void;          // speed>0.1 时播放行走循环，否则保持姿势并轻微呼吸
  setMaterialMode(m: 'standard' | 'ghost' | 'replay' | 'silhouette', color?: THREE.ColorRepresentation): void;
  setOpacity(a: number): void;                      // 淡入淡出（护送换层、化光）
  bounds(target: THREE.Box3): THREE.Box3;           // 拍照判定用
  dispose(): void;
}
export function createHumanoid(spec: HumanoidSpec): HumanoidRig;
```

- **行走循环**（`update`；M1c 按 WP2 的实现更正，engine-wp2.md #6）：`phase += speed / stride * dt * π`（`stride = 0.75 * height/1.75`，每走一个 stride 是半个左右脚周期，单步 ≈ 0.76m，与髋 ±0.45rad、腿长 0.87m 一致；原写 2π 会让 2.2m/s 时每秒近 6 步）；髋 `±0.45·sin(phase)` rad；膝在**摆动相**屈：左 `max(0, cos(phase + 0.53))·0.9 + 0.08`、右相位差 π；肩与髋反相 `∓0.35`，肘恒屈 0.25；脊柱/骨盆绕 y 小幅反向扭转；身体起伏 `-|sin(phase)|·0.03`（双脚分开时最低）。停步时 0.2s 内收回。
- **姿势表**（`poses.ts`）：`stand`/`walk`/`sit`（大腿水平前伸、小腿垂直，身体下移 0.45×高度比）/`crouch`/`raise_arm`（右臂上举约 150°）/`carry`（双臂前伸 60°）/`lie`（整体绕 x 轴 90°，担架用；老周趴桌用 `sit` + 角色变体 `zhou:'slump'`）/`look_up`（抬头约 35°）。**角度符号**（M1c 写明）：人偶面朝 -z，按 three 右手系，下垂的肢体往前（-z）摆是绕 X **为正**（髋前屈、肩前举、肘屈为正，膝屈为负；躯干绕 X 为负 = 弯腰；颈绕 X 为正 = 抬头），所以 `poses.ts` 里的数与“前屈为负”的口语描述符号相反（文件头写明）。回放人影只在关键帧之间做姿势混合（GDD §3.6）。
- **人物细化（2026-10-06）**：四肢用样条轮廓的 `LatheGeometry`（圆肩、前臂收口、裤腿粗细变化），掌骨、四指与拇指合并为一个网格；鞋用圆角鞋楦。躯干肩部跨 UV 接缝平滑法线。头部增加眼窝、颧骨、下颌、圆鼻梁与细眼睑，脸贴图 512×384；素色衣料增加 256² 缝线/褶皱图。土地胡须为单个带发丝贴图的体积网格，眼镜改细框。仍不用骨骼蒙皮；关节坐标、身高、拍照锚点、配件接口不变。
- 共享几何：同一尺寸/外观的部件缓存复用。**袍摆例外**：每个人偶克隆自己的几何，在坐/站过渡时插值成盖住大腿、膝盖并垂下的连续衣片；只有弯曲权重变化时更新顶点/法线/包围盒，不缩扁整条裙摆，不影响同款站立人物。私有袍摆由人偶 `dispose()` 释放。
- **draw call 成本（2026-10-06 更新）**：按关节保留网格，同一关节同材质的细节合并；头部五官、手指和胡须纹理不各自拆成 draw call。五张 look-dev 的主场景最高 203/250；实景群像 `shot.r1.old1_replay` 为 52 次主场景绘制、121236 个整帧三角面。镜面与 CH2 会重复绘制角色，人多的场景仍优先用 `rigs/crowd.ts`/纸人、远处用剪影；不要通过拆分细节网格提高精度。
- `root.userData.fadeCapable = true`（M1d）：`setOpacity(< 1)` 会把非着色器材质切成 `transparent`（r186 的程序按 opaque 区分），`warmupArea` 据此把这些材质的透明变体也预热一遍（§8.5），P14 与 NPC `fadeTo` 的第一帧不现场编译。
- `dispose()`（M3 补写，docs/requests/r4.md #5）：释放子树里 `Mesh`、`Line`、`Points` 的非缓存几何；线/点的材质不在人偶自己的 owned 列表里，非共享的也在这里释放（黄鼬头的胡须 `LineSegments` 原来每建一次漏一份）。

### 5.2 主角（`rigs/cameraHead.ts`、`rigs/player.ts`）

```ts
/** GDD §2.7 的关键高度（离地，米）。镜面、取景器、读字、第一人称相机都按这组数，别处不得另写常量。 */
export const PC_DIMS = {
  bodyH: 1.75, collarY: 1.50,            // bodyH：人体模板标称身高（= HumanoidSpec.height，含人头时的身高）；实际身子顶端 = collarY 1.50（领口）
  headBottomY: 1.77, headTopY: 1.99,     // 外壳底边、顶边
  lensY: 1.85,                           // 镜头中心 = 取景器视点
  stickerY: 1.93,                        // 脑门贴条中心
  hatTopY: 2.00,                         // 铁皮帽顶
} as const;
/** M1a 补写：后脑视频线（摆锤链 + BNC 插头；实现见下文 M1c 补写） */
export interface CableRig {
  readonly group: THREE.Group; readonly plug: THREE.Object3D; update(dt: number): void;
  readonly plugged: boolean;                     // M1d 补写：插头此刻挂在别的节点上（插在插孔里）
  plugTo(to: THREE.Object3D | null): void;       // M1d 补写：挂到插孔节点下（插头沿节点本地 −y 插入；插着时改在 world 层）/ null = 拔出、线重新下垂；离开区域时引擎自动拔出
}
export interface CameraHead {
  readonly group: THREE.Group;           // 整颗头（layer.self_head，递归）
  readonly neck: THREE.Mesh;             // 从领口托头的支架圆柱（1.50→1.77），同样在 self_head 层
  readonly lensAnchor: THREE.Object3D;   // 镜头中心（第一人称相机位置）
  readonly stickerAnchor: THREE.Object3D;// 贴条中心（镜中读字的实物点）
  readonly lensRing: THREE.Mesh;         // 变焦时转动
  readonly recLed: THREE.Mesh;           // 每秒闪一次（emissive 开关，不用灯；R2 的 REC 点光由区域放在 lightsRoot 下每帧跟随，§4.7）
  readonly sticker: THREE.Group;         // 脑门贴条：底纸在 self_head 层；字迹平面在 self_sticker_vf 层
  readonly tinHat: THREE.Mesh;           // 弯折 Plane + 罐头铁皮 CanvasTexture（锈斑、半行“红烧扣肉”）
  readonly cable: CableRig;              // 后脑视频线：6 节短圆柱链 + BNC 插头，摆锤模拟
  setZoom(z: ZoomLevel): void;           // 镜头环转到对应角度
  setLook(yawOffsetDeg: number, pitchDeg: number): void;  // 取景器中头随视角转；探索时空闲云台扫描
  update(dt: number, o: { moving: boolean; scanning: boolean; recBlink: boolean }): void;
  detach(): THREE.Group;                 // 三脚架模式：从颈部摘下（返回 group 供挂到门楣支架）
  reattach(): void;
}
export interface PlayerModel {
  readonly root: THREE.Group;            // 加入场景后跨区域常驻
  readonly body: HumanoidRig;            // 藏蓝短袖衬衫 #2E3A55、左臂红袖箍“值勤”、深灰裤、黑布鞋；head:'none'
  readonly head: CameraHead;             // 由颈部支架圆柱托住
  readonly blob: THREE.Mesh;             // 圆形假阴影
  readonly headMounted: boolean;         // 头是否在身子上（三脚架与结局中为 false）
  setPose(p: Pose, blendSec?: number): void;        // 开场坐在椅子上（sit）等；移动时自动回到 walk/stand
  setBodyOpacity(a: number, sec?: number): void;    // P14“身子一点点空下去”（淡出时切透明材质，结束后恢复）
  setVisible(v: boolean): void;                     // 尾声：身体不见，头留在支架上
  stickerWorld(target?: THREE.Vector3): THREE.Vector3;   // 贴条中心的世界坐标
  update(dt: number, p: PlayerController, mode: ModeId): void;
  reset(): void;                                    // M1d 补写：换一局（新游戏、读档、回标题）时由 Game 调用——可见、不透明、站姿、头装回、视频线拔出；区域不调用
}
export function createPlayerModel(): PlayerModel;
```

**M1a 补写**：`rigs/blobShadow.ts` 导出 `createBlobShadow(radius?: number, opacity?: number): THREE.Mesh`（贴地圆形暗斑，默认 0.35/0.45，`depthWrite:false`、`irHide`、`auxHide`；NPC 与区域道具也可用）。`HumanoidSpec.material` 与 `setMaterialMode` 的取值另以 `export type HumanoidMaterialMode = 'standard' | 'ghost' | 'replay' | 'silhouette'` 导出。`rigs/cameraHead.ts` 的 `createCameraHead()`、`rigs/poses.ts` 的 `POSES`/`PoseDef`、`rigs/accessories.ts` 的 `ACCESSORIES` 是 WP2 内部模块，不属于冻结签名（其他 WP 经 `PlayerModel.head`、`HumanoidRig.setPose`、`CharacterRig.props` 使用）。

- 头部尺寸按 GDD §2.7：外壳 `RoundedBoxGeometry(0.20, 0.22, 0.34, 2, 0.02)`（宽 x 0.20 × 高 y 0.22 × 长 z 0.34，长边沿镜头朝向），底边离地 1.77、顶边 1.99；前脸下半是镜头 `Cylinder r0.06`（中心 1.85），前脸上半贴条约 0.12×0.05（中心 1.93，贴条底纸只画“04.6.18”，后两字已泡没）；帽顶约 2.00；编号“012”贴纸在右侧。
- 胶囊高度（`capsule` end = y+1.45）不变，只管碰撞。**第一人称视点**（M1c 写明，engine-wp1.md #6、engine-wp2.md #9）：fp 相机、`lookAtPoint('fp')`、读字与拍照的视点一律取 `PlayerController` 的 eye = 脚底 + `PC_DIMS.lensY`（1.85）+ 沿水平朝向前移 `LENS_FORWARD`（0.18m，`core/player.ts` 导出），**不读** `lensAnchor`，保证判定不受模型动画与云台俯仰影响（§4.7“朝向只由 yaw/pitch 决定”）。`lensAnchor` 只是模型上的镜头点：俯仰 0 时与 eye 重合（世界高 1.85、在身体中轴前约 0.18m；M3 补写：镜片在云台轴前约 0.212m，`rigs/player.ts` 把 `headMount` 沿身体往后让 `0.212 − LENS_FORWARD` ≈ 3cm 才重合——原来差 3.2cm，`m1c.lens_anchor` 随呼吸在 3cm 阈值两边跳），俯仰 ±60° 时云台轴（离地 1.86、镜头在轴前约 0.21m）带着它在 1.67–2.03m 之间移动，这只影响镜中/CH2 里看到的头，不影响判定。镜中读字的实物点用 `stickerWorld()`，只在 pitch≈0 时发生。
- 视频线不要每帧重建 `TubeGeometry`，用摆锤链（M1c 按 WP2 的实现写明，engine-wp2.md #7）：7 个质点的 Verlet 链（固定步长 1/90s、每步 6 次约束迭代、出线口护套方向约束、背面碰撞并轻微贴背），渲染用一个 6 实例的胶囊 `InstancedMesh`（一次 draw call，`frustumCulled=false`）+ BNC 插头。`PlayerModel.update` 里 `head.update` 已调用 `cable.update`，别处不要再调（头挂在门楣支架上时也照常每帧 `playerModel.update`）。
- **插进 `r1.crt_jack`**（engine-wp2.md #4；M1d 起用 `cable.plugTo`，区域经 `GameApi.player.model.cable.plugTo(节点)`，§6.3）：插头挂到插孔节点下后，链的最后一个点就钉在插头的世界位置，整根线被扯向插孔（允许拉长；“离桌子 > 2m 自动拔出”由 R1 负责：`plugTo(null)` + `cctv.unplugJack()`）；`plugTo(null)` 即松开，由摆链接管。插头挂在插孔上时改在 world 层（取景器与 CH2 里都看得见），拔出时还原到 self_head。离开区域时 `AreaContextImpl.dispose()` 先 `plugTo(null)` 再释放本区资源（插头的几何与材质属于主角）。
- **M1c look-dev（冻结）**：`rigs/player.ts` 导出 `PLAYER_RIM = { color: '#6A7FA8', strength: 0.35 }`——主角身子（不含头）的材质用 `addRim`（与土地金描边同一段着色器，`customProgramCacheKey 'wp2.rim'`）加一圈很淡的冷色菲涅尔轮廓光，藏蓝衬衫在夜里不和暗地面糊成一片；`rigs/cameraHead.ts` 导出 `HEAD_ENV_BOOST`（环境反光倍率，见 §8.3），镜头镀膜贴图兼作 `emissiveMap`（自发光 0.25：夜里镜头不是一个黑洞），铁皮帽 metalness 0.45 → 0.6、roughness 0.58 → 0.5、底色 ×0.85。
- `PlayerModel.update` 在 `mode.viewfinder/replay/panel_vcr/panel_console/dialogue` 里让头跟随 `angleDiff(bodyYaw, yaw)` 与 `pitch`，在 `mode.explore` 里站着不动 1.5 秒后云台巡航扫描。

### 5.3 NPC 造型（`rigs/characters.ts`）

跨区域出现的角色（陆师傅在 R3 与 R1、王奶奶在 R2 与 R2_502、老周在录像带/回放/终章）**必须用同一个工厂**，所以全部由引擎提供：

```ts
export type CharacterKind = 'tudi' | 'wang' | 'lu' | 'huang' | 'zhou' | 'jianguo' | 'kid' | 'bride' | 'apprentice'
  | 'junkman' | 'worker' | 'neighbor';
export interface CharacterOpts {
  look?: 'live' | 'ghost' | 'replay' | 'silhouette';   // ghost：魂影材质（颜色按角色：多数 GHOST #8FD3D6，陆师傅 #E8E0D0）
  variant?: string;                                    // huang: 'masked' | 'man' | 'weasel'；zhou: 'cap' | 'nocap' | 'slump'；tudi: 'lantern_only'
  age?: 'young' | 'old';                               // 回放里的年轻王奶奶、小建国
  faceMask?: boolean;                                  // 头部锚点叠一团动态雪花遮住脸；zhou 在 look:'replay' 时默认 true（GDD M4、§3.6）
  seed?: number;
}
export interface CharacterRig extends HumanoidRig {
  readonly kind: CharacterKind;
  readonly props: Readonly<Record<string, THREE.Object3D>>;   // 例：tudi.props.lantern、lu.props.tlr、wang.props.basket
  readonly anchors: { head: THREE.Object3D; chest: THREE.Object3D; mouth?: THREE.Object3D };
  setVariant?(v: string): void;                               // huang：揭面具后 'masked' → 'man'/'weasel'
  readonly hdFace?: { mesh: THREE.Mesh; lo: () => THREE.Texture; hi: () => THREE.Texture };   // huang 'masked'：脸网格与低/高清脸贴图，交给 ctx.hdText（§5.3）
}
export function createCharacter(kind: CharacterKind, opts?: CharacterOpts): CharacterRig;
```

外形要求逐条对应 GDD §2.7 表格（土地 1.2m、Lathe 圆肚、Line 白胡子、枣木拐杖挂红灯笼；王奶奶驼背、Lathe 发髻、竹篮；陆师傅瘦高、中山装、老花镜、双反相机；老周微驼、蓝布单帽、搪瓷缸）。

- **老周的脸**：`faceMask` 在头部锚点前挂一个面向相机的小平面（`mat.replay` 同族材质 + 每帧滚动的噪点），从任何角度、任何倍率都盖住脸；`look:'replay'` 的 zhou 默认开启，所以 `ghost.zhou_2012`、`ghost.zhou_2023` 自动有雪花脸。录像带里的老周用 `look:'live'`（tapeScene，§6.10），不开 faceMask。
- **黄三爷**（GDD §2.7、P9）：
  - `variant:'masked'`（`!r4.found_huang`）：**直接调用 `createPaperFigure({ kind:'vendor', seed, breathing: true })`** 得到与另外九个纸扎摊主完全相同的外形、高度与姿势。**基础脸贴图与同 seed 摊主逐像素一致**（不画水渍、不卷边、不动），所以肉眼、取景器 1×–3× 下（以及 4× 但远于 5m 时）与别的纸人毫无区别（GDD §2.7、P9）。破绽只在高清版里：纸面具嘴部洇湿的深色水渍与卷起的边只画在一张高清脸贴图里，由 `CharacterRig.hdFace` 交给区域，R4 在 build 里调用 `ctx.hdText(hdFace.mesh, hdFace.lo, hdFace.hi, { minZoom: 4, maxDist: 5 })`，只在取景器 ≥4×、≤5m 时换上；约 0.25Hz、±3% 的鼓瘪用嘴部一片小平面的缩放来做，这片小平面只在高清贴图生效期间可见（`PaperRig.update` 判断脸网格当前贴图是否为高清版）。`anchors.mouth` 给 `rd.huang_breath` 跟随。整棵子树 `userData.tempC = 36.5`（压过纸材质的 6℃，红外下是热乎乎的人形轮廓；红外看破是 GDD 允许的备选解法）。
  - 揭面具后：`'man'`（肉眼：穿旧中山装、戴破毡帽的 1.4m 矮个子，脸埋在帽檐下）与 `'weasel'`（取景器常光：人立的黄鼠狼，Cone+Sphere 头、尾巴、破毡帽）由 `ctx.viewVariant({ naked: man, vf: weasel, ir: man })` 切换；红外下仍是 36.5℃ 的人形。
  - 三个变体的 root 都在同一个 NPC 节点下，任何变体下都不挂灯。
  - `ctx.hdText` 切换时**只换 `material.map`**（`hi()`/`lo()` 各生成一次并缓存），不替换材质、不改 UV（M1c 写明，engine-wp2.md #2）：黄三爷的高清脸是与 `lo()` 同布局的 2048² 图集（只有他那一格画了水渍与卷边），他的脸材质是私有实例；`PaperRig.update` 按 `face.material.map === faceHi()` 判断鼓瘪小平面是否可见。
- **`CharacterRig.props` 的键**（M1c 按 WP2 的实现写明，engine-wp2.md #8）：tudi `{ lantern, lanternLight（NpcDef.lights 的锚点）, cane, beard }`；wang `{ bun, basket }`；lu `{ glasses, tlr }`；zhou `{ collar, armband, cap, mug, faceSnow? }`；huang `{ masked, man, weasel, mask, hat, tail }`；kid `{ scarf }`；bride `{ bun }`；junkman `{ cap }`；worker `{ hardHat }`。土地 `look:'ghost'` 保持本色 + 土地金菲涅尔描边（他是神不是鬼），其余角色 ghost 用 `MATERIALS.ghost(color)`。黄三爷揭面具后由 R4 调 `ctx.viewVariant({ naked: props.man, vf: props.weasel, ir: props.man })`；`look:'replay'` 的 huang 默认 variant `'man'`，`look:'live'` 默认 `'masked'`。
- **逐人偶淡出**（M1c 写明，engine-wp2.md #5）：`MATERIALS.ghost()`/`replay()`/`paperGlow()` 是共享实例，透明度 uniform 名为 `uOpacity`。`HumanoidRig.setOpacity(a < 1)` 第一次调用时把该人偶用到的共享材质各克隆一份（同一着色器程序），再写克隆的 `uniforms.uOpacity` 与 `material.opacity`——“克隆后改 uOpacity”是允许的逐实例淡出方式；克隆出来的材质不是共享实例，区域卸载时由 Disposer 释放。

### 5.4 纸人与人群（`rigs/paper.ts`、`rigs/crowd.ts`）

```ts
export interface PaperOpts { kind: 'boy' | 'vendor'; height?: number; seed?: number; lanternText?: string; breathing?: boolean }
// breathing：黄三爷面具。基础脸贴图不变（与同 seed 摊主逐像素一致）；另外生成高清脸贴图（嘴部水渍与卷边）与只在高清贴图生效时可见的鼓瘪小平面（§5.3）
export interface PaperRig {
  readonly root: THREE.Group; readonly mouth: THREE.Object3D;
  readonly face: THREE.Mesh;                                  // 脸平面
  readonly faceHi?: () => THREE.Texture;                      // 仅 breathing：高清脸贴图（首次调用才生成）
  setJitter(amount: number): void; update(dt: number): void; dispose(): void;
}
export function createPaperFigure(o: PaperOpts): PaperRig;                        // rig.paper：Plane+Box，CanvasTexture 画脸与衣服
export function createPaperStalls(transforms: { pos: V3; yaw: number; seed: number }[]): THREE.InstancedMesh;  // 9 个静态摊主，一次绘制
export interface CrowdOpts { count: number; cols: number; spacing: number; look: 'replay' | 'ghost' | 'silhouette'; seed?: number; kidsFrontRow?: number }
export function createCrowd(o: CrowdOpts): { mesh: THREE.InstancedMesh; bounds: THREE.Box3; dispose(): void };  // 合并的低模人形，实例化
```

- `createPaperStalls` 的每个实例与同 `seed` 的 `createPaperFigure({kind:'vendor'})` **共用同一套几何与贴图生成函数**，外形逐像素一致（黄三爷伪装靠这一点）；脸的差异只来自贴图图集里按 seed 选的格子，不用 `instanceColor` 区分（红外替换材质会被 instanceColor 染色，见 §6.8.2）。
- 纸人材质 `tempC = 6`；纸像发光材质见 §8.3 的 `paperGlow()`。
- `createCrowd()`（M1c 写明）：面朝 -z，第一排在 z=0，往后每排 +0.85×spacing、抬高 0.15m。
- **人物细化（2026-10-06）**：回放人群仍为三套衣色、三个 `InstancedMesh`；256² 图集分为脸、衣襟与调色区，头有耳鼻，躯干为圆肩放样，手和鞋有轮廓。每套实例共用同一份合并几何，不按人数增加 draw call；纸人与纸扎摊主外观不改。

---

## 6. `src/game` 玩法系统

### 6.1 状态（`game/state.ts`）

```ts
export interface ItemEntry { id: ItemId; used: boolean; order: number }
export interface PhotoRecord {
  id: PhotoId; title: string; caption?: string;
  key: boolean;                         // 关键照片（相册红标，永不删除）
  print: boolean;                       // 实物照片（ph.covered_face、ph.true_form）
  seq: number; area: AreaKey; lens: LensMode; zoom: ZoomLevel;
  context: PhotoContext['kind'] | 'print' | 'tripod';
  thumb?: string;                       // 192×144 JPEG dataURL（可能缺失）
}
export interface StateView {
  flag(id: FlagId): boolean;            // 数值 flag：> 0 为真
  num(id: FlagId): number;
  has(id: ItemId): boolean;
  used(id: ItemId): boolean;
  hasPhoto(id: PhotoId): boolean;
  seen(key: string): boolean;
  names(): readonly NameId[];           // 由 flags 推导（GDD §3.11）
  antCount(): number;                   // r1.ant_old_1..6 为真的个数
  temp(key: string): boolean | number;  // 当前区域的临时状态（§11.2 ctx.setTemp；未设置 = false；换区域即清空；不存档）
  readonly shichen: Shichen;            // 由 flags 推导（GDD §3.10）
  readonly area: AreaKey;
  readonly mode: ModeId;
  readonly vf: boolean;
  readonly lens: LensMode;
  readonly zoom: ZoomLevel;
}
export class GameState implements StateView {
  setFlag(id: FlagId, value?: true | number): boolean;   // 只能 false→true；数值只增；返回是否变化；变化时发 'flag' 并 save.request()
  giveItem(id: ItemId): boolean;                         // 已有则无操作
  markUsed(id: ItemId): void;
  addPhoto(r: Omit<PhotoRecord, 'seq'>): PhotoRecord;    // 关键照片重复获得时保留旧记录（不重复），返回旧记录
  nextEmptyId(): EmptyPhotoId;                           // ph.empty_<n>，n 递增；空镜只保留最近 20 张
  addClue(text: string): boolean;                        // 按全文去重
  markSeen(key: string): void;                           // 阴物常显、已读文档、已浮现新页、已看过的过场
  snapshot(): SaveDataV1['core'];
  restore(d: SaveDataV1['core']): void;
  // —— M1a 补写 ——
  reset(): void;                                         // 新游戏：清空全部进度
  listItems(): readonly ItemEntry[];                     // 按获得顺序（物品栏、DebugState）
  listPhotos(): readonly PhotoRecord[];                  // 按 seq（相册、DebugState）
  listClues(): readonly string[];                        // 巡夜本“已知线索”（§6.16 的 state.clues）
  listFlags(): Readonly<Record<string, boolean | number>>;   // 已设置的 flag（DebugState.flags）
  // 只供 ?debug=1：
  debugSet(p: { flags?: Record<string, boolean | number>; items?: (ItemId | { id: ItemId; used: boolean })[]; photos?: PhotoId[] }): void;
}
```

`setFlag` 若写入未登记 id，dev 下抛错。**唯一**的 flag 写入口是 `GameState.setFlag`，它只在处理 Action、执行 Effect、区域逻辑（响应玩家动作）时被调用。

**`debugSet`/`restore`/`reset` 不发事件**（M1c 写明，engine-wp4.md #13）：它们重建状态，不发 `'flag'`/`'item'`。后果：时辰系统在下一帧静默对账（不播时辰过场）；巡夜本新页在没有 `'flag'`/`'temp'` 事件时静默记 seen（不 toast）；NPC 站位要调用方 `npc.reevaluate()`；区域 `onFlag` 不会被触发，所以 regions 脚本的预置用 `setState({…, area})` 重进区域。调试 API 的 ★ 写入方法另会 `save.request('manual')`（§12.3）。

### 6.2 条件表达式（`game/expr.ts`）

```ts
export type Cond = string | ((s: StateView) => boolean);
export function compileCond(c: Cond | undefined, where: string): (s: StateView) => boolean;   // 未定义 = 恒真；字符串在注册时编译并校验 id
```

FlagExpr 语法（字符串形式，GDD 里的写法可以直接照抄）：

```
expr    := or
or      := and ('||' and)*
and     := unary ('&&' unary)*
unary   := '!' unary | primary
primary := '(' expr ')' | 'true' | 'false'
         | FLAG_ID [cmp NUMBER]                       -- r1.gate_lamp_on、r2.wang_floor >= 5
         | 'has(' ITEM_ID ')' | 'used(' ITEM_ID ')' | 'photo(' PHOTO_ID ')' | 'seen(' KEY ')'
         | 'temp(' TEMP_KEY ')'                        -- 区域临时状态，如 temp(lamp_lit_1)（王奶奶初见看的是一楼灯此刻亮不亮）
         | 'shichen' ('=='|'!=') ('zi'|'chou'|'yin'|'mao')
         | 'lens' '==' ('normal'|'ir') | 'vf' | 'ants' cmp NUMBER
cmp     := '==' | '!=' | '>=' | '<=' | '>' | '<'
```

简单条件用字符串（可读、会被校验），复杂条件用函数。条件在每次使用时现算（角标、聚焦、`activate` 都是），所以随 flag 与临时状态变化自然生效；NPC 站位在 `'flag'`、`'temp'` 事件后重算。

### 6.3 效果（`game/effects.ts`）与区域门面 `GameApi`

```ts
export type Effect =
  | { do: 'flag'; id: FlagId; value?: true | number }
  | { do: 'item'; id: ItemId }                                   // 获得物品
  | { do: 'used'; id: ItemId }                                   // 标记已用
  | { do: 'photo'; id: KeyPhotoId; caption?: string }            // 获得实物照片（或非判定照片）
  | { do: 'say'; text: string; who?: SpeakerId; dur?: number }   // 字幕/旁白/画外音（非阻塞，不进入 dialogue 模式、不打断回放；dur 默认按字数 0.12s/字，最少 2s）
  | { do: 'feedback'; text: string }                             // 交互反馈条（非阻塞）
  | { do: 'dialogue'; id: DialogueId }                           // 阻塞到对话结束（或被取消）
  | { do: 'cutscene'; id: CutsceneId }                           // 阻塞到过场结束（或被取消）
  | { do: 'clue'; text: string }                                 // 巡夜本“已知线索”
  | { do: 'seen'; key: string }
  | { do: 'sfx'; cue: SfxCue; at?: V3 }
  | { do: 'music'; cue: MusicCue }
  | { do: 'tutorial'; text: string }                             // 教学提示（如“右键：用你的眼睛看”），每条只出现一次
  | { do: 'save'; slot: 'save.yin' }                             // 立即（或在回到安全模式时）写寅时槽
  | { do: 'wait'; sec: number }                                  // 游戏时间
  | { do: 'ending'; kind: 'main' | 'nanke' }                     // 结局播完（= GameApi.endingDone；R1-finale 在主结局片尾/南柯段落的最后一步写）
  | { do: 'doc'; id: DocId; vf?: boolean }                       // M3 补写：打开文档阅读器（= GameApi.openDoc），阻塞到阅读器合上（墙上/场景里不属于物品的文档）
  | { do: 'journal' }                                            // M3 补写：翻开巡夜本（= GameApi.openJournal），阻塞到合上（R1 开场拾取巡夜本后自动翻开）
  | { do: 'call'; fn: (g: GameApi) => Awaitable<unknown> };      // 逃生口（M1a：返回值 await 后丢弃，所以 E.call(g => g.tripod.enter()) 可以直接写）
export const E: {
  flag(id: FlagId, value?: true | number): Effect; item(id: ItemId): Effect; used(id: ItemId): Effect;
  photo(id: KeyPhotoId, caption?: string): Effect; say(text: string, who?: SpeakerId, dur?: number): Effect;
  feedback(text: string): Effect; dialogue(id: DialogueId): Effect; cutscene(id: CutsceneId): Effect;
  clue(text: string): Effect; seen(key: string): Effect; sfx(cue: SfxCue, at?: V3): Effect; music(cue: MusicCue): Effect;
  tutorial(text: string): Effect; save(slot: 'save.yin'): Effect; wait(sec: number): Effect; ending(kind: 'main' | 'nanke'): Effect;
  doc(id: DocId, vf?: boolean): Effect; journal(): Effect;      // M3 补写
  call(fn: (g: GameApi) => Awaitable<unknown>): Effect;
};
export type RunOutcome = 'done' | 'cancelled';
export interface RunScope {
  readonly origin: string;                       // 'interact:r3.bell'、'dialogue:dlg.r3.lu_slip'、'cutscene:cs.r1.dawn'…
  readonly parent: RunScope | null;
  readonly cancelled: boolean;
}
export class EffectRunner {
  /** 顶层调用（无 scope）：若已有顶层 run 在执行就排队。
   *  嵌套调用（传入 scope，或经由 scope 化的 GameApi 发起）：立即内联执行，不排队。 */
  run(list: readonly Effect[] | undefined, origin: string, scope?: RunScope): Promise<RunOutcome>;
  runHandler(h: Handler | undefined, origin: string, scope?: RunScope): Promise<RunOutcome>;   // Handler 为函数时传给它一个绑定到新子 scope 的 GameApi
  readonly busy: boolean;                        // 有未完成的顶层 run（含它内联的嵌套）
  readonly waitingInput: boolean;                // 当前阻塞点在等玩家：对话行或选项、过场 await、面板已打开；M3：由 run 打开（E.doc / E.journal / GameApi.openDoc）的阅读器还开着
  settled(): Promise<Settle>;                    // busy 为假 → 'idle'；waitingInput 为真 → 'waiting'；否则等到二者之一
  cancelAll(reason: 'reset' | 'area'): void;     // 见“取消语义”
  pump(dt: number): void;                        // M1a 补写：§3.2 第 8 步 effects.pump（wait 等游戏时间计时）
}
export type Handler = readonly Effect[] | ((g: GameApi) => Awaitable<unknown>);   // 交互物/选项等处可用效果列表或函数（M1a：函数返回值 await 后丢弃，onInteract: g => g.cctv.open() 合法）
```

**可重入**：`E.dialogue`/`E.cutscene` 会阻塞到结束，而对话节点的 `effects`、过场的 `{effects}`/`{run}` 步骤、`E.call` 里的 `g.run()`、Handler 函数里再调 `g.dialogue()` 都是在外层 run 还没结束时发起的。它们一律带着外层的 `RunScope` **内联执行**，不进队列，否则会排在正阻塞着的外层 run 后面造成死锁或乱序。只有来源互相独立的**顶层** run（交互、快门命中、触发器、区域计时器、`ctx.run()`）才排队。实现上，Runner 执行一个 Handler 函数时传给它的是一个“绑定到子 scope 的 `GameApi`”，它的 `run/dialogue/cutscene` 自动内联。

**settle 语义**（调试 API 与 `activate()` 的返回时机）：
- `interaction.activate()` 以及每个调试 API 方法，在 **runner 空闲**或**当前阻塞点正在等玩家输入**（对话行或选项、过场 `await`、面板已打开）时 resolve，不等对话/过场整个结束。返回值带 `settle: 'idle' | 'waiting'` 与 `opened?: ModeId`。例：`interact(npc.tudi)` 在第一句台词出现时返回 `{ opened:'mode.dialogue', settle:'waiting' }`；`shoot()` 命中 `pt.tudi` 后 onHit 开对话，同样在对话等待输入时返回。
- `dlg()`：只要 `effects.busy && !waitingInput`（例如过场正在自己播、打字机、`wait` 步骤），就用 `game.advance()` 推进游戏时间，直到进入等待输入或空闲；遇到对话行就 dispatch `advance`；停在选项、`await` 或结束时返回。
- **取消语义**：`modes.resetTo()` 或切区域时调用 `cancelAll()`：被阻塞的 `dialogue`/`cutscene` 以 `'cancelled'` 结束，其 scope 链全部标记 `cancelled`；同一 handler 里尚未执行的 Effect **丢弃**；绑定到已取消 scope 的 `GameApi` 写方法变成空操作（dev 下 `devWarn`）。所以区域写 handler 时**先写 flag，再开对话/过场**（§11.5 第 9 条），被取消也不会漏写进度。
- 对话、过场、三脚架期间，调试 API 的 `goto`、`reload`、`setState` 一律返回 `busy`；玩家这时也无法离开。
- 排队的顶层 run 在被取消的 run 之后照常执行（它们与被取消者无关）。

```ts
/** 区域代码、Effect.call、对话/过场脚本能拿到的唯一门面。它的每个写方法都等价于某个 Effect。 */
export interface GameApi {
  readonly state: StateView;
  readonly time: number;
  readonly cancelled: boolean;                 // 本门面绑定的 scope 已被取消
  run(list: readonly Effect[]): Promise<RunOutcome>;          // 在本 scope 内联执行
  setFlag(id: FlagId, value?: true | number): void;
  give(id: ItemId | KeyPhotoId): void;
  markUsed(id: ItemId): void;
  say(text: string, who?: SpeakerId, dur?: number): void;
  feedback(text: string): void;
  clue(text: string): void;
  dialogue(id: DialogueId): Promise<RunOutcome>;
  cutscene(id: CutsceneId): Promise<RunOutcome>;
  sfx(cue: SfxCue, at?: V3): void;
  music(cue: MusicCue): void;
  post: { push(key: string, p: Partial<FxParams>, fadeSec?: number): void; pop(key: string, fadeSec?: number): void; flash(ms?: number): void };   // flash 与频闪自动遵守 reduceFlash；M1d：push 的 key 记在当前区域上，区域卸载时自动 pop（不带进下一个区域/下一局）
  player: {
    readonly position: THREE.Vector3; readonly eye: THREE.Vector3; readonly yaw: number;
    teleport(p: V3, yaw?: number, fadeSec?: number): Promise<void>;
    look?(yaw: number, pitch: number): void;   // M4 第 2 轮整合补写：只改视角（俯仰按第三人称范围钳制），不转身体、不动位置；过场收尾 {cam:'player'} 之前至少一帧调用（开场，§15.7.4）
    readonly model: {
      setPose(p: Pose, blendSec?: number): void;          // 开场坐在椅子上
      setBodyOpacity(a: number, sec?: number): void;      // P14 身子一点点空下去
      setVisible(v: boolean): void;                       // 尾声：身体不见
      readonly headMounted: boolean;                      // 头是否在身上
      stickerWorld(target?: THREE.Vector3): THREE.Vector3;   // 镜中读字用
      readonly cable: { readonly plugged: boolean; plugTo(to: THREE.Object3D | null): void };   // M1d 补写：视频线插头（§5.2）。R1 插上 r1.crt_jack 时 plugTo(插孔节点)，拔出时 plugTo(null)；ConsoleSystem.plugJack/unplugJack 只管状态、不动线
    };
  };
  shichen: { override(clock: string | null, rate?: number): void;   // M1d 补写：结局加速钟（= ShichenSystem.override，§6.5），R1 的天亮过场用 override('04:58:00') 起走、override(null) 交还
             clock(): string; osdLine(channel?: number): string };  // M3 补写（docs/requests/r1-finale.md #2）：当前钟点 'HH:MM:SS'（与 HUD、监控 OSD 同源）；osdLine = ShichenSystem.osdLine（'CH2 2026-08-28 周五 04:31:12'）。只读，过场 OSD 用
  settings: Readonly<Settings>;                // 只读；变化时发 'settings' 事件（R3 镁光、R4 灯管频闪要看 reduceFlash；R3 色彩辅助看 colorAssist）
  interaction: { readonly focused: InteractId | null };      // 当前聚焦对象（色彩辅助的悬停字幕用）
  modes: { readonly top: ModeId; readonly stack: readonly ModeId[] };
  vf: { readonly on: boolean; readonly lens: LensMode; readonly zoom: ZoomLevel };
  replay: { readonly active: { point: ReplayPointId; seg: SegmentId; t: number; playing: boolean } | null };
  vcr: VcrSystem; cctv: ConsoleSystem; tripod: TripodSystem; hints: Pick<HintSystem, 'current'>;
  photo: Pick<PhotoSystem, 'award'> & { record(id: PhotoId): Readonly<PhotoRecord> | null };   // M3 补写 record（docs/requests/r1-finale.md #1）：只读取已有照片记录（含 thumb），不发事件、不存档、不消耗三脚架快门（片尾放玩家自己拍的照片）
  openDoc(id: DocId, o?: { vf?: boolean }): Promise<ApiResult>;   // M3 补写（r1-world #1、r2 #1、r3 #2、r4 #1）：= JournalSystem.openDoc（推 mode.journal，arg { doc, vf }，vf 缺省 = 栈上有取景器）；
                                                                  // Promise 在阅读器合上（Esc、模式重置、切区域）时 resolve，失败立即 resolve（no_such_target / mode_disallows / cancelled）；等待期间 settle 'waiting'
  openJournal(): Promise<ApiResult>;                              // M3 补写：= JournalSystem.openJournal，合上时 resolve（E.journal 同义）
  travel(exit: ExitId): Promise<ApiResult>;    // 走出入口同等流程（= areas.travel，检查 when）。M1d 写明：成功时切区域会取消包括调用者在内的全部进行中 run（§4.5 第 1 步），travel 必须是 handler 的最后一步
  setLevel(n: number): void;                   // R2：换楼层（= 当前区域 levels.set，楼梯井对话的选项 effects 用它）
  endingDone(kind: 'main' | 'nanke'): void;    // 结局播完（= E.ending）：记录运行期 ending（DebugState.ending）、发 'ending' 事件；
                                               // kind === 'main' 且 !r1.nanke，或 kind === 'nanke' 时调用 save.markCompleted()（§6.4），
                                               // M1d：同时 game.returnToTitleWhenIdle()——这次 run 与过场结束、runner 空闲后引擎回标题（§4.4、§6.4）。WP4 实现
}
export function createGameApi(game: Game, scope?: RunScope): GameApi;   // M1a 补写：无 scope = 顶层门面（Game.api）；有 scope = 绑定该 scope 的门面（run/dialogue/cutscene 内联）
```

**墙上文档（M3 补写）**：不属于任何物品的文档（GDD §13.9：R1 公告栏三张、小区简介、土地庙对联、监控调试注意事项；R2 捐款榜；R3 暗房守则；R4 鬼市规矩、旧书残页）由登记它的区域在交互物的 `onInteract` 里用 `E.doc(DOC.X)`（或 Handler 里 `await g.openDoc(DOC.X)`）打开阅读器：阻塞到玩家合上，所以连写几个就是“一张接一张读”（R1 公告栏：`[E.doc(DEMOLITION), E.doc(OBITUARY), E.doc(WATER_NOTICE)]`），讣告被盖住的下半截照 `DocDef.covered` 打码。实现：`EffectRunner.readerCps`（WP4 内部）记下压进去的那一层 `mode.journal`，它离开栈时续延；阅读器开着时 `waitingInput` 为真，调试 API `interact` 以 `settle:'waiting'`、`opened:'mode.journal'` 返回，`DebugState.doc` 给出正文（§12.3），测试用 `back()` 合上（`scripts/lib/harness.mjs` 的 `readDocs`）。

### 6.4 存档与设置（`game/save.ts`、`game/settings.ts`）

```ts
export interface SaveDataV1 {
  v: 1; savedAt: number;
  core: {
    flags: Record<string, boolean | number>;
    items: ItemEntry[];
    photos: PhotoRecord[];               // 缩略图超配额时去掉 thumb 重试
    clues: string[];
    seen: string[];
    emptySeq: number;
  };
  area: AreaId; spawn: SpawnId;           // dev 沙盒不存档
}
export type SaveReadResult = { ok: true; data: SaveDataV1; repaired: string[] } | { ok: false; reason: 'missing' | 'parse' | 'version' | 'schema' };
export type SaveSlotName = 'save.auto' | 'save.yin';   // M1a 补写：别名
export const SAVE_KEYS = { 'save.auto': 'camhead-man.save.auto', 'save.yin': 'camhead-man.save.yin', settings: 'camhead-man.settings', completed: 'camhead-man.completed' } as const;   // M1a 补写
export class SaveSystem {
  request(reason: 'flag' | 'area' | 'item' | 'photo' | 'manual'): void;   // 标记脏
  flushIfSafe(): void;                    // 栈上无临时模式、且没有 hold 时写 save.auto
  hold(key: 'ending'): void;              // 暂停一切落盘（含 flushIfSafe 与 E.save），直到 release
  release(key: 'ending'): void;
  readonly held: boolean;                 // 有未 release 的 hold（DebugState.saves.hold 读它）
  writeSlot(slot: 'save.auto' | 'save.yin'): boolean;   // try/catch；失败只在内存中继续
  read(slot: 'save.auto' | 'save.yin'): SaveReadResult; // 解析 + 版本 + schema 校验（见下）
  has(slot: 'save.auto' | 'save.yin'): boolean;          // = read(slot).ok（损坏的存档不算“有”）
  markCompleted(): void;                  // 片尾播完：删除 save.auto，写 camhead-man.completed = 时间戳
  readonly completed: boolean;
  load(slot: 'save.auto' | 'save.yin'): SaveReadResult;   // M1a 补写：read 通过后 state.restore(data.core)；ok:false 时不改状态、原数据另存 *.bad（Game.continueFrom 用）
  clearCompleted(): void;                 // M1a 补写：“新游戏”“从寅时重来”清除通关标记
  clearAll(): void;
}
```

- localStorage 键：`camhead-man.save.auto`、`camhead-man.save.yin`、`camhead-man.settings`、`camhead-man.completed`（通关标记，不在存档里，GDD §13.3“推导量”）；损坏存档的备份键 `camhead-man.save.auto.bad`（`.yin.bad` 同理）。
- **读档校验**（`read()`）：JSON 解析失败 → `parse`；`v` 不符 → `version`；结构不符（缺字段、类型错）→ `schema`。结构对但内容可疑时**就地修复**并在 `repaired` 里列出：丢弃不在 `ALL_IDS` 里的 flags/物品/照片（空镜 `ph.empty_<n>` 保留）；把 `r2.wang_floor` 钳到 0–5 的整数；`area` 必须是 `AreaId`，`spawn` 必须属于该区域（否则改用该区域第一个出生点）；`emptySeq` 至少为现存空镜编号最大值。`ok:false` 时把原始字符串另存为 `*.bad`，标题菜单不显示对应项，并 toast“存档损坏，只能重新开始。”
- 不存：录像机位置、灯的亮灭计时、暗房步骤、视频线插接、回放状态、对话进度、提示计时、区域临时状态（GDD §3.13）。
- `E.save('save.yin')` 在 `r4.got_tape` 写入后执行；若当时在对话中，推迟到回到 explore/viewfinder 时写，写之前状态已包含 `r4.got_tape`。
- **结局不落盘**（GDD §3.13）：在 `dlg.r1.bracket_confirm` 里选“装回去”→ `tripod.enter()` 内部先 `save.hold('ending')`，然后进三脚架；从此经三脚架、合影、天亮叫醒、片尾（含南柯），任何 flag 变化都只在内存里。若在定时开始前按 E 取消三脚架，`tripod.cancel()` 内部 `release('ending')`（回到 explore 后照常存档）。片尾播完由 `GameApi.endingDone(kind)`（R1-finale 在主结局片尾与南柯段落的最后一步写 `E.ending('main')`/`E.ending('nanke')`，§6.3）调用 `markCompleted()`（删除 `save.auto`，写通关标记；`kind === 'main'` 且 `r1.nanke` 为真时还要接着播南柯段落，等 `'nanke'` 再调用），此后标题菜单不再显示“继续”，仍保留“从寅时重来”（`save.yin` 有效时）、“新游戏”、“设置”与“第三方许可”；“新游戏”“从寅时重来”会清除通关标记。
- **片尾之后回标题**（M1d 补写，GDD §3.13/§10.4/P14“片尾后可‘从寅时重来’”）：写通关标记的那次 `endingDone` 之后，等这次 run 与过场结束、runner 空闲，引擎 `Game.toTitle()`：淡出、卸载当前区域（`areas.current` 变为 null）、复位主角模型与取景器光学、显示标题菜单（不再显示“继续”，仍保留“从寅时重来”〔`save.yin` 有效时〕、“新游戏”、“设置”与“第三方许可”）。区域不必、也不能自己回标题（`E.ending` 必须是片尾的最后一步，之后的步骤会被 `cancelAll` 丢掉）。
- **hold 与通关的细节**（M1c 按 WP4 的实现写明，engine-wp4.md #11）：`clearCompleted()`（新游戏、从寅时重来）与 `load()`（读档）都会清掉 hold（成功通关后的 `hold('ending')` 由它们释放）；hold 期间的 `E.save` 直接丢弃（不在 release 后补写）；`completed` 为真后 `flushIfSafe` 不再写 `save.auto`（否则标题又出现“继续”）；`markCompleted` 不受 hold 限制。`read()` 失败时把原字符串另存 `<key>.bad`、原键保留（`has()` 仍为假）；存档的区域 id 不是 `AreaId` 时修复为 r1。
- **异常存档**：读到 `r1.soul_returned && !r1.called_at_dawn` 的存档（正常流程写不出来，只防旧版本或手改），进入 R1 后直接播 `cs.r1.dawn`；读到 `r1.called_at_dawn` 为真的存档，视同已通关：`markCompleted()` 后回到标题。
- 读档后回到存档区域的出生点，NPC 站位、门、灯、时辰全部由 flags 推导重建。

```ts
export interface Settings {
  mouseSens: number; invertY: boolean; vfMode: 'toggle' | 'hold'; subSize: 0 | 1 | 2; grain: number;
  quality: 'low' | 'mid' | 'high'; reduceFlash: boolean; colorAssist: boolean; hintNoCooldown: boolean;
  mirrorMode: 'rt' | 'baked'; tunnelMode: 'rt' | 'baked'; volume: number;
}
// —— M1a 补写（game/settings.ts）——
export const DEFAULT_SETTINGS: Readonly<Settings>;                      // quality 'mid'、vfMode 'toggle'、subSize 1、mirror/tunnel 'rt'…
export const SETTING_IDS: Readonly<Record<keyof Settings, SettingId>>;  // 字段 ↔ settings.* 映射表
export function loadSettings(): Settings;                               // 读 localStorage，缺失/非法字段用默认值；不读 URL（?quality= 覆盖由 Game 构造函数只在内存里做，§4.4）
export function applySetting<K extends keyof Settings>(game: Game, key: K, value: Settings[K]): void;
// 写 game.settings、落盘、发 'settings'；quality 变化时 game.requestReenter('quality')（M1d：由 Game.step 末尾在安全时重进，见下）。设置菜单与调试都走它
```

与 GDD §13.12 的 `settings.*` 一一对应（`settings.mouse_sens` ↔ `mouseSens` 等，映射表写在 `settings.ts`）。任何设置变化都发 `'settings'` 事件。`quality` 默认 `'mid'`（§13.2）；改动 `quality` 时 `game.requestReenter('quality')`（雨丝数量、阴影、RT 尺寸都是 build 时读取的，重新进入当前区域的 `spawnUsed` 才能生效）。M1d 更正：重进一律推迟到 `Game.step` 末尾，且只在栈顶 explore/viewfinder、栈上没有临时模式、runner 空闲、没有存档 hold（结局期间）时执行（§4.4“帧末的推迟动作”）；没有区域（标题）时立即交给渲染管线；新游戏/读档/回标题清掉挂起的重进，下次 `enter` 发现渲染管线画质与设置不符时补一次 `setQuality`。

### 6.5 时辰（`game/shichen.ts`）

```ts
export function deriveShichen(s: Pick<StateView, 'flag'>): Shichen;   // GDD §3.10 原样
export class ShichenSystem {
  readonly current: Shichen;
  hudLabel(): string;                     // HUD 字样：子时/丑时/寅时/卯时；推导值已是 mao 时，钟点到 05:00 才从“寅时”换成“卯时”
  clockText(): string;                    // 'HH:MM'，按 data/time.ts 的钟点表（GDD §3.10）：
                                          //   子时 23:40 起，每 20 秒游戏时间走 1 分钟，停在 00:59
                                          //   丑时 01:05 起、寅时 03:05 起，每 10 秒走 1 分钟，分别停在 02:59、04:59
                                          //   卯时由 override 接管（结局加速钟 04:58 起）
  osdDate(): string;                      // 00:00 前 '2026-08-27 周四'，之后 '2026-08-28 周五'
  osdLine(channel?: number): string;      // 'CH1 2026-08-27 周四 23:41:07'（秒按游戏时间走）
  update(dt: number): void;               // 冻结时不调用；监听 'flag'：推导值变化 → 发 'shichen' → 2 秒时辰过场（远钟 + HUD 字样），不重建当前区域；钟点从新时辰起点重新走
  override(clock: string | null, rate?: number): void;   // 结局加速钟（04:58:00→05:12:00，12 秒真实用时 = 70 钟秒/秒）由 r1 过场驱动（M1d：区域经 GameApi.shichen.override 调用，§6.3）
  resetClock(): void;                     // M1a 补写：新游戏/读档后从当前时辰起点重新走钟
}
```

- 钟点是装饰，只存在内存里：读档后从当前时辰的起点重新走。字样与钟点永远对得上（子时 23:00–00:59、丑时 01:00–02:59、寅时 03:00–04:59、卯时 05:00 起）。

### 6.6 交互系统（`game/interaction.ts`）

```ts
export type Dyn<T> = T | ((s: StateView) => T);    // 随 flags/临时状态现算的字段（M1a：导出）
export type ViewReq = 'any' | 'viewfinder' | 'naked';
export type LensReq = 'any' | 'normal' | 'ir';
export interface TalkEntry { when?: Cond; dialogue: DialogueId }
export interface InteractableDef {
  id: InteractId;
  label: Dyn<string>;                              // 角标名字；**不得泄露谜底**（GDD §10.2，见下方硬规则）
  at: V3 | (() => THREE.Vector3);                  // 锚点（角标位置、距离计算、aimAt 目标）
  hit?: THREE.Object3D | string;                   // 准星拾取用的网格（或 ref id）；缺省按锚点直径 0.25m 的球。玻璃门只给门把手的小盒子；取件格这类密集物体每格给一个 0.24×0.24 的薄盒，材质用 MATERIALS.hitProxy()（不渲染但能被射线命中）
  range?: Dyn<number>;                             // 默认 3（从镜头位置到锚点的直线距离）
  view?: Dyn<ViewReq>;                             // 必须在哪种视图下交互（阴物 = 'viewfinder'），默认 'any'
  lens?: Dyn<LensReq>;                             // 默认 'any'
  present?: Cond;                                  // 是否在场：假 → 无角标、不可交互（reason 'not_present'）
  when?: Cond;                                     // 前置：假 → 灰色角标，交互显示 blocked。会泄题的对象不用 when（见硬规则）
  blocked?: string | ((s: StateView) => string);   // 前置不满足的专属反馈（有 when 就必须写）
  wrongView?: string | ((s: StateView) => string); // 视图/镜头不对时的反馈（如“纸人没有回答。它的嘴是画上去的。”）
  onInteract?: Handler;                            // 主动作（查看/拾取/扳开关）；可以在函数里按 g.vf.lens 等分支
  talk?: TalkEntry[];                              // NPC/纸像：按序取第一个满足的对话
  offers?: Dyn<OfferTable | undefined>;            // 可出示/使用；按状态现算，undefined = 此刻没有出示/使用（按 E 不弹动作菜单，show/use 走通用“这儿用不上。”）。伪装中的黄三爷在 !r4.found_huang 时返回 undefined，与 r4.stall_* 相同（§6.7）
  revealOnVfInteract?: boolean;                    // 阴物：取景器中交互后写 seen(id)，此后 view 放宽为 'any'。M1d 写明：“常光下半透明常显”只对 ctx.npc 登记的阴物自动生效（NpcSystem 换魂影材质、加 world 层）；非 NPC 对象的显形由区域在 onFlag/update 里按 state.seen(id) 自己处理
  proximityFocus?: boolean;                        // 默认 true；取件格等密集物体设 false，只能用准星选中
  priority?: number;                               // 聚焦优先级（大者优先，见聚焦规则）
  menuVerb?: 'show' | 'use';                       // 动作菜单里显示“出示…”还是“使用…”（NPC/纸像默认 show，物体默认 use）
  colorHint?: Dyn<string | undefined>;             // “色彩辅助”打开时悬停显示的字幕，按状态现算，undefined = 不显示；不进角标。R3 容器只在白灯下给颜色：
                                                   //   s => (s.temp('safelight') ? undefined : '黄色')（R3 拉灯绳时 ctx.setTemp('safelight', true/false)；GDD §10.4、P7）
  vfLabel?: 'below' | 'above' | 'right';           // M4 第 2 轮：取景器里准星对着它时名字画在准星环哪一侧（缺省：读字框显示时上方、倍率 ≥ 3× 右侧、否则下方；取件格用 'above'，§15.7.3）
}
export interface OfferTable {
  accept: Partial<Record<ThingId, Handler>>;       // 命中：执行（Handler 负责 E.used 等）
  any?: (thing: ThingId, g: GameApi) => Awaitable<boolean>;   // accept 未命中时的通用处理器：返回 true 视为接受（X1 火盆接受任意照片、蚁穴按照片区分反馈）
  fallback?: string | ((thing: ThingId, s: StateView) => string);   // 其他东西的专属反馈（原样退回）
  byKind?: { photo?: string; item?: string };
}
export interface InteractableHandle {
  readonly id: InteractId;
  setAt(p: V3): void; setLabel(t: Dyn<string>): void; blink(): void; remove(): void;
}
export class InteractionSystem {
  readonly focused: InteractId | null;
  register(def: InteractableDef, area: AreaKey): InteractableHandle;   // hit 为 ref id 时经 game.areas.current!.ctx 解析（build 期间 current 已指向本区，§4.5 第 4 步）；带 hit 网格时同时登记为 ref（§6.8.3）
  addTalk(id: InteractId, entries: TalkEntry[], o?: { first?: boolean }): void;   // 向对象追加对话项（R1-finale 给 R1-world 的 NPC 加终章台词）；id 尚未登记时先排队，登记时按调用顺序合并；区域 build 结束仍未登记的 id 由 AreaContextImpl.finalize() 经 pendingTalks() 在 dev 下抛错
  clearArea(): void;                               // 离开区域时清空本区交互物与排队的 addTalk
  pendingTalks(): readonly InteractId[];           // M1a 补写：已排队但目标仍未登记的 id（dev 与生产都照实返回、自身不抛错）；AreaContextImpl.finalize() 在 build 结束时调用，dev 下非空即抛错（§11.2）
  get(id: InteractId): InteractableDef | undefined;
  list(): InteractableStatus[];
  /** 唯一的交互入口：E 键、动作菜单、挑选器、调试 API 都调用它；按 §6.3 的 settle 语义返回 */
  activate(id: InteractId, req: { verb: 'primary' } | { verb: 'show' | 'use'; thing: ThingId }, source: 'player' | 'api'):
    Promise<ApiResult<{ accepted: boolean; feedback?: string; opened?: ModeId; settle: Settle }>>;
  focusCandidate(): InteractId | null;             // 用当前相机立即重算一次聚焦（调试 API 的聚焦检查用）
  interactFocused(source: 'player' | 'api'): ActionResult;   // M1a 补写：下文“E 键流程”的入口（explore/viewfinder/replay 的 interact 动作调它）；同步返回，activate 在后台继续；无聚焦对象 → no_such_target
  update(dt: number): void;                        // 计算聚焦与角标
  blink(id: InteractId): void;                     // M1c 冻结：角标闪一次（InteractableHandle.blink() 与提示空闲闪烁都走它；写 InteractableStatus.blink = 0.6）
  hasPrimaryAction(id: InteractId): boolean;       // M1c 冻结（WP4 补充）：有 talk 或 onInteract 或名下面板；lint() 用“按 E 是否弹动作菜单 = hasPrimaryAction && hasOffers”
  verbOf(id: InteractId): 'show' | 'use';          // M1c 冻结：动作菜单第二项的动词（menuVerb，缺省 NPC/纸像 show、物体 use）
}
export interface InteractableStatus {
  id: InteractId; label: string; distance: number; inRange: boolean; present: boolean;
  available: boolean; blockedText?: string; view: ViewReq; lens: LensReq;
  focused: boolean; hasOffers: boolean; screen?: { x: number; y: number };
  // —— M1c 冻结（WP4 的运行期字段，engine-wp4.md #2、engine-wp6.md #2）——
  marker: boolean;                                 // 此刻该画角标（在场、射程内、视图允许聚焦）
  blink: number;                                   // 剩余闪烁秒（按游戏时间递减）；UI 的角标据此闪烁，目标即使不在射程内也画
  colorHint?: string;                              // 现算的色彩辅助字幕
  menuVerb: 'show' | 'use';
}
export type ActivateRequest = { verb: 'primary' } | { verb: 'show' | 'use'; thing: ThingId };   // M1a 补写：activate 的 req
export type ActivateResult = ApiResult<{ accepted: boolean; feedback?: string; opened?: ModeId; settle: Settle }>;   // M1a 补写：activate 的返回（DebugApi.interact/show/use 同形）
```

**角标不得泄露谜底（硬规则，GDD §10.2）**：角标是 DOM 文字，不受变焦、取景器、暗房单红通道影响，所以 `label` 只能写玩家此刻凭肉眼也知道的东西，同类对象的角标颜色也不能因“是不是正解”而不同。具体：
- `r3.hole_00`–`r3.hole_99` 一律 `label: '取件格'`，不带编号（编号要 ≥2× 读 `rd.pickup_numbers`）；
- `r1.switch_1`–`r1.switch_4` 叫“开关①”…“开关④”，不叫“门灯”等；
- 暗房三件容器只按形状叫“方盘”“深盆”“豁口盘”，白灯红灯下都一样（颜色走 `colorHint`，只在色彩辅助打开时、且只在白灯下显示；红灯下 `colorHint` 现算为 `undefined`，否则色彩辅助会绕过 P7 的“趁白灯记住颜色”）；
- 三块新瓷砖都叫“瓷砖”；
- `npc.huang` 用 `label: s => s.flag(F.R4_FOUND_HUANG) ? '黄三爷' : '纸人'`，与 `r4.stall_*` 完全相同；看破条件写在 `onInteract` 里（见 §6.7 的黄三爷示例），**不用 `when/blocked`**，否则灰色角标本身就泄题。交互流程也必须相同：`!r4.found_huang` 时 `npc.huang` 的 `offers` 现算为 `undefined`，按 E 直接走 `onInteract`（与只有主动作的纸人一样），不弹“1 交谈/2 出示…”动作菜单。
- `api.lint()` 检查：同一“组”（`r3.hole_*`、`r1.switch_*`、三件容器、三块瓷砖、`r4.stall_*`+`npc.huang`〔后者只在 `!r4.found_huang` 的状态下比较〕）里任何两个对象在同一状态下：角标可用性（灰/白）一致、文字除序号外相同、`hasOffers` 相同、按 E 是否弹动作菜单相同、弹菜单时的 `menuVerb` 相同。

**聚焦规则**（每帧）：
1. 当前相机中心射线与各 `hit` 网格求交（`Raycaster.layers` 按当前相机掩码设置；过滤不可见对象、回放中让位的 NPC）。射线先碰到不挡视线的非交互网格时**穿过去**继续找——M1d：与拍照/读字遮挡同一条规则（`game/viewfinder.ts` 的 `occludesView`）：自身 `userData.occlude === false`、自身或祖先 `userData.noOcclude`、材质不可见/带 `noOcclude`，或材质 `transparent`（且网格没有 `occlude:true` 强制）都不挡，所以玻璃、透明底的文字贴花（`makeTextPlane` 的 bg 缺省时另设 `noOcclude`）不会挡住后面的交互物；在射程内的命中里取 `priority` 最高者，同优先级取最近者。所以隔着照相馆玻璃门对陆师傅按 E，聚焦落在陆师傅身上（门只有门把手的小盒子是 `hit`，陆师傅 `priority 2` 高于门的默认 0；GDD §4.4、P6）。
2. 否则在射程内、`proximityFocus !== false`、位于身体前方 ±60° 的交互物中取 `priority` 最高、再取最近者。M3 补写（docs/requests/r3.md #5）：**隔着墙的不算**——候选按（priority 降序、距离升序）逐个做与调试 API `interact` 真人路径检查同一判据的遮挡测试 `collision.raycast(眼 → 锚点, far = 距离 − 0.15, { skipSeeThrough: true, ignoreKeys: [id] })`，第一个没被挡住的即聚焦（玻璃门这类 `seeThrough` 与目标自身的动态碰撞体不算挡）。
3. 视图不符的阴物（explore 下未常显的 `view:'viewfinder'` 对象）不参与聚焦，也不显示角标。M1d：**红外专属对象**（`lens` 现算为 `'ir'`：冷迹等只在红外画面里看得见的东西）在没开红外时同样不参与聚焦、不显示角标（`InteractableStatus.marker` 为假，HUD 不画），直接调用 `activate` 仍返回 `wrong_lens`；`lens:'normal'` 的对象在红外里照样看得见，仍可聚焦，交互时给 `wrong_lens` 反馈。冷迹的写法：`{ view:'viewfinder', lens:'ir', … }`。

**`activate` 的检查顺序与 reason**：存在（`no_such_target`）→ `present`（`not_present`；回放中让位的 NPC 也算不在场）→ 当前模式允许交互（`mode_disallows`）→ 距离（`out_of_range`；陆师傅隔门 6m 用 `range` 函数实现）→ `view`/`lens`（按当前状态现算；`wrong_view`/`wrong_lens`，显示 `wrongView`）→ `when`（`blocked`，显示 `blocked`）→ 执行：
- `verb:'primary'`：有 `talk` 则开对话；否则执行 `onInteract`。
- `verb:'show'|'use'`：物品/照片不在身上 → `not_owned`；`accept[thing]` 存在 → 执行，`accepted:true`；否则有 `any` 就调用它，返回 true 视为接受；仍未接受则显示 `fallback`/`byKind`/通用“这儿用不上。”，`accepted:false`，物品原样退回。**show 与 use 在逻辑上等价**，只影响 UI 文案（因为 GDD §11 对 NPC 也用 `use`，对纸像也用 `show`）。
- 取景器中对 `revealOnVfInteract` 对象成功交互 → `state.markSeen(id)`。此后该对象的 `view` 要求自动放宽为 `'any'`（常光下也能交互，GDD §11 步骤 23、36 依赖这一点）；`seen` 跨区域有效（王奶奶在 R2 被看见，进 502 后仍常显）。也可以由 Effect `E.seen(id)` 直接写（`pt.zhou_tunnel` 的 onHit 就这样把老周记为“看见过”，GDD P13；步骤 55 依赖这一点）。
- 发 `interact` 事件，重置提示系统的空闲计时。
- 按 §6.3 的 settle 语义返回：对话开出第一句、面板打开、或 Handler 跑完时 resolve。

**E 键流程**：动作菜单与“出示/使用”挑选器都是 `mode.album`（GDD §3.4、M8），参数：

```ts
export type AlbumArg =
  | { tab?: 'photos' | 'items' }                                           // Tab 打开的普通相册/物品栏
  | { menu: { target: InteractId } }                                        // 动作菜单：1 交谈/查看，2 出示…/使用…
  | { pick: { target: InteractId; verb: 'show' | 'use' } };                // 挑选器：方向键/鼠标挑一件，Enter/左键确认，Esc 返回上一层
```

- 聚焦对象若既有主动作又有 `offers`（`offers` 按当前状态现算，非 `undefined` 才算有）→ `modes.push('mode.album', {menu})`；只有 `offers` → 直接 `{pick}`；只有主动作 → 直接 `activate(primary)`。
- 菜单里按 1 → 弹出 album 并 `activate(primary)`；按 2 → 切到 `{pick}`。挑选器里确认 → 弹出 album 并 `activate({verb, thing})`（与调试 API `show/use` 是同一个入口）；Esc 回到菜单（或直接关闭）。
- `mode.album` 是临时模式（推迟存档）、冻结世界、释放指针、停止移动（§4.6 策略表）。
- **格子序号与键盘光标**（M1c 冻结，engine-wp4.md #1、engine-wp6.md #1）：格子总列表 `things = [...state.listPhotos().map(p => p.id), ...state.listItems().map(i => i.id)]`（照片在前、物品在后，各按系统返回的顺序；相册 4 列在左分页、物品一列在右，同屏）；`{ t:'pick', index }` 与键盘光标都是它的下标。`pick` = 选中这一格并确认（挑选器里等于 Enter；浏览时等于“打开”：文档类物品 → `openDoc`，`opensJournal` → `openJournal`，照片与其他物品只选中）；UI 点击只发 `pick`。方向键：照片区里上下 = ±4 且不出照片区，物品区里上下 = ±1 且不出物品区，左右 = 总列表 ±1（可跨区），都钳到 [0, N−1]（`game/modes/album.ts` 的 `albumNavIndex` 与 `ui/album.ts` 的 `albumNav` 同一规则）；挑选器初始光标：`use` 指第一件物品、`show` 指第一张照片（没有就指另一区）；挑选器里 Tab 在两区之间跳。`AlbumMode` 公开只读 `cursor`、`kind: 'browse' | 'menu' | 'pick'`、`menuIndex`，以及 `things()`、`selectThing(thing): boolean`（调试用）。子状态切换（菜单 ↔ 挑选器）用 pop + push，所以 `modes.arg('mode.album')` 总是当前子状态（UI 与 `DebugState.album.kind` 据此区分）；动作菜单的点选发 `{ t:'digit', n: 1|2 }`。
- **面板的自动接线**（M1c 写明，engine-wp4.md #9）：`ctx.codeLock/naming` 登记的面板挂在 owner 交互物名下，主动作按 talk（第一个满足的）→ `onInteract` → owner 名下的密码锁/称呼面板 → “这儿用不上。”的顺序取，所以 owner 交互物**不要写 onInteract**；前置用它自己的 `when/blocked`（如 `r3.stool`“单子还没开呢，坐那儿干啥。”），解开之后的反馈也用 `when/blocked`（如 `when: '!r1.drawer_open'`）。
- **settle 与反馈**（M1c 写明，engine-wp4.md #12）：`activate(…, 'api')` 内部 `await game.settle()`（锁步下推进时间直到 settle）；玩家来源（E 键、菜单、挑选器）不推进时间，只 `await effects.settled()`。activate 若发现栈顶是指向该对象的 album（menu/pick），先弹掉它再检查模式。成功时 `result.feedback` 是本次执行期间最后一条 `'feedback'` 文本（如取件格“空的。”）。

### 6.7 NPC（`game/npc.ts`）

```ts
export interface NpcDef {
  id: NpcId;
  rig: CharacterRig | PaperRig | THREE.Object3D;
  yin: boolean;                                    // 阴物：layer.yin；取景器中交互后常显
  placement: (s: StateView) => { pos: V3; yaw: number; pose?: Pose; floor?: number } | null;   // null = 不在场
  interact: Omit<InteractableDef, 'id' | 'at'> & { anchorY?: number };   // 锚点 = 站位 + anchorY（默认 1.2）
  tempC?: number;                                  // 红外温度；鬼魂 6、黄三爷 36.5（写到整棵子树的 userData.tempC）
  photoAnchorY?: number;                           // 拍照锚点高度（默认头部）
  lights?: { light: THREE.Light; anchor: THREE.Object3D | string }[];   // 跟随 NPC 的灯：灯本身由 ctx.light() 挂在 lightsRoot 下，引擎每帧把它移到锚点（rig.props 的键或对象）的世界坐标；NPC 不在场时强度置 0，灯数不变
  onPlaced?(npc: NpcHandle, prevPos: V3 | null): void;   // 站位变化时（可做淡出淡入）。M1c 写明（engine-wp4.md #10）：NPC 本来在场、新站位不同且定义了 onPlaced 时，引擎**不瞬移**，只调用 onPlaced(npc, prevPos)，由区域 npc.fadeTo(新站位, yaw) 挪过去（王奶奶换层）；首次摆放、出现/消失、没有 onPlaced 时直接摆到位再通知
  update?(npc: NpcHandle, dt: number): void;
}
export interface NpcHandle {
  readonly id: NpcId; readonly root: THREE.Object3D; readonly present: boolean;
  readonly yielded: boolean;                       // 正在为回放让位（见下）
  fadeTo(pos: V3, yaw: number, sec?: number): Promise<void>;   // 淡出→瞬移→淡入（王奶奶换层）
  setPose(p: Pose): void; lookAt(p: V3): void;
  setLabel(t: string | ((s: StateView) => string)): void;       // 改角标（等价于 InteractableHandle.setLabel）
  setVariant(v: string): void;                     // 转给 CharacterRig.setVariant（黄三爷揭面具）
}
export class NpcSystem {
  add(d: NpcDef): NpcHandle;                       // ctx.npc() 调用：建根节点、登记交互物（InteractionSystem.register）与拍照主体 ref（id 同 NPC id）、跟随灯；本区 root/ctx 经 game.areas.current 取（build 期间已指向本区，§4.5 第 4 步）
  get(id: NpcId): NpcHandle | undefined;
  reevaluate(): void;                              // 进区域、每次 'flag'/'temp' 事件后按 placement 重算站位与在场（见下）
  yieldWithin(center: V3, radius: number): void;   // 回放让位：3D 距离 ≤ radius 的现世 NPC visible=false、yielded=true（ReplaySystem 调用，§6.9）
  restoreYield(): void;                            // 回到现在时复原
  clearArea(): void;                               // 离开区域时移除本区全部 NPC
  update(dt: number): void;                        // 淡入淡出、跟随灯、NpcDef.update
}
```

- `NpcSystem.reevaluate()` 在进入区域、每次 `flag`/`temp` 事件后调用；站位**只由 flags 推导**（GDD §4.6），与做事顺序无关（王奶奶初见条件里的“一楼灯此刻亮着”是区域临时状态 `temp(lamp_lit_1)`，由 R2 在快门点灯时 `ctx.setTemp` 写入，20 秒后清掉）。
- NPC 自动登记为拍照主体 ref（id 同 NPC id）与交互物。
- **回放让位**（GDD M4、§3.6）：回放开始时，与该残影点距离（3D）在 `walkRadius` 内的现世 NPC 全部 `visible=false`、`yielded=true`：不渲染、不参与拍照遮挡与主体解析、不参与聚焦、`activate` 返回 `not_present`；回到现在后复原。P4 门口王奶奶的魂影、P10 摊后的黄三爷都靠这条。
- **老周**：`npc.zhou` 是阴物，但它的“看见过”来自 `pt.zhou_tunnel` 的 onHit（`E.seen(NPC.ZHOU)`），而不是取景器里按 E。R1-finale 给它 `interact.view: 'any'`、`present: F.R1_ZHOU_VISIBLE`，此后常光下可见可交互（GDD P13“完成后”、步骤 55）。
- **黄三爷**（GDD P9、§10.2）：不用 `when/blocked`，一切写在 `onInteract` 里，示意：

```ts
interact: {
  label: s => (s.flag(F.R4_FOUND_HUANG) ? '黄三爷' : '纸人'), menuVerb: 'show',
  onInteract: async g => {
    if (!g.state.flag(F.R4_FOUND_HUANG)) {
      const seeThrough = g.state.flag(F.R4_SPOTTED_HUANG) || (g.vf.on && g.vf.lens === 'ir');   // 红外看破是不提示的备选解法，不补设 spotted
      if (!seeThrough) { g.feedback(TEXT.fb.paperNoAnswer); return; }     // 与 r4.stall_* 完全相同的反馈
      g.setFlag(F.R4_FOUND_HUANG); g.say(TEXT.fb.unmask);                 // 旁白；先写 flag，再开对话（§11.5）
      await g.dialogue('dlg.r4.huang_unmasked');
      return;
    }
    await g.dialogue(/* 按 flags 选对话 */ 'dlg.r4.huang_idle');
  },
  // 看破前没有 offers：按 E 直接走 onInteract，不弹动作菜单，与 r4.stall_*（只有主动作）完全相同
  offers: s => (s.flag(F.R4_FOUND_HUANG) ? { accept: { /* ph.true_form、ph.huang_hides、ph.huang_ir … */ }, fallback: TEXT.fb.huangWhat } : undefined),
}
```

### 6.8 取景器、红外与拍照

#### 6.8.1 取景器（`game/viewfinder.ts`）

```ts
export class ViewfinderSystem {
  readonly on: boolean; readonly lens: LensMode; readonly zoom: ZoomLevel;
  readonly frameAspect: number;            // 恒为 4/3（M1a：`4 / 3` 不是合法的 TS 类型写法）
  setLens(l: LensMode): ApiResult;         // 'ir' 需要 r2.ability_ir，否则 { ok:false, reason:'no_ability' }
  stepZoom(dir: 1 | -1): ZoomLevel;        // 1→2→3→4→6，带变焦马达声与镜头环
  centerRay(target?: THREE.Ray): THREE.Ray;
  tempReading(): number | null;            // 红外：准星射线首个命中物体的 tempC（0.1℃）
  frameNdcScale(): { sx: number; sy: number };   // 屏幕 NDC → 4:3 画框 NDC 的缩放（判定与读字用；窄视口时画框与视口同宽，见 §4.7）
  setOn(on: boolean): void;                // M1a 补写：mode.viewfinder 的 enter/exit 调用（发 'viewfinder'、推/弹 vf 叠加）
  update(dt: number): void;                // M1a 补写：§3.2 第 6 步
  resetOptics(): void;                     // M1c 补写：镜头回常光、倍率回 1×（镜头环一起转回）；只由 Game.newGame/continueFrom/?area= 开局与 toTitle 调用
}
```

- **过场里撤掉取景器后期**（M1d）：栈上有 `mode.cutscene` 时 `vf`/`ir` 两层后期撤掉（过场一律是固定机位，不带 4:3 黑边、×2.5 色差与红外伪彩），过场结束再压回（订阅 `'mode'`）；`on`/`lens` 本身不变。
- **两层取景器**（M1d）：`ViewfinderMode.exit` 调 `setOn(modes.has('mode.viewfinder'))`——pop 先出栈再 exit，栈上还有一层取景器（取景器 → 面板 → 面板上叠的取景器）时弹掉上层不会把取景器关掉。另外 `VcrSystem.open()`/`ConsoleSystem.open()` 压面板前先弹掉栈顶的裸取景器与回放（§6.10、§6.11），正常路径下不会出现两层。

```ts
```

- 进入/退出由 `mode.viewfinder` 负责：相机切到 `fp`，推 `vf` 后期叠加（扫描线 0.25、色差 ×2.5、4:3 黑边），HUD 显示 OSD。离开取景器时**不复位**镜头与倍率，下次进入沿用（要切回常光须显式 `lens('normal')`：GDD §11 步骤 44 在拍完 `ph.huang_ir` 后、步骤末尾必做一次 `lens('normal')`，否则步骤 48、53 会拍出“屏幕上只剩一团热”）。
- 倍率变化（`stepZoom`、`resetOptics`）同时调用 `cameras.setZoom(z)` 与 `playerModel.head.setZoom(z)`（镜头环转到对应档位，GDD M3；engine-wp2.md #3）。
- 面板上叠加取景器时**不**强制常光；R1 给 `pt.tape_face`、`pt.zhou_tunnel` 的 `wrong_lens` 写专属空镜标题“屏幕上只剩一团热。先切回常光（Q）。”（GDD P12、P13），玩家能看懂原因。
- 高清贴图：`ctx.hdText()` 登记的线索贴图在“取景器开启且倍率 ≥ minZoom 且距离 ≤ maxDist”（默认 2× 与 6m，可按登记覆盖）时换成 2048 版本（首次需要时才生成）。（由 WP1 的 `AreaContextImpl.updateViews()` 在 §3.2 第 7 步每帧按 `game.sys.viewfinder` 的 `on`/`zoom` 与距离切换，`ViewfinderSystem` 不做；`viewVariant` 同理。）

#### 6.8.2 红外（`fx/ir.ts`）

```ts
export class IrRenderer {
  begin(roots: THREE.Object3D[]): void;    // 渲染前：遍历可见 Mesh/InstancedMesh，把 material 暂换为 irMaterial(tempC)
  end(): void;                             // 渲染后立即还原（玩法代码永远看不到被替换的材质）
  static tempOf(obj: THREE.Object3D): number;   // obj.userData.tempC ?? material.userData.tempC ?? 18
}
```

- **为什么不用 `scene.overrideMaterial`**：它无法按物体给不同温度。逐帧换材质的代价在本项目规模（每区域 ≤ 2000 个网格）可以接受。
- `irMaterial(t)` 按 0.5℃ 量化缓存；是 `MeshBasicMaterial`（支持实例化，`fog:false`），颜色为线性灰度 `t/45`；替换时继承原材质的 `side`、`alphaTest` 与 `map`（只用于 alpha 裁切，如树叶卡片、纸人轮廓），缓存键为（温度, side, map, alphaTest）。色带映射在后期里做（§8.1 的 `CameraFxPass`）：红外时关 Bloom，`CameraFxPass` 的红外分支直接读线性灰度（不做色调映射）查 `IR_RAMP`，并加粗噪点。
- **instanceColor**：r186 的 `WebGLProgram` 在 `instancingColor` 时给片元着色器定义 `USE_COLOR`，`color_fragment` 执行 `diffuseColor *= vColor`，替换上的灰度会被实例颜色染色（窗户用 instanceColor 区分亮暗）。`begin()` 时暂存并置空每个 `InstancedMesh.instanceColor`，`end()` 时还原（置空会走另一个着色器变体，由 `fx/warmup.ts` 预热）。
- **透明贴花**：原材质 `transparent && map` 而没有 `alphaTest`（`makeTextPlane({bg:null})` 的文字、湿脚印、光带贴花）时，`irMaterial` 设 `alphaTest = 0.5` 继承 alpha 轮廓，不会变成一块块 18℃ 的矩形；`userData.irHide = true` 的对象在红外下直接隐藏。
- 雨（实例化雨丝，`irHide`）与所有 `Line`/`Points` 在红外下隐藏。
- 补充规则（M1c 按 WP3 的实现写明，engine-wp3.md #6；`fx/ir.ts` 文件头）：`Sprite` 与 `Line`/`Points` 一样隐藏；`material.visible === false` 的网格（`MATERIALS.hitProxy`）原样保留；几乎全透明（`transparent && opacity < 0.05`，如淡到 0 的身体）隐藏；透明、无贴图、`opacity < 0.6` 的非 ShaderMaterial（玻璃）隐藏，否则会变成挡住后面的整块板子。魂影/回放人影这类 ShaderMaterial 换成实心 irMaterial（`MATERIALS.replay()` 的 tempC 是 18：回放人影在红外下与环境同温——它们是“过去的影像”）。掠射面至多压暗 20%（发射率下降）、朝天的面再压 6%（向夜空散热；M1c look-dev，原为掠射 12%），同温的墙地箱子仍有转折；正对镜头的竖直面系数为 1。CameraFxPass 的红外分支另叠一道淡白的 MSX 式轮廓线（温度/掠射突变处，M1c look-dev），同温物体在红外下也分得开。共享材质的缺省温度：环境 18；湿沥青 16、金属/铁皮 15、玻璃 16；纸/魂影/纸像发光 6；灯/霓虹 60；通电 CRT 42（`CRT_TEMP_C`）。
- 温度：环境 18、阴物与纸 6、冷迹 3、活物 36（黄三爷 36.5，戴面具时也是）、暖壶 50、灯 60（GDD §3.3）；**鬼市灯笼是阴火，6℃**（R4 给灯笼对象 `tempC: 6`，覆盖 `MATERIALS.emissive` 默认的 60），全场只有黄三爷一个暖色。`MATERIALS` 每个共享材质自带 `userData.tempC`；`obj.userData.tempC` 优先于材质。

#### 6.8.3 拍照目标数据（`PhotoTargetDef`，区域填写）

```ts
export interface PhotoTargetDef {
  id: PhotoTargetId;                               // 命中得 ph.<同后缀>
  subjects: { ref: SubjectRef; anchor?: V3 }[];    // 多主体须同时满足；anchor = 主体局部坐标偏移，缺省 = 世界包围盒中心
  frameBox?: number;                               // 默认 0.6：锚点须在 4:3 画框中央 60%（|ndc| ≤ 0.6）
  minScreenFrac?: number;                          // 默认 0.12：主体包围盒投影高度 / 画框高度
  maxDist: number;                                 // 镜头到每个锚点
  minZoom: ZoomLevel; maxZoom?: ZoomLevel;
  lens: 'normal' | 'ir' | 'any';
  context: PhotoContextReq;
  when?: Cond;
  occlusion?: boolean;                             // 默认 true
  priority?: number;
  onHit?: Handler;
  captions?: Partial<Record<PhotoFail, Caption>>;  // 失败时的空镜标题（GDD 各谜题“错误反馈”）；可按拍摄情境生成
}
export type Caption = string | ((c: PhotoContext, s: StateView) => string);
// 例：P12 pt.tape_face 的 too_early/too_late 按暂停时刻查 GDD P12 的标题表：
//   captions: { too_early: c => tapeCaption(c), too_late: c => tapeCaption(c), wrong_lens: TEXT.cap.screenHeat, not_paused: TEXT.cap.blurred }
// 例：P13 pt.zhou_tunnel 的 wrong_channel：c => `只拍到了 CH${c.kind === 'console' ? c.channel : '?'} 的画面。`
export type PhotoContextReq =
  | { kind: 'live' }
  | { kind: 'replay'; segment: SegmentId; t: readonly [number, number] }
  | { kind: 'vcr'; paused: true; tc: readonly [string, string] }
  | { kind: 'console'; channel: 1 | 2 | 3 | 4 | 5; jack?: boolean }
  | { kind: 'tripod'; zone: string; radius: number; stillSec: number };   // 只登记元数据，判定在 TripodSystem
export type PhotoContext =
  | { kind: 'live' }
  | { kind: 'replay'; segment: SegmentId; t: number }
  | { kind: 'vcr'; paused: boolean; tc: number }
  | { kind: 'console'; channel: 1 | 2 | 3 | 4 | 5; jack: boolean };
export type PhotoFail =
  | 'nothing' | 'not_in_frame' | 'partial' | 'too_far' | 'zoom_low' | 'zoom_high' | 'wrong_lens' | 'too_small'
  | 'occluded' | 'hidden' | 'too_early' | 'too_late' | 'wrong_segment' | 'not_paused' | 'wrong_channel' | 'no_jack' | 'cond';
export interface PhotoDecoyDef {                   // 只产出空镜 + 专属标题（底片 1/2/4 格、拍镜子等）
  key: `decoy.${AreaKey}.${string}`;      // M1a：AreaKey（含 dev）
  subjects: { ref: SubjectRef | string; anchor?: V3 }[];
  caption: Caption; maxDist: number; minZoom?: ZoomLevel; lens?: 'normal' | 'ir' | 'any';
  context?: PhotoContextReq; when?: Cond; priority?: number;
}
```

主体 ref 解析：`ghost.*` → 当前回放片段中的人影（片段未播放则 `hidden`）；`npc.*` → NPC 根节点（回放让位中则 `hidden`）；其他 → 区域 `ctx.ref(id, obj)` 登记的对象（交互物带 `hit` 时自动登记）；`pc.body` → 三脚架模式下的身体。被当前回放片段 `hideWorld` 隐去的现世对象算 `hidden`（`pt.menshen_2018` 在 `seg.door_2018` 第 0–8 秒拍，先因时间窗得到 `too_early`；其 `captions.too_early = c => (c.kind === 'replay' && c.t >= 6 ? '还没贴好呢。' : '门上还是光的。')`，对应 GDD P4 的两条错误反馈）。区域加载后校验全部 ref 可解析。

#### 6.8.4 判定算法（`game/photo.ts`，引擎实现，区域只填数据）

```
shoot():
  前置：栈顶是 viewfinder 或 replay（replay 总压在 viewfinder 之上；面板叠加时栈顶就是 viewfinder）
       → 否则 { ok:false, reason:'not_in_viewfinder' }
       （tripod 与 cutscene 的“快门”由各自模式处理，不走这里）
  1. 拍摄上下文 ctx：回放中 → replay{segment,t}；叠加在录像机面板上 → vcr{paused,tc}；叠加在监控台上 → console{channel,jack}；否则 live
  2. cam = cameras.photo（与 fp 同位姿、同 zoom，aspect 4/3），updateMatrixWorld + updateProjectionMatrix
  3. 候选 = 本区全部 PhotoTargetDef 与 PhotoDecoyDef
  4. 对每个候选逐项检查，记录第一个失败原因与“通过项数”：
     a. context 匹配：kind 不同 → 跳过该候选（不计入失败）；replay 片段不同 → wrong_segment；
        t < t0 → too_early；t > t1 → too_late；vcr 未暂停 → not_paused；tc 早/晚 → too_early/too_late；
        console 频道不符 → wrong_channel；jack 要求未满足 → no_jack
     b. when 不满足 → cond
     c. lens 不符 → wrong_lens；zoom < minZoom → zoom_low；zoom > maxZoom → zoom_high
     d. 每个主体：
        - 不可见（isRenderableBy(obj, cam) 为假，或回放人影不存在）→ hidden
        - p = anchor 世界坐标；p 在相机后方 → not_in_frame
        - ndc = p.project(cam)；|ndc.x| > frameBox 或 |ndc.y| > frameBox → not_in_frame
        - |cam.pos - p| > maxDist → too_far
        - 主体包围盒 8 角投影，取 NDC y 跨度 / 2 < minScreenFrac → too_small
        - occlusion：Raycaster 从 cam.pos 指向 p，far = 距离 - 0.15，只测本区 occluders（不透明、可见、
          非 noOcclude、非主体自身子孙；回放让位的 NPC 与 hideWorld 隐去的对象因 visible=false 自然排除）→ 命中 → occluded
          （M1d：“挡不挡视线”与准星聚焦、读字共用 game/viewfinder.ts 的 occludesView，规则见 §6.6 聚焦规则 1）
        多主体时：若至少一个主体通过而另一个失败 → partial（除非失败原因是 too_early/too_late 这类共性原因）
  5. 命中者按 priority 降序、再按锚点到画面中心的距离升序取第一个
     - PhotoTarget 命中 → ph.<suffix>：已拥有则不新增，仍执行 onHit（onHit 必须幂等：flag 只写一次）
     - Decoy 命中 → 空镜，标题 = decoy.caption（函数则传入 ctx）
  6. 无命中 → 空镜 ph.empty_<n>：标题取“通过项数最多”的候选的 captions[fail]（函数则以 (ctx, state) 调用）
       M1c 细化（WP5 的实现，engine-wp5.md #1）：失败候选先按 onScreen 降序（至少一个主体的锚点投影落在整个画面 |ndc| ≤ 1 内；
       被 hideWorld 隐去、只在别的图层的主体也按位置算），再按通过项数、priority、登记顺序；**没有任何目标在画面里时 fail 记为
       'nothing'**（不取画外目标的专属标题）。诱饵只在命中时出标题，不参与失败标题的挑选。回放人影不在当前片段时解析不到，算“不在画面里”，
       所以 wrong_segment 的专属标题只在目标至少有一个现世主体正对着时出现。
       ?? 区域 emptyCaption(state, near)（near = 快门时 interaction.focused，没有则 null；mergeAreaParts 已合成“依次询问、取第一个非 undefined”）
       ?? strings 默认（EMPTY_CAPTIONS[fail]；无候选时 fail = 'nothing'）
  7. 生成缩略图（§6.8.5），写 PhotoRecord，发 'photo'；无论命中与否都先发 'shutter'（R2 声控灯监听它）
  8. 返回 { ok:true, result:{ photo: PhotoId, hit: PhotoTargetId | null, caption?: string } }
```

```ts
export class PhotoSystem {
  register(targets: readonly PhotoTargetDef[], decoys: readonly PhotoDecoyDef[],
    o?: { emptyCaption?: AreaDef['emptyCaption']; photoArt?: AreaDef['photoArt'] }): void;   // AreaManager.enter 第 4 步与 ctx.photoTarget/photoDecoy 调用；可多次调用（合并），id 重复在 dev 下抛错
  clearArea(): void;                               // 离开区域时清空本区目标、诱饵、emptyCaption 与 photoArt
  shoot(): ApiResult<{ photo: PhotoId; hit: PhotoTargetId | null; caption?: string }>;   // 上面的算法；onHit 作为顶层 run 交给 EffectRunner（调试 API 再按 §6.3 settle）
  award(id: KeyPhotoId, opts?: { caption?: string; thumb?: 'render' | 'art' }): PhotoRecord;   // §6.8.5
  resolveSubject(ref: SubjectRef | string): THREE.Object3D | null;   // 主体 ref 解析（上文“主体 ref 解析”；区域加载后的校验与 aimAt 共用）
  target(id: PhotoTargetId): PhotoTargetDef | undefined;   // M1a 补写：本区目标（调试 API 的瞄准点解析）
  decoy(key: PhotoDecoyDef['key']): PhotoDecoyDef | undefined;   // M1a 补写：本区诱饵（静态登记与 ctx.photoDecoy 登记的都在内；调试 API 的瞄准点解析 decoy.* 用）
}
export type ShootResult = ApiResult<{ photo: PhotoId; hit: PhotoTargetId | null; caption?: string }>;   // M1a 补写：shoot() 返回类型的别名
```

默认空镜标题（`data/strings.ts`）：`not_in_frame`“没对准”、`too_far`“太远了”、`zoom_low`“太小了，看不清”、`zoom_high`“太近了，看不全。”、`wrong_lens`“颜色不对”、`too_small`“就一个小点儿”、`occluded`“被挡住了”、`partial`“只拍进去一半”、`not_paused`“糊了。先停住。”、`nothing`“空镜”。（M4：引擎默认标题一律不带句号；区域 `captions` 兼作反馈句、可以带“。”，记进相册的 `title` 去掉句末“。”，`caption` 原样保留——M4 整合补写，`game/photo.ts`。）

#### 6.8.5 缩略图与照片元数据

- `shoot()` 在判定之后、白闪之前调用 `game.renderNow()` 同步渲染一帧，立刻 `drawImage(renderer.domElement, 4:3 居中裁切)` 到 192×144 离屏 canvas，`toDataURL('image/jpeg', 0.7)`。同一任务内读取 WebGL canvas 不需要 `preserveDrawingBuffer`。
- 实物照片（`ph.covered_face`、`ph.true_form`）和 `ph.final` 的缩略图由区域提供画法：`AreaDef.photoArt[photoId] = (g: CanvasRenderingContext2D, w, h) => void`。
- `award(id, opts?: { caption?: string; thumb?: 'render' | 'art' }): PhotoRecord` 供三脚架、Effect `photo` 使用。

#### 6.8.6 读字目标（`game/read.ts`）

```ts
export interface ReadTargetDef {
  id: ReadId;
  at: V3 | ((g: GameApi) => THREE.Vector3);   // 字迹中心（世界坐标）。函数形式每帧求值：跟随 NPC（rd.huang_breath 取黄三爷 anchors.mouth），
                                              // 或镜中字取“实物点”（rd.sticker_mirror：g.player.model.stickerWorld()）
  via?: { mirror: InteractId };  // 镜中字：at 是实物点，判定用它关于该镜面平面的虚像（见下）
  maxDist: number; minZoom: ZoomLevel;
  lens?: 'normal' | 'ir';        // rd.portrait_sketch 为 'ir'；rd.huang_breath 为 'normal'。M1c 写明：缺省按 'normal'（engine-wp5.md #5）——红外画面里没有褪字层，红外镜头下不读任何没写 lens:'ir' 的目标
  frameBox?: number;             // 默认 0.5
  when?: Cond;
  text: string;                  // UI 覆盖层原文
  mirror?: boolean;              // 覆盖层用 scaleX(-1) 显示
  tooSmall?: string | null;      // 默认“（字太小了，再拉近点。）”；null = 倍率不够时什么也不显示（rd.huang_breath：否则只有 S3 会冒提示，等于泄题）
  notInMirror?: string;          // via.mirror 时虚像不在镜面圆盘里的反馈（GDD P2：“（镜子里照不到你的脑门。往镜子正前方站。）”）
  onRead?: Handler;              // 第一次读到时执行（可写 flag、线索；rd.huang_breath 在这里设 r4.spotted_huang 并记线索）；必须幂等。M1d：“第一次”按本次进区域算（ReadSystem.clearArea 清掉记录），重进区域、新游戏、读档后再读会再执行一次
}
export class ReadSystem {
  readonly reading: { id: ReadId; text: string } | null;   // 当前正在读的目标（state() 暴露）
  readonly hint: string | null;                            // 当前显示的 tooSmall/notInMirror 文本（state() 暴露为 reading 为空时的 readHint）
  register(defs: readonly ReadTargetDef[]): void;          // AreaManager.enter 第 4 步（AreaDef.readTargets）与 ctx.readTarget() 调用；id 重复在 dev 下抛错
  clearArea(): void;                                       // 离开区域时清空本区目标
  evaluate(): void;              // §3.2 第 6 步每帧调用（WP1）：取景器开启时做下文的判定，未开启时只把 reading/hint 清为 null；aimAt() 后立即执行一次
  get(id: ReadId): ReadTargetDef | undefined;                             // M1a 补写：本区目标
  aimPoint(id: ReadId, target?: THREE.Vector3): THREE.Vector3 | null;    // M1a 补写：此刻的瞄准点（函数 at 现算；via.mirror 时取虚像点）
}
```

**普通判定**：取景器开启 + `when` + 镜头符合 + 锚点在画框 `frameBox` 内 + 距离 ≤ maxDist + 无遮挡 → 若 zoom ≥ minZoom 显示覆盖层原文并发 `read`（第一次还执行 `onRead`），否则显示 `tooSmall`（为 `null` 则不显示）。

**“读过”的持久来源**（M1c 写明，engine-wp4.md #14、engine-wp6.md #5）：`JournalSystem` 监听 `'read'` 事件并 `state.markSeen(rd.id)`（`seen` 进存档），所以 `DocDef.covered.readBy` 的判定 `state.seen(readBy)` 读档后仍成立（讣告下半截不会重新打码）；`renderDoc` 与阅读器都按它处理 covered 段。

**镜中字判定**（`via.mirror`，GDD §3.14、P2、§7.3）：
1. `P` = `at(g)`（贴条实物点）；`mirror = mirrorSystem.disc(via.mirror)`（圆盘中心 C、单位法线 n、半径 r；R1 的圆镜中心 (-5.8,1.80,18.6)、直径 0.5）。
2. 虚像 `P' = reflectPoint(P, 平面(C, n))`（`core/math.ts`）。
3. 距离 = 镜头到**镜面平面**的距离，须 ≤ maxDist（1.2）。
4. 用 `P'` 做 `frameBox` 判定（它就是玩家在镜子里看到贴条的方向）。
5. 线段“镜头 → P'”与镜面平面的交点 X 必须落在圆盘内（`|X - C| ≤ r`），否则显示 `notInMirror`；遮挡射线测“镜头 → X”。
6. zoom ≥ minZoom（3×）才显示覆盖层原文（镜像字形）。

几何依据：平面镜里看自己身上一点，反射点高度 =（视点高 + 该点高）/2，与距离无关；镜头 1.85、贴条 1.93 → 反射点约 1.89，落在 1.55–2.05 的镜面内。站偏时交点跑出圆盘，所以 `aimAt` 加距离判定不再能“穿过”这一步。`core.mjs` 必须有一例：站在交点落到镜外的位置（例如镜面平面前 0.9m、横向偏 0.6m）时读不到，并得到 `notInMirror`。

### 6.9 回放（`game/replay.ts`）

```ts
export interface ReplayPointDef {
  id: ReplayPointId;
  at: V3;
  segments: readonly SegmentId[];                  // 按 R 的顺序：[0] = 最近
  startRadius?: number;                            // 默认 2.5（3D 距离：R2 楼层上下叠放，隔着楼板不能启动另一层的回放）
  walkRadius?: number;                             // 默认 8（3D 距离）：走出即退出回放（“画面断了”）；也是现世 NPC 让位的半径
  lookAngle?: number;                              // 默认 30°：镜头前向与指向 at+0.8m 的夹角上限
  present?: Cond;                                  // 默认恒真（旋涡是否存在）
}
export interface ReplayActorKey { t: number; pos: V3; yaw: number; pose: Pose }
export interface ReplaySegmentDef {                // GDD §3.6 + 扩展
  id: SegmentId; point: ReplayPointId; order: number;        // 1 = 最近
  osd: string;                                     // '2018-02-16 10:21'
  dur: number; loop: true;
  actors: {
    id: GhostId;
    rig: 'mannequin' | 'paper' | 'crowd';
    character?: CharacterKind; characterOpts?: CharacterOpts;   // 'mannequin' 时用哪个造型（默认通用人形）；zhou 自动 faceMask
    crowd?: CrowdOpts;                             // 'crowd' 时必填
    keys: readonly ReplayActorKey[];
  }[];
  props?: { id: string; mesh: string | (() => THREE.Object3D); keys: { t: number; pos: V3; yaw?: number; visible?: boolean }[] }[];   // 片段道具（layer.replay，mat.replay 调色）；如 seg.door_2018 第 6–8 秒“正在被贴上”的一对门神，左张歪约 8°
  hideWorld?: { ref: string; from: number; to: number }[];   // 片段内 [from,to) 秒隐去的现世对象（ctx.ref 登记的 id）：visible=false，不渲染、不挡镜头、不参与拍照（hidden）；如 seg.door_2018 的 r2.menshen [0,8)
  subs: { t: number; dur: number; speaker: SpeakerId | ''; text: string }[];
  sfx?: { t: number; cue: SfxCue }[];
  locked?: Cond;                                   // 为真时显示 lockedText，不能播放
  lockedText?: string;                             // 默认“雪花太密了。好像有什么东西不让你看。”
  onComplete?: Handler;                            // 播放头第一次越过 dur（含 seek 越过）时执行，每次进入回放最多一次
}
export class ReplaySystem {
  readonly active: { point: ReplayPointId; seg: SegmentId; index: number; count: number; t: number; playing: boolean } | null;   // M1c 写明：index 从 1 起（= 片段在 point.segments 里的下标 + 1，HUD 的“1/3”与 DebugState.replay.index 同值）
  canStart(): ApiResult<{ point: ReplayPointId }>;   // 取景器中、倒带能力、近残影点并看着它、非面板
  pressR(): ApiResult<{ seg: SegmentId }>;          // 开始；已在回放中则切到更早一段（最早之后回到最近）
  present(): ApiResult;                             // F：回到现在
  togglePlay(): void;
  seek(t: number): void;                            // 钳制到 [0, dur]；t ≥ dur 视为越过终点 → 触发 onComplete，然后从 0 循环
  seekRel(sec: number): void;                       // Z/C ±5
  stepSec(dir: -1 | 1): void;                       // 暂停时逐秒
  actorObject(id: GhostId): THREE.Object3D | null;  // 拍照判定
  register(points: readonly ReplayPointDef[], segs: readonly ReplaySegmentDef[]): void;   // AreaManager.enter 第 4 步（AreaDef.replayPoints/segments）与 ctx.replayPoint() 调用；可多次调用（合并）
  prebuild(root: THREE.Object3D): readonly THREE.Object3D[];   // 隐藏地构建本区全部片段的人影与道具并挂到 root 下（AreaManager.enter 第 4 步，在 build 之后），返回各片段根节点供 warmupArea 预热（§8.5）
  clearArea(): void;                                // 离开区域：退出回放（walked_out）、销毁人影与道具、清空本区数据
  exit(reason: 'exit' | 'walked_out' | 'mode'): void;  // M1a 补写：任何传送、levels.set()、模式重置时由 WP1 调用
  point(id: ReplayPointId): ReplayPointDef | undefined; // M1a 补写：本区残影点（调试 API 瞄准点解析）
  update(dt: number): void;
}
```

- 未获得倒带能力时在残影点按 R：“（地上有一团雪花在打转。你还不会看这个。）”（`reason:'no_ability'`）。
- 进入回放：推 `mode.replay`，相机掩码加 `replay` 层，后期叠加 `replay` 预设（VHS 条纹、抖动、棕绿色调），HUD 显示 `◀◀ <osd> <秒>` 与“2/3”。
- **现世让位**：进入回放时，`walkRadius` 内的现世 NPC 让位（`NpcSystem.yieldWithin(point.at, walkRadius)`，退出时 `restoreYield()`，§6.7）；每帧按当前 `t` 对 `hideWorld` 列表设置对应对象的 `visible`。退出回放（F、走出半径、任何传送、`levels.set()`、模式重置）时全部复原。
- **老周的脸**：片段里凡是 `character:'zhou'` 的人影，`createCharacter` 自动 `faceMask:true`（GDD M4：“他缺的那一块在你眼睛里，倒带倒不出来”）。R1 给 `r1.desk` 的补脸处理写专属反馈：拿含老周的旧照（`ph.old_2`）补脸 →“照片上他的脸是一团雪花。倒带倒不出他的脸。”
- 人影：按 `actors` 用 `createCharacter(…, {look:'replay'})`/`createPaperFigure`/`createCrowd` 生成，材质 `mat.replay`（`depthWrite:false`、`renderOrder 20`、layer.replay）。关键帧之间：位置线性、yaw 最短角插值、姿势在关键帧处 0.3s 混合。**进区域时就预先隐藏地构建本区全部片段的人影与道具**（避免第一次倒带时现编译着色器卡顿），回放时只切 `visible`，离开区域时销毁。
- 回放的 `t` 在冻结模式下不走；锁步下只在 `advance()` 里走。
- `onComplete` 里可以放画外音：例如 `seg.gate_2026` 的 `onComplete: [E.flag(F.R1_P1_DONE), E.say(TEXT.tudiCallBack, NPC.TUDI)]`（“看完了？回来，跟你说个事儿。”，GDD P1 步骤 7）——`say` 只出字幕，不进入 dialogue 模式、不打断回放。
- 片段数据是纯数据，放在区域 `replay.ts`；`AreaDef.segments` 与 `AreaDef.replayPoints` 静态登记。
- 旋涡视觉用 `kit/residue.ts` 的 `createResidueVortex()`（layer.yin，只在取景器可见）。
- **细节语义**（M1c 按 WP5 的实现写明，engine-wp5.md #4）：
  - `onComplete`“每次进入回放最多一次”按**片段**计：一次回放里用 R 切到别的片段，那一段的 onComplete 也各自最多一次；F 退出后重新进入回放可以再触发。
  - `seek(t ≥ dur)` 越过终点后 t 置为 0（不是 t − dur）；`update` 播放越过终点时按 t − dur 续播。`stepSec` 先暂停再走一秒。
  - 锁住的片段（`locked` 为真）：开始回放时跳过，从下一个没锁的开始；全锁则显示第一段的 `lockedText` 并返回 `locked`。R 循环时同样跳过锁住的段。
  - 片段字幕 `subs` 用 `GameApi.say`（只出字幕，不进 dialogue）；seek 落进某句字幕的时间窗时补显示剩余部分。`speaker: ''` 当旁白。
  - “画面断了。”只在真的走出 `walkRadius` 时显示；WP1 为传送调 `exit('walked_out')` 时不出这句。`exit('exit' | 'walked_out')` 在 `mode.replay` 在栈顶时把它弹掉；`exit('mode')` 不弹（`ReplayMode.exit` 与 `ModeStack.resetTo` 走这条，模式栈自己在弹）。
  - `ActorDef.rig:'paper'` 用 `createPaperFigure({ kind: characterOpts.variant === 'boy' ? 'boy' : 'vendor' })` 再换 `MATERIALS.replay()`；`props.mesh` 为字符串时视为 `ctx.ref` 登记的现世对象，克隆一份并换 `mat.replay`；函数形式的道具只设 replay 层与 renderOrder，材质由区域负责；M3 补写（docs/requests/r4.md #2）：离开区域时 `clearArea()` 像区域 Disposer 一样释放函数道具子树里的几何、非共享材质与贴图（片段根节点在 Disposer 遍历区域 root 之前就被摘下，原来谁都不释放，每进一次区域泄一批）；区域在模块里缓存复用这些资源也可以（释放后再用会重新上传），与 `ctx.track()` 重复释放无害。`character:'zhou'` 一律 `faceMask:true`（区域不能关）。

### 6.10 录像机（`game/vcr.ts`，M6）

引擎实现通用的走带逻辑，R1 提供带子内容。

```ts
export interface TapeTrack {
  startLabel: '2023-08-29 周二 22:00:00'; lengthSec: 28800;          // 22:00:00 → 06:00:00
  cams: { ch1: CameraPose; ch2: CameraPose };                         // CH1 = 门楣俯拍门口；CH2 = 屋角半球机位（只拍得到桌前人的后脑勺和肩膀）
  splitFrom: '02:51:00';                                              // 从这里起画面是左 CH1 | 右 CH2 的双分屏（GDD §3.8）
  actors: { id: GhostId; character: CharacterKind; opts?: CharacterOpts; keys: readonly ReplayActorKey[] }[];   // t 为带子秒；老周用 look:'live'、不开 faceMask
  build(scene: THREE.Scene, kit: TapeKit): void;                      // 往**独立的 tapeScene** 里建 2023 年的门岗立面与屋内（低模）、雨、2–3 盏自带的灯
}
export interface TapeKit { light<T extends THREE.Light>(l: T): T; track<T extends { dispose(): void }>(r: T): T; rng(salt?: number): () => number }   // tapeScene 专用的小工具（灯 ≤ 3，单独计预算）
export interface VcrConfig {
  screen: THREE.Mesh;                              // 与监控台共用的 CRT 屏幕
  viewPose: CameraPose;                            // 面板视点
  track: TapeTrack;
  timelapseUntil: '02:51:00';                      // 此前 1× = 120 带子秒/真实秒；此后 1× = 1
  alarmFrom: '02:51:00';
  slowZone: readonly [string, string];             // ['03:13:30','03:14:30']：快进进入即降到 1×，屏角闪“SLOW”
  index: readonly string[];                        // 7 个索引点
  events: { tc: string; effects: Handler }[];      // “到达或越过”即触发：播放头以任何方式移动后 tc ≥ event.tc 且本次加载未触发过（见下）
  subtitles?: { from: string; to: string; text: string }[];   // 如 00:30 段“（录像机不录声音）”
}
export class VcrSystem {
  readonly loaded: boolean;                        // 带子在机器里（r1.tape_in_vcr 推导 + 临时状态）
  readonly tc: number;                             // 带子秒，0 = 22:00:00
  readonly playing: boolean;
  readonly shuttle: -16 | 0 | 16;
  configure(c: VcrConfig): void;                   // R1 build 时调用；离开 R1 时自动清除
  open(): ApiResult;                               // 推 mode.panel_vcr（需要已装带）
  insert(): ApiResult;                             // 装带并打开面板，停在 22:00:00
  togglePlay(): void; pause(): void; play(): void;
  setShuttle(dir: -1 | 0 | 1): void;               // 按住 Z/C
  stepSec(dir: -1 | 1): void;                      // 逐秒
  jumpIndex(dir: -1 | 1): void;                    // [ ]
  seek(tc: string | number): void;                 // 调试/索引共用；移动后按“到达或越过”检查 events
  tcString(): string;                              // 'HH:MM:SS'
  osd(): string;                                   // 'CH1 2023-08-30 周三 03:14:05'（00:00 跨日；分屏后右半 OSD 为 CH2）
  clearArea(): void;                               // M1a 补写：离开 R1 时清除配置、释放 tapeScene、注销 feed
  update(dt: number): void;
}
```

- **带子画面用独立的 `tapeScene`**：它是一个单独的 `THREE.Scene`，不挂在 R1 的 root 下，与 R1 当前的 flags、NPC、灯的亮灭、寅时停雨、红圈“拆”字、玩家身体完全解耦（直接渲染 R1 场景会把土地、陆师傅、今晚的主角拍进 2023 年的录像）。`TapeTrack.build(scene, kit)` 在里面建低模的 2023 年门岗立面（门、台阶、门灯、院门一角）与屋内（桌、椅、CRT）、雨、2–3 盏自带的灯（**单独计预算 ≤ 3**，不占 R1 的 8 盏）。
- 构建与释放：`tapeScene` 在第一次 `open()`/`insert()` 时构建（面板淡入的 0.3 秒里预热着色器；M1d：用 `fx/warmup.ts` 的 `warmScene` 以 CH1、CH2 两台机位真画一遍进 1×1 线性 RT，全部对象不剔除、隐藏的也显出来——原来 `compileAsync(scene, ch1)` 在渲染目标为 null 时编的是用不上的 sRGB 变体，02:51 分屏才入画的人物要到播放中途才编译），**只在 `mode.panel_vcr` 在栈上时刷新**（M1d：与镜面错开一帧，`(frameNo + 1) % feedEvery === 0`），离开面板时释放（`kit.track` 追踪的资源全部 dispose）；下次打开重新构建。`open()` 在压面板前先弹掉栈顶的裸取景器/回放（M1d，§6.8.1）。
- 渲染：一张 256×192 RT。`tc < splitFrom` 时整幅渲 CH1 机位；`tc ≥ 02:51:00` 起，左右两个 128×192 视口分别渲 CH1 与 CH2（每半幅按 4:3 横向压扁，像当年的分屏器），03:16 回屋趴桌、05:12 一动不动都出现在右半 CH2。CRT 屏幕材质再叠 OSD、ALARM、扫描线、桶形畸变。
- **events 的“到达或越过”语义**：播放头任何一次移动（播放、快进、逐秒、索引、seek）之后，对每个 `tc_now ≥ event.tc` 且本次加载尚未触发的事件执行 effects（effects 本身必须幂等）。所以用 `]` 正好跳到索引点 03:16:00、或从更后的位置倒回来，都会设 `r1.tape_watched`（GDD §3.8、P12 步骤 4；walkthrough 步骤 49 专门验证“正好落在索引点上”）。
- 离开面板时带子留在机器里、位置保留；读档后回到 22:00:00（临时状态）。
- 快门在面板叠加取景器时走通用拍照判定，上下文 `vcr{paused, tc}`；空镜标题按暂停时刻由 R1 的 `captions` 函数给出（GDD P12 标题表）。
- **细节语义**（M1c 按 WP5 的实现写明，engine-wp5.md #3）：`loaded` = 已 `configure` 且（本次 `insert()` 过 或 `r1.tape_in_vcr`）。`insert()` **不写** `r1.tape_in_vcr`（进度 flag 由 R1 在 `use(r1.vcr, it.tape_830)` 的 handler 里先写，再 `g.vcr.insert()`）。没装带时 `open()` 返回 `blocked`，没配置时 `no_such_target`。快进进入降速区 = 转成 1× 播放并闪 SLOW（shuttle 归 0）；在降速区里再按 C 仍是 1×，出了降速区才能重新快进；一帧内跨过 02:51 延时边界或降速区入口时按边界拆开积分（`advance()` 的大 dt 也不会越界）。离开面板时暂停（“暂停的画面在退出面板后保留”），带子位置保留；离开区域（`clearArea`）时位置复位到 22:00:00、事件“已触发”记录清空。`jumpIndex(-1)` 取严格早于“当前 − 0.5 带子秒”的索引点。

### 6.11 监控台、CRT 屏幕、镜面（`game/cctv.ts`、`game/crt.ts`、`game/mirror.ts`）

```ts
export type ChannelSource =
  | { kind: 'live'; camPose: CameraPose; every?: number }                        // CH2：低分辨率实时
  | { kind: 'self'; noSignal: (g: CanvasRenderingContext2D, w: number, h: number) => void }   // CH1：视频线插上 = 取景器画面
  | { kind: 'static'; paint: (g: CanvasRenderingContext2D, w: number, h: number, s: StateView, t: number) => void; animate?: boolean };  // CH3–5
export interface ConsoleConfig {
  screen: THREE.Mesh; viewPose: CameraPose;
  channels: Record<1 | 2 | 3 | 4 | 5, ChannelSource>;
  tunnelBaked: () => THREE.Texture;               // 照妖镜预制：8 层嵌套 CanvasTexture（settings.tunnelMode='baked'）
  tunnelInner?: (g: CanvasRenderingContext2D, w: number, h: number, s: StateView) => void;   // 隧道最深处画面（椅子上的老周）
}
export type CrtLayout = 'single' | 'split5';
export class ConsoleSystem {
  readonly channel: 1 | 2 | 3 | 4 | 5;
  readonly jack: boolean;                          // 临时状态：视频线是否插在“视频入1”
  readonly layout: CrtLayout;
  configure(c: Partial<ConsoleConfig>): void;      // 可分多次提供字段并合并（R1-world 给 screen/viewPose/channels，R1-finale 给 tunnelInner/tunnelBaked）；同一字段给两次在 dev 下抛错；区域 build 结束时必须齐全
                                                   // M1a 的占位 world.ts 与 finale/index.ts 各自已提供自己那一半（§15.1），所以两个代理任何时候都只替换自己那一半字段，不会因对方未完成而加载失败
  open(): ApiResult;                               // 推 mode.panel_console（M1d：先弹掉栈顶的裸取景器/回放，§6.8.1）
  select(ch: 1 | 2 | 3 | 4 | 5): ApiResult;
  setLayout(l: CrtLayout): void;                   // 'split5'：开场“五路分屏”（GDD §2.2）；过场结束或打开面板时回到 'single'
  plugJack(): ApiResult; unplugJack(): void;       // R1 负责“离桌子 > 2m 自动拔出”。只切状态、不动线：线由区域 GameApi.player.model.cable.plugTo(插孔节点)/plugTo(null) 挂上/松开（M1d，§5.2）
  tunnelDepth(): number;                           // 当前套叠层数（音效渐强用）
  validate(): string[];                            // M1a 补写：build 结束时缺失字段列表（dev 下非空即抛错；AreaContextImpl.finalize() 调用）。本区从未调用过 configure 时返回 []（只有调用过的区域要求 screen/viewPose/channels/tunnelBaked 齐全）
  clearArea(): void;                               // M1a 补写：§4.5 第 3 步
  update(dt: number): void;                        // M1a 补写：§3.2 第 6 步（WP1 调用；“离桌 > 2m 自动拔线”由 R1 做）
}
export class CrtScreenController {                 // 决定那块 CRT 此刻显示什么：录像机面板 > 监控台频道（或五路分屏）> 待机（当前频道）
  attach(screen: THREE.Mesh): void;                // M1a 补写：把 screen.material 换成控制器私有的 createCrtScreenMaterial() 实例（即 this.material），detach 时还原原材质；
                                                   // 由 WP5 在 cctv/vcr 的 configure 收到 screen 时调用（同一块屏幕重复 attach 是空操作）。MATERIALS.crtScreen() 只作未通电/装饰用 CRT 的静态外观，
                                                   // 不接任何 feed，控制器不得改它的 uniforms（它是共享实例：tapeScene 里 2023 年的 CRT 也用它，接上 tape RT 就是 GL feedback loop）
  readonly material: THREE.ShaderMaterial;         // fx/crtScreen.ts 的 createCrtScreenMaterial() 私有实例（运行时是 CrtScreenMaterial，§8.4）
  update(dt: number): void;                        // M1a 补写：§3.2 第 6 步（WP1 调用）
  detach(): void;                                  // M1a 补写：离开区域（§4.5 第 3 步，WP1 经 AreaContextImpl.dispose() 调用）；还原 screen.material；未挂接时是空操作
}
export interface MirrorDef {
  id: InteractId;                                  // 'r1.mirror'（读字的 via.mirror 用它找圆盘）
  mesh: THREE.Mesh;                                // 圆镜；镜面朝向为其局部 +z；圆盘半径取自几何
  size?: 1024;
  activeWhen: (g: GameApi) => boolean;             // 玩家在门卫室内
  every?: 2;                                       // 每 2 帧
  far?: number;                                    // 反射相机 far，默认 8
  baked: () => THREE.Texture;                      // settings.mirrorMode='baked' 的预制镜像贴图
}
export class MirrorSystem {
  register(d: MirrorDef): void;
  readonly active: boolean;
  disc(id: InteractId): { center: THREE.Vector3; normal: THREE.Vector3; radius: number };   // 读字判定用（§6.8.6）
  clearArea(): void;                               // M1a 补写：§4.5 第 3 步（WP1 经 AreaContextImpl.dispose() 调用）
}
```

- **只在屏幕看得见时刷新**（M1d，性能评审）：CH2 实时画面与 CH1 自身画面（插线时）要重渲整个场景，所以只在屏幕看得见时刷新——监控台/录像机面板开着（面板视点正对屏幕）、分屏过场里，或屏幕的包围球在当前主相机视锥内且不远于 12m；红外画面里（CRT 只是一团热斑）不刷新。CH2 与镜面错开一帧：`(frameNo + 1) % every === 0`（镜面是 `frameNo % every === 0`）。
- **五路分屏**（GDD §2.2、§3.2 开场）：`setLayout('split5')` 时 `crtScreen` 着色器把屏幕分成 2×3 格：CH2 那一格实时采样 CH2 的 RT（此时 CH2 相机含 self_head，看得见坐在椅子上的自己），其余 CH1（“无信号”）、CH3、CH4、CH5 与一格日期 OSD 采样一张 512×384 的静态画布图集（由各频道的 `paint`/`noSignal` 画进去）。过场用 `{ crt: { layout: 'split5' } }` 步骤切换（§6.14），相机可以对准屏幕满幅。
- **CH1 自身画面 / 照妖镜**：视频线插上后，每帧把 `fp` 相机画面渲染进 256×192 RT；屏幕显示**上一帧**的 RT（两张 RT 乒乓交替，避免同一 RT 同时读写）。取景器对准 CRT 时自然形成无限套叠。`tunnelInner` 在补脸前画空椅子、补脸后画抬头的老周，由 CRT 材质按套叠深度混入画面中心。
- **CH2 与“看得见自己屏幕”的 feed**（`fx/feeds.ts` 的通用规则）：凡是相机可能看到“正在采样自身 RT 的表面”的 feed，一律两张 RT 乒乓（CH1、CH2 都是），或在该 feed 渲染期间把那块屏幕设为不可见（镜面属于后者）。CH2 半球机位 (-7.8,2.4,18.8) 俯拍门卫室，正好看得到桌上 CRT 的正面；CRT 显示 CH2 时若不乒乓，就是 GL feedback loop（Chrome 报 `GL_INVALID_OPERATION`，只是 warning，three r186 除 transmission 外不做防护）。harness 把这类 console 警告判为失败（§12.4）。
- **镜面**：照搬 three r186 `examples/jsm/objects/Reflector.js`（约 130–250 行）的数学，**不要**自己推：
  1. 用镜面世界矩阵求平面与法线；主相机位置关于平面镜像得到反射相机位置，`lookAt` 镜像后的注视点构造反射相机（`up` 同样镜像）；
  2. `textureMatrix = bias · P_reflect · V_reflect · M_mirror`，镜面着色器顶点里 `vUv = textureMatrix * vec4(position,1)`，片元里 `texture2DProj(tDiffuse, vUv)` 投影采样——**不翻转 UV**（反射相机本身已经产生镜像，再翻一次就错）；
  3. 用镜面平面做**斜投影近裁面**（Reflector 里改 `projectionMatrix.elements[2/6/10/14]` 的那段），镜子背后的北墙与墙外场景不会漏进来；
  4. 渲染反射 RT 期间 `mirror.visible = false`（避免反馈环），`userData.auxHide` 的对象（雨）一并隐藏，`far` 约 8m；
  5. 唯一与 Reflector 不同之处：按 §4.7 显式设置 `reflectionCamera.layers.mask`（world + self_head，取景器开启时再加 yin、faded_text、self_sticker_vf），不沿用主相机的图层。
  只在 `activeWhen` 为真时、每 `every` 帧渲染一次。`baked` 模式的预制贴图按同样的构图绘制（头在镜面上半部，贴条在镜头上方，贴条字已镜像），直接用普通 UV 贴上。
- 拍 `pt.zhou_tunnel` 用通用判定：上下文 `console{channel:1, jack:true}`，主体是 CRT 屏幕网格（ref `r1.crt`），`minScreenFrac 0.4`、`maxZoom 1`。面板视点距屏幕约 0.5m、屏幕 0.36×0.27m 时，1× 下屏幕约占画面高度 58%，满足条件。命中的 onHit 由 R1-finale 写：`[E.flag(F.R1_ZHOU_VISIBLE), E.seen(NPC.ZHOU)]`（GDD §7.3：老周记为“看见过”）。

### 6.12 三脚架与长曝光（`game/tripod.ts`，X2/X4）

```ts
export interface TripodConfig {
  mount: THREE.Object3D;                           // 门楣空支架（头装上去的位置）
  camPose: CameraPose;                             // CH1 机位
  zone: V3; radius: number;                        // 粉笔叉 r1.mark_photo，1.5
  countdown: number; stillSec: number;             // 10、3
  osd: (remaining: number) => string;
  onSuccess: Handler;                              // 由 R1 写：award ph.final、r1.soul_returned、过场
  onFailOutside: Handler; onFailMoved: Handler;    // 反馈文本 + 老周台词；回到 armed
}
export class TripodSystem {
  readonly state: 'off' | 'armed' | 'countdown' | 'exposing';
  readonly remaining: number; readonly exposure01: number;
  configure(c: TripodConfig): void;
  enter(): ApiResult;                              // 头 detach → mount；推 mode.tripod；相机 fixed=camPose（role 'tripod'，不含 self_head）；身体可控
  start(): ApiResult;                              // 左键：开始 10 秒倒计时（armed → countdown）
  cancel(): ApiResult;                             // E：仅 armed 时可用；头回到身上，回到 explore，save.release('ending')
  bodyGoto(x: number, z: number): ApiResult;       // 调试定位
  update(dt: number): void;                        // 倒计时 → 曝光：每帧检查 input.moveActive() 与身体到 zone 的距离（冻结时不走）
  clearArea(): void;                               // M1a 补写：§4.5 第 3 步（WP1 经 AreaContextImpl.dispose() 调用）
  osdText(): string;                               // M1c 冻结（engine-wp6.md #9）：区域 TripodConfig.osd(remaining) 的当前文字（未配置时 ''）；TripodHud 的 OSD 行用它
}
```

- 入口是强制对话 `dlg.r1.bracket_confirm` 的选项 1“装回去”，其 effects 为 `E.call(g => g.tripod.enter())`。`tripod.enter()` 内部先 `save.hold('ending')`，`cancel()` 内部 `save.release('ending')`；区域不直接碰存档（§6.4）。
- **细节语义**（M1c 按 WP5 的实现写明，engine-wp5.md #3）：`enter()` 在对话（或相册）还在栈上时不立即压 `mode.tripod`，而是监听 `'mode'` 事件，栈上没有对话的那一刻再压（选项 effects 里调用时对话还在栈顶，直接压会让对话结束时弹掉三脚架；§6.13 另有“终止选项先弹对话”的顺序保证）。成功：先弹 `mode.tripod`、状态回 `off`，再以顶层 run 执行 `onSuccess`（R1 在里面 award `ph.final`、开过场），成功后紧接着的 `photo.award()` 记为 `context: 'tripod'`；头留在门楣支架上、`ending` hold 不释放，`clearArea()`（片尾后新游戏/读档换区域）时才把头装回身子。“出圈”在倒计时结束（曝光开始）那一刻判一次、曝光结束再判一次；“移动”在曝光期间每帧判。

### 6.13 对话（`game/dialogue.ts`）

```ts
export type DText = string | ((s: StateView) => string);   // 正文与选项文字可以随 flags 生成（如“n/6”）
export type DNode =
  | { type?: 'line'; who: SpeakerId | ''; text: DText; next?: string; effects?: Handler; rec?: 1 | 2 }  // who='' = 旁白；pc.huoji 的行只闪 REC
  | { type: 'choice'; who?: SpeakerId | ''; text?: DText; options: DOption[]; noLeave?: boolean }
  | { type: 'branch'; cases: { when: Cond; next: string }[]; else: string }
  | { type: 'do'; effects: Handler; next?: string }
  | { type: 'end'; effects?: Handler };
export interface DOption { label: DText; next: string; when?: Cond; effects?: Handler }
export interface DialogueDef {
  id: DialogueId;
  start: string;
  nodes: Record<string, DNode>;
  forced?: boolean;                                // 强制对话：选项节点不自动加“（先这样）”；退出项由数据自己写（“再等等”“（算了）”）
  lockView?: boolean;                              // 默认 true
}
export function defineDialogues(area: AreaKey, defs: Record<DialogueId, Omit<DialogueDef, 'id'>>): DialogueDef[];   // M1a：AreaKey；dev 下校验 id 前缀 dlg.<area>. 与 start 节点存在
export function seq(lines: readonly (readonly [SpeakerId | '', DText])[], end?: Handler): Omit<DialogueDef, 'id'>;   // 线性对话快捷写法
export class DialogueSystem {
  readonly active: DialogueActive | null;           // M1c：类型命名为 DialogueActive（见下）；text/options 是求值后的字符串
  register(defs: readonly DialogueDef[]): void;    // 启动时由 AreaManager 汇总全部区域的 AreaDef.dialogues 登记（id 带区域前缀，全局唯一，重复在 dev 下抛错）
  start(id: DialogueId, scope?: RunScope): Promise<RunOutcome>;   // 推 mode.dialogue；结束时 'done'，被 cancelAll 打断时 'cancelled'；节点 effects 在该 scope 下内联执行（§6.3）
  advance(): ApiResult;                            // 打字中 → 补完；否则去 next
  choose(k: number): ApiResult;                    // 1 起，按当前可见选项计数
  update(dt: number): void;                        // 打字机（游戏时间；?test=1 即时）；停在台词行或选项时把 effects.waitingInput 置真
}
export interface DialogueActive {                  // M1c 冻结（engine-wp4.md #2、engine-wp6.md #6）
  id: DialogueId; node: string; who: SpeakerId | ''; text: string; typing: boolean; options: string[];
  shown: number;                                   // 打字机已显示的字数（typing 为假时 = 全文字数）；text 恒为该行**全文**，对话框只显示前 shown 个字
  rec?: 1 | 2;                                     // pc.huoji 行的 REC 闪烁次数
}
```

- 非强制对话的每个 `choice` 节点末尾自动追加“（先这样）”（跳到 end）。
- **结束顺序**（M1c 写明，engine-wp4.md #4）：选项的 next 指向 end 节点（或是“（先这样）”）时，**先弹 `mode.dialogue`**，再在同一 scope 里执行该选项与 end 节点的 effects，最后 resolve；非终止选项/节点的 effects 在对话仍在栈上时执行。所以 `dlg.r1.bracket_confirm` 的“装回去”（`g.tripod.enter()` 压 mode.tripod）不会压在对话之上。自愈：栈顶那层 `mode.dialogue`/`mode.cutscene` 没有对话/过场认领时，`DialogueMode.update`/`CutsceneMode.update` 把它弹掉。
- **嵌套**（M1c 写明，engine-wp4.md #5）：对话 → 过场 → 对话时栈上是 `[…, dialogue, cutscene, dialogue]`（§4.6 允许同一模式叠多层）；对话里直接再开对话（节点 effects 里 `E.dialogue`）复用栈顶那层 `mode.dialogue`，不再压栈；过场同理。
- **游戏内一切“确认/二选一”都是强制对话的选项节点**（GDD §3.4），不做确认框，所以调试 API 的 `choose(k)` 天然可用：
  - `DLG.R1_BRACKET_CONFIRM`（R1-finale）：旁白正文 `s => s.antCount() < 6 ? '把头装回去，就下不来了。树底下的蚂蚁收着了 ' + s.antCount() + '/6 张旧照。' : '把头装回去，就下不来了。树底下的蚂蚁把旧照都收齐了。'`；选项 1“装回去”（effects `E.call(g => g.tripod.enter())`），选项 2“再等等”（直接结束，回到 explore，什么也不变）。
  - `DLG.R2_STAIRS`（R2）：选项“上楼”（`when: s => floor < 5`）、“下楼”（`when: floor > 1`）、“（算了）”；选项 effects 调 `g.setLevel(n ± 1)`。楼层数用区域临时状态或 `LevelsHandle.current` 生成。
- 说话时 `audio.murmur(who, dur)` 播放含糊合成人声底子；门神/灶君用低频共振峰嗡声；`pc.huoji` 的行不出字，只让 REC 灯按 `rec` 闪。
- 数据全部在区域 `dialogue.ts`；台词文本照抄 GDD §8。

### 6.14 过场（`game/cutscene.ts`）

```ts
export type CutStep =
  | { cam: CameraPose | 'player' | 'ch1'; blend?: number; barrel?: number; layers?: readonly LayerName[] }   // CameraPose 用 fixed 角色（world + self_head + layers）；'ch1' 用 ch1 角色（不含 self_head）
  | { osd: string | ((t: number) => string) | null }
  | { say: DText; who?: SpeakerId | ''; dur?: number }
  | { title: string; sub?: string; dur: number }
  | { wait: number }
  | { fade: 'out' | 'in' | 'white'; dur: number }                        // white 遵守 reduceFlash（改为柔和淡入白）
  | { effects: Handler }
  | { dialogue: DialogueId }
  | { crt: { layout?: CrtLayout; channel?: 1 | 2 | 3 | 4 | 5 } }         // 开场“五路分屏”等
  | { run: (g: GameApi, ctx: AreaContext) => Awaitable<unknown> }         // 一次性；ctx 是当前区域的 AreaContext，可 ctx.add 尾声道具（挖掘机、平掉的院子），随区域卸载释放
  | { during: number; tick: (g: GameApi, t01: number, dt: number, ctx: AreaContext) => void } // 持续若干秒，逐帧回调（游戏时间）
  | { await: 'shutter' | 'zoom'; zoom?: ZoomLevel; prompt?: string; early?: string }   // 等玩家按快门/变焦
  | { music: MusicCue } | { sfx: SfxCue } | { post: { key: string; params: Partial<FxParams> } | { pop: string } }
  | { hurry: number | null };                                            // M4 第 2 轮：此后按住空格时计时步骤 ×hurry 推进（片尾字幕这类不可跳过但可快进的段落；null 关掉，§15.7.3）
export interface CutsceneDef { id: CutsceneId; steps: readonly CutStep[]; skippable?: 'never' | 'rewatch'; restore?: boolean }
export class CutsceneSystem {
  readonly active: { id: CutsceneId; step: number; awaiting: 'shutter' | 'zoom' | null } | null;
  register(defs: readonly CutsceneDef[]): void;    // 启动时由 AreaManager 汇总全部区域的 AreaDef.cutscenes 登记（id 全局唯一）
  play(id: CutsceneId, scope?: RunScope): Promise<RunOutcome>;   // 推 mode.cutscene；{effects}/{run}/{dialogue} 步骤在该 scope 下内联执行；被打断时 'cancelled'
  onShutter(): ApiResult;                          // 在 await:'shutter' 步骤推进；此前按快门显示 early（如“天还黑着。”）
  onZoom(dir: 1 | -1): ApiResult;                  // 在 await:'zoom' 步骤调整固定相机倍率，到达目标倍率即推进
  update(dt: number): void;                        // await 步骤期间 effects.waitingInput 为真
  osdText(): string | null;                        // M1c 冻结：当前 {osd} 步骤的文字（UI 每帧拉取）；没有时 null
}
```

- 首次观看不可跳过；再次观看（`seen('cs…')`）可跳过，结局除外（`skippable:'never'`）。M1c 更正（engine-wp4.md #7、engine-wp1.md #9）：`{ t:'play' }` 只在按下时产生（没有按住时长），所以“长按空格”简化为**按一下空格**即跳过——此后计时步骤（wait/say/title/fade/during）立即完成，effects/对话/await 照常执行（进度不会漏写）。
- **`{ cam:'ch1' }` 与 `'player'`**（M1c 写明，engine-wp4.md #6）：引擎拿不到 CH1 机位（它在 R1 的 `layout.ts` 与 `TripodConfig.camPose` 里），所以 `{ cam:'ch1' }` 保持固定相机**当前位姿**、只切到 ch1 角色（不含 self_head）；过场开播时固定相机先摆到当前主相机的位姿。要用 CH1 机位时先写 `{ cam: R1.derived.ch1Cam }`（或三脚架之后，固定相机本来就在 CH1 机位）再 `{ cam:'ch1' }`。`{ cam:'player' }` = 固定相机摆回第三人称相机的位姿。
- **OSD / 白闪 / 提示**（M1c 写明，engine-wp6.md #3）：`{ osd }` 的当前文字由 `CutsceneSystem.osdText(): string | null`（M1c 冻结；函数形式以该 osd 步骤起算的游戏秒求值）给出，UI 每帧拉取、画在 4:3 画框左上（REC + 文本），过场结束自动清空；`{ fade:'white' }` 走 `post.flash(dur*1000)`；`{ await }` 的 `prompt` 用 `ui.toast(prompt, 'tutorial')`，`early` 用 `ui.toast(early)`。
- `{effects}`、`{run}` 步骤里再开对话或过场（P8 onCorrect 过场里发 `ph.true_form`/`it.portrait`/`r3.saw_true_form`，结局里对话 → 过场 → 对话的嵌套）都是内联执行，不排队（§6.3 可重入）。
- 过场里控制主角身体用 `g.player.model`（开场坐椅子 `setPose('sit')`、P14 `setBodyOpacity(0, 3)`、尾声 `setVisible(false)`）。

### 6.15 面板（`game/panels.ts`）

```ts
export interface CodeLockDef {
  owner: InteractId;                               // r1.drawer
  digits: number; answer: string;
  title?: string;
  onSuccess: Handler;                              // 成功后面板自动关闭
  failText: string;                                // “锁纹丝不动。”
  failClue?: { after: number; text: string };      // 连错 3 次写线索
}
export interface NamingDef {
  owner: InteractId;                               // r3.stool
  header: string;                                  // “长明照相馆　取件单　No.0474　姓名：＿＿”
  answer: NameId;
  wrong: Partial<Record<NameId, string>>;          // 选错的专属反馈，回到列表
  onCorrect: Handler;
}
export class PanelSystem {
  registerCode(d: CodeLockDef): void; registerNaming(d: NamingDef): void;
  openCode(owner: InteractId): ApiResult;          // 由交互物的 onInteract 通过 E.call 或 ctx.codeLock 自动接线
  openNaming(owner: InteractId): ApiResult;
  readonly code: CodeState | null;                 // M1c：类型命名为 CodeState 并加字段（见下）
  readonly naming: NamingState | null;             // M1c：类型命名为 NamingState 并加字段（见下）
  clearArea(): void;                               // M1a 补写：§4.5 第 3 步（WP1 经 AreaContextImpl.dispose() 调用）；清空本区登记的密码锁与称呼面板
}
```

```ts
// M1c 冻结（engine-wp4.md #2/#8、engine-wp6.md #4）：UI 画转轮/表头需要的字段
export interface CodeState { owner: InteractId; entered: string; fails: number; wheels: number[]; cursor: number; digits: number; title?: string }
// entered = 已确认的前几位；wheels = 每个转轮此刻的数字（含正在拨、尚未确认的那一位；面板显示它）；cursor = 当前轮（0 起）
export interface NamingState { owner: InteractId; options: NameId[]; header: string; labels: string[] }   // labels 与 options 同序
```

- 密码面板（M1c 按 WP4 的实现写明输入模型，engine-wp4.md #8）：`digits` 个转轮 + 光标；数字键 = 当前轮设成该数字并右移；滚轮（`wheel`；panel_code 里的 `zoom` 也当滚轮）= 拨当前轮；Enter = 确认当前轮并右移，已在最后一轮（或已输满）时提交；Backspace = 光标左移；Esc 离开。调试 `input('0618')` = 逐位 digit + confirm；真人滚轮 = 每位拨到数字后 Enter，第 4 次 Enter 即提交。错误：`failText` 反馈、清零、面板保持打开；连错 `failClue.after` 次写线索并 toast“巡夜本上多了一行字”；失败计数按 owner 记在内存，成功清零。
- 面板挂在 owner 交互物名下的自动接线见 §6.6（owner 不写 onInteract）。
- 称呼面板：只列 `state.names()`；1–6 或点击；`choose(nameId)` 也可。
- 面板打开期间 `effects.waitingInput` 为真（`activate` 在面板打开时即 settle，返回 `opened`）。

### 6.16 巡夜本与文档（`game/journal.ts`）

```ts
export interface DocDef {
  id: DocId; title: string;
  style: 'ballpoint' | 'wet_ink' | 'print' | 'notice' | 'slip' | 'letter' | 'ticket' | 'book' | 'plaque';
  body: string | ((s: StateView) => string);       // 褪字层标记：〔…〕 包住的文字只在取景器中翻开时显出（GDD M1、§7.4 取件单“No.04〔7〕3”）
  covered?: { text: string; readBy: ReadId };      // 讣告下半截：读到 rd.obituary_hidden 之前在阅读器里打码
}
export interface JournalPageDef { index: number; when: Cond; text: string }   // 新页①–⑨（R1 text.ts 提供）
export type JournalArg = { doc: DocId; vf: boolean } | undefined;              // M1a 补写：mode.journal 的进入参数（打开巡夜本时 undefined）
export class JournalSystem {
  registerDocs(docs: readonly DocDef[]): void;     // 启动时从全部区域的 text.ts 汇总（M1a：readonly，AreaDef.docs 是只读数组）
  registerPages(p: readonly JournalPageDef[]): void;
  doc(id: DocId): DocDef | undefined;              // M1a 补写：阅读器 UI 取文档定义
  openDoc(id: DocId, o?: { vf?: boolean }): ApiResult;   // 推 mode.journal，arg = { doc, vf }；vf 缺省 = 当前栈上有 viewfinder
  renderDoc(id: DocId, vf: boolean): string;       // 纯文本正文：vf 时〔…〕换成里面的字，否则换成水渍符号“▯”（UI 画成一团水渍）
  openJournal(): ApiResult;
  visiblePages(): JournalPageDef[];
  update(): void;                                  // §3.2 第 6 步（WP1 调用；冻结时不调用）：检查新页，首次可见 → toast“巡夜本上多了一行字” + 主动机 + markSeen
}
```

- 巡夜本右页三栏：称呼（`state.names()` + `NAMES` 来源说明）、已知线索（`state.clues`）、树底下 `n/6`（`state.antCount()`）。WP4 内部的 `right()`/`pageSeen(i)` 给 UI 取这些数据（非冻结）。
- dev 沙盒的 `docs` 是夹具（M1c）：与正式区域同 id 时让位给正式区域（`AreaManager.init` 汇总时过滤），所以沙盒可以登记 `doc.slip_0473` 让 `readDoc` 的成功路径在 M2 之前也能测。
- 物品栏里文档类物品（`ITEMS[id].doc`）点开即 `openDoc`。在取景器里按 Tab（栈 `[…, viewfinder, album]`）点开的文档，阅读器带取景器的扫描线与 OSD，褪字层显出（取件单泡没的第三位“7”）；肉眼点开时褪字处是一团水渍，旁边一句“No.04……第三位泡成了一团水渍。”（GDD P6 错误反馈）。
- 调试 API `readDoc(docId)`（GDD §3.15）走同一路径：要求该文档属于身上的物品（否则 `not_owned`）→ dispatch `album` → 选中该物品 → `openDoc` → 返回 `renderDoc(id, vf)` 的正文 → dispatch `back` 合上。

### 6.17 提示（`game/hints.ts`）

```ts
export interface PuzzleDef {
  id: PuzzleId; order: number;                     // P1=1 … P14=14，H=15
  area: AreaId;
  available: Cond; done: Cond;
  hints: readonly [string, string, string];
  appendTo?: { puzzle: PuzzleId; when: Cond };     // 不参与当前谜题计算；当 current() === puzzle 且 when 为真时，把本谜题同级提示接在它后面（H 南柯：{ puzzle:'pz.p14_wake_me', when:'ants >= 1 && ants < 6' }）
  target?: (s: StateView) => InteractId | ReplayPointId | undefined;   // 空闲闪烁的目标
}
export class HintSystem {
  register(puzzles: readonly PuzzleDef[]): void;   // 启动时由 AreaManager 汇总全部区域的 AreaDef.puzzles 登记，按 order 排序
  current(): PuzzleId | null;                      // GDD §3.12：可用未完成者（不含带 appendTo 的）中优先本区域，否则第一个
  request(): ApiResult<{ puzzle: PuzzleId | null; level: 1 | 2 | 3; text: string; appended?: { puzzle: PuzzleId; text: string } }>;   // H 键；候选为空 → 土地闲话
  update(dt: number): void;                        // 只在 explore/viewfinder 下累计：120 秒无 flag 变化且无交互 → 目标角标闪一次
  resetProgress(): void;                           // M1c 冻结：清掉每题已看到的级数与空闲计时（Game.newGame/continueFrom 调用；提示进度不存档，GDD §3.13）
}
```

- 三级提示冷却 60 秒/级，按谜题分别计时（游戏时间）；`settings.hintNoCooldown` 取消冷却。追加提示与宿主同级、共用宿主的冷却。提示文本在各区域 `text.ts`；谜题定义在各区域 `puzzles.ts`，由 `AREAS` 汇总后按 `order` 排序。
- **南柯**：只在当前谜题是 P14、且蚁穴已收下 1–5 张旧照时，H 键在 P14 提示后面追加南柯的同级提示（一张没交过的玩家不会被剧透；交齐了也不再提示）。`dlg.r1.bracket_confirm` 的正文另外显示 n/6（§6.13）。

---

## 7. `src/ui`：界面

- **分层**（`#app` 下，z 由低到高）：canvas → `#world-markers`（交互角标）→ `#hud` → `#vf`（取景器 OSD、准星）→ `#subs`（字幕与反馈条）→ `#panels`（对话、面板、相册、巡夜本、阅读器）→ `#menus` → `#fade`（淡黑/白闪/时辰字样）。M1d：密码锁/称呼面板这类全屏面板开着时（根节点 `.cm-panel-open`），`#subs` 临时升到 `#panels` 之上、反馈条移到面板框下方——错码“锁纹丝不动。”、错称呼的反馈、“巡夜本上多了一行字”在面板开着时也看得见。取景器 HUD 显示时（`.cm-vf-on`）字幕让到变焦刻度上方；面板上叠取景器时（`.cm-vf-panel`）拍照缩略图让到右下角状态行上方；暂停页开着时（`.cm-pause-on`）`#menus` 升到 `#fade` 之上（过渡的黑幕里万一压了暂停也看得见）。
- **组件接口**（每个组件相同）：

```ts
export interface View { readonly el: HTMLElement; show(arg?: unknown): void; hide(): void; update?(dt: number): void }
export class UI {
  readonly hud: HudView; readonly vf: ViewfinderHud; readonly replay: ReplayHud; readonly dialogue: DialogueBox;
  readonly actionMenu: ActionMenu; readonly album: AlbumView; readonly journal: JournalView; readonly doc: DocReader;
  readonly code: CodePanel; readonly naming: NamingPanel; readonly vcr: VcrPanel; readonly console: ConsolePanel;
  readonly tripod: TripodHud; readonly read: ReadOverlay; readonly menus: Menus; readonly fade: FadeLayer;
  readonly pointerGate: PointerGate;              // “点击继续”遮罩（§4.6）
  toast(text: string, kind?: 'feedback' | 'tutorial' | 'page' | 'system'): void;   // 同时发 'feedback' 事件
  subtitle(text: string, who?: SpeakerId | '', dur?: number): void;   // M1c 写明：同样发 'feedback'（带 speaker）；产出方只调这两个方法，不自己发事件
  setHidden(hidden: boolean): void;               // 截图时隐藏全部 UI
  setFrameRect(r: { x: number; y: number; w: number; h: number }): void;   // 4:3 画框随窗口尺寸变化（§4.7.1）
  setLoading(on: boolean): void;                  // “载入中…”：M1c 写明——WP1 在建区开始时立刻 setLoading(true)、结束时 setLoading(false)，300ms 的延迟（TIMING.loadingDelayMs，真实时间）由 UI 做
  lastFeedback(): string | null;                  // 调试 API state() 暴露：最近一次 'feedback' 事件的文字（含字幕）
  // —— M1a 补写 ——
  constructor(host: HTMLElement, game: Game);     // host = #app
  update(dt: number): void;                       // §3.2 第 10 步（冻结时也调用）：按模式栈显隐各视图、角标投影、字幕计时
  currentSubtitle(): string | null;               // DebugState.subtitle：此刻显示中的最新一行字幕
  // —— M1c 冻结 ——
  isUiEventTarget(t: EventTarget | null): boolean;   // DOM 事件目标是否在 UI 根下（各层 pointer-events:none，所以就是“点在界面上”）；InputManager 据此不把这次鼠标键当游戏输入（§4.6）
  readonly photoToast: PhotoToast;                // M1c 补写（ui/photoToast.ts）：拍照反馈卡片——'photo' 事件 → 缩略图从画框中央飞到画框右下角，下方是照片标题（空镜 = 失败原因），关键照片红标，约 3 秒后淡出（GDD M2“右下角飞入照片缩略图”）；过场、标题与菜单下不显示；不发 'feedback'
}
export function showBootError(host: HTMLElement, kind: 'no_webgl2' | 'exception', detail?: string): void;   // ui/bootError.ts，不依赖 UI 实例（M1a 已给出最小可用实现）
// —— M1a 补写（冻结）——
export type ToastKind = 'feedback' | 'tutorial' | 'page' | 'system';
export type MenuItem = 'continue' | 'yin' | 'new' | 'resume' | 'settings' | 'licenses'; // 2026-10：新增第三方许可入口
export class Menus implements View {              // ui/menus.ts
  showTitle(): void;                              // “继续”仅 save.has('save.auto')；“从寅时重来”仅 save.has('save.yin')；“新游戏”“设置”“第三方许可”总有（§3.1 第 6 步）
  showPause(): void;                              // mode.pause 的 enter 调用
  select(item: MenuItem): Promise<void>;          // 'new' → game.newGame()；'continue'/'yin' → continueFrom；'resume' → 弹出 mode.pause；'licenses' → 第三方许可全文。?new=1 与调试 newGame() 走这里
}
export class FadeLayer implements View {          // ui/fade.ts；画面内（canvas）的淡黑与快门白闪走 PostPipeline 的 fade/flash
  black(level01: number, sec?: number): void;     // DOM 黑幕
  title(text: string, sub?: string, sec?: number): void;   // 时辰过场字样、过场 {title} 步骤
  setLoading(on: boolean): void;                  // “载入中…”（UI.setLoading 转给它）
}
// 其余视图类只实现 View，constructor(game)，各在同名文件：HudView(hud.ts) ViewfinderHud(viewfinderHud.ts) ReplayHud(replayHud.ts)
// DialogueBox(dialogueBox.ts) ActionMenu(actionMenu.ts) AlbumView(album.ts) JournalView(journal.ts) DocReader(docReader.ts；show(arg: { doc: DocId; vf: boolean }))
// CodePanel(codePanel.ts) NamingPanel(namingPanel.ts) VcrPanel(vcrPanel.ts) ConsolePanel(consolePanel.ts) TripodHud(tripodHud.ts)
// ReadOverlay(readOverlay.ts) PointerGate(pointerGate.ts) PhotoToast(photoToast.ts，M1c)。视图从系统状态拉数据（game.sys.*、game.state.list*()），模式处理器只需 show/hide 或交给 UI.update 按栈显隐
```

- 字体用 §1.2 的字体栈；字幕字号三档（`settings.subSize`）。颜色用 `PALETTE` 生成的 CSS 变量（`--osd: #7CFFB2` 等）。
- 取景器 HUD 的 4:3 画框、OSD、准星、倍率条、镜头图标、红外温度读数与左侧色标、“▶ 残影 · R”提示；回放 HUD 的 `◀◀` 时间码与时间轴；录像机面板的传输控件与 7 个索引刻度；三脚架 HUD 的倒计时与“保持不动”进度环——全部照 GDD §10.2。
- 交互角标：白色小角标 + 名字；前置不满足时灰色，聚焦时附一句原因；阴物只在其可见的视图下出现；`blink()` 做一次 0.6s 闪烁。名字取 `label` 现算的值；**角标不得泄露谜底**（§6.6 硬规则）。“色彩辅助”打开时，聚焦对象的 `colorHint` 按当前状态现算，有值才以字幕形式出现在准星下方，不写进角标（R3 容器只在白灯下有值，红灯下不显示）。
- 相册与挑选器（`mode.album`）：鼠标悬停高亮、点击发 `{t:'pick', index}`，方向键发 `nav`，Enter/左键确认；动作菜单是 album 的子状态（`ui/actionMenu.ts`），1/2 两项。
- 所有 DOM 按钮 `tabindex="-1"`、点击后立即 `blur()`；面板打开时指针已由模式策略释放（§4.6）。
- **第三方许可**（2026-10 补写）：标题页入口打开 `licenses` 菜单页，不进入游戏模式或改动存档。正文由 `ui/menus.ts` 以相对路径 `../../public/THIRD_PARTY_NOTICES.txt?raw` 导入，按纯文本保留原文与换行；Vite 仍原样发布 `dist/THIRD_PARTY_NOTICES.txt`。阅读区自动折行、独立滚动，标题和返回按钮固定可见；鼠标滚轮、↑↓、PageUp/PageDown、空格滚动，返回按钮、Enter 或 Esc 回标题；每次打开从顶部开始。键盘经 `UI.bindInput` → `Menus.key(Button)` 处理，`UI.update` 将此页计入标题流程。
- **显隐由 UI 按状态推导**（M1c 写明，engine-wp6.md #11）：`UI.update` 每帧按模式栈与系统状态算出每个视图该不该显示、变化时调幂等的 show/hide，所以模式处理器调不调 show/hide 结果都一致。`'shichen'` 事件 → HUD 左下时辰字样做 2 秒强调（远钟由音频负责）；“点击继续”在栈顶指针策略为 lock、`input.lockAvailable`、未锁定、没有菜单时显示，点击时 `input.requestPointerLock()`；`mode.pause` 在栈上而菜单没显示 → `menus.showPause()`，被弹出 → 收起暂停页（含从暂停页打开的设置页），暂停菜单“继续”回到 lock 模式时顺手 `requestPointerLock()`；标题菜单 `showTitle()` 读 `save.read('save.auto')`，损坏（reason 不是 missing）时 toast `STRINGS.save.corrupted`。
- **反馈与字幕**（M1c 写明，engine-wp4.md #3、engine-wp6.md #8）：`toast`/`subtitle` 显示并发 `'feedback'`，WP4 的 `speak()`（E.say、GameApi.say、过场 `{say}`、H 键提示）只调 `ui.subtitle`、不另发；别处直接 `emit('feedback')`（没经过 UI）的文字，UI 在本帧末尾补显示（带 speaker → 字幕，否则 → 反馈条），同一文字已在显示或正是对话框当前台词时跳过。`subtitle` 的 `dur` 缺省按每字 0.12 秒、最少 2 秒；字幕与反馈条按游戏时间倒计时（冻结时停）。
- **角标闪烁**（M1c，engine-wp6.md #2）：`HudView` 每帧读 `interaction.list()`，`InteractableStatus.blink > 0` 的角标闪烁（即使不在射程内也画）；`HudView.blink(id)` 只是 UI 自己的备用入口（非冻结）。
- **画框单位**（M1c 写明，engine-wp6.md #13）：`CameraRig.frameRect()` 与 `UI.setFrameRect(r)` 都是 `#app` 内的 **CSS 像素**（`RenderPipeline.resize()` 用 host 的 clientWidth/Height 调 `cameras.setViewport`，再经 `onResize` 调 `ui.setFrameRect(cameras.frameRect())`）；UI 写成 CSS 变量 `--fx/--fy/--fw/--fh`；从未调用时 UI 用 #app 尺寸自己算中央最大 4:3 兜底。
- **取景器叠在面板上时不画世界交互角标**（M1c）：此时 E/Esc 下传给面板“离开”，角标会误导。
- **各视图读的系统状态**（M1c 冻结的来源）：对话框读 `DialogueActive`（打字机按 `shown`）；密码/称呼面板读 `CodeState`/`NamingState`（§6.15）；过场 OSD 读 `cutscene.osdText()`；三脚架 HUD 读 `tripod.osdText()`（为空时退回 `shichen.osdLine(1)`）；回放 HUD 的“i/n”直接显示 `replay.active.index`（从 1 起）；相册光标读 `AlbumMode.cursor`（§6.6）。
- WP6 内部（非冻结）：`UI.subs/root/isHidden()/setOsd()`、`HudView.markersEl/blink()/flashRec()`、`FadeLayer.flash()/loadingVisible()/blackLevel()`、`Menus.currentPage()/inPauseFlow()/key()`、`AlbumView.nav()/selected()`、`PointerGate.visible`；`ui/dom.ts`（DOM 小工具）与 `ui/styles.ts` 同属 WP 内部模块。
- UI 只读系统状态、只通过 `game.dispatch()` 或系统公开方法发起动作，**不直接改状态**。

---

## 8. `src/fx`：渲染后期与共享材质

### 8.1 后期链（`fx/post.ts`）

```
RenderPass(scene, activeCamera)                                        // 线性 HDR（HalfFloat RT）
 → UnrealBloomPass(new Vector2(w, h), strength, radius, threshold)   // 内部已是半分辨率；红外与低画质时 enabled=false
 → CameraFxPass (ShaderPass, renderToScreen)                          // 色调映射 + sRGB 编码 + 全部显示空间效果；**取代 OutputPass**，省一个全屏 pass
```

- `CameraFxPass` 的材质 `toneMapped: false`，自己在着色器里做 Neutral 色调映射与 sRGB 编码：着色器开头**只** `#include <tonemapping_pars_fragment>`（M1c 更正，engine-wp3.md #1：r186 给所有非 Raw 的 ShaderMaterial 的片元前缀无条件内联了 `colorspace_pars_fragment`，再 include 一次 `sRGBTransferOETF` 就重复定义、编译失败；`tonemapping_pars_fragment` 只在材质被色调映射时才进前缀，本材质 `toneMapped:false` 所以要自己带），直接调用 `NeutralToneMapping()` 与前缀里现成的 `sRGBTransferOETF()`；曝光用自己的 uniform `uExposure`（先乘再映射）。r186 的 `NeutralToneMapping()` 内部还会乘 chunk 声明的 `toneMappingExposure`（渲染器在材质刷新时写入），所以 `renderer.toneMappingExposure` 固定为 1.0，不拿它调曝光。`renderer.toneMapping` 保持 `NoToneMapping`（场景从不直接渲染到屏幕，所有 pass 都进 RT，three 的自动色调映射不会生效；设成 No 可以避免它与本 pass 重复）。

```ts
export interface FxParams {
  grain: number; scanline: number; chroma: number; vignette: number;
  bloom: { strength: number; radius: number; threshold: number };
  monoRed: number;                   // 0/1：暗房红灯
  vhs: number;                       // 0..1：回放跟踪条纹、抖动、色溢
  barrel: number;                    // 固定机位/CH1 0.08
  ir: number;                        // 0/1：红外色带
  tint: readonly [number, number, number]; tintAmt: number;   // 回放棕绿、卯时黎明粉、鬼市偏绿
  frame43: number;                   // 0/1：4:3 黑边
  flash: number;                     // 0..1 快门白闪（reduceFlash 时改为柔和淡入）
  fade: number;                      // 0..1 淡黑
  flicker: number;                   // 灯管频闪幅度（reduceFlash 时为 0）
  exposure: number;                  // CameraFxPass 的 uExposure（M1c look-dev 冻结基准 1.5 = LOOK.exposure，§15.3）
}
export class PostPipeline {
  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera);   // M1a 补写
  readonly composer: EffectComposer;
  readonly ir: IrRenderer;                                              // M1a 补写：params.ir > 0.5 时在 RenderPass 前后 begin/end；warmupArea 也用它
  setCamera(cam: THREE.Camera): void;
  setSize(w: number, h: number, pixelRatio: number): void;
  setBase(preset: PostPresetId, overrides?: Partial<FxParams>): void;   // 区域基础预设
  push(key: string, p: Partial<FxParams>, fadeSec?: number): void;     // 叠加层：vf / replay / ir / ch1 / darkroom_red / market …
  pop(key: string, fadeSec?: number): void;
  flash(ms?: number): void;                                             // 默认 80ms
  render(dt: number): void;                                             // composer.render(dt)，显式传 dt
  setQuality(q: QualityLevel): void;                                    // M1a 补写：low 关 Bloom（RenderPipeline.setQuality 调用）
  applySettings(s: Pick<Settings, 'grain' | 'reduceFlash'>): void;     // M1a 补写：Game 在 'settings' 事件后调用
  readonly sceneStats: { readonly calls: number; readonly triangles: number };   // M1c 冻结：最近一帧主场景（RenderPass 前后取差）的 draw call 与三角面，RenderPipeline.stats() 转交
}
```

- 叠加规则（M1c 按 WP3 的实现写明，engine-wp3.md #4）：`base` 之上按 push 顺序覆盖，重复 push 同 key 原位更新并淡回 1；标量按层的淡入权重插值（`ir` 在 CameraFxPass 与红外替换里按 ≥ 0.5 取二值）；`bloom`/`tint` 按分量插值；只有 key 为 `'vf'` 的层的 `chroma` 是乘法（×2.5）。
- `flash(ms = 80)`：前 30% 满白再线性退掉；白闪按**本帧开始时**的进度取值、画完再推进（M1c 修正：否则帧时 ≥ 80ms 时第一帧之前就已退完，低帧率下看不到快门白闪），所以 `flash()` 之后渲染的第一帧总是满白；过场 `{ fade:'white', dur }` 用 `post.flash(dur*1000)`。`reduceFlash`（M1d 按 GDD §10.4“关掉快门白闪、镁光灯”更正）：短闪（< `TIMING.shortFlashSec` 0.3s：快门、镁光灯）**直接不闪**，长的“淡入白”过场改为正弦式柔和淡入淡出（仍到全白，GDD P8“改为淡入白”）；`ui.fade.flash()` 的 DOM 白闪同样处理；`flicker` 恒为 0。
- `CameraFxPass` 着色器内顺序：桶形畸变 UV → 径向色差采样（线性）→ VHS（行抖动、跟踪带、色溢）→ **分支**：红外（线性灰度直接查 `IR_RAMP` 5 色插值 → 粗噪点 → 轮廓线，输出已是显示色）或常规（`uExposure` → 传感器饱和 → `NeutralToneMapping` → `sRGBTransferOETF`）→ 单红通道 → tint → 灯管频闪 → 暗角 → 扫描线 → 颗粒 → 4:3 黑边（按 `frameRect`）→ 白闪 → 淡黑。
- **M1c look-dev 写明（冻结）**：
  - 径向色差：偏移 = `dir × chroma × r²`（`dir = uv − 0.5`，r² 按屏幕对角线归一，中心 0、四角 1）。原为 `dir × chroma × 2`（线性、全屏都偏），取景器 ×2.5 后 1280 宽画面边缘分出近 10px 红绿蓝；现在 R1 常规画面四角约 2px、取景器 4:3 画框四角约 2–3px，中心干净。
  - 传感器饱和（监控摄像头的高光溢白）：曝光后 HDR 亮度在 0.7→3.0 之间按 smoothstep 把颜色往最大通道收拢（最多 85%），灯芯烧白、光晕外圈留灯色；受光的墙面地面到不了这个亮度。Neutral 本身保色相，没有这一步钠灯/霓虹的高光永远是纯色，`shots.mjs` 的“亮度 > 0.8”也永远达不到。常量 `CM_CLIP_LO/HI/AMT` 在 `fx/cameraFxShader.ts`。
  - 红外轮廓线：红外分支对线性灰度做 1.5px 的十字差分，温度/掠射突变处叠 28% 的淡白线（热像仪的 MSX 边缘增强）。
  - VHS 跟踪带收窄（0.045 → 0.03）、雪花与压暗减弱（0.35/0.18 → 0.22/0.14），不再盖住回放画面的主体。
- `settings.grain` 乘到 `grain` 与 `chroma` 上；`settings.reduceFlash` 见上。
- 着色器变体（红外开关、各 define）由 `fx/warmup.ts` 在进区域的淡入期间预热（§13.1）。

### 8.2 预设（`fx/presets.ts`）

```ts
export type PostPresetId = 'r1' | 'r1_yin' | 'r1_mao' | 'r2' | 'r3' | 'r4' | 'r4_market' | 'vf' | 'replay' | 'ir' | 'ch1' | 'darkroom_red' | 'dev';
export const POST_PRESETS: Readonly<Record<PostPresetId, Partial<FxParams>>>;
export const FX_DEFAULTS: Readonly<FxParams>;      // M1a 补写：所有预设都没定义的字段取这里（exposure 1.5、Bloom 阈值 0.8/半径 0.45 取 LOOK，M1c look-dev 冻结）
// vf 预设里的 chroma 表示倍率（×2.5，§8.1 叠加规则）
```

数值照 GDD §9.2：R1 颗粒 0.08/色差 0.003/暗角 0.45/Bloom 0.5（寅时颗粒 0.06；卯时 0.04 + 黎明粉 tint）；R2 0.10/0.004/0.60/0.3；R3 0.07/0.005/0.45/0.7；R4 0.12/0.006/0.55/0.8（鬼市偏绿 tint + 频闪）；`vf` 扫描线 0.25、色差 ×2.5、frame43；`replay` vhs 1、棕绿 `REPLAY` tint；`ch1` barrel 0.08；`darkroom_red` monoRed 1。M1c look-dev 冻结：以上 GDD 数值原样保留（色差的观感改在着色器映射里，见 §8.1），全局基准 exposure 1.5、Bloom 阈值 0.8、半径 0.45；`dev` 预设 = R1（沙盒就是 R1 的标准夜景）。

### 8.3 共享材质库（`fx/materials.ts`）

```ts
export const MATERIALS: {
  brick(): THREE.MeshStandardMaterial; plaster(): …; lime(): …; dado(): …; tileWhite(): …; tileGreenWhite(): …;
  concrete(): …; asphaltWet(): …; wood(): …; metal(): …; tin(): …; enamelYellow(): …; enamelRed(): …; porcelain(): …;
  paper(): …;                 // tempC 6
  cloth(color: THREE.ColorRepresentation): …;
  glass(): THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;   // transparent，userData.noOcclude = true
  emissive(color: THREE.ColorRepresentation, intensity?: number): THREE.MeshStandardMaterial;   // 灯罩、霓虹（tempC 60）；自发光 = 3.5 × intensity（M1c look-dev，原 2.2）
  ghost(color?: THREE.ColorRepresentation): THREE.ShaderMaterial;        // mat.ghost
  replay(): THREE.ShaderMaterial;                                        // mat.replay
  paperGlow(): THREE.ShaderMaterial;                                     // mat.paper_glow（纸像取景器发光，TUDI_GOLD）
  crtScreen(): THREE.ShaderMaterial;                                     // 见 fx/crtScreen.ts；共享实例，仅作未通电/装饰用 CRT 的静态外观（不接任何 feed）；通电的屏幕由 CrtScreenController.attach 换成私有实例（§6.11）
  hitProxy(): THREE.MeshBasicMaterial;                                   // visible:false：交互拾取代理（对象本身 visible 为真，射线能命中，但不绘制）
};
export function isSharedMaterial(m: THREE.Material): boolean;   // M1a 补写：Disposer 与区域卸载跳过共享实例
// MATERIALS 的类型另以 export interface MaterialLibrary 导出（成员同上）
```

- 工厂函数返回**缓存的共享实例**（同参数同实例），区域不得 `dispose()` 它们；需要改色时用 `cloth(color)` 这类带参工厂（按参数缓存），不要 `.clone()` 后修改共享实例。
- **人物魂影/回放细化（2026-10-06）**：内部 `GhostDetail` 增加 `rim?: number`、`albedo?: number`，缺省分别为 1、0，保持场景魂影/纸像原效果。人物取 `rim = 0.32`（魂影）/`0.22`（回放）、`albedo = 1`，衣料 `solid = 0.22`，脸与配件保留原实度。亮度采样必须包含 `uBase × uMap`，不能把灰度布纹当作白色衣服；减弱每段肢体独立发亮的塑料关节感。所有角色仍共享程序，变化只在 uniform；修改后检查五张 `shot.dev.lookdev_*`（含红外）及 NPC/群像实景。
- 所有程序化贴图（砖缝、瓷砖缝、锈斑、湿地面）由 `kit/canvas.ts` 生成，`colorSpace = SRGBColorSpace`（颜色贴图）或保持 `NoColorSpace`（粗糙度/遮罩）。
- 魂影、回放人影、纸像发光：`transparent:true`、`depthWrite:false`、`renderOrder` 分别 10/20/15，最后绘制（GDD §9.3）。自定义 ShaderMaterial 若需雾，必须合并 `UniformsLib.fog` 并包含 fog 相关 chunk。
- 金属类（`metal`、`tin`、搪瓷、主角的镜头环与铁皮帽）`metalness` 0.4–0.7、`roughness` 0.35–0.6：它们的观感依赖下面的环境贴图，没有环境贴图时金属在点光下几乎全黑。

**环境贴图（`fx/environment.ts`）**：场景默认没有 environment，`MeshStandardMaterial` 的金属面与主角头上的“反光玻璃圆片”都会发黑发平。引擎为每个区域提供一张环境贴图：

```ts
export function areaEnvironment(renderer: THREE.WebGLRenderer, tint: THREE.ColorRepresentation): THREE.Texture;
// = new THREE.PMREMGenerator(renderer).fromScene(nightEnvironmentScene(tint), 0.04).texture；按 tint 缓存，context restored 时重建
export function resetEnvironmentCache(): void;   // M1a 补写：context restored 后清缓存（WP1 调用）
export function nightEnvironmentScene(tint: THREE.Color): THREE.Scene;   // M1c look-dev 补写：PMREM 用的夜景环境场景
export const NIGHT_ENV;                                                   // M1c look-dev 冻结：天顶、地平线、光斑、云光的亮度
```

- **M1c look-dev 改写（冻结）**：原来用 `RoomEnvironment`（被 900cd 点光照亮的白房间 + 六块大面光）——当夜景环境时漫反射底光太亮（整个场景被抬成灰蓝），湿地面、瓷砖还映出摄影棚式的白方块。现在是程序化的“夜空”：天顶靛蓝近黑、地平线一圈带区域色的淡城市光、地平线以下暗湿地、一圈 5 颗区域色的远灯光斑 + 2 颗偏白的窗光、头顶一片暗冷色云光。漫反射几乎只来自光斑与云光，所以 `intensity` 可以开到 ~1 让金属/玻璃/湿地面有反光，而墙面不会被抬亮。
- 区域用 `AreaDef.environment`（或运行中 `ctx.environment()`）设置 `{ tint, intensity }`，引擎写 `scene.environment` 与 `scene.environmentIntensity`。**建议强度（M1c 冻结，`LOOK.envIntensity`）0.6–1.4**：R1 1.0（沙盒 look-dev）；楼道/屋内 0.6–0.8；霓虹街、鬼市 1.0–1.4。低于 0.5 镜头玻璃发黑，高于 1.5 玻璃变成一块铜镜。tint 取区域主光色：R1 `SODIUM`、R2 `HALL_LAMP`、R2_502 灶火前 `#9DB8C8`（月光）/之后 `STOVE`、R3 `#FF8A6A`（霓虹暖红）、R4 开市前 `#CFF5E1`/开市后 `LANTERN`。
- 主角头部（`rigs/cameraHead.ts`）每次绘制前把 `scene.environment` 显式挂到外壳、金属件、镜头玻璃、铁皮帽的材质上，强度 = 区域强度 × `HEAD_ENV_BOOST`（外壳 0.9、金属 3、玻璃 4、帽 2.5）：r186 只在材质自己有 `envMap` 时才用材质的 `envMapIntensity`（M1c look-dev）。
- 钠灯、霓虹下湿地面的倒影不用真反射：`kit/lamps.ts` 的 `wetStreak` 选项在灯下地面放一条加法混合的竖向光带贴花（`depthWrite:false`、`userData.irHide`）。M1c look-dev：光带是窄芯 + 到边归零的淡晕、被横向水纹打断，颜色 = 灯色 × 2.5（HDR）、不透明度 0.7；钠灯默认长 7m 宽 1.4m、其余 3.5m × 0.9m（修正了 alphaMap 读绿通道的 bug，原来是一整块实心矩形）。
- **贴图映射**（M1c 按 WP3 的实现写明，engine-wp3.md #7）：`brick/plaster/lime/tileWhite/tileGreenWhite/concrete/asphaltWet` 用**世界空间三向投影**采样贴图（`onBeforeCompile` + 共用 `customProgramCacheKey 'cm-triplanar'`），贴图密度只由“米/张”决定（砖 2m×1m、瓷砖 1.6m、湿地 4m…），与网格 UV 无关——`box()/building()` 与区域都不必生成米制 UV；代价是会动的网格用这些材质时纹理会“滑”，门、抽屉这类用 `wood/metal/tin`（按网格 UV）。`dado` 按网格 UV：v 0→1 从下到上，墙裙分界在 45% 高。
- **环境贴图的色调**（同上；M1c look-dev 按新环境改写）：`areaEnvironment(renderer, tint)` 只取 tint 的色相与饱和度（按最大分量归一；亮度由 `environment.intensity` 决定），远灯光斑乘 85% tint（略偏白）、地平线光乘满 tint，天顶与云光不随区域变。r186 在用 `scene.environment` 时把 `envMapIntensity` 统一设成 `scene.environmentIntensity`，材质自己的 `envMapIntensity` 不起作用（除非材质自己设了 `envMap`，见上条主角头部）。

### 8.4 CRT 屏幕材质（`fx/crtScreen.ts`）

```ts
export interface CrtUniforms {
  map: THREE.Texture | null; osd: THREE.CanvasTexture; noise: number; scan: number; barrel: number; noSignal: number;
  tunnel: THREE.Texture | null; tunnelMix: number; time: number;
  layout: 0 | 1;                                   // 0 single；1 split5（五路分屏，§6.11）
  ch2: THREE.Texture | null;                       // split5 时 CH2 格的实时 RT
  atlas: THREE.Texture | null;                     // split5 时其余格的 512×384 静态画布图集
  split: 0 | 1;                                    // 录像带双分屏时的中缝与右半 OSD（tapeScene 已把两半渲进同一张 RT，这里只画分隔线与标签）
}
export type CrtScreenMaterial = THREE.ShaderMaterial & { uniforms: { [K in keyof CrtUniforms]: { value: CrtUniforms[K] } } };   // M1a 补写：createCrtScreenMaterial 的返回类型别名
export function createCrtScreenMaterial(o?: { powered?: boolean }): CrtScreenMaterial;   // 每次调用新建一个实例（CrtScreenController 私有；MATERIALS.crtScreen() 是另一个共享的静态外观实例，用 powered:false 得到未通电的黑玻璃）
export const CRT_TEMP_C = 42;                      // M1c 冻结：通电 CRT 的红外温度（GDD P13“屏幕上只剩一团热”）
```

磷绿 emissive 基色（`OSD`），屏幕自发光不受灯光影响；它是场景里的普通材质，最终由 `CameraFxPass` 统一做色调映射。

**uniform 语义**（M1c 按 WP3 的实现写明，engine-wp3.md #2；WP5 的 cctv/vcr 已按同一约定）：
- `map`：当前频道画面（RT 或 CanvasTexture，后者设 SRGBColorSpace）；null = 只剩磷光底色。`osd`：透明底的 OSD 画布，叠在最上层。
- `noise` 0..1：轻噪点 + 偶发横纹（静态频道的“噪点动画”）；`noSignal` 0..1：雪花替换画面（切台/无信号）。
- `scan` 0..1（默认 0.35）：屏幕扫描线，按像素密度自动淡出防摩尔纹；`barrel`（默认 0.12）：屏幕弯曲，弯出去的部分是黑边框。
- `tunnel`/`tunnelMix`：`0 < tunnelMix < 1` 时只在画面中心按比例混入 tunnel（RT 模式下的 tunnelInner 画布）；`tunnelMix = 1` 时整屏换成 tunnel 并带缓慢推近动画（预制 8 层嵌套，`settings.tunnelMode='baked'`）。
- `layout = 1`（split5）：`atlas` 是整屏的 **3 列 × 2 行** 布局图（512×384），读序 CH1 CH2 CH3 / CH4 CH5 日期（画布上方为第一行）；着色器把 CH2 格（上排中间）换成 `ch2` RT 并画格线。
- `split = 1`：画中缝，并在右半左上角贴着色器自带的“CH2”标签（左半 OSD 由 osd 画布负责，避开右半）。`time`：动画时间（秒）。
- `layout` 是 GLSL ES 3.0 保留字，着色器里用内部 uniform `uLayout`，由材质的 `onBeforeRender` 每次绘制前从 `uniforms.layout` 同步；`uHas*`（贴图是否为 null）同理。调用方只写冻结的 `CrtUniforms`。

### 8.5 辅助 RT 池与预热（`fx/feeds.ts`、`fx/warmup.ts`，WP3）

```ts
// fx/feeds.ts
export interface FeedTarget {
  readonly read: THREE.Texture;                    // 屏幕/镜面材质采样这一张（乒乓时是上一帧）
  readonly write: THREE.WebGLRenderTarget;         // 本帧渲进这一张
  swap(): void;                                    // 乒乓：交换 read/write（非乒乓时空操作，read === write.texture）
  dispose(): void;                                 // 归还池
}
export function acquireFeed(key: string, w: number, h: number, o?: { pingpong?: boolean }): FeedTarget;   // CH1、CH2 必须 pingpong:true；镜面用单张 + 渲染期间隐藏镜面（§6.11）；tape 单张
// fx/warmup.ts
export function warmupArea(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cams: CameraRig,
  o: { ir: IrRenderer; post: PostPipeline; replayRoots: readonly THREE.Object3D[]; feeds: readonly AuxFeed[] }): Promise<void>;   // §13.1 的步骤 ③；不改任何玩法状态
export function warmScene(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, cameras: readonly THREE.Camera[]): void;   // M1d 补写：独立场景（录像带）用各台相机真画一遍进 1×1 线性 RT（显出隐藏的不含灯子树、关视锥剔除，画完还原）
```

`AreaManager.enter` 第 4 步调用 `warmupArea`（`replayRoots` 来自 `ReplaySystem.prebuild` 建好的隐藏人影，`feeds` 来自 `RenderPipeline` 当前注册的 feed）。

**做法与对 feed 的要求**（M1c 按 WP3 的实现写明，engine-wp3.md #8）：`warmupArea` 用一台打开全部图层的临时相机（fp 的克隆），临时关掉视锥剔除、显出所有**不含灯**的隐藏子树（回放人影、viewVariant 的其他变体、R2 其他楼层、不在场的 NPC），往 1×1 RT 常规渲一次、（M1d）把 `userData.fadeCapable` 人身下的非着色器材质临时设成 `transparent` 再渲一次（淡出变体）、红外替换渲一次；然后 `post.warm(rt)`（Bloom 进 RT；M1d：CameraFxPass 的两个分支画到**屏幕**——它平时就画到屏幕，程序按渲染目标区分，画进 RT 编出的是用不上的变体）并对每个 feed 调一次 `render(r)`——所以**每个 `AuxFeed.render` 都必须能在“本不到期”时被调用**。之所以真的渲染而不用 `compile()`：r186 的 `compile()` 按材质去重，同一红外材质既给普通网格又给置空 instanceColor 的实例网格时只编一个变体。`acquireFeed` 在 dev 下对 `ch1`/`ch2` 不带 `pingpong:true` 抛错，同 key 未 dispose 又 acquire 也抛错；WP3 内部另有 `renderIntoFeed(r, feed, scene, cam, { hide })`（渲染期间隐藏 hide 列表与所有 auxHide 对象、渲完 swap）。

---

## 9. `src/audio`：WebAudio 合成

```ts
export type SfxCue =
  | 'shutter' | 'rec_beep' | 'zoom_motor' | 'rewind' | 'ir_toggle' | 'dial_click' | 'dtmf' | 'paper_money' | 'god_voice'
  | 'magnesium' | 'exposure_tick' | 'feedback_howl' | 'burn' | 'lamp_click' | 'switch' | 'door' | 'drawer' | 'chain'
  | 'tile_pry' | 'water_pour' | 'bell_distant' | 'page_turn' | 'ui_open' | 'ui_close' | 'ui_tick' | 'error' | 'tape_insert' | 'vcr_motor'
  | 'crt_on';                                    // M1c 补写：CRT 开机（开场“CRT 开机，五路分屏”，过场写 { sfx: 'crt_on' }）
export type MusicCue = 'motif_dea' | 'songbie' | 'erhu_dea' | 'stop';
export type AmbPreset =
  | 'rain' | 'drips' | 'sodium_hum' | 'mains_hum' | 'crt_whine' | 'room_tone' | 'tv_murmur' | 'clock_tick' | 'stove_fire'
  | 'traffic' | 'neon_hiss' | 'paper_rustle' | 'darkroom_water' | 'tunnel_reverb' | 'tube_hum' | 'whispers' | 'fm_bells'
  | 'erhu_drone' | 'rooster';
export type AmbienceSpec =
  | { preset: AmbPreset; gain?: number; params?: Record<string, number>; at?: V3 }     // gain 为 dB
  | { custom: (kit: SynthKit, out: AudioNode) => AmbienceHandle; gain?: number };
export interface AmbienceHandle { set(param: string, v: number, rampSec?: number): void; stop(fadeSec?: number): void }
export class AudioEngine {
  readonly ctx: AudioContext | null;             // unlock 之前、或不可用时为 null，所有方法变空操作
  readonly running: boolean;                     // ctx.state === 'running'；未运行时不创建节点
  readonly bus: { master: GainNode; ambience: GainNode; sfx: GainNode; music: GainNode; voice: GainNode } | null;
  unlock(): Promise<void>;                       // 第一次 pointerdown 或 keydown 时调用：此时才 new AudioContext() 并 resume()（boot 时创建会触发自动播放警告）；之前请求的环境声在解锁后补上
  suspend(): void; resume(): void;               // 页面 hidden / visible
  sfx(cue: SfxCue, o?: { gain?: number; pan?: number; at?: V3; rate?: number }): void;
  setAmbience(specs: readonly AmbienceSpec[], fadeSec?: number): AmbienceHandle[];   // 区域进入时替换整组
  music(cue: MusicCue): void;
  murmur(who: SpeakerId | '', durSec: number): void;
  setListener(pos: THREE.Vector3, yaw: number): void;
  duck(db: number, sec: number): void;           // 对话时压低环境声
  constructor(o?: { muted?: boolean });          // M1a 补写：muted = ?test=1 || ?mute=1
  setVolume(v01: number): void;                  // M1a 补写：settings.volume
}
// M1a：本代码块的类型（SfxCue、MusicCue、AmbPreset、AmbienceSpec、AmbienceHandle、AudioEngine，另有 bus 的别名 AudioBuses）都从 audio/engine.ts 导出；
// SynthKit 从 audio/synth.ts 导出。sfx.ts / ambience.ts / music.ts / voice.ts 的导出是 WP3 内部实现
export interface SynthKit {
  ctx: AudioContext;
  noise(type: 'white' | 'pink' | 'brown', seconds?: number): AudioBufferSourceNode;   // 循环噪声缓冲（共享）
  osc(type: OscillatorType, freq: number): OscillatorNode;
  filter(type: BiquadFilterType, freq: number, q?: number): BiquadFilterNode;
  gain(v: number): GainNode;
  env(param: AudioParam, a: number, d: number, s: number, r: number, peak?: number, at?: number): void;
  lfo(target: AudioParam, rate: number, depth: number): OscillatorNode;
  impulse(seconds: number, decay: number): AudioBuffer;   // 程序生成脉冲响应（R4 长混响）
  fmBell(freq: number, ratio: number, dur: number, out: AudioNode): void;
  formantNoise(formants: number[], out: AudioNode): AudioNode;   // 低语、门神嗡声
}
```

合成方式逐条照 GDD §9.5 的表。`?test=1`/`?mute=1` 时不解锁音频。音乐主动机 D–E–A、《送别》旋律数据写在 `music.ts`（公有领域）。

**单位与参数（M1c 补写，WP3 的实现；engine-wp3.md #5）**：
- `sfx(cue, { gain })` 的 `gain` 按 **dB**（与 `AmbienceSpec.gain` 一致，默认 0）；`rate` 是音高/速度倍率。`duck(db, sec)` 取 |db| 往下压环境声总线，sec 秒后回原位，新的 duck 覆盖旧的。
- `AmbienceSpec.at` 与 `sfx({ at })` 用 PannerNode（equalpower、inverse、refDistance 1.5）定位，依赖 WP1 每帧 `audio.setListener(camera.position, yaw)`（§3.2 第 9 步）。
- 解锁前调用 `setAmbience` 会记下最后一组，解锁后补上（返回的句柄届时接到真实声音上，期间的 set/stop 会被重放）；sfx/music/murmur 在解锁前直接丢弃。
- `AmbienceHandle.set(param, v, rampSec)` 的参数名（`spec.params` 里同名参数就是初值；未知参数 dev 下 `devWarn` 并忽略）：

| 预设 | 参数 |
|---|---|
| 全部 | `gain`（线性，乘在 spec.gain 的 dB 上）、`level`（预设内部总增益） |
| `rain` | `intensity` 0..1（寅时“雨声 6 秒内淡出” = `set('intensity', 0, 6)` 或 `stop(6)`） |
| `sodium_hum` `mains_hum` `neon_hiss` `tube_hum` | `on` 0/1（R4 开市 `tube_hum.set('on', 0, 0.5)`；霓虹熄灭同理） |
| `crt_whine` | `on` 0/1（从 0 变 1 时放一次开机声）、`boot`（>0 放一次开机声）；`params: { on: 0 }` 起步即关机 |
| `tv_murmur` `traffic` `erhu_drone` | `level` |
| `tunnel_reverb` | `wet` 0..1（R4 的长混响是共享 send，sfx/人声/环境声都会进混响） |
| `whispers` | `density` 0..1 |
| `fm_bells` | `rate`（倍率） |

- 区域拿单条环境声的句柄：`ctx.ambience(specs, fade)` 返回与 specs 同序的句柄，`ctx.ambienceHandles()` 取当前那组（`AreaDef.ambience` 自动设置的也算），§11.2。

---

## 10. `src/kit`：程序化建造工具库

区域代理**只准调用**这些 helper 与 `MATERIALS`/`PALETTE`/`POST_PRESETS`/`rigs`，不自建同类共享资源（GDD §9.3）。确实缺的，在自己目录写私有 helper。所有 helper 返回的对象都应通过 `ctx.add()` 挂载，以便追踪释放。

### 10.1 文字与 Canvas（`kit/text.ts`、`kit/canvas.ts`）

```ts
export const FONT_STACK: string;                        // §1.2
export function detectCjk(): boolean;                   // measureText 比较“伙”与非字符 U+FFFF（'\uFFFF'，会画成豆腐块）的宽度与像素
export interface TextTexOpts {
  text: string | readonly string[];                    // 多行
  width?: 512 | 1024 | 2048; height?: number;          // 默认 1024 × 自动（2 的幂）
  font?: { family?: 'sans' | 'serif' | 'hand'; size: number; weight?: number | 'bold' };
  color?: string; bg?: string | null;                  // null = 透明
  align?: 'left' | 'center' | 'right'; vertical?: boolean;   // 竖排（对联、招牌）
  padding?: number; lineHeight?: number;
  stroke?: { color: string; width: number };
  glow?: { color: string; blur: number };              // 霓虹
  mirror?: boolean;                                    // 水平镜像绘制（镜中字预制）
  aged?: { fade: number; stains: number; seed: number };   // 褪色、水渍
  brokenChars?: readonly number[];                     // 霓虹坏字（“馆”不亮）：这些字画成暗管
}
export function makeTextTexture(o: TextTexOpts): THREE.CanvasTexture;   // colorSpace = SRGB；CJK 不可用时画图案并返回 userData.fallback = true
export function makeTextPlane(o: TextTexOpts & { w: number; h?: number; material?: 'basic' | 'standard' | 'emissive' }): THREE.Mesh;
export function paintTexture(w: number, h: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void,
                             o?: { srgb?: boolean; repeat?: [number, number]; anisotropy?: number; mask?: boolean }): THREE.CanvasTexture;
// M1c look-dev 补写：mask:true 把画好的 alpha 转成 RGB 灰度、alpha 置满（并按 NoColorSpace）——给 alphaMap 用。three 的 alphaMap 读**绿通道**，
// 用 rgba(255,255,255,a) 画的渐变上传后 RGB 恒为 255，当 alphaMap 就成了“a>0 即 1”的硬边实心形状（湿地光带、假阴影、脚印、旋涡光晕都中过）
export const PAINT: {                                   // 常用程序化贴图
  bricks(o?: { rows?: number; cols?: number; color?: string; mortar?: string; seed?: number }): THREE.CanvasTexture;
  tiles(o?: { size?: number; color?: string; grout?: string; newer?: [number, number][] }): THREE.CanvasTexture;
  dado(o?: { split?: number }): THREE.CanvasTexture;                  // 下绿上白墙裙
  rust(o?: { seed?: number }): THREE.CanvasTexture;
  wetGround(o?: { seed?: number }): THREE.CanvasTexture;
  posters(o: { lines: readonly string[]; seed?: number }): THREE.CanvasTexture;   // 小广告：“开锁”“通下水道”“回收旧家电”
  demolitionMark(): THREE.CanvasTexture;                             // 红圈“拆”
  noticeSheet(o: { title: string; body: string; aged?: number }): THREE.CanvasTexture;
  handwriting(o: { lines: readonly string[]; ink: 'ballpoint' | 'wet_ink' | 'pencil'; seed?: number }): THREE.CanvasTexture;
};
```

线索贴图宽度至少 1024；需要高清版本的，用 `ctx.hdText(mesh, lo, hi)` 登记（§11.2），不要一开始就生成 2048。

### 10.2 几何与结构

```ts
// kit/geom.ts
export function box(w: number, h: number, d: number, mat: THREE.Material, at?: V3, rotYDeg?: number): THREE.Mesh;   // at = 网格中心；rotYDeg = three 的 rotation.y（度，俯视逆时针为正，不是 yaw；与 ColliderBuilder.box 同一约定，§4.8）
export function plane(w: number, h: number, mat: THREE.Material, at?: V3, rot?: V3): THREE.Mesh;
export function cyl(rTop: number, rBot: number, h: number, mat: THREE.Material, at?: V3, seg?: number): THREE.Mesh;
export function merge(meshes: readonly THREE.Mesh[], mat?: THREE.Material): THREE.Mesh;   // 同材质静态网格合并（mergeGeometries）

// kit/building.ts
export interface BuildingSpec {
  x0: number; x1: number; z0: number; z1: number; floors: number; floorH?: number;   // 默认 2.8
  facade: 'brick' | 'plaster' | 'tile';
  windows?: WindowSpec; doors?: DoorSpec[]; balconies?: boolean; clothesLines?: number;
  roof?: 'flat' | 'parapet'; marks?: ('demolition' | 'posters')[]; seed?: number;
  faces?: ('n' | 's' | 'e' | 'w')[];                 // 只建看得见的立面
}
export function building(s: BuildingSpec): { group: THREE.Group; colliders: { center: V3; size: V3 }[]; windows: THREE.InstancedMesh };

// kit/windows.ts
export interface WindowSpec { w: number; h: number; spacing: number; litRatio?: number; litColor?: string; frame?: 'wood' | 'steel'; bars?: boolean }
export function windowGrid(face: { origin: V3; right: V3; up: V3; cols: number; rows: number }, s: WindowSpec, seed?: number): THREE.InstancedMesh;   // instanceColor 区分亮/暗

// kit/doors.ts
export interface DoorSpec { w: number; h: number; style: 'iron_gate' | 'security' | 'wood' | 'glass_shop' | 'unit' | 'darkroom'; at: V3; yaw: number; hinge?: 'left' | 'right' }
export interface DoorRig { group: THREE.Group; leaf: THREE.Object3D; handle: THREE.Object3D; setOpen(t01: number): void; collider: DynamicShape }
export function door(s: DoorSpec): DoorRig;   // collider 直接交给 ctx.collider.dynamic(key, door.collider, '!<开门 flag>')（§4.8）；handle 是门把手小盒子，玻璃门的交互 hit 只用它

// kit/stairs.ts
export function stairsVisual(o: { width: number; rise: number; run: number; steps: number; landing?: number; rail?: boolean }): THREE.Group;   // 纯布景

// kit/signs.ts
export interface SignSpec { text: string; style: 'neon' | 'painted' | 'lightbox' | 'plaque' | 'banner' | 'vertical'; w: number; h: number; color?: string; bg?: string; brokenChars?: number[] }
export interface SignRig { group: THREE.Group; setOn(on: boolean): void; flicker(amount: number): void }
export function sign(s: SignSpec): SignRig;

// kit/lamps.ts
export type LampKind = 'sodium_pole' | 'gate_lamp' | 'hall_bulb' | 'fluorescent' | 'lantern' | 'tungsten_pendant' | 'safelight' | 'crt_glow' | 'string_lights';
export interface LampOpts {
  kind: LampKind; at: V3; color?: THREE.ColorRepresentation;
  light?: { design: number; distance: number; castShadow?: boolean } | false; on?: boolean;
  wetStreak?: boolean | { length: number; width: number };   // 灯下湿地面的加法混合竖向光带贴花（§8.3）
}
export interface LampRig { group: THREE.Group; light: THREE.PointLight | THREE.SpotLight | null; setOn(on: boolean): void; setLevel(v01: number): void; setColor(c: THREE.ColorRepresentation): void }
export function lamp(o: LampOpts): LampRig;           // 灯罩 emissive + 可选真实光；关灯 = intensity 0（不移除、不隐藏光源）。真实光不挂在 group 下，而是交给 ctx.light() 挂到 root/lightsRoot，位置同步到灯罩
export function designLight(kind: 'point' | 'spot', color: THREE.ColorRepresentation, design: number, distance: number): THREE.PointLight | THREE.SpotLight;   // GDD“设计强度”→物理单位（§10.3：坎德拉 = design × 0.1 × distance²）
export function designCandela(kind: 'point' | 'spot', design: number, distance: number): number;   // M1c look-dev 补写：上式的换算本身（自测与估算用）

// kit/rain.ts
export interface RainRig { mesh: THREE.InstancedMesh; update(dt: number, cam?: THREE.Camera): void; setIntensity(v01: number, fadeSec?: number): void }   // M1c look-dev：cam 可省——区域拿不到相机；雨盒中心每次绘制前按正在渲染的相机重算（第三人称、取景器、固定机位、镜面/CH2 各自以自己为中心）
export function rain(o: { count: number; box: { w: number; h: number; d: number }; speed?: number; color?: THREE.ColorRepresentation }): RainRig;
// 实例化的面向相机细长四边形（宽约 1.5 像素当量、长 0.3–0.5m），一次 draw call；顶点着色器里下落与环绕相机、按视线方向做 billboard；
// count 由画质决定（low 1000 / mid 2000 / high 3000）；userData.irHide = userData.auxHide = true；renderOrder 5、depthWrite:false；不透明度 0.26（M1c look-dev，原 0.32）
// 区域用法：const r = rain({ count: QUALITY[ctx.quality].rain, box: { w: 36, h: 16, d: 36 } }); ctx.add(r.mesh); 在 AreaDef.update 里 r.update(dt)

// kit/props.ts（常用道具，一律低模）
export const PROPS: {
  bicycle(seed?: number): THREE.Group; clothesLine(len: number, seed?: number): THREE.Group; wires(a: V3, b: V3, sag: number, n?: number): THREE.LineSegments;
  crt(): { group: THREE.Group; screen: THREE.Mesh }; vcr(): { group: THREE.Group; slot: THREE.Object3D }; desk(o?: { drawer?: boolean }): THREE.Group; chair(): THREE.Group;
  thermos(): THREE.Group; mirrorRound(d: number): { group: THREE.Group; surface: THREE.Mesh }; switchBox(n: number): { group: THREE.Group; switches: THREE.Object3D[]; labelSlots: THREE.Object3D[] };
  noticeBoard(w: number, h: number): { group: THREE.Group; slots: THREE.Object3D[] }; bracket(): THREE.Group; brazier(): THREE.Group; stoneTable(): THREE.Group;
  mailbox(): THREE.Group; busStop(): THREE.Group; hoarding(w: number, h: number): THREE.Group; kiosk(): THREE.Group; stall(seed?: number): THREE.Group;
  lanternPaper(text?: string): THREE.Group; trashBin(): THREE.Group; tapeRack(labels: readonly string[]): THREE.Group; drawerLock(): THREE.Group;
  stool(): THREE.Group; easel(): THREE.Group; bigCamera(): THREE.Group; tlr(): THREE.Group; tray(shape: 'square' | 'basin_xi' | 'plate_chipped'): THREE.Group;
  sink(): THREE.Group; dryingLine(len: number, clips: number): THREE.Group; camphorChest(): THREE.Group; tinBox(): THREE.Group; stove(): THREE.Group;
};

// kit/nature.ts
export function huaiTree(o?: { trunkR?: number; canopyR?: number; seed?: number }): { group: THREE.Group; collider: { center: V3; size: V3 } };   // 二百年古槐：Lathe 树干 + 实例化叶片卡
export function plane_tree(o?: { seed?: number }): THREE.Group;   // 梧桐
export function shrub(o?: { seed?: number }): THREE.Group;
export interface SkyDomeOpts { zenith?: THREE.ColorRepresentation; horizon?: THREE.ColorRepresentation; glow?: THREE.ColorRepresentation; clouds?: number }
export function skyDome(o?: SkyDomeOpts): THREE.Mesh;   // M1c look-dev 补写：跟着相机走的夜空天穹（renderOrder -1000、不写深度、irHide、不挡射线）；默认天顶 #0B1020、地平线 #1C2233（比 R1 雾色略亮：雾里的楼成了比天暗的剪影）、贴地平线一道窄的城市光 #3A2A20、低云 0.5。室外区域 ctx.add(skyDome())；室内/楼道/地下通道不用

// kit/instancing.ts
export function scatter(geo: THREE.BufferGeometry, mat: THREE.Material, xf: readonly { pos: V3; rotY?: number; scale?: V3 | number }[], colors?: readonly THREE.ColorRepresentation[]): THREE.InstancedMesh;   // 内部调用 computeBoundingSphere()；rotY 同 rotYDeg 的约定（度，three 的 rotation.y，§4.8）

// kit/residue.ts
export function createResidueVortex(): THREE.Object3D;          // 残影点雪花旋涡（layer.yin，自带动画）
export function createColdTrace(shape: 'sitting' | 'standing' | 'crouching'): THREE.Object3D;   // 红外冷迹（layer.ir_only，tempC 3）
export function createFootprints(path: readonly XZ[], o?: { stride?: number; seed?: number; y?: number }): THREE.InstancedMesh;
// 阴物湿脚印贴花（layer.yin，只在取景器可见；透明贴花，irHide）：沿折线每隔 stride（默认 0.65m）左右交替放一只脚印。
// R1 用它画 GDD §4.1 的两串：rp.r1_gate → 三号楼单元门（王奶奶）；rp.r1_gate → 门卫室窗外 → 出院门往东口（陆师傅）

// kit/rng.ts
export function rng(seed: number): () => number;              // mulberry32
export function pick<T>(r: () => number, arr: readonly T[]): T;
export function seedFromString(s: string): number;                    // M1a 补写：FNV-1a；ctx.rng() 以区域 id 为种子
export function range(r: () => number, lo: number, hi: number): number;   // M1a 补写
// M1a：PAINT 的类型另以 export interface PaintKit 导出（kit/canvas.ts），PROPS 的类型以 export interface PropKit 导出（kit/props.ts）；
// rng/pick/seedFromString/range 已由 M1a 实现
```

**摆放约定（M1c 按 WP2 的实现写明，engine-wp2.md #8；各文件头与函数注释有细节）**：
- `lamp()`（M1c look-dev 冻结灯罩自发光：钠灯 8、门灯/声控灯/钨丝灯 6、灯管 5、灯笼 3.2、安全灯 3、彩灯串小灯泡 ×4 HDR；钠灯发光灯罩放大到 1.1×0.42×1.45——灯芯经传感器饱和后烧白，四周留灯色光晕）：`at` 对 `sodium_pole` 是灯杆脚（地面），其余是灯具本身；灯具正面朝 -z（墙上的门灯由区域转 `group.rotation.y` 让它背对墙）；真实光创建时已放在灯泡的世界位置（假定 group 挂在区域 root 下），灯泡可见时 `onBeforeRender` 把光同步过去；`wetStreak` 贴在世界 y=0 的地面上（室外用；R2 楼上楼层别开），每次绘制前转向当前相机；`tungsten_pendant` + `castShadow` 用 SpotLight（朝下），其余是 PointLight。
- `windowGrid()`（M1c look-dev：亮窗是 `litColor` × 3–4 的 HDR 色，雾里 20–30m 外仍透出暖白；`litRatio` 默认 0.08）：`origin` = 左下角那扇窗的中心；`right` = 站在楼外看立面时的右手方向（单位向量）；`up` = 行距向量（长度≈1 时按 2.8m 一层）；窗面法线 = right × up；列距 = `spacing`。
- `door()`：`at` = 门洞底边中点；正面（有把手的一面）朝 `yaw`；`collider` 是 `wall` 形状（§4.8）；铁院门两扇对开、铁链节点 `name 'chain'`（挂锁 = `handle`）；`building()` 建的门在 `group.userData.doors`（`DoorRig[]`）。
- `PROPS`：原点在底面中心、正面朝 -z；挂墙/悬挂类见各函数注释（`mirrorRound`/`switchBox`/`tapeRack` 原点在中心，`lanternPaper` 在挂点，`bracket` 在贴墙底板中心、`name 'mount'` 是摄像头云台底座的安装点）；单独能动的部件用 name 标出（`'drawer'` `'lid'` `'canvas'` `'wheel0'…` `'switch1'…` `'labelSlot1'…`）；`crt()` 屏幕 0.36×0.27、中心在 `group.userData.screenCenter`；`vcr()` 的“视频入1”插孔在 `group.userData.jack`。
- `sign()`：正面朝 +z（与 `makeTextPlane` 一致）。`stairsVisual()`：原点在第一级前沿中点，往 -z 爬。`createCrowd()` 见 §5.4。

### 10.3 光照单位（`data/render.ts` 的 `LIGHT_SCALE`）

three r155 起灯光是物理单位（r165 已删除 legacy 开关）：点光/聚光 `intensity` 是坎德拉，`decay` 默认 2，`distance` 是截断窗口；漫反射 BRDF = albedo/π。GDD 里写的“强度 2.2、距离 14”是**设计强度**，不能直接当坎德拉用（会非常暗）。

```ts
export const LIGHT_SCALE = { point: 0.1, spot: 0.1, hemi: Math.PI, ambient: Math.PI, dir: Math.PI };   // M1c look-dev 冻结（§15.3）
// 点光/聚光：坎德拉 = design × LIGHT_SCALE.point × distance²（kit/lamps.ts 导出 designCandela(kind, design, distance)）
// designLight('point', SODIUM, 2.2, 14) → new PointLight(SODIUM, 2.2 × 0.1 × 14² ≈ 43.1, 14, 2)
// 半球光/环境光/平行光：intensity = design × π（ctx.hemi(sky, ground, design)）
```

- **M1c look-dev 冻结的换算（原初值 point/spot 20、hemi/ambient/dir 1）**：GDD 的“强度 X、距离 Y”是旧版 three 线性衰减的心智——灯“照到 Y 米那么远”。物理衰减（decay 2）下同样的 design，照得远的灯需要多得多的坎德拉，所以按 `distance²` 归一：钠灯 2.2/14 ≈ 43cd（灯下地面、4m 外的墙都亮得起来），CRT 0.6/3 ≈ 0.5cd（小屋里一层磷绿，不会照爆），声控灯 1.6/6 ≈ 5.8cd，灯笼 0.9/5 ≈ 2.3cd。直观含义：设计强度 1 的灯，在 distance/2 处的照度约 0.35（中灰墙面在基准曝光下 sRGB ≈ 0.3）。原“×20 不看距离”下钠灯够亮时 CRT、灶火会把屋子照爆。
- 半球光/环境光/平行光 × π = 旧版 three 的“艺术家单位”：颜色 × 设计强度 ≈ 受光面反照率的比例（R2“环境光 0.12 保底”就是一成底光）。R1 的 `#1B2233/#0B1020 × 0.25` 几乎是黑的——R1 的暗部靠环境贴图（§8.3）、夜空（`skyDome`）与雾，这是 GDD 要的夜色。
- 区域的灯光与材质用法建议见 `AGENTS.md` 的 look-dev Lessons（钠灯、门灯、室内钨丝灯、CRT、灯笼的设计强度范围，何时用 emissive 代替真实光）。

区域代理一律写 GDD 的设计强度，通过 `designLight()`/`lamp()`/`ctx.hemi()` 创建灯，不直接 `new PointLight`。**灯数规则**（GDD §9.3）：每区实时灯总数 ≤ 8（含半球光/环境光），从进区域起固定不变；开关、时辰、剧情只改强度与颜色（关灯 = 强度 0）；强度为 0 的灯照样有着色开销，所以只按总数算预算，不设“同时开启”上限。

---

## 11. 区域模块契约

### 11.1 `defineArea`

```ts
export interface AreaDef {
  id: AreaKey;
  name: string;                                        // '老街·长明照相馆'
  spawns: Partial<Record<SpawnId, SpawnDef>>;          // 本区全部出生点（GDD §13.2）
  exits: readonly ExitDef[];
  post: PostPresetId | { preset: PostPresetId; overrides?: Partial<FxParams> } | ((s: StateView) => PostPresetId);
  ambience?: readonly AmbienceSpec[] | ((s: StateView) => readonly AmbienceSpec[]);
  // —— 纯数据（进入时自动登记；启动时汇总到全局表）——
  interactables?: readonly InteractableDef[];           // 不依赖场景对象的交互物（也可在 build 里用 ctx.interactable 登记）
  photoTargets?: readonly PhotoTargetDef[];
  photoDecoys?: readonly PhotoDecoyDef[];
  readTargets?: readonly ReadTargetDef[];
  replayPoints?: readonly ReplayPointDef[];
  segments?: readonly ReplaySegmentDef[];
  dialogues?: readonly DialogueDef[];                   // 来自 dialogue.ts
  cutscenes?: readonly CutsceneDef[];
  docs?: readonly DocDef[];                             // 来自 text.ts；启动时全局登记（阅读器随时可打开）
  journalPages?: readonly JournalPageDef[];             // 只有 R1 提供（新页①–⑨）
  puzzles?: readonly PuzzleDef[];                       // 启动时全局登记（提示系统跨区域使用）
  photoArt?: Partial<Record<KeyPhotoId, (g: CanvasRenderingContext2D, w: number, h: number) => void>>;
  emptyCaption?: (s: StateView, near: InteractId | null) => string | undefined;   // 本区空镜默认标题
  automation?: Readonly<Record<string, { aim?: V3 }>>; // 调试 API 的瞄准点覆盖（§12.3 瞄准点解析第一步）。M1d：删掉从未实现的 stand/floor——站位由测试脚本自己 goto
  shots?: readonly ShotDef[];                           // 截图机位（§12.5）
  groundY?: (x: number, z: number) => number;           // 默认 0
  environment?: { tint: THREE.ColorRepresentation; intensity: number } | ((s: StateView) => { tint: THREE.ColorRepresentation; intensity: number });   // §8.3
  // —— 生命周期 ——
  build(ctx: AreaContext): Awaitable;                   // 程序化几何、灯光、雾、碰撞、NPC、触发器、动态交互物
  onEnter?(ctx: AreaContext, info: { from: AreaKey | null; spawn: SpawnId }): void;
  onExit?(ctx: AreaContext): void;
  update?(ctx: AreaContext, dt: number): void;
  onFlag?(ctx: AreaContext, e: GameEvents['flag']): void;   // 本区加载期间的 flag 变化（开灯、开门……）
}
export function defineArea(def: AreaDef): AreaDef;       // 只做类型收窄与 dev 校验

/** 一个区域由几个独立代理/工作包分块编写时用：R1 = world + finale；dev = 各 WP 的测试布置。 */
export type AreaPart = Partial<Omit<AreaDef, 'id' | 'name' | 'spawns' | 'exits' | 'post' | 'build'>> & { build?(ctx: AreaContext): Awaitable };
export function mergeAreaParts(base: Pick<AreaDef, 'id' | 'name' | 'spawns' | 'exits' | 'post'> & Partial<AreaDef>, parts: readonly AreaPart[]): AreaDef;
// 数组字段按顺序拼接（id 重复在 dev 下抛错）；photoArt/automation 合并（键重复抛错）；build/onEnter/onExit/update/onFlag 按顺序依次调用；
// emptyCaption 依次询问，取第一个非 undefined；ambience/groundY/environment 只允许 base 或一个 part 提供
```

`src/areas/index.ts`（引擎所有，M1a 写好）：

```ts
import r1 from './r1'; import r2 from './r2'; import r2_502 from './r2_502'; import r3 from './r3'; import r4 from './r4'; import dev from './dev';
export const AREAS: readonly AreaDef[] = [r1, r2, r2_502, r3, r4, dev];
```

`src/areas/r1/index.ts`（M1a 写好并冻结）：

```ts
import { defineArea, mergeAreaParts } from '../../core/area';
import { SPAWN, EXIT } from '../../data/ids';
import { R1 } from './layout';
import world from './world';        // R1-world 的 AreaPart
import finale from './finale';      // R1-finale 的 AreaPart
export default defineArea(mergeAreaParts({
  id: 'r1', name: '槐安里',
  spawns: { [SPAWN.R1_START]: { pos: R1.spawns.start, yaw: 180 }, /* …GDD §13.2 全部 r1 出生点… */ },
  exits: [ /* exit.r1_to_r2/r3/r4，坐标取自 layout.ts，when 照 GDD §13.2 */ ],
  post: s => (s.flag(F.R1_SOUL_RETURNED) ? 'r1_mao' : s.flag(F.R4_GOT_TAPE) ? 'r1_yin' : 'r1'),
}, [world, finale]));   // （另需 import { F } …）
```

### 11.2 `AreaContext`

```ts
export interface AreaContext {
  readonly id: AreaKey;
  readonly game: GameApi;
  readonly state: StateView;
  readonly scene: THREE.Scene;
  readonly root: THREE.Group;                          // 本区内容挂在这里
  readonly quality: 'low' | 'mid' | 'high';
  readonly caps: GameCaps;
  readonly lightsRoot: THREE.Group;                    // 永不隐藏的灯节点（跟随 NPC/头部的灯挂这里，§4.7）
  // 场景
  add<T extends THREE.Object3D>(obj: T, o?: {
    layer?: LayerName | LayerName[];                   // 递归设置（跳过灯）
    ref?: string;                                      // 登记为可引用对象（拍照主体、aimAt、交互 hit、hideWorld、R1-world 与 R1-finale 共用的场景对象）
    tempC?: number;                                    // 写 userData.tempC（递归到网格）
    occlude?: boolean;                                 // 默认：不透明网格 true（透明网格默认不挡；M1d：准星、拍照、读字同一条规则 occludesView，§6.6）
    collide?: boolean;                                 // true：同时以包围盒登记碰撞体（仅简单物体）
    parent?: THREE.Object3D;
  }): T;                                               // obj 子树里若含灯，dev 下抛错：灯只能用 ctx.light() 加
  ref(id: string, obj: THREE.Object3D): void;
  getRef(id: string): THREE.Object3D | undefined;
  readonly collider: ColliderBuilder;                  // 含 dynamic()（§4.8）
  light<T extends THREE.Light>(l: T, parent?: THREE.Object3D): T;   // 计入预算（≤8 含半球/环境光，dev 超出即抛错）；自动 layers.enableAll()；parent 只能是 root 或 lightsRoot（缺省 root）；进区域后灯数冻结，再加即抛错
  hemi(sky: THREE.ColorRepresentation, ground: THREE.ColorRepresentation, design: number): THREE.HemisphereLight;
  fog(color: THREE.ColorRepresentation, density: number): void;       // FogExp2
  background(color: THREE.ColorRepresentation): void;
  environment(e: { tint: THREE.ColorRepresentation; intensity: number }): void;   // 运行中改环境贴图（寅时/卯时，§8.3）
  post(p: AreaDef['post']): void;                      // 运行中改基础预设（寅时/卯时）。M1d：函数形式的 post/environment/ambience 在 'flag' 与本区 'temp' 事件后都重算（可以读 s.temp(key)，如暗房红灯）
  ambience(specs: readonly AmbienceSpec[], fadeSec?: number): readonly AmbienceHandle[];   // M1c：返回与 specs 同序的句柄（原为 void），区域可对单条环境声 set/stop
  ambienceHandles(): readonly AmbienceHandle[];   // M1c 补写：当前生效那组（AreaDef.ambience 自动设置的，或最近一次 ambience() 设置的）的句柄，与其 specs 同序
  viewVariant(o: { naked?: THREE.Object3D; vf?: THREE.Object3D; ir?: THREE.Object3D }): void;   // 按视图/镜头切换可见性（变体下不得挂灯）
  hdText(mesh: THREE.Mesh, lo: () => THREE.Texture, hi: () => THREE.Texture, o?: { minZoom?: ZoomLevel; maxDist?: number }): void;   // 取景器开启、倍率 ≥ minZoom（默认 2）、距离 ≤ maxDist（默认 6m）时换高清；黄三爷面具用 { minZoom: 4, maxDist: 5 }
  // 区域临时状态（不存档，换区域清空；变化发 'temp' 事件；条件里用 temp(key)）
  setTemp(key: string, v: boolean | number): void;     // key 不带点，如 'lamp_lit_1'
  getTemp(key: string): boolean | number;
  // 玩法登记
  interactable(d: InteractableDef): InteractableHandle;
  addTalk(id: InteractId, entries: TalkEntry[], o?: { first?: boolean }): void;   // 给对象/NPC 追加对话项（R1-finale 用）；id 尚未登记时先排队，登记时合并（与另一方 build 的先后无关，§6.6）
  npc(d: NpcDef): NpcHandle;
  trigger(d: TriggerDef): TriggerHandle;
  photoTarget(d: PhotoTargetDef): void; photoDecoy(d: PhotoDecoyDef): void; readTarget(d: ReadTargetDef): void;
  replayPoint(d: ReplayPointDef): void;
  codeLock(d: CodeLockDef): void;                      // 自动给 owner 交互物接上 openCode
  naming(d: NamingDef): void;
  mirror(d: MirrorDef): void; vcr(c: VcrConfig): void; tripod(c: TripodConfig): void;
  console(c: Partial<ConsoleConfig>): void;            // 可分多次提供并合并（§6.11）
  levels(d: LevelsDef): LevelsHandle;                  // R2 楼层节点
  // 生命周期工具（卸载时自动清理）
  on<K extends keyof GameEvents>(type: K, fn: (e: GameEvents[K]) => void): void;
  after(sec: number, fn: () => void): void;
  every(sec: number, fn: () => void): void;
  track<T extends { dispose(): void }>(r: T): T;
  run(list: readonly Effect[]): Promise<RunOutcome>;   // 顶层 run（排队，§6.3）
  rng(salt?: number): () => number;                    // 以区域 id 为种子
}
export interface TriggerDef { key: string; box: { center: V3; size: V3 }; when?: Cond; once?: boolean; onEnter?: Handler; onExit?: Handler; onStay?: (g: GameApi, dt: number) => void }
export interface TriggerHandle { remove(): void; setEnabled(on: boolean): void }
export class TriggerSystem {                         // core/triggers.ts（WP1）
  add(d: TriggerDef): TriggerHandle;                 // ctx.trigger() 与 AreaDef.exits 自动生成的出入口触发体都走这里
  update(): void;                                    // 每个子步：玩家胶囊与各 AABB 求交，发 onEnter/onExit/onStay（when 为假的不触发）
  assertSpawnClearance(spawns: Readonly<Partial<Record<SpawnId, SpawnDef>>>): string[];   // 出生点到任一触发体边缘 ≥ 0.8m；返回违规列表（dev 下非空即抛错，core.mjs 逐区检查）
  clearArea(): void;
}
export interface LevelsDef { count: number; y: (n: number) => number; initial?: number; onChange: (n: number, prev: number) => void }   // onChange 负责显隐楼层节点、移动复用的声控灯（灯挂在 root/lightsRoot 下，只改位置与强度，不随楼层节点隐藏）
// M1c 写明（engine-wp1.md #7）：进区域放置玩家时总会调用一次 onChange(spawn.floor ?? current, current)，即使两者相等（保证楼层节点显隐与出生点一致），
// 此后 levels.set(n) 只在 n 变化时调用——所以 onChange 必须幂等（“按 n 设各层 visible”天然幂等）。楼层编号由区域自定（R2 用 1–5），引擎不按 count 钳制。
export interface LevelsHandle { readonly current: number; set(n: number): void }   // set 会先退出回放（walked_out），再淡出淡入 0.4s、传送到该层 (0,y,1.8)
```

**M1a 补写（冻结）**：`AreaContext`、`LevelsDef`、`LevelsHandle` 与 `AreaDef` 同在 `core/area.ts`；`TriggerDef`、`TriggerHandle` 在 `core/triggers.ts`。

```ts
// core/area.ts
export type AreaPost = AreaDef['post'];                           // 别名
export type AreaEnvironment = { tint: THREE.ColorRepresentation; intensity: number };
export interface AreaAddOptions { layer?: LayerName | LayerName[]; ref?: string; tempC?: number; occlude?: boolean; collide?: boolean; parent?: THREE.Object3D }   // = ctx.add 的第二个参数
export type AreaBase = Pick<AreaDef, 'id' | 'name' | 'spawns' | 'exits' | 'post'> & Partial<AreaDef>;   // mergeAreaParts 的 base；dev/base.ts 导出 DEV_BASE: AreaBase
export type EnterReason = 'new' | 'load' | 'exit' | 'debug' | 'quality' | 'restored';
// core/areaContext.ts：AreaContextImpl implements AreaContext，另有引擎侧（非区域）公开成员
export class AreaContextImpl implements AreaContext {
  constructor(game: Game, def: AreaDef, root: THREE.Group);
  readonly colliderRoot: THREE.Group;              // 不加入场景（§4.8）
  readonly timers: GameTimers;                     // §3.2 第 7 步 ctx.timers.update(dt)
  readonly levelsHandle: LevelsHandle | null;      // GameApi.setLevel、goto 的 floor、DebugState.floor 用它
  readonly lightCount: number;
  tempSnapshot(): Record<string, boolean | number>;   // DebugState.temp；StateView.temp(key) 经 getTemp 读
  refs(): ReadonlyMap<string, THREE.Object3D>;     // lint 与主体解析校验
  updateViews(): void;                             // §3.2 第 7 步每帧调用：切换 viewVariant 与 hdText（WP1 自己按 game.sys.viewfinder 的 on/lens/zoom 与距离做，§6.8.1）
  finalize(): void;                                // build 结束：冻结灯数；调用 game.sys.cctv.validate() 与 game.sys.interaction.pendingTalks()，dev 下任一非空即抛错（信息列出缺失字段/未登记的 id）；出生点距离断言（triggers.assertSpawnClearance）
  dispose(): void;                                 // §4.5 第 3 步：按那里的完整清单调用各系统 clearArea() 与 crt.detach()，再释放本区资源；M1d：先弹掉 notePostKey 记下的后期层、拔出视频线插头
  notePostKey(key: string): void;                  // M1d 补写：记下本区推入的后期叠加层 key（GameApi.post.push 与 restore:false 的过场 post 步骤调用），卸载时弹掉
}
// core/timers.ts
export class GameTimers { after(sec: number, fn: () => void): () => void; every(sec: number, fn: () => void): () => void; update(dt: number): void; clear(): void; readonly size: number }
// core/disposer.ts（WP1 内部可自由扩充）
export class Disposer { track<T extends { dispose(): void }>(r: T): T; trackObject(obj: THREE.Object3D): void; dispose(): void; readonly size: number }
```

- **玩法登记方法是各系统公开方法的薄包装**（WP1 的 `areaContext.ts` 只转交，不另写逻辑）：`interactable` → `InteractionSystem.register`；`addTalk` → `InteractionSystem.addTalk`；`npc` → `NpcSystem.add`；`trigger` → `TriggerSystem.add`；`photoTarget`/`photoDecoy` → `PhotoSystem.register`；`readTarget` → `ReadSystem.register`；`replayPoint` → `ReplaySystem.register`；`codeLock`/`naming` → `PanelSystem.registerCode`/`registerNaming`；`mirror` → `MirrorSystem.register`；`vcr`/`tripod`/`console` → `VcrSystem`/`TripodSystem`/`ConsoleSystem.configure`。
- **出入口与出生点**（GDD §4 开头、§13.2）：触发体 1.5m 见方；门洞类（R2 单元门、502 门两侧）放在门框平面**外侧**，门洞处不设碰撞；任何出生点到本区任一触发体边缘 ≥ 0.8m（`TriggerSystem` 在进区域时断言，`core.mjs` 对五个区域逐一检查）。

### 11.3 区域内如何登记各种东西（摘要）

| 东西 | 在哪登记 | 关键约定 |
|---|---|---|
| 交互物 | `AreaDef.interactables`（静态）或 `ctx.interactable()`（需要场景对象时） | id 必须是 `OBJ`/`holeId()`/NPC id；有 `when` 就必须有 `blocked`；角标不泄题（§6.6） |
| NPC | `ctx.npc()` | 站位函数只读 flags（与区域临时状态）；阴物 `yin:true`；身上的灯用 `NpcDef.lights` |
| 拍照目标 | `AreaDef.photoTargets` | 数据照抄 GDD §7.3 与 H 表；失败标题照抄各谜题“错误反馈”（可写成函数） |
| 诱饵 | `AreaDef.photoDecoys` | 底片 1/2/4 格、拍镜子等 |
| 读字目标 | `AreaDef.readTargets` | GDD §7.3 读字表；镜中字用 `via.mirror`；跟随 NPC 用函数 `at` |
| 残影点/片段 | `AreaDef.replayPoints` / `AreaDef.segments` | GDD §13.6；片段关键帧写在 `replay.ts`；`hideWorld` 引用的对象要 `ctx.ref` 登记 |
| 触发器 | `ctx.trigger()` | 出入口由 `exits` 自动生成，不要重复写 |
| 挡人的门 | `ctx.collider.dynamic(key, door.collider, 条件)` | 院门、照相馆玻璃门 |
| 临时状态 | `ctx.setTemp()` / 条件 `temp(key)` | R2 一楼灯此刻亮不亮 |
| 密码锁/称呼面板 | `ctx.codeLock()` / `ctx.naming()` | |
| 镜面/录像机/监控台/三脚架 | `ctx.mirror/vcr/console/tripod`（只 R1） | 配置对象见 §6.10–6.12 |
| 确认/二选一 | 强制对话（`forced: true`）的选项节点 | 支架确认、楼梯井；不做确认框 |
| 对话/过场/文档/新页/谜题 | `AreaDef` 静态字段，数据文件是 `dialogue.ts` 与 `text.ts` | 文本照抄 GDD §7、§8 |
| 环境声/后期/环境贴图 | `AreaDef.ambience` / `AreaDef.post` / `AreaDef.environment`，运行中用 `ctx.ambience/ctx.post/ctx.environment` | 只选预设、微调数值 |

### 11.4 示例（节选，R3 的骨架）

```ts
// src/areas/r3/index.ts
import { defineArea } from '../../core/area';
import { F, IT, NPC, OBJ, SPAWN, EXIT, holeId } from '../../data/ids';
import { E } from '../../game/effects';
import { TEXT } from './text';
import { DIALOGUES } from './dialogue';
import { PHOTO_TARGETS, PHOTO_DECOYS, READ_TARGETS } from './photo';
import { REPLAY_POINTS, SEGMENTS } from './replay';
import { PUZZLES } from './puzzles';
import { buildStreet } from './build/street';
import { buildShop } from './build/shop';

export default defineArea({
  id: 'r3',
  name: '老街·长明照相馆',
  spawns: { [SPAWN.R3_WEST]: { pos: [-20.2, 0, 5], yaw: 90 } },                                   // 离出口触发体边缘 1.05m ≥ 0.8
  exits: [{ id: EXIT.R3_TO_R1, box: { center: [-22, 1.25, 5], size: [1.5, 2.5, 1.5] }, to: SPAWN.R1_FROM_R3 }],   // 1.5m 见方（GDD §13.2）；街两侧的墙把人引到这里
  post: 'r3',
  environment: { tint: '#FF8A6A', intensity: 1.0 },                                              // §8.3：R3 用 #FF8A6A，强度 0.6–1.4（LOOK.envIntensity；< 0.5 镜头玻璃发黑）
  ambience: [{ preset: 'rain', gain: -14 }, { preset: 'traffic', gain: -26 }, { preset: 'neon_hiss', gain: -30, at: [0, 3.2, 0.2] }],
  photoTargets: PHOTO_TARGETS, photoDecoys: PHOTO_DECOYS, readTargets: READ_TARGETS,
  replayPoints: REPLAY_POINTS, segments: SEGMENTS, dialogues: DIALOGUES, docs: TEXT.docs, puzzles: PUZZLES,
  interactables: [
    { id: OBJ.R3_BELL, label: '门铃', at: [0.8, 1.4, 0], onInteract: [E.sfx('lamp_click'), E.feedback(TEXT.fb.bellNoAnswer)] },
    ...Array.from({ length: 100 }, (_, n) => ({
      id: holeId(n), label: '取件格', proximityFocus: false,                                       // 不带编号：编号要 ≥2× 读（§6.6 硬规则）
      at: [-2.9, 2.9 - (Math.floor(n / 10) + 0.5) * 0.25, -1.5 - ((n % 10) + 0.5) * 0.25] as const,
      when: F.R3_LU_DOOR_OPEN, blocked: TEXT.fb.doorLocked,                                         // 100 格同一条件，灰/白一致，不泄题
      onInteract: n === 73 ? [E.flag(F.R3_GOT_ENVELOPE), E.photo(PH.COVERED_FACE)] : [E.feedback(TEXT.holes[n] ?? '空的。')],
    })),
  ],
  build(ctx) {
    buildStreet(ctx);
    const shopDoor = buildShop(ctx);                                                                // 返回 kit/doors 的 DoorRig
    ctx.collider.dynamic('r3.shop_door', shopDoor.collider, `!${F.R3_LU_DOOR_OPEN}`, { seeThrough: true });   // 开门前挡人、不挡视线（§4.8）
    ctx.interactable({
      id: OBJ.R3_SHOP_DOOR, label: '玻璃门', at: () => shopDoor.handle.getWorldPosition(new THREE.Vector3()),
      hit: shopDoor.handle,                                                                         // 只取门把手；门玻璃是 noOcclude，不挡准星
      when: F.R3_LU_DOOR_OPEN, blocked: TEXT.fb.doorLocked, onInteract: [E.feedback(TEXT.fb.doorOpen)],
    });
    ctx.npc({
      id: NPC.LU, rig: /* createCharacter('lu', { look: 'ghost' }) */ null!, yin: true, tempC: 6,
      placement: s => (s.flag(F.R1_MISSION_GIVEN) && !s.flag(F.R3_SAW_TRUE_FORM) ? { pos: [0, 0, -4], yaw: 180 } : null),
      interact: {
        label: '陆师傅', view: 'viewfinder', revealOnVfInteract: true, priority: 2,                  // 高于门：隔着玻璃按 E 聚焦在他身上
        range: s => (s.flag(F.R3_LU_DOOR_OPEN) ? 3 : 6),
        talk: [ /* { when: …, dialogue: 'dlg.r3.lu_glass' }, … */ ],
        offers: { accept: { [IT.SLIP_0473]: [E.used(IT.SLIP_0473), E.flag(F.R3_LU_DOOR_OPEN), E.dialogue('dlg.r3.lu_slip')] }, fallback: TEXT.fb.luNotSlip },   // 先写 flag 再开对话
      },
    });
  },
});
```

（示例只示意结构；`null!` 处由区域代理填真实造型；import 里还需要 `PH` 与 `THREE`。）

### 11.5 区域必须遵守的规则

1. **进度只由 flags 推导**。进入区域时根据当前 flags 重建一切：灯亮灭、门开关、NPC 站位、时辰差异（GDD §4.6）。不要在区域里保存“我上次做到哪了”。
2. **守卫条件**：每个会写 flag 的处理都要检查前置，不满足时给专属反馈且不写 flag（GDD §3.12、§6.2 第 6 条）。需要补写前置 flag 的地方（如 `r4.huang_admits` 前补 `r4.asked_tape`）按 GDD 原文处理。
3. **物品不消耗**：用对了只 `E.used()`；用错原样退回并给专属反馈。
4. **onHit/onComplete/事件处理必须幂等**：重复拍、重复看、读档后再触发都不能出错。
5. **不写 localStorage、不碰 `window.__game`、不用 `setTimeout` 驱动玩法**。存档只由引擎写；区域需要的存档相关信号都走 Effect（寅时槽 `E.save('save.yin')`、结局播完 `E.ending(kind)`，§6.3）。
6. **所有中文文本放在 `text.ts`/`dialogue.ts`**，代码里只引用常量（便于整合时校对 GDD 原文）。
7. **灯光预算**：本区真实光总数 ≤ 8（含半球光/环境光），进区域后数量固定；关灯用 `setOn(false)`（强度置 0），不 `remove`、不 `visible=false`；灯只用 `ctx.light()` 挂在 `root`/`lightsRoot` 下，不挂在 NPC、楼层节点、`viewVariant` 变体等会被隐藏的节点下（§4.7）。录像带的 `tapeScene` 另计 ≤ 3。
8. **资源**：自建的 geometry/material/texture 通过 `ctx.add`/`ctx.track` 追踪；共享材质不释放。
9. **先写 flag，再开对话/过场**：一个 handler 里既要写进度又要开对话/过场时，把 `E.flag`/`E.item` 放在 `E.dialogue`/`E.cutscene` 之前（除非 GDD 明确规定“对话结束时设”，那就写在对话的 end 节点 effects 里）。被 `cancelAll` 打断时后续 effects 会被丢弃（§6.3）。
10. **角标不泄题**（GDD §10.2，§6.6 硬规则）；会泄题的对象不用 `when/blocked`，看破条件写在 `onInteract` 里给与同类对象相同的反馈。
11. **确认/二选一一律用强制对话**（`forced: true` 的选项节点，选项自带“再等等/（算了）”），不自己做确认框。
12. **挡人的门用动态碰撞体**，门洞类出入口触发体放在门框外侧；出生点离任一触发体 ≥ 0.8m。
13. **引擎不够用时**：不改引擎文件；能在自己目录里绕开就绕开，并写进 `docs/requests/<区域>.md`（§15.6）。由引擎维护者在 M2 期间串行处理，条目 resolved 后区域代理去掉 `blockedBy`（§15.4）。

### 11.6 区域之间的耦合

- 只能通过：**flags**（可以读任何区域的 flag；只能写本区前缀的 flag，`r2_502` 写 `r2.*`。GDD §13.3 的每个 flag 都由其前缀所在区域设置，没有例外）、**物品**（`E.item/E.used`、`s.has/used`）、**照片**（`s.hasPhoto`）。
- 跨区域出现的角色用 `rigs/characters.ts` 同一个工厂，保证样子一致；在别的区域出现时的站位、对话由**出现的那个区域**负责（例如陆师傅在门岗：R1 负责 `npc.lu` 在 R1 的站位与 `dlg.r1.lu_*` 对话）。
- 监控台 CH3–CH5 画面（显示 R2/R3/R4 的门口）由 R1 负责绘制，只读 flags（CH5：丑时起有灯笼光，寅时照旧，`r1.soul_returned` 后熄灭，GDD §3.9）。
- 巡夜本新页①–⑨由 R1 的 `text.ts` 提供（它们属于 `doc.log_new`），但浮现条件引用各区域 flag。
- 称呼表、物品表、照片标题、说话人名在 `src/data`（引擎所有）。

**R1 内部的分工**（R1-world 与 R1-finale，§2.11、§15.4）：

| 内容 | R1-world | R1-finale |
|---|---|---|
| 场景 | 全部建造：院子、楼立面、门卫室内外、桌/CRT/录像机/支架/镜子/抽屉的网格（`ctx.ref` 登记 `r1.desk` `r1.crt` `r1.vcr` `r1.crt_jack` `r1.bracket` `r1.mirror`）、灯、雨、湿脚印、冷迹 | 尾声道具（挖掘机剪影、平掉的院子，用过场 `run(g, ctx)` 加） |
| 谜题 | P1、P2；旧照一、二的残影点与片段（`rp.r1_tree`、`rp.r1_shed`） | P12、P13、P14；南柯（蚁穴 `r1.anthill`、`r1.ant_old_*`、`r1.nanke`、`pz.h_nanke`、南柯片尾） |
| 交互物 | `r1.log` `r1.switch_box` `r1.switch_1`–`4` `r1.mirror` `r1.drawer` `r1.crt`（监控台） `r1.tape_rack` `r1.cctv_notice` `r1.gate` `r1.gate_lamp` `r1.notice_board` `r1.estate_sign` `r1.shrine` `r1.brazier` `r1.cold_chair` `r1.cold_steps` | `r1.desk` `r1.vcr` `r1.crt_jack` `r1.bracket` `r1.anthill`（`r1.mark_photo` 是区域不是交互物） |
| NPC | `npc.tudi`（站位与 GDD §8.1 全部台词树，含寅时、补脸之后） | `npc.lu`（门岗）、`npc.zhou`；终章事件里土地的插话用 `E.say(…, NPC.TUDI)` 或 `ctx.addTalk(NPC.TUDI, …)` |
| 系统配置 | `ctx.mirror`；`ctx.console({ screen, viewPose, channels })`；开场过场 `cs.r1.intro`（五路分屏，id 固定：新游戏时引擎播它） | `ctx.vcr`、`ctx.tripod`；`ctx.console({ tunnelInner, tunnelBaked })`；`dlg.r1.bracket_confirm`；`cs.r1.dawn`（id 固定：OSD 从 04:58 走起、等快门叫醒的那段，读档异常时引擎直接播它，§6.4）；结局、尾声、南柯片尾过场（主结局片尾的最后一步写 `E.ending('main')`，南柯段落的最后一步写 `E.ending('nanke')`，§6.3；区域不碰存档，通关标记由引擎据此写） |
| 文本与数据 | 巡夜本新页①–⑨、R1 文档、P1/P2 提示 | P12–P14、H 的提示与反馈文本、结局文本 |

**M3 定稿的跨代理约定**（docs/requests/r1-world.md #2、#3、#5、#6，r1-finale.md #3、#5、#6）：
- **随身文档的登记**：`doc.idcard` 由 R1-world 登记；`doc.slip_0473` 由 R3 登记（正文带 P6 的肉眼注释“No.04……第三位泡成了一团水渍。”）。原则：物品在 R1 抽屉里拿到，但文档正文归“用它的谜题”所在的区域；同一文档只登记一次（`registerDocs` 在 dev/test 下对重复抛错）。墙上文档一律用 `E.doc`/`GameApi.openDoc` 打开阅读器（§6.3）。
- **灯**：R1 的 8 盏实时灯（GDD §4.1：7 盏 + 半球光）全部由 R1-world 建；R1-finale 不加灯（`tapeScene` 另计 ≤ 3），终章要改天色只改颜色、强度与可见性。
- **P13 的镜子诱饵** `decoy.r1.fin_mirror`（主体 ref `r1.mirror`，R1-world 登记）与“离桌子 > 2m 自动拔出视频线”（随 `r1.crt_jack`）归 R1-finale。
- **桌上的拾取代理**：`r1.log` priority 4（R1-world）；`r1.drawer` priority 3，代理是抽屉脸外凸一圈 + 桌子正中前沿、桌面上方竖的一块（抽屉打开后不在场，R1-world）；`r1.desk` priority 2、高 1.3m、在桌面后半、`present: r1.log_taken`（R1-finale）。门卫室净高 2.6m，第三人称相机在桌前被天花板压到约 2.4m、俯仰顶到 −35°，准星从桌沿上方约 1.6m 掠过：改其中任何一块时两边的 regions 脚本都要重跑（§11 步骤 6、8、47–54）。
- **门的开法**：门卫室门装在东墙内侧、合页在北、往屋里开到贴墙；院门正面（铁链）朝院里，解链后两扇往人行道推开，开着的门扇有动态碰撞体 `r1w_gate_leaf_w/e`（条件 `r1.gate_unchained`）。R1-world 改门时复看 `shot.r1.fin_ch1_mao` 与三脚架倒计时画面。
- **CH1 机位** = `layout.ts` 的 `derived.ch1Cam`（M3 按终章截图定稿：俯 24°、fov 66，老周站的门口连脚在画里）；终章 `CH1_POSE` 直接引用它。
- **CRT**：kit 的 `PROPS.crt()` 前面板 M3 起是开口的框（原来整块板在屏幕前 8mm，屏幕四周被埋）；R1-world 按 kit 的相对位置摆机壳，终章的 `unhideCrtScreen` 绕开已删除。
- **天色的接管**：R1-world 在 build 里以区域内部名登记 `R1_ENV_REFS`（`layout.ts`：`r1_hemi` 半球光、`r1_sky` 天穹网格、`r1_rain` 雨），终章用 `ctx.getRef()` 取，结局期间每帧改颜色/强度/可见性（区域 `update` 按 world → finale 的顺序调用，终章最后写），雾直接改 `ctx.scene.fog`；不再按对象名在对方的子树里查找。R1-world 在 `r1.soul_returned && !r1.called_at_dawn` 期间不跑自己的 12 秒天亮（雨照样停），天亮的节奏归 `cs.r1.dawn`；进区域时已是卯时（读档、截图预置）直接摆成黎明。环境贴图与环境声（卯时鸡鸣）仍随 flag 立即切换，过场需要时用 `ctx.ambience` 临时覆盖。
- **镜面**只在玩家在门卫室里（含门口一步）且视线大致朝北（yaw ±100°）时渲染（GDD §3.14 的放宽，省掉坐在椅子上看桌子时的一遍门卫室）；代价是终章固定机位朝南拍到镜子时镜面停在上一次的画面。

---

## 12. 调试与测试 API

### 12.1 挂载

`src/debug/api.ts` 在 `Game.boot()` 后挂载 `window.__game`，并令 `window.__cam = window.__game`。任何构建都挂基础 API（测试要对生产构建跑）；`?debug=1` 时额外挂 `setFlags/giveItem/givePhoto/setState/shot` 与性能面板。

```ts
declare global { interface Window { __game: DebugApi; __cam: DebugApi } }
export function mountDebugApi(game: Game): DebugApi;   // M1a 补写：main.ts 在 boot() 之后调用
```

### 12.2 通用约定

- 所有方法都是 `async`，返回**可 JSON 序列化**的 `ApiResult`（不返回 three 对象）。
- 调用在内部**串行排队**（前一个 settle 后才执行下一个），Playwright 并发调用也不会交错。
- **settle 而不是完成**：每个方法在 dispatch 之后 `await game.settle()`，即 runner 空闲、或当前阻塞点正在等玩家输入（对话行/选项、过场 `await`、面板已打开）时就返回（§6.3），不会因为对话还没结束而把后面排队的 `dlg()` 卡死。结果里带 `settle: 'idle' | 'waiting'`。
- **锁步**：harness 默认 `?test=1&lockstep=1`：两次调用之间游戏时间不走；需要时间的方法（淡入淡出、进区域、打字机、回放 seek 后渲染一帧）自己 `advance()`。`wait(sec)` 精确推进 sec 秒游戏时间。
- 每个方法在当前模式不合法时返回 `{ ok:false, reason }`，不抛异常；参数错误 `bad_args`。
- **超时一律按真实时间**（`performance.now()`），默认 60 秒，超过返回 `timeout`；`dlg()` 推进的游戏时间不设上限（结局段的 12 秒加速钟、《送别》、片尾、尾声、南柯加起来远超 30 秒游戏时间），可用 `dlg({ maxReal })` 覆盖真实时间上限。
- 对话、过场、三脚架期间调用 `goto`、`reload`、`setState` 返回 `busy`。
- **引擎异常与超时**（M1c 按 WP7 的实现写明，engine-wp7.md #3）：方法内部抛出非超时异常时返回 `{ ok:false, reason:'exception', result:{ error } }` 并 `console.error`（harness 因此判失败）——这是引擎缺陷而不是调用方的错，不在 `FailReason` 里；`Game.settle()` reject 的 `TimeoutError`（§4.4）映射为 `{ ok:false, reason:'timeout', result:{ method, error, state } }`，不打 console.error。
- **能改变进度状态的方法都走 §3.5 的同一代码路径**（构造 Action → `game.dispatch`，或调用 `interaction.activate` 等玩家也会触发的系统入口），并在 `?test=1` 下做“真人路径”检查（§3.5、§4.5、下表）。

### 12.3 方法表（GDD §3.15 的名字为正名，右列为别名）

| 方法 | 别名 | 行为（内部路径） | 成功时 `result` |
|---|---|---|---|
| `state()` | `getState()` | 读取快照 | `DebugState`（见下） |
| `newGame()` | | `menus.select('new')`：清档、进入 R1、播开场过场 | `{ area, mode }` |
| `continueGame(slot?)` | | `menus.select('continue'/'yin')` | |
| `reload()` | | 先 `save.flushIfSafe()`（在临时模式中或 `hold` 期间则返回 `busy`），再以 `save.auto` 走“继续”流程重新读档（验证存档可重建） | `{ area, spawn }` |
| `goto(area, x, z, floor?)` | `teleport` | `areas.goto()`（§4.5）：跨区域沿出入口图逐跳 `travel()`，每跳检查 `when`，挡住 → `blocked`（`result.exit`、`feedback`）；同区域在 `?test=1` 下做连通性检查，不连通 → `unreachable`；对话/过场/三脚架中 → `busy` | `{ area, pos, mode, hops? }` |
| `walk(x, z)` | | `player.walkTo(x, z)`：沿直线把移动输入喂给 `InputManager`，经正常的 `player.update` 与碰撞（含动态碰撞体）真走；1 秒无进展 → `{ ok:false, reason:'blocked', result:{ pos } }`。regions 测试用它走一遍关键门槛（院门、照相馆门、502 门） | `{ pos }` |
| `listInteractables()` | | `interaction.list()`（label 为现算的字符串，可断言“不泄题”） | `InteractableStatus[]` |
| `focused()` | | 当前聚焦 | `InteractId \| null` |
| `interact(id)` | | explore 下 `player.lookAtPoint(anchor,'tp')` + `faceTowards`，取景器中 `lookAtPoint(anchor,'fp')` → `?test=1` 下检查：① `collision.raycast(眼→锚点, far = 距离 − 0.15, { skipSeeThrough: true, ignoreKeys: [目标 id] })` 无遮挡（玻璃门这类 `seeThrough` 动态碰撞体与目标自身的碰撞体都不算遮挡，§4.8），② `interaction.focusCandidate() === id`；因视图规则不可聚焦 → `wrong_view`（附 `wrongView` 文本），其他不满足 → `not_focusable` → 通过后 `interaction.activate(id,{verb:'primary'},'api')` | `{ accepted, feedback?, opened?, settle }` |
| `show(target, thing)` | `showItem` | 与 `interact` 相同的转向与检查 → dispatch 出 `mode.album{pick}` 并选中 thing（与玩家在挑选器里选中是同一条路径）→ `interaction.activate(target,{verb:'show',thing})` | 同上 |
| `use(target, thing)` | `useItem` | 同上，`verb:'use'` | 同上 |
| `readDoc(docId)` | | 文档须属于身上的物品（否则 `not_owned`）→ dispatch `album` → 选中该物品 → `journal.openDoc(id, {vf})` → 取 `renderDoc(id, vf)` → dispatch `back` 合上（§6.16）；取景器中调用则含褪字，肉眼下褪字处是“▯” | `{ text, vf }` |
| `vf(on)` | `setViewfinder` | 参数 `true`/`false` 或 `'on'`/`'off'`；与当前状态不同才 dispatch `{t:'vf'}`（幂等）；在面板上 = 叠加/退回 | `{ on }` |
| `lens(l)` | `setLensMode` | 不同才 dispatch `{t:'lens'}` | `{ lens }` |
| `zoom(n)` | | 反复 dispatch `{t:'zoom',dir}` 直到倍率为 n（过场 `await:'zoom'` 时同样生效） | `{ zoom }` |
| `aimAt(id)` | | 解析瞄准点 → `player.lookAtPoint(p,'fp'/'tp')`（按当前模式的俯仰限制钳制）→ `cameras.sync()` → `read.evaluate()`、`interaction.update(0)`。面板叠加取景器时视角禁用：**不**改 yaw/pitch，只计算目标是否在画框内 | `{ point, reading, readHint, focused, inFrame, clamped }` |
| `shoot()` | `takePhoto` | dispatch `{t:'shutter'}`（取景器→拍照；三脚架→开始定时；过场→`await:'shutter'`） | `{ photo?, hit?, caption? }` |
| `replay(rp, seg?)` | | 瞄准 rp → dispatch `{t:'rewind'}`，直到当前段为 seg（最多按段数次） | `{ seg, index, count }` |
| `replaySeek(t)` | | `replay.seek(t)`，然后 `advance(0)` 渲染一帧（锁步下人影停在 t） | `{ t }` |
| `replayPause()` / `replayPlay()` | | 状态不同才 dispatch `{t:'play'}` | |
| `replayExit()` | | dispatch `{t:'present'}` | |
| `dlg(o?: { maxReal?: number })` | `advanceDialogue` | 循环：对话行 → dispatch `{t:'advance'}`；runner 忙且不在等输入（过场自己在播、`wait` 步骤、打字机）→ `game.advance(≤1s)`；停在选项节点、`await` 步骤，或回到非对话/过场模式且 runner 空闲。游戏时间不设上限，真实时间默认 60 秒 | `{ at: 'choice' \| 'await' \| 'end', options?, mode }` |
| `choose(k)` | `chooseDialogOption` | 对话中若停在台词行，先像 `dlg()` 一样推进到选项；然后 dispatch `{t:'choose',k}`；称呼面板同样适用（k 可为 `name.*`）；强制对话（支架确认、楼梯井）同样适用 | `{ chosen, feedback? }` |
| `input(code)` | `enterCode` | 要求栈顶 `panel_code`：逐字符 dispatch `{t:'digit'}`，再 `{t:'confirm'}` | `{ correct }` |
| `vcr(cmd, arg?)` | | `'play'`/`'pause'` → `{t:'play'}`（状态不同才发）；`'seek', 'HH:MM:SS'` → `vcr.seek`；`'index', 'next'\|'prev'` → `{t:'index'}`；`'shuttle', -1\|0\|1` → `{t:'shuttle', dir, down}`（按住/松开，覆盖降速区）；`'exit'` → `{t:'back'}` | `{ tc, playing, shuttle }` |
| `console(ch \| 'exit')` | | `{t:'digit', n:ch}` / `{t:'back'}` | `{ channel }` |
| `tripod('start' \| 'cancel')` | | `{t:'shutter'}` / `{t:'interact'}` | `{ state }` |
| `bodyGoto(x, z)` | | `tripod.bodyGoto` | |
| `back()` | | dispatch `{t:'back'}` | `{ mode }` |
| `hint()` | | dispatch `{t:'hint'}` | `{ puzzle, level, text, appended? }` |
| `wait(sec)` | | `game.advance(min(sec, 30))`（游戏时间）；栈顶冻结时 `mode_disallows` | `{ time }` |
| `setTimeScale(k)` | | `game.timeScale = k`（仅调试） | |
| `frame(n = 1)` | | 等待 n 个真实渲染帧 | |
| `shot(area, shotId)` ★ | | §12.5 | `{ ok }` |
| `lint()` | | 数据自检：带 `when` 的交互物是否都有 `blocked`、拍照主体与 `hideWorld` 的 ref 是否可解析、文本常量是否为空、同组角标与交互流程是否一致（灰/白、文字、`hasOffers`、是否弹动作菜单、`menuVerb`，§6.6）；返回问题列表（`check.mjs` 调用） | `{ issues: string[] }` |
| `perf()` | | `renderer.info` 聚合（autoReset 关闭、每帧开始手动 reset）+ 近 2 秒平均 FPS + `game.pipeline.stats()` 的 `lights`/`lightsOn`/`renderScale`/`callsMain`（§4.7.2；M1c：`callsMain` 取 RenderPass 的主场景 draw call，`tris` 取整帧与主场景两者中的大值）。M1d：连采 `frames` 帧——辅助 RT 的一个完整节流周期 lcm(mirrorEvery, feedEvery)，≤ 12——`calls`/`callsMain`/`tris` 报其中的**最大值**（单帧采样会随帧号奇偶漏掉镜面/CH2/录像带），`callsMean` 是整帧 draw call 的平均；`canvasMB` 是场景里材质正在引用的 CanvasTexture 总量（w×h×4，§13.3 预算，`shots.mjs`/`core.mjs` 断言） | `{ fps, calls, callsMain, tris, geometries, textures, programs, lights, lightsOn, renderScale, callsMean, frames, canvasMB }` |
| `setFlags(obj)` ★ | | `state.debugSet({flags})`，并 `npc.reevaluate()` | |
| `giveItem(id)` ★ / `givePhoto(id)` ★ | | `state.debugSet(...)` | |
| `setState(p)` ★ | | `{ flags?, items?, photos?, area?, spawn? }` 一次设置；若给 area 则重新进入该区域；对话/过场/三脚架中 → `busy` | |

★ 仅 `?debug=1`。`walkthrough.mjs` 不带 `?debug=1`，因而无法调用它们。

**`DebugApi` 的类型（M1a 补写，冻结；`debug/api.ts`）**：

```ts
export type DebugResult<T = unknown> = ApiResult<T> & { settle?: Settle };
export interface InteractOutcome { accepted: boolean; feedback?: string; opened?: ModeId; settle: Settle }
export interface AimOutcome { point: [number, number, number]; reading: { id: ReadId; text: string } | null; readHint: string | null; focused: InteractId | null; inFrame: boolean; clamped: boolean }
export interface PerfStats { fps: number; calls: number; callsMain: number; tris: number; geometries: number; textures: number; programs: number; lights: number; lightsOn: number; renderScale: number;
  callsMean: number; frames: number; canvasMB: number }   // M1d 补写：见 §12.3 perf() 行
export type HintOutcome = { puzzle: PuzzleId | null; level: 1 | 2 | 3; text: string; appended?: { puzzle: PuzzleId; text: string } };
export type GotoOutcome = { area: AreaKey; pos: [number, number, number]; mode: ModeId; hops?: ExitId[] };
export type DebugStatePatch = { flags?: Record<string, boolean | number>; items?: (ItemId | { id: ItemId; used: boolean })[]; photos?: PhotoId[]; area?: AreaKey; spawn?: SpawnId };
export interface DebugApi {
  state(): Promise<DebugResult<DebugState>>;                getState(): /* 同 state */;
  newGame(): Promise<DebugResult<{ area: AreaKey; mode: ModeId }>>;
  continueGame(slot?: 'save.auto' | 'save.yin'): Promise<DebugResult<{ area: AreaKey; mode: ModeId }>>;
  reload(): Promise<DebugResult<{ area: AreaKey; spawn: SpawnId }>>;
  goto(area: AreaKey, x: number, z: number, floor?: number): Promise<DebugResult<GotoOutcome>>;   teleport: /* 同 goto */;
  walk(x: number, z: number): Promise<DebugResult<{ pos: [number, number, number] }>>;
  listInteractables(): Promise<DebugResult<InteractableStatus[]>>;
  focused(): Promise<DebugResult<InteractId | null>>;
  interact(id: InteractId): Promise<DebugResult<InteractOutcome>>;
  show(target: InteractId, thing: ThingId): Promise<DebugResult<InteractOutcome>>;   showItem: /* 同 show */;
  use(target: InteractId, thing: ThingId): Promise<DebugResult<InteractOutcome>>;    useItem: /* 同 use */;
  readDoc(doc: DocId): Promise<DebugResult<{ text: string; vf: boolean }>>;
  vf(on: boolean | 'on' | 'off'): Promise<DebugResult<{ on: boolean }>>;   setViewfinder: /* 同 vf */;
  lens(l: LensMode): Promise<DebugResult<{ lens: LensMode }>>;             setLensMode: /* 同 lens */;
  zoom(n: ZoomLevel): Promise<DebugResult<{ zoom: ZoomLevel }>>;
  aimAt(id: string): Promise<DebugResult<AimOutcome>>;                    // pt.*/rd.*/rp.*/交互物/NPC/decoy.*
  shoot(): Promise<DebugResult<{ photo?: PhotoId; hit?: PhotoTargetId | null; caption?: string }>>;   takePhoto: /* 同 shoot */;
  replay(rp: ReplayPointId, seg?: SegmentId): Promise<DebugResult<{ seg: SegmentId; index: number; count: number }>>;
  replaySeek(t: number): Promise<DebugResult<{ t: number }>>;
  replayPause(): Promise<DebugResult>;  replayPlay(): Promise<DebugResult>;  replayExit(): Promise<DebugResult>;
  dlg(o?: { maxReal?: number }): Promise<DebugResult<{ at: 'choice' | 'await' | 'end'; options?: string[]; mode: ModeId }>>;   advanceDialogue: /* 同 dlg */;
  choose(k: number | NameId): Promise<DebugResult<{ chosen: string; feedback?: string }>>;   chooseDialogOption: /* 同 choose */;
  input(code: string): Promise<DebugResult<{ correct: boolean }>>;         enterCode: /* 同 input */;
  vcr(cmd: 'play' | 'pause' | 'seek' | 'index' | 'shuttle' | 'exit', arg?: string | number): Promise<DebugResult<{ tc: string; playing: boolean; shuttle: number }>>;
  console(ch: 1 | 2 | 3 | 4 | 5 | 'exit'): Promise<DebugResult<{ channel: number }>>;
  tripod(cmd: 'start' | 'cancel'): Promise<DebugResult<{ state: string }>>;
  bodyGoto(x: number, z: number): Promise<DebugResult>;
  back(): Promise<DebugResult<{ mode: ModeId }>>;
  hint(): Promise<DebugResult<HintOutcome>>;
  wait(sec: number): Promise<DebugResult<{ time: number }>>;
  setTimeScale(k: number): Promise<DebugResult>;
  frame(n?: number): Promise<DebugResult>;
  lint(): Promise<DebugResult<{ issues: string[] }>>;
  perf(): Promise<DebugResult<PerfStats>>;
  // ★ 仅 ?debug=1（其他构建里这些键不存在，所以是可选成员）
  shot?(area: AreaKey, shotId: string): Promise<DebugResult<{ keys: { id: string; x: number; y: number }[] }>>;
  setFlags?(flags: Record<string, boolean | number>): Promise<DebugResult>;
  giveItem?(id: ItemId): Promise<DebugResult>;  givePhoto?(id: PhotoId): Promise<DebugResult>;
  setState?(p: DebugStatePatch): Promise<DebugResult>;
  selftest?(name: string): Promise<DebugResult<SelftestResult>>;          // §2.10 页面内自测
  selftests?(): Promise<DebugResult<string[]>>;                          // 已登记的自测名
}
// debug/selftest.ts（M1a 已实现登记表，dev/wpN.ts 在模块加载时调用）
export interface SelftestResult { ok: boolean; notes?: string[] }
export type SelftestFn = (game: Game) => Awaitable<SelftestResult>;
export function registerSelftest(name: string, fn: SelftestFn): void;   // name 建议 'wpN.<snake>'；重名抛错
export function listSelftests(): string[];
export function runSelftest(game: Game, name: string): Promise<ApiResult<SelftestResult>>;   // 不存在 → no_such_target；fn 抛错 → { ok:true, result:{ ok:false, notes } }
```

**瞄准点解析顺序**（`aimAt`/`interact`/`replay`）：`AreaDef.automation[id].aim` → `pt.*`（`photo.target(id)`）：全部主体锚点的质心（回放人影取当前时刻）→ `rd.*`：`at`（`read.aimPoint(id)`：函数则现算；`via.mirror` 时取虚像点）→ `rp.*`（`replay.point(id)`）：`at + (0, 0.8, 0)` → 交互物/NPC：`at`/锚点 → `decoy.*`（`photo.decoy(key)`）同 pt → M1c 补写（WP7 的实现）：都解析不到时取本区 `ctx.getRef(id)` 的世界包围盒中心（§12.5 的 `ShotDef.keys` 可以写 ref）。

**WP7 自定、M1c 写明的补充行为**（engine-wp7.md #3）：
- `shot(area, '*')`：不摆机位，只列出本区全部 `ShotDef`：`result = { keys: [], shots: [{ id, label, ui, keys, brightness }] }`（`ShotListing`，`debug/shots.ts`）；`scripts/shots.mjs` 用它枚举机位。
- `reload()` 在 dev 沙盒里返回 `mode_disallows`（沙盒不存档，读回的会是别处的旧存档）；`continueGame(slot)` 在该槽没有可用存档时返回 `no_such_target`；`readDoc(id)` 对既不属于任何物品、也没有区域登记的文档返回 `no_such_target`（先于 `not_owned`），合上时一路 `back` 回到调用前的栈深（从相册点开的文档压在 album 之上，要 back 两次，engine-wp4.md #13）。
- `show/use`：与 `interact` 相同的转向与真人路径检查 → 验证 `mode.album{pick}` 在当前模式能压栈（压入即弹出）→ `interaction.activate(target, {verb, thing}, 'api')`（与挑选器确认同一入口）；挑选器本身的方向键/Enter 由 `input.mjs` 用真实按键覆盖。
- ★ `setFlags/giveItem/givePhoto/setState` 写入后调用 `save.request('manual')`（`debugSet` 不经 `setFlag`，不标脏的话预置之后的 `reload()` 会读回预置前的存档）；时辰推导值变了就 `shichen.resetClock()`；不给 area 时 `npc.reevaluate()`，给 area 时重进区域。

```ts
export interface DebugState {
  area: AreaKey; floor: number | null; pos: [number, number, number]; yaw: number; pitch: number;
  mode: ModeId; stack: ModeId[]; shichen: Shichen; clock: string;
  flags: Record<string, boolean | number>;
  items: { id: ItemId; used: boolean }[]; photos: PhotoId[]; names: NameId[]; clues: string[]; ants: number;
  vf: boolean; lens: LensMode; zoom: ZoomLevel;
  focused: InteractId | null; reading: { id: ReadId; text: string } | null; readHint: string | null;
  replay: { point: ReplayPointId; seg: SegmentId; t: number; playing: boolean; index: number; count: number } | null;
  vcr: { loaded: boolean; tc: string; playing: boolean; shuttle: number } | null;
  console: { channel: number; jack: boolean; layout: 'single' | 'split5' } | null;
  dialogue: { id: DialogueId; who: string; text: string; options: string[] } | null;
  cutscene: { id: CutsceneId; awaiting: string | null } | null;
  panel: { kind: 'code'; owner: InteractId; entered: string } | { kind: 'naming'; options: NameId[] } | null;
  album: { kind: 'browse' | 'menu' | 'pick'; target?: InteractId; verb?: 'show' | 'use' } | null;
  tripod: { state: string; remaining: number } | null;
  doc: { id: DocId; vf: boolean; text: string } | null;   // M3 补写：栈上打开着的文档（mode.journal 带 { doc, vf }）与 renderDoc(id, vf) 的正文；巡夜本或没打开时 null
  subtitle: string | null; lastFeedback: string | null;
  temp: Record<string, boolean | number>;       // 当前区域临时状态
  saves: { auto: boolean; yin: boolean; completed: boolean; hold: boolean };
  ending: 'none' | 'main' | 'nanke';
  settle: 'idle' | 'waiting' | 'busy';
  loading: boolean;
}
```

`ending` 是运行期状态（不存档），只由 `GameApi.endingDone(kind)`（Effect `E.ending(kind)`，§6.3）写入：R1-finale 在主结局片尾最后一步写 `E.ending('main')`，在南柯段落最后一步写 `E.ending('nanke')`（§11.6、§15.4）。`walkthrough.mjs` 照 GDD §11 步骤 58：步骤 57 `shoot()` 之后调用 `dlg()` 跑结局过场与片尾；南柯路线停在南柯段落的变焦等待（`await:'zoom'`），`zoom(6)` 之后再 `dlg()` 跑完；然后断言 `ending`（`--main` 路线没有南柯段落，`dlg()` 后直接断言 `'main'`）。

### 12.4 测试脚本

所有脚本假定已 `npm run build`，由 `scripts/lib/harness.mjs` 用 vite 的 `preview()` 起静态服务（同现有 `smoke.mjs`），再启动无头 Chromium：

```js
// scripts/lib/harness.mjs
export const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
export async function launch({ query = 'new=1&test=1&lockstep=1&quality=low', viewport = { width: 800, height: 450 }, port = 4179 } = {}) {
  // preview → chromium.launch({ args: CHROMIUM_ARGS }) → page.goto(`http://127.0.0.1:${port}/?${query}`)
  // 等待 window.__game 存在且 state().loading === false
  // 收集 pageerror、console.error，以及匹配 /GL_INVALID|WebGL:|feedback loop|deprecated|has been removed/i 的 console.warning（GL 反馈环等只报 warning）；结束时若有则判失败
  return { page, call, expect, state, screenshot, close };
}
// call(method, ...args)：page.evaluate(([m, a]) => window.__game[m](...a), [method, args])；ok=false 时抛出 `${method}(${args}) → ${reason}`
// call.try(method, ...args)：不抛出，返回 ApiResult（用于验证错误反馈）
// expect.flags(...ids)、expect.eq(path, value)、expect.feedback(substr)、expect.has(itemOrPhotoId)、expect.name(nameId)
// 每次 call 另有 Node 侧的真实时间超时（默认 90 秒，比页面内 60 秒略长），超时即截图、打印 state() 并失败
// M4：CAMERA_SLOW=k（高负载机器）给带 test=1 的页面加 ?slow=k，页面内与 Node 侧的真实时间超时都乘 k（§15.7.1）
```

| 脚本 | 内容 | 通过标准 |
|---|---|---|
| `smoke.mjs` | 启动 → 新游戏 → 过场结束 → explore；报告 WebGL 版本 | 无 pageerror/console.error/GL 警告；`state().mode === 'mode.explore'` |
| `core.mjs` | 引擎验收：`?debug=1&area=dev` 沙盒中逐个调用 §12.3 全部方法，含成功与失败分支；并运行 `scripts/selftest/*.mjs` | 全部断言通过（§15.3 的清单） |
| `input.mjs` | **真实输入**：`?test=1&nolock=1`（不锁指针、按住左键拖拽转视角），用 Playwright 的 `keyboard`/`mouse` 而不是 API（`__game` 只用来读 `state()` 断言）。默认在 dev 沙盒的等价夹具上跑；`--game` 在真实游戏里跑：P1 步骤 1–4（WASD 走到电闸、E、右键取景器、拖拽瞄准、E 扳开关）；对抽屉用滚轮拨转轮加 Enter 输入密码；在录像机面板用 `]` 跳索引、按住 Z/C 快进快退，走到 03:14 并验证进入 03:13:30 后自动降速；Tab/J 打开关闭相册与巡夜本；动作菜单 1/2 与挑选器方向键/Enter；按 Space/Enter 时焦点不在任何 DOM 按钮上 | 全部断言通过（沙盒模式 M1c 起、`--game` 模式 M3 起） |
| `walkthrough.mjs` | GDD §11 的 58 步，逐步断言 | 结局 `ending === 'nanke'`；`--main` 跳过〔可选〕步骤，结局 `ending === 'main'`；另有变体 `--shuttle` 在步骤 48 用 `vcr('shuttle', 1)` 走进降速区代替 seek；`--reload` 在步骤 12、26、37、45、52 之后 reload 复验；`--hints` 每步前 `hint()`；M3 补写 `--yin`：通关后标题没有“继续”、有“从寅时重来”，`continueGame('save.yin')` 再把步骤 47–58 通关一次，标题仍没有“继续”（与 `--hints` 同用时另断言 P14 且 1 ≤ n < 6 时出现南柯追加提示） |
| `roundtrip.mjs`（M3） | 寅时预置下 r1 ↔ r2/r2_502/r3/r4 各先往返 2 次预热、在 R1 记基线，再往返 5 次（走真实出入口） | `geometries`/`textures` 回到基线 ±`BUDGET.resourceDrift`（§13.3）；回到 R1 时灯数恒定；无页面错误 |
| `regions/<id>.mjs` | `?debug=1` 下用 `setState(PRESETS.x)` 预置前置，跑该区域在 §11 中的全部步骤 + 各谜题主要错误反馈 + 关键门槛的 `walk()` | 全部断言通过（§15.4） |
| `shots.mjs [--area r3] [--quality high]` | 对每个 `AreaDef.shots` 截图到 `test-artifacts/shots/<shotId>.png`，并记录 `perf()` 到 `test-artifacts/shots/perf.json` | 无报错；每张图（UI 隐藏时）**平均亮度在 [0.05, 0.35]**、有一块成片的亮核（M4 第 2 轮：3×3 盒式模糊后亮度的第 99.5 百分位 ≥ `highlight` − 0.08，缺省 0.72；原来是“亮度 > 0.8 的像素 ≥ 0.5%”，被雨丝、颗粒、雪花这些单像素噪点左右）；`ShotDef.keys` 列出的关键交互物锚点投影处 5×5 像素平均亮度 > 0.04（看得清） |
| `check.mjs` | 静态检查（§14.2） | 无违规 |

`walkthrough.mjs` 的步骤写成数据（便于对照 GDD）：

```js
const STEPS = [
  { n: 1, run: async g => { await g.call('dlg'); await g.call('interact', 'r1.log'); await g.call('back'); },   // M3：拾取后巡夜本自动翻开，back() 合上
    expect: g => { g.expect.flags('r1.log_taken'); g.expect.name('name.huoji'); } },
  { n: 2, run: async g => { await g.call('goto', 'r1', -7, 19.3); await g.call('interact', 'r1.switch_box');
      await g.call('vf', true); const r = await g.call('aimAt', 'rd.switch_labels'); g.assert(r.reading?.id === 'rd.switch_labels');
      await g.call('interact', 'r1.switch_3'); await g.call('vf', false); },
    expect: g => g.expect.flags('r1.gate_lamp_on') },
  // …
  { n: 44, run: async g => { await g.call('goto', 'r4', 3, 0.6); await g.call('lens', 'ir'); await g.call('aimAt', 'pt.huang_ir'); await g.call('shoot');
      await g.call('show', 'npc.huang', 'ph.huang_ir'); await g.call('dlg'); await g.call('choose', 1); await g.call('dlg');
      await g.call('lens', 'normal'); },                                   // 必做：离开取景器不复位镜头（§6.8.1）
    expect: g => { g.expect.flags('r4.got_tape'); g.expect.has('it.tape_830'); g.expect.eq('shichen', 'yin'); g.expect.eq('saves.yin', true); g.expect.eq('lens', 'normal'); } },
  // … 逐条对应 GDD §11，optional: true 标出〔可选〕步骤 …
];
```

CLI：`--main`、`--until=<n>`、`--shots`（每步后截图到 `test-artifacts/walk/NN.png`）、`--quality=low|mid|high`、`--shuttle`。失败时自动截图并打印 `state()`。

验证错误反馈的步骤用 `call.try`，并断言 `result.feedback`/`state().lastFeedback`/空镜标题含 GDD 原文，且相关 flag 未变：步骤 3 的常光交互土地庙、步骤 6 的 `input('0000')`、步骤 17 的空灯座、步骤 21 在 `seg.door_2018` 第 4 秒拍（“门上还是光的。”，验证 `hideWorld`）、步骤 25 的右下瓷砖、步骤 37 的错选称呼、步骤 39 看破前交互黄三爷（“纸人没有回答。”）、步骤 43 与 52 的误导照片（含 `ph.old_2` 的“雪花”反馈）。步骤 49 的 `vcr('seek','03:16:00')` 验证“正好落在索引点上也算”。步骤 44 末尾的 `lens('normal')` 是必做步骤（`--main` 也执行）。

`scripts/core.mjs` 还必须覆盖（除 §15.3 的清单外）以下回归例：
- **可重入**：`shoot()` 命中后 onHit 开对话，`shoot` 在第一句出现时返回 `settle:'waiting'`，随后 `dlg()` 能推进；过场里 `{effects}` 步发物品与 flag；对话 → 过场 → 对话三层嵌套；`resetTo` 打断对话后同一 handler 的后续 effect 未执行。
- **镜中读字**：站在圆镜正前方 0.9m 能读到；横向偏 0.6m 时读不到并得到 `notInMirror`；倍率 2× 时得到 `tooSmall`。
- **红外**：带 `instanceColor` 的实例网格在红外下像素颜色与读数都与 `tempC` 一致；透明文字贴花在红外下不是矩形。
- **灯数恒定**：开关取景器、切红外前后 `perf().programs` 不变；区域内开关灯前后 `lights` 不变。
- **动态碰撞体**：条件为真时 `walk()` 被挡，flag 写入后能走过；`goto` 进被挡住的房间返回 `unreachable`；跨区域 `goto` 在出口条件不满足时返回 `blocked`。玻璃门（`seeThrough` 动态碰撞体）关着时，对门后高优先级 NPC 的 `interact`/`show` 成功（不返回 `not_focusable`），`walk()` 穿门仍被挡；对院门这类自身带动态碰撞体的交互物 `interact` 不被自己的碰撞体挡住。
- **出生点**：五个区域每个出生点离任一触发体 ≥ 0.8m。
- **回放**：3D 距离（上层不能启动下层残影点）；让位的 NPC 不挡镜头；`hideWorld` 的对象在窗口内不渲染；`levels.set()` 退出回放。
- **冻结**：暂停与相册打开期间回放 t、录像带 tc、三脚架倒计时、时辰钟都不走。
- **存档**：损坏的 JSON 不显示“继续”且留下 `.bad` 备份；未知 id 被丢弃；`hold('ending')` 期间不落盘；`markCompleted()` 后标题只剩两项。

**selftest 与 harness 的约定**（M1c 按 WP5/WP7 的实现写明，engine-wp5.md #8、engine-wp7.md #4）：
- `scripts/selftest/wpN.mjs`（以及整合代理的 `m1c.mjs`）由 `core.mjs` 自动发现：默认导出 `run(h)`，返回 `{ ok, notes }`（或 `true/undefined`）；`h` 是 harness 句柄（`call`/`call.try`/`page`/`state`，页面在 `?debug=1&test=1&lockstep=1&quality=low&area=dev`）；没有 `h` 时只跑 node 单元自测。各模块可另导出 `PAGE_TESTS` 与 `--page` 独立运行入口。**每个模块之前 core.mjs 都把页面重置为“新游戏状态 + dev 出生点”**（`newGame` → `dlg` → `setState({area:'dev'})`），页面内自测按新游戏状态写断言；`core.mjs --only=wpN` 只跑一个。页面内自测经 `__game.selftest(name)` 调用 `src/areas/dev/*.ts` 用 `registerSelftest` 登记的函数，直接调用系统、不经调试 API（它本身在 API 的串行队列里，再调 API 会自锁）。
- core.mjs 在同一个 node 进程里顺序 import 各 selftest：harness 已把 vite `preview()` 改掉的 `process.env.NODE_ENV` 还原；各 selftest 自己装到 `globalThis` 上的替身（document、window、localStorage……）用完要还原。
- 并行运行多个脚本：`CAMERA_DIST=<构建目录> CAMERA_PORT=<起始端口>`（端口被占用会自动往后找）。
- harness 的 GL 警告正则严格照上文：不含 SwiftShader 读像素时的 “GPU stall due to ReadPixels”（它是 “WebGL-” 不是 “WebGL:”，engine-wp3.md #9），未处理的 Promise rejection 以 `pageerror` 抓到。
- `input.mjs` 不锁步：速率类断言按游戏时间算（`wait(0)` 返回当前游戏时间），窗口要够长（`state().vcr.tc` 只到整秒）；每按一次键都等它生效再按下一次（按键在下一帧才翻译）。

### 12.5 截图机位（`AreaDef.shots`）

```ts
export interface ShotDef {
  id: `shot.${AreaKey}.${string}`;                  // M1a：AreaKey（§15.3 的 shot.dev.lookdev_* 需要）
  label: string;                                    // 评审时看的说明，如“子时·槐树下远景”
  preset?: 'zi' | 'chou' | 'yin' | 'mao' | { flags?: Record<string, boolean | number>; items?: ItemId[]; photos?: PhotoId[] };
  view: { cam: CameraPose }                          // 自由机位（隐藏玩家）
      | { player: XZ; yaw: number; pitch?: number; floor?: number; mode: 'tp' | 'vf'; lens?: LensMode; zoom?: ZoomLevel; replay?: { point: ReplayPointId; seg: SegmentId; t: number } };
  ui?: boolean;                                      // 默认 false；取景器 HUD、对话框等界面截图设 true
  settle?: number;                                   // 截图前等待的真实帧数，默认 12
  keys?: readonly string[];                          // 本机位里必须“看得清”的交互物/ref（shots.mjs 在其锚点投影处测亮度）
  brightness?: readonly [number, number];            // 覆盖默认的平均亮度区间 [0.05, 0.35]（红外、暗房红灯、黑屏过场等特殊机位）
  temp?: Readonly<Record<string, boolean | number>>; // M3 补写（r2 #2、r3 #4）：进区域之后、摆机位之前 ctx.setTemp 写进当前区域（声控灯 lamp_lit_<n>、暗房红灯 safelight）；区域的 update/'temp' 事件据此摆灯
  highlight?: number | false;                        // M3 补写（r3 #4）：高光验收的亮度阈值（默认 0.8）；false 不验（单红通道画面 sRGB 亮度上限约 0.21，暗房红灯机位用 false）
}
```

M3 补写：自由机位（`view.cam`）隐藏**整个**主角——`setVisible(false)`（身子）之外再 `playerModel.root.visible = false`（装在身上的摄像头脑袋与视频线；头装在支架上时不在 root 下，照常渲染），下一次进区域（`Game.areaReady`）复原（r1-world #4、r2 #3、r4 #4）。`scripts/shots.mjs`：截图超时 `CAMERA_SHOT_TIMEOUT`（默认 180 秒）、调用超时 `CAMERA_CALL_TIMEOUT`（默认 400 秒），单张出错只记为该机位的问题、不中断整轮；带 `--area` 时 perf 写 `test-artifacts/shots/perf.<区域,…>.json`（几个区域并行跑互不覆盖；r2 #4、r3 #6、r4 #3）。

`__game.shot()` 每次先 `viewfinder.resetOptics()`（M1c look-dev 修正：离开取景器不复位镜头，上一张红外机位会把红外带进下一张没写 `lens` 的机位），与“每张图与前一张无关”一致。

`preset` 的时辰简写对应 §15.4 的预置：`'zi'` = `r2_start`（子时，街坊已出现）、`'chou'` = `r4_start`、`'yin'` = `yin`、`'mao'` = `yin` + 终章 flags 直到 `r1.soul_returned`（结局相关状态由 `shot()` 内部用 `debugSet` 设，不经过 `save.hold`）。

`__game.shot(area, shotId)`：（需 `?debug=1`）按 preset 设状态 → 进入区域 → 按 view 摆相机或摆玩家与模式 → `ui.setHidden(!ui)` → 等 `settle` 帧 → 返回 `{ ok, keys: [{ id, x, y }] }`（关键对象锚点的屏幕像素坐标），由 Playwright `page.screenshot()` 并测亮度。截图脚本默认视口 1280×720、`quality=high`、关闭动态分辨率。

**look-dev 机位（M1c，`src/areas/dev/lookdev.ts`）**：`shot.dev.lookdev_tp`（第三人称雨夜门岗）、`lookdev_vf`（取景器，含阴物魂影）、`lookdev_ir`（红外）、`lookdev_close`（主角近景，门灯逆光）、`lookdev_replay`（回放，借 `rp.r1_gate`/`seg.gate_2026`，只在 dev 区域这样用）。这五张是冻结基准画面：改 `LIGHT_SCALE`、`LOOK`、`POST_PRESETS`、共享材质或后期着色器后必须重跑 `shots.mjs --area dev` 并看图。沙盒另登记页面内钩子 `lookdev.tweak`：先 `shot('dev', id)` 摆好机位，再设 `globalThis.__lookdevTweak = { env, fog, hemi, point, byName, post, frames }` 并 `selftest('lookdev.tweak')`，就能在不重新构建的情况下对比灯光/环境/后期参数。

每个区域**至少 8 个**机位：入口远景、主要地标、每个谜题的关键位置各 1、一个取景器画面（阴物/褪字可见）、一个红外画面（有红外内容的区域）、一个回放画面、每个有差异的时辰各 1。

---

## 13. 渲染设定与性能预算

### 13.1 渲染器设定（`core/render.ts`，全局唯一，区域不得修改）

```ts
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;          // 默认值，显式写出（最终编码由 CameraFxPass 自己做，见 §8.1）
renderer.toneMapping = THREE.NoToneMapping;                // 色调映射由 CameraFxPass 统一做（Neutral，保色相）；这里设 No 避免重复
renderer.toneMappingExposure = 1.0;                        // 固定为 1：NeutralToneMapping 内部会乘它，曝光改走 CameraFxPass 的 uExposure
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;              // r186 已弃用 PCFSoftShadowMap
renderer.shadowMap.autoUpdate = false;                     // 静态阴影：区域进入与灯开关时 needsUpdate = true
renderer.info.autoReset = false;                           // 每帧开始手动 renderer.info.reset()，统计整帧
renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[q].pixelRatio) * renderScale);   // renderScale 见 §13.2 动态分辨率
THREE.ColorManagement.enabled = true;                      // 默认值：Color/hex 按 sRGB 解释并转线性
```

- **色彩空间**：颜色贴图（CanvasTexture 画的一切）`colorSpace = SRGBColorSpace`；数据贴图（遮罩、粗糙度、噪声）保持 `NoColorSpace`；RenderTarget 贴图保持默认（RT 里是线性工作空间，不要设成 sRGB）。
- **色调映射**只发生在 `CameraFxPass`（它取代了 OutputPass，§8.1）。辅助 RT（镜面、CH1/CH2、录像带）不做色调映射，贴到场景里后随主画面一起被映射一次。
- **环境贴图**：每区一张 PMREM 夜景环境（§8.3），`scene.environmentIntensity` 0.6–1.4（M1c look-dev 冻结，`LOOK.envIntensity`）。
- **灯光**：物理单位 + `designLight()`（§10.3）；所有灯 `layers.enableAll()` 且不被 `setLayerRecursive` 改写；灯不挂在可隐藏节点下；灯的数量在区域生命周期内保持不变，开关用强度（改变参与渲染的灯数会触发着色器重编译卡顿）。dev 下每帧断言本区压入的灯数恒定。
- **阴影**：全局最多 1 盏投影光（R3 影棚钨丝灯，512 阴影贴图，`castShadow` 只给影棚里的大件）。角色一律 `blobShadow`。
- **雾**：`FogExp2`，颜色与密度照 GDD §4；自定义 ShaderMaterial 需要雾时显式支持。
- **透明与排序**：魂影 `renderOrder 10`、纸像发光 15、回放人影 20、雨 5；四者 `depthWrite:false`。
- **预编译与预热**：`renderer.compileAsync(scene, camera)` 在 r186 里**只编译调用那一刻场景里已有、且可见的材质变体**，之后才创建的回放人影、第一次切红外时的 irMaterial 与置空 instanceColor 的变体、后期的红外分支都会在第一次用到时卡一下。所以进区域时：① 先隐藏地构建本区全部回放人影与片段道具（§6.9）；② `compileAsync`（M1d：经 `core/area.ts` 的 `precompile()`，调用期间渲染目标设成 1×1 线性半浮点 RT——r186 按当前渲染目标决定程序的 `outputColorSpace`，目标为 null 时编出的是画到屏幕的 sRGB 变体，而主场景只画进后期链的线性 RT，M1c 实测 dev 86 个程序里 35 个是这样的死变体，§16 #35）；③ 在淡入期间由 `fx/warmup.ts` 往一张 1×1 RT 依次渲一帧：取景器掩码（含 yin/faded_text/replay 层，临时把隐藏的人影设可见）、会淡出的人身的透明变体（M1d）、红外替换（`IrRenderer.begin/end`）、CameraFxPass 的红外与常规分支（M1d：画到屏幕）、镜面/CH2 feed 各一次。预热不改任何玩法状态。录像带场景在打开面板时用 `warmScene` 同样真画一遍（§6.10）。`core.mjs`（`m1d.mjs`）在 mid 画质下逐项玩一遍取景器/红外、回放两段、监控台插线套叠与 CH2、三脚架、镜面、身子与 NPC 淡出、录像机 seek 过分屏，断言 `programs` 不变。

### 13.2 画质档（`data/render.ts` 的 `QUALITY`）

| 项 | low | mid | high |
|---|---|---|---|
| 像素比上限 | 1.0 | 1.25 | 1.5 |
| 动态分辨率 | 关 | 0.7/0.85/1.0 × 上限 | 0.7/0.85/1.0 × 上限 |
| Bloom | 关 | 开 | 开 |
| 雨丝 | 1000 | 2000 | 3000 |
| 阴影 | 关 | 开（512） | 开（512） |
| 镜面 RT | 512，每 3 帧 | 1024，每 2 帧 | 1024，每 2 帧 |
| CH2 / 录像带 RT 刷新 | 每 4 帧 | 每 2 帧 | 每 2 帧 |
| 贴图各向异性 | 1 | 4 | 4 |

- **默认 `mid`**（集显 1080p 60fps 的把握更大）；设置里可改；测试用 `?quality=low`。
- **动态分辨率**：以最近 2 秒平均帧时为依据，在 `DYN_RES.scales` `{0.7, 0.85, 1.0}` 三级之间切换，像素比 = scale × min(devicePixelRatio, 本档上限)（M1d 更正：原来是绝对像素比 {1.0, 1.25, 1.5}，在 DPR 1 的屏幕——目标机型集显 1080p——上全被钳成 1，降档毫无作用；UI 是 DOM，低于原生分辨率不糊字）；平均帧时 > 18ms 降一级，< 13ms 且持续 4 秒升一级，每次切换后冷却 3 秒，切换走 §4.7.1 的 `resize()`；`?test=1` 与截图时关闭。M4 第 2 轮：帧间隔按 **rAF 的时间戳**（垂直同步时刻，`Game.onFrame` 写进 `RenderPipeline.frameStamp`）计——渲染结束后的 `performance.now()` 带着相邻两帧工作量之差的抖动，60Hz 下“贴着垂直同步也升档”的判据永远不成立；暂停页不渲染期间不采样（§15.7.3）。
- 运行中改画质：`game.requestReenter('quality')`（雨丝数量、阴影、RT 尺寸在 build 时读取；M1d：在安全时重进，§6.4）。
- **辅助 RT 的调度**（M1d）：镜面每 `mirrorEvery` 帧（`frameNo % every === 0`）且在门卫室内；CH2 与录像带每 `feedEvery` 帧、与镜面错开一帧（`(frameNo + 1) % every === 0`），CH2 与 CH1 自身画面只在屏幕看得见时刷新（§6.11）。
- 后期只有 3 个全屏 pass（RenderPass、Bloom 多级、CameraFxPass），OutputPass 已并入 CameraFxPass。

### 13.3 硬预算（每个区域，任意机位；`BUDGET` 常量，`perf()` 可测）

| 指标 | 上限 |
|---|---|
| 主场景 draw call（`callsMain`） | ≤ 250 |
| 整帧 draw call（含辅助 RT 与后期） | ≤ 400 |
| 三角面 | ≤ 250k |
| 实时光（含半球光/环境光） | 总数 ≤ 8，进区域后恒定（不设“同时开启”上限，GDD §9.3）；录像带 `tapeScene` 另计 ≤ 3 |
| 投影光 | 全局 ≤ 1 |
| RenderTarget | 镜面 1024（仅门卫室内，far 8m，不含雨）、CH1 乒乓 2×256×192（仅视频线插上时）、CH2 乒乓 2×256×192（仅 R1）、录像带 256×192（仅录像机面板打开时）、五路分屏图集 512×384（仅开场） |
| CanvasTexture 总量 | ≤ 64 MB（按 w×h×4 估算） |
| 区域切换 5 次后 `geometries`/`textures` 计数 | 回到基线 ±5 |
| 开关取景器、切红外前后 `programs` 计数 | 不变（预热后） |

- 窗户、晾衣、电线、摊主、取件格、瓷砖、树叶、人群、雨丝一律 `InstancedMesh`；同材质静态件 `mergeGeometries`。
- 目标：集显 1080p 60fps（GDD §9.3）；无头 SwiftShader 只要求功能正确，不考核帧率。

---

## 14. 构建与质量门槛

### 14.1 必须满足（每个代理交付前自查，M3 统一复验）

1. `npm run build`（`tsc --noEmit && vite build`）**零错误**。TS 严格模式与 `noUnusedLocals/noUnusedParameters` 保持开启；未用参数以 `_` 开头。
2. 不使用 `any`（`window` 全局声明与 three 类型缺口处允许 `unknown` + 断言，并注释原因）；不使用 `// @ts-ignore`。
3. `node scripts/smoke.mjs` 通过；`node scripts/check.mjs` 无违规。
4. 运行期零 `pageerror`、零 `console.error`、零未处理的 Promise rejection；three 的弃用警告（`console.warn` 含 `deprecated`/`has been removed`）与 WebGL 警告（`GL_INVALID`、`WebGL:`、`feedback loop`）视为错误（harness 检查）。
5. vite 的 chunk 体积警告不算错误（可在 `vite.config.ts` 调高 `build.chunkSizeWarningLimit`；vite 8 基于 rolldown，相关选项在 `build.rolldownOptions`，不是 `rollupOptions`）。

### 14.2 `scripts/check.mjs` 检查项

- `src/areas/<a>/` 中不得 import `src/areas/<b>/`（`a ≠ b`）；`src/areas/r1/finale/` 与 `src/areas/r1/` 的其余部分（`index.ts` 除外）互不 import（二者都可以 import `r1/layout.ts`；只有 `r1/index.ts` 可以同时 import `./world` 与 `./finale`）。
- `src/areas/` 中不得出现 `setTimeout`、`setInterval`、`localStorage`、`__game`、`__cam`、`new THREE.PointLight`/`SpotLight`/`AmbientLight`/`HemisphereLight`（应走 `designLight`/`lamp`/`ctx.light`/`ctx.hemi`）、`requestPointerLock`、`AudioContext`。
- `src/` 中形如 `'(r1|r2|r3|r4|it|ph|pt|rd|rp|seg|spawn|exit|npc|spk|ghost|doc|name|pz|dlg)\.[a-z0-9_.]+'` 的字符串字面量：前 18 个命名空间必须在 `ALL_IDS ∪ DEV_IDS` 中（`ALL_IDS` 包含生成式的 `r3.hole_00`–`r3.hole_99`；`DEV_IDS` 是 dev 沙盒的 `spawn.dev_*`/`exit.dev_*`，§4.2；`ph.empty_` 前缀除外；`src/data/ids.ts` 自身豁免）；`dlg.` 只检查形如 `dlg.<areaId>.<snake>` 且 `<areaId>` 等于所在区域目录；`cs.`/`decoy.`/`shot.` 不检查。
- 每个带 `when` 的交互物有 `blocked`、同组角标与交互流程一致（§6.6；通过在 dev 构建里运行 `__game.lint()` 实现，由 `check.mjs` 调用）。
- `--stubs`：列出 `src/` 里残留的 `notImplemented(` 调用，按文件与拥有者（§15.2 清单）分组；M1b 各 WP 的完成定义要求自己的文件为 0。
- 严重度与豁免（M1c 补写，WP7 的实现）：`src/areas/dev/`（引擎沙盒）里“区域目录禁用 API”（`setTimeout`、`localStorage`、裸灯……）只报 **warning**（沙盒夹具要测存档与灯），id 规则不降级；其余目录全部是 **violation**，退出码只看 violation。某一行确需违反规则时（例如 dev 夹具里故意构造的未登记 id 负例），在该行或上一行写 `// check-allow: <规则名>`（规则名见输出的方括号，如 `unknown-id`）并写明原因；区域目录（`r1`…`r4`）不得使用豁免，需求走 `docs/requests/`。

### 14.3 npm 脚本（M1a 加进 `package.json`，不改现有 `build`/`typecheck`）

```json
"smoke": "node scripts/smoke.mjs",
"check": "node scripts/check.mjs",
"check:stubs": "node scripts/check.mjs --stubs",
"test:core": "node scripts/core.mjs",
"test:input": "node scripts/input.mjs",
"test:walk": "node scripts/walkthrough.mjs",
"test:area": "node scripts/regions/$AREA.mjs",
"shots": "node scripts/shots.mjs"
```

测试脚本不自动构建：先 `npm run build`，再运行脚本（脚本对 `dist/` 做 `vite preview`）。

### 14.4 ESLint

可选，不是门槛。若添加，用 flat config + typescript-eslint，规则只开 `no-floating-promises` 与 `consistent-type-imports`，且不得让 `npm run build` 依赖它。

---

## 15. 实现顺序、里程碑与完成定义

| 里程碑 | 执行者 | 并行度 | 内容 | 依赖 | 对应 GDD |
|---|---|---|---|---|---|
| **M1a 骨架与契约** | 1 个骨架代理 | 串行 | `src/data/*` 全量、基础件、所有引擎文件的“只有公开签名”模块、区域与沙盒占位、npm 脚本；结束时**冻结公开签名** | 本文、GDD §13 | E0 前半 |
| **M1b 并行实现** | 7 个工作包代理（WP1–WP7） | 7 路并行 | 各自只改自己拥有的文件，按冻结签名实现，互相只通过签名调用 | M1a | E0 |
| **M1c 整合与 look-dev** | 1 个整合代理 | 串行 | 把各 WP 接起来，跑通 smoke/core/input，修跨模块缺陷；look-dev 关卡冻结光照与后期基准 | M1b 全部 | E0 验收 |
| **M1d 引擎评审** | 3 个评审视角 + 整合代理修复 | 评审并行、修复串行 | 正确性、契约一致性、性能/视觉三个视角评审 → 修复 → 复验 | M1c | — |
| **M2 区域并行** | 5 个区域代理（R1-world、R1-finale、R2、R3、R4）+1 个引擎维护者（串行） | 5 路并行 + 1 路串行 | 各自区域目录 + `scripts/regions/<id>.mjs`；区域代理不改引擎，需求写 `docs/requests/`；引擎维护者（M1c/M1d 的整合代理）拥有全部引擎文件，先进先出串行处理这些条目 | M1d | E1–E3 |
| **M3 整合** | 1 个整合代理 | 串行 | walkthrough 两条路线、读档复验、跨区域问题、处理 `docs/requests/` | M2 | E3–E4 的验收部分 |
| **M4 打磨与评审循环** | 整合代理 + 评审代理 + 按需区域代理 | 循环 | 评审 → 修复 → 全量复验，直到无 blocker/major | M3 | E4 |

通用规则：
- 任何时刻每个文件只有一个拥有者（§2.12）。不是自己的文件一律只读。
- 所有代理交付前满足 §14.1。遇到值得记住的坑：串行阶段的代理（M1a 骨架代理；M1c、M1d、M3、M4 的整合代理；M2 的引擎维护者）在 `AGENTS.md` 的 `## Lessons` 末尾追加一行；并行阶段的代理（M1b 各 WP、M2 与 M4 回派期间的区域代理）不碰 `AGENTS.md`，把 Lessons 写进自己的最终回复，并在交付时于自己的 requests 文件（`engine-wpN.md` 或 `<区域>.md`）末尾加一个 `## Lessons` 小节，由当时的整合代理/引擎维护者收录进 `AGENTS.md`。
- “公开签名”指本文写出的每个导出的类、函数、类型、常量及其成员签名，以及 M1a 为跨 WP 调用补写并同步进本文的签名（本文没写、M1a 自拟而未同步进本文的不算，各 WP 不得依赖）。M1a 结束后只有整合代理（含 M2 的引擎维护者）能改它们；改了必须同步改本文。

### 15.1 M1a 骨架与契约（1 个代理，串行）

**要写的东西**：

1. **全量实现**（M1a 之后冻结，只有整合者能改）：
   - `src/data/*.ts` 全部：`ids.ts` 照 GDD §13 **全量**登记（含 `r4.spotted_huang`、`rd.huang_breath`、`DLG` 两项、`r3.hole_00`–`99` 生成式、`r4.stall_*`、`rig.*`、`mat.*`、`settings.*` 等），导出 §4.2 列出的全部联合类型与 `ALL_IDS`；`palette.ts`、`items.ts`（含 `doc` 关联）、`photos.ts`（含 `old` 标记）、`names.ts`、`speakers.ts`、`time.ts`（钟点表、录像带时间轴、索引点、分屏起点）、`render.ts`（`LIGHT_SCALE` 初值、`QUALITY`、`BUDGET`）、`strings.ts`。
   - `src/core/types.ts`、`src/core/events.ts`（`EventBus` 与 `GameEvents`）、`src/core/math.ts`（含 `reflectPoint`、`parseTc`/`formatTc`、yaw 换算）。
2. **只有公开签名的模块**：为 §2.2–§2.10 列出的**每一个**引擎文件（`core/`、`game/`、`game/modes/`、`ui/`、`fx/`、`rigs/`、`kit/`、`audio/`、`debug/`）创建模块，按本文签名导出类、函数、类型与常量：
   - 接口与类型写全；类的公开成员签名写全；
   - 方法体是最小可运行的占位实现（返回合理的默认值、空操作、`{ ok:false, reason:'mode_disallows' }` 等）或 `throw notImplemented('Class.method')`（`core/log.ts` 里的 `notImplemented` 与 `devAssert` 由 M1a 真实实现）；
   - 常量表（`KEYMAP`、`POST_PRESETS`、`MATERIALS` 等）给出类型正确的占位值；
   - 每个文件顶部一行注释 `// owner: WPn`（§15.2 的清单），供 `check.mjs --stubs` 分组；
   - 整棵树 `npm run build` 必须通过。
3. **区域与沙盒**：
   - `src/areas/index.ts`；
   - 五个占位区域（`r1` `r2` `r2_502` `r3` `r4`）：`defineArea` 写好 GDD §13.2 的全部出生点与出入口（坐标、1.5m 触发体、门洞类放门外、`when` 条件）、`post`，`build` 里只放地面、外墙碰撞体和一块写着区域名的牌子（调用 kit 的签名，M1b 之后就能跑起来）；
   - R1 的拆分骨架：`r1/index.ts`（`mergeAreaParts`，§11.1）、`r1/layout.ts`（GDD §4.1 的全部坐标常量）、`r1/world.ts`（占位 `AreaPart`：在 layout 坐标上放占位盒子，并 `ctx.ref` 登记 `r1.desk` `r1.crt` `r1.vcr` `r1.crt_jack` `r1.bracket` `r1.mirror`；调用 `ctx.console({ screen: <r1.crt 占位网格>, viewPose, channels: <五路占位 paint> })`；登记 `r1.crt` 交互物（`onInteract: g => g.cctv.open()`）；用 `ctx.npc` 放一个占位的 `npc.tudi`（站在 GDD §4.1 的槐树下，无对话）——让 R1-finale 在 R1-world 完成前就能对着这些 ref、监控台与 `addTalk` 开发和测试）、`r1/finale/index.ts`（占位 `AreaPart`：只调用 `ctx.console({ tunnelBaked: <占位贴图> })`，保证 R1 的 `console` 字段在 build 结束时齐全）；
   - `src/areas/dev/index.ts`（`mergeAreaParts(DEV_BASE, [wp1…wp7])`），以及这些文件的占位：`dev/base.ts` 导出 `DEV_BASE: AreaBase`（id `dev`、出生点 `DEV_SPAWN.*`、通往 r1 的 `DEV_EXIT.TO_R1`、post `'dev'`；`mergeAreaParts` 的 base 必须带 spawns/exits/post，`AreaPart` 不能带，所以底座不是 `AreaPart`），`dev/wp1.ts`…`dev/wp7.ts` 各导出空的 `AreaPart`。
4. `package.json` 加上 §14.3 的脚本（不改现有 `build`/`typecheck`）；建 `docs/requests/engine-m1a.md`（M1a 变更记录）与 `docs/requests/engine-wp1.md`…`engine-wp7.md` 七个带格式说明（§15.6）的空文件。

**完成定义**：
- [ ] `npm run build` 零错误；§2 列出的每个文件都存在，且都有 owner 注释。
- [ ] 用一段一次性脚本从 GDD §13 抽取全部反引号 id，与 `ALL_IDS` 比对，差集为空（结果写进最终回复）。
- [ ] 本文 §4–§12 的每个导出签名都能在代码里找到同名同型的声明（若 TS 类型检查逼得必须偏离，就同步改本文，并在 `docs/requests/engine-m1a.md` 的“M1a 变更记录”里逐条列出）。为跨 WP 调用补写的签名（本文未写出的）同样要同步进本文，否则不算冻结签名（§15 通用规则）。
- [ ] 结束时宣布**签名冻结**：此后公开签名只能由整合代理修改。

### 15.2 M1b 并行实现（7 个工作包）

**共同规则**：
- 每个 WP 只改下表里自己拥有的文件，外加自己的 `scripts/selftest/wpN.mjs` 与 `src/areas/dev/wpN.ts`（在沙盒里布置本包的测试夹具，并用 `debug/selftest.ts` 的 `registerSelftest` 登记页面内自测函数）。
- 按冻结签名实现；调用别的 WP 的模块只依赖签名，不依赖它此刻的占位行为。
- 签名不够用、或发现别的 WP 的契约有问题：不改签名、不改别人的文件；先在自己文件里绕开，并在自己的 `docs/requests/engine-wpN.md` 里追加一条（格式见 §15.6），M1c 由整合者逐个处理。各 WP 只写自己的 `engine-wpN.md`，不写别的 requests 文件，也不写 `AGENTS.md`（Lessons 的写法见 §15 通用规则）。
- 自己的文件必须随时保持可编译（别人的构建会一起跑）。

**共同完成定义**（每个 WP）：
- [ ] 自己拥有的文件里没有 `notImplemented`（`npm run check:stubs` 本包计数为 0）。
- [ ] `npm run build` 通过（若失败只因为别的 WP 的文件，在最终回复里写明，不算本包未完成）。
- [ ] 有针对自己模块的最小自测：`scripts/selftest/wpN.mjs`（由 `core.mjs` 自动发现，可单独 `node scripts/core.mjs --only=wpN` 运行）+ `src/areas/dev/wpN.ts` 里的夹具与页面内自测函数。只依赖 M1a 基础件与本包的用例在 M1b 就必须通过；依赖别的 WP 的用例写好即可，M1c 必须通过。
- [ ] 最终回复列出：实现要点、偏离或补充（如有）、写进 `docs/requests/engine-wpN.md` 的条目与 Lessons。

| WP | 拥有的文件 | 主要依赖（只通过签名） | 本包的要点（逐条对应本文） | 最小自测 |
|---|---|---|---|---|
| **WP1 core 运行时** | `src/core/` 下 `game.ts` `input.ts` `actions.ts` `modes.ts` `area.ts` `areaContext.ts` `triggers.ts` `timers.ts` `disposer.ts` `render.ts` `layers.ts` `cameras.ts` `collision.ts` `player.ts` `url.ts` `log.ts`；`src/game/modes/explore.ts` `pause.ts`；`src/main.ts`；`index.html` | WP3（`PostPipeline`、`feeds`、`environment`、`warmup`）、WP4（state/effects/save/各系统的 update）、WP5（相机类系统的 update）、WP6（`UI`）、WP2（玩家模型） | 启动与错误页、context lost（§3.1）；帧循环、冻结、锁步、`advance(until)`、`settle`（§3.2–3.4）；`AreaManager` 的 enter/travel/route/goto/teleport 与 `mergeAreaParts`（§4.5、§11.1）；`AreaContext` 全部方法含 `lightsRoot`、临时状态、`console` 合并、灯数冻结（§11.2）；输入的指针策略与捕获阶段拦截（§4.6）；`KEYMAP`（附录 A）与 `ModeStack`（含 `freezesWorld`、`pointer`、`arg`）；图层表与“跳过灯”（§4.7）；`CameraRig` 与窄视口（§4.7、§4.7.1）；`RenderPipeline` 的辅助 RT 调度、resize/DPR、动态分辨率（§13.2）；`CollisionWorld` 动态碰撞体与 `reachable`（§4.8）；`PlayerController.walkTo`；出生点距离断言 | 冻结时 `game.time` 不走；锁步下两次 API 之间 `time` 不变；`ModeStack` push/pop/resetTo/popToBase；`KEYMAP` 与附录 A 逐格一致；动态碰撞体开关后 `walkTo` 被挡/通过；`reachable` 在墙两侧为假；`route` 在条件不满足时返回第一个被挡出口；视口 3:4 时 `frameRect` 与 photo 相机一致；`setLayerRecursive` 不改灯 |
| **WP2 rigs + kit** | `src/rigs/*`、`src/kit/*` | WP3（`MATERIALS`）、WP1（`LAYER`、`ColliderBuilder`/`DynamicShape` 类型） | `PC_DIMS` 与主角头部尺寸、支架在 self_head（§5.2）；`PlayerModel` 的 `setPose/setBodyOpacity/setVisible/stickerWorld`；`faceMask`；黄三爷 masked 复用纸扎摊主、`man`/`weasel` 变体（§5.3）；纸人与实例化摊主同源（§5.4）；`door()` 的 `handle` 与 `collider`；`lamp()` 的 `wetStreak` 且真实光不挂在 group 下；实例化雨丝；`createFootprints`（§10.2） | `createPlayerModel()` 的镜头与贴条世界高度与 `PC_DIMS` 相差 < 1cm；masked 黄三爷与同 seed 纸人包围盒一致；1× 下 masked 黄三爷与同 seed 纸扎摊主的渲染逐像素一致（同机位、同光照各渲染一帧比对），≥4×、≤5m 时换上高清脸贴图；雨 1 个 draw call；`door().collider` 形状正确；`detectCjk()` 在测试机为真 |
| **WP3 fx + audio** | `src/fx/*`（`post` `cameraFxShader` `presets` `materials` `ghostMaterials` `ir` `crtScreen` `feeds` `environment` `warmup`）、`src/audio/*` | WP1（渲染器、图层） | `CameraFxPass` 取代 OutputPass（§8.1）；红外的 instanceColor 与透明贴花处理、灯笼 6℃ 由区域给（§6.8.2）；feeds 的乒乓/隐藏规则（§6.11）；`areaEnvironment`（§8.3）；`warmup`（§13.1）；`crtScreen` 的 split5 与 split 字段（§8.4）；音频在 pointerdown/keydown 时才创建 `AudioContext`、hidden 时 suspend（§9） | 带 instanceColor 的实例网格红外像素与 `tempC` 一致；透明文字贴花红外下非矩形；预热后开关红外 `programs` 不变；后期 pass 数为 3；解锁前 `audio.ctx === null` 且无自动播放警告 |
| **WP4 状态与叙事系统** | `src/game/` 下 `state` `expr` `effects` `save` `settings` `shichen` `interaction` `npc` `dialogue` `cutscene` `panels` `journal` `hints`；`src/game/modes/` 下 `dialogue` `album` `journal` `cutscene` `panelCode` `panelNaming` | WP1（模式栈、区域上下文）、WP5（取景器状态、回放 active）、WP6（UI 视图） | `EffectRunner` 可重入、settle、取消与 `GameApi`（§6.3）；`temp()` 条件（§6.2）；存档校验、`hold`、`markCompleted` 与 `endingDone`/`E.ending`（§6.3、§6.4）；钟点表与 `hudLabel`（§6.5）；聚焦规则（穿玻璃、priority）、`Dyn` 字段、`OfferTable.any`、`addTalk`、album 的 menu/pick（§6.6）；NPC 让位、跟随灯、`setLabel`（§6.7）；`DText` 与强制对话（§6.13）；`CutStep` 的 `crt`/`layers`/`(g, ctx)`（§6.14）；`renderDoc` 与褪字标记（§6.16）；`appendTo`（§6.17） | 表达式含 `temp()`；可重入三例（onHit 开对话、过场 effects 步、对话→过场→对话）；`cancelAll` 后续 effect 丢弃；损坏存档 → `.bad` 备份且 `has()` 为假；`hold` 期间不落盘；钟点 00:59/02:59/04:59 停住、05:00 才显示卯时；隔玻璃聚焦到高优先级 NPC；album pick → `activate`；`renderDoc` 取景器/肉眼两种正文；南柯提示只在 1 ≤ n < 6 时追加 |
| **WP5 相机类系统** | `src/game/` 下 `viewfinder` `photo` `read` `replay` `vcr` `cctv` `crt` `mirror` `tripod`；`src/game/modes/` 下 `viewfinder` `replay` `panelVcr` `panelConsole` `tripod` | WP1、WP3（`IrRenderer`、feeds、`crtScreen`）、WP4（state、effects、interaction）、WP2（角色工厂） | 面板叠加的 look/pass 规则（§4.6）；拍照判定含 `Caption` 函数、`hideWorld`、让位（§6.8.3–6.8.4）；读字的函数 `at`、`via.mirror` 虚像判定、`tooSmall:null`、`notInMirror`（§6.8.6）；回放 3D 半径、预建人影、任何传送退出（§6.9）；独立 `tapeScene`、双分屏、events 的“到达或越过”（§6.10）；`console` 分次配置与 split5、Reflector 式镜面（§6.11）；三脚架的 `hold/release` 与 tripod 角色（§6.12） | `PhotoFail` 每种至少一例；镜中读字正前方可读、偏 0.6m 得 `notInMirror`；`replaySeek(dur)` 触发 onComplete 一次；`hideWorld` 窗口内对象不可见；`vcr.seek('03:16:00')` 正好落点触发事件；tapeScene 里看不到 R1 当前的 NPC 与玩家；CH2 与镜面渲染无 GL 警告；三脚架成功/出圈/移动三种结局 |
| **WP6 ui** | `src/ui/*` | WP4、WP5（只读系统状态）、WP1（`dispatch`） | 分层与组件（§7）；角标现算 label、`colorHint`；相册/挑选器/动作菜单（`mode.album`）；取景器中打开的文档阅读器；`pointerGate`、`bootError`、“载入中…”；`setFrameRect`；按钮 `tabindex=-1` 与点击后 `blur` | 全部视图节点存在；按钮都是 `tabindex=-1`；点击菜单后 `document.activeElement` 不是按钮；`setLoading` 300ms 后可见；`showBootError` 渲染出中文错误页 |
| **WP7 debug + scripts + 沙盒** | `src/debug/*`（`api` `shots` `overlay` `fidelity` `selftest`）；`scripts/lib/harness.mjs` `scripts/lib/presets.mjs` `scripts/smoke.mjs` `core.mjs` `input.mjs` `walkthrough.mjs`（GDD §11 **全部 58 步**写成数据）、`scripts/regions/{r1,r1_finale,r2,r3,r4}.mjs` 骨架（含本区步骤清单与 PRESETS 引用）、`shots.mjs`、`check.mjs`；`src/areas/dev/base.ts` `dev/wp7.ts` | 全部（通过 `window.__game` 与签名） | §12 的全部方法与 `DebugState`，settle/锁步/真实时间超时（§12.2）；真人路径检查（§12.3、`fidelity.ts`）；harness 的 GL 警告捕获；`shots.mjs` 亮度验收；`check.mjs` 全部检查项含 `--stubs`（§14.2）；沙盒底座：30m×30m 场地、外墙、出生点、一个通往 r1 的出入口、两个楼层节点、地标牌 | 每个 API 方法存在且返回可 JSON 序列化的 `ApiResult`；harness 能抓到人为制造的 `console.warn('GL_INVALID_OPERATION …')`；`check.mjs` 能抓到一个人为放进临时文件的违规 import；`input.mjs` 沙盒模式的键鼠驱动能让 `state()` 发生预期变化 |

**沙盒（`areas/dev`）要包含的夹具**（由各 WP 在自己的 `dev/wpN.ts` 里放，WP7 放底座）：带 `when/blocked` 的交互物；一个阴物 NPC 与一个带对话树（含选项）的 NPC；一个强制对话（二选一）；一个拍照目标（live）、一个遮挡物、一扇玻璃（noOcclude）后的高优先级 NPC、一个诱饵；一个读字目标（≥2×）、一面小圆镜与镜中读字目标、一个跟随 NPC 的读字目标（`tooSmall:null`）；一个残影点与两段片段（带 onComplete、时间窗目标与 `hideWorld`）；一个密码锁；一个称呼面板；录像机 + 监控台 + 三脚架（简化带子数据，含分屏）；一扇由 flag 控制的动态碰撞门；两个楼层节点；不同 `tempC` 的红外物体、一个带 instanceColor 的实例网格、一张透明文字贴花；一个冷迹；look-dev 样板角落（§15.3）。

### 15.3 M1c 整合与 look-dev；M1d 引擎评审

**M1c（1 个整合代理，串行）**：从这时起整合代理拥有全部引擎文件。

1. 把各 WP 接起来：逐个处理 `docs/requests/engine-m1a.md` 与 `engine-wp1.md`…`engine-wp7.md` 的条目（改签名时同步改本文，并在条目下写结论）；把各文件末尾的 `## Lessons` 收录进 `AGENTS.md`；修跨模块缺陷；统一日志与错误处理。
2. 跑通 `npm run build`、`smoke`、`check`（含 `--stubs` 全树为 0）、`test:core`（含全部 `selftest/*.mjs`）、`test:input`。
3. **look-dev 关卡**：在 dev 沙盒搭一个样板角落——门岗立面（门、台阶、门灯）、一盏钠灯（`wetStreak`）、雨、湿地面、站着的摄像头人（镜头环、铁皮帽、贴条）、一台亮着的 CRT；截 `shot.dev.lookdev_tp`、`shot.dev.lookdev_vf`、`shot.dev.lookdev_ir` 三张（`quality=high`；M1c 实际另加 `lookdev_close`、`lookdev_replay`，布景还有门楣空支架、槐树一角与彩灯、院墙与红圈“拆”、远处两栋几乎全黑的居民楼、夜空、窗前魂影、残影点）。通过标准：`shots.mjs` 的亮度验收（§12.4）；主角头部的金属与玻璃有环境反光、不发黑；钠橙与靛蓝的色调符合 GDD §9.1；雨丝在 1280×720 下看得见。通过后**冻结** `LIGHT_SCALE`、`FxParams.exposure` 基准、Bloom 阈值、各区 `environment.intensity` 的建议范围（写进 `data/render.ts` 与 `AGENTS.md` Lessons），再进入 M1d。

**M1c 完成定义**：
- [x] §14.1 全部满足；`check.mjs --stubs` 全树为 0。（M1c：`npm run build` 零错误；check 0 违规（dev 沙盒 9 条警告）；stubs 全树 0；smoke 通过、运行期零 pageerror/console.error/GL 警告）
- [x] `scripts/core.mjs` 通过（M1c：33/33，含 wp1–wp7 与 m1c 的全部页面内自测、readDoc 成功路径；与 input.mjs 并行连跑 3 遍无失败），至少覆盖：每个 §12.3 方法的一次成功与一次失败（有失败分支的）；拍照判定的每个 `PhotoFail` 至少一例（不在框、太远、倍率低/高、镜头不符、太小、遮挡、隐藏、时间窗早/晚、多主体只中一个、录像机未暂停、频道不符、未插线）；回放 `replaySeek(dur)` 触发 onComplete 且只一次；录像机 seek 到达或越过事件点触发事件；密码锁错误 3 次写线索；称呼面板错选反馈；对话“（先这样）”自动项与强制对话无此项；三脚架成功/出圈/移动三种结局；`wait()` 快进过场；存档 → `reload()` → flags、物品、照片、线索一致；在两个区域间往返 5 次资源计数回到基线；`dev` 区域 `perf()` 在预算内；以及 §12.4 列出的全部回归例。
- [x] `test:input` 通过。（M1c：9/9，连跑 3 遍）
- [x] 五个占位区域可以互相走通（出入口条件按 GDD，用 `?debug=1` 预置 flag 验证；`goto` 的出入口图寻路与 `blocked` 反馈正确）。（M1c：`route()` 改为报路线上的第一个被挡出口后通过）
- [x] `walkthrough.mjs --until=1` 可运行到第 1 步的调用（`r1.log` 由 R1-world 在 M2 提供，此时以 `no_such_target` 失败属预期；后续步骤等 M2）。
- [x] look-dev 关卡通过并冻结基准值。（M1c look-dev：`src/areas/dev/lookdev.ts` 五个机位全部过 `shots.mjs` 亮度验收与 §13.3 预算（主场景 draw call ≤ 203、三角面 ≤ 29k、灯 4）；冻结 `LIGHT_SCALE`（point/spot 0.1 × distance²、hemi/ambient/dir π，§10.3）、`LOOK`（exposure 1.5、Bloom 阈值 0.8/半径 0.45、环境强度 0.6–1.4/默认 1.0）、夜景环境贴图（§8.3）、后期着色器的色差映射/传感器饱和/红外轮廓线（§8.1）、灯罩自发光与湿地光带、亮窗、雨丝不透明度（§10.2）、主角轮廓光与头部环境反光（§5.2）；dev 沙盒底座改成 R1 标准夜景（GDD §4.1 半球光、雾 0.045、去掉平行“月光”）；给区域代理的用法写进 `AGENTS.md` Lessons）

**M1d 引擎评审**（评审并行、修复串行）：
1. 三个评审代理**只读**评审，各自产出按严重度排序的问题清单（blocker/major/minor，附文件、行号、复现方式与建议修法）：
   - **正确性**：状态机、Effect 可重入与取消、存档、判定算法、边界条件，是否符合本文描述；
   - **契约一致性**：代码的公开签名与本文逐条比对；GDD 的 id、文本、规则（尤其 §3.4 模式表、§3.13 存档、§10.1 按键、§10.2 角标规则）在引擎里是否到位；
   - **性能/视觉**：§13.3 预算、draw call 与着色器编译（`programs` 稳定性）、辅助 RT、look-dev 截图、红外与镜面画面。
2. 整合代理按清单修复（串行），每修一批重跑 `smoke`、`check`、`test:core`、`test:input`；评审代理复核已修项。

**M1d 完成定义**：没有未关闭的 blocker/major；本文与代码的公开签名一致；建好空的 `docs/requests/m2-engine.md`；引擎文件对区域代理冻结，M2 期间只由引擎维护者（本整合代理）修改（§2.12、§15.4）。

**M1d 记录**（三个视角 1 blocker + 14 major + 若干 minor，全部修复或写明取舍；本文凡改动处标“M1d”）：过渡期间的暂停与失败保护（§4.4、§4.5、§4.6）；片尾后引擎回标题、换一局复位主角模型与区域后期层（§4.4、§5.2、§6.3、§6.4）；推迟的画质重进移到 `Game.step` 末尾（§4.4、§6.4）；两层取景器与面板（§6.8.1、§6.10、§6.11）；门槛高度与连通性栅格同源（`STEP_MAX`/`PLAYER_RADIUS`，§4.8、§4.9）；过场撤掉取景器后期、`readOnce` 随区域清空、`'temp'` 重算区域外观（§6.8、§11.2）；`GameApi.shichen.override` 与 `player.model.cable.plugTo`（§6.3、§6.5、§5.2）；红外专属对象的聚焦/角标、透明网格的遮挡规则（§6.6）；`travel` 取消调用者写明（§4.5）；§11.4 示例环境强度；`ShotDef` 的 import 路径（§2.12、§2.13）；`automation` 只留 `aim`；减少闪光关掉短闪（§8.1）；CH2/CH1 只在屏幕可见时刷新、辅助 RT 错帧（§6.11、§13.2）；预编译进线性 RT、录像带真画预热、淡出变体预热（§8.5、§13.1、§16 #35–36）；反馈条压在全屏面板之上等 UI 修正（§7）；`perf()` 连采一个辅助 RT 周期并报 `canvasMB`（§12.3）；动态分辨率改为相对系数（§13.2）；角色 draw call 成本写进 §5.1（按骨骼合并留到 M4）。回归自测在 `src/areas/dev/m1d.ts` 与 `scripts/selftest/m1d.mjs`（含 mid 画质下的着色器程序稳定性用例）。

### 15.4 M2 区域并行（5 个区域代理 + 1 个引擎维护者）

| 区域代理 | 拥有的文件 | 负责的 GDD §11 步骤 | 预置（`scripts/lib/presets.mjs`） | 负责的内容 |
|---|---|---|---|---|
| **R1-world** | `src/areas/r1/` 下除 `index.ts`、`layout.ts`、`finale/` 以外的全部；`scripts/regions/r1.mjs`；`docs/requests/r1-world.md` | 1–11 | `new` | R1 全部场景建造（登记 `r1.desk` `r1.crt` `r1.vcr` `r1.crt_jack` `r1.bracket` `r1.mirror` 等 ref，坐标取 `layout.ts`）；P1、P2；旧照一、二（`rp.r1_tree`、`rp.r1_shed`）；X1 火盆；X5（R1 的冷迹）；湿脚印；`npc.tudi`；监控台与 CH3–CH5；镜面；开场过场（五路分屏）；巡夜本新页①–⑨；R1 文档（§11.6 的分工表） |
| **R1-finale** | `src/areas/r1/finale/`；`scripts/regions/r1_finale.mjs`；`docs/requests/r1-finale.md` | 12、46–58 | `yin`、`ants`、`yin_nanke` | P12、P13、P14；南柯（蚁穴、`r1.ant_old_*`、`r1.nanke`、`pz.h_nanke`、南柯片尾）；X2–X4；`npc.lu`（门岗）、`npc.zhou`；录像带内容（`tapeScene`）；`dlg.r1.bracket_confirm`；结局、尾声（主结局片尾最后一步 `E.ending('main')`，南柯段落最后一步 `E.ending('nanke')`）；导出 `{ interactables, dialogues, cutscenes, puzzles, photoTargets, readTargets, build, … } satisfies AreaPart` |
| **R2** | `src/areas/r2/`、`src/areas/r2_502/`；`scripts/regions/r2.mjs`；`docs/requests/r2.md` | 13–26 | `r2_start` | P3、P4、P5；旧照三、四；`dlg.r2.stairs`；楼层节点 |
| **R3** | `src/areas/r3/`；`scripts/regions/r3.mjs`；`docs/requests/r3.md` | 27–37 | `r3_start` | P6、P7、P8；旧照五；照相馆玻璃门的动态碰撞体 |
| **R4** | `src/areas/r4/`；`scripts/regions/r4.mjs`；`docs/requests/r4.md` | 38–45 | `r4_start` | P9、P10、P11；旧照六；鬼市（灯笼 6℃、黄三爷伪装与 `rd.huang_breath`） |

R1-world 与 R1-finale 同时开工：R1-finale 先对着 M1a 占位 `world.ts` 登记的 ref、占位监控台（`ctx.console` 的 screen/viewPose/channels 与 `r1.crt` 交互物）、占位 `npc.tudi` 与 `layout.ts` 开发；R1-world 必须保持这些 ref、交互物与 NPC 的 id 与坐标不变。两者各自只提供 `ctx.console()` 中自己那一半字段（§6.11），互不 import，只通过 §2.11 列出的方式耦合。`regions/r1_finale.mjs` 不断言 R1-world 负责的内容：步骤 52 末尾土地移到门岗门口的站位、R1-world 的对话文本等由 `regions/r1.mjs` 与 M3 的 walkthrough 断言；步骤 53 的 `interact(r1.crt)` 在 R1-world 完成前走占位交互物。

预置内容（均为 GDD §11 走到该步之前应有的状态）：
- `new`：新游戏。
- `r2_start`：flags `r1.log_taken r1.gate_lamp_on r1.met_tudi r1.ability_replay r1.p1_done r1.mission_given r1.drawer_open r1.gate_unchained`；物品 `it.log`、`it.keys`（已用）、`it.bulb`、`it.slip_0473`、`it.idcard`；照片 `ph.tudi`。
- `r3_start`：`r2_start` + `r2.lobby_lamp_lit r2.wang_met r2.wang_escort r2.wang_floor=5 r2.bulb_installed r2.menshen_open r2.tin_opened r2.wang_done r2.ability_ir`；物品 `it.bulb`（已用）、`it.letter`（已用）、`it.train_ticket`、`it.glasses`、`it.wonton`、`it.money`；照片 `ph.menshen_2018`。
- `r4_start`：`r3_start` + `r3.lu_door_open r3.got_envelope r3.film_hung r3.film_developed r3.saw_true_form`；物品 `it.slip_0473`（已用）、`it.film`、`it.slip_0474`（已用）、`it.portrait`；照片 `ph.covered_face ph.film3 ph.true_form`。
- `yin`：`r4_start` + `r4.ghost_market_open r4.spotted_huang r4.found_huang r4.asked_tape r4.huang_admits r4.got_tape`；物品 `it.money`（已用）、`it.tape_830`；照片 `ph.huang_hides ph.huang_normal ph.huang_ir`。
- `ants`：`r2_start` + 照片 `ph.old_1 ph.old_2`（R1-finale 用来测步骤 12）。
- `yin_nanke`：`yin` + 照片 `ph.old_1`–`ph.old_6` + flags `r1.ant_old_1 r1.ant_old_2`（测步骤 46 与南柯路线）。

**M2 期间的规则**：
- 区域代理**不得修改任何引擎文件**（含 `r1/index.ts`、`r1/layout.ts`、`areas/index.ts`）。遇到引擎缺陷或接口不足：能在自己目录内绕开就绕开；不能绕开的，把需求/缺陷写进自己的 `docs/requests/<区域>.md`（格式见 §15.6），在 `regions/<id>.mjs` 里把受影响的步骤标成 `blockedBy: 'docs/requests/<区域>.md#<编号>'`，继续做其余部分。
- **引擎维护者**（M1c/M1d 的整合代理）在 M2 期间继续唯一拥有全部引擎文件（含 `data/*`、`r1/index.ts`、`r1/layout.ts`、`areas/index.ts`，§2.12），与区域代理同时工作：定期扫描五个 `docs/requests/<区域>.md`，按提交先后**先进先出串行**处理 open 条目。每修一条：重跑 `smoke`、`check`、`test:core` 与受影响的 `regions/<id>.mjs`（只读运行，不改区域脚本）；改公开签名时同步改本文；缺 id 先补 GDD §13 再补 `ids.ts`；然后在 `docs/requests/m2-engine.md` 追加 `## <区域>#<编号> <标题>` 与 `- 状态：resolved（改了哪些文件）` 或 `wontfix（理由）`（不写进区域的 requests 文件，保持单一拥有者）。只能靠改区域代码解决、或需要跨区域协调的条目，标 `deferred-M3`。
- 区域代理看到自己的条目在 `m2-engine.md` 里 resolved 后，去掉对应步骤的 `blockedBy` 并跑通；wontfix 或 `deferred-M3` 的条目保留 `blockedBy`，按结论调整绕开方案。
- 缺 id 同样写进 requests 文件，不许自造（§0.3），由引擎维护者补。
- 各区域代理不写 `AGENTS.md`；Lessons 写进最终回复，并在交付时于自己的 requests 文件末尾加 `## Lessons` 小节，由引擎维护者收录。

**每个区域代理的完成定义**：
- [ ] 只修改了自己拥有的文件（§2.12）；`scripts/check.mjs` 无违规。
- [ ] `npm run build` 零错误。
- [ ] `node scripts/regions/<id>.mjs` 通过：本区负责的全部 §11 步骤及其 `expect`（标了 `blockedBy` 的步骤除外，且每条都在 requests 文件里有对应条目）；另外对本区每个谜题至少验证 2 条 GDD“错误反馈”（用 `call.try` 与 `expect.feedback`），并验证“前置未满足”时交互不写 flag；本区挡人的门槛用 `walk()` 真走一遍（条件满足前被挡、满足后能过）。
- [ ] 角标不泄题：`lint()` 无同组不一致；`listInteractables()` 里没有 §6.6 硬规则禁止的名字。
- [ ] 本区时辰差异（GDD §4.6）全部实现：用预置切换时辰后进入区域，NPC 站位、灯、雾、后期正确（`regions/<id>.mjs` 断言 NPC 在场/不在场）；灯数恒定（`perf().lights` 在各时辰相同）。
- [ ] 本区全部文档（GDD §7.4）、对话（§8）、提示（§5 各谜题三级提示）、反馈文本逐字到位（放在 `text.ts`/`dialogue.ts`）。
- [ ] 读档复验：在本区任意两个中间步骤后 `reload()`，状态一致、可以继续推进。
- [ ] `node scripts/shots.mjs --area <id>` 产出 ≥ 8 张截图，全部通过亮度验收（§12.4），每张 `perf()` 满足 §13.3。
- [ ] 视觉：符合 GDD §4 的布局坐标、§9.1 调色板、§9.2 后期倾向；中文招牌/文档在截图中清晰可读（CJK 字体可用时）。
- [ ] 环境声按 GDD §9.5 配置（无头测试不验证听感，只验证不报错）。
- [ ] 最终回复列出：`docs/requests/<区域>.md` 里的全部条目与受影响步骤、已知问题。

### 15.5 M3 整合（1 个整合代理）

1. 处理 M2 遗留条目：把 `docs/requests/m2-engine.md` 的结论抄回各区域 requests 文件对应条目的“状态”行；逐条处理仍为 open 或 `deferred-M3` 的条目：修引擎、补 id（先改 GDD §13 再改 `ids.ts`）、必要时改区域代码；在每条下写结论（resolved/wontfix + 理由），去掉 regions 脚本里对应的 `blockedBy`。
2. 解决跨区域问题（flag 顺序、跨区域角色一致性、时辰切换、出入口条件）。
3. 跑通全部测试并做截图评审。

**完成定义**：
- [x] `docs/requests/*.md` 没有 open 条目；各 `regions/*.mjs` 没有 `blockedBy`，全部通过。
- [x] `node scripts/walkthrough.mjs` 与 `--main` 两条路线都通过（同一构建，连续运行两次都通过）；`--shuttle` 变体通过。
- [x] 在 §11 的步骤 12、26、37、45、52 之后分别 `reload()` 再继续，最终仍通过（这些点的下一步都以跨区域或同区域 `goto` 开头，读档回到出生点、模式复位为 explore 不影响后续调用）。
- [x] `save.yin`：通关后“从寅时重来”能进入寅时并再次通关终章；通关后标题菜单没有“继续”。
- [x] `test:input`（含 `--game`）、`test:core`、`smoke`、`check` 通过。
- [ ] 全部区域截图评审：按 GDD §4/§9 核对（每张图写一句结论），问题回派给区域或自己修。（M3：79 张全部过 `shots.mjs` 的亮度/关键对象/预算验收，改动涉及的机位逐张看过；逐张一句话的人工评审留给 M4 的视觉评审视角）
- [x] §13.3 预算全部满足；§14.1 全部满足。
- [x] 提示系统：在 walkthrough 每一步前（当前模式允许 H 时）调用 `hint()`，返回的谜题都是“可用且未完成”的（候选为空时返回土地闲话）；南柯追加提示只在 P14 且 1 ≤ n < 6 时出现。

**M3 完成记录（2026-09-28，整合代理）**：
- 条目：五个区域 requests 文件共 28 条（r1-world 6、r1-finale 6、r2 4、r3 7、r4 5）全部 resolved（无 wontfix），结论写在各条目“状态”行；各文件的 `## Lessons` 去重收进 `AGENTS.md`；`m2-engine.md` 末尾附说明。标注“M3 补写/定稿”的改动：§4.5（进区域先更新阴影图、出生点复位姿势）、§4.9（`lookAtPoint` 迭代到收敛）、§5.1（人偶释放线/点）、§5.2（头支架后让）、§6.3（`openDoc/openJournal`、`E.doc/E.journal`、`photo.record`、`shichen.clock/osdLine`）、§6.6（就近聚焦看墙）、§6.9（函数道具释放）、§11.6（R1 两个代理的约定、`R1_ENV_REFS`）、§12.3（`DebugState.doc`）、§12.4（`--yin`、`roundtrip.mjs`）、§12.5（`ShotDef.temp/highlight`、自由机位藏整个主角、shots.mjs 超时与 perf 文件名）。
- M3 另外查出并修掉的缺陷：CRT 乒乓 feed 在锁步 rAF 只渲染不 step 时采样自己正在写的 RT（smoke 因此失败，`game/crt.ts`/`cctv.ts`）；`m1c.lens_anchor` 自 M2 起失败（开场坐姿带进 dev、镜头点与 eye 差 3.2cm）；R4 大厅缺顶板碰撞体（第三人称相机钻出顶板）；walkthrough `--hints` 的完成条件与 GDD 不符（P2、P12）；`input.mjs --game` 的开场等待与取景器视点前移没算。
- 测试（最终构建；五个 regions 脚本在只差 dev 沙盒自测代码的前一构建上跑，walkthrough 各变体与 roundtrip 在两个构建上都跑过）：`check` 0 违规；`smoke` OK；`core.mjs` 34/34；`input.mjs` 9/9、`--game` 3/3；`regions/r1` 步骤 11 + 用例 25/25、`r1_finale` 26 + 19/19、`r2` 14 + 25/25、`r3` 11 + 12/12、`r4` 8 + 18/18；walkthrough 全程 ×2、`--main` ×2、`--shuttle`、`--reload`（12/26/37/45/52）、`--yin --hints` 全部通过；`roundtrip.mjs` r1 ↔ r2/r2_502/r3/r4 × 5 的 geometries/textures/programs 全部 +0；`shots.mjs` 全部区域 79 张 0 问题。


### 15.6 需求与缺陷的提交流程（`docs/requests/`）

- 文件：M1a 用 `docs/requests/engine-m1a.md`（M1a 变更记录）；M1b 每个 WP 一个文件：`engine-wp1.md`…`engine-wp7.md`（M1a 建好空文件）；M2 每个区域代理一个文件：`r1-world.md`、`r1-finale.md`、`r2.md`、`r3.md`、`r4.md`；M2 引擎维护者的处理结论写在 `m2-engine.md`。每个文件同一时刻只有一个写入者（§2.12），互不冲突。提交者只**追加**，不改别人的条目；并行阶段的代理交付时在自己文件末尾加 `## Lessons` 小节（§15 通用规则）。
- 每条格式：

```md
## 3. <一句话标题>
- 类型：接口需求 | 引擎缺陷 | 缺 id | 文档矛盾
- 现象/需要什么：……（引擎缺陷附复现步骤与 state() 片段）
- 影响：GDD §11 步骤 …；regions 脚本里的 blockedBy
- 临时绕开：……（没有就写“无”）
- 状态：open            ← 整合者处理后改为 resolved（改了哪些文件）/ wontfix（理由）
```

### 15.7 M4 打磨与评审循环

- 内容：音乐与关键音效细化、X1 焚化与 X5 冷迹、镜面与照妖镜的实时版本、设置页全部选项生效、人类玩家时长实测（目标 25–40 分钟）、集显 60fps 调优（动态分辨率阈值）。可砍内容按 GDD §12.4 的顺序处理，砍掉的部分必须保证 walkthrough 仍通过（按 GDD §12.3 的降级方案同时设相应 flag）。
- **评审循环**：每一轮由评审代理从四个视角并行评审（GDD 忠实度与玩法、视觉与截图、性能预算、无障碍与输入），产出按严重度排序的问题清单；整合代理修复，或把某个区域的问题**回派**给对应区域代理。回派的交接点：整合代理先停止修改该区域的目录（含 `scripts/regions/<id>.mjs`、`docs/requests/<区域>.md`），把所有权移交给区域代理（§2.12 M3/M4 列）；区域代理只改这些文件，引擎问题照 M2 写进自己的 requests 文件；区域代理交付后所有权交回整合代理，整合代理在此之前不改该目录。每轮结束跑全量测试（`check`、`smoke`、`test:core`、`test:input`、`walkthrough` 两条路线、`shots`）。直到一轮评审没有 blocker/major 为止。

#### 15.7.1 M4 引擎修复（owner = engine，第一轮评审）的补写

只加不删，已有签名不变（区域代码同时在改）。

- **魂影/回放人身**（`rigs/humanoid.ts`、`fx/ghostMaterials.ts`）：`createGhostMaterial(color?, d?: GhostDetail)`、`createReplayMaterial(d?)` 多一个可选的原件细节
  `{ map, mapAmt, base, baseAmt, solid }`（贴图亮度调制、保留原色相、辨识道具更实）；人偶切到 ghost/replay 时按部件各建一份（人偶私有，随人偶释放；
  共用同一个程序），脸 `mapAmt` 0.95、衣服 0.5、配件 `solid` 1。逐部件材质写深度（`depthWrite = true`、`userData.ghostDepth`，淡到 0.3 以下不写），
  部件 `renderOrder` ≥ `RENDER_ORDER.ghost`/`replay`；渲染器装 `ghostAwareTransparentSort`（`core/render.ts`，`renderer.setTransparentSort`）：同一档里 ghostDepth 的部件排在前面、由近到远画，
  近部件先写深度，挡在后面的部件画不上去，魂影只画最外一层壳。（第一版是每个部件挂一个只写深度的预通道子网格 `MATERIALS.ghostPrepass()`——
  每部件多一次 draw call，回放 look-dev 机位 274 > 预算 250；该材质与 `ReplaySystem` 里 `userData.ghostPrepass` 的分支保留但不再使用。）
- **人身几何**：短袖 = 圆肩外撇的敞口袖筒 + 深色袖口边；上臂/前臂为无端头的圆台，肘、膝各一个同粗填缝小球；手 = 圆角手掌 + 拇指；长袖加袖口环、前臂 0.265s；
  长袍也建大腿（袍料，坐下时袍子搭在腿上）与小腿（坐下时接到鞋上）；长袖的肘部也有同料填缝小球；皮肤 roughness 0.85（`material.userData.skin/shoes` 标记，主角的冷色轮廓光跳过皮肤与鞋）。主角肤色 #A98A74。
  同一关节下同料的几块合成一个网格（前臂 + 肘球〔+ 短袖的手〕、小腿 + 膝球；每个人偶少 4–6 次 draw call，部件名只剩 `forearm*`/`shin*`）。
  鞋（M4 更正）：鞋头在 `zFront`、踝关节落在离鞋头约 72% 处（原来多减了一次 0.72·鞋长，鞋整只在小腿前面 12–38cm）。
  Lathe 轮廓（袖筒、长袍）一律**自下而上**给点（§16 #39；自上而下整件内外翻转，从外面看穿），生成后把 v 翻回“v = 0 在顶上”保持贴图方向。
- **`PlayerModel.watchCamera?(cam)`**（M4 补写，Game 构造时传 `cameras.tp`）：探索模式下第三人称相机离头/身子 < 1.2m 时头和身子 0.2s 内淡到 0.35；
  `mode.tripod` 下轮廓光强度 `PLAYER_RIM_TRIPOD` 0.7。主角根节点 `userData.fadeCapable`（预热头部透明变体）。
- **`CharacterRig.setMaterialMode`**：土地的 'ghost' 忽略（神不是鬼，保持本色 + 土地金描边）；不带颜色的 'ghost' 用角色自己的魂影色（陆师傅 `GHOST_LU`）。
- **照妖镜（实时）**：`crtScreen` 把整张 `tunnel`（tunnelInner）缩到屏幕正中 42%、带暗框，按 `tunnelMix` 混入；`ConsoleSystem` 的混入比例 1.5 秒内淡入到 0.9。
- **UI 分层**：`UI` 每帧把对话框/字幕/读字框高度写到根节点 `--cm-dlg-h`/`--cm-subs-h`/`--cm-read-h`，读字框显示时加 `cm-read-on`；对话框打开时字幕排在对话框上沿之上、
  反馈条在字幕之上、照片卡片抬到对话框之上；取景器里反馈条/教学条在画框上部、“巡夜本上多了一行字”在镜头行下面、读字框贴在倍率条与操作提示行上方；
  取景器底部新增一行常驻操作提示（`.cm-vf-keys`）。`ToastKind` 加 `'item'`：`'item'` 事件（added）在帧末合成一条“得到：…”（左下角）。
  字幕字号设置也作用于反馈条、教学条、对话选项、色彩辅助、文档正文与巡夜本。文档阅读器超出一屏时底部渐隐（盖一条纸色渐变 `.cm-doc-fade`；不用 mask——mask 会把纸也变透明，底下的字幕透上来）+ “▼”，↑↓/PageUp/PageDown/空格翻看（巡夜本同）。
  标题与字卡里的全角标点不跟着字距拉开（`dom.ts punctSpans`）。暂停页有操作说明；标题页的存档损坏提示是标题页自己的一行（auto 或 yin 损坏都提示）；设置页可纯键盘操作、滑块可拖。
- **交互角标**（`ui/hud.ts`）：取景器里按 4:3 画框裁剪（框外不画、OSD 行与倍率条让开）；准星（中心射线）对着的聚焦对象不画角框、名字固定在准星环外下方（中心下 2.5em；`InteractionSystem.focusedByRay`，WP4 内部——就近规则选出的聚焦照常画在对象身上）；
  NPC 的名字画在头顶上方（`NpcSystem.markerAnchor(id, out)`，WP4 内部；交互锚点不变）；探索里未聚焦/没在闪的只画角框、最多最近 4 个；
  名字按优先级贪心避让（相交就推一行，推两次还相交只留角框；聚焦者总显示）；聚焦且可用时名字前带 `E`。
  `InteractionSystem.farFocused`（WP4 内部）：取景器里准星对着射程外 ≤ 4m 的交互物时画灰色角标“（走近点）”，按 E 给“（太远了，走近点。）”、`reason 'out_of_range'`。
- **时辰字卡**：`'shichen'` 仍在 flag 变化的同一帧发；远钟与大字挂起到“栈顶 explore/viewfinder、没有过场/对话/面板/三脚架、不在加载、runner 空闲或等玩家”持续 0.5 秒再播，
  并发新事件 **`'shichen:card' { now }`**（HUD 左下角时辰字样的强调跟它）。`transitioning` 从字卡播出起算。
- **提示**（`PuzzleDef` 可选字段）：`stage?(s) → number`、`stageHints?: ([string,string,string] | undefined)[]`、`minLevel?(s) → 1|2|3`；
  已看级别按 `${id}#${stage}` 记（阶段一变从第 1 级重新给）；冷却中重复同一级时字幕后接 `STRINGS.feedback.hintLater`（第 3 级不接）。
- **回放**：`ReplayPointDef.marker?`（旋涡对象；不给时按 `userData.residueVortex` 在残影点 1.2m 内找）回放期间藏起；`ReplaySegmentDef.focus?: V3`——进入片段时镜头 0.4s 转向焦点
  （缺省 = 片段人影全部关键帧的平均点、胸口高），俯仰至少 −15°；玩家自己动视角（或 aimAt）就停止转向。
  **M4 第 2 轮整合更正**：片段写了 `focus` 时俯仰下限 −40°、“焦点离眼睛水平 < 0.35m 才只抬头不转身”（缺省焦点仍是 −15° / 0.8m），见 §15.7.4。
- **称呼面板** `NamingDef.wrongWho?: SpeakerId`：选错的反馈作为此人的字幕出现。**过场** `await` 步骤的 prompt 每 5 秒重发，等变焦没写 prompt 时默认“滚轮：变焦”。
- **读字**：第一次因为倍率不够读不出时顺带教“滚轮：变焦”（与 `E.tutorial` 同一个去重键）；`STRINGS.feedback.readTooSmall` =“（字太小了，滚轮拉近点。）”。
- **巡夜本**：`JournalMode.enter` 没有 arg（翻开巡夜本本身）时 `JournalSystem.markVisibleSeen()`，合上后不再弹“多了一行字”。文档阅读器的讣告遮挡只画一段斜纹。
- **字幕时长**（只管显示，过场节拍仍按 `sayDuration`）：`TIMING.subReadSecPerChar` 0.17、`subReadMinSec` 2.5、反馈条 `toastReadSecPerChar` 0.15；“……”“——”各算 1 字。
- **重进**：`AreaManager.enter(area, spawn, { restore?: AreaPlaceSnapshot })`、`snapshotPlace()`、`unloadForContextLoss()`（WP1 内部）。画质切换原地重进（回到原位与楼层、
  在 `onEnter` 之后还原区域临时状态）；WebGL 上下文丢失时趁旧 GL 管理器还在同步卸载区域（连同 PMREM 环境贴图缓存），恢复后原地重进并停在暂停页（结局期间照旧）。
- **动态分辨率**：`DynResGovernor`（`core/render.ts`，纯逻辑）——升档也认“帧间隔贴着垂直同步”（平均 ≤ 1.1 × 第 10 百分位间隔、周期 ≤ 17.5ms），升上去 5 秒内又降则下次试升等待加倍；
  `RenderPipeline.holdDynamicResolution(ms)`：建区/加载中与 `areaReady` 后 1 秒不采样。
- **输入与音频**：`Button` 加 `'PageUp' | 'PageDown'`（只经 `onButton` 给 UI）；`InputManager.isHeld(b)`；对话里 Enter = `advance`（附录 A）；指针锁定冷却期内的点击排一次冷却后重试；
  “按住”取景器回到栈顶时右键已松开就退出（只管真按着右键进来的那次；调试 API 的 `vf(true)` 不受影响，锁步里同样生效）。音频解锁直到 AudioContext 真的 running 才摘监听（Esc/修饰键不算手势，另听 click）；暂停时挂起音频、切回标签页时暂停页开着不恢复。
- **碰撞**：Octree 每叶 32 个三角形、最深 8 层（§16 #37）；`CollisionWorld.octreeNodes()`；`perf()` 多一个可选字段 `octreeNodes`（`core.mjs` 断言每区 < 2 万）。
- **高负载测试**：URL `?slow=k`（只在 `test=1` 下，1–20）把页面内的真实时间上限（调试 API 60 秒、`Game.settle` 60 秒、`Game.drive` 90 秒）乘 k；
  harness 的环境变量 `CAMERA_SLOW=k` 给带 `test=1` 的页面加上它，Node 侧超时同乘 k（缺省 1 = 原样；`API_TIMEOUT_MS` 常量不变）。
- **调试**：同区域 `goto` 之后（不在过场里）主角站起来；`aimAt`/`zoom`/`shot()` 之后立即 `ctx.updateViews()`（锁步截图不落后一帧）；`?debug=1` 另挂 `window.__cmGame`（原始 Game，只给截图探针用）。`shot()` 把自动教学（“E：交互”“滚轮：变焦”）记为教过并收起已弹出的，验收截图里不出现。
- **R1 布局**（`areas/r1/layout.ts`）：合影构图——`npcSpots.zhouDoor` (-1.9,0,21.51)、`markPhoto` (-2.37,0,22.28)（离 CH1 约 3.2m、垂直于视轴并排）；GDD §4.1/§4.6/P14/§11 步骤 56 的坐标已由 M4 整合同步（2023 年带子里 03:12 的站位仍是 (-3.4,21.4)）。

#### 15.7.2 M4 第一轮整合记录（2026-09-28，整合代理）

- **本轮修复**：五个修复者并行交付——引擎 37 条（含评审各视角的重复条目合并；另查出并修掉 6 个缺陷，见 §15.7.1）、R1 37 条（34 条修好、3 条部分修复）、R2 3 条、R3 3 条、R4 3 条，全部落地；
  评审问题里没有遗留的 blocker/major。
- **needs-other-owner 条目的处理**：
  - GDD 同步：R1 合影站位（§4.1 地图、§4.6、P14 第 1 步、§11 步骤 56 `bodyGoto(-2.37,22.28)`；§3.8 带子里的站位不动）；P1 门灯后的画外音“（槐树底下有人咳嗽了一声）”；P5 第 2 级提示“拉近了瞅”、铁盒反馈与读信过场的信纸近景；
    P6/P9/P10 对出示错物的拒绝改为带名字的字幕；P9 第 1 级提示、新页⑧“西头地下通道里”（代码同改）；P10 嘀咕句末“……”；P11 `huang_normal` 的括注写法；
    P13 的陆师傅线索“画搁桌上”、出示遗像/脸“搁桌上。”、第 1 级提示、`zoom_high`“（倍率拉回一倍）”；§10.2 补 M4 的 HUD 分层与教学。
  - **分阶段提示落地**（引擎 §15.7.1 的 `stage/stageHints`）：P1（4 段）、P6（2 段）、P12（4 段）、P13（3 段）、P14（3 段），文本在各区域 `text.ts`，GDD §3.12 加“分阶段提示”规则、各谜题加“分阶段提示”清单。
  - R3 称呼面板 `wrongWho: NPC.LU`；空镜相册标题去掉句末“。”（`game/photo.ts`，`caption` 保留，§6.8.4）。
  - 字幕与左下角时辰牌/“得到：……”互压（R4 报）：`.cm-subs` 宽度 `min(92%, 58em, calc(100% - 28em))`，物品提示 `max-width: 11.8em`；取景器里物品提示抬到 `5% + 6.2em`。
  - 《送别》长版：wontfix（`docs/requests/r1-finale.md` #7）；南柯仍按 GDD 用字幕“南柯”（大字卡要同时改 GDD §2.6/§11 步骤 58 与 walkthrough，留给下一轮叙事评审决定）；
    `ReplaySegmentDef.focus` 未逐段填写（引擎缺省 = 片段人影关键帧的平均点，够用）；P11 `huang_normal` 维持括注写法（拆两行要改 walkthrough 步骤 43）。
- **整合时查出并修掉的回归**：三张验收截图的高光像素贴着 0.5% 抖（`shot.r1.booth_inside` 0.50%、`shot.r2_502.entry` 0.49%、`shot.r4.entry_zi` 0.46%；M4 人身与取景器按键行让亮点少了一点），
  各自 `highlight: 0.7` 并写明理由；`shot.r1.fin_door_mark` 的机位还对着老周的旧站位（离他 2m、粉笔叉压在腿上），改到院子里 (1.0,1.85,19.2)。
- **测试**（最终构建，同一份 dist 拷贝；负载 10–22，input 两项单独先跑）：`npm run build` 通过；`check` 0 违规（9 条 dev 沙盒警告）；`input.mjs` 9/9（137s）、`--game` 3/3（277s）；`smoke` OK（37s）；
  `core.mjs` 34/34（837s）；walkthrough 全程 58/58（245s）、`--main` 50 + 可选跳过 8（190s）、`--reload`（12/26/37/45/52 五次复验）58/58（270s）、`--yin --hints` 58 + 从寅时重来 12 步 + 南柯追加提示 3 次（409s）；
  `roundtrip.mjs` r1 ↔ r2/r2_502/r3/r4 × 5 的 geometries/textures/programs 全部 +0（387s）；`shots.mjs` 全部区域 80 张 0 问题（1758s）。
  另在只差截图配置与字幕 CSS 的前一构建上跑了 `regions/r3`（步骤 11 + 用例 14/14）与 `regions/r1_finale`（步骤 26 + 用例 20/20），并用探针逐阶段核对了 P1/P6/P12/P13/P14 的分阶段提示文本、截图核对了字幕/物品提示/时辰牌不再互压。

#### 15.7.3 M4 引擎修复（owner = engine，第二轮评审）的补写

只加不删，已有签名不变（区域代码同时在改）。回归自测：`src/areas/dev/m4.ts` + `scripts/selftest/m4.mjs`（`core.mjs` 自动发现 `m4.mjs`）、
`wp1.mjs` 的动态分辨率抖动用例、`wp4` 的挑选器顺序。

- **教学条与“新消息”的挂起**（`ui/ui.ts`，与 §15.7.1 时辰字卡同一套“风平浪静”判据）：
  - 新增 **`UI.tutorial(text)`**：教学条等“栈顶 explore/viewfinder、栈上没有过场/对话/面板/相册/巡夜本/三脚架/暂停、不在加载、runner 空闲或只在等玩家”
    持续 0.5 秒（`UI.calmFor`）再显示；过场/对话一开始，刚弹出、还剩 1 秒以上的教学条收回重新排队。`E.tutorial`、第一次聚焦的“E：交互”
    （`InteractionSystem.teachInteract` 只在 `calmFor ≥ 0.5` 时才算“第一次聚焦”）、第一次读不清的“滚轮：变焦”都走它；过场 `await` 的 prompt 照旧立即显示。
    原来新游戏进区域的淡入里就聚焦到巡夜本，“E：交互”盖在开场片名卡上、玩家拿到控制前就过期了。
  - “得到：……”（`'item'` 事件）与 `UI.toast(text, 'page', { onShow })`（巡夜本新页；`onShow` 在真正显示时调，新页主动机跟着延后）在栈上有过场/对话/巡夜本/暂停、
    加载中或 runner 忙（不在等玩家）时排队，结束 0.2 秒后合成显示；面板不拦（密码锁错码给的新页照常）。flag 与物品照旧先写，`'feedback'` 事件照旧在调用时发。
  - `UI.dismiss(text)`（已显示的淡出、排队的撤掉）、`UI.resetHeld()`（`Game.resetRun` 与 `shot()` 调用，上一局排队的不带进这一局）。
- **提示字幕**：`UI.subtitle(text, who?, dur?, o?: { kind?: 'hint' })`、`speak(game, text, who, dur, kind?)`：H 的提示带 `'hint'`，新的替换屏幕上旧的提示行（连按 H 不叠两行）。
  `speak` 显式给了 `dur` 时显示时长也不短于 `readSec(text)`（过场节拍仍按 `sayDuration`）。
- **暂停/菜单与输入**（§4.6、附录 A）：对话与过场里 Esc = 暂停菜单（KEYMAP 两行加 `Escape → back`，`DialogueMode`/`CutsceneMode` 调 `requestPause()`）；
  菜单页开着时按下的键（Esc 除外）只给 UI 不入队；`ExploreMode` 在没有区域或标题页开着时只认 `back`；键盘自动重复只放行方向键/PageUp/PageDown 且只通知监听者；
  指针锁定从没成功又连续 2 次被拒 → `InputManager.dragFallback`（拖拽转视角、收起“点击继续”、提示 `STRINGS.boot.lockFallback`）。
- **标题菜单**：有可覆盖的进度（`save.auto` 读得出）时“新游戏”“从寅时重来”要按两次（第一次换成 `STRINGS.menu.confirmOverwrite`，3 秒内对同一项再按才执行；
  只管玩家的点击/回车，`menus.select()` 本身照旧直接执行）；只有 `save.yin` 坏时标题页说 `STRINGS.save.yinCorrupted`。
- **存档写入失败**：`SaveSystem.writeSlot` 两次 `setItem` 都失败时提示一次 `STRINGS.save.writeFailed`（系统反馈条，一个页面一次；存储被禁用时进第一个区域就会提示）。
- **WebGL 上下文丢失**：`FadeLayer.setLostOverlay(text | null)` 常驻遮罩（取代 4 秒的反馈条）；丢失后页面可见的真实时间超过 15 秒还没恢复 → `STRINGS.boot.contextDead`（请刷新）；恢复后撤掉。
- **暂停不渲染**：栈顶 `mode.pause` 且进暂停后已渲染 2 帧，`Game.step` 不再调 `pipeline.render`（画布保留最后一帧；期间 `holdDynamicResolution`）；resize、设置改动、上下文恢复时补画一帧。
- **动态分辨率**：帧间隔按 rAF 时间戳（`RenderPipeline.frameStamp`，§13.2）。
- **聚焦**（`InteractionSystem.computeFocus`）：中心射线先碰到射程外（取景器里 ≤ 射程 + 4m）的对象就停在它身上——`focused = null`、`farFocused` = 它（灰色“（走近点）”），
  不再穿过它聚焦后面射程内的东西，也不再退回就近规则（门厅里对着 3.2m 外的王奶奶，准星下原来写的是她身后的“楼梯”）。
- **交互角标**（`ui/hud.ts`）：名字标签按实测尺寸（`offsetWidth/Height`，按文字与样式缓存）避让；取景器里先左右各让 0.6 个标签宽、再往下，推不开的非聚焦标签只留角框；
  取景器里读字框、常驻按键行、倍率条也算障碍，贴底的角框让出 5.6em（按键行放大后原来的 3.5em 不够）。**更正**：推开用的 `setStyle(tag, 'marginTop', …)` 走 `style.setProperty`，
  camelCase 属性名静默无效——第 1 轮的“推一行”从没生效过，改成 `'margin-top'` 等 kebab-case（`ui/dom.ts setStyle` 的注释写明）。
  取景器里准星对着的聚焦名：缺省在准星下方，读字框显示时在上方、倍率 ≥ 3× 时在右侧 2.2em（半透明）；**`InteractableDef.vfLabel?: 'below' | 'above' | 'right'`** 可指定（取件格这类编号印在下面的用 `'above'`）。
- **UI 分层**（`ui/styles.ts`）：录像机/监控台 deck 开着、没举取景器时 `.cm-deck-open`——字幕层升到面板之上、字幕排在 deck 上沿之上（`--cm-deck-h` 每帧写实测高度）、
  反馈条挪到上部、物品提示抬到 deck 之上；暂停流程（`.cm-pause-on`）里字幕、反馈条、物品提示、新页提示隐藏，设置面板背景不透明；拍照卡片显示时（`.cm-photo-on`）字幕收窄不压卡片；
  字幕宽度至少 60%（窄窗口不再挤成竖条），`max-width: 900px` 时字幕整体上移；取景器常驻按键行 0.9em、85% 不透明、键帽不小于 11px。
- **挑选器**（`game/modes/album.ts` 新增 **`albumLists(game, arg)`**，AlbumMode 与 AlbumView 共用）：出示/使用时物品“未用的、新得的在前”，已用的沉底变暗；照片“关键照片、新拍的在前”，
  空镜最后，目标不收任意照片时（只有 accept 为空、靠 `any` 收一切的——火盆——才收）不列空镜；初始光标：使用 → 第一件未用的物品，出示 → 最新的关键照片；物品栏超出一屏时底部渐隐 + “▼”，键盘光标滚到可见。浏览照旧（拍摄顺序、获得顺序）。
- **镜中字**（`game/read.ts`）：站偏（虚像交点在镜盘外）时，准星射线落在镜盘内也给 `notInMirror`（原来只有准星对着镜外的虚像时才给）。
- **过场**：`CutStep` 新增 **`{ hurry: number | null }`**——从这一步起玩家按住空格时计时步骤按 ×hurry 推进（片尾字幕这类不可跳过、但允许快进的段落；松开恢复原速）。
- **回放**：`REPLAY_FRAG` 的扫描线改成屏幕空间（3 像素一周期、只压暗 10%）、整行闪断按 6 像素屏幕行、概率 1.5%，都不再调制不透明度（原来按世界高度每 4.5cm 一条、连 alpha 一起乘，人读成一摞摞圆盘）；
  菲涅尔 1.1 → 1.4。人偶的回放部件：衣服贴图 0.85、原色 0.45、不透明度 0.75（`GhostDetail.opacity?` 新增）。回放人群（`rigs/crowd.ts`）换成圆一点的人形（圆筒躯干与四肢、头发帽、鞋），
  UV 指向 5 格调色板（肤色、头发、上衣、裤子、鞋），三套衣服配色分三个 InstancedMesh（第一个是返回的 `mesh`，另两个是它的子节点；非回放的 look 仍是一个）。
  回放暂停时 CameraFxPass 的 VHS 跟踪噪声条停在画面底部 6%（uniform **`uVhsPaused`**，`PostPipeline.vhsPaused` 由 `ReplaySystem.update` 每帧写）。
- **人身**（`rigs/humanoid.ts`）：`head: 'human'` 的头 = 头球 + 头发壳（沿贴图发际线；short/long 盖到发际线，long 在赤道以下直直垂到颈后，bald 只剩后脑发环）+ 两只耳朵（长发不做）+ 鼻子，
  合成一个网格、共用脸贴图（UV 指向贴图上的头发区与肤色），0 次额外 draw call；脸贴图的眼睛 ×1.3、眉眼嘴笔画 ×1.6，加上眼皮线；长袖上臂、肘球、前臂顶端同粗（armR × 1.15）。
  魂影/回放：脸（连头发耳鼻）贴图调制 1.0、头部 `uSolid` 0.35；配件可用 `mesh.userData.ghostSolid` 自定实度。`HumanoidStyle.ghost?: { baseAmt?, tint? }`（陆师傅：原色 0.2、魂色 `#F4DEBE`）。
  新增 `torsoSurface(h, u, y)`（躯干表面点/法线/切线）与 `accessories.zhongshanDetails(h, color)`（中山装立领、5 粒扣、四个口袋盖，陆师傅与黄三爷的人形/黄鼬形都挂）；老花镜往前挪到脸面上。
- **纸扎门童**（`rigs/paper.ts`）：竹竿半径 0.014k、颜色 `#6B4E2A`；灯笼挂在竿尖正下方，中间 0.04k 的细绳。
- **残影旋涡**（`kit/residue.ts`）：点大小上限 4px；离镜头近的点淡下去；镜头离柱子“看上去” < 2.5m（按取景器倍率折算）时整柱压到 40%；动画时间改用 `FX_TIME`（游戏时间，锁步截图可复现）。
- **截图验收**（`shots.mjs`、harness `lumaStats().coreP995`）：高光判据改为 3×3 盒式模糊后亮度的第 99.5 百分位 ≥ `highlight` − 0.08（缺省 0.72）；`ShotDef.highlight` 的语义不变。
- **STRINGS**：`boot.contextDead`、`boot.lockFallback`、`save.yinCorrupted`、`save.writeFailed`、`menu.confirmOverwrite`；暂停页操作说明的 Esc 一行写成“暂停（对话与过场中也可）；面板与取景器里是离开”。
- **测试**：`input.mjs` 沙盒多一例（对话里 Esc 暂停、暂停页 Enter 不漏给对话与密码锁）；`--game` 的 `walkToward` 按住 W 的时长改按游戏时间（高负载 2fps 时按真实时间的短按可能整个落在两帧之间，偶发“走不到”）；
  `wp5` 读字多一例（站偏 0.6m、准星对着镜子中心 → `notInMirror`）；`walkthrough.mjs` 步骤 58 的题名“南柯”同时认字幕与大字卡（R1-finale 本轮把它改成与片名同一种大字卡，`ui.fade.title` 不发 `'feedback'`，页面上用 MutationObserver 记下大字卡出现过的文字）；
  `src/areas/dev/m4.ts` 另有不在 `PAGE_TESTS` 里的 `m4.lineup`（look-dev 角落摆一排人偶，截图探针用）。

#### 15.7.4 M4 第二轮整合记录（2026-09-29，整合代理）

- **本轮评审**：视觉、玩法、叙事、健壮性四位评审共 72 条（27 major、45 minor、0 blocker）；按 owner：engine 35（11 major）、R1/R1-finale 22（9）、R2/R2_502 8（5）、R3 4（1）、R4 3（1）。
- **修复者交付**：engine 35 条全部处理（节奏一条只做了引擎部分，取件格名字位置与读信时长的区域部分交给区域）；R1 22 条里 21 条修好、门口倒带一条部分修好（缺引擎）；R2 8 条全修；R3 3 条修好、P6 路牌一半归 R1-world；
  R4 2 条修好、P10 一条部分修好（缺引擎）。
- **整合时补的引擎改动**（只加不删）：
  - **回放进段转向**（`game/replay.ts beginTurn`）：片段写了 `focus` 时俯仰下限 −40°（`TURN_MIN_PITCH_FOCUS`），“焦点离眼睛水平 < 0.35m 才只抬头不转身”（`NEAR_FOCUS_EXPLICIT`）；缺省焦点仍是 −15° / 0.8m。
    R4 的“贴着箱子 (3.8,0.2) 按 R 不动鼠标直接拍到 `ph.huang_hides`”用例去掉 `blockedBy`。R1 门口倒带的 `FRONT` 试过挪回带子里的 (-3.4,21.4)：
    从步骤 50 的站位按 R 他离镜头 0.63m，雪花脑袋占满取景器（`test-artifacts/work/m4r2-int/booth/`），所以仍站在 `npcSpots.zhouDoor`（GDD P12 第 5 步写明）。
  - **`GameApi.player.look?(yaw, pitch)`**（§6 GameApi 签名）：只改视角（俯仰按第三人称范围钳制），不转身体、不动位置。R1 开场在巡夜本特写那一镜里调 `look(190, −26)`，
    拉回第三人称时发光的本子露在头的左边（第 2 轮评审 #3 的 R1 补充）。`{cam:'player'}` 取的是执行那一刻的第三人称位姿，所以要提前至少一帧调。
  - **`kit/canvas.ts wrapText` 避头尾**：句读、后括号、后引号不打头（超宽也挂在本行末），前括号、前引号不留在行末（与 R3 守则的 `wrapKinsoku` 同一套字表）；讣告、小区简介、文档贴图都走它。
- **needs-other-owner 与节奏条目的处理**（整合代理拥有全部文件）：
  - R1-world：东口“老街 →”、西口“← 人民路”两块路牌改成暖白字、字面自发光 0.6（`boardSign({ selfLit })`，`build/common.ts` 新增可选字段）。
  - 节奏（评审 #25）：土地交代任务 5 框压成 3 框（丑时以前再找他另有一句 `TUDI.idle`）；老周馄饨独白第 3、4 框各删约三分之一，“照相摄魂”只留一处；陆师傅本相后 94 字那一框拆成两框
    （“带子让街道收了，后来跟着废品走了”是 P10 的线索，保留）；R2 楼梯井 `r2.wang_done` 之后三楼以上多“下到一楼”；片尾照片段 `{ hurry: 3 }`；R2_502 读信近景第一句 5 → 8 秒、两句之间 `{ wait: 0.6 }`。
    真人首通计时仍未做（本机只有无头浏览器）。
  - R3：取件格 `r3.hole_*` 与 `r3.pickup_grid` 设 `vfLabel: 'above'`。R4：`dlg.r4.huang_ir` 的选项节点带上他问的那句（同 R1 老周的 c1/c2）。
  - 截图：`shot.r1.booth_inside`、`shot.r2_502.entry`、`shot.r4.entry_zi` 撤掉第 1 轮放宽的 `highlight: 0.7`（新判据实测 0.775 / 0.767 / 0.86）。
  - 测试脚本：walkthrough 步骤 25（抠开铁盒即翻开建国的信，断言后 `back()`）、43（第一行是旁白“半天没出声”）、56（确认正文按 0 / 1–5 / 6 张三种写法，`confirmWant` 从 walkthrough 导出）；
    删掉 `regions/r2.mjs` 步骤 25、`regions/r1_finale.mjs` 步骤 56 的临时覆盖（r1_finale 保留步骤 58 的片名断言、r4 保留步骤 43 的两行断言）；`regions/r2.mjs` 加两条楼梯井“下到一楼”用例。
  - GDD 同步：§2.2/§2.5/§2.6/§2.7、§3.6（进段转向）、§3.8（05:12 字幕）、§3.12、§3.13、§4.2–§4.4、P2/P3/P4/P5/P6/P10/P11/P12/P13/P14、§7.3、§8.1/§8.5/§8.7/§8.8/§8.9、§10.1–§10.3、§11 步骤 25/43/56/58、§13.6、§13.12。
  - 没做：R2 建议的“引擎对摄像头头壳漫反射软截断”（R2 已不需要，可选）；回放人影按关键帧换 variant（R1 门口倒带 t ≥ 9.5 摘帽，引擎不支持，维持戴帽）。
- **测试**（最终构建，同一份 dist 拷贝；input 两项先在空闲机器上单独跑，其余两路并行，负载 10–15）：`npm run build` 通过；`check` 0 违规（9 条 dev 沙盒警告，27s）；`input.mjs` 10/10（155s）、`--game` 3/3（187s）；
  `smoke` OK（27s）；`core.mjs` 35/35（2140s，wp7 等第二个浏览器名额约 20 分钟）；walkthrough 全程 58/58（220s）、`--main` 50 + 可选跳过 8（208s）、`--reload` 58/58（231s）、
  `--yin --hints` 58 + 从寅时重来 12 步 + 南柯追加提示 3 次（317s）；`roundtrip.mjs` r1 ↔ r2/r2_502/r3/r4 × 5 全部 +0（300s）；`shots.mjs` 全部区域 83 张 0 问题（1869s）；
  另跑区域测试：`regions/r4` 步骤 8 + 用例 23/23（原 blocked 的一条通过，918s）、`r2` 14 + 32/32（839s）、`r1` 11 + 27/27（576s）、`r1_finale` 26 + 24/24（703s）、`r3` 11 + 16/16（390s）。
  探针截图（开场收尾构图、东口路牌、门口倒带站位）在 `test-artifacts/work/m4r2-int/{intro,sign,booth}/`。
- **遗留**（下一轮评审复核）：真人首通计时（目标 25–40 分钟）；R3 暗房贴西墙斜瞄、站门洞里、晾片绳北侧回头这三类第三人称聚焦边角（引擎 `TP_MIN` 与 −35° 俯仰下限的同类问题，影棚坐凳、取件格最下几行也有）；
  R2_502 厨房西北角斜瞄灶台会选到左下砖；引擎三项只能在真浏览器验证（指针锁定降级为拖拽、方向键/PageDown 自动重复、暂停页停渲染）；拍照卡片与长字幕不互压只算过没截图。

---

## 16. three r186 踩坑清单（均已对照 `node_modules/three` 源码或 `@types/three` 核实）

| # | 坑 | 正确做法 |
|---|---|---|
| 1 | `THREE.Clock` 自 r183 弃用，构造时 `console.warn`（`src/core/Clock.js`） | 用核心包的 `THREE.Timer`：`timer.connect(document)`（页面隐藏时不累积），每帧先 `timer.update(timestamp)` 再 `getDelta()`。**`three/addons/misc/Timer.js` 已不存在**，不要从 addons 导入 |
| 2 | addons 导入路径 | 一律 `three/addons/<子目录>/<文件>.js`（带 `.js`）：`postprocessing/EffectComposer.js`、`postprocessing/RenderPass.js`、`postprocessing/UnrealBloomPass.js`、`postprocessing/ShaderPass.js`、`environments/RoomEnvironment.js`、`math/Octree.js`、`math/Capsule.js`、`geometries/RoundedBoxGeometry.js`、`utils/BufferGeometryUtils.js`。已在本仓库用 TS 7 类型检查通过 |
| 3 | `PCFSoftShadowMap` 在 r186 标记弃用，使用时警告并退回 `PCFShadowMap`（`WebGLShadowMap.js`） | 直接用 `THREE.PCFShadowMap` |
| 4 | 灯光单位：legacy 灯光模式已删除（无 `useLegacyLights`/`physicallyCorrectLights`）。点光/聚光强度是坎德拉，`decay` 默认 2，`distance` 是平滑截断窗口 `(1-(d/cutoff)^4)^2`；漫反射 `BRDF_Lambert = albedo/π`；环境光/半球光强度直接作为辐照度 | GDD 的“强度”当**设计强度**，经 `designLight()` 按 `design × LIGHT_SCALE.point × distance²` 转换（§10.3，M1c look-dev 冻结） |
| 5 | 色调映射与输出色彩空间只在渲染到屏幕（RT 为 null）时施加；渲染进 RT 时输出线性工作空间（`WebGLPrograms.js`） | 本项目不用 `OutputPass`：最后的 `CameraFxPass`（`toneMapped:false`）自己 include `tonemapping_pars_fragment` 做 Neutral 映射、用片元前缀里现成的 `sRGBTransferOETF` 做 sRGB 编码（§8.1；r186 已给非 Raw 的 ShaderMaterial 无条件内联 `colorspace_pars_fragment`，再 include 会重复定义），`renderer.toneMapping = NoToneMapping`。RT 贴图保持默认 `NoColorSpace`，**不要**设成 sRGB |
| 6 | `OutputPass` 每帧读 `renderer.toneMapping`/`outputColorSpace`，变化时重建 defines 并重编译；而且它是一个额外的全屏 pass | 不用 OutputPass；红外切换只改 `CameraFxPass` 的 uniform 分支，不动 `renderer.toneMapping`，不触发重编译 |
| 7 | `CanvasTexture`/`Texture` 默认 `colorSpace = NoColorSpace`（按线性解释，颜色会发灰发亮） | 颜色贴图设 `texture.colorSpace = THREE.SRGBColorSpace`；重绘后 `needsUpdate = true` |
| 8 | `ColorManagement.enabled` 默认 true：`new Color(0xFF9A3C)`、`material.color.set('#...')` 按 sRGB 解释并转成线性 | ShaderMaterial 的颜色 uniform 用 `new THREE.Color(hex)` 传入（已转线性）；GLSL 里手写的颜色常量是线性值 |
| 9 | `Raycaster` **不检查 `visible`**；只测试 `object.layers.test(raycaster.layers)`（默认只有第 0 层），且父对象不通过图层测试时仍会遍历子对象（`Raycaster.js` 的 `intersect()`） | 射线结果要过滤“自身或祖先不可见”的对象；测阴物时 `raycaster.layers.enable(LAYER.yin)`；碰撞体不放进场景 |
| 10 | `Object3D.layers` 不继承，子对象各自有图层；WebGLRenderer 对**灯光**也做 `layers.test(camera.layers)` | 用 `setLayerRecursive()`（它跳过灯）；所有灯 `light.layers.enableAll()` |
| 11 | `Octree.fromGraphNode(group)`：用 `traverse`（包含不可见网格）、按 `octree.layers` 过滤（默认第 0 层）、对 `InstancedMesh` 只按 `matrixWorld` 加入一份基础几何（忽略实例矩阵）、索引几何会临时 `toNonIndexed()` | 碰撞体用普通 Mesh（实例要展开）；放在不加入场景的独立 Group；重建时 `new Octree()` |
| 12 | `Octree.capsuleIntersect()` 返回 `{normal, depth} \| false`；`rayIntersect()` 返回 `{distance, triangle, position} \| false`（字段叫 `position` 不叫 `point`） | 按实际字段写，判断 `!== false` |
| 13 | `InstancedMesh.boundingSphere` 首次渲染时惰性计算一次，之后不自动更新（`WebGLRenderer.js`/`Frustum.js`） | 改完实例矩阵后调 `instanceMatrix.needsUpdate = true` **和** `computeBoundingSphere()`，否则视锥剔除出错 |
| 14 | 场景中“参与渲染的灯的数量”变化（增删灯、灯或其**祖先**的 `visible` 切换——`projectObject` 遇到 `visible===false` 直接返回，不再遍历子孙）会导致所有受光材质重编译，造成卡顿；强度为 0 的灯照样参与着色 | 灯数量在区域生命周期内固定，开关用 `intensity = 0`；灯只挂在 root/lightsRoot 下（§4.7）；预算按总数算 |
| 15 | `renderer.info.autoReset` 默认 true，**每次** `render()` 都清零；用了 EffectComposer 与多个 RT 后读到的只是最后一个 Pass | `renderer.info.autoReset = false`，每帧开头 `renderer.info.reset()`；主场景 draw call 在 RenderPass 前后取差值 |
| 16 | `EffectComposer.render(deltaTime)` 省略参数时用内部 `Timer` 计时 | 显式传入游戏 dt |
| 17 | `UnrealBloomPass(resolution, strength, radius, threshold)` 内部第一级就是 `resolution/2` | 传完整尺寸即是“半分辨率 Bloom”，不要再除以 2 |
| 18 | `EffectComposer` 默认 RT 是 `HalfFloatType`，不带 MSAA | 需要抗锯齿时自建 `WebGLRenderTarget(w, h, { type: HalfFloatType, samples: 4 })` 传给构造函数；本项目默认不开（颗粒与扫描线会掩盖锯齿） |
| 19 | `renderer.compileAsync(scene, camera)` 可用，但只编译调用那一刻场景里已有的材质变体；之后才创建的对象、`onBeforeCompile`/instanceColor 置空/红外替换产生的变体不在其中 | 区域加载完、淡入前调用；另用 `fx/warmup.ts` 往 1×1 RT 渲一帧各变体预热（§13.1） |
| 20 | `PerspectiveCamera.zoom` 会缩放有效 FOV（`getEffectiveFOV()`），改后必须 `updateProjectionMatrix()` | 取景器变焦直接用 `camera.zoom`；拍照判定用投影矩阵，自动包含变焦 |
| 21 | `CapsuleGeometry(radius, height, capSegments, radialSegments, heightSegments)` 的 `height` 是**中段长度**，总高 = height + 2·radius | 人偶肢体按此计算 |
| 22 | 合并几何的函数叫 `mergeGeometries`（旧名 `mergeBufferGeometries` 已删），要求所有几何属性集合一致、同为索引或同为非索引 | 合并前统一 `toNonIndexed()` 或都保持索引 |
| 23 | `ShaderMaterial` 设 `fog: true` 时必须自带雾 uniform（`UniformsLib.fog`）与 `fog_pars_*`/`fog_*` chunk | 需要雾的自定义材质用 `UniformsUtils.merge([UniformsLib.fog, …])`；雨、魂影按需 |
| 24 | `scene.overrideMaterial` 对所有物体用同一材质、同一组 uniform | 红外按物体温度渲染不能用它，改用 §6.8.2 的逐帧材质替换 |
| 25 | `Line`/`LineSegments` 的 `linewidth` 在 WebGL 下恒为 1 像素，DPR>1 时几乎看不见 | 雨用实例化的面向相机细长四边形（§10.2）；白胡子这类近景细节可用 1 像素线 |
| 26 | `Object3D.traverse` 包含不可见子对象；只遍历可见的用 `traverseVisible` | 红外替换、角标、拍照判定都只处理可见对象 |
| 27 | 读取 WebGL canvas 像素（`drawImage(renderer.domElement)`）只在渲染后的同一任务内可靠（未开 `preserveDrawingBuffer`） | 缩略图在 `renderNow()` 之后立即读取 |
| 28 | vite 8 基于 rolldown | 构建配置用 `build.rolldownOptions`；超过 500 kB 的 chunk 警告不影响构建 |
| 29 | TS 7 原生 `tsc` + `isolatedModules` | 纯类型导入用 `import type`；`noUnusedParameters` 下未用参数加 `_` 前缀 |
| 30 | 指针锁定状态下按 Esc 由浏览器处理（先退出锁定，页面通常收不到这次 keydown）；用户用 Esc 退出后约 1 秒内 `requestPointerLock()` 会被拒绝，返回的 Promise 未 catch 会变成控制台报错 | 按 §4.6 的策略表：UI 模式主动 `exitPointerLock()`；视角模式意外解锁 → 暂停 + “点击继续”；`requestPointerLock().catch(() => {})`，失败 1 秒后在下一次点击重试；右键 `contextmenu` 要 `preventDefault`，滚轮监听用 `{ passive: false }` |
| 31 | 平面镜：自己用“镜像主相机 + 普通 UV 贴图 + `uv.x = 1-uv.x`”会把整幅画面缩进镜面、翻转两次，而且近平面不与镜面重合会漏进镜后场景 | 照搬 `examples/jsm/objects/Reflector.js`（约 130–250 行）的反射相机、`textureMatrix` + `texture2DProj` 与斜投影近裁面，不翻 UV，渲染期间隐藏镜面自身（§6.11） |
| 32 | 相机看得见一块正在采样同一张 RT 的屏幕时就是 GL feedback loop；r186 只在 transmission 那一处做了防护，Chrome 只报 warning（`GL_INVALID_OPERATION`） | 乒乓两张 RT 或渲染该 feed 时隐藏屏幕（§6.11 feeds 规则）；harness 把这类 warning 判失败（§12.4） |
| 33 | `WebGLProgram` 在 `instancingColor` 时给片元定义 `USE_COLOR`，`color_fragment` 执行 `diffuseColor *= vColor`，替换材质也会被实例颜色染色 | 红外替换期间暂存并置空 `instanceColor`（§6.8.2） |
| 34 | 没有 `scene.environment` 时 `MeshStandardMaterial` 的金属面在点光下几乎全黑 | 每区一张 PMREM 环境贴图（M1c look-dev 起是 `fx/environment.ts` 自建的夜景环境场景，不再用 `RoomEnvironment`，§8.3） |
| 35 | `WebGLPrograms.getParameters` 的 `outputColorSpace` 取自**当前渲染目标**：null → `renderer.outputColorSpace`（sRGB），任何非 XR 的 RT → 线性工作空间；它是程序缓存键的一部分，所以 `compile()`/`compileAsync()` 在目标为 null 时编的是“画到屏幕”的变体。`compileAsync` 内部先同步调用 `compile()` | 预编译前 `setRenderTarget(1×1 线性 RT)`、调用后立刻还原（M1d `precompile()`，§13.1）；画到屏幕的 pass（CameraFxPass）预热时也画到屏幕 |
| 36 | `material.transparent` 参与程序参数（`opaque`/混合相关），淡入淡出时切 `transparent` 会现场编译新程序 | 会淡出的人身在预热时把材质临时设成透明画一遍（M1d，§8.5） |
| 37 | `Octree.split()` 用 `new Octree(box)` 建子树：子树的 `trianglesPerLeaf`/`maxLevel` 是构造函数默认值（8/16），只改根节点只管得了第一层；跨越多个格子的大三角形被复制进每个相交的子树，几十个盒子也能细分出二十万个节点 | 包一层 `Octree.prototype.split`，分裂前把参数写成项目的值（M4：每叶 32、最深 8，`core/collision.ts`） |
| 38 | 透明材质的“深度预通道”若放在不透明队列（`transparent:false`、`colorWrite:false`），会按由近到远先于背后的墙写深度，把墙挖出黑洞 | 预通道材质设 `transparent:true`（进透明队列、排在全部不透明物体之后），`renderOrder` 比它要遮的透明网格小 1（M4，`fx/ghostMaterials.ts` `ghostPrepassMaterial`）；更省的做法：透明部件自己写深度、用 `renderer.setTransparentSort` 让它们由近到远画（M4 最终采用，`ghostAwareTransparentSort`），不多 draw call |
| 39 | `LatheGeometry` 的法线与绕序由轮廓点的顺序决定（`normal = (dy, -dx)`，索引 `a,b,d / c,d,b`）：y **递增**时朝外；y 递减时整件内外翻转——FrontSide 下从外面看到的是背面的内壁，开口的形状（袖筒、长袍）会被看穿，里面的胳膊、小腿露出来 | 轮廓点自下而上给；要保持原来的贴图方向就在生成后把 uv.y 翻成 1 − v（M4，`rigs/humanoid.ts` `flipLatheV`） |

---

## 17. 附录

### 附录 A：模式 × 动作矩阵（`KEYMAP` 与 `ModeHandler.handle` 的依据，照 GDD §10.1、§3.4）

| 动作（默认键） | explore | viewfinder | replay | panel_vcr | panel_console | panel_code | panel_naming | dialogue | album（浏览 / 动作菜单 / 挑选器） | journal | tripod | cutscene | pause |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `interact`（E） | 交互 | 交互（含阴物）；叠在面板上时 `pass` 给面板 = 离开面板 | 交互 | 离开面板 | 离开面板 | — | — | 推进 | — | — | 定时前取消 | — | — |
| `shutter`（左键） | — | 拍照 | 拍照 | 叠加取景器时拍照 | 叠加取景器时拍照 | — | 点选（UI） | 点选项（UI） | 挑选器：确认（UI 发 `pick`） | — | 开始定时 | `await:'shutter'` | — |
| `vf`（右键） | 进入取景器 | 退出取景器（叠在面板上时 = 回到面板） | 退出回放与取景器 | 叠加取景器 | 叠加取景器 | — | — | — | — | — | — | — | — |
| `lens`（Q） | — | 常光/红外 | 常光/红外 | — | — | — | — | — | — | — | — | — | — |
| `zoom`（滚轮） | — | 变焦 | 变焦 | 叠加时变焦 | 叠加时变焦 | → `wheel` 拨转轮 | — | — | — | — | — | `await:'zoom'` | — |
| `rewind`（R） | — | 倒带（近残影点；叠在面板上时不响应） | 切更早一段 | — | — | — | — | — | — | — | — | — | — |
| `present`（F） | — | — | 回到现在 | — | — | — | — | — | — | — | — | — | — |
| `play`（空格） | — | — | 播放/暂停 | 播放/暂停 | — | — | — | = `advance` | — | — | — | 重看时按一下即跳过（M1c，§6.14） | — |
| `seekRel` / `shuttle`（Z/C） | — | — | ∓5 秒 | 按住倒退/快进 ×16 | — | — | — | — | — | — | — | — | — |
| `stepSec`（逗号/句号） | — | — | 暂停时逐秒 | 逐秒 | — | — | — | — | — | — | — | — | — |
| `index`（[ ]） | — | — | — | 上/下一个索引点 | — | — | — | — | — | — | — | — | — |
| `digit`（0–9） | — | — | — | — | 1–5 切频道 | 输入数字 | 1–6 → `choose` | 1–4 → `choose` | 动作菜单：1 交谈/查看、2 出示…/使用… | — | — | — | — |
| `nav`（方向键） | — | — | — | — | — | — | — | — | 浏览/挑选器：移动选中格 | — | — | — | — |
| `confirm` / `erase`（Enter/Backspace） | — | — | — | — | — | 确认 / 删除 | — | Enter = `advance`（M4 补写） | 挑选器：Enter 确认 | — | — | — | — |
| `album`（Tab） | 打开 | 打开 | — | — | — | — | — | — | 浏览：关闭 | 切到相册 | — | — | — |
| `journal`（J） | 打开 | 打开 | — | — | — | — | — | — | 浏览：切到巡夜本 | 关闭 | — | — | — |
| `hint`（H） | 提示 | 提示 | 提示 | 提示 | 提示 | — | — | — | — | — | — | — | — |
| `back`（Esc） | 暂停菜单 | 退出取景器；叠在面板上时 `pass` 给面板 = 离开面板 | 退出回放 | 离开面板 | 离开面板 | 离开 | 离开 | 暂停菜单（M4 第 2 轮；不取消对话，强制对话同样只暂停） | 挑选器 → 动作菜单 → 关闭 | 关闭 | — | 暂停菜单（M4 第 2 轮） | 继续 |
| 移动（WASD） | 移动（Shift 快走） | 慢速移动（叠在面板上时无） | 慢速移动 | — | — | — | — | — | — | — | 操纵身体 | — | — |
| 视角（鼠标） | 环绕 | 瞄准（叠在面板上时禁用） | 瞄准 | — | — | — | — | — | — | — | — | — | — |
| 指针（§4.6） | lock | lock（叠在面板上时 free） | lock | free | free | free | free | free | free | free | lock | free | free |
| 临时模式 / 冻结世界 | 否 / 否 | 否 / 否 | 是 / 否 | 是 / 否 | 是 / 否 | 是 / 否 | 是 / 否 | 是 / 否 | 是 / **是** | 是 / **是** | 是 / 否 | 是 / 否 | 否 / **是** |

- 面板上叠加取景器时（`[…, panel_vcr, viewfinder]`），取景器未处理的 `play/shuttle/stepSec/index/digit`，以及 `interact`、`back`，都以 `pass` 下传给面板。残影点在任何面板模式下都不响应 R。
- 指针锁定时按 Esc：浏览器先解除锁定、页面通常收不到这次按键，于是按 §4.6 压入暂停；表里 `back` 列的行为只在未锁定（`?nolock=1`、锁定不可用、UI 模式）时由 Esc 触发。
- 支架确认、楼梯井是强制对话，按 `dialogue` 列操作（1–4 选项）。
- M4 第 2 轮：菜单页（标题、暂停、设置）开着时，按下的键只给 UI（`InputManager.onButton` 的监听者），**不**再进 KEYMAP 翻译（Esc 与松开事件除外）——
  暂停页上 Enter 选“继续”不会在下一帧按对话/密码锁/挑选器再翻译一次；标题页的 Tab/J 不会把看不见的相册、巡夜本压进栈（`ExploreMode` 另有保险：没有区域或标题页开着时只认 `back`）。

### 附录 B：GDD 机制 → 实现位置

| GDD | 实现 | 区域需要提供 |
|---|---|---|
| M0 移动与交互 | `core/player.ts`、`game/interaction.ts` | 碰撞体、交互物数据 |
| M1 取景器 | `game/modes/viewfinder.ts`、`game/viewfinder.ts`、`core/layers.ts` | 阴物/褪字对象放对图层 |
| M2 拍照 | `game/photo.ts` | `photoTargets`、`photoDecoys`、失败标题；R2 监听 `shutter` 点灯 |
| M3 变焦 | `game/viewfinder.ts`、`core/areaContext.ts`（hdText 切换）、`kit/text.ts` | `ctx.hdText()` |
| M4 倒带 | `game/replay.ts`（现世让位、`hideWorld`）、`rigs/characters.ts`（老周 faceMask） | `replayPoints`、`segments`、`hideWorld` 的 ref |
| M5 红外 | `fx/ir.ts`、`fx/cameraFxShader.ts` | 物体 `tempC`（鬼市灯笼 6℃）、冷迹 |
| M6 录像机 | `game/vcr.ts`（独立 `tapeScene`、双分屏）、`fx/crtScreen.ts` | R1-finale：`ctx.vcr(config)`（带子场景、事件、按暂停时刻的空镜标题） |
| M7 监控台 | `game/cctv.ts`、`game/crt.ts`（五路分屏） | R1-world：`ctx.console({screen, viewPose, channels})`（CH3–5 画法）；R1-finale：`tunnelInner`、`tunnelBaked` |
| M8 出示与使用 | `game/interaction.ts`（`offers`、`any`）、`game/modes/album.ts`（动作菜单与挑选器）、`ui/actionMenu.ts`、`ui/album.ts` | `offers.accept`、`any`、`fallback` |
| M9 巡夜本、称呼表 | `game/journal.ts`（`renderDoc` 褪字）、`data/names.ts`、`ui/journal.ts`、`ui/docReader.ts` | R1-world：新页；各区域：文档（褪字用〔〕标记） |
| M10 提示与防卡关 | `game/hints.ts`（`appendTo`） | `puzzles`、三级提示文本 |
| X1 焚化 | R1-world 区域逻辑（`r1.brazier` 的 `offers.any`：接受任意照片，按照片给画外音，不设 flag） | R1-world |
| X2 长曝光 / X4 三脚架 | `game/tripod.ts` | R1-finale：`ctx.tripod(config)`、`dlg.r1.bracket_confirm` |
| X3 照妖镜 | `game/cctv.ts`（乒乓 RT）+ `settings.tunnelMode` | R1-finale：`tunnelInner`、`tunnelBaked` |
| X5 红外冷迹 | `kit/residue.ts` 的 `createColdTrace()` | 各区域放置并写交互物（红外取景器中交互写线索） |
| 3.4 模式与确认 | `core/modes.ts`、`game/dialogue.ts`（强制对话） | 确认/二选一写成强制对话 |
| 3.10 时辰 | `game/shichen.ts` | 各区域按 flags 构建时辰差异 |
| 3.13 存档 | `game/save.ts`（校验、`hold`、通关标记） | 无（区域不得自行存档） |
| 3.14 图层/镜面/字体 | `core/layers.ts`、`game/mirror.ts`（Reflector 式）、`game/read.ts`（镜中虚像）、`kit/text.ts` | R1-world：`ctx.mirror()`、镜中贴条读字目标（`via.mirror`） |
| 3.15 区域接口与自动化 | `core/area.ts`、`debug/api.ts`、`debug/fidelity.ts` | `defineArea`/`AreaPart`、`automation` |
| 10.2 角标不泄题 | `game/interaction.ts`（`Dyn` label、`lint()`） | 按 §6.6 硬规则命名 |

### 附录 C：区域代理开工清单（照做即可）

1. 读 GDD：§2（故事）、§3（机制）、§4 开头与本区小节、§4.6、§5 中本区谜题、§7 中本区物品/照片/文档、§8 中本区对话、§9、§10.2（角标规则）、§11 中本区步骤、§13。
2. 读本文：§1、§2.11–2.12、§4.8（动态碰撞体）、§6（至少 6.3、6.6–6.9、6.13–6.17）、§10、§11、§12.3–12.5、§15.4、§15.6。R1 两位代理另读 §11.6 的分工表。
3. 先写 `text.ts` 与 `dialogue.ts`（照抄 GDD 原文），再写 `puzzles.ts`、`photo.ts`、`replay.ts`。
4. 写 `build/`：先按 GDD 坐标摆碰撞体、动态碰撞门与出生点（出生点离触发体 ≥ 0.8m，门洞类触发体在门外），保证 `goto`、`walk()` 与出入口可用；再做外观。灯只用 `ctx.light()`/`lamp()`，总数 ≤ 8 且固定。
5. 写 `logic.ts`：交互物、NPC、触发器、面板；每个写 flag 的地方都有守卫与“前置未满足”反馈；先写 flag 再开对话；角标不泄题；确认用强制对话。
6. 写 `scripts/regions/<id>.mjs`，先让 §11 本区步骤跑通，再补错误反馈断言与门槛 `walk()`。引擎挡路时写 `docs/requests/<区域>.md` 并标 `blockedBy`，继续做别的；定期看 `docs/requests/m2-engine.md`，自己的条目 resolved 后去掉 `blockedBy` 并跑通（§15.4）。
7. 写 `shots.ts`，跑 `shots.mjs --area <id>`，看图自查，调灯光与后期，直到亮度验收通过。
8. 对照 §15.4 完成定义逐条打勾。
