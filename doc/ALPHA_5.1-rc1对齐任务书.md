# ALPHA_5.1 · dsh-soul-memory 对齐 DSH 0.1.7-rc.1 任务书

> 冻结于 2026-09-24，总控书写。仓史最新任务书号 ALPHA_5，本轮 5.1。执行者只按本书行事。

## 一句话目标

验证本仓（soul 记忆：纯 .mjs 零构建宿主插件，`dsh-tools` defineTool 注册记忆工具）在 rc.1 上无需代码修改，smoke + lab 装载收口。

## 背景（总控已在官方 checkout `dsh-v0.1.7-rc.1` 双树取证）

- 本仓 src 为纯 `.mjs`（零 TS、零构建），唯一官方 import 是 `@deepseek-ai/dsh-tools` 的 `defineTool`——Facade 审计确认 `defineTool` 签名、导出清单、`ToolSchema` 基础字段在 rc.1 不变（新增全为可选加法）。
- 兼容门：peer `@deepseek-ai/dsh-tools: >=0.1.0-rc.6 <0.2.0` 范围含 rc.1 → 过（该 peer 用 includePrerelease 语义校验运行时，范围本身也真包含 rc.1）。
- cordis 未见直接依赖（纯 service 注册靠宿主），无需迁移。
- 预期免修；若 smoke/lab 暴露问题，另立任务书。

## 边界

R1 零代码改动；R2 验证只在隔离 lab 与仓内 smoke；R3 诚实口径。

## 验收矩阵

| # | 项 | 判据 | 结论 |
|---|---|---|---|
| S1 | smoke | `pnpm test`（node tests/smoke.mjs）exit 0 | |
| S2 | 兼容门 | peer 范围核验（含 rc.1） | |
| S3 | lab 装载 | bundles 追加 + `--dump-config` 行在位 + boot 全树 apply | |
| S4 | 记忆工具激励 | 真实会话调用记忆工具（需 LLM，lab 无） | |

## 验证记录（总控回填）

（待验证后回填）
