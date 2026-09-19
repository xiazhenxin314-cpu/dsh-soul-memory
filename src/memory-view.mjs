/**
 * dsh-soul-memory / src/memory-view.mjs — 发现/渲染/读路由(每 agent 冻结视图)
 *
 * 自 soul-memory.mjs 迁出(2026-09-13 ALPHA_0.5 taste 整理),函数体逐字未动:
 *  - 迁移 memo(每项目根只尝试一次,幂等,只缓存成功结果)+ discoverMemoryLayers
 *    三层现状发现;
 *  - renderMemoryBlock 注入总成稿(v4 <memory> 大包裹;v4.1 层边界空行分隔);
 *  - recallMemory 唯一读入口的路由(root 全文/小节;home/project 清单/过滤/单文件)。
 */

import { join } from 'node:path'
import {
  MAX_READ_BYTES,
  findProjectRootSync,
  illegalLogfileNameMessage,
  isLogfileName,
  normalizeLogfileName,
  readLogfile,
  readTextSafe,
  scanLogfileDir,
} from './logfile.mjs'
import { applyInjectionBudget, entryBullet } from './budget.mjs'
import { migrateLegacyDotMemory } from './migrate.mjs'
import { sectionBody } from './root-memory.mjs'

// ---------- 注入文案(v4 英文提示语;层内数据忠实展示) ----------

const MEM_HEADER = '<memory>Cross-session long-term memory; frozen at session start. Confirm with the user before any write; verify with memory_recall afterwards.'
const ROOT_HINT = '<root>ROOT - account-level MEMORY.md ($DSH_HOME/MEMORY.md), full text below. Anchors: section ("## 小节名") + content.'
const HOME_HINT = '<home>HOME - low-coupling stable memories ($DSH_HOME/.memory). Listed by name/type/description only; read full text via memory_recall.'
const PROJ_HINT = '<project>PROJECT - high-confidence project memories (<projectRoot>/.agents/.memory). Same listing; read full text via memory_recall.'
const EMPTY_LAYER = '(no logfile yet - create one with memory_creator)'
const EMPTY_ROOT = '(MEMORY.md does not exist yet)'
const SEP = '---'

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
    projDir: join(projectRoot, '.agents', '.memory'),
    projEntries: scanLogfileDir(join(projectRoot, '.agents', '.memory')),
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
