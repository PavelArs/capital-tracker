import { cachedReads } from '@api/cached-reads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefetchSection, resetPrefetch, warmPages } from './prefetch';
import { sectionPage } from './route-pages';

vi.mock('@api/cached-reads', () => ({
  cachedReads: {
    history: { prefetch: vi.fn() },
    portfolio: { prefetch: vi.fn() },
    operations: { prefetch: vi.fn() },
    transferProposals: { prefetch: vi.fn() },
    duplicateProposals: { prefetch: vi.fn() },
  },
}));

const pageFiles = vi.hoisted(() => ({
  portfolio: vi.fn(() => Promise.resolve({})),
  broken: vi.fn(() => Promise.reject(new Error('offline'))),
  detail: vi.fn(() => Promise.resolve({})),
}));

vi.mock('./route-pages', () => ({
  sectionPage: {
    '/portfolio': pageFiles.portfolio,
    '/settings-broken': pageFiles.broken,
  },
  warmedPages: [pageFiles.portfolio, pageFiles.broken, pageFiles.detail],
}));

const loads = [
  cachedReads.history.prefetch,
  cachedReads.portfolio.prefetch,
  cachedReads.operations.prefetch,
  cachedReads.transferProposals.prefetch,
  cachedReads.duplicateProposals.prefetch,
];

describe('prefetchSection', () => {
  beforeEach(() => {
    resetPrefetch();
    for (const load of loads)
      vi.mocked(load)
        .mockReset()
        .mockResolvedValue(undefined as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('asks what the dashboard asks first, in the currency shown', () => {
    prefetchSection('/dashboard', 'EUR');
    expect(cachedReads.history.prefetch).toHaveBeenCalledWith('1M', 'EUR');
    expect(cachedReads.portfolio.prefetch).toHaveBeenCalledWith('EUR');
    expect(cachedReads.operations.prefetch).not.toHaveBeenCalled();
  });

  it('asks the portfolio valuation for the portfolio page', () => {
    prefetchSection('/portfolio', undefined);
    expect(cachedReads.portfolio.prefetch).toHaveBeenCalledWith(undefined);
    expect(cachedReads.history.prefetch).not.toHaveBeenCalled();
  });

  it('asks the operations and both proposal lists for the transactions page', () => {
    prefetchSection('/transactions', 'USD');
    expect(cachedReads.operations.prefetch).toHaveBeenCalledWith('USD');
    expect(cachedReads.transferProposals.prefetch).toHaveBeenCalledTimes(1);
    expect(cachedReads.duplicateProposals.prefetch).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a section it has no reads for', () => {
    prefetchSection('/settings', 'USD');
    for (const load of loads) expect(load).not.toHaveBeenCalled();
  });

  it('does not ask again within 30 seconds, but does after, and per currency', () => {
    prefetchSection('/portfolio', 'USD', 1_000);
    prefetchSection('/portfolio', 'USD', 20_000);
    expect(cachedReads.portfolio.prefetch).toHaveBeenCalledTimes(1);
    prefetchSection('/portfolio', 'EUR', 20_000);
    expect(cachedReads.portfolio.prefetch).toHaveBeenCalledTimes(2);
    prefetchSection('/portfolio', 'USD', 31_001);
    expect(cachedReads.portfolio.prefetch).toHaveBeenCalledTimes(3);
  });

  it('leaves a failed read for the page to report', () => {
    const failed = Promise.reject(new Error('offline'));
    const handled = vi.spyOn(failed, 'catch');
    vi.mocked(cachedReads.portfolio.prefetch).mockReturnValue(failed as never);
    expect(() => prefetchSection('/portfolio', 'USD')).not.toThrow();
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it('fetches the screen file of a section, and a failed fetch is left alone', async () => {
    prefetchSection('/portfolio', 'USD', 1_000);
    // The file is asked for every time; only the data reads are held back for 30 seconds.
    prefetchSection('/portfolio', 'USD', 2_000);
    expect(sectionPage['/portfolio']).toHaveBeenCalledTimes(2);
    expect(() => prefetchSection('/settings-broken', 'USD')).not.toThrow();
    await Promise.resolve();
  });
});

describe('warmPages', () => {
  afterEach(() => vi.useRealTimers());

  it('fetches the screen files one after another once things have settled, and can be stopped', async () => {
    vi.useFakeTimers();
    const loaders = Object.values(pageFiles);
    for (const load of loaders) load.mockClear();
    const stop = warmPages();
    expect(pageFiles.portfolio).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500);
    // Browsers without idle callbacks (and jsdom) space them out by a quarter of a second.
    await vi.advanceTimersByTimeAsync(250);
    expect(pageFiles.portfolio).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pageFiles.broken).not.toHaveBeenCalled();
  });

  it('asks for the next file only after the one before has arrived, and reaches the detail screens', async () => {
    vi.useFakeTimers();
    for (const load of Object.values(pageFiles)) load.mockClear();
    let arrive: (value: object) => void = () => {};
    pageFiles.portfolio.mockImplementationOnce(
      () =>
        new Promise<object>((resolve) => {
          arrive = resolve;
        }),
    );
    const stop = warmPages();
    await vi.advanceTimersByTimeAsync(1_500 + 250);
    expect(pageFiles.portfolio).toHaveBeenCalledTimes(1);
    // A slow file holds the queue however long the wait.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pageFiles.broken).not.toHaveBeenCalled();
    arrive({});
    // A failed file does not stop the ones after it.
    await vi.advanceTimersByTimeAsync(250);
    expect(pageFiles.broken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(pageFiles.detail).toHaveBeenCalledTimes(1);
    stop();
  });
});
