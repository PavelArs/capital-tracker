import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { WalletAddressService } from './wallet-address.service';
import type { WalletSyncService } from './wallet-sync.service';

// Synthetic ids and a public test-vector address only.
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const address = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const accountRow = (id: string) => ({
  id,
  name: 'Cold storage',
  kind: 'hardware',
  assetClass: null,
  currentRevision: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  canonicalPayload: JSON.stringify({ name: 'Cold storage', kind: 'hardware' }),
});
const addressRow = (accountId: string | null) => ({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  ownerId: owner,
  network: 'bitcoin',
  address,
  accountId,
  label: null,
  scannedBlock: null,
  tokenBackfillTo: null,
  hiddenTokens: [],
  shownTokens: [],
  walkTopTxid: null,
  walkCursorTxid: null,
  completedTopTxid: null,
  completedAt: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  transactionCount: 0,
  balances: [],
  stake: [],
  pools: [],
  derived: null,
  exchange: null,
  tron: null,
  stellar: null,
  source: null,
});

const madeBefore = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

/**
 * One transaction whose queries answer by their SQL; every statement is kept in order. `replay`
 * finds the wallet of an earlier request with the same id (removed since, when `removed`);
 * `raced` has another request add the address after it was read as untracked.
 */
function harness(
  tracked: { accountId: string | null } | null,
  options: { replay?: boolean; removed?: boolean; raced?: boolean } = {},
) {
  const statements: string[] = [];
  let walletId: string | null = null;
  const query = jest.fn(async (sql: string, parameters: unknown[] = []) => {
    statements.push(sql);
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.startsWith('SELECT "accountId" FROM wallet_addresses')) return tracked ? [tracked] : [];
    if (sql.includes('INSERT INTO manual_accounts')) {
      if (options.replay) return [];
      walletId = parameters[0] as string;
      return [{ ...accountRow(walletId), canonicalPayload: parameters[3] }];
    }
    if (sql.startsWith('SELECT * FROM manual_accounts')) {
      walletId = madeBefore;
      return [
        { ...accountRow(madeBefore), removedAt: options.removed ? new Date('2026-10-02') : null },
      ];
    }
    if (sql.startsWith('SELECT 1 FROM manual_accounts')) return options.removed ? [] : [{}];
    if (sql.startsWith('UPDATE wallet_addresses SET'))
      return [tracked ? [{ id: addressRow(null).id }] : [], tracked ? 1 : 0];
    if (sql.includes('INSERT INTO wallet_addresses'))
      return tracked || options.raced ? [] : [{ id: addressRow(null).id, fresh: true }];
    if (sql.includes('FROM wallet_addresses a'))
      return [addressRow(tracked?.accountId ?? walletId)];
    // What follows a move (ensureChainCoins) reads and writes nothing these checks need.
    return [];
  });
  const manager = { query, queryRunner: { isTransactionActive: true } } as unknown as EntityManager;
  const transaction = jest.fn(
    async (_level: string, work: (manager: EntityManager) => Promise<unknown>) => work(manager),
  );
  const linkOwnTransfers = jest.fn();
  const service = new WalletAddressService(
    { transaction } as unknown as DataSource,
    { linkOwnTransfers } as unknown as WalletSyncService,
  );
  return { service, statements, query, transaction, walletId: () => walletId };
}

describe('WAL-INVALID: a new wallet is made with its first address, in one command', () => {
  it('wallets-01 makes the wallet and its address in the same transaction', async () => {
    const { service, statements, transaction, walletId } = harness(null);
    const result = await service.register(owner, {
      network: 'bitcoin',
      address,
      newAccount: { requestId, name: 'Cold storage', kind: 'hardware' },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    const made = statements.findIndex((sql) => sql.includes('INSERT INTO manual_accounts'));
    const added = statements.findIndex((sql) => sql.includes('INSERT INTO wallet_addresses'));
    expect(made).toBeGreaterThanOrEqual(0);
    expect(added).toBeGreaterThan(made);
    expect(result.created).toBe(true);
    expect(result.value.accountId).toBe(walletId());
  });

  it('wallets-01 refuses an address the server cannot read before anything is written', async () => {
    const { service, transaction } = harness(null);
    await expect(
      service.register(owner, {
        network: 'bitcoin',
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlj',
        newAccount: { requestId, name: 'Cold storage', kind: 'hardware' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('wallets-01 makes no wallet for an address already tracked (WAL-DUP)', async () => {
    const kept = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const { service, statements } = harness({ accountId: kept });
    const result = await service.register(owner, {
      network: 'bitcoin',
      address,
      newAccount: { requestId, name: 'Cold storage', kind: 'hardware' },
    });
    expect(statements.some((sql) => sql.includes('INSERT INTO manual_accounts'))).toBe(false);
    expect(result.created).toBe(false);
    expect(result.value.accountId).toBe(kept);
  });
});

describe('WAL-INVALID: an address moves into a new wallet in one command', () => {
  const addressId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  it('wallets-01 makes the wallet and moves the address in the same transaction', async () => {
    const { service, statements, query, transaction, walletId } = harness({ accountId: null });
    await service.update(owner, addressId, {
      newAccount: { requestId, name: 'Cold storage', kind: 'hardware' },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    const made = statements.findIndex((sql) => sql.includes('INSERT INTO manual_accounts'));
    const moved = statements.findIndex((sql) => sql.startsWith('UPDATE wallet_addresses SET'));
    expect(made).toBeGreaterThanOrEqual(0);
    expect(moved).toBeGreaterThan(made);
    expect(query.mock.calls[moved][1]).toEqual([owner, addressId, true, walletId(), false, null]);
  });

  it('wallets-01 fails inside the transaction when the address is gone, so the wallet is undone', async () => {
    const { service, transaction } = harness(null);
    await expect(
      service.update(owner, addressId, { newAccount: { requestId, name: 'Cold storage' } }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

describe('WAL-INVALID: a retried or raced new wallet never takes a removed or empty wallet', () => {
  const addressId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const newAccount = { requestId, name: 'Cold storage', kind: 'hardware' };

  it('B-P3-2 refuses to add an address to the wallet a repeated request made and that was removed', async () => {
    const { service, statements } = harness(null, { replay: true, removed: true });
    await expect(
      service.register(owner, { network: 'bitcoin', address, newAccount }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(statements.some((sql) => sql.includes('INSERT INTO wallet_addresses'))).toBe(false);
  });

  it('B-P3-2 refuses to move an address to the wallet a repeated request made and that was removed', async () => {
    const { service, statements } = harness({ accountId: null }, { replay: true, removed: true });
    await expect(service.update(owner, addressId, { newAccount })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(statements.some((sql) => sql.startsWith('UPDATE wallet_addresses SET'))).toBe(false);
  });

  it('B-P3-2 adds the address to the wallet a repeated request made while that wallet is kept', async () => {
    const { service } = harness(null, { replay: true });
    const result = await service.register(owner, { network: 'bitcoin', address, newAccount });
    expect(result.value.accountId).toBe(madeBefore);
  });

  it('B-P3-3 rolls the new wallet back when another request added the address first', async () => {
    const { service } = harness(null, { raced: true });
    await expect(
      service.register(owner, { network: 'bitcoin', address, newAccount }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('BYBIT-COUNT-GAP: a difference to Bybit is counted only against the balance it reports now', () => {
  const accountId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const gapRequest = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const bybitRow = (
    exchange: Record<string, unknown> | null,
    wallet: string | null = accountId,
  ) => ({
    ...addressRow(wallet),
    network: 'bybit',
    address: 'bybit-account',
    exchange: exchange && {
      keyHint: 'WXYZ',
      ipBound: true,
      keyExpiresAt: null,
      balancesAt: '2026-10-30T00:00:00+00:00',
      historyFrom: '2025-11-01T00:00:00+00:00',
      readFrom: '2025-11-01T00:00:00+00:00',
      earnAllowed: null,
      earn: null,
      convertAllowed: null,
      hiddenLegs: [],
      ...exchange,
    },
  });
  function gapHarness(row: ReturnType<typeof bybitRow>) {
    const inserts: unknown[][] = [];
    const query = jest.fn(async (sql: string, parameters: unknown[] = []) => {
      if (sql.includes('FROM wallet_addresses a')) return [row];
      if (sql.includes('INSERT INTO wallet_address_transactions')) inserts.push(parameters);
      return [];
    });
    const transaction = jest.fn(
      async (_level: string, work: (manager: EntityManager) => Promise<unknown>) =>
        work({ query } as unknown as EntityManager),
    );
    const linkOwnTransfers = jest.fn();
    const service = new WalletAddressService(
      { transaction } as unknown as DataSource,
      { linkOwnTransfers } as unknown as WalletSyncService,
    );
    return { service, inserts, linkOwnTransfers };
  }
  const gap = (direction: 'in' | 'out', quantity: string, reported: string) => ({
    requestId: gapRequest,
    coin: 'BTC',
    direction,
    quantity,
    reported,
  });

  it.each([
    ['a wallet address', bybitRow(null)],
    ['a Bybit account outside a wallet', bybitRow({ balances: [] }, null)],
  ])('BYBIT-COUNT-GAP refuses %s', async (_name, row) => {
    const { service, inserts } = gapHarness(row);
    const result = service.countGap(owner, row.id, gap('out', '0.2', '0.5'));
    await expect(result).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(result).rejects.toThrow('Only a Bybit account in a wallet can count a gap');
    expect(inserts).toEqual([]);
  });

  it.each([
    [
      'another reported balance',
      gap('out', '0.2', '0.4'),
      ConflictException,
      'Bybit reports another balance now',
    ],
    [
      'more coming in than Bybit holds',
      gap('in', '0.6', '0.5'),
      UnprocessableEntityException,
      'The difference exceeds the balance Bybit holds',
    ],
  ])('BYBIT-COUNT-GAP refuses %s and stores nothing', async (_name, request, type, message) => {
    const row = bybitRow({ balances: [{ coin: 'BTC', quantity: '0.5' }] });
    const { service, inserts, linkOwnTransfers } = gapHarness(row);
    const result = service.countGap(owner, row.id, request);
    await expect(result).rejects.toBeInstanceOf(type);
    await expect(result).rejects.toThrow(message);
    expect(inserts).toEqual([]);
    expect(linkOwnTransfers).not.toHaveBeenCalled();
  });

  it('BYBIT-COUNT-GAP asks to reload when the stored balance has more decimals than Bybit keeps', async () => {
    const row = bybitRow({ balances: [{ coin: 'BTC', quantity: '0.0000000000000000001' }] });
    const { service, inserts } = gapHarness(row);
    const result = service.countGap(owner, row.id, gap('out', '0.2', '0.5'));
    await expect(result).rejects.toBeInstanceOf(ConflictException);
    await expect(result).rejects.toThrow('Reload the balances');
    expect(inserts).toEqual([]);
  });

  it('BYBIT-COUNT-GAP counts a coin Bybit no longer lists as a zero balance', async () => {
    const row = bybitRow({ balances: [{ coin: 'ETH', quantity: '1' }] });
    const { service, inserts } = gapHarness(row);
    await expect(service.countGap(owner, row.id, gap('out', '0.2', '0'))).resolves.toMatchObject({
      id: row.id,
    });
    expect(inserts).toHaveLength(1);
  });

  it('BYBIT-COUNT-GAP stores one record for the difference and links own transfers after', async () => {
    const row = bybitRow({ balances: [{ coin: 'BTC', quantity: '0.5' }] });
    const { service, inserts, linkOwnTransfers } = gapHarness(row);
    const result = await service.countGap(owner, row.id, gap('in', '0.2', '0.5'));
    expect(result).toMatchObject({ id: row.id, network: 'bybit', exchange: { keyHint: 'WXYZ' } });
    expect(inserts).toHaveLength(1);
    const [ownerId, addressId, txid, blockTime, received, sent, direction, raw, asset] = inserts[0];
    expect([ownerId, addressId, txid, received, sent, direction, asset]).toEqual([
      owner,
      row.id,
      `bybit-deposit-gap-${gapRequest}`,
      '200000000000000000',
      '0',
      'in',
      'BTC',
    ]);
    expect(typeof blockTime).toBe('string');
    expect(JSON.parse(raw as string)).toMatchObject({
      txid: `bybit-deposit-gap-${gapRequest}`,
      balanceGap: true,
      coveredTo: '2026-10-30T00:00:00.000Z',
    });
    expect(linkOwnTransfers).toHaveBeenCalledWith(owner);
  });
});
