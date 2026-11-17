# Memory 历史审计与一次性回填

> 公开脱敏候选：真实认识、记录标识、机器路径及私有校验值仅在私人归档保留。占位标识只用于本文说明，不可运行或跨页关联；本页仍记录原阶段的测试与限制，不代表本次重新验收。


日期：2026-11-16（Asia/Shanghai）。版本 v0.3.9，分支 `feat/obsidian-memory-mirror`。保留原有未提交改动，不提交、不推送。此轮仅新增离线脚本、针对性测试和本报告；不修改前端或任何 Memory 算法。

## A. 当前存储与 Recall 完整链路

### 两个真实 profile

| 用途 | 实际位置 | 当前权威与入口 |
| --- | --- | --- |
| 当前开发 profile | `<REPO>\.local\desktop-dev-profile` | `memory-authority` 内容为 `note-v2`；`pnpm dev:desktop` 的 Main 在 dev 模式调用 configureDevProfile |
| 旧默认桌面 profile | `%APPDATA%\@aisling\stage-desktop` | 无 Note v2 权威标记；保留旧 JSON；标准 prod 入口不调用 configureDevProfile，仍可能选择旧兼容分支 |

依据：`scripts/dev-desktop.mjs`、`apps/stage-desktop/main.cjs`、`desktop-app.cjs:startDesktop/configureDevProfile`、`memory-authority.cjs:canStartNoteV2/assertMemoryAuthority`。不能把两个 profile 当成同一数据库，也不能因为代码里有旧模块就推断当前开发 profile 正在读取它。

### 存储实体

- `aisling-store.json` 中的 `aisling.conversations.v1` 是原始会话和消息，字段值本身是 JSON 字符串。当前会话和 Raw Recall 都从这里读取；没有独立持久化的 BM25 索引库。
- `aisling.config.v1` 与会话共用现有 Desktop 存储。Electron 中通过 preload 的 storage 桥接读写，同步落到 userData 下该文件；开发 Vite 的浏览器 origin 不决定最终 Desktop profile。
- `aisling-reflections.v1.json` 是旧 Reflection 实体、来源引用、形成进度和批次。旧默认 profile 有，当前开发 profile 没有。
- `memory-note-v2/note-v2.lbdb` 是当前 LadybugDB；Note 的 `snapshot_v2_runtime` 虽然序列化为 JSON，但它是 Note v2 快照，不是旧 Reflection JSON。NoteRevision、NoteOperation、Evidence、HAS_EVIDENCE、HAS_CONTEXT、NOTE_LINK 等均在此库中。
- `note-formation-jobs.v1.json` 是形成/组织/Embedding 作业与进度，不是另一套可独立召回的结构化记忆库。`memory-erasure.v1.json` 是来源删除屏障和恢复日志，不是事实来源。
- 可选 NOTE_EMBEDDING 和组织索引是候选发现/检索投影，不替代 Note 或原始证据；本轮未调用 Embedding。
- Obsidian Markdown 是单向输出，Runtime 不把其正文作为记忆事实读取。Chromium Cache、GPUCache、Session Storage 等不是本轮发现的独立 Memory 注入来源。

### 从消息到最终 Provider 请求

1. `stage.ts` 在提交时保存当前输入并刷新会话快照；Runtime 使用当前 Session 的历史。
2. `getRecallEvidence` 在 Memory 开启时调用 `memory-recall.ts:retrieveRecall`，再经 recallForModel 投影，传给 Core。
3. Note v2 preload 同时提供 noteFormation/noteRecall；stage 仅在 Memory 与 Note Recall 均开启时调用 prepareNoteV2Recall。Formation 开关不决定 Raw/Note 能否读取已有历史。
4. Main 的 recallSnapshot/recallCandidates/recallNeighbors 复用现有 Worker、来源校验和数据库连接。前端再验证原始消息 digest，完成当前请求预算内的最终选择。
5. `packages/core/src/runtime.ts`、`context.ts` 组装策略、当前历史、可选记忆与当前用户输入，调用 Provider。记录测试使用的仅是录制 Provider，不发模型请求，也不改正常提示词。

| 路径 | 读取与启用条件 | 检索/校验 | 注入及上限 |
| --- | --- | --- | --- |
| 当前 Session Context | 当前 activeId 会话；普通用户聊天保留，无需 Memory 开关 | 连续后缀的完整交互；保留角色与工具调用完整性 | 普通 user/assistant 历史；默认 4096 估算 token；全局输入安全上限 14336（16384 减输出预留 1024、安全余量 1024） |
| 正式 Raw Recall | 当前 profile 的 conversations；Memory.enabled | 每回合新建只读检索投影，以 Session 为 BM25 文档；排除 active Session、noteDerived、工具消息/工具调用、不安全文本和当前会话已有的相同正文 | system `[Cross-session recall evidence]`；top 5 会话、至少 2 命中词、分数至少 1；整会话打包，6000 字符/字节；扫描 250000 字符、30ms，超限放弃本次检索 |
| 正式 Note v2 Recall | Memory.enabled 且 noteRecallEnabled；当前 v2 桥接 | 词法/元数据及可选向量候选、真实关系扩展；验证版本、状态、主体和来源 digest；noteDerived 不可成为独立证据 | 单独 system 安全策略加 user-role `[Note recall evidence]` 数据块；最多 3 Note、条目合计 2000 字符，并服从剩余 token 预算；快照 250ms、候选 850ms、邻居 250ms、current 150ms 超时边界 |
| 旧 Reflection Recall | 仅无 v2 桥接的旧 profile，Memory.enabled；不要求 Formation 或旧 Note Recall 开启 | 旧 JSON Reflection 的 BM25 与互补选择，再校验每条原始来源；内存缓存按状态更新，并逐轮重新检查来源 | system `[Historical Aisling reflections]`；最多 3 项、1500 字符/4500 字节，还受全局预算限制 |
| 旧 Note v1 Recall | 仅旧 profile，另需旧 Organization bridge 与 noteRecallEnabled | 旧组织库的 verified heads | 附加在旧兼容记忆上下文内；当前旧真实 profile 没有该库，当前 v2 不走这里 |
| 非 Memory 来源 | 固定 Persona/响应策略、当前输入；可选视觉、工具结果、Desktop/Situation 等 | 各自已有合同 | 不应把 Persona 或临时环境上下文误认为 Note；本次两个真实 profile 的 Desktop Awareness 均关闭，录制测试不执行工具/视觉或 Situation 模型调用 |

Note head 索引最多 2048 项；完整 Recall 快照另有 4MB 限制。未达到完整候选状态时不会把词法漏检当作确定新事实。

## B. 历史数据盘点

以下为回填前实际读取，不是测试夹具计数。时间按记录原值转换为北京时间，不把消息缺失的时间补成迁移时间。

| 项目 | 当前开发 profile（回填前） | 旧默认 profile |
| --- | --- | --- |
| 原始会话 | 5 | 34 |
| 原始消息 | 50：25 user、25 assistant | 306：144 user、162 assistant |
| 会话/消息记录覆盖时间 | 私人时间范围，未补造 | 私人时间范围，未补造 |
| 符合 Raw 安全/角色过滤的消息 | 31；另 19 条 noteDerived，不能再次作为独立记忆证据 | 306 |
| 排除当前会话后的 Raw 候选消息 | 28 | 294 |
| 有单独 message.createdAt | 50 | 173；其余 133 条只能保留 Session 级时间或 unknown |
| Reflection | 0 | 40；无独立 status 字段，recallEligible 均未设置，不能据此虚构 active 状态 |
| Reflection 来源有效性 | 不适用 | 38 条完整来源可验证，2 条来源缺失 |
| Reflection 批次 | 不适用 | 65：26 completed、39 failed（既有历史状态，本轮未修改） |
| 生产旧 Note/Note v1 | 0 | 0：未发现 memory-organization / memory-note-v1 数据库 |
| 当前 Note v2 | 14，全部 active，当前版本均为 1；来源覆盖开发 profile 的 4 个 Session、14 条消息 | 0 |

两组真实 Session ID 无重合；40 条旧 Reflection 的来源与原有 14 Note 来源无重合。当前开发 profile 没有已完成旧 profile 迁移的 memory-migration 标记。因此不能声称这 40 条 Reflection 已经入过当前 Note 库。

旧 Reflection 类型：event 24、preference 5、project-state 5、fact 4、open-question 1、pattern 1；形成时间范围仅保留于私人归档。84 个去重来源引用并非 84 条独立事实，且包含缺失会话引用。

额外检查了项目 `.local` 下的历史盘点快照、形成/评测实验目录，以及上述 AppData profile。`memory-attribution-20261024/conversations-snapshot.json` 有 11 会话/91 消息，是保留快照；formation-completion、formation-failure-analysis、real-memory-eval 等是受控评测副本，不当成新的生产历史导入。当前项目 `.local` 扫描到的生产 lbdb 只有开发 profile 的 Note v2 库。没有从测试 artifacts、备份或缺失来源恢复可能已被删除的会话。

## C. 旧 Reflection 是否参与当前运行时

明确区分两种情况：

- **当前开发 profile：不参与。** v2 preload 不暴露 reflectionStorage/memoryOrganization；stage.ts 的 legacy 创建条件要求没有 noteFormation 和 noteRecall，因而 getHistoryAddon 不会接入。Core 在存在 getNoteContext 时也不调用旧历史 addon。
- **旧默认 profile：仍可参与。** 旧兼容入口会创建 createLegacyMemory → createReflectionRecall → legacyRecallProvider；Memory.enabled 为 true 即可。源文件存在不是推断依据，录制的最终 Provider 请求实际出现了 Historical Aisling reflections。

旧兼容代码仍有实际用途，不能作为“死代码”删掉。本轮不改变 profile 路由、旧 authority 或迁移机制，也没有关闭正式 Raw Recall。**prod 与 dev 默认 profile 的区别仍是待单独处理的统一入口问题。**

## D. 14 Note 之外的信息来自哪里

使用真实持久化数据、隔离数据库副本、真实 Main Note Recall 服务及未修改的前端/Core 检索与提示词组装，完成回填前后各 8 个录制请求；模型输出仅由录制 Provider 返回固定文本，0 次真实聊天模型调用。

每条最终注入证据另存来源类别、Session ID、messageIndex、digest 或 Note/Reflection ID、选择理由及来源覆盖关系。临时材料为 `artifacts/memory-history-backfill/recall-traces-before.json`、`recall-traces-after.json`。这些记录不加进正常提示词。

| 查询（当前开发 profile） | 回填前：Raw 消息 / Note / Reflection | 回填后：Raw 消息 / Note / Reflection |
| --- | --- | --- |
| 查询 Q1（真实主题仅在私人包） | 23 / 0 / 0 | 21 / 0 / 0 |
| 查询 Q2（真实主题仅在私人包） | 12 / 0 / 0 | 20 / 0 / 0 |
| 查询 Q3（真实主题仅在私人包） | 5 / 0 / 0 | 22 / 0 / 0 |
| 查询 Q4（真实主题仅在私人包） | 17 / 3 / 0 | 15 / 3 / 0 |

请求保留当前 Session 的 6 条历史消息。回填前已有查询可命中 Raw，无需先存在对应 Note 或 Reflection；Raw 可能包括助手猜测和用户反驳，不代表事实已经确认。

旧默认 profile 的同类请求则实际注入 1–3 Reflection，并保留其当前 Session 的 12 条历史消息。这验证了兼容链路真实存在，但不能反过来断言用户刚才某一次聊天一定走了它。

Raw 与 Note 是有意保留的两种表示。纯单源可按 rawKey 去重；携带关系或抽象认识可共享来源。一个查询的重合来源由 3 条变为 1 条，不代表重复创建 Note；未发现当前开发 Profile 同时注入旧 Reflection 和 Note v2。

因此，对当前开发 profile，现象最有证据支持的解释是 **Raw Recall 与当前 Session Context**；若实际启动的是旧 prod profile，则还可能是旧 Reflection。未保存用户所述当次请求的完整诊断，不能对那一次调用作绝对归因。Obsidian 从设计上只显示 Note，不是全部可回忆内容清单。

## E. 回填策略与安全措施

新增 `scripts/memory-history-backfill.cjs`，只供离线一次性运行，应用不导入它。

### 备份与阻断

首次检查发现应用/开发服务仍运行且 WAL 非空，实际写入被阻断。用户正常关闭后，WAL 消失；重新查询进程并建立完整备份。普通沙箱不能查询 CIM 时脚本失败关闭，不把权限错误当作“没有运行进程”。

正式运行目录：

`<REPO>\artifacts\memory-history-backfill\run-20261116-verified`

其中 `backup/target` 保存目标数据库、会话存储、authority、作业及删除日志；`backup/source` 保存旧会话存储和 Reflection JSON。plan.json 记录文件 SHA-256、映射、调用量和阶段。备份/响应可能含私有会话及原配置，均在 Git 忽略目录内，不公开或提交，不在日志输出 API Key。

### 来源、去重与授权

- 先对原始 Session ID 做合并检查；相同 ID 且正文不同立即阻断，不能覆盖。保留原当前会话、配置与全部原始消息对象，追加旧 profile 的 34 个完整会话；不从备份复活不存在的 Session。
- 旧 Reflection 只提供候选索引，绝不复制其正文为事实。本次优先选择有完整来源的 fact/preference/project-state/pattern 候选所引用的 25 条用户消息；助手闲聊事件、普通问答和失效引用保留原文但不强行结构化。
- 复用 createNoteFormationService 的 delivered/flush/next/prepare/submit/recover；用 formationInput、现有模型配置、temperature 0.2 和原合同。引用保留原 Session、消息位置、digest 和消息/Session 时间；不从 Session 日期推造事件日期。
- 已被 Note 来源覆盖或已有作业 progress 消费的来源跳过。现有完整 head 索引、sameRecognition、语义关系判断和自动授权规则负责识别已有理解、支持边界与潜在重合；相似本身不授权合并。当前既有事件和旧报告可能保留不同来源/时期，不能简单按主题去重。
- 历史回填只接受 ADD/NOOP/UNDECIDED，阻止 UPDATE/SUPERSEDE/RETRACT，避免旧报告覆盖最新认识；此轮未发生被过滤的破坏性动作。
- 从不调用 decide(..., true)。未获自动授权的 6 项使用现有拒绝接口结束，并保留 dry-run 原因，避免给用户留下逐条批准任务；其他无效提议由原合同拒绝。
- 新关系复用已有 Formation 语义计划和 Organization；不复制 relatedReflectionIds。本次模型调用上限 16 Formation + 1 Organization，实际 12 + 1；不调用 Embedding，不绕过 Organization 的频率限制。

### Dry-run、应用和恢复

先在 `stage` 隔离库形成与组织，再逐项验证：原 14 Note 完整快照未变、原 11 关系未变、来源/上下文都能按 digest 找回、无悬空边、无新增规范化重复认识。语义质量仍受现有模型/自动授权边界约束，不声称程序校验能证明现实真实性。

另在 `apply-rehearsal` 副本实际演练安装 → 重复安装零新增 → restore；恢复后每个目标文件与原备份逐字节一致。真实 apply 前再次检查离线状态、原始来源/目标/备份及 staged 数据哈希；仅安装三个变化文件：会话存储、Note v2 数据库、形成作业。未改 authority 或删除日志。

文件逐个以同目录临时文件 rename 替换，捕获安装失败时回滚已安装文件。跨文件并非一个文件系统事务；若进程在安装中强制中断，先保持 Aisling 关闭并执行 restore，不应先启动聊天。

恢复命令（必须离线；若回填后已有新聊天/其他文件变化，哈希保护会拒绝覆盖，以免丢失新数据）：

```powershell
& .local/memory-database/runtime/node.exe scripts/memory-history-backfill.cjs restore '<REPO>\artifacts\memory-history-backfill\run-20261116-verified'
```

真实回填后另建 `repeat-20261116` 完整重跑计划和隔离 stage：addedSessions=0、selectedSources=0、模型调用=0、Note 19→19、关系仍 17。旧未授权/失败内容不会被无界自动重试；它们保留在 Raw，未来若需重新提取应独立评估合同可靠性和候选范围。

## F. 回填前后与 Obsidian

| 实体/边 | 回填前 | 回填后 |
| --- | ---: | ---: |
| Session | 5 | 39 |
| 原始消息 | 50 | 356 |
| Note | 14 | 19 |
| NoteRevision | 14 | 19 |
| Evidence 节点（含 Context 所用来源） | 20 | 26 |
| HAS_EVIDENCE | 14 | 19 |
| HAS_CONTEXT | 161 | 268 |
| NOTE_LINK | 11 | 17 |
| active Note | 14 | 19 |
| active NOTE_LINK | 11 | 17 |
| 孤立 Note | 6 | 6 |

新增 5 Note（2 fact、3 open-question）、6 真实关系（4 SUPPLEMENTS、2 CONTINUES）。原有 Note 内容、版本、状态、来源完整快照与 11 条关系均未变；全部新 Evidence/Context 可追溯。

新增 ID：

- `PRIVATE-ID-01`
- `PRIVATE-ID-02`
- `PRIVATE-ID-03`
- `PRIVATE-ID-04`
- `PRIVATE-ID-05`

来源覆盖不等于直接迁移旧 Reflection 实体：回填后旧 Reflection 中有 2 条的全部来源、3 条的部分来源被新 Note 覆盖；35 条仍没有 Note 来源覆盖。包含来源缺失的 2 条，不能宣称 40 条都已结构化。详细 source-note-mapping.json 保留原始引用和新 Note ID。

现有 Obsidian Mirror 未改架构。本次仅生成 5 个新受管理文件，未删除文件；最终 19 Markdown、17 WikiLinks 均可解析，重复同步 written=0、removed=0。数据库仍是权威。

## G. 跳过、冲突与失败

- Session ID 冲突：0。既有 Note 覆盖/删除：0。新增规范化重复认识：0。不可追溯的新来源、悬空关系：0。
- 25 条 Reflection 未作为本次优先提取候选：23 条事件/普通问答保留 Raw，2 条来源无效。无效 Reflection ID：`PRIVATE-ID-06`、`PRIVATE-ID-07`；不从快照复活其缺失会话。
- 选择的 25 条用户来源中，5 条成为新 Note 的事实来源；其余 20 条本轮未形成 Note，仍在完整 Raw 中。
- 6 个未自动授权的 ADD 提议跳过并拒绝，原因 review-required；另有 3 个独立草案因 draft-state、proposal-target、draft-current-source 无效而被原合同拒绝。
- 6 个完整 Formation 批次因模型响应不符合合同失败；没有修补返回字段或放宽校验来强行入库：

| 批次 ID 前缀（完整 ID 在 plan.json） | 原因 |
| --- | --- |
| PRIVATE-BATCH | semantic-shape |
| PRIVATE-BATCH | proposal-shape |
| PRIVATE-BATCH | semantic-shape |
| PRIVATE-BATCH | draft-uncertainty |
| PRIVATE-BATCH | proposal-shape |
| PRIVATE-BATCH | proposal-shape |

实际 13 次模型调用，共 24759 input / 9492 output token，模型 qwen3.8-flash；包含失败响应的消耗。原始响应仅保留在忽略目录，报告不输出凭据。未做无界重试或逐条人工批准。

## H. 验证、交付与剩余问题

- 脚本新增单元测试 3/3：原始消息/当前会话/配置保留，Session 冲突阻断，来源失效与 progress 幂等跳过，既有 Note 保护与重复/悬空来源拒绝。
- Note v2/来源删除/生命周期回归连同脚本测试共 12/12 通过，0 跳过。
- 前端 Raw/Note/旧 Reflection Recall 与 Stage Memory 针对性回归 35/35 通过。本轮未改其实现或前端页面。
- 真实数据回填前后录制请求测试各通过一次，共 16 请求；使用实际 Note 服务和隔离数据库，不进行真实聊天模型测试。
- 离线安装、重复安装、逐字节恢复演练通过；真实重跑 0 来源、0 调用、0 新 Note。
- `pnpm typecheck`、`pnpm build`、脚本语法检查通过；保留既有构建大 chunk 提示。本轮未重跑整个仓库所有无关测试，也未进行长周期运行。
- 源旧 profile 的两个历史文件 SHA-256 完全未变；当前原 5 Session 的完整对象、当前 activeId 和 aisling.config.v1 字符串完全未变。

本轮新增文件：

1. `scripts/memory-history-backfill.cjs`
2. `scripts/memory-history-backfill.test.cjs`
3. `docs/memory-history-backfill-audit.md`

原工程中其他未提交修改原样保留，未新增常驻 Memory 链路。脚本依赖当前 Windows 项目布局与已准备好的 `.local/memory-database`，不作为通用迁移框架或线上服务发布。

尚未解决：

1. **不是全 profile 统一。** 当前开发 profile 的正式结构化实体只有 Note v2，Recall 为 Raw + Note；旧 prod profile 的 Reflection 兼容能力仍存在，保留未改。统一默认入口/安全迁移旧 authority 是独立工作，不能通过删除旧 JSON 或关闭 Raw 假装完成。现在观察 19 Note 应继续使用当前开发 profile（`pnpm dev:desktop`）。
2. **不是全部历史都形成 Note。** 旧模型响应格式和自动授权未通过的内容已跳过；没有完整导入所有旧 Reflection 或全部历史语义。原文仍可通过 Raw Recall 检索。
3. **模型语义不等于真相。** 来源和结构验证通过不证明每条语义理解完美。本轮保守避免历史覆盖最新状态，保留引用和真实报告时间。
4. 用户可正常重新启动 Aisling 观察现有镜像；本轮未重新打开真实聊天窗口或进行付费聊天验收，避免回填后引入额外数据变更。
