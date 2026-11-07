# P1.8 Memory 基线审计

审查日期 2026-11-07。基线为 `main` 的 `f79ff82` 加工作树中 P0–P1.7 的未提交成果。审计阶段只读取工程源码，并以隔离测试运行验证。当前目标是跨会话的经历连续性、独立认识和可修正性。

## 高严重度

- **Note 尚无主回复读取路径。** Stage 只向 Core 提供 Conversation 和 Reflection；Main 的组织候选用于异步 Formation。读取须从当前 Note 头和对应 Revision 取依据，检查 active、Origin、当前消息摘要和删除屏障。NOOP 的补证记录不能替代版本主依据。读取结果需要在删除、写入、重新开启和异步返回时防止过期快照复用。
- **SHA-256 证明引用位置的消息身份，语义和动作另需约束。** P1.7 的 Main 校验完整说话人前缀、单条原话和角色绑定，可靠保存的是归属明确的发言事件。用同一依据自动提交任意转述会重新引入 P1.5 的取代、时态和撤回错误。项目、设备等主体仍无可信身份绑定。应先对照验证窄范围自述，保留无法机械确认的语义和 UPDATE、SUPERSEDE、RETRACT 待审。
- **保留删除与版本安全。** 原始消息索引与摘要、持久删除意图、按来源清理当前及历史版本、删除重放屏障、Worker 单写事务、期望版本和稳定 Receipt 都各有故障场景。涉及原文、Origin、上下文派生或共享来源的删除仍应清理整条相关认识。真实磁盘擦除、整份 profile 回滚、多实例竞争仍未验证。

## 中严重度

- **同一说话人只能有一条自动新增发言的实际瓶颈。** `speakerQualification` 只接收逐字事件，`settle` 对同 subject 的任何历史拦截 ADD。两条独立自述也会进入待审。Note v1 本身可以保存独立 content、subject、basis、eventTime 和 uncertainty，瓶颈在提取与提交策略。后续以可验证事实范围约束去重和冲突，不能以字符串不同断言独立。
- **现有候选截断只适用于保守写入。** Main 使用每页 8 条、最多 32 页，超限返回 incomplete 并阻止新增，属于显式保守决策。读取若照抄前 256 条，会因 UUID 排序漏掉任意有关事实。可以复用游标、构造进程内有界快照，超出规模时明确降级，并单独验证失效和读取延迟。
- **三种证据可重复，当前只有两路预算竞争。** 逐字 Note 和 C Reflection 的内容相同，Conversation 还可能携带同一句原话。C 使用一次 `provider.chat` 同时输出 Reflection 和组织项，经本地解析、持久化和 Main 事务处理。未见每轮固定的第二次组织 LLM。重复发生在持久表示和潜在注入。应优先合并同 Origin 或可证明等价的证据，保留引文与推断标注。共同来源能支持多个独立事实，不能单凭消息位置粗暴去重。
- **Reflection 的独立职责仍存在。** 既有 Reflection Recall 保存跨消息的归纳、体验与未决认识，Note v1 用于单条认识及演进。可删除的是将同一已提交 C 产物再注入一份的行为。当前 Reflection ID 同时承担来源与派生删除，直接去掉 C Reflection 持久记录会破坏删除闭包及恢复。应先确认 Note Recall 对照，再评估是否收敛为较小的来源表示。

## 低严重度与待验假设

- P0 的 DB 入口和旧协议有专门的隔离测试，生产 Organization 使用独立 v1 数据库。实验专用的 P0 能力可以在确认没有实际使用方后移出生产启动路径，当前保留回归和旧隔离 profile。
- SubjectAnchor 将标注和身份分开，适用于已有受信身份。P1.3/P1.5 实验中的主体为人工标注，不能外推到正式实体解析。Note 的 RELATED 边可表达关联，Revision 可区分纠正、取代和撤回，但两者的召回增益尚未建立。Activation 访问计数、联想传播与主动图遍历留待有端到端收益数据后决定。
- 现有阶段验证以隔离资料为主。P1.7 实验报告的一次真实 C 调用使用 1,624 Token，聊天回复为 Mock。P1.5 的 24 组旧场景中 B、C 各 21 次动作/目标正确，新场景为 10/12、9/12。两者都出现过严重误取代。C 的主对照约用 B 的 49% Token，支持保留一次调用做候选，不能据此开放 Evolution。原始 Recall 的扫描时限、反思注入后的回答增益、真实话语的纠正和跨会话生命周期仍需重测。

## 研究交叉核查

- A-Mem 论文实验将 Note 构造、关联、演化和检索分开。开源 `add_note` 在写入期处理演化，`find_related_memories` 从 Chroma 取候选。Aisling 可借鉴独立语义单元及写读分离，保留自己的来源事务和版本历史。 [论文](https://arxiv.org/abs/2502.12110) · [源码](https://github.com/agiresearch/A-mem/blob/main/agentic_memory/memory_system.py)
- Mem0 论文报告了抽取与记忆更新的 LoCoMo 对照。开源 `Memory` 有独立 add/search、向量记录与 SQLite 历史，更新路径记录前后值。可借鉴对重复和历史分别处理。Aisling 的证据摘要和撤回屏障仍需本地验证。 [论文](https://arxiv.org/abs/2504.19413) · [源码](https://github.com/mem0ai/mem0/blob/main/mem0/memory/main.py)
- Graphiti 源码把 episode 与事实边连接，边解析处理重复和时效，检索提供多路排序与 RRF。可借鉴事实失效与原始证据留存的区分。Aisling 当前的 `createdAt` 和 `eventTime` 不能推导通用有效区间。 [边处理](https://github.com/getzep/graphiti/blob/main/graphiti_core/utils/maintenance/edge_operations.py) · [检索源码](https://github.com/getzep/graphiti/blob/main/graphiti_core/search/search.py)
- Hindsight 对外把 retain、recall、reflect 分开，检索文档说明语义、关键词、图和时间融合，结果可附原始 chunk。可先验证 Aisling 的轻量词法筛选、来源复核和统一预算。外部论文或 API 的结果不能作为 Aisling 的效果测量。 [论文](https://arxiv.org/abs/2512.12818) · [官方检索设计](https://github.com/vectorize-io/hindsight/blob/main/skills/hindsight-docs/references/developer/retrieval.md) · [来源接口](https://github.com/vectorize-io/hindsight/blob/main/skills/hindsight-docs/references/developer/api/recall.md)

## Gate A 预提交范围

索引初始为空。跟踪修改集中于 Memory、相关 Provider 计量和 smoke；未跟踪的正式 Worker、组织模块、测试夹具、准备脚本和技术文档按清单纳入。保留未跟踪的 `reports/reflection-recall-ab-test-2026-11-02/`，其中包含完整交互和 Provider 响应快照，本次检查点只需要正式成果及总结。忽略规则已排除 `.local`、环境文件、依赖、构建、日志和 `artifacts`。对计划纳入的工作树文件检查了常见凭证模式、大文件和空白错误。检查点只在本地创建，SHA 记录在 P1.8 交付报告。
