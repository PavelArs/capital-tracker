import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  BybitClient,
  parseCoinExchange,
  parseConvertHistory,
  parseDeposit,
  parseEarnPositions,
  parseEarnYield,
  parseEnvelope,
  parseExecution,
  parseFixedTermPositions,
  parseInternalDeposit,
  parseKeyInfo,
  parseWalletBalance,
  parseWithdrawal,
  sign,
} from './bybit-client';

// Synthetic keys, ids and amounts only (sync-bybit-account, M22); never an owner's account.
const key = { apiKey: 'SyntheticKey0001', apiSecret: 'SyntheticSecret000000000000001' };
const fill = {
  symbol: 'BTCUSDT',
  orderId: '1000000000000000001',
  execId: '2100000000000000001',
  side: 'Buy',
  orderType: 'Limit',
  execPrice: '65000',
  execQty: '0.01',
  execValue: '650',
  execFee: '0.00001',
  feeCurrency: 'BTC',
  execTime: '1720000000000',
  isMaker: false,
};
const readOnlyKey = {
  id: '100001',
  note: 'synthetic',
  apiKey: key.apiKey,
  readOnly: 1,
  secret: '',
  permissions: { ContractTrade: [], Spot: [], Wallet: [], Options: [], Exchange: [] },
  ips: ['*'],
  type: 1,
  deadlineDay: 90,
  expiredAt: '2026-12-31T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z',
  uta: 1,
  userID: 123456789,
  isMaster: true,
};

describe('BYBIT-KEY: what Bybit says about a key', () => {
  it('reads a read-only key of a unified main account, unbound and expiring', () => {
    expect(parseKeyInfo(readOnlyKey)).toEqual({
      userId: '123456789',
      readOnly: true,
      canWithdraw: false,
      unified: true,
      master: true,
      ipBound: false,
      expiresAt: '2026-12-31T00:00:00.000Z',
      earn: false,
      convert: false,
    });
  });

  it('knows whether the key may read convert history', () => {
    const permissions = { ...readOnlyKey.permissions, Exchange: ['ExchangeHistory'] };
    expect(parseKeyInfo({ ...readOnlyKey, permissions })).toMatchObject({ convert: true });
    expect(parseKeyInfo({ ...readOnlyKey, permissions: { Wallet: [] } })).toMatchObject({
      convert: false,
    });
  });

  it('knows whether the key may read Earn', () => {
    const permissions = { ...readOnlyKey.permissions, Earn: ['Earn'] };
    expect(parseKeyInfo({ ...readOnlyKey, permissions })).toMatchObject({ earn: true });
    expect(
      parseKeyInfo({ ...readOnlyKey, permissions: { ...permissions, Earn: [] } }),
    ).toMatchObject({ earn: false });
  });

  it('notices a trading key, a withdrawal permission, a sub-account and an IP binding', () => {
    expect(
      parseKeyInfo({
        ...readOnlyKey,
        readOnly: 0,
        permissions: { ...readOnlyKey.permissions, Wallet: ['AccountTransfer', 'Withdraw'] },
        ips: ['192.0.2.10'],
        isMaster: false,
        uta: 0,
      }),
    ).toMatchObject({
      readOnly: false,
      canWithdraw: true,
      unified: false,
      master: false,
      ipBound: true,
    });
  });

  it('refuses an answer it cannot read', () => {
    expect(() => parseKeyInfo({ ...readOnlyKey, readOnly: 'yes' })).toThrow();
    expect(() => parseKeyInfo({ ...readOnlyKey, userID: 'abc' })).toThrow();
    expect(() => parseKeyInfo([])).toThrow();
  });
});

describe('Bybit records', () => {
  it('reads a spot fill with its fee and time', () => {
    expect(parseExecution(fill)).toMatchObject({
      execId: fill.execId,
      symbol: 'BTCUSDT',
      side: 'Buy',
      execPrice: '65000',
      execQty: '0.01',
      execValue: '650',
      execFee: '0.00001',
      feeCurrency: 'BTC',
      execTime: 1720000000000,
    });
    // A maker rebate is a negative fee; an unknown side or an amount in exponent form is not read.
    expect(parseExecution({ ...fill, execFee: '-0.01', feeCurrency: 'USDT' }).execFee).toBe(
      '-0.01',
    );
    expect(() => parseExecution({ ...fill, side: 'buy' })).toThrow();
    expect(() => parseExecution({ ...fill, execQty: '1e-2' })).toThrow();
  });

  it('reads deposit states, and a pending deposit with no time yet', () => {
    const deposit = {
      coin: 'BTC',
      chain: 'BTC',
      amount: '0.5',
      txID: 'a'.repeat(64),
      status: 3,
      toAddress: 'synthetic',
      tag: '',
      depositFee: '',
      successAt: '1720000000000',
      confirmations: '3',
      txIndex: '0',
      blockHash: '',
      batchReleaseLimit: '-1',
      depositType: '0',
    };
    expect(parseDeposit(deposit)).toMatchObject({
      internal: false,
      state: 'done',
      time: 1720000000000,
    });
    expect(parseDeposit({ ...deposit, status: 10012 }).state).toBe('done');
    expect(parseDeposit({ ...deposit, status: 1, successAt: '' })).toMatchObject({
      state: 'pending',
      time: null,
    });
    expect(parseDeposit({ ...deposit, status: 4 }).state).toBe('failed');
    expect(() => parseDeposit({ ...deposit, status: 99 })).toThrow();
  });

  it('reads an internal deposit, whose time is in seconds', () => {
    expect(
      parseInternalDeposit({
        id: '9000001',
        type: 1,
        coin: 'USDT',
        amount: '25',
        status: 2,
        address: 'synthetic',
        createdTime: '1720000000',
        txID: '',
      }),
    ).toMatchObject({ internal: true, id: '9000001', state: 'done', time: 1720000000000 });
  });

  it('reads withdrawal states', () => {
    const withdrawal = {
      coin: 'BTC',
      chain: 'BTC',
      amount: '0.2',
      txID: 'b'.repeat(64),
      status: 'success',
      toAddress: 'synthetic',
      tag: '',
      withdrawFee: '0.0002',
      createTime: '1720000000000',
      updateTime: '1720000060000',
      withdrawId: '7000001',
      withdrawType: 0,
    };
    expect(parseWithdrawal(withdrawal)).toMatchObject({
      state: 'done',
      internal: false,
      amount: '0.2',
      withdrawFee: '0.0002',
    });
    expect(parseWithdrawal({ ...withdrawal, status: 'BlockchainConfirmed' }).state).toBe('done');
    expect(parseWithdrawal({ ...withdrawal, status: 'Reject' }).state).toBe('failed');
    expect(parseWithdrawal({ ...withdrawal, status: 'Pending', txID: '' }).state).toBe('pending');
  });

  it("maps Bybit's refusals: a key it does not accept, a rate limit, anything else", () => {
    expect(parseEnvelope({ retCode: 0, retMsg: 'OK', result: { list: [] } })).toEqual({
      list: [] as unknown[],
    });
    const refusal = (retCode: number) => {
      try {
        parseEnvelope({ retCode, retMsg: 'Synthetic refusal' });
      } catch (error) {
        return (error as { reason: string; detail: string }).reason;
      }
      return null;
    };
    expect(refusal(10003)).toBe('key_rejected');
    expect(refusal(10004)).toBe('key_rejected');
    expect(refusal(10005)).toBe('key_rejected');
    expect(refusal(33004)).toBe('key_rejected');
    expect(refusal(10006)).toBe('rate_limited');
    expect(refusal(10001)).toBe('unavailable');
  });
});

describe('BYBIT-EARN: Earn positions and yield', () => {
  it('reads what each Flexible Savings or On-chain position holds', () => {
    expect(
      parseEarnPositions({
        list: [
          { coin: 'USDT', productId: '428', amount: '1000.5', totalPnl: '', claimableYield: '0.1' },
          { coin: 'SOL', productId: '8', amount: '0', id: '326', status: 'Active' },
        ],
      }),
    ).toEqual([
      { coin: 'USDT', quantity: '1000.5' },
      { coin: 'SOL', quantity: '0' },
    ]);
    expect(() => parseEarnPositions({ list: [{ coin: 'USDT', amount: '-1' }] })).toThrow();
  });

  it('reads the active fixed-term positions', () => {
    expect(
      parseFixedTermPositions({
        list: [{ positionId: '4064', category: 'FixedTermSaving', coin: 'USDC', amount: '201' }],
      }),
    ).toEqual([{ coin: 'USDC', quantity: '201' }]);
  });

  it('reads yield records, under either name Bybit gives the list', () => {
    const item = {
      productId: '428',
      coin: 'USDT',
      id: '1002096',
      amount: '0.0608',
      yieldType: 'Normal',
      distributionMode: 'Auto',
      effectiveStakingAmount: '1000',
      orderId: '',
      status: 'Success',
      createdAt: '1759993805000',
    };
    const read = {
      id: '1002096',
      coin: 'USDT',
      amount: '0.0608',
      state: 'done',
      time: 1759993805000,
    };
    expect(parseEarnYield({ list: [item], nextPageCursor: 'next' })).toEqual({
      items: [{ ...read, raw: item }],
      cursor: 'next',
    });
    expect(
      parseEarnYield({
        yield: [
          { ...item, status: 'Pending' },
          { ...item, id: '1002097', status: 'Fail' },
        ],
        nextPageCursor: '',
      }),
    ).toMatchObject({ items: [{ state: 'pending' }, { state: 'failed' }], cursor: null });
    expect(() => parseEarnYield({ list: [{ ...item, amount: 'lots' }] })).toThrow();
  });
});

describe('BYBIT-CONVERT: converts and coin exchanges', () => {
  const convert = {
    accountType: 'funding',
    exchangeTxId: '10100108106409343501030232064',
    userId: '123456789',
    fromCoin: 'BTC',
    fromCoinType: 'crypto',
    fromAmount: '0.01',
    toCoin: 'USDT',
    toCoinType: 'crypto',
    toAmount: '650.5',
    exchangeStatus: 'success',
    extInfo: {},
    convertRate: '65050',
    createdAt: '1720071899995',
  };

  it('reads a convert with its state and time', () => {
    expect(parseConvertHistory({ list: [convert] })).toEqual([
      {
        id: '10100108106409343501030232064',
        fromCoin: 'BTC',
        fromAmount: '0.01',
        toCoin: 'USDT',
        toAmount: '650.5',
        state: 'done',
        time: 1720071899995,
        raw: convert,
      },
    ]);
    const states = ['init', 'processing', 'failure'].map(
      (exchangeStatus) => parseConvertHistory({ list: [{ ...convert, exchangeStatus }] })[0].state,
    );
    expect(states).toEqual(['pending', 'pending', 'failed']);
    expect(parseConvertHistory({})).toEqual([]);
    expect(() => parseConvertHistory({ list: [{ ...convert, exchangeStatus: 'odd' }] })).toThrow();
    expect(() =>
      parseConvertHistory({ list: [{ ...convert, exchangeTxId: 'x'.repeat(61) }] }),
    ).toThrow();
  });

  it('reads an older coin exchange, whose time is in seconds', () => {
    const exchange = {
      fromCoin: 'USDT',
      fromAmount: '100',
      toCoin: 'SOL',
      toAmount: '0.6',
      exchangeRate: '0.006',
      createdTime: '1700000000',
      exchangeTxId: '300000000000000001',
    };
    expect(parseCoinExchange(exchange)).toMatchObject({
      id: '300000000000000001',
      fromCoin: 'USDT',
      toCoin: 'SOL',
      state: 'done',
      time: 1700000000000,
    });
  });
});

describe('Bybit client', () => {
  let server: Server;
  let baseUrl: string;
  let replies: { status: number; body: string }[];
  let requests: { url: URL; headers: IncomingHttpHeaders }[];
  const client = () => new BybitClient({ baseUrl, timeoutMs: 500, pauseMs: 0 });
  const ok = (result: unknown) =>
    ({ status: 200, body: JSON.stringify({ retCode: 0, retMsg: 'OK', result }) }) as const;

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
  });

  it('signs timestamp, key, receive window and query string with the secret', async () => {
    replies.push(ok({ nextPageCursor: '', category: 'spot', list: [fill] }));
    const result = await client().executions(key, 1719990000000, 1720010000000, null);
    expect(result).toMatchObject({ ok: true, value: { cursor: null } });
    const [{ url, headers }] = requests;
    expect(url.pathname).toBe('/v5/execution/list');
    const query = url.search.slice(1);
    expect(query).toBe('category=spot&startTime=1719990000000&endTime=1720010000000&limit=100');
    const expected = createHmac('sha256', key.apiSecret)
      .update(`${headers['x-bapi-timestamp']}${key.apiKey}10000${query}`)
      .digest('hex');
    expect(headers['x-bapi-api-key']).toBe(key.apiKey);
    expect(headers['x-bapi-recv-window']).toBe('10000');
    expect(headers['x-bapi-sign']).toBe(expected);
    expect(sign(key.apiSecret, String(headers['x-bapi-timestamp']), key.apiKey, query)).toBe(
      expected,
    );
    // The secret itself never travels.
    expect(JSON.stringify(headers)).not.toContain(key.apiSecret);
    expect(url.search).not.toContain(key.apiSecret);
  });

  it('sends the page cursor back exactly as Bybit gave it', async () => {
    replies.push(ok({ nextPageCursor: '132766%3A2%2C132766%3A2', list: [fill] }));
    replies.push(ok({ nextPageCursor: '', list: [] }));
    const first = await client().executions(key, 1, 2, null);
    expect(first).toMatchObject({ ok: true, value: { cursor: '132766%3A2%2C132766%3A2' } });
    await client().executions(key, 1, 2, '132766%3A2%2C132766%3A2');
    expect(requests[1].url.search).toContain('&cursor=132766%3A2%2C132766%3A2');
  });

  it('reads the unified trading account from its wallet balance; a debt holds nothing', () => {
    const usdt = { coin: 'USDT', walletBalance: '250', equity: '250', locked: '0' };
    expect(
      parseWalletBalance({
        list: [
          {
            accountType: 'UNIFIED',
            coin: [
              usdt,
              { ...usdt, coin: 'BTC', walletBalance: '-0.01' },
              { coin: 'ETH', walletBalance: '' },
            ],
          },
        ],
      }),
    ).toEqual([
      { coin: 'USDT', quantity: '250' },
      { coin: 'BTC', quantity: '0' },
      { coin: 'ETH', quantity: '0' },
    ]);
    expect(parseWalletBalance({ list: [] })).toEqual([]);
    expect(() =>
      parseWalletBalance({ list: [{ coin: [{ ...usdt, walletBalance: '1e3' }] }] }),
    ).toThrow();
  });

  it('reads the withdrawals of every kind and the balances of one wallet', async () => {
    replies.push(ok({ rows: [], nextPageCursor: '' }));
    replies.push(
      ok({
        accountType: 'FUND',
        memberId: '123456789',
        balance: [{ coin: 'USDT', walletBalance: '12.5', transferBalance: '12.5', bonus: '' }],
      }),
    );
    await client().withdrawals(key, 1, 2, null);
    const balances = await client().balances(key, 'FUND');
    expect(requests[0].url.searchParams.get('withdrawType')).toBe('2');
    expect(requests[1].url.searchParams.get('accountType')).toBe('FUND');
    expect(balances).toEqual({ ok: true, value: [{ coin: 'USDT', quantity: '12.5' }] });
  });

  it('asks for the trading account where Bybit lists every coin of it', async () => {
    replies.push(
      ok({ list: [{ accountType: 'UNIFIED', coin: [{ coin: 'BTC', walletBalance: '0.5' }] }] }),
    );
    expect(await client().balances(key, 'UNIFIED')).toEqual({
      ok: true,
      value: [{ coin: 'BTC', quantity: '0.5' }],
    });
    expect(requests[0].url.pathname).toBe('/v5/account/wallet-balance');
    expect(requests[0].url.search).toBe('?accountType=UNIFIED');
  });

  it('asks for Earn positions per product and yield in seven-day windows', async () => {
    replies.push(ok({ list: [{ coin: 'USDT', amount: '10' }] }));
    replies.push(ok({ list: [] }));
    replies.push(ok({ list: [], nextPageCursor: '' }));
    expect(await client().earnPositions(key, 'FlexibleSaving')).toEqual({
      ok: true,
      value: [{ coin: 'USDT', quantity: '10' }],
    });
    await client().fixedTermPositions(key);
    await client().earnYield(key, 'OnChain', 1, 2, 'page2');
    expect(requests[0].url.pathname).toBe('/v5/earn/position');
    expect(requests[0].url.search).toBe('?category=FlexibleSaving');
    expect(requests[1].url.pathname).toBe('/v5/earn/fixed-term/position');
    expect(requests[2].url.pathname).toBe('/v5/earn/yield');
    expect(requests[2].url.search).toBe(
      '?category=OnChain&startTime=1&endTime=2&limit=100&cursor=page2',
    );
  });

  it('asks for converts page by page and coin exchanges by cursor', async () => {
    replies.push(ok({ list: [] }));
    replies.push(ok({ orderBody: [], nextPageCursor: '' }));
    replies.push(ok({}));
    expect(await client().convertHistory(key, 2)).toEqual({ ok: true, value: [] });
    expect(await client().coinExchanges(key, 'page2')).toEqual({
      ok: true,
      value: { items: [], cursor: null },
    });
    expect(await client().coinExchanges(key, null)).toEqual({
      ok: true,
      value: { items: [], cursor: null },
    });
    expect(requests[0].url.pathname).toBe('/v5/asset/exchange/query-convert-history');
    expect(requests[0].url.search).toBe('?index=2&limit=100');
    expect(requests[1].url.pathname).toBe('/v5/asset/exchange/order-record');
    expect(requests[1].url.search).toBe('?limit=50&cursor=page2');
    expect(requests[2].url.search).toBe('?limit=50');
  });

  it('says why nothing came back', async () => {
    replies.push({
      status: 200,
      body: JSON.stringify({ retCode: 10003, retMsg: 'API key is invalid.', result: {} }),
    });
    replies.push({ status: 403, body: '' });
    replies.push({ status: 200, body: 'not json' });
    replies.push(ok({ list: [{ ...fill, execQty: 'many' }] }));
    expect(await client().keyInfo(key)).toEqual({
      ok: false,
      reason: 'key_rejected',
      detail: 'Bybit answered: API key is invalid. (code 10003)',
    });
    expect(await client().keyInfo(key)).toMatchObject({ ok: false, reason: 'rate_limited' });
    expect(await client().keyInfo(key)).toMatchObject({ ok: false, reason: 'invalid_response' });
    expect(await client().executions(key, 1, 2, null)).toMatchObject({
      ok: false,
      reason: 'invalid_response',
    });
  });

  it('never sends a cursor that would change the signed text', async () => {
    expect(await client().executions(key, 1, 2, 'a&b=c')).toMatchObject({
      ok: false,
      reason: 'invalid_response',
    });
    expect(requests).toHaveLength(0);
  });
});
