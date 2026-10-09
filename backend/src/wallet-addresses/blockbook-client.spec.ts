import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import {
  BLOCKBOOK_PAGE_SIZE,
  BlockbookClient,
  MAX_ZCASH_FEE,
  parsePage,
  parseStatus,
  parseTransaction,
  zatoshi,
} from './blockbook-client';

// Synthetic addresses, hashes and amounts only; the parser compares the address as text.
const wallet = `t1${'W'.repeat(33)}`;
const other = `t1${'X'.repeat(33)}`;
const hash = (digit: string) => digit.repeat(64);
const HEIGHT = 3_000_000;

const tx = (extra: Record<string, unknown> = {}) => ({
  txid: hash('1'),
  version: 4,
  vin: [{ n: 0, txid: hash('9'), vout: 0, addresses: [other], isAddress: true, value: '150000' }],
  vout: [
    { value: '100000', n: 0, addresses: [wallet], isAddress: true },
    { value: '40000', n: 1, addresses: [other], isAddress: true },
  ],
  blockHash: hash('b'),
  blockHeight: HEIGHT,
  confirmations: 10,
  blockTime: 1_790_000_000,
  value: '140000',
  valueIn: '150000',
  fees: '10000',
  ...extra,
});

describe('ZCASH-IDENTITY: the transparent ZEC of a transaction', () => {
  it('reads zatoshi amounts', () => {
    expect(zatoshi('0')).toBe(0n);
    expect(zatoshi('2100000000000000')).toBe(2_100_000_000_000_000n);
    for (const bad of ['-1', '1.5', '01', '', 7]) expect(() => zatoshi(bad)).toThrow();
  });

  it('records ZEC received; the sender paid the fee', () => {
    expect(parseTransaction(wallet, tx())).toMatchObject({
      txid: hash('1'),
      blockHeight: HEIGHT,
      blockHash: hash('b'),
      blockTime: new Date(1_790_000_000_000).toISOString(),
      receivedUnits: 100_000n,
      sentUnits: 0n,
      feeUnits: 0n,
      direction: 'in',
    });
  });

  it('records what the wallet spent and the fee it paid', () => {
    const send = tx({
      vin: [{ n: 0, addresses: [wallet], isAddress: true, value: '150000' }],
      vout: [
        { value: '100000', n: 0, addresses: [other], isAddress: true },
        { value: '40000', n: 1, addresses: [wallet], isAddress: true },
      ],
    });
    expect(parseTransaction(wallet, send)).toMatchObject({
      receivedUnits: 40_000n,
      sentUnits: 150_000n,
      feeUnits: 10_000n,
      direction: 'out',
    });
  });

  it('marks a payment back to the wallet as self', () => {
    const self = tx({
      vin: [{ n: 0, addresses: [wallet], isAddress: true, value: '150000' }],
      vout: [{ value: '140000', n: 0, addresses: [wallet], isAddress: true }],
    });
    expect(parseTransaction(wallet, self)).toMatchObject({ feeUnits: 10_000n, direction: 'self' });
  });

  it('keeps a move into the shielded pool a send, without a fee it cannot tell', () => {
    // No transparent output; Blockbook may count the shielded amount as the fee.
    const shielding = tx({
      vin: [{ n: 0, addresses: [wallet], isAddress: true, value: '5000000' }],
      vout: [],
      fees: '5000000',
    });
    expect(parseTransaction(wallet, shielding)).toMatchObject({
      receivedUnits: 0n,
      sentUnits: 5_000_000n,
      feeUnits: 0n,
      direction: 'out',
    });
    expect(MAX_ZCASH_FEE).toBe(1_000_000n);
    // ZEC from the shielded pool to the wallet: no transparent input at all.
    const deshielding = tx({ vin: [], fees: '0' });
    expect(parseTransaction(wallet, deshielding)).toMatchObject({
      receivedUnits: 100_000n,
      feeUnits: 0n,
      direction: 'in',
    });
  });

  it('gives no fee to a wallet that paid in beside others', () => {
    const shared = tx({
      vin: [
        { n: 0, addresses: [wallet], isAddress: true, value: '100000' },
        { n: 1, addresses: [other], isAddress: true, value: '50000' },
      ],
      vout: [{ value: '140000', n: 0, addresses: [other], isAddress: true }],
    });
    expect(parseTransaction(wallet, shared)).toMatchObject({ sentUnits: 100_000n, feeUnits: 0n });
  });

  it('skips a coinbase input and refuses a malformed transaction', () => {
    const mined = tx({ vin: [{ n: 0, coinbase: '03aabbcc', isAddress: false }], fees: '0' });
    expect(parseTransaction(wallet, mined)).toMatchObject({ receivedUnits: 100_000n });
    expect(parseTransaction(other.replace('X', 'Y'), tx())).toBeNull();
    for (const bad of [
      tx({ txid: 'nothex' }),
      tx({ blockHeight: -1 }),
      tx({ blockHash: undefined }),
      tx({ vout: [{ value: '1.5', n: 0, addresses: [wallet], isAddress: true }] }),
    ])
      expect(() => parseTransaction(wallet, bad)).toThrow();
  });
});

describe('ZCASH-SYNC Blockbook pages', () => {
  const range = { from: HEIGHT - 100, to: HEIGHT, page: 1 };
  const txs = (count: number) =>
    Array.from({ length: count }, (_, at) => tx({ txid: at.toString(16).padStart(64, '0') }));
  const body = (page: number, total: number, items: unknown[]) => ({
    page,
    totalPages: Math.ceil(total / BLOCKBOOK_PAGE_SIZE),
    itemsOnPage: BLOCKBOOK_PAGE_SIZE,
    address: wallet,
    balance: '0',
    txs: total,
    transactions: items,
  });

  it('reads a full page and the last one of a range', () => {
    expect(parsePage(wallet, range, body(1, 13, txs(10)))).toMatchObject({
      page: 1,
      totalPages: 2,
      total: 13,
      legs: expect.arrayContaining([expect.objectContaining({ receivedUnits: 100_000n })]),
    });
    expect(parsePage(wallet, { ...range, page: 2 }, body(2, 13, txs(3))).legs).toHaveLength(3);
  });

  it('reads an empty range', () => {
    expect(
      parsePage(wallet, range, { page: 1, totalPages: 0, address: wallet, txs: 0 }),
    ).toMatchObject({ totalPages: 0, legs: [] });
  });

  it('refuses a page that is not the one asked for or holds the wrong transactions', () => {
    for (const [ask, bad] of [
      // Blockbook moved a page past the end back to the last one.
      [{ ...range, page: 3 }, body(2, 13, txs(3))],
      [range, body(1, 13, txs(9))],
      [{ ...range, page: 2 }, body(2, 13, txs(4))],
      [range, { ...body(1, 13, txs(10)), totalPages: 5 }],
      [range, { ...body(1, 13, txs(10)), address: other }],
      [range, body(1, 13, [...txs(9), tx({ txid: hash('0') })])],
      [range, body(1, 3, [tx(), tx({ txid: hash('2') }), tx({ blockHeight: HEIGHT + 1 })])],
      [range, body(1, 0, txs(1))],
    ] as const)
      expect(() => parsePage(wallet, ask, bad)).toThrow();
  });

  it('reads the indexed tip only from an instance in sync', () => {
    expect(parseStatus({ blockbook: { coin: 'Zcash', bestHeight: HEIGHT, inSync: true } })).toBe(
      HEIGHT,
    );
    expect(() => parseStatus({ blockbook: { bestHeight: HEIGHT, inSync: false } })).toThrow();
  });
});

describe('ZCASH-SYNC Blockbook client', () => {
  let servers: Server[];
  let baseUrls: string[];
  let replies: { status: number; body: string }[][];
  let requests: { server: number; url: URL; headers: IncomingHttpHeaders }[];
  let warn: jest.SpyInstance;
  const client = (urls = baseUrls) =>
    new BlockbookClient({ baseUrls: urls, timeoutMs: 500, pauseMs: 0 });
  const json = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body) });

  beforeAll(async () => {
    servers = [0, 1].map((index) =>
      createServer((request, response) => {
        requests.push({
          server: index,
          url: new URL(request.url ?? '/', 'http://localhost'),
          headers: request.headers,
        });
        const reply = replies[index].shift() ?? { status: 500, body: '' };
        response.writeHead(reply.status, { 'content-type': 'application/json' });
        response.end(reply.body);
      }),
    );
    for (const server of servers) {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
    }
    baseUrls = servers.map(
      (server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    );
  });
  afterAll(async () => {
    for (const server of servers) {
      server.close();
      await once(server, 'close');
    }
  });
  beforeEach(() => {
    replies = [[], []];
    requests = [];
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('asks for one short page of a block range on a new connection', async () => {
    replies[0].push(
      json({ page: 2, totalPages: 2, address: wallet, txs: 11, transactions: [tx()] }),
    );
    await expect(client().page(wallet, HEIGHT - 9, HEIGHT, 2)).resolves.toMatchObject({
      ok: true,
      page: 2,
      totalPages: 2,
    });
    expect(requests[0].url.pathname).toBe(`/api/v2/address/${wallet}`);
    expect(Object.fromEntries(requests[0].url.searchParams)).toEqual({
      details: 'txs',
      from: String(HEIGHT - 9),
      to: String(HEIGHT),
      page: '2',
      pageSize: String(BLOCKBOOK_PAGE_SIZE),
    });
    expect(requests[0].headers.connection).toBe('close');
  });

  it('asks the next instance when the first is down', async () => {
    replies[0].push({ status: 502, body: 'bad gateway' });
    replies[1].push(json({ blockbook: { bestHeight: HEIGHT, inSync: true } }));
    await expect(client().status()).resolves.toEqual({ ok: true, height: HEIGHT });
    expect(requests.map(({ server, url }) => [server, url.pathname])).toEqual([
      [0, '/api'],
      [1, '/api'],
    ]);
  });

  it('stops at an instance that asks the app to slow down', async () => {
    replies[0].push({ status: 429, body: '' });
    await expect(client().status()).resolves.toEqual({ ok: false, reason: 'rate_limited' });
    expect(requests).toHaveLength(1);
  });

  it.each([
    ['500 everywhere', [{ status: 500, body: '' }], 'unavailable'],
    ['a body that is not JSON', [{ status: 200, body: '<html>' }], 'invalid_response'],
    [
      'an instance still indexing',
      [json({ blockbook: { bestHeight: HEIGHT, inSync: false } })],
      'invalid_response',
    ],
  ])('reports %s', async (_case, first, reason) => {
    replies[0].push(...first);
    await expect(client([baseUrls[0]]).status()).resolves.toEqual({ ok: false, reason });
  });

  it('logs what Blockbook said without the address or the hash', async () => {
    replies[0].push({ status: 503, body: `{"error":"down for ${wallet} at ${hash('a')}"}` });
    await client([baseUrls[0]]).page(wallet, 0, 1, 1);
    expect(warn.mock.calls).toEqual([
      ['Blockbook /api/v2/address/<id> answered 503: {"error":"down for <id> at <id>"}'],
    ]);
  });

  it('reports an unreachable instance as unavailable', async () => {
    await expect(client(['http://127.0.0.1:1']).status()).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(warn).toHaveBeenCalledWith('Blockbook /api failed: ECONNREFUSED');
  });
});
