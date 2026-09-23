import { BadRequestException } from '@nestjs/common';
import { parseProfitPreview, projectPeriodProfit } from './period-profit';
import { type FlowVersion, projectFlowPeriod } from './portfolio-flow';

const from = '2025-01-01T00:00:00.000Z';
const to = '2026-01-01T00:00:00.000Z';
const input = { from, to, openingValueUsd: '1000', closingValueUsd: '2000', assertReviewed: true };
const atom = '0.000000000000000000000000000001';
const totals = (contributionsUsd = '0', withdrawalsUsd = '0') => ({
  contributionsUsd,
  withdrawalsUsd,
  netContributionsUsd: '0',
  flowCount: 0,
});

describe('PROFIT-CAPITAL / EXACT exact period profit', () => {
  it.each([
    ['1000', '2000', '1000', '0', '0'],
    ['1000', '1100', '0', '0', '100'],
    ['1000', '800', '0', '100', '-100'],
    ['0', '0', '0', '0', '0'],
    ['0', '0', atom, '0', `-${atom}`],
    [atom, '0', '0', atom, '0'],
    ['0.1', '0.3', '0.2', '0', '0'],
    ['0', '0', '0', '2000', '2000'],
    [
      '0',
      '0',
      '999999999999999999999999999999999999999999999999999.999999999999999999999999999',
      '0',
      '-999999999999999999999999999999999999999999999999999.999999999999999999999999999',
    ],
  ])(
    'opening %s closing %s contributions %s withdrawals %s => %s',
    (opening, closing, add, take, profit) => {
      expect(projectPeriodProfit(opening, closing, totals(add, take))).toBe(profit);
    },
  );

  it('PROFIT-PERIOD preserves existing effective [from,to) projection before exact profit', () => {
    const head = (
      occurredAt: string,
      amountUsd: string,
      kind: FlowVersion['kind'] = 'create',
    ): FlowVersion => ({
      flowId: 'e3075843-3037-48e9-8240-92c4497fc70b',
      version: 1,
      journalRevision: 1,
      requestId: 'c00183e6-9c17-47a6-b1ab-3cb89d7705f4',
      kind,
      direction: 'contribution',
      occurredAt,
      amountUsd,
      createdAt: from,
    });
    const { summary } = projectFlowPeriod(
      [
        head('2024-12-31T23:59:59.999Z', '7'),
        head(from, '1000', 'correct'),
        head('2025-06-01T00:00:00.000Z', '50', 'void'),
        head(to, '99'),
      ],
      from,
      to,
    );
    expect(summary).toEqual({
      contributionsUsd: '1000',
      withdrawalsUsd: '0',
      netContributionsUsd: '1000',
      flowCount: 1,
    });
    expect(projectPeriodProfit('1000', '2000', summary)).toBe('0');
  });
});

describe('PROFIT-INPUT manual preview boundary', () => {
  it('canonicalizes zones and zeros, including a zero valuation', () => {
    expect(
      parseProfitPreview({
        ...input,
        from: '2025-01-01T02:00:00+02:00',
        openingValueUsd: '000.000',
        closingValueUsd: '002000.0100',
      }),
    ).toEqual({ ...input, openingValueUsd: '0', closingValueUsd: '2000.01' });
  });

  it.each([
    null,
    [],
    'input',
    0,
    Object.create({ ...input }),
    { ...input, ownerId: '00000000-0000-4000-8000-000000000000' },
    { ...input, assertReviewed: false },
    { ...input, assertReviewed: 'true' },
    { ...input, assertReviewed: undefined },
    { ...input, from: to },
    { ...input, to: from },
    { ...input, to: '2024-01-01T00:00:00Z' },
    { ...input, from: '2025-01-01' },
    { ...input, from: '2025-02-30T00:00:00Z' },
    { ...input, to: '2026-01-01T00:00:00' },
    { ...input, from: '1969-12-31T23:59:59Z' },
    { ...input, openingValueUsd: undefined },
    ...[
      '-1',
      '-0',
      '+1',
      '1e3',
      ' 1',
      '1,2',
      '.1',
      'NaN',
      'Infinity',
      '9'.repeat(49),
      `0.${'1'.repeat(31)}`,
      1,
      null,
    ].flatMap((value) => [
      { ...input, openingValueUsd: value },
      { ...input, closingValueUsd: value },
    ]),
  ])('rejects invalid preview %#', (raw) => {
    expect(() => parseProfitPreview(raw)).toThrow(BadRequestException);
  });
});
