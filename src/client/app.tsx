/**
 * 知识库面板主界面（MVP 纯只读，原型 knowledge-base-prototype.html 的 React 实现）。
 * 布局：顶栏（面包屑+搜索+只读徽标）/ 左分区窄栏（四分区）/ 内容区（列表·卡片·阅读·搜索四态）。
 * 数据全部来自 host /dsh-project-memory/api/*（只读 GET），无本地写入路径。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, type FileEntry, type Overview, type SearchResult, type SectionListing } from './api.ts';
import { useT, type translate as Translate } from './i18n.ts';
import { Markdown, renderHighlighted } from './md.tsx';

type View =
  | { kind: 'cards' }
  | { kind: 'section'; sectionId: string; label: string }
  | { kind: 'doc'; path: string; name: string; label: string }
  | { kind: 'search'; q: string };

/** 展开的热项目数（原型交互：其余按更新时间沉底折叠；0 文件项目视为冷项沉底）。 */
const HOT_PROJECTS = 3;

/**
 * 中间截断：超长字符串保留首段+尾段，中间以 … 连接（路径/名称行统一截断策略，
 * 替代纯 CSS 单向 ellipsis——首尾都有信息量时中间截断更易辨认）。
 */
function truncateMiddle(input: string, max: number): string {
  if (input.length <= max) return input;
  const head = Math.max(6, Math.floor((max - 1) * 0.45));
  const tail = Math.max(4, max - head - 1);
  return `${input.slice(0, head)}…${input.slice(-tail)}`;
}

/**
 * 项目行展示名映射：优先 host 给的 name（真实目录尾段名）；同名冲突时逐级补父段
 * 消歧（如 GitCode\dsh 与 Downloads\dsh），只对带可信 displayPath 的条目消歧。
 */
function projectLabels(list: Overview['projects']): Map<string, string> {
  const labels = new Map<string, string>();
  const groups = new Map<string, Overview['projects']>();
  for (const project of list) {
    labels.set(project.id, project.name ?? project.dir);
    if (!project.name || !project.displayPath) continue;
    const group = groups.get(project.name);
    if (group) group.push(project);
    else groups.set(project.name, [project]);
  }
  for (const [name, group] of groups) {
    if (group.length < 2) continue;
    let keys: string[] = group.map(() => name);
    for (let depth = 1; depth <= 12; depth += 1) {
      keys = group.map((project) => {
        const segments = (project.displayPath ?? '').split(/[\\/]/).filter(Boolean);
        const parents = segments.slice(Math.max(0, segments.length - 1 - depth), segments.length - 1);
        return [...parents.reverse(), name].join('\\');
      });
      if (new Set(keys).size === group.length) break;
    }
    group.forEach((project, index) => labels.set(project.id, keys[index] ?? name));
  }
  return labels;
}

/** 通用异步数据 hook：fetcher 走 ref 防无限循环，alive 标记防卸载后 setState。 */
function useAsyncData<T>(fetcher: () => Promise<T>, deps: unknown[]): { data?: T; error?: Error; loading: boolean } {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    fetcherRef.current().then(
      (data) => { if (alive) setState({ data, loading: false }); },
      (error) => { if (alive) setState({ error: error instanceof Error ? error : new Error(String(error)), loading: false }); },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function formatTime(ms?: number): string {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleDateString();
  } catch {
    return '';
  }
}

function IconDoc({ size = 14 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 1.5h5.2L13 5.3V14a.5.5 0 0 1-.5.5h-8A.5.5 0 0 1 4 14V1.5Z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M9 1.8V5.5h3.6" stroke="currentColor" strokeLinejoin="round" />
      <path d="M6 8.5h4M6 11h4" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

function IconLib({ size = 15 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 2.5h2.6v11H2zM6 2.5h2.6v11H6z" stroke="currentColor" strokeLinejoin="round" />
      <path d="m10.2 3.3 2.5-.7 2 10.7-2.5.7z" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  );
}

/** 分区 id → 展示名（搜索结果行用它还原分区；项目分区优先 host 给的真实名）。 */
function sectionLabel(sectionId: string, overview: Overview | undefined, t: typeof Translate): string {
  if (sectionId === 'global') return t('client.sections.global');
  if (sectionId.startsWith('p:')) {
    return overview?.projects.find((project) => project.id === sectionId)?.name ?? sectionId.slice(2);
  }
  const source = overview?.sources.find((s) => s.id === sectionId.slice(2));
  return source?.label ?? sectionId.slice(2);
}

// ————————————————————————————————————————————————————————————
// 列表态（某分区下的文件清单）
// ————————————————————————————————————————————————————————————

function SectionFiles({ sectionId, onOpenDoc, t }: {
  sectionId: string;
  onOpenDoc: (file: FileEntry) => void;
  t: typeof Translate;
}): ReactNode {
  const listing = useAsyncData<SectionListing>(() => api.list(sectionId), [sectionId]);
  if (listing.loading) return <div className="dsh-pm-loading">{t('client.state.loading')}</div>;
  if (listing.error) return <div className="dsh-pm-error">{`${t('client.state.error')}：${listing.error.message}`}</div>;
  const files = listing.data?.files ?? [];
  if (!files.length) {
    return (
      <div className="dsh-pm-empty">
        <div className="dsh-pm-empty-title">{t('client.empty.listTitle')}</div>
        {t('client.empty.list')}
      </div>
    );
  }
  return (
    <div>
      <div className="dsh-pm-group-h">{listing.data?.label ?? sectionId} · {files.length}</div>
      {files.map((file) => (
        <button key={file.path} type="button" className="dsh-pm-row" onClick={() => onOpenDoc(file)}>
          <span className="dsh-pm-row-icon"><IconDoc /></span>
          <span className="dsh-pm-row-main">
            <span className="dsh-pm-row-title">{file.title}</span>
            <span className="dsh-pm-row-summary">{file.summary || file.path}</span>
          </span>
          <span className="dsh-pm-row-time">{formatTime(file.mtimeMs)}</span>
        </button>
      ))}
    </div>
  );
}

// ————————————————————————————————————————————————————————————
// 搜索结果态
// ————————————————————————————————————————————————————————————

function SearchResults({ q, overview, onOpenDoc, t }: {
  q: string;
  overview?: Overview;
  onOpenDoc: (path: string, name: string, label: string) => void;
  t: typeof Translate;
}): ReactNode {
  const result = useAsyncData<SearchResult>(() => api.search(q), [q]);
  if (result.loading) return <div className="dsh-pm-loading">{t('client.state.loading')}</div>;
  if (result.error) return <div className="dsh-pm-error">{`${t('client.state.error')}：${result.error.message}`}</div>;
  const data = result.data;
  if (!data || data.groups.length === 0) {
    return (
      <div className="dsh-pm-empty">
        <div className="dsh-pm-empty-title">{t('client.empty.searchTitle')}</div>
        {t('client.empty.search', { query: q })}
      </div>
    );
  }
  return (
    <div>
      <div className="dsh-pm-sr-stat">{t('client.search.stat', { files: data.fileCount, lines: data.lineCount })}</div>
      {data.groups.map((group) => (
        <button
          key={group.path}
          type="button"
          className="dsh-pm-sr-row"
          onClick={() => onOpenDoc(group.path, group.name, sectionLabel(group.sectionId, overview, t))}
        >
          <span className="dsh-pm-sr-path">
            <span className="dsh-pm-pill">{sectionLabel(group.sectionId, overview, t)}</span>
            <span className="dsh-pm-sr-name">{group.name}</span>
            <span className="dsh-pm-sr-file" title={group.path}>{truncateMiddle(group.path, 52)}</span>
          </span>
          {group.lines.map((line) => (
            <span key={line.no} className="dsh-pm-sr-line">
              <span className="dsh-pm-no">{line.no}</span>
              {renderHighlighted(line.text, q, `l${line.no}`)}
            </span>
          ))}
        </button>
      ))}
    </div>
  );
}

// ————————————————————————————————————————————————————————————
// 主组件
// ————————————————————————————————————————————————————————————

export function KnowledgeApp({ onClose }: { onClose?: () => void }): ReactNode {
  const t = useT();
  const [view, setView] = useState<View>({ kind: 'cards' });
  const [, setStack] = useState<View[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [coldFolded, setColdFolded] = useState(true);
  const overviewState = useAsyncData<Overview>(() => api.overview(), []);
  const overview = overviewState.data;

  // 搜索框：输入防抖 250ms 即搜；清空回卡片页（原型交互）
  useEffect(() => {
    const q = searchInput.trim();
    const timer = setTimeout(() => {
      if (q) setView({ kind: 'search', q });
      else setView((current) => (current.kind === 'search' ? { kind: 'cards' } : current));
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const navigate = (next: View) => {
    setStack((current) => [...current, view]);
    setView(next);
  };
  const back = () => {
    setStack((current) => {
      if (!current.length) return current;
      setView(current[current.length - 1]);
      return current.slice(0, -1);
    });
  };
  const goHome = () => {
    setStack([]);
    setView({ kind: 'cards' });
    setSearchInput('');
  };

  // 0 文件项目视为冷项沉底，其余按最近更新时间倒序（原型交互）
  const projects = [...(overview?.projects ?? [])].sort(
    (a, b) => (a.fileCount === 0 ? 1 : 0) - (b.fileCount === 0 ? 1 : 0) || b.mtimeMs - a.mtimeMs,
  );
  const projectLabel = projectLabels(projects);
  const hotProjects = projects.slice(0, HOT_PROJECTS);
  const coldProjects = coldFolded ? [] : projects.slice(HOT_PROJECTS);

  // 阅读视图数据：hooks 不可条件调用——始终挂载，空路径时短路不打请求
  const docPath = view.kind === 'doc' ? view.path : '';
  const doc = useAsyncData(
    () => (docPath ? api.file(docPath) : Promise.reject(new Error('inactive'))),
    [docPath],
  );

  let content: ReactNode;
  if (view.kind === 'cards') {
    content = (
      <div>
        <div className="dsh-pm-group-h">{t('client.cards.heading')}</div>
        <div className="dsh-pm-cards">
          {overview?.global.exists && (
            <button
              key="global"
              type="button"
              className="dsh-pm-card"
              onClick={() => navigate({ kind: 'section', sectionId: 'global', label: t('client.sections.global') })}
            >
              <span className="dsh-pm-card-head"><IconLib /> {t('client.cards.globalTitle')} <span className="dsh-pm-rail-badge">{overview.global.fileCount}</span></span>
              <span className="dsh-pm-card-desc">{t('client.cards.globalDesc')}</span>
              <span className="dsh-pm-card-path" title={overview.global.path}>{truncateMiddle(overview.global.displayPath ?? overview.global.path, 46)}</span>
            </button>
          )}
          {(overview?.sources ?? []).map((source) => (
            <button
              key={source.id}
              type="button"
              className="dsh-pm-card"
              onClick={() => navigate({ kind: 'section', sectionId: `s:${source.id}`, label: source.label })}
            >
              <span className="dsh-pm-card-head"><IconLib /> {source.label} <span className="dsh-pm-rail-badge">{source.fileCount}</span></span>
              <span className="dsh-pm-card-desc">{source.description}</span>
              <span className="dsh-pm-card-path" title={source.root}>{truncateMiddle(source.root, 46)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  } else if (view.kind === 'section') {
    content = (
      <SectionFiles
        sectionId={view.sectionId}
        onOpenDoc={(file) => navigate({ kind: 'doc', path: file.path, name: file.name, label: file.title })}
        t={t}
      />
    );
  } else if (view.kind === 'doc') {
    if (doc.loading) content = <div className="dsh-pm-loading">{t('client.state.loading')}</div>;
    else if (doc.error && docPath) content = <div className="dsh-pm-error">{`${t('client.state.error')}：${doc.error.message}`}</div>;
    else if (doc.data) content = <Markdown text={doc.data.text} />;
    else content = null;
  } else {
    content = (
      <SearchResults
        q={view.q}
        overview={overview}
        onOpenDoc={(path, name, label) => navigate({ kind: 'doc', path, name, label })}
        t={t}
      />
    );
  }

  const crumbTail = view.kind === 'section' ? view.label
    : view.kind === 'doc' ? view.label || view.name
    : view.kind === 'search' ? t('client.search.title')
    : t('client.cards.heading');

  return (
    <div className="dsh-pm-root" data-dsh-project-memory-panel="">
      <div className="dsh-pm-bar">
        <div className="dsh-pm-crumb">
          {view.kind !== 'cards' && (
            <button type="button" className="dsh-pm-crumb-back" onClick={back} title={t('client.doc.back')}>‹</button>
          )}
          <button type="button" className="dsh-pm-crumb-title" onClick={goHome}>{t('client.panel.title')}</button>
          {view.kind !== 'cards' && <span className="dsh-pm-crumb-sep">/</span>}
          {view.kind !== 'cards' && <span className="dsh-pm-crumb-title">{crumbTail}</span>}
        </div>
        <div className="dsh-pm-search">
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSearchInput('');
            }}
            placeholder={t('client.search.placeholder')}
            aria-label={t('client.search.placeholder')}
          />
          <kbd>Esc</kbd>
        </div>
        {overview && (
          <span className="dsh-pm-count">{t('client.meta.count', { projects: overview.projects.length, sources: overview.sources.length })}</span>
        )}
        <span className="dsh-pm-ro-badge"><span className="dsh-pm-ro-dot" />{t('client.panel.readonly')}</span>
        {onClose && (
          <button type="button" className="dsh-pm-close" onClick={onClose} aria-label={t('client.doc.close')}>✕</button>
        )}
      </div>
      <div className="dsh-pm-body">
        <nav className="dsh-pm-rail" aria-label={t('client.panel.title')}>
          <button
            type="button"
            className={`dsh-pm-rail-item${view.kind === 'section' && view.sectionId === 'global' ? ' is-active' : ''}`}
            onClick={() => navigate({ kind: 'section', sectionId: 'global', label: t('client.sections.global') })}
          >
            <IconLib />
            <span>{t('client.sections.global')}</span>
            <span className="dsh-pm-rail-badge">{overview?.global.exists ? overview.global.fileCount : 0}</span>
          </button>
          {overview?.global.exists && (
            <div className="dsh-pm-rail-note" title={overview.global.path}>
              {truncateMiddle(overview.global.displayPath ?? overview.global.path, 44)}
            </div>
          )}

          <div className="dsh-pm-rail-group">{t('client.sections.projects')}</div>
          {hotProjects.map((project) => {
            const label = projectLabel.get(project.id) ?? project.dir;
            return (
              <button
                key={project.id}
                type="button"
                className={`dsh-pm-rail-sub${view.kind === 'section' && view.sectionId === project.id ? ' is-active' : ''}`}
                onClick={() => navigate({ kind: 'section', sectionId: project.id, label })}
                title={project.pathExists === false ? `${project.displayPath ?? project.dir}（项目路径已不存在）` : (project.displayPath ?? project.dir)}
              >
                <IconDoc size={12} />
                <span className="dsh-pm-rail-sub-name">
                  {truncateMiddle(label, 28)}
                  {project.pathExists === false ? ' ⚠' : ''}
                </span>
                <span className="dsh-pm-rail-badge">{project.fileCount}</span>
              </button>
            );
          })}
          {coldProjects.map((project) => {
            const label = projectLabel.get(project.id) ?? project.dir;
            return (
              <button
                key={project.id}
                type="button"
                className={`dsh-pm-rail-sub${view.kind === 'section' && view.sectionId === project.id ? ' is-active' : ''}`}
                onClick={() => navigate({ kind: 'section', sectionId: project.id, label })}
                title={project.pathExists === false ? `${project.displayPath ?? project.dir}（项目路径已不存在）` : (project.displayPath ?? project.dir)}
              >
                <IconDoc size={12} />
                <span className="dsh-pm-rail-sub-name">
                  {truncateMiddle(label, 28)}
                  {project.pathExists === false ? ' ⚠' : ''}
                </span>
                <span className="dsh-pm-rail-badge">{project.fileCount}</span>
              </button>
            );
          })}
          {projects.length > HOT_PROJECTS && (
            <button type="button" className="dsh-pm-rail-fold" onClick={() => setColdFolded((folded) => !folded)}>
              {coldFolded ? `▸ ${t('client.fold.more', { count: projects.length - HOT_PROJECTS })}` : `▾ ${t('client.fold.less')}`}
            </button>
          )}

          <div className="dsh-pm-rail-group">{t('client.sections.sources')}</div>
          {(overview?.sources ?? []).map((source) => (
            <button
              key={source.id}
              type="button"
              className={`dsh-pm-rail-sub${view.kind === 'section' && view.sectionId === `s:${source.id}` ? ' is-active' : ''}`}
              onClick={() => navigate({ kind: 'section', sectionId: `s:${source.id}`, label: source.label })}
            >
              <IconLib size={12} />
              <span className="dsh-pm-rail-sub-name" title={source.root}>{truncateMiddle(source.label, 24)}</span>
              <span className="dsh-pm-rail-badge">{source.fileCount}</span>
            </button>
          ))}
          {!overview && <div className="dsh-pm-rail-note">{t('client.state.loading')}</div>}

          <div className="dsh-pm-rail-group">{t('client.sections.knowledge')}</div>
          <button type="button" className="dsh-pm-rail-item is-disabled" disabled title={t('client.knowledge.reserved')}>
            <IconLib />
            <span>{t('client.sections.knowledge')}</span>
            <span className="dsh-pm-rail-badge">M3</span>
          </button>
        </nav>
        <main className="dsh-pm-content">{content}</main>
      </div>
    </div>
  );
}
