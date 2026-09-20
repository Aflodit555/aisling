# Desktop host：Electron 主线产品化第一轮

本轮把 Aisling Desktop 从“需要两个终端的 Electron 壳”收束为**稳定主线宿主**：
一条命令启动、renderer 同时支持 dev / built 两条加载路径、Settings 与
Conversation 有单一且可解释的数据归属。Browser Stage 保留为开发/轻量入口。

## 旧结构（本轮读取到的真实实现）

- 根 `package.json` 的 `dev` 只起 `stage-web` 的 Vite（固定 `5174`），
  `dev:desktop` 只跑 `electron .`，两者必须分两个终端、人工等待端口。
- `apps/stage-desktop/main.cjs` 无条件 `startDesktop({ show: true })`；
  `desktop-app.cjs` 硬编码 `DEFAULT_STAGE_URL = 'http://localhost:5174'`，
  `loadURL` 永远指向 dev server，`isStageUrl` 用 `new URL().origin` 比较。
- `preload.cjs` 只暴露无参 `readActivity()`；`desktop-activity.cjs` 走 PowerShell
  采集前台 app/title；`foreground.ps1` 是固定 Win32 调用。
- `stage-web` 的 Settings 与 Conversation 都用 `window.localStorage`
  （`aisling.config.v1` / `aisling.conversations.v1` + legacy key），origin 决定了
  数据归属：浏览器与 Electron 物理上是两份独立存储。
- Alibaba TTS/ASR 与 transcription 经 Vite 的 `/api/relay/*` 插件转发
  （`configureServer` / `configurePreviewServer`），只在 dev/preview 存在。
- `smoke.cjs` 依赖 `http://localhost:5174` 且用独立临时 userData。

## 本轮方案

1. **单命令启动**：新增根级编排脚本 `scripts/dev-desktop.mjs`，`pnpm dev:desktop`
   直接启动 Vite → 轮询 `http://localhost:5174` 直到 200（不靠 sleep）→ 启动
   Electron → Electron 退出后按进程树清理 Vite（Windows 用 `taskkill /T /F`）。
   `pnpm start:desktop` 走 `--prod`：先 build 再启动 Electron。
2. **dev / built 加载路径**：`desktop-app.cjs` 按
   `AISLING_STAGE_URL` → 已 build 的 `dist` → 回退 dev URL 的顺序解析。
   built 路径用自定义 `aisling://stage` 标准+secure scheme（`desktop-protocol.cjs`）
   承载 `stage-web/dist`，避免 `file://` 无 origin 导致 localStorage / history 路由失效。
3. **数据生命周期**：`desktop-store.cjs` 在 main 进程用
   `userData/aisling-store.json` 做文件后端；`preload.cjs` 暴露最小
   `storage.getItem/setItem` 桥；renderer 的 `resolvePersistentStorage()` 在 Electron
   内切换到该桥、在浏览器内继续用 `localStorage`，并对旧 `localhost:5174` 的
   localStorage 做一次最小兼容迁移（桥为空时才复制）。
4. **Browser Stage 保留**：`pnpm dev` 不变，仍是开发入口。

## 修改文件

| 文件 | 改动 |
| --- | --- |
| `scripts/dev-desktop.mjs` | 新增单命令编排：Vite 子进程、HTTP ready 轮询、Electron 启动、进程树清理 |
| `apps/stage-desktop/desktop-protocol.cjs` | 新增 `aisling://stage` 自定义协议，从 `stage-web/dist` 提供 built renderer |
| `apps/stage-desktop/desktop-store.cjs` | 新增 userData JSON 文件后端 + 同步 IPC 处理器 |
| `apps/stage-desktop/desktop-app.cjs` | dev/prod 解析、协议与存储注册、`stageOriginOf` 修复自定义 scheme 的 origin 校验 |
| `apps/stage-desktop/preload.cjs` | 暴露 `storage.getItem/setItem` 桥 |
| `apps/stage-desktop/smoke.cjs` | 显式固定 dev URL（避免被 built 路径接管） |
| `apps/stage-desktop/prod-smoke.cjs` | 新增 built 路径冒烟：挂载、桥、存储回环 |
| `apps/stage-desktop/package.json` | typecheck 纳入新文件，新增 `test:smoke:prod` |
| `apps/stage-web/src/storage/desktop-storage.ts` | 新增存储后端选择 + 最小迁移 |
| `apps/stage-web/src/config/local-storage-config-store.ts` | 存储参数改为 `PersistentStorage` |
| `apps/stage-web/src/conversation/conversation-store.ts` | 存储参数改为 `PersistentStorage` |
| `apps/stage-web/src/stores/settings.ts` | 使用 `resolvePersistentStorage()` |
| `apps/stage-web/src/stores/stage.ts` | 使用 `resolvePersistentStorage()` |
| `apps/stage-web/src/env.d.ts` | bridge 类型增加 `storage` |
| `package.json` | `dev:desktop` / `start:desktop` 指向编排脚本 |
| `README.md` / `docs/desktop-host.md` | 启动与数据归属说明 |

## 启动方式

```powershell
pnpm install
pnpm dev:desktop     # 主入口：renderer 自动起 → ready → Electron 自动开
pnpm start:desktop   # 对已构建 renderer 运行（aisling://stage）
pnpm dev             # 浏览器 Stage 开发入口（保留）
```

## Storage / Settings / Conversation 归属

- Electron：Settings 与 Conversation 统一写入 Electron userData 下的
  `aisling-store.json`（与 renderer origin 无关，dev/built 共用一份）。
- 浏览器：保持 `localStorage`，与 Desktop 隔离。
- 迁移：Desktop 桥为空且当前 origin 的 localStorage 已有 Aisling 数据时，
  把 `aisling.config.v1` / `aisling.consciousness.config.v1` /
  `aisling.conversations.v1` / `aisling.conversation.v1` 复制进桥，旧数据不丢。

## Development 与 Desktop runtime 区分

- `development`：`AISLING_STAGE_URL` 存在 → `loadURL(dev server)`。
- `desktop / packaged-ready`：无该变量且 `stage-web/dist` 存在 →
  `aisling://stage` 协议承载 built renderer。
- 回退：两者都不满足时回退 `http://localhost:5174`（供 smoke 与旧用法）。

## 明确延期

自动更新、installer 深度定制、代码签名、开机自启、system tray、多窗口、
crash reporter、telemetry、SQLite/ORM 迁移、Electron framework 重构、Live2D、
Autonomous silence 重构、Interaction Policy 重构、ASR 修复、新 Provider。

已知 built 路径限制：Alibaba TTS/ASR 与 transcription 依赖 Vite `/api/relay/*`，
built renderer 下这些 relay 尚未由 Electron main 提供（本轮不要求发布 installer，
未扩 scope）。Browser Speech、OpenAI-compatible Chat/Vision 不经 relay，不受影响。

## 自动验证

```powershell
pnpm typecheck
pnpm test
pnpm build
# 保持 pnpm dev 运行；在已解锁的交互 Windows 桌面运行：
pnpm --filter @aisling/stage-desktop test:smoke
# built 路径（先 pnpm build）：
pnpm --filter @aisling/stage-desktop test:smoke:prod
```
