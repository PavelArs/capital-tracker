import type { DataSource } from 'typeorm';
import { AccountKey } from './bitcoin-xpub';
import { BitcoinXpubSync, GAP_LIMIT, MAX_REQUESTS_PER_SYNC } from './bitcoin-xpub-sync';
import { type ChainObservation, type EsploraClient, PAGE_SIZE } from './esplora-client';

// The public BIP-32 test-vector key (no real owner's) and synthetic transactions only.
const key =
  'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';
const account = new AccountKey(key);
const first = account.address(0, 0);

interface Derived {
  ownerId: string;
  walletId: string;
  chain: 0 | 1;
  addressIndex: number;
  address: string;
  txCount: number | null;
  storedCount: number;
  checkPending: boolean;
  walkTopTxid: string | null;
  walkCursorTxid: string | null;
  walkSeen: number;
  completedTopTxid: string | null;
}

const derived = (chain: 0 | 1, index: number, changes: Partial<Derived> = {}): Derived => ({
  ownerId: 'o',
  walletId: 'w',
  chain,
  addressIndex: index,
  address: account.address(chain, index),
  txCount: 0,
  storedCount: 0,
  checkPending: false,
  walkTopTxid: null,
  walkCursorTxid: null,
  walkSeen: 0,
  completedTopTxid: null,
  ...changes,
});
/** A counted round: GAP_LIMIT unused addresses on each chain past the last used one. */
const counted = (used: Partial<Derived>) => [
  derived(0, 0, used),
  ...Array.from({ length: GAP_LIMIT }, (_, index) => derived(0, index + 1)),
  ...Array.from({ length: GAP_LIMIT }, (_, index) => derived(1, index)),
];
const observation = (txid: string): ChainObservation => ({
  txid,
  blockHeight: 800_000,
  blockHash: 'b'.repeat(64),
  blockTime: '2026-10-01T00:00:00.000Z',
  receivedSats: 1000n,
  sentSats: 0n,
  feeSats: 0n,
  direction: 'in',
  raw: { txid },
});
const txid = (index: number) => index.toString(16).padStart(64, '0');

/** wallet_xpub_addresses kept in memory, answering the statements the scan sends. */
function harness(rows: Derived[], esplora: Partial<Record<'transactionCount' | 'page', unknown>>) {
  const events: unknown[][] = [];
  const sorted = () =>
    [...rows].sort(
      (left, right) => left.chain - right.chain || left.addressIndex - right.addressIndex,
    );
  const find = (args: unknown[]) =>
    rows.find((row) => row.chain === args[1] && row.addressIndex === args[2]) as Derived;
  const query = jest.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes('FROM unnest(ARRAY[0, 1]')) {
      return [0, 1].map((chain) => {
        const own = rows.filter((row) => row.chain === chain);
        const used = own.filter((row) => (row.txCount ?? 0) > 0);
        return {
          chain,
          derived: Math.max(-1, ...own.map((row) => row.addressIndex)),
          used: Math.max(-1, ...used.map((row) => row.addressIndex)),
        };
      });
    }
    if (sql.includes('INSERT INTO wallet_xpub_addresses')) {
      for (let index = 0; index < args.length; index += 5) {
        const [chain, addressIndex, address] = args.slice(index + 2, index + 5) as [
          0 | 1,
          number,
          string,
        ];
        events.push(['derive', chain, addressIndex]);
        rows.push({ ...derived(chain, addressIndex), address, txCount: null });
      }
      return [];
    }
    if (sql.includes('SET "checkPending" = true')) {
      const busy = rows.some(
        (row) =>
          row.checkPending || row.walkTopTxid !== null || (row.txCount ?? 0) > row.storedCount,
      );
      if (!busy) for (const row of rows) row.checkPending = true;
      events.push(['round', !busy]);
      return [];
    }
    if (sql.includes('AND "checkPending"'))
      return sorted()
        .filter((row) => row.checkPending)
        .slice(0, 1);
    if (sql.includes('SET "txCount"')) {
      Object.assign(find(args), { txCount: args[3], checkPending: false });
      events.push(['count', args[1], args[2], args[3]]);
      return [];
    }
    if (sql.includes('"walkTopTxid" IS NOT NULL OR')) {
      return sorted()
        .filter((row) => row.walkTopTxid !== null || (row.txCount ?? 0) > row.storedCount)
        .slice(0, 1);
    }
    if (sql.startsWith('SELECT address FROM wallet_xpub_addresses'))
      return rows.map(({ address }) => ({ address }));
    if (sql.includes('FOR UPDATE')) return [{ ...find(args) }];
    if (sql.includes('INSERT INTO wallet_address_transactions')) {
      const txids = args.filter((_, index) => index % 11 === 2);
      events.push(['insert', txids.length]);
      return txids.map((value) => ({ txid: value }));
    }
    if (sql.includes('"completedTopTxid" = coalesce')) {
      const row = find(args);
      Object.assign(row, {
        completedTopTxid: args[3] ?? row.completedTopTxid,
        storedCount: args[4],
        walkTopTxid: null,
        walkCursorTxid: null,
        walkSeen: 0,
      });
      events.push(['finished', args[1], args[2], args[4]]);
      return [[{ ...row }], 1];
    }
    if (sql.includes('SET "walkTopTxid" = $4')) {
      const row = find(args);
      Object.assign(row, { walkTopTxid: args[3], walkCursorTxid: args[4], walkSeen: args[5] });
      events.push(['walk', args[1], args[2], args[5]]);
      return [[{ ...row }], 1];
    }
    if (sql.includes('SET "completedAt"')) {
      events.push(['complete']);
      return [];
    }
    throw new Error(sql);
  });
  const source = {
    query,
    transaction: async (_level: string, run: (manager: unknown) => unknown) => run({ query }),
  };
  const sync = new BitcoinXpubSync(
    source as unknown as DataSource,
    esplora as unknown as EsploraClient,
  );
  return { sync, events, rows };
}

describe('XPUB-SCAN: one pass counts every derived address, then walks the used ones', () => {
  it('XPUB-SCAN derives and counts a new key, then completes with nothing to walk', async () => {
    const transactionCount = jest.fn(async () => ({ ok: true, count: 0 }));
    const page = jest.fn();
    const { sync, events } = harness([], { transactionCount, page });
    await expect(sync.step('o', 'w', key)).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: 0,
    });
    expect(transactionCount).toHaveBeenCalledTimes(2 * GAP_LIMIT);
    expect(transactionCount.mock.calls[0]).toEqual([first]);
    expect(page).not.toHaveBeenCalled();
    expect(events.filter(([kind]) => kind === 'derive')).toHaveLength(2 * GAP_LIMIT);
    expect(events.at(-1)).toEqual(['complete']);
  });

  it('XPUB-SCAN derives past a used address and ends partial at the request budget', async () => {
    const transactionCount = jest.fn(async (address: string) => ({
      ok: true,
      count: address === first ? 3 : 0,
    }));
    const { sync, events } = harness([], { transactionCount, page: jest.fn() });
    await expect(sync.step('o', 'w', key)).resolves.toEqual({
      outcome: 'partial',
      reason: null,
      imported: 0,
    });
    expect(transactionCount).toHaveBeenCalledTimes(MAX_REQUESTS_PER_SYNC);
    // Index 0 was used, so the first chain reaches one address further.
    expect(events).toContainEqual(['derive', 0, GAP_LIMIT]);
  });

  it('XPUB-SCAN fails the pass when a count cannot be read', async () => {
    const { sync } = harness([], {
      transactionCount: async () => ({ ok: false, reason: 'rate_limited' }),
      page: jest.fn(),
    });
    await expect(sync.step('o', 'w', key)).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'rate_limited',
      imported: 0,
    });
  });

  it('XPUB-SCAN walks a used address page by page until its count is stored', async () => {
    const pages = [
      Array.from({ length: PAGE_SIZE }, (_, index) => observation(txid(index + 1))),
      [observation(txid(100))],
    ];
    const page = jest.fn(async (_address: string, cursor: string | null, _owned: unknown) => ({
      ok: true,
      transactions: cursor === null ? pages[0] : pages[1],
    }));
    const { sync, events, rows } = harness(counted({ txCount: PAGE_SIZE + 1 }), {
      transactionCount: jest.fn(),
      page,
    });
    await expect(sync.step('o', 'w', key)).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: PAGE_SIZE + 1,
    });
    expect(page.mock.calls.map(([address, cursor]) => [address, cursor])).toEqual([
      [first, null],
      [first, txid(PAGE_SIZE)],
    ]);
    expect(page.mock.calls[0][2]).toEqual(new Set(rows.map(({ address }) => address)));
    expect(events).toEqual([
      ['round', false],
      ['insert', PAGE_SIZE],
      ['walk', 0, 0, PAGE_SIZE],
      ['insert', 1],
      ['finished', 0, 0, PAGE_SIZE + 1],
      ['complete'],
    ]);
    expect(rows[0]).toMatchObject({ completedTopTxid: txid(1), storedCount: PAGE_SIZE + 1 });
  });

  it('XPUB-SCAN stores only what is newer than the last walk', async () => {
    const page = jest.fn(async () => ({
      ok: true,
      transactions: [observation(txid(3)), observation(txid(2)), observation(txid(1))],
    }));
    const { sync, events } = harness(
      counted({ txCount: 3, storedCount: 1, completedTopTxid: txid(1) }),
      { transactionCount: jest.fn(), page },
    );
    await expect(sync.step('o', 'w', key)).resolves.toMatchObject({
      outcome: 'complete',
      imported: 2,
    });
    expect(events).toContainEqual(['finished', 0, 0, 3]);
  });

  it('XPUB-SCAN retries later when the provider lists fewer transactions than it counted', async () => {
    const { sync, events } = harness(counted({ txCount: 2 }), {
      transactionCount: jest.fn(),
      page: async () => ({ ok: true, transactions: [observation(txid(1))] }),
    });
    await expect(sync.step('o', 'w', key)).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'unavailable',
      imported: 0,
    });
    expect(events).toEqual([['round', false]]);
  });

  it('XPUB-SCAN fails the pass when a history page cannot be read', async () => {
    const { sync } = harness(counted({ txCount: 2 }), {
      transactionCount: jest.fn(),
      page: async () => ({ ok: false, reason: 'invalid_response' }),
    });
    await expect(sync.step('o', 'w', key)).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'invalid_response',
      imported: 0,
    });
  });

  it('XPUB-SCAN ends partial, reading nothing, when the time is used up', async () => {
    const page = jest.fn();
    const { sync } = harness(counted({ txCount: 2 }), { transactionCount: jest.fn(), page });
    let clock = 0;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => (clock += 30_000));
    try {
      await expect(sync.step('o', 'w', key)).resolves.toEqual({
        outcome: 'partial',
        reason: null,
        imported: 0,
      });
    } finally {
      now.mockRestore();
    }
    expect(page).not.toHaveBeenCalled();
  });
});
