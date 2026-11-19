# Memory 产品化与仓库收束审计

日期：2026-11-19。状态：本轮产品化收束已完成，未发布新版本。版本仍为 v0.3.9；未推送、合并、删除分支或改写历史。所有数据库/审核/故障操作测试使用隔离 Profile、合成消息和 Mock Provider。

## A. 实施前仓库状态

重新检查实际仓库、P0/P1/P2/P3/P3.1/P4-A/P4-B 报告、Memory Vue/组件、Main/Renderer/Store、当前启动脚本、Mirror，以及 scripts 下全部 13 个文件和现有测试。没有依据旧报告中的文件名直接删除模块。

- 分支：`feat/obsidian-memory-mirror`；HEAD：`098d682348128c08eb9958b2e08e78d7c51b05d7`。开工暂存、未暂存、未追踪代码均为空，基线有 343 个跟踪文件。
- 本地 main：`93474d2b29c00a312948f7b745b7948c2d28fff9`，是当前分支祖先；开工分支比它多 10 个提交。
- 本轮实际执行 `git fetch origin`，未使用 prune；origin/main 为 `8dccc761edb02befb4d99f2a1a985d1ceaae889b`。origin/main 与本分支分别有 1 / 10 个独立提交，不能把本地 main 等同最新远端。
- root/Core/Web/Desktop 版本均为 0.3.9；没有改 package、依赖、锁文件、Note Schema、Prompt、授权、候选/Recall/Organization 算法、Profile 权威或用户开关。

正式用户数据库没有被打开作实验，未重新回填或处理 Reflection，未改实际 Vault。P4-B 迁移前后备份、归档和冻结材料继续保留在忽略目录。本轮未把 P4-B 的数据库完整性结果冒称为重新执行。

## B. Memory 前端精简前后

| 部分 | 之前 | 现在 |
| --- | --- | --- |
| Formation tasks | 常驻全部批次数、生命周期、操作结果、失败历史和展开列表 | 整块删除，旧 FormationStatus.vue 不再存在 |
| Formation 行 | forming/failed 聚合字段直接显示 Running / Processing failed | 正常仅标签和开关，历史失败不作为主开关错误 |
| 手动恢复 | 嵌在诊断批次列表中，是唯一 UI 入口 | FormationRecovery.vue 只在 Main 允许恢复时出现，默认折叠，不显示计数、批次 ID、阶段码或历史列表 |
| 审核 0 项 | 标题 (0)、说明和空列表提示 | 整块隐藏 |
| 审核有请求 | 默认展开全部返回项及多行元数据 | 默认最多两条摘要，Approve/Reject 与原始证据保留；查看更多按两条增加 |
| 界面边界 | Memory / Formation / Recall / Obsidian / Embedding | 结构、开关语义和配置表单保留，仅更改 Memory 页面内部展示 |

继续使用 42px 设置行、右侧开关对齐和现有主题变量。没有新增状态管理页面、常驻服务、调试按钮或说明段落。恢复操作反馈使用普通用户措辞，不展示“Task queued”等内部生命周期术语。

## C. 历史失败、当前故障与恢复能力

根因在 `memory.vue`：Formation 行消费 `state.failed`；Main `reviews()` 的该字段包含保留的 failed/retryable 批次，因此历史失败也会使关闭的开关显示错误。截图中的 7 个失败对应历史任务，不能据此判断模块当前启动失败。本轮没有删除、清空或自动重试这些任务，也未重新打开真实库统计数量。

处理规则：

- Formation 主动关闭、没有待办、存在历史失败：主行无错误状态。失败因 consent/source 被 Main 阻止时，不提供可点击的恢复操作。
- `batch.status` 为 failed/settling 且 Main `retryBlocked` 为空：提供默认折叠的恢复入口。失败重试仍调用原 `noteReview.retry(id, attempt)`；已保存操作的核对仍复用 Receipt，不重新生成认识。
- 已有自动重试在排队的 retryable 任务不作为需要用户介入的常驻提醒；原自动预算、手动 retry API 和后续失败恢复均保留。
- 本次读取当前不可用：显示简短“记忆暂时不可用”，恢复成功后消失；不把真实读取错误误报为一直 Starting，也不继续展示失去验证的旧审核项。

Main 的持久 jobs、错误分类、尝试历史、一次有界自动重试、显式重试、来源验证、授权、Receipt、诊断投影及 IPC 均未改动。只删除显示层的统计/历史明细。历史诊断仍可通过原接口与工程测试检查。

## D. 审核展示与安全行为

- 0/1/2/3 项均在真实 Electron 页面验证；3 项初始只显示两条，查看更多后仍能处理第三条，没有裁剪后台请求。
- 卡片保留动作、正文摘要和必要操作。原始证据展开后可看完整正文、kind/basis、已有 Note、不确定性及逐条引文；未通过身份/证据验证的项仍不能批准，可以拒绝。
- 原生确认具有安全目的：可信 Main 再读当前提议、展示完整动作/正文/目标/不确定性，取消后不写入，再检查来源与权限。本轮没有删除或合并此确认。
- 新验收实际点击页面按钮：原生取消后 3 项仍在；批准 1 项后 Note=1、待审=2；两次拒绝依次变为 1/0 项，不增加 Note；最后审核区隐藏。原文包含的问句在证据中完整可见。
- 保留忙状态和原 Main 并发/重复决定保护，旧 IPC/来源失效/幂等断言继续通过。

Main 原来每次最多返回 20 个审核项。本轮不改接口和分页协议；超过该窗口的请求仍保存在后台，处理后刷新补入。大量积压时的专用分页属于后续产品问题，不在本轮增加新系统。

## E. 有依据的清理及文档处理

| 改动 | 依据 |
| --- | --- |
| 删除 FormationStatus.vue 及唯一 import | 整块开发统计展示已按要求移除，手动动作由小型 FormationRecovery 保留 |
| 删除无消费者的统计/历史/空审核本地化文案 | 页面不再展示这些信息；保留当前错误与实际操作需要的中英文文案 |
| 删除 dev-desktop.mjs 的 DEV_RESTART_EXIT=75 分支及迁移测试对 75 的成功容忍 | 搜索生产源码确认已无退出码 75 的发出者；原用途是 P4-B 已退役的迁移 UI 重启，不是现役恢复机制 |
| 修正 README、docs/memory.md、docs/README.md | 原文仍教用户通过旧设置页迁移，并称 dev 默认使用 .local/desktop-dev-profile，与 P2/P4-B 实际代码相反 |
| 旧 Memory 长说明移入 docs/history/memory-before-productization.md | 保留 Raw 时间/预算推导和旧边界，补历史标记并修复相对链接；当前入口改为简洁指南 |
| 四份历史文档补明确失效范围 | Formation v0、Reflection Recall、Note-only baseline、runtime alignment 保留设计/恢复依据；旧 UI/默认 Profile 不是当前操作流程 |
| CHANGELOG 仅加 Unreleased | 保留 v0.3.9 原发行记录，不把本轮变更宣称为已发布版本 |

没有删除任何 P0—P4-B 报告、用户原件、备份、未追踪实验材料或仍有职责的脚本。没有为了减少文件数强行合并事务/恢复代码。

测试维护两项：原 P1 UI 用例将“必须显示全部统计”的过期断言改为折叠手动恢复、完成后退出列表、关闭后不显示历史错误；实际操作数/错误历史保留在 Main 返回值断言中。另一个 Raw 排名用例在高并发下撞到真实 30ms 守卫，只固定测试时钟，并增加超时应拒绝的断言，不改生产评分、预算或保护。

## F. 保留的工具与回归职责

scripts 中 13 个文件均有当前运行、回归、冻结复演或恢复职责，未发现可无损删除的一次性重复工具：

| 工具 | 保留原因 |
| --- | --- |
| dev-desktop.mjs、prepare-memory-database.ps1 | 当前启动与固定 Worker 准备/安全刷新 |
| test-memory-database.cjs | 合成 P0 Main/Worker 崩溃、重开、父进程退出等回归，不是正常 Memory 运行入口 |
| memory-history-backfill.cjs / .test.cjs | 原回填的唯一 restore、来源筛选与 verify；verify 也被后续演练复用 |
| unify-memory-profile.cjs / .ps1 | P2 完整备份、校验、交接/源恢复及公共文件清单、复制、原生验证工具 |
| legacy-memory-recovery.cjs | 旧格式中断迁移的显式离线恢复，不被普通 Runtime 导入 |
| rehearse-reflection-migration.cjs / .test.cjs | P4-A 冻结清单复演与隔离路径拒绝，不能充作正式发布入口 |
| publish-reflection-migration.cjs / .ps1 / .test.cjs | P4-B 独立发布门槛、维护锁、Receipt 及中断恢复，保留原批准/来源约束 |

`semantic-quality-cases.json`、离线覆盖测试、显式 opt-in 的 live 比较、P3.1 协调/候选原生测试不是失去消费者的 benchmark：它们分别验证上下文、合同、候选排名、预算与真实样本限制，继续保留。live 默认不运行，本轮未调用付费 API。

旧 v1 数据库/Origin、迁移与归档测试仍验证物理 Schema 拒绝、版本/事务、历史删除与恢复，不能按名称当成 Reflection 业务测试删除。测试宿主 marker、合成 Profile 路径保护和禁外部调用也保留。

## G. 正式架构与数据保护

实际调用链仍为 Session → Context / Raw Recall / Note v2 Formation；Main → Store/Worker → LadybugDB；Organization 与 BM25/Embedding 使用同一 Note 库；Note Recall 重新验源并有界注入；Mirror 从同一 Worker 获取只读快照。

未发现需要继续保留的第二套 Reflection 生成或 Recall 业务。剩余 reflection/legacy/v1/migration 名称分属旧格式拒绝、离线恢复、公共事务、Origin 删除及审计，不是可供普通运行选择的旧链路。没有新增 Bridge/IPC/export；现有 formation 诊断字段有回归与工程观测职责，保留而不再常驻展示。

核对本轮 diff：Note Schema/Worker/Store、Formation Prompt/授权、Raw/Note Recall、BM25/Embedding/Organization、privacy lifecycle/archive、Profile 权威源码均与基线相同。没有运行真实 Profile 启动、迁移或数据恢复，没有启用真实 Formation，也未操作实际 Vault。

P4-B 原前后完整快照与清单继续保留，旧归档和离线删除责任不变。新截图与日志位于忽略的 artifacts/.tmp；未把真实数据改成测试夹具。

## H. 本轮验证、失败与限制

| 检查 | 实际结果 |
| --- | --- |
| pnpm test：Core | 104/104，通过 |
| pnpm test：Stage Web | 355 通过、1 个付费 live 用例按约束跳过 |
| 串行 Desktop + scripts 全量 | 165/165，0 fail、0 skip，通过 |
| 受影响 Profile/Vite 集合 | 15/15，通过 |
| Memory 新验收 | 实际 Main/Worker、0/1/2/>2 提议、查看更多、原始证据、原生取消/批准/拒绝、读取故障恢复、历史错误与手动恢复通过 |
| 中英文/Light-Dark | 真实 Electron 8 组 DOM/样式断言，42px 行高和开关右对齐；实际 Vite 页面另生成 8 张只读合成 Bridge 图片，人工检查代表组合 |
| pnpm typecheck | Core/Web/Desktop 全部通过 |
| pnpm build | 通过；已有 >500 kB chunk 提示保留 |
| 启动器与 Git | node --check、diff --check、暂存审查及敏感扫描通过 |

Core/Web 测试数未减少；原生从 164 增至 165（新增完整页面验收），没有删除有效来源、隐私、事务、Receipt、Profile 或 P1 保护断言。原“全量统计必须渲染”不再是产品行为，其后台数值和历史保护断言仍在。

首次失败与修复记录均保留：

1. 新页面测试的窗口尺寸缺完整 bounds、隐藏 WebContentsView 截图返回 UnknownVizError，属于夹具问题。修正尺寸；把真实 Electron 的 DOM/交互检查与 headless Chrome 实际 Vue 页的图片检查分开，不跳过业务断言。
2. 临时读取错误清除断言曾误把正常“提议已拒绝”反馈也要求清空，改为只断言当前错误提示消失。
3. 首次 pnpm test 为 Core 104 通过、Web 354 通过/1 失败/1 跳过；Raw 排名用例受并发墙钟影响。固定测试时钟并显式验证超时守卫后，完整 pnpm test 通过。
4. 首次完整原生为 163/165；两项均因用户已运行的 localhost:5174 被占用。只将对应隔离 Vite 测试切到 Main 原已信任的 127.0.0.1:5174，恢复夹具允许相同可信 origin；未改生产白名单或停止用户服务。相关 15/15 复验通过，最终完整结果以上表为准。

本轮日志在 `.tmp/memory-productization/`：web-core-delivery.log、native-final.log、profile-vite-retry.log、typecheck-final.log、build-final.log；失败首轮也未覆盖。页面 DOM/theme 证明由原生测试输出至标记的合成目录；图片位置见同机 `visual-result.json`，属于展示核对，不冒充真实数据库或 API 实测。

未执行：付费 LLM/Embedding、真实库历史重放、真实 Vault 同步/清理、整机断电、安装器/签名/升级和独立演出/焦点/气泡 Smoke。P0—P4-B 的历史验证没有计为本轮重新通过。

## I. Git、敏感数据与尚未推送提交

开工没有用户未提交工作。下列是 fetch 后、创建本轮提交前相对 origin/main 的 10 个本地提交；未改写或混入本轮改动：

| SHA | 范围 |
| --- | --- |
| eb5a8a14e6ead5a469ba0ed65fd2deb0507699f3 | 独立设置激活/Windows 图标工作 |
| 657d56872d50bc3646220ae4d0354dfdd6ff90c2 | Mirror 与前端集成 |
| c324cfc6870183fe6847afd7e29f29b26bbe232c | 历史回填工具与审计 |
| 0b89ece047baed8d0c63837864b5f7ab48fe0e0c | P0 代码/数据检查点 |
| 4b0b8f9fd29689a18fc3ff60734752f93f4e9529 | P1 Formation 恢复 |
| b6960bc07226e057211fadeaa97febd80478fd3a | P2 Profile |
| f98a1be3006af40560ffe0a9fa02d64edd2c4176 | P3 有界原始上下文 |
| ffb19750e32ac87896ea8018216a217c7724639b | P3.1 合同与候选协调 |
| a4dca38c90c787e0ecc67edd100a6ec355b40c1c | P4-A 审查/复演 |
| 098d682348128c08eb9958b2e08e78d7c51b05d7 | P4-B 正式迁移/退役 |

本报告随独立产品化提交保存，准确 SHA 可用 `git log -1 --format=%H -- docs/memory-productization-audit.md` 获取；提交后相对 origin/main 共 11 个本地提交。最终 SHA、文件范围及干净状态另记录在本地交付检查点并在最终答复注明。没有合并 local main / origin/main，也没有推送或发布。

本轮检查跟踪文件及上述未推送历史的 162 个 blob，对照当前配置的 2 个非空凭据和 13 条长度至少 80 字符的完整私有消息，同时检查常见凭据模式，未命中。未发现跟踪的真实数据库、会话 JSON、环境凭据、私有 JSONL 或备份。该扫描是可说明边界的工程检查，不是所有历史短句/语义私密信息的自动认证。

两个大于 1 MiB 的现有文件均为实际使用的 Live2D 纹理：约 8.21 MB / 2.85 MB；此次积压提交没有新增超过 1 MiB 的 blob。模型与图标资源仍有真实引用，不作为临时产物清理。没有新增依赖或大文件。

忽略规则继续覆盖 artifacts、reports、.tmp、.local、数据库/WAL、配置/会话、凭据和恢复标记，无需新增忽略规则。私有审查附录和完整备份不进入此次提交。历史工程报告仍含本机路径、内部 ID 和部分个人认识摘要；未为“干净”擅自改写这些历史。推送前应按公开范围复审，不能因没发现 API Key 就推定全部历史适合公开；忽略目录链接也只在原机器可用。

## J. 产品化剩余事项与结论

- 当前分支未包含 origin/main 上 `8dccc76` 的 gaze deceleration 复用（idle-life.ts）。下一轮整合应先处理这一个远端独立提交，再对合并结果验证；本轮没有代替用户合并。
- 新机器/缺失统一 Profile 的通用初始化、安装器/签名及完整升级体验尚未产品化。当前入口有意拒绝空库替代；本轮修正文档，不扩大到迁移功能。
- 审核接口单次 20 项和诊断元数据仍由原协议提供；高积压分页、轮询成本可后续研究。本轮只精简页面，不重构接口或持久任务。
- 真实模型合同遵循、长期语义收益、真实向量候选质量和实际 API 费用仍需独立验证。5 条证据不足的旧 Reflection 维持 P4-B 不迁移处置，不因产品化改判。
- 离线备份与封存材料的隐私保留/删除责任持续存在；公开工程报告的分享范围仍需在实际推送前复核。

最终回答：

1. **Memory 页面已精简**：常规情况下只保留原设置结构，无任务统计和空审核区。
2. **开发诊断常驻显示已删除**，内部记录与工程接口保留。
3. **P1 恢复能力保留**：可信 Main、持久任务、错误分类、有界重试、手动动作、Receipt、验源与审核均在。
4. **已清理**：旧统计组件/死文案、退出码 75 迁移重启分支/容忍逻辑、过期现行说明；历史资料明确归档，必要工具没有误删。
5. **未发现需要继续运行的冗余 Memory 业务链路**；旧格式代码仅保留有依据的离线恢复与隐私职责。
6. **没有重要覆盖损失**，统计展示断言迁移到实际后台诊断保护；新增页面全链路用例和时间保护断言。
7. **具备进入下一轮版本整合的工程基线**；合并/更新版本/推送前仍需整合远端那一个提交、验证合并结果并复审公开资料范围。当前不是新版本发布或无条件的公开推送批准。
