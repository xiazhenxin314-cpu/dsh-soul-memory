# ALPHA_5 开发记录 — @xiaoxia/dsh-soul-memory

- 日期：2026-09-19
- 性质声明：本文件是 **适配记录，非完成声明**——仅覆盖仓内静态核查与现有测试验证，实机行为断言（3181 挂载）由总控在恢复期执行，不在本记录范围。
- 基线 commit：`d0d0c9b9b8deb4d98d887ef0e0335ca606ebf047`（分支 main，工作树干净）

任务书：`~/dsh-custom-plugin/doc/ALPHA_5-开发任务书.md`（变化表 C1–C12）；官方只读源码 `/home/ubuntu/deepseek-harness` @ tag `dsh-v0.1.6-alpha.2`。

## 结论

**零改动，PASS**（仓内证据层）。C1–C12 对本仓全部「不适用/无命中」；插件唯一官方依赖面（`@deepseek-ai/dsh-tools` 的 `defineTool`、`inject=['systemPrompt','tools']`、`exec.agent.session.header.cwd`、bundle patch 层）在 0.1.5-rc.2 → 0.1.6-alpha.2 之间契约不变，且已用真实 0.1.6-alpha.2 构建产物实弹验证。无 pending。

## A0 基线指纹

| 项 | 值 |
|---|---|
| HEAD | `d0d0c9b9b8deb4d98d887ef0e0335ca606ebf047` |
| 分支 / 工作树 | main ／ `git status --porcelain` 空 |
| package.json version | 0.4.1（`@xiaoxia/dsh-soul-memory`） |
| scripts | 仅 `test: node tests/smoke.mjs`（无 typecheck/build——纯 ESM 零构建） |
| 形态 | bundle 插件：`package.json` 声明 `dsh.bundle.patch: ./cordis.patch.yml`（单条 `- insert: {id: soul-memory, name}` 行） |
| peerDependencies | `@deepseek-ai/cordis ^4.0.1`、`@deepseek-ai/dsh-tools >=0.1.0-rc.6 <0.2.0`（A0 时点原样，未动） |
| node_modules（gitignore，非仓状态） | 仅 `@deepseek-ai/dsh-tools`，实为 **0.1.6-alpha.2 真实构建产物**（main: lib/index.js），A3 实测直接复用 |

A0 之后未动任何代码；本仓无 A2 commit，仅有 A4 纯 doc commit。

## A1 核查表（C1–C12 逐项）

证据口径：仓内 grep（`--include=*.mjs/*.yml/*.json`，排除 node_modules/.git）+ 官方源码 file:line（`git show dsh-v0.1.6-alpha.2:<path>`，只读）+ 实测命令。本仓官方 API 消费面全景（先决事实）：import 面仅 `soul-memory.mjs:36` `import { defineTool } from '@deepseek-ai/dsh-tools'`；inject 面 `soul-memory.mjs:60` `['systemPrompt', 'tools']`；其余全部为 node 内建与仓内相对导入（`grep -rn "@deepseek-ai" --include=*.mjs .` 仅此一处命中）。

| C | 变化 | 判定 | 双证 |
|---|---|---|---|
| C1 | `codeRuntime`→`ptcRuntime` 更名 | **无命中** | ① 仓内 grep `codeRuntime\|ptcRuntime` → 零输出（rc=1）；② 官方更名落点在 dsh-tools 内部（alpha.2 `packages/core/tools/src/index.ts:1025-1026` `requirePtcRuntime` 读 `ctx.get('ptcRuntime')`），本仓不引用该服务 |
| C2 | typert strict codec `{schema}`→`{create:()=>…}` | **无命中** | ① 仓内 grep `typert\|codec` → 零输出（rc=1），无 registry 贡献面；② 官方强校验在 `packages/typert/registry/src/service.ts:617`（schema 缺 `create()` 工厂即抛）与 `:724`（strict codec 缺 `create()` 即抛）——本仓两条面均不存在。注：五件套工具的 `output: { schema: { type: 'string' }, render }` 是 dsh-tools 自有 JSON-schema output 字段，非 typert codec；承载它的 `packages/core/tools/src/schema.ts`（defineTool 定义处）两 tag 间 **零 diff** |
| C3 | `settings.plugin.item` slot 废弃 | **不适用** | ① 仓内 grep `settings` → 零输出（rc=1）；② 本仓无任何设置分区注册，配置读取走自有文件 `$DSH_HOME/mem.config`（`soul-memory.mjs:97-104`，正则直读），不经 settings service |
| C4 | `dsh.profile.patchReload`/`configTrees`/`sessionFormatMigration` 声明面删除 | **无命中** | ① 仓内 grep 三关键词 → 零输出（rc=1）；② `package.json` 的 `dsh` 字段仅 `bundle.patch` 一项，无死配置声明 |
| C5 | tool-subagent `maxDepth` 默认改读 Host 设置 | **不适用** | ① 仓内 grep `maxDepth\|subagent` → 零输出（rc=1）；② 本仓不派遣 subagent、无嵌套调用链 |
| C6 | `slots/changed` 不再覆盖 Factory 定义 | **不适用** | ① 仓内 grep `slots/changed\|subscribeFactory\|Factory` → 零输出（rc=1）；② 官方该变化作用于 slot 订阅面，本仓无 slot |
| C7 | client boot / `ClientBundleRegistration.chunk` / `rev` 推导变化 | **不适用** | ① 仓内 grep `__DSH_BOOT__\|ModuleLoader\|ClientBundleRegistration\|require.async` → 零输出（rc=1）；② 本仓为 host 侧 bundle 插件，非 client 仓，不依赖 rev 缓存。bundle patch 消费面本身未变：alpha.2 `packages/boot/plugin-manager/src/index.ts:378` 仍按 `manifest.dsh.bundle.patch` `loadOverlayPatches`，`packages/boot/app-boot/src/profile.ts:163` 同义 |
| C8 | Slot 旧 API 全保留 | **不适用** | ① 仓内 grep `registerSlot\|sidebar\|workspace` → 零输出（rc=1）；② 无 slot 使用即无受影响面 |
| C9 | persistence `locate/inspect/list` / projectionCache 接口零 diff | **不适用（本仓无该消费面）** | ① 仓内 grep `session-persistence\|projectionCache\|projection\|ctx.sessions\|jsonl` 的命中全部是本仓自有函数 `locateEntries`（`lib/logfile.mjs:218`，logfile 条目定位，与官方接口无关）；本仓不读 session 持久化、不派生会话事件 → **`registerMessageProjection` 不适用**（只读不派生）。本仓唯一会话面读取是 `exec?.agent?.session?.header?.cwd`（`soul-memory.mjs:81-87,159,188`）：官方 `SessionHeader.cwd` 在 alpha.2 原样保留（`packages/core/session/src/types.ts:104` `readonly cwd?: string`，types.ts 两 tag diff 仅扩展 `tool/result` error 可选 `reason`）；② 官方零 diff 复核：`packages/session/session-projection-cache/src` 零 diff；`packages/session/session-persistence-jsonl/src` 仅 `generation.ts` 增 2 行内部校验参数（`locate/inspect/list` 公共接口未动） |
| C10 | 版本闸门纯声明不强制 | **不适用** | ① 仓内 grep `engines\|manifestVersion` → 零输出（rc=1），package.json 无闸门声明；② 观察（非问题、不改动）：peerDependencies `>=0.1.0-rc.6 <0.2.0` 对 `0.1.6-alpha.2` 存在 semver prerelease 元组排除的字面张力，但该张力自 0.1.5-rc.1 实测起即存在（非 ALPHA_5 引入），且 peer 声明不构成强制闸门（同 C10 口径），按 R3 不动 |
| C11 | HMR 单开关 / `dsh plugin add` 构建审批（allowBuilds） | **不适用（运行期）** | ① 仓内 grep `hmr\|allowBuilds` → 零输出；本仓纯 ESM 零构建，无 pnpm build script；② 官方该面在新增 `packages/boot/plugin-manager`（两 tag 间 +3208 行，多为测试），属挂载期行为，归总控 |
| C12 | loader 非事务化 / profile runtime 模式 | **不适用（运行期）** | ① 本仓 patch 层为单条 `- insert` 行（`cordis.patch.yml:4-6`），无 fallback links / 物化面；② 失败半树不回滚属进程行为，无仓内代码对应物，归总控挂载期观察 |

### inject/服务契约精读（A1 补充，非 C 项但为本仓命脉面）

| 契约 | 官方证据（alpha.2） | 判定 |
|---|---|---|
| `defineTool`（参数/output schema 即时校验） | `packages/core/tools/src/schema.ts` 两 tag 间零 diff；`packages/core/tools/src/index.ts:60` 原样 re-export；`presentation.ts`（presentCall 契约）零 diff | 不变 |
| `ctx.systemPrompt.section({name,order,text})` | `packages/core/system-prompt/src/index.ts:423` `super(ctx, 'systemPrompt')`；diff 仅新增可选 `interpolate` 字段（`:68`，缺省 true 语义同旧）与新增 SECTION_ORDERS 项（TOOL_COMPUTER_USE/MCP_SERVERS）；本仓两段未设 `interpolate`，渲染路径与 rc.2 一致 | 不变 |
| `ctx.tools`（ToolRuntime.register） | `packages/core/tools/src/index.ts:829` `super(ctx, 'tools')`；diff 为增量字段（`PreToolDecision` 增 `cancel`、`ToolErrorInfo` 增 `reason`），均为可选扩展 | 不变 |
| `ctx.provide('soulMemory')`（cordis 公开服务） | `vendor/cordis` 两 tag diff 仅 `fiber.update` 返回值、`internal/update` 事件签名、`logger.exporter` id 修正三处；本仓三者皆未使用，`provide`/inject 核心未动 | 不变 |
| `exec.agent.session.header.cwd` | `packages/core/session/src/types.ts:104` | 不变 |

## A2 适配（零改动结论）

**零改动。** 依据：C1–C12 全部「不适用/无命中」（§A1，逐项双证）；唯一官方依赖面契约不变（§A1 精读表）；无一行 diff 需要引用 C 编号。不新增功能、不重构、不动依赖版本（R1/R3 满足，lockfile 无）。

## A3 验证

| # | 命令 | 退出码 | 要点 |
|---|---|---|---|
| 1 | `node tests/smoke.mjs`（= `npm test`；无 typecheck/build script，登记 N/A） | **0** | 59 断言全绿（纯函数层 + soulMemory 服务面契约段） |
| 2 | 实弹演习（一次性内联命令，未改仓内文件）：`import { defineTool } from '@deepseek-ai/dsh-tools'`（解析到 node_modules 真实 **0.1.6-alpha.2** 构建产物）+ `apply(mockCtx)` | **0** | `provide: soulMemory`；`sections: deployment:soul, deployment:memory`；`tools: memory_recall, memory_write_root, memory_write_logfile, memory_correct, memory_creator`——五件套定义全部通过新版 `defineTool` 的定义期 schema 校验 |
| 3 | `node -e "import('@deepseek-ai/dsh-tools')…typeof defineTool"` | 0 | 新包可加载，`defineTool: function` |

说明：node_modules 内的 `@deepseek-ai/dsh-tools@0.1.6-alpha.2` 为既有产物（gitignore，非仓状态，本次未安装未升级）；smoke 主验证不依赖它存在，实弹演习直接受益于它是新版。

## 风险与移交（总控）

1. **实机注入/工具行为未断言**（NOT VERIFIED，任务书既定未取证项）：tsc 级与定义期校验均绿，但 system prompt assemble、工具执行链的运行真相以总控在 3181 恢复挂载后的实机断言为准。
2. C11/C12 运行期项（HMR、loader 非事务化、`dsh plugin add` 构建审批）不属仓内代码，挂载期由总控按批次记录处理。
3. peerDependencies 字面张力（§A1 C10 观察）：若未来 pnpm 严格模式告警，再立 pending，本次不动。
