import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWalletAddressImport1790400000000 implements MigrationInterface {
  name = 'AddWalletAddressImport1790400000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE wallet_addresses (
      id uuid PRIMARY KEY,
      "ownerId" uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      network text NOT NULL CHECK (network = 'bitcoin'),
      address text NOT NULL CHECK (address ~ '^[1-9A-HJ-NP-Za-km-z]{25,34}$'
        OR address ~ '^bc1[02-9ac-hj-np-z]{11,87}$'),
      "walkTopTxid" text CHECK ("walkTopTxid" ~ '^[0-9a-f]{64}$'),
      "walkCursorTxid" text CHECK ("walkCursorTxid" ~ '^[0-9a-f]{64}$'),
      "completedTopTxid" text CHECK ("completedTopTxid" ~ '^[0-9a-f]{64}$'),
      "completedAt" timestamptz(3) CHECK (isfinite("completedAt")),
      "createdAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("createdAt")),
      UNIQUE ("ownerId", network, address),
      UNIQUE ("ownerId", id),
      CHECK ("walkCursorTxid" IS NULL OR "walkTopTxid" IS NOT NULL),
      CHECK ("completedTopTxid" IS NULL OR "completedAt" IS NOT NULL)
    )`);
    await runner.query(`CREATE TABLE wallet_address_transactions (
      "ownerId" uuid NOT NULL,
      "addressId" uuid NOT NULL,
      txid text NOT NULL CHECK (txid ~ '^[0-9a-f]{64}$'),
      "blockHeight" integer NOT NULL CHECK ("blockHeight" >= 0),
      "blockHash" text NOT NULL CHECK ("blockHash" ~ '^[0-9a-f]{64}$'),
      "blockTime" timestamptz(3) NOT NULL CHECK (isfinite("blockTime")),
      "receivedUnits" numeric(78,0) NOT NULL CHECK ("receivedUnits" >= 0),
      "sentUnits" numeric(78,0) NOT NULL CHECK ("sentUnits" >= 0),
      "feeUnits" numeric(78,0) NOT NULL CHECK ("feeUnits" >= 0),
      direction text NOT NULL CHECK (direction IN ('in', 'out', 'self')),
      raw jsonb NOT NULL CHECK (jsonb_typeof(raw) = 'object' AND raw->>'txid' = txid),
      "observedAt" timestamptz(3) NOT NULL DEFAULT clock_timestamp() CHECK (isfinite("observedAt")),
      PRIMARY KEY ("addressId", txid),
      FOREIGN KEY ("ownerId", "addressId")
        REFERENCES wallet_addresses ("ownerId", id) ON DELETE RESTRICT
    )`);
    await runner.query(`CREATE INDEX wallet_address_transactions_history
      ON wallet_address_transactions ("addressId", "blockHeight" DESC, txid)`);
  }

  async down(): Promise<void> {
    throw new Error('Wallet address import downgrade requires an explicit recovery plan');
  }
}
