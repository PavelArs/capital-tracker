import { deriveCarryInAmounts } from '../accounting/fifo';
import {
  canonicalDecimalToAtoms,
  formatPercent,
  formatProduct,
  formatSignedProduct,
} from '../accounting/money';
import type { PaidCurrency } from '../accounting/paid-currency';
import type { ValuationInputs } from '../accounting/portfolio-valuation.service';
import { settlementLeg } from '../accounting/trade-settlement';
import { type FxConverter, moscowDate } from '../fx-rates/fx-conversion';
import { valueAtoms } from './snapshot-series';

const ATOM_SCALE = 10n ** 30n;

/**
 * Money that entered (+) or left (−) the tracked portfolio (product model section 2, Q9), in
 * USD at scale 30, with the Moscow date whose Bank of Russia rate states it in EUR and RUB.
 * A trade paid in RUB or EUR also keeps the signed amount as paid (CUR-PAID-RUB).
 */
export interface CapitalFlow {
  at: number;
  usd: bigint;
  rateDate: string;
  native?: { currency: PaidCurrency; amount: bigint };
}
/** A flow in one accounting currency at scale 60, like snapshot values; null without a rate. */
export interface StatedFlow {
  at: number;
  amount: bigint | null;
}

const signed = (value: string) =>
  value.startsWith('-') ? -canonicalDecimalToAtoms(value.slice(1)) : canonicalDecimalToAtoms(value);

/**
 * Every deposit and withdrawal in the owner's operations (product model, Q9). A trade settled
 * with cash in its own account (M9) keeps money inside: a sale's proceeds stay as cash, so it
 * is no flow (OPS-SELL-CASH), and a buy spends that cash first, so only the rest of its cost
 * is a deposit (OPS-BUY-CASH). A trade without a cash side, like every trade before M9, is
 * settled with money from outside the app: a buy deposits its gross plus fee and a sell
 * withdraws its proceeds net of fee. Holdings carried into a
 * journal enter at its start with their carried cost, stated at their acquisition date's
 * rate like their cost basis. Own transfers, swaps and rewards move no money in or out, so
 * their effect (a transfer fee, a reward) is market effect. The legacy owner-declared USD
 * flows never change holdings, so counting them would invent market effect: they are not
 * flows here.
 */
export function capitalFlows(inputs: ValuationInputs): CapitalFlow[] {
  const flows: CapitalFlow[] = [];
  for (const ledger of new Set(inputs.ledgers.values()))
    for (const account of ledger.accounts.values()) {
      const start = Date.parse(account.coverageFrom);
      for (const lot of account.initialLots)
        flows.push({
          at: start,
          usd: signed(
            deriveCarryInAmounts(lot.originalQuantity, lot.originalCostUsd, lot.carriedQuantity)
              .carriedCostUsd,
          ),
          rateDate: moscowDate(lot.acquiredAt),
        });
      for (const trade of account.trades) {
        if (trade.settlement && trade.side === 'sell') continue;
        // The part of a buy's cost the account's cash paid, in USD and as paid.
        const cash = settlementLeg(trade);
        const flow = (gross: bigint, fee: bigint, spent: bigint) =>
          trade.side === 'buy' ? gross + fee - spent : fee - gross;
        const usd = flow(signed(trade.grossUsd), signed(trade.feeUsd), cash?.usd ?? 0n);
        if (trade.settlement && usd === 0n) continue;
        flows.push({
          at: Date.parse(trade.occurredAt),
          usd,
          rateDate: moscowDate(trade.occurredAt),
          ...(trade.paid
            ? {
                native: {
                  currency: trade.paid.currency,
                  amount: flow(
                    signed(trade.paid.gross),
                    signed(trade.paid.fee),
                    cash?.quantity ?? 0n,
                  ),
                },
              }
            : {}),
        });
      }
    }
  return flows.sort((left, right) => left.at - right.at);
}

/**
 * Each flow in the converter's currency at its own date's rate (flows per currency, Q1). Like
 * Portfolio's cost of a paid lot, a trade paid in RUB or EUR is exact in its own currency,
 * converted at its date into the other one, and its stored USD amounts in USD.
 */
export function stateFlows(flows: readonly CapitalFlow[], fx: FxConverter): StatedFlow[] {
  return flows.map((flow) => {
    const amount =
      flow.native && fx.currency !== 'USD'
        ? fx.convert(flow.native.amount, flow.native.currency, flow.rateDate)
        : fx.convert(flow.usd, 'USD', flow.rateDate);
    return { at: flow.at, amount: amount === null ? null : amount * ATOM_SCALE };
  });
}

/**
 * Net invested at each ascending instant: deposits minus withdrawals up to and including it.
 * One flow without a rate leaves every later total unknown, never smaller.
 */
export function investedAt(flows: readonly StatedFlow[], instants: readonly number[]) {
  let index = 0;
  let total: bigint | null = 0n;
  return instants.map((at) => {
    for (; index < flows.length && flows[index].at <= at; index++) {
      const amount = flows[index].amount;
      total = total === null || amount === null ? null : total + amount;
    }
    return total === null ? null : formatSignedProduct(total);
  });
}

const unknownSplit = {
  deposits: null,
  withdrawals: null,
  netFlow: null,
  marketEffect: null,
  marketReturnPercent: null,
};

/**
 * Capital change from `start` to `end` split into flows and market (BR 10): netFlow =
 * deposits − withdrawals after `start` up to `end`; marketEffect = V1 − V0 − netFlow;
 * marketReturnPercent = marketEffect / (V0 + deposits), empty when that is 0.
 */
export function splitChange(
  start: { at: number; value: string | null } | null,
  end: { at: number; value: string | null },
  flows: readonly StatedFlow[],
): {
  deposits: string | null;
  withdrawals: string | null;
  netFlow: string | null;
  marketEffect: string | null;
  marketReturnPercent: string | null;
} {
  if (start === null) return unknownSplit;
  let deposits = 0n;
  let withdrawals = 0n;
  for (const flow of flows) {
    if (flow.at <= start.at || flow.at > end.at) continue;
    if (flow.amount === null) return unknownSplit;
    if (flow.amount > 0n) deposits += flow.amount;
    else withdrawals -= flow.amount;
  }
  const netFlow = deposits - withdrawals;
  const split = {
    deposits: formatProduct(deposits),
    withdrawals: formatProduct(withdrawals),
    netFlow: formatSignedProduct(netFlow),
  };
  if (start.value === null || end.value === null)
    return { ...split, marketEffect: null, marketReturnPercent: null };
  const from = valueAtoms(start.value);
  const market = valueAtoms(end.value) - from - netFlow;
  const base = from + deposits;
  return {
    ...split,
    marketEffect: formatSignedProduct(market),
    marketReturnPercent: base > 0n ? formatPercent(market, base) : null,
  };
}

/**
 * Profit or loss to date: net worth minus all-time net invested, and its share of net
 * invested; no percentage of nothing when more was taken out than put in.
 */
export function profitToDate(
  value: string | null,
  invested: string | null,
): { profit: string | null; profitPercent: string | null } {
  if (value === null || invested === null) return { profit: null, profitPercent: null };
  const base = valueAtoms(invested);
  const profit = valueAtoms(value) - base;
  return {
    profit: formatSignedProduct(profit),
    profitPercent: base > 0n ? formatPercent(profit, base) : null,
  };
}
