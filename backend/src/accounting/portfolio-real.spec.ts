import type { InflationFactor } from '../inflation/inflation-math';
import { realReadings } from './portfolio-real';
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
});
