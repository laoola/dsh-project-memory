/**
 * 知识库面板 host 路由（0.2，PRD v0.2 决策 1/2/6）。
 *
 * 纯只读 HTTP API：host 直读磁盘，无第二索引、无同步、无写入端点。
 * - GET <prefix>/api/overview          分区概览（全局记忆 / 项目记忆 / 本地知识源）
 * - GET <prefix>/api/list?section=<id> 某分区文件清单（含标题+一行摘要）
 * - GET <prefix>/api/file?path=<abs>   读单个 .md（路径防护：仅允许根下）
 * - GET <prefix>/api/search?q=<query>  跨分区全文检索（复用 store.searchMemory 同逻辑：命中行）
 *
 * 设计约束：
 * - API 层（createPanelApi）与 HTTP 层（registerPanelRoutes）分离：API 层可被
 *   node:test 直接驱动（test/routes.test.mjs），不需要真实 webServer。
 * - 响应 envelope 对齐 DSH 客户端约定：{ ok:true, value } / { ok:false, error:{code,message} }。
 * - 知识源配置化（决策 2/7）：config.knowledgeSources 可覆盖；缺省探测
 *   ~/.agents/skills 与 ~/.dsh/docs，存在才注册，绝不硬编码本机绝对路径（验收 10）。
 */
import { promises as fs, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { encodeProjectPath, fuzzyKey } from './paths.js';
import { INDEX_FILE, listTopics, searchMemory } from './store.js';

/** 面板路由前缀（client bundle 的 fetch 同源路径也以此为基）。 */
export const PANEL_ROUTE_PREFIX = '/dsh-project-memory';

const MARKDOWN_EXT = '.md';
/** 搜索扫描上限：文件数 / 总命中行数（防巨树拖垮 host）。 */
const SEARCH_MAX_FILES = 2000;
const SEARCH_MAX_LINES = 300;
/** 每文件最多返回命中行数（原型交互：按文件分组展示至多 3 条）。 */
const SEARCH_HITS_PER_FILE = 3;
/** 清单摘要探测的每文件读取上限。 */
const SUMMARY_READ_BYTES = 2048;

// ————————————————————————————————————————————————————————————
// 通用小件
// ————————————————————————————————————————————————————————————

async function isDir(p) {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** 路径穿越防护（对齐 dsh-taskboard insideWorktreeScope 范式）：target 必须解析到 scope 内。 */
export function isInsideScope(scope, target) {
  const s = path.resolve(scope);
  const t = path.resolve(target);
  return t === s || t.startsWith(s + path.sep);
}

/**
 * 归一化知识源配置：非法项跳过（不抛错——配置错误不能炸掉记忆注入主链路）。
 * @returns {Array<{id:string,label:string,description:string,root:string}>}
 */
export function normalizeKnowledgeSources(raw, logger = console) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object' || typeof item.root !== 'string' || !item.root) {
      logger.warn?.(`[project-memory] knowledgeSources[${i}] 缺 root，已跳过`);
      return;
    }
    out.push({
      id: typeof item.id === 'string' && item.id ? item.id : `src-${i}`,
      label: typeof item.label === 'string' && item.label ? item.label : path.basename(item.root),
      description: typeof item.description === 'string' ? item.description : '',
      root: item.root,
    });
  });
  return out;
}

/**
 * 缺省知识源探测（决策 2「预置 docs 与技能目录两源」）：
 * 全部 home 相对路径 + 存在才注册 → 零本机硬编码（验收 10）。
 */
export async function detectDefaultKnowledgeSources(home = homedir()) {
  const sources = [];
  const skillsRoot = path.join(home, '.agents', 'skills');
  if (await isDir(skillsRoot)) {
    sources.push({ id: 'skills', label: '技能库', description: '已安装技能的 SKILL.md 说明文档', root: skillsRoot });
  }
  const docsRoot = path.join(home, '.dsh', 'docs');
  if (await isDir(docsRoot)) {
    sources.push({ id: 'dsh-docs', label: '本地文档', description: '~/.dsh/docs 下的本地 Markdown 文档', root: docsRoot });
  }
  return sources;
}

// ————————————————————————————————————————————————————————————
// 分区模型：id 约定 global / p:<编码目录名> / s:<sourceId>
// ————————————————————————————————————————————————————————————

/** 全局记忆目录（Claude Code 记忆罗盘约定：<root>/_global/memory）。 */
export function globalMemoryDir(root) {
  return path.join(root, '_global', 'memory');
}

/** 校验编码目录名：只允许单个路径段（防 encoded 位置被注入分隔符）。 */
function safeDirName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !/[/\\:]/.test(name)
  );
}

/** 列出记忆根下的项目记忆目录（编码目录名 + memory 子目录存在才计入）。 */
export async function listProjectMemoryDirs(root) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !safeDirName(entry.name) || entry.name === '_global') continue;
    const mem = path.join(root, entry.name, 'memory');
    if (await isDir(mem)) dirs.push({ name: entry.name, memDir: mem });
  }
  return dirs;
}

/**
 * 知识源根下的入口文件（两层深度：根下 *.md + 子目录下的 SKILL.md）。
 * @returns {Promise<Array<{path:string,name:string}>>}
 */
export async function listSourceEntries(sourceRoot) {
  let entries;
  try {
    entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(MARKDOWN_EXT)) {
      files.push({ path: path.join(sourceRoot, entry.name), name: entry.name });
      continue;
    }
    if (entry.isDirectory()) {
      const skill = path.join(sourceRoot, entry.name, 'SKILL.md');
      try {
        if ((await fs.stat(skill)).isFile()) files.push({ path: skill, name: `${entry.name}/SKILL.md` });
      } catch { /* 无 SKILL.md：跳过 */ }
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

/** 搜索扫描的目标文件集合：记忆区单层 *.md，知识源两层（根下一层 md + 子目录一层 md）。 */
async function collectSearchTargets(memDirs, sources) {
  const targets = [];
  const seen = new Set();
  const push = (p, sectionId) => {
    if (seen.has(p) || targets.length >= SEARCH_MAX_FILES) return;
    seen.add(p);
    targets.push({ path: p, sectionId });
  };
  for (const mem of memDirs) {
    for (const name of [INDEX_FILE, ...(await listTopics(mem.dir))]) {
      push(path.join(mem.dir, name), mem.sectionId);
    }
  }
  for (const source of sources) {
    for (const entry of await listSourceEntries(source.root)) push(entry.path, source.sectionId);
    // 第二层：子目录下全部 *.md（SKILL.md 之外的知识文件也参与检索）
    let subEntries;
    try {
      subEntries = await fs.readdir(source.root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of subEntries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(source.root, entry.name);
      let files;
      try {
        files = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of files) {
        if (f.isFile() && f.name.toLowerCase().endsWith(MARKDOWN_EXT)) {
          push(path.join(dir, f.name), source.sectionId);
        }
      }
    }
  }
  return targets;
}

// ————————————————————————————————————————————————————————————
// 摘要/标题提取（清单行与阅读头共用）
// ————————————————————————————————————————————————————————————

/** 解析 SKILL.md frontmatter 里的 name/description（其余字段忽略）。 */
function parseFrontmatterFields(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line.trim());
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return fields;
}

/**
 * 从 Markdown 正文提取 (title, summary)：
 * 首个 `# ` 标题行 + 首段非空正文（剥离列表/引用标记），各限长。
 */
export function extractTitleSummary(text, fallbackName) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  const lines = body.split(/\r?\n/);
  let title = '';
  let summary = '';
  for (const line of lines) {
    const h = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      title = h[1].trim();
      break;
    }
    if (line.trim()) break; // 标题前的非空非标题内容：正文开始，无标题
  }
  for (const line of lines) {
    if (/^#/.test(line)) continue;
    const t = line.replace(/^[-*>\s]+/, '').trim();
    if (t) {
      summary = t;
      break;
    }
  }
  return {
    title: title || fallbackName.replace(/\.md$/i, ''),
    summary: summary.slice(0, 140),
  };
}

/** MEMORY.md 索引行 → { 'topic.md': summary }（writeMemory 的索引格式：- [topic](file) — summary）。 */
function parseIndexSummaries(indexText) {
  const map = new Map();
  for (const line of String(indexText ?? '').split(/\r?\n/)) {
    const m = /^[-*]\s*\[(.+?)\]\((.+?\.md)\)\s*[—-]+\s*(.*)$/.exec(line.trim());
    if (m) map.set(m[2], m[3].slice(0, 160));
  }
  return map;
}

/**
 * home 缩写：home 下的绝对路径改为 ~\... 形式（路径行展示惯例），否则原样返回。
 * @param {string} input
 * @param {string=} home
 */
export function homizePath(input, home) {
  if (typeof input !== 'string' || input === '') return input;
  const base = path.normalize(home || homedir());
  const norm = path.normalize(input);
  const lower = norm.toLowerCase();
  const baseLower = base.toLowerCase();
  if (lower === baseLower) return '~';
  if (lower.startsWith(baseLower + path.sep)) return `~${norm.slice(base.length)}`;
  return norm;
}

/**
 * 编码目录名启发展示名（兜底，非解码）：剥盘符前缀后的完整尾体。
 * 不拆 '-' 段——项目名自身含连字符（如 proj-a）时尾段启发会切碎成 'a'，
 * 保留全尾体宁可长一点（client 端 truncateMiddle 兜截）也不误导。
 * @param {string} encoded
 * @returns {string|undefined}
 */
export function guessEncodedTail(encoded) {
  if (typeof encoded !== 'string' || encoded === '') return undefined;
  const body = /^[A-Za-z]--/.test(encoded) ? encoded.slice(3) : encoded;
  return body || undefined;
}

/**
 * 真实项目路径清单：读 ~/.claude.json 顶层 projects 键（Claude Code 维护的
 * 历史 cwd 绝对路径），正向 encodeProjectPath 后与记忆根的编码目录名精确匹配。
 * 正向编码是确定性映射，命中即可信；清单缺失/损坏时返回空表，调用方退化到
 * guessEncodedTail 启发名。
 * @param {string=} home
 * @returns {Map<string, {name:string, displayPath:string, path:string}>}
 */
export function loadProjectNameIndex(home) {
  try {
    const raw = readFileSync(path.join(home || homedir(), '.claude.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const projects = parsed && typeof parsed === 'object' ? parsed.projects : undefined;
    if (!projects || typeof projects !== 'object') return new Map();
    const index = new Map();
    for (const candidate of Object.keys(projects)) {
      const encoded = encodeProjectPath(candidate);
      if (!encoded || index.has(encoded)) continue;
      const entry = {
        name: path.basename(candidate.replace(/[\\/]+$/, '')) || encoded,
        displayPath: homizePath(candidate, home),
        path: candidate,
      };
      index.set(encoded, entry);
      // 编码漂移兜底（同 resolveMemoryDir 的 fuzzyKey 策略）：~/.claude.json 的键是正斜杠
      // （如 D:/GC/Code/DWM → 精确编码 D--GC-Code-DWM），而存量记忆目录可能是 d--GC-Code-DWM
      // （盘符小写），精确键必 miss。注册一份模糊键别名；精确键始终优先。
      const fuzzy = fuzzyKey(encoded);
      if (fuzzy && fuzzy !== encoded && !index.has(fuzzy)) index.set(fuzzy, entry);
    }
    return index;
  } catch {
    return new Map();
  }
}

/** nameIndex 查找：精确编码优先，未命中按模糊键回退（消化盘符大小写/分隔符编码漂移）。 */
function lookupProjectAlias(nameIndex, encoded) {
  const hit = nameIndex.get(encoded);
  if (hit) return hit;
  const fuzzy = fuzzyKey(encoded);
  return fuzzy ? nameIndex.get(fuzzy) : undefined;
}

// ————————————————————————————————————————————————————————————
// API 层（可单测，不依赖 webServer）
// ————————————————————————————————————————————————————————————

/**
 * @param {{memoryRoot:string, knowledgeSources?:Array|Promise<Array>, home?:string,
 *   nameIndex?:Map<string, {name:string, displayPath:string}>}} options
 *   nameIndex：编码目录名 → 真实项目展示信息（loadProjectNameIndex 产物；缺省空表）。
 */
export function createPanelApi(options) {
  const root = path.resolve(options.memoryRoot);
  const nameIndex = options.nameIndex instanceof Map ? options.nameIndex : new Map();
  const home = options?.home;
  const sourcesInput = options.knowledgeSources !== undefined
    ? Promise.resolve(options.knowledgeSources).then((raw) => normalizeKnowledgeSources(raw))
    : detectDefaultKnowledgeSources(options?.home);

  /** 分区视图：把三类分区统一成 {sectionId, kind, dir} 的工作集。 */
  async function buildSections() {
    const sources = await sourcesInput;
    const sections = [];
    const globalDir = globalMemoryDir(root);
    if (await isDir(globalDir)) sections.push({ sectionId: 'global', kind: 'memory', dir: globalDir });
    for (const project of await listProjectMemoryDirs(root)) {
      sections.push({ sectionId: `p:${project.name}`, kind: 'memory', dir: project.memDir });
    }
    for (const source of sources) {
      if (await isDir(source.root)) {
        sections.push({ sectionId: `s:${source.id}`, kind: 'source', dir: source.root, source });
      }
    }
    return sections;
  }

  async function statFiles(dir, names) {
    const out = [];
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        const st = await fs.stat(full);
        out.push({ name, path: full, mtimeMs: st.mtimeMs, size: st.size });
      } catch { /* 竞态删除：跳过 */ }
    }
    return out;
  }

  return {
    /** GET /api/overview */
    async overview() {
      const sections = await buildSections();
      const sources = await sourcesInput;
      const globalDir = globalMemoryDir(root);
      const projects = [];
      let globalCount = 0;
      let globalExists = false;
      for (const section of sections) {
        if (section.sectionId === 'global') {
          globalExists = true;
          globalCount = (await listTopics(section.dir)).length + 1; // 主题 + 索引
          continue;
        }
        if (section.kind === 'memory') {
          const names = await listTopics(section.dir);
          const files = await statFiles(section.dir, [INDEX_FILE, ...names]);
          const mtimeMs = files.reduce((max, f) => Math.max(max, f.mtimeMs), 0);
          const encoded = path.basename(path.dirname(section.dir));
          const alias = lookupProjectAlias(nameIndex, encoded);
          projects.push({
            id: section.sectionId,
            dir: encoded, // 编码目录名：仅作分区 id 锚点，展示交给 name/displayPath
            name: (alias && alias.name) || guessEncodedTail(encoded),
            ...(alias && alias.displayPath ? { displayPath: alias.displayPath } : {}),
            // 废弃项目标注（P1）：反解出真实路径后探测存在性；无 ~/.claude.json 记录时不给该字段
            ...(alias?.path ? { pathExists: await isDir(alias.path) } : {}),
            fileCount: files.length,
            mtimeMs,
          });
        }
      }
      projects.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const sourceList = [];
      for (const source of sources) {
        if (!(await isDir(source.root))) continue;
        const entries = await listSourceEntries(source.root);
        sourceList.push({
          id: source.id,
          label: source.label,
          description: source.description,
          root: source.root,
          fileCount: entries.length,
        });
      }
      return {
        memoryRoot: root,
        global: {
          exists: globalExists,
          path: globalDir,
          displayPath: homizePath(globalDir, home),
          fileCount: globalExists ? globalCount : 0,
        },
        projects,
        sources: sourceList,
      };
    },

    /** GET /api/list?section=<id> */
    async list(sectionId) {
      const sections = await buildSections();
      const section = sections.find((s) => s.sectionId === sectionId);
      if (!section) {
        const error = new Error(`未知分区：${JSON.stringify(sectionId)}`);
        error.code = 'section_not_found';
        throw error;
      }

      let entries;
      if (section.kind === 'memory') {
        const indexSummaries = parseIndexSummaries(await fs.readFile(path.join(section.dir, INDEX_FILE), 'utf8').catch(() => ''));
        const files = await statFiles(section.dir, [INDEX_FILE, ...(await listTopics(section.dir))]);
        entries = [];
        for (const file of files) {
          let text = '';
          try {
            text = await fs.readFile(file.path, 'utf8');
          } catch { /* 竞态：正文拿不到也给空摘要 */ }
          if (file.name === INDEX_FILE) {
            entries.push({ ...file, title: '记忆索引', summary: 'MEMORY.md — 每条一行的主题索引', kind: 'index' });
            continue;
          }
          const extracted = extractTitleSummary(text, file.name);
          entries.push({
            ...file,
            title: extracted.title,
            summary: indexSummaries.get(file.name) ?? extracted.summary,
            kind: 'topic',
          });
        }
      } else {
        const files = await listSourceEntries(section.dir);
        entries = [];
        for (const file of files) {
          let text = '';
          try {
            const fh = await fs.open(file.path, 'r');
            const buf = Buffer.alloc(SUMMARY_READ_BYTES);
            const { bytesRead } = await fh.read(buf, 0, SUMMARY_READ_BYTES, 0);
            await fh.close();
            text = buf.subarray(0, bytesRead).toString('utf8');
          } catch { /* 竞态：跳过摘要 */ }
          const fm = parseFrontmatterFields(text);
          const extracted = extractTitleSummary(text, file.name);
          entries.push({
            path: file.path,
            name: file.name,
            title: fm?.name || extracted.title,
            summary: fm?.description || extracted.summary,
            kind: 'doc',
          });
          try {
            const st = await fs.stat(file.path);
            entries[entries.length - 1].mtimeMs = st.mtimeMs;
            entries[entries.length - 1].size = st.size;
          } catch { /* 竞态删除：保留条目但无时间 */ }
        }
      }
      entries.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0));
      const alias = section.kind === 'memory' && section.sectionId !== 'global'
        ? lookupProjectAlias(nameIndex, path.basename(path.dirname(section.dir)))
        : undefined;
      return {
        sectionId: section.sectionId,
        kind: section.kind,
        dir: section.dir,
        displayPath: alias ? alias.displayPath : undefined,
        label: section.kind === 'source' ? section.source.label : path.basename(section.dir),
        files: entries,
      };
    },

    /** GET /api/file?path=<abs>——只读白名单根下的 .md（验收 1：路径穿越防护）。 */
    async readFile(target) {
      if (typeof target !== 'string' || !target) {
        const error = new Error('path 参数缺失');
        error.code = 'invalid_path';
        throw error;
      }
      if (!target.toLowerCase().endsWith(MARKDOWN_EXT)) {
        const error = new Error(`仅允许读取 ${MARKDOWN_EXT} 文件`);
        error.code = 'invalid_path';
        throw error;
      }
      const sections = await buildSections();
      const resolved = path.resolve(target);
      const hit = sections.find((s) => isInsideScope(s.dir, resolved));
      if (!hit) {
        const error = new Error('路径不在允许的只读范围内（记忆根 / 知识源根）');
        error.code = 'path_denied';
        throw error;
      }
      let text;
      try {
        text = await fs.readFile(resolved, 'utf8');
      } catch (e) {
        const error = new Error(`读取失败：${e?.message ?? e}`);
        error.code = 'read_failed';
        throw error;
      }
      let mtimeMs = 0;
      try {
        mtimeMs = (await fs.stat(resolved)).mtimeMs;
      } catch { /* 竞态：忽略 */ }
      return {
        path: resolved,
        name: path.basename(resolved),
        sectionId: hit.sectionId,
        text,
        mtimeMs,
      };
    },

    /** GET /api/search?q=<query>——跨分区命中行（与 memory_search 同逻辑：大小写不敏感 includes）。 */
    async search(query) {
      const q = String(query ?? '').trim();
      if (!q) {
        const error = new Error('搜索词为空');
        error.code = 'empty_query';
        throw error;
      }
      const needle = q.toLowerCase();
      const sections = await buildSections();
      const memDirs = sections.filter((s) => s.kind === 'memory').map((s) => ({ dir: s.dir, sectionId: s.sectionId }));
      const sources = sections.filter((s) => s.kind === 'source').map((s) => ({ root: s.dir, sectionId: s.sectionId }));
      const targets = await collectSearchTargets(memDirs, sources);

      const groups = new Map(); // path → {path, sectionId, name, lines[]}
      let fileCount = 0;
      let lineCount = 0;
      for (const target of targets) {
        if (lineCount >= SEARCH_MAX_LINES) break;
        let text;
        try {
          text = await fs.readFile(target.path, 'utf8');
        } catch {
          continue;
        }
        const lines = text.split(/\r?\n/);
        const found = [];
        for (let i = 0; i < lines.length && found.length < SEARCH_HITS_PER_FILE; i += 1) {
          if (lines[i].toLowerCase().includes(needle)) found.push({ no: i + 1, text: lines[i].trim().slice(0, 300) });
        }
        if (found.length) {
          fileCount += 1;
          lineCount += found.length;
          groups.set(target.path, { path: target.path, sectionId: target.sectionId, name: path.basename(target.path), lines: found });
        }
      }
      return { query: q, fileCount, lineCount, groups: [...groups.values()] };
    },
  };
}

// ————————————————————————————————————————————————————————————
// HTTP 层（薄壳：路由分发 + envelope + 兜底）
// ————————————————————————————————————————————————————————————

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function sendOk(res, value) {
  sendJson(res, 200, { ok: true, value });
}

function sendFail(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } });
}

function httpError(res, error) {
  const code = typeof error?.code === 'string' ? error.code : 'internal';
  const status = code === 'section_not_found' || code === 'invalid_path' || code === 'path_denied' || code === 'empty_query'
    ? 400
    : code === 'read_failed'
      ? 404
      : 500;
  if (status === 500) console.error(`[project-memory] 面板路由内部错误：`, error);
  sendFail(res, status, code, String(error?.message ?? error));
}

/**
 * 把 API 层挂到 webServer（cordis 注入回调里使用，返回 disposer）。
 * @param {{webServer:{register(route:{kind:string,path:string,handler:Function}):()=>void}}} ctx
 * @param {{memoryRoot:string, knowledgeSources?:Array|Promise<Array>, home?:string, nameIndex?:Map}} options
 */
export function registerPanelRoutes(ctx, options) {
  const api = createPanelApi(options);
  const prefix = PANEL_ROUTE_PREFIX;
  const handler = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method !== 'GET') {
        sendFail(res, 405, 'method_not_allowed', '知识库面板为只读视图（仅 GET）');
        return;
      }
      if (url.pathname === `${prefix}/api/overview`) {
        sendOk(res, await api.overview());
        return;
      }
      if (url.pathname === `${prefix}/api/list`) {
        sendOk(res, await api.list(url.searchParams.get('section') ?? ''));
        return;
      }
      if (url.pathname === `${prefix}/api/file`) {
        sendOk(res, await api.readFile(url.searchParams.get('path') ?? ''));
        return;
      }
      if (url.pathname === `${prefix}/api/search`) {
        sendOk(res, await api.search(url.searchParams.get('q') ?? ''));
        return;
      }
      sendFail(res, 404, 'not_found', `未知面板路径：${url.pathname}`);
    } catch (error) {
      httpError(res, error);
    }
  };
  const dispose = ctx.webServer.register({ kind: 'prefix', path: prefix, handler });
  return () => {
    try {
      dispose?.();
    } catch { /* 重复卸载无害 */ }
  };
}
