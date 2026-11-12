import { setImmediate } from 'node:timers/promises';
import Decimal from 'decimal.js';
import { canonicalDecimalToAtoms } from './money';
import type { parseProfitPreview } from './period-profit';
import type { FlowVersion } from './portfolio-flow';

const D = Decimal.clone({ precision: 96, rounding: Decimal.ROUND_HALF_EVEN });
const YEAR_MS = '31536000000';
const MIN_RATE = new D('-0.999999');
const MAX_RATE = new D('1000');
const TOLERANCE = new D('0.0000000001');
const BRACKET_WIDTH = new D('0.00000000000001');

type Valuations = ReturnType<typeof parseProfitPreview>;
type Reason =
  | 'insufficient-cash-flows'
  | 'one-sided-cash-flows'
  | 'unsupported-pattern'
  | 'too-many-cash-flow-dates'
  | 'outside-supported-range'
  | 'numerical-failure';
type Metadata = {
  convention: 'ACT/365F-UTC-ms';
  rateTolerance: '0.0000000001';
  cashFlowDateCount: number;
  shortPeriod: boolean;
};
export type XirrResult = Metadata &
  (
    | { status: 'available'; annualRate: string; annualPercent: string; reason: null }
    | { status: 'unavailable'; annualRate: null; annualPercent: null; reason: Reason }
  );

type Point = [time: number, atoms: bigint];
type Term = { amount: Decimal; fromFirst: Decimal; fromLast: Decimal };
type Outcome = {
  unavailable: (reason: Reason) => XirrResult;
  available: (rate: Decimal) => XirrResult;
};

/** The net cash flow at each instant, the opening value paid in and the closing one out. */
function cashFlowPoints(input: Valuations, items: readonly FlowVersion[]): Point[] {
  const amounts = new Map<number, bigint>();
  const add = (at: string, atoms: bigint) => {
    const time = Date.parse(at);
    amounts.set(time, (amounts.get(time) ?? 0n) + atoms);
  };
  add(input.from, -canonicalDecimalToAtoms(input.openingValueUsd));
  add(input.to, canonicalDecimalToAtoms(input.closingValueUsd));
  for (const item of items) {
    const atoms = canonicalDecimalToAtoms(item.amountUsd);
    add(item.occurredAt, item.direction === 'contribution' ? -atoms : atoms);
  }
  return [...amounts.entries()].filter(([, atoms]) => atoms !== 0n).sort(([a], [b]) => a - b);
}

/** Why the flows have no single rate to look for: too few, one-sided or not out-then-in. */
function patternReason(points: readonly Point[]): Reason | null {
  if (points.length < 2) return 'insufficient-cash-flows';
  if (!points.some(([, a]) => a < 0n) || !points.some(([, a]) => a > 0n))
    return 'one-sided-cash-flows';
  let positiveSeen = false;
  for (const [, amount] of points) {
    if (amount > 0n) positiveSeen = true;
    else if (positiveSeen) return 'unsupported-pattern';
  }
  if (points.length > 64) return 'too-many-cash-flow-dates';
  return null;
}

/** The flows discounted at `rate`, yielding to the event loop every eighth term. */
async function evaluate(terms: readonly Term[], rate: Decimal): Promise<Decimal> {
  const base = rate.plus('1');
  const logarithm = base.ln();
  let sum = new D('0');
  for (let index = 0; index < terms.length; index++) {
    const term = terms[index];
    const exponent = rate.isNegative() ? term.fromLast : term.fromFirst;
    // Integral powers preserve exact simple annual boundary oracles. Scaling by
    // a common positive factor keeps every discount <=1 and preserves root signs.
    const discount = exponent.isInteger() ? base.pow(exponent) : exponent.times(logarithm).exp();
    sum = sum.plus(term.amount.times(discount));
    if ((index + 1) % 8 === 0) await setImmediate();
  }
  return sum;
}

/** A candidate rate, kept only when the sum changes sign within the tolerance around it. */
async function qualify(
  terms: readonly Term[],
  candidate: Decimal,
  outcome: Outcome,
): Promise<XirrResult> {
  const rate = candidate.toDecimalPlaces(12);
  const left = D.max(MIN_RATE, rate.minus(TOLERANCE));
  const right = D.min(MAX_RATE, rate.plus(TOLERANCE));
  const a = await evaluate(terms, left);
  const b = await evaluate(terms, right);
  if (!a.isFinite() || !b.isFinite() || a.lt('0') || b.gt('0'))
    return outcome.unavailable('numerical-failure');
  return outcome.available(rate);
}

/** Bisection between the supported bounds for the rate where the discounted sum is zero. */
async function findRate(terms: readonly Term[], outcome: Outcome): Promise<XirrResult> {
  await setImmediate();
  const a = await evaluate(terms, MIN_RATE);
  const b = await evaluate(terms, MAX_RATE);
  if (!a.isFinite() || !b.isFinite()) return outcome.unavailable('numerical-failure');
  if (a.lt('0') || b.gt('0')) return outcome.unavailable('outside-supported-range');
  if (a.isZero()) return qualify(terms, MIN_RATE, outcome);
  if (b.isZero()) return qualify(terms, MAX_RATE, outcome);
  return bisect(terms, outcome);
}

/** Halves the bracket until it is narrower than the tolerance or the sum is exactly zero. */
async function bisect(terms: readonly Term[], outcome: Outcome): Promise<XirrResult> {
  let low = MIN_RATE;
  let high = MAX_RATE;
  for (let iteration = 0; iteration < 80; iteration++) {
    const middle = low.plus(high).div('2');
    if (high.minus(low).lte(BRACKET_WIDTH)) return qualify(terms, middle, outcome);
    const value = await evaluate(terms, middle);
    if (!value.isFinite()) return outcome.unavailable('numerical-failure');
    // A rounded numerical zero needs surrounding sign evidence, unlike exact net zero.
    if (value.isZero()) return qualify(terms, middle, outcome);
    if (value.gt('0')) low = middle;
    else high = middle;
    await setImmediate();
  }
  return outcome.unavailable('numerical-failure');
}

/** Items are the complete effective period, already filtered by projectFlowPeriod. */
export async function projectXirr(
  input: Valuations,
  items: readonly FlowVersion[],
): Promise<XirrResult> {
  const points = cashFlowPoints(input, items);
  const first = points[0]?.[0] ?? 0;
  const last = points[points.length - 1]?.[0] ?? 0;
  const metadata: Metadata = {
    convention: 'ACT/365F-UTC-ms',
    rateTolerance: '0.0000000001',
    cashFlowDateCount: points.length,
    shortPeriod: points.length >= 2 && last - first < 31536000000,
  };
  const unavailable = (reason: Reason): XirrResult => ({
    ...metadata,
    status: 'unavailable',
    annualRate: null,
    annualPercent: null,
    reason,
  });
  const available = (rate: Decimal): XirrResult => {
    const rounded = rate.toDecimalPlaces(12);
    return {
      ...metadata,
      status: 'available',
      annualRate: rounded.isZero() ? '0' : rounded.toFixed(),
      annualPercent: rounded.isZero() ? '0' : rounded.times('100').toFixed(),
      reason: null,
    };
  };

  const reason = patternReason(points);
  if (reason) return unavailable(reason);
  // Only the qualified pattern has a unique root, so only now can net zero prove it.
  if (points.reduce((sum, [, amount]) => sum + amount, 0n) === 0n) return available(new D('0'));

  const terms = points.map(([time, atoms]) => ({
    amount: new D(atoms.toString()),
    fromFirst: new D(String(first - time)).div(YEAR_MS),
    fromLast: new D(String(last - time)).div(YEAR_MS),
  }));
  return findRate(terms, { unavailable, available });
}
