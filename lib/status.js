/**
 * STATUS.md —— 每工作区项目状态文件（与 MEMORY.md 并列于 <root>/<slug>/memory/）。
 *
 * 七字段快照（2026-10-17 用户拍板，勿改需求）：当前阶段 / 最近里程碑 / 进行中事项 /
 * 下次开工起点 / 关键技术决策(≤5条) / 活跃约束 / 最近更新时间戳+来源；缺失字段标「待补」。
 *
 * 护栏：
 * - 膨胀控制：单字段 ≤500 字符；全文件 ≤2KB 且 ≤80 行；里程碑 >10 条压一行指针。
 * - 历史：STATUS.prev1.md / STATUS.prev2.md 滚动；内容 diff 无变化 → 不重写不滚动。
 * - 并发：先写 STATUS.md.tmp 再 rename（原子替换）；STATUS.md.tmp 存在且 mtime
 *   距今 <5s 视为他人正在写（时间戳抢写保护），本次跳过。
 * - 兜底：写盘失败静默重试 1 次；提取轮沉默窗口误判时本写入器只写不读（无反馈循环）。
 * - 标识：内部用 DSH workspaceId（~/.dsh/storages/workspace.json 的
 *   tables.workspaces），表中缺失时用路径 SHA-256 前 16 位兜底；不依赖 taskboard ID。
 * - 工作区归档/删除：机制不感知、不清理（残留 STATUS 留给人工）。
 */
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { encodeProjectPath, fuzzyKey } from './paths.js';
import { projectMemoryDir, readIndex } from './store.js';

export const STATUS_FILE = 'STATUS.md';
export const STATUS_TMP = 'STATUS.md.tmp';
export const STATUS_PREV1 = 'STATUS.prev1.md';
export const STATUS_PREV2 = 'STATUS.prev2.md';

/** 膨胀控制阈值（规格第 4 条）。 */
export const FIELD_MAX_CHARS = 500;
export const FILE_MAX_BYTES = 2 * 1024;
export const FILE_MAX_LINES = 80;
export const MILESTONE_KEEP = 10;
/** 时间戳抢写保护窗口（规格第 6 条）。 */
export const WRITE_LOCK_MS = 5000;

/** 枚举排除模式：复用 WorkLog 日报 sources.json 的 excludePatterns（AppData-Local-Temp、modlens）。 */
export const EXCLUDE_PATTERNS = ['AppData-Local-Temp', 'modlens'];

/** DSH 工作区注册表缺省位置（workspaceId 唯一真源）。 */
export const DEFAULT_WORKSPACE_JSON = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.dsh', 'storages', 'workspace.json',
);

const PENDING = '待补';
const STATUS_LINE_PREFIX = '> 📌 STATUS：';

/** 规整一个字段值：字符串去空白并限长；数组去空行、逐条去空白限长。 */
function normValue(value, cap) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim().replace(/\s+/g, ' ').slice(0, cap))
      .filter((item) => item.length > 0);
  }
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  return text.slice(0, cap);
}

/**
 * 规整七字段：限长、决策 ≤5 条、里程碑 >10 条压一行指针。
 * @returns {{stage:string, milestones:string[], inProgress:string[], nextStart:string,
 *            keyDecisions:string[], constraints:string[], workspaceId:string}}
 */
export function normalizeStatusFields(fields) {
  const milestones = normValue(fields?.milestones, FIELD_MAX_CHARS);
  let pointer = null;
  let keep = milestones;
  if (keep.length > MILESTONE_KEEP) {
    pointer = `（更早 ${keep.length - MILESTONE_KEEP} 条见历史版本 STATUS.prev1.md）`;
    keep = [...keep.slice(keep.length - MILESTONE_KEEP)];
  }
  const keyDecisions = normValue(fields?.keyDecisions, FIELD_MAX_CHARS).slice(0, 5);
  return {
    stage: normValue(fields?.stage, FIELD_MAX_CHARS),
    milestones: pointer ? [...keep, pointer] : keep,
    inProgress: normValue(fields?.inProgress, FIELD_MAX_CHARS),
    nextStart: normValue(fields?.nextStart, FIELD_MAX_CHARS),
    keyDecisions,
    constraints: normValue(fields?.constraints, FIELD_MAX_CHARS),
    workspaceId: String(fields?.workspaceId ?? ''),
  };
}

/** 渲染列表字段：有内容逐条缩进列出，空则一行「待补」。 */
function listLines(label, items) {
  return items.length
    ? [`${label}：`, ...items.map((item) => `  - ${item}`)]
    : [`${label}：`, `  - ${PENDING}`];
}

/** 渲染 STATUS.md 全文（不含膨胀二次压缩；二级压缩在 fitStatusDoc 内做）。 */
export function renderStatusDoc(fields, { updatedAt, source }) {
  const norm = fields; // 调用方先过 normalizeStatusFields
  const lines = [
    '# 项目状态（STATUS）',
    '',
    `<!-- workspaceId: ${norm.workspaceId || 'unknown'} -->`,
    '',
    `- 当前阶段：${norm.stage || PENDING}`,
    ...listLines('- 最近里程碑', norm.milestones),
    ...listLines('- 进行中事项', norm.inProgress),
    `- 下次开工起点：${norm.nextStart || PENDING}`,
    ...listLines('- 关键技术决策', norm.keyDecisions),
    ...listLines('- 活跃约束', norm.constraints),
    `- 最近更新：${updatedAt}（来源：${source || PENDING}）`,
    '',
  ];
  return `${lines.join('\n')}\n`;
}

/** 文件是否超膨胀上限。 */
function overLimit(doc) {
  return Buffer.byteLength(doc, 'utf8') > FILE_MAX_BYTES || doc.split('\n').length > FILE_MAX_LINES;
}

/**
 * 二次膨胀压缩：单字段限长后仍超全文件上限时，逐级收紧字段限宽与数组条数，
 * 直到满足 ≤2KB 且 ≤80 行（guard 兜底防死循环，极端场景最后硬截）。
 * @returns {{doc:string, fitted:boolean}} fitted=true 表示动用了二级压缩
 */
function fitStatusDoc(norm, meta) {
  const base = renderStatusDoc(norm, meta);
  if (!overLimit(base)) return { doc: base, fitted: false };
  const steps = [
    { str: 300, item: 300, keep: { milestones: 8, inProgress: 12, keyDecisions: 5, constraints: 12 } },
    { str: 160, item: 160, keep: { milestones: 6, inProgress: 8, keyDecisions: 4, constraints: 8 } },
    { str: 80, item: 80, keep: { milestones: 5, inProgress: 5, keyDecisions: 3, constraints: 5 } },
    { str: 40, item: 40, keep: { milestones: 3, inProgress: 3, keyDecisions: 2, constraints: 3 } },
  ];
  const capped = (step) => {
    const milestones = norm.milestones.filter((m) => !m.startsWith('（更早'));
    const pointer = norm.milestones.find((m) => m.startsWith('（更早')) ?? null;
    const keepMs = milestones.slice(milestones.length - Math.min(step.keep.milestones, milestones.length));
    return normalizeStatusFields({
      stage: norm.stage.slice(0, step.str),
      milestones: pointer ? [...keepMs, pointer] : keepMs,
      inProgress: norm.inProgress.slice(0, step.keep.inProgress).map((s) => s.slice(0, step.item)),
      nextStart: norm.nextStart.slice(0, step.str),
      keyDecisions: norm.keyDecisions.slice(0, step.keep.keyDecisions).map((s) => s.slice(0, step.item)),
      constraints: norm.constraints.slice(0, step.keep.constraints).map((s) => s.slice(0, step.item)),
      workspaceId: norm.workspaceId,
    });
  };
  let doc = base;
  let norm2 = norm;
  let fitted = false;
  for (const step of steps) {
    if (!overLimit(doc)) return { doc, fitted };
    norm2 = capped(step);
    doc = renderStatusDoc(norm2, meta);
    fitted = true;
  }
  if (!overLimit(doc)) return { doc, fitted };
  // 硬底线：逐行保留头部直到越界（几乎不可达）
  const hard = [];
  for (const line of doc.split('\n')) {
    const candidate = [...hard, line].join('\n');
    if (overLimit(`${candidate}\n`)) break;
    hard.push(line);
  }
  return { doc: `${hard.join('\n')}\n`, fitted: true };
}

/** 内容 diff：统一换行、去行尾空白与文件尾空行后比较（无变化 → 不重写不滚动）。 */
function sameContent(a, b) {
  const clean = (text) => String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '\n');
  return clean(a) === clean(b);
}

/** 判重前剥离「最近更新」时间戳行：七字段业务内容未变即视为无变化（时间戳天然每轮不同）。 */
function stripStampLine(text) {
  return String(text ?? '').replace(/^- 最近更新：.*$/m, '');
}

/** 本地时间短格式（注入行与「最近更新」用）。 */
function localStamp(date) {
  const d = date instanceof Date ? date : new Date(date ?? Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 解析 STATUS.md 反提七字段（工具 merge 语义用：未传字段沿用旧值）。
 * 指针行（更早 N 条…）丢弃——merge 后按新输入重新计算压缩。
 * @returns {{stage:string, milestones:string[], inProgress:string[], nextStart:string, keyDecisions:string[], constraints:string[]}}
 */
export function parseStatusDoc(doc) {
  const empty = { stage: '', milestones: [], inProgress: [], nextStart: '', keyDecisions: [], constraints: [] };
  if (!doc) return empty;
  const out = { ...empty, milestones: undefined, inProgress: undefined, keyDecisions: undefined, constraints: undefined };
  const arrays = { milestones: [], inProgress: [], keyDecisions: [], constraints: [] };
  let current = null;
  for (const rawLine of String(doc).replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    const scalar = /^- (当前阶段|下次开工起点)：(.*)$/.exec(line);
    if (scalar) {
      const value = scalar[2].trim();
      out[scalar[1] === '当前阶段' ? 'stage' : 'nextStart'] = value === PENDING ? '' : value;
      current = null;
      continue;
    }
    const head = /^- (最近里程碑|进行中事项|关键技术决策|活跃约束)：$/.exec(line);
    if (head) {
      current = { 最近里程碑: 'milestones', 进行中事项: 'inProgress', 关键技术决策: 'keyDecisions', 活跃约束: 'constraints' }[head[1]];
      continue;
    }
    const item = /^  - (.*)$/.exec(line);
    if (item && current) {
      const value = item[1].trim();
      if (value && value !== PENDING && !value.startsWith('（更早')) arrays[current].push(value);
      continue;
    }
    if (line.startsWith('- ') || (line && !line.startsWith(' ') && !line.startsWith('#') && !line.startsWith('<'))) current = null;
  }
  return { ...out, ...arrays };
}

/**
 * workspaceId 解析：workspace.json 注册表按路径命中用注册 id；缺失/读不到时
 * 用路径 SHA-256 前 16 位兜底（规格第 8 条；路径比较不分大小写、收尾分隔符无关）。
 */
export async function workspaceIdFor(cwd, { workspaceJsonPath = DEFAULT_WORKSPACE_JSON } = {}) {
  const norm = (p) => String(p ?? '').replace(/[\\/]+$/, '').toLowerCase();
  try {
    const text = await fs.readFile(workspaceJsonPath, 'utf8');
    const table = JSON.parse(text)?.tables?.workspaces ?? {};
    for (const [id, entry] of Object.entries(table)) {
      if (entry?.path && norm(entry.path) === norm(cwd)) return id;
    }
  } catch {
    /* 注册表缺失 → SHA 兜底 */
  }
  return createHash('sha256').update(norm(cwd)).digest('hex').slice(0, 16);
}

/** Windows 上可靠的覆盖式 rename：目标已存在时先清再移。 */
async function replaceFile(from, to) {
  try {
    await fs.rename(from, to);
  } catch {
    await fs.rm(to, { force: true });
    await fs.rename(from, to);
  }
}

/**
 * STATUS 摘要指针行：一行摘要 + 本地更新时间，非裸路径（规格第 3 条）。
 * 总长硬上限 300 字符，防撑爆 MEMORY.md 首行。
 */
export function statusSummaryLine({ summary, updatedAt, source }) {
  const text = String(summary ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
  const parts = [text || PENDING, `（${localStamp(updatedAt)} 更新${source ? `，来源：${source}` : ''}；全文见 STATUS.md）`];
  return `${STATUS_LINE_PREFIX}${parts.join('')}`.slice(0, 300);
}

/**
 * 把 STATUS 摘要行插到 MEMORY.md 第一行固定位置（幂等：已有指针行则整行替换）。
 * 既有索引条目行原样保留，解析不受影响。
 */
export function injectStatusIntoIndex(indexText, statusLine) {
  const text = String(indexText ?? '');
  if (!text.trim()) return `${statusLine}\n`;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.startsWith(STATUS_LINE_PREFIX)) {
    lines[0] = statusLine;
    return lines.join('\n');
  }
  return [statusLine, '', ...lines].join('\n');
}

/**
 * 枚举可维护 STATUS 的工作区（规格第 2 条）：
 * 扫 <root>/<slug>/memory/ 目录 ∩ workspace.json path→slug 映射取交集，
 * 排除模式复用 WorkLog 日报规则（AppData-Local-Temp、modlens）。
 * 死目录（有 memory 未注册）与未落盘工作区（注册无 memory）都不生成。
 * @returns {Promise<Array<{id:string, path:string, slug:string, memDir:string}>>}
 */
export async function enumerateStatusTargets({ root, workspaceJsonPath = DEFAULT_WORKSPACE_JSON } = {}) {
  let table = {};
  try {
    table = JSON.parse(await fs.readFile(workspaceJsonPath, 'utf8'))?.tables?.workspaces ?? {};
  } catch {
    return []; // 注册表读不到 → 无交集，不生成
  }
  let dirs = [];
  try {
    dirs = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const memOf = (name) => dirs.find((d) => d.isDirectory() && d.name === name)?.name ?? null;
  const fuzzyIndex = new Map(dirs.filter((d) => d.isDirectory()).map((d) => [fuzzyKey(d.name), d.name]));

  const targets = [];
  for (const [id, entry] of Object.entries(table)) {
    const projectPath = entry?.path;
    if (!projectPath) continue;
    const slug = encodeProjectPath(projectPath);
    if (EXCLUDE_PATTERNS.some((pattern) => slug.includes(pattern) || projectPath.includes(pattern))) continue;
    let dirName = memOf(slug);
    if (!dirName) {
      const key = fuzzyKey(slug);
      if (!key) continue;
      const hit = fuzzyIndex.get(key);
      if (hit && !EXCLUDE_PATTERNS.some((pattern) => hit.includes(pattern))) dirName = hit;
    }
    if (!dirName) continue; // 注册但无记忆目录：暂不生成（首次记忆写入后自然进入枚举）
    const memDir = path.join(root, dirName, 'memory');
    try {
      if (!(await fs.stat(memDir)).isDirectory()) continue;
    } catch {
      continue;
    }
    targets.push({ id, path: projectPath, slug: dirName, memDir });
  }
  return targets;
}

/**
 * 落盘写入器：规整 → 渲染（含膨胀二次压缩）→ diff 判重 → 抢写保护 →
 * prev 滚动 → 原子写（tmp→rename，失败静默重试 1 次）→ MEMORY.md 一行摘要注入。
 * @param {object} args
 * @param {string} args.root 记忆根目录
 * @param {string} args.cwd 项目工作目录
 * @param {object} args.fields 七字段输入（允许缺省）
 * @param {string} [args.summary] MEMORY.md 注入用一行摘要
 * @param {string} [args.source] 最近更新来源说明
 * @param {string} [args.workspaceId] 显式指定则不查注册表
 * @param {Date|number} [args.now] 注入时钟（测试用）
 * @returns {Promise<{action:'created'|'updated'|'unchanged'|'skipped-locked', file:string, doc?:string,
 *   prevRaw:string|null, indexUpdated:boolean, indexLine:string, statusLine:string, truncated:boolean}>}
 */
export async function writeStatusFile({
  root, cwd, fields = {}, summary = '', source = '', workspaceId, now = new Date(), workspaceJsonPath,
} = {}) {
  const memDir = projectMemoryDir(root, cwd);
  await fs.mkdir(memDir, { recursive: true });
  const file = path.join(memDir, STATUS_FILE);
  const tmp = path.join(memDir, STATUS_TMP);
  const updatedAt = now instanceof Date ? now : new Date(now);

  let prevRaw = null;
  try {
    prevRaw = await fs.readFile(file, 'utf8');
  } catch {
    prevRaw = null;
  }

  // 抢写保护：新鲜的 .tmp 说明有并发写入，本次跳过（陈旧残留不阻塞，稍后清除）
  try {
    const st = await fs.stat(tmp);
    if (updatedAt.getTime() - st.mtime.getTime() < WRITE_LOCK_MS) {
      return { action: 'skipped-locked', file, prevRaw, indexUpdated: false, indexLine: '', statusLine: '', truncated: false };
    }
  } catch {
    /* 无 .tmp：正常 */
  }

  const wsId = workspaceId || (await workspaceIdFor(cwd, { workspaceJsonPath }));
  const { doc, fitted } = fitStatusDoc(normalizeStatusFields({ ...fields, workspaceId: wsId }), {
    updatedAt: updatedAt.toISOString(),
    source,
  });
  const statusLine = statusSummaryLine({ summary, updatedAt, source });

  if (prevRaw !== null && sameContent(stripStampLine(prevRaw), stripStampLine(doc))) {
    return { action: 'unchanged', file, doc, prevRaw, indexUpdated: false, indexLine: statusLine, statusLine, truncated: fitted };
  }

  // prev 滚动：prev1 → prev2，现文件 → prev1（仅在有变化时）
  const prev1 = path.join(memDir, STATUS_PREV1);
  const prev2 = path.join(memDir, STATUS_PREV2);
  if (prevRaw !== null) {
    try {
      await fs.rm(prev2, { force: true });
      try {
        await fs.rename(prev1, prev2);
      } catch {
        /* prev1 不存在：跳过 */
      }
      await fs.rename(file, prev1);
    } catch {
      /* 滚动失败不阻塞主写入（最坏情况：历史少滚一版） */
    }
  }

  // 原子写 + 失败静默重试 1 次（规格第 7 条）
  const writeOnce = async () => {
    await fs.writeFile(tmp, doc, 'utf8');
    await fs.rename(tmp, file);
  };
  try {
    await writeOnce();
  } catch {
    await fs.rm(tmp, { force: true });
    await writeOnce();
  }

  // MEMORY.md 第一行注入（幂等）
  let indexUpdated = false;
  try {
    const index = await readIndex(memDir);
    const next = injectStatusIntoIndex(index ?? '# 项目记忆索引\n', statusLine);
    if (next !== (index ?? '')) {
      await fs.writeFile(path.join(memDir, 'MEMORY.md'), next.replace(/\n*$/, '\n'), 'utf8');
      indexUpdated = true;
    }
  } catch {
    /* 注入失败不阻塞 STATUS 落盘 */
  }

  return {
    action: prevRaw === null ? 'created' : 'updated',
    file,
    doc,
    prevRaw,
    indexUpdated,
    indexLine: statusLine,
    statusLine,
    truncated: fitted,
  };
}
