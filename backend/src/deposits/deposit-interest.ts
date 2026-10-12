import { canonicalDecimalToAtoms } from '../accounting/money';

// DEP-ACCRUAL: what a bank deposit has earned, computed from its terms and movements. Nothing
// computed here is stored; the balance a bank shows is only ever compared with it.

export const depositCurrencies = ['RUB', 'USD', 'EUR'] as const;
export type DepositCurrency = (typeof depositCurrencies)[number];
/** Every schedule a stored deposit can have; quarterly deposits made earlier keep it. */
export const payoutSchedules = ['daily', 'monthly', 'quarterly', 'at-end'] as const;
export type PayoutSchedule = (typeof payoutSchedules)[number];
/** What a new deposit can choose: quarterly is no longer offered. */
export const offeredPayoutSchedules = ['daily', 'monthly', 'at-end'] as const;
export const dayBases = ['actual-365', 'actual-actual'] as const;
export type DayBasis = (typeof dayBases)[number];
export const earlyCloseRules = ['forfeits-interest', 'keeps-interest'] as const;
export type EarlyCloseRule = (typeof earlyCloseRules)[number];

/** The annual rate in percent (up to four places) from a date on. */
export interface RateVersion {
  effectiveFrom: string;
  ratePercent: string;
}

export interface DepositTerms {
  /** The first day the money earns interest. */
  startDate: string;
  /** The day the term ends and the money is returned; null for a deposit without a term. */
  endDate: string | null;
  payout: PayoutSchedule;
  /** The interest joins the deposit at each payout date instead of being paid out. */
  capitalized: boolean;
  dayBasis: DayBasis;
  /** What closing the whole deposit before its end date does to interest not yet posted. */
  earlyClose: EarlyCloseRule;
  rates: readonly RateVersion[];
}

/** Applied in the order given; the caller sorts them by date. */
export interface DepositMovement {
  date: string;
  /** topup and withdrawal change the deposit; interest-payout takes posted interest out. */
  kind: 'topup' | 'withdrawal' | 'interest-payout';
  amount: string;
}

export interface InterestPeriod {
  from: string;
  to: string;
  interest: string;
  treatment: 'capitalized' | 'payable';
}

export interface DepositProjection {
  asOf: string;
  /** The day the whole deposit was withdrawn, or null while it holds money. */
  closedOn: string | null;
  /** Money in the deposit, with the interest that was capitalized. */
  principal: string;
  /** Interest earned since the last payout date and not yet posted by the bank. */
  accrued: string;
  /** Interest posted at a payout date and not yet paid out to the owner. */
  due: string;
  /** What the bank would show today: principal, posted interest still due and accrued. */
  balance: string;
  /** Principal and interest still due, without the interest earned since the last payout date. */
  posted: string;
  interestPosted: string;
  interestPaidOut: string;
  interestForfeited: string;
  periods: InterestPeriod[];
}

const CENT = 10n ** 28n;
const RATE_STEP = 10_000n;

const day = (value: string): number => Date.parse(`${value}T00:00:00Z`);
const dateOf = (time: number): string => new Date(time).toISOString().slice(0, 10);
const nextDay = (value: string): string => dateOf(day(value) + 86_400_000);

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The date `months` calendar months after `start`, on its day of the month or the last day. */
function addMonths(start: string, months: number): string {
  const year = Number(start.slice(0, 4));
  const month = Number(start.slice(5, 7)) - 1;
  const wanted = Number(start.slice(8, 10));
  const index = year * 12 + month + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index % 12;
  const target = Math.min(wanted, daysInMonth(targetYear, targetMonth));
  return dateOf(Date.UTC(targetYear, targetMonth, target));
}

/** The dates interest is posted, ascending, up to and including `last`. */
export function payoutDates(terms: DepositTerms, last: string): string[] {
  const dates: string[] = [];
  // Daily posts at the end of every day from the first one on; the end date is added below.
  if (terms.payout === 'daily')
    for (let date = nextDay(terms.startDate); date <= last; date = nextDay(date)) {
      if (terms.endDate !== null && date >= terms.endDate) break;
      dates.push(date);
    }
  const every = terms.payout === 'monthly' ? 1 : terms.payout === 'quarterly' ? 3 : 0;
  if (every > 0)
    for (let step = 1; ; step += 1) {
      const date = addMonths(terms.startDate, step * every);
      if (date > last || (terms.endDate !== null && date >= terms.endDate)) break;
      dates.push(date);
    }
  if (terms.endDate !== null && terms.endDate <= last && terms.endDate > terms.startDate)
    dates.push(terms.endDate);
  return dates;
}

function roundToCents(atoms: bigint): bigint {
  return ((atoms + CENT / 2n) / CENT) * CENT;
}

/** Fixed two places, half away from zero, as a bank statement shows an amount. */
export function centsText(atoms: bigint): string {
  const negative = atoms < 0n;
  const magnitude = ((negative ? -atoms : atoms) + CENT / 2n) / CENT;
  const whole = (magnitude / 100n).toString();
  const fraction = (magnitude % 100n).toString().padStart(2, '0');
  return `${negative && magnitude > 0n ? '-' : ''}${whole}.${fraction}`;
}

function rateOn(rates: readonly RateVersion[], date: string): bigint {
  let found = 0n;
  for (const rate of rates) {
    if (rate.effectiveFrom > date) break;
    const [whole, fraction = ''] = rate.ratePercent.split('.');
    found = BigInt(whole) * RATE_STEP + BigInt(fraction.padEnd(4, '0').slice(0, 4));
  }
  return found;
}

function daysInYearOf(basis: DayBasis, date: string): bigint {
  return basis === 'actual-actual' && isLeap(Number(date.slice(0, 4))) ? 366n : 365n;
}

/**
 * Replays the deposit day by day up to `asOf` (or its end date). A day earns interest on the
 * money held after that day's movements, so the start day counts and the end day does not;
 * `asOf` itself is not yet earned. Interest is posted, rounded to cents, on each payout date
 * and the end date, before that day's movements, and either joins the money (capitalized) or
 * becomes payable until an interest-payout movement takes it out.
 */
export function projectDeposit(
  terms: DepositTerms,
  movements: readonly DepositMovement[],
  asOf: string,
): DepositProjection {
  const horizon = terms.endDate !== null && terms.endDate < asOf ? terms.endDate : asOf;
  const posting = new Set(payoutDates(terms, horizon));
  let principal = 0n;
  let accrued = 0n;
  let due = 0n;
  let posted = 0n;
  let paidOut = 0n;
  let forfeited = 0n;
  let closedOn: string | null = null;
  let periodStart = terms.startDate;
  const periods: InterestPeriod[] = [];
  let next = 0;

  for (let date = terms.startDate; date <= horizon && closedOn === null; date = nextDay(date)) {
    if (posting.has(date)) {
      const interest = roundToCents(accrued);
      if (terms.capitalized) principal += interest;
      else due += interest;
      posted += interest;
      accrued = 0n;
      periods.push({
        from: periodStart,
        to: date,
        interest: centsText(interest),
        treatment: terms.capitalized ? 'capitalized' : 'payable',
      });
      periodStart = date;
    }
    for (; next < movements.length && movements[next].date <= date; next += 1) {
      const movement = movements[next];
      const amount = canonicalDecimalToAtoms(movement.amount);
      if (movement.kind === 'topup') principal += amount;
      else if (movement.kind === 'interest-payout') {
        const taken = amount < due ? amount : due;
        due -= taken;
        paidOut += taken;
      } else {
        principal -= amount < principal ? amount : principal;
        if (principal === 0n) {
          closedOn = date;
          if (terms.endDate === null || date < terms.endDate) {
            if (terms.earlyClose === 'forfeits-interest') forfeited = accrued;
            else {
              // Closing pays what was earned since the last payout date: it is due now.
              const interest = roundToCents(accrued);
              due += interest;
              posted += interest;
              // A payout date has just posted the period; nothing is left to show for today.
              if (periodStart < date)
                periods.push({
                  from: periodStart,
                  to: date,
                  interest: centsText(interest),
                  treatment: 'payable',
                });
            }
            accrued = 0n;
          }
        }
      }
    }
    if (closedOn === null && date < horizon) {
      const rate = rateOn(terms.rates, date);
      accrued += (principal * rate) / (100n * RATE_STEP * daysInYearOf(terms.dayBasis, date));
    }
  }

  // Interest posted at maturity or at closure can be paid out after the replay stopped.
  for (; next < movements.length && movements[next].date <= asOf; next += 1) {
    const movement = movements[next];
    if (movement.kind !== 'interest-payout') continue;
    const taken = canonicalDecimalToAtoms(movement.amount);
    const paid = taken < due ? taken : due;
    due -= paid;
    paidOut += paid;
  }

  const earned = roundToCents(accrued);
  return {
    asOf,
    closedOn,
    principal: centsText(principal),
    accrued: centsText(earned),
    due: centsText(due),
    balance: centsText(principal + due + earned),
    posted: centsText(principal + due),
    interestPosted: centsText(posted),
    interestPaidOut: centsText(paidOut),
    interestForfeited: centsText(roundToCents(forfeited)),
    periods,
  };
}

/**
 * What `projectDeposit(...).balance` is on each of the dates, in atoms, from one replay instead
 * of one per date: a history of hundreds of dates would otherwise replay the deposit from its
 * start every time. The replay is the same day-by-day one; a date is read after that day's
 * interest posting and movements and before the day itself earns anything. A date before the
 * start is nothing.
 */
export function depositBalances(
  terms: DepositTerms,
  movements: readonly DepositMovement[],
  dates: readonly string[],
): Map<string, bigint> {
  const wanted = [...new Set(dates)].sort();
  const balances = new Map<string, bigint>();
  if (wanted.length === 0) return balances;
  const last = wanted[wanted.length - 1];
  const horizon = terms.endDate !== null && terms.endDate < last ? terms.endDate : last;
  const posting = new Set(payoutDates(terms, horizon));
  let principal = 0n;
  let accrued = 0n;
  let due = 0n;
  let closedOn: string | null = null;
  let next = 0;
  let index = 0;
  const balance = () => principal + due + roundToCents(accrued);
  for (; index < wanted.length && wanted[index] < terms.startDate; index += 1)
    balances.set(wanted[index], 0n);

  for (let date = terms.startDate; date <= horizon && closedOn === null; date = nextDay(date)) {
    if (posting.has(date)) {
      const interest = roundToCents(accrued);
      if (terms.capitalized) principal += interest;
      else due += interest;
      accrued = 0n;
    }
    for (; next < movements.length && movements[next].date <= date; next += 1) {
      const movement = movements[next];
      const amount = canonicalDecimalToAtoms(movement.amount);
      if (movement.kind === 'topup') principal += amount;
      else if (movement.kind === 'interest-payout') {
        due -= amount < due ? amount : due;
      } else {
        principal -= amount < principal ? amount : principal;
        if (principal === 0n) {
          closedOn = date;
          if (terms.endDate === null || date < terms.endDate) {
            if (terms.earlyClose !== 'forfeits-interest') due += roundToCents(accrued);
            accrued = 0n;
          }
        }
      }
    }
    for (; index < wanted.length && wanted[index] === date; index += 1)
      balances.set(date, balance());
    if (closedOn === null && date < horizon) {
      const rate = rateOn(terms.rates, date);
      accrued += (principal * rate) / (100n * RATE_STEP * daysInYearOf(terms.dayBasis, date));
    }
  }

  // The replay has stopped (closed, or at the end date): only payouts of posted interest follow.
  for (; index < wanted.length; index += 1) {
    for (; next < movements.length && movements[next].date <= wanted[index]; next += 1) {
      const movement = movements[next];
      if (movement.kind !== 'interest-payout') continue;
      const taken = canonicalDecimalToAtoms(movement.amount);
      due -= taken < due ? taken : due;
    }
    balances.set(wanted[index], balance());
  }
  return balances;
}

/**
 * The balance a bank's screen is compared with. A bank that adds interest to the deposit on the
 * payout date (capitalization) shows only what it has posted; a deposit that pays interest out
 * shows the balance with what was earned so far.
 */
export function bankBalanceOf(terms: DepositTerms, projection: DepositProjection): string {
  return terms.capitalized ? projection.posted : projection.balance;
}

/** The next payout date after `asOf`, or null when none is left (or the deposit is closed). */
export function nextPayout(
  terms: DepositTerms,
  movements: readonly DepositMovement[],
  asOf: string,
): { date: string; interest: string; treatment: 'capitalized' | 'payable' } | null {
  // Clamped dates can leave a quarter a day longer than three months.
  const horizon = terms.endDate ?? addMonths(asOf, 4);
  const coming = payoutDates(terms, horizon).find((date) => date > asOf);
  if (!coming) return null;
  const then = projectDeposit(terms, movements, coming);
  const period = then.periods[then.periods.length - 1];
  if (!period || period.to !== coming) return null;
  return { date: coming, interest: period.interest, treatment: period.treatment };
}

/**
 * The index of the first movement the deposit cannot have had, or -1: a withdrawal larger than
 * the money held, a payout larger than the interest due, or money moved on or after the day the
 * whole deposit was withdrawn. Movements are in date order.
 */
export function firstImpossibleMovement(
  terms: DepositTerms,
  movements: readonly DepositMovement[],
): number {
  for (const [index, movement] of movements.entries()) {
    if (movement.date < terms.startDate) return index;
    // Money can be taken out on the end date, but a top-up that day would earn nothing.
    if (
      terms.endDate !== null &&
      movement.kind !== 'interest-payout' &&
      (movement.date > terms.endDate ||
        (movement.kind === 'topup' && movement.date >= terms.endDate))
    )
      return index;
    if (index > 0 && movements[index - 1].date > movement.date) return index;
    const before = projectDeposit(terms, movements.slice(0, index), movement.date);
    const amount = canonicalDecimalToAtoms(movement.amount);
    if (movement.kind === 'interest-payout') {
      if (amount > canonicalDecimalToAtoms(before.due)) return index;
    } else if (before.closedOn !== null) {
      return index;
    } else if (
      movement.kind === 'withdrawal' &&
      amount > canonicalDecimalToAtoms(before.principal)
    ) {
      return index;
    }
  }
  return -1;
}
