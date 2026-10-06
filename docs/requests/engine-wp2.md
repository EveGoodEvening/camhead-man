# engine-wp2：WP2 的接口需求与缺陷（M1b）

> 唯一写入者：WP2（只**追加**，不改别人的条目；ARCH §2.12、§15.2、§15.6）。M1c 起由整合代理逐条处理，并把“状态”行改为结论。
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

<!-- WP2 的条目从这里往下追加，编号从 1 开始。 -->

## 1. `rotYDeg`（kit/geom.box、ColliderBuilder.box、DynamicShape 的 box）与 `scatter` 的 `rotY` 角度约定要写明
- 类型：文档矛盾
- 现象/需要什么：ARCH §4.8、§10.2 只写了 `rotYDeg` / `rotY`，没说是 three 的 `rotation.y`（度，俯视逆时针为正）还是 yaw（ARCH §1.3：`rotation.y = -yaw`）。WP2 的 `kit/geom.box(…, rotYDeg)`、`kit/instancing.scatter` 的 `rotY` 都按 three 约定实现（`rotation.y = rotYDeg·DEG2RAD`，文件头已注明）。请 WP1 的 `ColliderBuilder.box` 与 `DynamicShape` 的 box 用同一约定，区域才能把同一个数同时传给视觉盒子与碰撞盒；并在 ARCH §4.8、§10.2 写明。
- 影响：所有用 `ctx.collider.box(…, rotYDeg)` 配合 kit 盒子的区域；`ctx.collider.dynamic` 的 box 形状
- 临时绕开：`kit/doors.ts` 的 `DoorRig.collider` 用 `wall` 形状（世界 XZ 两端点），不依赖该约定
- 状态：resolved（M1c：WP1 的 `ColliderBuilder.box`/`DynamicShape.box` 已与 kit 同为 three 的 rotation.y 约定（度），不用改代码；ARCH §4.8“几何约定”与 §10.2 `box`/`scatter` 注释写明）

## 2. `ctx.hdText` 切换时只换 `material.map`（不换材质、不改 UV）
- 类型：接口需求
- 现象/需要什么：ARCH §5.3 要求黄三爷面具的鼓瘪小平面“只在高清贴图生效期间可见（PaperRig.update 判断脸网格当前贴图是否为高清版）”。WP2 的实现检查 `(face.material as MeshStandardMaterial).map === faceHi()`。所以 WP1 的 `AreaContextImpl.updateViews()` 做 hdText 切换时应当 `mat.map = hi()` / `lo()`（可再 `needsUpdate = true`），不要替换整个材质、不要改 UV。黄三爷的 `hdFace.hi()` 是与 `lo()` 同布局的 2048² 图集（只有他那一格画了嘴部水渍与卷边），UV 不用变；他的脸材质是私有实例（普通摊主共用一个），换 map 不会影响别的纸人。
- 影响：GDD §11 步骤 39–40（P9 看破）；`wp2.huang_pixels` 自测（直接换 map 验证）
- 临时绕开：无（`dev/wp2.ts` 的夹具已调用 `ctx.hdText(hdFace.mesh, hdFace.lo, hdFace.hi, { minZoom: 4, maxDist: 5 })`）
- 状态：resolved（M1c：核对 `AreaContextImpl.setHd()` 只写 `material.map`（hi()/lo() 各生成一次并缓存），不换材质、不改 UV；写进 ARCH §5.3）

## 3. 变焦时需要有人调用 `playerModel.head.setZoom(z)`
- 类型：接口需求
- 现象/需要什么：GDD M3“变焦时镜头环转动”。`CameraHead.setZoom` 已实现（镜头环按档位转到固定角度并缓动），但 `PlayerModel.update(dt, p, mode)` 拿不到当前倍率。需要 WP5 的 `ViewfinderSystem.stepZoom`（以及新游戏/读档复位倍率时）调用 `game.playerModel.head.setZoom(zoom)`。
- 影响：纯视觉（镜面、CH2、过场固定机位里看得见镜头环）
- 临时绕开：无
- 状态：resolved（M1c：`ViewfinderSystem.applyZoom()` 已同时调 `cameras.setZoom` 与 `playerModel.head.setZoom`；另新增 `ViewfinderSystem.resetOptics()`（新游戏/读档/?area= 开局时镜头回常光、倍率回 1×、镜头环转回），由 Game 调用。改了 src/game/viewfinder.ts、src/core/game.ts，ARCH §4.4/§6.8.1）

## 4. 视频线插头插进 `r1.crt_jack` 的约定（CableRig 的补充语义）
- 类型：接口需求
- 现象/需要什么：ARCH §5.2 只写了“BNC 插头（插进 r1.crt_jack 时由 R1 把它移到插孔处显示）”。WP2 的实现：只要 `head.cable.plug` 不再是 `head.cable.group` 的子节点（R1 把它 attach 到插孔节点下），摆链的最后一个点就钉在插头的世界位置，整根线被扯向插孔（允许拉长，R1 负责“离桌子 > 2m 自动拔出”）；把插头放回 `cable.group` 就松开，由摆链接管。请写进 ARCH §5.2。另：`PlayerModel.update` 里 `head.update` 已经调用 `cable.update`，别处不要再调（头挂在门楣支架上时也一样，`playerModel.update` 照常每帧调用即可）。
- 影响：GDD P13（插视频线）
- 临时绕开：无
- 状态：resolved（M1c：插头插进插孔的约定与“别处不要再调 cable.update”写进 ARCH §5.2）

## 5. 魂影/回放共享材质的逐人偶淡出：透明度 uniform 名
- 类型：文档矛盾
- 现象/需要什么：`HumanoidRig.setOpacity` 要逐人偶淡出，但 `MATERIALS.ghost()` / `replay()` 是共享实例，ARCH §8.3 没写透明度 uniform。WP2 在第一次 `setOpacity(<1)` 时把该人偶用到的共享材质各克隆一份（同一着色器程序，不改共享实例），再写 `uniforms.uOpacity`（WP3 现用的名字；也兼容 `opacity` / `uAlpha`）与 `material.opacity`。请在 ARCH §8.3 写明 ghost/replay/paperGlow 的透明度 uniform 是 `uOpacity`，“克隆后改 uOpacity”是允许的逐实例淡出方式。克隆出来的材质不是共享实例，区域卸载时会被 Disposer 释放（正确）。
- 影响：王奶奶换层 `fadeTo`、化光；主角 P14 用自己的材质，不受影响
- 临时绕开：已实现（`rigs/humanoid.ts` 的 `setMaterialOpacity`）
- 状态：resolved（M1c：写进 ARCH §5.3“逐人偶淡出”：透明度 uniform 名 `uOpacity`，克隆共享材质后改 uOpacity 是允许的做法）

## 6. ARCH §5.1 的姿势角度符号与行走循环公式与实现不一致
- 类型：文档矛盾
- 现象/需要什么：ARCH §5.1 的“sit 髋 -90°、膝 90°”“raise_arm 右肩 -150°”“look_up 颈 -35°”是按“前屈为负”描述的；人偶面朝 -z 时，three 右手系里下垂的肢体往前（-z）摆是绕 X 为正，所以 `rigs/poses.ts` 里符号相反（文件头写明）。行走：ARCH 的 `phase += speed/stride·dt·2π` 会让每 0.75m 走完一整个左右脚周期（单步 0.37m，2.2m/s 时每秒近 6 步），实现改为每个 stride 走半个周期（π），与髋 ±0.45rad、腿长 0.87m 算出的单步 0.76m 一致；膝改在摆动相屈（ARCH 的 `max(0,-sin(phase+0.6))` 落在支撑相）；身体起伏改为双脚分开时最低。幅度（髋 0.45、膝 0.9、肩 0.35、肘 0.25、起伏 0.03、停步 0.2s 收回）沿用 ARCH。请把 §5.1 改成与实现一致。
- 影响：无（外观）
- 临时绕开：无
- 状态：resolved（M1c：ARCH §5.1 的行走循环（phase 每 stride 走 π、膝在摆动相屈、起伏双脚分开时最低）与姿势角度符号改成与实现一致）

## 7. 视频线的实现方式（GDD 写 TubeGeometry，ARCH 写 6 节短圆柱）
- 类型：文档矛盾
- 现象/需要什么：ARCH §5.2“不要每帧重建 TubeGeometry，用摆锤链”。实现是 7 个质点的 Verlet 链（固定步长 1/90s、每步 6 次约束迭代、出线口护套方向约束、背面碰撞并轻微贴背），渲染用一个 6 实例的胶囊 InstancedMesh（一次 draw call，`frustumCulled=false`）+ BNC 插头。外观与 GDD 一致（从后脑垂到腰间、走路时晃）。请在 ARCH §5.2 记一笔。
- 影响：无
- 临时绕开：无
- 状态：resolved（M1c：ARCH §5.2 记下 7 质点 Verlet 链 + 6 实例胶囊 InstancedMesh + BNC 插头的实现）

## 8. kit / rigs 里 ARCH 没写明的约定（请并入 ARCH §5.3、§10.2）
- 类型：文档矛盾
- 现象/需要什么：
  - `lamp()`：`at` 对 `sodium_pole` 是灯杆脚（地面），其余是灯具本身；灯具正面朝 -z（墙上的门灯由区域转 `group.rotation.y` 让它背对墙）；真实光创建时已放在灯泡的世界位置（假定 group 挂在区域 root 下），灯泡可见时 `onBeforeRender` 会把光同步过去；`wetStreak` 贴在世界 y=0 的地面上（室外用；R2 楼上楼层别开），每次绘制前转向当前相机；`tungsten_pendant` + `castShadow` 用 SpotLight（朝下），其余是 PointLight。
  - `windowGrid()`：`origin` = 左下角那扇窗的中心；`right` = 站在楼外看立面时的右手方向（单位向量）；`up` = 行距向量（长度≈1 时按 2.8m 一层）；窗面法线 = right × up；列距 = `spacing`。
  - `door()`：`at` = 门洞底边中点；正面（有把手的一面）朝 `yaw`；`collider` 是 `wall` 形状；铁院门两扇对开、铁链节点 `name 'chain'`（挂锁 = `handle`）；`building()` 建的门在 `group.userData.doors`（DoorRig[]）。
  - `PROPS`：原点在底面中心、正面朝 -z；挂墙/悬挂类见各函数注释（`mirrorRound`/`switchBox`/`tapeRack` 原点在中心，`lanternPaper` 在挂点，`bracket` 在贴墙底板中心、`name 'mount'` 是摄像头云台底座的安装点）；单独能动的部件用 name 标出（`'drawer'` `'lid'` `'canvas'` `'wheel0'…` `'switch1'…` `'labelSlot1'…`）；`crt()` 屏幕 0.36×0.27、中心在 `group.userData.screenCenter`；`vcr()` 的“视频入1”插孔在 `group.userData.jack`。
  - `sign()`：正面朝 +z（与 `makeTextPlane` 一致）。`stairsVisual()`：原点在第一级前沿中点，往 -z 爬。`createCrowd()`：面朝 -z，第一排在 z=0，往后每排 +0.85×spacing、抬高 0.15m。
  - `CharacterRig.props` 的键：tudi `{ lantern, lanternLight（NpcDef.lights 的锚点）, cane, beard }`；wang `{ bun, basket }`；lu `{ glasses, tlr }`；zhou `{ collar, armband, cap, mug, faceSnow? }`；huang `{ masked, man, weasel, mask, hat, tail }`；kid `{ scarf }`；bride `{ bun }`；junkman `{ cap }`；worker `{ hardHat }`。土地 `look:'ghost'` 保持本色 + 土地金菲涅尔描边（他是神不是鬼），其余角色 ghost 用 `MATERIALS.ghost(color)`。黄三爷揭面具后由 R4 调 `ctx.viewVariant({ naked: props.man, vf: props.weasel, ir: props.man })`；`look:'replay'` 的 huang 默认 variant `'man'`，`look:'live'` 默认 `'masked'`。
- 影响：区域代理（M2）照这些约定摆放
- 临时绕开：无（各文件头与函数注释已写明）
- 状态：resolved（M1c：lamp/windowGrid/door/PROPS/sign/stairsVisual 的摆放约定并入 ARCH §10.2，createCrowd 并入 §5.4，CharacterRig.props 的键与 ghost/huang 变体并入 §5.3）

## 9. 主角头部俯仰时镜头点会移动（给 WP1 cameras 的提醒）
- 类型：接口需求
- 现象/需要什么：云台俯仰轴在外壳下部（离地 1.86m），镜头在轴前约 0.21m，所以取景器俯仰 ±60° 时 `head.lensAnchor` 的世界高度会在约 1.67–2.03m 之间变化（俯仰 0 时正好 1.85）。ARCH §4.7 写“相机位置 = 头部镜头世界坐标（离地 1.85m，PC_DIMS.lensY）”。WP1 取 `lensAnchor` 的世界坐标（像真的云台）或固定按 `PC_DIMS.lensY` 都行，但 fp 相机位置与 `player.eye`、`stickerWorld()`（镜中读字的实物点）要出自同一套约定。另：`PlayerModel.update` 在 `mode.viewfinder/replay/panel_vcr/panel_console/dialogue` 里让头跟随 `angleDiff(bodyYaw, yaw)` 与 `pitch`，在 `mode.explore` 里站着不动 1.5 秒后云台巡航扫描。
- 影响：镜中读字只在 pitch≈0 时发生，差异可忽略
- 临时绕开：无
- 状态：resolved（M1c 决定：fp 相机、eye、读字与拍照一律按固定的 PC_DIMS.lensY + LENS_FORWARD（不读 lensAnchor），镜中读字的实物点用 stickerWorld()；写进 ARCH §4.7、§5.2；`m1c.lens_anchor` 验证俯仰 0 时两者重合）

## Lessons
- RoundedBoxGeometry（r186）是非索引几何，六个面依次 +x −x +y −y +z −z、各占 1/6 顶点，每面 UV 从外面看都是正的；给整颗头做贴图集时按“顶点序号 / (总数/6)”分面重映射 UV 即可。
- 平面 `rotateY(π)` 之后朝 -z：原来 u=0 的一边落在 +x，正好是从正面看的左边，贴图不用再翻；自己再翻一次字就反了。
- 要让 InstancedMesh 与普通 Mesh 渲染逐像素一致：共用同一份几何数据、同一材质实例、单位变换（实例矩阵与模型矩阵都是单位阵，instanceMatrix × p 在 GPU 上是精确的）；每实例的差异（脸格子）用 InstancedBufferAttribute + onBeforeCompile 改 `vMapUv = uv + aCell * aFace`，不要用 instanceColor（红外替换会被染色）。
- three r186 的 renderObject 先调 `object.onBeforeRender` 再用 `matrixWorld` 算 modelViewMatrix：在 onBeforeRender 里挪位置/转朝向（朝相机的雪花脸、湿地光带）必须自己 `updateMatrixWorld()`。
- InstancedMesh 的单个实例用负缩放做镜像时 three 不会翻转剔除面：镜像实例的材质要 DoubleSide。
- 构建期画布大量 `getImageData` 时用 `getContext('2d', { willReadFrequently: true })`，否则 Chrome 打出 Canvas2D 的 console 警告。
- kit/canvas.ts 与 kit/text.ts 互相 import 时，模块顶层常量会碰到 TDZ：FONT_STACK 放在 canvas.ts（CJK_FONT_STACK），text.ts 只做 re-export，依赖方向单向。
- 贴画布的纯逻辑在 node 里跑不了（没有 document），但 vite 的 `runnerImport` 能在 node 里加载 src 的 TS 模块测不碰画布的部分；其余放到 vite dev 服务器 + 无头 Chromium 的独立测试页（一个虚拟模块入口，按需把未完成的依赖换成替身）。
- 接上真实后期（Bloom 阈值 0.8）后，近处钠灯下金属小件（铁皮帽）的针尖高光会被吹成一团光：小件金属 roughness 取 ≥0.55。
