# m2-engine：M2 引擎维护者的处理结论

> 唯一写入者：引擎维护者（M1c/M1d 的整合代理；ARCH §2.12、§15.4、§15.6）。区域代理只读，不在这里写。
> M2 期间引擎维护者定期扫描五个区域的 requests 文件（`r1-world.md` `r1-finale.md` `r2.md` `r3.md` `r4.md`），按提交先后**先进先出串行**处理 open 条目；
> 每处理一条：重跑 `smoke`、`check`、`test:core` 与受影响的 `regions/<id>.mjs`（只读运行，不改区域脚本）；改公开签名时同步 ARCH；缺 id 先补 GDD §13 再补 `ids.ts`；
> 然后在本文件末尾追加一条结论（**不**改区域的 requests 文件，保持单一写入者；M3 整合代理再把结论抄回各条目的“状态”行）。
> 区域代理看到自己的条目在这里 resolved 后，去掉对应步骤的 `blockedBy` 并跑通；wontfix 或 `deferred-M3` 的保留 `blockedBy`，按结论调整绕开方案。

## 区域 requests 文件的条目格式（ARCH §15.6，区域代理照此写在 `docs/requests/<区域>.md`）

```md
## <编号>. <一句话标题>
- 类型：接口需求 | 引擎缺陷 | 缺 id | 文档矛盾
- 现象/需要什么：……（引擎缺陷附复现步骤与 state() 片段）
- 影响：GDD §11 步骤 …；regions 脚本里的 blockedBy
- 临时绕开：……（没有就写“无”）
- 状态：open            ← 整合者处理后改为 resolved（改了哪些文件）/ wontfix（理由）
```

## 本文件的结论格式

```md
## <区域>#<编号> <标题>
- 状态：resolved（改了哪些文件；改签名时写 ARCH 的章节）| wontfix（理由）| deferred-M3（只能靠改区域代码或需要跨区域协调，理由）
```

<!-- 引擎维护者的结论从这里往下追加，按处理顺序排列。 -->

## M3 整合代理的说明（2026-09-28）
- M2 期间这里没有追加过结论（五个区域的 28 条都还是 open）。M3 整合代理按 ARCH §15.5 第 1 条直接逐条处理，结论（resolved + 改了哪些文件、ARCH 章节）写在各区域 requests 文件对应条目的“状态”行，这里不重复。
- 汇总：r1-world 6 条、r1-finale 6 条、r2 4 条、r3 7 条、r4 5 条，全部 resolved，无 wontfix；各区域 requests 文件末尾的 `## Lessons` 已去重收录进 `AGENTS.md`。
