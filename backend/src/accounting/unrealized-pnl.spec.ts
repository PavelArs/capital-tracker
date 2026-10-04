import type { HistoricalPosition } from './historical-accounting';
import { type PortfolioAccount, projectManualPortfolioValue } from './manual-portfolio-valuation';
import { formatPercent, formatSignedProduct } from './money';

const at = '2025-01-04T00:00:00.000Z';
const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const third = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const btc = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const eth = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const sol = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const price = (instrumentId: string, priceUsd: string) => ({
  instrumentId,
  priceUsd,
  observedAt: at,
  revision: 1,
});
const position = (
  instrumentId: string,
  quantity: string,
  costUsd: string | null,
  unknown?: { knownCostSubtotalUsd: string; unknownCostQuantity: string },
): HistoricalPosition => ({
  instrumentId,
  instrumentName: 'Tracked token',
  instrumentSymbol: 'SAME',
  quantity,
  costUsd,
  ...unknown,
});
const covered = (accountId: string, positions: HistoricalPosition[]): PortfolioAccount => ({
  accountId,
  name: 'Wallet',
  coverage: 'covered',
  coverageFrom: '2025-01-01T00:00:00.000Z',
  journalRevision: 1,
  positions,
});

describe('UPNL-EXCEL owner spreadsheet row', () => {
  it('reports the exact difference and rounded return for a priced known-cost purchase', () => {
    const result = projectManualPortfolioValue(
      [covered(first, [position(btc, '0.00918359', '1000')])],
      [price(btc, '84945')],
    );
    expect(result.accounts[0]).toMatchObject({
      totalValueUsd: '780.10005255',
      unknownCostCount: 0,
      unrealizedPnlUsd: '-219.89994745',
      unrealizedReturnPercent: '-21.99',
      items: [
        {
          instrumentId: btc,
          costUsd: '1000',
          valueUsd: '780.10005255',
          unrealizedPnlUsd: '-219.89994745',
          unrealizedReturnPercent: '-21.99',
        },
      ],
    });
    expect(result).toMatchObject({
      unknownCostCount: 0,
      unrealizedPnlUsd: '-219.89994745',
      unrealizedReturnPercent: '-21.99',
    });
  });
});

describe('UPNL-GAPS missing price, unknown cost and zero cost', () => {
  it('returns null rather than guessing and keeps known zero cost distinct', () => {
    const result = projectManualPortfolioValue(
      [
        covered(first, [
          position(btc, '1', '100'),
          position(eth, '1', null, { knownCostSubtotalUsd: '10', unknownCostQuantity: '0.5' }),
          position(sol, '2', '0'),
        ]),
      ],
      [price(eth, '50'), price(sol, '5')],
    );
    expect(result.accounts[0]).toMatchObject({
      missingPriceCount: 1,
      unknownCostCount: 1,
      unrealizedPnlUsd: null,
      unrealizedReturnPercent: null,
      items: [
        {
          instrumentId: btc,
          valueUsd: null,
          unrealizedPnlUsd: null,
          unrealizedReturnPercent: null,
        },
        {
          instrumentId: eth,
          valueUsd: '50',
          unrealizedPnlUsd: null,
          unrealizedReturnPercent: null,
        },
        {
          instrumentId: sol,
          valueUsd: '10',
          unrealizedPnlUsd: '10',
          unrealizedReturnPercent: null,
        },
      ],
    });
    expect(result).toMatchObject({
      unknownCostCount: 1,
      unrealizedPnlUsd: null,
      unrealizedReturnPercent: null,
    });
  });

  it('reports zero result and no return for an account without positions', () => {
    const result = projectManualPortfolioValue([covered(first, [])], []);
    expect(result.accounts[0]).toMatchObject({
      unknownCostCount: 0,
      unrealizedPnlUsd: '0',
      unrealizedReturnPercent: null,
    });
  });
});

describe('UPNL-PORTFOLIO selected aggregate across accounts', () => {
  const half = covered(first, [position(btc, '0.5', '50')]);
  const double = covered(second, [position(btc, '2', '200')]);

  it('sums exact results per account and for the selection', () => {
    const result = projectManualPortfolioValue([half, double], [price(btc, '123.456')]);
    expect(result.accounts).toMatchObject([
      { unrealizedPnlUsd: '11.728', unrealizedReturnPercent: '23.46' },
      { unrealizedPnlUsd: '46.912', unrealizedReturnPercent: '23.46' },
    ]);
    expect(result).toMatchObject({
      unknownCostCount: 0,
      unrealizedPnlUsd: '58.64',
      unrealizedReturnPercent: '23.46',
    });
  });

  it('withholds the aggregate when an account is unpriced or has no history', () => {
    const unpriced = covered(third, [position(eth, '1', '100')]);
    const noJournal: PortfolioAccount = {
      accountId: third,
      name: 'Empty',
      coverage: 'missing-journal',
      coverageFrom: null,
      journalRevision: null,
    };
    const withUnpriced = projectManualPortfolioValue(
      [half, double, unpriced],
      [price(btc, '123.456')],
    );
    expect(withUnpriced).toMatchObject({ unrealizedPnlUsd: null, unrealizedReturnPercent: null });
    expect(withUnpriced.accounts[0]).toMatchObject({ unrealizedPnlUsd: '11.728' });

    const withMissing = projectManualPortfolioValue(
      [half, double, noJournal],
      [price(btc, '123.456')],
    );
    expect(withMissing).toMatchObject({
      unknownCostCount: 0,
      unrealizedPnlUsd: null,
      unrealizedReturnPercent: null,
    });
    expect(withMissing.accounts[2]).toMatchObject({
      unknownCostCount: null,
      unrealizedPnlUsd: null,
      unrealizedReturnPercent: null,
    });
  });
});

describe('UPNL-1 exact signed result and rounded return', () => {
  it.each([
    [-21989994745n, 100000000000n, '-21.99'],
    [5n, 1000n, '0.50'],
    [5n, 100000n, '0.01'],
    [-5n, 100000n, '-0.01'],
    [4n, 100000n, '0.00'],
    [-4n, 100000n, '0.00'],
    [0n, 7n, '0.00'],
    [3n, 1n, '300.00'],
  ])('formats %s / %s as %s percent', (numerator, denominator, expected) => {
    expect(formatPercent(numerator, denominator)).toBe(expected);
  });

  it('keeps a sub-cent signed result exact at scale 60', () => {
    expect(formatSignedProduct(-1n)).toBe(`-0.${'0'.repeat(59)}1`);
    expect(formatSignedProduct(0n)).toBe('0');
    const result = projectManualPortfolioValue(
      [
        covered(first, [
          position(btc, '0.000000000000000000000000000001', '0.000000000000000000000000000001'),
        ]),
      ],
      [price(btc, '0.5')],
    );
    expect(result.accounts[0]).toMatchObject({
      unrealizedPnlUsd: `-0.${'0'.repeat(29)}05`,
      unrealizedReturnPercent: '-50.00',
    });
  });
});
