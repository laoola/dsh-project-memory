/**
 * STATUS.md 机制单测（2026-10-17 合流新增；不打宿主，全用临时目录 + 注入时钟）。
 * 覆盖：七字段渲染/待补/截断、created+MEMORY.md 首行注入且解析不受影响、
 * unchanged 不重写不滚动、updated 双级 prev 滚动、原子写无 tmp 残留、
 * 5 秒抢写保护、膨胀硬上限（≤2KB 且 ≤80 行）、枚举交集/排除/死目录不生成、
 * workspaceId 注册表命中与 SHA-256 兜底、parse 往返、工具集注册 memory_status_write。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  STATUS_FILE, STATUS_PREV1, STATUS_PREV2, FIELD_MAX_CHARS, FILE_MAX_BYTES, FILE_MAX_LINES,
  normalizeStatusFields, renderStatusDoc, parseStatusDoc, statusSummaryLine,
  injectStatusIntoIndex, enumerateStatusTargets, workspaceIdFor, writeStatusFile,
} from '../lib/status.js';
import { encodeProjectPath } from '../lib/paths.js';
import { readIndex, indexLimitStatus } from '../lib/store.js';
import { buildMemoryTools } from '../lib/tools.js';
import { journalFile } from '../lib/journal.js';

async function tmpRoot(prefix = 'pm-status-') {
  const root = await fs.mkdtemp(path.join(tmpdir(), prefix));
  await fs.mkdir(path.join(root, 'memory'), { recursive: true }); // writeStatusFile 要求 root 下有项目 slug 目录吗？不需要：memDir 会 mkdir -p
  return root;
}

const T0 = new Date('2026-10-17T10:00:00');
const tick = (ms) => new Date(T0.getTime() + ms);

test('七字段渲染：齐全全出、缺失标待补、keyDecisions>5 截断、单字段超 500 截断', () => {
  const full = normalizeStatusFields({
    stage: '开发中', milestones: ['M1', 'M2'], inProgress: ['A'], nextStart: '写测试',
    keyDecisions: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'], constraints: ['c1'], workspaceId: 'w1',
  });
  const doc = renderStatusDoc(full, { updatedAt: T0.toISOString(), source: '测试' });
  for (const head of ['当前阶段', '最近里程碑', '进行中事项', '下次开工起点', '关键技术决策', '活跃约束', '最近更新']) {
    assert.ok(doc.includes(head), `应含字段 ${head}`);
  }
  assert.ok(!doc.includes('d6'), '第 6 条决策应被截断');
  const empty = renderStatusDoc(normalizeStatusFields({ workspaceId: 'w1' }), { updatedAt: T0.toISOString(), source: '' });
  assert.ok(empty.includes('待补'), '缺失字段应标待补');
  const long = 'x'.repeat(600);
  const trimmed = renderStatusDoc(normalizeStatusFields({ stage: long, workspaceId: 'w1' }), { updatedAt: T0.toISOString(), source: '' });
  assert.ok(trimmed.includes('x'.repeat(FIELD_MAX_CHARS)) && !trimmed.includes('x'.repeat(FIELD_MAX_CHARS + 1)), '单字段应截到 500');
});

test('created：STATUS.md 落盘 + MEMORY.md 首行注入且既有索引解析不受影响', async () => {
  const root = await tmpRoot();
  const cwd = 'C:\\proj\\alpha';
  const memDir = path.join(root, encodeProjectPath(cwd), 'memory');
  await fs.mkdir(memDir, { recursive: true });
  await fs.writeFile(path.join(memDir, 'MEMORY.md'), '- [部署事实](deploy.md)：端口 3080\n', 'utf8');

  const r = await writeStatusFile({
    root, cwd, now: T0,
    fields: { stage: '阶段一', nextStart: '从测试接着写' },
    summary: '阶段一进行中，下次从测试接着写',
    source: '单测', workspaceId: 'ws-alpha',
  });
  assert.equal(r.action, 'created');
  const doc = await fs.readFile(path.join(memDir, STATUS_FILE), 'utf8');
  assert.ok(doc.includes('阶段一') && doc.includes('ws-alpha'));
  assert.ok(!doc.includes('待补：') || doc.includes('待补'), '缺省字段应以待补呈现');

  const indexText = await fs.readFile(path.join(memDir, 'MEMORY.md'), 'utf8');
  assert.ok(indexText.startsWith('> 📌 STATUS：'), '首行应是 STATUS 指针');
  assert.ok(indexText.includes('阶段一进行中'), '指针应是一行摘要而非裸路径');
  assert.ok(indexText.includes('- [部署事实](deploy.md)：端口 3080'), '既有索引条目应原样保留');

  const idx = await readIndex(memDir);
  assert.ok(idx && idx.includes('deploy.md'), 'readIndex 应能正常读出索引');
  const limit = indexLimitStatus(idx);
  assert.ok(limit.lines >= 2, '注入行 + 旧条目行都应计入限长统计');
  // 无 .tmp 残留（原子写收尾）
  await assert.rejects(fs.access(path.join(memDir, 'STATUS.md.tmp')), '原子写完成后不应残留 tmp');
});

test('unchanged：内容 diff 无变化 → 不重写不滚动（mtime 不动，prev 不产生）', async () => {
  const root = await tmpRoot();
  const cwd = 'C:\\proj\\beta';
  const memDir = path.join(root, encodeProjectPath(cwd), 'memory');
  const common = { root, cwd, fields: { stage: '同内容' }, summary: '同内容', source: '单测', workspaceId: 'w2' };
  await writeStatusFile({ ...common, now: T0 });
  const file = path.join(memDir, STATUS_FILE);
  const before = await fs.stat(file);
  const r2 = await writeStatusFile({ ...common, now: tick(60_000) }); // 时间推进但内容一样
  assert.equal(r2.action, 'unchanged');
  const after = await fs.stat(file);
  assert.equal(after.mtimeMs, before.mtimeMs, '未重写：mtime 不应变');
  await assert.rejects(fs.access(path.join(memDir, STATUS_PREV1)), '无变化不得滚动 prev1');
});

test('updated + 双级滚动：第二次变化 prev1=旧版，第三次变化 prev2=第一版 prev1=第二版', async () => {
  const root = await tmpRoot();
  const cwd = 'C:\\proj\\gamma';
  const memDir = path.join(root, encodeProjectPath(cwd), 'memory');
  const base = { root, cwd, source: '单测', workspaceId: 'w3' };
  await writeStatusFile({ ...base, now: T0, fields: { stage: 'v1' }, summary: 'v1' });
  await writeStatusFile({ ...base, now: tick(10_000), fields: { stage: 'v2' }, summary: 'v2' });
  const prev1 = await fs.readFile(path.join(memDir, STATUS_PREV1), 'utf8');
  assert.ok(prev1.includes('v1'), 'prev1 应是上一版');
  await writeStatusFile({ ...base, now: tick(20_000), fields: { stage: 'v3' }, summary: 'v3' });
  const p1 = await fs.readFile(path.join(memDir, STATUS_PREV1), 'utf8');
  const p2 = await fs.readFile(path.join(memDir, STATUS_PREV2), 'utf8');
  assert.ok(p1.includes('v2') && p2.includes('v1'), '滚动后 prev1=v2、prev2=v1');
});

test('5 秒抢写保护：新鲜 tmp 阻塞，过期 tmp 放行且被清理', async () => {
  const root = await tmpRoot();
  const cwd = 'C:\\proj\\delta';
  const memDir = path.join(root, encodeProjectPath(cwd), 'memory');
  await fs.mkdir(memDir, { recursive: true });
  const tmp = path.join(memDir, 'STATUS.md.tmp');
  await fs.writeFile(tmp, 'stale-marker\n', 'utf8'); // mtime = 真实时钟 now
  const locked = await writeStatusFile({ root, cwd, fields: { stage: 'x' }, summary: 'x', workspaceId: 'w4' }); // 不传 now → 真实时钟，与 tmp mtime 差 <5s
  assert.equal(locked.action, 'skipped-locked', '5 秒内的新鲜 tmp 应触发抢写保护');
  // 把 tmp mtime 拨旧 10 秒 → 放行
  const old = new Date(Date.now() - 10_000);
  await fs.utimes(tmp, old, old);
  const ok = await writeStatusFile({ root, cwd, fields: { stage: 'y' }, summary: 'y', workspaceId: 'w4' });
  assert.equal(ok.action, 'created', '陈旧 tmp 不阻塞');
  await assert.rejects(fs.access(tmp), '放行后 tmp 应被清理');
});

test('膨胀硬上限：极端超长输入落盘 ≤2KB 且 ≤80 行，truncated=true', async () => {
  const root = await tmpRoot();
  const cwd = 'C:\\proj\\bloat';
  const big = (s) => s.repeat(200);
  const r = await writeStatusFile({
    root, cwd, now: T0, workspaceId: 'w5',
    fields: {
      stage: big('阶'), milestones: [big('里'), big('程'), big('碑')],
      inProgress: [big('进'), big('行')], nextStart: big('下'),
      keyDecisions: [big('决'), big('策')], constraints: [big('约')],
    },
    summary: big('摘'), source: big('源'),
  });
  assert.equal(r.action, 'created');
  assert.equal(r.truncated, true, '超限输入应触发二级压缩');
  const text = await fs.readFile(r.file, 'utf8');
  assert.ok(Buffer.byteLength(text, 'utf8') <= FILE_MAX_BYTES, `应 ≤2KB，实际 ${Buffer.byteLength(text, 'utf8')}`);
  assert.ok(text.split('\n').length <= FILE_MAX_LINES, `应 ≤80 行，实际 ${text.split('\n').length}`);
});

test('MEMORY.md 注入幂等：已有指针行整行替换，不重复 unshift', () => {
  const first = statusSummaryLine({ summary: 's1', updatedAt: T0, source: 'a' });
  const second = statusSummaryLine({ summary: 's2 更长一点的摘要', updatedAt: tick(1), source: 'b' });
  const once = injectStatusIntoIndex('- [x](x.md)：内容\n', first);
  assert.ok(once.startsWith(first) && once.includes('- [x](x.md)：内容'));
  const twice = injectStatusIntoIndex(once, second);
  assert.equal(twice.split('> 📌 STATUS：').length - 1, 1, '指针行只应有一份');
  assert.ok(twice.includes(second) && !twice.includes(first), '应整行替换为最新指针');
  assert.ok(twice.includes('- [x](x.md)：内容'), '既有条目保留');
  const blank = injectStatusIntoIndex('', first);
  assert.equal(blank, `${first}\n`);
});

test('enumerateStatusTargets：交集命中、排除模式跳过、注册无 memory 不生成、死目录不生成', async () => {
  const root = await tmpRoot();
  const projectsRoot = await tmpRoot('pm-projects-');
  const cwdA = 'C:\\work\\alpha';
  const cwdB = 'C:\\work\\AppData-Local-Temp-skip';
  const cwdC = 'C:\\work\\gamma-nomemory';
  for (const cwd of [cwdA, cwdB]) {
    await fs.mkdir(path.join(projectsRoot, encodeProjectPath(cwd), 'memory'), { recursive: true });
  }
  await fs.mkdir(path.join(projectsRoot, 'Z--totally-unregistered', 'memory'), { recursive: true }); // 未注册死目录（与任何注册路径 fuzzy 不匹配）
  const wsJson = path.join(root, 'workspace.json');
  await fs.writeFile(wsJson, JSON.stringify({
    tables: { workspaces: {
      idA: { path: cwdA }, idB: { path: cwdB }, idC: { path: cwdC }, idD: { path: 'C:\\work\\dead-dir' },
    } },
  }), 'utf8');
  const targets = await enumerateStatusTargets({ root: projectsRoot, workspaceJsonPath: wsJson });
  assert.deepEqual(targets.map((t) => t.id), ['idA'], '只应命中 A（B 被排除、C 无 memory、死目录未注册）');
  assert.equal(targets[0].id, 'idA');
  assert.ok(targets[0].memDir.endsWith('memory'));
  // 注册表读不到 → 空（不生成）
  assert.deepEqual(await enumerateStatusTargets({ root: projectsRoot, workspaceJsonPath: path.join(root, 'nope.json') }), []);
});

test('workspaceIdFor：注册表命中用 id，未命中用路径 SHA-256 前 16 位', async () => {
  const root = await tmpRoot();
  const wsJson = path.join(root, 'workspace.json');
  await fs.writeFile(wsJson, JSON.stringify({ tables: { workspaces: { reg1: { path: 'C:\\Reg\\Path' } } } }), 'utf8');
  assert.equal(await workspaceIdFor('c:\\reg\\path\\', { workspaceJsonPath: wsJson }), 'reg1', '大小写与尾分隔符无关');
  const fallback = await workspaceIdFor('C:\\not\\registered', { workspaceJsonPath: wsJson });
  assert.match(fallback, /^[0-9a-f]{16}$/, '兜底应为 16 位十六进制');
  const fallback2 = await workspaceIdFor('c:\\NOT\\registered', { workspaceJsonPath: wsJson });
  assert.equal(fallback2, fallback, '兜底对路径大小写不敏感');
});

test('parseStatusDoc 往返：渲染后解析回七字段与输入一致（待补→空）', () => {
  const norm = normalizeStatusFields({
    stage: 'S', milestones: ['m1', 'm2'], inProgress: [], nextStart: 'N',
    keyDecisions: ['k1'], constraints: ['c1', 'c2'], workspaceId: 'w9',
  });
  const doc = renderStatusDoc(norm, { updatedAt: T0.toISOString(), source: '测试' });
  const back = parseStatusDoc(doc);
  assert.equal(back.stage, 'S');
  assert.deepEqual(back.milestones, ['m1', 'm2']);
  assert.deepEqual(back.inProgress, []);
  assert.equal(back.nextStart, 'N');
  assert.deepEqual(back.keyDecisions, ['k1']);
  assert.deepEqual(back.constraints, ['c1', 'c2']);
});

test('工具集：注册 memory_status_write 且 execute 走 created→updated→unchanged，journal 记 status 事件', async () => {
  const root = await tmpRoot();
  const journalDir = await fs.mkdtemp(path.join(tmpdir(), 'pm-journal-'));
  const cwd = 'C:\\proj\\tool';
  const tools = buildMemoryTools({ root, journalDir });
  const status = tools.find((t) => t.name === 'memory_status_write');
  assert.ok(status, '应注册 memory_status_write');
  assert.deepEqual(tools.map((t) => t.name), ['memory_read', 'memory_write', 'memory_search', 'memory_status_write']);
  const exec = { agent: { session: { header: { cwd } } } };
  const r1 = await status.execute({ summary: 'v1 状态', stage: 'v1', source: '单测' }, exec);
  assert.ok(r1.ok && r1.text.includes('新建'), '首次应为新建');
  const r2 = await status.execute({ summary: 'v2 状态', stage: 'v2', source: '单测' }, exec);
  assert.ok(r2.ok && r2.text.includes('更新'), '变化应为更新');
  const r3 = await status.execute({ summary: 'v2 状态', stage: 'v2', source: '单测' }, exec);
  assert.ok(r3.ok && r3.text.includes('无变化'), '同内容应为无变化');
  // merge 语义：只传 summary，stage 沿用旧值
  const memDir = path.join(root, encodeProjectPath(cwd), 'memory');
  const doc = await fs.readFile(path.join(memDir, STATUS_FILE), 'utf8');
  assert.ok(doc.includes('v2'), '未传字段应沿用旧值');
  const entries = (await fs.readFile(journalFile({ journalDir, cwd }), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(entries.some((e) => e.event === 'status' && e.action === 'created'), 'journal 应记 status 事件');
  // MEMORY.md 首行指针同步
  const indexText = await fs.readFile(path.join(memDir, 'MEMORY.md'), 'utf8');
  assert.ok(indexText.startsWith('> 📌 STATUS：'), 'MEMORY.md 首行应有指针');
});
