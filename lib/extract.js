/**
 * M2 全自动提取（PRD US-4）：会话空闲后自动唤醒一轮"提取轮"，把本场对话中
 * 值得跨会话沉淀的结论与用户行为习惯（双路，见 EXTRACT_PROMPT）经 memory_write 落盘。护栏（PRD 决策 3 / 第 4 节）：
 * - 触发：agent/status→idle 持续 extractIdleMs（缺省 3 分钟）→ agent.followup() 唤醒；
 *   agent/created 也预布防，覆盖"恢复的会话不再有新活动"的场景。
 * - 每会话限 1 轮：内存占坑 + journal durable 查重（readExtractSessions，重启不重复提取）。
 * - 每会话限 1 轮：内存占坑 + journal durable 查重（readExtractSessions，重启不重复提取）。
 * - 轮数闸：本进程观测到的最大 turn 序号 +1 < extractMinTurns 不布防。
 *   缺省 minTurns=1（2026-10-14 用户裁决：不漏优先，单轮对话有结论也要提取；
 *   恢复会话 created 即布防，「重启后需再攒轮数」的限制随之消除）；
 *   想省 token 的场景可调大，代价是短会话可能漏提取。
 * - 子代理 / 无 cwd 一律跳过；提取轮自身结束再 idle 不会二次触发（先占坑再 followup）。
 * - followup 失败（如会话已释放）只记日志与 journal（action=error，不计入已提取），
 *   下次 idle 自动重试，绝不影响宿主会话。
 */
import { randomUUID } from 'node:crypto';
import { createJournal, readExtractSessions } from './journal.js';

export const DEFAULT_IDLE_MS = 3 * 60 * 1000;
export const DEFAULT_MIN_TURNS = 1;

export const EXTRACT_PROMPT = [
  '[project-memory] 自动提取轮（插件触发，每会话一次；这是系统自动化消息，不是用户发言）。',
  '请回顾本场对话，分两路提取：',
  '【结论路】若存在值得跨会话沉淀的持久结论（用户裁决、部署事实、踩坑教训、验证过的收口），用 memory_write 落盘：',
  '- 写入前先 memory_search 查重：同主题已有条目则更新原文件，不新建重复条目；',
  '- 不写能从代码、规格、文档直接推导的内容（读仓库就有，不用记忆）；',
  '- 不写 CLAUDE.md / AGENTS.md 等指令文件已载明的约定（模型每次会话都会加载，重复记是噪音）；',
  '- 只记跨会话有效的结论；单次任务过程、临时状态、未验证猜测不写；不写明文凭据/密钥（只记存放位置）；',
  '- 正文与该项目记忆现有条目行文风格一致，索引行 ≤160 字符。',
  '【习惯路】若本场对话暴露了用户的行为模式，用 memory_write 追加到 user-habits 主题文件（与结论分文件）：',
  '- 算习惯的：用户下指令的固定风格（如先横评再点名、只要结论不要过程）、明确纠正过 AI 的行为（如“别再建议X”）、反复出现的操作序列偏好（如先查记忆再动手、装新插件前先查与现役插件重叠）；',
  '- 不算的：单次任务的一次性要求、本场上下文里的临时偏好、结论路已覆盖的领域裁决；',
  '- 每条格式：`- <模式描述>（<YYYY-MM-DD>，第 N 次出现；来源：<纠正/点名/重复>）`——同模式在 user-habits 已存在则更新日期与次数，不重复建条；',
  '- 只记录不执行：习惯条目是候选，升格进 AGENTS.md 或习惯清单由用户人工确认，提取轮不得自行改指令文件。',
  '两路都没有够格的产出：不调用任何工具，直接回复一行「无新增记忆」结束，不要输出总结或报告。',
  '本轮只做记忆提取，不要继续执行对话中的其他任务。',
].join('\n');

/**
 * @param {{root?: string, journalDir?: string, logger?: Console, idleMs?: number, minTurns?: number}} options
 * @returns {{idleMs: number, minTurns: number, onCreated: (agent: unknown) => void, onStatus: (agent: unknown, status: string) => void, onClaimed: (agent: unknown, turn: number) => void, onDisposed: (agent: unknown) => void}}
 */
export function buildExtractor({ root, journalDir, logger = console, idleMs = DEFAULT_IDLE_MS, minTurns = DEFAULT_MIN_TURNS } = {}) {
  if (!Number.isFinite(idleMs) || idleMs <= 0) idleMs = DEFAULT_IDLE_MS;
  if (!Number.isFinite(minTurns) || minTurns < 1) minTurns = DEFAULT_MIN_TURNS;
  const record = (cwd) => createJournal({ journalDir, cwd });

  /** @type {Map<string, {turns: number, timer: ReturnType<typeof setTimeout>|null}>} sessionId -> 观测状态 */
  const sessions = new Map();
  const extracted = new Set();

  const sessionOf = (agent) => agent?.session?.id ?? agent?.id;
  const eligible = (agent) => {
    const header = agent?.session?.header;
    if (!header?.cwd) return false;
    if (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0) return false;
    return true;
  };
  const observe = (agent) => {
    const id = sessionOf(agent);
    if (!sessions.has(id)) sessions.set(id, { turns: 0, timer: null });
    return id;
  };
  /** 本进程观测到的已开轮数（turn 序号从 0 计，故最大序号 +1）。 */
  const turnsOf = (id) => (sessions.get(id)?.turns ?? 0) + 1;

  function disarm(id) {
    const s = sessions.get(id);
    if (s?.timer) {
      clearTimeout(s.timer);
      s.timer = null;
    }
  }

  function arm(agent, id) {
    if (extracted.has(id) || turnsOf(id) < minTurns) return;
    disarm(id); // 滑动空闲窗口：每次布防都从当下重新计时
    sessions.get(id).timer = setTimeout(() => {
      sessions.get(id).timer = null;
      void fire(agent, id);
    }, idleMs);
    sessions.get(id).timer.unref?.(); // 不阻止宿主进程退出
  }

  async function fire(agent, id) {
    if (extracted.has(id)) return;
    extracted.add(id); // 先占坑：提取轮自身再 idle 不二次触发
    const cwd = agent.session.header.cwd;
    try {
      const done = await readExtractSessions({ journalDir, cwd });
      if (done.has(id)) {
        await record(cwd)({ event: 'extract', session: id, action: 'skip-done' });
        return;
      }
      agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: EXTRACT_PROMPT }],
        source: { kind: 'project-memory', form: 'extract' },
      });
      await record(cwd)({ event: 'extract', session: id, action: 'followup', turns: turnsOf(id), idleMs });
    } catch (error) {
      extracted.delete(id); // 允许下次 idle 重试（error 不计入 durable 已提取）
      await record(cwd)({ event: 'extract', session: id, action: 'error', error: String(error?.message ?? error) }).catch(() => {});
      logger.warn?.(`[project-memory] 提取轮唤醒失败（不影响会话）：${error?.message ?? error}`);
    }
  }

  return {
    idleMs,
    minTurns,
    onCreated(agent) {
      if (!eligible(agent)) return;
      arm(agent, observe(agent));
    },
    onStatus(agent, status) {
      if (!eligible(agent)) return;
      const id = observe(agent);
      if (status === 'running') disarm(id);
      else if (status === 'idle') arm(agent, id);
    },
    onClaimed(agent, turn) {
      if (!eligible(agent)) return;
      const id = observe(agent);
      const s = sessions.get(id);
      if (Number.isFinite(turn) && turn > s.turns) s.turns = turn;
      disarm(id); // 新输入被认领：会话活动中，撤防
    },
    onDisposed(agent) {
      const id = sessionOf(agent);
      if (id === undefined) return;
      disarm(id);
      sessions.delete(id);
      extracted.delete(id); // journal durable 查重仍兜底，不会重复提取
    },
  };
}
