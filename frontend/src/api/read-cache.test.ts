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

  it('sends one request for identical loads asked while one is on its way', async () => {
    let answer: (value: number) => void = () => {};
    const count = vi.spyOn(operationsApi, 'needsClassification').mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          answer = resolve;
        }),
    );
    const first = cachedReads.toClassify.load();
    const second = cachedReads.toClassify.load();
    answer(4);
    await expect(Promise.all([first, second])).resolves.toEqual([4, 4]);
    expect(count).toHaveBeenCalledTimes(1);
    // Once answered, the next load asks the server again: the page always loads.
    count.mockResolvedValue(5);
    await expect(cachedReads.toClassify.load()).resolves.toBe(5);
    expect(count).toHaveBeenCalledTimes(2);
  });

  it('treats a missing trailing argument like undefined and keeps other arguments apart', async () => {
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockImplementation(async (currency) => ({ currency }) as never);
    await Promise.all([
      cachedReads.portfolio.load(),
      cachedReads.portfolio.load(undefined),
      cachedReads.portfolio.load('EUR'),
    ]);
    expect(get).toHaveBeenCalledTimes(2);
    expect(cachedReads.portfolio.last(undefined)).toBe(cachedReads.portfolio.last());
    expect(cachedReads.portfolio.last()).toMatchObject({});
  });

  it('does not share an answer asked for before a change with a load asked after it', async () => {
    const answers: Array<(value: number) => void> = [];
    const count = vi.spyOn(operationsApi, 'needsClassification').mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          answers.push(resolve);
        }),
    );
    const before = cachedReads.toClassify.load();
    announceSyncChange();
    const after = cachedReads.toClassify.load();
    expect(count).toHaveBeenCalledTimes(2);
    answers[1](7);
    answers[0](3);
    await expect(Promise.all([before, after])).resolves.toEqual([3, 7]);
    // Only the answer given after the change is kept.
    expect(cachedReads.toClassify.last()).toBe(7);
  });

  it('shares a failure with everyone waiting and then asks again', async () => {
    const count = vi
      .spyOn(operationsApi, 'needsClassification')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(2);
    const both = await Promise.allSettled([
      cachedReads.toClassify.load(),
      cachedReads.toClassify.load(),
    ]);
    expect(both.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(count).toHaveBeenCalledTimes(1);
    await expect(cachedReads.toClassify.load()).resolves.toBe(2);
  });
});
