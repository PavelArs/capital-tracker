import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import type { AxiosRequestConfig } from 'axios';

// What the chain provider clients share: strict guards for the JSON they read, the bounds of
// every request they send, and the short form of a refusal their logs keep.

class InvalidResponse extends Error {}

export function invalid(): never {
  throw new InvalidResponse();
}
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();
}
export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : invalid();
}
/** A whole number from 0 to `maximum`. */
export function integer(value: unknown, maximum: number): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum
    ? (value as number)
    : invalid();
}

/** No redirect, a deadline on the whole answer, at most `maxBodyBytes`, every status answered. */
export function boundedRequest(timeoutMs: number, maxBodyBytes: number): AxiosRequestConfig {
  return {
    // axios' timeout is an idle timeout; the signal bounds the whole response.
    timeout: timeoutMs,
    signal: AbortSignal.timeout(timeoutMs),
    maxRedirects: 0,
    maxContentLength: maxBodyBytes,
    responseType: 'text',
    transformResponse: [(data: string) => data],
    validateStatus: () => true,
  };
}

/** Agents that open a new connection for every request (TRON-SYNC). */
export function newConnectionAgents() {
  return {
    httpAgent: new HttpAgent({ keepAlive: false }),
    httpsAgent: new HttpsAgent({ keepAlive: false }),
  };
}

export function errorCode(error: unknown): string {
  const failure = error as { code?: unknown; name?: unknown; cause?: { code?: unknown } };
  for (const value of [failure?.code, failure?.cause?.code, failure?.name])
    if (typeof value === 'string' && value) return value;
  return 'unknown error';
}

const LOGGED_CHARS = 160;
/** The first characters of what a provider said, on one line, without what `redact` cuts out. */
export function loggedDetail(detail: string, redact: (text: string) => string): string {
  // Redacted before the cut, so no identifier is left half-shown at the end.
  return redact(detail.slice(0, LOGGED_CHARS + 100))
    .slice(0, LOGGED_CHARS)
    .replace(/\s+/g, ' ')
    .trim();
}
