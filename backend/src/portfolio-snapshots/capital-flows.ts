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
  /** The instrument the money bought or sold, to tell the flows of an unpriced coin apart. */
  instrumentId?: string;
  usd: bigint;
  rateDate: string;
  native?: { currency: PaidCurrency; amount: bigint };
}
/** A flow in one accounting currency at scale 60, like snapshot values; null without a rate. */
export interface StatedFlow {
  at: number;
  /** The Moscow day whose rate states the flow; a carry-in keeps its acquisition day, not `at`. */
  rateDate?: string;
  instrumentId?: string;
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
 * withdraws its proceeds net of fee. Income and a gift received are such a buy, an expense and
 * a gift sent such a sale, each at its value; a fee spends the asset for nothing and is no
 * flow (PR-OPS-2). Holdings carried into a
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
      for (const lot of account.initialLots) {
        // ASSET-HIDE: a hidden asset's money is out of the figures, as its holdings are.
        if (inputs.hidden.has(lot.instrumentId)) continue;
        flows.push({
          at: start,
          instrumentId: lot.instrumentId,
          usd: signed(
            deriveCarryInAmounts(lot.originalQuantity, lot.originalCostUsd, lot.carriedQuantity)
              .carriedCostUsd,
          ),
          rateDate: moscowDate(lot.acquiredAt),
        });
      }
      for (const trade of account.trades) {
        // A sale kept as cash moves no money; a fee only lowers the return (PR-OPS-2).
        if ((trade.settlement && trade.side === 'sell') || trade.purpose === 'fee') continue;
        if (inputs.hidden.has(trade.instrumentId)) continue;
        // The part of a buy's cost the account's cash paid, in USD and as paid.
        const cash = settlementLeg(trade);
        const flow = (gross: bigint, fee: bigint, spent: bigint) =>
          trade.side === 'buy' ? gross + fee - spent : fee - gross;
        const usd = flow(signed(trade.grossUsd), signed(trade.feeUsd), cash?.usd ?? 0n);
        if (trade.settlement && usd === 0n) continue;
        flows.push({
          at: Date.parse(trade.occurredAt),
          instrumentId: trade.instrumentId,
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
    return {
      at: flow.at,
      rateDate: flow.rateDate,
      ...(flow.instrumentId === undefined ? {} : { instrumentId: flow.instrumentId }),
      amount: amount === null ? null : amount * ATOM_SCALE,
    };
  });
}

/**
 * INVESTED-RATED: money counts as put in only when its date has a rate. The owner chose to
 * leave a flow without one out rather than blank every later total, so the money put in can
 * read lower and the profit to date higher than they are. Nominal and real money put in
 * follow this one rule.
 */
export function isRated(flow: StatedFlow): flow is StatedFlow & { amount: bigint } {
  return flow.amount !== null;
}

/**
 * Net invested at each ascending instant: deposits minus withdrawals up to and including it,
 * leaving out a flow without a rate (INVESTED-RATED).
 */
export function investedAt(flows: readonly StatedFlow[], instants: readonly number[]) {
  let index = 0;
  let total = 0n;
  return instants.map((at) => {
    for (; index < flows.length && flows[index].at <= at; index++) {
      const flow = flows[index];
      if (isRated(flow)) total += flow.amount;
    }
    return formatSignedProduct(total);
  });
}

const unknownSplit = {
  deposits: null,
  withdrawals: null,
  netFlow: null,
  marketEffect: null,
  marketReturnPercent: null,
};

/** What a point holds, by instrument: its quantity and value, null for a coin without a price. */
export type HeldAssets = ReadonlyMap<string, { quantity: string; value: string | null }>;

/** A point of the series as the split reads it. */
export interface SplitPoint {
  at: number;
  value: string | null;
  /** The value leaves out a held asset without a price or a deposit without a rate. */
  unpriced?: boolean;
  /** A deposit left out for want of a rate: the money put into it stays in the flows. */
  unrated?: boolean;
  held?: HeldAssets;
}

/**
 * Capital change from `start` to `end` split into flows and market (BR 10): netFlow =
 * deposits − withdrawals after `start` up to `end`; marketEffect = V1 − V0 − netFlow;
 * marketReturnPercent = marketEffect / (V0 + deposits), empty when that is 0. A coin without
 * a price now is left out of both values and so is its market effect: the rest is still said, as
 * long as the coin's quantity is the same at both ends and none of its flows falls between
 * them, otherwise its flows would be counted while its value is not and show its cost as a
 * loss. A deposit without a rate, or a coin whose details are not known, gives no market
 * effect.
 */
export function splitChange(
  start: SplitPoint | null,
  end: SplitPoint,
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
  const inWindow: StatedFlow[] = [];
  for (const flow of flows) {
    if (flow.at <= start.at || flow.at > end.at) continue;
    if (flow.amount === null) return unknownSplit;
    inWindow.push(flow);
    if (flow.amount > 0n) deposits += flow.amount;
    else withdrawals -= flow.amount;
  }
  const netFlow = deposits - withdrawals;
  const split = {
    deposits: formatProduct(deposits),
    withdrawals: formatProduct(withdrawals),
    netFlow: formatSignedProduct(netFlow),
  };
  const noMarket = { ...split, marketEffect: null, marketReturnPercent: null };
  if (start.value === null || end.value === null) return noMarket;
  if (start.unrated === true || end.unrated === true) return noMarket;
  // Only a coin that has no price now is left out. One that had none at the start of the
  // period but has now (its prices begin later) leaves its market effect unknown, as before.
  const left = new Set<string>();
  if (end.unpriced === true) {
    if (end.held === undefined) return noMarket;
    for (const [id, asset] of end.held) if (asset.value === null) left.add(id);
  }
  if (start.unpriced === true) {
    if (start.held === undefined) return noMarket;
    for (const [id, asset] of start.held)
      if (asset.value === null && !left.has(id)) return noMarket;
  }
  // The value of the coins left out, to take from both ends.
  let startLeft = 0n;
  for (const id of left) {
    // A point read without its coins cannot say what the coins left out were worth at it.
    if (start.held === undefined) return noMarket;
    const before = start.held.get(id);
    const after = end.held?.get(id);
    if ((before?.quantity ?? '0') !== (after?.quantity ?? '0')) return noMarket;
    if (inWindow.some((flow) => flow.instrumentId === id)) return noMarket;
    if (before?.value) startLeft += valueAtoms(before.value);
  }
  const from = valueAtoms(start.value) - startLeft;
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
 * invested; no percentage of nothing when more was taken out than put in. When the value
 * leaves out a held asset without a price the figure still counts the priced part; the page
 * says what is left out. Unknown without a value or net invested, and when no held asset is
 * priced at all (a value of nothing would read as losing everything).
 */
export function profitToDate(
  value: string | null,
  invested: string | null,
  unpriced = false,
): { profit: string | null; profitPercent: string | null } {
  if (value === null || invested === null) return { profit: null, profitPercent: null };
  if (unpriced && valueAtoms(value) === 0n) return { profit: null, profitPercent: null };
  const base = valueAtoms(invested);
  const profit = valueAtoms(value) - base;
  return {
    profit: formatSignedProduct(profit),
    profitPercent: base > 0n ? formatPercent(profit, base) : null,
  };
}
