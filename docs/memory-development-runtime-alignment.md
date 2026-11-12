# Memory 开发环境与运行时一致性

## 基线与问题

本轮从本地 main 的工程提交 dbd88f3af3a0de2683fbe5f5300f4bd3261d77eb 和报告提交 3204a51c400ebff05ed3fa8a047ec172110a32ec 开始。启动前暂存区为空，已有一处旧烟测改动和 154 个未跟踪的研究文件及脚本。本轮保留这些工作，未提交或推送。

旧准备脚本只接受全新输出目录。Worker 的五个脚本从源码复制到 .local/memory-database 后独立存在，Stage 构建和源码变更都不会更新它们。检查发现五个脚本全部过期，两份依赖清单仍匹配。现有 Node 24.12.0 x64 以及 LadybugDB 0.22.1 的两份原生加载文件均通过固定 SHA-256 校验。许可证和第三方声明存在，实际加载也通过。

旧 Main 对 Note v2 和迁移的选择硬编码了 aisling://stage。Vite 即使使用同一个 Main 和 preload，也会落到兼容入口。开发启动器当时只检查端口是否返回 HTTP 200，且与构建版使用默认的 Electron Profile。

## 首次准备 Worker

Worker 固定使用 Windows x64 Node 24.12.0 和 LadybugDB 0.22.1，与 Electron 内置 Node 分开。首次准备需要官方 `node.exe` 及同版本 MSI，从仓库根目录运行：

~~~powershell
./scripts/prepare-memory-database.ps1 -Node '<official-node.exe>' -NodeMsi '<official-node-v24.12.0-x64.msi>'
~~~

首次输出目录必须不存在，默认 `.local/memory-database`；可用 `-OutputDirectory` 指定全新目录，`-Cache` / `-Offline` 复用已有锁定包缓存。脚本校验固定 SHA-256，从 MSI 提取许可及第三方声明，按 Worker 锁文件准备官方预编译 LadybugDB 依赖，不执行安装脚本或本地源码编译。应用运行时不调用 npm 或系统 PATH 中的 Node。版本与哈希以 [准备脚本](../scripts/prepare-memory-database.ps1) 为准。

源码默认资源路径是 `.local/memory-database`，打包定位为 `process.resourcesPath/memory-database`；安装包发布仍未验收。早期 P0 图实验不属于日常启动，需要复验时使用 `node scripts/test-memory-database.cjs` 创建专用合成夹具，不使用真实 Profile。

## Worker 刷新

关闭使用该资源的 Desktop 后，在仓库运行：

~~~powershell
./scripts/prepare-memory-database.ps1
~~~

默认刷新现有 .local/memory-database。可通过 -OutputDirectory 指定独立的现有资源目录。首次安装仍可用原来的 -Node 和 -NodeMsi，配合 -OutputDirectory 指向全新目录。清单发生变化时需从固定安装来源重新准备。

脚本校验清单、固定二进制和实际加载版本，复用原有依赖，在同一父目录中暂存完整资源，再校验一遍后切换。Main 的默认 Worker 启动和更新器共用互斥标记。更新器检查同一路径下的 Worker 进程，仍运行时拒绝切换。脚本先保留完整原目录，再发布完整新目录，切换间隙只可能暂时不可用。普通切换错误会尝试回退。如果进程在切换中被强制终止，先确认 Desktop、Worker 和更新器均已停止，再依据旁边的 .previous-* 目录恢复默认目录。仅在确认标记没有持有者后清理遗留的 .update.lock。

本机默认资源已实际更新，刷新结果为 refreshed，原目录保留为 .local/memory-database.previous-69dcaba939bb418cb3c84fc4a2f72c80。再次运行返回 current。五个脚本与两份清单均匹配源码。复用了已验证依赖，没有重新下载安装。更新涉及资源目录，Worker 读写验收使用了独立合成数据库。

## 统一启动与 Profile

- 构建版使用 aisling://stage 和 Electron 常规 Profile。项目开发命令启动固定 5174 端口的 Vite，再等待该子进程报告监听。开发模式默认把 userData 和 sessionData 都放在 .local/desktop-dev-profile。
- 要使用已有的隔离资料，可为这次开发启动设置 AISLING_DEV_PROFILE 为现有绝对目录。Main 在请求单实例锁前确定真实目录。同一个 Profile 在开发和构建两种模式下共用独占锁。
- Main 对两种模式应用相同权威规则。新资料和有效的已迁移资料走 Note v2。只有旧会话文件而没有权威标记的资料也按旧 Profile 处理。有效的未完成迁移保留冻结与恢复状态。损坏或不可信的权威及迁移文件沿用阻断规则。迁移继续需要可信 Main 和原生确认。
- 两种模式复用 Note Formation、审核、Recall、来源擦除、迁移和历史兼容服务。Stage 继续根据 preload 能力加载运行时。开发模式确认迁移后，Main 完成关闭并返回重启码，启动器重启 Electron 并复用现有 Vite。
- Vue 组件热更新保留同一个 Main 服务。整页重载会撤销旧 Stage 文档领取的 Formation 尝试，沿用现有取消处理，避免旧页面提交或留下阻塞后续任务的运行中批次。已持久化结果及已授权写入的恢复沿用既有机制。

## IPC 边界

受信目标为 aisling://stage，或者非打包模式固定端口的 http://localhost:5174 和 http://127.0.0.1:5174。Main 要求 IPC 来自当前 Stage WebContents 的顶层 frame，且请求时的 origin 与该次启动目标完全一致。同步 Storage 和 Reflection IPC 也使用该检查。preload 继续使用 sandbox 和 context isolation，Node integration 关闭。IPC 通过后仍须经过当前 Profile 的权威、迁移状态、证据与审批规则。

## 修改文件

| 范围 | 文件 |
| --- | --- |
| 启动与 Profile | scripts/dev-desktop.mjs、apps/stage-desktop/package.json、main.cjs、desktop-app.cjs、memory-authority.cjs |
| IPC 与 Worker 资源 | apps/stage-desktop/desktop-store.cjs、memory-database/client.cjs、scripts/prepare-memory-database.ps1 |
| 回归 | apps/stage-desktop/desktop-diagnostics.test.cjs、desktop-store.test.cjs、memory-database.test.cjs、memory-migration.test.cjs、memory-migration-smoke.cjs、note-formation-smoke.cjs、note-v2-lifecycle.test.cjs |
| 文档 | README.md、docs/desktop-host.md、docs/memory.md、本报告 |

## 验证

| 项目 | 结果 |
| --- | --- |
| Worker 资源 | 默认目录刷新和重复执行通过。隔离目录的损坏原生库、正在运行的资源进程、更新锁及篡改脚本均被拒绝。隔离刷新保留了旧版本，正常 v2 Worker 完成读写、关闭、重开与故障恢复。 |
| Vite 与 Electron | 实际 Vite 服务和 Electron 通过新建、已迁移、旧格式、仅有旧会话、迁移阻断五种状态。覆盖待审提议、原生确认路径、持久化、注入请求的 Recall、删源、Vue 组件热更新、整页重载撤销，以及错误 origin、WebContents 和 frame 拒绝。 |
| 启动器 | 独立 Vite 与隐藏 Electron 夹具验证等待本次 Vite 监听、按重启码复用 Vite、占用端口时拒绝启动 Electron。 |
| 构建版 Electron | 同一组 Profile 规则和 v2、v1 回归通过。两种模式交叉验证同一 Profile 的独占锁。专用 P0 冒烟通过。 |
| Core、Stage Web、Desktop | 112、402、86 项通过，Desktop 零跳过。 |
| 类型检查、构建、Git | 通过。生产构建仍提示主 chunk 超过 500 kB。 |

Vite 回归的初次运行暴露了隐藏窗口在客户端路由切换时的转场等待，以及测试原句被 Raw Recall 正常去重。最终验收直接加载 Memory 路由，并用有原始证据支持的改述测试 Note 注入。针对仅有旧会话文件的识别，生命周期夹具也更新了对未标记资料的预期。

## 日常命令与边界

~~~powershell
./scripts/prepare-memory-database.ps1
pnpm dev:desktop
pnpm start:desktop
~~~

开发和构建启动分别运行，测试已有资料前先准备隔离副本。构建命令使用 Electron 常规资料路径。真实模型、正式用户 Profile、首次 MSI 安装和打包发布未纳入这轮运行验收。Vite 的受信边界是本机项目开发服务器，日常开发通过启动器启动它。
