# v0.3.9 Git 整合与发布验证

2026-11-12，Asia/Shanghai。目标为 Memory 第一轮工程基线；不提前开发 v0.4.0，不创建安装包或 GitHub Release 页面。当前为本地准备记录，只有下方各门槛取得实际结果后才允许推送。

## 整理前后与提交组织

起点为 main @ `3204a51c400ebff05ed3fa8a047ec172110a32ec`，与上次审计的84项完全一致：47 M、17 D、20 ??，暂存为空。已知origin/main领先本地1项，本地领先3项；backup/pre-history-cleanup仍为`2f4762d`，不得并入发布。起点的完整文件清单见[仓库审计](repository-audit-2026-11-12.md)，本轮不把该历史快照改写成新状态。

运行时、P6与P7共享Main协调、Worker合同/事务和Renderer Recall，逐段核对后将前三组并为一个50文件的完整工程提交，包含启动storeToRefs修复及持续回归，避免人为切出不完整依赖。第二组为32文件的工程文档、隐私排除与历史整理。版本提交仅涉及版本来源、桌面显示和发行说明，不混入新Memory功能。没有重写旧提交、reset、clean或修改独立备份分支。

提交、远程整合、测试和推送结果将在实际执行后记录；本地提交成功、main Push、Tag创建和远程Tag核验分别判断。

## 旧实验处理及来源保护

本轮开始前84文件已逐项备份到忽略的`.tmp/release-v039/before/`并登记SHA-256，17份已删除文档的HEAD原件也另存本地；不以“干净工作区”为由丢弃内容。

| 原路径（apps/stage-desktop/下） | 最终处理 | 本地归档SHA-256 |
| --- | --- | --- |
| memory-organization-smoke.cjs | 原稿复制到reports/legacy-smoke-v0.3.9/；正式版本裁掉semanticLive及旧live付费请求、预算、账本分支，保留全部Mock、缺失资源、ADD/NOOP/高风险审核、重载和删源回归 | 04d6a9b27eea350db410ee37832d2e566c5f73bef4d40c257dee5912059a110b |
| memory-note-recall-smoke.cjs | 无正式调用方，校验复制一致后从源码目录移存同一本地归档，非删除 | 68cf405d2725db1378564b998ea48ebc7b6868f940245ab77c11406256200a8f |
| memory-semantic-smoke.cjs | 同上；保留历史writer注入/W0-W1研究价值，不能从归档位置直接运行 | 6f3726fe8ec7537b2e4b3ea9bfede2989d8ca68ea763dcf52385e17fffe6e8ae |

三份原稿及原147文件私人研究包均保留本地、被/reports/忽略，不进入GitHub。正式Reflection/v1兼容、迁移、历史擦除、故障注入和恢复测试继续保留。

## 17份历史文档删除的最终结果

逐份复查HEAD原文后保留既有删除，进入文档提交；原件仍在此前Git历史和本地审阅快照。下表是有效承接位置，不表示旧报告的验证全部适用于当前架构。

| 删除路径（docs/下） | 保留的重要结论 / 承接位置 |
| --- | --- |
| formation-ab-results.md | 4/5批恢复与33次有效对照、无总体净收益；绘画响应回放不是连续桌面联机成功，候选漏选保留于research/memory-validation.md。 |
| formation-failure-analysis.md | 原验收0产物、related/uncertainty与来源约束失败，不把后续恢复倒写成功；research/memory-validation.md。 |
| memory-database-audit.md | 唯一权威、原文/派生删除与历史恢复约束；memory-note-only-engineering-baseline.md及memory.md。 |
| memory-database-p0.md | 独立固定Worker、协议/Schema隔离、启动失败与进程退出；工程基线、运行时一致性和保留P0回归。 |
| memory-note-only-p0.md | Note v2唯一结构化权威及Evidence/Context区别；工程基线、memory.md。 |
| memory-note-only-p1-formation.md | E/S/N引用、交付批次、来源校验和审批/恢复；工程基线，后续授权演进见自主Organization/P6。 |
| memory-note-only-p2-lifecycle.md | 永久删除屏障、历史Revision/Receipt和派生擦除；工程基线及保留生命周期回归。 |
| memory-note-only-p3-transition.md | v1/v2权威互斥、旧Profile兼容和切换阻断；工程基线及memory.md。 |
| memory-note-only-p4-migration.md | 只读预检、确认、冻结、独立目标导入/验证和中断恢复；工程基线及memory.md。 |
| memory-note-only-p5-retirement.md | 旧运行时隔离、历史擦除按需兼容，未验源不可注入；工程基线及旧Formation/Recall说明。 |
| memory-note-p1-2.md | 旧Note合同、操作/版本/来源与有限模型判断；工程基线和research/memory-validation.md。 |
| memory-organization-adaptation.md | 旧适配不是放开一般Evolution权限；历史研究摘要，正式边界见当前自主Organization/P6。 |
| memory-organization-p1-6.md | C候选链路与启用阻断，低成本不等于写入正确；历史研究摘要和当前授权说明。 |
| memory-organization-p1-7.md | 受限正式写入、删除闭包、稳定Receipt；工程基线；1624-token真实组织但Mock聊天的限制保留于研究摘要。 |
| memory-organization-p15.md | 旧场景动作正确率仍含严重误取代，不能开放Evolution；研究摘要保留21/24、10/12、9/12和约49%输入成本的适用范围。 |
| memory-p1-8-audit.md | 版本/删源不可裁、旧Reflection职责需先收束、物理擦除/整份Profile回滚等未验证；工程基线和研究摘要。 |
| reflection-value.md | 跨经历候选、组合漏选、预算和来源有效不等于语义真实；reflection-recall.md及research/memory-validation.md。 |

P6、P7、P7.1原始实施报告和失败记录保留。尤其P7.1无有效图、B/C向量降级不等价、2/2小样本与未复验真实回答的限制不改为成功。

## 版本来源

根项目、apps/stage-desktop、apps/stage-web、packages/core四份package.json统一0.3.9。Stage及Desktop窗口标题从Electron app.getVersion()读取，不另建版本常量。README、docs/README、CHANGELOG及v0.3.9发行说明同步；旧阶段/发行报告仍保留当时版本。Worker package没有项目版本字段，其依赖版本、数据库Schema和协议保持原值。

pnpm锁文件双文档结构使用workspace link和依赖版本，不存上述四个项目的自身版本；两份依赖锁文件不机械修改。版本与实际窗口的运行验证待执行后填入。

## 最终质量与远程结果

本轮最终Core/Web/Desktop串行、类型、构建、新旧Profile/Memory、旧Smoke、实际版本、隐私与Git检查尚待在远程整合后重新执行。此前审计的112/410/118通过不冒充本轮结果。

当前未创建v0.3.9 Tag，未推送main或Tag。若冲突、测试、敏感信息、版本或标签条件任一不成立，保留本地已提交状态并停止推送。最终结果将在实际完成后追加记录。

## 未验证的真实使用限制

不新增真实Provider语义实验；自动化使用合成/Mock，实际Worker/LadybugDB/HNSW通过也不证明长期语义收益。持久HNSW依赖损坏后写/删不保证无损回退；应恢复固定资源并维持删除屏障。未验收长期大库、真实物理擦除、整个Profile回滚、安装包、签名、升级卸载和第三方原生依赖再分发。详见[v0.3.9发行说明](release-v0.3.9.md)与[P7.1](memory-p7-1-validation.md)。
