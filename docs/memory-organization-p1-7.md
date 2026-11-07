# Memory Organization P1.7：数据生命周期与受限正式写入

2026-11-06。以 `D:\Project\demo\project_Aisling` 开始任务时的本地工作树为基线，保留此前 P1.2—P1.6 的未提交成果。版本保持 **0.3.7**；未提交、未推送。未打开或修改真实用户数据库；所有数据库验收使用虚构内容和独立 profile。

**P1.7a 通过；P1.7b 已实施并通过本报告限定的验收。** Memory Organization 仍默认关闭，用户启用且数据库 Ready 后，正式 Main 可许可受限 ADD / NOOP。自动范围是可逐字核验的、有明确说话人的发言事件，不代表通用事实提炼已经开放。UPDATE / SUPERSEDE / RETRACT 均待审，UNDECIDED 不写入。没有新增 Note Recall 注入。

下文区分「实测」「源码确认」「未验证」。初次 a 阶段通过后才修改真实禁写策略，阶段证据为 `artifacts/memory-organization-p17/p17a-gate.json`。收尾发现并补齐的边界包括 Origin 单独删除、旧 Reflection 索引复核屏障、多次删除在 Worker 提交期间合并 journal；最终原生测试及真实 Electron 又重新通过，随后复验 b。不能用首次门槛记录代替最终代码验收。

## 1. 审计与实际范围

审阅了 P1.6、P1.2、正式适配报告，NoteDraft / Organization / Formation / ReflectionStore / Reflection Recall / ConversationStore / Stage、设置、Preload、Main、Host / Worker / Adapter / Store / Protocol 及其调用和测试。

| 分类 | 审计发现及处理 |
| --- | --- |
| 必须修改 | 只修剪当前 C JSON 不能清除 Note 历史；新增受限擦除、持久删除意图、重放屏障和启动恢复。 |
| 必须修改 | P1.6 completed C Reflection 实际可被原 Reflection Recall 索引，虽 Note 未提交；增加 Main 所有的提交资格，待审、拒绝、未知结果均不能绕过。 |
| 必须修改 | 缺少确定的新主体身份与独立 Main 语义许可；沿用 SubjectAnchor，加入已知说话人锚点及逐字发言规则。 |
| 保留 | 原 Formation 三单元队列、单次 C 调用、取消/超时、稳定候选 ID、原始 Recall、Context 预算、不可变 Revision、版本补证和 Receipt 恢复。 |
| 保留 | P0 隔离协议、深度受限关系查询、Host 生命周期、P1.2 故障夹具均仍有回归消费者，未删除。 |
| 删除/合并 | 删除 `allowWrites` 构造器测试后门及旧合成许可分支；实际应用和测试统一走 Main 策略。移除 desktop-store 重复的 C 来源修剪，交由同一生命周期协调器处理。删除失效禁写文案及已无用途的索引分类标记。 |

本轮不删除研究目录、P0/P1.2 正式能力或安全测试。P1.4 的 `aisling-memory-bc-lab` 原目录仍不在当前工作区，不声称重跑了该缺失归档；现存 P1.3/P1.5 研究资料保留。没有从实验目录导入正式业务模块。文件级相对基线差异见 `artifacts/memory-organization-p17/change-scope.json`；它与 Git HEAD 差异不同，后者包含此前任务成果。

## 2. 删除依赖与执行顺序

本节及第 4、5 节的实现路径属于源码确认，对应运行证据见第 6、7 节；未验证边界集中列在第 8 节。

依赖为 Message → Reflection / FormationBatch → Note → 历史 Revision、所有版本补证 Receipt、Origin / Evidence 边、RELATED 边。除此以外，模型实际看过的历史 Reflection 和候选 Note 也是隐私依赖，不能当作新主张的支持证据。

新增 `memory-lifecycle.cjs`，复用现有 JSON 存储和 Worker。Conversation 写入前比较旧、新完整消息的 SHA-256；删除会话、改写/删除消息、删除/改写既有 Reflection 或删除批次，先记录意图，再改变源 JSON。批次保存 `contextSources`、`contextReflectionIds`；C Organization 保存实际输入的 `contextNoteIds` / `contextSources`。这些是程序记录的输入谱系，模型不能用它们伪造 Evidence。

删除意图位于 profile 的 `memory-erasure.v1.json`。通过临时文件、文件 fsync、rename 写入，记录稳定的分步 erase UUID、必要来源定位和不可逆摘要，不记录正文、Note 草稿或模型输出。完成后移除待执行定位，仅保留必要的主体/来源/批次 hash 屏障及 Main 资格 hash。数据库保留不含正文的擦除收据、Note/operation UUID 墓碑。

执行次序为：

1. 先持久化意图与屏障，增加 Main generation，丢弃候选缓存；所有 Reflection/Note 候选读取、Formation 写入和正式 Note 写入立即失去资格。
2. 将待删除源从 Conversation JSON 移除；对于单消息旧快照，将已撤销摘要的旧消息替换为保留位置的空内容，避免改变后续 messageIndex。重置相关派生标题。
3. Worker 以稳定 erase UUID 执行单个事务：沿 Evidence / Origin 找到 Note，沿所有操作的 affectedNotes 闭包包含 SUPERSEDE 两端；删除整个相关认识及历史。
4. 用擦除的 Note ID 继续修剪曾将它作为模型输入的 JSON 批次；新增后继范围先落盘，再继续擦除，直至闭包稳定。单独删除 Origin 也删除保存该草稿的批次。
5. 数据库和 JSON 均完成后，才清除 pending、取消隔离并报告状态。Worker 提交期间若再次删除来源，会重新读取最新 journal，保留新增意图和屏障，不用旧内存快照覆盖。

失败时保持 pending、读取/写入隔离及可见失败状态，不循环自动重试。启动、显式重新启用或新的受控操作可继续同一批稳定请求。启动清理独立于 Organization 开关；没有 Note 数据库时无需启动 Worker，也先保存来源屏障，未来创建数据库时同步。

旧 Conversation JSON、旧 FormationBatch、旧 Note ID、旧 operationId 不能在普通恢复路径复活被删内容。迟到模型结果还受队列 epoch、取消信号、Main generation、来源摘要及持久屏障共同约束。Journal 格式损坏时失败封闭，ConversationStore 收到读取失败，而非「成功读取空库」。

## 3. 数据库实际清理与协议

**实测 LadybugDB 0.22.1 / Windows x64 / Node 24.12.0** 支持本次使用的参数化查询、事务 rollback、`DETACH DELETE`、关系删除、孤立节点检查及墓碑写入。先运行隔离删除探针，再实施；见 `artifacts/p17-delete-probe.log`。

| 数据 | 清理方式 |
| --- | --- |
| Note | 整条删除，不用 RETRACT 替代用户擦除。 |
| Revision | 删除该 Note 的全部版本，含旧内容、旧理由、旧 grounds 和 SUPERSEDE successor。 |
| Receipt | 删除涉及被擦除 Note 的全部 NoteOperation，包括 NOOP 版本补证及相关结果；重放检查发生在收据查找前。 |
| Origin / Evidence | 删除 Note 的关联边；只清理没有保留 Note 使用的节点。共享端点不直接连带删除无关 Note。 |
| Relation | 随 `DETACH DELETE` 删除入边、出边。 |
| Formation / Reflection | 删除受影响批次、产物、保存的 draft / operation / 原因及模型输入后继；修剪弱展示链接和提交资格。 |

若同一模型批次看过被删除材料，即使某条输出只引用其他仍有效消息，也不能证明它完全独立，会保守删除整个批次及派生认识。不同来源、独立批次的无关认识保留。历史版本和 NOOP 补证的来源并集都参与全局审计，不能仅核验当前 Revision。

Note v1 增加两张小表：`MemoryTombstone(key, erasureId)`、`MemoryErasure(operationId, fingerprint, notes, operations)`。原 Note 快照、Revision 和 Receipt 格式保持兼容。

Store / Worker 的 **Note v1 白名单**新增：

- `eraseSources({ operationId, evidence, originIds, sessionIds })`：明确范围，每类至多 32 条，严格字段校验，事务内执行，45 秒受控超时。
- `erasedNoteIds(erasureId, cursor)`：每页至多 16 个不含正文的 Note ID，供 JSON 后继清理。
- `listMemorySources(kind, cursor)`：每页至多 16 条来源元数据，核查历史并集。
- `installErasureBarriers(keys)`：每次至多 32 个来源/Origin/session hash，用于无数据库时已发生的删除。

P0 白名单和协议版本不变。新擦除方法不暴露给 Renderer；Renderer 仍只能提交已持久化 batchId / item index，Main 读取并独立复核。`prepare-memory-database.ps1` 增加复制 `erasure.cjs`；本机 `.local/memory-database` 仅刷新了 Worker 程序资源，未写入用户 DB。源码、隔离资源及开发资源的 Worker 模块需保持一致。

这里实现了应用隔离和数据库可查询记录清除。**未实现磁盘取证级安全擦除**：旧页、WAL、文件系统残留、外部备份和此前已导出的副本不在该证明范围。

## 4. Subject、来源、时间与 Main 许可

程序在当前 profile 内将持久消息 role `user` 绑定 `profile-user`，role `assistant` 绑定 `aisling`；二者只确认发言人。新项目、设备、地点、人物不因名称相似获得 confirmed。已有 Note 的候选身份仍绑定真实 ID、subject、version；模型只选临时 S / N 标签。已有其他主体可以成为待审目标，自动策略仍不推断它们的事实范围。

SHA-256 沿用 Conversation 归一化后的完整消息 JSON；messageIndex 为零基位置。Main 每次重新读取落盘来源，要求会话唯一、消息存在、摘要相同、角色合格、无工具中间消息，Origin 确实属于已保存的本批 Reflection，且证据在该 Origin 内。来源部分失效、缺失 Origin、摘要失配均不能转成新事实或自动 RETRACT。

正式许可同时要求启用 Memory 总开关和 Organization、Worker Ready、删除恢复完成、稳定 Note / operation UUID 和完整新鲜候选索引。Main 串行执行「资格检查 + 提交」，避免并发 ADD 同时看见空索引。BM25 仅挑选提示候选；提交重新扫描有界全索引（8 条/页，至多 32 页），超过范围或任何有效性缺口都待审。

**自动 ADD 的额外条件：**

- 恰好一个实际来源消息，Reflection 是 direct / event；内容严格等于 `用户陈述：` 或 `Aisling 发言：` 加完整原消息，Reflection 与 Note draft/operation meaning 一致。
- subject 与持久化消息的实际说话人一致，eventTime 严格为 null，无 uncertainty、context、keywords；标签仅能来自原消息字面片段。
- 全部现存 Note 历史中没有同一说话人 subject，否则无法确定独立事实范围，保留待审。

因此用户玩笑、计划、请求或助手承诺最多保存为「这个说话人这样说过」的一次发言事件，不能自动改成「设备已修好」「计划已执行」等普通事实。整条消息对应一个发言事件，并不把其中多项命题当作已证实的原子事实。本轮宁可少写，不声称已解决通用实体/范围去重。

**自动 NOOP：** 同样通过上述发言与来源许可；目标必须 active、expectedVersion 匹配，subject / 完整正文 / eventTime 相同，原版本 grounds 和 Origin 当前有效，且无额外 context/推断。沿用 P1.2 的正确版本补证 Receipt：原 Revision 不可变、正文版本不增加，重复 operationId 返回同一收据，Evidence 不重复。模型提出的重复 ADD 不会被程序偷偷改成 NOOP。

UPDATE / SUPERSEDE / RETRACT 保存原建议、目标身份、来源、理由和 `proposed-not-applied / high-risk-review`，不转换成 ADD；UNDECIDED 无 operation。关闭后禁止进入后续事务，已提交但回复失联的请求按 Receipt 查证。DB 已提交、Main 资格落盘失败时返回 outcome-unknown，重启/显式恢复沿用同一 operationId 查证，不误报「未提交」。

createdAt 由数据库在首次创建时产生；Revision changedAt 表示版本操作时间。本轮自动发言的 eventTime 始终 null，既不从 createdAt 补全，也不把计划日期当完成日期。P1.2 日期/区间持久化能力仍保留于受控 Store，但 C 含日期解释、撤销旧计划、新事实推断或待核实内容继续待审。

## 5. Reflection / Note Recall 资格与前端

旧合法 completed Reflection 按原规则兼容。C Reflection 须同时具备已应用 item 状态和 Main journal 记录的资格；Renderer 自填 recallEligible 不授予资格。待审、拒绝、来源失效、删除中或未知结果均不能走 Reflection Recall。每轮先读权威存储/删除屏障，内容未变时复用词项索引；仅依赖旧 changed 通知可能漏掉后台清理，所以连 legacy 缓存也复核。单轮已捕获快照的 Context / 工具循环预算保持原样，删除不能追回已经发送给 Provider 的输入。

Note 作为 Organization 候选时只列 active 且来源/Origin 当前有效的头；superseded / retracted 不可被补证写入。**没有让 Note 参与正式 Recall 注入。**

复用 Memory 页面、原 Formation 配置和 Organization 一个开关。状态覆盖关闭、启动、运行、待审、写入受限及失败；删除失败有短提示，即使 Organization 已关闭也可见。中英文能力说明更新为「可自动保存符合条件的新记忆和补充证据；修改、取代及撤回仍需审阅」。Main 经现有 Preload 发出状态事件，Stage 在作用域销毁时解除订阅；未增加第二个开关或诊断面板。

## 6. P1.7a 验收结果

全部为虚构内容。N = 原生 Worker / LadybugDB 实测，E = 实际 Electron 应用/IPC/Main/Worker 实测，W = Web 运行代码实测。

| 门槛 | 结果及证据 |
| --- | --- |
| 1 单条来源删除 | N：同一会话只改一条消息，删相关 Note，保留另一条；旧摘要恢复被替换。 |
| 2 多 Note 共享来源 | N：全部依赖者清除，无关共享端点仍保留。 |
| 3 一 Note 多来源 | N/E：删其中一个来源即清除整条相关认识。 |
| 4 历史 Revision | N：UPDATE 前后版本及历史依据均不可再读；历史依据删除也清除 C 后继。 |
| 5 操作 Receipt | N/E：ADD / UPDATE / NOOP / SUPERSEDE 关联收据清除，版本补证读取为空。 |
| 6 SUPERSEDE | N：旧、新两端及生命周期操作闭包清除，独立 Note 保留。 |
| 7 Organization 并发 | E：真实 Stage 请求在途时删除来源，迟到响应被忽略，未保存新批次。另有 N 测试覆盖提交期间第二次来源删除，两个持久意图/屏障均保留。 |
| 8 Worker 崩溃 | N：隔离 Worker 在实际 DETACH DELETE 事务中退出，客户端 outcome-unknown；重新打开后以原 erase UUID 完成清理。故障注入只在测试资源副本。 |
| 9 Main 重启 | E：意图文件 rename 后、源 JSON 写入前强退真实 Main，退出码 74；另一真实 Main 在开关关闭时继续擦除，pending 清空。 |
| 10 operationId 重放 | N/E：旧 UUID 返回 erased；同一已撤销来源换新 Note/operation UUID 也不能写入。 |
| 11 批次恢复 | N/E：旧 FormationBatch/迟到 JSON 写入被拒绝；普通重载稳定 operationId，不再请求模型。 |
| 12 读取入口 | N/E/W：Note、全部 Revision、Receipt、版本补证、候选、ReflectionStorage 和 Reflection Recall 均不能返回已清理内容。底层原生探针确认关系删除；未新增 Renderer 历史查询口。 |
| 13 新主体 | N/W：项目/设备名称不能自授予 confirmed；来源类别、日期补全、推断及未确认主体均保留待审。 |
| 14 Recall 不泄漏 | E/W：pending C 不注入，合法 legacy 注入；Main 资格未完成或擦除屏障存在时，C 和缓存路径均拒绝。 |

附加实测：擦除失败不自动循环重试且持续不可读；新协调器恢复原 erase UUID；无 DB 的永久屏障可同步到后来创建的 DB；损坏 journal 失败封闭；仅删除 Reflection Origin 也会清掉保存的草稿批次和派生 Note，原有效消息可保留。

最终边界日志：`artifacts/p17-final-boundaries.log`（14/14，含 a 删除测试和 b Main 测试）；真实应用 `p17-a-electron-final.log`、真实重启 `p17-a-restart.log`。a 的 14 项门槛与测试文件计数不是同一个统计口径。

## 7. 全量回归与 P1.7b 验收

| 项目 | 最终结果 / 日志 |
| --- | --- |
| Core 全量 | **110/110**；`artifacts/p17-core-full.log`。 |
| Stage Web 全量 | **397/397**；`artifacts/p17-web-final.log`，单 worker，保留原性能断言。 |
| Desktop / Worker / Note v1 全量 | **58/58，无跳过**；`artifacts/p17-desktop-final.log`，含真实 Electron Note v1 重开。 |
| 类型检查 | 通过；`artifacts/p17-typecheck-final.log`。Desktop 增加 resolveJsonModule，核验 Main/Web 共用说话人 JSON。 |
| 生产构建 | 通过；`artifacts/p17-build.log`，仍有已有的大 chunk 提醒。 |
| 正式 Organization Electron | 通过；`artifacts/p17-organization-smoke.log`。三次真实 C 调度依次 ADD、NOOP、RETRACT 待审，旧 Formation 调用 0；实际 DB 为 active / version 1，一条版本补证。 |
| 开关/重载/删除 | 同一正式 smoke 验证关闭停止调度、重载无额外模型调用、收据查证、来源删除后所有候选/Origin/Note/Receipt 清除及重放拒绝。 |
| 默认开发 Worker 资源 | 通过；`artifacts/p17-production-resources.log`，使用刷新后的 `.local/memory-database` 程序模块，独立 profile。 |
| Formation / Reflection Recall | 通过；`artifacts/p17-formation-smoke.log`，以及 P0 全套中的再次验收。 |
| Memory Recall / Context / TTS | 通过；`artifacts/p17-memory-smoke.log`、`p17-context-smoke.log`、`p17-tts-smoke.log`。模型/音频上游为离线测试响应，Electron 产品逻辑真实执行。 |
| Worker 缺失降级 | 通过；`artifacts/p17-missing-smoke.log`：database-unavailable，仍可普通对话。 |
| P0 Electron 完整兼容 | 通过；`artifacts/p17-p0-electron.log`，含隔离 profile、关闭、父进程/Worker 退出、锁和资源失败降级；未删旧测试。 |
| 完整 production smoke | 通过；`artifacts/p17-prod-smoke.log`，保留 composer、宽度、回复、透明角、模式切换和关闭断言。 |

最初在受限运行环境中，Core 的本地 HTTP 4 项、Web relay 的本地 HTTP 3 项因连接 EACCES 失败，Electron 以 0x80000003 退出；保留首次日志，换到允许本地连接/真实 Electron 的执行环境后完整复验通过。未修改相关测试预期来规避环境限制。

`composerShown` 单独复现于原断言。隔离诊断 `artifacts/p17-composer-diagnostic.log` 观察到 character 事件已收到、首次采样无输入框、同一运行稍后的 DOM 已出现输入框，且没有离开事件；固定等待不能证明 Vue 已渲染。仅给 smoke 增加最多 5 秒的 DOM 就绪等待，原 `composerShown === true`、320px 宽度和后续回复断言全部保留；完整 production smoke 通过。没有修改生产 DesktopSurface，也没有将失败归因于 Organization。

真实 Provider 仅 **1 次付费 C 调用**，单独 P1.7 ledger 限制 1 调用 / 总 6000 Token / 输出上限 1500，不复用或重置 P1.6 账本，不自动重试。实际 DeepSeek 响应：输入 **1507**、输出 **117**、合计 **1624** Token，finish_reason=stop。Electron 的真实 C 提示经受限本地测试 relay 到 Provider，返回原模型 JSON，再进入正式 parser/Main/Worker；逐字发言 ADD 实际 committed，随后删除和重放检查通过。普通聊天回复在该验收中仍是 Mock，不能声称所有聊天 Provider 链路均做了付费实测。凭证仅来自已授权测试环境变量，无密钥写入报告/日志；材料均虚构。证据 `artifacts/p17-live-smoke.log`、`artifacts/memory-organization-p17/live-budget.json`、`live-usage.json`。

Memory Organization 隐藏窗口的 capturePage 未取得截图，独立记录 screenshot=false；不把截图失败算作业务通过。设置开关/状态通过真实 DOM 与 IPC 验收，完整 production smoke 的 Stage/Desktop 截图可生成；未据此宣称 Memory 页做过逐像素视觉验收。

## 8. 剩余边界与下一步

- **自动范围刻意很小。** 同一说话人有既有历史时，新的 ADD 通常待审；本轮没有解决通用事实范围判断、实体身份合并、别名、人工审批工作台。已有其他主体的语义 NOOP 也不自动扩大许可。
- **删除证明有限。** 未做磁盘取证擦除、整机突然断电/硬件写缓存测试、外部备份清理或整份 profile 回滚防护；同时恢复旧 DB 与旧 journal 的外部备份，不属于普通重启/重试防复活保证。不能追回已发往 Provider 的内容。
- **历史输入谱系。** 新批次记录全部实际输入依赖；旧版本未记录的模型上下文，无法凭空重建。本次未从用户旧数据库取样，也未验证任意损坏/手改的历史库迁移。对于已记录关系、历史 grounds、NOOP 并集和已知受影响 Note，采用整条/整批保守清除。
- **规模与分发。** 候选扫描超过 256 条会保留待审，不保证大库吞吐；墓碑不能随意压缩。已验证本地 Windows x64 开发资源，未验证新的安装包、其他 OS/架构或多实例同时写同一 profile。部署须带当前五个 Worker 模块与已验证运行时。

最终判断：a 删除/恢复及本报告限定的 b 正式写入门槛通过；真实用户在主动启用后可以使用上述受限 ADD/NOOP，默认设置未被自动打开。当前验收未发现普通删除、崩溃重启、迟到候选或旧操作重放导致的可读残留/复活；上述磁盘、备份、旧上下文和规模边界仍存在，不能宣称零风险。可以进入后续 **隔离的 Note Recall 和 Organization 体验验证**，范围应先限定为已验证的发言事件，不应据此开放通用事实演化或高风险写入。

本轮未开发 Embedding、Activation、自动 Evolution、复杂图关系、主动检索或新的 LLM 审批链。
