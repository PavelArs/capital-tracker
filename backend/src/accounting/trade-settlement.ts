import { canonicalDecimalToAtoms } from './money';
import type { TradePayment } from './paid-currency';

// M9 (PR-OPS-9, OPS-SELL-CASH, OPS-BUY-CASH): a manual trade is settled with cash in its own
// account. A sale keeps its proceeds net of fee there; a buy spends that cash first and only
// the rest is money from outside (a deposit). USD, USDT and USDC count 1:1 with the trade's
// USD amounts; RUB and EUR are the amounts as paid.
export const settlementCurrencies = ['USD', 'USDT', 'USDC', 'EUR', 'RUB'] as const;
export type SettlementCurrency = (typeof settlementCurrencies)[number];

/** The cash asset that holds a settlement currency: a fixed-price cash asset or a stablecoin. */
export const cashAsset: Record<
  SettlementCurrency,
  { assetType: 'fiat' | 'crypto'; symbol: string; name: string }
> = {
  USD: { assetType: 'fiat', symbol: 'USD', name: 'US dollar' },
  EUR: { assetType: 'fiat', symbol: 'EUR', name: 'Euro' },
  RUB: { assetType: 'fiat', symbol: 'RUB', name: 'Russian ruble' },
  USDT: { assetType: 'crypto', symbol: 'USDT', name: 'Tether' },
  USDC: { assetType: 'crypto', symbol: 'USDC', name: 'USD Coin' },
};

/** A trade version's cash side: what a sale added to the asset, or what a buy spent of it. */
export interface TradeSettlement {
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  /** Units of the cash asset; zero when a sale kept nothing or a buy found no cash. */
  quantity: string;
}

interface Settled {
  side: 'buy' | 'sell';
  grossUsd: string;
  feeUsd: string;
  paid?: TradePayment;
  settlement?: TradeSettlement;
}

/** The trade's amount in its cash currency: net proceeds of a sale, gross plus fee of a buy. */
export function settlementTotal(trade: Omit<Settled, 'settlement'>): bigint {
  const gross = canonicalDecimalToAtoms(trade.paid?.gross ?? trade.grossUsd);
  const fee = canonicalDecimalToAtoms(trade.paid?.fee ?? trade.feeUsd);
  return trade.side === 'buy' ? gross + fee : gross - fee;
}

/** Share of a USD amount, half away from zero; the share never exceeds the whole. */
const share = (usd: bigint, part: bigint, whole: bigint) =>
  whole <= 0n ? 0n : (usd * part * 2n + whole) / (whole * 2n);

/**
 * The cash leg in atoms, or null without one: a sale's cash arrives at its net proceeds as
 * cost basis; a buy's spent cash is worth its share of what the buy cost.
 */
export function settlementLeg(trade: Settled): { quantity: bigint; usd: bigint } | null {
  if (!trade.settlement) return null;
  const quantity = canonicalDecimalToAtoms(trade.settlement.quantity);
  if (quantity <= 0n) return null;
  const gross = canonicalDecimalToAtoms(trade.grossUsd);
  const fee = canonicalDecimalToAtoms(trade.feeUsd);
  if (trade.side === 'sell') return { quantity, usd: gross - fee };
  return { quantity, usd: share(gross + fee, quantity, settlementTotal(trade)) };
}
