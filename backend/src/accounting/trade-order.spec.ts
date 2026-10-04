import { automaticOrder } from './trade-order';

const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const day = '2025-06-13T00:00:00.000Z';
const later = '2025-06-13T14:30:00.000Z';
const trade = (tradeId: string, occurredAt: string, orderWithinTimestamp: number) =>
  ({ tradeId, occurredAt, orderWithinTimestamp }) as never;
const event = (occurredAt: string, orderWithinTimestamp: number) =>
  ({ occurredAt, orderWithinTimestamp }) as never;
const transfer = (
  fromAccountId: string,
  toAccountId: string,
  occurredAt: string,
  orderWithinTimestamp: number,
) => ({ fromAccountId, toAccountId, occurredAt, orderWithinTimestamp }) as never;
const account = (input: { trades?: never[]; rewards?: never[]; swaps?: never[] }) => ({
  accountId,
  coverageFrom: '2025-06-01T00:00:00.000Z',
  initialLots: [],
  trades: input.trades ?? [],
  rewards: input.rewards,
  swaps: input.swaps,
});

describe('TRADE-002-C automatic same-instant order', () => {
  it('starts at 0 when nothing occupies the instant', () => {
    expect(automaticOrder(account({ trades: [trade('t1', later, 0)] }), [], day, undefined)).toBe(
      0,
    );
  });

  it('places the trade after every event kind at that instant in the account', () => {
    const ledger = account({
      trades: [trade('t1', day, 0)],
      rewards: [event(day, 1)],
      swaps: [event(day, 3)],
    });
    expect(automaticOrder(ledger, [], day, undefined)).toBe(4);
    expect(automaticOrder(ledger, [transfer(other, accountId, day, 7)], day, undefined)).toBe(8);
    expect(automaticOrder(ledger, [transfer(accountId, other, day, 9)], day, undefined)).toBe(10);
  });

  it('ignores other accounts and other instants', () => {
    const ledger = account({ trades: [trade('t1', later, 5)] });
    expect(automaticOrder(ledger, [transfer(other, other, day, 6)], day, undefined)).toBe(0);
  });

  it('does not count the corrected trade itself', () => {
    const ledger = account({ trades: [trade('t1', day, 0), trade('t2', day, 1)] });
    expect(automaticOrder(ledger, [], day, 't2')).toBe(1);
    expect(automaticOrder(ledger, [], day, 't1')).toBe(2);
  });

  it('refuses an order beyond the integer bound', () => {
    expect(
      automaticOrder(account({ trades: [trade('t1', day, 2147483647)] }), [], day, undefined),
    ).toBeNull();
  });
});
