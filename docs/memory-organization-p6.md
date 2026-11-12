# Memory Organization P6 — Semantic Evolution

实施日期：2026-11-12。项目：`D:\Project\demo\project_Aisling`。

本轮在未提交的自主 Organization 基础上增加语义判断、受控后台模型任务及演化 Recall，继续使用 Note v2、原 Provider、Main 队列和 LadybugDB Worker。没有新增模型依赖、Embedding、Agent Runtime、上层认知节点或物理数据库迁移。

**工程链路已实现并以 Mock 验证；真实模型验收有成功也有失败，不能宣称自然语言状态演化已全面通过。**

## 1. 实际交付与调用链

| 模块 | 本轮行为 | 实现位置 |
| --- | --- | --- |
| Formation | 一次调用同时提出原子 Note、生命周期动作及可选语义判断；旧候选附原始来源标签；合法提议不再被同批非法提议连带拒绝 | [contract](../apps/stage-desktop/note-formation-contract.mjs)，`formationInput / parseNoteBatch` |
| Organization | 合并 BM25、元数据、已有关系及有限最近候选；区分 independent / same / state-change / continuation / supplement / conflict / uncertain | [organization](../apps/stage-desktop/note-organization-v2.mjs)，`mergeOrganizationCandidates / authorizeOrganization` |
| 共享语义合同 | 原始完整分句锚点、目标 grounds、主体、模态、数值及时间方向约束；生成关系计划 | 新增 [semantic contract](../apps/stage-desktop/note-semantic-contract.mjs) 与类型声明 |
| Main | 重建可信输入，独立重验来源、候选完整性、授权、版本；持久化组织任务和稳定操作 ID；凭 Receipt 恢复 | [note-formation.cjs](../apps/stage-desktop/note-formation.cjs)，`prepare / submit / nextSemantic / settleSemantic / commitRelations` |
| Renderer | 原 Formation pump 复用现有 ChatProvider、取消与超时机制；闲置轮询，不新增 Provider 配置 | [note-formation.ts](../apps/stage-web/src/runtime/note-formation.ts)、[stage.ts](../apps/stage-web/src/stores/stage.ts) |
| Worker / Store | 扩展既有关系合同；原事务、Revision、Receipt、删除屏障及失效处理继续生效；增加校验后的历史认识读取 | [note-v1.cjs](../apps/stage-desktop/memory-database/note-v1.cjs)、[store.cjs](../apps/stage-desktop/memory-database/store.cjs)，`getRecallHistory` |
| Recall / Core | 有界演化排序、冲突提示、前一认识证据；完整关系放不下时保留精简演化摘要；继续服从 Core 剩余预算 | [note-v2-recall.ts](../apps/stage-web/src/runtime/note-v2-recall.ts)、[runtime.ts](../packages/core/src/runtime.ts) |
| IPC / 设置 | 扩展现有 neighbors 调用；页面说明后台调用上限，无新开关 | [preload.cjs](../apps/stage-desktop/preload.cjs)、[desktop-app.cjs](../apps/stage-desktop/desktop-app.cjs)、`memory.vue / i18n.ts` |

此前：交付交互 → Formation → 字面授权 → Worker → 确定性后台连边 → 一跳 Recall。

现在：交付交互 → Formation（附语义提议）→ Organization 候选比较 / Main 授权 → Worker 保存独立经历及可选关系 → 持久化局部任务 → 闲置 Provider 语义比较 → Main 重验 / Worker 连边 → 演化 Recall → Core。

Formation 负责新认识草稿，Organization 负责比较和操作计划；前台两者仍可共用一次模型调用。Main 不接受模型授予权限，Renderer 无数据库写入权。后台仅比较已有 Note，不生成新的抽象 Note，也不自动改写内容。

## 2. 自动授权的真实边界

语义判断不是置信度分数。它必须指定关系、具体 scope、当前来源完整引文，以及目标 Note 的直接原始来源。引用不能从“计划开始”截出“开始”，不能用候选摘要、助手猜测或 HAS_CONTEXT 替代事实来源。

| 操作 | 本轮自动边界 |
| --- | --- |
| ADD | 沿用字面支持，增加带原始用户证据锚点的自然释义；主体已确认、候选索引完整；保留计划、否定、历史限定与数值；`uncertain` 不获语义自动授权 |
| NOOP | 可接受同一稳定认识的释义与补证；主体、kind、basis、eventTime、可选 state 及模态须兼容；事件时间未知的重复经历不能仅凭语义判断合并 |
| UPDATE | 保留更严格的原规则：direct、同主体 / kind / scope、原文明确更正且提及旧值、字面支持和版本匹配；语义判断本身不能授权 |
| SUPERSEDE | 保留明确旧值到新值的同范围变化约束；不能因更新较晚或主题相同替代旧经历 |
| RETRACT | 保留明确撤回及准确目标约束；一般冲突只可成为未解决关系，不自动撤回旧认识 |
| LINK | 只新增有双端原始直接用户来源、同主体、有效端点版本的非破坏性关系；关系自身标记 inferred 和 uncertainty |

推断性 pattern 仍须显式不确定性及独立跨会话用户报告，不升级为 direct。可选 `Note.state` 继续采用原来的字面提取约束；语义 scope 不是新增本体或全局身份字段。

合法但不满足授权的前台提议继续待审；非法来源 / Schema 提议拒绝。批内逐项隔离不放松单项校验；整批只有非法提议时仍失败。可选连边发生版本竞争或已有决定冲突时，不撤销已保存的独立 Note，不覆盖旧边，记录 stale / review。Formation 关闭时的人工批准可完成 Note 写入，附属关系记录 deferred。

**程序能验证来源和操作约束，不能证明自然语言蕴含或语义真实性。** 当前模态及 scope 校验仍有语言覆盖边界，自动语义 ADD / NOOP 的正确性仍依赖模型判断。

## 3. 后台自主整理

沿用 `note-formation-jobs.v1.json` 的 organization.tasks，新增语义状态与签名，没有平行任务系统。

| 项目 | 实际限制 |
| --- | --- |
| 触发 | Note 写入 / 修订后的原队列、启动时有界补扫；Renderer 在 Formation 与 Provider 启用期间每15秒唤醒，没新交互也可处理积压 |
| 候选 | 每次 focus 加最多4个候选；BM25 + metadata + 已有关系 + 最近同主体 / kind；已有效连接或可确定性处理的组合跳过 |
| 来源 | 仅直接用户报告支持的现有 Note；最多12份原始引用，证据 JSON ≤6000 bytes，整体输入 ≤15000 bytes |
| 模型成本 | 同一 Profile 每小时最多8次语义后台尝试，间隔至少60秒；包括失败和取消；输出1500 tokens，超时30秒；不包含原 Formation 调用 |
| 并发 | 最多一个语义租约；前台 Formation 优先，聊天进行中不领取新的语义任务；模型调用不持有 Main 的串行事务队列 |
| 幂等 | Note ID / version / grounds 的组合签名；候选顺序变化不重调；成功或两次失败后的相同签名跳过，版本 / 证据变化才产生新组合 |
| 恢复 | 最多2次模型尝试；持久化租约及命令先于执行；中断租约恢复为 pending / failed；settling 从 Receipt 恢复，不重调模型 |
| 停止 | 关闭 Formation、移除 Provider、切换 Profile / dispose 时取消；迟到结果受 epoch、来源及版本再次约束 |

既有增量索引仍受512页 / 2048 heads 上限约束，并明确返回不完整；不会把超限或词面未命中当作“没有旧认识”。不完整时不放行自主新增或后台语义调用。候选完整仅指扫描覆盖完整，不保证同义表达召回完整；有界候选也不能覆盖所有潜在语义联系。

后台有明确终点，不做全库两两比较。已连接关系的含义修订、撤销或高风险内容更正没有被语义模型自动放宽；现有失效 / 删除路径仍可维护它们。

## 4. Note Network 最终 Schema

复用原来的物理关系表（`memory-database/adapter.cjs:42`）：

```text
NOTE_LINK: Note → Note
key STRING, data STRING, status STRING, createdAt INT64, endedAt INT64

data:
  operationId, action: LINK | UNLINK
  from, to, fromVersion, toVersion
  type: STATE_CHANGE | CONTINUES | SUPPLEMENTS | CONFLICTS
  basis: direct | inferred
  order: event | report | unknown
  reason, sources: {evidence: EvidenceRef[]}
  uncertainty?, scope?, method?: semantic
```

旧边继续兼容；语义边强制 `method:semantic`、`basis:inferred`、非空 scope 与 uncertainty。状态为 active / stale / retracted。key 仍按端点、版本和类型生成，Receipt 与关系在同一事务内；不会为普通关系复制 Note Revision。

| 类型 | 方向与含义 |
| --- | --- |
| STATE_CHANGE | 较早经历 → 较晚经历；同一具体维度上的变化，保留两段经历 |
| CONTINUES | 较早经历 → 较晚经历；有证据的同一过程延续 |
| SUPPLEMENTS | 细节 → 被补充的认识；明确“补充”等原文提示可校正模型反向提议，不按时间推断 |
| CONFLICTS | 未解决的同范围不相容；存储按 ID 稳定方向排列，Recall 不解释为先后或胜负 |

时间优先使用不重叠 eventTime。事件时间缺失且没有“去年 / 以前”等历史限定时，可保留报告顺序，但明确不等于事件顺序或当前有效性；一端有日期而另一端无日期、历史相对时间不清时，不强排状态边。

UPDATE / SUPERSEDE / RETRACT 按原逻辑使旧版本边失效。源删除清理受影响边及 Receipt；不会沿普通语义关系删除独立的另一端 Note。重新整理使用新版本和直接来源，不自动复活旧版本被撤销的边。

HAS_EVIDENCE 是直接来源；HAS_CONTEXT 是形成时读取材料的隐私依赖；Revision / SUPERSEDE 是生命周期；NOTE_LINK 是语义联系。后台只引用两端当前 Revision.grounds，不把曾读过的候选转为事实 Evidence。本轮没有放宽既有 HAS_CONTEXT 保守删除闭包，因此旧闭包导致的较宽清理仍是已知限制。

## 5. Recall 与实际使用

在正式 v2 Profile 上，使用现有 Provider 配置；开启 Memory 和 Formation 即可自主形成与后台组织；开启 Note Recall 后才能向 Core 注入 Note。不需要逐条批准正常低风险写入，审核页保留异常提议。旧 Profile 继续使用隔离兼容路径；Vite 与构建版复用相同 Main / Store 权威实现。

- 普通 Recall 继续 BM25 及一跳基础；当前状态 / 历史问题有限扩展，最多访问4个起点、取8条关系、补充4个端点，候选池最多8条。
- 明确关系中的 event 顺序优先于 report 顺序；当前问题偏向较晚节点，历史问题保留前后过程。环路或 CONFLICTS 保持 unresolved。
- 输出 `latest-known-report / earlier-experience / unresolved`，不把最新报告说成“现在一定如此”。补充关系用 adds-to / has-detail，不伪装为时间先后。
- 历史问题最多为首个检索锚点读取一个前一认识：UPDATE 的前一 Revision，或 SUPERSEDE 后继的前驱有效版本。Store 验证来源、主体和现存资格；Renderer 再校验原消息摘要。不是无限历史查询，也不召回已撤回内容。
- 关系读取复用 Main 已验源快照的端点版本，显式再验边来源并在返回前检查代际 / 会话指纹，避免对每条边重复查询所有历史来源。历史读取仅在历史问题启用。
- 保留至少一个直接词面锚点；没有双字命中时用受限单汉字候选补足。共同字只用于发现候选，不建边。
- 图读取等待上限250ms；失败或超时回退普通 Note Recall。最多3条、2000字符，仍由 Core 剩余 token 预算决定；完整关系放不下先尝试精简 evolution，再回退普通正文。当前 Context 优先，没有新增 Recall LLM。

## 6. 验证结果

全部数据库与 Electron 场景使用合成会话、带标记的隔离 Profile；没有运行正式用户 Profile。Worker 使用原固定 Node 24.12.0 / LadybugDB 0.22.1；仅刷新匹配源码的固定 Worker 脚本，不升级依赖。

| 类别 | 命令 / 内容 | 结果 |
| --- | --- | --- |
| 类型 | `pnpm typecheck` | Core / Desktop / Web 通过 |
| 构建 | `pnpm build` | 通过；保留现有大 chunk 警告 |
| Core / Web | `pnpm test` | Core 112、Web 406 通过 |
| P6 专项 | `node --test apps/stage-desktop/note-semantic.test.cjs`，指定隔离 Worker | 11/11 通过，0跳过 |
| Desktop 全量 | 全部 `*.test.cjs` 串行执行，指定隔离 Worker | 107/107 通过，0跳过；含真实 Vite 和隐藏 Electron Mock |
| 真实 Provider | 原共享 OpenAI-compatible Provider，项目已有 DeepSeek 配置，8次封顶 | 8次 HTTP 200；语义结果见下表，非全面通过 |
| 缓存回放 | 冻结真实输出经当前解析 / 授权 / 方向计划重新校验 | 通过修正项；0次新增付费调用，不算新的语义验收 |

P6 专项覆盖释义与字面差异、完整引文 / 模态 / 数值、批内非法项隔离、不同 scope、事件与报告顺序、三段独立经历及关系、闲置与关闭 / 重启、来源删除及独立另一端保留、版本竞争、限流 / 重试耗尽 / 签名去重、损坏持久任务、UPDATE / SUPERSEDE 历史验源、LINK 丢回复后的 Receipt 恢复，以及生产 Stage → Provider Mock → Main → Worker → Network → 实际 Core 请求。原 Organization 回归继续覆盖五动作、撤边、事务回滚、删除屏障及开发 / 生产权威边界。

### 真实模型：成功、失败与修正

遵照用户授权，读取项目已有接口配置：`https://api.deepseek.com`、`deepseek-flash`、环境变量 `DEEPSEEK_API_KEY`；没有使用误填的 Aliyun 地址，没有输出凭据。运行时间为本次会话前段（2026-11-11），共8次：Formation 4、后台1、Recall回答3。请求使用共享 Provider 的结果解析，传输按项目 DeepSeek 冒烟惯例映射 max_tokens 并关闭 thinking；这不等于真实设置页面全链路语义验收。

| 原始验收 | 实际结果 |
| --- | --- |
| 开始练琴 | 形成自然释义，但轻微省略“我”被原字面授权留待审 |
| 暂停练习 | 自主保存 ADD |
| 恢复练习 | 有合法新 ADD，但混入仅引用历史来源的 NOOP，原整批拒绝 |
| 独立后台补充 | 原始来源支持 PDF 格式补充，成功写边；但模型给出的方向与理由相反，原方向不合格 |
| 明确更正 | 仅历史来源及非法 scope 提议被拒，未实现该案例的正确修订 |
| 三个 Recall 问题 | 实际仅召回已保存的暂停认识，回答保留证据不足，没有编造开始 / 恢复；不构成完整时间线或更正通过 |

针对原始结果，已修正受限第一人称归一化、批内失败隔离、明确补充措辞方向校正，并加强当前来源与语义字段提示。冻结输出回放中：开始 / 暂停 ADD 可授权，恢复 ADD 独立通过而历史 NOOP 仍拒绝，补充方向成为细节 → 基础；更正继续拒绝。失败案例缺失内部上下文的回放明确由冻结公开输入和已存单一 Note 重建。**修正后没有再次付费调用，不能将回放当成真实模型重新通过；钢琴三段真实网络及更正仍未完成语义验收。**

原始请求、输出、usage、执行结果和 Recall 回答保留在忽略目录 `artifacts/memory-organization-p6/real-validation.json`；回放在 `cached-replay.json`；工程日志在同目录。仅合成数据、不含凭据；这些本地材料不进入正式源码 / Git。真实调用脚本遇到已有账本拒绝重跑。

## 7. 剩余关键限制

1. **语义质量仍需验收。** 真实模型可生成错误关系方向、无效提议，也可能把释义或范围判断做错；证据锚点和事务安全不能保证语义结论正确。明确更正案例仍未通过；破坏性操作保守边界继续存在。
2. **候选覆盖仍有限。** 2048 heads / 4MB 快照、词面检索、最多5个模型候选会漏掉跨措辞或更久远的认识；最近候选只是补充，不是同义检索的完整替代。超限会明确停止自主处理。
3. **演化与修正 Recall 有界。** 不是完整当前状态判定器；无绝对日期只知道报告先后，历史只读一个锚点的前一有效认识。预算不足、查询超时或没有关系时回退基础 Recall，可能无法呈现全部过程。
4. **任务与数据规模。** 原2MB作业文件、2048已处理任务保留和4096签名保留均有限；签名超出保留窗口后不保证永久去重。没有长期负载测量；Provider 就绪且应用运行才执行后台任务。
5. **旧 HAS_CONTEXT 闭包未拆分。** 保守删除可能清理更多受上下文依赖的 Note；新语义关系没有增加这种跨 Note 删除传播，但旧闭包仍需单独讨论。

## 8. Git 与工作区保护

本轮起点及结束基线均为 `main @ 3204a51c400ebff05ed3fa8a047ec172110a32ec`，已有跟踪信息显示相对 origin/main ahead 3 / behind 1；未 fetch、merge、reset、提交或推送。

开始时已有34个 tracked 修改及158个 untracked 文件（包含上轮 Organization、审计资料等）。源码基线留在忽略目录 `artifacts/memory-organization-p6/baseline`，只复制源码和 Git 状态，没有复制用户 Profile。P6 对照该基线增量实施，原有路径均保留；`git diff --check` 通过，开发默认与隔离测试的5个 Worker 脚本及2个清单均与当前源码一致。工作区仍保留混合的未提交修改，不能将相对 HEAD 的全部差异归为 P6。

本轮新增长期源码为语义合同及类型、P6 原生测试、Renderer 后台测试和本报告；其他改动集中在既有 Formation / Organization / Main / Store / Recall / IPC / 设置文案及测试。`docs/memory.md` 更新当前入口，上轮报告保留为历史基线。未修改正式版本号或依赖，未安装包，未操作真实用户 Profile。
