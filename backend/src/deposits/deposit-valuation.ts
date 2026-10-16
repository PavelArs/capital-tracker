import { canonicalDecimalToAtoms } from '../accounting/money';
import {
  type AccountingCurrency,
  type FxConverter,
  MAX_RATE_AGE_DAYS,
  moscowDate,
} from '../fx-rates/fx-conversion';
import type { StatedFlow } from '../portfolio-snapshots/capital-flows';
import { type DepositCurrency, depositBalances, projectDeposit } from './deposit-interest';
import { interestMissingOn, movementsOf, type Stored, termsOf } from './deposit-store';

// DEP-VALUE: what the owner's deposits add to the whole portfolio. A deposit is worth its
// computed balance at the Bank of Russia rate of the day; money put in or taken out by the
// owner is a capital flow, interest is the deposit's own return.

const ATOM_SCALE = 10n ** 30n;
/** The Moscow day a calendar date starts, which is when a movement of that date counts. */
export const dayStart = (date: string) => Date.parse(`${date}T00:00:00+03:00`);

/** A deposit as the whole-portfolio figures read it. */
export type DepositHolding = Stored;

/** Whether the rate of every foreign currency involved is at most `MAX_RATE_AGE_DAYS` old. */
export function ratesAreFresh(
  converter: FxConverter,
  currencies: readonly AccountingCurrency[],
  date: string,
): boolean {
  const rates = converter.ratesOn(date);
  return currencies.every((currency) => {
    if (currency === 'RUB') return true;
    const rate = rates.find((entry) => entry.currency === currency);
    if (!rate) return false;
    const age =
      (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${rate.date}T00:00:00Z`)) / 86_400_000;
    return age <= MAX_RATE_AGE_DAYS;
  });
}

/** An amount in a deposit's currency stated in the converter's, null without a fresh rate. */
function stated(
  atoms: bigint,
  currency: DepositCurrency,
  date: string,
  fx: FxConverter,
): bigint | null {
  if (currency !== fx.currency && !ratesAreFresh(fx, [currency, fx.currency], date)) return null;
  return fx.convert(atoms, currency, date);
}

// Replaying a deposit costs a step per day since it started. Its balance on a date is the same
// in every currency and for every instant of that day, so a history rebuild replays it once per
// date. Holdings are read afresh for every request, so a cached balance never goes stale.
const balances = new WeakMap<DepositHolding, Map<string, bigint>>();

/**
 * Replays every deposit once for all the instants a history is about to read, so that reading
 * each of them costs nothing more. Without it every date is a replay from the deposit's start.
 */
export function primeDepositBalances(
  holdings: readonly DepositHolding[],
  instants: readonly number[],
) {
  const dates = [...new Set(instants.map((at) => moscowDate(new Date(at))))];
  for (const holding of holdings) {
    const known = balances.get(holding) ?? new Map<string, bigint>();
    balances.set(holding, known);
    const replayed = depositBalances(termsOf(holding), movementsOf(holding), dates);
    for (const [date, atoms] of replayed) known.set(date, atoms);
  }
}

function balanceOn(holding: DepositHolding, date: string): bigint {
  const known = balances.get(holding) ?? new Map<string, bigint>();
  balances.set(holding, known);
  const cached = known.get(date);
  if (cached !== undefined) return cached;
  const { balance } = projectDeposit(termsOf(holding), movementsOf(holding), date);
  const atoms = canonicalDecimalToAtoms(balance);
  known.set(date, atoms);
  return atoms;
}

/**
 * One deposit's worth on a Moscow date in the converter's currency at scale 60, like a
 * portfolio value: nothing before it started, null without a fresh rate for that day.
 */
export function depositValueOn(
  holding: DepositHolding,
  date: string,
  fx: FxConverter,
): bigint | null {
  if (holding.deposit.startDate > date) return 0n;
  const atoms = balanceOn(holding, date);
  if (atoms === 0n) return 0n;
  const value = stated(atoms, holding.deposit.currency, date, fx);
  return value === null ? null : value * ATOM_SCALE;
}

/**
 * What every deposit is worth at one instant: the deposit and its value, null when unrated. An
 * account with no rate entered is worth what was put in, and says its interest is not counted.
 */
export function depositValuesAt(holdings: readonly DepositHolding[], at: Date, fx: FxConverter) {
  const date = moscowDate(at);
  return holdings.map((holding) => ({
    id: holding.deposit.id,
    name: holding.deposit.name,
    bank: holding.deposit.bank,
    value: depositValueOn(holding, date, fx),
    interestMissing: interestMissingOn(holding, date),
  }));
}

/**
 * The owner's money that went into (+) or out of (−) deposits, each at its date's rate: a
 * top-up enters the tracked portfolio, a withdrawal and a payout of posted interest leave
 * it. Interest itself is no flow; it is what the deposit earned. A flow without a fresh rate
 * makes the totals after it unknown.
 */
export function depositFlows(holdings: readonly DepositHolding[], fx: FxConverter): StatedFlow[] {
  return holdings.flatMap((holding) =>
    movementsOf(holding).flatMap((movement) => {
      const atoms = canonicalDecimalToAtoms(movement.amount);
      const sign = movement.kind === 'topup' ? 1n : -1n;
      // At the rate of its day, and unknown without a fresh one, like the deposit's value: a
      // flow at an old rate beside a value that leaves the deposit out would read as a loss.
      const value = stated(atoms, holding.deposit.currency, movement.date, fx);
      return [
        { at: dayStart(movement.date), amount: value === null ? null : sign * value * ATOM_SCALE },
      ];
    }),
  );
}
