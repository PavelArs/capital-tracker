import { BadRequestException } from '@nestjs/common';
import {
  type AccountingCurrency,
  accountingCurrencies,
  isAccountingCurrency,
  moscowDate,
} from '../fx-rates/fx-conversion';
import { type InflationBasis, isDay, isMonth } from './inflation-math';

const bad = (what: string): never => {
  throw new BadRequestException(`Invalid ${what}`);
};

export const parseCurrency = (value: unknown): AccountingCurrency =>
  isAccountingCurrency(value) ? value : bad('currency');

export const parseMonth = (value: unknown): string => (isMonth(value) ? value : bad('month'));

/**
 * A month the owner types in: one that has begun on the Moscow calendar. A later one (a typo in
 * the year) would have every month before it estimated and is refused.
 */
export function parseTypedMonth(value: unknown, now: Date): string {
  const month = parseMonth(value);
  if (month > moscowDate(now).slice(0, 7))
    throw new BadRequestException('An inflation month cannot be after the current month');
  return month;
}

/** A decimal percent with at most eight places, inside the range the tables accept. */
export function parsePercent(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string' || !/^-?\d{1,4}(?:\.\d{1,8})?$/.test(value)) return bad('percent');
  const number = Number(value);
  return number > min && number < max ? value : bad('percent');
}

/** Monthly change from the previous month: a price level cannot fall by 100% or more. */
export const parseMonthlyChange = (input: unknown): string => {
  const body = input as { changePercent?: unknown } | null;
  if (!body || typeof body !== 'object' || Object.keys(body).join() !== 'changePercent')
    return bad('inflation month');
  return parsePercent(body.changePercent, -100, 1000);
};

/** `{ annualPercent: "7.5" }` sets the owner's own rate; `{ annualPercent: null }` removes it. */
export const parsePersonalRate = (input: unknown): string | null => {
  const body = input as { annualPercent?: unknown } | null;
  if (!body || typeof body !== 'object' || Object.keys(body).join() !== 'annualPercent')
    return bad('personal rate');
  return body.annualPercent === null ? null : parsePercent(body.annualPercent, -50, 1000);
};

export interface FactorQuery {
  currency: AccountingCurrency;
  basis: InflationBasis;
  from: string;
  to: string;
}

/** `?currency=USD&from=YYYY-MM-DD&to=YYYY-MM-DD&basis=official|personal` (basis defaults to official). */
export function parseFactorQuery(query: unknown): FactorQuery {
  const keys = query && typeof query === 'object' ? Object.keys(query) : [];
  if (keys.some((key) => !['currency', 'from', 'to', 'basis'].includes(key)))
    return bad('inflation query');
  const { currency, from, to, basis } = query as Record<string, unknown>;
  if (basis !== undefined && basis !== 'official' && basis !== 'personal') return bad('basis');
  if (!isDay(from) || !isDay(to) || from > to || from < '1990-01-01') return bad('dates');
  return { currency: parseCurrency(currency), basis: basis ?? 'official', from, to } as FactorQuery;
}

export { accountingCurrencies };
