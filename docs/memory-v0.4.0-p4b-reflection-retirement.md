# Memory v0.4.0 P4-B：Reflection 正式迁移与旧业务退役

> 公开脱敏候选：真实认识、记录标识、机器路径及私有校验值仅在私人归档保留。占位标识只用于本文说明，不可运行或跨页关联；本页仍记录原阶段的测试与限制，不代表本次重新验收。


状态：**已完成**。本轮于 2026-11-18 开工，2026-11-19 完成中断后的核验、正式迁移及本地检查点。40 条旧记录全部有最终处置，9 条 A 形成 10 张 Note；旧 Reflection Formation/Recall 已退出正式运行链路。版本仍为 v0.3.9，未推送、合并或创建 Release。

## A. 实施前真实基线与授权

开工分支 `feat/obsidian-memory-mirror`，HEAD `a4dca38c90c787e0ecc67edd100a6ec355b40c1c`（P4-A）；已暂存、未暂存、未追踪代码均为空。P0/P1/P2/P3/P3.1、历史回填与 Mirror 成果及备份全部保留。重新读取前置报告、P4-A 私有逐条附录、Manifest、补充证据及实际源码/数据，没有沿用报告数量作为验收假设。

正式 Profile：`%APPDATA%\@aisling\stage-desktop-note-v2`。迁移前实测 39 Session、356 Message、19 Note、17 关系；Formation 21 批（14 completed、7 failed），Organization 19 个 completed 任务。Memory=true、Formation=false、Note Recall=true，Mirror 原配置保留。`memory-authority`、P2 committed receipt、原始 Raw、配置和归档均已冻结。活动 `memory-erasure.v1.json` 的 JSON version=2，pending=0，blocked.sessions=5；数据库 MemoryErasure/MemoryTombstone 各 5。

正式归档为 `legacy-profile-archive/aisling-reflections.v1.json`：40 个唯一 ID、86 个来源引用，82 个按 digest 匹配；38 条全部可追溯。R01/R24 的两个 Session、四个引用仍缺失，未从旧备份复活来源。5 条原映射全部为助手消息，不能据此认定事实；R17 只使用另行找到的用户原始佐证。旧默认 Desktop Profile 和旧开发根继续封存，没有改变 P2 权威选择。

重新逐条对照 10 个精确正文、原始 user/assistant 角色、上下文、历史有效性及现有 19 Note。8 个操作通过当前 Parser/自动授权；M02、M05 因原始依据含问句留待批准，用户随后明确回答“明确批准两条迁移”。批准绑定原 operationId、Note ID、operationFingerprint 和完整正文，不裁剪引文，不放宽 `note-organization-v2.mjs` / `note-semantic-contract.mjs`。其余 8 个按现行规则自动授权，不冒称全部经过用户逐条批准。

## B. 全部 40 条最终处置

A=9、B=4、C=2、D=5、E=20。一条包含两个独立认识而拆分，另有重复确认合用一张且独立变化单列，共 10 ADD；不强制一条记录对应一张 Note。

逐条原文、时间、证据、真实 ID/覆盖映射和冻结计划完整保留于独立私人归档。以下仅保留审查号、分类和结果；公开版不是可执行恢复材料。

| 复审号 | Reflection ID | 类别 | P4-B 最终结果 |
| --- | --- | --- | --- |
| R01 | PRIVATE-ID-01 | D | 证据不足；禁止事实迁移 |
| R02 | PRIVATE-ID-02 | A | 已正式迁移 M01 |
| R03 | PRIVATE-ID-03 | C | 保留历史；不作当前事实新增 |
| R04 | PRIVATE-ID-04 | A | 已正式迁移 M02/M03 |
| R05 | PRIVATE-ID-05 | A | 已正式迁移 M04 |
| R06 | PRIVATE-ID-06 | C | 保留历史；不作当前事实新增 |
| R07 | PRIVATE-ID-07 | E | 无独立价值或重复；未新增 |
| R08 | PRIVATE-ID-08 | B | 已有覆盖；未写入 |
| R09 | PRIVATE-ID-09 | A | 已正式迁移 M05 |
| R10 | PRIVATE-ID-10 | E | 无独立价值或重复；未新增 |
| R11 | PRIVATE-ID-11 | E | 无独立价值或重复；未新增 |
| R12 | PRIVATE-ID-12 | E | 无独立价值或重复；未新增 |
| R13 | PRIVATE-ID-13 | E | 无独立价值或重复；未新增 |
| R14 | PRIVATE-ID-14 | E | 无独立价值或重复；未新增 |
| R15 | PRIVATE-ID-15 | E | 无独立价值或重复；未新增 |
| R16 | PRIVATE-ID-16 | A | 已正式迁移 M06 |
| R17 | PRIVATE-ID-17 | A | 已正式迁移 M07 |
| R18 | PRIVATE-ID-18 | E | 无独立价值或重复；未新增 |
| R19 | PRIVATE-ID-19 | E | 无独立价值或重复；未新增 |
| R20 | PRIVATE-ID-20 | E | 无独立价值或重复；未新增 |
| R21 | PRIVATE-ID-21 | E | 无独立价值或重复；未新增 |
| R22 | PRIVATE-ID-22 | E | 无独立价值或重复；未新增 |
| R23 | PRIVATE-ID-23 | E | 无独立价值或重复；未新增 |
| R24 | PRIVATE-ID-24 | D | 证据不足；禁止事实迁移 |
| R25 | PRIVATE-ID-25 | A | 已正式迁移 M01/M08 |
| R26 | PRIVATE-ID-26 | E | 无独立价值或重复；未新增 |
| R27 | PRIVATE-ID-27 | A | 已正式迁移 M09 |
| R28 | PRIVATE-ID-28 | E | 无独立价值或重复；未新增 |
| R29 | PRIVATE-ID-29 | E | 无独立价值或重复；未新增 |
| R30 | PRIVATE-ID-30 | A | 已正式迁移 M10 |
| R31 | PRIVATE-ID-31 | E | 无独立价值或重复；未新增 |
| R32 | PRIVATE-ID-32 | E | 无独立价值或重复；未新增 |
| R33 | PRIVATE-ID-33 | D | 证据不足；禁止事实迁移 |
| R34 | PRIVATE-ID-34 | E | 无独立价值或重复；未新增 |
| R35 | PRIVATE-ID-35 | B | 已有覆盖；未写入 |
| R36 | PRIVATE-ID-36 | B | 已有覆盖；未写入 |
| R37 | PRIVATE-ID-37 | E | 无独立价值或重复；未新增 |
| R38 | PRIVATE-ID-38 | B | 已有覆盖；未写入 |
| R39 | PRIVATE-ID-39 | D | 证据不足；禁止事实迁移 |
| R40 | PRIVATE-ID-40 | D | 证据不足；禁止事实迁移 |

新增内容只接受原始证据支持的有限自述，排除助手推论及虚构内容，保留历史限定；所有新增 eventTime=null。C/D/E 保留在私人审查/原归档中而不转成事实。待迁移记录间重复不改算为原有 B 覆盖。

B 类 4 条均由现有 Note 及有效来源覆盖，精确映射仅在私人包；没有更新原卡片。

## C. 正式迁移及数据库完整性

以下是实际正式数据库的迁移结果；读库和逐表比对均在完整离线备份的隔离副本进行，未向运行中的用户数据库另开连接。原始 19 Note 的正文、版本、来源和历史行全部保留。新增 10 Note 均为 version=1；createdAt/updatedAt 是此次事务写入时间，不能冒充事件日期。

| 表 | 迁移前 | 正式迁移后 | 完整性 |
| --- | ---: | ---: | --- |
| Evidence | 26 | 40 | 保留全部原逻辑行；Schema 相同 |
| HAS_CONTEXT | 268 | 272 | 保留全部原逻辑行；Schema 相同 |
| HAS_EVIDENCE | 19 | 31 | 保留全部原逻辑行；Schema 相同 |
| MemoryErasure | 5 | 5 | 保留全部原逻辑行；Schema 相同 |
| MemoryTombstone | 5 | 5 | 保留全部原逻辑行；Schema 相同 |
| NOTE_EMBEDDING | 14 | 14 | 保留全部原逻辑行；Schema 相同 |
| NOTE_LINK | 17 | 17 | 保留全部原逻辑行；Schema 相同 |
| Note | 19 | 29 | 保留全部原逻辑行；Schema 相同 |
| NoteOperation | 36 | 46 | 保留全部原逻辑行；Schema 相同 |
| NoteRevision | 19 | 29 | 保留全部原逻辑行；Schema 相同 |

新增 Evidence=14、主证据边=12、Context 边=4。逐表剔除数据库内部物理行号后核对所有原始逻辑行；Schema 摘要均相同。每张新卡的全部用户 Evidence、必要上下文和 Receipt 指纹逐一核验。所有新卡的语义/来源与冻结演练相同，仅事务时间不同。未新增关系：同一项目主题不等于关系证据；不虚构旧 Note 来建立 STATE_CHANGE。

P1 原有 21 批及 progress 完全不变，19 个原 Organization 任务保持原样；使用现有 registerNotes 将 10 张新卡登记为 pending，并加入现有 Embedding 优先队列。未执行这些付费任务，NOTE_EMBEDDING 仍为 14，Formation=false 未被改成 true。此次没有批量重跑历史、重试旧失败任务或修改任何 Recall/Organization/候选发现算法。

## D. Manifest、授权、事务及恢复

正式计划 ID `PRIVATE-ID-41`，解析后 JSON 的 SHA-256 `<PRIVATE_SHA256>`。用户两条明确批准（私人归档内，不随公开仓库分发） 独立保留。operationId/Note UUID 从 P4-A 固定沿用；原 P4-A 工具仍拒绝正式路径，没有伪造隔离 marker。

| 操作 | 复审记录 | Note ID | operationId | 授权 | 实际结果 |
| --- | --- | --- | --- | --- | --- |
| M01 | R02+R25 | PRIVATE-ID-42 | PRIVATE-ID-43 | 现行自动授权 | 已提交，重复执行复用 Receipt |
| M02 | R04 | PRIVATE-ID-44 | PRIVATE-ID-45 | 用户明确批准 | 已提交，重复执行复用 Receipt |
| M03 | R04 | PRIVATE-ID-46 | PRIVATE-ID-47 | 现行自动授权 | 已提交，重复执行复用 Receipt |
| M04 | R05 | PRIVATE-ID-48 | PRIVATE-ID-49 | 现行自动授权 | 已提交，重复执行复用 Receipt |
| M05 | R09 | PRIVATE-ID-50 | PRIVATE-ID-51 | 用户明确批准 | 已提交，重复执行复用 Receipt |
| M06 | R16 | PRIVATE-ID-52 | PRIVATE-ID-53 | 现行自动授权 | 已提交，重复执行复用 Receipt |
| M07 | R17 | PRIVATE-ID-54 | PRIVATE-ID-55 | 现行自动授权 | 已提交，重复执行复用 Receipt |
| M08 | R25 | PRIVATE-ID-56 | PRIVATE-ID-57 | 现行自动授权 | 已提交，重复执行复用 Receipt |
| M09 | R27 | PRIVATE-ID-58 | PRIVATE-ID-59 | 现行自动授权 | 已提交，重复执行复用 Receipt |
| M10 | R30 | PRIVATE-ID-60 | PRIVATE-ID-61 | 现行自动授权 | 已提交，重复执行复用 Receipt |

新增一次性 `scripts/publish-reflection-migration.ps1` / `.cjs`：只接受 P4-B artifacts 内的冻结计划及 P2 实际正式路径；拒绝链接/共享硬链、源摘要变化、未审查/非 A 操作、无效来源、删除屏障、失配 Receipt 和未完成演练。PowerShell 先检查进程、设置独占维护标记、再次检查并持有关键只读句柄；数据库和 jobs 文件独占探测后仅由受约束 Store 写入。新应用启动看到维护标记即拒绝；失败保留标记，成功在 Worker 关闭后仅移除本轮标记。

最新隔离演练从完整当前备份创建，第三个事务持久提交后注入“回复丢失”：恢复 applied=7/reused=3；再次执行 applied=0/reused=10。Queue 文件写入后的中断也由单测覆盖，重试不丢原任务、不重复入队。最初仅 Note 的演练完整保留；为使迁移结果进入既有 Organization/Embedding 调度，追加 postCommit 注册步骤并冻结第二版计划，重新完成全套演练。没有更改 10 个事实、来源或授权。

正式首次执行 applied=10/reused=0/covered=0；同一冻结计划正式再执行 applied=0/reused=10/covered=0。首次正式结果（私人归档内，不随公开仓库分发）、重复结果（私人归档内，不随公开仓库分发）、最终 Journal（私人归档内，不随公开仓库分发） 及数据库 10 个 Receipt 共同保存。Journal 是操作进度，数据库 Receipt 指纹才是提交依据。幂等后另取完整备份并验证所有表、来源和屏障。

## E. 独立用户数据检查点和恢复依据

迁移前完整离线备份根：`<REPO>\artifacts\memory-v0.4.0-p4b\2026-11-18T12-33-40-326Z`。迁移后完整离线备份根：`<REPO>\artifacts\memory-v0.4.0-p4b\2026-11-18T12-33-40-326Z\revision-2\post-publish-2026-11-19T07-50-06-269Z`。两者独立于 Git，均保留原始主库及必要 WAL/配套文件、Raw/配置/凭据、jobs、authority、P2 迁移状态、删除日志、归档和缓存。历史 P0/P2/回填/P4-A 备份未覆盖。中断恢复后再核对迁移前 6,631 文件和备份一致；发布入口在实际写入前再次核对冻结文件，未知变化即停止。

| 快照 | 集合 | 文件数 | 字节 |
| --- | --- | ---: | ---: |
| 迁移前 | backup/profile | 6631 | 223799474 |
| 迁移前 | backup/reflection-archive | 5991 | 183399489 |
| 迁移后 | backup/profile | 6630 | 226302068 |
| 迁移后 | backup/reflection-archive | 5991 | 183399489 |

每份集合含逐文件 name/bytes/mode/SHA-256。完整 Profile 本身已含旧归档，不能把两份数量相加当作唯一用户文件数。清单文件字节 SHA-256：

- 迁移前 profile-manifest.json：`<PRIVATE_SHA256>`。
- 迁移前 archive-manifest.json：`<PRIVATE_SHA256>`。
- 迁移后 profile-manifest.json：`<PRIVATE_SHA256>`。
- 迁移后 archive-manifest.json：`<PRIVATE_SHA256>`。
- 原 Reflection 文件保持 `<PRIVATE_SHA256>`。

迁移后独立完整性报告（私人归档内，不随公开仓库分发） 保存逐表摘要和全部保护结果：39/356 Raw 不变，40 Reflection 不变，配置/authority/屏障/P2 receipt/所有其他非数据库和非 jobs 原文件 SHA 不变，原 P1 批次和进度不变。正式 Profile 没有增加第二套权威数据或长期迁移服务。

最终校验时间 `2026-11-19T07:55:16.626Z`。文件级精确差异仅有 `memory-note-v2/note-v2.lbdb` 和 `note-formation-jobs.v1.json` 的内容变化；Worker 正常关闭 checkpoint 后 `memory-note-v2/note-v2.lbdb.wal` 不再存在，所以完整 Profile 文件数 6,631 → 6,630。没有删除其他文件，没有手工清理 WAL；迁移前快照保留原主库/WAL 配对，迁移后完整库在隔离副本重新读取并逐表验证。

失败/恢复步骤：

1. 正常关闭应用，检查 Electron/Worker 已退出，阻止新实例；不要强杀用户应用，不热拷贝主库或混搭 WAL。保留现状、新日志及新备份。
2. 若本次发布中断，保留 memory-maintenance.v1.json，先检查源、删除责任和 Receipt，再使用完全相同计划重跑上述 PowerShell 入口。不得改 UUID、正文、批准或 Journal 摘要来强行续写。
3. 若需整套恢复，核对选定快照的每个文件 SHA，完整复制到新隔离目录，再复制一份用于 Node 24.12.0 / Ladybug 0.22.1 WAL 恢复、逐表/来源/任务核验；原备份不打开、不修改。包括主库/WAL、jobs、authority、删除与迁移状态和归档，不单独换库。
4. 复核快照之后的删除请求与屏障，先消除任何可能复活的来源；通过后才能按明确恢复授权替换正式目录。替换前保留当前完整快照。旧格式未完迁移可在离线副本显式调用 scripts/legacy-memory-recovery.cjs 的原恢复 API；普通应用不再挂载旧迁移 UI/IPC。

本地备份含私有对话与凭据，Git ignore 和 SHA 不是加密/签名；同盘备份不提供磁盘损毁保障。离线/封存副本的后续删除、保留期限和安全存储仍由用户维护，不能因 Runtime 退役就遗忘。

## F. 已删除的业务及入口

- Web：legacy-memory.ts、reflection-formation.ts、reflection-recall.ts、reflection-store.ts、旧 note-organization.ts / note-recall.ts / note-draft.ts。真实依赖复核确认 note-draft 仅供旧链路，现役 Note v2 使用 Desktop 共享合同；不是按文件名删除。清除 stage/main/aisling 的旧工厂、watcher、Recall 注入、兼容生命周期与诊断字段。
- Core：legacy-recall.ts、./legacy-recall export、getHistoryAddon / HistoryRecallAddon 及旧打包/预算分支。现役 getNoteContext、Raw Recall、Context 和工具循环快照保持。
- Desktop：memory-organization.cjs、memory-write-policy.cjs、Reflection CRUD/Organization/Migration IPC 与 preload bridge。startDesktop 正常路径仅实例化 Note v2，旧格式拒绝直接启动；显式 P0 数据库实验仍隔离且无 Reflection 业务。
- UI/配置：LegacyMemoryControls.vue、MemoryMigration.vue、organizationEnabled 类型/设置、旧桥接类型及失去消费者的本地化条目。旧配置字段加载时丢弃，不自动转换为 Formation 授权；Memory/Formation/Recall 当前开关不变。
- 旧业务专属测试/夹具删除；有效通用保护测试迁移见 I。memory-migration.cjs 的旧格式恢复引擎移至 scripts/legacy-memory-recovery.cjs，仅供显式离线恢复，应用无 import，未作为兼容业务继续运行。

源码及生产 bundle 检查未发现旧 lazy import、旧 Reflection 工厂、Recall hook、悬空 IPC/export；构建不再生成 legacy-memory chunk。出现 reflection/Origin 的剩余代码是来源删除、旧数据拒绝、审计或离线恢复，不是旧 Formation/Recall。

## G. 保留的公共能力及删除屏障修复

| 模块 | 保留职责 |
| --- | --- |
| memory-database/note-v1.cjs、Store/Worker/adapter/protocol | 文件名虽含 v1，仍提供现役 Note v2 Schema、UUID、Revision、Receipt、事务、来源与版本验证 |
| formation-evidence.ts、memory-evidence.cjs、当前合同 | 原始引用 digest/角色校验、历史上下文与当前 Note 合同 |
| memory-archive.cjs、memory-lifecycle.cjs | 原始来源删除向历史归档/旧 Origin/派生 Note 传播；保留 journal/blocked/恢复闭包，删除已无调用的业务授权接口 |
| memory-authority.cjs、desktop-profile.cjs | P2 权威、封存/未准备根拒绝、单实例、维护期间阻止启动 |
| memory-files.cjs | 从旧迁移模块原样提取原子 durable 写入，归档/恢复/P2/P4-A 工具共同复用 |
| scripts/legacy-memory-recovery.cjs | 旧格式中断迁移的显式离线恢复；不被普通 Runtime 导入 |

本轮发现并修复实际隐私问题：旧逻辑一见 archive 即选 memory-erasure.v2.json，但 P2 统一 Profile 的实际既有 version=2 journal 名为 memory-erasure.v1.json，可能漏用原 5 个阻断 Session。现按真实统一状态继续使用原日志；若历史上已生成另一日志，必须覆盖旧 blocked/pending，否则拒绝启动并报 reconciliation 错误，不静默迁移或合并删除责任。增加旧 Session 不得复活、双日志不一致拒绝及真实 Electron 删除/重启回归；正式原日志本身未改动。

readUnifiedProfile 启动检查只确认 Reflection 归档文件存在，不读正文作记忆。归档正文仅可由隐私删除/完整性恢复路径处理；不会作为模型事实输入或新的生成/检索源。没有关闭删除闭包来换取“零 reflection 字符串”。

## H. 当前实际 Memory 架构

```text
原始 Session → Context
            → Raw Recall → Core 对话
            → Note v2 Formation → Store/Worker/LadybugDB
                                ↔ Organization + BM25/Embedding 候选
                                → Note Recall → Core 对话
                                → Obsidian Mirror（只读数据库）
历史归档 → 隐私删除/离线审计与恢复；没有进入对话的箭头
```

pnpm start / dev:desktop 共用开发启动器，start:desktop 使用同一启动器的 prod 模式；选择 P2 默认/显式隔离根的代码和配置未改。实际 Main 在 29 Note 隔离 Profile 分别通过生产 custom scheme 和 localhost:5174 开发页面启动，userData/sessionData 指向同一测试统一根。正常启动不再选择旧 Reflection 分支。P1 恢复和 P3/P3.1 合同、历史来源、候选、关系仍由原服务处理。

## I. 本轮实际测试、构建及失败记录

| 实际执行 | 结果/证据 |
| --- | --- |
| Core 全量 Vitest | 104/104 通过；.tmp/p4b/web-core-complete.log |
| Stage Web 全量 Vitest | 355 通过、1 付费 live 测试按约束跳过；同上 |
| Desktop + scripts 全量原生/Electron | 164/164、0 fail、0 skip；设置 AISLING_MEMORY_DB_P0_TEST_RESOURCES，固定 Node 24.12.0，串行 --test-concurrency=1；.tmp/p4b/native-final-all.log |
| Receipt 故障恢复专项复核 | 12/12；.tmp/p4b/reliability-final.log |
| 最新真实数据副本演练 | 10 个操作、失回复恢复、幂等、原始逐表行/Schema、队列完整性通过；revision-2/rehearsal-verified.json |
| 正式迁移后校验 | 10 Receipt、逐表原行、合法 Source、全部非目标文件 SHA、完整新备份通过；formal-verified.json |
| Main 生产/开发 + 29 Note | 同一隔离统一根，Note Recall ready=29，旧桥接拒绝，外部 Provider 调用=0，Raw Session 不变；application-verified.json |
| pnpm typecheck | 三个工作区均通过；.tmp/p4b/typecheck-final.log |
| pnpm build | 通过；.tmp/p4b/build-final.log；仍有已有 >500 kB chunk 提示 |
| Git diff/敏感数据 | diff --check 通过；逐项审查改动/依赖，实际配置凭据与完整私有消息比对无命中，ignore 保护已验证；git-safety-verified.json |

有效保护断言的迁移：Core 原 v2 快照/工具循环用 runtime-memory.test.ts 保留，当前 Raw 重打包断言仍在；旧 Note adapter 的主体、引用、日期、助手承诺、pattern 与源变更保护转到 note-contract-protection.test.ts 的实际 Parser/Formation；原 Reflection IPC 的原子写入/损坏/未来格式拒绝转到 memory-archive.test.cjs；旧 lifecycle/restart 测试改为真实当前 Electron Note+归档删除链路（包含 durable intent 后退出再恢复）。原旧格式迁移的回滚、丢回复、来源变化、无效记录/删除屏障断言继续在离线恢复引擎测试。没有通过删除这些保护获得通过。

本轮发现过的失败均保留日志：初始 Core HTTP mock 沙箱限制后在获准环境重跑；旧桌面默认模式断言因正常入口现已 Note v2 而更新；归档夹具/异步删除读屏障断言纠正后通过；完整回归一度 163/164，Receipt 故障测试的 1.5 秒后台 Organization 在较慢机器上先恢复成功，与测试“仍 settling”断言竞争。只在该测试固定定时器，保留所有失败分类/重试/不重复/隐私断言，未改生产 P1 行为；专项 12/12 及最终完整 164/164 通过。一次未传 resources 的执行为 71 通过/93 跳过，明确不算原生验收。历史 P4-A/P3/P2 的结果没有冒充本轮通过。

发布工具初次单测的删除屏障错误文本匹配也曾失败，现按稳定 `code=erased` 断言，仍验证拒绝重放；没有放宽屏障（初次日志 publisher-tests.log，最终包含在完整回归中）。

没有执行：付费 LLM/Embedding、正式配置下的自动 Formation、真实 Vault 同步/清理、人工可见窗口交互、整机断电。正式用户数据仅执行批准的冻结迁移及队列登记；删除/故障/模型调用测试均使用隔离数据、合成材料或本地 mock。

## J. Obsidian Mirror

最新演练输出 29 份受管 Markdown，逐张核对 Note ID、正文、version、来源 Session/digest；保留原 17 关系和手工 manual.md，重复同步 written=0、removed=0。实际 Main 的 prod/dev 29 Note 副本也同步到独立测试 Vault，外部调用被禁止，复制配置中的凭据被清空。真实配置与真实 Vault `<OBSIDIAN_VAULT>` 没有修改；Mirror 仍只读取 LadybugDB，不读历史 Reflection，不写回记忆。

## K. 风险、检查点与收束结论

没有待批准迁移操作或未解释的 Receipt/表差异。5 条 D（R01/R24/R33/R39/R40）仍无法认定为事实；它们已完成审查和不迁移处置，不能把“不迁移”误报为已解决真实性。2 条 C 保留历史；E 不新增。原 7 个 Formation failed 批次保留，未来按 P1 明确重试，不因退役重放。未来真实 Embedding/Organization 的质量和费用尚未实测；新任务只是进入现有队列。

仍需持续履行离线/封存备份的隐私删除责任；所有恢复先复核最新屏障。双日志不一致须人工核对，不自动选择较弱日志。当前测试没有覆盖整机断电或所有文件系统故障；恢复依据为已验证完整快照、稳定 Receipt、durable journal 和失败时保留维护标记。

本报告、工具、测试和 Runtime 退役属于一个 P4-B 本地代码检查点；准确 SHA 用 `git log -1 --format=%H -- docs/memory-v0.4.0-p4b-reflection-retirement.md` 获取，并在最终交付注明。独立数据检查点以 E 节路径和 SHA 为准，Git 不恢复真实 Memory。所有 artifacts/.tmp/数据库/凭据/私有审查均不纳入提交；无用户无关工作混入。

1. **有价值历史是否迁移：是。** A 的 9 条形成 10 张合法来源 Note，B 的 4 条有真实现有覆盖。
2. **是否仍有未处理认识：40/40 均有最终处置，0 待批准；D 的 5 条真实性仍未确认，未迁移为事实。**
3. **Reflection Formation/Recall 是否退役：是。** 旧业务实现、普通选择分支、UI/IPC/export 已移除；保留的是隐私/离线恢复职责。
4. **正式架构是否统一：是，Context + Raw Recall + Note v2 Recall。**
5. **数据与配置是否完整：是。** Raw 39/356、Reflection 40、原 Note 19/关系17、配置/authority/屏障及 P1 进度均验证保留；合法新增后 Note29。
6. **是否仍有隐私/恢复风险：有持续责任和未测故障边界，已在上文明确；没有本轮未解决的数据完整性失败。**
7. **是否达到 v0.4.0 Memory 工程收束条件：是。** P4-B 完成；版本仍为 v0.3.9，没有把工程完成等同于 Release、付费模型质量验收或历史猜测全部为真。
