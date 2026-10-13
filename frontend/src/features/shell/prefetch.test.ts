import { cachedReads } from '@api/cached-reads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefetchSection, resetPrefetch } from './prefetch';

vi.mock('@api/cached-reads', () => ({
  cachedReads: {
    history: { prefetch: vi.fn() },
    portfolio: { prefetch: vi.fn() },
    operations: { prefetch: vi.fn() },
    transferProposals: { prefetch: vi.fn() },
    duplicateProposals: { prefetch: vi.fn() },
    deposits: { prefetch: vi.fn() },
  },
}));

const loads = [
  cachedReads.history.prefetch,
  cachedReads.portfolio.prefetch,
  cachedReads.operations.prefetch,
  cachedReads.transferProposals.prefetch,
  cachedReads.duplicateProposals.prefetch,
  cachedReads.deposits.prefetch,
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

  it('asks the deposit list for the deposits page', () => {
    prefetchSection('/deposits', 'USD');
    expect(cachedReads.deposits.prefetch).toHaveBeenCalledTimes(1);
    expect(cachedReads.operations.prefetch).not.toHaveBeenCalled();
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
});
