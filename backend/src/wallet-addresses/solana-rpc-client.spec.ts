import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { solanaMints } from './solana-legs';
import { SOLANA_SIGNATURE_PAGE_SIZE, SolanaRpcClient } from './solana-rpc-client';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Buffer): string {
  let number = BigInt(`0x${bytes.toString('hex')}`);
  let text = '';
  while (number > 0n) {
    text = ALPHABET[Number(number % 58n)] + text;
    number /= 58n;
  }
  return text;
}
// Synthetic keys, signatures and amounts only, never a real wallet.
const digest = (label: string) => createHash('sha256').update(`ct-test-sol:${label}`).digest();
const key = (label: string) => base58(digest(label));
const signature = (label: string) => base58(Buffer.concat([digest(label), digest(`${label}+`)]));
const wallet = key('wallet');
const other = key('other');
const walletUsdc = key('wallet-usdc');
const lookup = key('lookup-account');
const USDC = solanaMints[1];

const transaction = {
  slot: 300_000_123,
  blockTime: 1_760_000_000,
  version: 0,
  meta: {
    err: null,
    fee: 5000,
    preBalances: [2_000_000_000, 2_039_280, 1, 7],
    postBalances: [1_999_995_000, 2_039_280, 1, 7],
    preTokenBalances: [
      {
        accountIndex: 1,
        mint: USDC,
        owner: wallet,
        programId: key('token-program'),
        uiTokenAmount: { amount: '100000000', decimals: 6, uiAmount: 100, uiAmountString: '100' },
      },
    ],
    postTokenBalances: [
      {
        accountIndex: 1,
        mint: USDC,
        owner: wallet,
        uiTokenAmount: { amount: '75000000', decimals: 6, uiAmount: 75, uiAmountString: '75' },
      },
    ],
    loadedAddresses: { writable: [], readonly: [lookup] },
    logMessages: [],
  },
  transaction: {
    signatures: [signature('one')],
    message: {
      accountKeys: [wallet, walletUsdc, other],
      header: { numRequiredSignatures: 1 },
      recentBlockhash: key('recent'),
      instructions: [],
    },
  },
};

describe('SOL-SYNC Solana JSON-RPC client', () => {
  let server: Server;
  let url: string;
  let replies: { status: number; body: string }[];
  let requests: { method: string; params: unknown[] }[];
  const client = () => new SolanaRpcClient({ url, timeoutMs: 500, pauseMs: 0 });
  const json = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body) });
  const ok = (result: unknown) => json({ jsonrpc: '2.0', id: 1, result });

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      const call = JSON.parse(body);
      expect([request.method, call.jsonrpc]).toEqual(['POST', '2.0']);
      requests.push({ method: call.method, params: call.params });
      const reply = replies.shift() ?? { status: 500, body: '' };
      response.writeHead(reply.status, { 'content-type': 'application/json' });
      response.end(reply.body);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(async () => {
    server.close();
    await once(server, 'close');
  });
  beforeEach(() => {
    replies = [];
    requests = [];
  });

  it('reads the finalized slot', async () => {
    replies.push(ok(300_000_200));
    await expect(client().slot()).resolves.toEqual({ ok: true, slot: 300_000_200 });
    expect(requests).toEqual([{ method: 'getSlot', params: [{ commitment: 'finalized' }] }]);
  });

  it('finds the wallet’s token accounts of one mint without their data', async () => {
    replies.push(
      ok({ context: { slot: 1 }, value: [{ pubkey: walletUsdc, account: { lamports: 1 } }] }),
    );
    await expect(client().tokenAccounts(wallet, { mint: USDC })).resolves.toEqual({
      ok: true,
      accounts: [walletUsdc],
    });
    expect(requests[0]).toEqual({
      method: 'getTokenAccountsByOwner',
      params: [
        wallet,
        { mint: USDC },
        { commitment: 'finalized', encoding: 'base64', dataSlice: { offset: 0, length: 0 } },
      ],
    });
  });

  it('TOKEN-ANY finds the wallet’s token accounts of every mint of one token program', async () => {
    replies.push(ok({ context: { slot: 1 }, value: [{ pubkey: walletUsdc, account: {} }] }));
    const programId = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    await expect(client().tokenAccounts(wallet, { programId })).resolves.toEqual({
      ok: true,
      accounts: [walletUsdc],
    });
    expect(requests[0].params.slice(0, 2)).toEqual([wallet, { programId }]);
  });

  it('reads one page of signatures, newest first, before a given one', async () => {
    replies.push(
      ok([
        { signature: signature('two'), slot: 300_000_200, blockTime: null, err: null },
        { signature: signature('one'), slot: 300_000_123, blockTime: 1_760_000_000, err: {} },
      ]),
    );
    await expect(client().signatures(wallet, signature('three'))).resolves.toEqual({
      ok: true,
      items: [
        { signature: signature('two'), slot: 300_000_200, blockTime: null },
        { signature: signature('one'), slot: 300_000_123, blockTime: 1_760_000_000 },
      ],
    });
    expect(requests[0]).toEqual({
      method: 'getSignaturesForAddress',
      params: [
        wallet,
        { commitment: 'finalized', limit: SOLANA_SIGNATURE_PAGE_SIZE, before: signature('three') },
      ],
    });
  });

  it('reads a versioned transaction with its lookup-table accounts and balances', async () => {
    replies.push(ok(transaction));
    const result = await client().transaction(signature('one'));
    expect(result).toEqual({
      ok: true,
      transaction: {
        signature: signature('one'),
        slot: 300_000_123,
        blockTime: 1_760_000_000,
        fee: 5000n,
        failed: false,
        accounts: [wallet, walletUsdc, other, lookup],
        preBalances: [2_000_000_000n, 2_039_280n, 1n, 7n],
        postBalances: [1_999_995_000n, 2_039_280n, 1n, 7n],
        preTokenBalances: [
          { accountIndex: 1, mint: USDC, owner: wallet, amount: 100_000_000n, decimals: 6 },
        ],
        postTokenBalances: [
          { accountIndex: 1, mint: USDC, owner: wallet, amount: 75_000_000n, decimals: 6 },
        ],
        raw: transaction,
      },
    });
    expect(requests[0]).toEqual({
      method: 'getTransaction',
      params: [
        signature('one'),
        { commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 0 },
      ],
    });
  });

  it('reads a legacy failed transaction whose balances name no owner', async () => {
    const { loadedAddresses: _loaded, ...meta } = transaction.meta;
    replies.push(
      ok({
        ...transaction,
        version: 'legacy',
        meta: {
          ...meta,
          err: { InstructionError: [0, 'Custom'] },
          preBalances: [1, 2, 3],
          postBalances: [1, 2, 3],
          preTokenBalances: [{ ...meta.preTokenBalances[0], owner: undefined }],
          postTokenBalances: null,
        },
      }),
    );
    const result = await client().transaction(signature('one'));
    expect(result.ok && result.transaction).toMatchObject({
      failed: true,
      accounts: [wallet, walletUsdc, other],
      preTokenBalances: [{ accountIndex: 1, mint: USDC, owner: null, amount: 100_000_000n }],
      postTokenBalances: [],
    });
  });

  it('treats a transaction the node has no record of as unavailable, never as empty', async () => {
    replies.push(ok(null));
    await expect(client().transaction(signature('one'))).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
      detail: '127.0.0.1 has no record of the transaction',
    });
  });

  // SYNC-DETAIL: a failed read says which node answered and how, with keys and signatures cut out.
  it.each([
    [
      'a rate limit error',
      { code: 429, message: 'Too many requests' },
      'rate_limited',
      'Too many requests',
    ],
    [
      'a rate limit message',
      { code: -32005, message: 'Rate limit exceeded' },
      'rate_limited',
      'Rate limit exceeded',
    ],
    [
      'another error',
      { code: -32009, message: 'Slot was skipped' },
      'unavailable',
      'Slot was skipped',
    ],
    [
      'an error naming an account',
      { code: -32602, message: `Invalid param: ${key('acct')}` },
      'unavailable',
      'Invalid param: …',
    ],
    [
      'an error naming a signature',
      { code: -32004, message: `Block not available for ${signature('one')}` },
      'unavailable',
      'Block not available for …',
    ],
    [
      'an error naming a hex key',
      { code: -32602, message: `bad key 0x${'ab'.repeat(32)} given` },
      'unavailable',
      'bad key … given',
    ],
    [
      'an error with control characters',
      { code: -32000, message: 'line one\nline\ttwo\u0000' },
      'unavailable',
      'line one line two',
    ],
    [
      'a long error',
      { code: -32000, message: 'word '.repeat(80) },
      'unavailable',
      'word '.repeat(32).trim(),
    ],
  ] as const)(
    'maps %s to its reason, with the node named and its words cut short',
    async (_case, error, reason, said) => {
      replies.push(json({ jsonrpc: '2.0', id: 1, error }));
      await expect(client().slot()).resolves.toEqual({
        ok: false,
        reason,
        detail: `127.0.0.1 said: ${said}`,
      });
    },
  );

  it('SYNC-DETAIL says nothing beyond the reason when a node sends only blank words', async () => {
    replies.push(json({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: ' \n ' } }));
    await expect(client().slot()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it.each([
    [429, 'rate_limited', '127.0.0.1 limits requests'],
    [403, 'unavailable', '127.0.0.1 answered HTTP 403'],
    [500, 'unavailable', '127.0.0.1 answered HTTP 500'],
  ] as const)(
    'maps HTTP %d to %s, naming the node and the status',
    async (status, reason, detail) => {
      replies.push(json({}, status));
      await expect(client().signatures(wallet, null)).resolves.toEqual({
        ok: false,
        reason,
        detail,
      });
    },
  );

  it('SYNC-DETAIL names the node and the error when it does not answer', async () => {
    const closed = new SolanaRpcClient({ url: 'http://127.0.0.1:1/', timeoutMs: 500, pauseMs: 0 });
    await expect(closed.slot()).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
      detail: expect.stringMatching(/^127\.0\.0\.1 did not answer \(E[A-Z]+\)$/),
    });
  });

  const invalidTransactions: [string, unknown][] = [
    [
      'another signature',
      { ...transaction, transaction: { ...transaction.transaction, signatures: [signature('x')] } },
    ],
    ['a missing fee', { ...transaction, meta: { ...transaction.meta, fee: undefined } }],
    [
      'a fractional balance',
      { ...transaction, meta: { ...transaction.meta, preBalances: [1.5, 1, 1, 1] } },
    ],
    [
      'balances of other accounts',
      { ...transaction, meta: { ...transaction.meta, postBalances: [1] } },
    ],
    [
      'a bad account key',
      {
        ...transaction,
        transaction: {
          ...transaction.transaction,
          message: { ...transaction.transaction.message, accountKeys: ['0x00'] },
        },
      },
    ],
    [
      'a negative token amount',
      {
        ...transaction,
        meta: {
          ...transaction.meta,
          postTokenBalances: [
            { accountIndex: 1, mint: USDC, owner: wallet, uiTokenAmount: { amount: '-1' } },
          ],
        },
      },
    ],
    [
      'a token account out of range',
      {
        ...transaction,
        meta: {
          ...transaction.meta,
          postTokenBalances: [
            { accountIndex: 9, mint: USDC, owner: wallet, uiTokenAmount: { amount: '1' } },
          ],
        },
      },
    ],
    ['a missing block time', { ...transaction, blockTime: null }],
  ];
  it.each(invalidTransactions)('refuses a transaction with %s', async (_case, result) => {
    replies.push(ok(result));
    await expect(client().transaction(signature('one'))).resolves.toEqual({
      ok: false,
      reason: 'invalid_response',
      detail: '127.0.0.1 sent an unexpected answer',
    });
  });

  it.each([
    ['a body that is not JSON-RPC', []],
    ['a short signature', { result: [{ signature: 'abc', slot: 1, blockTime: null }] }],
    ['a negative slot', { result: [{ signature: signature('one'), slot: -1, blockTime: null }] }],
    [
      'more than a page',
      {
        result: Array(SOLANA_SIGNATURE_PAGE_SIZE + 1).fill({
          signature: signature('one'),
          slot: 1,
          blockTime: null,
        }),
      },
    ],
  ])('refuses signatures with %s', async (_case, body) => {
    replies.push(json(body));
    await expect(client().signatures(wallet, null)).resolves.toEqual({
      ok: false,
      reason: 'invalid_response',
      detail: '127.0.0.1 sent an unexpected answer',
    });
  });
});
