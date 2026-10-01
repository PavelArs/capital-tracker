import { BadRequestException } from '@nestjs/common';
import { parseDecimal } from '../accounting/input';
import { canonicalDecimalToAtoms, formatProduct } from '../accounting/money';

export const FX_SOURCE = 'exchangerate-api-open';
export const DAY_MS = 86400000;
export const FX_COOLDOWN_MS = 20 * 60000;
const MAX_INSTANT = Date.parse('9999-12-31T23:59:59.999Z');

export interface FxObservation {
  observedAt: string;
  nextUpdateAt: string;
  endOfLifeAt: string | null;
  eurRate: string;
  rubRate: string;
}
export class FxDataError extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FxDataError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new FxDataError();
  return value as Record<string, unknown>;
}

export function parseDisplayQuery(value: unknown): string {
  try {
    const query = record(value);
    if (Object.keys(query).some((key) => key !== 'amountUsd')) throw new FxDataError();
    return parseDecimal(query.amountUsd, false);
  } catch {
    throw new BadRequestException('Invalid display conversion input');
  }
}

export function assertEmptyInput(value: unknown): void {
  try {
    if (Object.keys(record(value ?? {})).length) throw new FxDataError();
  } catch {
    throw new BadRequestException('Invalid display conversion input');
  }
}

class NumericToken {
  constructor(readonly source: string) {}
}

function numberText(value: unknown): string {
  if (!(value instanceof NumericToken)) throw new FxDataError();
  return value.source;
}

function epoch(value: unknown): number {
  const text = numberText(value);
  if (!/^\d{1,12}$/.test(text)) throw new FxDataError();
  const milliseconds = Number(text) * 1000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds > MAX_INSTANT) throw new FxDataError();
  return milliseconds;
}

export function parseFxObservation(text: string, now: number): FxObservation {
  try {
    if (Buffer.byteLength(text) > 65536) throw new FxDataError();
    const value: unknown = JSON.parse(
      text,
      (_key: string, item: unknown, context?: { source?: string }) => {
        if (typeof item !== 'number') return item;
        if (typeof context?.source !== 'string') throw new FxDataError();
        return new NumericToken(context.source);
      },
    );
    const row = record(value);
    if (row.result !== 'success' || row.base_code !== 'USD') throw new FxDataError();
    const rates = record(row.rates);
    if (parseDecimal(numberText(rates.USD), true) !== '1') throw new FxDataError();
    const eurRate = parseDecimal(numberText(rates.EUR), true);
    const rubRate = parseDecimal(numberText(rates.RUB), true);
    const publication = epoch(row.time_last_update_unix);
    const next = epoch(row.time_next_update_unix);
    const eol = epoch(row.time_eol_unix);
    if (
      publication > now + 5 * 60000 ||
      publication < now - 2 * DAY_MS ||
      next <= publication ||
      next > publication + 2 * DAY_MS ||
      (eol !== 0 && eol <= now)
    )
      throw new FxDataError();
    return {
      observedAt: new Date(publication).toISOString(),
      nextUpdateAt: new Date(next).toISOString(),
      endOfLifeAt: eol === 0 ? null : new Date(eol).toISOString(),
      eurRate,
      rubRate,
    };
  } catch {
    throw new FxDataError('Invalid daily display observation');
  }
}

export function convertUsd(amount: string, rate: string): string {
  return formatProduct(canonicalDecimalToAtoms(amount) * canonicalDecimalToAtoms(rate));
}

export function retryDeadline(now: number, retryAfter: unknown, budgetEnd: number | null): number {
  let upstream = 0;
  if (typeof retryAfter === 'string') {
    if (/^\d+$/.test(retryAfter)) upstream = Math.min(MAX_INSTANT, now + Number(retryAfter) * 1000);
    else if (/^[A-Za-z]{3}, /.test(retryAfter)) upstream = Date.parse(retryAfter);
  }
  return Math.min(
    MAX_INSTANT,
    Math.max(now + FX_COOLDOWN_MS, Number.isFinite(upstream) ? upstream : 0, budgetEnd ?? 0),
  );
}

export function observationStatus(observation: FxObservation | null, outcome: string, now: number) {
  if (!observation) return 'unavailable' as const;
  return outcome !== 'ok' ||
    now >= Date.parse(observation.nextUpdateAt) ||
    now - Date.parse(observation.observedAt) >= 2 * DAY_MS ||
    (observation.endOfLifeAt !== null && now >= Date.parse(observation.endOfLifeAt))
    ? ('stale' as const)
    : ('fresh' as const);
}
