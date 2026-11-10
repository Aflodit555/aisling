# Project Aisling · Note-only Memory P0

## 1. Git 基线与实施边界

实施起点为分支 `main`，HEAD `271d19e4a564993c22ed599076cff37cf9095720`。基线已有 23 个已跟踪文件的未暂存修改和 155 个未跟踪文件，包含 Main、Stage、Core 的变更和 `apps/stage-web/src/runtime/note-recall.ts`。暂存区为空。保留了现有修改。

P0 的 v2 Store 只通过隔离测试入口使用，库名为 `note-v2.test.lbdb`。正式 Electron 仍使用 v1。测试只用合成会话、工作区测试 profile、模拟 Provider 或本机 Node Worker。没有运行真实 Provider 或用户数据迁移。

## 2. 实际修改

| 文件 | 本轮改动 |
| --- | --- |
| `apps/stage-desktop/memory-database/store.d.ts` | Note v2 的 meaning、operation、Revision、Receipt、擦除范围与受信调用契约。 |
| `apps/stage-desktop/memory-database/store.cjs` | 共用 Worker 连接，增加 `createNoteV2Store` 的受信证据与主体校验、可召回头查询、串行变更。 |
| `apps/stage-desktop/memory-database/note-v1.cjs` | 复用现有生命周期事务。按 v1/v2 合同校验字段、结构证据、主体一致性并选择快照列。 |
| `apps/stage-desktop/memory-database/adapter.cjs`、`protocol.cjs`、`worker.cjs`、`client.cjs` | v2 隔离库名、物理 Schema、RPC 允许列表、握手检查。 |
| `apps/stage-desktop/memory-database/erasure.cjs` | v2 按原始 Evidence/Session 擦除，复用墓碑、回执和事务。分页读取 Note 的累计 Evidence。 |
| `apps/stage-desktop/memory-evidence.cjs`、`apps/stage-desktop/memory-organization.cjs` | 将现有 Main 的原始证据查询提取为共享函数。v1 服务继续使用其原有调用和授权规则，v2 从同一查询取得证据角色。 |
| `apps/stage-desktop/memory-note-v2.test.cjs` | 隔离原生数据库的合成证据、生命周期、失效、回滚、重启和隔离测试。 |
| `docs/memory-note-only-p0.md` | 本报告。 |

## 3. Note-only 领域合同

`NoteV2` 保留一个语义正文 `content`、确认的 `subject`、`kind`、`basis`、`uncertainty`、`eventTime`、可选 `tags`，以及 `id/createdAt/status/version`。 `kind` 使用原有六类 `event | fact | pattern | preference | project-state | open-question`，为后续语义检索和授权保留离散信号。 `eventTime` 仍支持未知、日期、日期范围和绝对时刻。v2 不接收 v1 的 `context/keywords`。状态仍为 active、superseded、retracted。

`NoteV2Operation.sources`、Revision 的 `grounds`、NOOP Receipt 的 `links` 都是 `{evidence: EvidenceRef[]}`，每个引用仅含 `sessionId/messageIndex/digest`。ADD、UPDATE、SUPERSEDE 写入语义时，至少需要一个不同位置的 Evidence。inferred、mixed 及所有 pattern 必须有非空 uncertainty 和至少两个不同位置。受信 Store 进一步要求这些认识有两条不同正文的用户报告。直接的 fact、preference、project-state 至少有一条用户报告。直接 event 可记录助手发言，主体及归因仍由受信上层处理。重复引文、两个摘要指向同一位置、用户报告加助手复述均不满足多证据门槛。检查证明身份、出处和最低证据门槛，语义蕴含及不同经历仍需业务判断。

`NoteV2Authority.isSubjectConfirmed(subject)` 必须明确返回 true。没有从模型提议读取 `confirmed`、UUID、版本或任意引用的入口。P0 的命令由受信代码构建，测试仅使用程序生成的 ID、固定确认主体和合成会话。该回调提供主体门槛，生产操作权限仍由原 Main 独立裁决。

## 4. 新旧合同与 Origin 解耦

| 项目 | v1 | v2 P0 |
| --- | --- | --- |
| 建立 Note | 创建要求 Origin 与 Evidence。 | 一条原始用户报告可直接创建 fact。Origin 字段和表均不属于 v2。 |
| Meaning | 无 kind，允许 context/keywords。 | kind 持久化，允许直接与归纳内容，依据和不确定性与最低证据一同校验。 |
| 读取 | 正式候选及 Recall 依赖 Reflection 来源存在性。 | `listRecallHeads` 验 active、确认主体、当前 grounds 及全部累计 Evidence。 |
| 修订 | 旧命令和 Receipt 指纹格式。 | 相同操作生命周期，UPDATE 与 SUPERSEDE 保持同一 subject。v2 命令及 Receipt 使用直接 Evidence。 |
| 库与协议 | `note-v1.lbdb`，`Note.snapshot`。 | `note-v2.test.lbdb`，`Note.snapshot_v2`，独立允许列表和 ready schema。 |

`createNoteV2Store` 只接受 v2 测试库名，旧 Store 拒绝 v2 库名。Worker 检查解析后的路径和 v2 文件类型，拒绝非普通文件及已有多重硬链接。即使将独立 fixture 的旧库复制到新文件名，旧快照列也会触发 Schema 拒绝。反方向同样验证。该区别无需另起 Worker 程序。v1 的 Origin、指纹、RPC 与正式路由沿用现有合同。

## 5. Evidence 验证与失效

`sourceMessageLookup` 读取权威 ConversationStore 的 Desktop 存储格式，拒绝重复 Session ID，以数组零基位置定位原始消息，重算其完整 JSON 的 SHA-256。只允许普通 user/assistant 文本，排除工具来源和 `noteDerived`。v2 写入还拒绝空白原文。Note 仅保存语义正文和引用，原始消息正文留在 ConversationStore。v2 复用 `Evidence` 主键与 `HAS_EVIDENCE` 边，同一三元组可被多个 Note 引用。

`listRecallHeads` 对已提交的 active 头按页取得候选，再分页读取每条 Note 累计 Evidence。最终从当前 ConversationStore 快照统一复核，校验头 Revision 的 Evidence 均有图边以及角色门槛。历史 Revision 或 NOOP 补证缺失、摘要改变时，对应 Note 立即从候选中排除，即使当前 Revision 的依据完好。管理读取 `getNoteV2/getRevision` 用于检查持久状态，与可召回查询分开。取回候选后的跨轮快照废弃由未来调用方负责。

`eraseSources({operationId,evidence,sessionIds})` 通过 Evidence 精确三元组或 Session 找到累计依赖的所有 Note，再清理相应头、全部 Revision、Receipt 和无引用的 Evidence 节点。SUPERSEDE 的明确生命周期关联通过 Receipt 覆盖两个端点。新 v2 链路没有 Reflection、同批传播或 RELATED 扩展。原始来源仍为其他独立 Note 服务时，该节点保留。

**保守处置。** 当前头的语义依据和历史／补证的隐私依赖范围不同。P0 对累计依赖失效先屏蔽 Recall，明确擦除时清除整条相关 Note 历史。这也可能清除仍有足够当前依据的认识，或因取代回执删除另一端。保留某个版本的前提是以后能证明其语义和持久历史与删除材料独立，并覆盖残留回执和衍生记录。P0 不自动重建这类 Note。

## 6. Schema、事务和重启

v2 库包含 `Note`、`NoteRevision`、`NoteOperation`、`Evidence`、`HAS_EVIDENCE`、`MemoryTombstone`、`MemoryErasure`。复用 v1 的头快照与 Revision 快照布局，以便 P0 只变化合同与来源。没有 Origin、Source 节点或 RELATED。Note v2 分页最多四个头，累计 Evidence 每页 16 条，保持 Worker 帧有界。

- ADD 分配新 Note 版本 1。UPDATE 保留 ID、createdAt 和旧 Revision，期望版本不符时拒绝。
- NOOP 只在当前版本追加去重后的 Evidence 和 Receipt，语义与版本不变。空补证 NOOP 可确认命令。RETRACT 可无新增 Evidence，并保留原有依据及历史。
- SUPERSEDE 在同一事务写旧 Note 的终态版本和 successorId、新 Note 及两端 Receipt；RETRACT 更新终态并退出 Recall。
- Note 头、Revision、Evidence 边和 Receipt 原子提交。operationId 相同且规范化命令指纹相同则返回原回执，异指纹拒绝。
- 擦除事务把清理、Evidence/Session/Note/operation 墓碑和 MemoryErasure 回执一并提交。重启后用同一擦除 ID 重放可取回原结果，旧证据或旧操作不能借重试复活。
- 主进程的 v2 Store 实例串行化写入、擦除及验源快照。Worker 自身继续串行执行 RPC 并使用现有事务。断管期间的写入结果由 Receipt 或稳定擦除 ID 判定，避免猜测是否提交。

## 7. 测试结果

| 验证 | 结果 |
| --- | --- |
| Core / Stage Web 的 `pnpm test` | Core 110/110，Stage Web 402/402。默认沙箱拦截本地回环模拟服务，解除该限制后全量通过。 |
| `pnpm typecheck` | Core、Stage Desktop、Stage Web 通过。 |
| `pnpm build` | 通过。Vite 报告既有主 bundle 大于 500 kB。 |
| Desktop 原生 Node/Worker | 33/33，其中 5 项新 v2 测试、28 项 v1／P0／Organization／erasure 回归。另行运行下列 Electron 测试。 |
| Electron Note v1 写入和重启 | 1/1。默认沙箱启动返回 `0x80000003`，独立合成 profile 在解除启动限制后，分别经两个 Main 与 Worker 写入／重开成功。 |
| `git diff --check` | 通过。 |

新用例验证单源直写、跨源 inferred、Origin/空证据拒绝、摘要改变与主体未确认、UPDATE 历史、NOOP 分页与去重、SUPERSEDE/RETRACT、精确删除与 Session 删除、共享与历史来源传播、事务尾部故障回滚、提交后回包丢失、Receipt 幂等及 v1/v2 双向隔离。测试资源从已准备的 Node 24.12.0 和 LadybugDB 0.22.1 复制到忽略的测试目录，Worker 脚本来自本轮源码。复跑时将当前的 adapter、protocol、worker、note-v1、erasure 脚本复制到新建的已准备资源目录，把该目录设置为 AISLING_MEMORY_DB_P0_TEST_RESOURCES，再运行 node --test apps/stage-desktop/memory-note-v2.test.cjs。

## 8. P1 接口及待解决事项

- P1 调用 `createNoteV2Store(resolveWorker, report, authority)`。程序从持久 ConversationStore 解析 E，确认 S，绑定 N 的 ID／版本，生成稳定 operationId 后才构造命令。将现有逐字引文、敏感文本、语义支持和自动写入规则留在上层审核，不能用 P0 最低证据数代替授权。
- 写入使用 `applyNoteOperation`。结果不明时用 `getOperationReceipt` 按稳定 ID 核查。读取使用 `listRecallHeads`。P0 按候选扫描累计 Evidence，正式接入前需测延迟与规模。跨页去重、删除 generation、请求发出前的快照作废以及 Core 注入由后续对接。
- 跨存储删除仍需 Main 持久 journal。P1 应在源删除前记录稳定的 Evidence/Session 擦除 intent，阻止派生读写，再调用 `eraseSources`，用 `erasedNoteIds` / 回执恢复并在完成后解封。P0 验证 DB 擦除与重放，尚未接入实际 ConversationStore 删除事件或跨存储恢复。
- 直接 Evidence 支撑 Note 的原始依据。未来派生关系描述采用的父 Note 及其明确版本，不能补足缺失的原始证据。待确定采用父版本后的语义失效和模型看到的上下文擦除范围。本轮没有派生边或图遍历。

## 9. 旧数据过渡建议

后续以版本化的新库和显式切换迁移。先完成旧擦除 intent 并冻结写入，核验所有头、历史 Revision、NOOP 补证的 Evidence 及旧 Origin，翻译有效引用和墓碑，然后在目标合同中去除 Origin。保留 UUID、版本、终态、取代记录和回执的审计用途。旧 v1 Receipt 的指纹仅核验旧合同，新命令使用新的指纹及可重试标识。

有确定来源及等义 Reflection 的旧 Note 可映射 kind，歧义类别或缺少支持的内容需另审。用稳定映射和迁移检查点保证幂等，切换前以合成 profile 验证中断、擦除和恢复。正式库没有执行原地迁移。
