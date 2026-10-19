/**
 * 知识库面板 client ↔ host API 封装。
 * envelope 契约对齐 dsh-taskboard client：{ok:true,value} / {ok:false,error:{code,message}}。
 * 面板纯只读，仅 GET。
 */
const PREFIX = '/dsh-project-memory';

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'ApiError';
    this.code = code;
  }
}

async function unwrap<T>(pending: Promise<Response>, path: string): Promise<T> {
  let res: Response;
  try {
    res = await pending;
  } catch (cause) {
    throw new ApiError('network', `${path}: 网络请求失败（${cause instanceof Error ? cause.message : String(cause)}）`);
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new ApiError('network', `${path}: 响应体读取失败（HTTP ${res.status}）`);
  }
  if (text.trim().length === 0) throw new ApiError('empty_body', `${path}: 空响应（HTTP ${res.status}）`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError('bad_json', `${path}: 非 JSON 响应（HTTP ${res.status}）`);
  }
  if (typeof body !== 'object' || body === null || !('ok' in body)) {
    throw new ApiError('bad_envelope', `${path}: 非法响应结构`);
  }
  const envelope = body as { ok: boolean; value?: unknown; error?: { code?: unknown; message?: unknown } };
  if (!envelope.ok) {
    if (typeof envelope.error?.code !== 'string' || typeof envelope.error?.message !== 'string') {
      throw new ApiError('bad_envelope', `${path}: 非法错误响应`);
    }
    throw new ApiError(envelope.error.code, envelope.error.message);
  }
  if (!('value' in envelope)) throw new ApiError('bad_envelope', `${path}: 响应缺 value`);
  return envelope.value as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return unwrap<T>(fetch(`${PREFIX}${path}`, { signal: AbortSignal.timeout(10_000) }), path);
}

// ———— host 返回的数据形状（lib/routes.js 对应） ————

export interface ProjectEntry {
  id: string;
  dir: string;
  /** 展示名：nameIndex 命中为真实尾段名，否则为编码名启发尾段（host 端给）。 */
  name?: string;
  /** 真实原生路径（home 缩写形式，如 ~\GitCode\dsh）。仅 nameIndex 命中时存在。 */
  displayPath?: string;
  fileCount: number;
  mtimeMs: number;
}

export interface Overview {
  memoryRoot: string;
  global: { exists: boolean; path: string; displayPath?: string; fileCount: number };
  projects: ProjectEntry[];
  sources: Array<{ id: string; label: string; description: string; root: string; fileCount: number }>;
}

export interface FileEntry {
  name: string;
  path: string;
  title: string;
  summary: string;
  mtimeMs?: number;
  size?: number;
  kind: string;
}

export interface SectionListing {
  sectionId: string;
  kind: 'memory' | 'source';
  dir: string;
  /** 展示用路径（home 缩写）：global/源=目录本身缩写，项目=真实项目路径（命中时）。 */
  displayPath?: string;
  label: string;
  files: FileEntry[];
}

export interface DocPayload {
  path: string;
  name: string;
  sectionId: string;
  text: string;
  mtimeMs: number;
}

export interface SearchResult {
  query: string;
  fileCount: number;
  lineCount: number;
  groups: Array<{ path: string; sectionId: string; name: string; lines: Array<{ no: number; text: string }> }>;
}

export const api = {
  overview: () => apiGet<Overview>('/api/overview'),
  list: (sectionId: string) => apiGet<SectionListing>(`/api/list?section=${encodeURIComponent(sectionId)}`),
  file: (path: string) => apiGet<DocPayload>(`/api/file?path=${encodeURIComponent(path)}`),
  search: (q: string) => apiGet<SearchResult>(`/api/search?q=${encodeURIComponent(q)}`),
};
