# Memory Organization P1.4 适配记录

2026-11-05。改动以当前工作树为基线，保留既有未提交修改。正式运行链路仅有Formation解析器一处有界修正，另新增独立、尚未接入调度的NoteDraft适配工具和测试。

## 已定位问题

- **S06 · 程序校验。** Formation曾将正文、标签和不确定性中所有`E数字/R数字`一律视为内部标签，错误拒绝来源原文里的货架编号R8/R3。现在只有在已引用原文中实际出现的同形代码可被保真转述。`sources`和`related`仍分别只解析合法且已提供的E/R标签，正文代码从不被解析为来源或关系。未引用的另一条消息里的代码不构成许可。回归覆盖真实代码、合法引用、伪造/非法引用和正文标签注入。
- **S07/S17 · NoteDraft映射。** P1.3将首个tag当主体，又将自由主体描述直接交给严格的取代守卫。新适配器要求调用方先确认主体锚点、候选身份/版本和原文中的主体提及，模型仅可选临时锚点标签。更具体的描述单独保留，既有Note的身份和主体不能被它替换。未知锚点、非对应引文、其他对象或不同版本拒绝。
- **S24 · 提取与原子性。** 现有Reflection可包含多项事实。新接口可将明确提出的多个原子片段映射为多个Draft，各片段必须有自身的原文引文、原始引用及Origin。程序验证引用支持范围，不按句号、关键词数量或固定数量自动分割。语义原子性仍需提取阶段判断及评估。
- **S03/S04/S10 · LLM决策。** 同义复述/补证时UPDATE、撤回时SUPERSEDE是模型操作判断问题。适配器没有将这些动作自动改成NOOP或RETRACT。实验保留原建议、拒绝和实际提交，分别评价。
- **S11/S15 · 类型及范围。** 玩笑的文本限定和`kind`需分别检查，助手承诺只能作为发言证据。适配器保留Reflection类别、basis/uncertainty及计算得到的用户陈述、助手发言和自主发言元数据，不自动将类别重写为合格值。

## 独立工具

`apps/stage-web/src/runtime/note-draft.ts` 提供`DraftProposal`、`SubjectAnchor`、`NoteDraft`、`adaptReflectionDrafts`和`assertDraftTarget`。调用方负责确认锚点，模型不能自授`confirmed`、数据库ID、来源ID或版本。适配器使用旧`sourceRef`算法重新验证当前归一化消息、索引和SHA-256，确认每份引文是原文子串且引用属于该Reflection。

显式日期/区间必须出现在该片段选择的引文中，并通过真实日历和区间顺序检查。未知时间保持null。模型生成的瞬时时间戳拒绝。Origin从实际输入Reflection取得，Evidence从白名单映射；`relatedReflectionIds`不变成来源或确定语义关系。

主体确认能力由受信调用方提供。P1.4使用预先标注的合成主体及其原文提及，同一份标注同时给B/C。这个前置条件不代表生产自动实体识别已经解决。原子性、自由正文的语义支持和同一事实范围仍依赖语义判断，适配器没有把字符串匹配当作这些问题的通用解法。

## 运行影响和验证

原有Formation提示词、请求形状、后台队列和提交生命周期保持原值。解析器只扩大对已引用原文同形编号的保真能力。Reflection Recall仍有独立的E/R正文过滤，本轮按边界未修改，因此这类Reflection进入现有Reflection Recall仍可能被排除。该剩余限制单列，不能声称本轮已经修复生产Recall。

定点Formation/历史/Recall/适配器测试38项通过，新增测试包含1项编号回归和6项适配器场景。全量Core 109项、Web 383项通过，全仓类型检查和生产构建通过。构建保留既有大chunk提示。日志位于独立实验目录`D:\Project\demo\aisling-memory-bc-lab`，文件为`phase-a-tests.log`、`phase-a-regression.log`、`phase-a-typecheck.log`和`phase-a-build.log`。

生产调度、原始Recall、Reflection Recall、Note v1事务、Renderer权限及角色/TTS均未新增适配入口。B/C真实实验结果另见实验目录的`BC-RESULTS.md`。本轮不接入自动Note写入。
