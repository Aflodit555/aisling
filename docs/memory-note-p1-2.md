# Project Aisling · Memory Note P1.2

2026-11-05 · Windows x64 · LadybugDB 0.22.1（存储格式 49）· Worker Node 24.12.0。

P1.2 将 P1.1 确认的 Note v1 写入契约接入正式 Memory Database 模块。只有显式选用 v1 的受控 Main 测试入口会打开 v1 数据库。试验使用合成 Note 和来源引用，现有桌面启动仍按 P0 的开关和 profile 规则执行。

## 物理结构与隔离

| 表 | 列及职责 |
| --- | --- |
| `Note` | `id STRING PRIMARY KEY, snapshot STRING`。快照是由 Worker 验证后写入的 JSON，包含完整 `id/content/subject/createdAt/eventTime/basis/uncertainty/status/version/context/keywords/tags`。当前读取只查这一条快照。可选字段按契约省略，`eventTime` 可为 `null`。日期、精确毫秒、日期区间通过判别联合保真，事件时间和首次写入时间各自保存。 |
| `NoteRevision` | `key STRING PRIMARY KEY, data STRING`。键用 `[noteId,version]` 的 JSON 编码。内容保存 `noteId/version/operationId/action/changedAt/reason/grounds/snapshot` 和可选 `successorId`。只通过 `CREATE` 追加。 |
| `NoteOperation` | `operationId STRING PRIMARY KEY, data STRING, sourceNoteId STRING, sourceVersion INT64, sourceKeys STRING[]`。回执内容为 `operationId/fingerprint/action/changedAt/affectedNotes` 和可选 `links`。后三列仅为补证归属和去重服务，空增量回执不进入补证查询。 |
| `Origin`、`Evidence` | 复用 P0 的 `Origin(reflectionId STRING PRIMARY KEY)` 与 `Evidence(key STRING PRIMARY KEY, sessionId STRING, messageIndex INT64, digest STRING)`。Evidence 键以 `[sessionId,messageIndex,digest]` 编码。`HAS_ORIGIN`、`HAS_EVIDENCE` 将 Note 连到共享引用，保存该 Note 曾建立的关系。 |
| `RELATED` | 保留 `FROM Note TO Note` 有向表。原有关系 API 仍属 P0 白名单。v1 本阶段未增加关系编辑或图读取入口。取代身份单独存在 Revision。 |

当前记录、版本和回执按主键定位。受限 JSON 快照让历史直接还原同版领域字段，字段值域由 Worker 校验。P1.2 没有按快照语义检索的消费者，因此未增设投影列或语义索引。版本与回执各自有独立主键，一个 SUPERSEDE 的两条 Revision 可共享同一 operationId。

Host 继续要求绝对资源路径和独立的空目录或带标记 profile。P0 使用 `memory-db-p0/memory.lbdb`，v1 使用 `memory-note-v1/note-v1.lbdb` 及不同 profile 标记。Worker 依据文件名选择 Schema 和请求白名单，Adapter 在初始化前检查已有 `Note` 的列形状，复制或改名的 P0 三字段库会被拒绝。P0 模式仅启用旧操作，v1 模式拒绝旧的 `insertNote`、`addOrigin`、`addEvidence` 和通用 `transaction`。Ready 报告 `schema`，v1 Client 要求 `note-v1`，旧 Worker 既不接受 v1 文件名也不会报告该能力。封包协议和应用版本保持原值。

## 事务和恢复

Worker 先检查请求形状、字段限制、来源格式和时间有效性。Adapter 对对象键及来源集合规范化，来源去重，语义数组保序，计算 SHA-256 指纹。连接 requestId 和服务端时间不参与。事务开始后首先查询 operationId，命中相同指纹时返回原回执，即使目标已进入新版本或状态。不同指纹返回 `operation-id-conflict`。未命中时在事务内读取当前 Note 并检查状态、预期版本和操作前提，最后写入回执，提交后才回复。

| 动作 | 同一事务内的持久化效果 |
| --- | --- |
| ADD | 用首次写入时钟创建 active Note 和 Revision v1，要求 Origin 与 Evidence，建立关联并提交回执。Note ID 已存在则拒绝。 |
| UPDATE | 要求 active、匹配版本及 Evidence。完整语义发生字段变化才推进版本。保留 ID 和 `createdAt`，写当前快照、新版及本版来源和回执。 |
| NOOP | 要求 active 且版本匹配。已有必要引用或同版补充引用会去重。只新增回执，或同事务建立图关联并保存实际增量及其所属版本。不增加 Revision。 |
| SUPERSEDE | 要求 active、匹配版本、不同且未使用的新 ID，以及受信调用方显式声明同范围变化。检查主体一致并要求来源。创建 B 与 v1，A 改为 superseded 并追加带 `successorId` 的 Revision。B 和 A 共用一条回执。 |
| RETRACT | active 或 superseded 可在匹配版本时进入 retracted，追加理由及可选来源。保留正文和旧版。后继保持独立。 |

读取某版必要来源用 `getRevision(id, version).grounds`。NOOP 补证用 `getVersionSourceChanges(id, version, afterId?)`，每页最多四条操作回执，以 operationId 排序并返回下一游标。分页提供有界点读，完整审计遍历应在该版本无并发补证时执行。图上的 Note 来源并集用于实体关联，不能用于决定任一版本的必要来源。退役 Revision 的 `grounds` 保存该次状态变化依据。历史读取只返回指定版，不自动获取整条修订链。

客户端将 `applyNoteOperation` 归为写入。Worker 退出或超时导致成功响应不明时返回 `outcome-unknown`，重开后使用 `getOperationReceipt(operationId)` 确认是否提交，客户端不重放。版本过期和非法转换分别使用 `stale-version` 与 `invalid-transition`。协议继续拒绝任意 Cypher，单帧 64 KiB，列表条数、文本长度和分页条数均有上限。

## 文件与接口

- `note-v1.cjs` 定义领域形状校验、请求规范化、事务动作、修订及回执查询。`adapter.cjs` 负责文件和 Schema、复用图关系、提交与回滚。
- `protocol.cjs` 区分白名单并登记写操作。`worker.cjs` 分派请求并报告能力。`client.cjs` 检查 Ready 的 Schema。`host.cjs` 只通过显式参数选择 v1 隔离 profile 与库文件，正常应用调用原入口。
- `store.cjs` / `store.d.ts` 增加 `applyNoteOperation`、`getOperationReceipt`、`getNoteV1`、`getRevision` 及有界补证读取。Preload 与 Renderer 桥保持原入口。
- `scripts/prepare-memory-database.ps1` 把 v1 模块复制进 Worker 资源。`note-v1-fixture.cjs`、`memory-note-v1.test.cjs`、`memory-note-v1-smoke.cjs` 提供共享合成夹具、真实 Worker 故障测试和真实 Electron Main 测试。

## 实测

- **真实 Electron 44.4.3。** 写入 Main / Worker 为 12280 / 30824，重开为 33516 / 11352。验证了 ADD、UPDATE、NOOP、版本补证分页、SUPERSEDE、RETRACT、历史和操作回执。测试核对 Worker 可执行路径、数据库和 profile 位于合成环境，旧合成 Reflection 文件字节未变，两个 Worker 正常退出。 [Note v1 测试日志](../artifacts/memory-note-p1-2/note-tests.log)
- **真实 Worker 故障。** 同版本的两次队列写入只有一次成功。故障夹具在 SUPERSEDE 已写两个 Note、Revision 和来源后，于插入回执时触发主键冲突。重开确认业务写入回滚，并直接核对 Origin、Evidence 及两种来源边均只剩提交过的首版数据。另一个夹具在真实 Worker 提交后拦截成功响应并强杀 Worker，Client 返回 `outcome-unknown`，重开查到持久回执和首版，重放相同请求仍返回同一回执。竞争 Worker 因文件锁失败。已有 P0 数据文件的副本不能以 v1 打开。故障注入仅在测试包装器。 [Note v1 测试日志](../artifacts/memory-note-p1-2/note-tests.log) · [来源边回滚](../artifacts/memory-note-p1-2/rollback-edges.log)
- **现有 Desktop 与 Memory。** 原 Desktop 38/38，通过 P0 关闭、写入、Worker/父进程退出、重开及缺资源降级。真实应用使用 mock Provider 通过原始 Memory、Formation 和 Reflection Recall smoke。 [Desktop 回归](../artifacts/memory-note-p1-2/desktop-regression.log) · [P0 与 Memory smoke](../artifacts/memory-note-p1-2/p0-smokes.log)
- **Core / Web。** Core 109/109、Web 376/376。首次与生产构建并行时，Web 的一项 Recall 时间语义测试未取到结果。串行复跑全部通过，业务源码保持原样。 [首次运行](../artifacts/memory-note-p1-2/core-web.log) · [复跑](../artifacts/memory-note-p1-2/core-web-rerun.log)
- **P0 关闭的生产 smoke。** TTS、Context 和默认启动均通过。P0 文档记录的 `composerShown` 基线失败本次未复现，相关 UI 未修改。 [TTS](../artifacts/memory-note-p1-2/prod-speech.log) · [Context](../artifacts/memory-note-p1-2/prod-context.log) · [默认启动](../artifacts/memory-note-p1-2/prod-normal.log)
- **类型与构建。** 全仓类型检查、生产构建通过。构建仍报告既有的较大 chunk。 [类型检查](../artifacts/memory-note-p1-2/typecheck.log) · [生产构建](../artifacts/memory-note-p1-2/build.log)

当前环境沙箱曾使 Chromium GPU 子进程启动失败。使用允许启动 Electron 子进程的环境后，真实 Electron 验收成功。

## 实施结论与后续边界

**满足 P1.2 完成条件。** P1.1 的独立 Note 身份、原子生命周期、不可变版本、按版本的来源、持久回执和幂等恢复均已落地。`active` 和 `direct` 仅为数据契约字段，不能证明证据真实性。数据库只校验引用结构及版本归属，来源复核、角色语义、可靠的 Formation 产物身份以及 Recall 资格仍由未来受控业务入口负责。取代的语义范围由受信调用方确认。

Activation、自动 Formation、Recall 集成、物理删除和真实数据迁移不在本阶段。未来接入正式资料前仍须定义外部 JSON 的新鲜度、用户删除的可见性、历史与共享证据的擦除以及回执重放期限。断电、系统关机、安装包和正式用户 profile 尚未验证。

从仓库根目录用已按 P0 步骤准备、且包含当前四个 Worker 源文件的资源运行。Electron 测试需要允许子进程启动。

```powershell
$env:AISLING_MEMORY_DB_P0_TEST_RESOURCES = (Resolve-Path '.local/memory-database').Path
node --test apps/stage-desktop/memory-note-v1.test.cjs
```
