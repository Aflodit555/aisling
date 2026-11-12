# v0.3.9 Git 整合与发布验证

2026-11-12，Asia/Shanghai。目标为 Memory 第一轮工程基线；不提前开发 v0.4.0，不创建安装包或 GitHub Release 页面。以下区分本地提交、实际Push、Tag创建与远程核验；代码基线和文档回执分别可追溯。

## 整理前后与提交组织

起点为 main @ `3204a51c400ebff05ed3fa8a047ec172110a32ec`，与上次审计的84项完全一致：47 M、17 D、20 ??，暂存为空。已知origin/main领先本地1项，本地领先3项；backup/pre-history-cleanup仍为`2f4762d`，不得并入发布。起点的完整文件清单见[仓库审计](repository-audit-2026-11-12.md)，本轮不把该历史快照改写成新状态。

运行时、P6与P7共享Main协调、Worker合同/事务和Renderer Recall，逐段核对后将前三组并为一个50文件的完整工程提交，包含启动storeToRefs修复及持续回归，避免人为切出不完整依赖。第二组为32文件的工程文档、隐私排除与历史整理。版本提交仅涉及版本来源、桌面显示和发行说明，不混入新Memory功能。没有重写旧提交、reset、clean或修改独立备份分支。

本轮新增本地提交如下（不包含原有271d19e、dbd88f3、3204a51三个未推送成果，也不把远程既有5deab5e当作新造本地提交）。最近的本报告记录提交由上述git log按路径解析，避免不可实现的自引用Hash；所有其他新增提交Hash完整列出。

| 新增Commit Hash | 说明 | 主要文件/范围 |
| --- | --- | --- |
| `2d3c88c0bd8699d82be7bc2c3b107d61577b5499` | docs(release): record v0.3.9 integration and quality gates | 仅本轮发行验证报告/记录 |
| `65cff85ef71c1b766ca4e0e9fcb11e767a9aa5d4` | test(desktop): align diagnostic fixture with app version metadata | 诊断夹具补齐app.getVersion，保留原生产诊断断言 |
| `bd36037f1c99a5d9c0b8f808da26b0910f0f402a` | merge: integrate origin/main gaze correction for v0.3.9 | 双亲Merge，保留origin/main的idle-life.ts gaze比例修正 |
| `0a0ca5e09f8b628f538694230f6e1f9b49648445` | release: prepare v0.3.9 Memory engineering baseline | 四份package.json、桌面版本标题、CHANGELOG/README和两份发行文档，10文件 |
| `a93a2722110636682b8d3e3b7a3bce63aefd5053` | docs(memory): consolidate engineering guides and preserve research limits | README、docs、研究摘要、.gitignore及17历史文档删除，32文件 |
| `2c6d8fe2d614f0c02631ee9d4f0085f772376528` | feat(memory): establish P0-P7.1 engineering baseline | Main / Worker / Store / Core / Stage、启动修复、50工程文件及持续回归 |

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

pnpm锁文件双文档结构使用workspace link和依赖版本，不存上述四个项目的自身版本；两份依赖锁文件不机械修改。运行验证实际读取标准Electron Main，四份清单、两个窗口标题和当前文档均为v0.3.9；无改第三方依赖/Schema/协议版本。

## 最终质量与远程结果

本轮在Merge后的代码上重新执行，没有继承审计通过数。

| 验证 | 实际结果 |
| --- | --- |
| Core全量 | 19文件，112/112通过；含本机HTTP Mock，非真实Provider。 |
| Stage Web全量 | 43文件，410/410通过；含启动、旧兼容、Formation/Recall及配置回归。 |
| Desktop最终完整串行 | 118/118通过，0失败/取消/跳过；使用正确独立Windows Worker，实际LadybugDB/HNSW/exact，覆盖新旧Profile、迁移、删除屏障、版本/Receipt恢复、Vite与生产Electron Mock。在依赖稳定和新生产构建完成后重新完整运行。 |
| 类型检查 | Core、Stage Web与Desktop既有选定JS入口全部通过。 |
| 生产构建 | 通过，主chunk约797.17kB；保留既有>500kB提示，不做无关拆包。 |
| 正式旧Organization Smoke | 裁切后Mock全生命周期、Worker缺失降级两个入口均通过；没有付费分支或真实Provider调用。 |
| 实际应用版本 | 启动真实apps/stage-desktop目录及标准main.cjs，在隔离Profile上验得app.getVersion()=0.3.9、Stage实际挂载；Stage窗口“Aisling v0.3.9”，Desktop窗口“Aisling Desktop v0.3.9”。 |
| 来源保护 / Git / 隐私 | 起点84路径全部有提交/删除/校验归档归属；3原稿SHA-256一致；私人研究不入Git。diff及cached检查、Markdown本地目标、322个当前跟踪路径和全部待推送提交扫描通过；无常见密钥匹配，不等于隐私形式化证明。 |
| 锁文件 / 远程gaze / backup | 两份锁文件相对3204a51完全不变；idle-life.ts与整合前origin/main一致；backup仍为2f4762d，未合并/推送。 |

### 本轮失败及恢复记录

版本更新触发pnpm重新核对并重链接锁定依赖；沙箱的首次typecheck尝试被DNS阻断，未完成，之后在正常环境类型检查/构建通过，没有升级依赖。Core/Web执行时复用了现有包缓存，依赖解析仍使用原锁文件。

首轮Desktop过早与依赖重链接/构建重叠：Electron缺失触发自动下载，迁移入口在构建目录替换期间出现ERR_FILE_NOT_FOUND / ERR_UNEXPECTED。另一个明确错误来自本轮版本标题：诊断夹具未模拟app.getVersion()，提前TypeError，已按实际package版本补齐原有Mock。该轮最终通过116、失败2、取消0，不能算发布通过。保留失败项：main distinguishes an actual Jev call, validates snapshot first, and keeps model input unchanged (33.0612ms)；standard Electron entry checks and confirms an upgrade, excludes an old writer, then restarts in v2 (112304.556ms)。第二轮在确认诊断夹具缺失后主动中断，日志另存desktop-interrupted.log，不算通过。没有删除断言、加大产品超时或改写恢复/删除规则；补齐夹具、依赖稳定且新构建完成后，最终完整串行118项通过。

日志和隔离输出均在忽略目录.tmp/release-v039/及artifacts/：workspace-tests.log、typecheck.log（失败记录）、typecheck-full.log、build.log、desktop-tests.log（首轮）、desktop-final.log（最终）、runtime-check.log、runtime-version.json、preflight.json。本轮未调用真实Provider，未使用或改写真实Profile。

### 推送前隐私检查

检查全部当前跟踪路径及origin/main..HEAD的提交内容，排除reports、Profile/.local、artifacts、.tmp、node_modules、dist、.env、数据库/WAL、日志及原生可执行文件；扫描常见API/GitHub/AWS/私钥和长字面量凭据无命中。保留的合成Mock不冒充真实数据。git check-ignore验证私人种子、原稿、Profile、实验输出、环境文件和作业账本有效；所有旧源码原稿保留本地且不进入GitHub。

### 远程分叉整合

本地成果提交后git fetch origin，远程main仍为`5deab5ea289d001c43df5fc8e24cc52d7051d3f7`。使用`git merge --no-ff --no-commit origin/main`审阅后正常提交`bd36037f1c99a5d9c0b8f808da26b0910f0f402a`，双亲为`0a0ca5e09f8b628f538694230f6e1f9b49648445`和远程5deab5e。无冲突；保留远程gaze修正，无整段覆盖、rebase、force push或历史重写。

### main / Tag分别核验

带说明Tag创建成功：对象`8c8067b237a3a5593beeb809a592549b0bda6f6e`，解引用提交`2d3c88c0bd8699d82be7bc2c3b107d61577b5499`。首次main Push成功、Tag Push成功，已通过git ls-remote核对main及Tag对象/解引用均与本地一致。

本报告在Tag之后的纯文档记录提交只补充实际回执，不改变版本或运行代码；最终main包含该记录，Tag固定在已验证的发布基线，不移动、不覆盖。报告不能自嵌自身提交Hash，记录提交用`git log -1 --format=%H -- docs/release-v0.3.9-validation.md`解析；任务收尾再次核对远程main等于本地HEAD且包含Tag。完整机器回执保留于本地忽略的.tmp/release-v039/push-receipt.json及final-remote.json。

收尾状态：工作区及暂存区为空，main与origin/main同步，主分支没有待提交或待推送成果；私人研究/运行资料继续忽略且保留。backup/pre-history-cleanup未变、未合并、未推送，其5个旧历史提交不是本次发布积压。v0.3.9是已验证工程基线，标签后的差异仅为本报告回执；没有二进制安装包或GitHub Release页面。

## 未验证的真实使用限制

不新增真实Provider语义实验；自动化使用合成/Mock，实际Worker/LadybugDB/HNSW通过也不证明长期语义收益。持久HNSW依赖损坏后写/删不保证无损回退；应恢复固定资源并维持删除屏障。未验收长期大库、真实物理擦除、整个Profile回滚、安装包、签名、升级卸载和第三方原生依赖再分发。详见[v0.3.9发行说明](release-v0.3.9.md)与[P7.1](memory-p7-1-validation.md)。
