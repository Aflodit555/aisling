# Formation 失败定位与最小修复（2026-10-28）

后续已恢复有效产物并完成新的 33 次真实对照，见 [Formation 与 A/B/C 最终结果](formation-ab-results.md)。下文保留当时失败证据与结论，不把后续结果倒写成原实验成功。

**验收仍失败：有效持久化 Reflection 为 0，不能恢复 A/B/C。** 已修复 uncertainty 提示契约和当前路由 thinking 请求遗漏；一次真实复验又被当前来源约束拒绝，没有绕过校验或拆批保存。

## 五批真实证据

基线目录：`.local/real-memory-eval/run-20261028-yaklwP/`。results.json 保存实际请求、响应信封／正文、usage、诊断和冻结快照；verification.json 保存核验结果。五批均为 qwen3.8-flash，北京 workspace OpenAI 兼容接口，HTTP 200；实际请求均为 stream=false、temperature=0.2、max_completion_tokens=1500，未发送 enable_thinking、thinking_budget 或 reasoning_effort。

| 批次 | 正文字符 | finish_reason | prompt / completion / reasoning tokens | 首个拒绝点 | 保存数 |
| --- | ---: | --- | --- | --- | ---: |
| 旧状态 | 335 | stop | 933 / 319 / 179 | 第 0 条 project-state 的 uncertainty 为原始空字符串 | 0 |
| 手碟 A | 0 | length | 1182 / 1500 / 1500 | 原始 content 为空，json-parse / empty-content | 0 |
| 手碟 B | 676 | stop | 1425 / 1445 / 1155 | 第 0 条 event 的 uncertainty 为空；整批拒绝，后面的手碟 pattern 也未保存 | 0 |
| 绘画 | 0 | length | 1665 / 1500 / 1500 | 原始 content 为空，json-parse / empty-content | 0 |
| 最新状态 | 883 | stop | 1935 / 1321 / 923 | 第 0 条 project-state 的 uncertainty 为空 | 0 |

三次字段错误均是原始 JSON 的 `uncertainty:""`，不是缺失、null 或解析层转换。生产适配器及 parseReflections 离线重放逐字得到同一正文，并重现五批的阶段、字段和原因；字段错误均为 reflection-validation / uncertainty / invalid-value。

最新状态批次还有被前一错误掩盖的问题：跨经历 pattern 仅引用 E5/E7/E9，全部是 related-history，没有当前来源；即使修正第一条字段也不能直接保存。十条批次来源在冻结 Session 上重新计算 SHA-256 均相符。五批在提交产物前被拒绝，未发现持久化写入故障；不能声称失败批次已完成保存前的二次来源核验。

证据缺口：基线保留响应正文、ID、finish_reason、usage，但未保存逐字节 HTTP 报文／响应头；导出时 reasoning_content 长文已省略，只留长度。普通流式回答未收集完整 usage，不推算总费用。两次 reasoning_tokens=1500、正文为空和 length 足以支持预算耗尽判断，不能据此解释模型内部推理动机。

## 最小修改

- reflection-formation.ts：direct 非 pattern 不需要 uncertainty 时明确省略；提供时必须非空，inferred／mixed／pattern 必填。校验器和 Schema 不变，不转空值、不补写。接入请求级 thinking 策略。
- provider-factory.ts、stores/stage.ts：仅已核实的 qwen3.8-flash + HTTPS 北京 workspace `/compatible-mode/v1` 路由在 Formation 请求发送 enable_thinking=false。保持 1500 token、45 秒、普通聊天、共享 Provider 和保存设置不变，其他路由保留默认。
- 针对来源违规，最终请求增加 currentBatchSources 标签列表，强调每一种类别都须有实际支持该条认识的当前来源；不允许凑入无关引用。仅为提示期元数据，不改产物、批次或来源校验。这项最后补充仅通过离线回归，尚未再真实验证。
- 对应 formation、history、thinking-policy 和 Stage 测试新增 6 项，扩展空正文／字段类型／来源拒绝／原子性／合法 Mock 回读用例。更新 memory-formation-v0.md；没有修改 Recall 选择器或版本号。

官方说明 qwen3.8-flash 默认开启思考；max_completion_tokens 同时限制思考与正文，HTTP 顶层 enable_thinking=false 可关闭思考。[参数说明](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)、[思考模式](https://help.aliyun.com/zh/model-studio/deep-thinking)。未盲目提高上限或引入独立预算接口。

## 真实单批复验：仍未通过

目录：`.local/formation-failure-analysis/controlled-ez4J2S/`。新隔离副本保留绘画批次及当时可见的四个原始 Session；内容、ID、时间和摘要不变。发送前断言 evidence 与原绘画请求完全相同，只允许一次模型 POST。

请求的 model、temperature、stream 和 1500 上限不变，新增 enable_thinking=false。响应 HTTP 200、stop，正文 780 字符，prompt_tokens=1738、completion_tokens=323，没有 reasoning_content，诊断 reasoningChars=0；没有再输出空 uncertainty。

第 0 条 pattern 引用当前绘画 E1 及两次手碟用户报告 E3/E5，有明确 uncertainty。引用对应三段真实合成经历，未使用角色玩笑作为事实；但“会导致拖延”的因果措辞仍偏强。第 1 条购买 project-state 仅引用旧 E7，不含当前来源。生产解析器在 reference-label / sources / current-batch-source-required / reflectionIndex=1 拒绝整批。文件回读仍为零，未到产物提交步骤。

只为定位，在内存中单独解析第 0 条可通过结构和引用要求；没有保存它，也没有将整批标成功。真实的生成→解析→校验→来源复核→持久化→新 Store 回读闭环未通过；完整闭环目前只有 Mock 回归通过。

另保留 controlled-6ZSS3p 的脚本启动失败：拦截器误把 OPTIONS 计入请求上限，浏览器预检被阻断，无 HTTP 响应。离线修正计数后才取得上述一次 Provider 响应；没有继续重试。客户端记录不能替代供应端计费凭据。

## 验证与下一步

最终全量 Core 109／109、Web 376／376、桌面 31／31；pnpm typecheck、pnpm build 和 git diff --check 通过。构建保留原有大 chunk 提示。另有 1 项只读捕获响应重放，不计入正式数量。原实验和旧 profile 文件 SHA-256 前后相同，其他失败批次未自动重试，工作区既有改动保留，没有提交或推送。

已证实 thinking 和空字段的失败机制；尚未证明最终来源提示能稳定约束模型，也未证明跨经历因果或 Reflection 的增量价值。先在后续获准的单批真实验证中取得整批合法、来源完整、成功落盘并从新 Store 回读的产物，再恢复 A/B/C。当前原 33 次回答仍只体现原始 Recall／无记忆行为，不能归因于 Reflection。
