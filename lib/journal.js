/**
 * 本地 JSONL 使用日志（PRD 第 3 节指标唯一来源；无遥测，自愿回传）。
 * 位置：~/.dsh/memory/journal/<编码后项目路径>.jsonl（DSH 自有空间，不混入
 * Claude Code 的 projects 目录，避免干扰其会话转录扫描）。best-effort：任何
 * 日志失败都吞掉，绝不影响注入/工具主流程。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { encodeProjectPath } from './paths.js';

/** 记录文件路径（journalDir 缺省 ~/.dsh/memory/journal）。 */
export function journalFile({ journalDir, cwd }) {
  const dir = journalDir ?? path.join(homedir(), '.dsh', 'memory', 'journal');
  return path.join(dir, `${encodeProjectPath(cwd)}.jsonl`);
}

/**
 * 读出 journal 里已完成提取轮的会话 id 集合（M2 每会话限 1 轮的 durable 去重依据）。
 * 只认 action=followup 的 extract 事件（error/skip-done 不算已提取）。无文件返回空集。
 */
export async function readExtractSessions({ journalDir, cwd }) {
  const file = journalFile({ journalDir, cwd });
  const out = new Set();
  try {
    const text = await fs.readFile(file, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry?.event === 'extract' && entry?.action === 'followup' && typeof entry.session === 'string') {
          out.add(entry.session);
        }
      } catch {
        /* 跳过坏行 */
      }
    }
  } catch {
    /* 无文件 = 无记录 */
  }
  return out;
}

/**
 * @param {{journalDir?: string, cwd: string}} options
 * @returns {(fields: Record<string, unknown>) => Promise<void>}
 */
export function createJournal({ journalDir, cwd }) {
  const file = journalFile({ journalDir, cwd });
  return async function record(fields) {
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, `${JSON.stringify({ ts: new Date().toISOString(), ...fields })}\n`, 'utf8');
    } catch {
      /* best-effort */
    }
  };
}
