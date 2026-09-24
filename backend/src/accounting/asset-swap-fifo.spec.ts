import type { FifoReward } from './asset-reward-types';
import { FifoHistoryError, type FifoTrade } from './fifo';
import { projectHistoricalFifo } from './historical-accounting';
import { calculateOwnedTransfers } from './owned-transfer-fifo';

const source = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const receiver = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const token = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const stable = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const atom = '0.000000000000000000000000000001';
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const at = (day: number) => `2025-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;

function trade(
  n: number,
  instrumentId: string,
  side: 'buy' | 'sell',
  quantity: string,
  grossUsd: string,
  day: number,
  orderWithinTimestamp = 0,
): FifoTrade {
  return {
    tradeId: id(n),
    version: 1,
    instrumentId,
    instrumentName: instrumentId === token ? 'TOKEN' : 'STABLE',
    instrumentSymbol: 'SAME',
    side,
    occurredAt: at(day),
    orderWithinTimestamp,
    quantity,
    grossUsd,
    feeUsd: '0',
  };
}

type SwapInput = {
  swapId: string;
  version: number;
  outgoingInstrumentId: string;
  outgoingInstrumentName: string;
  outgoingInstrumentSymbol: string | null;
  incomingInstrumentId: string;
  incomingInstrumentName: string;
  incomingInstrumentSymbol: string | null;
  occurredAt: string;
  orderWithinTimestamp: number;
  outgoingQuantity: string;
  incomingQuantity: string;
  considerationUsd: string | null;
  feeSource: 'held' | 'incoming' | null;
  feeInstrumentId: string | null;
  feeQuantity: string;
};

function swap(n: number, changes: Partial<SwapInput> = {}): SwapInput {
  return {
    swapId: id(n),
    version: 1,
    outgoingInstrumentId: token,
    outgoingInstrumentName: 'TOKEN',
    outgoingInstrumentSymbol: 'SAME',
    incomingInstrumentId: stable,
    incomingInstrumentName: 'STABLE',
    incomingInstrumentSymbol: 'SAME',
    occurredAt: at(3),
    orderWithinTimestamp: n,
    outgoingQuantity: '1',
    incomingQuantity: '3',
    considerationUsd: '150',
    feeSource: null,
    feeInstrumentId: null,
    feeQuantity: '0',
    ...changes,
  };
}

function account(
  accountId: string,
  trades: FifoTrade[] = [],
  swaps: SwapInput[] = [],
  rewards: FifoReward[] = [],
) {
  return { accountId, coverageFrom: at(1), initialLots: [], trades, swaps, rewards };
}

function transfer(
  n: number,
  fromAccountId: string,
  toAccountId: string,
  quantity: string,
  day: number,
) {
  return {
    transferId: id(n),
    version: 1,
    fromAccountId,
    toAccountId,
    instrumentId: stable,
    occurredAt: at(day),
    orderWithinTimestamp: n,
    quantity,
    feeInstrumentId: null,
    feeQuantity: '0',
  };
}

function allocation(result: ReturnType<typeof calculateOwnedTransfers>, swapId: string): unknown {
  return (
    result as unknown as { swapAllocations?: ReadonlyMap<string, unknown> }
  ).swapAllocations?.get(swapId);
}

function summary(state: unknown): unknown {
  return (state as { swapSummary?: unknown }).swapSummary;
}

function positions(result: ReturnType<typeof calculateOwnedTransfers>, accountId: string) {
  return projectHistoricalFifo(result.accounts.get(accountId)!, []).positions;
}

// These tests use the existing public projector with a structural extra `swaps` input.
// The predecessor compiles and ignores swaps, so failures are behavioral rather than missing-module failures.
describe('SWAP-001 exact atomic exchange and missing evidence', () => {
  it('conserves two FIFO buys while a crypto-to-stablecoin exchange creates no USD trades', () => {
    const exchange = swap(100, {
      outgoingQuantity: '1.5',
      incomingQuantity: '450',
      considerationUsd: '450',
    });
    const result = calculateOwnedTransfers(
      [
        account(
          source,
          [trade(1, token, 'buy', '1', '100', 1), trade(2, token, 'buy', '1', '200', 2)],
          [exchange],
        ),
      ],
      [],
    );
    const state = result.accounts.get(source)!;
    expect(state.summary).toEqual({
      grossBuysUsd: '300',
      buyFeesUsd: '0',
      grossSalesUsd: '0',
      sellFeesUsd: '0',
      netSalesUsd: '0',
      consumedCostUsd: '0',
      realizedUsd: '0',
      remainingCostUsd: '550',
    });
    expect(positions(result, source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instrumentId: token, quantity: '0.5', costUsd: '100' }),
        expect.objectContaining({ instrumentId: stable, quantity: '450', costUsd: '450' }),
      ]),
    );
    expect(state).toMatchObject({
      swapSummary: {
        activeCount: 1,
        considerationUsd: '450',
        principalBasisUsd: '200',
        feeConsumedBasisUsd: '0',
        realizedUsd: '250',
      },
    });
    expect(allocation(result, exchange.swapId)).toMatchObject({
      considerationUsd: '450',
      principalBasisUsd: '200',
      feeConsumedBasisUsd: '0',
      realizedUsd: '250',
      items: [
        expect.objectContaining({ kind: 'principal', quantity: '1', costUsd: '100' }),
        expect.objectContaining({ kind: 'principal', quantity: '0.5', costUsd: '100' }),
      ],
    });
  });

  it('keeps missing consideration unknown and an explicit zero known after correction', () => {
    const original = swap(101, { considerationUsd: null });
    const bought = trade(1, token, 'buy', '1', '100', 1);
    const missing = calculateOwnedTransfers([account(source, [bought], [original])], []);
    expect(positions(missing, source)).toEqual([
      expect.objectContaining({
        instrumentId: stable,
        quantity: '3',
        costUsd: null,
        unknownCostQuantity: '3',
      }),
    ]);
    expect(missing.accounts.get(source)).toMatchObject({
      swapSummary: {
        considerationUsd: null,
        principalBasisUsd: '100',
        feeConsumedBasisUsd: '0',
        realizedUsd: null,
        coverage: {
          consideration: { knownSubtotalUsd: '0', unknownCount: 1 },
          principal: { knownSubtotalUsd: '100', unknownCount: 0 },
          fee: { knownSubtotalUsd: '0', unknownCount: 0 },
          realized: { knownSubtotalUsd: '0', unknownCount: 1 },
        },
      },
    });
    const corrected = calculateOwnedTransfers(
      [account(source, [bought], [{ ...original, version: 2, considerationUsd: '0' }])],
      [],
    );
    expect(positions(corrected, source)).toEqual([
      expect.objectContaining({ instrumentId: stable, quantity: '3', costUsd: '0' }),
    ]);
    expect(corrected.accounts.get(source)).toMatchObject({
      swapSummary: { considerationUsd: '0', principalBasisUsd: '100', realizedUsd: '-100' },
    });
    expect(original.considerationUsd).toBeNull();
    expect(corrected.accounts.get(source)!.summary.realizedUsd).toBe('0');
  });
});

describe('SWAP-002 fee source, cost evidence and original intervals', () => {
  it('withholds an incoming fee from the new lot without touching an older same-UUID lot', () => {
    const oldStable = trade(2, stable, 'buy', '1', '1', 1, 1);
    const tokenBuy = trade(1, token, 'buy', '1', '100', 1);
    const incoming = swap(102, {
      feeSource: 'incoming',
      feeInstrumentId: stable,
      feeQuantity: '0.1',
    });
    const held = { ...incoming, feeSource: 'held' as const };
    const incomingResult = calculateOwnedTransfers(
      [account(source, [tokenBuy, oldStable], [incoming])],
      [],
    );
    expect(incomingResult.accounts.get(source)!.lots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          buyTradeId: oldStable.tradeId,
          remainingQuantity: '1',
          remainingCostUsd: '1',
        }),
        expect.objectContaining({
          sourceKind: 'swap',
          intervalStart: '0.1',
          intervalEnd: '3',
          remainingQuantity: '2.9',
          remainingCostUsd: '145',
        }),
      ]),
    );
    expect(allocation(incomingResult, incoming.swapId)).toMatchObject({
      feeConsumedBasisUsd: '5',
      realizedUsd: '45',
      items: [
        expect.objectContaining({ kind: 'principal', instrumentId: token, costUsd: '100' }),
        expect.objectContaining({
          kind: 'fee',
          instrumentId: stable,
          costUsd: '5',
          intervalStart: '0',
          intervalEnd: '0.1',
          origin: expect.objectContaining({ kind: 'swap', swapId: incoming.swapId }),
        }),
      ],
    });
    const heldResult = calculateOwnedTransfers(
      [account(source, [tokenBuy, oldStable], [held])],
      [],
    );
    expect(heldResult.accounts.get(source)!.lots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          buyTradeId: oldStable.tradeId,
          remainingQuantity: '0.9',
          remainingCostUsd: '0.9',
        }),
        expect.objectContaining({
          sourceKind: 'swap',
          intervalStart: '0',
          intervalEnd: '3',
          remainingQuantity: '3',
          remainingCostUsd: '150',
        }),
      ]),
    );
    expect(allocation(heldResult, held.swapId)).toMatchObject({
      feeConsumedBasisUsd: '0.1',
      realizedUsd: '49.9',
    });
  });

  it('debits principal before a held source fee and rejects every unfunded prefix', () => {
    const exchange = swap(103, {
      outgoingQuantity: '1.5',
      incomingQuantity: '450',
      considerationUsd: '450',
      feeSource: 'held',
      feeInstrumentId: token,
      feeQuantity: '0.1',
    });
    const buys = [trade(1, token, 'buy', '1', '100', 1), trade(2, token, 'buy', '1', '200', 2)];
    const result = calculateOwnedTransfers([account(source, buys, [exchange])], []);
    expect(positions(result, source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instrumentId: token, quantity: '0.4', costUsd: '80' }),
        expect.objectContaining({ instrumentId: stable, quantity: '450', costUsd: '450' }),
      ]),
    );
    expect(allocation(result, exchange.swapId)).toMatchObject({
      principalBasisUsd: '200',
      feeConsumedBasisUsd: '20',
      realizedUsd: '230',
      items: [
        expect.objectContaining({ kind: 'principal', quantity: '1', costUsd: '100' }),
        expect.objectContaining({ kind: 'principal', quantity: '0.5', costUsd: '100' }),
        expect.objectContaining({ kind: 'fee', quantity: '0.1', costUsd: '20' }),
      ],
    });
    expect(() =>
      calculateOwnedTransfers(
        [account(source, [trade(4, token, 'buy', '1.5', '150', 1)], [exchange])],
        [],
      ),
    ).toThrow(FifoHistoryError);
    expect(() =>
      calculateOwnedTransfers(
        [
          account(source, buys, [
            swap(104, { feeSource: 'incoming', feeInstrumentId: stable, feeQuantity: '451' }),
          ]),
        ],
        [],
      ),
    ).toThrow(FifoHistoryError);
  });

  it('does not turn an unknown reward basis into zero or poison declared incoming basis', () => {
    const unknownReward = {
      rewardId: id(20),
      version: 1,
      instrumentId: token,
      instrumentName: 'TOKEN',
      instrumentSymbol: 'SAME',
      category: 'staking' as const,
      occurredAt: at(2),
      orderWithinTimestamp: 0,
      quantity: '1',
      acquisitionBasisUsd: null,
      incomeValueUsd: null,
    };
    const exchange = swap(105);
    const result = calculateOwnedTransfers([account(source, [], [exchange], [unknownReward])], []);
    expect(positions(result, source)).toEqual([
      expect.objectContaining({ instrumentId: stable, quantity: '3', costUsd: '150' }),
    ]);
    expect(allocation(result, exchange.swapId)).toMatchObject({
      considerationUsd: '150',
      principalBasisUsd: null,
      feeConsumedBasisUsd: '0',
      realizedUsd: null,
      coverage: { realized: { knownSubtotalUsd: '0', unknownCount: 1 } },
      items: [
        expect.objectContaining({
          kind: 'principal',
          costUsd: null,
          origin: expect.objectContaining({ kind: 'reward', rewardId: unknownReward.rewardId }),
        }),
      ],
    });
    expect(result.accounts.get(source)).toMatchObject({
      swapSummary: {
        realizedUsd: null,
        coverage: { realized: { knownSubtotalUsd: '0', unknownCount: 1 } },
      },
    });
    expect(result.accounts.get(source)!.summary).toMatchObject({
      grossSalesUsd: '0',
      realizedUsd: '0',
      remainingCostUsd: '150',
    });
  });

  it('allocates one cost atom from gross incoming coordinates across fee, sale and transfer', () => {
    const exchange = swap(106, {
      incomingQuantity: '3',
      considerationUsd: atom,
      feeSource: 'incoming',
      feeInstrumentId: stable,
      feeQuantity: '1',
    });
    const sale = trade(30, stable, 'sell', '1', '1', 4);
    const movement = transfer(200, source, receiver, '1', 5);
    const result = calculateOwnedTransfers(
      [account(source, [trade(1, token, 'buy', '1', '1', 1), sale], [exchange]), account(receiver)],
      [movement],
    );
    expect(allocation(result, exchange.swapId)).toMatchObject({
      feeConsumedBasisUsd: '0',
      items: [
        expect.objectContaining({
          kind: 'principal',
          instrumentId: token,
          quantity: '1',
          costUsd: '1',
        }),
        expect.objectContaining({
          kind: 'fee',
          origin: expect.objectContaining({ kind: 'swap', swapId: exchange.swapId }),
          intervalStart: '0',
          intervalEnd: '1',
          costUsd: '0',
        }),
      ],
    });
    expect(result.accounts.get(source)!.matches).toEqual([
      expect.objectContaining({
        sourceKind: 'swap',
        intervalStart: '1',
        intervalEnd: '2',
        costUsd: '0',
      }),
    ]);
    expect(result.allocations.get(movement.transferId)).toMatchObject({
      principalBasisUsd: atom,
      items: [
        expect.objectContaining({
          origin: expect.objectContaining({ kind: 'swap', swapId: exchange.swapId }),
          intervalStart: '2',
          intervalEnd: '3',
          costUsd: atom,
        }),
      ],
    });
    expect(positions(result, receiver)).toEqual([
      expect.objectContaining({ instrumentId: stable, quantity: '1', costUsd: atom }),
    ]);
    const fullFee = swap(107, {
      incomingQuantity: '3',
      considerationUsd: atom,
      feeSource: 'incoming',
      feeInstrumentId: stable,
      feeQuantity: '3',
    });
    const fullyWithheld = calculateOwnedTransfers(
      [account(source, [trade(2, token, 'buy', '1', '1', 1)], [fullFee])],
      [],
    );
    expect(positions(fullyWithheld, source)).toEqual([]);
    expect(allocation(fullyWithheld, fullFee.swapId)).toMatchObject({
      feeConsumedBasisUsd: atom,
      realizedUsd: '-1',
      items: [
        expect.objectContaining({
          kind: 'principal',
          instrumentId: token,
          quantity: '1',
          costUsd: '1',
        }),
        expect.objectContaining({
          kind: 'fee',
          instrumentId: stable,
          quantity: '3',
          origin: expect.objectContaining({ kind: 'swap', swapId: fullFee.swapId }),
          intervalStart: '0',
          intervalEnd: '3',
          costUsd: atom,
        }),
      ],
    });
  });
});

describe('SWAP-003/004 connected chronology, provenance and bounded replay', () => {
  it('restates a downstream sale from declared consideration and rejects an invalid void', () => {
    const exchange = swap(108);
    const movement = transfer(201, source, receiver, '2', 4);
    const sale = trade(31, stable, 'sell', '1', '80', 5);
    const base = [
      account(source, [trade(1, token, 'buy', '1', '100', 1)], [exchange]),
      account(receiver, [sale]),
    ];
    const original = calculateOwnedTransfers(base, [movement]);
    const corrected = calculateOwnedTransfers(
      [
        account(
          source,
          [trade(1, token, 'buy', '1', '100', 1)],
          [{ ...exchange, version: 2, considerationUsd: '180' }],
        ),
        account(receiver, [sale]),
      ],
      [movement],
    );
    expect(original.accounts.get(receiver)!.summary).toMatchObject({
      consumedCostUsd: '50',
      realizedUsd: '30',
    });
    expect(corrected.accounts.get(receiver)!.summary).toMatchObject({
      consumedCostUsd: '60',
      realizedUsd: '20',
    });
    expect(corrected.allocations.get(movement.transferId)).toMatchObject({
      principalBasisUsd: '120',
    });
    expect(corrected.accounts.get(source)).toMatchObject({
      swapSummary: { considerationUsd: '180', realizedUsd: '80' },
    });
    expect(() =>
      calculateOwnedTransfers(
        [account(source, [trade(1, token, 'buy', '1', '100', 1)]), account(receiver, [sale])],
        [movement],
      ),
    ).toThrow(FifoHistoryError);
  });

  it('publishes both legs at the exact instant and never exposes a future event in an earlier prefix', () => {
    const exchange = swap(109);
    const accounts = [account(source, [trade(1, token, 'buy', '1', '100', 1)], [exchange])];
    const before = calculateOwnedTransfers(accounts, [], at(2));
    const atExchange = calculateOwnedTransfers(accounts, [], at(3));
    expect(positions(before, source)).toEqual([
      expect.objectContaining({ instrumentId: token, quantity: '1', costUsd: '100' }),
    ]);
    expect(summary(before.accounts.get(source))).toMatchObject({
      activeCount: 0,
      considerationUsd: '0',
      realizedUsd: '0',
    });
    expect(positions(atExchange, source)).toEqual([
      expect.objectContaining({ instrumentId: stable, quantity: '3', costUsd: '150' }),
    ]);
    expect(atExchange.accounts.get(source)).toMatchObject({
      swapSummary: { activeCount: 1, realizedUsd: '50' },
    });
    expect(() =>
      calculateOwnedTransfers(
        [
          account(
            source,
            [
              trade(1, token, 'buy', '1', '100', 1),
              trade(4, stable, 'buy', '1', '1', 3, exchange.orderWithinTimestamp),
            ],
            [exchange],
          ),
        ],
        [],
      ),
    ).toThrow(FifoHistoryError);
  });

  it('retains original swap coordinates through transfer and return, with a single source summary', () => {
    const exchange = swap(110);
    const out = transfer(202, source, receiver, '2', 4);
    const back = { ...transfer(203, receiver, source, '1', 5), instrumentId: stable };
    const sale = trade(32, stable, 'sell', '1', '80', 6);
    const result = calculateOwnedTransfers(
      [
        account(source, [trade(1, token, 'buy', '1', '100', 1), sale], [exchange]),
        account(receiver),
      ],
      [out, back],
    );
    expect(result.allocations.get(out.transferId)).toMatchObject({
      items: [
        expect.objectContaining({
          origin: expect.objectContaining({ kind: 'swap', swapId: exchange.swapId, version: 1 }),
          intervalStart: '0',
          intervalEnd: '2',
        }),
      ],
    });
    expect(result.allocations.get(back.transferId)).toMatchObject({
      items: [
        expect.objectContaining({
          origin: expect.objectContaining({ kind: 'swap', swapId: exchange.swapId, version: 1 }),
          intervalStart: '0',
          intervalEnd: '1',
          arrival: expect.objectContaining({ transferId: out.transferId }),
        }),
      ],
    });
    expect(result.accounts.get(source)!.matches).toEqual([
      expect.objectContaining({
        sourceKind: 'transfer',
        origin: expect.objectContaining({ kind: 'swap', swapId: exchange.swapId }),
        arrival: expect.objectContaining({ transferId: back.transferId }),
        intervalStart: '0',
        intervalEnd: '1',
        costUsd: '50',
      }),
    ]);
    expect(result.accounts.get(source)).toMatchObject({
      swapSummary: { activeCount: 1, realizedUsd: '50' },
    });
    expect(summary(result.accounts.get(receiver))).toBeUndefined();
  });

  it('accepts exactly 1000 active swaps and refuses the 1001st without truncation', () => {
    const swaps = Array.from({ length: 1001 }, (_, index) =>
      swap(index + 1000, {
        orderWithinTimestamp: index,
        incomingQuantity: '1',
        considerationUsd: '1',
      }),
    );
    const funded = trade(1, token, 'buy', '1001', '1001', 1);
    const boundary = calculateOwnedTransfers([account(source, [funded], swaps.slice(0, 1000))], []);
    expect(boundary.accounts.get(source)).toMatchObject({
      swapSummary: {
        activeCount: 1000,
        considerationUsd: '1000',
        principalBasisUsd: '1000',
        realizedUsd: '0',
      },
    });
    expect(positions(boundary, source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instrumentId: token, quantity: '1', costUsd: '1' }),
        expect.objectContaining({ instrumentId: stable, quantity: '1000', costUsd: '1000' }),
      ]),
    );
    expect(() => calculateOwnedTransfers([account(source, [funded], swaps)], [])).toThrow(
      FifoHistoryError,
    );
  });
});
