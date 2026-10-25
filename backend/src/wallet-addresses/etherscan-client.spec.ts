import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ETHERSCAN_PAGE_SIZE, EtherscanClient } from './etherscan-client';

// Synthetic addresses, hashes and amounts only; the key is a placeholder.
const owned = `0x${'a1'.repeat(20)}`;
const other = `0x${'b2'.repeat(20)}`;
const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const key = 'synthetic-etherscan-key';
const normal = {
  blockNumber: '20000001',
  timeStamp: '1720000000',
  hash: hash('1'),
  nonce: '7',
  blockHash: hash('b'),
  transactionIndex: '3',
  from: other.toUpperCase().replace('0X', '0x'),
  to: owned,
  value: '1500000000000000000',
  gas: '21000',
  gasPrice: '20000000000',
  isError: '0',
  txreceipt_status: '1',
  input: '0x',
  contractAddress: '',
  cumulativeGasUsed: '100000',
  gasUsed: '21000',
  confirmations: '100',
};
const transfer = {
  blockNumber: '20000002',
  timeStamp: '1720000012',
  hash: hash('2'),
  nonce: '8',
  blockHash: hash('c'),
  from: owned,
  contractAddress: usdc,
  to: other,
  value: '250000000',
  tokenName: 'USD Coin',
  tokenSymbol: 'USDC',
  tokenDecimal: '6',
  transactionIndex: '4',
  gas: '65000',
  gasPrice: '20000000000',
  gasUsed: '45000',
  cumulativeGasUsed: '200000',
  input: 'deprecated',
  confirmations: '99',
  logIndex: '17',
};

describe('ETH-SYNC Etherscan client', () => {
  let server: Server;
  let baseUrl: string;
  let replies: {
    status: number;
    body: string;
    location?: string;
    headers?: Record<string, string>;
  }[];
  let requests: URL[];
  const client = (apiKey: string | null = key) =>
    new EtherscanClient({ apiKey, baseUrl, timeoutMs: 500, pauseMs: 0 });
  const json = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body) });
  const ok = (result: unknown[]) => json({ status: '1', message: 'OK', result });

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests.push(new URL(request.url ?? '/', 'http://localhost'));
      const reply = replies.shift() ?? { status: 500, body: '' };
      response.writeHead(reply.status, {
        'content-type': 'application/json',
        ...(reply.location ? { location: reply.location } : {}),
        ...reply.headers,
      });
      response.end(reply.body);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v2/api`;
  });
  afterAll(async () => {
    server.close();
    await once(server, 'close');
  });
  beforeEach(() => {
    replies = [];
    requests = [];
  });

  it('asks nothing without a key and says what the server misses', async () => {
    const unconfigured = client(null);
    expect(unconfigured.configured).toBe(false);
    expect(new EtherscanClient({ apiKey: '  ' }).configured).toBe(false);
    await expect(unconfigured.normal(owned, 0, 10)).resolves.toEqual({
      ok: false,
      reason: 'not_configured',
    });
    await expect(unconfigured.blockNumber()).resolves.toEqual({
      ok: false,
      reason: 'not_configured',
    });
    expect(requests).toHaveLength(0);
  });

  it('EVM-MULTICHAIN asks for the chain it was made for with the same key, and mainnet otherwise', async () => {
    replies.push(ok([]), ok([]), ok([]));
    await client().normal(owned, 1, 2);
    await client().forChain(8453).normal(owned, 1, 2);
    await client().forChain(42161).blockNumber();
    expect(requests.map((request) => request.searchParams.get('chainid'))).toEqual([
      '1',
      '8453',
      '42161',
    ]);
    expect(requests.map((request) => request.searchParams.get('apikey'))).toEqual([key, key, key]);
    expect(new EtherscanClient({ apiKey: null }).forChain(10).configured).toBe(false);
  });

  it('EVM-MULTICHAIN paces the calls of every chain together, as the key allows a few a second', async () => {
    replies.push(ok([]), ok([]), ok([]));
    const paced = new EtherscanClient({ apiKey: key, baseUrl, timeoutMs: 500, pauseMs: 60 });
    const started = Date.now();
    await paced.normal(owned, 1, 2);
    await paced.forChain(10).normal(owned, 1, 2);
    await paced.forChain(8453).normal(owned, 1, 2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(110);
  });

  it('reads one block range of mainnet history oldest first with the key', async () => {
    replies.push(ok([normal]));
    const result = await client().normal(owned, 19_000_000, 20_000_100);
    expect(result).toEqual({
      ok: true,
      items: [
        {
          hash: hash('1'),
          blockNumber: 20000001,
          timeStamp: 1720000000,
          blockHash: hash('b'),
          from: other,
          to: owned,
          value: 1_500_000_000_000_000_000n,
          fee: 420_000_000_000_000n,
          failed: false,
          raw: normal,
        },
      ],
    });
    expect(requests[0].pathname).toBe('/v2/api');
    expect(Object.fromEntries(requests[0].searchParams)).toEqual({
      chainid: '1',
      module: 'account',
      action: 'txlist',
      address: owned,
      startblock: '19000000',
      endblock: '20000100',
      page: '1',
      offset: String(ETHERSCAN_PAGE_SIZE),
      sort: 'asc',
      apikey: key,
    });
  });

  it('reads token transfers with their event index and internal transfers', async () => {
    const inner = {
      blockNumber: '20000003',
      timeStamp: '1720000024',
      hash: hash('3'),
      from: other,
      to: owned,
      value: '10',
      contractAddress: '',
      input: '',
      type: 'call',
      gas: '2300',
      gasUsed: '0',
      traceId: '0_1',
      isError: '0',
      errCode: '',
    };
    replies.push(ok([transfer]), ok([inner]));
    const tokens = await client().tokens(owned, 1, 2);
    expect(tokens.ok && tokens.items[0]).toMatchObject({
      contract: usdc,
      logIndex: 17,
      value: 250_000_000n,
    });
    const internal = await client().internal(owned, 1, 2);
    expect(internal.ok && internal.items[0]).toMatchObject({ value: 10n, failed: false });
    expect(requests.map((url) => url.searchParams.get('action'))).toEqual([
      'tokentx',
      'txlistinternal',
    ]);
  });

  it('reads a token transfer without an event index', async () => {
    const { logIndex: _, ...documented } = transfer;
    replies.push(ok([documented]));
    const tokens = await client().tokens(owned, 1, 2);
    expect(tokens.ok && tokens.items[0].logIndex).toBeNull();
  });

  it('BLOCKSCOUT asks another explorer without a key or chain id, and reads its internal transfers', async () => {
    const inner = {
      blockNumber: '20000003',
      timeStamp: '1720000024',
      transactionHash: hash('3'),
      from: other,
      to: owned,
      value: '10',
      type: 'call',
      isError: '0',
      errCode: '',
    };
    replies.push(ok([inner]), json({ jsonrpc: '2.0', id: 1, result: '0x1312d00' }), ok([normal]));
    const scout = client(null).blockscout(baseUrl);
    expect(scout.configured).toBe(true);
    const internal = await scout.internal(owned, 1, 2);
    expect(internal.ok && internal.items[0]).toMatchObject({ hash: hash('3'), value: 10n });
    await expect(scout.blockNumber()).resolves.toEqual({ ok: true, block: 20_000_000 });
    await expect(scout.normal(owned, 1, 2)).resolves.toMatchObject({ ok: true });
    for (const url of requests) {
      expect(url.searchParams.has('apikey')).toBe(false);
      expect(url.searchParams.has('chainid')).toBe(false);
    }
    expect(requests[1].searchParams.get('module')).toBe('block');
    expect(requests[1].searchParams.get('action')).toBe('eth_block_number');
  });

  it('BLOCKSCOUT-KEY reads a chain through the PRO API with the key and the chain, when a key is set', async () => {
    replies.push(ok([normal]), ok([normal]));
    const withKey = new EtherscanClient({
      apiKey: null,
      blockscoutKey: ' synthetic-blockscout-key ',
      proUrl: baseUrl,
      timeoutMs: 500,
      pauseMs: 0,
    });
    // The chain's public explorer address is not asked at all while a key is set.
    const scout = withKey.blockscout('http://127.0.0.1:1/api', 10);
    await expect(scout.normal(owned, 1, 2)).resolves.toMatchObject({ ok: true });
    expect(requests[0].searchParams.get('apikey')).toBe('synthetic-blockscout-key');
    expect(requests[0].searchParams.get('chain_id')).toBe('10');
    expect(requests[0].searchParams.get('chainid')).toBe('10');
    expect(requests[0].searchParams.get('module')).toBe('account');
    // Without a key the public explorer is asked, with no key or chain in the query.
    const publicScout = client(null).blockscout(baseUrl, 10);
    await expect(publicScout.normal(owned, 1, 2)).resolves.toMatchObject({ ok: true });
    expect(requests[1].searchParams.has('apikey')).toBe(false);
    expect(requests[1].searchParams.has('chain_id')).toBe(false);
  });

  it('RATE-LIMIT names the host that limits requests and when its limit lifts', async () => {
    const host = new URL(baseUrl).hostname;
    replies.push(
      { ...json({}, 429), headers: { 'x-ratelimit-reset': '2281604' } },
      { ...json({}, 429), headers: { 'retry-after': '90' } },
      { ...json({}, 429), headers: { 'x-ratelimit-reset': '1790000000' } },
      json({}, 429),
    );
    const scout = client(null).blockscout(baseUrl);
    await expect(scout.normal(owned, 1, 2)).resolves.toEqual({
      ok: false,
      reason: 'rate_limited',
      detail: `${host} limits requests without a key (BLOCKSCOUT_API_KEY), its limit lifts in about 39 min`,
    });
    await expect(client().normal(owned, 1, 2)).resolves.toEqual({
      ok: false,
      reason: 'rate_limited',
      detail: `${host} limits requests, its limit lifts in about 2 min`,
    });
    // A clock time is not a duration: it is left out.
    await expect(client().normal(owned, 1, 2)).resolves.toMatchObject({
      detail: `${host} limits requests`,
    });
    await expect(client().normal(owned, 1, 2)).resolves.toMatchObject({
      detail: `${host} limits requests`,
    });
  });

  it('BLOCKSCOUT-KEY reads a PRO API token transfer, which carries transaction fields and no log index', async () => {
    // The shape Blockscout's PRO API answered for tokentx (synthetic values).
    const item = {
      value: '0',
      blockHash: hash('b'),
      blockNumber: '13904874',
      confirmations: '144170172',
      contractAddress: usdc,
      cumulativeGasUsed: '146327',
      from: other,
      functionName: '',
      gas: '185233',
      gasPrice: '1000000',
      gasUsed: '146327',
      hash: hash('4'),
      input: '0xa9059cbb',
      methodId: '',
      nonce: '11',
      timeStamp: '1657045484',
      to: owned,
      tokenDecimal: '18',
      tokenName: 'Synthetic token',
      tokenSymbol: 'SYN',
      transactionIndex: '0',
    };
    replies.push(json({ message: 'OK', result: [item], status: '1' }));
    const read = await client(null).blockscout(baseUrl).tokens(owned, 1, 2);
    expect(read.ok && read.items[0]).toMatchObject({
      hash: hash('4'),
      blockNumber: 13_904_874,
      logIndex: null,
      value: 0n,
    });
  });

  it('BLOCKSCOUT stops and says so when the explorer has not processed the range yet (status 2)', async () => {
    replies.push(
      json({
        message: 'Some internal transactions within this block range have not yet been processed',
        result: [],
        status: '2',
      }),
    );
    const host = new URL(baseUrl).hostname;
    await expect(client(null).blockscout(baseUrl).internal(owned, 1, 2)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
      detail: `${host} said: Some internal transactions within this block range have not yet been processed`,
      unprocessed: true,
    });
    // Some instances word the same warning with status 0 and the rows they have.
    replies.push(
      json({
        message: 'Some internal transactions within this block range have not yet been processed',
        result: [{ hash: 'partial' }],
        status: '0',
      }),
    );
    await expect(client(null).blockscout(baseUrl).internal(owned, 1, 2)).resolves.toMatchObject({
      ok: false,
      reason: 'unavailable',
      unprocessed: true,
    });
    // Any other status 2 is still not understood.
    replies.push(json({ message: 'Something else', result: [], status: '2' }));
    await expect(client(null).blockscout(baseUrl).internal(owned, 1, 2)).resolves.toMatchObject({
      ok: false,
      reason: 'invalid_response',
    });
  });

  it('BLOCKSCOUT reads an empty range however it words it', async () => {
    replies.push(
      json({ status: '0', message: 'No token transfers found', result: [] }),
      json({ status: '0', message: 'No internal transactions found', result: [] }),
    );
    await expect(client().tokens(owned, 1, 2)).resolves.toEqual({ ok: true, items: [] });
    await expect(client().internal(owned, 1, 2)).resolves.toEqual({ ok: true, items: [] });
  });

  it("NUTHATCH asks the owner's nest in Etherscan's own calls, with the chain and no key", async () => {
    replies.push(json({ jsonrpc: '2.0', id: 1, result: '0x1312d00' }), ok([normal]), ok([]));
    const nest = client(null).nuthatch(baseUrl, 56);
    expect(nest.configured).toBe(true);
    await expect(nest.blockNumber()).resolves.toEqual({ ok: true, block: 20_000_000 });
    await expect(nest.normal(owned, 1, 2)).resolves.toMatchObject({ ok: true });
    await expect(nest.tokens(owned, 1, 2)).resolves.toEqual({ ok: true, items: [] });
    expect(requests[0].searchParams.get('module')).toBe('proxy');
    expect(requests[0].searchParams.get('action')).toBe('eth_blockNumber');
    expect(requests[1].searchParams.get('action')).toBe('txlist');
    for (const url of requests) {
      expect(url.searchParams.get('chainid')).toBe('56');
      expect(url.searchParams.has('apikey')).toBe(false);
    }
  });

  it('NUTHATCH reads what a nest cannot answer as a failed read in its words, never as an empty list', async () => {
    // Refusals as nuthatch's /api words them: status "0" and the reason after its prefix.
    const refused = (result: string) => json({ status: '0', message: 'NOTOK', result });
    replies.push(
      refused("NUTHATCH_UNSUPPORTED: chainid 56 is not this nest's chain 43114"),
      refused(`NUTHATCH_INCOMPLETE: txlist for ${owned} is indexed through block 1, not 2`),
      // A nest quotes its own RPC's error, here one about that RPC's key.
      refused('NUTHATCH_INCOMPLETE: HTTP 401 Unauthorized: invalid API key'),
    );
    const host = new URL(baseUrl).hostname;
    const nest = client(null).nuthatch(baseUrl, 56);
    await expect(nest.blockNumber()).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
      detail: `${host} said: NUTHATCH_UNSUPPORTED: chainid 56 is not this nest's chain 43114`,
    });
    await expect(nest.normal(owned, 1, 2)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
      detail: `${host} said: NUTHATCH_INCOMPLETE: txlist for 0x… is indexed through block 1, not 2`,
    });
    await expect(nest.tokens(owned, 1, 2)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
      detail: `${host} said: NUTHATCH_INCOMPLETE: HTTP 401 Unauthorized: invalid API key`,
    });
  });

  it('SYNC-DETAIL says which source failed and how, without address-like text', async () => {
    replies.push(
      json({}, 404),
      json({ status: '0', message: 'NOTOK', result: `Invalid address ${owned} format` }),
      { status: 200, body: 'not json' },
    );
    const host = new URL(baseUrl).hostname;
    await expect(client().normal(owned, 1, 2)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
      detail: `${host} answered HTTP 404`,
    });
    await expect(client().normal(owned, 1, 2)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
      detail: `${host} said: Invalid address 0x… format`,
    });
    await expect(client().normal(owned, 1, 2)).resolves.toEqual({
      ok: false,
      reason: 'invalid_response',
      detail: `${host} sent an unexpected answer`,
    });
  });

  it('REDIRECT follows a redirect that stays on the same host and refuses one that leaves it', async () => {
    replies.push({ status: 301, body: '', location: `${baseUrl}/` }, ok([normal]), {
      status: 301,
      body: '',
      location: 'http://localhost:1/api',
    });
    await expect(client().normal(owned, 1, 2)).resolves.toMatchObject({ ok: true });
    const left = await client().normal(owned, 1, 2);
    expect(left).toEqual({
      ok: false,
      reason: 'unavailable',
      detail: '127.0.0.1 moved to localhost',
    });
    // The request that would have carried the key left for no other host.
    expect(requests).toHaveLength(3);
  });

  it('reads an empty range', async () => {
    replies.push(json({ status: '0', message: 'No transactions found', result: [] }));
    await expect(client().normal(owned, 1, 2)).resolves.toEqual({ ok: true, items: [] });
  });

  it('reads the newest block number', async () => {
    replies.push(json({ jsonrpc: '2.0', id: 83, result: '0x1312d00' }));
    await expect(client().blockNumber()).resolves.toEqual({ ok: true, block: 20_000_000 });
    expect(requests[0].searchParams.get('module')).toBe('proxy');
    expect(requests[0].searchParams.get('action')).toBe('eth_blockNumber');
  });

  it.each([
    [
      'a rate limit',
      { status: '0', message: 'NOTOK', result: 'Max rate limit reached' },
      'rate_limited',
    ],
    [
      'a refused key',
      { status: '0', message: 'NOTOK', result: 'Invalid API Key' },
      'not_configured',
    ],
    [
      'a missing key',
      { status: '0', message: 'NOTOK', result: 'Missing/Invalid API Key' },
      'not_configured',
    ],
    [
      'a chain outside the free plan',
      {
        status: '0',
        message: 'NOTOK',
        result:
          'Free API access is not supported for this chain. Please upgrade your api plan for full chain coverage.',
      },
      'plan_required',
    ],
    [
      'another refusal',
      { status: '0', message: 'NOTOK', result: 'Query Timeout occured' },
      'unavailable',
    ],
  ] as const)('maps %s', async (_case, body, reason) => {
    replies.push(json(body), json(body));
    await expect(client().normal(owned, 1, 2)).resolves.toMatchObject({ ok: false, reason });
    await expect(client().blockNumber()).resolves.toMatchObject({ ok: false, reason });
  });

  it.each([
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [403, 'unavailable'],
  ] as const)('maps HTTP %d to %s', async (status, reason) => {
    replies.push(json({}, status));
    await expect(client().normal(owned, 1, 2)).resolves.toMatchObject({ ok: false, reason });
  });

  const invalid: [string, unknown][] = [
    ['a body that is not an envelope', []],
    ['an unknown status', { status: '2', message: 'OK', result: [] }],
    ['a non-hex hash', { status: '1', message: 'OK', result: [{ ...normal, hash: '0xzz' }] }],
    ['a negative value', { status: '1', message: 'OK', result: [{ ...normal, value: '-1' }] }],
    ['a fractional value', { status: '1', message: 'OK', result: [{ ...normal, value: '1.5' }] }],
    ['a numeric value', { status: '1', message: 'OK', result: [{ ...normal, value: 15 }] }],
    ['a bad sender', { status: '1', message: 'OK', result: [{ ...normal, from: 'nobody' }] }],
    ['a missing fee', { status: '1', message: 'OK', result: [{ ...normal, gasUsed: undefined }] }],
    [
      'an unknown error flag',
      { status: '1', message: 'OK', result: [{ ...normal, isError: '2' }] },
    ],
    [
      'more than a page',
      { status: '1', message: 'OK', result: Array(ETHERSCAN_PAGE_SIZE + 1).fill(normal) },
    ],
  ];
  it.each(invalid)('refuses %s', async (_case, body) => {
    replies.push(json(body));
    await expect(client().normal(owned, 1, 2)).resolves.toMatchObject({
      ok: false,
      reason: 'invalid_response',
    });
  });

  it('refuses a block number that is not one', async () => {
    replies.push(json({ jsonrpc: '2.0', id: 83, result: 'latest' }), { status: 200, body: 'x' });
    await expect(client().blockNumber()).resolves.toMatchObject({
      ok: false,
      reason: 'invalid_response',
    });
    await expect(client().blockNumber()).resolves.toMatchObject({
      ok: false,
      reason: 'invalid_response',
    });
  });

  it('calls a contract as of a block and reads its answer or its revert', async () => {
    const word = `0x${'0'.repeat(48)}${'de0b6b3a7640000'.padStart(16, '0')}`;
    replies.push(
      json({ jsonrpc: '2.0', id: 1, result: word.toUpperCase().replace('0X', '0x') }),
      json({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'execution reverted' } }),
      json({ jsonrpc: '2.0', id: 1, result: '0x' }),
    );
    const data = `0x3af9e669${'0'.repeat(24)}${owned.slice(2)}`;
    await expect(client().call(other, data, 20_000_000)).resolves.toEqual({ ok: true, data: word });
    expect(Object.fromEntries(requests[0].searchParams)).toEqual({
      chainid: '1',
      module: 'proxy',
      action: 'eth_call',
      to: other,
      data,
      tag: '0x1312d00',
      apikey: key,
    });
    await expect(client().call(other, data, 1)).resolves.toEqual({ ok: true, data: null });
    await expect(client().call(other, data, 1)).resolves.toEqual({ ok: true, data: '0x' });
  });

  it.each([
    [
      'a refusal',
      { status: '0', message: 'NOTOK', result: 'Max rate limit reached' },
      'rate_limited',
    ],
    [
      'another node error',
      { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'missing trie node' } },
      'invalid_response',
    ],
    ['an odd hex answer', { jsonrpc: '2.0', id: 1, result: '0x123' }, 'invalid_response'],
    [
      'an oversized answer',
      { jsonrpc: '2.0', id: 1, result: `0x${'00'.repeat(4097)}` },
      'invalid_response',
    ],
  ] as const)('maps %s of a contract call', async (_case, body, reason) => {
    replies.push(json(body));
    await expect(client().call(other, '0x3af9e669', 1)).resolves.toMatchObject({
      ok: false,
      reason,
    });
  });
});
