import type { InflationFactor } from '../inflation/inflation-math';
import { lotsAfterInflation, realReadings } from './portfolio-real';
import { type PortfolioAccountInput, type PortfolioLot, usdOnly } from './portfolio-valuation';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const lot = (
  n: number,
  quantity: string,
  costUsd: string | null,
  acquiredAt: string,
): PortfolioLot => ({
  instrumentId: id(n),
  quantity,
  costUsd,
  acquiredAt,
  purchase: true,
});
const account = (lots: PortfolioLot[]): PortfolioAccountInput => ({
  accountId: id(100),
  name: 'Wallet',
  coverage: 'covered',
  lots,
  realizations: [],
});
// 1.5 for a lot of the first year, 1.1 for the next one, none before 2025.
const factor = (day: string): InflationFactor | null =>
  day < '2025-01-01'
    ? null
    : day < '2026-01-01'
      ? { factor: 1.5, estimated: false }
      : { factor: 1.1, estimated: true };

describe('real portfolio readings (INFL-REAL-PF)', () => {
  const fx = usdOnly();

  it('INFL-REAL-PF-ASSET carries each lot by the inflation since its day', () => {
    const accounts = [
      account([
        lot(1, '1', '100', '2025-01-10T09:00:00.000Z'),
        lot(1, '2', '200', '2026-01-10T09:00:00.000Z'),
      ]),
    ];
    const { byAsset, total } = realReadings(
      [{ instrumentId: id(1), value: '400' }],
      accounts,
      fx,
      factor,
    );
    // 100 x 1.5 + 200 x 1.1 = 370 in today's money, so 30 over it.
    expect(byAsset.get(id(1))).toEqual({
      costBasis: '370',
      unrealizedPnl: '30',
      unrealizedReturnPercent: '8.11',
      estimated: true,
    });
    expect(total).toEqual(byAsset.get(id(1)));
  });

  it('INFL-REAL-PF-UNKNOWN is unknown when a lot has no cost or no factor', () => {
    const noCost = realReadings(
      [{ instrumentId: id(1), value: '400' }],
      [account([lot(1, '1', null, '2025-03-10T09:00:00.000Z')])],
      fx,
      factor,
    );
    expect(noCost.byAsset.get(id(1))).toBeNull();
    expect(noCost.total).toBeNull();
    const early = realReadings(
      [{ instrumentId: id(1), value: '400' }],
      [account([lot(1, '1', '100', '2024-03-10T09:00:00.000Z')])],
      fx,
      factor,
    );
    expect(early.byAsset.get(id(1))).toBeNull();
    expect(early.total).toBeNull();
  });

  it('INFL-REAL-PF-NO-PRICE keeps the cost and leaves the profit unknown without a price', () => {
    const result = realReadings(
      [{ instrumentId: id(1), value: null }],
      [account([lot(1, '1', '100', '2025-03-10T09:00:00.000Z')])],
      fx,
      factor,
    );
    expect(result.byAsset.get(id(1))).toEqual({
      costBasis: '150',
      unrealizedPnl: null,
      unrealizedReturnPercent: null,
      estimated: false,
    });
    expect(result.total).toEqual({
      costBasis: '150',
      unrealizedPnl: null,
      unrealizedReturnPercent: null,
      estimated: false,
    });
  });

  it('INFL-REAL-PF-TOTAL sums the held assets and skips what is not held', () => {
    const result = realReadings(
      [
        { instrumentId: id(1), value: '300' },
        { instrumentId: id(2), value: '50' },
        { instrumentId: id(3), value: '0' },
      ],
      [
        account([
          lot(1, '1', '100', '2025-03-10T09:00:00.000Z'),
          lot(2, '1', '40', '2026-03-10T09:00:00.000Z'),
          lot(3, '0', '0', '2025-03-10T09:00:00.000Z'),
        ]),
      ],
      fx,
      factor,
    );
    expect(result.byAsset.has(id(3))).toBe(false);
    // 150 + 44 = 194 paid in today's money, 350 worth of it: 156 over.
    expect(result.total).toEqual({
      costBasis: '194',
      unrealizedPnl: '156',
      unrealizedReturnPercent: '80.41',
      estimated: true,
    });
  });

  it('INFL-REAL-PF-UNAVAILABLE has no total while an account before its coverage hides holdings', () => {
    const result = realReadings(
      [{ instrumentId: id(1), value: '300' }],
      [account([lot(1, '1', '100', '2025-03-10T09:00:00.000Z')])],
      fx,
      factor,
      false,
    );
    // The covered asset is still read; only the whole-portfolio figure would be partial.
    expect(result.byAsset.get(id(1))?.costBasis).toBe('150');
    expect(result.total).toBeNull();
  });
});

describe('lots after inflation (INFL-REAL-LOTS)', () => {
  const fx = usdOnly();
  const lots = [
    lot(1, '1', '100', '2025-01-10T09:00:00.000Z'),
    lot(1, '2', '200', '2026-01-10T09:00:00.000Z'),
  ];
  const rows = (
    options: {
      lots?: PortfolioLot[];
      price?: string | null;
      personal?: ((day: string) => InflationFactor | null) | null;
    } = {},
  ) =>
    lotsAfterInflation({
      instrumentId: id(1),
      accounts: [account(options.lots ?? lots)],
      fx,
      price: options.price === undefined ? '200' : options.price,
      official: factor,
      personal: options.personal ?? null,
    });

  it('INFL-REAL-LOTS-ROW reads each purchase on its own, newest first', () => {
    const [newest, oldest] = rows();
    expect(newest).toEqual({
      accountId: id(100),
      accountName: 'Wallet',
      acquiredAt: '2026-01-10T09:00:00.000Z',
      quantity: '2',
      paid: '200',
      value: '400',
      nominalPnl: '200',
      real: {
        official: {
          inflationPercent: '10.00',
          costBasis: '220',
          unrealizedPnl: '180',
          unrealizedReturnPercent: '81.82',
          estimated: true,
        },
        personal: {
          inflationPercent: '10.00',
          costBasis: '220',
          unrealizedPnl: '180',
          unrealizedReturnPercent: '81.82',
          estimated: true,
          ownRate: false,
        },
      },
    });
    expect(oldest.paid).toBe('100');
    expect(oldest.value).toBe('200');
    expect(oldest.nominalPnl).toBe('100');
    expect(oldest.real.official).toEqual({
      inflationPercent: '50.00',
      costBasis: '150',
      unrealizedPnl: '50',
      unrealizedReturnPercent: '33.33',
      estimated: false,
    });
  });

  it('INFL-REAL-LOTS-OWN-RATE reads the owner own rate beside the official one', () => {
    const [newest] = rows({ personal: () => ({ factor: 2, estimated: true }) });
    expect(newest.real.personal).toEqual({
      inflationPercent: '100.00',
      costBasis: '400',
      unrealizedPnl: '0',
      unrealizedReturnPercent: '0.00',
      estimated: true,
      ownRate: true,
    });
    expect(newest.real.official?.costBasis).toBe('220');
  });

  it('INFL-REAL-LOTS-UNKNOWN leaves a lot without a cost or a factor unread, not the others', () => {
    const result = rows({
      lots: [
        lot(1, '1', null, '2025-03-10T09:00:00.000Z'),
        lot(1, '1', '100', '2024-03-10T09:00:00.000Z'),
        lot(1, '1', '100', '2025-06-10T09:00:00.000Z'),
      ],
    });
    // Newest first: the readable lot, the lot with no cost, the lot before the inflation history.
    expect(result.map((row) => row.real.official?.costBasis ?? null)).toEqual(['150', null, null]);
    expect(result[1].paid).toBeNull();
    expect(result[1].nominalPnl).toBeNull();
    expect(result[1].value).toBe('200');
    expect(result[2].paid).toBe('100');
    expect(result[2].real.personal).toBeNull();
  });

  it('INFL-REAL-LOTS-NO-PRICE keeps the cost in today money and leaves the profit unknown', () => {
    const [newest] = rows({ price: null });
    expect(newest.value).toBeNull();
    expect(newest.nominalPnl).toBeNull();
    expect(newest.real.official).toEqual({
      inflationPercent: '10.00',
      costBasis: '220',
      unrealizedPnl: null,
      unrealizedReturnPercent: null,
      estimated: true,
    });
  });

  it('INFL-REAL-LOTS-PURCHASE leaves out a lot that is not a purchase, such as a reward', () => {
    const reward: PortfolioLot = {
      ...lot(1, '1', '100', '2025-03-10T09:00:00.000Z'),
      purchase: undefined,
    };
    expect(rows({ lots: [reward] })).toEqual([]);
  });

  it('INFL-REAL-LOTS-SKIP leaves out empty lots and other assets', () => {
    const result = rows({
      lots: [
        lot(1, '0', '0', '2025-03-10T09:00:00.000Z'),
        lot(2, '1', '100', '2025-03-10T09:00:00.000Z'),
        lot(1, '1', '100', '2025-03-10T09:00:00.000Z'),
      ],
    });
    expect(result).toHaveLength(1);
  });
});
