# Note-only Memory 工程基线

## Git 基线与范围

收束开始时在 `main`，HEAD 为 `271d19e4a564993c22ed599076cff37cf9095720`。暂存区为空，53 个已跟踪文件有改动，186 个未跟踪文件。原有已跟踪差异增加 1,564 行、移除 652 行。逐项核对了 `git status --porcelain=v1 -uall`、`git diff --stat`、`git diff --numstat`、`git diff --check` 和 `git ls-files --others --exclude-standard`。

工程提交为 `dbd88f3af3a0de2683fbe5f5300f4bd3261d77eb`。这份报告由随后的一次纯文档提交纳入，其父提交就是工程基线。工程提交后，暂存区为空。工作区保留 `memory-organization-smoke.cjs` 的旧实验改动和 154 个未跟踪历史文件。当前报告提交后仍应是这组保留项。版本号和依赖锁定保持原值，操作全部在本地。

## P0–P5 架构一致性

| 边界 | 当前路径与验证 |
| --- | --- |
| 会话和 Formation | `apps/stage-web/src/stores/stage.ts` 持久化已交付交互，再将可用消息位置交给 `runtime/note-formation.ts` 和 Main。`apps/stage-desktop/note-formation.cjs` 管理三交互批次、持久作业、轮次与恢复。共享合同 `note-formation-contract.mjs` 验证 E/S/N 标签。Renderer 每批发起一次模型请求。提议直接生成 Note 操作，v2 路径没有 Reflection 产物。 |
| Main 与 IPC | `main.cjs` 调用 `desktop-app.cjs:startDesktop`，独占 Profile 并选择权威。`preload.cjs` 根据模式暴露相应桥。Main 校验来源窗口和 origin，在原生批准后重新从持久作业取提议，核对主体验证、来源和目标版本。正式 v2 未提供自动批准策略，恢复可完成已授权操作。 |
| Note v2 与来源 | `memory-evidence.cjs:sourceMessageLookup` 按 Session、消息位置和完整消息序列化后的 SHA-256 复核。Note v2 合同不含 Reflection Origin。`HAS_EVIDENCE` 保存直接引文来源，`HAS_CONTEXT` 保存 Formation 输入和 N 候选的经核验原始依赖闭包。Worker 在事务中写入 Note、Revision、Receipt 与相应证据边。同一稳定操作 ID 依赖 fingerprint 与 Receipt 恢复。 |
| 删除和派生 | `desktop-store.cjs` 更新会话前调用 `memory-lifecycle.cjs:beforeConversationChange`，持久化 intent 和永久屏障，阻断有未完成删除的记忆读写。重开 Worker 后安装屏障并重放 `eraseSources`。依赖检查覆盖历史 Revision、补证、共享证据、上下文和取代链。完成 v2 与必要的旧档案清理后再完成日志。`stage.ts` 将使用 Note 的助手输出及当前会话的后续派生回复标记为 `noteDerived`，Main 和 Formation 排除这些消息作为新证据。用户新陈述仍可独立参与。 |
| Recall 与 Core | `noteFormation.recallSnapshot` 从可信 Main 返回已核验投影。Stage 的 `note-v2-recall.ts` 本地排序、去重和限制预算，Core `runtime.ts` 先保障当前 Context，再装配 Raw 和 Note，并在请求及后续工具轮核验快照。Reflection 装配经旧 Stage 的 `legacy-memory.ts` 注入，独立出口为 `@aisling/core/legacy-recall`。 |
| 旧资料与迁移 | 构建版 Stage 的新资料直接使用 v2。旧资料保留 Reflection、旧 Organization 和 v1 Recall。迁移 `memory-migration.cjs` 从只读预检开始，经原生确认、冻结、独立目标库导入和读回后才发布 `memory-authority`。迁移中断保留恢复状态。仅来源完整且可证明独立的合格阻断条目可经确认留档。已迁移资料只在历史擦除时按需使用 `memory-archive.cjs`，不会重新开放旧写入入口。 |

在所查的正式入口和隔离回归中，未发现新建或已迁移 Profile 同时使用 v1/v2 作为写入权威，或 v2 Core 请求仍装配 Reflection。Vite 继续走旧开发入口，已选择 v2 的 Profile 要求构建版 Stage。旧 Profile 既有窄规则授权与新 v2 的逐条原生批准分别受各自权威约束。

## 保留与清理

- **正式源码。** 保留 ConversationStore、Raw Recall、Core Context、Note v2 Formation/Recall、Main 审核与受信 IPC、Worker、图合同和迁移入口。初始未跟踪的 `runtime/note-recall.ts` 由旧适配器实际导入，纳入基线。`memory-evidence.cjs` 和 `memory-text.mjs` 分别复用来源验证和检索处理。
- **兼容。** 保留旧 Profile 仍调用的 Reflection Store、Formation、Recall、Note Draft/Organization、v1 Schema 以及 Core 旧装配适配器。保留迁移分类器、历史擦除适配器和 P0 独立图冒烟入口。旧设置 UI 和运行 chunk 随包构建，由对应 Profile 按需加载。
- **清理。** 累计差异已删除 Stage 的实时 A/B/C 实验开关、复制提议正文的运行跟踪和新资料上的旧 Organization/Reflection IPC，裁切 Core 内的旧装配。收束阶段另去掉新增文件末尾多余空行，并将旧 Organization 烟测的主体定位及控件断言同步到现行合同。旧烟测的真实模型实验差异保留在工作区。没有删除任何完整源码、测试或研究文件。
- **未跟踪文件。** 初始 186 个中纳入 32 个经过核对的生产源码、正式合成回归夹具及 P0–P5 阶段文档。其余为 `reports/reflection-recall-ab-test-2026-11-02/` 的 147 个研究文件、`docs/memory-p1-8.md` 和 `docs/memory-p1-{9,9-1,10,11}-validation.md` 的 5 份旧 v1 研究记录，以及 `memory-note-recall-smoke.cjs`、`memory-semantic-smoke.cjs` 两份旧实验脚本。保留其历史复现价值，未读取研究包的原始请求或响应正文。P5 移除了实时实验接口，冻结的研究包不代表现行构建的行为。
- **忽略和敏感内容。** 保留 `.local/`、`artifacts/`、依赖、构建输出、`.env` 和日志等忽略规则，并增加 Note 数据库、权威标记、迁移状态、作业和删除日志规则。核对了暂存文件名、二进制差异、异常文件体积和常见凭据签名。测试字面量是合成值。工程提交未包含 Profile、原始对话、数据库、运行资源或日志。

## Worker 启动与文档

正式 v2 开库位置是 `<userData>/memory-note-v2/note-v2.lbdb`。旧库留在原位置。Worker 由 Main 以独立 Node 24.12.0 x64 启动，LadybugDB 固定 0.22.1。JSON Lines 握手校验协议、进程、版本与 Schema。打包环境使用 `resources/memory-database`。源码启动的默认路径是 `.local/memory-database`，本次发现其中五个脚本都与当前源码不同，协议号并不能发现所有这种变化。共享 `memory-database/client.cjs:startWorker` 现在在该默认路径校验五个脚本和两份依赖清单，发现差异时在 `spawn` 前报告 `stale-worker-resources`。已准备的显式隔离夹具仍可按既有方式注入崩溃点。

`scripts/prepare-memory-database.ps1` 会将校验过的运行时、原生依赖、固定清单和本次 checkout 脚本复制到新目录，要求输出路径尚不存在。本轮没有覆盖现有 `.local`。隔离测试从既有原生资源复制并重新核验运行时和原生插件的固定 SHA-256，再复制当前脚本与清单。未重新执行 MSI 提取或在线安装。安全更新步骤见 [Memory](memory.md)。同步更新了 [README](../README.md)、[Desktop Host](desktop-host.md) 和 [早期 Worker 实验记录](memory-database-p0.md)。

## 验证

| 验证范围 | 结果 |
| --- | --- |
| `pnpm test` Core | 112/112 通过，19 个测试文件。 |
| `pnpm test` Stage Web | 402/402 通过，42 个测试文件。 |
| `node --test --test-concurrency=1` Desktop 全量 | 84/84 通过，0 跳过。比 P5 的 83 项增加 1 项旧 Worker 资源校验。覆盖 Note v2 Formation 和 Recall、旧 v1、P4/P5 迁移和处置、共享证据及历史 Revision 擦除、删除屏障、丢回包和 Worker 重启。 |
| `node scripts/test-memory-database.cjs` | 专用 P0 图实验、进程退出和重新打开通过。旧 Raw Recall 和 Reflection Formation 在 Worker 缺失下的 Mock 冒烟均通过。 |
| 暂存区快照标准 Electron Main | 隐藏窗口直接加载 `main.cjs`。当前资源打开 v2，新资料暴露 v2 桥而且不加载旧 Organization。只替换隔离副本中的 `erasure.cjs` 后，Main 报 `stale-worker-resources`，未创建 Note 数据库。 |
| 暂存区快照 Context 与旧 Organization | Mock 冒烟通过。旧烟测检查现行 Formation/Recall 控件，验证旧提议、v1 Worker、重载与删源。可选截图在隐藏窗口中超时，未取得截图。 |
| `pnpm typecheck`、`pnpm build` | 通过。主 chunk 779.10 kB，独立旧兼容 chunk 50.33 kB。 |
| Git | `git diff --check` 与 `git diff --cached --check` 通过。工程提交 89 个文件，其中 32 个新增，无整文件删除。 |

最初普通沙箱阻断 Core 的 4 项本机 HTTP Mock 集成测试。允许本机回环后完整复跑通过。第一次核对 P4 隔离资源时发现其中只有 Worker 脚本，缺少两份清单。本轮在新隔离目录补齐，旧资源未修改。标准 Main 暂存区快照第一次缺少 Web Relay 依赖，随后使用现有安装的 `ws` 包，并按快照自身的行尾字节准备 Worker 脚本。旧 Organization 的第一次烟测仍匹配退役的控件名称，更新为检查现有控件后通过。构建仍提示主 chunk 超过 500 kB。没有把预期故障注入或未运行的真实 Provider 验收算作通过。

## 剩余技术债

- 无法核实来源、旧输入版本或完整 Revision/Receipt 的 Profile 继续走旧兼容路径。遗留软件版本回退、任意人工改证和破坏性清理不在本次验收内。
- v2 Recall 读取有候选上限，冷启动或暂时不可用时可以跳过 Note。累计上下文证据可能触发保守的连带擦除，或使超限提议无法批准。两者会影响覆盖率，不能用合成烟测推断长期可用性。
- 真实模型对事件时间、跨经历归纳、检索增益和长期质量的表现仍待单独验收。此轮仅使用合成资料、Mock 和已有固定原生组件，没有打开实际用户 Profile。

阶段记录：[P0](memory-note-only-p0.md) · [P1](memory-note-only-p1-formation.md) · [P2](memory-note-only-p2-lifecycle.md) · [P3](memory-note-only-p3-transition.md) · [P4](memory-note-only-p4-migration.md) · [P5](memory-note-only-p5-retirement.md)。
