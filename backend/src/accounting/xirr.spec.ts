import { randomUUID } from 'node:crypto';
import { parseProfitPreview } from './period-profit';
import { type FlowVersion, projectFlowPeriod } from './portfolio-flow';
import { projectXirr } from './xirr';

const from = '2025-01-01T00:00:00.000Z';
const to = '2026-01-01T00:00:00.000Z';
const half = '2025-07-02T12:00:00.000Z';
const atom = '0.000000000000000000000000000001';
const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
const input = (openingValueUsd: string, closingValueUsd: string, start = from, end = to) =>
  parseProfitPreview({
    from: start,
    to: end,
    openingValueUsd,
    closingValueUsd,
    assertReviewed: true,
  });
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

async function available(raw: ReturnType<typeof input>, items: FlowVersion[], rate: number) {
  const value = await projectXirr(raw, items);
  expect(value).toMatchObject({
    status: 'available',
    reason: null,
    convention: 'ACT/365F-UTC-ms',
    rateTolerance: '0.0000000001',
  });
  expect(typeof value.annualRate).toBe('string');
  expect(typeof value.annualPercent).toBe('string');
  // Number is only a test boundary for the approximate RATE, never accounting amounts.
  expect(Math.abs(Number(value.annualRate) - rate)).toBeLessThanOrEqual(1e-10);
  expect(Math.abs(Number(value.annualPercent) - rate * 100)).toBeLessThanOrEqual(1e-8);
  return value;
}

describe('XIRR-YEAR / ORACLES independently known roots', () => {
  it.each([
    ['1000', '1100', 0.1],
    ['1000', '1000', 0],
    ['1000', '500', -0.5],
    ['1', '1001', 1000],
    ['1000', '0.001', -0.999999],
    [atom, '0.000000000000000000000000000002', 1],
    [maximum, maximum, 0],
  ])('annual %s to %s => %s', async (opening, closing, rate) => {
    const result = await available(input(opening, closing), [], rate);
    expect(result.cashFlowDateCount).toBe(2);
    expect(result.shortPeriod).toBe(false);
  });

  it('required external contribution1000 and terminal1100 gives ten percent', async () => {
    const result = await available(input('0', '1100'), [flow('1000')], 0.1);
    expect(result.annualRate).toBe('0.1');
    expect(result.annualPercent).toBe('10');
  });

  it('irregular contributions: -100*y²-100*y+231 with y=1.1 => annual21%', async () => {
    await available(input('100', '231'), [flow('100', half)], 0.21);
  });

  it('early withdrawal: -100*y²+50*y+66 with y=1.1 => annual21%', async () => {
    await available(input('100', '66'), [flow('50', half, 'withdrawal')], 0.21);
  });

  it('uses actual366-day leap-year length, not truncated years', async () => {
    // Independent Python Decimal(precision100): 1.1 ** (365/366) - 1.
    await available(
      input('1000', '1100', '2024-01-01T00:00:00.000Z', from),
      [],
      0.09971358593414124,
    );
  });

  it('retains a1ms interval and never rounds high-precision money to Number', async () => {
    // Independent Python Decimal:1000 * 1.1 ** (1/31536000000), rounded to30 places.
    const result = await available(
      input('1000', '1000.000000003022265975534908878765', from, '2025-01-01T00:00:00.001Z'),
      [],
      0.1,
    );
    expect(result.shortPeriod).toBe(true);
  });

  it('zero terminal is supported when a prior positive withdrawal establishes a root', async () => {
    await available(
      input('1000', '0', from, '2027-01-01T00:00:00.000Z'),
      [flow('1100', to, 'withdrawal')],
      0.1,
    );
  });

  it('short effective investment horizon is disclosed even in a long selected period', async () => {
    const result = await available(input('0', '1210'), [flow('1000', half)], 0.4641);
    expect(result.shortPeriod).toBe(true);
  });
});

describe('XIRR-FLOWS complete exact aggregation', () => {
  it('supports exactly64 dates and yields while solving an independently known geometric series', async () => {
    const start = Date.parse('1970-01-01T00:00:00.000Z');
    const year = 31536000000;
    const items = Array.from({ length: 63 }, (_, i) =>
      flow('1', new Date(start + i * year).toISOString()),
    );
    let ticks = 0;
    const heartbeat = setInterval(() => ticks++, 1);
    try {
      // Independent Python Decimal sum(1.1**i, i=1..63), rounded to30 places.
      const result = await available(
        input(
          '0',
          '4446.915684525902395869512133369842',
          new Date(start).toISOString(),
          new Date(start + 63 * year).toISOString(),
        ),
        items,
        0.1,
      );
      expect(result.cashFlowDateCount).toBe(64);
      expect(ticks).toBeGreaterThan(0);
    } finally {
      clearInterval(heartbeat);
    }
  });

  it('aggregates all1000 maximum amounts with a51-digit sum before solving', async () => {
    const result = await available(
      input('0', maximum),
      Array.from({ length: 1000 }, () => flow(maximum)),
      -0.999,
    );
    expect(result.cashFlowDateCount).toBe(2);
  });

  it('same-instant subtraction preserves a tiny exact remainder and drops only zero buckets', async () => {
    const items = [
      flow('1.000000000000000000000000000001'),
      flow('1', from, 'withdrawal'),
      flow('5', half),
      flow('5', half, 'withdrawal'),
    ];
    const result = await available(input('0', '0.000000000000000000000000000002'), items, 1);
    expect(result.cashFlowDateCount).toBe(2);
  });

  it('reuses effective period heads, corrections, voids and exclusive upper boundary', async () => {
    const { items } = projectFlowPeriod(
      [
        flow('1000', from, 'contribution', 'correct'),
        flow('99', half, 'contribution', 'void'),
        flow('99', to),
        flow('99', '2024-12-31T00:00:00.000Z'),
      ],
      from,
      to,
    );
    await available(input('0', '1100'), items, 0.1);
  });

  it('zero is approximate output for a tiny nonzero root, not an amount truncation', async () => {
    const value = await available(input('1', '1.000000000000000000000000000001'), [], 0);
    expect(value.annualRate).toBe('0');
    expect(value.annualPercent).toBe('0');
  });
});

describe('XIRR-UNAVAILABLE deterministic reasons without invented rates', () => {
  it.each([
    [input('0', '0'), [], 'insufficient-cash-flows'],
    [input('0', '0'), [flow('1')], 'insufficient-cash-flows'],
    [input('1', '0'), [flow('1', half)], 'one-sided-cash-flows'],
    [input('0', '1'), [flow('1', half, 'withdrawal')], 'one-sided-cash-flows'],
    // Classic -100,+230,-132 has two IRRs; conservatively refuse the pattern.
    [
      input('100', '0', from, '2028-01-01T00:00:00.000Z'),
      [flow('230', to, 'withdrawal'), flow('132', '2027-01-01T00:00:00.000Z')],
      'unsupported-pattern',
    ],
    [input('1000', '1100', from, '2025-01-02T00:00:00.000Z'), [], 'outside-supported-range'],
    [input('1', '1001.000000000001'), [], 'outside-supported-range'],
    [input('1', '0.000000999999'), [], 'outside-supported-range'],
  ] as const)('returns reason for case %#', async (raw, items, reason) => {
    const result = await projectXirr(raw, items);
    expect(result).toMatchObject({
      status: 'unavailable',
      reason,
      annualRate: null,
      annualPercent: null,
    });
  });

  it('65 distinct nonzero instants are refused, never truncated', async () => {
    const items = Array.from({ length: 64 }, (_, index) =>
      flow('1', new Date(Date.parse(from) + index * 86400000).toISOString()),
    );
    const result = await projectXirr(input('0', '64'), items);
    expect(result).toMatchObject({
      status: 'unavailable',
      reason: 'too-many-cash-flow-dates',
      cashFlowDateCount: 65,
    });
  });
});
