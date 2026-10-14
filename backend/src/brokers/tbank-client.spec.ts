import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decimal, isTBankToken, parseAccounts, parsePositions, TBankClient } from './tbank-client';

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
      },
      {
        id: '2000000002',
        name: 'Synthetic account',
        open: false,
        closed: true,
        access: 'read_only',
      },
      {
        id: '2000000003',
        name: 'Synthetic account',
        open: true,
        closed: false,
        access: 'full_access',
      },
    ]);
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
  it('reads a Quotation or MoneyValue as exact decimal text', () => {
    expect(decimal({ units: '12', nano: 340_000_000 })).toBe('12.34');
    expect(decimal({ units: '0', nano: 5_000_000 })).toBe('0.005');
    expect(decimal({ units: '-3', nano: -250_000_000 })).toBe('-3.25');
    expect(decimal({ units: '0', nano: -500_000_000 })).toBe('-0.5');
    expect(decimal({ units: '7', nano: 0 })).toBe('7');
    expect(decimal({ units: '0', nano: 0 })).toBe('0');
  });

  it('refuses a number that is not an int64 text or a nano out of range', () => {
    expect(() => decimal({ units: 12, nano: 0 })).toThrow();
    expect(() => decimal({ units: '1.5', nano: 0 })).toThrow();
    expect(() => decimal({ units: '1', nano: 1_000_000_000 })).toThrow();
    expect(() => decimal(null)).toThrow();
  });

  it('reads each position with its quantity and prices and no other field', () => {
    expect(
      parsePositions({
        positions: [
          {
            instrumentUid: 'synthetic-uid-0001',
            instrumentType: 'INSTRUMENT_TYPE_SHARE',
            quantity: { units: '10', nano: 500_000_000 },
            averagePositionPrice: { currency: 'rub', units: '100', nano: 250_000_000 },
            currentPrice: { currency: 'rub', units: '101', nano: 0 },
            figi: 'SYNTHETIC0001',
          },
          { instrumentUid: 'synthetic-uid-0002', instrumentType: 'weird-type' },
        ],
      }),
    ).toEqual([
      {
        instrumentUid: 'synthetic-uid-0001',
        instrumentType: 'INSTRUMENT_TYPE_SHARE',
        currency: 'rub',
        quantity: '10.5',
        averagePrice: '100.25',
        currentPrice: '101',
      },
      {
        instrumentUid: 'synthetic-uid-0002',
        instrumentType: 'UNKNOWN',
        currency: '',
        quantity: '0',
        averagePrice: '',
        currentPrice: '',
      },
    ]);
  });

  it('refuses a body without positions of plain ids, or with too many', () => {
    expect(() => parsePositions({ positions: [{ instrumentUid: 'a b' }] })).toThrow();
    expect(() => parsePositions({ positions: 'x' })).toThrow();
    expect(() =>
      parsePositions({ positions: Array.from({ length: 501 }, () => ({ instrumentUid: 'a' })) }),
    ).toThrow();
    expect(parsePositions({})).toEqual([]);
  });
});

describe('BROKER-CONNECT: the T-Bank client', () => {
  let server: Server;
  let base: string;
  let reply: { status: number; body: string };
  let seen: { url?: string; method?: string; headers: IncomingHttpHeaders; body: string } | null;

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        seen = { url: request.url, method: request.method, headers: request.headers, body };
        response.writeHead(reply.status, { 'Content-Type': 'application/json' });
        response.end(reply.body);
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
