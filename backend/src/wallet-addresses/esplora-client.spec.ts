import { once } from 'node:events';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EsploraClient, PAGE_SIZE, formatSats } from './esplora-client';

const owned = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const other = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';
const hex = (digit: string) => digit.repeat(64);
const status = (height: number) => ({
  confirmed: true,
  block_height: height,
  block_hash: hex('b'),
  block_time: 1700000000 + height,
});
const output = (address: string | null, value: number | string) => ({
  scriptpubkey: '0014deadbeef',
  scriptpubkey_asm: 'OP_0 OP_PUSHBYTES_20 deadbeef',
  scriptpubkey_type: address ? 'v0_p2wpkh' : 'op_return',
  ...(address ? { scriptpubkey_address: address } : {}),
  value,
});
const input = (address: string, value: number, txid = hex('9')) => ({
  txid,
  vout: 0,
  prevout: output(address, value),
  scriptsig: '',
  scriptsig_asm: '',
  witness: ['30440220', '02ab'],
  is_coinbase: false,
  sequence: 4294967293,
});
const tx = (txid: string, vin: unknown[], vout: unknown[], fee: number, height: number) => ({
  txid,
  version: 2,
  locktime: 0,
  vin,
  vout,
  size: 222,
  weight: 561,
  fee,
  status: status(height),
});

// Newest first, as Esplora returns them.
const receive = tx(hex('1'), [input(other, 1_000_000)], [output(owned, 150_000), output(other, 849_000)], 1_000, 840_004);
const spendWithChange = tx(
  hex('2'),
  [input(owned, 50_000), input(owned, 7_000, hex('8')), input(other, 9_000)],
  [output(other, 60_000), output(owned, 5_700), output(null, 0)],
  300,
  840_003,
);
const selfTransfer = tx(hex('3'), [input(owned, 20_000)], [output(owned, 19_800)], 200, 840_002);
const coinbase = tx(
  hex('4'),
  [{ txid: hex('0'), vout: 4294967295, prevout: null, scriptsig: '03', scriptsig_asm: '', is_coinbase: true, sequence: 4294967295 }],
  [output(owned, 312_500_000), output(null, 0)],
  0,
  840_001,
);
const unrelatedOutputOnly = tx(hex('5'), [input(other, 3_000)], [output(other, 2_000)], 1_000, 840_000);

type Reply = { status: number; body: string; delayMs?: number; headers?: Record<string, string> };

describe('Esplora adapter at the outbound HTTP boundary', () => {
  let server: Server;
  let baseUrl: string;
  let replies: Reply[];
  let requests: string[];
  const previousNoProxy = process.env.NO_PROXY;

  beforeAll(async () => {
    process.env.NO_PROXY = '127.0.0.1,localhost';
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      requests.push(`${request.method} ${request.url}`);
      const reply = replies.shift() ?? { status: 599, body: '{}' };
      const send = () => {
        response.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers });
        response.end(reply.body);
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });

  afterAll(async () => {
    process.env.NO_PROXY = previousNoProxy;
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  });

  beforeEach(() => {
    replies = [];
    requests = [];
  });

  const client = () => new EsploraClient({ baseUrl, timeoutMs: 300 });
  const json = (body: unknown, code = 200): Reply => ({ status: code, body: JSON.stringify(body) });

  it('ADDR-SYNC-PAGES requests the top chain page, then the page after a txid', async () => {
    replies.push(json([]), json([]));
    await client().page(owned, null);
    await client().page(owned, hex('a'));
    expect(requests).toEqual([
      `GET /api/address/${owned}/txs/chain`,
      `GET /api/address/${owned}/txs/chain/${hex('a')}`,
    ]);
  });

  it('ADDR-AMOUNTS derives exact per-address satoshis, fee and direction', async () => {
    replies.push(json([receive, spendWithChange, selfTransfer, coinbase]));
    const result = await client().page(owned, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.transactions.map(({ raw, ...row }) => ({
        ...row,
        receivedSats: row.receivedSats.toString(),
        sentSats: row.sentSats.toString(),
        feeSats: row.feeSats.toString(),
      })),
    ).toEqual([
      {
        txid: hex('1'),
        blockHeight: 840_004,
        blockHash: hex('b'),
        blockTime: new Date((1700000000 + 840_004) * 1000).toISOString(),
        receivedSats: '150000',
        sentSats: '0',
        feeSats: '1000',
        direction: 'in',
      },
      {
        txid: hex('2'),
        blockHeight: 840_003,
        blockHash: hex('b'),
        blockTime: new Date((1700000000 + 840_003) * 1000).toISOString(),
        receivedSats: '5700',
        sentSats: '57000',
        feeSats: '300',
        direction: 'out',
      },
      {
        txid: hex('3'),
        blockHeight: 840_002,
        blockHash: hex('b'),
        blockTime: new Date((1700000000 + 840_002) * 1000).toISOString(),
        receivedSats: '19800',
        sentSats: '20000',
        feeSats: '200',
        direction: 'self',
      },
      {
        txid: hex('4'),
        blockHeight: 840_001,
        blockHash: hex('b'),
        blockTime: new Date((1700000000 + 840_001) * 1000).toISOString(),
        receivedSats: '312500000',
        sentSats: '0',
        feeSats: '0',
        direction: 'in',
      },
    ]);
    expect(result.transactions[1].raw).toEqual(spendWithChange);
  });

  it('ADDR-AMOUNTS formats satoshis as exact 8-decimal BTC without floats', () => {
    expect(formatSats(0n)).toBe('0.00000000');
    expect(formatSats(1n)).toBe('0.00000001');
    expect(formatSats(918_359n)).toBe('0.00918359');
    expect(formatSats(-51_300n)).toBe('-0.00051300');
    expect(formatSats(2_100_000_000_000_000n)).toBe('21000000.00000000');
  });

  it.each([
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [400, 'unavailable'],
    [302, 'unavailable'],
  ] as const)('ADDR-SYNC-RESUME maps HTTP %d to %s', async (code, reason) => {
    replies.push({ status: code, body: '{}', headers: code === 302 ? { location: '/api/elsewhere' } : {} });
    await expect(client().page(owned, null)).resolves.toEqual({ ok: false, reason });
    expect(requests).toHaveLength(1);
  });

  it('ADDR-SYNC-RESUME maps a timeout to unavailable', async () => {
    replies.push({ status: 200, body: '[]', delayMs: 1_000 });
    await expect(client().page(owned, null)).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  const invalidBodies: [string, string][] = [
    ['non-JSON body', 'not json'],
    ['object instead of list', JSON.stringify({ txs: [] })],
    ['more than one page', JSON.stringify(Array.from({ length: PAGE_SIZE + 1 }, (_, i) => ({ ...receive, txid: i.toString(16).padStart(64, '0') })))],
    ['non-hex txid', JSON.stringify([{ ...receive, txid: 'z'.repeat(64) }])],
    ['upper-case txid', JSON.stringify([{ ...receive, txid: 'A'.repeat(64) }])],
    ['fractional value', JSON.stringify([{ ...receive, vout: [output(owned, 1.5)] }])],
    ['negative value', JSON.stringify([{ ...receive, vout: [output(owned, -1)] }])],
    ['string value', JSON.stringify([{ ...receive, vout: [output(owned, '150000')] }])],
    ['missing fee', JSON.stringify([{ ...receive, fee: undefined }])],
    ['unconfirmed transaction', JSON.stringify([{ ...receive, status: { confirmed: false } }])],
    ['bad block hash', JSON.stringify([{ ...receive, status: { ...status(1), block_hash: 'x' } }])],
    ['negative height', JSON.stringify([{ ...receive, status: { ...status(1), block_height: -1 } }])],
    ['duplicate txid in page', JSON.stringify([receive, receive])],
    ['transaction unrelated to the address', JSON.stringify([unrelatedOutputOnly])],
  ];
  it.each(invalidBodies)('ADDR-SYNC-INVALID rejects %s', async (_case, body) => {
    replies.push({ status: 200, body });
    await expect(client().page(owned, null)).resolves.toEqual({
      ok: false,
      reason: 'invalid_response',
    });
  });
});
