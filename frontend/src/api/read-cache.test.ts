import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedReads } from './cached-reads';
import { operationsApi } from './operations.api';
import { portfolioValuationApi } from './portfolio-valuation.api';
import { forgetReads, generationNow, recall, remember } from './read-cache';
import { announceSyncChange, type SyncSource, syncStatusApi } from './sync-status.api';

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

  it('hands a prefetched answer to the page that opens next, once, and to nobody later', async () => {
    const count = vi
      .spyOn(operationsApi, 'needsClassification')
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    await cachedReads.toClassify.prefetch();
    // The page that opens right after takes the answer without another request.
    await expect(cachedReads.toClassify.load()).resolves.toBe(2);
    expect(count).toHaveBeenCalledTimes(1);
    // Only once: the next load asks the server again.
    await expect(cachedReads.toClassify.load()).resolves.toBe(3);
    expect(count).toHaveBeenCalledTimes(2);
  });

  it('asks again when a prefetched answer is old, was dropped by a change or failed', async () => {
    const count = vi.spyOn(operationsApi, 'needsClassification').mockResolvedValue(1);
    await cachedReads.toClassify.prefetch();
    vi.advanceTimersByTime(31_000);
    await cachedReads.toClassify.load();
    expect(count).toHaveBeenCalledTimes(2);

    await cachedReads.toClassify.prefetch();
    announceSyncChange();
    await cachedReads.toClassify.load();
    expect(count).toHaveBeenCalledTimes(4);

    count.mockRejectedValueOnce(new Error('offline'));
    await expect(cachedReads.toClassify.prefetch()).rejects.toThrow('offline');
    await expect(cachedReads.toClassify.load()).resolves.toBe(1);
    expect(count).toHaveBeenCalledTimes(6);
  });

  it('keeps answers painted after a background sync but answers the next page from the server', async () => {
    const source = (lastSuccessAt: string): SyncSource => ({
      key: 'fx:cbr',
      kind: 'fx',
      name: 'Rates',
      state: 'synced',
      lastAttemptAt: lastSuccessAt,
      lastSuccessAt,
      errorMessage: null,
    });
    vi.spyOn(syncStatusApi, 'get')
      .mockResolvedValueOnce([source('2026-10-11T08:00:00.000Z')])
      .mockResolvedValueOnce([source('2026-10-11T09:00:00.000Z')])
      .mockResolvedValueOnce([source('2026-10-11T10:00:00.000Z')]);
    await cachedReads.sources.load();
    const answers: Array<(value: number) => void> = [];
    const count = vi
      .spyOn(operationsApi, 'needsClassification')
      .mockImplementationOnce(async () => 2)
      .mockImplementation(
        () =>
          new Promise<number>((resolve) => {
            answers.push(resolve);
          }),
      );
    await cachedReads.toClassify.prefetch();
    // A sync landed: what was kept still paints the page meanwhile.
    await cachedReads.sources.load();
    expect(cachedReads.toClassify.last()).toBe(2);
    // The prefetched answer is from before the sync, so the page asks the server.
    const first = cachedReads.toClassify.load();
    expect(count).toHaveBeenCalledTimes(2);
    // Another sync while that read is on its way: a page asking after it gets its own answer.
    await cachedReads.sources.load();
    const second = cachedReads.toClassify.load();
    expect(count).toHaveBeenCalledTimes(3);
    answers[1](5);
    answers[0](4);
    await expect(Promise.all([first, second])).resolves.toEqual([4, 5]);
    // Only the answer asked after the last sync is kept.
    expect(cachedReads.toClassify.last()).toBe(5);
  });

  it('lets a page that opens while the prefetch is still on its way share its request', async () => {
    let answer: (value: number) => void = () => {};
    const count = vi.spyOn(operationsApi, 'needsClassification').mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          answer = resolve;
        }),
    );
    const early = cachedReads.toClassify.prefetch();
    const page = cachedReads.toClassify.load();
    answer(9);
    await expect(Promise.all([early, page])).resolves.toEqual([9, 9]);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it('leaves nothing for a later load when the page joined the prefetch on its way', async () => {
    let answer: (value: number) => void = () => {};
    const count = vi
      .spyOn(operationsApi, 'needsClassification')
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            answer = resolve;
          }),
      )
      .mockResolvedValueOnce(5);
    const early = cachedReads.toClassify.prefetch();
    const page = cachedReads.toClassify.load();
    answer(4);
    await expect(Promise.all([early, page])).resolves.toEqual([4, 4]);
    // The page has had its answer; opening it again asks the server.
    await expect(cachedReads.toClassify.load()).resolves.toBe(5);
    expect(count).toHaveBeenCalledTimes(2);
  });

  it('hands the page a prefetch asked after a change even if an older read was still on its way', async () => {
    const answers: Array<(value: number) => void> = [];
    const count = vi.spyOn(operationsApi, 'needsClassification').mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          answers.push(resolve);
        }),
    );
    const older = cachedReads.toClassify.load();
    announceSyncChange();
    const prefetch = cachedReads.toClassify.prefetch();
    answers[1](8);
    await prefetch;
    // The page takes the prefetch asked after the change; no third request is sent.
    await expect(cachedReads.toClassify.load()).resolves.toBe(8);
    expect(count).toHaveBeenCalledTimes(2);
    answers[0](1);
    await older;
  });

  it('does not ask again for an answer already waiting for a page, from another prefetch', async () => {
    const count = vi.spyOn(operationsApi, 'needsClassification').mockResolvedValue(6);
    await cachedReads.toClassify.prefetch();
    await expect(cachedReads.toClassify.prefetch()).resolves.toBe(6);
    expect(count).toHaveBeenCalledTimes(1);
    await expect(cachedReads.toClassify.load()).resolves.toBe(6);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it('keeps the newer prefetch claimable when an older one from before a change settles late', async () => {
    const answers: Array<(value: number) => void> = [];
    const count = vi.spyOn(operationsApi, 'needsClassification').mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          answers.push(resolve);
        }),
    );
    const older = cachedReads.toClassify.prefetch();
    announceSyncChange();
    const newer = cachedReads.toClassify.prefetch();
    answers[0](1);
    await older;
    answers[1](2);
    await newer;
    await expect(cachedReads.toClassify.load()).resolves.toBe(2);
    expect(count).toHaveBeenCalledTimes(2);
  });
});
