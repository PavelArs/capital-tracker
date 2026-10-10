import { Logger } from '@nestjs/common';
import axios from 'axios';
import type { FxRate, RatedCurrency } from './fx-conversion';

export type FxFailure = 'rate_limited' | 'unavailable' | 'invalid_response';
// `detail` names the refused part of an unreadable answer.
export type RatesResult =
  | { ok: true; rates: FxRate[] }
  | { ok: false; reason: FxFailure; detail?: string };

// Bank of Russia currency codes for its XML_dynamic series, and the first day the series is
// asked for. USD, EUR, GBP, CHF, CNY, JPY and KZT are quoted since before 2009, the start of
// the stored history; the others are asked from 2015 so a series that began later is not
// asked for its empty past again every hour. A quote per 10, 100 or 1000 units (JPY, KZT)
// is read per unit.
export const CBR_SERIES: Readonly<Record<RatedCurrency, { code: string; since: string | null }>> = {
  USD: { code: 'R01235', since: null },
  EUR: { code: 'R01239', since: null },
  GBP: { code: 'R01035', since: null },
  CHF: { code: 'R01775', since: null },
  CNY: { code: 'R01375', since: null },
  JPY: { code: 'R01820', since: null },
  KZT: { code: 'R01335', since: null },
  TRY: { code: 'R01700J', since: '2015-01-01' },
  AED: { code: 'R01230', since: '2015-01-01' },
};
const MAX_BODY_BYTES = 1024 * 1024;

class InvalidResponse extends Error {}
function invalid(what: string): never {
  throw new InvalidResponse(what);
}
// The start of a piece of the (public) answer, printable ASCII only.
const excerpt = (text: string, length = 60) =>
  JSON.stringify(text.slice(0, length).replace(/[^\x20-\x7e]/g, '?'));

const cbrDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** "79,0246" (or "79.0246") per nominal 1 or 10, 100… as an exact canonical decimal per unit. */
function perUnit(whole: string, fraction: string, nominal: string): string {
  if (!/^10*$/.test(nominal)) invalid(`nominal ${nominal}`);
  const shift = nominal.length - 1;
  const digits = `${whole}${fraction}`.replace(/^0+/, '') || '0';
  const scale = fraction.length + shift;
  const padded = digits.padStart(scale + 1, '0');
  const integer = padded.slice(0, padded.length - scale).replace(/^0+/, '') || '0';
  const tail = padded.slice(padded.length - scale).replace(/0+$/, '');
  const value = tail ? `${integer}.${tail}` : integer;
  return value === '0' ? invalid('rate 0') : value;
}

// Sticky: records are read one after another, so the first unexpected part is located.
const RECORD =
  /\s*<Record Date="(\d{2})\.(\d{2})\.(\d{4})" Id="(R\d{5}[A-Z]?)">([\s\S]{0,400}?)<\/Record>/y;
// A record holds simple elements in any order; only Nominal and Value are read, others
// (VunitRate since 2023) are skipped.
const ELEMENT = /\s*<([A-Za-z]{1,20})>([^<]{0,100})<\/\1>/y;
const NOMINAL = /^\s*(\d{1,7})\s*$/;
const VALUE = /^\s*(\d{1,10})(?:[,.](\d{1,10}))?\s*$/;

function readRecord(inner: string, date: string): string {
  const fields = new Map<string, string>();
  ELEMENT.lastIndex = 0;
  while (inner.slice(ELEMENT.lastIndex).trim() !== '') {
    const element = ELEMENT.exec(inner);
    if (!element || fields.has(element[1])) invalid(`record on ${date}: ${excerpt(inner, 120)}`);
    fields.set(element[1], element[2]);
  }
  const nominal = NOMINAL.exec(fields.get('Nominal') ?? '');
  const value = VALUE.exec(fields.get('Value') ?? '');
  if (!nominal || !value) invalid(`record on ${date}: ${excerpt(inner, 120)}`);
  try {
    return perUnit(value[1], value[2] ?? '', nominal[1]);
  } catch (error) {
    if (error instanceof InvalidResponse) invalid(`${error.message} on ${date}`);
    throw error;
  }
}

/**
 * XML_dynamic: <ValCurs ID="R01235" DateRange1=… DateRange2=… name=…><Record Date="11.01.2025"
 * Id="R01235"><Nominal>1</Nominal><Value>101,6797</Value>…</Record>…</ValCurs>. Every record
 * must belong to the asked series and range, in ascending date order; anything else is refused.
 */
export function parseCbrDynamic(body: string, code: string, from: string, to: string): FxRate[] {
  const root =
    /^\s*(?:<\?xml[^>]*\?>\s*)?<ValCurs\s+ID="([^"]*)"[^>]*?(?:\/>\s*$|>([\s\S]*)<\/ValCurs>\s*$)/.exec(
      body,
    );
  if (!root) invalid(`no rate list: ${excerpt(body.trimStart())}`);
  if (root[1] !== code) invalid(`series ${excerpt(root[1])}`);
  const content = root[2] ?? '';
  const rates: FxRate[] = [];
  RECORD.lastIndex = 0;
  while (content.slice(RECORD.lastIndex).trim() !== '') {
    const start = RECORD.lastIndex;
    const match = RECORD.exec(content);
    if (!match) {
      const after = rates.length ? ` after ${rates[rates.length - 1].date}` : '';
      invalid(`unexpected content${after}: ${excerpt(content.slice(start).trimStart())}`);
    }
    const [, day, month, year, id, inner] = match;
    const date = `${year}-${month}-${day}`;
    if (id !== code) invalid(`series ${id} on ${date}`);
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
      invalid(`impossible date ${day}.${month}.${year}`);
    if (date < from || date > to) invalid(`${date} outside the range`);
    const last = rates[rates.length - 1]?.date;
    if (last && last >= date) invalid(`${date} after ${last}`);
    rates.push({ date, rubPerUnit: readRecord(inner, date) });
  }
  return rates;
}

export class CbrClient {
  private readonly logger = new Logger(CbrClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryPauseMs: number;

  constructor(options: { baseUrl?: string; timeoutMs?: number; retryPauseMs?: number } = {}) {
    this.baseUrl = options.baseUrl ?? 'https://www.cbr.ru';
    this.timeoutMs = options.timeoutMs ?? 15_000;
    // A failed answer, including a service page sent with HTTP 200, is asked for once more
    // after this pause.
    this.retryPauseMs = options.retryPauseMs ?? 5_000;
  }

  /** Official rates effective from `from` to `to` (inclusive Moscow dates). */
  async dynamic(currency: RatedCurrency, from: string, to: string): Promise<RatesResult> {
    const first = await this.request(currency, from, to);
    if (first.ok) return first;
    await new Promise((resolve) => setTimeout(resolve, this.retryPauseMs));
    return this.request(currency, from, to);
  }

  private async request(currency: RatedCurrency, from: string, to: string): Promise<RatesResult> {
    const { code } = CBR_SERIES[currency];
    const url = `${this.baseUrl}/scripts/XML_dynamic.asp?date_req1=${cbrDate(from)}&date_req2=${cbrDate(to)}&VAL_NM_RQ=${code}`;
    let response: { status: number; data: ArrayBuffer };
    try {
      response = await axios.get<ArrayBuffer>(url, {
        // axios' timeout is an idle timeout; the signal bounds the whole response.
        timeout: this.timeoutMs,
        signal: AbortSignal.timeout(this.timeoutMs),
        maxRedirects: 0,
        maxContentLength: MAX_BODY_BYTES,
        responseType: 'arraybuffer',
        validateStatus: () => true,
        headers: { Accept: 'application/xml, text/xml' },
      });
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    if (response.status === 429) return { ok: false, reason: 'rate_limited' };
    if (response.status !== 200) return { ok: false, reason: 'unavailable' };
    try {
      // The answer is windows-1251; only ASCII digits, dates and tags are read.
      const text = Buffer.from(response.data).toString('latin1');
      return { ok: true, rates: parseCbrDynamic(text, code, from, to) };
    } catch (error) {
      if (error instanceof InvalidResponse) {
        this.logger.warn(
          `Unreadable Bank of Russia answer for ${code} ${from}..${to} (${response.data.byteLength} bytes): ${error.message}`,
        );
        return { ok: false, reason: 'invalid_response', detail: error.message };
      }
      throw error;
    }
  }
}
