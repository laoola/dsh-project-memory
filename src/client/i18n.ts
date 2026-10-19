/**
 * 面板文案 i18n：字典唯一来源 locale/{zh,en}.json（构建期内联进 bundle）。
 * 语言探测：ctx.get('locale') 快照（可订阅跟随）→ <html lang> → navigator → en。
 * 查词顺序：active 字典 → en 字典 → key（缺失键兜底，不炸界面）。
 */
import { useSyncExternalStore } from 'react';
import zhJson from '../../locale/zh.json';
import enJson from '../../locale/en.json';

type Dict = Record<string, string>;

function flatten(source: unknown, prefix = '', out: Dict = {}): Dict {
  if (typeof source !== 'object' || source === null) return out;
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else flatten(value, path, out);
  }
  return out;
}

const DICTS: Record<string, Dict> = {
  zh: flatten(zhJson),
  en: flatten(enJson),
};

function detectLocale(): string {
  try {
    const lang = document.documentElement?.getAttribute('lang') || navigator.language || 'en';
    return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

let active = detectLocale();
const listeners = new Set<() => void>();

function setLocale(lang: string): void {
  const next = String(lang).toLowerCase().startsWith('zh') ? 'zh' : 'en';
  if (next === active) return;
  active = next;
  for (const listener of listeners) listener();
}

interface LocaleServiceFace {
  getSnapshot?(): { active?: unknown } | undefined;
  subscribe?(fn: () => void): unknown;
}

/** 软挂 locale 服务（可能未就绪/不存在）；返回 disposer。 */
export function initI18n(service?: unknown): () => void {
  const localeService = service as LocaleServiceFace | undefined;
  let detach: (() => void) | undefined;
  const read = () => {
    try {
      const value = localeService?.getSnapshot?.()?.active;
      if (typeof value === 'string') setLocale(value);
    } catch { /* 服务异常：保持探测值 */ }
  };
  read();
  if (typeof localeService?.subscribe === 'function') {
    try {
      const unsub = localeService.subscribe(read);
      if (typeof unsub === 'function') detach = unsub as () => void;
    } catch { /* 不可订阅：一次性探测 */ }
  }
  return () => {
    detach?.();
    detach = undefined;
  };
}

export function translate(key: string, params?: Record<string, string | number>): string {
  const dict = DICTS[active] ?? {};
  let text = dict[key] ?? DICTS.en[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => active;

/** React 绑定：语言切换时触发重渲染。 */
export function useT(): typeof translate {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return translate;
}
