import {
  type FifoCarryInInput,
  FifoHistoryError,
  type FifoTrade,
  calculateFifo,
  deriveCarryInAmounts,
} from './fifo';

const instrumentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherInstrumentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const instant = '2025-01-01T00:00:00.000Z';
const atom = '0.000000000000000000000000000001';
const twoAtoms = '0.000000000000000000000000000002';
const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
const zero = {
  grossBuysUsd: '0',
  buyFeesUsd: '0',
  grossSalesUsd: '0',
  sellFeesUsd: '0',
  netSalesUsd: '0',
  consumedCostUsd: '0',
  realizedUsd: '0',
  remainingCostUsd: '0',
};
function initial(ordinal: number, overrides: Partial<FifoCarryInInput> = {}): FifoCarryInInput {
  return {
    lotId: `00000000-0000-4000-8000-${ordinal.toString(16).padStart(12, '0')}`,
    openingRevision: 3,
    ordinal,
    instrumentId,
    instrumentName: 'Token',
    instrumentSymbol: 'SAME',
    acquiredAt: instant,
    orderWithinTimestamp: ordinal,
    originalQuantity: '1',
    originalCostUsd: '100',
    carriedQuantity: '1',
    ...overrides,
  };
}
function trade(order: number, overrides: Partial<FifoTrade> = {}): FifoTrade {
  return {
    tradeId: `10000000-0000-4000-8000-${order.toString(16).padStart(12, '0')}`,
    version: 1,
    instrumentId,
    instrumentName: 'Token',
    instrumentSymbol: 'SAME',
    occurredAt: instant,
    orderWithinTimestamp: order,
    side: 'sell',
    quantity: '1',
    grossUsd: '150',
    feeUsd: '0',
    ...overrides,
  };
}

describe('CARRY-002-A original allocation phase is retained independently of covered activity', () => {
  it('derives known baseline disposal and cost without rounding to a rebased lot', () => {
    expect(deriveCarryInAmounts('4', twoAtoms, '3')).toEqual({
      priorDisposedQuantity: '1',
      priorAllocatedCostUsd: '0',
      carriedCostUsd: twoAtoms,
    });
    expect(deriveCarryInAmounts('4', twoAtoms, '1')).toEqual({
      priorDisposedQuantity: '3',
      priorAllocatedCostUsd: atom,
      carriedCostUsd: atom,
    });
    expect(deriveCarryInAmounts('4', '100', '3')).toEqual({
      priorDisposedQuantity: '1',
      priorAllocatedCostUsd: '25',
      carriedCostUsd: '75',
    });
    expect(deriveCarryInAmounts('4', '0', '3')).toEqual({
      priorDisposedQuantity: '1',
      priorAllocatedCostUsd: '0',
      carriedCostUsd: '0',
    });
  });

  it('retains a one-atom remainder when the original allocation product approaches156 digits', () => {
    expect(deriveCarryInAmounts(maximum, maximum, atom)).toEqual({
      priorDisposedQuantity: `${'9'.repeat(48)}.${'9'.repeat(29)}8`,
      priorAllocatedCostUsd: `${'9'.repeat(48)}.${'9'.repeat(29)}8`,
      carriedCostUsd: atom,
    });
  });

  it('allocates original4/cost2atoms/alreadydisposed1 as [1,0,1], not [0,1,1]', () => {
    const baseline = initial(1, {
      originalQuantity: '4',
      originalCostUsd: twoAtoms,
      carriedQuantity: '3',
    });
    const sales = [
      trade(1, { grossUsd: atom }),
      trade(2, { grossUsd: atom }),
      trade(3, { grossUsd: atom }),
    ];
    const result = calculateFifo(sales, [baseline]);
    expect(result.matches.map((match) => match.costUsd)).toEqual([atom, '0', atom]);
    expect(result.realizations.map((sale) => sale.realizedUsd)).toEqual(['0', atom, '0']);
    expect(result.summary).toEqual({
      ...zero,
      grossSalesUsd: '0.000000000000000000000000000003',
      netSalesUsd: '0.000000000000000000000000000003',
      consumedCostUsd: twoAtoms,
      realizedUsd: atom,
    });
    expect(result.lots).toEqual([]);
    const partial = calculateFifo(sales.slice(0, 1), [baseline]);
    expect(partial.lots[0]).toMatchObject({
      originalQuantity: '4',
      originalCostUsd: twoAtoms,
      carriedQuantity: '3',
      carriedCostUsd: twoAtoms,
      remainingQuantity: '2',
      remainingCostUsd: atom,
    });
    expect(
      calculateFifo([trade(1, { quantity: '2', grossUsd: twoAtoms })], [baseline]).summary,
    ).toEqual(calculateFifo(sales.slice(0, 2), [baseline]).summary);
  });

  it('does not count historical disposed cost as covered consumption or purchases', () => {
    const result = calculateFifo(
      [],
      [initial(1, { originalQuantity: '4', originalCostUsd: '100', carriedQuantity: '3' })],
    );
    expect(result.summary).toEqual({ ...zero, remainingCostUsd: '75' });
    expect(result.realizations).toEqual([]);
    expect(result.matches).toEqual([]);
    expect(result.lots[0]).toMatchObject({
      carriedQuantity: '3',
      carriedCostUsd: '75',
      remainingQuantity: '3',
      remainingCostUsd: '75',
    });
  });
});

describe('CARRY-001-A / CARRY-004-A exact provenance and shared FIFO inputs', () => {
  it('returns complete250/100 projections without fake buys and never mutates either input', () => {
    const first = initial(1);
    const second = initial(2, { originalCostUsd: '200' });
    const sale = trade(0, { quantity: '1.5', grossUsd: '450', version: 4 });
    const baselines = Object.freeze([second, first].map((row) => Object.freeze(row)));
    const sales = Object.freeze([Object.freeze(sale)]);
    const before = JSON.stringify([sales, baselines]);
    expect(calculateFifo(sales, baselines)).toEqual({
      summary: {
        ...zero,
        grossSalesUsd: '450',
        netSalesUsd: '450',
        consumedCostUsd: '200',
        realizedUsd: '250',
        remainingCostUsd: '100',
      },
      lots: [
        {
          sourceKind: 'carry-in',
          lotId: second.lotId,
          openingRevision: 3,
          ordinal: 2,
          instrumentId,
          instrumentName: 'Token',
          instrumentSymbol: 'SAME',
          acquiredAt: instant,
          orderWithinTimestamp: 2,
          originalQuantity: '1',
          originalCostUsd: '200',
          carriedQuantity: '1',
          carriedCostUsd: '200',
          remainingQuantity: '0.5',
          remainingCostUsd: '100',
        },
      ],
      realizations: [
        {
          sellTradeId: sale.tradeId,
          sellVersion: 4,
          instrumentId,
          instrumentName: 'Token',
          instrumentSymbol: 'SAME',
          occurredAt: instant,
          orderWithinTimestamp: 0,
          quantity: '1.5',
          grossUsd: '450',
          feeUsd: '0',
          netUsd: '450',
          consumedCostUsd: '200',
          realizedUsd: '250',
        },
      ],
      matches: [first, second].map((lot, index) => ({
        sourceKind: 'carry-in',
        sellTradeId: sale.tradeId,
        sellVersion: 4,
        lotId: lot.lotId,
        openingRevision: 3,
        ordinal: lot.ordinal,
        quantity: index === 0 ? '1' : '0.5',
        costUsd: '100',
      })),
    });
    expect(JSON.stringify([sales, baselines])).toBe(before);
  });

  it('seeds same-boundary acquisitions before executions even when their order is larger', () => {
    const result = calculateFifo([trade(0)], [initial(1, { orderWithinTimestamp: 99 })]);
    expect(result.summary).toEqual({
      ...zero,
      grossSalesUsd: '150',
      netSalesUsd: '150',
      consumedCostUsd: '100',
      realizedUsd: '50',
    });
  });

  it('keeps same-symbol UUIDs independent and known-zero cost explicit', () => {
    const result = calculateFifo(
      [trade(1, { instrumentId: otherInstrumentId, feeUsd: '151' })],
      [initial(1), initial(2, { instrumentId: otherInstrumentId, originalCostUsd: '0' })],
    );
    expect(result.summary).toEqual({
      ...zero,
      grossSalesUsd: '150',
      sellFeesUsd: '151',
      netSalesUsd: '-1',
      realizedUsd: '-1',
      remainingCostUsd: '100',
    });
    expect(result.matches[0]).toMatchObject({
      sourceKind: 'carry-in',
      lotId: initial(2).lotId,
      costUsd: '0',
    });
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0].instrumentId).toBe(instrumentId);
    expect(() =>
      calculateFifo([trade(1, { instrumentId: otherInstrumentId })], [initial(1)]),
    ).toThrow(FifoHistoryError);
  });

  it('uses carry-in first, preserves unchanged buy-backed projection, and counts acquisition fees once', () => {
    const buy = trade(1, { side: 'buy', grossUsd: '100', feeUsd: '2' });
    const sale = trade(2, { quantity: '1.5', grossUsd: '300', feeUsd: '3' });
    const result = calculateFifo([sale, buy], [initial(1, { originalCostUsd: '101' })]);
    expect(result.summary).toEqual({
      ...zero,
      grossBuysUsd: '100',
      buyFeesUsd: '2',
      grossSalesUsd: '300',
      sellFeesUsd: '3',
      netSalesUsd: '297',
      consumedCostUsd: '152',
      realizedUsd: '145',
      remainingCostUsd: '51',
    });
    expect(result.matches).toEqual([
      {
        sourceKind: 'carry-in',
        sellTradeId: sale.tradeId,
        sellVersion: 1,
        lotId: initial(1).lotId,
        openingRevision: 3,
        ordinal: 1,
        quantity: '1',
        costUsd: '101',
      },
      {
        sellTradeId: sale.tradeId,
        sellVersion: 1,
        buyTradeId: buy.tradeId,
        buyVersion: 1,
        quantity: '0.5',
        costUsd: '51',
      },
    ]);
    expect(result.lots).toEqual([
      {
        buyTradeId: buy.tradeId,
        buyVersion: 1,
        instrumentId,
        instrumentName: 'Token',
        instrumentSymbol: 'SAME',
        occurredAt: instant,
        orderWithinTimestamp: 1,
        originalQuantity: '1',
        originalCostUsd: '102',
        remainingQuantity: '0.5',
        remainingCostUsd: '51',
      },
    ]);
  });

  it('retains independently specified exact old one-argument output and equivalent empty-baseline output', () => {
    const buy = trade(1, { side: 'buy', grossUsd: '100' });
    const expected = {
      summary: { ...zero, grossBuysUsd: '100', remainingCostUsd: '100' },
      lots: [
        {
          buyTradeId: buy.tradeId,
          buyVersion: 1,
          instrumentId,
          instrumentName: 'Token',
          instrumentSymbol: 'SAME',
          occurredAt: instant,
          orderWithinTimestamp: 1,
          originalQuantity: '1',
          originalCostUsd: '100',
          remainingQuantity: '1',
          remainingCostUsd: '100',
        },
      ],
      matches: [],
      realizations: [],
    };
    expect(calculateFifo([buy])).toEqual(expected);
    expect(calculateFifo([buy], [])).toEqual(expected);
    expect(calculateFifo([])).toEqual({ summary: zero, lots: [], matches: [], realizations: [] });
  });
});

describe('CARRY-006 exact capacities and widened derived bounds', () => {
  it('accepts100 baseline lots plus1000 active trades and returns82 atom digits', () => {
    const lots = Array.from({ length: 100 }, (_, index) =>
      initial(index + 1, { originalCostUsd: maximum }),
    );
    const trades = Array.from({ length: 1000 }, (_, index) =>
      trade(index, { side: 'buy', grossUsd: maximum }),
    );
    const result = calculateFifo(trades, lots);
    // Independently: M=10^78-1 atoms;1000M purchases +100M carry-in =1100M.
    expect(result.summary).toEqual({
      ...zero,
      grossBuysUsd:
        '999999999999999999999999999999999999999999999999999.999999999999999999999999999',
      remainingCostUsd:
        '1099999999999999999999999999999999999999999999999999.9999999999999999999999999989',
    });
    expect(result.lots).toHaveLength(1100);
    expect(result.matches).toEqual([]);
    expect(() => calculateFifo([...trades, trade(1000, { side: 'buy' })], lots)).toThrow(
      FifoHistoryError,
    );
    expect(() => calculateFifo([], [...lots, initial(101)])).toThrow(FifoHistoryError);
  });

  it('rejects an oversold prefix despite a later replenishment and duplicate effective trade chronology', () => {
    const sale = trade(1, { quantity: '1.000000000000000000000000000001' });
    const laterBuy = trade(2, { side: 'buy' });
    expect(() => calculateFifo([laterBuy, sale], [initial(1)])).toThrow(FifoHistoryError);
    expect(() =>
      calculateFifo(
        [trade(1), trade(1, { instrumentId: otherInstrumentId })],
        [initial(1), initial(2, { instrumentId: otherInstrumentId })],
      ),
    ).toThrow(FifoHistoryError);
  });
});
