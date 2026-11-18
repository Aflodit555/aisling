# Memory v0.4.0 P4-A：Reflection 历史复审与 Note v2 迁移准备

> 公开脱敏候选：真实认识、记录标识、机器路径及私有校验值仅在私人归档保留。占位标识只用于本文说明，不可运行或跨页关联；本页仍记录原阶段的测试与限制，不代表本次重新验收。


本轮已完成 40/40 条独立复审及隔离迁移演练；没有正式迁移。语义判断由 Codex 逐条阅读原始材料作出，尚待用户审阅，不是 LLM API 实测或程序自动事实认证。P4-A 在此停止，不进入 P4-B。

## 1. 本轮基线、范围与工作区

2026-11-18 重新检查真实文件、P2/P3.1 报告及源码。分支为 `feat/obsidian-memory-mirror`，起点 `ffb19750e32ac87896ea8018216a217c7724639b`，版本 v0.3.9；开工时已暂存、未暂存、未追踪代码均为空。保留 P0/P1/P2/P3/P3.1 提交和历史备份，没有重写提交。当前正常 dev/prod 入口仍使用 P2 的统一 Profile。

提交范围仅为本报告、`scripts/rehearse-reflection-migration.cjs` 及其测试，共 3 文件；备份、原文、Manifest、私有审查附录、隔离库和测试 Vault 位于被忽略的 artifacts，临时核验脚本/日志位于被忽略的 .tmp。两类路径均实际通过 git check-ignore。没有更改忽略规则、版本、Schema、Profile 权威、Formation、Recall、Organization 或旧 Reflection 业务代码。未推送、合并、发布或清理分支。本报告与工具属于同一 P4-A 本地检查点，提交 SHA 可由 `git log -1 -- docs/memory-v0.4.0-p4a-reflection-review.md` 查看。

## 2. 审查包、真实数据位置与完整性

完整原文、时间、来源、数据库标识、逐条语义判断及冻结 Manifest 仅在独立私人归档中保留。公开版使用审查编号表达处置和技术过程，不提供反查真实记录的映射，也不作为可执行迁移指令。

- 正式 Profile：`%APPDATA%\@aisling\stage-desktop-note-v2`。39 Session / 356 Message；当前 Note=19。Memory=true、Formation=false、Note Recall=true；Mirror 配置保留，未启动真实 Mirror。
- 权威归档：`legacy-profile-archive/aisling-reflections.v1.json`，实际 40 条且 ID 全部唯一。根结构为 version=1、reflections、progress、batches；progress=34、batches=65。每条包含 version/id/content/kind/basis/tags/sourceRefs/relatedReflectionIds/createdAt/可选 uncertainty。sourceRefs 是 sessionId/messageIndex/digest；原 createdAt 是记录形成时间，不等于事件发生日期。
- 旧默认 Profile `%APPDATA%\@aisling\stage-desktop` 仍有封存的 40 条同内容副本；Reflection 文件 SHA-256 与正式归档一致，均为 `<PRIVATE_SHA256>`。旧开发 Profile `.local/desktop-dev-profile` 没有独立 Reflection JSON。旧根和历史备份仍保持原状，不另设数据权威。
- 86 个原 sourceRef 引用中 82 个在正式 Raw 和归档 Raw 均能按 digest 匹配；38 条记录全部来源可追溯。R01、R24 共 4 个引用对应的 Session 均缺失，两套 Raw 都不能补足。当前删除日志未把这两个 Session 列为已有屏障，仍不能据此绕过删除责任或从旧备份擅自复活它们。
- 5 条记录原始映射全部为 assistant；其余也有混合/模型概括，来源可追溯不等于内容真实。逐条对照实际 role、上下文和用户是否确认，不把 assistant 复述当用户 Evidence。
- Formation jobs 实际 21 批（14 completed、7 failed）；不重放。当前 erasure.pending=0，库内 5 条 MemoryErasure 和 5 条 MemoryTombstone 全部保留。没有因迁移演练修改配置或解除旧根封存。

## 3. A/B/C/D/E 分类与全部 40 条复审

| 分类 | 条数 | 处置 |
| --- | ---: | --- |
| A 值得迁移 | 9 | 按原始用户证据缩小内容，提出 10 个 ADD，待用户审阅 |
| B 已有 Note 覆盖 | 4 | 不创建、不更新，保留现有 Note |
| C 已过时或被修正 | 2 | 保留历史原件，不作为当前状态新增 |
| D 缺少充分证据 | 5 | 不迁移为事实 |
| E 低价值或无独立价值 | 20 | 不新增；含临时问答、助手猜测和重复 |

下面 user/assistant 数字是原映射引用数，非对语义质量评分。R17 的原来源全为助手，但在独立 Raw 中找到用户本人佐证，只迁移可佐证的部分；完整独立来源见私有附录。各行的价值、有效性、覆盖、矛盾和最终原因均已逐条评估；A 类是历史自述，未发现撤回不证明今天仍然有效。

| 复审号 | 原 Reflection ID | 类别 | user/assistant；追溯 | 拟操作 | 独立判断及处置原因 |
| --- | --- | --- | --- | --- | --- |
| R01 | PRIVATE-ID-01 | D | 0/0；缺失，禁止补造 | 无 | 两套 Raw 都缺失原 Session；不从助手摘要恢复用户经历。 |
| R02 | PRIVATE-ID-02 | A | 1/0；全部匹配 | M01 | 直接自述与后续确认支持有限认识；行为变化不自动等于撤回。 |
| R03 | PRIVATE-ID-03 | C | 2/0；全部匹配 | 无 | 历史状态被后续明确报告修正；不作为当前状态新增。 |
| R04 | PRIVATE-ID-04 | A | 3/0；全部匹配 | M02/M03 | 原报告包含两个独立认识，可拆分；不扩大为外部权利关系。 |
| R05 | PRIVATE-ID-05 | A | 3/0；全部匹配 | M04 | 只保留用户自述的理解，不把助手或摘要的外部断言当事实。 |
| R06 | PRIVATE-ID-06 | C | 1/1；全部匹配 | 无 | 后续用户报告消解原开放问题，不再新增未解认识。 |
| R07 | PRIVATE-ID-07 | E | 1/1；全部匹配 | 无 | 用户提问不构成对助手外部介绍的确认，无独立长期价值。 |
| R08 | PRIVATE-ID-08 | B | 2/0；全部匹配 | 无 | 现有 Note 已覆盖核心认识，不重复新增。 |
| R09 | PRIVATE-ID-09 | A | 1/0；全部匹配 | M05 | 对象由用户前后文确认；不使用助手外部介绍为证据。 |
| R10 | PRIVATE-ID-10 | E | 1/1；全部匹配 | 无 | 助手提出的解释不等于用户采纳的设计决策。 |
| R11 | PRIVATE-ID-11 | E | 1/1；全部匹配 | 无 | 一次局部理解困难不足以概括永久交流特征。 |
| R12 | PRIVATE-ID-12 | E | 1/1；全部匹配 | 无 | 一次称赞不足以证明稳定偏好，也不直接构成后来偏好的反转。 |
| R13 | PRIVATE-ID-13 | E | 2/2；全部匹配 | 无 | 查问与未经核实的外部传闻不能支持用户特征或外部能力事实。 |
| R14 | PRIVATE-ID-14 | E | 1/0；全部匹配 | 无 | 局部纠正需要上下文，不泛化为长期偏好。 |
| R15 | PRIVATE-ID-15 | E | 0/1；全部匹配 | 无 | 助手自评及审查者语气解读，不构成应保存的用户事实。 |
| R16 | PRIVATE-ID-16 | A | 1/0；全部匹配 | M06 | 明确交互要求仅限定当次，不泛化为永久规则。 |
| R17 | PRIVATE-ID-17 | A | 0/3；全部匹配 | M07 | 原映射均为助手，另找独立用户佐证；明确虚构材料排除。 |
| R18 | PRIVATE-ID-18 | E | 1/0；全部匹配 | 无 | 局部代词澄清不能单独成立，助手复述不足以确认实体。 |
| R19 | PRIVATE-ID-19 | E | 0/1；全部匹配 | 无 | 助手认错与外部介绍不作为用户事实；已有独立用户证据另行承担。 |
| R20 | PRIVATE-ID-20 | E | 2/2；全部匹配 | 无 | 一次实验、假设或角色自述，不构成用户长期特征。 |
| R21 | PRIVATE-ID-21 | E | 3/0；全部匹配 | 无 | 一次讨论角度不足以推导稳定偏好或已采纳方案。 |
| R22 | PRIVATE-ID-22 | E | 0/1；全部匹配 | 无 | 助手对用户行为的猜测未经确认，不升级为事实。 |
| R23 | PRIVATE-ID-23 | E | 2/2；全部匹配 | 无 | 局部查问与纠错无新增独立长期认识，外部事实须另验。 |
| R24 | PRIVATE-ID-24 | D | 0/0；缺失，禁止补造 | 无 | 来源 Session 缺失；不凭摘要补造来源或对象。 |
| R25 | PRIVATE-ID-25 | A | 2/0；全部匹配 | M01/M08 | 同一认识的后续确认与独立变化分别处理，不重复建卡。 |
| R26 | PRIVATE-ID-26 | E | 1/1；全部匹配 | 无 | 助手推荐未经用户确认，不能生成用户偏好。 |
| R27 | PRIVATE-ID-27 | A | 1/0；全部匹配 | M09 | 明确约束限定特定对象，不泛化为所有同类对象。 |
| R28 | PRIVATE-ID-28 | E | 0/1；全部匹配 | 无 | 助手承诺不等于已经履行；相关用户依据由另一条承担。 |
| R29 | PRIVATE-ID-29 | E | 2/0；全部匹配 | 无 | 提问与测试行为不证明旧认识恢复或仍有效。 |
| R30 | PRIVATE-ID-30 | A | 1/0；全部匹配 | M10 | 明确自述纠正仅限定当时报导，不保证永久。 |
| R31 | PRIVATE-ID-31 | E | 2/2；全部匹配 | 无 | 开放问题不证明稳定特征，助手的个人归因不得升级。 |
| R32 | PRIVATE-ID-32 | E | 1/1；全部匹配 | 无 | 角色玩笑不足以证明现实权利或关系。 |
| R33 | PRIVATE-ID-33 | D | 3/3；全部匹配 | 无 | 一次会话的多次共现不足以支持稳定 pattern；主要概括来自助手。 |
| R34 | PRIVATE-ID-34 | E | 1/1；全部匹配 | 无 | 助手对互动模式的自评未经用户确认，不构成稳定行为规律。 |
| R35 | PRIVATE-ID-35 | B | 2/0；全部匹配 | 无 | 现有 Note 已覆盖用户观点/问题，观点不升级为外部科学事实。 |
| R36 | PRIVATE-ID-36 | B | 3/0；全部匹配 | 无 | 与既有来源和命题重合；记录日期不当作事件日期。 |
| R37 | PRIVATE-ID-37 | E | 1/0；全部匹配 | 无 | 重复候选由另一待迁移条目承担，不能冒算为已有覆盖。 |
| R38 | PRIVATE-ID-38 | B | 1/0；全部匹配 | 无 | 已有 open-question 保留当时未知；不断言今天仍未知。 |
| R39 | PRIVATE-ID-39 | D | 2/2；全部匹配 | 无 | 助手对稳定性的推论未经确认，不能覆盖明确用户报告。 |
| R40 | PRIVATE-ID-40 | D | 1/1；全部匹配 | 无 | 未来预测不是已发生事实；已有问题 Note 不能证明预测。 |

## 4. 具体迁移操作、现有覆盖与语义收缩

以下操作全部使用当前 NoteMeaning/RuntimeOperation 合同、subject=profile-user、basis=direct、eventTime=null、现有 kind/tags/uncertainty，不增加字段或放宽自动授权。新增 createdAt 只能表示迁移写入时刻，原会话时间及原 Reflection 时间另行保留，不回填成未经证明的事件日期。精确 content、SourceRef、contextEvidence、operationId 在私有 Manifest.operations 中；每个拟操作在私有附录都有实际用户引文。

| 操作索引 | 复审记录 | kind | 内容范围与限定 | 隔离新增 Note ID |
| --- | --- | --- | --- | --- |
| M01 | R02+R25 | preference | 按原始证据收缩，保留当时限定；精确正文仅在私人 Manifest。 | PRIVATE-ID-41 |
| M02 | R04 | project-state | 按原始证据收缩，保留当时限定；精确正文仅在私人 Manifest。 | PRIVATE-ID-42 |
| M03 | R04 | fact | 按原始证据收缩，保留当时限定；精确正文仅在私人 Manifest。 | PRIVATE-ID-43 |
| M04 | R05 | fact | 按原始证据收缩，保留当时限定；精确正文仅在私人 Manifest。 | PRIVATE-ID-44 |
| M05 | R09 | event | 按原始证据收缩，保留当时限定；精确正文仅在私人 Manifest。 | PRIVATE-ID-45 |
| M06 | R16 | preference | 按原始证据收缩，保留当时限定；精确正文仅在私人 Manifest。 | PRIVATE-ID-46 |
| M07 | R17 | event | 按原始证据收缩，保留当时限定；精确正文仅在私人 Manifest。 | PRIVATE-ID-47 |
| M08 | R25 | preference | 按原始证据收缩，保留当时限定；精确正文仅在私人 Manifest。 | PRIVATE-ID-48 |
| M09 | R27 | preference | 按原始证据收缩，保留当时限定；精确正文仅在私人 Manifest。 | PRIVATE-ID-49 |
| M10 | R30 | fact | 按原始证据收缩，保留当时限定；精确正文仅在私人 Manifest。 | PRIVATE-ID-50 |

9 条 A 形成 10 个 ADD：一条记录包含两个独立认识而拆分，两条记录的同一认识合用一张，另一个独立认识单列；不强制一条 Reflection 对应一张 Note。

收缩原则：外部背景和助手推论不升级为用户事实；必要时另找独立用户佐证，排除明确虚构材料，保留当次/历史限定。具体逐条依据保留于私人包。

B 类 4 条逐一对照已有 Note 和来源，均不创建或更新；精确覆盖映射仅在私人包。已有 19 Note 保持正文、版本与来源不变。

矛盾与修正依据后续用户证据判断；问题、助手预测和单次共现不能证明事实或稳定模式。待迁移记录之间的重复不冒算为既有 Note 覆盖。

## 5. 关系与演变

新增 Relations=0，保留原有 17 条。沿用 P3.1：关系需要有效目标、原始证据及必要时间顺序；主题相似不够。缺少对应旧 Note 时在单条认识内表达有依据的变化，不补造旧 Note 或 STATE_CHANGE；未改关系与授权算法。

## 6. 独立备份、清单与恢复边界

备份根：`<REPO>\artifacts\memory-v0.4.0-p4a\2026-11-18T08-47-23-167Z`。此次重新离线备份，不以 P2/P0 的历史结果代替。查询 CIM 确认没有 Electron/Aisling/项目 Worker；未强制终止进程。对原有关键 Memory 文件持有允许共享读取、禁止写入/删除的文件句柄，完整复制并核对源前后及目标哈希。没有只复制热数据库主文件，也没有向真实数据库打开连接。

| 独立集合 | 文件数 | 字节 | 范围 |
| --- | ---: | ---: | --- |
| backup/profile | 6631 | 223799474 | 完整正式 Profile，包含全部归档、Raw/配置、Note 主库/WAL、任务、authority、迁移/删除状态、凭据及缓存 |
| backup/reflection-archive | 5991 | 183399489 | 再单独复制完整旧归档，包含 Reflection 原件、Raw、旧数据库及配套文件 |

两份集合相互独立；第一份本身已含归档，文件数不能相加当作唯一数据数。每文件 name/bytes/mode/SHA-256 分别在 profile-manifest.json、archive-manifest.json。清单文件本身的 SHA-256：

- profile-manifest.json：`<PRIVATE_SHA256>`
- archive-manifest.json：`<PRIVATE_SHA256>`
- migration-manifest.json：`<PRIVATE_SHA256>`
- rehearsal-manifest.json：`<PRIVATE_SHA256>`

审查包 12 个主要文件的字节摘要见checksums.sha256（私人归档内，不随公开仓库分发）。清单是完整性校验，不是加密或数字签名；备份可能含配置密钥和私人对话，只保存在被忽略的本地目录，不能上传或提交。旧 P0/P2/历史回填的备份及恢复资料没有覆盖。

最终离线重新核验时间：`2026-11-18T09:21:40.360Z`。正式 Profile 全部 6,631 文件、归档全部 5,991 文件及两套独立备份的集合/字节/SHA 均与本轮基线一致；结果在 source-integrity.json。沙箱内 CIM 最初不可用时核验中止，随后通过获准的只读进程检查执行，没有跳过离线检查。

恢复时先正常退出应用，确认单实例/Worker 不占用并阻止并发启动；保留当前完整 Profile 及其新备份，绝不覆盖未知变化。先核对清单，再把 backup/profile 的完整集合恢复到新的隔离目录；主库、WAL、authority、任务、删除/迁移状态及归档作为同一快照恢复，不混搭主库/WAL或单独替换 JSON。用固定 Node 24.12.0/Ladybug 0.22.1 在另一隔离副本恢复 WAL 并验证表及 SourceRef；只有通过后，才在明确授权的 P4-B/恢复操作中讨论正式替换。原备份保持不动；有新的删除责任时先复核屏障，不能复活已删除来源。P4-A 工具没有正式发布/恢复入口。

## 7. 隔离执行、表完整性与 Mirror

从完整备份创建 rehearsal/profile；所有迁移只在该目录进行。原始 migration-manifest.json 固定不变。首次只读核验在副本中完成 WAL 恢复和干净关闭后，WAL 可能被数据库正常删除，因此 rehearsal-manifest.json 仅将初始文件哈希绑定到恢复后的隔离状态；40 条复审、10 个操作、Note/operation ID、来源和语义均相同，绝不改正式主库/WAL。此前第一次演练准备因恢复后 WAL 已不存在而中止，没有执行任何迁移；修正的是隔离快照清单，非源数据。

工具在固定 artifacts 根内要求规范路径、匹配隔离 marker，递归拒绝 junction/symlink/hardlink，验证完整 Reflection ID/原件摘要、A 类批准来源、源消息 digest 和 user role、初始快照及冻结 Manifest。复用现有 Store → Worker → 事务和 NoteOperation Receipt；不加载 Formation 或 Provider，不建立新 Memory 服务。精确重复使用现有 sameRecognition 拒绝；语义重复由此次人工逐条比对负责，不能把字符串检测当语义证明。

| 表 | 迁移前 | 隔离迁移后 | 原记录核验 |
| --- | ---: | ---: | --- |
| Evidence | 26 | 40 | 保留全部原始逻辑行 |
| HAS_CONTEXT | 268 | 272 | 保留全部原始逻辑行 |
| HAS_EVIDENCE | 19 | 31 | 保留全部原始逻辑行 |
| MemoryErasure | 5 | 5 | 保留全部原始逻辑行 |
| MemoryTombstone | 5 | 5 | 保留全部原始逻辑行 |
| Note | 19 | 29 | 保留全部原始逻辑行 |
| NOTE_EMBEDDING | 14 | 14 | 保留全部原始逻辑行 |
| NOTE_LINK | 17 | 17 | 保留全部原始逻辑行 |
| NoteOperation | 36 | 46 | 保留全部原始逻辑行 |
| NoteRevision | 19 | 29 | 保留全部原始逻辑行 |

逐表读取两个隔离副本，去除数据库内部物理行号后核对：所有原始逻辑行均完整保留，所有表结构与来源可读；已有 19 张 Note 正文/版本/来源未变，10 张新 Note 均为 version=1。新的 14 个 Evidence 节点包括必要上下文，新增主 Evidence 边=12、Context 边=4；并非每个引用都必须生成独立节点。没有为新增卡生成 Embedding，因此 NOTE_EMBEDDING 仍为 14；本轮不使用任何真实 API。

第 3 个持久事务提交后、演练日志记入前注入异常：已提交 3 个操作，恢复时复用 3 个 Receipt、执行余下 7 个。再次执行为 applied=0/reused=10，Note/Revision/关系快照完全不变。单元测试另覆盖第一个事务已提交但回复丢失的恢复、Manifest 被改、未审查/非 A/错误来源、原件被改和共享链接拒绝。journal 仅协助跟踪，以数据库 Receipt 指纹为实际提交依据。没有测试拔电或 OS 强杀；不声称覆盖所有原生崩溃形态。

显式把 Mirror 目标设为 rehearsal/isolated-vault，不启动使用真实配置的服务：输出 29 份受管 Markdown，核对每张的 ID、正文、version、来源 Session/digest；重同步 written=0，手工 manual.md 未变。未访问或清理真实 `<OBSIDIAN_VAULT>` 的笔记。隔离 Profile 的配置/Raw/任务/authority/旧归档及其他非 Note 数据库文件均与原基线相同。

## 8. 本轮实际验证与限制

| 本轮检查 | 实际结果 |
| --- | --- |
| 新迁移工具原生单元测试 | 2/2；包含真实 Store/Worker/Receipt、安全拒绝与链接保护 |
| 迁移工具 + 历史回填 + memory-erasure + Obsidian Mirror | 串行重跑 20/20，0 skip；原生 Mirror 启停/轮询包含在内 |
| 全部 40 条语义复审 | Codex 根据原始 user/assistant 材料逐条判断；不是程序自动验真 |
| 真实数据的隔离演练/重复/注入中断/逐表保留/来源与 Mirror 元数据 | 均通过，结果见 rehearsal-result.json、table-integrity.json |
| 正式原件与完整备份 SHA-256 | 全部通过，见 source-integrity.json 与每文件清单 |
| pnpm typecheck | 本轮通过，3 个工作区项目 |
| pnpm build | 本轮通过；仍有 Vite chunk >500 kB 提示，不属本轮迁移问题 |
| git diff --check | 本轮提交前通过 |

首次并行原生回归为 12/20 通过、8 失败，错误为共享 Worker resources 的 worker-resources-locked；停止并行，按 --test-concurrency=1 同一集合全 20 通过。没有更改业务代码、隐藏测试或移除锁。原始失败日志保留 .tmp/p4a/regression.log；串行结果为 regression-serial.log。该锁冲突仍是未来测试编排需遵守的约束。

未执行：付费 LLM/Embedding、真实 Profile 写入/启动验收、真实 Vault 同步、全量 Formation 重跑、完整前端/Core/桌面全套测试、OS 强杀/断电恢复。P2/P3.1 的历史测试结果不冒充本轮通过。没有未解决的本轮串行测试失败；无法确认的历史含义仍按 C/D/E 保留在原件中。

## 9. P4-B 正式迁移及 Reflection 彻底退役清单

1. 用户审阅私有附录 40 条处置及 10 个精确正文/来源/不确定性，尤其 R16/R30 的当次限定、R17 的独立佐证和虚构内容排除。当前 reviewStatus=codex-reviewed-awaiting-user，不能把演练成功解释为正式迁移批准。
2. 正式实施前重新审计 HEAD、Profile、配置、当前 Note/来源/删除屏障和覆盖关系，不能直接复用今天的“未覆盖”判断；新 Note 可能使操作应改为不执行。若 Manifest 有变，重新冻结、备份和演练，不绕过 Receipt 指纹。
3. 正常退出应用，建立新一致性备份；在明确授权的 P4-B 设计正式事务入口、分阶段 Receipt 和恢复门槛。当前脚本刻意拒绝正式路径，不通过改 marker 或把正式目录伪装成 artifacts 来发布。保留原 Reflection/私有复审及必要的删除责任；迁移成功也不能立即删除原件。
4. 先迁移并核对 Note/Evidence/Revision/Relations/来源、幂等和 Mirror，再处理 Reflection Runtime 退役。目标正式架构固定为 Context + Raw Recall + Note v2 Recall；不是仅关配置或隐藏开关。

剩余真实业务入口及后续调用/测试迁移边界：

| 现存文件/入口 | P4-B 必须逐调用复审的职责 |
| --- | --- |
| apps/stage-web/src/runtime/legacy-memory.ts、stores/stage.ts、main.ts | 旧懒加载工厂、旧 Formation/Organization watcher、旧 Recall 注入、legacy 生命周期分支 |
| reflection-formation.ts、reflection-recall.ts、reflection-store.ts | 旧生成调度、Prompt/Parser、检索排序和存储/专属类型；现有 Note v2 仍导入其中通用 sourceRef/校验/类型，须先迁移真实调用，不能按文件名删除 |
| note-organization.ts、note-recall.ts、note-draft.ts | 前两者含旧链路/通用源码引用，note-draft 是当前 Note v2 活跃合同消费者；逐调用拆清旧业务与共享能力 |
| packages/core/src/legacy-recall.ts、package.json 的 ./legacy-recall export | 旧 Reflection 打包/预算/诊断和专属兼容导出，迁移调用与 runtime-reflection 测试 |
| apps/stage-desktop/desktop-app.cjs、preload.cjs、desktop-store.cjs | 非 v2 旧 Organization 分支、Reflection IPC/bridge、旧迁移挂载；正常 v2 当前不暴露 ReflectionStorage |
| memory-organization.cjs、memory-migration.cjs、memory-database/note-v1.cjs | 区分旧业务和仍被 v2 Store/迁移工具使用的事务、UUID/合同/指纹、durable 等；不可整文件删除 |
| memory-archive.cjs、memory-lifecycle.cjs、memory-evidence.cjs、memory-authority.cjs、desktop-profile.cjs | 归档/隐私删除、来源验证、权威及启动保护仍有实际职责，须保留或等价迁移；P2 权威配置不得借退役改写 |
| LegacyMemoryControls.vue、MemoryMigration.vue、settings.ts、env.d.ts、core/config.ts、持久化/本地化 | 移除旧业务专属 UI、组织开关、桥接类型和无效配置，保留 v2 共用的 memory/formationEnabled/noteRecallEnabled 及既有迁移/删除责任 |
| reflection-* 测试/夹具、runtime-reflection.test.ts、memory-organization/migration/lifecycle/erasure、Note/Recall/Mirror 专项 | 对应迁移业务测试；通用来源/隐私/事务保护测试继续存在，避免通过删测试掩盖职责缺失 |

Formation 语义质量、历史上下文和事件演化研究仍是独立问题，本轮没有改变算法。profile-user 出现频繁不构成缺陷；跨事件认识也不能预设必须先有两条 Note。

## 10. 停止结论

40 条历史 Reflection 全部完成独立复审，其中 9 条（缩小后 10 张 Note）建议迁移，4 条已覆盖，5 条缺少充分证据，另有 2 条过时/修正及 20 条无独立价值。隔离库未发现新增精确重复、来源悬空或违反此次人工证据判断的认识；程序不能自动保证语义无误，仍须用户审阅。原正式 Note/Reflection/Profile 保持不变，独立备份已验证。

具备提交迁移清单供审阅的准备条件；尚不具备未经审阅直接正式迁移或删除 Reflection 的条件。P4-A 到此暂停，等待清单审阅后再进入 P4-B。
