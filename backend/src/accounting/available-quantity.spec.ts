import type { FifoSwap } from './asset-swap-types';
import {
  availableQuantity,
  firstShortfall,
  withoutOperation,
  withoutTrade,
} from './available-quantity';
import { FifoHistoryError, type FifoTrade } from './fifo';
import { calculateOwnedTransfers } from './owned-transfer-fifo';
import type { ActiveTransferInput, OwnedAccountInput } from './owned-transfer-types';

const wallet = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const exchange = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const btc = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const eth = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const atom = '0.000000000000000000000000000001';

const uuid = (number: number) => `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
const at = (date: string) => `${date}T00:00:00.000Z`;

function trade(
  number: number,
  side: 'buy' | 'sell',
  quantity: string,
  date: string,
  instrumentId = btc,
  order = 0,
): FifoTrade {
  return {
    tradeId: uuid(number),
    version: 1,
    instrumentId,
    instrumentName: instrumentId === btc ? 'Bitcoin' : 'Ether',
    instrumentSymbol: instrumentId === btc ? 'BTC' : 'ETH',
    side,
    occurredAt: at(date),
    orderWithinTimestamp: order,
    quantity,
    grossUsd: '100',
    feeUsd: '0',
  };
}

function ledger(
  accounts: Partial<OwnedAccountInput & { accountId: string }>[],
  transfers: ActiveTransferInput[] = [],
) {
  return {
    accounts: new Map(
      accounts.map((account) => [
        account.accountId!,
        {
          accountId: account.accountId!,
          coverageFrom: account.coverageFrom ?? '1970-01-01T00:00:00.000Z',
          trades: account.trades ?? [],
          initialLots: account.initialLots ?? [],
          rewards: account.rewards ?? [],
          swaps: account.swaps ?? [],
        },
      ]),
    ),
    transfers,
  };
}

/** The FIFO engine itself accepts exactly the quantities the timeline calls available. */
function sellFits(view: ReturnType<typeof ledger>, quantity: string, date: string): boolean {
  const account = view.accounts.get(wallet)!;
  try {
    calculateOwnedTransfers(
      [...view.accounts.values()].map((item) =>
        item === account
          ? {
              ...item,
              trades: [...item.trades, trade(99, 'sell', quantity, date, btc, 1000)],
            }
          : item,
      ),
      view.transfers,
    );
    return true;
  } catch (error) {
    if (error instanceof FifoHistoryError) return false;
    throw error;
  }
}

describe('OPS-OVERSPEND available quantity is the lowest balance from the date on', () => {
  // Bought 1 BTC on 01.03.2026, sold 0.8 BTC on 01.05.2026.
  const history = ledger([
    {
      accountId: wallet,
      trades: [trade(1, 'buy', '1', '2026-03-01'), trade(2, 'sell', '0.8', '2026-05-01')],
    },
  ]);

  it('offers 0.2 BTC for a sale dated between the buy and the later sale', () => {
    expect(availableQuantity(history, wallet, btc, at('2026-04-01'))).toBe('0.2');
    expect(sellFits(history, '0.2', '2026-04-01')).toBe(true);
    expect(sellFits(history, '0.3', '2026-04-01')).toBe(false);
    expect(sellFits(history, `0.2${'0'.repeat(28)}1`, '2026-04-01')).toBe(false);
  });

  it('offers nothing before the buy and the remainder after the sale', () => {
    expect(availableQuantity(history, wallet, btc, at('2026-02-01'))).toBe('0');
    expect(availableQuantity(history, wallet, btc, at('2026-03-01'))).toBe('0.2');
    expect(availableQuantity(history, wallet, btc, at('2026-06-01'))).toBe('0.2');
    expect(availableQuantity(history, wallet, eth, at('2026-06-01'))).toBe('0');
    expect(availableQuantity(history, exchange, btc, at('2026-06-01'))).toBe('0');
  });

  it('counts a sale being edited as not there', () => {
    const editing = withoutTrade(history, wallet, uuid(2));
    expect(availableQuantity(editing, wallet, btc, at('2026-05-01'))).toBe('1');
    expect(history.accounts.get(wallet)!.trades).toHaveLength(2);
  });

  it('counts a transfer or reward being edited as not there (PR-OPS-2)', () => {
    const moved = ledger(
      [
        { accountId: wallet, trades: [trade(1, 'buy', '1', '2026-03-01')] },
        { accountId: exchange },
      ],
      [
        {
          transferId: uuid(50),
          version: 1,
          fromAccountId: wallet,
          toAccountId: exchange,
          instrumentId: btc,
          occurredAt: at('2026-04-01'),
          orderWithinTimestamp: 0,
          quantity: '0.6',
          feeInstrumentId: btc,
          feeQuantity: '0.1',
        },
      ],
    );
    expect(availableQuantity(moved, wallet, btc, at('2026-04-01'))).toBe('0.3');
    const editing = withoutOperation(moved, `transfer:${uuid(50)}`);
    expect(availableQuantity(editing, wallet, btc, at('2026-04-01'))).toBe('1');
    expect(availableQuantity(editing, exchange, btc, at('2026-04-01'))).toBe('0');
    expect(withoutOperation(moved, `trade:${uuid(1)}`).accounts.get(wallet)!.trades).toEqual([]);
    expect(moved.transfers).toHaveLength(1);
  });

  it('follows transfers, swaps, rewards and carried-in lots of the account', () => {
    const swap: FifoSwap = {
      swapId: uuid(20),
      version: 1,
      outgoingInstrumentId: eth,
      outgoingInstrumentName: 'Ether',
      outgoingInstrumentSymbol: 'ETH',
      incomingInstrumentId: btc,
      incomingInstrumentName: 'Bitcoin',
      incomingInstrumentSymbol: 'BTC',
      occurredAt: at('2026-03-10'),
      orderWithinTimestamp: 0,
      outgoingQuantity: '2',
      incomingQuantity: '0.1',
      considerationUsd: null,
      feeSource: 'incoming',
      feeInstrumentId: btc,
      feeQuantity: '0.01',
    };
    const view = ledger(
      [
        {
          accountId: wallet,
          coverageFrom: at('2026-01-01'),
          initialLots: [
            {
              lotId: uuid(30),
              openingRevision: 1,
              ordinal: 1,
              instrumentId: eth,
              instrumentName: 'Ether',
              instrumentSymbol: 'ETH',
              acquiredAt: at('2025-12-01'),
              orderWithinTimestamp: 0,
              originalQuantity: '3',
              originalCostUsd: '300',
              carriedQuantity: '3',
            },
          ],
          trades: [trade(1, 'buy', '1', '2026-03-01')],
          rewards: [
            {
              rewardId: uuid(40),
              version: 1,
              instrumentId: btc,
              instrumentName: 'Bitcoin',
              instrumentSymbol: 'BTC',
              category: 'staking',
              occurredAt: at('2026-03-20'),
              orderWithinTimestamp: 0,
              quantity: '0.05',
              acquisitionBasisUsd: null,
              incomeValueUsd: null,
            },
          ],
          swaps: [swap],
        },
        { accountId: exchange, coverageFrom: at('2026-01-01') },
      ],
      [
        {
          transferId: uuid(50),
          version: 1,
          fromAccountId: wallet,
          toAccountId: exchange,
          instrumentId: btc,
          occurredAt: at('2026-04-01'),
          orderWithinTimestamp: 0,
          quantity: '0.5',
          feeInstrumentId: btc,
          feeQuantity: '0.001',
        },
      ],
    );
    // 1 + 0.1 − 0.01 + 0.05 − 0.5 − 0.001
    expect(availableQuantity(view, wallet, btc, at('2026-03-25'))).toBe('0.639');
    expect(availableQuantity(view, exchange, btc, at('2026-04-01'))).toBe('0.5');
    expect(availableQuantity(view, wallet, eth, at('2026-03-01'))).toBe('1');
    expect(availableQuantity(view, wallet, eth, at('2025-12-31'))).toBe('0');
    expect(sellFits(view, '0.639', '2026-03-25')).toBe(true);
    expect(sellFits(view, '0.64', '2026-03-25')).toBe(false);
  });

  it('places the sale after every event already at that instant', () => {
    const sameDay = ledger([
      {
        accountId: wallet,
        trades: [trade(1, 'buy', '1', '2026-03-01'), trade(2, 'buy', atom, '2026-03-01', btc, 1)],
      },
    ]);
    expect(availableQuantity(sameDay, wallet, btc, at('2026-03-01'))).toBe(`1.${'0'.repeat(29)}1`);
  });
});

describe('OPS-DELETE-GUARD names the operation a deletion would break', () => {
  it('names the later sale that spends the purchase', () => {
    const history = ledger([
      {
        accountId: wallet,
        trades: [trade(1, 'buy', '1', '2026-03-01'), trade(2, 'sell', '0.8', '2026-05-01')],
      },
    ]);
    expect(firstShortfall(history)).toBeNull();
    expect(firstShortfall(withoutTrade(history, wallet, uuid(1)))).toEqual({
      operationId: `trade:${uuid(2)}`,
      accountId: wallet,
      instrumentId: btc,
      occurredAt: at('2026-05-01'),
    });
  });

  it('names the transfer when the coins left for another account', () => {
    const history = ledger(
      [
        { accountId: wallet, trades: [trade(1, 'buy', '1', '2026-03-01')] },
        { accountId: exchange, trades: [trade(2, 'sell', '1', '2026-05-01')] },
      ],
      [
        {
          transferId: uuid(50),
          version: 1,
          fromAccountId: wallet,
          toAccountId: exchange,
          instrumentId: btc,
          occurredAt: at('2026-04-01'),
          orderWithinTimestamp: 0,
          quantity: '1',
          feeInstrumentId: null,
          feeQuantity: '0',
        },
      ],
    );
    expect(firstShortfall(withoutTrade(history, wallet, uuid(1)))?.operationId).toBe(
      `transfer:${uuid(50)}`,
    );
  });
});
