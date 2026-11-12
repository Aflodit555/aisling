# P7 — Associative Memory Network & Embedding

2026-11-12。基于当前未提交的 P0–P6 工作树实施，HEAD 仍为 `3204a51`。仅修改后端、运行合同及持续回归测试；未修改页面、按钮、正式版本号或包依赖，未提交、推送或写入真实用户 Profile。已清理的 P0–P5 文档从本地压缩备份读取，未恢复到 docs。

**已交付：DashScope 原生向量调用、持久化补建、三路候选融合、模型判断的横向关系和两跳 Recall。当前隔离 Windows Worker 实际使用精确 Cosine；HNSW 在普通环境通过，但正式 Worker 缺少 OpenSSL 3 DLL，不能将它报告为生产 HNSW 已通过。**

## 1. Provider、投影与配置

- 模型 `qwen3.7-text-embedding`，1024 维 Dense、Cosine。使用 DashScope 原生 `/api/v1/services/embeddings/text-embedding/text-embedding`，显式发送 `parameters.text_type`：Note / Note-to-Note 为 document，用户查询为 query。[官方同步 API](https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api/)
- Main 按 Consciousness、Vision、Speech 查找已配置的 DashScope 凭据与地域；不向 DashScope 转发其他 Provider 的密钥，不复制保存 API Key。支持现有 `DASHSCOPE_API_KEY` 作为 DashScope 路由的凭据后备；单有该环境变量不会自动启用任意 Profile 的后台调用。
- 默认复用现有 DashScope endpoint 的 origin 和地域。确需独立 endpoint / model 时，可在同一配置的 `memory.embedding: {endpoint?, model?}` 提供后端字段；只有白名单 HTTPS DashScope 地址可用，不新增配置页面。配置加载只保留这两个字段，丢弃重复 apiKey。没有合适配置时使用本地检索与现有组织能力。
- `modelId = endpoint hostname / model`；单一活动空间，不同地域 / workspace / 模型不混算。维度固定1024；模型返回其他维度、非有限数、零向量、重复或越界 text_index 均拒绝。
- `buildNoteEmbeddingText()`：确定性 JSON，包含 NFKC content、subject、kind、规范化 state、去重排序的有效长度 tags。`projectionVersion=1`，SHA-256 contentHash。没有 Evidence 全文、Note ID、版本、生命周期、Revision、Receipt 或 HAS_CONTEXT。

实现：[note-embedding.cjs](../apps/stage-desktop/note-embedding.cjs)、[note-candidates.mjs](../apps/stage-desktop/note-candidates.mjs)、[配置合同](../packages/core/src/config.ts)、[配置恢复](../apps/stage-web/src/config/local-storage-config-store.ts)。

## 2. 向量 Schema 与 Windows 实测

只在正式 Note v2 runtime 增加节点表，不改 Note 的语义 Schema，也不向旧 v1/P0 开放向量写协议：

```text
NOTE_EMBEDDING
  noteId STRING PRIMARY KEY
  noteVersion INT64
  modelId STRING
  dimension INT64
  projectionVersion INT64
  contentHash STRING
  embedding FLOAT[1024]
  createdAt INT64
```

原 Worker 协议增加 `getEmbedding / putEmbedding / searchEmbeddings`；单个请求和响应仍受64KiB帧限制，不通过 IPC 批量传输向量。Store 在写入前重验来源、主体、当前版本及投影哈希，Worker 在事务内再次检查存在性 / 版本，并持久化时间。重复 identity 的回填不调用 Provider；丢回包后重开可读到已提交向量。向量是可重建派生数据，没有复制 Note 的 Revision / Receipt 系统。

原生分支尝试 `LOAD vector`、`CREATE_VECTOR_INDEX(... metric := 'cosine')` 和 `QUERY_VECTOR_INDEX`。扩展缓存位于 Worker 资源的 `.lbdb`，不读取任意用户扩展目录；资源刷新保留已有缓存，运行时不自动下载安装。[Ladybug Vector](https://docs.ladybugdb.com/extensions/vector/)

本机版本仍为 Node24.12.0 / LadybugDB0.22.1，官方扩展解析到兼容的0.22.0 Windows二进制：

| 环境 | 验证结果 |
| --- | --- |
| 普通进程环境、隔离合成数据库 | 安装 / LOAD、FLOAT[1024]、HNSW Cosine 创建、查询及关闭后重开均通过 |
| 实际 Worker 最小环境 | 扩展文件存在，但加载明确报缺少 `libssl-3-x64.dll / libcrypto-3-x64.dll`；保持既有环境隔离，使用 exact |
| exact 回退 | 同一 LadybugDB 持久向量、应用层精确 Cosine；最多扫描2048条，超限明确 `complete:false`；排序后最多12条候选 |

没有升级数据库、增加第二个库、Python 服务、CUDA 或系统级 OpenSSL 安装。HNSW 分支实际启用时取24条再按空间过滤、返回至多12条；结果仍要回到可信 Note 验版本与资格，索引命中不授予任何写权限。

## 3. 异步补建、生命周期与成本

复用 Main 的 `note-formation-jobs.v1.json`、原 Organization 唤醒和 Worker，不建立独立 Agent Runtime。`embedding` 只保存空间、投影版本、分页 cursor、调用时间、批次签名 / 尝试次数及失败 identity，不保存 Note 正文或密钥。

- 新 Note / 更新 Note 进入最多64个 ID 的持久优先待办，先取4条，不必等历史扫描结束；历史补扫按 UUID 分页继续，跨重启恢复，不限于已有的2048-head Recall 缓存。当前每次最多4个head批量请求，Provider 合同最多20条；没有逐条强制网络请求。
- API 在 Main 串行数据库队列之外等待，成功后重新领取队列验源和写入，正常 Note 写入不等待向量生成。后台一个在途批次，文档向量超时12秒。
- 每 Profile 文档批次每小时最多60次，每个同批次最多3次尝试，失败至少30秒后再试；失败记录最多2048项。当前上限约240个文档/小时，历史补齐是渐进过程，应用需运行且 Formation、Provider 可用。
- modelId 或 projectionVersion 变化重置补扫 cursor；首个新空间事务写入清理其他空间的向量。版本和哈希不符重新生成，绝不把同维旧模型静默当新模型。
- UPDATE 删除旧向量并重建；RETRACT 事务内删除且补扫排除；SUPERSEDE 保留旧经历向量，再按其新的终结版本补齐，同时生成后继向量。正常 Recall 仍以有效 active head 为入口，历史前驱经既有 Revision Recall 读取。
- 源删除事务同时清理对应向量；在途请求受删除代际、来源及版本复验限制，不能复活已删除认识。关闭 Formation 后不接受迟到写入；关闭 Profile 中止文档请求。查询向量缓存32项 / 5分钟，隐私失效时清空，迟到结果不能重新填回。
- Query 向量每小时最多60个未缓存调用，超时700ms；Renderer 等候上限850ms。失败、限流、禁用或没有配置时，BM25 / metadata 可独立完成 Recall。关系 LLM 仍沿用 P6 的8次/小时、60秒间隔、最多2次尝试限制。

实现：`note-formation.cjs: syncEmbeddings / documentCandidates / recallCandidates`，`memory-database/store.cjs`，`adapter.cjs`，`note-v1.cjs`，`erasure.cjs`。

## 4. 三路候选与实际组织调用链

统一 `discoverCandidates()`：BM25最多5条、向量最多12条、metadata最多8条，按 `Σ 1/(60+rank)` 做 RRF，去重保留 Note ID、version、channels 和融合分数，最多10条。原始 BM25 分数与 Cosine 不相加。Metadata 的 subject / kind 只是加分，没有同主体、同kind或共同标签的硬过滤。

向量候选暂用 Cosine≥0.3的保守门槛，仅为发现阈值，不是关系成立证据。当前有界样本不足以证明该门槛对所有中文语料最优。完整性按已有 head 扫描和向量通道分别表达：`vectorStatus: incremental / index-incomplete / unavailable`，增量状态不宣称全库已完成向量覆盖。

前台仍一次 Formation 调用：交互 → 共用 BM25/metadata 候选 → Note提议 → Main原授权 → Worker。新 Note 的语义投影在保存后获得，向量候选接入其异步组织，避免每轮多加必经的第二个 LLM。

后台：写入 / 修订 / 历史补扫 → 批量 document 向量 → focus 的已有 document 向量检索旧 Note → 三路融合 → 最多4个相关候选及原始 grounds → 既有 Provider 语义判断 → Main复验 → Worker NOTE_LINK。P7升级会有界重开旧任务的比较资格；新向量允许重看已完成任务，但签名、版本、已有边及调用账本防止无限重调。没有全库两两比较。

候选来源与关系判断始终独立；模型输入没有把相似度作为授权字段。现有2048-head / 4MB Recall候选上限仍存在，超限明确不完整；本轮没有实现任意规模的全局检索服务。

## 5. ASSOCIATED_WITH

复用 NOTE_LINK 的 data 和原 LINK / UNLINK 事务与 Receipt，仅增加一种关系：

```text
type: ASSOCIATED_WITH
from < to                         # 按 ID 规范化，不表达时间方向
fromVersion, toVersion
method: semantic
basis: inferred
order: unknown
scope, reason, uncertainty
sources: { evidence: 两端当前 Revision 的直接原始引用 }
createdAt / status / endedAt       # 沿用关系表字段
```

它表示有实际回忆价值的导航联系，不是因果、事实支持或认识等同。LLM 必须说明具体联系及未来回忆价值；相同标签、共同主题或高 Cosine 均不直接建边。不成立时返回空 relations（NONE）。跨主体只对 ASSOCIATED_WITH 开放，其他四种关系仍要求同主体；两端都必须有效、已确认并有直接用户来源。

Main规范化端点，Worker合同拒绝反向非规范边；重复 key 不形成反向副本，操作ID冲突、版本竞争和来源变化沿用原拒绝与恢复机制。UPDATE / SUPERSEDE / RETRACT 使旧边失效，UNLINK保留撤销状态；没有自动改写既有语义边的含义。源删除清边，不沿 ASSOCIATED_WITH 删除独立另一端。

模型读取候选不会无条件成为 Evidence。新边只引用两端当前 grounds，不使用 HAS_CONTEXT 当事实证据；旧 HAS_CONTEXT 的保守隐私删除闭包没有被放宽。

实现：`note-semantic-contract.mjs: organizationInput / parseSemanticRelations / semanticRelationPlan` 与 `note-v1.cjs: validRelationOperation / applyRelationOperation`。

## 6. 关联式 Recall

用户查询 → 已验源快照 → 本地检索与可选 query 向量 → RRF直接命中 → Main有界BFS → Renderer再次验源 / 裁剪 → Core剩余预算。

- 最多3个直接种子，最多访问8个节点的邻接页，每页8边；最多16条有效边、12个端点 / 路径，最多两跳。ASSOCIATED_WITH双向遍历；保留路径类型、理由与跳数，不向模型暴露内部ID。
- 直接命中优先保留；关联候选按跳数优先，关系说明 / 路径与查询话题无关的分支裁掉。所有端点版本、边来源和快照代际在Main复验，Renderer对端点及路径中间节点原始消息再校验。
- 输出区分 direct / associated；关系本身区分 STATE_CHANGE / CONTINUES 的演化与横向导航。横向说明明确“不是事实证明”，不把关联变成原始 Evidence。
- 暂保留最多3条、2000字符及原Core token预算。合成三节点链可同时放入直接命中、一跳及两跳；长内容可能只保留部分。完整图放不下时尝试精简路径 / 演化信息，再回退直接 Note。
- 原 P6 当前 / 历史排序、未解决冲突、前一Revision读取继续存在。没有新增Recall LLM、PPR或动态LLM路径循环。

实现：[note-v2-recall.ts](../apps/stage-web/src/runtime/note-v2-recall.ts)，`note-formation.cjs: recallNeighbors`，既有 candidates / neighbors IPC。没有前端页面变更。

## 7. 验证

| 类型 | 结果 |
| --- | --- |
| 类型 / 构建 | `pnpm typecheck`、`pnpm build`通过；保留原大chunk警告 |
| Core / Web | 112 / 408通过 |
| Desktop全量 | 117/117通过，0跳过；包含真实Vite与隐藏Electron Mock |
| P7专项及P6复验 | P7最终11项、P6 11项通过，零跳过；全量117项后新增的新Note优先待办已在P7专项复验；原生向量模式为exact |
| 普通环境HNSW | 隔离库创建 / 查询 / 重开通过；正式Worker不能加载其OpenSSL依赖，已明确回退 |
| 真实Embedding | 仅两次、HTTP200；3条合成document + 1条query均1024维，没有真实历史回填 |

持续测试覆盖投影稳定性、跨subject / kind候选、RRF贡献和去重、query/document、20条上限、响应位置及维度、429、超时、模型切换、持久重开、UPDATE / SUPERSEDE / RETRACT / 删源、在途来源变化、重启重试、仅Embedding不建边、模型判断建边、反向遍历、UNLINK幂等、关联失效、两跳路径、无关旁支及高度连接上界。生产隐藏Electron Mock已验证 document / query请求、模型关系计划、Worker持久化和实际Core注入。旧回归继续验证迁移、删除屏障、事务回滚、丢回复与Receipt恢复及Vite/构建权威一致性。

真实调用读取现有配置的 DashScope 北京workspace，不打印或复制保存密钥。三条合成文本分别讨论记忆组织、自主行动和买苹果；对“记忆组织和系统自主性之间有什么联系？”的Cosine为0.591 / 0.509 / 0.252。它验证原生API与基本语义区分，**不证明横向关系模型判断或长期Recall质量通过**。没有本轮真实关系LLM验收，没有大规模用户Note回填。

原始合成请求 / 响应在忽略目录 `artifacts/memory-p7/real-embedding.json`，原生探针在 `vector-probe.json`，其余工程日志同目录；不含凭据，不纳入Git。

## 8. 剩余限制与未实施方向

1. 当前正式Windows Worker的HNSW依赖未解决；可运行的exact回退最多2048向量。普通环境通过不能替代隔离部署验收，没有放宽环境或安装系统依赖。
2. 旧2048-head索引上限、冷扫描及4MB快照仍限制大库；向量补建覆盖可继续分页，候选发现仍有现有容量边界。ANN、阈值、metadata及有限候选均可能漏召回，未命中不是认识不存在。
3. 关联语义真实性仍依赖LLM，原始锚点和程序约束不能证明联系有价值。只做了少量真实Embedding，没有宣称全链语义效果或跨主题回答收益已通过。
4. 2MB作业文件、2048失败记录、4096语义签名及有限保留窗口仍是长时间大库限制。3次失败后该identity不再自动尝试，需更换空间 / 内容或明确排查后重置失败记录；没有新增重置按钮。
5. 仍只有3条最终Note；关系与路径可能受预算或250ms图读取时限丢弃。词项相关性剪枝是保守近似，不能替代未来检索质量评测。模型服务端同名版本无公开修订标识时，也无法自动识别未改名的权重变更。

没有实现三轮Recall效果固化、Activation、Cue–Tag–Content节点、PPR、Recall LLM动态扩展、关系可视化或新设置页面。

## 9. 文件与工作区保护

新增长期源码：`note-embedding.cjs`、`note-candidates.mjs / .d.mts`、`note-associative.test.cjs`；其他改动在原Main、Worker协议 / Adapter / Store / 生命周期清理、语义合同、IPC、Recall、配置恢复与生产冒烟内。资源脚本仅补充保留已准备的扩展缓存；仍使用原固定Node / LadybugDB。当前入口更新在 `docs/memory.md`。

本轮开始的源码快照与Git状态在 `artifacts/memory-p7/baseline`、`git-before.txt`，包括上轮文档删除，不恢复或覆盖它们。原215条工作区状态路径均保留（原删除继续保留删除），原页面 / 文案和包配置修改未被覆盖；`git diff --check`通过、暂存区为空、HEAD未变，默认Worker的5个脚本和2份清单匹配源码。所有数据库和Electron工程验证都使用隔离合成Profile。未提交、推送、修改正式版本号或依赖锁文件。
