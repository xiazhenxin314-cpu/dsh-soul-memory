# Memory Retain（任务收尾记忆沉淀）

每次任务/对话收尾时（给出最终答复之前），执行一次记忆沉淀。任务过程中不写，只留意候选信息，收尾统一筛选。

## 收尾四步
1. 查重：用 memory_recall 扫相关层（root / home / project），避免重复写入。
2. 筛选：按「值得记 / 不值得记」过滤，只留高价值、低耦合的信息。
3. 归类写入：按 type 四维归类，选对层级（见下）。
4. 验证：写入后用 memory_recall 确认已落盘。

## 值得记 / 不值得记
值得记：
- 用户明确表达的偏好、习惯、禁忌
- 任务的关键结论、最终决策、交付物位置
- 项目事实：技术栈、架构、约定、环境事实
- 用户对产出的反馈与改进要求
- 未来会话可能复用的事实性信息

不值得记（刻意不耦合）：
- 过程量、中间变量、临时状态
- 排查流水账、工具调用细节（除非能提炼出可复用结论）
- 一次性任务的琐碎内容

## logfile 按 type 归类（写入 logfile 必选其一）
- user：用户画像、偏好、习惯、身份信息
- feedback：对产出的反馈、评价、改进要求
- project：项目事实、架构、进度、约定、环境
- situation：用户所处情境、背景、世界状态
- reference：引用资料——项目工作引用的其他仓库/文件夹资料（位置、用途、版本、要点），跨仓库可复用的入口索引

## 层级选择
- ROOT（MEMORY.md）：账户级稳定事实、环境事实（DSH_HOME、基础设施）
- HOME logfile：跨项目个人记忆（user / feedback / situation）
- PROJECT logfile：当前项目内记忆（project / reference）
- 参考映射（不强制）：user/feedback 天然属 home；project/reference 天然属 project；situation 双向皆可

## 长度控制
- 每条记忆一行核心信息。
- 长内容：用 memory_creator 建 L2 logfile（scope=home 或 project），正文写入 logfile，本体只留一行指针：`长内容沉淀：<关键信息> → home/<name>`

## 纪律
- 规则类内容 → AGENTS.md；技能类内容 → SKILL.md；memory 只存情境判断与事实。
- 拿不准要不要记 → 倾向不记，或先问用户；涉及用户主观偏好的先确认再写。
- 写错了用 memory_correct 订正，不追加"更正"条目。
- 同一主题内容追加到同一 logfile，不散建新文件。
