import { FifoHistoryError, type FifoTrade } from './fifo';
import { projectHistoricalFifo } from './historical-accounting';
import { projectValuation } from './historical-valuation';
import { formatAtoms } from './money';
import { calculateOwnedTransfers } from './owned-transfer-fifo';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const c = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const token = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const atom = (value: bigint) => formatAtoms(value);
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const day = (n: number) => `2025-01-${String(n).padStart(2, '0')}T00:00:00.000Z`;

function reward(n: number, quantity: string, acquisitionBasisUsd: string | null) {
  return {
    rewardId: id(n),
    version: 1,
    instrumentId: token,
    instrumentName: 'Reward',
    instrumentSymbol: 'SAME',
    category: 'staking',
    occurredAt: day(2),
    orderWithinTimestamp: n,
    quantity,
    acquisitionBasisUsd,
    incomeValueUsd: null,
  };
}

function account(
  accountId: string,
  rewards: ReturnType<typeof reward>[] = [],
  trades: FifoTrade[] = [],
  coverageFrom = day(1),
) {
  return { accountId, coverageFrom, initialLots: [], trades, rewards };
}

function transfer(
  n: number,
  fromAccountId: string,
  toAccountId: string,
  quantity: string,
  at: number,
) {
  return {
    transferId: id(n),
    version: 1,
    fromAccountId,
    toAccountId,
    instrumentId: token,
    occurredAt: day(at),
    orderWithinTimestamp: n,
    quantity,
    feeInstrumentId: null,
    feeQuantity: '0',
  };
}

describe('REWARD-BOUNDARY original coordinates and missing-basis propagation', () => {
  it('restarts the 7/11 atom allocation at its original origin after null-to-known correction', () => {
    const received = reward(1, atom(7n), null);
    const outgoing = [transfer(101, a, b, atom(3n), 3), transfer(102, a, c, atom(1n), 4)];
    const sale: FifoTrade = {
      tradeId: id(201),
      version: 1,
      instrumentId: token,
      instrumentName: 'Reward',
      instrumentSymbol: 'SAME',
      side: 'sell',
      occurredAt: day(5),
      orderWithinTimestamp: 0,
      quantity: atom(1n),
      grossUsd: atom(2n),
      feeUsd: '0',
    };
    const accounts = [account(a, [received]), account(b, [], [sale]), account(c)];
    const before = calculateOwnedTransfers(accounts, outgoing);
    expect(before.allocations.get(id(101))).toMatchObject({
      principalBasisUsd: null,
      items: [
        expect.objectContaining({ intervalStart: '0', intervalEnd: atom(3n), costUsd: null }),
      ],
    });
    expect(before.accounts.get(b)!.realizations[0]).toMatchObject({
      consumedCostUsd: null,
      realizedUsd: null,
    });

    const corrected = calculateOwnedTransfers(
      [
        account(a, [{ ...received, version: 2, acquisitionBasisUsd: atom(11n) }]),
        account(b, [], [sale]),
        account(c),
      ],
      outgoing,
    );
    expect(corrected.allocations.get(id(101))).toMatchObject({
      principalBasisUsd: atom(4n),
      items: [
        expect.objectContaining({
          intervalStart: '0',
          intervalEnd: atom(3n),
          costUsd: atom(4n),
          origin: expect.objectContaining({ rewardId: id(1), version: 2 }),
        }),
      ],
    });
    expect(corrected.allocations.get(id(102))).toMatchObject({
      principalBasisUsd: atom(2n),
      items: [
        expect.objectContaining({
          intervalStart: atom(3n),
          intervalEnd: atom(4n),
          costUsd: atom(2n),
        }),
      ],
    });
    expect(corrected.accounts.get(a)!.summary.remainingCostUsd).toBe(atom(5n));
    expect(corrected.accounts.get(b)!.summary.remainingCostUsd).toBe(atom(3n));
    expect(corrected.accounts.get(c)!.summary.remainingCostUsd).toBe(atom(2n));
    expect(corrected.accounts.get(b)!.matches).toEqual([
      expect.objectContaining({
        sourceKind: 'transfer',
        intervalStart: '0',
        intervalEnd: atom(1n),
        costUsd: atom(1n),
      }),
    ]);
    expect(received.acquisitionBasisUsd).toBeNull();
  });

  it('keeps a mixed-cost instrument price-complete with exact known subtotal and unknown quantity', () => {
    const state = calculateOwnedTransfers(
      [account(a, [reward(1, '1', '5'), reward(2, '1', null)])],
      [],
    ).accounts.get(a)!;
    const [position] = projectHistoricalFifo(state, []).positions;
    expect(position).toMatchObject({
      instrumentId: token,
      quantity: '2',
      costUsd: null,
      knownCostSubtotalUsd: '5',
      unknownCostQuantity: '1',
    });
    expect(state.summary).toMatchObject({
      remainingCostUsd: null,
      basisCoverage: { remaining: { knownSubtotalUsd: '5', unknownCount: 1 } },
    });
    const value = projectValuation(
      [position],
      [{ instrumentId: token, observedAt: day(2), priceUsd: '3', revision: 1 }],
    );
    expect(value).toMatchObject({
      completeness: 'complete',
      totalValueUsd: '6',
      missingPriceCount: 0,
    });
  });

  it('rejects future invalid chronology/coverage even for an earlier as-of prefix', () => {
    const received = reward(1, '1', null);
    expect(() => calculateOwnedTransfers([account(a, [received], [], day(3))], [], day(1))).toThrow(
      FifoHistoryError,
    );
    const movement = { ...transfer(101, a, b, '0.5', 2), orderWithinTimestamp: 1 };
    expect(() =>
      calculateOwnedTransfers([account(a, [received]), account(b)], [movement], day(1)),
    ).toThrow(FifoHistoryError);
    expect(() =>
      calculateOwnedTransfers(
        [account(a, [received]), account(b, [reward(2, '1', '0')])],
        [],
        day(2),
      ),
    ).not.toThrow();
  });

  it('accepts exactly 1000 active rewards and rejects 1001 without truncating derived sums', () => {
    const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
    const receipts = Array.from({ length: 1000 }, (_, n) => reward(n + 1, '1', maximum));
    const state = calculateOwnedTransfers([account(a, receipts)], []).accounts.get(a)!;
    const subtotal = formatAtoms(1000n * (10n ** 78n - 1n));
    expect(state).toMatchObject({
      summary: { remainingCostUsd: subtotal },
      rewardSummary: { activeCount: 1000, declaredBasisUsd: subtotal },
    });
    expect(state.lots).toHaveLength(1000);
    expect(() =>
      calculateOwnedTransfers([account(a, [...receipts, reward(1001, '1', null)])], [], day(1)),
    ).toThrow(FifoHistoryError);
    expect(formatAtoms(14200n * (10n ** 78n - 1n)).split('.')[0]).toHaveLength(53);
  });
});
