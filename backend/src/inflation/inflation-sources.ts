import { Logger } from '@nestjs/common';
import axios from 'axios';
import type { AccountingCurrency } from '../fx-rates/fx-conversion';
import { nextMonth } from './inflation-math';

export type InflationProvider = 'fred' | 'eurostat';
export type InflationFailure = 'rate_limited' | 'unavailable' | 'invalid_response';
/** Percent change of the consumer price level from the previous month, per month. */
export interface MonthlyChange {
  month: string;
  percent: string;
}
export type InflationResult =
  | { ok: true; changes: MonthlyChange[] }
  | { ok: false; reason: InflationFailure; detail?: string };

/** The official source of each currency's inflation; RUB has none read automatically yet. */
export const OFFICIAL_SOURCES: Partial<Record<AccountingCurrency, InflationProvider>> = {
  USD: 'fred',
  EUR: 'eurostat',
};
export const PROVIDER_NAMES: Record<InflationProvider, string> = {
  fred: 'FRED (US CPI-U)',
  eurostat: 'Eurostat (euro area HICP)',
};

// Index values from December 2008, so the first change stored is January 2009.
export const INFLATION_HISTORY_FROM = '2008-12';
const MAX_BODY_BYTES = 2 * 1024 * 1024;

class InvalidResponse extends Error {}
function invalid(what: string): never {
  throw new InvalidResponse(what);
}
const excerpt = (text: string, length = 60) =>
  JSON.stringify(text.slice(0, length).replace(/[^\x20-\x7e]/g, '?'));

interface Level {
  month: string;
  value: number;
}

/** Percent changes between consecutive months; a month after a missing one has no change. */
export function levelsToChanges(levels: readonly Level[]): MonthlyChange[] {
  const changes: MonthlyChange[] = [];
  for (let i = 1; i < levels.length; i++) {
    const before = levels[i - 1];
    const after = levels[i];
    if (nextMonth(before.month) !== after.month) continue;
    changes.push({
      month: after.month,
      percent: ((after.value / before.value - 1) * 100).toFixed(8),
    });
  }
  return changes;
}

const positive = (text: string, where: string): number => {
  if (!/^\d{1,7}(?:\.\d{1,8})?$/.test(text)) invalid(`value ${excerpt(text)} ${where}`);
  const value = Number(text);
  return value > 0 ? value : invalid(`value 0 ${where}`);
};

/**
 * FRED graph CSV: `observation_date,CPIAUCNS` (older files say `DATE`), then one `YYYY-MM-01,value`
 * row per month ascending; a month without a value holds ".". Anything else is refused.
 */
export function parseFredCsv(body: string, series: string): MonthlyChange[] {
  const lines = body.replace(/^﻿/, '').split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  const header = /^(?:observation_date|DATE),([A-Za-z0-9_]{1,40})$/.exec(lines[0] ?? '');
  if (!header) invalid(`no series header: ${excerpt(body.trimStart())}`);
  if (header[1] !== series) invalid(`series ${excerpt(header[1])}`);
  const levels: Level[] = [];
  for (const line of lines.slice(1)) {
    const row = /^(\d{4})-(\d{2})-01,([^,]{1,20})$/.exec(line);
    if (!row) invalid(`unexpected row ${excerpt(line)}`);
    const month = `${row[1]}-${row[2]}`;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) invalid(`impossible month ${month}`);
    const last = levels[levels.length - 1]?.month;
    if (last && last >= month) invalid(`${month} after ${last}`);
    if (row[3] === '.') continue;
    levels.push({ month, value: positive(row[3], `on ${month}`) });
  }
  if (levels.length === 0) invalid('no values');
  return levelsToChanges(levels);
}

/**
 * Eurostat JSON-stat 2.0 for prc_hicp_midx narrowed to one geo, item and unit: the dimensions
 * other than time must hold exactly one category; `value` maps a position to the index.
 */
export function parseEurostatHicp(body: string): MonthlyChange[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return invalid(`not JSON: ${excerpt(body.trimStart())}`);
  }
  const root = data as {
    id?: unknown;
    size?: unknown;
    value?: unknown;
    dimension?: { time?: { category?: { index?: unknown } } };
  };
  if (!Array.isArray(root.id) || !Array.isArray(root.size) || root.id.length !== root.size.length)
    invalid('no dimensions');
  const ids = root.id as unknown[];
  const sizes = root.size as unknown[];
  const timeAxis = ids.indexOf('time');
  if (timeAxis < 0) invalid('no time dimension');
  ids.forEach((id, axis) => {
    if (axis !== timeAxis && sizes[axis] !== 1)
      invalid(`dimension ${excerpt(String(id))} is not one value`);
  });
  const index = root.dimension?.time?.category?.index;
  const values = root.value;
  if (!index || typeof index !== 'object' || Array.isArray(index)) invalid('no months');
  if (!values || typeof values !== 'object' || Array.isArray(values)) invalid('no values');
  const positions = new Map<number, string>();
  for (const [month, position] of Object.entries(index as Record<string, unknown>)) {
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
      !Number.isInteger(position) ||
      (position as number) < 0
    )
      invalid(`month ${excerpt(month)}`);
    positions.set(position as number, month);
  }
  const levels: Level[] = [];
  for (const [position, month] of [...positions].sort(([a], [b]) => a - b)) {
    const value = (values as Record<string, unknown>)[String(position)];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
      invalid(`value on ${month}`);
    const last = levels[levels.length - 1]?.month;
    if (last && last >= month) invalid(`${month} after ${last}`);
    levels.push({ month, value });
  }
  if (levels.length === 0) invalid('no values');
  return levelsToChanges(levels);
}

export class InflationClient {
  private readonly logger = new Logger(InflationClient.name);
  private readonly fredUrl: string;
  private readonly eurostatUrl: string;
  private readonly timeoutMs: number;
  private readonly retryPauseMs: number;

  constructor(
    options: {
      fredUrl?: string;
      eurostatUrl?: string;
      timeoutMs?: number;
      retryPauseMs?: number;
    } = {},
  ) {
    this.fredUrl = options.fredUrl ?? 'https://fred.stlouisfed.org';
    this.eurostatUrl = options.eurostatUrl ?? 'https://ec.europa.eu';
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.retryPauseMs = options.retryPauseMs ?? 5_000;
  }

  /** The monthly changes of a currency's official series, asked for once more after a failure. */
  async fetch(provider: InflationProvider): Promise<InflationResult> {
    const first = await this.request(provider);
    if (first.ok) return first;
    await new Promise((resolve) => setTimeout(resolve, this.retryPauseMs));
    return this.request(provider);
  }

  private async request(provider: InflationProvider): Promise<InflationResult> {
    const url =
      provider === 'fred'
        ? `${this.fredUrl}/graph/fredgraph.csv?id=CPIAUCNS&cosd=${INFLATION_HISTORY_FROM}-01`
        : `${this.eurostatUrl}/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_midx?format=JSON&lang=EN&freq=M&unit=I15&coicop=CP00&geo=EA&sinceTimePeriod=${INFLATION_HISTORY_FROM}`;
    let response: { status: number; data: ArrayBuffer };
    try {
      response = await axios.get<ArrayBuffer>(url, {
        timeout: this.timeoutMs,
        signal: AbortSignal.timeout(this.timeoutMs),
        maxRedirects: 0,
        maxContentLength: MAX_BODY_BYTES,
        responseType: 'arraybuffer',
        validateStatus: () => true,
        headers: { Accept: provider === 'fred' ? 'text/csv' : 'application/json' },
      });
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    if (response.status === 429) return { ok: false, reason: 'rate_limited' };
    if (response.status !== 200) return { ok: false, reason: 'unavailable' };
    try {
      const text = Buffer.from(response.data).toString('utf8');
      return {
        ok: true,
        changes: provider === 'fred' ? parseFredCsv(text, 'CPIAUCNS') : parseEurostatHicp(text),
      };
    } catch (error) {
      if (error instanceof InvalidResponse) {
        this.logger.warn(
          `Unreadable ${provider} answer (${response.data.byteLength} bytes): ${error.message}`,
        );
        return { ok: false, reason: 'invalid_response', detail: error.message };
      }
      throw error;
    }
  }
}
