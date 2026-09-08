/**
 * dsh-soul-memory / lib/logfile.mjs — L2/L3 logfile 纯函数层(零依赖)
 *
 * v2.1(2026-08-27 写入规范与命名放开改造):
 *  - 命名放开:中文名可用(normalizeLogfileName + isLogfileName)。禁止:/ \ 与控制字符、
 *    Windows 保留字符 :*?"<>|、首位 . 空白 -(末位 . 空白),<=64 字符;入口 NFC 归一化,
 *    ".md" 后缀自动剥离;
 *  - 条目头契约:`## [标题] YYYY-MM-DD HH:mm`(标题可省;时间戳恒由工具生成)
 *    —— buildEntryHeading / splitEntryHeading;
 *  - 行首禁令探测器 hasHeadingLineConflict:# 或 ## 开头的行不允许出现在
 *    追加/订正正文里(# 冒充建壳的一级标题;## 分裂 root 小节边界/logfile 时间轴);
 *  - writeTextAtomic 支持 .bak 单代备份(覆盖写前把旧文件存为 <path>.bak);
 *  - 读宽容哲学不变:无 frontmatter 的 .md 照常进入目录,解析问题以 warnings 暴露。
 */

import {
  copyFileSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/** type 五维(与 memory_creator 参数定义一致)。 */
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'situation', 'reference']

/** logfile 名上限(NFC 归一化后的字符数)。 */
export const LOGFILE_NAME_MAX = 64

/** logfile 单文件读取的最大字节数(截断,不动文件本身)。 */
export const MAX_READ_BYTES = 131072

export function isMemoryType(value) {
  return typeof value === 'string' && MEMORY_TYPES.includes(value)
}

/**
 * 规范化 logfile 名:去首尾空白、剥 ".md" 后缀、NFC 归一化。
 * 返回 null 表示入参不是字符串或规范化后为空。
 */
export function normalizeLogfileName(value) {
  if (typeof value !== 'string') return null
  let n = value.trim()
  n = n.replace(/\.md$/i, '').trim()
  return n ? n.normalize('NFC') : null
}

/** 命名合法性:见文件头注释禁令清单。传入值应已过 normalizeLogfileName。 */
export function isLogfileName(value) {
  const n = typeof value === 'string' ? value : normalizeLogfileName(value)
  if (!n || n.length > LOGFILE_NAME_MAX) return false
  if (n === '.' || n === '..') return false
  if (/[/\\\0]/.test(n)) return false
  if (/[:*?"<>|]/.test(n)) return false
  if (/\p{C}/u.test(n)) return false
  if (/^[.\s-]/.test(n)) return false
  if (/[.\s]$/.test(n)) return false
  return true
}

/** 统一的非法名报错(细则只在这里教学,schema 词面不讲命名规则)。 */
export function illegalLogfileNameMessage(raw) {
  return '非法 logfile 名 "' + String(raw) + '":禁止 / \\ 及控制字符、首尾点或空格、Windows 保留字符 : * ? " < > |;长度 <= ' + LOGFILE_NAME_MAX + ' 字符(可用中文);误带 ".md" 会自动去掉。'
}

/**
 * git 根信息:从 cwd 向上找最近含 .git 的祖先;(.git 为目录或文件皆认 ——
 * git worktree/submodule 的 .git 是文件,只认目录会漏;审查 B1 修复:
 * 本函数是全插件唯一的 git 判定点,服务面 projectAvailable 同源)。
 * 找不到返回 { root: resolve(cwd), isRepo: false }。
 */
export function gitRootInfo(cwd) {
  let current = resolve(cwd)
  for (;;) {
    try {
      statSync(join(current, '.git'))
      return { root: current, isRepo: true }
    } catch {
      // 不存在,继续向上
    }
    const parent = dirname(current)
    if (parent === current) return { root: resolve(cwd), isRepo: false }
    current = parent
  }
}

/**
 * 项目根:gitRootInfo 的 root 短路(.git 文件也算 worktree 根;找不到回退 cwd 本身)。
 */
export function findProjectRootSync(cwd) {
  return gitRootInfo(cwd).root
}

/**
 * 从文本提取 description,宽容降级:
 *  1. description: 行(首个非空匹配);
 *  2. 首个一级标题行(排除 "MEMORY" 开头的通用标题;allowHeading=false 跳过);
 *  3. 兜底 fallback。
 */
export function extractDescription(text, opts) {
  const allowHeading = !opts || opts.allowHeading !== false
  const fallback = (opts && typeof opts.fallback === 'string') ? opts.fallback : ''
  const raw = String(text ?? '')
  const descLine = /^description\s*:\s*(.+)$/m.exec(raw)
  if (descLine !== null) {
    const value = descLine[1].trim()
    if (value.length > 0) return value
  }
  if (allowHeading) {
    const heading = /^#\s+(.+)$/m.exec(raw)
    if (heading !== null) {
      const value = heading[1].trim()
      if (value.length > 0 && !/^MEMORY\b/i.test(value)) return value
    }
  }
  return fallback
}

/**
 * 手写 frontmatter 解析:文件以 '---' 行开头,到下一个 '---' 行为止是 key: value 元数据。
 * @returns { name, type, description, body, warnings }
 */
export function parseLogfile(raw, filePath) {
  const text = String(raw ?? '')
  const warnings = []
  let meta = {}
  let body = text
  const firstEnd = text.indexOf('\n')
  if (firstEnd > 0 && text.slice(0, firstEnd).replace(/\r$/, '') === '---') {
    let cursor = firstEnd + 1
    let close = -1
    while (cursor < text.length) {
      const nl = text.indexOf('\n', cursor)
      const lineEnd = nl < 0 ? text.length : nl
      const line = text.slice(cursor, lineEnd).replace(/\r$/, '')
      if (line === '---') { close = cursor; break }
      if (nl < 0) break
      cursor = nl + 1
    }
    if (close >= 0) {
      const metaText = text.slice(firstEnd + 1, close)
      for (const line of metaText.split('\n')) {
        const m = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line)
        if (m !== null && m[2].trim() !== '') meta[m[1]] = m[2].trim()
      }
      const after = text.indexOf('\n', close)
      body = after < 0 ? '' : text.slice(after + 1)
    } else {
      warnings.push('unterminated frontmatter (no closing --- line)')
    }
  }
  const name = typeof meta.name === 'string' && meta.name !== ''
    ? meta.name
    : (filePath ? basename(filePath).replace(/\.md$/, '') : '')
  const type = isMemoryType(meta.type) ? meta.type : 'project'
  if (meta.type !== undefined && !isMemoryType(meta.type)) {
    warnings.push("unknown type '" + meta.type + "' -> 'project'")
  }
  const description = typeof meta.description === 'string' && meta.description !== ''
    ? meta.description
    : extractDescription(body, { fallback: '(无描述)' })
  return { name, type, description, body, warnings }
}

/** 渲染 frontmatter 块(含首尾 ---)。 */
export function renderFrontmatter(meta) {
  return ['---', 'name: ' + meta.name, 'type: ' + meta.type, 'description: ' + meta.description, '---'].join('\n')
}

/**
 * 行首禁令探测:append/订正正文出现 # 或 ## 开头的行即冲突。
 * ### 及更深层级不算冲突(软规范:作为内容分块单位)。
 */
export function hasHeadingLineConflict(content) {
  return /^#{1,2}(?:\s|$)/m.test(String(content ?? ''))
}

const pad2 = (n) => String(n).padStart(2, '0')

/** 本地时间戳正文:YYYY-MM-DD HH:mm */
export function formatStamp(date) {
  const d = date || new Date()
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/** 兼容旧导出:时间戳小节头 ## YYYY-MM-DD HH:mm */
export function timestampHeading(date) {
  return '## ' + formatStamp(date)
}

/**
 * 条目头生成:title 非空 -> "## <标题> <时间戳>";否则 "## <时间戳>"。
 * 时间戳恒由本函数生成——调用方永不自带。
 */
export function buildEntryHeading(title, date) {
  const t = typeof title === 'string' ? title.trim().replace(/^#+\s*/, '') : ''
  return t ? '## ' + t + ' ' + formatStamp(date) : '## ' + formatStamp(date)
}

/** 拆解一行条目头;非条目头返回 null。title 可为空串(纯时间戳头)。 */
export function splitEntryHeading(line) {
  const s = String(line ?? '').replace(/\r$/, '')
  let m = /^## (.+) (\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/.exec(s)
  if (m !== null) return { title: m[1], stamp: m[2] }
  m = /^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/.exec(s)
  if (m !== null) return { title: '', stamp: m[1] }
  return null
}

/**
 * 定位全文中的所有日志条目(frontmatter 之后的条目头块)。
 * 行号为全文绝对行号:start = 头所在行,end = 块结束(排他)。
 * 一级标题区与前言不是条目;其他 "## " 开头但不符合时间戳格式的行视为普通小节边界。
 */
export function locateEntries(raw) {
  const ls = String(raw ?? '').split('\n')
  let fmEnd = -1
  if (ls.length > 0 && ls[0].replace(/\r$/, '') === '---') {
    for (let i = 1; i < ls.length; i++) {
      if (ls[i].replace(/\r$/, '') === '---') { fmEnd = i; break }
    }
  }
  const entries = []
  let cur = null
  for (let i = fmEnd + 1; i < ls.length; i++) {
    const h = splitEntryHeading(ls[i])
    if (h !== null) {
      if (cur !== null) cur.end = i
      cur = { title: h.title, stamp: h.stamp, start: i, end: ls.length }
      entries.push(cur)
    } else if (/^##\s/.test(ls[i]) && cur !== null) {
      cur.end = i
      cur = null
    }
  }
  return { fmEnd, entries }
}

/** 原子写:tmp + rename;backup=true 时先把旧文件复制为 <path>.bak(单代)。 */
export function writeTextAtomic(path, content, opts) {
  if (opts && opts.backup) {
    try { copyFileSync(path, path + '.bak') } catch { /* 首写无旧文件 */ }
  }
  const tmp = path + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2)
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, path)
}

/**
 * 扫描一个 logfile 目录:顶层 *.md,解析 frontmatter,mtime 倒序(同 mtime 按 name 升序)。
 * 目录不存在/不可读 → []。
 */
export function scanLogfileDir(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const logs = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const path = join(dir, entry.name)
    let raw
    let mtimeMs = 0
    try {
      raw = readFileSync(path, 'utf8')
      mtimeMs = statSync(path).mtimeMs
    } catch {
      continue
    }
    const parsed = parseLogfile(raw, path)
    logs.push({
      name: parsed.name,
      type: parsed.type,
      description: parsed.description,
      path,
      mtimeMs,
      lines: raw.split('\n').length,
      chars: raw.length,
      warnings: parsed.warnings,
    })
  }
  logs.sort((a, b) => (b.mtimeMs - a.mtimeMs) || a.name.localeCompare(b.name))
  return logs
}

/**
 * 读单个 logfile 全文(限 128KiB 截断)。
 * @returns { ok:true, entry } | { ok:false, error }
 */
export function readLogfile(dir, name) {
  const path = join(dir, name + '.md')
  let content
  try {
    content = readFileSync(path)
  } catch (error) {
    return { ok: false, error: 'cannot read ' + path + ': ' + (error instanceof Error ? error.message : String(error)) }
  }
  const bytes = content.length
  let truncated = false
  if (bytes > MAX_READ_BYTES) {
    // 截断回退到完整 UTF-8 码点边界(审查 A4 修复):丢弃被拦腰截断的多字节序列,
    // 避免尾部出现 U+FFFD 替换符且 recall 无法自愈。
    let end = MAX_READ_BYTES
    while (end > 0 && (content[end - 1] & 0xc0) === 0x80) end -= 1 // 跳过续字节
    if (end > 0 && (content[end - 1] & 0xc0) === 0xc0) {
      const lead = content[end - 1]
      const width = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : 2
      if (MAX_READ_BYTES - (end - 1) < width) end -= 1 // 首字节残缺,连头丢弃
    }
    content = content.subarray(0, end)
    truncated = true
  }
  const raw = content.toString('utf8')
  const parsed = parseLogfile(raw, path)
  return {
    ok: true,
    entry: Object.assign({}, parsed, { path, bytes, lines: raw.split('\n').length, truncated }),
  }
}
