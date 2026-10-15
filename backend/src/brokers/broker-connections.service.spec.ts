import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { BrokerConnectionsService } from './broker-connections.service';
import type { TBankAccount, TBankClient, TBankOperation, TBankResult } from './tbank-client';
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
  operations: TBankResult<TBankOperation[]> = { ok: true, value: [] },
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
  const histories: string[] = [];
  const tbank = {
    accounts: async () => accounts,
    portfolio: async (_token: string, id: string) => {
      portfolios.push(id);
      return positions;
    },
    operations: async (_token: string, id: string) => {
      histories.push(id);
      return operations;
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
    histories,
  };
}
const ok = (...items: TBankAccount[]): TBankResult<TBankAccount[]> => ({ ok: true, value: items });
const operation = (over: Partial<TBankOperation>): TBankOperation => ({
  id: '900000001',
  parentId: '',
  type: 'OPERATION_TYPE_BUY',
  state: 'executed',
  occurredAt: '2024-03-01T10:00:00Z',
  instrumentUid: '00000000-0000-4000-8000-000000000001',
  instrumentType: 'share',
  ticker: 'SYNTH',
  quantity: '2',
  payment: '-200',
  paymentCurrency: 'rub',
  price: '100',
  priceCurrency: 'rub',
  commission: '',
  commissionCurrency: '',
  fills: [],
  ...over,
});

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

describe('BROKER-SYNC: previewing the operations of a connected account', () => {
  const history = [
    operation({
      id: '900000003',
      type: 'OPERATION_TYPE_DIVIDEND',
      occurredAt: '2024-05-01T00:00:00Z',
    }),
    operation({
      id: '900000002',
      parentId: '900000001',
      type: 'OPERATION_TYPE_BROKER_FEE',
      payment: '-0.3',
    }),
    operation({}),
    operation({ id: '900000004', type: 'OPERATION_TYPE_SOMETHING_NEW' }),
    operation({ id: '900000005', state: 'canceled', type: 'OPERATION_TYPE_SELL' }),
    operation({ id: '', state: 'progress', occurredAt: '' }),
    // Half a second after the trades: later, although its text sorts before theirs.
    operation({
      id: '900000006',
      type: 'OPERATION_TYPE_INPUT',
      occurredAt: '2024-03-01T10:00:00.5Z',
    }),
  ];

  it('lists executed operations in time order with what each would become, recording nothing', async () => {
    const { service, histories, writes } = build(ok(mine), true, true, undefined, {
      ok: true,
      value: history,
    });
    const preview = await service.operations(owner, account);
    expect(histories).toEqual([mine.id]);
    expect(writes).toEqual([]);
    expect(preview.operations.map((item) => [item.id, item.kind])).toEqual([
      ['900000001', 'buy'],
      ['900000002', 'fee'],
      ['900000004', 'unsupported'],
      ['900000006', 'deposit'],
      ['900000003', 'income'],
    ]);
    expect(preview.operations[1].parentId).toBe('900000001');
    expect(preview.byKind).toEqual({ deposit: 1, buy: 1, fee: 1, unsupported: 1, income: 1 });
    expect(preview.unsupportedTypes).toEqual({ OPERATION_TYPE_SOMETHING_NEW: 1 });
    expect(preview.notExecuted).toBe(2);
  });

  it('orders operations apart by less than a millisecond by their nanoseconds', async () => {
    const { service } = build(ok(mine), true, true, undefined, {
      ok: true,
      value: [
        operation({ id: '900000001', occurredAt: '2024-03-01T10:00:00.000000002Z' }),
        operation({ id: '900000002', occurredAt: '2024-03-01T10:00:00.000000001Z' }),
      ],
    });
    const preview = await service.operations(owner, account);
    expect(preview.operations.map((item) => item.id)).toEqual(['900000002', '900000001']);
  });

  it('reads the history of a closed account and of an Invest Box', async () => {
    for (const target of [
      { ...mine, closed: true, open: false },
      { ...mine, investBox: true },
    ]) {
      const { service, histories } = build(ok(target), true, true);
      expect(await service.operations(owner, account)).toEqual({
        operations: [],
        byKind: {},
        unsupportedTypes: {},
        notExecuted: 0,
      });
      expect(histories).toEqual([mine.id]);
    }
  });

  it('refuses an unconnected account or one the token no longer reaches, without asking T-Bank', async () => {
    const unconnected = build(ok(mine));
    await expect(unconnected.service.operations(owner, account)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const moved = build(ok({ ...mine, id: '2000000009' }), true, true);
    await expect(moved.service.operations(owner, account)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect([...unconnected.histories, ...moved.histories]).toEqual([]);
  });

  it('names a rejected token, too long a history and an unreachable T-Bank', async () => {
    const failing = (reason: 'token_rejected' | 'too_many_operations' | 'unavailable') =>
      build(ok(mine), true, true, undefined, { ok: false, reason }).service.operations(
        owner,
        account,
      );
    await expect(failing('token_rejected')).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(failing('too_many_operations')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(failing('unavailable')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
