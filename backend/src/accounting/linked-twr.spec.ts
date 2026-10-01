import { randomUUID } from 'node:crypto';
import { projectLinkedTwr, projectTwrBoundaries } from './linked-twr';
import { parseLinkedTwrPreview, parseTwrBoundaryQuery } from './linked-twr-input';
import { type FlowVersion, projectFlowPeriod } from './portfolio-flow';

const from = '2025-01-01T00:00:00.000Z';
const a = '2025-01-02T00:00:00.000Z';
const b = '2025-01-03T00:00:00.000Z';
const to = '2025-02-01T00:00:00.000Z';
const base = {
  from,
  to,
  openingValueUsd: '1000',
  closingValueUsd: '2310',
  assertReviewed: true,
  expectedJournalRevision: 1,
  boundaryValuations: [{ at: a, valueBeforeUsd: '1100' }],
};
const flow = (
  amountUsd: string,
  occurredAt = a,
  direction: FlowVersion['direction'] = 'contribution',
  kind: FlowVersion['kind'] = 'create',
): FlowVersion => ({
  flowId: randomUUID(),
  requestId: randomUUID(),
  version: 1,
  journalRevision: 1,
  createdAt: from,
  occurredAt,
  direction,
  kind,
  amountUsd,
});
const period = (heads: FlowVersion[]) => projectFlowPeriod(heads, from, to).items;
const calculate = (heads = [flow('1000')], changes: Record<string, unknown> = {}) =>
  projectLinkedTwr(parseLinkedTwrPreview({ ...base, ...changes }), period(heads));
const unavailable = (value: ReturnType<typeof calculate>, reason: string) => {
  expect(value).toMatchObject({
    status: 'unavailable',
    reason,
    periodRate: null,
    periodPercent: null,
  });
};
const available = (value: ReturnType<typeof calculate>, rate: string, percent: string) => {
  expect(value).toMatchObject({
    status: 'available',
    reason: null,
    method: 'geometrically-linked-UTC-ms',
    boundaryLimit: 32,
    rateRoundingBound: '0.0000000000005',
    periodRate: rate,
    periodPercent: percent,
  });
};

describe('LTWR-INPUT strict reviewed DTO', () => {
  it('normalizes equivalent UTC instants and precise decimals', () => {
    const parsed = parseLinkedTwrPreview({
      ...base,
      boundaryValuations: [{ at: '2025-01-02T01:00:00+01:00', valueBeforeUsd: '0001100.000' }],
    });
    expect(parsed.boundaryValuations).toEqual(base.boundaryValuations);
    expect(parseTwrBoundaryQuery({ from, to })).toEqual({ from, to });
  });
  it.each([
    null,
    [],
    {},
    { ...base, ownerId: randomUUID() },
    { ...base, assertReviewed: false },
    { ...base, expectedJournalRevision: '1' },
    { ...base, expectedJournalRevision: -1 },
    { ...base, expectedJournalRevision: 1.5 },
    { ...base, expectedJournalRevision: 10001 },
    { ...base, boundaryValuations: null },
    { ...base, boundaryValuations: {} },
    { ...base, boundaryValuations: Array.from({ length: 33 }, () => base.boundaryValuations[0]) },
    { ...base, boundaryValuations: [{ at: a, valueBeforeUsd: 1100 }] },
    { ...base, boundaryValuations: [{ at: a, valueBeforeUsd: '-1' }] },
    { ...base, boundaryValuations: [{ at: a, valueBeforeUsd: '1e3' }] },
    { ...base, boundaryValuations: [{ at: a, valueBeforeUsd: '1', extra: true }] },
    { ...base, boundaryValuations: [{ at: from, valueBeforeUsd: '1' }] },
    { ...base, boundaryValuations: [{ at: to, valueBeforeUsd: '1' }] },
    { ...base, boundaryValuations: [{ at: '2025-01-02', valueBeforeUsd: '1' }] },
    {
      ...base,
      boundaryValuations: [
        { at: a, valueBeforeUsd: '1' },
        { at: '2025-01-02T01:00:00+01:00', valueBeforeUsd: '2' },
      ],
    },
  ])('rejects malformed preview %#', (value) => {
    expect(() => parseLinkedTwrPreview(value)).toThrow('Invalid accounting input');
  });
  it.each([
    {},
    [],
    null,
    { from, to: from },
    { from, to, ownerId: randomUUID() },
    { from, to, expectedJournalRevision: 1 },
    { from: 'invalid', to },
  ])('rejects invalid plan %#', (value) => {
    expect(() => parseTwrBoundaryQuery(value)).toThrow('Invalid accounting input');
  });
});

describe('LTWR-PLAN exact complete net boundaries', () => {
  it('sorts nonzero interior instants, cancels exact ties and retains start net', () => {
    const heads = [
      flow('100', b, 'withdrawal'),
      flow('1000', from),
      flow('7', to),
      flow('5', a),
      flow('5', a, 'withdrawal'),
      flow('1', a, 'contribution', 'void'),
    ];
    expect(projectTwrBoundaries({ from, to }, period(heads))).toEqual({
      boundaryLimit: 32,
      netFlowAtStartUsd: '1000',
      interiorNetFlowDateCount: 1,
      status: 'ready',
      reason: null,
      boundaries: [{ at: b, netFlowUsd: '-100' }],
    });
  });
  it('includes all1000 heads and retains one atom after cancellation', () => {
    const heads = Array.from({ length: 999 }, (_, index) =>
      flow('1', a, index % 2 ? 'withdrawal' : 'contribution'),
    );
    heads.push(flow('0.999999999999999999999999999999', a, 'withdrawal'));
    const plan = projectTwrBoundaries({ from, to }, period(heads));
    expect(plan.boundaries).toEqual([{ at: a, netFlowUsd: '0.000000000000000000000000000001' }]);
  });
  it('does not cancel equal opposite flows separated by1ms', () => {
    const plan = projectTwrBoundaries(
      { from, to },
      period([flow('1', a), flow('1', '2025-01-02T00:00:00.001Z', 'withdrawal')]),
    );
    expect(plan.interiorNetFlowDateCount).toBe(2);
  });
  it('refuses33 boundaries without returning a truncated plan', () => {
    const heads = Array.from({ length: 33 }, (_, index) =>
      flow('1', new Date(Date.parse(a) + index).toISOString()),
    );
    expect(projectTwrBoundaries({ from, to }, period(heads))).toMatchObject({
      status: 'unavailable',
      reason: 'too-many-boundaries',
      interiorNetFlowDateCount: 33,
      boundaries: [],
    });
    unavailable(calculate(heads, { boundaryValuations: [] }), 'too-many-boundaries');
  });
});

describe('LTWR-LINK / PRECISION independent geometric oracles', () => {
  it('links1100/1000 and2310/2100 to21percent', () => {
    const value = calculate();
    available(value, '0.21', '21');
    expect(value.boundaries).toEqual([
      { at: a, netFlowUsd: '1000', valueBeforeUsd: '1100', valueAfterUsd: '2100' },
    ]);
  });
  it('links contribution and withdrawal factors1.1*1.2*1.1', () => {
    available(
      calculate([flow('1000'), flow('520', b, 'withdrawal')], {
        closingValueUsd: '2200',
        boundaryValuations: [...base.boundaryValuations, { at: b, valueBeforeUsd: '2520' }],
      }),
      '0.452',
      '45.2',
    );
  });
  it('cancels exact rational2/3*3/2 without rounding subperiods', () => {
    available(
      calculate([flow('2')], {
        openingValueUsd: '3',
        closingValueUsd: '6',
        boundaryValuations: [{ at: a, valueBeforeUsd: '2' }],
      }),
      '0',
      '0',
    );
  });
  it.each([
    ['4.000000000002', '0.000000000001', '0.0000000001'],
    ['3.999999999998', '-0.000000000001', '-0.0000000001'],
    ['4.000000000001', '0', '0'],
    ['3.999999999999', '0', '0'],
    ['0', '-1', '-100'],
  ])('rounds only final signed return for terminal%s', (closing, rate, percent) => {
    available(
      calculate([flow('1')], {
        openingValueUsd: '3',
        closingValueUsd: closing,
        boundaryValuations: [{ at: a, valueBeforeUsd: '3' }],
      }),
      rate,
      percent,
    );
  });
  it('permits zero preflow numerator with positive new capital', () => {
    available(
      calculate([flow('1')], {
        boundaryValuations: [{ at: a, valueBeforeUsd: '0' }],
        closingValueUsd: '2',
      }),
      '-1',
      '-100',
    );
  });
  it('supports32 boundaries and33 exact doubling factors', () => {
    const heads = Array.from({ length: 32 }, (_, index) =>
      flow('100', new Date(Date.parse(a) + index).toISOString(), 'withdrawal'),
    );
    available(
      calculate(heads, {
        openingValueUsd: '100',
        closingValueUsd: '200',
        boundaryValuations: heads.map((head) => ({ at: head.occurredAt, valueBeforeUsd: '200' })),
      }),
      '8589934591',
      '858993459100',
    );
  });
  it('keeps high-precision money and derived factors wider than inputs', () => {
    const atom = '0.000000000000000000000000000001';
    available(
      calculate([flow(atom)], {
        openingValueUsd: atom,
        closingValueUsd: '0.000000000000000000000000000006',
        boundaryValuations: [{ at: a, valueBeforeUsd: '0.000000000000000000000000000002' }],
      }),
      '3',
      '300',
    );
    available(
      calculate([flow('1000', from)], {
        openingValueUsd: '0',
        closingValueUsd: '1100',
        boundaryValuations: [],
      }),
      '0.1',
      '10',
    );
  });
});

describe('LTWR-GAPS missing values are distinct from invalid data', () => {
  it('returns null boundary diagnostics for missing values', () => {
    const value = calculate(undefined, { boundaryValuations: [] });
    unavailable(value, 'missing-flow-boundary-valuations');
    expect(value.boundaries).toEqual([
      { at: a, netFlowUsd: '1000', valueBeforeUsd: null, valueAfterUsd: null },
    ]);
  });
  it('rejects extraneous boundary within period including an exactly cancelled instant', () => {
    expect(() =>
      calculate([flow('1', b), flow('1', b, 'withdrawal')], {
        boundaryValuations: [{ at: b, valueBeforeUsd: '100' }],
      }),
    ).toThrow('Invalid accounting input');
  });
  it('rejects nonpositive initial capital', () => {
    unavailable(
      calculate([], { openingValueUsd: '0', boundaryValuations: [] }),
      'nonpositive-opening-capital',
    );
    unavailable(
      calculate([flow('1001', from, 'withdrawal')], { boundaryValuations: [] }),
      'nonpositive-opening-capital',
    );
  });
  it.each(['1000', '1001'])('rejects after-flow capital for withdrawal%s', (amount) => {
    const value = calculate([flow(amount, a, 'withdrawal')], {
      boundaryValuations: [{ at: a, valueBeforeUsd: '1000' }],
    });
    unavailable(value, 'nonpositive-subperiod-capital');
  });
  it('validates later denominators even after a zero earlier factor', () => {
    unavailable(
      calculate([flow('100'), flow('100', b, 'withdrawal')], {
        boundaryValuations: [
          { at: a, valueBeforeUsd: '0' },
          { at: b, valueBeforeUsd: '100' },
        ],
      }),
      'nonpositive-subperiod-capital',
    );
  });
});
