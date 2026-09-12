/**
 * dsh-soul-memory / lib/root-memory.mjs — L1 root(MEMORY.md)小节寻址与写操作
 *
 * 自 soul-memory.mjs 顶层纯函数层迁出(2026-09-13 ALPHA_0.5 taste 整理),函数体
 * 逐字未动(BSN 常量还原为 '\n' 字面量,值相等)。寻址语义沿用 v1:'## 小节名'
 * 行定界,collapse 兜底空行;append 新建/续写回执区分;correct 前缀唯一兜底,
 * 多前缀拒绝,content 空 = 删小节。超限拒绝不落盘(附压缩指引)。
 */

import { hasHeadingLineConflict, readTextSafe, writeTextAtomic } from './logfile.mjs'
import { MSG, overLimitMessage } from './messages.mjs'

/** MEMORY.md 写入的默认字符上限(可被 mem.config 的 maxChars 覆盖)。 */
export const DEFAULT_MAX_CHARS = 16384

/**
 * section 键守门(审查 A2 修复):防换行注入伪造 "## " 小节边界、防 "#" 前缀
 * 冒充标题、防超长键。与 logfile 名同样的"细则只在报错文案教学"风格。
 */
export function assertSectionKey(section) {
  if (/\r|\n/.test(section) || section.startsWith('#') || section.length > 64) {
    throw new Error(MSG.badSection)
  }
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
  return { note, text: note + ' "## ' + section + '";当前共 ' + next.length + ' 字符。' + '\n\n' + '## ' + section + '\n' + shown, chars: next.length }
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
  return { note, text: note + ";当前共 " + next.length + " 字符。" + '\n\n' + "## " + key + '\n' + shown, chars: next.length }
}
