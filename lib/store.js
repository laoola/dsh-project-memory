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

/** 拆出文件头 frontmatter（--- 包裹）；无 frontmatter 返回 null（与官方一致：绝不强加）。 */
function splitFrontmatter(text) {
  const m = /^(---\r?\n[\s\S]*?\r?\n---)(?:\r?\n)([\s\S]*)$/.exec(text);
  return m ? { fm: m[1], rest: m[2] } : null;
}

/** 在 frontmatter 内盖/更新 modified 时间戳（ISO8601），供人与新会话判断新鲜度。 */
function stampFrontmatter(fm) {
  const stamp = `modified: ${new Date().toISOString()}`;
  if (/(^|\n)modified:[^\n]*/.test(fm)) return fm.replace(/(^|\n)modified:[^\n]*/, `$1${stamp}`);
  return `${fm}\n${stamp}`;
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
  if (mode === 'replace') {
    // replace 重写正文，但已有 frontmatter 必须保留并刷新 modified（共库文件可能带 type 等官方字段）
    const parts = existing ? splitFrontmatter(existing) : null;
    const doc = parts
      ? `${stampFrontmatter(parts.fm)}\n\n# ${slug}\n\n${body}\n`
      : `# ${slug}\n\n${body}\n`;
    await fs.writeFile(file, doc, 'utf8');
    action = 'replaced';
  } else {
    const parts = existing ? splitFrontmatter(existing) : null;
    if (existing === null) {
      await fs.writeFile(file, `# ${slug}\n\n${body}\n`, 'utf8');
      action = 'created';
    } else {
      // 追加不动正文结构；带 frontmatter 的文件原地刷新 modified（无 frontmatter 绝不强加）
      const base = parts ? `${stampFrontmatter(parts.fm)}\n${parts.rest}` : existing;
      await fs.writeFile(file, `${base}\n\n${body}\n`, 'utf8');
      action = 'appended';
    }
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
 * 项目记忆目录内全文检索（索引 + 全部主题文件），大小写不敏感。
 * @returns {Array<{file:string, line:number, text:string}>}
 */
export async function searchMemory({ memDir, query, limit = 50 }) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return [];
  const files = [INDEX_FILE, ...(await listTopics(memDir))];
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
        hits.push({ file: name, line: i + 1, text: lines[i].trim() });
      }
    }
  }
  return hits;
}
