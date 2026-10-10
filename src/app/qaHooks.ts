import type { AppContext } from './context';

/** Hash-driven QA hooks (#photo=1, #export=zip, …) registered by feature
 * modules and run once after boot — keeps main.ts free of per-feature code. */
type Hook = (ctx: AppContext, params: URLSearchParams) => void;

const hooks: Hook[] = [];

export function registerQaHook(fn: Hook): void {
  hooks.push(fn);
}

export function runQaHooks(ctx: AppContext, params: URLSearchParams): void {
  for (const h of hooks) {
    try {
      h(ctx, params);
    } catch (e) {
      console.error('QA hook failed', e);
    }
  }
}

/** Results for headless checks (read by scripts/qa/shots.mjs). */
export function qaReport(key: string, value: unknown): void {
  const w = window as unknown as { __wpQA?: Record<string, unknown> };
  w.__wpQA = { ...(w.__wpQA ?? {}), [key]: value };
}
