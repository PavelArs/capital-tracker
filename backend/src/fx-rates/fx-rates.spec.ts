import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BadRequestException } from '@nestjs/common';
import { CBR_SERIES, CbrClient, parseCbrDynamic } from './cbr-client';
import {
  accountingCurrencies,
  baseCurrencies,
  extraCurrencies,
  FxConverter,
  type FxRates,
  isAccountingCurrency,
  isTrackedFor,
  moscowDate,
  ratedCurrencies,
  rateOn,
  trackedCurrencies,
} from './fx-conversion';
import { parseRateDate } from './fx-rates.controller';
import { FX_HISTORY_FROM, fxRequestRanges, fxSplitUnreadable } from './fx-rates.service';

const ATOMS = 10n ** 30n;
const atoms = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * ATOMS + BigInt(fraction.padEnd(30, '0'));
};
const rates: FxRates = {
  USD: [
    { date: '2025-06-06', rubPerUnit: '78.9' },
    { date: '2025-06-07', rubPerUnit: '78.5' },
    { date: '2025-06-10', rubPerUnit: '79' },
  ],
  EUR: [{ date: '2025-06-07', rubPerUnit: '90' }],
};

describe('FX-QUERY rates on a chosen date', () => {
  it('reads an optional calendar date and refuses anything else', () => {
    expect(parseRateDate({})).toBeUndefined();
    expect(parseRateDate(undefined)).toBeUndefined();
    expect(parseRateDate({ date: '2025-06-08' })).toBe('2025-06-08');
    for (const query of [
      { date: '2025-02-30' },
      { date: '2025-6-8' },
      { date: '1990-01-01' },
      { date: ['2025-06-08'] },
      { date: '2025-06-08', currency: 'EUR' },
    ])
      expect(() => parseRateDate(query)).toThrow(BadRequestException);
  });
});

describe('FX-HISTORY rates for early operations', () => {
  // Today's rates first and older years newest first: a request that keeps failing never
  // holds back the rates read after it.
  it('reads the history from December 2008 in four-year requests on the first run', () => {
    expect(FX_HISTORY_FROM).toBe('2009-01-01');
    expect(fxRequestRanges(undefined, '2025-06-11')).toEqual([
      ['2024-11-27', '2025-06-11'],
      ['2020-11-28', '2024-11-26'],
      ['2016-11-29', '2020-11-27'],
      ['2012-11-30', '2016-11-28'],
      ['2008-12-01', '2012-11-29'],
    ]);
  });

  it('re-reads the last week, then fills the missing years before rates stored from 2025', () => {
    expect(fxRequestRanges({ first: '2025-01-11', last: '2025-06-10' }, '2025-06-11')).toEqual([
      ['2025-06-03', '2025-06-11'],
      ['2024-11-27', '2025-01-10'],
      ['2020-11-28', '2024-11-26'],
      ['2016-11-29', '2020-11-27'],
      ['2012-11-30', '2016-11-28'],
      ['2008-12-01', '2012-11-29'],
    ]);
  });

  it('asks again for a hole left by a failed request, but not for the New Year holidays', () => {
    expect(
      fxRequestRanges(
        {
          first: '2008-12-02',
          last: '2025-06-10',
          gaps: [
            ['2008-12-30', '2009-01-11'],
            ['2016-11-26', '2025-01-11'],
          ],
        },
        '2025-06-11',
      ),
    ).toEqual([
      ['2025-06-03', '2025-06-11'],
      ['2024-11-25', '2025-01-10'],
      ['2020-11-26', '2024-11-24'],
      ['2016-11-27', '2020-11-25'],
    ]);
  });

  it('splits an unreadable range in a newer and an older half down to 45 days', () => {
    expect(fxSplitUnreadable('2016-11-27', '2020-11-25')).toEqual([
      ['2018-11-27', '2020-11-25'],
      ['2016-11-27', '2018-11-26'],
    ]);
    expect(fxSplitUnreadable('2017-01-01', '2017-02-15')).toEqual([
      ['2017-01-24', '2017-02-15'],
      ['2017-01-01', '2017-01-23'],
    ]);
    expect(fxSplitUnreadable('2017-01-01', '2017-02-14')).toBeNull();
  });

  it('only re-reads the last week once the history reaches back to 2009 without holes', () => {
    expect(
      fxRequestRanges({ first: '2008-12-02', last: '2025-06-10', gaps: [] }, '2025-06-11'),
    ).toEqual([['2025-06-03', '2025-06-11']]);
    expect(fxRequestRanges({ first: '2008-12-02', last: '2025-06-10' }, '2025-06-11')).toEqual([
      ['2025-06-03', '2025-06-11'],
    ]);
  });
});

describe('FX-DATE Bank of Russia dates', () => {
  it('uses the Moscow calendar date of an instant (UTC+3)', () => {
    expect(moscowDate('2025-06-06T20:59:59.999Z')).toBe('2025-06-06');
    expect(moscowDate('2025-06-06T21:00:00.000Z')).toBe('2025-06-07');
    expect(moscowDate(new Date('2025-01-01T00:00:00Z'))).toBe('2025-01-01');
  });

  it('CUR-RATE-GAP: a day without a published rate uses the latest earlier rate', () => {
    expect(rateOn(rates.USD ?? [], '2025-06-08')).toEqual({
      date: '2025-06-07',
      rubPerUnit: '78.5',
    });
    expect(rateOn(rates.USD ?? [], '2025-06-09')?.rubPerUnit).toBe('78.5');
    expect(rateOn(rates.USD ?? [], '2025-06-10')?.rubPerUnit).toBe('79');
    expect(rateOn(rates.USD ?? [], '2030-01-01')?.rubPerUnit).toBe('79');
    expect(rateOn(rates.USD ?? [], '2025-06-05')).toBeNull();
    expect(rateOn([], '2025-06-05')).toBeNull();
  });
});

describe('FX-CONVERT exact conversion between accounting currencies', () => {
  it('keeps the same currency exact and converts through rubles', () => {
    const rub = new FxConverter(rates, 'RUB');
    expect(rub.convert(atoms('1000'), 'USD', '2025-06-07')).toBe(atoms('78500'));
    expect(rub.convert(atoms('123.456'), 'RUB', '2000-01-01')).toBe(atoms('123.456'));
    const eur = new FxConverter(rates, 'EUR');
    // EUR/USD is derived: 1000 USD × 78.5 / 90.
    expect(eur.convert(atoms('1000'), 'USD', '2025-06-08')).toBe(
      atoms('872.222222222222222222222222222222'),
    );
    expect(eur.convert(atoms('9000'), 'RUB', '2025-06-07')).toBe(atoms('100'));
    const usd = new FxConverter(rates, 'USD');
    expect(usd.convert(atoms('100000'), 'RUB', '2025-06-10')).toBe(
      atoms('1265.822784810126582278481012658228'),
    );
    expect(usd.convert(-atoms('157'), 'RUB', '2025-06-07')).toBe(-atoms('2'));
  });

  it('CUR-NO-RATE: a missing rate is null, never zero or a guess', () => {
    const eur = new FxConverter(rates, 'EUR');
    expect(eur.convert(atoms('1'), 'USD', '2025-06-06')).toBeNull();
    expect(eur.available('USD', '2025-06-06')).toBe(false);
    expect(eur.available('EUR', '2025-06-06')).toBe(true);
    expect(
      new FxConverter({ USD: [], EUR: [] }, 'RUB').convert(atoms('1'), 'USD', '2026-01-01'),
    ).toBeNull();
    expect(eur.ratesOn('2025-06-06')).toEqual([
      { currency: 'USD', date: '2025-06-06', rubPerUnit: '78.9' },
    ]);
  });
});

describe('CUR-MORE accounting currencies beyond USD, EUR and RUB', () => {
  const more: FxRates = {
    ...rates,
    GBP: [{ date: '2025-06-07', rubPerUnit: '106.25' }],
    JPY: [{ date: '2025-06-07', rubPerUnit: '0.5' }],
  };

  it('lists the seven added currencies after the first three, each with a Bank of Russia series', () => {
    expect(baseCurrencies).toEqual(['USD', 'EUR', 'RUB']);
    expect(extraCurrencies).toEqual(['GBP', 'CHF', 'CNY', 'JPY', 'KZT', 'TRY', 'AED']);
    expect(accountingCurrencies).toEqual([...baseCurrencies, ...extraCurrencies]);
    expect(ratedCurrencies).not.toContain('RUB');
    expect(Object.keys(CBR_SERIES).sort()).toEqual([...ratedCurrencies].sort());
    const codes = Object.values(CBR_SERIES).map(({ code }) => code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^R\d{5}[A-Z]?$/);
    expect(isAccountingCurrency('GBP')).toBe(true);
    for (const other of ['gbp', 'BTC', 'XXX', '', null, 'EURO']) {
      expect(isAccountingCurrency(other)).toBe(false);
    }
  });

  it('tracks the three base currencies, and an extra one only while it is the main one', () => {
    expect(trackedCurrencies([])).toEqual(['USD', 'EUR', 'RUB']);
    expect(trackedCurrencies(['EUR', 'RUB'])).toEqual(['USD', 'EUR', 'RUB']);
    expect(trackedCurrencies(['KZT'])).toEqual(['USD', 'EUR', 'RUB', 'KZT']);
    expect(trackedCurrencies(['TRY', 'GBP', 'TRY'])).toEqual(['USD', 'EUR', 'RUB', 'GBP', 'TRY']);
  });

  it('lets a read ask for USD, EUR, RUB and the main currency only', () => {
    expect(isTrackedFor('RUB', 'USD')).toBe(true);
    expect(isTrackedFor('GBP', 'GBP')).toBe(true);
    expect(isTrackedFor('GBP', 'EUR')).toBe(false);
    expect(isTrackedFor('KZT', 'GBP')).toBe(false);
    expect(isTrackedFor('EUR', 'KZT')).toBe(true);
  });

  it('converts through rubles in an added currency at the rate of the date', () => {
    const gbp = new FxConverter(more, 'GBP');
    expect(gbp.convert(atoms('1062.5'), 'RUB', '2025-06-08')).toBe(atoms('10'));
    // USD to GBP: 100 USD × 78.5 / 106.25.
    expect(gbp.convert(atoms('100'), 'USD', '2025-06-08')).toBe(
      atoms('73.882352941176470588235294117647'),
    );
    expect(new FxConverter(more, 'USD').convert(atoms('10'), 'GBP', '2025-06-08')).toBe(
      atoms('13.535031847133757961783439490446'),
    );
    expect(new FxConverter(more, 'JPY').convert(atoms('1'), 'RUB', '2025-06-08')).toBe(atoms('2'));
  });

  it('CUR-NO-RATE: a currency without a stored series states nothing, never zero', () => {
    const chf = new FxConverter(more, 'CHF');
    expect(chf.convert(atoms('1'), 'USD', '2025-06-08')).toBeNull();
    expect(chf.available('USD', '2025-06-08')).toBe(false);
    expect(chf.available('CHF', '2025-06-08')).toBe(true);
    expect(new FxConverter(more, 'GBP').convert(atoms('1'), 'GBP', '2000-01-01')).toBe(atoms('1'));
    expect(new FxConverter(more, 'GBP').available('RUB', '2000-01-01')).toBe(false);
  });

  it('shows the rates of USD and EUR and of the converter currency, not of every currency', () => {
    expect(
      new FxConverter(more, 'RUB').ratesOn('2025-06-08').map(({ currency }) => currency),
    ).toEqual(['USD', 'EUR']);
    expect(new FxConverter(more, 'GBP').ratesOn('2025-06-08')).toEqual([
      { currency: 'USD', date: '2025-06-07', rubPerUnit: '78.5' },
      { currency: 'EUR', date: '2025-06-07', rubPerUnit: '90' },
      { currency: 'GBP', date: '2025-06-07', rubPerUnit: '106.25' },
    ]);
  });

  it('reads the history of a late series from its own start', () => {
    expect(CBR_SERIES.TRY.since).toBe('2015-01-01');
    expect(fxRequestRanges(undefined, '2025-06-11', '2015-01-01')).toEqual([
      ['2022-11-29', '2025-06-11'],
      ['2018-11-30', '2022-11-28'],
      ['2014-12-01', '2018-11-29'],
    ]);
    // Rates stored from the start of 2015 are the whole history: only the last week is asked.
    expect(
      fxRequestRanges(
        { first: '2014-12-30', last: '2025-06-10', gaps: [] },
        '2025-06-11',
        '2015-01-01',
      ),
    ).toEqual([['2025-06-03', '2025-06-11']]);
  });

  it('asks the Bank of Russia for the series code of the currency', async () => {
    const seen: string[] = [];
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      seen.push(new URL(request.url ?? '', 'http://x').searchParams.get('VAL_NM_RQ') ?? '');
      response.setHeader('Content-Type', 'application/xml');
      response.end(xml('R01820', record('06.06.2025', '52,1234', '100', 'R01820')));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const { port } = server.address() as AddressInfo;
      const client = new CbrClient({ baseUrl: `http://127.0.0.1:${port}`, retryPauseMs: 1 });
      expect(await client.dynamic('JPY', '2025-06-01', '2025-06-10')).toEqual({
        ok: true,
        rates: [{ date: '2025-06-06', rubPerUnit: '0.521234' }],
      });
      expect(seen).toEqual(['R01820']);
    } finally {
      server.close();
    }
  });
});

const xml = (code: string, records: string) =>
  `<?xml version="1.0" encoding="windows-1251"?><ValCurs ID="${code}" DateRange1="01.06.2025" DateRange2="10.06.2025" name="Foreign Currency Market Dynamic">${records}</ValCurs>`;
const record = (date: string, value: string, nominal = '1', code = 'R01235') =>
  `<Record Date="${date}" Id="${code}"><Nominal>${nominal}</Nominal><Value>${value}</Value><VunitRate>${value}</VunitRate></Record>`;

describe('FX-PARSE Bank of Russia XML_dynamic answers', () => {
  it('reads records whose elements differ in order, extras or decimal mark', () => {
    const at = (date: string, inner: string) =>
      `<Record Date="${date}" Id="R01235">${inner}</Record>`;
    expect(
      parseCbrDynamic(
        xml(
          'R01235',
          at('03.06.2025', '<Value>78.9</Value><Nominal>1</Nominal>') +
            at('04.06.2025', '\n  <Nominal> 1 </Nominal>\n  <Value> 79 </Value>\n') +
            at(
              '05.06.2025',
              '<Nominal>1</Nominal><Value>79,1</Value><VunitRate>79,1000000000000000000000000000000000001</VunitRate>',
            ) +
            at('06.06.2025', '<Nominal>1</Nominal><Value>79,2</Value><Unknown></Unknown>'),
        ),
        'R01235',
        '2025-06-01',
        '2025-06-10',
      ),
    ).toEqual([
      { date: '2025-06-03', rubPerUnit: '78.9' },
      { date: '2025-06-04', rubPerUnit: '79' },
      { date: '2025-06-05', rubPerUnit: '79.1' },
      { date: '2025-06-06', rubPerUnit: '79.2' },
    ]);
  });

  it('reads every record of the asked series as rubles per unit', () => {
    expect(
      parseCbrDynamic(
        xml('R01235', record('06.06.2025', '78,9000') + record('07.06.2025', '78,5432')),
        'R01235',
        '2025-06-01',
        '2025-06-10',
      ),
    ).toEqual([
      { date: '2025-06-06', rubPerUnit: '78.9' },
      { date: '2025-06-07', rubPerUnit: '78.5432' },
    ]);
    expect(parseCbrDynamic(xml('R01235', ''), 'R01235', '2025-06-01', '2025-06-10')).toEqual([]);
    expect(
      parseCbrDynamic(
        '<?xml version="1.0"?><ValCurs ID="R01235" DateRange1="01.06.2025" DateRange2="10.06.2025" name="x" />',
        'R01235',
        '2025-06-01',
        '2025-06-10',
      ),
    ).toEqual([]);
    expect(
      parseCbrDynamic(
        xml('R01235', record('06.06.2025', '58,1234', '100')),
        'R01235',
        '2025-06-01',
        '2025-06-10',
      ),
    ).toEqual([{ date: '2025-06-06', rubPerUnit: '0.581234' }]);
  });

  // The refusal names the part, so a production log tells what changed in the answer.
  it.each([
    ['another series', xml('R01239', record('06.06.2025', '78,9')), 'series "R01239"'],
    [
      'a record of another series',
      xml('R01235', record('06.06.2025', '78,9', '1', 'R01239')),
      'series R01239 on 2025-06-06',
    ],
    [
      'a date outside the range',
      xml('R01235', record('11.06.2025', '78,9')),
      '2025-06-11 outside the range',
    ],
    [
      'an impossible date',
      xml('R01235', record('31.06.2025', '78,9')),
      'impossible date 31.06.2025',
    ],
    [
      'dates out of order',
      xml('R01235', record('07.06.2025', '78,9') + record('06.06.2025', '78,9')),
      '2025-06-06 after 2025-06-07',
    ],
    [
      'a repeated date',
      xml('R01235', record('06.06.2025', '78,9') + record('06.06.2025', '78,9')),
      '2025-06-06 after 2025-06-06',
    ],
    ['a zero rate', xml('R01235', record('06.06.2025', '0,0000')), 'rate 0 on 2025-06-06'],
    [
      'a nominal that is not a power of ten',
      xml('R01235', record('06.06.2025', '78,9', '3')),
      'nominal 3 on 2025-06-06',
    ],
    [
      'unknown content',
      xml('R01235', `${record('06.06.2025', '78,9')}<Error/>${record('07.06.2025', '78,9')}`),
      'unexpected content after 2025-06-06: "<Error/><Record Date=\\"07.06.2025\\" Id=\\"R01235\\"><Nominal>1</No"',
    ],
    [
      'a record without a nominal',
      xml('R01235', '<Record Date="06.06.2025" Id="R01235"><Value>78,9</Value></Record>'),
      'record on 2025-06-06: "<Value>78,9</Value>"',
    ],
    [
      'a record with a repeated value',
      xml(
        'R01235',
        '<Record Date="06.06.2025" Id="R01235"><Nominal>1</Nominal><Value>78,9</Value><Value>79</Value></Record>',
      ),
      'record on 2025-06-06: "<Nominal>1</Nominal><Value>78,9</Value><Value>79</Value>"',
    ],
    [
      'a value that is not a number',
      xml(
        'R01235',
        '<Record Date="06.06.2025" Id="R01235"><Nominal>1</Nominal><Value>-</Value></Record>',
      ),
      'record on 2025-06-06: "<Nominal>1</Nominal><Value>-</Value>"',
    ],
    [
      'an error page',
      '<html><body>Error in parameters</body></html>',
      'no rate list: "<html><body>Error in parameters</body></html>"',
    ],
  ])('refuses %s', (_label, body, what) => {
    expect(() => parseCbrDynamic(body, 'R01235', '2025-06-01', '2025-06-10')).toThrow(
      expect.objectContaining({ message: what }),
    );
  });
});

describe('FX-CLIENT Bank of Russia client against a local HTTP server', () => {
  let server: Server;
  let baseUrl: string;
  let answers: { status: number; body: string }[];
  let requests: URL[];

  beforeAll(async () => {
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      requests.push(new URL(request.url ?? '/', 'http://fixture.invalid'));
      // The last answer repeats.
      const answer = answers.length > 1 ? answers.shift()! : answers[0];
      response.writeHead(answer.status, {
        'content-type': 'application/xml; charset=windows-1251',
      });
      // The real answer is windows-1251; names are not ASCII.
      response.end(Buffer.from(answer.body, 'latin1'));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));
  beforeEach(() => {
    requests = [];
  });

  it('asks the dynamic series for the currency and the inclusive date range', async () => {
    answers = [
      { status: 200, body: xml('R01239', record('07.06.2025', '90,0000', '1', 'R01239')) },
    ];
    const result = await new CbrClient({ baseUrl }).dynamic('EUR', '2025-06-01', '2025-06-10');
    expect(result).toEqual({ ok: true, rates: [{ date: '2025-06-07', rubPerUnit: '90' }] });
    expect(requests).toHaveLength(1);
    expect(requests[0].pathname).toBe('/scripts/XML_dynamic.asp');
    expect(Object.fromEntries(requests[0].searchParams)).toEqual({
      date_req1: '01/06/2025',
      date_req2: '10/06/2025',
      VAL_NM_RQ: 'R01239',
    });
  });

  it.each([
    [429, '', 'rate_limited'],
    [500, '', 'unavailable'],
    [200, '<html>maintenance</html>', 'invalid_response'],
  ] as const)('reports HTTP %i %j as %s after asking once more', async (status, body, reason) => {
    answers = [{ status, body }];
    const client = new CbrClient({ baseUrl, retryPauseMs: 0 });
    expect(await client.dynamic('USD', '2025-06-01', '2025-06-10')).toEqual(
      reason === 'invalid_response'
        ? { ok: false, reason, detail: 'no rate list: "<html>maintenance</html>"' }
        : { ok: false, reason },
    );
    expect(requests).toHaveLength(2);
  });

  it('asks once more after a pause when an answer is unreadable', async () => {
    answers = [
      { status: 200, body: '<html>Service unavailable</html>' },
      { status: 200, body: xml('R01235', record('07.06.2025', '78,9')) },
    ];
    const started = Date.now();
    const result = await new CbrClient({ baseUrl, retryPauseMs: 100 }).dynamic(
      'USD',
      '2025-06-01',
      '2025-06-10',
    );
    expect(result).toEqual({ ok: true, rates: [{ date: '2025-06-07', rubPerUnit: '78.9' }] });
    expect(requests).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it('reports an unreachable host as unavailable', async () => {
    const result = await new CbrClient({
      baseUrl: 'http://127.0.0.1:9',
      timeoutMs: 2000,
      retryPauseMs: 0,
    }).dynamic('USD', '2025-06-01', '2025-06-10');
    expect(result).toEqual({ ok: false, reason: 'unavailable' });
  });
});
