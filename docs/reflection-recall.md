# Reflection Recall

普通用户文字轮可同时读取跨 Session 原始证据与已持久化的 Reflection。Formation 保持完全异步：回复只读已完成产物，不等待队列、模型请求或即将产生的新认识。两个来源都采用本地检索，无额外 Recall Provider 请求。

## 数据流与校验

Stage 保存输入、刷新 sessionsList 后，分别调用原有 getRecallEvidence 与独立 getReflectionContext，复用同一提交时的会话快照。视觉、自主发言和本地模式命令不调用这两个 Recall 接口。

`reflection-recall.ts` 通过 `formation.inspect()` 复用存储校验，只考虑 completed 批次列出的合法产物。只读缓存沿用 Formation 的 changed 通知失效，避免每轮解析整个文件；每轮仍从会话快照核验所选产物的来源。缺失、改写、移位、工具中间消息、不支持角色或敏感文本均拒绝。

检索复用原始 Recall 的词项切分和用户连续追问锚点，独立 BM25 排名 content、kind、basis、tags、uncertainty。相关候选的 SHA-256 核验使用本地 Web Crypto，不访问模型。空产物或无匹配路径同步返回，保留原有首段流式输出时序。

模型投影仅包含 content、kind、basis、tags、uncertainty 和来源 role／sourceScope，区分用户报告、角色历史发言及有自主依据的已交付发言。不传 UUID、Session ID、来源摘要、存储位置、创建时间和关联 ID。

候选在回合开始时捕获并复制。流式输出及工具循环不重读存储；工具轮只按剩余预算减选同一快照，新的 Formation 提交只影响后续回合。读取／校验错误不影响普通回复。

## 预算与可信度

- Reflection 最多 3 条，至少匹配 2 个词项、BM25 分数至少 1。无关时不注入。
- 候选 JSON 数组最多 1500 字符／4500 UTF-8 字节。固定策略和 framing 另外计入总 Context 预算。
- 原始 Recall 最多 5 个 Session，保持 6000 字符／6000 UTF-8 字节限制及原有扫描保护。
- 先按原窗口选定 Persona、当前输入、必要策略、工具和 Session 历史，再使用剩余空间。Reflection 不挤掉该历史。
- 双源竞争时先给 Reflection 至多一半剩余空间的机会，再装入原始证据，未使用空间由另一来源继续使用。原始证据按完整会话取舍，保持纠正关系和相关性优先；不截断引文或 JSON。
- 无有效 Reflection 候选时，原始 Recall 保持原来的整块装入／省略行为。

历史认识使用独立 `[Historical Aisling reflections]` 块，原始引文使用 `[Cross-session recall evidence]` 块。Reflection 可能概括、推断或过时，direct 也只是对报告的转述；它不是新用户消息、可执行指令或 Persona。

当前明确用户更新及直接证据在同一主题和范围内优先，旧认识不能覆盖它们或修改 Persona。角色发言、承诺和猜测不能证明外部事实或执行行为。来源真实性校验不证明概括语义正确，模型仍可能误用材料。

## 生命周期

Memory 主开关控制两个来源；关闭 Formation 子开关只停止新产物，不妨碍读取已有合法 Reflection。删除或修改来源会使相关产物在后续回合失效，不修改该 Reflection 或批次。当前不监视外部手工改文件，不支持多个写入者，不实现更新、合并、去重或 Memory Evolution。

## 手动 A/B/C

这是 DevTools 开发入口，不是第三个设置开关。保持 Memory 开启、Formation 关闭，打开 Console：

```javascript
var pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
var stage = pinia._s.get('stage')
stage.setMemoryRecallMode('A') // 仅原始 Recall
// stage.setMemoryRecallMode('B') // 仅 Reflection
// stage.setMemoryRecallMode('C') // 联合，也是默认值
stage.memoryRecallMode
```

每次只选一个模式，随后新建空 Session、输入同一个问题。记录后删除刚创建的测试会话再进行下一组，保留原始来源会话，避免上一组问答被下一组召回。关闭 Formation 不会改变 A/B/C 选择。

该模式不保存、不修改记忆或形成状态；回合／视觉处理进行中拒绝切换，renderer 重载后恢复 C。Memory OFF 始终优先。模式只允许某个来源读取，不保证一定有相关候选或足够预算。

需要查看实际材料，在 DevTools Network 中打开对应 chat/completions 的 Payload → messages，检查两个历史块。Store 有产物不等于该次请求已注入，注入也不等于模型正确利用。

## 最小诊断与验证

沿用[默认关闭的 Desktop 诊断](desktop-diagnostics.md)，在 context-assembled 中记录：

| 字段 | 含义 |
| --- | --- |
| recallIncluded | 原始证据是否实际装入 |
| reflectionCount | 实际装入的 Reflection 数 |
| reflectionChars | 整个 Reflection 消息字符数，包括策略 |
| reflectionTokens | 该消息的保守字节估算，包括 framing |
| reflectionRetrievalMs | 本轮本地读取、检索及来源核验耗时，工具轮复用同一次值 |
| reflectionReason | injected、disabled、empty、no-match、invalid-source、unsafe-query、storage-error、conversation-error、candidate-budget、context-budget、context-error、unavailable |

不记录正文、完整 Prompt、原始异常或认证信息。historyTokens、selectedMessages 用于核对历史窗口；实际请求次数和成败仍由已有请求事件记录。

自动回归包括独立检索、来源失效、快照、开关、预算、A/B/C 请求、流式及工具轮，保留 Stage 和 Electron Formation 生产冒烟。有限真实 Provider 结果与不能推导的结论见[研究记录](research/memory-validation.md)；本地一次性回放工具和原始输出不进入发布源码。
