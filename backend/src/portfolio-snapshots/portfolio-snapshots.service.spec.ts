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
import {
  PortfolioSnapshotsService,
  pricesAt,
  type SeriesInputs,
  tradeSeries,
  valuesAt,
} from './portfolio-snapshots.service';
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

describe('a period that starts before an asset had a price', () => {
  const day = (iso: string) => Date.parse(iso);
  const inputs = (splits: { instrumentId: string; effectiveAt: string; ratio: number }[] = []) =>
    ({
      valuation: { instruments: [], ledgers: new Map([['ledger', { splits }]]) },
      market: new Map(),
      trades: new Map(),
      manual: new Map([
        [
          'asset-1',
          [
            { at: day('2026-10-15T00:00:00Z'), price: '120', source: 'manual' },
            { at: day('2026-10-18T06:00:00Z'), price: '150', source: 'manual' },
          ],
        ],
      ]),
    }) as unknown as SeriesInputs;

  it('DASH-START-ESTIMATE takes the first later price only when asked', () => {
    const start = day('2026-10-12T00:00:00Z');
    expect(pricesAt(inputs(), start).manual.get('asset-1')).toBeUndefined();
    expect(pricesAt(inputs(), start, true).manual.get('asset-1')).toMatchObject({
      priceUsd: '120',
      observedAt: '2026-10-15T00:00:00.000Z',
    });
  });

  it('DASH-START-ESTIMATE keeps the latest earlier price when one exists', () => {
    expect(
      pricesAt(inputs(), day('2026-10-16T00:00:00Z'), true).manual.get('asset-1'),
    ).toMatchObject({ priceUsd: '120' });
  });

  it('DASH-START-ESTIMATE makes no estimate across a share split', () => {
    const split = [{ instrumentId: 'asset-1', effectiveAt: '2026-10-14T00:00:00.000Z', ratio: 2 }];
    expect(
      pricesAt(inputs(split), day('2026-10-12T00:00:00Z'), true).manual.get('asset-1'),
    ).toBeUndefined();
  });
});

describe('DASH-TRADE-ESTIMATE an asset without a stored price takes its own trade prices', () => {
  const day = (iso: string) => Date.parse(iso);
  const bond = { id: 'bond-1', name: 'Bond', symbol: null, priceSource: 'manual' };
  const trade = (at: string) => ({ at: day(at), price: '1000', source: 'trade', currency: 'RUB' });
  const inputs = (manual = new Map<string, unknown[]>()) =>
    ({
      valuation: { instruments: [bond], ledgers: new Map([['ledger', { splits: [] }]]) },
      market: new Map(),
      manual,
      trades: new Map([['bond-1', [trade('2026-09-20T10:00:00Z'), trade('2026-10-07T15:39:00Z')]]]),
    }) as unknown as SeriesInputs;

  it('DASH-TRADE-ESTIMATE values a never-priced asset at its latest trade, only when asked', () => {
    const start = day('2026-10-03T00:00:00Z');
    expect(pricesAt(inputs(), start).manual.get('bond-1')).toBeUndefined();
    expect(pricesAt(inputs(), start, true).manual.get('bond-1')).toEqual({
      priceUsd: '1000',
      observedAt: '2026-09-20T10:00:00.000Z',
      source: 'trade',
      currency: 'RUB',
    });
  });

  it('DASH-TRADE-ESTIMATE takes the first later trade or price when none comes before', () => {
    const stored = new Map([
      ['bond-1', [{ at: day('2026-10-15T00:00:00Z'), price: '1050', source: 'tbank' }]],
    ]);
    expect(
      pricesAt(inputs(stored), day('2026-09-01T00:00:00Z'), true).manual.get('bond-1'),
    ).toMatchObject({ priceUsd: '1000', observedAt: '2026-09-20T10:00:00.000Z', source: 'trade' });
  });

  it('DASH-TRADE-ESTIMATE prefers an earlier trade to a later stored price, and a stored one to a trade', () => {
    const later = new Map([
      ['bond-1', [{ at: day('2026-10-15T00:00:00Z'), price: '1050', source: 'tbank' }]],
    ]);
    expect(
      pricesAt(inputs(later), day('2026-10-03T00:00:00Z'), true).manual.get('bond-1'),
    ).toMatchObject({ observedAt: '2026-09-20T10:00:00.000Z', source: 'trade' });
    const earlier = new Map([
      ['bond-1', [{ at: day('2026-09-25T00:00:00Z'), price: '990', source: 'tbank' }]],
    ]);
    expect(
      pricesAt(inputs(earlier), day('2026-10-03T00:00:00Z'), true).manual.get('bond-1'),
    ).toMatchObject({ priceUsd: '990', source: 'tbank' });
  });

  it('DASH-TRADE-ESTIMATE prices a market coin with no stored price from a trade of either asset with its symbol', () => {
    const coin = (id: string) => ({ id, name: 'Tether', symbol: 'usdt', priceSource: 'market' });
    const market = {
      valuation: {
        instruments: [coin('usdt-tron'), coin('usdt-eth')],
        ledgers: new Map([['ledger', { splits: [] }]]),
      },
      market: new Map(),
      manual: new Map(),
      trades: new Map([
        [
          'usdt-eth',
          [{ at: day('2026-09-20T10:00:00Z'), price: '1', source: 'trade', currency: 'USD' }],
        ],
      ]),
    } as unknown as SeriesInputs;
    expect(pricesAt(market, day('2026-10-03T00:00:00Z'), true).market.get('USDT')).toMatchObject({
      priceUsd: '1',
      source: 'trade',
    });
  });

  it('DASH-TRADE-ESTIMATE takes no later trade across a share split', () => {
    const split = {
      ...inputs(),
      valuation: {
        instruments: [bond],
        ledgers: new Map([
          [
            'ledger',
            {
              splits: [
                { instrumentId: 'bond-1', effectiveAt: '2026-09-10T00:00:00.000Z', ratio: 2 },
              ],
            },
          ],
        ]),
      },
    } as unknown as SeriesInputs;
    expect(pricesAt(split, day('2026-09-01T00:00:00Z'), true).manual.get('bond-1')).toBeUndefined();
  });

  it('DASH-TRADE-ESTIMATE reads a price from each buy or sale as paid, and none from other entries', () => {
    const entry = (over: Record<string, unknown>) => ({
      instrumentId: 'bond-1',
      side: 'buy',
      occurredAt: '2026-09-20T10:00:00.000Z',
      quantity: '7',
      grossUsd: '81.66',
      ...over,
    });
    const valuation = {
      ledgers: new Map([
        [
          'ledger',
          {
            accounts: new Map([
              [
                'account',
                {
                  trades: [
                    entry({ paid: { currency: 'RUB', gross: '7000' } }),
                    entry({
                      side: 'sell',
                      occurredAt: '2026-10-07T15:39:00.000Z',
                      quantity: '3',
                      grossUsd: '1',
                    }),
                    entry({ purpose: 'income', occurredAt: '2026-10-08T00:00:00.000Z' }),
                    entry({ grossUsd: '0', occurredAt: '2026-10-09T00:00:00.000Z' }),
                  ],
                },
              ],
            ]),
          },
        ],
      ]),
    } as unknown as ValuationInputs;
    expect(tradeSeries(valuation).get('bond-1')).toEqual([
      { at: day('2026-09-20T10:00:00Z'), price: '1000', source: 'trade', currency: 'RUB' },
      {
        at: day('2026-10-07T15:39:00Z'),
        price: '0.333333333333333333333333333333',
        source: 'trade',
        currency: 'USD',
      },
    ]);
  });
});
