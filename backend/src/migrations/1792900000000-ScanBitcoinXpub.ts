import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScanBitcoinXpub1792900000000 implements MigrationInterface {
  name = 'ScanBitcoinXpub1792900000000';

  async up(runner: QueryRunner): Promise<void> {
    // XPUB-ADD: a Bitcoin wallet is one address or one account public key (xpub, ypub or zpub),
    // stored exactly as the wallet app shows it. Existing rows satisfy the widened check.
    await runner.query(`ALTER TABLE wallet_addresses
      DROP CONSTRAINT wallet_addresses_address_check,
      ADD CONSTRAINT wallet_addresses_address_check CHECK (
        (network = 'bitcoin' AND (address ~ '^[1-9A-HJ-NP-Za-km-z]{25,34}$'
          OR address ~ '^bc1[02-9ac-hj-np-z]{11,87}$'
          OR address ~ '^[xyz]pub[1-9A-HJ-NP-Za-km-z]{107,108}$'))
        OR (network = 'ethereum' AND address ~ '^0x[0-9a-f]{40}$')
        OR (network = 'solana' AND address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'))`);
    // XPUB-SCAN: the addresses derived from a key, receiving (chain 0) and change (chain 1), up
    // to 20 unused past the last used one. Each keeps its confirmed transaction count, how many
    // of those are stored, and its own newest-first walk, like a single Bitcoin address. Every
    // transaction is stored once for the wallet, with its effect on all of the key's addresses.
    await runner.query(`CREATE TABLE wallet_xpub_addresses (
      "ownerId" uuid NOT NULL,
      "walletId" uuid NOT NULL,
      chain smallint NOT NULL CHECK (chain = 0 OR chain = 1),
      "addressIndex" integer NOT NULL CHECK ("addressIndex" >= 0),
      address text NOT NULL CHECK (address ~ '^[13][1-9A-HJ-NP-Za-km-z]{25,33}$'
        OR address ~ '^bc1q[02-9ac-hj-np-z]{38}$'),
      "txCount" integer CHECK ("txCount" >= 0),
      "storedCount" integer NOT NULL DEFAULT 0 CHECK ("storedCount" >= 0),
      "checkPending" boolean NOT NULL DEFAULT true,
      "walkTopTxid" text CHECK ("walkTopTxid" ~ '^[0-9a-f]{64}$'),
      "walkCursorTxid" text CHECK ("walkCursorTxid" ~ '^[0-9a-f]{64}$'),
      "walkSeen" integer NOT NULL DEFAULT 0 CHECK ("walkSeen" >= 0),
      "completedTopTxid" text CHECK ("completedTopTxid" ~ '^[0-9a-f]{64}$'),
      PRIMARY KEY ("walletId", chain, "addressIndex"),
      UNIQUE ("walletId", address),
      FOREIGN KEY ("ownerId", "walletId") REFERENCES wallet_addresses ("ownerId", id) ON DELETE RESTRICT,
      CHECK ("walkCursorTxid" IS NULL OR "walkTopTxid" IS NOT NULL)
    )`);
    // XPUB-OVERLAP: finds the owner's single-address wallets that a key also derives.
    await runner.query(
      'CREATE INDEX wallet_xpub_addresses_owner_address ON wallet_xpub_addresses ("ownerId", address)',
    );
  }

  async down(): Promise<void> {
    throw new Error('Bitcoin account key downgrade requires an explicit recovery plan');
  }
}
