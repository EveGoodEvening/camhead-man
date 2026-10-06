# engine-wp3：WP3 的接口需求与缺陷（M1b）

> 唯一写入者：WP3（只**追加**，不改别人的条目；ARCH §2.12、§15.2、§15.6）。M1c 起由整合代理逐条处理，并把“状态”行改为结论。
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

<!-- WP3 的条目从这里往下追加，编号从 1 开始。 -->

## 1. CameraFxPass 不能再 `#include <colorspace_pars_fragment>`（会重复定义）
- 类型：文档矛盾
- 现象/需要什么：ARCH §8.1（与 §16 #5 的写法）要求 CameraFxPass 着色器开头 include `tonemapping_pars_fragment` 与 `colorspace_pars_fragment`。r186 的 `WebGLProgram.js` 给**所有非 Raw 的 ShaderMaterial** 的片元前缀无条件内联了 `colorspace_pars_fragment`（给 `linearToOutputTexel` 用），再 include 一次 `sRGBTransferOETF` 等函数就重复定义、编译失败。`tonemapping_pars_fragment` 只在 `toneMapping !== NoToneMapping` 时进前缀，本材质 `toneMapped:false`，所以它要自己带。
- 影响：无玩法影响；ARCH §8.1 第一段、§16 #5 的“做法”一栏需改成“只 include tonemapping_pars_fragment；sRGBTransferOETF 由前缀提供”。
- 临时绕开：`src/fx/cameraFxShader.ts` 只 include `tonemapping_pars_fragment`（文件头注释写明原因）。
- 状态：resolved（M1c：ARCH §8.1 与 §16 #5 改成“只 include tonemapping_pars_fragment；sRGBTransferOETF 由片元前缀提供”；代码不变）

## 2. CRT 屏幕 uniform 的语义与 split5 图集布局（补充约定，WP5 已按同一布局实现）
- 类型：接口需求
- 现象/需要什么：ARCH §8.4 只列了 `CrtUniforms` 的键，没写语义。WP3 的实现约定如下（建议整合者抄进 §8.4）：
  - `map`：当前频道画面（RT 或 CanvasTexture，后者设 SRGBColorSpace）；null = 只剩磷光底色。`osd`：透明底的 OSD 画布，叠在最上层。
  - `noise` 0..1：轻噪点 + 偶发横纹（静态频道的“噪点动画”）；`noSignal` 0..1：雪花替换画面（切台/无信号）。
  - `scan` 0..1（默认 0.35）：屏幕扫描线，按像素密度自动淡出防摩尔纹；`barrel`（默认 0.12）：屏幕弯曲，弯出去的部分是黑边框。
  - `tunnel`/`tunnelMix`：`0 < tunnelMix < 1` 时只在画面中心按比例混入 tunnel（RT 模式下的 tunnelInner 画布）；`tunnelMix = 1` 时整屏换成 tunnel 并带缓慢推近动画（预制 8 层嵌套，`settings.tunnelMode='baked'`）。
  - `layout = 1`（split5）：`atlas` 是整屏的 **3 列 × 2 行** 布局图（512×384），读序 CH1 CH2 CH3 / CH4 CH5 日期（画布上方为第一行）；着色器把 CH2 格（上排中间）换成 `ch2` RT 并画格线。WP5 的 `cctv.ts atlasTexture()` 已是同一布局。
  - `split = 1`：画中缝，并在右半左上角贴着色器自带的“CH2”标签（左半 OSD 由 osd 画布负责，WP5 已避开右半）。
  - `time`：动画时间（秒）。
  - 另外：`layout` 是 GLSL ES 3.0 保留字，着色器里用内部 uniform `uLayout`，由材质的 `onBeforeRender` 每次绘制前从 `uniforms.layout` 同步；`uHas*`（贴图是否为 null）同理。WP5 只写冻结的 `CrtUniforms` 即可。
  - `createCrtScreenMaterial(o?: { powered?: boolean })` 多了一个可选参数（`MATERIALS.crtScreen()` 用 `powered:false` 得到未通电的黑玻璃外观）；导出 `CRT_TEMP_C = 42`（通电 CRT 在红外下是热的——GDD P13“屏幕上只剩一团热”）。
- 影响：ARCH §8.4；GDD P12/P13 的屏幕观感
- 临时绕开：无（已实现）
- 状态：resolved（M1c：CrtUniforms 的语义、split5 图集布局、`uLayout` 映射、`createCrtScreenMaterial(o?: { powered })` 与 `CRT_TEMP_C = 42` 写进 ARCH §8.4（后两者冻结））

## 3. WP3 补充的非冻结导出（跨 WP 可能用得到的）
- 类型：接口需求
- 现象/需要什么：以下导出不在冻结签名里（本包自测与预热在用），请整合者决定是否写进 ARCH：
  - `PostPipeline.sceneStats: { calls, triangles }`——RenderPass 前后取差的**主场景** draw call，正好是 `perf().callsMain`（ARCH §12.3、§16 #15）。WP1 目前用 `RenderPipeline.lastFrameCalls` 间接推算，可改用它。
  - `PostPipeline.current`（合成后的 FxParams，只读）、`layers()`（当前叠加层 key）、`warm(target)`（`warmupArea` 用）。`FxStack`、`resolvePreset`、`cloneFx`（纯逻辑，node 单测用）。
  - `fx/feeds.ts`：`renderIntoFeed(r, feed, scene, cam, { hide })`（渲染期间隐藏 hide 列表与所有 auxHide 对象、渲完 swap——WP5 的 feed 可直接用）、`feedPoolStats()`、`drainFeedPool()`。`acquireFeed` 在 dev 下对 `ch1`/`ch2` 不带 `pingpong:true` 抛错；同 key 未 dispose 又 acquire 也抛错。
  - `fx/ir.ts`：`irGray(t)`、`quantizeTemp(t)`、`irMaterialCount()`；`IrRenderer.isActive`。
  - `fx/environment.ts`：`normalizedTint()`、`environmentCacheSize()`；`fx/materials.ts`：`sharedMaterialCount()`；`fx/ghostMaterials.ts`：`FX_TIME`（魂影类材质共享的动画时间 uniform，PostPipeline.render 每帧写入游戏时间）。
  - `audio/engine.ts`：`SFX_CUES`、`AMB_PRESETS`、`MUSIC_CUES`、`AudioRuntime`、`AudioJob`；`AudioEngine.ambience`、`jobCount`、`dispose()`（测试页用）。
- 影响：无（纯补充）
- 临时绕开：无
- 状态：resolved（M1c 决定：冻结 `PostPipeline.sceneStats`（`RenderPipeline.stats().callsMain/trisMain` 由它转交，perf() 用它）；其余（current/layers()/warm()、feeds/ir/environment/audio 的补充导出）仍是 WP3 内部，ARCH §2.13 写明）

## 4. 后期的时间语义与白闪（补充约定）
- 类型：文档矛盾
- 现象/需要什么：ARCH 只写了 `render(dt)` “显式传 dt”，没写锁步下 dt 恒为 0 时淡入淡出怎么走。WP3 的实现：
  - **动画时间**（颗粒按 24fps 换样、VHS、频闪、魂影/回放人影/纸像的微光）只累加 `render(dt)` 的 dt = 游戏时间；游戏时间停住画面也停住，锁步截图可复现。
  - **过渡时间**（`push/pop` 的 fadeSec、白闪衰减）：dt > 0 时用 dt；dt === 0（锁步 rAF 的 `render(0)`、`renderNow()`）时用两次 render 之间的真实时间（上限 0.1s）。否则锁步下白闪永远不退、叠加层永远到不了目标值。WP1 把 advance 期间累计的 dt 一次性交给下一帧渲染（`pendingRenderDt`），与此兼容。
  - `flash(ms = 80)`：前 30% 满白再线性退掉；过场 `{fade:'white', dur}`（WP4 用 `post.flash(dur*1000)`）同样适用。`reduceFlash`：改为至少 0.25s 的正弦式柔和淡入淡出，短闪（< 0.3s：快门、镁光灯）峰值 0.35，长的“淡入白”仍到全白。`flicker` 在 reduceFlash 下恒为 0。
  - 叠加规则：base 之上按 push 顺序覆盖，重复 push 同 key 原位更新并淡回 1；标量按权重插值（`ir` 在 CameraFxPass 与红外替换里按 ≥ 0.5 取二值）；`bloom`/`tint` 按分量插值；只有 key 为 `'vf'` 的层的 `chroma` 是乘法。`settings.grain` 乘到 grain 与 chroma 上。
- 影响：ARCH §8.1 可补一句
- 临时绕开：无（已实现）
- 状态：resolved（M1c：后期的动画时间/过渡时间、flash 与 reduceFlash、叠加规则写进 ARCH §4.7.2 与 §8.1；代码不变）

## 5. 音频接口的单位与环境声参数表（补充约定，区域代理需要）
- 类型：接口需求
- 现象/需要什么：
  - `AudioEngine.sfx(cue, { gain })` 的 gain **按 dB**（与 `AmbienceSpec.gain` 一致，默认 0），`rate` 是音高/速度倍率；`duck(db, sec)` 取 |db| 往下压环境声总线，sec 秒后回原位，新的 duck 覆盖旧的。
  - `AmbienceHandle.set(param, v, rampSec)` 的参数名（ARCH 未列，区域代理要用）：通用 `gain`（线性，乘在 spec.gain 的 dB 上）、`level`（预设内部总增益）；`rain.intensity` 0..1（寅时“雨声 6 秒内淡出” = `set('intensity', 0, 6)` 或 `stop(6)`）；`sodium_hum`/`mains_hum`/`crt_whine`/`neon_hiss`/`tube_hum` 的 `on` 0/1（R4 开市时 `tube_hum.set('on', 0, 0.5)`；霓虹熄灭同理）；`tv_murmur.level`；`traffic.level`；`tunnel_reverb.wet` 0..1（R4 的长混响是共享 send，sfx/人声/环境声都会进混响）；`whispers.density` 0..1；`fm_bells.rate`（倍率）；`erhu_drone.level`。`spec.params` 里同名参数就是初值。未知参数 dev 下 `devWarn` 并忽略。
  - `AmbienceSpec.at` 与 `sfx({ at })` 用 PannerNode（equalpower、inverse、refDistance 1.5）定位，依赖 WP1 每帧 `audio.setListener(camera.position, yaw)`（WP1 已在 §3.2 第 9 步调用）。
  - 解锁前调用 `setAmbience` 会记下最后一组，解锁后补上（返回的句柄届时接到真实声音上，期间的 set/stop 会被重放）；sfx/music/murmur 在解锁前直接丢弃。
- 影响：ARCH §9 可补这张表；各区域 `audio.ts`
- 临时绕开：无（已实现）
- 状态：resolved（M1c：sfx/duck/at/解锁前行为与 AmbienceHandle 参数表写进 ARCH §9“单位与参数”）

## 6. 红外替换规则的补充（ARCH §6.8.2 没写到的情况）
- 类型：文档矛盾
- 现象/需要什么：WP3 的 `IrRenderer` 在 ARCH 规则之外还做了这些（都在 `fx/ir.ts` 文件头）：
  - `Sprite` 与 `Line`/`Points` 一样隐藏；`material.visible === false` 的网格（`MATERIALS.hitProxy`）原样保留（换成可见材质会把拾取盒画出来）；几乎全透明（`transparent && opacity < 0.05`，如淡到 0 的身体）隐藏；透明、无贴图、`opacity < 0.6` 的非 ShaderMaterial（玻璃）隐藏，否则会变成挡住后面的整块 18℃ 板子。
  - 魂影/回放人影这类 ShaderMaterial 换成实心的 irMaterial（阴物 6℃ 的冷轮廓；`MATERIALS.replay()` 的 tempC 是 18，回放人影在红外下与环境同温、看不出来——它们是“过去的影像”）。
  - 掠射面至多压暗 12%（掠射角发射率下降），同温的墙地箱子仍有转折；正对镜头的面系数为 1，所以正面像素与 tempC 的色带一致（自测 `wp3.ir_instance_color` 验证）。
  - 共享材质的缺省温度：环境 18；湿沥青 16、金属/铁皮 15（发射率低）、玻璃 16；纸/魂影/纸像发光 6；灯/霓虹 60；通电 CRT 42。区域用 `ctx.add(obj, { tempC })` 覆盖（如鬼市灯笼 6℃）。
- 影响：ARCH §6.8.2 可补这几条
- 临时绕开：无（已实现）
- 状态：resolved（M1c：红外替换的补充规则与共享材质缺省温度写进 ARCH §6.8.2）

## 7. 共享材质的贴图映射与环境贴图的色调（补充约定）
- 类型：接口需求
- 现象/需要什么：
  - `brick/plaster/lime/tileWhite/tileGreenWhite/concrete/asphaltWet` 用**世界空间三向投影**采样贴图（`onBeforeCompile` + 共用 `customProgramCacheKey 'cm-triplanar'`），贴图密度只由“米/张”决定（砖 2m×1m、瓷砖 1.6m、湿地 4m …），与网格 UV 无关——WP2 的 `box()/building()` 与区域都不必生成米制 UV。代价：会动的网格用这些材质时纹理会“滑”，门、抽屉这类用 `wood/metal/tin`（按网格 UV）。`dado` 按网格 UV：v 0→1 从下到上，墙裙分界在 45% 高（一层 2.8m 的墙约 1.26m）。
  - `areaEnvironment(renderer, tint)`：tint 只取色相与饱和度（按最大分量归一；亮度由 `AreaDef.environment.intensity` 决定），房间与点光乘满 tint、几块面光源只乘 60%（高光略偏白）。另：r186 在用 `scene.environment` 时把 `envMapIntensity` 统一设成 `scene.environmentIntensity`，材质自己的 `envMapIntensity` 不起作用。
- 影响：ARCH §8.3；M1c look-dev 选各区 tint 时注意“饱和度由 tint 决定”
- 临时绕开：无（已实现）
- 状态：resolved（M1c：三向投影贴图映射与环境贴图 tint 的归一规则写进 ARCH §8.3）

## 8. warmupArea 的做法与对 feed 的要求
- 类型：接口需求
- 现象/需要什么：`warmupArea` 用一台打开全部图层的临时相机（fp 的克隆），临时关掉视锥剔除、显出所有**不含灯**的隐藏子树（回放人影、viewVariant 的其他变体、R2 其他楼层、不在场的 NPC），往 1×1 RT 常规渲一次、红外替换渲一次；然后 `post.warm(rt)`（Bloom + CameraFxPass 两个分支）并对 `pipeline.feeds` 里的每个 feed 调一次 `render(r)`。所以**每个 AuxFeed.render 都必须能在“本不到期”时被调用**（WP5 的 selfFeed 已处理未插线的情况）。之所以真的渲染而不用 `compile()`：r186 的 `compile()` 按材质去重，同一红外材质既给普通网格又给置空 instanceColor 的实例网格时只编一个变体。自测 `wp3.ir_programs_stable` 验证预热后开关红外 `programs` 不变（独立页面实测 26 → 26 → 26）。
- 影响：ARCH §8.5、§13.1 步骤 ③
- 临时绕开：无（已实现）
- 状态：resolved（M1c：warmupArea 的做法与“每个 AuxFeed.render 必须能在本不到期时被调用”写进 ARCH §8.5）

## 9. 测试时的 “GPU stall due to ReadPixels” 控制台警告
- 类型：引擎缺陷
- 现象/需要什么：页面内自测读像素（`readPixels`/`readRenderTargetPixels`）时 SwiftShader 下 Chrome 会打 `console.warning`：“[.WebGL-0x…]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels”。它**不**匹配 ARCH §12.4 的 `/GL_INVALID|WebGL:|feedback loop|deprecated|has been removed/i`（是 “WebGL-” 不是 “WebGL:”），但 WP7 若把 harness 的过滤写宽了会误判；缩略图读像素也会触发。
- 影响：`scripts/core.mjs` 跑 `wp3.ir_*` 自测时
- 临时绕开：无（WP3 的独立自测用同一正则，已通过）
- 状态：resolved（M1c 确认：harness 的 BAD_WARN 严格照 ARCH §12.4，不含 “GPU stall due to ReadPixels”；写进 ARCH §12.4 的 selftest 与 harness 约定；wp3.ir_* 在 core.mjs 里通过）

## 10. SfxCue 里没有“CRT 开机”
- 类型：接口需求
- 现象/需要什么：GDD §3.2 开场“CRT 开机，五路分屏”、WP3 工作包说明都提到 CRT 开机声，但冻结的 `SfxCue` 联合类型里没有对应项（只有 `switch`、`vcr_motor` 等）。WP3 不改签名，先把开机声做进环境声 `crt_whine`：句柄 `set('on', 1)`（从 0 变 1 时）或 `set('boot', 1)` 放一次“消磁嗡—咚 + 静电噼啪 + 啸叫从 2kHz 爬到 7kHz”，`spec.params: { on: 0 }` 起步即为关机状态。建议 M1c 在 `SfxCue` 加 `'crt_on'`（`sfx.ts` 里把同一段合成挪过去即可），过场就能直接写 `{ sfx: 'crt_on' }`。
- 影响：GDD §11 步骤 1 前的开场过场（R1-world 的 `cs.r1.intro`）
- 临时绕开：区域拿不到环境声句柄（见 #11），所以过场里用 `ctx.ambience([...其余, { preset: 'crt_whine', params: { boot: 1 }, at: <CRT 位置> }], 0.2)` 重下一组环境声：`params.boot > 0` 的 crt_whine 在启动时就放一次开机声。
- 状态：resolved（M1c：`SfxCue` 加 `'crt_on'`（src/audio/engine.ts 的类型与 SFX_CUES、src/audio/sfx.ts 的合成，与 crt_whine 的开机同一段声音），ARCH §9 同步；scripts/selftest/wp3.mjs 的清单数改为 29）

## 11. 区域拿不到环境声句柄：`AreaContext.ambience()` 返回 void
- 类型：接口需求
- 现象/需要什么：`AudioEngine.setAmbience()` 返回 `AmbienceHandle[]`，但区域只能经 `AreaDef.ambience`（静态数据）或 `ctx.ambience(specs, fadeSec): void` 设置环境声，`GameApi` 也不暴露 audio，所以 GDD 里“寅时雨声 6 秒内淡出”“开市后灯管嗡鸣停”“CRT 开机”这类**对单条环境声的操作**区域做不到，只能整组重下（交叉淡变，别的声音会重新起一遍）。建议：`ctx.ambience()` 返回 `AmbienceHandle[]`（与 `setAmbience` 同序），并加 `ctx.ambienceHandles(): readonly AmbienceHandle[]`（取 `AreaDef.ambience` 自动设置的那组）；`AudioEngine` 已有非冻结的只读 `ambience` 可直接转交。
- 影响：R1（寅时雨停、开场 CRT 开机）、R4（开市灯管熄灭）、R3（霓虹熄灭）
- 临时绕开：整组重下 `ctx.ambience(newSpecs, fade)`——雨淡出 = 新的一组里不含 rain、fade 6；预设的初值参数都能从 `spec.params` 给（如 `tube_hum: { on: 0 }`、`crt_whine: { boot: 1 }`）。
- 状态：resolved（M1c：`AreaContext.ambience(specs, fade)` 改为返回与 specs 同序的 `readonly AmbienceHandle[]`（原为 void，只放宽），新增 `ctx.ambienceHandles()`（`AreaDef.ambience` 自动设置的那组也算）。改了 src/core/area.ts、src/core/areaContext.ts，ARCH §11.2、§9）

## Lessons
- three r186：非 Raw 的 ShaderMaterial 片元前缀已无条件内联 `colorspace_pars_fragment`（`sRGBTransferOETF` 现成可用），再 `#include` 一次就重复定义、编译失败；`tonemapping_pars_fragment` 只在材质被色调映射时才进前缀，`toneMapped:false` 的后期材质要自己 include。
- GLSL ES 3.0 保留字不能当 uniform 名：`layout`、`filter`、`input`、`output`、`sample`、`common`、`partition`、`active` 等（`CrtUniforms.layout` 因此在着色器里映射成 `uLayout`，由 `material.onBeforeRender` 同步）。
- three r186 有 `Material.onBeforeRender(renderer, scene, camera, geometry, object, group)`，在该物体绘制、上传 uniform 之前调用：适合从“冻结的 uniform 键”派生内部 uniform（如贴图是否为 null）。
- three r186 用 `scene.environment` 时，`MeshStandard/Lambert/Phong` 的 `envMapIntensity` uniform 被统一写成 `scene.environmentIntensity`，材质自己的 `envMapIntensity` 不起作用。
- 同一张 RT 不能在一个 pass 里既读又写（Chrome 报 feedback loop 警告）；UnrealBloomPass 会把结果混回 readBuffer，但中间都在自己的 RT 里，所以对它而言“同一张 RT 当 read/write”是安全的，ShaderPass 则不行。
- 预热要“真的渲染”而不是 `renderer.compile()`：r186 的 compile 按材质去重，同一材质用于普通网格与（置空 instanceColor 的）实例网格时只编一个变体；渲 1×1 RT 前要关视锥剔除、显出隐藏子树（跳过含灯的，灯数变了是另一套程序）。
- 红外替换用的 MeshBasicMaterial 若带 `map`，颜色会被贴图染色；只要 alpha 时在 `onBeforeCompile` 把 `#include <map_fragment>` 换成 `diffuseColor.a *= texture2D(map, vMapUv).a`，并给所有这类材质同一个 `customProgramCacheKey`。
- `THREE.Color.setRGB(r,g,b)` 默认按工作色彩空间（线性）解释——输出精确线性灰度（红外 t/45）就用它，别用 hex/`new Color(0x…)`（会按 sRGB 转线性）。
- node 里测 TS 模块：`runnerImport(absPath, { configFile:false, root })`（vite 8）约 100ms 就能加载 src 下的模块（含 three）；起临时测试页不用写配置文件：`createServer({ configFile:false, root, plugins:[虚拟模块 + configureServer 中间件返回 HTML] })`。临时目录里的 `vite.config.mjs` 解析不到 'vite'（按 /tmp 找 node_modules），要内联配置。
- 音频自测：在 `OfflineAudioContext` 上建 SynthKit（类型断言成 AudioContext）同步渲出每个音效/环境声/音乐，查 RMS > 0、峰值 ≤ 1、无 NaN；不需要真的播放。
- 前瞻调度（setInterval + AudioContext 时钟）在页面长时间挂起后恢复时要跳过过去的事件，否则 while 循环会补发成千上万个。
- `AudioParam.linearRampToValueAtTime` 前面要有一个 `setValueAtTime` 事件作起点；直接写 `.value` 再 ramp 的起点时间不可靠。
- SwiftShader 下读像素会打 “GPU stall due to ReadPixels” 的 console.warning（不含 “WebGL:”），harness 的 GL 警告正则不要写得比 ARCH §12.4 更宽。
