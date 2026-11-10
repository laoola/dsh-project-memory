# dsh-project-memory

DSH 本机跨对话项目记忆（Host bundle）。让每个 DSH 会话开局自动带上本项目的持久记忆，并给模型提供读写检索工具；与 Claude Code 记忆罗盘**共用同一套本机文件**，双向兼容。无云端、无遥测。

规格见 [`../project-memory/PRD.md`](../project-memory/PRD.md)（v0.4 Approved）。当前交付 **M1**（自动注入 + 记忆工具）、**M2**（会话结束全自动提取）、**STATUS.md 机制**（2026-10-17 合流）、**0.2**（只读知识库面板）与 **0.3**（技能候选 / 命中统计 / 归档轨 / 全局工作习惯，见下）。

## 安装

```powershell
# 从 GitHub 发布（可分发化后）：
dsh plugin --profile web add dsh-project-memory
# 或本地源码开发安装（指向本仓库检出路径）：
dsh plugin --profile web add <本仓库检出路径>
```

验证：`dsh --profile web --dump-config` 输出中应出现 `id: project-memory`（仅证明进入合成树）；**激活成败以 `dsh web` 启动日志为准**——出现 `entries did not activate` 且列出本插件即为失败。安装后需重启 DSH 宿主生效。

## 配置（cordis.patch.yml 用户层可覆盖）

| 键 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `memoryRoot` | string | 探测式 | 记忆根目录。缺省：`~/.claude/projects` 存在则沿用（与 Claude Code 共库），否则 `~/.dsh/memory/projects` |
| `journalDir` | string | `~/.dsh/memory/journal` | JSONL 使用日志目录 |
| `injectMaxChars` | number | 4000 | 注入索引的最大字符数。超长时**头尾双端保留**（STATUS 指针与末尾最新条目/主题组优先），中间省略并提示用 `memory_read` 细读——避免旧版"保头丢尾"把最新记忆截掉。调参：调大可减少截断、利于稳定前缀缓存，但每会话注入成本随之上升；索引超载的根本治理是归档（`mode=archive`）与手工瘦身，三者互不替代 |
| `globalHabitsMaxChars` | number | 600 | 0.3 新增：全局工作习惯注入段的最大字符数（见「全局工作习惯」节）；`0` = 禁用该注入段。习惯文件超过 4×上限时 `memory_write(scope=global)` 结果会附精简提示 |
| `extractEnabled` | boolean | true | M2 全自动提取开关 |
| `extractIdleMs` | number | 180000 | 会话空闲多久后唤醒提取轮（毫秒） |
| `extractMinTurns` | number | 1 | 轮数闸：至少观测到几轮对话才布防提取（缺省 1 = 不因短会话漏；调大可省 token 但短会话可能漏） |
| `statusWorkspaceJson` | string | `~/.dsh/storages/workspace.json` | STATUS 枚举用的 DSH 工作区注册表路径（仅测试/特殊部署需覆盖） |
| `knowledgeSources` | Array<{id,label,description?,root}> | 探测式 | 知识库面板「本地知识源」分区（0.2）。缺省探测 `~/.agents/skills` 与 `~/.dsh/docs`，存在才注册；配置后完全覆盖缺省探测 |

本包不导出 Config schema（零宿主依赖），因此 `--dump-config-schema` 中本插件 `status: absent` 属预期。

## 记忆目录规则

- 项目 → 目录：`<memoryRoot>/<编码后的项目路径>/memory/`。编码规则与 Claude Code 一致：`:`、`\`、`/` → `-`；路径含非 ASCII 字符时，非 ASCII 字符逐个 → `-` 且盘符转小写（例：`D:\GC\ProjectFile\水印\DWMDataset` → `d--GC-ProjectFile----DWMDataset`）。
- 精确编码未命中时按"去符号转小写"模糊匹配一次（吸收盘符大小写、中文字符展开差异）；仍无则视为无记忆，静默跳过。
- 索引文件 `MEMORY.md`（每条一行摘要+链接），主题文件同目录 `.md`。与 Claude Code 双向读写同一格式。

## 行为

**自动注入（US-1）**：`agent/created` 时按会话 cwd 定位记忆目录，存在 `MEMORY.md` 则以 user 消息（`source.kind = 'project-memory'`）注入索引+使用约定。每会话至多一次；子代理（`origin === 'subagent'` 或 `delegationDepth > 0`）、无 cwd、无记忆目录一律静默跳过（旧布局告警除外，见下）；注入失败仅告警，不影响会话。

**旧布局迁移告警（2026-10-20）**：无 `memory/` 记忆目录、但 `<memoryRoot>/<slug>/` 根下存在旧版 `MEMORY.md`（Claude Code 旧版布局）时，注入一条迁移提示（每会话一次，`source.form = 'legacy'`），指引把文件移入同目录 `memory/` 子目录；移入后提示自动消失。

**工具（US-2/US-3）**，均以当前会话 cwd 定位项目，无 cwd 时明确报错：

| 工具 | 参数 | 行为 |
|---|---|---|
| `memory_read` | `topic?`, `scope?` | 读 `MEMORY.md` 索引；给 `topic` 则读主题文件全文并回写命中统计（frontmatter `hits`+1、`last-access`=今日；索引读、STATUS 快照、归档读、全局读均不计数，返回文本=回写前快照）。`topic` 形如 `archive/<主题>` 时读归档副本；`scope=global`（`topic` 固定 `user-habits`）读全局工作习惯 |
| `memory_write` | `topic`, `content?`, `summary?`, `mode?`, `target?`, `scope?`, `description?`, `triggers?` | **四通道**（0.3）：①普通（默认）——写主题文件（新建自动加 `# topic` 头）并同步索引行（同 slug 幂等替换）；已有 frontmatter 自动刷新 `modified`、无 frontmatter 不强加；索引接近/超过上限（200 行或 25KB）时警告并引导归档（`mode=archive`）；归档后同名再写=**允许重建**并提示存在归档历史。②`target=skill-candidate`——技能候选草稿（`description` 必填、`triggers` 可选触发词、`summary` 不适用；不入索引、永不自动注入）。③`scope=global`（`topic` 固定 `user-habits`）——写全局工作习惯。④`mode=archive`（仅 `topic`）——归档该主题（见「归档轨」节）。空参数/非法组合明确报错 |
| `memory_search` | `query`, `limit?=50` | 跨主题文件大小写不敏感检索，返回 `文件:行号: 内容`；0.3 起范围含 `archive/` 归档区（命中标 `[已归档]`），命中主题文件回写命中统计（归档与索引不计数） |
| `memory_status_write` | `summary`, `stage?`, `milestones?[]`, `inProgress?[]`, `nextStart?`, `keyDecisions?[]`, `constraints?[]`, `source?` | 更新项目状态快照 `STATUS.md`（2026-10-17 STATUS 机制合流新增，详见下节）。`summary` 必填（≤160 字符，注入 MEMORY.md 首行）；未传字段沿用旧值，内容无变化不重写不滚动 |

**使用日志**：每次注入/读写向 `<journalDir>/<编码项目>.jsonl` 追加一行（`inject`（含旧布局告警 `form: 'legacy'`）/ `read` / `write` / `search` / `status` / `extract` 事件，含时间戳与会话 id）。仅本机文件，最佳努力（写失败不影响主流程），供 30 天使用频率指标统计，无遥测。

**全自动提取（US-4，M2）**：会话空闲（`agent/status → idle` 持续 `extractIdleMs`）后经 `agent.followup()` 唤醒一轮"提取轮"（一条 `source.form = 'extract'` 的 user 消息，成为独立回合），模型回顾本场对话，分【结论路】【习惯路】【技能候选路】【STATUS 路】四路提取（0.3 由三路扩四路，见下）；四路均无产出则不写任何东西。提取判断含负面清单（对齐 Claude Code 官方自动记忆）：能从代码、规格、文档直接推导的不写；CLAUDE.md / AGENTS.md 等指令文件已载明的不写。护栏：

- 每会话限 1 轮：内存占坑 + journal `extract/followup` 事件 durable 查重，宿主重启后不重复提取；
- 轮数闸：本进程观测到的对话轮数 < `extractMinTurns` 不布防（`agent/inbox/claimed` 的 turn 序号计）。缺省 1（2026-10-14 用户裁决：不漏优先——单轮对话有结论也要提取；无结论由提取轮自行判定，回复「无新增记忆」不落盘）；
- 子代理、无 cwd 会话一律跳过；`agent/running`（新输入）随时撤防重计时；
- 唤醒失败（如会话恰好释放）记 `extract/error` 事件并可重试，不影响会话；
- `agent/created` 也预布防：恢复的会话若无新活动，空闲后同样补提一轮。

**四路提取（结论 + 习惯 + 技能候选 + STATUS）**：提取轮为「结论 + 用户习惯 + 技能候选 + 项目状态」四路。【结论路】提取跨会话持久结论（用户裁决、部署事实、踩坑教训、验证过的收口），写入项目记忆主题文件；【习惯路】若对话暴露了用户的行为模式（下指令的固定风格、明确纠正过 AI 的行为、反复出现的操作序列偏好），写入习惯文件，**双落点**（0.3）：只在该项目语境成立的 → 项目层 `user-habits` 主题；换一个项目也成立的通用工作习惯 → `scope=global` 全局库（注入所有项目会话，见「全局工作习惯」节）；拿不准优先项目层（宁保守不扩散）；每条带日期、出现次数与来源，同模式更新不重复建条。习惯只记录不执行——是否升格进 AGENTS.md 等指令文件由用户人工确认。【技能候选路】（0.3 新增）若存在「多次踩坑、难度大、后续大概率复用」的可复用操作经验，落盘技能候选草稿（见「技能候选」节）；三路素材互斥分流，写入前均先查重。【STATUS 路】（2026-10-17 合流新增，2026-10-16 拍板）若对话确实推进了项目状态，经 `memory_status_write` 更新七字段状态快照（当前阶段/最近里程碑/进行中事项/下次开工起点/关键技术决策≤5条/活跃约束 + 最近更新时间戳与来源）：本场没有新信息的字段不传（沿用旧值，从未有则标「待补」），纯问答不调用。关闭方式不变：`cordis.patch.yml` 设 `extractEnabled: false` 整轮关停（四路一并关闭）。

### 技能候选（0.3 P0-1）

提取轮发现可复用操作经验时，落 `memory/skill-candidates/<slug>.md` 草稿（`memory_write` 的 `target=skill-candidate` 通道；同 slug 重写保留首次 `created`，永不入 MEMORY.md 索引、永不自动注入）。frontmatter：`name` / `description`（触发词融入）/ `triggers` / `created` / `source` / `status: candidate`；正文为 SKILL.md 草稿，尾部附固定升格说明。

**人工升格（唯一生效路径，插件零代码依赖）**：候选只是草稿，不加载不执行。升格三步（文件尾部有同款说明）：① 在 `~/.agents/skills/<name>/` 新建 `SKILL.md`，保留 frontmatter 的 `name` 与 `description`；② 只复制候选正文，删除 `triggers`/`created`/`source`/`status` 等多余字段与升格说明节；③ 以技能加载器实际发现并可加载为准（`~/.agents/skills` 平铺布局，目录动态刷新无需重启）。

### 命中统计与归档轨（0.3 P0-2 / P0-3）

**命中统计**：`memory_read`（带 topic）与 `memory_search` 每命中一个主题文件，frontmatter 回写 `hits: N+1` 与 `last-access: 当日`；无 frontmatter 的文件此时新建 YAML 头（仅统计通道；`memory_write` 对无头文件仍不强加头）。排除项：索引读、STATUS 快照、`STATUS.prev*`、归档读、全局读、`memory` 主题。并发防覆盖：回写前重读，文件被并发改动则基于最新内容重放一次，仍在变则放弃本次计数；统计回写失败一律静默（不影响读取结果），原子写（tmp+rename）。`hits` = 访问次数 ≠ 记忆价值（提取轮查重搜索也计数）。

**归档轨**：`memory_write(topic=旧主题, mode=archive)`（仅接受 `topic`）——主题文件移入 `memory/archive/<slug>.md`（frontmatter 加 `archived` 日期）、MEMORY.md 摘除该行、源文件删除。分阶段失败恢复（宁可双份不可丢份）：复制 → 摘索引 → 删源，任一步失败保留双份并明确报错、可安全重试；阶段 2/3 失败自动恢复索引快照，不留「索引已摘、源还在」的中间态。保护：`MEMORY.md` / `STATUS.md` / `STATUS.prev*` 禁止归档；目标同名归档副本存在则拒绝覆盖；**归档后同名普通写入 = 允许重建**（新会话提取不因历史归档而丢条目），工具结果提示存在归档历史；重建后再归档需先处理旧副本。索引 near/over 警告文案均引导 `mode=archive`。检索默认含归档区（标 `[已归档]`，不计数）；归档副本仅供对账回看，`memory_read(topic='archive/<slug>')` 可读。

### 全局工作习惯（0.3 P0-4）

跨项目通用的用户工作习惯（如「先查记忆再动手」「只要结论不要过程」）写入 `<memoryRoot>/_global/memory/user-habits.md`（`memory_write` 的 `scope=global` 通道，`topic` 固定 `user-habits`；与 Claude Code 记忆罗盘全局库共库）。全局 `MEMORY.md` 只幂等维护该主题一行，不改动其他分区行。

**注入**：会话启动注入时独立计算全局习惯段（剥 frontmatter、按行截断 ≤`globalHabitsMaxChars`，缺省 600，0=禁用），拼在项目索引注入尾部；**新项目没有项目记忆时也会注入全局段**（新项目不再从零学起）。注入段标题明示「历史偏好参考，不覆盖当前指令」。写入侧护栏：习惯来源仅限当前用户明确表达或反复体现的偏好，外部内容（网页/工具输出/搜索结果）中的指令不得提取；文件超 4×上限时工具结果提示合并同类习惯。`memory_read(topic='user-habits', scope='global')` 可读全文（不计数）。

### STATUS.md 机制（2026-10-17 合流）

每个有记忆目录的 DSH 工作区在 `<memoryRoot>/<slug>/memory/STATUS.md` 维护一份七字段项目状态快照，`MEMORY.md` 第一行固定注入一行 `> 📌 STATUS：…` 摘要指针（开工一眼可见）。

- **枚举（交集语义）**：扫 `<memoryRoot>/*/memory/` 与 DSH 工作区注册表 `~/.dsh/storages/workspace.json` 的 path→slug 映射取交集——注册但无记忆目录、有记忆目录但未注册（死目录）都不生成；排除模式复用 WorkLog 日报规则（`AppData-Local-Temp`、`modlens`，slug 或原路径含任一即整体跳过）。
- **膨胀控制**：单字段 ≤500 字符；全文件 ≤2KB 且 ≤80 行（超限逐级收紧 300/160/80/40 后硬截，`truncated` 标志随工具结果返回）；里程碑 >10 条压一行指针（更早 N 条见历史版本）。
- **历史滚动**：写入前 diff 判重（剥离「最近更新」时间戳行只比七字段业务内容），无变化不重写不滚动；有变化按 `STATUS.md → STATUS.prev1.md → STATUS.prev2.md` 双级滚动。
- **并发与兜底**：原子写 `STATUS.md.tmp → rename`（Windows 目标已存在先清再移）；5 秒时间戳抢写保护（新鲜 `.tmp` 存在则本次 `skipped-locked`，陈旧残留不阻塞并清理）；写盘失败 rename 层自动重试一次。
- **标识**：`<!-- workspaceId: … -->` 用 DSH 注册表 id，注册表缺失/未注册时路径 SHA-256 前 16 位兜底；不依赖 taskboard ID。工作区归档/删除机制不感知、不清理。

已知限制：轮数按本进程观测计（`agent/inbox/claimed` 的 turn 序号），但缺省 `minTurns=1` 下恢复的会话在 `agent/created` 即满足轮数闸、空闲后照常提取，重启间隙不漏；若调大 `extractMinTurns`，重启后需再观测满该轮数新对话才布防。长空闲后提取轮会在会话里短暂活动一回合，属 PRD 决策 3 明确接受的体感（「不漏」优先）。

## 知识库面板（0.2，只读 Web 视图）

Web GUI 侧栏底部「知识库」入口：四分区只读视图——**全局记忆**（`_global/memory`）、**项目记忆**（按更新时间排序，冷项目折叠）、**本地知识源**（缺省探测 `~/.agents/skills` 与 `~/.dsh/docs`，存在才注册）、**知识域 · 预留**（置灰，M3）。顶栏全文检索跨分区返回命中行（高亮），点击进入 Markdown 阅读视图；全程无任何编辑入口。项目行若在 `~/.claude.json` 有真实路径记录，面板会探测该目录是否仍存在（`pathExists`），已删除的项目显示 ⚠ 标注（2026-10-20 废弃项目标注）；`~/.claude.json` 的正斜杠键与存量目录的盘符大小写漂移（如 `D:/GC/Code/DWM` vs `d--GC-Code-DWM`）按模糊键回退匹配，精确编码优先。

- **架构**：host 直读磁盘（`lib/routes.js`），无第二索引、无同步、无写入端点；client 半（`src/client/` TSX）经 tsdown 构建为 `lib/client.js`，以 web shell 的 lazy-CJS 契约加载（`window.__ModuleLoader__.load`），官方插槽优先、宿主不支持时降级为侧栏 DOM 注入。
- **运行时零新依赖**：react/tsdown/typescript 全部是 devDependencies（构建期），client bundle 的 react 由宿主提供（external）。
- **HTTP API**（同源只读，envelope `{ok,value}` / `{ok,error:{code,message}}`）：

| 端点 | 说明 |
|---|---|
| `GET /dsh-project-memory/api/overview` | 分区概览（全局/项目列表含 mtime、`pathExists` 废弃标注/源列表） |
| `GET /dsh-project-memory/api/list?section=<id>` | 分区文件清单（标题+一行摘要；分区 id：`global` / `p:<编码目录>` / `s:<源id>`） |
| `GET /dsh-project-memory/api/file?path=<abs>` | 读单个 `.md`（路径防护：仅记忆根与已配置知识源根下，穿越返回 `path_denied`） |
| `GET /dsh-project-memory/api/search?q=<query>` | 跨分区命中行（大小写不敏感，每文件至多 3 条，上限 2000 文件/300 行） |

- **构建**（仅改 client 源码后需要）：

```powershell
pnpm install   # 安装 devDependencies
pnpm run build # tsdown → lib/client.js（产物随包分发）
```

## 兼容性与已知问题（实测环境 dsh 0.2.0-rc.2 / Node 24 / Windows）

- host 侧零依赖、无构建；client 侧为 TS+React 构建件（`lib/client.js` 随包分发，react 由宿主提供）。宿主注入点（`agent/created`、`agent.inject`、`ctx.tools.register`、`ctx.webServer.register`、client 模块表契约）变更时需适配，peer 约束记录于 PRD 第 7 节。
- `dsh --profile web --dump-config-schema` 在本机 exit=1，报错段为 `/197 dsh-at-file`（"no export named 'settingsNamespace'"）。已验证移除本插件后报错依旧——系 profile 既有依赖错配，与本品无关。
- 卸载命令 `dsh plugin --profile web remove project-memory` 在 pnpm v12.5.1 下可能因 `link:` 依赖报 `pnpm remove` 失败（诊断日志在 `~/.dsh/profiles/web/.plugin-manager/logs/`）。替代：直接编辑 `~/.dsh/profiles/web/package.json` 删除 `dsh-project-memory` 依赖行后运行 `pnpm install`，或等 dsh 工具链修复。

## 测试

```powershell
pnpm test   # node --test test/*.test.mjs
```

覆盖：路径编码（纯 ASCII / 含中文实测案例 / 幂等）、目录解析（精确 / 模糊 / 无目录 / 旧布局探测）、写入（新建/追加/索引幂等/参数校验/索引体量阈值/frontmatter modified 刷新与不强加/upsertFrontmatterFields 单元）、技能候选（frontmatter 全字段/永不入索引/同 slug 重写保留首次 created/description 必填与路径拒绝）、归档轨（移动+archived 头+索引摘行/禁归档清单/重名拒绝/源缺失/**hooks 故障注入的分阶段失败恢复与索引快照回滚**）、命中统计（无头文件新建头/递加/排除项/**_between 并发防覆盖重放**）、检索（含归档区前缀与 `[已归档]` 标记）、全局习惯（固定文件/全局索引幂等一行/chars 返回）、M2 提取状态机（空闲触发 / 每会话限 1 轮含 durable 查重 / 轮数闸 / 子代理与无 cwd 跳过 / running 撤防 / 失败重试 / 缺省 minTurns=1 / **四路提示词与技能候选路、习惯双落点文案**）、STATUS 机制（七字段渲染与待补 / created+MEMORY.md 注入 / unchanged 不重写 / prev 双级滚动 / 5 秒抢写 / 膨胀硬上限 / 注入幂等 / 枚举交集与排除 / workspaceId 兜底 / parse 往返 / 工具集注册）、**工具参数矩阵（四通道组合校验/归档后同名重建提示/读分支计数/global 与 archive 读）**、**注入编排（renderGlobalHabitsSection 截断与 0 预算/buildSessionInjection 的 global-only 与 recall 拼尾）**、知识库面板路由层（分区概览 / 清单与索引摘要映射 / SKILL frontmatter / 读文件路径穿越防护 / 跨分区检索 / envelope 与只读 405 / 404 兜底 / 废弃项目 `pathExists` 标注）、健壮性（注入截断头尾双端保留 / 旧布局迁移提示文案 / 索引超限归档引导文案）。共 80 例。

## 卸载

见"兼容性与已知问题"最后一条。卸载后记忆文件不受影响（在 `memoryRoot` 下，与插件生命周期解耦）。
