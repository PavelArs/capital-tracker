import { type FlowVersion, projectFlowPeriod } from './portfolio-flow';

const from = '2025-01-01T00:00:00.000Z';
const to = '2025-02-01T00:00:00.000Z';
const atom = '0.000000000000000000000000000001';
function flow(index: number, overrides: Partial<FlowVersion> = {}): FlowVersion {
  return {
    flowId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
    version: 1,
    journalRevision: index,
    requestId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, '0')}`,
    kind: 'create',
    direction: 'contribution',
    occurredAt: from,
    amountUsd: '10',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('FLOW-001/003 exact complete-period projection', () => {
  it('uses [from,to), whole-period totals and UTC/UUID identity', () => {
    const heads = [
      flow(3, { amountUsd: '30', occurredAt: to }),
      flow(4, { direction: 'withdrawal', amountUsd: '5', occurredAt: '2025-01-02T00:00:00.000Z' }),
      flow(2, { amountUsd: '20', occurredAt: '2025-01-02T00:00:00.000Z' }),
      flow(1),
      flow(5, { amountUsd: '999', occurredAt: '2024-12-31T23:59:59.999Z' }),
    ];
    const before = JSON.stringify(heads);
    expect(projectFlowPeriod(heads, from, to)).toEqual({
      summary: {
        contributionsUsd: '30',
        withdrawalsUsd: '5',
        netContributionsUsd: '25',
        flowCount: 3,
      },
      items: [heads[3], heads[2], heads[1]],
    });
    expect(JSON.stringify(heads)).toBe(before);
  });

  it('does not merge distinct legitimate equal-value/equal-time contributions', () => {
    const heads = [flow(2), flow(1)];
    expect(projectFlowPeriod(heads, from, to)).toEqual({
      summary: {
        contributionsUsd: '20',
        withdrawalsUsd: '0',
        netContributionsUsd: '20',
        flowCount: 2,
      },
      items: [heads[1], heads[0]],
    });
  });

  it('restates corrected execution times and excludes terminal voids without rewriting inputs', () => {
    const corrected = flow(1, { version: 2, kind: 'correct', amountUsd: '20', occurredAt: to });
    const voided = flow(2, { version: 2, kind: 'void', direction: 'withdrawal', amountUsd: '5' });
    expect(projectFlowPeriod([corrected, voided], from, to)).toEqual({
      summary: {
        contributionsUsd: '0',
        withdrawalsUsd: '0',
        netContributionsUsd: '0',
        flowCount: 0,
      },
      items: [],
    });
    expect(
      projectFlowPeriod([corrected], to, '2025-03-01T00:00:00.000Z').summary.contributionsUsd,
    ).toBe('20');
  });

  it('keeps one atom and signed recorded net without inventing a cash balance or profit', () => {
    const result = projectFlowPeriod(
      [
        flow(1, { amountUsd: '1000' }),
        flow(2, { amountUsd: atom }),
        flow(3, { direction: 'withdrawal', amountUsd: '250' }),
      ],
      from,
      to,
    );
    expect(result.summary).toEqual({
      contributionsUsd: `1000.${'0'.repeat(29)}1`,
      withdrawalsUsd: '250',
      netContributionsUsd: `750.${'0'.repeat(29)}1`,
      flowCount: 3,
    });
    expect(
      projectFlowPeriod([flow(1, { direction: 'withdrawal', amountUsd: atom })], from, to).summary,
    ).toEqual({
      contributionsUsd: '0',
      withdrawalsUsd: atom,
      netContributionsUsd: `-${atom}`,
      flowCount: 1,
    });
    expect(Object.keys(result).sort()).toEqual(['items', 'summary']);
  });

  it('calculates all1000 maximum-precision records before any page is chosen', () => {
    const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
    const result = projectFlowPeriod(
      Array.from({ length: 1000 }, (_, index) => flow(index + 1, { amountUsd: maximum })),
      from,
      to,
    );
    const total = `${'9'.repeat(51)}.${'9'.repeat(27)}`;
    expect(result.summary).toEqual({
      contributionsUsd: total,
      withdrawalsUsd: '0',
      netContributionsUsd: total,
      flowCount: 1000,
    });
    expect(result.items).toHaveLength(1000);
  });
});
