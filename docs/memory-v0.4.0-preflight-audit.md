# Memory v0.4.0 优化前置审计

> 公开脱敏候选：真实认识、记录标识、机器路径及私有校验值仅在私人归档保留。占位标识只用于本文说明，不可运行或跨页关联；本页仍记录原阶段的测试与限制，不代表本次重新验收。


2026-11-16，Asia/Shanghai。根目录：`<REPO>`。

本轮只审计；除本报告外未修改源码、配置、历史会话、Reflection、Note 或作业进度。没有迁移、回填、付费模型调用、版本修改、提交、推送或分支操作。

证据标记：**[S] 源码确认**；**[V] 测试或真实保存记录验证**；**[R] 风险推断/人工语义初审意见**；**[U] 证据不足**。这些标记不能互相替代，尤其不能把结构校验通过当成语义正确。

## A. 仓库与 Git 状态

### A1. 实际基线

- [V] 分支 `feat/obsidian-memory-mirror`，HEAD `93474d2b29c00a312948f7b745b7948c2d28fff9`，package.json 仍为 v0.3.9。
- [V] v0.3.9 标签指向提交 `2d3c88c0bd8699d82be7bc2c3b107d61577b5499`。HEAD 比标签多两次提交：`d783306` 发布凭据文档、`93474d2` Live2D 路径拆分优化；不能把标签对象 ID 当作提交 ID。
- [V] 审计开始有 **40 个已修改文件、13 个未跟踪文件**，无本轮暂存/提交。包括此前 Settings UI、Obsidian Mirror、历史回填及其文档/测试。相对标签还包含上述已提交差异，故 `git diff v0.3.9` 与仅看工作区修改不是同一口径。
- [V] 对原 53 个变动/未跟踪文件建立内容哈希基线，并监测当前/旧 profile 的 8 个关键路径。审计过程中原工作及真实数据哈希未变；唯一计划新增项为本报告。未把任何旧改动归为本轮实现。

### A2. 报告与收束现状

已读取并对照源码：`docs/obsidian-memory-mirror.md`、`docs/memory-history-backfill-audit.md`、`docs/memory-autonomous-organization.md`、`docs/memory-organization-p6.md`、`docs/memory-associative-network-p7.md` 和启动入口对齐报告。

- [S+V] Note v2、Raw + Note Recall、版本/来源保护、类型化关系、受限自主组织已经存在于 v0.3.9 当前实现，并非 v0.4.0 要从头开发。
- [S+V] Mirror 已能持久化、动态启停和导出，当前配置开启，但仍属于未提交的实验功能。新增模块尚未跟踪，不能仅凭 HEAD 重建这份工作区。
- [S+V] `scripts/memory-history-backfill.cjs` 是离线一次性工具，不被应用 Runtime 导入，不是第三条常驻 Formation 链路。
- [S] 旧报告里的“无 Embedding”“后台不调用 LLM”是对应阶段边界；P7 和当前源码已有可选向量候选、语义后台任务。当前行为必须看开关与调用点，不能套用旧阶段描述。
- [S+V] `.tmp` 的数据审计/录制脚本依赖忽略目录中的私有输入；`artifacts/memory-history-backfill` 保存备份、响应、映射和恢复依据，不宜直接清理。`.local/memory-database.previous-*` / `.stage-*` 是 Worker 资源副本，不是额外生产记忆库。
- [S] 旧 AISLING_OBSIDIAN_MIRROR 环境变量启用机制已被移除，当前真值为 `aisling.config.v1.memory.obsidianMirror`；P0、旧 schema、显式 dev profile 等实验入口仍存在，普通 Main 不等于把它们全部启用。

## B. 当前 Memory 实际架构与职责

| 模块 | 当前职责与状态 | 依据 |
| --- | --- | --- |
| 原始 Session/Context | 当前会话上下文；持久保存原始消息 | `apps/stage-web/src/conversation/conversation-store.ts:73`、`packages/core/src/context.ts:126` |
| Raw Recall | 正式保留；逐回合 Session 级 BM25，不另建持久索引 | `apps/stage-web/src/runtime/memory-recall.ts:5,94` |
| Note v2 Formation | 当前消息异步形成提议；来源、主体与操作校验后才可能入库 | `apps/stage-web/src/runtime/note-formation.ts:20`、`apps/stage-desktop/note-formation.cjs:33` |
| Organization | 认识去重/授权；确定性状态关系；可选语义关系任务与候选投影 | `note-organization-v2.mjs:16,87`、`note-semantic-contract.mjs:52,83,129`、`note-formation.cjs:458,515` |
| Note v2 Recall | 正式保留；验证来源、版本、状态，候选发现及有界图扩展 | `apps/stage-web/src/runtime/note-v2-recall.ts:45` |
| LadybugDB Worker | 固定独立 Node/驱动、唯一现有连接、串行请求与事务 | `memory-database/client.cjs:43`、`worker.cjs:44`、`adapter.cjs:4` |
| 旧 Reflection Formation/Recall | 仍服务未迁移的旧 profile；当前开发 profile 不创建该链路 | `apps/stage-web/src/main.ts:12`、`stores/stage.ts:127`、`runtime/legacy-memory.ts:15` |
| Migration/Archive/Erasure | 权威切换、旧数据可追溯与删除传播；不等于旧 Reflection Recall | `memory-authority.cjs:36`、`memory-migration.cjs:383`、`memory-archive.cjs:6` |
| Obsidian Mirror | 只读数据库、单向输出、观察 Note；不读取 Markdown 形成语义事实 | `memory-database/obsidian-mirror.cjs`、`worker.cjs:51` |

表中未写完整目录的 desktop 文件均位于 `apps/stage-desktop/`。上表事实均为 [S]，对应真实数量见 E/F。

[S] 当前配置 Memory=true、Note Recall=true、Formation=false、Mirror=true。**Formation 能力存在，但当前没有开启日常持续 Formation。** 本报告的响应统计来自此前保存的调用，未为审计打开开关。

## C. Formation 完整调用链与结构失败机制

### C1. 各层实际职责

1. **交付与调度 [S]**：Stage 先持久化交互，成功交付后给 Formation 用户/助手位置；noteDerived 助手不交付为独立证据。Renderer 的 provider 仅在设置加载、Memory/Formation 开启且 Chat Provider 可用时挂接。见 [stage.ts:119](../apps/stage-web/src/stores/stage.ts:119)、[stage.ts:446](../apps/stage-web/src/stores/stage.ts:446)。
2. **持久入队 [S]**：Main delivered 校验 ID、索引、原始消息与输入预算；通过后推进 progress，按 Session 聚合，每 3 个交付单元成为 pending。切换/新建会话 flush，重启也把 collecting 变 pending。见 [delivered:818](../apps/stage-desktop/note-formation.cjs:818)。
3. **准备输入 [S]**：Renderer 解析当前引用与 digest；withRelatedHistory 仅在“尝试/目标/计划 + 完成/失败/结果”等经历条件下补相关跨会话历史，不是一般指代消解。Main prepare 取完整可信 head 索引，但模型最多看到 5 个候选，附其原始 grounds，并在超预算时减少候选/可选历史。见 [formation-evidence.ts:18](../apps/stage-web/src/runtime/formation-evidence.ts:18)、[prepare:866](../apps/stage-desktop/note-formation.cjs:866)。
4. **请求与前置解析 [S]**：同一个 active ChatProvider 完成模型请求，Renderer 本地先 parseNoteBatch/parseSemanticRelations，再复查来源，最后 submit；前端不授予写权限。见 [generate:40](../apps/stage-web/src/runtime/note-formation.ts:40)。
5. **Main 重建与校验 [S]**：以 prepared refs、候选 Note ID/version 和当前原始消息重建 context，重解析；精确重复 ADD 可转 NOOP；生成真实 ID、operationId、期望版本、Evidence 与 Context lineage。非法 sibling 可独立 rejected。见 [reconstruct:244](../apps/stage-desktop/note-formation.cjs:244)、[submit:917](../apps/stage-desktop/note-formation.cjs:917)。
6. **自动授权 [S]**：settle 重新读取完整索引和当前来源，通过当前规则才调用 Store；不确定则 item.review，不能由 Renderer/model 自报允许。见 [settle:325](../apps/stage-desktop/note-formation.cjs:325)。
7. **存储与组织 [S]**：Store 重验原始报告、主体、来源和 Context；Worker 协议 allowlist/Schema 校验；数据库事务内写 Note/Revision/Receipt/关系。版本改变使旧关系 stale、相关投影失效；成功结果登记 Organization 任务。见 `memory-database/store.cjs:263`、`protocol.cjs:124`、`note-v1.cjs:175`、`note-formation.cjs:312,515`。

### C2. 当前模型、参数与输出合同

- [S+V] 当前配置为 **qwen3.8-flash**、DashScope 北京 workspace 的 OpenAI-compatible endpoint，配置凭据存在；报告不披露工作区凭据。模型是配置值，不是 Formation 硬编码。
- [S] Formation 请求覆盖普通聊天采样参数：temperature=0.2、maxOutputTokens=1500、45 秒；语义 Organization 30 秒、1500 token，最多每分钟一次/每小时 8 次。验证过的该 qwen3.8 route 设 enableThinking=false。`provider-factory.ts:28,54`、`runtime/note-formation.ts:61`、`note-semantic-contract.mjs:3`。
- [S] 当前共享 Provider 使用 `max_completion_tokens`，没有请求 `response_format` 或 JSON Schema 约束；输出可靠性主要依赖 Prompt 和本地验证。见 [Provider:128](../packages/core/src/providers/openai-compatible-provider.ts:128)。是否支持远端约束输出，本轮没有接口能力验证，不能假定支持。
- [S] Formation 的顶层是严格 `{items:[...]}`，最多 3 项，0 项合法。每项必需 draft/action/target/reason，允许 related/semantic。ADD 的 target 必须 null，其余非 UNDECIDED 动作必须引用 N；UNDECIDED 要求 null draft/target。
- [S] draft 必需 content/kind/basis/subject/eventTime/tags/sources；subject 是 S 主体标签，不是标题或自由实体名；tags 1–6，content≤800；state、uncertainty 为条件字段。引文必须真正在 E 消息中，并至少有一份当前来源。pattern 或 inferred/mixed 需要非空 uncertainty 和不同用户报告。
- [S] semantic 是可选解释，但一旦提供就须有全部 5 字段；scope 非空，sources 至少一条完整原始用户分句。independent 的 target=null、targetSources=[]，**不是 sources=[]**。非 independent 必须有真实候选目标及目标 grounds 引文。见 [主合同:85](../apps/stage-desktop/note-formation-contract.mjs:85)、[语义合同:26](../apps/stage-desktop/note-semantic-contract.mjs:26)。
- [S] 输入上限：12 来源、Evidence 6000 字节、输入 15000 字节；输出 16000 字符。complete 表示索引构建完整，不表示模型见到了所有 Note，更不表示语义搜索穷尽。

### C3. 真实失败响应的逐样本结论

[V] 读取 `artifacts/memory-history-backfill/run-20261116-verified/responses/1.json` 至 `13.json`、plan.json、实际 jobs/decisions。没有在本报告复制私有会话正文或 Key。

| 调用号 | 保存错误 | 实际违约 | 归因边界 |
| --- | --- | --- | --- |
| 2 | semantic-shape | 前两项 independent 的 scope 为空，sources 也为空 | [V] scope 先失败；补 scope 后仍会遇到 semantic-sources，不能只修一个空串便称通过。第三项的完整逐字段失败上下文未保存 |
| 5 | proposal-shape | items=7：2 ADD + 给 5 个历史候选逐一 NOOP | [V] 合法 JSON，顶层条数违约；不是 JSON.parse 故障 |
| 6 | semantic-shape | 两项 independent 都是空 scope、空 sources | [V] 可选 semantic 被填写成无效解释，阻断了提议 |
| 8 | draft-uncertainty | 第一项为 pattern/direct，却没有 uncertainty | [V] pattern 同样要求不确定性，不能以 direct 免除；其他项的精确逐项错误未保留 |
| 9 | proposal-shape | items=8：当前提议加历史候选 NOOP，超过 3 | [V] 与调用 5 同类 |
| 11 | proposal-shape | items=6：1 ADD + 5 个历史候选 NOOP | [V] 与调用 5 同类 |

[V] 13 个保存响应均有可解析的 Provider 信封、finish_reason=stop；12 个 Formation 正文都是可解析 JSON，本批没有截断、超时或 HTTP 失败记录。其“结构失败”发生在合同/引用规则，不是 JSON 语法解析阶段。

[S+R] Prompt 已明确最多 3 项、不重发历史候选、semantic.scope 非空，所以不能把所有失败说成合同相互矛盾；但一个输出同时承担抽取、动作选择、去重、目标绑定、实体/状态、双端引文和关系解释，条件组合较多，示例却主要覆盖简单 ADD。模型反复给所有 N 候选出 NOOP、给 independent 填空解释，说明**条件合同的可执行示例与输出约束不足**是明确改进方向。严格来源保护本身不是应删除的缺陷。

[S+R] tags 强制非空、各种省略/null 区别、pattern 的额外不确定性/多来源约束、same/independent 的不同目标与引文要求，都会增加模型负担。wire、Main 授权、DB 各自的允许集合也不完全同宽，例如同会话不同报告能通过提议解析，但推断自动入库通常还要求跨 Session。应对齐说明与错误层级，不把授权拒绝包装成格式失败。

### C4. 不混算成功率

这仅是一轮筛选过的 25 条历史用户来源样本，Backfill 绕过 Renderer 调度，使用 Main Formation 合同；传输脚本为 max_tokens，而共享 Provider 为 max_completion_tokens。不能把它当成长期线上故障率或完整端到端性能结论。

| 层 | 本次分母与结果 | 不代表什么 |
| --- | --- | --- |
| Provider/JSON | Formation 12/12 有完整合法 JSON；另 1 次 Organization | 不代表 Schema、语义或授权通过 |
| 顶层结构 | Formation 9/12 满足最多 3 项；3 次过载 | 不代表全部 item 合法 |
| 可提交 Formation 批次 | 6/12；其余 3 次全部 item 未通过、3 次顶层过载 | 不是“JSON 成功率 50%” |
| item 校验（仅这 6 批） | 14 项中 11 项有效、3 项 INVALID | 不能忽略失败批中的其余 item 再推算全局比例 |
| 自动授权（有效 11 项） | 5 applied，6 review-required | review 不是已证明语义错误；6 项后来由回填工具拒绝，并非用户逐条判错 |
| 持久化（获准 5 项） | 5/5 新 Note，旧 14 Note 未覆盖 | 不证明这 5 项独立语义质量全部优秀 |
| Organization | 1 次独立语义调用通过；加 Formation 附带计划，总计新增 6 关系 | 不是全部历史关系完成整理或长期关系正确率 |

[V] 另外核对 P6 原始账本：deepseek-flash，8 次付费调用=4 Formation/明确更正、1 独立后台、3 回答；HTTP 均 200，但只存下 1 条阶段性 Note，两个执行错误为 draft-current-source。后台曾有方向与理由不符；之后缓存回放 paidCalls=0，部分场景 reconstructed=true。与当前 qwen/合同版本不可混成同一个分母，也不能把回放写成新增真实语义验收。

## D. 自动授权、失败恢复与认识质量

### D1. 实际自动规则

依据 [authorizeOrganization:87](../apps/stage-desktop/note-organization-v2.mjs:87)、[authorizeSemantic:52](../apps/stage-desktop/note-semantic-contract.mjs:52)。均为 [S]：

| 动作 | 允许边界与保护目标 |
| --- | --- |
| ADD | 完整可信索引、已确认主体。精确重复不新增；更正/撤回措辞不直接走 ADD。字面分句/完整报告优先，状态须原文 scope/value；同 scope 已有值和高度词面重叠限制写入。带有效 semantic 时可接受保留计划/否定/历史模态/数字等边界的释义；这不是程序证明语义蕴含 |
| 推断 ADD | 主要为带 uncertainty 的 pattern，用户多报告且跨会话；不能用助手回声充事实。字面/语义分支有不同补充条件 |
| NOOP | 同认识且字面支持，或通过 semantic same 与目标兼容检查；补证仍需 Store 验源。重复事件不能仅靠语义 same、未知 eventTime 直接合并；精确比较支路仍须纳入未来事件身份测试 |
| UPDATE | 已有 direct、同主体/同 kind/同 state.scope，新内容有字面支持，明确更正并提到旧值；普通释义或一般矛盾不够 |
| SUPERSEDE | 同上，值有变化，明确从旧值改为新值；不因新提及主题就废弃过去经历 |
| RETRACT | 明确撤回控制语句、原 scope/旧值；不是任意冲突就删除 |
| 人工 approve | 既有审核与原生确认入口；仍重查版本、主体、来源、指纹和删除屏障，不是免校验写入 |

[S] semantic 不能单独授权破坏性操作。字面、语义、Store、Worker 中存在重复校验，但分别守护模型/Renderer、持久作业、当前来源、协议与数据库事务边界；**不能为了减少拒绝率把这些验证整体删掉**。可优化的是共享规则的一致性、Prompt 可理解性与分层错误表达。

### D2. 父作业与子提议不是同一状态

| 情况 | 实际推进/恢复 | 证据 |
| --- | --- | --- |
| 入队前来源/输入不合格 | delivered 拒绝；Renderer 的 Promise 失败被吞掉，未形成持久失败批次 | [S] `runtime/note-formation.ts:120`、Main delivered |
| 普通 JSON/合同/Provider/超时失败 | running → failed，删除 prepared；没有普通 Formation 的自动重排入口 | [S+V] `note-formation.cjs:964` |
| 模块关闭/Provider 切换取消 | abort 后记录 cancelled；仍为 failed，不因重新开启自动重排 | [S] 前端 `setProvider:112`、`generate:78` |
| 进程中断的 running | 下次构造服务标记 failed/interrupted；collecting 则转 pending | [S+V] Main `:129` |
| 提议有部分 INVALID | sibling 独立 rejected，合法提议继续；父批可能 completed | [S+V] `parseNoteBatch:153`、`submit:917` |
| review-required | item.review，父批 completed；可人工复核；index-incomplete 有单独后台再授权机会 | [S] `settle:325`、`organize:528`、`decide:790` |
| 已持久化但 IPC 丢回复 | Receipt/指纹确认、settling/outcome-unknown 恢复，不盲目重放写入 | [S] `recover:408`、`settle:325`、DB operation receipt |
| 语义/确定性组织失败 | 有各自有限尝试、频率/签名控制；语义 running 中断按最多 2 次恢复 | [S] `:120,458,565,964`，不能套用为普通 Formation 也有同样重试 |

**[S+V，优先处理]** progress 在 LLM 生成前已经前推；next 只取 pending，同一消息重新 delivered 会因索引小于 cursor 被忽略。隔离真实 Worker 测试确认：provider-error 后 next=null、重交原来源仍无新工作；另一个 running 批次关闭/重开后是 interrupted，next 仍 null。原始消息没有丢失，Raw 仍可检索，但**合法来源在默认自动 Formation 中失去再次尝试机会**。不能把“可恢复存储/组织”误称为“所有形成失败可恢复”。

**[S+V，诊断不足]** 当前作业共 21 批：14 completed、7 failed；所有失败 attempts=1。6 个回填合同错误在正式 jobs 中被工具统一记成 provider-error，细分原因只留在 plan.json；正常 Renderer 则把多数语义/字段错误折叠为 invalid-proposal。完整输入快照又未单独保留，失败时 prepared 被删除，不能从一个错误名重建全部违约。

**[S+V，状态显示不足]** `reviews()` 的 failed 只看最后一批（`note-formation.cjs:782`）。当前最后一批 completed，所以即使有 7 个 failed，UI 的该布尔值仍为 false。completed 是处理完提议，不是每项均已形成 Note。

[R] 作业文件总上限 2MB，当前约 170KB；未来长期增长可能造成更新/入队失败，不应直接移除上限。先补失败可见性、明确生命周期和有界恢复，再决定更大规模持久化策略。

### D3. 语义质量与上下文不足是另一项工作

- [S+V] Prompt 明确偏好 source-literal，授权字面支路也鼓励复述。现有 Note 中确有脱离对话后无法独立解释的指代性片段。这不是改 JSON 格式就能解决的问题。
- [S+V] 19 Note 的 subject 都是 profile-user；合同当前确认主体只有 profile-user/aisling。subject 是报告主体，不是项目名或标题，tags 也不等于事件主体。不能把缺少独立语义简单归因于“模型不支持实体”。
- [S] 模型看最近批次和有限候选/引文；一般同 Session 的更早指代上下文不会自动完整补进来，跨会话历史补充又有经历触发门槛。索引 complete 不等于全量语义候选。
- [S] HAS_CONTEXT 保存依赖 lineage，但不等于 Recall 会把这些完整对话都展示给模型；“数据库有 Context”不能证明提议抽取和最终阅读都有足够上下文。
- [S+V] noteDerived 防回流是必要安全机制；`stage.ts:446` 还把“同一 Session 已有派生消息”传播到后续助手回复。当前开发新增的 25 条助手发言中有 19 条被派生标记。它限制了助手自述成为独立证据的机会；不能因此放开派生来源验证。
- [S+R] 新 v2 对助手单源材料要求完整、明确归因的 direct event，通常不能像旧 Reflection 那样自由总结助手发言。≤800 content 与较长原话也限制覆盖。是否需要更高质量的 Aisling 交互经历认识，应由用户/架构设计者定义，不应为追求 Note 数量绕过保护。

结论：**A 输出可靠性、B 语义抽取质量、C 自动授权、D 作业恢复必须分别验收**。增加可解析 JSON 不等于更有价值的认识，减少 review 也不等于更安全。

## E. Reflection/Note 功能覆盖与全量复审清单

### E1. 当前数据重新核对

[V] 当前开发 profile 为 39 Session/356 消息；旧默认 profile 仍为 34/306/40 Reflection。34 个旧 Session 在开发 profile 全部存在，完整对象与旧文件相同，无新分叉内容；另 5 个 Session 只在开发 profile。旧两个 JSON 的 SHA 与上轮备份一致。

[V] 当前真实库存在非空 WAL（114 字节）。本轮未对真实库开写连接；复制主文件/WAL，验证复制前后哈希稳定，在隔离临时副本恢复/读取后清理副本，得到 **19 active Note、17 关系，来源/Context 无失效**，Note/关系与回填 after.json 完全相同。Obsidian 也有 19 个管理 Note ID。真实数据库、WAL、作业、会话、配置未被本轮修改。

[V] 40 Reflection 仍有 38 条完整有效来源、2 条缺失来源。与 Note 的**来源**覆盖仍是：2 条全部来源覆盖、3 条部分覆盖、35 条无覆盖。这不是语义迁移率；上轮 34/306 合并是 Raw 数据合并，5 Note 增加也不是 40 Reflection 完整迁移。

### E2. 不能直接删哪些“Reflection”模块

旧业务闭环的入口和注入细节（均 [S]）：

- `main.ts:14` 仅在没有 v2 Formation/Recall bridge、存在旧 bridge 时加载 legacy；`stage.ts:127` 再次做互斥创建。`legacy-memory.ts:47` 用 Desktop reflectionStorage 读写旧 JSON，`reflection-formation.ts:136,244,254` 调用当前 ChatProvider、解析后 append-only 保存 Reflection；启用由 Memory/Formation 控制，旧 Organization 已就绪时走其 prepare/settle 分支（`legacy-memory.ts:71`）。这套业务仍可在旧 profile 中创建数据，不能称为全局死代码。
- `legacy-memory.ts:96–112` 每次请求从 `formation.inspect()` 的持久状态读取 Reflection。Reflection Recall 只要求 Memory 开启和会话存储正常，不要求 Formation 或 Note Recall 开启；后两者关闭不等于停止旧 Reflection 召回。
- `reflection-recall.ts:63,98` 只索引完成且符合 recallEligible/结构要求的认识，以正文与 tags 的 BM25 式分数、主题门槛和组合去重选候选，再逐一验原始消息角色、digest、派生标记及 pattern 多报告条件；最多 3 项、1500 字符/4500 字节，候选池最多 6 项。不是从旧 JSON 直接全文注入。
- `packages/core/src/legacy-recall.ts:41,55,80` 将旧认识作为带不可信认识政策的 system 消息注入；有 Raw 时先预留一半剩余预算，之后回收未用空间。旧 Note Recall 开关开启且 bridge 可用时，可追加旧 Note 候选，但两者合计仍最多 3 项/1500 字符；这是 **旧兼容组合**，不是当前 v2 与 Reflection 同时运行。旧 Note 的来源与 Reflection/Raw 去重由 `runtime/note-recall.ts` 处理。
- 当前正式链路则由 `packages/core/src/runtime.ts:244,265,371` 把 Raw 放入标明跨会话证据的 system 消息，Note 放入独立证据政策加 user 证据消息；均在当前请求后缀之前装入。Raw 先受剩余预算分配，Note 再选，未选出 Note 时回收 Raw 空间。它们不成为新的 Persona 或当前用户指令。

后续退役的依赖边界：

- [S] 旧 runtime/reflection-formation、reflection-recall、reflection-store、legacy-memory、旧 note-organization/note-draft/note-recall 形成兼容业务闭环。待旧 profile 不再走它、全部记录有处置后，才是退役候选。
- [S] `formation-evidence.ts` 已独立承载新 Formation/Recall 的 sourceRef/历史证据；旧 reflection-formation 仍转导出 helpers，老消费者/测试仍引用。退役应检查全部调用，而非按文件名删除。
- [S] `memory-database/note-v1.cjs` 实际包含当前 v2 的操作校验、快照列、事务和修订，不可因名字有 v1 就删除。
- [S] `memory-archive.cjs`、memory-lifecycle、删除日志和迁移状态负责旧来源删除传播/恢复；Reflection 不再召回不意味着这些责任可以消失。
- [S] Core 的 legacy-recall 扩展出口、诊断类型和旧测试也在依赖面中。还要处理 preload reflectionStorage、Desktop storage IPC、env.d.ts、LegacyMemoryControls、旧配置 organizationEnabled、包 exports 及迁移/生产冒烟测试，不能只删一个 recall 函数。

### E3. 40 条逐条索引（不复制私有正文）

定位源：`<LEGACY_PROFILE>/aisling-reflections.v1.json`。原始 ID、语义摘要及 Note 映射仅保留于私人归档；公开版用审查序号保留追溯状态和待核验风险。

来源覆盖列是 [V]。语义列为 **[R] 人工初审候选**，不是自动迁移核准：F?=基本完整表达候选；P=仅部分认识/角色信息；N=未找到明确等价 Note；J=价值/上下文/认识类型需判断；X=来源无效。D=重复候选，T=时间有效性需复核；都不是删除授权。

| # | Reflection ID | 来源覆盖 | 语义候选 | 后续复审重点 |
| --- | --- | --- | --- | --- |
| 1 | 私人映射 | 0/2，无效 | X | 缺失来源，不从备份复活可能已删数据；具体认识仅在私人包。 |
| 2 | 私人映射 | 0/1 | N | 长期价值与有效性待复核；具体认识仅在私人包。 |
| 3 | 私人映射 | 0/2 | N/T | 动态状态须核验报告时间及后续修正；具体认识仅在私人包。 |
| 4 | 私人映射 | 0/3 | N | 独立命题、主体与归属范围分开核验；具体认识仅在私人包。 |
| 5 | 私人映射 | 0/3 | N | 自述理解与外部断言分开；具体认识仅在私人包。 |
| 6 | 私人映射 | 0/2 | J | 提问与助手未知不等于用户经历；具体认识仅在私人包。 |
| 7 | 私人映射 | 0/2 | J | 提及对象与助手外部知识分开；具体认识仅在私人包。 |
| 8 | 私人映射 | 1/2 | P/T | 已有局部覆盖不等于整条覆盖；具体认识仅在私人包。 |
| 9 | 私人映射 | 0/1 | N | 指代消解须有原始上下文；具体认识仅在私人包。 |
| 10 | 私人映射 | 0/2 | J | 助手解释不等于已采用策略；具体认识仅在私人包。 |
| 11 | 私人映射 | 0/2 | J | 单次沟通修正不证明永久特征；具体认识仅在私人包。 |
| 12 | 私人映射 | 0/2 | J | 称赞和玩笑不等于稳定偏好；具体认识仅在私人包。 |
| 13 | 私人映射 | 0/4 | J | 外部问答须独立核实；具体认识仅在私人包。 |
| 14 | 私人映射 | 0/1 | J | 对象指代不足须回原文；具体认识仅在私人包。 |
| 15 | 私人映射 | 0/1 | J | 仅助手来源不能机械复制为 mixed；具体认识仅在私人包。 |
| 16 | 私人映射 | 0/1 | N | 交互要求须核对实际用户证据；具体认识仅在私人包。 |
| 17 | 私人映射 | 0/3 | J | 助手转述不能证明真实经历或测试事实；具体认识仅在私人包。 |
| 18 | 私人映射 | 0/1 | N | 对象澄清仍须评估独立价值；具体认识仅在私人包。 |
| 19 | 私人映射 | 0/1 | J | 助手承认编造不证明外部知识；具体认识仅在私人包。 |
| 20 | 私人映射 | 0/4 | J | 实验条件和角色自述不等于事实；具体认识仅在私人包。 |
| 21 | 私人映射 | 0/3 | N | 当次关注点与开放问题分开；具体认识仅在私人包。 |
| 22 | 私人映射 | 0/1 | J | 助手单次玩笑不能直接推定用户行为；具体认识仅在私人包。 |
| 23 | 私人映射 | 0/4 | J | 局部误解和纠正仍需外部验源；具体认识仅在私人包。 |
| 24 | 私人映射 | 0/2，无效 | X | 来源缺失，保留不可验证状态；具体认识仅在私人包。 |
| 25 | 私人映射 | 0/2 | N/T | 变化与保留分别核对时间；具体认识仅在私人包。 |
| 26 | 私人映射 | 0/2 | J | 助手推荐与用户确认分开；具体认识仅在私人包。 |
| 27 | 私人映射 | 0/1 | N/D1 | 相似候选先查同义和重复，不各造一张；具体认识仅在私人包。 |
| 28 | 私人映射 | 0/1 | J | 助手承诺不等于已经履行；具体认识仅在私人包。 |
| 29 | 私人映射 | 0/2 | J | 测试意图与事实分开；具体认识仅在私人包。 |
| 30 | 私人映射 | 0/1 | N/T | 更正与较新反驳须同读；具体认识仅在私人包。 |
| 31 | 私人映射 | 0/4 | J | 讨论的角色和时间需验证；具体认识仅在私人包。 |
| 32 | 私人映射 | 0/2 | J | 角色玩笑不能升级为外部所有关系；具体认识仅在私人包。 |
| 33 | 私人映射 | 0/6 | J | 共现不足以证明独立模式；具体认识仅在私人包。 |
| 34 | 私人映射 | 0/2 | J | 助手模式概括不能自证稳定；具体认识仅在私人包。 |
| 35 | 私人映射 | 2/2 | J | 来源覆盖与用户观点的认识地位分开；具体认识仅在私人包。 |
| 36 | 私人映射 | 2/3 | P | 命题重合不等于已迁移相同事件；具体认识仅在私人包。 |
| 37 | 私人映射 | 0/1 | N/D1 | 与相似候选核验同义、更新或独立报告；具体认识仅在私人包。 |
| 38 | 私人映射 | 1/1 | F? | 旧未知状态和当前有效性分开；具体认识仅在私人包。 |
| 39 | 私人映射 | 0/4 | J | 提问与预测混合须拆清；具体认识仅在私人包。 |
| 40 | 私人映射 | 1/2 | P | 部分来源覆盖不等于预测得到证明；具体认识仅在私人包。 |

初审分组：F? 1、P 3、N 12、J 22、X 2，总计 40。**没有据此把任何记录自动标记为可删除。** 不能仅凭 T 判过时，也不能仅凭 D 判重复；确认“无长期价值”属于用户/设计者尚未做出的处置决定。

## F. 启动、Profile 与数据库权威

### F1. 命令事实

| 命令 | 实际行为 | 默认数据 |
| --- | --- | --- |
| pnpm start | package.json:9 → pnpm dev:desktop | 当前开发 profile，不是默认生产 profile |
| pnpm dev:desktop | Node launcher 启 Vite + Electron，AISLING_STAGE_URL 为开发 URL | configureDevProfile 选 `.local/desktop-dev-profile`；显式 AISLING_DEV_PROFILE 可覆盖 |
| pnpm start:desktop | launcher --prod，先构建，再加载 aisling://stage | 不调用 configureDevProfile，默认 Electron userData；本机为旧 AppData profile |

[S+V] 所以不能把“统一 pnpm start”理解为把 alias 改成 dev；它已经如此。差异来自 [launcher:135,163](../scripts/dev-desktop.mjs:135)、[Main:619](../apps/stage-desktop/desktop-app.cjs:619) 将数据选择与 renderer 模式绑定。

[S] canStartNoteV2 看 authority/迁移状态/已有文件，**不是打开某开关就把旧文件当成 v2**。无旧数据的新 profile 可激活 v2；已有 legacy JSON 且无已验证迁移状态会拒绝强开。现有 migration 使用摘要、来源证明、Receipt、逐项校验和最后写 authority，且拒绝目标库已存在，不是把两套有数据的 profile 直接合并。见 `memory-authority.cjs:36,43`、`memory-migration.cjs:399,465,501`。

[S] Worker 随 Main 服务启动/恢复，Formation/Recall 授权单独控制；关闭应用会等待服务关闭。Mirror 复用 Worker 的串行读取和计时器，关闭清理。Native 驱动锁、请求 allowlist、事务/版本/删除屏障是稳定保护，不应为入口统一重写。

### F2. 统一入口的最小边界与取舍

[R，建议，不实施] 保持 dev 的 Vite/HMR 与 prod 的构建协议差异，**抽离“正常使用的数据 profile/authority 选择”使其不依赖 renderer 模式**。在 userData 与 single-instance lock 确定之前统一选择。不是重做 Memory，也不是给两边各复制一份库。

有两种合理方案，必须先由用户确定：

| 方案 | 优点 | 风险/代价 |
| --- | --- | --- |
| 以现有 39 Session/19 Note profile 为权威，先统一所有正常入口 | 数据合并最少，保留已验证 v2、作业、删除日志和 Mirror 设置 | `.local` 并非理想长期用户数据目录，项目清理/移动风险需决定；不能默默改变 prod 的配置来源 |
| 将已验证的这份 v2 bundle 迁到确定的正式用户目录，再统一入口 | 正式数据与仓库分离，长期边界更清晰 | 必须离线备份、冲突检查、单一权威切换和回退；旧 AppData 不是空目标，不可覆盖 |

需纳入同一恢复边界：原始 Session/activeId、完整配置/凭据/语言与展示设置、Note 数据库及 WAL 生命周期、authority/迁移状态、作业/操作映射、删除日志与旧 archive 删除责任。Mirror 的 enabled/vault 位于现有 config.memory.obsidianMirror，应从当前权威配置保留，不改写 Vault，也不复制导出文件当数据源。

[V] 当前两边已有明确差异：旧 profile 缺当前 5 Session/50 消息和全部 19 Note，且 Formation=true；当前 profile Formation=false、Recall/Mirror=true。不能“选择最新配置文件”就自动决定各字段。未来若两边继续使用，还可能新增冲突；必须在切换点冻结并做最终增量/哈希检查。

[S+V] 上轮备份仍存在，但当前主库/配置文件哈希已与当时 staged 版本不同；语义 snapshot 仍相同。restore 的保护会拒绝直接覆盖后续变化。本轮没有尝试 restore。**Git 回滚、Worker 资源回滚与用户数据回滚是三个边界**；后续改动必须先做新的数据备份，不能靠旧命令或 git reset 回退数据库。

## G. 下一阶段修改面与保留面

| 范围 | 建议处理 | 暂不触碰/保护 |
| --- | --- | --- |
| Formation 合同 | Prompt/示例、Schema 条件表达、分层错误、离线失败样本测试 | 不能靠截断多余 item、伪造 scope/引文、放宽来源来“修复”模型输出 |
| 作业生命周期 | source cursor 与 attempted/成功处置的区别；有界重试、取消/重启恢复、失败可见性 | 不批量清空 progress/Receipt；不把所有 failed/rejected 当可盲目重跑 |
| 认识质量 | 指代片段、主体/时间/认识类型、助手经历覆盖的独立评价集 | Raw 原文、noteDerived 防回流、用户报告/助手发言的认识地位不混同 |
| Profile 入口 | launcher/Main/userData/authority/配置恢复/单实例与迁移测试 | 不重写 Worker/数据库层；不同时运行两个指向同库的 writer |
| Reflection 退役 | 按 40 项逐条处置，解绑旧 runtime/UI/IPC/exports/测试 | archive、privacy、来源删除、通用 Evidence helpers、实际 v2 note-v1 模块保留 |
| 工程收束 | 对当前完整工作区建立可审查快照/变更分组；标记脚本用途和私有产物 | 本轮不提交、不清理实验分支、资源副本、原始数据或恢复材料 |
| Recall/Mirror | 作为回归验收面，确认兼容隔离及快照同步 | 不另起 Recall 优化、不关闭 Raw、不改前端 Memory 页或 Mirror 导出架构 |

### Raw + Note 的现状确认

- [S+V] Context、Raw、Note 是有意保留的不同输入，Note 尚未形成或 failed 不使 Raw 数据消失。上轮录制请求已证明有 Raw、无对应 Note 也能提供历史内容；本轮原文和记录未变。
- [S] Raw top5 Session/6000 字符及字节，排除 active Session、工具/派生/不安全来源；Context 保留完整交互后缀，默认 4096 估算 token，全局输入 14336。
- [S] Note 最多 3 项、合计 2000 字符及剩余 token；source/digest/version/status/current 快照校验，纯单源发言 rawKey 去重。有图关系/独立理解的 Note 可以与 Raw 共用来源，不等于重复创建 Note。`note-v2-recall.ts:139,179,192`、`packages/core/src/runtime.ts:244`。
- [S] 图扩展有种子、邻居、关系类型、版本、时间/两跳边界，历史 Revision 特别校验；失效/撤销关系不当作 active 注入。现代 v2 工厂与 Core addon 的双重条件阻止同请求再走旧 Reflection；`stage.ts:127`、`runtime.ts:378`。
- [V] 当前 19/17 的来源/Context 都有效，记录与上轮一致；未发现当前数据中的失效/重复 Note 写入。[U] 本轮没有运行新的真实聊天或全量图行为基准，不能宣称所有图扩展相关性、长期状态新鲜度均已验收。

## H. 推荐顺序与最小验收

建议顺序为 **先 P1 最小可靠性轮 → P3 唯一数据权威 → P2 需要真实写入的复审回填/最后退役**。P2 的只读语义复审、P3 的目录决策可提前并行准备；这不意味着本轮开展实现。

### 第一轮：P1a，分层可诊断和有界可恢复

- 目标：将结构/来源/授权/存储错误分开；失败不再被游标静默消费后永久搁置；先不动语义权限。
- 证据：[S+V] 具体 6 个保存合同错误、7 failed 且 attempts=1、UI 只看最后一批、隔离恢复复现。
- 修改面：note-formation-contract、note-semantic-contract、Renderer note-formation、Main jobs/fail/recover/next 及针对性测试；Provider 若选约束输出才另加其参数/能力测试。
- 复用：现有 prepared refs、operationId/Receipt、来源校验、索引、语义限流与状态文件；不新建任务服务。
- 风险/回退：盲目重试导致重复/成本增长；不重置真实游标，设置总量/单来源上限。代码回退与作业/数据升级分别备份。
- 最小验收：真实保存样本离线分类到字段/阶段；格式错误不记成 Provider failure；失败、取消、重启、重复提交均有可见结果，重试不会重复 Note 或接受改过来源；现有授权/删除/事务测试保持通过。结构改善与语义质量分别计数。

Prompt/示例改进是最小选项；Provider 端 JSON Schema 约束可能减少格式违约，但需验证 endpoint 能力、回退和条件字段表达，不能解决语义/来源/作业问题。两者取舍先以离线样本与可用 Provider 能力为依据，不直接更换模型或无界增加修复调用。

### P1b：认识质量验收，与 P1a 分开

- 目标：让认识能独立阅读、主体和时间明确，减少无指代锚点的原话片段，同时不把助手猜测升级为事实。
- 修改面：输入上下文与候选组织、Prompt/质量样本、必要的授权说明对齐；是否增加实体/经历类型是后续共同决策，非首轮默认扩 Schema。
- 复用：kind/basis/subject/eventTime/state、Evidence/Context 和现有语义判断。
- 风险/回退：抽象质量与自动写入范围扩大是两件事；逐条金标准比较，不因多存 Note 判成功。
- 最小验收：覆盖指代、跨批上下文、计划/反事实、相同事件/不同报告、助手承诺、用户观点与开放问题的固定测试集；分别报告格式、认识质量和自动授权结果。

### P3：统一正常运行的数据权威，再做生产复审写入

- 目标：pnpm start、dev:desktop、start:desktop 读取同一被用户选定的权威 Memory，不再因开发/生产模式分叉。
- 证据：[S+V] 39/356/19 与 34/306/旧 Reflection 两份真实 profile；配置值不同。
- 修改面：Main profile 选择、启动脚本的模式/显式隔离覆盖、配置和 authority 检查、迁移/恢复/单实例测试；不是改 start alias 一行。
- 复用：现有 v2 bundle、备份摘要、来源验证、authority gate、Worker 锁及既有迁移校验。
- 风险/回退：目录覆盖、旧配置倒灌、不同 profile 并发、新旧 authority 错配；选定唯一目的地后做新的离线备份，旧目录先封存可恢复，不删除原文。
- 最小验收：三种正常启动命令均选择相同 userData/Note 库和 config；39 Session、19 Note、17 关系、来源和删除屏障完整；Mirror 路径/启停保留；并发启动安全；代码和数据各有恢复边界。数据基数要在实施前重新冻结，不能假定永远是本报告数量。

### P2：完成全量 Reflection 处置，最后退役兼容业务

- 目标：40 条逐项有语义与来源处置，而非强制 40→40 Note；必要回填指向已统一的唯一库。
- 证据：[V] 来源全覆盖 2、部分 3、无覆盖 35；[R] F?1/P3/N12/J22/X2 的复审候选。
- 修改面：复审清单/有限离线工具、映射/去重、必要的旧 runtime/IPC/UI/exports/测试解绑；源数据保留。
- 复用：原始会话、现有 Formation/Organization、已验证备份/恢复机制；不直接复制旧 relatedReflectionIds。
- 风险/回退：把来源覆盖当语义完成、把助手转述当用户事实、把工具拒绝当人工负例、恢复已删来源、同义/时效覆盖错误。
- 最小验收：每条旧 Reflection 有“等价覆盖/合并/新 Note/仅 Raw 归档/来源无效/待用户裁决”及稳定映射；重复运行零新增；未批准/不安全项不强写；所有正常入口不再创建旧 Reflection 业务，旧来源删除/隐私责任仍可验证。

## I. 未确认项、共同决策与验证边界

### 需用户/架构设计者共同决定

1. 唯一正式 profile 的目录及配置冲突优先级；是否先沿用当前 v2 再离线搬到正式用户目录。不能自动用旧 profile 的 Formation=true 覆盖当前 false。
2. 什么算“高质量、可独立阅读的认识”；Aisling 自身交互经历与用户报告如何取舍，助手单源摘要与防回流边界是否保持当前严格规则。
3. 失败重试的成本上限、取消后是否自动恢复、历史失败的重新评估策略；attempted 不应自动解释为已形成，但也不能无限重跑。
4. 约束输出方案的 Provider 支持/回退；是否先仅改示例与错误分类。当前没有远端 JSON Schema 能力验证。
5. 40 条 Reflection 的长期价值/时效/同义处置及 F? 的类型确认；没有全量人工语义核准，不能退役即清空数据。
6. 旧 profile 兼容保留窗口与发布迁移承诺；archive/privacy 责任何时可解除，不能以 Runtime 不再召回作为充分条件。

### 本轮验证与缺失证据

- [V] 既有合同/语义测试：8 通过、7 原生/Electron 集成项未启用运行（未设置该套件资源变量），无失败；不把跳过计成通过。
- [V] 4 个保存响应只读断言通过：顶层过载、空 scope、补 scope 后空 sources、pattern 缺 uncertainty；0 次模型调用。
- [V] 单独使用真实 Worker 的临时隔离 profile 复现 failed 不重试/原来源忽略/running 重启 interrupted；创建后清理，不碰真实用户数据。一次 OS 临时目录 rename 遇到 EPERM，改用工作区隔离目录后通过；不将环境限制算作业务故障。
- [V] 当前数据库/WAL 隔离副本核对 19/17、全部来源有效；源文件复制前后哈希一致。
- [V] `pnpm typecheck` 全项目通过。本轮没有为只读报告重跑无关全量构建/所有集成测试；此前构建通过属于已有报告，不作为本轮新验证。
- [V] 原有 53 个工作区变动内容及 8 个真实数据路径与审计起点哈希一致。最终只新增此 Markdown。
- [U] 失败批次缺少完整、冻结的原始 prepare 输入；无法给所有 item 补出精确历史失败分布。P6 部分回放也是重建，不能伪装成原始输入。
- [U] 没有长期线上 Formation 成功率/成本分布，没有全部旧认识的人工语义金标准，也未实施新的付费验收或 Profile 切换。

本报告是后续小范围修改的技术依据，不是已实施 v0.4.0 的说明。首轮最值得改的是 **可观察、可有界恢复的 Formation 合同/作业处理**；Raw + Note、来源安全、事务/版本/删除保护和现有 Mirror 应作为稳定回归基线保留。
