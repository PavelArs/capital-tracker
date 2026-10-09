import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import {
  HORIZON_PAYMENT_PAGE_SIZE,
  HORIZON_TRANSACTION_PAGE_SIZE,
  HorizonClient,
  parseBalance,
  parseMergeEffects,
  parsePayment,
  parseTransaction,
  stroops,
} from './horizon-client';
import { crc16 } from './stellar-address';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function strKey(key: Buffer): string {
  const payload = Buffer.concat([Buffer.from([6 << 3]), key]);
  const checksum = Buffer.alloc(2);
  checksum.writeUInt16LE(crc16(payload));
  let bits = '';
  for (const byte of Buffer.concat([payload, checksum])) bits += byte.toString(2).padStart(8, '0');
  let text = '';
  for (let at = 0; at < bits.length; at += 5)
    text += ALPHABET[Number.parseInt(bits.slice(at, at + 5), 2)];
  return text;
}
// Synthetic accounts, hashes and amounts only.
const account = (label: string) =>
  strKey(createHash('sha256').update(`ct-test-stellar:${label}`).digest());
const wallet = account('wallet');
const other = account('other');
const hash = (digit: string) => digit.repeat(64);
const LEDGER = 50_000_000;
// TOID: ledger << 32 | transaction order << 12 | operation index.
const toid = (order: number, operation = 0) =>
  ((BigInt(LEDGER) << 32n) | (BigInt(order) << 12n) | BigInt(operation)).toString();

const transaction = {
  _links: { self: { href: 'https://horizon.example/transactions/1' } },
  id: hash('1'),
  paging_token: toid(3),
  successful: true,
  hash: hash('1'),
  ledger: LEDGER,
  created_at: '2026-10-01T10:00:00Z',
  source_account: wallet,
  source_account_sequence: '1',
  fee_account: wallet,
  fee_charged: '100',
  max_fee: '1000',
  operation_count: 1,
  envelope_xdr: 'AAAA',
  result_xdr: 'AAAA',
  result_meta_xdr: 'AAAA',
  fee_meta_xdr: 'AAAA',
  memo_type: 'none',
};
const payment = {
  id: toid(3, 1),
  paging_token: toid(3, 1),
  transaction_successful: true,
  source_account: wallet,
  type: 'payment',
  type_i: 1,
  created_at: '2026-10-01T10:00:00Z',
  transaction_hash: hash('1'),
  asset_type: 'native',
  from: wallet,
  to: other,
  amount: '12.5000000',
};

describe('STELLAR-SYNC Horizon responses', () => {
  it('reads amounts with up to seven decimals as stroops', () => {
    expect(stroops('12.5000000')).toBe(125_000_000n);
    expect(stroops('0.0000001')).toBe(1n);
    expect(stroops('3')).toBe(30_000_000n);
    for (const bad of ['-1.0', '1.00000001', '01.0', '1e5', 7])
      expect(() => stroops(bad)).toThrow();
  });

  it('reads a transaction with its fee payer and keeps it without the XDR', () => {
    expect(parseTransaction(transaction)).toEqual({
      hash: hash('1'),
      toid: BigInt(toid(3)),
      ledger: LEDGER,
      createdAt: '2026-10-01T10:00:00.000Z',
      successful: true,
      feeAccount: wallet,
      feeCharged: 100n,
      raw: expect.not.objectContaining({ envelope_xdr: expect.anything() }),
    });
    // A fee bump: another account paid; an older Horizon writes the fee as a number.
    expect(
      parseTransaction({ ...transaction, fee_account: other, fee_charged: 200 }),
    ).toMatchObject({ feeAccount: other, feeCharged: 200n });
  });

  it('refuses a transaction whose order ID names another ledger', () => {
    expect(() => parseTransaction({ ...transaction, ledger: LEDGER + 1 })).toThrow();
    expect(() => parseTransaction({ ...transaction, paging_token: toid(3, 1) })).toThrow();
  });

  it('reads the XLM each kind of payment operation moves', () => {
    expect(parsePayment(payment)).toMatchObject({
      id: BigInt(toid(3, 1)),
      transaction: BigInt(toid(3)),
      hash: hash('1'),
      moves: [{ from: wallet, to: other, units: 125_000_000n }],
      merge: null,
    });
    // An issued asset (USDC on Stellar) is not tracked.
    expect(parsePayment({ ...payment, asset_type: 'credit_alphanum4' }).moves).toEqual([]);
    expect(
      parsePayment({
        ...payment,
        type: 'create_account',
        funder: other,
        account: wallet,
        starting_balance: '5.0000000',
      }).moves,
    ).toEqual([{ from: other, to: wallet, units: 50_000_000n }]);
    expect(
      parsePayment({
        ...payment,
        type: 'path_payment_strict_send',
        asset_type: 'credit_alphanum4',
        source_asset_type: 'native',
        source_amount: '2.0000000',
      }).moves,
    ).toEqual([{ from: wallet, to: '', units: 20_000_000n }]);
    expect(
      parsePayment({ ...payment, type: 'account_merge', account: other, into: wallet }),
    ).toMatchObject({ moves: [], merge: { from: other, into: wallet } });
    expect(
      parsePayment({
        ...payment,
        type: 'invoke_host_function',
        asset_balance_changes: [
          { asset_type: 'native', type: 'transfer', from: other, to: wallet, amount: '1.0000000' },
          {
            asset_type: 'native',
            type: 'transfer',
            from: wallet,
            to: `C${'A'.repeat(55)}`,
            amount: '0.5000000',
          },
          {
            asset_type: 'credit_alphanum4',
            type: 'transfer',
            from: other,
            to: wallet,
            amount: '9.0000000',
          },
        ],
      }).moves,
    ).toEqual([
      { from: other, to: wallet, units: 10_000_000n },
      { from: wallet, to: '', units: 5_000_000n },
    ]);
  });

  it('refuses an operation of a failed transaction', () => {
    expect(() => parsePayment({ ...payment, transaction_successful: false })).toThrow();
  });

  it('reads the amount a merge moved from its effects', () => {
    const effects = {
      _embedded: {
        records: [
          { type: 'account_debited', account: other, asset_type: 'native', amount: '7.0000000' },
          { type: 'account_credited', account: wallet, asset_type: 'native', amount: '7.0000000' },
          { type: 'account_removed', account: other },
        ],
      },
    };
    expect(parseMergeEffects(effects, wallet)).toBe(70_000_000n);
    expect(() => parseMergeEffects(effects, other)).toThrow();
  });

  it('STELLAR-REPORTED: reads the XLM balance among the account balances', () => {
    expect(
      parseBalance({
        balances: [
          { asset_type: 'credit_alphanum4', asset_code: 'USDC', balance: '10.0000000' },
          { asset_type: 'native', balance: '25.1234567' },
        ],
      }),
    ).toBe(251_234_567n);
  });
});

describe('STELLAR-SYNC Horizon client', () => {
  let server: Server;
  let baseUrl: string;
  let replies: { status: number; body: string }[];
  let requests: { url: URL; headers: IncomingHttpHeaders }[];
  let warn: jest.SpyInstance;
  const client = () => new HorizonClient({ baseUrl, timeoutMs: 500, pauseMs: 0 });
  const json = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body) });
  const page = (records: unknown[]) => json({ _links: {}, _embedded: { records } });

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests.push({
        url: new URL(request.url ?? '/', 'http://localhost'),
        headers: request.headers,
      });
      const reply = replies.shift() ?? { status: 500, body: '' };
      response.writeHead(reply.status, { 'content-type': 'application/hal+json' });
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

  it('asks for short pages oldest first after the cursor, failed transactions included', async () => {
    replies.push(page([transaction]), page([payment]));
    const reader = client();
    await expect(reader.transactions(wallet, 7n)).resolves.toMatchObject({
      ok: true,
      items: [{ hash: hash('1') }],
    });
    await expect(reader.payments(wallet, null)).resolves.toMatchObject({
      ok: true,
      items: [{ hash: hash('1') }],
    });
    expect(requests[0].url.pathname).toBe(`/accounts/${wallet}/transactions`);
    expect(Object.fromEntries(requests[0].url.searchParams)).toEqual({
      order: 'asc',
      limit: String(HORIZON_TRANSACTION_PAGE_SIZE),
      include_failed: 'true',
      cursor: '7',
    });
    expect(requests[1].url.pathname).toBe(`/accounts/${wallet}/payments`);
    expect(Object.fromEntries(requests[1].url.searchParams)).toEqual({
      order: 'asc',
      limit: String(HORIZON_PAYMENT_PAGE_SIZE),
    });
    expect(requests.map(({ headers }) => headers.connection)).toEqual(['close', 'close']);
  });

  it('reads an account that never existed as no history and no balance', async () => {
    replies.push(json({ status: 404 }, 404), json({ status: 404 }, 404));
    await expect(client().transactions(wallet, null)).resolves.toEqual({ ok: true, items: [] });
    await expect(client().balance(wallet)).resolves.toEqual({ ok: true, units: 0n });
  });

  it('reads the balance and a merge amount', async () => {
    replies.push(
      json({ balances: [{ asset_type: 'native', balance: '1.0000000' }] }),
      page([
        { type: 'account_credited', account: wallet, asset_type: 'native', amount: '2.0000000' },
      ]),
    );
    await expect(client().balance(wallet)).resolves.toEqual({ ok: true, units: 10_000_000n });
    await expect(client().mergeAmount(BigInt(toid(3, 1)), wallet)).resolves.toEqual({
      ok: true,
      units: 20_000_000n,
    });
    expect(requests[1].url.pathname).toBe(`/operations/${toid(3, 1)}/effects`);
  });

  it.each([
    ['429', { status: 429, body: '' }, 'rate_limited'],
    ['500', { status: 500, body: '' }, 'unavailable'],
    ['a body that is not JSON', { status: 200, body: '<html>' }, 'invalid_response'],
    ['a page longer than asked', page(Array(6).fill(transaction)), 'invalid_response'],
  ])('reports %s', async (_case, reply, reason) => {
    replies.push(reply);
    await expect(client().transactions(wallet, null)).resolves.toEqual({ ok: false, reason });
  });

  it('logs what Horizon said without the address or the hash', async () => {
    replies.push({ status: 503, body: `{"detail":"down for ${wallet} at ${hash('a')}"}` });
    await client().transactions(wallet, null);
    expect(warn.mock.calls).toEqual([
      ['Horizon /accounts/<id>/transactions answered 503: {"detail":"down for <id> at <id>"}'],
    ]);
  });

  it('reports an unreachable API as unavailable', async () => {
    const closed = new HorizonClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500, pauseMs: 0 });
    await expect(closed.balance(wallet)).resolves.toEqual({ ok: false, reason: 'unavailable' });
    expect(warn).toHaveBeenCalledWith('Horizon /accounts/<id> failed: ECONNREFUSED');
  });
});
