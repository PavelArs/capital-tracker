import type { PaidCurrency } from './paid-currency';

/**
 * Current-effective head of a capital return: part of the cost of the units of one asset held
 * in an account came back as cash (a partial bond repayment). It lowers what those units cost
 * and brings the cash in; persistence resolves immutable versions before projection.
 */
export interface FifoCapitalReturn {
  capitalReturnId: string;
  version: number;
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  cashInstrumentId: string;
  cashInstrumentName: string;
  cashInstrumentSymbol: string | null;
  occurredAt: string;
  orderWithinTimestamp: number;
  /** Units of the cash asset that came in. */
  amount: string;
  /** What those units were worth in USD when they came in. */
  amountUsd: string;
  /** The currency the cash was paid in; its units are exact (CUR-PAID-RUB). */
  paidCurrency: PaidCurrency | null;
}

/** The part of a return that lowered the cost of a held lot or of what was taken from it. */
export interface ReturnedPart {
  capitalReturnId: string;
  version: number;
  occurredAt: string;
  usd: string;
  native?: { currency: PaidCurrency; amount: string };
}

export interface CapitalReturnAllocationItem {
  instrumentId: string;
  quantity: string;
  /** Cost this share of the units lost; null when their cost is unknown. */
  appliedUsd: string | null;
  /** The share the units' remaining cost could not take: realized at the return. */
  excessUsd: string | null;
}

export interface CapitalReturnAllocation {
  capitalReturnId: string;
  version: number;
  instrumentId: string;
  occurredAt: string;
  amountUsd: string;
  appliedUsd: string | null;
  /** Realized by the return; null while any held unit's cost is unknown. */
  realizedUsd: string | null;
  /** The same in the paid currency, for a return paid in RUB or EUR. */
  realizedNative: { currency: PaidCurrency; amount: string } | null;
  unknownCostCount: number;
  items: CapitalReturnAllocationItem[];
}

export interface CapitalReturnSummary {
  activeCount: number;
  amountUsd: string;
  appliedUsd: string | null;
  realizedUsd: string | null;
  unknownCostCount: number;
}
