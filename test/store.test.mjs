import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveMemoryDir, resolveLegacyMemoryDir } from '../lib/store.js';
import { writeMemory, searchMemory, indexLimitStatus } from '../lib/store.js';
import { encodeProjectPath } from '../lib/paths.js';
import {
  upsertFrontmatterFields, writeSkillCandidate, archiveTopic, recordHit,
  writeGlobalHabits, globalMemoryDir, ARCHIVE_DIR,
} from '../lib/store.js';

test('resolveMemoryDir：精确命中编码目录', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-'));
  await mkdir(path.join(root, 'D--GC-Code-DWMServer', 'memory'), { recursive: true });
  const dir = await resolveMemoryDir(root, 'D:\\GC\\Code\\DWMServer');
  assert.equal(dir, path.join(root, 'D--GC-Code-DWMServer', 'memory'));
});

test('resolveMemoryDir：模糊命中（编码漂移：中文段 - 数不同，盘符大小写不同）', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-'));
  // 旧编码：水印未按 2 字展开（2 个连字符）；本次编码为 4 个连字符且盘符小写 → 精确 miss，模糊命中
  await mkdir(path.join(root, 'D--GC-ProjectFile--DWMDataset', 'memory'), { recursive: true });
  const dir = await resolveMemoryDir(root, 'D:\\GC\\ProjectFile\\水印\\DWMDataset');
  assert.equal(dir, path.join(root, 'D--GC-ProjectFile--DWMDataset', 'memory'));
});

test('resolveMemoryDir：无记忆目录返回 null（不报错）', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-'));
  assert.equal(await resolveMemoryDir(root, 'D:\\nope'), null);
});

test('writeMemory：新建 → 追加 → 索引整行去重更新', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-'));
  const cwd = 'D:\\proj';
  const r1 = await writeMemory({ root, cwd, topic: 'pitfalls', summary: '坑一：X 要先 Y', content: 'X 必须先 Y。' });
  assert.equal(r1.action, 'created');
  const r2 = await writeMemory({ root, cwd, topic: 'pitfalls', summary: '坑二：Z 别用 W', content: 'Z 别用 W。' });
  assert.equal(r2.action, 'appended');

  const memDir = path.join(root, 'D--proj', 'memory');
  const topic = await fs.readFile(path.join(memDir, 'pitfalls.md'), 'utf8');
  assert.match(topic, /X 必须先 Y。/);
  assert.match(topic, /Z 别用 W。/);

  const index = await fs.readFile(path.join(memDir, 'MEMORY.md'), 'utf8');
  assert.match(index, /坑二：Z 别用 W/);
  // 同主题只允许一行索引（去重），且新摘要覆盖旧摘要
  assert.equal((index.match(/pitfalls\.md\)/g) ?? []).length, 1);
  assert.doesNotMatch(index, /坑一：X 要先 Y/);
});

test('writeMemory：空 content / 空 topic 明确报错', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-'));
  await assert.rejects(() => writeMemory({ root, cwd: 'D:\\p', topic: '', summary: 's', content: 'c' }), /topic 无效/);
  await assert.rejects(() => writeMemory({ root, cwd: 'D:\\p', topic: 't', summary: 's', content: '  ' }), /content 为空/);
  await assert.rejects(() => writeMemory({ root, cwd: 'D:\\p', topic: 't', summary: '', content: 'c' }), /summary 为空/);
});

test('searchMemory：大小写不敏感命中并带文件与行号', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-'));
  await writeMemory({ root, cwd: 'D:\\proj', topic: 'toolchain', summary: 'pnpm 注意事项', content: 'pnpm test 需要 Node 22。' });
  await writeMemory({ root, cwd: 'D:\\proj', topic: 'other', summary: '无关条目', content: '别的项目的事。' });
  const memDir = path.join(root, 'D--proj', 'memory');
  const hits = await searchMemory({ memDir, query: 'NODE 22' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, 'toolchain.md');
  assert.ok(hits[0].line >= 1);
});

test('resolveLegacyMemoryDir：根下 MEMORY.md 旧布局命中；新布局优先/无记忆返回 null', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-legacy-'));
  const slug = path.join(root, encodeProjectPath('D:\\proj'));
  await mkdir(slug, { recursive: true });
  await fs.writeFile(path.join(slug, 'MEMORY.md'), '# 旧布局索引\n', 'utf8');
  assert.equal(await resolveLegacyMemoryDir(root, 'D:\\proj'), slug);
  // 新布局（memory/ 子目录）出现后以新布局为准：不再告警
  await mkdir(path.join(slug, 'memory'), { recursive: true });
  assert.equal(await resolveLegacyMemoryDir(root, 'D:\\proj'), null);
  // 完全没有该项目目录 → null
  assert.equal(await resolveLegacyMemoryDir(root, 'D:\\nope'), null);
});

test('indexLimitStatus：行数/字节阈值（near 80%，over 上限）', () => {
  const small = indexLimitStatus('# 项目记忆索引\n\n- [a](a.md) — x\n');
  assert.equal(small.near, false);
  assert.equal(small.over, false);
  // 160 行 = 200*0.8 → near；201 行 → over
  const near = indexLimitStatus(Array.from({ length: 160 }, (_, i) => `- [t${i}](t${i}.md) — 行`).join('\n'));
  assert.equal(near.near, true);
  assert.equal(near.over, false);
  assert.equal(indexLimitStatus(Array.from({ length: 201 }, () => 'x').join('\n')).over, true);
  // 字节通道：25KB 上限、20KB 近限
  assert.equal(indexLimitStatus('字'.repeat(20 * 1024)).near, true);
  assert.equal(indexLimitStatus('字'.repeat(25 * 1024 + 1)).over, true);
});

test('writeMemory：返回索引体量 indexStatus', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-'));
  const r = await writeMemory({ root, cwd: 'D:\\proj', topic: 't', summary: 's', content: 'c' });
  assert.ok(r.indexStatus);
  assert.equal(r.indexStatus.over, false);
  assert.ok(r.indexStatus.lines >= 1);
});

test('writeMemory：带 frontmatter 的主题文件盖 modified；replace 保留 frontmatter；无 frontmatter 不强加', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-'));
  const cwd = 'D:\\proj';
  const memDir = path.join(root, 'D--proj', 'memory');
  const typed = path.join(memDir, 'typed.md');

  await writeMemory({ root, cwd, topic: 'typed', summary: '占位', content: '初版。' });
  await fs.writeFile(typed, '---\ntype: project\nmodified: 2020-01-01T00:00:00.000Z\n---\n\n# typed\n\n旧正文。\n', 'utf8');

  const r = await writeMemory({ root, cwd, topic: 'typed', summary: '新结论', content: '新结论。' });
  assert.equal(r.action, 'appended');
  const appended = await fs.readFile(typed, 'utf8');
  assert.match(appended, /^---\ntype: project\n/m); // frontmatter 结构保留
  assert.doesNotMatch(appended, /2020-01-01T00:00:00/); // 旧 modified 被刷新
  assert.match(appended, /^modified: \d{4}-\d{2}-\d{2}T/m);
  assert.match(appended, /旧正文。[\s\S]*新结论。/); // 追加仍落在正文尾部

  await writeMemory({ root, cwd, topic: 'typed', summary: '重写', content: '重写正文。', mode: 'replace' });
  const replaced = await fs.readFile(typed, 'utf8');
  assert.match(replaced, /^---\ntype: project\n/m); // replace 也不丢 frontmatter
  assert.doesNotMatch(replaced, /旧正文。/);
  assert.match(replaced, /重写正文。/);

  await writeMemory({ root, cwd, topic: 'plain', summary: '一', content: '一。' });
  await writeMemory({ root, cwd, topic: 'plain', summary: '二', content: '二。' });
  const plain = await fs.readFile(path.join(memDir, 'plain.md'), 'utf8');
  assert.doesNotMatch(plain, /^---/); // 无 frontmatter 的普通文件绝不强加
});

// —— v0.3 P0-2 §3.1 前置修复：upsertFrontmatterFields ——
test('upsertFrontmatterFields：已有字段整行替换、新字段追加块尾、无块不强加、createHeader 前插', () => {
  const withFm = '---\nmodified: 2020-01-01\n---\n正文';
  const r1 = upsertFrontmatterFields(withFm, { modified: '2026-11-10' });
  assert.ok(!r1.text.includes('2020-01-01'), '旧值应被替换');
  assert.ok(r1.text.includes('modified: 2026-11-10'));
  assert.ok(r1.text.endsWith('正文'), '正文不动');

  const r2 = upsertFrontmatterFields(withFm, { hits: 3 });
  assert.match(r2.text, /^---\nmodified: 2020-01-01\nhits: 3\n---\n正文$/);

  assert.equal(upsertFrontmatterFields('纯正文', { hits: 1 }).text, '纯正文'); // 无块不强加
  assert.match(upsertFrontmatterFields('纯正文', { hits: 1 }, { createHeader: true }).text, /^---\nhits: 1\n---\n纯正文$/);
});

// —— v0.3 P0-1 技能候选落盘 ——
test('writeSkillCandidate：frontmatter 全字段、永不入索引、重写保留首次 created', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-'));
  const cwd = 'D:\\proj';
  // 先放一条普通记忆建立索引（候选通道本身从不创建/触碰 MEMORY.md）
  await writeMemory({ root, cwd, topic: 'normal-note', summary: '普通主题', content: '普通内容。' });
  const r = await writeSkillCandidate({
    root, cwd, topic: 'pnpm-workspace-fix',
    content: '何时用：修 workspace 幽灵依赖。步骤：…',
    description: '修 pnpm workspace 幽灵依赖',
    triggers: ['pnpm', 'workspace'],
  });
  assert.ok(r.ok);
  assert.equal(r.rewrote, false);
  const file = path.join(root, 'D--proj', 'memory', 'skill-candidates', 'pnpm-workspace-fix.md');
  const text = await fs.readFile(file, 'utf8');
  assert.match(text, /^---\nname: pnpm-workspace-fix\n/m);
  assert.match(text, /description: 修 pnpm workspace 幽灵依赖；触发词：pnpm、workspace/);
  assert.match(text, /triggers: \[pnpm, workspace\]/);
  assert.match(text, /status: candidate/);
  assert.match(text, /升格/, '尾部应有升格说明');

  const index = await fs.readFile(path.join(root, 'D--proj', 'memory', 'MEMORY.md'), 'utf8');
  assert.ok(!index.includes('pnpm-workspace-fix'), '候选永不入索引');
  assert.ok(index.includes('normal-note.md)'), '普通主题索引行不受影响');

  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeSkillCandidate({ root, cwd, topic: 'pnpm-workspace-fix', content: 'v2 草稿', description: 'd2' });
  const text2 = await fs.readFile(file, 'utf8');
  const first = text.match(/created: ([^\r\n]+)/)[1];
  assert.equal(text2.match(/created: ([^\r\n]+)/)[1], first, '重写保留首次 created');
  assert.ok(text2.includes('v2 草稿'));
});

test('writeSkillCandidate：description 必填、topic 拒绝路径分隔符', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-'));
  await assert.rejects(() => writeSkillCandidate({ root, cwd: 'D:\\p', topic: 'a/b', content: 'c', description: 'd' }), /topic 无效/);
  await assert.rejects(() => writeSkillCandidate({ root, cwd: 'D:\\p', topic: 'a', content: 'c' }), /description/);
});

// —— v0.3 P0-3 归档轨 ——
test('archiveTopic：移动+archived 头+索引摘行；禁归档清单；重名拒绝；源缺失报错', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-'));
  const cwd = 'D:\\proj';
  await writeMemory({ root, cwd, topic: 'old-topic', summary: '旧主题', content: '旧内容。' });
  const r = await archiveTopic({ root, cwd, topic: 'old-topic' });
  assert.ok(r.ok);
  const memDir = path.join(root, 'D--proj', 'memory');
  await assert.rejects(() => fs.access(path.join(memDir, 'old-topic.md'))); // 源已删
  const archived = await fs.readFile(path.join(memDir, ARCHIVE_DIR, 'old-topic.md'), 'utf8');
  assert.match(archived, /archived: \d{4}-\d{2}-\d{2}/);
  assert.match(archived, /旧内容。/);
  const index = await fs.readFile(path.join(memDir, 'MEMORY.md'), 'utf8');
  assert.ok(!index.includes('old-topic.md)'));

  // B 方案：归档后同名普通写入=允许重建；再归档因目标重名被拒绝
  await writeMemory({ root, cwd, topic: 'old-topic', summary: '重建', content: '重建内容。' });
  await assert.rejects(() => archiveTopic({ root, cwd, topic: 'old-topic' }), /已存在|重名|覆盖/);

  // 禁归档清单（大小写不敏感）
  await fs.writeFile(path.join(memDir, 'STATUS.md'), '状态', 'utf8');
  await assert.rejects(() => archiveTopic({ root, cwd, topic: 'STATUS' }), /禁止|不可归档/);
  // 源缺失
  await assert.rejects(() => archiveTopic({ root, cwd, topic: 'never-exists' }), /不存在|未找到/);
});

test('archiveTopic 失败恢复（hooks 故障注入）：复制后失败不删源；摘索引后失败恢复快照', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-'));
  const cwd = 'D:\\proj';
  const memDir = path.join(root, 'D--proj', 'memory');

  // 阶段1 后失败：源未删、归档副本已写（宁可双份）、索引行未动
  await writeMemory({ root, cwd, topic: 't1', summary: 's1', content: 'c1' });
  await assert.rejects(
    () => archiveTopic({ root, cwd, topic: 't1', hooks: { afterArchiveCopy: async () => { throw new Error('boom-copy'); } } }),
    /boom-copy/,
  );
  await fs.access(path.join(memDir, 't1.md'));
  await fs.access(path.join(memDir, ARCHIVE_DIR, 't1.md'));
  let index = await fs.readFile(path.join(memDir, 'MEMORY.md'), 'utf8');
  assert.ok(index.includes('t1.md)'), '索引行未动');

  // 阶段2 后失败（独立主题，避免与 t1 的残留归档副本重名）：索引快照恢复、源仍在
  await writeMemory({ root, cwd, topic: 't2', summary: 's2', content: 'c2' });
  await assert.rejects(
    () => archiveTopic({ root, cwd, topic: 't2', hooks: { afterIndexUpdate: async () => { throw new Error('boom-index'); } } }),
    /boom-index/,
  );
  index = await fs.readFile(path.join(memDir, 'MEMORY.md'), 'utf8');
  assert.ok(index.includes('t2.md)'), '索引行应恢复');
  await fs.access(path.join(memDir, 't2.md'));
});

// —— v0.3 P0-2 命中统计 ——
test('recordHit：无头文件新建 hits+last-access；递加；_between 期间外部改动不丢（防覆盖重放）', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-'));
  const memDir = path.join(root, 'D--proj', 'memory');
  await mkdir(memDir, { recursive: true });
  const file = path.join(memDir, 'plain.md');
  await fs.writeFile(file, '# plain\n\n正文一。\n', 'utf8');

  assert.equal(await recordHit(memDir, 'plain'), true);
  const t1 = await fs.readFile(file, 'utf8');
  assert.match(t1, /^---\n/);
  assert.match(t1, /hits: 1/);
  assert.match(t1, /last-access: \d{4}-\d{2}-\d{2}/);
  assert.match(t1, /正文一。/);

  await recordHit(memDir, 'plain');
  assert.match(await fs.readFile(file, 'utf8'), /hits: 2/);

  const file2 = path.join(memDir, 'race.md');
  await fs.writeFile(file2, '---\nhits: 1\n---\n\n旧正文。\n', 'utf8');
  assert.equal(await recordHit(memDir, 'race', {
    _between: async () => {
      await fs.writeFile(file2, '---\nhits: 1\n---\n\n旧正文。\n\n外部追加。\n', 'utf8');
    },
  }), true);
  const after = await fs.readFile(file2, 'utf8');
  assert.match(after, /外部追加。/, '外部并发改动不得丢');
  assert.match(after, /hits: 2/, '统计仍应回写');
});

// —— v0.3 P0-3 检索含归档区 ——
test('searchMemory：归档区命中带 archive/ 前缀与 archived 标记', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-'));
  const cwd = 'D:\\proj';
  await writeMemory({ root, cwd, topic: 'gone', summary: '归档主题', content: '归档关键词内容。' });
  await archiveTopic({ root, cwd, topic: 'gone' });
  const hits = await searchMemory({ memDir: path.join(root, 'D--proj', 'memory'), query: '归档关键词' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, 'archive/gone.md');
  assert.equal(hits[0].archived, true);
});

// —— v0.3 P0-4 全局习惯 ——
test('writeGlobalHabits：固定 user-habits.md、全局索引幂等一行、返回 chars', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-'));
  const r = await writeGlobalHabits({ root, summary: '跨项目通用习惯', content: '- 只要结论不要过程（2026-11-10，第 1 次）' });
  assert.ok(r.ok);
  assert.ok(r.chars > 0);
  const gdir = globalMemoryDir(root);
  const text = await fs.readFile(path.join(gdir, 'user-habits.md'), 'utf8');
  assert.match(text, /只要结论不要过程/);
  const idx = await fs.readFile(path.join(gdir, 'MEMORY.md'), 'utf8');
  assert.match(idx, /user-habits\.md\)/);
  assert.equal((idx.match(/user-habits\.md\)/g) ?? []).length, 1);

  const r2 = await writeGlobalHabits({ root, summary: 's', content: '- 第二条习惯' });
  assert.equal(r2.action, 'appended');
  const idx2 = await fs.readFile(path.join(gdir, 'MEMORY.md'), 'utf8');
  assert.equal((idx2.match(/user-habits\.md\)/g) ?? []).length, 1, '索引仍只一行');
  const text2 = await fs.readFile(path.join(gdir, 'user-habits.md'), 'utf8');
  assert.match(text2, /第二条习惯/);
  assert.match(text2, /只要结论不要过程/);
});
