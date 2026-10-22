import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BROKER-ASSET-ID: a T-Bank link keeps the asset and security type T-Bank named, so the same fund
 * under another venue's instrument UID in another account finds the same instrument. Links saved
 * earlier stay unnamed until an import names their instrument UID again.
 */
export class LinkBrokerAssets1797900000000 implements MigrationInterface {
  name = 'LinkBrokerAssets1797900000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE broker_instrument_links
      ADD COLUMN "assetUid" uuid,
      ADD COLUMN "instrumentType" text CHECK ("instrumentType" IN ('share', 'bond', 'etf'))`);
    await runner.query(`CREATE UNIQUE INDEX broker_instrument_links_asset
      ON broker_instrument_links ("ownerId", provider, "assetUid") WHERE "assetUid" IS NOT NULL`);
  }

  async down(): Promise<void> {
    throw new Error('Broker asset links downgrade requires an explicit recovery plan');
  }
}
