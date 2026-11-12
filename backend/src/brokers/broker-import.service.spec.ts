import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AccountingService } from '../accounting/accounting.service';
import { REWARD_LIMITS } from '../accounting/asset-reward.store';
import { CAPITAL_RETURN_LIMITS } from '../accounting/capital-return.store';
import type { CarryInService } from '../accounting/carry-in.service';
import type { BrokerConnectionsService } from './broker-connections.service';
import { BrokerImportService } from './broker-import.service';
import type { TBankOperation, TBankPosition } from './tbank-client';

// BROKER-SYNC characterization: what the preview of a T-Bank history computes, with each query
// answered by a stub. The stored rows themselves are probed against PostgreSQL in tests/e2e.
const owner = '8b0f2f3e-5a53-4f63-9a2a-0d6f5b9a1c01';
const account = 'a0e1f7c2-0a53-4a0f-8d3a-6b8f2a0d9e02';
const share = '00000000-0000-4000-8000-000000000011';
const fund = '00000000-0000-4000-8000-000000000013';
const rubCash = '00000000-0000-4000-8000-000000000012';
const bond = '00000000-0000-4000-8000-000000000014';

function operation(
  fields: Pick<TBankOperation, 'id' | 'type' | 'occurredAt' | 'payment'> & Partial<TBankOperation>,
): TBankOperation {
  return {
    parentId: '',
    state: 'executed',
    instrumentUid: '',
    instrumentType: '',
    ticker: '',
    quantity: '0',
    paymentCurrency: 'rub',
    price: '',
    priceCurrency: '',
    commission: '',
    commissionCurrency: '',
    fills: [],
    ...fields,
  };
}

const deposit = operation({
  id: '100000001',
  type: 'OPERATION_TYPE_INPUT',
  occurredAt: '2024-03-01T09:00:00Z',
  payment: '10000',
});
const buy = operation({
  id: '100000002',
  type: 'OPERATION_TYPE_BUY',
  occurredAt: '2024-03-01T10:00:00Z',
  instrumentUid: share,
  instrumentType: 'share',
  ticker: 'SYNTH',
  quantity: '2',
  payment: '-1000',
  price: '500',
  priceCurrency: 'rub',
});
const fee = operation({
  id: '100000003',
  parentId: buy.id,
  type: 'OPERATION_TYPE_BROKER_FEE',
  occurredAt: '2024-03-01T10:00:00Z',
  payment: '-5',
});
const sell = operation({
  ...buy,
  id: '100000004',
  type: 'OPERATION_TYPE_SELL',
  occurredAt: '2024-03-02T10:00:00Z',
  quantity: '1',
  payment: '600',
  price: '600',
});
const dividend = operation({
  id: '100000005',
  type: 'OPERATION_TYPE_DIVIDEND',
  occurredAt: '2024-03-02T12:00:00Z',
  instrumentUid: share,
  instrumentType: 'share',
  ticker: 'SYNTH',
  payment: '50',
});
const unsupported = operation({
  id: '100000006',
  type: 'OPERATION_TYPE_UNKNOWN_SYNTHETIC',
  occurredAt: '2024-03-02T13:00:00Z',
  payment: '7',
});

function position(fields: Partial<TBankPosition> & Pick<TBankPosition, 'instrumentUid'>) {
  return {
    instrumentType: 'share',
    quantity: '1',
    averagePrice: '500',
    averagePriceCurrency: 'rub',
    currentPrice: '600',
    currentPriceCurrency: 'rub',
    virtual: false,
    expiresAt: '',
    ...fields,
  } satisfies TBankPosition;
}
const heldShare = position({ instrumentUid: share });
const cash = (quantity: string) =>
  position({
    instrumentUid: rubCash,
    instrumentType: 'currency',
    currencyCode: 'RUB',
    quantity,
    averagePrice: '',
    averagePriceCurrency: '',
    currentPrice: '1',
  });

const rates = ['2024-02-29', '2024-03-01', '2024-03-02'].map((rateDate) => ({
  currency: 'USD',
  rateDate,
  rubPerUnit: '90',
}));

interface World {
  held?: boolean;
  imported?: string[];
  cashInstrument?: boolean;
  links?: { uid: string; assetUid: string | null; instrumentType: string | null }[];
  linkedSplits?: { providerUid: string; effectiveAt: Date }[];
  savedSplits?: { instrumentId: string; effectiveAt: Date }[];
  journalFrom?: string;
  journalRevision?: number;
  rewardCount?: number;
  capitalReturnCount?: number;
  /** An earlier import of the request, found by the first replay or only inside the transaction. */
  earlier?: { payload: string; at: 'first' | 'second' };
  /** A journal another command started first, so this import cannot start one. */
  journalTaken?: boolean;
}

/** One statement the import sent, or one call it made into another accounting service. */
interface Call {
  sql: string;
  parameters: unknown[];
}

const importedAt = new Date('2024-04-01T00:00:00.000Z');
// Enough of a stored version for the stores to read back; the import discards what they return.
const versionRow = {
  createdAt: importedAt,
  occurredAt: importedAt,
  quantity: '1',
  grossUsd: '1',
  feeUsd: '0',
  acquisitionBasisUsd: null,
  incomeValueUsd: null,
  amount: '1',
  amountUsd: '1',
  paidCurrency: null,
};

/** The rows the stub answers to the import's own statements; undefined for the preview's reads. */
function writeAnswer(
  world: World,
  sql: string,
  parameters: unknown[],
  log: Call[],
): unknown[] | undefined {
  if (
    sql.includes('INSERT INTO account_trade_versions') ||
    sql.includes('INSERT INTO account_reward_versions') ||
    sql.includes('v."requestId"=$3')
  )
    return [versionRow];
  if (sql.includes('FROM broker_imports WHERE')) {
    const replays = log.filter((call) => call.sql.includes('FROM broker_imports WHERE')).length;
    if (!world.earlier || (world.earlier.at === 'second' && replays < 2)) return [];
    return [
      {
        id: 'b1d6a8a0-1f0e-4c3a-9b1e-000000000001',
        accountId: account,
        requestId: parameters[2],
        canonicalPayload: world.earlier.payload,
        trades: 1,
        rewards: 2,
        capitalReturns: 3,
        firstJournalRevision: 4,
        lastJournalRevision: 5,
        createdAt: importedAt,
      },
    ];
  }
  if (sql.includes('SELECT id,"currentRevision" FROM manual_accounts'))
    return [{ id: account, currentRevision: null }];
  if (sql.includes('SELECT EXISTS(SELECT 1 FROM account_opening_snapshots'))
    return [{ present: world.journalTaken ?? false }];
  if (sql.includes('INSERT INTO account_trade_journals'))
    return [{ currentRevision: 0, coverageFrom: new Date('1970-01-01T00:00:00.000Z') }];
  if (sql.includes('INSERT INTO accounting_instruments'))
    return [{ id: parameters[0], name: parameters[4], symbol: parameters[5] }];
  if (sql.includes('INSERT INTO broker_imports'))
    return [
      {
        id: parameters[0],
        accountId: parameters[2],
        requestId: parameters[3],
        canonicalPayload: parameters[4],
        trades: parameters[5],
        rewards: parameters[6],
        capitalReturns: parameters[7],
        firstJournalRevision: parameters[8],
        lastJournalRevision: parameters[9],
        createdAt: importedAt,
      },
    ];
  return undefined;
}

function build(
  history: { operations: TBankOperation[]; positions?: TBankPosition[] },
  world: World,
  log?: Call[],
) {
  const query = async (sql: string, parameters: unknown[] = []) => {
    log?.push({ sql, parameters });
    const written = log && writeAnswer(world, sql, parameters, log);
    if (written) return written;
    if (sql === 'SET TRANSACTION READ ONLY') return [];
    if (sql.includes('AS "providerUid"'))
      return (world.linkedSplits ?? []).map((split) => ({ ...split, assetUid: null, ratio: 2 }));
    if (sql.includes(') AS held')) return [{ held: world.held ?? false }];
    if (sql.includes('SELECT "operationId" FROM broker_imported_operations'))
      return (world.imported ?? [])
        .filter((id) => (parameters[2] as string[]).includes(id))
        .map((operationId) => ({ operationId }));
    if (sql.includes('SELECT id,name,symbol FROM accounting_instruments'))
      return world.cashInstrument
        ? [{ id: `cash-${String(parameters[2])}`, name: 'Cash', symbol: parameters[2] }]
        : [];
    if (sql.includes('FROM broker_instrument_links l JOIN accounting_instruments i'))
      return (world.links ?? []).map((link, index) => ({
        ...link,
        id: `linked-${index}`,
        name: `Linked ${index}`,
        symbol: null,
      }));
    if (sql.includes('SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits'))
      return (world.savedSplits ?? []).map((split, index) => ({
        id: `split-${index}`,
        ...split,
        ratio: 2,
      }));
    if (sql.includes('FROM fx_rates')) return rates;
    if (sql.includes('SELECT * FROM account_trade_journals'))
      return world.journalFrom
        ? [
            {
              coverageFrom: new Date(world.journalFrom),
              currentRevision: world.journalRevision ?? 0,
            },
          ]
        : [];
    if (sql.includes('FROM account_reward_versions'))
      return [{ count: world.rewardCount ?? 0, active: world.rewardCount ?? 0 }];
    if (sql.includes('FROM account_capital_return_versions'))
      return [{ count: world.capitalReturnCount ?? 0, active: world.capitalReturnCount ?? 0 }];
    if (log) return [];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const manager = { query, queryRunner: { isTransactionActive: true } };
  const source = {
    manager,
    transaction: async (level: unknown, work?: (manager: unknown) => unknown) =>
      (typeof level === 'function' ? level : work!)(manager),
  };
  const connections = {
    history: async () => ({ brokerAccountId: '2000000001', ...history }),
  };
  const recorded =
    (name: string, answer: unknown) =>
    async (_manager: unknown, ...parameters: unknown[]) => {
      log?.push({ sql: name, parameters });
      return answer;
    };
  return new BrokerImportService(
    source as unknown as DataSource,
    connections as unknown as BrokerConnectionsService,
    {
      saveOpeningWithin: recorded('accounting.saveOpeningWithin', { value: { revision: 1 } }),
    } as unknown as AccountingService,
    { initializeWithin: recorded('carryIn.initializeWithin', {}) } as unknown as CarryInService,
  );
}

const fixedIds = new Set([owner, account, share, fund, rubCash, bond]);

const requestId = '6f1c2d3e-4b5a-4c6d-8e7f-000000000001';

/**
 * The value with each random UUID named by its first appearance, so a run is compared whole:
 * every statement, parameter and payload in order.
 */
function normalized<T>(value: T): T {
  const names = new Map<string, string>();
  return JSON.parse(
    JSON.stringify(value).replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      (uuid) => {
        if (fixedIds.has(uuid) || uuid === requestId) return uuid;
        if (!names.has(uuid)) names.set(uuid, `uuid-${names.size + 1}`);
        return names.get(uuid)!;
      },
    ),
  ) as T;
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Previews the history, then imports what the preview showed, recording every call. */
async function runImport(
  history: { operations: TBankOperation[]; positions?: TBankPosition[] },
  world: World = {},
  raw: Record<string, unknown> = {},
  hash?: string,
) {
  const { previewHash } = await preview(history, world, raw);
  const log: Call[] = [];
  const outcome = await build(history, world, log)
    .import(owner, account, { requestId, previewHash: hash ?? previewHash, ...raw })
    .then(
      (value) => ({ value }),
      (error: Error) => ({ error: error.constructor.name, message: error.message }),
    );
  return normalized({ calls: log, outcome });
}

/** The statements of one kind, by a fragment of their text. */
const callsOf = (calls: readonly Call[], fragment: string) =>
  calls.filter((call) => call.sql.includes(fragment));

const preview = (
  history: { operations: TBankOperation[]; positions?: TBankPosition[] },
  world: World = {},
  raw: unknown = {},
) => build(history, world).preview(owner, account, raw);

const clean = [deposit, buy, fee, sell, dividend];
// A refusal inside the preview's transaction reads as a conflict with the saved state.
const refused = new ConflictException('Accounting history conflicts with saved state');

describe('BROKER-SYNC characterization of the import preview', () => {
  it('BROKER-SYNC a history that replays to what T-Bank holds can be imported', async () => {
    const result = await preview({ operations: clean, positions: [heldShare, cash('9645')] });
    expect(result).toMatchObject({
      canImport: true,
      accountHasEntries: false,
      problems: [],
      trades: 3,
      rewards: 1,
      capitalReturns: 0,
      cashGaps: [],
      skipped: [],
      previewHash: '53b2b308e52ae4fa07e1d58bb49ebbbab6f2be4519cb204153f2cf552ccd8daa',
    });
  });

  it('BROKER-CASH-GAP cash T-Bank reports below the replay is paid out once', async () => {
    const result = await preview({ operations: clean, positions: [heldShare, cash('9000')] });
    expect(result).toMatchObject({
      canImport: true,
      problems: [],
      // Dated just after the first instant from which the history always holds it.
      cashGaps: [{ currency: 'rub', amount: '645', occurredAt: '2024-03-01T09:00:00.001Z' }],
      previewHash: 'ab79cdf836d38e89e1436ecbc2c86c67ee4359c791e98991450ac8f059cc5fc0',
    });
  });

  it('BROKER-SYNC holdings that differ from T-Bank and an unsupported operation are named', async () => {
    const result = await preview({
      operations: [...clean, unsupported],
      positions: [position({ instrumentUid: share, quantity: '3' }), cash('9645')],
    });
    expect(result).toMatchObject({
      canImport: false,
      problems: [
        { reason: 'not-recordable', occurredAt: null, ticker: '', operationIds: [unsupported.id] },
        { reason: 'opening-holding', occurredAt: null, ticker: 'SYNTH', operationIds: [] },
      ],
      skipped: [
        {
          operationId: unsupported.id,
          type: unsupported.type,
          reason: 'unsupported',
          ticker: '',
          occurredAt: unsupported.occurredAt,
        },
      ],
      previewHash: 'cd750f531f4447410597399472914f8f88841ec91f431cfb9b71bef861020a68',
    });
  });

  it('BROKER-SYNC a buy the history has no cash for is not held, with its quantities', async () => {
    const result = await preview({ operations: [buy, fee], positions: [heldShare] });
    expect(result).toMatchObject({
      canImport: false,
      problems: [
        {
          reason: 'not-held',
          occurredAt: '2024-03-01T10:00:00.000Z',
          ticker: 'RUB',
          operationIds: [buy.id, fee.id],
          availableQuantity: '0',
          requiredQuantity: '1005',
          missingQuantity: '1005',
        },
      ],
      previewHash: '0e83dc1758ee99fc377e13e16522a3dacd8f620b32bc5236f18fb5235cc274f9',
    });
  });

  it('BROKER-SYNC entries, earlier imports, records and caps each stop the import', async () => {
    const result = await preview(
      { operations: clean, positions: [heldShare, cash('9645')] },
      {
        held: true,
        imported: [buy.id],
        journalFrom: '2024-03-02T00:00:00.000Z',
        journalRevision: 9999,
        rewardCount: REWARD_LIMITS.activeRewards,
        capitalReturnCount: CAPITAL_RETURN_LIMITS.activeReturns + 1,
        cashInstrument: true,
      },
    );
    expect(result).toMatchObject({
      canImport: false,
      accountHasEntries: true,
      fitsRewardLimit: false,
      fitsCapitalReturnLimit: false,
      problems: [
        { reason: 'already-imported', occurredAt: null, ticker: '', operationIds: [buy.id] },
        {
          reason: 'before-records',
          occurredAt: '2024-03-01T09:00:00.000Z',
          ticker: '',
          operationIds: [deposit.id],
        },
        { reason: 'too-many-rewards', occurredAt: null, ticker: '', operationIds: [] },
        { reason: 'too-many-capital-returns', occurredAt: null, ticker: '', operationIds: [] },
        { reason: 'too-many-entries', occurredAt: null, ticker: '', operationIds: [] },
      ],
      previewHash: '65c4c142072ea82711fb3fef23396218245d624c72ea7de096f93189082ea887',
    });
  });

  it('BROKER-ASSET-ID a security an earlier import linked resolves to its instrument', async () => {
    const result = await preview(
      { operations: clean, positions: [heldShare, cash('9645')] },
      { links: [{ uid: share, assetUid: null, instrumentType: null }], cashInstrument: true },
    );
    expect(result).toMatchObject({
      canImport: true,
      problems: [],
      previewHash: '2080e4a4cb1ea800d8003419c3cd4b4145dbf66f56ed20166ef2ff7541c1ab1d',
    });
  });

  it('SPLIT a split saved for a linked security replays with the history', async () => {
    const result = await preview(
      {
        operations: clean,
        positions: [position({ instrumentUid: share, quantity: '3' }), cash('9645')],
      },
      {
        links: [{ uid: share, assetUid: null, instrumentType: 'share' }],
        linkedSplits: [{ providerUid: share, effectiveAt: new Date('2024-03-01T12:00:00.000Z') }],
        savedSplits: [
          { instrumentId: 'linked-0', effectiveAt: new Date('2024-03-01T12:00:00.000Z') },
        ],
        cashInstrument: true,
      },
    );
    expect(result).toMatchObject({
      canImport: true,
      problems: [],
      previewHash: '6b125bc36b95de5cc3beea664253d1c4ed66151bc7be33c5cc4342f62c93fe6d',
    });
  });

  it('BROKER-CAPRET a bond paid back in part is a capital return', async () => {
    const bondBuy = operation({
      ...buy,
      id: '100000011',
      instrumentUid: bond,
      instrumentType: 'bond',
      ticker: 'SYNTHBOND',
      quantity: '1',
      payment: '-1000',
    });
    const repayment = operation({
      id: '100000012',
      type: 'OPERATION_TYPE_BOND_REPAYMENT',
      occurredAt: '2024-03-02T10:00:00Z',
      instrumentUid: bond,
      instrumentType: 'bond',
      ticker: 'SYNTHBOND',
      quantity: '1',
      payment: '400',
    });
    const result = await preview({
      operations: [deposit, bondBuy, repayment],
      positions: [position({ instrumentUid: bond, instrumentType: 'bond' }), cash('9400')],
    });
    expect(result).toMatchObject({
      canImport: true,
      capitalReturns: 1,
      problems: [],
      previewHash: '7113c67a518b4b6233963a048f1af0cafce2b9a104f0b54cc20c84ded465697b',
    });
  });

  it('BROKER-OPENING opening holdings replay with the history', async () => {
    const result = await preview(
      {
        operations: [sell],
        positions: [position({ instrumentUid: share, quantity: '2' }), cash('600')],
      },
      {},
      {
        opening: {
          asOf: '2024-03-01T00:00:00.000Z',
          lots: [
            {
              asset: share,
              acquiredAt: '2024-02-01T00:00:00.000Z',
              quantity: '3',
              costUsd: '30',
            },
          ],
        },
      },
    );
    expect(result).toMatchObject({
      canImport: true,
      problems: [],
      previewHash: '7add275401829cff411e5cc2d972c882ccec1c1f0fb1306a0e84148f0f7157f3',
    });
  });

  it('SPLIT a declared split replays with the history; a saved one is not declared twice', async () => {
    const history = {
      operations: clean,
      positions: [position({ instrumentUid: share, quantity: '3' }), cash('9645')],
    };
    const splits = [{ asset: share, effectiveAt: '2024-03-01T12:00:00.000Z', ratio: 2 }];
    expect(await preview(history, {}, { splits })).toMatchObject({
      canImport: true,
      problems: [],
      previewHash: '7dbf8b102dc4f90cbd173f1b6a73df34a09f4b2cc8a167bd860ddf5870de99e4',
    });
    await expect(
      preview(
        history,
        {
          links: [{ uid: share, assetUid: null, instrumentType: 'share' }],
          savedSplits: [{ instrumentId: 'linked-0', effectiveAt: new Date(splits[0].effectiveAt) }],
        },
        { splits },
      ),
    ).rejects.toThrow(refused);
  });

  it('BROKER-OPENING holdings and splits outside the history are refused', async () => {
    const history = { operations: clean, positions: [heldShare, cash('9645')] };
    const lot = {
      asset: fund,
      acquiredAt: '2024-02-01T00:00:00.000Z',
      quantity: '1',
      costUsd: '10',
    };
    await expect(
      preview(history, {}, { opening: { asOf: '2024-03-01T00:00:00.000Z', lots: [lot] } }),
    ).rejects.toThrow(refused);
    await expect(
      preview(
        history,
        {},
        { splits: [{ asset: fund, effectiveAt: '2024-03-01T12:00:00.000Z', ratio: 2 }] },
      ),
    ).rejects.toThrow(refused);
  });
});

// BROKER-SYNC characterization of the import's writes: every statement, parameter and call in
// order, with random ids named by first appearance. The rows themselves are probed in tests/e2e.
describe('BROKER-SYNC characterization of the import writes', () => {
  const held = { operations: clean, positions: [heldShare, cash('9645')] };
  const conflict = new ConflictException('Broker import conflicts with saved state');
  // The prices an import saves are observed now.
  beforeEach(() => jest.useFakeTimers({ now: importedAt }));
  afterEach(() => jest.useRealTimers());

  it('BROKER-SYNC trades and a reward are written in order, then the journal advances', async () => {
    const { outcome, calls } = await runImport(held);
    expect(outcome).toEqual({
      value: {
        created: true,
        value: {
          importId: 'uuid-5',
          accountId: account,
          requestId,
          trades: 3,
          rewards: 1,
          capitalReturns: 0,
          firstJournalRevision: 1,
          lastJournalRevision: 4,
          createdAt: importedAt.toISOString(),
        },
      },
    });
    expect(callsOf(calls, 'INSERT INTO broker_imported_operations')[0].parameters).toEqual([
      owner,
      account,
      'uuid-5',
      [deposit.id, buy.id, fee.id, sell.id, dividend.id],
      ['uuid-6', 'uuid-8', 'uuid-8', 'uuid-10', null],
      [null, null, null, null, 'uuid-12'],
      [null, null, null, null, null],
      '2000000001',
    ]);
    expect(digest(calls)).toBe('0173e46d8c7b3afeb8b3113526de8f2e6682a0a287611dc41628aac87054ad90');
  });

  it('BROKER-CAPRET a capital return is written with its rate and payload', async () => {
    const bondBuy = operation({
      ...buy,
      id: '100000011',
      instrumentUid: bond,
      instrumentType: 'bond',
      ticker: 'SYNTHBOND',
      quantity: '1',
      payment: '-1000',
    });
    const repayment = operation({
      id: '100000012',
      type: 'OPERATION_TYPE_BOND_REPAYMENT',
      occurredAt: '2024-03-02T10:00:00Z',
      instrumentUid: bond,
      instrumentType: 'bond',
      ticker: 'SYNTHBOND',
      quantity: '1',
      payment: '400',
    });
    const { outcome, calls } = await runImport({
      operations: [deposit, bondBuy, repayment],
      positions: [position({ instrumentUid: bond, instrumentType: 'bond' }), cash('9400')],
    });
    expect(outcome).toMatchObject({ value: { created: true, value: { capitalReturns: 1 } } });
    expect(callsOf(calls, 'INSERT INTO account_capital_returns')).toHaveLength(1);
    expect(digest(calls)).toBe('d2522ba26c98ea16fcc07be05b2f9955d1ee616e397fc3f5a951712c31528ae1');
  });

  it('BROKER-ASSET-ID a link saved before its asset facts learns them from the import', async () => {
    const { outcome, calls } = await runImport(held, {
      links: [{ uid: share, assetUid: null, instrumentType: null }],
      cashInstrument: true,
    });
    expect(outcome).toMatchObject({ value: { created: true } });
    expect(callsOf(calls, 'UPDATE broker_instrument_links')[0].parameters).toEqual([
      owner,
      share,
      null,
      'share',
    ]);
    expect(callsOf(calls, 'INSERT INTO accounting_instruments')).toEqual([]);
    expect(digest(calls)).toBe('6bccd8541f6e5f4a5d514f3edc0b85b39595e008c3fb6e691739bc4cde374a42');
  });

  it('BROKER-OPENING the opening and its lots are saved before the journal starts', async () => {
    const { outcome, calls } = await runImport(
      {
        operations: [sell],
        positions: [position({ instrumentUid: share, quantity: '2' }), cash('600')],
      },
      {},
      {
        opening: {
          asOf: '2024-03-01T00:00:00.000Z',
          lots: [
            { asset: share, acquiredAt: '2024-02-01T00:00:00.000Z', quantity: '3', costUsd: '30' },
          ],
        },
      },
    );
    expect(outcome).toMatchObject({ value: { created: true } });
    expect(callsOf(calls, 'accounting.saveOpeningWithin')).toHaveLength(1);
    expect(callsOf(calls, 'carryIn.initializeWithin')).toHaveLength(1);
    expect(digest(calls)).toBe('140c8c2ac4f99089e39fb98c51eab677d2701e24520bb59365a3110b89f48444');
  });

  it('SPLIT a declared split is saved for the owner before the opening and entries', async () => {
    const { outcome, calls } = await runImport(
      {
        operations: clean,
        positions: [position({ instrumentUid: share, quantity: '3' }), cash('9645')],
      },
      {},
      { splits: [{ asset: share, effectiveAt: '2024-03-01T12:00:00.000Z', ratio: 2 }] },
    );
    expect(outcome).toMatchObject({ value: { created: true } });
    expect(callsOf(calls, 'INSERT INTO instrument_splits')).toHaveLength(1);
    expect(digest(calls)).toBe('98cb1ed6f009342aace3d485a71b21f27c6f023e7e13f955b9034b757b2d6a85');
  });

  it('BROKER-SYNC a repeated request returns its first receipt, a changed one conflicts', async () => {
    const payload = (hash: string) => JSON.stringify({ provider: 'tbank', previewHash: hash });
    const hash = (await preview(held)).previewHash;
    const replayDigests = {
      first: '4e903267a250487432d7e97a05b56f9d3e86fd323751f7db12b064fcefaff7fe',
      second: 'c94656faa1d35f21b27c2041d9ca504ef4d81536c584bf9659850872c4526eaa',
    };
    for (const at of ['first', 'second'] as const) {
      const same = await runImport(held, { earlier: { payload: payload(hash), at } });
      expect(same.outcome).toEqual({
        value: {
          created: false,
          value: {
            importId: 'uuid-1',
            accountId: account,
            requestId,
            trades: 1,
            rewards: 2,
            capitalReturns: 3,
            firstJournalRevision: 4,
            lastJournalRevision: 5,
            createdAt: importedAt.toISOString(),
          },
        },
      });
      expect(digest(same.calls)).toBe(replayDigests[at]);
      const changed = await runImport(held, { earlier: { payload: payload('0'.repeat(64)), at } });
      expect(changed.outcome).toEqual({
        error: 'ConflictException',
        message: conflict.message,
      });
      expect(changed.calls).toEqual(same.calls);
    }
  });

  it('BROKER-SYNC a stale preview, a refused history or a taken journal writes nothing', async () => {
    const stale = await runImport(held, {}, {}, '0'.repeat(64));
    expect(stale.outcome).toEqual({ error: 'ConflictException', message: conflict.message });
    expect(digest(stale.calls)).toBe(
      '21e8171cc7ea48c201a94ff955f9082dab3c61f3f784bad671fbfac40e96337a',
    );
    const refusedHistory = await runImport(held, { held: true });
    expect(refusedHistory.outcome).toEqual({
      error: 'ConflictException',
      message: conflict.message,
    });
    expect(refusedHistory.calls).toEqual(stale.calls);
    const taken = await runImport(held, { journalTaken: true });
    expect(taken.outcome).toEqual({ error: 'ConflictException', message: conflict.message });
    expect(callsOf(taken.calls, 'INSERT INTO broker_imports')).toEqual([]);
    expect(digest(taken.calls)).toBe(
      '1c3496c5ec43884b51edf84e40440a30e887a711282eea06f30c19324cd757f0',
    );
  });

  it('BROKER-ASSET-ID identities or links that disagree conflict instead of guessing', async () => {
    const twoTypes = {
      operations: clean,
      positions: [position({ instrumentUid: share, instrumentType: 'etf' }), cash('9645')],
    };
    await expect(preview(twoTypes)).rejects.toThrow(conflict);
    await expect(
      preview(held, { links: [{ uid: share, assetUid: null, instrumentType: 'bond' }] }),
    ).rejects.toThrow(conflict);
  });
});
