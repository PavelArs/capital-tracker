import { type ComponentType, createElement, lazy } from 'react';

/**
 * A screen kept in a file of its own. `preload` fetches the file ahead of the click. Once the file
 * is here the screen is drawn at once: React's own lazy wrapper would still wait one round
 * before showing a file that has already arrived.
 */
export function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  let loaded: ComponentType | undefined;
  const preload = () =>
    load().then((module) => {
      loaded = module.default;
      return module;
    });
  const Waiting = lazy(preload);
  function Page() {
    return createElement(loaded ?? Waiting);
  }
  Page.preload = preload;
  return Page;
}
