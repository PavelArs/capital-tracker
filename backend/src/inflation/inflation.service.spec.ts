import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { InflationService } from './inflation.service';
import type { InflationClient } from './inflation-sources';

// INFL-OVERVIEW characterization: what the settings overview reads, in order, and returns, with
// each query answered by a stub. Synthetic months and rates only.
const owner = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-10-20T12:00:00.000Z');

const monthsFrom = (from: string, count: number, percent: string) => {
  const rows: { month: string; changePercent: string }[] = [];
  let [year, month] = from.split('-').map(Number);
  for (let index = 0; index < count; index++) {
    rows.push({ month: `${year}-${String(month).padStart(2, '0')}`, changePercent: percent });
    if (++month > 12) {
      month = 1;
      year++;
    }
  }
  return rows;
};

interface Call {
  sql: string;
  parameters: unknown[];
}

async function overview(world: {
  official: Record<string, { month: string; changePercent: string }[]>;
  manual: Record<string, { month: string; changePercent: string }[]>;
  personal: Record<string, string>;
  sync: boolean;
}) {
  const calls: Call[] = [];
  const manager = {
    query: async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters });
      if (sql.includes('FROM inflation_months'))
        return world.official[parameters[0] as string] ?? [];
      if (sql.includes('FROM inflation_manual_months'))
        return world.manual[parameters[1] as string] ?? [];
      if (sql.includes('FROM inflation_personal_rates')) {
        const rate = world.personal[parameters[1] as string];
        return rate === undefined ? [] : [{ annualPercent: rate }];
      }
      if (sql.includes('FROM sync_sources'))
        return world.sync
          ? [
              {
                state: 'delayed',
                lastAttemptAt: new Date('2026-10-20T10:00:00.000Z'),
                lastSuccessAt: new Date('2026-10-19T10:00:00.000Z'),
                nextRunAt: new Date('2026-10-20T11:00:00.000Z'),
                errorCode: 'unavailable',
                errorMessage: 'Inflation data did not answer for USD',
              },
            ]
          : [];
      return [];
    },
  };
  const source = {
    transaction: async (_level: string, work: (m: unknown) => unknown) => work(manager),
  };
  const service = new InflationService(
    source as unknown as DataSource,
    {} as ConfigService,
    {} as InflationClient,
  );
  const result = await service.overview(owner, now);
  return { calls, result };
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('INFL-OVERVIEW characterization of the settings overview', () => {
  it('INFL-OVERVIEW reads each currency in turn, then the collector state', async () => {
    const { calls, result } = await overview({
      official: {
        USD: monthsFrom('2025-01', 20, '0.300'),
        EUR: monthsFrom('2026-01', 6, '0.200'),
      },
      manual: {
        USD: [{ month: '2026-09', changePercent: '0.500' }],
        RUB: [
          { month: '2026-08', changePercent: '0.700' },
          { month: '2026-09', changePercent: '1.250' },
        ],
      },
      personal: { EUR: '7.500', RUB: '12' },
      sync: true,
    });
    expect(
      calls.map((call) => [/FROM (\w+)/.exec(call.sql)?.[1] ?? call.sql, call.parameters]),
    ).toEqual([
      ['SET TRANSACTION READ ONLY', []],
      ['inflation_months', ['USD']],
      ['inflation_manual_months', [owner, 'USD']],
      ['inflation_personal_rates', [owner, 'USD']],
      ['inflation_months', ['EUR']],
      ['inflation_manual_months', [owner, 'EUR']],
      ['inflation_personal_rates', [owner, 'EUR']],
      ['inflation_months', ['RUB']],
      ['inflation_manual_months', [owner, 'RUB']],
      ['inflation_personal_rates', [owner, 'RUB']],
      ['sync_sources', ['fx:inflation']],
    ]);
    expect(result.currencies.map((row) => row.currency)).toEqual(['USD', 'EUR', 'RUB']);
    expect(result.currencies[0]).toMatchObject({
      officialSource: expect.any(String),
      officialLastMonth: '2026-08',
      lastMonth: '2026-09',
      personalRatePercent: null,
      manualMonths: [{ month: '2026-09', changePercent: '0.5' }],
    });
    expect(result.currencies[1]).toMatchObject({
      officialLastMonth: '2026-06',
      trailingYearPercent: null,
      officialTrailingYearPercent: null,
      personalRatePercent: '7.5',
      manualMonths: [],
    });
    expect(result.currencies[2]).toMatchObject({
      officialLastMonth: null,
      personalRatePercent: '12',
    });
    expect(result.sync).toEqual({
      key: 'fx:inflation',
      state: 'delayed',
      lastAttemptAt: '2026-10-20T10:00:00.000Z',
      lastSuccessAt: '2026-10-19T10:00:00.000Z',
      nextRunAt: '2026-10-20T11:00:00.000Z',
      errorCode: 'unavailable',
      errorMessage: 'Inflation data did not answer for USD',
    });
    expect(digest(result)).toBe('9a09bfb8ceebe1d76fee2e74ca3ef3ee8a8d240f8e43d9d788a829e67c83968e');
  });

  it('INFL-OVERVIEW without any month or collector state every figure is missing', async () => {
    const { result } = await overview({ official: {}, manual: {}, personal: {}, sync: false });
    expect(result.sync).toBeNull();
    for (const row of result.currencies)
      expect(row).toMatchObject({
        officialLastMonth: null,
        lastMonth: null,
        comparableFrom: null,
        trailingYearPercent: null,
        trailingYearEstimated: null,
        officialTrailingYearPercent: null,
        estimatedMonthlyPercent: null,
        personalRatePercent: null,
        manualMonths: [],
      });
    expect(digest(result)).toBe('66c5154a8e3efa45bfa112abd0911f521c7c23983ed02e78b41c5936575d19cd');
  });
});
