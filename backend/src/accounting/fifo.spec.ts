import { FifoHistoryError, type FifoTrade, calculateFifo } from './fifo';

const instrumentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherInstrumentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const instant = '2026-01-01T00:00:00.000Z';
const atom = '0.000000000000000000000000000001';
const threeAtoms = '0.000000000000000000000000000003';
const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;

function trade(
  order: number,
  side: 'buy' | 'sell',
  quantity: string,
  grossUsd: string,
  overrides: Partial<FifoTrade> = {},
): FifoTrade {
  return {
    tradeId: `00000000-0000-4000-8000-${order.toString(16).padStart(12, '0')}`,
    version: 1,
    instrumentId,
    instrumentName: 'Synthetic token',
    instrumentSymbol: 'USD',
    side,
    occurredAt: instant,
    orderWithinTimestamp: order,
    quantity,
    grossUsd,
    feeUsd: '0',
    ...overrides,
  };
}

describe('TRADE-003 independently specified FIFO amounts and provenance', () => {
  it('returns exact empty projections without fictitious mixed-instrument quantity', () => {
    expect(calculateFifo([])).toEqual({
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
      lots: [],
      realizations: [],
      matches: [],
    });
  });

  it('proves mandatory 250/100, full projections and sorting without mutating input', () => {
    const first = trade(1, 'buy', '1', '100', { version: 3 });
    const second = trade(2, 'buy', '1', '200', { version: 2 });
    const sale = trade(3, 'sell', '1.5', '450', { version: 4 });
    const input = Object.freeze([sale, second, first].map((row) => Object.freeze(row)));
    const before = JSON.stringify(input);

    expect(calculateFifo(input)).toEqual({
      summary: {
        grossBuysUsd: '300',
        buyFeesUsd: '0',
        grossSalesUsd: '450',
        sellFeesUsd: '0',
        netSalesUsd: '450',
        consumedCostUsd: '200',
        realizedUsd: '250',
        remainingCostUsd: '100',
      },
      lots: [
        {
          buyTradeId: second.tradeId,
          buyVersion: 2,
          instrumentId,
          instrumentName: 'Synthetic token',
          instrumentSymbol: 'USD',
          occurredAt: instant,
          orderWithinTimestamp: 2,
          originalQuantity: '1',
          originalCostUsd: '200',
          remainingQuantity: '0.5',
          remainingCostUsd: '100',
        },
      ],
      realizations: [
        {
          sellTradeId: sale.tradeId,
          sellVersion: 4,
          instrumentId,
          instrumentName: 'Synthetic token',
          instrumentSymbol: 'USD',
          occurredAt: instant,
          orderWithinTimestamp: 3,
          quantity: '1.5',
          grossUsd: '450',
          feeUsd: '0',
          netUsd: '450',
          consumedCostUsd: '200',
          realizedUsd: '250',
        },
      ],
      matches: [
        {
          sellTradeId: sale.tradeId,
          sellVersion: 4,
          buyTradeId: first.tradeId,
          buyVersion: 3,
          quantity: '1',
          costUsd: '100',
        },
        {
          sellTradeId: sale.tradeId,
          sellVersion: 4,
          buyTradeId: second.tradeId,
          buyVersion: 2,
          quantity: '0.5',
          costUsd: '100',
        },
      ],
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('includes buy fees in basis and deducts the sale fee exactly once: 245/101', () => {
    const result = calculateFifo([
      trade(1, 'buy', '1', '100', { feeUsd: '1' }),
      trade(2, 'buy', '1', '200', { feeUsd: '2' }),
      trade(3, 'sell', '1.5', '450', { feeUsd: '3' }),
    ]);
    expect(result.summary).toEqual({
      grossBuysUsd: '300',
      buyFeesUsd: '3',
      grossSalesUsd: '450',
      sellFeesUsd: '3',
      netSalesUsd: '447',
      consumedCostUsd: '202',
      realizedUsd: '245',
      remainingCostUsd: '101',
    });
    expect(result.matches.map(({ quantity, costUsd }) => ({ quantity, costUsd }))).toEqual([
      { quantity: '1', costUsd: '101' },
      { quantity: '0.5', costUsd: '101' },
    ]);
    expect(result.lots[0]).toMatchObject({
      originalCostUsd: '202',
      remainingQuantity: '0.5',
      remainingCostUsd: '101',
    });
    expect(result.realizations[0]).toMatchObject({ netUsd: '447', realizedUsd: '245' });
  });

  it('retains negative net and the entire loss when the fee exceeds sale gross', () => {
    const result = calculateFifo([
      trade(1, 'buy', '1', '10', { feeUsd: '2' }),
      trade(2, 'sell', '1', '1', { feeUsd: '3' }),
    ]);
    expect(result.summary).toEqual({
      grossBuysUsd: '10',
      buyFeesUsd: '2',
      grossSalesUsd: '1',
      sellFeesUsd: '3',
      netSalesUsd: '-2',
      consumedCostUsd: '12',
      realizedUsd: '-14',
      remainingCostUsd: '0',
    });
    expect(result.realizations[0]).toMatchObject({ netUsd: '-2', realizedUsd: '-14' });
    expect(result.lots).toEqual([]);
  });

  it('formats exact break-even and zero net canonically without negative zero', () => {
    const breakEven = calculateFifo([
      trade(1, 'buy', '1', '1'),
      trade(2, 'sell', '1', '2', { feeUsd: '1' }),
    ]);
    expect(breakEven.summary.realizedUsd).toBe('0');
    expect(breakEven.realizations[0].realizedUsd).toBe('0');
    const zeroNet = calculateFifo([
      trade(1, 'buy', '1', atom),
      trade(2, 'sell', '1', '1', { feeUsd: '1' }),
    ]);
    expect(zeroNet.summary.netSalesUsd).toBe('0');
    expect(zeroNet.realizations[0].netUsd).toBe('0');
    expect(zeroNet.summary.realizedUsd).toBe(`-${atom}`);
  });

  it('allocates thirds from the original lot and gives the last sale the residual', () => {
    const result = calculateFifo([
      trade(0, 'buy', '3', '1'),
      trade(1, 'sell', '1', '1'),
      trade(2, 'sell', '1', '1'),
      trade(3, 'sell', '1', '1'),
    ]);
    expect(result.matches.map((match) => match.costUsd)).toEqual([
      '0.333333333333333333333333333333',
      '0.333333333333333333333333333333',
      '0.333333333333333333333333333334',
    ]);
    expect(result.summary).toMatchObject({
      consumedCostUsd: '1',
      realizedUsd: '2',
      remainingCostUsd: '0',
    });
    expect(result.lots).toEqual([]);
  });

  it('distinguishes cumulative original basis from repeatedly rounded remaining unit cost', () => {
    const result = calculateFifo([
      trade(0, 'buy', '7', threeAtoms),
      ...Array.from({ length: 7 }, (_, i) => trade(i + 1, 'sell', '1', '1')),
    ]);
    expect(result.matches.map((match) => match.costUsd)).toEqual([
      '0',
      '0',
      atom,
      '0',
      atom,
      '0',
      atom,
    ]);
    expect(result.realizations.map((sale) => sale.consumedCostUsd)).toEqual([
      '0',
      '0',
      atom,
      '0',
      atom,
      '0',
      atom,
    ]);
    expect(result.summary.consumedCostUsd).toBe(threeAtoms);
    expect(result.summary.realizedUsd).toBe('6.999999999999999999999999999997');
    expect(result.summary.remainingCostUsd).toBe('0');
    expect(result.lots).toEqual([]);
  });

  it('conserves cumulative basis at the same disposal quantity across different sale splits', () => {
    const whole = calculateFifo([trade(0, 'buy', '7', threeAtoms), trade(1, 'sell', '5', '5')]);
    const split = calculateFifo([
      trade(0, 'buy', '7', threeAtoms),
      trade(1, 'sell', '1', '1'),
      trade(2, 'sell', '2', '2'),
      trade(3, 'sell', '2', '2'),
    ]);
    expect(whole.matches.map((match) => match.costUsd)).toEqual([
      '0.000000000000000000000000000002',
    ]);
    expect(split.matches.map((match) => match.costUsd)).toEqual(['0', atom, atom]);
    expect(whole.summary).toEqual(split.summary);
    expect(split.summary.consumedCostUsd).toBe('0.000000000000000000000000000002');
    expect(split.lots[0]).toMatchObject({ remainingQuantity: '2', remainingCostUsd: atom });
  });

  it('keeps interleaved same-symbol UUID queues distinct and matches each sale in FIFO order', () => {
    const other = { instrumentId: otherInstrumentId, instrumentName: 'Other token' };
    const first = trade(0, 'buy', '1', '10');
    const second = trade(1, 'buy', '1', '100', other);
    const third = trade(2, 'buy', '1', '20');
    const sale = trade(3, 'sell', '1.5', '60');
    const otherSale = trade(4, 'sell', '0.25', '30', other);
    const result = calculateFifo([otherSale, third, second, sale, first]);
    expect(
      result.matches.map(({ buyTradeId, sellTradeId, quantity, costUsd }) => ({
        buyTradeId,
        sellTradeId,
        quantity,
        costUsd,
      })),
    ).toEqual([
      { buyTradeId: first.tradeId, sellTradeId: sale.tradeId, quantity: '1', costUsd: '10' },
      { buyTradeId: third.tradeId, sellTradeId: sale.tradeId, quantity: '0.5', costUsd: '10' },
      {
        buyTradeId: second.tradeId,
        sellTradeId: otherSale.tradeId,
        quantity: '0.25',
        costUsd: '25',
      },
    ]);
    expect(
      result.lots.map(({ instrumentId: id, remainingQuantity, remainingCostUsd }) => ({
        id,
        remainingQuantity,
        remainingCostUsd,
      })),
    ).toEqual([
      { id: otherInstrumentId, remainingQuantity: '0.75', remainingCostUsd: '75' },
      { id: instrumentId, remainingQuantity: '0.5', remainingCostUsd: '10' },
    ]);
    expect(result.summary).toMatchObject({
      consumedCostUsd: '45',
      realizedUsd: '45',
      remainingCostUsd: '85',
    });
  });

  it('orders by instant before same-instant order, never by UUID or arrival', () => {
    const earlier = trade(99, 'buy', '1', '10');
    const later = trade(1, 'buy', '1', '100', { occurredAt: '2026-01-02T00:00:00.000Z' });
    const sale = trade(0, 'sell', '1', '20', { occurredAt: '2026-01-03T00:00:00.000Z' });
    const result = calculateFifo([sale, later, earlier]);
    expect(result.matches[0]).toMatchObject({ buyTradeId: earlier.tradeId, costUsd: '10' });
    expect(result.lots[0]).toMatchObject({ buyTradeId: later.tradeId, remainingCostUsd: '100' });
  });

  it('uses explicit same-instant order despite reversed UUIDs and preserves both purchases', () => {
    const first = trade(0, 'buy', '1', '10', {
      tradeId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      instrumentSymbol: null,
    });
    const second = trade(1, 'buy', '1', '20', { instrumentSymbol: null });
    const sale = trade(2, 'sell', '1.5', '60', { instrumentSymbol: null });
    const result = calculateFifo([sale, second, first]);
    expect(
      result.matches.map(({ buyTradeId, quantity, costUsd }) => ({
        buyTradeId,
        quantity,
        costUsd,
      })),
    ).toEqual([
      { buyTradeId: first.tradeId, quantity: '1', costUsd: '10' },
      { buyTradeId: second.tradeId, quantity: '0.5', costUsd: '10' },
    ]);
    expect(result.lots[0]).toMatchObject({
      buyTradeId: second.tradeId,
      instrumentSymbol: null,
      remainingQuantity: '0.5',
      remainingCostUsd: '10',
    });
  });

  it('preserves an integer above 2^53 and one-atom quantities', () => {
    const result = calculateFifo([
      trade(0, 'buy', atom, '9007199254740993.000000000000000001'),
      trade(1, 'sell', atom, '9007199254740994.000000000000000002'),
    ]);
    expect(result.matches[0]).toMatchObject({
      quantity: atom,
      costUsd: '9007199254740993.000000000000000001',
    });
    expect(result.summary.realizedUsd).toBe('1.000000000000000001');
    expect(result.lots).toEqual([]);
  });

  it('handles a partial allocation whose multiplication requires 156 atom digits', () => {
    const almostMaximum = `${'9'.repeat(48)}.${'9'.repeat(29)}8`;
    const result = calculateFifo([
      trade(0, 'buy', maximum, maximum),
      trade(1, 'sell', almostMaximum, maximum),
    ]);
    expect(result.matches[0].costUsd).toBe(almostMaximum);
    expect(result.summary.realizedUsd).toBe(atom);
    expect(result.lots[0]).toMatchObject({ remainingQuantity: atom, remainingCostUsd: atom });
  });

  it('accepts exactly 1000 active trades and emits an 81-atom-digit aggregate', () => {
    const input = Array.from({ length: 1000 }, (_, index) => trade(index, 'buy', '1', maximum));
    const result = calculateFifo(input);
    const thousandMaximums = `${'9'.repeat(51)}.${'9'.repeat(27)}`;
    expect(result.summary.grossBuysUsd).toBe(thousandMaximums);
    expect(result.summary.remainingCostUsd).toBe(thousandMaximums);
    expect(result.lots).toHaveLength(1000);
    expect(result.summary.realizedUsd).toBe('0');
    expect(() => calculateFifo([...input, trade(1000, 'buy', '1', '1')])).toThrow(FifoHistoryError);
  });

  it('preserves the signed 81-digit loss bound, including wide negative sale nets', () => {
    const buys = Array.from({ length: 500 }, (_, index) => trade(index, 'buy', '1', maximum));
    const sales = Array.from({ length: 500 }, (_, index) =>
      trade(index + 500, 'sell', '1', atom, { feeUsd: maximum }),
    );
    const result = calculateFifo([...sales, ...buys]);
    // 500*(atom - M) - 500*M = -(10^81 - 1500) atoms, M=10^78-1.
    expect(result.summary.realizedUsd).toBe(`-${'9'.repeat(51)}.${'9'.repeat(26)}85`);
    expect(result.summary.netSalesUsd).toBe(`-4${'9'.repeat(50)}.${'9'.repeat(27)}`);
    expect(result.summary.consumedCostUsd).toBe(`4${'9'.repeat(50)}.${'9'.repeat(27)}5`);
    expect(result.lots).toEqual([]);
    expect(result.matches).toHaveLength(500);
  });
});

describe('TRADE-002/004 invalid effective history', () => {
  it('rejects a negative chronological prefix even if later purchases restore holdings', () => {
    expect(() => calculateFifo([trade(1, 'buy', '2', '20'), trade(0, 'sell', '1', '10')])).toThrow(
      FifoHistoryError,
    );
  });

  it('rejects an oversale of one atom without borrowing from a future lot', () => {
    expect(() =>
      calculateFifo([
        trade(0, 'buy', '1', '10'),
        trade(1, 'sell', '1.000000000000000000000000000001', '20'),
        trade(2, 'buy', '1', '10'),
      ]),
    ).toThrow(FifoHistoryError);
  });

  it('cannot spend another instrument merely because its symbol matches', () => {
    expect(() =>
      calculateFifo([
        trade(0, 'buy', '2', '20'),
        trade(1, 'sell', '1', '10', { instrumentId: otherInstrumentId }),
      ]),
    ).toThrow(FifoHistoryError);
  });

  it('rejects duplicate effective chronology even across distinct instruments and UUIDs', () => {
    expect(() =>
      calculateFifo([
        trade(0, 'buy', '1', '10'),
        trade(1, 'buy', '1', '20', {
          instrumentId: otherInstrumentId,
          orderWithinTimestamp: 0,
        }),
      ]),
    ).toThrow(FifoHistoryError);
  });
});
