import apiClient from '@api/client';
import type { DependentOperation } from '@api/trades.api';

export interface TradeVoidCheck {
  tradeId: string;
  /** The later operation a deletion of the trade would leave short, or null. */
  dependent: DependentOperation | null;
}

/**
 * OPS-DELETE-GUARD: asks, without changing anything, whether deleting a trade would leave a later
 * operation short, so the owner hears it before confirming. The void itself still refuses.
 */
export const tradeVoidCheck = {
  get: async (accountId: string, tradeId: string): Promise<TradeVoidCheck> =>
    (
      await apiClient.get<TradeVoidCheck>(
        `/accounting/accounts/${encodeURIComponent(accountId)}/trades/${encodeURIComponent(tradeId)}/void-check`,
      )
    ).data,
};
