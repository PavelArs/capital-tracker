import type { Deposit, DepositStatus, MovementKind } from '@api/deposits.api';

const DAY_MS = 86_400_000;

/** "1 Oct 2026" from a calendar date, whatever the browser's time zone. */
export function dateText(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const MOSCOW_OFFSET_MS = 3 * 3_600_000;

/** Today's calendar date in Moscow, the day the server counts interest by. */
export const today = () => new Date(Date.now() + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);

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
