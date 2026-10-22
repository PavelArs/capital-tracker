import type { ConnectedLedger } from '../accounting/connected-accounting.store';
import type { FifoCarryInInput } from '../accounting/fifo';
import {
  type PortfolioAccountInput,
  type PortfolioInstrument,
  projectPortfolio,
  withoutAssets,
} from '../accounting/portfolio-valuation';
import type { ValuationInputs } from '../accounting/portfolio-valuation.service';
import { type DepositHolding, depositValuesAt } from '../deposits/deposit-valuation';
import { accountingCurrencies, FxConverter, type FxRates } from '../fx-rates/fx-conversion';
import { PortfolioSnapshotsService, valuesAt } from './portfolio-snapshots.service';
import { seriesInstants } from './snapshot-series';

// Synthetic instruments, holdings and rates only.
const rubles: PortfolioInstrument = {
  id: 'rub',
  name: 'Rubles',
  symbol: 'RUB',
  assetType: 'fiat',
  valuationCurrency: 'RUB',
  priceSource: 'fixed',
};
const bitcoin: PortfolioInstrument = {
  id: 'btc',
  name: 'Bitcoin',
  symbol: 'BTC',
  assetType: 'crypto',
  valuationCurrency: 'USD',
  priceSource: 'market',
};
const lot = (instrument: PortfolioInstrument, quantity: string, order = 0): FifoCarryInInput => ({
  lotId: `lot-${instrument.id}`,
  openingRevision: 1,
  ordinal: order + 1,
  instrumentId: instrument.id,
  instrumentName: instrument.name,
  instrumentSymbol: instrument.symbol,
  acquiredAt: '2025-06-01T00:00:00.000Z',
  orderWithinTimestamp: order,
  originalQuantity: quantity,
  originalCostUsd: '0',
  carriedQuantity: quantity,
});
function holding(lots: FifoCarryInInput[]): ValuationInputs {
  const coverageFrom = '2025-06-01T00:00:00.000Z';
  const ledger = {
    accounts: new Map([
      ['bank', { accountId: 'bank', coverageFrom, trades: [], initialLots: lots, swaps: [] }],
    ]),
    transfers: [],
    participants: new Set(),
    rewardParticipants: new Set(),
    swapParticipants: new Set(),
  } as unknown as ConnectedLedger;
  return {
    instruments: [rubles, bitcoin],
    hidden: new Set(),
    accounts: [{ accountId: 'bank', name: 'Bank', coverageFrom: new Date(coverageFrom) }],
    ledgers: new Map([['bank', ledger]]),
    chainMoves: new Map(),
    deposits: [],
  };
}
// The dollar rate stopped on 2025-06-02; the euro rate is still collected.
const rates: FxRates = {
  USD: [{ date: '2025-06-02', rubPerUnit: '80' }],
  EUR: [
    { date: '2025-06-02', rubPerUnit: '100' },
    { date: '2025-07-01', rubPerUnit: '100' },
  ],
};
const at = Date.parse('2025-07-01T12:00:00.000Z');
const prices = {
  market: new Map([
    ['BTC', { priceUsd: '100000', observedAt: '2025-07-01T11:00:00.000Z', source: 'kraken' }],
  ]),
  manual: new Map(),
};
const shown = (inputs: ValuationInputs) =>
  valuesAt(inputs, at, prices, [
    new FxConverter(rates, 'RUB'),
    new FxConverter(rates, 'EUR'),
    new FxConverter(rates, 'USD'),
  ]).map(({ currency, value, complete }) => [currency, value, complete]);

describe('a history point and a stale exchange rate', () => {
  it('FX-STALE-SNAPSHOT keeps a point that needs no stale rate', () => {
    // 1000 RUB is 1000 RUB and 10 EUR without the dollar; only the dollar value is unknown.
    expect(shown(holding([lot(rubles, '1000')]))).toEqual([
      ['RUB', expect.stringMatching(/^1000(\.0+)?$/), true],
      ['EUR', expect.stringMatching(/^10(\.0+)?$/), true],
      ['USD', null, false],
    ]);
  });

  it('FX-STALE-SNAPSHOT leaves a point missing when a held asset needs the stale rate', () => {
    // A dollar-priced coin needs the stopped dollar rate in rubles and euros.
    expect(shown(holding([lot(rubles, '1000'), lot(bitcoin, '1', 1)]))).toEqual([
      ['RUB', null, false],
      ['EUR', null, false],
      ['USD', null, false],
    ]);
  });
});

describe('a snapshot computed under an earlier valuation rule', () => {
  const OWNER = '11111111-1111-4111-8111-111111111111';
  const now = new Date('2025-03-01T00:30:00.000Z');
  const fetched = new Date('2025-03-01T00:00:00.000Z');

  // Every instant is stored under the inputs it was computed from; no price or rate is new.
  function stored(inputsRevision: string) {
    const writes: unknown[][] = [];
    const query = async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM portfolio_snapshot_state'))
        return [
          {
            inputsRevision,
            pricesFetchedThrough: fetched,
            ratesFetchedThrough: fetched,
            hourlyFrom: new Date(0),
          },
        ];
      if (sql.includes('AS revision')) return [{ revision: 'a'.repeat(32) }];
      if (sql.includes('max("fetchedAt")')) return [{ prices: fetched, rates: fetched }];
      if (sql.includes('FROM portfolio_snapshots'))
        return seriesInstants(now.getTime(), 0).flatMap((instant) =>
          accountingCurrencies.map((currency) => ({
            takenAt: new Date(instant),
            currency,
            value: '5',
            complete: true,
          })),
        );
      if (sql.includes('INSERT INTO portfolio_snapshots')) writes.push(params ?? []);
      return [];
    };
    const runner = {
      connect: async () => undefined,
      release: async () => undefined,
      startTransaction: async () => undefined,
      commitTransaction: async () => undefined,
      rollbackTransaction: async () => undefined,
      query,
      manager: { query },
    };
    const snapshots = new PortfolioSnapshotsService(
      { createQueryRunner: () => runner } as never,
      { get: () => '' } as never,
    );
    return { snapshots, writes };
  }

  it('SNAP-RULE rebuilds every stored point once when the valuation rule changes', async () => {
    // The state holds the bare inputs revision, as computed before the rule had a version.
    const { snapshots, writes } = stored('a'.repeat(32));
    const result = await snapshots.refresh(OWNER, now);
    expect(result).toMatchObject({ outcome: 'rebuilt', from: '2025-01-01T00:00:00.000Z' });
    expect(writes).toHaveLength(1);
  });
});

it('SNAP-VALUE-ONLY values holdings without recalculating their purchase costs or realized profit', () => {
  const cost = jest.fn(() => '50');
  const realized = jest.fn(() => []);
  const dollar: PortfolioInstrument = {
    id: 'usd',
    name: 'Dollar',
    symbol: 'USD',
    assetType: 'fiat',
    valuationCurrency: 'USD',
    priceSource: 'fixed',
  };
  const account = {
    accountId: 'bank',
    name: 'Bank',
    coverage: 'covered' as const,
    lots: [
      {
        instrumentId: dollar.id,
        quantity: '100',
        acquiredAt: '2025-06-01T00:00:00Z',
        get costUsd() {
          return cost();
        },
      },
    ],
    get realizations() {
      return realized();
    },
  };
  const [point] = valuesAt(
    { ...holding([]), instruments: [dollar] },
    at,
    prices,
    [new FxConverter({ USD: [], EUR: [] }, 'USD')],
    [account],
  );
  expect(point).toMatchObject({
    value: '100',
    complete: true,
    unpriced: false,
    unrated: false,
    stalePrices: 0,
  });
  expect(point.held.get(dollar.id)).toEqual({ quantity: '100', value: '100' });
  expect(cost).not.toHaveBeenCalled();
  expect(realized).not.toHaveBeenCalled();
});

it.each(accountingCurrencies)(
  'SNAP-VALUE-PARITY preserves full-portfolio value and flags in %s',
  (currency) => {
    const manual: PortfolioInstrument = {
      ...bitcoin,
      id: 'manual',
      name: 'Manual',
      symbol: null,
      assetType: 'manual',
      priceSource: 'manual',
    };
    const accounts: PortfolioAccountInput[] = [
      {
        accountId: 'bank',
        name: 'Synthetic',
        coverage: 'covered',
        lots: [rubles, bitcoin, manual].map((instrument) => ({
          instrumentId: instrument.id,
          quantity: '1.23456789',
          costUsd: null,
          acquiredAt: '2025-06-01T00:00:00Z',
        })),
        realizations: [],
      },
    ];
    const deposit: DepositHolding = {
      deposit: {
        id: 'd1',
        kind: 'account',
        name: 'Synthetic deposit',
        bank: 'Synthetic Bank',
        currency: 'EUR',
        startDate: '2025-06-01',
        endDate: null,
        payout: 'monthly',
        capitalized: false,
        dayBasis: 'actual-365',
        earlyClose: 'keeps-interest',
      },
      rates: [{ depositId: 'd1', effectiveFrom: '2025-06-01', ratePercent: '0' }],
      movements: [
        {
          id: 'm1',
          depositId: 'd1',
          occurredOn: '2025-06-01',
          kind: 'topup',
          amount: '100',
          comment: null,
        },
      ],
      checks: [],
    };
    for (const mode of [
      'normal',
      'hidden',
      'missing-price',
      'stale-price',
      'missing-rate',
      'later-history',
      'bank',
      'missing-interest',
      'unrated-bank',
    ] as const) {
      const inputs = {
        ...holding([]),
        instruments: [rubles, bitcoin, manual],
        hidden: new Set(mode === 'hidden' ? ['btc'] : []),
        deposits: ['bank', 'unrated-bank', 'missing-interest'].includes(mode)
          ? [{ ...deposit, rates: mode === 'missing-interest' ? [] : deposit.rates }]
          : [],
      };
      const visible = accounts.map((account) => ({
        ...account,
        coverage: mode === 'later-history' ? ('before-coverage' as const) : account.coverage,
      }));
      const sourcePrices = {
        market:
          mode === 'missing-price'
            ? new Map()
            : new Map([
                [
                  'BTC',
                  {
                    priceUsd: '100000',
                    observedAt:
                      mode === 'stale-price' ? '2025-06-01T00:00:00Z' : '2025-07-01T11:00:00Z',
                    source: 'kraken',
                  },
                ],
              ]),
        manual: new Map([
          [
            manual.id,
            { priceUsd: '12.3456789', observedAt: '2025-07-01T11:00:00Z', source: 'manual' },
          ],
        ]),
      };
      const fx = new FxConverter(
        ['missing-rate', 'unrated-bank'].includes(mode)
          ? { USD: [], EUR: [] }
          : {
              USD: [{ date: '2025-07-01', rubPerUnit: '80' }],
              EUR: [{ date: '2025-07-01', rubPerUnit: '100' }],
            },
        currency,
      );
      const reference = projectPortfolio(
        new Date(at),
        inputs.instruments,
        withoutAssets(visible, inputs.hidden),
        sourcePrices,
        fx,
        undefined,
        depositValuesAt(inputs.deposits, new Date(at), fx),
      );
      const rated = !reference.assets.some(
        (asset) => asset.value === null && asset.missingPrice === 'no-rate',
      );
      const [actual] = valuesAt(inputs, at, sourcePrices, [fx], visible);
      expect({
        mode,
        value: actual.value,
        complete: actual.complete,
        unpriced: actual.unpriced,
        unrated: actual.unrated,
        stalePrices: actual.stalePrices,
        held: actual.held,
      }).toEqual({
        mode,
        value: rated ? reference.pricedSubtotal : null,
        complete: rated && reference.completeness === 'complete',
        unpriced: rated && (reference.missingPriceCount > 0 || reference.unratedDepositCount > 0),
        unrated: rated && reference.unratedDepositCount > 0,
        stalePrices: reference.stalePriceCount,
        held: new Map(
          reference.assets
            .filter((asset) => asset.quantity !== '0')
            .map((asset) => [asset.instrumentId, { quantity: asset.quantity, value: asset.value }]),
        ),
      });
    }
  },
);
