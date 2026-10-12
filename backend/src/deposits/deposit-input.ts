import { BadRequestException } from '@nestjs/common';
import { parseUuid } from '../accounting/input';
import {
  type DayBasis,
  type DepositCurrency,
  dayBases,
  depositCurrencies,
  type EarlyCloseRule,
  earlyCloseRules,
  offeredPayoutSchedules,
  type PayoutSchedule,
} from './deposit-interest';

export { parseUuid };

export interface DepositInput {
  requestId: string;
  name: string;
  bank: string;
  currency: DepositCurrency;
  startDate: string;
  endDate: string | null;
  payout: PayoutSchedule;
  capitalized: boolean;
  dayBasis: DayBasis;
  earlyClose: EarlyCloseRule;
  ratePercent: string;
  amount: string;
}
export interface MovementInput {
  requestId: string;
  date: string;
  kind: 'topup' | 'withdrawal' | 'interest-payout';
  amount: string;
  comment: string | null;
}
export interface RateInput {
  effectiveFrom: string;
  ratePercent: string;
}
export interface CheckInput {
  requestId: string;
  checkedOn: string;
  bankBalance: string;
}

/** The longest term accepted, in years. */
const MAX_TERM_YEARS = 30;

const bad = (): never => {
  throw new BadRequestException('Invalid deposit input');
};

function object(input: unknown, keys: readonly string[], required: readonly string[]) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad();
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) return bad();
  if (required.some((key) => record[key] === undefined)) return bad();
  return record;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return bad();
  const trimmed = value.trim();
  const chars = Array.from(trimmed);
  if (
    chars.length === 0 ||
    chars.length > maximum ||
    chars.some((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    return bad();
  return trimmed;
}

export function parseDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return bad();
  const time = Date.parse(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== value ||
    value < '1970-01-01' ||
    value > '2999-12-31'
  )
    return bad();
  return value;
}

/**
 * A positive amount with at most two decimal places, as a bank shows it. Up to twelve whole
 * digits, so that every accepted amount is shown to the cent by the page.
 */
export function parseAmount(value: unknown, allowZero = false): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(value)) return bad();
  const [whole, fraction = ''] = value.split('.');
  const result = `${whole}.${fraction.padEnd(2, '0')}`;
  if (!allowZero && result === '0.00') return bad();
  return result;
}

/** An annual rate in percent with at most four decimal places, below 1000. */
export function parseRate(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,2})(\.\d{1,4})?$/.test(value)) return bad();
  const [whole, fraction = ''] = value.split('.');
  return fraction ? `${whole}.${fraction.replace(/0+$/, '') || '0'}` : whole;
}

function member<T extends string>(value: unknown, allowed: readonly T[]): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : bad();
}

export function parseDeposit(input: unknown): DepositInput {
  const keys = [
    'requestId',
    'name',
    'bank',
    'currency',
    'startDate',
    'endDate',
    'payout',
    'capitalized',
    'dayBasis',
    'earlyClose',
    'ratePercent',
    'amount',
  ];
  const record = object(input, keys, keys);
  const startDate = parseDate(record.startDate);
  const endDate = record.endDate === null ? null : parseDate(record.endDate);
  const payout = member(record.payout, offeredPayoutSchedules);
  if (endDate !== null && endDate <= startDate) return bad();
  // A bank term never runs this long; the figures are replayed day by day to the end date.
  if (
    endDate !== null &&
    endDate > `${Number(startDate.slice(0, 4)) + MAX_TERM_YEARS}${startDate.slice(4)}`
  )
    return bad();
  if (payout === 'at-end' && endDate === null) return bad();
  if (typeof record.capitalized !== 'boolean') return bad();
  return {
    requestId: parseUuid(record.requestId),
    name: text(record.name, 120),
    bank: text(record.bank, 120),
    currency: member(record.currency, depositCurrencies),
    startDate,
    endDate,
    payout,
    capitalized: record.capitalized,
    dayBasis: member(record.dayBasis, dayBases),
    earlyClose: member(record.earlyClose, earlyCloseRules),
    ratePercent: parseRate(record.ratePercent),
    amount: parseAmount(record.amount),
  };
}

export function parseMovement(input: unknown): MovementInput {
  const record = object(
    input,
    ['requestId', 'date', 'kind', 'amount', 'comment'],
    ['requestId', 'date', 'kind', 'amount'],
  );
  return {
    requestId: parseUuid(record.requestId),
    date: parseDate(record.date),
    kind: member(record.kind, ['topup', 'withdrawal', 'interest-payout'] as const),
    amount: parseAmount(record.amount),
    comment:
      record.comment === undefined || record.comment === null ? null : text(record.comment, 200),
  };
}

export function parseRateChange(input: unknown): RateInput {
  const record = object(input, ['effectiveFrom', 'ratePercent'], ['effectiveFrom', 'ratePercent']);
  return {
    effectiveFrom: parseDate(record.effectiveFrom),
    ratePercent: parseRate(record.ratePercent),
  };
}

export function parseCheck(input: unknown): CheckInput {
  const record = object(
    input,
    ['requestId', 'checkedOn', 'bankBalance'],
    ['requestId', 'checkedOn', 'bankBalance'],
  );
  return {
    requestId: parseUuid(record.requestId),
    checkedOn: parseDate(record.checkedOn),
    bankBalance: parseAmount(record.bankBalance, true),
  };
}

export function parseAsOfDate(value: unknown): string | undefined {
  return value === undefined ? undefined : parseDate(value);
}
