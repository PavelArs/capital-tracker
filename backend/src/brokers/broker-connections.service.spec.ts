import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { BrokerConnectionsService } from './broker-connections.service';
import type { TBankAccount, TBankClient, TBankResult } from './tbank-client';
import type { TBankTokenBox } from './tbank-token-box';

// BROKER-CONNECT with a stubbed T-Bank client; the stored rows are probed against PostgreSQL.
const owner = '8b0f2f3e-5a53-4f63-9a2a-0d6f5b9a1c01';
const account = 'a0e1f7c2-0a53-4a0f-8d3a-6b8f2a0d9e02';
const token = 't.SyntheticToken000000000000000001';
const mine: TBankAccount = {
  id: '2000000001',
  name: 'Synthetic',
  open: true,
  closed: false,
  access: 'read_only',
  investBox: false,
};

function build(
  accounts: TBankResult<TBankAccount[]>,
  found = true,
  stored = false,
  positions: TBankResult<unknown[]> = { ok: true, value: [] },
) {
  const writes: unknown[][] = [];
  const query = async (sql: string, parameters: unknown[] = []) => {
    if (sql.includes('FROM manual_accounts')) return found ? [{ id: account }] : [];
    if (sql.includes('SELECT credentials'))
      return stored ? [{ credentials: { v: 1 }, brokerAccountId: mine.id }] : [];
    if (sql.includes('INSERT INTO broker_connections')) writes.push(parameters);
    if (sql.includes('FROM broker_connections'))
      return writes.length
        ? [{ tokenHint: '0001', brokerAccountId: mine.id, savedAt: 'now', checkedAt: 'now' }]
        : [];
    return [];
  };
  const source = {
    manager: { query },
    query,
    transaction: async (_level: string, work: (manager: unknown) => unknown) => work({ query }),
  };
  const portfolios: string[] = [];
  const tbank = {
    accounts: async () => accounts,
    portfolio: async (_token: string, id: string) => {
      portfolios.push(id);
      return positions;
    },
  };
  const box = {
    seal: () => ({ v: 1, sealed: true }),
    open: (envelope: unknown) => (envelope ? token : null),
  };
  return {
    service: new BrokerConnectionsService(
      source as unknown as DataSource,
      tbank as unknown as TBankClient,
      box as unknown as TBankTokenBox,
    ),
    writes,
    portfolios,
  };
}
const ok = (...items: TBankAccount[]): TBankResult<TBankAccount[]> => ({ ok: true, value: items });

describe('broker connections service', () => {
  it('lists the open accounts a read-only token reaches', async () => {
    const { service } = build(ok(mine, { ...mine, id: '2000000002', open: false, closed: true }));
    expect(await service.check(owner, account, { token })).toEqual({
      accounts: [{ id: mine.id, name: 'Synthetic' }],
    });
  });

  it('ignores an account the token has no access to', async () => {
    const { service } = build(ok(mine, { ...mine, id: '2000000004', access: 'no_access' }));
    expect(await service.check(owner, account, { token })).toEqual({
      accounts: [{ id: mine.id, name: 'Synthetic' }],
    });
    await expect(
      build(ok({ ...mine, access: 'no_access' })).service.check(owner, account, { token }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('refuses a token that can trade, even on one of several accounts', async () => {
    const { service } = build(ok(mine, { ...mine, id: '2000000003', access: 'full_access' }));
    await expect(service.check(owner, account, { token })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('refuses a token that can trade on an account still being opened, not on a closed one', async () => {
    const opening = { ...mine, id: '2000000005', open: false, access: 'full_access' as const };
    await expect(
      build(ok(mine, opening)).service.check(owner, account, { token }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    const { service } = build(ok(mine, { ...opening, closed: true }));
    expect(await service.check(owner, account, { token })).toEqual({
      accounts: [{ id: mine.id, name: 'Synthetic' }],
    });
  });

  it('refuses a rejected token, a token without accounts and an unreachable T-Bank', async () => {
    await expect(
      build({ ok: false, reason: 'token_rejected' }).service.check(owner, account, { token }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(build(ok()).service.check(owner, account, { token })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(
      build({ ok: false, reason: 'unavailable' }).service.check(owner, account, { token }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("answers 404 for an account that is not the owner's live broker account", async () => {
    const { service } = build(ok(mine), false);
    await expect(service.check(owner, account, { token })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.read(owner, account)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.disconnect(owner, account)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stores the sealed token with its last four characters and never returns it', async () => {
    const { service, writes } = build(ok(mine));
    const shown = await service.connect(owner, account, { token, brokerAccountId: mine.id });
    expect(writes).toEqual([
      [owner, account, JSON.stringify({ v: 1, sealed: true }), '0001', mine.id],
    ]);
    expect(JSON.stringify(shown)).not.toContain(token);
    expect(shown).toMatchObject({ connected: true, provider: 'tbank', tokenHint: '0001' });
  });

  it('refuses a broker account the token does not list, and stores nothing', async () => {
    const { service, writes } = build(ok(mine));
    await expect(
      service.connect(owner, account, { token, brokerAccountId: '9999999999' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(writes).toEqual([]);
  });

  it('refuses malformed input before asking T-Bank', async () => {
    const { service } = build(ok(mine));
    await expect(service.check(owner, account, { token: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.check(owner, account, { token, extra: 1 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.connect(owner, account, { token })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.read('not-a-uuid', account)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads the positions the saved token sees, recording nothing', async () => {
    const position = { instrumentUid: 'synthetic-uid-0001', quantity: '2', averagePrice: '10' };
    const { service, writes, portfolios } = build(ok(mine), true, true, {
      ok: true,
      value: [position],
    });
    expect(await service.positions(owner, account)).toEqual({ positions: [position] });
    expect(writes).toEqual([]);
    expect(portfolios).toEqual([mine.id]);
  });

  it('names an Invest Box or an account the token no longer reaches, without asking for it', async () => {
    for (const listed of [
      ok({ ...mine, investBox: true }),
      ok({ ...mine, id: '2000000009' }),
      ok({ ...mine, closed: true }),
    ]) {
      const { service, portfolios } = build(listed, true, true);
      await expect(service.positions(owner, account)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(portfolios).toEqual([]);
    }
  });

  it('answers 404 for positions of an unconnected account and names a rejected token', async () => {
    await expect(build(ok(mine)).service.positions(owner, account)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      build(ok(mine), true, true, { ok: false, reason: 'token_rejected' }).service.positions(
        owner,
        account,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      build(ok(mine), true, true, { ok: false, reason: 'rate_limited' }).service.positions(
        owner,
        account,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      build({ ok: false, reason: 'token_rejected' }, true, true).service.positions(owner, account),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('reads a broker account that has no connection as not connected', async () => {
    expect(await build(ok(mine)).service.read(owner, account)).toEqual({ connected: false });
  });
});
