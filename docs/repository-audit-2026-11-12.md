# Project_Aisling 仓库审计与产品化整理报告

日期：2026-11-12（Asia/Shanghai）。仓库：`D:\Project\demo\project_Aisling`。仅本地审计、必要整理与验证；未 Commit、Push、Fetch、修改远程引用、Reset、Clean、Checkout、清空 Stash 或更改版本号。

## 1. 实际状态与审计范围

项目是面向单机单用户的 Windows Electron AI 角色运行时。重点追踪从已交付会话、Formation、Main授权到Worker事务，再到Note Recall/Core装配，以及删源/重启恢复；未按多用户服务评价其容量。

| 项目 | 实际结果 |
| --- | --- |
| 当前分支 / HEAD | main / 3204a51c400ebff05ed3fa8a047ec172110a32ec；本轮未改变 |
| 上游 / 远程 | origin/main；origin fetch/push均为 https://github.com/Aflodit555/aisling.git |
| main 与已知上游 | ahead 3 / behind 1；origin/main 为 5deab5ea289d001c43df5fc8e24cc52d7051d3f7 |
| 全本地分支未被远程引用包含的提交 | 8个不同Hash：main 3个，历史backup分支5个；不能把全部8个当作当前Memory待推送成果 |
| 开工工作区 | 228个文件：M 46、D 17、?? 165（其中私人reports包147个）；不计本轮审计临时脚本 |
| 整理后工作区 | 84个文件：M 47、D 17、?? 20；暂存0，未暂存跟踪文件64，未跟踪20；无A/R |
| Stash / Worktree | 无Stash；仅本仓库一个Worktree，main @ 3204a51 |
| 未完成Git操作 | 未见MERGE_HEAD、CHERRY_PICK_HEAD、REVERT_HEAD、rebase目录、sequencer、BISECT_LOG或index.lock |
| 子模块 | external/kernel_c固定d52f57ff9bde3b24cad780dd0bb3a5384f758098，工作树无修改；本轮未重新编译/验收真实桌面采集硬件 |

远程差异来自本地远程跟踪引用，本轮按边界没有Fetch；不保证GitHub此刻仍是该Hash。开工前启动Bug修复已完成且保留：stage.ts把可选旧字段用ref承载，stage-persistence.test.ts覆盖storeToRefs。本轮没有回滚或覆盖这轮修复。

## 2. 本轮实际整理和debug

- 修改.gitignore：忽略/reports/及.tmp/。147个私人研究文件从??转为ignored，文件仍完整保存在本地；这不是删除成果，也不是把未提交文件伪装成提交。
- 更新README：纠正“Recall仅词面检索”的过期说明，补上向量/RRF/关联、Worker职责、配置入口、完整测试条件和P7.1真实限制。
- 新增docs/README.md：把当前工程入口、历史实施报告、旧兼容和本地研究材料分开索引，不复制阶段报告正文。
- 在docs/research/memory-validation.md补存11-02研究的局部纠正识别收益、无注入对照和不可外推范围，避免原始包忽略后入口失去重要结论。
- 修正note-formation-smoke.cjs：write和associative两个会切换页面的阶段显示测试窗口；隐藏窗口可能暂停requestAnimationFrame，导致转场后的Memory/Embedding控件永远未挂载。保持原断言、Mock与持久化检查；没有放宽超时或删除失败断言，不改变正式应用逻辑。
- 新增本报告及全部文件清单。没有删除、移动或归档任何既有源文件；17项D均为开工前已有删除，继续保留。没有新增依赖、配置机制、Memory功能、关系类型或架构层。

## 3. 正式链路与保留边界

| 责任 | 正式实现与核查结论 |
| --- | --- |
| Stage Web | stage.ts保存已交付交互，note-formation.ts用既有Provider执行Formation/闲置语义任务；配置复用ConfigStore和Memory页，EmbeddingForm非独立凭据系统。 |
| Main Formation/Organization | note-formation.cjs重建可信输入、校验主体/来源/版本、管理持久作业与固定操作ID、恢复Receipt；note-organization-v2.mjs负责增量候选与受限授权，note-semantic-contract.mjs负责原文锚点与关系计划。 |
| Store / Worker | Store在信任边界复验来源与资格，protocol校验请求；Worker使用独立Node24.12.0/LadybugDB0.22.1。Note、Revision、Receipt、Evidence与关系写入使用事务；UNKNOWN结果凭稳定ID与fingerprint确认，不能直接重复创造新操作。 |
| Note Network | NOTE_LINK保存类型、双端版本、来源、状态和时间。UPDATE/SUPERSEDE/RETRACT使旧边stale；UNLINK保留撤销，删源清除依赖。ASSOCIATED_WITH是导航而非事实支持，不沿普通语义邻接删除独立另一端；HAS_CONTEXT仍保守参与隐私闭包。 |
| Embedding / 检索 | note-embedding.cjs限制DashScope HTTPS、凭据来源、批次/维度/响应；note-candidates.mjs稳定投影并融合BM25/metadata/vector名次。Adapter保存向量并使用HNSW或最多2048向量exact回退；模型空间、版本和contentHash隔离迟到结果。 |
| Associative Recall | Main限制3个种子、8次节点邻接访问、16条边、12端点/路径、最多2跳；两端版本与来源复验。Renderer重新验原文、裁剪话题/历史/关系，最终3条/2000字符，Core当前Context优先且不增加token预算。 |
| 生命周期 | memory-lifecycle/erasure保留持久意图、永久屏障与历史依赖擦除；故障时失败关闭。数据库不可用时聊天可降级到Context/Raw，但不能据此绕过删除屏障。 |

必须继续保留：

- Reflection Store/Formation/Recall、legacy-memory.ts、Note v1、@aisling/core/legacy-recall：旧Profile仍经main.ts按桥能力加载，迁移及历史擦除也依赖它们；不是确认无依赖的垃圾。
- memory-migration、memory-archive、P0协议/fixture和故障注入：由持续回归和恢复逻辑引用，不能以“实验”命名为由删除。
- note-v1.cjs：是v1/v2共用合同，不宜按文件名删除或重命名。受信Main、Store和Worker的多层校验属于信任边界，不当作重复实现裁掉。
- note-organization-v2、note-semantic-contract与note-candidates：分别承担授权、语义合同与候选检索；本轮未发现足以安全合并/删除整层的证据。
- memory-organization-smoke.cjs保留持续旧路径测试价值，但未提交semanticLive分支属于旧实验混杂，需单独裁决。两份旧未跟踪smoke保留原状，不自动运行真实Provider。
- P0–P5基线、自主Organization、P6、P7、P7.1及research结论保留研究价值。17份已删除旧报告的重要阶段结论已由工程基线和研究摘要承接；本轮没有恢复原文件覆盖前轮决定，也没有把这些删除记为自己的成果。

## 4. 审计发现、风险与发布判断

1. **已处理的发布隐私风险**：私人reports包原本是147个可被git add带入的未跟踪文件，包含真实会话种子和请求/响应。现已忽略并保留本地。发布必须继续使用显式文件清单，禁止强制添加私人资料。
2. **已处理的验证缺陷**：生产Mock烟测在隐藏窗口切换路由时不稳定；最小夹具修复已保留原断言。旧组织首次两项取消/超时，单文件复验5/5通过；未修改生产逻辑，不能据一次被延迟的运行断定存在产品性能退化。
3. **仍需人工处理的Git分叉**：main领先3落后1，不能直接认为可安全Push。远程独有5deab5e只改idle-life.ts；main自共同祖先f79ff82的提交及当前工作区不改该文件，静态路径无交集，但未实际合并、未证明合并后测试通过。
4. **备份分支不是发布支线**：backup/pre-history-cleanup没有upstream，与main/origin/main没有共同祖先，是历史重写前备份；不应直接合并或将5个旧发布提交当Memory功能Push。
5. **P7.1语义收益仍未证实**：原C组无有效图，B/C向量降级条件不同；后来2/2允许关联不代表普遍准确率，负例没有实际进入这些候选，未做修正后真实回答复验。本轮不开展新的付费实验，不把工程绿灯写成最终回答收益。
6. **原生运行资源损坏限制**：持久HNSW依赖固定扩展和OpenSSL；丢失依赖后不能承诺写入/删除自动无损回退。必须恢复资源，不能绕过失败关闭。新库exact回退与“损坏持久HNSW写回退”是不同场景。
7. **尚非可分发产品验收**：无本轮安装包/签名/升级卸载/首次MSI安装与第三方二进制再分发验收。真实长期Profile、大库上限、长期负载和语义质量未重新验收。现有key按本地ConfigStore保存，不承诺加密凭据库。

源码整理的结论：未确认可以无风险删除的完整运行模块；保留兼容和恢复比为净行数删除更重要。本轮是依赖与发布准备审计，不是形式化安全证明，也未逐行读完所有Live2D/audio/原生采集器代码。

## 5. 本轮验证（真实执行，不继承历史通过数）

| 项目 | 结果与边界 |
| --- | --- |
| pnpm test | 沙箱首轮Core 4项本机HTTP Mock被阻断（108通过/4失败）；沙箱外全量复跑Core112/112、Stage Web410/410通过。均为合成/Mock，不调用真实Provider。 |
| Desktop缺少资源变量的首轮 | 118项中56通过、62跳过；不能称全量通过。 |
| Desktop带资源默认并行 | 92通过/26失败，默认Worker资源启动锁竞争。未删锁或削弱校验，改用既有串行运行方式。 |
| Desktop首次串行 | 114通过、2失败、2取消；两项UI挂载失败，两项旧组织超时。保留日志，没有抹除失败记录。 |
| 定位复验 | 旧组织5/5通过；原生关联11项与Formation Electron1项共12/12通过。向量实测报告hnsw，包含持久重开/模型切换/修改撤销删源/exact回退及生产Mock注入。 |
| Desktop最终完整串行 | 118/118通过，0失败/取消/跳过，约284.8秒；包含真实Windows Worker/LadybugDB、HNSW与exact、迁移/删源/Receipt恢复、Vite与生产Electron Mock链路。 |
| pnpm typecheck | Core、Stage Web、Desktop选定JS入口checkJs全部通过；不是覆盖所有MJS的形式化类型证明。 |
| pnpm build | 生产构建通过；主chunk约797.17kB，保留既有>500kB提示，未引入拆包重构。 |
| Git差异 / 文档 | diff --check及cached检查通过；Markdown本地目标路径核查见收尾检查，未对全部外部站点链接联网验证。 |
| 本轮真实Provider | 未执行。旧P7/P7.1真实Embedding、Organization、Core观察仅作为标明限制的历史证据。 |

本地日志：.tmp/audit-workspace-tests.log、audit-workspace-tests-full.log、audit-desktop-tests.log、audit-desktop-tests-full.log、audit-desktop-tests-serial.log、audit-organization-recheck.log、audit-ui-recheck.log、audit-desktop-final.log、audit-typecheck.log、audit-build.log。数据库/测试Profile均位于artifacts或测试临时目录，未使用真实用户Profile；未刷新/改写用户数据库或Worker资源。

## 6. A — 已提交但未进入已知远程的全部提交

| Commit Hash | 说明 | 所属本地分支 | 变更文件数 | 主要文件 |
| --- | --- | --- | ---: | --- |
| `3204a51c400ebff05ed3fa8a047ec172110a32ec` | docs(memory): record note-only engineering baseline | `main` | 1 | docs/memory-note-only-engineering-baseline.md |
| `dbd88f3af3a0de2683fbe5f5300f4bd3261d77eb` | refactor(memory): consolidate note-only memory architecture | `main` | 89 | README.md,apps/stage-desktop/desktop-app.cjs,apps/stage-desktop/memory-database/adapter.cjs,apps/stage-desktop/memory-database/store.cjs,apps/stage-desktop/memory-organization.cjs,apps/stage-desktop/note-formation.cjs,packages/core/package.json,packages/core/src/runtime.ts |
| `271d19e4a564993c22ed599076cff37cf9095720` | chore(memory): checkpoint validated memory database and organization baseline | `main` | 80 | apps/stage-desktop/desktop-app.cjs,apps/stage-desktop/memory-database/adapter.cjs,apps/stage-desktop/memory-database/package.json,apps/stage-desktop/memory-database/store.cjs,apps/stage-desktop/memory-organization.cjs,apps/stage-desktop/package.json,packages/core/src/runtime.ts |
| `2f4762d742c4bac904cc4b345d845fe9af223eff` | release: v0.2.7 | `backup/pre-history-cleanup` | 31 | README.md,apps/stage-desktop/desktop-app.cjs,apps/stage-desktop/package.json,apps/stage-web/package.json,package.json,packages/core/package.json,packages/core/src/runtime.ts |
| `6b1d2f59e44980be91c894930284135beb2b2a9c` | release: v0.2.5 | `backup/pre-history-cleanup` | 78 | apps/stage-desktop/desktop-app.cjs,apps/stage-desktop/package.json,apps/stage-web/package.json,apps/stage-web/public/live2d/README.md,apps/stage-web/src/runtime/autonomous.ts,package.json,packages/core/package.json,packages/core/src/runtime.ts |
| `0a0fb26867f464d9d88af94cefda8e5bf00eda90` | refactor(autonomous): simplify Jev interrupt decision | `backup/pre-history-cleanup` | 6 | apps/stage-web/src/runtime/autonomous.ts |
| `85cd58fa0cb65da66399b6d8b6feb32418608f35` | feat: productize Electron desktop runtime v0.1.8 | `backup/pre-history-cleanup` | 46 | README.md,apps/stage-desktop/desktop-app.cjs,apps/stage-desktop/package.json,apps/stage-web/package.json,apps/stage-web/src/runtime/autonomous.ts,package.json,packages/core/src/runtime.ts |
| `85c5d0ca38fa0653e64872948dae8d86b90f5eb5` | feat: establish Aisling v0.1.6 runtime baseline | `backup/pre-history-cleanup` | 97 | README.md,apps/stage-web/package.json,package.json,packages/core/package.json,packages/core/src/runtime.ts |

main的3个提交均位于origin/main..main；上游独有提交为5deab5ea289d001c43df5fc8e24cc52d7051d3f7（refactor: reuse gaze acceleration scale），不是本地未推送提交。backup的5个提交不被任何现有远程引用包含，但该分支没有上游，不能写作“领先自己的upstream5”。未提交文件不属于上述Commit。

## 7. B — 整理后全部未提交文件

共84项，含本报告自身。M/D均为未暂存，??为未跟踪，暂存区为空；“保留提交”是审阅建议，不代表本轮已暂存。除标明本轮修改的.gitignore、README、docs/README、research摘要、烟测debug和本报告外，表内改动均为原工作区跨阶段积压。

| 相对文件路径 | Git状态 | 主要改动 | 阶段/模块 | 建议 |
| --- | --- | --- | --- | --- |
| `.gitignore` | M | 排除私人 reports 研究包和 .tmp 中间文件；本轮新增规则。 | 发布安全 | 保留提交（按依赖分组审阅） |
| `README.md` | M | 更新 Note v2、Embedding/HNSW/RRF/关联召回、职责与验证限制；说明完整 Desktop 测试条件。 | 当前入口 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/desktop-app.cjs` | M | 统一开发/构建权威、受信 IPC、Formation/语义后台与向量配置接线。 | 运行时对齐 / P6–P7.1 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/desktop-diagnostics.test.cjs` | M | 更新受信诊断边界的回归。 | 运行时对齐 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/desktop-store.cjs` | M | 同步存储 IPC 的顶层窗口与目标 origin 校验。 | 运行时对齐 / 持久化 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/desktop-store.test.cjs` | M | 存储桥 origin/frame 及旧接口权限回归。 | 运行时对齐 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/main.cjs` | M | 标准入口统一新 Profile 的 Note v2 策略与错误处理。 | 启动 / 权威 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/memory-authority.cjs` | M | 区分新资料、旧会话、迁移及可启动 v2 的条件。 | 权威 / 兼容 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/memory-database.test.cjs` | M | 默认资源脚本一致性、锁和篡改拒绝测试。 | Worker 回归 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/memory-database/adapter.cjs` | M | 关系/向量表、HNSW及exact查询；初始化加载持久索引扩展。 | P6–P7.1 / 数据库 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/memory-database/client.cjs` | M | 固定脚本与 OpenSSL 完整性检查、资源更新锁和隔离启动。 | Worker 资源 / P7.1 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/memory-database/erasure.cjs` | M | 擦除关系/向量相关派生数据，保持永久屏障。 | 删源 / P6–P7 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/memory-database/note-v1.cjs` | M | 扩展 v2 关系合同、版本复验、Receipt与关系失效；文件名兼容旧Schema。 | P6–P7 / 共享合同 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/memory-database/protocol.cjs` | M | 声明并验证关系、历史与向量请求，保留协议边界。 | P6–P7 / Worker | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/memory-database/store.cjs` | M | 来源资格、关系/向量写入复验、历史认识读取和串行化。 | P6–P7 / Store | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/memory-database/store.d.ts` | M | 同步Store、关系、历史和向量接口类型。 | P6–P7 / 类型 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/memory-migration-smoke.cjs` | M | 开发/构建 Profile、确认与重启路径的隔离冒烟。 | 迁移 / 运行时对齐 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/memory-migration.test.cjs` | M | 开发入口、Profile独占锁、阻断/升级与重启测试。 | 迁移 / 启动器 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/memory-organization-smoke.cjs` | M | 已有未提交差异增加 semanticLive、单轮形成及预算/超时分支；不属于本轮改写。 | 旧 v1 实验 / 回归 | 继续整理：拆开旧真实实验分支与持续Mock回归 |
| `apps/stage-desktop/note-formation-contract.d.mts` | M | Formation语义提议与来源合同类型。 | P6 / 合同类型 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/note-formation-contract.mjs` | M | 提议解析、原子认识、state与逐项合法性检查。 | P6 / 合同 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/note-formation-smoke.cjs` | M | 扩展既有生产Mock冒烟；本轮仅让write/associative两个UI阶段显示窗口，避免隐藏转场停帧。 | 运行时 / P6–P7.1 / 本轮debug | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/note-formation.cjs` | M | 持久作业、授权与Receipt恢复、语义任务、向量补建、融合候选与有界图召回。 | P6–P7.1 / Main | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/note-v2-lifecycle.test.cjs` | M | 未标记旧资料的启动预期与删除/恢复回归。 | 生命周期 / 兼容 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/package.json` | M | dev脚本改为统一桌面启动器；版本和依赖未改。 | 启动 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/preload.cjs` | M | 扩展候选及邻居桥接；维持sandbox/contextIsolation。 | P6–P7 / IPC | 保留提交（按依赖分组审阅） |
| `apps/stage-web/src/config/local-storage-config-store.test.ts` | M | Embedding配置恢复、凭据来源白名单与兼容检查。 | P7.1 / 配置回归 | 保留提交（按依赖分组审阅） |
| `apps/stage-web/src/config/local-storage-config-store.ts` | M | 恢复Embedding的endpoint/model/credentialSource及专用key。 | P7.1 / 配置 | 保留提交（按依赖分组审阅） |
| `apps/stage-web/src/env.d.ts` | M | Renderer中候选、关系与向量接口声明。 | P6–P7 / IPC类型 | 保留提交（按依赖分组审阅） |
| `apps/stage-web/src/i18n.ts` | M | Memory后台组织、向量配置与凭据状态双语说明。 | P6–P7.1 / 文案 | 保留提交（按依赖分组审阅） |
| `apps/stage-web/src/pages/settings/memory.vue` | M | 复用EmbeddingForm并说明有界后台调用。 | P6–P7.1 / 设置 | 保留提交（按依赖分组审阅） |
| `apps/stage-web/src/runtime/note-formation.ts` | M | 复用既有Provider执行闲置语义任务，保留取消和超时。 | P6 / Provider执行 | 保留提交（按依赖分组审阅） |
| `apps/stage-web/src/runtime/note-v2-recall.test.ts` | M | 演化/冲突、关联路径、跨措辞候选、来源和预算边界。 | P6–P7.1 / Recall回归 | 保留提交（按依赖分组审阅） |
| `apps/stage-web/src/runtime/note-v2-recall.ts` | M | 融合候选、有界邻居与历史认识投影；保留直接命中、验源和3条/2000字符预算。 | P6–P7.1 / Recall | 保留提交（按依赖分组审阅） |
| `apps/stage-web/src/stores/settings.ts` | M | Embedding配置保存到既有ConfigStore。 | P7.1 / 设置 | 保留提交（按依赖分组审阅） |
| `apps/stage-web/src/stores/stage-persistence.test.ts` | M | 增加旧记忆不可用时storeToRefs仍能读取页面状态的回归。 | 启动Bug修复 | 保留提交（按依赖分组审阅） |
| `apps/stage-web/src/stores/stage.ts` | M | 接语义任务；用响应式ref承载可选旧字段，避免storeToRefs读取undefined崩溃。 | 运行时 / 启动Bug修复 | 保留提交（按依赖分组审阅） |
| `docs/desktop-host.md` | M | 更新开发Profile、统一权限和Worker准备入口。 | 当前工程说明 | 保留提交（按依赖分组审阅） |
| `docs/formation-ab-results.md` | D | 旧Formation A/B实验结果；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/formation-failure-analysis.md` | D | 旧Formation失败分析；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/memory-database-audit.md` | D | 早期数据库审计；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/memory-database-p0.md` | D | P0数据库工程实验；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/memory-formation-v0.md` | M | 标明旧Profile范围与当前v2入口。 | 旧路径兼容文档 | 保留提交（按依赖分组审阅） |
| `docs/memory-note-only-engineering-baseline.md` | M | 标明历史时效、已清理报告和后续运行时对齐入口。 | P0–P5历史基线 | 保留提交（按依赖分组审阅） |
| `docs/memory-note-only-p0.md` | D | Note-only P0设计；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/memory-note-only-p1-formation.md` | D | Note-only P1形成；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/memory-note-only-p2-lifecycle.md` | D | Note-only P2生命周期；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/memory-note-only-p3-transition.md` | D | Note-only P3过渡；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/memory-note-only-p4-migration.md` | D | Note-only P4迁移；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/memory-note-only-p5-retirement.md` | D | Note-only P5退役；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/memory-note-p1-2.md` | D | 旧Note P1.2阶段记录；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/memory-organization-adaptation.md` | D | 旧组织适配记录；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/memory-organization-p1-6.md` | D | 旧组织P1.6阶段记录；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/memory-organization-p1-7.md` | D | 旧组织P1.7阶段记录；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/memory-organization-p15.md` | D | 旧组织P1.5阶段记录；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/memory-p1-8-audit.md` | D | 旧P1.8审计；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/memory.md` | M | 说明v2权威、P6/P7/P7.1与旧资料/Raw Recall边界。 | 当前Memory说明 | 保留提交（按依赖分组审阅） |
| `docs/reflection-recall.md` | M | 明确旧Profile适用范围，连接当前说明。 | 旧路径兼容文档 | 保留提交（按依赖分组审阅） |
| `docs/reflection-value.md` | D | 旧Reflection价值实验；开工前已删除，重要结论由工程基线/研究说明承接，本轮未执行删除。 | 既有历史文档收束 | 保留删除待审；不恢复覆盖前轮决定 |
| `docs/research/memory-validation.md` | M | 归并早期失败/恢复结论；本轮补存11-02局部纠正收益及不可外推限制。 | 历史真实验证 | 保留提交（按依赖分组审阅） |
| `packages/core/src/config.ts` | M | 既有Memory配置增加可选Embedding字段，非新增Provider机制。 | P7.1 / 配置类型 | 保留提交（按依赖分组审阅） |
| `packages/core/src/runtime.ts` | M | 明确演化/冲突/历史认识的使用策略；不增加Recall预算。 | P6 / 证据装配 | 保留提交（按依赖分组审阅） |
| `scripts/dev-desktop.mjs` | M | 等待本次Vite监听、独立开发Profile、迁移重启复用Vite与生命周期清理。 | 运行时对齐 | 保留提交（按依赖分组审阅） |
| `scripts/prepare-memory-database.ps1` | M | 安全刷新/资源备份、固定原生依赖/OpenSSL及扩展缓存校验。 | Worker / P7.1 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/memory-note-recall-smoke.cjs` | ?? | 合成Note注入/可选真实Provider入口；不在默认持续测试中，无硬编码密钥。 | 旧 P1.8 实验 | 待人工判断：保留本地，建议另行归档；不与正式能力混提 |
| `apps/stage-desktop/memory-semantic-smoke.cjs` | ?? | W0/W1对照；可从历史提交加载旧writer，不属于当前v2正式能力。 | 旧 P1.8 实验 | 待人工判断：保留本地，建议另行归档；不与正式能力混提 |
| `apps/stage-desktop/note-associative.test.cjs` | ?? | 11项混合候选、原生向量、关系/两跳、失败恢复与生产注入。 | P7 / 持续回归 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/note-candidates.d.mts` | ?? | 候选融合与稳定向量投影类型声明。 | P7 / 类型 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/note-candidates.mjs` | ?? | 稳定embedding投影、BM25/metadata/embedding候选及RRF去重。 | P7 / 检索 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/note-embedding.cjs` | ?? | DashScope凭据解析、空间身份、批次/维度/响应上限与超时校验。 | P7–P7.1 / 向量Provider | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/note-organization-v2.mjs` | ?? | 增量索引、有限候选、动作授权及确定性状态关系计划。 | 自主Organization / P6 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/note-organization-v2.test.cjs` | ?? | 来源授权、2048覆盖边界、关系事务、回滚/丢回包恢复。 | 自主Organization / 持续回归 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/note-semantic-contract.d.mts` | ?? | 语义任务、关系提议和输入合同类型。 | P6–P7 / 类型 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/note-semantic-contract.mjs` | ?? | 语义输入与关系解析、原始引文、scope与导航关系限制。 | P6–P7 / 合同 | 保留提交（按依赖分组审阅） |
| `apps/stage-desktop/note-semantic.test.cjs` | ?? | 原始锚点、版本竞争、预算账本、关系恢复与生产Core投影。 | P6 / 持续回归 | 保留提交（按依赖分组审阅） |
| `apps/stage-web/src/components/settings/EmbeddingForm.vue` | ?? | 复用SettingsSelect和保存提示；本地专用/复用凭据，不把配置可用当联网鉴权。 | P7.1 / 配置UI | 保留提交（按依赖分组审阅） |
| `apps/stage-web/src/runtime/note-formation.test.ts` | ?? | Provider语义任务执行与Formation pump生命周期测试。 | P6 / 持续回归 | 保留提交（按依赖分组审阅） |
| `docs/README.md` | ?? | 区分当前指南、阶段报告、旧兼容与本地私人材料。 | 本轮文档入口 | 保留提交（按依赖分组审阅） |
| `docs/memory-associative-network-p7.md` | ?? | Embedding/HNSW/exact/RRF/关联检索设计与当时限制。 | P7历史实施 | 保留提交（按依赖分组审阅） |
| `docs/memory-autonomous-organization.md` | ?? | 原始字面授权、持久任务、Note Network与删源语义。 | 自主Organization历史实施 | 保留提交（按依赖分组审阅） |
| `docs/memory-development-runtime-alignment.md` | ?? | 开发/构建一致性、Worker首次准备/刷新、Profile锁及验证范围。 | 当前工程 / 验证记录 | 保留提交（按依赖分组审阅） |
| `docs/memory-organization-p6.md` | ?? | 纵向语义组织与演化Recall；保留真实模型失败和工程/语义区别。 | P6历史实施 | 保留提交（按依赖分组审阅） |
| `docs/memory-p7-1-validation.md` | ?? | Windows HNSW、Embedding配置及原始对照失败、后续2边小样本和收益未证实。 | P7.1真实验证 | 保留提交（按依赖分组审阅） |
| `docs/repository-audit-2026-11-12.md` | ?? | Git完整积压、实际整理、回归结果、敏感边界和提交/发布建议。 | 本轮审计 | 保留提交（按依赖分组审阅） |

## 8. C — 不进入GitHub的资料及忽略检查

| 路径/模式 | 内容与结果 |
| --- | --- |
| reports/reflection-recall-ab-test-2026-11-02/ | 147文件，本轮新排除；含真实会话种子、原始请求/回答、研究harness及审批记录；完整逐文件清单在下方。 |
| .local/desktop-dev-profile/、apps/stage-web/.local/ | 本地资料与凭据、会话、记忆数据库；已忽略。 |
| .local/memory-database/及.previous-* | 独立Node、LadybugDB、HNSW/OpenSSL和Worker脚本副本；运行资源和备份，已忽略；仓库只保留准备脚本/锁文件。 |
| artifacts/ | 各P0–P7.1隔离数据库、真实实验原始证据与本轮合成测试输出，已忽略。 |
| .tmp/、*.log、*.jsonl、coverage/ | 本轮审计脚本/快照/日志、诊断和测试中间产物，已忽略。 |
| .env、.env.*（除.env.example） | 本地凭据配置，规则验证有效；本轮没有创建/打印凭据。 |
| aisling-store.json、aisling-reflections.v1.json | 个人配置/会话与旧结构化记忆；已忽略。 |
| *.lbdb、*.lbdb.wal、memory-authority | 本地数据库及权威标记；已忽略。 |
| memory-erasure.v[12].json、memory-migration.v1.json、memory-migration-dispositions.v1.json、note-formation-jobs.v1.json | 删除/迁移/组织账本与持久任务，可能含来源和正文；已忽略。 |
| node_modules/、.pnpm-store/、dist/、.vite/、.agent-work/ | 依赖/缓存/构建/本地任务资料，已忽略。 |

git check-ignore -v实际验证reports种子、.tmp脚本、.local资料、artifacts实验、.env、数据库/WAL及作业/权威文件。git ls-files未发现Profile store、数据库、JSONL、环境密钥文件或exe/dll被跟踪；锁文件与env.d.ts是正式源码，应保留。初轮源码/研究包常见sk-/GitHub/AWS/私钥/Bearer模式扫描未命中；8个本地未发布提交的428个文件补丁进一步扫描常见密钥及长字面量apiKey，未命中。未把扫描无命中当作所有隐私数据已脱敏，真实对话本身仍不可整体公开。

### 原工作区147个研究文件：逐项从??转为ignored，全部保留本地

| 相对文件路径 | Git状态变化 | 内容 | 模块 | 建议 |
| --- | --- | --- | --- | --- |
| `reports/reflection-recall-ab-test-2026-11-02/README.md` | ?? → ignored | 历史研究说明/审批记录 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/analysis.md` | ?? → ignored | 历史研究说明/审批记录 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/approval-block.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/completion.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/evaluation.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/ground-truth.json` | ?? → ignored | 真实语料种子/参考资料 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/mode.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/seed-store.json` | ?? → ignored | 真实语料种子/参考资料 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/S1-T1-A-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/T1-A-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/T1-A-1-attempt2.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/T1-A-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/T1-A-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/T2-A-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/T2-A-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/T2-A-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/T3-A-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/T3-A-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/T3-A-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/T4-A-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/T4-A-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/T4-A-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/T5-A-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/T5-A-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/A/trials/T5-A-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/mode.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/seed-store.json` | ?? → ignored | 真实语料种子/参考资料 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/S2-T2-C-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/T1-C-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/T1-C-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/T1-C-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/T2-C-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/T2-C-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/T2-C-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/T2-C-3-attempt2.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/T3-C-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/T3-C-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/T3-C-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/T4-C-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/T4-C-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/T4-C-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/T5-C-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/T5-C-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/groups/C/trials/T5-C-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/harness/build.mjs` | ?? → ignored | 冻结旧实验harness | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/harness/diagnostic-injections.json` | ?? → ignored | 冻结旧实验harness | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/harness/entry.ts` | ?? → ignored | 冻结旧实验harness | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/harness/evaluate.mjs` | ?? → ignored | 冻结旧实验harness | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/harness/finalize.mjs` | ?? → ignored | 冻结旧实验harness | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/harness/production-observed.mjs` | ?? → ignored | 冻结旧实验harness | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/harness/production-pristine.mjs` | ?? → ignored | 冻结旧实验harness | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/harness/report.mjs` | ?? → ignored | 冻结旧实验harness | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/harness/run.mjs` | ?? → ignored | 冻结旧实验harness | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/harness/verify.mjs` | ?? → ignored | 冻结旧实验harness | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/injection-audit.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/injection-audit.md` | ?? → ignored | 历史研究说明/审批记录 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/integrity-report.md` | ?? → ignored | 历史研究说明/审批记录 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/manifest.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/network-authorization.md` | ?? → ignored | 历史研究说明/审批记录 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/pending-approval.md` | ?? → ignored | 历史研究说明/审批记录 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/preflight-checks.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/preflight/provider-messages/T1-A.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/preflight/provider-messages/T1-C.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/preflight/provider-messages/T2-A.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/preflight/provider-messages/T2-C.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/preflight/provider-messages/T3-A.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/preflight/provider-messages/T3-C.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/preflight/provider-messages/T4-A.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/preflight/provider-messages/T4-C.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/preflight/provider-messages/T5-A.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/preflight/provider-messages/T5-C.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/S1-T1-A-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/S2-T2-C-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T1-A-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T1-A-1-attempt2.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T1-A-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T1-A-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T1-C-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T1-C-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T1-C-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T2-A-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T2-A-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T2-A-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T2-C-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T2-C-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T2-C-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T2-C-3-attempt2.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T3-A-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T3-A-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T3-A-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T3-C-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T3-C-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T3-C-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T4-A-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T4-A-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T4-A-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T4-C-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T4-C-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T4-C-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T5-A-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T5-A-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T5-A-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T5-C-1-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T5-C-2-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/provider-messages/T5-C-3-attempt1.json` | ?? → ignored | 原始Provider请求或响应 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/S1-T1-A-1-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/S2-T2-C-3-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T1-A-1-attempt2.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T1-A-2-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T1-A-3-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T1-C-1-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T1-C-2-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T1-C-3-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T2-A-1-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T2-A-2-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T2-A-3-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T2-C-1-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T2-C-2-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T2-C-3-attempt2.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T3-A-1-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T3-A-2-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T3-A-3-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T3-C-1-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T3-C-2-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T3-C-3-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T4-A-1-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T4-A-2-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T4-A-3-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T4-C-1-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T4-C-2-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T4-C-3-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T5-A-1-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T5-A-2-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T5-A-3-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T5-C-1-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T5-C-2-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/responses/T5-C-3-attempt1.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/results.md` | ?? → ignored | 历史研究说明/审批记录 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/schedule.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/snapshots/master.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/snapshots/source-provenance.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/snapshots/source-validation.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/summary.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/supplementary-retests.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/supplementary-retests.md` | ?? → ignored | 历史研究说明/审批记录 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/supplementary-schedule.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |
| `reports/reflection-recall-ab-test-2026-11-02/verification.json` | ?? → ignored | 实验账本/配置/校验输出 | 旧Reflection A/C研究 | 忽略，保留本地，公开前单独脱敏审阅 |

## 9. D — 所有本地分支与潜在冲突

| 分支 | HEAD / 上游 | 与origin/main差异 | 结论 |
| --- | --- | --- | --- |
| main | 3204a51；origin/main | 本地3 / 远程1；共同祖先f79ff82def983a3444245a48feaf38a9e58cb849 | 当前功能分支，需在后续授权中整合远程独有gaze修改并回归；本轮未合并。 |
| backup/pre-history-cleanup | 2f4762d；无upstream，仅本地 | 该分支5 / origin42；与main为main44 / backup5；没有共同祖先 | 历史备份，保留，不建议混合历史或发布。 |

仅origin/main一个远程分支与origin/HEAD符号引用。没有额外Worktree或Stash；未进行冲突试合并。main与远程目前静态改动路径不重合不等于可以跳过后续集成验证；backup属于不同历史，不能套用普通功能分支合并判断。

## 10. 后续提交、发布条件与人工裁决

建议按依赖形成可审阅的提交，而不是按文件扩展名或一次git add全树：

1. 运行时对齐与启动修复：统一启动器、Profile/权威、IPC/Worker刷新及其回归，带stage响应式字段修复。相关文件已有多阶段改动，需按hunk审阅，不能假设整文件只属于该阶段。
2. Autonomous Organization/P6：共享合同、授权/任务、关系事务/删源与演化Recall及持续回归，连同其必要类型和Core策略。
3. P7/P7.1：候选/embedding、Worker向量与原生资源准备、关联遍历/预算、设置/凭据恢复和对应回归；HNSW初始化加载修复必须和资源校验说明一起保留。
4. 验证夹具修正：如独立提交，明确隐藏窗口动画帧原因，保持原断言；也可随对应P7.1回归组纳入。
5. 文档/发布安全：忽略规则、README、当前/历史入口、研究摘要、本报告和经审阅的17份旧报告删除。不要把私人reports包纳入任何提交。

上述是拆分方案，不是已经证明各中间提交独立可运行。Main/Store/Renderer跨阶段共享文件较多，真正暂存时需在隔离快照中验证每组依赖完整；本轮没有自动暂存或制造checkpoint。

人工裁决：

- 两个旧未跟踪smoke和memory-organization-smoke中的semanticLive差异是否迁入专门历史归档，或只保留持续Mock回归；本轮未擅删。
- 确认17份已有文档删除与摘要承接满足研究保留要求，再将D纳入文档提交。
- 后续获取远程最新状态并决定main分叉整合方式；不要强推，不发布backup历史。
- 发行前另行审查固定二进制/许可证再分发、安装包、签名、升级卸载、受损HNSW恢复指引和真实Profile验收。
- 如要声称横向关联/回答收益，需另行授权冻结多问题与检索冷热条件的真实Provider评测；当前限制必须继续公开。

**安全提交条件：具备按明确清单、排除私人资料、补齐跨阶段依赖后分组审阅提交的基础；不具备“整个工作区直接全量提交”的无条件结论。** 两份旧smoke及混杂实验差异需裁决，阶段文档删除需确认，最终Desktop结果见验证表。

**安全推送条件：目前不具备。** main与已知远程分叉且远程未刷新，本轮工作尚未提交/审阅，backup是不同历史；需后续单独授权整合及验证。**安装包发布也未就绪**，工程回归不替代分发与真实语义验收。
