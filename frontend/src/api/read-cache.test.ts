import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedReads } from './cached-reads';
import { operationsApi } from './operations.api';
import { portfolioValuationApi } from './portfolio-valuation.api';
import { forgetReads, generationNow, recall, remember } from './read-cache';
import { announceSyncChange } from './sync-status.api';

describe('read cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    forgetReads();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('gives back the last answer for a key and nothing for another', () => {
    remember('a', { total: 1 }, generationNow());
    expect(recall('a')).toEqual({ total: 1 });
    expect(recall('b')).toBeUndefined();
  });

  it('drops an answer older than fifteen minutes', () => {
    remember('a', 1, generationNow());
    vi.advanceTimersByTime(14 * 60_000);
    expect(recall('a')).toBe(1);
    vi.advanceTimersByTime(2 * 60_000);
    expect(recall('a')).toBeUndefined();
  });

  it('forgets everything on a change and ignores an answer that was on its way', () => {
    remember('a', 1, generationNow());
    const startedBefore = generationNow();
    forgetReads();
    expect(recall('a')).toBeUndefined();
    remember('late', 2, startedBefore);
    expect(recall('late')).toBeUndefined();
  });

  it('keeps one answer per argument list of a read and returns what the server said', async () => {
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockImplementation(async (currency) => ({ currency }) as never);
    await expect(cachedReads.portfolio.load('EUR')).resolves.toMatchObject({ currency: 'EUR' });
    expect(cachedReads.portfolio.last('EUR')).toMatchObject({ currency: 'EUR' });
    expect(cachedReads.portfolio.last('USD')).toBeUndefined();
    expect(cachedReads.portfolio.last()).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing from a read that failed', async () => {
    vi.spyOn(operationsApi, 'list').mockRejectedValue(new Error('offline'));
    await expect(cachedReads.operations.load()).rejects.toThrow('offline');
    expect(cachedReads.operations.last()).toBeUndefined();
  });

  it('is emptied when a sync or a classification announces a change', async () => {
    vi.spyOn(operationsApi, 'needsClassification').mockResolvedValue(3);
    await cachedReads.toClassify.load();
    expect(cachedReads.toClassify.last()).toBe(3);
    announceSyncChange();
    expect(cachedReads.toClassify.last()).toBeUndefined();
  });
});
