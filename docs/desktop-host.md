# Desktop host：当前实现

Windows Electron 是主入口；Browser Stage 保留为开发入口。桌面候选与自主发言设计见 [Desktop Situation Understanding P1/P1.1](./desktop-situation.md)，诊断见 [本地运行诊断](./desktop-diagnostics.md)。

## 启动与构建

需要 Node.js 22.12+、pnpm、CMake 3.25+、支持 C++23 的 MSVC 和 Windows SDK。首次克隆后：

```powershell
git submodule update --init
pnpm install --frozen-lockfile
cmake -S external/kernel_c -B external/kernel_c/build
cmake --build external/kernel_c/build --config Release
pnpm dev:desktop
```

当前仍是需要源码和开发依赖的早期项目，没有面向普通用户的安装包。当前开发和桌面实机调试默认使用 `pnpm dev:desktop`；检查构建后的应用运行方式时使用 `pnpm start:desktop`。

| 命令 | 用途与运行方式 |
| --- | --- |
| `pnpm dev:desktop` | 边改边运行：启动本地开发服务器，再打开桌面窗口；界面代码修改通常自动更新 |
| `pnpm start:desktop` | 检查构建后的应用：先构建，再打开桌面窗口；不运行开发服务器，修改后需重新执行该命令 |
| `pnpm start` | 当前是 `pnpm dev:desktop` 的别名，仍属于开发启动 |
| `pnpm dev` | 只打开浏览器开发入口，不具备原生桌面采集能力 |

`start:desktop` 更接近未来用户安装后运行应用的形态，但当前不会生成安装包，也不代表功能已正式验收。两种桌面启动方式应当具有相同功能，共用已保存的设置和聊天记录；切换入口不应改变可用功能。开发服务器提供的转发接口不会自动进入构建产物，因此生产宿主也必须提供对应接口，并分别测试两条启动路径。

scripts/dev-desktop.mjs 在开发模式下启动 Vite（5174），等待就绪后启动 Electron，并在 Electron 退出时清理自己启动的子进程。生产模式下先构建 renderer，再交给 Electron 直接加载。

desktop-app.cjs 优先使用 AISLING_STAGE_URL，否则使用已有的 stage-web/dist，无构建时回退 dev URL。desktop-protocol.cjs 通过标准 secure scheme aisling://stage 提供 built renderer、SPA 路由、Web Search 及 Alibaba 语音转发。

## 采集与边界

- desktop-activity.cjs 启动固定的 external/kernel_c/build/Release/kernel.exe，向 stdin 写请求序号，只接受匹配序号的回复；超时为五秒。
- 原生进程读取前台 UIA、Playing 媒体、麦克风使用、idle 和音频设备。自己的窗口被排除；采样元数据包含 capturedAt、targetHwnd、sequence。UIA 正文经桥限制为 2000 字符，生成空白归一化 SHA-256。
- preload.cjs 提供固定 IPC 面，renderer 不获得 Node 或任意 IPC 权限。main 校验消息来源、候选与快照、近期回复授权，再调用 Jev。
- 旧 PowerShell foreground.ps1 已被原生采集器替代并移除；没有旧 EventMemory 适配路径。
- 原生源码通过子模块固定到明确提交，构建产物不入 Git。

## 数据归属

Electron 的 Settings 与 Conversation 由 main 的 desktop-store.cjs 写入 userData 下的 aisling-store.json。renderer 通过 storage.getItem/setItem 使用此后端，dev/built 共用数据。浏览器继续使用 localStorage。

Reflection 独立保存为 `userData/aisling-reflections.v1.json`，不混入设置／会话文件。Formation 默认关闭；产物的读取、来源失效与故障定位见 [Formation](memory-formation-v0.md) 和 [Reflection Recall](reflection-recall.md)。这两个 userData 文件不属于发布包或 Git 仓库。

resolvePersistentStorage() 在 Desktop 桥为空时迁移既有 origin 的配置与会话；配置加载还保留历史用户授权和模块迁移。凭据在 Settings 中配置，不能提交实际配置文件或 userData。

会话持久化、Core 的模型上下文、短期候选记录和交流偏好各有独立生命周期，不是同一份 Memory。候选记录与偏好不跨 renderer 重启持久化。

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm build
node --test apps/stage-desktop/*.test.cjs
cmake --build external/kernel_c/build --config Release
# dev renderer 已运行时；模型响应由 smoke 替代：
pnpm --filter @aisling/stage-desktop test:smoke
# built renderer 已构建时，使用独立临时 userData：
pnpm --filter @aisling/stage-desktop test:smoke:prod
```

候选 native smoke 需要可访问的稳定前台内容或唯一 Playing 媒体，见 autonomous-speaking.md。它验证桥接和程序门控，不能替代真实模型的回复对象验收。已知测试问题及阶段结果见 [P1.1 工程基线](./p1.1-baseline.md)。

## 已知宿主限制

built renderer 的协议提供 Web Search 和 Alibaba TTS relay。语音的 HTTP 与实时 WebSocket 两种传输均复用开发入口的服务端逻辑，生产启动无需额外运行 Vite；API Key 通过认证头发给供应端，不放进 WebSocket URL。桌面 UIA／媒体采样边界以 desktop-situation.md 为准。

installer、签名、自动更新等发布能力不在本阶段范围内。旧的“双终端、readActivity、PowerShell 前台标题”说明已被本页替代。
