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
