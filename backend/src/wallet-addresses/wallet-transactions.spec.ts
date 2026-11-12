import { BybitSyncAdapter } from './bybit-sync.adapter';
import { evmChain } from './evm-chains';
import { EvmSyncAdapter } from './evm-sync.adapter';
import { SolanaSyncAdapter } from './solana-sync.adapter';
import { StellarSyncAdapter } from './stellar-sync.adapter';
import { TronSyncAdapter } from './tron-sync.adapter';
import { ZcashSyncAdapter } from './zcash-sync.adapter';

// Synthetic legs and database: how each adapter writes its legs to wallet_address_transactions
// is what is under test.
const OWNER = 'owner-1';
const ADDRESS = 'address-1';
const address = { id: ADDRESS, ownerId: OWNER };
const HUGE = 123_456_789_012_345_678_901_234_567_890n;
const TIME_1 = '2026-10-01T00:00:00.000Z';
const TIME_2 = '2026-10-02T21:30:00.000Z';
// A raw object goes in as jsonb text: U+0000 kept as its visible escape (jsonbText).
const RAW_1 = '{"id":"tx-1","memo":"a\\\\u0000b"}';
const RAW_2 = '{"id":"tx-2"}';

/** Two legs of every field a chain's leg may carry. */
const legs = [
  {
    txid: 'tx-1',
    kind: 'deposit' as const,
    asset: 'USDT',
    blockHeight: 100,
    blockHash: 'hash-1',
    blockTime: TIME_1,
    receivedUnits: HUGE,
    sentUnits: 0n,
    feeUnits: 0n,
    direction: 'in' as const,
    raw: { id: 'tx-1', memo: 'a\u0000b' },
  },
  {
    txid: 'tx-2',
    kind: 'withdrawal' as const,
    asset: 'USDC',
    blockHeight: 101,
    blockHash: 'hash-2',
    blockTime: TIME_2,
    receivedUnits: 0n,
    sentUnits: 2_500n,
    feeUnits: 100n,
    direction: 'out' as const,
    raw: { id: 'tx-2' },
  },
];
const many = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ ...legs[0], txid: `tx-${index + 1}` }));

type Query = (sql: string, args?: unknown[]) => Promise<unknown>;
/** The adapter's own insert of legs, private to it. */
const insert = (adapter: object, manager: { query: Query }, list: unknown[]) =>
  (
    adapter as unknown as {
      insert(manager: { query: Query }, at: typeof address, list: unknown[]): Promise<number>;
    }
  ).insert(manager, address, list);

const solana = new SolanaSyncAdapter({} as never, {} as never);
const tron = new TronSyncAdapter({} as never, {} as never);
const stellar = new StellarSyncAdapter({} as never, {} as never);
const zcash = new ZcashSyncAdapter({} as never, {} as never);
const evm = new EvmSyncAdapter(
  {} as never,
  { forChain: () => ({}), blockscout: () => ({}) } as never,
  { ...evmChain('optimism'), blockscout: undefined },
);
const bybit = new BybitSyncAdapter({} as never, {} as never, {} as never);

interface Case {
  name: string;
  adapter: object;
  /** The VALUES list the two legs are written as. */
  values: string;
  args: unknown[];
  /** Legs one statement holds at most; null: every leg in one statement. */
  chunk: number | null;
}

const cases: Case[] = [
  {
    name: 'solana',
    adapter: solana,
    values:
      '($1,$2,$3,$4,NULL,$5,$6::numeric,$7::numeric,$8::numeric,$9,$10::jsonb,$11),' +
      '($12,$13,$14,$15,NULL,$16,$17::numeric,$18::numeric,$19::numeric,$20,$21::jsonb,$22)',
    args: [
      ...[OWNER, ADDRESS, 'tx-1', 100, TIME_1, HUGE.toString(), '0', '0', 'in', RAW_1, 'USDT'],
      ...[OWNER, ADDRESS, 'tx-2', 101, TIME_2, '0', '2500', '100', 'out', RAW_2, 'USDC'],
    ],
    chunk: 1_000,
  },
  {
    name: 'tron',
    adapter: tron,
    values:
      '($1,$2,$3,$4,NULL,$5,$6::numeric,$7::numeric,$8::numeric,$9,$10::jsonb,$11),' +
      '($12,$13,$14,$15,NULL,$16,$17::numeric,$18::numeric,$19::numeric,$20,$21::jsonb,$22)',
    args: [
      ...[OWNER, ADDRESS, 'tx-1', 100, TIME_1, HUGE.toString(), '0', '0', 'in', RAW_1, 'USDT'],
      ...[OWNER, ADDRESS, 'tx-2', 101, TIME_2, '0', '2500', '100', 'out', RAW_2, 'USDC'],
    ],
    chunk: null,
  },
  {
    name: 'stellar',
    adapter: stellar,
    values:
      '($1,$2,$3,$4,NULL,$5,$6::numeric,$7::numeric,$8::numeric,$9,$10::jsonb,NULL),' +
      '($11,$12,$13,$14,NULL,$15,$16::numeric,$17::numeric,$18::numeric,$19,$20::jsonb,NULL)',
    args: [
      ...[OWNER, ADDRESS, 'tx-1', 100, TIME_1, HUGE.toString(), '0', '0', 'in', RAW_1],
      ...[OWNER, ADDRESS, 'tx-2', 101, TIME_2, '0', '2500', '100', 'out', RAW_2],
    ],
    chunk: null,
  },
  {
    name: 'zcash',
    adapter: zcash,
    values:
      '($1,$2,$3,$4,$5,$6,$7::numeric,$8::numeric,$9::numeric,$10,$11::jsonb,NULL),' +
      '($12,$13,$14,$15,$16,$17,$18::numeric,$19::numeric,$20::numeric,$21,$22::jsonb,NULL)',
    args: [
      ...[OWNER, ADDRESS, 'tx-1', 100, 'hash-1', TIME_1, HUGE.toString(), '0', '0', 'in', RAW_1],
      ...[OWNER, ADDRESS, 'tx-2', 101, 'hash-2', TIME_2, '0', '2500', '100', 'out', RAW_2],
    ],
    chunk: null,
  },
  {
    name: 'evm',
    adapter: evm,
    values:
      '($1,$2,$3,$4,$5,$6,$7::numeric,$8::numeric,$9::numeric,$10,$11::jsonb,$12),' +
      '($13,$14,$15,$16,$17,$18,$19::numeric,$20::numeric,$21::numeric,$22,$23::jsonb,$24)',
    args: [
      ...[OWNER, ADDRESS, 'tx-1', 100, 'hash-1', TIME_1, HUGE.toString(), '0', '0', 'in', RAW_1],
      'USDT',
      ...[OWNER, ADDRESS, 'tx-2', 101, 'hash-2', TIME_2, '0', '2500', '100', 'out', RAW_2],
      'USDC',
    ],
    chunk: 1_000,
  },
  {
    name: 'bybit',
    adapter: bybit,
    // Bybit's records have no block: height 0 and no block hash.
    values:
      '($1,$2,$3,0,NULL,$4,$5::numeric,$6::numeric,$7::numeric,$8,$9::jsonb,$10),' +
      '($11,$12,$13,0,NULL,$14,$15::numeric,$16::numeric,$17::numeric,$18,$19::jsonb,$20)',
    args: [
      ...[OWNER, ADDRESS, 'tx-1', TIME_1, HUGE.toString(), '0', '0', 'in', RAW_1, 'USDT'],
      ...[OWNER, ADDRESS, 'tx-2', TIME_2, '0', '2500', '100', 'out', RAW_2, 'USDC'],
    ],
    chunk: null,
  },
];

const statement = (values: string) =>
  'INSERT INTO wallet_address_transactions ("ownerId", "addressId", txid, "blockHeight", ' +
  '"blockHash", "blockTime", "receivedUnits", "sentUnits", "feeUnits", direction, raw, asset) ' +
  `VALUES ${values} ON CONFLICT ("addressId", txid) DO NOTHING RETURNING txid`;

/** A database that holds `stored` already: an insert returns the txids it did not hold. */
function database(stored: ReadonlySet<string> = new Set()) {
  const queries: string[] = [];
  const inserts: { sql: string; args: unknown[] }[] = [];
  const query: Query = async (sql, args = []) => {
    queries.push(sql);
    if (!sql.includes('INSERT INTO wallet_address_transactions')) return [];
    inserts.push({ sql: sql.replace(/\s+/g, ' ').trim(), args });
    return args
      .filter((arg) => typeof arg === 'string' && arg.startsWith('tx-') && !stored.has(arg))
      .map((txid) => ({ txid }));
  };
  return { manager: { query }, queries, inserts };
}

describe('the legs each chain adapter stores in wallet_address_transactions', () => {
  it.each(cases)('$name writes each leg once, its amounts exact', async (item) => {
    const db = database();
    await expect(insert(item.adapter, db.manager, legs)).resolves.toBe(2);
    expect(db.inserts).toEqual([{ sql: statement(item.values), args: item.args }]);
  });

  it.each(cases)('$name counts only the legs the database did not hold', async (item) => {
    const db = database(new Set(['tx-2']));
    await expect(insert(item.adapter, db.manager, legs)).resolves.toBe(1);
  });

  it.each(cases)('$name asks nothing of the database without legs', async (item) => {
    const db = database();
    await expect(insert(item.adapter, db.manager, [])).resolves.toBe(0);
    expect(db.queries).toEqual([]);
  });

  it.each(cases)('$name writes 1 001 legs in statements of its size', async (item) => {
    const db = database();
    await expect(insert(item.adapter, db.manager, many(1_001))).resolves.toBe(1_001);
    const sizes = db.inserts.map((written) => (written.sql.match(/::jsonb/g) ?? []).length);
    expect(sizes).toEqual(item.chunk === null ? [1_001] : [item.chunk, 1_001 - item.chunk]);
    // Every statement numbers its parameters from $1.
    for (const written of db.inserts) expect(written.sql).toContain('VALUES ($1,$2,$3,');
  });
});
