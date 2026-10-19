/**
 * 记忆工具集（PRD US-2/US-3）：memory_read / memory_write / memory_search。
 * 项目定位：exec.agent.session.header.cwd（缺 cwd 明确报错，不猜测）。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMemoryDir, readIndex, listTopics, sanitizeTopic, writeMemory, searchMemory, projectMemoryDir } from './store.js';
import { writeStatusFile, parseStatusDoc, STATUS_FILE } from './status.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: '是否成功' },
    text: { type: 'string', description: '给模型看的完整结果文本' },
  },
  required: ['ok', 'text'],
  additionalProperties: false,
};

const OUTPUT = { schema: OUTPUT_SCHEMA, render: (_args, value) => [{ type: 'text', text: value?.text ?? '' }] };

function currentCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd;
  if (!cwd) throw new Error('无法确定会话工作目录（session.header.cwd 缺失），无法定位项目记忆。');
  return cwd;
}

/**
 * @param {{root: string, journalDir?: string}} options
 * @returns {Array<import('@deepseek-ai/dsh-tools').ToolDefinition>} 工具定义数组
 */
export function buildMemoryTools({ root, journalDir, workspaceJsonPath }) {
  const recordFor = (cwd) => {
    // 延迟 import 避免循环依赖；journal 失败不影响工具
    return import('./journal.js').then(({ createJournal }) => createJournal({ journalDir, cwd }));
  };

  const memoryRead = {
    name: 'memory_read',
    description:
      '读取当前项目的持久记忆（跨对话）。不带 topic 返回 MEMORY.md 索引（每条一行摘要+链接）；带 topic 读取主题文件全文（topic 为主题名，不含 .md）。接到首个实质性任务时先读索引，命中再细读。',
    parameters: {
      type: 'object',
      properties: { topic: { type: 'string', description: '主题文件名（不含 .md）；缺省返回索引' } },
      additionalProperties: false,
    },
    output: OUTPUT,
    timeoutMs: 10_000,
    async execute(args, exec) {
      const cwd = currentCwd(exec);
      const memDir = await resolveMemoryDir(root, cwd);
      if (!memDir) {
        return { ok: false, text: `当前项目尚无记忆目录（root=${root}）。可用 memory_write 建立第一条记忆。` };
      }
      if (args?.topic) {
        const slug = sanitizeTopic(args.topic);
        try {
          const text = await fs.readFile(path.join(memDir, `${slug}.md`), 'utf8');
          await (await recordFor(cwd))({ event: 'read', topic: slug });
          return { ok: true, text };
        } catch {
          const topics = await listTopics(memDir);
          return { ok: false, text: `未找到主题「${slug}」。可用主题：${topics.join('、') || '（无）'}` };
        }
      }
      const index = await readIndex(memDir);
      if (index === null) return { ok: false, text: 'MEMORY.md 索引为空或不存在。' };
      await (await recordFor(cwd))({ event: 'read', topic: 'index' });
      return { ok: true, text: index };
    },
  };

  const memoryWrite = {
    name: 'memory_write',
    description:
      '把跨会话有效的持久结论写入当前项目记忆：主题文件 + MEMORY.md 索引（同主题按文件名去重，整行更新索引）。写入门槛：只记用户裁决、部署事实、踩坑教训、验证过的收口；单次任务过程、临时状态、未验证猜测不写；不写明文凭据/密钥（只记存放位置）。mode=append 追加（默认），replace 整文件重写（谨慎）。⚠️ 项目当前状态（阶段/里程碑/进行中事项/下次开工点）不要写进本工具——那是 STATUS 快照，用 memory_status_write。',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '主题名（作为文件名，不含 .md），如 deployment-facts' },
        summary: { type: 'string', description: '索引行用的一行摘要（≤160 字符）' },
        content: { type: 'string', description: 'Markdown 正文（与现有条目行文风格一致）' },
        mode: { type: 'string', enum: ['append', 'replace'], description: 'append=追加（默认），replace=重写整文件' },
      },
      required: ['topic', 'summary', 'content'],
      additionalProperties: false,
    },
    output: OUTPUT,
    timeoutMs: 10_000,
    async execute(args, exec) {
      const cwd = currentCwd(exec);
      const result = await writeMemory({
        root,
        cwd,
        topic: args?.topic,
        summary: args?.summary,
        content: args?.content,
        mode: args?.mode === 'replace' ? 'replace' : 'append',
      });
      await (await recordFor(cwd))({ event: 'write', topic: result.slug, mode: args?.mode === 'replace' ? 'replace' : 'append', action: result.action });
      const verb = { created: '新建', appended: '追加', replaced: '重写' }[result.action];
      let notice = '';
      const st = result.indexStatus;
      if (st?.over) {
        notice = `\n⚠️ 索引已超载入上限（${st.lines} 行 / ${st.bytes} 字节；上限 200 行或 25KB，先到为准）：新会话注入会截断，后半索引条目将静默丢失。请立即精简：细节下沉到主题文件、合并或删除陈旧条目，然后重写索引。`;
      } else if (st?.near) {
        notice = `\n（提示：索引接近载入上限——${st.lines}/200 行、${st.bytes}/25600 字节。下次写入建议先精简：细节下沉主题文件、合并陈旧条目。）`;
      }
      return { ok: true, text: `已${verb}主题文件：${result.file}\n索引已同步：${result.index}${notice}` };
    },
  };

  const memorySearch = {
    name: 'memory_search',
    description:
      '在当前项目记忆目录内全文检索（MEMORY.md 索引 + 全部主题文件，大小写不敏感），返回命中文件、行号与行文本。用于快速找回历史结论。',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '检索关键词' } },
      required: ['query'],
      additionalProperties: false,
    },
    output: OUTPUT,
    timeoutMs: 10_000,
    async execute(args, exec) {
      const cwd = currentCwd(exec);
      const memDir = await resolveMemoryDir(root, cwd);
      if (!memDir) return { ok: false, text: '当前项目尚无记忆目录，无可检索内容。' };
      const hits = await searchMemory({ memDir, query: args?.query });
      await (await recordFor(cwd))({ event: 'search', query: args?.query, hits: hits.length });
      if (!hits.length) return { ok: false, text: `未检索到包含「${args?.query}」的记忆条目。` };
      return { ok: true, text: hits.map((h) => `${h.file}:${h.line}: ${h.text}`).join('\n') };
    },
  };

  const memoryStatusWrite = {
    name: 'memory_status_write',
    description:
      '更新当前项目的 STATUS.md 状态快照（与 MEMORY.md 并列存放），七字段：当前阶段/最近里程碑/进行中事项/下次开工起点/关键技术决策(≤5条)/活跃约束；summary（一行项目状态摘要）必填，注入 MEMORY.md 第一行作开工指针。快照语义：传了字段=更新该字段，没传=沿用旧值（从未有过则落盘标「待补」）；内容无变化不重写不滚动，历史自动滚动 STATUS.prev1/prev2。只在本场对话确实推进了项目状态时调用；自然语言说「更新项目状态/STATUS」也应走本工具。',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '一行项目状态摘要（≤160 字符；MEMORY.md 第一行注入用）' },
        stage: { type: 'string', description: '当前阶段（如「M2 提取已上线，STATUS 机制开发中」）' },
        milestones: { type: 'array', items: { type: 'string' }, description: '最近里程碑列表（新的在后；>10 条自动压缩为指针）' },
        inProgress: { type: 'array', items: { type: 'string' }, description: '进行中事项列表' },
        nextStart: { type: 'string', description: '下次开工起点（一眼可知从哪继续）' },
        keyDecisions: { type: 'array', items: { type: 'string' }, description: '关键技术决策（≤5 条，超出截断）' },
        constraints: { type: 'array', items: { type: 'string' }, description: '活跃约束（在生效的限制/依赖/边界）' },
        source: { type: 'string', description: '来源说明（缺省「自动提取轮」）' },
      },
      required: ['summary'],
      additionalProperties: false,
    },
    output: OUTPUT,
    timeoutMs: 10_000,
    async execute(args, exec) {
      const cwd = currentCwd(exec);
      const summary = String(args?.summary ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
      if (!summary) throw new Error('summary 为空：需要一行项目状态摘要（MEMORY.md 指针用）。');
      // merge 语义：读旧快照，未传字段沿用旧值
      let old = { stage: '', milestones: [], inProgress: [], nextStart: '', keyDecisions: [], constraints: [] };
      try {
        old = parseStatusDoc(await fs.readFile(path.join(projectMemoryDir(root, cwd), STATUS_FILE), 'utf8'));
      } catch {
        /* 无旧快照：全空 */
      }
      const merged = {
        stage: args?.stage !== undefined ? String(args.stage) : old.stage,
        milestones: Array.isArray(args?.milestones) ? args.milestones : old.milestones,
        inProgress: Array.isArray(args?.inProgress) ? args.inProgress : old.inProgress,
        nextStart: args?.nextStart !== undefined ? String(args.nextStart) : old.nextStart,
        keyDecisions: Array.isArray(args?.keyDecisions) ? args.keyDecisions.slice(0, 5) : old.keyDecisions,
        constraints: Array.isArray(args?.constraints) ? args.constraints : old.constraints,
      };
      const source = args?.source !== undefined ? String(args.source).slice(0, 120) : '自动提取轮';
      const result = await writeStatusFile({ root, cwd, fields: merged, summary, source, workspaceJsonPath });
      await (await recordFor(cwd))({ event: 'status', action: result.action, truncated: result.truncated });
      const verb = { created: '新建', updated: '更新', unchanged: '无变化（未重写未滚动）', 'skipped-locked': '跳过（5 秒抢写保护：另一路正在写 STATUS）' }[result.action];
      const notes = [];
      if (result.action === 'created' || result.action === 'updated') {
        notes.push(`已${verb}状态快照：${result.file}`);
        if (result.indexUpdated) notes.push(`MEMORY.md 首行状态指针已同步：${result.indexLine}`);
        if (result.truncated) notes.push('⚠️ 七字段总量超膨胀上限，已自动压缩（单字段≤500字符、全文件≤2KB且≤80行）——建议下次给更精炼的字段值。');
      } else {
        notes.push(`STATUS ${verb}。`);
      }
      return { ok: true, text: notes.join('\n') };
    },
  };

  return [memoryRead, memoryWrite, memorySearch, memoryStatusWrite];
}
