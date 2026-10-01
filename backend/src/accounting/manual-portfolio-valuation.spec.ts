import { BadRequestException } from '@nestjs/common';
import { type PortfolioAccount, projectManualPortfolioValue } from './manual-portfolio-valuation';
import { parseManualPortfolioRequest } from './manual-portfolio-valuation-input';

const at = '2025-01-04T00:00:00.000Z';
const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const instrument = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const price = (instrumentId = instrument, priceUsd = '123.456') => ({
  instrumentId,
  priceUsd,
  observedAt: at,
  revision: 7,
});
const covered = (
  accountId = first,
  quantity = '0.5',
  instrumentId = instrument,
): PortfolioAccount => ({
  accountId,
  name: '<script>literal account</script>',
  coverage: 'covered',
  coverageFrom: '2025-01-01T00:00:00.000Z',
  journalRevision: 3,
  positions: [
    {
      instrumentId,
      instrumentName: 'Tracked token',
      instrumentSymbol: 'SAME',
      quantity,
      costUsd: '1',
    },
  ],
});

describe('MPV-EXACT/GAPS bounded exact subset projection', () => {
  it('uses one UUID price across accounts, sums exactly and preserves receipts without mutation', () => {
    const accounts = [covered(), covered(second, '2')];
    const before = structuredClone(accounts);
    const result = projectManualPortfolioValue(accounts, [price()]);
    expect(result).toMatchObject({
      completeness: 'complete',
      unavailableAccountCount: 0,
      missingPriceCount: 0,
      pricedSubtotalUsd: '308.64',
      totalValueUsd: '308.64',
    });
    expect(result.accounts.map((row) => row.totalValueUsd)).toEqual(['61.728', '246.912']);
    expect(result.accounts[0]).toMatchObject({
      accountId: first,
      journalRevision: 3,
      items: [
        {
          instrumentId: instrument,
          quantity: '0.5',
          price: {
            priceUsd: '123.456',
            observedAt: at,
            revision: 7,
          },
          valueUsd: '61.728',
        },
      ],
    });
    expect(accounts).toEqual(before);
  });

  it('never substitutes same-symbol prices or lets an incomplete subtotal become the total', () => {
    const result = projectManualPortfolioValue([covered(), covered(second, '2', other)], [price()]);
    expect(result).toMatchObject({
      completeness: 'incomplete',
      unavailableAccountCount: 0,
      missingPriceCount: 1,
      pricedSubtotalUsd: '61.728',
      totalValueUsd: null,
    });
    expect(result.accounts[1].items[0]).toMatchObject({
      instrumentId: other,
      price: null,
      valueUsd: null,
    });
    const zero = projectManualPortfolioValue(
      [covered(), covered(second, '2', other)],
      [price(), price(other, '0')],
    );
    expect(zero.totalValueUsd).toBe('61.728');
    expect(zero.accounts[1].totalValueUsd).toBe('0');
  });

  it.each(['missing-journal', 'before-coverage'] as const)(
    'keeps %s unknown separately from missing prices',
    (coverage) => {
      const result = projectManualPortfolioValue(
        [
          covered(),
          {
            accountId: second,
            name: 'Unknown',
            coverage,
            coverageFrom: coverage === 'before-coverage' ? '2026-01-01T00:00:00.000Z' : null,
            journalRevision: coverage === 'before-coverage' ? 2 : null,
          },
        ],
        [price()],
      );
      expect(result).toMatchObject({
        completeness: 'incomplete',
        unavailableAccountCount: 1,
        missingPriceCount: 0,
        pricedSubtotalUsd: '61.728',
        totalValueUsd: null,
      });
      expect(result.accounts[1]).toMatchObject({
        coverage,
        items: [],
        completeness: 'incomplete',
        missingPriceCount: null,
        pricedSubtotalUsd: null,
        totalValueUsd: null,
      });
    },
  );

  it('distinguishes known empty from all-unavailable while keeping known subtotal zero', () => {
    const empty = { ...covered(), positions: [] } as PortfolioAccount;
    expect(projectManualPortfolioValue([empty], [])).toMatchObject({
      completeness: 'complete',
      totalValueUsd: '0',
      pricedSubtotalUsd: '0',
      unavailableAccountCount: 0,
    });
    expect(
      projectManualPortfolioValue(
        [
          {
            accountId: first,
            name: 'No history',
            coverage: 'missing-journal',
            coverageFrom: null,
            journalRevision: null,
          },
        ],
        [],
      ),
    ).toMatchObject({
      completeness: 'incomplete',
      totalValueUsd: null,
      pricedSubtotalUsd: '0',
      unavailableAccountCount: 1,
    });
  });

  it('retains all sixty fractional places across account summation', () => {
    const atom = '0.000000000000000000000000000001';
    const result = projectManualPortfolioValue(
      [covered(first, atom), covered(second, atom)],
      [price(instrument, atom)],
    );
    expect(result.totalValueUsd).toBe(`0.${'0'.repeat(59)}2`);
    expect(result.accounts.map((row) => row.totalValueUsd)).toEqual(
      Array(2).fill(`0.${'0'.repeat(59)}1`),
    );
  });
});

describe('MPV-PRIVATE strict selection input', () => {
  it('canonicalizes and sorts distinct UUIDs and an explicit offset without mutating input', () => {
    const input = { at: '2025-01-04T03:00:00+03:00', accountIds: [second.toUpperCase(), first] };
    expect(parseManualPortfolioRequest(input, {})).toEqual({ at, accountIds: [first, second] });
    expect(input.accountIds).toEqual([second.toUpperCase(), first]);
  });
  it('accepts exactly ten distinct accounts and null-prototype JSON-like input', () => {
    const accountIds = Array.from(
      { length: 10 },
      (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`,
    );
    expect(
      parseManualPortfolioRequest(
        Object.assign(Object.create(null), { at, accountIds }),
        Object.create(null),
      ),
    ).toEqual({ at, accountIds });
  });
  it.each<unknown>([
    null,
    undefined,
    [],
    new Date(),
    {},
    { at },
    { accountIds: [first] },
    { at, accountIds: [] },
    { at, accountIds: first },
    { at, accountIds: [null] },
    { at, accountIds: [first, first.toUpperCase()] },
    { at, accountIds: ['invalid'] },
    { at, accountIds: new Array(1) },
    { at, accountIds: Array(11).fill(first) },
    { at, accountIds: [first], limit: 1 },
    { at: '2025-02-30T00:00:00Z', accountIds: [first] },
    { at: '2025-01-04', accountIds: [first] },
    Object.create({ at, accountIds: [first] }),
  ])('rejects malformed body %#', (input) => {
    expect(() => parseManualPortfolioRequest(input, {})).toThrow(BadRequestException);
  });
  it.each<unknown>([null, [], { at }, { accountIds: first }, { ownerId: first }, new Date()])(
    'rejects nonempty/invalid query %#',
    (query) => {
      expect(() => parseManualPortfolioRequest({ at, accountIds: [first] }, query)).toThrow(
        BadRequestException,
      );
    },
  );
});
