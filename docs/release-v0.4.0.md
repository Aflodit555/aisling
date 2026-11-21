# Aisling v0.4.0：Memory 整合与公开历史验证

版本：**0.4.0**。本版本整合 P0—P4-B、Obsidian Memory Mirror 和 Memory 设置产品化；工程回归不等于长期语义收益，也不代表安装器、签名或首次安装体验已完成。原 v0.3.9 发布记录保留。

## 已整合成果

| 范围 | 本版本实际行为 |
| --- | --- |
| P0 / 数据安全 | 代码检查点与独立一致性备份分开；保留恢复、校验和隐私删除责任 |
| P1 / Formation | 持久任务、错误分类、有界重试、手动恢复、验源、审核和 Receipt 幂等 |
| P2 / Profile | pnpm start、dev:desktop、start:desktop 使用同一已准备的权威选择；缺失/异常根拒绝启动 |
| P3 / P3.1 | 有界原始上下文、现有合同协调、BM25/Embedding 候选发现与有证据的事件演化 |
| P4-A / P4-B | 完成历史逐条处置及批准迁移，退出旧 Reflection Formation/Recall、UI、IPC 与专属导出；保留归档、删除闭包及离线恢复 |
| Memory | 正式运行链路为 Context + Raw Recall + Note v2 Recall，同一数据库保存 Evidence、Revision、Receipt 和关系 |
| Obsidian Mirror | 同一 Worker 只读快照的单向 Markdown 输出；保护用户文件，不从 Vault 反向形成记忆 |
| 产品化 | 移除常驻任务诊断/历史失败统计；无待审时隐藏，有待审默认两条并可展开；保留证据、原生批准和按需恢复 |

详见 [当前 Memory](memory.md)、[产品化审计](memory-productization-audit.md)和各阶段报告。阶段报告的测试结果仍属于原时点，不冒充本次验证。

## 公开历史与原私人历史

原私人开发仓库、分支、reflog、完整 Bundle 及数据备份原样保留。历史重建在独立受限目录完成，再通过非本地对象传输创建独立发布克隆；公开克隆没有 hardlink pack、alternates 或私人 backup 分支。

按批准的 **原 Blob SHA → public.md** 清单替换 **9 份文档**。原认识正文、真实 Reflection/Note/operation/事务 ID、可关联映射、私人校验值和机器路径只留私人归档；保留工程设计、40 条处置、分类/迁移数量、来源风险、失败与恢复结论。占位 ID 不是可运行标识，不可用于实际恢复。

使用 Git read-tree / update-index / write-tree / hash-object 重建未发布后缀，逐提交比较全部树项、模式、父链、作者/提交者、日期和消息字节。**11 个阶段成果全部继承，除批准文档外没有历史内容差异**。未修改任何业务源码、测试、资源、Schema、Prompt、授权规则或算法。old→new 完整映射及断言证明保留在私人审计记录。

已保护公共基点 `93474d2b29c00a312948f7b745b7948c2d28fff9`。脱敏后工程 HEAD 为 `4a3bbfb9bacde81ff4465c849e5f1c2b6f9d3640`；普通合并保留 origin/main 的 `8dccc761edb02befb4d99f2a1a985d1ceaae889b`。`idle-life.ts` 与该远端版本一致，gaze deceleration 的 scale 复用未丢失。

公开检查遍历全部祖先/Blob、提交/标签说明及克隆中的对象，而不是只扫 HEAD：原敏感 Blob 不存在，原重写提交不可达；对照冻结凭据、原始消息、Reflection 正文、真实 ID 及前缀，并人工复核脱敏叙述。没有提交私人原文、diff、数据库、会话、日志、恢复清单或实验输出。

最终 fetch 另发现 `e782a06`，仅把 idle-life.ts 的 gaze 平滑注释从两行精简为一行。已通过普通 merge 保留；剔除注释/空白后的执行文本与已测 `8dccc76` 版本一致。2026-11-21 恢复任务时重新 fetch，远端仍为该提交、尚无 v0.4.0；重新执行合并后完整 Core/Web/原生回归、类型、构建及 pnpm start，不把中断前的部分日志或旧阶段结果冒充此次通过。

既有公共祖先仍有通用工程路径、产品默认路径和合成样例；另核对了已删除的旧工程任务文件，未发现其含用户经历或凭据。它们与真实私人内容分开判断，未借本次任务重写公共祖先或移动已有标签。无法证明已删除远端引用、外部 fork 或缓存从未保存过其他内容，不作绝对隐私保证。

## 本轮验证

全部验证在独立发布克隆进行，使用合成/隔离 Profile、固定 Worker、Mock 和测试 Vault；没有迁移真实用户数据、重放旧失败批次或操作真实 Vault。

| 项目 | 本轮结果 |
| --- | --- |
| Core 全量 | 104/104 通过 |
| Stage Web 全量 | 355 通过；1 个需明确授权的付费 live 用例跳过 |
| Desktop / Scripts 全量 | 165/165，通过；0 fail、0 skip，固定原生运行时串行执行 |
| Memory 中英文 / Light-Dark | 真实 Electron 8 组 DOM/样式通过；0/1/2/更多提议、证据、原生批准/拒绝及按需恢复通过 |
| pnpm typecheck | 全工作区通过 |
| pnpm build | 生产构建通过；保留既有 >500 kB chunk 提示 |
| pnpm start | 实际入口通过，Vite → Electron 44.4.3 → Main/Worker/Renderer；标题 Aisling v0.4.0，Note Recall ready=0，旧桥接不存在，外部调用=0，正常退出=0 |
| Live2D / gaze | 本轮完整 Web 回归通过，包括 sudden pointer turn 减速/反向用例 |
| Git / 公开检查 | 11 个提交逐一等价；9 个候选的 Git Blob SHA-256 相符；最终提交/标签再扫描后才允许推送 |

本轮首轮失败保留，不以重跑掩盖：

- 首次高并发 Web 为 354 通过、1 失败、1 跳过，Raw Recall 的 30ms 墙钟预算触发返回空。降低文件并发后，完整 Web 355 通过；没有延长生产预算、改断言或移除测试。
- 首轮原生为 77 通过、88 失败、0 跳过：复制来的 Worker 文本与新检出存在 CRLF/LF 差异，现有 byte-for-byte 完整性保护拒绝。先证实八个文本文件仅有换行差异，再同步本克隆资源；原准备脚本核验固定 Node 24.12.0、LadybugDB 0.22.1、原生驱动和资源通过。没有放松源码一致性检查。
- 新克隆最初继承了仅抓 public-candidate 的 fetch 规则，改为只抓实际 GitHub main 后正常 fetch/merge。一次沙箱 Git/MSYS 本地传输受限，获准环境完成无硬链接克隆。系统 Python 启动器不可用，未安装全局工具；标准 Git 对象重建及原始元数据保留已作断言核验。
- 启动冒烟夹具最初在 Electron 内部初始化前请求 API，随后又误等二次加载结束；均保留失败日志。默认关闭的 Note Recall 返回 disabled 也被严格 ready 断言拒绝；改用无凭据的合成配置显式开启该子开关后，实际 pnpm start 全部断言通过。生产启动器、开关默认值和 IPC 验证没有修改。

未运行付费 LLM/Embedding、真实用户 Profile 功能实验、真实 Vault 同步、断电、安装器/签名或新机器升级验收。未删改有效测试，唯一跳过仍为原有 opt-in live 用例。

## GitHub 邮箱保护与新提交身份

首次原子推送被 GitHub GH007 同时拒绝，远端 main 未改变、v0.4.0 未创建。原 11 个阶段提交均已使用仓库的公开 noreply 身份；本轮新建的两个提交和附注标签误继承全局私有邮箱。恢复使用已在 origin/main 中核实的原仓库 noreply 身份，在隔离仓库重建本轮新提交并重新生成干净的公开 Git 元数据；原 11 个阶段提交作者、时间及内容不变。未关闭邮箱保护，未将私有邮箱公开，也未用只改末尾提交的方法掩盖先前元数据。

GitHub 拒绝时的代码/标签 Bundle 和完整记录私人保留；修正只影响本轮新提交身份及本报告，不改变业务代码、版本、测试或配置。[GitHub 邮箱保护说明](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/blocking-command-line-pushes-that-expose-your-personal-email-address)

## 发布引用与后续开发

计划只显式推送 `refs/heads/main` 和附注标签 `refs/tags/v0.4.0`，不创建 GitHub Release，不推送原私人 feature/backup/其他标签，不使用 force、--all 或 --mirror。最终推送结果以核实后的交付回执为准，不把本节的计划写成已成功。

本报告随最终发布提交保存，避免嵌入其自身 SHA；精确 main、标签对象及 peeled target、远端引用值记录在发布克隆本机 `.tmp/release/publication.json` 和最终交付中。可只读核验：

```sh
git rev-parse main
git rev-parse v0.4.0
git rev-parse 'v0.4.0^{commit}'
git ls-remote origin refs/heads/main refs/tags/v0.4.0 'refs/tags/v0.4.0^{}'
```

后续开发使用本公开 main 或从 GitHub 新克隆。**不要把原私人功能分支普通 merge 到公开 main**，否则敏感祖先会重新进入公开历史。原私人仓库只用于审计/恢复；独立备份和正式用户 Profile 不是公开仓库的一部分。普通启动仍需已准备的统一 Profile，新机器初始化不能通过伪造 receipt 或创建空库绕过。

剩余事项：真实模型语义收益和向量质量、首次安装/升级、签名/安装器、大库/极端文件系统故障等仍待后续；离线备份的保留和隐私删除责任持续存在。
