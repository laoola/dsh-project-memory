/**
 * 注入渲染单测：超长索引的双端保留策略。
 * 覆盖：短索引原样注入、长索引头尾双端保留（STATUS 首行 + 最新尾部条目）、中间省略提示、空索引。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderInjection } from '../index.js';

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
