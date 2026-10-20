# dsh-project-memory

DSH 本机跨对话项目记忆（Host bundle）。让每个 DSH 会话开局自动带上本项目的持久记忆，并给模型提供读写检索工具；与 Claude Code 记忆罗盘**共用同一套本机文件**，双向兼容。无云端、无遥测。

规格见 [`../project-memory/PRD.md`](../project-memory/PRD.md)（v0.3 Approved）。当前交付 **M1**（自动注入 + 记忆工具）、**M2**（会话结束全自动提取）、**STATUS.md 机制**（2026-10-17 合流）与 **0.2**（只读知识库面板，见下节）。

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
| `injectMaxChars` | number | 4000 | 注入索引的最大字符数。超长时**头尾双端保留**（STATUS 指针与末尾最新条目/主题组优先），中间省略并提示用 `memory_read` 细读——避免旧版"保头丢尾"把最新记忆截掉 |
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

**自动注入（US-1）**：`agent/created` 时按会话 cwd 定位记忆目录，存在 `MEMORY.md` 则以 user 消息（`source.kind = 'project-memory'`）注入索引+使用约定。每会话至多一次；子代理（`origin === 'subagent'` 或 `delegationDepth > 0`）、无 cwd、无记忆目录一律静默跳过；注入失败仅告警，不影响会话。

**工具（US-2/US-3）**，均以当前会话 cwd 定位项目，无 cwd 时明确报错：

| 工具 | 参数 | 行为 |
|---|---|---|
| `memory_read` | `topic?` | 读 `MEMORY.md` 索引；给 `topic` 则读对应主题文件全文 |
| `memory_write` | `topic`, `content`, `summary` | 写主题文件（新建自动加 `# topic` 头）并同步更新索引行（同 slug 幂等替换）。索引接近/超过载入上限（200 行或 25KB，对齐 Claude Code）时在结果中警告并要求精简（超限截断会让后半索引静默丢失）；主题文件已有 frontmatter 时自动刷新 `modified` 时间戳，无 frontmatter 不强加。空参数明确报错，fs 错误原样抛出 |
| `memory_search` | `query`, `limit?=50` | 跨主题文件大小写不敏感检索，返回 `文件:行号: 内容` |
| `memory_status_write` | `summary`, `stage?`, `milestones?[]`, `inProgress?[]`, `nextStart?`, `keyDecisions?[]`, `constraints?[]`, `source?` | 更新项目状态快照 `STATUS.md`（2026-10-17 STATUS 机制合流新增，详见下节）。`summary` 必填（≤160 字符，注入 MEMORY.md 首行）；未传字段沿用旧值，内容无变化不重写不滚动 |

**使用日志**：每次注入/读写向 `<journalDir>/<编码项目>.jsonl` 追加一行（`inject` / `read` / `write` / `search` / `status` / `extract` 事件，含时间戳与会话 id）。仅本机文件，最佳努力（写失败不影响主流程），供 30 天使用频率指标统计，无遥测。

**全自动提取（US-4，M2）**：会话空闲（`agent/status → idle` 持续 `extractIdleMs`）后经 `agent.followup()` 唤醒一轮"提取轮"（一条 `source.form = 'extract'` 的 user 消息，成为独立回合），模型回顾本场对话，分【结论路】【习惯路】【STATUS 路】三路提取（见下）；三路均无产出则不写任何东西。提取判断含负面清单（对齐 Claude Code 官方自动记忆）：能从代码、规格、文档直接推导的不写；CLAUDE.md / AGENTS.md 等指令文件已载明的不写。护栏：

- 每会话限 1 轮：内存占坑 + journal `extract/followup` 事件 durable 查重，宿主重启后不重复提取；
- 轮数闸：本进程观测到的对话轮数 < `extractMinTurns` 不布防（`agent/inbox/claimed` 的 turn 序号计）。缺省 1（2026-10-14 用户裁决：不漏优先——单轮对话有结论也要提取；无结论由提取轮自行判定，回复「无新增记忆」不落盘）；
- 子代理、无 cwd 会话一律跳过；`agent/running`（新输入）随时撤防重计时；
- 唤醒失败（如会话恰好释放）记 `extract/error` 事件并可重试，不影响会话；
- `agent/created` 也预布防：恢复的会话若无新活动，空闲后同样补提一轮。

**三路提取（结论 + 习惯 + STATUS）**：提取轮为「结论 + 用户习惯 + 项目状态」三路。【结论路】提取跨会话持久结论（用户裁决、部署事实、踩坑教训、验证过的收口），写入项目记忆主题文件；【习惯路】若对话暴露了用户的行为模式（下指令的固定风格、明确纠正过 AI 的行为、反复出现的操作序列偏好），追加写入独立的 `user-habits` 主题文件（与结论分文件；每条带日期、出现次数与来源，同模式更新不重复建条）。习惯条目只记录不执行——是否升格进 AGENTS.md 等指令文件由用户人工确认。【STATUS 路】（2026-10-17 合流新增，2026-10-16 拍板）若对话确实推进了项目状态，经 `memory_status_write` 更新七字段状态快照（当前阶段/最近里程碑/进行中事项/下次开工起点/关键技术决策≤5条/活跃约束 + 最近更新时间戳与来源）：本场没有新信息的字段不传（沿用旧值，从未有则标「待补」），纯问答不调用。关闭方式不变：`cordis.patch.yml` 设 `extractEnabled: false` 整轮关停（三路一并关闭）。

### STATUS.md 机制（2026-10-17 合流）

每个有记忆目录的 DSH 工作区在 `<memoryRoot>/<slug>/memory/STATUS.md` 维护一份七字段项目状态快照，`MEMORY.md` 第一行固定注入一行 `> 📌 STATUS：…` 摘要指针（开工一眼可见）。

- **枚举（交集语义）**：扫 `<memoryRoot>/*/memory/` 与 DSH 工作区注册表 `~/.dsh/storages/workspace.json` 的 path→slug 映射取交集——注册但无记忆目录、有记忆目录但未注册（死目录）都不生成；排除模式复用 WorkLog 日报规则（`AppData-Local-Temp`、`modlens`，slug 或原路径含任一即整体跳过）。
- **膨胀控制**：单字段 ≤500 字符；全文件 ≤2KB 且 ≤80 行（超限逐级收紧 300/160/80/40 后硬截，`truncated` 标志随工具结果返回）；里程碑 >10 条压一行指针（更早 N 条见历史版本）。
- **历史滚动**：写入前 diff 判重（剥离「最近更新」时间戳行只比七字段业务内容），无变化不重写不滚动；有变化按 `STATUS.md → STATUS.prev1.md → STATUS.prev2.md` 双级滚动。
- **并发与兜底**：原子写 `STATUS.md.tmp → rename`（Windows 目标已存在先清再移）；5 秒时间戳抢写保护（新鲜 `.tmp` 存在则本次 `skipped-locked`，陈旧残留不阻塞并清理）；写盘失败 rename 层自动重试一次。
- **标识**：`<!-- workspaceId: … -->` 用 DSH 注册表 id，注册表缺失/未注册时路径 SHA-256 前 16 位兜底；不依赖 taskboard ID。工作区归档/删除机制不感知、不清理。

已知限制：轮数按本进程观测计（`agent/inbox/claimed` 的 turn 序号），但缺省 `minTurns=1` 下恢复的会话在 `agent/created` 即满足轮数闸、空闲后照常提取，重启间隙不漏；若调大 `extractMinTurns`，重启后需再观测满该轮数新对话才布防。长空闲后提取轮会在会话里短暂活动一回合，属 PRD 决策 3 明确接受的体感（「不漏」优先）。

## 知识库面板（0.2，只读 Web 视图）

Web GUI 侧栏底部「知识库」入口：四分区只读视图——**全局记忆**（`_global/memory`）、**项目记忆**（按更新时间排序，冷项目折叠）、**本地知识源**（缺省探测 `~/.agents/skills` 与 `~/.dsh/docs`，存在才注册）、**知识域 · 预留**（置灰，M3）。顶栏全文检索跨分区返回命中行（高亮），点击进入 Markdown 阅读视图；全程无任何编辑入口。

- **架构**：host 直读磁盘（`lib/routes.js`），无第二索引、无同步、无写入端点；client 半（`src/client/` TSX）经 tsdown 构建为 `lib/client.js`，以 web shell 的 lazy-CJS 契约加载（`window.__ModuleLoader__.load`），官方插槽优先、宿主不支持时降级为侧栏 DOM 注入。
- **运行时零新依赖**：react/tsdown/typescript 全部是 devDependencies（构建期），client bundle 的 react 由宿主提供（external）。
- **HTTP API**（同源只读，envelope `{ok,value}` / `{ok,error:{code,message}}`）：

| 端点 | 说明 |
|---|---|
| `GET /dsh-project-memory/api/overview` | 分区概览（全局/项目列表含 mtime/源列表） |
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

覆盖：路径编码（纯 ASCII / 含中文实测案例 / 幂等）、目录解析（精确 / 模糊 / 无目录）、写入（新建/追加/索引幂等/参数校验/索引体量阈值/frontmatter modified 刷新与不强加）、检索、M2 提取状态机（空闲触发 / 每会话限 1 轮含 durable 查重 / 轮数闸 / 子代理与无 cwd 跳过 / running 撤防 / 失败重试 / 缺省 minTurns=1）、STATUS 机制（七字段渲染与待补 / created+MEMORY.md 注入 / unchanged 不重写 / prev 双级滚动 / 5 秒抢写 / 膨胀硬上限 / 注入幂等 / 枚举交集与排除 / workspaceId 兜底 / parse 往返 / 工具集注册）、知识库面板路由层（分区概览 / 清单与索引摘要映射 / SKILL frontmatter / 读文件路径穿越防护 / 跨分区检索 / envelope 与只读 405 / 404 兜底）。共 54 例。

## 卸载

见"兼容性与已知问题"最后一条。卸载后记忆文件不受影响（在 `memoryRoot` 下，与插件生命周期解耦）。
