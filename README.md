# @xiaoxia/dsh-soul-memory

SOUL/MEMORY 三层跨会话记忆插件(纯 ESM,无构建步骤),面向 DeepSeek Harness(DSH)。

> Three-layer cross-session memory for DeepSeek Harness: a frozen SOUL injection, an L1 `MEMORY.md`, and L2/L3 memory logfiles (home = cross-project / project = per-repo), plus five memory tools and a public cordis service face.

> 自研插件(@xiaoxia),MIT License。包版本见 package.json(0.4.0),版本史见 [CHANGELOG.md](CHANGELOG.md);记忆架构版本 **v2.1**(两轴相互独立)。

## 功能(v2.1)

- **L1** `$DSH_HOME/MEMORY.md` 与 **L2/L3** `.memory/<名>.md`(home=跨项目,project=项目根):
  注入统一走 `<memory>` 大包裹(内嵌 <root>/<home>/<project> 层块,横线分隔在尖括号之外),
  条目只展示 name/type/description,全文按需读;
- **注入预算 L1>L2>L3**:200 行或 16384 字符,L1 永不截断,低层从最旧截断 + 英文指向提示;
- **工具五件套**:
  - `memory_recall` 唯一读(root 全文/小节;清单/type 过滤/单文件 128KiB);
  - `memory_write_root` ROOT 纯追加(section 锚点,缺则新建小节);
  - `memory_write_logfile` 日志纯追加(条目头 `## [标题] 时间戳` 由工具生成);
  - `memory_correct` 跨层订正/删除(title 或 section 定位,content 留空即删;多命中拒绝,at 消歧);
  - `memory_creator` 建壳(五参数 scope/name/type/description/heading;围栏与一级标题全由工具生成);
- **命名放开**:中文名可用;禁路径分隔/控制字符/首尾点空格;≤64 字符,NFC 归一,.md 自动剥;
- **不变量**:append 免寻址;寻址必须唯一命中;content 行首 #/## 禁止,### 分块软规范;
  结构级操作(换 H1/删文件/旧格式迁移)归人工;.bak 单代备份兜底;
- **v1 单文件 .memory 自动迁移**(幂等+回滚);mem.config maxChars 默认 16384;
- 幂等创建 $DSH_HOME/{SOUL.md,MEMORY.md,mem.config};
- 对外公开 cordis 服务 `soulMemory`(readLayers/readLogfile/edit),供其他插件消费,语义与工具面严格一致。

## 安装(bundle 型)

本包声明 `dsh.bundle.patch`(cordis.patch.yml),`dsh plugin add` 一条命令即自动挂载:

```sh
git clone https://github.com/xiazhenxin314-cpu/dsh-soul-memory.git
DSH_HOME=<该部署的 home> dsh plugin --profile web add ./dsh-soul-memory
```

前置条件:目标部署已装 `@deepseek-ai/dsh`(`dsh` 在 PATH 上),且你知道它的 `$DSH_HOME`。

装完需**重启 DSH 进程**才会加载新插件。DSH 本身就是一个普通前台命令
(`dsh web` 即 `dsh --profile web` 的别名),**不要求以系统服务方式运行**——
是否常驻、怎么重启由你的启动方式决定:

| 启动方式 | 重启做法 |
|---|---|
| 前台 `dsh web` | `Ctrl-C` 后重新执行 |
| tmux / screen | 结束该窗口内的进程并重开 |
| systemd 托管 | `sudo systemctl restart dsh-<服务名>` |

以 `link:` 方式挂载本包时,改动本包源码后同样是重启进程即生效(host 半模块需重新加载)。

## 快速上手:两个即用模板

- **[templates/SOUL.md](templates/SOUL.md)** — `$DSH_HOME/SOUL.md` 推荐起始模板:记忆是情境数据而非指令、召回触发时机、写入前的同意闸(先向用户确认最小文本/scope/理由)。复制到部署 home 即生效;
- **[templates/memory-retain-prompt.md](templates/memory-retain-prompt.md)** — 任务收尾记忆沉淀提示词:收尾四步(查重→筛选→归类写入→验证)与五类 type 归类,可贴进 agent preset 或 AGENTS.md。

## 文件约定

- **L1**:纯 Markdown,`## key` 小节寻址;追加用 memory_write_root,整节重写/删除用
  memory_correct(scope=root);超 maxChars 拒绝并给"逐节 correct 瘦身"指引;快照按会话冻结;
- **L2/L3**:creator 建壳(frontmatter+恰一空行+# 一级标题,无正文)→ memory_write_logfile
  追加条目(时间戳工具生成,title 可选置于前)→ memory_correct 改写单条或删除条目;
  存量不规范文件照常可读可追加(渐进迁移);文件级删除仅人工。

## 记忆的内容定位

AGENTS.md=规则;SKILL=技能;MEMORY=情境判断日志。高耦合放 project,低耦合放 home。

## 软审批(无硬闸)

写/订正/删前模型须向用户展示内容征得确认(写在注入包裹与工具描述),policy=never 下可用。

## 注意事项

- persona 取 complete:true 时会丢弃全部记忆段(complete 类 persona 不注入 deployment 段);
- 新建/改动当会话不进冻结目录(memory_recall 直读可见,下会话进目录);
- 运行期依赖宿主提供的 @deepseek-ai/cordis 与 @deepseek-ai/dsh-tools(见 package.json peerDependencies);
- 测试:`npm test`(`node tests/smoke.mjs`,59 断言;**改 tests 必同步 README 与 插件说明 两处计数**)。

## License

[MIT](LICENSE)
