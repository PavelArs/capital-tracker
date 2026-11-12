import { ConflictException, NotFoundException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { FifoHistoryError } from './fifo';
import { OwnedTransferService } from './owned-transfer.service';
import type { TransferVersionRow } from './owned-transfer.store';
import { OWNED_TRANSFER_LIMITS, OwnedTransferCapacityError } from './owned-transfer-fifo';
import {
  type TransferCorrectionInput,
  type TransferCreateInput,
  type TransferVoidInput,
  transferPayload,
} from './owned-transfer-input';
import type { JournalRow, VersionRow } from './trade-journal.store';

// Synthetic ids and amounts only. These pin the order of statements, checks and errors of the
// transfer commands against a recording fake; the PostgreSQL probes carry the database evidence.
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const owner = uuid(1);
const fromId = uuid(0xa);
const toId = uuid(0xb);
const btc = uuid(0xc);
const request = uuid(0xe1);
const transferId = uuid(0xf1);
const sellId = uuid(0xf2);
const created = new Date('2026-01-01T00:00:00.000Z');
const coverage = new Date('2025-01-01T00:00:00.000Z');

interface State {
  replay?: TransferVersionRow;
  head?: TransferVersionRow;
  /** manual_accounts rows: id → currentRevision. */
  accounts: Map<string, number | null>;
  journals: Map<string, JournalRow>;
  instruments: { id: string; name: string; symbol: string | null }[];
  revision?: number;
  heads: TransferVersionRow[];
  trades: (VersionRow & { accountId: string })[];
}

const labels: [string, (sql: string) => boolean][] = [
  ['read only', (sql) => sql === 'SET TRANSACTION READ ONLY'],
  ['lock', (sql) => sql.includes('pg_advisory_xact_lock')],
  ['replay', (sql) => sql.endsWith('WHERE v."ownerId"=$1 AND v."requestId"=$2')],
  ['head', (sql) => sql.includes('v."transferId"=$2 AND v.version=t."currentVersion"')],
  ['heads', (sql) => sql.includes(`AND v.kind<>'void' ORDER BY t.id LIMIT 1001`)],
  ['account', (sql) => sql.startsWith('SELECT id,"currentRevision" FROM manual_accounts')],
  [
    'journal',
    (sql) => sql === 'SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2',
  ],
  ['opening', (sql) => sql.includes('account_opening_snapshots')],
  ['start journal', (sql) => sql.startsWith('INSERT INTO account_trade_journals')],
  ['instruments', (sql) => sql.startsWith('SELECT id,name,symbol FROM accounting_instruments')],
  ['revision', (sql) => sql.startsWith('SELECT "currentRevision" FROM owner_transfer_journals')],
  ['lock accounts', (sql) => sql.startsWith('SELECT id FROM manual_accounts')],
  [
    'journals',
    (sql) =>
      sql.startsWith('SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY'),
  ],
  ['trade counts', (sql) => sql.includes('count(*)::int AS count FROM account_trades')],
  ['trades', (sql) => sql.includes('FROM account_trade_versions v JOIN accounting_instruments i')],
  ['reward counts', (sql) => sql.includes('FROM account_reward_versions v JOIN account_rewards')],
  ['rewards', (sql) => sql.includes('FROM account_reward_versions v JOIN accounting_instruments')],
  ['swap counts', (sql) => sql.includes('FROM account_swap_versions v JOIN account_swaps')],
  ['swaps', (sql) => sql.includes('FROM account_swap_versions v') && !sql.includes('count(*)')],
  [
    'return counts',
    (sql) => sql.includes('FROM account_capital_return_versions v JOIN account_capital_returns'),
  ],
  [
    'returns',
    (sql) => sql.includes('FROM account_capital_return_versions v') && !sql.includes('count(*)'),
  ],
  ['participants', (sql) => sql.includes('participant(id)')],
  ['splits', (sql) => sql.includes('FROM instrument_splits')],
  ['open transfer journal', (sql) => sql.startsWith('INSERT INTO owner_transfer_journals')],
  ['insert transfer', (sql) => sql.startsWith('INSERT INTO owned_transfers(')],
  ['insert version', (sql) => sql.startsWith('INSERT INTO owned_transfer_versions')],
  ['update transfer', (sql) => sql.startsWith('UPDATE owned_transfers SET')],
  ['advance transfer journal', (sql) => sql.startsWith('UPDATE owner_transfer_journals SET')],
  ['advance journal', (sql) => sql.startsWith('UPDATE account_trade_journals SET')],
];

function label(sql: string): string {
  const found = labels.find(([, matches]) => matches(sql));
  if (!found) throw new Error(`Unexpected statement: ${sql.slice(0, 80)}`);
  return found[0];
}

function answer(state: State, name: string, params: unknown[]): unknown[] {
  const ids = params[1] as string[];
  switch (name) {
    case 'replay':
      return state.replay ? [state.replay] : [];
    case 'head':
      return state.head ? [state.head] : [];
    case 'heads':
      return state.heads;
    case 'account': {
      const id = params[1] as string;
      return state.accounts.has(id) ? [{ id, currentRevision: state.accounts.get(id) }] : [];
    }
    case 'journal': {
      const journal = state.journals.get(params[1] as string);
      return journal ? [journal] : [];
    }
    case 'opening':
      return [{ present: false }];
    case 'start journal': {
      const row = {
        ...journal(params[1] as string, 0),
        requestId: params[2],
        canonicalPayload: params[3],
        coverageFrom: new Date(params[4] as string),
      } as JournalRow;
      state.journals.set(row.accountId, row);
      return [row];
    }
    case 'instruments':
      return state.instruments.filter((row) => ids.includes(row.id));
    case 'revision':
      return state.revision === undefined ? [] : [{ currentRevision: state.revision }];
    case 'lock accounts':
      return ids.filter((id) => state.accounts.has(id)).map((id) => ({ id }));
    case 'journals':
      return ids.flatMap((id) => state.journals.get(id) ?? []);
    case 'trade counts':
      return ids.flatMap((accountId) => {
        const count = state.trades.filter((row) => row.accountId === accountId).length;
        return count ? [{ accountId, count }] : [];
      });
    case 'trades':
      return state.trades.filter((row) => ids.includes(row.accountId));
    case 'insert version':
      return [versionRow(params)];
    default:
      return [];
  }
}

function versionRow(params: unknown[]): TransferVersionRow {
  const [, id, version, journalRevision, fromRevision, toRevision, requestId, payload, kind] =
    params;
  return {
    transferId: id,
    version,
    journalRevision,
    fromJournalRevision: fromRevision,
    toJournalRevision: toRevision,
    requestId,
    canonicalPayload: payload,
    kind,
    instrumentId: params[9],
    occurredAt: new Date(params[10] as string),
    orderWithinTimestamp: params[11],
    quantity: params[12],
    feeInstrumentId: params[13],
    feeQuantity: params[14],
    createdAt: created,
  } as TransferVersionRow;
}

function database(state: State) {
  const log: [string, unknown[]][] = [];
  const query = async (text: string, params: unknown[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    const name = label(sql);
    log.push([name, params]);
    return answer(state, name, params);
  };
  const manager = { query, queryRunner: { isTransactionActive: true } } as unknown as EntityManager;
  const source = {
    transaction: async (...args: unknown[]) =>
      (args[args.length - 1] as (manager: EntityManager) => unknown)(manager),
  } as unknown as DataSource;
  return { log, manager, service: new OwnedTransferService(source) };
}

function journal(accountId: string, currentRevision: number): JournalRow {
  return {
    accountId,
    requestId: uuid(0xd0),
    canonicalPayload: '{}',
    coverageFrom: coverage,
    createdAt: created,
    currentRevision,
    originKind: 'declared-empty',
    openingRevision: null,
  };
}

function trade(
  accountId: string,
  id: string,
  side: 'buy' | 'sell',
  quantity: string,
  grossUsd: string,
  occurredAt: string,
  orderWithinTimestamp = 0,
): VersionRow & { accountId: string } {
  return {
    accountId,
    tradeId: id,
    version: 1,
    journalRevision: 1,
    requestId: uuid(0xd1),
    canonicalPayload: '{}',
    kind: 'create',
    createdAt: created,
    instrumentId: btc,
    instrumentName: 'Bitcoin',
    instrumentSymbol: 'BTC',
    side,
    occurredAt: new Date(occurredAt),
    orderWithinTimestamp,
    quantity,
    grossUsd,
    feeUsd: '0',
    paidCurrency: null,
    paidGross: null,
    paidFee: null,
    paidRateDate: null,
    paidPerUsd: null,
    paidRateSource: null,
    comment: null,
    settlementInstrumentId: null,
    settlementName: null,
    settlementSymbol: null,
    settlementQuantity: null,
    purpose: null,
  };
}

function head(overrides: Partial<TransferVersionRow> = {}): TransferVersionRow {
  return {
    transferId,
    version: 1,
    journalRevision: 1,
    requestId: uuid(0xe0),
    kind: 'create',
    createdAt: created,
    fromAccountId: fromId,
    toAccountId: toId,
    fromJournalRevision: 2,
    toJournalRevision: 1,
    instrumentId: btc,
    occurredAt: new Date('2025-02-01T00:00:00.000Z'),
    orderWithinTimestamp: 0,
    quantity: '1',
    feeInstrumentId: null,
    feeQuantity: '0',
    instrumentName: 'Bitcoin',
    instrumentSymbol: 'BTC',
    feeInstrumentName: null,
    feeInstrumentSymbol: null,
    canonicalPayload: '{}',
    ...overrides,
  };
}

/** A holds 2 BTC bought in January; B has started and holds nothing. */
function state(overrides: Partial<State> = {}): State {
  return {
    accounts: new Map([
      [fromId, 1],
      [toId, null],
    ]),
    journals: new Map([
      [fromId, journal(fromId, 1)],
      [toId, journal(toId, 0)],
    ]),
    instruments: [{ id: btc, name: 'Bitcoin', symbol: 'BTC' }],
    heads: [],
    trades: [trade(fromId, uuid(0x71), 'buy', '2', '100', '2025-01-10T00:00:00.000Z')],
    ...overrides,
  };
}

function createInput(overrides: Partial<TransferCreateInput> = {}): TransferCreateInput {
  return {
    requestId: request,
    fromAccountId: fromId,
    toAccountId: toId,
    assertInternal: true,
    instrumentId: btc,
    occurredAt: '2025-02-01T00:00:00.000Z',
    orderWithinTimestamp: null,
    quantity: '1',
    feeInstrumentId: null,
    feeQuantity: '0',
    expectedFromJournalRevision: 1,
    expectedToJournalRevision: 0,
    ...overrides,
  };
}

function correctionInput(
  overrides: Partial<TransferCorrectionInput> = {},
): TransferCorrectionInput {
  return {
    requestId: request,
    expectedVersion: 1,
    assertInternal: true,
    instrumentId: btc,
    occurredAt: '2025-02-03T00:00:00.000Z',
    orderWithinTimestamp: 7,
    quantity: '1.5',
    feeInstrumentId: null,
    feeQuantity: '0',
    expectedFromJournalRevision: 2,
    expectedToJournalRevision: 1,
    ...overrides,
  };
}

const voidInput: TransferVoidInput = {
  requestId: request,
  expectedVersion: 1,
  expectedFromJournalRevision: 2,
  expectedToJournalRevision: 1,
};

const conflictMessage = 'Transfer request conflicts with saved state';
const tradeLimit = OWNED_TRANSFER_LIMITS.activeTrades + 1;
/** Every statement readConnectedLedger issues for the pair, in order. */
function ledgerRead(locked: boolean, ids = [fromId, toId]): [string, unknown[]][] {
  return [
    ...(locked
      ? ([
          ['lock', [owner]],
          ['lock accounts', [owner, ids]],
        ] as [string, unknown[]][])
      : [['heads', [owner]] as [string, unknown[]]]),
    ['journals', [owner, ids]],
    ['trade counts', [owner, ids]],
    ['trades', [owner, ids, tradeLimit]],
    ['reward counts', [owner, ids]],
    ['rewards', [owner, ids, OWNED_TRANSFER_LIMITS.activeRewards + 1]],
    ['swap counts', [owner, ids]],
    ['swaps', [owner, ids, OWNED_TRANSFER_LIMITS.activeSwaps + 1]],
    ['return counts', [owner, ids]],
    ['returns', [owner, ids, OWNED_TRANSFER_LIMITS.activeCapitalReturns + 1]],
    ['participants', [owner, ids]],
    ['splits', [owner, 1001]],
  ];
}
const pairRead = (kind: 'create' | 'target'): [string, unknown[]][] => [
  ['lock', [owner]],
  ['replay', [owner, request]],
  ...(kind === 'target' ? ([['head', [owner, transferId]]] as [string, unknown[]][]) : []),
  ['account', [owner, fromId]],
  ['account', [owner, toId]],
];
const preparation: [string, unknown[]][] = [
  ['instruments', [owner, [btc]]],
  ['revision', [owner]],
  ['heads', [owner]],
];

describe('XFER-COMMAND: one transfer create, correction or void (recording fake)', () => {
  it('creates a transfer after both accounts, labels, capacity and replay checks', async () => {
    const { log, manager, service } = database(state());
    const result = await service.mutateWithin(manager, owner, 'create', createInput());
    const id = log.find(([name]) => name === 'insert transfer')![1][0] as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const payload = transferPayload('create', createInput());
    expect(log).toEqual([
      ...pairRead('create'),
      ['journal', [owner, toId]],
      ...preparation,
      ...ledgerRead(true),
      ['open transfer journal', [owner]],
      ['insert transfer', [id, owner, fromId, toId]],
      [
        'insert version',
        [
          owner,
          id,
          1,
          1,
          2,
          1,
          request,
          payload,
          'create',
          btc,
          '2025-02-01T00:00:00.000Z',
          0,
          '1',
          null,
          '0',
        ],
      ],
      ['advance transfer journal', [owner, 1]],
      ['advance journal', [owner, fromId, 2]],
      ['advance journal', [owner, toId, 1]],
    ]);
    expect(result).toEqual({
      created: true,
      value: {
        journalRevision: 1,
        transfer: {
          transferId: id,
          version: 1,
          journalRevision: 1,
          requestId: request,
          kind: 'create',
          createdAt: created.toISOString(),
          fromAccountId: fromId,
          toAccountId: toId,
          fromJournalRevision: 2,
          toJournalRevision: 1,
          instrumentId: btc,
          occurredAt: '2025-02-01T00:00:00.000Z',
          orderWithinTimestamp: 0,
          quantity: '1',
          feeInstrumentId: null,
          feeQuantity: '0',
          instrumentName: 'Bitcoin',
          instrumentSymbol: 'BTC',
          feeInstrumentName: null,
          feeInstrumentSymbol: null,
        },
      },
    });
  });

  it('answers a replay with the same payload from the saved version', async () => {
    const saved = head({
      requestId: request,
      canonicalPayload: transferPayload('create', createInput()),
    });
    const { log, manager, service } = database(state({ replay: saved }));
    await expect(service.mutateWithin(manager, owner, 'create', createInput())).resolves.toEqual({
      created: false,
      value: {
        journalRevision: 1,
        transfer: expect.objectContaining({ transferId, requestId: request, quantity: '1' }),
      },
    });
    expect(log).toEqual([
      ['lock', [owner]],
      ['replay', [owner, request]],
    ]);
  });

  it('refuses a replay with another payload before anything else', async () => {
    const { log, manager, service } = database(state({ replay: head({ requestId: request }) }));
    const run = service.mutateWithin(manager, owner, 'create', createInput());
    await expect(run).rejects.toThrow(new ConflictException(conflictMessage));
    expect(log).toEqual([
      ['lock', [owner]],
      ['replay', [owner, request]],
    ]);
  });

  it('refuses a missing target before reading the accounts', async () => {
    const { log, manager, service } = database(state());
    const run = service.mutateWithin(manager, owner, 'correct', correctionInput(), transferId);
    await expect(run).rejects.toBeInstanceOf(NotFoundException);
    expect(log).toEqual([
      ['lock', [owner]],
      ['replay', [owner, request]],
      ['head', [owner, transferId]],
    ]);
  });

  it('refuses a missing account before comparing the pair', async () => {
    const { log, manager, service } = database(state({ accounts: new Map([[toId, null]]) }));
    const run = service.mutateWithin(manager, owner, 'create', createInput());
    await expect(run).rejects.toBeInstanceOf(NotFoundException);
    expect(log).toEqual([
      ['lock', [owner]],
      ['replay', [owner, request]],
      ['account', [owner, fromId]],
    ]);
  });

  it('refuses a transfer into the same account after reading it twice', async () => {
    const { log, manager, service } = database(state());
    const run = service.mutateWithin(
      manager,
      owner,
      'create',
      createInput({ toAccountId: fromId }),
    );
    await expect(run).rejects.toThrow(new ConflictException(conflictMessage));
    expect(log).toEqual([
      ['lock', [owner]],
      ['replay', [owner, request]],
      ['account', [owner, fromId]],
      ['account', [owner, fromId]],
    ]);
  });

  it('starts both journals of a first transfer, then names the shortfall it causes', async () => {
    const { log, manager, service } = database(
      state({
        accounts: new Map([
          [fromId, null],
          [toId, null],
        ]),
        journals: new Map(),
        trades: [],
      }),
    );
    const run = service.mutateWithin(
      manager,
      owner,
      'create',
      createInput({ expectedFromJournalRevision: 0 }),
    );
    await expect(run).rejects.toThrow(ConflictException);
    await run.catch((error: ConflictException) =>
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message: 'An account does not hold enough for this transfer',
        dependent: {
          operationId: expect.stringMatching(/^transfer:/),
          accountId: fromId,
          instrumentId: btc,
          occurredAt: '2025-02-01T00:00:00.000Z',
          availableQuantity: '0',
          requiredQuantity: '1',
          missingQuantity: '1',
        },
      }),
    );
    const started = (accountId: string) => [
      ['journal', [owner, accountId]],
      ['opening', [owner, accountId]],
      [
        'start journal',
        [
          owner,
          accountId,
          request,
          JSON.stringify({ coverageFrom: '1970-01-01T00:00:00.000Z', assertEmpty: true }),
          '1970-01-01T00:00:00.000Z',
        ],
      ],
    ];
    expect(log).toEqual([
      ...pairRead('create'),
      ...started(fromId),
      ...started(toId),
      ...preparation,
      ...ledgerRead(true),
    ]);
  });

  it.each([
    ['an older version', head({ version: 2 })],
    ['a voided transfer', head({ kind: 'void' })],
  ])('refuses a correction of %s after reading both accounts', async (_name, saved) => {
    const { log, manager, service } = database(state({ head: saved }));
    const run = service.mutateWithin(manager, owner, 'correct', correctionInput(), transferId);
    await expect(run).rejects.toThrow(new ConflictException(conflictMessage));
    expect(log).toEqual(pairRead('target'));
  });

  it('refuses an unknown instrument before reading the revision', async () => {
    const { log, manager, service } = database(state({ instruments: [] }));
    const run = service.mutateWithin(manager, owner, 'create', createInput());
    await expect(run).rejects.toBeInstanceOf(NotFoundException);
    expect(log).toEqual([...pairRead('create'), ['journal', [owner, toId]], preparation[0]]);
  });

  it('refuses a full owner journal before reading the heads', async () => {
    const { log, manager, service } = database(state({ revision: 10000 }));
    const run = service.mutateWithin(manager, owner, 'create', createInput());
    await expect(run).rejects.toThrow(new ConflictException(conflictMessage));
    expect(log).toEqual([
      ...pairRead('create'),
      ['journal', [owner, toId]],
      ...preparation.slice(0, 2),
    ]);
  });

  it('refuses a new transfer when 1000 are active, but still corrects one', async () => {
    const heads = Array.from({ length: 1000 }, (_, n) =>
      head({
        transferId: uuid(0x10000 + n),
        fromAccountId: uuid(0x20000 + n),
        toAccountId: uuid(0x30000 + n),
      }),
    );
    const full = database(state({ heads }));
    const run = full.service.mutateWithin(full.manager, owner, 'create', createInput());
    await expect(run).rejects.toThrow(new ConflictException(conflictMessage));
    expect(full.log).toEqual([...pairRead('create'), ['journal', [owner, toId]], ...preparation]);
    const fewer = database(state({ heads: heads.slice(1), head: head() }));
    const corrected = fewer.service.mutateWithin(
      fewer.manager,
      owner,
      'correct',
      correctionInput({ expectedFromJournalRevision: 1, expectedToJournalRevision: 0 }),
      transferId,
    );
    await expect(corrected).resolves.toMatchObject({ created: true });
  });

  it('refuses a stale journal revision after reading the ledger', async () => {
    const { log, manager, service } = database(state());
    const run = service.mutateWithin(
      manager,
      owner,
      'create',
      createInput({ expectedToJournalRevision: 1 }),
    );
    await expect(run).rejects.toThrow(new ConflictException(conflictMessage));
    expect(log).toEqual([...pairRead('create'), ...preparation, ...ledgerRead(true)]);
  });

  it.each([
    ['both accounts', [fromId, toId], fromId],
    ['the receiving account', [toId], toId],
  ])(
    'refuses a transfer before the records of %s begin, naming the first',
    async (_n, late, named) => {
      const later = new Date('2025-03-01T00:00:00.000Z');
      const journals = new Map(
        [journal(fromId, 1), journal(toId, 0)].map((row) => [
          row.accountId,
          late.includes(row.accountId) ? { ...row, coverageFrom: later } : row,
        ]),
      );
      const { manager, service } = database(state({ journals }));
      const run = service.mutateWithin(manager, owner, 'create', createInput());
      await expect(run).rejects.toThrow(ConflictException);
      await run.catch((error: ConflictException) =>
        expect(error.getResponse()).toEqual({
          statusCode: 409,
          error: 'Conflict',
          message: 'The records of an account start after this entry',
          coverage: { accountId: named, coverageFrom: later.toISOString() },
        }),
      );
    },
  );

  it('refuses a transfer that no automatic order fits at its instant', async () => {
    const at = '2025-02-01T00:00:00.000Z';
    const trades = [
      trade(fromId, uuid(0x71), 'buy', '2', '100', '2025-01-10T00:00:00.000Z'),
      trade(fromId, uuid(0x72), 'buy', '1', '50', at, 2147483647),
    ];
    const { log, manager, service } = database(state({ trades }));
    const run = service.mutateWithin(manager, owner, 'create', createInput());
    await expect(run).rejects.toThrow(new ConflictException(conflictMessage));
    expect(log).toEqual([
      ...pairRead('create'),
      ['journal', [owner, toId]],
      ...preparation,
      ...ledgerRead(true),
    ]);
  });

  it('places a transfer after the events already at its instant', async () => {
    const at = '2025-02-01T00:00:00.000Z';
    const trades = [
      trade(fromId, uuid(0x71), 'buy', '2', '100', '2025-01-10T00:00:00.000Z'),
      trade(fromId, uuid(0x72), 'buy', '1', '50', at, 4),
    ];
    const { manager, service } = database(state({ trades }));
    const result = await service.mutateWithin(manager, owner, 'create', createInput());
    expect(result.value.transfer.orderWithinTimestamp).toBe(5);
  });

  it('refuses a change that would take a journal past its revision capacity', async () => {
    const journals = new Map([
      [fromId, journal(fromId, 10000)],
      [toId, journal(toId, 0)],
    ]);
    const { log, manager, service } = database(state({ journals }));
    const run = service.mutateWithin(
      manager,
      owner,
      'create',
      createInput({ expectedFromJournalRevision: 10000 }),
    );
    await expect(run).rejects.toBeInstanceOf(OwnedTransferCapacityError);
    expect(log).toEqual([
      ...pairRead('create'),
      ['journal', [owner, toId]],
      ...preparation,
      ...ledgerRead(true),
    ]);
  });

  it('corrects a transfer at its stated order and keeps its pair', async () => {
    const journals = new Map([
      [fromId, journal(fromId, 2)],
      [toId, journal(toId, 1)],
    ]);
    const corrected = database(state({ head: head(), heads: [head()], revision: 1, journals }));
    const result = await corrected.service.mutateWithin(
      corrected.manager,
      owner,
      'correct',
      correctionInput(),
      transferId,
    );
    expect(result).toMatchObject({
      created: true,
      value: {
        journalRevision: 2,
        transfer: {
          transferId,
          version: 2,
          kind: 'correct',
          occurredAt: '2025-02-03T00:00:00.000Z',
          orderWithinTimestamp: 7,
          quantity: '1.5',
          fromJournalRevision: 3,
          toJournalRevision: 2,
        },
      },
    });
    expect(corrected.log).toEqual([
      ...pairRead('target'),
      ...preparation,
      ...ledgerRead(true),
      ['open transfer journal', [owner]],
      [
        'insert version',
        [
          owner,
          transferId,
          2,
          2,
          3,
          2,
          request,
          transferPayload('correct', correctionInput(), transferId),
          'correct',
          btc,
          '2025-02-03T00:00:00.000Z',
          7,
          '1.5',
          null,
          '0',
        ],
      ],
      ['update transfer', [owner, transferId, 2]],
      ['advance transfer journal', [owner, 2]],
      ['advance journal', [owner, fromId, 3]],
      ['advance journal', [owner, toId, 2]],
    ]);
    // The same correction against journals that moved on is refused.
    const stale = database(state({ head: head(), heads: [head()], revision: 1 }));
    await expect(
      stale.service.mutateWithin(stale.manager, owner, 'correct', correctionInput(), transferId),
    ).rejects.toThrow(new ConflictException(conflictMessage));
    expect(stale.log).toEqual([...pairRead('target'), ...preparation, ...ledgerRead(true)]);
  });

  it('voids a transfer with the movement it saved', async () => {
    const journals = new Map([
      [fromId, journal(fromId, 2)],
      [toId, journal(toId, 1)],
    ]);
    const { log, manager, service } = database(
      state({ head: head(), heads: [head()], revision: 1, journals }),
    );
    const result = await service.mutateWithin(manager, owner, 'void', voidInput, transferId);
    expect(result).toMatchObject({
      created: true,
      value: {
        journalRevision: 2,
        transfer: { transferId, version: 2, kind: 'void', quantity: '1', orderWithinTimestamp: 0 },
      },
    });
    expect(log).toEqual([
      ...pairRead('target'),
      ...preparation,
      ...ledgerRead(true),
      ['open transfer journal', [owner]],
      [
        'insert version',
        [
          owner,
          transferId,
          2,
          2,
          3,
          2,
          request,
          transferPayload('void', voidInput, transferId),
          'void',
          btc,
          '2025-02-01T00:00:00.000Z',
          0,
          '1',
          null,
          '0',
        ],
      ],
      ['update transfer', [owner, transferId, 2]],
      ['advance transfer journal', [owner, 2]],
      ['advance journal', [owner, fromId, 3]],
      ['advance journal', [owner, toId, 2]],
    ]);
  });

  it('does not ask a void for coverage: the replay of its saved history decides', async () => {
    const early = head({ occurredAt: new Date('2024-06-01T00:00:00.000Z') });
    const journals = new Map([
      [fromId, journal(fromId, 2)],
      [toId, journal(toId, 1)],
    ]);
    const { log, manager, service } = database(
      state({ head: early, heads: [early], revision: 1, journals }),
    );
    const run = service.mutateWithin(manager, owner, 'void', voidInput, transferId);
    await expect(run).rejects.toBeInstanceOf(FifoHistoryError);
    await expect(run).rejects.not.toBeInstanceOf(ConflictException);
    expect(log).toEqual([...pairRead('target'), ...preparation, ...ledgerRead(true)]);
  });

  it('refuses a void a later sale depends on, naming that sale', async () => {
    const journals = new Map([
      [fromId, journal(fromId, 2)],
      [toId, journal(toId, 2)],
    ]);
    const trades = [
      trade(fromId, uuid(0x71), 'buy', '2', '100', '2025-01-10T00:00:00.000Z'),
      trade(toId, sellId, 'sell', '1', '80', '2025-03-01T00:00:00.000Z'),
    ];
    const { log, manager, service } = database(
      state({ head: head(), heads: [head()], revision: 1, journals, trades }),
    );
    const run = service.mutateWithin(
      manager,
      owner,
      'void',
      { ...voidInput, expectedToJournalRevision: 2 },
      transferId,
    );
    await expect(run).rejects.toThrow(ConflictException);
    await run.catch((error: ConflictException) =>
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message: 'A later operation depends on this transfer',
        dependent: {
          operationId: `trade:${sellId}`,
          accountId: toId,
          instrumentId: btc,
          occurredAt: '2025-03-01T00:00:00.000Z',
          availableQuantity: '0',
          requiredQuantity: '1',
          missingQuantity: '1',
        },
      }),
    );
    expect(log).toEqual([...pairRead('target'), ...preparation, ...ledgerRead(true)]);
  });
});

describe('XFER-ALLOCATION: the lots one transfer moved (recording fake)', () => {
  const twoBuys = [
    trade(fromId, uuid(0x71), 'buy', '1', '100', '2025-01-10T00:00:00.000Z'),
    trade(fromId, uuid(0x73), 'buy', '1', '300', '2025-01-20T00:00:00.000Z'),
  ];
  const moved = head({ quantity: '2' });
  const journals = () =>
    new Map([
      [fromId, journal(fromId, 3)],
      [toId, journal(toId, 1)],
    ]);
  const start: [string, unknown[]][] = [
    ['read only', []],
    ['head', [owner, transferId]],
    ['journal', [owner, fromId]],
    ['journal', [owner, toId]],
  ];

  it('refuses a missing transfer', async () => {
    const { log, service } = database(state());
    await expect(service.allocation(owner, transferId, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(log).toEqual(start.slice(0, 2));
  });

  it('refuses a transfer whose account has no journal', async () => {
    const { log, service } = database(
      state({ head: moved, journals: new Map([[fromId, journal(fromId, 3)]]) }),
    );
    await expect(service.allocation(owner, transferId, {})).rejects.toThrow(
      new ConflictException(conflictMessage),
    );
    expect(log).toEqual(start);
  });

  it.each([
    [{ fromJournalRevision: '2', toJournalRevision: '1' }],
    [{ fromJournalRevision: '3', toJournalRevision: '0' }],
  ])('refuses stale journal pins %j', async (query) => {
    const { log, service } = database(state({ head: moved, journals: journals() }));
    await expect(service.allocation(owner, transferId, query)).rejects.toThrow(
      new ConflictException(conflictMessage),
    );
    expect(log).toEqual(start);
  });

  it('answers a voided transfer with nothing moved, without reading the ledger', async () => {
    const { log, service } = database(
      state({ head: head({ kind: 'void', version: 2 }), journals: journals() }),
    );
    await expect(service.allocation(owner, transferId, {})).resolves.toEqual({
      transferId,
      version: 2,
      fromJournalRevision: 3,
      toJournalRevision: 1,
      principalBasisUsd: '0',
      feeConsumedBasisUsd: '0',
      items: [],
      nextOffset: null,
    });
    expect(log).toEqual(start);
  });

  it('refuses a transfer the replay does not allocate', async () => {
    const { log, service } = database(
      state({ head: moved, heads: [], journals: journals(), trades: twoBuys }),
    );
    await expect(service.allocation(owner, transferId, {})).rejects.toThrow(
      new ConflictException(conflictMessage),
    );
    expect(log).toEqual([...start, ...ledgerRead(false, [fromId])]);
  });

  it('pages the lots a transfer moved', async () => {
    const setup = () =>
      database(state({ head: moved, heads: [moved], journals: journals(), trades: twoBuys }));
    const first = setup();
    const page = await first.service.allocation(owner, transferId, {
      fromJournalRevision: '3',
      toJournalRevision: '1',
      limit: '1',
    });
    expect(first.log).toEqual([...start, ...ledgerRead(false, [fromId, toId])]);
    expect(page).toMatchObject({
      transferId,
      version: 1,
      fromJournalRevision: 3,
      toJournalRevision: 1,
      principalBasisUsd: '400',
      feeConsumedBasisUsd: '0',
      items: [{ kind: 'principal', instrumentId: btc, quantity: '1', costUsd: '100' }],
      nextOffset: 1,
    });
    expect(page.items).toHaveLength(1);
    const second = await setup().service.allocation(owner, transferId, {
      fromJournalRevision: '3',
      toJournalRevision: '1',
      offset: '1',
      limit: '1',
    });
    expect(second).toMatchObject({
      items: [{ kind: 'principal', instrumentId: btc, quantity: '1', costUsd: '300' }],
      nextOffset: null,
    });
    expect(second.items).toHaveLength(1);
  });
});
