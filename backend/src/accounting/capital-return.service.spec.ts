import { ConflictException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { CapitalReturnService } from './capital-return.service';

const owner = '00000000-0000-4000-8000-000000000001';
const account = '00000000-0000-4000-8000-000000000002';
const target = '00000000-0000-4000-8000-000000000003';
const requestId = '00000000-0000-4000-8000-000000000004';
const raw = { requestId, expectedJournalRevision: 7 };
const payload = JSON.stringify({
  kind: 'void',
  capitalReturnId: target,
  expectedJournalRevision: 7,
});
const head = {
  accountId: account,
  capitalReturnId: target,
  version: 1,
  journalRevision: 5,
  requestId: '00000000-0000-4000-8000-000000000005',
  kind: 'create',
  createdAt: new Date('2025-02-01T00:00:00.000Z'),
  canonicalPayload: '{}',
  instrumentId: '00000000-0000-4000-8000-000000000006',
  instrumentName: 'Synthetic fund',
  instrumentSymbol: 'SYN',
  cashInstrumentId: '00000000-0000-4000-8000-000000000007',
  cashInstrumentName: 'Synthetic dollar',
  cashInstrumentSymbol: 'USD',
  occurredAt: new Date('2025-01-15T00:00:00.000Z'),
  orderWithinTimestamp: 0,
  amount: '5',
  amountUsd: '5',
  paidCurrency: null,
  rateDate: null,
  perUsd: null,
  rateSource: null,
};
const saved = { ...head, version: 2, journalRevision: 8, requestId, kind: 'void' };
const receipt = {
  accountId: account,
  journalRevision: 8,
  capitalReturn: {
    accountId: account,
    capitalReturnId: target,
    version: 2,
    journalRevision: 8,
    requestId,
    kind: 'void',
    createdAt: '2025-02-01T00:00:00.000Z',
    instrumentId: head.instrumentId,
    instrumentName: 'Synthetic fund',
    instrumentSymbol: 'SYN',
    cashInstrumentId: head.cashInstrumentId,
    cashInstrumentName: 'Synthetic dollar',
    cashInstrumentSymbol: 'USD',
    occurredAt: '2025-01-15T00:00:00.000Z',
    orderWithinTimestamp: 0,
    amount: '5',
    amountUsd: '5',
    paidCurrency: null,
    rate: null,
  },
};

/** Each statement by a short name; an unknown statement fails the test. */
function label(sql: string): string {
  const known: [string, ...string[]][] = [
    ['lock owner', 'pg_advisory_xact_lock'],
    ['read replay', 'FROM account_capital_return_versions', 'v."requestId"=$3'],
    ['read head', 'FROM account_capital_return_versions', 'v."capitalReturnId"=$3'],
    ['read account', 'SELECT id,"currentRevision" FROM manual_accounts'],
    ['lock accounts', 'SELECT id FROM manual_accounts', 'FOR UPDATE'],
    ['count versions', 'SELECT count(*)::int AS count FROM account_capital_return_versions'],
    ['count heads', 'SELECT count(*)::int AS count,count(*) FILTER', 'account_capital_returns'],
    ['read transfers', 'FROM owned_transfer_versions'],
    ['read journals', 'SELECT * FROM account_trade_journals'],
    ['count trades', 'count(*)::int AS count FROM account_trades'],
    ['read trades', 'FROM account_trade_versions'],
    ['count rewards', 'AS active', 'FROM account_reward_versions'],
    ['read rewards', 'FROM account_reward_versions'],
    ['count swaps', 'AS active', 'FROM account_swap_versions'],
    ['read swaps', 'FROM account_swap_versions'],
    ['count returns', 'AS active', 'FROM account_capital_return_versions'],
    ['read returns', 'FROM account_capital_return_versions', 'LIMIT $3'],
    ['read participants', 'FROM owned_transfers t'],
    ['read splits', 'FROM instrument_splits'],
    ['insert version', 'INSERT INTO account_capital_return_versions'],
    ['update head', 'UPDATE account_capital_returns'],
    ['advance journal', 'UPDATE account_trade_journals'],
  ];
  const match = known.find(([, ...parts]) => parts.every((part) => sql.includes(part)));
  if (!match) throw new Error(`Unexpected query: ${sql}`);
  return match[0];
}

interface World {
  replay?: object;
  head?: object;
  versions?: [owner: number, account: number];
  revision?: number;
}

function build(world: World) {
  const calls: [string, unknown[]][] = [];
  let written = false;
  const query = async (sql: string, params: unknown[] = []) => {
    const name = label(sql);
    calls.push([name, params]);
    if (name === 'read replay') return written ? [saved] : world.replay ? [world.replay] : [];
    if (name === 'read account') return [{ id: account, currentRevision: 1 }];
    if (name === 'read head') return world.head ? [world.head] : [];
    if (name === 'count versions')
      return [{ count: (world.versions ?? [0, 0])[params.length === 1 ? 0 : 1] }];
    if (name === 'count heads') return [{ count: 1, active: 1 }];
    if (name === 'lock accounts') return [{ id: account }];
    if (name === 'read journals')
      return [
        {
          accountId: account,
          requestId: '00000000-0000-4000-8000-000000000008',
          canonicalPayload: '{}',
          coverageFrom: new Date('2025-01-01T00:00:00.000Z'),
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
          currentRevision: world.revision ?? 7,
          originKind: 'declared-empty',
          openingRevision: null,
        },
      ];
    if (name === 'insert version') written = true;
    return [];
  };
  const manager = { query, queryRunner: { isTransactionActive: true } };
  const source = {
    transaction: async (work: (manager: unknown) => unknown) => work(manager),
  } as unknown as DataSource;
  return { calls, service: new CapitalReturnService(source) };
}

const run = (world: World) => {
  const { calls, service } = build(world);
  return { calls, result: service.void(owner, account, target, raw) };
};
const conflict = new ConflictException('Capital return request conflicts with saved state');
const start: [string, unknown[]][] = [
  ['lock owner', [owner]],
  ['read replay', [owner, account, requestId]],
];
const counted: [string, unknown[]][] = [
  ...start,
  ['read account', [owner, account]],
  ['read head', [owner, account, target]],
  ['count versions', [owner]],
  ['count heads', [owner]],
  ['count versions', [owner, account]],
  ['count heads', [owner, account]],
];
const ledger: [string, unknown[]][] = [
  ['lock owner', [owner]],
  ['read transfers', [owner]],
  ['lock accounts', [owner, [account]]],
  ['read journals', [owner, [account]]],
  ['count trades', [owner, [account]]],
  ['read trades', [owner, [account], 10001]],
  ['count rewards', [owner, [account]]],
  ['read rewards', [owner, [account], 1001]],
  ['count swaps', [owner, [account]]],
  ['read swaps', [owner, [account], 1001]],
  ['count returns', [owner, [account]]],
  ['read returns', [owner, [account], 1001]],
  ['read participants', [owner, [account]]],
  ['read splits', [owner, 1001]],
];

describe('BROKER-CAPRET-VOID characterization of the void command', () => {
  it('BROKER-CAPRET-VOID replays the same request without a write', async () => {
    const { calls, result } = run({ replay: { ...saved, canonicalPayload: payload } });
    await expect(result).resolves.toEqual({ created: false, value: receipt });
    expect(calls).toEqual(start);
  });

  it('BROKER-CAPRET-VOID refuses a reused request with another payload', async () => {
    const { calls, result } = run({ replay: { ...saved, canonicalPayload: '{}' } });
    await expect(result).rejects.toEqual(conflict);
    expect(calls).toEqual(start);
  });

  it('BROKER-CAPRET-VOID refuses a return the account does not have', async () => {
    const { calls, result } = run({});
    await expect(result).rejects.toBeInstanceOf(NotFoundException);
    expect(calls).toEqual([...start, ...counted.slice(2, 4)]);
  });

  it('BROKER-CAPRET-VOID refuses a return that is already void', async () => {
    const { calls, result } = run({ head: { ...head, kind: 'void' } });
    await expect(result).rejects.toEqual(conflict);
    expect(calls).toEqual(counted.slice(0, 4));
  });

  it('BROKER-CAPRET-VOID refuses when the owner has no version left, before the account count', async () => {
    const { calls, result } = run({ head, versions: [2000, 0] });
    await expect(result).rejects.toEqual(conflict);
    expect(calls).toEqual(counted.slice(0, 6));
  });

  it('BROKER-CAPRET-VOID refuses when the account has no version left', async () => {
    const { calls, result } = run({ head, versions: [1999, 2000] });
    await expect(result).rejects.toEqual(conflict);
    expect(calls).toEqual(counted);
  });

  it('BROKER-CAPRET-VOID refuses a stale journal revision after reading the ledger', async () => {
    const { calls, result } = run({ head, versions: [1999, 1999], revision: 6 });
    await expect(result).rejects.toEqual(conflict);
    expect(calls).toEqual([...counted, ...ledger]);
  });

  it('BROKER-CAPRET-VOID appends the void version and advances the journal', async () => {
    const { calls, result } = run({ head, versions: [1999, 1999] });
    await expect(result).resolves.toEqual({ created: true, value: receipt });
    expect(calls).toEqual([
      ...counted,
      ...ledger,
      [
        'insert version',
        [
          owner,
          account,
          target,
          2,
          8,
          requestId,
          payload,
          'void',
          head.instrumentId,
          head.cashInstrumentId,
          '2025-01-15T00:00:00.000Z',
          0,
          '5',
          '5',
          null,
          null,
          null,
          null,
        ],
      ],
      ['update head', [owner, account, target, 2]],
      ['read replay', [owner, account, requestId]],
      ['advance journal', [owner, account, 8]],
    ]);
  });
});
