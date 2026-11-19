# 项目文档索引

当前项目版本为 v0.3.9，定位为 Memory 第一轮工程基线；以下按用途区分说明，不把历史实验的测试计数当作当前发布验收。

## 当前有效的工程入口

- [v0.3.9 发行说明](release-v0.3.9.md)、[本轮发行验证](release-v0.3.9-validation.md)。

- [Memory](memory.md)：当前 Context + Raw + Note v2、开关、审核/按需恢复、统一 Profile、Mirror 与恢复边界。
- [Memory 产品化审计](memory-productization-audit.md)：本轮页面精简、仓库审计与实际回归结果，尚未发布新版本。
- [Worker 准备与刷新](memory-development-runtime-alignment.md#首次准备-worker)：固定依赖与安全刷新；该历史报告的旧 Profile/迁移 UI 已由 P2/P4-B 替代。
- [Desktop host](desktop-host.md)、[诊断](desktop-diagnostics.md)：Windows 宿主与资料生命周期。
- [Context 与持久化](context-phase-one.md)、[模型思考策略](consciousness-thinking.md)。
- [Settings UI 历史验证](settings-ui-validation-2026-11-13.md)、[历史仓库审计](repository-audit-2026-11-12.md)：当时的设置与发布检查，不替代本轮结果；当前公共配置行高为 42px。

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
| [Formation v0](memory-formation-v0.md)、[Reflection Recall](reflection-recall.md) | 已退役旧业务的设计快照；保留隐私、来源及历史恢复依据，不是现役兼容入口。 |
| [旧 Memory 使用说明](history/memory-before-productization.md) | 保留 Raw 时间与预算推导，旧 Profile/升级 UI 描述已失效。 |
| [P0](memory-v0.4.0-p0-checkpoint.md)、[P1](memory-v0.4.0-p1-formation-reliability.md)、[P2](memory-v0.4.0-p2-profile-unification.md) | 工程基线、持久恢复、统一权威与完整备份依据。 |
| [P3](memory-v0.4.0-p3-semantic-quality.md)、[P3.1](memory-v0.4.0-p3.1-semantic-coordination.md) | 合同、上下文、候选与演化验证，含真实模型失败和预算边界。 |
| [P4-A](memory-v0.4.0-p4a-reflection-review.md)、[P4-B](memory-v0.4.0-p4b-reflection-retirement.md) | 逐条处置、正式迁移、Receipt、独立备份和删除责任；必要离线工具继续保留。 |

## 本地研究材料

`reports/reflection-recall-ab-test-2026-11-02/` 保留旧真实语料研究包，包括请求、回答、会话种子和冻结 harness，属于私人研究资料，已忽略，不能整体加入 GitHub。它不代表当前 v2 行为，也不能直接套用已退役的实验接口。

旧的 `memory-note-recall-smoke.cjs`、`memory-semantic-smoke.cjs` 以及含真实 Provider 分支的 Organization Smoke 原稿已按 SHA-256 核对后移存或复制至本地 `reports/legacy-smoke-v0.3.9/`。它们只作为历史源码归档，不能从归档目录直接运行；正式 Organization Smoke 仅保留合成 Mock 和故障回归。

`artifacts/`、`.local/`、`.tmp/` 为本地验证、数据库资源和中间产物，不是正式文档。需要保留的重要结论写入上述研究说明；原始材料保留在本地，未经单独隐私审阅不发布。
