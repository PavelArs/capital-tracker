import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { readEffectiveChanges } from './inflation.service';
import {
  parseFactorQuery,
  parseMonthlyChange,
  parsePersonalRate,
  parseTypedMonth,
} from './inflation-input';
import {
  buildSeries,
  formatFactor,
  levelOn,
  officialFactor,
  personalFactor,
  trailingYearEstimated,
  trailingYearPercent,
} from './inflation-math';
import {
  InflationClient,
  levelsToChanges,
  parseCbrInflation,
  parseEurostatHicp,
  parseOecdCpiLevels,
  yearOverYearToChanges,
} from './inflation-sources';

const months = (from: string, percents: number[]) => {
  const changes = new Map<string, number>();
  let [year, month] = from.split('-').map(Number);
  for (const percent of percents) {
    changes.set(`${year}-${String(month).padStart(2, '0')}`, percent);
    if (++month > 12) {
      month = 1;
      year++;
    }
  }
  return changes;
};

describe('INFL-INDEX the level of prices', () => {
  // 2025-01 +1%, 2025-02 +2%, 2025-03 +0%: the chain starts from December 2024 at 1.
  const series = buildSeries(months('2025-01', [1, 2, 0]));

  it('chains monthly changes from the month before the first one', () => {
    expect(series.chainStart).toBe('2024-12');
    expect(series.last).toBe('2025-03');
    expect(series.levels.get('2024-12')).toBe(1);
    expect(series.levels.get('2025-01')).toBeCloseTo(1.01, 12);
    expect(series.levels.get('2025-02')).toBeCloseTo(1.0302, 12);
    expect(series.levels.get('2025-03')).toBeCloseTo(1.0302, 12);
  });

  it('is exact on a month anchor and linear between two anchors', () => {
    const jan = levelOn(series, '2025-01-15');
    const feb = levelOn(series, '2025-02-15');
    expect(jan).toEqual({ level: expect.closeTo(1.01, 12), estimated: false });
    expect(feb?.level).toBeCloseTo(1.0302, 12);
    const middle = levelOn(series, '2025-02-01'); // 17 of 31 days from 15 January to 15 February
    expect(middle?.level).toBeCloseTo(1.01 + (1.0302 - 1.01) * (17 / 31), 12);
  });

  it('knows nothing before the chain starts', () => {
    expect(levelOn(series, '2024-11-30')).toBeNull();
    expect(levelOn(series, '2024-12-10')).toBeNull();
    expect(officialFactor(series, '2024-12-10', '2025-02-15')).toBeNull();
  });

  it('gives the factor between two published days', () => {
    expect(officialFactor(series, '2025-01-15', '2025-02-15')).toEqual({
      factor: expect.closeTo(1.0302 / 1.01, 12),
      estimated: false,
    });
    expect(officialFactor(series, '2025-02-15', '2025-01-15')).toBeNull();
  });

  it('estimates after the latest month with the recent monthly trend and says so', () => {
    const trend = 1.0302 ** (1 / 3) - 1;
    expect(series.trend).toBeCloseTo(trend, 12);
    const result = officialFactor(series, '2025-02-15', '2025-05-15');
    expect(result?.estimated).toBe(true);
    // 2025-03-15 .. 2025-05-15 is 61 days of 30.4375
    expect(result?.factor).toBeCloseTo((1 + trend) ** (61 / 30.4375) * (1.0302 / 1.0302), 9);
  });

  it('keeps only the stretch after a missing month comparable', () => {
    const broken = buildSeries(
      new Map([
        ['2024-01', 5],
        ['2024-02', 5],
        ['2025-01', 1],
        ['2025-02', 1],
      ]),
    );
    expect(broken.chainStart).toBe('2024-12');
    expect(levelOn(broken, '2024-02-15')).toBeNull();
    expect(officialFactor(broken, '2025-01-15', '2025-02-15')?.factor).toBeCloseTo(1.01, 12);
  });

  // Published 2025-01 .. 2026-08 at 0.3% a month; the owner types October 2026 only.
  const published = months('2025-01', Array(20).fill(0.3));
  const typedLater = Object.assign(new Map<string, number>([...published, ['2026-10', 0.5]]), {
    publishedLast: '2026-08',
  });

  it('settings-01 estimates an unpublished month before a typed one instead of breaking the chain', () => {
    const gap = buildSeries(typedLater);
    expect(gap.chainStart).toBe('2024-12');
    expect(gap.last).toBe('2026-10');
    expect(gap.estimatedMonths).toEqual(new Set(['2026-09']));
    // September at the trailing twelve-month rate of the months before it, October as typed.
    expect(gap.levels.get('2026-09')).toBeCloseTo(1.003 ** 21, 12);
    expect(gap.levels.get('2026-10')).toBeCloseTo(1.003 ** 21 * 1.005, 12);
    // The published stretch keeps its real figures and is not an estimate.
    expect(officialFactor(gap, '2025-06-15', '2026-08-15')).toEqual({
      factor: expect.closeTo(1.003 ** 14, 12),
      estimated: false,
    });
    expect(officialFactor(gap, '2025-06-15', '2026-08-01')?.estimated).toBe(false);
    // A span over the estimated month says so, even when it ends on the typed month.
    expect(officialFactor(gap, '2026-08-15', '2026-10-15')).toEqual({
      factor: expect.closeTo(1.003 * 1.005, 12),
      estimated: true,
    });
    expect(officialFactor(gap, '2026-09-10', '2026-10-15')?.estimated).toBe(true);
    // From the typed month's own span on, the estimated month no longer counts.
    expect(officialFactor(gap, '2026-09-15', '2026-10-15')).toEqual({
      factor: expect.closeTo(1.005, 12),
      estimated: false,
    });
    expect(trailingYearPercent(gap)).toBeCloseTo((1.003 ** 11 * 1.005 - 1) * 100, 9);
  });

  it('settings-01 fills only months with no figure: published and typed months stay as they are', () => {
    const typedBoth = Object.assign(new Map<string, number>([...typedLater, ['2026-09', 0.1]]), {
      publishedLast: '2026-08',
    });
    const full = buildSeries(typedBoth);
    expect(full.estimatedMonths.size).toBe(0);
    expect(full.levels.get('2026-09')).toBeCloseTo(1.003 ** 20 * 1.001, 12);
    // A gap inside the published months still breaks the chain, as a missing official month does.
    const holed = new Map(published);
    holed.delete('2025-06');
    const broken = buildSeries(Object.assign(holed, { publishedLast: '2026-08' }));
    expect(broken.chainStart).toBe('2025-06');
    expect(broken.estimatedMonths.size).toBe(0);
  });

  it('settings-01 reads the latest published month with the owner months laid over', async () => {
    const rows: Record<string, { month: string; changePercent: string }[]> = {
      inflation_months: [
        { month: '2026-07', changePercent: '0.300' },
        { month: '2026-08', changePercent: '0.300' },
      ],
      inflation_manual_months: [
        { month: '2026-08', changePercent: '0.900' },
        { month: '2026-10', changePercent: '0.500' },
      ],
    };
    const manager = {
      query: async (sql: string) => rows[/FROM (\w+)/.exec(sql)?.[1] ?? ''] ?? [],
    } as unknown as EntityManager;
    const { changes } = await readEffectiveChanges(
      manager,
      '00000000-0000-4000-8000-000000000001',
      'EUR',
    );
    expect(changes.publishedLast).toBe('2026-08');
    // The priority between a typed and a published month is unchanged: the typed one is used.
    expect(changes.get('2026-08')).toBe(0.9);
    expect(buildSeries(changes).estimatedMonths).toEqual(new Set(['2026-09']));
  });

  it('B-P3-5 says when the twelve-month inflation takes in an estimated month', () => {
    expect(trailingYearEstimated(buildSeries(typedLater))).toBe(true);
    const typedBoth = Object.assign(new Map<string, number>([...typedLater, ['2026-09', 0.1]]), {
      publishedLast: '2026-08',
    });
    expect(trailingYearEstimated(buildSeries(typedBoth))).toBe(false);
    // An estimated month a full year back is the base of the year, not one of its twelve months.
    const yearOn = Object.assign(new Map<string, number>(typedLater), { publishedLast: '2026-08' });
    for (let index = 1; index <= 11; index++)
      yearOn.set(`2027-${String(index).padStart(2, '0')}`, 0.2);
    yearOn.set('2026-11', 0.2).set('2026-12', 0.2);
    const later = buildSeries(yearOn);
    expect(later.last).toBe('2027-11');
    expect(later.estimatedMonths).toEqual(new Set(['2026-09']));
    expect(trailingYearEstimated(later)).toBe(false);
    expect(trailingYearEstimated(buildSeries(new Map()))).toBeNull();
    expect(trailingYearEstimated(series)).toBeNull();
  });

  it('reports the twelve-month inflation only with twelve months of history', () => {
    expect(trailingYearPercent(series)).toBeNull();
    const year = buildSeries(months('2024-01', Array(13).fill(1)));
    expect(trailingYearPercent(year)).toBeCloseTo((1.01 ** 12 - 1) * 100, 9);
  });

  it('knows nothing without any month', () => {
    const empty = buildSeries(new Map());
    expect(levelOn(empty, '2025-01-01')).toBeNull();
    expect(trailingYearPercent(empty)).toBeNull();
  });

  it('compounds the owner rate daily and calls it an estimate', () => {
    expect(personalFactor(10, '2025-01-01', '2026-01-01')).toEqual({
      factor: expect.closeTo(1.1, 12),
      estimated: true,
    });
    expect(personalFactor(10, '2025-01-01', '2025-01-01')?.factor).toBe(1);
    expect(personalFactor(10, '2025-01-02', '2025-01-01')).toBeNull();
  });

  it('prints a factor without exponent notation', () => {
    expect(formatFactor(1.0000000001234)).toBe('1.0000000001');
    expect(formatFactor(1e-9)).toBe('0.0000000010');
  });
});

// The columns the OECD sends (csvfilewithlabels), reduced to the ones the parser reads and
// the ones that name the series; a label with a comma is quoted.
const HEADER =
  'STRUCTURE,STRUCTURE_ID,STRUCTURE_NAME,ACTION,REF_AREA,Reference area,FREQ,UNIT_MEASURE,Unit of measure,TIME_PERIOD,Time period,OBS_VALUE,Observation value';
const oecd = (rows: [string, string][], over: { area?: string; unit?: string } = {}) =>
  [
    HEADER,
    ...rows.map(
      ([month, value]) =>
        `DATAFLOW,OECD.SDD.TPS:DSD_PRICES@DF_PRICES_ALL(1.0),"Consumer price indices (CPIs, HICPs), COICOP 1999",I,${over.area ?? 'USA'},United States,M,${over.unit ?? 'IX'},Index,${month},,${value},`,
    ),
  ].join('\r\n');

describe('INFL-OFFICIAL parsing what the statistics offices publish', () => {
  it('turns OECD index levels into monthly percent changes, whatever the row order', () => {
    const levels = parseOecdCpiLevels(
      oecd([
        ['2025-03', '303.0000'],
        ['2025-01', '300.0000'],
        ['2025-02', '303.0000'],
      ]),
    );
    expect(levels).toEqual([
      { month: '2025-01', value: 300 },
      { month: '2025-02', value: 303 },
      { month: '2025-03', value: 303 },
    ]);
    expect(levelsToChanges(levels)).toEqual([
      { month: '2025-02', percent: '1.00000000' },
      { month: '2025-03', percent: '0.00000000' },
    ]);
  });

  it('spreads the change across a month the statistics office did not publish', () => {
    // October 2025 was never published; the change from September to November is shared.
    const levels = parseOecdCpiLevels(
      oecd([
        ['2025-11', '102.0100'],
        ['2025-09', '100.0000'],
      ]),
    );
    expect(levelsToChanges(levels)).toEqual([
      { month: '2025-10', percent: '1.00000000' },
      { month: '2025-11', percent: '1.00000000' },
    ]);
  });

  it('has no level for a month with an empty value', () => {
    expect(parseOecdCpiLevels(oecd([['2025-01', '']]))).toEqual([]);
  });

  it('reads a quoted label with a comma and a final line without a line break', () => {
    const body = oecd([['2025-01', '100.5']]);
    expect(body).toContain('"Consumer price indices (CPIs, HICPs), COICOP 1999"');
    expect(parseOecdCpiLevels(`\uFEFF${body}\n`)).toEqual([{ month: '2025-01', value: 100.5 }]);
  });

  it.each([
    ['text', 'maintenance', 'no TIME_PERIOD and OBS_VALUE: "maintenance"'],
    ['an empty answer', '', 'not CSV'],
    ['another area', oecd([['2025-01', '100']], { area: 'DEU' }), 'another series "DEU IX"'],
    ['another unit', oecd([['2025-01', '1']], { unit: 'PC_CHG' }), 'another series "USA PC_CHG"'],
    ['a text value', oecd([['2025-01', 'abc']]), 'value "abc" on 2025-01'],
    ['a zero value', oecd([['2025-01', '0']]), 'value 0 on 2025-01'],
    ['a text month', oecd([['2025-Q1', '100']]), 'month "2025-Q1"'],
    [
      'a repeated month',
      oecd([
        ['2025-01', '100'],
        ['2025-01', '100'],
      ]),
      '2025-01 twice',
    ],
    ['a short row', `${HEADER}\r\nDATAFLOW,x`, 'a row of another width'],
    ['an open quote', `${HEADER}\r\nDATAFLOW,"x`, 'unterminated quote'],
  ])('refuses %s', (_name, body, detail) => {
    expect(() => parseOecdCpiLevels(body)).toThrow(detail);
  });

  const stat = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      version: '2.0',
      class: 'dataset',
      id: ['freq', 'unit', 'coicop18', 'geo', 'time'],
      size: [1, 1, 1, 1, 3],
      value: { '0': 100, '1': 101, '2': 102.01 },
      dimension: { time: { category: { index: { '2025-01': 0, '2025-02': 1, '2025-03': 2 } } } },
      ...over,
    });

  it('turns Eurostat HICP levels into monthly percent changes', () => {
    expect(parseEurostatHicp(stat())).toEqual([
      { month: '2025-02', percent: '1.00000000' },
      { month: '2025-03', percent: '1.00000000' },
    ]);
  });

  it('spreads the change across a month Eurostat has no value for', () => {
    expect(parseEurostatHicp(stat({ value: { '0': 100, '2': 102.01 } }))).toEqual([
      { month: '2025-02', percent: '1.00000000' },
      { month: '2025-03', percent: '1.00000000' },
    ]);
  });

  it.each([
    ['text', 'maintenance', 'not JSON'],
    ['more than one country', stat({ size: [1, 1, 1, 2, 3] }), 'is not one value'],
    [
      'no time dimension',
      stat({ id: ['freq', 'unit', 'coicop18', 'geo', 'when'] }),
      'no time dimension',
    ],
    ['no values', stat({ value: {} }), 'no values'],
    ['a text value', stat({ value: { '0': '100' } }), 'value on 2025-01'],
    [
      'a bad month label',
      stat({ dimension: { time: { category: { index: { Q1: 0 } } } } }),
      'month "Q1"',
    ],
  ])('refuses %s', (_name, body, detail) => {
    expect(() => parseEurostatHicp(body)).toThrow(detail);
  });

  it('breaks the chain after a gap of more than three missing months', () => {
    expect(
      levelsToChanges([
        { month: '2025-01', value: 100 },
        { month: '2025-06', value: 110 },
        { month: '2025-07', value: 110 },
      ]),
    ).toEqual([{ month: '2025-07', percent: '0.00000000' }]);
  });
});

describe('INFL-OFFICIAL the Bank of Russia annual inflation', () => {
  const row = (date: string, key: string, inflation: string, target = '4,00') =>
    `<tr><td>${date}</td><td>${key}</td><td>${inflation}</td><td>${target}</td></tr>`;
  const page = (rows: string[], header = 'Инфляция, % г/г') =>
    `<html><body><div class="table-wrapper"><div class="table"><table class="data">
      <tr><th>Дата</th><th>Ключевая ставка, % годовых</th><th>${header}</th><th>Цель по инфляции, %</th></tr>
      ${rows.join('\n')}
    </table></div></div></body></html>`;

  it('reads the inflation column by its header, newest row first, with decimal commas', () => {
    expect(
      parseCbrInflation(page([row('09.2026', '14,00', '6,35'), row('08.2026', '14,00', '6,33')])),
    ).toEqual([
      { month: '2026-08', percent: 6.33 },
      { month: '2026-09', percent: 6.35 },
    ]);
  });

  it.each([
    ['no table', '<html>maintenance</html>', 'no inflation table'],
    [
      'another column',
      page([row('09.2026', '14,00', '6,35')], 'Ключевая ставка'),
      'unexpected header',
    ],
    ['a short row', page(['<tr><td>09.2026</td><td>14,00</td></tr>']), 'unexpected row'],
    ['a bad date', page([row('2026-09', '14,00', '6,35')]), 'date "2026-09"'],
    ['a bad value', page([row('09.2026', '14,00', 'n/a')]), 'value "n/a" on 2026-09'],
    [
      'a repeated month',
      page([row('09.2026', '14,00', '6'), row('09.2026', '14,00', '6')]),
      '2026-09 twice',
    ],
    ['no month', page([]), 'no months'],
  ])('refuses %s', (_name, html, detail) => {
    expect(() => parseCbrInflation(html)).toThrow(detail);
  });

  const yearly = (from: string, count: number, percent: number) => {
    const result: { month: string; percent: number }[] = [];
    let [year, month] = from.split('-').map(Number);
    for (let i = 0; i < count; i++) {
      result.push({ month: `${year}-${String(month).padStart(2, '0')}`, percent });
      if (++month > 12) {
        month = 1;
        year++;
      }
    }
    return result;
  };

  it('rebuilds even monthly changes from a steady annual rate', () => {
    const changes = yearOverYearToChanges(yearly('2025-01', 24, 12));
    expect(changes[0].month).toBe('2024-02');
    expect(changes.at(-1)?.month).toBe('2026-12');
    const monthly = (1.12 ** (1 / 12) - 1) * 100;
    for (const change of changes) expect(Number(change.percent)).toBeCloseTo(monthly, 6);
  });

  it('makes twelve changes multiply to the published annual rate, whatever the seed', () => {
    const rows = yearly('2025-01', 12, 8).concat(yearly('2026-01', 12, 5));
    const changes = yearOverYearToChanges(rows);
    const byMonth = new Map(
      changes.map((change) => [change.month, 1 + Number(change.percent) / 100]),
    );
    const product = (last: string) => {
      let result = 1;
      let [year, month] = last.split('-').map(Number);
      for (let i = 0; i < 12; i++) {
        result *= byMonth.get(`${year}-${String(month).padStart(2, '0')}`) as number;
        if (--month < 1) {
          month = 12;
          year--;
        }
      }
      return result;
    };
    expect(product('2025-06')).toBeCloseTo(1.08, 6);
    expect(product('2026-03')).toBeCloseTo(1.05, 6);
    expect(product('2026-12')).toBeCloseTo(1.05, 6);
  });

  it('rebuilds only the run of months ending at the latest one', () => {
    const rows = [...yearly('2024-01', 3, 7), ...yearly('2025-06', 14, 6)];
    expect(yearOverYearToChanges(rows)[0].month).toBe('2024-07');
  });
});

describe('INFL-OFFICIAL the HTTP client', () => {
  let server: Server;
  let base: string;
  let seen: string[];
  let reply: (url: string, body: string) => { status: number; body: string };

  beforeEach(async () => {
    seen = [];
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        seen.push(request.url ?? '');
        const { status, body } = reply(request.url ?? '', text);
        response.writeHead(status, { 'content-type': 'text/plain' });
        response.end(body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });
  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('asks the OECD for the all-items US CPI index from 2008', async () => {
    reply = () => ({
      status: 200,
      body: oecd([
        ['2025-02', '101.0000'],
        ['2025-01', '100.0000'],
      ]),
    });
    const result = await new InflationClient({ oecdUrl: base }).fetch('bls');
    expect(result).toEqual({ ok: true, changes: [{ month: '2025-02', percent: '1.00000000' }] });
    expect(seen).toEqual([
      '/public/rest/data/OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/USA.M.N.CPI.IX._T.N._Z?startPeriod=2008-12&format=csvfilewithlabels',
    ]);
  });

  it('asks Eurostat for the euro-area all-items index', async () => {
    reply = () => ({
      status: 200,
      body: JSON.stringify({
        id: ['time'],
        size: [2],
        value: { '0': 100, '1': 101 },
        dimension: { time: { category: { index: { '2025-01': 0, '2025-02': 1 } } } },
      }),
    });
    const result = await new InflationClient({ eurostatUrl: base }).fetch('eurostat');
    expect(result).toEqual({ ok: true, changes: [{ month: '2025-02', percent: '1.00000000' }] });
    expect(seen[0]).toContain('prc_hicp_minr?format=JSON');
    expect(seen[0]).toContain('unit=I15&coicop18=TOTAL&geo=EA&sinceTimePeriod=2008-12');
  });

  it('asks the Bank of Russia page for the period and rebuilds monthly changes', async () => {
    reply = () => ({
      status: 200,
      body: `<table class="data"><tr><th>Дата</th><th>Ключевая ставка, % годовых</th><th>Инфляция, % г/г</th><th>Цель по инфляции, %</th></tr>${[
        '12.2025',
        '11.2025',
        '10.2025',
        '09.2025',
        '08.2025',
        '07.2025',
        '06.2025',
        '05.2025',
        '04.2025',
        '03.2025',
        '02.2025',
        '01.2025',
      ]
        .map((date) => `<tr><td>${date}</td><td>14,00</td><td>12,00</td><td>4,00</td></tr>`)
        .join('')}</table>`,
    });
    const result = await new InflationClient({ cbrUrl: base }).fetch(
      'cbr',
      new Date('2026-01-05T10:00:00Z'),
    );
    expect(seen[0]).toBe(
      '/hd_base/infl/?UniDbQuery.Posted=True&UniDbQuery.From=01.01.2013&UniDbQuery.To=05.01.2026',
    );
    expect(result.ok && result.changes).toHaveLength(23);
    expect(result.ok && result.changes[0].month).toBe('2024-02');
  });

  it('asks twice, then reports why', async () => {
    reply = () => ({ status: 429, body: '' });
    const client = new InflationClient({ cbrUrl: base, retryPauseMs: 0 });
    expect(await client.fetch('cbr')).toEqual({ ok: false, reason: 'rate_limited' });
    expect(seen).toHaveLength(2);
    reply = () => ({ status: 500, body: '' });
    expect(await client.fetch('cbr')).toEqual({ ok: false, reason: 'unavailable' });
    reply = () => ({ status: 200, body: '<html>maintenance</html>' });
    expect(await client.fetch('cbr')).toMatchObject({ ok: false, reason: 'invalid_response' });
  });
});

describe('INFL-INPUT owner input', () => {
  it('accepts a monthly change inside the range', () => {
    expect(parseMonthlyChange({ changePercent: '0.4' })).toBe('0.4');
    expect(parseMonthlyChange({ changePercent: '-0.25' })).toBe('-0.25');
  });

  it.each([
    [{}],
    [{ changePercent: 0.4 }],
    [{ changePercent: '-100' }],
    [{ changePercent: '1000' }],
    [{ changePercent: '1e2' }],
    [{ changePercent: '0.123456789' }],
    [{ changePercent: '1', extra: 1 }],
    [null],
  ])('refuses the monthly change %j', (body) => {
    expect(() => parseMonthlyChange(body)).toThrow(BadRequestException);
  });

  it('B-P3-4 refuses a typed month after the current Moscow month', () => {
    const now = new Date('2026-10-15T12:00:00.000Z');
    expect(parseTypedMonth('2026-10', now)).toBe('2026-10');
    expect(parseTypedMonth('1995-01', now)).toBe('1995-01');
    expect(() => parseTypedMonth('2026-11', now)).toThrow(
      'An inflation month cannot be after the current month',
    );
    expect(() => parseTypedMonth('2206-10', now)).toThrow(BadRequestException);
    expect(() => parseTypedMonth('2026-13', now)).toThrow(BadRequestException);
    // 21:00 UTC on the last day of October is already November in Moscow.
    expect(parseTypedMonth('2026-11', new Date('2026-10-31T21:00:00.000Z'))).toBe('2026-11');
    expect(() => parseTypedMonth('2026-11', new Date('2026-10-31T20:59:59.999Z'))).toThrow(
      BadRequestException,
    );
  });

  it('accepts an annual personal rate or its removal', () => {
    expect(parsePersonalRate({ annualPercent: '12.5' })).toBe('12.5');
    expect(parsePersonalRate({ annualPercent: '-3' })).toBe('-3');
    expect(parsePersonalRate({ annualPercent: null })).toBeNull();
  });

  it.each([[{ annualPercent: '-50' }], [{ annualPercent: '1000' }], [{ annualPercent: 5 }], [{}]])(
    'refuses the personal rate %j',
    (body) => {
      expect(() => parsePersonalRate(body)).toThrow(BadRequestException);
    },
  );

  it('reads a factor query and refuses anything else', () => {
    expect(
      parseFactorQuery({
        currency: 'RUB',
        from: '2025-01-01',
        to: '2025-06-30',
        basis: 'personal',
      }),
    ).toEqual({ currency: 'RUB', from: '2025-01-01', to: '2025-06-30', basis: 'personal' });
    expect(parseFactorQuery({ currency: 'USD', from: '2025-01-01', to: '2025-01-01' }).basis).toBe(
      'official',
    );
    for (const query of [
      { currency: 'GBP', from: '2025-01-01', to: '2025-02-01' },
      { currency: 'USD', from: '2025-02-01', to: '2025-01-01' },
      { currency: 'USD', from: '2025-02-30', to: '2025-03-01' },
      { currency: 'USD', from: '2025-01-01', to: '2025-02-01', basis: 'real' },
      { currency: 'USD', from: '2025-01-01', to: '2025-02-01', other: '1' },
      {},
    ])
      expect(() => parseFactorQuery(query)).toThrow(BadRequestException);
  });
});
