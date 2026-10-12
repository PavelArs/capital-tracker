import type { Deposit, DepositDetail, DepositStatus, MovementKind } from '@api/deposits.api';

type DepositPeriod = DepositDetail['periods'][number];

import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import type { BadgeTone } from '@/ui/Badge';
import { dayText } from '@/utils/dates';
import { currencySymbols, DASH } from '../portfolio/format';

const DAY_MS = 86_400_000;

/** "Oct 1, 2026" from a calendar date, the way the rest of the app writes dates. */
export const dateText = (date: string): string => dayText(`${date}T00:00:00Z`);

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const MOSCOW_OFFSET_MS = 3 * 3_600_000;

/** Today's calendar date in Moscow, the day the server counts interest by. */
export const today = () => new Date(Date.now() + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);

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

const payoutNames = {
  daily: 'daily',
  monthly: 'monthly',
  quarterly: 'quarterly',
  'at-end': 'at the end of the term',
};

/** "12% · interest paid monthly · until 1 Oct 2026". */
export function termText(deposit: Deposit): string {
  const rate = `${deposit.ratePercent}%`;
  const interest = deposit.capitalized
    ? `interest added ${payoutNames[deposit.payout]}`
    : `interest paid ${payoutNames[deposit.payout]}`;
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
 */
export function money(value: string | null, currency: AccountingCurrency, signed = false): string {
  if (value === null) return DASH;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return DASH;
  const cents = (match[3] ?? '').padEnd(2, '0').slice(0, 2);
  const whole = match[2].replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+$)/g, ',');
  const zero = /^0+$/.test(match[2] + cents);
  const mark = match[1] && !zero ? '-' : signed && !zero ? '+' : '';
  return `${mark}${currencySymbols[currency]}${whole}.${cents}`;
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
