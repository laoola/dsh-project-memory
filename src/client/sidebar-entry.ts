/**
 * legacy 侧栏入口：官方插槽不可用时把「知识库」按钮注入侧栏（纯 DOM，非 React，
 * 防被宿主 reconciliation 抹掉——对齐 dsh-taskboard sidebar-entry.ts 的成熟做法）。
 * 自愈三件套：body 级 MutationObserver 等待 shell、rootObserver 盯宿主重排、
 * 2s 定时兜底重试；disposer 全量清理。
 */
/** 与 taskboard/ssh 等 family 入口对齐：插在它们之前，保持家族顺序。 */
const FAMILY_SELECTOR = '[data-dsh-pm-entry], [data-dsh-atb-entry], [data-dsh-taskboard-entry], [data-dsh-ssh-entry]';
const ROOT_SELECTORS = '[data-pane="sidebar"], [class*="sidebarCol"], .dshDesktopUpstreamSidebar, .dshDesktopSidebarSurface';
const POLL_INTERVAL_MS = 2000;

function iconMarkup(): string {
  return (
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">'
    + '<path d="M2 2.5h2.6v11H2zM6 2.5h2.6v11H6z" stroke="currentColor" stroke-linejoin="round"/>'
    + '<path d="m10.2 3.3 2.5-.7 2 10.7-2.5.7z" stroke="currentColor" stroke-linejoin="round"/>'
    + '</svg>'
  );
}

/** 侧栏根：四代选择器探测 → logoRow 的父容器 → 列首。 */
function sidebarRoot(): HTMLElement | undefined {
  const sidebar = document.querySelector<HTMLElement>(ROOT_SELECTORS);
  if (!sidebar) return undefined;
  const logoRow = sidebar.querySelector<HTMLElement>('[class*="logoRow"]');
  if (logoRow?.parentElement) return logoRow.parentElement;
  return (sidebar.firstElementChild as HTMLElement | null) ?? sidebar;
}

/** 锚点按钮：新建会话按钮（三代匹配），入口插在它附近。 */
function newSessionButton(root: HTMLElement): HTMLElement | undefined {
  const byClass = root.querySelector<HTMLElement>('button[class*="newSession"]');
  if (byClass) return byClass;
  for (const child of Array.from(root.children)) {
    if (child !== root && child.tagName === 'BUTTON') return child as HTMLElement;
  }
  const labeled = Array.from(root.querySelectorAll<HTMLElement>('button[aria-label]')).find((button) =>
    /新建会话|新会话|New Session|new session/i.test(button.getAttribute('aria-label') ?? ''));
  if (labeled) return labeled;
  return Array.from(root.querySelectorAll<HTMLElement>('button')).find((button) =>
    /新建会话|新会话|new session/i.test(button.textContent ?? ''));
}

function placeEntry(root: HTMLElement, entry: HTMLElement): boolean {
  const anchorRoot = newSessionButton(root) ?? root;
  const base = anchorRoot.parentElement ?? root;
  const family = base.querySelectorAll<HTMLElement>(FAMILY_SELECTOR);
  const anchor = family.length ? family[0] : anchorRoot.nextElementSibling;
  if (anchor && anchor !== entry) base.insertBefore(entry, anchor);
  else if (anchorRoot.parentElement === root) root.insertBefore(entry, anchorRoot);
  else root.appendChild(entry);
  return root.contains(entry);
}

function buildEntry(label: () => string, onOpen: () => void): HTMLButtonElement {
  const entry = document.createElement('button');
  entry.type = 'button';
  entry.className = 'dsh-pm-entry';
  entry.dataset.dshPmEntry = '';
  entry.title = label();
  entry.setAttribute('aria-label', label());
  entry.style.cssText = 'display:flex;align-items:center;gap:7px;width:100%;padding:7px 10px;border:0;background:none;'
    + 'color:inherit;cursor:pointer;font:inherit;font-size:12.5px;border-radius:8px;text-align:left;';
  entry.innerHTML = `${iconMarkup()}<span class="dsh-pm-entry-label"></span>`;
  entry.querySelector('.dsh-pm-entry-label')!.textContent = label();
  entry.addEventListener('mouseenter', () => { entry.style.background = 'rgba(128,128,128,0.12)'; });
  entry.addEventListener('mouseleave', () => { entry.style.background = 'none'; });
  entry.addEventListener('click', () => onOpen());
  return entry;
}

/**
 * 挂载侧栏入口；返回 disposer（清理 observer/定时器/节点）。
 * @param onOpen 入口点击回调（打开面板）
 * @param label  文案工厂（语言切换后重取）
 */
export function mountSidebarEntry(onOpen: () => void, label: () => string): () => void {
  const observers: Array<{ disconnect(): void }> = [];
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let entry: HTMLButtonElement | undefined;
  let disposed = false;

  const ensurePlaced = (): boolean => {
    if (disposed) return false;
    const root = sidebarRoot();
    if (!root) return false;
    if (entry && entry.isConnected && root.contains(entry)) return true;
    if (!entry || !entry.isConnected) {
      entry?.remove();
      entry = buildEntry(label, onOpen);
    }
    return placeEntry(root, entry);
  };

  // body 级等待：shell 异步渲染
  const bodyObserver = new MutationObserver(() => {
    if (ensurePlaced()) bodyObserver.disconnect();
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
  observers.push(bodyObserver);

  // 根级自愈：已放置后被宿主重排抹掉时重插
  let rootObserver: MutationObserver | undefined;
  const watchRoot = () => {
    const root = sidebarRoot();
    if (!root || rootObserver) return;
    rootObserver = new MutationObserver(() => {
      if (!disposed && entry && !entry.isConnected) ensurePlaced();
    });
    rootObserver.observe(root, { childList: true });
    observers.push(rootObserver);
  };

  // 2s 兜底：探测失败/迟到的极端情况
  pollTimer = setInterval(() => {
    if (ensurePlaced()) watchRoot();
  }, POLL_INTERVAL_MS);

  ensurePlaced();
  watchRoot();

  return () => {
    disposed = true;
    if (pollTimer) clearInterval(pollTimer);
    for (const observer of observers.splice(0)) observer.disconnect();
    entry?.remove();
    entry = undefined;
  };
}
