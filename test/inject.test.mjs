/**
 * 注入渲染单测：超长索引的双端保留策略。
 * 覆盖：短索引原样注入、长索引头尾双端保留（STATUS 首行 + 最新尾部条目）、中间省略提示、空索引。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderInjection, renderLegacyNotice, renderGlobalHabitsSection, buildSessionInjection } from '../index.js';
import { writeGlobalHabits, writeMemory } from '../lib/store.js';

const MEM = 'C:\\proj\\demo\\memory';

test('短索引：原文注入不截断', () => {
  const text = '> 📌 STATUS：状态正常\n\n# MEMORY\n\n- [a](a.md) — 一条旧结论';
  const out = renderInjection(text, MEM, 4000);
  assert.ok(out.includes('一条旧结论'));
  assert.ok(out.includes('STATUS：状态正常'));
  assert.ok(!out.includes('已省略'), '未超长不得出现省略提示');
});

test('长索引：头尾双端保留，STATUS 首行与最新尾部条目都不丢', () => {
  const lines = ['> 📌 STATUS：项目状态行', '', '# MEMORY', ''];
  for (let i = 0; i < 200; i += 1) {
    lines.push(`- [topic-${String(i).padStart(3, '0')}](topic-${i}.md) — 第 ${i} 条摘要内容，保证行长度足够填充注入预算测试。`);
  }
  const text = lines.join('\n');
  const out = renderInjection(text, MEM, 1000);
  assert.ok(out.includes('STATUS：项目状态行'), 'STATUS 首行必须保留');
  assert.ok(out.includes('topic-000'), '头部早期条目保留');
  assert.ok(out.includes('topic-199'), '尾部最新条目必须保留（原 slice 截断会丢掉它）');
  assert.ok(out.includes('中间'), '应有中间省略提示');
  assert.ok(!out.includes('topic-100'), '中间条目应被省略');
});

test('空索引：返回空串（不注入）', () => {
  assert.equal(renderInjection('', MEM, 1000), '');
  assert.equal(renderInjection('   ', MEM, 1000), '');
});

test('旧布局迁移提示：给出目录与目标 memory\\ 子目录', () => {
  const notice = renderLegacyNotice('C:\\Users\\demo\\.claude\\projects\\D--old');
  assert.ok(notice.includes('D--old'));
  assert.ok(notice.includes('memory\\'), '应提示移入 memory 子目录');
  assert.ok(notice.includes('旧布局'));
});

// —— v0.3 P0-4 全局习惯注入 ——
test('renderGlobalHabitsSection：无文件空串；0 预算禁用；剥 frontmatter；截断提示', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-inj-'));
  assert.equal(await renderGlobalHabitsSection(root, 600), '');

  await writeGlobalHabits({ root, summary: 's', content: '- 习惯甲：先查记忆再动手' });
  assert.equal(await renderGlobalHabitsSection(root, 0), '', '0=禁用');

  const out = await renderGlobalHabitsSection(root, 600);
  assert.ok(out.includes('全局工作习惯'));
  assert.ok(out.includes('习惯甲'));
  assert.ok(!out.includes('---'), 'frontmatter 应剥离');

  const tiny = await renderGlobalHabitsSection(root, 20);
  assert.ok(tiny.includes('已截断'), '超短预算应给出截断提示');
});

test('buildSessionInjection：仅全局→global-only；项目+全局→recall 拼尾；皆无→null；0 预算关全局段', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pm-inj-'));
  assert.equal(await buildSessionInjection({ root, cwd: 'D:\\nope', injectMaxChars: 4000, globalHabitsMaxChars: 600 }), null);

  await writeGlobalHabits({ root, summary: 's', content: '- 全局习惯内容' });
  const g = await buildSessionInjection({ root, cwd: 'D:\\nope', injectMaxChars: 4000, globalHabitsMaxChars: 600 });
  assert.equal(g.kind, 'global');
  assert.ok(g.text.includes('全局习惯内容'), '无项目索引的新项目也能拿到全局习惯');

  await writeMemory({ root, cwd: 'D:\\proj', topic: 'a', summary: '项目条目', content: '内容。' });
  const r = await buildSessionInjection({ root, cwd: 'D:\\proj', injectMaxChars: 4000, globalHabitsMaxChars: 600 });
  assert.equal(r.kind, 'recall');
  assert.ok(r.text.includes('项目条目'));
  assert.ok(r.text.includes('全局习惯内容'), '全局段拼在项目注入尾部');

  const r0 = await buildSessionInjection({ root, cwd: 'D:\\proj', injectMaxChars: 4000, globalHabitsMaxChars: 0 });
  assert.equal(r0.kind, 'recall');
  assert.ok(!r0.text.includes('全局工作习惯'), '0 预算不得注入全局段');
});
