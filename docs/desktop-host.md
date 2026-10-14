# Desktop host：当前实现

Windows Electron 是主入口；Browser Stage 保留为开发入口。桌面候选与自主发言设计见 [Desktop Situation Understanding P1/P1.1](./desktop-situation.md)，诊断见 [本地运行诊断](./desktop-diagnostics.md)。

## 启动与构建

需要 Node.js 22.12+、pnpm、CMake 3.25+、支持 C++23 的 MSVC 和 Windows SDK。首次克隆后：

```powershell
git submodule update --init
pnpm install
cmake -S external/kernel_c -B external/kernel_c/build
cmake --build external/kernel_c/build --config Release
pnpm dev:desktop
```

scripts/dev-desktop.mjs 启动 Vite（5174），轮询 HTTP ready 后启动 Electron，并在 Electron 退出时结束自己启动的子进程树。pnpm start 是 pnpm dev:desktop 的别名。pnpm start:desktop 先构建 renderer，再运行 built 路径。

desktop-app.cjs 优先使用 AISLING_STAGE_URL，否则使用已有的 stage-web/dist，无构建时回退 dev URL。desktop-protocol.cjs 通过标准 secure scheme aisling://stage 提供 built renderer、SPA 路由和已有 Web Search relay。

## 采集与边界

- desktop-activity.cjs 启动固定的 external/kernel_c/build/Release/kernel.exe，向 stdin 写请求序号，只接受匹配序号的回复；超时为五秒。
- 原生进程读取前台 UIA、Playing 媒体、麦克风使用、idle 和音频设备。自己的窗口被排除；采样元数据包含 capturedAt、targetHwnd、sequence。UIA 正文经桥限制为 2000 字符，生成空白归一化 SHA-256。
- preload.cjs 提供固定 IPC 面，renderer 不获得 Node 或任意 IPC 权限。main 校验消息来源、候选与快照、近期回复授权，再调用 Jev。
- 旧 PowerShell foreground.ps1 已被原生采集器替代并移除；没有旧 EventMemory 适配路径。
- 原生源码通过子模块固定到明确提交，构建产物不入 Git。

## 数据归属

Electron 的 Settings 与 Conversation 由 main 的 desktop-store.cjs 写入 userData 下的 aisling-store.json。renderer 通过 storage.getItem/setItem 使用此后端，dev/built 共用数据。浏览器继续使用 localStorage。

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

built renderer 的协议目前提供 Web Search relay，未提供 Alibaba HTTP TTS 的 Vite relay。默认 WebSocket TTS 与 HTTP transport 要分别看其实际连接路径；本轮未修改 Speech。桌面 UIA／媒体采样边界以 desktop-situation.md 为准。

installer、签名、自动更新等发布能力不在本阶段范围内。旧的“双终端、readActivity、PowerShell 前台标题”说明已被本页替代。
