/**
 * v0.3 工具参数矩阵单测：memory_write 四通道（普通/技能候选/归档/全局）、
 * memory_read 的 archive/<slug> 与 scope=global 分支、memory_search 命中统计。
 * mock exec：agent.session.header.cwd 指向固定假项目，root/journalDir 均为临时目录。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildMemoryTools } from '../lib/tools.js';
import { ARCHIVE_DIR, globalMemoryDir } from '../lib/store.js';

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-tools-'));
  const journalDir = await mkdtemp(path.join(tmpdir(), 'pm-journal-'));
  const cwd = 'D:\\proj';
  const exec = { agent: { session: { header: { cwd } } } };
  const tools = buildMemoryTools({ root, journalDir });
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  return { root, journalDir, cwd, exec, byName, memDir: path.join(root, 'D--proj', 'memory') };
}

test('memory_write 普通通道：正常写入；description/triggers 传了明确报错', async () => {
  const { exec, byName } = await setup();
  const r = await byName['memory_write'].execute({ topic: 'note', content: '内容一。', summary: '摘要' }, exec);
  assert.equal(r.ok, true);
  await assert.rejects(
    () => byName['memory_write'].execute({ topic: 'note', content: 'c', summary: 's', description: 'x' }, exec),
    /description/,
  );
  await assert.rejects(
    () => byName['memory_write'].execute({ topic: 'note', content: 'c', summary: 's', triggers: ['x'] }, exec),
    /trigger/,
  );
});

test('memory_write 技能候选通道：description 必填、summary 拒绝、scope 非 project 拒绝、落盘成功', async () => {
  const { exec, byName, memDir } = await setup();
  await assert.rejects(
    () => byName['memory_write'].execute({ topic: 'skill-a', content: 'c', target: 'skill-candidate' }, exec),
    /description/,
  );
  await assert.rejects(
    () => byName['memory_write'].execute({ topic: 'skill-a', content: 'c', target: 'skill-candidate', description: 'd', summary: 's' }, exec),
    /summary/,
  );
  await assert.rejects(
    () => byName['memory_write'].execute({ topic: 'skill-a', content: 'c', target: 'skill-candidate', description: 'd', scope: 'global' }, exec),
    /scope|project/,
  );
  const r = await byName['memory_write'].execute(
    { topic: 'skill-a', content: '草稿内容', target: 'skill-candidate', description: '用途', triggers: ['t1'] },
    exec,
  );
  assert.equal(r.ok, true);
  const cand = await fs.readFile(path.join(memDir, 'skill-candidates', 'skill-a.md'), 'utf8');
  assert.match(cand, /status: candidate/);
});

test('memory_write 全局通道：topic 固定 user-habits、description 拒绝、写入成功', async () => {
  const { root, exec, byName } = await setup();
  await assert.rejects(
    () => byName['memory_write'].execute({ topic: 'other', content: 'c', summary: 's', scope: 'global' }, exec),
    /user-habits/,
  );
  await assert.rejects(
    () => byName['memory_write'].execute({ topic: 'user-habits', content: 'c', summary: 's', scope: 'global', description: 'd' }, exec),
    /description/,
  );
  const r = await byName['memory_write'].execute(
    { topic: 'user-habits', content: '- 全局习惯一', summary: '全局习惯', scope: 'global' },
    exec,
  );
  assert.equal(r.ok, true);
  await fs.access(path.join(globalMemoryDir(root), 'user-habits.md'));
});

test('memory_write 归档通道：成功归档并引导 archive 读；多余参数拒绝；archive+global 组合拒绝', async () => {
  const { exec, byName, memDir } = await setup();
  await byName['memory_write'].execute({ topic: 'note', content: '内容。', summary: 's' }, exec);

  const r = await byName['memory_write'].execute({ topic: 'note', mode: 'archive' }, exec);
  assert.equal(r.ok, true);
  assert.ok(r.text.includes('archive'), '文案应引导 archive 读法');
  await fs.access(path.join(memDir, ARCHIVE_DIR, 'note.md'));

  await assert.rejects(
    () => byName['memory_write'].execute({ topic: 'x', mode: 'archive', summary: 's' }, exec),
    /仅接受 topic/,
  );
  await assert.rejects(
    () => byName['memory_write'].execute({ topic: 'x', mode: 'archive', scope: 'global' }, exec),
    /仅支持普通项目主题|scope/,
  );
});

test('B 方案：归档后同名普通写入=允许重建+提示归档历史', async () => {
  const { exec, byName } = await setup();
  await byName['memory_write'].execute({ topic: 'note', content: '旧内容。', summary: 's' }, exec);
  await byName['memory_write'].execute({ topic: 'note', mode: 'archive' }, exec);
  const r = await byName['memory_write'].execute({ topic: 'note', content: '重建内容。', summary: '重建' }, exec);
  assert.equal(r.ok, true);
  assert.ok(r.text.includes('归档历史'), '应提示存在归档历史');
});

test('memory_read：普通读 hits+1；STATUS 不计数；archive/<slug> 不计数；非法前缀拒绝；global 读不计 hits', async () => {
  const { root, exec, byName, memDir } = await setup();
  await byName['memory_write'].execute({ topic: 'note', content: '内容一。', summary: 's' }, exec);

  const r1 = await byName['memory_read'].execute({ topic: 'note' }, exec);
  assert.equal(r1.ok, true);
  assert.match(await fs.readFile(path.join(memDir, 'note.md'), 'utf8'), /hits: 1/);

  await fs.writeFile(path.join(memDir, 'STATUS.md'), '---\n---\n状态内容。', 'utf8');
  await byName['memory_read'].execute({ topic: 'STATUS' }, exec);
  assert.doesNotMatch(await fs.readFile(path.join(memDir, 'STATUS.md'), 'utf8'), /hits:/);

  await byName['memory_write'].execute({ topic: 'note', mode: 'archive' }, exec);
  const r2 = await byName['memory_read'].execute({ topic: 'archive/note' }, exec);
  assert.equal(r2.ok, true);
  assert.match(await fs.readFile(path.join(memDir, ARCHIVE_DIR, 'note.md'), 'utf8'), /hits: 1/, '归档读不得递加');

  const bad = await byName['memory_read'].execute({ topic: 'sub/dir' }, exec);
  assert.equal(bad.ok, false);

  await byName['memory_write'].execute({ topic: 'user-habits', content: '- 习惯', summary: 's', scope: 'global' }, exec);
  const g = await byName['memory_read'].execute({ topic: 'user-habits', scope: 'global' }, exec);
  assert.equal(g.ok, true);
  assert.doesNotMatch(await fs.readFile(path.join(globalMemoryDir(root), 'user-habits.md'), 'utf8'), /hits:/);
  const gBad = await byName['memory_read'].execute({ topic: 'other', scope: 'global' }, exec);
  assert.equal(gBad.ok, false);
  assert.ok(gBad.text.includes('user-habits'));
});

test('memory_search：命中文件计数 hits；归档命中标[已归档]不计数', async () => {
  const { exec, byName, memDir } = await setup();
  await byName['memory_write'].execute({ topic: 'kb', content: '苹果派做法。', summary: 's' }, exec);
  const s = await byName['memory_search'].execute({ query: '苹果派' }, exec);
  assert.equal(s.ok, true);
  assert.ok(s.text.includes('kb.md'));
  assert.match(await fs.readFile(path.join(memDir, 'kb.md'), 'utf8'), /hits: 1/);

  await byName['memory_write'].execute({ topic: 'kb', mode: 'archive' }, exec);
  const s2 = await byName['memory_search'].execute({ query: '苹果派' }, exec);
  assert.ok(s2.text.includes('[已归档]'), '归档命中应带标记');
  assert.doesNotMatch(await fs.readFile(path.join(memDir, ARCHIVE_DIR, 'kb.md'), 'utf8'), /hits: 2/, '归档命中不得计数');
});
