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

/**
 * Characterization of one pass's outcomes. `client` replaces the explorer's answers; `positions`
 * are the staking pools stored for the address (Ethereum only); `evmSync` a staged block.
 */
function pass(
  network: 'optimism' | 'ethereum',
  client: Record<string, unknown> = {},
  options: { positions?: { contract: string; symbol: string | null }[]; evmSync?: unknown } = {},
) {
  const stored = { scannedBlock: null as number | null, completedAt: false, updates: 0 };
  const explorer = {
    configured: true,
    blockNumber: async () => ({ ok: true, block: TIP }),
    normal: async () => ({ ok: true, items: [] }),
    internal: async () => ({ ok: true, items: [] }),
    tokens: async () => ({ ok: true, items: [] }),
    call: async () => ({ ok: true, data: null }),
    ...client,
  };
  const row = () => ({
    id: 'a',
    ownerId: 'o',
    address: '0xabc',
    scannedBlock: stored.scannedBlock,
    tokenBackfillTo: null,
    tokenBackfillAt: null,
    evmSync: options.evmSync ?? null,
  });
  const query = async (sql: string, args: unknown[] = []) => {
    if (sql.includes('FROM wallet_stake_scans')) return [{ exists: 1 }];
    if (sql.startsWith('SELECT contract, symbol FROM wallet_ether_stake_positions'))
      return options.positions ?? [];
    if (sql.includes('UPDATE wallet_addresses')) {
      stored.updates++;
      stored.scannedBlock = args[2] as number;
      stored.completedAt = args[3] as boolean;
    }
    if (sql.includes('FOR UPDATE') || sql.includes('FROM wallet_addresses')) return [row()];
    return [];
  };
  const source = {
    query,
    manager: { query },
    transaction: async (_level: string, run: (m: unknown) => unknown) => run({ query }),
  };
  const adapter = new EvmSyncAdapter(
    source as unknown as DataSource,
    { forChain: () => explorer, blockscout: () => explorer } as unknown as EtherscanClient,
    { ...evmChain(network), blockscout: undefined },
  );
  return { adapter, stored };
}

describe('SYNC-DETAIL EVM pass outcomes', () => {
  it('SYNC-DETAIL ends a pass without a key as not configured, reading nothing', async () => {
    const blockNumber = jest.fn();
    const { adapter, stored } = pass('optimism', { configured: false, blockNumber });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'not_configured',
      imported: 0,
      detail: null,
    });
    expect(blockNumber).not.toHaveBeenCalled();
    expect(stored.updates).toBe(0);
  });

  it("SYNC-DETAIL ends the pass with the explorer's words when the chain tip cannot be read", async () => {
    const { adapter } = pass('optimism', {
      blockNumber: async () => ({
        ok: false,
        reason: 'rate_limited',
        detail: 'explorer.test limits requests',
      }),
    });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'rate_limited',
      imported: 0,
      detail: 'explorer.test limits requests',
    });
  });

  it.each(['normal', 'tokens'])(
    "SYNC-DETAIL stores nothing and passes on the explorer's words when the %s list fails",
    async (list) => {
      const { adapter, stored } = pass('optimism', {
        [list]: async () => ({
          ok: false,
          reason: 'unavailable',
          detail: 'explorer.test did not answer',
        }),
      });
      await expect(adapter.step('o', 'a')).resolves.toEqual({
        outcome: 'provider_error',
        reason: 'unavailable',
        imported: 0,
        detail: 'explorer.test did not answer',
      });
      expect(stored.updates).toBe(0);
    },
  );

  it('SYNC-PROGRESS refuses a staged block past the final one as an invalid answer', async () => {
    const { adapter, stored } = pass('optimism', {}, { evmSync: { block: TARGET + 1 } });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'invalid_response',
      imported: 0,
      detail: null,
    });
    expect(stored.updates).toBe(0);
  });

  it('SYNC-PROGRESS ends the pass partial when its time is used up before the first range', async () => {
    let clock = 0;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => (clock += 30_000));
    try {
      const normal = jest.fn();
      const { adapter, stored } = pass('optimism', { normal });
      await expect(adapter.step('o', 'a')).resolves.toEqual({
        outcome: 'partial',
        reason: null,
        imported: 0,
        detail: null,
      });
      expect(normal).not.toHaveBeenCalled();
      expect(stored.updates).toBe(0);
    } finally {
      now.mockRestore();
    }
  });

  it('ETH-STAKE-STATE completes an Ethereum history with no pools as on any other chain', async () => {
    const { adapter, stored } = pass('ethereum');
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: 0,
      detail: null,
    });
    expect(stored).toMatchObject({ scannedBlock: TARGET, completedAt: true });
  });

  it("ETH-STAKE-STATE fails the pass with the explorer's words when a stored pool cannot be read", async () => {
    const { adapter, stored } = pass(
      'ethereum',
      {
        call: async () => ({
          ok: false,
          reason: 'rate_limited',
          detail: 'explorer.test limits requests',
        }),
      },
      { positions: [{ contract: `0x${'5e'.repeat(20)}`, symbol: 'stSYN' }] },
    );
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'rate_limited',
      imported: 0,
      detail: 'explorer.test limits requests',
    });
    // The history is stored whole before the pools are read.
    expect(stored).toMatchObject({ scannedBlock: TARGET, completedAt: true });
  });
});
