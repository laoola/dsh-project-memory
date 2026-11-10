/**
 * 记忆存储：沿用 Claude Code 记忆罗盘的目录与格式（PRD 决策 2）。
 * 布局：<root>/<编码后项目路径>/memory/{MEMORY.md, <topic>.md}
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { encodeProjectPath, fuzzyKey } from './paths.js';

export const INDEX_FILE = 'MEMORY.md';

/** 索引载入上限：对齐 Claude Code 官方自动记忆（每会话只加载 MEMORY.md 前 200 行或 25KB，先到为准）。 */
export const INDEX_MAX_LINES = 200;
export const INDEX_MAX_BYTES = 25 * 1024;
const INDEX_NEAR_RATIO = 0.8;

/**
 * 索引体量体检：超过上限时注入会截断、后半索引静默丢失，
 * 所以写入侧必须把 near/over 反馈给模型要求精简（对齐官方「超限返回错误要求重写」的做法）。
 */
export function indexLimitStatus(indexText) {
  const text = String(indexText ?? '');
  const lines = text.split('\n').length;
  const bytes = Buffer.byteLength(text, 'utf8');
  return {
    lines,
    bytes,
    near: lines >= Math.ceil(INDEX_MAX_LINES * INDEX_NEAR_RATIO) || bytes >= Math.ceil(INDEX_MAX_BYTES * INDEX_NEAR_RATIO),
    over: lines > INDEX_MAX_LINES || bytes > INDEX_MAX_BYTES,
  };
}

/** 受控子目录名（v0.3：技能候选与归档轨，代码层强制，不依赖提示词）。 */
export const SKILL_CANDIDATES_DIR = 'skill-candidates';
export const ARCHIVE_DIR = 'archive';
/** 全局习惯固定单文件（PRD 决策 7：受控单文件 + 专用注入，不开全局自由写）。 */
export const GLOBAL_HABITS_FILE = 'user-habits.md';

/** 拆出文件头 frontmatter（--- 包裹）；无 frontmatter 返回 null（与官方一致：绝不强加）。 */
function splitFrontmatter(text) {
  const m = /^(---\r?\n[\s\S]*?\r?\n---)(?:\r?\n)([\s\S]*)$/.exec(text);
  return m ? { fm: m[1], rest: m[2] } : null;
}

/** 本地日期 YYYY-MM-DD（候选 created / 归档 archived / 命中 last-access 用，不用 UTC 以免跨日漂移）。 */
function localDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function escapeForRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * YAML 标量序列化：number/boolean 直出；字符串含特殊结构（冒号空格/井号/引号/换行等）或形似数字/布尔时加双引号转义。
 */
export function formatYamlValue(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'boolean') return String(v);
  const s = String(v ?? '');
  if (s === '') return "''";
  if (
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    /: |\s$|\n|\r|\t/.test(s) ||
    /^(-?\d+(\.\d+)?)$/.test(s) ||
    /^(true|false|null|yes|no|on|off)$/i.test(s)
  ) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '').replace(/\n/g, '\\n')}"`;
  }
  return s;
}

/**
 * frontmatter 统一读写（v0.3 P0-2 前置修复）：在 frontmatter 块内插入/更新标量字段。
 * - 已有字段原地整行替换（保持位置与未知字段），新字段追加到块内末尾；正文逐字节不变（含换行风格）。
 * - 无 frontmatter：createHeader=true 时在正文前新建 YAML 头；否则原样返回（绝不强加）。
 * - 修复旧 stampFrontmatter 的 bug：无对应字段时新行被追加到结束 --- 之后混入正文。
 * @returns {{text:string, changed:boolean}} changed = 新旧全文是否有差异
 */
export function upsertFrontmatterFields(text, fields, { createHeader = false } = {}) {
  const input = String(text ?? '');
  const entries = Object.entries(fields ?? {}).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return { text: input, changed: false };
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)(\r?\n)([\s\S]*)$/.exec(input);
  if (!m) {
    if (!createHeader) return { text: input, changed: false };
    const header = ['---', ...entries.map(([k, v]) => `${k}: ${formatYamlValue(v)}`), '---', ''].join('\n');
    return { text: `${header}${input}`, changed: true };
  }
  const [, open, body, close, nlAfter, rest] = m;
  const nl = /\r\n/.test(`${open}${body}${close}`) ? '\r\n' : '\n';
  let next = body;
  for (const [key, value] of entries) {
    const line = `${key}: ${formatYamlValue(value)}`;
    const re = new RegExp(`(^|\\r?\\n)${escapeForRegExp(key)}:[^\\r\\n]*`);
    if (re.test(next)) next = next.replace(re, (full, lead) => `${lead}${line}`);
    else next = `${next}${nl}${line}`;
  }
  const out = `${open}${next}${close}${nlAfter}${rest}`;
  return { text: out, changed: out !== input };
}

async function isDir(p) {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/** 确定性的项目记忆目录（不探测存在性，写入侧用）。 */
export function projectMemoryDir(root, cwd) {
  return path.join(root, encodeProjectPath(cwd), 'memory');
}

/**
 * 解析已存在的项目记忆目录；不存在返回 null（注入侧静默跳过）。
 * 先精确匹配编码名，再按模糊键匹配（消化盘符大小写/中文漂移）。
 */
export async function resolveMemoryDir(root, cwd) {
  const exact = projectMemoryDir(root, cwd);
  if (await isDir(exact)) return exact;
  const target = fuzzyKey(encodeProjectPath(cwd));
  if (!target) return null;
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || fuzzyKey(entry.name) !== target) continue;
    const mem = path.join(root, entry.name, 'memory');
    if (await isDir(mem)) return mem;
  }
  return null;
}

/**
 * 旧布局探测（2026-10-20）：Claude Code 旧版把 MEMORY.md 直接放 `<root>/<slug>/` 根下，
 * 现役布局是 `<root>/<slug>/memory/`。新布局存在时以新布局为准（返回 null，不告警）。
 * @returns {Promise<string|null>} 旧布局目录（根下有 MEMORY.md 但无 memory/ 子目录时）
 */
export async function resolveLegacyMemoryDir(root, cwd) {
  if (await isDir(projectMemoryDir(root, cwd))) return null; // 新布局存在：不是旧布局孤儿
  const encoded = encodeProjectPath(cwd);
  const candidates = [path.join(root, encoded)];
  const target = fuzzyKey(encoded);
  if (target) {
    let entries = [];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== encoded && fuzzyKey(entry.name) === target) {
        candidates.push(path.join(root, entry.name));
      }
    }
  }
  for (const dir of candidates) {
    try {
      if ((await fs.stat(path.join(dir, INDEX_FILE))).isFile()) return dir;
    } catch {
      // 该候选无根下索引：继续下一个
    }
  }
  return null;
}

/** 读 MEMORY.md 索引全文；不存在返回 null。 */
export async function readIndex(memDir) {
  try {
    return await fs.readFile(path.join(memDir, INDEX_FILE), 'utf8');
  } catch {
    return null;
  }
}

/** 主题 slug：去掉路径分隔符与控制字符，压缩空白，限 80 字符。 */
export function sanitizeTopic(topic) {
  return String(topic ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
}

/** 写通道的原始 topic 校验：拒绝路径分隔符与穿越形式（代码层强制；子目录只经 target/scope/mode 受控进入）。 */
function assertPlainTopic(topic) {
  const raw = String(topic ?? '');
  if (!raw.trim()) throw new Error(`topic 无效：${JSON.stringify(topic)}（需为非空文件名，不含路径分隔符）`);
  if (/[\\/]/.test(raw)) throw new Error(`topic 无效：不允许路径分隔符（收到 ${JSON.stringify(raw)}；归档读取用 archive/<主题>）`);
  if (raw === '.' || raw === '..') throw new Error('topic 无效：不能为 . 或 ..');
}

/** 列出主题文件（不含索引），仅文件名。 */
export async function listTopics(memDir) {
  try {
    const entries = await fs.readdir(memDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md') && e.name !== INDEX_FILE)
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * 写入记忆：主题文件创建/追加/重写 + MEMORY.md 索引整行幂等更新。
 * 目录不存在则创建（新项目第一条记忆）。索引更新按 `](slug.md)` 定位旧行整行替换，避免并发写撕裂。
 * @returns {{ok:true, slug, file, index, action:'created'|'appended'|'replaced', indexStatus:{lines:number, bytes:number, near:boolean, over:boolean}}}
 * @throws 目录/文件不可写等 fs 错误原样抛出（US-2：明确报错，不静默丢失）
 */
export async function writeMemory({ root, cwd, topic, summary, content, mode = 'append' }) {
  assertPlainTopic(topic);
  const slug = sanitizeTopic(topic);
  if (!slug) throw new Error(`topic 无效：${JSON.stringify(topic)}（需为非空文件名，不含路径分隔符）`);
  const body = String(content ?? '').trim();
  if (!body) throw new Error('content 为空：不写空记忆（写入门槛：只记跨会话有效结论）。');
  const oneLine = String(summary ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
  if (!oneLine) throw new Error('summary 为空：索引行需要一行摘要。');

  const memDir = projectMemoryDir(root, cwd);
  await fs.mkdir(memDir, { recursive: true });
  const file = path.join(memDir, `${slug}.md`);

  let action;
  let existing = null;
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch {
    existing = null;
  }
  const modified = new Date().toISOString();
  if (mode === 'replace') {
    // replace 重写正文，但已有 frontmatter 必须保留并刷新 modified（共库文件可能带 type 等官方字段）
    let doc = `# ${slug}\n\n${body}\n`;
    if (existing !== null) {
      const stamped = upsertFrontmatterFields(existing, { modified }, { createHeader: false });
      const parts = splitFrontmatter(stamped.text);
      if (parts) doc = `${parts.fm}\n\n# ${slug}\n\n${body}\n`;
    }
    await fs.writeFile(file, doc, 'utf8');
    action = 'replaced';
  } else if (existing === null) {
    await fs.writeFile(file, `# ${slug}\n\n${body}\n`, 'utf8');
    action = 'created';
  } else {
    // 追加不动正文结构；带 frontmatter 的文件原地刷新 modified（无 frontmatter 绝不强加；modified 落在块内）
    const stamped = upsertFrontmatterFields(existing, { modified }, { createHeader: false });
    await fs.writeFile(file, `${stamped.text}\n\n${body}\n`, 'utf8');
    action = 'appended';
  }

  // 索引整行幂等更新：匹配 `](<slug>.md)` 定位既有行
  const linkToken = `](${slug}.md)`;
  const indexLine = `- [${slug}](${slug}.md) — ${oneLine}`;
  const indexPath = path.join(memDir, INDEX_FILE);
  let index = await readIndex(memDir);
  if (index === null) index = '# 项目记忆索引\n';
  const lines = index.replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex((line) => line.includes(linkToken));
  if (at >= 0) lines[at] = indexLine;
  else {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push('', indexLine);
  }
  await fs.writeFile(indexPath, lines.join('\n').replace(/\n*$/, '\n'), 'utf8');

  return { ok: true, slug, file, index: indexPath, action, indexStatus: indexLimitStatus(lines.join('\n')) };
}

/**
 * 项目记忆目录内全文检索（索引 + 全部主题文件 + 归档区单层），大小写不敏感。
 * @returns {Array<{file:string, line:number, text:string, archived:boolean}>} 归档命中 file 带 archive/ 前缀且 archived=true
 */
export async function searchMemory({ memDir, query, limit = 50 }) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return [];
  const files = [INDEX_FILE, ...(await listTopics(memDir))];
  // 归档区单层参与检索（不递归更深子目录）；候选目录不入记忆检索
  try {
    const entries = await fs.readdir(path.join(memDir, ARCHIVE_DIR), { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.md') && e.name !== INDEX_FILE) {
        files.push(`${ARCHIVE_DIR}/${e.name}`);
      }
    }
  } catch {
    // 无归档目录：跳过
  }
  const hits = [];
  for (const name of files) {
    let text;
    try {
      text = await fs.readFile(path.join(memDir, name), 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (hits.length >= limit) return hits;
      if (lines[i].toLowerCase().includes(needle)) {
        hits.push({ file: name, line: i + 1, text: lines[i].trim(), archived: name.startsWith(`${ARCHIVE_DIR}/`) });
      }
    }
  }
  return hits;
}

/** 候选文件尾部固定升格说明（人工操作契约；正式加载前删除）。 */
const SKILL_PROMOTION_NOTES = [
  '## 升格说明（人工操作时阅读；正式加载前删除本节）',
  '',
  '1. 新建 `~/.agents/skills/<name>/SKILL.md`：保留上方 frontmatter 的 name 与 description（触发词已融入 description，无需单独字段）。',
  '2. 只复制上方草稿正文；删除 triggers/created/source/status 与本升格说明。',
  '3. 以技能加载器实际发现并可加载为准。',
].join('\n');

/**
 * 技能候选落盘（P0-1）：memory/skill-candidates/<slug>.md，永不写索引、永不自动注入。
 * 只有整体重写语义（同 slug 重写保留首次 created）；升格=用户手工整理移入 ~/.agents/skills（插件零依赖）。
 * @returns {{ok:true, slug:string, file:string, dir:string, created:string, rewrote:boolean}}
 */
export async function writeSkillCandidate({ root, cwd, topic, content, description, triggers }) {
  assertPlainTopic(topic);
  const slug = sanitizeTopic(topic);
  if (!slug) throw new Error(`topic 无效：${JSON.stringify(topic)}`);
  const body = String(content ?? '').trim();
  if (!body) throw new Error('content 为空：技能候选需要 SKILL.md 草稿正文。');
  const desc = String(description ?? '').trim().replace(/\s+/g, ' ');
  if (!desc) throw new Error('description 为空：候选需要一行用途描述（升格后成为 SKILL.md 的 description）。');
  const trigList = (Array.isArray(triggers) ? triggers : triggers == null ? [] : [triggers])
    .map((t) => String(t ?? '').trim())
    .filter(Boolean);
  // 触发词融入 description：升格后的正式 SKILL.md 无需单独 triggers 字段
  const fullDesc = trigList.length ? `${desc}；触发词：${trigList.join('、')}` : desc;

  const dir = path.join(projectMemoryDir(root, cwd), SKILL_CANDIDATES_DIR);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${slug}.md`);

  let rewrote = false;
  let created = localDate();
  try {
    const old = await fs.readFile(file, 'utf8');
    rewrote = true;
    const m = /(?:^|\r?\n)created:\s*([^\r\n]+)/.exec(old);
    if (m) created = m[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    // 新候选
  }

  const fmLines = [
    '---',
    `name: ${formatYamlValue(slug)}`,
    `description: ${formatYamlValue(fullDesc)}`,
  ];
  if (trigList.length) fmLines.push(`triggers: [${trigList.map((t) => formatYamlValue(t)).join(', ')}]`);
  fmLines.push(
    `created: ${formatYamlValue(created)}`,
    `source: ${formatYamlValue(`会话提取 ${localDate()}`)}`,
    'status: candidate',
    '---',
  );
  const doc = `${fmLines.join('\n')}\n\n# ${slug}（技能候选草稿）\n\n${body}\n\n---\n\n${SKILL_PROMOTION_NOTES}\n`;
  await fs.writeFile(file, doc, 'utf8');
  return { ok: true, slug, file, dir, created, rewrote };
}

/** 归档禁止清单：索引与 STATUS 快照是系统文件，不进归档轨。 */
const ARCHIVE_FORBIDDEN = ['memory.md', 'status.md', 'status.prev1.md', 'status.prev2.md'];

/**
 * 主题归档（P0-3）：memory/<slug>.md → memory/archive/<slug>.md，索引摘行，frontmatter 加 archived 日期。
 * 分阶段失败恢复：复制（临时文件+改名）→ 摘索引（快照+原子写）→ 删源；任一步失败宁可双份不可丢份。
 * @param {object} [hooks] 测试故障注入点：afterArchiveCopy / afterIndexUpdate（async 函数，可 throw 模拟中断）
 * @returns {{ok:true, slug:string, archived:string, archivedDate:string, removed:string, indexUpdated:boolean}}
 */
export async function archiveTopic({ root, cwd, topic, hooks = {} }) {
  assertPlainTopic(topic);
  const slug = sanitizeTopic(topic);
  if (!slug) throw new Error(`topic 无效：${JSON.stringify(topic)}`);
  if (ARCHIVE_FORBIDDEN.includes(`${slug.toLowerCase()}.md`)) {
    throw new Error(`禁止归档系统文件：${slug}.md（索引与 STATUS 快照不进归档轨）。`);
  }
  const memDir = await resolveMemoryDir(root, cwd);
  if (!memDir) throw new Error('当前项目还没有记忆目录，无可归档主题。');
  const src = path.join(memDir, `${slug}.md`);
  let original;
  try {
    original = await fs.readFile(src, 'utf8');
  } catch {
    throw new Error(`主题文件不存在：${slug}.md（可用主题见 memory_read 不带 topic 时的列表）`);
  }
  const archiveDir = path.join(memDir, ARCHIVE_DIR);
  const dst = path.join(archiveDir, `${slug}.md`);
  let dstExists = false;
  try {
    await fs.access(dst);
    dstExists = true;
  } catch {
    dstExists = false;
  }
  if (dstExists) throw new Error(`archive/${slug}.md 已存在：拒绝覆盖。请先手工处理归档副本，或换主题名。`);

  // 阶段 1：复制进归档区（临时文件 + 改名），frontmatter 加 archived 日期
  await fs.mkdir(archiveDir, { recursive: true });
  const archivedDate = localDate();
  const stamped = upsertFrontmatterFields(original, { archived: archivedDate }, { createHeader: true });
  const tmp = path.join(archiveDir, `.${slug}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, stamped.text, 'utf8');
  try {
    await fs.rename(tmp, dst);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw new Error(`归档失败：写入归档副本出错（${e.message}）。原文件未动。`);
  }
  await hooks.afterArchiveCopy?.();

  // 阶段 2：从索引摘除该行（快照 + 原子写；失败则保留双份并明确报错，不删源）
  const indexPath = path.join(memDir, INDEX_FILE);
  const indexSnap = await readIndex(memDir);
  const linkToken = `](${slug}.md)`;
  const indexUpdated = indexSnap !== null && indexSnap.includes(linkToken);
  if (indexUpdated) {
    const lines = indexSnap.replace(/\r\n/g, '\n').split('\n').filter((l) => !l.includes(linkToken));
    const nextIndex = lines.join('\n').replace(/\n*$/, '\n');
    const tmpIndex = `${indexPath}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(tmpIndex, nextIndex, 'utf8');
      await fs.rename(tmpIndex, indexPath);
    } catch (e) {
      await fs.rm(tmpIndex, { force: true }).catch(() => {});
      throw new Error(`归档中断：索引摘除失败（${e.message}）。原文件与归档副本均保留（双份），可安全重试。`);
    }
  }
  try {
    await hooks.afterIndexUpdate?.();
  } catch (e) {
    // 本阶段中断：恢复索引快照，双份保留可安全重试（不留「索引已摘、源未删」的中间态）
    if (indexUpdated) {
      await fs.writeFile(indexPath, indexSnap, 'utf8').catch(() => {});
    }
    throw new Error(
      `归档中断：索引摘除后未完成（${e.message}）。索引已恢复原样；原文件与归档副本均保留（双份），可安全重试。`,
    );
  }

  // 阶段 3：删源（失败则恢复索引快照并保留双份，明确报错；源删除成功前绝不清理归档副本）
  try {
    await fs.rm(src);
  } catch (e) {
    let restored = false;
    if (indexSnap !== null) {
      try {
        await fs.writeFile(indexPath, indexSnap, 'utf8');
        restored = true;
      } catch {
        restored = false;
      }
    }
    throw new Error(
      `归档中断：删除原文件失败（${e.message}）。${restored ? '索引已恢复原样' : '索引恢复失败，请手工核对 MEMORY.md'}；原文件与归档副本均保留（双份）。`,
    );
  }
  return { ok: true, slug, archived: dst, archivedDate, removed: src, indexUpdated };
}

/** 对主题全文打一次命中补丁（块内 last-access=今日、hits+1；无 frontmatter 时新建头）。 */
function stampHit(text) {
  const m = /(?:^|\r?\n)hits:\s*"?(\d+)"?/.exec(text);
  const hits = m ? Number.parseInt(m[1], 10) || 0 : 0;
  return upsertFrontmatterFields(text, { 'last-access': localDate(), hits: hits + 1 }, { createHeader: true }).text;
}

/**
 * 命中统计回写（P0-2）：memory_read/memory_search 命中主题文件后调用；每次调用该文件 hits+1。
 * 并发防覆盖：回写前重读，若相对初始快照已变化，基于最新内容重放一次补丁；仍在变则放弃本次计数。
 * 统计回写失败一律静默（返回 false），不影响读取结果返回；保真=未知字段与正文逐字节不动。
 * @returns {Promise<boolean>} 是否成功写入
 */
export async function recordHit(memDir, slug, { _between } = {}) {
  const file = path.join(memDir, `${slug}.md`);
  let before;
  try {
    before = await fs.readFile(file, 'utf8');
  } catch {
    return false;
  }
  if (_between) await _between();
  let latest;
  try {
    latest = await fs.readFile(file, 'utf8');
  } catch {
    return false;
  }
  let text = stampHit(before);
  if (latest !== before) {
    text = stampHit(latest); // 有并发改动：基于最新内容重放一次
    let again;
    try {
      again = await fs.readFile(file, 'utf8');
    } catch {
      return false;
    }
    if (again !== latest) return false; // 仍在被并发写：放弃本次计数（宁缺不乱）
  }
  const tmp = `${file}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, file);
    return true;
  } catch {
    return false; // 统计回写失败静默
  }
}

/** 全局库目录（与 Claude Code 记忆罗盘全局库共库：<root>/_global/memory）。 */
export function globalMemoryDir(root) {
  return path.join(root, '_global', 'memory');
}

/**
 * 全局习惯写入（P0-4）：固定单文件 _global/memory/user-habits.md（PRD 决策 7：受控单文件，不开全局自由写）。
 * 全局索引 MEMORY.md 只幂等更新 user-habits 一行，不重排、不改写其他行（人工分区结构保持）。
 * @returns {{ok:true, file:string, index:string, action:'created'|'appended'|'replaced', chars:number}}
 */
export async function writeGlobalHabits({ root, summary, content, mode = 'append' }) {
  const body = String(content ?? '').trim();
  if (!body) throw new Error('content 为空：不写空记忆。');
  const oneLine = String(summary ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
  if (!oneLine) throw new Error('summary 为空：全局索引行需要一行摘要。');

  const dir = globalMemoryDir(root);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, GLOBAL_HABITS_FILE);
  let existing = null;
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch {
    existing = null;
  }
  const modified = new Date().toISOString();
  let action;
  let doc;
  if (mode === 'replace' && existing !== null) {
    const stamped = upsertFrontmatterFields(existing, { modified }, { createHeader: false });
    const parts = splitFrontmatter(stamped.text);
    doc = parts ? `${parts.fm}\n\n# user-habits\n\n${body}\n` : `# user-habits\n\n${body}\n`;
    action = 'replaced';
  } else if (existing === null) {
    doc = `# user-habits\n\n${body}\n`;
    action = 'created';
  } else {
    const stamped = upsertFrontmatterFields(existing, { modified }, { createHeader: false });
    doc = `${stamped.text}\n\n${body}\n`;
    action = 'appended';
  }
  await fs.writeFile(file, doc, 'utf8');

  const indexPath = path.join(dir, INDEX_FILE);
  let index = await readIndex(dir);
  if (index === null) index = '# 全局记忆索引\n';
  const linkToken = `](${GLOBAL_HABITS_FILE})`;
  const indexLine = `- [user-habits](${GLOBAL_HABITS_FILE}) — ${oneLine}`;
  const lines = index.replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex((l) => l.includes(linkToken));
  if (at >= 0) lines[at] = indexLine;
  else {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push('', indexLine);
  }
  await fs.writeFile(indexPath, lines.join('\n').replace(/\n*$/, '\n'), 'utf8');
  return { ok: true, file, index: indexPath, action, chars: doc.length };
}
