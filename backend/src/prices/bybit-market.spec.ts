import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BybitMarketClient, parseBybitCandles } from './bybit-market';

// Synthetic candles only (BYBIT-ANY-COIN).
const HOUR = 3_600_000;
const DAY = 86_400_000;
const answer = (list: unknown[], retCode = 0) => ({
  retCode,
  retMsg: retCode === 0 ? 'OK' : 'Not supported symbols',
  result: retCode === 0 ? { category: 'spot', symbol: 'XRPUSDT', list } : {},
  retExtInfo: {},
  time: 1,
});
const candle = (start: number, close: unknown) => [String(start), '1', '2', '0.5', close, '9', '9'];

describe('BYBIT-ANY-COIN Bybit spot candles', () => {
  const now = Date.UTC(2026, 9, 9, 18, 5);
  const hour = Date.UTC(2026, 9, 9, 18);

  it('keeps the closed candles, oldest first, each observed at its close', () => {
    const list = [candle(hour, '2.5'), candle(hour - HOUR, '2.4'), candle(hour - 2 * HOUR, '2.30')];
    expect(parseBybitCandles(answer(list), HOUR, now)).toEqual([
      { closedAt: hour - HOUR, close: '2.3' },
      { closedAt: hour, close: '2.4' },
    ]);
  });

  it('tells a coin Bybit does not list from an error, and refuses an unreadable answer', () => {
    expect(parseBybitCandles(answer([], 10001), HOUR, now)).toBe('not_listed');
    expect(parseBybitCandles(answer([], 10006), HOUR, now)).toBe('unavailable');
    for (const list of [
      [candle(hour - HOUR, '0')],
      [candle(hour - HOUR, 2.5)],
      [candle(hour - HOUR + 1, '2.5')],
      [candle(hour + 2 * HOUR, '2.5')],
      [candle(hour - 2 * HOUR, '2.5'), candle(hour - HOUR, '2.5')],
      ['not a candle'],
    ])
      expect(parseBybitCandles(answer(list), HOUR, now)).toBe('invalid_response');
    expect(parseBybitCandles({ retCode: 0 }, HOUR, now)).toBe('invalid_response');
  });

  describe('against a local HTTP server', () => {
    let server: Server;
    let client: BybitMarketClient;
    let reply: { status: number; body: unknown };
    const urls: URL[] = [];

    beforeAll(async () => {
      server = createServer((request: IncomingMessage, response: ServerResponse) => {
        urls.push(new URL(request.url ?? '/', 'http://fixture.invalid'));
        response.writeHead(reply.status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(reply.body));
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const { port } = server.address() as AddressInfo;
      client = new BybitMarketClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 2000 });
    });
    afterAll(() => new Promise((done) => server.close(done)));
    beforeEach(() => {
      urls.length = 0;
    });

    it('asks for the coin against USDT and quotes its last closed hour', async () => {
      reply = { status: 200, body: answer([candle(hour, '2.5'), candle(hour - HOUR, '2.4')]) };
      expect(await client.latest('XRP', new Date(now))).toEqual({
        asset: 'XRP',
        price: '2.4',
        observedAt: new Date(hour).toISOString(),
        kind: 'hourly-close',
        source: 'bybit',
      });
      expect(urls[0].pathname).toBe('/v5/market/kline');
      expect(Object.fromEntries(urls[0].searchParams)).toEqual({
        category: 'spot',
        symbol: 'XRPUSDT',
        interval: '60',
        limit: '3',
      });
    });

    it('reads up to a thousand daily candles once', async () => {
      const day = Date.UTC(2026, 9, 9);
      reply = { status: 200, body: answer([candle(day, '2.5'), candle(day - DAY, '2.4')]) };
      expect(await client.daily('XRP', new Date(now))).toEqual([
        {
          asset: 'XRP',
          price: '2.4',
          observedAt: new Date(day).toISOString(),
          kind: 'daily-close',
          source: 'bybit',
        },
      ]);
      expect(urls[0].searchParams.get('interval')).toBe('D');
      expect(urls[0].searchParams.get('limit')).toBe('1000');
    });

    it('reports a coin without a market, a refusal and a throttle', async () => {
      reply = { status: 200, body: answer([], 10001) };
      expect(await client.latest('NOPE', new Date(now))).toBe('not_listed');
      reply = { status: 200, body: answer([]) };
      expect(await client.latest('NEW', new Date(now))).toBe('unavailable');
      reply = { status: 403, body: {} };
      expect(await client.daily('XRP', new Date(now))).toBe('unavailable');
      reply = { status: 429, body: {} };
      expect(await client.latest('XRP', new Date(now))).toBe('rate_limited');
    });
  });
});
