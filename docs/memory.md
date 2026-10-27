# Memory Recall

Memory Recall 使用本地保存的旧会话，向当前文字轮提供相关历史原文。可选的 [Reflection Formation](memory-formation-v0.md) 在后台形成历史认识，[Reflection Recall](reflection-recall.md) 读取已完成且来源有效的产物；没有引入数据库、Embedding 或完整的长期认识系统。

## 使用与用户控制

在 **设置 → 记忆** 中控制。Memory 主开关控制 Recall，默认开启；已有明确关闭的设置继续保持关闭。开启后显示默认关闭的 Reflection Formation 子开关，需单独主动启用，可能额外调用 LLM Provider。关闭主开关会同步关闭并保存 Formation 状态，取消／丢弃其在途结果；不删除历史、Reflection 或待处理批次。再次开启主开关不会自动开启 Formation。选择随现有 `aisling.config.v1` 保存；浏览器使用 localStorage，Electron 使用现有文件存储桥接。ConversationStore 保持原存储键，兼容消息的可选 `createdAt` 字段。

主开关同时控制原始 Recall 和已持久化的有效 Reflection Recall；关闭 Formation 子开关仅停止形成新认识，不妨碍读取既有产物。

开启后，相关的本地旧会话片段与历史 Reflection 可能随用户文字消息发送给当前选择的 LLM Provider。没有为回忆额外调用模型。Recall 不参与图像轮、自主发言生成或 P2 更新。关闭对新的文字轮生效，不删除历史或撤回已发送的请求；当前会话中已经出现的内容仍受正常 Context 规则管理。

删除旧会话后，后续检索不再读取它；原始 Recall 没有另建索引或缓存。Reflection 的只读缓存也会逐轮核实来源，来源被删除或修改的认识不注入。检索、读存储失败或无法装入证据时，普通聊天继续按原链路运行。

## 检索和证据

`apps/stage-web/src/runtime/memory-recall.ts` 在每个允许回忆的文字轮读取现有会话，排除当前会话，按历史词项计算相关性。中文使用单字与双字词项，拉丁文字使用完整词项；保留现有评分规则与 Top-5 限制。

“还记得有什么吗”“还有呢”等整句匹配的短追问，可以使用当前会话最近 12 条消息中、长度不超过 300 字符的最近明确用户文本作有限检索锚点。Assistant 回复不提供锚点，明确的新话题直接使用当轮查询。该规则只构造检索词项，不把旧文本改写成新事实或替换实际用户输入。

证据保留原文，不把不同记录拼成新的引文。来源区分用户报告、已存储 Assistant 回复、有观测与交付依据的自主发言。Stage 在实际追加用户输入（包括图像文字）、最终角色回复、自主回复和本地命令确认时记录 epoch 毫秒 `createdAt`；部分流式文本不单独持久化。ConversationStore 校验并保留消息时间，不从文字推算，也不给旧消息补写当前时间。普通短期 Context 仍投影为原来的 Provider 消息格式，不携带这一持久化字段。

原始 Recall 按原有 BM25 相关性和整 Session 规则先选择、装包，再组织展示顺序。每条证据优先标注 `message-created`，旧自主回复可复用已有的 `utterance-delivered`；缺少逐条时间时标注 `session-only`，只在该组首条附上已有的 Session 创建／最后更新时间。完全没有时间时标注 `unknown`。缺少或无效的旧 Session 时间以 0 表示未知；旧单会话迁移不再把迁移时刻当作历史时刻，列表显示破折号。只读恢复不改写存储。

同一 Session 始终保留消息位置和原序，不因时钟读数相同或倒退而重新排序。跨 Session 使用所选消息的时间范围；存在无时间消息时，只在 Session 的创建／更新时间范围完整有效时使用粗略范围，并包含已有逐条时间。只有互不重叠的范围才建立先后约束；同时间、重叠或缺失时间按原相关性顺序稳定取用，不建立额外时间关系。C／E 临时标签在排序前分配，Context 空间竞争时仍按原相关性优先保留整组，之后保持时间展示顺序。所有时间都是记录／会话时间，不能直接当作所述事件发生时间；仅有 `updatedAt` 也不能给旧消息定时。

证据说明要求模型结合时间与更新措辞理解过去状态、当前状态、未来计划、考虑中和已完成行为；同一主题和范围内，后续明确用户更新通常更能反映当前状态，同时保留后来限定及过去经历。新兴趣不抹掉旧兴趣，提及频率不决定当前偏好。过去的角色猜测、承诺、虚构故事或“我做了”的表述，均不能当作用户确认或外部执行事实。时间不足、时钟矛盾或来源冲突时保留不确定性。

## 预算与隐私

- 最多 5 个候选 Session；原有证据限制为 6000 字符且 6000 UTF-8 字节。内部投影和最终模型投影都接受预算检查。
- 保留整会话的合格证据，放不下时跳过该会话，避免为装入旧错误而截掉同会话中的纠正。
- 仍使用 Context 的剩余空间，不挤掉既有历史选择；总输入上限为 14336 估算 token，并保留原有输出与安全余量。
- 扫描仍有 250000 字符、30 ms 的本地保护限制，超限回退；同步读取整存储的成本不在扫描计时内。
- 不支持的角色、工具中间消息、重复内容、空／占位内容及命中现有敏感文字规则的记录不进入回忆。过滤可能同时损失有用证据，且不能保证识别所有敏感信息。
- 模型只接收有界原文、角色、临时标签、同会话位置、白名单时间及自主依据。Session 时间每组只携带一次；时间字段也计入现有预算，预算紧时可容纳的正文会略减。存储 Session／消息／Candidate／对象 ID 只保留在本地来源映射中，不作为元数据发给 Provider。
- 常规诊断只保留已有白名单指标，不保存回忆正文、完整 Prompt 或认证信息。回忆块不会写回 ConversationStore；正常交付的最终回复按原规则保存。

发送相关片段是开启此功能的直接效果，请按所选 Provider 的数据处理方式决定是否开启。原文中本身写出的敏感内容或标识不保证都能被过滤。

## 职责区别与限制

| 模块 | 职责 |
| --- | --- |
| Context | 为当前 Session 选择有界近期交互，包括已交付自主发言的精简依据 |
| Memory | 从其他本地 Session 检索历史原文，供当前文字轮解释 |
| P2 | 默认关闭的短期桌面情境认识预览，独立更新并只消费已就绪的认识 |

词项重叠弱、重命名、泛化问题或短句规则未覆盖的指代可能造成漏召回。短追问锚点能改善部分连续话题，但不能排除所有无关候选；过长、过旧、不安全或图像话题不作锚点。相关会话太大时仍可能因整会话预算被排除。

证据不足不等于事情没有发生；顺序不明、来源矛盾、缺少年份或行为回执时，模型应说明无法确认。本阶段通过证据表达和提示约束这一行为，没有硬编码答案或拒答器，也不能保证模型正确理解或遵守。

## 持续回归验证

Memory 检索、安全与预算、时间／来源表达、短追问、设置恢复、失败回退和用户轮隔离均有自动测试。合成 `recall-history.json` 保留为持续回归材料；原实验的未召回旅行证据被明确记录为已知检索限制，不伪称语义问答通过。

`memory-recall-time.test.ts` 使用本次提出的手碟／画画、未购买／已购买、考虑／计划购买情境；检查两时期的原文、时间、来源以及实际 Provider 请求中的解释约束。另有消息时间持久化、同会话顺序、旧数据、相同／重叠／无效时间、已有自主交付时间和 Context 竞争回归。它们是确定性工程测试，未调用真实模型，不证明模型实际理解已经改善。

需要验证语义效果时，可用独立测试账号的真实 Provider 做以下少量人工用例（日期为测试设定），分别在 Recall 关闭／开启时提问并保存回答，不把它们加入每轮运行路径：

| 历史材料 | 新 Session 问题 | 语义验收 |
| --- | --- | --- |
| 9 月用户说想练手碟；10 月明确说暂时放下手碟，现在想画画 | 我现在更想练手碟还是画画？之前呢？ | 当前偏向画画，仍保留过去想练手碟；不按提及次数裁定 |
| 9 月用户说还没购买手碟；10 月说已购买并收到 | 我现在买手碟了吗？ | 依据后续用户报告说已购买，不把早先未购买状态永久化 |
| 9 月用户考虑购买，角色误称已买；10 月用户明确说只是计划下个月买，目前没买 | 我现在已经买了吗？ | 区分考虑、计划与完成，纠正角色猜测；删除时间后也不臆造日期 |

没有新增实时 LLM 调用、历史扫描或检索依赖。排序仅处理已进入有界证据包的最多 5 组 Session；原扫描时间／字符保护、Context 上限及短期历史窗口保持原值。未做设备级延迟基准；系统时钟失准、跨 Session 范围重叠、旧资料缺时、弱词项关联和未召回更新仍可能限制判断。

数值合法并不能验证历史时钟的真实性；以前版本若已把迁移时刻写成 Session 日期，现有数据无法识别其来源或恢复真实消息时间，本次不重写历史。

本次时间组织修改涉及的文件（工作区此前已有的其他改动保留）：

| 文件 | 职责 |
| --- | --- |
| `packages/core/src/context.ts`、`index.ts` | 可选消息创建时间及复用的时间校验；保持 Provider 投影规则 |
| `packages/core/src/runtime.ts` | 原始 Recall 的时间／状态说明，剩余 Context 中按相关性整组裁剪并保持展示顺序 |
| `apps/stage-web/src/stores/stage.ts` | 在实际追加用户输入、交付回复及本地命令确认时记时 |
| `apps/stage-web/src/conversation/conversation-store.ts` | 保存／恢复时间字段；缺时旧记录保持未知，不补造读取／迁移时间 |
| `apps/stage-web/src/runtime/memory-recall.ts` | 时间及来源投影、有界 Session 时间排序，不改变 BM25 评分 |
| `apps/stage-web/src/components/ConversationBrow.vue` | 未知会话日期显示破折号 |
| Core 的 `context.test.ts`、`runtime-recall.test.ts` | 短期 Context 隔离、原序和双来源预算中的相关性优先级 |
| Web 的 `memory-recall-time.test.ts`、`memory-recall.test.ts`、`memory-capabilities.test.ts` | 新的时间／状态情境及已有证据、排序、预算回归 |
| Web 的 `conversation-store.test.ts`、`stage-persistence.test.ts`、`stage-streaming.test.ts`、`stage-autonomous.test.ts` | 创建时间、旧数据、失败恢复、流式交付及自主回复时间一致性 |
| `docs/memory.md` | 时间来源、边界、兼容策略及独立真实 Provider 验证材料 |

```powershell
pnpm test
node --test apps/stage-desktop/*.test.cjs
pnpm typecheck
pnpm build
$env:AISLING_MEMORY_SMOKE = '1'
pnpm --filter @aisling/stage-desktop exec electron prod-smoke.cjs
Remove-Item Env:AISLING_MEMORY_SMOKE
$env:AISLING_CONTEXT_SMOKE = '1'
pnpm --filter @aisling/stage-desktop exec electron prod-smoke.cjs
Remove-Item Env:AISLING_CONTEXT_SMOKE
```

Memory 生产构建冒烟使用隐藏 Electron 窗口、独立临时用户目录与 Mock 回复，检查正式 UI 开关、重启恢复、跨会话证据、连续追问、来源、取消／失败输出、预算与删除。Context 冒烟保留原有基本连续性回归。Mock 成功只证明工程链路，不证明真实模型回答准确率、长期使用体验或原生桌面采集质量。
