import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decimal,
  isTBankToken,
  parseAccounts,
  parseOperationsPage,
  parsePositions,
  TBankClient,
} from './tbank-client';

// BROKER-CONNECT: synthetic tokens and ids only; never an owner's account.
const token = 't.SyntheticToken000000000000000001';
const account = (over: Record<string, unknown> = {}) => ({
  id: '2000000001',
  type: 'ACCOUNT_TYPE_TINKOFF',
  name: 'Synthetic account',
  status: 'ACCOUNT_STATUS_OPEN',
  openedDate: '2024-01-01T00:00:00Z',
  accessLevel: 'ACCOUNT_ACCESS_LEVEL_READ_ONLY',
  ...over,
});

// One operation as the REST gateway gives it: int64 as text, zero parts and empty fields left out.
const item = (over: Record<string, unknown> = {}) => ({
  id: '900000001',
  name: 'Synthetic operation',
  date: '2024-03-01T10:00:00.123456Z',
  type: 'OPERATION_TYPE_BUY',
  state: 'OPERATION_STATE_EXECUTED',
  instrumentUid: '00000000-0000-4000-8000-000000000001',
  figi: 'SYNTH0000001',
  instrumentType: 'share',
  ticker: 'SYNTH',
  payment: { currency: 'rub', units: '-200', nano: -500000000 },
  price: { currency: 'rub', units: '100', nano: 250000000 },
  commission: { currency: 'rub' },
  quantity: '2',
  quantityRest: '0',
  quantityDone: '2',
  ...over,
});

describe('BROKER-CONNECT: what T-Bank says about a token', () => {
  it('reads the accounts a token reaches and what it may do with each', () => {
    expect(
      parseAccounts({
        accounts: [
          account(),
          account({ id: '2000000002', status: 'ACCOUNT_STATUS_CLOSED' }),
          account({ id: '2000000003', accessLevel: 'ACCOUNT_ACCESS_LEVEL_FULL_ACCESS' }),
        ],
      }),
    ).toEqual([
      {
        id: '2000000001',
        name: 'Synthetic account',
        open: true,
        closed: false,
        access: 'read_only',
        investBox: false,
      },
      {
        id: '2000000002',
        name: 'Synthetic account',
        open: false,
        closed: true,
        access: 'read_only',
        investBox: false,
      },
      {
        id: '2000000003',
        name: 'Synthetic account',
        open: true,
        closed: false,
        access: 'full_access',
        investBox: false,
      },
    ]);
  });

  it('marks an Invest Box, whose portfolio T-Bank does not give', () => {
    const [box, broker] = parseAccounts({
      accounts: [account({ type: 'ACCOUNT_TYPE_INVEST_BOX' }), account()],
    });
    expect([box.investBox, broker.investBox]).toEqual([true, false]);
  });

  it('does not call an account closed unless T-Bank says so', () => {
    const [created, unknown] = parseAccounts({
      accounts: [account({ status: 'ACCOUNT_STATUS_NEW' }), account({ status: undefined })],
    });
    expect([created.open, created.closed, unknown.open, unknown.closed]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('treats a token the contract does not describe as able to trade', () => {
    expect(parseAccounts({ accounts: [account({ accessLevel: undefined })] })[0].access).toBe(
      'full_access',
    );
    expect(parseAccounts({ accounts: [account({ accessLevel: 'SOMETHING_NEW' })] })[0].access).toBe(
      'full_access',
    );
  });

  it('refuses a body that is not a list of accounts with plain ids', () => {
    expect(() => parseAccounts(null)).toThrow();
    expect(() => parseAccounts({})).toThrow();
    expect(() => parseAccounts({ accounts: [account({ id: 'a b' })] })).toThrow();
    expect(() => parseAccounts({ accounts: [account({ id: 5 })] })).toThrow();
  });

  it('accepts only a token of plain characters', () => {
    expect(isTBankToken(token)).toBe(true);
    expect(isTBankToken('short')).toBe(false);
    expect(isTBankToken(`${token} `)).toBe(false);
    expect(isTBankToken(`${token}\n`)).toBe(false);
    expect(isTBankToken(undefined)).toBe(false);
  });
});

describe('BROKER-CONNECT: prices and positions T-Bank gives', () => {
  const positionsOf = (body: unknown) => parsePositions(body, '2000000001');

  it('reads a Quotation or MoneyValue as exact decimal text', () => {
    expect(decimal({ units: '12', nano: 340_000_000 })).toBe('12.34');
    expect(decimal({ units: '0', nano: 5_000_000 })).toBe('0.005');
    expect(decimal({ units: '-3', nano: -250_000_000 })).toBe('-3.25');
    expect(decimal({ units: '0', nano: -500_000_000 })).toBe('-0.5');
    expect(decimal({ units: '7', nano: 0 })).toBe('7');
    expect(decimal({ units: '0', nano: 0 })).toBe('0');
  });

  it('reads a part JSON leaves out as zero', () => {
    expect(decimal({ nano: 500_000_000 })).toBe('0.5');
    expect(decimal({ units: '3' })).toBe('3');
    expect(decimal({})).toBe('0');
  });

  it('refuses a number that is not an int64 text or a nano out of range', () => {
    expect(() => decimal({ units: 12, nano: 0 })).toThrow();
    expect(() => decimal({ units: '1.5', nano: 0 })).toThrow();
    expect(() => decimal({ units: '1', nano: 1_000_000_000 })).toThrow();
    expect(() => decimal({ units: '1', nano: '5' })).toThrow();
    expect(() => decimal(null)).toThrow();
  });

  it('refuses parts of opposite signs instead of guessing the value', () => {
    expect(() => decimal({ units: '3', nano: -250_000_000 })).toThrow();
    expect(() => decimal({ units: '-3', nano: 250_000_000 })).toThrow();
  });

  it('reads each position with its quantity and prices and no other field', () => {
    expect(
      positionsOf({
        positions: [
          {
            instrumentUid: 'synthetic-uid-0001',
            instrumentType: 'share',
            quantity: { units: '10', nano: 500_000_000 },
            averagePositionPrice: { currency: 'rub', units: '100', nano: 250_000_000 },
            currentPrice: { currency: 'usd', units: '101', nano: 0 },
            figi: 'SYNTHETIC0001',
          },
          { instrumentUid: 'synthetic-uid-0002', instrumentType: 'weird-type', quantity: {} },
          {
            instrumentUid: 'synthetic-uid-0003',
            instrumentType: 'bond',
            quantity: { units: '1' },
            currentPrice: { currency: 'rub', units: '99' },
          },
        ],
      }),
    ).toEqual([
      {
        instrumentUid: 'synthetic-uid-0001',
        instrumentType: 'share',
        quantity: '10.5',
        averagePrice: '100.25',
        averagePriceCurrency: 'rub',
        currentPrice: '101',
        currentPriceCurrency: 'usd',
        virtual: false,
        expiresAt: '',
      },
      {
        instrumentUid: 'synthetic-uid-0002',
        instrumentType: 'unknown',
        quantity: '0',
        averagePrice: '',
        averagePriceCurrency: '',
        currentPrice: '',
        currentPriceCurrency: '',
        virtual: false,
        expiresAt: '',
      },
      {
        instrumentUid: 'synthetic-uid-0003',
        instrumentType: 'bond',
        quantity: '1',
        averagePrice: '',
        averagePriceCurrency: '',
        currentPrice: '99',
        currentPriceCurrency: 'rub',
        virtual: false,
        expiresAt: '',
      },
    ]);
  });

  it('refuses a body without positions of plain ids and quantities, or with too many', () => {
    expect(() => positionsOf({ positions: [{ instrumentUid: 'a b', quantity: {} }] })).toThrow();
    expect(() => positionsOf({ positions: [{ instrumentUid: 'a' }] })).toThrow();
    expect(() => positionsOf({ positions: 'x' })).toThrow();
    expect(() =>
      positionsOf({
        positions: Array.from({ length: 501 }, () => ({ instrumentUid: 'a', quantity: {} })),
      }),
    ).toThrow();
    expect(positionsOf({ positions: [{ instrumentUid: 'a', quantity: {} }] })).toHaveLength(1);
    expect(positionsOf({ accountId: '2000000001' })).toEqual([]);
    expect(() => positionsOf({})).toThrow();
    expect(() => positionsOf({ accountId: '2000000002', positions: [] })).toThrow();
  });

  it('reads an empty price object as no price, and a zero price with its currency as zero', () => {
    const [empty, zero] = positionsOf({
      positions: [
        { instrumentUid: 'a', quantity: {}, currentPrice: {}, averagePositionPrice: {} },
        { instrumentUid: 'b', quantity: {}, currentPrice: { currency: 'rub' } },
      ],
    });
    expect([empty.currentPrice, empty.averagePrice, empty.currentPriceCurrency]).toEqual([
      '',
      '',
      '',
    ]);
    expect([zero.currentPrice, zero.currentPriceCurrency]).toEqual(['0', 'rub']);
  });

  it('lists virtual (gift) positions after held ones, marked with when they expire', () => {
    const read = positionsOf({
      positions: [{ instrumentUid: 'synthetic-uid-0001', quantity: { units: '2' } }],
      virtualPositions: [
        {
          instrumentUid: 'synthetic-uid-0004',
          instrumentType: 'share',
          quantity: { units: '1' },
          expireDate: '2026-12-01T00:00:00Z',
        },
        { instrumentUid: 'synthetic-uid-0005', quantity: { units: '1' }, expireDate: 'soon' },
      ],
    });
    expect(read.map((item) => [item.instrumentUid, item.virtual, item.expiresAt])).toEqual([
      ['synthetic-uid-0001', false, ''],
      ['synthetic-uid-0004', true, '2026-12-01T00:00:00Z'],
      ['synthetic-uid-0005', true, ''],
    ]);
    expect(() => positionsOf({ accountId: '2000000001', virtualPositions: 'x' })).toThrow();
    expect(() =>
      positionsOf({
        positions: Array.from({ length: 300 }, () => ({ instrumentUid: 'a', quantity: {} })),
        virtualPositions: Array.from({ length: 201 }, () => ({ instrumentUid: 'b', quantity: {} })),
      }),
    ).toThrow();
  });
});

describe('BROKER-SYNC: operations T-Bank lists', () => {
  it('reads each operation with exact amounts and no other field', () => {
    expect(parseOperationsPage({ items: [item()] })).toEqual({
      operations: [
        {
          id: '900000001',
          parentId: '',
          type: 'OPERATION_TYPE_BUY',
          state: 'executed',
          occurredAt: '2024-03-01T10:00:00.123456Z',
          instrumentUid: '00000000-0000-4000-8000-000000000001',
          instrumentType: 'share',
          ticker: 'SYNTH',
          quantity: '2',
          payment: '-200.5',
          paymentCurrency: 'rub',
          price: '100.25',
          priceCurrency: 'rub',
          commission: '0',
          commissionCurrency: 'rub',
          fills: [],
        },
      ],
      nextCursor: '',
    });
  });

  it('keeps the trade a fee belongs to and reads a cash operation without an instrument', () => {
    const [fee, input] = parseOperationsPage({
      items: [
        item({
          id: '900000002',
          parentOperationId: '900000001',
          type: 'OPERATION_TYPE_BROKER_FEE',
        }),
        {
          id: '900000003',
          date: '2024-03-01T09:00:00Z',
          type: 'OPERATION_TYPE_INPUT',
          state: 'OPERATION_STATE_EXECUTED',
          payment: { currency: 'rub', units: '1000' },
        },
      ],
    }).operations;
    expect(fee.parentId).toBe('900000001');
    expect(input).toMatchObject({
      instrumentUid: '',
      ticker: '',
      quantity: '0',
      payment: '1000',
      price: '',
      priceCurrency: '',
    });
  });

  it('names a state or type it does not know instead of guessing', () => {
    const [odd] = parseOperationsPage({
      items: [item({ state: 'OPERATION_STATE_LATER', type: 'not a type' })],
    }).operations;
    expect(odd.state).toBe('unspecified');
    expect(odd.type).toBe('unknown');
  });

  it('counts only the filled part of a trade executed in part', () => {
    const quantities = parseOperationsPage({
      items: [
        item({ quantity: '10', quantityRest: '6', quantityDone: '4' }),
        item({ quantity: '10', quantityRest: '6', quantityDone: undefined }),
        item({ quantity: '5', quantityRest: undefined, quantityDone: undefined }),
      ],
    }).operations.map((operation) => operation.quantity);
    expect(quantities).toEqual(['4', '4', '5']);
  });

  it('keeps when and at what price each part of a trade was filled', () => {
    const [trade] = parseOperationsPage({
      items: [
        item({
          tradesInfo: {
            trades: [
              {
                num: '1',
                date: '2024-03-01T10:00:01Z',
                quantity: '1',
                price: { currency: 'rub', units: '100' },
              },
              {
                num: '2',
                date: '2024-03-04T07:00:00.5Z',
                quantity: '1',
                price: { currency: 'rub', units: '100', nano: 500000000 },
              },
            ],
          },
        }),
      ],
    }).operations;
    expect(trade.occurredAt).toBe('2024-03-01T10:00:00.123456Z');
    expect(trade.fills).toEqual([
      { filledAt: '2024-03-01T10:00:01Z', quantity: '1', price: '100', priceCurrency: 'rub' },
      { filledAt: '2024-03-04T07:00:00.5Z', quantity: '1', price: '100.5', priceCurrency: 'rub' },
    ]);
    expect(parseOperationsPage({ items: [item({ tradesInfo: {} })] }).operations[0].fills).toEqual(
      [],
    );
    expect(() =>
      parseOperationsPage({ items: [item({ tradesInfo: { trades: [{ quantity: '1' }] } })] }),
    ).toThrow();
  });

  it('reads a whole-number quantity a lenient encoder may send', () => {
    expect(
      parseOperationsPage({ items: [item({ quantity: 3, quantityDone: 3 })] }).operations[0]
        .quantity,
    ).toBe('3');
  });

  it('refuses an executed operation without an id, a time or a whole quantity', () => {
    for (const broken of [
      item({ id: undefined }),
      item({ id: 'has space' }),
      item({ date: '2024-03-01' }),
      item({ date: undefined }),
      item({ quantity: '1.5' }),
      item({ quantity: 1.5 }),
      item({ payment: { currency: 'rub', units: '-1', nano: 5 } }),
    ])
      expect(() => parseOperationsPage({ items: [broken] })).toThrow();
  });

  it('counts an odd canceled or pending operation without failing the page', () => {
    const [canceled, pending] = parseOperationsPage({
      items: [
        item({ state: 'OPERATION_STATE_CANCELED', date: undefined }),
        item({ state: 'OPERATION_STATE_PROGRESS', quantity: 'x' }),
      ],
    }).operations;
    expect(canceled).toMatchObject({ id: '', state: 'canceled', occurredAt: '' });
    expect(pending).toMatchObject({ id: '', state: 'progress' });
  });

  it('reads an account with no operations and refuses a page without a usable cursor', () => {
    expect(parseOperationsPage({})).toEqual({ operations: [], nextCursor: '' });
    expect(parseOperationsPage({ items: [], hasNext: false, nextCursor: 'x' })).toEqual({
      operations: [],
      nextCursor: '',
    });
    expect(() => parseOperationsPage({ items: [], hasNext: true })).toThrow();
    // A flag that is not a boolean could hide later pages, so it is not read as false.
    expect(() => parseOperationsPage({ items: [], hasNext: 'true', nextCursor: 'c' })).toThrow();
    expect(() => parseOperationsPage({ items: [], hasNext: 1, nextCursor: 'c' })).toThrow();
    expect(() => parseOperationsPage({ items: [], hasNext: true, nextCursor: 'a b' })).toThrow();
    expect(() => parseOperationsPage({ items: 'x' })).toThrow();
    expect(() =>
      parseOperationsPage({ items: Array.from({ length: 251 }, () => item()) }),
    ).toThrow();
  });
});

describe('BROKER-CONNECT: the T-Bank client', () => {
  let server: Server;
  let base: string;
  let reply: { status: number; body: string };
  /** Answers given in turn before `reply`, and every request body in order. */
  let queue: { status: number; body: string }[];
  let bodies: string[];
  let seen: { url?: string; method?: string; headers: IncomingHttpHeaders; body: string } | null;

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        seen = { url: request.url, method: request.method, headers: request.headers, body };
        bodies.push(body);
        const answer = queue.shift() ?? reply;
        response.writeHead(answer.status, { 'Content-Type': 'application/json' });
        response.end(answer.body);
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rest`;
  });
  afterAll(() => {
    server.close();
  });
  beforeEach(() => {
    seen = null;
    queue = [];
    bodies = [];
    reply = { status: 200, body: JSON.stringify({ accounts: [account()] }) };
  });

  it('posts GetAccounts with the token in the Authorization header only', async () => {
    const result = await new TBankClient({ baseUrl: base }).accounts(token);
    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: '2000000001',
          name: 'Synthetic account',
          open: true,
          closed: false,
          access: 'read_only',
          investBox: false,
        },
      ],
    });
    expect(seen?.method).toBe('POST');
    expect(seen?.url).toBe('/rest/tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts');
    expect(seen?.headers.authorization).toBe(`Bearer ${token}`);
    expect(seen?.url).not.toContain(token);
    expect(seen?.body).not.toContain(token);
  });

  it('names why T-Bank gave nothing, without the answer or the token', async () => {
    const client = new TBankClient({ baseUrl: base });
    reply = { status: 401, body: '{"message":"token is not valid"}' };
    expect(await client.accounts(token)).toEqual({ ok: false, reason: 'token_rejected' });
    reply = { status: 403, body: '{}' };
    expect(await client.accounts(token)).toEqual({ ok: false, reason: 'token_rejected' });
    reply = { status: 429, body: '{}' };
    expect(await client.accounts(token)).toEqual({ ok: false, reason: 'rate_limited' });
    reply = { status: 500, body: '{}' };
    expect(await client.accounts(token)).toEqual({ ok: false, reason: 'unavailable' });
    reply = { status: 200, body: 'not json' };
    expect(await client.accounts(token)).toEqual({ ok: false, reason: 'invalid_response' });
    reply = { status: 200, body: '{"accounts":"x"}' };
    expect(await client.accounts(token)).toEqual({ ok: false, reason: 'invalid_response' });
  });

  it('reads every page of operations by cursor, oldest first, with fees and fills', async () => {
    queue = [
      { status: 200, body: JSON.stringify({ items: [item()], hasNext: true, nextCursor: 'c1' }) },
      {
        status: 200,
        body: JSON.stringify({
          items: [item({ id: '900000002' })],
          hasNext: true,
          nextCursor: 'c2',
        }),
      },
    ];
    reply = { status: 200, body: JSON.stringify({ items: [item({ id: '900000003' })] }) };
    const result = await new TBankClient({ baseUrl: base }).operations(token, '2000000001');
    expect(result.ok && result.value.map((operation) => operation.id)).toEqual([
      '900000001',
      '900000002',
      '900000003',
    ]);
    expect(seen?.url).toBe(
      '/rest/tinkoff.public.invest.api.contract.v1.OperationsService/GetOperationsByCursor',
    );
    const sent = bodies.map((body) => JSON.parse(body));
    expect(sent.map((body) => body.cursor)).toEqual([undefined, 'c1', 'c2']);
    expect(sent[0]).toMatchObject({
      accountId: '2000000001',
      from: '2000-01-01T00:00:00Z',
      limit: 250,
      withoutTrades: false,
      withoutCommissions: false,
      withoutOvernights: false,
    });
    expect(bodies.join('')).not.toContain(token);
  });

  it('stops at a failed page and at a history longer than one read takes', async () => {
    const client = new TBankClient({ baseUrl: base });
    queue = [
      { status: 200, body: JSON.stringify({ items: [item()], hasNext: true, nextCursor: 'c1' }) },
    ];
    reply = { status: 429, body: '{}' };
    expect(await client.operations(token, '2000000001')).toEqual({
      ok: false,
      reason: 'rate_limited',
    });
    bodies = [];
    reply = {
      status: 200,
      body: JSON.stringify({ items: [], hasNext: true, nextCursor: 'again' }),
    };
    expect(await client.operations(token, '2000000001')).toEqual({
      ok: false,
      reason: 'too_many_operations',
    });
    expect(bodies).toHaveLength(200);
  });

  it('reports an unreachable host as unavailable', async () => {
    const closed = new TBankClient({ baseUrl: 'http://127.0.0.1:1/rest', timeoutMs: 500 });
    expect(await closed.accounts(token)).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('BROKER-CONNECT: trusting the root T-Bank signs with', () => {
  it('reaches a gateway only when its root is added, and never skips verification', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'capital-tbank-tls-'));
    try {
      // A synthetic root that no store knows, standing in for the one T-Bank's gateway uses.
      execFileSync(
        'openssl',
        [
          ...[
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-days',
            '2',
            '-subj',
            '/CN=localhost',
          ],
          ...['-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
          ...['-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem')],
        ],
        { stdio: 'ignore' },
      );
      const cert = readFileSync(join(directory, 'cert.pem'), 'utf8');
      const server = createSecureServer(
        { key: readFileSync(join(directory, 'key.pem')), cert },
        (_request, response) => {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ accounts: [account()] }));
        },
      );
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = `https://127.0.0.1:${(server.address() as AddressInfo).port}/rest`;
      try {
        expect(await new TBankClient({ baseUrl: base }).accounts(token)).toEqual({
          ok: false,
          reason: 'unavailable',
        });
        const trusted = await new TBankClient({ baseUrl: base, extraRoots: [cert] }).accounts(
          token,
        );
        expect(trusted.ok).toBe(true);
      } finally {
        server.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
