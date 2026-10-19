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
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveMemoryDir, readIndex } from './lib/store.js';
import { createJournal } from './lib/journal.js';
import { buildMemoryTools } from './lib/tools.js';
import { buildExtractor, DEFAULT_IDLE_MS, DEFAULT_MIN_TURNS } from './lib/extract.js';
import { detectDefaultKnowledgeSources, loadProjectNameIndex, registerPanelRoutes } from './lib/routes.js';

/** 声明依赖注入：访问 ctx.tools 必须显式 inject，否则激活报 "cannot get property tools without inject"。 */
export const inject = ['tools'];

const DEFAULT_INJECT_MAX_CHARS = 4000;

/** 探测式默认记忆根目录（PRD 决策 4）：有 Claude Code 存量则共库，否则 DSH 自有目录。 */
function detectDefaultRoot() {
  const claude = path.join(homedir(), '.claude', 'projects');
  if (existsSync(claude)) return claude;
  return path.join(homedir(), '.dsh', 'memory', 'projects');
}

/** 渲染注入文本：索引行 + 使用约定。超长截断并提示用工具细读。 */
function renderInjection(index, memDir, maxChars) {
  let idx = String(index).trim();
  if (!idx) return '';
  let truncated = false;
  if (idx.length > maxChars) {
    idx = idx.slice(0, maxChars);
    truncated = true;
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

/**
 * 插件入口。Config（cordis.patch.yml 用户层可覆盖，键见 README）：
 * - memoryRoot: string    记忆根目录（缺省探测：~/.claude/projects → ~/.dsh/memory/projects）
 * - journalDir: string    JSONL 日志目录（缺省 ~/.dsh/memory/journal）
 * - injectMaxChars: number  注入索引的最大字符数（缺省 4000）
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
  logger.info?.(`[project-memory] 记忆根目录：${root}`);

  // —— US-1：会话启动自动注入（每会话一次；子代理与无 cwd 跳过）——
  const injected = new Set();
  ctx.on('agent/created', async (payload) => {
    const agent = payload?.agent;
    try {
      const header = agent?.session?.header;
      if (!header?.cwd) return;
      if (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0) return;
      const sessionId = agent.session.id;
      if (injected.has(sessionId)) return;

      const memDir = await resolveMemoryDir(root, header.cwd);
      if (!memDir) return; // 无记忆目录：静默跳过（US-1 验收第 2 条）
      const index = await readIndex(memDir);
      if (index === null) return;

      const text = renderInjection(index, memDir, injectMaxChars);
      if (!text) return;

      agent.inject({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'project-memory', form: 'recall' },
      });
      injected.add(sessionId);
      await createJournal({ journalDir, cwd: header.cwd })({ event: 'inject', session: sessionId, chars: text.length });
    } catch (error) {
      logger.warn?.(`[project-memory] 注入失败（不影响会话）：${error?.message ?? error}`);
    }
  });

  // —— US-2/US-3：记忆工具集（注册即挂 effect，卸载自动清理）——
  const statusWorkspaceJson = typeof config.statusWorkspaceJson === 'string' && config.statusWorkspaceJson
    ? config.statusWorkspaceJson
    : undefined;
  for (const definition of buildMemoryTools({ root, journalDir, workspaceJsonPath: statusWorkspaceJson })) {
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
