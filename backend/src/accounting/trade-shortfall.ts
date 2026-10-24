import { ConflictException } from '@nestjs/common';
import { firstShortfall, type Shortfall } from './available-quantity';
import { type ConnectedLedger, projectConnectedLedger } from './connected-accounting.store';
import { FifoHistoryError, type FifoTrade } from './fifo';

/**
 * The first operation the account's trades, as given, would leave spending more than its account
 * holds; null when the history replays. Any other history error is thrown as it is.
 * OPS-DELETE-GUARD, OPS-OVERSPEND: a trade's create, correction and void, and the check before a
 * void, all ask this same question.
 */
export function tradeShortfall(
  ledger: ConnectedLedger,
  accountId: string,
  trades: readonly FifoTrade[],
): Shortfall | null {
  try {
    projectConnectedLedger(ledger, { accountId, trades });
    return null;
  } catch (error) {
    const shortfall =
      error instanceof FifoHistoryError &&
      firstShortfall({
        accounts: new Map(
          [...ledger.accounts].map(([key, item]) => [
            key,
            key === accountId ? { ...item, trades } : item,
          ]),
        ),
        transfers: ledger.transfers,
        splits: ledger.splits,
      });
    if (shortfall) return shortfall;
    throw error;
  }
}

/**
 * A change refused for the shortfall it would cause: the trade being written is itself short
 * (a sale larger than the account holds then), or a later operation would be.
 */
export function tradeRefusal(shortfall: Shortfall, tradeId: string): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message:
      shortfall.operationId === `trade:${tradeId}`
        ? 'An account does not hold enough for this trade'
        : 'A later operation depends on this trade',
    dependent: shortfall,
  });
}
