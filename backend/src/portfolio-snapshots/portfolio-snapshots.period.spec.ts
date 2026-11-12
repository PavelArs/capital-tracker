import { createHash } from 'node:crypto';
import type { ConnectedLedger } from '../accounting/connected-accounting.store';
import type { FifoCarryInInput } from '../accounting/fifo';
import type { PortfolioInstrument, PortfolioPrices } from '../accounting/portfolio-valuation';
import type { ValuationInputs } from '../accounting/portfolio-valuation.service';
import * as valuationService from '../accounting/portfolio-valuation.service';
import { PortfolioSnapshotsService } from './portfolio-snapshots.service';

// Characterization of how a chart period is read: every statement and read in order, and the
// whole result, for each branch of the read. Synthetic instruments, holdings and rates only.
const owner = '00000000-0000-4000-8000-000000000001';
const now = new Date('2025-07-01T12:00:00.000Z');
const coverageFrom = '2025-06-01T00:00:00.000Z';

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
  lotId: `lot-${instrument.id}-${order}`,
  openingRevision: 1,
  ordinal: order + 1,
  instrumentId: instrument.id,
  instrumentName: instrument.name,
  instrumentSymbol: instrument.symbol,
  acquiredAt: coverageFrom,
  orderWithinTimestamp: order,
  originalQuantity: quantity,
  originalCostUsd: '0',
  carriedQuantity: quantity,
});
const ledger = (accountId: string, lots: FifoCarryInInput[]) =>
  ({
    accounts: new Map([
      [accountId, { accountId, coverageFrom, trades: [], initialLots: lots, swaps: [] }],
    ]),
    transfers: [],
    splits: [],
    participants: new Set(),
    rewardParticipants: new Set(),
    swapParticipants: new Set(),
  }) as unknown as ConnectedLedger;

/** A wallet holding rubles and a coin, and a broker account holding rubles only. */
const everything: ValuationInputs = {
  instruments: [rubles, bitcoin],
  hidden: new Set(),
  accounts: [
    { accountId: 'wallet', name: 'Wallet', coverageFrom: new Date(coverageFrom) },
    {
      accountId: 'broker',
      name: 'Broker',
      assetClass: 'broker',
      coverageFrom: new Date(coverageFrom),
    },
  ],
  ledgers: new Map([
    ['wallet', ledger('wallet', [lot(rubles, '1000'), lot(bitcoin, '1', 1)])],
    ['broker', ledger('broker', [lot(rubles, '500')])],
  ]),
  chainMoves: new Map(),
  deposits: [],
};

const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let at = Date.parse(from); at <= Date.parse(to); at += 86_400_000)
    out.push(new Date(at).toISOString().slice(0, 10));
  return out;
};

interface World {
  /** The first day each rate is stored, through the day of `now`. */
  ratesFrom?: string;
  /** Whether the latest prices now price the coin. */
  coinPricedNow?: boolean;
  /** Stored coin prices, by instant. */
  coinPrices?: string[];
  /** Stored snapshots: instant and whether it was complete. */
  snapshots?: [string, boolean][];
}

interface Call {
  sql: string;
  parameters: unknown[];
}

function run(world: World, query: Record<string, unknown>, everyPoint: boolean) {
  const calls: Call[] = [];
  const rates = days(world.ratesFrom ?? '2025-05-20', '2025-07-01').flatMap((rateDate) => [
    { currency: 'EUR', rateDate, rubPerUnit: '90' },
    { currency: 'USD', rateDate, rubPerUnit: '80' },
  ]);
  const manager = {
    query: async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters });
      if (sql.includes('FROM owner_settings')) return [{ mainCurrency: 'RUB' }];
      if (sql.includes('FROM fx_rates')) return rates;
      if (sql.includes('FROM portfolio_snapshots'))
        return (world.snapshots ?? []).map(([at, complete]) => ({
          takenAt: new Date(at),
          value: '1000',
          complete,
        }));
      if (sql.includes('FROM price_observations')) {
        const until = parameters[3] as Date | null | undefined;
        return (world.coinPrices ?? [])
          .map((at) => ({
            asset: 'BTC',
            observedAt: new Date(at),
            price: '100000',
            source: 'kraken',
            kind: 'spot',
          }))
          .filter((row) => !until || row.observedAt <= until);
      }
      return [];
    },
  };
  const latest: PortfolioPrices = {
    market: new Map(
      world.coinPricedNow
        ? [['BTC', { priceUsd: '100000', observedAt: now.toISOString(), source: 'kraken' }]]
        : [],
    ),
    manual: new Map(),
    splits: [],
  };
  jest.spyOn(valuationService, 'readValuationInputs').mockImplementation(async (_m, ...rest) => {
    calls.push({ sql: 'readValuationInputs', parameters: rest });
    return everything;
  });
  jest.spyOn(valuationService, 'latestPortfolioPrices').mockImplementation(async (_m, ...rest) => {
    calls.push({ sql: 'latestPortfolioPrices', parameters: rest });
    return latest;
  });
  const service = new PortfolioSnapshotsService({} as never, {} as never) as unknown as {
    period: (...args: unknown[]) => Promise<unknown>;
  };
  return service
    .period(
      manager,
      owner,
      { period: '1M', currency: null, section: null, ...query },
      now,
      everyPoint,
    )
    .then((result) => ({ calls, result: plain(result) }));
}

/** Maps, sets and atoms as JSON can compare them. */
const plain = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (_key, item) => {
      if (item instanceof Map) return { map: [...item] };
      if (item instanceof Set) return { set: [...item] };
      if (typeof item === 'bigint') return `${item}n`;
      return item;
    }),
  );
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const kinds = (calls: readonly Call[]) =>
  calls.map((call) => call.sql.trim().split(/\s+/).slice(0, 6).join(' '));

const midnights: [string, boolean][] = [
  ['2025-06-10T00:00:00.000Z', true],
  ['2025-06-20T00:00:00.000Z', true],
  ['2025-06-30T00:00:00.000Z', true],
];

afterEach(() => jest.restoreAllMocks());

describe('DASH-CHART characterization of a period read', () => {
  it('DASH-CHART a fully priced period reads the stored points and the value now only', async () => {
    const { calls, result } = await run({ coinPricedNow: true, snapshots: midnights }, {}, true);
    expect(kinds(calls)).toEqual([
      'SELECT "mainCurrency" FROM owner_settings WHERE "ownerId"',
      'SELECT "takenAt", value::text AS value, complete',
      'readValuationInputs',
      'latestPortfolioPrices',
      'SELECT currency, to_char("rateDate", \'YYYY-MM-DD\') AS "rateDate",',
    ]);
    expect(result).toMatchObject({ currency: 'RUB', startEstimatedAssetCount: 0 });
    expect(digest({ calls, result })).toBe(
      'e6ff1be5b4bb2a1bc34c815b37600ef5eb8a641a4db424dab8af123f33e25f04',
    );
  });

  it('DASH-START-ESTIMATE an incomplete first point is read again, then estimated from a later price', async () => {
    const { calls, result } = await run(
      {
        coinPricedNow: true,
        coinPrices: ['2025-06-25T00:00:00.000Z'],
        snapshots: [['2025-06-10T00:00:00.000Z', false], ...midnights.slice(1)],
      },
      {},
      false,
    );
    expect(result).toMatchObject({ startEstimatedAssetCount: 1 });
    expect(digest({ calls, result })).toBe(
      '271d32f31f6773c34eef80410a5cb73d93a5e04cbff8021fab7afafb424157bf',
    );
  });

  it('DASH-CHART a coin without a price now is left out of every point valued again', async () => {
    const { calls, result } = await run({ snapshots: midnights }, {}, true);
    expect(result).toMatchObject({ scope: { excluded: { set: ['btc'] } } });
    expect(digest({ calls, result })).toBe(
      '5a27b1a0383324e4fd21e938cd29af766cd8fd25fa0273cd6c50572bddacb428',
    );
  });

  it('DASH-CHART without every point, points are valued again up to the first with a value', async () => {
    const { calls, result } = await run(
      { ratesFrom: '2025-06-25', snapshots: midnights },
      { currency: 'USD' },
      false,
    );
    expect(result).toMatchObject({ currency: 'USD' });
    expect(digest({ calls, result })).toBe(
      'bafef96ac4fde230f10d9beea0bf0d85e3a82b8c8a3f21baf5cdc1f9270a99f2',
    );
  });

  it('SECTION-CHART one section values its own accounts only, at every point', async () => {
    const { calls, result } = await run(
      { coinPricedNow: true, snapshots: midnights },
      { section: 'broker' },
      true,
    );
    expect(result).toMatchObject({ transfersAcross: 0 });
    expect(digest({ calls, result })).toBe(
      '911bb977ae5936505c72ecbb17f0088b6fdf9ca44f1722a47d726650ca2b9806',
    );
  });

  it('SECTION-CHART one section without every point stops at its first valued point', async () => {
    const { calls, result } = await run(
      { coinPricedNow: true, snapshots: midnights },
      { section: 'wallet' },
      false,
    );
    expect(digest({ calls, result })).toBe(
      'a273e6f201e994d29819f5cb4f2d40e924b221c3bfb6c3d3e8dc0558722c4377',
    );
  });
});
