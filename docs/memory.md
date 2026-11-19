# Memory：当前架构与使用

当前工程版本为 v0.4.0，包含 P0—P4-B 和设置产品化收束；工程回归不等于真实模型语义质量验收。发布验证见 [v0.4.0](release-v0.4.0.md)。

## 运行链路

正式架构是 **Context + Raw Recall + Note v2 Recall**，没有第二套 Reflection Formation/Recall。

| 能力 | 当前职责与入口 |
| --- | --- |
| Context | Core context.ts / runtime.ts 优先保留当前 Session 的有界交互 |
| Raw Recall | Web memory-recall.ts 从其他本地 Session 检索原文，不改写历史或另建数据库 |
| Formation | Stage 成功交付后入队；Renderer 调用当前 Chat Provider；Main note-formation.cjs 负责持久任务、合同、来源与授权 |
| Organization | 同一 Note 库、证据、版本及任务队列；note-organization-v2.mjs / note-semantic-contract.mjs 判断关系与演变 |
| BM25 / Embedding | note-candidates.mjs / note-embedding.cjs 融合词面、元数据及可选向量；向量相似不自动授权事实或关系 |
| Note Recall | note-v2-recall.ts 验证来源、版本与快照后提供 Note；不可用时保留 Context 和可用 Raw |
| Store / Worker | 单一 LadybugDB，保存 Note、Revision、Evidence、关系、Receipt 与删除屏障；note-v1.cjs 仍承载现役 v2 能力 |
| Obsidian Mirror | 单向读取库快照生成受管 Markdown，不从 Vault 反向形成记忆 |

## 设置与费用

- **Memory** 控制 Raw 和 Note 的跨会话使用；新配置默认开启。关闭会同步关闭 Formation，保留历史、任务与删除责任；再次开启不自动开启 Formation。
- **Formation** 默认关闭，需单独授权。后台使用当前模型，并可能产生关系判断/文档 Embedding 费用，保留既有预算。关闭不删除历史或关闭已有 Note Recall。
- **Recall** 默认关闭，仅控制 Note Recall。Memory 开启时的 Raw Recall 不依赖此子开关；可选查询 Embedding 可能额外收费。
- **Embedding** 使用现有 DashScope Native API，复用或专用凭据；无配置时仍有本地词面候选。模型空间切换与向量补建沿原队列处理。
- **Obsidian 镜像** 独立保存开关和路径，按原逻辑启停，不依赖 Formation/Recall 开关。42px 路径行支持失焦/Enter 保存与内联错误；仅维护带标记笔记，保护用户文件和其他目录。见 [Mirror 规则](obsidian-memory-mirror.md)。

设置页不常驻显示内部批次统计或失败历史。Main 判断允许手动恢复时，出现默认折叠的“恢复未完成的记忆”；点击才执行。P1 持久任务、错误分类、有界自动重试、手动重试、Receipt 和完整诊断接口仍在。

无待审请求时隐藏审核区；有请求时默认最多两条，可继续展开。每项可查看完整提议、原始证据、已有认识及不确定性，保留批准/拒绝。批准仍经过可信 Main 原生确认、来源与权限验证。Main 单次最多提供 20 项，处理后刷新补入余下请求；前端限制不删除后台请求。

Context 优先获得预算。Raw 最多五个 Session、6000 字符且 6000 UTF-8 字节，按整组保留纠正和原序；Note Recall 最多三项 / 2000 字符，网络扩展沿既有边界。记录时间不是事件时间，缺时和冲突保持不确定性。开启记忆会把相关原文发送给所选 Provider，过滤不保证识别所有敏感内容。

## Profile 与启动

`pnpm start` 等同 `pnpm dev:desktop`（Vite + Electron）；`pnpm start:desktop` 构建 Renderer 后启动同一个 Main。三个普通入口均使用 P2 已准备的统一 Profile：Electron 原 userData 加 `-note-v2`，不再自动选择 `.local/desktop-dev-profile`。Windows 本项目默认 `%APPDATA%/@aisling/stage-desktop-note-v2`；改 app name 或换机器后必须重新核实。

默认目录必须有完整数据、authority、P2 committed 凭据及正确数据库；缺失/不一致会拒绝启动，不创建空库掩盖丢失。首次安装的通用 Profile 初始化与安装器仍未产品化。旧 Profile 不再通过设置页升级，不得伪造凭据启动。

`AISLING_DEV_PROFILE` 仅供显式隔离测试，dev/prod 均支持，要求已有绝对、规范且未封存目录；同一根共用单实例锁，不是第二个正式权威。`pnpm dev` 仅启动浏览器开发页面，不提供 Desktop Note 数据库。

Worker 固定 Node 24.12.0 / LadybugDB 0.22.1，默认 `.local/memory-database`。正常关闭使用它的 Desktop 后运行 `./scripts/prepare-memory-database.ps1` 刷新资源；首次安装、锁定二进制及回退见 [Worker 准备](memory-development-runtime-alignment.md#首次准备-worker)。构建 Renderer 不刷新 Worker。

## 删除、恢复与工程资料

来源删除使相关 Raw/Note 快照失效，并沿 Evidence、Context、Revision、关系和历史归档执行现有闭包，不依赖 Recall 开关。归档不参与 Recall，仍承担隐私删除责任；离线备份/封存副本也有保留和删除责任。

Git 只保护代码。恢复前正常关闭应用和 Worker，保留现状并核对 SHA 清单；完整复制到隔离副本验证主库/WAL、Raw、配置、任务、authority、删除/迁移状态及归档。复核快照之后的删除请求，不能复活旧来源；不单独替换主库或混搭 WAL。

- [P2 Profile](memory-v0.4.0-p2-profile-unification.md)与 `scripts/unify-memory-profile.*` 保留完整交接、封存和恢复依据。
- [P4-A](memory-v0.4.0-p4a-reflection-review.md) / [P4-B](memory-v0.4.0-p4b-reflection-retirement.md)保留 40 条处置、冻结清单、备份与 Receipt；演练/发布工具用于审计和恢复，不自动重跑。
- `scripts/legacy-memory-recovery.cjs` 仅作显式离线旧格式恢复；`memory-history-backfill.cjs` 保留原历史回填的唯一 restore 机制，不作日常入口或重新回填。
- [旧 Memory 说明归档](history/memory-before-productization.md)保留 Raw 时间/预算推导和旧实现边界。P0—P4-B 报告保留原时点结论，不照搬其旧操作作为当前流程。

## 验证

Core/Web Mock 和串行原生/Electron 回归覆盖开关、审核、P1 恢复、候选/Recall、Profile、Mirror、删除与 Receipt。付费语义测试默认跳过，需另行明确授权；Mock 不证明真实模型收益。

```powershell
pnpm test
$env:AISLING_MEMORY_DB_P0_TEST_RESOURCES = (Resolve-Path .local/memory-database).Path
& .local/memory-database/runtime/node.exe --test --test-concurrency=1 'apps/stage-desktop/*.test.cjs' 'scripts/*.test.cjs'
pnpm typecheck
pnpm build
```

本轮实际结果与发布前事项见 [Memory 产品化审计](memory-productization-audit.md)。
