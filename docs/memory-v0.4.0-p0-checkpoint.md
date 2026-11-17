# Memory v0.4.0 P0：工程与数据检查点

> 公开脱敏候选：真实认识、记录标识、机器路径及私有校验值仅在私人归档保留。占位标识只用于本文说明，不可运行或跨页关联；本页仍记录原阶段的测试与限制，不代表本次重新验收。


2026-11-17，Asia/Shanghai。仓库：`<REPO>`。本轮只审计、备份、验证和创建本地提交；没有修改已有源码字节、版本、Profile 选择、Memory 算法或真实数据。旧报告中的测试、数量和分支描述均按历史记录保留，以下另列本轮实际证据。

## A. 实际 Git 基线

| 项目 | 本轮开始时实测 |
| --- | --- |
| 分支 | `feat/obsidian-memory-mirror`，本轮保持该分支 |
| HEAD | `93474d2b29c00a312948f7b745b7948c2d28fff9` |
| v0.3.9 对应提交 | `2d3c88c0bd8699d82be7bc2c3b107d61577b5499`，使用 `v0.3.9^{commit}` 解析 |
| HEAD 超出标签的历史 | `d783306` 发布验证文档；`93474d2` Live2D 路径拆分优化；均保留 |
| 版本 | 根、Core、Stage Web、Desktop 的 package.json 均为 `0.3.9`；未更改 |
| 工作区 | 40 个已修改文件、14 个未跟踪文件，共 54 个；暂存区为空 |
| 已跟踪差异 | 对 HEAD：40 文件，+434/-177；对 v0.3.9：42 文件，另含上述已提交差异 |

逐项读取了状态、未暂存/暂存差异、未跟踪清单、忽略目录、最近提交和标签差异。未发现既有暂存意图需要保留。初始 54 文件的原始字节 SHA-256 及 binary diff 保存在忽略目录 `.tmp/p0-original-workspace.json`、`.tmp/p0-original.patch`；结束时再次逐文件核对，确认没有覆盖用户工作。

## B. 初始改动分类与依赖

以下按文件主要职责唯一计数；共享文件的其他职责另注明，因此分类数量合计为 54，不能将共享片段重复计入。

| 类别 | 文件数 | 文件范围（目录前缀适用于同格内文件） |
| --- | ---: | --- |
| A. Mirror 后端与测试 | 15 | `apps/stage-desktop/` 下 `desktop-app.cjs`、`memory-database.test.cjs`、`note-formation.cjs`、`preload.cjs`、`obsidian-control.cjs`、`obsidian-control.test.cjs`、`obsidian-mirror.test.cjs`；其 `memory-database/` 下 `adapter.cjs`、`client.cjs`、`protocol.cjs`、`store.cjs`、`store.d.ts`、`worker.cjs`、`obsidian-mirror.cjs`；`scripts/prepare-memory-database.ps1` |
| B. Mirror 前端、设置与本地化 | 9 | `apps/stage-web/src/` 下 `components/Icon.vue`、`components/settings/ObsidianMirror.vue`、`config/local-storage-config-store.ts`、`env.d.ts`、`i18n.ts`、`pages/settings/memory.vue`、`stores/settings.ts`、`stores/settings-obsidian.test.ts`；`packages/core/src/config.ts` |
| C. 历史回填工具与测试 | 2 | `scripts/memory-history-backfill.cjs`、`scripts/memory-history-backfill.test.cjs` |
| D. Note v2 / Formation / Organization / Recall 独立算法改动 | 0 | 当前能力已在 HEAD；A 中 Formation 文件的新增片段只是 Mirror 配置和 Worker 重建恢复，不是 Formation 改造 |
| E. 其他设置 UI、启停与工程工作 | 23 | `apps/stage-desktop/desktop-diagnostics.test.cjs`、`assets/desktop-mode.ico`；`apps/stage-web/src/components/AppHeader.vue`；`components/settings/` 下 `ConsciousnessForm.vue`、`DesktopAwarenessForm.vue`、`EmbeddingForm.vue`、`LegacyMemoryControls.vue`、`ModuleToggle.vue`、`SettingsSelect.vue`、`SpeechForm.vue`、`VisionForm.vue`、`WebSearchForm.vue`；`i18n.test.ts`；`pages/settings/` 下 `desktop-awareness.vue`、`general.vue`、`speech.vue`、`vision.vue`、`web-search.vue`；`runtime/provider-factory.ts`；`stores/` 下 `settings-activation.test.ts`、`stage-autonomous.test.ts`、`stage.ts`；`styles/main.css` |
| F. 文档 | 5 | `docs/README.md`、`settings-ui-validation-2026-11-13.md`、`obsidian-memory-mirror.md`、`memory-history-backfill-audit.md`、`memory-v0.4.0-preflight-audit.md` |
| G. 忽略并保留 | 不纳入 54 | `.local/`、`.tmp/`、`.agent-work/`、`artifacts/`、`reports/`、依赖、构建及缓存目录；含 Profile、历史备份、模型响应、映射、实验脚本及截图。没有清理 |

依赖结论：Mirror 从 Main 读持久配置，经既有 Formation 服务、Store、协议进入原 Worker；快照查询与原数据库请求共用串行队列，导出单向 Markdown。准备脚本和 client 的资源清单必须同时包含镜像模块，不能只提交前端或 Worker。回填工具复用已存在的合同/服务和新增快照读取，应用 Runtime 不导入它。

`desktop-app.cjs` 同时有 Windows 图标与 Mirror；`settings.ts`、`i18n.ts`、`memory.vue` 同时有设置修缮与 Mirror。仅对这些共享文件构造暂存区片段，未改写工作区文件。其他 UI、模块启停、Desktop Awareness 和图标工作独立提交，不混入 Memory 功能提交。没有新增依赖或公共出口。

安全审阅覆盖全部 54 文件的 diff/新文件、模块调用点、资源清单和 ICO 文件头；对照两个真实配置中的凭据值进行无回显扫描，并扫描常见凭据/私钥签名和长原始消息。均未发现命中；测试凭据为合成值。`git ls-files` 未发现真实 Profile、数据库、作业、备份或环境凭据被跟踪。旧审计文档中的记录 ID/工程摘要仍是历史索引，不把它们当作完整用户数据备份。

## C. 本地代码检查点

完成验证后按以下依赖建立本地提交。不 push、Release、merge、改版本、改标签、删除分支或重写历史。没有使用批量全仓暂存、破坏性 reset 或 clean。

| 提交 SHA | 文件数与范围 |
| --- | --- |
| `eb5a8a14e6ead5a469ba0ed65fd2deb0507699f3` | 29 文件：E 的 23 文件、Settings 报告与 docs 索引，以及 4 个共享文件中的设置/图标片段。保留模块配置验证、保存失败回滚、Provider 身份、统一 UI 与 Windows 图标工作 |
| `657d56872d50bc3646220ae4d0354dfdd6ff90c2` | 25 文件：A 的 15 文件、B 的 9 文件和 Mirror 工程文档；含前端配置/类型、本地化、IPC、服务恢复、Worker 串行、快照/导出、资源清单及测试 |
| `c324cfc6870183fe6847afd7e29f29b26bbe232c` | 3 文件：回填脚本、合成单元测试与历史回填审计；不执行真实回填 |
| 本报告对应的文档提交（见下方查询） | 2 文件：历史 `memory-v0.4.0-preflight-audit.md` 和本 P0 报告；历史快照不改写 |

本报告由随后独立文档提交纳入；报告提交本身的 SHA 以 `git log -1 --format=%H -- docs/memory-v0.4.0-p0-checkpoint.md` 查询，避免在文件内写入自身哈希。逐提交文件清单可用 `git show --format=fuller --name-status <SHA>` 查阅。

## D. 未提交与保留内容

上述代码提交后仅余两份审计文档；报告提交完成后，已跟踪及未忽略的未跟踪工作区均为空、暂存区为空。初始 54 文件全部进入检查点，没有删除或为凑提交修改任何文件，也没有留下一组被测试失败掩盖的代码。被忽略的用户数据、旧实验、备份、临时工具及本轮验证产物继续保留，它们不会因 Git 干净而自动受到版本控制。

忽略规则未修改：`.local/`、`.tmp/`、`artifacts/`、`reports/` 和 `.env*` 继续覆盖私有目录；另有数据库/WAL、会话 JSON、Reflection JSON、authority、作业和删除/迁移状态文件名规则。本轮实际 `git check-ignore -v` 验证了两个仓库内关键数据路径及备份目标，真实旧 Profile 位于仓库之外。没有因文件未跟踪、位于 `.tmp` 或 `artifacts` 就删除内容。

## E. 本轮实际验证

| 本轮命令/检查 | 结果 |
| --- | --- |
| `git diff --check`、各批次 `git diff --cached --check` | 通过 |
| `pnpm typecheck` | Core、Stage Web、Desktop 全部通过 |
| `pnpm build` | 通过；主 chunk 799.90 kB，仍提示大于 500 kB；旧兼容 chunk 50.33 kB |
| `pnpm -r --workspace-concurrency=1 run test --maxWorkers=1` | Core：19 文件、112/112；Stage Web：45 文件、421/421。串行调度，含本机 HTTP Mock，无真实 LLM 请求 |
| 设置 `AISLING_MEMORY_DB_P0_TEST_RESOURCES` 为 `.local/memory-database`，执行 `node --test --test-concurrency=1 'apps/stage-desktop/*.test.cjs' scripts/memory-history-backfill.test.cjs` | 19 份 Desktop 测试及回填测试，共 128/128，0 失败、0 取消、0 跳过；耗时约 301 秒。含 Mirror 7 项、数据库/事务/生命周期/迁移/删除、Formation/Organization、HNSW 持久化、隐藏 Electron 和实际 Stage Mock 链路 |
| 独立备份校验和隔离数据库读取/重开 | 通过；详见 F/G |
| 原有工作保留与敏感扫描 | 54 文件原始字节 SHA-256 均未变；真实配置凭据、常见凭据签名、长原始消息命中均为 0 |

本轮没有发现新的测试失败，没有修改测试、删除断言、关闭保护或调整算法来获得通过。已确认的 Formation 可靠性缺口列入 I/J，并不因现有回归通过而消失。

验证日志存于忽略目录 `.tmp/p0-{typecheck,build,web-core-tests,desktop-tests}.log`。原 54 文件 CJS/MJS 的 `node --check`、资源准备 PowerShell 语法检查、ICO 头检查通过。默认 `.local/memory-database` 中 6 份 Worker 脚本和两份依赖清单均与当前源码字节相同，没有执行刷新或安装。

历史报告里的真实模型调用、UI 截图、Mirror 实际 Vault 跳转、旧回填和旧恢复演练不计作本轮重新执行。未重新运行付费 Provider、真实用户聊天、UI 像素测量、专用 P0 进程冒烟脚本、首次 MSI 安装、安装包/发布或长周期负载测试。本轮数据库读取仅针对隔离副本，测试写入仅针对合成 Profile。

## F. Profile 与 Memory 的实际状态

| 项目 | 开发 Profile | 旧默认 Desktop Profile |
| --- | --- | --- |
| 路径 | `<REPO>\.local\desktop-dev-profile` | `%APPDATA%\@aisling\stage-desktop` |
| 原始会话 | 39 Session / 356 消息 | 34 Session / 306 消息 |
| 权威 | `memory-authority` 为 `note-v2` | 无 v2 authority；旧兼容路径 |
| 存储 | `aisling-store.json`，包含会话、配置、语言、主题与展示设置 | 同名 JSON 及 `aisling-reflections.v1.json` |
| 数据库 | `memory-note-v2/note-v2.lbdb`，5,627,904 字节；WAL 114 字节 | 未发现生产 Note 库 |
| 图数据（隔离副本实测） | 19 active Note、17 active 关系、19 Revision、36 operation receipt、26 Evidence、14 embedding | 40 条 Reflection，JSON v1；38 条来源完整有效、2 条来源缺失 |
| 作业 | JSON v1；21 批：14 completed、7 failed；item 为 19 applied、17 rejected；19 个组织任务 completed | 未发现 v2 作业文件 |
| 当前配置 | Memory=true、Formation=false、Note Recall=true、Mirror=true | Memory=true、Formation=true；仍保留旧配置行为 |

开发库为 `note-v2-runtime`，LadybugDB `0.22.1`、storage version `49`、独立 Node `24.12.0`，Worker 协议 v1。当前 Note、关系和原回填 `after.json` 完全一致；全部当前 Note 的直接来源/Context，以及关系端点/来源校验通过。旧 34 个 Session 的完整对象在开发 Profile 中均原样存在，这只是 Raw 数据覆盖，不是 40 Reflection 语义覆盖确认。

当前真实目录还含 `memory-erasure.v1.json`（399 字节）；开发目录没有旧 Reflection JSON，也没有现存迁移状态/归档文件。备份采用完整 Profile 文件集合，因此不会漏掉出现的 authority、作业、删除状态、迁移处置、档案、配置或 Chromium 配套文件；缺失项由完整清单体现。未创建任何迁移标记或改写作业进度。

`pnpm start` → `dev:desktop` → Vite + Electron，Main 在 dev 模式选择开发 Profile；`pnpm start:desktop` 先 build，再用常规 Electron userData，本机对应旧 Profile。`AISLING_DEV_PROFILE` 可显式选择隔离目录。Main 在单实例锁前确定 Profile，以 authority/迁移状态选择 v2 或旧兼容；本轮不统一这两个入口、不迁移配置。

## G. 独立用户数据检查点与恢复

备份根目录：

`<REPO>\artifacts\memory-v0.4.0-p0\20261117-103032`

本次冻结开始于本地时间 10:30:32；文件复制完成后于 10:37:19 完成隔离数据库验证。备份被 `artifacts/` 规则忽略，未暂存或提交。它与 Git 代码检查点独立，不能从 Git 恢复这些用户数据。

| 子目录/文件 | 范围 |
| --- | --- |
| `profiles/dev/` | 开发 Profile 全部 639 文件，40,399,729 字节；含数据库及原 WAL、会话/配置、作业、authority、删除日志、浏览器存储 |
| `profiles/legacy/` | 旧 Profile 全部 5,991 文件，183,399,489 字节；含完整会话/配置与 40 条 Reflection 原始 JSON |
| `history-backfill/` | 原 `artifacts/memory-history-backfill/` 全部 78 文件，38,790,020 字节；含原备份、响应、plan、before/after、来源映射和恢复资料；原目录未覆盖 |
| `manifest.json`、`SHA256SUMS` | 每文件相对路径、来源绝对路径、大小、SHA-256；共 6,708 文件、262,589,238 字节 |
| `validation.json` | 无正文/凭据的隔离读取结果、版本、统计、来源完整性和历史一致性验证 |
| `CHECKPOINT-SHA256SUMS` | 上述 manifest、文件哈希清单和 validation 的封口哈希 |
| `verification/dev-profile/` | 从备份另复制的验证副本；只有这里允许数据库恢复 WAL；不是原始恢复源 |

安全机制：先通过有权限的 `Get-CimInstance Win32_Process` 只读确认无 Aisling/Electron/项目 Node writer。普通沙箱无法查询 CIM，随后受控提权查询成功，没有将查询失败当成离线。整个源文件集合同时以 `FileShare.Read` 持有读取句柄，禁止其他写入及删除；再次确认离线后才复制主库及 WAL。每文件比对源复制前/复制后及备份三方哈希，结束再查离线与文件集合数量。未停止任何用户进程，未对真实数据库开任何连接。

验证时先复核所有备份与源文件哈希，再将开发关键文件复制到全新隔离目录，用固定原生版本恢复 WAL、读取图，然后关闭并以只读连接重开。再次验证 Note/关系一致、来源有效、原备份所有哈希未变。原始备份主库与 WAL 保持原样，不能用恢复后的验证文件冒充原件。

封口 SHA-256：

```text
<PRIVATE_SHA256>  manifest.json
<PRIVATE_SHA256>  SHA256SUMS
<PRIVATE_SHA256>  validation.json
<PRIVATE_SHA256>  profiles/dev/memory-note-v2/note-v2.lbdb
<PRIVATE_SHA256>  profiles/dev/memory-note-v2/note-v2.lbdb.wal
```

未来恢复步骤（本轮未覆盖真实 Profile 做恢复）：

1. 正常退出 Aisling 和使用同一资源/资料的 Worker，重新检查进程及写入状态；无法证明离线就暂停，不强制结束进程。
2. 先校验 `CHECKPOINT-SHA256SUMS`，再遍历 `manifest.json` 的文件记录重新计算 SHA-256。备份含原始会话及配置凭据，仅保留在受控本机位置，不上传或贴入普通报告。
3. 对当前资料另做新的完整离线备份，保留之后的新增消息、来源删除责任及状态。若已有删除，不得直接用旧快照复活已删除材料；先协调删除日志/屏障和档案责任。
4. 将选定 Profile 的完整备份恢复到全新空隔离目录，主库与本次匹配 WAL 成对复制。不要只恢复 `.lbdb`，不要混入其他时点的 WAL、作业、会话、authority 或配置。
5. 用同版本 Node/LadybugDB 在该隔离副本恢复 WAL，关闭后只读复核 schema、数量、来源、关系、作业及 authority；禁止对原始备份直接开写连接。可参照本轮 `validation.json`，数量只适用于本检查点。
6. 检查配置仍指向真实 Obsidian Vault；隔离启动前先禁止副本对真实 Vault 输出，并避免启用 Formation/付费 Provider。通过后再在明确的权威切换中恢复到正式目标，保留原目录供回退，不合并或覆盖两个现存 Profile。

真实 Obsidian Vault 不在本备份内；本轮未写它。Mirror 是可重建的导出观察器，配置已随 Profile 保存，Vault 中用户自行创建的文件仍需独立保护。此备份与原数据同机同盘，防误操作而不防硬盘损坏；异机/离线副本不在本轮实际验证范围。

## H. 现有代码边界及后续设计约束

当前正式架构目标保持 **Context + Raw Recall + Note v2 Recall**。开发 Profile 已走该链路；旧默认 Profile 仍可创建/召回 Reflection，不能称为全局死代码。Reflection 最终不再承担正式结构化记忆职责。

| 边界 | 当前实际入口/职责 |
| --- | --- |
| Context / Raw | `conversation/conversation-store.ts` 持久会话；`runtime/memory-recall.ts` 做 Session BM25；`packages/core/src/runtime.ts`、`context.ts` 组装并优先保障当前 Context |
| Note v2 Formation | `stores/stage.ts` 成功交付后入队；`runtime/note-formation.ts` 调用当前 Provider；Desktop `note-formation.cjs` 持久化、重建、授权与恢复；合同独立验证 |
| Organization / Recall | `note-organization-v2.mjs`、`note-semantic-contract.mjs`、`note-candidates.mjs`、`note-embedding.cjs` 提供现有候选/关系能力；`runtime/note-v2-recall.ts` 和 Store 负责验源、版本及有界召回 |
| 旧 Reflection 业务 | `main.ts` / `stage.ts` 按 bridge 互斥加载 `runtime/legacy-memory.ts`，进而调用 Reflection Formation/Recall、旧 Store、Note Draft/Organization/Recall 和 Core `legacy-recall` |
| 通用保护 | `memory-evidence.cjs`、`formation-evidence.ts` 验源；`memory-lifecycle.cjs`、`memory-archive.cjs`、`memory-migration.cjs`、删除/迁移状态维护隐私与恢复责任 |
| 数据库 | `memory-database/note-v1.cjs` 虽含 v1 名称，实际承载当前 v2 的操作验证、Revision、Receipt、事务和关系；必须保留有效能力 |
| Mirror | `obsidian-control.cjs` + Main/preload；Worker `mirrorSnapshot` → `obsidian-mirror.cjs`；单向派生文件，不读 Markdown 形成事实 |

后续 Reflection 退役必须先对全部旧 40 条逐条完成**来源与语义复审**，对有价值认识完成必要回填或等价覆盖确认。38 条来源有效并不证明已迁移，2 条来源缺失也不授权删除或从旧备份复活。此前逐条审计索引只是初审材料，本轮未重做语义裁决。

退役应彻底移除旧 Formation/Recall、专属兼容入口、无效配置、专属类型及多余业务代码，并迁移调用、测试、IPC、声明和包出口；不能只关闭配置或隐藏开关。不能按 `reflection` / `note-v1` 文件名删除；来源验证、归档/迁移、隐私删除、数据库事务仍有实际职责的部分要保留。原始 Reflection、历史备份和必要删除责任在正式验证及明确处置前继续保留。

Formation 语义质量、上下文检索和事件演化是后续独立研究对象。`profile-user` 频繁出现本身不构成 Note 语义缺陷；跨事件 A/B 认识也不能预设必须先有两条 Note。应共同检查原始历史上下文、BM25/Embedding 候选、LLM 判断、Organization 与来源验证，再决定改进方向。本轮没有调整这些行为。

## I. P1 Formation 可靠性入口

调用链：`stage.ts` 保存并交付 → Renderer `runtime/note-formation.ts` / `formation-evidence.ts` → preload / Main IPC → Desktop `note-formation.cjs` 的 delivered / next / prepare / submit / settle / fail → `memory-database/store.cjs` → protocol / Worker / adapter / `note-v1.cjs` → 事务、Revision 与 Receipt；后续沿现有 Organization 和 Recall 链路使用。

| P1 具体关注点 | 文件/函数与验证入口 |
| --- | --- |
| 来源已推进但生成失败后无再次尝试 | `note-formation.cjs` 的 `delivered` 在生成前推进 progress；`next` 只取 pending；`fail` 将 running 变 failed 并删除 prepared；启动将 running 变 failed/interrupted。需设计有界、可取消、可验源的恢复，保留原幂等与删除屏障。测试入口：`note-v2-lifecycle.test.cjs`、`note-formation-electron.test.cjs`、Web `note-formation.test.ts` |
| 输出合同失败与错误分层 | `note-formation-contract.mjs:formationInput/parseNoteBatch`、`note-semantic-contract.mjs:parseSemanticJudgment`、Renderer `generate`、Main `submit/fail`；当前多数细分错误折叠为 invalid-proposal，回填工具又折叠为 provider-error。入口：`note-formation-contract.test.cjs`、`note-semantic.test.cjs`、Web Formation/Organization 测试；旧响应仅供离线冻结回放 |
| 失败可见性 | `note-formation.cjs:reviews` 的 failed 只看最后一批，不能呈现全部 7 个失败批次；completed 不代表每个 item 都已入库。入口：现有 reviews/Stage Memory 测试，后续补失败历史、状态与生命周期用例 |
| 约束与 Provider 能力 | `provider-factory.ts`、`packages/core/src/providers/openai-compatible-provider.ts`：当前采样/输出上限及 wire 字段须与共享合同一致；是否支持结构化输出需在后续受控实测确认，不能臆断当前服务支持。入口：Provider 测试与 Web `memory-provider-request.test.ts` |
| 语义质量与上下文（独立验收） | `formation-evidence.ts:withRelatedHistory` 有经历门槛；Main `prepare` 最多 5 个候选并裁剪输入；`note-candidates.mjs` 融合候选；`authorizeOrganization` 决定能否写入。入口：`note-organization-v2.test.cjs`、`note-semantic.test.cjs`、`note-associative.test.cjs`、Web `note-v2-recall.test.ts`。不能把候选扫描 complete 当作语义穷尽 |

本轮重新读源码确认了上述恢复与显示机制，并重新读取真实作业统计；未为 P1 新增恢复用例或重新制造真实失败。历史报告中失败后重交来源/重启的实验仍明确属于历史验证。后续不能通过删除校验、吞掉错误、扩大无限重试或回放真实历史去追求成功率。

## J. 尚存工程事项与 P1 准入

- 现有 7 个失败批次、progress 消耗、错误折叠及末批失败显示是待处理问题；它们没有因建立代码检查点而被修复。
- dev/prod 默认 Profile 与配置分裂仍存在；本轮未迁移 Profile，后续需单独明确权威、冲突优先级和离线切换。
- 40 条旧 Reflection 尚未完成全部正式语义复审/处置；不能宣布已完全迁移或可以退役。
- 回填脚本仅适用于原 Windows 布局和已准备资源，不是通用迁移/备份器。其原 plan 的备份集合小于本轮完整 Profile 备份；不要重新运行其 plan/stage/apply/restore 来恢复 P0。本轮只运行合成单元测试。
- 作业 2MB 上限、候选/来源/Recall 预算、保守 HAS_CONTEXT 删除闭包和模型判断能力仍有边界；本轮未放宽。
- 当前 19 Note / 17 关系及来源完整只证明结构与可恢复性，不证明语义质量、长期形成可靠性或真实模型稳定成功率。
- `.local` 的资源历史副本、实验资料和忽略的临时输出继续保留；移动/清理仓库前必须另行保护真实 Profile 和本备份。

P0 准入结论：代码已形成可恢复的本地 Git 检查点；已有 54 文件的成果及原分支/历史完整保留；用户数据有独立且已验证的完整备份；工作区没有未提交的代码工作，忽略资料继续保留。具备开始 P1 Formation 可靠性工程优化的基线条件，但不代表失败恢复、语义质量、Profile 统一或 Reflection 退役已完成。P1 应从隔离 Profile/冻结夹具开始；若届时真实数据发生变化，先建立新的离线数据检查点。
