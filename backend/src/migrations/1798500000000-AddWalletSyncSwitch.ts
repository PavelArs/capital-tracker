import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWalletSyncSwitch1798500000000 implements MigrationInterface {
  name = 'AddWalletSyncSwitch1798500000000';

  async up(runner: QueryRunner): Promise<void> {
    // WALLET-SYNC-OFF: a wallet's background sync can be switched off by the owner or by the app
    // after repeated failures. Every existing wallet keeps syncing (the columns start empty).
    await runner.query(`ALTER TABLE wallet_addresses
      ADD COLUMN "syncDisabledAt" timestamptz,
      ADD COLUMN "syncDisabledReason" text
        CHECK ("syncDisabledReason" IN ('manual', 'failures')),
      ADD COLUMN "syncFailures" integer NOT NULL DEFAULT 0 CHECK ("syncFailures" >= 0),
      ADD CONSTRAINT "wallet_addresses_syncDisabled_check"
        CHECK (("syncDisabledAt" IS NULL) = ("syncDisabledReason" IS NULL))`);
  }

  async down(): Promise<void> {
    throw new Error('Wallet sync switch downgrade requires an explicit recovery plan');
  }
}
