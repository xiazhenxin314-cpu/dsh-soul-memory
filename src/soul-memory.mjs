/**
 * dsh-soul-memory — SOUL/MEMORY 跨会话记忆插件(v2:三层记忆架构)
 *
 * 三层结构(2026-08-26 重构):
 *  - L1 root : $DSH_HOME/MEMORY.md           → sys prompt 完整展开(冻结注入);
 *  - L2 home : $DSH_HOME/.memory/<name>.md   → catalog 展示 name+type+description;
 *  - L3 proj : <projectRoot>/.agents/.memory/<name>.md → catalog 展示(项目根=最近含 .git 祖先)。
 *
 * 工具面五件套:memory_recall(唯一读)/ memory_write_root(ROOT 小节追加)/
 * memory_write_logfile(条目追加)/ memory_correct(订正/删除)/
 * memory_creator(建 logfile)。v1 的 memory_view / memory_compact 已下线。
 *
 * 注入预算(L1>L2>L3):system prompt 冻结记忆内容总量 ≤ 200 行 或 16384 字符,
 * L1 全额永不截断,超限从最低层(尾部=最旧)截断 + 一行指向提示(见 budget.mjs)。
 *
 * 拍板记录(2026-08-26):
 *  - 旧 .memory(单文件/目录)→ 自动搬迁至 .agents/.memory(migrate.mjs,惰性触发+回滚);
 *  - catalog 载体 = systemPrompt 冻结段;web 小模块 = 独立待做插件(暂缓);
 *  - logfile append 自动加时间戳小节;logfile 无 delete(删除仅人工);
 *  - logfile 文件本体不设独立写入上限(注入预算 + 用户自律兜底)。
 *
 * 模块布局(2026-09-13 ALPHA_0.5 taste 整理;公开导出面与挂载入口不变):
 *  - src/messages.mjs      中文报错语料(纯文本,零依赖);
 *  - src/root-memory.mjs   L1 MEMORY.md 小节寻址与写操作;
 *  - src/logfile-write.mjs L2/L3 logfile 追加/订正/建壳;
 *  - src/memory-view.mjs   迁移 memo + 三层发现 + 冻结渲染 + recall 路由;
 *  - src/logfile.mjs（本轮迁入 readTextSafe）/ budget.mjs / migrate.mjs 原样; soul-service.mjs 仅 fail 内联（审查 P1 订正）;
 *  - 本文件只留插件主体:name/inject、cwdForProject、apply()(初始文件/服务面/
 *    每 agent 快照/system prompt 段/五件套工具),并把各纯函数 re-export,
 *    公开导出面与整理前逐一对应(tests/smoke.mjs 的深导入不受影响)。
 *
 * 布局修订(2026-09-19,用户拍板推翻 ALPHA_0.5 F10「lib/=源码不移动」):
 * 源码 lib/ 整体迁至 src/(入口 soul-memory.mjs 一并迁入,main=src/soul-memory.mjs),
 * 对齐工作区口径「lib/=生成物、src/=源码」;公开导出面与挂载面零变化。
 * 同日拍板:L3 项目层载体 .memory → .agents/.memory(项目根不再落 .memory),
 * 旧 .memory 由发现层惰性自动搬迁(migrate.mjs)。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  findProjectRootSync,
  illegalLogfileNameMessage,
  isLogfileName,
  normalizeLogfileName,
  readTextSafe,
  writeTextAtomic,
} from './logfile.mjs'
import { MSG } from './messages.mjs'
import {
  DEFAULT_MAX_CHARS,
  appendRootMemory,
  assertSectionKey,
  correctRootMemory,
  listSectionKeys,
  sectionBody,
} from './root-memory.mjs'
import { appendLogfile, correctLogfile, createLogfile } from './logfile-write.mjs'
import { discoverMemoryLayers, recallMemory, renderMemoryBlock } from './memory-view.mjs'
import { createSoulMemoryService } from './soul-service.mjs'

export const name = '@xiaoxia/dsh-soul-memory'

export const inject = ['systemPrompt', 'tools']

// 公开导出面(与 2026-09-13 ALPHA_0.5 整理前逐一对应,顺序即原文件定义序)
export {
  assertSectionKey,
  sectionBody,
  listSectionKeys,
  discoverMemoryLayers,
  renderMemoryBlock,
  recallMemory,
  appendRootMemory,
  correctRootMemory,
  appendLogfile,
  correctLogfile,
  createLogfile,
}

// ---------- project 层定位:会话 cwd 缺失即 fail-loud(审查 A3 修复) ----------
// 写入错位比读取空结果更糟:project 层定位不可信时宁可报错,不回退 process.cwd()
// 把记忆写进服务进程目录的"伪项目根"。root/home 层与 cwd 无关,不受影响。

export function cwdForProject(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') {
    throw new Error('无法定位 project 层:会话缺少 cwd,不做回退猜测。可改用 scope=home(跨项目层),或由宿主显式传 cwd 后重试。')
  }
  return cwd
}

// ============================================================================
// 插件主体
// ============================================================================

export function apply(ctx) {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const memoryPath = join(dshHome, 'MEMORY.md')
  const soulPath = join(dshHome, 'SOUL.md')
  const configPath = join(dshHome, 'mem.config')

  // ---------- 读安全兜底复用 lib readTextSafe,写复用 writeTextAtomic(审查 B3 去重) ----------
  const readMaxChars = () => {
    const m = /^\s*maxChars\s*:\s*(\d+)\s*$/m.exec(readTextSafe(configPath))
    const n = m ? Number(m[1]) : DEFAULT_MAX_CHARS
    return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_CHARS
  }

  // ---------- 幂等创建初始文件 ----------
  try {
    if (!existsSync(configPath)) {
      writeTextAtomic(configPath, [
        "# DSH soul/memory 配置",
        "# MEMORY.md 的最大字符数;超限拒绝写入,压缩:对臃肿小节用 memory_correct 瘦写。",
        "memory:",
        "  maxChars: 16384",
        "",
      ].join("\n"))
    }
    if (!existsSync(soulPath)) {
      writeTextAtomic(soulPath, [
        "# SOUL",
        "",
        "(你的角色设定与人格。此文件只读注入 system prompt 最前,会话期间冻结;修改后新会话生效。)",
        "",
      ].join("\n"))
    }
    if (!existsSync(memoryPath)) {
      writeTextAtomic(memoryPath, [
        "# MEMORY",
        "",
        "(跨会话长期记忆。用 memory_recall 读取;写入用 memory_write_root / memory_write_logfile;订正与删除用 memory_correct。用户与模型共用,可手工编辑。)",
        "",
      ].join("\n"))
    }
  } catch (e) {
    ctx.logger?.warn?.('dsh-soul-memory: starter files failed: %o', e)
  }

  // ---------- 公开服务面 'soulMemory'(v0.3.0;dsh-top-tab 等消费方) ----------
  // 读面/编辑面全部复用纯函数;错误文案/上限/.bak 语义与工具面一致。
  ctx.provide('soulMemory', createSoulMemoryService({
    dshHome,
    readMaxChars,
    logger: ctx.logger,
    discoverMemoryLayers,
    listSectionKeys,
    sectionBody,
    appendRootMemory,
    correctRootMemory,
    appendLogfile,
    correctLogfile,
    createLogfile,
  }))

  // ---------- 每 agent 冻结快照(首次 assemble 时发现+渲染一次) ----------
  const snapshots = new WeakMap()
  const snapshotOf = (agent) => {
    if (!agent) return null
    let s = snapshots.get(agent)
    if (!s) {
      const cwd = agent.session?.header?.cwd ?? process.cwd()
      const layers = discoverMemoryLayers(cwd, dshHome)
      s = {
        soul: readTextSafe(soulPath),
        layers,
        block: renderMemoryBlock(layers.rootText, layers.homeEntries, layers.projEntries),
      }
      snapshots.set(agent, s)
    }
    return s
  }

  // ---------- system 段(soul 独立在前,memory 总块随后;v4 起两段) ----------
  ctx.systemPrompt.section({
    name: 'deployment:soul',
    order: -10,
    text: (asm) => snapshotOf(asm.agent)?.soul ?? "",
  })
  ctx.systemPrompt.section({
    name: 'deployment:memory',
    order: 10,
    text: (asm) => snapshotOf(asm.agent)?.block ?? "",
  })

  // ---------- 工具(五件套) ----------
  const textOutput = {
    schema: { type: "string" },
    render: (args, value) => [{ type: "text", text: String(value) }],
  }
  const cwdOf = (exec) => exec?.agent?.session?.header?.cwd ?? process.cwd()
  const asString = (v) => (typeof v === "string" ? v : undefined)
  // scope 归一与层目录定位(此前在四个工具 execute 里两两/三三逐字重复,收拢于此)
  const scopeOf = (args) => typeof args.scope === "string" && ["root", "home", "project"].includes(args.scope) ? args.scope : "root"
  const homeOrProject = (args) => args.scope === "home" ? "home" : "project"
  const dirForScope = (exec, scope) => scope === "home"
    ? join(dshHome, ".memory")
    : join(findProjectRootSync(cwdForProject(exec)), ".agents", ".memory")

  ctx.tools.register(defineTool({
    name: "memory_recall",
    description: "Read memory (the only read entry). scope=root (default) reads MEMORY.md - the full file, or one ## section with section. scope=home|project: with a name, read that logfile (128KiB cap); with a type, list entries of that type; with neither, list the whole layer (name+type+description, most recently edited first). Always reads the latest file state. Memory logs situational judgment (like a Log); rules belong to AGENTS.md, skills to SKILL.",
    parameters: {
      scope: { type: "string", enum: ["root", "home", "project"], description: "Memory layer: root=account MEMORY.md (default); home=$DSH_HOME/.memory; project=<projectRoot>/.agents/.memory." },
      section: { type: "string", description: "scope=root only: the ## section heading to read." },
      type: { type: "string", enum: ["user", "feedback", "project", "situation", "reference"], description: "scope=home|project only: filter the listing by type." },
      name: { type: "string", description: "scope=home|project only: read one logfile by name (without .md)." },
    },
    output: textOutput,
    execute(args, exec) {
      const scope = scopeOf(args)
      const cwd = scope === "project" ? cwdForProject(exec) : cwdOf(exec)
      const layers = discoverMemoryLayers(cwd, dshHome)
      const result = recallMemory(layers, { scope, section: asString(args.section), type: asString(args.type), name: asString(args.name) })
      return Promise.resolve(result.text)
    },
    presentCall(args) {
      const target = typeof args.name === "string" ? (args.scope ?? "root") + "/" + args.name : (args.scope ?? "root")
      return { card: "generic", title: "Recall memory " + target, kind: "read", rawInput: target }
    },
  }))

  ctx.tools.register(defineTool({
    name: "memory_write_root",
    description: "Append content to one section of ROOT ($DSH_HOME/MEMORY.md); the section is created if missing. Content must not contain lines starting with # or ## at line start. Multi-block content: use ### sub-headings. Oversized writes are rejected with compression guidance. Ask the user first, then verify with memory_recall.",
    parameters: {
      section: { type: "string", required: true, description: "The ## section key - created if missing." },
      content: { type: "string", required: true, description: "Text appended to the end of the section." },
    },
    output: textOutput,
    execute(args) {
      const result = appendRootMemory(memoryPath, { section: asString(args.section), content: asString(args.content), maxChars: readMaxChars() })
      return Promise.resolve(result.text)
    },
    presentCall(args) {
      return { card: "generic", title: "Append root section " + (typeof args.section === "string" ? args.section : ""), kind: "edit", rawInput: args.section }
    },
  }))

  ctx.tools.register(defineTool({
    name: "memory_write_logfile",
    description: "Append one entry to a logfile (HOME/PROJECT); the entry carries a machine-generated timestamp. Content must not contain lines starting with # or ## at line start. Multi-block content: use ### sub-headings. Ask the user first, then verify with memory_recall.",
    parameters: {
      scope: { type: "string", enum: ["home", "project"], description: "Storage layer: home=$DSH_HOME/.memory (cross-project); project=<projectRoot>/.agents/.memory (default)." },
      name: { type: "string", required: true, description: "The logfile name (without .md)." },
      title: { type: "string", description: "Optional entry title, shown before the timestamp." },
      content: { type: "string", required: true, description: "The entry body, kept verbatim under the generated heading." },
    },
    output: textOutput,
    execute(args, exec) {
      const scope = homeOrProject(args)
      const dir = dirForScope(exec, scope)
      if (!isLogfileName(normalizeLogfileName(asString(args.name)))) throw new Error(illegalLogfileNameMessage(String(args.name)))
      const result = appendLogfile(dir, { name: asString(args.name), title: asString(args.title), content: asString(args.content) })
      return Promise.resolve(result.text)
    },
    presentCall(args) {
      return { card: "generic", title: "Append log entry " + (args.scope ?? "project") + "/" + (typeof args.name === "string" ? args.name : ""), kind: "edit", rawInput: args.name }
    },
  }))

  ctx.tools.register(defineTool({
    name: "memory_correct",
    description: "Correct or remove one memory unit; scope decides the layer. ROOT: match one ## section by name - non-empty content rewrites the whole section, empty content deletes it. HOME/PROJECT: match one entry by title (the part before the machine-generated timestamp) in logfile name - non-empty content rewrites that entry, empty content deletes it. Matching must resolve to exactly one unit; when several entries share the title, pass at or the call is rejected. Ask the user first, then verify with memory_recall.",
    parameters: {
      scope: { type: "string", enum: ["root", "home", "project"], description: "Which layer to correct: root MEMORY.md sections (default), or home/project logfile entries." },
      section: { type: "string", description: "ROOT only: the ## section key to correct or delete." },
      name: { type: "string", description: "HOME/PROJECT only: the logfile name (without .md)." },
      title: { type: "string", description: "HOME/PROJECT only: entry title to match (without the generated timestamp)." },
      at: { type: "string", description: "HOME/PROJECT only: entry timestamp YYYY-MM-DD HH:mm, required when several entries share the same title." },
      content: { type: "string", description: "New body for the matched unit; omit or leave empty = delete it." },
    },
    output: textOutput,
    execute(args, exec) {
      const scope = scopeOf(args)
      if (scope === "root") {
        if (typeof args.section !== "string" || args.section.trim() === "") throw new Error(MSG.rootNeedSection)
        const result = correctRootMemory(memoryPath, { section: args.section, content: asString(args.content), maxChars: readMaxChars() })
        return Promise.resolve(result.text)
      }
      if (typeof args.name !== "string" || args.name.trim() === "" || typeof args.title !== "string" || args.title.trim() === "") {
        throw new Error(MSG.logfileNeedParams)
      }
      const dir = dirForScope(exec, scope)
      const result = correctLogfile(dir, { name: args.name, title: args.title, at: asString(args.at), content: asString(args.content) })
      return Promise.resolve(result.text)
    },
    presentCall(args) {
      const target = !args.scope || args.scope === "root" ? "root/" + (typeof args.section === "string" ? args.section : "") : (args.scope ?? "project") + "/" + (typeof args.name === "string" ? args.name : "")
      return { card: "generic", title: "Correct memory " + target, kind: "edit", rawInput: target }
    },
  }))

  ctx.tools.register(defineTool({
    name: "memory_creator",
    description: "Create a logfile shell (HOME/PROJECT). Fill in five fields: scope, name, type, a one-line description, and the heading text - the tool generates the frontmatter fencing and the H1 heading itself; a fresh shell has no entries (first one comes via memory_write_logfile). type takes exactly one of: user / feedback / project / situation / reference. scope selects the storage: home=$DSH_HOME/.memory (cross-project) or project=<projectRoot>/.agents/.memory (default). Names must be short and path-safe. An existing logfile blocks creation - remove that file manually to rebuild. New entries appear in the frozen session catalog next session; read them now via memory_recall.",
    parameters: {
      scope: { type: "string", enum: ["home", "project"], description: "Where to store it: home=$DSH_HOME/.memory (cross-project); project=<projectRoot>/.agents/.memory (default)." },
      name: { type: "string", required: true, description: "Logfile name (without .md). Must be short and path-safe." },
      type: { type: "string", enum: ["user", "feedback", "project", "situation", "reference"], required: true, description: "user=user profile, feedback=feedback style, project=project facts, situation=the world around the user, reference=other repos/folders cited by project work." },
      description: { type: "string", required: true, description: "One line shown in the memory catalog; newlines are folded." },
      heading: { type: "string", description: "H1 heading text; defaults to name. The # mark and leading blank line are generated by the tool." },
    },
    output: textOutput,
    execute(args, exec) {
      const scope = homeOrProject(args)
      const dir = dirForScope(exec, scope)
      const created = createLogfile(dir, { name: asString(args.name), type: asString(args.type), description: asString(args.description), heading: asString(args.heading) })
      if (!created.ok) throw new Error(created.error)
      const outLines = [
        "memory_creator: " + created.path + " created(壳就绪,无条目)",
        "  name: " + created.name + "  type: " + created.type + "  scope: " + scope,
        "  description: " + created.description,
        ...(created.warnings.length > 0
          ? ["  自检 warnings:", ...created.warnings.map((w) => "    - " + w)]
          : ["  自检: PASS"]),
        "第一条日志:memory_write_logfile(scope=" + scope + ", name=" + created.name + ", title=?, content=...)。",
        "记忆目录按会话冻结:下个会话可见;本会话直接 memory_recall(scope=" + scope + ", name=" + created.name + ") 读取。",
      ]
      return Promise.resolve(outLines.join("\n"))
    },
    presentCall(args) {
      return { card: "generic", title: "Create memory logfile " + (typeof args.name === "string" ? args.name : ""), kind: "edit", rawInput: args.name }
    },
  }))
}
