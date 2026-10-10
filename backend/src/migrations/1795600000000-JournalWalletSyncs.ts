import { MigrationInterface, QueryRunner } from 'typeorm';

export class JournalWalletSyncs1795600000000 implements MigrationInterface {
  name = 'JournalWalletSyncs1795600000000';

  async up(runner: QueryRunner): Promise<void> {
    // SYNC-JOURNAL: one row for each pass of a wallet that ended (the background job's and "Sync
    // now"), newest kept: when it ran, how it ended, what the provider said and how many
    // transactions it stored. The wallet's current state stays in sync_sources. The journal is
    // a trace, not a record: it is not backed up and leaves with its wallet.
    await runner.query(`CREATE TABLE wallet_sync_runs (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      "ownerId" uuid NOT NULL,
      "addressId" uuid NOT NULL,
      "ranAt" timestamptz(3) NOT NULL CHECK (isfinite("ranAt")),
      state text NOT NULL CHECK (state = 'synced' OR state = 'partial' OR state = 'delayed'
        OR state = 'failed'),
      "errorCode" text,
      "errorMessage" text CHECK (char_length("errorMessage") <= 300),
      imported integer NOT NULL DEFAULT 0 CHECK (imported >= 0),
      FOREIGN KEY ("ownerId", "addressId")
        REFERENCES wallet_addresses ("ownerId", id) ON DELETE CASCADE
    )`);
    await runner.query(
      'CREATE INDEX wallet_sync_runs_address_idx ON wallet_sync_runs ("addressId", "ranAt" DESC)',
    );
  }

  async down(): Promise<void> {
    throw new Error('Sync journal downgrade requires an explicit recovery plan');
  }
}
