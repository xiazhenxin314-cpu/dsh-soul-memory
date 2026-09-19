/**
 * dsh-soul-memory / src/migrate.mjs — 旧项目层 .memory 自动搬迁至 .agents/.memory
 *
 * 拍板(2026-09-19):项目根不再落 .memory,L3 载体改为 <projectRoot>/.agents/.memory。
 * 发现层惰性触发(幂等,只缓存成功结果):
 *  - `.memory` 不存在 → 不动;
 *  - `.memory` 是文件(v1 单文件形态)→ mkdir 目标目录 → 旧内容包 frontmatter 写
 *    `<targetDir>/project.md`(围栏+恰一空行+正文)→ 写成功后才删旧文件;
 *  - `.memory` 是目录(v2 logfile 形态)→ 目标不存在时 mkdir -p .agents 后整体
 *    原子 rename 到 .agents/.memory;目标已存在则并存不迁移(留人工合并);
 *  - 任一步失败 → 尽力回滚(删新文件/目录搬回原位,只删自己建出的空目录),
 *    返回 ok:false,发现层按空层兼容。
 * 幂等:搬迁后旧位置不存在,不再触发。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { extractDescription, renderFrontmatter, writeTextAtomic } from './logfile.mjs'

/** 迁移结果的判别联合。 */
export function migrateLegacyDotMemory(projectRoot) {
  const legacyPath = join(projectRoot, '.memory')
  const targetDir = join(projectRoot, '.agents', '.memory')
  let legacyIsDir = false
  try {
    if (!existsSync(legacyPath)) return { ok: true, moved: false }
    legacyIsDir = statSync(legacyPath).isDirectory()
  } catch (error) {
    return { ok: false, error: `cannot stat ${legacyPath}: ${error instanceof Error ? error.message : String(error)}` }
  }
  return legacyIsDir ? relocateDir(legacyPath, targetDir) : migrateSingleFile(legacyPath, targetDir)
}

// v2 目录形态:整体原子 rename;失败搬回原位
function relocateDir(legacyPath, targetDir) {
  if (existsSync(targetDir)) return { ok: true, moved: false, note: 'legacy .memory 与 .agents/.memory 并存,未迁移(留人工合并)' }
  try {
    mkdirSync(join(targetDir, '..'), { recursive: true })
    renameSync(legacyPath, targetDir)
    return { ok: true, moved: true, path: targetDir }
  } catch (error) {
    try {
      if (!existsSync(legacyPath) && existsSync(targetDir)) renameSync(targetDir, legacyPath)
    } catch {
      // 回滚失败也不再动,保留现场
    }
    return { ok: false, error: `relocation failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// v1 单文件形态:包 frontmatter 写入新位,写成功后才删旧文件
function migrateSingleFile(legacyPath, targetDir) {
  let raw
  try {
    raw = readFileSync(legacyPath, 'utf8')
  } catch (error) {
    return { ok: false, error: `cannot read ${legacyPath}: ${error instanceof Error ? error.message : String(error)}` }
  }
  const description = extractDescription(raw, { fallback: '项目情境记忆(旧单文件迁移)' })
  const targetFile = join(targetDir, 'project.md')
  try {
    mkdirSync(targetDir, { recursive: true })
    // 围栏后补恰一空行(审查 G3 修复):对齐 creator 的 fence + 空行 + 正文布局
    writeTextAtomic(targetFile, renderFrontmatter({ name: 'project', type: 'project', description }) + '\n\n' + raw.replace(/^\n+/, ''))
    rmSync(legacyPath)
    return { ok: true, moved: true, path: targetFile, name: 'project', description }
  } catch (error) {
    // 尽力回滚:删已写入的新文件 → 删只为本迁移建出的空目录(旧文件全程未动)
    try {
      if (existsSync(targetFile)) rmSync(targetFile)
      rmdirSync(targetDir)
      rmdirSync(join(targetDir, '..'))
    } catch {
      // 目录非空(如 .agents 下另有 skills)或不存在则保留现场
    }
    return { ok: false, error: `migration failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}
