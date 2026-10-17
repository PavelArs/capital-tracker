import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { BrokerConnectionsService } from './broker-connections.service';
import { BrokerSetupService } from './broker-setup.service';
import type { TBankAccount, TBankClient, TBankResult } from './tbank-client';
import type { TBankTokenBox } from './tbank-token-box';

// BROKER-SETUP with a stubbed T-Bank client and a recording database; the stored rows are
// probed against PostgreSQL in tests/e2e/broker-connections-db.cjs. Synthetic data only.
const owner = '8b0f2f3e-5a53-4f63-9a2a-0d6f5b9a1c01';
const token = 't.SyntheticToken000000000000000001';
const request = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const regular: TBankAccount = {
  id: '2000000001',
  name: 'Synthetic regular',
  open: true,
  closed: false,
  access: 'read_only',
  investBox: false,
};
const iis: TBankAccount = { ...regular, id: '2000000002', name: 'Synthetic IIS' };

// `replay` makes every account insert a repeat of a request already saved, with that account
// still reading `brokerAccountId` (null: disconnected) and removed or not.
interface Replay {
  brokerAccountId: string | null;
  removed: boolean;
}
function build(
  accounts: TBankResult<TBankAccount[]>,
  connected: Record<string, string> = {},
  replay?: Replay,
) {
  const writes: { sql: string; parameters: unknown[] }[] = [];
  let accountNumber = 0;
  const query = async (sql: string, parameters: unknown[] = []) => {
    writes.push({ sql, parameters });
    if (replay && sql.includes('INSERT INTO manual_accounts')) return [];
    if (replay && sql.includes('SELECT * FROM manual_accounts'))
      return [
        {
          id: request(101),
          requestId: parameters[1],
          canonicalPayload: JSON.stringify({
            name: 'T-Bank Synthetic regular',
            assetClass: 'broker',
          }),
          name: 'T-Bank Synthetic regular',
          assetClass: 'broker',
          createdAt: new Date(0),
          removedAt: null,
        },
      ];
    if (replay && sql.includes('a."requestId", a.id'))
      return (parameters[1] as string[]).map((requestId) => ({
        requestId,
        id: request(101),
        name: 'T-Bank Synthetic regular',
        canonicalPayload: JSON.stringify({
          name: 'T-Bank Synthetic regular',
          assetClass: 'broker',
        }),
        removedAt: replay.removed ? new Date(0) : null,
        brokerAccountId: replay.brokerAccountId,
      }));
    if (replay && sql.includes('LEFT JOIN broker_connections'))
      return [
        {
          brokerAccountId: replay.brokerAccountId,
          removedAt: replay.removed ? new Date(0) : null,
        },
      ];
    if (sql.includes('INSERT INTO manual_accounts'))
      return [
        {
          id: request(100 + ++accountNumber),
          requestId: parameters[2],
          canonicalPayload: parameters[3],
          name: parameters[4],
          assetClass: 'broker',
          createdAt: new Date(0),
          removedAt: null,
        },
      ];
    if (sql.includes('"accountId" <>')) {
      const other = connected[String(parameters[1])];
      return other && other !== parameters[2] ? [{ accountId: other }] : [];
    }
    if (sql.includes('FROM broker_connections') && sql.includes('"brokerAccountId" = ANY'))
      return Object.entries(connected).map(([brokerAccountId, accountId]) => ({
        brokerAccountId,
        accountId,
      }));
    return [];
  };
  const manager = { query, queryRunner: { isTransactionActive: true } };
  const source = {
    manager: { query },
    query,
    transaction: async (_level: unknown, work?: (m: unknown) => unknown) =>
      (typeof _level === 'function' ? _level : work!)(manager),
  };
  const tbank = { accounts: async () => accounts };
  const box = { seal: () => ({ v: 1, sealed: true }) };
  const connections = new BrokerConnectionsService(
    source as unknown as DataSource,
    tbank as unknown as TBankClient,
    box as unknown as TBankTokenBox,
  );
  return {
    service: new BrokerSetupService(
      source as unknown as DataSource,
      connections,
      box as unknown as TBankTokenBox,
    ),
    writes,
  };
}
const ok = (...items: TBankAccount[]): TBankResult<TBankAccount[]> => ({ ok: true, value: items });
type Write = { sql: string; parameters: unknown[] };
const stored = (writes: Write[]) =>
  writes.filter(({ sql }) => sql.includes('INSERT INTO broker_connections'));
const created = (writes: Write[]) =>
  writes.filter(({ sql }) => sql.includes('INSERT INTO manual_accounts'));

describe('BROKER-SETUP-LIST the accounts one token reaches', () => {
  it('lists the open accounts with whether each is already connected, and stores nothing', async () => {
    const { service, writes } = build(ok(regular, iis), { [regular.id]: request(9) });
    expect(await service.accounts(owner, { token })).toEqual({
      accounts: [
        { id: regular.id, name: 'Synthetic regular', investBox: false, connected: true },
        { id: iis.id, name: 'Synthetic IIS', investBox: false, connected: false },
      ],
    });
    expect(stored(writes)).toEqual([]);
    expect(created(writes)).toEqual([]);
  });

  it('refuses a token that can trade, a rejected token and an unreachable T-Bank', async () => {
    await expect(
      build(ok(regular, { ...iis, access: 'full_access' })).service.accounts(owner, { token }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      build({ ok: false, reason: 'token_rejected' }).service.accounts(owner, { token }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      build({ ok: false, reason: 'unavailable' }).service.accounts(owner, { token }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refuses malformed input before asking T-Bank', async () => {
    const { service } = build(ok(regular));
    await expect(service.accounts(owner, { token: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.accounts(owner, { token, extra: 1 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('BROKER-SETUP-CONNECT one command makes and connects a broker account for each pick', () => {
  const pick = (n: number, account: TBankAccount) => ({
    brokerAccountId: account.id,
    requestId: request(n),
    name: `T-Bank ${account.name}`,
  });

  it('creates a broker account for each pick, stores the sealed token for each and never returns it', async () => {
    const { service, writes } = build(ok(regular, iis));
    const shown = await service.connect(owner, {
      token,
      accounts: [pick(1, regular), pick(2, iis)],
    });
    expect(created(writes).map(({ parameters }) => parameters[4])).toEqual([
      'T-Bank Synthetic regular',
      'T-Bank Synthetic IIS',
    ]);
    expect(stored(writes).map(({ parameters }) => parameters.slice(1))).toEqual([
      [request(101), JSON.stringify({ v: 1, sealed: true }), '0001', regular.id],
      [request(102), JSON.stringify({ v: 1, sealed: true }), '0001', iis.id],
    ]);
    expect(shown.connections).toEqual([
      expect.objectContaining({ accountId: request(101), brokerAccountId: regular.id }),
      expect.objectContaining({ accountId: request(102), brokerAccountId: iis.id }),
    ]);
    expect(JSON.stringify(shown)).not.toContain(token);
  });

  it('makes a broker account, so it shows in Brokers', async () => {
    const { service, writes } = build(ok(regular));
    await service.connect(owner, { token, accounts: [pick(1, regular)] });
    expect(created(writes)[0].sql).toContain('"assetClass"');
    expect(created(writes)[0].parameters).toContain('broker');
  });

  it('refuses a pick the token does not reach, and writes nothing', async () => {
    const { service, writes } = build(ok(regular));
    await expect(
      service.connect(owner, {
        token,
        accounts: [pick(1, regular), { ...pick(2, iis), brokerAccountId: '9999999999' }],
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(created(writes)).toEqual([]);
    expect(stored(writes)).toEqual([]);
  });

  it('returns the account a repeated request made and writes nothing', async () => {
    const { service, writes } = build(
      ok(regular),
      {},
      { brokerAccountId: regular.id, removed: false },
    );
    const shown = await service.connect(owner, { token, accounts: [pick(1, regular)] });
    expect(shown.connections).toEqual([
      {
        accountId: request(101),
        name: 'T-Bank Synthetic regular',
        brokerAccountId: regular.id,
        created: false,
      },
    ]);
    expect(stored(writes)).toEqual([]);
  });

  it('answers a finished request from what is saved, without asking T-Bank', async () => {
    const { service, writes } = build(
      { ok: false, reason: 'unavailable' },
      {},
      { brokerAccountId: regular.id, removed: false },
    );
    const shown = await service.connect(owner, { token, accounts: [pick(1, regular)] });
    expect(shown.connections).toEqual([
      expect.objectContaining({ accountId: request(101), created: false }),
    ]);
    expect(stored(writes)).toEqual([]);
    expect(created(writes)).toEqual([]);
  });

  it.each([
    ['an account removed since', { brokerAccountId: regular.id, removed: true }],
    ['a connection the owner removed', { brokerAccountId: null, removed: false }],
    [
      'a connection now reading another T-Bank account',
      { brokerAccountId: iis.id, removed: false },
    ],
  ])('refuses a repeated request for %s, and stores no token', async (_label, replay) => {
    const { service, writes } = build(ok(regular, iis), {}, replay);
    await expect(
      service.connect(owner, { token, accounts: [pick(1, regular)] }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stored(writes)).toEqual([]);
  });

  it('refuses a T-Bank account already connected to another account', async () => {
    const { service } = build(ok(regular), { [regular.id]: request(9) });
    await expect(
      service.connect(owner, { token, accounts: [pick(1, regular)] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses malformed input: no pick, repeats, extra keys, a bad id or name', async () => {
    const { service } = build(ok(regular, iis));
    const bad = [
      { token, accounts: [] },
      { token, accounts: [pick(1, regular), pick(2, regular)] },
      { token, accounts: [pick(1, regular), { ...pick(1, iis) }] },
      { token, accounts: [{ ...pick(1, regular), extra: 1 }] },
      { token, accounts: [{ ...pick(1, regular), brokerAccountId: 'not valid!' }] },
      { token, accounts: [{ ...pick(1, regular), requestId: 'x' }] },
      { token, accounts: [{ ...pick(1, regular), name: '' }] },
      { token },
      { accounts: [pick(1, regular)] },
    ];
    for (const body of bad)
      await expect(service.connect(owner, body)).rejects.toBeInstanceOf(BadRequestException);
  });
});
