import { FifoHistoryError, type FifoTrade } from './fifo';
import { projectHistoricalFifo } from './historical-accounting';
import { projectValuation } from './historical-valuation';
import { calculateOwnedTransfers } from './owned-transfer-fifo';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const token = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const at = (day: number) => `2025-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;

function reward(
  n: number,
  quantity: string,
  acquisitionBasisUsd: string | null,
  incomeValueUsd: string | null,
  instrumentId = token,
  category = 'staking',
) {
  return {
    rewardId: id(n),
    version: 1,
    instrumentId,
    instrumentName: 'Reward asset',
    instrumentSymbol: 'SAME',
    category,
    occurredAt: at(2),
    orderWithinTimestamp: n,
    quantity,
    acquisitionBasisUsd,
    incomeValueUsd,
  };
}

function trade(
  n: number,
  side: 'buy' | 'sell',
  quantity: string,
  grossUsd: string,
  day: number,
  instrumentId = token,
): FifoTrade {
  return {
    tradeId: id(n),
    version: 1,
    instrumentId,
    instrumentName: 'Trade asset',
    instrumentSymbol: 'SAME',
    side,
    occurredAt: at(day),
    orderWithinTimestamp: n,
    quantity,
    grossUsd,
    feeUsd: '0',
  };
}

function account(
  accountId: string,
  rewards: ReturnType<typeof reward>[] = [],
  trades: FifoTrade[] = [],
) {
  return { accountId, coverageFrom: at(1), initialLots: [], trades, rewards };
}

function move(
  n: number,
  fromAccountId: string,
  toAccountId: string,
  quantity: string,
  day: number,
  feeQuantity = '0',
) {
  return {
    transferId: id(n),
    version: 1,
    fromAccountId,
    toAccountId,
    instrumentId: token,
    occurredAt: at(day),
    orderWithinTimestamp: n,
    quantity,
    feeInstrumentId: feeQuantity === '0' ? null : token,
    feeQuantity,
  };
}

// Independent economic oracles: these call existing exported projection entrypoints.
// The predecessor ignores rewards, producing genuine behavioral failure, not import/type failure.
describe('REWARD-001/002 exact reward acquisition and cost evidence', () => {
  it('keeps known reward cost, income and purchase totals separate through partial sale', () => {
    const receipt = reward(1, '2', '100', '70');
    const result = calculateOwnedTransfers(
      [account(a, [receipt], [trade(10, 'sell', '1', '80', 3)])],
      [],
    );
    const state = result.accounts.get(a)!;
    expect(state.summary).toEqual({
      grossBuysUsd: '0',
      buyFeesUsd: '0',
      grossSalesUsd: '80',
      sellFeesUsd: '0',
      netSalesUsd: '80',
      consumedCostUsd: '50',
      realizedUsd: '30',
      remainingCostUsd: '50',
    });
    expect(state).toMatchObject({
      rewardSummary: {
        activeCount: 1,
        declaredBasisUsd: '100',
        declaredIncomeUsd: '70',
        knownBasisSubtotalUsd: '100',
        knownIncomeSubtotalUsd: '70',
        unknownBasisCount: 0,
        unknownIncomeCount: 0,
        unclassifiedCount: 0,
      },
    });
    expect(state.lots).toEqual([
      expect.objectContaining({
        sourceKind: 'reward',
        remainingQuantity: '1',
        remainingCostUsd: '50',
        origin: expect.objectContaining({
          kind: 'reward',
          accountId: a,
          rewardId: receipt.rewardId,
          version: 1,
        }),
        intervalStart: '1',
        intervalEnd: '2',
      }),
    ]);
    expect(state.matches).toEqual([
      expect.objectContaining({ sourceKind: 'reward', quantity: '1', costUsd: '50' }),
    ]);
    expect(state.transferSummary).toBeUndefined();
  });

  it('values actual quantities independently from unknown basis, income40 and known zero', () => {
    const accounts = [account(a, [reward(1, '2', null, '40'), reward(2, '1', '0', '0', other)])];
    const state = calculateOwnedTransfers(accounts, []).accounts.get(a)!;
    const snapshot = projectHistoricalFifo(state, []);
    expect(snapshot.positions).toEqual([
      {
        instrumentId: token,
        instrumentName: 'Reward asset',
        instrumentSymbol: 'SAME',
        quantity: '2',
        costUsd: null,
        knownCostSubtotalUsd: '0',
        unknownCostQuantity: '2',
      },
      {
        instrumentId: other,
        instrumentName: 'Reward asset',
        instrumentSymbol: 'SAME',
        quantity: '1',
        costUsd: '0',
      },
    ]);
    const value = projectValuation(snapshot.positions, [
      { instrumentId: token, observedAt: at(2), priceUsd: '5', revision: 1 },
      { instrumentId: other, observedAt: at(2), priceUsd: '3', revision: 1 },
    ]);
    expect(value).toMatchObject({
      completeness: 'complete',
      missingPriceCount: 0,
      totalValueUsd: '13',
      pricedSubtotalUsd: '13',
    });
    expect(value.items.map((item) => item.valueUsd)).toEqual(['10', '3']);
    expect(state.summary).toMatchObject({
      grossBuysUsd: '0',
      consumedCostUsd: '0',
      realizedUsd: '0',
      remainingCostUsd: null,
    });
    expect(state).toMatchObject({
      rewardSummary: { declaredBasisUsd: null, declaredIncomeUsd: '40', unknownBasisCount: 1 },
    });
  });

  it('excludes a mixed unknown sale from known realized subtotal instead of reporting proceeds minus partial cost', () => {
    const state = calculateOwnedTransfers(
      [
        account(
          a,
          [reward(1, '2', null, '70')],
          [
            trade(10, 'buy', '1', '10', 1),
            trade(11, 'buy', '1', '3', 1, other),
            trade(12, 'sell', '1.5', '30', 3),
            trade(13, 'sell', '1', '10', 3, other),
          ],
        ),
      ],
      [],
    ).accounts.get(a)!;
    expect(state.summary).toEqual({
      grossBuysUsd: '13',
      buyFeesUsd: '0',
      grossSalesUsd: '40',
      sellFeesUsd: '0',
      netSalesUsd: '40',
      consumedCostUsd: null,
      realizedUsd: null,
      remainingCostUsd: null,
      basisCoverage: {
        consumed: { knownSubtotalUsd: '13', unknownCount: 1 },
        remaining: { knownSubtotalUsd: '0', unknownCount: 1 },
        realized: { knownSubtotalUsd: '7', unknownCount: 1 },
      },
    });
    expect(state.realizations).toEqual([
      expect.objectContaining({
        sellTradeId: id(12),
        consumedCostUsd: null,
        realizedUsd: null,
        basisCoverage: { knownConsumedCostUsd: '10', unknownMatchCount: 1 },
      }),
      expect.objectContaining({ sellTradeId: id(13), consumedCostUsd: '3', realizedUsd: '7' }),
    ]);
    expect(state.lots).toEqual([
      expect.objectContaining({ remainingQuantity: '1.5', remainingCostUsd: null }),
    ]);
  });

  it('retains unknown original coordinates through principal, same-asset fee and return then restates known basis', () => {
    const receipt = reward(1, '3', null, '9');
    const moves = [move(100, a, b, '2', 3, '0.25'), move(101, b, a, '1', 4)];
    const result = calculateOwnedTransfers([account(a, [receipt]), account(b)], moves);
    const sender = result.accounts.get(a)!;
    const recipient = result.accounts.get(b)!;
    expect(projectHistoricalFifo(sender, []).positions).toEqual([
      expect.objectContaining({ quantity: '1.75', costUsd: null, unknownCostQuantity: '1.75' }),
    ]);
    expect(projectHistoricalFifo(recipient, []).positions).toEqual([
      expect.objectContaining({ quantity: '1', costUsd: null, unknownCostQuantity: '1' }),
    ]);
    expect(result.allocations.get(id(100))).toMatchObject({
      principalBasisUsd: null,
      feeConsumedBasisUsd: null,
      basisCoverage: {
        principal: { knownSubtotalUsd: '0', unknownCount: 1 },
        fee: { knownSubtotalUsd: '0', unknownCount: 1 },
      },
      items: [
        expect.objectContaining({
          kind: 'principal',
          quantity: '2',
          costUsd: null,
          intervalStart: '0',
          intervalEnd: '2',
        }),
        expect.objectContaining({
          kind: 'fee',
          quantity: '0.25',
          costUsd: null,
          intervalStart: '2',
          intervalEnd: '2.25',
        }),
      ],
    });
    expect(sender.summary).toMatchObject({
      grossBuysUsd: '0',
      realizedUsd: '0',
      buyFeesUsd: '0',
      sellFeesUsd: '0',
    });
    expect(sender.transferSummary).toMatchObject({
      feeConsumedBasisUsd: null,
      fees: [
        expect.objectContaining({
          quantity: '0.25',
          consumedBasisUsd: null,
          knownBasisSubtotalUsd: '0',
          unknownCostQuantity: '0.25',
        }),
      ],
    });
    expect(recipient).not.toHaveProperty('rewardSummary');
    for (const lot of [...sender.lots, ...recipient.lots])
      expect(lot).toMatchObject({
        origin: expect.objectContaining({ kind: 'reward', rewardId: id(1), originalCostUsd: null }),
      });
    const corrected = calculateOwnedTransfers(
      [account(a, [{ ...receipt, version: 2, acquisitionBasisUsd: '12' }]), account(b)],
      moves,
    );
    expect(corrected.accounts.get(a)!.summary.remainingCostUsd).toBe('7');
    expect(corrected.accounts.get(b)!.summary.remainingCostUsd).toBe('4');
    expect(corrected.accounts.get(a)!.transferSummary!.feeConsumedBasisUsd).toBe('1');
    expect(receipt.acquisitionBasisUsd).toBeNull();
  });

  it('uses reward effective time inclusively and preserves source-only income after a transfer', () => {
    const accounts = [account(a, [reward(1, '2', '100', '70')]), account(b)];
    const moves = [move(100, a, b, '1', 3)];
    expect(calculateOwnedTransfers(accounts, moves, at(1)).accounts.get(a)!.lots).toEqual([]);
    expect(
      calculateOwnedTransfers(accounts, moves, at(2)).accounts.get(a)!.summary.remainingCostUsd,
    ).toBe('100');
    const after = calculateOwnedTransfers(accounts, moves, at(3));
    expect(after.accounts.get(a)!.summary.remainingCostUsd).toBe('50');
    expect(after.accounts.get(b)!.summary.remainingCostUsd).toBe('50');
    expect(after.accounts.get(a)).toMatchObject({ rewardSummary: { declaredIncomeUsd: '70' } });
    expect(after.accounts.get(b)).not.toHaveProperty('rewardSummary');
  });

  it('leaves an unclassified reward subtype visibly incomplete even when its income value is known', () => {
    const state = calculateOwnedTransfers(
      [account(a, [reward(1, '2', '0', '40', token, 'unclassified')])],
      [],
    ).accounts.get(a)!;
    expect(state).toMatchObject({
      rewardSummary: {
        declaredBasisUsd: '0',
        declaredIncomeUsd: null,
        knownIncomeSubtotalUsd: '0',
        unknownIncomeCount: 0,
        unclassifiedCount: 1,
      },
    });
    expect(state.lots).toHaveLength(1);
    expect(state.lots[0]).toMatchObject({ remainingCostUsd: '0' });
  });

  it('shares chronology with trades and rejects unsupported historical removal, without changing inputs', () => {
    const receipt = reward(1, '2', '100', '70');
    const collision = {
      ...trade(10, 'buy', '1', '1', 2),
      orderWithinTimestamp: receipt.orderWithinTimestamp,
    };
    expect(() => calculateOwnedTransfers([account(a, [receipt], [collision])], [])).toThrow(
      FifoHistoryError,
    );
    const accounts = [account(a, [receipt]), account(b, [], [trade(11, 'sell', '1', '80', 4)])];
    const moves = [move(100, a, b, '1', 3)];
    const fingerprint = JSON.stringify([accounts, moves]);
    const valid = calculateOwnedTransfers(accounts, moves);
    expect(valid.accounts.get(b)!.summary.realizedUsd).toBe('30');
    expect(() => calculateOwnedTransfers([account(a), accounts[1]], moves)).toThrow(
      FifoHistoryError,
    );
    expect(JSON.stringify([accounts, moves])).toBe(fingerprint);
  });
});
