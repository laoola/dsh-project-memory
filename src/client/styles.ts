/**
 * 面板样式：单条 <style> 注入（对齐 dsh-taskboard 模式——样式表不自删，
 * 由宿主 HMR 拥有清理；规则全部 dsh-pm- 前缀作用域，惰性无害）。
 * 色板对齐知识库交互原型（brand #4d6bfe / bg #f7f8fa / line #e8eaee），
 * 颜色优先取宿主 --dsw-* token，缺失时回落原型值。
 */
export const STYLES = `
.dsh-pm-root {
  --dsh-pm-brand: var(--dsw-brand, #4d6bfe);
  --dsh-pm-brand-soft: var(--dsw-brand-soft, #eef1ff);
  --dsh-pm-bg: var(--dsw-bg, #f7f8fa);
  --dsh-pm-panel: var(--dsw-surface, #ffffff);
  --dsh-pm-line: var(--dsw-border, #e8eaee);
  --dsh-pm-text: var(--dsw-text, #1f2329);
  --dsh-pm-muted: var(--dsw-text-muted, #8a919f);
  --dsh-pm-mark: #fff1a8;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsh-pm-bg);
  color: var(--dsh-pm-text);
  font-size: 13px;
  line-height: 1.6;
  overflow: hidden;
}
.dsh-pm-root *, .dsh-pm-overlay * { box-sizing: border-box; }
.dsh-pm-root button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
.dsh-pm-root :focus-visible { outline: 2px solid var(--dsh-pm-brand); outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) {
  .dsh-pm-root *, .dsh-pm-overlay * { transition: none !important; animation: none !important; }
}

/* —— 顶栏 —— */
.dsh-pm-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--dsh-pm-panel);
  border-bottom: 1px solid var(--dsh-pm-line);
  flex: none;
}
.dsh-pm-crumb { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dsh-pm-crumb-title { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-pm-crumb-sep { color: var(--dsh-pm-muted); }
.dsh-pm-crumb-back {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 6px; color: var(--dsh-pm-brand);
}
.dsh-pm-crumb-back:hover { background: var(--dsh-pm-brand-soft); }
.dsh-pm-search {
  flex: 1 1 auto; min-width: 120px; max-width: 430px; margin-left: auto;
  display: flex; align-items: center; gap: 6px;
  padding: 5px 10px; border: 1px solid var(--dsh-pm-line); border-radius: 8px;
  background: var(--dsh-pm-bg);
}
.dsh-pm-search:focus-within { border-color: var(--dsh-pm-brand); background: var(--dsh-pm-panel); }
.dsh-pm-search input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  color: inherit; font-size: 12.5px;
}
.dsh-pm-search kbd {
  flex: none; font-size: 10px; color: var(--dsh-pm-muted);
  border: 1px solid var(--dsh-pm-line); border-radius: 4px; padding: 0 4px;
}
.dsh-pm-count { flex: none; color: var(--dsh-pm-muted); font-size: 12px; white-space: nowrap; }
.dsh-pm-ro-badge {
  flex: none; display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; color: var(--dsh-pm-muted);
  padding: 2px 8px; border: 1px solid var(--dsh-pm-line); border-radius: 999px;
}
.dsh-pm-ro-dot { width: 6px; height: 6px; border-radius: 50%; background: #22a06b; }
.dsh-pm-close {
  flex: none; width: 24px; height: 24px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--dsh-pm-muted); font-size: 15px;
}
.dsh-pm-close:hover { background: var(--dsh-pm-bg); color: var(--dsh-pm-text); }

/* —— 主体布局 —— */
.dsh-pm-body { flex: 1; display: flex; min-height: 0; }
.dsh-pm-rail {
  flex: none; width: 236px; overflow-y: auto;
  border-right: 1px solid var(--dsh-pm-line);
  background: var(--dsh-pm-panel);
  padding: 8px 6px 16px;
}
.dsh-pm-content { flex: 1; min-width: 0; overflow-y: auto; padding: 14px 18px 40px; }

/* —— rail 分区 —— */
.dsh-pm-rail-item {
  display: flex; align-items: center; gap: 7px; width: 100%;
  padding: 6px 8px; border-radius: 7px; text-align: left;
  color: var(--dsh-pm-text);
}
.dsh-pm-rail-item:hover { background: var(--dsh-pm-bg); }
.dsh-pm-rail-item.is-active { background: var(--dsh-pm-brand-soft); color: var(--dsh-pm-brand); font-weight: 600; }
.dsh-pm-rail-item.is-disabled { color: var(--dsh-pm-muted); cursor: not-allowed; opacity: 0.62; }
.dsh-pm-rail-item.is-disabled:hover { background: none; }
.dsh-pm-rail-badge {
  margin-left: auto; flex: none; font-size: 10.5px; color: var(--dsh-pm-muted);
  background: var(--dsh-pm-bg); border-radius: 999px; padding: 0 7px;
}
.dsh-pm-rail-item.is-active .dsh-pm-rail-badge { background: var(--dsh-pm-panel); color: var(--dsh-pm-brand); }
.dsh-pm-rail-note {
  padding: 1px 8px 6px 23px; font-size: 10.5px; color: var(--dsh-pm-muted);
  white-space: nowrap; overflow: hidden;
}
.dsh-pm-rail-group {
  margin: 12px 8px 4px; font-size: 11px; font-weight: 600; color: var(--dsh-pm-muted);
  letter-spacing: 0.02em;
}
.dsh-pm-rail-sub {
  display: flex; align-items: center; gap: 6px; width: 100%;
  padding: 4px 8px 4px 23px; border-radius: 6px; text-align: left; color: var(--dsh-pm-text);
}
.dsh-pm-rail-sub:hover { background: var(--dsh-pm-bg); }
.dsh-pm-rail-sub.is-active { background: var(--dsh-pm-brand-soft); color: var(--dsh-pm-brand); font-weight: 600; }
.dsh-pm-rail-sub-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; }
.dsh-pm-rail-fold {
  display: flex; align-items: center; gap: 6px; width: 100%;
  margin-top: 2px; padding: 5px 8px 5px 23px;
  font-size: 11.5px; color: var(--dsh-pm-muted); border-radius: 6px;
}
.dsh-pm-rail-fold:hover { background: var(--dsh-pm-bg); color: var(--dsh-pm-text); }

/* —— 列表行 —— */
.dsh-pm-group-h {
  margin: 16px 2px 8px; font-size: 11px; font-weight: 600; color: var(--dsh-pm-muted);
  letter-spacing: 0.02em;
}
.dsh-pm-group-h:first-child { margin-top: 2px; }
.dsh-pm-row {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 9px 12px; border-radius: 9px; text-align: left;
  border: 1px solid var(--dsh-pm-line); background: var(--dsh-pm-panel);
  margin-bottom: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.dsh-pm-row:hover { border-color: var(--dsh-pm-brand); box-shadow: 0 1px 6px rgb(77 107 254 / 10%); }
.dsh-pm-row-icon { flex: none; color: var(--dsh-pm-brand); display: inline-flex; }
.dsh-pm-row-main { flex: 1; min-width: 0; }
.dsh-pm-row-title { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-pm-row-summary {
  color: var(--dsh-pm-muted); font-size: 12px; margin-top: 1px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.dsh-pm-row-time { flex: none; color: var(--dsh-pm-muted); font-size: 11px; white-space: nowrap; }
.dsh-pm-row-mono { color: var(--dsh-pm-muted); font-size: 11px; font-family: ui-monospace, Consolas, monospace; }

/* —— 源卡片 —— */
.dsh-pm-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
.dsh-pm-card {
  display: flex; flex-direction: column; gap: 6px; width: 100%;
  padding: 12px 14px; border-radius: 10px; text-align: left;
  border: 1px solid var(--dsh-pm-line); background: var(--dsh-pm-panel);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.dsh-pm-card:hover { border-color: var(--dsh-pm-brand); box-shadow: 0 1px 6px rgb(77 107 254 / 10%); }
.dsh-pm-card.is-dashed { border-style: dashed; }
.dsh-pm-card-head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.dsh-pm-card-desc { color: var(--dsh-pm-muted); font-size: 12px; }
.dsh-pm-card-path {
  color: var(--dsh-pm-muted); font-size: 11px; font-family: ui-monospace, Consolas, monospace;
  white-space: nowrap; overflow: hidden;
}

/* —— 阅读视图 —— */
.dsh-pm-doc-head { margin-bottom: 10px; }
.dsh-pm-doc-head h1 { font-size: 19px; margin: 2px 0 8px; }
.dsh-pm-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dsh-pm-pill {
  font-size: 11px; color: var(--dsh-pm-brand); background: var(--dsh-pm-brand-soft);
  border-radius: 999px; padding: 1px 9px;
}
.dsh-pm-pill.is-plain { color: var(--dsh-pm-muted); background: var(--dsh-pm-bg); }
.dsh-pm-pill.is-mono { font-family: ui-monospace, Consolas, monospace; }
.dsh-pm-article {
  max-width: 76ch; background: var(--dsh-pm-panel);
  border: 1px solid var(--dsh-pm-line); border-radius: 10px;
  padding: 18px 22px; font-size: 13.5px;
}
.dsh-pm-article h1, .dsh-pm-article h2, .dsh-pm-article h3 { margin: 18px 0 8px; line-height: 1.4; }
.dsh-pm-article h1 { font-size: 18px; } .dsh-pm-article h2 { font-size: 16px; } .dsh-pm-article h3 { font-size: 14px; }
.dsh-pm-article h1:first-child, .dsh-pm-article h2:first-child, .dsh-pm-article h3:first-child { margin-top: 0; }
.dsh-pm-article p { margin: 8px 0; }
.dsh-pm-article ul, .dsh-pm-article ol { margin: 8px 0; padding-left: 22px; }
.dsh-pm-article li { margin: 3px 0; }
.dsh-pm-article code {
  font-family: ui-monospace, Consolas, monospace; font-size: 12px;
  background: var(--dsh-pm-bg); border-radius: 4px; padding: 1px 5px;
}
.dsh-pm-article pre {
  background: #1f2329; color: #e8eaee; border-radius: 8px;
  padding: 10px 14px; overflow-x: auto; margin: 10px 0;
}
.dsh-pm-article pre code { background: none; color: inherit; padding: 0; font-size: 12px; }
.dsh-pm-article blockquote {
  margin: 10px 0; padding: 4px 12px; color: var(--dsh-pm-muted);
  border-left: 3px solid var(--dsh-pm-brand); background: var(--dsh-pm-brand-soft);
  border-radius: 0 6px 6px 0;
}
.dsh-pm-article a { color: var(--dsh-pm-brand); }
.dsh-pm-article hr { border: none; border-top: 1px solid var(--dsh-pm-line); margin: 14px 0; }

/* —— 搜索结果 —— */
.dsh-pm-sr-stat { margin: 2px 2px 12px; color: var(--dsh-pm-muted); font-size: 12px; }
.dsh-pm-sr-row {
  display: block; width: 100%; text-align: left;
  padding: 10px 12px; border-radius: 9px; margin-bottom: 8px;
  border: 1px solid var(--dsh-pm-line); background: var(--dsh-pm-panel);
}
.dsh-pm-sr-row:hover { border-color: var(--dsh-pm-brand); }
.dsh-pm-sr-path { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; min-width: 0; }
.dsh-pm-sr-name { font-weight: 600; font-size: 12.5px; }
.dsh-pm-sr-file {
  color: var(--dsh-pm-muted); font-size: 11px; font-family: ui-monospace, Consolas, monospace;
  white-space: nowrap; overflow: hidden;
}
.dsh-pm-sr-line { color: var(--dsh-pm-muted); font-size: 12px; padding: 1px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-pm-sr-line .dsh-pm-no { color: var(--dsh-pm-muted); opacity: 0.7; margin-right: 6px; font-family: ui-monospace, Consolas, monospace; font-size: 10.5px; }
.dsh-pm-mark { background: var(--dsh-pm-mark); border-radius: 2px; padding: 0 1px; }

/* —— 状态 —— */
.dsh-pm-empty {
  margin: 40px auto; max-width: 380px; text-align: center;
  border: 1px dashed var(--dsh-pm-line); border-radius: 12px; padding: 28px 20px;
  color: var(--dsh-pm-muted);
}
.dsh-pm-empty-title { font-weight: 600; color: var(--dsh-pm-text); margin-bottom: 4px; }
.dsh-pm-loading { margin: 40px auto; text-align: center; color: var(--dsh-pm-muted); }
.dsh-pm-error {
  margin: 40px auto; max-width: 460px; text-align: center;
  border: 1px solid #f4b8b8; background: #fdf3f3; border-radius: 12px; padding: 20px;
  color: #a33a3a; font-size: 12.5px; word-break: break-all;
}

/* —— legacy 覆盖层（官方插槽不可用时的降级容器） —— */
.dsh-pm-overlay {
  position: fixed; inset: 0; z-index: 2147483000;
  background: rgb(15 18 25 / 42%);
  display: flex; align-items: stretch; justify-content: center;
  padding: 4vh 5vw;
}
.dsh-pm-overlay-panel {
  flex: 1; min-width: 0; border-radius: 14px; overflow: hidden;
  box-shadow: 0 18px 60px rgb(0 0 0 / 30%);
}
`;

let styleEl: HTMLStyleElement | undefined;

export function injectStyles(): void {
  if (styleEl?.isConnected) return;
  const el = document.createElement('style');
  el.setAttribute('data-dsh-project-memory', 'styles');
  el.textContent = STYLES;
  document.head.appendChild(el);
  styleEl = el;
}
