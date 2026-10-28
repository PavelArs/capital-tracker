import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWalletSyncProgress1798200000000 implements MigrationInterface {
  name = 'AddWalletSyncProgress1798200000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE wallet_addresses
      ADD COLUMN "evmSync" jsonb CHECK (jsonb_typeof("evmSync") = 'object'),
      ADD COLUMN "solanaSync" jsonb CHECK (jsonb_typeof("solanaSync") = 'object')`);
  }

  async down(): Promise<void> {
    throw new Error('Wallet sync progress downgrade requires an explicit recovery plan');
  }
}
