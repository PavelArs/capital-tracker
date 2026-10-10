import { MigrationInterface, QueryRunner } from 'typeorm';

export class StopTrackingWallets1796300000000 implements MigrationInterface {
  name = 'StopTrackingWallets1796300000000';

  async up(runner: QueryRunner): Promise<void> {
    // WALLET-REMOVE: an address or a wallet the owner stopped tracking keeps every record it
    // ever produced and only leaves the lists, the balances and the sync schedule. Null while
    // tracked; no other column or row changes, and no check a restore could reword.
    await runner.query('ALTER TABLE wallet_addresses ADD COLUMN "removedAt" timestamptz');
    await runner.query('ALTER TABLE manual_accounts ADD COLUMN "removedAt" timestamptz');
  }

  async down(): Promise<void> {
    throw new Error('Wallet removal downgrade requires an explicit recovery plan');
  }
}
