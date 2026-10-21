/**
 * 知识库面板 host 路由层单测（0.2）。
 * 直接驱动 createPanelApi（不依赖真实 webServer），照 store.test.mjs 风格：
 * node:test + node:assert/strict + mkdtemp 临时目录。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createPanelApi,
  detectDefaultKnowledgeSources,
  extractTitleSummary,
  globalMemoryDir,
  guessEncodedTail,
  homizePath,
  isInsideScope,
  listProjectMemoryDirs,
  listSourceEntries,
  loadProjectNameIndex,
  normalizeKnowledgeSources,
  PANEL_ROUTE_PREFIX,
  registerPanelRoutes,
} from '../lib/routes.js';
import { encodeProjectPath } from '../lib/paths.js';

/** 搭一个假记忆树：全局 + 两个项目 + 一个知识源（平铺 md + 子目录 SKILL.md）。 */
async function makeTree() {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-routes-'));
  const globalDir = path.join(root, '_global', 'memory');
  await mkdir(globalDir, { recursive: true });
  await writeFile(path.join(globalDir, 'MEMORY.md'), '# 全局索引\n\n- [toolchain](toolchain.md) — pnpm 需要 Node 22\n', 'utf8');
  await writeFile(path.join(globalDir, 'toolchain.md'), '# toolchain\n\npnpm test 需要 Node 22 以上。\n', 'utf8');

  const projA = path.join(root, 'D--proj-a', 'memory');
  await mkdir(projA, { recursive: true });
  await writeFile(path.join(projA, 'MEMORY.md'), '# 项目索引\n\n- [pitfalls](pitfalls.md) — 坑一：X 要先 Y\n', 'utf8');
  await writeFile(path.join(projA, 'pitfalls.md'), '# pitfalls\n\nX 必须先 Y。\n', 'utf8');

  // 无 memory 子目录的项目目录：不计入分区
  await mkdir(path.join(root, 'D--proj-empty'), { recursive: true });

  const srcRoot = path.join(root, 'src-docs');
  await mkdir(srcRoot, { recursive: true });
  await writeFile(path.join(srcRoot, 'readme.md'), '# 本地文档\n\n这是本地知识源的一层文档。\n', 'utf8');
  const sub = path.join(srcRoot, 'my-skill');
  await mkdir(sub, { recursive: true });
  await writeFile(
    path.join(sub, 'SKILL.md'),
    '---\nname: my-skill\ndescription: 用于测试的技能说明\n---\n\n# my-skill\n\n技能正文。\n',
    'utf8',
  );

  const sources = [{ id: 'docs', label: '本地文档', description: '测试源', root: srcRoot }];
  return { root, globalDir, projA, srcRoot, sources };
}

test('isInsideScope：scope 内/外/边界', () => {
  assert.equal(isInsideScope('C:\\r', 'C:\\r\\a.md'), true);
  assert.equal(isInsideScope('C:\\r', 'C:\\r'), true); // scope 自身放行（目录级读取）
  assert.equal(isInsideScope('C:\\r', 'C:\\r2\\a.md'), false);
  assert.equal(isInsideScope('C:\\r', 'C:\\r..\\a.md'), false);
});

test('normalizeKnowledgeSources：非法项跳过且不抛错', () => {
  const out = normalizeKnowledgeSources([{ root: 'C:\\k' }, null, { label: '无 root' }, { id: 'ok', root: 'C:\\k2' }]);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'src-0');
  assert.equal(out[1].id, 'ok');
  assert.equal(normalizeKnowledgeSources(undefined).length, 0);
});

test('detectDefaultKnowledgeSources：不存在目录不注册（零硬编码兜底）', async () => {
  const fakeHome = await mkdtemp(path.join(tmpdir(), 'pm-home-'));
  const sources = await detectDefaultKnowledgeSources(fakeHome);
  assert.equal(sources.length, 0);
});

test('listProjectMemoryDirs：只计有 memory 子目录的项目，_global 除外', async () => {
  const { root } = await makeTree();
  const dirs = await listProjectMemoryDirs(root);
  assert.equal(dirs.length, 1);
  assert.equal(dirs[0].name, 'D--proj-a');
});

test('listSourceEntries：根下 *.md + 子目录 SKILL.md', async () => {
  const { srcRoot } = await makeTree();
  const entries = await listSourceEntries(srcRoot);
  assert.deepEqual(entries.map((e) => e.name).sort(), ['my-skill/SKILL.md', 'readme.md']);
});

test('overview：全局/项目/源计数与排序', async () => {
  const { root, sources } = await makeTree();
  const api = createPanelApi({ memoryRoot: root, knowledgeSources: sources });
  const view = await api.overview();
  assert.equal(view.global.exists, true);
  assert.equal(view.global.fileCount, 2); // 索引 + 1 主题
  assert.equal(view.projects.length, 1);
  assert.equal(view.projects[0].id, 'p:D--proj-a');
  assert.equal(view.projects[0].fileCount, 2);
  assert.equal(view.projects[0].pathExists, undefined); // 无 nameIndex 记录：不给存在性字段
  assert.equal(view.sources.length, 1);
  assert.equal(view.sources[0].fileCount, 2);
  assert.equal(view.memoryRoot, path.resolve(root));
});

test('overview.pathExists：nameIndex 命中的真实路径探测存在性（废弃项目标注 P1）', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-gone-'));
  const aliveDir = path.join(root, 'D--alive', 'memory');
  const goneDir = path.join(root, 'D--gone', 'memory');
  for (const dir of [aliveDir, goneDir]) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'MEMORY.md'), '# 索引\n\n- [x](x.md) — 条目\n', 'utf8');
  }
  const alivePath = path.join(root, 'still-here');
  await mkdir(alivePath, { recursive: true });
  const gonePath = path.join(root, 'deleted-project'); // 不创建：模拟项目目录已删除
  const nameIndex = new Map([
    ['D--alive', { name: 'still-here', displayPath: '~\\still-here', path: alivePath }],
    ['D--gone', { name: 'deleted-project', displayPath: '~\\deleted-project', path: gonePath }],
  ]);
  const api = createPanelApi({ memoryRoot: root, knowledgeSources: [], nameIndex });
  const view = await api.overview();
  const byDir = new Map(view.projects.map((p) => [p.dir, p]));
  assert.equal(byDir.get('D--alive').pathExists, true);
  assert.equal(byDir.get('D--gone').pathExists, false);
});

test('loadProjectNameIndex 模糊回退：正斜杠键 + 小写盘符记忆目录仍命中（P1 修复）', async () => {
  // 真实缺口的复现：~/.claude.json 键是 D:/GC/Code/DWM，存量记忆目录是 d--GC-Code-DWM（盘符小写）
  const home = await mkdtemp(path.join(tmpdir(), 'pm-home-'));
  const root = await mkdtemp(path.join(tmpdir(), 'pm-fuzzy-'));
  await writeFile(path.join(home, '.claude.json'), JSON.stringify({ projects: { 'D:/GC/Code/DWM': {} } }), 'utf8');
  const memDir = path.join(root, 'd--GC-Code-DWM', 'memory');
  await mkdir(memDir, { recursive: true });
  await writeFile(path.join(memDir, 'MEMORY.md'), '# 索引\n', 'utf8');
  const realPath = path.join(root, 'dwm-project');
  await mkdir(realPath, { recursive: true });
  const nameIndex = loadProjectNameIndex(home);
  const api = createPanelApi({ memoryRoot: root, knowledgeSources: [], nameIndex });
  const view = await api.overview();
  assert.equal(view.projects.length, 1);
  assert.equal(view.projects[0].pathExists, true);
  assert.equal(view.projects[0].name, 'DWM'); // 真实项目名也经模糊键穿透
});

test('list(memory)：索引摘要映射到主题文件行', async () => {
  const { root, sources } = await makeTree();
  const api = createPanelApi({ memoryRoot: root, knowledgeSources: sources });
  const listing = await api.list('p:D--proj-a');
  assert.equal(listing.kind, 'memory');
  const pitfalls = listing.files.find((f) => f.name === 'pitfalls.md');
  assert.equal(pitfalls.title, 'pitfalls');
  assert.equal(pitfalls.summary, '坑一：X 要先 Y'); // 来自 MEMORY.md 索引行
  const index = listing.files.find((f) => f.name === 'MEMORY.md');
  assert.equal(index.kind, 'index');
});

test('list(source)：SKILL.md 用 frontmatter name/description 做标题与摘要', async () => {
  const { root, sources } = await makeTree();
  const api = createPanelApi({ memoryRoot: root, knowledgeSources: sources });
  const listing = await api.list('s:docs');
  assert.equal(listing.kind, 'source');
  const skill = listing.files.find((f) => f.name === 'my-skill/SKILL.md');
  assert.equal(skill.title, 'my-skill');
  assert.equal(skill.summary, '用于测试的技能说明');
});

test('list：未知分区报 section_not_found', async () => {
  const { root, sources } = await makeTree();
  const api = createPanelApi({ memoryRoot: root, knowledgeSources: sources });
  await assert.rejects(() => api.list('p:不存在'), /未知分区/);
});

test('readFile：允许根内可读，穿越/非 md 拒绝（验收 1 防护）', async () => {
  const { root, sources, projA } = await makeTree();
  const api = createPanelApi({ memoryRoot: root, knowledgeSources: sources });

  const doc = await api.readFile(path.join(projA, 'pitfalls.md'));
  assert.equal(doc.name, 'pitfalls.md');
  assert.match(doc.text, /X 必须先 Y/);
  assert.equal(doc.sectionId, 'p:D--proj-a');

  await assert.rejects(() => api.readFile(path.join(root, '..', 'outside.md')), /只读范围/);
  await assert.rejects(() => api.readFile(path.join(root, 'src-docs', 'readme.md').replace(/readme\.md$/, 'readme.txt')), /\.md 文件/);
  await assert.rejects(() => api.readFile(''), /path 参数缺失/);
  await assert.rejects(() => api.readFile(path.join(root, '_global', 'memory', '缺失.md')), /读取失败/);
});

test('search：跨分区命中行、每文件限 3 条、空词报错（验收 5 的 host 半边）', async () => {
  const { root, sources, globalDir, projA } = await makeTree();
  // 多造几条命中行验证每文件上限
  await writeFile(path.join(projA, 'many.md'), '# many\n\npnpm 一\npnpm 二\npnpm 三\npnpm 四\n', 'utf8');
  const api = createPanelApi({ memoryRoot: root, knowledgeSources: sources });

  const result = await api.search('pnpm');
  assert.equal(result.query, 'pnpm');
  const paths = result.groups.map((g) => g.path);
  assert.ok(paths.includes(path.join(globalDir, 'toolchain.md')));
  assert.ok(paths.includes(path.join(globalDir, 'MEMORY.md'))); // 索引行也参与检索
  const many = result.groups.find((g) => g.path === path.join(projA, 'many.md'));
  assert.equal(many.lines.length, 3); // 每文件至多 3 条
  assert.ok(result.fileCount >= 2);
  assert.ok(result.lineCount >= 3);

  await assert.rejects(() => api.search('   '), /搜索词为空/);
});

test('registerPanelRoutes：envelope + 只读 405 + 404 兜底', async () => {
  const { root, sources } = await makeTree();
  const routes = [];
  const fakeCtx = {
    webServer: {
      register(route) {
        routes.push(route);
        return () => {};
      },
    },
  };
  const dispose = registerPanelRoutes(fakeCtx, { memoryRoot: root, knowledgeSources: sources });
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, 'prefix');
  assert.equal(routes[0].path, PANEL_ROUTE_PREFIX);
  dispose();

  const handler = routes[0].handler;
  const respond = async (method, url) => {
    const chunks = [];
    const res = {
      statusCode: 0,
      headers: null,
      writeHead(status, headers) {
        this.statusCode = status;
        this.headers = headers;
      },
      end(body) {
        chunks.push(body ?? '');
      },
    };
    await handler({ method, url }, res);
    return { status: res.statusCode, body: JSON.parse(chunks.join('') || '{}') };
  };

  const post = await respond('POST', `${PANEL_ROUTE_PREFIX}/api/overview`);
  assert.equal(post.status, 405);
  assert.equal(post.body.ok, false);

  const missing = await respond('GET', `${PANEL_ROUTE_PREFIX}/api/none`);
  assert.equal(missing.status, 404);

  const ok = await respond('GET', `${PANEL_ROUTE_PREFIX}/api/overview`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.value.global.exists, true);

  const denied = await respond('GET', `${PANEL_ROUTE_PREFIX}/api/file?path=${encodeURIComponent('C:\\Windows\\win.ini.md')}`);
  assert.equal(denied.status, 400);
  assert.equal(denied.body.error.code, 'path_denied');
});

test('globalMemoryDir：约定位置 <root>/_global/memory', () => {
  assert.equal(globalMemoryDir('C:\\r'), path.join('C:\\r', '_global', 'memory'));
});

test('extractTitleSummary：标题+首段提取', () => {
  const { title, summary } = extractTitleSummary('# 标题\n\n第一段摘要。\n\n第二段。', 'fallback.md');
  assert.equal(title, '标题');
  assert.equal(summary, '第一段摘要。');
  const noTitle = extractTitleSummary('---\ntype: note\n---\n\n正文开头。', 'no-title.md');
  assert.equal(noTitle.title, 'no-title');
  assert.equal(noTitle.summary, '正文开头。');
});

// —— 项目名索引 / 展示名 / home 缩写（0.2 UI 修复轮） ——

test('loadProjectNameIndex：~/.claude.json projects 键正向编码匹配 name/displayPath', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'pm-home-'));
  await writeFile(
    path.join(home, '.claude.json'),
    JSON.stringify({ projects: { 'D:/Git/demo': {}, 'C:/Users/张三/笔记': {} } }),
    'utf8',
  );
  const index = loadProjectNameIndex(home);
  const demo = index.get(encodeProjectPath('D:/Git/demo'));
  assert.ok(demo, 'D:/Git/demo 应命中');
  assert.equal(demo.name, 'demo');
  assert.equal(demo.displayPath, 'D:\\Git\\demo');
  const note = index.get(encodeProjectPath('C:/Users/张三/笔记'));
  assert.ok(note, '中文路径应命中');
  assert.equal(note.name, '笔记');
});

test('loadProjectNameIndex：清单缺失/损坏返回空表（不抛错）', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'pm-home-'));
  assert.equal(loadProjectNameIndex(home).size, 0);
  await writeFile(path.join(home, '.claude.json'), '{broken', 'utf8');
  assert.equal(loadProjectNameIndex(home).size, 0);
});

test('guessEncodedTail：剥盘符取全尾体；空体返回 undefined（非解码不拆段）', () => {
  assert.equal(guessEncodedTail('D--GitCode-dshplugin'), 'GitCode-dshplugin');
  assert.equal(guessEncodedTail('D--proj-a'), 'proj-a'); // 项目名含连字符不被切碎
  assert.equal(guessEncodedTail('memory'), 'memory');
  assert.equal(guessEncodedTail('C--'), undefined);
  assert.equal(guessEncodedTail(''), undefined);
});

test('homizePath：home 下缩写为 ~ 形式，home 外原样', () => {
  const home = 'C:\\Users\\demo';
  assert.equal(homizePath('C:\\Users\\demo', home), '~');
  assert.equal(homizePath('C:\\Users\\demo\\projects\\x', home), '~\\projects\\x');
  assert.equal(homizePath('D:\\elsewhere', home), 'D:\\elsewhere');
});

test('overview/list：nameIndex 命中补 name/displayPath；0 文件项目沉底', async () => {
  const tree = await makeTree();
  const home = await mkdtemp(path.join(tmpdir(), 'pm-home-'));
  const realA = 'D:\\proj-a'; // encodeProjectPath('D:\proj-a') = 'D--proj-a'，与 makeTree 目录对齐
  await writeFile(
    path.join(home, '.claude.json'),
    JSON.stringify({ projects: { [realA]: {} } }),
    'utf8',
  );
  // 0 文件冷项目：有 memory 目录但无任何 md
  await mkdir(path.join(tree.root, 'Z--cold-empty', 'memory'), { recursive: true });

  const api = createPanelApi({ memoryRoot: tree.root, knowledgeSources: [], nameIndex: loadProjectNameIndex(home) });
  const overview = await api.overview();

  const projA = overview.projects.find((p) => p.dir === 'D--proj-a');
  assert.ok(projA, 'proj-a 应在分区里');
  assert.equal(projA.name, 'proj-a');
  assert.equal(projA.displayPath, realA);
  assert.equal(overview.global.displayPath, homizePath(globalMemoryDir(tree.root)));

  const empty = overview.projects.filter((p) => p.fileCount === 0);
  assert.equal(empty.length, 1, '应有 1 个 0 文件项目');
  assert.equal(overview.projects[overview.projects.length - 1].id, empty[0].id, '0 文件项目应沉底');

  const listing = await api.list(projA.id);
  assert.equal(listing.displayPath, realA);
  const coldListing = await api.list(empty[0].id);
  assert.equal(coldListing.displayPath, undefined, '未命中索引的项目不给 displayPath');
});
