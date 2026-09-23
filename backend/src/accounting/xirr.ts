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

/** Items are the complete effective period, already filtered by projectFlowPeriod. */
export async function projectXirr(
  input: Valuations,
  items: readonly FlowVersion[],
): Promise<XirrResult> {
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
  const points = [...amounts.entries()]
    .filter(([, atoms]) => atoms !== 0n)
    .sort(([a], [b]) => a - b);
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

  if (points.length < 2) return unavailable('insufficient-cash-flows');
  if (!points.some(([, a]) => a < 0n) || !points.some(([, a]) => a > 0n))
    return unavailable('one-sided-cash-flows');
  let positiveSeen = false;
  for (const [, amount] of points) {
    if (amount > 0n) positiveSeen = true;
    else if (positiveSeen) return unavailable('unsupported-pattern');
  }
  if (points.length > 64) return unavailable('too-many-cash-flow-dates');
  // Only the qualified pattern has a unique root, so only now can net zero prove it.
  if (points.reduce((sum, [, amount]) => sum + amount, 0n) === 0n) return available(new D('0'));

  const terms = points.map(([time, atoms]) => ({
    amount: new D(atoms.toString()),
    fromFirst: new D(String(first - time)).div(YEAR_MS),
    fromLast: new D(String(last - time)).div(YEAR_MS),
  }));
  const evaluate = async (rate: Decimal): Promise<Decimal> => {
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
  };
  const qualify = async (candidate: Decimal): Promise<XirrResult> => {
    const rate = candidate.toDecimalPlaces(12);
    const left = D.max(MIN_RATE, rate.minus(TOLERANCE));
    const right = D.min(MAX_RATE, rate.plus(TOLERANCE));
    const a = await evaluate(left);
    const b = await evaluate(right);
    if (!a.isFinite() || !b.isFinite() || a.lt('0') || b.gt('0'))
      return unavailable('numerical-failure');
    return available(rate);
  };

  await setImmediate();
  let low = MIN_RATE;
  let high = MAX_RATE;
  const a = await evaluate(low);
  const b = await evaluate(high);
  if (!a.isFinite() || !b.isFinite()) return unavailable('numerical-failure');
  if (a.lt('0') || b.gt('0')) return unavailable('outside-supported-range');
  if (a.isZero()) return qualify(low);
  if (b.isZero()) return qualify(high);
  for (let iteration = 0; iteration < 80; iteration++) {
    const middle = low.plus(high).div('2');
    if (high.minus(low).lte(BRACKET_WIDTH)) return qualify(middle);
    const value = await evaluate(middle);
    if (!value.isFinite()) return unavailable('numerical-failure');
    // A rounded numerical zero needs surrounding sign evidence, unlike exact net zero.
    if (value.isZero()) return qualify(middle);
    if (value.gt('0')) low = middle;
    else high = middle;
    await setImmediate();
  }
  return unavailable('numerical-failure');
}
