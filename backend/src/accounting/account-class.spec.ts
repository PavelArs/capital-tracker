import { BadRequestException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { WalletAddressService } from '../wallet-addresses/wallet-address.service';
import type { WalletSyncService } from '../wallet-addresses/wallet-sync.service';
import { AccountingService } from './accounting.service';

// Synthetic ids only.
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const property = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('ACCOUNT-CLASS a broker account or a property never acts as a wallet (v8)', () => {
  it('refuses a kind for a classed account and changes nothing', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ assetClass: 'property' }]);
    const service = new AccountingService({ query } as unknown as DataSource);
    await expect(
      service.renameAccount(owner, property, { kind: 'hardware' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/^SELECT "assetClass"/);
  });

  it('still renames a classed account', async () => {
    const row = {
      id: property,
      name: 'Studio',
      kind: null,
      assetClass: 'property',
      currentRevision: 0,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    const query = jest.fn().mockResolvedValueOnce([[row], 1]);
    const service = new AccountingService({ query } as unknown as DataSource);
    await expect(service.renameAccount(owner, property, { name: 'Studio' })).resolves.toMatchObject(
      { name: 'Studio', assetClass: 'property' },
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('refuses to put an address into a classed account', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([]) // the owner's accounting lock
      .mockResolvedValueOnce([{ assetClass: 'property' }]);
    const manager = {
      query,
      queryRunner: { isTransactionActive: true },
    } as unknown as EntityManager;
    const service = new WalletAddressService(
      {} as DataSource,
      {} as WalletSyncService,
    ) as unknown as { account(manager: EntityManager, owner: string, id: string): Promise<void> };
    await expect(service.account(manager, owner, property)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
