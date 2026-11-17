# Memory v0.4.0 P1：Formation 可靠性

> 公开脱敏候选：真实认识、记录标识、机器路径及私有校验值仅在私人归档保留。占位标识只用于本文说明，不可运行或跨页关联；本页仍记录原阶段的测试与限制，不代表本次重新验收。


2026-11-17，Asia/Shanghai。仓库：`<REPO>`，正式版本保持 `0.3.9`。本轮仅处理 Formation 生命周期、错误、可见性与恢复；没有付费模型调用、真实历史重处理、Profile 迁移或真实用户数据写入。

## A. 实施前审计与实际调用链

起点为 `feat/obsidian-memory-mirror` / `0b89ece047baed8d0c63837864b5f7ab48fe0e0c`，工作区和暂存区为空。重新核对最近四次 P0 提交：`eb5a8a1` 设置/图标、`657d568` Mirror、`c324cfc` 回填工具、`0b89ece` 检查点报告；没有发现 P0 以来的新提交或用户未提交工作。

重新读取当前源码及测试，没有直接把 P0 报告当作实现：

1. `stores/stage.ts` 持久化已交付消息，排除不能作为独立证据的派生助手消息；调用 Renderer `note-formation.ts:delivered/flush`。
2. Renderer 经 preload 的固定 IPC 调用 Main。Main 验证顶层 WebContents、frame、origin 和当前文档的 attempt 租约。
3. Desktop `note-formation.cjs:delivered` 校验当前原始消息及摘要，按会话收集任务。**任务和 progress 原本就经过同一次 flush + rename 发布**，不是分两次写入。
4. `next` 领取 pending 批次并持久化 running/attempt；`prepare` 重新取可信来源、候选和 grounds，记录 prepared 引用与候选版本。Renderer 以既有 Prompt/Provider 生成并本地解析，再 submit。
5. Main submit 独立重建与验证，先持久化 item、稳定 Note ID / operationId / fingerprint，再进入 settling。settle 先查 Receipt，随后按原授权规则决定应用、待审或拒绝。
6. Store 复核来源与主体，原 Worker 串行执行。adapter / `note-v1.cjs` 的事务使 Note、Revision、Evidence、关系和 Receipt 一起提交。成功产物进入原 Organization 队列。

实施计划为保留上述链路和原子写入，仅增加持久恢复元数据、一次有界网络自动重试、明确的手动重试及紧凑任务列表。没有新增 Worker、数据库、Provider、依赖或管理页面。

## B. 实际根因

- progress 表示“已接收这些来源”，却曾被误当作 Formation 已完成；失败后回退全局游标会重复消费其他已经成功的来源，因此不采用。
- 已交付来源本来有持久任务；`next` 却只找 pending，`fail` 和重启把 running 变 failed 后没有恢复入口。
- fail 删除 prepared，且多种异常被 Renderer/Main 折叠，难以区分解析、合同、原始来源与 Provider 错误。
- Worker 启动失败发生在 next 返回模型租约之前，原任务虽仍在，但没有持久化本次准备失败的记录。
- 前端 failed 只看最后一个批次；completed 与 item.applied/rejected/review 的区别没有呈现。
- Electron 不传递自定义 `Error.code`。只保留 Worker 的描述性 message 会让 Renderer 丢失稳定错误码。

本轮没有声称修复一个原本不存在的“游标与任务分开发布”窗口；保留原子替换并明确语义，同时修复重叠交付中“旧索引连同新尾部一起被跳过”的情况。Main 串行队列继续保护并发/重复交付。

## C. 文件与职责

| 文件 | 职责 |
| --- | --- |
| `apps/stage-desktop/note-formation.cjs` | 持久尝试/错误、重启处理、有界自动重试、手动队列、Receipt 恢复、所有任务统计、匿名擦除审计和旧作业读取兼容 |
| `apps/stage-desktop/note-formation-errors.mjs`、`.d.mts` | Main/Renderer 共用的错误白名单与类型；不保留异常正文 |
| `apps/stage-desktop/desktop-app.cjs` | 受信任 retry IPC、attempt 校验、跨 Electron 保留稳定错误码；透传既有 allowSemantic 参数，不改变 Organization 判断 |
| `apps/stage-desktop/preload.cjs` | 固定 retry 方法、明确的 next 参数；不暴露任意 channel |
| `apps/stage-web/src/runtime/note-formation.ts` | 保留错误发生阶段，分别识别网络/HTTP、超时、解析、合同及来源失败；复用既有 pump 的 wake |
| `apps/stage-web/src/stores/stage.ts` | 暴露已有 Formation pump 的唤醒，手动排队后立即处理 |
| `apps/stage-web/src/env.d.ts` | 任务统计、错误与 retry 的 Bridge 声明 |
| `apps/stage-web/src/components/settings/FormationStatus.vue` | 紧凑统计、可展开明细、操作结果、失败历史、恢复按钮与阻断原因 |
| `apps/stage-web/src/pages/settings/memory.vue` | 复用现有三秒刷新区，连接真实 retry IPC 与 pump，报告排队/保存结果及容量错误 |
| `apps/stage-web/src/i18n.ts` | 新状态和恢复反馈的中英文文案 |
| `apps/stage-desktop/note-formation-reliability.test.cjs` | 生命周期、故障、兼容、幂等、隐私和容量专项 |
| `apps/stage-desktop/note-formation-electron.test.cjs`、`note-formation-smoke.cjs` | 复用有隔离标记的真实 Electron/Stage 夹具，新增页面与 IPC 验证；原有断言保留 |
| `apps/stage-web/src/runtime/note-formation.test.ts` | Provider、响应解析/合同/语义及超时错误的 Renderer 回归 |
| 本报告 | 本轮审计、策略、验证及剩余边界 |

Worker、protocol、adapter、Store、Note 事务、Prompt、Note Schema/kind、subject、BM25/Embedding 候选、语义关系和自动授权函数、Raw/Note Recall、Mirror 均未修改。

## D. 生命周期对比

| 场景 | 原行为 | 当前行为 |
| --- | --- | --- |
| 交付 | 任务与 progress 原子保存；重复前缀可能使新尾部被跳过 | 仍原子保存；只跳过已交付索引，保留新尾部；不回退 progress |
| 收集中重启 | collecting → pending | 保留该行为 |
| 模型前 Worker 启动失败 | pending 保留，但无本次错误历史 | 持久化准备阶段失败/attempt，来源仍在，资源修复后可手动排队 |
| running 时进程中断 | failed/interrupted，删除 prepared，无恢复入口 | failed/interrupted，保留必要引用和历史；来源复核后可手动排队 |
| 临时网络/超时 | failed，不能恢复 | 持久化一次自动重试额度和 retryAt；等待至少 15 秒后重新领取 |
| 合同/解析/语义失败 | failed，错误可能被折叠 | failed，保留细分码与阶段；不自动循环，可显式重试 |
| 提议已保存/数据库结果未知 | settling，按 Receipt 恢复 | 保留该机制并记录存储错误历史；恢复只确认/执行原命令，不重新生成 |
| 待审核 | item.review，批次可能 completed | 保留；独立显示 review-required，不当作生成失败重跑 |
| 部分操作拒绝 | 批次 completed，UI 容易被误读 | 保留处理结束含义，逐批显示 applied/rejected/review-required/skipped/outcome-unknown |
| 来源删除 | 原任务/来源依赖及派生数据按既有删除闭包清除 | 删除保护不变；额外只保留不含来源、Note ID 或正文的匿名失败审计，禁止重试 |

持久化批次继续使用原 collecting/pending/running/failed/settling/completed 状态；`retryable` 是带 retryAt 的 failed 的 UI 投影，未引入旧读取器不认识的持久状态。任务在每次执行前记录 attempt；一次失败不会重置自动预算或影响其他已完成来源。

失败保留批次 ID、原 EvidenceRef、游标、attempt 和必要 prepared 引用；重试生成时重新验证来源并重建候选上下文，不保存额外原始消息副本。已经存在 items 的批次不能重新进入生成路径；其 Note ID、operationId、fingerprint 和 Receipt 继续复用。

## E. 错误分类与策略

每次失败使用白名单 `{code, category, phase}`；发生阶段为 source/prepare/provider/parse/submit/settle/interrupted/unknown。新尝试记录 startedAt/outcome，结束记录 endedAt。历史失败没有原始时间时 startedAt=null，仅记录本次导入/识别的 recordedAt，不伪造过去的执行时间。

| 类别 | 示例 | 处理 |
| --- | --- | --- |
| provider | provider-network、provider-temporary、provider-rejected、timeout | 仅网络不可达、408/429/5xx、超时且发生在 provider 阶段可自动一次；鉴权/其他 HTTP 或旧笼统 provider-error 不猜测为可自动恢复 |
| response-parse | invalid-json | 区分 Provider 信封解析与 Formation 正文 parse 阶段；手动重试 |
| contract-invalid | proposal-shape、draft-fields、output-limit | 保持原合同，手动重试 |
| semantic-invalid | semantic-shape、semantic-fragment、draft-state | 保持原验证，不自动循环 |
| source-invalid | source-changed、invalid-evidence、draft-quote、erasure-pending | 重新验证原始来源；无效/已删来源或删除屏障不得重新入库 |
| review-required | review-required、index-incomplete、context-limit | 保留原审核/已有组织处理，不重做生成 |
| authorization-rejected | stale-version、invalid-transition、user-rejected | 显示实际拒绝，不伪装成 applied |
| persistence | persistence-failure、database-error、outcome-unknown、receipt-conflict、formation-job-limit | 先核实原命令/Receipt；写入不明时禁止重新生成 |
| interrupted | interrupted、cancelled、stale-formation-attempt | 记录状态并阻止迟到提交；有效的普通失败批次可显式恢复 |
| unknown | unknown-failure | 保留未知，不依据原始异常文本猜测或无限自动重试 |

自动额度在安排重试时即持久化为 autoRetries=1，重启、切换 Provider、手动操作不会把它重置。每批最多一次自动生成重试；人工 retry 使用 batch ID + 当前 attempt，经过同一 Main 队列，重复点击不能重复排队或领取。

数据库失败保留 settling 及原操作标识；每次恢复先查询 Receipt 并核对 fingerprint。存储失败历史按同一 attempt 的不同稳定错误码记录，重复轮询同一未解决错误不无限追加条目。取消/进程中断不会把已经提交的 items 重新变成待生成批次。

Main IPC 将异常白名单化为稳定 code 后抛出，避免 Electron 丢掉自定义 code；Renderer 回传同一 code/phase，Main 自己派生 category。普通日志/新元数据不保存 Provider 正文、原始用户消息、API Key 或任意异常描述。

独立 Organization 作业继续使用原任务模型及重试策略；本轮新增的持久失败历史针对普通 Formation 批次，Formation 提议内的 semantic 字段失败纳入上述分类。没有修改 Organization 的关系判断和自动授权规则。

## F. 前端与手动恢复

Memory 原页面增加一个紧凑 Formation 统计区和可展开明细，不增加独立管理页。统计覆盖所有保留批次，原失败布尔值不再只看最后一批。每批显示状态、尝试次数、实际操作数量、短原因与历史错误；completed 明确表示流程结束。

重试调用链为按钮 → `noteReview.retry(id, attempt)` → preload 固定 channel → Main 受信窗口/frame/origin 校验 → service.retry → 持久 pending → Stage 唤醒已有 Renderer pump → next/prepare/原 Provider。不是只修改视觉状态。

运行中/已完成/待审批次不能重新生成；Formation 关闭、来源无效、删除屏障未完成、保存状态必须先确认等情况有明确反馈。settling 的按钮是“确认保存结果”，不会重新调用 LLM。UI 的统计/错误可在数据库不可用时返回，但隐私读取屏障未通过时不返回审核引文；在异步读取结束后再次检查删除屏障。

新状态、提示和操作具备中英文文案；稳定错误码和技术阶段保留用于定位。UI 测试同时覆盖真实按钮、连续双击、操作数量、中英文及非可信 WebContents 拒绝。

## G. 旧作业兼容与体积

继续使用 `note-formation-jobs.v1.json` / version=1。新增字段均可缺省：batch.history、batch.failure、autoRetries、retryAt 及顶层 erasedFailures；读取时验证新增字段，不批量把旧 failed 改为 pending，也不扫描所有历史会话重新交付。

- 原 progress、batches、prepared、items、Organization/Embedding 等字段保留；旧失败首次读出时可以投影旧 error，不为查看状态强制重写其内容。
- 明确手动操作时把旧已知失败码纳入历史；无法恢复旧的精细错误、时间或各次尝试详情时保留 unknown/null，不虚构证据。
- running/collecting 的重启处理沿用原生命周期，只为 interrupted 增加可恢复元数据。已安排自动重试的预算和时刻保持不变。
- 来源擦除继续删除原任务及含来源/提议的内容。erasedFailures 只保留哈希化匿名标识、attempt 和白名单失败元数据，无来源/会话/Note ID、引文或可执行操作；它不可重试。
- 沿用原 2,000,000 字节上限和 flush + rename；历史不自动截断，不存整份 Prompt/响应或重复消息。容量不足时原子拒绝新写入，保留既有任务/来源/历史，需要后续单独治理，不能删除数据来“修好”本轮测试。

本轮没有启动真实 Profile，也没有对它们执行任何作业迁移。旧代码不会理解新增恢复能力，但原持久状态和字段仍可读取；回退工程仍应使用 P0 代码及其独立、完整的数据检查点，避免不同版本同时写同一 Profile。

## H. 本轮验证

| 本轮命令/范围 | 结果 |
| --- | --- |
| `git diff --check`，提交前 `git diff --cached --check` | 通过 |
| `pnpm typecheck` | Core、Web、Desktop 全部通过；最终阶段再次检查 |
| `pnpm build` | 生产构建通过；最终主 chunk 804.59 kB，保留既有大于 500 kB 的提示，不扩大拆包范围 |
| `pnpm -r --workspace-concurrency=1 run test --maxWorkers=1` | Core 19 文件、112/112；Web 45 文件、430/430，通过 |
| 设置 `AISLING_MEMORY_DB_P0_TEST_RESOURCES` 为 `.local/memory-database`，执行 `node --test --test-concurrency=1 'apps/stage-desktop/*.test.cjs' scripts/memory-history-backfill.test.cjs` | Desktop 与历史工具共 141/141，0 失败、0 取消、0 跳过，最终全量约 303 秒；含原生数据库、迁移/删除、Formation、Organization、Recall、HNSW、Mirror 和真实 Stage Mock 链路 |
| 新增专项 | 原生可靠性 12 项；Electron UI 1 项；Renderer 新增 9 项（该文件共 10 项）。覆盖旧保护，未删除原有断言 |
| 最终构建后定向复核 | Worker 错误码 + 实际 UI/IPC 两项通过；Renderer 10/10 再次通过 |
| 受保护数据 | 两个真实 Profile 的 6,630 个文件及文件集合一致，无新增、缺失或哈希变化 |

日志为忽略目录中的 `web-core-final.log`、`desktop-verified.log`、`reliability-final.log`、`typecheck-delivery.log`、`build-delivery.log` 及 UI 专项记录。错误白名单补齐实际 Worker 稳定码后再次做类型、构建及受影响专项验证；没有用历史报告的结果代替本轮运行。

专项覆盖用户要求的十二类场景：交付后模型前故障、Provider 失败、重启预算不重置、合同不自动循环、明确手动恢复、review 不重跑、删源不复活、成功操作不重复、多批失败均可见、部分拒绝的实际计数、重启任务保留、并发交付/重复点击。同时覆盖 2MB 原子拒绝、旧 v1 读取兼容、删除意图发生在异步审核读取期间的引文屏障，以及提交后错误凭原 Receipt 恢复。

本轮早期验证记录保留在忽略目录 `.tmp/p1-formation/`：

- 新原生夹具起初未启用生产的 autonomous 模式，导致三个恢复断言失败；改为生产模式后通过，断言未移除。随后把初始原子写失败断言调整为比对该模式已经创建的作业原始字节。
- 新 Web 测试的 mock 返回值曾被 TypeScript 推断为宽 string；补显式合同返回类型后通过。
- 隐藏 Electron 暂停帧导致初次路由等待失败；仅在合成 UI 夹具用定时帧驱动转场。另有一次夹具返回函数无法跨进程克隆，以及语言选择器误命中旧页面控件；均修正夹具，未放宽产品断言、来源规则或超时。
- 一次启动被自动审批服务额度错误阻断，未执行该操作；用户要求继续后重试正常。这不是产品安全判断或业务测试结果。
- 首轮 Desktop 全量为 139/141；两个新补充夹具分别把删除放在了读取已完成之后、以及误以为开始新尝试必然增大文件。改为在读取完成前交付删除，并用必然增加记录的新来源交付触发容量限制，保留安全断言；专项 12/12 后全量复验 141/141。

历史 P0 的通过次数、真实模型响应及回填记录不计作本轮重新验证。没有真实 API 请求、付费批处理、真实历史重新 Formation、安装包/发布验收、专用 P0 进程冒烟或长周期负载试验。

## I. 剩余边界与数据保护

本轮对 `.local/desktop-dev-profile` 与旧默认 Desktop Profile 只做文件集合/哈希读取；开工基线与结束核对均覆盖 6,630 文件，新增=0、缺失=0、内容变化=0。没有打开这两个真实数据库、切换 authority、启用真实 Formation、重试旧 7 批真实失败、回填/删除 Reflection 或写真实 Obsidian Vault。

保护证据保存在 `.tmp/p1-formation/protected-files.json` 和 `protected-files-final.json`；扫描待提交文件未发现常见凭据签名，测试中的 private/synthetic 字样均为新建合成值。原 P0 的独立备份和恢复资料保留，未覆盖。

全部变更以一个独立本地提交收束，共 16 文件；本报告包含在同一提交中，其 SHA 用 `git log -1 --format=%H -- docs/memory-v0.4.0-p1-formation-reliability.md` 查询。提交不含真实数据、日志、备份或模型响应，没有推送、改版本、改标签、合并分支或改写已有历史。

恢复入口不代表可以处理无效/已删除来源、绕过待审或冲突 Receipt。无法确认的存储结果保留原操作，不能通过重新调用模型来“重做”。应用持续运行但 IPC/磁盘完全不可写时，不能承诺提交一条新的持久记录；原有已保存任务和游标仍受原子替换保护。若整个 Profile 损坏或达到 2MB 上限，需要独立恢复/容量处理。

来源交付仍依赖已有 Stage → Main 的确认链路；未新增跨进程持久 outbox，也不会为可能未送达的旧消息自动回扫整个历史。progress 继续代表 Main 已持久接收的来源，不代表所有原始消息均应自动形成 Note。

现有自动授权、来源验证、隐私删除闭包、Worker 串行事务、Receipt 与 operationId 保留。普通 Formation 失败的可恢复性改善不证明真实模型能稳定产出正确语义，也不等于所有历史失败都已在真实数据上解决。

## J. 后续语义工作与最终回答

Prompt 合同表达、跨上下文指代、语义抽取质量、原始历史上下文、BM25/Embedding 候选发现、LLM 判断、Organization 配合与事件演化继续作为后续独立研究。本轮没有处理 profile-user 比例，也没有预设跨事件认识必须先有两条 Note。

| 问题 | 结论 |
| --- | --- |
| 来源已消费后是否仍因普通失败而没有恢复入口？ | Main 已接收的来源保留持久任务；临时故障有一次自动重试，其他合格失败有明确手动入口，不回退整个游标。无效/已删来源、损坏或不可写存储属于明确阻断 |
| 反复重启会丢任务或无限重试吗？ | 持久任务/次数保留，自动额度不重置；interrupted 转为可手动恢复失败。数据库恢复不重新生成 |
| 重试会造成重复 Note 吗？ | 已保存 items 只能按原 operationId / fingerprint / Receipt 恢复，不能进入生成；重复排队/领取受队列与 attempt 校验保护，隔离测试通过 |
| 能看到所有失败批次吗？ | 所有保留批次均在统计/明细内，包含非末批失败；来源擦除后的匿名审计明确不可重试 |
| 失败原因能明确区分吗？ | 新失败按白名单类别、稳定码和阶段区分；旧数据缺失的细节仍明确为未知，不伪造 |
| 原授权、验源及删除保护是否保持？ | 保持，相关既有回归继续运行，且新增异步读取期间删除屏障与删源重试验证 |

本轮只交付 P1，不进入 P2/P3/P4；不修改版本号，不推送 GitHub。
