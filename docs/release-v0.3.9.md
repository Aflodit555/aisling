# Aisling v0.3.9 — Memory 第一轮工程基线

2026-11-12。收录 P0–P7.1 的累计工程成果，发布源码与 Git Tag；不创建安装包或 GitHub Release 页面。后续真实体验优化属于计划中的 v0.4.0，本轮没有提前实施。

## 纳入的能力

- **Note-only Memory v2**：新建与验证迁移后的 Desktop Profile 使用唯一结构化记忆权威；原始消息仍在 ConversationStore。Evidence、Revision、Receipt、稳定操作ID、持久删除屏障和崩溃恢复保留来源可追溯性。
- **Autonomous Organization**：Formation 复用已配置 Provider 异步提出认识和受限生命周期操作；Main 重验来源、主体和目标版本，不确定提议留待审核。关闭 Formation 不删除已有认识。
- **Note Network**：保留纵向状态变化、过程延续、补充、未解决冲突以及横向 ASSOCIATED_WITH。横向关系是带不确定性的回忆导航，不是事实支持；修订、撤回和删源使相关边失效或清理。
- **Embedding / HNSW / 混合检索**：Memory 页配置 DashScope Native 向量和专用或复用凭据；固定 Windows Worker 支持 HNSW，缺少扩展的新库可使用有界 exact 回退。BM25、metadata 与向量名次通过 RRF 融合，不因相似度直接建边。
- **Associative Recall**：直接命中优先，最多两跳有界扩展，Main 与 Renderer 复验来源/版本；最终仍受三条 Note、2000字符和 Core 剩余预算限制，当前 Context 优先。
- **工程稳定性**：Vite / 构建版权威一致、开发 Profile 隔离、受信 IPC、Worker 资源完整性与刷新；保留启动空白页修复，修正隐藏窗口的 UI 烟测停帧。旧 Reflection/v1 继续服务兼容、迁移和历史擦除。

## 必须保留的限制

工程闭环通过不等于模型判断或回答收益通过。P7.1 原始 C 组无有效图，B/C 向量降级与冷热条件不同；追加2条允许关联的小样本、随后Mock回放，不能证明一般准确率、抗误导能力、横向召回或最终回答收益。没有修正后真实回答复验，详见 [P7.1](memory-p7-1-validation.md)。

已有持久 HNSW 索引依赖固定原生库；依赖丢失/损坏时写入或删除可能被拒绝，不能承诺无损回退，应恢复完整资源并维持删除屏障。2048-head候选/精确向量、4MB快照、2MB作业文件及有限任务账本仍限制长期大库；未完成长期负载和真实Profile全面验收。

凭据沿用项目本地配置存储，不提供加密凭据库承诺；“已配置”不表示联网鉴权成功。未完成安装包、签名、升级卸载及第三方原生依赖再分发验收。数据库 Schema、协议和第三方依赖版本均不因 v0.3.9 机械升级。

## 使用与验证

日常启动和 Worker 准备见 [README](../README.md) 与 [运行时一致性](memory-development-runtime-alignment.md)。本轮实际验证、Git 合并和发布结果以 [v0.3.9 验证报告](release-v0.3.9-validation.md) 为准；历史阶段测试计数不替代当前验收。
