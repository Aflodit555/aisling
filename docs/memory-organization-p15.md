# Memory Organization P1.5 工程记录

2026-11-06。仅修复 Reflection Recall 已验证来源后的编号过滤：与 P1.4 Formation 一致，允许实际引用且 SHA-256 验证通过的原文编号 R8/R3/E2。未引用消息不能授权正文编号；内部来源、关系和身份字段仍按原协议处理，正文不授予引用权。新增回归覆盖真实编号、伪造和未引用编号、来源变更。

改动为 reflection-recall.ts、其测试和本文。NoteDraft、Formation 提示词和异步生命周期、原始 Recall、Context、Persona、TTS、Note v1 Schema/Worker/Store/事务与版本号保持不变。生产行为仅扩大对有来源真实编号的保真召回；未添加自动 Note 写入入口。

共同 OrganizationProposal、语义操作说明、Origin 临时标签及 C 产物身份登记均在 D:\Project\demo\aisling-memory-bc-p15-lab。主体锚点是受信测试标注，不代表生产实体识别。C 的 UUID 仅为实验提取产物映射到 reflectionId 的兼容引用，不证明已经存在正式 ReflectionStore 记录，生产集成前必须明确该来源类型。

测试命令、日志和实测结果见实验目录 PRECHECK.md、BC-RESULTS.md。格式契约符合、引用可核验不等于语义真实；UPDATE/NOOP、纠错/取代仍由参试模型判断，校验器不替模型改动作。本轮不提交、不推送。
