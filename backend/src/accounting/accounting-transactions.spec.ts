import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { AssetRewardService } from './asset-reward.service';
import { AssetSwapService } from './asset-swap.service';
import { CsvImportService } from './csv-import.service';
import { FifoHistoryError } from './fifo';
import { OwnedTransferService } from './owned-transfer.service';
import { OwnedTransferCapacityError } from './owned-transfer-fifo';
import { TradeService } from './trade.service';

// Characterization of how the accounting services open their transactions: the isolation they
// ask for, the statement that opens a read, and how a failure inside the work comes back.
// A recording fake answers the first statement and fails the second. Synthetic ids only.
const owner = '00000000-0000-4000-8000-000000000001';
const account = '00000000-0000-4000-8000-000000000002';
const target = '00000000-0000-4000-8000-000000000003';
const instrument = '00000000-0000-4000-8000-000000000004';
const requestId = '00000000-0000-4000-8000-000000000005';

const settings = {
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
    sides: [{ source: 'B', side: 'buy' }],
  },
  assertUsd: true,
};

type Call = (source: DataSource) => Promise<unknown>;
const reward = (source: DataSource) => new AssetRewardService(source);
const swap = (source: DataSource) => new AssetSwapService(source);
const transfer = (source: DataSource) => new OwnedTransferService(source);
const csv = (source: DataSource) => new CsvImportService(source);
const trade = (source: DataSource) => new TradeService(source);

const reads: [string, Call][] = [
  ['AssetRewardService.list', (s) => reward(s).list(owner, account, {})],
  ['AssetRewardService.listVersions', (s) => reward(s).listVersions(owner, account, target, {})],
  ['AssetSwapService.list', (s) => swap(s).list(owner, account, {})],
  ['AssetSwapService.listVersions', (s) => swap(s).listVersions(owner, account, target, {})],
  ['AssetSwapService.getAllocation', (s) => swap(s).getAllocation(owner, account, target, {})],
  ['OwnedTransferService.list', (s) => transfer(s).list(owner, {})],
  ['OwnedTransferService.listVersions', (s) => transfer(s).listVersions(owner, target, {})],
  ['OwnedTransferService.allocation', (s) => transfer(s).allocation(owner, target, {})],
  ['CsvImportService.inspect', (s) => csv(s).inspect(owner, account, target, { delimiter: ',' })],
  ['CsvImportService.preview', (s) => csv(s).preview(owner, account, target, settings)],
  ['CsvImportService.list', (s) => csv(s).list(owner, account, {})],
  ['CsvImportService.detail', (s) => csv(s).detail(owner, account, target)],
  ['CsvImportService.rows', (s) => csv(s).rows(owner, account, target, {})],
  [
    'TradeService.available',
    (s) =>
      trade(s).available(owner, account, { instrumentId: instrument, at: '2025-01-01T00:00:00Z' }),
  ],
  ['TradeService.voidCheck', (s) => trade(s).voidCheck(owner, account, target)],
  ['TradeService.getJournal', (s) => trade(s).getJournal(owner, account)],
  ['TradeService.listTrades', (s) => trade(s).listTrades(owner, account, {})],
  ['TradeService.listLots', (s) => trade(s).listLots(owner, account, {})],
  ['TradeService.listRealizations', (s) => trade(s).listRealizations(owner, account, {})],
  ['TradeService.listMatches', (s) => trade(s).listMatches(owner, account, target, {})],
  ['TradeService.listVersions', (s) => trade(s).listVersions(owner, account, target, {})],
];

const historyConflict = new ConflictException('Accounting history conflicts with saved state');
const capacityConflict = new ConflictException('Accounting component capacity exceeded');
const missing = new NotFoundException();
/** The same exception class with the same response body. */
const answeredAs = (expected: ConflictException) => (error: unknown) => {
  expect(error).toBeInstanceOf(ConflictException);
  expect((error as ConflictException).getResponse()).toEqual(expected.getResponse());
};
const unrelated = new Error('synthetic failure');
/** The failure the second statement raises, and what the caller gets back. */
const failures: [string, () => unknown, (error: unknown) => void][] = [
  ['a refused history', () => new FifoHistoryError(), answeredAs(historyConflict)],
  ['a full component', () => new OwnedTransferCapacityError(), answeredAs(capacityConflict)],
  ['a bad request', () => new BadRequestException('synthetic'), answeredAs(historyConflict)],
  ['a missing row', () => missing, (e) => expect(e).toBe(missing)],
  ['any other error', () => unrelated, (e) => expect(e).toBe(unrelated)],
];

function recording(failure: unknown) {
  const transactions: unknown[][] = [];
  const statements: [string, unknown][] = [];
  const manager = {
    query: async (...args: unknown[]) => {
      statements.push([args[0] as string, args[1]]);
      if (statements.length > 1) throw failure;
      return [];
    },
    queryRunner: { isTransactionActive: true },
  };
  const source = {
    transaction: async (...args: unknown[]) => {
      transactions.push(args.slice(0, -1));
      return (args[args.length - 1] as (value: typeof manager) => unknown)(manager);
    },
  } as unknown as DataSource;
  return { source, transactions, statements };
}

async function outcome(call: Call, failure: unknown) {
  const recorded = recording(failure);
  const error = await call(recorded.source).then(
    () => undefined,
    (value: unknown) => value,
  );
  return { ...recorded, error };
}

describe('accounting reads run in one read-only snapshot', () => {
  const cases = reads.flatMap(([name, call]) =>
    failures.map(([failure, raise, check]) => [name, failure, call, raise, check] as const),
  );
  it.each(cases)('%s answers %s raised inside its snapshot', async (_n, _f, call, raise, check) => {
    const { transactions, statements, error } = await outcome(call, raise());
    expect(transactions).toEqual([['REPEATABLE READ']]);
    expect(statements[0]).toEqual(['SET TRANSACTION READ ONLY', undefined]);
    expect(statements).toHaveLength(2);
    check(error);
  });
});

describe('CSV commands run in one default transaction', () => {
  const commands: [string, Call][] = [
    [
      'CsvImportService.confirm',
      (s) =>
        csv(s).confirm(owner, account, target, {
          requestId,
          expectedJournalRevision: 4,
          parserVersion: 'usd-csv-v1',
          ...settings,
          previewHash: 'f'.repeat(64),
        }),
    ],
    [
      'CsvImportService.rollback',
      (s) => csv(s).rollback(owner, account, target, { requestId, expectedJournalRevision: 4 }),
    ],
  ];
  const cases = commands.flatMap(([name, call]) =>
    failures.map(([failure, raise, check]) => [name, failure, call, raise, check] as const),
  );
  it.each(cases)(
    '%s answers %s raised after the owner lock',
    async (_n, _f, call, raise, check) => {
      const { transactions, statements, error } = await outcome(call, raise());
      expect(transactions).toEqual([[]]);
      expect(statements[0][0]).toContain('pg_advisory_xact_lock');
      expect(statements[0][1]).toEqual([owner]);
      expect(statements).toHaveLength(2);
      check(error);
    },
  );
});
