import type { ActiveTransferInput, OwnedAccountInput } from './owned-transfer-types';

const MAX_ORDER = 2147483647;

/**
 * The order that places a trade after every event already recorded at `occurredAt`
 * in the account (trades, rewards, swaps and transfers touching it), or null when
 * it would exceed the integer bound. The corrected trade itself is not counted.
 */
export function automaticOrder(
  account: OwnedAccountInput,
  transfers: readonly ActiveTransferInput[],
  occurredAt: string,
  excludeTradeId: string | undefined,
): number | null {
  let highest = -1;
  const occupy = (event: { occurredAt: string; orderWithinTimestamp: number }) => {
    if (event.occurredAt === occurredAt && event.orderWithinTimestamp > highest)
      highest = event.orderWithinTimestamp;
  };
  for (const trade of account.trades) if (trade.tradeId !== excludeTradeId) occupy(trade);
  for (const reward of account.rewards ?? []) occupy(reward);
  for (const swap of account.swaps ?? []) occupy(swap);
  for (const transfer of transfers)
    if (transfer.fromAccountId === account.accountId || transfer.toAccountId === account.accountId)
      occupy(transfer);
  return highest < MAX_ORDER ? highest + 1 : null;
}
