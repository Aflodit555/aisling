# 项目文档索引

当前项目版本为 v0.3.9，定位为 Memory 第一轮工程基线；以下按用途区分说明，不把历史实验的测试计数当作当前发布验收。

## 当前有效的工程入口

- [v0.3.9 发行说明](release-v0.3.9.md)、[本轮发行验证](release-v0.3.9-validation.md)。

- [Memory](memory.md)：Note v2 权威、用户开关、Recall、旧资料迁移及共用 Raw Recall。
- [开发与运行时一致性](memory-development-runtime-alignment.md)：Vite / 构建版 Profile、Worker 准备和安全刷新。
- [Desktop host](desktop-host.md)、[诊断](desktop-diagnostics.md)：Windows 宿主与资料生命周期。
- [Context 与持久化](context-phase-one.md)、[模型思考策略](consciousness-thinking.md)。
- [本轮仓库审计与产品化整理](repository-audit-2026-11-12.md)：Git 积压、实际整理、当前回归及发布阻碍。

## 保留的实现与研究记录

这些文件包含当时的设计决策、失败及验证边界。实现后续有演进，以当前源码、Memory 入口和最新验证限制为准。

| 材料 | 用途与时效 |
| --- | --- |
| [Note-only P0–P5 基线](memory-note-only-engineering-baseline.md) | 权威、迁移、删除及历史收束；其中“Vite 仍走旧路径”“逐条批准”等是当时状态，已由后续阶段改变。 |
| [Autonomous Organization](memory-autonomous-organization.md) | 字面授权、持久任务、关系失效和删源边界的原始实现。 |
| [P6 语义组织](memory-organization-p6.md) | 受来源约束的语义判断、纵向演化；保留真实模型的失败，不等同全面语义验收。 |
| [P7 关联网络](memory-associative-network-p7.md) | Embedding、RRF、ASSOCIATED_WITH 与有界两跳设计；其部署状态为 P7 当时记录。 |
| [P7.1 验证](memory-p7-1-validation.md) | Windows HNSW 与配置工程闭环；横向召回和最终回答收益尚未充分证明。 |
| [历史 Memory 验证](research/memory-validation.md) | 真实 Provider 小样本、失败恢复、局部 A/B 收益及不可外推范围。 |
| [Formation v0](memory-formation-v0.md)、[Reflection Recall](reflection-recall.md) | 仍有旧 Profile 兼容依赖，不能作为 v2 的新功能入口。 |

## 本地研究材料

`reports/reflection-recall-ab-test-2026-11-02/` 保留旧真实语料研究包，包括请求、回答、会话种子和冻结 harness，属于私人研究资料，已忽略，不能整体加入 GitHub。它不代表当前 v2 行为，也不能直接套用已退役的实验接口。

旧的 `memory-note-recall-smoke.cjs`、`memory-semantic-smoke.cjs` 以及含真实 Provider 分支的 Organization Smoke 原稿已按 SHA-256 核对后移存或复制至本地 `reports/legacy-smoke-v0.3.9/`。它们只作为历史源码归档，不能从归档目录直接运行；正式 Organization Smoke 仅保留合成 Mock 和故障回归。

`artifacts/`、`.local/`、`.tmp/` 为本地验证、数据库资源和中间产物，不是正式文档。需要保留的重要结论写入上述研究说明；原始材料保留在本地，未经单独隐私审阅不发布。
