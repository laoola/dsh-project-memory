/**
 * 记忆工具集（PRD US-2/US-3）：memory_read / memory_write / memory_search。
 * 项目定位：exec.agent.session.header.cwd（缺 cwd 明确报错，不猜测）。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  resolveMemoryDir, readIndex, listTopics, sanitizeTopic, writeMemory, searchMemory, projectMemoryDir,
  INDEX_FILE, ARCHIVE_DIR, GLOBAL_HABITS_FILE, globalMemoryDir,
  writeSkillCandidate, archiveTopic, recordHit, writeGlobalHabits,
} from './store.js';
import { writeStatusFile, parseStatusDoc, STATUS_FILE } from './status.js';

/** 命中统计排除清单（slug 小写形态）：索引与 STATUS 快照是系统文件，读取不计数。 */
const HIT_EXCLUDED = new Set(['memory', 'status', 'status.prev1', 'status.prev2']);

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
export function buildMemoryTools({ root, journalDir, workspaceJsonPath, globalHabitsMaxChars = 600 }) {
  const recordFor = (cwd) => {
    // 延迟 import 避免循环依赖；journal 失败不影响工具
    return import('./journal.js').then(({ createJournal }) => createJournal({ journalDir, cwd }));
  };

  const memoryRead = {
    name: 'memory_read',
    description:
      '读取当前项目的持久记忆（跨对话）。不带 topic 返回 MEMORY.md 索引（每条一行摘要+链接）；带 topic 读取主题文件全文（topic 为主题名，不含 .md）；topic 形如 archive/<主题> 时读取归档副本（不计命中统计）；scope=global 时读取全局工作习惯（topic 必须为 user-habits）。接到首个实质性任务时先读索引，命中再细读。',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '主题文件名（不含 .md）；缺省返回索引；归档副本用 archive/<主题>' },
        scope: { type: 'string', enum: ['project', 'global'], description: 'project=当前项目（默认）；global=全局库（仅支持 user-habits）' },
      },
      additionalProperties: false,
    },
    output: OUTPUT,
    timeoutMs: 10_000,
    async execute(args, exec) {
      const cwd = currentCwd(exec);
      // 全局通道：固定单文件 user-habits（PRD 决策 7：受控单文件，不开全局自由读）
      if (args?.scope === 'global') {
        if (args?.topic !== 'user-habits') {
          return { ok: false, text: 'scope=global 仅支持固定主题 user-habits（全局工作习惯单文件）。' };
        }
        const journal = await recordFor(cwd);
        try {
          const text = await fs.readFile(path.join(globalMemoryDir(root), GLOBAL_HABITS_FILE), 'utf8');
          await journal({ event: 'read', topic: 'user-habits', scope: 'global' });
          return { ok: true, text };
        } catch {
          return { ok: false, text: '全局库尚无 user-habits.md。可用 memory_write(topic=user-habits, scope=global) 建立第一条全局习惯。' };
        }
      }
      const memDir = await resolveMemoryDir(root, cwd);
      if (!memDir) {
        return { ok: false, text: `当前项目尚无记忆目录（root=${root}）。可用 memory_write 建立第一条记忆。` };
      }
      if (args?.topic) {
        const raw = String(args.topic).trim();
        // 受控归档前缀 archive/<slug>（唯一允许的路径形态；归档读不计命中）
        const arch = /^archive\/([^/\\]+)$/i.exec(raw);
        if (arch) {
          const slug = sanitizeTopic(arch[1]);
          const journal = await recordFor(cwd);
          try {
            const text = await fs.readFile(path.join(memDir, ARCHIVE_DIR, `${slug}.md`), 'utf8');
            await journal({ event: 'read', topic: `archive/${slug}` });
            return { ok: true, text };
          } catch {
            return { ok: false, text: `归档区未找到主题「${slug}」；归档副本仅供对账回看，不注入新会话。` };
          }
        }
        if (/[\\/]/.test(raw)) {
          return { ok: false, text: `topic 无效：只允许主题名或 archive/<主题>（收到 ${JSON.stringify(raw)}）。` };
        }
        const slug = sanitizeTopic(raw);
        let text;
        try {
          text = await fs.readFile(path.join(memDir, `${slug}.md`), 'utf8');
        } catch {
          const topics = await listTopics(memDir);
          return { ok: false, text: `未找到主题「${slug}」。可用主题：${topics.join('、') || '（无）'}` };
        }
        const journal = await recordFor(cwd);
        await journal({ event: 'read', topic: slug });
        // 命中统计（P0-2）：主题文件每次读取 hits+1；索引/STATUS 快照排除；返回文本=回写前快照
        if (!HIT_EXCLUDED.has(slug.toLowerCase())) await recordHit(memDir, slug);
        return { ok: true, text };
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
      '把跨会话有效的持久结论写入记忆，四通道（target/scope/mode 组合）：①普通项目主题（默认）——主题文件+MEMORY.md 索引；②技能候选（target=skill-candidate）——可复用操作经验落 skill-candidates/ 草稿，不入索引不自动注入，需 description（升格=用户手工移入 ~/.agents/skills）；③全局工作习惯（scope=global，topic 固定 user-habits）——跨项目通用的用户偏好，注入所有项目会话；④归档（mode=archive，仅 topic）——主题移入 archive/ 并摘索引行。写入门槛：只记用户裁决、部署事实、踩坑教训、验证过的收口；不写明文凭据/密钥。⚠️ 项目当前状态不要写本工具——用 memory_status_write。',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '主题名（作为文件名，不含 .md）；mode=archive 时为要归档的主题' },
        summary: { type: 'string', description: '索引行摘要（≤160 字符）；技能候选与 mode=archive 不适用' },
        content: { type: 'string', description: 'Markdown 正文；mode=archive 不适用' },
        mode: { type: 'string', enum: ['append', 'replace', 'archive'], description: 'append=追加（默认），replace=重写整文件，archive=归档该主题（仅 topic）' },
        target: { type: 'string', enum: ['topic', 'skill-candidate'], description: 'topic=普通主题（默认）；skill-candidate=技能候选草稿' },
        scope: { type: 'string', enum: ['project', 'global'], description: 'project=当前项目（默认）；global=全局库（仅 user-habits）' },
        description: { type: 'string', description: '仅技能候选：一行用途描述（升格后为 SKILL.md 的 description）' },
        triggers: { type: 'array', items: { type: 'string' }, description: '仅技能候选：触发词（可选；会同步融入 description）' },
      },
      required: ['topic'],
      additionalProperties: false,
    },
    output: OUTPUT,
    timeoutMs: 10_000,
    async execute(args, exec) {
      const cwd = currentCwd(exec);
      const target = args?.target === 'skill-candidate' ? 'skill-candidate' : 'topic';
      const scope = args?.scope === 'global' ? 'global' : 'project';
      const mode = args?.mode === 'replace' ? 'replace' : args?.mode === 'archive' ? 'archive' : 'append';
      const journal = await recordFor(cwd);

      // ---- 参数矩阵（TASK r4 §2.1：非法组合代码层拒绝，错误信息写明正确组合） ----
      if (mode === 'archive') {
        if (target !== 'topic' || scope !== 'project') {
          throw new Error('mode=archive 仅支持普通项目主题（target=topic + scope=project），不支持技能候选或全局通道。');
        }
        if (args?.summary !== undefined || args?.content !== undefined || args?.description !== undefined || args?.triggers !== undefined) {
          throw new Error('mode=archive 仅接受 topic 参数（归档不改写内容；归档副本读取用 memory_read topic=archive/<主题>）。');
        }
        const result = await archiveTopic({ root, cwd, topic: args?.topic });
        await journal({ event: 'write', topic: result.slug, mode: 'archive', action: 'archived' });
        return {
          ok: true,
          text: `已归档：${result.removed} → ${result.archived}\n索引行已摘除；归档副本可经 memory_read(topic='archive/${result.slug}') 回看，memory_search 命中时标[已归档]。${result.indexUpdated ? '' : '（索引中本无该主题行，视同已摘除）'}`,
        };
      }
      if (target === 'skill-candidate') {
        if (scope !== 'project') throw new Error('技能候选只落在项目 memory/skill-candidates/（scope=global 不适用）。');
        if (mode === 'replace') throw new Error('技能候选只有整体重写语义，无需传 mode（同 slug 重写自动保留首次 created）。');
        if (args?.summary !== undefined) throw new Error('技能候选不入索引，summary 不适用（一行用途描述用 description）。');
        const result = await writeSkillCandidate({
          root,
          cwd,
          topic: args?.topic,
          content: args?.content,
          description: args?.description,
          triggers: args?.triggers,
        });
        await journal({ event: 'write', topic: result.slug, target: 'skill-candidate', action: result.rewrote ? 'candidate-rewritten' : 'candidate-created' });
        return {
          ok: true,
          text: `已写入技能候选${result.rewrote ? '（重写，保留首次 created）' : ''}：${result.file}\n候选不入索引、不自动注入；人工升格步骤见文件尾部升格说明（移入 ~/.agents/skills 后以加载器实测加载为准）。`,
        };
      }
      if (scope === 'global') {
        if (args?.topic !== 'user-habits') throw new Error('scope=global 仅支持固定主题 user-habits（全局工作习惯单文件，不开全局自由写）。');
        if (args?.description !== undefined || args?.triggers !== undefined) throw new Error('description/triggers 仅技能候选通道（target=skill-candidate）使用。');
        const result = await writeGlobalHabits({ root, summary: args?.summary, content: args?.content, mode });
        await journal({ event: 'write', topic: 'user-habits', scope: 'global', action: result.action });
        const verb = { created: '新建', appended: '追加', replaced: '重写' }[result.action];
        let text = `已${verb}全局工作习惯：${result.file}\n全局索引行已同步：${result.index}`;
        if (globalHabitsMaxChars > 0 && result.chars > globalHabitsMaxChars * 4) {
          text += `\n⚠️ 文件已达 ${result.chars} 字符（注入上限 ${globalHabitsMaxChars} 的 4 倍），新会话只注入开头片段：请合并同类习惯、更新既有条目而非持续追加。`;
        }
        return { ok: true, text };
      }
      // ---- 普通项目主题写入（缺省通道） ----
      if (args?.description !== undefined || args?.triggers !== undefined) {
        throw new Error('description/triggers 仅技能候选通道（target=skill-candidate）使用。');
      }
      const result = await writeMemory({ root, cwd, topic: args?.topic, summary: args?.summary, content: args?.content, mode });
      await journal({ event: 'write', topic: result.slug, mode, action: result.action });
      const verb = { created: '新建', appended: '追加', replaced: '重写' }[result.action];
      let notice = '';
      const st = result.indexStatus;
      if (st?.over) {
        notice = `\n⚠️ 索引已超载入上限（${st.lines} 行 / ${st.bytes} 字节；上限 200 行或 25KB，先到为准）：新会话注入会截断，后半索引条目将静默丢失。请立即治理：优先归档——memory_write(topic=旧主题, mode=archive) 把已收口条目移入 archive/（索引摘行、检索仍可见）；其次细节下沉主题文件、合并或删除陈旧条目。`;
      } else if (st?.near) {
        notice = `\n（提示：索引接近载入上限——${st.lines}/200 行、${st.bytes}/25600 字节。下次写入建议先归档：memory_write(topic=旧主题, mode=archive)，或细节下沉主题文件、合并陈旧条目。）`;
      }
      // 归档后同名重建（r2 决策 B 方案）：允许重建 + 提示归档历史
      let history = '';
      try {
        await fs.access(path.join(projectMemoryDir(root, cwd), ARCHIVE_DIR, `${result.slug}.md`));
        history = `\n（该主题存在归档历史：archive/${result.slug}.md；本次为归档后重建。）`;
      } catch {
        // 无归档副本
      }
      return { ok: true, text: `已${verb}主题文件：${result.file}\n索引已同步：${result.index}${notice}${history}` };
    },
  };

  const memorySearch = {
    name: 'memory_search',
    description:
      '在当前项目记忆目录内全文检索（MEMORY.md 索引 + 全部主题文件 + 归档区单层，大小写不敏感），返回命中文件、行号与行文本（归档命中标 [已归档]）。用于快速找回历史结论。',
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
      const journal = await recordFor(cwd);
      await journal({ event: 'search', query: args?.query, hits: hits.length });
      if (!hits.length) return { ok: false, text: `未检索到包含「${args?.query}」的记忆条目。` };
      // 命中统计（P0-2）：每命中一个未排除的主题文件 hits+1（索引与归档区不计数）
      const counted = new Set();
      for (const h of hits) {
        if (h.archived || h.file === INDEX_FILE) continue;
        const slug = h.file.replace(/\.md$/i, '');
        if (HIT_EXCLUDED.has(slug.toLowerCase()) || counted.has(slug)) continue;
        counted.add(slug);
        await recordHit(memDir, slug);
      }
      return { ok: true, text: hits.map((h) => `${h.archived ? '[已归档] ' : ''}${h.file}:${h.line}: ${h.text}`).join('\n') };
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
