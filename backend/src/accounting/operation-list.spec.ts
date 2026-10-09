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
  label: null,
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
  account: null,
  txid: txid(n),
  asset: null,
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
          [
            'BTC',
            [{ priceUsd: '84945', observedAt: '2025-06-20T07:00:00.000Z', source: 'kraken' }],
          ],
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
      counterWallet: null,
      chain: null,
      status: 'recorded',
      source: 'manual',
      version: 1,
      paid: null,
      comment: 'First buy from the spreadsheet',
      settlement: null,
      classification: null,
      pool: null,
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
      // Raw chain data has no recorded value; only an estimate at the price stored for its time.
      valueUsd: null,
      estimatedValueUsd: '780.10005255',
      costBasisUsd: null,
      feeUsd: null,
      // The sender pays an incoming transaction's fee.
      fee: null,
      account: null,
      counterAccount: null,
      wallet,
      counterWallet: null,
      chain: {
        txid: txid(1),
        blockHeight: 800001,
        priceObservedAt: '2025-06-20T07:00:00.000Z',
        direction: 'in',
        pairedTxid: null,
      },
      status: 'needs-classification',
      source: 'chain',
      version: null,
      paid: null,
      comment: null,
      settlement: null,
      classification: null,
      pool: null,
      orderWithinTimestamp: 0,
      value: null,
      estimatedValue: '780.10005255',
      costBasis: null,
      feeValue: null,
    });
  });

  it('ETH-IDENTITY: an Ethereum hash lists its ether fee and its USDC transfer apart (M14)', () => {
    const ethereumWallet = {
      id: id(21),
      network: 'ethereum' as const,
      address: `0x${'a1'.repeat(20)}`,
      label: null,
    };
    const list = projectOperations(
      now,
      sources({
        chain: [
          chain(3, {
            wallet: ethereumWallet,
            direction: 'out',
            receivedUnits: '0',
            sentUnits: '420000000000000',
            feeUnits: '420000000000000',
          }),
          chain(3, {
            wallet: ethereumWallet,
            txid: `${txid(3)}-17`,
            asset: 'USDC',
            direction: 'out',
            receivedUnits: '0',
            sentUnits: '250000000',
            feeUnits: '0',
          }),
        ],
        marketPrices: new Map([
          ['USDC', [{ priceUsd: '1', observedAt: '2025-06-20T07:00:00.000Z', source: 'kraken' }]],
        ]),
      }),
    );
    expect(list.needsClassificationCount).toBe(2);
    const [fee, usdc] = [...list.operations].sort((left, right) => left.id.localeCompare(right.id));
    expect(fee).toMatchObject({
      id: `chain:${id(21)}:${txid(3)}`,
      asset: { instrumentId: null, symbol: 'ETH', name: 'Ethereum' },
      quantity: '0.00042',
      fee: { asset: { symbol: 'ETH' }, quantity: '0.00042' },
      estimatedValueUsd: null,
    });
    expect(usdc).toMatchObject({
      id: `chain:${id(21)}:${txid(3)}-17`,
      asset: { instrumentId: null, symbol: 'USDC', name: 'USD Coin' },
      quantity: '250',
      fee: null,
      estimatedValueUsd: '250',
      chain: { txid: `${txid(3)}-17`, priceObservedAt: '2025-06-20T07:00:00.000Z' },
    });
  });

  it('SOL-STAKE-MOVE: SOL moved into an own stake account or back lists as Stake or Unstake', () => {
    const solanaWallet = {
      id: id(22),
      network: 'solana' as const,
      address: 'So1anaSyntheticWa11etAddress111111111111111',
      label: null,
    };
    const list = projectOperations(
      now,
      sources({
        chain: [
          // 10 SOL into a stake account plus the 0.000005 SOL fee.
          chain(4, {
            wallet: solanaWallet,
            account: trust,
            direction: 'out',
            receivedUnits: '0',
            sentUnits: '10000005000',
            feeUnits: '5000',
            stakeUnits: '10000000000',
          }),
          // 10.04 SOL back from it, the fee paid out of what arrived.
          chain(5, {
            wallet: solanaWallet,
            account: trust,
            direction: 'in',
            receivedUnits: '10039995000',
            sentUnits: '0',
            feeUnits: '5000',
            stakeUnits: '-10040000000',
            blockTime: '2025-07-20T08:00:00.000Z',
          }),
          // An answer the owner gave before stays theirs.
          chain(6, {
            wallet: solanaWallet,
            account: trust,
            direction: 'out',
            receivedUnits: '0',
            sentUnits: '1000005000',
            feeUnits: '5000',
            stakeUnits: '1000000000',
            blockTime: '2025-08-20T08:00:00.000Z',
            classification: {
              version: 1,
              status: 'hidden',
              type: null,
              details: null,
              comment: null,
              produced: null,
            },
          }),
        ],
        marketPrices: new Map([
          ['SOL', [{ priceUsd: '150', observedAt: '2025-06-20T07:00:00.000Z', source: 'kraken' }]],
        ]),
      }),
    );
    expect(list.needsClassificationCount).toBe(0);
    const [hidden, unstake, stake] = list.operations;
    expect(stake).toMatchObject({
      type: 'stake',
      direction: 'internal',
      status: 'recorded',
      asset: { symbol: 'SOL' },
      quantity: '10',
      estimatedValueUsd: '1500',
      fee: { asset: { symbol: 'SOL' }, quantity: '0.000005' },
      account: trust,
      chain: { direction: 'out' },
    });
    expect(unstake).toMatchObject({
      type: 'unstake',
      direction: 'internal',
      status: 'recorded',
      quantity: '10.04',
      fee: { asset: { symbol: 'SOL' }, quantity: '0.000005' },
    });
    expect(hidden).toMatchObject({ type: null, status: 'hidden' });
  });

  it('EST-AT-TIME: a chain transaction is valued at the price stored for its time, not the latest', () => {
    const price = (priceUsd: string, observedAt: string) => ({
      priceUsd,
      observedAt,
      source: 'kraken',
    });
    const list = projectOperations(
      now,
      sources({
        chain: [
          // 0.01 BTC on 2025-06-20 08:00 and on 2025-09-01 12:30.
          chain(1, { receivedUnits: '1000000', feeUnits: '0' }),
          chain(2, {
            receivedUnits: '1000000',
            feeUnits: '0',
            blockTime: '2025-09-01T12:30:00.000Z',
          }),
          // Nothing stored within two days before it: unknown, never another day's price.
          chain(3, {
            receivedUnits: '1000000',
            feeUnits: '0',
            blockTime: '2025-08-01T12:00:00.000Z',
          }),
        ],
        marketPrices: new Map([
          [
            'BTC',
            [
              price('60000', '2025-06-19T08:00:00.000Z'),
              price('61000', '2025-06-20T08:00:00.000Z'),
              // After the transaction: not yet known at its time.
              price('62000', '2025-06-20T09:00:00.000Z'),
              price('70000', '2025-09-01T12:00:00.000Z'),
              price('70500', '2025-09-01T13:00:00.000Z'),
              price('99000', '2025-07-29T23:00:00.000Z'),
              // Today's price must not value any of them.
              price('120000', '2026-10-04T11:00:00.000Z'),
            ],
          ],
        ]),
      }),
    );
    const byTxid = new Map(list.operations.map((operation) => [operation.chain?.txid, operation]));
    expect(byTxid.get(txid(1))).toMatchObject({
      estimatedValueUsd: '610',
      estimatedValue: '610',
      chain: { priceObservedAt: '2025-06-20T08:00:00.000Z' },
    });
    expect(byTxid.get(txid(2))).toMatchObject({
      estimatedValueUsd: '700',
      chain: { priceObservedAt: '2025-09-01T12:00:00.000Z' },
    });
    expect(byTxid.get(txid(3))).toMatchObject({
      estimatedValueUsd: null,
      estimatedValue: null,
      chain: { priceObservedAt: null },
    });
  });

  it('EST-AT-TIME: dust is judged at the price stored for the time of the receipt', () => {
    const list = projectOperations(
      now,
      sources({
        dustThresholdUsd: '1',
        // 546 sat: 0.546 USD at 100,000 then, 1.092 USD at today's 200,000.
        chain: [chain(1, { receivedUnits: '546', feeUnits: '0' })],
        marketPrices: new Map([
          [
            'BTC',
            [
              { priceUsd: '100000', observedAt: '2025-06-20T07:00:00.000Z', source: 'kraken' },
              { priceUsd: '200000', observedAt: '2026-10-04T11:00:00.000Z', source: 'kraken' },
            ],
          ],
        ]),
      }),
    );
    expect(list.operations[0]).toMatchObject({ status: 'dust', estimatedValueUsd: '0.546' });
    expect(list.needsClassificationCount).toBe(0);
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
        { date: '2025-06-20', rubPerUnit: '78' },
        { date: '2026-10-03', rubPerUnit: '95' },
      ],
      EUR: [
        { date: '2025-06-13', rubPerUnit: '92' },
        { date: '2025-06-14', rubPerUnit: '90' },
        { date: '2025-06-20', rubPerUnit: '91' },
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
        ['BTC', [{ priceUsd: '84945', observedAt: '2025-06-20T07:00:00.000Z', source: 'kraken' }]],
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
      // EST-AT-TIME: an estimate uses the rate of its own Moscow date (2025-06-20), not today's.
      ['chain', null, '60847.8040989', null, null],
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
      ['chain', null, '668.6571879', null, null],
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

  it('CLS-BUY: a classified receipt reads as the buy it produced, listed once, out of the count', () => {
    const tradeId = id(50);
    const list = projectOperations(
      now,
      sources({
        trades: [
          {
            tradeId,
            version: 1,
            account: trust,
            asset: btc,
            side: 'buy',
            occurredAt: '2025-06-20T08:00:00.000Z',
            orderWithinTimestamp: 2,
            quantity: '0.00918359',
            grossUsd: '1000',
            feeUsd: '0',
            csv: false,
            paid: null,
            comment: 'From the exchange',
            settlement: { asset: usdt, quantity: '0' },
            purpose: null,
          },
        ],
        chain: [
          chain(1, {
            classification: {
              version: 1,
              status: 'classified',
              type: 'buy',
              details: { type: 'buy', currency: 'USDT', amount: '1000' },
              comment: 'From the exchange',
              produced: { kind: 'trade', id: tradeId },
            },
          }),
          chain(2),
        ],
      }),
    );
    expect(list.needsClassificationCount).toBe(1);
    expect(list.operations.map((operation) => operation.id)).toEqual([
      `chain:${wallet.id}:${txid(1)}`,
      `chain:${wallet.id}:${txid(2)}`,
    ]);
    expect(list.operations[0]).toMatchObject({
      kind: 'chain',
      type: 'buy',
      status: 'recorded',
      source: 'chain',
      quantity: '0.00918359',
      valueUsd: '1000',
      value: '1000',
      account: trust,
      wallet,
      comment: 'From the exchange',
      settlement: { asset: usdt, quantity: '0' },
      orderWithinTimestamp: 2,
      classification: {
        version: 1,
        hidden: false,
        value: { type: 'buy', currency: 'USDT', amount: '1000' },
        comment: 'From the exchange',
        automatic: false,
      },
    });
  });

  it('CLS-HIDE: a hidden transaction stays listed as hidden and leaves the count', () => {
    const list = projectOperations(
      now,
      sources({
        chain: [
          chain(1, {
            classification: {
              version: 2,
              status: 'hidden',
              type: null,
              details: null,
              comment: 'Dust',
              produced: null,
            },
          }),
        ],
      }),
    );
    expect(list.needsClassificationCount).toBe(0);
    expect(list.operations[0]).toMatchObject({
      type: null,
      status: 'hidden',
      valueUsd: null,
      account: null,
      comment: 'Dust',
      classification: { version: 2, hidden: true, value: null, comment: 'Dust' },
    });
  });

  it('CLS-DUST: an unanswered receipt worth less than the threshold is dust, out of the count', () => {
    const prices = new Map([
      ['BTC', [{ priceUsd: '100000', observedAt: '2025-06-20T07:00:00.000Z', source: 'kraken' }]],
    ]);
    const list = projectOperations(
      now,
      sources({
        dustThresholdUsd: '1',
        marketPrices: prices,
        chain: [
          // 546 sat at 100,000 USD: 0.546 USD.
          chain(1, { receivedUnits: '546', feeUnits: '0' }),
          // Exactly 1 USD is not below the threshold.
          chain(2, { receivedUnits: '1000', feeUnits: '0' }),
          // What the owner sent always asks, however small.
          chain(3, { direction: 'out', receivedUnits: '0', sentUnits: '546', feeUnits: '100' }),
          // Once answered, the answer stands.
          chain(4, {
            receivedUnits: '546',
            classification: {
              version: 1,
              status: 'classified',
              type: 'other',
              details: { type: 'other' },
              comment: null,
              produced: null,
            },
          }),
          chain(5, {
            receivedUnits: '546',
            classification: {
              version: 2,
              status: 'hidden',
              type: null,
              details: null,
              comment: null,
              produced: null,
            },
          }),
          // Sent back to "Needs classification" by hand: below the threshold it is dust again.
          chain(6, {
            receivedUnits: '546',
            classification: {
              version: 2,
              status: 'unclassified',
              type: null,
              details: null,
              comment: null,
              produced: null,
            },
          }),
        ],
      }),
    );
    const status = (n: number) =>
      list.operations.find((operation) => operation.chain?.txid === txid(n))?.status;
    expect(list.dustThresholdUsd).toBe('1');
    expect(status(1)).toBe('dust');
    expect(status(2)).toBe('needs-classification');
    expect(status(3)).toBe('needs-classification');
    expect(status(4)).toBe('recorded');
    expect(status(5)).toBe('hidden');
    expect(status(6)).toBe('dust');
    expect(list.needsClassificationCount).toBe(2);
    // The dust row keeps every raw fact and its estimate; only its status differs.
    expect(list.operations.find((operation) => operation.chain?.txid === txid(1))).toMatchObject({
      kind: 'chain',
      type: null,
      direction: 'in',
      quantity: '0.00000546',
      estimatedValueUsd: '0.546',
      classification: null,
    });
  });

  it('CLS-DUST: without a threshold or a price nothing is dust', () => {
    const off = projectOperations(now, sources({ chain: [chain(1, { receivedUnits: '1' })] }));
    expect(off.dustThresholdUsd).toBeNull();
    expect(off.operations[0].status).toBe('needs-classification');
    const unpriced = projectOperations(
      now,
      sources({ dustThresholdUsd: '1', chain: [chain(1, { receivedUnits: '1' })] }),
    );
    expect(unpriced.operations[0].status).toBe('needs-classification');
    expect(unpriced.needsClassificationCount).toBe(1);
  });

  it('CLS-OTHER: an outgoing Other is recorded with no entry, no value and out of the count', () => {
    const list = projectOperations(
      now,
      sources({
        chain: [
          chain(1, {
            direction: 'out',
            receivedUnits: '0',
            sentUnits: '60300',
            feeUnits: '300',
            classification: {
              version: 1,
              status: 'classified',
              type: 'other',
              details: { type: 'other' },
              comment: 'Lost card',
              produced: null,
            },
          }),
        ],
      }),
    );
    expect(list.needsClassificationCount).toBe(0);
    expect(list.operations[0]).toMatchObject({
      type: 'other',
      status: 'recorded',
      direction: 'out',
      quantity: '0.000603',
      valueUsd: null,
      costBasisUsd: null,
      comment: 'Lost card',
      classification: { version: 1, hidden: false, value: { type: 'other' } },
    });
  });

  it('CLS-RESYNC: an answer whose entry was voided elsewhere needs classification again', () => {
    const list = projectOperations(
      now,
      sources({
        chain: [
          chain(1, {
            classification: {
              version: 1,
              status: 'classified',
              type: 'income',
              details: { type: 'income', valueUsd: '700' },
              comment: null,
              produced: { kind: 'trade', id: id(51) },
            },
          }),
        ],
      }),
    );
    expect(list.needsClassificationCount).toBe(1);
    expect(list.operations[0]).toMatchObject({ type: null, status: 'needs-classification' });
  });

  // XFER-AUTO: wallet A sends 0.5 BTC to the owner's wallet B with a 0.0001 BTC fee.
  const walletB = { ...wallet, id: id(21), address: 'bc1qsyntheticwalletaddressb00000000000000' };
  const sending = (classification: ChainOperationInput['classification']) =>
    chain(3, {
      account: bybit,
      direction: 'out',
      receivedUnits: '0',
      sentUnits: '50010000',
      feeUnits: '10000',
      classification,
    });
  const receiving = (classification: ChainOperationInput['classification']) =>
    chain(3, {
      wallet: walletB,
      account: trust,
      receivedUnits: '50000000',
      feeUnits: '10000',
      classification,
    });
  const transferId = id(60);
  const linked = (linkedAddressId: string) => ({
    version: 1,
    status: 'classified' as const,
    type: 'transfer' as const,
    details: {
      type: 'transfer' as const,
      accountId: linkedAddressId === walletB.id ? trust.id : bybit.id,
    },
    comment: null,
    produced: { kind: 'transfer' as const, id: transferId },
    linkedAddressId,
    automatic: true,
  });

  it('XFER-AUTO: a linked pair is one transfer A → B with the fee, listed once', () => {
    const list = projectOperations(
      now,
      sources({
        transfers: [
          {
            transferId,
            version: 1,
            from: bybit,
            to: trust,
            asset: btc,
            occurredAt: '2025-06-20T08:00:00.000Z',
            orderWithinTimestamp: 1,
            quantity: '0.5',
            fee: { asset: btc, quantity: '0.0001' },
          },
        ],
        chain: [sending(linked(walletB.id)), receiving(linked(wallet.id))],
        marketPrices: new Map([
          [
            'BTC',
            [{ priceUsd: '60000', observedAt: '2025-06-20T07:00:00.000Z', source: 'kraken' }],
          ],
        ]),
      }),
    );
    expect(list.needsClassificationCount).toBe(0);
    expect(list.operations.map((operation) => operation.id)).toEqual([
      `chain:${wallet.id}:${txid(3)}`,
    ]);
    expect(list.operations[0]).toMatchObject({
      kind: 'chain',
      type: 'transfer',
      direction: 'internal',
      status: 'recorded',
      quantity: '0.5',
      estimatedValueUsd: '30000',
      fee: { asset: btc, quantity: '0.0001' },
      account: bybit,
      counterAccount: trust,
      wallet,
      counterWallet: walletB,
      chain: { direction: 'out' },
      classification: { automatic: true, value: { type: 'transfer', accountId: trust.id } },
    });
  });

  it('XFER-UNKNOWN: a send with no own address on the other side stays to classify', () => {
    const list = projectOperations(now, sources({ chain: [sending(null)] }));
    expect(list.needsClassificationCount).toBe(1);
    expect(list.operations[0]).toMatchObject({
      status: 'needs-classification',
      counterAccount: null,
      counterWallet: null,
    });
  });

  it('XFER-AUTO: an unanswered pair suggests the other wallet and its account', () => {
    const list = projectOperations(now, sources({ chain: [sending(null), receiving(null)] }));
    expect(list.needsClassificationCount).toBe(2);
    const sent = list.operations.find((operation) => operation.wallet?.id === wallet.id);
    expect(sent).toMatchObject({ counterAccount: trust, counterWallet: walletB });
  });

  describe('CLS-SWAP', () => {
    // Trust Wallet paid 1000 USDT from its Ethereum address for 0.0125 BTC at its Bitcoin one.
    const ethWallet = {
      id: id(22),
      network: 'ethereum' as const,
      address: '0x00000000000000000000000000000000000000aa',
      label: 'Main',
    };
    const swapId = id(60);
    const carryId = id(61);
    const usdtTxid = `${'d'.repeat(64)}-3`;
    const swapped = (pairWith: { addressId: string; txid: string }, carried: string | null) => ({
      version: 1,
      status: 'classified' as const,
      type: 'swap' as const,
      details: { type: 'swap' as const, with: pairWith, valueUsd: null },
      comment: null,
      produced: { kind: 'swap' as const, id: swapId },
      carryTransferId: carried,
      paired: pairWith,
    });
    const paid = (account = trust, carried: string | null = null) =>
      chain(5, {
        wallet: ethWallet,
        account,
        txid: usdtTxid,
        asset: 'USDT',
        blockTime: '2026-09-01T10:00:00.000Z',
        direction: 'out',
        receivedUnits: '0',
        sentUnits: '1000000000',
        feeUnits: '0',
        classification: swapped({ addressId: wallet.id, txid: txid(6) }, carried),
      });
    const bought = (account = trust, carried: string | null = null) =>
      chain(6, {
        account,
        blockTime: '2026-09-01T10:40:00.000Z',
        direction: 'in',
        receivedUnits: '1250000',
        sentUnits: '0',
        feeUnits: '1400',
        classification: swapped({ addressId: ethWallet.id, txid: usdtTxid }, carried),
      });
    const swap = (account = trust) => ({
      swapId,
      version: 1,
      account,
      outgoing: usdt,
      incoming: btc,
      occurredAt: '2026-09-01T10:40:00.000Z',
      orderWithinTimestamp: 0,
      outgoingQuantity: '1000',
      incomingQuantity: '0.0125',
      considerationUsd: '1000',
      fee: null,
    });

    it('CLS-SWAP-SAME: the two sides are one swap USDT → BTC on the receiving row, listed once', () => {
      const list = projectOperations(now, sources({ swaps: [swap()], chain: [paid(), bought()] }));
      expect(list.needsClassificationCount).toBe(0);
      expect(list.operations.map((operation) => operation.id)).toEqual([
        `chain:${wallet.id}:${txid(6)}`,
      ]);
      expect(list.operations[0]).toMatchObject({
        kind: 'chain',
        type: 'swap',
        direction: 'internal',
        status: 'recorded',
        asset: usdt,
        quantity: '1000',
        counterAsset: btc,
        counterQuantity: '0.0125',
        valueUsd: '1000',
        costBasisUsd: '1000',
        estimatedValueUsd: null,
        fee: null,
        account: trust,
        counterAccount: null,
        wallet,
        counterWallet: ethWallet,
        chain: { txid: txid(6), direction: 'in', pairedTxid: usdtTxid },
        classification: {
          value: { type: 'swap', with: { addressId: ethWallet.id, txid: usdtTxid } },
        },
      });
    });

    it('CLS-SWAP-CROSS: paid from another wallet, the carrying transfer is not listed apart', () => {
      const list = projectOperations(
        now,
        sources({
          swaps: [swap(bybit)],
          transfers: [
            {
              transferId: carryId,
              version: 1,
              from: trust,
              to: bybit,
              asset: usdt,
              occurredAt: '2026-09-01T10:00:00.000Z',
              orderWithinTimestamp: 0,
              quantity: '1000',
              fee: null,
            },
          ],
          chain: [paid(trust, carryId), bought(bybit, carryId)],
        }),
      );
      expect(list.operations.map((operation) => operation.id)).toEqual([
        `chain:${wallet.id}:${txid(6)}`,
      ]);
      expect(list.operations[0]).toMatchObject({
        type: 'swap',
        account: bybit,
        counterAccount: trust,
        counterWallet: ethWallet,
      });
    });

    it('CLS-SWAP-SAME: a paying leg in the network coin shows its network fee', () => {
      const ether = chain(7, {
        wallet: ethWallet,
        account: trust,
        txid: 'e'.repeat(64),
        blockTime: '2026-09-01T10:00:00.000Z',
        direction: 'out',
        receivedUnits: '0',
        sentUnits: '502000000000000000',
        feeUnits: '2000000000000000',
        classification: swapped({ addressId: wallet.id, txid: txid(6) }, null),
      });
      const receipt = bought();
      const list = projectOperations(
        now,
        sources({
          swaps: [
            { ...swap(), outgoing: { instrumentId: id(3), symbol: 'ETH', name: 'Ethereum' } },
          ],
          chain: [
            ether,
            {
              ...receipt,
              classification: swapped({ addressId: ethWallet.id, txid: 'e'.repeat(64) }, null),
            },
          ],
        }),
      );
      expect(list.operations).toHaveLength(1);
      expect(list.operations[0].fee).toEqual({
        asset: { instrumentId: null, symbol: 'ETH', name: 'Ethereum' },
        quantity: '0.002',
      });
    });
  });

  describe('POOL-*', () => {
    // Trust Wallet's Ethereum address put 1 ETH (fee 0.001 ETH) and 3000 USDC into a pool and
    // got 0.9 ETH (fee 0.0005 ETH) and 3400 USDC back.
    const ethWallet = {
      id: id(23),
      network: 'ethereum' as const,
      address: '0x00000000000000000000000000000000000000bb',
      label: null,
    };
    const ether = { instrumentId: null, symbol: 'ETH', name: 'Ethereum' };
    const rewardId = id(70);
    const depositTxid = 'f'.repeat(64);
    const withdrawalTxid = 'e'.repeat(64);
    const answered = (type: 'pool-deposit' | 'pool-withdrawal', txid: string | null) => ({
      version: 1,
      status: 'classified' as const,
      type,
      details:
        type === 'pool-deposit'
          ? { type }
          : { type, deposit: { addressId: ethWallet.id, txid: txid! }, valueUsd: null },
      comment: null,
      produced: null,
      paired: txid ? { addressId: ethWallet.id, txid } : null,
    });
    const leg = (overrides: Partial<ChainOperationInput>) =>
      chain(7, { wallet: ethWallet, account: trust, ...overrides });
    const ethDeposit = leg({
      txid: depositTxid,
      blockTime: '2026-08-10T10:00:00.000Z',
      direction: 'out',
      receivedUnits: '0',
      sentUnits: '1001000000000000000',
      feeUnits: '1000000000000000',
      classification: answered('pool-deposit', null),
    });
    const usdcDeposit = leg({
      txid: `${depositTxid}-4`,
      asset: 'USDC',
      blockTime: '2026-08-10T10:00:00.000Z',
      direction: 'out',
      receivedUnits: '0',
      sentUnits: '3000000000',
      feeUnits: '0',
      classification: answered('pool-deposit', null),
    });
    const ethBack = leg({
      txid: withdrawalTxid,
      blockTime: '2026-09-01T10:00:00.000Z',
      direction: 'in',
      receivedUnits: '900000000000000000',
      sentUnits: '500000000000000',
      feeUnits: '500000000000000',
      classification: answered('pool-withdrawal', depositTxid),
    });
    const usdcBack = leg({
      txid: `${withdrawalTxid}-3`,
      asset: 'USDC',
      blockTime: '2026-09-01T10:00:00.000Z',
      direction: 'in',
      receivedUnits: '3400000000',
      sentUnits: '0',
      feeUnits: '0',
      classification: {
        ...answered('pool-withdrawal', `${depositTxid}-4`),
        produced: { kind: 'reward' as const, id: rewardId },
      },
    });
    const gain = {
      rewardId,
      version: 1,
      account: trust,
      asset: { instrumentId: id(4), symbol: 'USDC', name: 'USD Coin' },
      category: 'other' as const,
      occurredAt: '2026-09-01T10:00:00.000Z',
      orderWithinTimestamp: 2,
      quantity: '400',
      incomeValueUsd: '400',
      acquisitionBasisUsd: '400',
    };

    it('POOL-DEPOSIT: each leg is a pool deposit of its principal, the fee apart, out of the count', () => {
      const list = projectOperations(now, sources({ chain: [ethDeposit, usdcDeposit] }));
      expect(list.needsClassificationCount).toBe(0);
      const [eth, usdc] = list.operations;
      expect(eth).toMatchObject({
        type: 'pool-deposit',
        direction: 'internal',
        status: 'recorded',
        asset: ether,
        quantity: '1',
        valueUsd: null,
        fee: { asset: ether, quantity: '0.001' },
        chain: { txid: depositTxid, direction: 'out', pairedTxid: null },
        pool: null,
      });
      expect(usdc).toMatchObject({ type: 'pool-deposit', quantity: '3000', fee: null });
    });

    it('POOL-WITHDRAW: a withdrawal shows what came back, its deposit and the difference', () => {
      const list = projectOperations(
        now,
        sources({ rewards: [gain], chain: [ethDeposit, usdcDeposit, ethBack, usdcBack] }),
      );
      expect(list.operations).toHaveLength(4);
      const usdc = list.operations.find((item) => item.chain?.txid === `${withdrawalTxid}-3`);
      expect(usdc).toMatchObject({
        type: 'pool-withdrawal',
        direction: 'internal',
        status: 'recorded',
        quantity: '3400',
        valueUsd: '400',
        costBasisUsd: '400',
        chain: { direction: 'in', pairedTxid: `${depositTxid}-4` },
        pool: { deposited: '3000', difference: '400' },
        orderWithinTimestamp: 2,
      });
      const eth = list.operations.find((item) => item.chain?.txid === withdrawalTxid);
      expect(eth).toMatchObject({
        quantity: '0.9',
        valueUsd: null,
        fee: { asset: ether, quantity: '0.0005' },
        pool: { deposited: '1', difference: '-0.1' },
      });
    });

    it('POOL-REWARD: a pool reward reads as the income it produced', () => {
      const reward = leg({
        txid: `${'c'.repeat(64)}-2`,
        asset: 'USDC',
        receivedUnits: '25000000',
        sentUnits: '0',
        feeUnits: '0',
        classification: {
          version: 1,
          status: 'classified',
          type: 'pool-reward',
          details: { type: 'pool-reward', valueUsd: '25' },
          comment: null,
          produced: { kind: 'reward', id: rewardId },
        },
      });
      const list = projectOperations(
        now,
        sources({ rewards: [{ ...gain, quantity: '25', incomeValueUsd: '25' }], chain: [reward] }),
      );
      expect(list.operations).toHaveLength(1);
      expect(list.operations[0]).toMatchObject({
        type: 'pool-reward',
        status: 'recorded',
        direction: 'in',
        valueUsd: '25',
      });
    });
  });

  describe('TOKEN-CHAIN', () => {
    // The same ticker exists on several blockchains, so a token always names its own.
    const ethereumWallet = {
      id: id(23),
      network: 'ethereum' as const,
      address: `0x${'b2'.repeat(20)}`,
      label: null,
    };
    const solanaWallet = {
      id: id(24),
      network: 'solana' as const,
      address: 'So1Synthetic1111111111111111111111111111111',
      label: null,
    };

    it('TOKEN-CHAIN-LEG: a token leg names its blockchain, the network coin does not', () => {
      const list = projectOperations(
        now,
        sources({
          chain: [
            chain(8, {
              wallet: ethereumWallet,
              txid: `${txid(8)}-4`,
              asset: 'USDT',
              receivedUnits: '1000000000',
              feeUnits: '0',
            }),
            chain(9, {
              wallet: solanaWallet,
              asset: 'USDT',
              receivedUnits: '1000000000',
              feeUnits: '0',
            }),
            chain(10, {
              wallet: ethereumWallet,
              direction: 'out',
              receivedUnits: '0',
              sentUnits: '420000000000000',
              feeUnits: '420000000000000',
            }),
          ],
        }),
      );
      const byId = new Map(list.operations.map((operation) => [operation.id, operation]));
      expect(byId.get(`chain:${id(23)}:${txid(8)}-4`)?.asset).toEqual({
        instrumentId: null,
        symbol: 'USDT',
        name: 'Tether',
        network: 'ethereum',
      });
      expect(byId.get(`chain:${id(24)}:${txid(9)}`)?.asset).toEqual({
        instrumentId: null,
        symbol: 'USDT',
        name: 'Tether',
        network: 'solana',
      });
      const ether = byId.get(`chain:${id(23)}:${txid(10)}`);
      expect(ether?.asset).toEqual({ instrumentId: null, symbol: 'ETH', name: 'Ethereum' });
      expect(ether?.fee?.asset).toEqual({ instrumentId: null, symbol: 'ETH', name: 'Ethereum' });
    });

    it('TOKEN-CHAIN-EXCHANGE: a coin held on an exchange names no blockchain', () => {
      const exchange = { id: id(25), network: 'bybit' as const, address: 'sub-1', label: null };
      const list = projectOperations(
        now,
        sources({
          chain: [
            chain(13, {
              wallet: exchange,
              txid: 'deposit-13',
              asset: 'USDT',
              receivedUnits: '1000000000000000000000',
              feeUnits: '0',
            }),
          ],
        }),
      );
      expect(list.operations[0].asset).not.toHaveProperty('network');
    });

    it('TOKEN-CHAIN-SWAP: a swap row names the blockchain of each token it moved', () => {
      const swapId = id(62);
      const paidTxid = `${'c'.repeat(64)}-2`;
      const answer = (pairWith: { addressId: string; txid: string }) => ({
        version: 1,
        status: 'classified' as const,
        type: 'swap' as const,
        details: { type: 'swap' as const, with: pairWith, valueUsd: null },
        comment: null,
        produced: { kind: 'swap' as const, id: swapId },
        carryTransferId: null,
        paired: pairWith,
      });
      const list = projectOperations(
        now,
        sources({
          swaps: [
            {
              swapId,
              version: 1,
              account: trust,
              outgoing: usdt,
              incoming: { instrumentId: id(4), symbol: 'USDC', name: 'USD Coin' },
              occurredAt: '2026-09-01T10:40:00.000Z',
              orderWithinTimestamp: 0,
              outgoingQuantity: '500',
              incomingQuantity: '499.5',
              considerationUsd: '500',
              fee: null,
            },
          ],
          chain: [
            chain(11, {
              wallet: ethereumWallet,
              account: trust,
              txid: paidTxid,
              asset: 'USDT',
              direction: 'out',
              receivedUnits: '0',
              sentUnits: '500000000',
              feeUnits: '0',
              classification: answer({ addressId: solanaWallet.id, txid: txid(12) }),
            }),
            chain(12, {
              wallet: solanaWallet,
              account: trust,
              asset: 'USDC',
              receivedUnits: '499500000',
              feeUnits: '0',
              classification: answer({ addressId: ethereumWallet.id, txid: paidTxid }),
            }),
          ],
        }),
      );
      expect(list.operations).toHaveLength(1);
      expect(list.operations[0]).toMatchObject({
        type: 'swap',
        asset: { ...usdt, network: 'ethereum' },
        counterAsset: { instrumentId: id(4), symbol: 'USDC', name: 'USD Coin', network: 'solana' },
      });
    });
  });

  describe('SWAP-ONE-TX', () => {
    // A DEX swap: the owner's transaction calls a contract that takes one coin and returns
    // another in the same transaction, so its two legs are the two sides of one swap.
    const ethereumWallet = {
      id: id(26),
      network: 'ethereum' as const,
      address: `0x${'c3'.repeat(20)}`,
      label: null,
    };
    const hash = 'e'.repeat(64);
    const call = { method: 'swapExactETHForTokens' };
    const ether = (overrides: Partial<ChainOperationInput> = {}) =>
      chain(14, {
        wallet: ethereumWallet,
        account: trust,
        txid: hash,
        blockTime: '2026-09-03T10:00:00.000Z',
        direction: 'out',
        receivedUnits: '0',
        sentUnits: '502000000000000000',
        feeUnits: '2000000000000000',
        call,
        ...overrides,
      });
    const token = (asset: string, index: number, overrides: Partial<ChainOperationInput> = {}) =>
      chain(14, {
        wallet: ethereumWallet,
        account: trust,
        txid: `${hash}-${index}`,
        asset,
        blockTime: '2026-09-03T10:00:00.000Z',
        receivedUnits: '1500000000',
        sentUnits: '0',
        feeUnits: '0',
        ...overrides,
      });
    const byId = (rows: ChainOperationInput[]) =>
      new Map(
        projectOperations(now, sources({ chain: rows })).operations.map((operation) => [
          operation.id,
          operation,
        ]),
      );

    it('SWAP-ONE-TX-SUGGEST: ether paid to a contract and a token back are suggested as one swap', () => {
      const list = byId([ether(), token('USDC', 7)]);
      expect(list.get(`chain:${id(26)}:${hash}-7`)?.chain).toMatchObject({
        swapWith: { addressId: id(26), txid: hash },
        call,
      });
      expect(list.get(`chain:${id(26)}:${hash}`)?.chain).toMatchObject({
        swapWith: { addressId: id(26), txid: `${hash}-7` },
        call,
      });
    });

    it('SWAP-ONE-TX-SUGGEST: a token for a token skips the leg that only paid the network fee', () => {
      const list = byId([
        ether({ sentUnits: '2000000000000000' }),
        token('USDT', 3, { direction: 'out', receivedUnits: '0', sentUnits: '1500000000' }),
        token('USDC', 9, { receivedUnits: '1499000000' }),
      ]);
      expect(list.get(`chain:${id(26)}:${hash}-9`)?.chain?.swapWith).toEqual({
        addressId: id(26),
        txid: `${hash}-3`,
      });
      expect(list.get(`chain:${id(26)}:${hash}-3`)?.chain?.swapWith).toEqual({
        addressId: id(26),
        txid: `${hash}-9`,
      });
      expect(list.get(`chain:${id(26)}:${hash}`)?.chain).not.toHaveProperty('swapWith');
      // The token legs are part of the contract call the ether leg made.
      expect(list.get(`chain:${id(26)}:${hash}-9`)?.chain?.call).toEqual(call);
    });

    it('SWAP-ONE-TX-SUGGEST: no suggestion when the other side is not one leg, or is answered', () => {
      const twoBack = byId([ether(), token('USDC', 7), token('USDT', 8)]);
      expect(twoBack.get(`chain:${id(26)}:${hash}`)?.chain).not.toHaveProperty('swapWith');
      const answered = byId([
        ether({
          classification: {
            version: 1,
            status: 'classified',
            type: 'other',
            details: { type: 'other' },
            comment: null,
            produced: null,
          },
        }),
        token('USDC', 7),
      ]);
      expect(answered.get(`chain:${id(26)}:${hash}-7`)?.chain).not.toHaveProperty('swapWith');
      // The same coin both ways is no swap.
      const same = byId([ether(), ether({ txid: `${hash}-1`, direction: 'in' })]);
      expect(same.get(`chain:${id(26)}:${hash}`)?.chain).not.toHaveProperty('swapWith');
    });

    it('SWAP-ONE-TX-SUGGEST: a liquidity pool deposit or withdrawal suggests no swap', () => {
      // POOL-DEPOSIT: ether and USDC both go into the pool (its pool token is not synced);
      // POOL-WITHDRAW: both come back. Neither moves one coin each way.
      const deposit = byId([
        ether({ sentUnits: '1002000000000000000' }),
        token('USDC', 4, { direction: 'out', receivedUnits: '0', sentUnits: '3000000000' }),
      ]);
      const withdrawal = byId([
        ether({ direction: 'in', receivedUnits: '900000000000000000', sentUnits: '0' }),
        token('USDC', 4, { receivedUnits: '3400000000' }),
      ]);
      for (const list of [deposit, withdrawal])
        for (const leg of [hash, `${hash}-4`])
          expect(list.get(`chain:${id(26)}:${leg}`)?.chain).not.toHaveProperty('swapWith');
      // The contract call is still named.
      expect(deposit.get(`chain:${id(26)}:${hash}-4`)?.chain?.call).toEqual(call);
    });

    it('SWAP-ONE-TX-SUGGEST: a Solana program swap of SOL for USDC is suggested the same way', () => {
      const solanaWallet = {
        id: id(27),
        network: 'solana' as const,
        address: 'So1Synthetic2222222222222222222222222222222',
        label: null,
      };
      const signature = '5'.repeat(88);
      const list = byId([
        chain(15, {
          wallet: solanaWallet,
          txid: signature,
          direction: 'out',
          receivedUnits: '0',
          sentUnits: '2000005000',
          feeUnits: '5000',
        }),
        chain(15, {
          wallet: solanaWallet,
          txid: `${signature}-2`,
          asset: 'USDC',
          receivedUnits: '300000000',
          feeUnits: '0',
        }),
      ]);
      expect(list.get(`chain:${id(27)}:${signature}-2`)?.chain?.swapWith).toEqual({
        addressId: id(27),
        txid: signature,
      });
      expect(list.get(`chain:${id(27)}:${signature}-2`)?.chain).not.toHaveProperty('call');
    });
  });

  it('OPS-EMPTY: no operations is an empty list', () => {
    expect(projectOperations(now, sources())).toEqual({
      at: now.toISOString(),
      quoteCurrency: 'USD',
      needsClassificationCount: 0,
      dustThresholdUsd: null,
      operations: [],
    });
  });

  it('WAL-ACCOUNT: a chain transaction of an address bound to a wallet shows that wallet', () => {
    const named = { ...wallet, label: 'Savings' };
    const list = projectOperations(
      now,
      sources({
        chain: [chain(1, { wallet: named, account: trust }), chain(2)],
        marketPrices: new Map(),
      }),
    );
    const [first, second] = [...list.operations].sort((a, b) => a.id.localeCompare(b.id));
    expect([first.account, first.wallet, first.status]).toEqual([
      trust,
      named,
      'needs-classification',
    ]);
    expect([second.account, second.wallet]).toEqual([null, wallet]);
  });
});
