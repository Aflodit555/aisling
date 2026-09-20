# Autonomous speaking：最小桌面纵向切片

## 修改前的真实链路

仓库基线是 v0.1.6 Web Stage，原先没有 Electron main、preload 或 IPC。

`Composer.vue → InteractionDock.vue → stage.send → createWebTextStimulus → stage.sendStimulus → runtime.ingest → handleUserText → runChat → settings.activeChatProvider.complete → TextOutput → Stage messages / sessionMessages → localStorage → speech.speak`

- `createAislingRuntime` 创建角色和 runtime；provider、tools 在调用时从 Settings 获取。
- runtime 的 history 保存最近 40 条模型上下文；Stage 单独保存当前会话和最多 200 条 UI 消息。
- `speech.speak` 调用当前 Speech provider；未配置时直接返回。Browser Speech 直接朗读，Alibaba 经现有 Vite relay 返回音频并播放。
- Settings 是 Vue Router 下的现有模块页面，本轮保留原结构。

## 修改后的最小链路

`Windows 前台窗口 app/title → Electron main（5 秒缓存）→ preload 固定只读 IPC → Stage 每秒检查静默/忙碌/冷却 → AutonomousStimulus → runtime.handleAutonomous → 现有 Consciousness → 原 CharacterOutput/UI/持久化/Speech 链路`

- 开关默认关闭；关闭时停止采集和自主触发，刷新后也恢复关闭。
- 阈值默认 90 秒，可调 10–600 秒；每次尝试开始和结束都设置 180 秒冷却，失败也冷却。
- silence 从最近的人类交互计算：发送消息、应用内可信键盘/点击/输入/滚动，以及 Electron 提供的桌面键鼠 idle time。Aisling 输出不重置这个时间。
- 活动读取不占用 `sending`；用户输入、修改设置或切换会话会使未完成的读取失效。读取返回后再次检查开关、provider、cognition、Vision、Speech 和 cooldown，才同步进入现有 runtime。
- metadata 作为临时 system context，包含 app/title 和 silence；沿用最近会话上下文。没有假 user message，也不把 metadata 写入对话存储。
- 对实际为空的模型输出不增加空消息；没有新增模型决策协议。模型正常返回时按低频率显示一句回复。
- 在生成或 Vision 处理期间暂停会话切换/新建/删除，防止异步回复写进其他会话。

## 文件清单与职责

| 文件 | 改动 |
| --- | --- |
| `apps/stage-desktop/package.json` | 新增最小 Electron workspace、启动/类型检查/冒烟命令 |
| `apps/stage-desktop/main.cjs` | 加载现有 Vite Stage，保持 sandbox/contextIsolation，关闭 Node 集成，校验 IPC sender/frame/origin，限制导航 |
| `apps/stage-desktop/preload.cjs` | 只暴露无参数的 `readActivity()`，不暴露原始 IPC |
| `apps/stage-desktop/desktop-activity.cjs` | Windows 采集适配、单次并发、5 秒缓存、4 秒超时、长度限制和失败降级 |
| `apps/stage-desktop/foreground.ps1` | 固定 Win32 调用读取顶层前台窗口的进程名和标题 |
| `apps/stage-desktop/smoke.cjs` | 隐藏窗口和独立临时用户目录中的实际 IPC/UI/输出链路冒烟测试 |
| `apps/stage-web/src/runtime/autonomous.ts` | 最小状态和 deterministic gate；取消待触发、重置静默、冷却 |
| `apps/stage-web/src/stores/stage.ts` | 接入 gate、复用 sendStimulus/持久化/Speech，保护生成中的会话归属 |
| `apps/stage-web/src/App.vue` | 应用级单个观察定时器、可信交互事件、卸载清理 |
| `apps/stage-web/src/env.d.ts` | preload bridge 的 renderer 类型 |
| `apps/stage-web/src/components/AutonomousControls.vue` | 可折叠开关、阈值、app/title、silence/cooldown、错误提示 |
| `apps/stage-web/src/components/InteractionDock.vue` | 在现有 dock 嵌入控制面板 |
| `packages/core/src/stimulus.ts` | 明确区分 AutonomousStimulus 与 UserTextStimulus |
| `packages/core/src/runtime.ts` | 新增自主观察 handler，临时 system context，沿用 runChat |
| `packages/core/src/index.ts` | 导出新增 stimulus 和 activity 类型 |
| `packages/core/src/runtime-autonomous.test.ts` | 验证模型上下文、输出事件、无假用户历史、失败和空回复 |
| `apps/stage-web/src/runtime/autonomous.test.ts` | 验证开关、阈值、冷却、抢先输入、并发读取和错误 |
| `apps/stage-web/src/stores/stage-autonomous.test.ts` | 验证 UI/持久化/Speech 链路、用户优先、会话归属和失败冷却 |
| `apps/stage-web/vitest.config.ts` | 新增 Web Stage 测试配置 |
| `apps/stage-web/package.json` | 加入 Web Stage 测试命令和 Vitest 依赖 |
| `package.json` | 加入根目录 `dev:desktop` 命令 |
| `pnpm-workspace.yaml` | 允许 Electron 依赖的安装构建 |
| `pnpm-lock.yaml` | 锁定新增依赖 |
| `README.md` | 添加桌面启动和本文档入口 |
| `docs/autonomous-speaking.md` | 本次实现和验收说明 |

## 启动

Windows 10/11，Node.js ≥22.12（本机验证环境为 Node 24）、pnpm。

```powershell
cd D:\Project\demo\project_Aisling
pnpm install
pnpm dev:desktop
```

单命令即可：`dev:desktop` 自动启动 Vite、等待 ready、再启动 Electron，退出后清理
renderer 进程（详见 [desktop-host.md](desktop-host.md)）。首次启动可能需要下载
Electron 二进制。开发态 Stage 使用 `http://localhost:5174`，也继续复用该服务的
Alibaba relay；构建态用 `aisling://stage` 承载 `stage-web/dist`。

Electron 内 Settings / Conversation 经薄的存储桥写入 Electron userData 的
`aisling-store.json`（与浏览器 localStorage 隔离，且首次会做一次最小迁移）。

Desktop 的可执行入口 `main.cjs` 会无条件启动真实窗口；可复用创建逻辑位于 `desktop-app.cjs`。正常 `dev:desktop` 固定使用可见窗口，hidden 模式只由 `test:smoke` 显式传入，二者不会共享启动分支。开发终端会打印 main、ready、create、load、show、renderer、preload 和进程异常诊断。

## 人工验收 A–H

1. 在 Electron Settings → Consciousness 中配置并保存可用的真实 provider。Mock 可验通路，但不能验证内容理解。
2. 返回 Stage，展开聊天区域底部的 **Autonomous Speak**。Electron 中应先显示 `Desktop bridge: connected`；打开 **Proactive speak**，将阈值设为 10 秒（默认 90 秒）。普通浏览器会显示 `Desktop bridge: unavailable`，并明确禁用开关。
3. 切到 VS Code 或其他有明确标题的窗口，然后停止键鼠操作。等待阈值及约 1 秒检查延迟。应出现一条 assistant 回复，没有附加 user 消息（A）。
4. 返回 Stage 查看 app/title；回复应能参考前台活动。若模型只是寒暄，可在 Devtools/调试中检查 `stage.lastTurn.stimulus` 的 autonomous metadata，而不是假用户文本（B）。窗口标题不保证模型每次显式复述。
5. 关闭开关，等待超过阈值，确认不再增加自主 provider 调用。已经开始的请求允许结束（C）。
6. 发送正常消息，确认 silence 回到 0，正常回复和会话存储正常（D、G）。桌面键鼠操作也会重置 silence。
7. 主动发言后观察 cooldown 约 180 秒倒计时。期间不会再触发；即使请求失败也不会每秒重试（E）。
8. 观察主动回复后的 silence 继续累加而非归零；Devtools 只有实际触发时出现 `stimulus:received` 等事件，轮询不会增加消息。持续无人交互时，下次最早在冷却结束后（F）。
9. Settings → Speech 选择并保存 Browser/System 或 Alibaba，重复验证可朗读；选择 Disabled/None 后只出现文字（H）。实际声音取决于本机声卡/声音配置和 provider。
10. 接近阈值时开始输入或发送消息，待触发的自主观察应取消，用户发送不被活动读取阻塞。生成已开始时保持现有 busy 行为，不支持生成中打断。

## 自动检查

```powershell
pnpm typecheck
pnpm test
pnpm build
# 保持 pnpm dev 运行；在已解锁的交互 Windows 桌面运行：
pnpm --filter @aisling/stage-desktop test:smoke
```

单元/集成测试共 57 项（core 43、Web Stage 14）。自主发言相关新增 16 项。本轮还检查实际 Windows foreground 采集，不把沙箱中的空窗口读数视为桌面成功。

本轮结果：`pnpm typecheck` 通过（含 Electron JS 的 checkJs）、57 项测试全部通过、`pnpm build` 通过、`git diff --check` 通过。真实 Windows 前台采集及 Electron 隐藏窗口冒烟均通过；已查看实际渲染截图。冒烟还验证了整行 label 与 toggle 的 On/Off、10 秒阈值写入、刷新恢复，以及无 preload 的普通浏览器禁用态。

桌面冒烟实测首条仅为 assistant、冷却期间调用次数保持 1、发送真实用户文本后消息角色为 assistant/user/assistant、两次回复均进入同一 Speech 接口。测试模型和语音接口均为 stub；未调用真实付费模型，也未验收扬声器音频。

Electron 冒烟使用真实 IPC 和桌面快照、模拟 Consciousness/Speech，并仅在测试中把阈值降至 0；验证不产生假 user message、冷却、正常聊天以及隔离设置。它不验证真实模型内容质量或扬声器声音。

## 当前限制

- 这是开发用 Electron 外壳，依赖现有 Vite 服务；未制作安装包、自动更新或生产打包流程。
- 当前只支持 Windows app/title；无 focus、Accessibility Tree、输入框文本、剪贴板、页面全文或屏幕采集。
- 标题最多 300 字符，应用名最多 120 字符；标题最多约 5 秒缓存延迟。锁屏、无前台窗口或采集失败时不自主推理。
- 桌面标题可能包含文件名/网页标题；只有开启后才读取，并在实际自主调用时发送给所配置的模型。快照不写入 conversation localStorage，最近 runtime 事件仍可在内存中包含该 metadata。
- 桌面键鼠活动都会重置 idle；持续操作其他应用时也不会主动发言。不是按“多久没发聊天消息”单独计算。
- 默认关闭、不持久化开关和阈值。刷新/重启后重新启用。
- 不支持生成中断；关闭开关后已开始的请求仍可完成。忙碌时暂不能切换会话。
- 没有新增完整 Policy、Scheduler、Queue 或 Agent，也没有正式 no-response 决策协议。
- Hearing / ASR 未改动；没有提交 Git。

安全 IPC 实现参考 [Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) 和 [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)；窗口采集使用 [Microsoft GetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow) 所指的前台窗口。
