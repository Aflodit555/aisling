# Project Aisling Memory 工程现状审计

审计日期 2026-11-03。基线为当前工作树（含审计前已有的未提交修改），HEAD 为 `d78c70a8a0f2dc0b1838c1063d71195d6b24d4b7`。本文以代码位置为主要证据，既有测试与归档实验用于交叉核对。以本地单用户、单 Stage 写者为正常运行条件，另列多个实例共享 profile 时的风险。路径和行号均相对于仓库根目录。

## 1. 实体、身份与引用

| 实体 | 实际字段、身份和约束 | 代码 |
| --- | --- | --- |
| Conversation / Session | 当前持久化会话实体为 `ConversationSession { id, title, createdAt, updatedAt, messages }`。无独立 Conversation 父实体。新会话用 `crypto.randomUUID()`，读取只要求 `id` 为字符串，无唯一性检查。`PersistedState { sessions, activeId }` 维护会话集合和当前会话指针。缺失或无效会话时间归零，0 表示未知。 | `apps/stage-web/src/conversation/conversation-store.ts:5–21,68–82,165–210` |
| Message | `ChatMessage` 有 `role: system｜user｜assistant｜tool`、`content: string｜null`、可选 `toolCalls` 与 `toolCallId`。`ConversationMessage` 增加可选 `createdAt` 和 `autonomousContext`，无消息主键。工具调用 ID 用于工具应答配对。自主发言元数据含交付／观察时间、来源、变化类别、候选／对象 ID、应用／标题及可选艺术家／脱敏摘录，读取时白名单归一化。Stage 常规会话保存用户输入和交付的助手文本。Core 工具轮的临时消息保留在当轮请求中。 | `packages/core/src/provider.ts:1–23`，`packages/core/src/context.ts:10–66,86–121`，`apps/stage-web/src/conversation/conversation-store.ts:48–66`，`apps/stage-web/src/stores/stage.ts:372–389,415–437,458–470`，`packages/core/src/runtime.ts:326–355` |
| Reflection | `version: 1`、UUID `id`、`content`、`kind`、`basis: direct｜inferred｜mixed`、`tags[]`、`sourceRefs[]`、`relatedReflectionIds[]`、`createdAt`、可选 `uncertainty`。类别为 `event / fact / pattern / preference / project-state / open-question`。内容 1–800 字符（非空白），标签 1–6 个、每个最多 40 字符，来源 1–12 个，链接最多 3 个，不确定性若提供须非空且至多 300 字符，`inferred/mixed` 必填。形成时间要求非负安全整数。 | `apps/stage-web/src/runtime/reflection-store.ts:1–15,36–51`，`apps/stage-web/src/runtime/reflection-formation.ts:109–124` |
| SourceRef | `{ sessionId, messageIndex, digest }`，零基数组位置加 SHA-256 摘要。摘要输入为消息对象 `JSON.stringify(message)` 的 UTF-8 字节。Store 检查会话 ID 格式、非负安全整数索引和 64 位小写十六进制摘要格式。Formation 和 Reflection Recall 负责查消息并复算摘要。原始 Recall 诊断也使用会话与位置，`messageId` 固定为 `null`。 | `apps/stage-web/src/runtime/reflection-store.ts:3,36–38`，`apps/stage-web/src/runtime/reflection-formation.ts:28–31,156–164`，`apps/stage-web/src/runtime/reflection-recall.ts:131–155`，`apps/stage-web/src/runtime/memory-recall.ts:6–11,123–129` |
| FormationBatch | UUID `id`、主 `sessionId`、当前批次的 `sourceRefs[]`、交互单元数 `units`、`status: collecting｜pending｜completed｜failed`、`attempts`、可选 `error`、产物 `reflectionIds[]`。错误枚举为 `provider-error / invalid-output / source-changed / input-limit / storage-error`。可完成且产出零条。跨会话补充证据可以进入产物来源，批次的来源数组仍表示本批输入。 | `apps/stage-web/src/runtime/reflection-store.ts:16–25,53–65`，`apps/stage-web/src/runtime/reflection-formation.ts:166–196,255–268,318–339` |
| ReflectionState | `{ version: 1, reflections, progress: [{ sessionId, nextIndex }], batches }`。校验 Reflection ID、批次 ID 和进度会话 ID 各自唯一，链接指向已存在 Reflection 且禁止自连，批次产物 ID 必须存在。ID 校验采用 `^[\w-]{1,128}$`。此层未验证跨文件来源、环、关系语义或批次状态与产物之间的完整状态机。 | `apps/stage-web/src/runtime/reflection-store.ts:26–65` |

一条会话按位置拥有多条消息。批次记录一次 Formation 工作及产物归属，一条 Reflection 可引用多个会话的消息，也可单向指向已有 Reflection。会话的宽松 ID 校验与 Memory 的 ID 规则存在落差，旧导入数据可能能显示却无法进入某些检索或 Formation 路径。归一化会丢弃非法消息，所以数组下标与归一化规则都属于来源兼容契约。`apps/stage-web/src/conversation/conversation-store.ts:48–82`，`apps/stage-web/src/runtime/memory-recall.ts:117–129`，`apps/stage-web/src/runtime/reflection-store.ts:36–64`。

**已实现的可复用能力。** 有稳定的会话／Reflection／批次身份、类型化内容、自由标签、证据来源、形成时间和单向弱关联。形成时追加新条目，旧条目及反向链接保持原样。Recall 用链接 ID 做正文泄漏检查，但不沿关系扩展检索或把关系注入模型。`apps/stage-web/src/runtime/reflection-formation.ts:109–124,260–268`，`apps/stage-web/src/runtime/reflection-recall.ts:135–168`。

**已有接口与产品入口的差别。** `ReflectionStore.update(change)` 是整状态变更原语，生产 Formation 只用它管理进度／批次和追加产物。`inspect`、`flush` 和 `retry(batchId)` 已实现，`retry` 只把失败批次转回待处理，设置页只有开关，没有重试、编辑、删除或关系维护入口。`version: 1` 表示存储格式。`kind: project-state` 表示一条认识的类别。当前没有独立 Note、带类型的 Relation、内容修订链、合并／取代操作或 Note 生命周期 State。`apps/stage-web/src/runtime/reflection-store.ts:4–34,67–88`，`apps/stage-web/src/runtime/reflection-formation.ts:343–353`，`apps/stage-web/src/pages/settings/memory.vue:9–19`。

## 2. 持久化与故障行为

| 路径 | 数据、接口与写入边界 | 代码 |
| --- | --- | --- |
| 浏览器 | Conversation、配置等走当前 origin 的 `localStorage`。会话键 `aisling.conversations.v1` 保存 `{ sessions, activeId }` JSON 字符串。原始 Recall 可用。Reflection bridge 缺失时返回读／写失败，无浏览器 Reflection 后端。 | `apps/stage-web/src/storage/desktop-storage.ts:11–26,53–59`，`apps/stage-web/src/conversation/conversation-store.ts:15–21,101–110,142–158`，`apps/stage-web/src/stores/stage.ts:106–119,139–159` |
| Desktop 通用键值 | Main 使用 `app.getPath('userData')/aisling-store.json`。外层为 JSON 对象，配置和会话值是各自序列化的字符串。Preload 暴露 `window.aislingDesktop.storage.getItem/setItem`，同步 IPC `aisling:storage:get/set`。写入先严读外层再更新单键、整文件替换。Main 也直接读同一文件的配置和语言。dev 与 built 不依赖网页 origin 选路径。 | `apps/stage-desktop/desktop-store.cjs:17–51,65–112`，`apps/stage-desktop/preload.cjs:40–47`，`docs/desktop-host.md:42–46` |
| Desktop Reflection | `userData/aisling-reflections.v1.json` 直接保存 `ReflectionState` JSON 对象。`reflectionStorage.read/write` 走同步 `aisling:reflections:read/write`。不存在返回 `{ ok: true, value: null }`，其他文件读取失败返回 `{ ok: false }`。Main 验版本和顶层数组，Renderer 做字段及关联校验。两端都限制写入为 2,000,000 UTF-8 字节。无自动清理或容量回收。 | `apps/stage-desktop/desktop-store.cjs:114–130`，`apps/stage-desktop/preload.cjs:40–43`，`apps/stage-web/src/runtime/reflection-store.ts:53–87` |
| 内存 | Stage 持有 `sessionMessages`、`sessionsList`、显示消息与 Core history。ConversationStore 成功路径从后端解析，内存 `pendingState/lastKnownState` 支持迁移和错误恢复。ReflectionStore 每次 `read/update` 读文件、解析和验证。Formation 的状态、任务队列、计时和取消控制在内存，批次和进度在文件。Reflection Recall 缓存索引，来源摘要只在一次检索中按消息对象复用。 | `apps/stage-web/src/stores/stage.ts:93–117,314–326,466–470`，`apps/stage-web/src/conversation/conversation-store.ts:84–158`，`apps/stage-web/src/runtime/reflection-store.ts:67–87`，`apps/stage-web/src/runtime/reflection-formation.ts:138–155`，`apps/stage-web/src/runtime/reflection-recall.ts:88–101,131–149` |

- **写入与并发。** 两个文件各自使用同目录固定 `.tmp`、同步写入、`renameSync` 替换及尽力清理。单文件替换可保护旧文件免受典型临时文件写失败。代码没有 `fsync`、文件锁、跨文件事务或整状态比较交换。单个 Main 的同步 handler 会顺序执行，Renderer 的读改写仍可被另一写者交错。`registered` 仅防止进程内重复注册，当前 Desktop 启动链未使用单实例锁。两个实例可基于相同旧快照覆盖彼此的更新，固定临时名也会冲突。Conversation Desktop 写入仅检查键长和字符串类型，无应用层字节配额。浏览器依赖 origin 配额。大历史会增加同步 IPC、全量解析和写入成本。`apps/stage-desktop/desktop-store.cjs:22–57,82–130`，`apps/stage-desktop/main.cjs:1–13`，`apps/stage-desktop/desktop-app.cjs:566–600`，`apps/stage-web/src/runtime/reflection-store.ts:67–85`。
- **会话错误恢复。** ConversationStore 捕获读取异常后保留最后状态，并阻止该实例继续覆盖未知存量。写失败保留待写状态，后续写成功可恢复。Stage 显示错误，并跳过 Recall 和 Formation 入队。Desktop 通用读取把坏文件／读取异常折叠成 `null`，因此 Renderer 可能先看到空历史，直至写入失败才得知异常。Main 的严格写前读取仍保护坏文件。Reflection 读取或校验失败会退出该次 Formation／Recall，普通聊天有独立降级路径。满容量时，连记录批次失败本身也可能写不进去，磁盘可能仍保留原 `pending`。`apps/stage-web/src/conversation/conversation-store.ts:95–158`，`apps/stage-web/src/stores/stage.ts:139–159,306–326,428–436`，`apps/stage-desktop/desktop-store.cjs:27–38,89–130`，`apps/stage-web/src/runtime/reflection-formation.ts:270–287`，`packages/core/src/runtime.ts:388–417`。
- **迁移与兼容。** 缺少新会话键时，旧 `aisling.conversation.v1` 消息数组转为一个会话，生成 UUID、从首个用户文本派生标题，历史会话时间保留未知。第一次成功写入前在内存维持该 UUID，旧键仍留存。Desktop 桥仅在白名单键均为空时逐键复制当前 origin 的 localStorage，保留原值。复制不检查写入结果，也无跨键事务或导入完成标记，部分复制后重启可能因已有一个键而跳过余下数据。Reflection 只支持 v1，新版本或坏内容通过正常 Store 路径被拒绝，没有版本升级或修复程序。Main 写前对旧 Reflection 文件主要检查外层可读性与版本，完整性依赖 Renderer 先经过 `read/validate`。`apps/stage-web/src/conversation/conversation-store.ts:101–158`，`apps/stage-web/src/storage/desktop-storage.ts:13–20,28–59`，`apps/stage-desktop/desktop-store.cjs:119–130`，`apps/stage-web/src/runtime/reflection-store.ts:53–87`。
- **IPC 信任与隐私。** Desktop Stage 使用隔离、沙箱、禁用 Node 集成和导航限制。Storage handler 本身没有复用 Desktop Awareness 的 sender/frame/origin 检查。通用桥可以读取配置字符串，Memory 文件和对话在本地为明文 JSON。Formation 通过已配置的聊天 Provider 发送筛选后的原文和候选摘要。`safeText` 是启发式内容过滤，无法作为完整脱敏或权限边界。`apps/stage-desktop/desktop-app.cjs:477–497,595–605`，`apps/stage-desktop/desktop-store.cjs:89–130`，`apps/stage-web/src/runtime/memory-recall.ts:70–74`，`apps/stage-web/src/runtime/reflection-formation.ts:71–84,224–246`。

## 3. 三条实际运行链路

### 3.1 原始 Recall

1. Memory 默认开，Formation 默认关。Stage 对普通文本先保存本轮用户输入并刷新会话列表，再调用 Core。Core 的用户文本 handler 调用 Recall 钩子。Stage 以本轮已有 `sessionsList` 为输入，Mode A 仅原始 Recall、B 仅 Reflection Recall、C 联合且默认。A/B/C 为内存实验开关，切换受发送／视觉处理中限制。视觉和自主入口不调用两条 Recall，识别到本地交互偏好命令时 Stage 直接确认并保存。`packages/core/src/config.ts:68,106`，`apps/stage-web/src/stores/stage.ts:93–119,139–159,183–189,330–348,372–389`，`packages/core/src/runtime.ts:388–449`。
2. `retrieveRecall` 同步扫描非活跃会话，以每个会话合格文本为一篇文档。排除工具消息、当前会话已有相同内容以及 `safeText` 不通过的文本。对部分模糊追问，以最近 12 条消息内可用的用户文本补充检索词。NFKC、小写、汉字单字与二元组、拉丁字母数字词构成词项。每次重建 TF/DF，BM25 对拉丁词额外加权，至少匹配 2 词且得分至少 1，取前 5 个会话。扫描超过 250,000 字符或 30 ms 时整次返回空，30 ms 是检查点预算。`apps/stage-web/src/runtime/memory-recall.ts:4,70–157,167–169`。
3. 按整组会话装箱，保留通过筛选的原文及同会话中的后续纠正。内部 JSON 与模型投影均须同时满足 6,000 字符和 6,000 字节。投影用临时 E/C 标签、角色、来源类别、会话内位置与时间精度，去除内部 ID。跨会话仅在时间范围可确定且不重叠时依时间排序。Core 把证据包装为系统消息，标记为不可信历史，引导区分自述、助手发言和已执行事实，按剩余预算注入。证据块不写回会话。`apps/stage-web/src/runtime/memory-recall.ts:25–68,158–169`，`packages/core/src/runtime.ts:137–148,167–185,252–288,388–420`。

### 3.2 Reflection Formation

1. 设置加载、Memory ON、Formation ON 后启用。Stage 只在普通文本或自主发言成功交付、落盘路径无错误后异步通知 `delivered`，分别传入用户／助手位置对或自主助手位置。流式片段、失败、取消、空回复及视觉回合不入队。启用时把进度置于会话末尾，旧 collecting 转 pending，已有 pending 保留，既有历史不会批量补形成。切换／新建会话时 flush 旧会话。`apps/stage-web/src/stores/stage.ts:106–121,389–447,507–537`，`apps/stage-web/src/runtime/reflection-formation.ts:289–345`。
2. 单个控制器的 Promise 串行队列写进度和批次。已越过的尾索引可跳过，`nextIndex` 随入队推进。通常 3 个交互单元或达到输入边界转 pending，超限单元留下失败记录。零延时定时器驱动单个 pump。每个请求最多 12 条来源、证据 6,000 字节、系统策略和载荷合计 15,000 字节。取 pending 后从 ConversationStore 重读消息并复算摘要。`apps/stage-web/src/runtime/reflection-formation.ts:6,71–84,138–164,198–206,305–345`。
3. **已有 Reflection 候选。** 用当前批次消息与旧条目 `content + tags` 的去重词项交集数排序，有一个重叠词即可进入排序，同分按 ID，最多 3 条。候选来自 `store.read().reflections`，无 completed 归属过滤、来源复核或关系遍历。模型收到 R 标签、内容、类型、依据、标签、形成时间和可选不确定性。是否重复、是否实质相关由提示词及模型决定。代码只校验 R 标签是否来自本次允许列表并去重，存为新条目指向旧条目的 ID 数组。它不会按语义去重、更新旧条目或维护反向关系。`apps/stage-web/src/runtime/reflection-formation.ts:49–69,76–82,99–124,224–227,260–268`。
4. **额外原始历史。** 当前用户文本须命中尝试／目标与结果词的组合启发式，才复用原始 `retrieveRecall` 搜别的会话。历史组也须有命中同类启发式的用户消息，并以整组加入，受本批原有预算限制。历史标为 `related-history`，供模式对照，不增加待形成单元。原始 Recall 的 A/B/C 实验模式不参与 Formation 的这条选择。`apps/stage-web/src/runtime/reflection-formation.ts:166–196,224–230`，`apps/stage-web/src/stores/stage.ts:106–119,139–154`。
5. Formation 直接用 Settings 当前 `ChatProvider.complete` 发独立非流式请求，无工具，温度 0.2，输出上限 1,500，45 秒超时和取消。匹配特定 Formation 路由时才覆盖 `enableThinking: false`。OpenAI-compatible Provider 把选项映射到 `enable_thinking`、`max_completion_tokens` 和 fetch signal。缺 Provider 时保留 pending 并停止当前 pump，没有单独监听 Provider 恢复的唤醒路径。失败会记录批次状态，启用状态下可显式 retry。关闭／卸载由 epoch 和 abort 丢弃旧请求结果。进程中断后 pending 可在再次启用时重做，因此 Provider 调用可重复。`apps/stage-web/src/runtime/reflection-formation.ts:83–84,198–248,270–303,343–353`，`apps/stage-web/src/runtime/provider-factory.ts:24–36,52–63`，`packages/core/src/providers/openai-compatible-provider.ts:126–155,334–343`。
6. 响应必须是严格 JSON，整批 0–3 条。按允许字段、E/R 标签、类型与值域校验。每条须引用至少一个当前来源，pattern 须有至少两条不同位置的用户报告和不确定性，fact/preference/project-state 拒绝纯助手来源。任一草稿不合格则整批拒绝。提交前重读全部请求证据并校验摘要，然后同一次 Reflection 文件替换完成产物追加和批次完成。**提示词与硬约束有落差**。提示词要求非 pattern 只用当前来源，解析器仅拒绝全部来源来自历史，所以带一个当前 E 和一个历史 E 的非 pattern 可通过该项校验。两个不同位置也可能属于同一次经历。来源支持程度、因果与语义重复仍依赖模型。`apps/stage-web/src/runtime/reflection-formation.ts:55–69,86–135,250–281`。

### 3.3 Reflection Recall

1. Stage 的用户文本钩子可在 Formation OFF 时独立读取已保存的 Reflection。只为 completed 批次所列、结构合法的产物建索引。索引以 Reflection 为文档，使用内容和归一化标签、停词与模式查询词。独立计算 BM25，要求话题相关、至少 2 个匹配词且得分至少 1。比较类问题可将相关 pattern 提到 shortlist 首位，最多复核 6 条。`apps/stage-web/src/stores/stage.ts:106–119,150–159`，`apps/stage-web/src/runtime/reflection-recall.ts:7–12,59–129`。
2. 在本轮会话快照内按 ID 和位置查找全部来源。复查安全文本、角色与工具标志、SHA-256 和类别所需的用户报告，缺任一来源就排除整条。模型投影保留 Reflection 内容、类型、标签、依据、不确定性、形成时间及来源角色／位置／时间摘要。没有把原始引文或关联图附在 Reflection 块里。`apps/stage-web/src/runtime/reflection-recall.ts:131–168`。
3. 在最多 6 条合格候选中枚举至多 3 条的组合，最大化相关性，并对需要模式的问题奖励有具体标签和多份用户报告支持的 pattern，惩罚同类、来源高度重合且正文近似的条目。相同价值倾向更少字节。局部上限为 1,500 字符、4,500 UTF-8 字节。Core 另做 JSON 与长度检查，按剩余上下文预算让同一个已验证候选池重选。`apps/stage-web/src/runtime/reflection-recall.ts:13–57,170–185`，`packages/core/src/runtime.ts:252–288,400–414`。
4. Core 先组装 Persona、当前输入、工具定义与完整的同会话近期交互，再为 Memory 使用剩余空间。历史预算 4,096，输入上限 14,336，估算按 UTF-8 字节加消息开销。联合模式先尝试给 Reflection 留至多一半余量，再让原始证据以整会话装箱并重新分配余量。系统证据块位于本轮输入等后缀前。Core 对普通回复使用同一 Provider 的 `stream` 或 `complete`。Recall 没有额外模型请求。`packages/core/src/context.ts:4–8,68–84,124–154`，`packages/core/src/runtime.ts:151–185,235–315,362–420`。

**共享与快照边界。** 两条 Recall 共享会话快照、分词、文本过滤、追问锚定与部分时间投影。索引、排名和候选池各自独立。原始 Recall 每轮同步重算，无跨轮索引。Reflection Recall 跨轮缓存索引，Formation 的 `changed` 回调在状态通知时使之失效（含请求启动等非提交事件），没有外部文件变动通知。Reflection 检索在首个 await 前捕获索引和会话引用，并在该快照上异步复核。Core 每轮只取一次两类证据，多轮工具请求仅重算装箱，晚到的 Formation 产物由后续轮次观察。当前会话删除刷新列表，即使 Reflection 索引仍缓存，缺失源也会在下一次复核被排除。`apps/stage-web/src/stores/stage.ts:106–159,540–554`，`apps/stage-web/src/runtime/memory-recall.ts:105–169`，`apps/stage-web/src/runtime/reflection-formation.ts:144–155,240–268`，`apps/stage-web/src/runtime/reflection-recall.ts:88–106,131–185`，`packages/core/src/runtime.ts:249–288,388–417`。

## 4. 关键文件与职责

| 层 | 文件与入口 |
| --- | --- |
| UI／Stage | `apps/stage-web/src/pages/settings/memory.vue:9–19` 开关。`apps/stage-web/src/stores/settings.ts:121–131` 保存开关。`apps/stage-web/src/stores/stage.ts:74–175,306–325,372–437,507–555` 调度、快照、交付、会话生命周期 |
| 存储接口 | `apps/stage-web/src/conversation/conversation-store.ts:30–39,84–211` 会话同步 CRUD 与兼容。`apps/stage-web/src/runtime/reflection-store.ts:1–88` Reflection 类型、验证及读改写。`apps/stage-web/src/storage/desktop-storage.ts:11–59` 后端选择与桥迁移 |
| Memory 算法 | `apps/stage-web/src/runtime/memory-recall.ts:25–169` 原始证据与 BM25。`apps/stage-web/src/runtime/reflection-formation.ts:28–135,138–354` 摘要、解析与 Formation 调度。`apps/stage-web/src/runtime/reflection-recall.ts:34–185` 候选复核与装箱 |
| Core／Provider | `packages/core/src/runtime.ts:75–98,137–185,235–315,388–421` 钩子、注入与聊天。`packages/core/src/context.ts:10–66,124–155` 消息元数据与上下文。`apps/stage-web/src/runtime/provider-factory.ts:24–63` Provider 与思考开关。`packages/core/src/providers/openai-compatible-provider.ts:126–155,334–343` HTTP |
| Desktop | `apps/stage-desktop/desktop-app.cjs:477–497,566–600` 宿主和启动。`apps/stage-desktop/preload.cjs:40–47` 与 `apps/stage-web/src/env.d.ts:5–25` bridge 与声明。`apps/stage-desktop/desktop-store.cjs:17–130` 文件与 IPC |

## 5. 数据库接入边界、风险与验证基线

**架构条件。** Desktop 已有具备 Node 文件访问能力的 Main、固定 userData 路径和隔离的 Renderer/Preload 边界，结构上具备在宿主接入嵌入式数据库的条件。仓库锁定 Electron 44.4.3，宿主使用 CJS 和 TypeScript `checkJs`，普通 Stage 仍是 Vue/Vite 浏览器入口。当前 prod 命令构建 Renderer 后由本地 Electron 启动，README 明确此路径无需安装器。锁文件和 Desktop 依赖未声明数据库接入，workspace 构建许可目前对 Electron 开放。若采用原生模块，实际限制包括 Electron 自带 Node 与宿主 Node 的区别、Windows 目标架构和 ABI、构建脚本许可、发布产物中的二进制加载及主进程阻塞。数据库绑定的可加载性、性能和发行形态仍待实机验证。`apps/stage-desktop/package.json:1–17`，`pnpm-lock.yaml:1028,2198`，`pnpm-workspace.yaml:1–11`，`scripts/dev-desktop.mjs:129–145,172–184`，`README.md:137–168`。

| 改动边界 | 必须处理的契约与可保留部分 |
| --- | --- |
| Desktop 仅替换物理存储且保留同步端口、数据形状和错误语义 | 宿主存储实现、初始化与兼容读取边界必变。保留现有 IPC 时，Preload、TS bridge、Stage、ConversationStore、ReflectionStore 与 Core 可继续使用现有调用。此边界仍保留整状态读改写、序列化及同步阻塞，单靠文件格式变化无法消除这些瓶颈。 |
| 改用实体级查询／事务，或将 IPC 异步化 | `desktop-store.cjs`、Preload、`env.d.ts`、对应 Store 和调用方须调整。Stage 初始化、输入先保存再 Recall、交付后入队、切换和删除均依赖同步读取与刷新次序。Formation 的 `getSessions/store.read/update` 与 Reflection 索引刷新契约也会受影响。原始 Recall 钩子目前同步，若需要每轮等待异步查询，要在 Stage 取得提交快照，或调整 Core 钩子。Reflection 钩子已接受 Promise。 |
| 替换底层检索或来源定位 | Stage 检索层需要匹配新的查询结果与一致性边界。仍可保留原文筛选、时间／来源投影、Formation 解析与证据约束、Reflection 组合挑选、Core 的双源预算与 Provider 协议。若保持输入输出契约，Persona、工具、语音与桌面感知不因持久化替换而要求改写。 |
| 桌面与浏览器兼容 | 通用 KV 同时承载设置，Main 直接读配置和语言。只迁 Memory 时要保留这些读取及浏览器 localStorage 分流。引入异步或实体 API 后，还要核对 Stage／Store 测试和 Desktop smoke 中直接访问旧 JSON 键及 Reflection 文件的断言。 |

上表依据 `apps/stage-desktop/desktop-store.cjs:65–130`，`apps/stage-desktop/preload.cjs:40–47`，`apps/stage-web/src/conversation/conversation-store.ts:30–39,101–158`，`apps/stage-web/src/stores/stage.ts:78–159,314–325,372–437,507–555`，`apps/stage-web/src/runtime/reflection-formation.ts:138–164,224–268`，`packages/core/src/runtime.ts:75–91,388–417`，`apps/stage-desktop/prod-smoke.cjs:193–240,262–292`。

**按影响排序的迁移风险。**

1. **来源与删除语义。** 删除会话只更新 ConversationStore，不清理 Reflection、关联、批次或游标。无源条目继续占存储，并可作为 Formation 的既有候选，虽然 Reflection Recall 会排除。存量中实际已有缺源条目。若导入时要求全部来源外键有效，需要先明确缺源记录的处置，否则会拒绝整批或丢失历史。数据库还原消息时改变字段顺序、归一化行为、消息位置或自主元数据，都可能让摘要失配。应以旧读取路径的归一化输出核对来源，并保留时间未知、来源角色、现有 ID、关联和批次归属。`apps/stage-web/src/conversation/conversation-store.ts:48–82,194–201`，`apps/stage-web/src/stores/stage.ts:540–554`，`apps/stage-web/src/runtime/reflection-formation.ts:28–31,49–54,224–227`，`apps/stage-web/src/runtime/reflection-recall.ts:59–70,131–155`，`reports/reflection-recall-ab-test-2026-11-02/integrity-report.md:14–23,59–71`。
2. **提交、重试与一致性。** 当前会话保存和 Formation 入队是两个动作。交付落盘后、入队前退出会漏形成，启用时以末尾为进度不会自动补齐。请求前持久化 attempts，远端调用与本地提交之间退出会重复请求。成功路径把产物和批次完成写在同一 Reflection 快照。迁移需保留已完成零产物、失败与待处理的区别，并明确跨进程写者、会话删除与在途形成之间的可见性。`apps/stage-web/src/stores/stage.ts:428–437`，`apps/stage-web/src/runtime/reflection-formation.ts:228–268,289–345`。
3. **容量和延迟。** 全量会话读写与无界累积的批次、进度、Reflection 会放大同步阻塞。原始 Recall 到扫描上限会丢弃整次结果，Reflection Recall 的 shortlist 限制只约束复核量，排名仍遍历全索引。数据库若仅充当 JSON 容器，仍会遇到这些边界。若转向数据库内检索，需要验证中文词项、整会话证据、追问锚定和预算降级的行为差异。当前没有本地库规模或延迟测量足以给出更换阈值。`apps/stage-web/src/runtime/memory-recall.ts:76–86,106–169`，`apps/stage-web/src/runtime/reflection-recall.ts:59–74,109–130`，`apps/stage-web/src/runtime/reflection-store.ts:67–85`。
4. **输入、隐私和错误可诊断性。** 导入需区分键不存在、文件不可读、格式损坏、未来版本、容量错误和缺失来源。备份通用 KV 时会连带配置凭据。若扩大 IPC 能力，需重新核对允许调用的 frame、数据范围和校验位置。当前日志／诊断保留固定失败分类和元数据的做法可延续。`apps/stage-desktop/desktop-store.cjs:65–130`，`apps/stage-desktop/desktop-app.cjs:595–605`，`apps/stage-web/src/runtime/reflection-formation.ts:127–135,210–221,270–281`。

**验证基线。** 本次运行 `node --test apps/stage-desktop/desktop-store.test.cjs`，5/5 通过，测试以模拟 fs 和 IPC 核对写失败、损坏保护与分文件。源码中的现有覆盖还包括会话迁移及写失败后恢复、Formation 来源变更与重启、Reflection 缓存后的源失效、Core 在同轮工具／流式调用中的快照和预算，以及 built Desktop 的 mock Provider smoke。既有真实实验报告记录了 Formation 联机提交和单独的整响应回放，也记录了 Recall A/C 主实验 30 次及追加 2 次，合成语料 40 条 Reflection 中 38 条来源完整。缺源候选曾被实际拦截。证据支持链路可工作和特定题型的收益，普遍回答增益仍未验证。`apps/stage-desktop/desktop-store.test.cjs:7–99`，`apps/stage-web/src/stores/stage-persistence.test.ts:66–103`，`apps/stage-web/src/runtime/reflection-formation.test.ts:293–322`，`apps/stage-web/src/runtime/reflection-recall.test.ts:39–69`，`packages/core/src/runtime-reflection.test.ts:61–106`，`apps/stage-desktop/prod-smoke.cjs:172–240`，`docs/formation-ab-results.md:5–23,57–71`，`reports/reflection-recall-ab-test-2026-11-02/README.md:3–25,43–45`。

## 6. 最小 Note 模型需要先明确的问题

1. **身份和来源。** Note 是既有 Reflection 的延续、独立实体，还是还允许用户直接创建？哪些 ID 必须跨导入与修订稳定？来源是否继续定位旧消息位置，或需要稳定消息 ID？已有摘要如何保留可验证性？`apps/stage-web/src/runtime/reflection-store.ts:3–15`，`apps/stage-web/src/runtime/reflection-formation.ts:28–31`。
2. **来源缺失与删除。** 删原会话、编辑消息或撤回授权时，对 Note、来源、相邻关系、批次和索引分别应发生什么？哪些内容必须可实际清除，哪些可以留作不可注入的历史？当前缺源规则只在召回时复核。`apps/stage-web/src/stores/stage.ts:540–554`，`apps/stage-web/src/runtime/reflection-recall.ts:135–155`。
3. **关系语义。** 当前的「实质相关」链接是否够用？若要表达支持、冲突、取代或衍生，方向、作者、证据与历史如何解释？关系是给模型参考，还是参与检索及失效判定？`apps/stage-web/src/runtime/reflection-formation.ts:64–69,109–114,260–268`。
4. **版本与状态。** 格式版本、内容修订、有效性和 Formation 工作状态需要分别定义。新的项目状态与旧状态并存时，系统如何区分两次观测和一次修订？是否需要把「形成时间、发言时间、事件发生时间、适用时间」分别保留？`apps/stage-web/src/runtime/reflection-store.ts:4–31`，`packages/core/src/runtime.ts:151–159`。
5. **证据与读取资格。** 哪些类别允许人工录入、允许无来源或引用派生内容？如何保留 `basis` 与 `uncertainty` 的语义？未来 Note 是否仍通过批次归属获得可召回资格，及对来源完整但互相矛盾的条目如何表述？`apps/stage-web/src/runtime/reflection-formation.ts:109–124`，`apps/stage-web/src/runtime/reflection-recall.ts:59–70,152–160`。
6. **一致性和平台范围。** 需要支持多少写者、哪些数据应一起提交、已开始的聊天可以看到哪个快照？浏览器是否需要 Note 持久化，还是只维持现有原始 Recall？这些决定直接影响存储端口、缓存失效和迁移后的兼容契约。`apps/stage-web/src/runtime/reflection-store.ts:67–87`，`apps/stage-web/src/stores/stage.ts:106–159`，`apps/stage-web/src/storage/desktop-storage.ts:53–59`。

本次核对了当前源码、既有覆盖和上述 Desktop Store 单测。实际用户 profile 的规模、坏数据比例、多实例竞争、Windows 断电恢复、真实 Electron 数据库绑定及发行包行为仍待验证。本次未重跑 Web/Core 全量测试、Electron UI smoke 或联网实验。
