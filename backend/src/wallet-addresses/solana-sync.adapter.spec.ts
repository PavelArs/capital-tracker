import { parseTransaction } from './solana-rpc-client';
import { SolanaSyncAdapter } from './solana-sync.adapter';

describe('SOL-SYNC-PROGRESS', () => {
  it('checkpoints signature discovery before visiting every token account', async () => {
    const wallet = '1'.repeat(32);
    const signature = `${'1'.repeat(63)}2`;
    const amounts: string[] = [];
    const row = {
      id: 'address-id',
      ownerId: 'owner-id',
      address: wallet,
      scannedBlock: null as number | null,
      tokenBackfillTo: null,
      tokenBackfillAt: null,
      solanaSync: null as unknown,
    };
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM wallet_addresses')) return [row];
      if (sql.includes('wallet_stake_scans')) return [{ exists: true }];
      if (sql.includes('wallet_stake_accounts')) return [];
      if (sql.includes('UPDATE wallet_addresses')) {
        if (sql.includes('"scannedBlock" = $3')) {
          row.scannedBlock = params?.[2] as number;
          row.solanaSync = JSON.parse(params?.[4] as string);
        } else row.solanaSync = JSON.parse(params?.[2] as string);
        return [];
      }
      if (sql.includes('INSERT INTO wallet_address_transactions')) {
        amounts.push(params?.[5] as string);
        return [{ txid: signature }];
      }
      throw new Error(sql);
    });
    const source = {
      query,
      transaction: jest.fn(
        async (_level: string, work: (manager: { query: typeof query }) => Promise<unknown>) =>
          work({ query }),
      ),
    };
    let tick = 0;
    const rpc = {
      slot: jest.fn(async () => ({ ok: true, slot: 10 })),
      tokenAccounts: jest.fn(async (_address: string, filter: { programId: string }) => ({
        ok: true,
        accounts: filter.programId.includes('Tokenkeg')
          ? Array.from({ length: 100 }, (_, index) => `token-${index}`)
          : [],
      })),
      signatures: jest.fn(async (address: string, _before: string | null) => {
        tick += 1_000;
        return {
          ok: true,
          items: address === 'token-99' ? [{ signature, slot: 5, blockTime: 1_760_000_000 }] : [],
        };
      }),
      transaction: jest.fn(async (requested: string) => {
        const raw = {
          slot: 5,
          blockTime: 1_760_000_000,
          meta: {
            err: null,
            fee: 0,
            preBalances: [0],
            postBalances: [1_000_000_001],
            preTokenBalances: [],
            postTokenBalances: [],
          },
          transaction: { signatures: [requested], message: { accountKeys: [wallet] } },
        };
        return { ok: true, transaction: parseTransaction(raw, requested) };
      }),
    };
    const now = jest.spyOn(Date, 'now');
    now.mockImplementation(() => tick);
    try {
      const result = await new SolanaSyncAdapter(source as never, rpc as never).step(
        row.ownerId,
        row.id,
      );
      expect(result.outcome).toBe('partial');
      expect(rpc.signatures.mock.calls.length).toBeLessThan(101);
      expect(row.solanaSync).not.toBeNull();
    } finally {
      now.mockRestore();
    }
    let outcome = 'partial';
    for (let pass = 0; pass < 3; pass++) {
      const resumed = await new SolanaSyncAdapter(source as never, rpc as never).step(
        row.ownerId,
        row.id,
      );
      outcome = resumed.outcome;
      if (outcome === 'complete') break;
    }
    expect(outcome).toBe('complete');
    expect(row.scannedBlock).toBe(10);
    expect(row.solanaSync).toBeNull();
    expect(amounts).toEqual(['1000000001']);
    expect(rpc.transaction).toHaveBeenCalledTimes(1);
    expect(rpc.tokenAccounts).toHaveBeenCalledTimes(2);
    expect(rpc.signatures.mock.calls.map(([address]) => address).sort()).toEqual(
      [wallet, ...Array.from({ length: 100 }, (_, index) => `token-${index}`)].sort(),
    );
  });

  it('stages a slot larger than the transaction budget and commits it whole after restart', async () => {
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const wallet = '1'.repeat(32);
    const signatures = Array.from({ length: 41 }, (_, index) => '1'.repeat(63) + alphabet[index]);
    const row = {
      id: 'address-id',
      ownerId: 'owner-id',
      address: wallet,
      scannedBlock: null as number | null,
      tokenBackfillTo: null,
      tokenBackfillAt: null,
      solanaSync: null as null | {
        staged: { signature: string; raw: Record<string, unknown> }[];
      },
    };
    let inserted = 0;
    const query = jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM wallet_addresses')) return [row];
      if (sql.includes('wallet_stake_scans')) return [{ exists: true }];
      if (sql.includes('wallet_stake_accounts')) return [];
      if (sql.includes('UPDATE wallet_addresses')) {
        if (sql.includes('"scannedBlock" = $3')) {
          row.scannedBlock = params?.[2] as number;
          row.solanaSync = JSON.parse(params?.[4] as string);
        } else row.solanaSync = JSON.parse(params?.[2] as string);
        return [];
      }
      if (sql.includes('INSERT INTO wallet_address_transactions')) {
        inserted += (params?.length ?? 0) / 11;
        return Array.from({ length: (params?.length ?? 0) / 11 }, (_, index) => ({
          txid: params?.[index * 11 + 2],
        }));
      }
      throw new Error(sql);
    });
    const source = {
      query,
      transaction: async (
        _level: string,
        work: (manager: { query: typeof query }) => Promise<unknown>,
      ) => work({ query }),
    };
    let refuseLast = true;
    let calls = 0;
    const rpc = {
      slot: async () => ({ ok: true, slot: 10 }),
      tokenAccounts: async () => ({ ok: true, accounts: [] }),
      signatures: async () => ({
        ok: true,
        items: signatures.map((signature) => ({ signature, slot: 5, blockTime: 1_760_000_000 })),
      }),
      transaction: jest.fn(async (signature: string) => {
        calls++;
        if (calls === 41 && refuseLast) {
          refuseLast = false;
          return { ok: false, reason: 'rate_limited' };
        }
        const raw = {
          slot: 5,
          blockTime: 1_760_000_000,
          meta: {
            err: null,
            fee: 0,
            preBalances: [0],
            postBalances: [1],
            preTokenBalances: [],
            postTokenBalances: [],
          },
          transaction: { signatures: [signature], message: { accountKeys: [wallet] } },
        };
        return { ok: true, transaction: parseTransaction(raw, signature) };
      }),
    };
    const first = await new SolanaSyncAdapter(source as never, rpc as never).step(
      row.ownerId,
      row.id,
    );
    expect(first.outcome).toBe('partial');
    expect(row.scannedBlock).toBeNull();
    expect(inserted).toBe(0);
    expect(row.solanaSync?.staged).toHaveLength(40);

    const second = await new SolanaSyncAdapter(source as never, rpc as never).step(
      row.ownerId,
      row.id,
    );
    expect(second).toEqual({ outcome: 'provider_error', reason: 'rate_limited', imported: 0 });
    expect(row.solanaSync?.staged).toHaveLength(40);
    expect(row.scannedBlock).toBeNull();
    expect(inserted).toBe(0);

    const third = await new SolanaSyncAdapter(source as never, rpc as never).step(
      row.ownerId,
      row.id,
    );
    expect(third).toEqual({ outcome: 'complete', reason: null, imported: 41 });
    expect(rpc.transaction).toHaveBeenCalledTimes(42);
    expect(inserted).toBe(41);
    expect(row.scannedBlock).toBe(10);
    expect(row.solanaSync).toBeNull();
  });

  it('rejects a stale checkpoint when another sync advanced the revision', async () => {
    const row = {
      id: 'address-id',
      ownerId: 'owner-id',
      address: 'wallet',
      scannedBlock: null,
      tokenBackfillTo: null,
      tokenBackfillAt: null,
      solanaSync: null,
    };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM wallet_addresses')) return [row];
      if (sql.includes('wallet_stake_scans')) return [{ exists: true }];
      throw new Error(sql);
    });
    const locked = jest.fn(async (sql: string) => {
      if (sql.includes('FROM wallet_addresses'))
        return [{ ...row, solanaSync: { revision: 'newer' } }];
      throw new Error(sql);
    });
    const source = {
      query,
      transaction: async (
        _level: string,
        work: (manager: { query: typeof locked }) => Promise<unknown>,
      ) => work({ query: locked }),
    };
    const rpc = {
      slot: async () => ({ ok: true, slot: 10 }),
      tokenAccounts: async () => ({ ok: true, accounts: [] }),
    };
    await expect(
      new SolanaSyncAdapter(source as never, rpc as never).step(row.ownerId, row.id),
    ).rejects.toThrow('Another sync advanced this address');
    expect(locked).toHaveBeenCalledTimes(1);
  });
});
