import { MigrationInterface, QueryRunner } from 'typeorm';

export class KindOfWallet1795900000000 implements MigrationInterface {
  name = 'KindOfWallet1795900000000';

  async up(runner: QueryRunner): Promise<void> {
    // WALLET-KIND: how the owner holds an account's coins, shown on the wallet and asset pages.
    // Null until the owner says; no other column or row changes.
    await runner.query(`ALTER TABLE manual_accounts ADD COLUMN kind text
      CHECK (kind = 'software' OR kind = 'hardware' OR kind = 'exchange')`);
    // An account that holds a Bybit account is an exchange wallet already.
    await runner.query(`UPDATE manual_accounts SET kind = 'exchange' WHERE id IN (
      SELECT "accountId" FROM wallet_addresses WHERE network = 'bybit' AND "accountId" IS NOT NULL)`);
  }

  async down(): Promise<void> {
    throw new Error('Wallet kind downgrade requires an explicit recovery plan');
  }
}
