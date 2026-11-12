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
  /** An account is never closed by emptying it; absent means a term deposit. */
  kind?: 'term-deposit' | 'account';
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
export function addMonths(start: string, months: number): string {
  const year = Number(start.slice(0, 4));
  const month = Number(start.slice(5, 7)) - 1;
  const wanted = Number(start.slice(8, 10));
  const index = year * 12 + month + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index % 12;
  const target = Math.min(wanted, daysInMonth(targetYear, targetMonth));
  return dateOf(Date.UTC(targetYear, targetMonth, target));
}

const beforeEnd = (terms: DepositTerms, date: string): boolean =>
  terms.endDate === null || date < terms.endDate;

// Daily posts at the end of every day from the first one on; the end date is added after.
function dailyPayoutDates(terms: DepositTerms, last: string): string[] {
  const dates: string[] = [];
  for (
    let date = nextDay(terms.startDate);
    date <= last && beforeEnd(terms, date);
    date = nextDay(date)
  )
    dates.push(date);
  return dates;
}

const monthsPerPayout: Record<PayoutSchedule, number> = {
  daily: 0,
  monthly: 1,
  quarterly: 3,
  'at-end': 0,
};

function monthlyPayoutDates(terms: DepositTerms, last: string): string[] {
  const dates: string[] = [];
  const every = monthsPerPayout[terms.payout];
  if (!(every > 0)) return dates;
  for (let step = 1; ; step += 1) {
    const date = addMonths(terms.startDate, step * every);
    if (date > last || !beforeEnd(terms, date)) break;
    dates.push(date);
  }
  return dates;
}

/** The dates interest is posted, ascending, up to and including `last`. */
export function payoutDates(terms: DepositTerms, last: string): string[] {
  const dates =
    terms.payout === 'daily' ? dailyPayoutDates(terms, last) : monthlyPayoutDates(terms, last);
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

/** The day-by-day replay of a deposit; `next` is the first movement not yet applied. */
interface Replay {
  principal: bigint;
  accrued: bigint;
  due: bigint;
  posted: bigint;
  paidOut: bigint;
  forfeited: bigint;
  closedOn: string | null;
  periodStart: string;
  periods: InterestPeriod[];
  next: number;
}

function startReplay(terms: DepositTerms): Replay {
  return {
    principal: 0n,
    accrued: 0n,
    due: 0n,
    posted: 0n,
    paidOut: 0n,
    forfeited: 0n,
    closedOn: null,
    periodStart: terms.startDate,
    periods: [],
    next: 0,
  };
}

/** A payout date posts what was earned since the last one, rounded to cents. */
function postInterest(terms: DepositTerms, replay: Replay, date: string): void {
  const interest = roundToCents(replay.accrued);
  if (terms.capitalized) replay.principal += interest;
  else replay.due += interest;
  replay.posted += interest;
  replay.accrued = 0n;
  replay.periods.push({
    from: replay.periodStart,
    to: date,
    interest: centsText(interest),
    treatment: terms.capitalized ? 'capitalized' : 'payable',
  });
  replay.periodStart = date;
}

/** An interest payout takes out at most the interest due. */
function payOut(replay: Replay, amount: bigint): void {
  const taken = amount < replay.due ? amount : replay.due;
  replay.due -= taken;
  replay.paidOut += taken;
}

/** The whole deposit is withdrawn before its end date: what it earned since the last posting. */
function closeEarly(terms: DepositTerms, replay: Replay, date: string): void {
  if (terms.earlyClose === 'forfeits-interest') replay.forfeited = replay.accrued;
  else {
    // Closing pays what was earned since the last payout date: it is due now.
    const interest = roundToCents(replay.accrued);
    replay.due += interest;
    replay.posted += interest;
    // A payout date has just posted the period; nothing is left to show for today.
    if (replay.periodStart < date)
      replay.periods.push({
        from: replay.periodStart,
        to: date,
        interest: centsText(interest),
        treatment: 'payable',
      });
  }
  replay.accrued = 0n;
}

function withdraw(terms: DepositTerms, replay: Replay, date: string, amount: bigint): void {
  replay.principal -= amount < replay.principal ? amount : replay.principal;
  // An account has no term: emptying it leaves it open for the next top-up.
  if (replay.principal !== 0n || terms.kind === 'account') return;
  replay.closedOn = date;
  if (beforeEnd(terms, date)) closeEarly(terms, replay, date);
}

/** Posts the interest on a payout date, then applies the movements up to `date`. */
function settleDay(
  terms: DepositTerms,
  movements: readonly DepositMovement[],
  posting: ReadonlySet<string>,
  replay: Replay,
  date: string,
): void {
  if (posting.has(date)) postInterest(terms, replay, date);
  for (; replay.next < movements.length && movements[replay.next].date <= date; replay.next += 1) {
    const movement = movements[replay.next];
    const amount = canonicalDecimalToAtoms(movement.amount);
    if (movement.kind === 'topup') replay.principal += amount;
    else if (movement.kind === 'interest-payout') payOut(replay, amount);
    else withdraw(terms, replay, date, amount);
  }
}

/** A day earns interest on the money held after its movements. */
function accrueDay(terms: DepositTerms, replay: Replay, date: string): void {
  const rate = rateOn(terms.rates, date);
  replay.accrued +=
    (replay.principal * rate) / (100n * RATE_STEP * daysInYearOf(terms.dayBasis, date));
}

/** Once the replay has stopped, only payouts of posted interest up to `until` follow. */
function payOutUntil(movements: readonly DepositMovement[], replay: Replay, until: string): void {
  for (; replay.next < movements.length && movements[replay.next].date <= until; replay.next += 1) {
    const movement = movements[replay.next];
    if (movement.kind === 'interest-payout')
      payOut(replay, canonicalDecimalToAtoms(movement.amount));
  }
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
  const replay = startReplay(terms);
  for (
    let date = terms.startDate;
    date <= horizon && replay.closedOn === null;
    date = nextDay(date)
  ) {
    settleDay(terms, movements, posting, replay, date);
    if (replay.closedOn === null && date < horizon) accrueDay(terms, replay, date);
  }
  // Interest posted at maturity or at closure can be paid out after the replay stopped.
  payOutUntil(movements, replay, asOf);

  const { principal, due } = replay;
  const earned = roundToCents(replay.accrued);
  return {
    asOf,
    closedOn: replay.closedOn,
    principal: centsText(principal),
    accrued: centsText(earned),
    due: centsText(due),
    balance: centsText(principal + due + earned),
    posted: centsText(principal + due),
    interestPosted: centsText(replay.posted),
    interestPaidOut: centsText(replay.paidOut),
    interestForfeited: centsText(roundToCents(replay.forfeited)),
    periods: replay.periods,
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
  const replay = startReplay(terms);
  let index = 0;
  const balance = () => replay.principal + replay.due + roundToCents(replay.accrued);
  for (; index < wanted.length && wanted[index] < terms.startDate; index += 1)
    balances.set(wanted[index], 0n);

  for (
    let date = terms.startDate;
    date <= horizon && replay.closedOn === null;
    date = nextDay(date)
  ) {
    settleDay(terms, movements, posting, replay, date);
    for (; index < wanted.length && wanted[index] === date; index += 1)
      balances.set(date, balance());
    if (replay.closedOn === null && date < horizon) accrueDay(terms, replay, date);
  }

  // The replay has stopped (closed, or at the end date): only payouts of posted interest follow.
  for (; index < wanted.length; index += 1) {
    payOutUntil(movements, replay, wanted[index]);
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

/**
 * The next payout date after `asOf`, or null when none is left (or the deposit is closed). With
 * `knownFrom`, a payout whose period starts before that day is null: part of its days have no rate.
 */
export function nextPayout(
  terms: DepositTerms,
  movements: readonly DepositMovement[],
  asOf: string,
  knownFrom?: string,
): { date: string; interest: string; treatment: 'capitalized' | 'payable' } | null {
  // Clamped dates can leave a quarter a day longer than three months.
  const horizon = terms.endDate ?? addMonths(asOf, 4);
  const coming = payoutDates(terms, horizon).find((date) => date > asOf);
  if (!coming) return null;
  const then = projectDeposit(terms, movements, coming);
  const period = then.periods[then.periods.length - 1];
  if (!period || period.to !== coming) return null;
  if (knownFrom !== undefined && period.from < knownFrom) return null;
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
  // Missing is not zero: while an account's rates do not reach back to its opening day, the money
  // and interest the replay holds are lower bounds (DEP-ACCOUNT), so they are not a maximum for
  // a withdrawal when capitalized, or a payout otherwise. The replay only takes what it holds.
  const lowerBounds =
    terms.kind === 'account' && !terms.rates.some((rate) => rate.effectiveFrom <= terms.startDate);
  for (const [index, movement] of movements.entries()) {
    if (outsideTerm(terms, movement)) return index;
    if (index > 0 && movements[index - 1].date > movement.date) return index;
    const before = projectDeposit(terms, movements.slice(0, index), movement.date);
    if (exceedsWhatIsHeld(terms, lowerBounds, movement, before)) return index;
  }
  return -1;
}

function outsideTerm(terms: DepositTerms, movement: DepositMovement): boolean {
  if (movement.date < terms.startDate) return true;
  // Money can be taken out on the end date, but a top-up that day would earn nothing.
  if (terms.endDate === null || movement.kind === 'interest-payout') return false;
  return (
    movement.date > terms.endDate || (movement.kind === 'topup' && movement.date >= terms.endDate)
  );
}

function exceedsWhatIsHeld(
  terms: DepositTerms,
  lowerBounds: boolean,
  movement: DepositMovement,
  before: DepositProjection,
): boolean {
  const amount = canonicalDecimalToAtoms(movement.amount);
  if (movement.kind === 'interest-payout')
    return (!lowerBounds || terms.capitalized) && amount > canonicalDecimalToAtoms(before.due);
  if (before.closedOn !== null) return true;
  return (
    movement.kind === 'withdrawal' &&
    (!lowerBounds || !terms.capitalized) &&
    amount > canonicalDecimalToAtoms(before.principal)
  );
}

/**
 * DEP-PREVIEW: what a deposit would come to, from its terms alone, before it is added: the
 * balance and interest at the end of the term (null without one) and the first interest date
 * with its interest. The same replay as a saved deposit, with the opening top-up only.
 */
export function previewDeposit(terms: DepositTerms, amount: string) {
  if (terms.rates.length === 0) return { atMaturity: null, firstPayout: null };
  const opening: DepositMovement[] = [{ date: terms.startDate, kind: 'topup', amount }];
  const end = terms.endDate === null ? null : projectDeposit(terms, opening, terms.endDate);
  return {
    atMaturity:
      end === null
        ? null
        : { date: terms.endDate as string, balance: end.balance, interest: end.interestPosted },
    firstPayout: nextPayout(terms, opening, terms.startDate),
  };
}
