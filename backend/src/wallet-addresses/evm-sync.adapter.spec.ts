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
