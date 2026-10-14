import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveMemoryDir } from '../lib/store.js';
import { writeMemory, searchMemory, indexLimitStatus } from '../lib/store.js';

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
