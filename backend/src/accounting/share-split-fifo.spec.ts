import { availableQuantity, firstShortfall } from './available-quantity';
import { FifoHistoryError, type FifoTrade } from './fifo';
import { calculateOwnedTransfers } from './owned-transfer-fifo';
import type { AccountFifoResult } from './owned-transfer-types';
import { portfolioAccount } from './portfolio-valuation';
import type { FifoSplit } from './share-split-types';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const share = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const other = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const at = (day: number) => `2026-04-${String(day).padStart(2, '0')}T00:00:00.000Z`;

function trade(
  n: number,
  side: 'buy' | 'sell',
  quantity: string,
  grossUsd: string,
  day: number,
  instrumentId = share,
): FifoTrade {
  return {
    tradeId: id(n),
    version: 1,
    instrumentId,
    instrumentName: 'Synthetic share',
    instrumentSymbol: 'SYNS',
    side,
    occurredAt: at(day),
    orderWithinTimestamp: n,
    quantity,
    grossUsd,
    feeUsd: '0',
  };
}

const split = (day: number, ratio = 10, instrumentId = share): FifoSplit => ({
  splitId: id(900 + day),
  instrumentId,
  effectiveAt: at(day),
  ratio,
});

function account(accountId: string, trades: FifoTrade[]) {
  return { accountId, coverageFrom: at(1), initialLots: [], trades };
}

const held = (lots: AccountFifoResult['lots'], instrumentId = share) =>
  lots
    .filter((lot) => lot.instrumentId === instrumentId)
    .map((lot) => [lot.remainingQuantity, lot.remainingCostUsd]);

describe('SPLIT-FIFO: a share split multiplies the units held and keeps their cost', () => {
  it('SPLIT-FIFO-A turns 15 shares bought before the split into 150, at the same total cost', () => {
    const result = calculateOwnedTransfers(
      [account(a, [trade(1, 'buy', '5', '1500', 2), trade(2, 'buy', '10', '3000', 3)])],
      [],
      undefined,
      [split(17)],
    );
    expect(held(result.accounts.get(a)!.lots)).toEqual([
      ['50', '1500'],
      ['100', '3000'],
    ]);
  });

  it('SPLIT-FIFO-B sells the new units at a tenth of the old cost each, to the last atom', () => {
    const result = calculateOwnedTransfers(
      [
        account(a, [
          trade(1, 'buy', '3', '1000', 2),
          trade(2, 'sell', '7', '700', 20),
          trade(3, 'buy', '45', '450', 21),
        ]),
      ],
      [],
      undefined,
      [split(17)],
    );
    const state = result.accounts.get(a)!;
    // 3 shares became 30 costing 1000; selling 7 of them takes 7/30 of 1000.
    expect(state.matches).toEqual([
      expect.objectContaining({ quantity: '7', costUsd: '233.' + '3'.repeat(30) }),
    ]);
    expect(held(state.lots)).toEqual([
      ['23', `766.${'6'.repeat(29)}7`],
      ['45', '450'],
    ]);
  });

  it('SPLIT-FIFO-C refuses a sale of the new units before the split takes effect', () => {
    expect(() =>
      calculateOwnedTransfers(
        [account(a, [trade(1, 'buy', '3', '1000', 2), trade(2, 'sell', '7', '700', 10)])],
        [],
        undefined,
        [split(17)],
      ),
    ).toThrow(FifoHistoryError);
  });

  it('SPLIT-FIFO-D splits the units in every account, and only that share', () => {
    const result = calculateOwnedTransfers(
      [
        account(a, [trade(1, 'buy', '2', '200', 2), trade(2, 'buy', '1', '50', 3, other)]),
        account(b, [trade(3, 'buy', '1', '100', 4)]),
      ],
      [],
      undefined,
      [split(17)],
    );
    expect(held(result.accounts.get(a)!.lots)).toEqual([['20', '200']]);
    expect(held(result.accounts.get(b)!.lots)).toEqual([['10', '100']]);
    expect(held(result.accounts.get(a)!.lots, other)).toEqual([['1', '50']]);
  });

  it('SPLIT-FIFO-E applies a split only once it is due when replaying to a date', () => {
    const accounts = [account(a, [trade(1, 'buy', '2', '200', 2)])];
    const before = calculateOwnedTransfers(accounts, [], at(16), [split(17)]);
    const after = calculateOwnedTransfers(accounts, [], at(17), [split(17)]);
    expect(held(before.accounts.get(a)!.lots)).toEqual([['2', '200']]);
    expect(held(after.accounts.get(a)!.lots)).toEqual([['20', '200']]);
  });

  it('SPLIT-FIFO-G leaves an account whose history starts after the split: its lots are already new units', () => {
    const lot = {
      lotId: id(50),
      openingRevision: 1,
      ordinal: 1,
      instrumentId: share,
      instrumentName: 'Synthetic share',
      instrumentSymbol: 'SYNS',
      acquiredAt: at(18),
      orderWithinTimestamp: 0,
      originalQuantity: '20',
      originalCostUsd: '200',
      carriedQuantity: '20',
    };
    const result = calculateOwnedTransfers(
      [
        { accountId: a, coverageFrom: at(18), initialLots: [lot], trades: [] },
        account(b, [trade(1, 'buy', '1', '100', 2)]),
      ],
      [],
      undefined,
      [split(17)],
    );
    expect(held(result.accounts.get(a)!.lots)).toEqual([['20', '200']]);
    expect(held(result.accounts.get(b)!.lots)).toEqual([['10', '100']]);
  });

  it('SPLIT-FIFO-F refuses a ratio that is not a whole number of new shares above one', () => {
    for (const ratio of [0, 1, -10, 2.5, Number.NaN, 1_000_001])
      expect(() =>
        calculateOwnedTransfers([account(a, [])], [], undefined, [split(17, ratio)]),
      ).toThrow(FifoHistoryError);
    expect(() =>
      calculateOwnedTransfers([account(a, [])], [], undefined, [split(17), split(17)]),
    ).toThrow(FifoHistoryError);
  });
});

describe('SPLIT-AVAILABLE: the shortfall checks count the new units from the split on', () => {
  const ledger = (trades: FifoTrade[], splits = [split(17)]) => ({
    accounts: new Map([[a, account(a, trades)]]),
    transfers: [],
    splits,
  });

  it('SPLIT-AVAILABLE-A finds no shortfall in a sale of the new units after the split', () => {
    expect(
      firstShortfall(ledger([trade(1, 'buy', '3', '1000', 2), trade(2, 'sell', '25', '250', 20)])),
    ).toBeNull();
    expect(
      firstShortfall(
        ledger([trade(1, 'buy', '3', '1000', 2), trade(2, 'sell', '25', '250', 20)], []),
      ),
    ).toMatchObject({ operationId: `trade:${id(2)}`, missingQuantity: '22' });
  });

  it('SPLIT-AVAILABLE-B flags a sale of the new units before the split takes effect', () => {
    expect(
      firstShortfall(ledger([trade(1, 'buy', '3', '1000', 2), trade(2, 'sell', '25', '250', 10)])),
    ).toMatchObject({ operationId: `trade:${id(2)}`, availableQuantity: '3' });
  });

  it('SPLIT-AVAILABLE-C counts what may be sold in the units of that date', () => {
    const held = ledger([trade(1, 'buy', '3', '1000', 2), trade(2, 'sell', '25', '250', 20)]);
    // Before the split 3 units are held; the later sale of 25 new units leaves 5 new units,
    // half an old unit: what may still be sold on day 10 is 0.5.
    expect(availableQuantity(held, a, share, at(10))).toBe('0.5');
    expect(availableQuantity(held, a, share, at(18))).toBe('5');
  });
});

describe('SPLIT-NATIVE: a buy paid in rubles keeps its ruble cost across a split', () => {
  const paid = (quantity: string, gross: string): FifoTrade => ({
    ...trade(1, 'buy', quantity, '3', 2),
    paid: {
      currency: 'RUB',
      gross,
      fee: '0',
      rateDate: '2026-04-02',
      perUsd: '100',
      rateSource: 'owner',
    },
  });

  it('SPLIT-NATIVE-A divides the rubles paid over the new units held and sold', () => {
    const trades = [paid('3', '300'), trade(2, 'sell', '25', '2.5', 20)];
    const fifo = calculateOwnedTransfers([account(a, trades)], [], undefined, [split(17)]);
    const view = portfolioAccount({ accountId: a, name: 'Broker' }, fifo.accounts.get(a)!, {
      trades,
      initialLots: [],
      splits: [split(17)],
    });
    expect(view.lots.map((lot) => [lot.quantity, lot.native?.amount])).toEqual([['5', '50']]);
    expect(view.realizations[0].consumed.map((part) => part.native?.amount)).toEqual(['250']);
  });

  it('SPLIT-NATIVE-C prices a swap before the split in the units of its own date', () => {
    const trades = [paid('3', '300')];
    const swap = {
      swapId: id(70),
      version: 1,
      outgoingInstrumentId: share,
      outgoingInstrumentName: 'Synthetic share',
      outgoingInstrumentSymbol: 'SYNS',
      incomingInstrumentId: other,
      incomingInstrumentName: 'Other',
      incomingInstrumentSymbol: 'OTH',
      occurredAt: at(10),
      orderWithinTimestamp: 5,
      outgoingQuantity: '1',
      incomingQuantity: '1',
      considerationUsd: '1',
      feeSource: null,
      feeInstrumentId: null,
      feeQuantity: '0',
    };
    const fifo = calculateOwnedTransfers(
      [{ ...account(a, trades), swaps: [swap] }],
      [],
      undefined,
      [split(17)],
    );
    const view = portfolioAccount(
      { accountId: a, name: 'Broker' },
      fifo.accounts.get(a)!,
      { trades, initialLots: [], swaps: [swap], splits: [split(17)] },
      fifo.swapAllocations,
    );
    const realized = view.realizations.find((item) => item.instrumentId === share)!;
    expect(realized.consumed.map((part) => part.native?.amount)).toEqual(['100']);
  });

  it('SPLIT-NATIVE-B counts the units of the valuation date before the split', () => {
    const trades = [paid('3', '300')];
    const fifo = calculateOwnedTransfers([account(a, trades)], [], at(10), [split(17)]);
    const view = portfolioAccount({ accountId: a, name: 'Broker' }, fifo.accounts.get(a)!, {
      trades,
      initialLots: [],
      splits: [split(17)],
      at: at(10),
    });
    expect(view.lots.map((lot) => [lot.quantity, lot.native?.amount])).toEqual([['3', '300']]);
  });
});
