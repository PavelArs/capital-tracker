import { type ComponentType, createElement, lazy } from 'react';

// What each screen that failed to arrive needs to start afresh, run by forgetFailedPages.
const failedPages = new Set<() => void>();

/** Lets the screens that failed to arrive ask for their file again when they are next shown. */
export function forgetFailedPages(): void {
  for (const renew of failedPages) renew();
  failedPages.clear();
}

/**
 * A screen that comes as a file of its own. `preload` fetches it ahead (the menu does, see
 * prefetch.ts); the screen itself waits for it while it is rendered, and renders it directly
 * once it is here (React.lazy would suspend once more for a file already fetched). A file that
 * failed to arrive is not remembered as failed: the next render, or the next preload, asks for
 * it again (React.lazy keeps a failure for good).
 */
export function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  let loaded: ComponentType | undefined;
  let attempt: Promise<{ default: ComponentType }> | undefined;
  const preload = () => {
    attempt ??= load().then(
      (module) => {
        loaded = module.default;
        return module;
      },
      (error: unknown) => {
        attempt = undefined;
        // The screen that waited on this attempt shows the failure (it is not asked again at once,
        // which would loop on a file that is gone); it starts afresh when forgetFailedPages runs.
        failedPages.add(() => {
          waiting = lazy(preload);
        });
        throw error;
      },
    );
    return attempt;
  };
  let waiting = lazy(preload);
  // biome-ignore lint/correctness/noComponentHookFactories: lazyPage runs once per route at module load, so each Page keeps one identity.
  function Page() {
    return createElement(loaded ?? waiting);
  }
  Page.preload = preload;
  return Page;
}
