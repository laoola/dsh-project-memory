# dsh-project-memory

DSH 本机跨对话项目记忆（Host bundle）。让每个 DSH 会话开局自动带上本项目的持久记忆，并给模型提供读写检索工具；与 Claude Code 记忆罗盘**共用同一套本机文件**，双向兼容。无云端、无遥测。

规格见 [`../project-memory/PRD.md`](../project-memory/PRD.md)（v0.2 Approved）。当前交付 **M1**（自动注入 + 三工具）与 **M2**（会话结束全自动提取）。

## 安装

```powershell
dsh plugin --profile web add D:\GitCode\dshplugin\project-memory
```

验证：`dsh --profile web --dump-config` 输出中应出现 `id: project-memory`（仅证明进入合成树）；**激活成败以 `dsh web` 启动日志为准**——出现 `entries did not activate` 且列出本插件即为失败。安装后需重启 DSH 宿主生效。

## 配置（cordis.patch.yml 用户层可覆盖）

| 键 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `memoryRoot` | string | 探测式 | 记忆根目录。缺省：`~/.claude/projects` 存在则沿用（与 Claude Code 共库），否则 `~/.dsh/memory/projects` |
| `journalDir` | string | `~/.dsh/memory/journal` | JSONL 使用日志目录 |
| `injectMaxChars` | number | 4000 | 注入索引的最大字符数，超长截断并提示用工具细读 |
| `extractEnabled` | boolean | true | M2 全自动提取开关 |
| `extractIdleMs` | number | 180000 | 会话空闲多久后唤醒提取轮（毫秒） |
| `extractMinTurns` | number | 1 | 轮数闸：至少观测到几轮对话才布防提取（缺省 1 = 不因短会话漏；调大可省 token 但短会话可能漏） |

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

**使用日志**：每次注入/读写向 `<journalDir>/<编码项目>.jsonl` 追加一行（`inject` / `read` / `write` / `search` / `extract` 事件，含时间戳与会话 id）。仅本机文件，最佳努力（写失败不影响主流程），供 30 天使用频率指标统计，无遥测。

**全自动提取（US-4，M2）**：会话空闲（`agent/status → idle` 持续 `extractIdleMs`）后经 `agent.followup()` 唤醒一轮"提取轮"（一条 `source.form = 'extract'` 的 user 消息，成为独立回合），模型回顾本场对话，分【结论路】与【习惯路】双路提取（见下）；两路均无产出则不写任何东西。提取判断含负面清单（对齐 Claude Code 官方自动记忆）：能从代码、规格、文档直接推导的不写；CLAUDE.md / AGENTS.md 等指令文件已载明的不写。护栏：

- 每会话限 1 轮：内存占坑 + journal `extract/followup` 事件 durable 查重，宿主重启后不重复提取；
- 轮数闸：本进程观测到的对话轮数 < `extractMinTurns` 不布防（`agent/inbox/claimed` 的 turn 序号计）。缺省 1（2026-10-14 用户裁决：不漏优先——单轮对话有结论也要提取；无结论由提取轮自行判定，回复「无新增记忆」不落盘）；
- 子代理、无 cwd 会话一律跳过；`agent/running`（新输入）随时撤防重计时；
- 唤醒失败（如会话恰好释放）记 `extract/error` 事件并可重试，不影响会话；
- `agent/created` 也预布防：恢复的会话若无新活动，空闲后同样补提一轮。

**双路提取（结论 + 习惯）**：提取轮为「结论 + 用户习惯」双路。【结论路】提取跨会话持久结论（用户裁决、部署事实、踩坑教训、验证过的收口），写入项目记忆主题文件；【习惯路】若对话暴露了用户的行为模式（下指令的固定风格、明确纠正过 AI 的行为、反复出现的操作序列偏好），追加写入独立的 `user-habits` 主题文件（与结论分文件；每条带日期、出现次数与来源，同模式更新不重复建条）。习惯条目只记录不执行——是否升格进 AGENTS.md 等指令文件由用户人工确认。关闭方式不变：`cordis.patch.yml` 设 `extractEnabled: false` 整轮关停（结论路与习惯路一并关闭）。

已知限制：轮数按本进程观测计（`agent/inbox/claimed` 的 turn 序号），但缺省 `minTurns=1` 下恢复的会话在 `agent/created` 即满足轮数闸、空闲后照常提取，重启间隙不漏；若调大 `extractMinTurns`，重启后需再观测满该轮数新对话才布防。长空闲后提取轮会在会话里短暂活动一回合，属 PRD 决策 3 明确接受的体感（「不漏」优先）。

## 兼容性与已知问题（实测环境 dsh 0.2.0-rc.2 / Node 24 / Windows）

- 本包零依赖、无构建；宿主注入点（`agent/created`、`agent.inject`、`ctx.tools.register`）变更时需适配，peer 约束记录于 PRD 第 7 节。
- `dsh --profile web --dump-config-schema` 在本机 exit=1，报错段为 `/197 dsh-at-file`（"no export named 'settingsNamespace'"）。已验证移除本插件后报错依旧——系 profile 既有依赖错配，与本品无关。
- 卸载命令 `dsh plugin --profile web remove project-memory` 在 pnpm v12.5.1 下可能因 `link:` 依赖报 `pnpm remove` 失败（诊断日志在 `~/.dsh/profiles/web/.plugin-manager/logs/`）。替代：直接编辑 `~/.dsh/profiles/web/package.json` 删除 `dsh-project-memory` 依赖行后运行 `pnpm install`，或等 dsh 工具链修复。

## 测试

```powershell
node --test D:\GitCode\dshplugin\project-memory\test\paths.test.mjs D:\GitCode\dshplugin\project-memory\test\store.test.mjs D:\GitCode\dshplugin\project-memory\test\extract.test.mjs
```

覆盖：路径编码（纯 ASCII / 含中文实测案例 / 幂等）、目录解析（精确 / 模糊 / 无目录）、写入（新建/追加/索引幂等/参数校验/索引体量阈值/frontmatter modified 刷新与不强加）、检索、M2 提取状态机（空闲触发 / 每会话限 1 轮含 durable 查重 / 轮数闸 / 子代理与无 cwd 跳过 / running 撤防 / 失败重试 / 缺省 minTurns=1）。共 23 例。

## 卸载

见"兼容性与已知问题"最后一条。卸载后记忆文件不受影响（在 `memoryRoot` 下，与插件生命周期解耦）。
