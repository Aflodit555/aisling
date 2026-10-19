# 第一阶段 Context

实现基线为 `fec79424425e2426d6e08c316ab5bb33737afb0a`，开始时本地工作区干净。本页保留第一阶段实现时的验证记录；后续工程收束见 [Context Hardening](./context-hardening.md)，源码与文档统一收束至 v0.3.5。

## 文件与职责

| 文件 | 职责 |
| --- | --- |
| `packages/core/src/context.ts`（新增） | 轻量 Token 估算、完整交互窗口、依据白名单／脱敏、Provider 消息投影 |
| `packages/core/src/runtime.ts` | 每轮请求按需组装、工具结果预算、请求／首文本诊断；自主生成不提前写已交付历史 |
| `packages/core/src/index.ts` | 导出会话消息类型及精简依据构造／校验函数 |
| `apps/stage-web/src/runtime/aisling.ts` | 恢复带可选元数据的历史，沿用现有依赖装配 |
| `apps/stage-web/src/stores/stage.ts` | 全会话历史、成功交付后写依据、会话恢复、媒体最终核验的 30 秒采样有效期检查 |
| `apps/stage-web/src/conversation/conversation-store.ts` | 同一持久化协议兼容旧消息、校验依据；移除 200 条记录裁切 |
| `apps/stage-desktop/desktop-app.cjs` | 为新增 Context 诊断接通现有严格白名单，不改变原生采集／Jev 判断 |
| `packages/core/src/context.test.ts`（新增）、`runtime-history-window.test.ts`、`runtime-autonomous.test.ts` | 预算、字符、轮次、工具引用、超限、依据与交付职责测试 |
| `apps/stage-web/src/conversation/conversation-store.test.ts`（新增）、`src/stores/stage-autonomous.test.ts` | 旧会话兼容、生命周期、追问、取消／失败／过期、P2 回归 |
| `apps/stage-desktop/desktop-diagnostics.test.cjs` | 验证真正落盘路径保留指标、过滤敏感内容 |
| `apps/stage-desktop/prod-smoke.cjs` | 增加显式 Context 生产构建验收分支，使用合成输入和临时用户目录 |
| 本文、`autonomous-speaking.md`、`desktop-diagnostics.md` | 实现边界、测量／验收与诊断说明 |

`provider.ts`、自主门控、Observation Registry、P2 Working State、采集器、Persona、模型参数和配置页面均未改动。

## 数据流和会话边界

Conversation Session 持有完整 `ConversationMessage[]`；普通聊天和实际交付的自主发言使用同一数组。Stage 的 UI 只显示 role/content，Core 在请求时选择一个有界的连续历史后缀，Provider 只接收标准 `ChatMessage`。不再有 40 条预切片。

普通输入：先显示并持久化真实用户输入 → Core 选择近期完整交互和随发言绑定的依据 → 流式回复 → Stage 保存最终文字 → 同步 Core 历史。失败的用户请求仍保留真实用户输入；不会伪造模型回复。

自主输入：当前 Candidate ＋当前允许使用的 P2 认识 → Core 生成 → Stage 执行现有取消／媒体交付校验 → 实际显示最终文字时写入精简依据 → 持久化和同步 Core。Core 的自主 `ingest()` 本身不代表交付，直接使用 Core 的宿主也应在交付确认后调用 `resetHistory()` 提交历史。

自主生成继续使用 `includeHistory=false`，不注入旧聊天或旧发言依据。尚未引入任何对象相关性筛选或语义评分。用户之后追问时，正常聊天窗口可以读取已交付发言及其依据。历史观察被明确标为过去、不可信的数据，不能当作当前桌面状态。

新建会话使用空数组；切换／重启从对应 Session 恢复完整记录；删除 Session 同时删除嵌在消息内的依据，不另建索引或旁路缓存。现有生成中禁止切会话规则及切会话时 P2 reset 规则保持。P2 认识不进入会话元数据，其有效期和作用域仍由现有 Working State 决定。

## 预算及安全处理

- 历史默认预算 **4096 估算 tokens**，为内部常量；没有新增设置项或 Token 服务。
- 本地总安全预算 **16384**，扣除 **1024 输出预留**和 **1024 估算余量**，输入上限为 **14336**。Persona、响应规则、当前输入、当前必要情境、工具定义和本轮工具结果先计费；历史只使用剩余空间与 4096 的较小值。
- 从最新完整单元向前选择，普通单元为用户输入及后续回复／工具链，自主发言及其依据是独立单元。超预算或引用链不完整时停止向前选择，不拆消息、依据 JSON 或工具引用。输出仍按原始时间顺序排列。
- 单个新输入、Persona、结构化观察或工具结果已超过输入上限时，明确返回 `Context input exceeds ... nothing was truncated`，不发出下一次模型请求，不截断内容。完整历史中某个最近单元太大时，可能没有任何历史能入选。
- 没有跨 Provider 的可靠 Token 计数接口。估算采用 UTF-8 字节数加每消息 8 个 framing 单位，包含工具与依据文本。ASCII 每字节算 1、常见汉字算 3、常见 emoji 算 4，通常明显高估真实 Token 数；不是模型 tokenizer 的精确计数或通用上界保证。工具 wire 格式和特殊 tokenizer 的差异由额外余量缓冲。
- 16384 是本地策略，不是自动探测出的模型容量；更小容量的自定义 Provider 仍可能拒绝请求。输出预留不修改现有 Provider 的 completion 参数，也不强制限制原有输出／thinking 行为。

窗口选择从不删除 UI／持久化历史。后续[工程收束](./context-hardening.md)已移除读取时的 50 会话隐式截断，并补齐持久化失败反馈、内存保留和桌面安全写入；没有恢复消息条数上限或更换存储后端。完整 JSON 持久化仍随记录总量增长，浏览器存储配额／桌面同步 IPC 与整文件写入成本仍是限制，未扩展成数据库或 Memory。

## 主动发言依据

仅在成功交付的 assistant 消息上保存可选 `autonomousContext`，包含 `deliveredAt`、可用时的 `observedAt`、来源、变化类型、Candidate/Object ID、应用和对象标题。媒体附歌手；前台只附最多 240 字符的客观文字片段。应用／标题／歌手上限分别为 80／160／120 字符；ID 只接受最长 128 字符的受限字符集。

观察字段过滤 URL、邮箱、长数字、常见密钥形式、长不透明串和常见个人文件路径；出现密码／密钥等敏感标签时整个字段脱敏。持久化恢复再次校验并丢弃未知附件。规则不能识别所有隐私信息，片段可能不完整；实际已显示的回复文字保持原文。

不保存整个 Candidate、完整 DOM／UIA 树／Snapshot、HWND、序列号、模型推理或 P2 claims。生成失败、空回复、quiet 取消、媒体变更／不可用／旧采样均不写已交付发言或依据；前台变化继续遵循原有“已接受回复不无条件撤销”策略。

按需入选时，把依据转换成紧邻该 assistant 发言之前的短 system 数据消息，注明是过去的观察及不可信材料。观察时间和实际发言时间分别使用 UTC ISO 8601（带 `Z`），当前 Candidate 的观察时间也使用此格式。依据与发言一起计入历史预算、一起淘汰。所有最终消息通过 role/content/toolCalls/toolCallId 的显式投影，内部 `autonomousContext` 字段不传给 Provider。

## 验证和测量（2026-10-19）

| 验证 | 结果 |
| --- | --- |
| 修改前 `pnpm test`、`pnpm typecheck` | Core 63、Stage 235 全通过；Typecheck 通过 |
| 修改后 `pnpm test` | Core **79/79**、Stage **244/244**，含 P2 认识注入／失效及公开序列回归 |
| 最后隐私／诊断改动后的定向复测 | Core Context **16/16**，Stage 自主／持久化 **45/45** |
| `node --test apps/stage-desktop/*.test.cjs` | **24/24**，含新增严格日志白名单测试 |
| `pnpm typecheck`、`pnpm build` | 通过；构建仍有大于 500 kB 的主包提示，没有新增运行时依赖 |
| 默认 Electron `test:smoke:prod`（沙箱外） | 通过：生产 Stage、持久化桥、流式交互、桌面／Stage 切换与 Live2D；未复现 Live2D 基线失败 |
| `AISLING_CONTEXT_SMOKE=1` 生产冒烟（最终构建） | 通过：真实 Stage 中的成功交付、精简依据保存／注入、Provider 协议投影、新会话隔离、恢复及删除；3 次 Mock 回复，无真实桌面或付费模型 |
| 可选 `AISLING_DESKTOP_CANDIDATE_SMOKE=1` | 一次发言已交付，但没有观察到同 ID 的 duplicate，断言失败；此测试依赖当时真实桌面稳定，未作为确定性 Context 验收依据，未改动采集／Registry 逻辑 |

沙箱内 Electron 曾因 GPU／renderer 启动失败退出；沙箱外默认生产冒烟通过。没有将环境失败算作业务通过。

此前开发阶段的本地基准（脚本不纳入发布源码），Node 24.12.0，20 次预热、200 次测量，仅测 Context 组装（不包括启动、持久化、原生采集或网络）：

| 完整历史条数 | 选中条数 | 历史估算 tokens | p50 / p95 / max（ms） |
| --- | --- | --- | --- |
| 100 | 100 | 1890 | 0.048 / 0.296 / 0.862 |
| 20000 | 204 | 4080 | 0.074 / 0.254 / 1.297 |

生产没有增加模型调用或后台任务。新增成本是本地窗口扫描／序列化、有限历史依据文本，以及保留完整记录后的存储增长。每轮工具结果到达后重新计算预算，不额外调用模型来处理 Context。诊断沿用现有默认关闭的开关；开启后记录估算 Token、选择／省略数、依据数、组装时间、实际请求时间和流式首文本时间，不记录正文。

真实语义对比使用 [阿里云官方兼容端点](https://www.alibabacloud.com/help/en/model-studio/model-calling-in-sub-workspace) 的 `qwen-plus`，3 个固定合成用例 × 修改前／后各 1 次，共 6 次成功请求。脚本直接读取 `fec7942` 的 Runtime，并复现旧 Stage 的 40 条切片；不修改源码或用户配置。

| 用例 | 修改前／后词面断言 | 请求耗时 ms（前 → 后） | 首文本 ms（前 → 后） |
| --- | --- | --- | --- |
| 近期约定：暗号在 40 条之外、Token 预算以内 | 未答出 → 答出 | 1294 → 1425 | 683 → 939 |
| 主动发言追问：识别虚构歌曲和歌手 | 未答出 → 答出 | 1463 → 1432 | 640 → 663 |
| 当前 B 歌：不提旧 A 歌／歌手／旧约定 | 通过 → 通过 | 1022 → 1107 | 433 → 481 |

这只是极少量词面语义检查，不能证明所有回复正确或推导稳定的延迟改善；A/B 的可靠隔离主要由确定性请求检查保证。最初 OpenAI 官方端点尝试返回 401，未得到该 Provider 的有效语义结果。跨模型效果、大规模长时实机体验和长期存储成本仍未验证。

开发用基准／真实 API 对比脚本与原始结果只保留本地，不纳入 v0.3.5。随源码保留的生产 Context 生命周期验收使用 Mock，不需要密钥：

```powershell
pnpm build
$env:AISLING_CONTEXT_SMOKE = '1'
pnpm --filter @aisling/stage-desktop test:smoke:prod
Remove-Item Env:AISLING_CONTEXT_SMOKE
```

实机体验沿用 `pnpm start:desktop` 或 `pnpm dev:desktop` 和现有 Chat／Desktop Awareness 配置即可。没有三级压缩、额外 Context LLM、跨会话检索、Memory、多用户实现或新的感知能力；窗口外历史不会自动召回，旧发言也不会凭空补造当时未记录的依据。
