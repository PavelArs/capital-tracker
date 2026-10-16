import type { FifoCapitalReturn } from './capital-return-types';
import { FifoHistoryError, type FifoTrade } from './fifo';
import { canonicalDecimalToAtoms } from './money';
import { calculateOwnedTransfers } from './owned-transfer-fifo';
import type { AccountFifoResult } from './owned-transfer-types';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const bond = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const cash = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const at = (day: number) => `2025-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;

function trade(
  n: number,
  side: 'buy' | 'sell',
  quantity: string,
  grossUsd: string,
  day: number,
): FifoTrade {
  return {
    tradeId: id(n),
    version: 1,
    instrumentId: bond,
    instrumentName: 'Synthetic bond',
    instrumentSymbol: 'SYNB',
    side,
    occurredAt: at(day),
    orderWithinTimestamp: n,
    quantity,
    grossUsd,
    feeUsd: '0',
  };
}

function repayment(
  n: number,
  amountUsd: string,
  day: number,
  paidCurrency: 'RUB' | 'EUR' | null = null,
  amount = amountUsd,
): FifoCapitalReturn {
  return {
    capitalReturnId: id(n),
    version: 1,
    instrumentId: bond,
    instrumentName: 'Synthetic bond',
    instrumentSymbol: 'SYNB',
    cashInstrumentId: cash,
    cashInstrumentName: 'Synthetic cash',
    cashInstrumentSymbol: 'CASH',
    occurredAt: at(day),
    orderWithinTimestamp: n,
    amount,
    amountUsd,
    paidCurrency,
  };
}

function account(accountId: string, trades: FifoTrade[], capitalReturns: FifoCapitalReturn[]) {
  return { accountId, coverageFrom: at(1), initialLots: [], trades, capitalReturns };
}

const bondLots = (lots: AccountFifoResult['lots']) =>
  lots.filter((lot) => lot.instrumentId === bond);

describe('CAPRET-FIFO-001 a capital return lowers the cost of the units held', () => {
  it('lowers one lot cost, keeps its quantity and brings the cash in as a lot', () => {
    const result = calculateOwnedTransfers(
      [account(a, [trade(1, 'buy', '10', '1000', 2)], [repayment(5, '100', 4)])],
      [],
    );
    const state = result.accounts.get(a)!;
    expect(bondLots(state.lots)).toEqual([
      expect.objectContaining({
        remainingQuantity: '10',
        remainingCostUsd: '900',
        originalCostUsd: '1000',
        returned: [expect.objectContaining({ capitalReturnId: id(5), usd: '100' })],
      }),
    ]);
    expect(state.lots.filter((lot) => lot.instrumentId === cash)).toEqual([
      expect.objectContaining({
        sourceKind: 'capital-return',
        remainingQuantity: '100',
        remainingCostUsd: '100',
        origin: expect.objectContaining({ kind: 'capital-return', capitalReturnId: id(5) }),
      }),
    ]);
    expect(state.summary).toMatchObject({
      grossBuysUsd: '1000',
      grossSalesUsd: '0',
      realizedUsd: '0',
      remainingCostUsd: '1000',
    });
    expect(state.capitalReturnSummary).toEqual({
      activeCount: 1,
      amountUsd: '100',
      appliedUsd: '100',
      realizedUsd: '0',
      unknownCostCount: 0,
    });
    expect(result.capitalReturnAllocations.get(id(5))).toMatchObject({
      appliedUsd: '100',
      realizedUsd: '0',
    });
  });

  it('shares the amount between the lots by the units each holds, to the last atom', () => {
    const state = calculateOwnedTransfers(
      [
        account(
          a,
          [trade(1, 'buy', '4', '400', 2), trade(2, 'buy', '6', '900', 3)],
          [repayment(5, '100', 4)],
        ),
      ],
      [],
    ).accounts.get(a)!;
    expect(bondLots(state.lots)).toEqual([
      expect.objectContaining({ remainingQuantity: '4', remainingCostUsd: '360' }),
      expect.objectContaining({ remainingQuantity: '6', remainingCostUsd: '840' }),
    ]);
  });

  it('empties every lot a return is larger than and returns only the cost the lots held', () => {
    const state = calculateOwnedTransfers(
      [
        account(
          a,
          [
            trade(1, 'buy', '1', '10', 2),
            trade(2, 'buy', '1', '10', 3),
            trade(3, 'buy', '1', '10', 4),
          ],
          [repayment(5, '100', 5)],
        ),
      ],
      [],
    ).accounts.get(a)!;
    const costs = bondLots(state.lots).map((lot) => canonicalDecimalToAtoms(lot.remainingCostUsd!));
    // 100 over 3 units is more than the 10 USD each lot cost: every lot hits zero.
    expect(costs).toEqual([0n, 0n, 0n]);
    const returned = bondLots(state.lots).flatMap((lot) => lot.returned ?? []);
    expect(returned.reduce((sum, part) => sum + canonicalDecimalToAtoms(part.usd), 0n)).toBe(
      canonicalDecimalToAtoms('30'),
    );
  });

  it('applies shares that add up to the amount when every lot can take its share', () => {
    const state = calculateOwnedTransfers(
      [
        account(
          a,
          [
            trade(1, 'buy', '1', '100', 2),
            trade(2, 'buy', '1', '100', 3),
            trade(3, 'buy', '1', '100', 4),
          ],
          [repayment(5, '100', 5)],
        ),
      ],
      [],
    ).accounts.get(a)!;
    const costs = bondLots(state.lots).map((lot) => canonicalDecimalToAtoms(lot.remainingCostUsd!));
    expect(costs.reduce((sum, cost) => sum + cost, 0n)).toBe(canonicalDecimalToAtoms('200'));
    expect(costs.every((cost) => cost > 0n)).toBe(true);
  });

  it('realizes what the remaining cost cannot take and keeps the cost at zero', () => {
    const result = calculateOwnedTransfers(
      [
        account(
          a,
          [trade(1, 'buy', '10', '50', 2)],
          [repayment(5, '30', 3), repayment(6, '50', 4)],
        ),
      ],
      [],
    );
    const state = result.accounts.get(a)!;
    expect(bondLots(state.lots)).toEqual([
      expect.objectContaining({ remainingQuantity: '10', remainingCostUsd: '0' }),
    ]);
    expect(result.capitalReturnAllocations.get(id(5))).toMatchObject({
      appliedUsd: '30',
      realizedUsd: '0',
    });
    expect(result.capitalReturnAllocations.get(id(6))).toMatchObject({
      appliedUsd: '20',
      realizedUsd: '30',
    });
    expect(state.summary.realizedUsd).toBe('30');
    expect(state.capitalReturnSummary).toMatchObject({
      activeCount: 2,
      amountUsd: '80',
      appliedUsd: '50',
      realizedUsd: '30',
    });
  });
});

describe('CAPRET-FIFO-002 a sale after a return consumes the lowered cost', () => {
  it('matches the lowered cost, says how much of it the return took, and realizes the rest', () => {
    const state = calculateOwnedTransfers(
      [
        account(
          a,
          [trade(1, 'buy', '10', '1000', 2), trade(2, 'sell', '5', '600', 5)],
          [repayment(5, '100', 4)],
        ),
      ],
      [],
    ).accounts.get(a)!;
    expect(state.matches).toEqual([
      expect.objectContaining({
        sellTradeId: id(2),
        quantity: '5',
        costUsd: '450',
        returned: [expect.objectContaining({ usd: '50' })],
      }),
    ]);
    expect(state.realizations).toEqual([
      expect.objectContaining({ consumedCostUsd: '450', realizedUsd: '150' }),
    ]);
    expect(bondLots(state.lots)).toEqual([
      expect.objectContaining({
        remainingQuantity: '5',
        remainingCostUsd: '450',
        returned: [expect.objectContaining({ usd: '50' })],
      }),
    ]);
  });

  it('only the units held when the return came back share it', () => {
    const state = calculateOwnedTransfers(
      [
        account(
          a,
          [
            trade(1, 'buy', '10', '1000', 2),
            trade(2, 'sell', '5', '600', 3),
            trade(3, 'buy', '5', '500', 5),
          ],
          [repayment(5, '100', 4)],
        ),
      ],
      [],
    ).accounts.get(a)!;
    expect(bondLots(state.lots)).toEqual([
      expect.objectContaining({ remainingQuantity: '5', remainingCostUsd: '400' }),
      expect.objectContaining({ remainingQuantity: '5', remainingCostUsd: '500' }),
    ]);
  });
});

describe('CAPRET-FIFO-003 missing cost stays missing', () => {
  it('leaves the cost unknown and the realized result unknown', () => {
    const result = calculateOwnedTransfers(
      [
        {
          accountId: a,
          coverageFrom: at(1),
          initialLots: [],
          trades: [],
          rewards: [
            {
              rewardId: id(1),
              version: 1,
              instrumentId: bond,
              instrumentName: 'Synthetic bond',
              instrumentSymbol: 'SYNB',
              category: 'other' as const,
              occurredAt: at(2),
              orderWithinTimestamp: 1,
              quantity: '10',
              acquisitionBasisUsd: null,
              incomeValueUsd: null,
            },
          ],
          capitalReturns: [repayment(5, '100', 4)],
        },
      ],
      [],
    );
    const state = result.accounts.get(a)!;
    expect(bondLots(state.lots)).toEqual([
      expect.objectContaining({ remainingCostUsd: null, remainingQuantity: '10' }),
    ]);
    expect(state.capitalReturnSummary).toMatchObject({
      appliedUsd: null,
      realizedUsd: null,
      unknownCostCount: 1,
    });
    expect(state.summary.realizedUsd).toBeNull();
    expect(result.capitalReturnAllocations.get(id(5))).toMatchObject({
      realizedUsd: null,
      unknownCostCount: 1,
    });
  });
});

describe('CAPRET-FIFO-004 a return needs units to lower', () => {
  it('refuses a return when none of the asset is held', () => {
    expect(() => calculateOwnedTransfers([account(a, [], [repayment(5, '100', 4)])], [])).toThrow(
      FifoHistoryError,
    );
  });

  it('refuses a return after everything was sold', () => {
    expect(() =>
      calculateOwnedTransfers(
        [
          account(
            a,
            [trade(1, 'buy', '2', '200', 2), trade(2, 'sell', '2', '210', 3)],
            [repayment(5, '100', 4)],
          ),
        ],
        [],
      ),
    ).toThrow(FifoHistoryError);
  });

  it('refuses a return that shares an instant with another record of the account', () => {
    expect(() =>
      calculateOwnedTransfers(
        [account(a, [trade(5, 'buy', '2', '200', 4)], [repayment(5, '100', 4)])],
        [],
      ),
    ).toThrow(FifoHistoryError);
  });

  it('refuses a duplicate return id', () => {
    expect(() =>
      calculateOwnedTransfers(
        [
          account(
            a,
            [trade(1, 'buy', '2', '200', 2)],
            [repayment(5, '10', 4), { ...repayment(5, '10', 5), orderWithinTimestamp: 6 }],
          ),
        ],
        [],
      ),
    ).toThrow(FifoHistoryError);
  });

  it('is not part of the as-of prefix before its instant', () => {
    const state = calculateOwnedTransfers(
      [account(a, [trade(1, 'buy', '10', '1000', 2)], [repayment(5, '100', 6)])],
      [],
      at(5),
    ).accounts.get(a)!;
    expect(bondLots(state.lots)).toEqual([expect.objectContaining({ remainingCostUsd: '1000' })]);
    expect(state.capitalReturnSummary).toMatchObject({ activeCount: 0, amountUsd: '0' });
  });
});

describe('CAPRET-FIFO-005 a transfer carries what a return took', () => {
  it('keeps the lowered cost and the returned part in the account that receives the units', () => {
    const state = calculateOwnedTransfers(
      [
        account(a, [trade(1, 'buy', '10', '1000', 2)], [repayment(5, '100', 3)]),
        { accountId: b, coverageFrom: at(1), initialLots: [], trades: [] },
      ],
      [
        {
          transferId: id(9),
          version: 1,
          fromAccountId: a,
          toAccountId: b,
          instrumentId: bond,
          occurredAt: at(4),
          orderWithinTimestamp: 9,
          quantity: '4',
          feeInstrumentId: null,
          feeQuantity: '0',
        },
      ],
    );
    const received = bondLots(state.accounts.get(b)!.lots);
    expect(received).toEqual([
      expect.objectContaining({
        sourceKind: 'transfer',
        remainingQuantity: '4',
        remainingCostUsd: '360',
        returned: [expect.objectContaining({ usd: '40' })],
      }),
    ]);
    expect(bondLots(state.accounts.get(a)!.lots)).toEqual([
      expect.objectContaining({
        remainingQuantity: '6',
        remainingCostUsd: '540',
        returned: [expect.objectContaining({ usd: '60' })],
      }),
    ]);
    expect(state.allocations.get(id(9))).toMatchObject({ principalBasisUsd: '360' });
  });
});

describe('CAPRET-FIFO-006 the amount as paid stays exact', () => {
  it('splits the paid amount with the cost it lowered and keeps the cash in its currency', () => {
    const result = calculateOwnedTransfers(
      [account(a, [trade(1, 'buy', '10', '1000', 2)], [repayment(5, '100', 4, 'RUB', '9000')])],
      [],
    );
    const state = result.accounts.get(a)!;
    expect(bondLots(state.lots)).toEqual([
      expect.objectContaining({
        returned: [
          expect.objectContaining({
            usd: '100',
            native: { currency: 'RUB', amount: '9000' },
          }),
        ],
      }),
    ]);
    expect(result.capitalReturnAllocations.get(id(5))).toMatchObject({
      realizedNative: { currency: 'RUB', amount: '0' },
    });
  });

  it('realizes the paid amount in the same share as the USD it could not lower', () => {
    const result = calculateOwnedTransfers(
      [account(a, [trade(1, 'buy', '10', '60', 2)], [repayment(5, '100', 4, 'RUB', '9000')])],
      [],
    );
    expect(result.capitalReturnAllocations.get(id(5))).toMatchObject({
      appliedUsd: '60',
      realizedUsd: '40',
      realizedNative: { currency: 'RUB', amount: '3600' },
    });
  });
});
