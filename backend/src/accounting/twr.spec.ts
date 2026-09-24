import { randomUUID } from 'node:crypto';
import { parseProfitPreview } from './period-profit';
import { type FlowVersion, projectFlowPeriod } from './portfolio-flow';
import { projectTwr } from './twr';

const from = '2025-01-01T00:00:00.000Z';
const to = '2026-01-01T00:00:00.000Z';
const middle = '2025-07-01T00:00:00.000Z';
const atom = '0.000000000000000000000000000001';
const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
const input = (openingValueUsd: string, closingValueUsd: string, end = to) =>
  parseProfitPreview({ from, to: end, openingValueUsd, closingValueUsd, assertReviewed: true });
const flow = (
  amountUsd: string,
  occurredAt = from,
  direction: FlowVersion['direction'] = 'contribution',
  kind: FlowVersion['kind'] = 'create',
): FlowVersion => ({
  flowId: randomUUID(),
  requestId: randomUUID(),
  version: 1,
  journalRevision: 1,
  createdAt: from,
  amountUsd,
  occurredAt,
  direction,
  kind,
});
function calculate(opening: string, closing: string, heads: FlowVersion[] = [], end = to) {
  const period = input(opening, closing, end);
  return projectTwr(period, projectFlowPeriod(heads, from, end).items);
}
function available(result: ReturnType<typeof projectTwr>, rate: string, percent: string) {
  expect(result).toMatchObject({
    method: 'endpoint-ratio-UTC-ms',
    rateRoundingBound: '0.0000000000005',
    status: 'available',
    reason: null,
    periodRate: rate,
    periodPercent: percent,
    interiorNetFlowDateCount: 0,
  });
}

describe('TWR-EXACT independent endpoint rational oracles', () => {
  it.each([
    ['1000', '1100', '0.1', '10'],
    ['1000', '1000', '0', '0'],
    ['1000', '500', '-0.5', '-50'],
    ['1000', '0', '-1', '-100'],
    ['3', '4', '0.333333333333', '33.3333333333'],
    ['3', '2', '-0.333333333333', '-33.3333333333'],
    ['2000000000000', '2000000000001', '0.000000000001', '0.0000000001'],
    ['2000000000000', '1999999999999', '-0.000000000001', '-0.0000000001'],
    ['3000000000000', '3000000000001', '0', '0'],
    ['3000000000000', '2999999999999', '0', '0'],
    [atom, '0.000000000000000000000000000002', '1', '100'],
    [maximum, maximum, '0', '0'],
    [maximum, atom, '-1', '-100'],
    // (10^48 - 10^-30) / 10^-30 - 1 = 10^78 - 2.
    [atom, maximum, `${'9'.repeat(77)}8`, `${'9'.repeat(77)}800`],
  ])('%s -> %s has published rate %s', (opening, closing, rate, percent) => {
    available(calculate(opening, closing), rate, percent);
  });

  it('reports period return identically for one millisecond and one year', () => {
    available(calculate('1000', '1100', [], '2025-01-01T00:00:00.001Z'), '0.1', '10');
    available(calculate('1000', '1100'), '0.1', '10');
  });
});

describe('TWR-ENDPOINT complete exact effective flows', () => {
  it('adjusts starting capital, excluding upper boundary and earlier/voided rows', () => {
    const result = calculate('0', '1100', [
      flow('1500'),
      flow('500', from, 'withdrawal'),
      flow('1', to),
      flow('7', '2024-12-31T23:59:59.999Z'),
      flow('999', middle, 'contribution', 'void'),
    ]);
    available(result, '0.1', '10');
    expect(result).toMatchObject({ startingCapitalUsd: '1000', netFlowAtStartUsd: '1000' });
  });

  it('uses an effective correction and exact simultaneous cancellation', () => {
    const result = calculate('1000', '550', [
      flow('500', from, 'withdrawal', 'correct'),
      flow(maximum, middle),
      flow(maximum, middle, 'withdrawal'),
    ]);
    available(result, '0.1', '10');
    expect(result).toMatchObject({ startingCapitalUsd: '500', netFlowAtStartUsd: '-500' });
  });

  it('includes all 1000 eligible heads without truncation at page size', () => {
    const result = calculate(
      '0',
      '1100',
      Array.from({ length: 1000 }, () => flow('1')),
    );
    available(result, '0.1', '10');
    expect(result.startingCapitalUsd).toBe('1000');
  });

  it('retains initial sums wider than input precision', () => {
    const result = calculate(maximum, maximum, [flow(maximum)]);
    available(result, '-0.5', '-50');
    expect(result.startingCapitalUsd).toBe(`1${'9'.repeat(48)}.${'9'.repeat(29)}8`);
  });
});

describe('TWR-GAPS unavailable is never a numeric placeholder', () => {
  it.each([
    [flow(atom, middle)],
    [flow(maximum, middle), flow(maximum, middle, 'withdrawal'), flow(atom, middle)],
    [flow('100', middle), flow('100', '2025-07-01T00:00:00.001Z', 'withdrawal')],
  ])('cannot hide a nonzero intermediate flow %#', (...heads) => {
    const result = calculate('1000', '1100', heads);
    expect(result).toMatchObject({
      status: 'unavailable',
      reason: 'missing-flow-boundary-valuations',
      periodRate: null,
      periodPercent: null,
    });
    expect(result.interiorNetFlowDateCount).toBe(heads.length === 2 ? 2 : 1);
  });

  it.each([
    ['0', '0', []],
    ['0', '100', []],
    ['100', '0', [flow('100', from, 'withdrawal')]],
    ['100', '0', [flow('101', from, 'withdrawal')]],
  ] as const)('refuses nonpositive adjusted initial capital %#', (opening, closing, heads) => {
    expect(calculate(opening, closing, [...heads])).toMatchObject({
      status: 'unavailable',
      reason: 'nonpositive-opening-capital',
      periodRate: null,
      periodPercent: null,
      interiorNetFlowDateCount: 0,
    });
  });

  it('prioritizes missing boundary valuations even if the adjusted start is zero', () => {
    expect(calculate('0', '1100', [flow('1000', middle)])).toMatchObject({
      reason: 'missing-flow-boundary-valuations',
      startingCapitalUsd: '0',
      interiorNetFlowDateCount: 1,
      periodRate: null,
      periodPercent: null,
    });
  });
});
