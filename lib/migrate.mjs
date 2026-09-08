/**
 * dsh-soul-memory / lib/migrate.mjs — v1 单文件 <projectRoot>/.memory 自动迁移
 *
 * 拍板(2026-08-26):一次性自动迁移。发现层惰性触发:
 *  - `.memory` 是文件(v1 形态)→ rename 让位 → mkdir 目录 →
 *    写 `<dir>/project.md`(frontmatter: name=project / type=project /
 *    description=旧文件描述提取)→ 删临时文件;
 *  - `.memory` 是目录(v2 形态)→ 不动;
 *  - 迁移失败 → 尽力回滚(删已建空目录/新文件,rename 回原位),
 *    返回 ok:false,发现层保留旧文件按单 logfile 兼容读。
 * 幂等:迁移后为目录形态,不再触发。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { extractDescription, renderFrontmatter, writeTextAtomic } from './logfile.mjs'

/** 迁移结果的判别联合。 */
export function migrateLegacyDotMemory(projectRoot) {
  const legacyPath = join(projectRoot, '.memory')
  try {
    if (!existsSync(legacyPath)) return { ok: true, moved: false }
    if (statSync(legacyPath).isDirectory()) return { ok: true, moved: false }
  } catch (error) {
    return { ok: false, error: `cannot stat ${legacyPath}: ${error instanceof Error ? error.message : String(error)}` }
  }
  let raw
  try {
    raw = readFileSync(legacyPath, 'utf8')
  } catch (error) {
    return { ok: false, error: `cannot read ${legacyPath}: ${error instanceof Error ? error.message : String(error)}` }
  }
  const description = extractDescription(raw, { fallback: '项目情境记忆(旧单文件迁移)' })
  const tmp = `${legacyPath}.migrating-${process.pid}-${Math.random().toString(36).slice(2)}`
  const targetFile = join(legacyPath, 'project.md')
  try {
    renameSync(legacyPath, tmp)
    mkdirSync(legacyPath)
    // 围栏后补恰一空行(审查 G3 修复):对齐 creator 的 fence + 空行 + 正文布局
    writeTextAtomic(targetFile, renderFrontmatter({ name: 'project', type: 'project', description }) + '\n\n' + raw.replace(/^\n+/, ''))
    rmSync(tmp)
    return { ok: true, moved: true, path: targetFile, name: 'project', description }
  } catch (error) {
    // 尽力回滚:删已写入的新文件 → 删已建目录(仅当为空)→ 恢复原位
    try {
      if (existsSync(targetFile)) rmSync(targetFile)
      if (existsSync(legacyPath) && readdirSync(legacyPath).length === 0) rmdirSync(legacyPath)
      if (existsSync(tmp)) renameSync(tmp, legacyPath)
    } catch {
      // 回滚失败也不再动,保留现场
    }
    return { ok: false, error: `migration failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}
