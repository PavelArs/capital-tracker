import type { DataSource } from 'typeorm';
import { parseTransaction, type SolanaRpcClient } from './solana-rpc-client';
import { STAKE_PROGRAM } from './solana-stake';
import { MAX_SIGNATURE_PAGES, SolanaSyncAdapter } from './solana-sync.adapter';

// Characterization of SolanaSyncAdapter.step's paths with synthetic keys, signatures and slots:
// 32 zero bytes is a valid key, and 63 zero bytes and one more a valid signature.
const wallet = '1'.repeat(32);
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sig = (index: number) => '1'.repeat(63) + ALPHABET[index];
const TIP = 10;

/** A getTransaction "json" result in which the wallet's balance changes by `delta` lamports. */
const raw = (signature: string, slot: number, delta = 1_000) => ({
  slot,
  blockTime: 1_760_000_000 + slot,
  meta: {
    err: null,
    fee: 0,
    preBalances: [5_000_000],
    postBalances: [5_000_000 + delta],
    preTokenBalances: [],
    postTokenBalances: [],
  },
  transaction: { signatures: [signature], message: { accountKeys: [wallet] } },
});

interface Row {
  id: string;
  ownerId: string;
  address: string;
  scannedBlock: number | null;
  tokenBackfillTo: number | null;
  tokenBackfillAt: number | null;
  solanaSync: unknown;
}

type Rpc = Partial<Record<keyof SolanaRpcClient, unknown>>;

function harness(
  start: Partial<Row>,
  rpc: Rpc,
  db: {
    stored?: { signature: string; result: unknown }[];
    alreadyStored?: string[];
    stake?: string[];
    explained?: { account: string; units: string }[];
  } = {},
) {
  const row: Row = {
    id: 'a',
    ownerId: 'o',
    address: wallet,
    scannedBlock: null,
    tokenBackfillTo: null,
    tokenBackfillAt: null,
    solanaSync: null,
    ...start,
  };
  const events: unknown[][] = [];
  const query = jest.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes('FROM wallet_stake_scans')) return [{ exists: 1 }];
    if (sql.includes("DISTINCT ON (raw->>'signature')")) {
      const after = args[1] as string;
      const limit = args[2] as number;
      events.push(['stored page', after]);
      return (db.stored ?? []).filter((item) => item.signature > after).slice(0, limit);
    }
    if (sql.includes("raw->>'signature' = ANY")) {
      events.push(['stored?', ...(args[1] as string[])]);
      return (db.alreadyStored ?? [])
        .filter((item) => (args[1] as string[]).includes(item))
        .map((signature) => ({ signature }));
    }
    if (sql.startsWith('SELECT account FROM wallet_stake_accounts'))
      return (db.stake ?? []).map((account) => ({ account }));
    if (sql.includes('SELECT account, sum(units)::text')) return db.explained ?? [];
    if (sql.includes('UPDATE wallet_stake_accounts SET lamports')) {
      events.push(['stake state', args[1], args[2], args[4]]);
      return [];
    }
    if (sql.includes('INSERT INTO wallet_stake_rewards')) {
      events.push(['reward', args[2], args[3], args[4]]);
      return [];
    }
    if (
      sql.includes('INSERT INTO wallet_stake_accounts') ||
      sql.includes('INSERT INTO wallet_stake_moves')
    )
      return [];
    if (sql.includes('INSERT INTO wallet_address_transactions')) {
      const txids = args.filter((_, index) => index % 11 === 2);
      events.push(['insert', ...txids]);
      return txids.map((txid) => ({ txid }));
    }
    if (sql.includes('SET "tokenBackfillTo" = $3')) {
      row.tokenBackfillTo = args[2] as number | null;
      row.tokenBackfillAt = args[3] as number | null;
      row.solanaSync = args[4] === null ? null : JSON.parse(args[4] as string);
      events.push([
        'backfill',
        args[2],
        args[3],
        (row.solanaSync as { phase?: string } | null)?.phase ?? null,
      ]);
      return [];
    }
    if (sql.includes('"scannedBlock" = $3')) {
      row.scannedBlock = args[2] as number;
      row.solanaSync = args[4] === null ? null : JSON.parse(args[4] as string);
      events.push(['commit', args[2], args[3]]);
      return [];
    }
    if (sql.includes('SET "solanaSync" = $3')) {
      row.solanaSync = JSON.parse(args[2] as string);
      return [];
    }
    if (sql.includes('FROM wallet_addresses')) return [{ ...row }];
    throw new Error(sql);
  });
  const source = {
    query,
    manager: { query },
    transaction: async (_level: string, run: (manager: unknown) => unknown) => run({ query }),
  };
  const client = {
    slot: async () => ({ ok: true, slot: TIP }),
    tokenAccounts: async () => ({ ok: true, accounts: [] }),
    signatures: jest.fn(async () => ({ ok: true, items: [] })),
    transaction: jest.fn(async (_signature: string) => ({ ok: false, reason: 'unavailable' })),
    epoch: async () => ({ ok: true, epoch: 500n }),
    accounts: async () => ({ ok: true, values: [] }),
    newestSlot: async () => ({ ok: true, slot: null }),
    ...rpc,
  };
  const adapter = new SolanaSyncAdapter(
    source as unknown as DataSource,
    client as unknown as SolanaRpcClient,
  );
  return { adapter, row, events, client };
}

const fetched = (slots: Record<string, number>) =>
  jest.fn(async (signature: string) => ({
    ok: true,
    transaction: parseTransaction(raw(signature, slots[signature]), signature),
  }));
const listing = (pages: Record<string, { signature: string; slot: number }[]>) =>
  jest.fn(async (account: string, _before: string | null) => ({
    ok: true,
    items: (pages[account] ?? []).map((item) => ({ ...item, blockTime: 1_760_000_000 })),
  }));
const delegated = (lamports: number) => ({
  owner: STAKE_PROGRAM,
  lamports,
  data: {
    parsed: {
      type: 'delegated',
      info: {
        stake: {
          delegation: {
            voter: 'x',
            activationEpoch: '1',
            deactivationEpoch: '18446744073709551615',
          },
        },
      },
    },
  },
});

describe('SOL-SYNC-PROGRESS: one ordinary pass', () => {
  it('SOL-SYNC-PROGRESS marks a history at the finalized slot complete without reading lists', async () => {
    const { adapter, events, client } = harness({ scannedBlock: TIP }, {});
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: 0,
    });
    expect(client.signatures).not.toHaveBeenCalled();
    expect(events).toEqual([['commit', TIP, true]]);
  });

  it('SOL-SYNC-PROGRESS completes a history with no new signatures at the finalized slot', async () => {
    const { adapter, row, events } = harness({ scannedBlock: 4 }, {});
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: 0,
    });
    expect(events).toEqual([['commit', TIP, true]]);
    expect(row.solanaSync).toBeNull();
  });

  it('SYNC-DETAIL fails the pass when the token accounts cannot be read', async () => {
    const { adapter, row } = harness(
      {},
      {
        tokenAccounts: async () => ({ ok: false, reason: 'rate_limited', detail: 'rpc.test busy' }),
      },
    );
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'rate_limited',
      imported: 0,
      detail: 'rpc.test busy',
    });
    expect(row.solanaSync).toBeNull();
  });

  it('SOL-SYNC-PROGRESS ends partial before reading anything when the time is used up', async () => {
    let clock = 0;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => (clock += 30_000));
    try {
      const tokenAccounts = jest.fn();
      const { adapter } = harness({}, { tokenAccounts });
      await expect(adapter.step('o', 'a')).resolves.toEqual({
        outcome: 'partial',
        reason: null,
        imported: 0,
      });
      expect(tokenAccounts).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it('SYNC-DETAIL keeps the discovery so far when a signature page fails', async () => {
    const { adapter, row } = harness(
      {},
      { signatures: async () => ({ ok: false, reason: 'unavailable' }) },
    );
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'unavailable',
      imported: 0,
    });
    expect(row.solanaSync).toMatchObject({ phase: 'discover', accountIndex: 0 });
  });

  it('SOL-SYNC-PROGRESS refuses a full signature page that does not move its cursor', async () => {
    const full = Array.from({ length: 1000 }, (_, index) => ({
      signature: `s${index}`,
      slot: 5,
      blockTime: 1_760_000_000,
    }));
    const { adapter } = harness(
      { solanaSync: undefined },
      {
        signatures: async () => ({ ok: true, items: full }),
      },
    );
    // The first page moves the cursor to its last signature; the same page again cannot.
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'invalid_response',
      imported: 0,
    });
  });

  it('SOL-SYNC-PROGRESS ends partial after its share of signature pages', async () => {
    const accounts = Array.from({ length: MAX_SIGNATURE_PAGES + 5 }, (_, index) => `tok-${index}`);
    const signatures = jest.fn(async () => ({ ok: true, items: [] }));
    const { adapter, row } = harness(
      {},
      {
        tokenAccounts: async (_address: string, filter: { programId: string }) => ({
          ok: true,
          accounts: filter.programId.startsWith('Tokenkeg') ? accounts : [],
        }),
        signatures,
      },
    );
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'partial',
      reason: null,
      imported: 0,
    });
    expect(signatures).toHaveBeenCalledTimes(MAX_SIGNATURE_PAGES);
    expect(row.solanaSync).toMatchObject({ phase: 'discover', accountIndex: MAX_SIGNATURE_PAGES });
  });

  it('SOL-SYNC-PROGRESS refuses a transaction that names another slot', async () => {
    const { adapter, events } = harness(
      {},
      {
        signatures: listing({ [wallet]: [{ signature: sig(0), slot: 5 }] }),
        transaction: fetched({ [sig(0)]: 6 }),
      },
    );
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'invalid_response',
      imported: 0,
    });
    expect(events).toEqual([]);
  });

  it('SOL-SYNC-PROGRESS commits whole slots oldest first and skips signatures past the target', async () => {
    const { adapter, events } = harness(
      { scannedBlock: 2 },
      {
        signatures: listing({
          [wallet]: [
            { signature: sig(3), slot: 11 },
            { signature: sig(2), slot: 7 },
            { signature: sig(1), slot: 5 },
            { signature: sig(0), slot: 2 },
          ],
        }),
        transaction: fetched({ [sig(1)]: 5, [sig(2)]: 7 }),
      },
    );
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: 2,
    });
    expect(events).toEqual([
      ['insert', sig(1)],
      ['commit', 5, false],
      ['insert', sig(2)],
      ['commit', TIP, true],
    ]);
  });
});

describe('SOL-STAKE-STATE: stake accounts read once the history is complete', () => {
  it('SOL-STAKE-REWARD records growth no stored move explains at the finalized slot', async () => {
    const { adapter, events } = harness(
      { scannedBlock: TIP },
      {
        accounts: async (keys: string[]) => ({
          ok: true,
          values: keys.map(() => delegated(3_000)),
        }),
        newestSlot: async (account: string) => ({
          ok: true,
          slot: account === 'stake-b' ? TIP + 1 : 3,
        }),
      },
      { stake: ['stake-a', 'stake-b'], explained: [{ account: 'stake-a', units: '1000' }] },
    );
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: 0,
    });
    expect(events).toEqual([
      ['commit', TIP, true],
      ['stake state', 'stake-a', '3000', 'active'],
      ['reward', 'stake-a', TIP, '2000'],
      // A newer transaction touched stake-b: the next pass decides.
      ['stake state', 'stake-b', '3000', 'active'],
    ]);
  });

  it.each([
    [
      'the epoch',
      { epoch: async () => ({ ok: false, reason: 'unavailable', detail: 'rpc.test' }) },
    ],
    [
      'the accounts',
      { accounts: async () => ({ ok: false, reason: 'unavailable', detail: 'rpc.test' }) },
    ],
    [
      'the newest slot',
      {
        accounts: async () => ({ ok: true, values: [delegated(3_000)] }),
        newestSlot: async () => ({ ok: false, reason: 'unavailable', detail: 'rpc.test' }),
      },
    ],
  ])('SYNC-DETAIL fails a complete history when %s cannot be read', async (_name, rpc) => {
    const { adapter, events } = harness({ scannedBlock: TIP }, rpc, { stake: ['stake-a'] });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'unavailable',
      imported: 0,
      detail: 'rpc.test',
    });
    expect(events).toEqual([['commit', TIP, true]]);
  });

  it('SOL-STAKE-STATE refuses an account that is not a stake account', async () => {
    const { adapter } = harness(
      { scannedBlock: TIP },
      { accounts: async () => ({ ok: true, values: [{ owner: 'other', lamports: 1 }] }) },
      { stake: ['stake-a'] },
    );
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'invalid_response',
      imported: 0,
    });
  });
});

describe('TOKEN-BACKFILL: the stored history read again for every token', () => {
  it('TOKEN-BACKFILL reads the stored transactions, then the token accounts, then completes', async () => {
    const stored = [
      { signature: sig(1), result: raw(sig(1), 3) },
      { signature: sig(2), result: { broken: true } },
    ];
    const signatures = listing({
      'tok-1': [
        { signature: sig(6), slot: 9 },
        { signature: sig(5), slot: 6 },
        { signature: sig(4), slot: 4 },
      ],
    });
    const transaction = fetched({ [sig(4)]: 4 });
    const { adapter, row, events } = harness(
      { scannedBlock: TIP, tokenBackfillTo: 8 },
      {
        tokenAccounts: async (_address: string, filter: { programId: string }) => ({
          ok: true,
          accounts: filter.programId.startsWith('Tokenkeg') ? ['tok-1'] : [],
        }),
        signatures,
        transaction,
      },
      { stored, alreadyStored: [sig(5)] },
    );
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: 1,
    });
    // The backfill reads only the token accounts, never the wallet's own list again.
    expect(signatures.mock.calls.map(([account]) => account)).toEqual(['tok-1']);
    expect(transaction.mock.calls.map(([signature]) => signature)).toEqual([sig(4)]);
    expect(events).toEqual([
      ['stored page', ''],
      ['backfill', 8, -1, 'discover'],
      ['stored?', sig(5), sig(4)],
      ['insert', sig(4)],
      ['backfill', null, null, null],
      ['commit', TIP, true],
    ]);
    expect(row).toMatchObject({ tokenBackfillTo: null, tokenBackfillAt: null, solanaSync: null });
  });

  it('TOKEN-BACKFILL pages through the stored transactions and keeps its place', async () => {
    const stored = Array.from({ length: 201 }, (_, index) => ({
      signature: `stored-${String(index).padStart(3, '0')}`,
      result: { unreadable: index },
    }));
    const { adapter, events } = harness({ scannedBlock: TIP, tokenBackfillTo: 8 }, {}, { stored });
    await expect(adapter.step('o', 'a')).resolves.toMatchObject({ outcome: 'complete' });
    expect(events.slice(0, 4)).toEqual([
      ['stored page', ''],
      ['backfill', 8, null, 'stored'],
      ['stored page', 'stored-199'],
      ['backfill', 8, -1, 'discover'],
    ]);
  });

  it('TOKEN-BACKFILL ends partial in the stored phase when the time is used up', async () => {
    const { adapter, row } = harness(
      {
        scannedBlock: TIP,
        tokenBackfillTo: 8,
        solanaSync: {
          revision: 'r',
          mode: 'backfill',
          phase: 'stored',
          target: 8,
          accounts: [],
          accountIndex: 0,
          before: null,
          signatures: [],
          position: 0,
          staged: [],
          storedAfter: '',
        },
      },
      {},
    );
    let clock = 0;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => (clock += 30_000));
    try {
      await expect(adapter.step('o', 'a')).resolves.toEqual({
        outcome: 'partial',
        reason: null,
        imported: 0,
      });
    } finally {
      now.mockRestore();
    }
    expect(row.solanaSync).toMatchObject({ phase: 'stored' });
  });

  it('TOKEN-BACKFILL stores a slot at a time and keeps the backfill open until the last', async () => {
    const { adapter, events } = harness(
      { scannedBlock: TIP, tokenBackfillTo: 8, tokenBackfillAt: -1 },
      {
        tokenAccounts: async (_address: string, filter: { programId: string }) => ({
          ok: true,
          accounts: filter.programId.startsWith('Tokenkeg') ? ['tok-1'] : [],
        }),
        signatures: listing({
          'tok-1': [
            { signature: sig(5), slot: 6 },
            { signature: sig(4), slot: 4 },
          ],
        }),
        transaction: fetched({ [sig(4)]: 4, [sig(5)]: 6 }),
      },
    );
    await expect(adapter.step('o', 'a')).resolves.toMatchObject({
      outcome: 'complete',
      imported: 2,
    });
    expect(events).toEqual([
      // Asked in the order the list gave them, newest first.
      ['stored?', sig(5), sig(4)],
      ['insert', sig(4)],
      ['backfill', 8, 4, 'ingest'],
      ['insert', sig(5)],
      ['backfill', null, null, null],
      ['commit', TIP, true],
    ]);
  });
});
