# P2 短期情境认识（预览，默认关闭）

## 双链路

快速链路保持 `Observation → Candidate → Jev → LLM B → Delivery`。慢链在有效 Snapshot 到达后、Jev 门控之前接收前台证据，按 `Snapshot / 明确纠正 → LLM A → 有界认识 → 后续 LLM B` 更新。A 与 B 复用现有 Chat Provider，但任务和请求参数独立；B 只同步读取就绪认识，不等待 A，也不将认识写入对话历史。

A 输入包含上一版认识、支持它的原始证据和新增证据。完整结果通过 JSON、范围、修订号、覆盖列表、引用原文和精确版本校验后才提交。claims 是完整替换，省略即移除；retracted 只能撤销上一版实际存在的 claim，并引用新增纠正证据。来源陈述、用户报告和推断不等于已验证事实。B 自身发言不进入慢链证据或触发 A 更新。

## 开启与关闭

从仓库根目录运行 `pnpm dev:desktop`；生产入口为 `pnpm start:desktop`，它会先构建。配置现有 Chat Provider 与 Jev，开启桌面感知，再在“设置 → 桌面感知 → 高级设置”勾选“短期情境认识（预览）”并保存。开启会将有界前台原文和明确纠正发送给当前 Chat 模型；没有新增模型设置。

取消该勾选并保存，或关闭桌面感知，会立即清除临时认识、证据和队列，并取消/作废在途更新。开关切换不重置本实例的调用预算。默认不持久化认识或诊断。

## 当前能力和保护

- 仅支持一个当前前台范围，保守使用 HWND/app/title 划定范围；不支持媒体语义、跨文档身份、跨会话记忆或长期记忆。切换范围、新会话、Provider 更换、无效/不可用采样都会清除认识并阻止旧任务提交。
- 同范围新正文允许旧批次完成历史进度，但新证据处理完之前禁止注入 B。明确引用当前屏幕/页面的用户消息，或与当前范围及正文匹配的前台自主候选，才可消费认识；普通聊天和媒体候选不注入。
- “纠正当前页面：实际是……”等明确陈述作为 user-report 输入；问题和无范围的陈述不反馈。新证据或纠正立即暂停旧认识，失败后也不会重新暴露它。
- 认识十分钟到期；消费还要求最近有效采样不超过三十秒。相同 HWND/标题不能证明同一文档，未采到的切换无法识别。quiet、轮询 pending 等继续沿用 P1.1 采样行为，不是连续感知。

## 预览资源边界

这些是当前实验保护，尚不是长期使用或账单策略；本轮没有提高预算、缩短限频或延长超时。

| 项目 | 当前限制 |
| --- | --- |
| A 尝试预算 | 每个 Stage 实例最多 8 次，失败/取消也计入；重新加载实例才重置 |
| 调度 | 首条入队后 1.5 秒合并；三个不同观察版本可提前就绪；启动间隔至少 4 秒 |
| 并发/截止 | 一个物理任务；15 秒截止；忽略取消的执行器占用唯一槽直到收束 |
| 证据 | 待处理最多 6 项、保留最多 8 项；单条观察 2000 字符、反馈 1000 字符 |
| 长度 | 请求含 system 最多 24000、输出 6000、认识 4000、B 注入 3000 UTF-16 单元 |
| 输出 | 最多 6 条 claim、4 条未知；每个引用必须可在给定版本的原文中定位 |

重复版本不会重复请求，持续变化不会滑动延后首次合并截止。溢出丢弃最早待处理项并标记遗漏；截断证据带标记。超长请求、完整输出或 B 上下文直接拒绝，不切断 JSON。流式正文超过输出上限会停止收集并取消响应体。失败批次保留在有界队列中，没有新证据不自动重试；执行期间已有新证据则沿限频恢复。调用预算按尝试计数，可能包含尚未进入 HTTP 的输入超限；不是 Token 或金额计量。

A 优先使用 Provider.stream，无该接口才用 complete；失败不切换传输重试。A 无工具，单请求 temperature=0.2、max_completion_tokens=800。仅在精确匹配 HTTPS api.ppio.com、路径 /openai 或 /openai/v1、模型 qwen/qwen3.8-flash 时设置 enable_thinking=false；其他路由省略。B 保持原参数，省略上述 A 专用覆盖。供应端参数兼容与计费效果仍需实机确认。

## 待验收边界

此前真实模型形成完整认识仍约 10 秒。连续桌面变化可能使认识持续落后，即使 A 提交成功，也不代表 B 已可消费。v0.3.5 收束前，用户报告开启 P2 后与 Context 的协作符合预期；这是有限人工验收，不代表已充分验证真实认识的长期收益、桌面连续变化、运行成本或共享服务争用。八次预算可能在短时间内耗尽。引用校验只能证明出处匹配，不能证明模型语义正确或用户确实关注该内容。

公开 S04/S05/S06 序列仅用于离线范围隔离、证据保留和 Prompt 组装回归，fixture 位于 runtime/__tests__/fixtures；Mock 通过不代表模型质量、真实延迟或正式产品验收通过。原始研究证据保留在本地忽略目录和独立 Lab，不进入运行资源；一次性付费回放及材料导出入口已移除。

## 最小桌面验收

1. 按上述步骤启动并开启预览，选择采集器可读的公开页面，先保持内容稳定。用下述诊断确认 A 的 committed=true，记录 snapshotToCommitMs；首字提前不能替代完整认识提交。
2. 发送“解释当前页面相对此前的进展”，确认对应 B 的 injected=true、关联的 updateId/revision 和最终 delivered=true，并人工检查回复归属及内容。A 提交本身不代表 B 消费成功。
3. 发送明确纠正，确认旧认识暂停、新认识修正/撤销后才恢复消费。连续滚动时允许不注入，不应出现过时认识冒充当前内容。
4. 切换观察对象、新建/切换会话或更换 Provider，检查旧认识不复用；关闭预览并保存，确认后续没有新 A 调用，B 仍正常回复。

## 必要诊断与离线检查

诊断沿用 [Desktop Diagnostics](./desktop-diagnostics.md)，启动时显式开启；正文诊断继续关闭：

```powershell
$env:AISLING_DESKTOP_DIAGNOSTICS='1'
Remove-Item Env:AISLING_DESKTOP_DIAGNOSTICS_REPLY_TEXT -ErrorAction SilentlyContinue
pnpm dev:desktop
```

另一个位于仓库根目录的 PowerShell 查看 P2 元数据（Windows PowerShell 需指定 UTF8）：

```powershell
Get-Content -LiteralPath '.local/desktop-awareness-diagnostics.jsonl' -Encoding UTF8 -Tail 60 -Wait |
  ForEach-Object { $record = $_ | ConvertFrom-Json; if ($record.type -like 'p2-*') { $record | ConvertTo-Json -Compress } }
```

A 的 update-start/end 记录批次、尝试数、结果、修订和延迟；仅 committed=true 表示已校验提交，usable 表示提交时未被新证据挡住。超时/取消的物理任务结束后才补 settled。a-http 只记录 HTTP/首字/完整结果/JSON 阶段和长度、停止原因及失败分类，不保存正文、reasoning、Prompt、API Key 或原始错误。B 的 context、request-start/end、delivery 分别证明实际注入、请求和交付。用 sessionId、updateId/scopeId 和 turnId/requestId 关联；revision 单独不足以跨范围关联。计数不等于 Token 或账单。

诊断默认关闭，不创建文件；仅关闭 P2 时，已开启的诊断仍可记录 B 的 feature-disabled。完全退出 Electron，移除 AISLING_DESKTOP_DIAGNOSTICS 后重启可停止持久诊断；不会删除原日志。

离线检查，不读取真实密钥或请求付费模型：

```powershell
pnpm --filter @aisling/stage-web exec vitest run src/runtime/situation-working-state.test.ts src/runtime/situation-public-sequences.test.ts src/stores/stage-autonomous.test.ts src/runtime/autonomous.test.ts src/runtime/desktop-observations.test.ts
pnpm -r run test
node --test apps/stage-desktop/desktop-activity.test.cjs apps/stage-desktop/desktop-judge.test.cjs apps/stage-desktop/desktop-diagnostics.test.cjs
pnpm -r run typecheck
pnpm build
git diff --check
```
