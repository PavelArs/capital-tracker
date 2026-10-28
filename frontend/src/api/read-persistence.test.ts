import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedReads } from './cached-reads';
import { operationsApi } from './operations.api';
import { portfolioValuationApi } from './portfolio-valuation.api';
import {
  adoptReads,
  forgetReads,
  generationNow,
  hydrateReads,
  recall,
  releaseReads,
  remember,
  setReadStore,
} from './read-cache';
import { indexedDbStore, type ReadStore, type StoredRead } from './read-store';
import { syncStatusApi } from './sync-status.api';

/** A store in memory: what the browser's IndexedDB would hold, readable by the tests. */
function memoryStore(initial: StoredRead[] = []) {
  const rows = new Map(initial.map((row) => [row.key, row]));
  const store: ReadStore = {
    load: async () => [...rows.values()],
    save: async (row) => {
      rows.set(row.key, row);
    },
    clear: async () => {
      rows.clear();
    },
  };
  return { rows, store };
}

const settle = () => vi.advanceTimersByTimeAsync(0);
const OWNER = 'owner-1';

describe('the read store in IndexedDB', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps a row per key across a reopened database and clears them all', async () => {
    const first = indexedDbStore();
    expect(first).not.toBeNull();
    await first?.save({ key: 'a', owner: OWNER, at: 1, value: { nested: ['x', 1] } });
    await first?.save({ key: 'b', owner: OWNER, at: 2, value: 'two' });
    await first?.save({ key: 'a', owner: OWNER, at: 3, value: { nested: [] } });
    // A reload opens the same database again.
    const reopened = indexedDbStore();
    const rows = await reopened?.load();
    expect(rows?.sort((left, right) => left.key.localeCompare(right.key))).toEqual([
      { key: 'a', owner: OWNER, at: 3, value: { nested: [] } },
      { key: 'b', owner: OWNER, at: 2, value: 'two' },
    ]);
    await reopened?.clear();
    expect(await reopened?.load()).toEqual([]);
  });

  it('is absent where the browser has no IndexedDB', () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(indexedDbStore()).toBeNull();
  });
});

describe('answers that survive a reload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T09:00:00.000Z'));
    setReadStore(null);
    releaseReads();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setReadStore(null);
    releaseReads();
  });

  it('keeps answers for the signed-in owner only', async () => {
    const { rows, store } = memoryStore();
    setReadStore(store);
    remember('before-sign-in', 1, generationNow());
    await settle();
    expect(rows.size).toBe(0);
    adoptReads(OWNER);
    remember('portfolio:[]', { total: 5 }, generationNow());
    await settle();
    expect(rows.get('portfolio:[]')).toEqual({
      key: 'portfolio:[]',
      owner: OWNER,
      at: Date.now(),
      value: { total: 5 },
    });
  });

  it('brings the owner’s recent answers back into memory after a reload', async () => {
    const at = Date.now() - 60_000;
    const { store } = memoryStore([{ key: 'k', owner: OWNER, at, value: [1, 2, 3] }]);
    setReadStore(store);
    expect(recall('k')).toBeUndefined();
    await hydrateReads(OWNER);
    expect(recall('k')).toEqual([1, 2, 3]);
  });

  it('leaves out answers too old to paint', async () => {
    const { store } = memoryStore([
      { key: 'old', owner: OWNER, at: Date.now() - 16 * 60_000, value: 'old' },
      { key: 'recent', owner: OWNER, at: Date.now() - 14 * 60_000, value: 'recent' },
    ]);
    setReadStore(store);
    await hydrateReads(OWNER);
    expect(recall('old')).toBeUndefined();
    expect(recall('recent')).toBe('recent');
  });

  it('never hands one owner’s answers to another and empties the store of them', async () => {
    const { rows, store } = memoryStore([
      { key: 'k', owner: 'someone-else', at: Date.now(), value: 'private' },
    ]);
    setReadStore(store);
    await hydrateReads(OWNER);
    await settle();
    expect(recall('k')).toBeUndefined();
    expect(rows.size).toBe(0);
  });

  it('empties the store when the owner changes something, and keeps writing afterwards', async () => {
    const { rows, store } = memoryStore();
    setReadStore(store);
    adoptReads(OWNER);
    remember('a', 1, generationNow());
    await settle();
    expect(rows.size).toBe(1);
    forgetReads();
    await settle();
    expect(rows.size).toBe(0);
    remember('b', 2, generationNow());
    await settle();
    expect([...rows.keys()]).toEqual(['b']);
  });

  it('does not store an answer that was on its way when the cache was dropped', async () => {
    const { rows, store } = memoryStore();
    setReadStore(store);
    adoptReads(OWNER);
    const startedBefore = generationNow();
    forgetReads();
    remember('late', 1, startedBefore);
    await settle();
    expect(rows.size).toBe(0);
  });

  it('forgets everything, here and in the browser, on sign-out', async () => {
    const { rows, store } = memoryStore([{ key: 'k', owner: OWNER, at: Date.now(), value: 1 }]);
    setReadStore(store);
    await hydrateReads(OWNER);
    releaseReads();
    await settle();
    expect(recall('k')).toBeUndefined();
    expect(rows.size).toBe(0);
    // Nobody is signed in: nothing more is kept.
    remember('after', 2, generationNow());
    await settle();
    expect(rows.size).toBe(0);
  });

  it('drops what it read if a change came in while reading', async () => {
    let release: (rows: StoredRead[]) => void = () => undefined;
    const store: ReadStore = {
      load: () =>
        new Promise<StoredRead[]>((resolve) => {
          release = resolve;
        }),
      save: async () => undefined,
      clear: async () => undefined,
    };
    setReadStore(store);
    const hydrating = hydrateReads(OWNER);
    forgetReads();
    release([{ key: 'k', owner: OWNER, at: Date.now(), value: 'stale' }]);
    await hydrating;
    expect(recall('k')).toBeUndefined();
  });

  it('carries on without a cache when the browser will not say what it kept', async () => {
    setReadStore({
      load: async () => {
        throw new Error('blocked');
      },
      save: async () => {
        throw new Error('blocked');
      },
      clear: async () => {
        throw new Error('blocked');
      },
    });
    await expect(hydrateReads(OWNER)).resolves.toBeUndefined();
    remember('a', 1, generationNow());
    forgetReads();
    await settle();
    expect(recall('a')).toBeUndefined();
  });

  it('does not wait longer than two seconds for the browser', async () => {
    setReadStore({
      load: () => new Promise<StoredRead[]>(() => undefined),
      save: async () => undefined,
      clear: async () => undefined,
    });
    let done = false;
    void hydrateReads(OWNER).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(1_900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
  });
});

describe('a reload paints what the browser kept and still asks the server again', () => {
  const portfolio = { currency: 'USD', assets: [] } as never;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T09:00:00.000Z'));
    setReadStore(null);
    releaseReads();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setReadStore(null);
    releaseReads();
  });

  async function reloaded(rows: Omit<StoredRead, 'owner'>[]) {
    const kept = memoryStore(rows.map((row) => ({ ...row, owner: OWNER })));
    setReadStore(kept.store);
    await hydrateReads(OWNER);
    return kept.rows;
  }

  it('RELOAD-REFRESH paints the kept answer and still asks the server, so another session’s change shows', async () => {
    const get = vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue({ fresh: true } as never);
    await reloaded([{ key: 'portfolio:["EUR"]', at: Date.now() - 60_000, value: portfolio }]);
    expect(cachedReads.portfolio.last('EUR')).toBe(portfolio);
    await expect(cachedReads.portfolio.load('EUR')).resolves.toEqual({ fresh: true });
    expect(get).toHaveBeenCalledTimes(1);
    expect(cachedReads.portfolio.last('EUR')).toEqual({ fresh: true });
  });

  it('STALE-STATE marks a kept answer as possibly out of date when asking again after a reload fails', async () => {
    vi.spyOn(portfolioValuationApi, 'get').mockRejectedValue(new Error('offline'));
    await reloaded([{ key: 'portfolio:["EUR"]', at: Date.now() - 60_000, value: portfolio }]);
    expect(cachedReads.portfolio.failed('EUR')).toBe(false);
    await expect(cachedReads.portfolio.load('EUR')).rejects.toThrow('offline');
    // Still painted, and the page can say the figures may be out of date.
    expect(cachedReads.portfolio.last('EUR')).toBe(portfolio);
    expect(cachedReads.portfolio.failed('EUR')).toBe(true);
  });

  it('keeps asking for an answer fetched since the reload: the page always loads', async () => {
    const get = vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue({ fresh: true } as never);
    await reloaded([]);
    await cachedReads.portfolio.load('EUR');
    await cachedReads.portfolio.load('EUR');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('asks again after a change, which drops what the browser kept', async () => {
    const get = vi.spyOn(portfolioValuationApi, 'get').mockResolvedValue({ fresh: true } as never);
    await reloaded([{ key: 'portfolio:["EUR"]', at: Date.now(), value: portfolio }]);
    forgetReads();
    await cachedReads.portfolio.load('EUR');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('always asks for what the sidebar polls', async () => {
    const count = vi.spyOn(operationsApi, 'needsClassification').mockResolvedValue(4);
    await reloaded([{ key: 'to-classify:[]', at: Date.now(), value: 9 }]);
    expect(cachedReads.toClassify.last()).toBe(9);
    await expect(cachedReads.toClassify.load()).resolves.toBe(4);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it('READ-STALE-RELOAD keeps a failed refresh across a reload until an answer replaces it', async () => {
    const { rows, store } = memoryStore();
    setReadStore(store);
    adoptReads(OWNER);
    const get = vi
      .spyOn(portfolioValuationApi, 'get')
      .mockResolvedValueOnce(portfolio)
      .mockRejectedValueOnce(new Error('offline'));
    await cachedReads.portfolio.load('EUR');
    expect(cachedReads.portfolio.failed('EUR')).toBe(false);
    await expect(cachedReads.portfolio.load('EUR')).rejects.toThrow('offline');
    await settle();
    // The figures stay painted, marked as possibly out of date, here and in the browser.
    expect(cachedReads.portfolio.last('EUR')).toBe(portfolio);
    expect(cachedReads.portfolio.failed('EUR')).toBe(true);
    expect(rows.get('portfolio:["EUR"]')).toMatchObject({ value: portfolio, failed: true });

    // A reload: memory is empty, the browser still has the row.
    const kept = [...rows.values()];
    releaseReads();
    await settle();
    await reloaded(kept);
    expect(cachedReads.portfolio.last('EUR')).toEqual(portfolio);
    expect(cachedReads.portfolio.failed('EUR')).toBe(true);

    // It is asked again at once, not reused, and an answer clears the warning everywhere.
    get.mockResolvedValueOnce({ fresh: true } as never);
    await expect(cachedReads.portfolio.load('EUR')).resolves.toEqual({ fresh: true });
    await settle();
    expect(get).toHaveBeenCalledTimes(3);
    expect(cachedReads.portfolio.failed('EUR')).toBe(false);
    expect(rows.get('portfolio:["EUR"]')?.failed).toBeUndefined();
  });

  it('READ-STALE-NOTHING marks nothing when no answer was kept or the cache was dropped meanwhile', async () => {
    let fail: (reason: unknown) => void = () => undefined;
    vi.spyOn(portfolioValuationApi, 'get')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(portfolio)
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          fail = reject;
        }),
      );
    await reloaded([]);
    await expect(cachedReads.portfolio.load('EUR')).rejects.toThrow('offline');
    expect(cachedReads.portfolio.failed('EUR')).toBe(false);
    await cachedReads.portfolio.load('EUR');
    const asking = cachedReads.portfolio.load('EUR');
    forgetReads();
    remember('portfolio:["EUR"]', portfolio, generationNow());
    fail(new Error('offline'));
    await expect(asking).rejects.toThrow('offline');
    expect(cachedReads.portfolio.failed('EUR')).toBe(false);
  });

  it('reads a row saved before the warning was kept as a good answer', async () => {
    await reloaded([{ key: 'portfolio:["EUR"]', at: Date.now(), value: portfolio }]);
    expect(cachedReads.portfolio.failed('EUR')).toBe(false);
  });

  it('keeps showing what was kept when a background sync has finished since, and asks again', async () => {
    const source = (lastSuccessAt: string) => ({
      key: 'wallet:1',
      kind: 'wallet' as const,
      name: 'Wallet',
      state: 'synced' as const,
      lastAttemptAt: lastSuccessAt,
      lastSuccessAt,
      errorMessage: null,
    });
    const status = vi
      .spyOn(syncStatusApi, 'get')
      .mockResolvedValueOnce([source('2026-10-11T08:00:00.000Z')])
      .mockResolvedValueOnce([source('2026-10-11T08:00:00.000Z')])
      .mockResolvedValueOnce([source('2026-10-11T09:00:00.000Z')]);
    const rows = await reloaded([{ key: 'portfolio:[]', at: Date.now(), value: portfolio }]);
    await cachedReads.sources.load();
    // Nothing new: the kept answer stays.
    await cachedReads.sources.load();
    expect(recall('portfolio:[]')).toBe(portfolio);
    // A sync landed at 09:00: the kept answer still paints the page (in memory and in the
    // browser) while the page asks the server again.
    const before = generationNow();
    await cachedReads.sources.load();
    expect(recall('portfolio:[]')).toBe(portfolio);
    expect(generationNow()).not.toBe(before);
    await settle();
    expect(rows.get('portfolio:[]')?.value).toEqual(portfolio);
    expect(status).toHaveBeenCalledTimes(3);
  });
});
