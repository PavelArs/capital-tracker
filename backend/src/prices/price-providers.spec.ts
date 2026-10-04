import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MARKET_ASSETS, type MarketAsset } from './price-catalog';
import { CoinGeckoClient, KrakenClient } from './price-providers';

type Handler = (url: URL, request: IncomingMessage) => { status: number; body: unknown };
const asset = (code: string): MarketAsset => {
  const found = MARKET_ASSETS.find((item) => item.code === code);
  if (!found) throw new Error(code);
  return found;
};
const seconds = (iso: string) => Date.parse(iso) / 1000;
const candle = (openIso: string, close: unknown) => [
  seconds(openIso),
  '1.0',
  '2.0',
  '0.5',
  close,
  '1.2',
  '10.5',
  42,
];

describe('PRC-PARSE market price clients against a local HTTP server', () => {
  let server: Server;
  let baseUrl: string;
  let handler: Handler;
  let requests: { url: URL; headers: IncomingMessage['headers'] }[];

  beforeAll(async () => {
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? '/', 'http://fixture.invalid');
      requests.push({ url, headers: request.headers });
      const { status, body } = handler(url, request);
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));
  beforeEach(() => {
    requests = [];
  });

  describe('Kraken hourly candles', () => {
    const now = new Date('2026-10-04T14:05:00Z');
    const hourly = (key: string, close: unknown) => ({
      error: [],
      result: {
        [key]: [
          candle('2026-10-04T11:00:00Z', '84000.0'),
          candle('2026-10-04T12:00:00Z', '84500.0'),
          candle('2026-10-04T13:00:00Z', close),
          candle('2026-10-04T14:00:00Z', '86000.0'),
        ],
        last: seconds('2026-10-04T13:00:00Z'),
      },
    });
    const kraken = () => new KrakenClient({ baseUrl, pauseMs: 0, retryPauseMs: 0 });

    it('takes the close of the latest closed candle at its close instant', async () => {
      handler = () => ({ status: 200, body: hourly('XXBTZUSD', '84945.10000') });
      await expect(kraken().latest([asset('BTC')], now)).resolves.toEqual({
        ok: true,
        missing: [],
        quotes: [
          {
            asset: 'BTC',
            price: '84945.1',
            observedAt: '2026-10-04T14:00:00.000Z',
            kind: 'hourly-close',
            source: 'kraken',
          },
        ],
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].url.pathname).toBe('/0/public/OHLC');
      expect(Object.fromEntries(requests[0].url.searchParams)).toEqual({
        pair: 'XBTUSD',
        interval: '60',
        since: String(seconds('2026-10-04T11:00:00Z')),
      });
    });

    it('reports an asset that fails while keeping the others', async () => {
      handler = (url) =>
        url.searchParams.get('pair') === 'ETHUSD'
          ? { status: 500, body: { error: ['EService:Unavailable'] } }
          : url.searchParams.get('pair') === 'SOLUSD'
            ? { status: 200, body: { error: ['EQuery:Unknown asset pair'] } }
            : { status: 200, body: hourly('XXBTZUSD', '84945.1') };
      const result = await kraken().latest([asset('BTC'), asset('ETH'), asset('SOL')], now);
      expect(result).toEqual({
        ok: true,
        missing: ['ETH', 'SOL'],
        quotes: [expect.objectContaining({ asset: 'BTC', price: '84945.1' })],
      });
      expect(requests.map(({ url }) => url.searchParams.get('pair'))).toEqual([
        'XBTUSD',
        'ETHUSD',
        'ETHUSD',
        'SOLUSD',
        'SOLUSD',
      ]);
    });

    it('PRC-RETRY repeats a pair that failed once and keeps its price', async () => {
      const seen = new Map<string, number>();
      handler = (url) => {
        const pair = url.searchParams.get('pair') ?? '';
        seen.set(pair, (seen.get(pair) ?? 0) + 1);
        return pair === 'ETHUSD' && seen.get(pair) === 1
          ? { status: 200, body: { error: ['EGeneral:Too many requests'] } }
          : { status: 200, body: hourly('XETHZUSD', '2701.24') };
      };
      await expect(kraken().latest([asset('BTC'), asset('ETH')], now)).resolves.toEqual({
        ok: true,
        missing: [],
        quotes: [
          expect.objectContaining({ asset: 'BTC', price: '2701.24' }),
          expect.objectContaining({ asset: 'ETH', price: '2701.24' }),
        ],
      });
      expect(requests.map(({ url }) => url.searchParams.get('pair'))).toEqual([
        'XBTUSD',
        'ETHUSD',
        'ETHUSD',
      ]);
    });

    it('PRC-RETRY never repeats an unreadable answer', async () => {
      handler = () => ({ status: 200, body: 'not json' });
      await expect(kraken().latest([asset('BTC')], now)).resolves.toEqual({
        ok: false,
        reason: 'invalid_response',
      });
      expect(requests).toHaveLength(1);
    });

    it('PRC-7 waits between requests and before a retry', async () => {
      let calls = 0;
      handler = () => {
        calls += 1;
        return calls === 1
          ? { status: 503, body: {} }
          : { status: 200, body: hourly('XXBTZUSD', '84945.1') };
      };
      const started = Date.now();
      const result = await new KrakenClient({ baseUrl, pauseMs: 60, retryPauseMs: 150 }).latest(
        [asset('BTC'), asset('ETH')],
        now,
      );
      expect(result).toEqual(expect.objectContaining({ ok: true, missing: [] }));
      expect(requests).toHaveLength(3);
      expect(Date.now() - started).toBeGreaterThanOrEqual(150 + 60);
    });

    it.each([
      [429, { error: [] }, 'rate_limited'],
      [200, { error: ['EAPI:Rate limit exceeded'] }, 'rate_limited'],
      [200, { error: ['EGeneral:Too many requests'] }, 'rate_limited'],
      [503, { error: [] }, 'unavailable'],
      [200, { error: ['EGeneral:Internal error'] }, 'unavailable'],
      [200, 'not json', 'invalid_response'],
    ])('fails as a whole when every asset answers %s %j', async (status, body, reason) => {
      handler = () => ({ status, body });
      await expect(kraken().latest([asset('BTC'), asset('ETH')], now)).resolves.toEqual({
        ok: false,
        reason,
      });
    });

    it.each([
      ['a negative close', hourly('XXBTZUSD', '-1.0')],
      ['a numeric close', hourly('XXBTZUSD', 84945.1)],
      ['a zero close', hourly('XXBTZUSD', '0.000')],
      [
        'two pair keys',
        { error: [], result: { ...hourly('XXBTZUSD', '1.0').result, XETHZUSD: [] } },
      ],
      [
        'a misaligned candle',
        {
          error: [],
          result: { XXBTZUSD: [[seconds('2026-10-04T12:30:00Z'), '1', '1', '1', '1']] },
        },
      ],
      ['no result', { error: [] }],
      [
        'only the open candle',
        { error: [], result: { XXBTZUSD: [candle('2026-10-04T14:00:00Z', '1.0')] } },
      ],
    ])('never stores %s', async (_label, body) => {
      handler = () => ({ status: 200, body });
      await expect(kraken().latest([asset('BTC')], now)).resolves.toEqual({
        ok: false,
        reason: 'invalid_response',
      });
    });
  });

  describe('Kraken daily candles for the backfill', () => {
    it('stores closed days from the start date at their close instant and skips the open day', async () => {
      handler = () => ({
        status: 200,
        body: {
          error: [],
          result: {
            XXBTZUSD: [
              candle('2024-12-31T00:00:00Z', '93000.0'),
              candle('2025-01-01T00:00:00Z', '94000.5'),
              candle('2025-01-02T00:00:00Z', '96000.25'),
              candle('2025-01-03T00:00:00Z', '97000.0'),
            ],
            last: seconds('2025-01-02T00:00:00Z'),
          },
        },
      });
      const client = new KrakenClient({ baseUrl, pauseMs: 0, retryPauseMs: 0 });
      await expect(
        client.daily(
          asset('BTC'),
          new Date('2025-01-01T00:00:00Z'),
          new Date('2025-01-03T10:00:00Z'),
        ),
      ).resolves.toEqual({
        ok: true,
        quotes: [
          {
            asset: 'BTC',
            price: '94000.5',
            observedAt: '2025-01-02T00:00:00.000Z',
            kind: 'daily-close',
            source: 'kraken',
          },
          {
            asset: 'BTC',
            price: '96000.25',
            observedAt: '2025-01-03T00:00:00.000Z',
            kind: 'daily-close',
            source: 'kraken',
          },
        ],
      });
      expect(Object.fromEntries(requests[0].url.searchParams)).toEqual({
        pair: 'XBTUSD',
        interval: '1440',
        since: String(seconds('2025-01-01T00:00:00Z') - 1),
      });
    });

    it('reports a failed daily request', async () => {
      handler = () => ({ status: 502, body: {} });
      const client = new KrakenClient({ baseUrl, pauseMs: 0, retryPauseMs: 0 });
      await expect(
        client.daily(
          asset('BTC'),
          new Date('2025-01-01T00:00:00Z'),
          new Date('2025-01-03T10:00:00Z'),
        ),
      ).resolves.toEqual({ ok: false, reason: 'unavailable' });
      expect(requests).toHaveLength(2);
    });

    it('PRC-RETRY repeats a daily request that failed once', async () => {
      let calls = 0;
      handler = () => {
        calls += 1;
        return calls === 1
          ? { status: 502, body: {} }
          : {
              status: 200,
              body: {
                error: [],
                result: {
                  XXBTZUSD: [
                    candle('2025-01-01T00:00:00Z', '93000.1'),
                    candle('2025-01-02T00:00:00Z', '94000.2'),
                  ],
                  last: seconds('2025-01-01T00:00:00Z'),
                },
              },
            };
      };
      const client = new KrakenClient({ baseUrl, pauseMs: 0, retryPauseMs: 0 });
      await expect(
        client.daily(
          asset('BTC'),
          new Date('2025-01-01T00:00:00Z'),
          new Date('2025-01-02T10:00:00Z'),
        ),
      ).resolves.toEqual({
        ok: true,
        quotes: [expect.objectContaining({ asset: 'BTC', price: '93000.1', kind: 'daily-close' })],
      });
      expect(requests).toHaveLength(2);
    });
  });

  describe('CoinGecko simple price', () => {
    const now = new Date('2026-10-04T15:05:00Z');
    const updated = seconds('2026-10-04T15:04:30Z');
    const assets = [asset('BTC'), asset('ETH'), asset('ZEC')];

    it('returns each requested id at its last update and reports omitted ids', async () => {
      handler = () => ({
        status: 200,
        body: {
          bitcoin: { usd: 84950.12, last_updated_at: updated },
          ethereum: { usd: 3012.5, last_updated_at: updated - 30 },
        },
      });
      await expect(new CoinGeckoClient({ baseUrl }).latest(assets, now)).resolves.toEqual({
        ok: true,
        missing: ['ZEC'],
        quotes: [
          {
            asset: 'BTC',
            price: '84950.12',
            observedAt: '2026-10-04T15:04:30.000Z',
            kind: 'spot',
            source: 'coingecko',
          },
          {
            asset: 'ETH',
            price: '3012.5',
            observedAt: '2026-10-04T15:04:00.000Z',
            kind: 'spot',
            source: 'coingecko',
          },
        ],
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].url.pathname).toBe('/api/v3/simple/price');
      expect(Object.fromEntries(requests[0].url.searchParams)).toEqual({
        ids: 'bitcoin,ethereum,zcash',
        vs_currencies: 'usd',
        include_last_updated_at: 'true',
        precision: 'full',
      });
      expect(requests[0].headers['x-cg-demo-api-key']).toBeUndefined();
    });

    it('sends the free Demo key only when configured', async () => {
      handler = () => ({ status: 200, body: {} });
      await new CoinGeckoClient({ baseUrl, demoKey: 'CG-synthetic' }).latest(assets, now);
      expect(requests[0].headers['x-cg-demo-api-key']).toBe('CG-synthetic');
    });

    it.each([
      [429, {}, 'rate_limited'],
      [500, {}, 'unavailable'],
      [200, 'not json', 'invalid_response'],
      [200, [], 'invalid_response'],
      [200, { bitcoin: { usd: -5, last_updated_at: updated } }, 'invalid_response'],
      [200, { bitcoin: { usd: '84950', last_updated_at: updated } }, 'invalid_response'],
      [200, { bitcoin: { usd: 1e-7, last_updated_at: updated } }, 'invalid_response'],
      [200, { bitcoin: { usd: 84950 } }, 'invalid_response'],
      [200, { bitcoin: { usd: 84950, last_updated_at: updated + 3600 } }, 'invalid_response'],
      [200, { bitcoin: { usd: 84950, last_updated_at: 1.5 } }, 'invalid_response'],
    ])('fails on %s %j', async (status, body, reason) => {
      handler = () => ({ status, body });
      await expect(new CoinGeckoClient({ baseUrl }).latest(assets, now)).resolves.toEqual({
        ok: false,
        reason,
      });
    });
  });
});
