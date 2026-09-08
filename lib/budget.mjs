/**
 * dsh-soul-memory / lib/budget.mjs — system prompt 冻结内容的注入预算
 *
 * 正式规则(2026-08-26 用户拍板):
 * - 预算 200 行 或 16384 字符(UTF-16 code units),两口径分别核算,任一先到即截;
 * - 统计范围 = L1 快照全文 + L2/L3 条目行(结构行/提示行不计入);
 * - 分配 L1 > L2 > L3:L1 全额、永不因低层膨胀被截断;L1 自身超预算 -> 完整注入 + 告警;
 * - L2/L3 按 mtime 倒序入列,从尾部(最旧)截断,条目为原子单位;
 * - 截断提示一行,指向 memory_recall 完整清单;
 * - v4 起 notice/rootWarning 英文化、去掉旧头([记忆目录]),渲染层放进 <memory>
 *   大包裹的所属层块末尾(rootWarning 进 <root>,notice 进被截断层)。
 * - v4.2(2026-09-04 审查 A1/E1 修复):截断按层分别计数,notices 结构化
 *   { home, project } 各自独立 —— 双层同截时各自如实提示,渲染层不再对
 *   英文文案做子串反查。
 */

/** 注入预算(两口径独立)。 */
export const INJECTION_BUDGET = { maxLines: 200, maxChars: 16384 }

/** 目录条目行(计入预算的唯一目录内容;层上下文由包裹标签提供,不带层前缀)。 */
export function entryBullet(entry) {
  return '- ' + entry.name + ' [' + entry.type + '] ' + entry.description
}

/**
 * 按 L1>L2>L3 分配注入预算。截断按层分别计数(审查 A1 修复):home/project
 * 各自独立统计被截条数并各自生成 notice(为 null 表示该层无截断),双层同截时
 * 互不吞并、互不冒领。
 * @returns { homeShown, projShown, rootWarning, homeTruncated, projTruncated,
 *            notices: { home, project } }
 */
export function applyInjectionBudget(rootText, homeEntries, projEntries, budget) {
  const cfg = budget || INJECTION_BUDGET
  const rootLines = rootText ? rootText.split('\n').length : 0
  const rootChars = rootText ? rootText.length : 0
  let rootWarning = null
  if (rootLines > cfg.maxLines || rootChars > cfg.maxChars) {
    rootWarning = 'ROOT snapshot exceeds injection budget (' + rootLines + ' lines / ' + rootChars
      + ' chars > ' + cfg.maxLines + ' / ' + cfg.maxChars + '); injected in full - never truncated.'
      + ' Consider slimming bloated sections via memory_correct.'
  }
  let lines = rootLines
  let chars = rootChars
  const homeShown = []
  const projShown = []
  let homeTruncated = 0
  let projTruncated = 0
  const ordered = [
    ...homeEntries.map((entry) => ({ layer: 'home', entry })),
    ...projEntries.map((entry) => ({ layer: 'project', entry })),
  ]
  for (const { layer, entry } of ordered) {
    const line = entryBullet(entry)
    const nextLines = lines + 1
    const nextChars = chars + line.length
    if (nextLines > cfg.maxLines || nextChars > cfg.maxChars) {
      if (layer === 'home') homeTruncated += 1
      else projTruncated += 1
      continue
    }
    lines = nextLines
    chars = nextChars
    if (layer === 'home') homeShown.push(entry)
    else projShown.push(entry)
  }
  const noticeFor = (layer, count) => count === 0
    ? null
    : 'Injection budget full (' + cfg.maxLines + ' lines / ' + cfg.maxChars + ' chars): '
      + layer + ' layer truncated ' + count + ' oldest entries; full list via memory_recall(scope=' + layer + ').'
  return {
    homeShown,
    projShown,
    rootWarning,
    homeTruncated,
    projTruncated,
    notices: { home: noticeFor('home', homeTruncated), project: noticeFor('project', projTruncated) },
  }
}
