import { BadRequestException } from '@nestjs/common';
import type { FifoReward } from '../accounting/asset-reward-types';
import type { CapitalReturnRate } from '../accounting/capital-return.store';
import type { FifoCapitalReturn } from '../accounting/capital-return-types';
import type { FifoTrade } from '../accounting/fifo';
import { canonicalDecimalToAtoms, formatAtoms } from '../accounting/money';
import { derivePaidAmounts } from '../accounting/paid-currency';
import type { FxRates } from '../fx-rates/fx-conversion';
import type { PlanEntry } from './tbank-import-plan';

// BROKER-SYNC: the trades, rewards and capital returns a T-Bank import plan writes to an empty account, as
// the owner would have entered them by hand. Securities are settled with the account's cash in
// the trade's currency (M9): money paid in is cash bought from outside, a buy spends that cash
// first, a sale keeps its proceeds as cash, and taxes and fees spend cash for nothing. Income is
// cash received as a reward, not money put in. Amounts in RUB or EUR keep the amounts as paid,
// with USD at the Bank of Russia rate of the Moscow date (CUR-PAID-RUB). Nothing here reads or
// writes the database.

export type CashCurrency = 'RUB' | 'USD' | 'EUR';
export interface ImportInstrument {
  id: string;
  name: string;
  symbol: string | null;
}
export interface ImportInstruments {
  cash: Readonly<Record<CashCurrency, ImportInstrument>>;
  /** The owner's instrument for each T-Bank instrument uid. */
  securities: ReadonlyMap<string, ImportInstrument>;
}

/** One journal entry and the plan entry it was made from; ids are `import-<index>`. */
export type JournalEntry =
  | { source: PlanEntry; trade: FifoTrade; reward?: undefined; capitalReturn?: undefined }
  | { source: PlanEntry; reward: FifoReward; trade?: undefined; capitalReturn?: undefined }
  | {
      source: PlanEntry;
      capitalReturn: FifoCapitalReturn;
      /** The rate the USD worth of a return paid in rubles or euros was derived at. */
      rate: CapitalReturnRate | null;
      trade?: undefined;
      reward?: undefined;
    };

/** The record an entry becomes, whichever kind it is. */
export const recordOf = (entry: JournalEntry) =>
  (entry.trade ?? entry.reward ?? entry.capitalReturn) as
    | FifoTrade
    | FifoReward
    | FifoCapitalReturn;

/**
 * A plan entry that cannot be written: no Bank of Russia rate is stored for its date, or its
 * amount in USD is out of the range the app stores.
 */
export interface EntryProblem {
  reason: 'no-rate' | 'amount' | 'fee-above-proceeds';
  occurredAt: string;
  operationIds: string[];
}

const cashCurrency: Record<string, CashCurrency> = { rub: 'RUB', usd: 'USD', eur: 'EUR' };

/** A T-Bank time (up to nanoseconds) as the journal stores it: UTC to the millisecond. */
export function journalTime(time: string): string {
  const [seconds, fraction = ''] = time.replace('Z', '').split('.');
  return `${seconds}.${fraction.padEnd(3, '0').slice(0, 3)}Z`;
}

/**
 * The journal entries of an ordered plan. Entries keep the plan's order; several at one
 * millisecond are numbered in that order. An entry without a rate for its date is left out
 * and named as a problem, so the caller refuses to write a partial history.
 */
export function journalEntries(
  plan: readonly PlanEntry[],
  instruments: ImportInstruments,
  rates: FxRates,
): { entries: JournalEntry[]; problems: EntryProblem[] } {
  const entries: JournalEntry[] = [];
  const problems: EntryProblem[] = [];
  const orderAt = new Map<string, number>();
  for (const source of plan) {
    const currency = cashCurrency[source.currency];
    if (!currency) throw new Error('The plan holds a currency the app does not keep');
    const occurredAt = journalTime(source.occurredAt);
    const cash = instruments.cash[currency];
    const amount = canonicalDecimalToAtoms(source.amount);
    const fee = canonicalDecimalToAtoms(source.fee);
    // USD amounts as entered by hand: given in USD, else derived from the amounts as paid.
    const amounts = (gross: string, paidFee: string) => {
      if (currency === 'USD') return { grossUsd: gross, feeUsd: paidFee };
      return derivePaidAmounts({ currency, gross, fee: paidFee }, rates, occurredAt);
    };
    let priced: ReturnType<typeof amounts>;
    try {
      priced = amounts(source.amount, source.fee);
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      problems.push({ reason: 'amount', occurredAt, operationIds: source.operationIds });
      continue;
    }
    if (!priced) {
      problems.push({ reason: 'no-rate', occurredAt, operationIds: source.operationIds });
      continue;
    }
    const orderWithinTimestamp = orderAt.get(occurredAt) ?? 0;
    orderAt.set(occurredAt, orderWithinTimestamp + 1);
    const id = `import-${entries.length}`;
    const at = { occurredAt, orderWithinTimestamp };
    if (source.record === 'capital-return') {
      // The bond's cost drops by the returned amount, and the cash comes in as a lot of its own,
      // with its USD worth at the date it came in (CUR-PAID-RUB for rubles and euros).
      const security = instruments.securities.get(source.instrumentUid);
      if (!security) throw new Error('The plan holds an instrument without an owner instrument');
      const paid = 'paid' in priced ? priced.paid : null;
      entries.push({
        source,
        rate: paid
          ? { rateDate: paid.rateDate, perUsd: paid.perUsd, rateSource: paid.rateSource }
          : null,
        capitalReturn: {
          capitalReturnId: id,
          version: 1,
          instrumentId: security.id,
          instrumentName: security.name,
          instrumentSymbol: security.symbol,
          cashInstrumentId: cash.id,
          cashInstrumentName: cash.name,
          cashInstrumentSymbol: cash.symbol,
          ...at,
          amount: source.amount,
          amountUsd: priced.grossUsd,
          paidCurrency: paid?.currency ?? null,
        },
      });
      continue;
    }
    if (source.record === 'reward') {
      entries.push({
        source,
        reward: {
          rewardId: id,
          version: 1,
          instrumentId: cash.id,
          instrumentName: cash.name,
          instrumentSymbol: cash.symbol,
          category: 'other',
          ...at,
          quantity: source.amount,
          acquisitionBasisUsd: priced.grossUsd,
          incomeValueUsd: priced.grossUsd,
        },
      });
      continue;
    }
    const base = { tradeId: id, version: 1, ...at };
    const onCash = {
      ...base,
      instrumentId: cash.id,
      instrumentName: cash.name,
      instrumentSymbol: cash.symbol,
      quantity: source.amount,
    };
    let trade: FifoTrade;
    if (source.action === 'deposit' || source.action === 'withdrawal') {
      const side: 'buy' | 'sell' = source.action === 'deposit' ? 'buy' : 'sell';
      trade = { ...onCash, side, ...priced };
    } else if (source.action === 'fee' || source.action === 'tax') {
      // A fee is all fee, its value in USD given as both amounts (PR-OPS-6).
      trade = {
        ...onCash,
        side: 'sell',
        grossUsd: priced.grossUsd,
        feeUsd: priced.grossUsd,
        purpose: 'fee',
      };
    } else if (source.action === 'buy' || source.action === 'sell') {
      // Dollars or euros bought on the exchange are that currency's cash, bought with this one.
      const moved = source.cash ? cashCurrency[source.cash] : undefined;
      const security = moved
        ? instruments.cash[moved]
        : instruments.securities.get(source.instrumentUid);
      if (!security) throw new Error('The plan holds an instrument without an owner instrument');
      // A buy spends all it cost from cash and a sale keeps its proceeds net of fee: the history
      // holds every payment in, so cash short of a buy is a shortfall the journal check refuses.
      if (source.action === 'sell' && fee > amount) {
        problems.push({
          reason: 'fee-above-proceeds',
          occurredAt,
          operationIds: source.operationIds,
        });
        continue;
      }
      const settled = source.action === 'buy' ? amount + fee : amount - fee;
      trade = {
        ...base,
        instrumentId: security.id,
        instrumentName: security.name,
        instrumentSymbol: security.symbol,
        side: source.action,
        quantity: source.quantity,
        ...priced,
        ...(settled > 0n
          ? {
              settlement: {
                instrumentId: cash.id,
                instrumentName: cash.name,
                instrumentSymbol: cash.symbol,
                quantity: formatAtoms(settled),
              },
            }
          : {}),
      };
    } else throw new Error(`A trade cannot record the action ${source.action}`);
    entries.push({ source, trade });
  }
  return { entries, problems };
}
