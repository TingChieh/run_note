import { getContext } from 'svelte';
import { contextAPI, contextPath, type ViewContext } from '#lib/api/view-context.ts';
export const VIEW_CONTEXT = Symbol('view-context');
export function useViewContext() {
  const current = getContext<() => ViewContext>(VIEW_CONTEXT);
  return {
    bind<F extends (...args: any[]) => any>(fn: F, index: number): F {
      return ((...args: any[]) => { args[index] = this.fetch; return fn(...args); }) as F;
    },
    get manage() { return current?.().manage ?? false; },
    href: (path: string) => current ? contextPath(current(), path) : path,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(typeof input === 'string' && current ? contextAPI(current(), input) : input, init)) as typeof fetch,
  };
}
