# Memory Database P0 正式接入

2026-11-03。P0 将 LadybugDB 0.22.1 接到正式 Desktop 宿主，使用独立 Windows x64 Node 24.12.0。P0 默认关闭，只能以显式配置和专用 profile 启用。现有聊天、ConversationStore、原始 Recall、Reflection Formation、Reflection Recall、Core 预算和 Provider 继续使用原有路径。系统背景见 [Memory 工程审计](memory-database-audit.md)。

## 已实现的运行链路

`startDesktop` 在 `app.whenReady()` 前验证专用 profile 并设置 `userData` 与 `sessionData`。此后异步解析资源和开库，不等待 Worker Ready 就继续原来的 Tray、Stage 和窗口启动。有效 profile 下，资源缺失、锁冲突或 Worker 启动失败会使 Store 进入失败状态，现有功能仍可使用。未提供安全 profile 或指定现有正式 profile 时，显式启用请求直接失败，避免继续进入真实用户数据路径。

Main 使用 `child_process.spawn`、绝对 `node.exe`、明确工作目录与最小 Windows 环境。Worker 独占 LadybugDB 连接与数据文件，完成 Schema 初始化后返回协议 v1 Ready。Main 与 Worker 通过 stdin/stdout 传输 UTF-8 JSON Lines，stderr 单独输出诊断。每连接单调 requestId 关联响应，拒绝重复、乱序、非法格式及非白名单操作。单帧 64 KiB，最多 32 个未完成普通请求，关闭有独立控制槽。Worker 串行执行。Main 只公开内部异步领域 Store，Renderer 无数据库 IPC。

既有 `before-quit` 路径在 P0 开启时先等待 Worker 关闭，再继续应用原有退出逻辑。启动等待上限 15 秒，普通请求默认 5 秒。关闭请求等待 3 秒，之后有界等待进程退出，超限强制终止。关闭发生在资源解析期间时，拒绝后续启动并允许应用退出。正常关闭和进程退出都回收请求。Worker 丢失或请求超时时，未收到回复的写入以 `outcome-unknown` 结束。显式重新 `open()` 后按稳定 ID 查询，传输层不重放写入。第二个数据库写者由 LadybugDB 文件锁拒绝。

### 文件与职责

| 文件 | 职责 |
| --- | --- |
| `apps/stage-desktop/desktop-app.cjs` | 接入现有 `startDesktop` 与 `before-quit` |
| `apps/stage-desktop/memory-database/host.cjs` | 开关、隔离 profile、资源与 DB 路径、启动诊断和退出协调 |
| `apps/stage-desktop/memory-database/store.cjs`、`store.d.ts` | 异步 Store、状态、领域写入到内部操作映射 |
| `apps/stage-desktop/memory-database/client.cjs`、`protocol.cjs` | 进程启动、协议与输入校验、请求匹配、超时及丢失结果处理 |
| `apps/stage-desktop/memory-database/worker.cjs`、`adapter.cjs` | 单 Worker、LadybugDB Schema、参数化 Cypher、事务和资源释放 |
| `apps/stage-desktop/memory-database/package.json`、`package-lock.json` | Worker 独立的 0.22.1 依赖和锁文件，普通 Desktop 依赖无需安装它 |
| `scripts/prepare-memory-database.ps1` | 可复现地准备忽略版本控制的外部资源 |
| `apps/stage-desktop/memory-database/contract-fixture.cjs`、`memory-database-smoke.cjs`、`memory-database.test.cjs`、`scripts/test-memory-database.cjs` | 合成契约、真实 Main、隔离与进程故障测试 |
| `apps/stage-desktop/prod-smoke.cjs`、`package.json` | 现有 Memory smoke 可断言 P0 失败降级，类型检查覆盖 Worker |

### 最小 Store 契约

- `open()`、`close()`、`status()`。就绪前或停止后操作明确拒绝。并发 open 和 close 分别合并。
- `createNote({id,content,createdAt})` 与 `getNote(id)`。缺失返回 `null`，重复 ID 拒绝且保留旧条目。Note 为测试模型，ID 由调用者提供。
- `addOrigin/getOrigins` 保存外部 `reflectionId` 映射。`addEvidence/getEvidence` 保存 `sessionId/messageIndex/digest`。支持同一个来源映射到多条 Note。引用不自动扫描或导入旧存储。
- `linkNotes(from,to)` 与 `getRelatedNotes(id, depth)`。深度只允许 1 或 2，返回恰好该深度的去重出边目标 ID，顺序不属于契约。重复关联幂等，端点缺失拒绝。
- `transaction(writes)` 接收 1–32 个领域写入，作为单个 Worker 请求提交。任一操作失败回滚。任意 Cypher、调试等待和强制回滚指令均未进入正式协议。

相对实验，保留 JSON Lines、来源摘要、Cypher Schema、主键冲突自动回滚处理及未知提交语义。移除 ping、实验环境回退、运行中故障注入和显式回滚测试指令。测试里的故障包装器拦截真实 Worker 的回复，资源脚本只复制 Worker、协议和 Adapter。生产契约用唯一键与缺失关联端点两种错误验证回滚。

## 资源、数据隔离与复现

- 非打包环境默认 `.local/memory-database`，可由绝对 `AISLING_MEMORY_DB_P0_RESOURCES` 覆盖。
- 打包定位为 `process.resourcesPath/memory-database`。`runtime/node.exe`、Worker、npm 依赖及 `lbugjs.node` 应作为普通外部文件复制到该目录。该定位规则已实现，实际安装包仍待验证。
- `AISLING_MEMORY_DB_P0=1` 还要求绝对 `AISLING_MEMORY_DB_P0_PROFILE`，指向现有空目录或由本 P0 创建标记的目录。拒绝与既有 profile 重叠及无标记的非空目录。数据库为该隔离 `userData/memory-db-p0/memory.lbdb`。测试进程只打开自己的合成库。真实 Conversation、Reflection 与配置保持原位置，测试也核对独立的合成旧文件字节保持原样。

准备过程校验 Node 与 MSI 官方 SHA-256，只读提取 MSI 里的 RTF 许可与第三方声明。LadybugDB 从 npm 锁文件安装官方 Windows x64 预编译子包，将核验后的 addon 复制到主包的加载位置，跳过安装脚本和源码构建。资源与日志分别位于忽略的 `.local/`、`artifacts/`。应用运行时不调用 npm，也不查找系统 PATH 或实验项目的 Node。 [Node 官方校验清单](https://nodejs.org/download/release/v24.12.0/SHASUMS256.txt) · [Node 许可](https://github.com/nodejs/node/blob/v24.12.0/LICENSE) · [LadybugDB Node API](https://docs.ladybugdb.com/client-apis/nodejs/) · [Electron ASAR](https://www.electronjs.org/docs/latest/tutorial/asar-archives)

| 资源 | 版本或 SHA-256 |
| --- | --- |
| 官方 Node Windows x64 `node.exe` | 24.12.0，`2ffe3acc0458fdde999f50d11809bbe7c9b7ef204dcf17094e325d26ace101d8` |
| 官方 Node MSI | 24.12.0，`e3a50a907b6c71d9f3cb7571980cf3070ec0fadc6fb2a55516d5ff95083990f3` |
| 官方 LadybugDB Windows x64 `lbugjs.node` | 0.22.1，`2bd7b8487b1bdb20aa334718682724567bdfed5e2dd17592d4ac349c3d1b5e1c` |
| 从 MSI 提取的 Node 许可 RTF | `6c99d1d070fb24a7024dfc489f8a3877c4ec5270d8f4af0af0992d900f502c60` |

从仓库根目录运行以下命令。资源生成要求输出目录为新目录。`-Cache` 和 `-Offline` 可用于已具备锁定包缓存的离线准备。本次准备复用了本地 npm 缓存，Worker 运行不依赖该缓存。

```powershell
./scripts/prepare-memory-database.ps1 -Node '<official-node.exe>' -NodeMsi '<official-node-v24.12.0-x64.msi>'
pnpm build
node scripts/test-memory-database.cjs
$env:AISLING_MEMORY_DB_P0_TEST_RESOURCES = (Resolve-Path .local/memory-database).Path
node --test (Get-ChildItem apps/stage-desktop/*.test.cjs).FullName
pnpm test
pnpm typecheck
```

开发者手工启动时先创建新的空目录，再设置 `AISLING_MEMORY_DB_P0=1` 与其绝对 `AISLING_MEMORY_DB_P0_PROFILE`，运行 `pnpm start:desktop` 或 `pnpm dev:desktop`。这些环境变量只对当前命令会话有效。真实 Electron 和本机回环测试需要宿主允许进程运行和回环访问。测试使用合成资料及 mock Provider。

## 已测试

Windows x64，真实 Electron 44.4.3，内置 Node 24.21.0。Worker 为独立 Node 24.12.0、LadybugDB 0.22.1（存储格式 49）。

- P0 关闭且 Worker 资源不存在时，正式 Stage 挂载并保留旧桥。启用后，真实 Main 通过领域 Store 验证 Note、Origin、EvidenceRef、正向精确一跳／两跳、两条路径去重、唯一约束、缺失端点、事务回滚与重开。写入 Main/Worker PID 为 39524/61816，重开为 59288/61968，使用同一个隔离数据库。
- 真实 Main 内 Worker 被强制结束后，Store 进入失败状态。显式 open 创建新 PID 并读回数据。强制结束独立 Electron Main 时，空闲 Worker PID 26740 随后消失，下一次 Main 能重开同一库。正常退出的 Worker 代码为 0，测试确认 PID 已退出。
- 故障测试覆盖启动失败／超时、竞争锁、非法帧、重复 ID、任意 Cypher 拒绝、写入提交后丢回复、读超时和关闭时卡住。故障后按 ID 核验已提交记录，排队未执行的写入不存在。
- 缺失 Worker 资源使 Store 返回 `ENOENT`，同一正式 Electron 中，既有聊天、原始 Recall 和 Reflection Formation／Recall 生产 smoke 都通过，并走正常应用退出。P0 关闭时的 TTS 和 Context smoke 也通过。
- Core **109/109**，Web **376/376**，Desktop **38/38**，全仓类型检查和生产构建通过。受限沙箱中的 Core 回环 HTTP 曾有 4 项 `fetch failed`，允许本机回环后同一测试全部通过。构建仍有既有大 chunk 提示。
- 全量默认生产 smoke 在桌面模式的 `composerShown` 断言失败。用隔离的接入前 Desktop 源码快照保留原有未提交的诊断逻辑，并复用同一份已构建 Stage，复现了同一断言失败。该项记录为既有回归基线问题。

原始日志在 `artifacts/memory-db-p0/`。关键文件为 `prepare.log`、`electron.log`、`test-core-web.log`、`test-desktop.log`、`typecheck.log`、`build.log`、`prod-normal.log`、`prod-normal-baseline.log`、`prod-speech.log` 和 `prod-context.log`。

### 性能观察

本机同一小型合成图。三次真实 Main 分别执行 12 组串行查询，共 36 个样本／操作。毫秒计。RTT 含管道调度、响应和查询。Worker 时间含 Adapter 操作。剩余开销按每次 RTT 减 Worker 时间后取中位数，包含管道和两端调度，作为 IPC 成本估算。

| 操作 | RTT 中位数 | P95 | 最大值 | Worker 中位数 | 剩余开销中位数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Note ID | 2.771 | 4.411 | 4.944 | 1.926 | 0.847 |
| 一跳 | 7.292 | 9.122 | 15.322 | 6.388 | 0.848 |
| 两跳 | 10.547 | 12.699 | 36.076 | 9.436 | 0.937 |

5 次 spawn 至 Ready 为 215–268 ms，含本机资源加载、开库和 Schema 初始化。正常退出的有界关闭为 115–142 ms。两跳与实验阶段相同数量级，样本规模和环境不足以做精确差值或长期性能推断。P0 查询路径没有接入在线聊天或 Recall。

## 尚未测试与暂未实现

尚未测试正式签名安装包、干净 Windows 机的 VC 运行库依赖、升级和打包资源更新、主进程被杀时 Worker 正执行长查询、系统关机及断电恢复。此次父进程强制终止覆盖的是空闲 Worker。Worker 关闭时卡住的覆盖来自独立故障测试。发布需要核对外部资源复制、签名、运行时更新和系统级进程回收。

现有 JSON 继续承担真实 Memory。暂未实现 Renderer 数据库桥、自动重试或迁移、Note 正式 Schema、Revision 和 Evolution。

后续 Note 设计需要先明确业务 ID 的归属，生成来源与证据的区分、来源删除／改动后的可用性、多对多来源语义、关系方向与深度、哪些写入需原子提交，以及同一聊天轮次如何维持快照。数据库 P0 已能验证这些约束，Formation 与 Note 仍是分开的概念。

本轮满足 P0 接入验收。正式发布验证和基线 UI smoke 问题单独保留。
