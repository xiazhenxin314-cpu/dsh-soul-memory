# ALPHA_0.5 — dsh-soul-memory 纯代码库 taste 整理

- **日期**:2026-09-13
- **性质**:纯代码 Taste 整理(检视 → 计划 → 修改),**零运行时行为变化**;不是功能开发,不授予挂载/重启/生产实验权限。
- **对象**:`@xiaoxia/dsh-soul-memory` 0.4.1(独立 git 仓,零构建:源码直挂 `lib/*.mjs` + 根 `soul-memory.mjs`)。
- **基线**:`git rev-parse HEAD` = `2c7e9352fc7284209a71e4325d5b7b1e01638869`,工作树干净(`git status --short` 空)。
- **门禁数字(改动前)**:`node tests/smoke.mjs`(package.json `test` 脚本同款,node v22.23.1)→ **PASS: 59 assertions,exit 0**。
- **行数基线(wc -l)**:soul-memory.mjs 668 / lib/logfile.mjs 323 / tests/smoke.mjs 564 / lib/soul-service.mjs 166 / lib/budget.mjs 78 / lib/migrate.mjs 54。

---

## §1 检视发现(逐条含证据)

### F1(超上限,必须处理)soul-memory.mjs 668 行 > 500 上限
四种关注点混居一个文件:中文报错语料(L64-94)、L1 root 小节寻址纯函数(L100-160)、发现/渲染/读路由(L162-266)、root+logfile 写操作(L268-423)、插件主体 apply(五工具注册,L440-668)。超上限 168 行;按目标 ≤300 需拆出写面/视图面/语料。

### F2(文件内重复)readTextSafe 与 apply() 内 readText 逐字重复;writeText 为单点别名
- `soul-memory.mjs:100-102` 的 `readTextSafe` 与 `soul-memory.mjs:447-449` apply() 内 `readText` 实现逐字相同(try/existsSync/readFileSync 兜底空串)。
- `soul-memory.mjs:450` `const writeText = (path, content) => writeTextAtomic(path, content)` 是单点透传别名(仅初始文件三连写使用),属单次使用抽象。

### F3(三处重复)home/project 目录解析三元式
`soul-memory.mjs:594`(memory_write_logfile)、`:626`(memory_correct home/project 分支)、`:649`(memory_creator)三处逐字重复:
`scope === "home" ? join(dshHome, ".memory") : join(findProjectRootSync(cwdForProject(exec)), ".memory")`。

### F4(两两重复)scope 归一表达式
- memory_recall(`:553`)与 memory_correct(`:617`):`typeof args.scope === "string" && ["root","home","project"].includes(args.scope) ? args.scope : "root"` ×2。
- memory_write_logfile(`:593`)与 memory_creator(`:648`):`args.scope === "home" ? "home" : "project"` ×2。

### F5(可读性)BSN = String.fromCharCode(10)
`soul-memory.mjs:87` 用 `String.fromCharCode(10)` 隐写换行并命名 `BSN`,同文件其余处全部直接写 `'\n'` 字面量(如 `:108 text.split('\n')`)。`BSN === '\n'`,还原为字面量零行为差。

### F6(两处重复)logfile 原文读取 + 缺失教学报错
`soul-memory.mjs:324-328`(appendLogfile)与 `:349-353`(correctLogfile)逐字重复:`try { raw = readFileSync(path,'utf8') } catch { throw new Error(logfileMissing(nm, dir)) }`。

### F7(关注点混居)报错语料与使用方同文件,且两条写路径共享条目
MSG(L64-72)、overLimitMessage(L84-86)、illegalTypeMessage/missingDescriptionMessage(L89-90)与 root 写、logfile 写同文件;其中 `needContent`/`correctBan` 被 root 与 logfile 两条写路径共享——拆文件时语料需独立成模块,否则两条写路径互相依赖。

### F8(死代码候选 → 待定)lib/logfile.mjs `timestampHeading` 全仓零引用
`lib/logfile.mjs:189-191`,自注"兼容旧导出"。`grep -rn timestampHeading` 仅此一处。**不改**:零构建包外部消费方理论上可深导入 `lib/logfile.mjs`,"无深导入"不可证伪,删除导出违背"不改公开导出面"的保守口径。

### F9(死字段候选 → 待定)discoverMemoryLayers 返回的 `rootPath` 全仓零消费
`soul-memory.mjs:181`。仓内 recallMemory/apply/soul-service 只读 projectRoot/rootText/homeDir/homeEntries/projDir/projEntries/migration。**不改**:删除字段即对象形状变化,违反零运行时行为变化硬约束。

### F10 lib/=源码 目录约定专项评估(结论:不移动)
- **事实**:CHANGELOG.md:58 明载「`lib/` 明确为 ESM 源码入库(非构建产物)」;`git ls-files lib/` 四文件全追踪;package.json `main: soul-memory.mjs`;cordis.patch.yml 只 `insert` 包名 `@xiaoxia/dsh-soul-memory`,**不引用任何 lib 文件路径**;插件说明.md 挂载四要素与该布局一致。
- **评估**:lib/→src/ 改名需同步 cordis.patch.yml 挂载认知与外部文档/深导入心智,对零构建小仓零行为收益、纯挂载面风险 → **判「不移动」,维持 lib/=源码**。在 lib/ 下**新增**内部模块不改变挂载引用路径集合(patch 认包名,main 入口不变,lib 子文件本来就是内部 import)。

### F11(待定)tests/smoke.mjs 564 行 > 300 目标
线性场景冒烟脚本,package.json `test` 唯一入口。拆分需引入 runner 转发或改测试入口,动验证门禁的收益/风险比差;单文件上限口径按源码模块执行。**不改**。

### F12(微,可改)soul-service.mjs `fail` 单点中转
`lib/soul-service.mjs:66` `const fail = (error) => { throw error }` 全文件仅 `:160` 一处使用,单次使用抽象 → 内联为 `throw new Error(created.error)`。

### F13(陈旧注释,可改)soul-memory.mjs 文件头「工具面三件套」与现实不符
`soul-memory.mjs:9-10` 称三件套(memory_recall/memory_write/memory_creator),实际 v0.4 为五件套(memory_write 吞并拆分为 memory_write_root/memory_write_logfile + memory_correct),package.json description 与插件说明.md 均按五件套口径。注释订正零行为差。

### F14(不做)引号风格单双混用
写函数簇历史形成 `'...'`/`"..."` 混用;统一属纯格式 diff,噪声大于收益,不做。

### 检视通过项
lib/budget.mjs(78 行,单一职责)、lib/migrate.mjs(54 行,含回滚,幂等语义清晰)、lib/soul-service.mjs(166 行,DI 避免循环 import,契约注释完整)——无问题;模块间无 value-import 他人实现、无环(logfile ← migrate/soul-service;新增拆分保持无环)。

---

## §2 原子任务计划表

| ID | 任务 | taste 目标 | 改动文件 | 验证 |
|---|---|---|---|---|
| T1 | 新建 `lib/messages.mjs`:迁入 MSG/overLimitMessage/illegalTypeMessage/missingDescriptionMessage,**文案逐字不动** | F7 关注点分离 | lib/messages.mjs(新) | 冒烟 59 PASS |
| T2 | `readTextSafe` 迁入 `lib/logfile.mjs`(与 writeTextAtomic 同居,补 existsSync import) | F2 去重 | lib/logfile.mjs | 冒烟 59 PASS |
| T3 | 新建 `lib/root-memory.mjs`:迁入 L1 小节寻址(findSection/sectionBody/collapse/removeSection/replaceSection/appendContent/listSectionKeys)+ assertSectionKey + DEFAULT_MAX_CHARS + appendRootMemory/correctRootMemory;BSN→`'\n'` | F1/F5 | lib/root-memory.mjs(新) | 冒烟 59 PASS |
| T4 | 新建 `lib/logfile-write.mjs`:迁入 logfileMissing/appendLogfile/correctLogfile/createLogfile;读原文+缺失报错抽本地 `readRawOrMissing`;BSN→`'\n'` | F1/F5/F6 | lib/logfile-write.mjs(新) | 冒烟 59 PASS |
| T5 | 新建 `lib/memory-view.mjs`:迁入注入文案常量 + migrationMemo/migrateOnce + discoverMemoryLayers + renderMemoryBlock + recallMemory | F1 关注点分离 | lib/memory-view.mjs(新) | 冒烟 59 PASS |
| T6 | 重写 `soul-memory.mjs` 为插件主体(name/inject/cwdForProject/apply);**re-export 保持 15 个公开导出面逐一不变**;apply 内去重 F2/F3/F4(readText→readTextSafe、writeText→writeTextAtomic 直呼、dirForScope/scopeOf/homeOrProject 三小助手);文件头补模块布局与五件套订正 | F1/F2/F3/F4/F13 | soul-memory.mjs | 冒烟 59 PASS + 导出面比对 |
| T7 | 插件说明.md 非挂载区的模块清单行同步新布局(**挂载四要素不动**) | 文档真实性 | 插件说明.md | 人工比对 |
| T8 | 改后跑 `node tests/smoke.mjs`,记录退出码与数字并与基线对照 | 门禁 | — | 59 PASS / exit 0 |
| T9 | 回填本文 §3/§4/§5 | 可追溯 | doc/本文档 | — |

**红线**:不改任何错误文案、工具 description/parameters、渲染拼装逻辑、memo Map 语义、`cordis.patch.yml`、package.json、挂载四要素;不执行 git commit。

---

## §3 修改明细(每处可追溯到 §1/§2)

| # | 文件 | 类型 | 行数(前→后) | 内容与理由 |
|---|---|---|---|---|
| 1 | `lib/messages.mjs` | 新建 | — →29 | T1/F7:中文报错语料集中(MSG 七条 + overLimitMessage + illegalTypeMessage + missingDescriptionMessage),纯文本零依赖,root/logfile 两条写路径的共享条目有了唯一定义点;**文案逐字未动**。 |
| 2 | `lib/logfile.mjs` | 修改 | 323→332(+9) | T2/F2:`readTextSafe` 迁入,与 `writeTextAtomic` 同居为"读侧孪生";补 existsSync import。既有导出全部保留(含 F8 的 timestampHeading,见 §5)。 |
| 3 | `lib/root-memory.mjs` | 新建 | — →131 | T3/F1+F5:L1 MEMORY.md 小节寻址(findSection/sectionBody/collapse/removeSection/replaceSection/appendContent/listSectionKeys)+ assertSectionKey + DEFAULT_MAX_CHARS + appendRootMemory/correctRootMemory 整体迁出;`BSN`→`'\n'` 字面量(值相等)。 |
| 4 | `lib/logfile-write.mjs` | 新建 | — →137 | T4/F1+F5+F6:logfileMissing + appendLogfile/correctLogfile/createLogfile 迁出;"读原文失败抛 logfileMissing"两处逐字重复收拢为本地 `readRawOrMissing`(同一报错构造);`BSN`→`'\n'`。 |
| 5 | `lib/memory-view.mjs` | 新建 | — →140 | T5/F1:注入文案常量(MEM_HEADER 等 7 个)+ migrationMemo/migrateOnce(Map 随迁,进程内单例语义不变)+ discoverMemoryLayers + renderMemoryBlock + recallMemory 迁出,视图/发现/读路由单模块。 |
| 6 | `soul-memory.mjs` | 重写 | 668→323 | T6:只留插件主体(name/inject/cwdForProject/apply)。**15 个公开导出面逐一保留**(import + `export {}` 复述,排序比对一致);apply 内去重:本地 `readText`(与 readTextSafe 逐字重复)→readTextSafe、`writeText` 单点别名→writeTextAtomic 直呼(F2),新增 `scopeOf`/`homeOrProject`/`dirForScope` 三小助手消 F3 三处、F4 两两重复;文件头补模块布局说明并订正"三件套"→五件套(F13)。 |
| 7 | `lib/soul-service.mjs` | 修改 | 166→165 | T12/F12:单点中转 `fail` 内联为 `throw new Error(created.error)`,行为相同。 |
| 8 | `插件说明.md` | 修改 | — | T7:「开发与测试」节模块清单行同步新布局;**挂载四要素(类型/来源/目标 profile/安装命令)一字未动**;README/CHANGELOG 不涉及模块布局,未动。 |

**未触碰**:`cordis.patch.yml`、package.json、tests/smoke.mjs、lib/budget.mjs、lib/migrate.mjs、templates/、README.md、CHANGELOG.md、LICENSE、.memory/(git status 佐证)。

---

## §4 验证记录

| 步骤 | 命令 | 结果 |
|---|---|---|
| 基线 | `node tests/smoke.mjs`(= npm test,node v22.23.1) | **PASS: 59 assertions,EXIT=0** |
| 拆分中 | 同上 | **EXIT=1**(SyntaxError: Export 'assertSectionKey' is not defined——T6 漏 import 该再导出符号,**接线疏漏非原有缺陷**;补 import 后即绿) |
| 改后① | 同上 | **PASS: 59 assertions,EXIT=0** |
| 导出面比对 | `Object.keys(await import('./soul-memory.mjs'))` 排序 vs `git show HEAD:soul-memory.mjs` 静态提取 | 15 个导出名**逐一相同** |
| 全模块加载 | 9 个 .mjs 逐一 `import()` | 全部 OK,无环、无未定义引用 |
| 改后②(终) | `node tests/smoke.mjs` | **PASS: 59 assertions,EXIT=0** |
| 行数对照 | `wc -l` | soul-memory 668→**323**;新增 messages 29 / root-memory 131 / logfile-write 137 / memory-view 140;logfile 323→332;soul-service 166→165;budget 78、migrate 54、tests 564 不变。全部源码 ≤500 上限 |
| 挂载面 | `git status`/`git diff --stat` | cordis.patch.yml、package.json 零改动;lib/ 入口文件路径集合未变(仅新增内部模块);**未执行任何 git commit** |

---

## §5 明确不做 / 待定

| 项 | 处置 | 理由 |
|---|---|---|
| lib/→src/ 目录改名 | **不做**(F10 结论) | 本仓零构建、CHANGELOG 明载 lib/=源码入库;patch 只认包名,改名纯增挂载面认知成本,收益为负。维持 lib/,新增内部模块不触碰挂载引用路径集合。 |
| `timestampHeading`(logfile.mjs,全仓零引用) | 待定(F8) | 自注"兼容旧导出";零构建包外部深导入不可证伪,删导出涉公开面,留给功能批次决策。 |
| `discoverMemoryLayers` 返回的 `rootPath` 死字段 | 待定(F9) | 全仓零消费,但删除即对象形状变化,违反零运行时行为变化硬约束。 |
| tests/smoke.mjs 564 行 | 不拆(F11) | 线性场景脚本+唯一 test 入口;拆分要动验证门禁结构,收益/风险比差;单文件口径按源码模块执行。 |
| 引号单双混用 | 不做(F14) | 纯格式 diff,噪声大于收益。 |
| 尾部空白修剪 `/\s+$/` 四处微重复 | 不做 | root/logfile 两模块分居,为 1 行正则抽跨模块助手,连线成本>收益。 |
| recallMemory 的"logfile 不存在"文案 vs `logfileMissing` | 不合并 | 相近但**非逐字**(层措辞/路径展示不同),合并必改错误文本,踩红线。 |
| soul-memory.mjs 323 / logfile.mjs 332(>300 目标,<500 上限) | 不再拆 | 各自单一关注点已成立,继续切分边际收益低。 |


## §6 审查订正记录（2026-09-13，独立审查后）

独立审查（代码审查报告/代码审查_20260913_ALPHA_0.5.md）结论：**通过**（零 F 级；3 个高风险迁移点全部复证：BSN=\n 值相等、readRawOrMissing 两处 HEAD 逐字相同、迁移 memo 均为模块级单例语义等价）。处置：P1（文件头「原样」表述与本轮 logfile/soul-service 实改矛盾）已订正 soul-memory.mjs 文件头一行；P2（logfile.mjs 深导入面 +readTextSafe）、P3（写盘处 join 重算）登记备查。
