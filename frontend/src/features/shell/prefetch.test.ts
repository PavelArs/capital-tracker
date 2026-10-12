import { cachedReads } from '@api/cached-reads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefetchSection, resetPrefetch } from './prefetch';

vi.mock('@api/cached-reads', () => ({
  cachedReads: {
    history: { load: vi.fn() },
    portfolio: { load: vi.fn() },
    operations: { load: vi.fn() },
    transferProposals: { load: vi.fn() },
    duplicateProposals: { load: vi.fn() },
  },
}));

const loads = [
  cachedReads.history.load,
  cachedReads.portfolio.load,
  cachedReads.operations.load,
  cachedReads.transferProposals.load,
  cachedReads.duplicateProposals.load,
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
    expect(cachedReads.history.load).toHaveBeenCalledWith('1M', 'EUR');
    expect(cachedReads.portfolio.load).toHaveBeenCalledWith('EUR');
    expect(cachedReads.operations.load).not.toHaveBeenCalled();
  });

  it('asks the portfolio valuation for the portfolio page', () => {
    prefetchSection('/portfolio', undefined);
    expect(cachedReads.portfolio.load).toHaveBeenCalledWith(undefined);
    expect(cachedReads.history.load).not.toHaveBeenCalled();
  });

  it('asks the operations and both proposal lists for the transactions page', () => {
    prefetchSection('/transactions', 'USD');
    expect(cachedReads.operations.load).toHaveBeenCalledWith('USD');
    expect(cachedReads.transferProposals.load).toHaveBeenCalledTimes(1);
    expect(cachedReads.duplicateProposals.load).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a section it has no reads for', () => {
    prefetchSection('/settings', 'USD');
    for (const load of loads) expect(load).not.toHaveBeenCalled();
  });

  it('does not ask again within 30 seconds, but does after, and per currency', () => {
    prefetchSection('/portfolio', 'USD', 1_000);
    prefetchSection('/portfolio', 'USD', 20_000);
    expect(cachedReads.portfolio.load).toHaveBeenCalledTimes(1);
    prefetchSection('/portfolio', 'EUR', 20_000);
    expect(cachedReads.portfolio.load).toHaveBeenCalledTimes(2);
    prefetchSection('/portfolio', 'USD', 31_001);
    expect(cachedReads.portfolio.load).toHaveBeenCalledTimes(3);
  });

  it('leaves a failed read for the page to report', () => {
    const failed = Promise.reject(new Error('offline'));
    const handled = vi.spyOn(failed, 'catch');
    vi.mocked(cachedReads.portfolio.load).mockReturnValue(failed as never);
    expect(() => prefetchSection('/portfolio', 'USD')).not.toThrow();
    expect(handled).toHaveBeenCalledTimes(1);
  });
});
