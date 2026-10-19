/**
 * 面板挂载：优先 DSH 官方插槽（slots.spec 探测），不可用时降级为
 * 侧栏 DOM 注入 + 全屏覆盖层，并做 3 轮有界探测等待官方插槽就绪后升级。
 * 模式对齐 dsh-taskboard official-panel.tsx（只读参考实现）。
 */
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { KnowledgeApp } from './app.tsx';
import { translate } from './i18n.ts';
import { mountSidebarEntry } from './sidebar-entry.ts';

export const PANEL_ID = 'dsh-project-memory';
/** 侧栏行序：面板入口压轴置底（任务书决策④；taskboard 用 10）。 */
export const PANEL_ROW_ORDER = 999;
const PROBE_ROUNDS = 3;
const PROBE_INTERVAL_MS = 350;

interface SlotsServiceFace {
  inject(key: string, cb: () => void): unknown;
  register(options: Record<string, unknown>, component: (props: never) => ReactNode): unknown;
  spec(key: string): unknown;
}

interface MountContextFace {
  get?(name: string): unknown;
}

function isSlots(value: unknown): value is SlotsServiceFace {
  if (typeof value !== 'object' || value === null) return false;
  const slots = value as Partial<SlotsServiceFace>;
  return typeof slots.register === 'function' && typeof slots.inject === 'function' && typeof slots.spec === 'function';
}

/** 探测官方插槽服务：未就绪/形状不符一律 undefined（降级路径）。 */
function officialSlots(ctx: MountContextFace): SlotsServiceFace | undefined {
  try {
    const candidate = (ctx.get?.('slots') ?? (ctx as { slots?: unknown }).slots) as unknown;
    if (!isSlots(candidate)) return undefined;
    if (candidate.spec('main') === undefined || candidate.spec('sidebar.panellist') === undefined) return undefined;
    return candidate;
  } catch {
    return undefined;
  }
}

function PanelPage(): ReactNode {
  return <KnowledgeApp />;
}

function PanelIcon({ size }: { size?: number }): ReactNode {
  return (
    <svg width={size ?? 15} height={size ?? 15} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 2.5h2.6v11H2zM6 2.5h2.6v11H6z" stroke="currentColor" strokeLinejoin="round" />
      <path d="m10.2 3.3 2.5-.7 2 10.7-2.5.7z" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  );
}

/** 向官方插槽注册主面板与侧栏行；部分失败时整体拆除并返回 undefined。 */
function tryRegister(slots: SlotsServiceFace): (() => void) | undefined {
  const disposers: Array<() => void> = [];
  try {
    slots.inject('main', () => {
      const disposer = slots.register({ name: 'main', key: PANEL_ID }, PanelPage);
      if (typeof disposer === 'function') disposers.push(disposer as () => void);
    });
    slots.inject('sidebar.panellist', () => {
      const disposer = slots.register(
        {
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: PANEL_ROW_ORDER,
          label: () => translate('client.panel.entry'),
        },
        (props: { size?: number }) => <PanelIcon size={props?.size} />,
      );
      if (typeof disposer === 'function') disposers.push(disposer as () => void);
    });
    return () => {
      for (const disposer of disposers.splice(0).reverse()) {
        try {
          disposer();
        } catch { /* 拆除竞态无害 */ }
      }
    };
  } catch {
    for (const disposer of disposers.splice(0)) {
      try {
        disposer();
      } catch { /* 已注册部分的兜底拆除 */ }
    }
    return undefined;
  }
}

// ———— legacy 降级：全屏覆盖层容器 ————

interface OverlayHandle {
  open: () => void;
  dispose: () => void;
}

function mountOverlayApp(): OverlayHandle {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  const close = (): void => {
    try {
      root?.unmount();
    } catch { /* 已卸载 */ }
    root = undefined;
    container?.remove();
    container = undefined;
  };

  return {
    open() {
      if (container) return;
      container = document.createElement('div');
      container.className = 'dsh-pm-overlay';
      container.setAttribute('data-dsh-project-memory-overlay', '');
      const panel = document.createElement('div');
      panel.className = 'dsh-pm-overlay-panel';
      container.appendChild(panel);
      container.addEventListener('mousedown', (event) => {
        if (event.target === container) close();
      });
      document.body.appendChild(container);
      root = createRoot(panel);
      root.render(<KnowledgeApp onClose={close} />);
    },
    dispose() {
      close();
    },
  };
}

/**
 * 挂载面板（官方插槽优先，legacy 覆盖层兜底）。
 * @returns 汇总 disposer（清理 legacy 与探测定时器）。
 */
export function mountCompat(ctx: MountContextFace): () => void {
  // 官方插槽立即可用：直接注册，无需 legacy
  const immediate = officialSlots(ctx);
  if (immediate) {
    const registered = tryRegister(immediate);
    if (registered) return registered;
  }

  // 降级：先挂 legacy（入口 + 覆盖层），同时做有界探测等待官方插槽
  const overlay = mountOverlayApp();
  let removeEntry: (() => void) | undefined;
  try {
    removeEntry = mountSidebarEntry(() => overlay.open(), () => translate('client.panel.entry'));
  } catch (error) {
    console.error('[dsh-project-memory] sidebar entry failed:', error);
  }

  let probeTimer: ReturnType<typeof setInterval> | undefined;
  let upgraded = false;
  let rounds = 0;
  probeTimer = setInterval(() => {
    rounds += 1;
    const slots = officialSlots(ctx);
    if (slots) {
      const registered = tryRegister(slots);
      if (registered) {
        upgraded = true;
        removeEntry?.();
        removeEntry = undefined;
        overlay.dispose();
      }
    }
    if (upgraded || rounds >= PROBE_ROUNDS) {
      if (probeTimer) clearInterval(probeTimer);
      probeTimer = undefined;
    }
  }, PROBE_INTERVAL_MS);

  return () => {
    if (probeTimer) clearInterval(probeTimer);
    probeTimer = undefined;
    removeEntry?.();
    overlay.dispose();
  };
}
