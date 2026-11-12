import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { BlockbookClient } from './blockbook-client';
import { EsploraClient, parsePage as parseEsploraPage } from './esplora-client';
import { HorizonClient, parseBalance } from './horizon-client';
import { errorCode, integer, list, loggedDetail, record } from './provider-client';
import { parseAccountValues, parseEpoch, SolanaRpcClient } from './solana-rpc-client';
import { parseTip, TronGridClient } from './trongrid-client';

// Synthetic identifiers only: shaped to match each client's log redaction, never real ones.
const STELLAR = `G${'A'.repeat(55)}`;
const BITCOIN = 'bc1q-synthetic-address';
const HASH = 'a'.repeat(64);
const MB = 1024 * 1024;

type Reply = { status: number; body: string | Buffer; headers?: Record<string, string> } & {
  trickleMs?: number;
};

describe('Chain provider clients at the outbound HTTP boundary', () => {
  let server: Server;
  let baseUrl: string;
  let replies: Reply[];
  let requests: { method: string; url: string; headers: IncomingHttpHeaders }[];
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      for await (const _chunk of request);
      requests.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
      });
      const reply = replies.shift() ?? { status: 599, body: '' };
      response.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers });
      if (!reply.trickleMs) return response.end(reply.body);
      // One byte at a time keeps the socket busy, so only a deadline on the whole answer ends it.
      let index = 0;
      const timer = setInterval(() => {
        if (response.destroyed || index >= reply.body.length) {
          clearInterval(timer);
          if (!response.destroyed) response.end();
          return;
        }
        response.write(String(reply.body[index++]));
      }, reply.trickleMs);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  });
  beforeEach(() => {
    replies = [];
    requests = [];
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  const horizon = (timeoutMs = 500) =>
    new HorizonClient({ baseUrl, timeoutMs, pauseMs: 0 }).balance(STELLAR);
  const tronGrid = (timeoutMs = 500) =>
    new TronGridClient({ baseUrl, timeoutMs, pauseMs: 0 }).tip();
  const blockbook = (timeoutMs = 500) =>
    new BlockbookClient({ baseUrls: [baseUrl], timeoutMs, pauseMs: 0 }).status();
  const solana = (timeoutMs = 500) =>
    new SolanaRpcClient({ url: `${baseUrl}/`, timeoutMs, pauseMs: 0 }).slot();
  const esplora = (timeoutMs = 500) =>
    new EsploraClient({ baseUrl, timeoutMs, pauseMs: 0 }).transactionCount(BITCOIN);
  const unavailable = { ok: false, reason: 'unavailable' };
  const invalid = { ok: false, reason: 'invalid_response' };

  it.each([
    ['Horizon', horizon, 'GET', `/accounts/${STELLAR}`, 'application/hal+json, application/json'],
    ['TronGrid', tronGrid, 'GET', '/walletsolidity/getblock?detail=false', 'application/json'],
    ['Blockbook', blockbook, 'GET', '/api', 'application/json'],
    ['Solana', solana, 'POST', '/', 'application/json'],
    ['Esplora', esplora, 'GET', `/address/${BITCOIN}`, 'application/json'],
  ])('%s asks for JSON at its own path', async (_name, call, method, url, accept) => {
    await call();
    expect(requests).toEqual([{ method, url, headers: expect.objectContaining({ accept }) }]);
  });

  it.each([
    ['Horizon', horizon, unavailable, [['Horizon /accounts/<id> answered 302']]],
    ['TronGrid', tronGrid, unavailable, [['TronGrid /walletsolidity/getblock answered 302']]],
    ['Blockbook', blockbook, unavailable, [['Blockbook /api answered 302']]],
    ['Solana', solana, { ...unavailable, detail: '127.0.0.1 answered HTTP 302' }, [] as string[][]],
    ['Esplora', esplora, unavailable, [] as string[][]],
  ])('%s follows no redirect to another place', async (_name, call, result, logged) => {
    replies.push({ status: 302, body: '', headers: { location: `${baseUrl}/elsewhere` } });
    await expect(call()).resolves.toEqual(result);
    expect(requests).toHaveLength(1);
    expect(warn.mock.calls).toEqual(logged);
  });

  it.each([
    ['Horizon', horizon, unavailable, [['Horizon /accounts/<id> failed: ERR_CANCELED']]],
    [
      'TronGrid',
      tronGrid,
      unavailable,
      [['TronGrid /walletsolidity/getblock failed: ERR_CANCELED']],
    ],
    ['Blockbook', blockbook, unavailable, [['Blockbook /api failed: ERR_CANCELED']]],
    [
      'Solana',
      solana,
      { ...unavailable, detail: '127.0.0.1 did not answer (ERR_CANCELED)' },
      [] as string[][],
    ],
    ['Esplora', esplora, unavailable, [] as string[][]],
  ])(
    '%s bounds a slowly trickling answer by a deadline on the whole of it',
    async (_name, call, result, logged) => {
      replies.push({ status: 200, body: ' '.repeat(200), trickleMs: 20 });
      const started = Date.now();
      await expect(call(300)).resolves.toEqual(result);
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(warn.mock.calls).toEqual(logged);
    },
  );

  it.each([
    ['Horizon', horizon, 16 * MB, invalid, [] as string[][]],
    ['TronGrid', tronGrid, 16 * MB, invalid, [] as string[][]],
    ['Blockbook', blockbook, 16 * MB, invalid, [['Blockbook /api was not understood: not JSON']]],
    [
      'Solana',
      solana,
      16 * MB,
      { ...invalid, detail: '127.0.0.1 sent an unexpected answer' },
      [] as string[][],
    ],
    ['Esplora', esplora, 32 * MB, invalid, [] as string[][]],
  ])(
    '%s reads an answer of exactly its size limit',
    async (_name, call, cap, result, logged) => {
      replies.push({ status: 200, body: Buffer.alloc(cap, ' ') });
      await expect(call(10_000)).resolves.toEqual(result);
      expect(warn.mock.calls).toEqual(logged);
    },
    30_000,
  );

  it.each([
    [
      'Horizon',
      horizon,
      16 * MB,
      unavailable,
      [['Horizon /accounts/<id> failed: ERR_BAD_RESPONSE']],
    ],
    [
      'TronGrid',
      tronGrid,
      16 * MB,
      unavailable,
      [['TronGrid /walletsolidity/getblock failed: ERR_BAD_RESPONSE']],
    ],
    ['Blockbook', blockbook, 16 * MB, unavailable, [['Blockbook /api failed: ERR_BAD_RESPONSE']]],
    [
      'Solana',
      solana,
      16 * MB,
      { ...unavailable, detail: '127.0.0.1 did not answer (ERR_BAD_RESPONSE)' },
      [] as string[][],
    ],
    ['Esplora', esplora, 32 * MB, unavailable, [] as string[][]],
  ])(
    '%s refuses an answer one byte over its size limit',
    async (_name, call, cap, result, logged) => {
      replies.push({ status: 200, body: Buffer.alloc(cap + 1, ' ') });
      await expect(call(10_000)).resolves.toEqual(result);
      expect(warn.mock.calls).toEqual(logged);
    },
    30_000,
  );

  describe('LOG-REDACT: no part of a key reaches the refusal log', () => {
    // Synthetic, with no repeated run, so a run of 6 of its characters in a line is a leak.
    const KEY = 'SYNTHETICKEYzyxwvutsrqponmlk';
    const IDS = `${'a'.repeat(64)} ${'b'.repeat(64)} ${'c'.repeat(64)} `;
    const runs = Array.from({ length: KEY.length - 5 }, (_, at) => KEY.slice(at, at + 6));
    const expectSafe = (line: string, limit: number) => {
      expect(runs.filter((run) => line.includes(run))).toEqual([]);
      expect(line).not.toMatch(/<[a-z]*$/);
      expect(line).not.toMatch(/[\r\n\t]/);
      expect(line.length).toBeLessThanOrEqual(limit);
    };
    // The key at every raw position, after text that redaction shortens and after text it keeps.
    const details = [0, 1].flatMap((withIds) =>
      Array.from(
        { length: 401 },
        (_, filler) => `${withIds ? IDS : ''}${'x'.repeat(filler)}${KEY} ${'y'.repeat(300)}`,
      ),
    );

    it('with the key at every position from 0 to 400 in what the shared cut is given', () => {
      const redact = (text: string) =>
        text.replaceAll(KEY, '<key>').replace(/\b[0-9a-f]{64}\b/g, '<id>');
      for (const detail of details) expectSafe(loggedDetail(detail, redact), 160);
    });

    it("with the review's case: three IDs, 38 characters, then the key at raw position 233", async () => {
      replies.push({ status: 503, body: `${IDS}${'x'.repeat(38)}${KEY} ${'y'.repeat(300)}` });
      await new TronGridClient({ apiKey: KEY, baseUrl, timeoutMs: 500, pauseMs: 0 }).tip();
      expect(warn.mock.calls).toEqual([
        [
          `TronGrid /walletsolidity/getblock answered 503: <id> <id> <id> ${'x'.repeat(38)}<key> ${'y'.repeat(101)}`,
        ],
      ]);
    });

    it.each([
      [
        'TronGrid',
        () => new TronGridClient({ apiKey: KEY, baseUrl, timeoutMs: 500, pauseMs: 0 }).tip(),
      ],
      [
        'Blockbook',
        () =>
          new BlockbookClient({
            baseUrls: [baseUrl],
            apiKey: KEY,
            timeoutMs: 500,
            pauseMs: 0,
          }).status(),
      ],
    ])(
      '%s, with the key at every position from 0 to 400 in its answer',
      async (name, call) => {
        for (const detail of details) {
          replies.push({ status: 503, body: detail });
          await call();
        }
        expect(warn.mock.calls).toHaveLength(details.length);
        for (const [line] of warn.mock.calls)
          expectSafe(String(line).replace(/^.* answered 503: /, ''), 160);
        expect(String(warn.mock.calls[0][0])).toContain(`${name} `);
      },
      30_000,
    );
  });

  describe('refusal log', () => {
    // An ID across the cut at 160 characters is redacted first, so none of it shows.
    const detail = `down\n\n${'x'.repeat(140)} ${HASH} ${'y'.repeat(300)}`;
    const said = `down ${'x'.repeat(140)} <id> ${'y'.repeat(8)}`;

    it.each([
      ['Horizon', horizon, 'Horizon /accounts/<id>'],
      ['TronGrid', tronGrid, 'TronGrid /walletsolidity/getblock'],
      ['Blockbook', blockbook, 'Blockbook /api'],
    ])(
      '%s keeps the first 160 characters of what it said, on one line, without an ID',
      async (_name, call, prefix) => {
        replies.push({ status: 503, body: detail });
        await expect(call()).resolves.toEqual(unavailable);
        expect(warn.mock.calls).toEqual([[`${prefix} answered 503: ${said}`]]);
      },
    );

    it.each([
      ['Horizon', horizon, 'Horizon /accounts/<id>'],
      ['TronGrid', tronGrid, 'TronGrid /walletsolidity/getblock'],
      ['Blockbook', blockbook, 'Blockbook /api'],
    ])('%s logs only the status when it said nothing', async (_name, call, prefix) => {
      replies.push({ status: 500, body: '' }, { status: 502, body: ' \n\t ' });
      await call();
      await call();
      expect(warn.mock.calls).toEqual([[`${prefix} answered 500`], [`${prefix} answered 502`]]);
    });

    it('Horizon names an operation in its path only as <id>', async () => {
      replies.push({ status: 500, body: '' });
      const client = new HorizonClient({ baseUrl, timeoutMs: 500, pauseMs: 0 });
      await expect(client.mergeAmount(214748364800012289n, STELLAR)).resolves.toEqual(unavailable);
      expect(requests[0].url).toBe('/operations/214748364800012289/effects?limit=50');
      expect(warn.mock.calls).toEqual([['Horizon /operations/<id>/effects answered 500']]);
    });
  });
});

describe('Chain provider clients parse answers strictly', () => {
  it('Horizon takes only an object for an object and only a list for a list', () => {
    expect(parseBalance({ balances: [{ asset_type: 'native', balance: '1' }] })).toBe(10_000_000n);
    for (const body of [null, [], 'text', 1, { balances: {} }, { balances: null }])
      expect(() => parseBalance(body)).toThrow();
  });

  it('TronGrid takes only whole numbers from 0 to the maximum', () => {
    const tip = (number: unknown) => ({ block_header: { raw_data: { number, timestamp: 0 } } });
    expect(parseTip(tip(0))).toEqual({ number: 0, timestamp: 0 });
    expect(parseTip(tip(2 ** 31 - 1))).toEqual({ number: 2 ** 31 - 1, timestamp: 0 });
    for (const number of [-1, 1.5, 2 ** 31, '1', null, undefined])
      expect(() => parseTip(tip(number))).toThrow();
    for (const body of [null, [], { block_header: [] }]) expect(() => parseTip(body)).toThrow();
  });

  it('Solana takes only whole numbers, objects and lists where it expects them', () => {
    expect(parseEpoch({ epoch: Number.MAX_SAFE_INTEGER })).toBe(BigInt(Number.MAX_SAFE_INTEGER));
    expect(parseEpoch({ epoch: 0 })).toBe(0n);
    for (const epoch of [-1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1, null])
      expect(() => parseEpoch({ epoch })).toThrow();
    expect(() => parseEpoch([])).toThrow();
    expect(parseAccountValues({ value: [null] }, 1)).toEqual([null]);
    for (const value of [{}, null, 'text'])
      expect(() => parseAccountValues({ value }, 0)).toThrow();
  });

  it('Esplora takes only an object for each transaction of a page', () => {
    expect(parseEsploraPage(BITCOIN, [])).toEqual([]);
    for (const item of [null, [], 'text', 1])
      expect(() => parseEsploraPage(BITCOIN, [item])).toThrow();
  });
});

describe('Shared provider client helpers', () => {
  it('takes only a non-array object as a record and only an array as a list', () => {
    const value = { a: 1 };
    expect(record(value)).toBe(value);
    for (const bad of [[], null, undefined, 'text', 1, true]) expect(() => record(bad)).toThrow();
    const items = [1];
    expect(list(items)).toBe(items);
    for (const bad of [{}, null, undefined, 'text', 1]) expect(() => list(bad)).toThrow();
  });

  it('takes only a safe whole number from 0 to the maximum', () => {
    expect(integer(0, 5)).toBe(0);
    expect(integer(5, 5)).toBe(5);
    for (const bad of [-1, 6, 1.5, Number.NaN, '1', null]) expect(() => integer(bad, 5)).toThrow();
    expect(() => integer(Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });

  it('names a failure by its code, its cause’s code or its name', () => {
    expect(errorCode({ code: 'ECONNRESET', cause: { code: 'X' }, name: 'Y' })).toBe('ECONNRESET');
    expect(errorCode({ code: '', cause: { code: 'ETIMEDOUT' }, name: 'Y' })).toBe('ETIMEDOUT');
    expect(errorCode({ code: 7, name: 'TypeError' })).toBe('TypeError');
    for (const unknown of [{}, null, undefined, 'text', { name: '' }])
      expect(errorCode(unknown)).toBe('unknown error');
  });

  it('keeps 160 characters of what was said, redacted before the cut, on one line', () => {
    const redact = (text: string) => text.replaceAll('secret', '<key>');
    expect(loggedDetail(`  a\n\tb  ${'c'.repeat(200)}`, redact)).toBe(`a b ${'c'.repeat(152)}`);
    // Cut first, "secret" would end at character 160 as "secre".
    expect(loggedDetail(`${'d'.repeat(154)} secret tail`, redact)).toBe(`${'d'.repeat(154)} <key>`);
    expect(loggedDetail(' \n ', redact)).toBe('');
    // Only a cut can split a placeholder: a short answer keeps its own "<" at the end.
    expect(loggedDetail('amount must be <min', redact)).toBe('amount must be <min');
  });
});
