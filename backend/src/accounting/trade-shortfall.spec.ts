import { ConflictException } from '@nestjs/common';
import type { ConnectedLedger } from './connected-accounting.store';
import type { FifoTrade } from './fifo';
import type { JournalRow } from './trade-journal.store';
import { tradeRefusal, tradeShortfall } from './trade-shortfall';

// Synthetic ids and amounts only.
const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const btc = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const uuid = (number: number) => `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
const at = (date: string) => `${date}T00:00:00.000Z`;

function trade(number: number, side: 'buy' | 'sell', quantity: string, date: string): FifoTrade {
  return {
    tradeId: uuid(number),
    version: 1,
    instrumentId: btc,
    instrumentName: 'Bitcoin',
    instrumentSymbol: 'BTC',
    side,
    occurredAt: at(date),
    orderWithinTimestamp: 0,
    quantity,
    grossUsd: '100',
    feeUsd: '0',
  };
}

function ledger(trades: FifoTrade[]): ConnectedLedger {
  return {
    accounts: new Map([
      [
        account,
        {
          accountId: account,
          coverageFrom: '1970-01-01T00:00:00.000Z',
          trades,
          initialLots: [],
          rewards: [],
          swaps: [],
          journal: {} as JournalRow,
        },
      ],
    ]),
    transfers: [],
    participants: new Set(),
    rewardParticipants: new Set(),
    swapParticipants: new Set(),
  };
}

const body = (error: ConflictException) =>
  error.getResponse() as { message: string; dependent: { operationId: string } };

describe('trade shortfall (OPS-OVERSPEND, OPS-DELETE-GUARD)', () => {
  const buy = trade(1, 'buy', '2', '2025-03-01');
  const sale = trade(2, 'sell', '1.5', '2025-04-01');
  const saved = ledger([buy, sale]);

  it('transactions-05 a new sale larger than the holding is refused as its own shortfall', () => {
    const tooLarge = trade(3, 'sell', '10', '2025-05-01');
    const shortfall = tradeShortfall(saved, account, [buy, sale, tooLarge]);
    expect(shortfall).toEqual({
      operationId: `trade:${tooLarge.tradeId}`,
      accountId: account,
      instrumentId: btc,
      occurredAt: tooLarge.occurredAt,
    });
    const refusal = body(tradeRefusal(shortfall!, tooLarge.tradeId));
    expect(refusal.message).toBe('An account does not hold enough for this trade');
    expect(refusal.dependent.operationId).toBe(`trade:${tooLarge.tradeId}`);
  });

  it('transactions-05 a sale that fits its own date but leaves a later sale short names that sale', () => {
    const earlier = trade(3, 'sell', '1', '2025-03-15');
    const shortfall = tradeShortfall(saved, account, [buy, earlier, sale]);
    expect(shortfall?.operationId).toBe(`trade:${sale.tradeId}`);
    const refusal = body(tradeRefusal(shortfall!, earlier.tradeId));
    expect(refusal.message).toBe('A later operation depends on this trade');
  });

  it('transactions-23 the check before a void names the sale a deleted purchase leaves short', () => {
    expect(tradeShortfall(saved, account, [sale])).toEqual({
      operationId: `trade:${sale.tradeId}`,
      accountId: account,
      instrumentId: btc,
      occurredAt: sale.occurredAt,
    });
    // Deleting the sale leaves nothing short.
    expect(tradeShortfall(saved, account, [buy])).toBeNull();
  });
});
