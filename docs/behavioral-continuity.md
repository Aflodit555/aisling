# 近期交流偏好

明确的近期交流偏好是正式本地功能，控制自主发言，不增加模型调用或独立 Memory 系统。

## 当前状态与识别方式

偏好存放在 Stage 的 `autonomous.preference`，初始为 `normal`。

| 输入示例 | 状态 | 实际决策效果 |
| --- | --- | --- |
| `/quiet`、`暂时别主动打扰我`、`请不要主动打扰我` | `quiet` | 在桌面采集、Jev 判断和自主生成入口之前拦截 |
| `/normal`、`恢复正常交流` | `normal` | 恢复原有自主机会判断 |
| `/invited`、`可以主动交流了` | `invited` | 明确允许主动交流；仍遵守 0.65 阈值、冷却、忙碌和候选生命周期 |

完整指令表见 `apps/stage-web/src/runtime/interaction-preference.ts`。这是整个消息的有限明确指令识别：仅做 NFKC、大小写、首尾空白、句末句号／感叹号归一化。引用、否定、提问和复合句不作语义推断，例如 `请解释“暂时别主动打扰我”是什么意思` 不改变状态。

指令由 Stage 本地处理并显示文字确认，不调用聊天或语音服务。指令和确认进入正常会话记录。普通用户问答不改变偏好，继续走原来的 Chat → TTS / emotion 链路；有待发送的图片也不会把偏好指令变成图片说明。

状态持续到下一条明确偏好指令或 renderer 重建，无定时过期；新建／切换会话及关闭／开启 Desktop Awareness 不自动撤销。偏好不持久化，重启／刷新后恢复 `normal`，不会从旧聊天记录重新推断。`invited` 只表示明确授权，不提高发言频率。

## 路径与在途边界

`stage.sendStimulus()` 先识别偏好，再检查忙碌。Stage 和 Desktop 输入框允许忙碌期间发送明确指令；普通消息保持原有忙碌限制。

1. **新触发**：quiet 在 controller 的采集前与 Stage 的自主入口处拦截。恢复后重新判断，已有冷却和候选处理事实仍保留。
2. **在途采集／Jev**：偏好指令增加 revision、清除缓存分数，旧结果返回后丢弃。即使 quiet 后马上恢复，旧结果也不能重新生效；已有 IPC／网络请求继续等待原超时，不增加取消协议。
3. **在途自主 Chat**：quiet 标记该轮为 cancelled，清除已展示的部分文本，忽略后续部分文本和最终成功／错误，不触发 TTS 或情绪，不保存该回复。该轮结束时通过已有 `resetHistory()` 同步 Core 历史，移除其内部追加的被丢弃回复；恢复授权不会复活该轮。现有单轮 busy 门控保证此同步不会覆盖另一轮正常问答。
4. **在途用户问答**：quiet 不取消用户主动提出的问题，该轮正常完成；期间收到的偏好指令在结束时一并同步历史，避免重复用户消息。

交流偏好不修改模型 Prompt 或阈值，不停止已播放的语音、真正 abort 自主 Chat 请求、立即释放其 busy 状态或阻止该请求内部后续工具调用。因此 quiet 后的上游请求仍可能继续消耗调用资源。

## 最小诊断

在 Vue / Pinia DevTools 查看 Stage store 的 `autonomous.preference` 和 `autonomous.decisions`。decisions 仅保留最近 50 条，不写文件、不输出控制台。

每条记录包含 `source`、毫秒时间 `at`、当时的 `preference`、`outcome`、`reason`，已生成 stimulus 时附带 `stimulusId`。不包含桌面文本、标题、签名、消息正文、模型提示或密钥。

- `user-text / updated / explicit-command`：明确偏好指令。
- `desktop-poll / blocked / quiet`：阻止新的自主检查。
- `desktop-poll / blocked / invalidated`：丢弃在途采集或判断。
- `desktop / allowed / gate-passed`：自主生成获准开始。
- `desktop / blocked / quiet-in-flight`、`cancelled-output`：此前已触发的一轮被撤销及最终丢弃。
- `desktop / allowed / output-delivered`：最终回复进入正常输出链路。
- 其余原因包括 disabled、pending、desktop-unavailable、not-ready、busy、duplicate、below-threshold、cooldown、foreground-stabilizing、foreground-superseded、media-stale 或 judge-or-capture-error；完整门控见 `runtime/autonomous.ts`。

门控获准开始不等于最终输出已交付；通过同一 stimulusId 区分这两步。

## 验证

自动测试覆盖有限指令识别与误匹配、quiet 阻止新采集／判断／生成、normal 和 invited 恢复、原阈值与冷却保留、在途判断失效（含 quiet→invited 快速变化）、在途自主流成功／失败丢弃、正常问答、会话切换保留偏好、日志字段与数量边界、Core 和持久化历史同步。

桌面候选归属与近期成功回复现由 [Desktop Situation Understanding P1](./desktop-situation.md) 定义；本文只说明交流偏好，不再保留被替代的媒体身份实验说明。
