/**
 * dsh-project-memory — DSH 本机跨对话项目记忆（Host bundle，PRD v0.2）。
 *
 * M1 能力：
 * 1. 会话启动自动注入：agent/created → 按会话 cwd 定位记忆目录 → agent.inject 注入
 *    MEMORY.md 索引（只注索引行；子代理/无 cwd/无记忆目录一律静默跳过）。
 * 2. 记忆工具集：memory_read / memory_write / memory_search。
 * 3. 本地 JSONL 使用日志：~/.dsh/memory/journal/<项目>.jsonl（无遥测）。
 *
 * M2 能力（全自动提取，PRD US-4）：
 * 4. 会话空闲（agent/status→idle 持续 extractIdleMs）→ agent.followup 唤醒一轮提取，
 *    模型把跨会话结论经 memory_write 落盘；每会话限 1 轮（内存 + journal durable 查重）。
 *    见 lib/extract.js。
 */
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fsPromises } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveMemoryDir, resolveLegacyMemoryDir, readIndex, globalMemoryDir, GLOBAL_HABITS_FILE } from './lib/store.js';
import { createJournal } from './lib/journal.js';
import { buildMemoryTools } from './lib/tools.js';
import { buildExtractor, DEFAULT_IDLE_MS, DEFAULT_MIN_TURNS } from './lib/extract.js';
import { detectDefaultKnowledgeSources, loadProjectNameIndex, registerPanelRoutes } from './lib/routes.js';

/** 声明依赖注入：访问 ctx.tools 必须显式 inject，否则激活报 "cannot get property tools without inject"。 */
export const inject = ['tools'];

const DEFAULT_INJECT_MAX_CHARS = 4000;
/** 全局习惯注入预算（P0-4）：0 = 禁用全局习惯注入；文件超 4 倍上限时写入侧提示精简。 */
const DEFAULT_GLOBAL_HABITS_MAX_CHARS = 600;

/** 探测式默认记忆根目录（PRD 决策 4）：有 Claude Code 存量则共库，否则 DSH 自有目录。 */
function detectDefaultRoot() {
  const claude = path.join(homedir(), '.claude', 'projects');
  if (existsSync(claude)) return claude;
  return path.join(homedir(), '.dsh', 'memory', 'projects');
}

/** 渲染注入文本：索引行 + 使用约定。超长时头尾双端保留（STATUS 指针与末尾最新条目/主题组优先），中间省略提示细读。 */
export function renderInjection(index, memDir, maxChars) {
  let idx = String(index).trim();
  if (!idx) return '';
  let truncated = false;
  if (idx.length > maxChars) {
    // 双端保留：头部 60%（STATUS 指针 + 早期条目），尾部 40%（最新条目/最后主题组）。
    // 按行边界取舍，避免截断半行；省略行预留 60 字符预算。
    const lines = idx.split('\n');
    const headBudget = Math.floor(maxChars * 0.6);
    const tailBudget = Math.max(0, maxChars - headBudget - 60);
    const head = [];
    let used = 0;
    for (const line of lines) {
      if (used + line.length + 1 > headBudget) break;
      head.push(line);
      used += line.length + 1;
    }
    const tail = [];
    used = 0;
    for (let i = lines.length - 1; i >= head.length; i -= 1) {
      const line = lines[i];
      if (used + line.length + 1 > tailBudget) break;
      tail.unshift(line);
      used += line.length + 1;
    }
    const omitted = lines.length - head.length - tail.length;
    truncated = omitted > 0;
    if (truncated) {
      idx = [...head, `…（中间 ${omitted} 行已省略，全文用 memory_read 查看）`, ...tail].join('\n');
    }
  }
  return [
    '[project-memory] 本项目存在跨对话记忆（与 Claude Code 记忆罗盘共库）：',
    memDir,
    '',
    '索引（每条一行摘要+链接；仅当命中当前任务时再细读对应主题文件，控制上下文开销）：',
    '',
    idx,
    truncated ? '（索引过长已截断；可用 memory_read 工具查看完整索引）' : '',
    '',
    '使用约定：做方案与排障时先对照以上已验证结论，避免重新推导已拍板事项；细读用 memory_read，跨文件检索用 memory_search；本会话出现值得沉淀的持久结论（用户裁决、部署事实、踩坑教训、验证过的收口）时用 memory_write 落盘（只记跨会话有效结论、先查索引去重、不写明文凭据）。',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** 旧布局迁移提示（2026-10-20）：Claude Code 旧版把 MEMORY.md 放项目目录根下，现役只认 memory/ 子目录。 */
export function renderLegacyNotice(legacyDir) {
  const target = path.join(legacyDir, 'memory');
  return [
    '[project-memory] 检测到旧布局记忆（Claude Code 旧版位置，现役版本不会自动注入）：',
    legacyDir,
    '',
    '该目录根下有 MEMORY.md，但缺少 memory\\ 子目录。Claude Code 与 DSH 现役版本都只读 memory\\ 子目录。',
    `请把 MEMORY.md 与主题 .md 文件移入 ${target}\\（新建该子目录即可），移入后本提示自动消失。`,
    '（历史备份可保留原位置副本，不会占用注入预算。）',
  ].join('\n');
}

/**
 * 全局习惯注入段（P0-4）：读 <root>/_global/memory/user-habits.md 正文（去 frontmatter），
 * 按行截断 ≤ maxChars（0 = 禁用）。历史偏好参考语义，不覆盖当前指令。
 */
export async function renderGlobalHabitsSection(root, maxChars) {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return '';
  let raw;
  try {
    raw = await fsPromises.readFile(path.join(globalMemoryDir(root), GLOBAL_HABITS_FILE), 'utf8');
  } catch {
    return '';
  }
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
  if (!body) return '';
  const lines = body.split(/\r?\n/);
  const out = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > maxChars) break;
    out.push(line);
    used += line.length + 1;
  }
  return [
    '## 全局工作习惯（历史偏好参考，不覆盖当前指令）',
    out.join('\n'),
    out.length < lines.length ? `（已截断，全文用 memory_read(topic='user-habits', scope='global') 查看）` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 会话注入编排（P0-4 抽出可测）：项目索引与全局习惯的合并决策。
 * 返回 {kind, text, dir?}：kind = 'recall'（项目索引，可含全局习惯尾段）
 * | 'legacy'（旧布局迁移提示）| 'global'（仅全局习惯：项目无目录/无索引/索引渲染为空时仍独立注入）
 * | null（无任何可注入，静默跳过）。
 */
export async function buildSessionInjection({ root, cwd, injectMaxChars, globalHabitsMaxChars }) {
  const globalText = await renderGlobalHabitsSection(root, globalHabitsMaxChars);
  const memDir = await resolveMemoryDir(root, cwd);
  if (!memDir) {
    const legacyDir = await resolveLegacyMemoryDir(root, cwd);
    if (!legacyDir) return globalText ? { kind: 'global', text: globalText } : null;
    const legacyText = renderLegacyNotice(legacyDir);
    return { kind: 'legacy', text: globalText ? `${legacyText}\n\n${globalText}` : legacyText, dir: legacyDir };
  }
  const index = await readIndex(memDir);
  if (index === null) return globalText ? { kind: 'global', text: globalText, dir: memDir } : null;
  const text = renderInjection(index, memDir, injectMaxChars);
  if (!text) return globalText ? { kind: 'global', text: globalText, dir: memDir } : null;
  return { kind: 'recall', text: globalText ? `${text}\n\n${globalText}` : text, dir: memDir };
}

/**
 * 插件入口。Config（cordis.patch.yml 用户层可覆盖，键见 README）：
 * - memoryRoot: string    记忆根目录（缺省探测：~/.claude/projects → ~/.dsh/memory/projects）
 * - journalDir: string    JSONL 日志目录（缺省 ~/.dsh/memory/journal）
 * - injectMaxChars: number  注入索引的最大字符数（缺省 4000）
 * - globalHabitsMaxChars: number 全局习惯注入段最大字符数（P0-4；缺省 600，0=禁用）
 * - extractEnabled: boolean M2 全自动提取开关（缺省 true）
 * - extractIdleMs: number   会话空闲多久后唤醒提取轮（缺省 180000 = 3 分钟）
 * - extractMinTurns: number 轮数闸：至少观测到几轮对话才布防提取（缺省 1；调大省 token 但短会话可能漏）
 * - statusWorkspaceJson: string STATUS 枚举用 workspace.json 路径（缺省 ~/.dsh/storages/workspace.json；仅测试/特殊部署需覆盖）
 * - knowledgeSources: Array<{id,label,description?,root}> 知识库面板「本地知识源」分区（0.2，缺省探测
 *   ~/.agents/skills 与 ~/.dsh/docs，存在才注册；配置后完全覆盖缺省探测）
 */
export function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console;
  const root = typeof config.memoryRoot === 'string' && config.memoryRoot ? config.memoryRoot : detectDefaultRoot();
  const journalDir = typeof config.journalDir === 'string' && config.journalDir ? config.journalDir : undefined;
  const injectMaxChars = Number.isFinite(config.injectMaxChars) && config.injectMaxChars > 0 ? config.injectMaxChars : DEFAULT_INJECT_MAX_CHARS;
  const globalHabitsMaxChars = Number.isFinite(config.globalHabitsMaxChars) && config.globalHabitsMaxChars >= 0
    ? config.globalHabitsMaxChars
    : DEFAULT_GLOBAL_HABITS_MAX_CHARS;
  logger.info?.(`[project-memory] 记忆根目录：${root}`);

  // —— US-1 + P0-4：会话启动自动注入（每会话一次；子代理与无 cwd 跳过；编排见 buildSessionInjection）——
  const injected = new Set();
  ctx.on('agent/created', async (payload) => {
    const agent = payload?.agent;
    try {
      const header = agent?.session?.header;
      if (!header?.cwd) return;
      if (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0) return;
      const sessionId = agent.session.id;
      if (injected.has(sessionId)) return;

      const plan = await buildSessionInjection({ root, cwd: header.cwd, injectMaxChars, globalHabitsMaxChars });
      if (!plan) return; // 无记忆可注入：静默跳过（US-1 验收第 2 条）

      agent.inject({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: plan.text }],
        source: { kind: 'project-memory', form: plan.kind },
      });
      injected.add(sessionId);
      const record = { event: 'inject', form: plan.kind, session: sessionId, chars: plan.text.length };
      if (plan.dir) record.dir = plan.dir;
      await createJournal({ journalDir, cwd: header.cwd })(record);
    } catch (error) {
      logger.warn?.(`[project-memory] 注入失败（不影响会话）：${error?.message ?? error}`);
    }
  });

  // —— US-2/US-3：记忆工具集（注册即挂 effect，卸载自动清理）——
  const statusWorkspaceJson = typeof config.statusWorkspaceJson === 'string' && config.statusWorkspaceJson
    ? config.statusWorkspaceJson
    : undefined;
  for (const definition of buildMemoryTools({ root, journalDir, workspaceJsonPath: statusWorkspaceJson, globalHabitsMaxChars })) {
    ctx.effect(() => ctx.tools.register(definition), `project-memory.register(${definition.name})`);
  }

  // —— US-4：M2 全自动提取（会话空闲 → followup 唤醒提取轮；每会话限 1 轮）——
  if (config.extractEnabled !== false) {
    const extractor = buildExtractor({ root, journalDir, logger, idleMs: config.extractIdleMs, minTurns: config.extractMinTurns });
    ctx.on('agent/created', (payload) => extractor.onCreated(payload?.agent));
    ctx.on('agent/status', (payload) => extractor.onStatus(payload?.agent, payload?.status));
    ctx.on('agent/inbox/claimed', (payload) => extractor.onClaimed(payload?.agent, payload?.turn));
    ctx.on('agent/disposed', (payload) => extractor.onDisposed(payload?.agent));
    logger.info?.(
      `[project-memory] 全自动提取已启用：空闲 ${Math.round(extractor.idleMs / 1000)}s 唤醒，至少 ${extractor.minTurns} 轮对话，每会话限 1 轮`,
    );
  }

  // —— 0.2 知识库面板（只读 Web 视图）：webServer 存在才挂路由，非 web profile 零影响 ——
  // 知识源归一放在路由层（非法项跳过不抛错）；缺省探测与 apply 并行启动，首个请求前就绪。
  // nameIndex：~/.claude.json 的历史 cwd 清单 → 编码目录名映射，给面板项目行真实项目名。
  const knowledgeSources = config.knowledgeSources !== undefined
    ? config.knowledgeSources
    : detectDefaultKnowledgeSources();
  const projectNameIndex = loadProjectNameIndex();
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => {
      const disposeRoutes = registerPanelRoutes(webCtx, {
        memoryRoot: root,
        knowledgeSources,
        nameIndex: projectNameIndex,
        logger,
      });
      logger.info?.('[project-memory] 知识库面板路由已挂载（只读）：/dsh-project-memory/api/*');
      return disposeRoutes;
    });
  }
}
