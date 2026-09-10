# Changelog

包版本遵循 SemVer;与「记忆架构版本轴」(v1 → v2.1)相互独立,README 会同时标注两轴。

## [0.4.1] - 2026-09-10

适配上游 DSH `0.1.5-rc.1`(破坏性版本跳变:0.1.2-alpha.5 → 0.1.5-rc.1)。**无代码改动**,只需刷新声明与文档:

### Changed

- `peerDependencies` 由 `*` 收紧为 `@deepseek-ai/cordis ^4.0.1` + `@deepseek-ai/dsh-tools >=0.1.0-rc.6 <0.2.0`;
- 文档澄清注入次序:官方 persona 段由 `deployment:persona`(order 0)拆为 `deployment:persona-prefix`(0) + `deployment:persona-suffix`(10200),`HARNESS_SOURCE`/`WEB_SURFACE` 由 -900/-800 挪至 10000/10100;本插件 `deployment:soul`(-10)/`deployment:memory`(10) 两段相对语义不变(不依赖 persona 段名,故无需改码)。

### Verified

- 隔离 home(独立 `DSH_HOME` + 独立 profile,0.1.5-rc.1)实挂:`apply` 正常、`soulMemory` 服务注册、starter 文件物化、`/top-tab/modules` 报 `memory enabled=true`;
- `npm test` 59 断言全绿;`ctx.systemPrompt.section` / `defineTool` / `ctx.tools.register` 契约两代一致(官方 0.1.5-rc.1 源码 + 活体 Inspect 双向核对)。

## [0.4.0] - 2026-09-04

全量代码审查后的修复批次(11 项),smoke 断言 54 → 59。

### Fixed

- 注入预算按层分别计数,截断提示结构化:home/project 各自如实提示,不再靠子串反查;
- `section` 键守门:禁换行(防注入伪造 `## ` 边界)、禁 `#` 前缀、≤64 字符;
- project 层定位 fail-loud:header cwd 缺失即抛错,不再回退 `process.cwd()` 把记忆写错仓;
- project root 判定统一为 `gitRootInfo`:`.git` 目录与 worktree 的 `.git` 文件皆认,工具面与服务面同源;
- `readLogfile` 128KiB 截断回退到完整 UTF-8 码点边界,不再产生 U+FFFD;
- 服务面 `dirOf` 未知 scope 显式抛错;`readLayers` 的 `root.exists` 改按文件存在判定;
- v1 迁移产物 frontmatter 后补恰一空行,对齐 creator 布局规范;
- 删除零引用死代码 `findLogfile`;
- 版本/断言数单点对齐(README 与 插件说明 写入「改动必同步」检查单)。

## [0.3.0] - 2026-08-29

### Added

- 对外公开 cordis 服务 `soulMemory`(插件间协作走公开服务,不 value-import 他人实现):
  `readLayers(cwd?)` 三层概貌 / `readLogfile(scope, name, cwd?)` 单文件结构化全文 / `edit(payload, cwd?)` 编辑;
  语义与工具 pure 函数严格一致(禁令/上限/.bak/错误文案)。

### Fixed

- 嵌套结构分行:层分隔横线前后补空行,写路径保留小节/条目间空行,存量 MEMORY.md 两处补空行。

## [0.2.0] - 2026-08-29

### Added(记忆架构 v2 → v2.1)

- 三层记忆:**L1** `$DSH_HOME/MEMORY.md` + **L2/L3** `.memory/<名>.md`(home=跨项目 / project=项目根),注入统一走 `<memory>` 包裹,预算 L1>L2>L3(200 行或 16384 字符,L1 永不截断);
- v2.1 写入规范:工具定型为五件套 `memory_recall / memory_write_root / memory_write_logfile / memory_correct / memory_creator`,logfile 五类 type(含 `reference`),命名放开(中文名可用,≤64 字符 NFC);
- 任务收尾记忆沉淀提示词模板(现收于 [templates/memory-retain-prompt.md](templates/memory-retain-prompt.md))。

### Changed

- memory schema 英文化+解耦(type 最简指引,参数自包含);
- `lib/` 明确为 ESM 源码入库(非构建产物)。

## [0.1.1] - 2026-08-24

### Added

- 首个版本:项目级记忆(单文件 `.memory`)+ `memory_view` / `memory_creator` + 目录段冻结注入(v1 形态;v2 起自带幂等迁移+回滚)。
