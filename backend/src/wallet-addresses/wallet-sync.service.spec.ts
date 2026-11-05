import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { ChainClassificationService } from '../accounting/chain-classification.service';
import type { ChainSyncAdapter, StepResult } from './chain-sync';
import { WalletSyncService } from './wallet-sync.service';

// Synthetic adapter and database: only whether own transfers are linked after a pass is checked.
function pass(step: StepResult) {
  const linked: string[] = [];
  const adapter = { network: 'optimism', name: 'OP Mainnet', step: async () => step };
  const service = new WalletSyncService(
    { query: async () => [] } as unknown as DataSource,
    { get: () => 'true' } as unknown as ConfigService,
    [adapter as unknown as ChainSyncAdapter],
    {
      linkQuietly: async (owner: string) => void linked.push(owner),
    } as unknown as ChainClassificationService,
  );
  return { service, linked };
}

const wallet = { id: 'a', ownerId: 'o', network: 'optimism' };
const refused = { outcome: 'provider_error', reason: 'unavailable', detail: null } as const;

describe('XFER-AUTO after a pass', () => {
  it('links own transfers after a pass that stored rows and then met a refusal', async () => {
    const { service, linked } = pass({ ...refused, imported: 3 });
    await service.run(wallet);
    expect(linked).toEqual(['o']);
  });

  it('does not link after a refusal that stored nothing', async () => {
    const { service, linked } = pass({ ...refused, imported: 0 });
    await service.run(wallet);
    expect(linked).toEqual([]);
  });

  it('links after a pass that finished', async () => {
    const { service, linked } = pass({
      outcome: 'complete',
      reason: null,
      imported: 0,
      detail: null,
    });
    await service.run(wallet);
    expect(linked).toEqual(['o']);
  });
});

// WALLET-SYNC-OFF: the failure run is counted by one statement per pass; the scheduler skips a
// wallet whose sync is switched off. The three-in-a-row rule itself runs on PostgreSQL in the
// wallet-addresses acceptance probe.
function counted(step: StepResult) {
  const statements: { sql: string; params: unknown[] }[] = [];
  const adapter = { network: 'optimism', name: 'OP Mainnet', step: async () => step };
  const service = new WalletSyncService(
    {
      query: async (sql: string, params: unknown[]) => {
        statements.push({ sql, params });
        return sql.includes('UPDATE wallet_addresses') ? [[{ switchedOff: false }], 1] : [];
      },
    } as unknown as DataSource,
    { get: () => 'true' } as unknown as ConfigService,
    [adapter as unknown as ChainSyncAdapter],
  );
  const failures = () =>
    statements.filter(({ sql }) => sql.includes('"syncFailures"')).map(({ params }) => params[1]);
  return { service, statements, failures };
}

describe('WALLET-SYNC-OFF counting in a pass', () => {
  it('adds a failure for a pass that ended in an error', async () => {
    const { service, failures } = counted({ ...refused, imported: 0 });
    await service.run(wallet);
    expect(failures()).toEqual([true]);
  });

  it('clears the run for a pass that finished', async () => {
    const { service, failures } = counted({
      outcome: 'complete',
      reason: null,
      imported: 0,
      detail: null,
    });
    await service.run(wallet);
    expect(failures()).toEqual([false]);
  });

  it('leaves the run alone when the provider only asked to wait', async () => {
    const { service, failures } = counted({
      outcome: 'provider_error',
      reason: 'rate_limited',
      imported: 0,
    });
    await service.run(wallet);
    expect(failures()).toEqual([]);
  });

  it('adds a failure for a wallet whose network has no adapter', async () => {
    const { service, failures } = counted({ ...refused, imported: 0 });
    await service.run({ ...wallet, network: 'bitcoin' });
    expect(failures()).toEqual([true]);
  });

  it('still reports the pass when the count cannot be written', async () => {
    const adapter = { network: 'optimism', name: 'OP Mainnet', step: async () => refused };
    const service = new WalletSyncService(
      {
        query: async (sql: string) => {
          if (sql.includes('"syncFailures"')) throw new Error('synthetic write failure');
          return [];
        },
      } as unknown as DataSource,
      { get: () => 'true' } as unknown as ConfigService,
      [adapter as unknown as ChainSyncAdapter],
    );
    const result = await service.run({ ...wallet });
    expect(result).not.toBe('busy');
    expect(result === 'busy' ? null : result.state).toBe('failed');
  });
});
