# Settings 修缮验证 — 2026-11-13

本文按轮次保留实现与验证记录；当前最终规则见文末“第三轮视觉修缮”。

范围：v0.3.9 的全部 Settings 页面；不提交、不推送、不更改版本或真实用户配置。起始及结束分支为 `main`，HEAD 为 `d783306`。工作区原有任务栏图标与 Memory UI 修改继续保留。

## 根因及最终布局

- 原 `.field` 只有最小高度，说明文字参与 Grid 的第二行，导致整体随内容增高。开关行另用 4.5rem 最小高度，外边距也不同。
- Speech、Desktop Awareness 的 `.long-label` 覆盖使用跨行及顶端对齐，造成无说明文字的配置行也不一致。Embedding 的 Model 缺失 `type="text"`，未命中公共输入样式。
- 没有独立 Settings Row 组件；现有公共入口是 `main.css` 的 `.field` 和 `ModuleToggle`。继续使用这套入口，未新增布局框架。
- 初版按 68px 实现，随后依据用户最新要求统一为 **floor(68 × 3/5) = 40 CSS px**，由同一条公共规则控制。当前 Windows 150% 缩放下截图对应约 60 物理像素。
- 标签列 14rem，控件列 `minmax(0, 1fr)`，列间距 1.5rem；左内边距 1.25rem、右 1rem，普通行间距 4px。标签与控件垂直居中，长标签可以在固定行内换行。输入框保留 2.5rem 高度、原字体与焦点样式。
- Switch 与输入控件起点一致；动态提示位于 Switch 旁，绝对定位不增加行高。Select 的长选中值收敛在可用宽度内，保留完整菜单选项与标题。
- 删除普通配置行的常驻说明及端点示例。页面简介、动态错误、Saved 状态、Memory 审核列表及迁移/恢复内容保留；列表和迁移内容没有套用固定行高。

## 首次配置与运行状态

原 `ModuleToggle` 会直接禁用缺配置的开关；保存方法还会先改内存配置再持久化。失败可能留下与实际结果不符的状态。另外，每次保存会重建其他模块的 Provider。

现在 Speech、Vision、Web Search 的开关只在处理中暂时禁用。缺配置点击仍保持关闭，显示简短原因，并保留本次启用意图；首次配置或存在待完成启用时显示 **Save & Enable**。补齐后一次保存并装配 Provider。后续编辑已配置模块使用普通 Save，草稿不会影响当前 Provider；不相关模块的 Provider 对象继续复用。

校验与实际 Provider 构建共用 `provider-factory.ts` 中的检查，Speech 复用 Core 既有 `validateAlibabaTtsEndpoint`。候选配置先验证/构建，持久化成功后才发布到运行状态。配置缺失、持久化失败、Provider 构建失败分别反馈；失败保留旧配置与旧 Provider。

Desktop Awareness 保留宿主、Jev Key、Consciousness 的既有条件，通过 Stage 共享检查。开关读取 `autonomous.enabled`；Save & Enable 保存参数后调用原宿主启停流程，宿主拒绝启动则保持关闭。若启动后的启用状态持久化失败，会停止本次启动并报告保存失败。普通参数保存不会再次调用启停 IPC，关闭操作仍优先取消采集和在途判断。

Memory Formation 的缺 LLM 提示改为点击后出现；数据库未准备好、迁移冻结等业务保护保留。未修改 Memory Formation / Organization / Recall 的权限、检索、调度或数据语义，也没有新增此类业务的 Save & Enable 机制。

**状态边界：** Speech/Vision/Web Search 使用延迟请求型 Provider，本次“启用”表示配置已保存且本地 Provider 已装配，不表示远端鉴权或服务可达性已经验证。没有新增真实网络探测。Desktop Awareness 的宿主启停结果与后续 Jev 请求是否成功也分别处理。

## 修改文件与职责

以下路径相对于仓库根目录；Memory 部分承接本轮前已有的 UI 整理。

| 文件 | 职责 |
| --- | --- |
| `apps/stage-web/src/styles/main.css` | 公共 40px 行高、列宽、居中、间距、动态提示位置及 URL 输入样式。 |
| `apps/stage-web/src/components/settings/ModuleToggle.vue` | 受控开关，缺配置可点击，等待真实结果，动态反馈。 |
| `apps/stage-web/src/components/settings/SettingsSelect.vue` | 长选中值不撑宽控件。 |
| `apps/stage-web/src/components/settings/ConsciousnessForm.vue` | 删除静态提示，显示保存失败。 |
| `apps/stage-web/src/components/settings/SpeechForm.vue` | 首次 Save & Enable、共用校验、Advanced 普通行。 |
| `apps/stage-web/src/components/settings/VisionForm.vue` | 首次 Save & Enable、普通 Save 及反馈。 |
| `apps/stage-web/src/components/settings/WebSearchForm.vue` | 使用现有 SettingsSelect 和统一保存流程。 |
| `apps/stage-web/src/components/settings/DesktopAwarenessForm.vue` | 一次保存并启用、共享条件检查、区分保存/启动失败。 |
| `apps/stage-web/src/components/settings/EmbeddingForm.vue` | 普通输入样式、删除说明、保留保存错误；承接此前布局整理。 |
| `apps/stage-web/src/components/settings/LegacyMemoryControls.vue` | 删除常驻开关说明，保留动态状态。 |
| `apps/stage-web/src/pages/settings/general.vue` | 统一内容宽度，语言保存失败反馈。 |
| `apps/stage-web/src/pages/settings/speech.vue` | 接入实际启用状态、处理中和动态错误。 |
| `apps/stage-web/src/pages/settings/vision.vue` | 接入实际启用状态、处理中和动态错误。 |
| `apps/stage-web/src/pages/settings/web-search.vue` | 接入实际启用状态、处理中和动态错误。 |
| `apps/stage-web/src/pages/settings/desktop-awareness.vue` | 读取 Stage 实际启停结果，保留首次启用意图。 |
| `apps/stage-web/src/pages/settings/memory.vue` | 普通开关去静态提示，保留特殊审核/迁移区；承接此前排序与按钮修复。 |
| `apps/stage-web/src/runtime/provider-factory.ts` | 复用 Provider 配置有效性检查。 |
| `apps/stage-web/src/stores/settings.ts` | 原子保存、失败保留旧状态、启用意图与反馈、复用不相关 Provider。 |
| `apps/stage-web/src/stores/stage.ts` | 共用 Desktop 启动前置条件，启用状态保存失败时停止本次启动。 |
| `apps/stage-web/src/i18n.ts` | 新交互文案；语言持久化成功后再切换显示。 |
| `apps/stage-web/src/stores/settings-activation.test.ts` | 7 个配置/启用/失败/Provider 身份/重载回归。 |
| `apps/stage-web/src/stores/stage-autonomous.test.ts` | 新增 2 个宿主拒绝、保存失败回滚与参数不重启回归。 |
| `apps/stage-web/src/i18n.test.ts` | 新增语言保存失败保留当前语言回归。 |

此前的 `apps/stage-desktop/desktop-app.cjs`、`desktop-diagnostics.test.cjs`、`assets/desktop-mode.ico` 是已有任务栏图标工作，本轮未覆盖或纳入新的 Settings 实现。

## 验证结果

| 检查 | 结果及范围 |
| --- | --- |
| `pnpm typecheck` | Core、Stage Web、Desktop 类型检查全部通过。 |
| `pnpm --filter @aisling/stage-web exec vitest run --maxWorkers=1` | **44 个文件、420 个测试通过**；包含配置持久化、重载、首次启用、缺配置、保存失败、Provider 构建失败、常规启停及原 Memory 回归。 |
| `pnpm build` | 生产构建通过；仍有既有的单包大于 500KB 提示，没有为此扩大拆包范围。 |
| `node .tmp/run-settings-ui.mjs` | 实际 Electron/Chromium 渲染、模拟宿主：7 页 × 2 窗口宽度（1140/720 CSS px）× 3 状态，共 **42 组、186 次普通配置行测量**；全部 40px，标签/控件中心误差小于 1px，无控件横向溢出，长标签/控件高度小于行内可用高度。 |
| 视觉覆盖 | 浅色英文、深色中文、Advanced 折叠与展开；已查看生成截图，包含最小窗口 Desktop Advanced 与 Memory 特殊区域。 |
| Electron 交互 | Vision 缺 Provider/Key、Save & Enable、保存失败、草稿不改变运行、非法编辑保留旧配置、正常开关及重载；Speech 首次配置/系统语音开关；Desktop 缺 Key/LLM、保存失败、模拟启动失败、重试与开关；语言更改重载通过。动态提示没有改变开关行高度。 |
| `git diff --check` | 通过。 |

失败记录及处理：首次普通沙箱运行的 3 个本机 HTTP 测试遭 EACCES；允许本机测试服务后通过。一次并行全量运行中，既有 `memory-recall-time.test.ts` 的召回受 30ms 运行预算影响失败，单独 12/12 通过，最终串行全量通过；没有放宽时限或修改 Memory 实现。初始新增 Speech 测试误以为空 Endpoint 有默认回退，实际 Core 合约要求填写；已改为使用既有合法默认地址。视觉脚本最初有 HMR 模块缓存、草稿/已存配置断言和一次 compositor 抓图时序问题，改用独立 Vite、正确交互路径并等待帧提交后完成；这些不计为产品测试通过记录。

临时验证脚本、独立合成 Profile、截图及结果保存在已忽略的 `.tmp/`；主要结果为 `.tmp/settings-ui/results.json`。未读取真实密钥、改动实际 Profile 或运行真实 Memory 数据库。没有增加测试依赖。

## 限制与后续风险

- 未运行真实远程 Speech/Vision/Jev/DuckDuckGo 请求；远端凭据、音频播放、模型输出和网络故障仍以实际调用结果为准。UI 的宿主失败为模拟注入，不代替原生采集器实测。
- 本轮未重跑 Core 和 Desktop 全量测试、Windows Worker/HNSW 原生验证；没有修改对应实现，Desktop 类型检查与前端宿主交互回归已执行。
- 真实像素验证覆盖当前机器 150% 缩放及两种支持窗口宽度，未覆盖所有操作系统字体、系统超大字号或低于桌面最小宽度 720px 的布局。
- Desktop 关闭优先保障停止采集；如关闭后的持久化失败，当前实际关闭，旧磁盘启用偏好可能仍在，下次启动仍按旧偏好恢复。界面读取真实运行状态并报告失败，不伪称保存成功。
- Embedding 原有表单字段约束、Memory 数据库/迁移/旧 Profile 兼容保护保留。旧资料迁移不是本轮测试对象。

所有项目版本保持 0.3.9，无 Git Commit、Tag 或 Push。

## 第二轮视觉微调

根因：40px 外层行仍搭配至少 35px 的输入框，上下仅约 2.5px；4px 行间距使连续配置项过密。右侧控件填满剩余列，右内边距仅 1rem，进一步强化了“塞满”的观感。没有通过继续压缩或明显增高外层行来处理。

本轮正式文件仅修改 `apps/stage-web/src/styles/main.css` 和本报告，未修改组件脚本、配置持久化、开关或 Memory 业务。统一调整如下：

| 项目 | 最终规则 |
| --- | --- |
| 普通配置行、开关行 | 保持 40px。 |
| 普通行、Advanced 内部行间距、开关下间距 | 4px → 8px。 |
| 标签列、列间距、左内边距 | 保持 14rem、1.5rem、1.25rem，所有控件保持相同起始线。 |
| 行右内边距 | 1rem → 1.75rem；动态开关提示同步保留该距离。 |
| 控件宽度 | 共用 `max-width: min(100%, 18rem)`，Input、Select、现有 SettingsSelect、Slider 均遵守；窄窗口按剩余列收缩，短选择器保留自然宽度。 |
| 输入框/原生 Select 高度 | 最小 35px → 30px，纵向 padding 调整为 .2rem；字体、颜色、圆角、焦点效果保留。 |
| 分组标题下间距 | .5rem → .75rem。 |
| Save 与前一配置行间距 | form gap 8px + actions margin 1rem，当前字号下合计 22px。 |
| Advanced 标题及展开区 | details 上下各 .25rem，保留标题点击区域；展开内容上间距 .25rem → .5rem，内部 gap 与普通区一致。 |

验证：`pnpm --filter @aisling/stage-web typecheck`、`pnpm build`、`git diff --check` 通过。构建保留既有大包提示。重用本地隔离 Electron 检查，命令为 `node .tmp/run-settings-ui-refinement.mjs`，覆盖 7 页、1140/720 CSS px 两种宽度、浅色英文/深色中文及 Advanced 折叠/展开，共 42 组、186 次行测量；40px 行高、8px 堆叠间距、控件右余量至少 24px、上下余量至少 3px、垂直居中与无横向溢出均通过。已查看 Consciousness、Speech 展开、窄窗口 Speech 和深色 Memory 截图。

同一 Electron 检查重跑了首次配置、缺项反馈、Save & Enable、保存失败、模拟启动失败、重试、正常启停、草稿不扰动运行及配置/语言重载，全部通过。结果及截图位于忽略目录 `.tmp/settings-ui-refinement/`，使用独立 Profile 和合成配置，无真实 Provider 请求。

本轮未重复执行上一轮 420 项单元测试、Core/Desktop 原生测试，也未覆盖其他系统字体及超大字号。较长 Endpoint 在变窄输入框中会显示部分内容，但完整值及光标横向编辑保留。版本仍为 0.3.9，无提交或推送。

## 第三轮视觉修缮

本轮仅修改视觉样式，不修改开关处理函数、首次配置、禁用条件、Provider、Memory 或持久化。

文件：`apps/stage-web/src/styles/main.css` 统一右对齐、42px 行高及 Switch 外观；`apps/stage-web/src/components/settings/SettingsSelect.vue` 将菜单弹出层锚定到右端；`apps/stage-web/src/components/settings/DesktopAwarenessForm.vue` 删除 Advanced 复选框的局部左对齐覆盖；本报告记录验证。

最终布局：普通行和开关行均为 **42 CSS px**；公共控件 `justify-self: end`，宽度上限仍为 `min(100%, 18rem)`，输入文本保持左对齐。行内右 padding 为 **18px**，所有控件的外盒右端一致；当前 Windows 缩放下含边框实测约 18.67px。原生 Select、Slider、SettingsSelect 及 Desktop Advanced 复选框都随公共规则靠右。动态提示放在开关左侧，与开关保持 .75rem 空隙。行间距仍为 8px，标题、Advanced 和 Save 间距不变；特殊审核列表不固定高度。

Switch 保持 2.75rem × 1.5rem，圆形滑块 1rem，轨道 `border: 0`，保留键盘焦点轮廓、禁用反馈和过渡。没有新增颜色令牌：关闭轨道混合 `--fg` 35% 与 `--bg`；开启轨道混合 `--link` 85% 与 `--bg`；滑块直接复用 `--fg`。因此 Light 是中性暖灰/棕色轨道配深色滑块，Dark 是中性灰/暖金轨道配米色滑块，两种主题均没有纯白滑块。

| 主题/状态 | 实际轨道 RGB | 滑块 RGB | 滑块与轨道对比度 | 轨道与配置行对比度 |
| --- | --- | --- | --- | --- |
| Light 关闭 | 168,163,156 | 26,26,46 | 6.81:1 | 1.97:1 |
| Light 开启 | 156,112,69 | 26,26,46 | 3.91:1 | 3.44:1 |
| Dark 关闭 | 93,90,92 | 237,229,214 | 5.44:1 | 2.58:1 |
| Dark 开启 | 142,122,98 | 237,229,214 | 3.28:1 | 4.29:1 |

验证命令及结果：

- `pnpm --filter @aisling/stage-web typecheck`：通过。
- `pnpm --filter @aisling/stage-web exec vitest run --maxWorkers=1`：44 个文件、420 项通过。
- `pnpm build`：通过，保留既有大包警告。
- `node .tmp/run-settings-ui-round3.mjs`：隔离 Electron 渲染 7 页、1140/720 CSS px、浅色英文/深色中文及 Advanced 收展，42 组、186 次行测量全部通过；高度 42px、右端余量一致、垂直居中、无外盒横向溢出、间距仍为 8px。明暗主题分别测量 Switch 开/关背景、滑块颜色、零描边和对比度。已查看 Memory 明暗主题、Consciousness 和窄窗口 Vision 截图。
- 同一脚本在 720px 窄窗口重跑保存/启停交互，缺配置、保存失败、启动失败及重试、正常启停和重载通过；Vision 动态错误的矩形不覆盖标签或开关，保持在 42px 行内。
- `git diff --check`：通过。

验证结果和截图位于忽略目录 `.tmp/settings-ui-round3/`；只使用隔离 Profile、模拟宿主和合成配置。未测试真实 Provider 请求、其他系统字体、超大字号及 Core/Desktop 原生全量；窄窗口过长选中值沿用原有省略和完整标题，长输入值仍可横向编辑。没有修改版本、提交或推送。
