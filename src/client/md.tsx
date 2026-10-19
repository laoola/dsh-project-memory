/**
 * 轻量只读 Markdown 渲染器（MVP：零新运行时依赖）。
 * 安全策略：不使用 dangerouslySetInnerHTML——先把纯文本按块/行内解析，
 * 全部内容经 JSX 文本节点输出，天然转义；链接仅放行 http(s)/# 锚。
 * 支持块级：h1-h3、ul/ol、代码块、引用、hr、段落；行内：code、粗体、斜体、链接、<mark> 高亮。
 */
import type { ReactNode } from 'react';

/** 按 URL 协议白名单判定链接可达（防 javascript: 等危险 scheme）。 */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('#')) return trimmed;
  return null;
}

/** 行内解析：`code`、**bold**、*italic*、[text](href)。输入是纯文本（非 HTML）。 */
export function renderInline(text: string, keyPrefix = ''): ReactNode[] {
  const out: ReactNode[] = [];
  // 顺序扫描：优先代码（代码内不再解析其它行内语法）
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${keyPrefix}i${index++}`;
    if (match[1] !== undefined) out.push(<code key={key}>{match[1]}</code>);
    else if (match[2] !== undefined) out.push(<strong key={key}>{renderInline(match[2], key)}</strong>);
    else if (match[3] !== undefined) out.push(<em key={key}>{renderInline(match[3], key)}</em>);
    else if (match[4] !== undefined && match[5] !== undefined) {
      const href = safeHref(match[5]);
      out.push(
        href
          ? <a key={key} href={href} target="_blank" rel="noreferrer noopener">{match[4]}</a>
          : <span key={key}>{match[4]}</span>,
      );
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** 搜索命中高亮：大小写不敏感分割，命中片段包 <mark>。 */
export function renderHighlighted(text: string, needle: string, keyPrefix = ''): ReactNode[] {
  const q = needle.trim().toLowerCase();
  if (!q) return [text];
  const out: ReactNode[] = [];
  const lower = text.toLowerCase();
  let cursor = 0;
  let index = 0;
  while (cursor < text.length) {
    const at = lower.indexOf(q, cursor);
    if (at < 0) {
      out.push(text.slice(cursor));
      break;
    }
    if (at > cursor) out.push(text.slice(cursor, at));
    out.push(<mark key={`${keyPrefix}m${index++}`} className="dsh-pm-mark">{text.slice(at, at + q.length)}</mark>);
    cursor = at + q.length;
  }
  return out;
}

interface Block {
  kind: 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'code' | 'quote' | 'hr' | 'p';
  lines: string[];
  lang?: string;
}

/** 块级切分：代码块优先（内部不解析），其余按行归类。 */
function splitBlocks(source: string): Block[] {
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''); // 剥 frontmatter
  const lines = body.split(/\r?\n/);
  const blocks: Block[] = [];
  let current: Block | undefined;
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];
  for (const line of lines) {
    if (inCode) {
      if (/^\s*```/.test(line)) {
        blocks.push({ kind: 'code', lines: codeLines, lang: codeLang });
        inCode = false;
        codeLines = [];
        current = undefined;
      } else {
        codeLines.push(line);
      }
      continue;
    }
    if (/^\s*```/.test(line)) {
      current = undefined;
      inCode = true;
      codeLang = line.replace(/^\s*```/, '').trim();
      continue;
    }
    if (/^\s*$/.test(line)) {
      current = undefined;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3;
      const kind = (level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3') as 'h1' | 'h2' | 'h3';
      blocks.push({ kind, lines: [heading[2]] });
      current = undefined;
      continue;
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      blocks.push({ kind: 'hr', lines: [] });
      current = undefined;
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      const kind = bullet ? 'ul' : 'ol';
      if (current?.kind !== kind) {
        current = { kind, lines: [] };
        blocks.push(current);
      }
      current.lines.push((bullet ?? ordered)![1]);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      if (current?.kind !== 'quote') {
        current = { kind: 'quote', lines: [] };
        blocks.push(current);
      }
      current.lines.push(line.replace(/^\s*>\s?/, ''));
      continue;
    }
    if (current?.kind !== 'p') {
      current = { kind: 'p', lines: [] };
      blocks.push(current);
    }
    current.lines.push(line);
  }
  if (inCode && codeLines.length) blocks.push({ kind: 'code', lines: codeLines, lang: codeLang });
  return blocks;
}

export function Markdown({ text }: { text: string }): ReactNode {
  const blocks = splitBlocks(text);
  return (
    <div className="dsh-pm-article">
      {blocks.map((block, i) => {
        const key = `b${i}`;
        switch (block.kind) {
          case 'h1': return <h1 key={key}>{renderInline(block.lines[0], key)}</h1>;
          case 'h2': return <h2 key={key}>{renderInline(block.lines[0], key)}</h2>;
          case 'h3': return <h3 key={key}>{renderInline(block.lines[0], key)}</h3>;
          case 'hr': return <hr key={key} />;
          case 'code':
            return (
              <pre key={key}><code>{block.lines.join('\n')}</code></pre>
            );
          case 'ul':
            return <ul key={key}>{block.lines.map((item, j) => <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>)}</ul>;
          case 'ol':
            return <ol key={key}>{block.lines.map((item, j) => <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>)}</ol>;
          case 'quote':
            return <blockquote key={key}>{block.lines.map((item, j) => <p key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</p>)}</blockquote>;
          default:
            return <p key={key}>{renderInline(block.lines.join(' '), key)}</p>;
        }
      })}
    </div>
  );
}
