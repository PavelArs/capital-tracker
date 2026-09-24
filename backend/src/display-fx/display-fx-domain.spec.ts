import {
  convertUsd,
  observationStatus,
  parseDisplayQuery,
  parseFxObservation,
  retryDeadline,
} from './display-fx-domain';

const now = Date.parse('2026-09-24T12:00:00.000Z');
const day = 86400000;
const minute = 60000;
const body = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    result: 'success',
    base_code: 'USD',
    time_last_update_unix: now / 1000 - 60,
    time_next_update_unix: (now + day) / 1000 - 60,
    time_eol_unix: 0,
    rates: { USD: 1, EUR: 0.9, RUB: 90.12 },
    ...overrides,
  });

describe('daily indicative display FX', () => {
  it('DFX-EXACT returns canonical input and independently calculated products', () => {
    expect(parseDisplayQuery({ amountUsd: '00123.4500' })).toBe('123.45');
    expect(convertUsd('123.45', '0.9')).toBe('111.105');
    expect(convertUsd('123.45', '90.12')).toBe('11125.314');
    expect(convertUsd('0', '90.12')).toBe('0');
    expect(convertUsd('0.000000000000000000000000000001', '0.000000000000000000000000000001')).toBe(
      '0.000000000000000000000000000000000000000000000000000000000001',
    );
  });

  it.each([
    {},
    [],
    null,
    { amountUsd: ['1', '2'] },
    { amountUsd: 1 },
    { amountUsd: '1', url: 'http://127.0.0.1' },
    { amountUsd: '-1' },
    { amountUsd: '1e2' },
    { amountUsd: '1', amount: '2' },
  ])('rejects non-allowlisted private query %p', (input) => {
    expect(() => parseDisplayQuery(input)).toThrow();
  });

  it('DFX-PRECISION preserves raw numeric lexemes before binary floating point conversion', () => {
    const payload = body().replace('"EUR":0.9', '"EUR":0.12345678901234567890123456789');
    expect(parseFxObservation(payload, now)).toEqual({
      observedAt: '2026-09-24T11:59:00.000Z',
      nextUpdateAt: '2026-09-25T11:59:00.000Z',
      endOfLifeAt: null,
      eurRate: '0.12345678901234567890123456789',
      rubRate: '90.12',
    });
  });

  it.each([
    { result: 'error' },
    { base_code: 'EUR' },
    { rates: { USD: 1, EUR: 0.9 } },
    { rates: { USD: 1, EUR: '0.9', RUB: 90.12 } },
    { rates: { USD: 1, EUR: 0, RUB: 90.12 } },
    { rates: { USD: 2, EUR: 0.9, RUB: 90.12 } },
    { rates: { USD: 1, EUR: -0.9, RUB: 90.12 } },
    { time_last_update_unix: (now + 6 * minute) / 1000 },
    { time_last_update_unix: (now - 2 * day - 1000) / 1000 },
    { time_next_update_unix: now / 1000 - 61 },
    { time_next_update_unix: (now + 2 * day) / 1000 },
    { time_eol_unix: now / 1000 },
    { time_eol_unix: '0' },
    { time_last_update_unix: 253402300800 },
  ])('rejects invalid/incomplete provider batch %p atomically', (changes) => {
    expect(() => parseFxObservation(body(changes), now)).toThrow();
  });

  it.each([
    'null',
    '[]',
    '{bad',
    body().replace('"EUR":0.9', '"EUR":9e-1'),
    body().replace('"EUR":0.9', '"EUR":0.1234567890123456789012345678901'),
    body().replace('"EUR":0.9', '"EUR":NaN'),
    ' '.repeat(65537),
  ])('rejects malformed/unsupported raw numeric payload', (payload) => {
    expect(() => parseFxObservation(payload, now)).toThrow();
  });

  it('retains a future source EOL notice', () => {
    expect(
      parseFxObservation(body({ time_eol_unix: (now + 20 * day) / 1000 }), now).endOfLifeAt,
    ).toBe('2026-10-14T12:00:00.000Z');
  });

  it('DFX-COLLECT respects cooldown, Retry-After and exhausted rolling budget', () => {
    expect(retryDeadline(now, undefined, null)).toBe(now + 20 * minute);
    expect(retryDeadline(now, '5', null)).toBe(now + 20 * minute);
    expect(retryDeadline(now, '172800', null)).toBe(now + 2 * day);
    expect(retryDeadline(now, new Date(now + day).toUTCString(), null)).toBe(now + day);
    expect(retryDeadline(now, 'bad', now + 3 * day)).toBe(now + 3 * day);
    expect(retryDeadline(now, '-1', null)).toBe(now + 20 * minute);
  });

  it('distinguishes missing, fresh, stale and failed last-good data', () => {
    const observation = parseFxObservation(body(), now);
    expect(observationStatus(null, 'idle', now)).toBe('unavailable');
    expect(observationStatus(observation, 'ok', now)).toBe('fresh');
    expect(observationStatus(observation, 'provider-error', now)).toBe('stale');
    expect(observationStatus(observation, 'running', now)).toBe('stale');
    expect(observationStatus(observation, 'ok', now + day)).toBe('stale');
  });
});
