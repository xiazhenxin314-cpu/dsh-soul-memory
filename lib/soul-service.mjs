/**
 * dsh-soul-memory / lib/soul-service.mjs — 公开服务面 'soulMemory'(v0.3.0)
 *
 * 消费方(dsh-top-tab 等)通过 cordis 服务名 'soulMemory' 获取——插件间协作
 * 走公开服务,不 value-import 对方运行时实现。读面 + 编辑面,全部复用
 * soul-memory.mjs 的纯函数:语义(禁令/上限/.bak/错误文案)与工具面严格一致。
 *
 * 接口契约(与 dsh-top-tab/src/shared.ts 的 SoulMemoryFace 镜像对齐):
 *   readLayers(cwd?)                  → { projectRoot, projectAvailable,
 *                                        root: { exists, text, sections[] },
 *                                        home: Summary[], project: Summary[] }
 *   readLogfile(scope, name, cwd?)    → { name, type, description,
 *                                        entries: [{title,stamp,body,lines}],
 *                                        preamble, truncated }
 *   edit(payload, cwd?)               → 与工具 pure 函数同返回;错误直接 throw
 *                                        (文案原样,由上层路由包 5xx/提示)
 *
 * 依赖注入:上层宿主(soul-memory.mjs)传入其内部纯函数引用,避免循环 import;
 * 本文件只依赖 ./logfile.mjs(无环)。测试可直接构造(deps 任意假实现)。
 */
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import {
  findProjectRootSync,
  gitRootInfo,
  illegalLogfileNameMessage,
  isLogfileName,
  locateEntries,
  normalizeLogfileName,
  readLogfile as readLogfileRaw,
} from './logfile.mjs'

/** 目录条目的对外摘要(剥掉 path/warnings 等实现字段)。 */
function pickSummary(entry) {
  return {
    name: entry.name,
    type: entry.type,
    description: entry.description,
    mtimeMs: entry.mtimeMs,
    lines: entry.lines,
    chars: entry.chars,
  }
}

/**
 * 构建 soulMemory 服务实例(宿主 apply 时 ctx.provide 之)。
 * @param deps - 上层纯函数与宿主环境:
 *   { dshHome, readMaxChars(), logger?, discoverMemoryLayers, listSectionKeys,
 *     sectionBody, appendRootMemory, correctRootMemory, appendLogfile,
 *     correctLogfile, createLogfile }
 */
export function createSoulMemoryService(deps) {
  const { dshHome, readMaxChars, logger } = deps
  const memoryPath = () => join(dshHome, 'MEMORY.md')
  const homeDir = () => join(dshHome, '.memory')
  const dirOf = (scope, cwd) => {
    if (scope === 'home') return homeDir()
    if (scope === 'project') {
      const root = findProjectRootSync(cwd ?? process.cwd())
      return join(root, '.memory')
    }
    // A5 修复:服务面直传的 scope 拼写错误不再静默当 project,显式报错
    throw new Error('unknown scope: ' + String(scope) + '(仅 home | project)')
  }
  const str = (value) => (typeof value === 'string' ? value : undefined)
  const fail = (error) => { throw error }

  return {
    /** 三层概貌:root 全文件+小节化;home/project 目录摘要(按层最近编辑在前)。 */
    readLayers(cwd) {
      const target = cwd ?? process.cwd()
      const layers = deps.discoverMemoryLayers(target, dshHome)
      const rootText = layers.rootText
      const sections = deps.listSectionKeys(rootText)
        .map((key) => ({ key, body: deps.sectionBody(rootText, key) ?? '' }))
      return {
        projectRoot: layers.projectRoot,
        // B1 修复:与 findProjectRootSync 同源(gitRootInfo),worktree 不再自相矛盾
        projectAvailable: gitRootInfo(target).isRepo,
        // B2 修复:exists=文件是否存在(空文件也算存在),有无内容看 text
        root: { exists: existsSync(memoryPath()), text: rootText, sections },
        home: layers.homeEntries.map(pickSummary),
        project: layers.projEntries.map(pickSummary),
      }
    },

    /** 单个 logfile 结构化全文:条目按文件序(标题+时间戳+正文+行数)+前言区。 */
    readLogfile(scope, name, cwd) {
      const dir = dirOf(scope, cwd)
      const nm = normalizeLogfileName(str(name) ?? '')
      if (!nm || !isLogfileName(nm)) throw new Error(illegalLogfileNameMessage(String(name)))
      const read = readLogfileRaw(dir, nm)
      if (!read.ok) throw new Error(read.error)
      const entry = read.entry
      const body = entry.body ?? ''
      const ls = body.split('\n')
      const located = locateEntries(body)
      let preamble = ''
      let entries = []
      if (located.entries.length > 0) {
        preamble = ls.slice(0, located.entries[0].start).join('\n').trim()
        entries = located.entries.map((e) => {
          const bodyText = ls.slice(e.start + 1, e.end).join('\n').trim()
          return {
            title: e.title,
            stamp: e.stamp,
            body: bodyText,
            lines: bodyText === '' ? 0 : bodyText.split('\n').length,
          }
        })
      } else {
        preamble = body.trim()
      }
      return {
        name: entry.name,
        type: entry.type,
        description: entry.description,
        entries,
        preamble,
        truncated: entry.truncated,
      }
    },

    /**
     * 编辑(语义与工具 pure 函数一致,错误文案原样抛出):
     *   root.section.create / root.section / root.section.delete
     *   logfile.entry.create / logfile.entry / logfile.entry.delete / logfile.shell
     * payload 可携带 cwd(project 层定位);亦可用第二参数显式传入。
     */
    edit(payload, cwd) {
      const p = payload ?? {}
      const target = p.target
      const editCwd = cwd ?? p.cwd
      if (target === 'root.section.create') {
        return deps.appendRootMemory(memoryPath(), { section: str(p.section), content: str(p.content), maxChars: readMaxChars() })
      }
      if (target === 'root.section') {
        return deps.correctRootMemory(memoryPath(), { section: str(p.section), content: str(p.content), maxChars: readMaxChars() })
      }
      if (target === 'root.section.delete') {
        return deps.correctRootMemory(memoryPath(), { section: str(p.section), content: '', maxChars: readMaxChars() })
      }
      if (target === 'logfile.entry.create') {
        const dir = dirOf(p.scope, editCwd)
        return deps.appendLogfile(dir, { name: str(p.name), title: str(p.title), content: str(p.content) })
      }
      if (target === 'logfile.entry') {
        const dir = dirOf(p.scope, editCwd)
        return deps.correctLogfile(dir, { name: str(p.name), title: str(p.title), at: str(p.at), content: str(p.content) })
      }
      if (target === 'logfile.entry.delete') {
        const dir = dirOf(p.scope, editCwd)
        return deps.correctLogfile(dir, { name: str(p.name), title: str(p.title), at: str(p.at), content: '' })
      }
      if (target === 'logfile.shell') {
        const dir = dirOf(p.scope, editCwd)
        const created = deps.createLogfile(dir, {
          name: str(p.name), type: str(p.type), description: str(p.description), heading: str(p.heading),
        })
        if (!created.ok) fail(new Error(created.error))
        return created
      }
      throw new Error('unknown edit target: ' + String(target))
    },
  }
}
