# Consciousness 普通对话思考策略

当前阿里云北京工作空间端点上的 `qwen3.7-flash` 普通文字对话显式发送 HTTP JSON 顶层 `enable_thinking: false`。用户实测确认低延迟改善，并接受一定回答质量代价。该策略不依赖诊断开关，没有新增 UI 或持久化配置；模型名、Temperature、工具、Memory 与 Context 沿用用户配置。

## 生效范围

`provider-factory.userTextEnableThinking` 仅匹配 `openai-compatible`、精确模型名 `qwen3.7-flash`、HTTPS 的 `*.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，允许尾部斜杠。其他模型/端点、带凭据/查询/片段的 URL 或无效 URL 保留自身默认值。

`Stage → Aisling Runtime → Core Runtime` 每个普通文字 turn 读取一次策略，流式、非流式和工具续请求均传给已有 Provider 序列化器。没有设置共享 Provider 全局默认值：Reflection 直接调用、视觉、自主回复和 Desktop Awareness 保留各自策略。

官方依据：[阿里云 Chat Completions](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions) 说明直接 HTTP 请求将参数放在 JSON 顶层；[思考模式文档](https://www.alibabacloud.com/help/en/model-studio/deep-thinking) 列出 Qwen3.7 Flash 支持显式关闭思考。

## 回归与核验

- `runtime/thinking-policy.test.ts`：Mock HTTP 检查 Memory OFF/ON × stream/complete 的实际 body，唯一变化为顶层 false；保留其他请求字段、证据及来源映射，并验证其他 Provider/模型兼容。
- `core/runtime-thinking.test.ts`：工具轮参数稳定，视觉/自主回复不调用普通聊天策略。
- Stage Memory、Reflection 与 TTS 生命周期测试覆盖各自正式行为。

正常启动使用 `pnpm start:desktop`，无需诊断环境变量。需要核对真实请求时，在开发者工具 Network 中查看新 `/chat/completions` 请求的顶层 `enable_thinking: false`，并检查响应是否仍输出 reasoning。正式自动化测试使用 Mock，不替代真实 API、声卡或复杂问题质量验证。
