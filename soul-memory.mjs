/**
 * dsh-soul-memory — SOUL/MEMORY 跨会话记忆插件(v2:三层记忆架构)
 *
 * 三层结构(2026-08-26 重构):
 *  - L1 root : $DSH_HOME/MEMORY.md           → sys prompt 完整展开(冻结注入);
 *  - L2 home : $DSH_HOME/.memory/<name>.md   → catalog 展示 name+type+description;
 *  - L3 proj : <projectRoot>/.memory/<name>.md → catalog 展示(项目根=最近含 .git 祖先)。
 *
 * 工具面三件套:memory_recall(唯一读)/ memory_write(唯一写,吞并 compact)/
 * memory_creator(建 logfile)。v1 的 memory_view / memory_compact 已下线。
 *
 * 注入预算(L1>L2>L3):system prompt 冻结记忆内容总量 ≤ 200 行 或 16384 字符,
 * L1 全额永不截断,超限从最低层(尾部=最旧)截断 + 一行指向提示(见 lib/budget.mjs)。
 *
 * 拍板记录(2026-08-26):
 *  - v1 单文件 .memory → 一次性自动迁移(lib/migrate.mjs,惰性触发+回滚);
 *  - catalog 载体 = systemPrompt 冻结段;web 小模块 = 独立待做插件(暂缓);
 *  - logfile append 自动加时间戳小节;logfile 无 delete(删除仅人工);
 *  - logfile 文件本体不设独立写入上限(注入预算 + 用户自律兜底)。
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  MAX_READ_BYTES,
  buildEntryHeading,
  findProjectRootSync,
  hasHeadingLineConflict,
  illegalLogfileNameMessage,
  isLogfileName,
  isMemoryType,
  locateEntries,
  normalizeLogfileName,
  parseLogfile,
  readLogfile,
  renderFrontmatter,
  scanLogfileDir,
  writeTextAtomic,
} from './lib/logfile.mjs'
import { applyInjectionBudget, entryBullet } from './lib/budget.mjs'
import { migrateLegacyDotMemory } from './lib/migrate.mjs'
import { createSoulMemoryService } from './lib/soul-service.mjs'

export const name = '@xiaoxia/dsh-soul-memory'

export const inject = ['systemPrompt', 'tools']

const DEFAULT_MAX_CHARS = 16384

// ---------- 注入文案(v4 英文提示语;层内数据忠实展示) ----------

const MEM_HEADER = '<memory>Cross-session long-term memory; frozen at session start. Confirm with the user before any write; verify with memory_recall afterwards.'
const ROOT_HINT = '<root>ROOT - account-level MEMORY.md ($DSH_HOME/MEMORY.md), full text below. Anchors: section ("## 小节名") + content.'
const HOME_HINT = '<home>HOME - low-coupling stable memories ($DSH_HOME/.memory). Listed by name/type/description only; read full text via memory_recall.'
const PROJ_HINT = '<project>PROJECT - high-confidence project memories (<projectRoot>/.memory). Same listing; read full text via memory_recall.'
const EMPTY_LAYER = '(no logfile yet - create one with memory_creator)'
const EMPTY_ROOT = '(MEMORY.md does not exist yet)'
const SEP = '---'

// ---------- 中文报错语料 ----------

const MSG = {
  rootNeedSection: 'scope=root 需要 section(## 小节名)。',
  logfileNeedParams: 'scope=home/project 需要 name 与 title。',
  needContent: 'append 需要 content。',
  correctBan: '订正正文禁止以 "# " 或 "## " 开头的行;多块请用 "### " 分单元。',
  appendBan: 'content 禁止以 "# " 或 "## " 开头的行:"## " 会分裂小节边界;多块内容请用 "### "。',
  entryBan: '条目正文禁止以 "# " 或 "## " 开头的行;多块请用 "### " 分单元。',
  badSection: '非法 section:不得包含换行;不得以 "#" 开头;长度 <= 64 字符。',
}

/**
 * section 键守门(审查 A2 修复):防换行注入伪造 "## " 小节边界、防 "#" 前缀
 * 冒充标题、防超长键。与 logfile 名同样的"细则只在报错文案教学"风格。
 */
export function assertSectionKey(section) {
  if (/\r|\n/.test(section) || section.startsWith('#') || section.length > 64) {
    throw new Error(MSG.badSection)
  }
}

function overLimitMessage(len, maxChars) {
  return '拒绝写入:结果达 ' + len + ' 字符,超上限 ' + maxChars + ' 字符。压缩:memory_recall(scope=root) 读全文 -> 对臃肿小节用 memory_correct 重写瘦身(节内按 ### 单元整理)。'
}
const BSN = String.fromCharCode(10)

function illegalTypeMessage() { return '非法 type(仅 user | feedback | project | situation | reference)。' }
function missingDescriptionMessage() { return 'description 必填且非空。' }
function logfileMissing(nm, dir) {
  const names = scanLogfileDir(dir).map((entry) => entry.name).join('、')
  return 'logfile "' + nm + '" 不存在(' + join(dir, nm + '.md') + ')。可用:' + (names || '(无)') + '。新建:先 memory_creator 建壳。'
}

// ============================================================================
// 顶层纯函数层(供 tests/smoke.mjs 直测,零挂载依赖)
// ============================================================================

const readTextSafe = (path) => {
  try { return existsSync(path) ? readFileSync(path, 'utf8') : '' } catch { return '' }
}

// ---------- 小节定位/增删改(L1 MEMORY.md 寻址,沿用 v1 语义) ----------

const findSection = (text, key) => {
  const heading = '## ' + key
  const lines = text.split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) { if (lines[i].trim() === heading) { start = i; break } }
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) { if (/^##\s/.test(lines[i])) { end = i; break } }
  return { start, end }
}
export const sectionBody = (text, key) => {
  const s = findSection(text, key)
  if (!s) return undefined
  return text.split('\n').slice(s.start + 1, s.end).join('\n').trim()
}
const collapse = (text) => {
  const t = text.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').trim()
  return t ? t + '\n' : ''
}
const removeSection = (text, key) => {
  const s = findSection(text, key)
  if (!s) return text
  const lines = text.split('\n')
  return collapse(lines.slice(0, s.start).concat(lines.slice(s.end)).join('\n'))
}
const replaceSection = (text, key, content) => {
  const s = findSection(text, key)
  if (!s) return undefined
  const lines = text.split('\n')
  // 正文末补一空行:保住与下一个小节(或 EOF)之间的分行,避免被 splice 吞掉
  lines.splice(s.start, s.end - s.start, '## ' + key, ...content.split('\n'), '')
  return collapse(lines.join('\n'))
}
const appendContent = (text, key, content) => {
  if (!key) return collapse(text + '\n\n' + content)
  const s = findSection(text, key)
  if (s) {
    const lines = text.split('\n')
    const body = lines.slice(s.start + 1, s.end).join('\n').trim()
    const next = (body ? body + '\n' + content : content).split('\n')
    next.push('') // 末尾空行:保住与下一个小节(或 EOF)之间的分行
    lines.splice(s.start + 1, s.end - s.start - 1, ...next)
    return collapse(lines.join('\n'))
  }
  return collapse(text + '\n\n## ' + key + '\n' + content)
}

export const listSectionKeys = (text) => {
  const out = []
  for (const line of String(text ?? '').split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) out.push(m[1])
  }
  return out
}

// ---------- 迁移 memo(每项目根只尝试一次,幂等) ----------

const migrationMemo = new Map()
function migrateOnce(projectRoot) {
  const memo = migrationMemo.get(projectRoot)
  if (memo && memo.ok) return memo
  const result = migrateLegacyDotMemory(projectRoot)
  // 只缓存成功结果(审查 B3 修复):瞬时失败(如 EACCES)不终身缓存,下次发现层重试
  if (result.ok) migrationMemo.set(projectRoot, result)
  return result
}

// ---------- 发现:三层现状 ----------

export function discoverMemoryLayers(cwd, dshHome) {
  const projectRoot = findProjectRootSync(cwd)
  const migration = migrateOnce(projectRoot)
  return {
    projectRoot,
    rootPath: join(dshHome, 'MEMORY.md'),
    rootText: readTextSafe(join(dshHome, 'MEMORY.md')),
    homeDir: join(dshHome, '.memory'),
    homeEntries: scanLogfileDir(join(dshHome, '.memory')),
    projDir: join(projectRoot, '.memory'),
    projEntries: scanLogfileDir(join(projectRoot, '.memory')),
    migration,
  }
}

// ---------- 注入总成稿渲染(v4:<memory> 大包裹;v4.1:层边界空行分隔) ----------
// 排版约定:层分隔横线('---')与 <root>/<home>/<project> 标签前后均留一空行,避免
// 与正文粘连;否则若被当 Markdown 渲染,'文本行\n---' 会被解析成 setext 标题下划线,
// 分隔线被吞。root 正文取尾空白后按原文注入(层内数据忠实展示)。

export function renderMemoryBlock(rootText, homeEntries, projEntries) {
  const budget = applyInjectionBudget(rootText, homeEntries, projEntries)
  const blank = ''
  const rootBody = rootText ? String(rootText).replace(/\s+$/, '') : ''
  const parts = [MEM_HEADER, blank, SEP, blank, ROOT_HINT]
  if (rootBody) {
    parts.push(rootBody)
    if (budget.rootWarning !== null) parts.push(blank, budget.rootWarning)
  } else {
    parts.push(EMPTY_ROOT)
  }
  parts.push(blank, '</root>', blank, SEP, blank)

  const homeNotice = budget.notices.home
  const projNotice = budget.notices.project

  parts.push(HOME_HINT)
  if (budget.homeShown.length === 0) parts.push(EMPTY_LAYER)
  else for (const entry of budget.homeShown) parts.push(entryBullet(entry))
  if (homeNotice) parts.push(homeNotice)
  parts.push(blank, '</home>', blank, SEP, blank)

  parts.push(PROJ_HINT)
  if (budget.projShown.length === 0) parts.push(EMPTY_LAYER)
  else for (const entry of budget.projShown) parts.push(entryBullet(entry))
  if (projNotice) parts.push(projNotice)
  parts.push(blank, '</project>', blank, SEP, blank, '</memory>')
  return parts.join('\n')
}

// ---------- 读(recall 路由) ----------

export function recallMemory(layers, { scope = 'root', section, type, name } = {}) {
  if (scope === 'root') {
    const text = layers.rootText
    if (!text) return { ok: true, text: 'MEMORY.md 尚不存在或为空。' }
    if (typeof section === 'string' && section !== '') {
      const body = sectionBody(text, section)
      const miss = `未找到小节 "## ${section}"。可先 memory_recall(scope=root) 查看全文确认小节名。`
      return { ok: true, text: body === undefined ? miss : `## ${section}\n${body}` }
    }
    return { ok: true, text }
  }
  const label = scope === 'home' ? 'home' : 'project'
  const dir = scope === 'home' ? layers.homeDir : layers.projDir
  const entries = scope === 'home' ? layers.homeEntries : layers.projEntries
  if (typeof name === 'string' && name !== '') {
    const nm = normalizeLogfileName(name)
    if (!nm || !isLogfileName(nm)) return { ok: true, text: illegalLogfileNameMessage(name) }
    const read = readLogfile(dir, nm)
    if (!read.ok) {
      const names = entries.map(entry => entry.name).join('、')
      return { ok: true, text: `logfile "${nm}" 不存在于 ${label} 层。可用:${names || '(无)'}。新建:先 memory_creator 建壳。` }
    }
    const entry = read.entry
    return {
      ok: true,
      text: `--- ${label}/${entry.name} [${entry.type}] — ${entry.path} (${entry.lines} lines, ${entry.bytes} bytes${entry.truncated ? `, truncated to ${MAX_READ_BYTES}` : ''}) ---\n${entry.body}`,
    }
  }
  if (entries.length === 0) {
    return { ok: true, text: `${label} 层尚无 logfile(${dir}),可用 memory_creator 创建。` }
  }
  const filtered = entries.filter(entry => (typeof type === 'string' && type !== '') ? entry.type === type : true)
  if (filtered.length === 0) {
    const existing = [...new Set(entries.map(entry => entry.type))].join(', ')
    return { ok: true, text: `${label} 层没有 type="${type}" 的 logfile。现有 type:${existing}` }
  }
  const prefix = typeof type === 'string' && type !== '' ? `${label} 层 logfile(type=${type},最近编辑在前):` : `${label} 层 logfile(最近编辑在前):`
  return { ok: true, text: prefix + '\n' + filtered.map(entry => `- ${entry.name} [${entry.type}] ${entry.description}`).join('\n') }
}

// ---------- 写:ROOT 纯追加(memory_write_root) ----------

export function appendRootMemory(rootPath, opts) {
  const section = String(opts.section ?? '').trim()
  const maxChars = opts.maxChars || DEFAULT_MAX_CHARS
  if (!section) throw new Error(MSG.rootNeedSection)
  assertSectionKey(section)
  const content = opts.content
  if (typeof content !== 'string' || content.trim() === '') throw new Error(MSG.needContent)
  if (hasHeadingLineConflict(content)) throw new Error(MSG.appendBan)
  const current = readTextSafe(rootPath)
  const existed = findSection(current, section) !== null
  const next = appendContent(current, section, content)
  if (next.length > maxChars) throw new Error(overLimitMessage(next.length, maxChars))
  writeTextAtomic(rootPath, next, { backup: true })
  const note = existed ? '已追加到小节' : '已新建小节'
  const shown = sectionBody(next, section) ?? ''
  return { note, text: note + ' "## ' + section + '";当前共 ' + next.length + ' 字符。' + BSN + BSN + '## ' + section + BSN + shown, chars: next.length }
}

// ---------- 写:ROOT 订正(memory_correct,content 空 = 删小节) ----------

export function correctRootMemory(rootPath, opts) {
  const section = String(opts.section ?? '').trim()
  const maxChars = opts.maxChars || DEFAULT_MAX_CHARS
  if (!section) throw new Error(MSG.rootNeedSection)
  assertSectionKey(section)
  const rawEmpty = opts.content === undefined || String(opts.content).trim() === ''
  const current = readTextSafe(rootPath)
  const keys = listSectionKeys(current)
  let key = null
  if (keys.includes(section)) {
    key = section
  } else {
    const candidates = keys.filter((k) => k.startsWith(section))
    if (candidates.length === 0) throw new Error('未找到小节 "## ' + section + '"。现有小节:{' + keys.join('、') + '}。')
    if (candidates.length > 1) throw new Error('"' + section + '" 匹配到多个小节:{' + candidates.join('、') + '};请用完整小节名。')
    key = candidates[0]
  }
  if (!rawEmpty && hasHeadingLineConflict(opts.content)) throw new Error(MSG.correctBan)
  const next = rawEmpty ? removeSection(current, key) : replaceSection(current, key, String(opts.content).replace(/\s+$/, ''))
  if (next.length > maxChars) throw new Error(overLimitMessage(next.length, maxChars))
  writeTextAtomic(rootPath, next, { backup: true })
  const bakNote = rawEmpty ? ';旧文件留 .bak' : ''
  const note = (rawEmpty ? '已删除小节' : '已重写小节') + ' "## ' + key + '"' + bakNote
  const shown = rawEmpty ? '(该小节已删除)' : (sectionBody(next, key) ?? '')
  return { note, text: note + ";当前共 " + next.length + " 字符。" + BSN + BSN + "## " + key + BSN + shown, chars: next.length }
}

// ---------- 写:logfile 纯追加(memory_write_logfile) ----------

export function appendLogfile(dir, opts) {
  const nm = normalizeLogfileName(opts.name)
  if (!nm || !isLogfileName(nm)) throw new Error(illegalLogfileNameMessage(String(opts.name)))
  const path = join(dir, nm + '.md')
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new Error(logfileMissing(nm, dir))
  }
  if (typeof opts.content !== 'string' || opts.content.trim() === '') throw new Error(MSG.needContent)
  if (hasHeadingLineConflict(opts.content)) throw new Error(MSG.entryBan)
  const heading = buildEntryHeading(typeof opts.title === 'string' ? opts.title : '')
  const cleanTail = (s) => s.replace(/\s+$/, "")
  const next = cleanTail(raw) + BSN + BSN + heading + BSN + cleanTail(opts.content) + BSN
  writeTextAtomic(path, next, { backup: true })
  const lines = next.split('\n').length
  const tail = next.length <= 4000 ? next : next.slice(0, 4000) + "\n...(用 memory_recall 查看全文)"
  return { note: "已追加条目到 " + nm, heading, text: "已追加条目到 " + nm + ";当前 " + lines + " 行/" + next.length + " 字符。" + BSN + BSN + tail, lines, chars: next.length }
}

// ---------- 写:logfile 订正(memory_correct:title 定位;at 消歧;content 空 = 删条目) ----------

export function correctLogfile(dir, opts) {
  const nm = normalizeLogfileName(opts.name)
  if (!nm || !isLogfileName(nm)) throw new Error(illegalLogfileNameMessage(String(opts.name)))
  const title = typeof opts.title === 'string' ? opts.title.trim() : ''
  if (!title) throw new Error(MSG.logfileNeedParams)
  const path = join(dir, nm + '.md')
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new Error(logfileMissing(nm, dir))
  }
  const located = locateEntries(raw)
  const entries = located.entries
  const isEmpty = opts.content === undefined || String(opts.content).trim() === ''
  if (!isEmpty && hasHeadingLineConflict(opts.content)) throw new Error(MSG.correctBan)

  let pool = entries.filter((e) => e.title === title)
  if (pool.length === 0) pool = entries.filter((e) => e.title.startsWith(title))
  if (typeof opts.at === 'string' && opts.at !== '') {
    pool = pool.filter((e) => e.stamp === opts.at)
    if (pool.length === 0) throw new Error("\"" + nm + "\" 中没有 \"" + title + "\" 在 " + opts.at + " 的条目。")
  } else if (pool.length === 0) {
    const existing = entries.map((e) => (e.title || "(无题)") + " @ " + e.stamp).join("、")
    throw new Error("未在 \"" + nm + "\" 中找到标题 \"" + title + "\" 的条目。现有:{" + (existing || "该 logfile 还没有条目") + "}。")
  } else if (pool.length > 1) {
    const stamps = pool.map((e) => e.stamp).join("、")
    throw new Error("\"" + nm + "\" 中有 " + pool.length + " 条 \"" + title + "\" 条目:{" + stamps + "};请附 at(YYYY-MM-DD HH:mm) 唯一定位。")
  }
  const target = pool[0]
  const ls = raw.split('\n')
  if (isEmpty) {
    ls.splice(target.start, target.end - target.start)
  } else {
    const bodyLines = String(opts.content).replace(/\s+$/, '').split('\n')
    bodyLines.push('') // 末尾空行:保住与下一条目(或 EOF)之间的分行
    ls.splice(target.start + 1, target.end - target.start - 1, ...bodyLines)
  }
  let nextRaw = ls.join('\n').replace(/\n{3,}/g, '\n\n')
  if (!/\n$/.test(nextRaw)) nextRaw += '\n'
  writeTextAtomic(path, nextRaw, { backup: true })
  const headText = "## " + target.title + " " + target.stamp
  const note = isEmpty
    ? "已删除条目 \"" + headText + "\";旧文件留 .bak"
    : "已订正 \"" + headText + "\" 的正文(时间戳头保留)"
  const lines = nextRaw.split('\n').length
  const tail = nextRaw.length <= 4000 ? nextRaw : nextRaw.slice(0, 4000) + "\n...(用 memory_recall 查看全文)"
  return { note, text: note + ";当前 " + lines + " 行/" + nextRaw.length + " 字符。" + BSN + BSN + tail, lines, chars: nextRaw.length }
}

// ---------- 建:memory_creator(壳;格式全由工具生成;无 overwrite) ----------

export function createLogfile(dir, opts) {
  const nm = normalizeLogfileName(opts.name)
  if (!nm || !isLogfileName(nm)) return { ok: false, error: illegalLogfileNameMessage(String(opts.name)) }
  if (!isMemoryType(opts.type)) return { ok: false, error: illegalTypeMessage() }
  const desc = typeof opts.description === "string" ? opts.description.trim().replace(/\s*\n\s*/g, " ") : ""
  if (desc === "") return { ok: false, error: missingDescriptionMessage() }
  let heading = typeof opts.heading === "string" ? opts.heading.trim().replace(/\s*\n\s*/g, " ").replace(/^#+\s*/, "") : ""
  if (heading === "") heading = nm
  const path = join(dir, nm + ".md")
  if (existsSync(path)) {
    return { ok: false, error: '"' + path + '" 已存在。如需重建:先人工移除该文件,再重新创建(重要内容请先 memory_recall 取回)。' }
  }
  const fence = renderFrontmatter({ name: nm, type: opts.type, description: desc })
  const content = fence + "\n\n# " + heading + "\n"
  try {
    mkdirSync(dir, { recursive: true })
    writeTextAtomic(path, content)
  } catch (error) {
    return { ok: false, error: "写入失败:" + (error instanceof Error ? error.message : String(error)) }
  }
  const warnings = []
  let readBack = ""
  try { readBack = readFileSync(path, "utf8") } catch (e) { warnings.push("自检读取失败:" + e.message) }
  const check = parseLogfile(readBack, path)
  if (check.name !== nm) warnings.push("自检 name 不一致:" + check.name)
  if (check.type !== opts.type) warnings.push("自检 type 不一致:" + check.type)
  if (check.description !== desc) warnings.push("自检 description 不一致:" + check.description)
  if (!readBack.startsWith(fence + "\n\n# " + heading + "\n")) warnings.push("自检警告:布局偏离规范(frontmatter 围栏 + 恰一空行 + # 一级标题)")
  return { ok: true, path, name: nm, type: opts.type, description: desc, heading, warnings }
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

  // ---------- 同步文件 IO(读安全兜底;写复用 lib writeTextAtomic,审查 B3 去重) ----------
  const readText = (path) => {
    try { return existsSync(path) ? readFileSync(path, 'utf8') : '' } catch { return '' }
  }
  const writeText = (path, content) => writeTextAtomic(path, content)
  const readMaxChars = () => {
    const m = /^\s*maxChars\s*:\s*(\d+)\s*$/m.exec(readText(configPath))
    const n = m ? Number(m[1]) : DEFAULT_MAX_CHARS
    return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_CHARS
  }

  // ---------- 幂等创建初始文件 ----------
  try {
    if (!existsSync(configPath)) {
      writeText(configPath, [
        "# DSH soul/memory 配置",
        "# MEMORY.md 的最大字符数;超限拒绝写入,压缩:对臃肿小节用 memory_correct 瘦写。",
        "memory:",
        "  maxChars: 16384",
        "",
      ].join("\n"))
    }
    if (!existsSync(soulPath)) {
      writeText(soulPath, [
        "# SOUL",
        "",
        "(你的角色设定与人格。此文件只读注入 system prompt 最前,会话期间冻结;修改后新会话生效。)",
        "",
      ].join("\n"))
    }
    if (!existsSync(memoryPath)) {
      writeText(memoryPath, [
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
  // 读面/编辑面全部复用本文件纯函数;错误文案/上限/.bak 语义与工具面一致。
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
        soul: readText(soulPath),
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

  ctx.tools.register(defineTool({
    name: "memory_recall",
    description: "Read memory (the only read entry). scope=root (default) reads MEMORY.md - the full file, or one ## section with section. scope=home|project: with a name, read that logfile (128KiB cap); with a type, list entries of that type; with neither, list the whole layer (name+type+description, most recently edited first). Always reads the latest file state. Memory logs situational judgment (like a Log); rules belong to AGENTS.md, skills to SKILL.",
    parameters: {
      scope: { type: "string", enum: ["root", "home", "project"], description: "Memory layer: root=account MEMORY.md (default); home=$DSH_HOME/.memory; project=<projectRoot>/.memory." },
      section: { type: "string", description: "scope=root only: the ## section heading to read." },
      type: { type: "string", enum: ["user", "feedback", "project", "situation", "reference"], description: "scope=home|project only: filter the listing by type." },
      name: { type: "string", description: "scope=home|project only: read one logfile by name (without .md)." },
    },
    output: textOutput,
    execute(args, exec) {
      const scope = typeof args.scope === "string" && ["root", "home", "project"].includes(args.scope) ? args.scope : "root"
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
      scope: { type: "string", enum: ["home", "project"], description: "Storage layer: home=$DSH_HOME/.memory (cross-project); project=<projectRoot>/.memory (default)." },
      name: { type: "string", required: true, description: "The logfile name (without .md)." },
      title: { type: "string", description: "Optional entry title, shown before the timestamp." },
      content: { type: "string", required: true, description: "The entry body, kept verbatim under the generated heading." },
    },
    output: textOutput,
    execute(args, exec) {
      const scope = args.scope === "home" ? "home" : "project"
      const dir = scope === "home" ? join(dshHome, ".memory") : join(findProjectRootSync(cwdForProject(exec)), ".memory")
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
      const scope = typeof args.scope === "string" && ["root", "home", "project"].includes(args.scope) ? args.scope : "root"
      if (scope === "root") {
        if (typeof args.section !== "string" || args.section.trim() === "") throw new Error(MSG.rootNeedSection)
        const result = correctRootMemory(memoryPath, { section: args.section, content: asString(args.content), maxChars: readMaxChars() })
        return Promise.resolve(result.text)
      }
      if (typeof args.name !== "string" || args.name.trim() === "" || typeof args.title !== "string" || args.title.trim() === "") {
        throw new Error(MSG.logfileNeedParams)
      }
      const dir = scope === "home" ? join(dshHome, ".memory") : join(findProjectRootSync(cwdForProject(exec)), ".memory")
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
    description: "Create a logfile shell (HOME/PROJECT). Fill in five fields: scope, name, type, a one-line description, and the heading text - the tool generates the frontmatter fencing and the H1 heading itself; a fresh shell has no entries (first one comes via memory_write_logfile). type takes exactly one of: user / feedback / project / situation / reference. scope selects the storage: home=$DSH_HOME/.memory (cross-project) or project=<projectRoot>/.memory (default). Names must be short and path-safe. An existing logfile blocks creation - remove that file manually to rebuild. New entries appear in the frozen session catalog next session; read them now via memory_recall.",
    parameters: {
      scope: { type: "string", enum: ["home", "project"], description: "Where to store it: home=$DSH_HOME/.memory (cross-project); project=<projectRoot>/.memory (default)." },
      name: { type: "string", required: true, description: "Logfile name (without .md). Must be short and path-safe." },
      type: { type: "string", enum: ["user", "feedback", "project", "situation", "reference"], required: true, description: "user=user profile, feedback=feedback style, project=project facts, situation=the world around the user, reference=other repos/folders cited by project work." },
      description: { type: "string", required: true, description: "One line shown in the memory catalog; newlines are folded." },
      heading: { type: "string", description: "H1 heading text; defaults to name. The # mark and leading blank line are generated by the tool." },
    },
    output: textOutput,
    execute(args, exec) {
      const scope = args.scope === "home" ? "home" : "project"
      const dir = scope === "home" ? join(dshHome, ".memory") : join(findProjectRootSync(cwdForProject(exec)), ".memory")
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
