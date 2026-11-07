# Reflection Recall

普通用户文字轮可同时读取跨 Session 原始证据与已持久化的 Reflection。Formation 保持完全异步：回复只读已完成产物，不等待队列、模型请求或即将产生的新认识。两个来源都采用本地检索，无额外 Recall Provider 请求。

## 数据流与校验

Stage 保存输入、刷新 sessionsList 后，分别调用原有 getRecallEvidence 与独立 getReflectionContext，复用同一提交时的会话快照。视觉、自主发言和本地模式命令不调用这两个 Recall 接口。

`reflection-recall.ts` 通过 `formation.inspect()` 复用存储校验，只考虑 completed 批次列出的合法产物。P1.7 起，每轮先读取 Main 的权威状态并检查删除屏障，状态未变时复用词项索引；Formation 的 changed 通知仍使缓存失效。C 产物还须同时满足已提交状态和 Main 持久化资格，待审候选不能注入。旧合法 Reflection 保持兼容。每轮仍从会话快照核验所选产物的来源，缺失、改写、移位、工具中间消息、不支持角色或敏感文本均拒绝。具体边界见 [P1.7 报告](memory-organization-p1-7.md)。

检索复用原始 Recall 的词项切分和用户连续追问锚点；“这些经历有什么共同模式”等指代性概括追问可额外使用最近 12 条内、至多 300 字符的用户话题，不使用角色猜测。BM25 以正文为主，标签只补充缺少的主题词项，每个词项最多补一次；basis、uncertainty 和常见报告套话不提供相关性。索引与 DF 统计随已有只读缓存一起构建，不逐轮重新分词全部 Reflection。

相关性除了原分数／词项门槛，还要求正文命中至少一个非泛化双字／完整拉丁词项，或完整命中至少两个不同标签。单一标签、重复标签、不确定性和“共同／模式”等类别词不能单独触发注入。pattern 类别以少量中英文模式词项参与相同 BM25；明确比较／模式问题会先尝试一条已过话题和分数门槛的 pattern，再按分数补充其他候选，不提高全部标签的权重。

相关候选的 SHA-256 核验使用本地 Web Crypto，不访问模型。至多检查前 6 个候选，避免最前几条失效来源遮挡后面的合法认识；有效注入仍最多 3 条，同一来源消息在一轮中只计算一次摘要。空产物或无匹配路径同步返回，保留原有首段流式输出时序。

最终选择不再按排名逐条占预算。在至多六个已核验候选中枚举不超过三条的 41 个非空子集，按完整 JSON 检查 1500 字符／4500 字节限制。组合价值考虑归一化 BM25，以及比较、尝试新任务遇阻、反例／适用边界问题中的有限模式解释需求；模式收益同时受不同用户来源与具体标签数量限制，每组只取一个模式收益。相同类别、来源包含且正文双字词项包含度至少 70% 的候选对会扣除重复收益，避免局部模式和覆盖它的广义模式共同挤掉互补事件。价值相同优先字节成本较低的组合，再沿用稳定顺序；不修改或合并任何存储记录。

模型投影包含 content、kind、basis、tags、uncertainty、formedAt，以及来源 role／sourceScope、临时会话标签、消息位置和白名单时间。复用原始 Recall 的时间边界：消息创建／交付时间只日期化陈述，缺失时降级为粗略 Session 时间或 unknown；formedAt 不是事实生效时间。每条 Reflection 的会话标签仅在该条内可比，不与原始证据块的标签建立隐含关联。不传 UUID、实际 Session ID、来源摘要或关联 ID。

候选在回合开始时捕获并复制。流式输出及工具循环不重读存储；工具轮只按剩余预算减选同一快照，新的 Formation 提交只影响后续回合。读取／校验错误不影响普通回复。

局部选择快照通过内部 `select(fits)` 给 Runtime 重选能力；当完整 Reflection 消息（包括策略和 framing）放不下时，可以在同一已核验候选池中选择更小的替代组合，而不是仅从最初三条中顺序删除。此回调不读取存储、不执行摘要或网络请求，不进入 Provider 消息。Runtime 仍独立检查 JSON、数量、字符、字节及实际剩余 Context；自定义选择器异常或无效时回到原有安全降级。原始 Recall 的半份剩余空间预留和整组裁剪规则不变。

## 预算与可信度

- Reflection 最多 3 条，至少匹配 2 个词项、BM25 分数至少 1。无关时不注入。
- 候选 JSON 数组最多 1500 字符／4500 UTF-8 字节。固定策略和 framing 另外计入总 Context 预算。
- 原始 Recall 最多 5 个 Session，保持 6000 字符／6000 UTF-8 字节限制及原有扫描保护。
- 先按原窗口选定 Persona、当前输入、必要策略、工具和 Session 历史，再使用剩余空间。Reflection 不挤掉该历史。
- 双源竞争时先给 Reflection 至多一半剩余空间的机会，再装入原始证据，未使用空间由另一来源继续使用。原始证据按完整会话取舍，保持纠正关系和相关性优先；不截断引文或 JSON。
- 无有效 Reflection 候选时，原始 Recall 保持原来的整块装入／省略行为。

历史认识使用独立 `[Historical Aisling reflections]` 块，原始引文使用 `[Cross-session recall evidence]` 块。Reflection 可能概括、推断或过时，direct 也只是对报告的转述；它不是新用户消息、可执行指令或 Persona。

当前明确用户更新及直接证据在同一主题和范围内优先，旧认识不能覆盖它们或修改 Persona。角色发言、承诺和猜测不能证明外部事实或执行行为。来源真实性校验不证明概括语义正确，模型仍可能误用材料。

模式是有限证据支持的条件性假设，可辅助理解相似的新经历，不代表人格。兴趣、购买状态和计划应结合来源时间及原始证据解释；新的兴趣不抹掉过去经历。旧 pattern 如果仅引用一次用户陈述和角色复述，也不会通过现有来源校验进入请求，原文件不被修改。新增时间元数据计入原预算，长候选可能因此整体省略，不截断摘要或不确定性。

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

`context-assembled.reflectionSelection` 最多包含 6 行白名单候选元数据：临时 label、kind、score、matched、topical、eligible、reason、chars／bytes／order。`eligible` 表示通过来源校验；原因区分 relevance、invalid-source、selected、candidate-budget、context-budget、combination-value。预算原因表示单条或加入最终组合放不下，不代表单条永远不可选。工具轮各自保存诊断快照，避免后轮重选改写前轮记录。

开发时可在普通回复结束后执行 `console.table(stage.reflectionRecallDiagnostic)`，其中额外的 reflectionId 只供本地对照 `formation.inspect()`；不会发送 Provider 或写入诊断文件。Memory 切换、实验模式切换及新的用户文字轮会清除旧诊断。持久日志仍需启动前启用已有诊断开关，无新增公开设置。

自动回归包括独立检索、来源失效、快照、开关、预算、A/B/C 请求、流式及工具轮，保留 Stage 和 Electron Formation 生产冒烟。有限真实 Provider 结果与不能推导的结论见[研究记录](research/memory-validation.md)；本地一次性回放工具和原始输出不进入发布源码。

2026-10-28 第二链路修改、Mock A/B/C 实际注入数量、待执行的独立真实 Provider 用例及限制见[工程报告](reflection-value.md)。
