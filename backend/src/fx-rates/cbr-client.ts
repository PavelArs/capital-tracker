import { Logger } from '@nestjs/common';
import axios from 'axios';
import type { FxRate, RatedCurrency } from './fx-conversion';

export type FxFailure = 'rate_limited' | 'unavailable' | 'invalid_response';
export type RatesResult = { ok: true; rates: FxRate[] } | { ok: false; reason: FxFailure };

// Bank of Russia currency codes for its XML_dynamic series.
export const CBR_CODES: Readonly<Record<RatedCurrency, string>> = { USD: 'R01235', EUR: 'R01239' };
const MAX_BODY_BYTES = 1024 * 1024;

class InvalidResponse extends Error {}
function invalid(): never {
  throw new InvalidResponse();
}

const cbrDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** "79,0246" per nominal 1 or 10, 100… as an exact canonical decimal per unit. */
function perUnit(whole: string, fraction: string, nominal: string): string {
  if (!/^10*$/.test(nominal)) invalid();
  const shift = nominal.length - 1;
  const digits = `${whole}${fraction}`.replace(/^0+/, '') || '0';
  const scale = fraction.length + shift;
  const padded = digits.padStart(scale + 1, '0');
  const integer = padded.slice(0, padded.length - scale).replace(/^0+/, '') || '0';
  const tail = padded.slice(padded.length - scale).replace(/0+$/, '');
  const value = tail ? `${integer}.${tail}` : integer;
  return value === '0' ? invalid() : value;
}

const RECORD =
  /<Record Date="(\d{2})\.(\d{2})\.(\d{4})" Id="(R\d{5}[A-Z]?)">\s*<Nominal>(\d{1,7})<\/Nominal>\s*<Value>(\d{1,10}),(\d{1,10})<\/Value>(?:\s*<VunitRate>\d{1,10},\d{1,30}<\/VunitRate>)?\s*<\/Record>/g;

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
  if (!root || root[1] !== code) invalid();
  const content = root[2] ?? '';
  const rates: FxRate[] = [];
  for (const match of content.matchAll(RECORD)) {
    const [, day, month, year, id, nominal, whole, fraction] = match;
    if (id !== code) invalid();
    const date = `${year}-${month}-${day}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) invalid();
    if (date < from || date > to) invalid();
    if (rates.length && rates[rates.length - 1].date >= date) invalid();
    rates.push({ date, rubPerUnit: perUnit(whole, fraction, nominal) });
  }
  if (content.replace(RECORD, '').trim() !== '') invalid();
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
    const code = CBR_CODES[currency];
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
        // The start of the answer, printable ASCII only, tells a service page from a format change.
        const start = Buffer.from(response.data)
          .subarray(0, 120)
          .toString('latin1')
          .replace(/[^\x20-\x7e]/g, '?');
        this.logger.warn(
          `Unreadable Bank of Russia answer for ${code} ${from}..${to}: ${response.data.byteLength} bytes, "${start}"`,
        );
        return { ok: false, reason: 'invalid_response' };
      }
      throw error;
    }
  }
}
