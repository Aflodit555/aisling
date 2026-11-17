# Obsidian Memory Mirror 工程验证

> 公开脱敏候选：真实认识、记录标识、机器路径及私有校验值仅在私人归档保留。占位标识只用于本文说明，不可运行或跨页关联；本页仍记录原阶段的测试与限制，不代表本次重新验收。


日期：2026-11-16；版本仍为 v0.3.9；分支 `feat/obsidian-memory-mirror`。保留原有未提交改动，未提交、未推送 GitHub。

## 范围与实际数据

这是 LadybugDB → Obsidian 的单向观察器，不修改数据库 Note、Formation、Organization 或 Recall 算法，不增加 LLM、插件、依赖、进程或数据库实例。

当前生产库为 profile 下 `memory-note-v2/note-v2.lbdb`，采用 `note-v2-runtime` schema。`adapter.cjs` / `worker.cjs` 使用固定 LadybugDB 0.22.1 / Node 24.12.0 持有唯一 Database/Connection。

Note 主键为 UUID，当前 JSON 快照存于 `snapshot_v2_runtime`，修订存于 NoteRevision。仓库 Note 定义和 `note-formation-contract.mjs` 明确区分 content 与 subject：content 是语义正文；subject 是主体锚点或确认后的说话者标识；tags 是辅助字段。标题只取 content，绝不取 subject/tags。

导出全部实际 Note，包括孤立、active、superseded、retracted 状态。YAML Properties 保留完整 note_id、createdAt、当前修订 changedAt 映射的 updatedAt、version、status、kind、basis；时间保持 epoch 毫秒。其余元数据和完整来源信息以 JSON 代码块显示。当前没有持久化 Activation 字段，不伪造。

关系来自真实有向 NOTE_LINK，保留 key、类型、状态、端点版本及其他原始信息。类型包括 STATE_CHANGE、CONTINUES、SUPPLEMENTS、CONFLICTS、ASSOCIATED_WITH。只有端点存在的 active 关系生成出向 WikiLinks；stale/retracted 仅保留历史文字，不形成旧连线。按 key 去重，不从 successorId、subject 或正文推断新关系。Source/Evidence 不创建节点。原文及自由文本元数据放在代码围栏内，避免其中的 WikiLinks 产生虚假连接。

## 短名称与迁移

文件名为 `简短原文摘要-短标识.md`：

1. 去除开头的机械性“用户报告/问询/询问/陈述/表示”等前缀及可选冒号；只删除前缀，不重写原文。
2. 过滤文件系统和 WikiLink 保留字符、控制字符，折叠空白。
3. 保留前 16 个 Unicode 字符并去除尾部标点；空摘要回退为 Note。
4. 首选 ID SHA-256 的前 10 位。若短标识或完整文件名被占用，则对 `ID:尝试次数` 做 SHA-256，取 12 位并重试。用户自建同名文件不被覆盖，排序分配保证同批结果确定。
5. 完整 Note ID 始终保留在 YAML；新格式管理标记为 `aisling_mirror: "v2"`。后续按磁盘中的 Note ID 找回路径，正文变化或应用重启不重新命名。

识别旧 v1 文件时同时验证管理标记、完整 Note ID 和旧完整哈希后缀。迁移先写齐所有新路径及其真实链接，再清理同 ID 的旧管理副本。中途失败不会先删除旧文件；下次同步根据 ID 合并已完成的新副本，继续迁移。不会删除未标记的用户自建文件，也不会操作 Vault 其他目录或 `.obsidian`。

迁移只更新受管理笔记的链接；用户自行写在其他文件中的旧文件名链接不自动改写。迁移中断期间可能短暂同时存在新旧副本，成功对齐后清理旧副本。

## 设置页与日常使用

Memory 页面新增一行：`Obsidian 镜像 | 可编辑 Vault 路径 | 跳转图标 | 同步开关`。同步开关放在最右侧，与上下 Memory / Formation / Recall 开关右边缘对齐。

- 固定 42px，路径输入使用剩余宽度；失焦时长路径省略，聚焦时可滚动编辑完整内容。修改后失焦或按 Enter 保存，不提供文件夹选择按钮。
- 复用 ModuleToggle 的主题开关和 Icon 图标系统。图标按钮默认透明、无外框；hover 使用主题变量底色和圆角。没有附加设置面板或说明行。
- 支持中英文、Light/Dark。错误以内联输入边框、原生 title 及读屏状态反馈，不新增弹窗。路径无效仍保存用户输入/启用意图，但实际 running=false，不进行同步写入。
- 默认路径 `<OBSIDIAN_VAULT>`，首次默认关闭。保存到现有 `aisling.config.v1` 的 `memory.obsidianMirror: {enabled, vault}`，使用既有 Desktop 文件存储，不另建配置文件。

首次使用：

1. 安装并运行一次 Obsidian，将 `<OBSIDIAN_VAULT>` 作为 Vault 打开。
2. 正常启动 Aisling，进入 Memory，核对或填写路径，开启镜像开关。
3. 在 Obsidian 的内置 Graph View 过滤 `path:"Aisling Memory"`，保留孤立节点显示，必要时打开方向箭头。

此后正常启动 Aisling 即恢复已保存的路径和开关，不再需要环境变量。旧 AISLING_OBSIDIAN_MIRROR / AISLING_OBSIDIAN_VAULT 环境变量入口已移除，避免旧环境覆盖用户保存的关闭状态。

## 动态运行与安全边界

设置保存成功后，经受信任的 preload/IPC 调用 Main；Main 从现有存储读取配置，不接受 Renderer 传来的任意 URL。服务复用原 Note Store 的 configureMirror / mirrorStatus Worker 请求。

- 开启：校验绝对路径、目录存在性和链接安全性后立即开始对齐；之后每轮完成后等待约 5 秒。
- 关闭：取消计时器，等待已开始的当前原子写入/对齐结束；确认返回后不再同步，保留已导出文件。
- 改路径：先停止并等待旧目标，再校验/启动新目标；不会清理旧 Vault 文件。即使新路径无效，旧目标也不会继续后台同步。
- 重启：Main 恢复保存配置。Worker 异常退出后，后续原有数据库访问重建 Worker 时重新应用配置；不额外设置重启进程或守护器。
- 镜像独立于 Memory/Formation/Recall 的行为开关，不更改这些开关。原服务启动即执行恢复流程并持有 Worker；镜像可观察已有数据，即使 Formation/Recall 均关闭。旧 schema 的 profile 不显示此设置行。
- 数据库读取与请求共享原串行队列，避免插入写事务；文件操作在读取后异步执行。未变化文件不写入。临时文件与目标文件同目录，rename 替换；正常异常路径清理临时文件。仅删除数据库已不存在、且属于镜像管理范围的 Note 文件。
- 校验/导出错误与配置错误隔离于 Memory 操作。状态接口将问题反馈设置行；定时文件错误下一轮重试，配置路径无效则等待用户修正。关闭 Worker 时停止镜像。

跳转按钮在 Main 校验本地路径，再只读查询 `%APPDATA%/obsidian/obsidian.json` 中路径精确匹配的 Vault ID，以固定 `obsidian://open?vault=<ID>` 调用 Electron shell.openExternal。这样不会混淆同名 Vault，也不能执行任意 Renderer URL。未登记 Vault 或打开失败时反馈简短错误。URI 的 Vault ID 格式依据 [Obsidian 官方 URI 文档](https://obsidian.md/help/uri)。OS 接受 URI 不代表 Obsidian 已完成显示，操作系统没有提供该完成回执。

## 本轮验证

| 项目 | 结果 |
| --- | --- |
| 真实只读检查 | 14 Note、11 active 关系、6 孤立节点；真实数据库前后 SHA-256 一致 |
| 真实旧镜像迁移 | written=14、removed=14；最终 14 个新 Markdown、11 条 WikiLinks 均可解析；正文及状态未变；最长文件名 30 字符（含 .md） |
| 重复真实同步 | written=0、removed=0 |
| Desktop 定向回归 | 数据库、生命周期、诊断、迁移、镜像等 28/28 通过，0 跳过；新增服务恢复专项另行通过，最终镜像/控制专项共 7 项 |
| 迁移异常 | 注入中途 rename 失败，重试收敛；用户同名文件保留；12 位冲突回退、空标题、非法字符、Unicode、内容更新后路径稳定通过 |
| 动态控制 | 同一 Worker PID 下关闭后不再导出新增 Note；开启立即对齐；路径切换生成新目标而保留旧目标；无效路径后仍可正常读取数据库 |
| 持久化 | Settings Store 保存/重载、保存失败不发布新配置、关闭状态恢复通过；原生服务重建后恢复配置通过；Formation/Recall 保持关闭 |
| 打开能力 | 注册 Vault 精确 ID、拒绝 URL 输入、未登记 Vault 和 openExternal 失败的隔离测试通过 |
| UI 实际渲染 | 隐藏 Electron 离屏窗口检查 1100px/英文/Dark、720px/中文/Light：行高均为 42px，无控件重叠或行内溢出；hover 背景变化、路径编辑、开关保存和页面重载恢复通过；截图已人工查看 |
| 前端针对性测试 | 设置、i18n、Recall 共 18/18 通过 |
| 全量测试 | core 112/112、stage-web 421/421 通过；HTTP 夹具需要允许访问本机 127.0.0.1，不调用真实 LLM |
| 类型与构建 | pnpm typecheck、pnpm build 通过；保留现有大 chunk 构建提示 |

上一轮的 Recall 测试本轮针对性运行和全量运行均通过，未修改 Recall 实现或该测试，不将一次旧失败判定为已定位的算法缺陷。

UI 验证使用隔离 profile 和模拟 Bridge；真实 Worker/服务控制另外通过原生集成测试验证。后续跳转复核中，真实 Electron shell 向已登记的 Aisling Vault 发送 URI，系统接受请求；真实 Main/preload IPC 隔离测试也通过，用户重启 Aisling 后确认跳转正常。

按反馈交换跳转图标与同步开关，开关最右侧与上下行对齐。再次离屏复核：英文/Dark/1100px 下两者右边缘均为 772px；中文/Light/720px 下均为 670px，行高仍为 42px，无重叠或溢出；hover、编辑保存、页面重载恢复、前端类型检查和构建通过。此次仅调整前端顺序，不修改跳转逻辑。

未做长周期或大规模性能测试。Screenshot 位于被 Git 忽略的 `artifacts/obsidian-ui/`，真实数据快照只保存在被忽略的 artifacts 中，不作为交付代码。

可复现主要检查：

```powershell
$env:AISLING_MEMORY_DB_P0_TEST_RESOURCES = (Resolve-Path .local/memory-database).Path
node --test --test-concurrency=1 apps/stage-desktop/obsidian-control.test.cjs apps/stage-desktop/obsidian-mirror.test.cjs apps/stage-desktop/memory-database.test.cjs apps/stage-desktop/note-v2-lifecycle.test.cjs apps/stage-desktop/desktop-diagnostics.test.cjs
pnpm test
pnpm typecheck
pnpm build
```

开发 Worker 资源需与源码一致。本机已在原有资源启动锁下、确认无 Worker 运行后刷新 CJS 资源并完成原生测试；生产源码资源清单已包含镜像模块。

## 本轮文件清单

新增：

- `apps/stage-desktop/obsidian-control.cjs`、`obsidian-control.test.cjs`：配置映射、安全跳转和控制/迁移测试。
- `apps/stage-web/src/components/settings/ObsidianMirror.vue`：单行设置。
- `apps/stage-web/src/stores/settings-obsidian.test.ts`：保存和恢复测试。

修改：

- `apps/stage-desktop/memory-database/obsidian-mirror.cjs`：短命名、旧文件迁移、路径校验、同步状态。
- `apps/stage-desktop/obsidian-mirror.test.cjs`：动态启停与换路径原生测试。
- `apps/stage-desktop/memory-database/{worker.cjs,protocol.cjs,client.cjs,store.cjs,store.d.ts}`：动态命令、状态、移除旧环境启动入口。
- `apps/stage-desktop/{note-formation.cjs,desktop-app.cjs,preload.cjs}`：复用原服务、持久化启动恢复和受信任 IPC。
- `packages/core/src/config.ts`：可选配置字段。
- `apps/stage-web/src/{config/local-storage-config-store.ts,stores/settings.ts,env.d.ts}`：配置保留、持久化和 Bridge 类型。
- `apps/stage-web/src/{components/Icon.vue,pages/settings/memory.vue,i18n.ts}`：图标、页面接入、本地化。
- `docs/obsidian-memory-mirror.md`：本报告。

仍采用全量快照查询和逐文件文本比较，仅写变化文件，不引入额外索引或事件层。适合当前小型观察实验。强制终止时可能残留不被当成笔记的临时文件；请只让一个 Aisling profile 写同一镜像目录。已具备保存一次后日常启动即可观察图谱的条件；首次仍需登记 Vault、开启镜像，实际 Obsidian 打开与 Graph View 观感由用户确认。
