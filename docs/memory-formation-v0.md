# Reflection Formation

Formation 从已交付并成功持久化的交互中，异步形成追加式 Reflection。它是可选的后台 LLM 请求，不在普通回复的等待链上。读取产物见 [Reflection Recall](reflection-recall.md)，有限真实模型验证见[研究记录](research/memory-validation.md)。

## 开关与处理范围

Settings → Memory 的主开关默认开启，Formation 子开关默认关闭。旧的明确 Memory opt-out 保持关闭。关闭主开关会保存 Formation 为关闭并丢弃在途形成结果；重新开启主开关不会自动恢复 Formation。只关闭 Formation 不影响读取已有合法产物。

首次启用从已有会话的当前末尾开始，不自动回填旧消息。文字回复与已交付自主发言只有在非空、最终核验通过并成功保存后登记；图片轮、失败／取消／空输出和本地模式命令不登记。

每个 Session 累计三个单元为一批：普通文字的用户输入和最终回复为一个单元，自主发言为一个单元。切换／新建会话可刷新不足三个单元的收集批次。批次仍只登记该 Session 的新交互；形成时可以参考其他 Session 的有界相关历史，不把它们登记为新单元。

登记准备串行执行，LLM 请求独立后台运行，同一 renderer 最多一个 Formation 请求。普通聊天、Session 切换和 Tool Loop 不等待该请求。

## 状态与资源边界

`collecting → pending → completed / failed`。零条 Reflection 也是合法完成；失败不自动重试。关闭会停止登记和调度，中止／丢弃在途结果，保留已保存产物和队列；再次启用恢复已登记队列，不补录关闭期间的历史。

| 限制 | 值 |
| --- | ---: |
| 每批来源 | 最多 12 条 |
| 证据 UTF-8 字节 | 最多 6000 |
| 总输入 UTF-8 字节 | 最多 15000 |
| 每批 Reflection | 0–3 条 |
| 形成请求输出 token 参数 | 1500 |
| 请求期限 | 45 秒 |

Formation 不执行工具。敏感／超限输入在本地拒绝；Provider 不可用时保留 pending，错误不影响普通回复。

当前已核实的 `qwen3.8-flash` + HTTPS 北京 workspace `/compatible-mode/v1` 路由，仅 Formation 请求显式设置 `enable_thinking:false`。1500 token 上限不变，不修改共享 Provider 或普通聊天策略；其他模型／端点保留原默认值。此接口的 `max_completion_tokens` 同时限制思考和正文，未关闭思考可能耗尽预算而返回空正文。没有新增公开设置或独立思考预算参数。

形成前，优先用当前批次的用户报告构造最多 3000 字符的本地查询；没有用户报告才使用已交付角色发言。复用原始 `retrieveRecall` 的 BM25、Top-5 Session、250000 字符／30 ms 扫描保护、敏感过滤及完整会话证据组。按相关性尝试把历史组装入当前批次剩余的 12 条来源／6000 字节证据／15000 字节总输入预算，不设额外跨 Session 数量，不截掉同组纠正。无匹配、读取失败、扫描超限或放不下时继续使用当前批次，不新增 Provider 请求。

历史补充现在限于模式支持：当前用户报告与被选历史会话都需包含尝试／目标及结果的词项，普通购买／兴趣状态不单独作为历史形成材料。仍按原 BM25 候选及整组预算选择，保留原消息；此轻量词项门槛可能漏掉措辞不同的经历，不能证明因果或独立性。`currentBatchSources` 列出本批主来源，非 pattern 只能使用这些来源；`relatedPatternSources` 仅允许作为与当前经历共同形成 pattern 的支持。不得为凑类别补写旧状态；模式只归纳共现现象，不把相关性写成确定因果。

E 证据区分 `current-batch` 与 `related-history`，复用原始 Recall 的会话标签、消息位置、角色、原文与时间投影。每条新 Reflection 必须引用至少一个当前来源，历史证据只作支持；批次 sourceRefs、units、progress 不因参考历史而变化。保存前回查全部输入证据的 SHA-256，包括历史来源；新 Reflection 的 sourceRefs 保存其实际引用的各 Session 原始位置和摘要。

请求额外列出 `currentBatchSources`，明确所有类别的 sources 都必须包含实际支持该条认识的当前来源；不能只摘录旧材料，也不能凑入无关的当前来源。此列表仅是请求期提示，不改变持久化 Schema 或来源校验。

## Schema、来源与提交

版本 1 的 Reflection 保存应用生成的 id、content、kind、basis、tags、sourceRefs、relatedReflectionIds、createdAt 和可选 uncertainty。正文最多 800 字符，标签 1–6 个且每个最多 40 字符，不确定性最多 300 字符。

kind 支持 event、fact、pattern、preference、project-state、open-question；basis 为 direct、inferred、mixed。推断／混合必须有不确定性；pattern 要求至少两个不同位置的用户来源及不确定性，单次用户陈述加角色复述不足。不同位置仍不自动证明是独立事件，语义上要求来源共同支持条件性认识，而非稳定人格。只依靠 assistant 发言不能形成用户事实、偏好或外部项目状态。

`direct` 且非 pattern 的记录不需要 uncertainty 时必须省略该字段；提供时必须是非空、非纯空白且不超过 300 字符的字符串。`null`、空字符串及其他类型仍会拒绝，不在解析层补写／转成合法值。所有 pattern 及 inferred／mixed 仍必须提供反映实际证据限制的 uncertainty。

形成目标分别强调事件的尝试与结果、多个经历共同支持的条件性模式、具有时间和范围的可变状态。允许零产物、保留反例／不确定性，不用频率证明人格，不把计划写成完成，也不抹掉过去兴趣。概括时保留原经历的具体主题标签，帮助后续跨经历问题找到它；不强制每批生成 pattern。

普通消息没有稳定 ID，来源复用 Session ID、消息位置和整条标准化消息 JSON 的 SHA-256。请求前、保存前分别回查；来源删除、改写或移位时拒绝，不重新猜测指向。新增消息的 createdAt 也是原记录的一部分，不给旧来源补时间。

模型只接收 E 标签原始证据与最多三个 R 标签候选。角色来源明确区分用户报告、角色发言和有自主依据的已交付发言；原始历史是不可信数据。旧 Reflection 候选只作去重／关联上下文，不能代替原始来源。

时间只表达消息创建／交付或粗略 Session 范围，不推测事件日期；缺失时保持未知。R 候选的 formedAt 只表示形成时间。以上 scope、时间及标签投影都是请求期元数据，版本 1 存储格式保持不变，不改写既有 Reflection。

每条模型输出必须提供 sources 和 related 数组，无关联时 related 必须是 []。解析器拒绝非法 JSON、额外字段、未提供的引用标签、不合规结构、内部标识和来源违规；任一记录无效则整批拒绝。不剥代码围栏、不修复 JSON、不回填必填字段，也不把来源校验当语义真实性证明。

只追加新记录及新记录到旧记录的关联，不修改旧 Reflection 或反向链接。合法产物与 completed 状态通过同一次提交保存。

## 文件与一致性

Electron 独立文件为 `userData/aisling-reflections.v1.json`，包含 reflections、progress、batches，最多 2 MB。沿用临时写入加 rename、版本与完整状态校验；读取失败／损坏状态不被空状态覆盖。不迁移持久化版本，不清理用户产物。

浏览器没有该独立文件桥接，启用会报告存储不可用，普通聊天继续。当前为单 renderer 写入者设计；交付保存与 Formation 登记不是跨文件事务，恰在两者之间崩溃可能漏登记，请求成功但提交前崩溃可能导致 pending 批次重发。不承诺外部请求 exactly-once。

## 开发检查与故障定位

在 Electron DevTools Console 中取得 Stage。每次调用 inspect 都重新读取；不要反复查看先前保存的快照变量来判断是否出现新批次。

```javascript
var pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
var stage = pinia._s.get('stage')
console.table(stage.formation.inspect().batches)
console.table(stage.formation.inspect().reflections)
stage.formationStatus
```

开发入口 `formation.flush()` 只等待登记和入队，不等待 LLM；完成与否看新批次的 status。`formation.retry(batchId)` 只处理已失败批次，需要 Formation 开启，会触发新的付费 Provider 请求；不要循环自动重试。

需要具体失败字段时，在失败发生前启用内存诊断：

```javascript
stage.formation.setDiagnosticsEnabled(true)
// 等待自然发生的失败后查看：
stage.formation.diagnostics.lastFailure
stage.formation.setDiagnosticsEnabled(false)
```

诊断只保存最近一次失败的固定阶段／原因、字段、来源序号和安全响应元数据。没有原始正文、Prompt、原始 JSON 错误或密钥；关闭清除，重启丢失。历史通用 invalid-output 无法倒推出具体失败字段。

`source-changed` 检查来源，`input-limit` 检查敏感／长度边界，`provider-error` 检查请求可用性；`storage-error` 检查文件提交。不得为通过验收而放宽来源或输出校验。

2026-10-28 五批连续失败的原始响应核对、最小修复及仍未通过的单批真实复验见[故障报告](formation-failure-analysis.md)。
