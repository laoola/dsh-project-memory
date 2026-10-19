/**
 * dsh-project-memory client 半（Web 面板，只读）。
 * 导出形状对齐宿主模块表契约：name / inject / apply（CJS exports，由 tsdown
 * 包装为 window.__ModuleLoader__.load({id,factory})）。
 * apply 全程 try/catch——client 侧任何异常都只打日志，绝不炸 GUI boot。
 */
import { initI18n } from './i18n.ts';
import { mountCompat } from './official-panel.tsx';
import { injectStyles } from './styles.ts';

export const name = 'dsh-project-memory/client';
/** 等待宿主连接服务就绪后再挂面板（fetch 才可用）。 */
export const inject = ['connection'];

interface ClientContextFace {
  get?(name: string): unknown;
  effect?(fn: () => (() => void) | void, label?: string): unknown;
}

export function apply(ctx: ClientContextFace): void {
  try {
    injectStyles();
    const disposeI18n = initI18n(ctx.get?.('locale'));
    const disposers: Array<() => void> = [];
    try {
      disposers.push(mountCompat(ctx));
    } catch (error) {
      console.error('[dsh-project-memory] mount failed:', error);
    }
    ctx.effect?.(() => () => {
      for (const disposer of disposers.splice(0)) disposer();
      disposeI18n();
    }, 'dsh-project-memory: client mount');
  } catch (error) {
    console.error('[dsh-project-memory] client half failed to start:', error);
  }
}
