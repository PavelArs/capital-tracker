import type { FifoCarryInInput, FifoTrade } from './fifo';
import { projectHistoricalAccounting } from './historical-accounting';

const instrumentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const atom = '0.000000000000000000000000000001';
const coverage = '2025-01-01T00:00:00.000Z';
type Head = FifoTrade & { kind: 'create' | 'correct' | 'void' };

function trade(index: number, overrides: Partial<Head> = {}): Head {
  return {
    tradeId: `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, '0')}`,
    version: 1,
    kind: 'create',
    instrumentId,
    instrumentName: 'Тестовый инструмент',
    instrumentSymbol: 'TOKEN',
    side: 'buy',
    occurredAt: `2025-01-0${index + 1}T00:00:00.000Z`,
    orderWithinTimestamp: 0,
    quantity: '1',
    grossUsd: '100',
    feeUsd: '0',
    ...overrides,
  };
}
function lot(index: number, overrides: Partial<FifoCarryInInput> = {}): FifoCarryInInput {
  return {
    lotId: `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, '0')}`,
    openingRevision: 1,
    ordinal: index,
    instrumentId,
    instrumentName: 'Тестовый инструмент',
    instrumentSymbol: 'TOKEN',
    acquiredAt: '2024-12-31T00:00:00.000Z',
    orderWithinTimestamp: index,
    originalQuantity: '1',
    originalCostUsd: '100',
    carriedQuantity: '1',
    ...overrides,
  };
}

describe('HIST-001/002 complete-prefix exact accounting projection', () => {
  const timeline = [
    trade(1),
    trade(2, { grossUsd: '200' }),
    trade(3, { side: 'sell', quantity: '1.5', grossUsd: '450' }),
  ];

  it.each([
    ['2025-01-02T23:59:59.999Z', '1', '100', '100', '0', '0'],
    ['2025-01-03T00:00:00.000Z', '2', '300', '300', '0', '0'],
    ['2025-01-04T00:00:00.000Z', '0.5', '100', '300', '200', '250'],
  ])(
    'HIST-001-A includes the complete effective prefix at %s',
    (at, quantity, cost, buys, consumed, realized) => {
      const before = JSON.stringify(timeline);
      const result = projectHistoricalAccounting(timeline, [], at);
      expect(result.initialCostUsd).toBe('0');
      expect(result.positions).toEqual([
        {
          instrumentId,
          instrumentName: 'Тестовый инструмент',
          instrumentSymbol: 'TOKEN',
          quantity,
          costUsd: cost,
        },
      ]);
      expect(result.summary).toEqual({
        grossBuysUsd: buys,
        buyFeesUsd: '0',
        grossSalesUsd: realized === '0' ? '0' : '450',
        sellFeesUsd: '0',
        netSalesUsd: realized === '0' ? '0' : '450',
        consumedCostUsd: consumed,
        realizedUsd: realized,
        remainingCostUsd: cost,
      });
      expect(JSON.stringify(timeline)).toBe(before);
    },
  );

  it('HIST-001-B uses corrected execution time and removes terminal voids', () => {
    const corrected = [
      {
        ...timeline[0],
        kind: 'correct' as const,
        version: 2,
        grossUsd: '120',
        occurredAt: '2025-01-03T12:00:00.000Z',
      },
      timeline[1],
      timeline[2],
    ];
    expect(
      projectHistoricalAccounting(corrected, [], '2025-01-03T00:00:00.000Z').positions,
    ).toEqual([expect.objectContaining({ quantity: '1', costUsd: '200' })]);
    const afterSale = projectHistoricalAccounting(corrected, [], '2025-01-04T00:00:00.000Z');
    // The 200 lot now precedes the 120 lot: cost consumed = 200 + 60.
    expect(afterSale.summary).toMatchObject({
      consumedCostUsd: '260',
      realizedUsd: '190',
      remainingCostUsd: '60',
    });
    const voided = [
      ...corrected.slice(0, 2),
      { ...corrected[2], kind: 'void' as const, version: 2 },
    ];
    const restored = projectHistoricalAccounting(voided, [], '2025-01-04T00:00:00.000Z');
    expect(restored.positions).toEqual([
      expect.objectContaining({ quantity: '2', costUsd: '320' }),
    ]);
    expect(restored.summary.realizedUsd).toBe('0');
  });

  it('HIST-001-B keeps a fee atom and exact fractional disposal residual', () => {
    const heads = [
      trade(1, { quantity: '0.3', grossUsd: '0.3', feeUsd: atom }),
      trade(2, { side: 'sell', quantity: '0.1', grossUsd: '0.2', feeUsd: atom }),
    ];
    const result = projectHistoricalAccounting(heads, [], '2025-01-04T00:00:00.000Z');
    expect(result.positions).toEqual([
      expect.objectContaining({ quantity: '0.2', costUsd: `0.2${'0'.repeat(28)}1` }),
    ]);
    expect(result.summary).toMatchObject({
      buyFeesUsd: atom,
      sellFeesUsd: atom,
      consumedCostUsd: '0.1',
      realizedUsd: `0.0${'9'.repeat(29)}`,
    });
  });

  it('HIST-002-A keeps original partial-lot allocation across inclusive instants', () => {
    const baseline = [
      lot(1, {
        originalQuantity: '4',
        originalCostUsd: '0.000000000000000000000000000002',
        carriedQuantity: '3',
      }),
    ];
    const sales = [1, 2, 3].map((index) =>
      trade(index, { side: 'sell', quantity: '1', grossUsd: '1' }),
    );
    const before = JSON.stringify(baseline);
    const results = [coverage, ...sales.map((sale) => sale.occurredAt)].map((at) =>
      projectHistoricalAccounting(sales, baseline, at),
    );
    expect(results.map((result) => result.summary.consumedCostUsd)).toEqual([
      '0',
      atom,
      atom,
      '0.000000000000000000000000000002',
    ]);
    expect(results.map((result) => result.initialCostUsd)).toEqual(
      Array(4).fill('0.000000000000000000000000000002'),
    );
    expect(results.every((result) => result.summary.grossBuysUsd === '0')).toBe(true);
    expect(results[3].positions).toEqual([]);
    expect(JSON.stringify(baseline)).toBe(before);
  });

  it('HIST-002-B preserves positive known-zero inventory and actual empty state', () => {
    expect(projectHistoricalAccounting([], [], coverage)).toEqual({
      initialCostUsd: '0',
      positions: [],
      summary: {
        grossBuysUsd: '0',
        buyFeesUsd: '0',
        grossSalesUsd: '0',
        sellFeesUsd: '0',
        netSalesUsd: '0',
        consumedCostUsd: '0',
        realizedUsd: '0',
        remainingCostUsd: '0',
      },
    });
    expect(
      projectHistoricalAccounting([], [lot(1, { originalCostUsd: '0' })], coverage).positions,
    ).toEqual([expect.objectContaining({ quantity: '1', costUsd: '0' })]);
  });

  it('HIST-003-A aggregates by UUID and sorts independently of symbol and lot order', () => {
    const result = projectHistoricalAccounting(
      [trade(1, { instrumentId: otherId }), trade(2), trade(3)],
      [],
      '2025-01-05T00:00:00.000Z',
    );
    expect(
      result.positions.map(({ instrumentId: id, quantity, costUsd }) => ({
        id,
        quantity,
        costUsd,
      })),
    ).toEqual([
      { id: instrumentId, quantity: '2', costUsd: '200' },
      { id: otherId, quantity: '1', costUsd: '100' },
    ]);
    expect(result.summary.remainingCostUsd).toBe('300');
  });

  it('HIST-003-B includes 100 baseline lots and all 1000 active trades at maximum precision', () => {
    const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
    const baseline = Array.from({ length: 100 }, (_, index) =>
      lot(index + 1, {
        originalQuantity: maximum,
        originalCostUsd: maximum,
        carriedQuantity: maximum,
      }),
    );
    const heads = Array.from({ length: 1000 }, (_, index) =>
      trade(index + 1, {
        occurredAt: coverage,
        orderWithinTimestamp: index,
        quantity: maximum,
        grossUsd: maximum,
      }),
    );
    const total = `1099${'9'.repeat(48)}.${'9'.repeat(26)}89`;
    const result = projectHistoricalAccounting(heads, baseline, coverage);
    expect(result.positions).toEqual([
      expect.objectContaining({ quantity: total, costUsd: total }),
    ]);
    expect(result.summary.remainingCostUsd).toBe(total);
    expect(result.summary.realizedUsd).toBe('0');
  });
});
