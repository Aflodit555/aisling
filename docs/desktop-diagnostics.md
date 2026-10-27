# Desktop Awareness：本地运行诊断（P1/P1.1/P2）

诊断机制始于 P0.5，记录 P1/P1.1 执行路径及 P2 预览的更新、消费和延迟；开关本身不改变模型输入、门控或交付行为。P2 元数据与最小验收见 [短期情境认识](./p2-minimal-loop.md)。模型没有输出判断对象；所有自主回复都记录 `replyTarget: "unknown"`。字段变化不是已证明的语义变化。

## 开关与位置

完全退出原 Electron，再在项目根目录启动。两个开关均默认关闭，只有字符串 `1` 才启用：

```powershell
# First open PowerShell in the repository root.
$env:AISLING_DESKTOP_DIAGNOSTICS = '1'
Remove-Item Env:AISLING_DESKTOP_DIAGNOSTICS_REPLY_TEXT -ErrorAction SilentlyContinue
pnpm dev:desktop
# 或 pnpm start:desktop（先构建后启动）
```

仅在需要人工判定回复对象时，启动前额外设置：

```powershell
$env:AISLING_DESKTOP_DIAGNOSTICS_REPLY_TEXT = '1'
```

默认只记录回复长度与指纹。正文开关只允许记录成功交付的自主回复，最多 2000 字符，超出标明 `replyTextTruncated`；不记录普通对话、桌面正文、标题原文、媒体名称、完整 Prompt、API Key 或音频。

`context-assembled` 保留每次请求的历史/必需输入估算 Token、选择/省略消息数、依据数量、召回是否注入，以及 `session-window` 或 `candidate-only`，用于核对 Context 边界。`p2-b-request-start/end` 保留各轮实际模型请求耗时；`omittedMessages` 表示此次未选择的历史总数，不表示删除记录。Memory/Provider/TTS 专项延迟埋点、首 Token 分析和事件循环采样已移除；P2 A 的可选请求阶段诊断继续保留。

日志追加至仓库下的 `.local/desktop-awareness-diagnostics.jsonl`，已由 `.gitignore` 忽略。main 首次写入时打印完整位置；默认关闭不创建目录/文件、不发诊断 IPC、不保留诊断采样或关联表。关闭不删除之前的日志。

```powershell
# 在另一个位于仓库根目录的 PowerShell 查看
Get-Content -LiteralPath '.local/desktop-awareness-diagnostics.jsonl' -Encoding UTF8 -Tail 40 -Wait

# 完全退出 Electron；删除当前 shell 的开关，再重新启动
Remove-Item Env:AISLING_DESKTOP_DIAGNOSTICS -ErrorAction SilentlyContinue
Remove-Item Env:AISLING_DESKTOP_DIAGNOSTICS_REPLY_TEXT -ErrorAction SilentlyContinue
pnpm dev:desktop
```

## P1 字段与关联

P1 session 的 diagnostics-started 标明 schema=desktop-candidate-v1。既有文件中的 P0.5 eventId 记录保留为历史证据；运行时没有旧 Event 协议。

- at 为 epoch 毫秒；sessionId 区分进程；sampleId 关联一次轮询。
- sample.changedFields 是原始采样差异，不是语义分类。media 枚举顺序或重复变化可以记为差异，而稳定候选仍不变。仅 idle/不变采样使用短记录。
- candidateId 指本次回应版本/机会；objectId 指观察容器或曲目。candidateSource/change 是程序确定的归因；targetFingerprint 可对照判断与生成的同一目标输入，不是语义分类。observation.status 为 new/reserved/handled/superseded；superseded 表示前台待发版本已失效，不代表该版本成功回复。deliveredAt/recentReplyPresent 是目标记录。
- P1.1 的 foreground-stabilizing 表示已知窗口的新内容版本还未连续采到两次，尚不进入 Jev；foreground-superseded 表示旧的待发版本已被成功交付、离开已评论情境或较新稳定版本淘汰，不再复用高分。标题/正文原文仍不写入日志。
- judge-requested 不保证调用已发生；只有 main 校验后的 jev-call 才表示进入实际 SemanticJudge。judge-returned 后接受或丢弃；judge-failed 不保存错误正文。
- judge-cached 不新增调用；judgmentId/judgmentSampleId 保留原判断，sampleId 是当前采样。gate 保存真实首个原因。
- media-revalidated 是生成前核验；media-delivery-check 的 checkedSnapshot 是最终交付前核验。snapshot 始终标明该 stimulus 的生成依据。核验不会添加模型调用。
- stimulusId/turnId 关联 Chat；chat-cancel-requested 的 reason 指 quiet 或 media-changed/media-ambiguous/media-unavailable。failed/empty/cancelled 无成功交付。
- delivery 保存 candidateId/objectId/intendedTarget/是否写入回复摘要。intendedTarget 只是请求目标来源，replyTarget=unknown，不能伪称已识别实际语义对象。

默认不保存目标正文、媒体名称、普通聊天或 Prompt；桥接 UIA 指纹为 SHA-256，其余标明 FNV-1a 32 位的诊断指纹仅用于轻量分析、不参与业务身份。文件异步顺序写入；异常终止可能丢失末尾记录。开关 OFF 不创建文件或诊断关联数据。

## 人工实测

保持原 Jev/Chat 配置、历史开关、阈值和冷却。不要为测试强制高分。等待自然的 `delivery`；只有低分记录不能算“回复后重复测试”。

1. **后台切歌**：Chrome 文章前台，等待首次文章评论；正文保持静止，后台切歌。对照 changedFields 是否只有 media（可能伴随 idle），候选/对象 ID 是否稳定、是否 duplicate、是否出现新的 Chat/delivery。
2. **窗口往返**：首次 Chrome 评论后切到 QQ，直到日志 sample 的 app 确实为 QQ，再返回原页面。对照三个样本的 ID、候选是否变化、recentReplyPresent、historyIncluded、实际调用/缓存及 gate。不要把未采到的窗口切换当作已观测事件。
3. **同歌重复**：播放器前台，曲目保持不变，等待歌词/UIA 变化和可能重复。对照媒体身份指纹是否稳定、正文/标题指纹是否变化、是否新建候选或证据不足、是否复用原高分、是否达到期限或存在采样间隔。

每次提供同一 session 从首次交付之前到异常之后的连续 JSONL，包含原判断 ID 所在记录。不要只摘取 delivery。另说明操作时间、场景和人工看到的回复对象；如未开启回复正文，附异常前后的自主回复文字。不要提供配置文件、密钥或普通聊天历史。

可按 ID 快速筛选（必须同时保留其 sample、原缓存判断和相邻采样）：

```powershell
$diagPath = Join-Path (Get-Location) '.local/desktop-awareness-diagnostics.jsonl'
Get-Content -LiteralPath $diagPath -Encoding UTF8 | ForEach-Object { $_ | ConvertFrom-Json } |
  Where-Object { $_.judgmentId -eq '<judgmentId>' } |
  Format-Table at,type,sampleId,candidateId,objectId,stimulusId,score,reason
```

## 验证命令

所有模型/原生能力由已有或新增测试的 Mock 替代，不调用真实付费模型：

```powershell
pnpm --filter @aisling/stage-web test -- src/runtime/autonomous.test.ts src/runtime/desktop-observations.test.ts src/stores/stage-autonomous.test.ts
node --test apps/stage-desktop/desktop-activity.test.cjs apps/stage-desktop/desktop-judge.test.cjs apps/stage-desktop/desktop-diagnostics.test.cjs
pnpm --filter @aisling/core test -- src/runtime-autonomous.test.ts
pnpm -r run typecheck
pnpm --filter @aisling/stage-web build
```

测试覆盖开关 OFF、缓存原判断映射、媒体稳定/波动、歌词/窗口返回、有限 idle 机会、pending/失效/失败、候选交付关联、失败/空/取消、正文授权、日志失败隔离和快照校验。诊断开关前后调用次数及模型输入不变；P1 自身新增媒体生成前/交付前的业务核验采集。
