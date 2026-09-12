/**
 * dsh-soul-memory / lib/logfile-write.mjs — L2/L3 logfile 追加/订正/建壳
 *
 * 自 soul-memory.mjs 迁出(2026-09-13 ALPHA_0.5 taste 整理),函数体逐字未动
 * (BSN 常量还原为 '\n' 字面量,值相等;两处「读原文失败抛 logfileMissing」
 * 收拢为 readRawOrMissing)。文本层契约(命名/条目头/原子写)在 ./logfile.mjs,
 * 本文件只做工具级写操作:append 自动时间戳小节、correct 按 title(+at)定位、
 * creator 五参数建壳(格式全由工具生成,自检 warnings)。
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildEntryHeading,
  hasHeadingLineConflict,
  illegalLogfileNameMessage,
  isLogfileName,
  isMemoryType,
  locateEntries,
  normalizeLogfileName,
  parseLogfile,
  renderFrontmatter,
  scanLogfileDir,
  writeTextAtomic,
} from './logfile.mjs'
import { MSG, illegalTypeMessage, missingDescriptionMessage } from './messages.mjs'

/** logfile 缺失的教学报错:报路径 + 列出现有可用名 + 指引建壳。 */
function logfileMissing(nm, dir) {
  const names = scanLogfileDir(dir).map((entry) => entry.name).join('、')
  return 'logfile "' + nm + '" 不存在(' + join(dir, nm + '.md') + ')。可用:' + (names || '(无)') + '。新建:先 memory_creator 建壳。'
}

/** 读 logfile 原文;缺失/不可读统一走 logfileMissing 教学(append/correct 共用)。 */
function readRawOrMissing(dir, nm) {
  try {
    return readFileSync(join(dir, nm + '.md'), 'utf8')
  } catch {
    throw new Error(logfileMissing(nm, dir))
  }
}

// ---------- 写:logfile 纯追加(memory_write_logfile) ----------

export function appendLogfile(dir, opts) {
  const nm = normalizeLogfileName(opts.name)
  if (!nm || !isLogfileName(nm)) throw new Error(illegalLogfileNameMessage(String(opts.name)))
  const raw = readRawOrMissing(dir, nm)
  if (typeof opts.content !== 'string' || opts.content.trim() === '') throw new Error(MSG.needContent)
  if (hasHeadingLineConflict(opts.content)) throw new Error(MSG.entryBan)
  const heading = buildEntryHeading(typeof opts.title === 'string' ? opts.title : '')
  const cleanTail = (s) => s.replace(/\s+$/, "")
  const next = cleanTail(raw) + '\n\n' + heading + '\n' + cleanTail(opts.content) + '\n'
  writeTextAtomic(join(dir, nm + '.md'), next, { backup: true })
  const lines = next.split('\n').length
  const tail = next.length <= 4000 ? next : next.slice(0, 4000) + "\n...(用 memory_recall 查看全文)"
  return { note: "已追加条目到 " + nm, heading, text: "已追加条目到 " + nm + ";当前 " + lines + " 行/" + next.length + " 字符。" + '\n\n' + tail, lines, chars: next.length }
}

// ---------- 写:logfile 订正(memory_correct:title 定位;at 消歧;content 空 = 删条目) ----------

export function correctLogfile(dir, opts) {
  const nm = normalizeLogfileName(opts.name)
  if (!nm || !isLogfileName(nm)) throw new Error(illegalLogfileNameMessage(String(opts.name)))
  const title = typeof opts.title === 'string' ? opts.title.trim() : ''
  if (!title) throw new Error(MSG.logfileNeedParams)
  const raw = readRawOrMissing(dir, nm)
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
  writeTextAtomic(join(dir, nm + '.md'), nextRaw, { backup: true })
  const headText = "## " + target.title + " " + target.stamp
  const note = isEmpty
    ? "已删除条目 \"" + headText + "\";旧文件留 .bak"
    : "已订正 \"" + headText + "\" 的正文(时间戳头保留)"
  const lines = nextRaw.split('\n').length
  const tail = nextRaw.length <= 4000 ? nextRaw : nextRaw.slice(0, 4000) + "\n...(用 memory_recall 查看全文)"
  return { note, text: note + ";当前 " + lines + " 行/" + nextRaw.length + " 字符。" + '\n\n' + tail, lines, chars: nextRaw.length }
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
