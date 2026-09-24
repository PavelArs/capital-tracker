import { type FifoCarryInInput, FifoHistoryError, type FifoTrade, calculateFifo } from './fifo';
import { calculateOwnedTransfers } from './owned-transfer-fifo';

const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const accountC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const token = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const feeToken = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const atom = '0.000000000000000000000000000001';
const twoAtoms = '0.000000000000000000000000000002';
const threeAtoms = '0.000000000000000000000000000003';

function uuid(number: number): string {
  return `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
}

function day(number: number): string {
  return new Date(Date.UTC(2026, 0, number)).toISOString();
}

function trade(
  number: number,
  accountInstrument: string,
  side: 'buy' | 'sell',
  quantity: string,
  grossUsd: string,
  date: number,
  order = 0,
): FifoTrade {
  return {
    tradeId: uuid(number),
    version: 1,
    instrumentId: accountInstrument,
    instrumentName: accountInstrument === token ? 'Token' : 'Fee token',
    instrumentSymbol: 'SAME',
    side,
    occurredAt: day(date),
    orderWithinTimestamp: order,
    quantity,
    grossUsd,
    feeUsd: '0',
  };
}

function account(
  accountId: string,
  trades: readonly FifoTrade[] = [],
  initialLots: readonly FifoCarryInInput[] = [],
  coverageFrom = day(1),
) {
  return { accountId, coverageFrom, trades, initialLots };
}

function transfer(
  number: number,
  fromAccountId: string,
  toAccountId: string,
  quantity: string,
  date: number,
  options: { order?: number; feeInstrumentId?: string | null; feeQuantity?: string } = {},
) {
  return {
    transferId: uuid(number),
    version: 1,
    fromAccountId,
    toAccountId,
    instrumentId: token,
    occurredAt: day(date),
    orderWithinTimestamp: options.order ?? 0,
    quantity,
    feeInstrumentId: options.feeInstrumentId ?? null,
    feeQuantity: options.feeQuantity ?? '0',
  };
}

describe('OWNED-TRANSFER-FIFO exact economic projection', () => {
  it('moves FIFO basis, consumes the same-asset fee after principal, and leaves trade profit separate', () => {
    const first = trade(1, token, 'buy', '1', '100', 1);
    const second = trade(2, token, 'buy', '1', '200', 2);
    const sale = trade(3, token, 'sell', '1.2', '360', 5);
    const movement = transfer(101, accountA, accountB, '1.5', 3, {
      feeInstrumentId: token,
      feeQuantity: '0.1',
    });
    const result = calculateOwnedTransfers(
      [account(accountA, [first, second]), account(accountB, [sale])],
      [movement],
    );
    const sender = result.accounts.get(accountA)!;
    const receiver = result.accounts.get(accountB)!;
    const allocation = result.allocations.get(movement.transferId)!;

    expect(sender.summary).toMatchObject({
      grossBuysUsd: '300',
      grossSalesUsd: '0',
      realizedUsd: '0',
      remainingCostUsd: '80',
    });
    expect(receiver.summary).toMatchObject({
      grossBuysUsd: '0',
      grossSalesUsd: '360',
      consumedCostUsd: '140',
      realizedUsd: '220',
      remainingCostUsd: '60',
    });
    expect(sender.transferSummary).toMatchObject({
      receivedBasisUsd: '0',
      sentBasisUsd: '200',
      feeConsumedBasisUsd: '20',
      fees: [{ instrumentId: token, quantity: '0.1', consumedBasisUsd: '20' }],
    });
    expect(receiver.transferSummary).toMatchObject({
      receivedBasisUsd: '200',
      sentBasisUsd: '0',
      feeConsumedBasisUsd: '0',
      fees: [],
    });
    expect(allocation).toMatchObject({
      transferId: movement.transferId,
      principalBasisUsd: '200',
      feeConsumedBasisUsd: '20',
      items: [
        { kind: 'principal', instrumentId: token, quantity: '1', costUsd: '100' },
        { kind: 'principal', instrumentId: token, quantity: '0.5', costUsd: '100' },
        { kind: 'fee', instrumentId: token, quantity: '0.1', costUsd: '20' },
      ],
    });
    expect(allocation.items[0]).toMatchObject({
      origin: { accountId: accountA, kind: 'trade', tradeId: first.tradeId, version: 1 },
      arrival: null,
      intervalStart: '0',
      intervalEnd: '1',
    });
    expect(receiver.realizations).toEqual([
      expect.objectContaining({
        sellTradeId: sale.tradeId,
        consumedCostUsd: '140',
        realizedUsd: '220',
      }),
    ]);
    expect(receiver.matches).toEqual([
      expect.objectContaining({ sellTradeId: sale.tradeId, quantity: '1', costUsd: '100' }),
      expect.objectContaining({ sellTradeId: sale.tradeId, quantity: '0.2', costUsd: '40' }),
    ]);
  });

  it('replays a corrected old source buy through the receiver sale without changing unrelated tail basis', () => {
    const initial = [trade(1, token, 'buy', '1', '100', 1), trade(2, token, 'buy', '1', '200', 2)];
    const sale = trade(3, token, 'sell', '1.2', '360', 5);
    const movement = transfer(101, accountA, accountB, '1.5', 3, {
      feeInstrumentId: token,
      feeQuantity: '0.1',
    });
    const accounts = [account(accountA, initial), account(accountB, [sale])];
    const before = calculateOwnedTransfers(accounts, [movement]);
    const corrected = calculateOwnedTransfers(
      [
        account(accountA, [{ ...initial[0], version: 2, grossUsd: '120' }, initial[1]]),
        account(accountB, [sale]),
      ],
      [movement],
    );

    expect(before.accounts.get(accountB)!.summary.realizedUsd).toBe('220');
    expect(corrected.accounts.get(accountB)!.summary).toMatchObject({
      consumedCostUsd: '160',
      realizedUsd: '200',
      remainingCostUsd: '60',
    });
    expect(corrected.accounts.get(accountA)!.summary.remainingCostUsd).toBe('80');
    expect(corrected.allocations.get(movement.transferId)).toMatchObject({
      principalBasisUsd: '220',
      feeConsumedBasisUsd: '20',
    });
    expect(initial[0].grossUsd).toBe('100');
  });

  it('consumes a distinct fee instrument by UUID even when symbols match', () => {
    const movement = transfer(101, accountA, accountB, '0.5', 3, {
      feeInstrumentId: feeToken,
      feeQuantity: '0.2',
    });
    const result = calculateOwnedTransfers(
      [
        account(accountA, [
          trade(1, token, 'buy', '1', '100', 1),
          trade(2, feeToken, 'buy', '1', '70', 2),
        ]),
        account(accountB),
      ],
      [movement],
    );
    const allocation = result.allocations.get(movement.transferId)!;
    expect(allocation).toMatchObject({
      principalBasisUsd: '50',
      feeConsumedBasisUsd: '14',
      items: [
        { kind: 'principal', instrumentId: token, quantity: '0.5', costUsd: '50' },
        { kind: 'fee', instrumentId: feeToken, quantity: '0.2', costUsd: '14' },
      ],
    });
    expect(result.accounts.get(accountA)!.transferSummary?.fees).toEqual([
      expect.objectContaining({ instrumentId: feeToken, quantity: '0.2', consumedBasisUsd: '14' }),
    ]);
    expect(result.accounts.get(accountA)!.summary.remainingCostUsd).toBe('106');
    expect(result.accounts.get(accountB)!.summary.remainingCostUsd).toBe('50');
  });

  it('keeps original atom coordinates across a transfer chain and partial roundtrip', () => {
    const first = transfer(101, accountA, accountB, twoAtoms, 2);
    const returned = transfer(102, accountB, accountA, atom, 3);
    const sale = trade(2, token, 'sell', atom, atom, 4);
    const result = calculateOwnedTransfers(
      [account(accountA, [trade(1, token, 'buy', threeAtoms, atom, 1), sale]), account(accountB)],
      [first, returned],
    );
    expect(result.allocations.get(first.transferId)).toMatchObject({
      principalBasisUsd: '0',
      feeConsumedBasisUsd: '0',
    });
    expect(result.allocations.get(returned.transferId)).toMatchObject({
      principalBasisUsd: '0',
      items: [
        {
          kind: 'principal',
          intervalStart: '0',
          intervalEnd: atom,
          arrival: { transferId: first.transferId, version: 1 },
        },
      ],
    });
    expect(result.accounts.get(accountA)!.realizations[0]).toMatchObject({
      consumedCostUsd: '0',
      realizedUsd: atom,
    });
    expect(result.accounts.get(accountA)!.summary.remainingCostUsd).toBe(atom);
    expect(result.accounts.get(accountB)!.summary.remainingCostUsd).toBe('0');
    expect(result.accounts.get(accountA)!.lots).toEqual([
      expect.objectContaining({ remainingQuantity: atom, remainingCostUsd: atom }),
    ]);
  });

  it('does not expose an older origin before arrival, then gives it FIFO priority', () => {
    const priorSale = trade(3, token, 'sell', '0.5', '150', 3);
    const laterSale = trade(4, token, 'sell', '0.5', '150', 5);
    const movement = transfer(101, accountA, accountB, '1', 4);
    const result = calculateOwnedTransfers(
      [
        account(accountA, [trade(1, token, 'buy', '1', '100', 1)]),
        account(accountB, [trade(2, token, 'buy', '1', '200', 2), priorSale, laterSale]),
      ],
      [movement],
    );
    expect(result.accounts.get(accountB)!.realizations).toEqual([
      expect.objectContaining({ sellTradeId: priorSale.tradeId, consumedCostUsd: '100' }),
      expect.objectContaining({ sellTradeId: laterSale.tradeId, consumedCostUsd: '50' }),
    ]);
    expect(result.accounts.get(accountB)!.matches).toEqual([
      expect.objectContaining({ sellTradeId: priorSale.tradeId, buyTradeId: uuid(2) }),
      expect.objectContaining({ sellTradeId: laterSale.tradeId, sourceKind: 'transfer' }),
    ]);
    expect(result.accounts.get(accountB)!.summary.remainingCostUsd).toBe('150');
  });

  it('includes both legs and fee at the exact historical instant, but not before it', () => {
    const movement = transfer(101, accountA, accountB, '0.5', 3, {
      feeInstrumentId: token,
      feeQuantity: '0.1',
    });
    const futureBaseline: FifoCarryInInput = {
      lotId: uuid(7000),
      openingRevision: 1,
      ordinal: 1,
      instrumentId: feeToken,
      instrumentName: 'Fee token',
      instrumentSymbol: 'SAME',
      acquiredAt: day(3),
      orderWithinTimestamp: 0,
      originalQuantity: '1',
      originalCostUsd: '30',
      carriedQuantity: '1',
    };
    const accounts = [
      account(accountA, [trade(1, token, 'buy', '1', '100', 1)]),
      account(accountB, [], [futureBaseline], day(3)),
    ];
    const before = calculateOwnedTransfers(accounts, [movement], day(2));
    const at = calculateOwnedTransfers(accounts, [movement], day(3));
    expect(before.accounts.get(accountA)!.summary.remainingCostUsd).toBe('100');
    expect(before.accounts.get(accountB)!.summary.remainingCostUsd).toBe('0');
    expect(before.accounts.get(accountB)!.lots).toEqual([]);
    expect(before.allocations.size).toBe(0);
    expect(at.accounts.get(accountA)!.summary.remainingCostUsd).toBe('40');
    expect(at.accounts.get(accountB)!.summary.remainingCostUsd).toBe('80');
    expect(at.allocations.get(movement.transferId)).toMatchObject({
      principalBasisUsd: '50',
      feeConsumedBasisUsd: '10',
    });
  });

  it('rejects a transfer before either account coverage or a touched-account same-key collision', () => {
    const first = trade(1, token, 'buy', '1', '100', 1);
    expect(() =>
      calculateOwnedTransfers(
        [account(accountA, [first]), account(accountB, [], [], day(4))],
        [transfer(101, accountA, accountB, '0.5', 3)],
      ),
    ).toThrow(FifoHistoryError);

    const colliding = transfer(102, accountA, accountB, '0.5', 2);
    expect(() =>
      calculateOwnedTransfers(
        [account(accountA, [first]), account(accountB, [trade(2, token, 'buy', '1', '100', 2)])],
        [colliding],
      ),
    ).toThrow(FifoHistoryError);

    const independent = calculateOwnedTransfers(
      [
        account(accountA, [first]),
        account(accountB),
        account(accountC, [trade(3, token, 'buy', '1', '100', 2)]),
      ],
      [colliding],
    );
    expect(independent.accounts.get(accountB)!.summary.remainingCostUsd).toBe('50');
    expect(independent.accounts.get(accountC)!.summary.remainingCostUsd).toBe('100');

    expect(() =>
      calculateOwnedTransfers(
        [account(accountA, [first]), account(accountB), account(accountC)],
        [colliding, transfer(103, accountB, accountC, '0.5', 2)],
      ),
    ).toThrow(FifoHistoryError);
    const orderedChain = calculateOwnedTransfers(
      [account(accountA, [first]), account(accountB), account(accountC)],
      [colliding, transfer(103, accountB, accountC, '0.5', 2, { order: 1 })],
    );
    expect(orderedChain.accounts.get(accountC)!.summary.remainingCostUsd).toBe('50');
  });

  it('rejects an unavailable distinct fee asset without moving the principal', () => {
    expect(() =>
      calculateOwnedTransfers(
        [account(accountA, [trade(1, token, 'buy', '1', '100', 1)]), account(accountB)],
        [
          transfer(101, accountA, accountB, '0.5', 2, {
            feeInstrumentId: feeToken,
            feeQuantity: '0.1',
          }),
        ],
      ),
    ).toThrow(FifoHistoryError);
  });

  it('rejects an upstream correction that would make a downstream transfer and sale impossible', () => {
    const first = trade(1, token, 'buy', '1', '100', 1);
    const sale = trade(2, token, 'sell', '1', '200', 4);
    const chain = [
      transfer(101, accountA, accountB, '1', 2),
      transfer(102, accountB, accountC, '1', 3),
    ];
    const valid = calculateOwnedTransfers(
      [account(accountA, [first]), account(accountB), account(accountC, [sale])],
      chain,
    );
    expect(valid.accounts.get(accountC)!.summary.realizedUsd).toBe('100');
    expect(() =>
      calculateOwnedTransfers(
        [
          account(accountA, [{ ...first, version: 2, quantity: '0.5' }]),
          account(accountB),
          account(accountC, [sale]),
        ],
        chain,
      ),
    ).toThrow(FifoHistoryError);
  });

  it('enforces affected-component and transfer caps rather than projecting a partial graph', () => {
    const ids = Array.from({ length: 33 }, (_, index) => uuid(1000 + index));
    const linked = ids
      .slice(1)
      .map((id, index) => transfer(2000 + index, ids[index], id, '1', index + 2));
    const accounts = ids.map((id, index) =>
      account(id, index === 0 ? [trade(1, token, 'buy', '1', '100', 1)] : []),
    );
    expect(() => calculateOwnedTransfers(accounts, linked)).toThrow(FifoHistoryError);

    const thousandAndOne = Array.from({ length: 1001 }, (_, index) =>
      transfer(
        4000 + index,
        index % 2 === 0 ? accountA : accountB,
        index % 2 === 0 ? accountB : accountA,
        '1',
        index + 2,
      ),
    );
    expect(() =>
      calculateOwnedTransfers(
        [account(accountA, [trade(2, token, 'buy', '1', '100', 1)]), account(accountB)],
        thousandAndOne,
      ),
    ).toThrow(FifoHistoryError);
  });

  it('keeps the no-transfer wrapper output byte-compatible with existing FIFO', () => {
    const baseline: FifoCarryInInput = {
      lotId: uuid(6000),
      openingRevision: 1,
      ordinal: 1,
      instrumentId: token,
      instrumentName: 'Token',
      instrumentSymbol: 'SAME',
      acquiredAt: day(1),
      orderWithinTimestamp: 0,
      originalQuantity: '1',
      originalCostUsd: '100',
      carriedQuantity: '0.5',
    };
    const sale = trade(1, token, 'sell', '0.25', '75', 2);
    const original = calculateFifo([sale], [baseline]);
    const connected = calculateOwnedTransfers([account(accountA, [sale], [baseline])], []);
    expect(connected.accounts.get(accountA)).toEqual(original);
    expect(connected.allocations.size).toBe(0);
  });
});
