import type {
  Deposit,
  DepositDetail,
  DepositReal,
  DepositStatus,
  EarlyClose,
  MovementKind,
} from '@api/deposits.api';

type DepositPeriod = DepositDetail['periods'][number];

import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import type { BadgeTone } from '@/ui/Badge';
import { dayText, moscowDate } from '@/utils/dates';
import { DASH, percent, type Rounding, rubles, tone, withSymbol } from '../portfolio/format';
import type { InflationBasis } from '../shell/inflation-basis';

const DAY_MS = 86_400_000;

/** "Oct 1, 2026" from a calendar date, the way the rest of the app writes dates. */
export const dateText = (date: string): string => dayText(`${date}T00:00:00Z`);

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Today's calendar date in Moscow, the day the server counts interest by. */
export const today = () => moscowDate(Date.now());

/** Why an interest after inflation cannot be shown: the history has gaps. */
export const NO_REAL_GAIN = 'no inflation figures yet';

/** Why the end balance has no figure in today's money: the term is over, or the data is short. */
export const noRealEndReason = (endDate: string, asOf: string): string =>
  endDate < asOf ? 'the term has ended' : 'no inflation figures for the term yet';

/** The badge tone of each status. */
export const statusTone: Record<DepositStatus, BadgeTone> = {
  active: 'info',
  matured: 'warn',
  closed: 'muted',
};

export const statusText: Record<DepositStatus, string> = {
  active: 'Active',
  matured: 'Term ended',
  closed: 'Closed',
};

export const movementText: Record<MovementKind, string> = {
  topup: 'Top-up',
  withdrawal: 'Withdrawal',
  'interest-payout': 'Interest paid out',
};

/** What closing a deposit before its end does to its interest, in the form and on its page. */
export const earlyCloseText: Record<EarlyClose, string> = {
  'forfeits-interest': 'Loses the interest not yet posted',
  'keeps-interest': 'Keeps the interest earned',
};

const payoutNames = {
  daily: 'daily',
  monthly: 'monthly',
  quarterly: 'quarterly',
  'at-end': 'at the end of the term',
};

/** The day the first rate takes effect, for an account whose rates start after its opening. */
export const firstRateDate = (rates: readonly { effectiveFrom: string }[]): string =>
  rates.reduce(
    (first, rate) => (rate.effectiveFrom < first ? rate.effectiveFrom : first),
    rates[0]?.effectiveFrom ?? '',
  );

/** What a total says when an account has days with no rate, whose interest is not counted. */
export const accountsWithoutRate = (count: number): string =>
  count === 1
    ? '1 account has days with no rate entered; the interest of those days is not counted.'
    : `${count} accounts have days with no rate entered; the interest of those days is not counted.`;

/** "12%", or "No rate entered" for an account that has none (DEP-ACCOUNT); never "null%". */
export const rateText = (deposit: Pick<Deposit, 'ratePercent'>): string =>
  deposit.ratePercent === null ? 'No rate entered' : `${deposit.ratePercent}%`;

/** "12% · interest paid monthly · until 1 Oct 2026"; an account has no term to end (DEP-ACCOUNT). */
export function termText(deposit: Deposit): string {
  const rate = rateText(deposit);
  const interest = deposit.capitalized
    ? `interest added ${payoutNames[deposit.payout]}`
    : `interest paid ${payoutNames[deposit.payout]}`;
  if (deposit.kind === 'account') return `${rate} · ${interest}`;
  const until = deposit.endDate ? `until ${dateText(deposit.endDate)}` : 'no end date';
  return `${rate} · ${interest} · ${until}`;
}

const STALE_CHECK_DAYS = 30;
const ENDING_SOON_DAYS = 7;

/** What needs the owner's eye on a deposit, or null (DEP-ATTENTION). */
export function attention(deposit: Deposit, asOf: string): string | null {
  if (deposit.status === 'closed') return null;
  if (deposit.status === 'matured')
    return 'The term has ended. Withdraw the money or start a new deposit.';
  if (deposit.endDate) {
    const left = daysBetween(asOf, deposit.endDate);
    if (left <= ENDING_SOON_DAYS)
      return left <= 0 ? 'Ends today' : `Ends in ${left} ${left === 1 ? 'day' : 'days'}`;
  }
  const checked = deposit.lastCheck?.checkedOn ?? null;
  if (checked === null) return 'Not checked against the bank yet';
  const age = daysBetween(checked, asOf);
  if (age > STALE_CHECK_DAYS) return `Not checked against the bank for ${age} days`;
  return null;
}

/**
 * Money from an exact decimal string with two decimals, grouped by thousands without going
 * through a floating-point number: a balance can hold more digits than a double keeps exactly.
 * Rubles are whole, rounded as `rounding` says.
 */
export function money(
  value: string | null,
  currency: AccountingCurrency,
  signed = false,
  rounding: Rounding = 'down',
): string {
  if (value === null) return DASH;
  if (currency === 'RUB') return rubles(value, signed, rounding) ?? DASH;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return DASH;
  const cents = (match[3] ?? '').padEnd(2, '0').slice(0, 2);
  const whole = match[2].replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+$)/g, ',');
  const zero = /^0+$/.test(match[2] + cents);
  const mark = match[1] && !zero ? '-' : signed && !zero ? '+' : '';
  return withSymbol(mark, `${whole}.${cents}`, currency);
}

/**
 * The interest added to a capitalizing deposit: the sum of the periods whose interest became part
 * of it. Interest made payable by an early closure is not in it. Cents are summed as integers.
 */
export function capitalizedInterest(
  periods: readonly Pick<DepositPeriod, 'interest' | 'treatment'>[],
): string {
  let cents = 0n;
  for (const period of periods) {
    if (period.treatment !== 'capitalized') continue;
    const match = /^(\d+)(?:\.(\d+))?$/.exec(period.interest);
    if (!match) continue;
    cents += BigInt(match[1] + (match[2] ?? '').padEnd(2, '0').slice(0, 2));
  }
  const text = cents.toString().padStart(3, '0');
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

const payoutTerms: Record<Deposit['payout'], string> = {
  daily: 'Every day',
  monthly: 'Every month',
  quarterly: 'Every quarter',
  'at-end': 'At the end of the term',
};

/** "Every month, paid out": when the interest comes and where it goes. */
export const interestText = (deposit: Pick<Deposit, 'payout' | 'capitalized'>): string =>
  `${payoutTerms[deposit.payout]}, ${deposit.capitalized ? 'added to the deposit' : 'paid out'}`;

/** "Jul 1, 2026 to Dec 1, 2026", or "From Jul 1, 2026, no end date". */
export const periodText = (deposit: Pick<Deposit, 'startDate' | 'endDate'>): string =>
  deposit.endDate
    ? `${dateText(deposit.startDate)} to ${dateText(deposit.endDate)}`
    : `From ${dateText(deposit.startDate)}, no end date`;

/** The deposit after inflation by the basis the owner chose; null while the server has none. */
export function realOf(deposit: Pick<Deposit, 'real'>, basis: InflationBasis): DepositReal | null {
  return deposit.real?.[basis] ?? null;
}

/** "Real +3.12% a year after 8.90% inflation", or null where there is no rate to state. */
export function realRateText(real: DepositReal | null): string | null {
  if (real === null || real.ratePercent === null || real.inflationPercent === null) return null;
  return `Real ${percent(real.ratePercent)} a year after ${percent(real.inflationPercent, false)} inflation`;
}

/** The colour of a signed figure: green above zero, red below it, none at zero or without one. */
export const toneClass = (value: string | null): string | undefined => {
  const direction = tone(value);
  return direction && `ui-${direction}`;
};
