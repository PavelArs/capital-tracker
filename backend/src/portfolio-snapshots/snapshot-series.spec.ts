import {
  DAY_MS,
  HISTORY_FROM_MS,
  HOUR_MS,
  latestAtOrBefore,
  manualSeries,
  marketSeries,
  periodChange,
  periodPoints,
  periodStart,
  periodStartPoint,
  rateDateStart,
  seriesInstants,
  snapshotChanges,
} from './snapshot-series';

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

describe('portfolio snapshot series (record-portfolio-snapshots)', () => {
  it('SNAP-BACKFILL holds one daily point per UTC day since 01.01.2025 (Q4)', () => {
    const now = at('2025-01-04T10:20:00.000Z');
    const instants = seriesInstants(now, at('2025-01-04T10:00:00.000Z'));
    expect(instants.map(iso)).toEqual([
      '2025-01-01T00:00:00.000Z',
      '2025-01-02T00:00:00.000Z',
      '2025-01-03T00:00:00.000Z',
      '2025-01-04T00:00:00.000Z',
      '2025-01-04T10:00:00.000Z',
    ]);
    expect(instants[0]).toBe(HISTORY_FROM_MS);
  });

  it('SNAP-HOURLY adds one point per passed hour from the first run, within the last 8 days', () => {
    const hourlyFrom = at('2026-10-01T21:00:00.000Z');
    const first = seriesInstants(at('2026-10-01T21:59:59.999Z'), hourlyFrom);
    const again = seriesInstants(at('2026-10-01T21:30:00.000Z'), hourlyFrom);
    expect(first).toEqual(again);
    const next = seriesInstants(at('2026-10-01T22:00:00.000Z'), hourlyFrom);
    expect(next.length).toBe(first.length + 1);
    expect(iso(next.at(-1)!)).toBe('2026-10-01T22:00:00.000Z');
    // Hours before the first run are not invented; midnights are daily points anyway.
    expect(next.filter((ms) => ms % DAY_MS !== 0).map(iso)).toEqual([
      '2026-10-01T21:00:00.000Z',
      '2026-10-01T22:00:00.000Z',
    ]);
    const later = seriesInstants(at('2026-10-20T05:10:00.000Z'), hourlyFrom);
    const hourly = later.filter((ms) => ms % DAY_MS !== 0);
    expect(iso(hourly[0])).toBe('2026-10-12T06:00:00.000Z');
    expect(iso(hourly.at(-1)!)).toBe('2026-10-20T05:00:00.000Z');
    expect(hourly.length + 8).toBe(8 * 24);
  });

  it('CHART-PERIODS keep hourly points for 24H and 7D and daily points for longer periods', () => {
    const now = at('2026-10-20T05:10:00.000Z');
    const rows = seriesInstants(now, at('2026-10-01T00:00:00.000Z')).map((ms) => ({ at: ms }));
    const span = (period: Parameters<typeof periodPoints>[1]) => {
      const points = periodPoints(rows, period, now);
      return [points.length, iso(points[0].at)];
    };
    expect(span('24H')).toEqual([24, '2026-10-19T06:00:00.000Z']);
    expect(span('7D')).toEqual([7 * 24, '2026-10-13T06:00:00.000Z']);
    expect(span('1M')).toEqual([30, '2026-09-21T00:00:00.000Z']);
    expect(span('3M')).toEqual([91, '2026-07-22T00:00:00.000Z']);
    expect(span('1Y')).toEqual([365, '2025-10-21T00:00:00.000Z']);
    expect(span('ALL')).toEqual([658, '2025-01-01T00:00:00.000Z']);
    expect(periodStart('ALL', now)).toEqual({ from: HISTORY_FROM_MS, hourly: false });
    expect(periodStart('24H', now)).toEqual({ from: now - DAY_MS, hourly: true });
  });

  it('uses the latest stored market price at or before the instant, preferring spot, hourly, daily', () => {
    const series = marketSeries([
      {
        asset: 'BTC',
        observedAt: at('2025-01-02T00:00:00Z'),
        price: '100',
        source: 'kraken',
        kind: 'daily-close',
      },
      {
        asset: 'BTC',
        observedAt: at('2025-01-02T00:00:00Z'),
        price: '101',
        source: 'kraken',
        kind: 'hourly-close',
      },
      {
        asset: 'BTC',
        observedAt: at('2025-01-02T00:00:00Z'),
        price: '102',
        source: 'kraken',
        kind: 'spot',
      },
      {
        asset: 'BTC',
        observedAt: at('2025-01-02T00:00:00Z'),
        price: '103',
        source: 'coingecko',
        kind: 'spot',
      },
      {
        asset: 'BTC',
        observedAt: at('2025-01-03T00:00:00Z'),
        price: '110',
        source: 'kraken',
        kind: 'daily-close',
      },
    ]).get('BTC')!;
    expect(series.map((point) => point.price)).toEqual(['103', '110']);
    expect(latestAtOrBefore(series, at('2025-01-01T23:59:59Z'))).toBeUndefined();
    expect(latestAtOrBefore(series, at('2025-01-02T00:00:00Z'))?.price).toBe('103');
    expect(latestAtOrBefore(series, at('2025-01-02T23:00:00Z'))?.price).toBe('103');
    expect(latestAtOrBefore(series, at('2026-01-01T00:00:00Z'))?.price).toBe('110');
  });

  it('uses the current version of each manual point and skips voided ones', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const point = (
      observedAt: string,
      revision: number,
      kind: 'set' | 'void',
      priceUsd: string | null,
    ) => ({
      instrumentId: id,
      observedAt: at(observedAt),
      revision,
      kind,
      priceUsd,
    });
    const series = manualSeries([
      point('2025-01-05T00:00:00Z', 1, 'set', '2300'),
      point('2025-01-06T00:00:00Z', 2, 'set', '9999'),
      point('2025-01-06T00:00:00Z', 3, 'void', null),
      point('2025-01-07T00:00:00Z', 4, 'set', '1'),
      point('2025-01-07T00:00:00Z', 5, 'set', '2'),
    ]).get(id)!;
    expect(series.map((entry) => [iso(entry.at), entry.price])).toEqual([
      ['2025-01-05T00:00:00.000Z', '2300'],
      ['2025-01-07T00:00:00.000Z', '2'],
    ]);
    expect(latestAtOrBefore(series, at('2025-01-06T12:00:00Z'))?.price).toBe('2300');
  });

  it('starts a Bank of Russia rate at Moscow midnight of its date', () => {
    expect(iso(rateDateStart('2025-06-14'))).toBe('2025-06-13T21:00:00.000Z');
  });

  it('SNAP-REBUILD rewrites only points whose value changed', () => {
    const existing = new Map([
      [`${at('2025-01-01T00:00:00Z')}:USD`, { value: '0', complete: true }],
      [`${at('2025-01-02T00:00:00Z')}:USD`, { value: '100.50', complete: true }],
      [`${at('2025-01-03T00:00:00Z')}:USD`, { value: '120', complete: true }],
    ]);
    const changes = snapshotChanges(existing, [
      { at: at('2025-01-01T00:00:00Z'), currency: 'USD', value: '0', complete: true },
      { at: at('2025-01-02T00:00:00Z'), currency: 'USD', value: '100.5', complete: true },
      { at: at('2025-01-03T00:00:00Z'), currency: 'USD', value: '150', complete: true },
      { at: at('2025-01-04T00:00:00Z'), currency: 'USD', value: '150', complete: false },
      { at: at('2025-01-04T00:00:00Z'), currency: 'EUR', value: null, complete: false },
    ]);
    expect(changes.map((row) => [iso(row.at), row.currency, row.value])).toEqual([
      ['2025-01-03T00:00:00.000Z', 'USD', '150'],
      ['2025-01-04T00:00:00.000Z', 'USD', '150'],
      ['2025-01-04T00:00:00.000Z', 'EUR', null],
    ]);
  });

  it('CHART-PERIODS states the change for the period in amount and percent', () => {
    expect(periodChange('100000', '115000')).toEqual({ change: '15000', changePercent: '15.00' });
    expect(periodChange('3', '2')).toEqual({ change: '-1', changePercent: '-33.33' });
    // Nothing held at the start: an amount but no percentage.
    expect(periodChange('0', '1500.25')).toEqual({ change: '1500.25', changePercent: null });
    expect(periodChange(null, '10')).toEqual({ change: null, changePercent: null });
    expect(periodChange('10', null)).toEqual({ change: null, changePercent: null });
  });

  it('keeps hour arithmetic exact', () => {
    expect(HOUR_MS * 24).toBe(DAY_MS);
  });
  it('HIST-START-UNPRICED a start point that left out a held asset gives no period change', () => {
    // Stored snapshots only carry `complete`: false when a held asset had no price then.
    const series = [
      { at: 1, value: null, complete: true },
      { at: 2, value: '5000', complete: false },
      { at: 3, value: '105000', complete: true },
    ];
    const start = periodStartPoint(series);
    expect(start).toEqual({ at: 2, value: '5000', complete: false, unpriced: true });
    expect(periodChange(start?.unpriced ? null : (start?.value ?? null), '105000')).toEqual({
      change: null,
      changePercent: null,
    });
    // A complete start keeps its change.
    const whole = periodStartPoint([{ at: 2, value: '5000', complete: true }]);
    expect(whole?.unpriced).toBe(false);
    expect(periodStartPoint([{ at: 1, value: null, complete: true }])).toBeNull();
    // A point already marked by the live valuation keeps its mark even when complete.
    expect(
      periodStartPoint([{ at: 1, value: '1', complete: true, unpriced: true }])?.unpriced,
    ).toBe(true);
  });
});
