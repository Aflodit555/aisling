# Autonomous Memory Organization 与 Note Network

## 范围与入口

在 Note-only v2 上实现受限自主入库、生命周期维护、类型化关系、可恢复后台整理及一跳 Recall。沿用一次 Formation 模型调用、同一 Main 作业文件、Worker、数据库和来源删除机制，没有 Embedding、新数据库、额外模型 Provider、Activation 或多 Agent。

起点为 `main` / `3204a51c400ebff05ed3fa8a047ec172110a32ec`。原有19个已修改文件及155个未跟踪文件保留；其中的开发入口、IPC与资源准备改动继续沿用。没有提交、推送、版本号或依赖变更。所有测试使用合成资料、隔离 Profile、固定本地 Node / LadybugDB 资源和 Mock；没有访问实际用户 Profile。

日常仍使用 Memory / Formation / Recall 三个开关。Formation 默认关闭；开启后既生成提议，也运行自主授权和有界后台整理。普通写入不必逐条批准。现有审核页保留给不确定提议和人工纠正，批准继续经过原生确认。关闭 Formation 停止自主整理，不删除既有 Note；Recall 可独立读取。

开发和构建共用 `startDesktop` 的 v2 策略，旧 Profile 仍走隔离兼容路径。启动命令仍为 `pnpm dev:desktop`、`pnpm start:desktop`。Worker 脚本变化后，关闭 Desktop 并运行 `./scripts/prepare-memory-database.ps1`；它复用固定原生依赖、验证脚本并保留资源备份，不迁移或打开用户数据库。

## 调用链与职责

1. `stage.ts` 持久化已交付交互，`runtime/note-formation.ts` 异步调用现有 Provider。原来的三交互批次、引文、E/S/N标签、超时、取消和派生来源排除不变。
2. `note-formation-contract.mjs` 同时描述认识草稿和组织建议，要求可独立修订的认识。一次模型调用可输出0–3个操作提议，不另起第二次强制调用。
3. `note-organization-v2.mjs` 拥有增量候选索引、认识等价检查、Main自动授权规则及原始状态报告的关系计划。BM25只提供候选；程序规则决定是否可以自主执行。
4. `note-formation.cjs` 继续作为 Main 协调服务，管理来源、主体、真实ID、期望版本、持久作业、授权、后台任务和可信快照。Renderer不能提交原始数据库操作或授予权限。
5. v2 Store复验来源和主体，Worker在事务内执行 Note / Revision / Receipt / Evidence / 关系写入，继续使用永久删除屏障。旧 v1 操作合同不开放新关系API。
6. `note-v2-recall.ts` 先BM25，再通过可信IPC请求最多三个种子的关系邻居；Core沿用最多三条Note、2000字符及当前Context优先的token预算。

本轮文件范围（相对仓库根目录；未列入本轮修改的原有工作区成果继续保留）：

| 范围 | 文件 |
| --- | --- |
| 新增组织与回归 | `apps/stage-desktop/note-organization-v2.mjs`、`note-organization-v2.test.cjs` |
| Main与合同 | `apps/stage-desktop/note-formation.cjs`、`note-formation-contract.mjs`、`note-formation-contract.d.mts` |
| 数据库与类型 | `apps/stage-desktop/memory-database/adapter.cjs`、`note-v1.cjs`、`erasure.cjs`、`protocol.cjs`、`store.cjs`、`store.d.ts` |
| 正式入口与桥 | `apps/stage-desktop/desktop-app.cjs`、`preload.cjs` |
| Recall与Core | `apps/stage-web/src/runtime/note-v2-recall.ts`、`note-v2-recall.test.ts`、`packages/core/src/runtime.ts` |
| 页面与双语说明 | `apps/stage-web/src/pages/settings/memory.vue`、`apps/stage-web/src/i18n.ts` |
| 既有生产冒烟 | `apps/stage-desktop/note-formation-smoke.cjs` |
| 文档 | `README.md`、`docs/memory.md`、新增本报告 |

同一行省略目录的文件与该行首个文件同目录，Core路径单独写全。

## Note 与自动授权

现有 v2 字段保留，仅新增可选 `state: {scope: string, value: string}`。两项各不超过120字符，不能包含换行、分号、中文句号或问叹号；Formation只接受direct用户引文内能逐字核对的值。scope描述一个活动或属性维度，不是笼统主题。例如“我现在暂停练习钢琴。”可提取 `{scope:"练习钢琴",value:"暂停"}`。未能确定维度时省略字段，不能凭共同标签补齐。

| 操作 | 自动边界 |
| --- | --- |
| ADD | 候选覆盖完整、主体已确认；direct内容为用户引文中的单一字面陈述，或合同允许的完整助手归因发言。精确重复不新增；已有同scope状态需要明确变化措辞。无state且高度词面重叠的非event认识保留审核，不能凭相似度证明冲突。 |
| 推断ADD | 仅保留明确uncertainty的pattern；至少两份不同正文的用户报告、跨会话依据、每份引文都有共同语义标签；已有重叠pattern不自动新增。不升级为direct。 |
| NOOP | 主体、正文、kind、basis、事件时间、state和uncertainty一致，且新增引文能字面支持该认识。补证仍由Store和Worker检查。Formation的精确重复ADD可确定性转换为NOOP。 |
| UPDATE | direct、同主体、同kind、同scope；新内容有字面支持，原文明确更正且提及旧值。不能因一般矛盾改写旧Note。 |
| SUPERSEDE | 上述目标约束，并要求原文明确出现“从旧值改为新值”或英文等价字面形式。旧认识留在Revision及superseded状态。 |
| RETRACT | direct、同主体、同kind、同scope；明确撤回措辞和旧值。不能因一般冲突撤回。 |

不确定主体、缺少状态维度、来源失效、候选不完整、模糊修订及无法核对的释义保留待处理或拒绝。自动字面支持要求完整原文或独立分句，不能从“计划开始”中截出“开始”作事实；否定撤回、假设和疑问不能授权破坏性操作。精确比较保留小数等数字差异。Main从未使用模型自报置信度授权。程序验证来源和约束，不证明语义蕴含、scope解释或推断结论真实。

开始／暂停／重新开始等经历通常使用三个独立ADD，后续报告不否定过去事件；只有明确替代决定才使用SUPERSEDE。事件时间仍只从引文中的字面日期提取，消息时间只可说明报告顺序。

## 候选与后台任务

Organization按可信heads增量分页，每次最多64页／200ms，跨次保留进度；上限512页，即2048个数据库head。完整性独立于BM25是否命中，模型输入带 `candidateSearch.complete`，Main提交时重新判断。超限或未完成不会伪装为空库，也不会自主ADD。

缓存按Memory写入、Worker重启和隐私代次失效；普通对话追加不重复扫描整库。每次使用缓存仍以当前原始消息重新校验累计Evidence，包含HAS_CONTEXT；校验缺失时不宣布覆盖完整。Recall复用该索引，快照最多4MB；冷启动未完成时安全降级，后续可继续构建。

后台待办保存在现有 `note-formation-jobs.v1.json` 的 `organization` 字段：分页游标、是否完成初始遍历、按Note ID/version去重的任务、最多两条持久化关系命令、尝试次数和状态。新入库或版本变化的结果与待办在同一次作业文件原子替换中登记；启动后分页补查既有Note，已有Note即使没有新交互也会被处理。

每1.5秒最多处理一个任务；初始遍历积压256个任务时暂停继续加页，完成后续读。每个任务最多选择一条入向和一条出向关系，不做全库两两推理。任务失败最多两次，版本过期终止该任务；完成状态只保留最近128项。后台不调用LLM，不生成推断Note，也不以自己的组织结果补充证据。

## Note Network Schema 与生命周期

新增关系表：

```text
NOTE_LINK(
  FROM Note TO Note,
  key STRING,
  data STRING,
  status STRING,
  createdAt INT64,
  endedAt INT64
)
```

data是严格校验的JSON，包含 `type: STATE_CHANGE | CONTINUES`、from/to、两端version、basis、order、可选uncertainty、reason、双方直接Evidence、operationId和LINK动作。key由方向、两端ID/version和type计算；Worker串行事务保证同一key不会重复创建。

- `STATE_CHANGE`：同一已明示scope、不同value、有明确变化措辞的有序原始用户报告。
- `CONTINUES`：同一scope/value，有明确继续／恢复措辞的原始用户报告。
- 有不重叠事件时间可记 `order:event`；否则仅能根据同会话位置或不重叠消息时间记 `order:report`，basis为inferred并附带不确定性。报告顺序不被升级成事件日期或当前有效性。
- 两端必须active、同主体、版本匹配、原始来源有效。关系的来源必须属于两端当前Revision的直接grounds，并至少覆盖双方，不能用HAS_CONTEXT或inferred Note制造新支持。
- LINK与Receipt同事务；重复操作ID比对fingerprint。相同边不会因另一任务再创建；不同依据或含义冲突会拒绝。UNLINK留下retracted状态、结束时间及操作回执；同一版本组合不自动复活。
- UPDATE、SUPERSEDE、RETRACT会在Note事务内把已有active关系标记stale，结束有效性。新版本通过新任务重新比较，不沿用旧边。
- 源删除继续清理Note、Revision和Receipt，并DETACH删除相连关系。关系回执记录两端但不会像SUPERSEDE那样将独立语义邻居纳入删除闭包。剩余端只有自己的Evidence/HAS_CONTEXT依赖会导致删除。
- 关系历史在同一数据库保留状态和原始建立依据，未另建关系Revision系统；来源删除会清理相关历史及回执。

HAS_EVIDENCE仍是直接来源；HAS_CONTEXT仍是保守的隐私输入依赖，**不表示事实支持，不用于建语义边**。本轮没有放松原有递归输入删除机制，因此曾共同进入模型输入的Note仍可能在删源时连带擦除。这与仅有语义邻接的独立Note不同。

## Recall 与预算

Main只返回经当前资格和端点版本复核的active关系。每个种子最多读一页8条active关系，最多三个种子；总计取8条关系，再限邻居规模。已失效关系不会挤占该页。Renderer重验两端原始来源，端点失效时不保留它在关系说明中的正文。

最终Note投影可含state、关系类型、earlier/later方向、basis、报告/事件顺序和uncertainty。仍最多三条、2000字符，原始Context优先；可选图扩展等待150ms，失败保留词面Recall。图关系不会额外调用Recall模型，也不会启动递归遍历。

## 验证与实际限制

| 验证 | 结果 |
| --- | --- |
| Core全量 | 112/112通过，包含本机HTTP Mock。 |
| Stage Web全量 | 403/403通过；新增一跳扩展、端点版本及两端原文变化的回归。 |
| Desktop全量 | 96/96通过，0跳过，包含旧Profile、迁移、真实Vite / 隐藏Electron、来源删除与新Organization。 |
| 新Organization专项 | 10项；覆盖五动作自动边界、精确重复、计划截取/问句/否定撤回、分页完整性和2048上限、缓存验源、三段经历、关系幂等/版本竞争/撤销/删源、回滚与丢回包重启恢复。 |
| 类型和构建 | 工作区typecheck与生产build通过；保留既有主chunk大于500kB的构建提示。 |
| 生产Mock冒烟 | 标准Main与built Stage真实交付，3次Mock Formation调用、3条自主入库Note、至少2条关系，0个批准对话框；不额外调用后台模型。 |
| 真实模型语义 | 未执行，没有将Mock合同通过写成模型理解能力通过。 |

首轮沙箱阻断本机HTTP连接及Electron启动，允许受控回环/测试进程后通过。Desktop首轮还暴露默认Worker脚本过期及旧冒烟假定“审批前库里一定为空”；已用原准备脚本刷新固定运行资源，取消审批改为验证不增加写入，已自动提交操作的重复确认返回已提交状态。未放松证据、主体、版本或删除校验。新增文件仅为Organization模块、其持续回归测试和本报告；扩展既有生产冒烟，没有另堆一次性脚本。

工程测试与Mock行为不证明真实模型能稳定提取scope、选择正确动作或生成高质量推断。

当前有意保留的边界：自动修改依赖可核对的字面表达，普通释义和旧Note缺少state时可能继续待审；主体仍限定用户与Aisling；后台只做有原始状态依据的局部整理，不能为所有旧Note补出语义关系。2048-head索引、4MB快照、现有2MB作业文件及保守HAS_CONTEXT清理仍限制长期大库使用。没有真实模型语义验收或长时间负载测量。
