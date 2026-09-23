import { randomUUID } from 'node:crypto';
import {
  parsePriceHistoryQuery,
  parsePricePageQuery,
  parsePriceSet,
  parsePriceVoid,
} from './manual-price-input';

const requestId = randomUUID();
const base = {
  requestId,
  expectedRevision: 0,
  observedAt: '2025-01-01T03:00:00+03:00',
  priceUsd: '0001.2300',
  assertReviewed: true,
};

describe('PRICE-EXACT / BOUND strict manual price commands', () => {
  it('normalizes exact strings and equivalent UTC instants', () => {
    expect(parsePriceSet(base)).toEqual({
      ...base,
      observedAt: '2025-01-01T00:00:00.000Z',
      priceUsd: '1.23',
    });
  });
  it.each(['0', '0.000000000000000000000000000001', `${'9'.repeat(48)}.${'9'.repeat(30)}`])(
    'preserves the exact price %s',
    (priceUsd) => expect(parsePriceSet({ ...base, priceUsd }).priceUsd).toBe(priceUsd),
  );
  it.each([
    { priceUsd: 1 },
    { priceUsd: null },
    { priceUsd: '-1' },
    { priceUsd: '1e3' },
    { priceUsd: 'NaN' },
    { priceUsd: 'Infinity' },
    { priceUsd: ' 1' },
    { priceUsd: '1,2' },
    { priceUsd: '9'.repeat(49) },
    { priceUsd: `0.${'1'.repeat(31)}` },
    { requestId: 'not-a-uuid' },
    { expectedRevision: '0' },
    { expectedRevision: -1 },
    { expectedRevision: 10001 },
    { expectedRevision: 0.5 },
    { expectedRevision: Number.NaN },
    { assertReviewed: false },
    { assertReviewed: 'true' },
    { ownerId: randomUUID() },
    { source: 'provider' },
    { quoteCurrency: 'EUR' },
    { observedAt: '2025-02-30T00:00:00Z' },
    { observedAt: '1969-12-31T23:59:59Z' },
    { observedAt: '2025-01-01' },
    { observedAt: '2025-01-01T00:00:00.0001Z' },
  ])('rejects invalid or unreviewed input %p', (changes) => {
    expect(() => parsePriceSet({ ...base, ...changes })).toThrow();
  });
  it('accepts cap revision so an original command can be checked for replay', () => {
    expect(parsePriceSet({ ...base, expectedRevision: 10000 }).expectedRevision).toBe(10000);
  });
  it('void has no price field and preserves the exact intended point', () => {
    const { priceUsd: _price, ...input } = base;
    expect(parsePriceVoid(input)).toEqual({ ...input, observedAt: '2025-01-01T00:00:00.000Z' });
    expect(() => parsePriceVoid(base)).toThrow();
    expect(() => parsePriceVoid({ ...input, assertReviewed: false })).toThrow();
  });
  it.each([undefined, null, [], 'price', Object.create({ ...base })])(
    'rejects non-plain input %p',
    (raw) => {
      expect(() => parsePriceSet(raw)).toThrow();
      expect(() => parsePriceVoid(raw)).toThrow();
    },
  );
});

describe('PRICE-PAGES strict effective and immutable history queries', () => {
  it('defaults and pinned last empty page', () => {
    expect(parsePricePageQuery({})).toEqual({ offset: 0, limit: 50 });
    expect(parsePricePageQuery({ revision: '10000', offset: '10000', limit: '100' })).toEqual({
      revision: 10000,
      offset: 10000,
      limit: 100,
    });
  });
  it.each([
    { offset: '1' },
    { offset: '10001', revision: '10000' },
    { revision: '10001' },
    { revision: ['0', '1'] },
    { revision: 0 },
    { offset: '01' },
    { offset: '-1' },
    { limit: '0' },
    { limit: '101' },
    { limit: '1.0' },
    { unexpected: '1' },
  ])('rejects malformed or unpinned pages %p', (input) => {
    expect(() => parsePricePageQuery(input)).toThrow();
  });
  it('normalizes immutable timestamp history', () => {
    expect(parsePriceHistoryQuery({ observedAt: base.observedAt })).toEqual({
      observedAt: '2025-01-01T00:00:00.000Z',
      limit: 10,
    });
    expect(
      parsePriceHistoryQuery({ observedAt: base.observedAt, beforeRevision: '10001', limit: '20' }),
    ).toMatchObject({ beforeRevision: 10001, limit: 20 });
  });
  it.each([
    {},
    { observedAt: [base.observedAt] },
    { observedAt: base.observedAt, beforeRevision: '0' },
    { observedAt: base.observedAt, beforeRevision: '10002' },
    { observedAt: base.observedAt, limit: '21' },
    { observedAt: base.observedAt, offset: '1' },
  ])('rejects invalid history %p', (input) =>
    expect(() => parsePriceHistoryQuery(input)).toThrow(),
  );
});
