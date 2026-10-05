import { FxConverter } from '../fx-rates/fx-conversion';
import {
  type ChainOperationInput,
  type OperationAsset,
  type OperationSources,
  projectOperations,
} from './operation-list';

// Synthetic ids, names and amounts only (list-all-operations, OPS-1..3).
const now = new Date('2026-10-04T12:00:00.000Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const btc: OperationAsset = { instrumentId: id(1), symbol: 'BTC', name: 'Bitcoin' };
const usdt: OperationAsset = { instrumentId: id(2), symbol: 'USDT', name: 'Tether' };
const bybit = { id: id(10), name: 'Bybit' };
const trust = { id: id(11), name: 'Trust Wallet' };
const wallet = {
  id: id(20),
  network: 'bitcoin' as const,
  address: 'bc1qsyntheticwalletaddress000000000000000',
};
const txid = (n: number) => String(n).padStart(64, 'a');

function sources(overrides: Partial<OperationSources> = {}): OperationSources {
  return {
    trades: [],
    transfers: [],
    swaps: [],
    rewards: [],
    openings: [],
    flows: [],
    chain: [],
    marketPrices: new Map(),
    ...overrides,
  };
}
const chain = (n: number, overrides: Partial<ChainOperationInput> = {}): ChainOperationInput => ({
  wallet,
  txid: txid(n),
  blockHeight: 800000 + n,
  blockTime: '2025-06-20T08:00:00.000Z',
  direction: 'in',
  receivedUnits: '918359',
  sentUnits: '0',
  feeUnits: '500',
  ...overrides,
});

describe('list-all-operations projection', () => {
  it('OPS-LIST: a manual buy, a CSV-imported buy and a chain receipt are one list with every column', () => {
    const list = projectOperations(
      now,
      sources({
        trades: [
          {
            tradeId: id(30),
            version: 1,
            account: bybit,
            asset: btc,
            side: 'buy',
            occurredAt: '2025-06-13T00:00:00.000Z',
            orderWithinTimestamp: 0,
            quantity: '0.00918359',
            grossUsd: '1000',
            feeUsd: '0',
            csv: false,
            paid: null,
            comment: 'First buy from the spreadsheet',
            settlement: null,
            purpose: null,
          },
          {
            tradeId: id(31),
            version: 1,
            account: bybit,
            asset: btc,
            side: 'buy',
            occurredAt: '2025-06-14T10:30:00.000Z',
            orderWithinTimestamp: 0,
            quantity: '0.01',
            grossUsd: '1050.5',
            feeUsd: '1.25',
            csv: true,
            paid: {
              currency: 'RUB',
              gross: '83000',
              fee: '0',
              rateDate: '2025-06-14',
              perUsd: '79',
              rateSource: 'bank-of-russia',
            },
            comment: null,
            settlement: {
              asset: { instrumentId: id(40), symbol: 'RUB', name: 'Russian ruble' },
              quantity: '0',
            },
            purpose: null,
          },
        ],
        chain: [chain(1)],
        marketPrices: new Map([
          ['BTC', { priceUsd: '84945', observedAt: '2026-10-04T11:00:00.000Z', source: 'kraken' }],
        ]),
      }),
    );
    expect(list.at).toBe(now.toISOString());
    expect(list.quoteCurrency).toBe('USD');
    expect(list.needsClassificationCount).toBe(1);
    // Newest first.
    expect(list.operations.map((operation) => operation.source)).toEqual([
      'chain',
      'csv',
      'manual',
    ]);
    const [receipt, imported, manual] = list.operations;
    expect(manual).toEqual({
      id: `trade:${id(30)}`,
      kind: 'trade',
      type: 'buy',
      direction: 'in',
      occurredAt: '2025-06-13T00:00:00.000Z',
      asset: btc,
      quantity: '0.00918359',
      counterAsset: null,
      counterQuantity: null,
      valueUsd: '1000',
      estimatedValueUsd: null,
      costBasisUsd: null,
      feeUsd: '0',
      fee: null,
      account: bybit,
      counterAccount: null,
      wallet: null,
      chain: null,
      status: 'recorded',
      source: 'manual',
      version: 1,
      paid: null,
      comment: 'First buy from the spreadsheet',
      settlement: null,
      orderWithinTimestamp: 0,
      // Without asked rates the list is in USD, exactly as recorded.
      value: '1000',
      estimatedValue: null,
      costBasis: null,
      feeValue: '0',
    });
    expect(imported).toMatchObject({
      id: `trade:${id(31)}`,
      type: 'buy',
      quantity: '0.01',
      valueUsd: '1050.5',
      feeUsd: '1.25',
      account: bybit,
      status: 'recorded',
      source: 'csv',
      paid: { currency: 'RUB', gross: '83000', perUsd: '79', rateSource: 'bank-of-russia' },
      comment: null,
      settlement: {
        asset: { instrumentId: id(40), symbol: 'RUB', name: 'Russian ruble' },
        quantity: '0',
      },
    });
    expect(receipt).toEqual({
      id: `chain:${wallet.id}:${txid(1)}`,
      kind: 'chain',
      type: null,
      direction: 'in',
      occurredAt: '2025-06-20T08:00:00.000Z',
      asset: { instrumentId: null, symbol: 'BTC', name: 'Bitcoin' },
      quantity: '0.00918359',
      counterAsset: null,
      counterQuantity: null,
      // Raw chain data has no recorded value; only an estimate at the latest stored price.
      valueUsd: null,
      estimatedValueUsd: '780.10005255',
      costBasisUsd: null,
      feeUsd: null,
      // The sender pays an incoming transaction's fee.
      fee: null,
      account: null,
      counterAccount: null,
      wallet,
      chain: { txid: txid(1), blockHeight: 800001, priceObservedAt: '2026-10-04T11:00:00.000Z' },
      status: 'needs-classification',
      source: 'chain',
      version: null,
      paid: null,
      comment: null,
      settlement: null,
      orderWithinTimestamp: 0,
      value: null,
      estimatedValue: '780.10005255',
      costBasis: null,
      feeValue: null,
    });
  });

  it('OPS-STATUS: a chain transaction without a stored price has no value, never zero', () => {
    const list = projectOperations(
      now,
      sources({
        chain: [
          chain(1, {
            direction: 'out',
            receivedUnits: '1000',
            sentUnits: '51000',
            feeUnits: '300',
          }),
          chain(2, {
            direction: 'self',
            receivedUnits: '19800',
            sentUnits: '20000',
            feeUnits: '200',
            blockTime: '2025-06-21T08:00:00.000Z',
          }),
        ],
      }),
    );
    expect(list.needsClassificationCount).toBe(2);
    const [self, out] = list.operations;
    expect(out).toMatchObject({
      direction: 'out',
      quantity: '0.0005',
      valueUsd: null,
      estimatedValueUsd: null,
      fee: { asset: { instrumentId: null, symbol: 'BTC', name: 'Bitcoin' }, quantity: '0.000003' },
      chain: { txid: txid(1), blockHeight: 800001, priceObservedAt: null },
    });
    // Moving coins between own addresses only costs the fee.
    expect(self).toMatchObject({
      direction: 'internal',
      quantity: '0.000002',
      status: 'needs-classification',
    });
  });

  it('OPS-KINDS: transfers, swaps, rewards, opening balances and declared flows keep their meaning', () => {
    const list = projectOperations(
      now,
      sources({
        transfers: [
          {
            transferId: id(40),
            version: 2,
            from: bybit,
            to: trust,
            asset: btc,
            occurredAt: '2025-07-01T00:00:00.000Z',
            orderWithinTimestamp: 0,
            quantity: '0.5',
            fee: { asset: btc, quantity: '0.0001' },
          },
        ],
        swaps: [
          {
            swapId: id(41),
            version: 1,
            account: bybit,
            outgoing: usdt,
            incoming: btc,
            occurredAt: '2025-07-02T00:00:00.000Z',
            orderWithinTimestamp: 0,
            outgoingQuantity: '1000',
            incomingQuantity: '0.01',
            considerationUsd: null,
            fee: null,
          },
        ],
        rewards: [
          {
            rewardId: id(42),
            version: 1,
            account: trust,
            asset: btc,
            category: 'staking',
            occurredAt: '2025-07-03T00:00:00.000Z',
            orderWithinTimestamp: 0,
            quantity: '0.001',
            incomeValueUsd: '90',
            acquisitionBasisUsd: null,
          },
          {
            rewardId: id(43),
            version: 1,
            account: trust,
            asset: btc,
            category: 'airdrop',
            occurredAt: '2025-07-03T00:00:00.000Z',
            orderWithinTimestamp: 1,
            quantity: '0.002',
            incomeValueUsd: null,
            acquisitionBasisUsd: '0',
          },
          {
            rewardId: id(44),
            version: 1,
            account: trust,
            asset: btc,
            category: 'unclassified',
            occurredAt: '2025-07-03T00:00:00.000Z',
            orderWithinTimestamp: 2,
            quantity: '0.003',
            incomeValueUsd: null,
            acquisitionBasisUsd: null,
          },
        ],
        openings: [
          {
            lotId: id(45),
            account: trust,
            asset: btc,
            acquiredAt: '2024-12-01T00:00:00.000Z',
            orderWithinTimestamp: 0,
            quantity: '0.2',
            costBasisUsd: '12000',
          },
        ],
        flows: [
          {
            flowId: id(46),
            version: 1,
            direction: 'withdrawal',
            occurredAt: '2025-07-04T00:00:00.000Z',
            amountUsd: '250',
          },
        ],
      }),
    );
    expect(list.needsClassificationCount).toBe(0);
    expect(
      list.operations.map((operation) => [
        operation.type,
        operation.direction,
        operation.asset.symbol,
        operation.quantity,
        operation.valueUsd,
        operation.costBasisUsd,
        operation.account?.name ?? null,
        operation.counterAccount?.name ?? null,
        operation.status,
        operation.source,
      ]),
    ).toEqual([
      ['withdrawal', 'out', 'USD', '250', '250', null, null, null, 'recorded', 'manual'],
      // Same instant: the later entry comes first.
      ['reward', 'in', 'BTC', '0.003', null, null, 'Trust Wallet', null, 'recorded', 'manual'],
      ['airdrop', 'in', 'BTC', '0.002', null, '0', 'Trust Wallet', null, 'recorded', 'manual'],
      [
        'staking-reward',
        'in',
        'BTC',
        '0.001',
        '90',
        null,
        'Trust Wallet',
        null,
        'recorded',
        'manual',
      ],
      ['swap', 'internal', 'USDT', '1000', null, null, 'Bybit', null, 'recorded', 'manual'],
      [
        'transfer',
        'internal',
        'BTC',
        '0.5',
        null,
        null,
        'Bybit',
        'Trust Wallet',
        'recorded',
        'manual',
      ],
      [
        'opening-balance',
        'in',
        'BTC',
        '0.2',
        null,
        '12000',
        'Trust Wallet',
        null,
        'recorded',
        'manual',
      ],
    ]);
    const swap = list.operations.find((operation) => operation.kind === 'swap');
    expect(swap).toMatchObject({ counterAsset: btc, counterQuantity: '0.01', version: 1 });
    const transfer = list.operations.find((operation) => operation.kind === 'transfer');
    expect(transfer).toMatchObject({ fee: { asset: btc, quantity: '0.0001' }, version: 2 });
    const opening = list.operations.find((operation) => operation.kind === 'opening');
    expect(opening).toMatchObject({ id: `opening:${id(45)}`, version: null });
  });

  it('OPS-CURRENCY: values in EUR or RUB use the Bank of Russia rate of each date; paid amounts stay exact', () => {
    const rates = {
      USD: [
        { date: '2025-06-13', rubPerUnit: '80' },
        { date: '2025-06-14', rubPerUnit: '79' },
        { date: '2026-10-03', rubPerUnit: '95' },
      ],
      EUR: [
        { date: '2025-06-13', rubPerUnit: '92' },
        { date: '2025-06-14', rubPerUnit: '90' },
        { date: '2026-10-03', rubPerUnit: '110' },
      ],
    };
    const input = sources({
      trades: [
        {
          tradeId: id(30),
          version: 1,
          account: bybit,
          asset: btc,
          side: 'buy',
          occurredAt: '2025-06-13T00:00:00.000Z',
          orderWithinTimestamp: 0,
          quantity: '0.00918359',
          grossUsd: '1000',
          feeUsd: '2.5',
          csv: false,
          paid: null,
          comment: null,
          settlement: null,
        },
        {
          tradeId: id(31),
          version: 1,
          account: bybit,
          asset: btc,
          side: 'buy',
          occurredAt: '2025-06-14T10:30:00.000Z',
          orderWithinTimestamp: 0,
          quantity: '0.01',
          grossUsd: '1050.632911392405063291139240506329',
          feeUsd: '1.265822784810126582278481012658',
          csv: false,
          paid: {
            currency: 'RUB',
            gross: '83000',
            fee: '100',
            rateDate: '2025-06-14',
            perUsd: '79',
            rateSource: 'bank-of-russia',
          },
          comment: null,
          settlement: null,
        },
      ],
      openings: [
        {
          lotId: id(45),
          account: trust,
          asset: btc,
          acquiredAt: '2024-12-01T00:00:00.000Z',
          orderWithinTimestamp: 0,
          quantity: '0.3',
          costBasisUsd: '15000',
        },
      ],
      chain: [chain(1)],
      marketPrices: new Map([
        ['BTC', { priceUsd: '84945', observedAt: '2026-10-04T11:00:00.000Z', source: 'kraken' }],
      ]),
    });
    const rub = projectOperations(now, input, new FxConverter(rates, 'RUB'));
    expect(rub.quoteCurrency).toBe('RUB');
    const values = (list: typeof rub) =>
      list.operations.map((operation) => [
        operation.kind,
        operation.value,
        operation.estimatedValue,
        operation.costBasis,
        operation.feeValue,
      ]);
    expect(values(rub)).toEqual([
      // An estimate at the latest price uses today's rate (Moscow date 2026-10-04).
      ['chain', null, '74109.50499225', null, null],
      // Paid in rubles: the amounts as paid, not a round trip through USD.
      ['trade', '83000', null, null, '100'],
      ['trade', '80000', null, null, '200'],
      // No rate is stored for that date: unknown, never zero.
      ['opening', null, null, null, null],
    ]);
    // USD amounts as recorded stay alongside.
    expect(rub.operations[2]).toMatchObject({ valueUsd: '1000', feeUsd: '2.5' });

    const eur = projectOperations(now, input, new FxConverter(rates, 'EUR'));
    expect(eur.quoteCurrency).toBe('EUR');
    expect(values(eur)).toEqual([
      [
        'chain',
        null,
        '673.722772656818181818181818181818181818181818181818181818181818',
        null,
        null,
      ],
      [
        'trade',
        '922.222222222222222222222222222222',
        null,
        null,
        '1.111111111111111111111111111111',
      ],
      [
        'trade',
        '869.565217391304347826086956521739',
        null,
        null,
        '2.173913043478260869565217391304',
      ],
      ['opening', null, null, null, null],
    ]);
  });

  it('OPS-EMPTY: no operations is an empty list', () => {
    expect(projectOperations(now, sources())).toEqual({
      at: now.toISOString(),
      quoteCurrency: 'USD',
      needsClassificationCount: 0,
      operations: [],
    });
  });
});
