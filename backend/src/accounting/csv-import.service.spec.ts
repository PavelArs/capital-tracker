import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import * as connected from './connected-accounting.store';
import { CsvImportService } from './csv-import.service';

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: jest.fn(),
}));

const owner = '00000000-0000-4000-8000-000000000001';
const account = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const batchId = '00000000-0000-4000-8000-000000000004';
const instrument = '00000000-0000-4000-8000-000000000005';
const requestId = '00000000-0000-4000-8000-000000000006';
const coverage = new Date('2025-01-01T00:00:00.000Z');
const created = new Date('2025-03-01T00:00:00.000Z');
const csvConflict = new ConflictException('CSV request conflicts with saved state');
const historyConflict = new ConflictException('Accounting history conflicts with saved state');
const uuid = (n: number) => `00000000-0000-4000-8000-1000000000${String(n).padStart(2, '0')}`;

beforeEach(() => {
  let next = 0;
  jest.mocked(randomUUID).mockImplementation(() => uuid(++next) as ReturnType<typeof randomUUID>);
});
afterEach(() => jest.restoreAllMocks());

const csv = (...rows: string[]) =>
  Buffer.from(['asset,side,at,order,quantity,gross,fee', ...rows].join('\n'));
const buy = (at: string, order = 0, quantity = '2', gross = '20') =>
  `SYN,B,${at},${order},${quantity},${gross},0`;
const sell = (at: string, quantity = '10', gross = '150') => `SYN,S,${at},0,${quantity},${gross},0`;
const sides = {
  buy: [{ source: 'B', side: 'buy' }],
  sell: [{ source: 'S', side: 'sell' }],
};
const settings = (side: object[] = sides.buy) => ({
  format: { delimiter: ',', decimalSeparator: '.', timestampMode: 'offset' },
  mapping: {
    columns: {
      instrument: 0,
      side: 1,
      occurredAt: 2,
      order: 3,
      quantity: 4,
      grossUsd: 5,
      feeUsd: 6,
    },
    instruments: [{ source: 'SYN', instrumentId: instrument }],
    sides: side,
  },
  assertUsd: true,
});

/** A saved trade version as the trade heads read returns it. */
function head(
  tradeId: string,
  at: string,
  extra: { version?: number; kind?: string; side?: string; quantity?: string } = {},
) {
  return {
    tradeId,
    version: extra.version ?? 1,
    journalRevision: 1,
    requestId: tradeId,
    canonicalPayload: '{}',
    kind: extra.kind ?? 'create',
    createdAt: created,
    instrumentId: instrument,
    instrumentName: 'Synthetic share',
    instrumentSymbol: 'SYN',
    side: extra.side ?? 'buy',
    occurredAt: new Date(at),
    orderWithinTimestamp: 0,
    quantity: extra.quantity ?? '10',
    grossUsd: '100',
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
const held = head('00000000-0000-4000-8000-000000000101', '2025-01-10T00:00:00.000Z');
const transfer = {
  transferId: '00000000-0000-4000-8000-000000000201',
  version: 1,
  journalRevision: 1,
  requestId: '00000000-0000-4000-8000-000000000202',
  kind: 'create',
  createdAt: created,
  canonicalPayload: '{}',
  fromAccountId: account,
  toAccountId: other,
  fromJournalRevision: 1,
  toJournalRevision: 1,
  instrumentId: instrument,
  occurredAt: new Date('2025-02-01T00:00:00.000Z'),
  orderWithinTimestamp: 0,
  quantity: '5',
  feeInstrumentId: null,
  feeQuantity: '0',
  instrumentName: 'Synthetic share',
  instrumentSymbol: 'SYN',
  feeInstrumentName: null,
  feeInstrumentSymbol: null,
};

interface World {
  bytes?: Buffer;
  state?: 'draft' | 'committed' | 'rolled-back';
  revision?: number;
  /** The journal revision the connected ledger reads, when it differs from the account read. */
  ledgerRevision?: number;
  heads?: ReturnType<typeof head>[];
  transfers?: (typeof transfer)[];
  commands?: object[];
  links?: object[];
}

function label(sql: string): string {
  const known: [string, ...string[]][] = [
    ['read only', 'SET TRANSACTION READ ONLY'],
    ['lock owner', 'pg_advisory_xact_lock'],
    ['read account', 'SELECT id,"currentRevision" FROM manual_accounts'],
    ['lock accounts', 'SELECT id FROM manual_accounts', 'FOR UPDATE'],
    ['read journals', 'SELECT * FROM account_trade_journals', 'ANY'],
    ['read journal', 'SELECT * FROM account_trade_journals'],
    ['read batch bytes', '"originalBytes" FROM account_csv_imports', 'id=$3'],
    ['read batch', 'FROM account_csv_imports', 'id=$3'],
    ['read command', 'FROM account_csv_import_commands', '"requestId"=$3'],
    ['read commands', 'FROM account_csv_import_commands', '"batchId"=$3'],
    [
      'read links',
      'SELECT ordinal,"startLine","tradeId","createVersion","rollbackVersion" FROM account_csv_import_rows WHERE "ownerId"=$1 AND "accountId"=$2 AND "batchId"=$3 ORDER BY ordinal',
    ],
    ['read instruments', 'SELECT id,name,symbol FROM accounting_instruments'],
    ['read transfers', 'FROM owned_transfer_versions'],
    ['count trades', 'count(*)::int AS count FROM account_trades'],
    ['read heads', 'FROM account_trade_versions', 'v."accountId"=$2 ORDER BY'],
    ['read trades', 'FROM account_trade_versions', 'ANY'],
    ['count rewards', 'AS active', 'FROM account_reward_versions'],
    ['read rewards', 'FROM account_reward_versions'],
    ['count swaps', 'AS active', 'FROM account_swap_versions'],
    ['read swaps', 'FROM account_swap_versions'],
    ['count returns', 'AS active', 'FROM account_capital_return_versions'],
    ['read returns', 'FROM account_capital_return_versions'],
    ['read participants', 'FROM owned_transfers t'],
    ['read splits', 'FROM instrument_splits'],
    ['insert trade', 'INSERT INTO account_trades '],
    ['insert version', 'INSERT INTO account_trade_versions'],
    ['update trade', 'UPDATE account_trades SET'],
    [
      'insert link',
      'INSERT INTO account_csv_import_rows ("ownerId","accountId","batchId",ordinal,"startLine","tradeId","createVersion","rollbackVersion") VALUES ($1,$2,$3,$4,$5,$6,1,NULL)',
    ],
    [
      'void link',
      'UPDATE account_csv_import_rows SET "rollbackVersion"=2 WHERE "ownerId"=$1 AND "accountId"=$2 AND "batchId"=$3 AND ordinal=$4',
    ],
    [
      'commit batch',
      'UPDATE account_csv_imports SET state=\'committed\',"acceptedSettings"=$4::jsonb WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3',
    ],
    [
      'roll back batch',
      'UPDATE account_csv_imports SET state=\'rolled-back\' WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3',
    ],
    ['advance journal', 'UPDATE account_trade_journals'],
    ['insert command', 'INSERT INTO account_csv_import_commands'],
  ];
  const match = known.find(([, ...parts]) => parts.every((part) => sql.includes(part)));
  if (!match) throw new Error(`Unexpected query: ${sql}`);
  return match[0];
}

function journal(accountId: string, currentRevision: number) {
  return {
    accountId,
    requestId: '00000000-0000-4000-8000-000000000301',
    canonicalPayload: '{}',
    coverageFrom: coverage,
    createdAt: coverage,
    currentRevision,
    originKind: 'declared-empty',
    openingRevision: null,
  };
}

function build(world: World) {
  const calls: [string, unknown[]][] = [];
  const heads = world.heads ?? [held];
  const revision = world.revision ?? 4;
  const batch = {
    id: batchId,
    ownerId: owner,
    accountId: account,
    sha256: 'a'.repeat(64),
    byteLength: 10,
    filename: 'synthetic.csv',
    state: world.state ?? 'draft',
    createdAt: created,
    acceptedSettings: null,
  };
  const query = async (sql: string, params: unknown[] = []) => {
    const name = label(sql);
    calls.push([name, params]);
    switch (name) {
      case 'read account':
        return [{ id: account, currentRevision: 1 }];
      case 'read journal':
        return [journal(account, revision)];
      case 'lock accounts':
        return (params[1] as string[]).map((id) => ({ id }));
      case 'read journals':
        return (params[1] as string[]).map((id) =>
          journal(id, id === account ? (world.ledgerRevision ?? revision) : 0),
        );
      case 'read batch':
        return [batch];
      case 'read batch bytes':
        return [{ ...batch, originalBytes: world.bytes ?? csv(buy('2025-03-01T00:00:00Z')) }];
      case 'read command':
        return (world.commands ?? []).filter(
          (row) => 'requestId' in row && row.requestId === params[2],
        );
      case 'read commands':
        return world.commands ?? [];
      case 'read links':
        return world.links ?? [];
      case 'read instruments':
        return [{ id: instrument, name: 'Synthetic share', symbol: 'SYN' }];
      case 'read transfers':
        return world.transfers ?? [];
      case 'read heads':
        return heads;
      case 'read trades':
        return heads
          .filter((row) => row.kind !== 'void')
          .map((row) => ({ ...row, accountId: account }));
      case 'insert version':
        return [
          {
            tradeId: params[2],
            version: params[3],
            journalRevision: params[4],
            requestId: params[5],
            canonicalPayload: params[6],
            kind: params[7],
            createdAt: created,
            instrumentId: params[8],
            side: params[9],
            occurredAt: new Date(params[10] as string),
            orderWithinTimestamp: params[11],
            quantity: params[12],
            grossUsd: params[13],
            feeUsd: params[14],
          },
        ];
      case 'insert command':
        return [
          {
            ownerId: params[0],
            accountId: params[1],
            batchId: params[2],
            kind: params[3],
            requestId: params[4],
            canonicalPayload: params[5],
            rowCount: params[6],
            firstJournalRevision: params[7],
            lastJournalRevision: params[8],
            createdAt: created,
          },
        ];
      default:
        return [];
    }
  };
  const manager = { query, queryRunner: { isTransactionActive: true } };
  const source = {
    transaction: async (level: unknown, work?: (manager: unknown) => unknown) =>
      (typeof level === 'function' ? level : work!)(manager),
  } as unknown as DataSource;
  return { calls, service: new CsvImportService(source) };
}

const settle = <T>(promise: Promise<T>) => promise.catch((error: unknown) => error);
/** The summary before still projects; the candidate projection fails with no history refusal. */
function failSecondProjection() {
  const failure = new Error('synthetic projection failure');
  const real = connected.projectConnectedLedger;
  jest
    .spyOn(connected, 'projectConnectedLedger')
    .mockImplementationOnce(real)
    .mockImplementationOnce(() => {
      throw failure;
    });
  return failure;
}
const preview = async (world: World, side?: object[]) => {
  const { calls, service } = build(world);
  const result = await settle(service.preview(owner, account, batchId, settings(side)));
  return { calls, result };
};
const view = (result: unknown) =>
  result as {
    canConfirm: boolean;
    batchErrors: { code: string }[];
    candidateSummary: unknown;
    previewHash: string | null;
  };
const summary = (buys: string, remaining: string, sales = '0', consumed = '0') => ({
  grossBuysUsd: buys,
  buyFeesUsd: '0',
  grossSalesUsd: sales,
  sellFeesUsd: '0',
  netSalesUsd: sales,
  consumedCostUsd: consumed,
  realizedUsd: String(BigInt(sales) - BigInt(consumed)),
  remainingCostUsd: remaining,
});
const ids = [account];
const ledger = (lock: boolean, accounts = ids): [string, unknown[]][] => [
  ...(lock ? ([['lock owner', [owner]]] as [string, unknown[]][]) : []),
  ['read transfers', [owner]],
  ...(lock ? ([['lock accounts', [owner, accounts]]] as [string, unknown[]][]) : []),
  ['read journals', [owner, accounts]],
  ['count trades', [owner, accounts]],
  ['read trades', [owner, accounts, 10001]],
  ['count rewards', [owner, accounts]],
  ['read rewards', [owner, accounts, 1001]],
  ['count swaps', [owner, accounts]],
  ['read swaps', [owner, accounts, 1001]],
  ['count returns', [owner, accounts]],
  ['read returns', [owner, accounts, 1001]],
  ['read participants', [owner, accounts]],
  ['read splits', [owner, 1001]],
];

describe('CSV-002-A characterization of the import preview', () => {
  it('CSV-002-A a clean file previews its rows, both summaries and a stable hash', async () => {
    const bytes = csv(buy('2025-03-01T00:00:00Z'), buy('2025-03-02T00:00:00Z', 1, '3', '45'));
    const { calls, result } = await preview({ bytes });
    expect(result).toEqual({
      batchId,
      parserVersion: 'usd-csv-v1',
      journalRevision: 4,
      canConfirm: true,
      rows: [
        {
          ordinal: 1,
          startLine: 2,
          execution: {
            instrumentId: instrument,
            side: 'buy',
            occurredAt: '2025-03-01T00:00:00.000Z',
            orderWithinTimestamp: 0,
            quantity: '2',
            grossUsd: '20',
            feeUsd: '0',
          },
        },
        {
          ordinal: 2,
          startLine: 3,
          execution: {
            instrumentId: instrument,
            side: 'buy',
            occurredAt: '2025-03-02T00:00:00.000Z',
            orderWithinTimestamp: 1,
            quantity: '3',
            grossUsd: '45',
            feeUsd: '0',
          },
        },
      ],
      ignoredColumns: [],
      rowErrors: [],
      batchErrors: [],
      summaryBefore: summary('100', '100'),
      candidateSummary: summary('165', '165'),
      previewHash: createHash('sha256')
        .update(
          JSON.stringify([
            'usd-csv-preview-v1',
            'usd-csv-v1',
            account,
            batchId,
            'a'.repeat(64),
            [',', '.', 'offset', null],
            [[0, 1, 2, 3, 4, 5, 6, null], [['SYN', instrument]], [['B', 'buy']]],
            true,
            [
              [1, 2, [instrument, 'buy', '2025-03-01T00:00:00.000Z', 0, '2', '20', '0']],
              [2, 3, [instrument, 'buy', '2025-03-02T00:00:00.000Z', 1, '3', '45', '0']],
            ],
            4,
          ]),
          'utf8',
        )
        .digest('hex'),
    });
    expect(view(result).previewHash).toBe(
      'cd42f25b17e65e024e05e2b43c3ee6f2bf1c80054dd56e189ec83839ae5c2ee0',
    );
    expect(calls).toEqual([
      ['read only', []],
      ['read account', [owner, account]],
      ['read journal', [owner, account]],
      ['read batch bytes', [owner, account, batchId]],
      ['read heads', [owner, account]],
      ['read instruments', [owner, [instrument]]],
      ...ledger(false),
    ]);
  });

  it('CSV-002-A an unreadable file reports only its structural error', async () => {
    const { result } = await preview({ bytes: csv() });
    expect(result).toMatchObject({
      canConfirm: false,
      rows: [],
      rowErrors: [],
      batchErrors: [{ code: 'no-data', line: null, column: null }],
      summaryBefore: summary('100', '100'),
      candidateSummary: null,
      previewHash: null,
    });
  });

  it('CSV-002-A a row error skips every history check', async () => {
    const bytes = csv(buy('2024-01-01T00:00:00Z'), 'SYN,B,not-a-time,0,1,1,0');
    const { result } = await preview({ bytes });
    expect(result).toMatchObject({
      canConfirm: false,
      rowErrors: [{ ordinal: 2, field: 'occurredAt', code: 'invalid-time' }],
      batchErrors: [],
      candidateSummary: null,
      previewHash: null,
    });
  });

  it('CSV-002-A a row before coverage and a repeated chronology are both reported, in order', async () => {
    const bytes = csv(buy('2024-12-31T23:59:59Z'), buy('2025-01-10T00:00:00Z'));
    const { result } = await preview({ bytes });
    expect(view(result).batchErrors).toEqual([
      { code: 'before-coverage', line: null, column: null },
      { code: 'duplicate-chronology', line: null, column: null },
    ]);
    expect(view(result).candidateSummary).toBeNull();
  });

  it('CSV-002-A more than 1000 active trades is refused without replaying the history', async () => {
    const heads = Array.from({ length: 1000 }, (_, index) =>
      head(
        `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        new Date(Date.UTC(2025, 0, 2) + index * 1000).toISOString(),
      ),
    );
    // A replay would refuse this sale; the cap alone must be reported.
    const bytes = csv(sell('2025-01-01T12:00:00Z'));
    const { result } = await preview({ bytes, heads }, sides.sell);
    expect(view(result).batchErrors).toEqual([
      { code: 'active-trade-cap', line: null, column: null },
    ]);
  });

  it('CSV-002-A exactly 1000 active trades and exactly 10000 versions are inside both caps', async () => {
    const heads = Array.from({ length: 999 }, (_, index) =>
      head(
        `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        new Date(Date.UTC(2025, 0, 2) + index * 1000).toISOString(),
      ),
    );
    const bytes = csv(buy('2025-03-01T00:00:00Z'));
    const full = await preview({ bytes, heads });
    expect(view(full.result).batchErrors).toEqual([]);
    const last = await preview({ bytes, revision: 9999 });
    expect(view(last.result).batchErrors.map((error) => error.code)).not.toContain('version-cap');
  });

  it('CSV-002-A a full journal reports the version cap and then the connected capacity', async () => {
    const bytes = csv(buy('2025-03-01T00:00:00Z'), buy('2025-03-02T00:00:00Z'));
    const { result } = await preview({ bytes, revision: 9999 });
    expect(view(result).batchErrors.map((error) => error.code)).toEqual([
      'version-cap',
      'connected-capacity',
    ]);
    expect(view(result).candidateSummary).toBeNull();
  });

  it('CSV-002-A the connected capacity is read from the ledger journal', async () => {
    const bytes = csv(buy('2025-03-01T00:00:00Z'));
    const { result } = await preview({ bytes, revision: 4, ledgerRevision: 10000 });
    expect(view(result).batchErrors.map((error) => error.code)).toEqual(['connected-capacity']);
  });

  it('CSV-002-A a sale of more than the account holds is insufficient holdings', async () => {
    const bytes = csv(sell('2025-01-20T00:00:00Z', '11'));
    const { result } = await preview({ bytes }, sides.sell);
    expect(view(result).batchErrors.map((error) => error.code)).toEqual(['insufficient-holdings']);
    expect(view(result).canConfirm).toBe(false);
  });

  it('CSV-002-A a sale that breaks a later transfer is connected history', async () => {
    const bytes = csv(sell('2025-01-20T00:00:00Z'));
    const { calls, result } = await preview({ bytes, transfers: [transfer] }, sides.sell);
    expect(view(result).batchErrors.map((error) => error.code)).toEqual(['connected-history']);
    expect(calls.slice(6)).toEqual(ledger(false, [account, other]));
  });

  it('CSV-002-A a failure that is not a history refusal is rethrown', async () => {
    const failure = failSecondProjection();
    const { result } = await preview({});
    expect(result).toBe(failure);
  });
});

const confirmInput = (previewHash: string, extra: object = {}) => ({
  requestId,
  expectedJournalRevision: 4,
  parserVersion: 'usd-csv-v1',
  ...settings(),
  previewHash,
  ...extra,
});
const hashOf = async (world: World) =>
  view((await preview(world)).result).previewHash ?? 'f'.repeat(64);

describe('CSV-003-A characterization of the import confirm', () => {
  const confirm = async (world: World, input: object) => {
    const { calls, service } = build(world);
    const result = await settle(service.confirm(owner, account, batchId, input));
    return { calls, result };
  };
  const opened: [string, unknown[]][] = [
    ['lock owner', [owner]],
    ['read account', [owner, account]],
    ['read command', [owner, account, requestId]],
  ];

  const payload = (hash: string) =>
    JSON.stringify([
      'usd-csv-command-v1',
      'confirm',
      batchId,
      4,
      'usd-csv-v1',
      [',', '.', 'offset', null],
      [[0, 1, 2, 3, 4, 5, 6, null], [['SYN', instrument]], [['B', 'buy']]],
      true,
      hash,
    ]);

  it('CSV-003-A replays a saved command with the same payload and refuses another payload', async () => {
    const hash = 'e'.repeat(64);
    const saved = {
      ownerId: owner,
      accountId: account,
      batchId,
      requestId,
      kind: 'confirm',
      canonicalPayload: payload(hash),
      rowCount: 1,
      firstJournalRevision: 5,
      lastJournalRevision: 5,
      createdAt: created,
    };
    const replay = await confirm({ commands: [saved] }, confirmInput(hash));
    expect(replay.result).toEqual({
      created: false,
      value: {
        accountId: account,
        batchId,
        requestId,
        kind: 'confirm',
        rowCount: 1,
        firstJournalRevision: 5,
        lastJournalRevision: 5,
        createdAt: created.toISOString(),
      },
    });
    expect(replay.calls).toEqual(opened);
    const changed = await confirm({ commands: [saved] }, confirmInput('d'.repeat(64)));
    expect(changed.result).toEqual(csvConflict);
    expect(changed.calls).toEqual(opened);
  });

  it('CSV-003-A refuses a batch that is not a draft, another parser or a stale journal', async () => {
    const hash = await hashOf({});
    for (const [world, extra] of [
      [{ state: 'committed' }, {}],
      [{}, { parserVersion: 'usd-csv-v2' }],
      [{}, { expectedJournalRevision: 3 }],
    ] as [World, object][]) {
      const { calls, result } = await confirm(world, confirmInput(hash, extra));
      expect(result).toEqual(csvConflict);
      expect(calls).toEqual([
        ...opened,
        ...ledger(true),
        ['read batch bytes', [owner, account, batchId]],
      ]);
    }
  });

  it('CSV-003-A a row error or a file error is refused as a history conflict', async () => {
    for (const bytes of [csv('SYN,B,not-a-time,0,1,1,0'), csv()]) {
      const { calls, result } = await confirm({ bytes }, confirmInput('f'.repeat(64)));
      expect(result).toEqual(historyConflict);
      expect(result).not.toBeInstanceOf(BadRequestException);
      expect(calls.at(-1)).toEqual(['read instruments', [owner, [instrument]]]);
    }
  });

  it('CSV-003-A a history refusal or another preview hash is refused as a CSV conflict', async () => {
    const early = await confirm(
      { bytes: csv(buy('2024-06-01T00:00:00Z')) },
      confirmInput('f'.repeat(64)),
    );
    expect(early.result).toEqual(csvConflict);
    const stale = await confirm({}, confirmInput('f'.repeat(64)));
    expect(stale.result).toEqual(csvConflict);
    expect(stale.calls.at(-1)).toEqual(['read instruments', [owner, [instrument]]]);
  });

  it('CSV-003-A writes every row as a new trade with its provenance, then the batch and the receipt', async () => {
    const bytes = csv(buy('2025-03-01T00:00:00Z'), buy('2025-03-02T00:00:00Z', 1, '3', '45'));
    const hash = await hashOf({ bytes });
    const { calls, result } = await confirm({ bytes }, confirmInput(hash));
    const settingsJson = JSON.stringify({ parserVersion: 'usd-csv-v1', ...settings() });
    const write = (
      ordinal: number,
      tradeId: string,
      tradeRequest: string,
      fields: [string, number, string, string],
    ): [string, unknown[]][] => {
      const [occurredAt, order, quantity, gross] = fields;
      const execution = {
        instrumentId: instrument,
        side: 'buy',
        occurredAt,
        orderWithinTimestamp: order,
        quantity,
        grossUsd: gross,
        feeUsd: '0',
      };
      return [
        ['insert trade', [tradeId, owner, account]],
        [
          'insert version',
          [
            owner,
            account,
            tradeId,
            1,
            4 + ordinal,
            tradeRequest,
            JSON.stringify({ kind: 'create', expectedJournalRevision: 3 + ordinal, ...execution }),
            'create',
            instrument,
            'buy',
            occurredAt,
            order,
            quantity,
            gross,
            '0',
          ],
        ],
        ['update trade', [owner, account, tradeId, 1]],
        ['insert link', [owner, account, batchId, ordinal, ordinal + 1, tradeId]],
      ];
    };
    expect(calls).toEqual([
      ...opened,
      ...ledger(true),
      ['read batch bytes', [owner, account, batchId]],
      ['read heads', [owner, account]],
      ['read instruments', [owner, [instrument]]],
      ...write(1, uuid(1), uuid(2), ['2025-03-01T00:00:00.000Z', 0, '2', '20']),
      ...write(2, uuid(3), uuid(4), ['2025-03-02T00:00:00.000Z', 1, '3', '45']),
      ['commit batch', [owner, account, batchId, settingsJson]],
      ['advance journal', [owner, account, 6]],
      ['insert command', [owner, account, batchId, 'confirm', requestId, payload(hash), 2, 5, 6]],
    ]);
    expect(result).toEqual({
      created: true,
      value: {
        accountId: account,
        batchId,
        requestId,
        kind: 'confirm',
        rowCount: 2,
        firstJournalRevision: 5,
        lastJournalRevision: 6,
        createdAt: created.toISOString(),
      },
    });
  });
});

const imported = [
  head('00000000-0000-4000-8000-000000000401', '2025-03-01T00:00:00.000Z', { quantity: '2' }),
  head('00000000-0000-4000-8000-000000000402', '2025-03-02T00:00:00.000Z', { quantity: '3' }),
];
const links = imported.map((row, index) => ({
  ordinal: index + 1,
  startLine: index + 2,
  tradeId: row.tradeId,
  createVersion: 1,
  rollbackVersion: null,
}));
const committed: World = { state: 'committed', heads: [held, ...imported], links };

describe('CSV-004-A characterization of the rollback review', () => {
  const detail = async (world: World) => {
    const { calls, service } = build(world);
    const result = await settle(service.detail(owner, account, batchId));
    return { calls, result: result as { rollbackReview: unknown } };
  };
  const review = (fields: object) => ({
    journalRevision: 4,
    eligible: false,
    removedTradeCount: 2,
    additionalVersionCount: 2,
    summaryBefore: summary('300', '300'),
    summaryAfter: null,
    ...fields,
  });

  it('CSV-004-A a committed batch whose trades are unchanged can be rolled back', async () => {
    const { calls, result } = await detail(committed);
    expect(result).toEqual({
      batch: {
        batchId,
        sha256: 'a'.repeat(64),
        byteLength: 10,
        createdAt: created.toISOString(),
        accountId: account,
        filename: 'synthetic.csv',
        state: 'committed',
      },
      acceptedSettings: null,
      confirmReceipt: null,
      rollbackReceipt: null,
      rollbackReview: review({
        eligible: true,
        reason: null,
        summaryAfter: summary('100', '100'),
      }),
    });
    expect(calls).toEqual([
      ['read only', []],
      ['read account', [owner, account]],
      ['read journal', [owner, account]],
      ['read batch', [owner, account, batchId]],
      ['read commands', [owner, account, batchId]],
      ['read heads', [owner, account]],
      ...ledger(false),
      ['read links', [owner, account, batchId]],
    ]);
  });

  it('CSV-004-A a draft batch is not committed and removes nothing', async () => {
    const { result } = await detail({ ...committed, state: 'draft' });
    expect(result.rollbackReview).toEqual(
      review({
        reason: 'not-committed',
        removedTradeCount: 0,
        additionalVersionCount: 0,
      }),
    );
  });

  it('CSV-004-A a corrected imported trade is a modified trade', async () => {
    const corrected = { ...imported[1], version: 2, kind: 'correct' };
    const { result } = await detail({ ...committed, heads: [held, imported[0], corrected] });
    expect(result.rollbackReview).toMatchObject({ eligible: false, reason: 'modified-trade' });
  });

  it('CSV-004-A a full journal is the version cap before the connected capacity', async () => {
    const { result } = await detail({ ...committed, revision: 9999 });
    expect(result.rollbackReview).toMatchObject({
      journalRevision: 9999,
      reason: 'version-cap',
      summaryAfter: null,
    });
    const ledgerOnly = await detail({ ...committed, ledgerRevision: 9999 });
    expect(ledgerOnly.result.rollbackReview).toMatchObject({
      journalRevision: 4,
      reason: 'connected-capacity',
      summaryAfter: null,
    });
  });

  it('CSV-004-A removing a buy a later sale needs is insufficient holdings or connected history', async () => {
    const sale = head('00000000-0000-4000-8000-000000000403', '2025-03-05T00:00:00.000Z', {
      side: 'sell',
      quantity: '12',
    });
    const heads = [held, ...imported, sale];
    const alone = await detail({ ...committed, heads });
    expect(alone.result.rollbackReview).toMatchObject({ reason: 'insufficient-holdings' });
    const linked = await detail({
      ...committed,
      heads: [held, ...imported],
      transfers: [transfer],
    });
    expect(linked.result.rollbackReview).toMatchObject({ reason: null, eligible: true });
    const broken = await detail({
      ...committed,
      heads: [head(held.tradeId, held.occurredAt.toISOString(), { quantity: '3' }), ...imported],
      transfers: [{ ...transfer, occurredAt: new Date('2025-03-03T00:00:00.000Z') }],
    });
    expect(broken.result.rollbackReview).toMatchObject({ reason: 'connected-history' });
  });

  it('CSV-004-A a failure that is not a history refusal is rethrown', async () => {
    const failure = failSecondProjection();
    const { result } = await detail(committed);
    expect(result).toBe(failure);
  });
});

describe('CSV-004-B characterization of the rollback command', () => {
  const rollback = async (world: World, expectedJournalRevision = 4) => {
    const { calls, service } = build(world);
    const result = await settle(
      service.rollback(owner, account, batchId, { requestId, expectedJournalRevision }),
    );
    return { calls, result };
  };
  const opened: [string, unknown[]][] = [
    ['lock owner', [owner]],
    ['read account', [owner, account]],
    ['read command', [owner, account, requestId]],
    ...ledger(true),
    ['read batch', [owner, account, batchId]],
  ];

  it('CSV-004-B replays a saved rollback with the same payload and refuses another payload', async () => {
    const saved = {
      ownerId: owner,
      accountId: account,
      batchId,
      requestId,
      kind: 'rollback',
      canonicalPayload: JSON.stringify(['usd-csv-command-v1', 'rollback', batchId, 4]),
      rowCount: 2,
      firstJournalRevision: 5,
      lastJournalRevision: 6,
      createdAt: created,
    };
    const replayed: [string, unknown[]][] = [
      ['lock owner', [owner]],
      ['read account', [owner, account]],
      ['read command', [owner, account, requestId]],
    ];
    const same = await rollback({ ...committed, commands: [saved] });
    expect(same.result).toEqual({
      created: false,
      value: {
        accountId: account,
        batchId,
        requestId,
        kind: 'rollback',
        rowCount: 2,
        firstJournalRevision: 5,
        lastJournalRevision: 6,
        createdAt: created.toISOString(),
      },
    });
    expect(same.calls).toEqual(replayed);
    const changed = await rollback({ ...committed, commands: [saved] }, 5);
    expect(changed.result).toEqual(csvConflict);
    expect(changed.calls).toEqual(replayed);
  });

  it('CSV-004-B refuses a stale journal after reading the batch', async () => {
    const { calls, result } = await rollback(committed, 3);
    expect(result).toEqual(csvConflict);
    expect(calls).toEqual(opened);
  });

  it('CSV-004-B refuses a batch the review does not allow', async () => {
    const { calls, result } = await rollback({ ...committed, state: 'draft' });
    expect(result).toEqual(csvConflict);
    expect(calls).toEqual([
      ...opened,
      ['read heads', [owner, account]],
      ['read links', [owner, account, batchId]],
    ]);
  });

  it('CSV-004-B voids every imported trade in order, then the batch and the receipt', async () => {
    const { calls, result } = await rollback(committed);
    const voided = (ordinal: number, tradeRequest: string): [string, unknown[]][] => {
      const row = imported[ordinal - 1];
      const occurredAt = row.occurredAt.toISOString();
      return [
        [
          'insert version',
          [
            owner,
            account,
            row.tradeId,
            2,
            4 + ordinal,
            tradeRequest,
            JSON.stringify({
              kind: 'void',
              tradeId: row.tradeId,
              expectedJournalRevision: 3 + ordinal,
            }),
            'void',
            instrument,
            'buy',
            occurredAt,
            0,
            row.quantity,
            '100',
            '0',
          ],
        ],
        ['update trade', [owner, account, row.tradeId, 2]],
        ['void link', [owner, account, batchId, ordinal]],
      ];
    };
    expect(calls).toEqual([
      ...opened,
      ['read heads', [owner, account]],
      ['read links', [owner, account, batchId]],
      ...voided(1, uuid(1)),
      ...voided(2, uuid(2)),
      ['roll back batch', [owner, account, batchId]],
      ['advance journal', [owner, account, 6]],
      [
        'insert command',
        [
          owner,
          account,
          batchId,
          'rollback',
          requestId,
          JSON.stringify(['usd-csv-command-v1', 'rollback', batchId, 4]),
          2,
          5,
          6,
        ],
      ],
    ]);
    expect(result).toMatchObject({ created: true, value: { kind: 'rollback', rowCount: 2 } });
  });
});
