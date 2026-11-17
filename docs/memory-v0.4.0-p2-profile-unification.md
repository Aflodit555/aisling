# Memory v0.4.0 P2：统一 Profile 与数据权威

> 公开脱敏候选：真实认识、记录标识、机器路径及私有校验值仅在私人归档保留。占位标识只用于本文说明，不可运行或跨页关联；本页仍记录原阶段的测试与限制，不代表本次重新验收。


本报告基于 2026-11-17 的重新审计。P0/P1 和历史回填报告只用于确认边界，数量、路径、会话和数据库均重新检查。当前版本仍为 v0.3.9。本轮不改变 Formation 语义合同、重试授权、Recall/Organization 算法，不进行 Reflection 语义迁移或历史回填。

## 1. 实施前基线与选择

分支 `feat/obsidian-memory-mirror`，起点 `4b0b8f9fd29689a18fc3ff60734752f93f4e9529`（P1），开始时已暂存、未暂存和未追踪代码均为空。未重写历史，保留 P0/P1 所有提交及历史备份。

| 来源 | 实际路径 | 文件 / 字节 | Session / 消息 | Memory |
| --- | --- | --- | --- | --- |
| 当前 v2 | `<REPO>\.local\desktop-dev-profile` | 639 / 40,399,729 | 39 / 356 | authority=`note-v2`，Formation=false，Recall=true，Mirror=true |
| 旧正式 | `%APPDATA%\@aisling\stage-desktop` | 5,991 / 183,399,489 | 34 / 306 | 无 v2 authority，40 条 Reflection，Formation=true |

旧 34 个 Session 的完整 JSON 对象逐个包含于当前 v2，不存在独立新增或分叉。重新对比 P1 的 6,630 文件冻结清单，文件集合与 SHA 全部相同，无新增、丢失或变化。采用当前 v2 的完整数据和配置，不按时间戳选配置。

通过同一个桌面 package 的 Electron 探针实测：app name=`@aisling/stage-desktop`，原 userData 为上表旧正式路径。默认新目录取 Electron 原 userData 加 `-note-v2`：

`%APPDATA%\@aisling\stage-desktop-note-v2`

代码不包含用户名或本机路径。该目录实施前不存在，与旧正式目录同级；暂存目录也放在该卷上，发布使用同卷 rename，不覆盖旧目录。

## 2. 原始入口与最终入口

原始命令：`pnpm start` → `pnpm dev:desktop` → `node scripts/dev-desktop.mjs`；`pnpm start:desktop` → 同脚本 `--prod`。原 Main 只在 dev 时自动切至项目 `.local/desktop-dev-profile`，prod 则使用 Electron 默认目录，因此存在分裂。

这些脚本保持原有技术行为：dev 启动固定 localhost:5174 Vite/HMR，prod 构建并使用 `aisling://stage`。Main 现在先选择统一目录，再申请单实例锁、等待 ready、构造服务和打开数据库；两种模式使用同一套 userData/sessionData。

`AISLING_DEV_PROFILE` 继续作为显式实验入口，要求已有、绝对、规范目录，dev/prod 均支持。它不会因为 dev 模式而自动启用。两个旧来源目录在完成切换后有 retired 标记，当前 Main 拒绝将其作为实验目录打开；实验须使用独立副本。

正常入口必须有已提交的 P2 凭据、既有原始会话/配置/任务、正确原 authority 和非空数据库。缺目录、未提交事务、损坏 JSON、缺库、缺表、错误 Note Schema 均不能回落到新空库或旧 Reflection。统一 Profile 启动等待数据库恢复成功后才展示窗口。并发实例在打开 Worker 前被锁拒绝。没有新增长期服务或双 Profile 同步。

## 3. 最小代码职责

| 文件 | 职责 |
| --- | --- |
| `apps/stage-desktop/desktop-profile.cjs` | 默认路径选择、显式隔离、退休/迁移凭据与基本完整性校验 |
| `main.cjs`、`desktop-app.cjs` | 选择/锁/恢复顺序、统一 Profile 的明确失败、绑定归档 |
| `memory-database/protocol.cjs`、`worker.cjs`、`adapter.cjs` | 凭据文件名、打开既有库的检查、缺表失败；不修改 wire version 或 Note Schema |
| `memory-archive.cjs` | 用既有 legacyArchive/lifecycle 对完整旧归档执行来源删除 |
| `memory-migration.cjs` | 仅导出现有 durable 写入函数，原语义迁移流程保持 |
| `note-formation.cjs` | 原归档必需条件增加“已验证 P2 归档”，P1 任务流程保持 |
| `desktop-diagnostics.test.cjs` | 为现有 VM 夹具补齐文件存在检查 stub |
| `scripts/unify-memory-profile.cjs`、`.ps1` | 一次性离线全量复制、清单、差异审计、隔离核验、可恢复发布及旧来源封存 |
| `desktop-profile.test.cjs`、`desktop-profile-smoke.cjs` | 合成故障与真实 Main/Vite/构建/并发锁验证 |
| `.gitignore` | 继续忽略数据、备份、任务和新增 Profile 凭据/退休标记 |

## 4. 离线备份与事务边界

新备份根：`<REPO>\artifacts\memory-v0.4.0-p2\20261117-p2`。准确创建时间、事务 UUID、阶段、源路径和文件模式在 `transfer.json`。该目录以及 `.tmp/p2-profile` 均被 Git 忽略；旧 P0/历史回填备份未覆盖。

`backup/v2` 和 `backup/legacy` 是两个来源完整独立副本，总计 6,630 文件、223,799,218 字节。`v2-manifest.json`、`legacy-manifest.json` 为每文件相对路径、字节、原模式和 SHA-256。清单内容组合摘要：

`<PRIVATE_SHA256>`

备份范围含完整 store/配置、原会话、Note 主库和 WAL、Formation/Organization 任务、authority、删除日志、归档/迁移状态和旧 Reflection 全部原始记录，以及原 Profile 其他文件。没有将 Markdown 当作数据库导入。

每次真实操作都通过 PowerShell 包装器查询 CIM；发现 Electron/Aisling/项目 Node 进程或查询失败即阻断，不结束任何用户进程。对现有关键文件取得允许共享读但禁止写/删除的句柄，要求 CLI 输入与计划中被锁定的路径完全一致，再执行复制、清单核对和源前后核对。数据库的 WAL 恢复/读取仅发生于完整数据集合的隔离副本。没有打开真实源库写连接，没有热拷贝单个主库。

事务顺序：离线备份 → 隔离验证 → 完整复制 v2 到目标卷 staging → 将完整旧 Profile 复制到 `legacy-profile-archive` → prepared 凭据 → rename 发布 → 为两个旧根写 retired 标记并给关键 Memory 文件加只读属性 → 再核对来源内容 → 最后提交目标凭据。prepared 目标不允许普通启动。中断不删除文件，校验相符后续做，遇到未知/不同文件即停止。重复已提交操作不覆盖正在使用的目标数据。

封存改变旧源关键文件的只读属性和新增一个退休标记，原文件内容不改变；原模式记录于备份清单，可恢复。这用于防止旧版本继续写旧 Memory，并非权限安全边界。不要手动解除封存后同时运行旧版。

## 5. 数据、配置与 Reflection

隔离副本实际全表读取得到：Note=19、NoteRevision=19、NoteOperation=36、Evidence=26、HAS_EVIDENCE=19、HAS_CONTEXT=268、NOTE_LINK=17、NOTE_EMBEDDING=14、MemoryErasure=5、MemoryTombstone=5。所有表记录和结构摘要保存在 `database-verified.json`；验证额外检查 Note 的来源/上下文与当前 Raw 消息相符。原 WAL 随完整集合保留。

真实 Formation 作业为 14 completed、7 failed，原记录无 P1 新历史字段和已消费自动重试预算；没有为旧失败虚构历史。完整任务文件逐字节复制，包括 progress、Organization、prepared/operationId/Receipt 关联及已有可选字段。合成夹具另验证 P1 history、autoRetries=1 在迁移后不重置。

所有配置均采用当前 v2 的原始 store；Formation=false 不被旧正式的 true 覆盖。Mirror 保持 enabled=true 和原 Vault `<OBSIDIAN_VAULT>`。旧配置仅记录冲突字段：`desktopAwareness.cooldownSeconds`、`desktopAwareness.jevApiKey`、`desktopAwareness.situationEnabled`、`speech.apiKey`、`speech.endpoint`、`memory.formationEnabled`、`memory.obsidianMirror`、`memory.noteRecallEnabled`。不在报告/测试日志输出真实凭据值，不将旧凭据覆盖到新配置。

40 条旧 Reflection 的 ID、来源、批次、进度及原始内容均保留在目标 `legacy-profile-archive/aisling-reflections.v1.json`；另外旧正式原目录和新完整备份也保留。原文件 SHA-256：`<PRIVATE_SHA256>`。它们没有进入 v2 Recall，没有重处理。运行归档接入已有来源删除闭包，合成测试证明删源会清除运行归档中的对应 Raw 和 Reflection。离线历史备份/封存原件仍有备份保留与日后删除处置责任，不是永远不可删的豁免副本。

P2 凭据只证明完整 Profile 交接，不伪造 `memory-migration.v1.json` 或声称旧 Reflection 已完成语义迁移。当前源若已有另一轮语义迁移归档则本工具阻断要求复审，避免遗漏原归档责任。

## 6. 验证与恢复

本轮真实历史没有付费 LLM 请求；Electron 验证在隔离完整副本/合成 Profile，阻断外网，Mirror 指向专用隔离 Vault。未打开实际 Vault 进行功能测试。

| 本轮执行 | 结果 |
| --- | --- |
| Core / Web 全量 | 112 / 430 通过 |
| Desktop + backfill 回归，分开固定 Vite 端口测试 | 首批 132 项中 131 通过；诊断 VM 夹具缺少新增 `fs.existsSync` stub，补齐后该文件 10 项全通过；其余 131 项未因夹具修正重复运行 |
| 既有 memory-migration 原生/Electron/Vite | 9 项通过，与 P2 4 项合计一次 13/13 通过，无跳过 |
| 最终 P2 专项 | 4/4 通过，无跳过；含四个发布中断点、幂等、冲突、缺/坏库、P1 历史与预算、归档删除、真实 Main/Vite/重启/跨模式单实例及旧版 rename 写入被阻断 |
| 完整冻结数据演练 | 发布后模拟中断并续做成功；built → Vite + 跨模式第二实例 → built 成功；启动后十表摘要与冻结数据全部相同；原模式恢复及完整备份恢复后原生读取成功 |
| PowerShell 真文件锁演练 | 持有禁止写/删除的共享读句柄时，在合成隔离数据上完成备份、发布和只读封存 |
| pnpm typecheck | 最终修改后通过，三个工作包均通过 |
| pnpm build | 通过；既有主块 804.59 kB 警告保留 |
| git diff --check / 敏感扫描 | 通过；候选文件排除数据与备份，并逐值比对真实配置中的凭据值及常见密钥格式 |

共覆盖 145 个独立 Desktop/backfill/P2 测试案例；重复验证不重复计数。诊断夹具错误已修正，无未处理失败。以上均为本轮运行；P0/P1 历史结果不计入本轮。没有做真实 Provider 付费调用、真实 Vault 写入或 P3/P4 语义验证。

本次备份创建于 `2026-11-17T07:31:26.857Z`（北京时间 15:31:26），事务 `PRIVATE-ID-01`。两份清单文件本身 SHA-256：

- v2：`<PRIVATE_SHA256>`
- legacy：`<PRIVATE_SHA256>`

私有验证日志在 `.tmp/p2-profile/`，完整数据演练在备份根的 `rehearsal/`，结构/记录摘要、演练凭据和迁移阶段在备份根 JSON 中。它们独立于代码 Git 检查点。

正式切换于 `2026-11-17T08:20:28.906Z`（北京时间 16:20:28）提交；16:21:22 完成切换后离线核验：目标 6,631 文件、223,799,474 字节，等于完整 v2 来源 + 完整旧 Profile 归档 + 256 字节交接凭据。目标每文件 SHA 与冻结来源一致，原件内容 SHA 不变、关键文件只读，两个备份清单重新核对通过。从正式目标复制一致的 Memory 数据集合到隔离副本后恢复 WAL、读取十表，结构与所有记录摘要仍与冻结数据完全相同。结果为备份根 `published-verified.json`。

随后在真实 Electron package、真实默认路径上、ready 之前只读运行选择器：返回 normal=true，选择正式新目录，凭据 committed、事务 UUID 相符，即时退出；未启动正式 Worker 或 Mirror。进程、用户和机器级 `AISLING_DEV_PROFILE` 均未设置。没有以真实用户 Profile 运行功能测试或改动实际 Vault。

本报告随独立 P2 本地代码检查点提交，范围为上述 16 个代码/测试/忽略规则/报告文件；可用 `git log -1 --format=%H -- docs/memory-v0.4.0-p2-profile-unification.md` 取得该提交完整 SHA。Git 仅恢复代码；数据检查点是上面的独立备份，二者不能互相替代。没有版本修改、推送、Release、合并或旧分支清理。本轮没有遗留需要保留的未完成代码或无关用户改动；私有备份、演练和日志保持忽略。

恢复步骤：

1. 正常退出所有 Aisling/Electron/Worker，并用 CIM 确认。先对当前统一目录再做一份完整离线备份，不能只靠 Git 回退数据。
2. 若新版已产生新会话/Note，不可把冻结备份覆盖回去。保留当前目录及其全部配套文件，另选独立恢复目录，重新审计差异。
3. 从同一检查点 `backup/v2` 全量恢复至新的绝对目录，按清单校验全部文件 SHA，保留 WAL/任务/authority/删除日志完整集合；只在第二个验证副本恢复 WAL 并读库。
4. 恢复 P2 日常目录时也需恢复相同检查点的完整 legacy 归档和已提交 P2 凭据。发布前重复离线、来源、备份和隔离启动校验，不能手写 authority 或混合不同时间文件。
5. 如必须回退 P1 代码，先归档并隔离 P2 当前目录，再在旧代码可识别的**独立**恢复副本上显式设置 `AISLING_DEV_PROFILE`。原旧目录只读属性/退休标记的原模式与事务 ID 在清单中；取消封存必须离线核验并保留标记副本。不得同时运行两个恢复分支。
6. 不删除旧 Reflection、历史备份、P0/回填恢复资料或隐私删除责任。

## 7. 后续边界

日常目标架构仍为 Context + Raw Recall + Note v2 Recall。旧 Reflection Formation/Recall、类型、兼容入口和业务实现尚保留；P4 必须逐条复审 40 条旧认识，确认必要回填或等价覆盖后，才彻底退役旧业务并迁移调用/测试。不能按文件名含 reflection/note-v1 直接删除来源校验、归档、隐私删除和事务能力。

Formation 语义质量、上下文检索与事件演化另行研究：频繁出现 profile-user 不独立证明语义缺陷，跨事件认识也不预设已存在两条 Note。下一阶段应检查 Raw 历史、BM25/Embedding、LLM、Organization 与来源校验的实际合作。

## 8. 交付结论与风险

| 问题 | 结论 |
| --- | --- |
| 三种普通启动是否统一？ | 是；相同 Main 选择同一新目录，保留 Vite/HMR 与构建 Renderer 差别 |
| 原始会话、Note、关系、作业与配置是否保留？ | 是，完整文件及原生全表摘要验证通过，Formation=false 保持 |
| 旧 Reflection 是否安全封存？ | 是，40 条及其 ID/来源/批次完整保留，未导入新 Recall，运行归档承担来源删除 |
| 是否还会因 dev/prod 独立分叉？ | 普通入口不会；两个旧源封存。手动解除只读、使用旧代码或显式不同实验目录仍可人为创建分叉，不能同时当作正式环境 |
| 能否日常使用 Note v2？ | 是，已完成真实数据切换与独立恢复验证；付费模型和实际 Vault 写入未实测 |
| 能否进行后续语义优化与 Reflection 退役？ | 已具备统一技术基线；P4 逐条语义复审和必要覆盖确认仍须另做，未提前宣称退役 |

剩余事项：既有 804.59 kB 构建警告、真实 Provider/实际 Vault 的日常观察，以及 P3/P4 研究和历史处置。新默认目录须经一次性完整交接准备，不会为缺失/损坏状态自动创建空库。换机器/修改 Electron app name/打包产品身份后，应重新核实默认路径再做离线交接，不能直接指向旧 Reflection Profile。备份内有用户私有数据与配置，应保持本地受保护并遵守今后的删除处置。当前无阻断 P2 的未完成项。
