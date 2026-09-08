/**
 * dsh-soul-memory v2.1 冒烟测试(纯函数层,零挂载依赖)
 *
 * 覆盖:frontmatter 解析、命名放开(中文/NFC/禁令)、条目头契约、行首禁令探测器、
 * 目录扫描排序、注入预算(英文文案)、v1 迁移、v4 大包裹渲染、recall 路由、
 * ROOT 追加/订正、logfile 追加/订正(at 消歧)、creator 五参数建壳、.bak 兜底。
 * 运行:node tests/smoke.mjs
 */
import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  MAX_READ_BYTES,
  buildEntryHeading,
  findProjectRootSync,
  gitRootInfo,
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
  splitEntryHeading,
} from '../lib/logfile.mjs'
import { applyInjectionBudget, entryBullet } from '../lib/budget.mjs'
import { migrateLegacyDotMemory } from '../lib/migrate.mjs'
import {
  appendLogfile,
  appendRootMemory,
  cwdForProject,
  correctLogfile,
  correctRootMemory,
  createLogfile,
  discoverMemoryLayers,
  listSectionKeys,
  recallMemory,
  renderMemoryBlock,
  sectionBody,
} from '../soul-memory.mjs'
import { createSoulMemoryService } from '../lib/soul-service.mjs'

let passed = 0
const ok = (label) => { passed += 1; console.log('  ok - ' + label) }
const mkentry = (name, type = 'project', description = 'd') => ({ name, type, description, path: '/x/' + name + '.md', mtimeMs: 0, lines: 1, chars: 1, warnings: [] })

const root = mkdtempSync(join(tmpdir(), 'soul-memory-v21-'))
const userHome = join(root, 'userHome')
const proj = join(root, 'proj')
const gitless = join(root, 'gitless')
mkdirSync(userHome, { recursive: true })
mkdirSync(join(proj, '.git'), { recursive: true })
mkdirSync(join(proj, '.memory'), { recursive: true })
mkdirSync(gitless, { recursive: true })
writeFileSync(join(userHome, 'MEMORY.md'), '# MEMORY\n\n## 环境事实\n- DSH_HOME = ~/.dsh\n\n## 工具约定\n- 一用途一环境\n')

const touch = (path, content, mtime) => {
  writeFileSync(path, content, 'utf8')
  if (mtime !== undefined) {
    const t = new Date(mtime)
    utimesSync(path, t, t)
  }
}

try {
  // ================= lib/logfile.mjs =================
  console.log('parseLogfile')
  const sample = renderFrontmatter({ name: 'pay-boss', type: 'situation', description: '支付对接上级画像' }) + '\n正文段落。\n'
  let parsed = parseLogfile(sample, '/x/pay-boss.md')
  assert.equal(parsed.name, 'pay-boss')
  assert.equal(parsed.type, 'situation')
  assert.equal(parsed.description, '支付对接上级画像')
  assert.match(parsed.body, /正文段落/)
  assert.equal(parsed.warnings.length, 0)
  ok('frontmatter roundtrip(name/type/description/body)')
  parsed = parseLogfile('# 无元数据标题\n\n正文', '/x/bare.md')
  assert.equal(parsed.name, 'bare')
  assert.equal(parsed.type, 'project')
  assert.equal(parsed.description, '无元数据标题')
  ok('无 frontmatter 降级(name/type/description)')
  parsed = parseLogfile('---\ntype: weird\ndescription: x\n---\nbody', '/x/bad.md')
  assert.equal(parsed.type, 'project')
  assert.equal(parsed.warnings.length, 1)
  ok('非法 type 降级 project + warning')

  console.log('命名放开(v2.1)')
  assert.equal(isLogfileName(normalizeLogfileName('pay-boss')), true)
  assert.equal(isLogfileName(normalizeLogfileName('中文记忆')), true)
  assert.equal(isLogfileName(normalizeLogfileName('memo_2')), true)
  assert.equal(isLogfileName(normalizeLogfileName('内部 空格')), true)
  assert.equal(isLogfileName('../up'), false)
  assert.equal(isLogfileName(''), false)
  assert.equal(isLogfileName('.'), false)
  assert.equal(isLogfileName('..'), false)
  assert.equal(isLogfileName('a/b'), false)
  assert.equal(isLogfileName('a:b'), false)
  assert.equal(isLogfileName('.隐藏'), false)
  assert.equal(isLogfileName('-开头'), false)
  assert.equal(isLogfileName('结尾.'), false)
  assert.equal(isLogfileName('x'.repeat(65)), false)
  assert.ok(illegalLogfileNameMessage('坏名字').includes('可用中文'))
  ok('命名校验:中文可用/路径禁/首尾禁/64 上限')
  assert.equal(normalizeLogfileName('笔记.md'), '笔记')
  const nfcInput = 'e\u0301tude'
  assert.equal(normalizeLogfileName(nfcInput), '\u00e9tude'.normalize())
  ok('normalize:.md 剥离 + NFC 归一化')
  assert.equal(isMemoryType('situation'), true)
  assert.equal(isMemoryType('reference'), true)
  assert.equal(isMemoryType('flow'), false)
  ok('type 五维校验')

  console.log('gitRootInfo(worktree / 非 git)')
  const wt = join(root, 'worktree')
  mkdirSync(join(wt, 'deep', 'sub'), { recursive: true })
  writeFileSync(join(wt, '.git'), 'gitdir: /somewhere/main/.git/worktrees/wt\n') // .git 是文件
  assert.deepEqual(gitRootInfo(join(wt, 'deep', 'sub')), { root: wt, isRepo: true })
  assert.equal(findProjectRootSync(join(wt, 'deep', 'sub')), wt)
  assert.equal(gitRootInfo(gitless).isRepo, false)
  assert.equal(findProjectRootSync(gitless), gitless)
  ok('gitRootInfo:worktree .git 文件也认;非 git 回退 cwd(B1)')

  console.log('条目头契约')
  const fixed = new Date(2026, 6, 1, 8, 9)
  assert.equal(buildEntryHeading('踩坑记', fixed), '## 踩坑记 2026-07-01 08:09')
  assert.equal(buildEntryHeading('', fixed), '## 2026-07-01 08:09')
  assert.equal(buildEntryHeading('# 自带井号', fixed), '## 自带井号 2026-07-01 08:09')
  ok('buildEntryHeading:标题可选/剥井号')
  const sp = splitEntryHeading('## 反思 2026-07-01 08:09')
  assert.deepEqual(sp, { title: '反思', stamp: '2026-07-01 08:09' })
  assert.deepEqual(splitEntryHeading('## 2026-07-01 08:09'), { title: '', stamp: '2026-07-01 08:09' })
  assert.equal(splitEntryHeading('## 无时间戳的普通小节'), null)
  ok('splitEntryHeading roundtrip + 非条目头判负')

  console.log('行首禁令探测')
  assert.equal(hasHeadingLineConflict('正文\n## 冒牌小节'), true)
  assert.equal(hasHeadingLineConflict('# 冒充壳头'), true)
  assert.equal(hasHeadingLineConflict('### 三级安全'), false)
  assert.equal(hasHeadingLineConflict('纯文本'), false)
  ok('行首禁令:# 与 ## 视为冲突,### 放行')

  console.log('locateEntries')
  const seedRaw = [
    renderFrontmatter({ name: 'log', type: 'project', description: 'D' }),
    '',
    '# 我的日志',
    '',
    '## A 2026-01-01 10:00',
    '内容A',
    '',
    '## B 2026-01-02 11:00',
    'B1',
    'B2',
    '',
    '## B 2026-01-03 12:00',
    'B3',
    '',
  ].join('\n')
  const located = locateEntries(seedRaw)
  assert.equal(located.entries.length, 3)
  assert.deepEqual(located.entries.map((e) => e.title), ['A', 'B', 'B'])
  assert.deepEqual(located.entries.map((e) => e.stamp), ['2026-01-01 10:00', '2026-01-02 11:00', '2026-01-03 12:00'])
  ok('locateEntries:同题多条/纯时间戳外布局定位')

  console.log('scanLogfileDir / readLogfile')
  touch(join(proj, '.memory', 'a-old.md'), '---\ntype: user\ndescription: A\n---\nA', 1724600000000)
  touch(join(proj, '.memory', 'b-new.md'), '---\ntype: project\ndescription: B\n---\nB', 1724700000000)
  touch(join(proj, '.memory', 'c-new.md'), '---\ntype: project\ndescription: C\n---\nC', 1724700000000)
  writeFileSync(join(proj, '.memory', 'ignored.txt'), 'x')
  const scanned = scanLogfileDir(join(proj, '.memory'))
  assert.deepEqual(scanned.map((e) => e.name), ['b-new', 'c-new', 'a-old'])
  ok('扫描:mtime 倒序 + 同刻按名升序 + 忽略非 md')
  assert.deepEqual(scanLogfileDir(join(root, 'no-such-dir')), [])
  ok('目录不存在返回空数组')
  const rd = readLogfile(join(proj, '.memory'), 'b-new')
  assert.equal(rd.ok, true)
  assert.equal(rd.entry.truncated, false)
  assert.equal(readLogfile(join(proj, '.memory'), 'ghost').ok, false)
  ok('readLogfile 正常读/缺失败')
  const bigDir = join(root, 'big')
  mkdirSync(bigDir, { recursive: true })
  writeFileSync(join(bigDir, 'wide.md'), 'a'.repeat(MAX_READ_BYTES - 2) + '中' + '尾巴')
  const bigRead = readLogfile(bigDir, 'wide')
  assert.equal(bigRead.entry.truncated, true)
  assert.ok(!bigRead.entry.body.includes('\uFFFD'))
  assert.equal(bigRead.entry.body, 'a'.repeat(MAX_READ_BYTES - 2))
  ok('readLogfile 截断回退 UTF-8 码点边界,无替换符(A4)')

  // ================= lib/budget.mjs =================
  console.log('applyInjectionBudget')
  const rt100 = Array.from({ length: 99 }, (_, i) => 'line ' + i).join('\n') + '\n'
  const home50 = Array.from({ length: 50 }, (_, i) => mkentry('home-' + i, 'user', 'h'))
  const proj80 = Array.from({ length: 80 }, (_, i) => mkentry('p-' + i, 'project', 'p'))
  let r = applyInjectionBudget(rt100, home50, proj80, { maxLines: 200, maxChars: 999999 })
  assert.equal(r.homeShown.length, 50)
  assert.equal(r.projShown.length, 50)
  assert.equal(r.notices.home, null)
  assert.match(r.notices.project, /project layer truncated 30 oldest entries/)
  ok('预算:L1 100+L2 50 -> L3 截 30(英文提示指向层)')
  r = applyInjectionBudget('', [], proj80, { maxLines: 999999, maxChars: 200 })
  assert.ok(r.projShown.length < 80)
  assert.match(r.notices.project, /project layer truncated/)
  ok('字符口径先到即截')
  const rt190 = Array.from({ length: 189 }, () => 'x').join('\n') + '\n'
  r = applyInjectionBudget(rt190, home50, proj80, { maxLines: 200, maxChars: 999999 })
  assert.equal(r.homeShown.length, 10)
  assert.equal(r.projShown.length, 0)
  // F1/A1 回归:双层同截时各自如实计数,互不吞并、互不冒领
  assert.equal(r.homeTruncated, 40)
  assert.equal(r.projTruncated, 80)
  assert.match(r.notices.home, /home layer truncated 40 oldest entries/)
  assert.match(r.notices.project, /project layer truncated 80 oldest entries/)
  ok('L1 占满:home 截 40/project 截 80 各自如实提示(A1 回归)')
  const rtBig = Array.from({ length: 250 }, () => 'x').join('\n') + '\n'
  r = applyInjectionBudget(rtBig, [], [], { maxLines: 200, maxChars: 999999 })
  assert.match(r.rootWarning, /never truncated/)
  assert.equal(r.notices.home, null)
  assert.equal(r.notices.project, null)
  ok('L1 超预算:告警不截断')
  assert.equal(entryBullet(mkentry('n', 'user', 'd')), '- n [user] d')
  ok('entryBullet 格式')

  // ================= lib/migrate.mjs =================
  console.log('migrateLegacyDotMemory')
  const legacyProj = join(root, 'legacy')
  mkdirSync(join(legacyProj, '.git'), { recursive: true })
  writeFileSync(join(legacyProj, '.memory'), '# 旧单文件\n\ndescription: 旧项目情境\n\n旧正文\n')
  let mig = migrateLegacyDotMemory(legacyProj)
  assert.equal(mig.ok, true)
  assert.equal(mig.moved, true)
  const migratedFile = readFileSync(join(legacyProj, '.memory', 'project.md'), 'utf8')
  assert.match(migratedFile, /^---\nname: project\ntype: project\ndescription: 旧项目情境\n---/m)
  assert.match(migratedFile, /---\n\n# 旧单文件/)
  ok('v1 单文件迁移(frontmatter+恰一空行+正文,G3)')
  mig = migrateLegacyDotMemory(legacyProj)
  assert.equal(mig.moved, false)
  ok('迁移幂等')

  // ================= cwdForProject(A3 fail-loud) =================
  assert.equal(cwdForProject({ agent: { session: { header: { cwd: '/x/y' } } } }), '/x/y')
  let cwdThrew = false
  try { cwdForProject({}) } catch (e) { cwdThrew = /无法定位 project 层/.test(e.message) }
  assert.equal(cwdThrew, true)
  ok('cwdForProject:可信 cwd 直通;缺失抛错不回退猜测(A3)')

  // ================= 注入总成稿 v4 =================
  console.log('renderMemoryBlock')
  const layers = discoverMemoryLayers(proj, userHome)
  assert.equal(layers.projEntries.length, 3)
  assert.equal(layers.homeEntries.length, 0)
  ok('发现:三层路径与条目(mtime 倒序)')
  const block = renderMemoryBlock(layers.rootText, layers.homeEntries, layers.projEntries)
  assert.match(block, /^<memory>Cross-session long-term memory/)
  const iRootEnd = block.indexOf('</root>')
  const iHomeOpen = block.indexOf('<home>')
  const iHomeEnd = block.indexOf('</home>')
  const iProjOpen = block.indexOf('<project>')
  assert.ok(iRootEnd > 0 && iHomeOpen > iRootEnd && iHomeEnd > iHomeOpen && iProjOpen > iHomeEnd)
  ok('包裹次序:<root> 快照 -> <home> -> <project>')
  assert.equal((block.match(/\n\n---\n\n/g) || []).length, 4)
  assert.match(block, /<\/root>\n\n---\n\n<home>/)
  assert.match(block, /<\/home>\n\n---\n\n<project>/)
  assert.match(block, /<\/project>\n\n---\n\n<\/memory>/)
  assert.match(block, /afterwards\.\n\n---\n\n<root>/)
  ok('分隔横线恰四条,前后空行(层边界分行不粘连)')
  assert.match(block, /- b-new \[project\] B/)
  assert.match(block, /\(no logfile yet - create one with memory_creator\)/)
  ok('home 空提示英文 + project 条目忠实列出')

  // ================= recall 路由 =================
  console.log('recallMemory')
  let rr = recallMemory(layers, { scope: 'root' })
  assert.match(rr.text, /环境事实/)
  ok('recall root 全文')
  rr = recallMemory(layers, { scope: 'root', section: '环境事实' })
  assert.match(rr.text, /^## 环境事实/)
  rr = recallMemory(layers, { scope: 'root', section: '不存在' })
  assert.match(rr.text, /可先 memory_recall\(scope=root\) 查看全文/)
  ok('recall root 小节读/未找到指引')
  rr = recallMemory(layers, { scope: 'project' })
  assert.ok(rr.text.indexOf('b-new') < rr.text.indexOf('a-old'))
  rr = recallMemory(layers, { scope: 'project', type: 'user' })
  assert.match(rr.text, /a-old \[user\]/)
  rr = recallMemory(layers, { scope: 'project', type: 'nope' })
  assert.match(rr.text, /没有 type="nope"/)
  rr = recallMemory(layers, { scope: 'project', name: 'b-new' })
  assert.match(rr.text, /--- project\/b-new \[project\]/)
  rr = recallMemory(layers, { scope: 'project', name: 'ghost' })
  assert.match(rr.text, /新建:先 memory_creator 建壳/)
  ok('recall 清单/过滤/单文件/未知名引导')

  // ================= ROOT 写面 =================
  console.log('appendRootMemory / correctRootMemory')
  const rp = join(root, 'MEMORY.md')
  writeFileSync(rp, '# M\n\n## A\nold-a\n\n## B\nold-b\n')
  let w = appendRootMemory(rp, { section: 'C', content: 'new-c' })
  assert.match(w.text, /已新建小节 "## C"/)
  w = appendRootMemory(rp, { section: 'A', content: 'more-a' })
  assert.match(w.text, /已追加到小节 "## A"/)
  const seededAfter = readFileSync(rp, 'utf8')
  assert.match(seededAfter, /## A\nold-a\nmore-a/)
  assert.match(seededAfter, /## B\nold-b/)
  ok('root append 新建/续写回执区分')
  assert.throws(() => appendRootMemory(rp, { section: '', content: 'x' }), /需要 section/)
  assert.throws(() => appendRootMemory(rp, { section: 'X', content: '' }), /需要 content/)
  assert.throws(() => appendRootMemory(rp, { section: 'X', content: '## 坏小节' }), /禁止以 "# "/)
  assert.throws(() => appendRootMemory(rp, { section: '甲\n## 乙', content: '注入' }), /非法 section/)
  assert.throws(() => appendRootMemory(rp, { section: '#丙', content: '注入' }), /非法 section/)
  assert.throws(() => correctRootMemory(rp, { section: '丁'.repeat(65), content: '' }), /非法 section/)
  ok('root append 缺参/content 禁令报错 + section 键守门(A2)')
  assert.throws(() => appendRootMemory(rp, { section: 'Z', content: 'y'.repeat(20000) }), /压缩/)
  ok('root 超限拒绝(附压缩指引)')
  assert.ok(existsSync(rp + '.bak'))
  ok('root 写覆盖触发 .bak 单代备份')
  w = correctRootMemory(rp, { section: 'C', content: 'rewritten-c' })
  assert.match(w.text, /已重写小节 "## C"/)
  assert.match(readFileSync(rp, 'utf8'), /rewritten-c/)
  ok('correct root 重写小节')
  w = correctRootMemory(rp, { section: 'A', content: '' })
  assert.match(w.text, /已删除小节 "## A";旧文件留 .bak/)
  assert.ok(!readFileSync(rp, 'utf8').includes('old-a'))
  ok('correct root 删小节(空输入)')
  assert.throws(() => correctRootMemory(rp, { section: '不存在' }), /现有小节:/)
  writeFileSync(rp, readFileSync(rp, 'utf8') + '\n## 网络约定\na\n\n## 网络历史\nb\n')
  assert.throws(() => correctRootMemory(rp, { section: '网络', content: '' }), /匹配到多个小节/)
  w = correctRootMemory(rp, { section: '网络历', content: '' })
  assert.match(w.text, /已删除小节 "## 网络历史"/)
  assert.ok(!readFileSync(rp, 'utf8').includes('## 网络历史'))
  ok('correct root 唯一前缀兜底/多前缀拒绝')
  assert.throws(() => correctRootMemory(rp, { section: 'C', content: '## 分裂' }), /订正正文禁止/)

  // 回归(v4.1):写路径保留小节间空行分隔(不吞下一个小节前的空行)
  writeFileSync(rp, '# M\n\n## 甲\n- aaa\n\n## 乙\n- bbb\n')
  appendRootMemory(rp, { section: '甲', content: '- 追加' })
  let spacedRoot = readFileSync(rp, 'utf8')
  assert.match(spacedRoot, /- aaa\n- 追加\n\n## 乙/)
  correctRootMemory(rp, { section: '甲', content: '彻底重写甲' })
  spacedRoot = readFileSync(rp, 'utf8')
  assert.match(spacedRoot, /^# M\n\n## 甲\n彻底重写甲\n\n## 乙\n- bbb\n$/)
  ok('root 写路径:追加/订正后小节间空行保留')

  // ================= logfile 建壳/追加/订正 =================
  console.log('memory_creator 建壳')
  const homeDir = join(userHome, '.memory')
  mkdirSync(homeDir, { recursive: true })
  const created = createLogfile(homeDir, { name: '偏好', type: 'user', description: '用户偏好' })
  assert.equal(created.ok, true)
  assert.equal(created.heading, '偏好')
  assert.equal(created.warnings.length, 0)
  const prefRaw = readFileSync(join(homeDir, '偏好.md'), 'utf8')
  assert.equal(prefRaw, renderFrontmatter({ name: '偏好', type: 'user', description: '用户偏好' }) + '\n\n# 偏好\n')
  ok('creator 中文建壳:围栏+恰一空行+一级标题(全由工具生成)')
  const c2 = createLogfile(homeDir, { name: 'styled', type: 'feedback', description: '样式', heading: '## 我的前缀 样式一二' })
  const styledRaw = readFileSync(join(homeDir, 'styled.md'), 'utf8')
  assert.match(styledRaw, /\n# 我的前缀 样式一二\n$/)
  ok('creator heading:剥井号/折行,格式仍工具生成')
  const dup = createLogfile(homeDir, { name: '偏好', type: 'user', description: 'x' })
  assert.match(dup.error, /已存在/)
  assert.match(createLogfile(homeDir, { name: '坏/名', type: 'user', description: 'x' }).error, /非法 logfile 名/)
  assert.match(createLogfile(homeDir, { name: 'ok', type: 'flow', description: 'x' }).error, /非法 type/)
  assert.match(createLogfile(homeDir, { name: 'ok2', type: 'user', description: '  ' }).error, /description 必填/)
  const mdName = createLogfile(homeDir, { name: 'notes.md', type: 'project', description: 'x' })
  assert.equal(mdName.ok, true)
  assert.ok(existsSync(join(homeDir, 'notes.md')))
  ok('creator 报错族 + .md 后缀剥离创建')
  assert.equal(existsSync(join(homeDir, '偏好.md') + '.bak'), false)

  console.log('appendLogfile')
  let al = appendLogfile(homeDir, { name: '偏好', content: '第一条偏好' })
  assert.match(al.text, /已追加条目到 偏好/)
  assert.match(readFileSync(join(homeDir, '偏好.md'), 'utf8'), /## \d{4}-\d{2}-\d{2} \d{2}:\d{2}\n第一条偏好/)
  al = appendLogfile(homeDir, { name: '偏好', title: '补充', content: '又一条' })
  const prefNow = readFileSync(join(homeDir, '偏好.md'), 'utf8')
  assert.match(prefNow, /## 补充 \d{4}-\d{2}-\d{2} \d{2}:\d{2}\n又一条/)
  ok('logfile append:自动时间戳/自定义标题')
  assert.throws(() => appendLogfile(homeDir, { name: '偏好', content: '上头\n## 内嵌小节' }), /条目正文禁止/)
  let threwGhost = false
  try { appendLogfile(homeDir, { name: 'ghost-log', content: 'x' }) } catch (e) { threwGhost = /先 memory_creator 建壳/.test(e.message) }
  assert.equal(threwGhost, true)
  ok('logfile append 禁令/缺失引导建壳')
  assert.ok(existsSync(join(homeDir, '偏好.md') + '.bak'))

  console.log('correctLogfile')
  writeFileSync(join(homeDir, 'timeline.md'), [
    renderFrontmatter({ name: 'timeline', type: 'project', description: 'T' }),
    '',
    '# 时间线',
    '',
    '## 起点 2026-01-01 10:00',
    '起内容',
    '',
    '## 事件 2026-01-02 11:00',
    '旧事件一号',
    '',
    '## 事件 2026-01-03 12:00',
    '旧事件二号',
    '',
  ].join('\n'))
  assert.throws(
    () => correctLogfile(homeDir, { name: 'timeline', title: '事件', content: '改' }),
    /请附 at\(YYYY-MM-DD HH:mm\) 唯一定位/,
  )
  assert.throws(
    () => correctLogfile(homeDir, { name: 'timeline', title: '事件', at: '2099-01-01 00:00', content: '改' }),
    /中没有 "事件" 在 2099-01-01 00:00/,
  )
  ok('多命中拒绝+at 定位错值报错')
  let cr = correctLogfile(homeDir, { name: 'timeline', title: '事件', at: '2026-01-02 11:00', content: '已订正的一号' })
  assert.match(cr.note, /已订正 "## 事件 2026-01-02 11:00" 的正文\(时间戳头保留\)/)
  let now = readFileSync(join(homeDir, 'timeline.md'), 'utf8')
  assert.match(now, /## 事件 2026-01-02 11:00\n已订正的一号/)
  assert.match(now, /旧事件二号/)
  assert.doesNotMatch(now, /旧事件一号/)
  ok('订正命中唯一条目,其余条目字节不动')
  cr = correctLogfile(homeDir, { name: 'timeline', title: '事件', at: '2026-01-03 12:00' })
  assert.match(cr.note, /已删除条目 "## 事件 2026-01-03 12:00";旧文件留 .bak/)
  now = readFileSync(join(homeDir, 'timeline.md'), 'utf8')
  assert.doesNotMatch(now, /旧事件二号|## 事件 2026-01-03/)
  assert.match(now, /# 时间线/)
  ok('空输入删除整条(一级标题保留)')
  assert.throws(() => correctLogfile(homeDir, { name: 'timeline', title: '不存在的题' }), /现有:{起点 @ |事件 @/)
  assert.throws(() => correctLogfile(homeDir, { name: 'timeline', title: '起点', content: 'x\n## 撕裂' }), /订正正文禁止/)
  ok('未命中列出现有条目/订正禁令')
  const un = correctLogfile(homeDir, { name: 'timeline', title: '起', content: '唯一前缀改写成功' })
  assert.match(un.note, /已订正 "## 起点 2026-01-01 10:00"/)
  ok('唯一前缀兜底命中')

  // 回归(v4.1):logfile 条目订正保留条目间空行(与 root 同类缺陷)
  writeFileSync(join(homeDir, 'spacing.md'), [
    renderFrontmatter({ name: 'spacing', type: 'project', description: 'S' }),
    '',
    '# 间距',
    '',
    '## 一号 2026-02-01 10:00',
    '甲内容',
    '',
    '## 二号 2026-02-02 10:00',
    '乙内容',
    '',
  ].join('\n'))
  correctLogfile(homeDir, { name: 'spacing', title: '一号', content: '甲改' })
  const spacingRaw = readFileSync(join(homeDir, 'spacing.md'), 'utf8')
  assert.match(spacingRaw, /## 一号 2026-02-01 10:00\n甲改\n\n## 二号 2026-02-02 10:00\n乙内容\n$/)
  ok('logfile 写路径:订正后条目间空行保留')

  // ================= 回归:老格式 logfile 可继续追加(读宽容) =================
  const legacyFile = join(homeDir, 'legacy.md')
  writeFileSync(legacyFile, '---\ntype: situation\ndescription: 老\n---\n随便什么老内容\n')
  appendLogfile(homeDir, { name: 'legacy', content: '新规条目照常落' })
  assert.match(readFileSync(legacyFile, 'utf8'), /## \d{4}-\d{2}-\d{2} \d{2}:\d{2}\n新规条目照常落/)
  ok('存量无 H1 旧文件照常可追加(渐进迁移)')

  // ================= soul-memory 服务面(v0.3.0:'soulMemory' 契约) =================
  console.log('soulMemory service')
  const makeSoulService = () => createSoulMemoryService({
    dshHome: userHome,
    readMaxChars: () => 16384,
    logger: undefined,
    discoverMemoryLayers,
    listSectionKeys,
    sectionBody,
    appendRootMemory,
    correctRootMemory,
    appendLogfile,
    correctLogfile,
    createLogfile,
  })
  const svc = makeSoulService()

  const layersView = svc.readLayers(proj)
  assert.equal(layersView.projectRoot, proj)
  assert.equal(layersView.projectAvailable, true)
  assert.equal(layersView.root.exists, true)
  const rootKeys = layersView.root.sections.map((s) => s.key)
  assert.ok(rootKeys.includes('环境事实') && rootKeys.includes('工具约定'))
  assert.match(layersView.root.sections.find((s) => s.key === '环境事实').body, /DSH_HOME/)
  assert.deepEqual(layersView.home.map((e) => e.name).sort(), ['legacy', 'notes', 'spacing', 'styled', 'timeline', '偏好'].sort())
  const bNew = layersView.project.find((e) => e.name === 'b-new')
  assert.equal(bNew.description, 'B')
  assert.equal(bNew.type, 'project')
  assert.equal(typeof bNew.mtimeMs, 'number')
  assert.equal('path' in bNew, false)
  assert.equal('warnings' in bNew, false)
  ok('readLayers:root 小节化/home+project 摘要(剥实现字段)')

  const gitlessView = svc.readLayers(gitless)
  assert.equal(gitlessView.projectAvailable, false)
  assert.equal(gitlessView.project.length, 0)
  ok('readLayers:非 git 目录 -> projectAvailable=false')
  const wtView = svc.readLayers(join(wt, 'deep', 'sub'))
  assert.equal(wtView.projectAvailable, true)
  assert.equal(wtView.projectRoot, wt)
  ok('readLayers:worktree(.git 文件)available 与 root 同源一致(B1)')

  const logView = svc.readLogfile('home', 'timeline')
  assert.equal(logView.name, 'timeline')
  assert.equal(logView.type, 'project')
  assert.equal(logView.entries.length, 2)
  assert.equal(logView.entries[0].title, '起点')
  assert.equal(logView.entries[0].stamp, '2026-01-01 10:00')
  assert.equal(logView.entries[0].body, '唯一前缀改写成功')
  assert.equal(logView.entries[1].title, '事件')
  assert.equal(logView.entries[1].body, '已订正的一号')
  assert.equal(logView.entries[1].lines, 1)
  assert.match(logView.preamble, /# 时间线/)
  assert.equal(logView.truncated, false)
  assert.equal(logView.preamble.includes('起点'), false)
  assert.throws(() => svc.readLogfile('home', '../逃逸'), /非法 logfile 名/)
  let ghostFailed = false
  try { svc.readLogfile('home', 'ghost-log') } catch (e) { ghostFailed = /ghost-log/.test(e.message) }
  assert.equal(ghostFailed, true)
  let scopeThrew = false
  try { svc.readLogfile('bogus', 'x') } catch (e) { scopeThrew = /unknown scope/.test(e.message) }
  assert.equal(scopeThrew, true)
  ok('readLogfile:条目/前言/缺文件/非法名错误透传 + 未知 scope 显式报错(A5)')

  let ed = svc.edit({ target: 'root.section.create', section: '服务测试', content: 'svc-1' })
  assert.match(ed.text, /已新建小节 "## 服务测试"/)
  assert.ok(existsSync(join(userHome, 'MEMORY.md') + '.bak'))
  ed = svc.edit({ target: 'root.section', section: '服务测试', content: 'svc-2' })
  assert.match(ed.text, /已重写小节 "## 服务测试"/)
  assert.match(readFileSync(join(userHome, 'MEMORY.md'), 'utf8'), /## 服务测试\nsvc-2/)
  ed = svc.edit({ target: 'root.section.delete', section: '服务测试' })
  assert.match(ed.text, /已删除小节/)
  assert.doesNotMatch(readFileSync(join(userHome, 'MEMORY.md'), 'utf8'), /服务测试/)
  assert.throws(() => svc.edit({ target: 'root.section.create', section: 'X', content: '## 坏小节' }), /content 禁止以/)
  assert.throws(() => svc.edit({ target: 'nope' }), /unknown edit target/)
  ok('edit root:create/rewrite/delete + 禁令/未知 target')

  ed = svc.edit({ target: 'logfile.shell', scope: 'home', name: 'svc-shell', type: 'project', description: '服务面建壳', heading: 'SVC' })
  assert.equal(ed.ok, true)
  assert.equal(ed.path, join(homeDir, 'svc-shell.md'))
  ok('edit logfile.shell:建壳')

  ed = svc.edit({ target: 'logfile.entry.create', scope: 'home', name: '偏好', title: '服务面条目', content: 'svc-entry' })
  const stampOf = ed.heading.split(' ').slice(-2).join(' ')
  ed = svc.edit({ target: 'logfile.entry', scope: 'home', name: '偏好', title: '服务面条目', at: stampOf, content: 'svc-entry-2' })
  assert.match(ed.note, /已订正 "## 服务面条目 /)
  assert.match(readFileSync(join(homeDir, '偏好.md'), 'utf8'), /svc-entry-2/)
  ed = svc.edit({ target: 'logfile.entry.delete', scope: 'home', name: '偏好', title: '服务面条目', at: stampOf })
  assert.match(ed.note, /已删除条目/)
  assert.doesNotMatch(readFileSync(join(homeDir, '偏好.md'), 'utf8'), /服务面条目|svc-entry-2/)
  assert.throws(() => svc.edit({ target: 'logfile.entry', scope: 'home', name: 'ghost-log', title: 't', at: '', content: 'x' }), /先 memory_creator 建壳/)
  ok('edit logfile:create/correct(delete)/缺失引导')

  const svcProj = svc.readLogfile('project', 'b-new', proj)
  assert.equal(svcProj.name, 'b-new')
  assert.equal(svcProj.type, 'project')
  assert.equal(svcProj.entries.length, 0)
  ok('readLogfile project 层(cwd 定位)')

  writeFileSync(join(userHome, 'MEMORY.md'), '')
  const emptyRootView = svc.readLayers(proj)
  assert.equal(emptyRootView.root.exists, true)
  assert.equal(emptyRootView.root.text, '')
  ok('readLayers:空 MEMORY.md exists=true,有无内容看 text(B2)')

  console.log('\nPASS: ' + passed + ' assertions')
} finally {
  rmSync(root, { recursive: true, force: true })
}
