import { Logger } from '@nestjs/common';
import axios from 'axios';
import type { AccountingCurrency } from '../fx-rates/fx-conversion';
import { nextMonth, previousMonth } from './inflation-math';

export type InflationProvider = 'bls' | 'eurostat' | 'cbr';
export type InflationFailure = 'rate_limited' | 'unavailable' | 'invalid_response';
/** Percent change of the consumer price level from the previous month, per month. */
export interface MonthlyChange {
  month: string;
  percent: string;
}
export type InflationResult =
  | { ok: true; changes: MonthlyChange[] }
  | { ok: false; reason: InflationFailure; detail?: string };

/** The official source of each currency's inflation. */
export const OFFICIAL_SOURCES: Partial<Record<AccountingCurrency, InflationProvider>> = {
  USD: 'bls',
  EUR: 'eurostat',
  RUB: 'cbr',
};
export const PROVIDER_NAMES: Record<InflationProvider, string> = {
  bls: 'BLS (US CPI-U)',
  eurostat: 'Eurostat (euro area HICP)',
  cbr: 'Bank of Russia (annual inflation)',
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

// A statistics office sometimes skips a month (the US CPI of October 2025 was never
// published); the change across up to this many missing months is spread evenly over them.
const MAX_FILLED_GAP = 3;

/**
 * Percent changes between published months. A gap of up to MAX_FILLED_GAP missing months gets
 * the same change in each of its months and the next one; a longer gap leaves no change for
 * the month after it, which breaks the chain there.
 */
export function levelsToChanges(levels: readonly Level[]): MonthlyChange[] {
  const changes: MonthlyChange[] = [];
  for (let i = 1; i < levels.length; i++) {
    const before = levels[i - 1];
    const after = levels[i];
    let steps = 1;
    for (let month = nextMonth(before.month); month < after.month; month = nextMonth(month))
      steps++;
    if (steps > MAX_FILLED_GAP + 1) continue;
    const percent = ((after.value / before.value) ** (1 / steps) - 1) * 100;
    let month = before.month;
    for (let step = 0; step < steps; step++) {
      month = nextMonth(month);
      changes.push({ month, percent: percent.toFixed(8) });
    }
  }
  return changes;
}

const positive = (text: string, where: string): number => {
  if (!/^\d{1,7}(?:\.\d{1,8})?$/.test(text)) invalid(`value ${excerpt(text)} ${where}`);
  const value = Number(text);
  return value > 0 ? value : invalid(`value 0 ${where}`);
};

/**
 * BLS public API v1 answer for one series: `{"status":"REQUEST_SUCCEEDED","Results":{"series":
 * [{"seriesID":"CUUR0000SA0","data":[{"year":"2026","period":"M08","value":"334.980"},…]}]}}`,
 * newest first. Annual averages (M13) are ignored and a month marked "-" (not published) has no
 * value. A refusal such as the daily limit also comes with HTTP 200 and a message, which is named.
 */
export function parseBlsLevels(body: string, series: string): Level[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return invalid(`not JSON: ${excerpt(body.trimStart())}`);
  }
  const root = data as {
    status?: unknown;
    message?: unknown;
    Results?: { series?: unknown };
  };
  if (root.status !== 'REQUEST_SUCCEEDED') {
    const message = Array.isArray(root.message) ? String(root.message[0] ?? '') : '';
    invalid(`status ${excerpt(String(root.status))}: ${excerpt(message, 120)}`);
  }
  const list = root.Results?.series;
  const entry = Array.isArray(list) && list.length === 1 ? list[0] : undefined;
  if (!entry || entry.seriesID !== series || !Array.isArray(entry.data))
    invalid(`no series ${excerpt(series)}`);
  const seen = new Set<string>();
  const levels: Level[] = [];
  for (const row of entry.data as Record<string, unknown>[]) {
    const { year, period, value } = row;
    if (typeof year !== 'string' || typeof period !== 'string' || typeof value !== 'string')
      invalid('unexpected row');
    const month = /^M(0[1-9]|1[0-2])$/.exec(period as string);
    if (!month || !/^\d{4}$/.test(year as string)) continue;
    const key = `${year}-${month[1]}`;
    if (seen.has(key)) invalid(`${key} twice`);
    seen.add(key);
    if (value === '-') continue;
    levels.push({ month: key, value: positive(value as string, `on ${key}`) });
  }
  return levels.sort((a, b) => (a.month < b.month ? -1 : 1));
}

/**
 * Eurostat JSON-stat 2.0 for prc_hicp_minr (ECOICOP 2; the older prc_hicp_midx stopped at 2025-12)
 * narrowed to one geo, item and unit: the dimensions other than time must hold exactly one
 * category; `value` maps a position to the index.
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

/** The year-over-year inflation of a month, in percent, as the Bank of Russia publishes it. */
export interface YearOverYear {
  month: string;
  percent: number;
}

const CBR_DATE = /^(0[1-9]|1[0-2])\.(\d{4})$/;
const CBR_PERCENT = /^-?\d{1,3}(?:,\d{1,4})?$/;
const cell = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&#160;|&nbsp;/g, ' ')
    .trim();

/**
 * The table of https://www.cbr.ru/hd_base/infl/ : `<table class="data">` with a header row
 * (Дата, Ключевая ставка, Инфляция, % г/г, Цель по инфляции) and one row per month newest
 * first, `MM.YYYY` and percents with a decimal comma. The inflation column is found by its header.
 */
export function parseCbrInflation(html: string): YearOverYear[] {
  const table = /<table[^>]*class="data"[^>]*>([\s\S]{0,200000}?)<\/table>/.exec(html);
  if (!table) invalid(`no inflation table: ${excerpt(html.trimStart())}`);
  const rows = [...table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((item) => cell(item[1])),
  );
  const header = rows[0] ?? [];
  const column = header.findIndex((title) => /^Инфляция/.test(title));
  if (header[0] !== 'Дата' || column < 0 || !/г\/г/.test(header[column]))
    invalid(`unexpected header ${excerpt(header.join('|'), 120)}`);
  const seen = new Set<string>();
  const result: YearOverYear[] = [];
  for (const row of rows.slice(1)) {
    if (row.length !== header.length) invalid(`unexpected row ${excerpt(row.join('|'), 120)}`);
    const date = CBR_DATE.exec(row[0]);
    if (!date) invalid(`date ${excerpt(row[0])}`);
    const month = `${date[2]}-${date[1]}`;
    if (seen.has(month)) invalid(`${month} twice`);
    seen.add(month);
    if (!CBR_PERCENT.test(row[column])) invalid(`value ${excerpt(row[column])} on ${month}`);
    result.push({ month, percent: Number(row[column].replace(',', '.')) });
  }
  if (result.length === 0) invalid('no months');
  return result.sort((a, b) => (a.month < b.month ? -1 : 1));
}

/**
 * Monthly changes rebuilt from year-over-year inflation. A level equals the level a year earlier
 * times (1 + that month's year-over-year rate). The year before the first published month is not
 * known, so its months are assumed to grow evenly at that rate: a month's change can be off by
 * the usual seasonal swing (about half a percent), a year's worth of changes is exact. Only the
 * run of consecutive months ending at the latest one is rebuilt.
 */
export function yearOverYearToChanges(rows: readonly YearOverYear[]): MonthlyChange[] {
  let start = rows.length - 1;
  while (start > 0 && nextMonth(rows[start - 1].month) === rows[start].month) start--;
  const run = rows.slice(start);
  const levels = new Map<string, number>();
  let before = run[0].month;
  for (let i = 0; i < 12; i++) before = previousMonth(before);
  const seedRate = 1 + run[0].percent / 100;
  for (let k = 0; k < 12; k++) {
    levels.set(before, seedRate ** (k / 12));
    before = nextMonth(before);
  }
  for (const { month, percent } of run) {
    let year = month;
    for (let i = 0; i < 12; i++) year = previousMonth(year);
    levels.set(month, (levels.get(year) as number) * (1 + percent / 100));
  }
  const changes: MonthlyChange[] = [];
  let month = nextMonth(previousMonth(run[0].month));
  for (let i = 0; i < 11; i++) month = previousMonth(month);
  for (; month <= run[run.length - 1].month; month = nextMonth(month)) {
    const level = levels.get(month);
    const prior = levels.get(previousMonth(month));
    if (level === undefined || prior === undefined) continue;
    changes.push({ month, percent: ((level / prior - 1) * 100).toFixed(8) });
  }
  return changes;
}

const cbrDate = (date: Date) =>
  `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${date.getUTCFullYear()}`;

// BLS answers at most ten years per request.
const BLS_YEARS_PER_REQUEST = 10;
const BLS_SERIES = 'CUUR0000SA0';

interface Download {
  text: string;
  bytes: number;
}

export class InflationClient {
  private readonly logger = new Logger(InflationClient.name);
  private readonly urls: Record<InflationProvider, string>;
  private readonly timeoutMs: number;
  private readonly retryPauseMs: number;

  constructor(
    options: {
      blsUrl?: string;
      eurostatUrl?: string;
      cbrUrl?: string;
      timeoutMs?: number;
      retryPauseMs?: number;
    } = {},
  ) {
    this.urls = {
      bls: options.blsUrl ?? 'https://api.bls.gov',
      eurostat: options.eurostatUrl ?? 'https://ec.europa.eu',
      cbr: options.cbrUrl ?? 'https://www.cbr.ru',
    };
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.retryPauseMs = options.retryPauseMs ?? 5_000;
  }

  /** The monthly changes of a currency's official series, asked for once more after a failure. */
  async fetch(provider: InflationProvider, now = new Date()): Promise<InflationResult> {
    const first = await this.request(provider, now);
    if (first.ok) return first;
    await new Promise((resolve) => setTimeout(resolve, this.retryPauseMs));
    return this.request(provider, now);
  }

  private async download(
    url: string,
    accept: string,
    body?: unknown,
  ): Promise<{ ok: true; value: Download } | { ok: false; reason: InflationFailure }> {
    try {
      const response = await axios.request<ArrayBuffer>({
        url,
        method: body === undefined ? 'GET' : 'POST',
        data: body,
        timeout: this.timeoutMs,
        signal: AbortSignal.timeout(this.timeoutMs),
        maxRedirects: 0,
        maxContentLength: MAX_BODY_BYTES,
        responseType: 'arraybuffer',
        validateStatus: () => true,
        headers: {
          Accept: accept,
          'User-Agent': 'Mozilla/5.0 (compatible; capital-tracker)',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
      });
      if (response.status === 429) return { ok: false, reason: 'rate_limited' };
      if (response.status !== 200) return { ok: false, reason: 'unavailable' };
      return {
        ok: true,
        value: {
          text: Buffer.from(response.data).toString('utf8'),
          bytes: response.data.byteLength,
        },
      };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  }

  private async request(provider: InflationProvider, now: Date): Promise<InflationResult> {
    const base = this.urls[provider];
    const downloads: Download[] = [];
    const sources: [string, string, unknown?][] =
      provider === 'bls'
        ? this.blsRequests(base, now)
        : provider === 'eurostat'
          ? [
              [
                `${base}/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr?format=JSON&lang=EN&freq=M&unit=I15&coicop18=TOTAL&geo=EA&sinceTimePeriod=${INFLATION_HISTORY_FROM}`,
                'application/json',
              ],
            ]
          : [
              [
                // The page is a GET form: the period is its UniDbQuery.From and .To fields.
                `${base}/hd_base/infl/?UniDbQuery.Posted=True&UniDbQuery.From=01.01.2013&UniDbQuery.To=${cbrDate(now)}`,
                'text/html',
              ],
            ];
    for (const [url, accept, body] of sources) {
      const result = await this.download(url, accept, body);
      if (!result.ok) return result;
      downloads.push(result.value);
    }
    try {
      const changes = {
        bls: () => {
          const levels = downloads
            .flatMap(({ text }) => parseBlsLevels(text, BLS_SERIES))
            .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
          if (levels.length === 0) invalid('no values');
          return levelsToChanges(levels);
        },
        eurostat: () => parseEurostatHicp(downloads[0].text),
        cbr: () => yearOverYearToChanges(parseCbrInflation(downloads[0].text)),
      }[provider]();
      return { ok: true, changes };
    } catch (error) {
      if (error instanceof InvalidResponse) {
        const bytes = downloads.reduce((sum, { bytes }) => sum + bytes, 0);
        this.logger.warn(`Unreadable ${provider} answer (${bytes} bytes): ${error.message}`);
        return { ok: false, reason: 'invalid_response', detail: error.message };
      }
      throw error;
    }
  }

  // The public v1 API takes a POSTed series and years, ten years at most, from December 2008 on.
  private blsRequests(base: string, now: Date): [string, string, unknown][] {
    const requests: [string, string, unknown][] = [];
    const last = now.getUTCFullYear();
    for (let from = Number(INFLATION_HISTORY_FROM.slice(0, 4)); from <= last; ) {
      const to = Math.min(from + BLS_YEARS_PER_REQUEST - 1, last);
      requests.push([
        `${base}/publicAPI/v1/timeseries/data/`,
        'application/json',
        { seriesid: [BLS_SERIES], startyear: String(from), endyear: String(to) },
      ]);
      from = to + 1;
    }
    return requests;
  }
}
