import type { DataSource } from 'typeorm';
import type { BlockbookClient, ZcashLeg } from './blockbook-client';
import { MAX_ZCASH_PAGES, ZcashSyncAdapter } from './zcash-sync.adapter';

// Synthetic walk state, pages and legs: how a pass walks a block range is under test.
interface Stored {
  readTo: number | null;
  walkTo: number | null;
  walkPage: number | null;
  walkPages: number | null;
}

const leg = (txid: string, blockHeight: number): ZcashLeg => ({
  txid,
  blockHeight,
  blockHash: 'b'.repeat(64),
  blockTime: '2026-10-01T00:00:00.000Z',
  receivedUnits: 1000n,
  sentUnits: 0n,
  feeUnits: 0n,
  direction: 'in',
  raw: { txid },
});

function harness(initial: Stored, client: Partial<Record<'status' | 'page', jest.Mock>>) {
  const stored = { ...initial };
  const events: unknown[][] = [];
  const row = () => ({ id: 'a', ownerId: 'o', address: 't1synthetic', ...stored });
  const query = jest.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes('INSERT INTO wallet_zcash_accounts')) return [];
    if (sql.includes('INSERT INTO wallet_address_transactions')) {
      const txids = args.filter((_, index) => index % 11 === 2);
      events.push(['insert', ...txids]);
      return txids.map((txid) => ({ txid }));
    }
    if (sql.includes('UPDATE wallet_zcash_accounts SET "readTo"')) {
      Object.assign(stored, { readTo: args[1], walkTo: null, walkPage: null, walkPages: null });
      events.push(['finish', args[1]]);
      return [[row()], 1];
    }
    if (sql.includes('UPDATE wallet_zcash_accounts SET "walkTo"')) {
      Object.assign(stored, { walkTo: args[1], walkPage: args[2], walkPages: args[3] });
      events.push(['walk', args[1], args[2], args[3]]);
      return [[row()], 1];
    }
    if (sql.includes('UPDATE wallet_addresses')) {
      events.push(['address', args[2], args[3]]);
      return [];
    }
    if (sql.includes('FROM wallet_addresses a')) return [row()];
    throw new Error(sql);
  });
  const source = {
    query,
    transaction: async (_level: string, run: (manager: unknown) => unknown) => run({ query }),
  };
  const adapter = new ZcashSyncAdapter(
    source as unknown as DataSource,
    client as unknown as BlockbookClient,
  );
  return { adapter, stored, events };
}

const page = (legs: ZcashLeg[], last: boolean, totalPages: number | null = null) => ({
  ok: true,
  page: 1,
  totalPages,
  last,
  legs,
});
const fresh: Stored = { readTo: null, walkTo: null, walkPage: null, walkPages: null };

describe('ZCASH-SYNC: one pass walks a fixed block range page by page', () => {
  it('ZCASH-SYNC fails the pass when the instance status cannot be read', async () => {
    const pageRead = jest.fn();
    const { adapter, events } = harness(fresh, {
      status: jest.fn(async () => ({ ok: false, reason: 'not_configured' })),
      page: pageRead,
    });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'not_configured',
      imported: 0,
    });
    expect(pageRead).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('ZCASH-SYNC marks the history read when no confirmed block is new', async () => {
    const pageRead = jest.fn();
    const { adapter, events } = harness(
      { ...fresh, readTo: 100 },
      { status: jest.fn(async () => ({ ok: true, height: 102 })), page: pageRead },
    );
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: 0,
    });
    expect(pageRead).not.toHaveBeenCalled();
    expect(events).toEqual([['address', null, true]]);
  });

  it('ZCASH-SYNC walks a new range to its last page, committing each page with its place', async () => {
    const pageRead = jest
      .fn()
      .mockResolvedValueOnce(page([leg('a1', 150), leg('a2', 140)], false, 2))
      .mockResolvedValueOnce(page([leg('a3', 120)], true, 2));
    const { adapter, stored, events } = harness(
      { ...fresh, readTo: 100 },
      { status: jest.fn(async () => ({ ok: true, height: 202 })), page: pageRead },
    );
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: 3,
    });
    expect(pageRead.mock.calls).toEqual([
      ['t1synthetic', 101, 200, 1],
      ['t1synthetic', 101, 200, 2],
    ]);
    expect(events).toEqual([
      ['insert', 'a1', 'a2'],
      ['walk', 200, 2, 2],
      ['address', null, false],
      ['insert', 'a3'],
      ['finish', 200],
      ['address', 200, true],
    ]);
    expect(stored).toEqual({ readTo: 200, walkTo: null, walkPage: null, walkPages: null });
  });

  it('ZCASH-SYNC resumes a walk where it stopped and starts it over when the page count moved', async () => {
    const status = jest.fn();
    const pageRead = jest
      .fn()
      .mockResolvedValueOnce(page([], false, 4))
      .mockResolvedValueOnce(page([leg('b1', 130)], true, 1));
    const { adapter, events } = harness(
      { readTo: 100, walkTo: 200, walkPage: 2, walkPages: 3 },
      { status, page: pageRead },
    );
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: 1,
    });
    expect(status).not.toHaveBeenCalled();
    expect(pageRead.mock.calls).toEqual([
      ['t1synthetic', 101, 200, 2],
      ['t1synthetic', 101, 200, 1],
    ]);
    expect(events).toEqual([
      ['insert', 'b1'],
      ['finish', 200],
      ['address', 200, true],
    ]);
  });

  it('ZCASH-SYNC keeps what earlier pages stored when a later page fails', async () => {
    const pageRead = jest
      .fn()
      .mockResolvedValueOnce(page([leg('c1', 150)], false, null))
      .mockResolvedValueOnce({ ok: false, reason: 'rate_limited' });
    const { adapter, stored } = harness(fresh, {
      status: jest.fn(async () => ({ ok: true, height: 202 })),
      page: pageRead,
    });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'rate_limited',
      imported: 1,
    });
    expect(stored).toEqual({ readTo: null, walkTo: 200, walkPage: 2, walkPages: null });
  });

  it('ZCASH-SYNC ends the pass partial after its share of pages', async () => {
    const pageRead = jest.fn(async () => page([], false, null));
    const { adapter, stored } = harness(fresh, {
      status: jest.fn(async () => ({ ok: true, height: 202 })),
      page: pageRead,
    });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'partial',
      reason: null,
      imported: 0,
    });
    expect(pageRead).toHaveBeenCalledTimes(MAX_ZCASH_PAGES);
    expect(stored.walkPage).toBe(MAX_ZCASH_PAGES + 1);
  });

  it('ZCASH-SYNC ends the pass partial, reading nothing, when its time is used up', async () => {
    let clock = 0;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => (clock += 30_000));
    try {
      const pageRead = jest.fn();
      const { adapter, events } = harness(
        { readTo: 100, walkTo: 200, walkPage: 2, walkPages: null },
        { status: jest.fn(), page: pageRead },
      );
      await expect(adapter.step('o', 'a')).resolves.toEqual({
        outcome: 'partial',
        reason: null,
        imported: 0,
      });
      expect(pageRead).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });
});
