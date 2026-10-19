# Context Phase One 工程收束

基于 `fec7942` 上已有的 18 个未提交 Phase One 文件进行增量修复。本页记录发布前的加固过程：当时已检查全部 diff，在本地忽略目录保留修改前副本，没有切换、重置、提交、推送或修改版本号，也未调用真实模型 API。用户已有实机验收结论继续保留；这些成果随后纳入 v0.3.5。

## 可复现问题与最小修复

| 问题与证据 | 修复 |
| --- | --- |
| `setItem` 抛出 `QuotaExceededError` 后异常被吞掉；新建会话的 `get()` 返回 undefined，切换后只能读到旧磁盘记录 | ConversationStore 保留尚未写成功的完整内存状态；后续读写继续使用它，下一次写入成功时整体保存并清除失败状态 |
| 读失败时返回空数组，随后 `create/save` 可能用空状态覆盖未知旧数据 | 保留最后已知状态并禁止本实例后续覆盖性写入；暴露 read 失败信息，不冒险合并未知数据 |
| 52 会话 fixture 读取只剩 50，后续保存会永久遗漏更早会话 | 移除隐式 50 会话截断；不自动删除历史来回避配额 |
| 旧单会话格式每次读取重新生成 UUID，`list/getActiveId/get` 身份不一致 | 在首次成功保存前缓存同一个迁移结果，下一轮回复继续写入原迁移会话且只记录一次 |
| 普通文本／视觉回复为 `''` 或空白时，Core 和 Stage 都会保存空 assistant 发言 | 保留真实用户输入，跳过空 assistant 记录；撤下流式临时文字，不更新 lastTurn，不触发语音或情绪判断 |
| 桌面 IPC 写盘异常直接抛出，无法可靠返回同步结果；原文件直接写入时可能留下截断数据 | 同目录临时文件写完后 rename 替换；严格读取旧文件后才合并，写失败返回原协议已有的 false，ConversationStore 将 false 视作失败 |

配额、新会话初始化、恢复后整体保存、超过 50 会话、旧格式身份、空回复和磁盘部分写失败，均先用测试复现再修复。

## 本轮修改文件

- `apps/stage-web/src/conversation/conversation-store.ts`：失败状态、内存保留、受保护读失败、稳定迁移身份和去除会话截断。
- `apps/stage-web/src/stores/stage.ts`：沿用现有 error 消息显示存储失败，每个当前会话视图只保留一条相同提示；暴露不含正文的 `persistenceError`；跳过空回复。
- `packages/core/src/runtime.ts`：文本和视觉输入的空回复不记为已说过的话。
- `apps/stage-desktop/desktop-store.cjs`：安全替换与可靠同步失败结果；未修改 preload 协议。
- `apps/stage-web/src/conversation/conversation-store.test.ts`：配额、false 结果、读失败、会话数量和迁移身份回归。
- `apps/stage-web/src/stores/stage-persistence.test.ts`（新增）：失败期间仍能发送／切会话、失败恢复、初始化失败、旧格式继续对话、流式空最终回复。
- `packages/core/src/runtime.test.ts`：普通和视觉空回复回归。
- `packages/core/src/context.test.ts`：增加中文、混合、数字标点、空白、emoji、结构化内容和预算边界检查；估算实现未改动。
- `apps/stage-desktop/desktop-store.test.cjs`（新增）：模拟部分写入 ENOSPC、不可读／损坏文件、原有配置保留及 preload 返回值。
- 本文及 `docs/context-phase-one.md`：记录加固后的行为、测量与限制。

正常回复、Token 窗口、来源关联和会话隔离行为保持。仅存储失败时新增现有样式的错误提示，空回复不再显示／保存成空发言，超过 50 会话不再隐式丢弃。`includeHistory=false`、Persona、回复策略、模型参数、P1.1 Candidate/Registry/核验及 P2 Working State 均未调整；没有新增依赖、定时任务或常规日志。

## 容量与失败处理结论

没有消息／会话条数截断，但仍受到浏览器配额、内存和桌面磁盘容量限制，不能保证无限持久化。失败时已有磁盘数据保持，当前进程中的完整会话和 UI 可以继续工作、切换和发送，错误提示明确说明重启可能丢失未保存内容。

写入失败在下一次会话变更时重试完整状态。读失败后，本实例进入只保留内存的保护状态，不自动重试覆盖未知旧数据；没有新增导出或复杂恢复 UI。`persistenceError` 保存 operation、受限 reason、时间和可用时的序列化字符数，不包含正文、密钥或原始异常路径。

未验证断电级持久性、并发多实例写入、所有浏览器的具体配额及真实磁盘满载；桌面 ENOSPC 采用确定性文件系统替身模拟。临时文件替换不等同于数据库事务或 fsync 保证。

## Token 复核

估算仍为 UTF-8 字节数加每消息 8 个 framing 单位，历史预算 4096，总预算／输出预留／余量均未修改。显式 fixture 检查如下，且与独立 `TextEncoder` 结果相同：

| 文本 | 估算值 |
| --- | --- |
| `中文` | 6 |
| `Hello world` | 11 |
| `中文 Hi 42🙂` | 16 |
| `12345,6789!?` | 12 |
| `，。！？` | 12 |
| 空格、tab、CR、LF | 4 |
| 家庭 emoji（含 ZWJ） | 25 |
| 扩展区汉字加 `e` 和组合重音 | 7 |

长中文输入在上限以内原样保留，再增加一个汉字导致超限时明确拒绝；结构化 JSON 原样计费和保留。既有测试继续覆盖工具定义／返回、长文本、特殊字符及超大当前输入，不截断当前问题或结构化证据。

这些测试验证字节估算和预算执行，不验证任何真实 tokenizer 的 Token 数。没有发现内容字节漏计或需要改动估算的证据；跨 Provider 的 framing、工具 wire 形式与 tokenizer 差异仍无法精确保证，继续保留 1024 余量，不宣称跨模型通用上界。

## 本地性能

Node 24.12.0，`.local/context-hardening-bench.mjs` 为本地检查脚本，输出 `.local/context-hardening-bench-results.json`；不覆盖此前真实 API 对比结果。Context 200 次、持久化 30 次采样，均先预热，仅合成数据、无网络。

| Context 历史数 | 选中数／估算 tokens | p50 / p95 ms |
| --- | --- | --- |
| 100 | 100 / 1890 | 0.056 / 0.192 |
| 20000 | 204 / 4080 | 0.113 / 0.332 |

| 持久化数据 | JSON 字符数 | UTF-8 / UTF-16 表示字节数 | stringify p95 ms | 内存后端完整 save p95 ms |
| --- | --- | --- | --- | --- |
| 1 会话 × 200 消息 | 28025 | 32825 / 56050 | 0.199 | 0.621 |
| 1 会话 × 20000 消息 | 2790125 | 3270125 / 5580250 | 19.983 | 33.630 |
| 10 会话 × 2000 消息 | 2790917 | 3270917 / 5581834 | 23.675 | 53.703 |

体积随总文字量近似线性增长。表示字节数不是各浏览器精确的配额计费值；save 测量包含整状态读取、解析、校验和序列化，不包含真实 localStorage、磁盘或 IPC，也不等于一次完整 Stage 交互耗时。超长历史仍有同步存储卡顿风险，本轮不改存储架构来优化它。

此前 0.254 ms 与本次 0.332 ms 来自不同测量时刻，不能据此判断回归或提升。旧版固定 40 条与当前 Token 窗口的输入内容和长度不同，没有建立公平前后对照，不报告性能提升倍数；本轮没有新增运行时采样或真实 API 请求。

## Candidate 原生冒烟诊断

已有失败为 `duplicateId` undefined，而首次 `deliveryCount === 1` 已通过。对照 `git show fec7942`，Candidate 冒烟分支在规范化换行后完全相同；`autonomous.ts`、`desktop-observations.ts`、原生采集器也无 diff。

该测试需要实际桌面上在约 12 秒轮询期内持续观察到同一对象／内容。退出等待的条件为任意 output-delivered 加任意 duplicate，最后却要求 duplicate 与第一次交付的 Candidate ID 相同，因此存在来自其他 Candidate 的 duplicate 导致提前结束的既有测试风险。它没有先确认来源是否稳定，也没有保存那次失败的原生样本序列；不能仅凭该失败认定 Context 回归。

只读聚合现有日志发现，最后两个诊断进程分别有 1/1、6/10 个已交付对象出现过同 ID duplicate，说明这条路径可以发生；不代表复现了当次冒烟。稳定输入的 Controller／Registry／Stage 自动测试均通过。结论是未发现 Context 回归证据，测试前置条件／等待条件存在既有风险，当次唯一原因仍未确认；未改动 P1.1，也未重跑真实原生 Candidate 冒烟或改变桌面环境。

## 本轮验证

- 开始前：Core 79、Stage 244、Desktop 24 项全部通过。
- 最终 Core：90/90；包含 Context 25、Runtime／历史／自主／视觉定向 39 项。
- 最终 Stage：253/253；包含 ConversationStore 7、持久化 5、自主 42、P2 Working State 47 和公开序列 3 项。
- Desktop：27/27，包括新增存储 3 项。
- `pnpm typecheck`、`pnpm build` 通过；构建仍提示主包超过 500 kB。
- 最终构建的 `AISLING_CONTEXT_SMOKE=1` 通过：成功交付、依据入库／注入、标准 Provider 字段、隔离、恢复、删除，3 次 Mock 回复，临时用户目录，无真实模型调用。
- 本轮未重跑真实 API、原生 Candidate 和默认完整 Live2D GUI 冒烟；不将这些未执行项目报告为本轮通过。

上述为发布前加固阶段的检查结果，未引入 Memory、压缩／评分、额外模型或新的存储系统。本地副本、临时基准脚本、日志及实验数据不纳入 v0.3.5。

## v0.3.5 发布复核

版本收束时重新通过 Context 定向 39 项、Core 90 项、Stage 253 项、Desktop 27 项，以及三项 Typecheck 和生产构建。pnpm 启动依赖同步时遇到沙箱全局存储锁权限限制，改为直接运行已安装的相同工具入口完成检查，没有更新依赖或锁文件。

默认生产冒烟首次在 `prod-smoke.cjs:403` 的初始输入框隐藏断言失败，该断言及鼠标悬停逻辑未改动；原样复跑通过，Context 专项生产冒烟也通过。首次失败保留为环境敏感的测试限制，不伪称一次全绿，也未修改运行逻辑或跳过断言。原生 Candidate 冒烟仍未形成确定结论，本轮未重跑；此前人工验收属于用户报告，本轮没有重做或调用真实模型。
