import type { DataSource } from 'typeorm';
import type { EtherscanClient, Failed } from './etherscan-client';
import { evmChain } from './evm-chains';
import { CONFIRMATIONS, EvmSyncAdapter } from './evm-sync.adapter';

// Synthetic explorer and database: the adapter's ranges are what is under test.
const optimism = evmChain('optimism');

const TIP = 1_064;
const TARGET = TIP - CONFIRMATIONS;
const unprocessed: Failed = {
  ok: false,
  reason: 'unavailable',
  detail:
    'explorer.test said: Some internal transactions within this block range have not yet been processed',
  unprocessed: true,
};

function setup(processedTo: number, startAt: number | null = null) {
  const internalCalls: [number, number][] = [];
  const stored = { scannedBlock: startAt as number | null, completedAt: false };
  const client = {
    configured: true,
    blockNumber: async () => ({ ok: true, block: TIP }),
    normal: async () => ({ ok: true, items: [] }),
    tokens: async () => ({ ok: true, items: [] }),
    internal: async (_address: string, from: number, to: number) => {
      internalCalls.push([from, to]);
      return to <= processedTo ? { ok: true, items: [] } : unprocessed;
    },
  };
  const row = () => ({
    id: 'a',
    ownerId: 'o',
    address: '0xabc',
    scannedBlock: stored.scannedBlock,
    tokenBackfillTo: null,
    tokenBackfillAt: null,
  });
  const manager = {
    query: async (sql: string, args: unknown[] = []) => {
      if (sql.includes('UPDATE wallet_addresses')) {
        stored.scannedBlock = args[2] as number;
        stored.completedAt = args[3] as boolean;
      }
      return sql.includes('FOR UPDATE') ? [row()] : [];
    },
  };
  const source = {
    query: async () => [row()],
    transaction: async (_level: string, run: (m: unknown) => unknown) => run(manager),
  };
  const adapter = new EvmSyncAdapter(
    source as unknown as DataSource,
    {
      forChain: () => client,
      blockscout: () => client,
    } as unknown as EtherscanClient,
    { ...optimism, blockscout: undefined },
  );
  return { adapter, stored, internalCalls };
}

describe('UNPROCESSED internal transfers', () => {
  it('reads the whole range at once when the explorer has indexed all of it', async () => {
    const { adapter, stored, internalCalls } = setup(TARGET);
    await expect(adapter.step('o', 'a')).resolves.toMatchObject({ outcome: 'complete' });
    expect(internalCalls).toEqual([[0, TARGET]]);
    expect(stored).toEqual({ scannedBlock: TARGET, completedAt: true });
  });

  it('stores the history up to the last indexed block and asks again later for the rest', async () => {
    const { adapter, stored } = setup(600);
    const result = await adapter.step('o', 'a');
    expect(result).toMatchObject({ outcome: 'provider_error', reason: 'unavailable' });
    expect(result.detail).toMatch(/have not yet been processed/);
    // Blocks 0..600 are stored; the first unindexed block is where the next pass starts.
    expect(stored).toEqual({ scannedBlock: 600, completedAt: false });
  });

  it('moves nothing and asks twice when the first block of the range is unindexed', async () => {
    const { adapter, stored, internalCalls } = setup(-1, 600);
    const result = await adapter.step('o', 'a');
    expect(result).toMatchObject({ outcome: 'provider_error', reason: 'unavailable' });
    expect(internalCalls).toEqual([
      [601, TARGET],
      [601, 601],
    ]);
    expect(stored.scannedBlock).toBe(600);
  });
});

describe('NUTHATCH source for a chain Etherscan refuses', () => {
  const bnb = evmChain('bnb');
  const nestUrl = 'http://nest.test:8288/api';
  const planRequired = { ok: false, reason: 'plan_required' } as const;

  function nestSetup(nest: string | null, list: () => Promise<unknown>) {
    const stored = { scannedBlock: null as number | null };
    const asked: [string, number][] = [];
    const etherscan = {
      configured: true,
      blockNumber: async () => planRequired,
      normal: async () => planRequired,
    };
    const fromNest = {
      configured: true,
      blockNumber: async () => ({ ok: true, block: TIP }),
      normal: list,
      internal: async () => ({ ok: true, items: [] }),
      tokens: async () => ({ ok: true, items: [] }),
    };
    const row = () => ({
      id: 'a',
      ownerId: 'o',
      address: '0xabc',
      scannedBlock: stored.scannedBlock,
      tokenBackfillTo: null,
      tokenBackfillAt: null,
    });
    const manager = {
      query: async (sql: string, args: unknown[] = []) => {
        if (sql.includes('UPDATE wallet_addresses')) stored.scannedBlock = args[2] as number;
        return sql.includes('FOR UPDATE') ? [row()] : [];
      },
    };
    const source = {
      query: async () => [row()],
      transaction: async (_level: string, run: (m: unknown) => unknown) => run(manager),
    };
    const adapter = new EvmSyncAdapter(
      source as unknown as DataSource,
      {
        forChain: () => etherscan,
        nuthatch: (url: string, chainId: number) => {
          asked.push([url, chainId]);
          return fromNest;
        },
      } as unknown as EtherscanClient,
      bnb,
      nest,
    );
    return { adapter, stored, asked };
  }

  it('reads the chain from the nest named for it when the free plan refuses it', async () => {
    const { adapter, stored, asked } = nestSetup(nestUrl, async () => ({ ok: true, items: [] }));
    await expect(adapter.step('o', 'a')).resolves.toMatchObject({ outcome: 'complete' });
    expect(asked).toEqual([[nestUrl, 56]]);
    expect(stored.scannedBlock).toBe(TARGET);
  });

  it('fails the read with what the nest said when it cannot answer the range, and stores nothing', async () => {
    const said: Failed = {
      ok: false,
      reason: 'unavailable',
      detail:
        'nest.test said: NUTHATCH_INCOMPLETE: txlist for 0x… is indexed through block 9, not 1000',
    };
    const { adapter, stored } = nestSetup(nestUrl, async () => said);
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'unavailable',
      imported: 0,
      detail: said.detail,
    });
    expect(stored.scannedBlock).toBeNull();
  });

  it('says the free plan does not cover the chain, as before, when no nest is named', async () => {
    const { adapter, asked } = nestSetup(null, async () => ({ ok: true, items: [] }));
    await expect(adapter.step('o', 'a')).resolves.toMatchObject({
      outcome: 'provider_error',
      reason: 'plan_required',
    });
    expect(asked).toEqual([]);
  });
});
