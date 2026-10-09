import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { tronHex } from './tron-address';
import {
  parseAccount,
  parseAccountItem,
  parseInfo,
  parsePage,
  parseTokenTransfer,
  TRONGRID_TOKEN_PAGE_SIZE,
  TRONGRID_TRANSACTION_PAGE_SIZE,
  TronGridClient,
} from './trongrid-client';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest();
function base58check(payload: Buffer): string {
  const bytes = Buffer.concat([payload, sha256(sha256(payload)).subarray(0, 4)]);
  let number = BigInt(`0x${bytes.toString('hex')}`);
  let text = '';
  while (number > 0n) {
    text = ALPHABET[Number(number % 58n)] + text;
    number /= 58n;
  }
  return text;
}
// Synthetic accounts, hashes and amounts only; the key is a placeholder.
const address = (label: string) =>
  base58check(
    Buffer.concat([
      Buffer.from([0x41]),
      createHash('sha256').update(`ct-test-tron:${label}`).digest().subarray(0, 20),
    ]),
  );
const wallet = address('wallet');
const other = address('other');
const hex = (value: string) => tronHex(value) as string;
const hash = (digit: string) => digit.repeat(64);
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const key = 'synthetic-trongrid-key';

const transfer = {
  txID: hash('1'),
  blockNumber: 70_000_001,
  block_timestamp: 1_760_000_003_000,
  ret: [{ contractRet: 'SUCCESS', fee: 0 }],
  raw_data: {
    contract: [
      {
        type: 'TransferContract',
        parameter: {
          value: { amount: 1_500_000, owner_address: hex(other), to_address: hex(wallet) },
        },
      },
    ],
  },
};
const internal = {
  tx_id: hash('2'),
  block_timestamp: 1_760_000_006_000,
  internal_tx_id: hash('3'),
  from_address: hex(other),
  to_address: hex(wallet),
  data: { call_value: { _: 2_000_000 }, note: '63616c6c', rejected: false },
};
const token = {
  transaction_id: hash('4'),
  block_timestamp: 1_760_000_009_000,
  token_info: { symbol: 'USDT', address: USDT, decimals: 6, name: 'Tether USD' },
  from: wallet,
  to: other,
  type: 'Transfer',
  value: '25000000',
};

describe('TRON-SYNC TronGrid responses', () => {
  it('reads a transaction with its single contract and hex owner', () => {
    expect(parseAccountItem(transfer)).toEqual({
      kind: 'transaction',
      txid: hash('1'),
      blockNumber: 70_000_001,
      timestamp: 1_760_000_003_000,
      success: true,
      contractType: 'TransferContract',
      owner: hex(other),
      parameter: transfer.raw_data.contract[0].parameter.value,
      raw: transfer,
    });
  });

  it('marks a reverted contract as failed', () => {
    const reverted = { ...transfer, ret: [{ contractRet: 'REVERT' }] };
    expect(parseAccountItem(reverted)).toMatchObject({ success: false });
  });

  it('reads TRX a contract moved inside a transaction', () => {
    expect(parseAccountItem(internal)).toEqual({
      kind: 'internal',
      txid: hash('2'),
      timestamp: 1_760_000_006_000,
      from: hex(other),
      to: hex(wallet),
      units: 2_000_000n,
      rejected: false,
      raw: internal,
    });
  });

  it('reads a TRC-20 transfer with its contract', () => {
    expect(parseTokenTransfer(token)).toEqual({
      txid: hash('4'),
      timestamp: 1_760_000_009_000,
      contract: USDT,
      from: wallet,
      to: other,
      value: 25_000_000n,
      raw: token,
    });
  });

  it.each([
    ['two contracts', { ...transfer, raw_data: { contract: [{}, {}] } }],
    ['a short hash', { ...transfer, txID: 'ab' }],
    ['a negative block', { ...transfer, blockNumber: -1 }],
    ['a fractional amount', { ...internal, data: { call_value: { _: 1.5 } } }],
    ['a rejected flag that is not a boolean', { ...internal, data: { rejected: 'no' } }],
  ])('refuses an item with %s', (_case, item) => {
    expect(() => parseAccountItem(item)).toThrow();
  });

  it.each([
    ['a value that is not text', { ...token, value: 25 }],
    ['a sender that is not an address', { ...token, from: 'T123' }],
    ['no contract', { ...token, token_info: {} }],
  ])('refuses a token transfer with %s', (_case, item) => {
    expect(() => parseTokenTransfer(item)).toThrow();
  });

  it('reads a page and the fingerprint of the next', () => {
    expect(
      parsePage(
        { success: true, data: [token], meta: { fingerprint: 'next-1' } },
        parseTokenTransfer,
        TRONGRID_TOKEN_PAGE_SIZE,
      ),
    ).toMatchObject({ next: 'next-1', items: [{ txid: hash('4') }] });
    expect(parsePage({ success: true, data: [] }, parseTokenTransfer, 1)).toEqual({
      items: [],
      next: null,
    });
    expect(() => parsePage({ success: false, data: [] }, parseTokenTransfer, 1)).toThrow();
    // More items than the page asked for is an answer to another request.
    expect(() =>
      parsePage({ success: true, data: [token, token] }, parseTokenTransfer, 1),
    ).toThrow();
  });

  it('reads the fee, the outcome and the staking amounts the node recorded', () => {
    const info = {
      id: hash('5'),
      fee: 1_100_000,
      blockNumber: 70_000_002,
      blockTimeStamp: 1_760_000_012_000,
      receipt: { net_fee: 345_000, result: 'SUCCESS' },
      withdraw_amount: 3_200_000,
      withdraw_expire_amount: 50_000_000,
    };
    expect(parseInfo(info, hash('5'))).toEqual({
      txid: hash('5'),
      blockNumber: 70_000_002,
      timestamp: 1_760_000_012_000,
      fee: 1_100_000n,
      failed: false,
      withdrawAmount: 3_200_000n,
      unfreezeAmount: 0n,
      withdrawExpireAmount: 50_000_000n,
      raw: info,
    });
    expect(parseInfo({ ...info, receipt: { result: 'OUT_OF_ENERGY' } }, hash('5')).failed).toBe(
      true,
    );
    expect(parseInfo({ ...info, result: 'FAILED' }, hash('5')).failed).toBe(true);
    // An unknown or unconfirmed transaction is answered with {}.
    expect(() => parseInfo({}, hash('5'))).toThrow();
    expect(() => parseInfo(info, hash('6'))).toThrow();
  });

  it('TRON-STAKE-STATE: sums staked TRX by resource and lists pending unstakes', () => {
    const account = {
      address: wallet,
      balance: 905_100_000,
      frozenV2: [
        { amount: 300_000_000 },
        { type: 'ENERGY', amount: 700_000_000 },
        { type: 'TRON_POWER' },
      ],
      frozen: [{ frozen_balance: 5_000_000, expire_time: 1 }],
      account_resource: {
        frozen_balance_for_energy: { frozen_balance: 100_000_000 },
        delegated_frozenV2_balance_for_energy: 10_000_000,
      },
      delegated_frozenV2_balance_for_bandwidth: 20_000_000,
      unfrozenV2: [
        { type: 'ENERGY', unfreeze_amount: 40_000_000, unfreeze_expire_time: 1_761_000_000_000 },
        { unfreeze_amount: 60_000_000, unfreeze_expire_time: 1_760_500_000_000 },
        { unfreeze_amount: 0, unfreeze_expire_time: 1_760_400_000_000 },
      ],
    };
    expect(parseAccount(account)).toEqual({
      balance: 905_100_000n,
      energy: 810_000_000n,
      bandwidth: 325_000_000n,
      unstaking: [
        { units: 60_000_000n, availableAt: new Date(1_760_500_000_000).toISOString() },
        { units: 40_000_000n, availableAt: new Date(1_761_000_000_000).toISOString() },
      ],
    });
    // An account never activated is answered with {}.
    expect(parseAccount({})).toEqual({ balance: 0n, energy: 0n, bandwidth: 0n, unstaking: [] });
    expect(() => parseAccount({ frozenV2: [{ type: 'STORAGE', amount: 1 }] })).toThrow();
  });
});

describe('TRON-SYNC TronGrid client', () => {
  let server: Server;
  let baseUrl: string;
  let replies: { status: number; body: string }[];
  let requests: { url: URL; headers: IncomingHttpHeaders }[];
  let warn: jest.SpyInstance;
  const client = (apiKey: string | null = key) =>
    new TronGridClient({ apiKey, baseUrl, timeoutMs: 500, pauseMs: 0 });
  const json = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body) });

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests.push({
        url: new URL(request.url ?? '/', 'http://localhost'),
        headers: request.headers,
      });
      const reply = replies.shift() ?? { status: 500, body: '' };
      response.writeHead(reply.status, { 'content-type': 'application/json' });
      response.end(reply.body);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.close();
    await once(server, 'close');
  });
  beforeEach(() => {
    replies = [];
    requests = [];
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('asks for one time window of confirmed transactions oldest first, with the key', async () => {
    replies.push(json({ success: true, data: [transfer, internal], meta: { fingerprint: 'f2' } }));
    const result = await client().transactions(wallet, 1_000, 2_000, 'f1');
    expect(result).toMatchObject({
      ok: true,
      next: 'f2',
      items: [{ kind: 'transaction' }, { kind: 'internal' }],
    });
    const [{ url, headers }] = requests;
    expect(url.pathname).toBe(`/v1/accounts/${wallet}/transactions`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      only_confirmed: 'true',
      limit: String(TRONGRID_TRANSACTION_PAGE_SIZE),
      order_by: 'block_timestamp,asc',
      min_timestamp: '1000',
      max_timestamp: '2000',
      fingerprint: 'f1',
    });
    expect(headers['tron-pro-api-key']).toBe(key);
  });

  it('asks for one token contract and sends no key header without a key', async () => {
    replies.push(json({ success: true, data: [token] }));
    await expect(client(null).tokenTransfers(wallet, USDT, 0, 10, null)).resolves.toMatchObject({
      ok: true,
      next: null,
    });
    const [{ url, headers }] = requests;
    expect(url.pathname).toBe(`/v1/accounts/${wallet}/transactions/trc20`);
    expect(url.searchParams.get('contract_address')).toBe(USDT);
    expect(url.searchParams.get('limit')).toBe(String(TRONGRID_TOKEN_PAGE_SIZE));
    expect(url.searchParams.has('fingerprint')).toBe(false);
    expect(headers['tron-pro-api-key']).toBeUndefined();
  });

  it('reads the confirmed tip, the account and its unclaimed rewards', async () => {
    replies.push(
      json({ block_header: { raw_data: { number: 70_000_100, timestamp: 1_760_000_300_000 } } }),
    );
    replies.push(json({ balance: 1_000_000 }));
    replies.push(json({ reward: 3_200_000 }));
    await expect(client().tip()).resolves.toEqual({
      ok: true,
      tip: { number: 70_000_100, timestamp: 1_760_000_300_000 },
    });
    await expect(client().account(wallet)).resolves.toMatchObject({
      ok: true,
      account: { balance: 1_000_000n },
    });
    await expect(client().reward(wallet)).resolves.toEqual({ ok: true, units: 3_200_000n });
    expect(requests.map(({ url }) => url.pathname)).toEqual([
      '/walletsolidity/getblock',
      '/walletsolidity/getaccount',
      '/wallet/getReward',
    ]);
    expect(Object.fromEntries(requests[0].url.searchParams)).toEqual({ detail: 'false' });
    expect(requests[1].url.searchParams.get('visible')).toBe('true');
  });

  it('TRON-SYNC-SMALL: opens a new connection for every request', async () => {
    let connections = 0;
    const count = () => connections++;
    server.on('connection', count);
    try {
      const reader = client();
      for (let index = 0; index < 3; index++) {
        replies.push(json({ reward: 1 }));
        await expect(reader.reward(wallet)).resolves.toEqual({ ok: true, units: 1n });
      }
      expect([requests.length, connections]).toEqual([3, 3]);
      expect(requests.map(({ headers }) => headers.connection)).toEqual(Array(3).fill('close'));
    } finally {
      server.off('connection', count);
    }
  });

  it.each([
    ['429', { status: 429, body: '' }, 'rate_limited'],
    [
      '403 over the call limit',
      {
        status: 403,
        body: '{"Error":"request rate exceeded the allowed_rps(3), and the query server is suspended for 1s"}',
      },
      'rate_limited',
    ],
    [
      "403 over a key's limit",
      {
        status: 403,
        body: '{"Error":"The key exceeds the frequency limit(15), and the query server is suspended for 2s"}',
      },
      'rate_limited',
    ],
    [
      '403 for a refused key',
      { status: 403, body: '{"Error":"ApiKey not exists"}' },
      'not_configured',
    ],
    ['401', { status: 401, body: '' }, 'not_configured'],
    ['500', { status: 500, body: '' }, 'unavailable'],
    ['a body that is not JSON', { status: 200, body: '<html>' }, 'invalid_response'],
    ['a page TronGrid says failed', json({ success: false, data: [] }), 'invalid_response'],
  ])('reports %s', async (_case, reply, reason) => {
    replies.push(reply);
    await expect(client().transactions(wallet, 0, 1, null)).resolves.toEqual({ ok: false, reason });
  });

  it('TRON-SYNC-LOG: logs what TronGrid said without the address or the key', async () => {
    replies.push({
      status: 503,
      body: `{"Error":"service down for ${wallet} using ${key}"}`,
    });
    await expect(client().transactions(wallet, 0, 1, null)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    replies.push(json({ success: true, data: [] }));
    await client().transactions(wallet, 0, 1, null);
    expect(warn.mock.calls).toEqual([
      [
        'TronGrid /v1/accounts/<id>/transactions answered 503: {"Error":"service down for <id> using <key>"}',
      ],
    ]);
  });

  it('reports an unreachable API as unavailable', async () => {
    const closed = new TronGridClient({
      baseUrl: 'http://127.0.0.1:1',
      timeoutMs: 500,
      pauseMs: 0,
    });
    await expect(closed.tip()).resolves.toEqual({ ok: false, reason: 'unavailable' });
    expect(warn).toHaveBeenCalledWith('TronGrid /walletsolidity/getblock failed: ECONNREFUSED');
  });
});
