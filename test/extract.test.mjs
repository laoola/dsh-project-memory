/**
 * M2 全自动提取状态机单测（不打宿主，fake agent + 临时 journalDir + 毫秒级空闲窗口）。
 * 覆盖：空闲触发、消息形态、每会话限 1 轮（内存 + durable）、轮数闸、
 * 缺省 minTurns=1 单轮即提取（恢复会话 created 即布防）、子代理跳过、
 * running 撤防、followup 抛错可重试（error 不计入已提取）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildExtractor, EXTRACT_PROMPT } from '../lib/extract.js';
import { journalFile, readExtractSessions } from '../lib/journal.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const IDLE = 5; // 毫秒级空闲窗口，真实 setTimeout 足够稳定

async function tmpJournalDir() {
  return fs.mkdtemp(path.join(tmpdir(), 'pm-extract-'));
}

function fakeAgent({ id = 's1', cwd = 'D:\\proj\\demo', origin = 'user', depth = 0, fail = false } = {}) {
  const calls = [];
  const agent = {
    id,
    session: { id, header: { cwd, origin, delegationDepth: depth } },
    followup(message) {
      if (fail) throw new Error('agent disposed');
      calls.push(message);
    },
  };
  return { agent, calls };
}

async function journalEntries(journalDir, cwd) {
  const text = await fs.readFile(journalFile({ journalDir, cwd }), 'utf8');
  return text.trim().split('\n').map((line) => JSON.parse(line));
}

test('空闲后唤醒一轮提取：followup + journal 记 extract/followup', async () => {
  const journalDir = await tmpJournalDir();
  const cwd = 'D:\\proj\\smoke-ok';
  const ex = buildExtractor({ journalDir, idleMs: IDLE, minTurns: 3 });
  const { agent, calls } = fakeAgent({ cwd });
  ex.onCreated(agent);
  ex.onClaimed(agent, 0);
  ex.onClaimed(agent, 1);
  ex.onClaimed(agent, 2);
  ex.onStatus(agent, 'idle');
  await sleep(40);

  assert.equal(calls.length, 1, '应恰好唤醒一轮');
  const message = calls[0];
  assert.equal(message.role, 'user');
  assert.equal(message.source?.kind, 'project-memory');
  assert.equal(message.source?.form, 'extract');
  assert.equal(message.content?.[0]?.text, EXTRACT_PROMPT);

  const entries = await journalEntries(journalDir, cwd);
  const extract = entries.find((e) => e.event === 'extract');
  assert.ok(extract, 'journal 应有 extract 事件');
  assert.equal(extract.action, 'followup');
  assert.equal(extract.session, 's1');
  assert.equal(extract.turns, 3);
});

test('每会话限 1 轮：同实例再 idle 不重提，跨实例（重启模拟）durable 跳过', async () => {
  const journalDir = await tmpJournalDir();
  const cwd = 'D:\\proj\\once-only';
  const ex = buildExtractor({ journalDir, idleMs: IDLE, minTurns: 3 });
  const first = fakeAgent({ cwd });
  ex.onCreated(first.agent);
  for (const turn of [0, 1, 2]) ex.onClaimed(first.agent, turn);
  ex.onStatus(first.agent, 'idle');
  await sleep(40);
  assert.equal(first.calls.length, 1);

  ex.onStatus(first.agent, 'idle'); // 提取轮结束后再 idle
  await sleep(40);
  assert.equal(first.calls.length, 1, '内存占坑后不得二次提取');

  const second = buildExtractor({ journalDir, idleMs: IDLE, minTurns: 3 }); // 模拟宿主重启
  const resumed = fakeAgent({ cwd });
  second.onCreated(resumed.agent);
  for (const turn of [0, 1, 2]) second.onClaimed(resumed.agent, turn);
  second.onStatus(resumed.agent, 'idle');
  await sleep(40);
  assert.equal(resumed.calls.length, 0, 'journal durable 查重后不得重复提取');

  const entries = await journalEntries(journalDir, cwd);
  assert.ok(entries.some((e) => e.event === 'extract' && e.action === 'skip-done'));
});

test('轮数闸：观测轮数不足 minTurns 不布防（显式调大才生效）', async () => {
  const journalDir = await tmpJournalDir();
  const ex = buildExtractor({ journalDir, idleMs: IDLE, minTurns: 3 });
  const { agent, calls } = fakeAgent({ cwd: 'D:\\proj\\short' });
  ex.onCreated(agent);
  ex.onClaimed(agent, 0);
  ex.onClaimed(agent, 1);
  ex.onStatus(agent, 'idle');
  await sleep(40);
  assert.equal(calls.length, 0);
});

test('缺省 minTurns=1：单轮对话即提取；恢复会话 created 即布防（2026-10-14 用户裁决：不漏）', async () => {
  const journalDir = await tmpJournalDir();
  const cwd = 'D:\\proj\\single-turn';
  const ex = buildExtractor({ journalDir, idleMs: IDLE }); // 不传 minTurns，走缺省
  const { agent, calls } = fakeAgent({ cwd });
  ex.onCreated(agent); // 模拟恢复的会话：无任何新 claimed，created 即满足轮数闸
  ex.onStatus(agent, 'idle');
  await sleep(40);

  assert.equal(calls.length, 1, '单轮（created 预布防）也应唤醒提取');
  const entries = await journalEntries(journalDir, cwd);
  const extract = entries.find((e) => e.event === 'extract');
  assert.equal(extract?.action, 'followup');
  assert.equal(extract?.turns, 1);
});

test('子代理与无 cwd 会话跳过', async () => {
  const journalDir = await tmpJournalDir();
  const ex = buildExtractor({ journalDir, idleMs: IDLE, minTurns: 1 });
  const sub = fakeAgent({ cwd: 'D:\\proj\\x', origin: 'subagent' });
  ex.onCreated(sub.agent);
  ex.onClaimed(sub.agent, 0);
  ex.onStatus(sub.agent, 'idle');
  const noCwd = fakeAgent({ cwd: null }); // null 不会被解构默认值吃掉，真正模拟 header.cwd 缺失
  ex.onCreated(noCwd.agent);
  ex.onStatus(noCwd.agent, 'idle');
  await sleep(40);
  assert.equal(sub.calls.length, 0);
  assert.equal(noCwd.calls.length, 0);
});

test('running 撤防：布防后恢复活动则不触发，再次 idle 才布防', async () => {
  const journalDir = await tmpJournalDir();
  const ex = buildExtractor({ journalDir, idleMs: IDLE, minTurns: 3 });
  const { agent, calls } = fakeAgent({ cwd: 'D:\\proj\\active' });
  ex.onCreated(agent);
  for (const turn of [0, 1, 2]) ex.onClaimed(agent, turn);
  ex.onStatus(agent, 'idle');
  ex.onStatus(agent, 'running'); // 用户回来了
  await sleep(40);
  assert.equal(calls.length, 0, '活动恢复后不得在原窗口触发');

  ex.onStatus(agent, 'idle');
  await sleep(40);
  assert.equal(calls.length, 1);
});

test('followup 抛错：记 error、不计入已提取，换新实例可重试', async () => {
  const journalDir = await tmpJournalDir();
  const cwd = 'D:\\proj\\retry';
  const broken = buildExtractor({ journalDir, idleMs: IDLE, minTurns: 3 });
  const { agent, calls } = fakeAgent({ cwd, fail: true });
  broken.onCreated(agent);
  for (const turn of [0, 1, 2]) broken.onClaimed(agent, turn);
  broken.onStatus(agent, 'idle');
  await sleep(40);
  assert.equal(calls.length, 0);

  const entries = await journalEntries(journalDir, cwd);
  assert.ok(entries.some((e) => e.event === 'extract' && e.action === 'error'));
  assert.deepEqual([...(await readExtractSessions({ journalDir, cwd }))], [], 'error 不得计入已提取');

  const healthy = buildExtractor({ journalDir, idleMs: IDLE, minTurns: 3 });
  const again = fakeAgent({ cwd });
  healthy.onCreated(again.agent);
  for (const turn of [0, 1, 2]) healthy.onClaimed(again.agent, turn);
  healthy.onStatus(again.agent, 'idle');
  await sleep(40);
  assert.equal(again.calls.length, 1, '重试后应成功唤醒');
});

test('readExtractSessions 只认 action=followup 的 extract 事件', async () => {
  const journalDir = await tmpJournalDir();
  const cwd = 'D:\\proj\\filter';
  const ex = buildExtractor({ journalDir, idleMs: IDLE, minTurns: 1 });
  const done = fakeAgent({ cwd, id: 's-done' });
  const failed = fakeAgent({ cwd, id: 's-failed', fail: true });
  const other = fakeAgent({ cwd: 'D:\\proj\\other', id: 's-other' });
  for (const { agent } of [done, failed, other]) {
    ex.onCreated(agent);
    ex.onClaimed(agent, 0);
    ex.onStatus(agent, 'idle');
  }
  await sleep(60);
  const sessions = await readExtractSessions({ journalDir, cwd });
  assert.deepEqual([...sessions], ['s-done']);
});

test('配置校验：非法 idleMs/minTurns 回落缺省，extractEnabled=false 由入口侧短路', async () => {
  const ex = buildExtractor({ journalDir: await tmpJournalDir(), idleMs: -1, minTurns: 0 });
  assert.equal(ex.idleMs, 3 * 60 * 1000);
  assert.equal(ex.minTurns, 1);
});
