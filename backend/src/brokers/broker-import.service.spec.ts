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
}

function build(
  history: { operations: TBankOperation[]; positions?: TBankPosition[] },
  world: World,
) {
  const query = async (sql: string, parameters: unknown[] = []) => {
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
  return new BrokerImportService(
    source as unknown as DataSource,
    connections as unknown as BrokerConnectionsService,
    {} as AccountingService,
    {} as CarryInService,
  );
}

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
