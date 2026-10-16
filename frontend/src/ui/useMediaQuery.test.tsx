import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCompactScreen, useNarrowScreen } from './useMediaQuery';

/** A window `width` px wide that answers max-width queries the way a browser does. */
const windowOf = (width: number) =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: width <= Number(/max-width:\s*([\d.]+)px/.exec(query)?.[1] ?? Number.NaN),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shell-16 breakpoints', () => {
  it('shell-16 a 560 px window is not yet compact, a 559 px one is', () => {
    windowOf(560);
    expect(renderHook(() => useCompactScreen()).result.current).toBe(false);
    windowOf(559);
    expect(renderHook(() => useCompactScreen()).result.current).toBe(true);
  });

  it('shell-16 a 640 px window is not yet narrow, a 639 px one is', () => {
    windowOf(640);
    expect(renderHook(() => useNarrowScreen()).result.current).toBe(false);
    windowOf(639);
    expect(renderHook(() => useNarrowScreen()).result.current).toBe(true);
  });
});
